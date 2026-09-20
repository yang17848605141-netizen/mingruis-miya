(function (global) {
  'use strict';

  var STORE_KEY = 'miya-contacts-v1';
  var DEFAULT_GROUP_ID = 'ct_default';
  var _cache = null;
  var _ready = null;
  var _wbCountMap = null;

  function invalidateWbCountMap() {
    _wbCountMap = null;
  }

  function buildWbCountMap() {
    if (_wbCountMap) return _wbCountMap;
    var map = Object.create(null);
    var wb = global.miyaWorldbookStore;
    if (wb && typeof wb.listEntries === 'function') {
      wb.listEntries().forEach(function (e) {
        (Array.isArray(e.boundRoleIds) ? e.boundRoleIds : []).forEach(function (bid) {
          var key = String(bid || '').trim();
          if (key) map[key] = (map[key] || 0) + 1;
        });
      });
    }
    _wbCountMap = map;
    return map;
  }

  function nowId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeGroup(raw, index) {
    var id = String(raw && raw.id ? raw.id : nowId('ctg'));
    if (id === DEFAULT_GROUP_ID) {
      return { id: DEFAULT_GROUP_ID, name: '未归档', sort: 0, fixed: true };
    }
    return {
      id: id,
      name: String((raw && raw.name) || '').trim() || '未命名卷',
      sort: typeof raw.sort === 'number' ? raw.sort : (index + 1) * 10,
      fixed: false
    };
  }

  function buildPersona(raw) {
    var persona = String((raw && raw.persona) || '').trim();
    if (persona) return persona;
    if (!raw) return '';
    if (raw.unified) return String(raw.unified).trim();
    var parts = [raw.background, raw.personality, raw.relationships, raw.other,
      raw.description, raw.scenario, raw.system_prompt]
      .map(function (x) { return String(x || '').trim(); })
      .filter(Boolean);
    return parts.join('\n\n');
  }

  function normalizeCharacter(raw, groupsById) {
    var gid = String((raw && raw.groupId) || '').trim();
    if (!gid || !groupsById[gid]) gid = DEFAULT_GROUP_ID;
    var id = String(raw && raw.id ? raw.id : nowId('ct'));
    return {
      id: id,
      characterId: String((raw && raw.characterId) || id).trim() || id,
      groupId: gid,
      name: String((raw && raw.name) || '').trim(),
      avatar: String((raw && raw.avatar) || ''),
      age: String((raw && raw.age) != null ? raw.age : '').trim(),
      gender: String((raw && raw.gender) || '').trim(),
      birthday: String((raw && raw.birthday) || '').trim(),
      persona: buildPersona(raw),
      tags: Array.isArray(raw && raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
      updatedAt: Number(raw && raw.updatedAt) || Date.now()
    };
  }

  function normalizeState(state) {
    var rawGroups = Array.isArray(state && state.groups) ? state.groups : [];
    var groups = rawGroups.map(normalizeGroup).filter(function (g) { return g.id !== DEFAULT_GROUP_ID; });
    groups.unshift(normalizeGroup({ id: DEFAULT_GROUP_ID }));
    groups.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    var groupsById = {};
    groups.forEach(function (g) { groupsById[g.id] = g; });

    var chars = (Array.isArray(state && state.characters) ? state.characters : [])
      .map(function (row) { return normalizeCharacter(row, groupsById); });
    chars.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return { version: 1, groups: groups, characters: chars };
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
    return normalizeState({ groups: [], characters: [] });
  }

  function persist(state) {
    var normalized = normalizeState(state);
    _cache = normalized;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(STORE_KEY, normalized).then(function () { return normalized; });
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(normalized)); } catch (e) {}
    return Promise.resolve(normalized);
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = (typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(STORE_KEY, { groups: [], characters: [] })
      : Promise.resolve({ groups: [], characters: [] })
    ).then(function (v) {
      _cache = normalizeState(v && typeof v === 'object' ? v : { groups: [], characters: [] });
      return _cache;
    }).catch(function () {
      _cache = normalizeState({ groups: [], characters: [] });
      return _cache;
    });
    return _ready;
  }

  function listGroups() { return readState().groups.slice(); }

  function listCharacters(groupId) {
    var rows = readState().characters;
    if (!groupId || groupId === 'all') return rows.slice();
    return rows.filter(function (c) { return c.groupId === String(groupId); });
  }

  function findCharacter(id) {
    var key = String(id || '').trim();
    return readState().characters.find(function (c) {
      return c.id === key || c.characterId === key;
    }) || null;
  }

  function getGroup(groupId) {
    return listGroups().filter(function (g) { return g.id === String(groupId || ''); })[0] || null;
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
    st.characters = st.characters.map(function (c) {
      if (c.groupId === targetId) c.groupId = DEFAULT_GROUP_ID;
      return c;
    });
    return persist(st).then(function () { return true; });
  }

  function upsertCharacter(payload) {
    var st = readState();
    var groupsById = {};
    st.groups.forEach(function (g) { groupsById[g.id] = g; });
    var body = Object.assign({}, payload || {}, { updatedAt: Date.now() });
    if (body.newGroupName) {
      return upsertGroup({ name: body.newGroupName, sort: Date.now() }).then(function (g) {
        body.groupId = g.id;
        delete body.newGroupName;
        return upsertCharacter(body);
      });
    }
    var next = normalizeCharacter(body, groupsById);
    if (!next.name) return Promise.resolve({ error: '请填写姓名' });
    var idx = st.characters.findIndex(function (c) { return c.id === next.id; });
    if (idx >= 0) st.characters[idx] = next;
    else st.characters.unshift(next);
    return persist(st).then(function () { return next; });
  }

  function removeCharacter(id) {
    var st = readState();
    var key = String(id || '');
    var removed = st.characters.filter(function (c) {
      return c.id === key || c.characterId === key;
    });
    st.characters = st.characters.filter(function (c) {
      return c.id !== key && c.characterId !== key;
    });
    return persist(st).then(function () {
      var rs = global.miyaContactsRelationshipStore;
      if (rs && typeof rs.purgeCharacter === 'function') {
        removed.forEach(function (c) {
          rs.purgeCharacter(c.id);
          if (c.characterId && c.characterId !== c.id) rs.purgeCharacter(c.characterId);
        });
      }
      return true;
    });
  }

  function countWorldbookBindings(characterId) {
    var row = findCharacter(characterId);
    if (!row) return 0;
    var map = buildWbCountMap();
    var total = 0;
    [row.id, row.characterId].filter(Boolean).forEach(function (id) {
      total += map[id] || 0;
    });
    return total;
  }

  function countWorldbookBindingsMap(characterIds) {
    var map = buildWbCountMap();
    var out = Object.create(null);
    (characterIds || []).forEach(function (characterId) {
      var row = findCharacter(characterId);
      if (!row) {
        out[characterId] = 0;
        return;
      }
      var total = 0;
      [row.id, row.characterId].filter(Boolean).forEach(function (id) {
        total += map[id] || 0;
      });
      out[characterId] = total;
    });
    return out;
  }

  function resolveRolesForWorldbook() {
    var out = [];
    var seen = {};
    listCharacters().forEach(function (c) {
      [c.characterId, c.id].forEach(function (rid) {
        rid = String(rid || '').trim();
        if (!rid || seen[rid]) return;
        seen[rid] = true;
        out.push({
          roleId: rid,
          roleName: c.name || rid,
          source: 'contacts',
          groupId: c.groupId,
          avatar: c.avatar || ''
        });
      });
    });
    return out;
  }

  function renderChronicleBlock(roleId) {
    var row = findCharacter(roleId);
    if (!row || !row.name) return '';
    var lines = ['【角色·档案·' + String(row.name) + '】'];
    if (row.gender) lines.push('- 性别: ' + row.gender);
    if (row.age) lines.push('- 年龄: ' + row.age);
    if (row.birthday) lines.push('- 生日: ' + row.birthday);
    if (row.persona) lines.push('- 人设与背景: ' + row.persona);
    return lines.length > 1 ? lines.join('\n') : '';
  }

  global.miyaContactsStore = {
    STORE_KEY: STORE_KEY,
    DEFAULT_GROUP_ID: DEFAULT_GROUP_ID,
    whenReady: whenReady,
    getState: readState,
    listGroups: listGroups,
    listCharacters: listCharacters,
    findCharacter: findCharacter,
    getGroup: getGroup,
    upsertGroup: upsertGroup,
    removeGroup: removeGroup,
    upsertCharacter: upsertCharacter,
    removeCharacter: removeCharacter,
    countWorldbookBindings: countWorldbookBindings,
    countWorldbookBindingsMap: countWorldbookBindingsMap,
    invalidateWbCountMap: invalidateWbCountMap,
    resolveRolesForWorldbook: resolveRolesForWorldbook,
    renderChronicleBlock: renderChronicleBlock,
    invalidateCache: function () { _cache = null; _ready = null; invalidateWbCountMap(); }
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaContactsStore);
  whenReady();
})(window);
