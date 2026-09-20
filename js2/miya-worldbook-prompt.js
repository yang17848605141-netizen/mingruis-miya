(function (global) {
  'use strict';

  function normalizeDepth(raw) {
    var wb = global.miyaWorldbookStore;
    if (wb && typeof wb.normalizeDepth === 'function') {
      return wb.normalizeDepth(raw);
    }
    var v = String(raw || '').trim().toLowerCase();
    if (v === 'front' || v === '前') return 'front';
    if (v === 'back' || v === '后') return 'back';
    return 'middle';
  }

  function depthTitle(depth) {
    if (depth === 'front') return '世界书·前';
    if (depth === 'back') return '世界书·后';
    return '世界书·中';
  }

  function renderBlock(title, entries) {
    if (!entries || !entries.length) return '';
    var lines = ['【' + title + '】'];
    entries.forEach(function (entry) {
      var name = String(entry.name || '').trim() || '未命名片段';
      var content = String(entry.content || '').trim();
      if (!content) return;
      lines.push('- ' + name + ': ' + content);
    });
    return lines.length > 1 ? lines.join('\n') : '';
  }

  function summarizeMatched(entries) {
    return (entries || []).map(function (entry) {
      var keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [];
      var content = String(entry.content || '');
      return {
        id: String(entry.id || ''),
        name: String(entry.name || '').trim() || '未命名片段',
        scope: String(entry.scope || 'global'),
        depth: normalizeDepth(entry && entry.depth),
        keywordCount: keywords.length,
        charCount: content.trim() ? content.length : 0
      };
    });
  }

  function applyEntryOrder(merged, orderIds) {
    if (!Array.isArray(merged) || !merged.length) {
      return { ordered: [], rest: merged || [] };
    }
    if (!Array.isArray(orderIds) || !orderIds.length) {
      return { ordered: [], rest: merged.slice() };
    }
    var rank = {};
    var inOrder = {};
    orderIds.forEach(function (id, i) {
      id = String(id || '').trim();
      if (!id) return;
      rank[id] = i;
      inOrder[id] = true;
    });
    if (!Object.keys(rank).length) {
      return { ordered: [], rest: merged.slice() };
    }

    var ordered = [];
    merged.forEach(function (entry) {
      if (!entry || !entry.id || inOrder[String(entry.id)] === undefined) return;
      ordered.push(entry);
    });
    ordered.sort(function (a, b) {
      return rank[String(a.id)] - rank[String(b.id)];
    });

    var rest = merged.filter(function (entry) {
      return !entry || !entry.id || inOrder[String(entry.id)] === undefined;
    });
    return { ordered: ordered, rest: rest };
  }

  function mergeForcedMatches(input) {
    var cfg = input && typeof input === 'object' ? input : {};
    var matched = Array.isArray(cfg.matched) ? cfg.matched.slice() : [];
    var entries = Array.isArray(cfg.entries) ? cfg.entries : [];
    var bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
    var forcedIds = Array.isArray(cfg.forcedEntryIds) ? cfg.forcedEntryIds : [];
    var contextText = String(cfg.contextText || '');
    var matcher = global.miyaWorldbookMatcher;
    var entryMap = {};
    entries.forEach(function (entry) {
      if (entry && entry.id) entryMap[String(entry.id)] = entry;
    });
    var exists = {};
    matched.forEach(function (entry) {
      if (entry && entry.id) exists[String(entry.id)] = true;
    });

    function pushIfNeeded(entry) {
      if (!entry || entry.enabled === false || !entry.id) return;
      var id = String(entry.id);
      if (exists[id]) return;
      if (matcher && typeof matcher.matchEntry === 'function') {
        if (!matcher.matchEntry(entry, {
          roleId: cfg.roleId,
          roleIds: cfg.roleIds,
          contextText: contextText,
          promptContext: cfg.promptContext
        })) return;
      }
      exists[id] = true;
      matched.push(entry);
    }

    function allowForcedReach(entry) {
      if (!matcher) return true;
      var reach = typeof matcher.getEntryGlobalReach === 'function'
        ? matcher.getEntryGlobalReach(entry)
        : '';
      if (typeof matcher.forceReachAllows === 'function') {
        return matcher.forceReachAllows(reach, cfg.promptContext);
      }
      return true;
    }

    bindings.forEach(function (binding) {
      if (!binding || typeof binding !== 'object') return;
      if (String(binding.type || '').trim() !== 'entry') return;
      var entry = entryMap[String(binding.entryId || binding.id || '').trim()];
      if (!entry || entry.enabled === false || !entry.id) return;
      if (binding.force) {
        if (!allowForcedReach(entry)) return;
        var fid = String(entry.id);
        if (exists[fid]) return;
        exists[fid] = true;
        matched.push(entry);
        return;
      }
      pushIfNeeded(entry);
    });

    forcedIds.forEach(function (id) {
      var entry = entryMap[String(id || '').trim()];
      if (!entry || entry.enabled === false || !entry.id || exists[String(entry.id)]) return;
      if (matcher && typeof matcher.matchEntry === 'function') {
        if (!matcher.matchEntry(entry, {
          roleId: cfg.roleId,
          roleIds: cfg.roleIds,
          contextText: contextText,
          promptContext: cfg.promptContext
        })) return;
      }
      exists[String(entry.id)] = true;
      matched.push(entry);
    });
    return matched;
  }

  function renderChronicleProfile(roleId) {
    var cs = global.miyaContactsStore;
    if (cs && typeof cs.renderChronicleBlock === 'function') {
      return cs.renderChronicleBlock(roleId);
    }
    return '';
  }

  function renderRelationshipBlock(roleId) {
    var rs = global.miyaContactsRelationshipStore;
    if (rs && typeof rs.buildPromptBlockForCharacterId === 'function') {
      return rs.buildPromptBlockForCharacterId(roleId);
    }
    return '';
  }

  /** 同一深度内：角色绑定排序 → 全软件 → 全局 → 局部 */
  function renderDepthSection(depth, rows, entryOrder, universalIdSet) {
    if (!rows || !rows.length) return '';
    var prefix = depthTitle(depth);
    var split = applyEntryOrder(rows, entryOrder);
    var orderedBlock = split.ordered.length
      ? renderBlock(prefix + '·设定', split.ordered)
      : '';
    var universalRows = [];
    var globalRows = [];
    var localRows = [];
    split.rest.forEach(function (entry) {
      if (!entry) return;
      var id = String(entry.id || '');
      if (universalIdSet && universalIdSet[id]) {
        universalRows.push(entry);
      } else if (String(entry.scope) === 'local') {
        localRows.push(entry);
      } else {
        globalRows.push(entry);
      }
    });
    return [
      orderedBlock,
      renderBlock(prefix + '·全软件设定', universalRows),
      renderBlock(prefix + '·全局设定', globalRows),
      renderBlock(prefix + '·局部设定', localRows)
    ].filter(Boolean).join('\n\n');
  }

  function partitionByDepth(entries) {
    var buckets = { front: [], middle: [], back: [] };
    (entries || []).forEach(function (entry) {
      if (!entry) return;
      var d = normalizeDepth(entry.depth);
      buckets[d].push(entry);
    });
    return buckets;
  }

  function buildWorldbookPrompt(input) {
    var cfg = input && typeof input === 'object' ? input : {};
    var store = global.miyaWorldbookStore;
    var matcher = global.miyaWorldbookMatcher;
    if (!store || typeof store.listEntries !== 'function') {
      return { text: '', sections: {}, matched: [], matchedSummary: [] };
    }

    var entries = store.listEntries();
    var scopeMode = String(cfg.scopeMode || '').trim();
    var promptContext = String(cfg.promptContext || '').trim();
    var universalOnly = cfg.universalOnly === true;
    var excludeSet = {};
    (Array.isArray(cfg.excludeEntryIds) ? cfg.excludeEntryIds : []).forEach(function (id) {
      var key = String(id || '').trim();
      if (key) excludeSet[key] = true;
    });
    function notExcluded(entry) {
      return entry && entry.id && !excludeSet[String(entry.id)];
    }
    var matchPool = entries;
    if (scopeMode === 'appointment') {
      matchPool = entries.filter(function (entry) {
        var roles = Array.isArray(entry && entry.boundRoleIds) ? entry.boundRoleIds : [];
        return roles.length > 0;
      });
    }
    var roleIds = Array.isArray(cfg.roleIds)
      ? cfg.roleIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];
    var roleId = String(cfg.roleId || '').trim();
    if (!roleIds.length && roleId) roleIds = [roleId];
    if (!roleId && roleIds.length) roleId = roleIds[0];
    var contextText = String(cfg.contextText || '');

    var universalRows = matcher && typeof matcher.collectUniversalGlobalEntries === 'function'
      ? matcher.collectUniversalGlobalEntries(entries).filter(notExcluded)
      : [];
    var universalIdSet = {};
    universalRows.forEach(function (entry) {
      if (entry && entry.id) universalIdSet[String(entry.id)] = true;
    });
    var universalBlock = renderBlock('全软件·全局设定', universalRows);

    if (universalOnly) {
      return {
        text: universalBlock,
        sections: { universal: universalBlock },
        matched: universalRows,
        matchedSummary: summarizeMatched(universalRows),
        globalCount: 0,
        localCount: 0,
        universalCount: universalRows.length
      };
    }

    var excludeFromKeyword = {};
    universalRows.forEach(function (entry) {
      if (entry && entry.id) excludeFromKeyword[String(entry.id)] = true;
    });
    var keywordPool = matchPool.filter(function (entry) {
      return entry && entry.id && !excludeFromKeyword[String(entry.id)] && notExcluded(entry);
    });

    var includeProfile = cfg.skipChronicleProfile !== true && cfg.layersOnly !== true;
    var profileBlock = includeProfile ? renderChronicleProfile(roleId) : '';
    var relationBlock = includeProfile ? renderRelationshipBlock(roleId) : '';
    var keywordMatched = matcher && typeof matcher.matchEntries === 'function'
      ? matcher.matchEntries({
          roleId: roleId,
          roleIds: roleIds,
          contextText: contextText,
          promptContext: promptContext,
          entries: keywordPool
        })
      : { matched: [], global: [], local: [] };

    var merged = mergeForcedMatches({
      matched: (keywordMatched.matched || []).filter(notExcluded),
      entries: entries,
      bindings: Array.isArray(cfg.extraBindings) ? cfg.extraBindings : [],
      forcedEntryIds: cfg.forcedEntryIds || cfg.entryIds || [],
      contextText: contextText,
      roleId: roleId,
      roleIds: roleIds,
      promptContext: promptContext
    }).filter(notExcluded);

    // 全软件词条仍始终纳入匹配，但按各自 depth 注入，不再强制顶置
    universalRows.forEach(function (entry) {
      if (!entry || !entry.id) return;
      var id = String(entry.id);
      if (merged.some(function (m) { return m && String(m.id) === id; })) return;
      merged.push(entry);
    });

    var entryOrder = Array.isArray(cfg.entryOrder)
      ? cfg.entryOrder.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];

    var buckets = partitionByDepth(merged);
    var frontBlock = renderDepthSection('front', buckets.front, entryOrder, universalIdSet);
    var middleBlock = renderDepthSection('middle', buckets.middle, entryOrder, universalIdSet);
    var backBlock = renderDepthSection('back', buckets.back, entryOrder, universalIdSet);

    // 兼容旧字段：未按深度拆分时的合集视图
    var legacySplit = applyEntryOrder(merged, entryOrder);
    var orderedBlock = legacySplit.ordered.length
      ? renderBlock('设定', legacySplit.ordered)
      : '';
    var globalRows = [];
    var localRows = [];
    legacySplit.rest.forEach(function (entry) {
      if (String(entry.scope) === 'local') localRows.push(entry);
      else globalRows.push(entry);
    });
    var globalBlock = renderBlock('全局设定', globalRows);
    var localBlock = renderBlock('局部设定', localRows);

    var joined = [
      profileBlock,
      relationBlock,
      frontBlock,
      middleBlock,
      backBlock
    ].filter(Boolean).join('\n\n');

    return {
      text: joined,
      sections: {
        profile: profileBlock,
        relations: relationBlock,
        universal: '',
        front: frontBlock,
        middle: middleBlock,
        back: backBlock,
        ordered: orderedBlock,
        global: globalBlock,
        local: localBlock
      },
      matched: merged,
      matchedSummary: summarizeMatched(merged),
      globalCount: globalRows.length,
      localCount: localRows.length,
      orderedCount: legacySplit.ordered.length,
      universalCount: universalRows.length,
      frontCount: buckets.front.length,
      middleCount: buckets.middle.length,
      backCount: buckets.back.length
    };
  }

  global.miyaWorldbookPrompt = {
    buildWorldbookPrompt: buildWorldbookPrompt,
    normalizeDepth: normalizeDepth
  };
  global.miyaBuildWorldbookPrompt = buildWorldbookPrompt;
})(window);
