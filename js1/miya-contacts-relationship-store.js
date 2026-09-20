(function (global) {
  'use strict';

  var STORE_KEY = 'miya-contacts-relationships';
  var _cache = null;
  var _ready = null;

  function canonicalPair(idA, idB) {
    var a = String(idA || '').trim();
    var b = String(idB || '').trim();
    if (!a || !b || a === b) return null;
    if (a > b) { var t = a; a = b; b = t; }
    return { aId: a, bId: b };
  }

  function pairKey(idA, idB, groupId) {
    var p = canonicalPair(idA, idB);
    var gid = String(groupId || '').trim();
    return p && gid ? gid + '|' + p.aId + '↔' + p.bId : '';
  }

  function contactsStore() { return global.miyaContactsStore; }

  function inferGroupIdForPair(aId, bId) {
    var cs = contactsStore();
    if (!cs || typeof cs.findCharacter !== 'function') return '';
    var a = cs.findCharacter(aId);
    var b = cs.findCharacter(bId);
    if (!a || !b) return String((a && a.groupId) || (b && b.groupId) || '').trim();
    if (a.groupId === b.groupId) return String(a.groupId || '').trim();
    return '';
  }

  function charactersShareGroup(idA, idB, groupId) {
    var cs = contactsStore();
    if (!cs || typeof cs.getState !== 'function') return false;
    var gid = String(groupId || '').trim();
    if (!gid) return false;
    function row(id) {
      return cs.findCharacter(id);
    }
    var a = row(idA);
    var b = row(idB);
    if (!a || !b) return false;
    return a.groupId === gid && b.groupId === gid;
  }

  function normalizeEdge(raw) {
    var relation = String((raw && raw.relation) || '').trim();
    if (!relation) return null;
    var pair = raw && raw.aId && raw.bId ? canonicalPair(raw.aId, raw.bId) : null;
    if (!pair) return null;
    var groupId = String((raw && raw.groupId) || '').trim() || inferGroupIdForPair(pair.aId, pair.bId);
    if (!groupId) return null;
    return {
      aId: pair.aId,
      bId: pair.bId,
      groupId: groupId,
      relation: relation,
      updatedAt: Number(raw && raw.updatedAt) || Date.now()
    };
  }

  function normalizeState(raw) {
    var arr = Array.isArray(raw) ? raw : Array.isArray(raw && raw.edges) ? raw.edges : [];
    var byPair = {};
    arr.forEach(function (row) {
      var e = normalizeEdge(row);
      if (!e) return;
      var k = pairKey(e.aId, e.bId, e.groupId);
      var prev = byPair[k];
      if (!prev || (e.updatedAt || 0) >= (prev.updatedAt || 0)) byPair[k] = e;
    });
    var edges = Object.keys(byPair).map(function (k) { return byPair[k]; });
    edges.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return { edges: edges };
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
    return normalizeState({ edges: [] });
  }

  function persist(state) {
    var normalized = normalizeState(state);
    _cache = normalized;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(STORE_KEY, normalized.edges).then(function () { return normalized; });
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(normalized.edges)); } catch (e) {}
    return Promise.resolve(normalized);
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = (typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(STORE_KEY, [])
      : Promise.resolve([])
    ).then(function (v) {
      _cache = normalizeState(v);
      return _cache;
    }).catch(function () {
      _cache = normalizeState({ edges: [] });
      return _cache;
    });
    return _ready;
  }

  function getState() { return readState(); }

  function findEdge(idA, idB, groupId) {
    var k = pairKey(idA, idB, groupId);
    if (!k) return null;
    return getState().edges.find(function (e) { return pairKey(e.aId, e.bId, e.groupId) === k; }) || null;
  }

  function getRelation(idA, idB, groupId) {
    var gid = String(groupId || '').trim() || inferGroupIdForPair(idA, idB);
    var hit = findEdge(idA, idB, gid);
    return hit ? hit.relation : '';
  }

  function setRelation(idA, idB, relation, groupId) {
    var pair = canonicalPair(idA, idB);
    if (!pair) return Promise.resolve(false);
    var gid = String(groupId || '').trim() || inferGroupIdForPair(pair.aId, pair.bId);
    if (!gid || !charactersShareGroup(pair.aId, pair.bId, gid)) return Promise.resolve(false);
    var st = readState();
    var rel = String(relation || '').trim();
    var k = pairKey(pair.aId, pair.bId, gid);
    var idx = st.edges.findIndex(function (e) { return pairKey(e.aId, e.bId, e.groupId) === k; });
    if (!rel) {
      if (idx >= 0) st.edges.splice(idx, 1);
    } else if (idx >= 0) {
      st.edges[idx] = { aId: pair.aId, bId: pair.bId, groupId: gid, relation: rel, updatedAt: Date.now() };
    } else {
      st.edges.unshift({ aId: pair.aId, bId: pair.bId, groupId: gid, relation: rel, updatedAt: Date.now() });
    }
    return persist(st).then(function () { return true; });
  }

  function listRelationsForCharacter(characterId) {
    var cs = contactsStore();
    var id = String(characterId || '').trim();
    if (!id || !cs) return [];
    var selfRow = cs.findCharacter(id);
    var gid = selfRow ? String(selfRow.groupId || '').trim() : '';
    if (!gid) return [];
    return getState().edges.filter(function (e) {
      if (e.groupId !== gid) return false;
      if (e.aId !== id && e.bId !== id) return false;
      var otherId = e.aId === id ? e.bId : e.aId;
      return charactersShareGroup(id, otherId, gid);
    }).map(function (e) {
      return { toId: e.aId === id ? e.bId : e.aId, relation: e.relation, groupId: e.groupId };
    });
  }

  function purgeCharacter(characterId) {
    var id = String(characterId || '').trim();
    if (!id) return Promise.resolve();
    var st = readState();
    st.edges = st.edges.filter(function (e) { return e.aId !== id && e.bId !== id; });
    return persist(st);
  }

  function buildPromptBlockForCharacterId(characterId) {
    var cs = contactsStore();
    var fromId = String(characterId || '').trim();
    if (!fromId || !cs) return '';
    var selfRow = cs.findCharacter(fromId);
    if (!selfRow) return '';
    var edges = listRelationsForCharacter(fromId);
    if (!edges.length) return '';
    var lines = edges.map(function (e) {
      var target = cs.findCharacter(e.toId);
      var name = String((target && target.name) || '').trim();
      if (!name) return '';
      return '- 与「' + name + '」：' + e.relation;
    }).filter(Boolean);
    if (!lines.length) return '';
    var roleName = String(selfRow.name || '该角色').trim() || '该角色';
    return '【人际脉络·档案】\n以下为「' + roleName + '」在同卷内与其他角色的关系。\n' + lines.join('\n');
  }

  global.miyaContactsRelationshipStore = {
    STORE_KEY: STORE_KEY,
    whenReady: whenReady,
    getState: getState,
    getRelation: getRelation,
    setRelation: setRelation,
    listRelationsForCharacter: listRelationsForCharacter,
    purgeCharacter: purgeCharacter,
    buildPromptBlockForCharacterId: buildPromptBlockForCharacterId,
    charactersShareGroup: charactersShareGroup,
    invalidateCache: function () { _cache = null; _ready = null; }
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaContactsRelationshipStore);
  whenReady();
})(window);
