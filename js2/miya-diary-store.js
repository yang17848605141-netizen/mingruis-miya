/**
 * miya-diary-store.js — 角色日记与用户日记持久化
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-diary-v1';
  var cache = null;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function isoDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function uid(prefix) {
    return (prefix || 'dy') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function loadRaw() {
    if (cache) return cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var mem = global.miyaSyncReadJsonKey(STORAGE_KEY);
      if (mem && typeof mem === 'object') {
        cache = mem;
        if (!cache.diaries || typeof cache.diaries !== 'object') cache.diaries = {};
        if (!cache.userDiaries || typeof cache.userDiaries !== 'object') cache.userDiaries = {};
        if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
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
      cache = { diaries: {}, userDiaries: {}, settings: {} };
    }
    if (!cache.diaries || typeof cache.diaries !== 'object') cache.diaries = {};
    if (!cache.userDiaries || typeof cache.userDiaries !== 'object') cache.userDiaries = {};
    if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
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

  function defaultSettings() {
    return {
      autoWrite: {
        enabled: false,
        hour: 22,
        minute: 0,
        lastRunDateIso: ''
      },
      peek: {
        enabled: false,
        chance: 15
      }
    };
  }

  function normalizeSettings(raw) {
    var base = defaultSettings();
    if (!raw || typeof raw !== 'object') return base;
    var aw = raw.autoWrite && typeof raw.autoWrite === 'object' ? raw.autoWrite : {};
    var pk = raw.peek && typeof raw.peek === 'object' ? raw.peek : {};
    var hour = parseInt(aw.hour, 10);
    var minute = parseInt(aw.minute, 10);
    var chance = parseInt(pk.chance, 10);
    return {
      autoWrite: {
        enabled: !!aw.enabled,
        hour: hour >= 0 && hour <= 23 ? hour : base.autoWrite.hour,
        minute: minute >= 0 && minute <= 59 ? minute : base.autoWrite.minute,
        lastRunDateIso: String(aw.lastRunDateIso || '').trim()
      },
      peek: {
        enabled: !!pk.enabled,
        chance: chance >= 0 && chance <= 100 ? chance : base.peek.chance
      }
    };
  }

  function getContactDiaries(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return [];
    var list = loadRaw().diaries[id];
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function findByDate(contactId, dateIso) {
    var d = String(dateIso || '').trim();
    if (!d) return null;
    return getContactDiaries(contactId).find(function (row) {
      return row && row.dateIso === d;
    }) || null;
  }

  function addDiary(contactId, entry) {
    var id = String(contactId || '').trim();
    if (!id || !entry) return null;
    var row = {
      id: String(entry.id || uid('dy')),
      dateIso: String(entry.dateIso || isoDate(new Date())),
      createdAt: Number(entry.createdAt) || Date.now(),
      title: String(entry.title || '').trim(),
      content: String(entry.content || '').trim(),
      mood: String(entry.mood || '').trim(),
      wordCount: Number(entry.wordCount) || 0
    };
    if (!row.content) return null;
    if (!row.title) row.title = row.dateIso + ' 的日记';
    if (!row.wordCount) row.wordCount = row.content.replace(/\s/g, '').length;

    var data = loadRaw();
    if (!Array.isArray(data.diaries[id])) data.diaries[id] = [];
    var idx = data.diaries[id].findIndex(function (r) { return r && r.dateIso === row.dateIso; });
    if (idx >= 0) {
      data.diaries[id][idx] = row;
    } else {
      data.diaries[id].push(row);
    }
    saveRaw();
    return row;
  }

  function removeDiary(contactId, diaryId) {
    var cid = String(contactId || '').trim();
    var did = String(diaryId || '').trim();
    if (!cid || !did) return false;
    var data = loadRaw();
    var list = data.diaries[cid];
    if (!Array.isArray(list)) return false;
    var next = list.filter(function (r) { return r && r.id !== did; });
    if (next.length === list.length) return false;
    data.diaries[cid] = next;
    saveRaw();
    return true;
  }

  function getUserDiaries(profileId) {
    var pid = String(profileId || '').trim();
    if (!pid) return [];
    var list = loadRaw().userDiaries[pid];
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function getUserDiariesForDate(profileId, dateIso) {
    var d = String(dateIso || '').trim();
    if (!d) return [];
    return getUserDiaries(profileId).filter(function (row) {
      return row && row.dateIso === d;
    });
  }

  function findUserDiary(profileId, diaryId) {
    var did = String(diaryId || '').trim();
    if (!did) return null;
    return getUserDiaries(profileId).find(function (r) { return r && r.id === did; }) || null;
  }

  function saveUserDiary(profileId, entry) {
    var pid = String(profileId || '').trim();
    if (!pid || !entry) return null;
    var now = Date.now();
    var row = {
      id: String(entry.id || uid('udy')),
      profileId: pid,
      dateIso: String(entry.dateIso || isoDate(new Date())),
      title: String(entry.title || '').trim(),
      content: String(entry.content || '').trim(),
      createdAt: Number(entry.createdAt) || now,
      updatedAt: now
    };
    if (!row.content) return null;
    if (!row.title) row.title = row.dateIso + ' 的随笔';

    var data = loadRaw();
    if (!Array.isArray(data.userDiaries[pid])) data.userDiaries[pid] = [];
    var idx = data.userDiaries[pid].findIndex(function (r) { return r && r.id === row.id; });
    if (idx >= 0) {
      row.createdAt = data.userDiaries[pid][idx].createdAt || row.createdAt;
      data.userDiaries[pid][idx] = row;
    } else {
      data.userDiaries[pid].push(row);
    }
    saveRaw();
    return row;
  }

  function removeUserDiary(profileId, diaryId) {
    var pid = String(profileId || '').trim();
    var did = String(diaryId || '').trim();
    if (!pid || !did) return false;
    var data = loadRaw();
    var list = data.userDiaries[pid];
    if (!Array.isArray(list)) return false;
    var next = list.filter(function (r) { return r && r.id !== did; });
    if (next.length === list.length) return false;
    data.userDiaries[pid] = next;
    saveRaw();
    return true;
  }

  function getDiarySettings(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return defaultSettings();
    var raw = loadRaw().settings[id];
    return normalizeSettings(raw);
  }

  function saveDiarySettings(contactId, patch) {
    var id = String(contactId || '').trim();
    if (!id) return null;
    var data = loadRaw();
    var prev = normalizeSettings(data.settings[id]);
    var next = normalizeSettings(Object.assign({}, prev, patch || {}));
    if (patch && patch.autoWrite) {
      next.autoWrite = normalizeSettings({ autoWrite: Object.assign({}, prev.autoWrite, patch.autoWrite) }).autoWrite;
    }
    if (patch && patch.peek) {
      next.peek = normalizeSettings({ peek: Object.assign({}, prev.peek, patch.peek) }).peek;
    }
    data.settings[id] = next;
    saveRaw();
    return next;
  }

  function getAllDiarySettings() {
    var data = loadRaw();
    var out = {};
    Object.keys(data.settings || {}).forEach(function (cid) {
      out[cid] = normalizeSettings(data.settings[cid]);
    });
    return out;
  }

  function getAllContactRows() {
    var cs = global.miyaChatStore;
    if (!cs || typeof cs.getContacts !== 'function') return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && c.id;
    });
  }

  function invalidateCache() {
    cache = null;
  }

  global.miyaDiaryStore = {
    invalidateCache: invalidateCache,
    isoDate: isoDate,
    getContactDiaries: getContactDiaries,
    findByDate: findByDate,
    addDiary: addDiary,
    removeDiary: removeDiary,
    getUserDiaries: getUserDiaries,
    getUserDiariesForDate: getUserDiariesForDate,
    findUserDiary: findUserDiary,
    saveUserDiary: saveUserDiary,
    removeUserDiary: removeUserDiary,
    getDiarySettings: getDiarySettings,
    saveDiarySettings: saveDiarySettings,
    getAllDiarySettings: getAllDiarySettings,
    defaultSettings: defaultSettings,
    getAllContactRows: getAllContactRows
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({
      whenReady: function () {
        return global.miyaReadLsJsonKey(STORAGE_KEY, { diaries: {}, userDiaries: {}, settings: {} }).then(function (v) {
          cache = v && typeof v === 'object' ? v : { diaries: {}, userDiaries: {}, settings: {} };
          if (!cache.diaries || typeof cache.diaries !== 'object') cache.diaries = {};
          if (!cache.userDiaries || typeof cache.userDiaries !== 'object') cache.userDiaries = {};
          if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
          if (global.__miyaKvMem) global.__miyaKvMem[STORAGE_KEY] = cache;
        });
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
