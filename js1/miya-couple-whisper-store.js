/**
 * miya-couple-whisper-store.js — 深夜私语 · 房间设置与收藏
 */
(function (global) {
  'use strict';

  var LS_KEY = 'miya-couple-whisper-v1';
  var cache = null;

  function uid(prefix) {
    return (prefix || 'wp') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function trim(s) { return String(s || '').trim(); }

  function defaultRoomSettings() {
    return {
      charPortraitBlobId: '',
      userPortraitBlobId: '',
      bgBlobId: '',
      customStyleGuide: '',
      autoVoice: false,
      updatedAt: Date.now()
    };
  }

  function normalizeLine(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = String(raw.type || '').toLowerCase();
    if (type !== 'narration' && type !== 'char' && type !== 'user') return null;
    var text = trim(raw.text);
    if (!text) return null;
    return {
      id: trim(raw.id) || uid('wpl'),
      type: type,
      text: text,
      speakerName: trim(raw.speakerName)
    };
  }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var lines = Array.isArray(raw.lines) ? raw.lines.map(normalizeLine).filter(Boolean) : [];
    return {
      id: trim(raw.id) || uid('wps'),
      contactId: trim(raw.contactId),
      charName: trim(raw.charName),
      profileName: trim(raw.profileName),
      lines: lines,
      status: raw.status === 'ended' ? 'ended' : 'active',
      lineIndex: Math.max(0, parseInt(raw.lineIndex, 10) || 0),
      awaitingChoice: !!raw.awaitingChoice,
      lastChoices: Array.isArray(raw.lastChoices) ? raw.lastChoices.map(trim).filter(Boolean).slice(0, 3) : [],
      title: trim(raw.title) || '深夜私语',
      createdAt: Number(raw.createdAt) || Date.now(),
      endedAt: Number(raw.endedAt) || 0
    };
  }

  function normalizeFavorite(raw) {
    var sess = normalizeSession(raw);
    if (!sess) return null;
    sess.status = 'ended';
    if (!sess.endedAt) sess.endedAt = sess.createdAt;
    return sess;
  }

  function normalizeRoomSettings(raw) {
    var d = defaultRoomSettings();
    if (!raw || typeof raw !== 'object') return Object.assign({}, d);
    return {
      charPortraitBlobId: trim(raw.charPortraitBlobId),
      userPortraitBlobId: trim(raw.userPortraitBlobId),
      bgBlobId: trim(raw.bgBlobId),
      customStyleGuide: trim(raw.customStyleGuide),
      autoVoice: !!raw.autoVoice,
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function defaultState() {
    return {
      version: 1,
      roomSettings: {},
      favorites: [],
      activeSessions: {}
    };
  }

  function loadRaw() {
    if (cache) return cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var mem = global.miyaSyncReadJsonKey(LS_KEY);
      if (mem && typeof mem === 'object') {
        cache = mem;
        if (!cache.roomSettings || typeof cache.roomSettings !== 'object') cache.roomSettings = {};
        if (!Array.isArray(cache.favorites)) cache.favorites = [];
        if (!cache.activeSessions || typeof cache.activeSessions !== 'object') cache.activeSessions = {};
        return cache;
      }
    }
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw && !(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw))) {
        cache = JSON.parse(raw);
      } else {
        cache = defaultState();
      }
    } catch (e) {
      cache = defaultState();
    }
    if (!cache || typeof cache !== 'object') cache = defaultState();
    if (!cache.roomSettings || typeof cache.roomSettings !== 'object') cache.roomSettings = {};
    if (!Array.isArray(cache.favorites)) cache.favorites = [];
    if (!cache.activeSessions || typeof cache.activeSessions !== 'object') cache.activeSessions = {};
    return cache;
  }

  function saveRaw() {
    if (!cache) return;
    if (typeof global.miyaSyncFlushJsonKey === 'function') {
      global.miyaSyncFlushJsonKey(LS_KEY, cache || defaultState());
      return;
    }
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      global.miyaWriteLsJsonKey(LS_KEY, cache || defaultState()).catch(function () {});
      return;
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cache || defaultState()));
    } catch (e) {}
  }

  function getRoomSettings(contactId) {
    var id = trim(contactId);
    if (!id) return defaultRoomSettings();
    var data = loadRaw();
    return normalizeRoomSettings(data.roomSettings[id]);
  }

  function saveRoomSettings(contactId, patch) {
    var id = trim(contactId);
    if (!id) return null;
    var data = loadRaw();
    var cur = normalizeRoomSettings(data.roomSettings[id]);
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        if (patch[k] !== undefined) cur[k] = patch[k];
      });
    }
    cur.updatedAt = Date.now();
    data.roomSettings[id] = normalizeRoomSettings(cur);
    saveRaw();
    return data.roomSettings[id];
  }

  function getActiveSession(contactId) {
    var id = trim(contactId);
    if (!id) return null;
    var data = loadRaw();
    return normalizeSession(data.activeSessions[id]);
  }

  function saveActiveSession(contactId, session) {
    var id = trim(contactId);
    if (!id) return null;
    var data = loadRaw();
    if (!session) {
      delete data.activeSessions[id];
      saveRaw();
      return null;
    }
    var norm = normalizeSession(Object.assign({}, session, { contactId: id }));
    data.activeSessions[id] = norm;
    saveRaw();
    return norm;
  }

  function clearActiveSession(contactId) {
    return saveActiveSession(contactId, null);
  }

  function addFavorite(session) {
    var norm = normalizeFavorite(session);
    if (!norm || !norm.contactId) return null;
    var data = loadRaw();
    data.favorites.unshift(norm);
    if (data.favorites.length > 200) data.favorites = data.favorites.slice(0, 200);
    saveRaw();
    return norm;
  }

  function listFavorites(contactId) {
    var data = loadRaw();
    var list = (data.favorites || []).map(normalizeFavorite).filter(Boolean);
    var id = trim(contactId);
    if (id) {
      list = list.filter(function (f) { return f.contactId === id; });
    }
    return list.sort(function (a, b) { return (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt); });
  }

  function getFavorite(favId) {
    var id = trim(favId);
    if (!id) return null;
    var data = loadRaw();
    var found = (data.favorites || []).find(function (f) { return f && f.id === id; });
    return normalizeFavorite(found);
  }

  function removeFavorite(favId) {
    var id = trim(favId);
    if (!id) return false;
    var data = loadRaw();
    var before = data.favorites.length;
    data.favorites = data.favorites.filter(function (f) { return f && f.id !== id; });
    if (data.favorites.length === before) return false;
    saveRaw();
    return true;
  }

  global.miyaCoupleWhisperStore = {
    invalidateCache: function () { cache = null; },
    uid: uid,
    getRoomSettings: getRoomSettings,
    saveRoomSettings: saveRoomSettings,
    getActiveSession: getActiveSession,
    saveActiveSession: saveActiveSession,
    clearActiveSession: clearActiveSession,
    addFavorite: addFavorite,
    listFavorites: listFavorites,
    getFavorite: getFavorite,
    removeFavorite: removeFavorite,
    normalizeLine: normalizeLine,
    normalizeSession: normalizeSession
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({
      whenReady: function () {
        return global.miyaReadLsJsonKey(LS_KEY, defaultState()).then(function (v) {
          cache = v && typeof v === 'object' ? v : defaultState();
          if (global.__miyaKvMem) global.__miyaKvMem[LS_KEY] = cache;
        });
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
