/**
 * miya-couple-whisper-engine.js — 深夜私语 · API 与解析
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  function chatStore() { return global.miyaChatStore || null; }
  function chatEngine() { return global.miyaChatEngine || null; }
  function apStore() { return global.miyaAppointmentStore || null; }
  function wpStore() { return global.miyaCoupleWhisperStore || null; }

  function getApiConfig() {
    var eng = chatEngine();
    if (eng && typeof eng.getApiConfig === 'function') return eng.getApiConfig();
    if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
    return {};
  }

  function normalizeBaseUrl(base) {
    var t = trim(base).replace(/\/+$/, '');
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = (u.pathname || '/').replace(/\/+$/, '');
      var segs = path.split('/').filter(Boolean);
      if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
      if (!path || path === '/') return u.origin + '/v1';
      return u.origin + path + '/v1';
    } catch (e) {
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  function resolveApiSlice(cfg, useSecondary) {
    if (useSecondary) {
      var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
      return {
        baseUrl: normalizeBaseUrl(sec.baseUrl),
        apiKey: trim(sec.apiKey),
        model: trim(sec.model),
        temperature: sec.temperature != null ? Number(sec.temperature) : (cfg.temperature != null ? Number(cfg.temperature) : 1)
      };
    }
    return {
      baseUrl: normalizeBaseUrl(cfg.baseUrl),
      apiKey: trim(cfg.apiKey),
      model: trim(cfg.model),
      temperature: cfg.temperature != null ? Number(cfg.temperature) : 1
    };
  }

  function hasSecondaryApi(cfg) {
    var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
    return !!(normalizeBaseUrl(sec.baseUrl) && trim(sec.apiKey) && trim(sec.model));
  }

  function fetchCompletion(url, headers, payload, attempt) {
    var tryNo = Math.max(1, Number(attempt) || 1);
    var eng = chatEngine();
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload) })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
          });
        }
        return r.json();
      })
      .then(function (data) {
        var replyRaw = '';
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
          replyRaw = trim(data.choices[0].message.content);
        }
        if (!replyRaw && tryNo < 3) return fetchCompletion(url, headers, payload, tryNo + 1);
        if (!replyRaw) throw new Error('empty_reply');
        return { replyRaw: replyRaw };
      });
  }

  function resolveProfileForContact(st, contact, chat) {
    if (!st) return null;
    var profiles = st.getProfiles ? st.getProfiles() : [];
    var boundId = '';
    if (contact && contact.defaultProfileId) boundId = trim(contact.defaultProfileId);
    if (!boundId && chat && chat.profileId) boundId = trim(chat.profileId);
    if (boundId) {
      var found = profiles.find(function (p) { return p && p.id === boundId; });
      if (found) return found;
    }
    return st.getActiveProfile ? st.getActiveProfile() : null;
  }

  function resolveChatForContact(contactId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    var contact = st.findContact(contactId);
    if (!contact) return null;
    var pid = trim(contact.defaultProfileId) ||
      (st.getActiveProfile() && st.getActiveProfile().id) || '';
    var chat = st.findChatByContact ? st.findChatByContact(contactId, pid) : null;
    if (!chat && st.createChat) {
      chat = st.createChat({ contactId: contactId, profileId: pid, type: 'private' });
    }
    return { contact: contact, profile: resolveProfileForContact(st, contact, chat), chat: chat };
  }

  function getDefaultStyleGuide(contactId) {
    var aps = apStore();
    if (!aps || typeof aps.resolvePresetForContact !== 'function') return '';
    var preset = aps.resolvePresetForContact(contactId);
    return trim(preset && preset.styleGuide);
  }

  function formatLineForApi(line) {
    if (!line) return '';
    if (line.type === 'narration') return '【旁白】' + line.text;
    if (line.type === 'char') return '【' + (line.speakerName || '角色') + '】' + line.text;
    if (line.type === 'user') return '【我】' + line.text;
    return line.text;
  }

  function buildWhisperRulesBlock(charName, isOpening) {
    var rules = [
      '【深夜私语·输出格式·硬性】',
      '你只输出一个合法 JSON 对象，不要 markdown 代码块，不要其它说明。',
      '格式：{"lines":[{"type":"narration|char|user","text":"..."}],"choices":["选项1","选项2","选项3"],"title":"可选短标题"}',
      '- type=narration：环境/心理/动作旁白，第三人称叙事。',
      '- type=char：' + charName + ' 的台词，须符合人设。',
      '- type=user：用户「我」的台词（仅当剧情需要复述用户已选内容时）。',
      '- choices：恰好 3 个简短回复选项（8–28字），供用户下一轮选择；开场白阶段 choices 必须为空数组 []。',
      '- 旁白与台词交替，像乙女游戏/visual novel；每段 text 可含换行。',
      '- 禁止线上聊天格式、表情包、语音标记。',
      '- 亲密程度须符合双方当前关系，禁止 OOC。'
    ];
    if (isOpening) {
      rules.push(
        '',
        '【本场·开场白】',
        '写某一天深夜，用户与' + charName + '静静在一起的画面。',
        'lines 至少 6 条，旁白+角色台词交替；全文合计至少 200 个汉字。',
        '营造夜色、私密感与情感张力；最后一条应是角色台词或旁白收束到等待用户回应的时刻。',
        'choices 必须为 []。'
      );
    } else {
      rules.push(
        '',
        '【本场·续写】',
        '根据用户刚选的回复，继续写旁白与' + charName + ' 的反应。',
        'lines 至少 4 条；最后须自然停在一处适合用户再次开口的地方。',
        'choices 提供 3 个不同态度/方向的回复选项。'
      );
    }
    return rules.join('\n');
  }

  function buildContextBlock(ctx, roomSettings) {
    var st = chatStore();
    var eng = chatEngine();
    var aw = global.MiyaChatAwareness;
    var contact = ctx.contact;
    var profile = ctx.profile;
    var chat = ctx.chat;
    var settings = chat && st && st.getChatSettings ? st.getChatSettings(chat.id) : null;
    var parts = [];
    var charName = trim(contact.name) || '角色';
    var userName = trim(profile && profile.name) || '用户';

    parts.push('【深夜私语·场景】');
    parts.push('这是情侣空间「深夜私语」的私密房间，线下深夜二人独处，乙女游戏式互动。');

    var cts = global.miyaContactsStore;
    var roleId = trim((contact && contact.characterId) || (contact && contact.chronicleId));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var chronicle = trim(cts.renderChronicleBlock(roleId));
      if (chronicle) parts.push(chronicle);
    }

    if (contact.persona) {
      parts.push('【角色·' + charName + '·人设】\n' + trim(contact.persona));
    }
    if (profile) {
      var userLines = ['【用户·我·人设】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.age) userLines.push('- 年龄: ' + profile.age);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      parts.push(userLines.join('\n'));
    }

    if (aw && settings) {
      var rel = aw.buildRelationshipLine(settings, contact);
      if (rel) parts.push(rel);
      var netBlock = aw.buildChronicleRelationshipBlock(contact);
      if (netBlock) parts.push(netBlock);
    }

    var styleGuide = trim(roomSettings && roomSettings.customStyleGuide) || getDefaultStyleGuide(contact.id);
    if (styleGuide) {
      parts.push('【文风·硬性要求】\n' + styleGuide);
    }

    var limit = settings && settings.memoryCount
      ? Math.min(500, Math.max(1, settings.memoryCount))
      : 40;
    var history = chat && st && st.getMessages ? st.getMessages(chat.id) : [];
    var slice = (history || []).filter(function (m) { return m && !m.deleted && !m.offlineMeet; }).slice(-limit);
    var contextText = slice.map(function (m) {
      if (!m) return '';
      return trim(m.content);
    }).filter(Boolean).join('\n');

    if (eng && typeof eng.buildWorldbookBundle === 'function') {
      var wbBundle = eng.buildWorldbookBundle(contact, contextText, null, {
        promptContext: 'offline',
        includeAllBoundLocal: true
      });
      if (wbBundle) {
        if (typeof eng.joinWorldbookBundleText === 'function') {
          var wbText = eng.joinWorldbookBundleText(wbBundle);
          if (wbText) parts.push(wbText);
        } else {
          [].concat(wbBundle.frontLayers || [], wbBundle.layers || [], wbBundle.backLayers || []).forEach(function (layer) {
            if (layer) parts.push(layer);
          });
        }
      }
    }

    var mem = global.MiyaAppointmentMemory;
    if (mem && typeof mem.buildAppointmentCrossMemory === 'function' && chat) {
      var cross = mem.buildAppointmentCrossMemory(chat.id, contact, profile, settings);
      if (cross) {
        if (cross.summaryText) parts.push(String(cross.summaryText));
        if (cross.slotBlock) parts.push(String(cross.slotBlock));
      }
    }

    if (contextText) {
      parts.push('【近期聊天上下文·' + slice.length + '条】\n' + contextText.slice(-4000));
    }

    return parts.filter(Boolean).join('\n\n');
  }

  function buildApiMessages(ctx, session, userChoice, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var contact = ctx.contact;
    var charName = trim(contact.name) || '角色';
    var roomSettings = opts.roomSettings || {};
    var isOpening = !!opts.isOpening;
    var parts = [];

    parts.push(buildContextBlock(ctx, roomSettings));
    parts.push(buildWhisperRulesBlock(charName, isOpening));

    var apiMessages = [{ role: 'system', content: parts.join('\n\n') }];

    if (session && Array.isArray(session.lines) && session.lines.length) {
      var transcript = session.lines.map(formatLineForApi).filter(Boolean).join('\n');
      if (transcript) {
        apiMessages.push({
          role: 'assistant',
          content: '【已进行剧情】\n' + transcript
        });
      }
    }

    if (isOpening) {
      apiMessages.push({
        role: 'user',
        content: '请生成开场白 JSON。'
      });
    } else if (trim(userChoice)) {
      apiMessages.push({
        role: 'user',
        content: '用户选择了：「' + trim(userChoice) + '」。请续写 JSON。'
      });
    }

    return { messages: apiMessages, contact: contact, profile: ctx.profile };
  }

  function extractJson(raw) {
    var s = trim(raw);
    if (!s) return null;
    var eng = chatEngine();
    if (eng && typeof eng.parseThinking === 'function') {
      s = trim((eng.parseThinking(s).content || s));
    }
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch (e1) {}
    }
    try {
      return JSON.parse(s);
    } catch (e2) {
      return null;
    }
  }

  function parseWhisperReply(raw, charName) {
    var data = extractJson(raw);
    if (!data || typeof data !== 'object') {
      return { lines: [], choices: [], title: '' };
    }
    var lines = [];
    if (Array.isArray(data.lines)) {
      data.lines.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var type = trim(row.type).toLowerCase();
        var text = trim(row.text);
        if (!text) return;
        if (type === 'narration' || type === '旁白') {
          lines.push({ type: 'narration', text: text });
        } else if (type === 'char' || type === '角色') {
          lines.push({ type: 'char', text: text, speakerName: charName });
        } else if (type === 'user' || type === '我') {
          lines.push({ type: 'user', text: text, speakerName: '我' });
        }
      });
    }
    var choices = Array.isArray(data.choices)
      ? data.choices.map(trim).filter(Boolean).slice(0, 3)
      : [];
    return {
      lines: lines,
      choices: choices,
      title: trim(data.title)
    };
  }

  function countChars(lines) {
    var n = 0;
    (lines || []).forEach(function (l) {
      if (l && l.text) n += l.text.replace(/\s/g, '').length;
    });
    return n;
  }

  function runCompletion(ctx, session, userChoice, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var eng = chatEngine();
    var ready = eng && typeof eng.ensureWorldbookDepsReady === 'function'
      ? eng.ensureWorldbookDepsReady()
      : Promise.resolve();

    return ready.then(function () {
      var built = buildApiMessages(ctx, session, userChoice, opts);
      if (!built.messages || !built.messages.length) {
        return Promise.reject(new Error('build_failed'));
      }

      var cfg = getApiConfig();
      function callWithSlice(slice, usedSecondary) {
        if (!slice.baseUrl || !slice.apiKey || !slice.model) {
          return Promise.reject(new Error(usedSecondary ? 'secondary_api_not_configured' : 'api_not_configured'));
        }
        var url = slice.baseUrl + '/chat/completions';
        var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + slice.apiKey };
        var payload = { model: slice.model, messages: built.messages, temperature: slice.temperature };
        return fetchCompletion(url, headers, payload, 1);
      }

      function attempt(isOpening, tryNo) {
        tryNo = tryNo || 1;
        return callWithSlice(resolveApiSlice(cfg, false), false)
          .catch(function (err) {
            if (!cfg.fallbackToSecondary || !hasSecondaryApi(cfg)) throw err;
            return callWithSlice(resolveApiSlice(cfg, true), true);
          })
          .then(function (completion) {
            var charName = trim(built.contact && built.contact.name) || '角色';
            var parsed = parseWhisperReply(completion.replyRaw, charName);
            if (!parsed.lines.length) throw new Error('empty_reply');
            if (isOpening && countChars(parsed.lines) < 200 && tryNo < 2) {
              return attempt(isOpening, tryNo + 1);
            }
            return parsed;
          });
      }

      return attempt(!!opts.isOpening, 1);
    });
  }

  function fmtApiErr(err) {
    var m = err && err.message ? err.message : '';
    if (m === 'api_not_configured' || m === 'secondary_api_not_configured') {
      return '请先在系统设置中配置 API';
    }
    if (m === 'empty_reply') return '生成失败，请重试';
    if (m === 'build_failed') return '无法构建请求';
    if (m && m.indexOf('HTTP ') === 0) return 'API 请求失败，请检查设置';
    return m ? m.slice(0, 80) : '生成失败';
  }

  global.miyaCoupleWhisperEngine = {
    resolveChatForContact: resolveChatForContact,
    getDefaultStyleGuide: getDefaultStyleGuide,
    runCompletion: runCompletion,
    parseWhisperReply: parseWhisperReply,
    fmtApiErr: fmtApiErr,
    countChars: countChars
  };
})(typeof window !== 'undefined' ? window : global);
