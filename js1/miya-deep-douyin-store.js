/**
 * miya-deep-douyin-store.js — 深入 · 角色手机 抖音 数据
 * 规则：规范化时不截断列表；模型返回多少就保留多少。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  var COVER_TONES = ['rose', 'ink', 'mist', 'sand', 'sky', 'plum', 'tea', 'night', 'cream', 'coral', 'neon', 'slate'];
  var NOTICE_KINDS = ['follow', 'interact', 'group', 'system', 'chat'];

  function douyinKey(contactId) {
    return 'douyin:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_douyin_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_douyin_idb_blocked'));
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

  function defaultDouyinData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      douyin: null
    };
  }

  function hash(s) {
    var h = 0;
    var i;
    for (i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  function pickTone(raw) {
    var t = String(raw || '').trim().toLowerCase();
    return COVER_TONES.indexOf(t) >= 0 ? t : COVER_TONES[Math.abs(hash(t || 'neon')) % COVER_TONES.length];
  }

  function pickNoticeKind(raw) {
    var k = String(raw || '').trim().toLowerCase();
    if (k === '新关注' || k === 'follower') k = 'follow';
    if (k === '互动' || k === 'like' || k === 'comment') k = 'interact';
    if (k === '团购' || k === 'shop') k = 'group';
    if (k === '系统' || k === 'alert') k = 'system';
    if (NOTICE_KINDS.indexOf(k) < 0) k = 'chat';
    return k;
  }

  function mapArr(raw, key, alt, fn) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw[key])) return raw[key].map(fn).filter(Boolean);
    if (alt && Array.isArray(raw[alt])) return raw[alt].map(fn).filter(Boolean);
    return [];
  }

  function normalizeTags(raw) {
    if (Array.isArray(raw)) {
      return raw.map(function (t) { return String(t || '').trim().replace(/^#/, ''); }).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.split(/[,，#\s]+/).map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean);
    }
    return [];
  }

  function normalizeComment(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'cm-' + (index + 1),
          user: '',
          text: raw.trim(),
          time: '',
          likes: '',
          liked: false
        };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.body || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'cm-' + (index + 1)),
      user: String(raw.user || raw.name || raw.author || '').trim(),
      text: text,
      time: String(raw.time || raw.when || '').trim(),
      likes: String(raw.likes != null ? raw.likes : (raw.likeCount != null ? raw.likeCount : '')).trim(),
      liked: !!raw.liked
    };
  }

  function normalizeVideo(raw, index, prefix) {
    prefix = prefix || 'vd';
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: prefix + '-' + (index + 1),
          author: '',
          authorTone: 'mist',
          caption: raw.trim(),
          tags: [],
          likes: '',
          comments: '',
          collects: '',
          shares: '',
          music: '',
          subtitle: '',
          coverTone: 'neon',
          duration: '',
          location: '',
          time: '',
          privateNote: '',
          commentsList: [],
          liked: false,
          collected: false,
          followed: false,
          opened: false
        };
      }
      return null;
    }
    var caption = String(raw.caption || raw.title || raw.desc || raw.body || raw.content || '').trim();
    var privateNote = String(raw.privateNote || raw.note || raw.annotation || raw.memo || '').trim();
    if (!caption && !privateNote) return null;
    var commentsList = mapArr(raw, 'commentsList', 'commentList', normalizeComment);
    if (!commentsList.length && Array.isArray(raw.comments) && raw.comments.length && typeof raw.comments[0] === 'object') {
      commentsList = raw.comments.map(normalizeComment).filter(Boolean);
    }
    return {
      id: String(raw.id || prefix + '-' + (index + 1)),
      author: String(raw.author || raw.user || raw.uname || raw.nickname || '').trim(),
      authorTone: pickTone(raw.authorTone || raw.userTone || raw.author),
      caption: caption,
      tags: normalizeTags(raw.tags || raw.hashtags),
      likes: String(raw.likes != null ? raw.likes : (raw.like != null ? raw.like : '')).trim(),
      comments: String(
        raw.comments != null && (typeof raw.comments === 'string' || typeof raw.comments === 'number')
          ? raw.comments
          : (raw.commentCount != null ? raw.commentCount : (commentsList.length || ''))
      ).trim(),
      collects: String(raw.collects != null ? raw.collects : (raw.favs != null ? raw.favs : '')).trim(),
      shares: String(raw.shares != null ? raw.shares : (raw.share != null ? raw.share : '')).trim(),
      music: String(raw.music || raw.bgm || raw.sound || '').trim(),
      subtitle: String(raw.subtitle || raw.sub || raw.line || '').trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || raw.color || caption),
      duration: String(raw.duration || raw.length || '').trim(),
      location: String(raw.location || raw.place || raw.city || '').trim(),
      time: String(raw.time || raw.date || raw.published || '').trim(),
      privateNote: privateNote,
      commentsList: commentsList,
      liked: !!(raw.liked || raw.like === true),
      collected: !!(raw.collected || raw.faved || raw.favorited),
      followed: !!raw.followed,
      opened: !!raw.opened
    };
  }

  function normalizeStory(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'st-' + (index + 1),
          name: raw.trim(),
          tone: 'mist',
          label: '',
          note: ''
        };
      }
      return null;
    }
    var name = String(raw.name || raw.title || raw.label || '').trim();
    var note = String(raw.note || raw.body || raw.text || '').trim();
    if (!name && !note) return null;
    return {
      id: String(raw.id || 'st-' + (index + 1)),
      name: name || ('日常 ' + (index + 1)),
      tone: pickTone(raw.tone || raw.coverTone || name),
      label: String(raw.label || raw.sub || '').trim(),
      note: note
    };
  }

  function normalizeFriend(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || '').trim();
    var preview = String(raw.preview || raw.text || raw.caption || '').trim();
    if (!name && !preview) return null;
    return {
      id: String(raw.id || 'fr-' + (index + 1)),
      name: name || ('朋友 ' + (index + 1)),
      preview: preview,
      tone: pickTone(raw.tone || raw.coverTone || name),
      note: String(raw.note || raw.privateNote || '').trim(),
      time: String(raw.time || raw.when || '').trim()
    };
  }

  function normalizeNotice(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var preview = String(raw.preview || raw.text || raw.body || '').trim();
    if (!title && !preview) return null;
    return {
      id: String(raw.id || 'nt-' + (index + 1)),
      title: title || ('通知 ' + (index + 1)),
      preview: preview,
      time: String(raw.time || raw.date || '').trim(),
      kind: pickNoticeKind(raw.kind || raw.type),
      official: !!(raw.official || raw.isOfficial),
      dismissed: !!raw.dismissed
    };
  }

  function normalizeChatMsg(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'mg-' + (index + 1), from: 'them', text: raw.trim(), time: '' };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.body || '').trim();
    if (!text) return null;
    var from = String(raw.from || raw.role || 'them').toLowerCase();
    if (from === 'me' || from === 'self' || from === 'owner') from = 'me';
    else from = 'them';
    return {
      id: String(raw.id || 'mg-' + (index + 1)),
      from: from,
      text: text,
      time: String(raw.time || '').trim()
    };
  }

  function normalizeChat(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.user || '').trim();
    var preview = String(raw.preview || raw.last || raw.text || '').trim();
    var messages = mapArr(raw, 'messages', 'msgs', normalizeChatMsg);
    if (!name && !preview && !messages.length) return null;
    return {
      id: String(raw.id || 'ch-' + (index + 1)),
      name: name || ('会话 ' + (index + 1)),
      preview: preview,
      time: String(raw.time || '').trim(),
      unread: !!raw.unread,
      tone: pickTone(raw.tone || name),
      online: String(raw.online || raw.status || '').trim(),
      messages: messages,
      opened: !!raw.opened
    };
  }

  function normalizeShortcut(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'sc-' + (index + 1), name: raw.trim(), hint: '' };
      }
      return null;
    }
    var name = String(raw.name || raw.title || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || 'sc-' + (index + 1)),
      name: name,
      hint: String(raw.hint || raw.note || '').trim()
    };
  }

  function normalizeStats(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    function n(v) {
      return String(v != null ? v : '').trim();
    }
    return {
      likes: n(raw.likes != null ? raw.likes : raw.liked),
      mutuals: n(raw.mutuals != null ? raw.mutuals : raw.friends),
      following: n(raw.following != null ? raw.following : raw.follow),
      followers: n(raw.followers != null ? raw.followers : raw.fans)
    };
  }

  function normalizeTabs(raw, fallback) {
    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (t) { return String(t || '').trim(); }).filter(Boolean);
    }
    return fallback.slice();
  }

  function normalizeMessages(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      alertBanner: String(raw.alertBanner || raw.banner || '').trim(),
      notices: mapArr(raw, 'notices', 'items', normalizeNotice),
      chats: mapArr(raw, 'chats', 'conversations', normalizeChat)
    };
  }

  function normalizeProfile(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      gender: String(raw.gender || '').trim(),
      ageTag: String(raw.ageTag || raw.age || '').trim(),
      banner: String(raw.banner || '').trim(),
      introHint: String(raw.introHint || raw.intro || '').trim(),
      works: mapArr(raw, 'works', 'videos', function (v, i) { return normalizeVideo(v, i, 'wk'); }),
      daily: mapArr(raw, 'daily', 'moments', function (v, i) { return normalizeVideo(v, i, 'dy'); }),
      favorites: mapArr(raw, 'favorites', 'collects', function (v, i) { return normalizeVideo(v, i, 'fv'); }),
      liked: mapArr(raw, 'liked', 'likes', function (v, i) { return normalizeVideo(v, i, 'lk'); }),
      shortcuts: mapArr(raw, 'shortcuts', 'tools', normalizeShortcut)
    };
  }

  function normalizeDouyinPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var messages = normalizeMessages(raw.messages || raw.msg || {});
    var profile = normalizeProfile(raw.profile || raw.me || {});
    var homeTabs = normalizeTabs(raw.homeTabs || raw.tabs, ['关注', '推荐', '同城']);
    var active = String(raw.activeHomeTab || raw.activeTab || '推荐').trim() || '推荐';
    if (homeTabs.indexOf(active) < 0) active = homeTabs[0] || '推荐';

    return {
      nickname: String(raw.nickname || raw.uname || raw.name || '').trim(),
      douyinId: String(raw.douyinId || raw.dyId || raw.uid || raw.idLabel || '').trim(),
      bio: String(raw.bio || raw.sign || raw.intro || '').trim(),
      avatarTone: pickTone(raw.avatarTone || raw.tone || raw.nickname),
      ipLocation: String(raw.ipLocation || raw.location || '').trim(),
      stats: normalizeStats(raw.stats || raw.counts || {}),
      homeTabs: homeTabs,
      activeHomeTab: active,
      searchHint: String(raw.searchHint || raw.search || '').trim(),
      stories: mapArr(raw, 'stories', 'status', normalizeStory),
      feed: mapArr(raw, 'feed', 'videos', function (v, i) { return normalizeVideo(v, i, 'fd'); }),
      followingFeed: mapArr(raw, 'followingFeed', 'followFeed', function (v, i) { return normalizeVideo(v, i, 'ff'); }),
      friends: mapArr(raw, 'friends', 'friendFeed', normalizeFriend),
      messages: messages,
      profile: profile,
      nightThought: String(raw.nightThought || raw.aside || raw.whisper || '').trim(),
      footerNote: String(raw.footerNote || raw.closing || '').trim()
    };
  }

  function normalizeDouyinData(raw, contactId) {
    var base = defaultDouyinData(contactId);
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
      douyin: normalizeDouyinPayload(raw.douyin)
    };
  }

  function getCached(contactId) {
    var key = douyinKey(contactId);
    return cache[key] ? normalizeDouyinData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = douyinKey(contactId);
    cache[key] = normalizeDouyinData(data, contactId);
    return cache[key];
  }

  function getDouyin(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultDouyinData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(douyinKey(id)).then(function (raw) {
      var data = normalizeDouyinData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultDouyinData(id);
    });
  }

  function saveDouyin(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeDouyinData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(douyinKey(id), next).then(function () { return next; });
  }

  function patchDouyin(contactId, patch) {
    return getDouyin(contactId).then(function (cur) {
      return saveDouyin(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepDouyinStore = {
    defaultDouyinData: defaultDouyinData,
    normalizeDouyinData: normalizeDouyinData,
    normalizeDouyinPayload: normalizeDouyinPayload,
    getDouyin: getDouyin,
    saveDouyin: saveDouyin,
    patchDouyin: patchDouyin,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
