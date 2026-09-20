(function (global) {
  'use strict';

  var STORE_KEY = 'miya-worldbook-v1';
  var DEFAULT_GROUP_ID = 'grp_default';
  var SCOPES = ['global', 'local'];
  var DEPTHS = ['front', 'middle', 'back'];
  var DEPTH_LABELS = {
    front: '前',
    middle: '中',
    back: '后'
  };
  var GLOBAL_REACHES = ['all', 'online', 'offline', 'online_offline'];
  var GLOBAL_REACH_LABELS = {
    all: '全软件',
    online: '仅线上',
    offline: '仅线下',
    online_offline: '线上线下'
  };

  var _cache = null;
  var _ready = null;

  function nowId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeRoleIds(value) {
    if (!Array.isArray(value)) return [];
    var set = new Set();
    value.forEach(function (item) {
      var v = String(item || '').trim();
      if (v) set.add(v);
    });
    return Array.from(set);
  }

  function normalizeScope(raw) {
    var s = String(raw || '').trim();
    return SCOPES.indexOf(s) >= 0 ? s : 'global';
  }

  function normalizeGlobalReach(raw, scope) {
    var v = String(raw || '').trim();
    if (GLOBAL_REACHES.indexOf(v) >= 0) return v;
    // 旧版局部词条无此字段：等同「全软件」以保持原注入行为
    return normalizeScope(scope) === 'local' ? 'all' : 'online_offline';
  }

  function normalizeDepth(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (DEPTHS.indexOf(v) >= 0) return v;
    if (v === '前' || v === 'before' || v === 'top') return 'front';
    if (v === '后' || v === 'after' || v === 'bottom') return 'back';
    if (v === '中' || v === 'mid' || v === 'default') return 'middle';
    return 'middle';
  }

  function splitKeywords(raw) {
    var matcher = global.miyaWorldbookMatcher;
    if (matcher && typeof matcher.splitKeywordString === 'function') {
      return matcher.splitKeywordString(raw);
    }
    var src = String(raw || '').trim();
    if (!src) return [];
    return src.split(/[,，、;；]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function normalizeGroup(raw, index) {
    var id = String(raw && raw.id ? raw.id : nowId('grp'));
    if (id === DEFAULT_GROUP_ID) {
      return {
        id: DEFAULT_GROUP_ID,
        name: '未分组',
        sort: 0,
        fixed: true
      };
    }
    return {
      id: id,
      name: String((raw && raw.name) || '').trim() || '未命名分组',
      sort: typeof raw.sort === 'number' ? raw.sort : (index + 1) * 10,
      fixed: false
    };
  }

  function normalizeEntry(raw, groupsById) {
    var keywords = [];
    if (Array.isArray(raw && raw.keywords)) keywords = raw.keywords;
    else if (raw && raw.keywords != null && typeof raw.keywords !== 'object') {
      keywords = splitKeywords(String(raw.keywords));
    }
    var ts = Number(raw && raw.updatedAt) || Date.now();
    var groupId = String((raw && raw.groupId) || DEFAULT_GROUP_ID);
    if (!groupsById[groupId]) groupId = DEFAULT_GROUP_ID;
    var scope = normalizeScope(raw && raw.scope);
    return {
      id: String(raw && raw.id ? raw.id : nowId('wb')),
      name: String((raw && raw.name) || '').trim() || '未命名片段',
      keywords: keywords.map(function (k) { return String(k || '').trim(); }).filter(Boolean),
      content: String((raw && raw.content) || ''),
      scope: scope,
      globalReach: normalizeGlobalReach(raw && raw.globalReach, scope),
      depth: normalizeDepth(raw && raw.depth),
      groupId: groupId,
      boundRoleIds: normalizeRoleIds(raw && (raw.boundRoleIds || raw.boundRoles)),
      enabled: !(raw && raw.enabled === false),
      createdAt: Number(raw && raw.createdAt) || ts,
      updatedAt: ts
    };
  }

  function normalizeState(state) {
    var rawGroups = Array.isArray(state && state.groups) ? state.groups : [];
    var groups = rawGroups.map(normalizeGroup).filter(function (g) { return g.id !== DEFAULT_GROUP_ID; });
    groups.unshift(normalizeGroup({ id: DEFAULT_GROUP_ID }));
    groups.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    var groupsById = {};
    groups.forEach(function (g) { groupsById[g.id] = g; });

    var rawEntries = Array.isArray(state && state.entries) ? state.entries : [];
    var entries = rawEntries.map(function (e) { return normalizeEntry(e, groupsById); });
    entries.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return { version: 2, groups: groups, entries: entries };
  }

  function hydrateCacheSync() {
    if (_cache) return _cache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(STORE_KEY);
      if (raw != null) {
        _cache = normalizeState(raw);
        return _cache;
      }
    }
    return null;
  }

  function readState() {
    if (_cache) return normalizeState(_cache);
    var hydrated = hydrateCacheSync();
    if (hydrated) return hydrated;
    return normalizeState({ groups: [], entries: [] });
  }

  function persist(state) {
    var normalized = normalizeState(state);
    _cache = normalized;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(STORE_KEY, normalized).then(function () { return normalized; });
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
    } catch (e) {}
    return Promise.resolve(normalized);
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = (typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(STORE_KEY, { entries: [] })
      : Promise.resolve({ entries: [] })
    ).then(function (v) {
      _cache = normalizeState(v && typeof v === 'object' ? v : { entries: [] });
      return _cache;
    }).catch(function () {
      _cache = normalizeState({ entries: [] });
      return _cache;
    });
    return _ready;
  }

  function listGroups() {
    return readState().groups.slice();
  }

  function listEntries() {
    return readState().entries.slice();
  }

  function getGroup(groupId) {
    var id = String(groupId || '');
    return listGroups().filter(function (g) { return g.id === id; })[0] || null;
  }

  function getEntry(entryId) {
    var id = String(entryId || '');
    return listEntries().filter(function (e) { return e.id === id; })[0] || null;
  }

  function upsertGroup(payload) {
    var st = readState();
    var next = normalizeGroup(payload || {}, st.groups.length);
    if (next.id === DEFAULT_GROUP_ID) return Promise.resolve(st.groups[0]);
    var idx = st.groups.findIndex(function (x) { return x.id === next.id; });
    if (idx >= 0) st.groups[idx] = next;
    else st.groups.push(next);
    return persist(st).then(function () { return next; });
  }

  function removeGroup(groupId) {
    var targetId = String(groupId || '');
    if (!targetId || targetId === DEFAULT_GROUP_ID) return Promise.resolve(false);
    var st = readState();
    st.groups = st.groups.filter(function (g) { return g.id !== targetId; });
    st.entries = st.entries.map(function (e) {
      if (e.groupId === targetId) e.groupId = DEFAULT_GROUP_ID;
      return e;
    });
    return persist(st).then(function () { return true; });
  }

  function upsertEntry(payload) {
    var st = readState();
    var groupsById = {};
    st.groups.forEach(function (g) { groupsById[g.id] = g; });
    var next = normalizeEntry(payload || {}, groupsById);
    next.updatedAt = Date.now();
    var idx = st.entries.findIndex(function (x) { return x.id === next.id; });
    if (idx >= 0) {
      next.createdAt = st.entries[idx].createdAt || next.createdAt;
      st.entries[idx] = next;
    } else {
      st.entries.unshift(next);
    }
    return persist(st).then(function () { return next; });
  }

  function removeEntry(entryId) {
    var st = readState();
    st.entries = st.entries.filter(function (e) { return e.id !== String(entryId || ''); });
    return persist(st);
  }

  function toggleEntryEnabled(entryId, enabled) {
    var st = readState();
    var target = st.entries.filter(function (e) { return e.id === String(entryId || ''); })[0];
    if (!target) return Promise.resolve(null);
    target.enabled = !!enabled;
    target.updatedAt = Date.now();
    return persist(st).then(function () { return target; });
  }

  function resolveAvailableRoles() {
    var map = {};
    var cs = global.miyaContactsStore;
    if (cs && typeof cs.resolveRolesForWorldbook === 'function') {
      cs.resolveRolesForWorldbook().forEach(function (row) {
        if (!row || !row.roleId) return;
        map[row.roleId] = {
          roleId: row.roleId,
          roleName: row.roleName || row.roleId,
          source: row.source || 'contacts',
          avatar: row.avatar || ''
        };
      });
    }
    listEntries().forEach(function (e) {
      (e.boundRoleIds || []).forEach(function (id) {
        if (!map[id]) map[id] = { roleId: id, roleName: id, source: 'custom', avatar: '' };
      });
    });
    return Object.keys(map)
      .sort(function (a, b) {
        var sa = map[a].source === 'contacts' ? 0 : 1;
        var sb = map[b].source === 'contacts' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return String(map[a].roleName).localeCompare(String(map[b].roleName), 'zh');
      })
      .map(function (id) { return map[id]; });
  }

  global.miyaWorldbookStore = {
    STORE_KEY: STORE_KEY,
    DEFAULT_GROUP_ID: DEFAULT_GROUP_ID,
    SCOPES: SCOPES.slice(),
    DEPTHS: DEPTHS.slice(),
    DEPTH_LABELS: Object.assign({}, DEPTH_LABELS),
    GLOBAL_REACHES: GLOBAL_REACHES.slice(),
    GLOBAL_REACH_LABELS: Object.assign({}, GLOBAL_REACH_LABELS),
    normalizeGlobalReach: normalizeGlobalReach,
    normalizeDepth: normalizeDepth,
    whenReady: whenReady,
    getState: readState,
    listGroups: listGroups,
    listEntries: listEntries,
    getGroup: getGroup,
    getEntry: getEntry,
    upsertGroup: upsertGroup,
    removeGroup: removeGroup,
    upsertEntry: upsertEntry,
    removeEntry: removeEntry,
    toggleEntryEnabled: toggleEntryEnabled,
    resolveAvailableRoles: resolveAvailableRoles,
    invalidateCache: function () { _cache = null; _ready = null; }
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaWorldbookStore);
  whenReady();
})(window);
