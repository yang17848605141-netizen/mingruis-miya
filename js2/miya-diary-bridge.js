/**
 * miya-diary-bridge.js — 角色日记 API 生成与上下文拼装
 */
(function (global) {
  'use strict';

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    if (!t) return '';
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return t.trim();
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

  function stripTrailingJsonAfterContent(raw) {
    return String(raw || '')
      .replace(/"\s*,\s*"(?:title|mood|emotion|content|body|diary)"[\s\S]*$/, '')
      .replace(/"\s*}\s*$/, '');
  }

  /** 宽松提取 content：优先从字段值扫到文末，避免正文内未转义引号导致截断 */
  function extractContentFieldLoose(text) {
    var t = String(text || '');
    var keys = ['content', 'body', 'diary'];
    var k, m, content, strict, loose;
    for (k = 0; k < keys.length; k++) {
      strict = extractJsonStringField(t, keys[k]);
      m = t.match(new RegExp('"' + keys[k] + '"\\s*:\\s*"([\\s\\S]*)$', 'i'));
      if (!m) continue;
      loose = unescapeJsonString(stripTrailingJsonAfterContent(m[1])).trim();
      if (!loose) continue;
      if (!strict || loose.length > strict.length) return loose;
      return strict;
    }
    return '';
  }

  function extractDiaryFieldsLoose(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    if (i >= 0) t = t.slice(i);

    var title = extractJsonStringField(t, 'title');
    var mood = extractJsonStringField(t, 'mood') || extractJsonStringField(t, 'emotion');
    var content = extractContentFieldLoose(t);

    if (!content) return null;
    return {
      title: title || '今日随笔',
      mood: mood,
      content: content
    };
  }

  function normalizeDiaryText(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    if (/\\[nrt"\\]/.test(t)) t = unescapeJsonString(t);
    return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function looksLikeDiaryJson(text) {
    var t = String(text || '').trim();
    return /^\{/.test(t) && /"(?:title|content|mood)"\s*:/.test(t);
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, undefined, reqOpts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function resolveProfileForContact(contact, chat) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    var boundId = '';
    if (contact && contact.defaultProfileId) {
      boundId = String(contact.defaultProfileId).trim();
    }
    if (!boundId && chat && chat.profileId) {
      boundId = String(chat.profileId).trim();
    }
    if (boundId) {
      var found = profiles.find(function (p) { return p && p.id === boundId; });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
  }

  function resolveContactContext(contact) {
    var cs = global.miyaChatStore;
    if (!contact) {
      return { contact: null, profile: null, chat: null, settings: {} };
    }
    if (cs && typeof cs.findContact === 'function' && contact.id) {
      var fresh = cs.findContact(contact.id);
      if (fresh) contact = fresh;
    }
    if (!cs) {
      return { contact: contact, profile: null, chat: null, settings: {} };
    }
    var profileId = String(contact.defaultProfileId || '').trim();
    var chat = cs.findChatByContact
      ? cs.findChatByContact(contact.id, profileId)
      : null;
    if (!chat && cs.findChatByContact) {
      chat = cs.findChatByContact(contact.id, '');
    }
    var profile = resolveProfileForContact(contact, chat);
    var settings = {};
    if (chat && chat.id && cs.getChatSettings) {
      settings = cs.getChatSettings(chat.id) || {};
    } else {
      settings = Object.assign(
        {},
        contact.chatSettings && typeof contact.chatSettings === 'object' ? contact.chatSettings : {}
      );
      if (contact.relationship) settings.relationship = contact.relationship;
    }
    return { contact: contact, profile: profile, chat: chat, settings: settings };
  }

  function resolveRoleTz(chatSettings) {
    var aw = global.MiyaChatAwareness;
    var ta = chatSettings && chatSettings.timeAwareness;
    if (ta && ta.enabled && ta.real && ta.real.roleTz) {
      return String(ta.real.roleTz).trim();
    }
    return aw && typeof aw.localTz === 'function' ? aw.localTz() : 'Asia/Shanghai';
  }

  function isoDateForTz(ts, tz) {
    var store = global.miyaDiaryStore;
    if (store && typeof store.isoDate === 'function' && !tz) {
      return store.isoDate(new Date(ts));
    }
    var t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) t = Date.now();
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return fmt.format(new Date(t));
    } catch (e) {
      var d = new Date(t);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatNowBlock(roleTz) {
    var aw = global.MiyaChatAwareness;
    var ts = Date.now();
    var lines = ['【今日日期时间】'];
    if (aw && typeof aw.formatFullDateTimeForTz === 'function') {
      lines.push(aw.formatFullDateTimeForTz(ts, roleTz));
    } else {
      lines.push(new Date(ts).toLocaleString('zh-CN'));
    }
    lines.push('角色时区：' + roleTz);
    lines.push('日记日期：' + isoDateForTz(ts, roleTz));
    return lines.join('\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·参考】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；日记中可自然提及，但不必围绕用户展开。'
    ];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? String(eng.renderProfileBlock(profile) || '').trim()
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + String(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + String(settings.relationship).trim());
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + String(contact.remarkName).trim());
    }
    return parts.join('\n\n');
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();

    parts.push('【角色名】' + String(contact && contact.name || '未知'));

    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 1000));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildWorldbookBlock(contact, contextSeed) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = contextSeed || String(contact.name || '') + ' 日记 日常 生活 心情';
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

  function formatMsgForDiary(m, contact, profileName) {
    if (!m || m.deleted) return '';
    var body = String(m.content || '').trim();
    if (!body) return '';
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      body = global.miyaChatEngine.stripThinkingForApi(body);
    }
    body = body.trim();
    if (!body) return '';
    var who = m.role === 'user'
      ? (profileName || '用户')
      : String(contact && contact.name || '我');
    return who + '：' + truncateStr(body, 500);
  }

  function collectTodayChats(contact, roleTz, todayIso) {
    var cs = global.miyaChatStore;
    if (!cs || !contact) return { hasToday: false, blocks: [], chatCount: 0 };

    var chats = (cs.getChats('all') || []).filter(function (ch) {
      return ch && ch.contactId === contact.id && ch.type !== 'group';
    });

    if (!chats.length) {
      return { hasToday: false, blocks: [], chatCount: 0 };
    }

    var blocks = [];
    chats.forEach(function (chat) {
      var profile = resolveProfileForContact(contact, chat);
      var profileName = profile && profile.name ? profile.name : '用户';
      var msgs = cs.getMessages(chat.id) || [];
      var todayMsgs = msgs.filter(function (m) {
        if (!m || m.deleted) return false;
        if (!String(m.content || '').trim()) return false;
        return isoDateForTz(m.createdAt, roleTz) === todayIso;
      });
      if (!todayMsgs.length) return;
      var lines = todayMsgs.map(function (m) {
        return formatMsgForDiary(m, contact, profileName);
      }).filter(Boolean);
      if (!lines.length) return;
      blocks.push({
        chatId: chat.id,
        profileName: profileName,
        text: lines.join('\n')
      });
    });

    return {
      hasToday: blocks.length > 0,
      blocks: blocks,
      chatCount: chats.length
    };
  }

  function buildMemorySummaryBlock(settings) {
    var aw = global.MiyaChatAwareness;
    var parts = [];

    if (aw && typeof aw.buildSummaryContextBlock === 'function') {
      var sumBlock = aw.buildSummaryContextBlock(settings);
      if (sumBlock) parts.push('【记忆总结·分镜合卷】\n' + truncateStr(sumBlock, 3000));
    }

    if (settings && Array.isArray(settings.charMemoryList) && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-10).map(function (m) {
        return String(m && m.content ? m.content : m).trim();
      }).filter(Boolean);
      if (mems.length) {
        parts.push('【角色视角记忆】\n' + mems.join('\n\n'));
      }
    }

    return parts.join('\n\n');
  }

  function buildDiaryContext(contact) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var profile = ctx.profile;
    var settings = ctx.settings || {};
    var roleTz = resolveRoleTz(settings);
    var todayIso = isoDateForTz(Date.now(), roleTz);
    var aw = global.MiyaChatAwareness;

    var parts = [formatNowBlock(roleTz), buildCharacterBlock(contact)];
    parts.push(buildUserRelationBlock(contact, profile, settings));

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact, '日记 今日 日常 心情 生活');
    if (wb) parts.push(wb);

    var chatData = collectTodayChats(contact, roleTz, todayIso);
    if (chatData.hasToday) {
      var chatLines = ['【今日聊天会话】', '以下为今日与该角色相关的所有私聊记录，可内化但不必逐条复述。'];
      chatData.blocks.forEach(function (block, i) {
        chatLines.push('— 会话 ' + (i + 1) + '（面具：' + block.profileName + '）—');
        chatLines.push(block.text);
      });
      parts.push(chatLines.join('\n'));
    } else {
      var mem = buildMemorySummaryBlock(settings);
      if (mem) {
        parts.push('【今日无聊天记录·参考记忆总结】\n' + mem);
      } else if (chatData.chatCount > 0) {
        parts.push('【今日无聊天记录】今日与该角色暂无对话，请依据人设与世界书自由书写今日生活。');
      } else {
        parts.push('【无聊天会话】尚未与该角色建立聊天，请依据人设、用户面具与世界书自由书写今日生活。');
      }
    }

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      roleTz: roleTz,
      todayIso: todayIso,
      contextText: parts.filter(Boolean).join('\n\n')
    };
  }

  function buildSystemPrompt(contact) {
    var name = String(contact && contact.name || '角色').trim();
    return (
      '你是「' + name + '」，正在写私人日记。' +
      '必须用第一人称、角色口吻，中文撰写。' +
      '只输出 JSON，不要 markdown，不要思维链。' +
      '格式：{"title":"短标题8字以内","mood":"今日心情词","content":"正文"}。' +
      '正文约 750-850 字，具有生活感与日常感：可写饮食、天气、琐事、工作学习、偶遇、思绪、小确幸或烦恼。' +
      '不必只围绕用户展开；若今日有聊天可自然融入，无聊天则完全依据人设与生活轨迹书写。' +
      '禁止提及 AI、生成、系统、提示词；禁止打破第四面墙。' +
      '首字符必须是 {。'
    );
  }

  function buildUserPrompt(ctx) {
    var contact = ctx.contact;
    return [
      '【角色设定·用户面具·世界书·今日语境·必读】',
      '请完整阅读后，以角色身份写一篇今日私人日记。',
      '',
      ctx.contextText,
      '',
      '【写作要求】',
      '- 日期：' + ctx.todayIso,
      '- 角色：' + String(contact && contact.name || '未知'),
      '- 正文 750-850 字，分段自然，有日记私密感',
      '- title 为当日日记标题，mood 为心情关键词',
      '- 只输出 JSON'
    ].join('\n');
  }

  function parseDiaryFromApi(text) {
    var cleaned = stripThinkingNoise(text);
    if (!cleaned) throw new Error('API 返回为空');

    var obj = tryParseJson(cleaned);
    if (obj && typeof obj === 'object') {
      var parsedContent = normalizeDiaryText(obj.content || obj.body || obj.diary || '');
      if (parsedContent) {
        var loose = extractDiaryFieldsLoose(cleaned);
        var looseContent = loose && loose.content ? normalizeDiaryText(loose.content) : '';
        if (looseContent.length > parsedContent.length) {
          parsedContent = looseContent;
          return {
            title: String(loose.title || obj.title || '今日随笔').trim(),
            mood: String(loose.mood || obj.mood || obj.emotion || '').trim(),
            content: parsedContent
          };
        }
        return {
          title: String(obj.title || '今日随笔').trim(),
          mood: String(obj.mood || obj.emotion || '').trim(),
          content: parsedContent
        };
      }
    }

    var loose = extractDiaryFieldsLoose(cleaned);
    if (loose && loose.content) {
      return {
        title: String(loose.title || '今日随笔').trim(),
        mood: String(loose.mood || '').trim(),
        content: normalizeDiaryText(loose.content)
      };
    }

    if (looksLikeDiaryJson(cleaned)) {
      throw new Error('日记 JSON 解析失败，请重试');
    }

    return {
      title: '今日随笔',
      mood: '',
      content: normalizeDiaryText(cleaned)
    };
  }

  function generateTodayDiary(contact) {
    if (!contact) return Promise.reject(new Error('缺少角色'));
    var ctx = buildDiaryContext(contact);
    contact = ctx.contact || contact;
    var systemPrompt = buildSystemPrompt(contact);
    var userPrompt = buildUserPrompt(ctx);

    return callApi(systemPrompt, userPrompt, {
      max_tokens: 8192,
      timeoutMs: 180000,
      temperature: 0.92,
      stream: false
    }).then(function (text) {
      var parsed = parseDiaryFromApi(text);
      var store = global.miyaDiaryStore;
      if (!store || typeof store.addDiary !== 'function') {
        throw new Error('日记存储未加载');
      }
      return store.addDiary(contact.id, {
        dateIso: ctx.todayIso,
        title: parsed.title,
        content: parsed.content,
        mood: parsed.mood,
        createdAt: Date.now()
      });
    });
  }

  function getProfileForContact(contact) {
    return resolveContactContext(contact).profile;
  }

  global.miyaDiaryBridge = {
    buildDiaryContext: buildDiaryContext,
    generateTodayDiary: generateTodayDiary,
    getProfileForContact: getProfileForContact,
    resolveContactContext: resolveContactContext,
    parseDiaryFromApi: parseDiaryFromApi
  };
})(typeof window !== 'undefined' ? window : global);
