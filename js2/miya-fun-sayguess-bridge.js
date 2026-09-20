/**
 * miya-fun-sayguess-bridge.js — 你说我猜 · 上下文拼装与角色 API
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
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '');
    return t.trim();
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    var opts = Object.assign({
      max_tokens: 1200,
      temperature: 0.9,
      timeoutMs: 120000,
      preferJsonPayload: true,
      disableThinking: true,
      stream: true
    }, reqOpts || {});
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, undefined, opts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function extractJson(text) {
    var br = global.miyaForumBridge;
    var cleaned = stripThinkingNoise(text);
    if (br && typeof br.extractJsonObject === 'function') {
      var obj = br.extractJsonObject(cleaned);
      if (obj) return obj;
    }
    var i = cleaned.indexOf('{');
    var j = cleaned.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(cleaned.slice(i, j + 1));
      } catch (e) {}
    }
    return null;
  }

  function resolveProfile(profileId) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var id = String(profileId || '').trim();
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    if (id) {
      var found = profiles.find(function (p) { return p && String(p.id) === id; });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
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
    if (!contact) return { contact: null, profile: null, chat: null, settings: {} };
    if (cs && typeof cs.findContact === 'function' && contact.id) {
      var fresh = cs.findContact(contact.id);
      if (fresh) contact = fresh;
    }
    if (!cs) return { contact: contact, profile: null, chat: null, settings: {} };
    var profileId = String(contact.defaultProfileId || '').trim();
    var chat = cs.findChatByContact ? cs.findChatByContact(contact.id, profileId) : null;
    if (!chat && cs.findChatByContact) chat = cs.findChatByContact(contact.id, '');
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

  /** 你说我猜一律用角色真名，不用备注名 */
  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.name || '未命名').trim() || '未命名';
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + displayName(contact));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 2000));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = ['【用户面具与双方关系】'];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? String(eng.renderProfileBlock(profile) || '').trim()
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·' + String(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + truncateStr(profile.persona, 1200));
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

  function buildWorldbookBlock(contact, seed) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var bundle = eng.buildWorldbookBundle(contact, seed || (displayName(contact) + ' 你说我猜'), null, {
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
    return text ? '【世界书·必读】\n' + truncateStr(text, 6000) : '';
  }

  function buildMemorySummaryBlock(settings) {
    var aw = global.MiyaChatAwareness;
    var parts = [];
    if (aw && typeof aw.buildSummaryContextBlock === 'function') {
      var sumBlock = aw.buildSummaryContextBlock(settings);
      if (sumBlock) parts.push('【记忆总结】\n' + truncateStr(sumBlock, 2000));
    }
    if (settings && Array.isArray(settings.charMemoryList) && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-8).map(function (m) {
        return String(m && m.content ? m.content : m).trim();
      }).filter(Boolean);
      if (mems.length) parts.push('【角色视角记忆】\n' + mems.join('\n\n'));
    }
    return parts.join('\n\n');
  }

  function buildRecentChatBlock(contact, chat, profile, limit) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var msgs = [];
    if (typeof cs.getMergedMessagesForApi === 'function') {
      msgs = cs.getMergedMessagesForApi(chat.id) || [];
    } else if (typeof cs.getMessages === 'function') {
      msgs = cs.getMessages(chat.id) || [];
    }
    var profileName = profile && profile.name ? profile.name : '用户';
    var roleName = displayName(contact);
    var n = Math.max(6, Math.min(Number(limit) || 16, 30));
    var recent = msgs.filter(function (m) {
      return m && !m.deleted && String(m.content || '').trim();
    }).slice(-n);
    if (!recent.length) return '';
    var lines = recent.map(function (m) {
      var body = String(m.content || '').trim();
      if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
        body = global.miyaChatEngine.stripThinkingForApi(body);
      }
      body = truncateStr(body, 280);
      if (!body) return '';
      return (m.role === 'user' ? profileName : roleName) + '：' + body;
    }).filter(Boolean);
    if (!lines.length) return '';
    return '【近期对话】\n' + lines.join('\n');
  }

  function buildPairwiseAmongPlayers(contacts) {
    var aw = global.MiyaChatAwareness;
    var parts = [];
    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      contacts.forEach(function (c) {
        var net = aw.buildChronicleRelationshipBlock(c);
        if (net) parts.push(net);
      });
    }
    var relStore = global.miyaContactsRelationshipStore;
    if (relStore && typeof relStore.getRelation === 'function' && contacts.length > 1) {
      var pairs = [];
      for (var i = 0; i < contacts.length; i++) {
        for (var j = i + 1; j < contacts.length; j++) {
          var a = contacts[i];
          var b = contacts[j];
          var aid = String((a && (a.characterId || a.chronicleId || a.id)) || '');
          var bid = String((b && (b.characterId || b.chronicleId || b.id)) || '');
          if (!aid || !bid) continue;
          var rel = relStore.getRelation(aid, bid);
          if (rel) {
            pairs.push(
              displayName(a) + ' ↔ ' + displayName(b) + '：' +
              truncateStr(typeof rel === 'string' ? rel : (rel.desc || rel.relation || JSON.stringify(rel)), 200)
            );
          }
        }
      }
      if (pairs.length) parts.push('【在场角色彼此关系】\n' + pairs.join('\n'));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildFullCharacterContext(contact, hostProfileId, peers) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var hostProfile = resolveProfile(hostProfileId) || ctx.profile;
    var settings = ctx.settings || {};
    var chat = ctx.chat;
    var seed = displayName(contact) + ' 你说我猜 娱乐游戏';

    var parts = [
      '═══ 角色：' + displayName(contact) + ' ═══',
      buildCharacterBlock(contact),
      buildUserRelationBlock(contact, hostProfile, settings)
    ];

    var peerList = Array.isArray(peers) ? peers.filter(Boolean) : [];
    if (peerList.length) {
      var peerNet = buildPairwiseAmongPlayers([contact].concat(peerList));
      if (peerNet) parts.push(peerNet);
    } else {
      var aw = global.MiyaChatAwareness;
      if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
        var net = aw.buildChronicleRelationshipBlock(contact);
        if (net) parts.push(net);
      }
    }

    var wb = buildWorldbookBlock(contact, seed);
    if (wb) parts.push(wb);

    var mem = buildMemorySummaryBlock(settings);
    if (mem) parts.push(mem);

    var recent = buildRecentChatBlock(contact, chat, hostProfile || ctx.profile, settings.memoryCount || 16);
    if (recent) parts.push(recent);

    return {
      contact: contact,
      profile: hostProfile || ctx.profile,
      settings: settings,
      text: parts.filter(Boolean).join('\n\n')
    };
  }

  function findContact(contactId) {
    var cs = global.miyaChatStore;
    if (!cs || !cs.findContact) return null;
    return cs.findContact(contactId) || null;
  }

  function peersFor(session, excludeContactId) {
    var out = [];
    (session && session.players ? session.players : []).forEach(function (p) {
      if (!p || p.kind !== 'char') return;
      if (String(p.contactId || p.id) === String(excludeContactId)) return;
      var c = findContact(p.contactId || p.id);
      if (c) out.push(c);
    });
    return out;
  }

  function parseSpeechJson(raw, fields) {
    var obj = extractJson(raw);
    if (obj && typeof obj === 'object') {
      var result = {};
      (fields || []).forEach(function (f) {
        if (obj[f] != null) result[f] = String(obj[f]).trim();
      });
      return result;
    }
    var cleaned = stripThinkingNoise(raw).replace(/^["「]|["」]$/g, '').trim();
    var fallback = {};
    if (fields && fields[0]) fallback[fields[0]] = cleaned;
    return fallback;
  }

  /** 从残缺/截断文本里尽量抠出 guess / speech，避免把 JSON 原文展示出来 */
  function salvageGuessFields(raw) {
    var t = stripThinkingNoise(raw);
    var guess = '';
    var speech = '';
    var mg = t.match(/"guess"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (mg) guess = mg[1].replace(/\\"/g, '"').trim();
    if (!guess) {
      var mg2 = t.match(/guess["'\s:：]+[「"']?([^「」"'\n,{}]{1,20})/);
      if (mg2) guess = String(mg2[1] || '').trim();
    }
    var ms = t.match(/"speech"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (ms) speech = ms[1].replace(/\\"/g, '"').trim();
    // 截断 JSON：从 "speech":" 起一直取到结尾
    if (!speech) {
      var ms2 = t.match(/"speech"\s*:\s*"([\s\S]*)$/);
      if (ms2) {
        speech = ms2[1]
          .replace(/"\s*,\s*"guess"[\s\S]*$/i, '')
          .replace(/"\s*\}\s*$/i, '')
          .replace(/\\"/g, '"')
          .trim();
      }
    }
    if (!speech && !/^\s*\{/.test(t) && !/"speech"\s*:/.test(t) && !/"guess"\s*:/.test(t)) {
      speech = t.trim();
    }
    return { guess: guess, speech: speech };
  }

  function cleanDisplayText(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return '';
    var looksJson = /^\s*\{/.test(t) || /"guess"\s*:/.test(t) || /"speech"\s*:/.test(t) || /^```/.test(t);
    if (looksJson) {
      var salvaged = salvageGuessFields(t);
      var picked = salvaged.speech || salvaged.guess || '';
      // 抢救失败时不要把原文整段清空；若已是纯中文描述也直接用
      if (picked) t = picked;
      else {
        t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
        if (/^\s*\{/.test(t)) t = '';
      }
    }
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
    return t;
  }

  function cleanGuessWord(s) {
    var t = cleanDisplayText(s);
    t = t.replace(/^[「"']+|[」"']+$/g, '').trim();
    t = t.replace(/^(我猜是|我猜|猜测是|答案是|应该是)\s*/i, '').trim();
    t = t.replace(/[！!。.~…]+$/g, '').trim();
    if (Array.from(t).length > 12) {
      var m = t.match(/[「『]([^」』]{1,10})[」』]/);
      if (m) t = m[1];
      else t = Array.from(t).slice(0, 10).join('');
    }
    return t;
  }

  function extractSpeechLoose(raw) {
    var cleaned = stripThinkingNoise(raw);
    var obj = extractJson(cleaned);
    if (obj && typeof obj === 'object') {
      var s = String(obj.speech || obj.description || obj.text || obj.desc || '').trim();
      if (s) return cleanDisplayText(s) || s;
    }
    var salvaged = salvageGuessFields(cleaned);
    if (salvaged.speech) return cleanDisplayText(salvaged.speech) || salvaged.speech;
    // 纯文本描述
    var plain = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/g, '')
      .trim();
    if (plain && !/^\s*\{/.test(plain)) {
      return plain;
    }
    return '';
  }

  /**
   * 角色出题描述（注入答案词，要求不能直接说出答案）
   */
  function describeAsCharacter(session, player, answerWord) {
    var contactId = String((player && (player.contactId || '')) || '').trim();
    if (!contactId && player && player.id && String(player.id).indexOf('char:') === 0) {
      contactId = String(player.id).slice(5);
    }
    var contact = findContact(contactId || (player && player.id));
    if (!contact) return Promise.reject(new Error('找不到角色'));
    var ctx = buildFullCharacterContext(contact, session.profileId, peersFor(session, contact.id));
    var others = (session.players || []).filter(function (p) {
      return p && String(p.id) !== String(player.id);
    }).map(function (p) { return p.name; }).join('、');

    var system = [
      '你正在和朋友玩「你说我猜」。你是出题人，只能用口语描述提示，不能直接说出答案。',
      '必须严格按角色人设、口癖、关系说话。',
      '禁止在描述里出现答案本身或其明显拆字同义直说。',
      '描述里最好自然带一句提示：这个词一共几个字（只说字数，不要拆字泄题）。',
      '优先输出完整 JSON：{"speech":"你的描述（1-3句）"}',
      '如果无法输出 JSON，直接输出描述正文也行，不要解释。'
    ].join('\n');

    var user = [
      ctx.text,
      '',
      '【本轮游戏】',
      '出题人：你（' + displayName(contact) + '）',
      '猜的人：' + (others || '其他人'),
      '答案词（只有你知道，绝对不能说出）：' + String(answerWord),
      '答案字数：' + Array.from(String(answerWord || '').trim()).length + ' 个字（可在描述里暗示字数）',
      '',
      '请用符合人设的口吻描述这个词，让别人能猜出来，但不要泄题。'
    ].join('\n');

    function once() {
      return callApi(system, user, { max_tokens: 2000, temperature: 0.92 }).then(function (raw) {
        var speech = extractSpeechLoose(raw);
        if (!speech) throw new Error('角色没有给出描述');
        return { speech: speech, raw: raw };
      });
    }

    return once().catch(function (err) {
      // 再试一次，略降温度
      return callApi(system, user + '\n请只输出一句简短描述。', {
        max_tokens: 800,
        temperature: 0.7
      }).then(function (raw) {
        var speech = extractSpeechLoose(raw);
        if (!speech) throw err;
        return { speech: speech, raw: raw };
      });
    });
  }

  /**
   * 揭晓后角色讨论本轮答案（一次 API）
   */
  function discussRoundAsCharacters(session, round) {
    var chars = (session.players || []).filter(function (p) { return p && p.kind === 'char'; });
    if (!chars.length) return Promise.resolve({ lines: [] });

    var contexts = chars.map(function (p) {
      var contactId = String(p.contactId || '').trim();
      if (!contactId && String(p.id || '').indexOf('char:') === 0) contactId = String(p.id).slice(5);
      var contact = findContact(contactId);
      if (!contact) return null;
      return {
        player: p,
        contact: contact,
        text: buildFullCharacterContext(contact, session.profileId, peersFor(session, contact.id)).text
      };
    }).filter(Boolean);

    if (!contexts.length) return Promise.reject(new Error('找不到角色'));

    var describer = (session.players || []).find(function (p) {
      return round && String(p.id) === String(round.describerId);
    });
    var names = contexts.map(function (c) { return displayName(c.contact); });
    var guessLines = (round.guesses || []).map(function (g) {
      var who = (session.players || []).find(function (p) { return String(p.id) === String(g.playerId); });
      return (who ? who.name : '?') + ' 猜了「' + (g.text || '') + '」' + (g.hit ? '（对）' : '（错）');
    }).join('；');

    var system = [
      '你们刚玩完一轮「你说我猜」，答案已经公布。',
      '请让在场角色围绕本轮答案、谁猜对/猜错、描述好不好，自然聊天吐槽，符合各自人设。',
      '可以互相对话，不要千篇一律。',
      '输出完整 JSON：{"lines":[{"name":"角色名","speech":"发言"}]}',
      '每位角色至少一句，2-8 句对话即可。'
    ].join('\n');

    var user = [
      '【在场角色】',
      contexts.map(function (c) { return c.text; }).join('\n\n————\n\n'),
      '',
      '【本轮回顾】',
      '出题人：' + (describer ? describer.name : '—'),
      '描述：' + String((round && round.description) || ''),
      '答案：' + String((round && round.word) || ''),
      '猜测：' + (guessLines || '无'),
      '需要出场：' + names.join('、'),
      '',
      '请生成揭晓后的短讨论。'
    ].join('\n');

    return callApi(system, user, { max_tokens: 3500, temperature: 0.9 }).then(function (raw) {
      var obj = extractJson(raw);
      var rows = obj && Array.isArray(obj.lines) ? obj.lines : [];
      var nameToPlayer = {};
      contexts.forEach(function (c) {
        nameToPlayer[displayName(c.contact)] = c.player;
        nameToPlayer[c.player.name] = c.player;
      });
      function resolvePlayer(name) {
        var n = String(name || '').trim();
        if (nameToPlayer[n]) return nameToPlayer[n];
        var keys = Object.keys(nameToPlayer);
        for (var i = 0; i < keys.length; i++) {
          if (n.indexOf(keys[i]) !== -1 || keys[i].indexOf(n) !== -1) return nameToPlayer[keys[i]];
        }
        return null;
      }
      var lines = [];
      rows.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var pl = resolvePlayer(row.name || row.role);
        var speech = extractSpeechLoose(JSON.stringify({ speech: row.speech || row.text || '' })) ||
          cleanDisplayText(row.speech || row.text || '');
        if (!speech) return;
        lines.push({
          playerId: pl ? pl.id : '',
          name: pl ? pl.name : String(row.name || '角色'),
          speech: speech
        });
      });
      if (!lines.length) {
        contexts.forEach(function (c, idx) {
          lines.push({
            playerId: c.player.id,
            name: c.player.name,
            speech: idx === 0 ? ('原来是「' + String(round.word || '') + '」啊。') : '哈哈有意思。'
          });
        });
      }
      return { lines: lines, raw: raw };
    });
  }

  /**
   * 所有猜词角色一次 API：可互相对话，每人最终给一个猜词
   * 不注入答案词
   */
  function resolvePlayerContact(player) {
    if (!player) return null;
    var contactId = String(player.contactId || '').trim();
    if (!contactId && String(player.id || '').indexOf('char:') === 0) {
      contactId = String(player.id).slice(5);
    }
    return findContact(contactId || player.id);
  }

  function buildCompactCharContext(contact, hostProfileId) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var hostProfile = resolveProfile(hostProfileId) || ctx.profile;
    var parts = [
      '角色：' + displayName(contact),
      truncateStr(buildCharacterBlock(contact), 1200),
      truncateStr(buildUserRelationBlock(contact, hostProfile, ctx.settings || {}), 800)
    ];
    return parts.filter(Boolean).join('\n');
  }

  /** 从残缺 JSON 文本里抠出多条 lines / guesses */
  function salvageGuessLines(raw, nameList) {
    var t = stripThinkingNoise(raw);
    var out = [];
    var reObj = /\{\s*"name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"speech"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"guess"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    var m;
    while ((m = reObj.exec(t))) {
      out.push({
        name: m[1].replace(/\\"/g, '"'),
        speech: m[2].replace(/\\"/g, '"'),
        guess: m[3].replace(/\\"/g, '"')
      });
    }
    // 宽松：name/guess 顺序不定
    if (!out.length) {
      var reLoose = /\{\s*[^{}]*"name"\s*:\s*"((?:\\.|[^"\\])*)"[^{}]*"guess"\s*:\s*"((?:\\.|[^"\\])*)"[^{}]*\}/g;
      while ((m = reLoose.exec(t))) {
        var block = m[0];
        var sp = block.match(/"speech"\s*:\s*"((?:\\.|[^"\\])*)"/);
        out.push({
          name: m[1].replace(/\\"/g, '"'),
          speech: sp ? sp[1].replace(/\\"/g, '"') : '',
          guess: m[2].replace(/\\"/g, '"')
        });
      }
    }
    // 按名字列表再扫一遍「某某：…」
    if (!out.length && nameList && nameList.length) {
      nameList.forEach(function (nm) {
        var n = String(nm || '').trim();
        if (!n) return;
        var re = new RegExp(escapeRegExp(n) + '\\s*[：:]\\s*([^\\n]{2,80})');
        var hit = t.match(re);
        if (hit) {
          out.push({ name: n, speech: hit[1].trim(), guess: cleanGuessWord(hit[1]) });
        }
      });
    }
    return out;
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function guessRoundAsCharacters(session, charPlayers, description, userGuessInfo) {
    var list = Array.isArray(charPlayers) ? charPlayers.filter(function (p) {
      return p && p.kind === 'char';
    }) : [];
    if (!list.length) return Promise.resolve({ lines: [], guesses: [] });

    var contexts = list.map(function (p) {
      var contact = resolvePlayerContact(p);
      if (!contact) return null;
      return {
        player: p,
        contact: contact,
        name: displayName(contact) || p.name,
        text: buildCompactCharContext(contact, session.profileId)
      };
    }).filter(Boolean);

    // 联系人解析失败也保留名字，避免整人丢失
    if (contexts.length < list.length) {
      list.forEach(function (p) {
        if (contexts.some(function (c) { return String(c.player.id) === String(p.id); })) return;
        contexts.push({
          player: p,
          contact: null,
          name: p.name || '角色',
          text: '角色：' + (p.name || '角色')
        });
      });
    }

    if (!contexts.length) return Promise.reject(new Error('找不到可猜词的角色'));

    var describer = (session.players || []).find(function (p) {
      return session._currentDescriberId && String(p.id) === String(session._currentDescriberId);
    });
    var describerName = describer ? describer.name : '出题人';
    var names = contexts.map(function (c) { return c.name; });
    var mustCount = contexts.length;

    var system = [
      '你们正在玩「你说我猜」。以下 ' + mustCount + ' 位角色要根据描述猜词。',
      '严禁知道标准答案；只能根据描述推理。',
      '角色可互相吐槽、接话，口吻符合人设。',
      '严禁重复：同一个人不要把已经说过的话再原样说一遍；speech 与 guess 职责分开。',
      '必须输出完整 JSON（不要截断、不要 markdown）：',
      '{"lines":[{"name":"角色名","speech":"对话（不要写最终猜词）"}],"guesses":[{"name":"角色名","guess":"词"}]}',
      '规则：',
      '- lines：聊天过程，可多轮；speech 里不要重复粘贴自己的上几句；也不要在 speech 里写「我猜是xx」。',
      '- guesses：每人恰好一条，只给最终猜词；不要再附带大段 speech；name 必须是：' + names.join('、'),
      '- guesses 必须 ' + mustCount + ' 人齐，一个都不能少。'
    ].join('\n');

    var userParts = [
      '【角色速览】',
      contexts.map(function (c) { return c.text; }).join('\n---\n'),
      '',
      '【本轮】',
      '出题人：' + describerName,
      '描述：' + String(description || '（暂无）'),
      userGuessInfo && userGuessInfo.text
        ? ('用户已猜：' + userGuessInfo.text +
          (userGuessInfo.speech && userGuessInfo.speech !== userGuessInfo.text
            ? '；用户说：' + userGuessInfo.speech
            : ''))
        : '用户本轮未猜或不出猜。',
      '必须猜词的角色（' + mustCount + '人）：' + names.join('、'),
      '',
      '请输出完整 JSON。'
    ];

    function parseGuessPayload(raw) {
      var obj = extractJson(raw);
      var linesRaw = [];
      var guessesRaw = [];
      if (obj && typeof obj === 'object') {
        if (Array.isArray(obj.lines)) linesRaw = obj.lines;
        if (Array.isArray(obj.guesses)) guessesRaw = obj.guesses;
        // 兼容旧格式：只有 lines 且带 guess
        if (!guessesRaw.length && linesRaw.length) {
          guessesRaw = linesRaw.filter(function (r) {
            return r && (r.guess || r.word);
          });
        }
      }
      if (!linesRaw.length && !guessesRaw.length) {
        var salvaged = salvageGuessLines(raw, names);
        linesRaw = salvaged;
        guessesRaw = salvaged;
      } else if (guessesRaw.length < mustCount) {
        // 补抠截断内容
        salvageGuessLines(raw, names).forEach(function (row) {
          guessesRaw.push(row);
          linesRaw.push(row);
        });
      }
      return { linesRaw: linesRaw, guessesRaw: guessesRaw };
    }

    function resolvePlayerByName(name) {
      var n = String(name || '').trim();
      if (!n) return null;
      for (var i = 0; i < contexts.length; i++) {
        var c = contexts[i];
        if (c.name === n || c.player.name === n) return c.player;
        if (n.indexOf(c.name) !== -1 || c.name.indexOf(n) !== -1) return c.player;
        if (c.player.name && (n.indexOf(c.player.name) !== -1 || c.player.name.indexOf(n) !== -1)) {
          return c.player;
        }
      }
      return null;
    }

    function dedupeSpeechChunks(text) {
      var parts = String(text || '')
        .split(/\n+/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var out = [];
      var seen = {};
      parts.forEach(function (p) {
        if (seen[p]) return;
        if (out.length && (p === out.join('\n') || p.indexOf(out.join('\n')) === 0)) return;
        seen[p] = true;
        out.push(p);
      });
      return out.join('\n');
    }

    function buildResult(linesRaw, guessesRaw) {
      var lines = [];
      linesRaw.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var pl = resolvePlayerByName(row.name || row.role || row.character);
        var speech = cleanDisplayText(row.speech || row.text || row.say || '');
        var guess = cleanGuessWord(row.guess || row.word || '');
        // lines 只保留对话；猜词交给 guesses，避免「说完又整段复读」
        if (speech) {
          lines.push({
            playerId: pl ? pl.id : '',
            name: pl ? pl.name : String(row.name || '').trim(),
            speech: speech,
            guess: ''
          });
        } else if (guess && pl) {
          lines.push({
            playerId: pl.id,
            name: pl.name,
            speech: '',
            guess: guess
          });
        }
      });

      var lastGuess = {};
      var speeches = {};
      function absorbGuess(row) {
        if (!row || typeof row !== 'object') return;
        var pl = resolvePlayerByName(row.name || row.role || row.character);
        if (!pl) return;
        var speech = cleanDisplayText(row.speech || row.text || '');
        var guess = cleanGuessWord(row.guess || row.word || '');
        if (guess) lastGuess[pl.id] = guess;
        if (speech) {
          var existing = speeches[pl.id] || '';
          if (!existing || existing.indexOf(speech) === -1) {
            speeches[pl.id] = existing ? (existing + '\n' + speech) : speech;
          }
        }
      }

      guessesRaw.forEach(function (row) { absorbGuess(row); });

      lines.forEach(function (ln) {
        if (!ln.playerId) return;
        if (ln.speech) {
          speeches[ln.playerId] = (speeches[ln.playerId] ? speeches[ln.playerId] + '\n' : '') + ln.speech;
        }
        if (ln.guess) lastGuess[ln.playerId] = ln.guess;
      });

      Object.keys(speeches).forEach(function (id) {
        speeches[id] = dedupeSpeechChunks(speeches[id]);
      });

      var orphans = lines.filter(function (ln) { return !ln.playerId && ln.guess; });
      contexts.forEach(function (c) {
        if (lastGuess[c.player.id]) return;
        var o = orphans.shift();
        if (o) lastGuess[c.player.id] = o.guess;
      });

      var guesses = contexts.map(function (c) {
        var g = lastGuess[c.player.id] || '';
        return {
          playerId: c.player.id,
          name: c.player.name,
          text: g,
          speech: speeches[c.player.id] || '',
          fromAi: true,
          missing: !g
        };
      });

      // 展示：对话行 + 每人一条最终猜词行（猜词行不再附带整段 speech）
      var normalizedLines = lines.filter(function (ln) {
        return ln.playerId && ln.speech;
      }).map(function (ln) {
        return {
          playerId: ln.playerId,
          name: ln.name,
          speech: dedupeSpeechChunks(ln.speech),
          guess: ''
        };
      });
      guesses.forEach(function (g) {
        if (!g.text) return;
        normalizedLines.push({
          playerId: g.playerId,
          name: g.name,
          speech: '',
          guess: g.text
        });
      });

      return {
        lines: normalizedLines,
        guesses: guesses,
        missingIds: guesses.filter(function (g) { return g.missing; }).map(function (g) { return g.playerId; })
      };
    }

    function fillMissingGuesses(missingPlayers, description, base) {
      if (!missingPlayers.length) return Promise.resolve(base);
      var missNames = missingPlayers.map(function (p) {
        var c = contexts.find(function (x) { return String(x.player.id) === String(p.id); });
        return (c && c.name) || p.name;
      });
      var system2 = [
        '补全「你说我猜」漏掉的猜词。只输出 JSON，不要截断：',
        '{"guesses":[{"name":"角色名","guess":"词"}]}',
        '必须恰好包含：' + missNames.join('、'),
        '不要输出大段 speech，只要猜词。'
      ].join('\n');
      var user2 = [
        '描述：' + String(description || ''),
        '还缺这些角色的猜词：' + missNames.join('、'),
        '已有结果勿重复，只补缺的人。'
      ].join('\n');
      return callApi(system2, user2, { max_tokens: 2000, temperature: 0.85 }).then(function (raw2) {
        var parsed2 = parseGuessPayload(raw2);
        var mergedGuessesRaw = (base._guessesRaw || []).concat(parsed2.guessesRaw || []);
        var mergedLinesRaw = (base._linesRaw || []).concat(parsed2.linesRaw || []);
        var rebuilt = buildResult(mergedLinesRaw, mergedGuessesRaw);
        rebuilt.guesses.forEach(function (g) {
          if (g.text) return;
          g.text = '……';
          g.missing = false;
        });
        var seen = {};
        rebuilt.lines.forEach(function (ln) { if (ln.guess) seen[ln.playerId] = true; });
        rebuilt.guesses.forEach(function (g) {
          if (seen[g.playerId] || !g.text) return;
          rebuilt.lines.push({
            playerId: g.playerId,
            name: g.name,
            speech: '',
            guess: g.text
          });
        });
        return { lines: rebuilt.lines, guesses: rebuilt.guesses, raw: raw2 };
      }).catch(function () {
        base.guesses.forEach(function (g) {
          if (g.text) return;
          g.text = '……';
        });
        return { lines: base.lines, guesses: base.guesses };
      });
    }

    return callApi(system, userParts.join('\n'), {
      max_tokens: 6000,
      temperature: 0.88
    }).then(function (raw) {
      var parsed = parseGuessPayload(raw);
      var built = buildResult(parsed.linesRaw, parsed.guessesRaw);
      built._linesRaw = parsed.linesRaw;
      built._guessesRaw = parsed.guessesRaw;
      built.raw = raw;

      var missingPlayers = contexts
        .filter(function (c) {
          return built.missingIds.indexOf(c.player.id) !== -1;
        })
        .map(function (c) { return c.player; });

      if (!missingPlayers.length) {
        return { lines: built.lines, guesses: built.guesses, raw: raw };
      }
      return fillMissingGuesses(missingPlayers, description, built);
    });
  }

  /** AI 生成题库词语 */
  function generateWords(keywords, count) {
    var n = Math.max(5, Math.min(30, Number(count) || 20));
    var kw = String(keywords || '').trim() || '日常、有趣、好猜';
    var system = [
      '你是词语题库生成器。根据用户关键词生成适合「你说我猜」的词语。',
      '要求：每个词 2-10 个汉字或常见中英混写词；具体可猜；不要违禁；不要重复。',
      '只输出 JSON：{"words":["词1","词2",...]}，恰好 ' + n + ' 个。'
    ].join('\n');
    var user = '关键词：' + kw + '\n请生成 ' + n + ' 个词语。';

    return callApi(system, user, { max_tokens: 1500, temperature: 0.85 }).then(function (raw) {
      var obj = extractJson(raw);
      var list = obj && Array.isArray(obj.words) ? obj.words : [];
      if (!list.length) {
        var cleaned = stripThinkingNoise(raw);
        list = cleaned.split(/[\n,，、]/).map(function (x) {
          return String(x).replace(/^\d+[\.、\)]\s*/, '').replace(/^["「]|["」]$/g, '').trim();
        });
      }
      var store = global.miyaFunSayGuessStore;
      var out = [];
      var seen = {};
      list.forEach(function (w) {
        var word = store ? store.normalizeWord(w) : String(w || '').trim();
        if (!word || seen[word]) return;
        if (store && !store.isValidWord(word)) return;
        var len = Array.from(word).length;
        if (len < 2 || len > 10) return;
        seen[word] = true;
        out.push(word);
      });
      if (!out.length) throw new Error('没有生成有效词语，请换个关键词试试');
      return out.slice(0, n);
    });
  }

  /**
   * 终局感想：所有角色一次 API，完整输出不截断，并注入名次奖品
   * prizeByPlayerId: { [playerId]: prizeText }
   */
  function celebrateAsCharacters(session, charPlayers, rankingText, prizeByPlayerId) {
    var list = Array.isArray(charPlayers) ? charPlayers.filter(function (p) {
      return p && p.kind === 'char';
    }) : [];
    if (!list.length) return Promise.resolve({ lines: [] });

    var prizeMap = prizeByPlayerId || {};
    var contexts = list.map(function (p) {
      var contact = resolvePlayerContact(p) || findContact(p.contactId || p.id);
      var name = contact ? displayName(contact) : (p.name || '角色');
      var ctxText = contact
        ? buildCompactCharContext(contact, session.profileId)
        : ('角色：' + name);
      var prize = prizeMap[p.id] || prizeMap[String(p.id)] || '';
      return {
        player: p,
        contact: contact,
        name: name,
        text: ctxText,
        prize: prize
      };
    });

    var names = contexts.map(function (c) { return c.name; });
    var prizeLines = contexts.map(function (c) {
      return c.name + '：' + (c.prize ? ('奖品「' + c.prize + '」') : '无奖品');
    }).join('\n');

    var system = [
      '你们刚玩完「你说我猜」。请让下列角色各自用符合人设的口吻说一段终局感想。',
      '必须一次输出所有角色，不要省略；感想可 2-6 句，说完再停，禁止中途截断。',
      '每位角色要提到自己的名次感受；若有奖品，必须自然提到奖品内容。',
      '可以互相关注、吐槽，但不要重复粘贴同一段话。',
      '只输出完整 JSON（不要 markdown、不要截断）：',
      '{"lines":[{"name":"角色名","speech":"完整感想"}]}',
      'name 必须使用：' + names.join('、'),
      '每位角色恰好一条。'
    ].join('\n');

    var user = [
      '【角色速览】',
      contexts.map(function (c) { return c.text; }).join('\n---\n'),
      '',
      '【终局排名】',
      String(rankingText || ''),
      '',
      '【奖品（必须注入感想）】',
      prizeLines || '本局未设置奖品。',
      '',
      '需要发言的角色：' + names.join('、'),
      '请输出完整 JSON，每位都要有完整 speech。'
    ].join('\n');

    return callApi(system, user, { max_tokens: 8000, temperature: 0.9 }).then(function (raw) {
      var obj = extractJson(raw);
      var rows = obj && Array.isArray(obj.lines) ? obj.lines : [];
      if (!rows.length) {
        var salvaged = salvageGuessLines(raw, names);
        rows = salvaged.map(function (r) {
          return { name: r.name, speech: r.speech || r.guess || '' };
        });
      }

      function resolvePlayer(name) {
        var n = String(name || '').trim();
        for (var i = 0; i < contexts.length; i++) {
          var c = contexts[i];
          if (c.name === n || c.player.name === n) return c.player;
          if (n.indexOf(c.name) !== -1 || c.name.indexOf(n) !== -1) return c.player;
        }
        return null;
      }

      var lines = [];
      var seen = {};
      rows.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var pl = resolvePlayer(row.name || row.role || row.character);
        var speech = String(row.speech || row.text || row.say || '').trim();
        if (!speech) return;
        if (/^\s*\{/.test(speech) || /"speech"\s*:/.test(speech)) {
          speech = cleanDisplayText(speech) || speech;
        }
        speech = speech.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
        if (!speech) return;
        var id = pl ? String(pl.id) : ('orphan:' + lines.length);
        if (seen[id]) {
          var prev = lines.find(function (ln) { return String(ln.playerId) === id; });
          if (prev && prev.speech.indexOf(speech) === -1) prev.speech += '\n' + speech;
          return;
        }
        seen[id] = true;
        lines.push({
          playerId: pl ? pl.id : '',
          name: pl ? pl.name : String(row.name || '角色'),
          speech: speech
        });
      });

      contexts.forEach(function (c) {
        if (seen[String(c.player.id)]) return;
        var prizeNote = c.prize ? ('拿到「' + c.prize + '」开心。') : '这局挺好玩的。';
        lines.push({
          playerId: c.player.id,
          name: c.player.name,
          speech: prizeNote
        });
      });

      return { lines: lines, raw: raw };
    });
  }

  /** 兼容旧单角色调用 */
  function celebrateAsCharacter(session, player, rankingText, prize) {
    var map = {};
    if (player && player.id) map[player.id] = prize || '';
    return celebrateAsCharacters(session, [player], rankingText, map).then(function (res) {
      var line = (res.lines || [])[0];
      return { speech: (line && line.speech) || '好玩！', raw: res.raw };
    });
  }

  global.miyaFunSayGuessBridge = {
    resolveProfile: resolveProfile,
    findContact: findContact,
    displayName: displayName,
    buildFullCharacterContext: buildFullCharacterContext,
    describeAsCharacter: describeAsCharacter,
    discussRoundAsCharacters: discussRoundAsCharacters,
    guessRoundAsCharacters: guessRoundAsCharacters,
    generateWords: generateWords,
    celebrateAsCharacter: celebrateAsCharacter,
    celebrateAsCharacters: celebrateAsCharacters,
    cleanDisplayText: cleanDisplayText,
    cleanGuessWord: cleanGuessWord,
    callApi: callApi
  };
})(typeof window !== 'undefined' ? window : global);
