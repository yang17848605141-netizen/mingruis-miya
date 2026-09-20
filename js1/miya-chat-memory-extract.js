/**
 * 角色记忆自动提炼（与 MiyaChatSummary 分镜/合卷总结并列，互不共用列表与触发配置）
 */
(function (global) {
    'use strict';

    var DEFAULT_MEMORY_PROMPT =
        '阅读以下对话，从角色视角提取对其重要的记忆：情感转折、约定与承诺、喜好与禁忌、关系变化、关键事件与细节。' +
        '客观区分双方，按时间线整理，每条记忆简洁明确，整体 80-200 字为宜；';

    var generating = {};

    function clampInt(v, lo, hi, fallback) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(hi, Math.max(lo, n));
    }

    function newMemoryId() {
        return 'cmem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

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
        return formatTsPrefix(m.createdAt) + who + body;
    }

    function resolveMemoryPrompt(contact, settings) {
        var custom = String((settings && settings.memoryAutoPrompt) || '').trim();
        if (custom) return custom;
        var name = (contact && (contact.remarkName || contact.name)) || '角色';
        return DEFAULT_MEMORY_PROMPT.replace('从角色视角', '从「' + name + '」的视角');
    }

    function lastCharMemoryEnd(settings) {
        var list = settings && Array.isArray(settings.charMemoryList) ? settings.charMemoryList : [];
        if (!list.length) return 0;
        var mx = 0;
        list.forEach(function (row) {
            var e = clampInt(row && row.endIndex, 0, 9999999, 0);
            if (e > mx) mx = e;
        });
        return mx;
    }

    function isOnlineNarrationRow(m) {
        var fmt = global.MiyaChatOnlineFormat;
        return !!(
            fmt &&
            typeof fmt.isCharacterOnlineNarrationMessage === 'function' &&
            fmt.isCharacterOnlineNarrationMessage(m)
        );
    }

    /** 统计上次提炼覆盖终点（1-based endIndex）之后完成的「角色回复轮次」，与引擎 replyBatchId 语义一致 */
    function countAssistantRounds(history, afterOneBasedEndIndex) {
        if (!Array.isArray(history) || !history.length) return 0;
        var start = clampInt(afterOneBasedEndIndex, 0, history.length, 0);
        var seenBatch = {};
        var count = 0;
        var legacyRoundOpen = false;
        for (var i = start; i < history.length; i++) {
            var m = history[i];
            if (!m || m.deleted) continue;
            if (m.role === 'user') {
                legacyRoundOpen = false;
                continue;
            }
            if (m.role === 'system' && !isOnlineNarrationRow(m)) continue;
            if (m.role !== 'assistant' && !isOnlineNarrationRow(m)) continue;
            var batch = String(m.replyBatchId || '').trim();
            if (batch) {
                if (!seenBatch[batch]) {
                    seenBatch[batch] = true;
                    count++;
                }
                legacyRoundOpen = false;
            } else if (!legacyRoundOpen) {
                count++;
                legacyRoundOpen = true;
            }
        }
        return count;
    }

    function adjustCharMemoryIndicesAfterPurge(list, delStart, delEnd) {
        if (!Array.isArray(list) || !list.length) return list || [];
        var ds = clampInt(delStart, 1, 9999999, 1);
        var de = clampInt(delEnd, ds, 9999999, ds);
        var n = de - ds + 1;
        return list.map(function (row) {
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

    function buildCharMemoryContextBlock(chatSettings) {
        if (chatSettings && chatSettings.memoryInterop === false) return '';
        var list = chatSettings && Array.isArray(chatSettings.charMemoryList) ? chatSettings.charMemoryList : [];
        if (!list.length) return '';
        var lines = list
            .slice()
            .sort(function (a, b) {
                return (Number(a && a.startIndex) || 0) - (Number(b && b.startIndex) || 0);
            })
            .map(function (row, i) {
                var body = String((row && row.content) || '').trim();
                if (!body) return '';
                return (
                    '【角色记忆' +
                    String(i + 1) +
                    ' · 消息' +
                    String(row.startIndex || '?') +
                    '-' +
                    String(row.endIndex || '?') +
                    '】\n' +
                    body
                );
            })
            .filter(Boolean);
        if (!lines.length) return '';
        return (
            '【长期记忆·角色重要记忆】\n' +
            '以下为从对话中提炼的、对该角色重要的记忆片段，请结合近期上下文使用，勿与分镜总结重复堆砌。\n\n' +
            lines.join('\n\n')
        );
    }

    function maybeAutoMemoryExtract(chatId) {
        var store = global.miyaChatStore;
        if (!store) return;
        var settings = store.getChatSettings(chatId);
        var trigger = clampInt(settings.memoryAutoRoundTrigger, 0, 500, 0);
        if (trigger <= 0) return;
        var history = store.getMessages(chatId);
        if (!history.length) return;
        var last = lastCharMemoryEnd(settings);
        if (last > history.length) last = 0;
        var rounds = countAssistantRounds(history, last);
        if (rounds < trigger) return;
        performMemoryExtract(chatId, { silent: true });
    }

    function performMemoryExtract(chatId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var silent = !!opts.silent;
        var cid = String(chatId || '').trim();
        if (!cid) return Promise.resolve(false);
        if (generating[cid]) return Promise.resolve(false);

        var store = global.miyaChatStore;
        if (!store) return Promise.resolve(false);
        var chat = store.findChat(cid);
        if (!chat) return Promise.resolve(false);
        var contact = store.findContact(chat.contactId);
        if (!contact) return Promise.resolve(false);
        var profiles = store.getProfiles();
        var profile =
            profiles.find(function (p) {
                return p.id === chat.profileId;
            }) || store.getActiveProfile();
        var settings = store.getChatSettings(cid);
        var history = store.getMessages(cid);
        if (!history.length) return Promise.resolve(false);

        var start = 1;
        var end = history.length;
        if (silent) {
            var last = lastCharMemoryEnd(settings);
            if (last > history.length) last = 0;
            start = last + 1;
            if (start > history.length) return Promise.resolve(false);
        } else {
            start = clampInt(opts.start, 1, history.length, 1);
            end = clampInt(opts.end, 1, history.length, history.length);
            start = Math.max(1, Math.min(start, history.length));
            end = Math.max(start, Math.min(end, history.length));
        }
        if (start > end) return Promise.resolve(false);

        var excerpt = history
            .slice(start - 1, end)
            .map(function (m) {
                return messageLine(m, contact, profile);
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

        var promptText = resolveMemoryPrompt(contact, settings) + '\n\n' + excerpt;
        generating[cid] = true;
        var memoryMessages = [{ role: 'user', content: promptText }];
        var eng = global.miyaChatEngine;
        if (eng && typeof eng.prependUniversalWorldbookMessage === 'function') {
            memoryMessages = eng.prependUniversalWorldbookMessage(memoryMessages);
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
                messages: memoryMessages
            })
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var text = extractText(data);
                if (!text) throw new Error('empty_memory');
                var list = Array.isArray(settings.charMemoryList) ? settings.charMemoryList.slice() : [];
                list.push({
                    id: newMemoryId(),
                    date: new Date().toLocaleString('zh-CN'),
                    startIndex: start,
                    endIndex: end,
                    content: text,
                    createdAt: Date.now()
                });
                return store.saveChatSettings(cid, { charMemoryList: list });
            })
            .then(function () {
                if (
                    global.miyaMemoryApp &&
                    typeof global.miyaMemoryApp.onCharMemoryUpdated === 'function'
                ) {
                    global.miyaMemoryApp.onCharMemoryUpdated(cid);
                }
                if (!silent && typeof opts.onDone === 'function') opts.onDone();
                return true;
            })
            .catch(function (e) {
                if (!silent && global.miyaDialog && global.miyaDialog.alert) {
                    global.miyaDialog.alert({
                        title: '记忆提炼失败',
                        message: (e && e.message) || String(e)
                    });
                }
                return false;
            })
            .finally(function () {
                delete generating[cid];
            });
    }

    global.MiyaChatMemoryExtract = {
        DEFAULT_MEMORY_PROMPT: DEFAULT_MEMORY_PROMPT,
        maybeAutoMemoryExtract: maybeAutoMemoryExtract,
        performMemoryExtract: performMemoryExtract,
        lastCharMemoryEnd: lastCharMemoryEnd,
        countAssistantRounds: countAssistantRounds,
        adjustCharMemoryIndicesAfterPurge: adjustCharMemoryIndicesAfterPurge,
        buildCharMemoryContextBlock: buildCharMemoryContextBlock,
        isGenerating: function (chatId) {
            return !!generating[String(chatId || '')];
        }
    };
})(window);
