/**
 * miya-deep-music-store.js — 深入 · 角色手机 Music 数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function musicKey(contactId) {
    return 'music:' + String(contactId || '').trim();
  }

  function invalidateDb(promise) {
    if (dbPromise === promise) dbPromise = null;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      var settled = false;
      req.onerror = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(req.error || new Error('deep_music_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_music_idb_blocked'));
      };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(PHONES_STORE)) {
          db.createObjectStore(PHONES_STORE);
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (e) {}
          invalidateDb(dbPromise);
        };
        db.onclose = function () { invalidateDb(dbPromise); };
        if (settled) {
          try { db.close(); } catch (e2) {}
          return;
        }
        resolve(db);
      };
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readonly');
        var req = tx.objectStore(PHONES_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readwrite');
        tx.objectStore(PHONES_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function defaultWeekStats() {
    return {
      topSong: { title: '', artist: '', playCount: 0 },
      totalMinutes: 0,
      peakPeriod: '',
      peakPeriodLabel: ''
    };
  }

  function defaultMusicData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      playlists: [],
      weekStats: defaultWeekStats(),
      nowPlayingId: ''
    };
  }

  function normalizeTrack(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var artist = String(raw.artist || raw.singer || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 't-' + (index + 1)),
      title: title,
      artist: artist,
      neteaseSongId: String(raw.neteaseSongId || raw.songId || '').trim(),
      coverUrl: String(raw.coverUrl || '').trim(),
      durationSec: Math.max(0, Number(raw.durationSec || raw.duration) || 0)
    };
  }

  function normalizePlaylist(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    var tracks = Array.isArray(raw.tracks) ? raw.tracks : Array.isArray(raw.songs) ? raw.songs : [];
    var normTracks = tracks.map(normalizeTrack).filter(Boolean).slice(0, 10);
    return {
      id: String(raw.id || 'pl-' + (index + 1)),
      title: title,
      subtitle: String(raw.subtitle || raw.desc || raw.description || '').trim(),
      mood: String(raw.mood || raw.tag || '').trim(),
      tracks: normTracks
    };
  }

  function normalizeWeekStats(raw) {
    var base = defaultWeekStats();
    if (!raw || typeof raw !== 'object') return base;
    var top = raw.topSong && typeof raw.topSong === 'object' ? raw.topSong : {};
    return {
      topSong: {
        title: String(top.title || top.name || '').trim(),
        artist: String(top.artist || '').trim(),
        playCount: Math.max(0, Number(top.playCount || top.count) || 0)
      },
      totalMinutes: Math.max(0, Number(raw.totalMinutes || raw.minutes) || 0),
      peakPeriod: String(raw.peakPeriod || raw.peakSlot || '').trim(),
      peakPeriodLabel: String(raw.peakPeriodLabel || raw.peakTime || raw.timeRange || '').trim()
    };
  }

  function normalizeMusicData(raw, contactId) {
    var base = defaultMusicData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var playlists = Array.isArray(raw.playlists)
      ? raw.playlists.map(normalizePlaylist).filter(Boolean)
      : [];
    var status = String(raw.refreshStatus || 'idle');
    if (status !== 'loading' && status !== 'success' && status !== 'error') status = 'idle';
    return {
      version: 1,
      contactId: String(raw.contactId || contactId || ''),
      updatedAt: Number(raw.updatedAt) || 0,
      refreshStatus: status,
      refreshMessage: String(raw.refreshMessage || ''),
      refreshStartedAt: Number(raw.refreshStartedAt) || 0,
      lastRefreshedAt: Number(raw.lastRefreshedAt) || 0,
      playlists: playlists,
      weekStats: normalizeWeekStats(raw.weekStats),
      nowPlayingId: String(raw.nowPlayingId || '')
    };
  }

  function getCached(contactId) {
    var key = musicKey(contactId);
    return cache[key] ? normalizeMusicData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = musicKey(contactId);
    cache[key] = normalizeMusicData(data, contactId);
    return cache[key];
  }

  function getMusic(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultMusicData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(musicKey(id)).then(function (raw) {
      var data = normalizeMusicData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultMusicData(id);
    });
  }

  function saveMusic(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeMusicData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(musicKey(id), next).then(function () { return next; });
  }

  function patchMusic(contactId, patch) {
    return getMusic(contactId).then(function (cur) {
      return saveMusic(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepMusicStore = {
    defaultMusicData: defaultMusicData,
    normalizeMusicData: normalizeMusicData,
    getMusic: getMusic,
    saveMusic: saveMusic,
    patchMusic: patchMusic,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
