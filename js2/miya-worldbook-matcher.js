(function (global) {
  'use strict';

  function splitKeywordString(raw) {
    var src = String(raw || '').trim();
    if (!src) return [];
    return src.split(/[,，、;；]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function includesKeyword(text, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) return true;
    var source = String(text || '').toLowerCase();
    return keywords.some(function (kw) {
      var k = String(kw || '').trim().toLowerCase();
      return !!k && source.indexOf(k) >= 0;
    });
  }

  function expandRoleAliases(roleId) {
    var set = {};
    function add(v) {
      v = String(v || '').trim();
      if (v) set[v] = true;
    }
    add(roleId);
    var cs = global.miyaContactsStore;
    if (cs && typeof cs.findCharacter === 'function') {
      var row = cs.findCharacter(roleId);
      if (row) {
        add(row.id);
        add(row.characterId);
      }
    }
    return Object.keys(set);
  }

  function collectCfgRoleIds(cfg) {
    var out = [];
    var seen = {};
    function push(v) {
      v = String(v || '').trim();
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    }
    if (Array.isArray(cfg && cfg.roleIds)) {
      cfg.roleIds.forEach(push);
    }
    push(cfg && cfg.roleId);
    return out;
  }

  function getEntryGlobalReach(entry) {
    if (!entry) return '';
    var wb = global.miyaWorldbookStore;
    if (wb && typeof wb.normalizeGlobalReach === 'function') {
      return wb.normalizeGlobalReach(entry.globalReach, entry.scope);
    }
    var v = String(entry.globalReach || '').trim();
    if (v) return v;
    return String(entry.scope) === 'local' ? 'all' : 'online_offline';
  }

  function globalReachApplies(reach, promptContext) {
    var ctx = String(promptContext || '').trim();
    if (!reach || reach === 'all' || !ctx) return false;
    if (ctx === 'online') return reach === 'online' || reach === 'online_offline';
    if (ctx === 'offline') return reach === 'offline' || reach === 'online_offline';
    return false;
  }

  /** force 注入时是否仍受生效范围约束（全软件 / 无 context 不拦截） */
  function forceReachAllows(reach, promptContext) {
    var r = String(reach || '').trim();
    if (!r || r === 'all') return true;
    var ctx = String(promptContext || '').trim();
    if (!ctx) return true;
    return globalReachApplies(r, ctx);
  }

  function roleMatches(entry, cfg) {
    var bound = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
    if (!bound.length) return true;
    var roleIds = collectCfgRoleIds(cfg);
    if (!roleIds.length) return false;

    var contactAliases = [];
    roleIds.forEach(function (rid) {
      expandRoleAliases(rid).forEach(function (alias) {
        if (contactAliases.indexOf(alias) < 0) contactAliases.push(alias);
      });
    });

    return bound.some(function (bid) {
      return expandRoleAliases(bid).some(function (alias) {
        return contactAliases.indexOf(alias) >= 0;
      });
    });
  }

  function matchEntry(entry, cfg) {
    if (!entry || entry.enabled === false) return false;
    var contextText = String(cfg.contextText || '');
    var scope = String(entry.scope || 'global');
    var promptContext = String(cfg.promptContext || '').trim();
    var reach = getEntryGlobalReach(entry);
    if (scope === 'local') {
      if (!roleMatches(entry, cfg)) return false;
      // 局部·全软件：绑定角色后任意场景注入（不依赖关键词 / promptContext）
      if (reach === 'all') return true;
      if (promptContext && reach && !globalReachApplies(reach, promptContext)) return false;
      var bound = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
      var localKeywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [];
      if (bound.length && !localKeywords.length) return true;
      return includesKeyword(contextText, entry.keywords || []);
    }
    if (reach === 'all') return false;
    if (promptContext && reach && !globalReachApplies(reach, promptContext)) return false;
    return includesKeyword(contextText, entry.keywords || []);
  }

  function matchEntries(input) {
    var cfg = input && typeof input === 'object' ? input : {};
    var entries = Array.isArray(cfg.entries) ? cfg.entries : [];
    var matched = entries.filter(function (entry) { return matchEntry(entry, cfg); });
    var globalRows = [];
    var localRows = [];
    matched.forEach(function (entry) {
      if (String(entry.scope) === 'local') localRows.push(entry);
      else globalRows.push(entry);
    });
    return {
      matched: matched,
      global: globalRows,
      local: localRows
    };
  }

  function collectUniversalGlobalEntries(entries) {
    return (entries || []).filter(function (entry) {
      return entry && entry.enabled !== false && String(entry.scope) !== 'local' &&
        getEntryGlobalReach(entry) === 'all';
    });
  }

  function collectReachGlobalEntries(entries, promptContext) {
    var ctx = String(promptContext || '').trim();
    if (!ctx) return [];
    return (entries || []).filter(function (entry) {
      if (!entry || entry.enabled === false || String(entry.scope) === 'local') return false;
      return globalReachApplies(getEntryGlobalReach(entry), ctx);
    });
  }

  global.miyaWorldbookMatcher = {
    splitKeywordString: splitKeywordString,
    includesKeyword: includesKeyword,
    expandRoleAliases: expandRoleAliases,
    matchEntries: matchEntries,
    matchEntry: matchEntry,
    roleMatches: roleMatches,
    getEntryGlobalReach: getEntryGlobalReach,
    globalReachApplies: globalReachApplies,
    forceReachAllows: forceReachAllows,
    collectUniversalGlobalEntries: collectUniversalGlobalEntries,
    collectReachGlobalEntries: collectReachGlobalEntries
  };
})(window);
