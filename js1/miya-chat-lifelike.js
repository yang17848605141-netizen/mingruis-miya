/**
 * miya-chat-lifelike.js — 让 TA 自己决定何时找你
 * 每轮 API 回复末段输出 <miyanextpush>…</miyanextpush>，后台到点触发主动消息
 */
(function (global) {
    'use strict';

    var TAG_OPEN = '<miyanextpush>';
    var TAG_CLOSE = '</miyanextpush>';

    function clampInt(v, lo, hi, fallback) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(hi, Math.max(lo, n));
    }

    function pickTs(v) {
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function isEnabled(settings) {
        var bg = settings && settings.backgroundMessage;
        return !!(bg && bg.lifeLikeEnabled);
    }

    function stripNextPushTags(text) {
        var out = String(text || '');
        out = out.replace(/<miyanextpush>[\s\S]*?<\/miyanextpush\s*>/gi, '');
        out = out.replace(/＜miyanextpush＞[\s\S]*?＜\/miyanextpush＞/gi, '');
        out = out.replace(/<miyanextpush>[\s\S]*$/gi, '');
        out = out.replace(/＜miyanextpush＞[\s\S]*$/gi, '');
        return out.trim();
    }

    function resolveRoleTz(settings) {
        var aw = global.MiyaChatAwareness;
        var ta = settings && settings.timeAwareness;
        if (aw && typeof aw.localTz === 'function') {
            return (ta && ta.real && ta.real.roleTz) || aw.localTz();
        }
        try {
            return (
                (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
                'Asia/Shanghai'
            );
        } catch (e) {
            return 'Asia/Shanghai';
        }
    }

    function normalizeNextPushInner(raw) {
        var s = String(raw || '');
        s = s.replace(/[\uFF10-\uFF19]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 48);
        });
        s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
        });
        s = s.replace(/^[`'"\s]+|[`'"\s]+$/g, '').trim();
        s = s.replace(/^```[\w-]*\n?|\n?```$/g, '').trim();
        s = s.replace(/^[「『"'【\[]+|[」』"'】\]]+$/g, '').trim();
        return s;
    }

    function finalizeScheduleTs(ts) {
        if (!Number.isFinite(ts) || ts <= 0) return 0;
        return ts;
    }

    function parseWallClock(roleTz, year, month, day, hour, minute) {
        var aw = global.MiyaChatAwareness;
        var ts = 0;
        if (aw && typeof aw.wallClockToMs === 'function') {
            ts = aw.wallClockToMs(year, month, day, hour, minute, roleTz);
        }
        if (!ts) {
            var d = new Date(year, month - 1, day, hour, minute, 0, 0);
            ts = d.getTime();
        }
        return finalizeScheduleTs(ts);
    }

    function parseTimeOnlyInRoleTz(hour, minute, roleTz, now) {
        var aw = global.MiyaChatAwareness;
        if (!aw || typeof aw.wallClockPartsInTz !== 'function') return 0;
        now = now || Date.now();
        roleTz = roleTz || resolveRoleTz(null);
        var today = aw.wallClockPartsInTz(now, roleTz);
        var tsToday = parseWallClock(roleTz, today.year, today.month, today.day, hour, minute);
        if (tsToday) return tsToday;
        var tomorrowAnchor = now + 86400000;
        var tp = aw.wallClockPartsInTz(tomorrowAnchor, roleTz);
        return parseWallClock(roleTz, tp.year, tp.month, tp.day, hour, minute);
    }

    function parseNextPushContent(raw, now, roleTz) {
        now = now || Date.now();
        roleTz = roleTz || resolveRoleTz(null);
        var s = normalizeNextPushInner(raw);
        if (!s) return { ok: false };
        if (/^(off|none|null|无|不主动|暂不|never)$/i.test(s)) {
            return { ok: true, atMs: 0 };
        }

        var iso = s.match(
            /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:日)?(?:[T\s]+(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?)?/
        );
        if (iso) {
            var y = parseInt(iso[1], 10);
            var mo = parseInt(iso[2], 10);
            var d = parseInt(iso[3], 10);
            var h = iso[4] != null ? parseInt(iso[4], 10) : 12;
            var mi = iso[5] != null ? parseInt(iso[5], 10) : 0;
            var ts = parseWallClock(roleTz, y, mo, d, h, mi);
            if (ts) return { ok: true, atMs: ts };
            if (iso[4] == null) {
                return { ok: false, reason: 'missing_time' };
            }
            return { ok: false, reason: 'invalid' };
        }

        var tm = s.match(/^(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?$/);
        if (tm) {
            var tsOnly = parseTimeOnlyInRoleTz(parseInt(tm[1], 10), parseInt(tm[2], 10), roleTz, now);
            if (tsOnly) return { ok: true, atMs: tsOnly };
        }

        if (/^\d{13,}$/.test(s)) {
            var msNum = parseInt(s, 10);
            var msTs = finalizeScheduleTs(msNum);
            if (msTs) return { ok: true, atMs: msTs };
        }

        return { ok: false, reason: 'unrecognized' };
    }

    function findLastNextPushInner(src) {
        src = String(src || '');
        var patterns = [
            /<miyanextpush>([\s\S]*?)<\/miyanextpush\s*>/gi,
            /＜miyanextpush＞([\s\S]*?)＜\/miyanextpush＞/gi
        ];
        var last = '';
        var i;
        for (i = 0; i < patterns.length; i++) {
            var re = patterns[i];
            var m;
            while ((m = re.exec(src)) !== null) {
                if (m[1] != null) last = String(m[1]).trim();
            }
        }
        return last;
    }

    function extractNextPushFromReply(rawText, opts) {
        opts = opts || {};
        var roleTz = resolveRoleTz(opts.settings);
        var src = String(rawText || '');
        var inner = findLastNextPushInner(src);
        var stripped = stripNextPushTags(src);
        if (!inner) return { ok: false, stripped: stripped, foundTag: false };
        var parsed = parseNextPushContent(inner, Date.now(), roleTz);
        return {
            ok: !!parsed.ok,
            atMs: parsed.ok ? parsed.atMs : 0,
            raw: inner,
            stripped: stripped,
            foundTag: true,
            parseReason: parsed.reason || ''
        };
    }

    function buildFormatExample(roleTz, nowTs) {
        var aw = global.MiyaChatAwareness;
        nowTs = nowTs || Date.now();
        roleTz = roleTz || resolveRoleTz(null);
        if (aw && typeof aw.wallClockPartsInTz === 'function') {
            var p = aw.wallClockPartsInTz(nowTs + 2 * 3600000, roleTz);
            return (
                TAG_OPEN +
                p.year +
                '-' +
                pad2(p.month) +
                '-' +
                pad2(p.day) +
                ' ' +
                pad2(p.hour) +
                ':' +
                pad2(p.minute) +
                TAG_CLOSE
            );
        }
        return TAG_OPEN + '2026-06-29 20:30' + TAG_CLOSE;
    }

    function buildNextPushRulesBlock(contact, settings) {
        var roleName = String((contact && contact.name) || '角色');
        var roleTz = resolveRoleTz(settings);
        var aw = global.MiyaChatAwareness;
        var nowTs = Date.now();
        var lines = [
            '【让TA自己决定何时找你 · 强制末段】',
            '本单聊已开启「让TA自己决定何时找你」。你必须在完整输出 <thinking> → 正文气泡 → <miyavoice> 全部结束之后，',
            '另起一行输出且仅输出一行用户绝对不可见的调度块，格式严格如下：',
            TAG_OPEN + 'YYYY-MM-DD HH:mm' + TAG_CLOSE,
            '- 时间为' +
                roleName +
                '根据当前对话情景、人设、真实时间、行程与情绪，自行决定的下一次主动找用户发微信的时刻（角色本地时间，24 小时制）。',
            '- 必须写绝对时刻，格式严格 ' +
                TAG_OPEN +
                'YYYY-MM-DD HH:mm' +
                TAG_CLOSE +
                '；须结合下方【当前时刻参考】自行换算，且必须是未来时刻；禁止写「45分钟后」「3小时后」等相对时间，禁止写已过去的时刻。',
            '- 格式示例（仅示意结构，时间须自行决定且必须晚于【当前时刻参考】）：' + buildFormatExample(roleTz, nowTs),
            '- 【重要】用户中途发消息不会取消已安排；系统仅以你「最新一轮完整回复」末尾的 ' +
                TAG_OPEN +
                '…' +
                TAG_CLOSE +
                ' 覆盖旧安排。用户打断后若仍按原计划则原样写出原绝对时刻，若需调整则写出新的绝对时刻。',
            '- 一旦写入该块，系统会在约定时刻主动发消息；若用户当时不在线，之后进入页面仍会立刻补发这一次（静默时段除外），直到成功发出或被你的新调度块覆盖。',
            '- 若本轮决定今天不再主动，写 ' + TAG_OPEN + 'off' + TAG_CLOSE + '；否则本轮必须输出该调度块。',
            '- 该块不得出现在 <thinking>、正文或 <miyavoice> 内；必须写在全文最末尾；用户界面绝不显示；禁止在正文或思维链里用自然语言描述计划时间代替该块（思维链里写不算数，没有该块系统不会触发）。'
        ];
        var ta = settings && settings.timeAwareness;
        var bg = settings && settings.backgroundMessage;
        var scheduled = pickTs(bg && bg.lifeLikeNextPushAt);
        if (scheduled) {
            lines.push(
                '【当前已安排的下次主动时间】' +
                    (aw && typeof aw.formatFullDateTimeForTz === 'function'
                        ? aw.formatFullDateTimeForTz(scheduled, roleTz)
                        : formatNextPushForDebug(scheduled)) +
                    '（用户中途发消息不会取消；仅当你新一轮回复输出新块时才覆盖）'
            );
        }
        if (aw && typeof aw.formatFullDateTimeForTz === 'function') {
            lines.push('【当前时刻参考 · 角色本地(' + roleTz + ')】' + aw.formatFullDateTimeForTz(nowTs, roleTz));
        }
        if (!(ta && ta.enabled)) {
            lines.push(
                '- 本聊天未开启完整时间感知，但你仍须按上方【当前时刻参考】换算绝对时刻，禁止写已过去的时间。'
            );
        }
        return lines.join('\n');
    }

    function buildLifeLikeProactivePrompt(store, chatId, contact, settings, scheduledAt) {
        var nowTs = Date.now();
        var roleTz = resolveRoleTz(settings);
        var speakState = 'empty';
        if (global.MiyaChatBackground && typeof global.MiyaChatBackground.getTrailingSpeakerStateFromStore === 'function') {
            speakState = global.MiyaChatBackground.getTrailingSpeakerStateFromStore(store, chatId);
        } else if (store && chatId) {
            var msgs0 = store.getMessages(chatId) || [];
            var fmt0 = global.MiyaChatOnlineFormat;
            for (var s0 = msgs0.length - 1; s0 >= 0; s0--) {
                var r0 = msgs0[s0];
                if (!r0 || r0.deleted) continue;
                if (fmt0 && typeof fmt0.shouldOmitMessage === 'function' && fmt0.shouldOmitMessage(r0)) {
                    continue;
                }
                if (r0.role === 'user') {
                    speakState = 'user_spoke_last';
                    break;
                }
                if (r0.role === 'assistant') {
                    speakState = 'assistant_spoke_last';
                    break;
                }
            }
        }
        var lines = [
            '【本轮触发原因 · 自主找用户】',
            '到了你安排的主动联系时刻：须自然衔接上文历史中末尾几条消息，并兼顾每条真实发送时刻与间隔，像真人发微信。',
            global.MiyaChatBackground &&
            typeof global.MiyaChatBackground.buildProactiveContinueLeadHint === 'function'
                ? global.MiyaChatBackground.buildProactiveContinueLeadHint(speakState)
                : '衔接须基于对话最新状态。',
            '必须完整阅读上文全部对话（用户与你的消息均已按时间顺序注入）。'
        ];
        if (
            global.MiyaChatBackground &&
            typeof global.MiyaChatBackground.buildRecentChatTailDigest === 'function'
        ) {
            var tailDig = global.MiyaChatBackground.buildRecentChatTailDigest(
                store,
                chatId,
                settings,
                8
            );
            if (tailDig) lines.push(tailDig);
        }
        if (speakState === 'user_spoke_last') {
            var pendingBlock =
                global.MiyaChatBackground &&
                typeof global.MiyaChatBackground.buildPendingUserRoundLeadBlock === 'function'
                    ? global.MiyaChatBackground.buildPendingUserRoundLeadBlock(store, chatId, settings)
                    : '';
            if (pendingBlock) lines.push(pendingBlock);
        }
        lines.push(
            '内容自然、贴合人设与当下实际时刻；默认不要强调过了多久；禁止复读近期相同话题套路。',
            '仍须完整输出 <thinking> → 正文气泡 → <miyavoice> 三段式；结束后必须再输出 ' +
                TAG_OPEN +
                'YYYY-MM-DD HH:mm' +
                TAG_CLOSE +
                '（绝对时刻，禁止相对时间）决定下次何时再找用户。',
            '格式示例：' + buildFormatExample(roleTz, nowTs) + '（须比当前时刻更晚）'
        );
        var lastMsgTs = 0;
        var userLastTs = 0;
        var asstLastTs = 0;
        if (store && chatId) {
            var msgs =
                store.getMergedMessagesForApi && typeof store.getMergedMessagesForApi === 'function'
                    ? store.getMergedMessagesForApi(chatId) || []
                    : store.getMessagesForApi && typeof store.getMessagesForApi === 'function'
                      ? store.getMessagesForApi(chatId) || []
                      : store.getMessages(chatId) || [];
            for (var i = msgs.length - 1; i >= 0; i--) {
                var row = msgs[i];
                if (!row || row.deleted) continue;
                var t = pickTs(row.createdAt);
                if (!t) continue;
                if (!lastMsgTs) lastMsgTs = t;
                if (!userLastTs && row.role === 'user') userLastTs = t;
                if (!asstLastTs && row.role === 'assistant') asstLastTs = t;
                if (lastMsgTs && userLastTs && asstLastTs) break;
            }
        }
        if (
            global.MiyaChatBackground &&
            typeof global.MiyaChatBackground.buildProactiveActualTimeLines === 'function'
        ) {
            global.MiyaChatBackground.buildProactiveActualTimeLines(settings, nowTs, {
                scheduledTs: scheduledAt,
                lastMsgTs: lastMsgTs,
                userLastTs: userLastTs,
                assistantLastTs: asstLastTs
            }).forEach(function (line) {
                lines.push(line);
            });
        } else {
            var aw = global.MiyaChatAwareness;
            if (aw && typeof aw.formatFullDateTimeForTz === 'function') {
                lines.push(
                    '【你发送本条消息的实际时刻】' +
                        aw.formatFullDateTimeForTz(nowTs, roleTz) +
                        '（正文必须按此刻真实时间写作）'
                );
            }
        }
        if (
            speakState === 'assistant_spoke_last' &&
            global.MiyaChatBackground &&
            typeof global.MiyaChatBackground.buildRecentAssistantDigest === 'function'
        ) {
            var digest = global.MiyaChatBackground.buildRecentAssistantDigest(store, chatId, 8);
            if (digest) lines.push(digest);
        }
        if (global.MiyaChatBackground && typeof global.MiyaChatBackground.buildAntiRepeatProactiveRules === 'function') {
            lines.push(global.MiyaChatBackground.buildAntiRepeatProactiveRules());
        }
        if (speakState === 'assistant_spoke_last') {
            lines.push(
                '【衔接提醒】末条是你方发言：禁止把用户上一轮当成本轮必答；顺着上文末尾与时间间隔自然再发一条即可。'
            );
        } else if (speakState === 'user_spoke_last') {
            lines.push(
                '【衔接提醒】末条是用户发言：把末尾用户原文纳入自然衔接；勿抱怨「很久没回」「怎么还不理我」「还不告诉我」；禁止抛开末尾接旧话题。'
            );
        } else if (userLastTs && nowTs - userLastTs < 300000) {
            lines.push(
                '【衔接提醒】用户刚刚还在正常聊天（距用户上次发言不足5分钟）；勿抱怨「很久没回」「怎么还不理我」等，应自然续聊或换轻松话题。'
            );
        }
        return lines.join('\n');
    }

    function salvageNextPushFromStoredReply(rawText, settings) {
        return extractNextPushFromReply(rawText, { settings: settings });
    }

    function parseCnHourToken(token) {
        var map = {
            一: 1,
            二: 2,
            两: 2,
            三: 3,
            四: 4,
            五: 5,
            六: 6,
            七: 7,
            八: 8,
            九: 9,
            十: 10,
            十一: 11,
            十二: 12
        };
        return map[String(token || '').trim()] || 0;
    }

    function parseCnMinuteToken(token) {
        token = String(token || '').trim();
        if (!token) return 0;
        if (/^\d{1,2}$/.test(token)) return parseInt(token, 10);
        if (token === '半') return 30;
        if (/^十[一二三四五六七八九]?$/.test(token)) {
            return 10 + parseCnHourToken(token.slice(1) || '零');
        }
        var map = {
            零: 0,
            一: 1,
            二: 2,
            两: 2,
            三: 3,
            四: 4,
            五: 5,
            六: 6,
            七: 7,
            八: 8,
            九: 9,
            十: 10,
            十一: 11,
            十二: 12,
            十三: 13,
            十四: 14,
            十五: 15,
            十六: 16,
            十七: 17,
            十八: 18,
            十九: 19,
            二十: 20,
            二十一: 21,
            二十二: 22,
            二十三: 23,
            二十四: 24,
            二十五: 25,
            二十六: 26,
            二十七: 27,
            二十八: 28,
            二十九: 29,
            三十: 30,
            三十一: 31,
            三十二: 32,
            三十三: 33,
            三十四: 34,
            三十五: 35,
            三十六: 36,
            三十七: 37,
            三十八: 38,
            三十九: 39,
            四十: 40,
            四十五: 45,
            五十: 50,
            五十五: 55
        };
        if (map[token] != null) return map[token];
        var combo = token.match(/^([二三四五六])十([一二三四五六七八九])?$/);
        if (combo) {
            var tens = { 二: 20, 三: 30, 四: 40, 五: 50, 六: 60 }[combo[1]] || 0;
            return tens + parseCnHourToken(combo[2] || '零');
        }
        return 0;
    }

    function trySalvageThinkingSchedule(text, roleTz, now) {
        var src = String(text || '');
        if (!src) return null;
        var scope = src;
        var thinkingMatch = src.match(/<thinking>([\s\S]*?)<\/thinking>/i);
        if (thinkingMatch) scope = thinkingMatch[1];
        if (!/(主动|找你|发(?:消息|微信|条)?|下次|约在|定时|提醒)/.test(scope)) return null;
        if (findLastNextPushInner(scope)) return null;
        var m = scope.match(/(\d{1,2})\s*[点:：]\s*(\d{1,2})/);
        if (m) {
            var atMsNum = parseTimeOnlyInRoleTz(parseInt(m[1], 10), parseInt(m[2], 10), roleTz, now);
            if (atMsNum) return { ok: true, atMs: atMsNum, source: 'thinking_time' };
        }
        var cn = scope.match(
            /(一|二|两|三|四|五|六|七|八|九|十|十一|十二)\s*点\s*(半|[一二两三四五六七八九十]{1,3}|\d{1,2})/
        );
        if (cn) {
            var hour = parseCnHourToken(cn[1]);
            var minute = parseCnMinuteToken(cn[2]);
            if (hour > 0 && minute >= 0 && minute < 60) {
                var atMsCn = parseTimeOnlyInRoleTz(hour, minute, roleTz, now);
                if (atMsCn) return { ok: true, atMs: atMsCn, source: 'thinking_time_cn' };
            }
        }
        return null;
    }

    function salvageNextPushFromChat(chat, settings) {
        if (!chat) return { ok: false };
        var roleTz = resolveRoleTz(settings);
        var now = Date.now();
        var sources = [];
        if (chat.lastRawAssistantReply) sources.push(String(chat.lastRawAssistantReply));
        if (chat.activeThinking) sources.push(String(chat.activeThinking));
        var i;
        var seen = {};
        for (i = 0; i < sources.length; i++) {
            var src = sources[i];
            if (!src || seen[src]) continue;
            seen[src] = true;
            var hit = salvageNextPushFromStoredReply(src, settings);
            if (hit && hit.ok && pickTs(hit.atMs)) return hit;
            if (hit && hit.ok && hit.atMs === 0) return hit;
            var thinkingHit = trySalvageThinkingSchedule(src, roleTz, now);
            if (thinkingHit && pickTs(thinkingHit.atMs)) return thinkingHit;
        }
        return { ok: false };
    }

    function normalizeLifeLikeFields(bg) {
        bg = bg || {};
        bg.lifeLikeEnabled = !!bg.lifeLikeEnabled;
        var nextPush = pickTs(bg.lifeLikeNextPushAt);
        if (!nextPush) nextPush = pickTs(bg.lifeLikeNextCheckAt);
        bg.lifeLikeNextPushAt = nextPush;
        if (!Number.isFinite(Number(bg.lifeLikeEnabledAt))) bg.lifeLikeEnabledAt = 0;
        delete bg.lifeLikeNextCheckAt;
        delete bg.lifeLikeClinginess;
        delete bg.lifeLikeSchedule;
        delete bg.lifeLikeDailyCap;
        delete bg.lifeLikeDailyCount;
        delete bg.lifeLikeDailyCountDate;
        return bg;
    }

    function formatNextPushForDebug(atMs) {
        if (!atMs) return 'off';
        try {
            return new Date(atMs).toLocaleString();
        } catch (e) {
            return String(atMs);
        }
    }

    global.MiyaChatLifeLike = {
        isEnabled: isEnabled,
        stripNextPushTags: stripNextPushTags,
        extractNextPushFromReply: extractNextPushFromReply,
        salvageNextPushFromStoredReply: salvageNextPushFromStoredReply,
        salvageNextPushFromChat: salvageNextPushFromChat,
        buildNextPushRulesBlock: buildNextPushRulesBlock,
        buildLifeLikeProactivePrompt: buildLifeLikeProactivePrompt,
        normalizeLifeLikeFields: normalizeLifeLikeFields,
        formatNextPushForDebug: formatNextPushForDebug,
        TAG_OPEN: TAG_OPEN,
        TAG_CLOSE: TAG_CLOSE
    };
})(window);
