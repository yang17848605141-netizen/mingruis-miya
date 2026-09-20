/**
 * miya-match-store.js — 赛事场次、内置/自定义项目、本地持久化
 * source: builtin | user_custom | char_invite
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-match-sessions-v1';
  var PRESET_KEY = 'miya-match-prize-presets-v1';
  var CUSTOM_KEY = 'miya-match-custom-items-v1';
  var MAX_SESSIONS = 80;
  var MAX_CUSTOM = 60;
  var NAME_MAX = 40;
  var DESC_MAX = 2000;
  var MOOD_MAX = 500;
  var EXPORT_ITEM = 'miya-match-custom-item';
  var EXPORT_PACK = 'miya-match-custom-pack';

  var OLYMPICS_ITEMS = [
    { id: 'run', name: '跑步', desc: '短距冲刺，比拼爆发与耐力', mood: '田径赛场、起跑枪声、汗水与喘息' },
    { id: 'tug', name: '拔河', desc: '绳两端对峙，比拼合力与意志', mood: '拔河绳紧绷、脚底刨地、阵营呐喊' },
    { id: 'rope', name: '跳绳', desc: '节奏与体能的双重考验', mood: '跳绳声脆响、计数板、喘息节奏' },
    { id: 'swim', name: '游泳', desc: '泳池竞速，比拼水性与节奏', mood: '水花飞溅、转身蹬壁、终点触壁' },
    { id: 'jump', name: '跳远', desc: '助跑起跳，比拼远度', mood: '沙坑、助跑道、丈量皮尺' },
    { id: 'throw', name: '投掷', desc: '力量与准度的一掷', mood: '投掷区、弧线轨迹、落地标记' },
    { id: 'situp', name: '仰卧起坐', desc: '限时比拼核心耐力', mood: '垫子、秒表、计数员催促' },
    { id: 'relay', name: '接力', desc: '交接棒配合与速度', mood: '接力区、交接棒、追赶冲刺' },
    { id: 'hurdle', name: '障碍跑', desc: '跨越障碍的综合赛跑', mood: '障碍栏、绊脚险情、翻越瞬间' },
    { id: 'lift', name: '举重', desc: '极限负重的一举', mood: '杠铃、镁粉、裁判举旗' }
  ];

  var TALENT_ITEMS = [
    { id: 'sing', name: '唱歌', desc: '歌声与舞台感染力', mood: '舞台灯光、麦克风、掌声与走音紧张' },
    { id: 'dance', name: '跳舞', desc: '肢体表达与节奏感', mood: '舞池、节拍、呼吸与转体' },
    { id: 'paint', name: '绘画', desc: '限时创作比拼', mood: '画架、颜料味、笔触与点评' },
    { id: 'instrument', name: '乐器', desc: '演奏技巧与情感', mood: '琴键/弦声、走音瞬间、余韵' },
    { id: 'act', name: '演技', desc: '即兴或命题表演', mood: '聚光灯、台词、破功与入戏' },
    { id: 'talk', name: '脱口秀', desc: '包袱与临场反应', mood: '话筒、冷场、笑声与互动' },
    { id: 'magic', name: '魔术', desc: '手法与舞台呈现', mood: '扑克/丝巾、惊呼、露馅边缘' },
    { id: 'calligraphy', name: '书法', desc: '笔锋与气韵', mood: '宣纸、墨香、落笔与点评' },
    { id: 'cook', name: '厨艺', desc: '味道与摆盘', mood: '灶台热气、试吃、味觉评判' },
    { id: 'photo', name: '摄影', desc: '构图与瞬间捕捉', mood: '快门声、取景框、样片对比' }
  ];

  var EVENTS = {
    olympics: { id: 'olympics', name: '咪运会', subtitle: '体力项目 · 单项决胜', items: OLYMPICS_ITEMS },
    talent: { id: 'talent', name: '才艺大赛', subtitle: '舞台与创作 · 单项比拼', items: TALENT_ITEMS },
    custom: { id: 'custom', name: '自定义比赛', subtitle: '自定项目与规则', items: [] }
  };

  var cache = null;
  var presetCache = null;
  var customCache = null;

  function uid(prefix) {
    return (prefix || 'm') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function safeParse(raw, fallback) {
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function clip(s, max) {
    var t = String(s == null ? '' : s).trim();
    if (!max || t.length <= max) return t;
    return t.slice(0, max);
  }

  function loadSessions() {
    if (cache) return cache;
    var raw = '';
    try {
      raw = localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {}
    var data = safeParse(raw, { sessions: [] });
    if (!data || !Array.isArray(data.sessions)) data = { sessions: [] };
    cache = data;
    return cache;
  }

  function saveSessions() {
    var data = loadSessions();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function loadPresets() {
    if (presetCache) return presetCache;
    var raw = '';
    try {
      raw = localStorage.getItem(PRESET_KEY) || '';
    } catch (e) {}
    presetCache = safeParse(raw, {}) || {};
    return presetCache;
  }

  function savePresets() {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(loadPresets()));
    } catch (e) {}
  }

  function loadCustom() {
    if (customCache) return customCache;
    var raw = '';
    try {
      raw = localStorage.getItem(CUSTOM_KEY) || '';
    } catch (e) {}
    var data = safeParse(raw, { version: 1, items: [] });
    if (!data || !Array.isArray(data.items)) data = { version: 1, items: [] };
    data.version = 1;
    customCache = data;
    return customCache;
  }

  function saveCustom() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(loadCustom()));
    } catch (e) {}
  }

  function getEvent(eventId) {
    return EVENTS[eventId] || null;
  }

  function getEventItem(eventId, itemId) {
    if (eventId === 'custom') {
      return getCustomItem(itemId);
    }
    var ev = getEvent(eventId);
    if (!ev) return null;
    return (ev.items || []).find(function (it) {
      return it && it.id === itemId;
    }) || null;
  }

  function listSessions() {
    return loadSessions().sessions.slice().sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function findSession(id) {
    var sid = String(id || '').trim();
    if (!sid) return null;
    return loadSessions().sessions.find(function (s) {
      return s && String(s.id) === sid;
    }) || null;
  }

  function normalizePrizes(raw, mode) {
    var p = raw && typeof raw === 'object' ? raw : {};
    if (mode === 'team') {
      return {
        teamWin: String(p.teamWin || '').trim(),
        teamLose: String(p.teamLose || '').trim(),
        mvp: String(p.mvp || '').trim()
      };
    }
    var ranks = Array.isArray(p.soloRanks) ? p.soloRanks.slice(0, 8) : [];
    while (ranks.length < 8) ranks.push('');
    return { soloRanks: ranks.map(function (x) { return String(x || '').trim(); }) };
  }

  function normalizeCustomItem(raw, keepId) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var name = clip(r.name, NAME_MAX);
    var desc = clip(r.desc, DESC_MAX);
    if (!name || !desc) return null;
    var mode = r.defaultMode === 'team' ? 'team' : (r.defaultMode === 'solo' ? 'solo' : '');
    var item = {
      id: keepId && r.id ? String(r.id) : uid('mc'),
      name: name,
      desc: desc,
      mood: clip(r.mood, MOOD_MAX),
      defaultMode: mode,
      pitch: clip(r.pitch, 800),
      proposerContactId: String(r.proposerContactId || '').trim(),
      proposerName: clip(r.proposerName, 40),
      fromChar: !!(r.fromChar || r.proposerContactId || r.sourceHint === 'char_invite'),
      createdAt: Number(r.createdAt) || Date.now(),
      updatedAt: Number(r.updatedAt) || Date.now()
    };
    if (r.defaultPrizes && typeof r.defaultPrizes === 'object') {
      item.defaultPrizes = normalizePrizes(r.defaultPrizes, mode || 'solo');
    } else {
      item.defaultPrizes = null;
    }
    return item;
  }

  function listCustomItems() {
    return loadCustom().items.slice().sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function getCustomItem(id) {
    var cid = String(id || '').trim();
    if (!cid) return null;
    return loadCustom().items.find(function (it) {
      return it && String(it.id) === cid;
    }) || null;
  }

  function saveCustomItem(partial) {
    var data = loadCustom();
    var incoming = partial && typeof partial === 'object' ? partial : {};
    var existing = incoming.id ? getCustomItem(incoming.id) : null;
    var merged = Object.assign({}, existing || {}, incoming);
    if (existing) {
      merged.id = existing.id;
      merged.createdAt = existing.createdAt;
    } else {
      delete merged.id;
    }
    var item = normalizeCustomItem(merged, !!existing);
    if (!item) throw new Error('请填写项目名称与说明');
    item.updatedAt = Date.now();
    if (existing) {
      data.items = data.items.map(function (it) {
        return String(it.id) === String(item.id) ? item : it;
      });
    } else {
      if (data.items.length >= MAX_CUSTOM) {
        throw new Error('自定义项目最多 ' + MAX_CUSTOM + ' 个');
      }
      data.items.unshift(item);
    }
    saveCustom();
    return item;
  }

  function deleteCustomItem(id, opts) {
    opts = opts || {};
    var cid = String(id || '').trim();
    if (!cid) return false;
    var data = loadCustom();
    var before = data.items.length;
    data.items = data.items.filter(function (it) {
      return !it || String(it.id) !== cid;
    });
    if (data.items.length === before) return false;
    saveCustom();
    if (opts.purgeDrafts !== false) {
      var sessions = loadSessions();
      sessions.sessions = sessions.sessions.filter(function (s) {
        if (!s) return false;
        if (s.status !== 'draft') return true;
        if (String(s.eventItemId) !== cid) return true;
        if (s.source !== 'user_custom' && s.source !== 'char_invite') return true;
        return false;
      });
      saveSessions();
    }
    return true;
  }

  function exportCustomPayload(ids) {
    var all = listCustomItems();
    var want = null;
    if (Array.isArray(ids) && ids.length) {
      var set = {};
      ids.forEach(function (id) { set[String(id)] = true; });
      want = all.filter(function (it) { return set[String(it.id)]; });
    } else {
      want = all;
    }
    function strip(it) {
      return {
        name: it.name,
        desc: it.desc,
        mood: it.mood || '',
        defaultMode: it.defaultMode || '',
        pitch: it.pitch || '',
        fromChar: !!it.fromChar,
        proposerName: it.proposerName || '',
        defaultPrizes: it.defaultPrizes || null
      };
    }
    if (want.length === 1) {
      return {
        format: EXPORT_ITEM,
        version: 1,
        item: strip(want[0])
      };
    }
    return {
      format: EXPORT_PACK,
      version: 1,
      items: want.map(strip)
    };
  }

  function parseImportPayload(raw) {
    var data = typeof raw === 'string' ? safeParse(raw, null) : raw;
    if (!data || typeof data !== 'object') return null;
    var rows = [];
    if (data.format === EXPORT_ITEM || data.item) {
      var one = normalizeCustomItem(data.item || data, false);
      if (one) rows.push(one);
    } else if (data.format === EXPORT_PACK || Array.isArray(data.items)) {
      (data.items || []).forEach(function (row) {
        var n = normalizeCustomItem(row, false);
        if (n) rows.push(n);
      });
    } else if (data.name && data.desc) {
      var single = normalizeCustomItem(data, false);
      if (single) rows.push(single);
    }
    if (!rows.length) return null;
    return rows;
  }

  function importCustomItems(payload, opts) {
    opts = opts || {};
    var rows = parseImportPayload(payload);
    if (!rows || !rows.length) throw new Error('无法解析该 JSON');
    var mode = opts.mode === 'overwrite' || opts.mode === 'skip' || opts.mode === 'rename'
      ? opts.mode
      : 'rename';
    var data = loadCustom();
    var added = 0;
    var skipped = 0;
    var overwritten = 0;

    rows.forEach(function (row) {
      var same = data.items.find(function (it) {
        return it && String(it.name) === String(row.name);
      });
      if (same) {
        if (mode === 'skip') {
          skipped += 1;
          return;
        }
        if (mode === 'overwrite') {
          row.id = same.id;
          row.createdAt = same.createdAt;
          row.updatedAt = Date.now();
          data.items = data.items.map(function (it) {
            return String(it.id) === String(same.id) ? row : it;
          });
          overwritten += 1;
          return;
        }
        var base = row.name;
        var n = 2;
        var candidate = base + ' (导入)';
        while (data.items.some(function (it) { return it && it.name === candidate; })) {
          candidate = base + ' (导入' + n + ')';
          n += 1;
        }
        row.name = candidate;
      }
      if (data.items.length >= MAX_CUSTOM) {
        throw new Error('自定义项目已满（最多 ' + MAX_CUSTOM + ' 个）');
      }
      row.id = uid('mc');
      row.createdAt = Date.now();
      row.updatedAt = Date.now();
      data.items.unshift(row);
      added += 1;
    });
    saveCustom();
    return { added: added, skipped: skipped, overwritten: overwritten, total: rows.length };
  }

  function resolveSource(opts) {
    var s = String(opts.source || '').trim();
    if (s === 'user_custom' || s === 'char_invite' || s === 'builtin') return s;
    if (opts.eventId === 'custom' || opts.customItem) return opts.proposerContactId ? 'char_invite' : 'user_custom';
    return 'builtin';
  }

  function createDraft(opts) {
    opts = opts || {};
    var source = resolveSource(opts);
    var mode = opts.mode === 'team' ? 'team' : 'solo';
    var eventId;
    var eventName;
    var itemId;
    var itemName;
    var itemDesc;
    var itemMood;
    var proposerContactId = String(opts.proposerContactId || '').trim();
    var proposerName = clip(opts.proposerName, 40);

    if (source === 'builtin') {
      eventId = String(opts.eventId || '').trim();
      itemId = String(opts.eventItemId || '').trim();
      var ev = getEvent(eventId);
      var item = getEventItem(eventId, itemId);
      if (!ev || !item || eventId === 'custom') throw new Error('无效的比赛项目');
      eventName = ev.name;
      itemName = item.name;
      itemDesc = item.desc;
      itemMood = item.mood;
    } else {
      var custom = opts.customItem || getCustomItem(opts.eventItemId || opts.customItemId);
      if (!custom && opts.name && opts.desc) {
        custom = normalizeCustomItem(opts, false);
      }
      if (!custom) throw new Error('无效的自定义项目');
      eventId = 'custom';
      eventName = '自定义比赛';
      itemId = String(custom.id || opts.eventItemId || uid('mc'));
      itemName = custom.name;
      itemDesc = custom.desc;
      itemMood = custom.mood || '';
      if (custom.proposerContactId) proposerContactId = custom.proposerContactId;
      if (custom.proposerName) proposerName = custom.proposerName;
      if (custom.fromChar && source === 'user_custom') source = 'char_invite';
      if (!opts.mode && custom.defaultMode) {
        mode = custom.defaultMode === 'team' ? 'team' : 'solo';
      }
      if (!opts.prizes && custom.defaultPrizes) {
        opts.prizes = custom.defaultPrizes;
      }
    }

    var session = {
      id: uid('ms'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
      eventId: eventId,
      eventName: eventName,
      eventItemId: itemId,
      eventItemName: itemName,
      eventItemDesc: itemDesc,
      eventMood: itemMood || '',
      source: source,
      mode: mode,
      profileId: String(opts.profileId || '').trim(),
      profileName: String(opts.profileName || '').trim(),
      participants: [],
      prizes: normalizePrizes(opts.prizes, mode),
      result: null,
      reactions: null,
      prizesFinalizedAt: 0,
      contextDigest: '',
      proposerContactId: proposerContactId,
      proposerName: proposerName
    };

    var preset = getPrizePreset(eventId, itemId, mode);
    if (preset) session.prizes = normalizePrizes(preset, mode);

    var data = loadSessions();
    data.sessions.unshift(session);
    if (data.sessions.length > MAX_SESSIONS) data.sessions = data.sessions.slice(0, MAX_SESSIONS);
    saveSessions();
    return session;
  }

  function updateSession(id, patch) {
    var s = findSession(id);
    if (!s) return null;
    Object.keys(patch || {}).forEach(function (k) {
      s[k] = patch[k];
    });
    s.updatedAt = Date.now();
    saveSessions();
    return s;
  }

  function deleteSession(id) {
    var data = loadSessions();
    var sid = String(id || '').trim();
    data.sessions = data.sessions.filter(function (s) {
      return !s || String(s.id) !== sid;
    });
    saveSessions();
  }

  function getPrizePreset(eventId, itemId, mode) {
    var key = [eventId, itemId, mode || 'solo'].join('::');
    return loadPresets()[key] || null;
  }

  function setPrizePreset(eventId, itemId, mode, prizes) {
    var key = [eventId, itemId, mode || 'solo'].join('::');
    loadPresets()[key] = normalizePrizes(prizes, mode);
    savePresets();
  }

  function validateParticipants(mode, participants) {
    var list = Array.isArray(participants) ? participants.filter(Boolean) : [];
    var ids = {};
    var i;
    for (i = 0; i < list.length; i++) {
      var id = String(list[i].contactId || '').trim();
      if (!id) return { ok: false, message: '参与者无效' };
      if (ids[id]) return { ok: false, message: '同一角色不能重复参赛' };
      ids[id] = true;
    }
    if (mode === 'team') {
      var a = list.filter(function (p) { return p.team === 'A'; });
      var b = list.filter(function (p) { return p.team === 'B'; });
      if (a.length < 1 || b.length < 1) {
        return { ok: false, message: '阵营赛两边至少各 1 人' };
      }
      if (a.length > 4 || b.length > 4) {
        return { ok: false, message: '每边最多 4 人' };
      }
      if (a.length !== b.length) {
        return { ok: false, message: '两边人数必须相同（当前 A' + a.length + ' : B' + b.length + '）' };
      }
      if (list.length !== a.length + b.length) {
        return { ok: false, message: '请为每位选手分配阵营' };
      }
      return { ok: true, message: 'A ' + a.length + ' 人 · B ' + b.length + ' 人' };
    }
    if (list.length < 2) return { ok: false, message: '单人赛至少 2 人' };
    if (list.length > 8) return { ok: false, message: '单人赛最多 8 人' };
    return { ok: true, message: list.length + ' 人参赛' };
  }

  function buildContextDigest(session) {
    if (!session) return '';
    var lines = [];
    lines.push('【赛事记录】');
    lines.push(String(session.eventName || '') + ' · ' + String(session.eventItemName || ''));
    if (session.source === 'char_invite' && session.proposerName) {
      lines.push('发起：' + session.proposerName);
    }
    lines.push('赛制：' + (session.mode === 'team' ? '阵营赛' : '单人赛'));
    lines.push('主持人：' + (session.profileName || '用户'));
    if (session.eventItemDesc) {
      lines.push('规则：' + String(session.eventItemDesc));
    }
    lines.push('');
    lines.push('【参赛名单】');
    (session.participants || []).forEach(function (p) {
      var row = '- ' + (p.name || '未命名');
      if (session.mode === 'team' && p.team) row += '（阵营' + p.team + '）';
      lines.push(row);
    });
    lines.push('');
    lines.push('【奖品】');
    var prizes = session.prizes || {};
    if (session.mode === 'team') {
      lines.push('- 胜方：' + (prizes.teamWin || '（无）'));
      lines.push('- 败方：' + (prizes.teamLose || '（无）'));
      lines.push('- MVP：' + (prizes.mvp || '（无）'));
    } else {
      var n = (session.participants || []).length || 0;
      var ranks = prizes.soloRanks || [];
      for (var r = 0; r < n; r++) {
        lines.push('- 第' + (r + 1) + '名：' + (ranks[r] || '（无）'));
      }
    }
    var result = session.result || {};
    var scrub = global.miyaMatchBridge && typeof global.miyaMatchBridge.scrubMatchProse === 'function'
      ? function (t) { return global.miyaMatchBridge.scrubMatchProse(t, session); }
      : function (t) {
          return String(t || '')
            .replace(/[（(\[【]?\s*ct_[A-Za-z0-9_]+\s*[）)\]】]?/g, '')
            .replace(/\bct_[A-Za-z0-9_]+\b/g, '')
            .trim();
        };
    if (result.highlight) {
      lines.push('');
      lines.push('【金句】' + scrub(result.highlight));
    }
    if (session.mode === 'team') {
      lines.push('');
      lines.push('【结果】胜方：阵营' + (result.winnerTeam || '—'));
      if (result.mvpContactId) {
        var mvp = (session.participants || []).find(function (p) {
          return String(p.contactId) === String(result.mvpContactId);
        });
        lines.push('MVP：' + (mvp && mvp.name ? mvp.name : result.mvpContactId));
      }
    } else if (Array.isArray(result.rankings) && result.rankings.length) {
      lines.push('');
      lines.push('【排名】');
      result.rankings
        .slice()
        .sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); })
        .forEach(function (row) {
          var who = (session.participants || []).find(function (p) {
            return String(p.contactId) === String(row.contactId);
          });
          var prize = (prizes.soloRanks && prizes.soloRanks[(row.rank || 1) - 1]) || '';
          lines.push(
            '第' + row.rank + '名 · ' + (who && who.name ? who.name : row.contactId) +
            (prize ? ' · 奖品：' + prize : '') +
            (row.note ? ' · ' + scrub(row.note) : '')
          );
        });
    }
    lines.push('');
    lines.push('【完整赛程】');
    if (Array.isArray(result.beats) && result.beats.length) {
      result.beats.forEach(function (beat, idx) {
        lines.push('—— 第' + (idx + 1) + '幕 ——');
        lines.push(scrub(beat));
        lines.push('');
      });
    } else {
      lines.push(scrub(result.narrative || '（暂无赛程）'));
    }
    if (Array.isArray(session.reactions) && session.reactions.length) {
      lines.push('');
      lines.push('【选手最终感想】');
      session.reactions.forEach(function (rx) {
        lines.push((rx.name || '角色') + '：' + scrub(rx.text || ''));
      });
    }
    return lines.join('\n').trim();
  }

  global.miyaMatchStore = {
    EVENTS: EVENTS,
    OLYMPICS_ITEMS: OLYMPICS_ITEMS,
    TALENT_ITEMS: TALENT_ITEMS,
    STORAGE_KEY: STORAGE_KEY,
    PRESET_KEY: PRESET_KEY,
    CUSTOM_KEY: CUSTOM_KEY,
    invalidateCache: function () {
      cache = null;
      presetCache = null;
      customCache = null;
    },
    EXPORT_ITEM: EXPORT_ITEM,
    EXPORT_PACK: EXPORT_PACK,
    getEvent: getEvent,
    getEventItem: getEventItem,
    listSessions: listSessions,
    findSession: findSession,
    createDraft: createDraft,
    updateSession: updateSession,
    deleteSession: deleteSession,
    normalizePrizes: normalizePrizes,
    getPrizePreset: getPrizePreset,
    setPrizePreset: setPrizePreset,
    validateParticipants: validateParticipants,
    buildContextDigest: buildContextDigest,
    listCustomItems: listCustomItems,
    getCustomItem: getCustomItem,
    saveCustomItem: saveCustomItem,
    deleteCustomItem: deleteCustomItem,
    exportCustomPayload: exportCustomPayload,
    parseImportPayload: parseImportPayload,
    importCustomItems: importCustomItems,
    normalizeCustomItem: normalizeCustomItem,
    uid: uid
  };
})(typeof window !== 'undefined' ? window : this);
