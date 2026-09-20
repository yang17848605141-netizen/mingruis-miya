/**
 * miya-deep-notepad-store.js — 深入 · 角色手机 记事本数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function notepadKey(contactId) {
    return 'notepad:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_notepad_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_notepad_idb_blocked'));
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

  function defaultNotepadData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      notes: []
    };
  }

  function normalizeNote(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'n-' + (index + 1)),
      datetime: String(raw.datetime || raw.time || raw.date || '').trim(),
      timeLabel: String(raw.timeLabel || raw.label || raw.period || '').trim(),
      content: content,
      strikethrough: String(raw.strikethrough || raw.crossed || raw.deleted || '').trim(),
      number: String(raw.number || raw.no || raw.index || '').trim(),
      style: String(raw.style || raw.variant || '').trim(),
      tag: String(raw.tag || raw.mood || raw.category || '').trim()
    };
  }

  function normalizeNotepadData(raw, contactId) {
    var base = defaultNotepadData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var notes = Array.isArray(raw.notes)
      ? raw.notes.map(normalizeNote).filter(Boolean)
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
      notes: notes
    };
  }

  function getCached(contactId) {
    var key = notepadKey(contactId);
    return cache[key] ? normalizeNotepadData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = notepadKey(contactId);
    cache[key] = normalizeNotepadData(data, contactId);
    return cache[key];
  }

  function getNotepad(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultNotepadData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(notepadKey(id)).then(function (raw) {
      var data = normalizeNotepadData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultNotepadData(id);
    });
  }

  function saveNotepad(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeNotepadData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(notepadKey(id), next).then(function () { return next; });
  }

  function patchNotepad(contactId, patch) {
    return getNotepad(contactId).then(function (cur) {
      return saveNotepad(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepNotepadStore = {
    defaultNotepadData: defaultNotepadData,
    normalizeNotepadData: normalizeNotepadData,
    getNotepad: getNotepad,
    saveNotepad: saveNotepad,
    patchNotepad: patchNotepad,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
