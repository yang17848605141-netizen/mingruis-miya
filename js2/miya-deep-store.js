/**
 * miya-deep-store.js — 深入 · 角色手机数据（IndexedDB 为主）
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';
  var META_KEY = 'global';

  var dbPromise = null;
  var metaCache = null;

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
        reject(req.error || new Error('deep_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_idb_blocked'));
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

  function idbGet(store, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readonly');
        var req = tx.objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(store, key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDelete(store, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    }).catch(function () {});
  }

  function defaultApiConfig() {
    return {
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: null
    };
  }

  function normalizeApiConfig(raw) {
    var base = defaultApiConfig();
    if (!raw || typeof raw !== 'object') return base;
    var temp = raw.temperature;
    if (temp != null) {
      temp = Number(temp);
      if (!Number.isFinite(temp)) temp = null;
    } else {
      temp = null;
    }
    return {
      baseUrl: String(raw.baseUrl || '').trim(),
      apiKey: String(raw.apiKey || '').trim(),
      model: String(raw.model || '').trim(),
      temperature: temp
    };
  }

  function getChatApiConfig() {
    var cfg = typeof global.miyaGetApiConfigCached === 'function'
      ? global.miyaGetApiConfigCached()
      : {};
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    var temp = cfg.temperature != null ? Number(cfg.temperature) : 1;
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: String(cfg.baseUrl || '').trim(),
      apiKey: String(cfg.apiKey || '').trim(),
      model: String(cfg.model || '').trim(),
      temperature: temp
    };
  }

  function normalizeBaseUrl(base) {
    var t = String(base || '').trim().replace(/\/+$/, '');
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = (u.pathname || '/').replace(/\/+$/, '');
      var segs = path.split('/').filter(Boolean);
      if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
      if (!path || path === '/') return u.origin + '/v1';
      return u.origin + path + '/v1';
    } catch (e) {
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  /**
   * 角色查手机 API：scoped 有填则优先；某项留空时回退对话主 API 对应字段。
   */
  function resolvePhoneApiConfig(phoneData) {
    var scoped = phoneData && phoneData.api && typeof phoneData.api === 'object'
      ? normalizeApiConfig(phoneData.api)
      : defaultApiConfig();
    var chat = getChatApiConfig();
    var temp = scoped.temperature;
    if (temp == null) temp = chat.temperature;
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: scoped.baseUrl || chat.baseUrl,
      apiKey: scoped.apiKey || chat.apiKey,
      model: scoped.model || chat.model,
      temperature: temp,
      normalizedBaseUrl: normalizeBaseUrl(scoped.baseUrl || chat.baseUrl),
      isScoped: !!(scoped.baseUrl || scoped.apiKey || scoped.model || scoped.temperature != null)
    };
  }

  function defaultDecor() {
    return {
      wallpaper: null,
      icons: {},
      iconFrameless: false,
      widgets: {
        p1: {},
        p2a: {},
        p2b: {},
        p2mini: {},
        p2sleeve: {},
        p3: {}
      }
    };
  }

  function normalizeDecor(raw) {
    var base = defaultDecor();
    if (!raw || typeof raw !== 'object') return base;
    var icons = raw.icons && typeof raw.icons === 'object' ? raw.icons : {};
    var widgets = raw.widgets && typeof raw.widgets === 'object' ? raw.widgets : {};
    var nextIcons = {};
    Object.keys(icons).forEach(function (k) {
      var v = icons[k];
      if (v) nextIcons[String(k)] = v;
    });
    function normSlot(key) {
      var slot = widgets[key];
      return slot && typeof slot === 'object' ? Object.assign({}, slot) : {};
    }
    return {
      wallpaper: raw.wallpaper || null,
      icons: nextIcons,
      iconFrameless: !!raw.iconFrameless,
      widgets: {
        p1: normSlot('p1'),
        p2a: normSlot('p2a'),
        p2b: normSlot('p2b'),
        p2mini: normSlot('p2mini'),
        p2sleeve: normSlot('p2sleeve'),
        p3: normSlot('p3')
      }
    };
  }

  function defaultPhoneData(contactId, displayName) {
    var name = String(displayName || 'ta').trim() || 'ta';
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: Date.now(),
      pageIndex: 0,
      api: defaultApiConfig(),
      decor: defaultDecor(),
      widgets: {
        quote: 'The sunlight clings to you,\nand I cling to the light\nthat falls on you.',
        music: { title: 'Dream It Possible', artist: 'Delacey', progress: 0.38 },
        steps: { current: 3214, goal: 6000, bars: [30, 50, 80, 100, 70, 40, 20] },
        countdown: { days: 200, label: '距离我们的纪念日 还有' },
        moodLine: '把寻常日子，过成慢镜头。',
        profileBio: '☆ · The heartbeat has an ensemble',
        moodQuote: '无论世界如何喧嚣，你永远是我的偏爱……',
        plogTitle: 'plog ✧･ﾟ * · !! ♪',
        photoCaption: 'be good to yourself',
        todo: [
          { id: 't1', text: 'Morning run', time: '07:00', done: true },
          { id: 't2', text: 'Work meeting', time: '10:00', done: false },
          { id: 't3', text: 'Date night', time: '19:00', done: false }
        ],
        greeting: name + ' 的手机'
      }
    };
  }

  function normalizePhone(raw, contactId, displayName) {
    var base = defaultPhoneData(contactId, displayName);
    if (!raw || typeof raw !== 'object') return base;
    var w = raw.widgets && typeof raw.widgets === 'object' ? raw.widgets : {};
    var music = w.music && typeof w.music === 'object' ? w.music : {};
    var steps = w.steps && typeof w.steps === 'object' ? w.steps : {};
    var countdown = w.countdown && typeof w.countdown === 'object' ? w.countdown : {};
    var todo = Array.isArray(w.todo) ? w.todo.map(function (row, i) {
      return {
        id: String((row && row.id) || 't' + (i + 1)),
        text: String((row && row.text) || ''),
        time: String((row && row.time) || ''),
        done: !!(row && row.done)
      };
    }).filter(function (row) { return row.text; }) : base.widgets.todo;

    return {
      version: 1,
      contactId: String(raw.contactId || contactId || ''),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      pageIndex: Math.max(0, Math.min(2, parseInt(raw.pageIndex, 10) || 0)),
      api: normalizeApiConfig(raw.api),
      decor: normalizeDecor(raw.decor),
      widgets: {
        quote: String(w.quote || base.widgets.quote),
        music: {
          title: String(music.title || base.widgets.music.title),
          artist: String(music.artist || base.widgets.music.artist),
          progress: Math.max(0, Math.min(1, Number(music.progress) || base.widgets.music.progress))
        },
        steps: {
          current: Number(steps.current) || base.widgets.steps.current,
          goal: Number(steps.goal) || base.widgets.steps.goal,
          bars: Array.isArray(steps.bars) && steps.bars.length
            ? steps.bars.map(function (n) { return Math.max(4, Math.min(100, Number(n) || 4)); })
            : base.widgets.steps.bars.slice()
        },
        countdown: {
          days: Number(countdown.days) || base.widgets.countdown.days,
          label: String(countdown.label || base.widgets.countdown.label)
        },
        moodLine: String(w.moodLine || base.widgets.moodLine),
        profileBio: String(w.profileBio || base.widgets.profileBio),
        moodQuote: String(w.moodQuote || base.widgets.moodQuote),
        plogTitle: String(w.plogTitle || base.widgets.plogTitle),
        photoCaption: String(w.photoCaption || base.widgets.photoCaption),
        todo: todo.length ? todo : base.widgets.todo,
        greeting: String(w.greeting || base.widgets.greeting)
      }
    };
  }

  function getMeta() {
    if (metaCache) return Promise.resolve(metaCache);
    return idbGet(PHONES_STORE, META_KEY).then(function (raw) {
      metaCache = {
        lastContactId: String((raw && raw.lastContactId) || '')
      };
      return metaCache;
    }).catch(function () {
      metaCache = { lastContactId: '' };
      return metaCache;
    });
  }

  function setMeta(patch) {
    return getMeta().then(function (cur) {
      metaCache = Object.assign({}, cur, patch || {});
      return idbPut(PHONES_STORE, META_KEY, metaCache);
    });
  }

  function getPhone(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    return idbGet(PHONES_STORE, id).then(function (raw) {
      if (!raw || raw.__meta) return null;
      return raw;
    });
  }

  function savePhone(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id || !data) return Promise.resolve(null);
    var next = Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    });
    return idbPut(PHONES_STORE, id, next).then(function () { return next; });
  }

  function getOrCreatePhone(contactId, displayName) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    return getPhone(id).then(function (raw) {
      var normalized = normalizePhone(raw, id, displayName);
      if (!raw) {
        return savePhone(id, normalized);
      }
      return normalized;
    });
  }

  function deletePhone(contactId) {
    return idbDelete(PHONES_STORE, String(contactId || '').trim());
  }

  function listStoredContactIds() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readonly');
        var req = tx.objectStore(PHONES_STORE).getAllKeys();
        req.onsuccess = function () {
          var keys = (req.result || []).filter(function (k) { return k && k !== META_KEY; });
          resolve(keys.map(String));
        };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return []; });
  }

  function getAllContactRows() {
    var cs = global.miyaChatStore;
    if (!cs || typeof cs.getContacts !== 'function') return [];
    return (cs.getContacts() || []).filter(function (c) { return c && c.id; });
  }

  global.miyaDeepStore = {
    defaultApiConfig: defaultApiConfig,
    normalizeApiConfig: normalizeApiConfig,
    getChatApiConfig: getChatApiConfig,
    resolvePhoneApiConfig: resolvePhoneApiConfig,
    normalizeBaseUrl: normalizeBaseUrl,
    defaultDecor: defaultDecor,
    normalizeDecor: normalizeDecor,
    defaultPhoneData: defaultPhoneData,
    normalizePhone: normalizePhone,
    getMeta: getMeta,
    setMeta: setMeta,
    getPhone: getPhone,
    savePhone: savePhone,
    getOrCreatePhone: getOrCreatePhone,
    deletePhone: deletePhone,
    listStoredContactIds: listStoredContactIds,
    getAllContactRows: getAllContactRows
  };
})(typeof window !== 'undefined' ? window : global);
