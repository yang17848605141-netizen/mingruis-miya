/**
 * miya-deep-wechat-store.js — 深入 · 角色手机 微信数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function wechatKey(contactId) {
    return 'wechat:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_wechat_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_wechat_idb_blocked'));
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

  function defaultWechatData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      conversations: []
    };
  }

  function normalizeMessage(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'm-' + (index + 1)),
      sender: String(raw.sender || raw.name || raw.from || '').trim(),
      content: content,
      time: String(raw.time || raw.datetime || raw.timestamp || '').trim()
    };
  }

  function normalizeConversation(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.label || '').trim();
    if (!title) return null;
    var type = String(raw.type || 'private').trim();
    if (type !== 'group') type = 'private';
    var messages = Array.isArray(raw.messages)
      ? raw.messages.map(normalizeMessage).filter(Boolean)
      : [];
    if (messages.length < 1) return null;
    var participants = Array.isArray(raw.participants)
      ? raw.participants.map(function (p) { return String(p || '').trim(); }).filter(Boolean)
      : [];
    return {
      id: String(raw.id || 'c-' + (index + 1)),
      type: type,
      title: title,
      participants: participants,
      preview: String(raw.preview || raw.lastMessage || '').trim(),
      lastTime: String(raw.lastTime || raw.time || raw.datetime || '').trim(),
      style: String(raw.style || raw.variant || '').trim(),
      isFileAssistant: !!raw.isFileAssistant,
      messages: messages
    };
  }

  function normalizeWechatData(raw, contactId) {
    var base = defaultWechatData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var conversations = Array.isArray(raw.conversations)
      ? raw.conversations.map(normalizeConversation).filter(Boolean)
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
      conversations: conversations
    };
  }

  function getCached(contactId) {
    var key = wechatKey(contactId);
    return cache[key] ? normalizeWechatData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = wechatKey(contactId);
    cache[key] = normalizeWechatData(data, contactId);
    return cache[key];
  }

  function getWechat(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultWechatData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(wechatKey(id)).then(function (raw) {
      var data = normalizeWechatData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultWechatData(id);
    });
  }

  function saveWechat(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeWechatData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(wechatKey(id), next).then(function () { return next; });
  }

  function patchWechat(contactId, patch) {
    return getWechat(contactId).then(function (cur) {
      return saveWechat(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepWechatStore = {
    defaultWechatData: defaultWechatData,
    normalizeWechatData: normalizeWechatData,
    getWechat: getWechat,
    saveWechat: saveWechat,
    patchWechat: patchWechat,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
