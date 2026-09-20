/**
 * miya-theater-store.js — 小剧场模版与剧目持久化
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-theater-v1';
  var cache = null;

  function uid(prefix) {
    return (prefix || 'th') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function emptyData() {
    return { templates: [], plays: [] };
  }

  function loadRaw() {
    if (cache) return cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var mem = global.miyaSyncReadJsonKey(STORAGE_KEY);
      if (mem && typeof mem === 'object') {
        cache = mem;
        if (!Array.isArray(cache.templates)) cache.templates = [];
        if (!Array.isArray(cache.plays)) cache.plays = [];
        return cache;
      }
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw))) {
        cache = JSON.parse(raw);
      } else {
        cache = null;
      }
    } catch (e) {
      cache = null;
    }
    if (!cache || typeof cache !== 'object') cache = emptyData();
    if (!Array.isArray(cache.templates)) cache.templates = [];
    if (!Array.isArray(cache.plays)) cache.plays = [];
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

  function normalizeTemplate(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var mode = String(entry.mode || 'any').trim();
    if (mode !== 'solo' && mode !== 'multi') mode = 'any';
    return {
      id: String(entry.id || uid('tpl')),
      title: String(entry.title || '').trim() || '未命名模版',
      prompt: String(entry.prompt || '').trim(),
      mode: mode,
      createdAt: Number(entry.createdAt) || Date.now(),
      updatedAt: Number(entry.updatedAt) || Date.now()
    };
  }

  function normalizePlay(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var mode = String(entry.mode || 'solo').trim() === 'multi' ? 'multi' : 'solo';
    var contentType = String(entry.contentType || 'text').trim() === 'html' ? 'html' : 'text';
    var contactIds = Array.isArray(entry.contactIds)
      ? entry.contactIds.map(function (id) { return String(id || '').trim(); }).filter(Boolean)
      : [];
    var contactNames = Array.isArray(entry.contactNames)
      ? entry.contactNames.map(function (n) { return String(n || '').trim(); }).filter(Boolean)
      : [];
    return {
      id: String(entry.id || uid('play')),
      title: String(entry.title || '').trim() || '未命名剧目',
      content: String(entry.content || ''),
      contentType: contentType,
      mode: mode,
      templateId: String(entry.templateId || '').trim(),
      templateTitle: String(entry.templateTitle || '').trim(),
      contactIds: contactIds,
      contactNames: contactNames,
      favorited: !!entry.favorited,
      createdAt: Number(entry.createdAt) || Date.now(),
      updatedAt: Number(entry.updatedAt) || Date.now()
    };
  }

  function listTemplates(mode) {
    var list = loadRaw().templates.map(normalizeTemplate).filter(Boolean);
    var m = String(mode || '').trim();
    if (m === 'solo' || m === 'multi') {
      list = list.filter(function (t) {
        return !t.mode || t.mode === 'any' || t.mode === m;
      });
    }
    return list.sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function findTemplate(id) {
    var tid = String(id || '').trim();
    if (!tid) return null;
    return listTemplates().find(function (t) { return t && t.id === tid; }) || null;
  }

  function upsertTemplate(entry) {
    var row = normalizeTemplate(entry);
    if (!row || !row.prompt) return null;
    row.updatedAt = Date.now();
    var data = loadRaw();
    var idx = data.templates.findIndex(function (t) { return t && t.id === row.id; });
    if (idx >= 0) {
      row.createdAt = Number(data.templates[idx].createdAt) || row.createdAt;
      data.templates[idx] = row;
    } else {
      row.createdAt = row.createdAt || Date.now();
      data.templates.unshift(row);
    }
    saveRaw();
    return row;
  }

  function removeTemplate(id) {
    var tid = String(id || '').trim();
    if (!tid) return false;
    var data = loadRaw();
    var next = data.templates.filter(function (t) { return t && t.id !== tid; });
    if (next.length === data.templates.length) return false;
    data.templates = next;
    saveRaw();
    return true;
  }

  function listPlays(opts) {
    opts = opts || {};
    var list = loadRaw().plays.map(normalizePlay).filter(Boolean);
    if (opts.favoritedOnly) {
      list = list.filter(function (p) { return p && p.favorited; });
    }
    if (opts.mode === 'solo' || opts.mode === 'multi') {
      list = list.filter(function (p) { return p && p.mode === opts.mode; });
    }
    return list.sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function findPlay(id) {
    var pid = String(id || '').trim();
    if (!pid) return null;
    return listPlays().find(function (p) { return p && p.id === pid; }) || null;
  }

  function upsertPlay(entry) {
    var row = normalizePlay(entry);
    if (!row || !String(row.content || '').trim()) return null;
    row.updatedAt = Date.now();
    var data = loadRaw();
    var idx = data.plays.findIndex(function (p) { return p && p.id === row.id; });
    if (idx >= 0) {
      row.createdAt = Number(data.plays[idx].createdAt) || row.createdAt;
      if (entry.favorited == null) row.favorited = !!data.plays[idx].favorited;
      data.plays[idx] = row;
    } else {
      row.createdAt = row.createdAt || Date.now();
      data.plays.unshift(row);
    }
    saveRaw();
    return row;
  }

  function removePlay(id) {
    var pid = String(id || '').trim();
    if (!pid) return false;
    var data = loadRaw();
    var next = data.plays.filter(function (p) { return p && p.id !== pid; });
    if (next.length === data.plays.length) return false;
    data.plays = next;
    saveRaw();
    return true;
  }

  function setPlayFavorite(id, favorited) {
    var play = findPlay(id);
    if (!play) return null;
    play.favorited = !!favorited;
    play.updatedAt = Date.now();
    return upsertPlay(play);
  }

  global.miyaTheaterStore = {
    STORAGE_KEY: STORAGE_KEY,
    invalidateCache: function () { cache = null; },
    uid: uid,
    listTemplates: listTemplates,
    findTemplate: findTemplate,
    upsertTemplate: upsertTemplate,
    removeTemplate: removeTemplate,
    listPlays: listPlays,
    findPlay: findPlay,
    upsertPlay: upsertPlay,
    removePlay: removePlay,
    setPlayFavorite: setPlayFavorite
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({
      whenReady: function () {
        return global.miyaReadLsJsonKey(STORAGE_KEY, emptyData()).then(function (v) {
          cache = v && typeof v === 'object' ? v : emptyData();
          if (!Array.isArray(cache.templates)) cache.templates = [];
          if (!Array.isArray(cache.plays)) cache.plays = [];
          if (global.__miyaKvMem) global.__miyaKvMem[STORAGE_KEY] = cache;
        });
      }
    });
  }
})(typeof window !== 'undefined' ? window : global);
