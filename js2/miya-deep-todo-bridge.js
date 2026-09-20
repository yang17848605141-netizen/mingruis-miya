/**
 * miya-deep-todo-bridge.js — 深入 · 角色手机 待办 API 生成
 * 规则：单次请求、不截断展示、不足不重试；模型返回多少就规范化多少。
 */
(function (global) {
  'use strict';

  var TODO_MAX_TOKENS = 32768;

  var TASK_STYLES = [
    'clip', 'tape', 'pinned', 'fold', 'wide', 'narrow', 'offset-r', 'offset-l', 'stamp', 'ribbon'
  ];

  var PRIORITIES = ['urgent', 'soft', 'later', 'secret', 'wish', 'routine'];

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

  function scoreTodoObj(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return -1;
    var tasks = Array.isArray(obj.tasks) ? obj.tasks.length : 0;
    var cols = Array.isArray(obj.columns) ? obj.columns.length : 0;
    var colTasks = 0;
    if (cols) {
      obj.columns.forEach(function (c) {
        if (c && Array.isArray(c.tasks)) colTasks += c.tasks.length;
      });
    }
    var rituals = Array.isArray(obj.rituals) ? obj.rituals.length : 0;
    var sparks = Array.isArray(obj.inboxSparks) ? obj.inboxSparks.length
      : (Array.isArray(obj.sparks) ? obj.sparks.length : 0);
    var sealed = Array.isArray(obj.sealedNotes) ? obj.sealedNotes.length
      : (Array.isArray(obj.sealed) ? obj.sealed.length : 0);
    var seeds = Array.isArray(obj.tomorrowSeeds) ? obj.tomorrowSeeds.length
      : (Array.isArray(obj.tomorrow) ? obj.tomorrow.length : 0);
    var bonus = 0;
    if (obj.summary || obj.overallNote) bonus += 2;
    if (obj.hero && typeof obj.hero === 'object') bonus += 2;
    if (obj.footerNote || obj.closing) bonus += 1;
    if (obj.caseNo || obj.fileNo) bonus += 1;
    return (tasks + colTasks) * 1000 + rituals * 40 + sparks * 20 + sealed * 30 + seeds * 15 + cols * 10 + bonus;
  }

  /** 模型常包一层 todo/data/payload —— 解开后再规范化 */
  function unwrapTodoRoot(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var best = obj;
    var bestScore = scoreTodoObj(obj);
    var keys = ['todo', 'data', 'payload', 'result', 'dossier', 'archive', 'casefile', 'content'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var inner = obj[keys[i]];
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
      var s = scoreTodoObj(inner);
      if (s > bestScore) {
        best = inner;
        bestScore = s;
      }
    }
    return best;
  }

  function mergeTaskLists(primary, salvaged) {
    var out = [];
    var seen = Object.create(null);
    function take(list) {
      (list || []).forEach(function (t) {
        if (!t || typeof t !== 'object') return;
        var title = trim(t.title || t.name || t.text);
        var key = trim(t.id) || (title ? ('title:' + title) : '');
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(t);
      });
    }
    take(primary);
    take(salvaged);
    return out;
  }

  function salvageArrayObjects(text, keys, pickKey) {
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
      var key = pickKey ? pickKey(parsed) : (trim(parsed.id) || trim(parsed.title || parsed.name || parsed.text));
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
        var root = unwrapTodoRoot(obj);
        var score = scoreTodoObj(root);
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
        return unwrapTodoRoot(direct);
      }
    } catch (e0) { /* fall through */ }
    var sliced = tryParseJsonSlice(cleaned);
    return sliced ? unwrapTodoRoot(sliced) : null;
  }

  /** 半截 JSON 时尽量捞回完整 task 对象——只为 salvage，绝不二次请求补齐 */
  function salvageTaskObjects(text) {
    return salvageArrayObjects(text, ['tasks'], function (parsed) {
      var title = trim(parsed.title || parsed.name || parsed.text);
      if (!title) return '';
      return trim(parsed.id) || ('title:' + title);
    });
  }

  function salvageIntoTodoObj(rawText, obj) {
    var base = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    var next = Object.assign({}, base);

    var salvagedTasks = salvageTaskObjects(rawText);
    if (salvagedTasks.length) {
      next.tasks = mergeTaskLists(Array.isArray(next.tasks) ? next.tasks : [], salvagedTasks);
    }

    var ritualSalvage = salvageArrayObjects(rawText, ['rituals'], function (p) {
      var t = trim(p.title || p.name || p.text);
      return t ? ('ritual:' + t) : '';
    });
    if (ritualSalvage.length) {
      next.rituals = mergeTaskLists(Array.isArray(next.rituals) ? next.rituals : [], ritualSalvage);
    }

    var sparkSalvage = salvageArrayObjects(rawText, ['inboxSparks', 'sparks'], function (p) {
      var t = trim(p.text || p.title || p.content);
      return t ? ('spark:' + t.slice(0, 48)) : '';
    });
    if (sparkSalvage.length) {
      next.inboxSparks = mergeTaskLists(
        Array.isArray(next.inboxSparks) ? next.inboxSparks
          : (Array.isArray(next.sparks) ? next.sparks : []),
        sparkSalvage
      );
    }

    var sealedSalvage = salvageArrayObjects(rawText, ['sealedNotes', 'sealed'], function (p) {
      var t = trim(p.title || p.name || p.content);
      return t ? ('sealed:' + t.slice(0, 48)) : '';
    });
    if (sealedSalvage.length) {
      next.sealedNotes = mergeTaskLists(
        Array.isArray(next.sealedNotes) ? next.sealedNotes
          : (Array.isArray(next.sealed) ? next.sealed : []),
        sealedSalvage
      );
    }

    var seedSalvage = salvageArrayObjects(rawText, ['tomorrowSeeds', 'tomorrow'], function (p) {
      var t = trim(p.text || p.title || p.content);
      return t ? ('seed:' + t.slice(0, 48)) : '';
    });
    if (seedSalvage.length) {
      next.tomorrowSeeds = mergeTaskLists(
        Array.isArray(next.tomorrowSeeds) ? next.tomorrowSeeds
          : (Array.isArray(next.tomorrow) ? next.tomorrow : []),
        seedSalvage
      );
    }

    return next;
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；待办须贴合此关系与互动节奏。'
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
    var seed = trim(contact.name) + ' 待办 日程 任务 计划 琐事 约定 仪式 心事';
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
      '以下为与该角色的近期私聊，生成待办时可参考其中的约定、心事、行程、压力与互动线索，但不必逐条复述。',
      lines.join('\n')
    ].join('\n');
  }

  function buildTodoContext(contactId) {
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
      return new Error('网络中断，待办内容较长容易断连，请再试一次');
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
      max_tokens: TODO_MAX_TOKENS
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

  function buildSystemPrompt(charName) {
    return (
      '你是「' + charName + '」私人手机里「待办·案件档案」App 的策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机里这一份今日待办卷宗会写下什么——一切从角色第一人称视角出发：这是 ta 的手机，不是用户的待办。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：' +
      '{"dateLabel":"7月15日 周三","caseNo":"TD-0715-A3","hero":{"greeting":"角色口吻招呼","mood":"今日心情一句话","loadLevel":68,"loadLabel":"偏满","focus":"今日主线一句话"},' +
      '"summary":"80-140字综述今日局面与心绪",' +
      '"columns":[{"id":"must","title":"今日必办","kicker":"MUST","tone":"ice","tasks":[]},' +
      '{"id":"soft","title":"若有余力","kicker":"SOFT","tone":"mist","tasks":[]},' +
      '{"id":"secret","title":"私密纸条","kicker":"SECRET","tone":"ink","tasks":[]}],' +
      '"tasks":[{"id":"t1","title":"事项标题","when":"09:40–10:20","where":"地点或情境","priority":"urgent|soft|later|secret|wish|routine","status":"open","energy":"高|中|低","tags":["标签"],"detail":"60-120字展开","privateNote":"20-50字翻面私语","subtasks":[{"text":"子步骤","done":false}],"relatedToUser":true,"userWhisper":"对对方想说的半句（可空）","stamp":"OPEN|CONFIDENTIAL|HEALING|URGENT","style":"clip|tape|pinned|fold|wide|narrow|offset-r|offset-l|stamp|ribbon","section":"must"}],' +
      '"rituals":[{"title":"固定仪式名","cadence":"每日/每周…","note":"30-60字","pinned":true}],' +
      '"inboxSparks":[{"text":"脑内闪念","mood":"轻/酸/暖"}],' +
      '"sealedNotes":[{"title":"密封笺标题","content":"80-160字密封心事","seal":"SEALED"}],' +
      '"tomorrowSeeds":[{"text":"留给明天的一粒种子"}],' +
      '"footerNote":"40-80字角色碎碎念收尾"}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部字段与条目，禁止偷懒、禁止半截、禁止只写几条就结束；每条字符串必须写完，禁止用省略号敷衍正文。' +
      '硬性数量（缺一项都算失败）：tasks 必须恰好 10–14 条且全部写满；columns 必须恰好 3 组且组内 tasks 可与顶层 tasks 对应引用（section 对齐），但顶层 tasks 仍须完整列出 10–14 条；' +
      'rituals 必须恰好 3 条；inboxSparks 必须恰好 5 条；sealedNotes 必须恰好 2 条；tomorrowSeeds 必须恰好 3 条；' +
      'priority 只能用：' + PRIORITIES.join('/') + '；style 尽量多样，从 ' + TASK_STYLES.join('、') + ' 中轮换；' +
      '至少 3 条 relatedToUser=true 且配 userWhisper；至少 2 条 priority=secret；至少 4 条带 subtasks（每条 2–4 个子步骤）；' +
      'detail/privateNote/sealedNotes.content/summary 必须具体贴合人设与聊天线索，禁止模板空话；' +
      '输出前自检：tasks 数量∈[10,14]、rituals.length===3、inboxSparks.length===5、sealedNotes.length===2、tomorrowSeeds.length===3，JSON 必须以 } 完整闭合；' +
      '禁止提及 AI、系统、提示词、JSON、卷宗生成等幕后词。'
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·必读】',
      ctx.contextText,
      '',
      '【生成任务 · ' + charName + ' 的手机 · 待办卷宗 · 必须完整一次写完】',
      '为角色「' + charName + '」一次性生成 ta 私人待办 App 的完整「今日案件档案」，面向与 ta 有关系的「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【内容方向 · 要丰富、要可互动感】',
      '- 不要普通待办清单：写成带时间窗、地点氛围、能量消耗、标签、子步骤、密封心事、与「' + profileName + '」相关的半句私语。',
      '- 可含：必须办完的现实琐事、心里想却不好意思说的事、想给对方制造的小小惊喜、自我疗愈仪式、逃避清单、想忘掉又划不掉的念头。',
      '- 语气必须是「' + charName + '」本人在手机里随手整理的语气。',
      '【强制完整 · 写满再结束】',
      '- tasks 10–14 条，全部写满 detail/privateNote/tags；至少 4 条有 subtasks；至少 3 条 relatedToUser；至少 2 条 secret',
      '- columns 3 组 + rituals 3 + inboxSparks 5 + sealedNotes 2 + tomorrowSeeds 3 + hero/summary/footerNote/caseNo',
      '- 只输出一个完整 JSON（从 { 到 }）；禁止半截；禁止少写'
    ].join('\n');
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      dateLabel: '',
      caseNo: '',
      hero: { greeting: '', mood: '', loadLevel: 0, loadLabel: '', focus: '' },
      summary: raw,
      columns: [],
      tasks: [{
        id: 'td-raw',
        title: '原始返回',
        when: '',
        where: '',
        priority: 'soft',
        status: 'open',
        energy: '',
        tags: [],
        detail: raw,
        privateNote: '',
        subtasks: [],
        relatedToUser: false,
        userWhisper: '',
        stamp: '',
        style: 'wide',
        section: ''
      }],
      rituals: [],
      inboxSparks: [],
      sealedNotes: [],
      tomorrowSeeds: [],
      footerNote: ''
    };
  }

  function hasTodoContent(norm) {
    return !!(norm && (
      (norm.tasks && norm.tasks.length) ||
      (norm.columns && norm.columns.length) ||
      (norm.rituals && norm.rituals.length) ||
      (norm.inboxSparks && norm.inboxSparks.length) ||
      (norm.sealedNotes && norm.sealedNotes.length) ||
      (norm.tomorrowSeeds && norm.tomorrowSeeds.length) ||
      trim(norm.summary) ||
      trim(norm.footerNote)
    ));
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    // 即使整包半截，也尽量捞回 tasks/rituals 等（不二次请求）
    obj = salvageIntoTodoObj(rawText, obj);
    obj = unwrapTodoRoot(obj);
    var store = global.miyaDeepTodoStore;

    if (obj && typeof obj === 'object') {
      if (store && typeof store.normalizeTodoPayload === 'function') {
        var norm = store.normalizeTodoPayload(obj);
        if (hasTodoContent(norm)) return norm;
      }
    }

    // 解析失败：原样展示模型返回内容，绝不因「不足」再请求
    return buildRawFallback(rawText);
  }

  function generateTodo(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildTodoContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的待办数据' });
    }

    // 单次请求：禁止不足重试 / 补齐第二轮
    return callPhoneApi(
      buildSystemPrompt(charName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: TODO_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepTodoBridge = {
    buildTodoContext: buildTodoContext,
    generateTodo: generateTodo,
    TASK_STYLES: TASK_STYLES,
    PRIORITIES: PRIORITIES
  };
})(typeof window !== 'undefined' ? window : global);
