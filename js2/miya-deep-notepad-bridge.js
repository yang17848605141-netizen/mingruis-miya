/**
 * miya-deep-notepad-bridge.js — 深入 · 角色手机 记事本 API 生成
 */
(function (global) {
  'use strict';

  var NOTEPAD_MAX_TOKENS = 16384;

  var STYLE_VARIANTS = [
    'classic', 'tape-left', 'numbered', 'strikethrough', 'wide',
    'narrow-tall', 'dashed', 'pinned', 'offset-right', 'offset-left'
  ];

  function trim(s) { return String(s || '').trim(); }

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
      '以下是与该角色私聊时绑定的用户身份及双方关系；记事本须贴合此关系。'
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
    var seed = trim(contact.name) + ' 记事本 手帐 日记 碎片 心事';
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
      '以下为与该角色的近期私聊，生成记事本时可参考其中的情绪、话题与关系动态，但不必逐条提及。',
      lines.join('\n')
    ].join('\n');
  }

  function buildNotepadContext(contactId) {
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
    var text = '';
    if (eng && typeof eng.extractReplyContent === 'function') {
      text = eng.extractReplyContent(j);
    } else {
      var choice = j && j.choices && j.choices[0];
      var msg = choice && choice.message;
      var raw = msg && msg.content;
      if (typeof raw === 'string') text = raw.trim();
      else if (Array.isArray(raw)) {
        text = raw.map(function (p) {
          if (!p) return '';
          if (typeof p === 'string') return p;
          return p.text ? String(p.text) : (p.content ? String(p.content) : '');
        }).join('').trim();
      }
    }
    if (!text && j && j.choices && j.choices[0]) {
      var m = j.choices[0].message || {};
      if (m.reasoning_content) text = String(m.reasoning_content).trim();
      else if (m.reasoning) text = String(m.reasoning).trim();
    }
    if (eng && typeof eng.stripThinkingForApi === 'function') {
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
      timeoutMs: 120000,
      max_tokens: NOTEPAD_MAX_TOKENS
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

    var timeoutMs = Number(reqOpts.timeoutMs) || 120000;
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

  function buildSystemPrompt(charName) {
    return (
      '你是「' + charName + '」私人手帐记事本的策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 会在手机里写下怎样的私人碎片笔记。' +
      '一切从角色第一人称视角出发——这是 ta 的手机，笔记是 ta 的心事、备忘、随想。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：{"notes":[{"datetime":"2026-03-15 23:41","timeLabel":"深夜","content":"正文","strikethrough":"划掉的内容（可空）","number":"③（可空）","style":"classic","tag":"碎片（可空）"}]}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部 10 条 notes，禁止只写几条就结束、禁止半截 JSON。' +
      '硬性数量：notes 必须恰好 10 条（不得少于 10）；每条 content 30–80 字（中文），每条都写完不截断；' +
      '10 条须分布在不同时间（近两周内），每条内容各不相同；' +
      'style 从以下选一：' + STYLE_VARIANTS.join('、') + '，10 条各不相同；' +
      '约 3–4 条可有 strikethrough；约 2–3 条可有 number（如 ①②③ 或 NO.3）；' +
      '输出前自检 notes.length===10 且 JSON 以 } 闭合；语气随意、像手帐草稿；禁止提及 AI、系统、提示词。'
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·必读】',
      ctx.contextText,
      '',
      '【生成任务 · ' + charName + ' 的手机 · 记事本 · 必须完整】',
      '为角色「' + charName + '」一次性生成 ta 私人记事本中完整 10 条碎片笔记，面向「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【强制完整】',
      '- notes 必须正好 10 条，禁止少写、禁止写到一半就停',
      '- 每条 30–80 字、不同时间、内容互不重复、第一人称',
      '- 每条 style 不同；可含划掉痕迹、序号',
      '- 只输出一个完整 JSON（从 { 到 }），写满 10 条再结束'
    ].join('\n');
  }

  function normalizeApiNote(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = trim(raw.content || raw.text || raw.body);
    if (!content) return null;
    var style = trim(raw.style || raw.variant);
    if (!style || STYLE_VARIANTS.indexOf(style) < 0) {
      style = STYLE_VARIANTS[index % STYLE_VARIANTS.length];
    }
    return {
      id: 'n-' + (index + 1),
      datetime: trim(raw.datetime || raw.time || raw.date),
      timeLabel: trim(raw.timeLabel || raw.label || raw.period),
      content: content,
      strikethrough: trim(raw.strikethrough || raw.crossed || raw.deleted),
      number: trim(raw.number || raw.no || raw.index),
      style: style,
      tag: trim(raw.tag || raw.mood || raw.category)
    };
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      notes: [{
        id: 'n-1',
        datetime: '',
        timeLabel: '',
        content: raw,
        strikethrough: '',
        number: '',
        style: 'classic',
        tag: '原始返回'
      }]
    };
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    if (!obj || typeof obj !== 'object') return buildRawFallback(rawText);
    var notes = Array.isArray(obj.notes) ? obj.notes : [];
    var norm = notes.map(normalizeApiNote).filter(Boolean);
    if (!norm.length) return buildRawFallback(rawText);
    return { notes: norm };
  }

  function generateNotepad(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildNotepadContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的记事本' });
    }

    return callPhoneApi(
      buildSystemPrompt(charName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.92, max_tokens: NOTEPAD_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepNotepadBridge = {
    buildNotepadContext: buildNotepadContext,
    generateNotepad: generateNotepad,
    STYLE_VARIANTS: STYLE_VARIANTS
  };
})(typeof window !== 'undefined' ? window : global);
