/**
 * miya-typewriter-read-together-store.js — 共读会话持久化
 * 共读阅读进度（page / bookScroll）仅存于本场 session，与编纂室 book.progress 完全独立。
 */
(function (global) {
  'use strict';

  var LS_KEY = 'miya-typewriter-read-together-v1';
  var data = { sessions: [] };
  var ready = false;
  var readyPromise = null;

  function trySyncHydrate() {
    if (ready) return data;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(LS_KEY);
      if (raw != null) {
        var list = (raw && raw.sessions) || [];
        data.sessions = list.map(normalizeSession).filter(Boolean);
        ready = true;
        return data;
      }
    }
    return null;
  }

  function invalidateCache() {
    data = { sessions: [] };
    ready = false;
    readyPromise = null;
  }

  function newId() {
    return 'rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeMessage(raw) {
    if (!raw) return null;
    var role = raw.role === 'user' ? 'user' : (raw.role === 'assistant' ? 'assistant' : 'system');
    var type = raw.type === 'sticker' ? 'sticker' : 'text';
    var content = String(raw.content || '').trim();
    if (!content && role !== 'system') return null;
    var msg = {
      id: String(raw.id || newId()),
      role: role,
      type: type,
      content: content,
      createdAt: raw.createdAt || Date.now()
    };
    if (type === 'sticker') {
      msg.stickerName = String(raw.stickerName || '').trim();
      msg.stickerBlobId = String(raw.stickerBlobId || '').trim();
      msg.stickerUrl = String(raw.stickerUrl || '').trim();
    }
    return msg;
  }

  function normalizeSession(raw) {
    if (!raw || !raw.id) return null;
    var status = raw.status === 'completed' ? 'completed' : 'paused';
    var msgs = (raw.messages || []).map(normalizeMessage).filter(Boolean);
    return {
      id: String(raw.id),
      contactId: String(raw.contactId || ''),
      profileId: String(raw.profileId || ''),
      chatId: String(raw.chatId || ''),
      bookId: String(raw.bookId || ''),
      page: Math.max(0, parseInt(raw.page, 10) || 0),
      bookScroll: Math.max(0, parseInt(raw.bookScroll, 10) || 0),
      messages: msgs,
      status: status,
      startedAt: raw.startedAt || Date.now(),
      endedAt: raw.endedAt || null,
      updatedAt: raw.updatedAt || Date.now()
    };
  }

  function save() {
    if (global.miyaWriteLsJsonKey) return global.miyaWriteLsJsonKey(LS_KEY, data);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = (global.miyaReadLsJsonKey
      ? global.miyaReadLsJsonKey(LS_KEY, { sessions: [] })
      : Promise.resolve({ sessions: [] })
    ).then(function (raw) {
      var list = (raw && raw.sessions) || [];
      data.sessions = list.map(normalizeSession).filter(Boolean);
      ready = true;
      return data;
    }).catch(function () {
      data.sessions = [];
      ready = true;
      return data;
    });
    return readyPromise;
  }

  function getSessions() {
    trySyncHydrate();
    return data.sessions.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getSession(id) {
    var sid = String(id || '');
    return data.sessions.find(function (s) { return s.id === sid; }) || null;
  }

  function getPausedSessions() {
    return getSessions().filter(function (s) { return s.status === 'paused'; });
  }

  function getCompletedSessions() {
    return getSessions().filter(function (s) { return s.status === 'completed'; });
  }

  function findPausedSession(contactId, bookId, profileId) {
    var cid = String(contactId || '');
    var bid = String(bookId || '');
    var pid = String(profileId || '');
    return getPausedSessions().find(function (s) {
      if (s.contactId !== cid || s.bookId !== bid) return false;
      if (pid && s.profileId && s.profileId !== pid) return false;
      return true;
    }) || null;
  }

  function upsertSession(session) {
    var norm = normalizeSession(session);
    if (!norm) return null;
    var idx = data.sessions.findIndex(function (s) { return s.id === norm.id; });
    norm.updatedAt = Date.now();
    if (idx >= 0) data.sessions[idx] = norm;
    else data.sessions.unshift(norm);
    save();
    return norm;
  }

  function createSession(opts) {
    opts = opts || {};
    var session = normalizeSession({
      id: newId(),
      contactId: opts.contactId,
      profileId: opts.profileId,
      chatId: opts.chatId,
      bookId: opts.bookId,
      page: opts.page || 0,
      bookScroll: opts.bookScroll || 0,
      messages: [],
      status: 'paused',
      startedAt: Date.now(),
      updatedAt: Date.now()
    });
    if (!session) return null;
    data.sessions.unshift(session);
    save();
    return session;
  }

  function updateSession(id, patch) {
    var session = getSession(id);
    if (!session) return null;
    if (patch.page != null) session.page = Math.max(0, parseInt(patch.page, 10) || 0);
    if (patch.bookScroll != null) session.bookScroll = Math.max(0, parseInt(patch.bookScroll, 10) || 0);
    if (patch.messages) session.messages = patch.messages.map(normalizeMessage).filter(Boolean);
    if (patch.status) session.status = patch.status === 'completed' ? 'completed' : 'paused';
    if (patch.endedAt != null) session.endedAt = patch.endedAt;
    session.updatedAt = Date.now();
    save();
    return session;
  }

  function addMessage(sessionId, role, content, extra) {
    var session = getSession(sessionId);
    if (!session) return null;
    extra = extra && typeof extra === 'object' ? extra : {};
    var payload = typeof content === 'object' && content
      ? Object.assign({ role: role }, content)
      : Object.assign({ role: role, content: content }, extra);
    var msg = normalizeMessage(payload);
    if (!msg) return null;
    session.messages.push(msg);
    session.updatedAt = Date.now();
    save();
    return msg;
  }

  function pauseSession(id) {
    return updateSession(id, { status: 'paused' });
  }

  function completeSession(id) {
    return updateSession(id, { status: 'completed', endedAt: Date.now() });
  }

  global.miyaTypewriterReadTogetherStore = {
    LS_KEY: LS_KEY,
    load: load,
    whenReady: function () { return load(); },
    isReady: function () { return ready; },
    invalidateCache: invalidateCache,
    getSessions: getSessions,
    getSession: getSession,
    getPausedSessions: getPausedSessions,
    getCompletedSessions: getCompletedSessions,
    findPausedSession: findPausedSession,
    createSession: createSession,
    updateSession: updateSession,
    addMessage: addMessage,
    pauseSession: pauseSession,
    completeSession: completeSession,
    upsertSession: upsertSession
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaTypewriterReadTogetherStore);
})(window);
