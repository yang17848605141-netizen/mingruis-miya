/**
 * miya-deep-sms-bridge.js — 深入 · 角色手机 短信 API 生成
 */
(function (global) {
  'use strict';

  var SMS_MAX_TOKENS = 32768;
  var LOADING_MSG = '正在读取他的短信数据';

  var STYLE_VARIANTS = [
    'lay-rail', 'lay-offset', 'lay-wide', 'lay-narrow',
    'lay-peek', 'lay-stack', 'lay-float', 'lay-tight'
  ];

  var STYLE_ALIASES = {
    classic: 'lay-rail', offset: 'lay-offset', wide: 'lay-wide',
    narrow: 'lay-narrow', peek: 'lay-peek', stack: 'lay-stack',
    float: 'lay-float', tight: 'lay-tight', minimal: 'lay-tight'
  };

  function trim(s) { return String(s || '').trim(); }

  function resolveStyle(raw, index) {
    var style = trim(raw);
    if (STYLE_ALIASES[style]) style = STYLE_ALIASES[style];
    if (STYLE_VARIANTS.indexOf(style) < 0) {
      style = STYLE_VARIANTS[index % STYLE_VARIANTS.length];
    }
    return style;
  }

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
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
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
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) !== '}') continue;
        candidates.push(t.slice(i, c + 1));
        candidates.push(repairJsonClosure(t.slice(i, c + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, c + 1))));
      }
    }
    var seen = {};
    var n;
    for (n = 0; n < candidates.length; n++) {
      var slice = candidates[n];
      if (!slice || seen[slice]) continue;
      seen[slice] = true;
      try {
        var obj = JSON.parse(slice);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function tryParseJson(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned) return null;
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
      var direct = JSON.parse(cleaned);
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch (e0) { /* fall through */ }
    return tryParseJsonSlice(cleaned);
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；生成短信须贴合此关系。'
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
    var seed = trim(contact.name) + ' 短信 手机 通讯 关系';
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
      '以下为与该角色的近期私聊，生成短信时可参考其中的情绪、话题与关系动态，但不必逐条提及。',
      lines.join('\n')
    ].join('\n');
  }

  function buildSmsContext(contactId) {
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
      temperature: resolved.temperature != null ? resolved.temperature : 0.92,
      timeoutMs: 300000,
      max_tokens: SMS_MAX_TOKENS
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
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    });
  }

  function buildJsonExample(charName) {
    return (
      '{"threads":[' +
      '{"id":"t1","sender":"妈妈","senderLabel":"138****8821","category":"family","unread":1,"preview":"记得吃饭","lastTime":"昨天","style":"lay-rail",' +
      '"messages":[{"direction":"in","content":"周末回来吗","time":"09:12"},{"direction":"out","content":"这周忙 下周吧","time":"09:45"}]},' +
      '{"id":"t2","sender":"1069xxxx","senderLabel":"10690123","category":"verify","unread":0,"preview":"验证码382910","lastTime":"今天","style":"lay-offset",' +
      '"messages":[{"direction":"in","content":"【某银行】验证码382910，5分钟内有效","time":"14:02"}]},' +
      '{"id":"t3","sender":"贷款推广","senderLabel":"4008xxxx","category":"spam","unread":2,"preview":"额度已批","lastTime":"周一","style":"lay-wide",' +
      '"messages":[{"direction":"in","content":"恭喜您获得20万备用金额度，点击领取","time":"11:00"}]}' +
      ']}'
    );
  }

  function buildSystemPrompt(charName, userName) {
    return (
      '你是「' + charName + '」手机短信生成器。根据角色人设、世界书、用户面具、双方关系、近期聊天，' +
      '生成 ta 手机里的短信记录（不是微信！是运营商短信，短文本、口语化、碎片化）。' +
      '这是「' + charName + '」自己的手机，一切以 ta 的视角为主。' +
      '只输出一个 JSON 对象，不要 markdown，不要任何解释文字。' +
      '字段名必须严格使用：threads、messages、direction、content、time、sender、senderLabel、category、preview、lastTime、style、unread。' +
      'direction 只能是 in（别人发给 ta）或 out（ta 发出）；category 从 personal、family、work、service、verify、spam、unknown 选取；' +
      'style 从 ' + STYLE_VARIANTS.join('、') + ' 选取。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完约 20 个 threads，禁止只写前几个会话就结束。' +
      'threads 数组必须约 20 项（建议 18-22，不得明显少于 15）：每项代表一个不同来源/号码/联系人的短信会话，来源须多样化、互不重复。' +
      '每项 thread 含 1-4 条 messages；有 ta 主动发的、有别人发的、ta 可能回复也可能不回复；' +
      '须含垃圾短信、验证码、快递/银行/运营商通知、熟人私聊等混杂内容。' +
      '每条 content 8-60 字，符合短信语感；time 写如 "09:12" 或 "昨天"；sender 写联系人名或号码；senderLabel 写号码或备注。' +
      '输出前自检 threads.length≥18 且 JSON 以 } 闭合。' +
      '禁止提及 AI。用户「' + userName + '」不得作为短信往来对象出现。' +
      '示例结构（须约 20 个 threads、来源各异，此处仅展示字段格式）：' +
      buildJsonExample(charName)
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·编年史·近期聊天】',
      ctx.contextText,
      '',
      '【任务·必须完整】为「' + charName + '」一次性生成完整短信 JSON。',
      '【强制完整】',
      '- threads 必须约 20 个（至少 18），每个对应不同来源，禁止少写',
      '- 不是微信长对话，是手机短信：短、碎、随机、来源丰富',
      '- 有 ta 发出的(out)也有收到的(in)，部分 thread 只有单向一条',
      '- 混入 spam、verify、service、personal、work、family 等各类',
      '- 用户「' + profileName + '」不得出现',
      '随机种子 ' + seed,
      '直接输出完整 JSON，从 { 到 }；约 20 个线程写满再停'
    ].join('\n');
  }

  function extractThreadsArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    if (typeof obj !== 'object') return [];
    var keys = ['threads', 'conversations', 'chats', 'sms', 'messages', 'data', 'list', 'items'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var arr = obj[keys[i]];
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return [];
  }

  function salvageThreadObjects(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    var keyRe = /"(?:threads|conversations|chats|sms)"\s*:\s*\[/i;
    var keyMatch = keyRe.exec(cleaned);
    if (!keyMatch) return [];
    var arrStart = cleaned.indexOf('[', keyMatch.index);
    if (arrStart < 0) return [];

    var out = [];
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
          var slice = cleaned.slice(objStart, i + 1);
          try {
            var parsed = JSON.parse(slice);
            if (parsed && typeof parsed === 'object') out.push(parsed);
          } catch (e1) {
            try {
              var repaired = JSON.parse(repairJsonClosure(slice));
              if (repaired && typeof repaired === 'object') out.push(repaired);
            } catch (e2) { /* skip */ }
          }
          objStart = -1;
        }
        continue;
      }
      if (ch === ']' && depth === 0) break;
    }
    return out;
  }

  function normalizeApiMessage(raw, index, charName, userName) {
    if (!raw || typeof raw !== 'object') return null;
    var content = trim(raw.content || raw.text || raw.body || raw.message || raw.msg);
    if (!content) return null;
    var dir = trim(raw.direction || raw.dir || raw.type).toLowerCase();
    if (dir !== 'in' && dir !== 'out') {
      var sender = trim(raw.sender || raw.from || '');
      if (sender === charName || raw.isSelf || raw.self || raw.sent) dir = 'out';
      else dir = 'in';
    }
    return {
      id: 'm-' + (index + 1),
      direction: dir,
      content: content,
      time: trim(raw.time || raw.datetime || raw.timestamp || raw.date)
    };
  }

  function normalizeApiThread(raw, index, charName, userName) {
    if (!raw || typeof raw !== 'object') return null;
    var sender = trim(raw.sender || raw.contact || raw.name || raw.title || raw.from);
    if (!sender) return null;

    var userLower = trim(userName).toLowerCase();
    if (userLower && sender.toLowerCase() === userLower) return null;

    var messages = Array.isArray(raw.messages)
      ? raw.messages
      : Array.isArray(raw.message)
        ? raw.message
        : Array.isArray(raw.msgs)
          ? raw.msgs
          : [];
    var normMsgs = messages.map(function (m, mi) {
      return normalizeApiMessage(m, mi, charName, userName);
    }).filter(Boolean);

    if (!normMsgs.length) return null;

    var category = trim(raw.category || raw.type || 'unknown').toLowerCase();
    var validCats = ['personal', 'family', 'work', 'service', 'verify', 'spam', 'unknown'];
    if (validCats.indexOf(category) < 0) category = 'unknown';

    var preview = trim(raw.preview || raw.lastMessage || raw.summary);
    if (!preview && normMsgs.length) preview = normMsgs[normMsgs.length - 1].content;

    return {
      id: trim(raw.id) || 't-' + (index + 1),
      sender: sender,
      senderLabel: trim(raw.senderLabel || raw.phone || raw.number || raw.label),
      category: category,
      unread: Math.max(0, Number(raw.unread) || 0),
      preview: preview,
      lastTime: trim(raw.lastTime || raw.time || raw.datetime || raw.date),
      style: resolveStyle(raw.style || raw.variant, index),
      messages: normMsgs
    };
  }

  function buildRawFallback(rawText, charName) {
    var raw = String(rawText || '').trim();
    return [{
      id: 't-1',
      sender: '原始返回',
      senderLabel: '',
      category: 'unknown',
      unread: 0,
      preview: raw,
      lastTime: '',
      style: 'lay-rail',
      messages: [{
        id: 'm-1',
        direction: 'in',
        content: raw,
        time: ''
      }]
    }];
  }

  function parseApiPayload(text, charName, userName) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    var threads = obj ? extractThreadsArray(obj) : [];
    var salvaged = salvageThreadObjects(rawText);
    if (salvaged.length) {
      var seen = Object.create(null);
      var merged = [];
      threads.concat(salvaged).forEach(function (t) {
        if (!t || typeof t !== 'object') return;
        var key = trim(t.sender || t.contact || t.name) + '|' + trim(t.category);
        if (!key || seen[key]) return;
        seen[key] = true;
        merged.push(t);
      });
      threads = merged;
    }
    var norm = threads
      .map(function (t, i) { return normalizeApiThread(t, i, charName, userName); })
      .filter(Boolean);
    if (!norm.length) return buildRawFallback(rawText, charName);
    return norm;
  }

  function finalizeThreads(threads) {
    var seen = Object.create(null);
    var out = [];
    threads.forEach(function (t) {
      var key = t.sender + '|' + t.category;
      if (seen[key]) return;
      seen[key] = true;
      out.push(t);
    });
    out.forEach(function (t, i) {
      t.id = 't-' + (i + 1);
      t.style = resolveStyle(t.style, i);
      if (!t.preview && t.messages.length) {
        t.preview = t.messages[t.messages.length - 1].content;
      }
      t.messages.forEach(function (m, mi) {
        m.id = 'm-' + (i + 1) + '-' + (mi + 1);
      });
    });
    return { threads: out };
  }

  function generateSms(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildSmsContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var userName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) onProgress({ phase: 'api', message: LOADING_MSG });

    return callPhoneApi(
      buildSystemPrompt(charName, userName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.88, max_tokens: SMS_MAX_TOKENS }
    ).then(function (text) {
      var threads = parseApiPayload(String(text || ''), charName, userName);
      return finalizeThreads(threads);
    });
  }

  global.miyaDeepSmsBridge = {
    buildSmsContext: buildSmsContext,
    generateSms: generateSms,
    LOADING_MSG: LOADING_MSG,
    STYLE_VARIANTS: STYLE_VARIANTS
  };
})(typeof window !== 'undefined' ? window : global);
