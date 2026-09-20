(function (global) {
    'use strict';

    var DEFAULT_PROMPT =
        '以时间线分段客观总结所有内容，需区分开双方，记录重要内容与时刻，100-300字为宜；';

    var DEFAULT_GROUP_PROMPT =
        '以时间线客观总结本群全部对话，须区分各成员与用户，记录重要情节、关系变化与约定，100-300字为宜；';

    var DEFAULT_MEGA_PROMPT =
        '以下是一条或多条「分镜」正文。请仅基于这些内容进行合并精炼，输出一条合卷：' +
        '保持时间线顺序、区分双方，重要情节与约定不可省略，整体比分镜更精简，避免重复表述。';

    function resolveSummaryPrompt(settings, opts) {
        if (opts && opts.summaryPrompt != null && String(opts.summaryPrompt).trim()) {
            return String(opts.summaryPrompt).trim();
        }
        var custom = String((settings && settings.summaryPrompt) || '').trim();
        if (custom) return custom;
        if (opts && opts.isGroup) return DEFAULT_GROUP_PROMPT;
        return DEFAULT_PROMPT;
    }

    function resolveMegaSummaryPrompt(settings, opts) {
        if (opts && opts.megaSummaryPrompt != null && String(opts.megaSummaryPrompt).trim()) {
            return String(opts.megaSummaryPrompt).trim();
        }
        var custom = String((settings && settings.megaSummaryPrompt) || '').trim();
        return custom || DEFAULT_MEGA_PROMPT;
    }

    function newSummaryId(prefix) {
        return (prefix || 'sum') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
    var generating = {};

    function clampInt(v, lo, hi, fallback) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(hi, Math.max(lo, n));
    }

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    /**
     * 总结 API：summaryBaseUrl / summaryApiKey / summaryModel 有填则优先用；
     * 某项留空时回退聊天 API 对应字段。
     */
    function resolveSummaryConfig(cfg) {
        cfg = cfg && typeof cfg === 'object' ? cfg : getApiConfig();
        var summaryBaseUrl = String(cfg.summaryBaseUrl || '').trim();
        var summaryApiKey = String(cfg.summaryApiKey || '').trim();
        var summaryModel = String(cfg.summaryModel || '').trim();
        return {
            baseUrl: summaryBaseUrl || String(cfg.baseUrl || '').trim(),
            apiKey: summaryApiKey || String(cfg.apiKey || '').trim(),
            model: summaryModel || String(cfg.model || '').trim(),
            useDedicated: !!(summaryBaseUrl || summaryApiKey || summaryModel)
        };
    }

    function buildSummarySystemText(start, end) {
        return '已总结好一段内容（第 ' + start + '–' + end + ' 条消息）';
    }

    function normalizeBaseUrl(base) {
        var t = String(base || '').trim().replace(/\/+$/, '');
        if (!t) return '';
        try {
            var u = new URL(t);
            var path = (u.pathname || '/').replace(/\/+$/, '');
            var segs = path.split('/').filter(Boolean);
            if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
            if (!path || path === '/') return u.origin + '/v1';
            return u.origin + path + '/v1';
        } catch (e) {
            return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
        }
    }

    function extractText(data) {
        if (!data) return '';
        if (data.choices && data.choices[0]) {
            var ch = data.choices[0];
            if (ch.message && ch.message.content != null) return String(ch.message.content).trim();
            if (ch.text != null) return String(ch.text).trim();
        }
        if (data.content != null) return String(data.content).trim();
        return '';
    }

    function formatTsPrefix(ts) {
        var t = Number(ts);
        if (!Number.isFinite(t) || t <= 0) return '';
        try {
            return '[' + new Date(t).toLocaleString('zh-CN') + '] ';
        } catch (e) {
            return '';
        }
    }

    function messageLine(m, contact, profile) {
        if (!m || m.deleted || m.role === 'system') return '';
        var fmt = global.MiyaChatOnlineFormat;
        var body =
            fmt && typeof fmt.formatMessageForApi === 'function'
                ? fmt.formatMessageForApi(m)
                : String(m.content || '').trim();
        if (!body) return '';
        var who =
            m.role === 'user'
                ? profile && profile.name
                    ? profile.name + ': '
                    : '我: '
                : (contact.name || '对方') + ': ';
        var offlineTag = m.offlineMeet ? '〔线下〕' : '';
        return formatTsPrefix(m.createdAt) + offlineTag + who + body;
    }

    function groupMessageLine(m, members, profile, store, chat) {
        if (!m || m.deleted || m.role === 'system') return '';
        var gg = global.MiyaChatGroup;
        if (!gg || typeof gg.formatGroupMessageBody !== 'function') return '';
        var body = gg.formatGroupMessageBody(m, members, profile, store, chat.id);
        if (!body) return '';
        return formatTsPrefix(m.createdAt) + body;
    }

    /** 已沉淀记忆覆盖到的最大消息序号（分镜 + 合卷，合卷后删分镜仍能接着自动总结） */
    function lastSummaryEnd(settings) {
        var mx = 0;
        function consider(list) {
            (list || []).forEach(function (row) {
                var e = clampInt(row && row.endIndex, 0, 9999999, 0);
                if (e > mx) mx = e;
            });
        }
        consider(settings && settings.summaryList);
        consider(settings && settings.megaSummaryList);
        return mx;
    }

    function messageIndexCovered(idx, ranges) {
        if (!idx || !ranges || !ranges.length) return false;
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (r && r.start && r.end && idx >= r.start && idx <= r.end) return true;
        }
        return false;
    }

    /**
     * 分镜/合卷在 API 时间线上的覆盖区间（已并入合卷的分镜不重复计入）。
     * 与 getSummaryTimeline 的 1-based 序号对齐。
     */
    function onlineSummaryRanges(settings) {
        var list = settings && Array.isArray(settings.summaryList) ? settings.summaryList : [];
        var mega = settings && Array.isArray(settings.megaSummaryList) ? settings.megaSummaryList : [];
        var covered = summaryIdsCoveredByMega(mega);
        var ranges = [];
        var wm = getMegaCoverageWatermark(mega);
        mega.forEach(function (row) {
            if (!row) return;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (s && e && e >= s) ranges.push({ start: s, end: e });
        });
        /* 有合卷时用连续水位盖住 1…maxEnd，避免漏网分镜残留原文 */
        if (wm.hasBody && wm.maxEnd > 0) {
            ranges.push({ start: 1, end: wm.maxEnd });
        }
        list.forEach(function (row) {
            if (!row) return;
            if (isSummaryShotCovered(row, mega, covered)) return;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (!s || !e || e < s) return;
            ranges.push({ start: s, end: e });
        });
        return ranges;
    }

    function megaRangeFullyCovers(start, end, megaRanges) {
        for (var i = 0; i < (megaRanges || []).length; i++) {
            var r = megaRanges[i];
            if (r && r.start && r.end && start >= r.start && end <= r.end) return true;
        }
        return false;
    }

    /** 分镜区间与任一合卷有交集即视为已并入（比「完全覆盖」更稳，避免漏排除） */
    function megaRangeOverlaps(start, end, megaRanges) {
        for (var i = 0; i < (megaRanges || []).length; i++) {
            var r = megaRanges[i];
            if (!r || !r.start || !r.end) continue;
            if (start <= r.end && r.start <= end) return true;
        }
        return false;
    }

    function messageFingerprint(m) {
        if (!m) return '';
        if (m.id) return 'id:' + String(m.id);
        return (
            'fp:' +
            String(m.createdAt || 0) +
            '|' +
            String(m.role || '') +
            '|' +
            String(m.content || '').length +
            '|' +
            String(m.content || '').slice(0, 64)
        );
    }

    /** 按总结时间线标记已被分镜/合卷覆盖的消息指纹，供 buildApiMessages 去重 */
    function collectCoveredMessageIdSet(chatId, settings) {
        var store = global.miyaChatStore;
        var out = Object.create(null);
        if (!store || !chatId) return out;
        var s = settings || store.getChatSettings(chatId);
        var history = getSummaryTimeline(store, chatId);
        var ranges = onlineSummaryRanges(s);
        if (!ranges.length) return out;
        var lastEnd = lastSummaryEnd(s);
        /*
         * 序号是按「总结当时」的时间线写的。若之后删消息/过滤变短，
         * 当前下标会错位，把最新一轮也标成已覆盖 → 角色像读不到新消息。
         * 水印已超过当前条数时，整段按序号过滤不可用，宁可不去重。
         */
        if (lastEnd > 0 && lastEnd > history.length) return out;
        history.forEach(function (m, i) {
            if (!m) return;
            var idx = i + 1;
            if (lastEnd > 0 && idx > lastEnd) return;
            if (messageIndexCovered(idx, ranges)) out[messageFingerprint(m)] = true;
        });
        return out;
    }

    /** 合卷覆盖水位：maxEnd = 所有合卷 endIndex 最大值 */
    function getMegaCoverageWatermark(megaList) {
        var maxEnd = 0;
        var hasBody = false;
        var hasRange = false;
        var megaRanges = [];
        (megaList || []).forEach(function (row) {
            if (!row) return;
            if (String(row.content || '').trim()) hasBody = true;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (s && e && e >= s) {
                hasRange = true;
                megaRanges.push({ start: s, end: e });
                if (e > maxEnd) maxEnd = e;
            } else if (e > maxEnd) {
                maxEnd = e;
            }
        });
        return { maxEnd: maxEnd, hasBody: hasBody, hasRange: hasRange, megaRanges: megaRanges };
    }

    function isSummaryShotCovered(row, megaList, coveredById) {
        if (!row) return true;
        var wm = getMegaCoverageWatermark(megaList);
        /* 有合卷正文：默认不再注入历史分镜（除非明确在合卷水位之后） */
        if (wm.hasBody) {
            var sid = row.id ? String(row.id) : '';
            if (sid && coveredById && coveredById[sid]) return true;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            /* 合卷无序号，或分镜无序号 → 整段交给合卷，分镜不注入 */
            if (!wm.hasRange || !s || !e) return true;
            /* 分镜起始落在合卷覆盖水位内 → 不注入（避免 id 丢失时整锅漏网） */
            if (wm.maxEnd > 0 && s <= wm.maxEnd) return true;
            if (megaRangeOverlaps(s, e, wm.megaRanges)) return true;
            return false;
        }
        return false;
    }

    /** 诊断：即将注入的合卷/分镜条数与字数（供用量面板展示） */
    function inspectSummaryInjection(settings) {
        var list = settings && Array.isArray(settings.summaryList) ? settings.summaryList : [];
        var megaList = settings && Array.isArray(settings.megaSummaryList) ? settings.megaSummaryList : [];
        var covered = summaryIdsCoveredByMega(megaList);
        var megaInjected = 0;
        var shotInjected = 0;
        var shotSkipped = 0;
        var chars = 0;
        var megaChars = 0;
        var shotChars = 0;
        megaList.forEach(function (row) {
            var body = String((row && row.content) || '').trim();
            if (!body) return;
            megaInjected += 1;
            megaChars += body.length;
            chars += body.length;
        });
        list.forEach(function (row) {
            var body = String((row && row.content) || '').trim();
            if (!body) return;
            if (isSummaryShotCovered(row, megaList, covered)) {
                shotSkipped += 1;
                return;
            }
            shotInjected += 1;
            shotChars += body.length;
            chars += body.length;
        });
        return {
            megaTotal: megaList.length,
            shotTotal: list.length,
            megaInjected: megaInjected,
            shotInjected: shotInjected,
            shotSkipped: shotSkipped,
            megaChars: megaChars,
            shotChars: shotChars,
            contentChars: chars
        };
    }

    /** 部分删除消息后，下移落在删除区间之后的总结序号；与删除区间重叠的总结仅保留正文与原始序号标注。 */
    function adjustSummaryIndicesAfterPurge(summaryList, delStart, delEnd) {
        if (!Array.isArray(summaryList) || !summaryList.length) return summaryList || [];
        var ds = clampInt(delStart, 1, 9999999, 1);
        var de = clampInt(delEnd, ds, 9999999, ds);
        var n = de - ds + 1;
        return summaryList.map(function (row) {
            if (!row || typeof row !== 'object') return row;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (!s || !e) return row;
            if (e < ds) return row;
            if (s > de) {
                return Object.assign({}, row, {
                    startIndex: Math.max(1, s - n),
                    endIndex: Math.max(1, e - n)
                });
            }
            return row;
        });
    }

    function adjustMegaSummaryIndicesAfterPurge(megaList, delStart, delEnd) {
        if (!Array.isArray(megaList) || !megaList.length) return megaList || [];
        var ds = clampInt(delStart, 1, 9999999, 1);
        var de = clampInt(delEnd, ds, 9999999, ds);
        var n = de - ds + 1;
        return megaList.map(function (row) {
            if (!row || typeof row !== 'object') return row;
            var s = clampInt(row.startIndex, 0, 9999999, 0);
            var e = clampInt(row.endIndex, 0, 9999999, 0);
            if (!s || !e) return row;
            if (e < ds) return row;
            if (s > de) {
                return Object.assign({}, row, {
                    startIndex: Math.max(1, s - n),
                    endIndex: Math.max(1, e - n)
                });
            }
            return row;
        });
    }

    function summaryIdsCoveredByMega(megaList) {
        var covered = {};
        (megaList || []).forEach(function (mega) {
            (mega && mega.sourceSummaryIds ? mega.sourceSummaryIds : []).forEach(function (id) {
                var key = String(id || '').trim();
                if (key) covered[key] = true;
            });
        });
        return covered;
    }

    function buildMegaSummarySystemText(start, end, count) {
        return (
            '已生成合卷（合并 ' +
            String(count || 0) +
            ' 则分镜，涵盖第 ' +
            start +
            '–' +
            end +
            ' 条消息范围）'
        );
    }

    function getSummaryTimeline(store, chatId) {
        if (!store || !chatId) return [];
        var history;
        if (store.getMessagesForApi && typeof store.getMessagesForApi === 'function') {
            history = store.getMessagesForApi(chatId).filter(function (m) {
                return m && !m.deleted;
            });
        } else {
            history = store.getMessages(chatId);
        }
        var chat = store.findChat ? store.findChat(chatId) : null;
        var contactId = chat && chat.contactId ? String(chat.contactId).trim() : '';
        if (!contactId) return history;
        var apMem = global.MiyaAppointmentMemory;
        var canonId = chatId;
        if (apMem && typeof apMem.resolveCanonicalChatId === 'function') {
            canonId = apMem.resolveCanonicalChatId(chatId) || chatId;
        }
        if (apMem && typeof apMem.filterOfflineMirrorsForApiHistory === 'function') {
            history = apMem.filterOfflineMirrorsForApiHistory(history, canonId, contactId);
        }
        return history;
    }

    function maybeAutoSummary(chatId) {
        var store = global.miyaChatStore;
        if (!store) return;
        var settings = store.getChatSettings(chatId);
        var trigger = clampInt(settings.summaryTrigger, 0, 500, 0);
        if (trigger <= 0) return;
        var history = getSummaryTimeline(store, chatId);
        if (!history.length) return;
        var last = lastSummaryEnd(settings);
        /* 历史变短时夹到末尾，禁止重置为 0（否则会 silent 重扫整卷并失败） */
        if (last > history.length) last = history.length;
        if (history.length - last < trigger) return;
        performSummary(chatId, { silent: true });
    }

    function performSummary(chatId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var silent = !!opts.silent;
        var startInput = opts.start;
        var endInput = opts.end;
        var cid = String(chatId || '').trim();
        if (!cid) return Promise.resolve(false);
        if (generating[cid]) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({ title: '提示', message: '正在总结中，请稍候完成后再试。' });
            }
            return Promise.resolve(false);
        }
        var store = global.miyaChatStore;
        if (!store) return Promise.resolve(false);
        var chat = store.findChat(cid);
        if (!chat) return Promise.resolve(false);
        var isGroup = chat.type === 'group';
        var contact = isGroup ? null : store.findContact(chat.contactId);
        if (!isGroup && !contact) return Promise.resolve(false);
        var members = [];
        if (isGroup) {
            var gg = global.MiyaChatGroup;
            if (!gg || typeof gg.getMembers !== 'function') return Promise.resolve(false);
            members = gg.getMembers(store, chat);
            if (members.length < 2) return Promise.resolve(false);
        }
        var profiles = store.getProfiles();
        var profile = profiles.find(function (p) {
            return p.id === chat.profileId;
        }) || store.getActiveProfile();
        var settings = store.getChatSettings(cid);
        var history = getSummaryTimeline(store, cid);
        if (!history.length) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({ title: '提示', message: '当前没有可总结的对话。' });
            }
            return Promise.resolve(false);
        }
        var start = 1;
        var end = history.length;
        if (silent) {
            var last = lastSummaryEnd(settings);
            if (last > history.length) last = history.length;
            start = last + 1;
            if (start > history.length) return Promise.resolve(false);
        } else {
            start = clampInt(startInput, 1, history.length, 1);
            end = clampInt(endInput, 1, history.length, history.length);
            start = Math.max(1, Math.min(start, history.length));
            end = Math.max(start, Math.min(end, history.length));
        }
        if (start > end) return Promise.resolve(false);
        var excerpt = history
            .slice(start - 1, end)
            .map(function (m) {
                return isGroup
                    ? groupMessageLine(m, members, profile, store, chat)
                    : messageLine(m, contact, profile);
            })
            .filter(Boolean)
            .join('\n');
        if (!excerpt) return Promise.resolve(false);
        var sc = resolveSummaryConfig(getApiConfig());
        var base = normalizeBaseUrl(sc.baseUrl);
        if (!base || !sc.apiKey || !sc.model) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({
                    title: '未配置 API',
                    message: sc.useDedicated
                        ? '总结 API 需填写地址、密钥和模型；也可清空总结 API 后使用聊天 API。'
                        : '请在主屏设置中填写聊天 API 地址、密钥和模型。'
                });
            }
            return Promise.resolve(false);
        }
        var promptText = resolveSummaryPrompt(settings, Object.assign({}, opts, { isGroup: isGroup })) + '\n\n' + excerpt;
        generating[cid] = true;
        var summaryMessages = [{ role: 'user', content: promptText }];
        var eng = global.miyaChatEngine;
        if (eng && typeof eng.prependUniversalWorldbookMessage === 'function') {
            summaryMessages = eng.prependUniversalWorldbookMessage(summaryMessages);
        }
        return fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + sc.apiKey
            },
            body: JSON.stringify({
                model: sc.model,
                temperature: 0.5,
                messages: summaryMessages
            })
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var summaryText = extractText(data);
                if (!summaryText) throw new Error('empty_summary');
                var list = Array.isArray(settings.summaryList) ? settings.summaryList.slice() : [];
                list.push({
                    id: newSummaryId('sum'),
                    date: new Date().toLocaleString('zh-CN'),
                    startIndex: start,
                    endIndex: end,
                    content: summaryText,
                    createdAt: Date.now()
                });
                return store.saveChatSettings(cid, { summaryList: list });
            })
            .then(function () {
                if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                    global.miyaChatApp.refreshLists();
                }
                if (!silent && typeof opts.onDone === 'function') opts.onDone();
                return true;
            })
            .catch(function (e) {
                if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                    global.miyaDialog.alert({
                        title: '总结失败',
                        message: (e && e.message) || String(e)
                    });
                }
                return false;
            })
            .finally(function () {
                delete generating[cid];
            });
    }

    function performMegaSummary(chatId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var silent = !!opts.silent;
        var cid = String(chatId || '').trim();
        if (!cid) return Promise.resolve(false);
        if (generating[cid]) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({ title: '提示', message: '正在总结中，请稍候完成后再试。' });
            }
            return Promise.resolve(false);
        }
        var store = global.miyaChatStore;
        if (!store) return Promise.resolve(false);
        var settings = store.getChatSettings(cid);
        var list = Array.isArray(settings.summaryList) ? settings.summaryList : [];
        if (!list.length) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({ title: '提示', message: '请先生成至少一条分镜。' });
            }
            return Promise.resolve(false);
        }
        var picked = Array.isArray(opts.sourceIndices) ? opts.sourceIndices.slice() : [];
        picked = picked
            .map(function (x) { return parseInt(x, 10); })
            .filter(function (i) { return Number.isFinite(i) && i >= 0 && i < list.length; });
        picked = picked.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
        if (!picked.length) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({ title: '提示', message: '请至少选择一条分镜参与合卷。' });
            }
            return Promise.resolve(false);
        }
        var covered = summaryIdsCoveredByMega(settings.megaSummaryList);
        var overlap = picked.some(function (i) {
            var row = list[i];
            var id = row && row.id ? String(row.id) : '';
            return id && covered[id];
        });
        if (overlap) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({
                    title: '提示',
                    message: '所选分镜中已有被其他合卷覆盖的项，请调整选择。'
                });
            }
            return Promise.resolve(false);
        }
        var excerptParts = [];
        var sourceSummaryIds = [];
        var listWithIds = list.map(function (row) {
            if (!row || typeof row !== 'object') return row;
            var sid = String(row.id || '').trim();
            if (sid) return row;
            return Object.assign({}, row, { id: newSummaryId('sum') });
        });
        var start = 9999999;
        var end = 0;
        picked.forEach(function (i) {
            var row = listWithIds[i];
            if (!row) return;
            var body = String(row.content || '').trim();
            if (!body) return;
            var sid = String(row.id || '').trim();
            if (!sid) return;
            sourceSummaryIds.push(sid);
            var s = clampInt(row.startIndex, 1, 9999999, 1);
            var e = clampInt(row.endIndex, s, 9999999, s);
            start = Math.min(start, s);
            end = Math.max(end, e);
            excerptParts.push(
                '【分镜' +
                    String(i + 1) +
                    ' · 第 ' +
                    s +
                    '–' +
                    e +
                    ' 条】\n' +
                    body
            );
        });
        if (!excerptParts.length || !sourceSummaryIds.length) return Promise.resolve(false);
        var excerpt = excerptParts.join('\n\n');
        var sc = resolveSummaryConfig(getApiConfig());
        var base = normalizeBaseUrl(sc.baseUrl);
        if (!base || !sc.apiKey || !sc.model) {
            if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                global.miyaDialog.alert({
                    title: '未配置 API',
                    message: sc.useDedicated
                        ? '总结 API 需填写地址、密钥和模型；也可清空总结 API 后使用聊天 API。'
                        : '请在主屏设置中填写聊天 API 地址、密钥和模型。'
                });
            }
            return Promise.resolve(false);
        }
        var promptText = resolveMegaSummaryPrompt(settings, opts) + '\n\n' + excerpt;
        generating[cid] = true;
        var megaMessages = [{ role: 'user', content: promptText }];
        var engMega = global.miyaChatEngine;
        if (engMega && typeof engMega.prependUniversalWorldbookMessage === 'function') {
            megaMessages = engMega.prependUniversalWorldbookMessage(megaMessages);
        }
        return fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + sc.apiKey
            },
            body: JSON.stringify({
                model: sc.model,
                temperature: 0.45,
                messages: megaMessages
            })
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var summaryText = extractText(data);
                if (!summaryText) throw new Error('empty_summary');
                var megaList = Array.isArray(settings.megaSummaryList) ? settings.megaSummaryList.slice() : [];
                megaList.push({
                    id: newSummaryId('mega'),
                    date: new Date().toLocaleString('zh-CN'),
                    startIndex: start,
                    endIndex: end,
                    sourceSummaryIds: sourceSummaryIds,
                    content: summaryText,
                    createdAt: Date.now()
                });
                return store.saveChatSettings(cid, {
                    megaSummaryList: megaList,
                    summaryList: listWithIds
                });
            })
            .then(function () {
                if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                    global.miyaChatApp.refreshLists();
                }
                if (!silent && typeof opts.onDone === 'function') opts.onDone();
                return true;
            })
            .catch(function (e) {
                if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                    global.miyaDialog.alert({
                        title: '合卷失败',
                        message: (e && e.message) || String(e)
                    });
                }
                return false;
            })
            .finally(function () {
                delete generating[cid];
            })
            .then(function (ok) {
                if (ok) {
                    try {
                        maybeAutoSummary(cid);
                    } catch (eAuto) {}
                }
                return ok;
            });
    }

    global.MiyaChatSummary = {
        DEFAULT_PROMPT: DEFAULT_PROMPT,
        DEFAULT_GROUP_PROMPT: DEFAULT_GROUP_PROMPT,
        DEFAULT_MEGA_PROMPT: DEFAULT_MEGA_PROMPT,
        resolveSummaryPrompt: resolveSummaryPrompt,
        resolveMegaSummaryPrompt: resolveMegaSummaryPrompt,
        performSummary: performSummary,
        performMegaSummary: performMegaSummary,
        maybeAutoSummary: maybeAutoSummary,
        lastSummaryEnd: lastSummaryEnd,
        adjustSummaryIndicesAfterPurge: adjustSummaryIndicesAfterPurge,
        adjustMegaSummaryIndicesAfterPurge: adjustMegaSummaryIndicesAfterPurge,
        summaryIdsCoveredByMega: summaryIdsCoveredByMega,
        onlineSummaryRanges: onlineSummaryRanges,
        messageIndexCovered: messageIndexCovered,
        megaRangeFullyCovers: megaRangeFullyCovers,
        megaRangeOverlaps: megaRangeOverlaps,
        getMegaCoverageWatermark: getMegaCoverageWatermark,
        isSummaryShotCovered: isSummaryShotCovered,
        inspectSummaryInjection: inspectSummaryInjection,
        collectCoveredMessageIdSet: collectCoveredMessageIdSet,
        messageFingerprint: messageFingerprint,
        getSummaryTimeline: getSummaryTimeline,
        isGenerating: function (chatId) {
            return !!generating[String(chatId || '')];
        }
    };
})(window);
