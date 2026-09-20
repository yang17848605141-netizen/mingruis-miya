/**
 * 聊天/朋友圈自动翻译：意译（同轮 API 附带「译文-」）
 */
(function (global) {
    'use strict';

    var TARGETS = {
        'zh-CN': { code: 'zh-CN', label: '中文（普通话）', promptLabel: '中文普通话意译' },
        yue: { code: 'yue', label: '中文（粤语）', promptLabel: '粤语意译' },
        'zh-TW': { code: 'zh-TW', label: '中文（繁体）', promptLabel: '繁体中文意译' },
        wuu: { code: 'wuu', label: '中文（吴语）', promptLabel: '吴语意译' }
    };

    var TARGET_OPTIONS = [
        { v: 'zh-CN', label: '中文（普通话）' },
        { v: 'yue', label: '中文（粤语）' },
        { v: 'zh-TW', label: '中文（繁体）' },
        { v: 'wuu', label: '中文（吴语）' }
    ];

    function getStore() {
        return global.miyaChatStore || null;
    }

    function normalizeTargetCode(code) {
        var c = String(code || 'zh-CN').trim();
        return TARGETS[c] ? c : 'zh-CN';
    }

    function getTargetMeta(code) {
        return TARGETS[normalizeTargetCode(code)] || TARGETS['zh-CN'];
    }

    function getChatSettings(chatId) {
        var st = getStore();
        if (!st || !chatId || typeof st.getChatSettings !== 'function') return null;
        return st.getChatSettings(chatId) || null;
    }

    function resolveSettingsFromObj(s) {
        s = s && typeof s === 'object' ? s : {};
        return {
            enabled: !!s.autoTranslate,
            target: normalizeTargetCode(s.translateTarget),
            momentsTranslate: !!s.momentsTranslate
        };
    }

    function getTranslateSettings(chatId) {
        return resolveSettingsFromObj(getChatSettings(chatId));
    }

    function isSemanticModeFromSettings(s) {
        return !!(s && s.autoTranslate);
    }

    function isLiteralModeFromSettings() {
        return false;
    }

    function isAutoTranslateEnabled(chatId) {
        return getTranslateSettings(chatId).enabled;
    }

    function isSemanticMode(chatId) {
        return isAutoTranslateEnabled(chatId);
    }

    function isLiteralMode() {
        return false;
    }

    function isMomentsTranslateEnabled(chatId) {
        var cfg = getTranslateSettings(chatId);
        return cfg.enabled && cfg.momentsTranslate;
    }

    function resolveChatIdForContact(contactId) {
        var st = getStore();
        if (!st || !contactId) return '';
        var cid = String(contactId).trim();
        var contact = st.findContact ? st.findContact(cid) : null;
        var chats = st.getChats ? st.getChats('all') : [];
        var hit = '';
        chats.forEach(function (chat) {
            if (!chat || chat.type === 'group' || String(chat.contactId) !== cid) return;
            if (!hit || (contact && String(chat.profileId || '') === String(contact.defaultProfileId || ''))) {
                hit = String(chat.id);
            }
        });
        return hit;
    }

    function hashSource(text) {
        var s = String(text || '');
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return (h >>> 0).toString(36);
    }

    function stripForDetect(text) {
        return String(text || '')
            .replace(/\s+/g, '')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/[「」『』"'""[\]()（）【】<>《》,.!?;:…~·—\-_/\\|@#$%^&*+=`]/g, '');
    }

    var RE_CANTONESE_MARKERS = /[嘅咗佢咩冇係啲喺邊點乜唔嚟睇揾哋嘢畀俾攞拎飲返屋企瞓覺靚靓攰]/u;
    var RE_WU_MARKERS = /[侬伊阿拉覅勿晓得戆瘪三囡囝搿覅]/u;

    function hasChineseDialectMarkers(text, targetCode) {
        var code = normalizeTargetCode(targetCode);
        var t = String(text || '');
        if (code === 'zh-CN') return RE_CANTONESE_MARKERS.test(t) || RE_WU_MARKERS.test(t);
        if (code === 'yue') return /[你我他她它们这那里吗呢吧啊么的了吗么着]/u.test(t) && !RE_CANTONESE_MARKERS.test(t);
        if (code === 'wuu') return !RE_WU_MARKERS.test(t) && (RE_CANTONESE_MARKERS.test(t) || /[你我他她它们这那里吗呢吧啊]/u.test(t));
        return false;
    }

    function needsChineseTranslation(text) {
        var t = stripForDetect(text);
        if (t.length < 2) return false;
        var cjk = 0;
        var latin = 0;
        var kana = 0;
        var hangul = 0;
        for (var i = 0; i < t.length; i++) {
            var c = t.charCodeAt(i);
            if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) cjk++;
            else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
            else if (c >= 0x3040 && c <= 0x30ff) kana++;
            else if (c >= 0xac00 && c <= 0xd7af) hangul++;
        }
        var letterish = cjk + latin + kana + hangul;
        if (letterish < 2) return false;
        if (latin + kana + hangul === 0) return false;
        if (cjk / letterish >= 0.72 && latin / letterish < 0.1) return false;
        return true;
    }

    function needsTranslation(text, targetCode) {
        var code = normalizeTargetCode(targetCode);
        if (needsChineseTranslation(text)) return true;
        if (hasChineseDialectMarkers(text, code)) return true;
        return false;
    }

    function buildNonTargetLanguageHint(targetCode, subject) {
        var label = buildTargetPromptLabel(targetCode);
        var code = normalizeTargetCode(targetCode);
        var extra = '';
        if (code === 'zh-CN') extra = '、粤语、吴语等中文方言';
        else if (code === 'yue') extra = '、普通话等其他中文变体';
        else if (code === 'wuu') extra = '、普通话、粤语等其他中文变体';
        else if (code === 'zh-TW') extra = '、简体或方言';
        return String(subject || '正文') + '主要语言不是' + label + '时（含英/日/韩等外文' + extra + '）';
    }

    function buildSkipTranslationHint(targetCode) {
        var code = normalizeTargetCode(targetCode);
        if (code === 'zh-CN') {
            return '若正文已是标准普通话（非粤语、吴语等方言，也非英/日/韩等外文），不要输出译文行';
        }
        if (code === 'yue') return '若正文已是粤语，不要输出译文行';
        if (code === 'zh-TW') return '若正文已是繁体中文，不要输出译文行';
        if (code === 'wuu') return '若正文已是吴语，不要输出译文行';
        return '若正文已是' + buildTargetPromptLabel(targetCode) + '，不要输出译文行';
    }

    function buildMomentsSkipTranslationHint(targetCode) {
        var code = normalizeTargetCode(targetCode);
        if (code === 'zh-CN') {
            return '若正文已是标准普通话（非粤语、吴语等方言，也非外文），不要追加译文段';
        }
        if (code === 'yue') return '若正文已是粤语，不要追加译文段';
        if (code === 'zh-TW') return '若正文已是繁体中文，不要追加译文段';
        if (code === 'wuu') return '若正文已是吴语，不要追加译文段';
        return '若正文已是' + buildTargetPromptLabel(targetCode) + '，不要追加译文段';
    }

    function stripTimeline(text) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
            return aw.stripTimelinePrefixForDisplay(text);
        }
        return String(text || '').trim();
    }

    function extractTranslatableText(msg) {
        if (!msg || msg.deleted) return '';
        if (msg.role !== 'assistant') return '';
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(msg)) return '';
        if (fmt && typeof fmt.parseDisplayPayload === 'function') {
            var payload = fmt.parseDisplayPayload(msg);
            if (!payload) return '';
            if (payload.kind === 'voice') {
                return stripTimeline(String(msg.voiceText || payload.text || msg.content || ''))
                    .replace(/^语音[-－—]\s*/, '')
                    .trim();
            }
            if (payload.kind !== 'text') return '';
            return stripTimeline(payload.text != null ? payload.text : msg.content || '').trim();
        }
        if (msg.type === 'voice') {
            return stripTimeline(msg.voiceText || msg.content || '').replace(/^语音[-－—]\s*/, '').trim();
        }
        if (msg.type && msg.type !== 'text') return '';
        return stripTimeline(msg.content || '').trim();
    }

    function attachTranslationToBubbleFields(fields, zhText) {
        if (!fields || !zhText) return fields;
        var src =
            fields.type === 'voice'
                ? String(fields.voiceText || '').trim()
                : String(fields.content || '').trim();
        fields.translationZh = String(zhText).trim();
        fields.translationSrcHash = hashSource(src);
        fields.translationAt = Date.now();
        fields.translationPending = false;
        fields.translationFailed = false;
        return fields;
    }

    function buildTargetPromptLabel(targetCode) {
        return getTargetMeta(targetCode).promptLabel;
    }

    function buildAutoTranslateRulesBlock(targetCode) {
        var label = buildTargetPromptLabel(targetCode);
        return [
            '【自动翻译·硬性】用户已开启自动翻译（与本轮正文同一次输出，禁止另起请求）。',
            '当你的正文气泡行（普通文字，或单独一行的「语音-」转写）' +
                buildNonTargetLanguageHint(targetCode, '正文气泡行') +
                '，必须在该行的下一行紧跟一条：译文-' +
                label +
                '（仅写译文正文，自然流畅，保留语气、情感与人称；该行不是独立聊天气泡，界面会附在上一气泡下方）。',
            buildSkipTranslationHint(targetCode) + '。',
            '「译文-」行禁止写入 <thinking> 或 <miyavoice>；不得用译文行代替正文；每条需译气泡最多跟一行译文。'
        ].join('\n');
    }

    function buildPerTurnAutoTranslateReminder(targetCode) {
        var label = buildTargetPromptLabel(targetCode);
        return (
            '【本轮·自动翻译】若正文/语音气泡' +
            buildNonTargetLanguageHint(targetCode, '正文') +
            '，下一行须紧跟「译文-' +
            label +
            '」；' +
            buildSkipTranslationHint(targetCode) +
            '。'
        );
    }

    function buildMomentsSemanticRulesBlock(targetCode) {
        var label = buildTargetPromptLabel(targetCode);
        return [
            '【朋友圈翻译·硬性】用户已开启朋友圈翻译（与「【发朋友圈：…】」同一次输出）。',
            '当' + buildNonTargetLanguageHint(targetCode, '朋友圈正文') + '，必须在管道段追加：|译文：' + label + '（自然流畅，保留语气）。',
            buildMomentsSkipTranslationHint(targetCode) + '。',
            '示例：【发朋友圈：Just finished work|译文：刚下班，有点累但还好|配图1：傍晚街灯】',
            '示例：【发朋友圈：今日返工好攰啊|译文：今天上班好累啊|配图1：办公室窗外】'
        ].join('\n');
    }

    function buildMomentsAutoSemanticInject(targetCode) {
        var label = buildTargetPromptLabel(targetCode);
        return [
            '用户已开启朋友圈翻译：若' +
                buildNonTargetLanguageHint(targetCode, '朋友圈正文') +
                '，须在管道段追加 |译文：' +
                label +
                '；' +
                buildMomentsSkipTranslationHint(targetCode) +
                '。',
            '格式示例：【发朋友圈：正文|译文：…|配图1：图片描述】'
        ].join('\n');
    }

    function applyMomentsTranslationOnCreate(post, contactId, intent) {
        if (!post) return post;
        var chatId = resolveChatIdForContact(contactId);
        if (!chatId || !isMomentsTranslateEnabled(chatId)) return post;
        var cfg = getTranslateSettings(chatId);
        var text = String(post.text || '').trim();
        var hasModelTranslation = !!(intent && intent.translation);
        if (!text || (!needsTranslation(text, cfg.target) && !hasModelTranslation)) return post;
        post.translationTarget = cfg.target;
        if (intent && intent.translation) {
            post.translationText = String(intent.translation).trim();
            post.translationPending = false;
            post.translationFailed = false;
            post.translationAt = Date.now();
        }
        return post;
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escHtml(s, escFn) {
        var fn =
            escFn ||
            function (x) {
                return String(x || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            };
        return fn(s);
    }

    function buildTranslateHtml(chatId, m, escFn) {
        if (!m || m.role !== 'assistant' || !isAutoTranslateEnabled(chatId)) return '';
        var source = extractTranslatableText(m);
        if (!source || !m.translationZh) return '';
        var cfg = getTranslateSettings(chatId);
        if (!needsTranslation(source, cfg.target) && String(m.translationZh).trim() === source.trim()) return '';

        var targetLabel = getTargetMeta(m.translationTarget || cfg.target).label;
        return (
            '<div class="qq-room__bubble-trans" role="note" aria-label="译文">' +
            '<div class="qq-room__bubble-trans-line" aria-hidden="true"></div>' +
            '<span class="qq-room__bubble-trans-kicker">译文 · ' +
            escHtml(targetLabel, escFn) +
            '</span>' +
            '<p class="qq-room__bubble-trans-text">' +
            escHtml(m.translationZh, escFn).replace(/\n/g, '<br>') +
            '</p></div>'
        );
    }

    function buildMomentsTranslateHtml(post) {
        if (!post || !post.translationText) return '';
        var targetLabel = getTargetMeta(post.translationTarget || 'zh-CN').label;
        return (
            '<div class="mm-feed-trans" role="note" aria-label="译文">' +
            '<div class="mm-feed-trans__inner">' +
            '<span class="mm-feed-trans__label">译文 · ' + esc(targetLabel) + '</span>' +
            '<p class="mm-feed-trans__text">' +
            esc(post.translationText).replace(/\n/g, '<br>') +
            '</p></div></div>'
        );
    }

    function buildTargetOptionsHtml(selected) {
        var sel = normalizeTargetCode(selected);
        return TARGET_OPTIONS.map(function (opt) {
            return (
                '<option value="' +
                esc(opt.v) +
                '"' +
                (opt.v === sel ? ' selected' : '') +
                '>' +
                esc(opt.label) +
                '</option>'
            );
        }).join('');
    }

    global.MiyaChatTranslate = {
        TARGET_OPTIONS: TARGET_OPTIONS,
        getTargetMeta: getTargetMeta,
        normalizeTargetCode: normalizeTargetCode,
        getTranslateSettings: getTranslateSettings,
        isEnabled: isAutoTranslateEnabled,
        isSemanticMode: isSemanticMode,
        isLiteralMode: isLiteralMode,
        isSemanticModeFromSettings: isSemanticModeFromSettings,
        isLiteralModeFromSettings: isLiteralModeFromSettings,
        isMomentsTranslateEnabled: isMomentsTranslateEnabled,
        resolveChatIdForContact: resolveChatIdForContact,
        hashSource: hashSource,
        needsChineseTranslation: needsChineseTranslation,
        needsTranslation: needsTranslation,
        extractTranslatableText: extractTranslatableText,
        attachTranslationToBubbleFields: attachTranslationToBubbleFields,
        buildAutoTranslateRulesBlock: buildAutoTranslateRulesBlock,
        buildPerTurnAutoTranslateReminder: buildPerTurnAutoTranslateReminder,
        buildMomentsSemanticRulesBlock: buildMomentsSemanticRulesBlock,
        buildMomentsAutoSemanticInject: buildMomentsAutoSemanticInject,
        buildTranslateHtml: buildTranslateHtml,
        buildMomentsTranslateHtml: buildMomentsTranslateHtml,
        buildTargetOptionsHtml: buildTargetOptionsHtml,
        applyMomentsTranslationOnCreate: applyMomentsTranslationOnCreate
    };
})(window);
