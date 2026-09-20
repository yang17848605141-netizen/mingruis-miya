/**
 * miya-deep-novel-store.js — 深入 · 角色手机 小说库数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function novelKey(contactId) {
    return 'novel:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_novel_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_novel_idb_blocked'));
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

  function defaultBookRef() {
    return { title: '', author: '' };
  }

  function defaultWeekStats() {
    return {
      favoriteBook: defaultBookRef(),
      totalMinutes: 0,
      plannedBook: defaultBookRef(),
      readingQuote: ''
    };
  }

  function defaultNovelData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      shelves: [],
      weekStats: defaultWeekStats()
    };
  }

  function normalizeBook(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var author = String(raw.author || raw.writer || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'b-' + (index + 1)),
      title: title,
      author: author,
      currentChapter: String(raw.currentChapter || raw.chapter || raw.progress || '').trim(),
      annotation: String(raw.annotation || raw.note || raw.review || raw.comment || '').trim()
    };
  }

  function normalizeShelf(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var category = String(raw.category || raw.title || raw.name || '').trim();
    if (!category) return null;
    var books = Array.isArray(raw.books) ? raw.books : [];
    var normBooks = books.map(normalizeBook).filter(Boolean).slice(0, 10);
    return {
      id: String(raw.id || 'shelf-' + (index + 1)),
      category: category,
      categoryEn: String(raw.categoryEn || raw.tagEn || '').trim(),
      tagline: String(raw.tagline || raw.subtitle || raw.desc || '').trim(),
      books: normBooks
    };
  }

  function normalizeBookRef(raw) {
    if (!raw || typeof raw !== 'object') return defaultBookRef();
    return {
      title: String(raw.title || raw.name || '').trim(),
      author: String(raw.author || '').trim()
    };
  }

  function normalizeWeekStats(raw) {
    var base = defaultWeekStats();
    if (!raw || typeof raw !== 'object') return base;
    return {
      favoriteBook: normalizeBookRef(raw.favoriteBook || raw.favorite),
      totalMinutes: Math.max(0, Number(raw.totalMinutes || raw.minutes || raw.readingMinutes) || 0),
      plannedBook: normalizeBookRef(raw.plannedBook || raw.planned || raw.nextBook),
      readingQuote: String(raw.readingQuote || raw.quote || '').trim()
    };
  }

  function normalizeNovelData(raw, contactId) {
    var base = defaultNovelData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var shelves = Array.isArray(raw.shelves)
      ? raw.shelves.map(normalizeShelf).filter(Boolean)
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
      shelves: shelves,
      weekStats: normalizeWeekStats(raw.weekStats)
    };
  }

  function getCached(contactId) {
    var key = novelKey(contactId);
    return cache[key] ? normalizeNovelData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = novelKey(contactId);
    cache[key] = normalizeNovelData(data, contactId);
    return cache[key];
  }

  function getNovel(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultNovelData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(novelKey(id)).then(function (raw) {
      var data = normalizeNovelData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultNovelData(id);
    });
  }

  function saveNovel(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeNovelData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(novelKey(id), next).then(function () { return next; });
  }

  function patchNovel(contactId, patch) {
    return getNovel(contactId).then(function (cur) {
      return saveNovel(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepNovelStore = {
    defaultNovelData: defaultNovelData,
    normalizeNovelData: normalizeNovelData,
    getNovel: getNovel,
    saveNovel: saveNovel,
    patchNovel: patchNovel,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
