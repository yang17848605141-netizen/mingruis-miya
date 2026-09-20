/**
 * miya-deep-couple-bridge.js — 深入 · 角色手机 情侣手册 API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var COUPLE_MAX_TOKENS = 32768;

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
    t = t.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
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

  function scoreCoupleObj(obj) {
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
      len('loveAtlas', ['atlas']) * 80 +
      len('secretFiles', ['secrets']) * 70 +
      len('heartbeatLog', ['pulses']) * 40 +
      len('coupleRituals', ['rituals']) * 50 +
      len('memoryShards', ['memories']) * 60 +
      len('wishDrawer', ['wishes']) * 35 +
      len('privateDictionary', ['dictionary']) * 40 +
      len('moodForecast', ['forecast']) * 30 +
      len('confessionQueue', ['confessions']) * 55 +
      len('promiseLedger', ['promises']) * 45 +
      len('sceneTickets', ['tickets']) * 50 +
      len('nightNotes', ['nights']) * 35 +
      len('bondQuiz', ['quiz']) * 60;
    if (obj.openLetter || obj.letter) score += 8;
    if (obj.summary) score += 4;
    if (obj.hero && typeof obj.hero === 'object') score += 6;
    if (obj.fileNo || obj.caseNo) score += 2;
    if (obj.footerSeal || obj.footerNote) score += 2;
    return score;
  }

  /** 模型常包一层 couple/data/payload —— 解开后再规范化 */
  function unwrapCoupleRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreCoupleObj(obj);
    var keys = ['couple', 'data', 'payload', 'result', 'dossier', 'archive', 'handbook', 'content'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreCoupleObj(inner);
      if (s > bestScore) {
        best = inner;
        bestScore = s;
      }
    }
    return best;
  }

  /**
   * 半截 JSON 时按数组字段捞回完整条目——只 salvage，绝不二次请求。
   */
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
        parsed.title || parsed.name || parsed.chapter || parsed.front ||
        parsed.word || parsed.text || parsed.q || parsed.day || parsed.time ||
        parsed.content || parsed.note || parsed.body
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
          item.title || item.name || item.chapter || item.front ||
          item.word || item.text || item.q || item.day || item.time ||
          item.content || item.note || item.body
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

  function salvageIntoCoupleObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);
    var specs = [
      ['loveAtlas', ['loveAtlas', 'atlas']],
      ['secretFiles', ['secretFiles', 'secrets']],
      ['heartbeatLog', ['heartbeatLog', 'pulses']],
      ['coupleRituals', ['coupleRituals', 'rituals']],
      ['memoryShards', ['memoryShards', 'memories']],
      ['wishDrawer', ['wishDrawer', 'wishes']],
      ['privateDictionary', ['privateDictionary', 'dictionary']],
      ['moodForecast', ['moodForecast', 'forecast']],
      ['confessionQueue', ['confessionQueue', 'confessions']],
      ['promiseLedger', ['promiseLedger', 'promises']],
      ['sceneTickets', ['sceneTickets', 'tickets']],
      ['nightNotes', ['nightNotes', 'nights']],
      ['bondQuiz', ['bondQuiz', 'quiz']]
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
        var obj = JSON.parse(slice);
        var root = unwrapCoupleRoot(obj);
        var score = scoreCoupleObj(root);
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
        return unwrapCoupleRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapCoupleRoot(sliced) : null;
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；情侣手册须完全贴合此关系与互动节奏。'
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
    var seed = trim(contact.name) + ' 情侣 恋爱 亲密 约定 称呼 纪念日 相处 牵挂 私语';
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
      '以下为与该角色的近期私聊，生成情侣手册时可参考其中的亲密线索、称呼、约定、情绪与相处细节，但不必逐条复述。',
      lines.join('\n')
    ].join('\n');
  }

  function buildCoupleContext(contactId) {
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

  function humanizeApiError(err) {
    if (!err) return new Error('读取失败');
    if (err.name === 'AbortError') return new Error('请求超时，请稍后重试');
    var msg = String(err.message || err || '').trim();
    var lower = msg.toLowerCase();
    if (lower === 'failed to fetch' ||
        lower.indexOf('load failed') >= 0 ||
        lower.indexOf('networkerror') >= 0 ||
        lower.indexOf('network request failed') >= 0 ||
        lower.indexOf('the network connection was lost') >= 0) {
      return new Error('网络中断，手册内容较长容易断连，请再试一次');
    }
    return err instanceof Error ? err : new Error(msg || '读取失败');
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
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
      max_tokens: COUPLE_MAX_TOKENS
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

    var timeoutMs = Number(reqOpts.timeoutMs) || 300000;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      return r.json();
    }).then(function (j) {
      var text = extractApiText(j);
      if (!text) throw new Error('API 返回为空');
      return text;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw humanizeApiError(err);
    });
  }

  function buildSystemPrompt(charName, profileName) {
    return (
      '你是「' + charName + '」私人手机里「情侣手册·秘密恋爱档案」App 的策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机里这一份只关于「' + charName + ' ↔ ' + profileName + '」的私密恋爱卷宗会写下什么——' +
      '一切从角色「' + charName + '」第一人称视角出发：这是 ta 的手机、ta 偷偷整理的情侣手册，不是用户的日记，也不是第三方旁白。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：' +
      '{"dateLabel":"7月15日 周三","fileNo":"CP-0715-R3",' +
      '"hero":{"coverTitle":"档案封面短题","intimacyIndex":72,"intimacyLabel":"暧昧升温中","statusLine":"此刻关系一句话","softVow":"一句轻誓言","coverStamp":"PRIVATE","partnerAlias":"对对方的私称"},' +
      '"openLetter":"120-220字开卷私信，写给对方但像写给自己",' +
      '"summary":"80-140字本册综述与心绪",' +
      '"loveAtlas":[{"id":"a1","chapter":"01","title":"章节名","when":"时间窗","mood":"心绪词","body":"90-160字叙事"}],' +
      '"secretFiles":[{"id":"s1","title":"机密标题","grade":"CONFIDENTIAL|TOP SECRET|HEALING","content":"100-180字密封内容"}],' +
      '"heartbeatLog":[{"id":"h1","time":"22:14","beat":"跳得很快","note":"40-90字脉搏笔记"}],' +
      '"coupleRituals":[{"id":"r1","title":"双人仪式名","cadence":"每日/每周…","note":"30-70字","done":false}],' +
      '"memoryShards":[{"id":"m1","front":"正面短题","back":"背面80-140字回忆","place":"地点氛围"}],' +
      '"wishDrawer":[{"id":"w1","text":"想和对方做的事","tone":"软/馋/羞"}],' +
      '"privateDictionary":[{"id":"d1","word":"两人暗号词","meaning":"含义","usage":"使用情境"}],' +
      '"moodForecast":[{"id":"f1","day":"今晚/明日/周末","mood":"心情词","note":"30-60字"}],' +
      '"confessionQueue":[{"id":"c1","title":"未寄出的信标题","content":"80-150字","urgency":"轻/烫/蓄积"}],' +
      '"promiseLedger":[{"id":"p1","text":"承诺内容","side":"me|you|us","kept":false}],' +
      '"sceneTickets":[{"id":"t1","title":"幻想约会票根名","when":"时段","place":"场所","detail":"50-100字场景"}],' +
      '"nightNotes":[{"id":"n1","time":"01:07","text":"40-80字夜记"}],' +
      '"bondQuiz":[{"id":"q1","q":"你记得吗·题干","a":"答案揭晓","hint":"轻提示"}],' +
      '"footerSeal":"40-80字封底戳章碎念"}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部字段与条目；禁止偷懒、禁止半截、禁止只写几条就结束；每条字符串必须写完，禁止用省略号敷衍正文。' +
      '硬性数量（缺一项都算失败）：' +
      'loveAtlas 恰好 5 条；secretFiles 恰好 3 条；heartbeatLog 恰好 6 条；coupleRituals 恰好 4 条；' +
      'memoryShards 恰好 4 条；wishDrawer 恰好 5 条；privateDictionary 恰好 4 条；moodForecast 恰好 3 条；' +
      'confessionQueue 恰好 3 条；promiseLedger 恰好 4 条；sceneTickets 恰好 3 条；nightNotes 恰好 3 条；bondQuiz 恰好 3 条；' +
      'hero/openLetter/summary/fileNo/footerSeal 都必须写满；' +
      '内容须具体贴合人设、世界书、关系与近期聊天线索，禁止模板空话与通用恋爱文案；' +
      'promiseLedger.side：me=角色承诺，you=对方曾承诺（角色视角记录），us=双方共同；' +
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
      '【生成任务 · ' + charName + ' 的手机 · 情侣手册秘密档案 · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人情侣手册 App 的完整「恋爱秘密卷宗」，对象是与 ta 绑定关系的「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【视角铁律】第一人称是「' + charName + '」。手机主人是角色。写的是 ta 对「' + profileName + '」的心动、牵挂、赌气、守护与幻想。',
      '【内容方向 · 要超级丰富、要有互动感】',
      '- 不要普通情侣说说：写成可翻开的档案——章节图鉴、密封机密、心跳日志、双人仪式、可翻转的记忆碎片、愿望抽屉、私密词典、心情预报、未寄出的告白队列、承诺账本、幻想约会票根、夜记、默契小测。',
      '- 可含：只有两人懂的称呼与暗号、差点说出口的话、想瞒又不想瞒的秘密、想一起去的地方、吵架后的软化、对对方习惯的观察。',
      '- 语气必须是「' + charName + '」本人在手机里偷偷整理档案的语气。',
      '【强制完整 · 写满再结束】',
      '- loveAtlas×5 · secretFiles×3 · heartbeatLog×6 · coupleRituals×4 · memoryShards×4 · wishDrawer×5',
      '- privateDictionary×4 · moodForecast×3 · confessionQueue×3 · promiseLedger×4 · sceneTickets×3 · nightNotes×3 · bondQuiz×3',
      '- hero/openLetter/summary/fileNo/footerSeal 全写满',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；禁止少写；返回多少前端就展示多少，但你必须写满'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      dateLabel: '',
      fileNo: '',
      hero: {
        coverTitle: '原始返回',
        intimacyIndex: 0,
        intimacyLabel: '',
        statusLine: '',
        softVow: '',
        coverStamp: '',
        partnerAlias: ''
      },
      openLetter: '',
      summary: raw,
      loveAtlas: [],
      secretFiles: [],
      heartbeatLog: [],
      coupleRituals: [],
      memoryShards: [],
      wishDrawer: [],
      privateDictionary: [],
      moodForecast: [],
      confessionQueue: [],
      promiseLedger: [],
      sceneTickets: [],
      nightNotes: [],
      bondQuiz: [],
      footerSeal: ''
    };
  }

  function hasCoupleContent(norm) {
    return !!(norm && (
      trim(norm.openLetter) ||
      trim(norm.summary) ||
      (norm.loveAtlas && norm.loveAtlas.length) ||
      (norm.secretFiles && norm.secretFiles.length) ||
      (norm.heartbeatLog && norm.heartbeatLog.length) ||
      (norm.coupleRituals && norm.coupleRituals.length) ||
      (norm.memoryShards && norm.memoryShards.length) ||
      (norm.wishDrawer && norm.wishDrawer.length) ||
      (norm.privateDictionary && norm.privateDictionary.length) ||
      (norm.moodForecast && norm.moodForecast.length) ||
      (norm.confessionQueue && norm.confessionQueue.length) ||
      (norm.promiseLedger && norm.promiseLedger.length) ||
      (norm.sceneTickets && norm.sceneTickets.length) ||
      (norm.nightNotes && norm.nightNotes.length) ||
      (norm.bondQuiz && norm.bondQuiz.length) ||
      trim(norm.footerSeal)
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    // 即使整包半截，也尽量从各数组字段捞回完整条目（与游戏/待办同策略，不二次请求）
    obj = salvageIntoCoupleObj(rawText, obj);
    obj = unwrapCoupleRoot(obj);
    var store = global.miyaDeepCoupleStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeCouplePayload === 'function') {
        var norm = store.normalizeCouplePayload(obj);
        if (hasCoupleContent(norm)) return norm;
      }
    }

    // 解析失败：原样展示模型返回内容，绝不因「不足」再请求
    return buildRawFallback(rawText);
  }

  function generateCouple(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildCoupleContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的情侣手册' });
    }

    // 单次请求：禁止不足重试 / 补齐第二轮
    return callPhoneApi(
      buildSystemPrompt(charName, profileName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: COUPLE_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepCoupleBridge = {
    buildCoupleContext: buildCoupleContext,
    generateCouple: generateCouple
  };
})(typeof window !== 'undefined' ? window : global);
