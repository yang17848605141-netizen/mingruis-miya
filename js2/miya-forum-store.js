/**
 * miya-forum-store.js — 论坛数据持久化
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'miya-forum-v1';
  var _cache = null;
  var _ready = null;

  function uid(prefix) {
    return String(prefix || 'fr') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function defaultForumMask(name) {
    return {
      id: uid('fmask'),
      name: String(name || '论坛面具').trim() || '论坛面具',
      avatarBlobId: '',
      nickname: '',
      signature: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function defaultState() {
    return {
      version: 1,
      worldview: '',
      worldbookEntryIds: [],
      activeMask: { source: 'chat', id: '' },
      forumMasks: [],
      chatMaskOverrides: {},
      characterActivity: {},
      characterForumNicknames: {},
      hotSearchTopics: [],
      collections: [],
      posts: [],
      bookmarkedPosts: [],
      browsingHistory: [],
      notifications: [],
      followerCount: 0,
      profileBoards: {},
      updatedAt: Date.now()
    };
  }

  function normalizeHotSearchTopic(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var tag = String(raw.tag || raw.title || '').trim();
    if (!tag) return null;
    return {
      tag: tag,
      heat: String(raw.heat || 'HOT').trim(),
      discussCount: String(raw.discussCount || raw.sub || '').trim()
    };
  }

  function normalizeCollection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid('fcoll')).trim(),
      name: name,
      description: String(raw.description || raw.desc || '').trim(),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeMask(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || uid('fmask')).trim(),
      name: String(raw.name || '').trim() || '论坛面具',
      avatarBlobId: String(raw.avatarBlobId || '').trim(),
      nickname: String(raw.nickname || '').trim(),
      signature: String(raw.signature || '').trim(),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeBoardImage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var imageKey = String(raw.imageKey || '').trim();
    var src = String(raw.src || '').trim();
    if (!imageKey && !src) return null;
    return { imageKey: imageKey, src: src };
  }

  function profileBoardKey(source, id) {
    return String(source || 'chat') + ':' + String(id || '').trim();
  }

  function normalizeProfileBoards(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) {
      var arr = Array.isArray(raw[k]) ? raw[k] : [];
      var slots = [];
      for (var i = 0; i < 5; i++) slots.push(normalizeBoardImage(arr[i]));
      if (slots.some(Boolean)) out[String(k)] = slots;
    });
    return out;
  }

  function normalizeNotification(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = String(raw.type || '').trim();
    var allowed = ['comment', 'like', 'reply', 'mention_post', 'mention_comment', 'follower'];
    if (allowed.indexOf(type) < 0) return null;
    return {
      id: String(raw.id || uid('fnotif')).trim(),
      type: type,
      read: !!raw.read,
      createdAt: Number(raw.createdAt) || Date.now(),
      postId: String(raw.postId || '').trim(),
      commentId: String(raw.commentId || '').trim(),
      actorDisplay: String(raw.actorDisplay || '').trim(),
      actorContactId: String(raw.actorContactId || '').trim(),
      actorKind: raw.actorKind === 'character' ? 'character' : 'npc',
      preview: String(raw.preview || '').trim(),
      postPreview: String(raw.postPreview || '').trim(),
      likeCount: Math.max(0, Math.floor(Number(raw.likeCount) || 0)),
      followerCount: Math.max(0, Math.floor(Number(raw.followerCount) || 0))
    };
  }

  function normalizeComment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || uid('fcmt')).trim(),
      authorKind: raw.authorKind === 'character' ? 'character' : (raw.authorKind === 'user' ? 'user' : 'npc'),
      authorContactId: String(raw.authorContactId || '').trim(),
      authorDisplay: String(raw.authorDisplay || '匿名').trim(),
      authorAvatar: String(raw.authorAvatar || '').trim(),
      text: String(raw.text || '').trim(),
      replyToId: String(raw.replyToId || '').trim() || null,
      replyToLabel: String(raw.replyToLabel || '').trim(),
      likes: Math.max(0, Math.floor(Number(raw.likes) || 0)),
      createdAt: Number(raw.createdAt) || Date.now()
    };
  }

  function normalizeImage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var imageKey = String(raw.imageKey || '').trim();
    var src = String(raw.src || '').trim();
    if (raw.type === 'real' || (!raw.type && (imageKey || src) && !raw.textBody && !raw.textImageDesc)) {
      if (imageKey || src) {
        return {
          type: 'real',
          src: src,
          imageKey: imageKey,
          imageDesc: String(raw.imageDesc || '').trim()
        };
      }
    }
    if (raw.type === 'text-image' || raw.textBody) {
      return { type: 'text-image', textBody: String(raw.textBody || raw.textImageDesc || '').trim() };
    }
    return null;
  }

  function normalizeHistoryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var p = normalizePost(raw);
    if (!p) return null;
    return Object.assign({}, p, { viewedAt: Number(raw.viewedAt) || Date.now() });
  }

  function normalizePost(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var comments = Array.isArray(raw.commentsFlat)
      ? raw.commentsFlat.map(normalizeComment).filter(Boolean)
      : [];
    var images = Array.isArray(raw.images) ? raw.images.map(normalizeImage).filter(Boolean) : [];
    return {
      id: String(raw.id || uid('fpost')).trim(),
      authorType: raw.authorType === 'character' ? 'character' : (raw.authorType === 'user' ? 'user' : 'npc'),
      authorContactId: String(raw.authorContactId || '').trim(),
      authorDisplay: String(raw.authorDisplay || '匿名用户').trim(),
      authorAvatar: String(raw.authorAvatar || '').trim(),
      authorAvatarBlobId: String(raw.authorAvatarBlobId || '').trim(),
      authorMaskSource: raw.authorMaskSource === 'forum' ? 'forum' : (raw.authorMaskSource === 'chat' ? 'chat' : ''),
      authorMaskId: String(raw.authorMaskId || '').trim(),
      text: String(raw.text || '').trim(),
      images: images,
      location: String(raw.location || '').trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.map(function (t) { return String(t || '').trim(); }).filter(Boolean) : [],
      postKind: String(raw.postKind || 'text').trim(),
      createdAt: Number(raw.createdAt) || Date.now(),
      likeCount: Math.max(0, Math.floor(Number(raw.likeCount) || 0)),
      commentCount: Math.max(0, Math.floor(Number(raw.commentCount) || comments.length)),
      likedByUser: !!raw.likedByUser,
      bookmarked: !!raw.bookmarked,
      commentsFlat: comments,
      source: String(raw.source || '').trim(),
      topicTag: String(raw.topicTag || '').trim(),
      collectionId: String(raw.collectionId || '').trim(),
      generating: !!raw.generating,
      commentsGenerating: !!raw.commentsGenerating,
      awaitingCommentReply: !!raw.awaitingCommentReply
    };
  }

  function normalizeState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    var chatOverrides = {};
    if (raw.chatMaskOverrides && typeof raw.chatMaskOverrides === 'object') {
      Object.keys(raw.chatMaskOverrides).forEach(function (k) {
        var o = raw.chatMaskOverrides[k];
        if (!o || typeof o !== 'object') return;
        chatOverrides[String(k)] = {
          nickname: String(o.nickname || '').trim(),
          signature: String(o.signature || '').trim()
        };
      });
    }
    var activity = {};
    if (raw.characterActivity && typeof raw.characterActivity === 'object') {
      Object.keys(raw.characterActivity).forEach(function (k) {
        var v = String(raw.characterActivity[k] || '').trim();
        if (v === 'low' || v === 'medium' || v === 'high') activity[String(k)] = v;
        else activity[String(k)] = 'off';
      });
    }
    var nicknames = {};
    if (raw.characterForumNicknames && typeof raw.characterForumNicknames === 'object') {
      Object.keys(raw.characterForumNicknames).forEach(function (k) {
        var n = String(raw.characterForumNicknames[k] || '').trim();
        if (n) nicknames[String(k)] = n;
      });
    }
    return {
      version: 1,
      worldview: String(raw.worldview || '').trim(),
      worldbookEntryIds: Array.isArray(raw.worldbookEntryIds)
        ? raw.worldbookEntryIds.map(String).filter(Boolean)
        : [],
      activeMask: {
        source: raw.activeMask && raw.activeMask.source === 'forum' ? 'forum' : 'chat',
        id: String((raw.activeMask && raw.activeMask.id) || '').trim()
      },
      forumMasks: Array.isArray(raw.forumMasks)
        ? raw.forumMasks.map(normalizeMask).filter(Boolean)
        : [],
      chatMaskOverrides: chatOverrides,
      characterActivity: activity,
      characterForumNicknames: nicknames,
      hotSearchTopics: Array.isArray(raw.hotSearchTopics)
        ? raw.hotSearchTopics.map(normalizeHotSearchTopic).filter(Boolean)
        : [],
      collections: Array.isArray(raw.collections)
        ? raw.collections.map(normalizeCollection).filter(Boolean)
        : [],
      posts: Array.isArray(raw.posts) ? raw.posts.map(normalizePost).filter(Boolean) : [],
      bookmarkedPosts: Array.isArray(raw.bookmarkedPosts) ? raw.bookmarkedPosts.map(normalizePost).filter(Boolean) : [],
      browsingHistory: Array.isArray(raw.browsingHistory)
        ? raw.browsingHistory.map(normalizeHistoryEntry).filter(Boolean)
        : [],
      notifications: Array.isArray(raw.notifications)
        ? raw.notifications.map(normalizeNotification).filter(Boolean)
        : [],
      followerCount: Math.max(0, Math.floor(Number(raw.followerCount) || 0)),
      profileBoards: normalizeProfileBoards(raw.profileBoards),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function needsAsyncHydrate() {
    return typeof global.miyaKvKeyNeedsAsyncHydrate === 'function' &&
      global.miyaKvKeyNeedsAsyncHydrate(STORE_KEY);
  }

  function readState() {
    if (_cache) return normalizeState(_cache);
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(STORE_KEY);
      if (raw != null) {
        _cache = normalizeState(raw);
        return _cache;
      }
    }
    if (needsAsyncHydrate()) return normalizeState(defaultState());
    return defaultState();
  }

  /** 合并帖子快照时保留较多评论，避免 stale 引用覆盖 commentsFlat */
  function mergePostSnapshot(existing, patch) {
    if (!patch || typeof patch !== 'object') return normalizePost(existing);
    var ex = existing && typeof existing === 'object' ? existing : {};
    var next = Object.assign({}, ex, patch);
    var exFlat = Array.isArray(ex.commentsFlat) ? ex.commentsFlat : [];
    var patchFlat = Array.isArray(patch.commentsFlat) ? patch.commentsFlat : null;
    if (!patchFlat) {
      if (exFlat.length) next.commentsFlat = exFlat;
    } else if (exFlat.length > patchFlat.length) {
      var byId = {};
      patchFlat.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
      var merged = patchFlat.slice();
      exFlat.forEach(function (c) {
        if (c && c.id && !byId[c.id]) merged.push(c);
      });
      merged.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      next.commentsFlat = merged;
      next.commentCount = Math.max(next.commentCount || 0, merged.length);
    }
    return normalizePost(next);
  }

  function writeState(next) {
    _cache = next;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(STORE_KEY, next).then(function () { return next; });
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch (e) {}
    return Promise.resolve(next);
  }

  function persist(state) {
    var next = normalizeState(state);
    next.updatedAt = Date.now();
    if (!_cache && needsAsyncHydrate()) {
      return whenReady().then(function () { return writeState(next); });
    }
    return writeState(next);
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = (typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(STORE_KEY, defaultState())
      : Promise.resolve(defaultState())
    ).then(function (v) {
      _cache = normalizeState(v);
      return _cache;
    }).catch(function () {
      _cache = defaultState();
      return _cache;
    });
    return _ready;
  }

  function getState() { return readState(); }

  function saveState(patch) {
    var cur = readState();
    var next = normalizeState(Object.assign({}, cur, patch || {}));
    return persist(next);
  }

  function mergeState(patchFn) {
    var cur = readState();
    var patch = typeof patchFn === 'function' ? patchFn(cur) : (patchFn || {});
    return persist(Object.assign({}, cur, patch));
  }

  function setWorldview(text) {
    return saveState({ worldview: String(text || '').trim() });
  }

  function setWorldbookEntryIds(ids) {
    return saveState({ worldbookEntryIds: Array.isArray(ids) ? ids.map(String).filter(Boolean) : [] });
  }

  function setActiveMask(source, id) {
    return saveState({
      activeMask: {
        source: source === 'forum' ? 'forum' : 'chat',
        id: String(id || '').trim()
      }
    });
  }

  function addForumMask(name) {
    var cur = readState();
    var mask = defaultForumMask(name);
    cur.forumMasks = cur.forumMasks.concat([mask]);
    return persist(cur).then(function () { return mask; });
  }

  function updateForumMask(id, patch) {
    return mergeState(function (cur) {
      var idx = cur.forumMasks.findIndex(function (m) { return m.id === id; });
      if (idx < 0) return cur;
      var next = Object.assign({}, cur.forumMasks[idx], patch || {}, { updatedAt: Date.now() });
      cur.forumMasks = cur.forumMasks.slice();
      cur.forumMasks[idx] = normalizeMask(next);
      return cur;
    });
  }

  function deleteForumMask(id) {
    return mergeState(function (cur) {
      cur.forumMasks = cur.forumMasks.filter(function (m) { return m.id !== id; });
      if (cur.activeMask.source === 'forum' && cur.activeMask.id === id) {
        cur.activeMask = { source: 'chat', id: '' };
      }
      return cur;
    });
  }

  function setChatMaskOverride(profileId, patch) {
    var pid = String(profileId || '').trim();
    if (!pid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.chatMaskOverrides = Object.assign({}, cur.chatMaskOverrides);
      var prev = cur.chatMaskOverrides[pid] || { nickname: '', signature: '' };
      cur.chatMaskOverrides[pid] = {
        nickname: patch && patch.nickname != null ? String(patch.nickname).trim() : prev.nickname,
        signature: patch && patch.signature != null ? String(patch.signature).trim() : prev.signature
      };
      return cur;
    });
  }

  function setCharacterActivity(contactId, level) {
    var cid = String(contactId || '').trim();
    if (!cid) return Promise.resolve(readState());
    var v = String(level || 'off').trim();
    if (v !== 'low' && v !== 'medium' && v !== 'high') v = 'off';
    return mergeState(function (cur) {
      cur.characterActivity = Object.assign({}, cur.characterActivity);
      cur.characterActivity[cid] = v;
      return cur;
    });
  }

  function setCharacterForumNickname(contactId, nickname) {
    var cid = String(contactId || '').trim();
    if (!cid) return Promise.resolve(readState());
    var n = String(nickname || '').trim();
    return mergeState(function (cur) {
      cur.characterForumNicknames = Object.assign({}, cur.characterForumNicknames);
      if (n) cur.characterForumNicknames[cid] = n;
      else delete cur.characterForumNicknames[cid];
      return cur;
    });
  }

  function setCharacterForumNicknames(map) {
    if (!map || typeof map !== 'object') return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.characterForumNicknames = Object.assign({}, cur.characterForumNicknames);
      Object.keys(map).forEach(function (k) {
        var cid = String(k || '').trim();
        if (!cid) return;
        var n = String(map[k] || '').trim();
        if (n) cur.characterForumNicknames[cid] = n;
        else delete cur.characterForumNicknames[cid];
      });
      return cur;
    });
  }

  function replacePosts(posts) {
    return mergeState(function (cur) {
      cur.posts = Array.isArray(posts) ? posts.map(normalizePost).filter(Boolean) : [];
      return cur;
    });
  }

  function replaceTopicPosts(topicTag, posts) {
    var tag = String(topicTag || '').trim();
    if (!tag) return replacePosts(posts);
    return mergeState(function (cur) {
      var kept = cur.posts.filter(function (p) {
        return !(p.source === 'topic' && p.topicTag === tag);
      });
      var incoming = (Array.isArray(posts) ? posts : []).map(function (p) {
        return normalizePost(Object.assign({}, p, { source: 'topic', topicTag: tag }));
      }).filter(Boolean);
      cur.posts = kept.concat(incoming).sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      return cur;
    });
  }

  function setHotSearchTopics(topics) {
    var list = Array.isArray(topics)
      ? topics.map(normalizeHotSearchTopic).filter(Boolean)
      : [];
    return saveState({ hotSearchTopics: list });
  }

  function getHotSearchTopics() {
    return readState().hotSearchTopics.slice();
  }

  function listCollections() {
    return readState().collections.slice().sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function addCollection(name, description) {
    var coll = normalizeCollection({
      id: uid('fcoll'),
      name: name,
      description: description,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (!coll) return Promise.resolve(null);
    return mergeState(function (cur) {
      cur.collections = (cur.collections || []).concat([coll]);
      return cur;
    }).then(function () { return coll; });
  }

  function updateCollection(id, patch) {
    var cid = String(id || '').trim();
    if (!cid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      var idx = (cur.collections || []).findIndex(function (c) { return c.id === cid; });
      if (idx < 0) return cur;
      var next = Object.assign({}, cur.collections[idx], patch || {}, { updatedAt: Date.now() });
      cur.collections = cur.collections.slice();
      cur.collections[idx] = normalizeCollection(next);
      return cur;
    });
  }

  function deleteCollection(id) {
    var cid = String(id || '').trim();
    if (!cid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.collections = (cur.collections || []).filter(function (c) { return c.id !== cid; });
      cur.posts = cur.posts.map(function (p) {
        if (p.collectionId !== cid) return p;
        if (p.authorType === 'user') {
          return normalizePost(Object.assign({}, p, { collectionId: '', source: 'user' }));
        }
        return null;
      }).filter(Boolean);
      return cur;
    });
  }

  function replaceCollectionPosts(collectionId, posts) {
    var cid = String(collectionId || '').trim();
    if (!cid) return replacePosts(posts);
    return mergeState(function (cur) {
      var kept = cur.posts.filter(function (p) {
        return !(p.collectionId === cid && p.authorType !== 'user' && p.source === 'collection');
      });
      var incoming = (Array.isArray(posts) ? posts : []).map(function (p) {
        return normalizePost(Object.assign({}, p, { source: 'collection', collectionId: cid }));
      }).filter(Boolean);
      cur.posts = kept.concat(incoming).sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      return cur;
    });
  }

  function countCollectionPosts(collectionId) {
    var cid = String(collectionId || '').trim();
    if (!cid) return 0;
    return readState().posts.filter(function (p) {
      return p.collectionId === cid;
    }).length;
  }

  function countUserPostsInCollection(collectionId) {
    var cid = String(collectionId || '').trim();
    if (!cid) return 0;
    return readState().posts.filter(function (p) {
      return p.collectionId === cid && p.authorType === 'user';
    }).length;
  }

  function replaceHomePosts(posts) {
    return mergeState(function (cur) {
      var kept = cur.posts.filter(function (p) {
        return p.source === 'topic' || p.source === 'collection' || p.source === 'user' || p.authorType === 'user';
      });
      var incoming = (Array.isArray(posts) ? posts : []).map(function (p) {
        return normalizePost(Object.assign({}, p, { source: p.source || 'home' }));
      }).filter(Boolean);
      cur.posts = kept.concat(incoming).sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      return cur;
    });
  }

  function listBookmarkedPosts() {
    return readState().bookmarkedPosts.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function findBookmarkedPost(id) {
    return readState().bookmarkedPosts.find(function (p) { return p.id === id; }) || null;
  }

  function findHistoryPost(id) {
    return readState().browsingHistory.find(function (p) { return p.id === id; }) || null;
  }

  function listBrowsingHistory() {
    return readState().browsingHistory.slice().sort(function (a, b) {
      return (b.viewedAt || b.createdAt || 0) - (a.viewedAt || a.createdAt || 0);
    });
  }

  function recordPostView(post) {
    var p = normalizePost(post);
    if (!p) return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.browsingHistory = cur.browsingHistory.slice();
      var idx = cur.browsingHistory.findIndex(function (x) { return x.id === p.id; });
      var feedIdx = cur.posts.findIndex(function (x) { return x.id === p.id; });
      var base = feedIdx >= 0 ? Object.assign({}, cur.posts[feedIdx], p) : p;
      var copy = normalizeHistoryEntry(Object.assign({}, base, { viewedAt: Date.now() }));
      if (idx >= 0) cur.browsingHistory.splice(idx, 1);
      cur.browsingHistory.unshift(copy);
      return cur;
    });
  }

  function findPostAnywhere(id) {
    return findPost(id) || findBookmarkedPost(id) || findHistoryPost(id);
  }

  function setPostBookmarked(post, bookmarked) {
    var p = normalizePost(post);
    if (!p) return Promise.resolve(readState());
    p.bookmarked = !!bookmarked;
    return mergeState(function (cur) {
      var idx = cur.posts.findIndex(function (x) { return x.id === p.id; });
      if (idx >= 0) cur.posts[idx] = Object.assign({}, cur.posts[idx], { bookmarked: p.bookmarked });
      cur.bookmarkedPosts = cur.bookmarkedPosts.slice();
      var bIdx = cur.bookmarkedPosts.findIndex(function (x) { return x.id === p.id; });
      if (p.bookmarked) {
        var copy = normalizePost(Object.assign({}, p, { bookmarked: true }));
        if (bIdx >= 0) cur.bookmarkedPosts[bIdx] = copy;
        else cur.bookmarkedPosts.unshift(copy);
      } else if (bIdx >= 0) {
        cur.bookmarkedPosts.splice(bIdx, 1);
      }
      var hIdx = cur.browsingHistory.findIndex(function (x) { return x.id === p.id; });
      if (hIdx >= 0) {
        var viewedAt = cur.browsingHistory[hIdx].viewedAt || Date.now();
        cur.browsingHistory[hIdx] = normalizeHistoryEntry(
          Object.assign({}, cur.browsingHistory[hIdx], p, { bookmarked: p.bookmarked, viewedAt: viewedAt })
        );
      }
      return cur;
    });
  }

  function syncBookmarkedCopy(post) {
    return syncPostEverywhere(post);
  }

  function syncHistoryCopy(post) {
    return syncPostEverywhere(post);
  }

  function syncPostEverywhere(post) {
    var p = normalizePost(post);
    if (!p) return Promise.resolve(readState());
    return mergeState(function (cur) {
      var idx = cur.posts.findIndex(function (x) { return x.id === p.id; });
      if (idx >= 0) cur.posts[idx] = mergePostSnapshot(cur.posts[idx], p);
      var bIdx = cur.bookmarkedPosts.findIndex(function (x) { return x.id === p.id; });
      if (bIdx >= 0) {
        cur.bookmarkedPosts[bIdx] = mergePostSnapshot(
          cur.bookmarkedPosts[bIdx],
          Object.assign({}, p, { bookmarked: true })
        );
      }
      var hIdx = cur.browsingHistory.findIndex(function (x) { return x.id === p.id; });
      if (hIdx >= 0) {
        var viewedAt = cur.browsingHistory[hIdx].viewedAt || Date.now();
        cur.browsingHistory[hIdx] = normalizeHistoryEntry(
          mergePostSnapshot(cur.browsingHistory[hIdx], Object.assign({}, p, { viewedAt: viewedAt }))
        );
      }
      return cur;
    });
  }

  function upsertPost(post) {
    var p = normalizePost(post);
    if (!p) return Promise.resolve(readState());
    return mergeState(function (cur) {
      var idx = cur.posts.findIndex(function (x) { return x.id === p.id; });
      var bIdx = cur.bookmarkedPosts.findIndex(function (x) { return x.id === p.id; });
      var hIdx = cur.browsingHistory.findIndex(function (x) { return x.id === p.id; });
      if (idx >= 0) {
        cur.posts[idx] = mergePostSnapshot(cur.posts[idx], p);
      } else if (!p.bookmarked && bIdx < 0 && hIdx < 0) {
        cur.posts.unshift(p);
        cur.posts.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      }
      if (p.bookmarked || bIdx >= 0) {
        cur.bookmarkedPosts = cur.bookmarkedPosts.slice();
        var copy = normalizePost(Object.assign({}, p, { bookmarked: true }));
        if (bIdx >= 0) cur.bookmarkedPosts[bIdx] = copy;
        else if (p.bookmarked) cur.bookmarkedPosts.unshift(copy);
      }
      if (hIdx >= 0) {
        var viewedAt = cur.browsingHistory[hIdx].viewedAt || Date.now();
        cur.browsingHistory[hIdx] = normalizeHistoryEntry(Object.assign({}, p, { viewedAt: viewedAt }));
      }
      return cur;
    });
  }

  function getProfileBoard(source, id) {
    var key = profileBoardKey(source, id);
    var boards = readState().profileBoards || {};
    var arr = Array.isArray(boards[key]) ? boards[key] : [];
    var out = [];
    for (var i = 0; i < 5; i++) out.push(normalizeBoardImage(arr[i]));
    return out;
  }

  function setProfileBoard(source, id, images) {
    var key = profileBoardKey(source, id);
    if (!key || key === 'chat:' || key === 'forum:') return Promise.resolve(readState());
    var list = [];
    var src = Array.isArray(images) ? images : [];
    for (var i = 0; i < 5; i++) list.push(normalizeBoardImage(src[i]));
    var hasAny = list.some(Boolean);
    return mergeState(function (cur) {
      cur.profileBoards = Object.assign({}, cur.profileBoards || {});
      if (hasAny) cur.profileBoards[key] = list;
      else delete cur.profileBoards[key];
      return cur;
    });
  }

  function findPost(id) {
    return readState().posts.find(function (p) { return p.id === id; }) || null;
  }

  function deletePost(postId) {
    var pid = String(postId || '').trim();
    if (!pid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.posts = cur.posts.filter(function (p) { return p.id !== pid; });
      cur.bookmarkedPosts = cur.bookmarkedPosts.filter(function (p) { return p.id !== pid; });
      cur.browsingHistory = cur.browsingHistory.filter(function (p) { return p.id !== pid; });
      cur.notifications = cur.notifications.filter(function (n) { return n.postId !== pid; });
      return cur;
    });
  }

  function deleteComment(postId, commentId) {
    var pid = String(postId || '').trim();
    var cid = String(commentId || '').trim();
    if (!pid || !cid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      var toRemove = {};
      toRemove[cid] = true;

      function collectRemovedIds(flat) {
        var list = Array.isArray(flat) ? flat : [];
        var changed = true;
        while (changed) {
          changed = false;
          list.forEach(function (c) {
            if (c.replyToId && toRemove[String(c.replyToId)] && !toRemove[c.id]) {
              toRemove[c.id] = true;
              changed = true;
            }
          });
        }
      }

      var sourcePost = cur.posts.find(function (p) { return p.id === pid; })
        || cur.bookmarkedPosts.find(function (p) { return p.id === pid; })
        || cur.browsingHistory.find(function (p) { return p.id === pid; });
      if (sourcePost) collectRemovedIds(sourcePost.commentsFlat);

      var pruneComments = function (post) {
        if (!post || post.id !== pid) return post;
        var flat = Array.isArray(post.commentsFlat) ? post.commentsFlat.slice() : [];
        var nextFlat = flat.filter(function (c) { return !toRemove[c.id]; });
        return Object.assign({}, post, {
          commentsFlat: nextFlat,
          commentCount: nextFlat.length
        });
      };

      cur.posts = cur.posts.map(pruneComments);
      cur.bookmarkedPosts = cur.bookmarkedPosts.map(pruneComments);
      cur.browsingHistory = cur.browsingHistory.map(pruneComments);
      cur.notifications = cur.notifications.filter(function (n) {
        return !(n.postId === pid && n.commentId && toRemove[n.commentId]);
      });
      return cur;
    });
  }

  function listNotifications() {
    return readState().notifications.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function countUnreadNotifications() {
    return readState().notifications.filter(function (n) { return !n.read; }).length;
  }

  function addNotification(notif) {
    var n = normalizeNotification(notif);
    if (!n) return Promise.resolve(readState());
    return mergeState(function (cur) {
      if (n.commentId) {
        var dup = cur.notifications.some(function (x) {
          return x.type === n.type && x.commentId === n.commentId && x.postId === n.postId;
        });
        if (dup) return cur;
      }
      if (n.type === 'like' && n.postId) {
        var likeIdx = cur.notifications.findIndex(function (x) {
          return x.type === 'like' && x.postId === n.postId && !x.read;
        });
        if (likeIdx >= 0) {
          cur.notifications = cur.notifications.slice();
          cur.notifications[likeIdx] = normalizeNotification(Object.assign({}, cur.notifications[likeIdx], {
            likeCount: n.likeCount,
            createdAt: Date.now(),
            preview: n.preview || cur.notifications[likeIdx].preview
          }));
          return cur;
        }
      }
      if (n.type === 'follower') {
        var folIdx = cur.notifications.findIndex(function (x) {
          return x.type === 'follower' && !x.read;
        });
        if (folIdx >= 0) {
          cur.notifications = cur.notifications.slice();
          cur.notifications[folIdx] = normalizeNotification(Object.assign({}, cur.notifications[folIdx], {
            followerCount: (cur.notifications[folIdx].followerCount || 0) + (n.followerCount || 1),
            createdAt: Date.now(),
            preview: n.preview || cur.notifications[folIdx].preview,
            actorDisplay: n.actorDisplay || cur.notifications[folIdx].actorDisplay
          }));
          return cur;
        }
      }
      cur.notifications = [n].concat(cur.notifications);
      if (cur.notifications.length > 200) cur.notifications = cur.notifications.slice(0, 200);
      return cur;
    });
  }

  function addNotifications(list) {
    var items = Array.isArray(list) ? list.map(normalizeNotification).filter(Boolean) : [];
    if (!items.length) return Promise.resolve(readState());
    return mergeState(function (cur) {
      items.forEach(function (n) {
        if (n.commentId && cur.notifications.some(function (x) {
          return x.type === n.type && x.commentId === n.commentId && x.postId === n.postId;
        })) return;
        if (n.type === 'like' && n.postId) {
          var likeIdx = cur.notifications.findIndex(function (x) {
            return x.type === 'like' && x.postId === n.postId && !x.read;
          });
          if (likeIdx >= 0) {
            cur.notifications[likeIdx] = normalizeNotification(Object.assign({}, cur.notifications[likeIdx], {
              likeCount: n.likeCount,
              createdAt: Date.now(),
              preview: n.preview || cur.notifications[likeIdx].preview
            }));
            return;
          }
        }
        if (n.type === 'follower') {
          var folIdx = cur.notifications.findIndex(function (x) {
            return x.type === 'follower' && !x.read;
          });
          if (folIdx >= 0) {
            cur.notifications[folIdx] = normalizeNotification(Object.assign({}, cur.notifications[folIdx], {
              followerCount: (cur.notifications[folIdx].followerCount || 0) + (n.followerCount || 1),
              createdAt: Date.now(),
              preview: n.preview || cur.notifications[folIdx].preview,
              actorDisplay: n.actorDisplay || cur.notifications[folIdx].actorDisplay
            }));
            return;
          }
        }
        cur.notifications.unshift(n);
      });
      if (cur.notifications.length > 200) cur.notifications = cur.notifications.slice(0, 200);
      return cur;
    });
  }

  function markNotificationRead(id) {
    var nid = String(id || '').trim();
    if (!nid) return Promise.resolve(readState());
    return mergeState(function (cur) {
      cur.notifications = cur.notifications.map(function (n) {
        if (n.id !== nid) return n;
        return Object.assign({}, n, { read: true });
      });
      return cur;
    });
  }

  function markAllNotificationsRead() {
    return mergeState(function (cur) {
      cur.notifications = cur.notifications.map(function (n) {
        return Object.assign({}, n, { read: true });
      });
      return cur;
    });
  }

  function nowId() { return uid('fpost'); }

  function listUserPosts() {
    return readState().posts
      .filter(function (p) { return p.authorType === 'user'; })
      .slice()
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function countUserPosts() {
    return listUserPosts().length;
  }

  function getFollowerCount() {
    return Math.max(0, Math.floor(Number(readState().followerCount) || 0));
  }

  function addFollowers(count) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n) return Promise.resolve(getFollowerCount());
    return mergeState(function (cur) {
      cur.followerCount = Math.max(0, Math.floor(Number(cur.followerCount) || 0)) + n;
      return cur;
    }).then(function (s) { return s.followerCount; });
  }

  function invalidateCache() {
    _cache = null;
    _ready = null;
  }

  var api = {
    STORE_KEY: STORE_KEY,
    whenReady: whenReady,
    invalidateCache: invalidateCache,
    getState: getState,
    saveState: saveState,
    mergeState: mergeState,
    setWorldview: setWorldview,
    setWorldbookEntryIds: setWorldbookEntryIds,
    setActiveMask: setActiveMask,
    addForumMask: addForumMask,
    updateForumMask: updateForumMask,
    deleteForumMask: deleteForumMask,
    setChatMaskOverride: setChatMaskOverride,
    setCharacterActivity: setCharacterActivity,
    setCharacterForumNickname: setCharacterForumNickname,
    setCharacterForumNicknames: setCharacterForumNicknames,
    setHotSearchTopics: setHotSearchTopics,
    getHotSearchTopics: getHotSearchTopics,
    listCollections: listCollections,
    addCollection: addCollection,
    updateCollection: updateCollection,
    deleteCollection: deleteCollection,
    replaceCollectionPosts: replaceCollectionPosts,
    countCollectionPosts: countCollectionPosts,
    countUserPostsInCollection: countUserPostsInCollection,
    normalizeCollection: normalizeCollection,
    normalizeHotSearchTopic: normalizeHotSearchTopic,
    replacePosts: replacePosts,
    replaceTopicPosts: replaceTopicPosts,
    replaceHomePosts: replaceHomePosts,
    upsertPost: upsertPost,
    findPost: findPost,
    findPostAnywhere: findPostAnywhere,
    deletePost: deletePost,
    deleteComment: deleteComment,
    listBookmarkedPosts: listBookmarkedPosts,
    findBookmarkedPost: findBookmarkedPost,
    setPostBookmarked: setPostBookmarked,
    syncBookmarkedCopy: syncBookmarkedCopy,
    syncHistoryCopy: syncHistoryCopy,
    syncPostEverywhere: syncPostEverywhere,
    listBrowsingHistory: listBrowsingHistory,
    findHistoryPost: findHistoryPost,
    recordPostView: recordPostView,
    listNotifications: listNotifications,
    countUnreadNotifications: countUnreadNotifications,
    addNotification: addNotification,
    addNotifications: addNotifications,
    markNotificationRead: markNotificationRead,
    markAllNotificationsRead: markAllNotificationsRead,
    listUserPosts: listUserPosts,
    countUserPosts: countUserPosts,
    getFollowerCount: getFollowerCount,
    addFollowers: addFollowers,
    nowId: nowId,
    normalizePost: normalizePost,
    normalizeComment: normalizeComment,
    defaultForumMask: defaultForumMask,
    getProfileBoard: getProfileBoard,
    setProfileBoard: setProfileBoard,
    profileBoardKey: profileBoardKey
  };

  global.miyaForumStore = api;
  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(api);
})(window);
