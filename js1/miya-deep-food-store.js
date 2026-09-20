/**
 * miya-deep-food-store.js — 深入 · 角色手机 外卖数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function foodKey(contactId) {
    return 'food:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_food_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_food_idb_blocked'));
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

  function trim(s) { return String(s || '').trim(); }

  function defaultFoodData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      food: null
    };
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = trim(raw.name || raw.dish || raw.title);
    if (!name) return null;
    return {
      name: name,
      spec: trim(raw.spec || raw.option || raw.sku),
      qty: Math.max(1, Math.round(Number(raw.qty || raw.count) || 1)),
      price: trim(raw.price || raw.amount)
    };
  }

  function normalizeOrder(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var shop = trim(raw.shop || raw.store || raw.merchant);
    var items = Array.isArray(raw.items)
      ? raw.items.map(normalizeItem).filter(Boolean)
      : [];
    if (!shop && !items.length && !trim(raw.heroDish)) return null;
    var itemsText = trim(raw.itemsText || raw.dishes);
    if (!items.length && itemsText) {
      items = itemsText.split(/[、,，;/｜|]/).map(function (part, i) {
        var t = trim(part);
        if (!t) return null;
        var m = t.match(/^(.+?)[x×*](\d+)$/i);
        if (m) return { name: trim(m[1]), spec: '', qty: Math.max(1, parseInt(m[2], 10) || 1), price: '' };
        return { name: t, spec: '', qty: 1, price: '' };
      }).filter(Boolean);
    }
    return {
      id: trim(raw.id) || ('o-' + (index + 1)),
      time: trim(raw.time || raw.date || raw.orderedAt),
      meal: trim(raw.meal || raw.slot || raw.period),
      shop: shop,
      category: trim(raw.category || raw.cuisine),
      heroDish: trim(raw.heroDish || raw.mainDish),
      items: items,
      amount: trim(raw.amount || raw.total),
      packFee: trim(raw.packFee || raw.packing),
      deliveryFee: trim(raw.deliveryFee || raw.shipFee),
      payMethod: trim(raw.payMethod || raw.pay),
      status: trim(raw.status || '已完成'),
      rating: Math.max(0, Math.min(5, Number(raw.rating) || 0)),
      review: trim(raw.review || raw.comment),
      address: trim(raw.address || raw.dest),
      note: trim(raw.note || raw.remark),
      reason: trim(raw.reason || raw.why)
    };
  }

  function normalizeActive(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var shop = trim(raw.shop || raw.store);
    if (!shop && !trim(raw.items)) return null;
    return {
      id: trim(raw.id) || ('ao-' + (index + 1)),
      shop: shop,
      status: trim(raw.status || '配送中'),
      progress: Math.max(0, Math.min(100, Number(raw.progress) || 0)),
      eta: trim(raw.eta || raw.arrive),
      rider: trim(raw.rider || raw.courier),
      items: trim(raw.items || raw.dishes),
      amount: trim(raw.amount || raw.total)
    };
  }

  function normalizeFavorite(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var shop = trim(raw.shop || raw.name || raw.store);
    if (!shop) return null;
    return {
      id: trim(raw.id) || ('f-' + (index + 1)),
      shop: shop,
      dish: trim(raw.dish || raw.usual),
      times: Math.max(0, Math.round(Number(raw.times) || 0)),
      lastOrder: trim(raw.lastOrder || raw.last),
      note: trim(raw.note || raw.remark),
      tone: trim(raw.tone || raw.color)
    };
  }

  function normalizeWeekDay(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var day = trim(raw.day || raw.label);
    if (!day) return null;
    return {
      day: day,
      breakfast: trim(raw.breakfast),
      lunch: trim(raw.lunch),
      dinner: trim(raw.dinner)
    };
  }

  function normalizeCoupon(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    return {
      id: trim(raw.id) || ('c-' + (index + 1)),
      title: title,
      value: trim(raw.value || raw.discount),
      expire: trim(raw.expire || raw.deadline),
      shop: trim(raw.shop || raw.scope)
    };
  }

  function normalizeAddress(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var detail = trim(raw.detail || raw.address || raw.line);
    var label = trim(raw.label || raw.name);
    if (!detail && !label) return null;
    return {
      id: trim(raw.id) || ('a-' + (index + 1)),
      label: label || '地址',
      detail: detail,
      phone: trim(raw.phone || raw.mobile),
      isDefault: !!(raw.isDefault || raw.default)
    };
  }

  function normalizeCraving(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var text = trim(raw.text || raw.want || raw.dish);
    if (!text) return null;
    return {
      id: trim(raw.id) || ('cr-' + (index + 1)),
      text: text,
      trigger: trim(raw.trigger || raw.when || raw.scene)
    };
  }

  function normalizeShared(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var memory = trim(raw.memory || raw.text || raw.note);
    if (!memory && !trim(raw.dish)) return null;
    return {
      id: trim(raw.id) || ('s-' + (index + 1)),
      withWho: trim(raw.with || raw.withWho || raw.partner),
      dish: trim(raw.dish || raw.food),
      memory: memory
    };
  }

  function normalizeTaste(raw) {
    if (!raw || typeof raw !== 'object') {
      return { spice: '', avoid: '', prefer: '', budget: '', habits: '' };
    }
    return {
      spice: trim(raw.spice || raw.heat),
      avoid: trim(raw.avoid || raw.dislike),
      prefer: trim(raw.prefer || raw.like),
      budget: trim(raw.budget || raw.spend),
      habits: trim(raw.habits || raw.habit || raw.routine)
    };
  }

  function normalizeTodayPlate(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        meal: '', shop: '', heroDish: '', status: '',
        amount: '', eta: '', note: ''
      };
    }
    return {
      meal: trim(raw.meal || raw.slot),
      shop: trim(raw.shop || raw.store),
      heroDish: trim(raw.heroDish || raw.mainDish || raw.dish),
      status: trim(raw.status),
      amount: trim(raw.amount || raw.total),
      eta: trim(raw.eta || raw.time),
      note: trim(raw.note || raw.remark)
    };
  }

  function normalizeLocation(raw) {
    if (!raw || typeof raw !== 'object') {
      return { label: '', address: '', note: '' };
    }
    return {
      label: trim(raw.label || raw.name),
      address: trim(raw.address || raw.detail),
      note: trim(raw.note)
    };
  }

  function normalizeFoodPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      dateLabel: trim(raw.dateLabel || raw.date),
      location: normalizeLocation(raw.location || raw.dest || {}),
      todayPlate: normalizeTodayPlate(raw.todayPlate || raw.plate || raw.today || {}),
      activeOrders: Array.isArray(raw.activeOrders)
        ? raw.activeOrders.map(normalizeActive).filter(Boolean)
        : (Array.isArray(raw.active) ? raw.active.map(normalizeActive).filter(Boolean) : []),
      orders: Array.isArray(raw.orders)
        ? raw.orders.map(normalizeOrder).filter(Boolean)
        : (Array.isArray(raw.history) ? raw.history.map(normalizeOrder).filter(Boolean) : []),
      favorites: Array.isArray(raw.favorites)
        ? raw.favorites.map(normalizeFavorite).filter(Boolean)
        : (Array.isArray(raw.shops) ? raw.shops.map(normalizeFavorite).filter(Boolean) : []),
      taste: normalizeTaste(raw.taste || raw.prefs || {}),
      weekMeals: Array.isArray(raw.weekMeals)
        ? raw.weekMeals.map(normalizeWeekDay).filter(Boolean)
        : (Array.isArray(raw.week) ? raw.week.map(normalizeWeekDay).filter(Boolean) : []),
      coupons: Array.isArray(raw.coupons)
        ? raw.coupons.map(normalizeCoupon).filter(Boolean)
        : [],
      addresses: Array.isArray(raw.addresses)
        ? raw.addresses.map(normalizeAddress).filter(Boolean)
        : [],
      cravings: Array.isArray(raw.cravings)
        ? raw.cravings.map(normalizeCraving).filter(Boolean)
        : [],
      shared: Array.isArray(raw.shared)
        ? raw.shared.map(normalizeShared).filter(Boolean)
        : (Array.isArray(raw.together) ? raw.together.map(normalizeShared).filter(Boolean) : []),
      overview: trim(raw.overview || raw.summary),
      footerNote: trim(raw.footerNote || raw.closing)
    };
  }

  function normalizeFoodData(raw, contactId) {
    var base = defaultFoodData(contactId);
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
      food: normalizeFoodPayload(raw.food)
    };
  }

  function getCached(contactId) {
    var key = foodKey(contactId);
    return cache[key] ? normalizeFoodData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = foodKey(contactId);
    cache[key] = normalizeFoodData(data, contactId);
    return cache[key];
  }

  function getFood(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultFoodData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(foodKey(id)).then(function (raw) {
      var data = normalizeFoodData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultFoodData(id);
    });
  }

  function saveFood(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeFoodData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(foodKey(id), next).then(function () { return next; });
  }

  function patchFood(contactId, patch) {
    return getFood(contactId).then(function (cur) {
      return saveFood(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepFoodStore = {
    defaultFoodData: defaultFoodData,
    normalizeFoodData: normalizeFoodData,
    normalizeFoodPayload: normalizeFoodPayload,
    getFood: getFood,
    saveFood: saveFood,
    patchFood: patchFood,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
