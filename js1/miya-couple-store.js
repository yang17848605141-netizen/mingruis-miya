/**
 * miya-couple-store.js — 情侣空间 · 按 contactId 独立持久化
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-couple-v1';
  var cache = null;

  function uid(prefix) {
    return (prefix || 'cp') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function isoToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function loadRaw() {
    if (cache) return cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var mem = global.miyaSyncReadJsonKey(STORAGE_KEY);
      if (mem && typeof mem === 'object') {
        cache = mem;
        if (!cache.spaces || typeof cache.spaces !== 'object') cache.spaces = {};
        if (!cache.invites || typeof cache.invites !== 'object') cache.invites = {};
        return cache;
      }
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw))) {
        cache = JSON.parse(raw);
      } else {
        cache = null;
      }
    } catch (e) {
      cache = null;
    }
    if (!cache || typeof cache !== 'object') {
      cache = { spaces: {}, invites: {} };
    }
    if (!cache.spaces || typeof cache.spaces !== 'object') cache.spaces = {};
    if (!cache.invites || typeof cache.invites !== 'object') cache.invites = {};
    return cache;
  }

  function saveRaw() {
    if (!cache) return;
    if (typeof global.miyaSyncFlushJsonKey === 'function') {
      global.miyaSyncFlushJsonKey(STORAGE_KEY, cache);
      return;
    }
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      global.miyaWriteLsJsonKey(STORAGE_KEY, cache).catch(function () {});
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) { /* ignore */ }
  }

  var TIMELINE_TYPES = {
    milestone: true,
    memory: true,
    checkin_pin: true,
    gacha: true,
    sealed: true,
    letter: true,
    commemoration: true
  };

  var MILESTONE_DAYS = [1, 7, 30, 100, 365, 520, 999];

  function normalizeTimelineEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = String(raw.type || 'memory').trim();
    if (!TIMELINE_TYPES[type]) type = 'memory';
    var dateIso = String(raw.dateIso || isoToday()).trim();
    var revealAt = Number(raw.revealAt) || 0;
    var sealed = !!raw.sealed;
    if (type === 'sealed') sealed = true;
    var today = isoToday();
    var revealed = !!raw.revealed;
    if (sealed && dateIso <= today) {
      revealed = true;
      sealed = false;
    }
    return {
      id: String(raw.id || uid('cptl')).trim(),
      type: type,
      author: raw.author === 'char' ? 'char' : (raw.author === 'system' ? 'system' : 'user'),
      dateIso: dateIso,
      revealAt: revealAt,
      title: String(raw.title || '').trim(),
      body: String(raw.body || '').trim(),
      mood: String(raw.mood || '').trim(),
      location: String(raw.location || '').trim(),
      blobId: String(raw.blobId || '').trim(),
      charEcho: String(raw.charEcho || '').trim(),
      charPerspective: String(raw.charPerspective || '').trim(),
      dualPerspective: !!raw.dualPerspective,
      linkedCheckInId: String(raw.linkedCheckInId || '').trim(),
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      gachaWeek: String(raw.gachaWeek || '').trim(),
      sealed: sealed,
      revealed: revealed,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeTimeline(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeTimelineEntry).filter(Boolean);
  }

  function normalizeTimelineMeta(raw) {
    if (!raw || typeof raw !== 'object') {
      return { lastGachaWeek: '', lastGachaAt: 0, milestoneDaysLogged: [] };
    }
    var logged = Array.isArray(raw.milestoneDaysLogged)
      ? raw.milestoneDaysLogged.map(function (n) { return Number(n); }).filter(function (n) { return n > 0; })
      : [];
    return {
      lastGachaWeek: String(raw.lastGachaWeek || '').trim(),
      lastGachaAt: Number(raw.lastGachaAt) || 0,
      milestoneDaysLogged: logged
    };
  }

  var BOARD_TYPES = {
    sticky: true,
    fold: true,
    challenge: true,
    capsule: true,
    prompt: true,
    reply: true
  };

  var BOARD_COLORS = {
    rose: true, sky: true, gold: true, mint: true, lemon: true, lavender: true, coral: true
  };

  function normalizeBoardMeta(raw) {
    if (!raw || typeof raw !== 'object') {
      return { lastCharRefreshDate: '', lastCharRefreshAt: 0, lastPromptWeek: '', lastVisitAt: 0 };
    }
    return {
      lastCharRefreshDate: String(raw.lastCharRefreshDate || '').trim(),
      lastCharRefreshAt: Number(raw.lastCharRefreshAt) || 0,
      lastPromptWeek: String(raw.lastPromptWeek || '').trim(),
      lastVisitAt: Number(raw.lastVisitAt) || 0
    };
  }

  function normalizeBoardEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = String(raw.type || 'sticky').trim();
    if (!BOARD_TYPES[type]) type = 'sticky';
    var color = String(raw.color || 'rose').trim();
    if (!BOARD_COLORS[color]) color = 'rose';
    var dateIso = String(raw.dateIso || isoToday()).trim();
    var revealAt = String(raw.revealAt || raw.revealDate || '').trim();
    var today = isoToday();
    var revealed = !!raw.revealed;
    if (type === 'capsule' && revealAt && revealAt <= today) {
      revealed = true;
    }
    var pos = raw.pos && typeof raw.pos === 'object' ? raw.pos : {};
    return {
      id: String(raw.id || uid('cpbd')).trim(),
      type: type,
      author: raw.author === 'char' ? 'char' : 'user',
      source: String(raw.source || (raw.author === 'char' ? 'char' : 'user')).trim(),
      text: String(raw.text || raw.body || '').trim(),
      color: color,
      mood: String(raw.mood || '').trim(),
      sticker: String(raw.sticker || '').trim(),
      parentId: String(raw.parentId || '').trim(),
      promptId: String(raw.promptId || '').trim(),
      challengeStatus: String(raw.challengeStatus || '').trim(),
      revealAt: revealAt,
      revealed: revealed,
      folded: raw.folded !== false && type === 'fold',
      opened: !!raw.opened,
      readAt: Number(raw.readAt) || 0,
      timeAt: String(raw.timeAt || '').trim(),
      dateIso: dateIso,
      pos: {
        col: Number(pos.col) || 0,
        row: Number(pos.row) || 0
      },
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeBoard(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeBoardEntry).filter(Boolean);
  }

  function boardSortKey(entry) {
    if (!entry) return 0;
    var tm = parseTimeAt(entry.timeAt);
    var base = entry.dateIso || isoToday();
    if (tm) {
      return new Date(base + 'T' + pad(tm.h) + ':' + pad(tm.min) + ':00').getTime();
    }
    return Number(entry.createdAt) || 0;
  }

  function getBoard(contactId) {
    var sp = getSpace(contactId);
    if (!sp || !Array.isArray(sp.board)) return [];
    return sp.board.slice().sort(function (a, b) {
      return boardSortKey(b) - boardSortKey(a);
    });
  }

  function findBoardEntry(contactId, entryId) {
    var id = String(entryId || '').trim();
    if (!id) return null;
    return getBoard(contactId).find(function (e) { return e && e.id === id; }) || null;
  }

  function addBoardEntry(contactId, entry) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return null;
    sp.board = Array.isArray(sp.board) ? sp.board : [];
    var normalized = normalizeBoardEntry(Object.assign({
      author: 'user',
      dateIso: isoToday(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, entry || {}));
    if (!normalized) return null;
    sp.board.push(normalized);
    data.spaces[id] = sp;
    saveRaw();
    return normalized;
  }

  function updateBoardEntry(contactId, entryId, patch) {
    var id = String(contactId || '').trim();
    var eid = String(entryId || '').trim();
    if (!id || !eid) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.board)) return null;
    var idx = sp.board.findIndex(function (e) { return e && e.id === eid; });
    if (idx < 0) return null;
    sp.board[idx] = normalizeBoardEntry(Object.assign({}, sp.board[idx], patch || {}, {
      id: eid,
      updatedAt: Date.now()
    }));
    if (!sp.board[idx]) return null;
    data.spaces[id] = sp;
    saveRaw();
    return sp.board[idx];
  }

  function removeCharBoardDailyForDate(contactId, dateIso) {
    var id = String(contactId || '').trim();
    var d = String(dateIso || '').trim();
    if (!id || !d) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return;
    sp.board = (sp.board || []).filter(function (e) {
      return !(e && e.author === 'char' && e.source === 'char_daily' && e.dateIso === d);
    });
    data.spaces[id] = sp;
    saveRaw();
  }

  function getBoardUnreadCount(contactId) {
    return getBoard(contactId).filter(function (e) {
      return e && e.author === 'char' && !e.readAt;
    }).length;
  }

  function markBoardRead(contactId, entryId) {
    var id = String(contactId || '').trim();
    if (!id) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.board)) return;
    var now = Date.now();
    var eid = entryId ? String(entryId).trim() : '';
    sp.board = sp.board.map(function (e) {
      if (!e || e.author !== 'char') return e;
      if (eid && e.id !== eid) return e;
      if (e.readAt) return e;
      return normalizeBoardEntry(Object.assign({}, e, { readAt: now, updatedAt: now }));
    });
    sp.boardMeta = normalizeBoardMeta(sp.boardMeta);
    sp.boardMeta.lastVisitAt = now;
    data.spaces[id] = sp;
    saveRaw();
  }

  function revealDueBoardCapsules(contactId) {
    var today = isoToday();
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[contactId] || {}, contactId);
    if (!sp || !Array.isArray(sp.board)) return [];
    var revealed = [];
    sp.board = sp.board.map(function (e) {
      if (!e || e.type !== 'capsule' || e.revealed) return e;
      if (e.revealAt && e.revealAt <= today) {
        var next = normalizeBoardEntry(Object.assign({}, e, { revealed: true, updatedAt: Date.now() }));
        revealed.push(next);
        return next;
      }
      return e;
    });
    if (revealed.length) {
      data.spaces[contactId] = sp;
      saveRaw();
    }
    return revealed;
  }

  function getLatestBoardPreview(contactId) {
    var list = getBoard(contactId);
    if (!list.length) return null;
    var entry = list.find(function (e) {
      return e && e.type !== 'prompt' && (e.type !== 'capsule' || e.revealed);
    }) || list[0];
    return entry;
  }

  function markBoardCharRefresh(contactId, dateIso) {
    var id = String(contactId || '').trim();
    if (!id) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return;
    sp.boardMeta = normalizeBoardMeta(sp.boardMeta);
    sp.boardMeta.lastCharRefreshDate = String(dateIso || isoToday()).trim();
    sp.boardMeta.lastCharRefreshAt = Date.now();
    data.spaces[id] = sp;
    saveRaw();
  }

  function markBoardPromptWeek(contactId, weekKey) {
    var id = String(contactId || '').trim();
    if (!id) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return;
    sp.boardMeta = normalizeBoardMeta(sp.boardMeta);
    sp.boardMeta.lastPromptWeek = String(weekKey || '').trim();
    data.spaces[id] = sp;
    saveRaw();
  }

  function getBoardPromptForWeek(contactId, weekKey) {
    var wk = String(weekKey || '').trim();
    if (!wk) return null;
    return getBoard(contactId).find(function (e) {
      return e && e.type === 'prompt' && e.promptId === wk;
    }) || null;
  }

  function normalizeSpace(raw, contactId) {
    if (!raw || typeof raw !== 'object') return null;
    var status = String(raw.status || '').trim();
    if (status !== 'open' && status !== 'pending' && status !== 'declined') status = 'pending';
    return {
      contactId: String(contactId || raw.contactId || '').trim(),
      status: status,
      profileId: String(raw.profileId || '').trim(),
      profileName: String(raw.profileName || '').trim(),
      charName: String(raw.charName || '').trim(),
      annivDate: String(raw.annivDate || isoToday()).trim(),
      openedAt: Number(raw.openedAt) || 0,
      lastInviteId: String(raw.lastInviteId || '').trim(),
      lastInviteAt: Number(raw.lastInviteAt) || 0,
      timeline: normalizeTimeline(raw.timeline),
      timelineMeta: normalizeTimelineMeta(raw.timelineMeta),
      board: normalizeBoard(raw.board),
      boardMeta: normalizeBoardMeta(raw.boardMeta),
      whispers: Array.isArray(raw.whispers) ? raw.whispers : [],
      photos: Array.isArray(raw.photos) ? raw.photos : [],
      checkIns: normalizeCheckIns(raw.checkIns),
      imageGenEnabled: !!raw.imageGenEnabled
    };
  }

  function normalizeCheckInBlobIds(raw) {
    if (!raw || typeof raw !== 'object') return [];
    var ids = [];
    if (Array.isArray(raw.blobIds)) {
      raw.blobIds.forEach(function (id) {
        var k = String(id || '').trim();
        if (k && ids.indexOf(k) < 0) ids.push(k);
      });
    }
    var single = String(raw.blobId || '').trim();
    if (single && ids.indexOf(single) < 0) ids.unshift(single);
    return ids.slice(0, 9);
  }

  function getCheckInBlobIds(ci) {
    if (!ci) return [];
    var ids = Array.isArray(ci.blobIds) ? ci.blobIds.slice() : [];
    var single = String(ci.blobId || '').trim();
    if (single && ids.indexOf(single) < 0) ids.unshift(single);
    return ids.filter(Boolean).slice(0, 9);
  }

  function normalizeCheckInEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var comments = Array.isArray(raw.comments) ? raw.comments.map(function (c) {
      if (!c || typeof c !== 'object') return null;
      return {
        id: String(c.id || uid('cpcm')).trim(),
        author: c.author === 'user' ? 'user' : 'char',
        text: String(c.text || '').trim(),
        createdAt: Number(c.createdAt) || Date.now()
      };
    }).filter(Boolean) : [];
    var blobIds = normalizeCheckInBlobIds(raw);
    return {
      id: String(raw.id || uid('cpci')).trim(),
      dateIso: String(raw.dateIso || isoToday()).trim(),
      slot: String(raw.slot || 'custom').trim(),
      slotLabel: String(raw.slotLabel || '').trim(),
      author: raw.author === 'user' ? 'user' : 'char',
      caption: String(raw.caption || '').trim(),
      detail: String(raw.detail || '').trim(),
      mood: String(raw.mood || '').trim(),
      location: String(raw.location || '').trim(),
      scenePrompt: String(raw.scenePrompt || '').trim(),
      blobId: String(raw.blobId || blobIds[0] || '').trim(),
      blobIds: blobIds,
      imageGenFailed: !!raw.imageGenFailed,
      imageGenPending: !!raw.imageGenPending,
      visionNote: String(raw.visionNote || '').trim(),
      timeAt: String(raw.timeAt || '').trim(),
      comments: comments,
      createdAt: Number(raw.createdAt) || Date.now(),
      checkInAt: resolveCheckInAt(raw)
    };
  }

  var SLOT_DEFAULT_TIMES = {
    morning: '08:15',
    noon: '12:30',
    afternoon: '15:30',
    evening: '19:00',
    night: '22:30',
    custom: '12:00'
  };

  function parseTimeAt(timeStr) {
    var m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    var min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { h: h, min: min };
  }

  function slotToCheckInAt(dateIso, slot, timeAt) {
    var d = String(dateIso || isoToday()).trim();
    var s = String(slot || 'custom').trim();
    var tm = parseTimeAt(timeAt) || parseTimeAt(SLOT_DEFAULT_TIMES[s] || SLOT_DEFAULT_TIMES.custom);
    if (!tm) return Date.now();
    return new Date(
      d + 'T' + pad(tm.h) + ':' + pad(tm.min) + ':00'
    ).getTime();
  }

  function resolveCheckInAt(raw) {
    if (!raw || typeof raw !== 'object') return Date.now();
    var explicit = Number(raw.checkInAt);
    if (explicit > 0) return explicit;
    return slotToCheckInAt(raw.dateIso, raw.slot, raw.timeAt);
  }

  function normalizeCheckIns(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeCheckInEntry).filter(Boolean);
  }

  function getSpace(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var row = loadRaw().spaces[id];
    return row ? normalizeSpace(row, id) : null;
  }

  function ensureSpace(contactId, patch) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var data = loadRaw();
    var cur = normalizeSpace(data.spaces[id] || {}, id) || {
      contactId: id,
      status: 'pending',
      profileId: '',
      profileName: '',
      charName: '',
      annivDate: isoToday(),
      openedAt: 0,
      lastInviteId: '',
      lastInviteAt: 0,
      timeline: [],
      timelineMeta: { lastGachaWeek: '', lastGachaAt: 0, milestoneDaysLogged: [] },
      board: [],
      boardMeta: normalizeBoardMeta(null),
      whispers: [],
      photos: [],
      checkIns: [],
      imageGenEnabled: false
    };
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        if (patch[k] !== undefined) cur[k] = patch[k];
      });
    }
    data.spaces[id] = normalizeSpace(cur, id);
    saveRaw();
    return data.spaces[id];
  }

  function registerInvite(meta) {
    if (!meta || !meta.inviteId) return null;
    var data = loadRaw();
    data.invites[String(meta.inviteId)] = {
      inviteId: String(meta.inviteId),
      contactId: String(meta.contactId || '').trim(),
      chatId: String(meta.chatId || '').trim(),
      msgId: String(meta.msgId || '').trim(),
      profileId: String(meta.profileId || '').trim(),
      profileName: String(meta.profileName || '').trim(),
      charName: String(meta.charName || '').trim(),
      sentAt: Number(meta.sentAt) || Date.now(),
      status: String(meta.status || 'pending').trim() || 'pending'
    };
    saveRaw();
    return data.invites[meta.inviteId];
  }

  function updateInvite(inviteId, patch) {
    var id = String(inviteId || '').trim();
    if (!id) return null;
    var data = loadRaw();
    var cur = data.invites[id];
    if (!cur) return null;
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        if (patch[k] !== undefined) cur[k] = patch[k];
      });
    }
    saveRaw();
    return cur;
  }

  function getInvite(inviteId) {
    var id = String(inviteId || '').trim();
    if (!id) return null;
    return loadRaw().invites[id] || null;
  }

  function isOpen(contactId) {
    var sp = getSpace(contactId);
    return !!(sp && sp.status === 'open');
  }

  function openSpace(contactId, meta) {
    meta = meta && typeof meta === 'object' ? meta : {};
    var now = Date.now();
    return ensureSpace(contactId, {
      status: 'open',
      profileId: meta.profileId || '',
      profileName: meta.profileName || '',
      charName: meta.charName || '',
      annivDate: meta.annivDate || isoToday(),
      openedAt: now,
      lastInviteId: meta.inviteId || '',
      lastInviteAt: meta.sentAt || now
    });
  }

  function markDeclined(contactId, meta) {
    meta = meta && typeof meta === 'object' ? meta : {};
    return ensureSpace(contactId, {
      status: 'declined',
      profileId: meta.profileId || '',
      profileName: meta.profileName || '',
      charName: meta.charName || '',
      lastInviteId: meta.inviteId || '',
      lastInviteAt: meta.sentAt || Date.now()
    });
  }

  function markPending(contactId, meta) {
    meta = meta && typeof meta === 'object' ? meta : {};
    return ensureSpace(contactId, {
      status: 'pending',
      profileId: meta.profileId || '',
      profileName: meta.profileName || '',
      charName: meta.charName || '',
      lastInviteId: meta.inviteId || '',
      lastInviteAt: meta.sentAt || Date.now()
    });
  }

  function getOpenContactIds() {
    return Object.keys(loadRaw().spaces).filter(function (id) {
      var sp = getSpace(id);
      return sp && sp.status === 'open';
    });
  }

  function getAllSpaceRows() {
    return Object.keys(loadRaw().spaces).map(function (id) {
      return getSpace(id);
    }).filter(Boolean);
  }

  function daysTogether(annivDate) {
    var start = new Date(String(annivDate || isoToday()) + 'T00:00:00');
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var diff = Math.floor((now - start) / 86400000);
    return diff >= 0 ? diff : 0;
  }

  function getCheckIns(contactId) {
    var sp = getSpace(contactId);
    return sp && Array.isArray(sp.checkIns) ? sp.checkIns.slice() : [];
  }

  function getCheckInsByDate(contactId, dateIso) {
    var d = String(dateIso || '').trim();
    return getCheckIns(contactId).filter(function (ci) {
      return ci && ci.dateIso === d;
    }).sort(function (a, b) {
      return (a.checkInAt || a.createdAt || 0) - (b.checkInAt || b.createdAt || 0);
    });
  }

  function findCheckIn(contactId, checkInId) {
    var id = String(checkInId || '').trim();
    if (!id) return null;
    return getCheckIns(contactId).find(function (ci) { return ci && ci.id === id; }) || null;
  }

  function addCheckIn(contactId, entry) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var normalized = normalizeCheckInEntry(entry);
    if (!normalized) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return null;
    sp.checkIns = Array.isArray(sp.checkIns) ? sp.checkIns : [];
    sp.checkIns.push(normalized);
    data.spaces[id] = sp;
    saveRaw();
    return normalized;
  }

  function updateCheckIn(contactId, checkInId, patch) {
    var id = String(contactId || '').trim();
    var ciId = String(checkInId || '').trim();
    if (!id || !ciId || !patch || typeof patch !== 'object') return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.checkIns)) return null;
    var idx = sp.checkIns.findIndex(function (ci) { return ci && ci.id === ciId; });
    if (idx < 0) return null;
    var cur = normalizeCheckInEntry(sp.checkIns[idx]);
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== undefined) cur[k] = patch[k];
    });
    sp.checkIns[idx] = normalizeCheckInEntry(cur);
    data.spaces[id] = sp;
    saveRaw();
    return sp.checkIns[idx];
  }

  function addCheckInComment(contactId, checkInId, comment) {
    var id = String(contactId || '').trim();
    var ciId = String(checkInId || '').trim();
    if (!id || !ciId) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.checkIns)) return null;
    var idx = sp.checkIns.findIndex(function (ci) { return ci && ci.id === ciId; });
    if (idx < 0) return null;
    var cur = normalizeCheckInEntry(sp.checkIns[idx]);
    var c = {
      id: String(comment && comment.id ? comment.id : uid('cpcm')).trim(),
      author: comment && comment.author === 'user' ? 'user' : 'char',
      text: String(comment && comment.text ? comment.text : '').trim(),
      createdAt: Number(comment && comment.createdAt ? comment.createdAt : Date.now())
    };
    if (!c.text) return null;
    cur.comments = Array.isArray(cur.comments) ? cur.comments : [];
    cur.comments.push(c);
    sp.checkIns[idx] = cur;
    data.spaces[id] = sp;
    saveRaw();
    return c;
  }

  function getCheckInDatesInMonth(contactId, year, month) {
    var y = Number(year);
    var m = Number(month);
    if (isNaN(y) || isNaN(m)) return [];
    var prefix = y + '-' + pad(m);
    var set = {};
    getCheckIns(contactId).forEach(function (ci) {
      if (ci && ci.dateIso && ci.dateIso.indexOf(prefix) === 0) {
        set[ci.dateIso] = true;
      }
    });
    return Object.keys(set).sort();
  }

  function getLatestCharCheckIn(contactId, dateIso) {
    var d = String(dateIso || isoToday()).trim();
    var list = getCheckInsByDate(contactId, d).filter(function (ci) {
      return ci && ci.author === 'char';
    });
    return list.length ? list[list.length - 1] : null;
  }

  function getCurrentSlotHint() {
    var h = new Date().getHours();
    if (h >= 5 && h < 11) return { slot: 'morning', label: '早间打卡' };
    if (h >= 11 && h < 14) return { slot: 'noon', label: '午间打卡' };
    if (h >= 14 && h < 19) return { slot: 'afternoon', label: '下午打卡' };
    if (h >= 19 && h < 23) return { slot: 'evening', label: '晚间打卡' };
    return { slot: 'night', label: '夜间打卡' };
  }

  function isImageGenEnabled(contactId) {
    var sp = getSpace(contactId);
    return !!(sp && sp.imageGenEnabled);
  }

  function setImageGenEnabled(contactId, enabled) {
    return ensureSpace(contactId, { imageGenEnabled: !!enabled });
  }

  function getTimeline(contactId) {
    var sp = getSpace(contactId);
    if (!sp || !Array.isArray(sp.timeline)) return [];
    return sp.timeline.slice().sort(function (a, b) {
      var da = String(a.dateIso || '');
      var db = String(b.dateIso || '');
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function findTimelineEntry(contactId, entryId) {
    var id = String(entryId || '').trim();
    if (!id) return null;
    return getTimeline(contactId).find(function (e) { return e && e.id === id; }) || null;
  }

  function addTimelineEntry(contactId, entry) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var normalized = normalizeTimelineEntry(entry);
    if (!normalized || !normalized.title) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return null;
    sp.timeline = Array.isArray(sp.timeline) ? sp.timeline : [];
    sp.timeline.push(normalized);
    data.spaces[id] = sp;
    saveRaw();
    return normalized;
  }

  function updateTimelineEntry(contactId, entryId, patch) {
    var id = String(contactId || '').trim();
    var eid = String(entryId || '').trim();
    if (!id || !eid || !patch || typeof patch !== 'object') return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.timeline)) return null;
    var idx = sp.timeline.findIndex(function (e) { return e && e.id === eid; });
    if (idx < 0) return null;
    var cur = normalizeTimelineEntry(sp.timeline[idx]);
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== undefined) cur[k] = patch[k];
    });
    cur.updatedAt = Date.now();
    sp.timeline[idx] = normalizeTimelineEntry(cur);
    data.spaces[id] = sp;
    saveRaw();
    return sp.timeline[idx];
  }

  function removeTimelineEntry(contactId, entryId) {
    var id = String(contactId || '').trim();
    var eid = String(entryId || '').trim();
    if (!id || !eid) return false;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp || !Array.isArray(sp.timeline)) return false;
    var before = sp.timeline.length;
    sp.timeline = sp.timeline.filter(function (e) {
      return !(e && e.id === eid && e.type !== 'milestone');
    });
    if (sp.timeline.length === before) return false;
    data.spaces[id] = sp;
    saveRaw();
    return true;
  }

  function getVisibleTimeline(contactId) {
    var today = isoToday();
    return getTimeline(contactId).filter(function (e) {
      if (!e) return false;
      if (e.sealed && e.dateIso > today) return false;
      return true;
    });
  }

  function getSealedTimeline(contactId) {
    var today = isoToday();
    return getTimeline(contactId).filter(function (e) {
      return e && e.sealed && e.dateIso > today;
    }).sort(function (a, b) {
      return String(a.dateIso).localeCompare(String(b.dateIso));
    });
  }

  function getOnThisDayEntries(contactId) {
    var today = isoToday();
    var parts = today.split('-');
    if (parts.length < 3) return [];
    var md = parts[1] + '-' + parts[2];
    return getVisibleTimeline(contactId).filter(function (e) {
      if (!e || e.type === 'gacha') return false;
      var p = String(e.dateIso || '').split('-');
      if (p.length < 3) return false;
      var emd = p[1] + '-' + p[2];
      return emd === md && e.dateIso !== today;
    });
  }

  function isoWeekKey(d) {
    var date = d || new Date();
    var target = new Date(date.valueOf());
    var dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    var firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    var week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    return date.getFullYear() + '-W' + pad(week);
  }

  function canRunWeeklyGacha(contactId) {
    var sp = getSpace(contactId);
    if (!sp) return false;
    var meta = sp.timelineMeta || {};
    var week = isoWeekKey();
    return meta.lastGachaWeek !== week;
  }

  function markWeeklyGachaDone(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return;
    sp.timelineMeta = normalizeTimelineMeta(sp.timelineMeta);
    sp.timelineMeta.lastGachaWeek = isoWeekKey();
    sp.timelineMeta.lastGachaAt = Date.now();
    data.spaces[id] = sp;
    saveRaw();
  }

  function addMilestoneIfNeeded(contactId, milestoneKey, entry) {
    var id = String(contactId || '').trim();
    if (!id || !milestoneKey) return null;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return null;
    sp.timeline = Array.isArray(sp.timeline) ? sp.timeline : [];
    sp.timelineMeta = normalizeTimelineMeta(sp.timelineMeta);
    var exists = sp.timeline.some(function (e) {
      return e && e.type === 'milestone' && e.meta && e.meta.key === milestoneKey;
    });
    if (exists) return null;
    var normalized = normalizeTimelineEntry(Object.assign({
      type: 'milestone',
      author: 'system',
      dateIso: isoToday()
    }, entry, {
      meta: Object.assign({ key: milestoneKey }, entry && entry.meta ? entry.meta : {})
    }));
    if (!normalized) return null;
    sp.timeline.push(normalized);
    data.spaces[id] = sp;
    saveRaw();
    return normalized;
  }

  function syncAnniversaryMilestones(contactId) {
    var sp = getSpace(contactId);
    if (!sp || sp.status !== 'open') return [];
    var days = daysTogether(sp.annivDate);
    var added = [];
    MILESTONE_DAYS.forEach(function (d) {
      if (days < d) return;
      var key = 'days_' + d;
      if (sp.timelineMeta && sp.timelineMeta.milestoneDaysLogged.indexOf(d) >= 0) return;
      var entry = addMilestoneIfNeeded(contactId, key, {
        title: '在一起第 ' + d + ' 天',
        body: d === 1 ? '第一天，故事开始了。' :
          d === 7 ? '一周了，习惯有你在身边。' :
          d === 30 ? '一个月，像一首短诗。' :
          d === 100 ? '一百天，值得被记住。' :
          d === 365 ? '一整年，我们的编年史翻过一页。' :
          d === 520 ? '520 天，数字也在说爱你。' :
          '第 ' + d + ' 天，还在写。',
        dateIso: sp.annivDate ? addDaysToIso(sp.annivDate, d - 1) : isoToday(),
        meta: { key: key, days: d }
      });
      if (entry) {
        added.push(entry);
        var data = loadRaw();
        var row = normalizeSpace(data.spaces[contactId] || {}, contactId);
        if (row) {
          row.timelineMeta = normalizeTimelineMeta(row.timelineMeta);
          if (row.timelineMeta.milestoneDaysLogged.indexOf(d) < 0) {
            row.timelineMeta.milestoneDaysLogged.push(d);
          }
          data.spaces[contactId] = row;
          saveRaw();
        }
      }
    });
    return added;
  }

  function addDaysToIso(iso, days) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return isoToday();
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + (Number(days) || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function seedOpenSpaceMilestone(contactId) {
    return addMilestoneIfNeeded(contactId, 'space_open', {
      title: 'Our Space 开启',
      body: '只属于两个人的领地，从今天起有了坐标。',
      dateIso: isoToday(),
      meta: { key: 'space_open', event: 'open' }
    });
  }

  function pinCheckInToTimeline(contactId, checkInId) {
    var ci = findCheckIn(contactId, checkInId);
    if (!ci) return null;
    var exists = getTimeline(contactId).some(function (e) {
      return e && e.linkedCheckInId === checkInId;
    });
    if (exists) return null;
    var blobIds = getCheckInBlobIds(ci);
    return addTimelineEntry(contactId, {
      type: 'checkin_pin',
      author: ci.author === 'user' ? 'user' : 'char',
      dateIso: ci.dateIso || isoToday(),
      title: ci.caption || ci.slotLabel || '打卡瞬间',
      body: ci.detail || ci.caption || '',
      mood: ci.mood || '',
      location: ci.location || '',
      blobId: blobIds[0] || '',
      linkedCheckInId: checkInId,
      meta: { slot: ci.slot, slotLabel: ci.slotLabel }
    });
  }

  function revealDueSealedEntries(contactId) {
    var today = isoToday();
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[contactId] || {}, contactId);
    if (!sp || !Array.isArray(sp.timeline)) return [];
    var revealed = [];
    sp.timeline.forEach(function (e, i) {
      if (!e || !e.sealed) return;
      if (String(e.dateIso) <= today) {
        sp.timeline[i] = normalizeTimelineEntry(Object.assign({}, e, {
          sealed: false,
          revealed: true,
          updatedAt: Date.now()
        }));
        revealed.push(sp.timeline[i]);
      }
    });
    if (revealed.length) {
      data.spaces[contactId] = sp;
      saveRaw();
    }
    return revealed;
  }

  function removeCharCheckInsForDate(contactId, dateIso) {
    var id = String(contactId || '').trim();
    var d = String(dateIso || '').trim();
    if (!id || !d) return;
    var data = loadRaw();
    var sp = normalizeSpace(data.spaces[id] || {}, id);
    if (!sp) return;
    sp.checkIns = (sp.checkIns || []).filter(function (ci) {
      return !(ci && ci.author === 'char' && ci.dateIso === d);
    });
    data.spaces[id] = sp;
    saveRaw();
  }

  global.miyaCoupleStore = {
    STORAGE_KEY: STORAGE_KEY,
    invalidateCache: function () { cache = null; },
    uid: uid,
    isoToday: isoToday,
    getSpace: getSpace,
    ensureSpace: ensureSpace,
    isOpen: isOpen,
    openSpace: openSpace,
    markDeclined: markDeclined,
    markPending: markPending,
    registerInvite: registerInvite,
    updateInvite: updateInvite,
    getInvite: getInvite,
    getOpenContactIds: getOpenContactIds,
    getAllSpaceRows: getAllSpaceRows,
    daysTogether: daysTogether,
    normalizeCheckInEntry: normalizeCheckInEntry,
    getCheckInBlobIds: getCheckInBlobIds,
    getCheckIns: getCheckIns,
    getCheckInsByDate: getCheckInsByDate,
    findCheckIn: findCheckIn,
    addCheckIn: addCheckIn,
    updateCheckIn: updateCheckIn,
    addCheckInComment: addCheckInComment,
    getCheckInDatesInMonth: getCheckInDatesInMonth,
    getLatestCharCheckIn: getLatestCharCheckIn,
    getCurrentSlotHint: getCurrentSlotHint,
    isImageGenEnabled: isImageGenEnabled,
    setImageGenEnabled: setImageGenEnabled,
    removeCharCheckInsForDate: removeCharCheckInsForDate,
    slotToCheckInAt: slotToCheckInAt,
    resolveCheckInAt: resolveCheckInAt,
    normalizeTimelineEntry: normalizeTimelineEntry,
    getTimeline: getTimeline,
    getVisibleTimeline: getVisibleTimeline,
    getSealedTimeline: getSealedTimeline,
    getOnThisDayEntries: getOnThisDayEntries,
    findTimelineEntry: findTimelineEntry,
    addTimelineEntry: addTimelineEntry,
    updateTimelineEntry: updateTimelineEntry,
    removeTimelineEntry: removeTimelineEntry,
    canRunWeeklyGacha: canRunWeeklyGacha,
    markWeeklyGachaDone: markWeeklyGachaDone,
    addMilestoneIfNeeded: addMilestoneIfNeeded,
    syncAnniversaryMilestones: syncAnniversaryMilestones,
    seedOpenSpaceMilestone: seedOpenSpaceMilestone,
    pinCheckInToTimeline: pinCheckInToTimeline,
    revealDueSealedEntries: revealDueSealedEntries,
    isoWeekKey: isoWeekKey,
    normalizeBoardEntry: normalizeBoardEntry,
    getBoard: getBoard,
    findBoardEntry: findBoardEntry,
    addBoardEntry: addBoardEntry,
    updateBoardEntry: updateBoardEntry,
    removeCharBoardDailyForDate: removeCharBoardDailyForDate,
    getBoardUnreadCount: getBoardUnreadCount,
    markBoardRead: markBoardRead,
    revealDueBoardCapsules: revealDueBoardCapsules,
    getLatestBoardPreview: getLatestBoardPreview,
    markBoardCharRefresh: markBoardCharRefresh,
    markBoardPromptWeek: markBoardPromptWeek,
    getBoardPromptForWeek: getBoardPromptForWeek,
    boardSortKey: boardSortKey
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({
      whenReady: function () {
        return global.miyaReadLsJsonKey(STORAGE_KEY, { spaces: {}, invites: {} }).then(function (v) {
          cache = v && typeof v === 'object' ? v : { spaces: {}, invites: {} };
          if (!cache.spaces || typeof cache.spaces !== 'object') cache.spaces = {};
          if (!cache.invites || typeof cache.invites !== 'object') cache.invites = {};
          if (global.__miyaKvMem) global.__miyaKvMem[STORAGE_KEY] = cache;
        });
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
