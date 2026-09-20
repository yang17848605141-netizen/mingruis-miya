(function (global) {
    'use strict';

    var apStore = function () {
        return global.MiyaAppointmentStore;
    };

    function clampInt(v, lo, hi, fb) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, n));
    }

    function pickTs(v) {
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function historyCountForChat(st, id) {
        if (!st || !id) return 0;
        var arr =
            st.getMessagesForApi && typeof st.getMessagesForApi === 'function'
                ? st.getMessagesForApi(id)
                : st.getMessages(id);
        return Array.isArray(arr) ? arr.length : 0;
    }

    /**
     * 与线上聊天室一致的 canonical chatId。
     * 当前打开的会话只要有历史，就以它为准（普通回复/续写/重回/主动消息共用）；
     * 仅当当前会话为空时，才回退到同联系人其它线程。
     */
    function resolveCanonicalChatId(chatId) {
        var st = global.miyaChatStore;
        if (!st || !chatId) return String(chatId || '').trim();
        var cid = String(chatId || '').trim();
        var chat = st.findChat(cid);
        if (!chat || !chat.contactId) return cid;
        if (chat.type === 'group') return cid;
        if (historyCountForChat(st, cid) > 0) return cid;
        var contact = st.findContact(chat.contactId);
        if (!contact) return cid;
        var profileHint = String(chat.profileId || contact.defaultProfileId || '').trim();
        var canonical = st.findChatByContact(chat.contactId, profileHint);
        if (canonical && canonical.id && historyCountForChat(st, canonical.id) > 0) return canonical.id;
        var any = st.findChatByContact(chat.contactId, '');
        if (any && any.id && historyCountForChat(st, any.id) > 0) return any.id;
        return cid;
    }

    function formatCrossTime(ts) {
        if (!ts) return '';
        try {
            return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function formatCrossLine(role, contact, profile, body, ts) {
        var stamp = formatCrossTime(ts);
        var who = formatWho(role, contact, profile);
        var prefix = stamp ? '〔' + stamp + '·线下〕' : '〔线下〕';
        return prefix + who + '：' + body;
    }

    function resolveContactId(chatId) {
        var st = global.miyaChatStore;
        if (!st || !chatId) return '';
        var chat = st.findChat(chatId);
        return chat && chat.contactId ? String(chat.contactId).trim() : '';
    }

    function resolveContactIdFromInput(chatId, contact) {
        if (contact && contact.id) return String(contact.id).trim();
        return resolveContactId(chatId);
    }

    function onlineSummaryRanges(settings) {
        var sumMod = global.MiyaChatSummary;
        if (sumMod && typeof sumMod.onlineSummaryRanges === 'function') {
            return sumMod.onlineSummaryRanges(settings);
        }
        var list = settings && Array.isArray(settings.summaryList) ? settings.summaryList : [];
        var mega = settings && Array.isArray(settings.megaSummaryList) ? settings.megaSummaryList : [];
        var covered = {};
        if (sumMod && typeof sumMod.summaryIdsCoveredByMega === 'function') {
            covered = sumMod.summaryIdsCoveredByMega(mega);
        }
        var ranges = [];
        mega.forEach(function (row) {
            if (!row) return;
            ranges.push({
                start: clampInt(row.startIndex, 0, 9999999, 0),
                end: clampInt(row.endIndex, 0, 9999999, 0)
            });
        });
        list.forEach(function (row) {
            if (!row) return;
            var sid = row.id ? String(row.id) : '';
            if (sid && covered[sid]) return;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (!s || !e) return;
            if (
                !sid &&
                sumMod &&
                typeof sumMod.megaRangeFullyCovers === 'function' &&
                sumMod.megaRangeFullyCovers(s, e, ranges)
            ) {
                return;
            }
            ranges.push({ start: s, end: e });
        });
        return ranges;
    }

    function messageIndexCovered(idx, ranges) {
        if (!idx || !ranges.length) return false;
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (r.start && r.end && idx >= r.start && idx <= r.end) return true;
        }
        return false;
    }

    function offlineSummaryRanges(session) {
        return (session.summaryList || [])
            .filter(function (row) {
                return row && String(row.content || '').trim();
            })
            .map(function (row) {
                return {
                    start: clampInt(row.startIndex, 0, 9999999, 0),
                    end: clampInt(row.endIndex, 0, 9999999, 0)
                };
            });
    }

    /** 线下 session 总结范围 + 消息 id→序号，供线上 API 按条过滤镜像（仅去掉已总结段，保留未总结尾巴） */
    function buildOfflineMirrorFilterContext(chatId, contactId) {
        var ctx = { sessionRanges: Object.create(null), msgIndexById: Object.create(null) };
        var aps = apStore();
        if (!aps || typeof aps.exportForMemory !== 'function') return ctx;
        var cid = String(contactId || '').trim();
        if (!cid && chatId) cid = resolveContactId(chatId);
        if (!cid) return ctx;
        (aps.exportForMemory(chatId, cid) || []).forEach(function (sess) {
            if (!sess) return;
            var sid = String(sess.id || '').trim();
            if (!sid) return;
            var ranges = offlineSummaryRanges(sess);
            if (!ranges.length) return;
            ctx.sessionRanges[sid] = ranges;
            var idxMap = Object.create(null);
            liveSessionMessages(sess).forEach(function (m, i) {
                if (m && m.id) idxMap[String(m.id)] = i + 1;
            });
            ctx.msgIndexById[sid] = idxMap;
        });
        return ctx;
    }

    function shouldKeepOfflineMirror(m, filterCtx) {
        if (!m || !m.offlineMeet) return true;
        filterCtx = filterCtx || { sessionRanges: {}, msgIndexById: {} };
        var sid = String(m.appointmentSessionId || '').trim();
        if (!sid) return true;
        var ranges = filterCtx.sessionRanges[sid];
        if (!ranges || !ranges.length) return true;
        var mid = String(m.appointmentMsgId || '').trim();
        if (!mid) return true;
        var idxMap = filterCtx.msgIndexById[sid];
        var idx = idxMap && idxMap[mid];
        if (!idx) return true;
        return !messageIndexCovered(idx, ranges);
    }

    function filterOfflineMirrorsForApiHistory(history, chatId, contactId) {
        var filterCtx = buildOfflineMirrorFilterContext(chatId, contactId);
        return (history || []).filter(function (m) {
            return shouldKeepOfflineMirror(m, filterCtx);
        });
    }

    function liveSessionMessages(session) {
        return (session && session.messages ? session.messages : []).filter(function (m) {
            return m && !m.deleted && String(m.content || '').trim();
        });
    }

    function formatWho(role, contact, profile) {
        if (role === 'user') return (profile && profile.name) || '我';
        if (role === 'assistant') return (contact && contact.name) || '对方';
        return '系统';
    }

    function plainBody(m, fmt) {
        if (!m || m.deleted) return '';
        if (fmt && typeof fmt.formatMessageForApi === 'function') {
            return String(fmt.formatMessageForApi(m) || '').trim();
        }
        return String(m.content || '').trim();
    }

    function trimSlotsByTime(items, limit) {
        var list = (items || []).slice();
        list.sort(function (a, b) {
            return (a.orderKey || a.ts || 0) - (b.orderKey || b.ts || 0);
        });
        if (list.length > limit) list = list.slice(-limit);
        return list;
    }

    /** @returns {{slotItems:Array,summaryBlocks:Array}} */
    function collectOnlineSlots(chatId, contact, profile, settings, memoryCount) {
        var st = global.miyaChatStore;
        if (!st) return { slotItems: [], summaryBlocks: [] };
        var canonChatId = resolveCanonicalChatId(chatId);
        var limit = clampInt(memoryCount, 1, 500, 40);
        var history =
            st.getMessagesForApi && typeof st.getMessagesForApi === 'function'
                ? st.getMessagesForApi(canonChatId)
                : st.getMessages(canonChatId);
        history = (history || []).filter(function (m) {
            return m && !m.deleted;
        });
        var contactId = resolveContactIdFromInput(canonChatId, contact);
        history = filterOfflineMirrorsForApiHistory(history, canonChatId, contactId);
        var ranges = onlineSummaryRanges(settings);
        var fmt = global.MiyaChatOnlineFormat;
        var slots = [];
        history.forEach(function (m, i) {
            var idx = i + 1;
            if (m.role === 'system') return;
            if (m.offlineMeet) return;
            if (messageIndexCovered(idx, ranges)) return;
            var body = plainBody(m, fmt);
            if (!body) return;
            slots.push({
                channel: 'online',
                kind: 'message',
                ts: pickTs(m.createdAt),
                role: m.role,
                content:
                    (formatCrossTime(pickTs(m.createdAt)) ? '〔' + formatCrossTime(pickTs(m.createdAt)) + '·线上〕' : '〔线上〕') +
                    formatWho(m.role, contact, profile) +
                    '：' +
                    body,
                orderKey: pickTs(m.createdAt) || idx
            });
        });
        if (slots.length > limit) slots = trimSlotsByTime(slots, limit);

        var summaryBlocks = buildOnlineSummaryBlocks(settings);
        return { slotItems: slots, summaryBlocks: summaryBlocks };
    }

    function buildOnlineSummaryBlocks(settings) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.buildSummaryContextBlock === 'function') {
            var block = aw.buildSummaryContextBlock(settings);
            if (block) return [{ channel: 'online', kind: 'summary_bundle', ts: 0, content: block }];
        }
        return [];
    }

    function buildOfflineSummaryBlocks(sessions) {
        var blocks = [];
        (sessions || []).forEach(function (sess) {
            (sess.summaryList || []).forEach(function (row) {
                var body = String((row && row.content) || '').trim();
                if (!body) return;
                blocks.push({
                    channel: 'offline',
                    kind: 'summary',
                    ts: pickTs(row.createdAt) || pickTs(sess.createdAt),
                    content:
                        '【线下场景总结 · 会话' +
                        String(sess.id || '').slice(-6) +
                        ' · 第' +
                        String(row.startIndex || '?') +
                        '–' +
                        String(row.endIndex || '?') +
                        '条】\n' +
                        body,
                    sessionId: sess.id,
                    orderKey: pickTs(row.createdAt) || pickTs(sess.createdAt)
                });
            });
        });
        return blocks;
    }

    function collectOfflineSlotsForOnline(chatId, contact, profile, memoryCount) {
        var aps = apStore();
        if (!aps) return { slotItems: [] };
        var contactId = resolveContactIdFromInput(chatId, contact);
        var sessions = aps.exportForMemory(chatId, contactId);
        var limit = clampInt(memoryCount, 1, 500, 40);
        var items = [];
        sessions.forEach(function (sess) {
            var ranges = offlineSummaryRanges(sess);
            var live = liveSessionMessages(sess);
            live.forEach(function (m, i) {
                var idx = i + 1;
                if (messageIndexCovered(idx, ranges)) return;
                var body = plainBody(m, null);
                if (!body) return;
                var ts = pickTs(m.createdAt) || pickTs(sess.createdAt);
                items.push({
                    channel: 'offline',
                    kind: 'message',
                    ts: ts,
                    role: m.role,
                    content: formatCrossLine(m.role, contact, profile, body, ts),
                    sessionId: sess.id,
                    orderKey: ts || idx
                });
            });
            (sess.summaryList || []).forEach(function (row) {
                var body = String((row && row.content) || '').trim();
                if (!body) return;
                var ts = pickTs(row.createdAt) || pickTs(sess.createdAt);
                items.push({
                    channel: 'offline',
                    kind: 'summary',
                    ts: ts,
                    role: 'system',
                    content:
                        (formatCrossTime(ts) ? '〔' + formatCrossTime(ts) + '·线下总结〕' : '〔线下总结〕') +
                        '\n' +
                        body,
                    sessionId: sess.id,
                    orderKey: ts
                });
            });
        });
        return { slotItems: trimSlotsByTime(items, limit) };
    }

    function collectOfflineCrossForAppointment(chatId, contact, profile, settings, memoryCount) {
        var limit = clampInt(memoryCount, 1, 500, 40);
        var online = collectOnlineSlots(chatId, contact, profile, settings, memoryCount);
        var offline = collectOfflineSlotsForOnline(chatId, contact, profile, memoryCount);
        var offlineMsgs = (offline.slotItems || []).filter(function (it) {
            return it && it.kind === 'message';
        });
        var mergedSlots = trimSlotsByTime((online.slotItems || []).concat(offlineMsgs), limit);
        var aps = apStore();
        var contactId = resolveContactIdFromInput(chatId, contact);
        var offlineSummaries = aps ? buildOfflineSummaryBlocks(aps.exportForMemory(chatId, contactId)) : [];
        var summaryBlocks = (online.summaryBlocks || []).concat(offlineSummaries);
        return {
            slotItems: mergedSlots,
            summaryBlocks: summaryBlocks
        };
    }

    function slotsToApiMessages(slotItems) {
        var out = [];
        (slotItems || []).forEach(function (it) {
            if (!it || !String(it.content || '').trim()) return;
            if (it.kind === 'summary' || it.kind === 'summary_bundle') {
                out.push({ role: 'system', content: String(it.content) });
                return;
            }
            var role = it.role === 'assistant' ? 'assistant' : 'user';
            out.push({ role: role, content: String(it.content) });
        });
        return out;
    }

    function buildCrossMemorySystemBlock(slotItems) {
        var lines = (slotItems || [])
            .slice()
            .sort(function (a, b) {
                return (a.orderKey || a.ts || 0) - (b.orderKey || b.ts || 0);
            })
            .map(function (it) {
                return String(it.content || '').trim();
            })
            .filter(Boolean);
        if (!lines.length) return '';
        return (
            '【跨场景记忆·按本地时间线】\n' +
            '以下为线上/线下互通的记忆片段（不含当前界面未展示的正文），请与上下文衔接，勿重复啰嗦。\n\n' +
            lines.join('\n\n')
        );
    }

    function buildSummaryBlocksText(blocks) {
        return (blocks || [])
            .slice()
            .sort(function (a, b) {
                return (a.orderKey || a.ts || 0) - (b.orderKey || b.ts || 0);
            })
            .map(function (b) {
                return String(b.content || '').trim();
            })
            .filter(Boolean)
            .join('\n\n');
    }

    function buildMemoryInteropPreambleBlock() {
        return (
            '【线上线下记忆互通·必读】\n' +
            '以下内容为同一角色与用户之间已真实发生的剧情（含线上聊天与往期/其它场线下场景），按本地时间线整理。\n' +
            '你必须完全知晓并自然衔接，禁止表示不知情、没发生过、失忆、或「我们只在线上聊过/只在线下见过」等割裂说法。\n' +
            '若下文含「记忆总结」与「线上/线下」片段，须一并消化，不得只读其中一部分。'
        );
    }

    function injectCrossMemoryToApiMessages(apiMessages, slotItems, sceneLabel) {
        if (!apiMessages) return;
        var label = String(sceneLabel || '跨场景').trim();
        var items = slotItems || [];
        if (!items.length) return;
        apiMessages.push({
            role: 'system',
            content:
                '【' +
                label +
                '·记忆片段·按时间线】\n' +
                '以下片段来自「' +
                label +
                '」相关场景（不含当前场景正在输入的正文）。\n' +
                '你必须完全知晓并自然衔接，禁止表示不知情、没发生过、失忆或「我们只在线上聊过」。'
        });
        slotsToApiMessages(items).forEach(function (m) {
            apiMessages.push(m);
        });
    }

    /** 线下 API：总结 + 时间线片段，带统一必读头 */
    function injectAppointmentCrossMemory(apiMessages, cross) {
        if (!apiMessages || !cross) return;
        var sumText = String(cross.summaryText || '').trim();
        var items = cross.slotItems || [];
        if (!sumText && !items.length) return;
        apiMessages.push({ role: 'system', content: buildMemoryInteropPreambleBlock() });
        if (sumText) {
            apiMessages.push({
                role: 'system',
                content: '【对话历史记忆·总结】\n以下为线上与线下历史的压缩总结，请结合使用：\n\n' + sumText
            });
        }
        if (items.length) {
            injectCrossMemoryToApiMessages(apiMessages, items, '线上及往期线下');
        }
    }

    var memory = {
        resolveCanonicalChatId: resolveCanonicalChatId,
        resolveContactId: resolveContactId,
        collectOnlineSlots: collectOnlineSlots,
        collectOfflineSlotsForOnline: collectOfflineSlotsForOnline,
        collectOfflineCrossForAppointment: collectOfflineCrossForAppointment,
        buildOnlineSummaryBlocks: buildOnlineSummaryBlocks,
        buildOfflineSummaryBlocks: buildOfflineSummaryBlocks,
        slotsToApiMessages: slotsToApiMessages,
        buildCrossMemorySystemBlock: buildCrossMemorySystemBlock,
        buildSummaryBlocksText: buildSummaryBlocksText,
        injectCrossMemoryToApiMessages: injectCrossMemoryToApiMessages,
        buildMemoryInteropPreambleBlock: buildMemoryInteropPreambleBlock,
        injectAppointmentCrossMemory: injectAppointmentCrossMemory,
        buildOfflineMirrorFilterContext: buildOfflineMirrorFilterContext,
        shouldKeepOfflineMirror: shouldKeepOfflineMirror,
        filterOfflineMirrorsForApiHistory: filterOfflineMirrorsForApiHistory,
        messageIndexCovered: messageIndexCovered,

        /** 线上 buildApiMessages 用：注入线下记忆 */
        buildOnlineCrossMemory: function (chatId, contact, profile, settings) {
            var memoryCount =
                settings && settings.memoryCount ? clampInt(settings.memoryCount, 1, 500, 40) : 40;
            var pack = collectOfflineSlotsForOnline(chatId, contact, profile, memoryCount);
            return {
                systemBlock: buildCrossMemorySystemBlock(pack.slotItems),
                slotItems: pack.slotItems
            };
        },

        /** 线下 buildApiMessages 用 */
        buildAppointmentCrossMemory: function (chatId, contact, profile, settings) {
            var memoryCount =
                settings && settings.memoryCount ? clampInt(settings.memoryCount, 1, 500, 40) : 40;
            var pack = collectOfflineCrossForAppointment(chatId, contact, profile, settings, memoryCount);
            var summaryText = buildSummaryBlocksText(pack.summaryBlocks);
            var slotBlock = buildCrossMemorySystemBlock(pack.slotItems);
            return {
                summaryText: summaryText,
                slotBlock: slotBlock,
                slotItems: pack.slotItems
            };
        }
    };

    global.MiyaAppointmentMemory = memory;
})(window);
