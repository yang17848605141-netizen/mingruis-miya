(function (global) {
    'use strict';

    /** 角色线上输出协议（仅半角「类型-内容」，每行一条气泡） */
    var RE_QUOTE = /^引用[-－—]\s*(.+)$/;
    var RE_VOICE = /^语音[-－—]\s*(.+)$/;
    var RE_STICKER = /^表情包[-－—]\s*(.+)$/;
    var RE_IMAGE = /^图片[-－—]\s*(.+)$/;
    var RE_LOCATION = /^位置[-－—]\s*(.+)$/;
    var RE_TRANSFER = /^转账[-－—]\s*(.+)$/;
    var RE_TRANSFER_RECEIPT = /^转账回执[-－—]\s*(.+)$/;
    var RE_TAKEOUT = /^外卖[-－—]\s*(.+)$/;
    var RE_GIFT = /^送礼[-－—]\s*(.+)$/;
    var RE_GROUP_RED_PACKET = /^红包[-－—](拼手气|专属)[-－—](.+)$/;
    var RE_LOVE_POEM = /^情诗[-－—]\s*(.+)$/;
    var RE_RECALL = /^撤回[-－—]\s*(.+)$/;
    /** 旁白行：标准「旁白-」；兼容模型常错写的「旁-」及冒号分隔 */
    var RE_NARRATION = /^旁(?:白)?\s*[-－—：:]\s*(.+)$/;
    var RE_ROLE_CALL_VOICE = /^发起语音通话\s*[。．.!！?？…~～]*$/;
    var RE_ROLE_CALL_VIDEO = /^发起视频通话\s*[。．.!！?？…~～]*$/;
    var RE_LEGACY_CALL_VOICE = /^【拨打语音电话】\s*$/;
    var RE_LEGACY_CALL_VIDEO = /^【拨打视频电话】\s*$/;
    var RE_TRANSLATION = /^译文[-－—：:]\s*(.+)$/;
    var RE_ROLE_MOMENTS_POST = /^【发朋友圈[：:]\s*([\s\S]*?)】$/;
    var RE_SWAP_CHAR_AVATAR = /^换头像[-－—：:]\s*(.+)$/;
    var RE_SWAP_USER_AVATAR = /^给用户换头像[-－—：:]\s*(.+)$/;
    var RE_LOCATION_SPLIT = /[|｜]/;
    var RE_TRANSFER_SPLIT = /[|｜]/;
    var TRANSFER_STATUS_WORDS = {
        待收: 1,
        已收: 1,
        已退: 1,
        待确认: 1,
        已汇出: 1,
        已发出: 1
    };

    function trim(s) {
        return String(s || '').trim();
    }

    function stripApiTimelinePrefix(text) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
            return aw.stripTimelinePrefixForDisplay(text);
        }
        return trim(text);
    }

    function stripQuotePromptLeakage(text) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.stripQuotePromptLeakage === 'function') {
            return aw.stripQuotePromptLeakage(text);
        }
        return trim(text);
    }

    function normalizeQuoteText(text) {
        return stripQuotePromptLeakage(stripApiTimelinePrefix(text)).slice(0, 200);
    }

    /** 剥掉模型泄漏的 Markdown 强调/列表星号，避免气泡末尾残留孤立 * */
    function stripOrphanMarkdownEmphasis(text) {
        var s = trim(text);
        if (!s) return '';
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
        s = s.replace(/\*([^*\n]+)\*/g, '$1');
        s = s.replace(/^\*\s+/, '');
        s = s.replace(/\s*\*+$/g, '').trim();
        return s;
    }

    /** 从右向左找分隔符，拆成「摘抄 + 回复」（摘抄内可含同类符号；分隔符按数组顺序优先匹配） */
    function splitAtLastSeparator(raw, separators) {
        var s = trim(raw);
        if (!s) return null;
        var i;
        for (i = 0; i < separators.length; i++) {
            var sep = separators[i];
            var idx = s.lastIndexOf(sep);
            if (idx <= 0) continue;
            var quotedText = trim(s.slice(0, idx));
            var replyText = trim(s.slice(idx + sep.length));
            if (quotedText && replyText) return { quotedText: quotedText, replyText: replyText };
        }
        return null;
    }

    /** 仅从摘抄与首条回复之间找分界（固定分隔符：冒号、破折号、竖线、分号等） */
    function splitQuoteReplyBoundary(body) {
        var raw = trim(body);
        if (!raw) return null;
        var result = splitAtLastSeparator(raw, ['：', ':']);
        if (result) return result;
        result = splitAtLastSeparator(raw, ['——', '—', '–', '→', '=>', '->', '｜', '|', '；', ';']);
        return result || null;
    }

    /** 回复段起始的类型前缀（用于从引用行拆出「摘抄 + 回复」） */

    /** 引用摘抄若为「语音-内容」，展示/匹配时剥掉前缀，保留原文供 msgType 判断 */
    function normalizeQuotedSourceText(text) {
        var t = normalizeQuoteText(text);
        var vm = t.match(RE_VOICE);
        if (vm) return normalizeQuoteText(vm[1]);
        return t;
    }

    function stickerNameFromQuoteText(text) {
        var t = trim(text);
        if (!t) return '';
        var stk = t.match(RE_STICKER);
        if (stk) return trim(stk[1]);
        if (t.indexOf('[表情]') === 0) return trim(t.replace(/^\[表情\]\s*/, ''));
        return t;
    }

    function messageMatchesQuoteRef(row, quoteRef, getBody) {
        if (!row || row.deleted || !quoteRef) return false;
        var qt = trim(quoteRef.text);
        if (!qt) return false;
        if (quoteRef.dir === 'out' && row.role !== 'user') return false;
        if (quoteRef.dir === 'in' && row.role === 'user') return false;

        var body = typeof getBody === 'function' ? trim(getBody(row)) : trim(row.content);
        if (body === qt) return true;

        if (row.type === 'sticker') {
            var qName = trim(quoteRef.stickerName) || stickerNameFromQuoteText(qt);
            var rowName = trim(row.stickerName) || stickerNameFromQuoteText(body);
            if (qName && rowName) {
                if (qName === rowName) return true;
                if (qName.toLowerCase() === rowName.toLowerCase()) return true;
            }
            if (qName && qt.indexOf('表情包') === 0 && qt === '表情包-' + qName) return true;
            if (rowName && qt === '表情包-' + rowName) return true;
            if (rowName && qt === '[表情] ' + rowName) return true;
        }

        if ((qt === '[图片]' || qt.indexOf('图片') === 0) && row.type === 'image' && row.imageDataKey) {
            return true;
        }

        return false;
    }

    function buildQuoteRefFromPending(pending) {
        var raw = trim(pending);
        if (!raw) return null;
        var stk = raw.match(RE_STICKER);
        if (stk) {
            var stickerName = trim(stk[1]);
            var ref = {
                dir: 'out',
                text: stickerName,
                msgType: 'sticker',
                stickerName: stickerName
            };
            var st = global.miyaChatStore;
            if (st) {
                var hit = resolveStickerWithFallback(stickerName, collectStickerCatalogAll(st));
                if (hit) {
                    ref.stickerBlobId = hit.blobId || '';
                    ref.stickerUrl = hit.url || '';
                    ref.stickerName = hit.name;
                }
            }
            return ref;
        }
        var ref = { dir: 'out', text: normalizeQuotedSourceText(raw) };
        if (RE_VOICE.test(raw)) ref.msgType = 'voice';
        return ref;
    }

    function isQuoteEchoVoiceLine(pending, voiceText) {
        if (!pending) return false;
        return normalizeQuotedSourceText(pending) === trim(voiceText);
    }

    /** 语音行后若紧跟普通文字回复（非类型前缀），拆成「语音-」行 + 正文行 */
    function splitVoiceLinePlainTail(raw) {
        var line = trim(raw);
        if (!line) return [line];
        var vm = line.match(RE_VOICE);
        if (!vm) return [line];
        var inner = trim(vm[1]);
        if (!inner || inner.indexOf(' ') < 0) return [line];
        var tail = inner.match(/^(.+?)\s+(?!(?:引用|语音|表情包|图片|位置|转账|外卖|送礼|旁(?:白)?)\s*[-－—])(.+)$/);
        if (!tail || !trim(tail[2])) return [line];
        return ['语音-' + trim(tail[1]), trim(tail[2])];
    }

    /** 引用行正文拆成「被引内容 + 回复段」（摘抄内可含 语音- 等，不误拆） */
    function splitQuoteBodyFromReply(quoteBody) {
        var body = trim(quoteBody);
        if (!body) return null;
        var boundary = splitQuoteReplyBoundary(body);
        if (boundary) return boundary;
        var voiceQuoted = body.match(/^语音[-－—]\s*(.+)$/);
        if (voiceQuoted) {
            var voiceInner = trim(voiceQuoted[1]);
            var voiceTail = voiceInner.match(/^(.+?)\s+(?!(?:引用|语音|表情包|图片|位置|转账|外卖|送礼|旁(?:白)?)\s*[-－—])(.+)$/);
            if (voiceTail && trim(voiceTail[2])) {
                return {
                    quotedText: '语音-' + trim(voiceTail[1]),
                    replyText: trim(voiceTail[2])
                };
            }
            return { quotedText: body, replyText: '' };
        }
        var typedReply = body.match(/^(.+?)\s+(?=(?:语音|表情包|图片|位置|转账|外卖|送礼|旁(?:白)?)\s*[-－—])/);
        if (typedReply) {
            return {
                quotedText: trim(typedReply[1]),
                replyText: trim(body.slice(typedReply[1].length))
            };
        }
        return null;
    }

    function splitNonQuoteCollapsedSegments(raw) {
        var hits = raw.match(
            /(?:引用|语音|旁(?:白)?|表情包|图片|位置|转账|转账回执|外卖|送礼|换头像|给用户换头像|发起语音通话|发起视频通话)\s*[-－—：:]/g
        );
        if (!hits || hits.length < 2) return splitVoiceLinePlainTail(raw);
        var parts = raw.split(RE_SPLIT_ONLINE_TYPE_PREFIX).map(trim).filter(Boolean);
        if (parts.length <= 1) return splitVoiceLinePlainTail(raw);
        var out = [];
        parts.forEach(function (part) {
            splitVoiceLinePlainTail(part).forEach(function (line) {
                if (line) out.push(line);
            });
        });
        return out.length ? out : [raw];
    }

    /** 引用行拆出后的回复段：仅按换行拆成多条气泡（一行一气泡） */
    function splitQuotedReplyLines(text) {
        var raw = trim(text);
        if (!raw) return [];
        if (raw.indexOf('\n') >= 0) {
            return raw
                .split(/\n/)
                .map(trim)
                .filter(Boolean);
        }
        return [raw];
    }

    function stripLineForQuoteCompare(line) {
        return stripApiTimelinePrefix(trim(line)).replace(/\s*⧗\s*$/g, '').trim();
    }

    /** 把「引用-摘抄 回复…」单行展开为多行，并跳过模型重复输出的后续相同行 */
    function expandArrQuoteLines(lines) {
        var arr = Array.isArray(lines) ? lines : [];
        var out = [];
        var i = 0;
        while (i < arr.length) {
            var line = arr[i];
            var raw = stripLineForQuoteCompare(line);
            var qo = raw.match(RE_QUOTE);
            if (qo && qo[1] != null) {
                var boundary = splitQuoteReplyBoundary(qo[1]);
                if (boundary) {
                    var replyParts = splitQuotedReplyLines(boundary.replyText);
                    out.push('引用-' + boundary.quotedText);
                    replyParts.forEach(function (part) {
                        out.push(part);
                    });
                    var skip = 0;
                    while (i + 1 + skip < arr.length && skip < replyParts.length) {
                        if (stripLineForQuoteCompare(arr[i + 1 + skip]) === trim(replyParts[skip])) {
                            skip++;
                        } else {
                            break;
                        }
                    }
                    if (skip >= replyParts.length && skip > 0) {
                        i += 1 + skip;
                        continue;
                    }
                    i++;
                    continue;
                }
            }
            out.push(line);
            i++;
        }
        return out;
    }

    /** @deprecated 展示层兼容；解析请用 splitQuoteReplyBoundary + splitQuotedReplyLines */
    function splitInlineQuoteSuffix(body) {
        return splitQuoteReplyBoundary(body);
    }

    /** 正文为省略号占位时，尝试从 quoteRef 摘抄里拆出真实回复 */
    function recoverQuoteReplyFields(text, quoteRef) {
        if (!quoteRef || quoteRef.text == null) {
            return { text: text, quoteRef: quoteRef };
        }
        var bodyText = trim(text);
        var qrText = trim(quoteRef.text);
        if (!qrText) return { text: text, quoteRef: quoteRef };
        var needRecover =
            !bodyText ||
            isQuoteParsePlaceholderContent(bodyText) ||
            bodyText === qrText;
        if (!needRecover) return { text: text, quoteRef: quoteRef };
        var recovered = splitQuoteReplyBoundary(qrText);
        if (!recovered) return { text: text, quoteRef: quoteRef };
        return {
            text: trim(recovered.replyText),
            quoteRef: Object.assign({}, quoteRef, {
                text: normalizeQuoteText(recovered.quotedText)
            })
        };
    }

    function isQuoteParsePlaceholderContent(text) {
        var t = trim(text);
        return t === '…' || t === '...' || t === '⋯';
    }

    function pushCatalogItems(packs, out, seen) {
        (packs || []).forEach(function (pk) {
            (pk.items || []).forEach(function (it) {
                var name = trim(it.name);
                if (!name || seen[name]) return;
                seen[name] = true;
                out.push({
                    name: name,
                    blobId: it.blobId || '',
                    url: it.url || '',
                    packName: pk.name || ''
                });
            });
        });
    }

    /** 角色 AI 白名单：仅全局分组 + 绑定该角色的分组 */
    function collectStickerCatalog(st, contactId) {
        if (!st || typeof st.getEmojiPacks !== 'function') return [];
        var out = [];
        var seen = {};
        var packs =
            contactId && typeof st.getEmojiPacksForContact === 'function'
                ? st.getEmojiPacksForContact(contactId)
                : st.getEmojiPacks();
        pushCatalogItems(packs, out, seen);
        return out;
    }

    /** 用户发送 / 渲染解析：全部表情包（不受角色绑定限制） */
    function collectStickerCatalogAll(st) {
        if (!st || typeof st.getEmojiPacks !== 'function') return [];
        var out = [];
        var seen = {};
        pushCatalogItems(st.getEmojiPacks(), out, seen);
        return out;
    }

    function resolveStickerByName(name, catalog) {
        var key = trim(name);
        if (!key || !catalog || !catalog.length) return null;
        var exact = catalog.find(function (x) {
            return x.name === key;
        });
        if (exact) return exact;
        var lower = key.toLowerCase();
        return (
            catalog.find(function (x) {
                return x.name.toLowerCase() === lower;
            }) || null
        );
    }

    function resolveStickerWithFallback(stickerName, catalog) {
        var hit = resolveStickerByName(stickerName, catalog);
        if (hit) return hit;
        var st = global.miyaChatStore;
        if (!st) return null;
        return resolveStickerByName(stickerName, collectStickerCatalogAll(st));
    }

    function buildStickerFields(stickerName, catalog, pending) {
        var name = trim(stickerName);
        if (!name) return null;
        var hit = resolveStickerWithFallback(name, catalog);
        var sf = {
            type: 'sticker',
            content: '表情包-' + (hit ? hit.name : name),
            stickerName: hit ? hit.name : name,
            stickerBlobId: hit ? hit.blobId || '' : '',
            stickerUrl: hit ? hit.url || '' : ''
        };
        if (pending) {
            sf.quoteRef = buildQuoteRefFromPending(pending);
        }
        return sf;
    }

    function extractStickerNameFromMessage(m) {
        if (!m) return '';
        if (m.type === 'sticker') return trim(m.stickerName);
        var t = stripApiTimelinePrefix(trim(m.content));
        var stk = t.match(RE_STICKER);
        return stk ? trim(stk[1]) : '';
    }

    function isUnknownStickerMessage(m) {
        if (!m || m.deleted) return false;
        var name = extractStickerNameFromMessage(m);
        if (!name) return false;
        if (m.stickerBlobId || m.stickerUrl) return false;
        var st = global.miyaChatStore;
        if (!st) return true;
        return !resolveStickerByName(name, collectStickerCatalogAll(st));
    }

    function isUnknownStickerLine(line, catalog) {
        var raw = stripApiTimelinePrefix(trim(line));
        var stk = raw.match(RE_STICKER);
        if (!stk) return false;
        return !resolveStickerByName(trim(stk[1]), catalog || []);
    }

    function parseLocationBody(body) {
        var raw = trim(body);
        if (!raw) return null;
        var parts = raw.split(RE_LOCATION_SPLIT);
        var name = trim(parts[0]);
        if (!name) return null;
        var address = parts.length > 1 ? trim(parts.slice(1).join('｜')) : '';
        return { name: name.slice(0, 80), address: address.slice(0, 240) };
    }

    function formatLocationApiLine(card) {
        if (!card || !trim(card.name)) return '';
        var line = '位置-' + trim(card.name);
        var addr = trim(card.address);
        if (addr) line += '｜' + addr;
        return line;
    }

    function parseTransferBody(body) {
        var raw = trim(body);
        if (!raw) return null;
        var parts = raw.split(RE_TRANSFER_SPLIT).map(function (x) {
            return trim(x);
        });
        var amount = parseFloat(parts[0]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var noteParts = parts.slice(1);
        if (noteParts.length && TRANSFER_STATUS_WORDS[noteParts[noteParts.length - 1]]) {
            noteParts.pop();
        }
        var note = noteParts.join('｜').slice(0, 120);
        return { amount: Math.round(amount * 100) / 100, note: note };
    }

    function transferStatusLabel(rp) {
        if (!rp) return '';
        var dir = rp.dir === 'in' ? 'in' : 'out';
        var st = trim(rp.status) || 'pending';
        if (dir === 'out') {
            if (st === 'accepted') return '已收';
            if (st === 'refunded') return '已退';
            if (st === 'pending') return '待确认';
            if (st === 'sent' || st === 'completed') return '已汇出';
            return '待确认';
        }
        if (st === 'accepted') return '已收';
        if (st === 'refunded') return '已退';
        return '待收';
    }

    function formatTransferApiLine(rp) {
        if (!rp || !(Number(rp.amount) > 0)) return '';
        var line = '转账-' + rp.amount;
        line += '｜' + (trim(rp.note) || '（无附言）');
        var label = transferStatusLabel(rp);
        if (label) line += '｜' + label;
        return line;
    }

    function parseTakeoutBody(body) {
        var raw = trim(body);
        if (!raw) return null;
        var parts = raw.split(RE_LOCATION_SPLIT).map(function (x) {
            return trim(x);
        });
        var shop = trim(parts[0]);
        if (!shop) return null;
        var items = parts.length > 1 ? trim(parts[1]) : '';
        if (!items) return null;
        var amount = parseFloat(parts[2]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var note = parts.length > 3 ? trim(parts.slice(3).join('｜')) : '';
        return {
            shop: shop.slice(0, 60),
            items: items.slice(0, 400),
            amount: Math.round(amount * 100) / 100,
            note: note.slice(0, 200)
        };
    }

    function formatTakeoutApiLine(od) {
        if (!od || !trim(od.shop)) return '';
        var line = '外卖-' + trim(od.shop);
        line += '｜' + (trim(od.items) || '（未注明）');
        line += '｜' + (Number(od.amount) > 0 ? od.amount : 0);
        line += '｜' + (trim(od.note) || '（无备注）');
        return line;
    }

    function takeoutNoteFromContent(content) {
        var lines = String(content || '').split(/\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var m = trim(lines[i]).match(/^外卖备注[-－—]\s*(.+)$/);
            if (m) return trim(m[1]).slice(0, 200);
        }
        return '';
    }

    function firstTakeoutParsedFromContent(content) {
        var lines = String(content || '').split(/\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var ln = trim(lines[i]);
            var hit = ln.match(RE_TAKEOUT);
            if (hit) return parseTakeoutBody(hit[1]);
        }
        return null;
    }

    function resolveTakeoutOrderFromMessage(m) {
        if (!m) return null;
        var od = m.takeoutOrder && typeof m.takeoutOrder === 'object' ? m.takeoutOrder : null;
        var parsed = firstTakeoutParsedFromContent(m.content);
        var noteExtra = takeoutNoteFromContent(m.content);
        if (!od && !parsed) return null;
        var shop = trim((od && od.shop) || (parsed && parsed.shop) || '');
        if (!shop) return parsed || od;
        return {
            shop: shop,
            items: trim((od && od.items) || (parsed && parsed.items) || ''),
            amount:
                Number(od && od.amount) > 0
                    ? Number(od.amount)
                    : parsed && parsed.amount
                      ? parsed.amount
                      : 0,
            note: trim((od && od.note) || noteExtra || (parsed && parsed.note) || ''),
            status: (od && od.status) || 'ordered'
        };
    }

    /** 写入 API / 上下文的完整外卖单（备注在第 4 段，不重复输出） */
    function formatTakeoutForApi(od) {
        return formatTakeoutApiLine(od);
    }

    function isTakeoutMessage(m) {
        if (!m || m.deleted) return false;
        if (m.type === 'takeout') return true;
        if (m.takeoutOrder && trim(m.takeoutOrder.shop)) return true;
        return !!firstTakeoutParsedFromContent(m.content);
    }

    function normalizeTakeoutFields(m) {
        var fromContent = firstTakeoutParsedFromContent(m && m.content);
        var hasOrder = m && m.takeoutOrder && trim(m.takeoutOrder.shop);
        if (!fromContent && !hasOrder) return null;
        if (!fromContent && hasOrder) {
            return { type: 'text', takeoutOrder: null, content: trim(m.content) };
        }
        var resolved = resolveTakeoutOrderFromMessage(m);
        if (!resolved || !trim(resolved.shop)) return null;
        var apiLine = formatTakeoutForApi(resolved);
        if (!apiLine) return null;
        return {
            type: 'takeout',
            takeoutOrder: {
                shop: resolved.shop,
                items: resolved.items || '',
                amount: resolved.amount || 0,
                note: resolved.note || '',
                status: (m.takeoutOrder && m.takeoutOrder.status) || resolved.status || 'ordered'
            },
            content: apiLine
        };
    }

    function isGiftMessage(m) {
        if (!m || m.deleted) return false;
        if (m.type === 'gift') return true;
        if (m.giftParcel && Array.isArray(m.giftParcel.items) && m.giftParcel.items.length) return true;
        return !!firstGiftParsedFromContent(m.content);
    }

    function normalizeGiftFields(m) {
        var fromContent = firstGiftParsedFromContent(m && m.content);
        var hasParcel = m && m.giftParcel && Array.isArray(m.giftParcel.items) && m.giftParcel.items.length;
        if (!fromContent && !hasParcel) return null;
        if (!fromContent && hasParcel) {
            return { type: 'text', giftParcel: null, content: trim(m.content) };
        }
        var resolved = resolveGiftParcelFromMessage(m);
        if (!resolved || !resolved.items || !resolved.items.length) return null;
        var apiLine = formatGiftForApi(resolved);
        return {
            type: 'gift',
            giftParcel: resolved,
            content: apiLine || '[礼品] ' + trim(resolved.items[0].name || '礼品')
        };
    }

    /**
     * 根据正文（含手动编辑）推断 type 与结构化字段；无法匹配特殊格式时清除旧卡片字段。
     */
    function inferFieldsFromContent(m, contentOverride) {
        if (!m) return null;
        var content = stripApiTimelinePrefix(trim(contentOverride != null ? contentOverride : m.content));
        if (m.role === 'assistant') {
            var eng = global.miyaChatEngine;
            if (eng && typeof eng.stripThinkingForApi === 'function') {
                content = eng.stripThinkingForApi(content);
            }
        }
        if (!content) return { type: 'text', content: '' };

        var st = global.miyaChatStore;
        var catalog = st ? collectStickerCatalogAll(st) : [];
        var lines = content.split(/\n/).map(trim).filter(Boolean);
        var parseLine = lines.length === 1 ? lines[0] : content;
        if (lines.length > 1) {
            var li;
            for (li = 0; li < lines.length; li++) {
                if (/^(?:外卖|送礼|情诗|位置|转账|语音|表情包|图片|红包)[-－—]/.test(lines[li])) {
                    parseLine = lines[li];
                    break;
                }
            }
        }

        var parsed = parseRoleOutputLine(parseLine, catalog, null);
        var patch = {
            type: 'text',
            content: content,
            takeoutOrder: null,
            giftParcel: null,
            lovePoem: null,
            locationCard: null,
            redPacket: null,
            groupRedPacket: null,
            voiceText: '',
            stickerBlobId: '',
            stickerUrl: '',
            stickerName: '',
            imageDataKey: '',
            imageKind: '',
            imageVisionText: ''
        };

        if (parsed && parsed.fields) {
            var f = parsed.fields;
            patch.type = f.type || 'text';
            patch.content = f.content || content;
            if (f.type === 'voice') {
                patch.voiceText = f.voiceText || trim(parseLine.replace(/^语音[-－—]\s*/, ''));
            } else if (f.type === 'sticker') {
                patch.stickerBlobId = f.stickerBlobId || '';
                patch.stickerUrl = f.stickerUrl || '';
                patch.stickerName = f.stickerName || '';
            } else if (f.type === 'image') {
                patch.type = 'image';
                patch.imageKind = f.imageKind || 'text';
            } else if (f.type === 'location' && f.locationCard) {
                patch.locationCard = f.locationCard;
            } else if (f.type === 'transfer' && f.redPacket) {
                var prevRp = m.redPacket && typeof m.redPacket === 'object' ? m.redPacket : null;
                patch.redPacket = Object.assign({}, f.redPacket, {
                    status: (prevRp && prevRp.status) || f.redPacket.status || 'pending',
                    dir: (prevRp && prevRp.dir) || f.redPacket.dir || (m.role === 'assistant' ? 'in' : 'out'),
                    resolvedAt: (prevRp && prevRp.resolvedAt) || 0,
                    walletHeld: !!(prevRp && prevRp.walletHeld),
                    walletSettled: !!(prevRp && prevRp.walletSettled)
                });
            } else if (f.type === 'takeout' && f.takeoutOrder) {
                patch.takeoutOrder = Object.assign({}, f.takeoutOrder, {
                    status: (m.takeoutOrder && m.takeoutOrder.status) || f.takeoutOrder.status || 'ordered'
                });
            } else if (f.type === 'gift' && f.giftParcel) {
                patch.giftParcel = f.giftParcel;
            } else if (f.type === 'love_poem' && f.lovePoem) {
                patch.lovePoem = f.lovePoem;
            } else if (f.type === 'group_red_packet' && f.groupRedPacket) {
                var grpRpInf = global.MiyaChatGroupRedPacket;
                if (grpRpInf && typeof grpRpInf.resolveMessageGroupRedPacket === 'function') {
                    patch.groupRedPacket = grpRpInf.resolveMessageGroupRedPacket({
                        content: content,
                        groupRedPacket: m.groupRedPacket || null
                    });
                    if (!patch.groupRedPacket) patch.groupRedPacket = f.groupRedPacket;
                } else {
                    patch.groupRedPacket = f.groupRedPacket;
                }
            }
            return patch;
        }

        var toPatch = normalizeTakeoutFields(Object.assign({}, m, { content: content }));
        if (toPatch) return Object.assign(patch, toPatch);
        var gpPatch = normalizeGiftFields(Object.assign({}, m, { content: content }));
        if (gpPatch) return Object.assign(patch, gpPatch);
        var lpPatch = normalizeLovePoemFields(Object.assign({}, m, { content: content }));
        if (lpPatch) return Object.assign(patch, lpPatch);

        if (m.type === 'voice' || /^语音[-－—]/.test(content)) {
            patch.type = 'voice';
            patch.voiceText = content.replace(/^语音[-－—]\s*/, '');
            patch.content = '语音-' + patch.voiceText;
            return patch;
        }

        return patch;
    }

    function buildEditPatchFromContent(msg, text) {
        var inferred = inferFieldsFromContent(msg, text);
        if (!inferred) return { content: trim(text), edited: true };
        var patch = Object.assign({ edited: true }, inferred);
        if (patch.type === 'voice' && patch.voiceText) {
            patch.content = '语音-' + patch.voiceText;
        }
        return patch;
    }

    function formatTakeoutFromMessage(m) {
        return formatTakeoutForApi(resolveTakeoutOrderFromMessage(m));
    }

    function parseGiftBody(body) {
        var raw = trim(body);
        if (!raw) return null;
        var parts = raw.split(RE_LOCATION_SPLIT).map(function (x) {
            return trim(x);
        });
        var name = trim(parts[0]);
        if (!name) return null;
        var qty = Math.max(1, Math.min(99, Math.round(parseFloat(parts[1]) || 1)));
        var note = '';
        var amount = 0;
        if (parts.length >= 4) {
            var legacyAmt = parseFloat(parts[2]);
            if (Number.isFinite(legacyAmt) && legacyAmt > 0) {
                amount = Math.round(legacyAmt * 100) / 100;
            }
            note = trim(parts.slice(3).join('｜'));
        } else {
            note = parts.length > 2 ? trim(parts.slice(2).join('｜')) : '';
        }
        return {
            name: name.slice(0, 80),
            qty: qty,
            amount: amount,
            note: note.slice(0, 200)
        };
    }

    function parseLovePoemBody(body) {
        var raw = trim(body);
        if (!raw) return null;
        var parts = raw.split(RE_LOCATION_SPLIT).map(function (x) {
            return trim(x);
        });
        var style = trim(parts[0]);
        if (!style) return null;
        var title = parts.length > 1 ? trim(parts[1]) : '（无题）';
        if (!title) title = '（无题）';
        var contentRaw = parts.length > 2 ? trim(parts.slice(2).join('｜')) : '';
        if (!contentRaw) return null;
        var lines = contentRaw
            .split(/\s*\/\s*/)
            .map(trim)
            .filter(Boolean);
        if (!lines.length) lines = [contentRaw.slice(0, 600)];
        return {
            style: style.slice(0, 40),
            title: title.slice(0, 60),
            lines: lines.map(function (ln) {
                return ln.slice(0, 200);
            }).slice(0, 12)
        };
    }

    function formatLovePoemForApi(lp) {
        if (!lp || !Array.isArray(lp.lines) || !lp.lines.length) return '';
        var style = trim(lp.style) || '情诗';
        var title = trim(lp.title) || '（无题）';
        var body = lp.lines.map(trim).filter(Boolean).join('/');
        if (!body) return '';
        return '情诗-' + style + '｜' + title + '｜' + body;
    }

    function resolveLovePoemFromMessage(m) {
        if (!m) return null;
        if (m.lovePoem && Array.isArray(m.lovePoem.lines) && m.lovePoem.lines.length) {
            return {
                style: trim(m.lovePoem.style) || '情诗',
                title: trim(m.lovePoem.title) || '（无题）',
                lines: m.lovePoem.lines.map(trim).filter(Boolean)
            };
        }
        var hit = trim(m.content).match(RE_LOVE_POEM);
        if (hit) return parseLovePoemBody(hit[1]);
        return null;
    }

    function firstLovePoemParsedFromContent(content) {
        var lines = String(content || '').split(/\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var hit = trim(lines[i]).match(RE_LOVE_POEM);
            if (hit) return parseLovePoemBody(hit[1]);
        }
        return null;
    }

    function isLovePoemMessage(m) {
        if (!m || m.deleted) return false;
        if (m.type === 'love_poem') return true;
        if (m.lovePoem && Array.isArray(m.lovePoem.lines) && m.lovePoem.lines.length) return true;
        return !!firstLovePoemParsedFromContent(m.content);
    }

    function normalizeLovePoemFields(m) {
        var fromContent = firstLovePoemParsedFromContent(m && m.content);
        var hasStored = m && m.lovePoem && Array.isArray(m.lovePoem.lines) && m.lovePoem.lines.length;
        if (!fromContent && !hasStored) return null;
        var resolved = resolveLovePoemFromMessage(m);
        if (!resolved || !resolved.lines.length) return null;
        var apiLine = formatLovePoemForApi(resolved);
        return {
            type: 'love_poem',
            lovePoem: resolved,
            content: apiLine || '[情诗] ' + trim(resolved.style)
        };
    }

    function giftParcelSubtotal(it) {
        var qty = Math.max(1, Number(it && it.qty) || 1);
        var price = Number(it && it.price) || 0;
        return Math.round(price * qty * 100) / 100;
    }

    function giftNoteFromContent(content) {
        var lines = String(content || '').split(/\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var explicit = trim(lines[i]).match(/^送礼赠言[-－—]\s*(.+)$/);
            if (explicit) return trim(explicit[1]).slice(0, 200);
            var sum = trim(lines[i]).match(/^送礼合计[-－—]/);
            if (sum) {
                var body = trim(lines[i]).replace(/^送礼合计[-－—]/, '');
                var parts = body.split(RE_LOCATION_SPLIT).map(function (x) {
                    return trim(x);
                });
                if (parts.length >= 4) return trim(parts.slice(3).join('｜')).slice(0, 200);
                if (parts.length >= 3) return trim(parts.slice(2).join('｜')).slice(0, 200);
            }
            var single = trim(lines[i]).match(RE_GIFT);
            if (single) {
                var p = parseGiftBody(single[1]);
                if (p && trim(p.note)) return trim(p.note);
            }
        }
        return '';
    }

    function firstGiftParsedFromContent(content) {
        var lines = String(content || '').split(/\n/);
        var i;
        for (i = 0; i < lines.length; i++) {
            var hit = trim(lines[i]).match(RE_GIFT);
            if (hit && !/^送礼合计/.test(trim(lines[i])) && !/^送礼项/.test(trim(lines[i]))) {
                return parseGiftBody(hit[1]);
            }
        }
        return null;
    }

    function resolveGiftParcelFromMessage(m) {
        if (!m) return null;
        var gp = m.giftParcel && typeof m.giftParcel === 'object' ? m.giftParcel : null;
        var noteExtra = giftNoteFromContent(m.content);
        var parsed = firstGiftParsedFromContent(m.content);
        if (!gp || !gp.items || !gp.items.length) {
            if (!parsed) return null;
            return {
                items: [
                    {
                        name: parsed.name,
                        qty: parsed.qty,
                        price: 0,
                        shop: '',
                        emoji: '🎁'
                    }
                ],
                total: 0,
                note: trim(parsed.note) || noteExtra,
                ribbon: 'FOR YOU',
                status: 'delivered'
            };
        }
        var note = trim(gp.note) || noteExtra || (parsed && trim(parsed.note)) || '';
        return Object.assign({}, gp, { note: note });
    }

    /** 写入 API / 上下文的完整礼品信息（赠言在协议行第 3 段，不重复输出） */
    function formatGiftForApi(gp) {
        if (!gp || !Array.isArray(gp.items) || !gp.items.length) return '';
        var note = trim(gp.note) || '（无赠言）';
        var lines = [];
        if (gp.items.length === 1) {
            var one = gp.items[0];
            var qty1 = Math.max(1, Number(one.qty) || 1);
            lines.push('送礼-' + trim(one.name) + '｜' + qty1 + '｜' + note);
            if (trim(one.shop)) lines.push('送礼店铺-' + trim(one.shop));
            return lines.join('\n');
        }
        lines.push('送礼清单-共' + gp.items.length + '件');
        gp.items.forEach(function (it) {
            var qty = Math.max(1, Number(it.qty) || 1);
            var row = '送礼项-' + trim(it.name) + '｜' + qty;
            if (trim(it.shop)) row += '｜' + trim(it.shop);
            lines.push(row);
        });
        lines.push('送礼合计-礼盒｜1｜' + note);
        return lines.join('\n');
    }

    function formatGiftApiLine(gp) {
        return formatGiftForApi(gp);
    }

    function parseTransferReceiptLine(line) {
        var raw = trim(line);
        var m = raw.match(RE_TRANSFER_RECEIPT);
        if (!m) return null;
        var parts = m[1].split(RE_TRANSFER_SPLIT).map(function (x) {
            return trim(x);
        });
        var label = parts[0];
        if (label !== '已收' && label !== '已退') return null;
        var amount = parseFloat(parts[1]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var note = parts.slice(2).join('｜').slice(0, 120);
        return {
            action: label === '已收' ? 'accept' : 'refund',
            amount: Math.round(amount * 100) / 100,
            note: note
        };
    }

    function findMatchingPendingUserTransfer(pendingList, receipt) {
        if (!receipt || !pendingList || !pendingList.length) return null;
        var i;
        for (i = pendingList.length - 1; i >= 0; i--) {
            var row = pendingList[i];
            var rp = row.redPacket;
            if (!rp || Math.abs(Number(rp.amount) - receipt.amount) > 0.001) continue;
            var n1 = trim(rp.note) || '';
            var n2 = trim(receipt.note) || '';
            if (n1 === n2) return row;
            if (!n1 && !n2) return row;
        }
        for (i = pendingList.length - 1; i >= 0; i--) {
            var row2 = pendingList[i];
            if (row2.redPacket && Math.abs(Number(row2.redPacket.amount) - receipt.amount) < 0.001) {
                return row2;
            }
        }
        return null;
    }

    function collectTrailingUserRound(history) {
        var list = Array.isArray(history) ? history : [];
        var round = [];
        var i;
        for (i = list.length - 1; i >= 0; i--) {
            var row = list[i];
            if (!row || row.deleted) continue;
            if (row.role === 'assistant') break;
            if (isCharacterOnlineNarrationMessage(row)) break;
            if (row.role === 'user') round.unshift(row);
        }
        return round;
    }

    function formatUserRoundLinesForRegenerate(history, chatSettings) {
        var round = collectTrailingUserRound(history);
        if (!round.length) return '';
        var aw = global.MiyaChatAwareness;
        var nowTs = Date.now();
        var lastStampedTs = 0;
        var lines = [];
        round.forEach(function (m) {
            var body = formatMessageForApi(m);
            if (!body) return;
            if (aw && typeof aw.stampMessageForApi === 'function') {
                body = aw.stampMessageForApi(body, m, chatSettings, nowTs, lastStampedTs);
                lastStampedTs = Number(m.createdAt) || lastStampedTs;
            }
            lines.push(body);
        });
        return lines.join('\n');
    }

    function collectPendingUserTransfersInRound(history) {
        return collectTrailingUserRound(history).filter(function (m) {
            return (
                m &&
                !m.deleted &&
                m.type === 'transfer' &&
                m.redPacket &&
                m.redPacket.dir === 'out' &&
                trim(m.redPacket.status) === 'pending'
            );
        });
    }

    function buildTransferUserRespondBlock(pendingList, roleName) {
        var who = trim(roleName) || '角色';
        var rows = (pendingList || []).map(function (m, idx) {
            var rp = m.redPacket || {};
            return (
                String(idx + 1) +
                '. 金额 ¥' +
                rp.amount +
                '｜附言：' +
                (trim(rp.note) || '（无附言）')
            );
        });
        if (!rows.length) return '';
        return [
            '【本轮 · 用户向你转账（仅本轮注入，须处理）】',
            '用户在本轮向你汇出以下款项（附言已列出）。你必须在本轮正文中对每一笔择一处理：',
            rows.join('\n'),
            '· 收款：单独一行「转账回执-已收｜金额｜附言」（金额与附言须与该笔用户转账完全一致，附言无则写（无附言））',
            '· 退回：单独一行「转账回执-已退｜金额｜附言」',
            '【硬性】每一笔用户转账只能择一：禁止对同一笔同时输出「已收」与「已退」；禁止重复输出两条回执。',
            '回执行仅用于系统记账，不会在聊天界面展示。处理完所有待确认转账后，可继续输出其它正文气泡。',
            who + '不得忽略未处理的待确认转账。'
        ].join('\n');
    }

    function applyRoleTransferReceipts(chatId, bubbleLines, store, profileId) {
        if (!store || !chatId || !bubbleLines || !bubbleLines.length) return Promise.resolve([]);
        var pending = store.getMessages(chatId).filter(function (m) {
            return (
                m &&
                !m.deleted &&
                m.role === 'user' &&
                m.type === 'transfer' &&
                m.redPacket &&
                m.redPacket.dir === 'out' &&
                trim(m.redPacket.status) === 'pending'
            );
        });
        if (!pending.length) return Promise.resolve([]);
        var pid = String(profileId || '').trim();
        var chatRow = store.findChat && store.findChat(chatId);
        var contactId = chatRow && chatRow.contactId ? String(chatRow.contactId) : '';
        var walletApi = global.MiyaChatWallet;
        var chain = Promise.resolve();
        var settledIds = Object.create(null);
        var updatedMsgIds = [];
        bubbleLines.forEach(function (line) {
            var receipt = parseTransferReceiptLine(line);
            if (!receipt) return;
            var hit = findMatchingPendingUserTransfer(pending, receipt);
            if (!hit || settledIds[hit.id]) return;
            settledIds[hit.id] = true;
            pending = pending.filter(function (m) {
                return m.id !== hit.id;
            });
            var amt = Number(hit.redPacket.amount) || 0;
            var note = trim(hit.redPacket.note) || '';
            var nextStatus = receipt.action === 'accept' ? 'accepted' : 'refunded';
            var msgId = hit.id;
            var receiptAction = receipt.action === 'accept' ? 'accept' : 'refund';
            chain = chain
                .then(function () {
                    if (!walletApi || typeof walletApi.settleUserOutgoingTransfer !== 'function') {
                        return false;
                    }
                    return walletApi.settleUserOutgoingTransfer({
                        contactId: contactId,
                        profileId: pid,
                        amount: amt,
                        action: receiptAction,
                        redPacket: hit.redPacket
                    });
                })
                .then(function () {
                    return store.updateMessage(chatId, msgId, {
                        redPacket: {
                            amount: amt,
                            note: note,
                            status: nextStatus,
                            dir: 'out',
                            resolvedAt: Date.now(),
                            walletHeld: !!(hit.redPacket && hit.redPacket.walletHeld),
                            walletSettled: !!(hit.redPacket && hit.redPacket.walletHeld)
                        }
                    });
                })
                .then(function () {
                    updatedMsgIds.push(msgId);
                });
        });
        return chain.then(function () {
            return updatedMsgIds;
        });
    }

    function buildStickerAllowlistBlock(stickerCatalog, roleName) {
        var names = (stickerCatalog || []).map(function (x) {
            return trim(x.name);
        }).filter(Boolean);
        var who = trim(roleName) || '角色';
        if (!names.length) {
            return [
                '【表情包可用列表（' + who + '）】',
                '当前没有绑定给该角色的表情包，本轮不要输出「表情包-名称」行。',
                '禁止编造任何表情包名称。'
            ].join('\n');
        }
        var list = names
            .slice(0, 120)
            .map(function (x) {
                return '「' + x + '」';
            })
            .join('、');
        if (names.length > 120) list += '…';
        return [
            '【表情包可用列表（' + who + '）】',
            '你只能从下列名称中选一个发表情包，名称必须完全一致：' + list + '。',
            '格式：单独一行「表情包-名称」（名称与上表完全一致，禁止捏造）。',
            '禁止编造列表以外的名称。'
        ].join('\n');
    }

    /** 模型把多条「类型-内容」挤在一行时，按类型前缀拆成多气泡行（兜底，不替代换行规范） */
    var RE_SPLIT_ONLINE_TYPE_PREFIX =
        /(?=(?:引用|语音|旁(?:白)?|表情包|图片|位置|转账|转账回执|外卖|送礼|撤回|换头像|给用户换头像|发起语音通话|发起视频通话)\s*[-－—：:])/;

    function splitCollapsedOnlineTypeLines(text) {
        var raw = trim(text);
        if (!raw) return [];
        if (raw.indexOf('\n') >= 0) {
            return raw
                .split(/\n/)
                .map(function (s) {
                    return trim(s);
                })
                .filter(Boolean);
        }
        if (RE_QUOTE.test(raw)) {
            var qo = raw.match(RE_QUOTE);
            var quoteSplit = qo && qo[1] != null ? splitQuoteBodyFromReply(qo[1]) : null;
            if (quoteSplit && trim(quoteSplit.replyText)) {
                var quotedLine = '引用-' + trim(quoteSplit.quotedText);
                var replyLines = splitNonQuoteCollapsedSegments(trim(quoteSplit.replyText));
                return [quotedLine].concat(replyLines);
            }
            return [raw];
        }
        return splitNonQuoteCollapsedSegments(raw);
    }

    function normalizeAvatarSwapLine(raw) {
        return stripApiTimelinePrefix(trim(raw)).replace(/\s*⧗\s*$/g, '').trim();
    }

    function isAvatarSwapCommandLine(raw) {
        var t = normalizeAvatarSwapLine(raw);
        if (!t) return false;
        return RE_SWAP_CHAR_AVATAR.test(t) || RE_SWAP_USER_AVATAR.test(t);
    }

    function matchAvatarSwapSegment(text) {
        var raw = normalizeAvatarSwapLine(text);
        if (!raw) return null;
        var userHit = raw.match(RE_SWAP_USER_AVATAR);
        if (userHit) return { raw: raw, body: userHit[1], kind: 'user' };
        var charHit = raw.match(RE_SWAP_CHAR_AVATAR);
        if (charHit) return { raw: raw, body: charHit[1], kind: 'char' };
        var inlineUser = raw.match(/给用户换头像[-－—：:]\s*(.+?)(?=$|[，。！？；;])/);
        if (inlineUser) {
            return {
                raw: '给用户换头像-' + trim(inlineUser[1]),
                body: trim(inlineUser[1]),
                kind: 'user',
                rest: trim(raw.slice(0, raw.indexOf(inlineUser[0]))) || ''
            };
        }
        var inlineChar = raw.match(/换头像[-－—：:]\s*(.+?)(?=$|[，。！？；;])/);
        if (inlineChar) {
            return {
                raw: '换头像-' + trim(inlineChar[1]),
                body: trim(inlineChar[1]),
                kind: 'char',
                rest: trim(raw.slice(0, raw.indexOf(inlineChar[0]))) || ''
            };
        }
        return null;
    }

    function resolveAvatarSwapFromSegment(seg, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var daApi = global.MiyaChatDynamicAvatar;
        if (!seg || !daApi || typeof daApi.parseSwapSource !== 'function') {
            return { swap: null, strip: !!seg };
        }
        var charEnabled = !!opts.charAvatarSwapEnabled;
        var userEnabled = !!opts.userAvatarSwapEnabled;
        var source = daApi.parseSwapSource(seg.body);
        if (!source) return { swap: null, strip: true };
        if (seg.kind === 'user') {
            if (!userEnabled || source.kind !== 'albumPhoto') return { swap: null, strip: true };
            return { swap: { target: 'profile', source: source, raw: seg.raw }, strip: true };
        }
        if (seg.kind === 'char') {
            if (!charEnabled) return { swap: null, strip: true };
            return { swap: { target: 'contact', source: source, raw: seg.raw }, strip: true };
        }
        return { swap: null, strip: true };
    }

    function extractAvatarSwapFromLines(lines, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var arr = Array.isArray(lines) ? lines : [];
        var out = [];
        var swaps = [];
        arr.forEach(function (line) {
            var seg = matchAvatarSwapSegment(line);
            if (!seg) {
                out.push(line);
                return;
            }
            var resolved = resolveAvatarSwapFromSegment(seg, opts);
            if (resolved.swap) swaps.push(resolved.swap);
            if (seg.rest) out.push(seg.rest);
        });
        return { lines: out, swaps: swaps };
    }

    function normalizeNarrationPerson(v, fallback) {
        var s = String(v == null ? '' : v).trim();
        if (s === '1' || s === '2' || s === '3') return s;
        return fallback === '1' || fallback === '2' || fallback === '3' ? fallback : '3';
    }

    function narrationPersonWord(person) {
        if (person === '1') return '第一人称';
        if (person === '2') return '第二人称';
        return '第三人称';
    }

    /** 旁白人称：char/user 如何称呼 */
    function buildNarrationPersonClause(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var userName = trim(opts.userName) || '用户';
        var charPerson = normalizeNarrationPerson(opts.onlineNarrationCharPerson, '3');
        var userPerson = normalizeNarrationPerson(opts.onlineNarrationUserPerson, '2');
        var charHint =
            charPerson === '1'
                ? '称呼角色用第一人称（「我」，以角色视角叙述）'
                : charPerson === '2'
                  ? '称呼角色用第二人称（「你」）'
                  : '称呼角色用第三人称（「' + roleName + '」/他/她）';
        var userHint =
            userPerson === '1'
                ? '称呼用户用第一人称（「我」，以用户视角叙述）'
                : userPerson === '2'
                  ? '称呼用户用第二人称（「你」）'
                  : '称呼用户用第三人称（「' + userName + '」/他/她）';
        return (
            '人称：' +
            charHint +
            '；' +
            userHint +
            '（当前设置：角色' +
            narrationPersonWord(charPerson) +
            '、用户' +
            narrationPersonWord(userPerson) +
            '）；全文人称须前后一致，勿混用'
        );
    }

    function narrationCharSubjectParts(person, roleName) {
        var p = normalizeNarrationPerson(person, '3');
        if (p === '1') return { subj: '我', pron: '我' };
        if (p === '2') return { subj: '你', pron: '你' };
        return { subj: roleName || '角色', pron: '她' };
    }

    function buildPerTurnFormatReminder(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 1);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var countHint =
            bubbleMin === bubbleMax
                ? '正文建议约 ' + bubbleMin + ' 行'
                : '正文建议 ' + bubbleMin + '–' + bubbleMax + ' 行';
        var lines = [
            '【本轮格式·' + roleName + '】',
            '顺序：<thinking>…</thinking> → 正文（每行一条气泡，必须换行）→ <miyavoice>…</miyavoice>。',
            '用户只能看到 </thinking> 之后、<miyavoice> 之前的正文；思维链/心声/标记不得泄漏到正文。',
            '正文只输出一遍：禁止先写 [正文] 草稿再复读相同内容；禁止输出 [/thinking] 或心声字段行。',
            countHint + '；引用时「引用-摘抄」独占一行，每条回复各占一行；「 / 」为用户连发消息的分隔符，引用时一次只引其中一条。',
            '真人聊天感：可跳跃、可断句、可转话题；勿复读近几轮话题/描写/动作；emoji/颜文字/标点须贴合人设情绪。',
            '发出前自检：① 正文无重复行 ② 一行一气泡 ③ 无结构标记 ④ 心声仅在 <miyavoice> 内 ⑤ 未复读近期话题与动作套路。'
        ];
        if (opts.autoTranslate) {
            var tr = global.MiyaChatTranslate;
            if (tr && typeof tr.buildPerTurnAutoTranslateReminder === 'function') {
                lines.push(tr.buildPerTurnAutoTranslateReminder(opts.translateTarget || 'zh-CN'));
            }
        }
        if (opts.onlineNarrationEnabled) {
            lines.push(
                '若已开启线上旁白：正文段（<thinking> 之后、<miyavoice> 之前）须穿插「旁白-…」行，每轮至少 2–3 条，穿插在聊天气泡之间；行首必须写完整的「旁白」二字再接短横线；每条旁白须写足 80–150 字，含动作、神态、环境或氛围细节，禁止一句带过；' +
                    buildNarrationPersonClause(opts) +
                    '；旁白不要总重复相同动作/话题，需要演变出动作/情绪/场景等的推进；旁白不得写入 <thinking> 或 <miyavoice>；<thinking> 思维链仍必填。'
            );
        }
        if (opts.imageGenEnabled) {
            lines.push(
                '已启用 AI 生图：「图片-…」与朋友圈配图描述须具体可画（场景、主体、光线、色调、氛围、细节），便于生成真实图片；忌空泛描述。'
            );
        }
        if (opts.charAvatarSwapEnabled) {
            lines.push(
                '换头像：须单独一行「换头像-…」指令才生效；可随心意随时换（有合适素材时），禁止只在对话里说换了而不输出指令。'
            );
        }
        return lines.join('\n');
    }

    /** 共读场景：仅允许多行气泡 + 表情包，禁止其它线上专属前缀 */
    function buildReadTogetherFormatRules(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 2);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var catalog = opts.catalog || [];
        var stickerEx =
            catalog[0] && catalog[0].name ? '表情包-' + catalog[0].name : null;
        var countHint =
            bubbleMin === bubbleMax
                ? '本轮正文建议约 ' + bubbleMin + ' 行'
                : '本轮正文建议 ' + bubbleMin + ' 至 ' + bubbleMax + ' 行';

        var rows = [
            '【共读·输出格式·' + roleName + '】',
            '你正与用户并肩共读，对话区是共读专属聊天，不是微信/QQ 线上聊天。',
            countHint + '（每行一条气泡，仅供参考，系统不会截断）。',
            '正文段每一行就是一条独立气泡；禁止把多条气泡挤在同一行。',
            '禁止在正文输出 ⧗、› 或任何 API 时间戳标记。',
            '',
            '【允许】',
            '· 普通文字：直接写对白，一行一条。',
            '· 表情包：单独一行「表情包-名称」（名称须来自下文「表情包可用列表」，禁止捏造）。',
            '',
            '【输出要求】',
            '直接输出正文，每行一条气泡，无需任何包裹标签或前缀说明。',
            '',
            '【格式示例·' + roleName + '】',
            '这页写得太好了',
            stickerEx || '（无表情包则不输出表情包行）',
            '你看第三段那个比喻'
        ];
        return rows.join('\n');
    }

    function buildReadTogetherPerTurnReminder(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 2);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var countHint =
            bubbleMin === bubbleMax
                ? '正文建议约 ' + bubbleMin + ' 行'
                : '正文建议 ' + bubbleMin + '–' + bubbleMax + ' 行';
        return [
            '【本轮输出格式·共读·' + roleName + '】',
            '本轮仅输出正文气泡，每行一条；' + countHint + '。',
            '正文仅允许：普通文字、表情包-名称',
            '发出前自检：是否误用了线上聊天格式或心声/思维链标签。'
        ].join('\n');
    }

    var RE_RT_FORBIDDEN =
        /^(?:引用|语音|图片|位置|转账|转账回执|外卖|送礼|情诗|旁(?:白)?|发起语音通话|发起视频通话|【发朋友圈)[-－—]/;
    var RE_RT_HEART_VOICE =
        /^(?:好感度|欲望值|行为动作|角色心声)\s*[-－—：:]/;
    var RE_RT_META_TAG = /^<\/?(?:thinking|miyavoice|miyanextpush|think|redacted_thinking|reasoning)>|\[?\/?(?:thinking|think|miyavoice|miyanextpush|heartvoice|正文|主体|回复)\]?$|【?\/?(?:thinking|正文|主体)】?$/i;

    /** 模型泄漏的结构标记行（[正文]、[/thinking] 等），不应进入聊天气泡 */
    function isStructuralLeakLine(line) {
        var t = trim(line);
        if (!t) return true;
        if (RE_RT_META_TAG.test(t)) return true;
        if (/^<\/?(?:thinking|think|miyavoice|miyanextpush|heartvoice|redacted_thinking|reasoning)>$/i.test(t)) {
            return true;
        }
        if (/^<\/?miyav[\w]*\s*>$/i.test(t)) return true;
        if (/^＜\/?miyav[\w]*＞$/i.test(t)) return true;
        if (/^\[(?:正文|主体|回复内容|response|output)\]$/i.test(t)) return true;
        if (/^【(?:正文|主体|回复内容)】$/.test(t)) return true;
        if (/^\[\/(?:thinking|think|reasoning)\]$/i.test(t)) return true;
        if (/^［\/(?:thinking|think|reasoning)］$/i.test(t)) return true;
        if (/^【\/(?:thinking|think|reasoning)】$/.test(t)) return true;
        if (/^\[(?:thinking|think|reasoning)\]$/i.test(t)) return true;
        if (RE_RT_HEART_VOICE.test(t)) return true;
        return false;
    }

    function normalizeBubbleLineKey(line) {
        return stripApiTimelinePrefix(trim(line));
    }

    /** 去掉连续重复行，以及整段重复输出（模型常先草稿再复读一遍） */
    function collapseDuplicateBubbleLines(lines) {
        var arr = (Array.isArray(lines) ? lines : [])
            .map(normalizeBubbleLineKey)
            .filter(Boolean);
        if (arr.length < 2) return arr;
        var out = [];
        arr.forEach(function (line) {
            if (!out.length || out[out.length - 1] !== line) out.push(line);
        });
        arr = out;
        var len;
        for (len = Math.floor(arr.length / 2); len >= 1; len--) {
            if (arr.slice(0, len).join('\n') === arr.slice(len, len * 2).join('\n')) {
                arr = arr.slice(len);
                break;
            }
        }
        if (arr.length >= 4 && arr.length % 2 === 0) {
            var half = arr.length / 2;
            if (arr.slice(0, half).join('\n') === arr.slice(half).join('\n')) {
                return arr.slice(half);
            }
        }
        for (len = Math.min(Math.floor(arr.length / 2), 16); len >= 1; len--) {
            var head = arr.slice(0, len).join('\n');
            var tail = arr.slice(arr.length - len).join('\n');
            if (head === tail && arr.length >= len * 2) {
                return arr.slice(-len);
            }
        }
        return arr;
    }

    function bubbleDedupeKey(b) {
        if (!b) return '';
        var q = b.quoteRef && b.quoteRef.text ? trim(b.quoteRef.text) : '';
        return (
            trim(b.type || 'text') +
            '\0' +
            trim(b.content || b.callLine || '') +
            '\0' +
            q +
            '\0' +
            trim(b.voiceText || '')
        );
    }

    function dedupeParsedRoleBubbles(bubbles) {
        var list = Array.isArray(bubbles) ? bubbles.slice() : [];
        if (list.length < 2) return list;
        var out = [];
        list.forEach(function (b) {
            var k = bubbleDedupeKey(b);
            if (out.length && bubbleDedupeKey(out[out.length - 1]) === k) return;
            out.push(b);
        });
        list = out;
        var len;
        for (len = Math.floor(list.length / 2); len >= 1; len--) {
            var leadA = list.slice(0, len).map(bubbleDedupeKey).join('\n');
            var leadB = list.slice(len, len * 2).map(bubbleDedupeKey).join('\n');
            if (leadA === leadB && leadA) {
                list = list.slice(len);
                break;
            }
        }
        if (list.length >= 4 && list.length % 2 === 0) {
            var half = list.length / 2;
            var keysA = list.slice(0, half).map(bubbleDedupeKey).join('\n');
            var keysB = list.slice(half).map(bubbleDedupeKey).join('\n');
            if (keysA === keysB) return list.slice(half);
        }
        for (len = Math.min(Math.floor(list.length / 2), 16); len >= 1; len--) {
            var h = list.slice(0, len).map(bubbleDedupeKey).join('\n');
            var t = list.slice(-len).map(bubbleDedupeKey).join('\n');
            if (h === t && list.length >= len * 2) return list.slice(-len);
        }
        return list;
    }

    function filterStructuralLeakLines(lines) {
        return (Array.isArray(lines) ? lines : []).filter(function (line) {
            return !isStructuralLeakLine(line);
        });
    }

    function parseReadTogetherOutputLine(line, catalog) {
        var raw = stripApiTimelinePrefix(trim(line)).replace(/\s*⧗\s*$/g, '').trim();
        if (!raw) return null;
        if (RE_RT_META_TAG.test(raw) || RE_RT_HEART_VOICE.test(raw)) return null;
        if (RE_ROLE_CALL_VOICE.test(raw) || RE_ROLE_CALL_VIDEO.test(raw) ||
            RE_LEGACY_CALL_VOICE.test(raw) || RE_LEGACY_CALL_VIDEO.test(raw) ||
            RE_ROLE_MOMENTS_POST.test(raw) || RE_NARRATION.test(raw) ||
            RE_RECALL.test(raw) || RE_TRANSFER_RECEIPT.test(raw)) {
            return null;
        }
        var stk = raw.match(RE_STICKER);
        if (stk) {
            var stickerName = trim(stk[1]);
            var hit = resolveStickerByName(stickerName, catalog);
            if (hit) {
                return {
                    type: 'sticker',
                    content: '表情包-' + hit.name,
                    stickerBlobId: hit.blobId || '',
                    stickerUrl: hit.url || '',
                    stickerName: hit.name
                };
            }
            return null;
        }
        if (RE_QUOTE.test(raw)) return null;
        if (RE_RT_FORBIDDEN.test(raw)) return null;
        return { type: 'text', content: raw };
    }

    function parseReadTogetherOutputLinesMeta(lines, catalog) {
        var arr = expandCollapsedOutputLines(lines);
        var out = [];
        arr.forEach(function (line) {
            var fields = parseReadTogetherOutputLine(line, catalog);
            if (fields) out.push(fields);
        });
        return { bubbles: out };
    }

    function parseReadTogetherUserInput(text, catalog) {
        var raw = trim(text);
        if (!raw) return null;
        var stk = raw.match(RE_STICKER);
        if (stk) {
            var hit = resolveStickerByName(trim(stk[1]), catalog || []);
            if (hit) {
                return {
                    type: 'sticker',
                    content: '表情包-' + hit.name,
                    stickerBlobId: hit.blobId || '',
                    stickerUrl: hit.url || '',
                    stickerName: hit.name
                };
            }
        }
        return { type: 'text', content: raw };
    }

    /** 一起听场景：仅允许多行气泡 + 切歌指令，禁止其它线上专属前缀 */
    function buildListenTogetherFormatRules(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 2);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var countHint =
            bubbleMin === bubbleMax
                ? '本轮正文建议约 ' + bubbleMin + ' 行'
                : '本轮正文建议 ' + bubbleMin + ' 至 ' + bubbleMax + ' 行';

        return [
            '【一起听·输出格式·' + roleName + '】',
            '你正与用户并肩听歌，对话区是一起听专属聊天，不是微信/QQ 线上聊天。',
            countHint + '（每行一条气泡，仅供参考，系统不会截断）。',
            '正文段每一行就是一条独立气泡；禁止把多条气泡挤在同一行。',
            '禁止在正文输出 ⧗、› 或任何 API 时间戳标记。',
            '',
            '【允许】',
            '· 普通文字：直接写对白，一行一条。',
            '· 换歌：单独一行「切歌-歌名或序号」（仅当自然需要时；不要频繁切歌）。',
            '',
            '【禁止·线上专属格式】',
            '一起听场景禁止输出以下前缀行：',
            '引用- / 语音- / 表情包- / 图片- / 位置- / 转账- / 旁白- / 发起语音通话 / 发起视频通话 / 【发朋友圈…】',
            '',
            '【禁止·思维链与心声】',
            '禁止输出 <thinking>、<miyavoice>、好感度-/欲望值-/行为动作-/角色心声- 等；本轮回复只能是正文气泡。',
            '',
            '【输出要求】',
            '直接输出正文，每行一条气泡，无需任何包裹标签。',
            '',
            '【格式示例·' + roleName + '】',
            '这首歌的前奏好好听',
            '歌词这句也太戳了',
            '切歌-下一首想听的歌名'
        ].join('\n');
    }

    function buildListenTogetherPerTurnReminder(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 2);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var countHint =
            bubbleMin === bubbleMax
                ? '正文建议约 ' + bubbleMin + ' 行'
                : '正文建议 ' + bubbleMin + '–' + bubbleMax + ' 行';
        return [
            '【本轮输出格式·一起听·' + roleName + '】',
            '本轮仅输出正文气泡，每行一条；' + countHint + '。',
            '禁止输出 <thinking>、<miyavoice> 或任何思维链/心声段。',
            '正文仅允许：普通文字、切歌-歌名或序号；禁止引用-/语音-/表情包-/图片-/位置-/转账-/旁白-等线上专属前缀。',
            '发出前自检：是否误用了线上聊天格式或心声/思维链标签。'
        ].join('\n');
    }

    var RE_LT_SWITCH = /^切歌[-－—]\s*(.+)$/;

    function parseListenTogetherOutputLine(line) {
        var raw = stripApiTimelinePrefix(trim(line)).replace(/\s*⧗\s*$/g, '').trim();
        if (!raw || RE_LT_SWITCH.test(raw)) return null;
        if (RE_RT_META_TAG.test(raw) || RE_RT_HEART_VOICE.test(raw)) return null;
        if (RE_ROLE_CALL_VOICE.test(raw) || RE_ROLE_CALL_VIDEO.test(raw) ||
            RE_LEGACY_CALL_VOICE.test(raw) || RE_LEGACY_CALL_VIDEO.test(raw) ||
            RE_ROLE_MOMENTS_POST.test(raw) || RE_NARRATION.test(raw) ||
            RE_RECALL.test(raw) || RE_TRANSFER_RECEIPT.test(raw)) {
            return null;
        }
        if (RE_STICKER.test(raw) || RE_QUOTE.test(raw) || RE_RT_FORBIDDEN.test(raw)) return null;
        return { type: 'text', content: raw };
    }

    function parseListenTogetherOutputLinesMeta(lines) {
        var arr = expandCollapsedOutputLines(lines);
        var out = [];
        arr.forEach(function (line) {
            var fields = parseListenTogetherOutputLine(line);
            if (fields) out.push(fields);
        });
        return { bubbles: out };
    }

    function buildHeartVoiceRulesBlock(roleName, preset) {
        var rn = trim(roleName) || '角色';
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        if (preset && tplMod && typeof tplMod.buildHeartVoiceRulesFromPreset === 'function') {
            var custom = tplMod.buildHeartVoiceRulesFromPreset(rn, preset);
            if (custom) return custom;
        }
        return [
            '【线上格式规则·心声·' + rn + '】',
            '【强制·完整 miyavoice】必须按照要求完整输出 <miyavoice>...</miyavoice> 模块：开闭标签均必填；段内四行字段须全部写满，禁止省略、禁止截断、禁止写到一半就结束。',
            '心声为每轮输出的第三段，须单独包裹在 <miyavoice>...</miyavoice> 内；禁止写入 <thinking> 或正文气泡行。',
            '心声段须严格按以下四行输出（每行一项，换行分隔；行首标签原样保留，用半角或全角短横线/冒号连接内容）：',
            '好感度-数值（0–100 整数，' + rn + '对用户的当前好感度，每轮须据对话合理更新）',
            '欲望值-数值（0–100 整数，' + rn + '对用户的当前欲望值，每轮须据对话合理更新）',
            '行为动作-客观描写' + rn + '此刻的动作、神态与环境互动（第三人称，只写可见行为，不写心理）',
            '角色心声-' + rn + '的第一人称内心独白（须写足 40 字以上，1–3 句，私密真实，符合人设与当下关系；仅指本行内心独白字数，不含行为动作行）',
            '数值应相对上一轮有合理变化；禁止每轮照搬相同数字、相同动作描写或相同内心独白。',
            '发出前自检：是否已写满好感度/欲望值/行为动作/角色心声四行并正确闭合 </miyavoice>；不足则补全后再结束。',
            '若系统另行注入「上一轮心声」，本轮须对照更新，禁止输出重复/相同的心声（含四行均不得与前一轮雷同）。'
        ].join('\n');
    }

    function formatHeartVoiceSnapshotLines(entry) {
        if (!entry || typeof entry !== 'object') return '';
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        if (tplMod && typeof tplMod.isCustomEntry === 'function' && tplMod.isCustomEntry(entry)) {
            return tplMod.formatCustomSnapshotLines(entry) || '';
        }
        var lines = [];
        if (entry.affection != null) lines.push('好感度-' + entry.affection);
        if (entry.desire != null) lines.push('欲望值-' + entry.desire);
        if (String(entry.action || '').trim()) lines.push('行为动作-' + String(entry.action).trim());
        if (String(entry.monologue || '').trim()) lines.push('角色心声-' + String(entry.monologue).trim());
        return lines.join('\n');
    }

    function buildLastHeartVoiceInjectBlock(chat, contact) {
        if (!chat || chat.type === 'group') return '';
        var log = Array.isArray(chat.heartVoiceLog) ? chat.heartVoiceLog : [];
        if (!log.length) return '';
        var entry = log[0];
        var body = formatHeartVoiceSnapshotLines(entry);
        if (!body) return '';
        var roleName = trim((contact && contact.name) || '角色');
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        var isCustom = tplMod && typeof tplMod.isCustomEntry === 'function' && tplMod.isCustomEntry(entry);
        var updateHint = isCustom
            ? '本轮须在此基础上合理更新；禁止输出与上一轮相同或高度重复的心声（各字段均不得照搬或只改一两个词）。'
            : '本轮须在此基础上合理更新；禁止输出与上一轮相同或高度重复的心声（好感度、欲望值、行为动作、角色心声均不得照搬或只改一两个词）。';
        return [
            '【上一轮心声·' + roleName + '】',
            '以下为你方上一段对话结束时的心声快照，供本轮 <miyavoice> 续写参考。',
            updateHint,
            body
        ].join('\n');
    }

    function buildRegenerateRoundInjectBlock(contact, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim((contact && contact.name) || '') || '角色';
        var userRoundText = formatUserRoundLinesForRegenerate(
            opts.history || [],
            opts.chatSettings
        );
        var hvPreset = null;
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        if (tplMod && typeof tplMod.resolvePresetForChat === 'function') {
            hvPreset = tplMod.resolvePresetForChat(opts.chatSettings);
        }
        var regenForbid = hvPreset
            ? '正文与心声均须根据当前对话全新撰写；禁止沿用已撤回轮次的正文或心声各字段内容。'
            : '正文与心声均须根据当前对话全新撰写；禁止沿用已撤回轮次的正文、好感度、欲望值、行为动作或角色心声。';
        var lines = [
            '【重回·' + roleName + '】',
            '用户已撤回并请求重新生成本轮回复。',
            '须完整输出 <thinking> → 正文气泡 → <miyavoice> 三段，缺一不可。',
            regenForbid
        ];
        if (userRoundText) {
            lines.push(
                '【本轮用户消息·须回复以下内容】',
                '下列为用户在本轮发送的全部消息（含时间标记；更早轮次的用户发言仅作背景，不得当作本轮回复对象）：',
                userRoundText,
                '须仅针对以上消息重新生成回复；禁止回应更早轮次的用户发言；禁止复读已撤回的角色回复。'
            );
        } else {
            lines.push(
                '须根据上下文中最后一段连续用户消息（自最近一条角色回复之后）重新生成回复，勿回应更早轮次的用户发言。'
            );
        }
        lines.push(
            '若系统另行注入「上一轮心声」，仅指撤回轮次之前的快照；本轮 <miyavoice> 须在此基础上续写更新，不得复制已撤回内容。'
        );
        return lines.join('\n');
    }

    function buildOnlineRules(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var roleName = trim(opts.roleName) || '角色';
        var bubbleMin = Math.max(1, Number(opts.bubbleMin) || 1);
        var bubbleMax = Math.max(bubbleMin, Number(opts.bubbleMax) || 5);
        var catalog = opts.catalog || [];
        var stickerEx =
            catalog[0] && catalog[0].name ? '表情包-' + catalog[0].name : null;
        var countHint =
            bubbleMin === bubbleMax
                ? '本轮正文建议约 ' + bubbleMin + ' 行（仅供参考，可酌情增减，系统不会截断）。'
                : '本轮正文建议 ' + bubbleMin + ' 至 ' + bubbleMax + ' 行（仅供参考，可酌情增减，系统不会截断；每行一条气泡）。';
        var hvPreset = opts.heartVoicePreset || null;
        if (!hvPreset && opts.chatSettings) {
            var tplMod0 = global.MiyaChatHeartVoiceTemplates;
            if (tplMod0 && typeof tplMod0.resolvePresetForChat === 'function') {
                hvPreset = tplMod0.resolvePresetForChat(opts.chatSettings);
            }
        }

        var rows = [
            '【线上格式规则】',
            '顺序：<thinking>…</thinking> → 正文（每行一条气泡）→ <miyavoice>…</miyavoice>。',
            '思维链只写在 <thinking> 标签内；禁止在正文输出 [正文]、【正文】、[/thinking]、<thinking> 等结构标记。',
            '用户界面只显示 </thinking> 与 <miyavoice> 之间的正文；正文只输出一遍，禁止先写草稿再原样复读第二轮。',
            countHint + '；一个换行 = 一条气泡，禁止多条挤在同一行。',
            '',
            '1、当你想引用用户的某条消息，必须先单独输出一行，格式为：引用-用户的该条消息原话（只写原话摘抄，不要加【】或其它括号包裹；一次只能引用一条用户消息，禁止把「 / 」分隔符两侧或多条用户发言拼进同一行引用；禁止在同一行接回复）。',
            '2、引用行的下一行再写你对这句话的第一条回复；若还有第二、第三条回复，必须继续各占一行；每条回复行直接写正文，行首不要写「引用-」。',
            '3、你想发语音时，必须单独输出一行，格式为：语音-语音内容的文字转写（该行只写语音，不要和普通文字写在同一行）。',
            '4、你想发表情包时，必须单独输出一行，格式为：表情包-表情包名称（名称只能从上文「表情包可用列表」里原样复制，禁止捏造；该行只发表情包，不要和文字写在同一行；根据人设决定使用表情包的频率）。',
            '5、你想发图片时，必须单独输出一行，格式为：图片-这张图片的详细描述（用文字描绘画面，禁止留空；该行只发图片，不要和普通文字写在同一行）。',
            '6、你想发位置时，必须单独输出一行，格式为：位置-地点名称｜详细地址（名称与详细地址均须填写，用半角或全角竖线分隔，禁止留空；该行只发位置，不要和普通文字写在同一行）。',
            '7、你想给用户转账时，必须单独输出一行，格式为：转账-金额｜附言（金额为正数，附言须写出，无附言则写（无附言）；该行只发转账，不要和普通文字写在同一行）。用户向你转账后，若本轮系统另行注入「用户向你转账」说明，你必须用「转账回执-已收｜金额｜附言」或「转账回执-已退｜金额｜附言」处理。用户对你转账的收款/退回，或用户对你汇款的收款/退回，对话里均会出现对应「转账回执」行，你应知晓并回应。',
            '8、每次引用只能针对其中一条用户独立消息的核心原话（见下条「 / 」分隔说明）；不要引用本对话里没出现过的内容。',
            '',
            '【用户消息格式·必读】',
            '- 用户连续连发多条时，上下文里会以「 / 」（空格+斜杠+空格）拼成一条 user 消息；「 / 」是消息分隔符，不是正文内容，两侧各为独立的一条用户发言。',
            '- 引用用户消息时：一次只能引用「 / 」分隔出的其中一条的原话，禁止把分隔符两侧或多条发言合并进同一行「引用-」。',
            '- 用户普通文字无前缀，直接书写正文；仅当用户消息以「语音-」开头时才是语音条转写。',
            '- 勿把无前缀的用户文字当作语音；禁止写「听到你说…」「你的语音…」等暗示对方发了语音条的表述（除非对方消息明确以「语音-」开头）。'
        ];
        var ruleNum = 9;
        rows.push(
            '',
            ruleNum +
                '、若你决定为用户点外卖，须单独输出一行，格式为：外卖-店铺名称｜菜品与数量｜合计金额｜送达备注（金额为正数；备注写送达地址或口味要求，无则写（无备注）；该行只发外卖单，勿与普通文字写在同一行）。',
            '点外卖须符合当下情境与人设，不可每轮都点；菜品与金额须合理。'
        );
        ruleNum += 1;
        rows.push(
            '',
            ruleNum +
                '、若你决定向用户送礼，须单独输出一行，格式为：送礼-物品名称｜数量｜赠言（赠言写出心意，无则写（无赠言）；该行只发礼品，勿与普通文字写在同一行；禁止写金额）。',
            '送礼须符合当下情境与人设，不可每轮都送；物品须合理。'
        );
        ruleNum += 1;
        rows.push(
            '',
            ruleNum +
                '、若用户请求你写情诗，或你决定以情诗表达心意，须单独输出一行，格式为：情诗-文风名｜标题｜诗句（多句用半角/分隔，如 句1/句2/句3；无题则写（无题）；文风如古风文言文、现代抒情诗等；该行只发情诗，勿与普通文字写在同一行）。',
            '写情诗须符合当下情境与人设，须原创；正文（标题除外）总字数须至少 100 字；通常情诗后还可再写 1–3 行普通对白。'
        );
        ruleNum += 1;
        rows.push(
            '',
            ruleNum +
                '、若你想撤回某一条已发送的消息，须单独输出一行，格式为：撤回-你想撤回的那句话原话（该行不会显示为气泡；只能撤回你方近期发送的消息，且原话须与被撤回那条完全一致）。',
            '撤回后对话里会出现「' + roleName + '撤回了一条消息，点击查看」；用户可查看被撤回内容。'
        );
        ruleNum += 1;
        if (opts.promptCallEnabled !== false) {
            rows.push(
                '',
                ruleNum +
                    '、若你决定主动联系用户发起视频通话，须在本轮正文最末单独一行输出：发起视频通话（仅这五个字）。',
                '发起视频通话须符合当下情境与人设，不可每轮都拨。'
            );
            ruleNum += 1;
        }
        rows.push(
            '',
            ruleNum +
                '、若你想发朋友圈，须在本轮正文最末单独一行输出：【发朋友圈：正文内容|配图1：图片描述|配图2：图片描述】；最多写到配图9，可不写配图段；不想发则不输出此行。配图只能是文字描述图（禁止真实照片）。',
            '若系统已注入【用户相册·已同步】，可用【发朋友圈：正文|相册配图1：#1】引用相册编号（须为已识别且已同步的照片）。',
            '发朋友圈须符合当下情境与人设，不可每轮都发。'
        );
        ruleNum += 1;
        if (opts.imageGenEnabled) {
            rows.push(
                '',
                ruleNum +
                    '、本对话已启用 AI 生图：当你用「图片-…」发图或发朋友圈配图时，描述须具体可画——写清场景、主体、构图、光线、色调、氛围与关键细节（50–200 字为宜），以便生图模型准确呈现；禁止空泛词如「一张自拍」「好看的图」。',
                '描述须符合人设与当下情境；禁止要求真实照片、截图或带水印/logo 的图像。'
            );
            ruleNum += 1;
        }
        if (opts.onlineNarrationEnabled) {
            rows.push(
                '',
                ruleNum +
                    '、线上旁白：你必须在正文段（</thinking> 之后、<miyavoice> 之前）穿插角色动作/神态/环境描写；格式必须是「旁白-…」并单独一行（「旁白」二字缺一不可，禁止写成「旁-」；半角或全角短横线均可），穿插在聊天气泡之间。每轮至少 2–3 条（建议不超过 6 条），贴合人设与当下情绪；' +
                    buildNarrationPersonClause(opts) +
                    '；每条须写足 30–100 字，要有具体动作、微表情、肢体细节或场景氛围，禁止一句带过或只写半句；旁白不要总重复相同动作/话题，需要演变出动作/情绪/场景等的推进；禁止把旁白写进 <thinking> 或 <miyavoice>。'
            );
            ruleNum += 1;
        }
        var formatExampleBody = [
            '引用-在干嘛呢',
            '上班呢',
            '你呢'
        ];
        if (opts.onlineNarrationEnabled) {
            var np = narrationCharSubjectParts(opts.onlineNarrationCharPerson, roleName);
            formatExampleBody.push(
                '旁白-' + np.subj + '将手机扣在膝上，指节因用力而微微泛白，目光却不受控地飘向窗外——午后的光斜切进来，在桌沿投下一道暖色，' + np.pron + '盯着那道光看了两秒，才又低头把屏幕点亮',
                '语音-路上有点堵',
                '旁白-' + np.subj + '听完语音后指尖在杯沿上轻轻敲了两下，唇角先是一抿，随即又压下去，像要把那点不合时宜的笑意藏进热气里；' + np.pron + '抬眼看了眼窗外，车流仍堵着，便把手机往掌心拢了拢',
                '图片-窗边一束逆光里的白玫瑰，花瓣上还挂着细密水珠',
                '旁白-' + np.subj + '点开图片时屏幕光映在' + np.pron + '眼底，' + np.pron + '先把亮度调低，像怕惊扰什么似的，指腹在玫瑰边缘停了一瞬，才慢慢滑到下一条消息'
            );
        } else {
            formatExampleBody.push(
                '（未开旁白则不输出旁白行）',
                '语音-路上有点堵',
                stickerEx || '（无表情包则不输出表情包行）',
                '图片-窗边一束逆光里的白玫瑰，花瓣上还挂着细密水珠'
            );
        }
        if (opts.onlineNarrationEnabled) {
            formatExampleBody.push(stickerEx || '（无表情包则不输出表情包行）');
        }
        formatExampleBody = formatExampleBody.concat([
            '位置-滨海市｜海晏区星澜路18号一层103室',
            '转账-52｜一点心意',
            '外卖-喜茶｜多肉葡萄×1、烤黑糖波波×1｜46｜送到公司前台',
            '送礼-丝绒玫瑰礼盒｜1｜今天也想让你开心一下'
        ]);
        rows = rows.concat([
            '',
            buildHeartVoiceRulesBlock(roleName, hvPreset),
            '',
            '【输出顺序】',
            '<thinking>思维过程</thinking>',
            '正文（每行一条，只写一遍，禁止 [正文] 等标记，禁止重复输出相同气泡）',
            hvPreset
                ? '<miyavoice>' +
                  (hvPreset.fields ? hvPreset.fields.length : 'N') +
                  ' 行心声</miyavoice>'
                : '<miyavoice>四行心声</miyavoice>',
            '',
            '【格式示例·' + roleName + '】',
            '<thinking>',
            '（这里写思维过程）',
            '</thinking>'
        ].concat(formatExampleBody));
        rows.push('【发朋友圈：今天风很软，想分享给你|配图1：窗边一杯热茶，蒸汽袅袅】');
        rows.push('哦哦哦');
        rows.push('<miyavoice>');
        if (hvPreset) {
            var tplModEx = global.MiyaChatHeartVoiceTemplates;
            var exLines =
                tplModEx && typeof tplModEx.buildExampleMiyavoiceLines === 'function'
                    ? tplModEx.buildExampleMiyavoiceLines(hvPreset)
                    : [];
            if (exLines.length) {
                exLines.forEach(function (line) {
                    rows.push(line);
                });
            } else {
                (hvPreset.fields || []).forEach(function (f) {
                    rows.push(f.name + '-（示例内容）');
                });
            }
        } else {
            rows.push('好感度-72');
            rows.push('欲望值-38');
            rows.push('行为动作-她将手机扣在膝上，指尖无意识地摩挲杯沿，目光飘向窗外');
            rows.push('角色心声-他回得比我想象中快……是刚好有空，还是也在等我？');
        }
        rows.push('</miyavoice>');
        if (opts.autoTranslate) {
            var trRules = global.MiyaChatTranslate;
            if (trRules && typeof trRules.buildAutoTranslateRulesBlock === 'function') {
                rows.push('', trRules.buildAutoTranslateRulesBlock(opts.translateTarget || 'zh-CN'));
            }
        }
        if (opts.momentsTranslate) {
            var trMoments = global.MiyaChatTranslate;
            if (trMoments && typeof trMoments.buildMomentsSemanticRulesBlock === 'function') {
                rows.push('', trMoments.buildMomentsSemanticRulesBlock(opts.translateTarget || 'zh-CN'));
            }
        }
        var daAddon =
            global.MiyaChatDynamicAvatar &&
            typeof global.MiyaChatDynamicAvatar.buildOnlineRulesAddon === 'function'
                ? global.MiyaChatDynamicAvatar.buildOnlineRulesAddon({
                      roleName: roleName,
                      charAvatarSwapEnabled: !!opts.charAvatarSwapEnabled,
                      userAvatarSwapEnabled: !!opts.userAvatarSwapEnabled
                  })
                : '';
        if (daAddon) rows.push('', daAddon);
        return rows.join('\n');
    }

    function parseRoleMomentsPostIntentFromLine(line) {
        var txt = trim(line);
        if (!txt) return null;
        var m = txt.match(RE_ROLE_MOMENTS_POST);
        if (!m) return null;
        var body = trim(m[1]);
        if (!body) return null;
        var parts = body
            .split('|')
            .map(function (x) {
                return trim(x);
            })
            .filter(Boolean);
        if (!parts.length) return null;
        var text = parts[0].slice(0, 5000);
        if (!text) return null;
        var translation = '';
        var imageByNo = {};
        var albumByNo = {};
        var i;
        for (i = 1; i < parts.length; i++) {
            var row = parts[i];
            var transMatch = row.match(/^译文\s*[：:]\s*([\s\S]*)$/);
            if (transMatch) {
                translation = trim(transMatch[1]).slice(0, 5000);
                continue;
            }
            var albumMatch = row.match(/^相册配图\s*(\d+)\s*[：:]\s*#(\d+)$/);
            if (albumMatch) {
                var ano = parseInt(albumMatch[1], 10);
                var aidx = parseInt(albumMatch[2], 10);
                if (ano >= 1 && ano <= 9 && aidx >= 1) albumByNo[ano] = aidx;
                continue;
            }
            var mm = row.match(/^配图\s*(\d+)\s*[：:]\s*([\s\S]*)$/);
            if (!mm) continue;
            var no = parseInt(mm[1], 10);
            if (!no || no < 1 || no > 9) continue;
            var desc = trim(mm[2]).slice(0, 2000);
            if (desc) imageByNo[no] = desc;
        }
        var images = [];
        var albumRefs = [];
        for (i = 1; i <= 9; i++) {
            if (albumByNo[i]) albumRefs.push({ slot: i, albumIndex: albumByNo[i] });
            else if (imageByNo[i]) images.push(imageByNo[i]);
        }
        var out = { text: text, images: images };
        if (albumRefs.length) out.albumRefs = albumRefs;
        if (translation) out.translation = translation;
        return out;
    }

    function stripRoleMomentsFromLines(lines) {
        var src = Array.isArray(lines) ? lines : [];
        var next = [];
        var intent = null;
        src.forEach(function (line) {
            var parsed = parseRoleMomentsPostIntentFromLine(line);
            if (parsed) {
                if (!intent) intent = parsed;
                return;
            }
            next.push(line);
        });
        return { lines: next, intent: intent };
    }

    function isRoleCallLineText(line) {
        if (!global.MiyaChatCalls) return null;
        var raw = trim(line);
        if (!raw) return null;
        if (RE_ROLE_CALL_VOICE.test(raw) || RE_LEGACY_CALL_VOICE.test(raw)) return 'voice';
        if (RE_ROLE_CALL_VIDEO.test(raw) || RE_LEGACY_CALL_VIDEO.test(raw)) return 'video';
        return null;
    }

    function parseRoleOutputLine(line, catalog, pendingQuote) {
        var raw = stripApiTimelinePrefix(trim(line)).replace(/\s*⧗\s*$/g, '').trim();
        var pending = pendingQuote != null ? trim(pendingQuote) : null;

        if (!raw) {
            return { fields: null, pendingQuote: pending };
        }

        if (/^引用[-－—]\s*$/.test(raw)) {
            return { fields: null, pendingQuote: pending };
        }

        if (isStructuralLeakLine(raw)) {
            return { fields: null, pendingQuote: pending };
        }
        if (RE_RT_HEART_VOICE.test(raw)) {
            return { fields: null, pendingQuote: pending };
        }

        if (isAvatarSwapCommandLine(raw)) {
            return { fields: null, pendingQuote: pending };
        }

        var trLine = raw.match(RE_TRANSLATION);
        if (trLine) {
            return {
                fields: null,
                pendingQuote: pending,
                translationZh: trim(trLine[1])
            };
        }

        var roleCall = isRoleCallLineText(raw);
        if (roleCall) {
            return { fields: null, pendingQuote: pending, roleCall: roleCall };
        }

        if (RE_NARRATION.test(raw)) {
            return { fields: null, pendingQuote: pending };
        }

        var recallLine = raw.match(RE_RECALL);
        if (recallLine) {
            return {
                fields: {
                    type: 'recall',
                    recallTarget: trim(recallLine[1])
                },
                pendingQuote: pending
            };
        }

        var qo = raw.match(RE_QUOTE);
        if (qo) {
            var quoteBody = trim(qo[1]);
            if (!quoteBody) {
                return { fields: null, pendingQuote: pending };
            }
            var boundary = splitQuoteReplyBoundary(quoteBody);
            if (!boundary) {
                boundary = splitQuoteBodyFromReply(quoteBody);
            }
            if (boundary) {
                var quotedOnly = normalizeQuotedSourceText(boundary.quotedText);
                var replyRaw = trim(boundary.replyText);
                if (replyRaw) {
                    var nested = parseRoleOutputLine(replyRaw, catalog, quotedOnly);
                    if (nested.fields) {
                        if (nested.fields.quoteRef == null && quotedOnly) {
                            nested.fields.quoteRef = buildQuoteRefFromPending(boundary.quotedText);
                        }
                        return { fields: nested.fields, pendingQuote: nested.pendingQuote };
                    }
                    var replyParts = splitQuotedReplyLines(boundary.replyText);
                    if (replyParts.length > 1) {
                        var first = parseRoleOutputLine(replyParts[0], catalog, quotedOnly);
                        if (first.fields) {
                            if (first.fields.quoteRef == null && quotedOnly) {
                                first.fields.quoteRef = buildQuoteRefFromPending(boundary.quotedText);
                            }
                            return { fields: first.fields, pendingQuote: first.pendingQuote };
                        }
                    }
                }
            }
            return {
                fields: null,
                pendingQuote: normalizeQuotedSourceText(quoteBody)
            };
        }

        var voice = raw.match(RE_VOICE);
        if (voice) {
            var vt = stripOrphanMarkdownEmphasis(voice[1]);
            if (pending && isQuoteEchoVoiceLine(pending, vt)) {
                return { fields: null, pendingQuote: pending };
            }
            var vf = {
                type: 'voice',
                content: '语音-' + vt,
                voiceText: vt
            };
            if (pending) {
                vf.quoteRef = buildQuoteRefFromPending(pending);
                pending = null;
            }
            return { fields: vf, pendingQuote: null };
        }

        var stk = raw.match(RE_STICKER);
        if (stk) {
            var sf = buildStickerFields(stk[1], catalog, pending);
            if (sf) {
                return { fields: sf, pendingQuote: null };
            }
            return { fields: null, pendingQuote: pending };
        }

        var img = raw.match(RE_IMAGE);
        if (img) {
            var imgDesc = trim(img[1]).slice(0, 1200);
            var imf = {
                type: 'image',
                imageKind: 'text',
                content: '图片-' + imgDesc
            };
            if (pending) {
                imf.quoteRef = buildQuoteRefFromPending(pending);
                pending = null;
            }
            return { fields: imf, pendingQuote: null };
        }

        var locLine = raw.match(RE_LOCATION);
        if (locLine) {
            var locParsed = parseLocationBody(locLine[1]);
            if (locParsed) {
                var lmf = {
                    type: 'location',
                    content: '[位置] ' + locParsed.name,
                    locationCard: {
                        name: locParsed.name,
                        address: locParsed.address,
                        lat: 0,
                        lng: 0
                    }
                };
                if (pending) {
                    lmf.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: lmf, pendingQuote: null };
            }
        }

        if (RE_TRANSFER_RECEIPT.test(raw)) {
            return { fields: null, pendingQuote: pending, receiptLine: true };
        }

        var trLine = raw.match(RE_TRANSFER);
        if (trLine) {
            var trParsed = parseTransferBody(trLine[1]);
            if (trParsed) {
                var tmf = {
                    type: 'transfer',
                    content: '[转账] ¥' + trParsed.amount,
                    redPacket: {
                        amount: trParsed.amount,
                        note: trParsed.note,
                        status: 'pending',
                        dir: 'in',
                        resolvedAt: 0
                    }
                };
                if (pending) {
                    tmf.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: tmf, pendingQuote: null };
            }
        }

        var toLine = raw.match(RE_TAKEOUT);
        if (toLine) {
            var toParsed = parseTakeoutBody(toLine[1]);
            if (toParsed) {
                var toOrder = {
                    shop: toParsed.shop,
                    items: toParsed.items,
                    amount: toParsed.amount,
                    note: toParsed.note,
                    status: 'ordered'
                };
                var tof = {
                    type: 'takeout',
                    content: formatTakeoutForApi(toOrder),
                    takeoutOrder: toOrder
                };
                if (pending) {
                    tof.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: tof, pendingQuote: null };
            }
        }

        var giftLine = raw.match(RE_GIFT);
        if (giftLine) {
            var giftParsed = parseGiftBody(giftLine[1]);
            if (giftParsed) {
                var roleGiftParcel = {
                    items: [
                        {
                            name: giftParsed.name,
                            qty: giftParsed.qty,
                            price: 0,
                            shop: '',
                            emoji: '🎁'
                        }
                    ],
                    total: 0,
                    note: giftParsed.note,
                    ribbon: 'FOR YOU',
                    status: 'delivered'
                };
                var gf = {
                    type: 'gift',
                    content: formatGiftForApi(roleGiftParcel) || '[礼品] ' + giftParsed.name,
                    giftParcel: roleGiftParcel
                };
                if (pending) {
                    gf.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: gf, pendingQuote: null };
            }
        }

        var poemLine = raw.match(RE_LOVE_POEM);
        if (poemLine) {
            var poemParsed = parseLovePoemBody(poemLine[1]);
            if (poemParsed) {
                var pf = {
                    type: 'love_poem',
                    content: formatLovePoemForApi(poemParsed) || '[情诗] ' + poemParsed.style,
                    lovePoem: poemParsed
                };
                if (pending) {
                    pf.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: pf, pendingQuote: null };
            }
        }

        var grpLine = raw.match(RE_GROUP_RED_PACKET);
        if (grpLine) {
            var grpRpMod = global.MiyaChatGroupRedPacket;
            var grpParsed =
                grpRpMod && typeof grpRpMod.resolveMessageGroupRedPacket === 'function'
                    ? grpRpMod.resolveMessageGroupRedPacket({ content: raw })
                    : grpRpMod && typeof grpRpMod.parseGroupRedPacketLineSimple === 'function'
                      ? grpRpMod.parseGroupRedPacketLineSimple(raw)
                      : null;
            if (grpParsed) {
                var grpContent =
                    grpRpMod && typeof grpRpMod.formatGroupRedPacketForApi === 'function'
                        ? grpRpMod.formatGroupRedPacketForApi(grpParsed)
                        : raw;
                var grpf = {
                    type: 'group_red_packet',
                    content: grpContent || raw,
                    groupRedPacket: grpParsed
                };
                if (pending) {
                    grpf.quoteRef = buildQuoteRefFromPending(pending);
                    pending = null;
                }
                return { fields: grpf, pendingQuote: null };
            }
        }

        var tf = { type: 'text', content: stripOrphanMarkdownEmphasis(raw) };
        if (pending) {
            tf.quoteRef = buildQuoteRefFromPending(pending);
            pending = null;
        }
        return { fields: tf, pendingQuote: null };
    }

    function expandCollapsedOutputLines(lines) {
        var arr = Array.isArray(lines) ? lines : [];
        var aw = global.MiyaChatAwareness;
        var out = [];
        arr.forEach(function (line) {
            var base = String(line || '').trim();
            if (!base) return;
            var segs =
                aw && typeof aw.splitCollapsedTimelineSegments === 'function'
                    ? aw.splitCollapsedTimelineSegments(base)
                    : [base];
            if (segs.length <= 1) segs = [segs[0] || base];
            segs.forEach(function (seg) {
                var typed = splitCollapsedOnlineTypeLines(seg);
                if (typed.length > 1) typed.forEach(function (s) { if (s) out.push(s); });
                else out.push(typed[0] || seg);
            });
        });
        return out.filter(Boolean);
    }

    /** 模型把思维链/规划草稿泄漏进正文时的识别 */
    function looksLikeMetaPlanningText(text) {
        var t = trim(text);
        if (!t) return false;
        if (/^\d+\.\s*\*{1,2}(?:分析|角色设定|制定|输出|草稿)/.test(t)) return true;
        if (/(?:\*\s*){1,2}(?:分析当前情境|角色设定适配|制定正文回复|草稿拟定)(?:\*\s*){1,2}/.test(t)) {
            return true;
        }
        if (/^\*\s+\*{1,2}/.test(t) && t.length > 160) return true;
        if (/\d+\.\s*\*{1,2}[^*\n]{4,40}\*{1,2}/.test(t) && t.length > 200) return true;
        return false;
    }

    /** 从「气泡1：…气泡2：…」草稿段提取实际对白 */
    function extractDraftBubbleLines(text) {
        var raw = String(text || '');
        var re = /气泡\s*\d+\s*[：:]\s*/g;
        if (!re.test(raw)) return [];
        re.lastIndex = 0;
        var parts = [];
        var lastEnd = null;
        var m;
        while ((m = re.exec(raw)) !== null) {
            if (lastEnd != null) parts.push(trim(raw.slice(lastEnd, m.index)));
            lastEnd = m.index + m[0].length;
        }
        if (lastEnd != null) parts.push(trim(raw.slice(lastEnd)));
        return parts.filter(function (s) {
            return s && s !== '…' && s !== '...';
        });
    }

    function splitShortStyleBubbleChunks(text) {
        var raw = trim(text);
        if (!raw || raw.length < 28) return [raw];
        if (
            RE_QUOTE.test(raw) ||
            RE_STICKER.test(raw) ||
            RE_VOICE.test(raw) ||
            RE_NARRATION.test(raw) ||
            RE_RT_FORBIDDEN.test(raw)
        ) {
            return [raw];
        }
        var chunks = raw.split(/(?<=[。！？!?…])\s+/).map(trim).filter(Boolean);
        if (chunks.length > 1 && chunks.every(function (c) { return c.length <= 120; })) return chunks;
        return [raw];
    }

    /** 剥掉泄漏的规划段，并尽量拆成多条气泡行 */
    function sanitizeRoleOutputLines(lines) {
        var arr = Array.isArray(lines) ? lines.slice() : [];
        if (arr.length === 1 && looksLikeMetaPlanningText(arr[0])) {
            var onlyDrafts = extractDraftBubbleLines(arr[0]);
            if (onlyDrafts.length) return onlyDrafts;
            return [];
        }
        var out = [];
        arr.forEach(function (line) {
            var txt = trim(line);
            if (!txt) return;
            if (looksLikeMetaPlanningText(txt)) {
                var drafts = extractDraftBubbleLines(txt);
                if (drafts.length) drafts.forEach(function (d) { out.push(d); });
                return;
            }
            var inlineDrafts = extractDraftBubbleLines(txt);
            if (inlineDrafts.length >= 2) {
                inlineDrafts.forEach(function (d) { out.push(d); });
                return;
            }
            if (txt.length > 80) {
                splitShortStyleBubbleChunks(txt).forEach(function (d) { out.push(d); });
            } else {
                out.push(txt);
            }
        });
        return out
            .map(stripOrphanMarkdownEmphasis)
            .filter(Boolean);
    }

    function parseRoleOutputLines(lines, catalog) {
        var meta = parseRoleOutputLinesMeta(lines, catalog);
        return meta.bubbles;
    }

    function parseRoleOutputLinesMeta(lines, catalog) {
        var arr = collapseDuplicateBubbleLines(
            filterStructuralLeakLines(
                expandArrQuoteLines(sanitizeRoleOutputLines(expandCollapsedOutputLines(lines)))
            )
        );
        var out = [];
        var pending = null;
        var pendingRoleCall = null;
        arr.forEach(function (line) {
            var r = parseRoleOutputLine(line, catalog, pending);
            pending = r.pendingQuote;
            if (r.roleCall) pendingRoleCall = r.roleCall;
            if (r.translationZh && out.length) {
                var last = out[out.length - 1];
                if (last && (last.type === 'text' || last.type === 'voice')) {
                    var trMod = global.MiyaChatTranslate;
                    if (trMod && typeof trMod.attachTranslationToBubbleFields === 'function') {
                        trMod.attachTranslationToBubbleFields(last, r.translationZh);
                    } else {
                        last.translationZh = r.translationZh;
                    }
                }
            } else if (r.fields) out.push(r.fields);
        });
        if (pending) {
            var pendingStk = pending.match(RE_STICKER);
            if (pendingStk) {
                var pendingSf = buildStickerFields(pendingStk[1], catalog, null);
                if (pendingSf) {
                    out.push(pendingSf);
                    pending = null;
                }
            } else {
                out.push({
                    type: 'text',
                    content: stripOrphanMarkdownEmphasis(pending)
                });
            }
        }
        return { bubbles: dedupeParsedRoleBubbles(out), pendingRoleCall: pendingRoleCall };
    }

    function isTransferReceiptText(text) {
        return RE_TRANSFER_RECEIPT.test(trim(stripApiTimelinePrefix(text)));
    }

    function stripTransferReceiptLines(lines) {
        if (!Array.isArray(lines)) return [];
        return lines.filter(function (line) {
            return !isTransferReceiptText(line);
        });
    }

    function stripUnknownStickerLines(lines, catalog) {
        if (!Array.isArray(lines)) return [];
        return lines.filter(function (line) {
            return !isUnknownStickerLine(line, catalog);
        });
    }

    function stripUnknownStickerLines(lines, catalog) {
        if (!Array.isArray(lines)) return [];
        return lines.filter(function (line) {
            return !isUnknownStickerLine(line, catalog);
        });
    }

    function parseNarrationLineToBody(text) {
        var raw = String(text == null ? '' : text);
        var line = raw
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(function (s) {
                return trim(s);
            })
            .filter(Boolean)
            .join(' ')
            .trim();
        if (!line) return '';
        var dash = line.match(RE_NARRATION);
        if (dash) return trim(dash[1]);
        var legacy = line.match(/^【\s*旁白\s*(?:[:：]\s*([\s\S]*?))?\s*】\s*([\s\S]*)$/);
        if (!legacy) return '';
        return trim(String((legacy[1] || '') + (legacy[2] || '')));
    }

    function extractNarrationFromLines(lines, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var narrationEnabled = !!opts.narrationEnabled;
        var src = Array.isArray(lines) ? lines : [];
        var outLines = [];
        var narrationOps = [];
        var bubbleIndex = -1;
        src.forEach(function (line) {
            var txt = trim(line);
            if (!txt) return;
            var body = narrationEnabled ? parseNarrationLineToBody(txt) : '';
            if (body) {
                narrationOps.push({ text: body, afterBubbleIndex: bubbleIndex });
                return;
            }
            outLines.push(line);
            bubbleIndex += 1;
        });
        return { lines: outLines, narrationOps: narrationOps };
    }

    function isOnlineNarrationMessage(m) {
        return !!(m && m.role === 'system' && String(m.systemKind || '') === 'online-narration');
    }

    function isUserOnlineNarrationMessage(m) {
        return !!(isOnlineNarrationMessage(m) && String(m.narrationFrom || '') === 'user');
    }

    function isCharacterOnlineNarrationMessage(m) {
        return !!(isOnlineNarrationMessage(m) && !isUserOnlineNarrationMessage(m));
    }

    function formatNarrationForApi(m) {
        var body = trim(m && m.content);
        if (!body) return '';
        return '旁白-' + body;
    }

    function isSummaryNoticeMessage(m) {
        if (!m || m.role !== 'system') return false;
        if (String(m.systemKind || '') === 'chat-summary-notice') return true;
        var t = trim(m.content);
        if (/^已总结好一段内容（第\s*\d+[–\-—]\d+\s*条消息）$/.test(t)) return true;
        if (/^已生成合卷（/.test(t)) return true;
        return false;
    }

    function isAlbumAvatarChangeMessage(m) {
        if (!m || m.role !== 'system') return false;
        if (String(m.systemKind || '') === 'album-avatar-change') return true;
        var c = String(m.content || '');
        return c.indexOf('【相册·换头像】') === 0 || c.indexOf('【相册·换头像·') === 0;
    }

    function shouldHideFromUi(m) {
        return isAlbumAvatarChangeMessage(m);
    }

    function isRoomInvisibleMessage(m) {
        if (shouldOmitMessage(m)) return true;
        if (shouldHideFromUi(m)) return true;
        return false;
    }

    function formatAlbumAvatarChangeForApi(m) {
        return trim(m && m.content);
    }

    function shouldOmitMessage(m) {
        if (!m || m.deleted) return true;
        if (m.momentsMemory) return true;
        if (m.type === 'diary_peek_context') return true;
        if (isSummaryNoticeMessage(m)) return true;
        if (m.role === 'system' && String(m.content || '').indexOf('【朋友圈·留痕·') === 0) return true;
        if (m.callId && m.type !== 'call_capsule') return true;
        if (isUnknownStickerMessage(m)) return true;
        if (m.type === 'text' && isTransferReceiptText(m.content)) return true;
        var t = stripApiTimelinePrefix(trim(m.content));
        if (t && isTransferReceiptText(t)) return true;
        if (m.type === 'text' && isRoleCallLineText(t)) return true;
        return false;
    }

    function pickTajiePostShare(m) {
        if (!m) return null;
        if (m.tajiePostShare && typeof m.tajiePostShare === 'object') return m.tajiePostShare;
        if (m.weijiePostShare && typeof m.weijiePostShare === 'object') return m.weijiePostShare;
        return null;
    }

    function pickTajieProfileShare(m) {
        if (!m) return null;
        if (m.tajieProfileShare && typeof m.tajieProfileShare === 'object') return m.tajieProfileShare;
        if (m.weijieProfileShare && typeof m.weijieProfileShare === 'object') return m.weijieProfileShare;
        return null;
    }

    function parseDisplayPayload(m) {
        if (!m || m.deleted) {
            return { kind: 'deleted' };
        }
        if (m.type === 'call_capsule') {
            return { kind: 'call_capsule', msg: m };
        }
        if (m.type === 'listen_together_capsule') {
            return { kind: 'listen_together_capsule', msg: m };
        }
        if (m.type === 'couple_space_invite' && m.coupleSpaceInvite) {
            return { kind: 'couple_space_invite', msg: m };
        }
        if (m.type === 'html' || m.renderAsHtml) {
            var htmlApi = global.MiyaChatHtml;
            var src = trim(m.htmlRaw || m.content || '');
            var hp = htmlApi && htmlApi.buildHtmlPayloadFromText ? htmlApi.buildHtmlPayloadFromText(src, true) : null;
            if (hp) {
                return {
                    kind: 'html',
                    msg: m,
                    html: hp.html,
                    htmlRaw: hp.raw,
                    useIframe: hp.useIframe,
                    iframeSrcdoc: hp.iframeSrcdoc
                };
            }
        }
        if (shouldOmitMessage(m)) {
            return { kind: 'omit' };
        }
        if (m.type === 'image') {
            if (m.imageKind === 'text' || (!m.imageDataKey && trim(m.content) && trim(m.content) !== '[图片]')) {
                var cap = trim(m.content).replace(/^图片[-－—]\s*/, '');
                return { kind: 'textImage', msg: m, caption: cap || trim(m.content) };
            }
            if (m.imageDataKey) return { kind: 'photo', msg: m };
        }
        if (m.type === 'sticker') {
            if (m.stickerBlobId || m.stickerUrl) {
                return {
                    kind: 'sticker',
                    msg: m,
                    stickerBlobId: m.stickerBlobId || '',
                    stickerUrl: m.stickerUrl || '',
                    stickerName: m.stickerName
                };
            }
            if (isUnknownStickerMessage(m)) {
                return { kind: 'omit' };
            }
            var stSticker = global.miyaChatStore;
            var catSticker = stSticker ? collectStickerCatalogAll(stSticker) : [];
            var hitSticker = resolveStickerByName(extractStickerNameFromMessage(m), catSticker);
            if (hitSticker) {
                return {
                    kind: 'sticker',
                    msg: m,
                    stickerName: hitSticker.name,
                    stickerBlobId: hitSticker.blobId || '',
                    stickerUrl: hitSticker.url || '',
                    quoteRef: m.quoteRef || null
                };
            }
            return { kind: 'omit' };
        }
        if (m.type === 'location' && m.locationCard) return { kind: 'location', msg: m };
        if (m.type === 'transfer' && m.redPacket) return { kind: 'transfer', msg: m };
        if (m.type === 'takeout' && m.takeoutOrder) return { kind: 'takeout', msg: m };
        if (m.type === 'gift' && m.giftParcel) return { kind: 'gift', msg: m };
        var grpRpDisplay = global.MiyaChatGroupRedPacket;
        if (grpRpDisplay && typeof grpRpDisplay.resolveMessageGroupRedPacket === 'function') {
            var grpResolved = grpRpDisplay.resolveMessageGroupRedPacket(m);
            if (grpResolved) {
                return {
                    kind: 'group_red_packet',
                    msg: Object.assign({}, m, { type: 'group_red_packet', groupRedPacket: grpResolved })
                };
            }
        }
        if (m.type === 'group_red_packet' && m.groupRedPacket) return { kind: 'group_red_packet', msg: m };
        if (m.type === 'love_poem' && m.lovePoem) return { kind: 'love_poem', msg: m };
        if (m.type === 'match_record' && m.matchRecord) return { kind: 'match_record', msg: m };
        if (m.type === 'sayguess_record' && m.sayguessRecord) return { kind: 'sayguess_record', msg: m };
        if (m.type === 'voice') {
            return {
                kind: 'voice',
                msg: m,
                voiceText: stripApiTimelinePrefix(
                    m.voiceText || trim(m.content).replace(/^语音[-－—]\s*/, '')
                ),
                quoteRef: m.quoteRef || null
            };
        }
        if (m.type === 'karaoke' && m.karaokeIdbKey) {
            return {
                kind: 'karaoke',
                msg: m,
                karaokeTitle: trim(m.karaokeTitle),
                karaokeArtist: trim(m.karaokeArtist),
                karaokeMode: m.karaokeMode || 'follow',
                karaokeDurationSec: m.karaokeDurationSec,
                karaokeLrcText: String(m.karaokeLrcText || ''),
                karaokeSungLrcText: String(m.karaokeSungLrcText || ''),
                karaokeIdbKey: m.karaokeIdbKey
            };
        }
        var tajiePostShare = pickTajiePostShare(m);
        if (tajiePostShare) {
            return { kind: 'tajiePostShare', msg: m, share: tajiePostShare };
        }
        var tajieProfileShare = pickTajieProfileShare(m);
        if (tajieProfileShare) {
            return { kind: 'tajieProfileShare', msg: m, share: tajieProfileShare };
        }

        var text = stripApiTimelinePrefix(trim(m.content));
        if (m.role === 'assistant') {
            var engStrip = global.miyaChatEngine;
            if (engStrip && typeof engStrip.stripThinkingForApi === 'function') {
                text = engStrip.stripThinkingForApi(text);
            }
        }
        var quoteRef = m.quoteRef || null;
        var recoveredFields = recoverQuoteReplyFields(text, quoteRef);
        text = recoveredFields.text;
        quoteRef = recoveredFields.quoteRef;

        if (quoteRef && quoteRef.text && text) {
            var inlineQo = text.match(RE_QUOTE);
            if (inlineQo) {
                var inlineBoundary = splitQuoteReplyBoundary(inlineQo[1]);
                if (inlineBoundary) {
                    text = trim(inlineBoundary.replyText);
                    quoteRef = Object.assign({}, quoteRef, {
                        text: normalizeQuoteText(inlineBoundary.quotedText)
                    });
                }
            }
        }

        if (!quoteRef && text) {
            var qo = text.match(RE_QUOTE);
            if (qo) {
                var inlineFromContent = splitQuoteReplyBoundary(qo[1]);
                if (inlineFromContent) {
                    quoteRef = {
                        dir: m.role === 'user' ? 'in' : 'out',
                        text: normalizeQuoteText(inlineFromContent.quotedText)
                    };
                    text = trim(inlineFromContent.replyText);
                } else {
                    quoteRef = {
                        dir: m.role === 'user' ? 'in' : 'out',
                        text: normalizeQuoteText(qo[1])
                    };
                    text = '';
                }
            }
        }

        if (text) {
            if (m.role === 'assistant') {
                var voiceAsst = text.match(RE_VOICE);
                if (voiceAsst) {
                    return {
                        kind: 'voice',
                        msg: m,
                        voiceText: trim(voiceAsst[1]),
                        quoteRef: quoteRef
                    };
                }
            }
            var stk = text.match(RE_STICKER);
            if (stk) {
                var stkName = trim(stk[1]);
                if (m.stickerBlobId || m.stickerUrl) {
                    return {
                        kind: 'sticker',
                        msg: m,
                        stickerName: stkName,
                        stickerBlobId: m.stickerBlobId || '',
                        stickerUrl: m.stickerUrl || '',
                        quoteRef: quoteRef
                    };
                }
                var st = global.miyaChatStore;
                var cat = st ? collectStickerCatalogAll(st) : [];
                var hit = resolveStickerWithFallback(stkName, cat);
                if (hit) {
                    return {
                        kind: 'sticker',
                        msg: m,
                        stickerName: hit.name,
                        stickerBlobId: hit.blobId || '',
                        stickerUrl: hit.url || '',
                        quoteRef: quoteRef
                    };
                }
                return {
                    kind: 'sticker',
                    msg: m,
                    stickerName: stkName,
                    stickerBlobId: '',
                    stickerUrl: '',
                    quoteRef: quoteRef
                };
            }
            var imgLine = text.match(RE_IMAGE);
            if (imgLine) {
                return {
                    kind: 'textImage',
                    msg: m,
                    caption: trim(imgLine[1]),
                    quoteRef: quoteRef
                };
            }
            var locLine = text.match(RE_LOCATION);
            if (locLine) {
                var locParsed = parseLocationBody(locLine[1]);
                if (locParsed) {
                    return {
                        kind: 'location',
                        msg: Object.assign({}, m, {
                            type: 'location',
                            content: '[位置] ' + locParsed.name,
                            locationCard: {
                                name: locParsed.name,
                                address: locParsed.address,
                                lat: 0,
                                lng: 0
                            }
                        })
                    };
                }
            }
            var trLine = text.match(RE_TRANSFER);
            if (trLine) {
                var trParsed = parseTransferBody(trLine[1]);
                if (trParsed) {
                    return {
                        kind: 'transfer',
                        msg: Object.assign({}, m, {
                            type: 'transfer',
                            content: '[转账] ¥' + trParsed.amount,
                            redPacket: {
                                amount: trParsed.amount,
                                note: trParsed.note,
                                status: m.redPacket && m.redPacket.status ? m.redPacket.status : 'pending',
                                dir: m.redPacket && m.redPacket.dir ? m.redPacket.dir : 'in',
                                resolvedAt: m.redPacket && m.redPacket.resolvedAt ? m.redPacket.resolvedAt : 0
                            }
                        })
                    };
                }
            }
            var toLine = text.match(RE_TAKEOUT);
            if (toLine) {
                var toParsed = parseTakeoutBody(toLine[1]);
                if (toParsed) {
                    return {
                        kind: 'takeout',
                        msg: Object.assign({}, m, {
                            type: 'takeout',
                            content: formatTakeoutForApi(toParsed),
                            takeoutOrder: {
                                shop: toParsed.shop,
                                items: toParsed.items,
                                amount: toParsed.amount,
                                note: toParsed.note,
                                status: (m.takeoutOrder && m.takeoutOrder.status) || 'ordered'
                            }
                        })
                    };
                }
            }
            var giftLine = text.match(RE_GIFT);
            if (giftLine && !/^送礼合计/.test(text) && !/^送礼项/.test(text)) {
                var giftParsed = parseGiftBody(giftLine[1]);
                if (giftParsed) {
                    var roleGiftParcel = {
                        items: [
                            {
                                name: giftParsed.name,
                                qty: giftParsed.qty,
                                price: 0,
                                shop: '',
                                emoji: '🎁'
                            }
                        ],
                        total: 0,
                        note: giftParsed.note,
                        ribbon: 'FOR YOU',
                        status: 'delivered'
                    };
                    return {
                        kind: 'gift',
                        msg: Object.assign({}, m, {
                            type: 'gift',
                            content: formatGiftForApi(roleGiftParcel) || '[礼品] ' + giftParsed.name,
                            giftParcel: m.giftParcel || roleGiftParcel
                        })
                    };
                }
            }
            var poemLine = text.match(RE_LOVE_POEM);
            if (poemLine) {
                var poemParsed = parseLovePoemBody(poemLine[1]);
                if (poemParsed) {
                    return {
                        kind: 'love_poem',
                        msg: Object.assign({}, m, {
                            type: 'love_poem',
                            content: formatLovePoemForApi(poemParsed) || '[情诗] ' + poemParsed.style,
                            lovePoem: m.lovePoem || poemParsed
                        })
                    };
                }
            }
            var grpLine = text.match(RE_GROUP_RED_PACKET);
            if (grpLine) {
                var grpRpFallback = global.MiyaChatGroupRedPacket;
                var grpFromText =
                    grpRpFallback && typeof grpRpFallback.resolveMessageGroupRedPacket === 'function'
                        ? grpRpFallback.resolveMessageGroupRedPacket(m)
                        : null;
                if (grpFromText) {
                    return {
                        kind: 'group_red_packet',
                        msg: Object.assign({}, m, {
                            type: 'group_red_packet',
                            groupRedPacket: grpFromText
                        })
                    };
                }
            }
        }

        if (m.role === 'assistant') {
            text = stripOrphanMarkdownEmphasis(text);
        }
        return { kind: 'text', msg: m, text: text, quoteRef: quoteRef };
    }

    function callContextPrefix(m) {
        if (!m || !m.callId) return '';
        var ck = String(m.callKind || (m.callCapsule && m.callCapsule.kind) || '') === 'video' ? '视频通话' : '语音通话';
        return '〔' + ck + '〕';
    }

    function formatCallDurationSec(sec) {
        var s = Math.max(0, Math.floor(Number(sec) || 0));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    function formatListenTogetherCapsuleForApi(m) {
        if (!m || m.type !== 'listen_together_capsule' || !m.listenTogetherCapsule) return '';
        var cap = m.listenTogetherCapsule;
        var dur = formatCallDurationSec(cap.durationSec);
        var song = trim(cap.trackTitle) || '未记录歌曲';
        var artist = trim(cap.trackArtist);
        var head = '〔一起听·记录·时长' + dur + '·《' + song + '》' + (artist ? '— ' + artist : '') + '〕';
        var items = Array.isArray(cap.items) ? cap.items : [];
        if (!items.length) {
            return head + '（本次一起听无文字聊天）';
        }
        var lines = [head, '【以下为该次一起听中的聊天，不是微信文字聊天】'];
        items.forEach(function (it) {
            var who = it.role === 'user' ? '用户' : (it.role === 'system' ? '系统' : '角色');
            var t = trim(it.text);
            if (t) lines.push(who + '：' + t);
        });
        lines.push('〔一起听·记录结束〕');
        return lines.join('\n');
    }

    function formatCallCapsuleForApi(m) {
        if (!m || m.type !== 'call_capsule' || !m.callCapsule) return '';
        var cap = m.callCapsule;
        var kind = cap.kind === 'video' ? '视频通话' : '语音通话';
        var dur = formatCallDurationSec(cap.durationSec);
        var items = Array.isArray(cap.items) ? cap.items : [];
        if (!items.length) {
            return '〔' + kind + '·记录·时长' + dur + '〕（本次通话无文字对白）';
        }
        var lines = [
            '〔' + kind + '·期间对白·时长' + dur + '〕',
            '【以下为该次' + kind + '中的实时口语，不是微信文字聊天】'
        ];
        items.forEach(function (it) {
            var who = it.role === 'user' ? '用户' : '角色';
            var t = trim(it.text);
            if (t) lines.push(who + '：' + t);
        });
        lines.push('〔' + kind + '·记录结束〕');
        return lines.join('\n');
    }

    function formatDiaryPeekContextForApi(m) {
        var peek = global.miyaDiaryPeek;
        if (peek && typeof peek.formatDiaryPeekContextForApi === 'function') {
            return peek.formatDiaryPeekContextForApi(m);
        }
        return String(m && m.content || '').trim();
    }

    /** 撤回：在各自近期消息窗口内按原话匹配（默认最近 20 条） */
    var RECALL_RECENT_LIMIT = 20;

    function normalizeRecallTarget(text) {
        return trim(stripApiTimelinePrefix(text))
            .replace(/^语音[-－—]\s*/, '')
            .replace(/^表情包[-－—]\s*/, '')
            .replace(/^图片[-－—]\s*/, '')
            .replace(/\s+/g, ' ');
    }

    function messageMatchesRecallTarget(msg, targetText) {
        if (!msg || msg.recalled || msg.deleted) return false;
        var target = normalizeRecallTarget(targetText);
        if (!target) return false;
        var body = normalizeRecallTarget(formatMessageBodyOnly(msg));
        if (body && (body === target || body.indexOf(target) >= 0 || target.indexOf(body) >= 0)) {
            return true;
        }
        var raw = normalizeRecallTarget(msg.content);
        if (raw && (raw === target || raw.indexOf(target) >= 0 || target.indexOf(raw) >= 0)) {
            return true;
        }
        if (msg.type === 'voice' && msg.voiceText) {
            var vt = normalizeRecallTarget(msg.voiceText);
            if (vt && (vt === target || vt.indexOf(target) >= 0 || target.indexOf(vt) >= 0)) return true;
        }
        return false;
    }

    function formatRecallForApi(m) {
        var meta = m && m.recallMeta;
        if (!meta) return '';
        var by = meta.by === 'user' ? '你' : trim(meta.byName) || '角色';
        var preview = trim(meta.preview);
        if (preview) return by + '撤回了一条消息：' + preview;
        return by + '撤回了一条消息';
    }

    function canRecallUserMessage(st, chatId, msg) {
        if (!st || !msg || msg.role !== 'user' || msg.recalled || msg.deleted) return false;
        if (typeof st.isRecentRecallableMessage !== 'function') return false;
        return st.isRecentRecallableMessage(chatId, 'user', msg.id);
    }

    /** 用户上传的真实图片（有 blob）；与 parseDisplayPayload / photoNeedsVision 判定一致 */
    function isRealChatPhotoMessage(m) {
        if (!m || m.deleted || m.type !== 'image') return false;
        if (m.imageKind === 'text') return false;
        return !!trim(m.imageDataKey);
    }

    function formatMessageForApi(m) {
        if (!m || m.deleted) return '';
        if (m.recalled && m.recallMeta) return formatRecallForApi(m);
        /* 用户旁白始终进上下文；角色旁白才受 excludedFromContext /「旁白注入上下文」开关约束 */
        if (isOnlineNarrationMessage(m)) {
            if (isUserOnlineNarrationMessage(m)) return formatNarrationForApi(m);
            if (m.excludedFromContext) return '';
            return formatNarrationForApi(m);
        }
        if (m.excludedFromContext) return '';
        if (m.type === 'diary_peek_context') return formatDiaryPeekContextForApi(m);
        if (m.type === 'diary_peek_notice') return '';
        if (m.type === 'call_capsule') return formatCallCapsuleForApi(m);
        if (m.type === 'listen_together_capsule') return formatListenTogetherCapsuleForApi(m);
        if (isAlbumAvatarChangeMessage(m)) return formatAlbumAvatarChangeForApi(m);
        if (m.type === 'html' || m.renderAsHtml) return '〔HTML 交互页〕';
        if (shouldOmitMessage(m)) return '';
        var callPre = callContextPrefix(m);
        var lines = [];
        if (m.quoteRef && m.quoteRef.text) {
            lines.push('引用-' + m.quoteRef.text);
        }
        if (m.type === 'voice') {
            var vBody = m.voiceText || trim(m.content).replace(/^语音[-－—]\s*/, '');
            lines.push((callPre ? callPre + ' ' : '') + '语音-' + vBody);
            return lines.join('\n');
        }
        if (m.type === 'karaoke') {
            var kMode = m.karaokeMode === 'instrumental' ? '纯伴奏' : '跟唱';
            var kTitle = trim(m.karaokeTitle) || trim(m.content).replace(/^【K歌[^】]*】\s*/, '') || '未命名';
            var kArtist = trim(m.karaokeArtist);
            var kDur =
                typeof m.karaokeDurationSec === 'number' && m.karaokeDurationSec > 0
                    ? Math.round(m.karaokeDurationSec)
                    : 0;
            lines.push(
                'K歌分享-用户演唱了一首歌曲并附录音；请结合歌名、模式、时长与下列歌词理解其演唱内容'
            );
            lines.push('K歌-' + kMode + '-' + kTitle + (kArtist ? '-' + kArtist : '') + '-时长' + kDur + '秒');
            var sungBody = trim(m.karaokeSungLrcText);
            var lrcBody = trim(m.karaokeLrcText);
            if (sungBody) {
                lines.push('K唱段-以下为本次演唱实际覆盖到的歌词（按时间轴截取）');
                sungBody.split(/\n/).forEach(function (ln) {
                    var t = trim(ln);
                    if (t) lines.push('唱词-' + t);
                });
            }
            if (lrcBody && lrcBody !== sungBody) {
                lines.push('K歌词-以下为该曲歌词全文（含时间轴则按行理解）');
                lrcBody.split(/\n/).forEach(function (ln) {
                    var t = trim(ln);
                    if (t) lines.push('歌词-' + t);
                });
            } else if (!sungBody && lrcBody) {
                lines.push('K歌词-以下为该曲歌词全文（含时间轴则按行理解）');
                lrcBody.split(/\n/).forEach(function (ln) {
                    var t = trim(ln);
                    if (t) lines.push('歌词-' + t);
                });
            } else if (!sungBody && !lrcBody) {
                lines.push('K歌词-（本条无歌词文本，仅音频演唱）');
            }
            return lines.join('\n');
        }
        if (m.type === 'sticker') {
            lines.push('表情包-' + (m.stickerName || ''));
            return lines.join('\n');
        }
        if (m.type === 'image') {
            var imgBody = '';
            if (isRealChatPhotoMessage(m)) {
                imgBody = trim(m.imageVisionText);
                if (!imgBody) imgBody = trim(m.content);
                if (imgBody === '[图片]') imgBody = '';
            } else {
                imgBody = trim(m.content).replace(/^图片[-－—]\s*/, '');
                if (!imgBody || imgBody === '[图片]' || imgBody === '图片') {
                    imgBody = trim(m.content);
                }
            }
            if (imgBody && imgBody !== '[图片]') {
                if (!/^图片[-－—]/.test(imgBody)) lines.push('图片-' + imgBody);
                else lines.push(imgBody);
            } else if (lines.length) lines.push('[图片]');
            return lines.length ? lines.join('\n') : '[图片]';
        }
        if (m.type === 'location') {
            var locLine = formatLocationApiLine(m.locationCard);
            if (locLine) lines.push(locLine);
            else if (lines.length) lines.push('[位置]');
            return lines.length ? lines.join('\n') : '[位置]';
        }
        if (m.type === 'transfer') {
            var trApi = formatTransferApiLine(m.redPacket);
            if (trApi) lines.push(trApi);
            else if (lines.length) lines.push('[转账]');
            return lines.length ? lines.join('\n') : '[转账]';
        }
        if (isTakeoutMessage(m)) {
            var toApi = formatTakeoutFromMessage(m);
            if (toApi) lines.push(toApi);
            else if (lines.length) lines.push('[外卖]');
            return lines.length ? lines.join('\n') : '[外卖]';
        }
        if (m.type === 'gift') {
            var gpResolved = resolveGiftParcelFromMessage(m);
            var giftApi = formatGiftForApi(gpResolved);
            if (giftApi) lines.push(giftApi);
            else if (lines.length) lines.push('[礼品]');
            return lines.length ? lines.join('\n') : '[礼品]';
        }
        if (m.type === 'group_red_packet' && m.groupRedPacket) {
            var grpRpApi = global.MiyaChatGroupRedPacket;
            var grpLine =
                grpRpApi && typeof grpRpApi.formatGroupRedPacketForApi === 'function'
                    ? grpRpApi.formatGroupRedPacketForApi(m.groupRedPacket)
                    : trim(m.content);
            if (grpLine) lines.push(grpLine);
            else if (lines.length) lines.push('[红包]');
            return lines.length ? lines.join('\n') : '[红包]';
        }
        if (m.type === 'love_poem' || isLovePoemMessage(m)) {
            var lpResolved = resolveLovePoemFromMessage(m);
            var poemApi = formatLovePoemForApi(lpResolved);
            if (poemApi) lines.push(poemApi);
            else if (lines.length) lines.push('[情诗]');
            return lines.length ? lines.join('\n') : '[情诗]';
        }
        if (m.type === 'match_record' || (m.matchRecord && typeof m.matchRecord === 'object')) {
            var digest = trim(m.content);
            if (!digest && m.matchRecord) {
                digest = '[赛事记录] ' + trim(m.matchRecord.eventName) + ' · ' + trim(m.matchRecord.eventItemName);
                if (trim(m.matchRecord.narrative)) digest += '\n' + trim(m.matchRecord.narrative);
                if (Array.isArray(m.matchRecord.reactions)) {
                    m.matchRecord.reactions.forEach(function (rx) {
                        if (rx && trim(rx.text)) digest += '\n' + trim(rx.name || '角色') + '：' + trim(rx.text);
                    });
                }
            }
            if (digest) lines.push(digest);
            else if (lines.length) lines.push('[赛事记录]');
            return lines.length ? lines.join('\n') : '[赛事记录]';
        }
        if (m.type === 'sayguess_record' || (m.sayguessRecord && typeof m.sayguessRecord === 'object')) {
            var sgDigest = trim(m.content);
            if (!sgDigest && m.sayguessRecord) {
                sgDigest = '[你说我猜] ' + trim(m.sayguessRecord.bankName || '');
            }
            if (sgDigest) lines.push(sgDigest);
            else if (lines.length) lines.push('[你说我猜]');
            return lines.length ? lines.join('\n') : '[你说我猜]';
        }
        var tajiePostApi = pickTajiePostShare(m);
        if (tajiePostApi) {
            lines.push('【TA界帖子分享】用户从 TA界 转发了以下帖子，请结合正文与热评理解其分享意图');
            if (trim(tajiePostApi.authorDisplay)) lines.push('作者-' + trim(tajiePostApi.authorDisplay));
            if (trim(tajiePostApi.textPreview)) lines.push('正文-' + trim(tajiePostApi.textPreview));
            if (trim(tajiePostApi.location)) lines.push('地点-' + trim(tajiePostApi.location));
            (Array.isArray(tajiePostApi.commentPreview) ? tajiePostApi.commentPreview : []).forEach(function (c) {
                var t = trim(c);
                if (t) lines.push('热评-' + t);
            });
            return lines.join('\n');
        }
        var tajieProfileApi = pickTajieProfileShare(m);
        if (tajieProfileApi) {
            lines.push('【TA界主页分享】用户分享了 TA界 个人主页，请结合资料与近期动态理解');
            var tajieName = trim(tajieProfileApi.displayName || tajieProfileApi.nickname);
            if (tajieName) lines.push('昵称-' + tajieName);
            if (trim(tajieProfileApi.bioLine1)) lines.push('简介-' + trim(tajieProfileApi.bioLine1));
            if (trim(tajieProfileApi.bioLine2)) lines.push('简介2-' + trim(tajieProfileApi.bioLine2));
            if (tajieProfileApi.followers != null) lines.push('粉丝-' + String(tajieProfileApi.followers));
            if (tajieProfileApi.following != null) lines.push('关注-' + String(tajieProfileApi.following));
            if (tajieProfileApi.postCount != null) lines.push('帖子数-' + String(tajieProfileApi.postCount));
            (Array.isArray(tajieProfileApi.recentPostsSummary) ? tajieProfileApi.recentPostsSummary : []).forEach(function (p, i) {
                var t = trim(p);
                if (t) lines.push('近期帖' + (i + 1) + '-' + t);
            });
            (Array.isArray(tajieProfileApi.commentsDigest) ? tajieProfileApi.commentsDigest : [])
                .slice(0, 8)
                .forEach(function (c) {
                    var t = trim(c);
                    if (t) lines.push('互动-' + t);
                });
            return lines.join('\n');
        }
        var body = stripApiTimelinePrefix(trim(m.content));
        if (body) lines.push((callPre ? callPre + ' ' : '') + body);
        return lines.join('\n');
    }

    function stripLeadingQuoteLines(text) {
        var lines = String(text || '').split(/\n/);
        while (lines.length && RE_QUOTE.test(trim(lines[0]))) {
            lines.shift();
        }
        return trim(lines.join('\n'));
    }

    /** 引用预览 / 用户点「引用」时：只取本条消息正文，不含角色已引用的内容 */
    function formatMessageBodyOnly(m) {
        if (!m || m.deleted) return '';
        var payload = parseDisplayPayload(m);
        var body = '';

        if (payload.kind === 'voice') {
            body = payload.voiceText || '';
        } else if (payload.kind === 'karaoke') {
            var km = payload.karaokeMode === 'instrumental' ? '纯伴奏' : '跟唱';
            body =
                'K歌《' +
                (payload.karaokeTitle || '未命名') +
                '》' +
                (payload.karaokeArtist ? ' · ' + payload.karaokeArtist : '') +
                ' · ' +
                km;
            if (payload.karaokeDurationSec) body += ' · ' + Math.round(payload.karaokeDurationSec) + '秒';
        } else if (payload.kind === 'sticker') {
            body = payload.stickerName || trim(m.content).replace(/^表情包[-－—]\s*/, '') || '[表情]';
        } else if (payload.kind === 'textImage') {
            body = payload.caption || trim(m.content).replace(/^图片[-－—]\s*/, '') || '[图片]';
        } else if (payload.kind === 'photo' || isRealChatPhotoMessage(m)) {
            body = trim(m.imageVisionText) || '[图片]';
        } else if (payload.kind === 'location') {
            if (m.locationCard && m.locationCard.name) {
                body = m.locationCard.name;
                if (m.locationCard.address) body += '｜' + m.locationCard.address;
            } else {
                body = '[位置]';
            }
        } else if (payload.kind === 'transfer') {
            if (m.redPacket && m.redPacket.amount) {
                body =
                    '¥' +
                    m.redPacket.amount +
                    '｜' +
                    (trim(m.redPacket.note) || '（无附言）');
                var stLbl = transferStatusLabel(m.redPacket);
                if (stLbl) body += '｜' + stLbl;
            } else {
                body = '[转账]';
            }
        } else if (payload.kind === 'takeout') {
            var takeoutSrc = payload.msg || m;
            body = formatTakeoutFromMessage(takeoutSrc) || '[外卖]';
        } else if (payload.kind === 'gift') {
            body = formatGiftForApi(resolveGiftParcelFromMessage(m)) || '[礼品]';
        } else if (payload.kind === 'love_poem') {
            body = formatLovePoemForApi(resolveLovePoemFromMessage(m)) || '[情诗]';
        } else if (payload.kind === 'match_record') {
            body = trim(m.content) || '[赛事记录]';
        } else if (payload.kind === 'sayguess_record') {
            body = trim(m.content) || '[你说我猜]';
        } else if (payload.kind === 'tajiePostShare') {
            var tajiePostBody = payload.share || pickTajiePostShare(m) || {};
            body =
                'TA界帖子 · ' +
                (trim(tajiePostBody.authorDisplay) || '未知') +
                '：' +
                trim(tajiePostBody.textPreview || '').slice(0, 80);
        } else if (payload.kind === 'tajieProfileShare') {
            var tajieProfileBody = payload.share || pickTajieProfileShare(m) || {};
            body = 'TA界主页 · ' + (trim(tajieProfileBody.displayName || tajieProfileBody.nickname) || '未知');
        } else if (payload.kind === 'text') {
            body = payload.text || '';
        } else {
            body = trim(m.content);
        }

        body = stripLeadingQuoteLines(body);
        if (m.quoteRef && m.quoteRef.text) {
            var qt = trim(m.quoteRef.text);
            if (body === qt) body = stripLeadingQuoteLines(trim(m.content));
        }
        return body;
    }

    global.MiyaChatOnlineFormat = {
        RE_QUOTE: RE_QUOTE,
        RE_VOICE: RE_VOICE,
        RE_STICKER: RE_STICKER,
        RE_IMAGE: RE_IMAGE,
        RE_LOCATION: RE_LOCATION,
        RE_TRANSFER: RE_TRANSFER,
        parseLocationBody: parseLocationBody,
        formatLocationApiLine: formatLocationApiLine,
        parseTransferBody: parseTransferBody,
        formatTransferApiLine: formatTransferApiLine,
        RE_TAKEOUT: RE_TAKEOUT,
        parseTakeoutBody: parseTakeoutBody,
        formatTakeoutApiLine: formatTakeoutApiLine,
        RE_GIFT: RE_GIFT,
        RE_LOVE_POEM: RE_LOVE_POEM,
        RE_RECALL: RE_RECALL,
        RECALL_RECENT_LIMIT: RECALL_RECENT_LIMIT,
        RE_NARRATION: RE_NARRATION,
        parseGiftBody: parseGiftBody,
        parseLovePoemBody: parseLovePoemBody,
        formatLovePoemForApi: formatLovePoemForApi,
        resolveLovePoemFromMessage: resolveLovePoemFromMessage,
        isLovePoemMessage: isLovePoemMessage,
        normalizeLovePoemFields: normalizeLovePoemFields,
        formatGiftApiLine: formatGiftApiLine,
        formatGiftForApi: formatGiftForApi,
        formatTakeoutForApi: formatTakeoutForApi,
        formatTakeoutFromMessage: formatTakeoutFromMessage,
        isTakeoutMessage: isTakeoutMessage,
        isGiftMessage: isGiftMessage,
        normalizeTakeoutFields: normalizeTakeoutFields,
        normalizeGiftFields: normalizeGiftFields,
        inferFieldsFromContent: inferFieldsFromContent,
        buildEditPatchFromContent: buildEditPatchFromContent,
        resolveTakeoutOrderFromMessage: resolveTakeoutOrderFromMessage,
        resolveGiftParcelFromMessage: resolveGiftParcelFromMessage,
        transferStatusLabel: transferStatusLabel,
        RE_TRANSFER_RECEIPT: RE_TRANSFER_RECEIPT,
        parseTransferReceiptLine: parseTransferReceiptLine,
        collectPendingUserTransfersInRound: collectPendingUserTransfersInRound,
        buildTransferUserRespondBlock: buildTransferUserRespondBlock,
        applyRoleTransferReceipts: applyRoleTransferReceipts,
        collectStickerCatalog: collectStickerCatalog,
        collectStickerCatalogAll: collectStickerCatalogAll,
        resolveStickerByName: resolveStickerByName,
        stickerNameFromQuoteText: stickerNameFromQuoteText,
        messageMatchesQuoteRef: messageMatchesQuoteRef,
        isUnknownStickerMessage: isUnknownStickerMessage,
        isUnknownStickerLine: isUnknownStickerLine,
        stripUnknownStickerLines: stripUnknownStickerLines,
        parseNarrationLineToBody: parseNarrationLineToBody,
        extractNarrationFromLines: extractNarrationFromLines,
        isOnlineNarrationMessage: isOnlineNarrationMessage,
        isUserOnlineNarrationMessage: isUserOnlineNarrationMessage,
        isCharacterOnlineNarrationMessage: isCharacterOnlineNarrationMessage,
        formatNarrationForApi: formatNarrationForApi,
        isSummaryNoticeMessage: isSummaryNoticeMessage,
        buildStickerAllowlistBlock: buildStickerAllowlistBlock,
        buildOnlineRules: buildOnlineRules,
        buildHeartVoiceRulesBlock: buildHeartVoiceRulesBlock,
        buildLastHeartVoiceInjectBlock: buildLastHeartVoiceInjectBlock,
        buildRegenerateRoundInjectBlock: buildRegenerateRoundInjectBlock,
        collectTrailingUserRound: collectTrailingUserRound,
        formatUserRoundLinesForRegenerate: formatUserRoundLinesForRegenerate,
        formatHeartVoiceSnapshotLines: formatHeartVoiceSnapshotLines,
        buildPerTurnFormatReminder: buildPerTurnFormatReminder,
        buildReadTogetherFormatRules: buildReadTogetherFormatRules,
        buildReadTogetherPerTurnReminder: buildReadTogetherPerTurnReminder,
        parseReadTogetherOutputLinesMeta: parseReadTogetherOutputLinesMeta,
        parseReadTogetherUserInput: parseReadTogetherUserInput,
        buildListenTogetherFormatRules: buildListenTogetherFormatRules,
        buildListenTogetherPerTurnReminder: buildListenTogetherPerTurnReminder,
        parseListenTogetherOutputLinesMeta: parseListenTogetherOutputLinesMeta,
        splitCollapsedOnlineTypeLines: splitCollapsedOnlineTypeLines,
        stripOrphanMarkdownEmphasis: stripOrphanMarkdownEmphasis,
        sanitizeRoleOutputLines: sanitizeRoleOutputLines,
        collapseDuplicateBubbleLines: collapseDuplicateBubbleLines,
        dedupeParsedRoleBubbles: dedupeParsedRoleBubbles,
        isStructuralLeakLine: isStructuralLeakLine,
        filterStructuralLeakLines: filterStructuralLeakLines,
        RE_ROLE_CALL_VOICE: RE_ROLE_CALL_VOICE,
        RE_ROLE_CALL_VIDEO: RE_ROLE_CALL_VIDEO,
        isRoleCallLineText: isRoleCallLineText,
        parseRoleOutputLine: parseRoleOutputLine,
        parseRoleOutputLines: parseRoleOutputLines,
        parseRoleOutputLinesMeta: parseRoleOutputLinesMeta,
        parseDisplayPayload: parseDisplayPayload,
        isRealChatPhotoMessage: isRealChatPhotoMessage,
        formatMessageForApi: formatMessageForApi,
        formatRecallForApi: formatRecallForApi,
        messageMatchesRecallTarget: messageMatchesRecallTarget,
        canRecallUserMessage: canRecallUserMessage,
        normalizeRecallTarget: normalizeRecallTarget,
        formatDiaryPeekContextForApi: formatDiaryPeekContextForApi,
        formatCallCapsuleForApi: formatCallCapsuleForApi,
        formatListenTogetherCapsuleForApi: formatListenTogetherCapsuleForApi,
        formatMessageBodyOnly: formatMessageBodyOnly,
        isTransferReceiptText: isTransferReceiptText,
        stripTransferReceiptLines: stripTransferReceiptLines,
        shouldOmitMessage: shouldOmitMessage,
        shouldHideFromUi: shouldHideFromUi,
        isRoomInvisibleMessage: isRoomInvisibleMessage,
        isAlbumAvatarChangeMessage: isAlbumAvatarChangeMessage,
        formatAlbumAvatarChangeForApi: formatAlbumAvatarChangeForApi,
        RE_ROLE_MOMENTS_POST: RE_ROLE_MOMENTS_POST,
        parseRoleMomentsPostIntentFromLine: parseRoleMomentsPostIntentFromLine,
        extractAvatarSwapFromLines: extractAvatarSwapFromLines,
        stripRoleMomentsFromLines: stripRoleMomentsFromLines
    };
})(window);
