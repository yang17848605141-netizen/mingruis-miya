/**
 * miya-deep-browser-store.js — 深入 · 角色手机 浏览器数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function browserKey(contactId) {
    return 'browser:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_browser_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_browser_idb_blocked'));
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

  var VALID_SEARCH_CATS = ['emotion', 'hobby', 'work', 'life', 'secret', 'random'];
  var VALID_HISTORY_CATS = ['news', 'learn', 'shop', 'social', 'entertainment', 'work', 'health', 'random'];

  function defaultBrowserData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      tagline: '',
      stats: { searches: 0, pages: 0, bookmarks: 0, tabs: 0 },
      searches: [],
      openTabs: [],
      history: [],
      bookmarks: [],
      digests: []
    };
  }

  function normalizeStyle(raw) {
    return String(raw || '').trim();
  }

  function normalizeSearch(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var query = String(raw.query || raw.text || raw.keyword || '').trim();
    if (!query) return null;
    var cat = String(raw.category || raw.type || 'random').trim().toLowerCase();
    if (VALID_SEARCH_CATS.indexOf(cat) < 0) cat = 'random';
    return {
      id: String(raw.id || 's-' + (index + 1)),
      query: query,
      time: String(raw.time || raw.datetime || '').trim(),
      when: String(raw.when || raw.date || '').trim(),
      category: cat,
      style: normalizeStyle(raw.style || raw.variant)
    };
  }

  function normalizeTab(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'tab-' + (index + 1)),
      title: title,
      domain: String(raw.domain || raw.site || '').trim(),
      url: String(raw.url || raw.link || '').trim(),
      style: normalizeStyle(raw.style || raw.variant)
    };
  }

  function normalizeHistory(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.page || '').trim();
    if (!title) return null;
    var cat = String(raw.category || raw.type || 'random').trim().toLowerCase();
    if (VALID_HISTORY_CATS.indexOf(cat) < 0) cat = 'random';
    var comments = Array.isArray(raw.comments)
      ? raw.comments.map(function (c) {
          if (typeof c === 'string') {
            var s = String(c || '').trim();
            return s ? { author: '', text: s } : null;
          }
          if (!c || typeof c !== 'object') return null;
          var text = String(c.text || c.content || c.comment || c.body || '').trim();
          if (!text) return null;
          return {
            author: String(c.author || c.user || c.name || '').trim(),
            text: text
          };
        }).filter(Boolean)
      : [];
    return {
      id: String(raw.id || 'h-' + (index + 1)),
      title: title,
      domain: String(raw.domain || raw.site || '').trim(),
      url: String(raw.url || raw.link || '').trim(),
      snippet: String(raw.snippet || raw.summary || raw.desc || raw.excerpt || '').trim(),
      content: String(raw.content || raw.body || raw.article || raw.pageContent || raw.text || raw.fullText || '').trim(),
      comments: comments,
      visitedAt: String(raw.visitedAt || raw.time || raw.date || raw.when || '').trim(),
      visitCount: Math.max(1, Number(raw.visitCount || raw.visits || raw.count) || 1),
      category: cat,
      mood: String(raw.mood || raw.feeling || raw.emotion || '').trim()
    };
  }

  function normalizeBookmark(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'b-' + (index + 1)),
      title: title,
      domain: String(raw.domain || raw.site || '').trim(),
      url: String(raw.url || raw.link || '').trim(),
      folder: String(raw.folder || raw.group || raw.collection || '未分类').trim(),
      note: String(raw.note || raw.memo || raw.comment || '').trim(),
      content: String(raw.content || raw.body || raw.article || raw.pageContent || raw.text || '').trim(),
      savedAt: String(raw.savedAt || raw.time || raw.date || '').trim()
    };
  }

  function normalizeDigest(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    var items = Array.isArray(raw.items)
      ? raw.items.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];
    if (!items.length) return null;
    return {
      id: String(raw.id || 'd-' + (index + 1)),
      title: title,
      caption: String(raw.caption || raw.subtitle || raw.desc || '').trim(),
      items: items,
      style: normalizeStyle(raw.style || raw.variant)
    };
  }

  function normalizeStats(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    return {
      searches: Math.max(0, Number(s.searches) || 0),
      pages: Math.max(0, Number(s.pages) || 0),
      bookmarks: Math.max(0, Number(s.bookmarks) || 0),
      tabs: Math.max(0, Number(s.tabs) || 0)
    };
  }

  function normalizeBrowserData(raw, contactId) {
    var base = defaultBrowserData(contactId);
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
      tagline: String(raw.tagline || raw.mood || raw.summary || '').trim(),
      stats: normalizeStats(raw.stats),
      searches: Array.isArray(raw.searches) ? raw.searches.map(normalizeSearch).filter(Boolean) : [],
      openTabs: Array.isArray(raw.openTabs)
        ? raw.openTabs.map(normalizeTab).filter(Boolean)
        : Array.isArray(raw.tabs)
          ? raw.tabs.map(normalizeTab).filter(Boolean)
          : [],
      history: Array.isArray(raw.history)
        ? raw.history.map(normalizeHistory).filter(Boolean)
        : Array.isArray(raw.pages)
          ? raw.pages.map(normalizeHistory).filter(Boolean)
          : [],
      bookmarks: Array.isArray(raw.bookmarks)
        ? raw.bookmarks.map(normalizeBookmark).filter(Boolean)
        : [],
      digests: Array.isArray(raw.digests)
        ? raw.digests.map(normalizeDigest).filter(Boolean)
        : []
    };
  }

  function getCached(contactId) {
    var key = browserKey(contactId);
    return cache[key] ? normalizeBrowserData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = browserKey(contactId);
    cache[key] = normalizeBrowserData(data, contactId);
    return cache[key];
  }

  function getBrowser(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultBrowserData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(browserKey(id)).then(function (raw) {
      var data = normalizeBrowserData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultBrowserData(id);
    });
  }

  function saveBrowser(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeBrowserData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(browserKey(id), next).then(function () { return next; });
  }

  function patchBrowser(contactId, patch) {
    return getBrowser(contactId).then(function (cur) {
      return saveBrowser(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepBrowserStore = {
    defaultBrowserData: defaultBrowserData,
    normalizeBrowserData: normalizeBrowserData,
    getBrowser: getBrowser,
    saveBrowser: saveBrowser,
    patchBrowser: patchBrowser,
    getCached: getCached,
    VALID_SEARCH_CATS: VALID_SEARCH_CATS,
    VALID_HISTORY_CATS: VALID_HISTORY_CATS
  };
})(typeof window !== 'undefined' ? window : global);
