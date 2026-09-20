/**
 * miya-deep-shop-store.js — 深入 · 角色手机 购物数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function shopKey(contactId) {
    return 'shop:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_shop_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_shop_idb_blocked'));
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

  function defaultShopData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      shop: null
    };
  }

  function normalizeLineItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = trim(raw.name || raw.title || raw.item);
    if (!name) return null;
    return {
      name: name,
      sku: trim(raw.sku || raw.spec || raw.option),
      qty: Math.max(1, Math.round(Number(raw.qty || raw.count) || 1)),
      price: trim(raw.price || raw.amount)
    };
  }

  function normalizeMember(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        tier: '', points: '', spendMonth: '', orderCount: '',
        style: '', note: ''
      };
    }
    return {
      tier: trim(raw.tier || raw.level || raw.vip),
      points: trim(raw.points || raw.taqi || raw.score),
      spendMonth: trim(raw.spendMonth || raw.monthSpend || raw.spent),
      orderCount: trim(raw.orderCount || raw.orders || raw.count),
      style: trim(raw.style || raw.taste || raw.aesthetic),
      note: trim(raw.note || raw.habit || raw.remark)
    };
  }

  function normalizePackage(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.item || raw.name);
    var shop = trim(raw.shop || raw.store || raw.seller);
    if (!title && !shop) return null;
    return {
      id: trim(raw.id) || ('pk-' + (index + 1)),
      shop: shop,
      title: title,
      status: trim(raw.status || '运输中'),
      progress: Math.max(0, Math.min(100, Number(raw.progress) || 0)),
      carrier: trim(raw.carrier || raw.express || raw.logistics),
      tracking: trim(raw.tracking || raw.trackNo || raw.tail),
      eta: trim(raw.eta || raw.arrive || raw.arriveAt),
      price: trim(raw.price || raw.amount)
    };
  }

  function normalizeCart(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.item);
    if (!title) return null;
    return {
      id: trim(raw.id) || ('ct-' + (index + 1)),
      shop: trim(raw.shop || raw.store || raw.seller),
      title: title,
      sku: trim(raw.sku || raw.spec || raw.option),
      qty: Math.max(1, Math.round(Number(raw.qty || raw.count) || 1)),
      price: trim(raw.price || raw.amount),
      origin: trim(raw.origin || raw.original || raw.listPrice),
      tag: trim(raw.tag || raw.promo || raw.badge)
    };
  }

  function normalizeOrder(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var shop = trim(raw.shop || raw.store || raw.seller);
    var title = trim(raw.title || raw.hero || raw.main);
    var items = Array.isArray(raw.items)
      ? raw.items.map(normalizeLineItem).filter(Boolean)
      : [];
    var itemsText = trim(raw.itemsText || raw.goods);
    if (!items.length && itemsText) {
      items = itemsText.split(/[、,，;/｜|]/).map(function (part) {
        var t = trim(part);
        if (!t) return null;
        var m = t.match(/^(.+?)[x×*](\d+)$/i);
        if (m) return { name: trim(m[1]), sku: '', qty: Math.max(1, parseInt(m[2], 10) || 1), price: '' };
        return { name: t, sku: '', qty: 1, price: '' };
      }).filter(Boolean);
    }
    if (!shop && !title && !items.length) return null;
    return {
      id: trim(raw.id) || ('o-' + (index + 1)),
      time: trim(raw.time || raw.date || raw.orderedAt),
      shop: shop,
      title: title || (items[0] && items[0].name) || '',
      category: trim(raw.category || raw.cate),
      items: items,
      amount: trim(raw.amount || raw.total),
      freight: trim(raw.freight || raw.shipFee || raw.postage),
      payMethod: trim(raw.payMethod || raw.pay),
      status: trim(raw.status || '已收货'),
      reason: trim(raw.reason || raw.why),
      review: trim(raw.review || raw.comment),
      address: trim(raw.address || raw.dest)
    };
  }

  function normalizeWish(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.item);
    if (!title) return null;
    return {
      id: trim(raw.id) || ('w-' + (index + 1)),
      title: title,
      shop: trim(raw.shop || raw.store),
      price: trim(raw.price || raw.amount),
      reason: trim(raw.reason || raw.why || raw.note),
      tone: trim(raw.tone || raw.color)
    };
  }

  function normalizeFollow(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var shop = trim(raw.shop || raw.name || raw.store);
    if (!shop) return null;
    return {
      id: trim(raw.id) || ('f-' + (index + 1)),
      shop: shop,
      category: trim(raw.category || raw.cate || raw.type),
      note: trim(raw.note || raw.remark || raw.why)
    };
  }

  function normalizeBrowsed(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.item);
    if (!title) return null;
    return {
      id: trim(raw.id) || ('b-' + (index + 1)),
      title: title,
      shop: trim(raw.shop || raw.store),
      price: trim(raw.price || raw.amount),
      when: trim(raw.when || raw.time || raw.viewedAt)
    };
  }

  function normalizeCoupon(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    return {
      id: trim(raw.id) || ('cp-' + (index + 1)),
      title: title,
      value: trim(raw.value || raw.discount),
      expire: trim(raw.expire || raw.deadline),
      scope: trim(raw.scope || raw.shop || raw.useOn)
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

  function normalizeHabits(raw) {
    if (!raw || typeof raw !== 'object') {
      return { budget: '', prefer: '', avoid: '', routine: '' };
    }
    return {
      budget: trim(raw.budget || raw.spend),
      prefer: trim(raw.prefer || raw.like),
      avoid: trim(raw.avoid || raw.dislike),
      routine: trim(raw.routine || raw.habit || raw.habits)
    };
  }

  function normalizeGift(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var item = trim(raw.item || raw.title || raw.gift);
    var memory = trim(raw.memory || raw.text || raw.note);
    if (!item && !memory) return null;
    return {
      id: trim(raw.id) || ('g-' + (index + 1)),
      withWho: trim(raw.with || raw.withWho || raw.partner),
      item: item,
      memory: memory
    };
  }

  function normalizeShopPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      dateLabel: trim(raw.dateLabel || raw.date),
      member: normalizeMember(raw.member || raw.profile || raw.account || {}),
      packages: Array.isArray(raw.packages)
        ? raw.packages.map(normalizePackage).filter(Boolean)
        : (Array.isArray(raw.shipping) ? raw.shipping.map(normalizePackage).filter(Boolean) : []),
      cart: Array.isArray(raw.cart)
        ? raw.cart.map(normalizeCart).filter(Boolean)
        : (Array.isArray(raw.bag) ? raw.bag.map(normalizeCart).filter(Boolean) : []),
      orders: Array.isArray(raw.orders)
        ? raw.orders.map(normalizeOrder).filter(Boolean)
        : (Array.isArray(raw.history) ? raw.history.map(normalizeOrder).filter(Boolean) : []),
      wishlist: Array.isArray(raw.wishlist)
        ? raw.wishlist.map(normalizeWish).filter(Boolean)
        : (Array.isArray(raw.wishes) ? raw.wishes.map(normalizeWish).filter(Boolean) : []),
      follows: Array.isArray(raw.follows)
        ? raw.follows.map(normalizeFollow).filter(Boolean)
        : (Array.isArray(raw.shops) ? raw.shops.map(normalizeFollow).filter(Boolean) : []),
      browsed: Array.isArray(raw.browsed)
        ? raw.browsed.map(normalizeBrowsed).filter(Boolean)
        : (Array.isArray(raw.historyViews) ? raw.historyViews.map(normalizeBrowsed).filter(Boolean) : []),
      coupons: Array.isArray(raw.coupons)
        ? raw.coupons.map(normalizeCoupon).filter(Boolean)
        : [],
      addresses: Array.isArray(raw.addresses)
        ? raw.addresses.map(normalizeAddress).filter(Boolean)
        : [],
      habits: normalizeHabits(raw.habits || raw.prefs || {}),
      gifts: Array.isArray(raw.gifts)
        ? raw.gifts.map(normalizeGift).filter(Boolean)
        : (Array.isArray(raw.shared) ? raw.shared.map(normalizeGift).filter(Boolean) : []),
      overview: trim(raw.overview || raw.summary),
      footerNote: trim(raw.footerNote || raw.closing)
    };
  }

  function normalizeShopData(raw, contactId) {
    var base = defaultShopData(contactId);
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
      shop: normalizeShopPayload(raw.shop)
    };
  }

  function getCached(contactId) {
    var key = shopKey(contactId);
    return cache[key] ? normalizeShopData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = shopKey(contactId);
    cache[key] = normalizeShopData(data, contactId);
    return cache[key];
  }

  function getShop(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultShopData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(shopKey(id)).then(function (raw) {
      var data = normalizeShopData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultShopData(id);
    });
  }

  function saveShop(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeShopData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(shopKey(id), next).then(function () { return next; });
  }

  function patchShop(contactId, patch) {
    return getShop(contactId).then(function (cur) {
      return saveShop(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepShopStore = {
    defaultShopData: defaultShopData,
    normalizeShopData: normalizeShopData,
    normalizeShopPayload: normalizeShopPayload,
    getShop: getShop,
    saveShop: saveShop,
    patchShop: patchShop,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
