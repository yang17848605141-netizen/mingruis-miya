/**
 * miya-deep-bili-store.js — 深入 · 角色手机 bilibili 数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  var COVER_TONES = ['rose', 'ink', 'mist', 'sand', 'sky', 'plum', 'tea', 'night'];
  var FEED_KINDS = ['video', 'article', 'live', 'bangumi'];
  var DYN_TYPES = ['text', 'video', 'forward', 'checkin'];

  function biliKey(contactId) {
    return 'bili:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_bili_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_bili_idb_blocked'));
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

  function defaultBiliData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      bili: null
    };
  }

  function pickTone(raw) {
    var t = String(raw || '').trim().toLowerCase();
    return COVER_TONES.indexOf(t) >= 0 ? t : COVER_TONES[Math.abs(hash(t || 'rose')) % COVER_TONES.length];
  }

  function pickKind(raw) {
    var k = String(raw || '').trim().toLowerCase();
    if (k === '图文' || k === 'post' || k === 'note') k = 'article';
    if (k === '番剧' || k === 'anime') k = 'bangumi';
    if (FEED_KINDS.indexOf(k) < 0) k = 'video';
    return k;
  }

  function pickDynType(raw) {
    var t = String(raw || '').trim().toLowerCase();
    if (t === 'repost' || t === 'share') t = 'forward';
    if (t === '签到' || t === 'check') t = 'checkin';
    if (DYN_TYPES.indexOf(t) < 0) t = 'text';
    return t;
  }

  function hash(s) {
    var h = 0;
    var i;
    for (i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  function mapArr(raw, key, alt, fn) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw[key])) return raw[key].map(fn).filter(Boolean);
    if (alt && Array.isArray(raw[alt])) return raw[alt].map(fn).filter(Boolean);
    return [];
  }

  function normalizeFeedItem(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'fd-' + (index + 1),
          title: raw.trim().slice(0, 40),
          upName: '',
          views: '',
          comments: '',
          duration: '',
          kind: 'video',
          coverTone: 'rose',
          tag: '',
          preview: '',
          body: raw.trim(),
          note: raw.trim(),
          coins: '',
          date: '',
          upFans: '',
          upVideos: '',
          bgm: '',
          series: '',
          opened: false,
          liked: false,
          coined: false,
          faved: false,
          followed: false
        };
      }
      return null;
    }
    var title = String(raw.title || raw.name || '').trim();
    var body = String(raw.body || raw.content || raw.desc || raw.detail || '').trim();
    var preview = String(raw.preview || raw.summary || raw.excerpt || '').trim();
    if (!title && !body && !preview) return null;
    return {
      id: String(raw.id || 'fd-' + (index + 1)),
      title: title || ('视频 ' + (index + 1)),
      upName: String(raw.upName || raw.up || raw.author || raw.creator || '').trim(),
      views: String(raw.views || raw.play || raw.plays || '').trim(),
      comments: String(raw.comments || raw.danmaku || raw.replies || '').trim(),
      duration: String(raw.duration || raw.length || raw.time || '').trim(),
      kind: pickKind(raw.kind || raw.type),
      coverTone: pickTone(raw.coverTone || raw.tone || raw.color || title),
      tag: String(raw.tag || raw.badge || raw.category || '').trim(),
      preview: preview,
      body: body,
      note: String(raw.note || raw.annotation || raw.remark || raw.memo || '').trim() || body,
      coins: String(raw.coins || raw.coin || '').trim(),
      date: String(raw.date || raw.published || raw.uploadDate || '').trim(),
      upFans: String(raw.upFans || raw.fans || raw.followers || '').trim(),
      upVideos: String(raw.upVideos || raw.videoCount || '').trim(),
      bgm: String(raw.bgm || raw.music || '').trim(),
      series: String(raw.series || raw.collection || '').trim(),
      opened: !!raw.opened,
      liked: !!(raw.liked || raw.like || raw.fav),
      coined: !!raw.coined,
      faved: !!raw.faved,
      followed: !!raw.followed
    };
  }

  function normalizeDyn(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'dy-' + (index + 1),
          type: 'text',
          text: raw.trim(),
          time: '',
          likes: '',
          replies: '',
          detail: '',
          opened: false
        };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.body || raw.desc || '').trim();
    var detail = String(raw.detail || raw.expand || raw.full || '').trim();
    if (!text && !detail) return null;
    return {
      id: String(raw.id || 'dy-' + (index + 1)),
      type: pickDynType(raw.type || raw.kind),
      text: text || detail.slice(0, 80),
      time: String(raw.time || raw.when || raw.updated || '').trim(),
      likes: String(raw.likes || raw.like || '').trim(),
      replies: String(raw.replies || raw.comments || '').trim(),
      detail: detail || text,
      opened: !!raw.opened
    };
  }

  function normalizeWatching(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var note = String(raw.note || raw.memo || raw.thought || '').trim();
    if (!title && !note) return null;
    return {
      id: String(raw.id || 'wt-' + (index + 1)),
      title: title || ('在追 ' + (index + 1)),
      progress: String(raw.progress || raw.ep || raw.episode || '').trim(),
      episode: String(raw.episode || raw.epLabel || '').trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || title),
      note: note,
      opened: !!raw.opened
    };
  }

  function normalizeFavorite(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var body = String(raw.body || raw.content || raw.note || raw.memo || '').trim();
    if (!title && !body) return null;
    return {
      id: String(raw.id || 'fv-' + (index + 1)),
      title: title || ('收藏 ' + (index + 1)),
      folder: String(raw.folder || raw.group || raw.list || '').trim(),
      note: String(raw.note || raw.preview || '').trim(),
      body: body,
      opened: !!raw.opened
    };
  }

  function normalizeHistory(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'hs-' + (index + 1)),
      title: title,
      watchedAt: String(raw.watchedAt || raw.time || raw.when || '').trim(),
      progress: String(raw.progress || raw.percent || '').trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || title)
    };
  }

  function normalizeFollowing(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.upName || '').trim();
    var reason = String(raw.reason || raw.note || raw.why || '').trim();
    if (!name && !reason) return null;
    return {
      id: String(raw.id || 'fl-' + (index + 1)),
      name: name || ('UP ' + (index + 1)),
      reason: reason,
      lastUpdate: String(raw.lastUpdate || raw.updated || raw.time || '').trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || name)
    };
  }

  function normalizeService(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'sv-' + (index + 1), name: raw.trim(), hint: '', opened: false, body: '' };
      }
      return null;
    }
    var name = String(raw.name || raw.title || raw.label || '').trim();
    var body = String(raw.body || raw.content || raw.detail || '').trim();
    var hint = String(raw.hint || raw.note || raw.desc || '').trim();
    if (!name && !body && !hint) return null;
    return {
      id: String(raw.id || 'sv-' + (index + 1)),
      name: name || ('服务 ' + (index + 1)),
      hint: hint,
      body: body,
      opened: !!raw.opened
    };
  }

  function normalizeStats(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    function n(v) {
      var s = String(v != null ? v : '').trim();
      return s;
    }
    return {
      dynamics: n(raw.dynamics != null ? raw.dynamics : raw.posts),
      following: n(raw.following != null ? raw.following : raw.follow),
      followers: n(raw.followers != null ? raw.followers : raw.fans)
    };
  }

  function normalizeHero(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    return {
      title: title,
      coverTone: pickTone(raw.coverTone || raw.tone),
      views: String(raw.views || raw.play || '').trim(),
      duration: String(raw.duration || '').trim(),
      upName: String(raw.upName || raw.up || raw.author || '').trim(),
      desc: String(raw.desc || raw.body || raw.preview || '').trim(),
      opened: !!raw.opened,
      liked: !!raw.liked,
      coined: !!raw.coined,
      faved: !!raw.faved,
      followed: !!raw.followed
    };
  }

  function normalizePromo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.text || raw.desc || '').trim();
    if (!title) return null;
    return {
      title: title,
      cta: String(raw.cta || raw.button || '去看看').trim() || '去看看',
      body: String(raw.body || raw.detail || '').trim(),
      opened: !!raw.opened
    };
  }

  function normalizeCreation(raw) {
    if (!raw || typeof raw !== 'object') {
      return { drafts: '', incentive: '', note: '', items: [] };
    }
    var items = mapArr(raw, 'items', 'entries', function (it, i) {
      if (!it || typeof it !== 'object') return null;
      var name = String(it.name || it.title || '').trim();
      var body = String(it.body || it.content || it.note || '').trim();
      if (!name && !body) return null;
      return {
        id: String(it.id || 'cr-' + (i + 1)),
        name: name || ('创作 ' + (i + 1)),
        badge: String(it.badge || it.tag || '').trim(),
        body: body,
        opened: !!it.opened
      };
    });
    return {
      drafts: String(raw.drafts || raw.draftCount || '').trim(),
      incentive: String(raw.incentive || raw.reward || '').trim(),
      note: String(raw.note || raw.desc || '').trim(),
      items: items
    };
  }

  function normalizeMemberBanner(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var text = String(raw.text || raw.title || raw.desc || '').trim();
    if (!text) return null;
    return {
      text: text,
      cta: String(raw.cta || raw.button || '大会员中心').trim() || '大会员中心',
      body: String(raw.body || raw.detail || '').trim(),
      opened: !!raw.opened
    };
  }

  function normalizeTabs(raw) {
    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (t) { return String(t || '').trim(); }).filter(Boolean).slice(0, 8);
    }
    return ['直播', '推荐', '热门', '动画', '影视'];
  }

  function normalizeBiliPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var level = Number(raw.level != null ? raw.level : raw.lv);
    if (!isFinite(level) || level < 0) level = 0;
    level = Math.min(6, Math.round(level));

    return {
      uname: String(raw.uname || raw.nickname || raw.name || raw.userName || '').trim(),
      sign: String(raw.sign || raw.bio || raw.motto || raw.slogan || '').trim(),
      level: level,
      vipLabel: String(raw.vipLabel || raw.member || raw.vip || '').trim(),
      coins: String(raw.coins != null ? raw.coins : (raw.coin != null ? raw.coin : '')).trim(),
      bCoins: String(raw.bCoins != null ? raw.bCoins : (raw.bcoin != null ? raw.bcoin : '')).trim(),
      stats: normalizeStats(raw.stats || raw.counts || {}),
      searchHint: String(raw.searchHint || raw.search || raw.placeholder || '').trim(),
      tabs: normalizeTabs(raw.tabs || raw.categories),
      activeTab: String(raw.activeTab || '推荐').trim() || '推荐',
      hero: normalizeHero(raw.hero || raw.banner || raw.featured),
      promo: normalizePromo(raw.promo || raw.ad || raw.strip),
      feed: mapArr(raw, 'feed', 'videos', normalizeFeedItem),
      dynamics: mapArr(raw, 'dynamics', 'posts', normalizeDyn),
      watching: mapArr(raw, 'watching', 'bangumi', normalizeWatching),
      favorites: mapArr(raw, 'favorites', 'favs', normalizeFavorite),
      history: mapArr(raw, 'history', 'recent', normalizeHistory),
      following: mapArr(raw, 'following', 'follows', normalizeFollowing),
      services: mapArr(raw, 'services', 'apps', normalizeService),
      creation: normalizeCreation(raw.creation || raw.creator || {}),
      memberBanner: normalizeMemberBanner(raw.memberBanner || raw.vipBanner || raw.bannerVip),
      nightThought: String(raw.nightThought || raw.aside || raw.whisper || '').trim(),
      footerNote: String(raw.footerNote || raw.closing || raw.sealNote || '').trim()
    };
  }

  function normalizeBiliData(raw, contactId) {
    var base = defaultBiliData(contactId);
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
      bili: normalizeBiliPayload(raw.bili)
    };
  }

  function getCached(contactId) {
    var key = biliKey(contactId);
    return cache[key] ? normalizeBiliData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = biliKey(contactId);
    cache[key] = normalizeBiliData(data, contactId);
    return cache[key];
  }

  function getBili(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultBiliData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(biliKey(id)).then(function (raw) {
      var data = normalizeBiliData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultBiliData(id);
    });
  }

  function saveBili(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeBiliData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(biliKey(id), next).then(function () { return next; });
  }

  function patchBili(contactId, patch) {
    return getBili(contactId).then(function (cur) {
      return saveBili(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepBiliStore = {
    defaultBiliData: defaultBiliData,
    normalizeBiliData: normalizeBiliData,
    normalizeBiliPayload: normalizeBiliPayload,
    getBili: getBili,
    saveBili: saveBili,
    patchBili: patchBili,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
