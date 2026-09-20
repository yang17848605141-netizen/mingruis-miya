(function (global) {
  'use strict';

  var store = global.miyaContactsStore;
  var relStore = global.miyaContactsRelationshipStore;
  var filterGroupId = 'all';
  var searchQuery = '';
  var editingId = null;
  var draftAvatar = null;
  var keyboardInsetBound = false;
  var focusScrollTimer = null;
  var lastFocusedField = null;
  var gridRenderGen = 0;
  var GRID_CHUNK = 32;
  var GRID_CHUNK_LOW_END = 16;

  function resolveGridChunk() {
    return (document.documentElement && document.documentElement.classList.contains('is-low-end'))
      ? GRID_CHUNK_LOW_END
      : GRID_CHUNK;
  }
  var pendingImportTags = null;
  var pendingWorldbookImport = null;

  function $(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var div = document.createElement('div');
    div.className = 'mn-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () { div.remove(); }, 2400);
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

  function monogram(name) {
    return Array.from(String(name || '').trim() || '?')[0] || '?';
  }

  function editorScrollEl() {
    return $('miya-ct-editor-scroll');
  }

  function syncKeyboardInset() {
    var app = $('miya-contacts-app');
    if (!app || !app.classList.contains('has-editor')) return;
    var vv = window.visualViewport;
    var inset = 0;
    if (vv) {
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
    }
    var open = inset > 40;
    app.classList.toggle('mn--keyboard', open);
    if (open && vv) {
      app.style.setProperty('--mn-kb-top', Math.round(vv.offsetTop || 0) + 'px');
      app.style.setProperty('--mn-kb-height', Math.round(vv.height) + 'px');
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
    } else {
      app.style.removeProperty('--mn-kb-top');
      app.style.removeProperty('--mn-kb-height');
    }
    if (open && lastFocusedField) ensureFieldVisible(lastFocusedField);
  }

  function ensureFieldVisible(field) {
    var sc = editorScrollEl();
    if (!sc || !field || !field.getBoundingClientRect) return;
    var vv = window.visualViewport;
    var viewTop = vv ? vv.offsetTop : 0;
    var foot = sc.parentElement && sc.parentElement.querySelector('.mn-editor-foot');
    var footRect = foot ? foot.getBoundingClientRect() : null;
    var limitBottom = footRect ? footRect.top : (vv ? vv.offsetTop + vv.height : window.innerHeight);
    var rect = field.getBoundingClientRect();
    var margin = 20;
    if (rect.bottom > limitBottom - margin) {
      sc.scrollTop += rect.bottom - limitBottom + margin;
    }
    if (rect.top < viewTop + margin) {
      sc.scrollTop -= viewTop + margin - rect.top;
    }
  }

  function scheduleFieldScroll(field) {
    if (!field) return;
    lastFocusedField = field;
    clearTimeout(focusScrollTimer);
    focusScrollTimer = setTimeout(function () {
      syncKeyboardInset();
      requestAnimationFrame(function () {
        ensureFieldVisible(field);
        requestAnimationFrame(function () {
          ensureFieldVisible(field);
        });
      });
    }, 280);
  }

  function clearKeyboardState() {
    var app = $('miya-contacts-app');
    if (app) {
      app.classList.remove('mn--keyboard');
      app.style.removeProperty('--mn-kb-top');
      app.style.removeProperty('--mn-kb-height');
    }
    lastFocusedField = null;
    clearTimeout(focusScrollTimer);
    focusScrollTimer = null;
  }

  function bindKeyboardInset() {
    if (keyboardInsetBound) return;
    keyboardInsetBound = true;
    var vv = window.visualViewport;
    function onViewportChange() {
      syncKeyboardInset();
    }
    if (vv) {
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('resize', onViewportChange);
  }

  function filteredCharacters() {
    var rows = store.listCharacters(filterGroupId);
    var q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (c) {
      var blob = [c.name, c.persona, c.gender, c.age, (c.tags || []).join(' ')].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderVolumes() {
    var rail = $('miya-ct-volumes');
    if (!rail) return;
    var groups = store.listGroups();
    var html = '<button type="button" class="mn-vol' + (filterGroupId === 'all' ? ' is-active' : '') +
      '" data-ct-group="all">全卷</button>';
    groups.forEach(function (g) {
      var cnt = store.listCharacters(g.id).length;
      html += '<button type="button" class="mn-vol' + (filterGroupId === g.id ? ' is-active' : '') +
        '" data-ct-group="' + esc(g.id) + '" title="' + esc(g.name) + '">' +
        esc(g.name) + (cnt ? ' ·' + cnt : '') + '</button>';
    });
    html += '<button type="button" class="mn-vol mn-vol-add" data-ct-group-add aria-label="新建卷">＋</button>';
    rail.innerHTML = html;
  }

  function panelHtml(c, wbCounts) {
    var wbCount = (wbCounts && wbCounts[c.id]) || 0;
    var badge = wbCount ? '<span class="mn-panel__badge">典' + wbCount + '</span>' : '';
    var portrait = c.avatar
      ? '<img src="' + esc(c.avatar) + '" alt="" loading="lazy" decoding="async">'
      : '<div class="mn-panel__mono">' + esc(monogram(c.name)) + '</div>';
    return (
      '<button type="button" class="mn-panel" data-ct-id="' + esc(c.id) + '">' +
      badge +
      '<div class="mn-panel__frame">' + portrait + '<span class="mn-panel__speed" aria-hidden="true"></span></div>' +
      '<div class="mn-panel__body">' +
      '<p class="mn-panel__name">' + esc(c.name) + '</p>' +
      '</div></button>'
    );
  }

  function defaultGroupName() {
    var g = store.getGroup(store.DEFAULT_GROUP_ID);
    return (g && g.name) || '未归档';
  }

  function renderVolumeFooter() {
    var foot = $('miya-ct-vol-foot');
    if (!foot) return;
    if (filterGroupId === 'all') {
      foot.hidden = true;
      foot.innerHTML = '';
      return;
    }
    var g = store.getGroup(filterGroupId);
    if (!g || g.fixed) {
      foot.hidden = true;
      foot.innerHTML = '';
      return;
    }
    foot.hidden = false;
    foot.innerHTML =
      '<button type="button" class="mn-vol-del" data-ct-group-del="' + esc(g.id) + '">' +
      '删除本卷 · ' + esc(g.name) +
      '</button>';
  }

  function renderGrid() {
    var grid = $('miya-ct-grid');
    var countEl = $('miya-ct-count');
    if (!grid) return;
    var rows = filteredCharacters();
    if (countEl) countEl.textContent = String(rows.length);
    var gen = ++gridRenderGen;

    if (!rows.length) {
      grid.innerHTML =
        '<div class="mn-empty">' +
        '<strong>空白分镜</strong>' +
        '<span>点右上角「建档」创建角色<br>或「导入」酒馆卡（PNG / JSON）<br>编辑时可从 docx/txt 填入人设 · 与世界书典籍联动</span>' +
        '</div>';
      renderVolumeFooter();
      return;
    }

    var wbCounts = store.countWorldbookBindingsMap
      ? store.countWorldbookBindingsMap(rows.map(function (c) { return c.id; }))
      : null;

    function finishGrid() {
      renderVolumeFooter();
    }

    var chunk = resolveGridChunk();
    if (rows.length <= chunk) {
      grid.innerHTML = rows.map(function (c) { return panelHtml(c, wbCounts); }).join('');
      finishGrid();
      return;
    }

    grid.innerHTML = '';
    var idx = 0;
    function appendChunk() {
      if (gen !== gridRenderGen) return;
      var slice = rows.slice(idx, idx + chunk);
      if (!slice.length) {
        finishGrid();
        return;
      }
      grid.insertAdjacentHTML('beforeend', slice.map(function (c) { return panelHtml(c, wbCounts); }).join(''));
      idx += chunk;
      if (idx < rows.length) requestAnimationFrame(appendChunk);
      else finishGrid();
    }
    requestAnimationFrame(appendChunk);
  }

  function renderList() {
    renderVolumes();
    renderGrid();
  }

  function fillGroupSelect(selectedId) {
    var sel = $('miya-ct-field-group');
    if (!sel) return;
    var groups = store.listGroups();
    sel.innerHTML = groups.map(function (g) {
      var picked = String(g.id) === String(selectedId || store.DEFAULT_GROUP_ID) ? ' selected' : '';
      return '<option value="' + esc(g.id) + '"' + picked + '>' + esc(g.name) + '</option>';
    }).join('') + '<option value="__new__">＋ 新建卷</option>';
  }

  function renderRelationMatrix(characterId) {
    var wrap = $('miya-ct-relations');
    if (!wrap || !relStore) return;
    var self = store.findCharacter(characterId);
    if (!self) { wrap.innerHTML = ''; return; }
    var peers = store.listCharacters(self.groupId).filter(function (c) {
      return c.id !== self.id;
    });
    if (!peers.length) {
      wrap.innerHTML = '<p class="mn-wb-link">同卷暂无其他角色</p>';
      return;
    }
    wrap.innerHTML = '<div class="mn-matrix">' + peers.map(function (p) {
      var rel = relStore.getRelation(self.id, p.id, self.groupId);
      return (
        '<div class="mn-matrix-row">' +
        '<span class="mn-matrix-name">' + esc(p.name) + '</span>' +
        '<input type="text" class="mn-input" data-ct-rel="' + esc(p.id) + '" value="' + esc(rel) + '" placeholder="关系描述">' +
        '</div>'
      );
    }).join('') + '</div>';
  }

  function fillEditor(entry) {
    var isNew = !entry;
    var data = entry || {
      groupId: filterGroupId !== 'all' ? filterGroupId : store.DEFAULT_GROUP_ID,
      name: '',
      age: '',
      gender: '',
      birthday: '',
      persona: '',
      avatar: ''
    };
    editingId = isNew ? null : data.id;
    draftAvatar = data.avatar || null;

    $('miya-ct-editor-title').textContent = isNew ? '新建档案' : '编辑 · ' + (data.name || '');
    $('miya-ct-field-name').value = data.name || '';
    $('miya-ct-field-age').value = data.age || '';
    $('miya-ct-field-gender').value = data.gender || '';
    $('miya-ct-field-birthday').value = data.birthday || '';
    $('miya-ct-field-persona').value = data.persona || '';
    fillGroupSelect(data.groupId || store.DEFAULT_GROUP_ID);

    var img = $('miya-ct-portrait-img');
    var mono = $('miya-ct-portrait-mono');
    if (draftAvatar) {
      if (img) { img.src = draftAvatar; img.hidden = false; }
      if (mono) mono.hidden = true;
    } else {
      if (img) img.hidden = true;
      if (mono) { mono.textContent = monogram(data.name); mono.hidden = false; }
    }

    var wbCount = isNew ? 0 : store.countWorldbookBindings(data.id);
    var wbEl = $('miya-ct-wb-count');
    if (wbEl) wbEl.textContent = String(wbCount);

    if (!isNew) renderRelationMatrix(data.id);
    else if ($('miya-ct-relations')) $('miya-ct-relations').innerHTML = '<p class="mn-wb-link">保存后可编辑同卷人际脉络</p>';

    var app = $('miya-contacts-app');
    if (app) app.classList.add('has-editor');
    var scroll = editorScrollEl();
    if (scroll) scroll.scrollTop = 0;
    syncKeyboardInset();
  }

  function readEditorPayload() {
    var groupSel = $('miya-ct-field-group');
    var groupVal = groupSel ? groupSel.value : store.DEFAULT_GROUP_ID;
    var payload = {
      id: editingId || undefined,
      name: ($('miya-ct-field-name').value || '').trim(),
      age: ($('miya-ct-field-age').value || '').trim(),
      gender: ($('miya-ct-field-gender').value || '').trim(),
      birthday: ($('miya-ct-field-birthday').value || '').trim(),
      persona: ($('miya-ct-field-persona').value || '').trim(),
      avatar: draftAvatar || ''
    };
    if (groupVal === '__new__') {
      payload.newGroupName = ($('miya-ct-field-new-group') && $('miya-ct-field-new-group').value || '').trim();
      if (!payload.newGroupName) payload.groupId = store.DEFAULT_GROUP_ID;
    } else {
      payload.groupId = groupVal;
    }
    if (pendingImportTags && pendingImportTags.length) payload.tags = pendingImportTags.slice();
    return payload;
  }

  function applyPendingWorldbook(characterRow) {
    if (!pendingWorldbookImport || !pendingWorldbookImport.doImport || !pendingWorldbookImport.book) {
      return Promise.resolve(null);
    }
    var fn = global.miyaTavernCardImport && global.miyaTavernCardImport.applyWorldbookForCharacter;
    if (!fn) return Promise.resolve(null);
    return fn(characterRow, pendingWorldbookImport.book);
  }

  function saveRelations(characterId) {
    if (!relStore || !characterId) return Promise.resolve();
    var self = store.findCharacter(characterId);
    if (!self) return Promise.resolve();
    var inputs = document.querySelectorAll('[data-ct-rel]');
    var chain = Promise.resolve();
    inputs.forEach(function (input) {
      var peerId = input.getAttribute('data-ct-rel');
      var val = (input.value || '').trim();
      chain = chain.then(function () {
        return relStore.setRelation(self.id, peerId, val, self.groupId);
      });
    });
    return chain;
  }

  function clearPendingImport() {
    pendingImportTags = null;
    pendingWorldbookImport = null;
  }

  function closeEditor() {
    editingId = null;
    draftAvatar = null;
    clearPendingImport();
    clearKeyboardState();
    var app = $('miya-contacts-app');
    if (app) app.classList.remove('has-editor');
  }

  function saveEditor() {
    var payload = readEditorPayload();
    if (!payload.name) { toast('请填写姓名'); return; }
    store.upsertCharacter(payload).then(function (result) {
      if (result && result.error) { toast(result.error); return; }
      return saveRelations(result.id).then(function () {
        return applyPendingWorldbook(result);
      }).then(function (wbResult) {
        var sync = global.miyaChatContactsSync;
        var afterSync = sync && sync.syncOne
          ? sync.syncOne(result.id)
          : Promise.resolve();
        return afterSync.then(function () {
          closeEditor();
          renderList();
          if (wbResult && wbResult.count) {
            toast('档案已入卷 · 世界书 ' + wbResult.count + ' 条');
          } else {
            toast('档案已入卷');
          }
        });
      });
    }).catch(function () { toast('保存失败'); });
  }

  function deleteEditing() {
    if (!editingId) { closeEditor(); return; }
    dialog({
      mode: 'confirm',
      title: '撕毁档案',
      message: '删除后世界书绑定需自行调整，确定继续？',
      confirmText: '删除'
    }).then(function (ok) {
      if (!ok) return;
      store.removeCharacter(editingId).then(function () {
        var sync = global.miyaChatContactsSync;
        var after = sync && sync.syncAll
          ? sync.syncAll({ prune: true })
          : Promise.resolve();
        return after.then(function () {
          closeEditor();
          renderList();
          toast('已删除');
        });
      });
    });
  }

  function importCardFile(file) {
    var fn = global.miyaTavernCardImport && global.miyaTavernCardImport.parseFile;
    if (!fn) { toast('酒馆卡解析模块未加载'); return; }
    fn(file).then(function (parsed) {
      if (!parsed || !parsed.character) { toast('未能解析角色卡'); return; }
      var ch = parsed.character;
      if (!String(ch.name || '').trim() && !String(ch.persona || '').trim()) {
        toast('角色卡内容为空');
        return;
      }
      clearPendingImport();
      pendingImportTags = ch.tags && ch.tags.length ? ch.tags.slice() : null;
      pendingWorldbookImport = parsed.worldbook ? { book: parsed.worldbook, doImport: false } : null;

      function openImportedEditor() {
        fillEditor({
          groupId: filterGroupId !== 'all' ? filterGroupId : store.DEFAULT_GROUP_ID,
          name: ch.name || String(file.name || '').replace(/\.[^.]+$/, '').slice(0, 32),
          age: ch.age || '',
          gender: ch.gender || '',
          birthday: ch.birthday || '',
          persona: ch.persona || '',
          avatar: ch.avatar || ''
        });
        toast('已解析角色卡，确认后可封存');
      }

      if (pendingWorldbookImport) {
        var wb = pendingWorldbookImport.book;
        var entryCount = (wb.entries || []).length;
        var bookLabel = wb.name || '角色世界书';
        dialog({
          mode: 'confirm',
          title: '导入世界书',
          message: '检测到角色卡附带 ' + entryCount + ' 条世界书（' + bookLabel + '）。是否一并导入为世界书分类，并局部绑定给该角色？',
          confirmText: '导入',
          cancelText: '跳过'
        }).then(function (ok) {
          pendingWorldbookImport.doImport = !!ok;
          openImportedEditor();
        });
      } else {
        openImportedEditor();
      }
    }).catch(function (err) {
      var code = err && err.message;
      if (code === 'png_no_chara') toast('PNG 中未找到酒馆卡数据');
      else if (code === 'not_character_card') toast('不是有效的酒馆角色卡');
      else if (code === 'invalid_json' || code === 'empty_json') toast('JSON 格式无效');
      else toast('读取角色卡失败');
    });
  }

  function importDocToPersona(file) {
    var fn = global.miyaWorldbookExtractFileText;
    if (!fn) { toast('文档解析模块未加载'); return; }
    fn(file).then(function (text) {
      var field = $('miya-ct-field-persona');
      if (!field) return;
      var t = String(text || '').trim();
      if (!t) { toast('未能识别到文字内容'); return; }
      field.value = t;
      if (!($('miya-ct-field-name').value || '').trim()) {
        var base = String(file.name || '').replace(/\.[^.]+$/, '').trim();
        if (base) $('miya-ct-field-name').value = base.slice(0, 32);
      }
      toast('已填入人设与背景');
    }).catch(function (err) {
      var code = err && err.message;
      if (code === 'unsupported_type') toast('仅支持 .txt 与 .docx');
      else if (code === 'jszip_missing') toast('文档解析库未加载');
      else toast('读取文件失败');
    });
  }

  function promptNewGroup() {
    dialog({
      mode: 'prompt',
      title: '新建卷',
      message: '输入卷名（分组名）',
      placeholder: '例如：主线角色',
      defaultValue: ''
    }).then(function (name) {
      name = String(name || '').trim();
      if (!name) return;
      store.upsertGroup({ name: name, sort: Date.now() }).then(function (g) {
        filterGroupId = g.id;
        renderList();
        toast('新卷已创建');
      });
    });
  }

  function promptDeleteGroup(groupId) {
    var g = store.getGroup(groupId);
    if (!g || g.fixed) return;
    var cnt = store.listCharacters(g.id).length;
    var archiveName = defaultGroupName();
    dialog({
      mode: 'confirm',
      title: '删除卷',
      message: '删除「' + g.name + '」后，该卷内' +
        (cnt ? ' ' + cnt + ' 位' : '所有') + '角色将归入「' + archiveName + '」。继续？',
      confirmText: '删除',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      store.removeGroup(g.id).then(function () {
        var sync = global.miyaChatContactsSync;
        var after = sync && sync.syncAll
          ? sync.syncAll({ force: true })
          : Promise.resolve();
        return after.then(function () {
          if (filterGroupId === g.id) filterGroupId = 'all';
          renderList();
          toast('卷已删除');
        });
      });
    });
  }

  function bindEvents() {
    var root = $('miya-contacts-app');
    if (!root || root.__bound) return;
    root.__bound = true;
    bindKeyboardInset();

    root.addEventListener('focusin', function (e) {
      if (!root.classList.contains('has-editor')) return;
      var field = e.target;
      if (!field || !field.matches) return;
      if (!field.matches('.mn-editor input, .mn-editor textarea, .mn-editor select')) return;
      scheduleFieldScroll(field);
    });

    root.addEventListener('focusout', function (e) {
      if (!root.classList.contains('has-editor')) return;
      var field = e.target;
      if (!field || !field.matches) return;
      if (!field.matches('.mn-editor input, .mn-editor textarea, .mn-editor select')) return;
      setTimeout(function () {
        var active = document.activeElement;
        if (active && root.contains(active) && active.matches('.mn-editor input, .mn-editor textarea, .mn-editor select')) return;
        lastFocusedField = null;
        syncKeyboardInset();
      }, 120);
    });

    $('miya-ct-back').addEventListener('click', closeContactsApp);
    $('miya-ct-add').addEventListener('click', function () { clearPendingImport(); fillEditor(null); });
    $('miya-ct-card-import').addEventListener('click', function () {
      var lic = global.miyaTavernActivation;
      if (!lic || !lic.ensureLicensed) {
        $('miya-ct-card-file').click();
        return;
      }
      lic.ensureLicensed().then(function (ok) {
        if (ok) $('miya-ct-card-file').click();
      });
    });
    $('miya-ct-doc-import').addEventListener('click', function () { $('miya-ct-doc-file').click(); });
    $('miya-ct-editor-back').addEventListener('click', closeEditor);
    $('miya-ct-save').addEventListener('click', saveEditor);
    $('miya-ct-delete').addEventListener('click', deleteEditing);

    $('miya-ct-search').addEventListener('input', function () {
      searchQuery = this.value || '';
      renderGrid();
    });

    $('miya-ct-portrait').addEventListener('click', function () {
      $('miya-ct-avatar-file').click();
    });

    $('miya-ct-avatar-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        draftAvatar = reader.result;
        var img = $('miya-ct-portrait-img');
        var mono = $('miya-ct-portrait-mono');
        if (img) { img.src = draftAvatar; img.hidden = false; }
        if (mono) mono.hidden = true;
      };
      reader.readAsDataURL(f);
    });

    $('miya-ct-avatar-reset').addEventListener('click', function () {
      draftAvatar = null;
      var img = $('miya-ct-portrait-img');
      var mono = $('miya-ct-portrait-mono');
      var name = ($('miya-ct-field-name') || {}).value || '';
      if (img) { img.hidden = true; img.removeAttribute('src'); }
      if (mono) { mono.textContent = monogram(name); mono.hidden = false; }
      var urlIn = $('miya-ct-avatar-url');
      if (urlIn) urlIn.value = '';
    });

    $('miya-ct-avatar-url-apply').addEventListener('click', function () {
      var url = ($('miya-ct-avatar-url') || {}).value ? $('miya-ct-avatar-url').value.trim() : '';
      if (!url) { toast('请填写图片链接'); return; }
      draftAvatar = url;
      var img = $('miya-ct-portrait-img');
      var mono = $('miya-ct-portrait-mono');
      if (img) {
        img.onerror = function () {
          toast('图片链接无效');
          img.onerror = null;
        };
        img.src = url;
        img.hidden = false;
      }
      if (mono) mono.hidden = true;
    });

    $('miya-ct-doc-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) importDocToPersona(f);
    });

    $('miya-ct-card-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) importCardFile(f);
    });

    $('miya-ct-field-group').addEventListener('change', function () {
      var wrap = $('miya-ct-new-group-wrap');
      if (wrap) wrap.hidden = this.value !== '__new__';
    });

    $('miya-ct-wb-jump').addEventListener('click', function () {
      if (global.miyaWorldbookApp && global.miyaWorldbookApp.open) {
        closeContactsApp();
        global.miyaWorldbookApp.open();
      }
    });

    root.addEventListener('click', function (e) {
      var groupBtn = e.target.closest('[data-ct-group]');
      if (groupBtn) {
        filterGroupId = groupBtn.getAttribute('data-ct-group') || 'all';
        renderList();
        return;
      }
      if (e.target.closest('[data-ct-group-add]')) {
        promptNewGroup();
        return;
      }
      var delGroupBtn = e.target.closest('[data-ct-group-del]');
      if (delGroupBtn) {
        promptDeleteGroup(delGroupBtn.getAttribute('data-ct-group-del'));
        return;
      }
      var panel = e.target.closest('[data-ct-id]');
      if (panel) {
        var row = store.findCharacter(panel.getAttribute('data-ct-id'));
        if (row) { clearPendingImport(); fillEditor(row); }
      }
    });
  }

  function openContactsApp() {
    var app = $('miya-contacts-app');
    if (!app || !store) return;
    Promise.all([
      store.whenReady(),
      relStore ? relStore.whenReady() : Promise.resolve()
    ]).then(function () {
      bindEvents();
      closeEditor();
      app.classList.add('is-open');
      app.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      requestAnimationFrame(function () { renderList(); });
    });
  }

  function closeContactsApp() {
    var app = $('miya-contacts-app');
    if (!app) return;
    closeEditor();
    app.classList.remove('is-open');
    app.setAttribute('aria-hidden', 'true');
    if (global.miyaChatApp && global.miyaChatApp.invalidateStore) {
      global.miyaChatApp.invalidateStore();
    }
    if (!document.querySelector('.miya-beautify-app.is-open, .miya-settings-app.is-open, .miya-worldbook-app.is-open, .miya-music-app.is-open, .miya-chat-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  global.miyaContactsApp = {
    open: openContactsApp,
    close: closeContactsApp,
    toast: toast
  };
})(window);
