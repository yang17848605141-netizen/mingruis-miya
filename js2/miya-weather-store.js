/**
 * miya-weather-store.js — 天气 App 数据（与聊天天气感知分离）
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-weather-v1';
  var cache = null;

  function emptyState() {
    return {
      version: 1,
      myLocation: {
        id: 'me',
        name: '',
        lat: null,
        lon: null,
        source: '',
        permission: 'unknown',
        updatedAt: 0
      },
      cities: [],
      careSettings: {},
      cares: [],
      forecastCache: {},
      unreadCareCount: 0
    };
  }

  function ensureShape(raw) {
    var s = emptyState();
    if (!raw || typeof raw !== 'object') return s;
    s.myLocation = Object.assign({}, s.myLocation, raw.myLocation || {});
    s.cities = Array.isArray(raw.cities) ? raw.cities.filter(Boolean) : [];
    s.careSettings = raw.careSettings && typeof raw.careSettings === 'object' ? raw.careSettings : {};
    s.cares = Array.isArray(raw.cares) ? raw.cares.filter(Boolean) : [];
    s.forecastCache = raw.forecastCache && typeof raw.forecastCache === 'object' ? raw.forecastCache : {};
    s.unreadCareCount = Number(raw.unreadCareCount) || 0;
    s.version = 1;
    return s;
  }

  function loadRaw() {
    if (cache) return cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var mem = global.miyaSyncReadJsonKey(STORAGE_KEY);
      if (mem && typeof mem === 'object') {
        cache = ensureShape(mem);
        return cache;
      }
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw))) {
        cache = ensureShape(JSON.parse(raw));
      } else {
        cache = emptyState();
      }
    } catch (e) {
      cache = emptyState();
    }
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

  function uid(prefix) {
    return String(prefix || 'w') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function isoDate(d) {
    d = d instanceof Date ? d : new Date(d || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function getState() {
    return loadRaw();
  }

  function getMyLocation() {
    return Object.assign({}, loadRaw().myLocation);
  }

  function setMyLocation(patch) {
    var s = loadRaw();
    s.myLocation = Object.assign({}, s.myLocation, patch || {}, { updatedAt: Date.now() });
    saveRaw();
    return getMyLocation();
  }

  function listCities() {
    return loadRaw().cities.slice();
  }

  function findCity(id) {
    var key = String(id || '');
    if (key === 'me') {
      var me = getMyLocation();
      return {
        id: 'me',
        name: me.name || '我的位置',
        lat: me.lat,
        lon: me.lon,
        kind: 'me',
        source: me.source
      };
    }
    return loadRaw().cities.find(function (c) {
      return c && String(c.id) === key;
    }) || null;
  }

  function upsertCity(city) {
    if (!city || typeof city !== 'object') return null;
    var s = loadRaw();
    var id = String(city.id || uid('city'));
    var next = {
      id: id,
      name: String(city.name || '').trim(),
      lat: Number(city.lat),
      lon: Number(city.lon),
      kind: city.kind === 'char' ? 'char' : 'saved',
      contactId: String(city.contactId || '').trim(),
      characterId: String(city.characterId || '').trim(),
      label: String(city.label || '').trim(),
      updatedAt: Date.now()
    };
    if (!Number.isFinite(next.lat) || !Number.isFinite(next.lon) || !next.name) return null;
    var idx = s.cities.findIndex(function (c) {
      return c && String(c.id) === id;
    });
    if (idx >= 0) s.cities[idx] = Object.assign({}, s.cities[idx], next);
    else s.cities.push(next);
    saveRaw();
    return findCity(id);
  }

  function removeCity(id) {
    var key = String(id || '');
    if (!key || key === 'me') return false;
    var s = loadRaw();
    var before = s.cities.length;
    s.cities = s.cities.filter(function (c) {
      return !(c && String(c.id) === key);
    });
    Object.keys(s.careSettings).forEach(function (cid) {
      if (s.careSettings[cid] && String(s.careSettings[cid].cityId) === key) {
        s.careSettings[cid].cityId = '';
      }
    });
    saveRaw();
    return s.cities.length < before;
  }

  function findCityByContact(contactId) {
    var key = String(contactId || '');
    if (!key) return null;
    return loadRaw().cities.find(function (c) {
      return c && c.kind === 'char' && String(c.contactId) === key;
    }) || null;
  }

  function getCareSetting(contactId) {
    var key = String(contactId || '');
    var raw = loadRaw().careSettings[key] || {};
    return {
      enabled: !!raw.enabled,
      windowStart: String(raw.windowStart || '08:00'),
      windowEnd: String(raw.windowEnd || '10:00'),
      cityId: String(raw.cityId || ''),
      lastCareDate: String(raw.lastCareDate || ''),
      lastCareAt: Number(raw.lastCareAt) || 0
    };
  }

  function setCareSetting(contactId, patch) {
    var key = String(contactId || '');
    if (!key) return null;
    var s = loadRaw();
    s.careSettings[key] = Object.assign({}, getCareSetting(key), patch || {});
    saveRaw();
    return getCareSetting(key);
  }

  function listCareSettings() {
    var s = loadRaw();
    return Object.keys(s.careSettings).map(function (id) {
      return Object.assign({ contactId: id }, getCareSetting(id));
    });
  }

  function recomputeUnread() {
    var s = loadRaw();
    s.unreadCareCount = s.cares.filter(function (c) {
      return c && !c.read;
    }).length;
    return s.unreadCareCount;
  }

  function listCares(opts) {
    opts = opts || {};
    var list = loadRaw().cares.slice().sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    if (opts.contactId) {
      var cid = String(opts.contactId);
      list = list.filter(function (c) {
        return c && String(c.contactId) === cid;
      });
    }
    if (opts.unreadOnly) {
      list = list.filter(function (c) {
        return c && !c.read;
      });
    }
    return list;
  }

  function getCare(id) {
    var key = String(id || '');
    return loadRaw().cares.find(function (c) {
      return c && String(c.id) === key;
    }) || null;
  }

  function isUserSentCareText(text) {
    return String(text || '').indexOf('【我送出的关心】') === 0;
  }

  /** 角色（非用户送出）今天是否已有关心 */
  function hasCharacterCareToday(contactId, day) {
    var key = String(contactId || '');
    if (!key) return false;
    var today = String(day || isoDate(new Date()));
    return listCares({ contactId: key }).some(function (c) {
      if (!c || String(c.date) !== today) return false;
      return !isUserSentCareText(c.text);
    });
  }

  function addCare(entry) {
    if (!entry || !entry.text) return null;
    var s = loadRaw();
    var row = {
      id: String(entry.id || uid('care')),
      contactId: String(entry.contactId || '').trim(),
      contactName: String(entry.contactName || '').trim(),
      date: String(entry.date || isoDate(new Date())),
      text: String(entry.text || '').trim(),
      weatherSnapshot: entry.weatherSnapshot && typeof entry.weatherSnapshot === 'object'
        ? entry.weatherSnapshot
        : null,
      read: false,
      createdAt: Number(entry.createdAt) || Date.now(),
      replies: Array.isArray(entry.replies) ? entry.replies : []
    };
    s.cares.unshift(row);
    if (s.cares.length > 200) s.cares = s.cares.slice(0, 200);
    /* 仅角色发出的关心计入「每日一次」；用户送给角色的不占名额 */
    if (row.contactId && !isUserSentCareText(row.text)) {
      var cs = getCareSetting(row.contactId);
      s.careSettings[row.contactId] = Object.assign({}, cs, {
        lastCareDate: row.date,
        lastCareAt: row.createdAt
      });
    }
    recomputeUnread();
    saveRaw();
    return row;
  }

  function markCareRead(id) {
    var s = loadRaw();
    var hit = false;
    s.cares.forEach(function (c) {
      if (c && String(c.id) === String(id) && !c.read) {
        c.read = true;
        hit = true;
      }
    });
    if (hit) {
      recomputeUnread();
      saveRaw();
    }
    return hit;
  }

  function markAllCaresRead() {
    var s = loadRaw();
    var hit = false;
    s.cares.forEach(function (c) {
      if (c && !c.read) {
        c.read = true;
        hit = true;
      }
    });
    if (hit) {
      recomputeUnread();
      saveRaw();
    }
    return hit;
  }

  function addCareReply(careId, text, meta) {
    meta = meta || {};
    var s = loadRaw();
    var row = s.cares.find(function (c) {
      return c && String(c.id) === String(careId);
    });
    if (!row) return null;
    var reply = {
      id: uid('reply'),
      text: String(text || '').trim(),
      from: meta.from === 'char' ? 'char' : 'user',
      at: Date.now()
    };
    if (!reply.text) return null;
    if (!Array.isArray(row.replies)) row.replies = [];
    row.replies.push(reply);
    /* 角色回了一句 → 标未读，方便顶栏提示；用户自己说的保持已读 */
    if (reply.from === 'char') row.read = false;
    else row.read = true;
    recomputeUnread();
    saveRaw();
    return reply;
  }

  function cacheKey(lat, lon) {
    return Number(lat).toFixed(3) + ',' + Number(lon).toFixed(3);
  }

  function getForecastCache(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    var hit = loadRaw().forecastCache[cacheKey(lat, lon)];
    if (!hit || !hit.data) return null;
    return hit;
  }

  function setForecastCache(lat, lon, data) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !data) return;
    var s = loadRaw();
    s.forecastCache[cacheKey(lat, lon)] = { fetchedAt: Date.now(), data: data };
    var keys = Object.keys(s.forecastCache);
    if (keys.length > 40) {
      keys
        .sort(function (a, b) {
          return (s.forecastCache[a].fetchedAt || 0) - (s.forecastCache[b].fetchedAt || 0);
        })
        .slice(0, keys.length - 30)
        .forEach(function (k) {
          delete s.forecastCache[k];
        });
    }
    saveRaw();
  }

  function getUnreadCount() {
    recomputeUnread();
    return loadRaw().unreadCareCount || 0;
  }

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({
      whenReady: function () {
        return global.miyaReadLsJsonKey(STORAGE_KEY, emptyState()).then(function (v) {
          cache = ensureShape(v);
          if (global.__miyaKvMem) global.__miyaKvMem[STORAGE_KEY] = cache;
        });
      }
    });
  }

  global.miyaWeatherStore = {
    STORAGE_KEY: STORAGE_KEY,
    invalidateCache: function () { cache = null; },
    uid: uid,
    isoDate: isoDate,
    getState: getState,
    getMyLocation: getMyLocation,
    setMyLocation: setMyLocation,
    listCities: listCities,
    findCity: findCity,
    upsertCity: upsertCity,
    removeCity: removeCity,
    findCityByContact: findCityByContact,
    getCareSetting: getCareSetting,
    setCareSetting: setCareSetting,
    listCareSettings: listCareSettings,
    listCares: listCares,
    getCare: getCare,
    hasCharacterCareToday: hasCharacterCareToday,
    addCare: addCare,
    markCareRead: markCareRead,
    markAllCaresRead: markAllCaresRead,
    addCareReply: addCareReply,
    getForecastCache: getForecastCache,
    setForecastCache: setForecastCache,
    getUnreadCount: getUnreadCount
  };
})(typeof window !== 'undefined' ? window : global);
