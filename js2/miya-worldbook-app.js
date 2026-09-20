(function (global) {
  'use strict';

  var store = global.miyaWorldbookStore;
  var DEFAULT_GROUP_ID = store.DEFAULT_GROUP_ID;
  var filterScope = 'all';
  var filterGroupId = 'all';
  var searchQuery = '';
  var editingId = null;
  var collapsedGroups = {};

  function $(id) { return document.getElementById(id); }

  function ensureContactsReady() {
    var cs = global.miyaContactsStore;
    if (cs && typeof cs.whenReady === 'function') return cs.whenReady();
    return Promise.resolve();
  }

  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'mw-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2400);
  }

  function dialog(opts) {
    if (!global.miyaDialog) {
      if (opts.mode === 'confirm') return Promise.resolve(confirm((opts.title || '') + '\n' + (opts.message || '')));
      if (opts.mode === 'prompt') return Promise.resolve(prompt(opts.message || opts.title || '') || null);
      return Promise.resolve(alert((opts.title || '') + '\n' + (opts.message || '')));
    }
    if (opts.mode === 'confirm') return global.miyaDialog.confirm(opts);
    if (opts.mode === 'prompt') return global.miyaDialog.prompt(opts);
    return global.miyaDialog.alert(opts);
  }

  function scopeLabel(scope) {
    return scope === 'local' ? '局部' : '全局';
  }

  function globalReachLabel(reach) {
    var labels = store.GLOBAL_REACH_LABELS || {};
    return labels[reach] || '线上线下';
  }

  function depthLabel(depth) {
    var labels = store.DEPTH_LABELS || { front: '前', middle: '中', back: '后' };
    var d = store.normalizeDepth ? store.normalizeDepth(depth) : (depth || 'middle');
    return labels[d] || '中';
  }

  function syncGlobalReachUi(scope) {
    var wrap = $('miya-wb-global-reach-wrap');
    if (!wrap) return;
    wrap.hidden = false;
    var label = $('miya-wb-reach-label');
    if (label) {
      label.textContent = scope === 'local' ? '局部生效范围' : '全局生效范围';
    }
  }

  function setActiveGlobalReach(reach) {
    var app = $('miya-worldbook-app');
    if (!app) return;
    var value = reach || 'online_offline';
    app.querySelectorAll('[data-wb-global-reach]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-wb-global-reach') === value);
    });
  }

  function setActiveDepth(depth) {
    var app = $('miya-worldbook-app');
    if (!app) return;
    var value = store.normalizeDepth ? store.normalizeDepth(depth) : (depth || 'middle');
    app.querySelectorAll('[data-wb-depth]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-wb-depth') === value);
    });
  }

  function collectDepth() {
    var btn = $('miya-worldbook-app') && $('miya-worldbook-app').querySelector('[data-wb-depth].is-active');
    var raw = btn ? btn.getAttribute('data-wb-depth') : 'middle';
    return store.normalizeDepth ? store.normalizeDepth(raw) : (raw || 'middle');
  }

  function collectGlobalReach() {
    var app = $('miya-worldbook-app');
    if (!app) return 'online_offline';
    var active = app.querySelector('[data-wb-global-reach].is-active');
    return active ? active.getAttribute('data-wb-global-reach') || 'online_offline' : 'online_offline';
  }

  function keywordPreview(entry) {
    var scope = entry.scope === 'local' ? 'local' : 'global';
    var kws = Array.isArray(entry.keywords) ? entry.keywords : [];
    var kwPart = !kws.length
      ? '无关键词·随时命中'
      : '关键词：' + kws.slice(0, 4).join(' · ') + (kws.length > 4 ? ' …' : '');
    var reach = entry.globalReach || (scope === 'local' ? 'all' : 'online_offline');
    return '生效：' + globalReachLabel(reach) + ' · ' + kwPart;
  }

  function filteredEntries() {
    var rows = store.listEntries();
    var q = searchQuery.trim().toLowerCase();
    return rows.filter(function (entry) {
      if (filterScope !== 'all' && entry.scope !== filterScope) return false;
      if (filterGroupId !== 'all' && entry.groupId !== filterGroupId) return false;
      if (!q) return true;
      var g = store.getGroup(entry.groupId);
      var blob = [
        entry.name,
        entry.content,
        (entry.keywords || []).join(' '),
        (entry.boundRoleIds || []).join(' '),
        g && g.name
      ].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderGroupChips() {
    var rail = $('miya-wb-group-rail');
    if (!rail) return;
    var groups = store.listGroups();
    var html = '<button type="button" class="ins-wb-group-chip' + (filterGroupId === 'all' ? ' is-active' : '') +
      '" data-wb-group="all">全部</button>';
    groups.forEach(function (g) {
      var cnt = store.listEntries().filter(function (e) { return e.groupId === g.id; }).length;
      html += '<button type="button" class="ins-wb-group-chip' + (filterGroupId === g.id ? ' is-active' : '') +
        '" data-wb-group="' + esc(g.id) + '">' + esc(g.name) + '<i>' + cnt + '</i></button>';
    });
    html += '<button type="button" class="ins-wb-group-chip ins-wb-group-chip--add" data-wb-group-add aria-label="新建分卷">+</button>';
    rail.innerHTML = html;
  }

  function roleMonogram(name) {
    return Array.from(String(name || '').trim() || '?')[0] || '?';
  }

  function renderRolePicker(selectedIds) {
    var picked = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
    var set = new Set(picked);
    var rows = store.resolveAvailableRoles ? store.resolveAvailableRoles() : [];
    if (!rows.length) {
      return '<p class="ins-wb-role-empty">请先在「联系人」建档；不选任何角色则为全局生效。</p>';
    }
    return (
      '<div class="ins-wb-role-grid">' +
      rows.map(function (row) {
        var on = set.has(String(row.roleId));
        var portrait = row.avatar
          ? '<span class="ins-wb-role-portrait"><img src="' + esc(row.avatar) + '" alt=""></span>'
          : '<span class="ins-wb-role-portrait ins-wb-role-portrait--mono">' + esc(roleMonogram(row.roleName)) + '</span>';
        var tag = row.source === 'contacts' ? '<span class="ins-wb-role-tag">档案</span>' : '';
        return (
          '<button type="button" class="ins-wb-role-card' + (on ? ' is-selected' : '') +
          '" data-role-id="' + esc(row.roleId) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="ins-wb-role-mark" aria-hidden="true"></span>' +
          portrait +
          '<span class="ins-wb-role-card-body">' +
          '<span class="ins-wb-role-card-name">' + esc(row.roleName || row.roleId) + '</span>' +
          tag +
          '</span></button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function collectRoleIds() {
    var root = $('miya-wb-roles-wrap');
    if (!root) return [];
    var set = new Set();
    root.querySelectorAll('.ins-wb-role-card.is-selected').forEach(function (el) {
      var v = String(el.getAttribute('data-role-id') || '').trim();
      if (v) set.add(v);
    });
    return Array.from(set);
  }

  function roleHintLabel(entry) {
    var roles = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
    var scope = entry.scope === 'local' ? 'local' : 'global';
    var reach = globalReachLabel(entry.globalReach || (scope === 'local' ? 'all' : 'online_offline'));
    if (scope !== 'local') return reach;
    if (!roles.length) return reach + ' · 未绑定角色';
    var available = store.resolveAvailableRoles ? store.resolveAvailableRoles() : [];
    var map = {};
    available.forEach(function (r) { map[r.roleId] = r.roleName; });
    var names = roles.map(function (id) { return map[id] || id; }).slice(0, 2);
    var suffix = roles.length > 2 ? ' 等' + roles.length + '人' : '';
    return reach + ' · ' + names.join(' · ') + suffix;
  }

  function renderEntryCard(entry, index) {
    var on = entry.enabled !== false;
    var scope = entry.scope === 'local' ? 'local' : 'global';
    var depth = store.normalizeDepth ? store.normalizeDepth(entry.depth) : (entry.depth || 'middle');
    var roleHint = roleHintLabel(entry);
    var idx = typeof index === 'number' ? String(index + 1).padStart(2, '0') : '';
    return (
      '<article class="ins-wb-card' + (on ? '' : ' is-off') + '" data-wb-id="' + esc(entry.id) + '">' +
      (idx ? '<span class="ins-wb-card__idx" aria-hidden="true">' + idx + '</span>' : '') +
      '<div class="ins-wb-card-head">' +
      '<div class="ins-wb-card-tags">' +
      '<span class="ins-wb-scope ins-wb-scope--' + scope + '">' + scopeLabel(scope) + '</span>' +
      '<span class="ins-wb-depth ins-wb-depth--' + depth + '">' + depthLabel(depth) + '</span>' +
      '</div>' +
      '<button type="button" class="ins-toggle' + (on ? ' is-on' : '') + '" data-wb-toggle="' + esc(entry.id) + '" role="switch" aria-checked="' + on + '"></button>' +
      '</div>' +
      '<h3 class="ins-wb-card-title">' + esc(entry.name) + '</h3>' +
      '<p class="ins-wb-card-keys">' + esc(keywordPreview(entry)) + '</p>' +
      '<footer class="ins-wb-card-foot">' +
      '<span>' + esc(roleHint) + '</span>' +
      '<button type="button" class="ins-wb-link" data-wb-edit="' + esc(entry.id) + '">编辑</button>' +
      '</footer>' +
      '</article>'
    );
  }

  function renderList() {
    var list = $('miya-wb-list');
    var empty = $('miya-wb-empty');
    var count = $('miya-wb-count');
    if (!list) return;

    renderGroupChips();
    var rows = filteredEntries();
    if (count) count.textContent = String(rows.length);

    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    if (filterGroupId !== 'all') {
      list.innerHTML = rows.map(function (e, i) { return renderEntryCard(e, i); }).join('');
      return;
    }

    var groups = store.listGroups();
    var byGroup = {};
    groups.forEach(function (g) { byGroup[g.id] = []; });
    rows.forEach(function (entry) {
      var gid = byGroup[entry.groupId] ? entry.groupId : DEFAULT_GROUP_ID;
      if (!byGroup[gid]) byGroup[gid] = [];
      byGroup[gid].push(entry);
    });

    var html = '';
    groups.forEach(function (g) {
      var items = byGroup[g.id] || [];
      if (!items.length) return;
      var collapsed = !!collapsedGroups[g.id];
      var actions = g.fixed ? '' : (
        '<span class="ins-wb-group-head-ops">' +
        '<button type="button" class="ins-wb-group-op" data-wb-group-edit="' + esc(g.id) + '" aria-label="重命名">改</button>' +
        '<button type="button" class="ins-wb-group-op ins-wb-group-op--del" data-wb-group-del="' + esc(g.id) + '" aria-label="删除">删</button>' +
        '</span>'
      );
      html += '<section class="ins-wb-group-block">' +
        '<div class="ins-wb-group-head">' +
        '<button type="button" class="ins-wb-group-head-toggle" data-wb-collapse="' + esc(g.id) + '" aria-expanded="' + !collapsed + '">' +
        '<span class="ins-wb-group-head-title">' + esc(g.name) + '</span>' +
        '<span class="ins-wb-group-head-meta">' + items.length + '</span>' +
        '<span class="ins-wb-group-head-arrow">' + (collapsed ? '▸' : '▾') + '</span>' +
        '</button>' + actions + '</div>';
      if (!collapsed) {
        html += '<div class="ins-wb-group-body">' + items.map(function (e, i) { return renderEntryCard(e, i); }).join('') + '</div>';
      }
      html += '</section>';
    });
    list.innerHTML = html || rows.map(function (e, i) { return renderEntryCard(e, i); }).join('');
  }

  function fillGroupSelect(selectedId) {
    var sel = $('miya-wb-field-group');
    if (!sel) return;
    var groups = store.listGroups();
    sel.innerHTML = groups.map(function (g) {
      var picked = String(g.id) === String(selectedId || DEFAULT_GROUP_ID) ? ' selected' : '';
      return '<option value="' + esc(g.id) + '"' + picked + '>' + esc(g.name) + '</option>';
    }).join('');
  }

  function syncFilterUi() {
    var root = $('miya-worldbook-app');
    if (!root) return;
    root.querySelectorAll('[data-wb-filter]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-wb-filter') === filterScope);
    });
  }

  function fillEditor(entry) {
    var isNew = !entry;
    var data = entry || {
      scope: filterScope === 'local' ? 'local' : 'global',
      globalReach: 'online_offline',
      depth: 'middle',
      groupId: filterGroupId !== 'all' ? filterGroupId : DEFAULT_GROUP_ID,
      keywords: [],
      boundRoleIds: [],
      enabled: true,
      content: '',
      name: ''
    };
    editingId = isNew ? null : data.id;
    $('miya-wb-editor-title').textContent = isNew ? '新建片段' : '编辑片段';
    $('miya-wb-field-name').value = data.name || '';
    $('miya-wb-field-keys').value = (data.keywords || []).join('，');
    $('miya-wb-field-body').value = data.content || '';
    var rolesHost = $('miya-wb-roles-host');
    if (rolesHost) rolesHost.innerHTML = '<p class="ins-wb-role-empty">正在读取联系人档案…</p>';
    fillGroupSelect(data.groupId || DEFAULT_GROUP_ID);
    var scope = data.scope === 'local' ? 'local' : 'global';
    $('miya-worldbook-app').querySelectorAll('[data-wb-scope]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-wb-scope') === scope);
    });
    syncGlobalReachUi(scope);
    setActiveGlobalReach(data.globalReach || 'online_offline');
    setActiveDepth(data.depth || 'middle');
    var rolesWrap = $('miya-wb-roles-wrap');
    if (rolesWrap) rolesWrap.hidden = scope !== 'local';
    var app = $('miya-worldbook-app');
    if (app) {
      app.classList.add('has-editor');
      var editor = $('miya-wb-editor');
      if (editor) editor.setAttribute('aria-hidden', 'false');
    }
    ensureContactsReady().then(function () {
      if (rolesHost) rolesHost.innerHTML = renderRolePicker(data.boundRoleIds || []);
    });
  }

  function readEditorPayload() {
    var scopeBtn = $('miya-worldbook-app').querySelector('[data-wb-scope].is-active');
    var scope = scopeBtn ? scopeBtn.getAttribute('data-wb-scope') : 'global';
    var roles = scope === 'local' ? collectRoleIds() : [];
    var matcher = global.miyaWorldbookMatcher;
    var keysRaw = $('miya-wb-field-keys').value || '';
    var keywords = matcher && typeof matcher.splitKeywordString === 'function'
      ? matcher.splitKeywordString(keysRaw)
      : keysRaw.split(/[,，、;；]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    return {
      id: editingId || undefined,
      name: ($('miya-wb-field-name').value || '').trim(),
      keywords: keywords,
      content: $('miya-wb-field-body').value || '',
      scope: scope,
      globalReach: collectGlobalReach(),
      depth: collectDepth(),
      groupId: ($('miya-wb-field-group') && $('miya-wb-field-group').value) || DEFAULT_GROUP_ID,
      boundRoleIds: scope === 'local' ? roles : [],
      enabled: true
    };
  }

  function closeEditor() {
    editingId = null;
    var app = $('miya-worldbook-app');
    if (app) app.classList.remove('has-editor');
    var editor = $('miya-wb-editor');
    if (editor) editor.setAttribute('aria-hidden', 'true');
  }

  function saveEditor() {
    var payload = readEditorPayload();
    if (!payload.name) { toast('请填写片段标题'); return; }
    if (payload.scope === 'local' && !payload.boundRoleIds.length) {
      toast('局部片段需绑定至少一位联系人');
      return;
    }
    store.upsertEntry(payload).then(function () {
      closeEditor();
      renderList();
      toast('已保存');
    }).catch(function () { toast('保存失败'); });
  }

  function deleteEditing() {
    if (!editingId) { closeEditor(); return; }
    dialog({
      mode: 'confirm',
      title: '删除片段',
      message: '删除后无法恢复，确定继续？',
      confirmText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      store.removeEntry(editingId).then(function () {
        closeEditor();
        renderList();
        toast('已删除');
      });
    });
  }

  function promptNewGroup() {
    dialog({
      mode: 'prompt',
      title: '新建分卷',
      message: '输入分卷名称',
      placeholder: '例如：角色 A',
      defaultValue: ''
    }).then(function (name) {
      name = String(name || '').trim();
      if (!name) return;
      store.upsertGroup({ name: name, sort: Date.now() }).then(function (g) {
        filterGroupId = g.id;
        renderList();
        toast('分卷已创建');
      });
    });
  }

  function promptRenameGroup(groupId) {
    var g = store.getGroup(groupId);
    if (!g || g.fixed) return;
    dialog({
      mode: 'prompt',
      title: '重命名分卷',
      message: '新的分卷名称',
      defaultValue: g.name
    }).then(function (name) {
      name = String(name || '').trim();
      if (!name) return;
      store.upsertGroup({ id: g.id, name: name, sort: g.sort }).then(renderList);
    });
  }

  function promptDeleteGroup(groupId) {
    var g = store.getGroup(groupId);
    if (!g || g.fixed) return;
    var cnt = store.listEntries().filter(function (e) { return e.groupId === g.id; }).length;
    dialog({
      mode: 'confirm',
      title: '删除分卷',
      message: '分卷「' + g.name + '」下的 ' + cnt + ' 条片段将移入「未分组」。继续？',
      confirmText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      store.removeGroup(g.id).then(function () {
        if (filterGroupId === g.id) filterGroupId = 'all';
        renderList();
        toast('分卷已删除');
      });
    });
  }

  function importDocToBody(file) {
    var fn = global.miyaWorldbookExtractFileText;
    if (!fn) { toast('导入模块未加载'); return; }
    fn(file).then(function (text) {
      var body = $('miya-wb-field-body');
      if (!body) return;
      var t = String(text || '').trim();
      if (!t) { toast('未能识别到文字内容'); return; }
      body.value = t;
      if (!($('miya-wb-field-name').value || '').trim()) {
        var base = String(file.name || '').replace(/\.[^.]+$/, '').trim();
        if (base) $('miya-wb-field-name').value = base.slice(0, 64);
      }
      toast('已填入正文');
    }).catch(function (err) {
      var code = err && err.message;
      if (code === 'unsupported_type') toast('仅支持 .txt 与 .docx');
      else if (code === 'jszip_missing') toast('文档解析库未加载');
      else toast('读取文件失败');
    });
  }

  function bindEvents() {
    var app = $('miya-worldbook-app');
    if (!app || app.getAttribute('data-wb-bound')) return;
    app.setAttribute('data-wb-bound', '1');

    var wbBack = $('miya-wb-header-back') || $('miya-wb-back');
    if (wbBack) wbBack.addEventListener('click', closeWorldbookApp);
    $('miya-wb-add').addEventListener('click', function () { fillEditor(null); });
    $('miya-wb-editor-back').addEventListener('click', closeEditor);
    $('miya-wb-save').addEventListener('click', saveEditor);
    $('miya-wb-delete').addEventListener('click', deleteEditing);

    $('miya-wb-search').addEventListener('input', function () {
      searchQuery = $('miya-wb-search').value || '';
      renderList();
    });

    app.querySelectorAll('[data-wb-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterScope = btn.getAttribute('data-wb-filter') || 'all';
        syncFilterUi();
        renderList();
      });
    });

    app.querySelectorAll('[data-wb-scope]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        app.querySelectorAll('[data-wb-scope]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        var scope = btn.getAttribute('data-wb-scope') || 'global';
        var rolesWrap = $('miya-wb-roles-wrap');
        if (rolesWrap) rolesWrap.hidden = scope !== 'local';
        syncGlobalReachUi(scope);
      });
    });

    app.querySelectorAll('[data-wb-global-reach]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        app.querySelectorAll('[data-wb-global-reach]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });

    app.querySelectorAll('[data-wb-depth]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        app.querySelectorAll('[data-wb-depth]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });

    $('miya-wb-doc-import').addEventListener('click', function () {
      $('miya-wb-doc-file').click();
    });

    $('miya-wb-doc-file').addEventListener('change', function () {
      var f = $('miya-wb-doc-file').files && $('miya-wb-doc-file').files[0];
      $('miya-wb-doc-file').value = '';
      if (f) importDocToBody(f);
    });

    app.addEventListener('click', function (e) {
      var roleCard = e.target.closest('.ins-wb-role-card');
      if (roleCard) {
        roleCard.classList.toggle('is-selected');
        roleCard.setAttribute('aria-pressed', roleCard.classList.contains('is-selected') ? 'true' : 'false');
        return;
      }
      var groupAdd = e.target.closest('[data-wb-group-add]');
      if (groupAdd) {
        promptNewGroup();
        return;
      }
      var groupChip = e.target.closest('[data-wb-group]');
      if (groupChip && groupChip.hasAttribute('data-wb-group')) {
        filterGroupId = groupChip.getAttribute('data-wb-group') || 'all';
        renderList();
        return;
      }
      var collapseBtn = e.target.closest('[data-wb-collapse]');
      if (collapseBtn) {
        var gid = collapseBtn.getAttribute('data-wb-collapse');
        collapsedGroups[gid] = !collapsedGroups[gid];
        renderList();
        return;
      }
      var editGroupBtn = e.target.closest('[data-wb-group-edit]');
      if (editGroupBtn) {
        e.stopPropagation();
        promptRenameGroup(editGroupBtn.getAttribute('data-wb-group-edit'));
        return;
      }
      var delGroupBtn = e.target.closest('[data-wb-group-del]');
      if (delGroupBtn) {
        e.stopPropagation();
        promptDeleteGroup(delGroupBtn.getAttribute('data-wb-group-del'));
        return;
      }
      var editBtn = e.target.closest('[data-wb-edit]');
      if (editBtn) {
        var ent = store.getEntry(editBtn.getAttribute('data-wb-edit'));
        if (ent) fillEditor(ent);
        return;
      }
      var toggleBtn = e.target.closest('[data-wb-toggle]');
      if (toggleBtn) {
        e.stopPropagation();
        var id = toggleBtn.getAttribute('data-wb-toggle');
        var ent2 = store.getEntry(id);
        if (!ent2) return;
        store.toggleEntryEnabled(id, ent2.enabled === false).then(renderList);
        return;
      }
      var card = e.target.closest('.ins-wb-card');
      if (card && !e.target.closest('button')) {
        var ent3 = store.getEntry(card.getAttribute('data-wb-id'));
        if (ent3) fillEditor(ent3);
      }
    });
  }

  function openWorldbookApp() {
    var app = $('miya-worldbook-app');
    if (!app || !store) return;
    Promise.all([store.whenReady(), ensureContactsReady()]).then(function () {
      filterScope = 'all';
      filterGroupId = 'all';
      searchQuery = '';
      if ($('miya-wb-search')) $('miya-wb-search').value = '';
      syncFilterUi();
      closeEditor();
      app.removeAttribute('hidden');
      app.classList.add('is-open');
      app.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      if (global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(app);
      requestAnimationFrame(function () { renderList(); });
    }).catch(function () {
      toast('典籍加载失败');
    });
  }

  function closeWorldbookApp() {
    var app = $('miya-worldbook-app');
    if (!app) return;
    closeEditor();
    app.classList.remove('is-open', 'has-editor');
    app.setAttribute('hidden', '');
    app.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open') &&
        !document.querySelector('.miya-chat-app.is-open') &&
        !document.querySelector('.miya-memory-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  bindEvents();
  global.miyaWorldbookApp = { open: openWorldbookApp, close: closeWorldbookApp, toast: toast };
})(window);
