/**
 * miya-deep-health-store.js — 深入 · 角色手机 健康数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function healthKey(contactId) {
    return 'health:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_health_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_health_idb_blocked'));
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

  function defaultHealthData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      health: null
    };
  }

  function normalizeSubItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var key = String(raw.key || raw.label || raw.name || '').trim();
    var value = String(raw.value || raw.val || '').trim();
    if (!key && !value) return null;
    return { key: key, value: value };
  }

  function normalizeMetric(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || '').trim();
    if (!name) return null;
    var bars = Array.isArray(raw.weekBars) ? raw.weekBars.map(function (n) {
      return Math.max(0, Math.min(100, Number(n) || 0));
    }) : [];
    var subItems = Array.isArray(raw.subItems)
      ? raw.subItems.map(normalizeSubItem).filter(Boolean)
      : [];
    return {
      id: String(raw.id || 'm-' + (index + 1)),
      name: name,
      icon: String(raw.icon || '').trim(),
      score: Math.max(0, Math.min(100, Number(raw.score) || 0)),
      value: String(raw.value || raw.mainValue || '').trim(),
      unit: String(raw.unit || '').trim(),
      label: String(raw.label || raw.status || '').trim(),
      detail: String(raw.detail || raw.description || '').trim(),
      note: String(raw.note || raw.remark || '').trim(),
      subItems: subItems,
      weekBars: bars
    };
  }

  function normalizeHighlight(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var text = String(raw.text || raw.content || '').trim();
    if (!text) return null;
    return {
      time: String(raw.time || raw.date || '').trim(),
      metric: String(raw.metric || raw.category || '').trim(),
      text: text
    };
  }

  function normalizeInsight(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var text = String(raw.text || raw.content || '').trim();
    if (!text) return null;
    return {
      title: String(raw.title || raw.label || '').trim(),
      text: text
    };
  }

  function normalizeHealthPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var metrics = Array.isArray(raw.metrics)
      ? raw.metrics.map(normalizeMetric).filter(Boolean)
      : [];
    var highlights = Array.isArray(raw.highlights)
      ? raw.highlights.map(normalizeHighlight).filter(Boolean)
      : [];
    var insights = Array.isArray(raw.insights)
      ? raw.insights.map(normalizeInsight).filter(Boolean)
      : [];
    var hero = raw.hero && typeof raw.hero === 'object' ? {
      greeting: String(raw.hero.greeting || '').trim(),
      status: String(raw.hero.status || '').trim(),
      trend: String(raw.hero.trend || 'stable').trim()
    } : { greeting: '', status: '', trend: 'stable' };
    return {
      dateLabel: String(raw.dateLabel || raw.date || '').trim(),
      overallScore: Math.max(0, Math.min(100, Number(raw.overallScore) || 0)),
      overallNote: String(raw.overallNote || raw.summary || '').trim(),
      hero: hero,
      metrics: metrics,
      highlights: highlights,
      insights: insights,
      footerNote: String(raw.footerNote || raw.closing || '').trim()
    };
  }

  function normalizeHealthData(raw, contactId) {
    var base = defaultHealthData(contactId);
    if (!raw || typeof raw !== 'object') return base;
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
      health: normalizeHealthPayload(raw.health)
    };
  }

  function getCached(contactId) {
    var key = healthKey(contactId);
    return cache[key] ? normalizeHealthData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = healthKey(contactId);
    cache[key] = normalizeHealthData(data, contactId);
    return cache[key];
  }

  function getHealth(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultHealthData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(healthKey(id)).then(function (raw) {
      var data = normalizeHealthData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultHealthData(id);
    });
  }

  function saveHealth(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeHealthData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(healthKey(id), next).then(function () { return next; });
  }

  function patchHealth(contactId, patch) {
    return getHealth(contactId).then(function (cur) {
      return saveHealth(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepHealthStore = {
    defaultHealthData: defaultHealthData,
    normalizeHealthData: normalizeHealthData,
    getHealth: getHealth,
    saveHealth: saveHealth,
    patchHealth: patchHealth,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
