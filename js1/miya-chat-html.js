(function (global) {
    'use strict';

    function trim(s) {
        return String(s || '').trim();
    }

    function extractHtmlFromCodeFence(rawText) {
        var txt = String(rawText || '');
        if (!txt) return '';
        var m = txt.match(/```(?:html|htm|xml)\s*([\s\S]*?)```/i);
        if (!m || m[1] == null) return '';
        return String(m[1] || '').trim();
    }

    /** @returns {{inner:string,before:string,after:string}|null} */
    function extractHtmlFenceParts(rawText) {
        var txt = String(rawText || '');
        var m = txt.match(/```(?:html|htm|xml)\s*([\s\S]*?)```/i);
        if (!m || m.index == null) return null;
        var full = m[0];
        var idx = m.index;
        return {
            inner: String(m[1] || '').trim(),
            before: txt.slice(0, idx).trim(),
            after: txt.slice(idx + full.length).trim()
        };
    }

    function looksLikeHtmlReply(rawText) {
        var txt = String(rawText || '').trim();
        if (!txt) return false;
        if (/```(?:html|htm|xml)\b/i.test(txt)) return true;
        if (/<\s*!doctype\s+html\b/i.test(txt)) return true;
        var tagLike = /<\s*([a-z][a-z0-9:-]*)\b[^>]*>/gi;
        var count = 0;
        var m;
        while ((m = tagLike.exec(txt)) && count < 4) {
            count += 1;
        }
        if (count < 2) return false;
        return /<\s*(html|head|body|main|section|article|header|footer|nav|div|span|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|a|img|svg|button|input|form)\b/i.test(
            txt
        );
    }

    function sanitizeHtmlForChatBubble(rawHtml) {
        var html = String(rawHtml || '').trim();
        if (!html) return '';
        try {
            var parser = new DOMParser();
            var doc = parser.parseFromString('<div id="__miya_html_root__">' + html + '</div>', 'text/html');
            var root = doc.getElementById('__miya_html_root__');
            if (!root) return '';
            var blocked = root.querySelectorAll('script,iframe,object,embed,link,meta,base');
            var i;
            for (i = 0; i < blocked.length; i++) {
                var n = blocked[i];
                if (n && n.parentNode) n.parentNode.removeChild(n);
            }
            var all = root.querySelectorAll('*');
            for (var j = 0; j < all.length; j++) {
                var el = all[j];
                var attrs = [];
                var ai;
                for (ai = 0; ai < el.attributes.length; ai++) attrs.push(el.attributes[ai].name);
                for (var k = 0; k < attrs.length; k++) {
                    var name = String(attrs[k] || '').toLowerCase();
                    var val = String(el.getAttribute(attrs[k]) || '').trim();
                    if (!name) continue;
                    if (name.indexOf('on') === 0) {
                        el.removeAttribute(attrs[k]);
                        continue;
                    }
                    if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^javascript:/i.test(val)) {
                        el.removeAttribute(attrs[k]);
                    }
                }
            }
            return String(root.innerHTML || '').trim();
        } catch (e) {
            return '';
        }
    }

    function extractRawHtmlFromMessageText(rawText, forceByFlag) {
        var txt = trim(rawText);
        if (!txt) return '';
        var htmlBlock = extractHtmlFromCodeFence(txt);
        if (!htmlBlock && (forceByFlag || looksLikeHtmlReply(txt))) htmlBlock = txt;
        return String(htmlBlock || '').trim();
    }

    function extractRenderableHtmlFromMessageText(rawText, forceByFlag) {
        var raw = extractRawHtmlFromMessageText(rawText, forceByFlag);
        if (!raw) return '';
        return sanitizeHtmlForChatBubble(raw);
    }

    function buildChatHtmlIframeSrcdoc(rawHtml) {
        var html = String(rawHtml || '').trim();
        if (!html) return '';
        var shim =
            '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">' +
            '<style id="__miya_chat_html_iframe_shim">' +
            'html,body{height:auto!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;}' +
            'body{display:block!important;margin:0;}' +
            '</style>';
        if (html.indexOf('__miya_chat_html_iframe_shim') < 0) {
            var hasDocTag = /<\s*!doctype\s+html\b/i.test(html) || /<\s*html\b/i.test(html);
            if (!hasDocTag) {
                html =
                    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                    shim +
                    '</head><body>' +
                    html +
                    '</body></html>';
            } else if (/<\/head>/i.test(html)) {
                html = html.replace(/<\/head>/i, shim + '</head>');
            } else if (/<head\b[^>]*>/i.test(html)) {
                html = html.replace(/<head\b[^>]*>/i, function (m) {
                    return m + shim;
                });
            } else {
                html = html.replace(/<\s*html\b[^>]*>/i, function (m) {
                    return m + '<head><meta charset="UTF-8">' + shim + '</head>';
                });
            }
        }
        return html;
    }

    function buildHtmlPayloadFromText(rawText, forceByFlag) {
        var rawHtml = extractRawHtmlFromMessageText(rawText, forceByFlag);
        if (!rawHtml) return null;
        var sanitized = sanitizeHtmlForChatBubble(rawHtml);
        var useIframe = /<\s*script\b/i.test(rawHtml);
        var iframeSrcdoc = useIframe ? buildChatHtmlIframeSrcdoc(rawHtml) : '';
        return {
            raw: rawHtml,
            html: sanitized,
            useIframe: useIframe && !!iframeSrcdoc,
            iframeSrcdoc: iframeSrcdoc
        };
    }

    /**
     * 从角色正文提取 HTML；若与对白混排则仅保留 HTML 片段。
     * @returns {{raw:string,html:string,useIframe:boolean,iframeSrcdoc:string,mixedStripped:boolean}|null}
     */
    function extractHtmlOnlyFromReply(rawText) {
        var cleaned = trim(rawText);
        if (!cleaned) return null;
        var htmlBlock = '';
        var mixedStripped = false;
        var fenceParts = extractHtmlFenceParts(cleaned);
        if (fenceParts && fenceParts.inner) {
            htmlBlock = fenceParts.inner;
            if (fenceParts.before || fenceParts.after) mixedStripped = true;
        } else {
            htmlBlock = extractHtmlFromCodeFence(cleaned);
            if (!htmlBlock && looksLikeHtmlReply(cleaned)) {
                var firstTag = cleaned.search(
                    /<\s*(!doctype|html|body|main|section|article|div|span|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|a|img|svg|button|input|form)\b/i
                );
                if (firstTag > 0) {
                    var preHtml = cleaned.slice(0, firstTag).trim();
                    if (preHtml) {
                        mixedStripped = true;
                        htmlBlock = cleaned.slice(firstTag).trim();
                    } else {
                        htmlBlock = cleaned;
                    }
                } else {
                    htmlBlock = cleaned;
                }
            }
        }
        if (!htmlBlock) return null;
        var payload = buildHtmlPayloadFromText(htmlBlock, true);
        if (!payload || !String(payload.raw || '').trim()) return null;
        return Object.assign(payload, { mixedStripped: mixedStripped });
    }

    /**
     * 判断一段文本（通常为世界书词条正文）是否要求本轮以 HTML 形式输出。
     * 线上由世界书关键词命中后注入的词条内容触发，不扫描用户口语。
     */
    function textRequestsHtmlOutput(text) {
        var t = String(text || '');
        if (!t) return false;
        if (/```\s*(?:html|htm|xml)\b/i.test(t)) return true;
        if (/(?:输出|生成|制作|编写|呈现|返回|发送|给出|渲染).{0,24}html/i.test(t)) return true;
        if (/html.{0,24}(?:格式|页面|组件|卡片|交互|展示|效果|片段|文件)/i.test(t)) return true;
        if (/(?:仅|只|必须|务必|只能).{0,20}(?:输出|生成).{0,20}html/i.test(t)) return true;
        if (/html\s*格式/i.test(t)) return true;
        if (/(?:交互|互动)(?:页面|网页|组件)/i.test(t) && /(?:html|输出|生成)/i.test(t)) return true;
        return false;
    }

    function collectMetaDirectiveText(text) {
        var full = String(text || '');
        if (!full.trim()) return { full: '', metaOnly: '' };
        var metaLines = [];
        full.split(/\r?\n/).forEach(function (line) {
            var trimmed = String(line || '').trim();
            if (/^[$＄]/.test(trimmed)) {
                metaLines.push(trimmed.replace(/^[$＄]\s*/, ''));
            }
        });
        return { full: full, metaOnly: metaLines.join('\n') };
    }

    /**
     * 线下：用户本轮 $ / ＄ 元指令是否要求直接输出 HTML（小手机番外、交互页等）。
     * 线上聊天不走此函数，仍由世界书决定。
     */
    function userOfflineMetaRequestsHtml(text) {
        var pack = collectMetaDirectiveText(text);
        var full = pack.full;
        var metaOnly = pack.metaOnly;
        if (!full.trim()) return false;
        /* 须有 $ / ＄ 元指令行，或全文明确「直接生成 HTML」类表述，避免普通剧情误触 */
        if (!metaOnly && !/(?:直接\s*)?生成\s*html/i.test(full)) return false;
        if (metaOnly && textRequestsHtmlOutput(metaOnly)) return true;
        if (textRequestsHtmlOutput(full)) return true;
        if (metaOnly && /(?:小手机|番外|小剧场)/.test(metaOnly) && /html/i.test(full)) return true;
        if (/(?:小手机|miniphone)/i.test(full) && /(?:直接\s*)?生成\s*html/i.test(full)) return true;
        if (/(?:暂停|停止).{0,16}主线/i.test(full) && /(?:直接\s*)?生成\s*html/i.test(full)) return true;
        return false;
    }

    /**
     * 本轮 API 是否进入 HTML 模式：仅当世界书命中词条的正文要求 HTML 输出。
     * @param {{matched?:Array, layers?:Array}} bundle buildWorldbookBundle 的返回值
     */
    function detectHtmlModeFromWorldbook(bundle) {
        if (!bundle || typeof bundle !== 'object') return false;
        var matched = Array.isArray(bundle.matched) ? bundle.matched : [];
        var i;
        for (i = 0; i < matched.length; i++) {
            var row = matched[i];
            if (row && textRequestsHtmlOutput(row.content)) return true;
        }
        var layers = Array.isArray(bundle.layers) ? bundle.layers.join('\n\n') : '';
        return textRequestsHtmlOutput(layers);
    }

    function buildHtmlGenerationRules(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var mode = opts.mode === 'offline' ? 'offline' : 'online';
        var fromWb = !!opts.fromWorldbook;
        var fromUserMeta = !!opts.fromUserMeta;
        if (mode === 'offline') {
            if (fromUserMeta) {
                return [
                    '【HTML 输出·用户元指令·强制】',
                    '用户本轮通过 $ / ＄ 元指令要求直接输出 HTML（如小手机番外、交互页等），须严格按用户消息中的元指令与剧情提纲执行，优先级高于【字数·硬性要求】中的线下散文篇幅。',
                    '结构：<thinking> → 一份完整 HTML（```html``` 围栏或完整标签）；禁止输出线下长篇叙述正文、状态栏、⧗ 时间戳及 API 气泡行。',
                    '若元指令要求小手机/聊天界面番外：HTML 内模拟即时通讯 UI，可穿插表情包、语音等；条数/篇幅以元指令为准（如「不少于 N 条聊天」）。',
                    'HTML 须自包含样式，适配手机竖屏；可含 <script> 做简易交互；说明写在 HTML 注释内。'
                ].join('\n');
            }
            if (fromWb) {
                return [
                    '【HTML 输出·世界书补充】',
                    '本轮已命中要求 HTML 输出的世界书词条，请严格按该词条正文执行。',
                    '结构：<thinking> → 一份完整 HTML（禁止普通叙事段与线上气泡格式）→ 可按词条要求省略心声（若词条未要求心声则不必强行输出 <miyavoice>）。',
                    'HTML 用 ```html ... ``` 围栏或直接标签；须自包含样式，适配手机竖屏。'
                ].join('\n');
            }
            return [
                '【HTML 输出·本轮强制】',
                '本轮 <thinking> 之后正文只能输出一份完整 HTML，禁止普通叙事段落与线上气泡格式混排。',
                '优先用 ```html ... ``` 围栏；也可直接输出 <!DOCTYPE html> 或以 <html>/<div> 等标签开头的片段。',
                'HTML 须自包含样式（内联或 <style>），适配手机竖屏；可含 <script> 做简易交互。',
                '禁止在围栏外写说明；备注写在 HTML 注释内。'
            ].join('\n');
        }
        if (fromWb) {
            return [
                '【HTML 输出·世界书补充】',
                '本轮已命中要求以 HTML 回复的世界书词条；请严格按该词条正文中的输出要求执行（优先级高于通用线上气泡格式）。',
                '结构仍为：<thinking> → HTML 正文（```html``` 围栏或完整 HTML 标签）→ <miyavoice>（心声字段，每轮必填，格式见「线上格式规则·心声」）。',
                'HTML 段内禁止语音-/表情包-/引用-等聊天气泡行；说明性文字写在 HTML 注释内。'
            ].join('\n');
        }
        return [
            '【HTML 交互页·本轮强制】',
            '本轮输出顺序：<thinking> → HTML 正文 → <miyavoice>。',
            '</thinking> 之后至 <miyavoice> 之前只输出一份完整 HTML。',
            '优先用 ```html ... ``` 围栏；HTML 须自包含样式，适配手机竖屏。'
        ].join('\n');
    }

    function buildHtmlOptionalRules() {
        return [
            '【HTML 交互页·可选】',
            '当用户要求生成页面、卡片、小游戏、问卷、日历等可视化内容时，可输出完整 HTML（```html``` 围栏或直接标签）。',
            '若本轮输出 HTML，则正文只能有 HTML，不要与对白行混排。'
        ].join('\n');
    }

    function revokeChatHtmlBlobUrlsInContainer(root) {
        if (!root || !root.querySelectorAll) return;
        var frames = root.querySelectorAll('iframe[data-miya-chat-html-blob]');
        var i;
        for (i = 0; i < frames.length; i++) {
            var fr = frames[i];
            var u = fr && fr.getAttribute ? String(fr.getAttribute('data-miya-chat-html-blob') || '').trim() : '';
            if (u) {
                try {
                    URL.revokeObjectURL(u);
                } catch (e) {}
                fr.removeAttribute('data-miya-chat-html-blob');
            }
        }
    }

    function encodeSrcdocB64(text) {
        try {
            return btoa(unescape(encodeURIComponent(String(text || ''))));
        } catch (e) {
            return '';
        }
    }

    function decodeSrcdocB64(encoded) {
        try {
            return decodeURIComponent(escape(atob(String(encoded || ''))));
        } catch (e) {
            return '';
        }
    }

    function hydrateChatHtmlIframesInContainer(container) {
        var root = container || document;
        if (!root || !root.querySelectorAll) return;
        var frames = root.querySelectorAll('iframe[data-miya-chat-html-iframe="1"]');
        var i;
        for (i = 0; i < frames.length; i++) {
            var frame = frames[i];
            if (!frame || frame.getAttribute('data-miya-chat-html-hydrated') === '1') continue;
            var srcdoc = decodeSrcdocB64(frame.getAttribute('data-miya-chat-srcdoc-b64'));
            if (!srcdoc) continue;
            try {
                var prevBlob = frame.getAttribute('data-miya-chat-html-blob');
                if (prevBlob) {
                    try {
                        URL.revokeObjectURL(prevBlob);
                    } catch (e0) {}
                    frame.removeAttribute('data-miya-chat-html-blob');
                }
                var blob = new Blob([srcdoc], { type: 'text/html;charset=utf-8' });
                var burl = URL.createObjectURL(blob);
                frame.src = burl;
                frame.setAttribute('data-miya-chat-html-blob', burl);
                frame.setAttribute('data-miya-chat-html-hydrated', '1');
            } catch (e) {}
        }
    }

    function closeChatHtmlFullscreenLayer() {
        var el = document.getElementById('miya-chat-html-fs-layer');
        if (el && el.parentNode) {
            try {
                el.parentNode.removeChild(el);
            } catch (e) {}
        }
        if (global.__miyaChatHtmlFsBlobUrl) {
            try {
                URL.revokeObjectURL(global.__miyaChatHtmlFsBlobUrl);
            } catch (e2) {}
            global.__miyaChatHtmlFsBlobUrl = '';
        }
        var room = global.miyaChatRoom;
        if (room && typeof room.getOpenChatId === 'function' && room.getOpenChatId() &&
            typeof room.restoreCompose === 'function') {
            room.restoreCompose();
        }
    }

    function openChatHtmlFullscreen(srcdoc) {
        var html = String(srcdoc || '').trim();
        if (!html) return;
        closeChatHtmlFullscreenLayer();
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var burl = URL.createObjectURL(blob);
        global.__miyaChatHtmlFsBlobUrl = burl;
        var layer = document.createElement('div');
        layer.id = 'miya-chat-html-fs-layer';
        layer.className = 'miya-chat-html-fs-layer';
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.innerHTML =
            '<div class="miya-chat-html-fs-inner">' +
            '<header class="miya-chat-html-fs-head">' +
            '<button type="button" class="miya-chat-html-fs-back">返回</button>' +
            '</header>' +
            '<iframe class="miya-chat-html-fs-iframe" title="HTML 全屏" sandbox="allow-scripts allow-modals allow-same-origin" referrerpolicy="no-referrer"></iframe>' +
            '</div>';
        document.body.appendChild(layer);
        var iframe = layer.querySelector('.miya-chat-html-fs-iframe');
        if (iframe) iframe.src = burl;
        layer.addEventListener('click', function (ev) {
            if (ev.target.closest('.miya-chat-html-fs-back')) closeChatHtmlFullscreenLayer();
        });
    }

    global.MiyaChatHtml = {
        extractHtmlFromCodeFence: extractHtmlFromCodeFence,
        extractHtmlFenceParts: extractHtmlFenceParts,
        looksLikeHtmlReply: looksLikeHtmlReply,
        sanitizeHtmlForChatBubble: sanitizeHtmlForChatBubble,
        extractRawHtmlFromMessageText: extractRawHtmlFromMessageText,
        extractRenderableHtmlFromMessageText: extractRenderableHtmlFromMessageText,
        buildChatHtmlIframeSrcdoc: buildChatHtmlIframeSrcdoc,
        buildHtmlPayloadFromText: buildHtmlPayloadFromText,
        extractHtmlOnlyFromReply: extractHtmlOnlyFromReply,
        textRequestsHtmlOutput: textRequestsHtmlOutput,
        collectMetaDirectiveText: collectMetaDirectiveText,
        userOfflineMetaRequestsHtml: userOfflineMetaRequestsHtml,
        detectHtmlModeFromWorldbook: detectHtmlModeFromWorldbook,
        buildHtmlGenerationRules: buildHtmlGenerationRules,
        buildHtmlOptionalRules: buildHtmlOptionalRules,
        encodeSrcdocB64: encodeSrcdocB64,
        decodeSrcdocB64: decodeSrcdocB64,
        revokeChatHtmlBlobUrlsInContainer: revokeChatHtmlBlobUrlsInContainer,
        hydrateChatHtmlIframesInContainer: hydrateChatHtmlIframesInContainer,
        closeChatHtmlFullscreenLayer: closeChatHtmlFullscreenLayer,
        openChatHtmlFullscreen: openChatHtmlFullscreen
    };
})(window);
