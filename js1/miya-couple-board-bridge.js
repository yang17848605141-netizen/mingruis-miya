/**
 * miya-couple-board-bridge.js — 留言板 · 上下文拼装与 API 生成
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function isoDate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
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

  function tryParseJson(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    if (i < 0) {
      var ai = t.indexOf('[');
      if (ai < 0) return null;
      try { return JSON.parse(t.slice(ai)); } catch (e0) { return null; }
    }
    var j = t.lastIndexOf('}');
    if (j <= i) {
      try { return JSON.parse(t.slice(i)); } catch (e1) { return null; }
    }
    try { return JSON.parse(t.slice(i, j + 1)); } catch (e2) {
      try { return JSON.parse(t.slice(i)); } catch (e3) { return null; }
    }
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    reqOpts = reqOpts && typeof reqOpts === 'object' ? reqOpts : {};
    var opts = Object.assign({
      temperature: 0.9,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true
    }, reqOpts);
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, null, opts);
    }
    if (br && typeof br.callMainChatCompletionsRaw === 'function') {
      return br.callMainChatCompletionsRaw(systemHint, userContent, null, opts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent, null);
    }
    return Promise.reject(new Error('API 模块未加载'));
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

  var COUPLE_BOARD_SCENE =
    '【场景】这是在情侣空间「留言板」里的双人软木板——恋人会随手贴便利贴、折叠条、挑战与胶囊，角色也会主动贴留言。' +
    '不是私聊也不是朋友圈；你须明确意识到这是在情侣空间留言板上的互动，语气可轻松、搞怪或温柔，像真实恋人之间的便签。';

  var BOARD_COLORS = ['rose', 'sky', 'gold', 'mint', 'lemon', 'lavender', 'coral'];
  var BOARD_STICKERS = ['♡', '☕', '🌧️', '✨', '🥺', '🌙', '🎵', '🍰', '🌸', '💫'];

  var PROMPT_POOL = [
    '如果只能瞬移，想带我去哪？',
    '最近一个关于我的小幻想是什么？',
    '用三个词形容现在的我们',
    '这周最想和我一起做的一件小事？',
    '说一件你偷偷为我开心的事',
    '假如我们现在在同一张沙发，你想做什么？',
    '给我一个只有我们才懂的暗号',
    '今天最想收到我什么反应？'
  ];

  function buildBoardContext(contactId) {
    var checkinBr = global.miyaCoupleCheckinBridge;
    if (checkinBr && typeof checkinBr.buildCheckInContext === 'function') {
      var ctx = checkinBr.buildCheckInContext(contactId);
      if (!ctx) return null;
      var boardSnip = buildBoardSnippet(contactId);
      if (boardSnip) {
        ctx.contextText = ctx.contextText + '\n\n' + boardSnip;
      }
      return ctx;
    }
    return null;
  }

  function buildBoardSnippet(contactId) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !cpStore.getBoard) return '';
    var list = cpStore.getBoard(contactId).slice(0, 12);
    if (!list.length) return '';
    var cs = global.miyaChatStore;
    var sp = cpStore.getSpace(contactId);
    var profileName = sp && sp.profileName ? sp.profileName : '我';
    var charName = sp && sp.charName ? sp.charName : 'TA';
    return [
      '【留言板近期便签】',
      list.map(function (e) {
        var who = e.author === 'user' ? profileName : charName;
        var tag = e.type === 'challenge' ? '[挑战]' :
          e.type === 'capsule' ? '[胶囊]' :
          e.type === 'fold' ? '[折叠]' :
          e.type === 'prompt' ? '[问答]' : '';
        return who + tag + '：' + truncateStr(e.text, 100);
      }).join('\n')
    ].join('\n');
  }

  function typeLabel(type) {
    if (type === 'fold') return '折叠条';
    if (type === 'challenge') return '挑战贴';
    if (type === 'capsule') return '胶囊贴';
    if (type === 'prompt') return '双贴问答';
    if (type === 'reply') return '回音贴';
    return '随手贴';
  }

  function randomPick(arr) {
    if (!arr || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randomCount(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function parseTimeAt(timeStr) {
    var m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return { h: Math.min(23, Math.max(0, parseInt(m[1], 10))), min: Math.min(59, Math.max(0, parseInt(m[2], 10))) };
  }

  function timeToSortKey(dateIso, timeAt) {
    var tm = parseTimeAt(timeAt);
    if (!tm) return Date.now();
    return new Date(dateIso + 'T' + pad(tm.h) + ':' + pad(tm.min) + ':00').getTime();
  }

  function normalizeApiNote(raw, fallbackDate) {
    if (!raw || typeof raw !== 'object') return null;
    var text = trim(raw.text || raw.body || raw.content || raw.message);
    if (!text) return null;
    var type = trim(raw.type || 'sticky').toLowerCase();
    if (type !== 'sticky' && type !== 'fold' && type !== 'challenge') type = 'sticky';
    var color = trim(raw.color || randomPick(BOARD_COLORS)).toLowerCase();
    if (BOARD_COLORS.indexOf(color) < 0) color = randomPick(BOARD_COLORS);
    return {
      type: type,
      text: text,
      color: color,
      mood: trim(raw.mood || raw.emotion),
      sticker: trim(raw.sticker || randomPick(BOARD_STICKERS)),
      timeAt: trim(raw.timeAt || raw.time)
    };
  }

  function parseDailyNotes(text, todayIso) {
    var obj = tryParseJson(text);
    var notes = [];
    if (Array.isArray(obj)) notes = obj;
    else if (obj && Array.isArray(obj.notes)) notes = obj.notes;
    else if (obj && Array.isArray(obj.entries)) notes = obj.entries;
    else if (obj && Array.isArray(obj.messages)) notes = obj.messages;
    if (!notes.length) throw new Error('生成格式无效');
    return notes.map(function (n) {
      return normalizeApiNote(n, todayIso);
    }).filter(Boolean);
  }

  function buildDailySystemPrompt(charName) {
    return (
      '你是「' + charName + '」。' + COUPLE_BOARD_SCENE +
      '须以角色第一人称，为恋人在留言板上主动贴 2-4 条今日便签（不同时间点、内容各异）。' +
      '可混合随手贴、折叠条、挑战贴；语气可温柔日常或轻微搞怪，须严格贴合人设与关系。' +
      '只输出 JSON，不要 markdown，首字符必须是 {。' +
      '格式：{"notes":[{"type":"sticky|fold|challenge","timeAt":"HH:mm","text":"15-80字","color":"rose|sky|gold|mint|lemon|lavender|coral","mood":"心情词","sticker":"单个 emoji"}]}。' +
      '【硬性】notes 数量 2-4 条；timeAt 必填且 24 小时制，从早到晚递增且不重复；禁止提及 AI、系统、提示词。'
    );
  }

  function buildDailyUserPrompt(ctx, todayIso, count) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');
    var seed = Math.floor(Math.random() * 99999);
    return [
      '【角色设定·用户面具·双方关系·世界书·聊天记忆·必读】',
      ctx.contextText,
      '',
      '【生成任务 · 留言板 · 角色今日主动便签】',
      '为角色「' + charName + '」生成今天 ' + todayIso + ' 在情侣空间留言板上主动贴给恋人「' + profileName + '」的便签。',
      '随机种子 ' + seed + '（勿提及）。',
      '要求：',
      '- 恰好 ' + count + ' 条 notes',
      '- 每条 timeAt 不同，覆盖今天不同时段（如 09:15、13:40、18:20、22:05）',
      '- 内容像真实恋人随手留言：想念、撒娇、分享小事、土味情话、轻微挑战均可',
      '- 至少 1 条 sticky，可含 1 条 fold 或 challenge',
      '- 只输出 JSON'
    ].join('\n');
  }

  function generateCharDailyBoard(contactId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var ctx = buildBoardContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var todayIso = cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date());
    var count = randomCount(2, 4);
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var charName = trim(ctx.contact && ctx.contact.name || '角色');

    if (onProgress) onProgress({ phase: 'daily', message: '正在生成 TA 今日留言…' });

    return callApi(
      buildDailySystemPrompt(charName),
      buildDailyUserPrompt(ctx, todayIso, count),
      { temperature: 0.92 }
    ).then(function (res) {
      var text = extractApiText(res);
      var notes = parseDailyNotes(text, todayIso);
      if (notes.length < 2) throw new Error('生成条数不足，请重试');

      notes = notes.slice(0, 4);
      notes.sort(function (a, b) {
        return timeToSortKey(todayIso, a.timeAt) - timeToSortKey(todayIso, b.timeAt);
      });

      cpStore.removeCharBoardDailyForDate(contactId, todayIso);

      var saved = [];
      notes.forEach(function (note, idx) {
        var entry = cpStore.addBoardEntry(contactId, {
          type: note.type,
          author: 'char',
          source: 'char_daily',
          text: note.text,
          color: note.color,
          mood: note.mood,
          sticker: note.sticker,
          timeAt: note.timeAt,
          dateIso: todayIso,
          createdAt: timeToSortKey(todayIso, note.timeAt) || (Date.now() + idx)
        });
        if (entry) saved.push(entry);
      });

      if (!saved.length) throw new Error('保存失败');
      cpStore.markBoardCharRefresh(contactId, todayIso);
      return { entries: saved, count: saved.length };
    });
  }

  function buildReplySystemPrompt(charName, noteType) {
    var kind = typeLabel(noteType);
    return (
      '你是「' + charName + '」。' + COUPLE_BOARD_SCENE +
      '恋人刚在留言板贴了一条「' + kind + '」，请作为角色回贴一条邻近的便签（不是聊天气泡）。' +
      '语气口语化、有陪伴感，15-80 字；可温柔可搞怪，须贴合人设。' +
      '只输出 JSON：{"text":"回贴内容","color":"rose|sky|gold|mint|lemon|lavender|coral","mood":"心情词","sticker":"单个emoji","type":"reply|sticky|fold"}。' +
      '不要 markdown，首字符必须是 {。'
    );
  }

  function buildChallengeSystemPrompt(charName) {
    return (
      '你是「' + charName + '」。' + COUPLE_BOARD_SCENE +
      '恋人贴了一条「挑战贴」，请接招并回贴（接受挑战 + 完成/回应内容合一）。' +
      '可俏皮、可甜蜜，20-100 字，像恋人之间的游戏。' +
      '只输出 JSON：{"text":"接招回贴","color":"rose|sky|gold|mint|lemon|lavender|coral","mood":"心情词","sticker":"emoji","status":"done"}。' +
      '不要 markdown，首字符必须是 {。'
    );
  }

  function requestCharBoardReply(contactId, parentEntry, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !parentEntry) return Promise.reject(new Error('留言不存在'));

    var ctx = buildBoardContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');
    var isChallenge = parentEntry.type === 'challenge';

    if (onProgress) {
      onProgress({
        phase: 'reply',
        message: isChallenge ? 'TA 正在接挑战…' : 'TA 正在写回贴…'
      });
    }

    var system = isChallenge
      ? buildChallengeSystemPrompt(charName)
      : buildReplySystemPrompt(charName, parentEntry.type);

    var userPrompt = [
      ctx.contextText,
      '',
      '【恋人刚贴的便签】',
      '类型：' + typeLabel(parentEntry.type),
      '内容：' + parentEntry.text,
      parentEntry.mood ? '心情：' + parentEntry.mood : '',
      '',
      '【任务】请作为「' + charName + '」回贴给「' + profileName + '」。',
      COUPLE_BOARD_SCENE,
      '只输出 JSON'
    ].filter(Boolean).join('\n');

    return callApi(system, userPrompt, { temperature: 0.88 }).then(function (res) {
      var text = extractApiText(res);
      var obj = tryParseJson(text) || {};
      var replyText = trim(obj.text || obj.reply || obj.content || obj.message);
      if (!replyText) {
        var cleaned = stripThinkingNoise(text);
        if (cleaned && cleaned.length < 120 && cleaned.indexOf('{') < 0) replyText = cleaned;
      }
      if (!replyText) throw new Error('角色回贴为空');

      var color = trim(obj.color || randomPick(BOARD_COLORS));
      if (BOARD_COLORS.indexOf(color) < 0) color = randomPick(BOARD_COLORS);

      if (isChallenge) {
        cpStore.updateBoardEntry(contactId, parentEntry.id, {
          challengeStatus: trim(obj.status) || 'done'
        });
      }

      var reply = cpStore.addBoardEntry(contactId, {
        type: isChallenge ? 'reply' : (trim(obj.type) === 'fold' ? 'fold' : 'reply'),
        author: 'char',
        source: 'char_reply',
        text: replyText,
        color: color,
        mood: trim(obj.mood),
        sticker: trim(obj.sticker || randomPick(BOARD_STICKERS)),
        parentId: parentEntry.id,
        dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date()),
        timeAt: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()),
        folded: trim(obj.type) === 'fold'
      });
      if (!reply) throw new Error('保存回贴失败');
      return reply;
    });
  }

  function createUserBoardNote(contactId, payload, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var data = payload && typeof payload === 'object' ? payload : {};
    var text = trim(data.text);
    if (!text) return Promise.reject(new Error('内容不能为空'));

    var type = trim(data.type || 'sticky');
    if (type !== 'sticky' && type !== 'fold' && type !== 'challenge' && type !== 'capsule') {
      type = 'sticky';
    }

    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var todayIso = cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date());
    var color = trim(data.color || 'rose');
    if (BOARD_COLORS.indexOf(color) < 0) color = 'rose';

    var entry = cpStore.addBoardEntry(contactId, {
      type: type,
      author: 'user',
      source: 'user',
      text: text,
      color: color,
      mood: trim(data.mood),
      sticker: trim(data.sticker),
      revealAt: type === 'capsule' ? trim(data.revealAt) : '',
      revealed: type !== 'capsule',
      folded: type === 'fold',
      challengeStatus: type === 'challenge' ? 'pending' : '',
      dateIso: todayIso,
      timeAt: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())
    });
    if (!entry) return Promise.reject(new Error('保存失败'));

    if (type === 'capsule') {
      return Promise.resolve({ entry: entry, charReply: null });
    }

    if (onProgress) onProgress({ phase: 'reply', message: '等待 TA 回贴…' });

    return requestCharBoardReply(contactId, entry, opts).then(function (reply) {
      return { entry: entry, charReply: reply };
    }).catch(function (err) {
      return {
        entry: entry,
        charReply: null,
        replyError: err && err.message ? err.message : '角色回贴失败'
      };
    });
  }

  function buildPromptSystemPrompt(charName) {
    return (
      '你是「' + charName + '」。' + COUPLE_BOARD_SCENE +
      '请为情侣空间留言板生成本周「双贴问答」：一个问题 + 你的回答。' +
      '问题应有趣、亲密、可引发共鸣；回答 20-80 字，第一人称，贴合人设。' +
      '只输出 JSON：{"question":"问题","answer":"你的回答","color":"rose|sky|gold|mint|lemon|lavender|coral","mood":"心情词","sticker":"emoji"}。' +
      '不要 markdown，首字符必须是 {。'
    );
  }

  function ensureWeeklyPrompt(contactId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var weekKey = cpStore.isoWeekKey ? cpStore.isoWeekKey() : '';
    var existing = cpStore.getBoardPromptForWeek(contactId, weekKey);
    if (existing) return Promise.resolve({ entry: existing, created: false });

    var ctx = buildBoardContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');
    var fallbackQ = randomPick(PROMPT_POOL);

    if (onProgress) onProgress({ phase: 'prompt', message: '正在生成本周问答…' });

    var userPrompt = [
      ctx.contextText,
      '',
      '【任务】为恋人「' + profileName + '」生成本周双贴问答。',
      '可参考方向（可改写）：' + fallbackQ,
      COUPLE_BOARD_SCENE,
      '只输出 JSON'
    ].join('\n');

    return callApi(buildPromptSystemPrompt(charName), userPrompt, { temperature: 0.9 }).then(function (res) {
      var text = extractApiText(res);
      var obj = tryParseJson(text) || {};
      var question = trim(obj.question || obj.prompt || obj.title || fallbackQ);
      var answer = trim(obj.answer || obj.text || obj.body);
      if (!answer) throw new Error('问答生成无效');

      var color = trim(obj.color || randomPick(BOARD_COLORS));
      if (BOARD_COLORS.indexOf(color) < 0) color = randomPick(BOARD_COLORS);

      var entry = cpStore.addBoardEntry(contactId, {
        type: 'prompt',
        author: 'char',
        source: 'char_prompt',
        text: question,
        color: color,
        mood: trim(obj.mood),
        sticker: trim(obj.sticker || '✨'),
        promptId: weekKey,
        dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date()),
        meta: { charAnswer: answer }
      });
      if (!entry) throw new Error('保存问答失败');

      cpStore.addBoardEntry(contactId, {
        type: 'reply',
        author: 'char',
        source: 'char_prompt_answer',
        text: answer,
        color: color,
        parentId: entry.id,
        promptId: weekKey,
        dateIso: entry.dateIso
      });

      cpStore.markBoardPromptWeek(contactId, weekKey);
      return { entry: entry, created: true };
    });
  }

  function submitChallengeAnswer(contactId, challengeEntryId, answerText) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));
    var text = trim(answerText);
    if (!text) return Promise.reject(new Error('请填写回答'));

    var challengeEntry = cpStore.findBoardEntry(contactId, challengeEntryId);
    if (!challengeEntry || challengeEntry.type !== 'challenge') {
      return Promise.reject(new Error('挑战不存在'));
    }

    var existing = cpStore.getBoard(contactId).find(function (e) {
      return e && e.type === 'reply' && e.author === 'user' && e.parentId === challengeEntryId &&
        e.source === 'user_challenge_answer';
    });
    if (existing) {
      cpStore.updateBoardEntry(contactId, existing.id, { text: text });
      return Promise.resolve(existing);
    }

    var entry = cpStore.addBoardEntry(contactId, {
      type: 'reply',
      author: 'user',
      source: 'user_challenge_answer',
      text: text,
      color: challengeEntry.color || 'sky',
      mood: trim(challengeEntry.mood),
      parentId: challengeEntryId,
      dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date()),
      timeAt: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())
    });
    if (!entry) return Promise.reject(new Error('保存失败'));
    return Promise.resolve(entry);
  }

  function submitPromptAnswer(contactId, promptEntryId, answerText) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));
    var text = trim(answerText);
    if (!text) return Promise.reject(new Error('请填写回答'));

    var promptEntry = cpStore.findBoardEntry(contactId, promptEntryId);
    if (!promptEntry || promptEntry.type !== 'prompt') {
      return Promise.reject(new Error('问答不存在'));
    }

    var existing = cpStore.getBoard(contactId).find(function (e) {
      return e && e.type === 'reply' && e.author === 'user' && e.parentId === promptEntryId &&
        e.source === 'user_prompt_answer';
    });
    if (existing) {
      cpStore.updateBoardEntry(contactId, existing.id, { text: text });
      return Promise.resolve(existing);
    }

    var entry = cpStore.addBoardEntry(contactId, {
      type: 'reply',
      author: 'user',
      source: 'user_prompt_answer',
      text: text,
      color: promptEntry.color || 'sky',
      parentId: promptEntryId,
      promptId: promptEntry.promptId,
      dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date())
    });
    if (!entry) return Promise.reject(new Error('保存失败'));
    return Promise.resolve(entry);
  }

  function getPromptThreadReplies(cpStore, contactId, promptEntryId) {
    return cpStore.getBoard(contactId).filter(function (e) {
      return e && e.type === 'reply' && e.parentId === promptEntryId;
    }).sort(function (a, b) {
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  function buildPromptThreadSnippet(ctx, promptEntry, threadReplies) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');
    var lines = ['问题：' + promptEntry.text];
    var charAnswer = promptEntry.meta && promptEntry.meta.charAnswer
      ? trim(promptEntry.meta.charAnswer) : '';
    if (charAnswer) lines.push(charName + '：' + charAnswer);
    threadReplies.forEach(function (r) {
      if (r.source === 'char_prompt_answer' && charAnswer) return;
      var who = r.author === 'user' ? profileName : charName;
      lines.push(who + '：' + r.text);
    });
    return lines.join('\n');
  }

  function buildPromptThreadSystemPrompt(charName) {
    return (
      '你是「' + charName + '」。' + COUPLE_BOARD_SCENE +
      '恋人正在与你进行留言板「双贴问答」的后续对话——请接着上文的问答脉络，再贴一条便签回应。' +
      '语气口语化、有陪伴感，15-80 字；可温柔可搞怪，须贴合人设。' +
      '只输出 JSON：{"text":"回贴内容","color":"rose|sky|gold|mint|lemon|lavender|coral","mood":"心情词","sticker":"单个emoji"}。' +
      '不要 markdown，首字符必须是 {。'
    );
  }

  function submitPromptContinueAnswer(contactId, promptEntryId, answerText) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));
    var text = trim(answerText);
    if (!text) return Promise.reject(new Error('请填写回答'));

    var promptEntry = cpStore.findBoardEntry(contactId, promptEntryId);
    if (!promptEntry || promptEntry.type !== 'prompt') {
      return Promise.reject(new Error('问答不存在'));
    }

    var thread = getPromptThreadReplies(cpStore, contactId, promptEntryId);
    var last = thread[thread.length - 1];
    if (last && last.author === 'user') {
      return Promise.reject(new Error('等 TA 先回贴'));
    }

    var entry = cpStore.addBoardEntry(contactId, {
      type: 'reply',
      author: 'user',
      source: 'user_prompt_continue',
      text: text,
      color: promptEntry.color || 'sky',
      parentId: promptEntryId,
      promptId: promptEntry.promptId,
      dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date()),
      timeAt: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())
    });
    if (!entry) return Promise.reject(new Error('保存失败'));
    return Promise.resolve(entry);
  }

  function requestPromptThreadReply(contactId, promptEntryId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var promptEntry = cpStore.findBoardEntry(contactId, promptEntryId);
    if (!promptEntry || promptEntry.type !== 'prompt') {
      return Promise.reject(new Error('问答不存在'));
    }

    var thread = getPromptThreadReplies(cpStore, contactId, promptEntryId);
    var last = thread[thread.length - 1];
    if (!last || last.author !== 'user') {
      return Promise.reject(new Error('请先写下你的回答'));
    }

    var ctx = buildBoardContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');

    if (onProgress) onProgress({ phase: 'prompt_reply', message: 'TA 正在写回贴…' });

    var userPrompt = [
      ctx.contextText,
      '',
      '【双贴问答 · 当前对话】',
      buildPromptThreadSnippet(ctx, promptEntry, thread),
      '',
      '【任务】恋人「' + profileName + '」刚贴了上一条，请作为「' + charName + '」继续回应。',
      COUPLE_BOARD_SCENE,
      '只输出 JSON'
    ].join('\n');

    return callApi(buildPromptThreadSystemPrompt(charName), userPrompt, { temperature: 0.88 }).then(function (res) {
      var text = extractApiText(res);
      var obj = tryParseJson(text) || {};
      var replyText = trim(obj.text || obj.reply || obj.content || obj.message);
      if (!replyText) {
        var cleaned = stripThinkingNoise(text);
        if (cleaned && cleaned.length < 120 && cleaned.indexOf('{') < 0) replyText = cleaned;
      }
      if (!replyText) throw new Error('角色回贴为空');

      var color = trim(obj.color || randomPick(BOARD_COLORS));
      if (BOARD_COLORS.indexOf(color) < 0) color = randomPick(BOARD_COLORS);

      var reply = cpStore.addBoardEntry(contactId, {
        type: 'reply',
        author: 'char',
        source: 'char_prompt_continue',
        text: replyText,
        color: color,
        mood: trim(obj.mood),
        sticker: trim(obj.sticker || randomPick(BOARD_STICKERS)),
        parentId: promptEntryId,
        promptId: promptEntry.promptId,
        dateIso: cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date()),
        timeAt: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())
      });
      if (!reply) throw new Error('保存回贴失败');
      return reply;
    });
  }

  global.miyaCoupleBoardBridge = {
    buildBoardContext: buildBoardContext,
    generateCharDailyBoard: generateCharDailyBoard,
    createUserBoardNote: createUserBoardNote,
    requestCharBoardReply: requestCharBoardReply,
    ensureWeeklyPrompt: ensureWeeklyPrompt,
    submitPromptAnswer: submitPromptAnswer,
    submitChallengeAnswer: submitChallengeAnswer,
    submitPromptContinueAnswer: submitPromptContinueAnswer,
    requestPromptThreadReply: requestPromptThreadReply,
    BOARD_COLORS: BOARD_COLORS,
    BOARD_STICKERS: BOARD_STICKERS
  };
})(typeof window !== 'undefined' ? window : global);
