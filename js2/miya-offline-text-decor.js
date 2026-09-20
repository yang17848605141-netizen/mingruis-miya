/**
 * 线下正文符号美化：自动检测引号/括号等包裹段，包上可样式化的 span。
 * 不改提示词；仅做展示层处理。
 */
(function (global) {
    'use strict';

    var GLYPH_RE = /([†✞✧*⊹⌂♡✦◇◆☆★※〰·•])/g;

    /** 成对包裹：优先匹配较长/较特殊的 */
    var PAIR_RULES = [
        { open: '「', close: '」', cls: 'quote' },
        { open: '『', close: '』', cls: 'quote-double' },
        { open: '“', close: '”', cls: 'quote-en' },
        { open: '"', close: '"', cls: 'quote-ascii' },
        { open: '（', close: '）', cls: 'paren' },
        { open: '(', close: ')', cls: 'paren-en' },
        { open: '【', close: '】', cls: 'bracket' },
        { open: '《', close: '》', cls: 'title' },
        { open: '*', close: '*', cls: 'em' }
    ];

    function esc(t) {
        return String(t || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function wrapGlyphs(html) {
        return String(html || '').replace(GLYPH_RE, '<span class="xw-sym xw-sym--glyph">$1</span>');
    }

    function findClosing(src, start, openCh, closeCh) {
        var i = start;
        var depth = 1;
        var same = openCh === closeCh;
        while (i < src.length) {
            var ch = src.charAt(i);
            if (same) {
                if (ch === closeCh) return i;
            } else {
                if (ch === openCh) depth += 1;
                else if (ch === closeCh) {
                    depth -= 1;
                    if (depth === 0) return i;
                }
            }
            i += 1;
        }
        return -1;
    }

    function matchOpenAt(src, i) {
        var rest = src.slice(i);
        var best = null;
        var r;
        for (r = 0; r < PAIR_RULES.length; r++) {
            var rule = PAIR_RULES[r];
            if (rest.indexOf(rule.open) !== 0) continue;
            if (!best || rule.open.length > best.open.length) best = rule;
        }
        return best;
    }

    /**
     * 转义 + 成对包裹装饰 + glyph。
     * 未成对的开闭符原样转义，不硬包。
     */
    function decorateInline(text) {
        var src = String(text || '');
        if (!src) return '';
        var out = '';
        var i = 0;
        while (i < src.length) {
            var rule = matchOpenAt(src, i);
            if (rule) {
                var openLen = rule.open.length;
                var closeStart = findClosing(src, i + openLen, rule.open, rule.close);
                if (closeStart > i + openLen - 1) {
                    var inner = src.slice(i + openLen, closeStart);
                    out +=
                        '<span class="xw-deco xw-deco--' +
                        rule.cls +
                        '">' +
                        '<span class="xw-deco__mark" aria-hidden="true">' +
                        esc(rule.open) +
                        '</span>' +
                        '<span class="xw-deco__body">' +
                        decorateInline(inner) +
                        '</span>' +
                        '<span class="xw-deco__mark" aria-hidden="true">' +
                        esc(rule.close) +
                        '</span>' +
                        '</span>';
                    i = closeStart + rule.close.length;
                    continue;
                }
            }
            out += esc(src.charAt(i));
            i += 1;
        }
        return wrapGlyphs(out);
    }

    function looksAside(text) {
        var t = String(text || '').trim();
        if (!t) return false;
        if (/^†|✞|✧|THE SEASON/i.test(t)) return true;
        if (t.length < 48 && /[†✞✧⊹]/.test(t) && !/\*[^*]+\*/.test(t)) return true;
        return false;
    }

    function looksCallout(text) {
        return /未接來電|未接来电|⌂|♡/.test(String(text || ''));
    }

    /**
     * 段落级装饰（素纸 / 手帐共用）。
     * role: 'user' | 'assistant' | ''
     */
    function decorateParagraph(text, role) {
        var t = String(text || '').trim();
        if (!t) return '';
        if (looksAside(t)) {
            return '<p class="xw-txt xw-txt--aside">' + decorateInline(t) + '</p>';
        }
        if (looksCallout(t)) {
            return (
                '<p class="xw-txt xw-txt--callout">' +
                '<span class="xw-sym xw-sym--quote">「</span> ' +
                decorateInline(t) +
                ' <span class="xw-sym xw-sym--quote">」</span></p>'
            );
        }
        var cls = role === 'user' ? 'xw-txt--mine' : 'xw-txt--theirs';
        return (
            '<p class="xw-txt ' +
            cls +
            '">' +
            decorateInline(t).replace(/\n/g, '<br>') +
            '</p>'
        );
    }

    /** 手帐气泡内：多段，保留换行 */
    function decorateJournalBody(paras) {
        var list = Array.isArray(paras) ? paras : [];
        var html = list
            .map(function (para) {
                var t = String(para || '').trim();
                if (!t) return '';
                return decorateInline(t).replace(/\n/g, '<br>');
            })
            .filter(Boolean)
            .join('<br><br>');
        return html ? '<div class="xw-chat__text">' + html + '</div>' : '';
    }

    global.MiyaOfflineTextDecor = {
        decorateInline: decorateInline,
        decorateParagraph: decorateParagraph,
        decorateJournalBody: decorateJournalBody,
        wrapGlyphs: wrapGlyphs
    };
})(window);
