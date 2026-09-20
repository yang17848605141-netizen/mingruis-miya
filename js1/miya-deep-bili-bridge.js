/**
 * miya-deep-bili-bridge.js — 深入 · 角色手机 bilibili API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var BILI_MAX_TOKENS = 32768;

  function trim(s) { return String(s || '').trim(); }

  function normalizeApiTextContent(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      return raw.map(function (p) {
        if (!p) return '';
        if (typeof p === 'string') return p;
        return p.text != null ? String(p.text) : (p.content != null ? String(p.content) : '');
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
    if (body.indexOf('{') >= 0) return body;
    var reasoning = extractReasoningText(message);
    if (reasoning && reasoning.indexOf('{') >= 0) return reasoning;
    return body || reasoning;
  }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    var brace = t.indexOf('{');
    if (brace >= 0) {
      t = t.slice(brace);
    } else if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  function sanitizeJsonText(text) {
    var t = String(text || '');
    t = t.replace(/^\uFEFF/, '');
    t = t.replace(/[\u201c\u201d\u201e\u201f]/g, '"');
    t = t.replace(/[\u2018\u2019\u201a\u201b']/g, "'");
    t = t.replace(/,\s*([}\]])/g, '$1');
    return t;
  }

  function repairJsonClosure(text) {
    var t = sanitizeJsonText(String(text || ''));
    var i = t.indexOf('{');
    if (i < 0) return t;
    t = t.slice(i);
    var stack = [];
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < t.length; c++) {
      var ch = t.charAt(c);
      out += ch;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (stack.length) stack.pop();
      }
    }
    if (inStr) out += '"';
    while (stack.length) {
      var open = stack.pop();
      out += open === '{' ? '}' : ']';
    }
    return out;
  }

  function escapeRawNewlinesInJsonStrings(text) {
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < text.length; c++) {
      var ch = text.charAt(c);
      if (inStr) {
        if (esc) {
          out += ch;
          esc = false;
        } else if (ch === '\\') {
          out += ch;
          esc = true;
        } else if (ch === '"') {
          out += ch;
          inStr = false;
        } else if (ch === '\r') {
          if (text.charAt(c + 1) === '\n') c++;
          out += '\\n';
        } else if (ch === '\n') {
          out += '\\n';
        } else {
          out += ch;
        }
      } else {
        if (ch === '"') inStr = true;
        out += ch;
      }
    }
    return out;
  }

  function scoreBiliObj(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return -1;
    function len(k, alts) {
      var a = Array.isArray(obj[k]) ? obj[k].length : 0;
      if (a) return a;
      var i;
      for (i = 0; i < (alts || []).length; i++) {
        if (Array.isArray(obj[alts[i]])) return obj[alts[i]].length;
      }
      return 0;
    }
    var score =
      len('feed', ['videos']) * 100 +
      len('dynamics', ['posts']) * 80 +
      len('watching', ['bangumi']) * 70 +
      len('favorites', ['favs']) * 65 +
      len('history', ['recent']) * 50 +
      len('following', ['follows']) * 55 +
      len('services', ['apps']) * 40;
    if (obj.uname || obj.nickname || obj.name) score += 8;
    if (obj.hero) score += 10;
    if (obj.sign || obj.bio) score += 4;
    if (obj.memberBanner || obj.vipBanner) score += 4;
    if (obj.footerNote || obj.nightThought) score += 2;
    if (obj.creation && Array.isArray(obj.creation.items)) score += obj.creation.items.length * 6;
    return score;
  }

  function unwrapBiliRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreBiliObj(obj);
    var keys = ['bili', 'bilibili', 'data', 'payload', 'result', 'profile', 'content', 'app'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreBiliObj(inner);
      if (s > bestScore) {
        best = inner;
        bestScore = s;
      }
    }
    return best;
  }

  function salvageArrayObjects(text, keys) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned || !keys || !keys.length) return [];
    var keyRe = new RegExp('"(' + keys.join('|') + ')"\\s*:\\s*\\[', 'i');
    var keyMatch = keyRe.exec(cleaned);
    if (!keyMatch) return [];
    var arrStart = cleaned.indexOf('[', keyMatch.index);
    if (arrStart < 0) return [];

    var out = [];
    var seen = Object.create(null);

    function tryPush(slice) {
      if (!slice) return;
      var parsed = null;
      try {
        parsed = JSON.parse(slice);
      } catch (e1) {
        try {
          parsed = JSON.parse(repairJsonClosure(escapeRawNewlinesInJsonStrings(slice)));
        } catch (e2) { /* skip */ }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      var id = trim(parsed.id);
      var title = trim(
        parsed.name || parsed.title || parsed.label ||
        parsed.content || parsed.text || parsed.body || parsed.uname
      );
      var key = id || (title ? ('t:' + title.slice(0, 48)) : '');
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(parsed);
    }

    var depth = 0;
    var objStart = -1;
    var inStr = false;
    var esc = false;
    var i;
    for (i = arrStart + 1; i < cleaned.length; i++) {
      var ch = cleaned.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') {
        if (depth === 0) objStart = i;
        depth++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          tryPush(cleaned.slice(objStart, i + 1));
          objStart = -1;
        }
        continue;
      }
      if (ch === ']' && depth === 0) break;
    }
    return out;
  }

  function mergeArrayLists(primary, salvaged) {
    var out = [];
    var seen = Object.create(null);
    function take(list) {
      (list || []).forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var id = trim(item.id);
        var title = trim(
          item.name || item.title || item.label ||
          item.content || item.text || item.body || item.uname
        );
        var key = id || (title ? ('t:' + title.slice(0, 48)) : '');
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(item);
      });
    }
    take(primary);
    take(salvaged);
    return out;
  }

  function salvageIntoBiliObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);
    var specs = [
      ['feed', ['feed', 'videos']],
      ['dynamics', ['dynamics', 'posts']],
      ['watching', ['watching', 'bangumi']],
      ['favorites', ['favorites', 'favs']],
      ['history', ['history', 'recent']],
      ['following', ['following', 'follows']],
      ['services', ['services', 'apps']]
    ];
    var i;
    for (i = 0; i < specs.length; i++) {
      var canon = specs[i][0];
      var alts = specs[i][1];
      var salvaged = salvageArrayObjects(rawText, alts);
      if (!salvaged.length) continue;
      var existing = Array.isArray(next[canon]) ? next[canon] : [];
      var j;
      for (j = 0; j < alts.length; j++) {
        if (alts[j] !== canon && Array.isArray(next[alts[j]]) && next[alts[j]].length) {
          existing = existing.concat(next[alts[j]]);
        }
      }
      next[canon] = mergeArrayLists(existing, salvaged);
    }
    return next;
  }

  function tryParseJsonSlice(text) {
    var t = sanitizeJsonText(text);
    if (!t) return null;
    var i = t.indexOf('{');
    if (i < 0) return null;
    var j = t.lastIndexOf('}');
    var candidates = [];
    if (j > i) candidates.push(t.slice(i, j + 1));
    candidates.push(repairJsonClosure(t.slice(i)));
    candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i))));
    if (j > i) {
      candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, j + 1))));
      var bracePositions = [];
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) === '}') bracePositions.push(c);
      }
      var maxBraceTries = 8;
      for (c = 0; c < bracePositions.length && c < maxBraceTries; c++) {
        var pos = bracePositions[c];
        candidates.push(t.slice(i, pos + 1));
        candidates.push(repairJsonClosure(t.slice(i, pos + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, pos + 1))));
      }
    }
    var seen = {};
    var best = null;
    var bestScore = -1;
    var n;
    for (n = 0; n < candidates.length; n++) {
      var slice = candidates[n];
      if (!slice || seen[slice]) continue;
      seen[slice] = true;
      try {
        var parsed = JSON.parse(slice);
        var root = unwrapBiliRoot(parsed);
        var score = scoreBiliObj(root);
        if (score > bestScore) {
          bestScore = score;
          best = root;
        }
      } catch (e) { /* try next */ }
    }
    return best;
  }

  function tryParseJson(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned) return null;
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
      var direct = JSON.parse(cleaned);
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
        return unwrapBiliRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapBiliRoot(sliced) : null;
  }

  function resolveContactContext(contact) {
    var diaryBr = global.miyaDiaryBridge;
    if (diaryBr && typeof diaryBr.resolveContactContext === 'function') {
      return diaryBr.resolveContactContext(contact);
    }
    return { contact: contact, profile: null, chat: null, settings: {} };
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + trim(contact && contact.name || '未知'));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = trim(cts.renderChronicleBlock(roleId));
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + trim(contact.persona));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·参考】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；bilibili 里的追番、收藏备注、动态、搜索记录必须完全贴合此关系与互动节奏。'
    ];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? trim(eng.renderProfileBlock(profile))
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + trim(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + trim(settings.relationship));
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + trim(contact.remarkName));
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = trim(contact.name) + ' bilibili B站 视频 追番 弹幕 收藏 动态 直播 追剧 二次元 游戏 音乐 UP主 深夜刷手机';
    var bundle = eng.buildWorldbookBundle(contact, seed, null, {
      includeAllBoundLocal: true,
      promptContext: 'general'
    });
    if (!bundle) return '';
    var text = '';
    if (typeof eng.joinWorldbookBundleText === 'function') {
      text = eng.joinWorldbookBundleText(bundle);
    } else {
      var parts = [];
      [].concat(bundle.frontLayers || [], bundle.layers || [], bundle.backLayers || []).forEach(function (layer) {
        if (layer) parts.push(layer);
      });
      text = parts.join('\n\n').trim();
    }
    return text ? '【世界书·必读】\n' + text : '';
  }

  function buildChatContextBlock(contact, profile, chat) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var profileName = trim(profile && profile.name || '用户');
    var charName = trim(contact && contact.name || '角色');
    var msgs = cs.getMessages(chat.id) || [];
    var lines = msgs
      .filter(function (m) {
        return m && !m.deleted && trim(m.content);
      })
      .slice(-50)
      .map(function (m) {
        var body = trim(m.content);
        if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
          body = global.miyaChatEngine.stripThinkingForApi(body);
        }
        body = trim(body);
        if (!body) return '';
        var who = m.role === 'user' ? profileName : charName;
        return who + '：' + body;
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return [
      '【近期聊天记录（最近 ' + lines.length + ' 条）】',
      '以下为与该角色的近期私聊。生成 bilibili 数据时必须从中抽取具体称呼、约定、兴趣、情绪与未说出口的事，写成 ta 会刷的视频、收藏备注、动态草稿、追番进度；禁止空泛抒情，禁止复述成聊天记录列表。',
      lines.join('\n')
    ].join('\n');
  }

  function buildBiliContext(contactId) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var contact = cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
    if (!contact) return null;

    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var profile = ctx.profile;
    var settings = ctx.settings || {};
    var chat = ctx.chat;
    var aw = global.MiyaChatAwareness;

    var parts = [
      '【当前时间】' + new Date().toLocaleString('zh-CN', { hour12: false }),
      buildCharacterBlock(contact),
      buildUserRelationBlock(contact, profile, settings)
    ];

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact);
    if (wb) parts.push(wb);

    var chatBlock = buildChatContextBlock(contact, profile, chat);
    if (chatBlock) parts.push(chatBlock);

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      chat: chat,
      contextText: parts.filter(Boolean).join('\n\n')
    };
  }

  function extractApiText(j) {
    var eng = global.miyaChatEngine;
    var msg = j && j.choices && j.choices[0] && j.choices[0].message;
    var text = '';
    if (eng && typeof eng.extractReplyContent === 'function') {
      text = eng.extractReplyContent(j);
    } else if (msg) {
      text = normalizeApiTextContent(msg.content);
    }
    text = pickJsonLikeApiText(text, msg);
    if (text.indexOf('{') < 0 && msg) {
      var reasoning = extractReasoningText(msg);
      if (reasoning && reasoning.indexOf('{') >= 0) text = reasoning;
    }
    if (eng && typeof eng.stripThinkingForApi === 'function' && text.indexOf('{') < 0) {
      text = eng.stripThinkingForApi(text);
    }
    return String(text || '').trim();
  }

  function isNetworkFetchError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    var msg = String(err.message || err || '').toLowerCase();
    return msg === 'failed to fetch' ||
      msg.indexOf('load failed') >= 0 ||
      msg.indexOf('networkerror') >= 0 ||
      msg.indexOf('network request failed') >= 0 ||
      msg.indexOf('请求超时') >= 0 ||
      msg.indexOf('the network connection was lost') >= 0;
  }

  function humanizeApiError(err) {
    if (!err) return new Error('读取失败');
    if (err.name === 'AbortError') return new Error('请求超时，请稍后重试');
    var msg = String(err.message || err || '').trim();
    if (isNetworkFetchError(err)) return new Error('网络中断，bilibili 数据较长容易断连，请再试一次');
    return err instanceof Error ? err : new Error(msg || '读取失败');
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

  function fetchWithConnectTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0 || typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    var controller = new AbortController();
    var opts = Object.assign({}, options, { signal: controller.signal });
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    });
  }

  function finalizeStreamText(contentAcc, reasoningAcc) {
    var text = pickJsonLikeApiText(contentAcc, {
      content: contentAcc,
      reasoning_content: reasoningAcc
    });
    if (text.indexOf('{') < 0 && reasoningAcc && String(reasoningAcc).indexOf('{') >= 0) {
      text = String(reasoningAcc);
    }
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.stripThinkingForApi === 'function' && String(text || '').indexOf('{') < 0) {
      text = eng.stripThinkingForApi(text);
    }
    text = String(text || '').trim();
    if (!text) throw new Error('API 返回为空');
    return text;
  }

  function readCompletionsStream(res) {
    if (!res.body || !res.body.getReader) {
      return res.json().then(function (j) {
        var text = extractApiText(j);
        if (!text) throw new Error('API 返回为空');
        return text;
      });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var sseBuf = '';
    var rawAcc = '';
    var contentAcc = '';
    var reasoningAcc = '';
    function consumeSseLine(line) {
      var trimmed = String(line || '').trim();
      if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return;
      if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
      if (!trimmed || trimmed === '[DONE]') return;
      try {
        var obj = JSON.parse(trimmed);
        var delta = extractStreamDelta(obj);
        if (delta.content) contentAcc += delta.content;
        if (delta.reasoning) reasoningAcc += delta.reasoning;
        if (!delta.content && !delta.reasoning && obj.choices) {
          var whole = extractApiText(obj);
          if (whole) contentAcc += whole;
        }
      } catch (e) { /* ignore partial SSE */ }
    }
    function finish() {
      if (sseBuf.trim()) consumeSseLine(sseBuf);
      if (contentAcc || reasoningAcc) return finalizeStreamText(contentAcc, reasoningAcc);
      var raw = String(rawAcc || '').trim();
      if (raw.charAt(0) === '{') {
        try {
          var j = JSON.parse(raw);
          var text = extractApiText(j);
          if (text) return text;
        } catch (e2) { /* fall through */ }
      }
      return finalizeStreamText(contentAcc, reasoningAcc);
    }
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return finish();
        var chunk = decoder.decode(result.value, { stream: true });
        rawAcc += chunk;
        sseBuf += chunk;
        var parts = sseBuf.split('\n');
        sseBuf = parts.pop() || '';
        parts.forEach(consumeSseLine);
        return pump();
      });
    }
    return pump();
  }

  function callPhoneApiOnce(systemHint, userContent, phoneData, reqOpts, useStream) {
    var deepStore = global.miyaDeepStore;
    if (!deepStore) return Promise.reject(new Error('API 模块未加载'));
    var resolved = deepStore.resolvePhoneApiConfig(phoneData || {});
    var base = resolved.normalizedBaseUrl;
    var model = trim(resolved.model);
    var key = trim(resolved.apiKey);
    if (!base || !model || !key) {
      return Promise.reject(new Error('请先在角色手机设置或全局设置中配置 API'));
    }
    reqOpts = Object.assign({
      temperature: resolved.temperature != null ? resolved.temperature : 0.88,
      timeoutMs: 300000,
      max_tokens: BILI_MAX_TOKENS
    }, reqOpts || {});

    var payload = {
      model: model,
      temperature: reqOpts.temperature,
      max_tokens: reqOpts.max_tokens,
      messages: [
        { role: 'system', content: String(systemHint || '') },
        { role: 'user', content: String(userContent || '') }
      ]
    };
    if (useStream) payload.stream = true;

    var timeoutMs = Number(reqOpts.timeoutMs) || 300000;
    return fetchWithConnectTimeout(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(payload)
    }, timeoutMs).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      if (useStream) return readCompletionsStream(r);
      return r.json().then(function (j) {
        var text = extractApiText(j);
        if (!text) throw new Error('API 返回为空');
        return text;
      });
    });
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
    var maxAttempts = 3;
    var attempt = 0;

    function run(useStream) {
      attempt += 1;
      return callPhoneApiOnce(systemHint, userContent, phoneData, reqOpts, useStream)
        .catch(function (err) {
          // 流式失败立刻改非流式（很多网关不支持 / 会直接 Failed to fetch）
          if (useStream) {
            attempt = 0;
            return new Promise(function (resolve) {
              setTimeout(resolve, 180);
            }).then(function () {
              return run(false);
            });
          }
          // 非流式：仅网络/通道故障重连，绝不因「内容不足」补请求
          if (isNetworkFetchError(err) && attempt < maxAttempts) {
            return new Promise(function (resolve) {
              setTimeout(resolve, 700 * attempt);
            }).then(function () {
              return run(false);
            });
          }
          throw humanizeApiError(err);
        });
    }

    // 默认非流式：兼容性最好；长连接仍可由网络重试兜底
    return run(false);
  }

  function buildSystemPrompt(charName, profileName) {
    return (
      '你是「' + charName + '」私人手机里「bilibili」App 的档案员。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机 bilibili 里真实会有什么——一切从角色「' + charName + '」第一人称视角：这是 ta 的账号、ta 的推荐流、ta 的追番与收藏，不是用户的，也不是旁白。' +
      '文案必须具体、像真人会刷的内容：视频标题、UP 名、弹幕感、收藏夹备注、动态草稿、追番进度旁的悄悄话。' +
      '禁止鸡汤、禁止花里胡哨文案、禁止空泛形容词堆砌；用具体题材、时间、称呼、动作、物件、对话碎片。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：' +
      '{"uname":"昵称","sign":"个性签名一句","level":4,"vipLabel":"正式会员或空",' +
      '"coins":"897","bCoins":"0",' +
      '"stats":{"dynamics":"3","following":"65","followers":"3"},' +
      '"searchHint":"搜索框里最近想搜的词",' +
      '"tabs":["直播","推荐","热门","动画","影视"],"activeTab":"推荐",' +
      '"hero":{"title":"置顶大卡标题","coverTone":"rose|ink|mist|sand|sky|plum|tea|night","views":"128.4万","duration":"12:08","upName":"UP名","desc":"60-140字为什么刷到这个"},' +
      '"promo":{"title":"横条推荐文案","cta":"去看看","body":"40-100字点开后说明"},' +
      '"feed":[{"id":"fd1","title":"视频标题","upName":"UP","views":"3.2万","comments":"428","duration":"08:41","kind":"video|article|live|bangumi","coverTone":"mist","tag":"标签","preview":"一行摘要","body":"80-160字视频简介","note":"60-140字角色私密批注（看完心里话，不是公开评论）","coins":"1.2万","date":"2026年7月2日","upFans":"12.4万","upVideos":"86","bgm":"BGM名可空","series":"合集名可空"}],' +
      '"dynamics":[{"id":"dy1","type":"text|video|forward|checkin","text":"动态正文","time":"2小时前","likes":"12","replies":"3","detail":"80-180字展开"}],' +
      '"watching":[{"id":"wt1","title":"番名/剧名","progress":"看到第7集","episode":"EP07","coverTone":"plum","note":"60-140字追番私念"}],' +
      '"favorites":[{"id":"fv1","title":"收藏项","folder":"收藏夹名","note":"一句备注","body":"80-180字为什么收藏"}],' +
      '"history":[{"id":"hs1","title":"看过的标题","watchedAt":"昨天 01:22","progress":"看到 63%","coverTone":"tea"}],' +
      '"following":[{"id":"fl1","name":"UP名","reason":"60-120字关注理由","lastUpdate":"更新于昨天","coverTone":"sky"}],' +
      '"services":[{"id":"sv1","name":"我的课程|游戏中心|漫画|我的钱包等","hint":"一行副标","body":"40-120字点开说明"}],' +
      '"creation":{"drafts":"2","incentive":"创作激励短句","note":"创作中心旁白","items":[{"id":"cr1","name":"创作入口名","badge":"","body":"40-100字"}]},' +
      '"memberBanner":{"text":"会员横幅短句","cta":"大会员中心","body":"40-100字"},' +
      '"nightThought":"30-70字深夜刷完的一句","footerNote":"30-60字封底寄语"}。' +
      '【完整输出·最高优先级】必须一次尽量写满；每条字符串写完整句子；JSON 必须以 } 闭合。' +
      '硬性数量目标（请尽力写满，前端不会因不足重试）：' +
      'feed 恰好 8 条；dynamics 恰好 5 条；watching 恰好 4 条；favorites 恰好 5 条；' +
      'history 恰好 5 条；following 恰好 5 条；services 恰好 8 条；creation.items 恰好 4 条；' +
      'uname/sign/hero/promo/memberBanner/nightThought/footerNote 都写；stats 三项都写。' +
      '至少 2 条 feed/favorites/dynamics 的内容与「' + profileName + '」有关（暗线即可，不要直白剧透系统）；' +
      '封面色 coverTone 在给定枚举里轮换；视频标题要像真 B 站标题，不要文艺口号。' +
      '世界观无现代互联网时，仍用同一 JSON 字段，把播放量/硬币写成该世界等价物（传书票、星网点赞等）。' +
      '禁止提及 AI、系统、提示词、JSON、生成、模型等幕后词。'
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·必读】',
      ctx.contextText,
      '',
      '【生成任务 · ' + charName + ' 的手机 · bilibili · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人 bilibili 的完整数据。',
      '对象关系绑定「' + profileName + '」。随机种子 ' + seed + '（勿提及）。',
      '【视角铁律】第一人称是「' + charName + '」。手机主人是角色。用户只是 ta 动态/收藏/深夜推荐里反复出现的那个人。',
      '【内容要求】',
      '- 昵称、签名、搜索词要像真人账号，贴合人设，不要口号。',
      '- feed.body 是公开简介；feed.note 必须是角色第一人称批注（偷偷记的），具体、贴合人设与聊天线索。',
      '- feed.body / dynamics.detail / favorites.body / watching.note 必须具体：有题材、时间、称呼、物件。',
      '- 从近期聊天抽取真实线索写进推荐与收藏备注，但不要整段复述聊天。',
      '- 语气像自己刷完手机抬手关屏，不是写小作文给读者看。',
      '【强制完整 · 写满再结束】',
      '- feed×8 · dynamics×5 · watching×4 · favorites×5 · history×5 · following×5 · services×8 · creation.items×4',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；',
      '- 前端禁止截断展示，也禁止因字段不足而重试——你返回多少就展示多少，所以请自己一次写满。'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      uname: '原始返回',
      sign: '',
      level: 0,
      vipLabel: '',
      coins: '',
      bCoins: '',
      stats: { dynamics: '', following: '', followers: '' },
      searchHint: '',
      tabs: ['推荐'],
      activeTab: '推荐',
      hero: null,
      promo: null,
      feed: [{
        id: 'fd-raw',
        title: '未解析原文',
        upName: '',
        views: '',
        comments: '',
        duration: '',
        kind: 'article',
        coverTone: 'ink',
        tag: 'RAW',
        preview: '点开查看原始返回',
        body: raw.slice(0, 8000),
        opened: false,
        liked: false
      }],
      dynamics: [],
      watching: [],
      favorites: [],
      history: [],
      following: [],
      services: [],
      creation: { drafts: '', incentive: '', note: '', items: [] },
      memberBanner: null,
      nightThought: '',
      footerNote: ''
    };
  }

  function hasBiliContent(norm) {
    return !!(norm && (
      (norm.feed && norm.feed.length) ||
      (norm.dynamics && norm.dynamics.length) ||
      (norm.watching && norm.watching.length) ||
      (norm.favorites && norm.favorites.length) ||
      (norm.history && norm.history.length) ||
      (norm.following && norm.following.length) ||
      (norm.services && norm.services.length) ||
      trim(norm.uname) ||
      trim(norm.sign) ||
      (norm.hero && trim(norm.hero.title)) ||
      trim(norm.footerNote) ||
      trim(norm.nightThought)
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    obj = salvageIntoBiliObj(rawText, obj);
    obj = unwrapBiliRoot(obj);
    var store = global.miyaDeepBiliStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeBiliPayload === 'function') {
        var norm = store.normalizeBiliPayload(obj);
        if (hasBiliContent(norm)) return norm;
      }
    }

    // 解析失败：原样展示模型返回内容，绝不因「不足」再请求
    return buildRawFallback(rawText);
  }

  function generateBili(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildBiliContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的bilibili数据' });
    }

    // 单次请求：禁止不足重试 / 补齐第二轮
    return callPhoneApi(
      buildSystemPrompt(charName, profileName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.88, max_tokens: BILI_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepBiliBridge = {
    buildBiliContext: buildBiliContext,
    generateBili: generateBili
  };
})(typeof window !== 'undefined' ? window : global);
