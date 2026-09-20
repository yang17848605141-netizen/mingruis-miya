/**
 * miya-deep-sms-store.js — 深入 · 角色手机 短信数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function smsKey(contactId) {
    return 'sms:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_sms_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_sms_idb_blocked'));
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

  var VALID_CATEGORIES = ['personal', 'family', 'work', 'service', 'verify', 'spam', 'unknown'];

  function defaultSmsData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      threads: []
    };
  }

  function normalizeCategory(raw) {
    var c = String(raw || 'unknown').trim().toLowerCase();
    if (VALID_CATEGORIES.indexOf(c) < 0) c = 'unknown';
    return c;
  }

  function normalizeMessage(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    var dir = String(raw.direction || raw.dir || raw.type || '').trim().toLowerCase();
    if (dir !== 'in' && dir !== 'out') {
      dir = raw.isSelf || raw.self || raw.sent ? 'out' : 'in';
    }
    return {
      id: String(raw.id || 'm-' + (index + 1)),
      direction: dir,
      content: content,
      time: String(raw.time || raw.datetime || raw.timestamp || '').trim()
    };
  }

  function normalizeThread(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var sender = String(raw.sender || raw.contact || raw.name || raw.title || '').trim();
    if (!sender) return null;
    var messages = Array.isArray(raw.messages)
      ? raw.messages.map(normalizeMessage).filter(Boolean)
      : [];
    if (!messages.length) return null;
    return {
      id: String(raw.id || 't-' + (index + 1)),
      sender: sender,
      senderLabel: String(raw.senderLabel || raw.phone || raw.number || raw.label || '').trim(),
      category: normalizeCategory(raw.category || raw.type),
      unread: Math.max(0, Number(raw.unread) || 0),
      preview: String(raw.preview || raw.lastMessage || '').trim(),
      lastTime: String(raw.lastTime || raw.time || raw.datetime || '').trim(),
      style: String(raw.style || raw.variant || raw.layout || '').trim(),
      messages: messages
    };
  }

  function normalizeSmsData(raw, contactId) {
    var base = defaultSmsData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var threads = Array.isArray(raw.threads)
      ? raw.threads.map(normalizeThread).filter(Boolean)
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
      threads: threads
    };
  }

  function getCached(contactId) {
    var key = smsKey(contactId);
    return cache[key] ? normalizeSmsData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = smsKey(contactId);
    cache[key] = normalizeSmsData(data, contactId);
    return cache[key];
  }

  function getSms(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultSmsData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(smsKey(id)).then(function (raw) {
      var data = normalizeSmsData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultSmsData(id);
    });
  }

  function saveSms(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeSmsData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(smsKey(id), next).then(function () { return next; });
  }

  function patchSms(contactId, patch) {
    return getSms(contactId).then(function (cur) {
      return saveSms(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepSmsStore = {
    defaultSmsData: defaultSmsData,
    normalizeSmsData: normalizeSmsData,
    getSms: getSms,
    saveSms: saveSms,
    patchSms: patchSms,
    getCached: getCached,
    VALID_CATEGORIES: VALID_CATEGORIES
  };
})(typeof window !== 'undefined' ? window : global);
