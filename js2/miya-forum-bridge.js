/**
 * miya-forum-bridge.js — 论坛 API 调用与 prompt 拼装
 */
(function (global) {
  'use strict';

  var WJ_SYS_SOCIAL_CORE =
    '【论坛网民总则】请充分理解并内化上文世界书条目中的设定。内容须像真实社交平台网友：会吐槽、会玩梗、可能抬杠或互怼、也会无语省略、真诚分享日常；避免全员官腔、说明书腔或同质化口号。';

  var WJ_POST_GEN_QUALITY =
    '【篇幅与配图】每条帖子正文须有足够信息量，避免过短敷衍；若 postKind 为 image 或提供 imageHints，每条画面描述须具体可想象（场景、主体、氛围、关键细节等），忌空泛措辞。';

  function extractJsonObject(text) {
    var t = String(text || '').trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    var j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try {
      var obj = JSON.parse(t.slice(i, j + 1));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 8000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
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

  function getApiCfg() {
    return typeof global.miyaGetApiConfigCached === 'function' ? global.miyaGetApiConfigCached() : {};
  }

  /**
   * 论坛 / 便利店 API：scoped 有填则优先；某项留空时回退对话 API 对应字段。
   */
  function resolveScopedApiConfig(cfg, key) {
    cfg = cfg && typeof cfg === 'object' ? cfg : getApiCfg();
    var scoped = cfg[key] && typeof cfg[key] === 'object' ? cfg[key] : {};
    var baseUrl = String(scoped.baseUrl || '').trim();
    var apiKey = String(scoped.apiKey || '').trim();
    var model = String(scoped.model || '').trim();
    var temp = scoped.temperature;
    if (temp != null) {
      temp = Number(temp);
      if (!Number.isFinite(temp)) temp = cfg.temperature != null ? Number(cfg.temperature) : 1;
    } else {
      temp = cfg.temperature != null ? Number(cfg.temperature) : 1;
    }
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: baseUrl || String(cfg.baseUrl || '').trim(),
      apiKey: apiKey || String(cfg.apiKey || '').trim(),
      model: model || String(cfg.model || '').trim(),
      temperature: temp
    };
  }

  function resolveForumApiConfig(cfg) {
    return resolveScopedApiConfig(cfg, 'forumApi');
  }

  function resolveCstoreApiConfig(cfg) {
    return resolveScopedApiConfig(cfg, 'cstoreApi');
  }

  function resolveItineraryApiConfig(cfg) {
    return resolveScopedApiConfig(cfg, 'itineraryApi');
  }

  function resolveChatApiConfig(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : getApiCfg();
    var temp = cfg.temperature != null ? Number(cfg.temperature) : 1;
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: String(cfg.baseUrl || '').trim(),
      apiKey: String(cfg.apiKey || '').trim(),
      model: String(cfg.model || '').trim(),
      temperature: temp
    };
  }

  function resolveSecondaryApiConfig(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : getApiCfg();
    var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
    var temp = sec.temperature != null ? Number(sec.temperature) : (cfg.temperature != null ? Number(cfg.temperature) : 1);
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: String(sec.baseUrl || '').trim(),
      apiKey: String(sec.apiKey || '').trim(),
      model: String(sec.model || '').trim(),
      temperature: temp
    };
  }

  function apiSliceKey(slice) {
    if (!slice) return '';
    return [slice.baseUrl, slice.apiKey, slice.model].join('\0');
  }

  function isNetworkFetchError(err) {
    var msg = String((err && err.message) || err || '').toLowerCase();
    if (msg.indexOf('http ') === 0) return false;
    return msg === 'failed to fetch' ||
      msg.indexOf('load failed') >= 0 ||
      msg.indexOf('networkerror') >= 0 ||
      msg.indexOf('network request failed') >= 0 ||
      msg.indexOf('请求超时') >= 0 ||
      msg.indexOf('abort') >= 0;
  }

  function normalizeApiTextContent(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      return raw.map(function (p) {
        return p && p.text != null ? String(p.text) : (p && p.content != null ? String(p.content) : '');
      }).join('').trim();
    }
    return String(raw || '').trim();
  }

  function extractReasoningText(message) {
    if (!message || typeof message !== 'object') return '';
    var rc = message.reasoning_content != null ? message.reasoning_content : message.reasoning;
    return normalizeApiTextContent(rc);
  }

  function pickJsonLikeApiText(text, message) {
    var body = String(text || '').trim();
    if (body.indexOf('{') >= 0 || body.indexOf('[') >= 0) return body;
    var reasoning = extractReasoningText(message);
    if (reasoning && (reasoning.indexOf('{') >= 0 || reasoning.indexOf('[') >= 0)) return reasoning;
    return body || reasoning;
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function extractStreamDelta(obj) {
    if (!obj || typeof obj !== 'object') return { content: '', reasoning: '' };
    var ch = obj.choices && obj.choices[0];
    if (!ch) return { content: '', reasoning: '' };
    var delta = ch.delta || ch.message || {};
    var content = normalizeApiTextContent(delta.content != null ? delta.content : delta.text);
    var reasoning = '';
    if (delta.reasoning_content != null) reasoning = normalizeApiTextContent(delta.reasoning_content);
    else if (delta.reasoning != null) reasoning = normalizeApiTextContent(delta.reasoning);
    if (!content && ch.text != null) content = normalizeApiTextContent(ch.text);
    return { content: content, reasoning: reasoning };
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return fetch(url, options);
    if (typeof AbortController === 'undefined') return fetch(url, options);
    var controller = new AbortController();
    var opts = Object.assign({}, options, { signal: controller.signal });
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('请求超时（' + Math.round(ms / 1000) + 's），请稍后重试');
      }
      throw err;
    });
  }

  function callCompletionsWithConfig(systemHint, userContent, imageParts, resolved, reqOpts) {
    var cfg = resolved || resolveForumApiConfig(getApiCfg());
    var base = normalizeBaseUrl(cfg.baseUrl);
    var model = String(cfg.model || '').trim();
    if (!base || !model || !cfg.apiKey) {
      return Promise.reject(new Error('请先在设置中配置 API'));
    }
    reqOpts = reqOpts && typeof reqOpts === 'object' ? reqOpts : {};
    var temp = cfg.temperature;
    if (typeof temp !== 'number' || !Number.isFinite(temp)) temp = Number(temp);
    if (!Number.isFinite(temp)) temp = 1;
    var parts = Array.isArray(imageParts) ? imageParts.filter(Boolean) : [];
    var userMsgContent;
    if (parts.length) {
      userMsgContent = [{ type: 'text', text: String(userContent || '') }].concat(parts);
    } else {
      userMsgContent = String(userContent || '');
    }
    var payload = {
      model: model,
      temperature: temp,
      messages: (function () {
        var eng = global.miyaChatEngine;
        var msgs = [
          { role: 'system', content: String(systemHint || '你会严格按要求输出，仅输出 JSON。') },
          { role: 'user', content: userMsgContent }
        ];
        if (reqOpts.skipUniversalWorldbook) return msgs;
        return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
          ? eng.prependUniversalWorldbookMessage(msgs)
          : msgs;
      })()
    };
    if (reqOpts.max_tokens != null && Number.isFinite(Number(reqOpts.max_tokens))) {
      payload.max_tokens = Number(reqOpts.max_tokens);
    }
    if (reqOpts.temperature != null && Number.isFinite(Number(reqOpts.temperature))) {
      payload.temperature = Number(reqOpts.temperature);
    }
    if (reqOpts.response_format && typeof reqOpts.response_format === 'object') {
      payload.response_format = reqOpts.response_format;
    }
    if (reqOpts.disableThinking) {
      payload.thinking = { type: 'disabled' };
    }
    var fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(cfg.apiKey || '').trim()
      },
      body: JSON.stringify(payload)
    };
    var timeoutMs = Number(reqOpts.timeoutMs);
    return fetchWithTimeout(base + '/chat/completions', fetchOpts, timeoutMs).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 200) : ''));
        });
      }
      return r.json();
    }).then(function (j) {
      var choice = j && j.choices && j.choices[0];
      var text = '';
      var eng = global.miyaChatEngine;
      if (reqOpts.useEngineExtract && eng && typeof eng.extractReplyContent === 'function') {
        text = eng.extractReplyContent(j);
      } else {
        var msg = choice && choice.message;
        var raw = msg && msg.content;
        if (typeof raw === 'string') text = raw.trim();
        else if (Array.isArray(raw)) {
          text = raw.map(function (p) { return p && p.text ? String(p.text) : ''; }).join('').trim();
        }
      }
      if (!text && choice && choice.message && !reqOpts.contentOnly) {
        text = extractReasoningText(choice.message);
      }
      if (reqOpts.preferJsonPayload && !reqOpts.contentOnly && choice && choice.message) {
        text = pickJsonLikeApiText(text, choice.message);
      }
      if (reqOpts.contentOnly && text) {
        var stripEng = global.miyaChatEngine;
        if (stripEng && typeof stripEng.stripThinkingForApi === 'function') {
          text = stripEng.stripThinkingForApi(text);
        }
      }
      if (!text && choice && choice.finish_reason === 'length' && !reqOpts.skipLengthCheck) {
        return Promise.reject(new Error('输出被截断'));
      }
      return text;
    });
  }

  function callCompletionsStreamWithConfig(systemHint, userContent, imageParts, resolved, reqOpts) {
    var cfg = resolved || resolveForumApiConfig(getApiCfg());
    var base = normalizeBaseUrl(cfg.baseUrl);
    var model = String(cfg.model || '').trim();
    if (!base || !model || !cfg.apiKey) {
      return Promise.reject(new Error('请先在设置中配置 API'));
    }
    reqOpts = reqOpts && typeof reqOpts === 'object' ? reqOpts : {};
    var temp = cfg.temperature;
    if (typeof temp !== 'number' || !Number.isFinite(temp)) temp = Number(temp);
    if (!Number.isFinite(temp)) temp = 1;
    var parts = Array.isArray(imageParts) ? imageParts.filter(Boolean) : [];
    var userMsgContent = parts.length
      ? [{ type: 'text', text: String(userContent || '') }].concat(parts)
      : String(userContent || '');
    var payload = {
      model: model,
      temperature: temp,
      stream: true,
      messages: (function () {
        var eng = global.miyaChatEngine;
        var msgs = [
          { role: 'system', content: String(systemHint || '你会严格按要求输出，仅输出 JSON。') },
          { role: 'user', content: userMsgContent }
        ];
        if (reqOpts.skipUniversalWorldbook) return msgs;
        return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
          ? eng.prependUniversalWorldbookMessage(msgs)
          : msgs;
      })()
    };
    if (reqOpts.max_tokens != null && Number.isFinite(Number(reqOpts.max_tokens))) {
      payload.max_tokens = Number(reqOpts.max_tokens);
    }
    if (reqOpts.temperature != null && Number.isFinite(Number(reqOpts.temperature))) {
      payload.temperature = Number(reqOpts.temperature);
    }
    if (reqOpts.response_format && typeof reqOpts.response_format === 'object') {
      payload.response_format = reqOpts.response_format;
    }
    if (reqOpts.disableThinking) {
      payload.thinking = { type: 'disabled' };
    }
    var fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(cfg.apiKey || '').trim()
      },
      body: JSON.stringify(payload)
    };
    var timeoutMs = Number(reqOpts.timeoutMs);
    return fetchWithTimeout(base + '/chat/completions', fetchOpts, timeoutMs).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
        });
      }
      function finalizeAccum(contentAcc, reasoningAcc, finishReason) {
        var text = String(contentAcc || '').trim();
        var reasoning = String(reasoningAcc || '').trim();
        if (reqOpts.preferJsonPayload) {
          text = pickJsonLikeApiText(text, { content: text, reasoning_content: reasoning });
        } else if (!text && reasoning) {
          text = reasoning;
        }
        if (reqOpts.useEngineExtract && !text) {
          var eng = global.miyaChatEngine;
          if (eng && typeof eng.extractReplyContent === 'function') {
            text = eng.extractReplyContent({
              choices: [{ message: { content: contentAcc, reasoning_content: reasoning } }]
            });
          }
        }
        if (reqOpts.contentOnly && text) {
          var stripEng = global.miyaChatEngine;
          if (stripEng && typeof stripEng.stripThinkingForApi === 'function') {
            text = stripEng.stripThinkingForApi(text);
          }
        }
        if (!text && finishReason === 'length' && !reqOpts.skipLengthCheck) {
          return Promise.reject(new Error('输出被截断'));
        }
        if (!text) return Promise.reject(new Error('API 返回为空'));
        return text;
      }
      if (!res.body || !res.body.getReader) {
        return res.json().then(function (j) {
          var choice = j && j.choices && j.choices[0];
          var msg = choice && choice.message;
          var contentAcc = msg ? normalizeApiTextContent(msg.content) : '';
          var reasoningAcc = msg ? extractReasoningText(msg) : '';
          if (!contentAcc) {
            var eng = global.miyaChatEngine;
            if (eng && typeof eng.extractReplyContent === 'function') {
              contentAcc = eng.extractReplyContent(j);
            }
          }
          return finalizeAccum(contentAcc, reasoningAcc, choice && choice.finish_reason);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var sseBuf = '';
      var contentAcc = '';
      var reasoningAcc = '';
      var finishReason = '';
      function consumeSseLine(line) {
        var trimmed = String(line || '').trim();
        if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return;
        if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
        if (!trimmed || trimmed === '[DONE]') return;
        try {
          var obj = JSON.parse(trimmed);
          if (obj && obj.choices && obj.choices[0] && obj.choices[0].finish_reason) {
            finishReason = obj.choices[0].finish_reason;
          }
          var delta = extractStreamDelta(obj);
          if (delta.content) contentAcc += delta.content;
          if (delta.reasoning) reasoningAcc += delta.reasoning;
        } catch (e) { /* ignore partial SSE */ }
      }
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (sseBuf.trim()) consumeSseLine(sseBuf);
            return finalizeAccum(contentAcc, reasoningAcc, finishReason);
          }
          sseBuf += decoder.decode(result.value, { stream: true });
          var parts = sseBuf.split('\n');
          sseBuf = parts.pop() || '';
          parts.forEach(consumeSseLine);
          return pump();
        });
      }
      return pump();
    });
  }

  function callChatCompletionsRaw(systemHint, userContent, imageParts) {
    return callCompletionsWithConfig(systemHint, userContent, imageParts, resolveForumApiConfig(getApiCfg()));
  }

  function callMainChatCompletionsRaw(systemHint, userContent, imageParts, reqOpts) {
    return callCompletionsWithConfig(systemHint, userContent, imageParts, resolveChatApiConfig(getApiCfg()), reqOpts);
  }

  function callCstoreCompletionsRaw(systemHint, userContent, imageParts) {
    return callCompletionsWithConfig(systemHint, userContent, imageParts, resolveCstoreApiConfig(getApiCfg()));
  }

  function callItineraryCompletionsRaw(systemHint, userContent, imageParts, reqOpts) {
    var callOpts = Object.assign({
      skipUniversalWorldbook: true,
      skipLengthCheck: true,
      useEngineExtract: true,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      timeoutMs: 180000
    }, reqOpts || {});
    delete callOpts.preferJsonFormat;
    delete callOpts.preferStream;

    var cfg = getApiCfg();
    var resolved = resolveItineraryApiConfig(cfg);
    if (!resolved.baseUrl || !resolved.apiKey || !resolved.model) {
      return Promise.reject(new Error('请先在设置中配置 API'));
    }

    if (callOpts.stream === false) {
      return callCompletionsWithConfig(systemHint, userContent, imageParts, resolved, callOpts);
    }

    return callCompletionsStreamWithConfig(systemHint, userContent, imageParts, resolved, callOpts)
      .catch(function (err) {
        var retryOpts = Object.assign({}, callOpts, { stream: false });
        return callCompletionsWithConfig(systemHint, userContent, imageParts, resolved, retryOpts);
      });
  }

  async function blobIdToDataUrl(blobId) {
    var cs = global.miyaChatStore;
    var imgApi = global.MiyaChatImage;
    var key = String(blobId || '').trim();
    if (!key || !cs || typeof cs.getAvatarUrl !== 'function') return '';
    try {
      var url = await cs.getAvatarUrl(key);
      if (!url) return '';
      var res = await fetch(url);
      if (!res.ok) return '';
      var blob = await res.blob();
      if (imgApi && typeof imgApi.readBlobAsDataUrl === 'function') {
        return await imgApi.readBlobAsDataUrl(blob);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async function resolveForumImageDataUrl(im) {
    if (!im) return '';
    var src = String(im.src || '').trim();
    if (/^data:image\//i.test(src)) return src;
    var key = String(im.imageKey || '').trim();
    if (key) return blobIdToDataUrl(key);
    if (/^https?:/i.test(src)) return src;
    return '';
  }

  async function recognizePostRealImages(post, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var force = !!opts.force;
    var cs = global.miyaChatStore;
    var imgApi = global.MiyaChatImage;
    if (!post || !cs || !imgApi || typeof imgApi.recognizeImageBlobId !== 'function') return post;
    var images = Array.isArray(post.images) ? post.images : [];
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (!im || im.type !== 'real') continue;
      var key = String(im.imageKey || '').trim();
      if (!key) continue;
      if (!force && String(im.imageDesc || '').trim()) continue;
      try {
        im.imageDesc = await imgApi.recognizeImageBlobId(cs, key, {});
      } catch (e) {}
    }
    return post;
  }

  async function buildForumPostMediaBundle(post) {
    var images = Array.isArray(post && post.images) ? post.images : [];
    var textLines = [];
    var imageParts = [];
    var attached = 0;
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (!im) continue;
      if (im.type === 'text-image') {
        textLines.push('配图' + (i + 1) + '（文字图）：' + String(im.textBody || '').trim());
      } else if (im.type === 'real') {
        var sum = String(im.imageDesc || '').trim();
        textLines.push('配图' + (i + 1) + '（真实图片）：' + (sum || '见下方附件图片，请仔细观看后再评论'));
        var dataUrl = await resolveForumImageDataUrl(im);
        if (dataUrl && /^data:image\//i.test(dataUrl)) {
          imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
          attached++;
        } else if (dataUrl && /^https?:/i.test(dataUrl)) {
          imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
          attached++;
        }
      }
    }
    return {
      textBlock: textLines.length ? ('【配图信息】\n' + textLines.join('\n')) : '',
      imageParts: imageParts,
      hasRealImages: images.some(function (x) { return x && x.type === 'real'; }),
      attachedRealImages: attached
    };
  }

  function applyVisionSummariesToPost(post, summaries) {
    if (!post || !Array.isArray(summaries) || !summaries.length) return post;
    var realIdx = 0;
    (post.images || []).forEach(function (im) {
      if (!im || im.type !== 'real') return;
      var s = String(summaries[realIdx] || '').trim();
      if (s) im.imageDesc = s;
      realIdx++;
    });
    return post;
  }

  function appendSocialSysRule(sys) {
    return String(sys || '').trim() + '\n' + WJ_SYS_SOCIAL_CORE;
  }

  function appendPostGenSysRule(sys) {
    return appendSocialSysRule(String(sys || '').trim() + '\n' + WJ_POST_GEN_QUALITY);
  }

  async function listWorldbookEntriesEnabled() {
    var wb = global.miyaWorldbookStore;
    if (!wb || typeof wb.whenReady !== 'function') return [];
    await wb.whenReady();
    return (typeof wb.listEntries === 'function' ? wb.listEntries() : []).filter(function (e) {
      return e && e.enabled !== false;
    });
  }

  async function buildPromptPrefix(forumState) {
    var st = forumState || {};
    var ids = Array.isArray(st.worldbookEntryIds) ? st.worldbookEntryIds : [];
    var entries = await listWorldbookEntriesEnabled();
    var map = {};
    entries.forEach(function (e) {
      if (e && e.id) map[String(e.id)] = e;
    });
    var wbParts = [];
    ids.forEach(function (id) {
      var e = map[String(id)];
      if (!e) return;
      wbParts.push('【世界书 · ' + String(e.name || id) + '】\n' + String(e.content || '').trim());
    });
    if (!wbParts.length) return '【世界书附加设定】（未勾选条目）';
    return '【世界书附加设定】\n' + wbParts.join('\n\n');
  }

  function buildWorldviewBlock(forumState) {
    var wv = String((forumState && forumState.worldview) || '').trim();
    if (!wv) {
      return '【世界观背景】（未填写，请依据常见现代社交网络语境，生成独立路人网民的真实日常内容）';
    }
    return '【世界观背景】\n' + wv;
  }

  async function buildWorldContextOnly(forumState) {
    return buildWorldviewBlock(forumState) + '\n\n' + (await buildPromptPrefix(forumState));
  }

  function listAllCharacterNames() {
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.listCharacters !== 'function') return [];
    return cs.listCharacters('all').map(function (c) {
      return String(c.name || '').trim();
    }).filter(Boolean);
  }

  function looksLikeCharacterName(name, charNames) {
    var n = String(name || '').trim().toLowerCase();
    if (!n) return false;
    return (charNames || []).some(function (cn) {
      var c = String(cn || '').trim().toLowerCase();
      return c && (n === c || n.indexOf(c) >= 0 || c.indexOf(n) >= 0);
    });
  }

  function randomNpcDisplayName(index) {
    var prefixes = ['深夜', '摸鱼', '今天也', '路过的', '不想', '随便', '一颗', '楼下', '隔壁'];
    var suffixes = ['网友', '吃瓜群众', '打工人', '熬夜党', '路人甲', '小透明', '潜水员'];
    return prefixes[index % prefixes.length] + suffixes[index % suffixes.length] + (100 + Math.floor(Math.random() * 900));
  }

  function findContactCharacter(contactId) {
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.findCharacter !== 'function') return null;
    return cs.findCharacter(contactId);
  }

  function findChatContactByCharacterId(contactId) {
    var st = global.miyaChatStore;
    var cs = global.miyaContactsStore;
    if (!st || typeof st.getContacts !== 'function') return null;
    var cid = String(contactId || '').trim();
    if (!cid) return null;
    var charRow = cs && cs.findCharacter ? cs.findCharacter(cid) : null;
    return (st.getContacts('all') || []).find(function (c) {
      if (c.chronicleId && c.chronicleId === cid) return true;
      if (charRow && c.characterId === (charRow.characterId || charRow.id)) return true;
      if (c.characterId === cid) return true;
      return false;
    }) || null;
  }

  /** 角色是否绑定到当前论坛用户面具（仅聊天面具有绑定关系） */
  function isCharacterBoundToUserMask(contactId, activeMaskInfo) {
    if (!contactId || !activeMaskInfo) return false;
    if (activeMaskInfo.source !== 'chat' || !activeMaskInfo.id) return false;
    var contact = findChatContactByCharacterId(contactId);
    if (!contact) return false;
    return String(contact.defaultProfileId || '').trim() === String(activeMaskInfo.id).trim();
  }

  function filterUserPostComments(comments, activeMaskInfo) {
    if (!Array.isArray(comments) || !comments.length) return [];
    return comments.filter(function (c) {
      if (!c || c.authorKind !== 'character') return true;
      var cid = String(c.authorContactId || '').trim();
      if (!cid) return false;
      return isCharacterBoundToUserMask(cid, activeMaskInfo);
    });
  }

  function sanitizeCharacterForPrompt(row) {
    if (!row || typeof row !== 'object') return {};
    var o = {
      id: row.id,
      characterId: row.characterId || row.id,
      name: row.name,
      age: row.age,
      gender: row.gender,
      persona: truncateStr(row.persona || '', 6000),
      tags: row.tags || []
    };
    return o;
  }

  function getCharacterForumNickname(contactId, forumState) {
    var st = forumState || {};
    var nicknames = st.characterForumNicknames || {};
    var cid = String(contactId || '').trim();
    if (!cid) return '';
    if (nicknames[cid]) return String(nicknames[cid]).trim();
    var row = findContactCharacter(cid);
    if (row && row.characterId && nicknames[row.characterId]) {
      return String(nicknames[row.characterId]).trim();
    }
    return '';
  }

  function getCharacterForumDisplayName(contactId, forumState) {
    var nick = getCharacterForumNickname(contactId, forumState);
    if (nick) return nick;
    var row = findContactCharacter(contactId);
    return row ? String(row.name || '').trim() : '';
  }

  function buildUserMaskContextBlock(activeMaskInfo) {
    if (!activeMaskInfo) return '【论坛用户资料】（未设置面具）';
    return '【论坛用户资料 · 发帖人本人】\n' + JSON.stringify({
      nickname: activeMaskInfo.nickname || '',
      persona: truncateStr(activeMaskInfo.persona || '', 4000),
      signature: activeMaskInfo.signature || '',
      note: '这是论坛里真实存在的用户本人。用户发帖时 authorType=user；角色必须知道发帖人就是此用户，并依据「与各角色的关系」自然互动。'
    }, null, 2);
  }

  async function buildCharacterContextBlock(contactId, activeMaskInfo, forumState) {
    var charRow = findContactCharacter(contactId);
    var lines = ['【角色档案】'];
    if (!charRow) {
      lines.push('(未找到角色：' + String(contactId) + ')');
    } else {
      var payload = sanitizeCharacterForPrompt(charRow);
      var forumNick = getCharacterForumNickname(contactId, forumState);
      if (forumNick) payload.forumNickname = forumNick;
      lines.push(JSON.stringify(payload, null, 2));
    }
    var chatContact = findChatContactByCharacterId(contactId);
    if (chatContact && chatContact.relationship) {
      lines.push('\n【与用户的关系】\n' + truncateStr(chatContact.relationship, 1200));
    }
    if (activeMaskInfo) {
      lines.push('\n【论坛用户人设摘要】\n' + JSON.stringify({
        nickname: activeMaskInfo.nickname || '',
        persona: truncateStr(activeMaskInfo.persona || '', 2000),
        signature: activeMaskInfo.signature || ''
      }, null, 2));
    }
    return lines.join('\n');
  }

  function getRelationsAmongCharacters(characterIds) {
    var rs = global.miyaContactsRelationshipStore;
    var cs = global.miyaContactsStore;
    if (!rs || typeof rs.getRelation !== 'function' || !cs) return {};
    var ids = (characterIds || []).map(String).filter(Boolean);
    var out = {};
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = findContactCharacter(ids[i]);
        var b = findContactCharacter(ids[j]);
        if (!a || !b) continue;
        var gid = a.groupId === b.groupId ? a.groupId : '';
        var rel = rs.getRelation(a.id, b.id, gid) || rs.getRelation(a.characterId, b.characterId, gid);
        if (rel) out[a.name + '↔' + b.name] = truncateStr(rel, 300);
      }
    }
    return out;
  }

  function listRelatedCharacterIds(characterId) {
    var rs = global.miyaContactsRelationshipStore;
    if (!rs || typeof rs.listRelationsForCharacter !== 'function') return [];
    var id = String(characterId || '').trim();
    if (!id) return [];
    return (rs.listRelationsForCharacter(id) || []).map(function (e) {
      return String(e.toId || '').trim();
    }).filter(Boolean);
  }

  async function buildRelatedCharactersContext(anchorContactId, forumState) {
    var expanded = await buildExpandedCharacterPostCommentContext(anchorContactId, null, forumState);
    return expanded || '';
  }

  function getUserRelationshipWithCharacter(contactId) {
    var chatContact = findChatContactByCharacterId(contactId);
    return chatContact && chatContact.relationship
      ? truncateStr(chatContact.relationship, 1200)
      : '';
  }

  function collectCharacterNetworkIds(anchorContactId) {
    var anchor = String(anchorContactId || '').trim();
    var direct = listRelatedCharacterIds(anchor);
    var seen = {};
    seen[anchor] = true;
    direct.forEach(function (id) { seen[id] = true; });
    var indirect = [];
    direct.forEach(function (rid) {
      listRelatedCharacterIds(rid).forEach(function (rid2) {
        if (!seen[rid2]) {
          seen[rid2] = true;
          indirect.push(rid2);
        }
      });
    });
    return { direct: direct, indirect: indirect, all: direct.concat(indirect) };
  }

  async function buildExpandedCharacterPostCommentContext(anchorContactId, activeMaskInfo, forumState) {
    var anchor = String(anchorContactId || '').trim();
    if (!anchor) return '';
    var parts = [await buildCharacterContextBlock(anchor, activeMaskInfo, forumState)];
    var network = collectCharacterNetworkIds(anchor);
    if (!network.all.length) return parts.join('\n\n');

    parts.push('【与发帖角色相关的人际网络（含一度与二度关系；评论时可能出场，须严格区分身份与人设）】');
    var i;
    for (i = 0; i < network.direct.length; i++) {
      var rid = network.direct[i];
      var row = findContactCharacter(rid);
      if (!row) continue;
      var relToAuthor = global.miyaContactsRelationshipStore && global.miyaContactsRelationshipStore.getRelation
        ? global.miyaContactsRelationshipStore.getRelation(anchor, rid, row.groupId)
        : '';
      var payload = sanitizeCharacterForPrompt(row);
      var forumNick = getCharacterForumNickname(rid, forumState);
      if (forumNick) payload.forumNickname = forumNick;
      var block = [
        '角色「' + String(row.name || rid) + '」（id=' + rid + '，与发帖人一度关系：' + (relToAuthor || '有关联') + '）',
        JSON.stringify(payload, null, 2)
      ];
      var userRel = getUserRelationshipWithCharacter(rid);
      if (userRel) block.push('【该角色与用户的关系】\n' + userRel);
      parts.push(block.join('\n'));
    }
    for (i = 0; i < network.indirect.length; i++) {
      var rid2 = network.indirect[i];
      var row2 = findContactCharacter(rid2);
      if (!row2) continue;
      var relToAuthor2 = global.miyaContactsRelationshipStore && global.miyaContactsRelationshipStore.getRelation
        ? global.miyaContactsRelationshipStore.getRelation(anchor, rid2, row2.groupId)
        : '';
      var payload2 = sanitizeCharacterForPrompt(row2);
      var forumNick2 = getCharacterForumNickname(rid2, forumState);
      if (forumNick2) payload2.forumNickname = forumNick2;
      var block2 = [
        '角色「' + String(row2.name || rid2) + '」（id=' + rid2 + '，与发帖人二度关系' +
          (relToAuthor2 ? '：' + relToAuthor2 : '，通过共同熟人关联') + '）',
        JSON.stringify(payload2, null, 2)
      ];
      var userRel2 = getUserRelationshipWithCharacter(rid2);
      if (userRel2) block2.push('【该角色与用户的关系】\n' + userRel2);
      parts.push(block2.join('\n'));
    }

    var relSummary = getRelationsAmongCharacters([anchor].concat(network.all));
    if (Object.keys(relSummary).length) {
      parts.push('【相关角色间关系摘要（含发帖人、一度与二度人脉）】\n' + JSON.stringify(relSummary, null, 2));
    }
    return parts.join('\n\n');
  }

  function activityWeight(level) {
    if (level === 'high') return 3;
    if (level === 'medium') return 2;
    if (level === 'low') return 1;
    return 0;
  }

  function pickCharactersForUserPost(forumState, count, activeMaskInfo) {
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.listCharacters !== 'function') return pickCharactersForFeed(forumState, count);
    var activity = (forumState && forumState.characterActivity) || {};
    var chatSt = global.miyaChatStore;
    var relatedScore = {};
    if (chatSt && typeof chatSt.getContacts === 'function') {
      (chatSt.getContacts('all') || []).forEach(function (contact) {
        var cid = String(contact.chronicleId || contact.characterId || '').trim();
        if (!cid) return;
        var rel = String(contact.relationship || '').trim();
        relatedScore[cid] = rel ? 4 : 1;
      });
    }
    var chars = cs.listCharacters('all').filter(function (c) {
      var lv = activity[c.id] || activity[c.characterId] || 'off';
      if (lv === 'off') return false;
      return isCharacterBoundToUserMask(c.id, activeMaskInfo);
    });
    if (!chars.length || count <= 0) return [];
    chars.sort(function (a, b) {
      var sa = (relatedScore[a.id] || relatedScore[a.characterId] || 0) + activityWeight(activity[a.id] || activity[a.characterId] || 'off');
      var sb = (relatedScore[b.id] || relatedScore[b.characterId] || 0) + activityWeight(activity[b.id] || activity[b.characterId] || 'off');
      return sb - sa;
    });
    var picked = [];
    var seen = {};
    chars.forEach(function (c) {
      if (picked.length >= count) return;
      var key = String(c.id);
      if (seen[key]) return;
      seen[key] = true;
      picked.push(c);
    });
    return picked.slice(0, count);
  }

  function getPostImageDescriptions(images) {
    return (images || []).map(function (im) {
      if (!im) return '';
      if (im.type === 'text-image') return im.textBody || '';
      if (im.type === 'real') {
        var desc = String(im.imageDesc || '').trim();
        return desc || '[用户上传的真实图片，暂无识图描述]';
      }
      return '';
    }).filter(Boolean);
  }

  function buildCommentParticipantRoster(post, activeMaskInfo, forumState) {
    var st = forumState || (global.miyaForumStore ? global.miyaForumStore.getState() : {});
    var roster = [];
    if (post.authorType === 'user') {
      roster.push({
        role: 'postAuthor',
        authorKind: 'user',
        authorDisplay: post.authorDisplay,
        note: '发帖用户本人，绝对禁止生成该身份的任何评论'
      });
    } else if (post.authorType === 'character') {
      roster.push({
        role: 'postAuthor',
        authorKind: 'character',
        authorContactId: post.authorContactId || '',
        authorDisplay: post.authorDisplay,
        note: '发帖角色'
      });
    }
    (post.commentsFlat || []).forEach(function (c) {
      var item = {
        commentId: c.id,
        authorKind: c.authorKind,
        authorContactId: c.authorContactId || '',
        authorDisplay: c.authorDisplay,
        replyToId: c.replyToId || null,
        textPreview: truncateStr(c.text, 100)
      };
      if (c.authorKind === 'character' && c.authorContactId) {
        var row = findContactCharacter(c.authorContactId);
        if (row) item.characterRealName = row.name;
        item.userRelationship = getUserRelationshipWithCharacter(c.authorContactId) || '';
      }
      roster.push(item);
    });
    var charIds = [];
    if (post.authorType === 'character' && post.authorContactId) charIds.push(post.authorContactId);
    (post.commentsFlat || []).forEach(function (c) {
      if (c.authorKind === 'character' && c.authorContactId) charIds.push(c.authorContactId);
    });
    if (post.authorType === 'user') {
      pickCharactersForUserPost(st, 5, activeMaskInfo).forEach(function (c) { charIds.push(c.id); });
    }
    var uniqueIds = [];
    var seen = {};
    charIds.forEach(function (id) {
      var k = String(id || '').trim();
      if (!k || seen[k]) return;
      seen[k] = true;
      uniqueIds.push(k);
    });
    if (post.authorType === 'user') {
      uniqueIds = uniqueIds.filter(function (id) {
        return isCharacterBoundToUserMask(id, activeMaskInfo);
      });
    }
    var potential = uniqueIds.map(function (id) {
      var row = findContactCharacter(id);
      if (!row) return null;
      return {
        authorKind: 'character',
        authorContactId: id,
        authorDisplay: getCharacterForumDisplayName(id, st) || row.name,
        characterRealName: row.name,
        userRelationship: getUserRelationshipWithCharacter(id) || '（未设定）'
      };
    }).filter(Boolean);
    return { existing: roster, potentialCommenters: potential };
  }

  async function buildUserPostCommentContext(forumState, activeMaskInfo) {
    var picked = pickCharactersForUserPost(forumState, 5, activeMaskInfo);
    if (!picked.length) return '';
    var parts = ['【用户帖子 · 可能参与评论的角色（须严格区分每位角色身份与人设，禁止串号）】'];
    if (activeMaskInfo && activeMaskInfo.nickname) {
      parts.push(
        '【发帖人身份 · 必读】\n' +
        '本帖由论坛用户「' + activeMaskInfo.nickname + '」本人发布（authorType=user）。' +
        '所有角色评论时必须明确：发帖人就是这位用户，不是路人网友。' +
        (activeMaskInfo.persona ? '\n用户人设：' + truncateStr(activeMaskInfo.persona, 2000) : '') +
        (activeMaskInfo.signature ? '\n用户签名：' + activeMaskInfo.signature : '')
      );
    }
    var charIds = [];
    var i;
    for (i = 0; i < picked.length; i++) {
      charIds.push(picked[i].id);
      parts.push(await buildCharacterContextBlock(picked[i].id, activeMaskInfo, forumState));
      var userRel = getUserRelationshipWithCharacter(picked[i].id);
      if (userRel) {
        parts.push(
          '【' + picked[i].name + ' 与用户的关系 · 评论时必须内化】\n' + userRel +
          '\n若关系为恋人/朋友/家人等，评论语气与称呼须符合此关系，不可当作陌生人。'
        );
      }
    }
    for (i = 0; i < picked.length; i++) {
      var network = collectCharacterNetworkIds(picked[i].id);
      for (var j = 0; j < network.direct.length; j++) {
        var rid = network.direct[j];
        if (charIds.indexOf(rid) >= 0) continue;
        if (!isCharacterBoundToUserMask(rid, activeMaskInfo)) continue;
        charIds.push(rid);
        var row = findContactCharacter(rid);
        if (!row) continue;
        var relToPicked = global.miyaContactsRelationshipStore && global.miyaContactsRelationshipStore.getRelation
          ? global.miyaContactsRelationshipStore.getRelation(picked[i].id, rid, row.groupId)
          : '';
        var payload = sanitizeCharacterForPrompt(row);
        var forumNick = getCharacterForumNickname(rid, forumState);
        if (forumNick) payload.forumNickname = forumNick;
        var block = [
          '关联角色「' + String(row.name || rid) + '」（id=' + rid + '，与「' + picked[i].name + '」的关系：' + (relToPicked || '有关联') + '）',
          JSON.stringify(payload, null, 2)
        ];
        var userRel = getUserRelationshipWithCharacter(rid);
        if (userRel) block.push('【该角色与用户的关系】\n' + userRel);
        parts.push(block.join('\n'));
      }
    }
    var relSummary = getRelationsAmongCharacters(charIds);
    if (Object.keys(relSummary).length) {
      parts.push('【参与角色间关系摘要（评论互动须尊重这些关系，不可张冠李戴）】\n' + JSON.stringify(relSummary, null, 2));
    }
    parts.push(
      '【身份守则 · 违反则视为生成失败】\n' +
      '- 每位角色评论时 authorKind=character，authorContactId 必须与上表 id 精确对应，authorDisplay 必须用该角色的论坛昵称。\n' +
      '- 禁止把 A 角色的语气/立场/称呼套在 B 角色上；禁止用角色真名作 authorDisplay。\n' +
      '- 楼中楼回复时，replyToIndex/replyToId 指向谁，内容就必须在回应那一条评论，且回复者身份不可与被回复者混淆。\n' +
      '- 与用户有关系的角色更可能来评论，须结合「与用户的关系」自然互动；恋人/暧昧关系须体现亲密感，不可 OOC 成陌生人。\n' +
      '- 多角色同帖时，每位角色的说话方式、口癖、立场必须明显不同，严禁千篇一律。'
    );
    return parts.join('\n\n');
  }

  function sortCommentsFlat(post) {
    if (!post || !Array.isArray(post.commentsFlat)) return;
    post.commentsFlat.sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function pickCharactersForFeed(forumState, count) {
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.listCharacters !== 'function') return [];
    var activity = (forumState && forumState.characterActivity) || {};
    var chars = cs.listCharacters('all').filter(function (c) {
      var lv = activity[c.id] || activity[c.characterId] || 'off';
      return lv !== 'off';
    });
    if (!chars.length || count <= 0) return [];
    var pool = [];
    chars.forEach(function (c) {
      var lv = activity[c.id] || activity[c.characterId] || 'off';
      var w = activityWeight(lv);
      for (var i = 0; i < w; i++) pool.push(c);
    });
    if (!pool.length) return [];
    var picked = [];
    var seen = {};
    var tries = 0;
    while (picked.length < count && tries < 80) {
      tries++;
      var c = pool[Math.floor(Math.random() * pool.length)];
      var key = String(c.id);
      if (seen[key]) continue;
      seen[key] = true;
      picked.push(c);
    }
    return picked;
  }

  function normalizeImageHints(hints, postKind) {
    var arr = Array.isArray(hints) ? hints : [];
    var bodies = arr.map(function (h) { return String(h || '').trim(); }).filter(Boolean).slice(0, 6);
    if (!bodies.length && (postKind === 'image' || postKind === 'video')) {
      bodies.push('配图');
    }
    return bodies;
  }

  function mergeEngagementCounts(post, suggestedLikes, suggestedComments) {
    var likes = Math.max(0, Math.floor(Number(suggestedLikes) || 0));
    var comments = Math.max(0, Math.floor(Number(suggestedComments) || 0));
    if (!likes) likes = 20 + Math.floor(Math.random() * 180);
    if (!comments) comments = 3 + Math.floor(Math.random() * 25);
    post.likeCount = likes;
    post.commentCount = comments;
    return post;
  }

  async function buildNpcPostGenerationPrompt(forumState, npcCount) {
    var ctx = await buildWorldContextOnly(forumState);
    return ctx + '\n\n【生成要求】\n' +
      '生成恰好 ' + npcCount + ' 条由虚拟路人网民发布的社交媒体帖子（authorType 必须为 npc）。\n' +
      '【NPC 身份规则】这些网民是上述世界观里真实存在的普通人，各有原创网名、职业、爱好、日常烦恼与社交圈；' +
      '发帖内容应像真实社交平台：吐槽、晒日常、讨论八卦、分享见闻，风格各异、互不雷同。\n' +
      '【严禁】不得使用任何故事角色、人设档案中的名字、关系或私人设定；不得 authorType=character；' +
      '不得 @ 或提及论坛用户（「我」）。authorDisplay 须为原创网名，不要与常见主角/角色名雷同。';
  }

  async function buildCharacterPostGenerationPrompt(forumState, pickedChars, charCount, activeMaskInfo) {
    var parts = [await buildWorldContextOnly(forumState)];
    parts.push('\n【本批须以以下角色身份发帖（共 ' + charCount + ' 条，authorType=character）】');
    for (var i = 0; i < pickedChars.length; i++) {
      parts.push(await buildCharacterContextBlock(pickedChars[i].id, activeMaskInfo, forumState));
    }
    var rel = getRelationsAmongCharacters(pickedChars.map(function (c) { return c.id; }));
    if (Object.keys(rel).length) {
      parts.push('\n【角色间关系摘要】\n' + JSON.stringify(rel, null, 2));
    }
    parts.push(
      '\n【生成要求】生成恰好 ' + charCount + ' 条由上述指定角色本人发布的帖子。' +
      'authorType 必须为 character，须填 authorContactId 为角色 id。' +
      'authorDisplay 须用该角色的论坛昵称（若档案中有 forumNickname 则用昵称，否则用真名）；发帖时不暴露真名。' +
      '内容须符合其人设与上述世界观，可偶尔提及日常但不必每条都围绕用户。' +
      (activeMaskInfo && activeMaskInfo.nickname
        ? '仅角色帖可在正文中偶尔 @' + activeMaskInfo.nickname + '（不要频繁，约每 5 条最多 1 次）。'
        : '')
    );
    return parts.join('\n\n');
  }

  var COMMENT_THREAD_RULES =
    '【楼中楼评论规则】每条帖子须含 initialComments 数组（4~8 条）。' +
    '顶层评论 replyToIndex 省略或 null；回复某条评论时填 replyToIndex 为同帖 initialComments 中该条的下标（从 0 起）。' +
    '鼓励部分评论互相回复形成楼中楼，但须逻辑连贯。' +
    '路人评论 authorKind 必须为 npc，authorDisplay 须为原创网名，严禁冒充任何角色真名或论坛昵称。' +
    '角色评论 authorKind 必须为 character，必须填 authorContactId，语气须严格符合角色档案人设。' +
    '角色帖评论区须区分每位评论者身份；有人际关系的其他角色可能前来评论，须读取其完整人设且不可串台。' +
    '角色评论 authorDisplay 用论坛昵称（若有 forumNickname），勿暴露真名。';

  var NPC_POST_SYS = appendPostGenSysRule(
    '你是平行宇宙论坛模拟器。只输出 JSON：{posts:[{authorType:"npc",authorDisplay,text,postKind:"text"|"image",location?,imageHints?:[],suggestedLikes,suggestedComments,initialComments:[{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToIndex?,likes}]}]}。' +
    'authorType 必须为 npc。imageHints 至多3条、每条一句画面文字描述，可无。不要输出图片二进制。\n' + COMMENT_THREAD_RULES
  );

  var CHAR_POST_SYS = appendPostGenSysRule(
    '你是内容生成器。只输出 JSON：{posts:[{authorType:"character",authorContactId,authorDisplay,text,postKind:"text"|"image",location?,imageHints?:[],suggestedLikes,suggestedComments,initialComments:[{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToIndex?,likes}]}]}。' +
    'authorType 必须为 character，必须填 authorContactId（上文给出的角色 id）且 authorDisplay 用角色真名。' +
    'imageHints 至多3条。不要输出图片二进制。\n' + COMMENT_THREAD_RULES +
    '\n【角色帖评论】路人用 npc+原创网名；角色互动须填 authorContactId 且符合人设。' +
    '发帖角色本人若回复评论，authorKind 必须为 character 且 authorContactId 等于发帖角色 id，语气须符合其人设。' +
    '严禁路人评论使用角色真名或冒充发帖角色。'
  );

  function makePostShell(index, baseMs) {
    return {
      id: global.miyaForumStore ? global.miyaForumStore.nowId() : ('fpost_' + Date.now() + '_' + index),
      authorType: 'npc',
      authorContactId: '',
      authorDisplay: '',
      authorAvatar: '',
      text: '',
      images: [],
      location: '',
      postKind: 'text',
      createdAt: baseMs - index * 60000,
      likeCount: 0,
      commentCount: 0,
      likedByUser: false,
      bookmarked: false,
      commentsFlat: [],
      source: 'home',
      generating: false,
      commentsGenerating: false,
      awaitingCommentReply: false
    };
  }

  function fillPostFromRow(post, r) {
    post.text = String(r.text || '').trim() || '今日路过，随便说两句。';
    post.location = String(r.location || '').trim();
    post.postKind = String(r.postKind || 'text');
    mergeEngagementCounts(post, r.suggestedLikes, r.suggestedComments);
    normalizeImageHints(r.imageHints, post.postKind).forEach(function (body) {
      post.images.push({ type: 'text-image', textBody: body });
    });
    return post;
  }

  function findCharacterByName(name) {
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.listCharacters !== 'function') return null;
    var n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    var list = cs.listCharacters('all') || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (String(c.name || '').trim().toLowerCase() === n) return c;
    }
    return null;
  }

  function findCharacterByForumNickname(display, forumState) {
    var nick = String(display || '').trim();
    if (!nick) return null;
    var st = forumState || (global.miyaForumStore ? global.miyaForumStore.getState() : {});
    var nicknames = st.characterForumNicknames || {};
    var cs = global.miyaContactsStore;
    if (!cs || !cs.listCharacters) return null;
    var chars = cs.listCharacters('all') || [];
    var i;
    for (i = 0; i < chars.length; i++) {
      var c = chars[i];
      var fn = getCharacterForumNickname(c.id, st) || getCharacterForumNickname(c.characterId, st);
      if (fn && fn === nick) return c;
    }
    var keys = Object.keys(nicknames);
    for (i = 0; i < keys.length; i++) {
      if (nicknames[keys[i]] === nick) {
        var row = cs.findCharacter ? cs.findCharacter(keys[i]) : null;
        if (row) return row;
      }
    }
    return null;
  }

  function resolveCommentAuthorKind(c, charNames, forumState) {
    var kind = String(c.authorKind || 'npc');
    if (kind === 'user') return 'user';
    var display = String(c.authorDisplay || '').trim();
    var contactId = String(c.authorContactId || '').trim();
    if (kind === 'character') {
      if (!contactId) {
        var byName = findCharacterByName(display);
        if (byName) contactId = String(byName.id || '');
      }
      if (!contactId) {
        var byNick = findCharacterByForumNickname(display, forumState);
        if (byNick) contactId = String(byNick.id || '');
      }
      if (!contactId) return 'invalid';
      return { kind: 'character', contactId: contactId, display: display };
    }
    if (looksLikeCharacterName(display, charNames)) return 'invalid';
    return { kind: 'npc', contactId: '', display: display || '网友' };
  }

  function enforceCommentIdentity(entry, forumState) {
    if (!entry || entry.authorKind !== 'character') return entry;
    var cid = String(entry.authorContactId || '').trim();
    if (!cid) return null;
    var row = findContactCharacter(cid);
    if (!row) return null;
    var st = forumState || (global.miyaForumStore ? global.miyaForumStore.getState() : {});
    entry.authorContactId = cid;
    entry.authorDisplay = getCharacterForumDisplayName(cid, st) || String(row.name || entry.authorDisplay);
    entry.authorAvatar = String(row.avatar || entry.authorAvatar || '');
    return entry;
  }

  function parseReplyLabelAuthor(label) {
    var m = String(label || '').match(/^回复\s*@(.+)$/);
    return m ? m[1].trim() : '';
  }

  function validateReplyTargets(flat, entries) {
    var byId = {};
    (flat || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.replyToId) return;
      var tgt = byId[entry.replyToId];
      if (!tgt) {
        entry.replyToId = null;
        entry.replyToLabel = '';
        return;
      }
      entry.replyToLabel = '回复 @' + tgt.authorDisplay;
    });
  }

  function resolveReplyToIndexTarget(flatAtStart, batchStart, newEntries, replyToIndex) {
    var idx = Math.floor(Number(replyToIndex));
    if (idx < 0) return null;
    if (idx < batchStart && flatAtStart[idx]) return flatAtStart[idx];
    if (idx >= 0 && idx < newEntries.length) return newEntries[idx].entry || newEntries[idx];
    return null;
  }

  function repairCommentReplyTargets(post, forumState) {
    if (!post || !Array.isArray(post.commentsFlat)) return post;
    var flat = post.commentsFlat;
    var byId = {};
    flat.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var changed = false;

    flat.forEach(function (c) {
      if (!c) return;
      var rid = c.replyToId ? String(c.replyToId).trim() : '';
      if (rid && byId[rid] && rid !== c.id) {
        var label = '回复 @' + byId[rid].authorDisplay;
        if (c.replyToLabel !== label) {
          c.replyToLabel = label;
          changed = true;
        }
        return;
      }
      var authorFromLabel = parseReplyLabelAuthor(c.replyToLabel);
      if (authorFromLabel) {
        var candidates = flat.filter(function (x) {
          return x && x.id !== c.id &&
            String(x.authorDisplay || '').trim() === authorFromLabel &&
            (x.createdAt || 0) <= (c.createdAt || 0);
        });
        if (candidates.length === 1) {
          setCommentReplyTarget(c, candidates[0]);
          changed = true;
          return;
        }
      }
      if (rid || c.replyToLabel) {
        c.replyToId = null;
        c.replyToLabel = '';
        changed = true;
      }
    });

    post._replyTargetsRepaired = changed;
    return post;
  }

  function commentMatchesMustReplyAs(c, mustReplyAs) {
    if (!c || !mustReplyAs) return false;
    if (mustReplyAs.authorKind === 'character') {
      return c.authorKind === 'character' &&
        String(c.authorContactId || '') === String(mustReplyAs.authorContactId || '');
    }
    if (mustReplyAs.authorKind === 'npc') {
      return c.authorKind === 'npc' &&
        String(c.authorDisplay || '').trim() === String(mustReplyAs.authorDisplay || '').trim();
    }
    return false;
  }

  function setCommentReplyTarget(entry, target) {
    if (!entry || !target) return;
    entry.replyToId = target.id;
    entry.replyToLabel = '回复 @' + target.authorDisplay;
    entry.createdAt = Math.max(entry.createdAt || 0, (target.createdAt || 0) + 800);
  }

  function enforceMustReplyAsIdentity(entry, mustReplyAs, forumState) {
    if (!entry || !mustReplyAs) return;
    if (mustReplyAs.authorKind === 'character') {
      entry.authorKind = 'character';
      entry.authorContactId = mustReplyAs.authorContactId;
      var st = forumState || (global.miyaForumStore ? global.miyaForumStore.getState() : {});
      entry.authorDisplay = getCharacterForumDisplayName(mustReplyAs.authorContactId, st) ||
        mustReplyAs.authorDisplay;
      enforceCommentIdentity(entry, st);
    } else {
      entry.authorKind = 'npc';
      entry.authorContactId = '';
      entry.authorDisplay = mustReplyAs.authorDisplay;
    }
  }

  function enforceMandatoryRepliesOnNewEntries(post, specs, newEntries, forumState, existingById) {
    if (!specs || !specs.length || !newEntries || !newEntries.length) return;
    var flat = post.commentsFlat || [];
    var byId = Object.assign({}, existingById || {});
    flat.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var usedNew = {};

    specs.forEach(function (spec) {
      var target = byId[spec.replyToId];
      if (!target) return;

      var satisfied = flat.some(function (c) {
        return String(c.replyToId) === String(spec.replyToId) &&
          commentMatchesMustReplyAs(c, spec.mustReplyAs);
      });
      if (satisfied) return;

      var candidate = null;
      var i;
      for (i = 0; i < newEntries.length; i++) {
        var entry = newEntries[i];
        if (usedNew[entry.id]) continue;
        if (commentMatchesMustReplyAs(entry, spec.mustReplyAs)) {
          candidate = entry;
          break;
        }
      }
      if (!candidate) {
        for (i = 0; i < newEntries.length; i++) {
          var e2 = newEntries[i];
          if (usedNew[e2.id]) continue;
          if (String(e2.replyToId) === String(spec.replyToId)) {
            candidate = e2;
            break;
          }
        }
      }
      if (candidate) {
        setCommentReplyTarget(candidate, target);
        enforceMustReplyAsIdentity(candidate, spec.mustReplyAs, forumState);
        usedNew[candidate.id] = true;
      }
    });
  }

  function repairUserCommentReplyTargets(post, forumState) {
    repairCommentReplyTargets(post, forumState);
    if (!post || !Array.isArray(post.commentsFlat)) return post;
    var flat = post.commentsFlat;
    var byId = {};
    flat.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var changed = !!post._replyTargetsRepaired;

    function fixEntry(entry, targetId) {
      var tgt = byId[targetId];
      if (!entry || !tgt) return;
      if (String(entry.replyToId) !== String(targetId)) {
        setCommentReplyTarget(entry, tgt);
        changed = true;
        return;
      }
      var label = '回复 @' + tgt.authorDisplay;
      if (entry.replyToLabel !== label) {
        entry.replyToLabel = label;
        changed = true;
      }
    }

    findUserCommentsNeedingReplyFromRepliedAuthor(post).forEach(function (item) {
      var uc = item.userComment;
      var tc = item.targetComment;
      var correct = flat.find(function (c) {
        return String(c.replyToId) === String(uc.id) && isCommentBySameAuthor(c, tc);
      });
      if (correct) {
        fixEntry(correct, uc.id);
        return;
      }
      var candidates = flat.filter(function (c) {
        if (String(c.replyToId) === String(uc.id)) return false;
        if (!isCommentBySameAuthor(c, tc)) return false;
        return (c.createdAt || 0) >= (uc.createdAt || 0);
      });
      if (candidates.length) {
        candidates.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
        fixEntry(candidates[0], uc.id);
      }
    });

    flat.forEach(function (c) {
      if (!c || !c.replyToId || !byId[c.replyToId]) return;
      var label = '回复 @' + byId[c.replyToId].authorDisplay;
      if (c.replyToLabel !== label) {
        c.replyToLabel = label;
        changed = true;
      }
    });

    post._replyTargetsRepaired = changed;
    return post;
  }

  function sanitizeGeneratedComment(c, post, flat, activeMaskInfo, charNames, forumState) {
    if (!c || typeof c !== 'object') return null;
    if (isForbiddenUserComment({ authorKind: c.authorKind, authorDisplay: c.authorDisplay }, activeMaskInfo)) return null;
    var st = forumState || (global.miyaForumStore ? global.miyaForumStore.getState() : {});
    var resolved = resolveCommentAuthorKind(c, charNames, st);
    if (resolved === 'invalid' || resolved === 'user') return null;

    var cs = global.miyaContactsStore;
    var display = resolved.display;
    var contactId = resolved.contactId;
    var kind = resolved.kind;

    if (post.authorType === 'character' && kind === 'npc') {
      var postAuthorName = String(post.authorDisplay || '').trim();
      if (display === postAuthorName || looksLikeCharacterName(display, [postAuthorName])) return null;
    }

    if (kind === 'character') {
      var row = cs && cs.findCharacter ? cs.findCharacter(contactId) : null;
      if (!row) return null;
      if (post.authorType === 'user' && !isCharacterBoundToUserMask(contactId, activeMaskInfo)) return null;
      display = getCharacterForumDisplayName(contactId, st) || String(row.name || display);
      if (post.authorType === 'character' && String(post.authorContactId) === String(contactId)) {
        kind = 'character';
      }
    }

    var entry = {
      id: 'fcmt_' + post.id + '_' + flat.length,
      authorKind: kind,
      authorContactId: kind === 'character' ? contactId : '',
      authorDisplay: display,
      authorAvatar: '',
      text: String(c.text || '').trim(),
      replyToId: null,
      replyToLabel: '',
      likes: Math.max(0, Math.floor(Number(c.likes) || 0)),
      createdAt: Date.now()
    };
    if (kind === 'character') {
      entry = enforceCommentIdentity(entry, st);
      if (!entry) return null;
    }
    if (!entry.text) return null;
    return entry;
  }

  function processInitialComments(post, rawComments, activeMaskInfo, forumState) {
    var charNames = listAllCharacterNames();
    var arr = Array.isArray(rawComments) ? rawComments : [];
    var flat = post.commentsFlat = post.commentsFlat || [];
    var tsBase = Date.now();
    var batchStart = flat.length;
    var newEntries = [];
    var pendingReplies = [];

    arr.forEach(function (c, i) {
      var entry = sanitizeGeneratedComment(c, post, flat, activeMaskInfo, charNames, forumState);
      if (!entry) return;
      entry.id = 'fcmt_' + post.id + '_' + (batchStart + newEntries.length);
      entry.createdAt = tsBase + i * 2000;
      newEntries.push(entry);
      var replyIdx = c.replyToIndex != null ? c.replyToIndex : null;
      flat.push(entry);
      if (replyIdx != null && replyIdx !== '') {
        pendingReplies.push({ entry: entry, replyIdx: replyIdx, order: i });
      }
    });

    pendingReplies.sort(function (a, b) { return a.order - b.order; });
    pendingReplies.forEach(function (item) {
      var tgt = resolveReplyToIndexTarget(flat.slice(0, batchStart), batchStart, newEntries, item.replyIdx);
      if (!tgt) return;
      item.entry.replyToId = tgt.id;
      item.entry.replyToLabel = '回复 @' + tgt.authorDisplay;
      item.entry.createdAt = Math.max(item.entry.createdAt, (tgt.createdAt || 0) + 800);
    });

    validateReplyTargets(flat, newEntries);
    repairCommentReplyTargets(post, forumState);

    if (flat.length) {
      post.commentCount = Math.max(post.commentCount, flat.length);
    }
    sortCommentsFlat(post);
    return post;
  }

  function processNpcPostRows(arr, npcCount, forumState, activeMaskInfo) {
    var charNames = listAllCharacterNames();
    var baseMs = Date.now();
    var out = [];
    for (var j = 0; j < arr.length && out.length < npcCount; j++) {
      var r = arr[j];
      var post = makePostShell(out.length, baseMs);
      post.authorType = 'npc';
      var display = String(r.authorDisplay || '').trim();
      if (!display || looksLikeCharacterName(display, charNames)) {
        display = randomNpcDisplayName(out.length);
      }
      post.authorDisplay = display;
      fillPostFromRow(post, r);
      processInitialComments(post, r.initialComments, activeMaskInfo, forumState);
      out.push(post);
    }
    while (out.length < npcCount) {
      var ph = makePostShell(out.length, baseMs);
      ph.authorType = 'npc';
      ph.authorDisplay = randomNpcDisplayName(out.length);
      ph.text = '今日路过，随便说两句。';
      ph.likeCount = 12 + Math.floor(Math.random() * 40);
      ph.commentCount = 2 + Math.floor(Math.random() * 8);
      out.push(ph);
    }
    return out.slice(0, npcCount);
  }

  function processCharacterPostRows(arr, pickedChars, charCount, activeMaskInfo, forumState) {
    var allow = {};
    (pickedChars || []).forEach(function (c) {
      allow[String(c.id)] = c;
      allow[String(c.characterId)] = c;
    });
    var usedChar = 0;
    var baseMs = Date.now();
    var out = [];
    for (var j = 0; j < arr.length && out.length < charCount; j++) {
      var r = arr[j];
      var cid = String(r.authorContactId || '').trim();
      var ch = allow[cid];
      if (!ch || usedChar >= charCount) continue;
      var post = makePostShell(out.length, baseMs);
      post.authorType = 'character';
      post.authorContactId = ch.id;
      post.authorDisplay = getCharacterForumDisplayName(ch.id, forumState) || String(ch.name || r.authorDisplay || '角色');
      post.authorAvatar = String(ch.avatar || '');
      fillPostFromRow(post, r);
      processInitialComments(post, r.initialComments, activeMaskInfo, forumState);
      out.push(post);
      usedChar++;
    }
    return out;
  }

  function shufflePosts(posts) {
    var arr = posts.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var k = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[k];
      arr[k] = tmp;
    }
    var baseMs = Date.now();
    arr.forEach(function (p, idx) {
      p.createdAt = baseMs - idx * 60000;
    });
    return arr;
  }

  async function generateHomePosts(forumState, activeMaskInfo) {
    var pool = pickCharactersForFeed(forumState, 3);
    var hasChars = pool.length > 0;
    var out = [];

    if (!hasChars) {
      var soloCount = 8;
      var soloUser = await buildNpcPostGenerationPrompt(forumState, soloCount);
      soloUser += '\n\n每条帖子须含 initialComments（4~8 条），可含楼中楼回复（replyToIndex）。';
      var soloRaw = await callChatCompletionsRaw(
        NPC_POST_SYS,
        soloUser + '\n\n请直接输出包含 ' + soloCount + ' 个帖子（含评论）的 JSON。'
      );
      var soloObj = extractJsonObject(soloRaw) || {};
      var soloArr = Array.isArray(soloObj.posts) ? soloObj.posts : [];
      out = processNpcPostRows(soloArr, soloCount, forumState, activeMaskInfo);
      return shufflePosts(out);
    }

    var npcCount = 4 + Math.floor(Math.random() * 3);
    var charCount = Math.min(pool.length, 1 + Math.floor(Math.random() * 3));
    var picked = pickCharactersForFeed(forumState, charCount);
    if (picked.length < charCount) charCount = picked.length;

    var npcUser = await buildNpcPostGenerationPrompt(forumState, npcCount);
    npcUser += '\n\n每条帖子须含 initialComments（4~8 条），可含楼中楼回复（replyToIndex）。';
    var npcRaw = await callChatCompletionsRaw(
      NPC_POST_SYS,
      npcUser + '\n\n请直接输出包含 ' + npcCount + ' 个路人帖子（含评论）的 JSON。'
    );
    var npcObj = extractJsonObject(npcRaw) || {};
    var npcArr = Array.isArray(npcObj.posts) ? npcObj.posts : [];
    out = out.concat(processNpcPostRows(npcArr, npcCount, forumState, activeMaskInfo));

    if (charCount > 0 && picked.length) {
      var charUser = await buildCharacterPostGenerationPrompt(forumState, picked, charCount, activeMaskInfo);
      charUser += '\n\n每条帖子须含 initialComments（4~8 条），可含楼中楼回复（replyToIndex）。' +
        '角色评论须严格符合角色档案；路人评论不得使用角色真名。';
      var charRaw = await callChatCompletionsRaw(
        CHAR_POST_SYS,
        charUser + '\n\n请直接输出包含 ' + charCount + ' 个角色帖子（含评论）的 JSON。'
      );
      var charObj = extractJsonObject(charRaw) || {};
      var charArr = Array.isArray(charObj.posts) ? charObj.posts : [];
      out = out.concat(processCharacterPostRows(charArr, picked, charCount, activeMaskInfo, forumState));
    }

    return shufflePosts(out);
  }

  async function buildTopicPostGenerationPrompt(forumState, topicTag, npcCount, activeMaskInfo) {
    var tag = String(topicTag || '').trim();
    var ctx = await buildWorldContextOnly(forumState);
    return ctx + '\n\n【专题区】#' + tag + '\n' +
      '生成恰好 ' + npcCount + ' 条与该专题高度相关的社交媒体帖子（authorType 必须为 npc）。\n' +
      '帖子正文、标签、配图描述须紧扣「' + tag + '」主题；tags 数组须包含「' + tag + '」。\n' +
      '【NPC 身份规则】这些网民是上述世界观里真实存在的普通人，各有原创网名；' +
      '发帖内容应像真实社交平台，风格各异。\n' +
      '【严禁】不得使用任何故事角色、人设档案中的名字；不得 authorType=character；' +
      '不得 @ 或提及论坛用户（「我」）。authorDisplay 须为原创网名。';
  }

  async function generateHotSearchTopics(forumState) {
    var ctx = await buildWorldContextOnly(forumState);
    var count = 8 + Math.floor(Math.random() * 8);
    var userPrompt = ctx + '\n\n【热搜榜生成】\n' +
      '生成恰好 ' + count + ' 条当前论坛热搜话题，像真实社交平台热搜榜。\n' +
      '每条须有 tag（话题名，2~12字，不带#）、heat（热度标签如 HOT/RISING/NEW/♡ 等）、discussCount（讨论量描述如「12.4k 讨论 · 今日新增 238」）。\n' +
      '话题须多样：生活、穿搭、旅行、美食、科技、情感、娱乐等，符合上述世界观。';
    var sys = appendSocialSysRule(
      '只输出 JSON：{topics:[{tag,heat,discussCount}]}。topics 数组长度须恰好为要求的条数。'
    );
    var raw = await callChatCompletionsRaw(sys, userPrompt + '\n\n请直接输出 JSON。');
    var obj = extractJsonObject(raw) || {};
    var arr = Array.isArray(obj.topics) ? obj.topics : [];
    var out = [];
    var seen = {};
    arr.forEach(function (t) {
      var tag = String((t && t.tag) || '').trim();
      if (!tag || seen[tag]) return;
      seen[tag] = true;
      out.push({
        tag: tag,
        heat: String((t && t.heat) || 'HOT').trim(),
        discussCount: String((t && t.discussCount) || '').trim() || (Math.floor(Math.random() * 10 + 1) + 'k 讨论')
      });
    });
    while (out.length < 8) {
      var fallbacks = ['生活美学', '穿搭灵感', '旅行日记', '美食探店', '阅读时光', '城市漫步', '居家收纳', '周末计划'];
      var fb = fallbacks[out.length % fallbacks.length];
      if (!seen[fb]) {
        seen[fb] = true;
        out.push({ tag: fb, heat: 'HOT', discussCount: (Math.floor(Math.random() * 8 + 2)) + 'k 讨论' });
      } else break;
    }
    return out.slice(0, 15);
  }

  function applyHotSearchTagsToPosts(posts, hotTopics) {
    var topics = (hotTopics || []).map(function (t) {
      return typeof t === 'string' ? t : (t && t.tag);
    }).filter(Boolean);
    if (!topics.length || !posts || !posts.length) return posts;
    var count = 1 + Math.floor(Math.random() * 2);
    var indices = posts.map(function (_, i) { return i; });
    for (var i = indices.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }
    var picked = indices.slice(0, Math.min(count, posts.length));
    picked.forEach(function (idx) {
      if (Math.random() > 0.3) return;
      var post = posts[idx];
      if (!post) return;
      var tag = topics[Math.floor(Math.random() * topics.length)];
      post.tags = post.tags || [];
      if (post.tags.indexOf(tag) < 0) post.tags.unshift(tag);
    });
    return posts;
  }

  async function buildCollectionPostGenerationPrompt(forumState, collection, npcCount, activeMaskInfo) {
    var name = String(collection && collection.name || '').trim();
    var desc = String(collection && collection.description || '').trim();
    var ctx = await buildWorldContextOnly(forumState);
    return ctx + '\n\n【策展合集 · ' + name + '】\n' +
      (desc ? '合集简介：' + desc + '\n' : '') +
      '生成恰好 ' + npcCount + ' 条与该策展主题高度相关的社交媒体帖子（authorType 必须为 npc）。\n' +
      '帖子正文、标签、配图描述须紧扣「' + name + '」' + (desc ? '及简介「' + desc + '」' : '') + '；tags 数组须包含「' + name + '」。\n' +
      '【NPC 身份规则】这些网民是上述世界观里真实存在的普通人，各有原创网名；发帖内容应像真实社交平台，风格各异。\n' +
      '【严禁】不得使用任何故事角色、人设档案中的名字；不得 authorType=character；' +
      '不得 @ 或提及论坛用户（「我」）。authorDisplay 须为原创网名。';
  }

  async function generateCollectionPosts(collection, forumState, activeMaskInfo) {
    if (!collection || !collection.name) return [];
    var npcCount = 6 + Math.floor(Math.random() * 3);
    var userPrompt = await buildCollectionPostGenerationPrompt(forumState, collection, npcCount, activeMaskInfo);
    userPrompt += '\n\n每条帖子须含 initialComments（4~8 条），可含楼中楼回复（replyToIndex）。';
    var raw = await callChatCompletionsRaw(
      NPC_POST_SYS,
      userPrompt + '\n\n请直接输出包含 ' + npcCount + ' 个策展帖子（含评论）的 JSON。'
    );
    var obj = extractJsonObject(raw) || {};
    var arr = Array.isArray(obj.posts) ? obj.posts : [];
    var posts = processNpcPostRows(arr, npcCount, forumState, activeMaskInfo);
    var collName = String(collection.name || '').trim();
    posts.forEach(function (p) {
      p.source = 'collection';
      p.collectionId = collection.id;
      if (!p.tags || !p.tags.length) p.tags = [collName];
      else if (p.tags.indexOf(collName) < 0) p.tags.unshift(collName);
    });
    return shufflePosts(posts);
  }

  async function generateTopicPosts(topicTag, forumState, activeMaskInfo) {
    var tag = String(topicTag || '').trim();
    if (!tag) return [];
    var npcCount = 6 + Math.floor(Math.random() * 3);
    var userPrompt = await buildTopicPostGenerationPrompt(forumState, tag, npcCount, activeMaskInfo);
    userPrompt += '\n\n每条帖子须含 initialComments（4~8 条），可含楼中楼回复（replyToIndex）。';
    var raw = await callChatCompletionsRaw(
      NPC_POST_SYS,
      userPrompt + '\n\n请直接输出包含 ' + npcCount + ' 个专题帖子（含评论）的 JSON。'
    );
    var obj = extractJsonObject(raw) || {};
    var arr = Array.isArray(obj.posts) ? obj.posts : [];
    var posts = processNpcPostRows(arr, npcCount, forumState, activeMaskInfo);
    posts.forEach(function (p) {
      p.source = 'topic';
      p.topicTag = tag;
      if (!p.tags || !p.tags.length) p.tags = [tag];
      else if (p.tags.indexOf(tag) < 0) p.tags.unshift(tag);
    });
    return shufflePosts(posts);
  }

  async function buildCommentBundleForPosts(posts, forumState, activeMaskInfo) {
    var worldCtx = await buildWorldContextOnly(forumState);
    var parts = [worldCtx];
    var participantIds = [];
    (posts || []).forEach(function (p) {
      if (p.authorType === 'character' && p.authorContactId) participantIds.push(p.authorContactId);
    });
    var postSummaries = [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      var imgDesc = (p.images || []).map(function (im) {
        return im && im.textBody ? im.textBody : '';
      }).filter(Boolean);
      postSummaries.push({
        postIndex: i,
        postId: p.id,
        authorType: p.authorType,
        authorDisplay: p.authorDisplay,
        authorContactId: p.authorContactId || '',
        text: p.text,
        location: p.location,
        imageTextDescriptions: imgDesc
      });
    }
    parts.push('【帖子列表】\n' + JSON.stringify(postSummaries, null, 2));

    var charPostIds = {};
    (posts || []).forEach(function (p) {
      if (p.authorType === 'character' && p.authorContactId) charPostIds[p.authorContactId] = true;
    });
    var charIdsAdded = {};
    for (var j = 0; j < posts.length; j++) {
      var pp = posts[j];
      if (pp.authorType === 'character' && pp.authorContactId && !charIdsAdded[pp.authorContactId]) {
        charIdsAdded[pp.authorContactId] = true;
        parts.push(await buildExpandedCharacterPostCommentContext(pp.authorContactId, activeMaskInfo, forumState));
      }
    }

    parts.push(buildUserMaskContextBlock(activeMaskInfo));

    if (activeMaskInfo && activeMaskInfo.nickname) {
      parts.push(
        '【论坛用户资料（绝对禁止生成此人的评论或回复）】\n' +
        '昵称：' + activeMaskInfo.nickname +
        (activeMaskInfo.persona ? '\n人设：' + truncateStr(activeMaskInfo.persona, 1500) : '') +
        (activeMaskInfo.signature ? '\n签名：' + activeMaskInfo.signature : '') +
        '\n无论帖子正文是否 @ 该用户，initialComments 和评论生成中都严禁出现该用户的任何回复。'
      );
    }

    var rel = getRelationsAmongCharacters(participantIds);
    if (Object.keys(rel).length) {
      parts.push('【角色间关系摘要（仅角色帖评论时可参考）】\n' + JSON.stringify(rel, null, 2));
    }

    parts.push(
      '【评论生成规则】\n' +
      '- 路人帖（authorType=npc）下的评论应由世界观里的普通网民发布，不要引入角色档案私人设定。\n' +
      '- 角色帖下的评论可混合路人与参与角色互动；须严格区分每位评论者身份，不可串人设。\n' +
      '- 若发帖角色与其他角色有人际关系，相关角色可能前来评论，须读取其完整人设并以论坛昵称显示。\n' +
      '- 鼓励楼中楼：部分评论用 replyToIndex 回复同帖前序评论。\n' +
      '- 路人评论严禁使用任何角色真名或冒充发帖角色。\n' +
      '- 角色评论 authorKind 必须为 character，须填 authorContactId，语气严格符合角色档案；authorDisplay 用论坛昵称。\n' +
      '- authorKind 只允许 "npc" 或 "character"，绝对禁止 "user"。\n' +
      '- 绝对禁止生成论坛用户（「我」）的任何评论或回复。\n' +
      (activeMaskInfo && activeMaskInfo.nickname
        ? '- 非用户帖的角色评论可偶尔 @' + activeMaskInfo.nickname + '（不要频繁）。\n'
        : '')
    );
    return parts.join('\n\n---\n\n');
  }

  function isForbiddenUserComment(entry, activeMaskInfo) {
    if (!entry) return true;
    if (entry.authorKind === 'user') return true;
    var nick = activeMaskInfo && activeMaskInfo.nickname ? String(activeMaskInfo.nickname).trim().toLowerCase() : '';
    if (!nick) return false;
    var display = String(entry.authorDisplay || '').trim().toLowerCase();
    return display === nick || display === ('@' + nick);
  }

  var COMMENT_MORE_MIN = 11;
  var COMMENT_MORE_MAX = 18;

  var COMMENT_MORE_SYS = appendSocialSysRule(
    '只输出 JSON：{comments:[{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToId?,replyToIndex?,likes}]}。\n' +
    '一次输出本批全部新评论，数量须达到要求的下限。\n' +
    'authorKind 只允许 npc 或 character；绝对禁止 authorKind 为 user。\n' +
    '【角色身份 · 严禁 OOC 与串号】\n' +
    '- 角色评论必须填 authorContactId，且语气/口癖/立场严格符合该角色档案。\n' +
    '- 多角色同帖时，每位角色说话方式必须明显不同，禁止千篇一律。\n' +
    '- 角色须知道用户帖的发帖人就是论坛用户本人，并结合「与用户的关系」互动。\n' +
    '【楼中楼 replyToId / replyToIndex（二者不可同时填）】\n' +
    '- 回复「已有评论列表」中的某条：必须填 replyToId 为已有评论的 id，禁止填 replyToIndex。\n' +
    '- 回复「本批 comments 数组内」的前序评论：必须填 replyToIndex（从 0 起，指本批 comments 下标），禁止填 replyToId。\n' +
    '- 顶层新评论：replyToId 与 replyToIndex 均省略。\n' +
    '- 凡是对某条评论的直接回应（含必须回复项），必须带 replyToId 或 replyToIndex，不可遗漏。\n' +
    '- 回复内容须紧扣被回复评论的语境，不可答非所问或跑题。\n' +
    '【绝对禁止用户评论】严禁生成论坛用户的任何评论；不得使用论坛用户昵称作为 authorDisplay。\n' +
    '路人评论严禁使用任何角色真名；角色评论必须填 authorContactId 且语气符合角色档案。'
  );

  function buildMandatoryReplySpecs(post) {
    var specs = [];
    if (post && post.authorType !== 'user') {
      findUnrepliedUserComments(post).forEach(function (uc) {
        specs.push({
          replyToId: uc.id,
          targetSummary: { authorDisplay: uc.authorDisplay, text: uc.text },
          mustReplyAs: post.authorType === 'character'
            ? { authorKind: 'character', authorContactId: post.authorContactId, authorDisplay: post.authorDisplay }
            : { authorKind: 'npc', authorDisplay: post.authorDisplay },
          note: '发帖人必须回复该用户评论'
        });
      });
    }
    findUserCommentsNeedingReplyFromRepliedAuthor(post).forEach(function (item) {
      var t = item.targetComment;
      specs.push({
        replyToId: item.userComment.id,
        targetSummary: { authorDisplay: item.userComment.authorDisplay, text: item.userComment.text },
        mustReplyAs: t.authorKind === 'character'
          ? { authorKind: 'character', authorContactId: t.authorContactId, authorDisplay: t.authorDisplay }
          : { authorKind: 'npc', authorDisplay: t.authorDisplay },
        note: '被用户回复的评论作者必须回帖'
      });
    });
    return specs;
  }

  function processMoreComments(post, rawComments, activeMaskInfo, forumState, baseMs, mandatorySpecs) {
    var charNames = listAllCharacterNames();
    var arr = Array.isArray(rawComments) ? rawComments : [];
    var flat = post.commentsFlat = post.commentsFlat || [];
    var existingById = {};
    flat.forEach(function (x) { existingById[x.id] = x; });
    var mandatory = mandatorySpecs || buildMandatoryReplySpecs(post);

    var batchStart = flat.length;
    var flatAtStart = flat.slice();
    var newEntries = [];
    var pendingBatchReplies = [];
    var tsBase = baseMs || Date.now();

    arr.forEach(function (c, batchIdx) {
      var entry = sanitizeGeneratedComment(c, post, flat, activeMaskInfo, charNames, forumState);
      if (!entry) return;
      entry.id = 'fcmt_' + post.id + '_' + (batchStart + newEntries.length);
      entry.createdAt = tsBase + batchIdx * 2000;
      newEntries.push({ entry: entry, raw: c, batchIdx: batchIdx });

      var replyToId = c.replyToId != null ? String(c.replyToId).trim() : '';
      var hasBatchIdx = c.replyToIndex != null && c.replyToIndex !== '';

      if (replyToId && existingById[replyToId]) {
        var tgtExisting = existingById[replyToId];
        entry.replyToId = replyToId;
        entry.replyToLabel = '回复 @' + tgtExisting.authorDisplay;
        entry.createdAt = Math.max(entry.createdAt, (tgtExisting.createdAt || 0) + 800);
      } else if (hasBatchIdx) {
        var idxTarget = resolveReplyToIndexTarget(flatAtStart, batchStart, newEntries, c.replyToIndex);
        if (idxTarget && idxTarget.id) {
          entry.replyToId = idxTarget.id;
          entry.replyToLabel = '回复 @' + idxTarget.authorDisplay;
          entry.createdAt = Math.max(entry.createdAt, (idxTarget.createdAt || 0) + 800);
        } else {
          pendingBatchReplies.push({ entry: entry, replyToIndex: c.replyToIndex, order: batchIdx });
        }
      }
    });

    pendingBatchReplies.sort(function (a, b) { return a.order - b.order; });
    pendingBatchReplies.forEach(function (item) {
      var tgt = resolveReplyToIndexTarget(flatAtStart, batchStart, newEntries, item.replyToIndex);
      if (!tgt || !tgt.id) return;
      item.entry.replyToId = tgt.id;
      item.entry.replyToLabel = '回复 @' + tgt.authorDisplay;
      item.entry.createdAt = Math.max(item.entry.createdAt, (tgt.createdAt || 0) + 800);
    });

    var pushedEntries = newEntries.map(function (x) { return x.entry; });
    newEntries.forEach(function (item) {
      flat.push(item.entry);
      existingById[item.entry.id] = item.entry;
    });
    enforceMandatoryRepliesOnNewEntries(post, mandatory, pushedEntries, forumState, existingById);
    validateReplyTargets(flat, pushedEntries);
    repairCommentReplyTargets(post, forumState);
    repairUserCommentReplyTargets(post, forumState);

    post.commentCount = Math.max(post.commentCount, flat.length);
    sortCommentsFlat(post);
    return post;
  }

  function appendCommentsToPost(post, rawComments, activeMaskInfo, forumState) {
    return processMoreComments(post, rawComments, activeMaskInfo, forumState, Date.now());
  }

  function isCommentByPostAuthor(comment, post) {
    if (!comment || !post) return false;
    if (post.authorType === 'character') {
      return comment.authorKind === 'character' &&
        String(comment.authorContactId) === String(post.authorContactId);
    }
    if (post.authorType === 'npc') {
      return comment.authorKind === 'npc' &&
        String(comment.authorDisplay || '').trim() === String(post.authorDisplay || '').trim();
    }
    return false;
  }

  function isCommentBySameAuthor(comment, authorRef) {
    if (!comment || !authorRef) return false;
    if (authorRef.authorKind === 'character') {
      return comment.authorKind === 'character' &&
        String(comment.authorContactId) === String(authorRef.authorContactId);
    }
    if (authorRef.authorKind === 'npc') {
      return comment.authorKind === 'npc' &&
        String(comment.authorDisplay || '').trim() === String(authorRef.authorDisplay || '').trim();
    }
    if (authorRef.authorKind === 'user') return false;
    return false;
  }

  function findUnrepliedUserComments(post) {
    if (!post || post.authorType === 'user') return [];
    var flat = post.commentsFlat || [];
    var repliedIds = {};
    flat.forEach(function (c) {
      if (c.replyToId && isCommentByPostAuthor(c, post)) {
        repliedIds[String(c.replyToId)] = true;
      }
    });
    return flat.filter(function (c) {
      return c.authorKind === 'user' && !repliedIds[String(c.id)];
    });
  }

  function findUserCommentsNeedingReplyFromRepliedAuthor(post) {
    var flat = post.commentsFlat || [];
    var needs = [];
    flat.forEach(function (userCmt) {
      if (userCmt.authorKind !== 'user' || !userCmt.replyToId) return;
      var target = flat.find(function (c) { return c.id === userCmt.replyToId; });
      if (!target || target.authorKind === 'user') return;
      var replied = flat.some(function (c) {
        return String(c.replyToId) === String(userCmt.id) && isCommentBySameAuthor(c, target);
      });
      if (!replied) needs.push({ userComment: userCmt, targetComment: target });
    });
    return needs;
  }

  function countUserCommentsNeedingReply(post) {
    var postAuthorPending = findUnrepliedUserComments(post).length;
    var repliedAuthorPending = findUserCommentsNeedingReplyFromRepliedAuthor(post).length;
    return postAuthorPending + repliedAuthorPending;
  }

  async function generateRepliedAuthorReplyToUserComment(post, userComment, targetComment, forumState, activeMaskInfo) {
    if (!post || !userComment || !targetComment || !String(userComment.text || '').trim()) return post;
    if (targetComment.authorKind === 'user') return post;

    var worldCtx = await buildWorldContextOnly(forumState);
    var parts = [worldCtx];
    parts.push('【帖子】\n' + JSON.stringify({
      postId: post.id,
      authorType: post.authorType,
      authorDisplay: post.authorDisplay,
      authorContactId: post.authorContactId || '',
      text: post.text
    }, null, 2));

    if (post.authorType === 'character' && post.authorContactId) {
      parts.push(await buildExpandedCharacterPostCommentContext(post.authorContactId, activeMaskInfo, forumState));
    }

    parts.push(buildUserMaskContextBlock(activeMaskInfo));
    parts.push(
      '【用户评论（被回复者必须回复此条）】\n' + JSON.stringify({
        id: userComment.id,
        authorDisplay: userComment.authorDisplay,
        text: userComment.text,
        replyToId: userComment.replyToId || null,
        replyToLabel: userComment.replyToLabel || ''
      }, null, 2)
    );
    parts.push(
      '【用户所回复的原评论（回复者须以此身份作答）】\n' + JSON.stringify({
        id: targetComment.id,
        authorKind: targetComment.authorKind,
        authorContactId: targetComment.authorContactId || '',
        authorDisplay: targetComment.authorDisplay,
        text: targetComment.text
      }, null, 2)
    );

    if (targetComment.authorKind === 'character' && targetComment.authorContactId) {
      parts.push(await buildCharacterContextBlock(targetComment.authorContactId, activeMaskInfo, forumState));
      var userRel = getUserRelationshipWithCharacter(targetComment.authorContactId);
      if (userRel) parts.push('【回复者与用户的关系（须结合此关系回复）】\n' + userRel);
    }

    var existing = (post.commentsFlat || []).map(function (c) {
      return { id: c.id, authorDisplay: c.authorDisplay, authorKind: c.authorKind, text: c.text, replyToId: c.replyToId };
    });
    if (existing.length) parts.push('【已有评论】\n' + JSON.stringify(existing, null, 2));

    var authorRule;
    if (targetComment.authorKind === 'character') {
      authorRule = '回复者是角色，authorKind 必须为 character，authorContactId 必须等于 ' + targetComment.authorContactId +
        '，authorDisplay 用论坛昵称；须结合与用户的关系、用户昵称人设签名回复。';
    } else {
      authorRule = '回复者是路人网民，authorKind 必须为 npc，authorDisplay 必须等于「' + targetComment.authorDisplay + '」。';
    }

    var sys = appendSocialSysRule(
      '只输出 JSON：{reply:{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToId}}。' +
      '生成被用户回复的那位评论者对用户评论的一条回复（楼中楼）。replyToId 必须填用户评论 id：' + userComment.id + '。' +
      authorRule + '语气自然符合身份，禁止生成用户本人的评论。'
    );

    var raw = await callChatCompletionsRaw(sys, parts.join('\n\n---\n\n'));
    var obj = extractJsonObject(raw) || {};
    var rep = obj.reply;
    if (!rep || !String(rep.text || '').trim()) return post;

    var charNames = listAllCharacterNames();
    var flat = post.commentsFlat = post.commentsFlat || [];
    var entry = sanitizeGeneratedComment(rep, post, flat, activeMaskInfo, charNames, forumState);
    if (!entry) return post;

    if (targetComment.authorKind === 'character') {
      entry.authorKind = 'character';
      entry.authorContactId = targetComment.authorContactId;
      entry.authorDisplay = getCharacterForumDisplayName(targetComment.authorContactId, forumState) ||
        targetComment.authorDisplay;
    } else {
      entry.authorKind = 'npc';
      entry.authorContactId = '';
      entry.authorDisplay = targetComment.authorDisplay;
    }
    entry.replyToId = userComment.id;
    entry.replyToLabel = '回复 @' + (userComment.authorDisplay || '用户');
    entry.id = 'fcmt_reply_' + post.id + '_' + Date.now();
    flat.push(entry);
    post.commentCount = Math.max(post.commentCount, flat.length);
    return post;
  }

  async function generateMoreCommentsForPost(post, forumState, activeMaskInfo) {
    var mandatory = buildMandatoryReplySpecs(post);
    var minTotal = Math.max(COMMENT_MORE_MIN, mandatory.length + 5);

    var worldCtx = await buildWorldContextOnly(forumState);
    var parts = [worldCtx];
    await recognizePostRealImages(post, { force: false });
    var mediaBundle = await buildForumPostMediaBundle(post);
    var existing = (post.commentsFlat || []).map(function (c) {
      return {
        id: c.id,
        authorDisplay: c.authorDisplay,
        authorKind: c.authorKind,
        authorContactId: c.authorContactId || '',
        text: c.text,
        replyToId: c.replyToId || null
      };
    });
    parts.push('【帖子】\n' + JSON.stringify({
      postId: post.id,
      authorType: post.authorType,
      authorDisplay: post.authorDisplay,
      authorContactId: post.authorContactId || '',
      text: post.text,
      location: post.location || '',
      imageDescriptions: getPostImageDescriptions(post.images)
    }, null, 2));
    if (mediaBundle.textBlock) parts.push(mediaBundle.textBlock);
    if (mediaBundle.hasRealImages && mediaBundle.attachedRealImages > 0) {
      parts.push(
        '【真实图片 · 必读】上方附件为帖子真实配图。请先观看图片再生成评论，评论须体现对画面内容的理解。'
      );
    }
    parts.push(
      '【已有评论（请先完整阅读；回复已有评论时 replyToId 必须填下列 id）】\n' +
      JSON.stringify(existing, null, 2)
    );

    if (mandatory.length) {
      parts.push(
        '【本批必须生成的回复（须全部出现在 comments 中，每条 replyToId 精确匹配，authorKind/authorContactId/authorDisplay 严格按 mustReplyAs）】\n' +
        JSON.stringify(mandatory, null, 2)
      );
    }

    var userComments = (post.commentsFlat || []).filter(function (c) { return c.authorKind === 'user'; });
    if (userComments.length) {
      parts.push(
        '【用户评论摘要（供理解语境；严禁生成用户本人的评论）】\n' +
        JSON.stringify(userComments.map(function (c) {
          return { id: c.id, authorDisplay: c.authorDisplay, text: c.text, replyToId: c.replyToId };
        }), null, 2)
      );
    }

    if (post.authorType === 'character' && post.authorContactId) {
      parts.push(await buildExpandedCharacterPostCommentContext(post.authorContactId, activeMaskInfo, forumState));
    } else if (post.authorType === 'user') {
      parts.push(await buildUserPostCommentContext(forumState, activeMaskInfo));
    }

    var rosterMore = buildCommentParticipantRoster(post, activeMaskInfo, forumState);
    parts.push('【评论参与者名册（须牢记每位评论者身份，回复时不可串号）】\n' + JSON.stringify(rosterMore, null, 2));

    parts.push(buildUserMaskContextBlock(activeMaskInfo));

    if (activeMaskInfo && activeMaskInfo.nickname) {
      parts.push(
        '【论坛用户资料（绝对禁止生成此人的评论）】\n昵称：' + activeMaskInfo.nickname +
        (activeMaskInfo.persona ? '\n人设：' + truncateStr(activeMaskInfo.persona, 1500) : '') +
        (activeMaskInfo.signature ? '\n签名：' + activeMaskInfo.signature : '') +
        '\n严禁生成该用户的任何评论或回复。'
      );
    }

    parts.push(
      '【评论规则】\n' +
      '- 请先回顾上方全部已有评论、帖子正文与世界观设定再生成。\n' +
      '- 本批共须输出 ' + minTotal + '~' + COMMENT_MORE_MAX + ' 条新评论（至少 ' + minTotal + ' 条）。\n' +
      '- 必须回复项须逐条生成，不可遗漏；其余为路人/角色自由互动评论。\n' +
      '- 路人帖评论用 npc+原创网名；角色帖与用户帖须结合发帖人、用户与各角色关系及角色间关系。\n' +
      '- 角色评论须符合人设，authorDisplay 用论坛昵称勿暴露真名；authorContactId 必须与名册一致。\n' +
      '- 回复已有评论：replyToId 填已有评论 id；回复本批前序评论：replyToIndex 填本批下标。\n' +
      '- 每条回复须紧扣被回复评论的 authorDisplay 与内容，逻辑连贯，禁止认错人或乱序插话。\n' +
      '- 鼓励部分新评论之间形成楼中楼（用 replyToIndex），但顶层评论也须有足够数量。' +
      (activeMaskInfo && activeMaskInfo.nickname && post.authorType !== 'user'
        ? '\n- 非用户帖的角色评论可偶尔 @' + activeMaskInfo.nickname + '（不要频繁）。'
        : '') +
      (post.authorType === 'user'
        ? '\n- 用户帖：角色必须知道发帖人是用户本人，须结合与用户的关系互动，不可 OOC。\n' +
          '- 用户帖：仅已绑定当前论坛用户面具的角色可以 character 身份评论，其余角色只能以 npc 路人身份出场。'
        : '')
    );

    var user = parts.join('\n\n---\n\n') +
      '\n\n请一次输出本批全部 ' + minTotal + '~' + COMMENT_MORE_MAX + ' 条新评论的 JSON（仅调用一次，comments 数组内放全部评论）。';
    var raw = await callChatCompletionsRaw(COMMENT_MORE_SYS, user, mediaBundle.imageParts);
    var obj = extractJsonObject(raw) || {};
    if (Array.isArray(obj.imageDescriptions) && obj.imageDescriptions.length) {
      applyVisionSummariesToPost(post, obj.imageDescriptions);
    }
    var arr = Array.isArray(obj.comments) ? obj.comments : (Array.isArray(obj.results) && obj.results[0] ? obj.results[0].comments : []);
    processMoreComments(post, arr, activeMaskInfo, forumState, Date.now(), mandatory);

    repairUserCommentReplyTargets(post, forumState);
    var needReply = findUserCommentsNeedingReplyFromRepliedAuthor(post);
    for (var ri = 0; ri < needReply.length; ri++) {
      var item = needReply[ri];
      await generateRepliedAuthorReplyToUserComment(
        post, item.userComment, item.targetComment, forumState, activeMaskInfo
      );
    }
    repairUserCommentReplyTargets(post, forumState);

    post.awaitingCommentReply = false;
    return post;
  }

  async function generatePostAuthorReplyToUserComment(post, userComment, forumState, activeMaskInfo) {
    if (!post || !userComment || !String(userComment.text || '').trim()) return post;
    if (post.authorType === 'user') return post;

    var worldCtx = await buildWorldContextOnly(forumState);
    var parts = [worldCtx];
    parts.push('【帖子】\n' + JSON.stringify({
      postId: post.id,
      authorType: post.authorType,
      authorDisplay: post.authorDisplay,
      authorContactId: post.authorContactId || '',
      text: post.text
    }, null, 2));

    if (post.authorType === 'character' && post.authorContactId) {
      parts.push(await buildExpandedCharacterPostCommentContext(post.authorContactId, activeMaskInfo, forumState));
    }

    parts.push(buildUserMaskContextBlock(activeMaskInfo));
    parts.push(
      '【用户新评论（发帖人必须回复此条）】\n' + JSON.stringify({
        id: userComment.id,
        authorDisplay: userComment.authorDisplay,
        text: userComment.text,
        replyToId: userComment.replyToId || null,
        replyToLabel: userComment.replyToLabel || ''
      }, null, 2)
    );

    var existing = (post.commentsFlat || []).map(function (c) {
      return { id: c.id, authorDisplay: c.authorDisplay, authorKind: c.authorKind, text: c.text };
    });
    if (existing.length) parts.push('【已有评论】\n' + JSON.stringify(existing, null, 2));

    var authorRule = post.authorType === 'character'
      ? '发帖人是角色，authorKind 必须为 character，authorContactId 必须等于 ' + post.authorContactId +
        '，authorDisplay 用论坛昵称；须结合与用户的关系、用户昵称人设签名回复。'
      : '发帖人是路人网民，authorKind 必须为 npc，authorDisplay 必须等于「' + post.authorDisplay + '」。';

    var sys = appendSocialSysRule(
      '只输出 JSON：{reply:{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToId}}。' +
      '生成发帖人对用户评论的一条回复（楼中楼）。replyToId 必须填用户评论 id：' + userComment.id + '。' +
      authorRule + '语气自然符合身份，禁止生成用户本人的评论。'
    );

    var raw = await callChatCompletionsRaw(sys, parts.join('\n\n---\n\n'));
    var obj = extractJsonObject(raw) || {};
    var rep = obj.reply;
    if (!rep || !String(rep.text || '').trim()) return post;

    var charNames = listAllCharacterNames();
    var flat = post.commentsFlat = post.commentsFlat || [];
    var entry = sanitizeGeneratedComment(rep, post, flat, activeMaskInfo, charNames, forumState);
    if (!entry) return post;

    if (post.authorType === 'character') {
      entry.authorKind = 'character';
      entry.authorContactId = post.authorContactId;
      entry.authorDisplay = post.authorDisplay;
    } else if (post.authorType === 'npc') {
      entry.authorKind = 'npc';
      entry.authorContactId = '';
      entry.authorDisplay = post.authorDisplay;
    }
    entry.replyToId = userComment.id;
    entry.replyToLabel = '回复 @' + (userComment.authorDisplay || '用户');
    entry.id = 'fcmt_author_' + post.id + '_' + Date.now();
    flat.push(entry);
    post.commentCount = Math.max(post.commentCount, flat.length);
    return post;
  }

  async function generateCharacterForumNicknames(characterIds, forumState) {
    var ids = (characterIds || []).map(String).filter(Boolean);
    if (!ids.length) return {};

    var parts = [await buildWorldContextOnly(forumState)];
    var rows = [];
    ids.forEach(function (id) {
      var row = findContactCharacter(id);
      if (row) rows.push(sanitizeCharacterForPrompt(row));
    });
    if (!rows.length) return {};

    parts.push('【角色档案】\n' + JSON.stringify(rows, null, 2));
    parts.push(
      '【任务】为以上每个角色生成一个论坛网名（符合人设与世界观，有网感，不要用真名）。' +
      '输出 JSON：{nicknames:[{characterId,forumNickname}]}，characterId 填上文 id 字段。'
    );

    var sys = appendSocialSysRule(
      '只输出 JSON：{nicknames:[{characterId,forumNickname}]}。每个角色一条，forumNickname 2~16 字为宜。'
    );
    var raw = await callChatCompletionsRaw(sys, parts.join('\n\n---\n\n'));
    var obj = extractJsonObject(raw) || {};
    var arr = Array.isArray(obj.nicknames) ? obj.nicknames : [];
    var out = {};
    arr.forEach(function (item) {
      var cid = String(item.characterId || item.id || '').trim();
      var nick = String(item.forumNickname || item.nickname || '').trim();
      if (cid && nick) out[cid] = nick;
    });
    return out;
  }

  async function generateCommentsForPosts(posts, forumState, activeMaskInfo) {
    var bundle = await buildCommentBundleForPosts(posts, forumState, activeMaskInfo);
    var user = bundle + '\n\n为以上 ' + posts.length + ' 条帖子分别生成评论，按 postIndex 对应。' +
      '\n输出 JSON：{results:[{postIndex:number,comments:[...]}]}，comments 内可用 replyToId 引用同帖其他新评论的临时下标（用 replyToIndex 从0起）或留空。';
    var batchSys = appendSocialSysRule(
      '只输出 JSON：{results:[{postIndex:number,comments:[{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToIndex?,replyToId?,likes}]}]}。' +
      '为每条帖子生成 6~10 条评论。鼓励楼中楼（replyToIndex 为同帖 comments 数组下标）。' +
      '路人严禁角色真名；角色评论须符合人设。'
    );
    var raw = await callChatCompletionsRaw(batchSys, user);
    var obj = extractJsonObject(raw) || {};
    var results = Array.isArray(obj.results) ? obj.results : [];
    results.forEach(function (block) {
      var idx = Math.floor(Number(block.postIndex));
      if (idx < 0 || idx >= posts.length) return;
      var p = posts[idx];
      var arr = Array.isArray(block.comments) ? block.comments : [];
      processInitialComments(p, arr, activeMaskInfo, forumState);
    });
    return posts;
  }

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function textMentionsUser(text, nickname) {
    var n = String(nickname || '').trim();
    if (!n || !text) return false;
    var re = new RegExp('@' + escapeRegex(n) + '(?:\\s|$|[，。！？,.!?])', 'i');
    return re.test(String(text));
  }

  function postPreviewText(post) {
    if (!post) return '';
    var t = String(post.text || '').trim();
    if (t) return t.slice(0, 60) + (t.length > 60 ? '…' : '');
    var im = (post.images || [])[0];
    if (im && im.textBody) return im.textBody.slice(0, 40);
    return '一条笔记';
  }

  function buildNotificationsFromNewComments(post, prevCommentIds, activeMaskInfo) {
    var out = [];
    if (!post || post.authorType !== 'user') return out;
    var prev = prevCommentIds || {};
    var preview = postPreviewText(post);
    (post.commentsFlat || []).forEach(function (c) {
      if (c.authorKind === 'user' || prev[c.id]) return;
      out.push({
        id: 'fnotif_' + c.id,
        type: 'comment',
        read: false,
        createdAt: c.createdAt || Date.now(),
        postId: post.id,
        commentId: c.id,
        actorDisplay: c.authorDisplay,
        actorContactId: c.authorContactId || '',
        actorKind: c.authorKind === 'character' ? 'character' : 'npc',
        preview: String(c.text || '').slice(0, 120),
        postPreview: preview,
        likeCount: 0
      });
    });
    return out;
  }

  function buildNotificationsFromEngagement(post, prevComments, activeMaskInfo, likeCount) {
    var notifs = buildNotificationsFromNewComments(post, prevComments, activeMaskInfo);
    if (post && post.authorType === 'user' && likeCount > 0) {
      notifs.push({
        id: 'fnotif_like_' + post.id + '_' + Date.now(),
        type: 'like',
        read: false,
        createdAt: Date.now(),
        postId: post.id,
        commentId: '',
        actorDisplay: '',
        actorContactId: '',
        actorKind: 'npc',
        preview: postPreviewText(post),
        postPreview: postPreviewText(post),
        likeCount: likeCount
      });
    }
    return notifs;
  }

  function buildReplyNotifications(post, prevCommentIds, activeMaskInfo) {
    var out = [];
    if (!post || !activeMaskInfo) return out;
    var nick = String(activeMaskInfo.nickname || '').trim();
    var prev = prevCommentIds || {};
    var byId = {};
    (post.commentsFlat || []).forEach(function (c) { byId[c.id] = c; });
    (post.commentsFlat || []).forEach(function (c) {
      if (prev[c.id] || c.authorKind === 'user') return;
      var replyTo = c.replyToId ? byId[c.replyToId] : null;
      if (!replyTo || replyTo.authorKind !== 'user') return;
      out.push({
        id: 'fnotif_reply_' + c.id,
        type: 'reply',
        read: false,
        createdAt: c.createdAt || Date.now(),
        postId: post.id,
        commentId: c.id,
        actorDisplay: c.authorDisplay,
        actorContactId: c.authorContactId || '',
        actorKind: c.authorKind === 'character' ? 'character' : 'npc',
        preview: String(c.text || '').slice(0, 120),
        postPreview: postPreviewText(post),
        likeCount: 0
      });
    });
    return out;
  }

  function buildMentionNotifications(post, prevCommentIds, activeMaskInfo) {
    var out = [];
    if (!post || !activeMaskInfo) return out;
    var nick = String(activeMaskInfo.nickname || '').trim();
    if (!nick) return out;
    var prev = prevCommentIds || {};
    if (post.authorType === 'character' && textMentionsUser(post.text, nick)) {
      out.push({
        id: 'fnotif_mpost_' + post.id,
        type: 'mention_post',
        read: false,
        createdAt: post.createdAt || Date.now(),
        postId: post.id,
        commentId: '',
        actorDisplay: post.authorDisplay,
        actorContactId: post.authorContactId || '',
        actorKind: 'character',
        preview: String(post.text || '').slice(0, 120),
        postPreview: postPreviewText(post),
        likeCount: 0
      });
    }
    if (post.authorType === 'user') return out;
    (post.commentsFlat || []).forEach(function (c) {
      if (prev[c.id] || c.authorKind !== 'character') return;
      if (!textMentionsUser(c.text, nick)) return;
      out.push({
        id: 'fnotif_mcmt_' + c.id,
        type: 'mention_comment',
        read: false,
        createdAt: c.createdAt || Date.now(),
        postId: post.id,
        commentId: c.id,
        actorDisplay: c.authorDisplay,
        actorContactId: c.authorContactId || '',
        actorKind: 'character',
        preview: String(c.text || '').slice(0, 120),
        postPreview: postPreviewText(post),
        likeCount: 0
      });
    });
    return out;
  }

  function snapshotCommentIds(post) {
    var map = {};
    (post && post.commentsFlat || []).forEach(function (c) { map[c.id] = true; });
    return map;
  }

  async function generateInitialCommentsForUserPost(post, forumState, activeMaskInfo) {
    if (!post || post.authorType !== 'user') return { post: post, suggestedLikes: 0 };

    var worldCtx = await buildWorldContextOnly(forumState);
    var parts = [worldCtx];
    await recognizePostRealImages(post, { force: true });
    var mediaBundle = await buildForumPostMediaBundle(post);

    parts.push('【用户发布的帖子（论坛用户本人发帖，需生成评论互动）】\n' + JSON.stringify({
      postId: post.id,
      authorType: 'user',
      authorDisplay: post.authorDisplay,
      text: post.text,
      location: post.location || '',
      tags: post.tags || [],
      imageDescriptions: getPostImageDescriptions(post.images)
    }, null, 2));

    if (mediaBundle.textBlock) parts.push(mediaBundle.textBlock);
    if (mediaBundle.hasRealImages && mediaBundle.attachedRealImages > 0) {
      parts.push(
        '【真实图片 · 必读】上方附件为用户上传的真实配图。' +
        '请先仔细观看每一张图片，理解画面内容后再生成评论；评论须自然体现对图片内容的感知（如场景、物品、氛围等）。' +
        '识图与评论须在同一次输出中完成，不要忽略配图。'
      );
    }

    parts.push(buildUserMaskContextBlock(activeMaskInfo));
    parts.push(await buildUserPostCommentContext(forumState, activeMaskInfo));

    var roster = buildCommentParticipantRoster(post, activeMaskInfo, forumState);
    parts.push('【评论参与者名册（生成前须牢记，严禁串号）】\n' + JSON.stringify(roster, null, 2));

    if (activeMaskInfo && activeMaskInfo.nickname) {
      parts.push(
        '【论坛用户资料（绝对禁止生成此人的评论或回复）】\n' +
        '昵称：' + activeMaskInfo.nickname +
        (activeMaskInfo.persona ? '\n人设：' + truncateStr(activeMaskInfo.persona, 1500) : '') +
        (activeMaskInfo.signature ? '\n签名：' + activeMaskInfo.signature : '') +
        '\n严禁以该用户身份生成任何评论；authorKind 不得为 user；authorDisplay 不得使用该用户昵称。' +
        '\n但其他角色评论时必须知道：发帖人就是这位用户本人。'
      );
    }

    parts.push(
      '【用户帖评论生成规则】\n' +
      '- 这是论坛用户自己发的帖子，路人与角色都可以来评论互动。\n' +
      '- 路人评论 authorKind 必须为 npc，authorDisplay 须为原创网名，严禁冒充角色。\n' +
      '- 角色评论 authorKind 必须为 character，须填 authorContactId（与名册一致），语气严格符合角色档案；authorDisplay 用论坛昵称。\n' +
      '- 仅已绑定当前论坛用户面具的角色可以 character 身份评论；名册外的角色不得以 character 身份出场。\n' +
      '- 须读取每位角色与用户的关系、角色之间的关系后再写评论，不可张冠李戴或认错人。\n' +
      '- 评论按时间顺序生成：先顶层评论，再楼中楼；replyToIndex 仅指向本批 comments 数组中更早的下标。\n' +
      '- 楼中楼回复须明确回应被回复者（看 replyToIndex 对应评论的 authorDisplay 与 text），不可答非所问。\n' +
      '- 鼓励楼中楼：部分评论用 replyToIndex 回复同批前序评论。\n' +
      '- 绝对禁止生成论坛用户（「我」）的任何评论或回复。\n' +
      '- 不要在评论中 @ 用户（用户帖评论区不宜频繁提及用户昵称）。\n' +
      '- 同时给出 suggestedLikes（3~48 的整数，表示预计会有多少人点赞）。' +
      (mediaBundle.hasRealImages && mediaBundle.attachedRealImages > 0
        ? '\n- 帖子配图描述已附在上方【配图信息】，评论须与画面内容一致，勿臆造无关场景。'
        : '')
    );

    var userSys = appendSocialSysRule(
      '只输出 JSON：{suggestedLikes:number,comments:[{authorKind:"npc"|"character",authorContactId?,authorDisplay,text,replyToIndex?,likes}]}。\n' +
      '生成 8~14 条评论，按互动时间顺序排列（顶层在前，回复在后）。鼓励楼中楼（replyToIndex 为同批 comments 下标）。\n' +
      'authorKind 只允许 npc 或 character；绝对禁止 user。\n' +
      '路人严禁角色真名；角色评论须符合人设且填 authorContactId，authorDisplay 用论坛昵称。\n' +
      '多角色时每位角色口癖、立场、与用户的关系表现必须明显区分，严禁 OOC 或串号。'
    );

    var user = parts.join('\n\n---\n\n') + '\n\n请为用户帖子生成评论与 suggestedLikes。';
    var raw = await callChatCompletionsRaw(userSys, user, mediaBundle.imageParts);
    var obj = extractJsonObject(raw) || {};
    var arr = Array.isArray(obj.comments) ? obj.comments : [];
    var suggestedLikes = Math.max(0, Math.floor(Number(obj.suggestedLikes) || 0));
    if (!suggestedLikes) suggestedLikes = 5 + Math.floor(Math.random() * 20);

    processInitialComments(post, arr, activeMaskInfo, forumState);
    post.likeCount = Math.max(post.likeCount, suggestedLikes);
    post.commentCount = Math.max(post.commentCount, (post.commentsFlat || []).length);
    post.commentsGenerating = false;
    return { post: post, suggestedLikes: suggestedLikes };
  }

  function collectAllEngagementNotifications(post, prevIds, activeMaskInfo, suggestedLikes) {
    var notifs = buildNotificationsFromEngagement(post, prevIds, activeMaskInfo, suggestedLikes);
    notifs = notifs.concat(buildReplyNotifications(post, prevIds, activeMaskInfo));
    notifs = notifs.concat(buildMentionNotifications(post, prevIds, activeMaskInfo));
    return notifs;
  }

  global.miyaForumBridge = {
    callChatCompletionsRaw: callChatCompletionsRaw,
    callMainChatCompletionsRaw: callMainChatCompletionsRaw,
    callCstoreCompletionsRaw: callCstoreCompletionsRaw,
    callItineraryCompletionsRaw: callItineraryCompletionsRaw,
    resolveForumApiConfig: resolveForumApiConfig,
    resolveCstoreApiConfig: resolveCstoreApiConfig,
    resolveItineraryApiConfig: resolveItineraryApiConfig,
    extractJsonObject: extractJsonObject,
    buildPromptPrefix: buildPromptPrefix,
    buildCharacterContextBlock: buildCharacterContextBlock,
    generateHomePosts: generateHomePosts,
    generateHotSearchTopics: generateHotSearchTopics,
    applyHotSearchTagsToPosts: applyHotSearchTagsToPosts,
    generateTopicPosts: generateTopicPosts,
    generateCollectionPosts: generateCollectionPosts,
    generateCommentsForPosts: generateCommentsForPosts,
    generateInitialCommentsForUserPost: generateInitialCommentsForUserPost,
    generateMoreCommentsForPost: generateMoreCommentsForPost,
    generatePostAuthorReplyToUserComment: generatePostAuthorReplyToUserComment,
    generateRepliedAuthorReplyToUserComment: generateRepliedAuthorReplyToUserComment,
    generateCharacterForumNicknames: generateCharacterForumNicknames,
    getCharacterForumDisplayName: getCharacterForumDisplayName,
    findUnrepliedUserComments: findUnrepliedUserComments,
    findUserCommentsNeedingReplyFromRepliedAuthor: findUserCommentsNeedingReplyFromRepliedAuthor,
    countUserCommentsNeedingReply: countUserCommentsNeedingReply,
    repairCommentReplyTargets: repairCommentReplyTargets,
    repairUserCommentReplyTargets: repairUserCommentReplyTargets,
    isCommentByPostAuthor: isCommentByPostAuthor,
    pickCharactersForFeed: pickCharactersForFeed,
    pickCharactersForUserPost: pickCharactersForUserPost,
    isCharacterBoundToUserMask: isCharacterBoundToUserMask,
    filterUserPostComments: filterUserPostComments,
    getRelationsAmongCharacters: getRelationsAmongCharacters,
    getPostImageDescriptions: getPostImageDescriptions,
    buildForumPostMediaBundle: buildForumPostMediaBundle,
    recognizePostRealImages: recognizePostRealImages,
    applyVisionSummariesToPost: applyVisionSummariesToPost,
    buildUserPostCommentContext: buildUserPostCommentContext,
    buildCommentParticipantRoster: buildCommentParticipantRoster,
    sortCommentsFlat: sortCommentsFlat,
    textMentionsUser: textMentionsUser,
    snapshotCommentIds: snapshotCommentIds,
    buildNotificationsFromEngagement: buildNotificationsFromEngagement,
    buildReplyNotifications: buildReplyNotifications,
    buildMentionNotifications: buildMentionNotifications,
    collectAllEngagementNotifications: collectAllEngagementNotifications,
    postPreviewText: postPreviewText
  };
})(window);
