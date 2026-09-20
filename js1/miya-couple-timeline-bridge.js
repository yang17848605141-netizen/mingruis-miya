/**
 * miya-couple-timeline-bridge.js — 时光轴 · AI 回响 / 双视角 / 扭蛋
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 4000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
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
      var bracePositions = [];
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) === '}') bracePositions.push(c);
      }
      var maxBraceTries = 24;
      for (c = 0; c < bracePositions.length && c < maxBraceTries; c++) {
        var pos = bracePositions[c];
        candidates.push(t.slice(i, pos + 1));
        candidates.push(repairJsonClosure(t.slice(i, pos + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, pos + 1))));
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

  function unescapeJsonString(text) {
    return String(text || '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  function extractJsonStringField(text, key) {
    var re = new RegExp('"' + key + '"\\s*:\\s*"', 'i');
    var m = String(text || '').match(re);
    if (!m) return '';
    var i = m.index + m[0].length;
    var out = '';
    var esc = false;
    for (; i < text.length; i++) {
      var ch = text.charAt(i);
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        break;
      } else {
        out += ch;
      }
    }
    return unescapeJsonString(out).trim();
  }

  function normalizeLetterText(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var pass;
    for (pass = 0; pass < 3; pass++) {
      var prev = t;
      t = unescapeJsonString(t);
      if (t === prev) break;
    }
    return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  function parseCharLetterPlain(text) {
    var t = stripThinkingNoise(String(text || '')).trim();
    if (!t) return null;
    var fence = t.match(/```[\s\S]*?\n([\s\S]*?)```/);
    if (fence) t = fence[1].trim();

    var m = t.match(/TITLE:\s*(.+?)\r?\n---\r?\n([\s\S]+?)\r?\n---\s*$/i);
    if (!m) m = t.match(/TITLE:\s*(.+?)\r?\n---\r?\n([\s\S]+)/i);
    if (m) {
      var body = m[2].replace(/\r?\n---\s*$/, '').trim();
      if (body) {
        return {
          title: trim(m[1]) || '来自 TA 的信',
          body: normalizeLetterText(body),
          mood: '',
          location: ''
        };
      }
    }

    m = t.match(/标题[:：]\s*(.+?)\r?\n([\s\S]+)/);
    if (m && m[2].length >= 20) {
      return {
        title: trim(m[1]) || '来自 TA 的信',
        body: normalizeLetterText(m[2]),
        mood: '',
        location: ''
      };
    }
    return null;
  }

  function extractLineField(block, keys) {
    var list = Array.isArray(keys) ? keys : [keys];
    var i;
    for (i = 0; i < list.length; i++) {
      var re = new RegExp('^\\s*' + list[i] + '[:：]\\s*(.+?)\\s*$', 'im');
      var m = String(block || '').match(re);
      if (m) return trim(m[1]);
    }
    return '';
  }

  function parseGachaBlock(block) {
    if (!trim(block)) return null;
    var title = extractLineField(block, ['TITLE', '标题']);
    var dateIso = extractLineField(block, ['DATE', '日期']);
    var mood = extractLineField(block, ['MOOD', '心情']);
    var location = extractLineField(block, ['LOCATION', '地点']);
    var body = '';
    var bm = block.match(/---\s*\r?\n([\s\S]+?)\r?\n---/);
    if (bm) {
      body = normalizeLetterText(bm[1]);
    } else {
      var lines = block.split(/\r?\n/);
      var bodyLines = [];
      var li;
      for (li = 0; li < lines.length; li++) {
        var line = lines[li];
        if (/^---\s*$/.test(line)) continue;
        if (/^(TITLE|DATE|MOOD|LOCATION|标题|日期|心情|地点)[:：]/i.test(line)) continue;
        if (/^#\s*\d+\s*$/.test(line)) continue;
        if (/^(ITEM|CAPSULE|扭蛋)\s*\d+\s*$/i.test(line)) continue;
        bodyLines.push(line);
      }
      body = normalizeLetterText(bodyLines.join('\n'));
    }
    if (!title && !body) return null;
    return {
      title: title || '小记忆',
      body: body,
      dateIso: dateIso,
      mood: mood,
      location: location
    };
  }

  function parseGachaPlain(text) {
    var t = stripThinkingNoise(String(text || '')).trim();
    if (!t) return null;
    var fence = t.match(/```[\s\S]*?\n([\s\S]*?)```/);
    if (fence) t = fence[1].trim();

    var items = [];
    var blockRe = /(?:^|\n)(?:#\s*(\d+)|(?:ITEM|CAPSULE|扭蛋)\s*(\d+))\s*\r?\n([\s\S]*?)(?=\n(?:#\s*\d+|(?:ITEM|CAPSULE|扭蛋)\s*\d+)\s*\r?\n|$)/gi;
    var m;
    while ((m = blockRe.exec(t)) !== null) {
      var item = parseGachaBlock(m[3]);
      if (item) items.push(item);
    }

    if (items.length < 7) {
      var parts = t.split(/\r?\n(?=#\s*\d+\s*(?:\r?\n|$))/);
      if (parts.length >= 7) {
        items = [];
        var pi;
        for (pi = 0; pi < parts.length; pi++) {
          var chunk = parts[pi].replace(/^#\s*\d+\s*\r?\n?/, '');
          var parsed = parseGachaBlock(chunk);
          if (parsed) items.push(parsed);
        }
      }
    }

    return items.length ? items : null;
  }

  function parseWeeklyGachaFromApi(text) {
    var cleaned = stripThinkingNoise(extractApiText(text));
    if (!cleaned) throw new Error('生成内容无效');

    var plain = parseGachaPlain(cleaned);
    if (plain && plain.length >= 7) {
      return plain.slice(0, 7);
    }

    var obj = tryParseJson(cleaned);
    if (obj && Array.isArray(obj.capsules) && obj.capsules.length >= 7) {
      var out = [];
      var i;
      for (i = 0; i < 7; i++) {
        var item = obj.capsules[i] || {};
        out.push({
          title: trim(item.title) || '小记忆',
          body: normalizeLetterText(item.body || item.content || item.text || ''),
          dateIso: trim(item.dateIso || item.date || ''),
          mood: trim(item.mood || ''),
          location: trim(item.location || '')
        });
      }
      return out;
    }

    if (plain && plain.length > 0) {
      throw new Error('生成条数不足（' + plain.length + '/7），请重试');
    }
    throw new Error('生成内容无效，请重试');
  }

  function extractLetterFieldsLoose(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    if (i >= 0) t = t.slice(i);

    var title = extractJsonStringField(t, 'title')
      || extractJsonStringField(t, 'subject')
      || extractJsonStringField(t, 'heading');
    var body = extractJsonStringField(t, 'body')
      || extractJsonStringField(t, 'content')
      || extractJsonStringField(t, 'letter')
      || extractJsonStringField(t, 'text');
    var mood = extractJsonStringField(t, 'mood') || extractJsonStringField(t, 'emotion');
    var location = extractJsonStringField(t, 'location');

    if (!body) {
      var bodyMatch = t.match(/"(?:body|content|letter|text)"\s*:\s*"([\s\S]*)$/i);
      if (bodyMatch) {
        body = unescapeJsonString(
          bodyMatch[1]
            .replace(/"\s*,\s*"(?:title|mood|emotion|location)"[\s\S]*$/, '')
            .replace(/"\s*}\s*$/, '')
        ).trim();
      }
    }

    if (!title && !body) return null;
    return {
      title: title || '来自 TA 的信',
      body: normalizeLetterText(body),
      mood: mood,
      location: location
    };
  }

  function parseCharLetterFromApi(text) {
    var cleaned = stripThinkingNoise(extractApiText(text));
    if (!cleaned) throw new Error('生成内容无效');

    var plain = parseCharLetterPlain(cleaned);
    if (plain && plain.body) return plain;

    var obj = tryParseJson(cleaned);
    if (obj && typeof obj === 'object') {
      var title = trim(obj.title || obj.subject || obj.heading || '');
      var body = normalizeLetterText(obj.body || obj.content || obj.letter || obj.text || '');
      var mood = trim(obj.mood || obj.emotion || '');
      var location = trim(obj.location || '');
      if (!title && body) title = '来自 TA 的信';
      if (title || body) {
        return {
          title: title || '来自 TA 的信',
          body: body,
          mood: mood,
          location: location
        };
      }
    }

    var loose = extractLetterFieldsLoose(cleaned);
    if (loose && (loose.title || loose.body)) return loose;

    if (cleaned.indexOf('{') < 0 && cleaned.length >= 8) {
      return {
        title: '来自 TA 的信',
        body: normalizeLetterText(cleaned),
        mood: '',
        location: ''
      };
    }

    throw new Error('生成内容无效');
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    reqOpts = reqOpts && typeof reqOpts === 'object' ? reqOpts : {};
    var opts = Object.assign({
      skipUniversalWorldbook: true,
      skipLengthCheck: true,
      useEngineExtract: true,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      timeoutMs: 180000
    }, reqOpts);
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, null, opts).catch(function (err) {
        if (br && typeof br.callMainChatCompletionsRaw === 'function') {
          return br.callMainChatCompletionsRaw(systemHint, userContent, null, Object.assign({}, opts, { stream: false }));
        }
        throw err;
      });
    }
    if (br && typeof br.callMainChatCompletionsRaw === 'function') {
      return br.callMainChatCompletionsRaw(systemHint, userContent, null, Object.assign({}, opts, { stream: false }));
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function resolveContactContext(contactId) {
    var cs = global.miyaChatStore;
    var cpStore = global.miyaCoupleStore;
    if (!cs || !cpStore) return null;
    var sp = cpStore.getSpace(contactId);
    var contact = cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
    if (!contact) return null;
    var profileId = sp && sp.profileId ? sp.profileId : '';
    var profile = null;
    if (profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === profileId; }) || null;
    }
    if (!profile && cs.getActiveProfile) profile = cs.getActiveProfile();
    var chat = null;
    if (cs.getChats) {
      var chats = cs.getChats() || [];
      chat = chats.find(function (c) {
        return c && (c.contactId === contactId || c.id === contactId);
      }) || null;
    }
    var settings = {};
    if (cs.getContactSettings && contact.id) {
      settings = cs.getContactSettings(contact.id) || {};
    }
    return { contact: contact, profile: profile, settings: settings, chat: chat, space: sp };
  }

  function buildCharacterBlock(contact) {
    var parts = [];
    if (contact.name) parts.push('角色名：' + trim(contact.name));
    if (contact.persona) parts.push('人设：' + truncateStr(contact.persona, 1200));
    if (contact.description) parts.push('描述：' + truncateStr(contact.description, 800));
    return parts.join('\n');
  }

  function buildChatSnippet(contact, profile, settings, chat, limit) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var lim = limit || 30;
    var profileName = profile && profile.name ? profile.name : '用户';
    var msgs = (cs.getMessages(chat.id) || [])
      .filter(function (m) { return m && !m.deleted && trim(m.content); })
      .slice(-lim);
    if (!msgs.length) return '';
    return msgs.map(function (m) {
      var body = trim(m.content);
      if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
        body = global.miyaChatEngine.stripThinkingForApi(body);
      }
      var who = m.role === 'user' ? profileName : trim(contact.name || '角色');
      return who + '：' + truncateStr(body, 280);
    }).join('\n');
  }

  function buildCheckInSnippet(contactId) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !cpStore.getCheckIns) return '';
    var list = cpStore.getCheckIns(contactId).slice(-8);
    if (!list.length) return '';
    return list.map(function (ci) {
      return (ci.dateIso || '') + ' ' + (ci.slotLabel || ci.slot || '') + '：' +
        truncateStr(ci.caption || ci.detail, 120);
    }).join('\n');
  }

  function buildContextBlock(contactId) {
    var ctx = resolveContactContext(contactId);
    if (!ctx) return '';
    var parts = [
      '【当前时间】' + new Date().toLocaleString('zh-CN', { hour12: false }),
      buildCharacterBlock(ctx.contact)
    ];
    var chatSnip = buildChatSnippet(ctx.contact, ctx.profile, ctx.settings, ctx.chat, 35);
    if (chatSnip) parts.push('【近期聊天】\n' + chatSnip);
    var ciSnip = buildCheckInSnippet(contactId);
    if (ciSnip) parts.push('【近期打卡】\n' + ciSnip);
    if (ctx.space) {
      parts.push('【在一起】自 ' + (ctx.space.annivDate || '') + '，已 ' +
        (global.miyaCoupleStore.daysTogether(ctx.space.annivDate) || 0) + ' 天');
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function extractApiText(res) {
    if (!res) return '';
    if (typeof res === 'string') return res;
    if (res.content) return String(res.content);
    if (res.text) return String(res.text);
    if (res.choices && res.choices[0]) {
      var ch = res.choices[0];
      if (ch.message && ch.message.content) return String(ch.message.content);
      if (ch.text) return String(ch.text);
    }
    return '';
  }

  function generateCharEcho(contactId, entry) {
    if (!entry || entry.author === 'char') return Promise.resolve('');
    var ctx = resolveContactContext(contactId);
    if (!ctx) return Promise.resolve('');
    var charName = trim(ctx.contact.name) || '角色';
    var profileName = ctx.profile && ctx.profile.name ? ctx.profile.name : '用户';
    var system = [
      '你是「' + charName + '」，正在情侣空间的时光轴上，对用户写下的一条记忆做出温柔回响。',
      '只输出 JSON：{"echo":"一句简短回响，20-60字，口语化、有陪伴感，像便签贴在卡片背面"}',
      '不要复述用户原文，要表达你的感受或补充细节。'
    ].join('\n');
    var user = [
      buildContextBlock(contactId),
      '【用户写的时光轴】',
      '日期：' + (entry.dateIso || ''),
      '标题：' + (entry.title || ''),
      '内容：' + (entry.body || ''),
      '用户称呼：' + profileName
    ].join('\n\n');
    return callApi(system, user, {
      temperature: 0.88,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true
    }).then(function (res) {
      var parsed = tryParseJson(extractApiText(res));
      if (parsed && parsed.echo) return trim(parsed.echo);
      var raw = trim(extractApiText(res));
      return raw.length > 80 ? raw.slice(0, 80) : raw;
    }).catch(function () { return ''; });
  }

  function generateDualPerspective(contactId, entry) {
    if (!entry) return Promise.resolve('');
    var ctx = resolveContactContext(contactId);
    if (!ctx) return Promise.resolve('');
    var charName = trim(ctx.contact.name) || '角色';
    var system = [
      '你是「' + charName + '」。用户对同一件事写了 TA 的视角，请写「你的视角」——同一场景、不同感受。',
      '只输出 JSON：{"perspective":"40-100字，第一人称，细腻、有画面感，不要重复用户原文"}'
    ].join('\n');
    var user = [
      buildContextBlock(contactId),
      '【用户视角】',
      '标题：' + (entry.title || ''),
      '内容：' + (entry.body || ''),
      '日期：' + (entry.dateIso || '')
    ].join('\n\n');
    return callApi(system, user, {
      temperature: 0.9,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true
    }).then(function (res) {
      var parsed = tryParseJson(extractApiText(res));
      if (parsed && parsed.perspective) return trim(parsed.perspective);
      return trim(extractApiText(res));
    }).catch(function () { return ''; });
  }

  function requestGachaApi(system, user, attempt) {
    return callApi(system, user, {
      temperature: attempt > 1 ? 0.88 : 0.92,
      max_tokens: 8192,
      stream: false,
      timeoutMs: 240000,
      preferJsonPayload: false,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true,
      skipLengthCheck: true
    });
  }

  function generateWeeklyGacha(contactId) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !cpStore.canRunWeeklyGacha(contactId)) {
      return Promise.reject(new Error('本周已扭过'));
    }
    var ctx = resolveContactContext(contactId);
    if (!ctx) return Promise.reject(new Error('上下文未就绪'));
    var charName = trim(ctx.contact.name) || '角色';
    var profileName = ctx.profile && ctx.profile.name ? ctx.profile.name : '用户';
    var week = cpStore.isoWeekKey();
    var GACHA_COLORS = ['rose', 'sky', 'gold', 'mint', 'lavender', 'coral', 'lemon'];
    var system = [
      '你是「' + charName + '」。从近期聊天与打卡中，挖掘七条值得铭记的小事，写成时光轴扭蛋。',
      '七条主题不可重复，贴合人设；素材不足可写温馨日常想象。',
      '严格按下面格式输出 7 条，不要 markdown、不要 JSON、不要多余说明：',
      '',
      '#1',
      'TITLE: 标题',
      'DATE: YYYY-MM-DD',
      '---',
      '正文',
      '---',
      '',
      '#2',
      '...（共 7 条）'
    ].join('\n');
    var user = buildContextBlock(contactId) + '\n\n用户称呼：' + profileName;

    function saveCapsules(capsules) {
      var today = cpStore.isoToday ? cpStore.isoToday() : '';
      var items = [];
      var i;
      for (i = 0; i < 7; i++) {
        var item = capsules[i] || {};
        if (!trim(item.title) && !trim(item.body)) {
          return Promise.reject(new Error('生成内容无效'));
        }
        items.push({
          title: trim(item.title) || '小记忆',
          body: normalizeLetterText(item.body || ''),
          dateIso: trim(item.dateIso) || today,
          mood: trim(item.mood || ''),
          location: trim(item.location || ''),
          gachaColor: GACHA_COLORS[i],
          gachaIndex: i
        });
      }
      var entry = cpStore.addTimelineEntry(contactId, {
        type: 'gacha',
        author: 'char',
        dateIso: today,
        title: '本周七色胶囊',
        body: '',
        gachaWeek: week,
        meta: {
          source: 'weekly_gacha',
          week: week,
          gachaBatch: week,
          isBatch: true,
          capsules: items
        }
      });
      if (!entry) return Promise.reject(new Error('保存失败'));
      cpStore.markWeeklyGachaDone(contactId);
      return [entry];
    }

    function attemptGenerate(tryNo) {
      return requestGachaApi(system, user, tryNo).then(function (res) {
        var capsules = parseWeeklyGachaFromApi(res);
        return saveCapsules(capsules);
      }).catch(function (err) {
        if (tryNo < 2) return attemptGenerate(tryNo + 1);
        throw err;
      });
    }

    return attemptGenerate(1);
  }

  function createUserCommemoration(contactId, payload) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储未就绪'));

    var data = payload && typeof payload === 'object' ? payload : {};
    var dateIso = trim(data.dateIso) || (cpStore.isoToday ? cpStore.isoToday() : '');
    var entry = cpStore.addTimelineEntry(contactId, {
      type: 'commemoration',
      author: 'user',
      dateIso: dateIso,
      title: trim(data.title),
      body: trim(data.body),
      mood: trim(data.mood),
      location: trim(data.location),
      meta: { source: 'user_commemoration' }
    });
    if (!entry) return Promise.reject(new Error('保存失败'));
    return Promise.resolve(entry);
  }

  function createUserMemory(contactId, payload, files) {
    var cpStore = global.miyaCoupleStore;
    var cs = global.miyaChatStore;
    if (!cpStore) return Promise.reject(new Error('存储未就绪'));

    var data = payload && typeof payload === 'object' ? payload : {};
    var isSealed = !!data.sealed;
    var dateIso = trim(data.dateIso) || (cpStore.isoToday ? cpStore.isoToday() : '');
    var today = cpStore.isoToday ? cpStore.isoToday() : '';
    if (isSealed && dateIso <= today) {
      return Promise.reject(new Error('未拆的信须选择未来日期'));
    }

    function afterSave(entry) {
      var chain = Promise.resolve(entry);
      if (data.requestEcho !== false && entry.author === 'user' && entry.type === 'memory') {
        chain = chain.then(function (e) {
          return generateCharEcho(contactId, e).then(function (echo) {
            if (echo) {
              return cpStore.updateTimelineEntry(contactId, e.id, { charEcho: echo }) || e;
            }
            return e;
          });
        });
      }
      if (data.dualPerspective && entry.type === 'memory') {
        chain = chain.then(function (e) {
          return generateDualPerspective(contactId, e).then(function (persp) {
            if (persp) {
              return cpStore.updateTimelineEntry(contactId, e.id, {
                charPerspective: persp,
                dualPerspective: true
              }) || e;
            }
            return e;
          });
        });
      }
      return chain;
    }

    function saveWithBlob(blobId) {
      var entry = cpStore.addTimelineEntry(contactId, {
        type: isSealed ? 'sealed' : 'memory',
        author: 'user',
        dateIso: dateIso,
        title: trim(data.title),
        body: trim(data.body),
        mood: trim(data.mood),
        location: trim(data.location),
        blobId: blobId || '',
        sealed: isSealed,
        dualPerspective: !!data.dualPerspective,
        meta: isSealed ? { sealedLetter: true, letter: true } : {}
      });
      if (!entry) return Promise.reject(new Error('保存失败'));
      return afterSave(entry);
    }

    var fileList = Array.isArray(files) ? files : (files ? [files] : []);
    var file = fileList[0];
    if (!file) return saveWithBlob('');

    if (!cs || typeof cs.storeMediaBlob !== 'function') {
      return saveWithBlob('');
    }
    return cs.storeMediaBlob(file, 'chat').then(function (blobId) {
      return saveWithBlob(blobId);
    }).catch(function () {
      return saveWithBlob('');
    });
  }

  function saveCharLetterEntry(cpStore, contactId, parsed, isSealed, dateIso) {
    return cpStore.addTimelineEntry(contactId, {
      type: isSealed ? 'sealed' : 'letter',
      author: 'char',
      dateIso: dateIso,
      title: parsed.title,
      body: parsed.body,
      mood: parsed.mood,
      location: parsed.location,
      sealed: isSealed,
      meta: { letter: true, charLetter: true, source: 'char_letter' }
    });
  }

  function requestCharLetterApi(system, user, attempt) {
    return callApi(system, user, {
      temperature: attempt > 1 ? 0.85 : 0.9,
      max_tokens: 4096,
      stream: false,
      timeoutMs: 240000,
      preferJsonPayload: false,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true
    });
  }

  function generateCharLetter(contactId, opts) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储未就绪'));
    opts = opts && typeof opts === 'object' ? opts : {};
    var ctx = resolveContactContext(contactId);
    if (!ctx) return Promise.reject(new Error('上下文未就绪'));
    var charName = trim(ctx.contact.name) || '角色';
    var profileName = ctx.profile && ctx.profile.name ? ctx.profile.name : '用户';
    var isSealed = !!opts.sealed;
    var dateIso = trim(opts.dateIso) || (cpStore.isoToday ? cpStore.isoToday() : '');
    var today = cpStore.isoToday ? cpStore.isoToday() : '';
    if (isSealed) {
      if (!dateIso || dateIso <= today) {
        return Promise.reject(new Error('封存来信须选择未来日期'));
      }
    } else {
      dateIso = today;
    }
    var system = [
      '你是「' + charName + '」。给「' + profileName + '」写一封亲笔信，第一人称，贴合人设，具体有画面感。',
      isSealed ? '封存给未来，落款可暗示到那天再拆。' : '现在就送达，落款要有署名。',
      '严格按下面格式输出，不要 markdown、不要 JSON、不要多余说明：',
      'TITLE: 标题',
      '---',
      '正文。段落之间空一行。',
      '---'
    ].join('\n');
    var user = buildContextBlock(contactId) + '\n\n收信人：' + profileName;

    function attemptGenerate(tryNo) {
      return requestCharLetterApi(system, user, tryNo).then(function (res) {
        var parsed = parseCharLetterFromApi(res);
        var entry = saveCharLetterEntry(cpStore, contactId, parsed, isSealed, dateIso);
        if (!entry) return Promise.reject(new Error('保存失败'));
        return entry;
      }).catch(function (err) {
        if (tryNo < 2) return attemptGenerate(tryNo + 1);
        throw err;
      });
    }

    return attemptGenerate(1);
  }

  function enrichEntry(contactId, entryId, opts) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储未就绪'));
    var entry = cpStore.findTimelineEntry(contactId, entryId);
    if (!entry) return Promise.reject(new Error('条目不存在'));
    opts = opts && typeof opts === 'object' ? opts : {};
    var chain = Promise.resolve(entry);
    if (opts.echo && !entry.charEcho) {
      chain = chain.then(function (e) {
        return generateCharEcho(contactId, e).then(function (echo) {
          if (echo) return cpStore.updateTimelineEntry(contactId, e.id, { charEcho: echo }) || e;
          return e;
        });
      });
    }
    if (opts.dual && !entry.charPerspective) {
      chain = chain.then(function (e) {
        return generateDualPerspective(contactId, e).then(function (persp) {
          if (persp) {
            return cpStore.updateTimelineEntry(contactId, e.id, {
              charPerspective: persp,
              dualPerspective: true
            }) || e;
          }
          return e;
        });
      });
    }
    return chain;
  }

  global.miyaCoupleTimelineBridge = {
    generateCharEcho: generateCharEcho,
    generateDualPerspective: generateDualPerspective,
    generateWeeklyGacha: generateWeeklyGacha,
    generateCharLetter: generateCharLetter,
    createUserMemory: createUserMemory,
    createUserCommemoration: createUserCommemoration,
    enrichEntry: enrichEntry,
    buildContextBlock: buildContextBlock
  };
})(typeof window !== 'undefined' ? window : global);
