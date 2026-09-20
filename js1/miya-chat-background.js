(function (global) {
    'use strict';

    var SCAN_MS = 5000;
    var FAIL_COOLDOWN_MS = 300000;
    var PROACTIVE_MIN_GAP_MS = 60000;
    var timer = null;
    var queue = [];
    var queued = {};
    var inFlight = {};
    var inFlightChat = {};
    var workerRunning = false;
    var booted = false;

    function clampInt(v, lo, hi, fallback) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(hi, Math.max(lo, n));
    }

    function pickTs(v) {
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function loadHistoryForApi(store, chatId) {
        if (!store || !chatId) return [];
        if (store.getMergedMessagesForApi && typeof store.getMergedMessagesForApi === 'function') {
            return store.getMergedMessagesForApi(chatId) || [];
        }
        var hid = resolveProactiveApiChatId(store, chatId);
        if (store.getMessagesForApi && typeof store.getMessagesForApi === 'function') {
            return store.getMessagesForApi(hid) || [];
        }
        return store.getMessages(hid) || [];
    }

    function historyLastTs(store, chatId, roleFilter) {
        var list = loadHistoryForApi(store, chatId);
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.historyLastTs === 'function') return aw.historyLastTs(list, roleFilter);
        for (var i = list.length - 1; i >= 0; i--) {
            var row = list[i];
            if (!row || row.deleted) continue;
            if (roleFilter === 'user' && row.role !== 'user') continue;
            if (roleFilter === 'assistant' && row.role !== 'assistant') continue;
            var t = pickTs(row.createdAt);
            if (t) return t;
        }
        return 0;
    }

    function chatGapAnchorTs(store, chatId) {
        var list = loadHistoryForApi(store, chatId);
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.gapAnchorTs === 'function') return pickTs(aw.gapAnchorTs(list));
        return historyLastTs(store, chatId);
    }

    function hasUnrepliedUserMessages(store, chatId) {
        var list = loadHistoryForApi(store, chatId);
        var aw = global.MiyaChatAwareness;
        if (!aw || typeof aw.historyLastTs !== 'function' || typeof aw.gapAnchorTs !== 'function') {
            return false;
        }
        var lastAny = pickTs(aw.historyLastTs(list));
        if (!lastAny) return false;
        return lastAny > pickTs(aw.gapAnchorTs(list));
    }

    /** 会话里最近一条用户/角色消息时刻（不计系统旁白）；主动间隔按此计时，不分谁发的 */
    function lastChatMessageTs(store, chatId) {
        var list = loadHistoryForApi(store, chatId);
        for (var i = list.length - 1; i >= 0; i--) {
            var row = list[i];
            if (!row || row.deleted) continue;
            if (row.role !== 'user' && row.role !== 'assistant') continue;
            var t = pickTs(row.createdAt);
            if (t) return t;
        }
        return 0;
    }

    /**
     * 主动发消息间隔锚点：距离最后一条消息（谁发的都行）满间隔即触发。
     * 无消息时才回落到启用/基线时刻。
     */
    function activeIntervalAnchorTs(store, chatId, bg) {
        bg = bg || {};
        var lastMsg = lastChatMessageTs(store, chatId);
        if (lastMsg) return lastMsg;
        var fallback = 0;
        [pickTs(bg.lastAutoPushAt), pickTs(bg.proactiveBaselineAt), pickTs(bg.activeEnabledAt)].forEach(
            function (t) {
                if (t > fallback) fallback = t;
            }
        );
        return fallback;
    }

    /** 离线消息等仍用「完整回合」锚点（排除末尾未回用户突刺） */
    function proactiveAnchorTs(store, chatId, bg) {
        bg = bg || {};
        var anchor = 0;
        [
            pickTs(bg.lastAutoPushAt),
            chatGapAnchorTs(store, chatId),
            pickTs(bg.proactiveBaselineAt),
            pickTs(bg.activeEnabledAt)
        ].forEach(function (t) {
            if (t > anchor) anchor = t;
        });
        return anchor;
    }

    function ensureProactiveBaseline(store, chatId, bg) {
        var anchor = activeIntervalAnchorTs(store, chatId, bg) || proactiveAnchorTs(store, chatId, bg);
        if (anchor) return anchor;
        var baseline = Date.now();
        var nextBg = Object.assign({}, bg || {}, { proactiveBaselineAt: baseline });
        store.saveChatSettings(chatId, { backgroundMessage: nextBg }).catch(function () {});
        return baseline;
    }

    function shouldRecordPushFailure(err) {
        var msg = String((err && err.message) || err || '').trim();
        if (!msg) return true;
        if (msg === 'chat_api_busy' || msg === 'engine_unavailable') return false;
        if (msg === 'api_not_configured' || msg === 'empty_message') return false;
        // 解析/空回复多为瞬时：走最短间隔重试，勿进入 5 分钟抑制，更勿重置主动间隔锚点
        if (msg === 'empty_reply' || msg === 'group_members_missing') return false;
        return true;
    }

    function saveProactiveAttempt(chatId, settings, options, extra) {
        var store = global.miyaChatStore;
        if (!store || !chatId) return Promise.resolve();
        extra = extra && typeof extra === 'object' ? extra : {};
        var bmPatch = { lastProactiveAttemptAt: Date.now() };
        Object.keys(extra).forEach(function (k) {
            if (k === 'recordAutoPushAt') return;
            bmPatch[k] = extra[k];
        });
        // 仅成功发出才推进 lastAutoPushAt；失败/忙线也写会把间隔重置，表现为「到时间却不发」
        if (extra.recordAutoPushAt) {
            if (options && (options.isAutoPush || options.isLifeLike)) {
                bmPatch.lastAutoPushAt = Date.now();
            }
            if (options && options.isOffline) {
                var prevBg = (settings && settings.backgroundMessage) || {};
                var lo = clampInt(prevBg.offlineIntervalMin, 5, 10080, 60);
                var hi = clampInt(prevBg.offlineIntervalMax, lo, 10080, 240);
                bmPatch.lastOfflineAt = Date.now();
                bmPatch.offlineRollAnchor = Date.now();
                bmPatch.offlineRollGapMs = (lo + Math.random() * (hi - lo)) * 60000;
            }
        }
        return store.saveChatSettings(chatId, { backgroundMessage: bmPatch });
    }

    function nowMinutes() {
        var n = new Date();
        return n.getHours() * 60 + n.getMinutes();
    }

    function inQuietWindow(bg) {
        if (!bg || !bg.quietEnabled) return false;
        var qs = clampInt(bg.quietStartMin, 0, 1439, 1380);
        var qe = clampInt(bg.quietEndMin, 0, 1439, 420);
        if (qs === qe) return false;
        var now = nowMinutes();
        if (qs < qe) return now >= qs && now < qe;
        return now >= qs || now < qe;
    }

    function buildRecentAssistantDigest(store, chatId, limit) {
        if (!store || !chatId) return '';
        var msgs = loadHistoryForApi(store, chatId);
        var lines = [];
        for (var i = msgs.length - 1; i >= 0 && lines.length < (limit || 8); i--) {
            var m = msgs[i];
            if (!m || m.deleted || m.role !== 'assistant') continue;
            var fmt = global.MiyaChatOnlineFormat;
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(m)) continue;
            var aw = global.MiyaChatAwareness;
            var t = String(m.content || '').trim();
            if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
                t = aw.stripTimelinePrefixForDisplay(t);
            }
            if (m.type === 'voice') t = String(m.voiceText || t).trim() || '[语音]';
            if (!t) continue;
            if (t.length > 80) t = t.slice(0, 77) + '…';
            lines.unshift('- ' + t);
        }
        if (!lines.length) return '';
        return (
            '【近期已发原文】\n' +
            '对照下方原文续写或换角度，勿当作没看见，也勿复读。\n' +
            lines.join('\n')
        );
    }

    function buildRecentGroupAssistantDigest(store, chatId, limit) {
        if (!store || !chatId) return '';
        var gg = global.MiyaChatGroup;
        if (!gg || typeof gg.getMembers !== 'function') return '';
        var chat = store.findChat(chatId);
        if (!chat) return '';
        var members = gg.getMembers(store, chat);
        var msgs = store.getMessages(chatId) || [];
        var lines = [];
        for (var i = msgs.length - 1; i >= 0 && lines.length < (limit || 8); i--) {
            var m = msgs[i];
            if (!m || m.deleted || m.role !== 'assistant') continue;
            var fmt = global.MiyaChatOnlineFormat;
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(m)) continue;
            var aw = global.MiyaChatAwareness;
            var t = String(m.content || '').trim();
            if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
                t = aw.stripTimelinePrefixForDisplay(t);
            }
            if (m.type === 'voice') t = String(m.voiceText || t).trim() || '[语音]';
            if (!t) continue;
            if (t.length > 80) t = t.slice(0, 77) + '…';
            var sid = String(m.senderContactId || '').trim();
            var speaker = '成员';
            if (sid) {
                var sp = members.find(function (c) { return c.id === sid; });
                if (sp && typeof gg.memberDisplayName === 'function') {
                    speaker = gg.memberDisplayName(store, sp, chatId);
                }
            }
            lines.unshift('- ' + speaker + '：' + t);
        }
        if (!lines.length) return '';
        return (
            '【群聊近期已发原文】\n' +
            '对照下方原文续写或换角度，勿当作没看见，也勿复读。\n' +
            lines.join('\n')
        );
    }

    function buildGroupProactiveMessagePrompt(store, chatId, chat, settings, kind) {
        var gg = global.MiyaChatGroup;
        var members = gg && typeof gg.getMembers === 'function' ? gg.getMembers(store, chat) : [];
        var memberNames = members
            .map(function (c) {
                return gg.memberDisplayName(store, c, chatId);
            })
            .filter(Boolean)
            .join('、');
        var nowTs = Date.now();
        var isActive = kind === 'active';
        var speakState = getTrailingSpeakerStateFromStore(store, chatId);
        var lines = [
            isActive ? '【群聊主动消息】' : '【群聊离线消息】',
            '到了主动联系时刻：须自然衔接上文末尾几条消息，兼顾各条真实发送时刻；格式「角色名：内容」，可多成员接话。',
            buildProactiveContinueLeadHint(speakState),
            '默认勿报时；勿复读近期相同开场。'
        ];
        if (memberNames) lines.push('【本群成员】' + memberNames);
        var tailDigest = buildRecentChatTailDigest(store, chatId, settings, 8);
        if (tailDigest) lines.push(tailDigest);
        if (speakState === 'user_spoke_last') {
            var pendingUserBlock = buildPendingUserRoundLeadBlock(store, chatId, settings);
            if (pendingUserBlock) lines.push(pendingUserBlock);
        }
        buildProactiveActualTimeLines(settings, nowTs, {
            lastMsgTs: historyLastTs(store, chatId),
            userLastTs: historyLastTs(store, chatId, 'user'),
            assistantLastTs: historyLastTs(store, chatId, 'assistant')
        }).forEach(function (line) {
            lines.push(line);
        });
        if (speakState === 'assistant_spoke_last') {
            var digest = buildRecentGroupAssistantDigest(store, chatId, 6);
            if (digest) lines.push(digest);
        }
        lines.push(buildGroupAntiRepeatProactiveRules());
        return lines.join('\n');
    }

    function resolveProactiveRoleTz(settings) {
        var aw = global.MiyaChatAwareness;
        if (!aw) return 'Asia/Shanghai';
        var ta = settings && settings.timeAwareness;
        return (ta && ta.real && ta.real.roleTz) || aw.localTz();
    }

    function buildProactiveActualTimeLines(settings, nowTs, opts) {
        opts = opts || {};
        var aw = global.MiyaChatAwareness;
        if (!aw || typeof aw.formatFullDateTimeForTz !== 'function') return [];
        var tz = resolveProactiveRoleTz(settings);
        var userTz =
            (settings &&
                settings.timeAwareness &&
                settings.timeAwareness.real &&
                settings.timeAwareness.real.userTz) ||
            tz;
        nowTs = pickTs(nowTs) || Date.now();
        var scheduledTs = pickTs(opts.scheduledTs);
        var lastMsgTs = pickTs(opts.lastMsgTs);
        var userLastTs = pickTs(opts.userLastTs);
        var gapFn =
            typeof aw.formatPreciseDurationZh === 'function'
                ? aw.formatPreciseDurationZh
                : aw.formatRoughDurationZh;
        var lines = ['【现在】' + aw.formatFullDateTimeForTz(nowTs, tz)];
        if (scheduledTs && scheduledTs < nowTs - 30000) {
            var recentChat = lastMsgTs && nowTs - lastMsgTs < 300000;
            if (!recentChat) {
                lines.push(
                    '【原计划】' +
                        aw.formatFullDateTimeForTz(scheduledTs, tz) +
                        '（已晚 ' +
                        gapFn(nowTs - scheduledTs) +
                        '，按现在写）'
                );
            }
        }
        if (userLastTs) {
            lines.push(
                '【用户上次发言】' +
                    aw.formatFullDateTimeForTz(userLastTs, userTz) +
                    '（距今 ' +
                    gapFn(nowTs - userLastTs) +
                    '）'
            );
        }
        lines.push('正文默认勿报时、勿抱怨失联。');
        return lines;
    }

    function buildAntiRepeatProactiveRules() {
        return [
            '必须读取上文全部对话内容，并根据当下时间、与上一条消息的间隔做好自然衔接。',
            '主动发消息前必须对照上文「近期已发原文」：不得重复相同开场、撒娇句式、抱怨主题或话题套路。不要总说“突然想起一件事”这种话。',
            '禁止把天气、气温、晴雨当作固定开场；仅剧情需要时顺带一句。',
            '须换角度、换话题或换情绪推进，内容应自然、像真人发微信，可分享琐事、想念。',
            '仍须 <thinking> → 正文（每行一气泡）→ <miyavoice>。'
        ].join('\n');
    }

    function buildGroupAntiRepeatProactiveRules() {
        return [
            '必须读取上文全部对话内容，并根据当下时间、与上一条消息的间隔做好自然衔接。',
            '主动发消息前必须对照上文「群聊近期已发原文」：不得重复相同开场或话题套路。',
            '禁止把天气、报时当作固定开场；须换角度、换话题推进，内容自然。',
            '按「角色名：内容」逐行输出，可多成员接话。'
        ].join('\n');
    }

    function resolveProactiveApiChatId(store, chatId) {
        if (!store || !chatId) return String(chatId || '');
        var cid = String(chatId);
        var apMem = global.MiyaAppointmentMemory;
        if (apMem && typeof apMem.resolveCanonicalChatId === 'function') {
            return apMem.resolveCanonicalChatId(cid) || cid;
        }
        return cid;
    }

    function getTrailingSpeakerStateFromStore(store, chatId) {
        if (!store || !chatId) return 'empty';
        var msgs = loadHistoryForApi(store, chatId);
        var fmt = global.MiyaChatOnlineFormat;
        for (var i = msgs.length - 1; i >= 0; i--) {
            var row = msgs[i];
            if (!row || row.deleted) continue;
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(row)) {
                continue;
            }
            if (row.role === 'user') return 'user_spoke_last';
            if (row.role === 'assistant') return 'assistant_spoke_last';
        }
        return 'empty';
    }

    /** 自角色上一条之后、截止末尾的连续用户原文 */
    function formatPendingUserRoundText(store, chatId, settings) {
        var hist = loadHistoryForApi(store, chatId);
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.formatUserRoundLinesForRegenerate === 'function') {
            return String(fmt.formatUserRoundLinesForRegenerate(hist, settings) || '').trim();
        }
        var lines = [];
        for (var i = hist.length - 1; i >= 0; i--) {
            var row = hist[i];
            if (!row || row.deleted) continue;
            if (row.role === 'assistant') break;
            if (row.role === 'user' && String(row.content || '').trim()) {
                lines.unshift(String(row.content).trim());
            }
        }
        return lines.join('\n');
    }

    /**
     * 上文末尾若干条（用户+角色）带时间戳摘要，供主动轮自然衔接。
     * 不是「回用户某一轮」任务单。
     */
    function buildRecentChatTailDigest(store, chatId, settings, limit) {
        var hist = loadHistoryForApi(store, chatId);
        var fmt = global.MiyaChatOnlineFormat;
        var aw = global.MiyaChatAwareness;
        var lim = Math.max(3, Math.min(12, Number(limit) || 8));
        var picked = [];
        var i;
        for (i = hist.length - 1; i >= 0 && picked.length < lim; i--) {
            var m = hist[i];
            if (!m || m.deleted) continue;
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(m)) {
                continue;
            }
            if (m.role !== 'user' && m.role !== 'assistant') continue;
            var body =
                fmt && typeof fmt.formatMessageForApi === 'function'
                    ? String(fmt.formatMessageForApi(m) || '').trim()
                    : String(m.content || '').trim();
            if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
                body = aw.stripTimelinePrefixForDisplay(body);
            }
            if (!body) continue;
            if (body.length > 100) body = body.slice(0, 97) + '…';
            var stamped = body;
            if (aw && typeof aw.stampMessageForApi === 'function') {
                stamped = aw.stampMessageForApi(body, m, settings, Date.now(), 0);
            }
            picked.unshift(stamped);
        }
        if (!picked.length) return '';
        return [
            '【上文末尾几条·须自然衔接】',
            '下列为时间线末尾最近对话（含发送时刻）。本轮主动发消息须顺着这些内容往下聊，并按各条真实间隔理解早晚；',
            '像真人隔一会再发微信：可续一句、换角度、分享近况；禁止复读，禁止跳去接好几轮之前的旧话题。',
            picked
                .map(function (t, idx) {
                    return String(idx + 1) + '. ' + t;
                })
                .join('\n')
        ].join('\n');
    }

    /** 末条为用户时：把待衔接的用户侧原文钉住（仍是衔接，不是答题） */
    function buildPendingUserRoundLeadBlock(store, chatId, settings) {
        var text = formatPendingUserRoundText(store, chatId, settings);
        if (!text) return '';
        return [
            '【末尾用户侧原文·纳入衔接】',
            '时间线末尾是用户刚发的下列内容，你方尚未接话。主动触发时须把它们当作上文最新状态自然接下去；',
            '禁止假装没看见；禁止说「怎么还不回/还不告诉我/很久没理我」；禁止抛开末尾去接更早旧话题。',
            text
        ].join('\n');
    }

    function buildProactiveContinueLeadHint(speakState) {
        if (speakState === 'user_spoke_last') {
            return [
                '【衔接目标】时间线末条是用户：顺着上文末尾几条（含用户刚发）自然发微信；兼顾各条发送时刻与间隔。',
                '不是答题考试，但也不能当用户没说话；勿抱怨失联，勿接旧轮次话题。'
            ].join('\n');
        }
        if (speakState === 'assistant_spoke_last') {
            return [
                '【衔接目标】时间线末条是你方：本轮是隔一会再找用户，须自然衔接上文末尾几条消息，并按各条真实时刻理解间隔。',
                '禁止把「用户上一轮/更早发言」当成本轮必答对象；禁止假装用户没回你而催问；从你方最近一条往下推或换轻松话题。'
            ].join('\n');
        }
        return '【衔接目标】读完上文末尾几条与时间戳后，像真人主动发一条微信。';
    }

    function buildProactiveMessagePrompt(store, chatId, contact, settings, kind) {
        var nowTs = Date.now();
        var isActive = kind === 'active';
        var speakState = getTrailingSpeakerStateFromStore(store, chatId);
        var apiChatId = resolveProactiveApiChatId(store, chatId);
        var lines = [
            isActive ? '【主动发消息】' : '【离线消息】',
            '到了主动联系时刻：须自然衔接上文历史中末尾几条消息，并兼顾每条消息的真实发送时刻与间隔，像真人发微信。',
            buildProactiveContinueLeadHint(speakState)
        ];
        var tailDigest = buildRecentChatTailDigest(store, chatId, settings, 8);
        if (tailDigest) lines.push(tailDigest);
        if (speakState === 'user_spoke_last') {
            var pendingUserBlock = buildPendingUserRoundLeadBlock(store, chatId, settings);
            if (pendingUserBlock) lines.push(pendingUserBlock);
        }
        buildProactiveActualTimeLines(settings, nowTs, {
            lastMsgTs: historyLastTs(store, chatId),
            userLastTs: historyLastTs(store, chatId, 'user'),
            assistantLastTs: historyLastTs(store, chatId, 'assistant')
        }).forEach(function (line) {
            lines.push(line);
        });
        if (speakState === 'assistant_spoke_last') {
            var digest = buildRecentAssistantDigest(store, apiChatId, 6);
            if (digest) lines.push(digest);
        }
        lines.push(buildAntiRepeatProactiveRules());
        return lines.join('\n');
    }

    function queueJob(chatId, kind) {
        var key = String(chatId) + '::' + kind;
        if (queued[key] || inFlight[key] || inFlightChat[chatId]) return;
        queued[key] = true;
        queue.push({ chatId: chatId, kind: kind });
        runWorker();
    }

    function runWorker() {
        if (workerRunning) return;
        workerRunning = true;
        function step() {
            if (!queue.length) {
                workerRunning = false;
                return;
            }
            var job = queue.shift();
            var chatId = job.chatId;
            var kind = job.kind;
            var key = chatId + '::' + kind;
            delete queued[key];
            if (inFlight[key] || inFlightChat[chatId]) {
                step();
                return;
            }
            inFlight[key] = true;
            inFlightChat[chatId] = true;
            triggerReply(chatId, {
                isAutoPush: kind === 'active',
                isOffline: kind === 'offline',
                isLifeLike: kind === 'lifelike'
            })
                .catch(function (err) {
                    var msg = err && err.message ? err.message : err;
                    if (msg === 'chat_api_busy') {
                        setTimeout(function () {
                            queueJob(chatId, kind);
                        }, 12000);
                        return;
                    }
                    console.warn('[MiyaChatBackground]', kind, chatId, msg || err);
                })
                .finally(function () {
                    delete inFlight[key];
                    delete inFlightChat[chatId];
                    step();
                });
        }
        step();
    }

    function isBackgroundSuppressed(bg, now) {
        if (!bg) return false;
        var failAt = pickTs(bg.lastPushFailAt);
        return failAt && now - failAt < FAIL_COOLDOWN_MS;
    }

    function isCallActiveForChat(chatId) {
        var calls = global.MiyaChatCalls;
        if (!calls || typeof calls.isActive !== 'function' || !calls.isActive()) return false;
        if (typeof calls.getActiveChatId === 'function') {
            return String(calls.getActiveChatId()) === String(chatId);
        }
        return true;
    }

    function triggerReply(chatId, options) {
        var engine = global.miyaChatEngine;
        var store = global.miyaChatStore;
        if (!engine || !store || typeof engine.sendChat !== 'function') {
            return Promise.reject(new Error('engine_unavailable'));
        }
        options = options || {};
        if (isCallActiveForChat(chatId)) return Promise.resolve();
        if (engine.isChatApiBusy && engine.isChatApiBusy(chatId)) {
            return Promise.reject(new Error('chat_api_busy'));
        }
        if (engine.isReplyInFlight && engine.isReplyInFlight(chatId)) {
            return Promise.reject(new Error('chat_api_busy'));
        }
        var chat = store.findChat(chatId);
        if (!chat) return Promise.resolve();
        var isGroup = chat.type === 'group';
        var contact = store.findContact(chat.contactId);
        if (!isGroup && (!contact || contact.blocked)) return Promise.resolve();
        if (isGroup) {
            var gg = global.MiyaChatGroup;
            if (!gg || typeof gg.getMembers !== 'function') return Promise.resolve();
            var gMembers = gg.getMembers(store, chat);
            if (gMembers.length < 2) return Promise.resolve();
        }
        var settings = store.getChatSettings(chatId);
        var bg = settings.backgroundMessage || {};
        if (options.isLifeLike) {
            if (!bg.lifeLikeEnabled) return Promise.resolve();
        } else {
            if (options.isAutoPush && !bg.activeEnabled) return Promise.resolve();
            if (options.isOffline && !bg.offlineEnabled) return Promise.resolve();
        }
        if (isBackgroundSuppressed(bg, Date.now())) return Promise.resolve();
        var scheduledAt = 0;
        var lead;
        if (options.isLifeLike) {
            scheduledAt = pickTs(bg.lifeLikeNextPushAt);
            var ll = global.MiyaChatLifeLike;
            lead =
                ll && typeof ll.buildLifeLikeProactivePrompt === 'function'
                    ? ll.buildLifeLikeProactivePrompt(store, chatId, contact, settings, scheduledAt)
                    : buildProactiveMessagePrompt(store, chatId, contact, settings, 'active');
        } else {
            lead = isGroup
                ? buildGroupProactiveMessagePrompt(
                      store,
                      chatId,
                      chat,
                      settings,
                      options.isAutoPush ? 'active' : options.isOffline ? 'offline' : ''
                  )
                : buildProactiveMessagePrompt(
                      store,
                      chatId,
                      contact,
                      settings,
                      options.isAutoPush ? 'active' : options.isOffline ? 'offline' : ''
                  );
        }
        var sendOpts = {
            skipUserMessage: true,
            isAutoPush: !!options.isAutoPush,
            isOffline: !!options.isOffline,
            isLifeLike: !!options.isLifeLike,
            systemLead: lead
        };
        return engine
            .sendChat(chatId, '', sendOpts)
            .then(function (result) {
                var extra = { lastPushFailAt: 0, recordAutoPushAt: true };
                if (options.isLifeLike && scheduledAt) {
                    var curBg = (store.getChatSettings(chatId).backgroundMessage) || {};
                    if (pickTs(curBg.lifeLikeNextPushAt) === scheduledAt) {
                        extra.lifeLikeNextPushAt = 0;
                    }
                }
                return saveProactiveAttempt(chatId, settings, options, extra).then(function () {
                    return result;
                });
            })
            .catch(function (err) {
                var extra = { recordAutoPushAt: false };
                if (shouldRecordPushFailure(err)) extra.lastPushFailAt = Date.now();
                return saveProactiveAttempt(chatId, settings, options, extra).then(function () {
                    throw err;
                });
            });
    }

    function checkAll() {
        var store = global.miyaChatStore;
        if (!store) return;
        var now = Date.now();
        var chats = store.getChats();
        chats.forEach(function (chat) {
            if (!chat) return;
            if (isCallActiveForChat(chat.id)) return;
            if (inFlightChat[chat.id]) return;
            var engine = global.miyaChatEngine;
            if (engine && typeof engine.isChatApiBusy === 'function' && engine.isChatApiBusy(chat.id)) {
                return;
            }
            if (engine && typeof engine.isReplyInFlight === 'function' && engine.isReplyInFlight(chat.id)) {
                return;
            }
            var isGroup = chat.type === 'group';
            var contact = isGroup ? null : store.findContact(chat.contactId);
            if (!isGroup && (!contact || contact.blocked)) return;
            if (isGroup) {
                var gg = global.MiyaChatGroup;
                if (!gg || typeof gg.getMembers !== 'function') return;
                if (gg.getMembers(store, chat).length < 2) return;
            }
            var settings = store.getChatSettings(chat.id);
            var bg = settings.backgroundMessage || {};
            var lifeLike = !isGroup && !!bg.lifeLikeEnabled;
            if (lifeLike) {
                var ll = global.MiyaChatLifeLike;
                if (
                    !pickTs(bg.lifeLikeNextPushAt) &&
                    ll &&
                    typeof ll.salvageNextPushFromChat === 'function'
                ) {
                    var salvaged = ll.salvageNextPushFromChat(chat, settings);
                    if (salvaged && salvaged.ok && pickTs(salvaged.atMs)) {
                        bg = Object.assign({}, bg, { lifeLikeNextPushAt: salvaged.atMs });
                        store
                            .saveChatSettings(chat.id, {
                                backgroundMessage: { lifeLikeNextPushAt: salvaged.atMs }
                            })
                            .catch(function () {});
                    }
                }
            }

            if (lifeLike) {
                var nextPushAtDue = pickTs(bg.lifeLikeNextPushAt);
                if (nextPushAtDue && now >= nextPushAtDue && !inQuietWindow(bg)) {
                    queueJob(chat.id, 'lifelike');
                    return;
                }
            }

            if (isBackgroundSuppressed(bg, now)) return;
            var lastAttempt = pickTs(bg.lastProactiveAttemptAt);
            if (lastAttempt && now - lastAttempt < PROACTIVE_MIN_GAP_MS) return;
            var quiet = inQuietWindow(bg);

            if (lifeLike) {
                return;
            }

            // 主动发消息：距最后一条消息（用户或角色均可）达到设定间隔即触发
            if (bg.activeEnabled && !quiet) {
                var intervalMin = clampInt(bg.activeIntervalMin, 1, 1440, 30);
                var activeAnchor = activeIntervalAnchorTs(store, chat.id, bg);
                if (!activeAnchor) activeAnchor = ensureProactiveBaseline(store, chat.id, bg);
                if (activeAnchor && now - activeAnchor >= intervalMin * 60000) {
                    queueJob(chat.id, 'active');
                    return;
                }
            }

            // 离线消息仍避免在「用户末条未回复」时抢答
            if (!isGroup && hasUnrepliedUserMessages(store, chat.id)) return;
            var anchorTs = proactiveAnchorTs(store, chat.id, bg);
            if (!anchorTs && bg.offlineEnabled) {
                anchorTs = ensureProactiveBaseline(store, chat.id, bg);
            }
            if (!anchorTs) return;

            if (bg.offlineEnabled && !quiet) {
                var lo = clampInt(bg.offlineIntervalMin, 5, 10080, 60);
                var hi = clampInt(bg.offlineIntervalMax, lo, 10080, 240);
                var rollAnchor = pickTs(bg.offlineRollAnchor);
                var anchor = rollAnchor || pickTs(bg.lastOfflineAt) || anchorTs;
                var gapMs = Number(bg.offlineRollGapMs) || 0;
                if (gapMs <= 0) {
                    gapMs = (lo + Math.random() * (hi - lo)) * 60000;
                    var rollStart = Date.now();
                    store.saveChatSettings(chat.id, {
                        backgroundMessage: Object.assign({}, bg, {
                            offlineRollAnchor: rollStart,
                            offlineRollGapMs: gapMs
                        })
                    });
                    return;
                }
                if (now - anchor >= gapMs) {
                    queueJob(chat.id, 'offline');
                }
            } else if (bg.offlineRollGapMs || bg.offlineRollAnchor) {
                store.saveChatSettings(chat.id, {
                    backgroundMessage: Object.assign({}, bg, {
                        offlineRollGapMs: 0,
                        offlineRollAnchor: 0
                    })
                });
            }
        });
    }

    function scheduleScan() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            checkAll();
            scheduleScan();
        }, SCAN_MS);
    }

    function kickScan() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        checkAll();
        scheduleScan();
    }

    function bindForegroundCatchUp() {
        if (global.__miyaBgVisBound) return;
        global.__miyaBgVisBound = true;
        if (typeof global.miyaBindForeground === 'function') {
            global.miyaBindForeground(kickScan);
            return;
        }
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) kickScan();
        });
        window.addEventListener('pageshow', function () {
            if (!document.hidden) kickScan();
        });
    }

    function start() {
        bindForegroundCatchUp();
        if (booted) {
            /* 已在跑：打开 App 时不要立刻全库 checkAll，空闲再补扫 */
            if (typeof global.miyaScheduleIdle === 'function') {
                global.miyaScheduleIdle(function () {
                    if (booted) kickScan();
                }, 1200);
            } else {
                setTimeout(function () {
                    if (booted) kickScan();
                }, 200);
            }
            return;
        }
        booted = true;
        kickScan();
    }

    function stop() {
        booted = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function boot() {
        var st = global.miyaChatStore;
        if (!st) return;
        var chain = typeof st.init === 'function' ? st.init() : Promise.resolve();
        chain
            .then(function () {
                start();
            })
            .catch(function () {
                start();
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    global.MiyaChatBackground = {
        start: start,
        stop: stop,
        checkAll: checkAll,
        kickScan: kickScan,
        boot: boot,
        getTrailingSpeakerStateFromStore: getTrailingSpeakerStateFromStore,
        buildRecentAssistantDigest: buildRecentAssistantDigest,
        buildAntiRepeatProactiveRules: buildAntiRepeatProactiveRules,
        buildProactiveActualTimeLines: buildProactiveActualTimeLines,
        formatPendingUserRoundText: formatPendingUserRoundText,
        buildPendingUserRoundLeadBlock: buildPendingUserRoundLeadBlock,
        buildRecentChatTailDigest: buildRecentChatTailDigest,
        buildProactiveContinueLeadHint: buildProactiveContinueLeadHint
    };
})(window);
