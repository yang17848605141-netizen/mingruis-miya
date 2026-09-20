/**
 * miya-deep-douyin-bridge.js — 深入 · 角色手机 抖音 API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var DOUYIN_MAX_TOKENS = 32768;

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

  function scoreDouyinObj(obj) {
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
      len('followingFeed', ['followFeed']) * 70 +
      len('friends', ['friendFeed']) * 55 +
      len('stories', ['status']) * 40;
    if (obj.messages && typeof obj.messages === 'object') {
      if (Array.isArray(obj.messages.chats)) score += obj.messages.chats.length * 60;
      if (Array.isArray(obj.messages.notices)) score += obj.messages.notices.length * 35;
    }
    if (obj.profile && typeof obj.profile === 'object') {
      if (Array.isArray(obj.profile.works)) score += obj.profile.works.length * 55;
      if (Array.isArray(obj.profile.liked)) score += obj.profile.liked.length * 30;
      if (Array.isArray(obj.profile.favorites)) score += obj.profile.favorites.length * 30;
      if (Array.isArray(obj.profile.daily)) score += obj.profile.daily.length * 25;
    }
    if (obj.nickname || obj.uname || obj.name) score += 8;
    if (obj.bio || obj.sign) score += 4;
    if (obj.stats) score += 6;
    if (obj.footerNote || obj.nightThought) score += 2;
    return score;
  }

  function unwrapDouyinRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreDouyinObj(obj);
    var keys = ['douyin', 'tiktok', 'dy', 'data', 'payload', 'result', 'content', 'app'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreDouyinObj(inner);
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
        parsed.name || parsed.title || parsed.caption || parsed.label ||
        parsed.content || parsed.text || parsed.body || parsed.author
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
          item.name || item.title || item.caption || item.label ||
          item.content || item.text || item.body || item.author
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

  function salvageIntoDouyinObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);
    var specs = [
      ['feed', ['feed', 'videos']],
      ['followingFeed', ['followingFeed', 'followFeed']],
      ['friends', ['friends', 'friendFeed']],
      ['stories', ['stories', 'status']]
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

    if (!next.messages || typeof next.messages !== 'object') next.messages = {};
    var chatSal = salvageArrayObjects(rawText, ['chats', 'conversations']);
    if (chatSal.length) {
      next.messages.chats = mergeArrayLists(
        Array.isArray(next.messages.chats) ? next.messages.chats : [],
        chatSal
      );
    }
    var noticeSal = salvageArrayObjects(rawText, ['notices', 'items']);
    if (noticeSal.length) {
      next.messages.notices = mergeArrayLists(
        Array.isArray(next.messages.notices) ? next.messages.notices : [],
        noticeSal
      );
    }

    if (!next.profile || typeof next.profile !== 'object') next.profile = {};
    var workSal = salvageArrayObjects(rawText, ['works', 'meVideos']);
    if (workSal.length) {
      next.profile.works = mergeArrayLists(
        Array.isArray(next.profile.works) ? next.profile.works : [],
        workSal
      );
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
        var root = unwrapDouyinRoot(parsed);
        var score = scoreDouyinObj(root);
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
        return unwrapDouyinRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapDouyinRoot(sliced) : null;
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；抖音里的视频文案、评论、私信、收藏备注必须完全贴合此关系与互动节奏。'
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
    var seed = trim(contact.name) + ' 抖音 短视频 推荐 关注 同城 私信 互动 日常 音乐 字幕 收藏 朋友 主页';
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
      '以下为与该角色的近期私聊。生成抖音数据时必须从中抽取具体称呼、约定、兴趣、情绪与未说出口的事，写成 ta 会刷/会发的短视频、评论、私信预览、收藏理由；禁止空泛抒情，禁止复述成聊天记录列表。',
      lines.join('\n')
    ].join('\n');
  }

  function buildDouyinContext(contactId) {
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
      msg.indexOf('the network connection was lost') >= 0 ||
      msg.indexOf('network connection was lost') >= 0 ||
      msg.indexOf('connection reset') >= 0;
  }

  function humanizeApiError(err) {
    if (!err) return new Error('读取失败');
    if (err.name === 'AbortError') return new Error('请求超时，请稍后重试');
    var msg = String(err.message || err || '').trim();
    if (isNetworkFetchError(err)) return new Error('网络中断，抖音数据较长容易断连，请再试一次');
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

  /** 全链路超时：连接 + 读完正文都算，避免只等 header */
  function fetchWithFullTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0 || typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    var controller = new AbortController();
    var opts = Object.assign({}, options, { signal: controller.signal });
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, opts).then(function (res) {
      // 不在 header 到达时清 timer：大正文下载中途也要能超时/可中止
      res._miyaClearTimer = function () { clearTimeout(timer); };
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

  /** 从已收到的碎片里尽量捞出可用文本（服务端已出字、客户端中途断连时用） */
  function recoverTextFromPartial(contentAcc, reasoningAcc, rawAcc) {
    try {
      if (contentAcc || reasoningAcc) {
        var fin = finalizeStreamText(contentAcc, reasoningAcc);
        if (fin) return fin;
      }
    } catch (e0) { /* continue */ }

    var raw = String(rawAcc || '').trim();
    if (!raw) return '';

    // 整包 JSON（非 SSE）
    if (raw.charAt(0) === '{') {
      try {
        var j = JSON.parse(raw);
        var t = extractApiText(j);
        if (t) return t;
      } catch (e1) {
        if (raw.indexOf('{') >= 0) return raw;
      }
    }

    // SSE 混杂：抽出所有 data 行再拼
    if (raw.indexOf('data:') >= 0) {
      var content = '';
      var reasoning = '';
      raw.split(/\r?\n/).forEach(function (line) {
        var trimmed = String(line || '').trim();
        if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return;
        if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
        if (!trimmed || trimmed === '[DONE]') return;
        try {
          var obj = JSON.parse(trimmed);
          var delta = extractStreamDelta(obj);
          if (delta.content) content += delta.content;
          if (delta.reasoning) reasoning += delta.reasoning;
          if (!delta.content && !delta.reasoning && obj.choices) {
            var whole = extractApiText(obj);
            if (whole) content += whole;
          }
        } catch (e2) { /* skip */ }
      });
      try {
        if (content || reasoning) return finalizeStreamText(content, reasoning);
      } catch (e3) { /* continue */ }
    }

    var brace = raw.indexOf('{');
    if (brace >= 0) return raw.slice(brace);
    return '';
  }

  /**
   * 边收边攒：流式 SSE / 非流式 JSON 都走 reader。
   * 读到一半断连时，若已有 { 开头内容则返回碎片，交给 parseApiPayload salvage。
   */
  function readCompletionsBody(res, preferSse) {
    function clearTimer() {
      if (res && typeof res._miyaClearTimer === 'function') {
        try { res._miyaClearTimer(); } catch (e) {}
      }
    }

    if (!res.body || !res.body.getReader) {
      return res.text().then(function (raw) {
        clearTimer();
        var recovered = recoverTextFromPartial('', '', raw);
        if (!recovered) throw new Error('API 返回为空');
        return recovered;
      }, function (err) {
        clearTimer();
        throw err;
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

    function finishOk() {
      clearTimer();
      if (preferSse && sseBuf.trim()) consumeSseLine(sseBuf);
      var recovered = recoverTextFromPartial(contentAcc, reasoningAcc, rawAcc + (sseBuf || ''));
      if (!recovered) throw new Error('API 返回为空');
      return recovered;
    }

    function finishErr(err) {
      clearTimer();
      var recovered = recoverTextFromPartial(contentAcc, reasoningAcc, rawAcc + (sseBuf || ''));
      if (recovered && recovered.indexOf('{') >= 0) {
        // 服务端其实已出字，客户端中途断了 —— 用已收到的继续解析，不报断连
        return recovered;
      }
      throw err;
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return finishOk();
        var chunk = decoder.decode(result.value, { stream: true });
        rawAcc += chunk;
        if (preferSse) {
          sseBuf += chunk;
          var parts = sseBuf.split('\n');
          sseBuf = parts.pop() || '';
          parts.forEach(consumeSseLine);
        }
        return pump();
      }, finishErr);
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
      timeoutMs: 360000,
      max_tokens: DOUYIN_MAX_TOKENS
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

    var timeoutMs = Number(reqOpts.timeoutMs) || 360000;
    return fetchWithFullTimeout(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(payload)
    }, timeoutMs).then(function (r) {
      if (!r.ok) {
        if (typeof r._miyaClearTimer === 'function') r._miyaClearTimer();
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      // 无论是否 stream，都用 reader 边收边攒，避免 r.json() 整包下载中途 Failed to fetch
      return readCompletionsBody(r, !!useStream);
    });
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
    var maxAttempts = 3;
    var attempt = 0;

    function run(useStream) {
      attempt += 1;
      return callPhoneApiOnce(systemHint, userContent, phoneData, reqOpts, useStream)
        .catch(function (err) {
          // 流式通道不可用时改非流式
          if (useStream) {
            attempt = 0;
            return new Promise(function (resolve) {
              setTimeout(resolve, 180);
            }).then(function () {
              return run(false);
            });
          }
          if (isNetworkFetchError(err) && attempt < maxAttempts) {
            return new Promise(function (resolve) {
              setTimeout(resolve, 800 * attempt);
            }).then(function () {
              return run(false);
            });
          }
          throw humanizeApiError(err);
        });
    }

    // 抖音体量大：优先流式边收边攒；失败再非流式（同样 reader 可 salvage）
    return run(true);
  }

  function buildSystemPrompt(charName, profileName) {
    return (
      '你是「' + charName + '」私人手机里「抖音」App 的档案员。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机抖音里真实会有什么——一切从角色「' + charName + '」第一人称视角：这是 ta 的账号、ta 的推荐流、ta 的消息与主页，不是用户的，也不是旁白。' +
      '文案必须具体、像真人会刷/会发的短视频：作者、文案、字幕碎片、评论、音乐名、私密批注、私信预览。' +
      '禁止鸡汤、禁止花里胡哨文案、禁止空泛形容词堆砌；用具体题材、时间、称呼、动作、物件、对话碎片。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构（字段顺序必须遵守：先写 messages 与 profile，再写 feed，避免长输出被截断时丢掉消息/主页）：' +
      '{"nickname":"昵称","douyinId":"抖音号短串","ipLocation":"IP属地城市","bio":"两行以内简介",' +
      '"avatarTone":"rose|ink|mist|sand|sky|plum|tea|night|cream|coral|neon|slate",' +
      '"stats":{"likes":"128","mutuals":"2","following":"86","followers":"42"},' +
      '"homeTabs":["关注","推荐","同城"],"activeHomeTab":"推荐",' +
      '"searchHint":"搜索框最近想搜的词",' +
      '"messages":{"alertBanner":"当前无法接收朋友的消息提醒 打开提醒","notices":[{"id":"nv1","title":"互动消息","preview":"有人赞了你的评论","time":"昨天","kind":"interact|follow|group|system|chat","official":false}],"chats":[{"id":"ch1","name":"会话名","preview":"最后一句","time":"11:47","unread":true,"tone":"plum","online":"10分钟内在线","messages":[{"id":"mg1","from":"them|me","text":"消息正文","time":"11:40"}]}]},' +
      '"profile":{"gender":"男|女|其他","ageTag":"可空","banner":"主页横条短句可空","introHint":"点击添加介绍…旁的真实简介可写在bio","shortcuts":[{"id":"sc1","name":"我的订单|观看历史|小程序|全部功能","hint":"一行副标"}],"works":[{"id":"wk1","author":"自己昵称","caption":"自己发的视频文案","tags":["标签"],"likes":"86","comments":"12","collects":"5","shares":"3","music":"原声","subtitle":"字幕一句","coverTone":"night","duration":"00:18","privateNote":"40-100字","commentsList":[{"id":"cm1","user":"评论者","text":"评论","time":"1小时前","likes":"2"}]}],"daily":[{"id":"dy1","author":"自己","caption":"日常一条","coverTone":"sky","privateNote":"40-80字"}],"favorites":[{"id":"fv1","author":"作者","caption":"收藏的视频","coverTone":"tea","privateNote":"为什么收藏"}],"liked":[{"id":"lk1","author":"作者","caption":"赞过的视频","coverTone":"coral","privateNote":"为什么点赞"}]},' +
      '"stories":[{"id":"st1","name":"限时日常或熟人名","label":"限时日常|状态设置","tone":"mist","note":"40-80字点开说明"}],' +
      '"friends":[{"id":"fr1","name":"朋友名","preview":"朋友动态预览","tone":"sand","note":"40-100字","time":"今天"}],' +
      '"followingFeed":[{"id":"ff1","author":"熟人","caption":"关注流视频文案","tags":[],"likes":"42","comments":"6","collects":"2","shares":"1","music":"BGM","subtitle":"字幕","coverTone":"sky","duration":"00:22","time":"今天","privateNote":"40-100字","commentsList":[]}],' +
      '"feed":[{"id":"fd1","author":"作者昵称","authorTone":"mist","caption":"80-180字视频文案，口语具体可感","tags":["标签1","标签2"],"likes":"5632","comments":"113","collects":"508","shares":"397","music":"@作者创作的原声","subtitle":"画面字幕一句","coverTone":"neon","duration":"00:31","location":"地点可空","time":"昨天","privateNote":"60-140字角色第一人称私密批注","commentsList":[{"id":"cm1","user":"评论者","text":"评论一句","time":"1小时前","likes":"3"}]}],' +
      '"nightThought":"30-70字刷完抬手关屏的一句","footerNote":"30-60字封底寄语"}。' +
      '【完整输出·最高优先级】必须一次尽量写满；每条字符串写完整句子；JSON 必须以 } 闭合。' +
      '【顺序铁律】必须先完整写完 messages（含 chats/notices）与 profile（含 works/favorites/liked），再写 feed；禁止把 messages/profile 放到最后。' +
      '硬性数量目标（请尽力写满，前端不会因不足重试，也不会截断——模型返回多少就展示多少）：' +
      'messages.chats 恰好 5 条（每条 messages 至少 2 句）；messages.notices 恰好 4 条；' +
      'profile.works 恰好 4 条；profile.daily 恰好 3 条；profile.favorites 恰好 3 条；profile.liked 恰好 3 条；profile.shortcuts 恰好 4 条；' +
      'stories 恰好 4 条；friends 恰好 4 条；followingFeed 恰好 4 条；feed 恰好 10 条；' +
      '每条 feed 的 commentsList 至少 2 条；nickname/douyinId/bio/stats/searchHint/nightThought/footerNote 都写。' +
      'profile.gender 必须与角色人设性别一致（从角色档案读取，男就写男，女就写女，禁止默认写女）。' +
      '至少 3 条 feed/works/chats/favorites 与「' + profileName + '」有关（暗线即可，不要直白剧透系统）；' +
      '封面色 coverTone 在给定枚举里轮换；caption 要像真抖音文案，口语、具体，不要文艺口号。' +
      'caption/privateNote/commentsList 要有交互感：像能上下滑、能点进评论区看的完整内容，不要半截广告腔。' +
      '世界观无现代互联网时，仍用同一 JSON 字段，把点赞/收藏写成该世界等价物。' +
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
      '【生成任务 · ' + charName + ' 的手机 · 抖音 · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人抖音的完整数据。',
      '对象关系绑定「' + profileName + '」。随机种子 ' + seed + '（勿提及）。',
      '【视角铁律】第一人称是「' + charName + '」。手机主人是角色。用户只是 ta 视频/私信/赞过/深夜收藏里反复出现的那个人。',
      '【内容要求】',
      '- 昵称、抖音号、简介、搜索词要像真人账号，贴合人设，不要口号。',
      '- profile.gender 必须写角色「' + charName + '」的真实性别（男/女/其他），与角色档案与人设一致，禁止默认写女。',
      '- feed.caption 是公开文案；feed.privateNote 必须是角色第一人称私密批注（偷偷记的），具体、贴合人设与聊天线索。',
      '- feed.caption / followingFeed.caption / profile.works.caption / favorites.privateNote 必须具体：有题材、时间、称呼、物件。',
      '- 私信 chats 要像真人对话碎片；notices 要像真抖音消息页（互动/关注/团购等）。',
      '- 从近期聊天抽取真实线索写进视频与收藏，但不要整段复述聊天。',
      '- 语气像自己刷完手机抬手关屏，不是写小作文给读者看。',
      '【强制完整 · 写满再结束】',
      '- 顺序：先 messages.chats×5 + notices×4 + profile.works×4/favorites×3/liked×3，再 feed×10 · followingFeed×4 · friends×4 · stories×4',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；',
      '- 前端禁止截断展示，也禁止因字段不足而重试——你返回多少就展示多少，所以请自己一次写满；消息与主页字段必须出现在 feed 之前。'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      nickname: '原始返回',
      douyinId: '',
      ipLocation: '',
      bio: '',
      avatarTone: 'ink',
      stats: { likes: '', mutuals: '', following: '', followers: '' },
      homeTabs: ['关注', '推荐', '同城'],
      activeHomeTab: '推荐',
      searchHint: '',
      stories: [],
      friends: [],
      followingFeed: [],
      feed: [{
        id: 'fd-raw',
        author: '',
        caption: '未解析原文',
        tags: ['RAW'],
        likes: '',
        comments: '',
        collects: '',
        shares: '',
        music: '',
        subtitle: '',
        coverTone: 'ink',
        duration: '',
        privateNote: '',
        commentsList: [],
        opened: false,
        liked: false
      }],
      messages: {
        alertBanner: '',
        notices: [],
        chats: []
      },
      profile: {
        gender: '',
        ageTag: '',
        banner: '',
        introHint: '',
        works: [],
        daily: [],
        favorites: [],
        liked: [],
        shortcuts: []
      },
      nightThought: '',
      footerNote: '',
      _rawBody: raw.slice(0, 8000)
    };
  }

  function hasDouyinContent(norm) {
    return !!(norm && (
      (norm.feed && norm.feed.length) ||
      (norm.followingFeed && norm.followingFeed.length) ||
      (norm.friends && norm.friends.length) ||
      (norm.stories && norm.stories.length) ||
      (norm.messages && (
        (norm.messages.chats && norm.messages.chats.length) ||
        (norm.messages.notices && norm.messages.notices.length)
      )) ||
      (norm.profile && (
        (norm.profile.works && norm.profile.works.length) ||
        (norm.profile.favorites && norm.profile.favorites.length) ||
        (norm.profile.liked && norm.profile.liked.length)
      )) ||
      trim(norm.nickname) ||
      trim(norm.bio) ||
      trim(norm.footerNote) ||
      trim(norm.nightThought) ||
      trim(norm._rawBody)
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    obj = salvageIntoDouyinObj(rawText, obj);
    obj = unwrapDouyinRoot(obj);
    var store = global.miyaDeepDouyinStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeDouyinPayload === 'function') {
        var norm = store.normalizeDouyinPayload(obj);
        if (hasDouyinContent(norm)) {
          if (obj._rawBody) norm._rawBody = String(obj._rawBody).slice(0, 8000);
          return norm;
        }
      }
    }

    var fallback = buildRawFallback(rawText);
    if (fallback.feed && fallback.feed[0]) {
      fallback.feed[0].caption = '未解析原文';
      fallback.feed[0].privateNote = rawText.slice(0, 8000);
    }
    return fallback;
  }

  function generateDouyin(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildDouyinContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的抖音数据' });
    }

    return callPhoneApi(
      buildSystemPrompt(charName, profileName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.88, max_tokens: DOUYIN_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepDouyinBridge = {
    buildDouyinContext: buildDouyinContext,
    generateDouyin: generateDouyin
  };
})(typeof window !== 'undefined' ? window : global);
