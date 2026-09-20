/**
 * miya-deep-xhs-store.js — 深入 · 角色手机 小红书 数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  var COVER_TONES = ['rose', 'ink', 'mist', 'sand', 'sky', 'plum', 'tea', 'night', 'cream', 'coral'];
  var COVER_KINDS = ['photo', 'text', 'collage', 'mood'];
  var NOTE_KINDS = ['life', 'food', 'outfit', 'travel', 'tips', 'mood', 'shop'];

  function xhsKey(contactId) {
    return 'xhs:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_xhs_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_xhs_idb_blocked'));
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

  function defaultXhsData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      xhs: null
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
    return COVER_TONES.indexOf(t) >= 0 ? t : COVER_TONES[Math.abs(hash(t || 'rose')) % COVER_TONES.length];
  }

  function pickCoverKind(raw) {
    var k = String(raw || '').trim().toLowerCase();
    if (k === '图文' || k === 'plain') k = 'text';
    if (k === '拼图' || k === 'grid') k = 'collage';
    if (k === '氛围' || k === 'feel') k = 'mood';
    if (COVER_KINDS.indexOf(k) < 0) k = 'photo';
    return k;
  }

  function pickNoteKind(raw) {
    var k = String(raw || '').trim().toLowerCase();
    if (k === '穿搭' || k === 'fashion') k = 'outfit';
    if (k === '美食' || k === 'eat') k = 'food';
    if (k === '旅行' || k === 'trip') k = 'travel';
    if (k === '种草' || k === '好物') k = 'shop';
    if (k === '日常') k = 'life';
    if (k === '情绪' || k === 'feel') k = 'mood';
    if (NOTE_KINDS.indexOf(k) < 0) k = 'life';
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
      return raw.map(function (t) { return String(t || '').trim(); }).filter(Boolean).slice(0, 8);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.split(/[,，#\s]+/).map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean).slice(0, 8);
    }
    return [];
  }

  function normalizeComment(raw, index, depth) {
    depth = depth || 0;
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'cm-' + (index + 1),
          user: '',
          text: raw.trim(),
          time: '',
          location: '',
          likes: '',
          liked: false,
          isAuthor: false,
          pinned: false,
          first: false,
          authorLiked: false,
          replies: []
        };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.body || '').trim();
    if (!text) return null;
    var replies = [];
    if (depth < 1 && Array.isArray(raw.replies)) {
      replies = raw.replies.map(function (r, i) {
        return normalizeComment(r, i, depth + 1);
      }).filter(Boolean);
    }
    return {
      id: String(raw.id || 'cm-' + (index + 1)),
      user: String(raw.user || raw.name || raw.author || '').trim(),
      text: text,
      time: String(raw.time || raw.when || '').trim(),
      location: String(raw.location || raw.place || raw.city || '').trim(),
      likes: String(raw.likes != null ? raw.likes : (raw.likeCount != null ? raw.likeCount : '')).trim(),
      liked: !!raw.liked,
      isAuthor: !!(raw.isAuthor || raw.isOwner || raw.owner === true),
      pinned: !!(raw.pinned || raw.top),
      first: !!(raw.first || raw.firstComment),
      authorLiked: !!(raw.authorLiked || raw.likedByAuthor),
      replies: replies
    };
  }

  function normalizeNote(raw, index, prefix) {
    prefix = prefix || 'nt';
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: prefix + '-' + (index + 1),
          title: raw.trim().slice(0, 36),
          author: '',
          authorTone: 'mist',
          likes: '',
          collects: '',
          comments: [],
          commentCount: '',
          coverTone: 'rose',
          coverKind: 'text',
          coverText: raw.trim().slice(0, 24),
          kind: 'life',
          tags: [],
          preview: '',
          body: raw.trim(),
          location: '',
          time: '',
          pinned: false,
          liked: false,
          collected: false,
          opened: false,
          privateNote: ''
        };
      }
      return null;
    }
    var title = String(raw.title || raw.name || '').trim();
    var body = String(raw.body || raw.content || raw.desc || raw.detail || '').trim();
    var preview = String(raw.preview || raw.summary || raw.excerpt || '').trim();
    if (!title && !body && !preview) return null;
    var comments = mapArr(raw, 'comments', 'replies', normalizeComment);
    return {
      id: String(raw.id || prefix + '-' + (index + 1)),
      title: title || ('笔记 ' + (index + 1)),
      author: String(raw.author || raw.user || raw.uname || raw.nickname || '').trim(),
      authorTone: pickTone(raw.authorTone || raw.userTone || raw.author),
      likes: String(raw.likes != null ? raw.likes : (raw.like != null ? raw.like : '')).trim(),
      collects: String(raw.collects != null ? raw.collects : (raw.favs != null ? raw.favs : '')).trim(),
      comments: comments,
      commentCount: String(raw.commentCount != null ? raw.commentCount : (comments.length || '')).trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || raw.color || title),
      coverKind: pickCoverKind(raw.coverKind || raw.coverType || raw.media),
      coverText: String(raw.coverText || raw.coverLabel || '').trim() || (title || '').slice(0, 20),
      kind: pickNoteKind(raw.kind || raw.type || raw.category),
      tags: normalizeTags(raw.tags || raw.hashtags),
      preview: preview,
      body: body,
      location: String(raw.location || raw.place || raw.city || '').trim(),
      time: String(raw.time || raw.date || raw.published || '').trim(),
      pinned: !!(raw.pinned || raw.top),
      liked: !!(raw.liked || raw.like),
      collected: !!(raw.collected || raw.faved || raw.fav),
      opened: !!raw.opened,
      privateNote: String(raw.privateNote || raw.note || raw.memo || raw.thought || '').trim()
    };
  }

  function normalizeMarketItem(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var note = String(raw.note || raw.body || raw.desc || '').trim();
    if (!title && !note) return null;
    return {
      id: String(raw.id || 'mk-' + (index + 1)),
      title: title || ('好物 ' + (index + 1)),
      price: String(raw.price || raw.cost || '').trim(),
      shop: String(raw.shop || raw.seller || raw.store || '').trim(),
      coverTone: pickTone(raw.coverTone || raw.tone || title),
      note: note,
      reason: String(raw.reason || raw.why || '').trim(),
      opened: !!raw.opened
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
    var from = String(raw.from || raw.role || raw.who || 'them').trim().toLowerCase();
    if (from === 'me' || from === 'self' || from === '我' || from === 'owner') from = 'me';
    else from = 'them';
    return {
      id: String(raw.id || 'mg-' + (index + 1)),
      from: from,
      text: text,
      time: String(raw.time || '').trim()
    };
  }

  function normalizeChat(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'ch-' + (index + 1),
          name: raw.trim().slice(0, 16),
          preview: raw.trim(),
          time: '',
          unread: false,
          tone: 'mist',
          online: '',
          messages: []
        };
      }
      return null;
    }
    var name = String(raw.name || raw.title || raw.user || '').trim();
    var preview = String(raw.preview || raw.last || raw.text || '').trim();
    var messages = mapArr(raw, 'messages', 'thread', normalizeChatMsg);
    if (!name && !preview && !messages.length) return null;
    return {
      id: String(raw.id || 'ch-' + (index + 1)),
      name: name || ('会话 ' + (index + 1)),
      preview: preview || (messages.length ? messages[messages.length - 1].text : ''),
      time: String(raw.time || raw.updated || '').trim(),
      unread: !!(raw.unread || raw.dot),
      tone: pickTone(raw.tone || raw.coverTone || name),
      online: String(raw.online || raw.status || '').trim(),
      messages: messages,
      opened: !!raw.opened
    };
  }

  function normalizeNotifyBucket(raw) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { count: '', preview: raw.trim(), items: [] };
      }
      return { count: '', preview: '', items: [] };
    }
    var items = mapArr(raw, 'items', 'list', function (it, i) {
      if (!it || typeof it !== 'object') {
        if (typeof it === 'string' && it.trim()) {
          return { id: 'nv-' + (i + 1), user: '', text: it.trim(), time: '', noteTitle: '' };
        }
        return null;
      }
      var text = String(it.text || it.content || it.body || '').trim();
      if (!text && !it.user) return null;
      return {
        id: String(it.id || 'nv-' + (i + 1)),
        user: String(it.user || it.name || '').trim(),
        text: text,
        time: String(it.time || '').trim(),
        noteTitle: String(it.noteTitle || it.title || '').trim()
      };
    });
    return {
      count: String(raw.count != null ? raw.count : (items.length || '')).trim(),
      preview: String(raw.preview || raw.hint || raw.desc || '').trim(),
      items: items
    };
  }

  function normalizeStats(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      following: String(raw.following != null ? raw.following : (raw.follow != null ? raw.follow : '')).trim(),
      followers: String(raw.followers != null ? raw.followers : (raw.fans != null ? raw.fans : '')).trim(),
      likes: String(raw.likes != null ? raw.likes : (raw.liked != null ? raw.liked : (raw.favs != null ? raw.favs : ''))).trim()
    };
  }

  function normalizeHomeTabs(raw) {
    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (t) { return String(t || '').trim(); }).filter(Boolean).slice(0, 5);
    }
    return ['关注', '发现', '附近'];
  }

  function normalizeMessages(raw) {
    if (Array.isArray(raw)) {
      return {
        categories: {
          likes: { count: '', preview: '', items: [] },
          follows: { count: '', preview: '', items: [] },
          comments: { count: '', preview: '', items: [] }
        },
        chats: raw.map(normalizeChat).filter(Boolean)
      };
    }
    raw = raw && typeof raw === 'object' ? raw : {};
    var cats = raw.categories || raw.inbox || {};
    var chats = mapArr(raw, 'chats', 'conversations', normalizeChat);
    if (!chats.length && Array.isArray(raw.list)) {
      chats = raw.list.map(normalizeChat).filter(Boolean);
    }
    return {
      categories: {
        likes: normalizeNotifyBucket(cats.likes || cats.like || raw.likes),
        follows: normalizeNotifyBucket(cats.follows || cats.follow || raw.follows),
        comments: normalizeNotifyBucket(cats.comments || cats.mentions || raw.comments)
      },
      chats: chats
    };
  }

  function normalizeProfile(raw) {
    if (Array.isArray(raw)) {
      return {
        drafts: '',
        banner: '',
        meNotes: raw.map(function (n, i) { return normalizeNote(n, i, 'me'); }).filter(Boolean),
        collections: [],
        liked: [],
        myComments: []
      };
    }
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      drafts: String(raw.drafts != null ? raw.drafts : (raw.draftCount != null ? raw.draftCount : '')).trim(),
      banner: String(raw.banner || raw.promo || '').trim(),
      meNotes: mapArr(raw, 'meNotes', 'notes', function (n, i) { return normalizeNote(n, i, 'me'); }),
      collections: mapArr(raw, 'collections', 'favs', function (n, i) { return normalizeNote(n, i, 'cl'); }),
      liked: mapArr(raw, 'liked', 'praised', function (n, i) { return normalizeNote(n, i, 'lk'); }),
      myComments: mapArr(raw, 'myComments', 'comments', function (it, i) {
        if (!it || typeof it !== 'object') {
          if (typeof it === 'string' && it.trim()) {
            return { id: 'mc-' + (i + 1), noteTitle: '', text: it.trim(), time: '' };
          }
          return null;
        }
        var text = String(it.text || it.content || '').trim();
        if (!text) return null;
        return {
          id: String(it.id || 'mc-' + (i + 1)),
          noteTitle: String(it.noteTitle || it.title || '').trim(),
          text: text,
          time: String(it.time || '').trim()
        };
      })
    };
  }

  function pickMessagesRaw(raw) {
    if (!raw || typeof raw !== 'object') return {};
    if (raw.messages != null) return raw.messages;
    if (raw.msg != null) return raw.msg;
    if (raw.inbox != null && typeof raw.inbox === 'object' && !Array.isArray(raw.inbox)) {
      return raw.inbox;
    }
    // 模型常把 chats 放在顶层
    if (Array.isArray(raw.chats) || Array.isArray(raw.conversations)) {
      return {
        categories: raw.categories || {},
        chats: raw.chats || raw.conversations
      };
    }
    return {};
  }

  function pickProfileRaw(raw) {
    if (!raw || typeof raw !== 'object') return {};
    if (raw.profile != null && typeof raw.profile === 'object') return raw.profile;
    if (raw.me != null && typeof raw.me === 'object') return raw.me;
    if (raw.mine != null && typeof raw.mine === 'object') return raw.mine;
    // 模型常把 meNotes / collections 放在顶层
    if (
      Array.isArray(raw.meNotes) ||
      Array.isArray(raw.collections) ||
      Array.isArray(raw.liked) ||
      Array.isArray(raw.myComments)
    ) {
      return {
        drafts: raw.drafts,
        banner: raw.banner,
        meNotes: raw.meNotes,
        collections: raw.collections,
        liked: raw.liked,
        myComments: raw.myComments
      };
    }
    return {};
  }

  function normalizeXhsPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // feed 不要误吃 profile.notes：顶层 notes 仅在没有 feed 时作为 feed
    var feed = mapArr(raw, 'feed', null, function (n, i) { return normalizeNote(n, i, 'fd'); });
    if (!feed.length && Array.isArray(raw.notes) && !raw.profile && !raw.me) {
      feed = raw.notes.map(function (n, i) { return normalizeNote(n, i, 'fd'); }).filter(Boolean);
    }
    var followingFeed = mapArr(raw, 'followingFeed', 'followNotes', function (n, i) { return normalizeNote(n, i, 'ff'); });
    var messages = normalizeMessages(pickMessagesRaw(raw));
    var profile = normalizeProfile(pickProfileRaw(raw));

    // 再合并顶层碎片，避免嵌套丢字段
    if (!messages.chats.length) {
      var topChats = mapArr(raw, 'chats', 'conversations', normalizeChat);
      if (topChats.length) messages.chats = topChats;
    }
    if (!profile.meNotes.length) {
      var topMe = mapArr(raw, 'meNotes', null, function (n, i) { return normalizeNote(n, i, 'me'); });
      if (topMe.length) profile.meNotes = topMe;
    }
    if (!profile.collections.length) {
      var topCol = mapArr(raw, 'collections', 'favs', function (n, i) { return normalizeNote(n, i, 'cl'); });
      if (topCol.length) profile.collections = topCol;
    }
    if (!profile.liked.length) {
      var topLiked = mapArr(raw, 'liked', 'praised', function (n, i) { return normalizeNote(n, i, 'lk'); });
      if (topLiked.length) profile.liked = topLiked;
    }

    return {
      nickname: String(raw.nickname || raw.uname || raw.name || raw.userName || '').trim(),
      xhsId: String(raw.xhsId || raw.redId || raw.uid || raw.idLabel || '').trim(),
      ipLocation: String(raw.ipLocation || raw.ip || raw.location || '').trim(),
      bio: String(raw.bio || raw.sign || raw.motto || raw.slogan || '').trim(),
      avatarTone: pickTone(raw.avatarTone || raw.tone || raw.nickname),
      stats: normalizeStats(raw.stats || raw.counts || {}),
      homeTabs: normalizeHomeTabs(raw.homeTabs || raw.tabs),
      activeHomeTab: String(raw.activeHomeTab || raw.activeTab || '发现').trim() || '发现',
      searchHint: String(raw.searchHint || raw.search || raw.placeholder || '').trim(),
      feed: feed,
      followingFeed: followingFeed,
      market: mapArr(raw, 'market', 'shop', normalizeMarketItem),
      messages: messages,
      profile: profile,
      nightThought: String(raw.nightThought || raw.aside || raw.whisper || '').trim(),
      footerNote: String(raw.footerNote || raw.closing || raw.sealNote || '').trim()
    };
  }

  function normalizeXhsData(raw, contactId) {
    var base = defaultXhsData(contactId);
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
      xhs: normalizeXhsPayload(raw.xhs)
    };
  }

  function getCached(contactId) {
    var key = xhsKey(contactId);
    return cache[key] ? normalizeXhsData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = xhsKey(contactId);
    cache[key] = normalizeXhsData(data, contactId);
    return cache[key];
  }

  function getXhs(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultXhsData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(xhsKey(id)).then(function (raw) {
      var data = normalizeXhsData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultXhsData(id);
    });
  }

  function saveXhs(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeXhsData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(xhsKey(id), next).then(function () { return next; });
  }

  function patchXhs(contactId, patch) {
    return getXhs(contactId).then(function (cur) {
      return saveXhs(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepXhsStore = {
    defaultXhsData: defaultXhsData,
    normalizeXhsData: normalizeXhsData,
    normalizeXhsPayload: normalizeXhsPayload,
    getXhs: getXhs,
    saveXhs: saveXhs,
    patchXhs: patchXhs,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
