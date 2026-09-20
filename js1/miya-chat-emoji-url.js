(function (global) {
    'use strict';

    function normalizeEmojiStickerName(s) {
        return String(s || '')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function isEmojiUrlLike(s) {
        var t = String(s || '').trim();
        if (!t) return false;
        if (/^https?:\/\//i.test(t)) return true;
        if (/^data:image\//i.test(t)) return true;
        if (/^blob:/i.test(t)) return true;
        return false;
    }

    function deriveEmojiNameFromUrl(urlStr) {
        var s = String(urlStr || '').trim();
        if (/^data:image\//i.test(s)) return '表情';
        try {
            var u = new URL(s);
            var path = u.pathname || '';
            var seg = path.split('/').filter(Boolean);
            var last = seg.length ? seg[seg.length - 1] : '';
            last = decodeURIComponent(String(last).replace(/\+/g, ' '));
            last = last.replace(/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)(\?.*)?$/i, '');
            last = last.replace(/[_\-]+/g, ' ').trim();
            if (!last && u.searchParams && u.searchParams.get) {
                var q = u.searchParams.get('name') || u.searchParams.get('n') || '';
                last = String(q).trim();
            }
            var nm = normalizeEmojiStickerName(last);
            return nm || '表情';
        } catch (e) {
            return '表情';
        }
    }

    function allocateEmojiNameForUrl(urlStr, taken) {
        var base = deriveEmojiNameFromUrl(urlStr);
        var cand = base;
        var n = 2;
        while (taken[cand]) {
            cand = base + n;
            n += 1;
        }
        taken[cand] = true;
        return cand;
    }

    function resolveEmojiImportName(preferredName, urlStr, taken, opts) {
        opts = opts || {};
        var fallback = opts.fallback != null ? String(opts.fallback) : '表情';
        var nm = normalizeEmojiStickerName(preferredName);
        if (!nm) {
            if (urlStr) return allocateEmojiNameForUrl(urlStr, taken);
            nm = normalizeEmojiStickerName(fallback) || '表情';
        }
        var base = nm;
        var finalName = base;
        var n = 2;
        while (taken[finalName]) {
            finalName = base + n;
            n += 1;
        }
        taken[finalName] = true;
        return finalName;
    }

    function parseNameBeforeHttpUrl(raw) {
        var httpAt = raw.search(/https?:\/\//i);
        if (httpAt <= 0) return null;
        var before = raw.slice(0, httpAt).trim();
        var urlPart = raw.slice(httpAt).trim();
        if (!isEmojiUrlLike(urlPart)) return null;
        var sep = Math.max(before.lastIndexOf(':'), before.lastIndexOf('：'));
        var namePart = sep >= 0 ? before.slice(0, sep).trim() : before;
        if (!namePart) return { name: null, url: urlPart };
        return { name: normalizeEmojiStickerName(namePart), url: urlPart };
    }

    function parseEmojiBatchUrlLine(line) {
        var raw = String(line || '').replace(/^\uFEFF/, '').trim();
        if (!raw || raw.charAt(0) === '#') return null;
        if (/^https?:\/\//i.test(raw)) return { name: null, url: raw };
        if (/^data:image\//i.test(raw)) return { name: null, url: raw };
        if (/^blob:/i.test(raw)) return { name: null, url: raw };

        var byHttp = parseNameBeforeHttpUrl(raw);
        if (byHttp) return byHttp;

        var urlPart = '';
        var namePart = '';
        var tab = raw.indexOf('\t');
        if (tab > 0) {
            namePart = raw.slice(0, tab).trim();
            urlPart = raw.slice(tab + 1).trim();
            if (namePart && urlPart && isEmojiUrlLike(urlPart)) {
                return { name: normalizeEmojiStickerName(namePart), url: urlPart };
            }
        }
        var pipe = raw.indexOf('|');
        if (pipe > 0) {
            namePart = raw.slice(0, pipe).trim();
            urlPart = raw.slice(pipe + 1).trim();
            if (namePart && urlPart && isEmojiUrlLike(urlPart)) {
                return { name: normalizeEmojiStickerName(namePart), url: urlPart };
            }
        }
        var semi = raw.indexOf(';');
        if (semi > 0) {
            urlPart = raw.slice(semi + 1).trim();
            if (/^https?:\/\//i.test(urlPart)) {
                namePart = raw.slice(0, semi).trim();
                if (namePart && isEmojiUrlLike(urlPart)) {
                    return { name: normalizeEmojiStickerName(namePart), url: urlPart };
                }
            }
        }
        var comma = raw.indexOf(',');
        var httpAt = raw.toLowerCase().indexOf('http');
        if (comma > 0 && (httpAt < 0 || comma < httpAt)) {
            namePart = raw.slice(0, comma).trim();
            urlPart = raw.slice(comma + 1).trim();
            if (namePart && urlPart && isEmojiUrlLike(urlPart)) {
                return { name: normalizeEmojiStickerName(namePart), url: urlPart };
            }
        }
        var ci = raw.indexOf(':');
        var zi = raw.indexOf('：');
        var sep = -1;
        if (ci >= 0 && zi >= 0) sep = Math.min(ci, zi);
        else if (ci >= 0) sep = ci;
        else if (zi >= 0) sep = zi;
        if (sep >= 0) {
            namePart = raw.slice(0, sep).trim();
            urlPart = raw.slice(sep + 1).trim();
            if (namePart && urlPart && isEmojiUrlLike(urlPart)) {
                return { name: normalizeEmojiStickerName(namePart), url: urlPart };
            }
        }
        if (isEmojiUrlLike(raw)) {
            return { name: null, url: raw.trim() };
        }
        return null;
    }

    function parseEmojiBatchUrlText(text) {
        var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
        var parsed = [];
        var bad = 0;
        lines.forEach(function (line) {
            var p = parseEmojiBatchUrlLine(line);
            if (!p) {
                if (String(line || '').trim()) bad += 1;
                return;
            }
            parsed.push(p);
        });
        return { rows: parsed, skipped: bad };
    }

    global.miyaChatEmojiUrl = {
        normalizeEmojiStickerName: normalizeEmojiStickerName,
        isEmojiUrlLike: isEmojiUrlLike,
        parseEmojiBatchUrlLine: parseEmojiBatchUrlLine,
        parseEmojiBatchUrlText: parseEmojiBatchUrlText,
        deriveEmojiNameFromUrl: deriveEmojiNameFromUrl,
        allocateEmojiNameForUrl: allocateEmojiNameForUrl,
        resolveEmojiImportName: resolveEmojiImportName
    };
})(window);
