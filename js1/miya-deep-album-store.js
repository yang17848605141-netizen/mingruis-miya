/**
 * miya-deep-album-store.js — 深入 · 角色手机 相册数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  var CATEGORIES = {
    library: 1,
    favorite: 1,
    private: 1,
    deleted: 1,
    memory: 1,
    recent: 1
  };

  function albumKey(contactId) {
    return 'album:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_album_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_album_idb_blocked'));
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

  function defaultAlbumData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      album: null
    };
  }

  function normalizeCategory(raw) {
    var c = String(raw || 'library').trim().toLowerCase();
    if (c === 'favourites' || c === 'favorites' || c === 'fav' || c === '收藏' || c === '个人收藏') return 'favorite';
    if (c === '密' || c === '私密' || c === 'hidden' || c === 'secret') return 'private';
    if (c === 'trash' || c === 'recycle' || c === '最近删除' || c === '删除') return 'deleted';
    if (c === '回忆' || c === 'memories') return 'memory';
    if (c === '最近' || c === '最近保存' || c === 'saved') return 'recent';
    if (CATEGORIES[c]) return c;
    return 'library';
  }

  function normalizePhoto(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'ph-' + (index + 1),
          title: '照片 ' + (index + 1),
          description: raw.trim(),
          date: '',
          time: '',
          period: '',
          location: '',
          category: 'library',
          viewCount: 0,
          mood: '',
          opened: false
        };
      }
      return null;
    }
    var description = String(
      raw.description || raw.desc || raw.content || raw.detail || raw.caption || raw.text || ''
    ).trim();
    var title = String(raw.title || raw.name || raw.label || '').trim();
    var mood = String(raw.mood || raw.feeling || raw.mindset || raw.emotion || '').trim();
    if (!description && !title && !mood) return null;
    var viewCount = Number(raw.viewCount != null ? raw.viewCount : (raw.views != null ? raw.views : raw.lookCount));
    if (!isFinite(viewCount) || viewCount < 0) viewCount = 0;
    viewCount = Math.min(99999, Math.floor(viewCount));
    return {
      id: String(raw.id || 'ph-' + (index + 1)),
      title: title || ('照片 ' + (index + 1)),
      description: description,
      date: String(raw.date || raw.day || raw.takenAt || '').trim(),
      time: String(raw.time || raw.clock || '').trim(),
      period: String(raw.period || raw.timeline || raw.era || raw.phase || '').trim(),
      location: String(raw.location || raw.place || raw.city || '').trim(),
      category: normalizeCategory(raw.category || raw.album || raw.bucket || raw.tag),
      viewCount: viewCount,
      mood: mood,
      opened: !!raw.opened
    };
  }

  function normalizeMemory(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.label || '').trim();
    var subtitle = String(raw.subtitle || raw.date || raw.period || '').trim();
    var coverPhotoId = String(raw.coverPhotoId || raw.photoId || raw.id || '').trim();
    if (!title && !coverPhotoId) return null;
    return {
      id: String(raw.id || 'mem-' + (index + 1)),
      title: title || ('回忆 ' + (index + 1)),
      subtitle: subtitle,
      location: String(raw.location || raw.place || '').trim(),
      coverPhotoId: coverPhotoId,
      photoIds: Array.isArray(raw.photoIds)
        ? raw.photoIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
        : []
    };
  }

  function normalizeAlbumMeta(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.label || '').trim();
    if (!name) return null;
    var type = normalizeCategory(raw.type || raw.category || raw.kind || name);
    if (type === 'library') {
      var lower = name.toLowerCase();
      if (lower.indexOf('收藏') >= 0 || lower.indexOf('fav') >= 0) type = 'favorite';
      else if (lower.indexOf('私密') >= 0 || lower.indexOf('private') >= 0) type = 'private';
      else if (lower.indexOf('删除') >= 0 || lower.indexOf('delete') >= 0) type = 'deleted';
      else if (lower.indexOf('最近') >= 0) type = 'recent';
      else if (lower.indexOf('回忆') >= 0) type = 'memory';
    }
    return {
      id: String(raw.id || 'alb-' + (index + 1)),
      name: name,
      type: type,
      count: Math.max(0, Number(raw.count) || 0),
      coverPhotoId: String(raw.coverPhotoId || raw.photoId || '').trim()
    };
  }

  function deriveAlbumsFromPhotos(photos) {
    var groups = {
      favorite: { id: 'alb-favorite', name: '个人收藏', type: 'favorite', count: 0, coverPhotoId: '' },
      private: { id: 'alb-private', name: '私密', type: 'private', count: 0, coverPhotoId: '' },
      deleted: { id: 'alb-deleted', name: '最近删除', type: 'deleted', count: 0, coverPhotoId: '' },
      recent: { id: 'alb-recent', name: '最近保存', type: 'recent', count: 0, coverPhotoId: '' },
      memory: { id: 'alb-memory', name: '回忆', type: 'memory', count: 0, coverPhotoId: '' }
    };
    (photos || []).forEach(function (p) {
      if (!p || !groups[p.category]) return;
      var g = groups[p.category];
      g.count += 1;
      if (!g.coverPhotoId) g.coverPhotoId = p.id;
    });
    return ['favorite', 'recent', 'private', 'deleted', 'memory']
      .map(function (k) { return groups[k]; })
      .filter(function (g) { return g.count > 0; });
  }

  function deriveMemoriesFromPhotos(photos) {
    var byPeriod = Object.create(null);
    (photos || []).forEach(function (p) {
      if (!p) return;
      var key = p.period || p.date || '未标注';
      if (!byPeriod[key]) byPeriod[key] = [];
      byPeriod[key].push(p);
    });
    return Object.keys(byPeriod).slice(0, 6).map(function (key, i) {
      var list = byPeriod[key];
      var first = list[0];
      return {
        id: 'mem-auto-' + (i + 1),
        title: key,
        subtitle: first && first.date ? first.date : '',
        location: first && first.location ? first.location : '',
        coverPhotoId: first ? first.id : '',
        photoIds: list.map(function (p) { return p.id; })
      };
    });
  }

  function mapArr(raw, key, alt, fn) {
    if (Array.isArray(raw[key])) return raw[key].map(fn).filter(Boolean);
    if (alt && Array.isArray(raw[alt])) return raw[alt].map(fn).filter(Boolean);
    return [];
  }

  function normalizeAlbumPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var photos = mapArr(raw, 'photos', 'images', normalizePhoto);
    if (!photos.length && Array.isArray(raw.items)) {
      photos = raw.items.map(normalizePhoto).filter(Boolean);
    }
    var albums = mapArr(raw, 'albums', 'collections', normalizeAlbumMeta);
    var memories = mapArr(raw, 'memories', 'reels', normalizeMemory);
    if (!albums.length) albums = deriveAlbumsFromPhotos(photos);
    if (!memories.length) memories = deriveMemoriesFromPhotos(photos);
    return {
      dateLabel: String(raw.dateLabel || raw.dateRange || raw.range || '').trim(),
      storageHint: String(raw.storageHint || raw.storageNote || raw.hint || '').trim(),
      photos: photos,
      albums: albums,
      memories: memories
    };
  }

  function normalizeAlbumData(raw, contactId) {
    var base = defaultAlbumData(contactId);
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
      album: normalizeAlbumPayload(raw.album)
    };
  }

  function getCached(contactId) {
    var key = albumKey(contactId);
    return cache[key] ? normalizeAlbumData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = albumKey(contactId);
    cache[key] = normalizeAlbumData(data, contactId);
    return cache[key];
  }

  function getAlbum(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultAlbumData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(albumKey(id)).then(function (raw) {
      var data = normalizeAlbumData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultAlbumData(id);
    });
  }

  function saveAlbum(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeAlbumData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(albumKey(id), next).then(function () { return next; });
  }

  function patchAlbum(contactId, patch) {
    return getAlbum(contactId).then(function (cur) {
      return saveAlbum(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepAlbumStore = {
    defaultAlbumData: defaultAlbumData,
    normalizeAlbumData: normalizeAlbumData,
    normalizeAlbumPayload: normalizeAlbumPayload,
    normalizePhoto: normalizePhoto,
    getAlbum: getAlbum,
    saveAlbum: saveAlbum,
    patchAlbum: patchAlbum,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
