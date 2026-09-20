(function (global) {
    'use strict';

    var MAX_EDGE = 960;
    var JPEG_QUALITY = 0.78;
    var VISION_SUMMARY_MAX = 420;
    var AVATAR_RECOGNITION_MAX = 8000;

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    function normalizeBaseUrl(base) {
        var t = String(base || '').trim().replace(/\/+$/, '');
        if (!t) return '';
        try {
            var u = new URL(t);
            var path = (u.pathname || '/').replace(/\/+$/, '');
            var segs = path.split('/').filter(Boolean);
            if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') {
                return u.origin + path;
            }
            if (!path || path === '/') return u.origin + '/v1';
            return u.origin + path + '/v1';
        } catch (e) {
            return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
        }
    }

    function normalizeVisionSummaryText(raw, maxLen) {
        var txt = String(raw || '')
            .trim()
            .replace(/\s+/g, ' ');
        var cap = maxLen != null ? maxLen : VISION_SUMMARY_MAX;
        if (txt.length <= cap) return txt;
        return txt.slice(0, cap);
    }

    function extractChatCompletionText(data) {
        var msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) return '';
        var text = msg.content;
        if (typeof text === 'string' && text.trim()) return text.trim();
        if (Array.isArray(text)) {
            return text
                .map(function (p) {
                    return p && p.text ? String(p.text) : '';
                })
                .join('')
                .trim();
        }
        return '';
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
                resolve(String(r.result || ''));
            };
            r.onerror = function () {
                reject(new Error('read_failed'));
            };
            r.readAsDataURL(file);
        });
    }

    function readBlobAsDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
                resolve(String(r.result || ''));
            };
            r.onerror = function () {
                reject(new Error('read_failed'));
            };
            r.readAsDataURL(blob);
        });
    }

    function isLikelyImageFile(file) {
        if (!file) return false;
        var t = String(file.type || '').toLowerCase();
        if (t.indexOf('image/') === 0) return true;
        var name = String(file.name || '').toLowerCase();
        return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|svg|ico|tiff?|jfif|jpe|x-icon|raw|dng)$/i.test(name);
    }

    /** 朋友圈发布：createImageBitmap 压缩为 Blob（与 messages-app 一致，比 FileReader 更快） */
    function compressImageFileToBlob(file, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var maxEdge = opts.maxEdge != null ? opts.maxEdge : 1920;
        var quality = opts.quality != null ? opts.quality : 0.82;
        if (!file) return Promise.reject(new Error('no_file'));
        if (!isLikelyImageFile(file)) {
            return Promise.reject(new Error('invalid_image'));
        }
        return createImageBitmap(file)
            .catch(function () {
                return Promise.reject(new Error('decode_failed'));
            })
            .then(function (bitmap) {
                var w = bitmap.width || 0;
                var h = bitmap.height || 0;
                if (!w || !h) {
                    try {
                        bitmap.close && bitmap.close();
                    } catch (e0) {}
                    return Promise.reject(new Error('invalid_image'));
                }
                var scale = Math.min(1, maxEdge / w, maxEdge / h);
                var tw = Math.max(1, Math.round(w * scale));
                var th = Math.max(1, Math.round(h * scale));
                var canvas = document.createElement('canvas');
                canvas.width = tw;
                canvas.height = th;
                var ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) {
                    try {
                        bitmap.close && bitmap.close();
                    } catch (e1) {}
                    return Promise.reject(new Error('canvas_unsupported'));
                }
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bitmap, 0, 0, tw, th);
                try {
                    bitmap.close && bitmap.close();
                } catch (e2) {}
                return new Promise(function (resolve, reject) {
                    canvas.toBlob(
                        function (blob) {
                            if (!blob) {
                                reject(new Error('compress_failed'));
                                return;
                            }
                            resolve(blob);
                        },
                        'image/jpeg',
                        quality
                    );
                });
            });
    }

    /** 一轮压缩：限制长边、转 JPEG，用于存储 */
    function compressImageFile(file, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var maxEdge = opts.maxEdge != null ? opts.maxEdge : MAX_EDGE;
        var quality = opts.quality != null ? opts.quality : JPEG_QUALITY;
        if (!file) return Promise.reject(new Error('no_file'));
        return readFileAsDataUrl(file).then(function (dataUrl) {
            return new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    if (!w || !h) {
                        reject(new Error('invalid_image'));
                        return;
                    }
                    var scale = Math.min(1, maxEdge / Math.max(w, h));
                    var cw = Math.max(1, Math.round(w * scale));
                    var ch = Math.max(1, Math.round(h * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = cw;
                    canvas.height = ch;
                    var ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('canvas_unsupported'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, cw, ch);
                    canvas.toBlob(
                        function (blob) {
                            if (!blob) {
                                reject(new Error('compress_failed'));
                                return;
                            }
                            var name = String(file.name || 'image.jpg').replace(/\.[^.]+$/, '') + '.jpg';
                            resolve(new File([blob], name, { type: 'image/jpeg' }));
                        },
                        'image/jpeg',
                        quality
                    );
                };
                img.onerror = function () {
                    reject(new Error('decode_failed'));
                };
                img.src = dataUrl;
            });
        });
    }

    /** 识图提示词与 messages-app 朋友圈视觉摘要对齐 */
    function recognizeAvatarDataUrl(dataUrl) {
        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) {
            return Promise.reject(new Error('api_not_configured'));
        }
        var prompt = [
            '你是头像识别助手。',
            '请仅根据头像图片生成 1 段完整的中文描述，不要刻意缩短。',
            '这是即时通讯头像，禁止编造看不见的细节。',
            '不要输出 JSON，不要分点。'
        ].join('\n');
        return fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: model,
                temperature: 0.2,
                max_tokens: 1024,
                messages: (function () {
                    var eng = global.miyaChatEngine;
                    var msgs = [
                        { role: 'system', content: '你是严谨的多模态头像识别助手，描述必须可核验且完整。' },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: dataUrl } }
                            ]
                        }
                    ];
                    return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
                        ? eng.prependUniversalWorldbookMessage(msgs)
                        : msgs;
                })()
            })
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (t) {
                        throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                    });
                }
                return r.json();
            })
            .then(function (data) {
                var out = normalizeVisionSummaryText(extractChatCompletionText(data), AVATAR_RECOGNITION_MAX);
                if (!out) throw new Error('empty_vision');
                return out;
            });
    }

    function recognizeImageDataUrl(dataUrl) {
        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) {
            return Promise.reject(new Error('api_not_configured'));
        }
        var prompt = [
            '你是图片识别助手。',
            '请仅根据图片生成 1 段中文描述，80-180 字。',
            '必须包含：主体、场景、动作/状态、关键物体、可见文字(OCR)。',
            '禁止编造看不见的信息；看不清就明确写「看不清」。',
            '不要输出 JSON，不要分点。'
        ].join('\n');
        return fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: model,
                temperature: 0.2,
                max_tokens: 800,
                messages: (function () {
                    var eng = global.miyaChatEngine;
                    var msgs = [
                        { role: 'system', content: '你是严谨的多模态图片识别助手，描述必须可核验。' },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: dataUrl } }
                            ]
                        }
                    ];
                    return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
                        ? eng.prependUniversalWorldbookMessage(msgs)
                        : msgs;
                })()
            })
        }).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) {
                    throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                });
            }
            return r.json();
        }).then(function (data) {
            var out = normalizeVisionSummaryText(extractChatCompletionText(data), VISION_SUMMARY_MAX);
            if (!out) throw new Error('empty_vision');
            return out;
        });
    }

    function recognizeImageBlobId(st, blobId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!st || !blobId || typeof st.getAvatarUrl !== 'function') {
            return Promise.reject(new Error('no_blob'));
        }
        return st
            .getAvatarUrl(blobId)
            .then(function (url) {
                if (!url) return Promise.reject(new Error('no_blob'));
                return fetch(url).then(function (res) {
                    if (!res.ok) throw new Error('blob_fetch_failed');
                    return res.blob();
                });
            })
            .then(function (blob) {
                return readBlobAsDataUrl(blob);
            })
            .then(function (dataUrl) {
                return opts.avatar ? recognizeAvatarDataUrl(dataUrl) : recognizeImageDataUrl(dataUrl);
            });
    }

    function recognizeImageFile(file) {
        return compressImageFile(file).then(function (compressed) {
            return readFileAsDataUrl(compressed).then(function (dataUrl) {
                return recognizeImageDataUrl(dataUrl).then(function (desc) {
                    return { file: compressed, description: desc };
                });
            });
        });
    }

    function parseBatchVisionResponse(raw, count) {
        var text = String(raw || '').trim();
        var out = [];
        var i;
        for (i = 0; i < count; i++) out.push('');
        if (!text) return out;
        var re = /【\s*(\d+)\s*】([\s\S]*?)(?=【\s*\d+\s*】|$)/g;
        var m;
        while ((m = re.exec(text)) !== null) {
            var no = parseInt(m[1], 10);
            if (!no || no < 1 || no > count) continue;
            out[no - 1] = normalizeVisionSummaryText(m[2], VISION_SUMMARY_MAX);
        }
        if (out.some(function (x) { return !!x; })) return out;
        var chunks = text.split(/\n\s*---+\s*\n|\n(?=\d+[.、．]\s*)/);
        chunks.forEach(function (chunk, idx) {
            if (idx >= count) return;
            var cleaned = String(chunk || '')
                .replace(/^\d+[.、．]\s*/, '')
                .trim();
            if (cleaned) out[idx] = normalizeVisionSummaryText(cleaned, VISION_SUMMARY_MAX);
        });
        return out;
    }

    /** 一次 API 调用批量识图（最多 5 张），返回与输入顺序对应的描述数组 */
    function recognizeImageBatchDataUrls(dataUrls, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var urls = (Array.isArray(dataUrls) ? dataUrls : []).filter(Boolean);
        if (!urls.length) return Promise.reject(new Error('empty_batch'));
        if (urls.length > 5) return Promise.reject(new Error('too_many'));
        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) {
            return Promise.reject(new Error('api_not_configured'));
        }
        var prompt = [
            '你是图片识别助手。',
            '下面共有 ' + urls.length + ' 张图片，按顺序编号 1 到 ' + urls.length + '。',
            '请为每张各写 1 段中文描述（80-180 字），必须包含主体、场景、动作/状态、关键物体、可见文字(OCR)。',
            '禁止编造；看不清就写「看不清」。',
            '严格按此格式输出（不要 JSON、不要多余说明）：',
            '【1】第一段描述',
            urls.length > 1 ? '【2】第二段描述' : '',
            '…依此类推直到【' + urls.length + '】。'
        ]
            .filter(Boolean)
            .join('\n');
        var content = [{ type: 'text', text: prompt }];
        urls.forEach(function (url, i) {
            content.push({ type: 'text', text: '—— 图片 ' + (i + 1) + ' ——' });
            content.push({ type: 'image_url', image_url: { url: url } });
        });
        return fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: model,
                temperature: 0.2,
                max_tokens: Math.min(4096, 500 + urls.length * 320),
                messages: (function () {
                    var eng = global.miyaChatEngine;
                    var msgs = [
                        {
                            role: 'system',
                            content: '你是严谨的多模态图片识别助手，批量输出时每段必须可核验。'
                        },
                        { role: 'user', content: content }
                    ];
                    return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
                        ? eng.prependUniversalWorldbookMessage(msgs)
                        : msgs;
                })()
            })
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (t) {
                        throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                    });
                }
                return r.json();
            })
            .then(function (data) {
                var parsed = parseBatchVisionResponse(extractChatCompletionText(data), urls.length);
                if (!parsed.some(function (x) { return !!x; })) throw new Error('empty_vision');
                return parsed;
            });
    }

    function recognizeImageBatchBlobIds(st, blobIds, opts) {
        var ids = (Array.isArray(blobIds) ? blobIds : []).map(function (x) {
            return String(x || '').trim();
        }).filter(Boolean);
        if (!ids.length) return Promise.reject(new Error('empty_batch'));
        if (!st || typeof st.getAvatarUrl !== 'function') {
            return Promise.reject(new Error('no_blob'));
        }
        return Promise.all(
            ids.map(function (blobId) {
                return st
                    .getAvatarUrl(blobId)
                    .then(function (url) {
                        if (!url) return Promise.reject(new Error('no_blob'));
                        return fetch(url).then(function (res) {
                            if (!res.ok) throw new Error('blob_fetch_failed');
                            return res.blob();
                        });
                    })
                    .then(readBlobAsDataUrl);
            })
        ).then(function (dataUrls) {
            return recognizeImageBatchDataUrls(dataUrls, opts);
        });
    }

    global.MiyaChatImage = {
        isLikelyImageFile: isLikelyImageFile,
        compressImageFile: compressImageFile,
        compressImageFileToBlob: compressImageFileToBlob,
        recognizeImageDataUrl: recognizeImageDataUrl,
        recognizeAvatarDataUrl: recognizeAvatarDataUrl,
        recognizeImageBlobId: recognizeImageBlobId,
        recognizeImageBatchDataUrls: recognizeImageBatchDataUrls,
        recognizeImageBatchBlobIds: recognizeImageBatchBlobIds,
        recognizeImageFile: recognizeImageFile,
        readFileAsDataUrl: readFileAsDataUrl,
        readBlobAsDataUrl: readBlobAsDataUrl,
        normalizeVisionSummaryText: normalizeVisionSummaryText
    };
})(window);
