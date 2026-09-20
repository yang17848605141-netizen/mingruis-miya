/**
 * miya-deep-game-bridge.js — 深入 · 角色手机 游戏 API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var GAME_MAX_TOKENS = 32768;

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

  function scoreGameObj(obj) {
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
      len('choiceFiles', ['choices', 'scenarios']) * 90 +
      len('cipherDeck', ['ciphers', 'cards']) * 70 +
      len('bondArena', ['quiz', 'arena']) * 80 +
      len('thermoRounds', ['thermo', 'temps']) * 60 +
      len('sceneReel', ['scenes', 'scripts']) * 70 +
      len('lotDrawer', ['lots', 'lotsBox']) * 50 +
      len('missionBoard', ['missions', 'tasks']) * 55 +
      len('stampRack', ['stamps', 'badges']) * 40;
    if (obj.briefing || obj.openLetter) score += 8;
    if (obj.summary) score += 4;
    if (obj.hero && typeof obj.hero === 'object') score += 6;
    if (obj.fileNo || obj.caseNo) score += 2;
    if (obj.footerSeal || obj.footerNote) score += 2;
    return score;
  }

  /** 模型常包一层 game/data/payload —— 解开后再规范化 */
  function unwrapGameRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreGameObj(obj);
    var keys = ['game', 'data', 'payload', 'result', 'playfile', 'dossier', 'archive', 'content'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreGameObj(inner);
      if (s > bestScore) {
        best = inner;
        bestScore = s;
      }
    }
    return best;
  }

  /**
   * 半截 JSON 时按数组字段捞回完整条目——只 salvage，绝不二次请求。
   * keys: ['choiceFiles','choices','scenarios'] 等
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
        parsed.title || parsed.name || parsed.face || parsed.front ||
        parsed.q || parsed.question || parsed.prompt || parsed.label
      );
      var key = id || (title ? ('t:' + title) : '');
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
          item.title || item.name || item.face || item.front ||
          item.q || item.question || item.prompt || item.label
        );
        var key = id || (title ? ('t:' + title) : '');
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(item);
      });
    }
    take(primary);
    take(salvaged);
    return out;
  }

  function salvageIntoGameObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);
    var specs = [
      ['choiceFiles', ['choiceFiles', 'choices', 'scenarios']],
      ['cipherDeck', ['cipherDeck', 'ciphers', 'cards']],
      ['bondArena', ['bondArena', 'quiz', 'arena']],
      ['thermoRounds', ['thermoRounds', 'thermo', 'temps']],
      ['sceneReel', ['sceneReel', 'scenes', 'scripts']],
      ['lotDrawer', ['lotDrawer', 'lots', 'lotsBox']],
      ['missionBoard', ['missionBoard', 'missions', 'tasks']],
      ['stampRack', ['stampRack', 'stamps', 'badges']]
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
        var root = unwrapGameRoot(obj);
        var score = scoreGameObj(root);
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
        return unwrapGameRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapGameRoot(sliced) : null;
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；游戏对局须完全贴合此关系与互动节奏。'
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
    var seed = trim(contact.name) + ' 游戏 对局 默契 心动 约定 称呼 相处 私语 秘密';
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
      '以下为与该角色的近期私聊，生成游戏对局时可参考其中的亲密线索、称呼、约定、情绪与相处细节，但不必逐条复述。',
      lines.join('\n')
    ].join('\n');
  }

  function buildGameContext(contactId) {
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
      return new Error('网络中断，游戏内容较长容易断连，请再试一次');
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
      max_tokens: GAME_MAX_TOKENS
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
      '你是「' + charName + '」私人手机里「游戏·机密对局卷宗」App 的策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机里这一份只关于「' + charName + ' ↔ ' + profileName + '」的可玩秘密对局档案会写下什么——' +
      '一切从角色「' + charName + '」第一人称视角出发：这是 ta 的手机、ta 偷偷做的情侣向小游戏档案，不是用户的游戏厅，也不是第三方旁白。' +
      '内容必须超级丰富、可点击互动、像真的能玩：抉择分支、翻牌解密、默契对战、体温猜数、剧本选项、抽签、任务打卡、通关戳章。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：' +
      '{"dateLabel":"7月15日 周三","fileNo":"GM-0715-A1","classification":"CONFIDENTIAL",' +
      '"hero":{"title":"对局封面短题","subtitle":"副题一句","clearance":"CLEARANCE B","affinityLabel":"默契初阶","statusLine":"此刻对局状态一句","opponentAlias":"对对方的私称","playScore":0},' +
      '"briefing":"100-180字开局简报，像密封卷宗前言",' +
      '"summary":"80-140字本册综述",' +
      '"choiceFiles":[{"id":"cf1","title":"抉择场景名","setup":"80-140字情境","options":[{"id":"o1","label":"选项短句","reaction":"60-120字角色反应","score":2},{"id":"o2","label":"...","reaction":"...","score":1},{"id":"o3","label":"...","reaction":"...","score":3}]}],' +
      '"cipherDeck":[{"id":"cd1","face":"牌面短题","back":"60-110字解码内容","pairKey":"pair-a"}],' +
      '"bondArena":[{"id":"ba1","q":"默契题干","choices":["选项A","选项B","选项C"],"correct":0,"explain":"40-90字揭晓"}],' +
      '"thermoRounds":[{"id":"tr1","prompt":"猜这个瞬间心里温度的提示","target":72,"tolerance":12,"coldNote":"偏低碎念40-70字","hotNote":"偏高碎念40-70字","hitNote":"猜中碎念40-70字"}],' +
      '"sceneReel":[{"id":"sr1","title":"短剧本名","setting":"场景氛围","body":"90-160字开场","choices":[{"label":"台词选项A","nextNote":"50-100字后续"},{"label":"台词选项B","nextNote":"..."},{"label":"台词选项C","nextNote":"..."}]}],' +
      '"lotDrawer":[{"id":"ld1","kind":"真心话|行动令|心愿签","front":"签面短题","back":"50-100字签文"}],' +
      '"missionBoard":[{"id":"mb1","title":"秘密任务名","detail":"40-90字","reward":"奖励一句"}],' +
      '"stampRack":[{"id":"st1","name":"戳章名","condition":"解锁条件","flavor":"30-60字碎念"}],' +
      '"footerSeal":"40-80字封底戳章碎念","earnedScore":0}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部字段与条目；禁止偷懒、禁止半截、禁止只写几条就结束；每条字符串必须写完，禁止用省略号敷衍正文。' +
      '硬性数量（缺一项都算失败）：' +
      'choiceFiles 恰好 4 条，且每条 options 恰好 3 个；' +
      'cipherDeck 恰好 6 条，pairKey 恰好组成 3 对（pair-a/pair-b/pair-c 各 2 张，同对 back 应同义呼应）；' +
      'bondArena 恰好 4 条，每条 choices 恰好 3 个，correct 为 0/1/2；' +
      'thermoRounds 恰好 3 条；sceneReel 恰好 3 条，每条 choices 恰好 3 个；' +
      'lotDrawer 恰好 5 条；missionBoard 恰好 4 条；stampRack 恰好 4 条；' +
      'hero/briefing/summary/fileNo/classification/footerSeal 都必须写满；' +
      'picked/answered/guess/drawn/done/unlocked/earnedScore 一律按未玩写：earnedScore=0，不要预填玩家进度；' +
      '内容须具体贴合人设、世界书、关系与近期聊天线索，禁止模板空话；' +
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
      '【生成任务 · ' + charName + ' 的手机 · 游戏·机密对局卷宗 · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人游戏 App 的完整「可玩恋爱对局档案」，对象是与 ta 绑定关系的「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【视角铁律】第一人称是「' + charName + '」。手机主人是角色。写的是 ta 为「' + profileName + '」准备的私密小游戏、试探、赌气、守护与幻想。',
      '【内容方向 · 要超级丰富、要能玩、要有互动感】',
      '- choiceFiles：像情景选项游戏，点选后读到角色反应与得分。',
      '- cipherDeck：翻牌配对解密，藏着只有俩人懂的暗号与心事。',
      '- bondArena：猜角色会怎么想/说的默契对战。',
      '- thermoRounds：猜心温数值，冷/热/命中各有碎念。',
      '- sceneReel：短剧本，玩家选一句台词，触发后续。',
      '- lotDrawer：抽签匣；missionBoard：可打卡的秘密任务；stampRack：通关戳章（未解锁）。',
      '- 语气必须是「' + charName + '」本人在手机里偷偷装订对局卷宗的语气。',
      '【强制完整 · 写满再结束】',
      '- choiceFiles×4（各 3 options）· cipherDeck×6（3 对）· bondArena×4 · thermoRounds×3',
      '- sceneReel×3 · lotDrawer×5 · missionBoard×4 · stampRack×4',
      '- hero/briefing/summary/fileNo/classification/footerSeal 全写满',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；禁止少写；返回多少前端就展示多少，但你必须写满'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      dateLabel: '',
      fileNo: '',
      classification: 'RAW',
      hero: {
        title: '原始返回',
        subtitle: '',
        clearance: '',
        affinityLabel: '',
        statusLine: '',
        opponentAlias: '',
        playScore: 0
      },
      briefing: '',
      summary: raw,
      choiceFiles: [],
      cipherDeck: [],
      bondArena: [],
      thermoRounds: [],
      sceneReel: [],
      lotDrawer: [],
      missionBoard: [],
      stampRack: [],
      footerSeal: '',
      earnedScore: 0
    };
  }

  function hasPlayableContent(norm) {
    return !!(norm && (
      trim(norm.briefing) ||
      trim(norm.summary) ||
      (norm.choiceFiles && norm.choiceFiles.length) ||
      (norm.cipherDeck && norm.cipherDeck.length) ||
      (norm.bondArena && norm.bondArena.length) ||
      (norm.thermoRounds && norm.thermoRounds.length) ||
      (norm.sceneReel && norm.sceneReel.length) ||
      (norm.lotDrawer && norm.lotDrawer.length) ||
      (norm.missionBoard && norm.missionBoard.length) ||
      (norm.stampRack && norm.stampRack.length) ||
      trim(norm.footerSeal)
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    // 即使整包半截，也尽量从各数组字段捞回完整条目（与待办/健康同策略，不二次请求）
    obj = salvageIntoGameObj(rawText, obj);
    obj = unwrapGameRoot(obj);
    var store = global.miyaDeepGameStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeGamePayload === 'function') {
        var norm = store.normalizeGamePayload(obj);
        if (hasPlayableContent(norm)) return norm;
      }
    }

    // 解析失败：原样展示模型返回内容，绝不因「不足」再请求
    return buildRawFallback(rawText);
  }

  function generateGame(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildGameContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的游戏数据' });
    }

    // 单次请求：禁止不足重试 / 补齐第二轮
    return callPhoneApi(
      buildSystemPrompt(charName, profileName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: GAME_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepGameBridge = {
    buildGameContext: buildGameContext,
    generateGame: generateGame
  };
})(typeof window !== 'undefined' ? window : global);
