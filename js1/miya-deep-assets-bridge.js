/**
 * miya-deep-assets-bridge.js — 深入 · 角色手机 资产 API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var ASSETS_MAX_TOKENS = 32768;

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

  function scoreAssetsObj(obj) {
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
      len('cards', ['bankCards']) * 90 +
      len('txns', ['transactions']) * 70 +
      len('pockets', ['accounts']) * 40 +
      len('holdings', ['collectibles']) * 70 +
      len('vaultBoxes', ['vaults']) * 65 +
      len('cashflow', ['ledger']) * 50 +
      len('portfolio', ['investments']) * 55 +
      len('debts', ['liabilities']) * 45 +
      len('claims', ['ownership']) * 40 +
      len('auctions', ['lots']) * 50 +
      len('dividends', ['yields']) * 35 +
      len('policies', ['insurance']) * 40 +
      len('appraisal', ['quiz']) * 55;
    if (obj.wallet || obj.finance || obj.money) score += 12;
    if (obj.equity || obj.hero) score += 8;
    if (obj.manifesto || obj.openLetter) score += 6;
    if (obj.overview || obj.summary) score += 4;
    if (obj.vaultId || obj.fileNo) score += 2;
    if (obj.sealNote || obj.footerSeal) score += 2;
    return score;
  }

  function unwrapAssetsRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreAssetsObj(obj);
    var keys = ['assets', 'data', 'payload', 'result', 'vault', 'ledger', 'holdingsPack', 'content'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreAssetsObj(inner);
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
        parsed.name || parsed.title || parsed.label || parsed.lot ||
        parsed.q || parsed.text || parsed.content || parsed.note || parsed.thesis
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
          item.name || item.title || item.label || item.lot ||
          item.q || item.text || item.content || item.note || item.thesis
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

  function salvageIntoAssetsObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);
    var specs = [
      ['cards', ['cards', 'bankCards']],
      ['pockets', ['pockets', 'accounts']],
      ['txns', ['txns', 'transactions']],
      ['holdings', ['holdings', 'collectibles']],
      ['vaultBoxes', ['vaultBoxes', 'vaults']],
      ['cashflow', ['cashflow', 'ledger']],
      ['portfolio', ['portfolio', 'investments']],
      ['debts', ['debts', 'liabilities']],
      ['claims', ['claims', 'ownership']],
      ['auctions', ['auctions', 'lots']],
      ['dividends', ['dividends', 'yields']],
      ['policies', ['policies', 'insurance']],
      ['appraisal', ['appraisal', 'quiz']]
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
        var root = unwrapAssetsRoot(parsed);
        var score = scoreAssetsObj(root);
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
        return unwrapAssetsRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapAssetsRoot(sliced) : null;
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；资产私产账本须完全贴合此关系与互动节奏。'
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
    var seed = trim(contact.name) + ' 资产 金钱 银行卡 工资 消费 存款 钱包 转账 礼物 约定 占有 牵挂 亲密 习惯';
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
      '以下为与该角色的近期私聊，生成资产私产时可参考其中的亲密线索、称呼、约定、礼物、情绪与相处细节，但不必逐条复述。',
      lines.join('\n')
    ].join('\n');
  }

  function buildAssetsContext(contactId) {
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
    if (isNetworkFetchError(err)) return new Error('网络中断，资产内容较长容易断连，请再试一次');
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
      } catch (e) { /* ignore partial SSE */ }
    }
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (sseBuf.trim()) consumeSseLine(sseBuf);
          return finalizeStreamText(contentAcc, reasoningAcc);
        }
        sseBuf += decoder.decode(result.value, { stream: true });
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
      temperature: resolved.temperature != null ? resolved.temperature : 0.9,
      timeoutMs: 300000,
      max_tokens: ASSETS_MAX_TOKENS
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
          var net = isNetworkFetchError(err);
          // 仅网络/通道故障重连：同一提示词再拉，绝不因「内容不足」补请求
          if (net && attempt < maxAttempts) {
            var nextStream = useStream && attempt < maxAttempts - 1;
            return new Promise(function (resolve) {
              setTimeout(resolve, 700 * attempt);
            }).then(function () {
              return run(nextStream);
            });
          }
          if (useStream && attempt < maxAttempts) {
            return run(false);
          }
          throw humanizeApiError(err);
        });
    }

    // 默认流式：边生成边推送，避免等完整 JSON 时被中间层掐断
    return run(true);
  }

  function buildSystemPrompt(charName, profileName) {
    return (
      '你是「' + charName + '」私人手机里「资产」App 的策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机里真实的财务资产（余额、银行卡、零钱包、消费流水）以及关于「' + charName + ' ↔ ' + profileName + '」的私密情感私产会写下什么——' +
      '一切从角色「' + charName + '」第一人称视角出发：这是 ta 的手机、ta 的钱包与私账，不是用户的，也不是第三方旁白。' +
      '金额、卡种、银行名、消费场景必须贴合人设身份与世界观（古代/现代/豪门/学生等），禁止用现实银行模板空套；' +
      '若世界观无现代银行卡，也要用该世界等价物写成「卡面」结构（如玉符、票号、账房折子），字段仍用 cards/txns。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：' +
      '{"dateLabel":"7月16日 周四","vaultId":"HV-0716-A1",' +
      '"wallet":{"totalLabel":"总资产","totalAmount":"128,460.00","available":"96,200.00","frozen":"2,000.00","currency":"CNY","monthIn":"+18,200","monthOut":"-6,430","note":"一句资产心绪"},' +
      '"cards":[{"id":"card1","bank":"银行或票号名","kind":"debit|credit|prepaid","last4":"8821","holder":"持卡人名","balance":"86,200.00","limit":"信用额度可空","network":"银联/票号","theme":"obsidian|pearl|slate|smoke|ivory","note":"卡备注"}],' +
      '"pockets":[{"id":"pk1","name":"微信/支付宝/现金/账房","balance":"1,280.50","kind":"wallet","note":"备注"}],' +
      '"txns":[{"id":"t1","time":"昨天 21:16","title":"交易标题","merchant":"商户","direction":"in|out","amount":"128.00","category":"餐饮/转账/礼物…","channel":"尾号8821","note":"40-80字备注"}],' +
      '"equity":{"title":"情感净值短题","netWorth":86,"unit":"心","trend":"+2.4%","trendNote":"波动备注","statusLine":"此刻心绪一句","partnerAlias":"对对方的私称","softPledge":"一句轻承诺"},' +
      '"manifesto":"120-220字开篇私产宣言",' +
      '"overview":"80-140字账本综述",' +
      '"holdings":[{"id":"h1","name":"藏品名","category":"物/声/习惯/瞬间","rarity":"普通|珍藏|孤品","valueLabel":"估值标签","note":"70-140字为何珍视"}],' +
      '"vaultBoxes":[{"id":"v1","label":"保险箱名","grade":"SEALED|PRIVATE|TOP","content":"100-180字上锁内容"}],' +
      '"cashflow":[{"id":"c1","time":"22:14","title":"情绪流水标题","direction":"in|out|hold","amount":"+3心","note":"40-90字"}],' +
      '"portfolio":[{"id":"p1","name":"未来持仓名","thesis":"60-120字","horizon":"今晚/下周/很久以后","risk":"低|中|高"}],' +
      '"debts":[{"id":"d1","title":"感情负债名","owed":"40-90字","side":"me|you|us"}],' +
      '"claims":[{"id":"k1","text":"归属声明一句","intensity":"轻/烫/执拗"}],' +
      '"auctions":[{"id":"a1","lot":"幻想拍品名","bid":"出价","fantasy":"50-100字"}],' +
      '"dividends":[{"id":"y1","title":"今日分红名","yield":"收益标签","note":"30-70字"}],' +
      '"policies":[{"id":"i1","name":"关系保单名","coverage":"承保范围","premium":"保费","clause":"80-140字"}],' +
      '"appraisal":[{"id":"q1","q":"估值题干","a":"答案","hint":"轻提示"}],' +
      '"sealNote":"40-80字封存寄语"}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部字段与条目；禁止偷懒、禁止半截；每条字符串必须写完。' +
      '硬性数量（缺一项都算失败）：' +
      'cards 恰好 3 条；pockets 恰好 3 条；txns 恰好 8 条；' +
      'holdings 恰好 5 条；vaultBoxes 恰好 3 条；cashflow 恰好 6 条；portfolio 恰好 4 条；' +
      'debts 恰好 4 条；claims 恰好 4 条；auctions 恰好 3 条；dividends 恰好 3 条；' +
      'policies 恰好 3 条；appraisal 恰好 3 条；' +
      'wallet/equity/manifesto/overview/vaultId/sealNote 都必须写满；' +
      'wallet.totalAmount 与各卡 balance、pockets 之和在量级上应合理；txns.amount 只写数字与千分位，方向用 direction；' +
      '内容须具体贴合人设、世界书、关系与近期聊天线索；' +
      'cashflow 是情感流水，txns 是真实金钱流水，二者都要；' +
      'debts.side：me=我欠对方，you=对方欠我，us=双方未结清；' +
      '输出前自检各数组长度与 JSON 必须以 } 完整闭合；' +
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
      '【生成任务 · ' + charName + ' 的手机 · 资产 · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人资产 App 的完整数据：',
      '（A）真实财务：总资产 wallet、银行卡 cards、零钱包 pockets、金钱流水 txns；',
      '（B）情感私产：equity 与原有全部互动模块（藏品/保险箱/情绪流水/持仓/负债/声明/拍卖/分红/保单/估值）。',
      '对象是与 ta 绑定关系的「' + profileName + '」。随机种子 ' + seed + '（勿提及）。',
      '【视角铁律】第一人称是「' + charName + '」。手机主人是角色。',
      '【财务要求】',
      '- 金额要像真人手机钱包：有总资产、可用、冻结、本月收支；',
      '- 银行卡要有银行名、尾号、持卡人、余额/额度、卡面 theme；',
      '- 流水要有时间、商户、入账/出账、金额、渠道（某张卡或某钱包）；',
      '- 可自然混入与「' + profileName + '」相关的转账/请客/买礼物，但不要全是恋爱文案。',
      '【情感模块】原有私产模块全部保留写满，语气仍是偷偷记账。',
      '【强制完整 · 写满再结束】',
      '- wallet 写满 · cards×3 · pockets×3 · txns×8',
      '- holdings×5 · vaultBoxes×3 · cashflow×6 · portfolio×4 · debts×4 · claims×4',
      '- auctions×3 · dividends×3 · policies×3 · appraisal×3',
      '- equity/manifesto/overview/vaultId/sealNote 全写满',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；禁止少写；前端禁止截断也禁止因不足重试——你必须自己写满'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      dateLabel: '',
      vaultId: '',
      wallet: {
        totalLabel: '总资产',
        totalAmount: '',
        available: '',
        frozen: '',
        currency: 'CNY',
        monthIn: '',
        monthOut: '',
        note: ''
      },
      cards: [],
      pockets: [],
      txns: [],
      equity: {
        title: '',
        netWorth: 0,
        unit: '心',
        trend: '',
        trendNote: '',
        statusLine: '',
        partnerAlias: '',
        softPledge: ''
      },
      manifesto: '',
      // 不把整段 JSON 塞进封面 overview（会整页糊一坨）；落到可点开的保险箱条目
      overview: '',
      holdings: [],
      vaultBoxes: [{
        id: 'vb-raw',
        name: '原始返回',
        grade: 'RAW',
        content: raw.slice(0, 8000),
        locked: false
      }],
      cashflow: [],
      portfolio: [],
      debts: [],
      claims: [],
      auctions: [],
      dividends: [],
      policies: [],
      appraisal: [],
      sealNote: ''
    };
  }

  function hasAssetsContent(norm) {
    return !!(norm && (
      (norm.wallet && (trim(norm.wallet.totalAmount) || trim(norm.wallet.available))) ||
      (norm.cards && norm.cards.length) ||
      (norm.pockets && norm.pockets.length) ||
      (norm.txns && norm.txns.length) ||
      trim(norm.manifesto) ||
      trim(norm.overview) ||
      (norm.holdings && norm.holdings.length) ||
      (norm.vaultBoxes && norm.vaultBoxes.length) ||
      (norm.cashflow && norm.cashflow.length) ||
      (norm.portfolio && norm.portfolio.length) ||
      (norm.debts && norm.debts.length) ||
      (norm.claims && norm.claims.length) ||
      (norm.auctions && norm.auctions.length) ||
      (norm.dividends && norm.dividends.length) ||
      (norm.policies && norm.policies.length) ||
      (norm.appraisal && norm.appraisal.length) ||
      trim(norm.sealNote) ||
      (norm.equity && (trim(norm.equity.title) || trim(norm.equity.statusLine) || Number(norm.equity.netWorth) > 0))
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    obj = salvageIntoAssetsObj(rawText, obj);
    obj = unwrapAssetsRoot(obj);
    var store = global.miyaDeepAssetsStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeAssetsPayload === 'function') {
        var norm = store.normalizeAssetsPayload(obj);
        if (hasAssetsContent(norm)) return norm;
      }
    }

    // 解析失败：原样展示模型返回内容，绝不因「不足」再请求
    return buildRawFallback(rawText);
  }

  function generateAssets(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildAssetsContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的资产数据' });
    }

    // 单次请求：禁止不足重试 / 补齐第二轮
    return callPhoneApi(
      buildSystemPrompt(charName, profileName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: ASSETS_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepAssetsBridge = {
    buildAssetsContext: buildAssetsContext,
    generateAssets: generateAssets
  };
})(typeof window !== 'undefined' ? window : global);
