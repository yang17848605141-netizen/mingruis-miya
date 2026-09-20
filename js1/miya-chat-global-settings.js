/**
 * 联系人聊天全局设置：感知 / 记忆 / 后台
 * 默认全员生效；perContact[contactId].useGlobal === false 时使用单独配置
 */
(function (global) {
  'use strict';

  var KEY = 'miya-chat-global-settings-v1';

  /** 由全局模块管理的字段（weatherAwareness 仅 per-contact 聊天设置里配置，不在此列） */
  var MANAGED_KEYS = [
    'timeAwareness',
    'memoryCount',
    'summaryTrigger',
    'summaryLength',
    'backgroundMessage'
  ];

  var cache = null;
  var ready = null;

  function defaultGlobalSlice() {
    var d = global.miyaChatStore && global.miyaChatStore.defaultChatSettings
      ? global.miyaChatStore.defaultChatSettings()
      : {};
    var out = {};
    MANAGED_KEYS.forEach(function (k) {
      if (d[k] != null) {
        out[k] = typeof d[k] === 'object' && !Array.isArray(d[k])
          ? JSON.parse(JSON.stringify(d[k]))
          : d[k];
      }
    });
    return out;
  }

  function defaultState() {
    return {
      version: 1,
      useGlobal: true,
      global: defaultGlobalSlice(),
      perContact: {}
    };
  }

  function normalizePerContact(raw) {
    if (!raw || typeof raw !== 'object') return {};
    var out = {};
    Object.keys(raw).forEach(function (cid) {
      var row = raw[cid];
      if (!row || typeof row !== 'object') return;
      var settings = {};
      MANAGED_KEYS.forEach(function (k) {
        if (row.settings && row.settings[k] != null) settings[k] = row.settings[k];
      });
      out[cid] = {
        useGlobal: row.useGlobal !== false ? !!row.useGlobal : false,
        settings: settings
      };
    });
    return out;
  }

  function normalizeState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    var g = Object.assign({}, d.global, raw.global || {});
    MANAGED_KEYS.forEach(function (k) {
      if (g[k] == null && d.global[k] != null) g[k] = d.global[k];
    });
    return {
      version: 1,
      useGlobal: raw.useGlobal !== false,
      global: g,
      perContact: normalizePerContact(raw.perContact)
    };
  }

  function readState() {
    if (cache) return normalizeState(cache);
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(KEY);
      if (raw != null) {
        cache = normalizeState(raw);
        return cache;
      }
    }
    return normalizeState(null);
  }

  function persist(state) {
    cache = normalizeState(state);
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(KEY, cache).then(function () { return cache; });
    }
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
    return Promise.resolve(cache);
  }

  function whenReady() {
    if (ready) return ready;
    ready = (typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(KEY, null)
      : Promise.resolve(null)
    ).then(function (v) {
      cache = normalizeState(v);
      return cache;
    }).catch(function () {
      cache = defaultState();
      return cache;
    });
    return ready;
  }

  function getState() { return readState(); }

  function saveGlobal(patch) {
    var st = readState();
    var next = Object.assign({}, st.global, patch || {});
    return persist({ useGlobal: st.useGlobal, global: next, perContact: st.perContact });
  }

  function savePerContact(contactId, patch) {
    var cid = String(contactId || '').trim();
    if (!cid) return Promise.resolve(false);
    var st = readState();
    var prev = st.perContact[cid] || { useGlobal: false, settings: {} };
    var row = {
      useGlobal: patch && patch.useGlobal != null ? !!patch.useGlobal : prev.useGlobal,
      settings: Object.assign({}, prev.settings, (patch && patch.settings) || {})
    };
    if (patch && patch.settings) {
      Object.keys(patch.settings).forEach(function (k) {
        if (MANAGED_KEYS.indexOf(k) >= 0) row.settings[k] = patch.settings[k];
      });
    }
    var perContact = Object.assign({}, st.perContact);
    perContact[cid] = row;
    return persist({ useGlobal: st.useGlobal, global: st.global, perContact: perContact });
  }

  function removePerContact(contactId) {
    var cid = String(contactId || '').trim();
    if (!cid) return Promise.resolve();
    var st = readState();
    if (!st.perContact[cid]) return Promise.resolve();
    var perContact = Object.assign({}, st.perContact);
    delete perContact[cid];
    return persist({ useGlobal: st.useGlobal, global: st.global, perContact: perContact });
  }

  /** 是否对该联系人使用全局配置 */
  function contactUsesGlobal(contactId) {
    var st = readState();
    if (!st.useGlobal) return false;
    var cid = String(contactId || '').trim();
    if (!cid) return st.useGlobal;
    var row = st.perContact[cid];
    if (row && row.useGlobal === false) return false;
    return true;
  }

  /** 合并全局/单独配置到 chat settings 对象（浅拷贝后 patch） */
  function applyToChatSettings(base, contactId) {
    var out = Object.assign({}, base || {});
    var st = readState();
    var cid = String(contactId || '').trim();
    var useGlobal = contactUsesGlobal(cid);
    var slice = useGlobal ? st.global : (st.perContact[cid] && st.perContact[cid].settings) || {};
    MANAGED_KEYS.forEach(function (k) {
      if (slice[k] != null) {
        out[k] = typeof slice[k] === 'object' && !Array.isArray(slice[k])
          ? Object.assign({}, out[k] || {}, slice[k])
          : slice[k];
      }
    });
    return out;
  }

  function saveState(patch) {
    var st = readState();
    if (patch && patch.useGlobal != null) st.useGlobal = !!patch.useGlobal;
    if (patch && patch.global) {
      st.global = Object.assign({}, st.global, patch.global);
      if (patch.global.backgroundMessage) {
        st.global.backgroundMessage = Object.assign(
          {},
          st.global.backgroundMessage || {},
          patch.global.backgroundMessage
        );
      }
    }
    if (patch && patch.perContact) st.perContact = patch.perContact;
    return persist(st);
  }

  global.miyaChatGlobalSettings = {
    KEY: KEY,
    MANAGED_KEYS: MANAGED_KEYS,
    whenReady: whenReady,
    getState: getState,
    saveGlobal: saveGlobal,
    saveState: saveState,
    savePerContact: savePerContact,
    removePerContact: removePerContact,
    contactUsesGlobal: contactUsesGlobal,
    applyToChatSettings: applyToChatSettings,
    defaultGlobalSlice: defaultGlobalSlice,
    invalidateCache: function () { cache = null; ready = null; }
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaChatGlobalSettings);
  whenReady();
})(window);
