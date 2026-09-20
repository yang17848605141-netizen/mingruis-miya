/**
 * miya-deep-wechat-bridge.js — 深入 · 角色手机 微信 API 生成
 */
(function (global) {
  'use strict';

  var WECHAT_MAX_TOKENS = 32768;
  var LOADING_MSG = '正在读取他的微信';

  var STYLE_VARIANTS = [
    'lay-classic', 'lay-rail', 'lay-offset', 'lay-banner',
    'lay-loose', 'lay-compact', 'lay-peek'
  ];

  var STYLE_ALIASES = {
    line: 'lay-classic', offset: 'lay-offset', stack: 'lay-loose',
    split: 'lay-compact', tag: 'lay-banner', wide: 'lay-peek',
    narrow: 'lay-classic', classic: 'lay-classic', minimal: 'lay-compact'
  };

  function resolveStyle(raw, index) {
    var style = trim(raw);
    if (STYLE_ALIASES[style]) style = STYLE_ALIASES[style];
    if (STYLE_VARIANTS.indexOf(style) < 0) {
      style = STYLE_VARIANTS[index % STYLE_VARIANTS.length];
    }
    return style;
  }

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
      '以下是与该角色私聊时绑定的用户身份及双方关系；生成微信对话须贴合此关系。'
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
    var seed = trim(contact.name) + ' 微信 聊天 对话 关系';
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
      '以下为与该角色的近期私聊，生成微信时可参考其中的情绪、话题与关系动态，但不必逐条提及。',
      lines.join('\n')
    ].join('\n');
  }

  function buildWechatContext(contactId) {
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
      temperature: resolved.temperature != null ? resolved.temperature : 0.88,
      timeoutMs: 300000,
      max_tokens: WECHAT_MAX_TOKENS
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
      '{"conversations":[' +
      '{"id":"c1","type":"private","title":"同事小王","participants":["' + charName + '","小王"],"preview":"明天开会别忘了","lastTime":"昨天","style":"lay-classic","isFileAssistant":false,' +
      '"messages":[{"sender":"' + charName + '","content":"明天几点？","time":"09:12"},{"sender":"小王","content":"十点吧","time":"09:13"}]},' +
      '{"id":"c2","type":"group","title":"项目组","participants":["' + charName + '","小王","李姐"],"preview":"收到","lastTime":"周一","style":"lay-rail","isFileAssistant":false,' +
      '"messages":[{"sender":"李姐","content":"本周进度汇报一下","time":"14:00"},{"sender":"' + charName + '","content":"好的","time":"14:02"}]},' +
      '{"id":"c7","type":"private","title":"文件传输助手","participants":["' + charName + '","文件传输助手"],"preview":"备忘：……","lastTime":"今天","style":"lay-peek","isFileAssistant":true,' +
      '"messages":[{"sender":"' + charName + '","content":"草稿：想对你说的话……","time":"23:41"},{"sender":"' + charName + '","content":"算了先不发","time":"23:42"}]}' +
      ']}'
    );
  }

  function buildSystemPrompt(charName, userName) {
    return (
      '你是「' + charName + '」手机微信聊天记录生成器。根据角色人设、世界书、用户面具、双方关系、近期聊天，' +
      '生成 ta 手机里与他人的微信对话（不是与用户「' + userName + '」的对话）。' +
      '只输出一个 JSON 对象，不要 markdown，不要任何解释文字。' +
      '字段名必须严格使用：conversations、messages、sender、content、time、title、type、preview、lastTime、style、isFileAssistant、participants。' +
      'type 只能是 private 或 group；style 从 ' + STYLE_VARIANTS.join('、') + ' 选取。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完 7 个会话，禁止只写前几个会话或 messages 写不满就结束。' +
      '共 7 个 conversations：6 个与他人私聊/群聊（至少 1 个群聊）+ 1 个文件传输助手（isFileAssistant=true，title="文件传输助手"）。' +
      '每个对话 messages 必须写满 15-20 条（每个会话都要写够，禁止有的会话只有两三条），每条 content 15-35 字简短口语，sender 写具体人名，time 写如 "09:12" 或 "昨天"。' +
      '输出前自检 conversations.length===7 且每项 messages.length≥15 且 JSON 以 } 闭合。' +
      '禁止提及 AI。示例结构（须生成 7 个对话，每个 15-20 条 messages，此处仅展示字段格式）：' +
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
      '【任务·必须完整】为「' + charName + '」一次性生成完整微信 JSON。',
      '【强制完整】',
      '- conversations 必须正好 7 项，一项都不能少',
      '- 6 个与他人（非「' + profileName + '」）的对话 + 1 个文件传输助手',
      '- 每项 messages 必须 15-20 条（全部写满），content 简短',
      '- 用户「' + profileName + '」不得出现',
      '随机种子 ' + seed,
      '直接输出完整 JSON，从 { 开始到 } 结束；7 个会话写满再停'
    ].join('\n');
  }

  function extractConversationsArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    if (typeof obj !== 'object') return [];
    var keys = ['conversations', 'chats', 'threads', 'dialogs', 'data', 'list', 'items'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var arr = obj[keys[i]];
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return [];
  }

  function salvageConversationObjects(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    var keyRe = /"(?:conversations|chats|threads|dialogs)"\s*:\s*\[/i;
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

  function normalizeApiMessage(raw, index, mi, charName, userName) {
    var userLower = trim(userName).toLowerCase();
    if (typeof raw === 'string') {
      var line = trim(raw);
      if (!line) return null;
      var colon = line.indexOf('：');
      if (colon < 0) colon = line.indexOf(':');
      var sender = colon > 0 ? trim(line.slice(0, colon)) : charName;
      var content = colon > 0 ? trim(line.slice(colon + 1)) : line;
      if (!content) return null;
      if (userLower && sender.toLowerCase() === userLower) return null;
      return {
        id: 'm-' + (index + 1) + '-' + (mi + 1),
        sender: sender,
        content: content,
        time: ''
      };
    }
    if (!raw || typeof raw !== 'object') return null;
    var content = trim(raw.content || raw.text || raw.body || raw.message || raw.msg);
    if (!content) return null;
    var sender = trim(raw.sender || raw.name || raw.from || raw.user || raw.role);
    if (!sender || sender === 'user' || sender === 'assistant') sender = charName;
    if (userLower && sender.toLowerCase() === userLower) return null;
    return {
      id: 'm-' + (index + 1) + '-' + (mi + 1),
      sender: sender,
      content: content,
      time: trim(raw.time || raw.datetime || raw.timestamp || raw.date)
    };
  }

  function normalizeApiConversation(raw, index, charName, userName) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.label || raw.chatName || raw.contact);
    if (!title) return null;

    var isFileAssistant = !!raw.isFileAssistant || title === '文件传输助手';
    var type = trim(raw.type || raw.chatType) === 'group' ? 'group' : 'private';
    if (isFileAssistant) type = 'private';

    var participants = Array.isArray(raw.participants)
      ? raw.participants.map(function (p) { return trim(p); }).filter(Boolean)
      : Array.isArray(raw.members)
        ? raw.members.map(function (p) { return trim(p); }).filter(Boolean)
        : [];
    if (isFileAssistant) participants = [charName, '文件传输助手'];

    var userLower = trim(userName).toLowerCase();
    var messages = Array.isArray(raw.messages)
      ? raw.messages
      : Array.isArray(raw.message)
        ? raw.message
        : Array.isArray(raw.msgs)
          ? raw.msgs
          : Array.isArray(raw.chat)
            ? raw.chat
            : [];
    var normMsgs = messages.map(function (m, mi) {
      return normalizeApiMessage(m, index, mi, charName, userName);
    }).filter(Boolean);

    if (!normMsgs.length) return null;

    if (userLower && participants.some(function (p) { return trim(p).toLowerCase() === userLower; })) {
      normMsgs = normMsgs.filter(function (m) {
        return trim(m.sender).toLowerCase() !== userLower;
      });
      if (!normMsgs.length) return null;
    }

    var style = resolveStyle(raw.style || raw.variant, index);
    var preview = trim(raw.preview || raw.lastMessage || raw.summary);
    if (!preview && normMsgs.length) preview = normMsgs[normMsgs.length - 1].content;

    return {
      id: trim(raw.id) || 'c-' + (index + 1),
      type: type,
      title: title,
      participants: participants,
      preview: preview,
      lastTime: trim(raw.lastTime || raw.time || raw.datetime || raw.date),
      style: style,
      isFileAssistant: isFileAssistant,
      messages: normMsgs
    };
  }

  function buildRawFallback(rawText, charName) {
    var raw = String(rawText || '').trim();
    return [{
      id: 'c-1',
      type: 'private',
      title: '原始返回',
      participants: [charName],
      preview: raw,
      lastTime: '',
      style: 'lay-classic',
      isFileAssistant: false,
      messages: [{
        id: 'm-1-1',
        sender: charName,
        content: raw,
        time: ''
      }]
    }];
  }

  function parseApiPayload(text, charName, userName) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    var conversations = obj ? extractConversationsArray(obj) : [];
    var salvaged = salvageConversationObjects(rawText);
    if (salvaged.length) {
      var seen = Object.create(null);
      var merged = [];
      conversations.concat(salvaged).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        var key = trim(c.title || c.name || c.label) + '|' + trim(c.type);
        if (!key || seen[key]) return;
        seen[key] = true;
        merged.push(c);
      });
      conversations = merged;
    }
    var norm = conversations
      .map(function (c, i) { return normalizeApiConversation(c, i, charName, userName); })
      .filter(Boolean);
    if (!norm.length) return buildRawFallback(rawText, charName);
    return norm;
  }

  function finalizeConversations(conversations) {
    var seen = Object.create(null);
    var out = [];
    conversations.forEach(function (c) {
      var key = c.title + '|' + c.type;
      if (seen[key]) return;
      seen[key] = true;
      out.push(c);
    });
    out.forEach(function (c, i) {
      c.id = 'c-' + (i + 1);
      c.style = resolveStyle(c.style, i);
    });
    return { conversations: out };
  }

  function generateWechat(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildWechatContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var userName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) onProgress({ phase: 'api', message: LOADING_MSG });

    return callPhoneApi(
      buildSystemPrompt(charName, userName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.75, max_tokens: WECHAT_MAX_TOKENS }
    ).then(function (text) {
      var conversations = parseApiPayload(String(text || ''), charName, userName);
      return finalizeConversations(conversations);
    });
  }

  global.miyaDeepWechatBridge = {
    buildWechatContext: buildWechatContext,
    generateWechat: generateWechat,
    LOADING_MSG: LOADING_MSG,
    STYLE_VARIANTS: STYLE_VARIANTS
  };
})(typeof window !== 'undefined' ? window : global);
