/**
 * Miya 聊天 · 我的（人设 / 表情包 / 装扮）
 */
(function (global) {
  'use strict';

  var store = null;
  var stackEl = null;
  var navStack = [];
  var avatarUrls = {};

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaChatApp && global.miyaChatApp.toast) {
      global.miyaChatApp.toast(msg);
      return;
    }
    var el = stackEl && stackEl.querySelector('.mi-toast');
    if (el) {
      el.textContent = msg;
      el.classList.add('is-show');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2200);
    }
  }

  function dialog(opts) {
    if (global.miyaDialog) {
      if (opts.mode === 'confirm' && global.miyaDialog.confirm) return global.miyaDialog.confirm(opts);
      if (global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(opts.defaultValue != null ? opts.defaultValue : null);
  }

  function confirmDialog(title, message) {
    return dialog({ mode: 'confirm', title: title, message: message, confirmText: '确定', cancelText: '取消' });
  }

  var emoModalState = null;

  function emojiUrlParser() {
    return global.miyaChatEmojiUrl || null;
  }

  function escAttr(s) {
    return esc(s).replace(/[\r\n\u2028\u2029]/g, '');
  }

  function buildUrlImportRowsFromState(host, stateRows, resolveFn) {
    var overrides = {};
    if (host) {
      host.querySelectorAll('[data-mq-emo-preview-name-in]').forEach(function (inp) {
        var key = inp.getAttribute('data-mq-emo-preview-idx');
        if (key == null || key === '') return;
        overrides[key] = inp.value;
      });
    }
    var localTaken = store.collectEmojiNameSet();
    var importRows = [];
    (stateRows || []).forEach(function (src, i) {
      if (!src) return;
      var url = String(src.url || '').trim();
      if (!url) return;
      var key = src.idx != null ? String(src.idx) : String(i);
      var preferred = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : src.name;
      var nm;
      if (resolveFn) {
        nm = resolveFn(preferred, url, localTaken, { fallback: '表情' + (i + 1) });
      } else {
        nm = String(preferred || src.name || '表情' + (i + 1)).trim() || '表情' + (i + 1);
      }
      importRows.push({ name: nm, url: url });
    });
    return importRows;
  }

  function defaultUrlPackLabel(importRows) {
    if (!importRows || !importRows.length) return 'URL导入';
    if (importRows.length === 1) return importRows[0].name || 'URL导入';
    return (importRows[0].name || '表情') + ' 等' + importRows.length + '张';
  }

  function emoModalCard(host) {
    return host ? (host.querySelector('.mi-sheet-card') || host) : null;
  }

  function bindEmoModalHost(host) {
    if (!host || host._mqEmoHostBound) return;
    host._mqEmoHostBound = true;
    host.addEventListener('click', function (e) {
      if (!host.classList.contains('is-open')) return;
      if (e.target.closest('[data-mq-emo-modal-close]')) {
        e.preventDefault();
        closeEmoModal();
      }
    });
  }

  function ensureEmoModalHost() {
    var host = $('mq-emo-modal');
    var mount = $('miya-chat-app') || $('miya-phone-layer') || document.body;
    if (!host) {
      host = document.createElement('div');
      host.className = 'mi-emo-modal';
      host.id = 'mq-emo-modal';
      host.setAttribute('aria-hidden', 'true');
      mount.appendChild(host);
      bindEmoModalHost(host);
    } else {
      if (host.parentNode !== mount) mount.appendChild(host);
      bindEmoModalHost(host);
    }
    return host;
  }

  function closeEmoModal() {
    var host = $('mq-emo-modal');
    if (!host) return;
    host.classList.remove('is-open');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = '';
    emoModalState = null;
  }

  function openEmoModal(html, onBind, cardClass) {
    var host = ensureEmoModalHost();
    if (!host) return;
    var cardCls = 'mi-sheet-card' + (cardClass ? ' ' + cardClass : '');
    host.innerHTML =
      '<div class="mi-emo-modal__backdrop" data-mq-emo-modal-close></div>' +
      '<div class="' + cardCls + '" role="dialog" aria-modal="true">' + html + '</div>';
    host.classList.add('is-open');
    host.setAttribute('aria-hidden', 'false');
    if (typeof onBind === 'function') onBind(host);
  }

  function hydrateEmoModalThumbs(root) {
    if (!root || !store) return;
    root.querySelectorAll('[data-mq-emo-thumb-url]').forEach(function (el) {
      var direct = el.getAttribute('data-mq-emo-thumb-url');
      if (direct) el.style.backgroundImage = 'url("' + direct.replace(/"/g, '') + '")';
    });
    root.querySelectorAll('[data-mq-emo-thumb]').forEach(function (el) {
      if (el.getAttribute('data-mq-emo-thumb-url')) return;
      var bid = el.getAttribute('data-mq-emo-thumb');
      if (!bid) return;
      store.getEmojiItemUrl(bid).then(function (url) {
        if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
    root.querySelectorAll('[data-mq-emo-preview-url]').forEach(function (el) {
      var u = el.getAttribute('data-mq-emo-preview-url');
      if (u) el.style.backgroundImage = 'url("' + u.replace(/"/g, '') + '")';
    });
  }

  function submitNewEmojiGroup(grpName) {
    if (!store) store = global.miyaChatStore;
    if (!store || typeof store.addEmojiGroup !== 'function') {
      toast('存储未就绪，请稍后再试');
      return Promise.resolve();
    }
    var name = String(grpName || '').trim();
    if (!name) {
      toast('请填写分组名称');
      return Promise.resolve();
    }
    return store.addEmojiGroup(name).then(function (g) {
      toast('分组已添加');
      if (navStack.length && navStack[navStack.length - 1].screen === 'emoji') {
        if (!navStack[navStack.length - 1].data.expandedGroups) {
          navStack[navStack.length - 1].data.expandedGroups = {};
        }
        navStack[navStack.length - 1].data.expandedGroups[g.id] = true;
      }
      renderTop();
    }).catch(function (err) {
      if (err && err.message === 'name_required') toast('请填写分组名称');
      else if (err && err.message === 'store_not_ready') toast('存储未就绪，请稍后再试');
      else toast('创建失败');
    });
  }

  function openAddEmojiGroupModal() {
    closeEmoModal();
    dialog({
      mode: 'prompt',
      title: '添加分组',
      message: '给这个表情分组取个名字',
      placeholder: '日常、恋人专属…',
      confirmText: '添加',
      cancelText: '取消'
    }).then(function (name) {
      if (name == null || name === '') return;
      submitNewEmojiGroup(name);
    });
  }

  function countGroupStickers(gid) {
    var n = 0;
    store.getEmojiPacks(gid).forEach(function (pk) {
      n += (pk.items || []).length;
    });
    return n;
  }

  function renderStickerCell(it, packId, groupId, deleteMode) {
    if (!it) return '';
    var thumb = it.url
      ? ' data-mq-emo-thumb-url="' + esc(it.url) + '"'
      : ' data-mq-emo-thumb="' + esc(it.blobId) + '"';
    if (deleteMode) {
      return '<div class="mi-emo-cell-wrap">' +
        '<div class="mi-emo-cell"' + thumb + ' aria-hidden="true"></div>' +
        '<button type="button" class="mi-emo-cell__del" data-mq-emo-quick-del-item="' + esc(it.id) +
        '" data-mq-emo-quick-del-pack="' + esc(packId) + '" aria-label="删除 ' + esc(it.name || '表情') + '">×</button>' +
        '</div>';
    }
    return '<button type="button" class="mi-emo-cell"' + thumb +
      ' data-mq-emo-longpress data-mq-emo-item-id="' + esc(it.id) + '" data-mq-emo-pack-id="' + esc(packId) +
      '" data-mq-emo-group-id="' + esc(groupId) + '" data-mq-emo-item-name="' + esc(it.name || '') +
      '" aria-label="' + esc(it.name || '表情') + '"></button>';
  }

  function renderGroupAccordion(g, expandedMap, deleteMode) {
    var gid = g.id;
    var isOpen = deleteMode || !!(expandedMap && expandedMap[gid]);
    var cells = [];
    store.getEmojiPacks(gid).forEach(function (pk) {
      (pk.items || []).forEach(function (it) {
        cells.push(renderStickerCell(it, pk.id, gid, deleteMode));
      });
    });
    var count = cells.length;
    var grpDelBtn = deleteMode && gid !== 'default'
      ? '<button type="button" class="mi-emo-acc__grp-del" data-mq-emo-quick-del-group="' + esc(gid) +
        '" aria-label="删除分组">×</button>'
      : '';
    var headInner =
      '<span class="mi-emo-acc__name">' + esc(g.name) + '</span>' +
      '<span class="mi-emo-acc__meta">' + count + ' 张</span>' +
      (deleteMode ? grpDelBtn : '<span class="mi-emo-acc__chev" aria-hidden="true">' + (isOpen ? '−' : '+') + '</span>');
    var head = deleteMode
      ? '<div class="mi-emo-acc__head mi-emo-acc__head--static">' + headInner + '</div>'
      : '<button type="button" class="mi-emo-acc__head" data-mq-emo-acc-toggle="' + esc(gid) + '">' + headInner + '</button>';
    return '<section class="mi-emo-acc' + (isOpen ? ' is-open' : '') + (deleteMode ? ' is-delete-mode' : '') +
      '" data-mq-emo-acc="' + esc(gid) + '">' + head +
      (isOpen
        ? '<div class="mi-emo-acc__body">' +
          (cells.length
            ? '<div class="mi-emo-acc__grid">' + cells.join('') + '</div>'
            : '<p class="mi-empty-hint mi-emo-acc__empty">还没有表情</p>') +
          (deleteMode ? '' : '<div class="mi-emo-acc__import">' +
            '<button type="button" class="mi-pill" data-mq-emo-grp-import-url="' + esc(gid) + '">链接导入</button>' +
            '<button type="button" class="mi-pill mi-pill--dark" data-mq-emo-grp-import-album="' + esc(gid) + '">相册导入</button>' +
            (gid !== 'default'
              ? '<button type="button" class="mi-pill mi-pill--ghost mi-emo-acc__del-grp" data-mq-emo-del-group="' + esc(gid) + '">删除分组</button>'
              : '') +
            '</div>') +
          '</div>'
        : '') +
      '</section>';
  }

  function expandAllEmojiGroups(data) {
    data = data || {};
    data.expandedGroups = {};
    store.getEmojiGroups().forEach(function (g) {
      data.expandedGroups[g.id] = true;
    });
    return data;
  }

  function promptDeleteEmojiGroup(gid) {
    if (!store) store = global.miyaChatStore;
    if (!store || typeof store.deleteEmojiGroup !== 'function') {
      toast('存储未就绪，请稍后再试');
      return;
    }
    var id = String(gid || '').trim();
    if (!id || id === 'default') {
      toast('默认分组不能删除');
      return;
    }
    var grp = store.getEmojiGroups().find(function (x) { return x.id === id; });
    var grpName = grp ? grp.name : '分组';
    confirmDialog('删除分组', '确定删除「' + grpName + '」？组内表情将移至默认分组').then(function (ok) {
      if (!ok) return;
      store.deleteEmojiGroup(id).then(function () {
        toast('分组已删除');
        if (navStack.length && navStack[navStack.length - 1].screen === 'emoji') {
          var data = navStack[navStack.length - 1].data || {};
          if (data.expandedGroups) delete data.expandedGroups[id];
          if (data.deleteMode) data.deleteMode = false;
          navStack[navStack.length - 1].data = data;
        }
        renderTop();
      }).catch(function (err) {
        if (err && err.message === 'default_group') toast('默认分组不能删除');
        else toast('删除失败');
      });
    });
  }

  function enterEmojiDeleteMode() {
    if (!navStack.length) return;
    var top = navStack[navStack.length - 1];
    if (!top || top.screen !== 'emoji') return;
    var data = top.data || {};
    data.deleteMode = true;
    expandAllEmojiGroups(data);
    top.data = data;
    renderTop();
  }

  function exitEmojiDeleteMode() {
    if (!navStack.length) return;
    var top = navStack[navStack.length - 1];
    if (!top || top.screen !== 'emoji') return;
    var data = top.data || {};
    data.deleteMode = false;
    top.data = data;
    renderTop();
  }

  function syncEmojiHubChrome(data) {
    if (!stackEl) return;
    var del = !!(data && data.deleteMode);
    stackEl.classList.toggle('mi-me--emo-delete', del);
    var closeBtn = stackEl.querySelector('[data-mq-me-close]');
    if (closeBtn) {
      closeBtn.textContent = del ? '完成' : '×';
      closeBtn.classList.toggle('mi-me-header__close--done', del);
      closeBtn.setAttribute('aria-label', del ? '完成' : '关闭');
    }
    setHead(del ? '删除' : '表情', del ? '点击 × 快速删除' : '表情包');
  }

  function toggleExpandedGroup(gid) {
    if (!navStack.length) return;
    var data = navStack[navStack.length - 1].data || {};
    if (!data.expandedGroups) data.expandedGroups = {};
    if (data.expandedGroups[gid]) delete data.expandedGroups[gid];
    else data.expandedGroups[gid] = true;
    navStack[navStack.length - 1].data = data;
    renderTop();
  }

  function bindEmojiLongPress(root) {
    if (!root) return;
    var top = navStack[navStack.length - 1];
    if (top && top.data && top.data.deleteMode) return;
    root.querySelectorAll('[data-mq-emo-longpress]').forEach(function (el) {
      if (el._mqEmoLp) return;
      el._mqEmoLp = true;
      var timer = null;
      function clearTimer() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
      function onStart(e) {
        if (e.type === 'mousedown' && e.button !== 0) return;
        clearTimer();
        timer = setTimeout(function () {
          timer = null;
          enterEmojiDeleteMode();
        }, 520);
      }
      el.addEventListener('touchstart', onStart, { passive: true });
      el.addEventListener('mousedown', onStart);
      el.addEventListener('touchend', clearTimer);
      el.addEventListener('touchcancel', clearTimer);
      el.addEventListener('mouseup', clearTimer);
      el.addEventListener('mouseleave', clearTimer);
    });
  }

  function openUrlImportPreviewModal(gid, raw) {
    var parser = emojiUrlParser();
    if (!parser || typeof parser.parseEmojiBatchUrlText !== 'function') {
      toast('URL 解析模块未加载');
      return;
    }
    var batch = parser.parseEmojiBatchUrlText(raw);
    if (!batch.rows.length) {
      toast('未解析到有效行，请使用「名称:URL」格式');
      return;
    }
    var taken = store.collectEmojiNameSet();
    var resolve = typeof parser.resolveEmojiImportName === 'function' ? parser.resolveEmojiImportName : null;
    var rows = batch.rows.map(function (row, idx) {
      var nm = resolve
        ? resolve(row.name, row.url, taken, { fallback: '表情' + (idx + 1) })
        : String(row.name || '').trim() || '表情' + (idx + 1);
      return { idx: idx, name: nm, url: row.url, rawName: row.name };
    });
    var listHtml = rows.map(function (r) {
      return '<article class="mi-import-card">' +
        '<div class="mi-import-card__img" data-mq-emo-preview-url="' + escAttr(r.url) + '"></div>' +
        '<div class="mi-import-card__form">' +
        '<input type="text" class="mi-input" data-mq-emo-preview-name-in data-mq-emo-preview-idx="' +
        r.idx + '" value="' + escAttr(r.name) + '" placeholder="表情名称">' +
        '<p class="mi-import-card__hint">发送时：表情包-' + esc(r.name) + '</p>' +
        '</div></article>';
    }).join('');
    emoModalState = { kind: 'url', gid: gid, rows: rows };
    openEmoModal(
      '<header class="mi-sheet-head">' +
      '<h4 class="mi-sheet-head__title">确认导入 · ' + rows.length + ' 张</h4>' +
      '<button type="button" class="mi-sheet-head__x" data-mq-emo-modal-close>×</button></header>' +
      '<div class="mi-sheet-body mi-sheet-body--cards">' + listHtml + '</div>' +
      '<footer class="mi-sheet-foot mi-sheet-foot--row">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-emo-modal-close>返回</button>' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-emo-url-confirm>导入</button></footer>',
      function (host) {
        hydrateEmoModalThumbs(host);
        host.querySelector('[data-mq-emo-url-confirm]').addEventListener('click', function (e) {
          e.preventDefault();
          var state = emoModalState;
          if (!state || state.kind !== 'url' || !state.rows || !state.rows.length) {
            toast('预览已失效，请重新打开');
            return;
          }
          var resolveFn = parser && typeof parser.resolveEmojiImportName === 'function'
            ? parser.resolveEmojiImportName : null;
          var importRows = buildUrlImportRowsFromState(host, state.rows, resolveFn);
          if (!importRows.length) {
            toast('没有可导入的表情');
            return;
          }
          var packNm = defaultUrlPackLabel(importRows);
          toast('正在导入…');
          store.importEmojiPackFromRows(state.gid, packNm, importRows).then(function (res) {
            toast('已添加 ' + (res.added || 0) + ' 张');
            closeEmoModal();
            var importedGid = state.gid;
            if (navStack.length && navStack[navStack.length - 1].screen === 'emoji-import-url') pop();
            if (navStack.length && navStack[navStack.length - 1].screen === 'emoji') {
              if (!navStack[navStack.length - 1].data.expandedGroups) {
                navStack[navStack.length - 1].data.expandedGroups = {};
              }
              navStack[navStack.length - 1].data.expandedGroups[importedGid] = true;
            }
            renderTop();
          }).catch(function (err) {
            if (err && err.message === 'no_items') toast('没有可导入的表情');
            else toast('导入失败');
          });
        });
      }
    );
  }

  function openImageImportPreviewModal(gid, files) {
    var parser = emojiUrlParser();
    var resolve = parser && typeof parser.resolveEmojiImportName === 'function'
      ? parser.resolveEmojiImportName : null;
    var norm = parser && typeof parser.normalizeEmojiStickerName === 'function'
      ? parser.normalizeEmojiStickerName
      : function (s) { return String(s || '').trim(); };
    var taken = store.collectEmojiNameSet();
    var entries = [];
    Array.from(files || []).forEach(function (file, i) {
      if (!file || (file.type || '').indexOf('image') !== 0) return;
      var preferred = norm((file.name || '表情' + (i + 1)).replace(/\.[^.]+$/, '')) || '表情' + (i + 1);
      var finalName = resolve ? resolve(preferred, null, taken, { fallback: '表情' + (i + 1) }) : preferred;
      var previewUrl = '';
      try { previewUrl = URL.createObjectURL(file); } catch (e) {}
      entries.push({ file: file, name: finalName, previewUrl: previewUrl });
    });
    if (!entries.length) {
      toast('请选择图片');
      return;
    }
    var listHtml = entries.map(function (ent, i) {
      return '<article class="mi-import-card">' +
        '<div class="mi-import-card__img" data-mq-emo-preview-url="' + esc(ent.previewUrl) + '"></div>' +
        '<div class="mi-import-card__form">' +
        '<input type="text" class="mi-input" data-mq-emo-preview-name-in data-mq-emo-img-idx="' + i +
        '" value="' + esc(ent.name) + '">' +
        '<p class="mi-import-card__hint">表情包-<span data-mq-emo-fmt-name="' + i + '">' + esc(ent.name) + '</span></p>' +
        '</div></article>';
    }).join('');
    var basePack = (entries[0].file.name || '表情包').replace(/\.[^.]+$/, '');
    emoModalState = { kind: 'img', gid: gid, entries: entries, urls: entries.map(function (e) { return e.previewUrl; }) };
    openEmoModal(
      '<header class="mi-sheet-head">' +
      '<h4 class="mi-sheet-head__title">确认图片导入</h4>' +
      '<button type="button" class="mi-sheet-head__x" data-mq-emo-modal-close>×</button></header>' +
      '<div class="mi-sheet-body">' +
      fieldBlock('表情包名称', '', '<input type="text" class="mi-input" data-mq-emo-preview-pack-name value="' + esc(basePack) + '">') +
      '<div class="mi-sheet-body--cards">' + listHtml + '</div></div>' +
      '<footer class="mi-sheet-foot mi-sheet-foot--row">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-emo-modal-close>取消</button>' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-emo-img-confirm>导入</button></footer>',
      function (host) {
        hydrateEmoModalThumbs(host);
        host.querySelectorAll('[data-mq-emo-preview-name-in]').forEach(function (inp) {
          inp.addEventListener('input', function () {
            var ix = inp.getAttribute('data-mq-emo-img-idx');
            var span = host.querySelector('[data-mq-emo-fmt-name="' + ix + '"]');
            if (span) span.textContent = norm(inp.value) || '未命名';
          });
        });
        host.querySelector('[data-mq-emo-img-confirm]').addEventListener('click', function (e) {
          e.preventDefault();
          var packNmEl = host.querySelector('[data-mq-emo-preview-pack-name]');
          var packNm = packNmEl ? String(packNmEl.value || '').trim() : '';
          if (!packNm) {
            toast('请填写表情包名称');
            return;
          }
          var resolveFn = parser && typeof parser.resolveEmojiImportName === 'function'
            ? parser.resolveEmojiImportName : null;
          var importEntries = [];
          var localTaken = store.collectEmojiNameSet();
          host.querySelectorAll('[data-mq-emo-preview-name-in]').forEach(function (inp) {
            var ix = parseInt(inp.getAttribute('data-mq-emo-img-idx'), 10);
            var ent = entries[ix];
            if (!ent || !ent.file) return;
            var nm = resolveFn
              ? resolveFn(inp.value, null, localTaken, { fallback: '表情' + (ix + 1) })
              : norm(inp.value) || '表情' + (ix + 1);
            importEntries.push({ file: ent.file, name: nm });
          });
          if (!importEntries.length) {
            toast('没有可导入的表情');
            return;
          }
          toast('正在导入…');
          store.importEmojiPackFromFilesWithNames(emoModalState.gid, packNm, importEntries).then(function () {
            if (emoModalState && emoModalState.urls) {
              emoModalState.urls.forEach(function (u) {
                try { URL.revokeObjectURL(u); } catch (e2) {}
              });
            }
            var imgGid = emoModalState && emoModalState.gid;
            toast('导入完成');
            closeEmoModal();
            if (navStack.length && navStack[navStack.length - 1].screen === 'emoji-import-url') pop();
            if (imgGid && navStack.length && navStack[navStack.length - 1].screen === 'emoji') {
              if (!navStack[navStack.length - 1].data.expandedGroups) {
                navStack[navStack.length - 1].data.expandedGroups = {};
              }
              navStack[navStack.length - 1].data.expandedGroups[imgGid] = true;
            }
            renderTop();
          }).catch(function (err) {
            toast(err && err.message === 'no_images' ? '请选择图片' : '导入失败');
          });
        });
      }
    );
  }

  function fallbackAvatar(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#EDE8E0"/><stop offset="100%" stop-color="#D8D0C4"/></linearGradient></defs>' +
      '<rect width="120" height="120" rx="8" fill="url(#g)"/>' +
      '<text x="60" y="72" text-anchor="middle" font-family="Georgia,serif" font-size="42" fill="#7A7268">' + ch + '</text></svg>'
    );
  }

  function loadAvatar(profile, cb) {
    if (!profile || !profile.avatarId) {
      cb(fallbackAvatar(profile && profile.name));
      return;
    }
    if (avatarUrls[profile.avatarId]) {
      cb(avatarUrls[profile.avatarId]);
      return;
    }
    store.getAvatarUrl(profile.avatarId).then(function (url) {
      avatarUrls[profile.avatarId] = url || fallbackAvatar(profile.name);
      cb(avatarUrls[profile.avatarId]);
    });
  }

  function ensureStack() {
    if (stackEl) return stackEl;
    var app = $('miya-chat-app');
    stackEl = document.createElement('div');
    stackEl.className = 'mi-me-page';
    stackEl.id = 'mq-me-stack';
    stackEl.hidden = true;
    stackEl.setAttribute('aria-hidden', 'true');
    stackEl.innerHTML =
      '<div class="mi-me-page__veil" aria-hidden="true"></div>' +
      '<div class="mi-me-page__shell">' +
        '<header class="mi-album-header mi-album-header--detail mi-me-header">' +
          '<div class="mi-album-header__side">' +
            '<button type="button" class="mi-album-icon-btn" data-mq-me-back aria-label="返回">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6" stroke-linecap="round"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="mi-album-header__center">' +
            '<h2 class="mi-album-header__album-title" data-mq-me-title>我的</h2>' +
            '<span class="mi-album-header__album-date" data-mq-me-kicker>我的</span>' +
          '</div>' +
          '<div class="mi-album-header__side">' +
            '<button type="button" class="mi-album-icon-btn mi-album-icon-btn--ghost mi-me-header__close" data-mq-me-close aria-label="关闭">×</button>' +
          '</div>' +
        '</header>' +
        '<div class="mi-me-body" data-mq-me-body></div>' +
      '</div>' +
      '<div class="mi-toast"></div>';
    if (app) app.appendChild(stackEl);
    else document.body.appendChild(stackEl);
    bindStackEvents();
    if (global.MiyaChatAlbum && global.MiyaChatAlbum.bindAlbumEvents) {
      global.MiyaChatAlbum.bindAlbumEvents(
        stackEl,
        function () { return navStack[navStack.length - 1]; },
        function (top) { navStack[navStack.length - 1] = top; },
        renderTop,
        setHead,
        pop
      );
    }
    return stackEl;
  }

  function setHead(kicker, title) {
    var k = stackEl.querySelector('[data-mq-me-kicker]');
    var t = stackEl.querySelector('[data-mq-me-title]');
    if (k) k.textContent = kicker || '';
    if (t) t.textContent = title || '';
  }

  function push(screen, data) {
    navStack.push({ screen: screen, data: data || {} });
    renderTop();
  }

  function pop() {
    if (navStack.length <= 1) {
      close();
      return;
    }
    navStack.pop();
    renderTop();
  }

  function open(initialScreen, data) {
    store = global.miyaChatStore;
    if (!store) return Promise.resolve();
    ensureStack();
    navStack = [];
    push(initialScreen || 'profiles', data || {});
    stackEl.hidden = false;
    stackEl.classList.add('is-open');
    stackEl.setAttribute('aria-hidden', 'false');
    return store.init();
  }

  function close() {
    navStack = [];
    closeEmoModal();
    if (global.MiyaChatBeautify && global.MiyaChatBeautify.clearPreviewCss) {
      global.MiyaChatBeautify.clearPreviewCss();
    }
    if (stackEl) {
      stackEl.classList.remove('is-open');
      stackEl.hidden = true;
      stackEl.setAttribute('aria-hidden', 'true');
    }
  }

  function formatSavedAt(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function resolveFavoriteMessage(item) {
    if (!item) return null;
    if (item.msgSnapshot && typeof item.msgSnapshot === 'object') return item.msgSnapshot;
    if (store && item.chatId && item.messageId && store.findMessage) {
      var hit = store.findMessage(item.chatId, item.messageId);
      if (hit && !hit.deleted && !hit.recalled) return hit;
    }
    return null;
  }

  function renderFavMessageBody(item) {
    var msg = resolveFavoriteMessage(item);
    var room = global.miyaChatRoom;
    if (msg && room && typeof room.renderMessagePreview === 'function') {
      var html = room.renderMessagePreview(msg, item.chatId);
      if (html) {
        return '<div class="mi-fav-card__body mi-fav-card__body--rich">' + html + '</div>';
      }
    }
    var text = String(item.text || '').slice(0, 200);
    return '<p class="mi-fav-card__text">' + esc(text) + '</p>';
  }

  function hydrateFavMedia(root) {
    if (!root || !store) return;
    var room = global.miyaChatRoom;
    if (room && typeof room.hydrateMessageMedia === 'function') {
      room.hydrateMessageMedia(root);
      return;
    }
    var imgIds = [];
    root.querySelectorAll('[data-msg-img]').forEach(function (el) {
      var key = el.getAttribute('data-msg-img');
      if (!key || el.src) return;
      imgIds.push(key);
    });
    var stickerIds = [];
    root.querySelectorAll('[data-msg-sticker]').forEach(function (el) {
      var key = el.getAttribute('data-msg-sticker');
      if (!key || el.src) return;
      stickerIds.push(key);
    });
    function applyUrls(selector, attr, map) {
      root.querySelectorAll(selector).forEach(function (el) {
        var key = el.getAttribute(attr);
        if (!key || el.src) return;
        var url = map[key];
        if (url) el.src = url;
      });
    }
    if (stickerIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(stickerIds).then(function (map) {
        applyUrls('[data-msg-sticker]', 'data-msg-sticker', map);
      });
    }
    if (imgIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(imgIds).then(function (map) {
        applyUrls('[data-msg-img]', 'data-msg-img', map);
      });
    }
    var htmlApi = global.MiyaChatHtml;
    if (htmlApi && typeof htmlApi.hydrateChatHtmlIframesInContainer === 'function') {
      htmlApi.hydrateChatHtmlIframesInContainer(root);
    }
  }

  function renderFavorites() {
    var list = store.getSavedMessages ? store.getSavedMessages() : [];
    setHead('收藏', '我的收藏');
    if (!list.length) {
      return '<div class="mi-me-flow"><p class="mi-empty-hint">还没有收藏的消息</p></div>';
    }
    return '<div class="mi-me-flow mi-fav-list">' + list.map(function (item) {
      var who = item.from || (item.role === 'user' ? '我' : 'Ta');
      var chatLabel = item.chatName ? esc(item.chatName) + ' · ' : '';
      var rich = !!(item.msgSnapshot || (item.chatId && item.messageId));
      return '<article class="mi-fav-card' + (rich ? ' mi-fav-card--rich' : '') + '" data-mq-fav-open="' + esc(item.chatId || '') + '">' +
        '<div class="mi-fav-card__head">' +
          '<span class="mi-fav-card__meta">' + chatLabel + esc(who) + '</span>' +
          '<time class="mi-fav-card__time">' + esc(formatSavedAt(item.savedAt)) + '</time>' +
        '</div>' +
        renderFavMessageBody(item) +
        '<button type="button" class="mi-fav-card__del" data-mq-fav-del="' + esc(item.id) + '" aria-label="取消收藏">×</button>' +
      '</article>';
    }).join('') + '</div>';
  }

  function renderWallpapers() {
    var list = store.getChatWallpapers ? store.getChatWallpapers() : [];
    setHead('我的', '壁纸管理');
    var grid = list.length
      ? '<div class="mi-wall-lib__grid mi-wall-lib__grid--manage">' +
          list.map(function (wp) {
            var thumb = wp.url
              ? ' data-mq-wall-thumb-url="' + escAttr(wp.url) + '"'
              : ' data-mq-wall-thumb-blob="' + escAttr(wp.blobId) + '"';
            return '<div class="mi-wall-manage-cell">' +
              '<div class="mi-wall-lib-cell mi-wall-lib-cell--manage"' + thumb + '></div>' +
              '<button type="button" class="mi-wall-manage-cell__del" data-mq-wall-del="' + esc(wp.id) + '" aria-label="删除">×</button>' +
            '</div>';
          }).join('') +
        '</div>'
      : '<p class="mi-empty-hint">还没有壁纸，点击下方上传</p>';
    return '<div class="mi-me-flow mi-wall-manage">' +
      grid +
      '<div class="mi-wall-manage__actions">' +
        '<button type="button" class="mi-pill mi-pill--dark" data-mq-wall-upload>上传壁纸</button>' +
        '<p class="st-form-hint mi-wall-manage__hint">支持一次选择多张，壁纸可在聊天设置的「聊天背景」中快捷选用</p>' +
      '</div>' +
      '<input type="file" accept="image/*" multiple hidden data-mq-wall-import>' +
    '</div>';
  }

  function hydrateWallpaperThumbs(root) {
    if (!root || !store) return;
    root.querySelectorAll('[data-mq-wall-thumb-url]').forEach(function (el) {
      var url = el.getAttribute('data-mq-wall-thumb-url');
      if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
    });
    root.querySelectorAll('[data-mq-wall-thumb-blob]').forEach(function (el) {
      var bid = el.getAttribute('data-mq-wall-thumb-blob');
      if (!bid) return;
      store.getChatWallpaperUrl({ blobId: bid }).then(function (url) {
        if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function formatWalletBalance(profileId) {
    if (!store || !store.getWallet) return '¥0';
    var w = store.getWallet(profileId);
    var fmt = global.MiyaChatWallet && global.MiyaChatWallet.formatDisplay;
    return fmt ? fmt(w.balance) : ('¥' + (Number(w.balance) || 0));
  }

  function formatWalletAmount(profileId) {
    if (!store || !store.getWallet) return '0';
    var w = store.getWallet(profileId);
    var fmt = global.MiyaChatWallet && global.MiyaChatWallet.formatMoney;
    return fmt ? fmt(w.balance) : String(Number(w.balance) || 0);
  }

  function walletNoteHtml(text) {
    return '<div class="mi-wallet-note">' +
      '<span class="mi-wallet-note__icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="14" r="1" fill="currentColor"/></svg>' +
      '</span>' +
      '<p>' + esc(text) + '</p>' +
    '</div>';
  }

  function walletCardHtml(opts) {
    var o = opts || {};
    var compact = !!o.compact;
    var hero = !!o.hero;
    var interactive = o.interactive !== false;
    var cls = 'mi-wcard' +
      (compact ? ' mi-wcard--compact' : '') +
      (hero ? ' mi-wcard--hero' : '') +
      (o.active ? ' is-active' : '') +
      (!interactive ? ' mi-wcard--static' : '');
    var tag = o.tag ? '<span class="mi-wcard__badge">' + esc(o.tag) + '</span>' : '';
    var ava = o.avatarId
      ? '<div class="mi-wcard__ava mi-ava" data-mq-prof-ava="' + esc(o.avatarId) + '"><span class="mi-ava__shine"></span></div>'
      : '';
    var link = o.linkLabel && o.openProfileId
      ? '<button type="button" class="mi-wcard__action" data-mq-wallet-open="' + esc(o.openProfileId) + '">' + esc(o.linkLabel) + ' ›</button>'
      : '';
    var openAttr = interactive && o.openProfileId ? ' data-mq-wallet-open="' + esc(o.openProfileId) + '"' : '';
    var stackStyle = typeof o.stackIndex === 'number' ? ' style="z-index:' + (o.stackIndex + 1) + '"' : '';
    var inner =
      '<span class="mi-wcard__grain" aria-hidden="true"></span>' +
      '<span class="mi-wcard__shine" aria-hidden="true"></span>' +
      '<span class="mi-wcard__chip" aria-hidden="true"></span>' +
      '<div class="mi-wcard__head">' +
        '<span class="mi-wcard__brand">MIYA WALLET</span>' +
        ava +
      '</div>' +
      '<div class="mi-wcard__body">' +
        '<span class="mi-wcard__label">' + esc(o.label || '可用余额') + '</span>' +
        '<p class="mi-wcard__amount"><em>¥</em>' + esc(o.amount || '0') + '</p>' +
      '</div>' +
      '<div class="mi-wcard__foot">' +
        '<span class="mi-wcard__holder">' + esc(o.holder || '') + '</span>' +
        tag +
      '</div>' +
      link;
    if (interactive) {
      return '<button type="button" class="' + cls + '"' + openAttr + stackStyle + '>' + inner + '</button>';
    }
    return '<article class="' + cls + '"' + stackStyle + '>' + inner + '</article>';
  }

  function renderWallet() {
    var profiles = store.getProfiles().slice();
    var active = store.getActiveProfile();
    if (active) {
      profiles.sort(function (a, b) {
        if (a.id === active.id) return 1;
        if (b.id === active.id) return -1;
        return 0;
      });
    }
    setHead('钱包', '面具钱包');
    var cards = profiles.map(function (p, i) {
      var isOn = active && active.id === p.id;
      return walletCardHtml({
        active: isOn,
        openProfileId: p.id,
        avatarId: p.id,
        amount: formatWalletAmount(p.id),
        holder: p.name,
        label: '可用余额',
        tag: isOn ? '使用中' : '',
        stackIndex: i
      });
    }).join('');
    return '<div class="mi-me-flow mi-me-flow--wallet">' +
      '<div class="mi-wallet-stack">' + cards + '</div>' +
      walletNoteHtml('每个面具拥有独立余额，聊天转账会从此处扣款或入账') +
    '</div>';
  }

  function renderWalletDetail(profileId) {
    var p = store.getProfiles().find(function (x) { return x.id === profileId; }) || store.getActiveProfile();
    if (!p) return '<div class="mi-empty-hint">未找到</div>';
    var balStr = formatWalletAmount(p.id);
    setHead('钱包 · ' + (p.name || ''), p.name || '面具');
    return '<div class="mi-me-flow mi-me-flow--wallet">' +
      walletCardHtml({
        hero: true,
        interactive: false,
        active: true,
        avatarId: p.id,
        amount: balStr,
        holder: p.name,
        label: '可用余额 · ' + (p.name || '面具'),
        tag: 'MASK'
      }) +
      walletNoteHtml('向角色转账时从此面具扣款；收到角色转账时入账此面具。不同面具之间余额不互通。') +
      '<div class="mi-wallet-actions">' +
        '<button type="button" class="mi-btn mi-btn--ghost" data-mq-wallet-adjust="' + esc(p.id) + '">调整余额</button>' +
        '<button type="button" class="mi-btn mi-btn--dark" data-mq-prof-open="' + esc(p.id) + '">编辑面具</button>' +
      '</div>' +
    '</div>';
  }

  function renderProfileList() {
    var profiles = store.getProfiles();
    var active = store.getActiveProfile();

    setHead('人设', '我的人设');
    return '<div class="mi-me-flow">' +
      '<p class="mi-me-lead">多个面具，随时切换聊天身份</p>' +
      '<div class="mi-mask-list">' + profiles.map(function (p) {
        var isOn = active && active.id === p.id;
        var bal = formatWalletBalance(p.id);
        return '<button type="button" class="mi-mask-card' + (isOn ? ' is-active' : '') + '" data-mq-prof-open="' + esc(p.id) + '">' +
          '<span class="mi-mask-card__glow" aria-hidden="true"></span>' +
          '<div class="mi-ava mi-ava--md" data-mq-prof-ava="' + esc(p.id) + '"><span class="mi-ava__shine"></span></div>' +
          '<div class="mi-mask-card__body">' +
            '<strong>' + esc(p.name) + '</strong>' +
            '<span>' + esc(String(p.persona || '').slice(0, 36) || '还没写人设') + ' · ' + esc(bal) + '</span>' +
          '</div>' +
          (isOn ? '<em class="mi-mask-card__tag">使用中</em>' : '<span class="mi-mask-card__arrow">›</span>') +
        '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="mi-btn mi-btn--dark mi-btn--block" data-mq-prof-create>＋ 新建面具</button>' +
    '</div>';
  }

  function fieldBlock(label, sub, inner) {
    return '<label class="mi-field">' +
      '<span class="mi-field__label">' + esc(label) + '</span>' +
      (sub ? '<span class="mi-field__sub">' + esc(sub) + '</span>' : '') +
      '<div class="mi-field__box">' + inner + '</div>' +
    '</label>';
  }

  function renderProfileEdit(profileId) {
    var p = store.getProfiles().find(function (x) { return x.id === profileId; }) || store.getActiveProfile();
    if (!p) return '<div class="mi-empty-hint">未找到</div>';
    var w = store.getWallet(p.id);
    var fmt = global.MiyaChatWallet && global.MiyaChatWallet.formatMoney;
    var balStr = fmt ? fmt(w.balance) : String(Number(w.balance) || 0);
    setHead('编辑 · ' + (p.name || ''), p.name || '面具');
    return '<div class="mi-me-flow mi-me-flow--wallet">' +
      walletCardHtml({
        compact: true,
        interactive: false,
        avatarId: p.id,
        amount: balStr,
        holder: p.name || '面具',
        label: '此面具钱包',
        linkLabel: '钱包详情',
        openProfileId: p.id
      }) +
      '<div class="mi-edit-top">' +
        '<button type="button" class="mi-edit-top__ava" data-mq-prof-ava-btn="' + esc(p.id) + '">' +
          '<span class="mi-edit-top__orbit" aria-hidden="true"></span>' +
          '<img data-mq-prof-ava="' + esc(p.id) + '" alt="">' +
        '</button>' +
        '<div class="mi-edit-top__tools">' +
          '<button type="button" class="mi-pill mi-pill--ghost" data-mq-prof-ava-reset="' + esc(p.id) + '">恢复默认</button>' +
          '<div class="mi-url-row">' +
            '<input type="url" class="mi-input" data-mq-prof-ava-url="' + esc(p.id) + '" placeholder="图片链接" autocomplete="off">' +
            '<button type="button" class="mi-pill" data-mq-prof-ava-url-apply="' + esc(p.id) + '">应用</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      fieldBlock('名字', '', '<input type="text" class="mi-input" data-mq-f-name value="' + esc(p.name) + '" maxlength="32">') +
      fieldBlock('性别', '', '<input type="text" class="mi-input" data-mq-f-gender value="' + esc(p.gender) + '" placeholder="选填">') +
      fieldBlock('生日', '', '<input type="date" class="mi-input" data-mq-f-birthday value="' + esc(p.birthday) + '">') +
      fieldBlock('人设', '会写进对话上下文', '<textarea class="mi-input mi-input--area" data-mq-f-persona rows="5" placeholder="性格、说话方式、背景…">' + esc(p.persona) + '</textarea>') +
      '<div class="mi-btn-row">' +
        (store.getProfiles().length > 1
          ? '<button type="button" class="mi-btn mi-btn--ghost" data-mq-prof-del="' + esc(p.id) + '">删除</button>'
          : '') +
        '<button type="button" class="mi-btn mi-btn--ghost" data-mq-prof-use="' + esc(p.id) + '">设为当前</button>' +
        '<button type="button" class="mi-btn mi-btn--dark" data-mq-prof-save="' + esc(p.id) + '">保存</button>' +
      '</div>' +
      '<input type="file" accept="image/*" hidden data-mq-prof-file="' + esc(p.id) + '">' +
    '</div>';
  }

  function renderDressEmojiHub() {
    setHead('我的', '装扮与表情');
    return '<div class="mi-me-flow mi-dress-hub">' +
      '<p class="mi-me-lead">软件外观、表情包与心声模版</p>' +
      '<button type="button" class="mi-dress-hub__item" data-mq-dress-hub="dress">' +
        '<span class="mi-dress-hub__num">I.</span>' +
        '<span class="mi-dress-hub__body">' +
          '<strong>个性装扮</strong>' +
          '<span>聊天 App 四屏美化 · 内置预设与自定义 CSS</span>' +
        '</span>' +
        '<span class="mi-dress-hub__arrow">→</span>' +
      '</button>' +
      '<button type="button" class="mi-dress-hub__item" data-mq-dress-hub="emoji">' +
        '<span class="mi-dress-hub__num">II.</span>' +
        '<span class="mi-dress-hub__body">' +
          '<strong>表情包</strong>' +
          '<span>分组管理 · 导入表情</span>' +
        '</span>' +
        '<span class="mi-dress-hub__arrow">→</span>' +
      '</button>' +
      '<button type="button" class="mi-dress-hub__item" data-mq-dress-hub="heartvoice">' +
        '<span class="mi-dress-hub__num">III.</span>' +
        '<span class="mi-dress-hub__body">' +
          '<strong>自定义心声</strong>' +
          '<span>输出字段 · HTML 模板 · 预设库</span>' +
        '</span>' +
        '<span class="mi-dress-hub__arrow">→</span>' +
      '</button>' +
    '</div>';
  }

  function renderHeartVoiceTemplates() {
    setHead('自定义心声', '');
    var mod = global.MiyaChatHeartVoiceTemplates;
    if (!mod || typeof mod.buildEditorHtml !== 'function') {
      return '<div class="mi-me-flow"><p class="mi-empty-hint">心声模版模块未加载，请刷新页面</p></div>';
    }
    return mod.buildEditorHtml(mod.loadDraft ? mod.loadDraft() : null);
  }

  function renderDressUp() {
    var cabMod = global.MiyaChatAppBeautify;
    var bfMod = global.MiyaChatBeautify;
    setHead('个性装扮', '聊天 App 四屏美化');
    if (!cabMod) {
      return '<div class="mi-me-flow"><p class="mi-empty-hint">美化模块未加载，请刷新页面</p></div>';
    }
    var applied = bfMod
      ? bfMod.buildAppliedBlockHtml({
          hint: '若美化导致聊天设置无法打开，可在此清除该联系人的样式；预设库不受影响'
        })
      : '';
    return '<div class="mi-me-flow">' +
      cabMod.buildPanelHtml(cabMod.getState()) +
      (applied ? '<div class="mi-bf-wrap mi-bf-wrap--dress">' + applied + '</div>' : '') +
    '</div>';
  }

  function renderEmojiUrlImport(groupId) {
    setHead('导入', '链接批量');
    return '<div class="mi-me-flow">' +
      '<p class="mi-me-lead">每行一条，支持「名称:URL」或纯 URL</p>' +
      '<textarea class="mi-input mi-input--area mi-emo-url-box" data-mq-emo-url-ta rows="10" placeholder="开心:https://example.com/a.png&#10;https://example.com/b.jpg"></textarea>' +
      '<button type="button" class="mi-btn mi-btn--dark mi-btn--block" data-mq-emo-url-preview>解析并预览</button>' +
      '<input type="hidden" data-mq-emo-import-gid value="' + esc(groupId || 'default') + '">' +
    '</div>';
  }

  function renderEmojiHub() {
    var top = navStack[navStack.length - 1];
    var data = (top && top.data) || {};
    var deleteMode = !!data.deleteMode;
    var expanded = deleteMode ? (data.expandedGroups || {}) : (data.expandedGroups || {});
    if (deleteMode && !Object.keys(expanded).length) expandAllEmojiGroups(data);
    var groups = store.getEmojiGroups();
    var list = groups.map(function (g) { return renderGroupAccordion(g, expanded, deleteMode); }).join('');
    return '<div class="mi-me-flow mi-me-flow--emoji' + (deleteMode ? ' is-emo-delete-mode' : '') + '">' +
      '<p class="mi-me-lead">' + (deleteMode
        ? '点击表情右上角 × 删除；分组标题旁 × 可删整组（默认分组除外）'
        : '点分组展开 · 展开后可删除分组或导入 · 长按表情可批量删除') + '</p>' +
      (deleteMode ? '' : '<button type="button" class="mi-btn mi-btn--dark mi-btn--block" data-mq-emo-add-group>＋ 添加分组</button>') +
      '<div class="mi-emo-acc-list">' + (list || '<p class="mi-empty-hint">还没有分组</p>') + '</div>' +
      '<input type="file" accept="image/*" multiple hidden data-mq-emo-import>' +
      '<input type="hidden" data-mq-emo-import-gid value="' + esc(data.importGroupId || 'default') + '">' +
    '</div>';
  }

  function hydrateProfileAvatars(root) {
    if (!root) return;
    root.querySelectorAll('[data-mq-prof-ava]').forEach(function (el) {
      var pid = el.getAttribute('data-mq-prof-ava');
      var p = store.getProfiles().find(function (x) { return x.id === pid; });
      loadAvatar(p, function (url) {
        if (el.tagName === 'IMG') el.src = url;
        else el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function hydrateEmojiThumbs(root) {
    if (!root || !store) return;
    root.querySelectorAll('[data-mq-emo-thumb-url]').forEach(function (el) {
      var direct = el.getAttribute('data-mq-emo-thumb-url');
      if (direct) el.style.backgroundImage = 'url("' + direct.replace(/"/g, '') + '")';
    });
    root.querySelectorAll('[data-mq-emo-thumb]').forEach(function (el) {
      if (el.getAttribute('data-mq-emo-thumb-url')) return;
      var packId = el.getAttribute('data-mq-pack');
      var bid = el.getAttribute('data-mq-emo-thumb');
      if (bid && store.getEmojiItemUrl) {
        store.getEmojiItemUrl(bid).then(function (url) {
          if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
        });
        return;
      }
      if (!packId) return;
      var itemId = el.getAttribute('data-mq-emo-thumb');
      var pk = store.getEmojiPacks().find(function (p) { return p.id === packId; });
      var it = pk && (pk.items || []).find(function (x) { return x.id === itemId; });
      if (!it) return;
      store.getEmojiItemDisplayUrl(it).then(function (url) {
        if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function renderScreen() {
    var top = navStack[navStack.length - 1];
    if (!top) return '';
    switch (top.screen) {
      case 'profiles': return renderProfileList();
      case 'wallet': return renderWallet();
      case 'wallet-detail': return renderWalletDetail(top.data.profileId);
      case 'favorites': return renderFavorites();
      case 'wallpapers': return renderWallpapers();
      case 'album':
        if (global.MiyaChatAlbum && global.MiyaChatAlbum.renderAlbumPage) {
          return global.MiyaChatAlbum.renderAlbumPage(top.data);
        }
        return '<div class="mi-me-flow"><p class="mi-empty-hint">相册模块未加载</p></div>';
      case 'edit': return renderProfileEdit(top.data.profileId);
      case 'dress-hub': return renderDressEmojiHub();
      case 'dress': return renderDressUp();
      case 'heartvoice-tpl': return renderHeartVoiceTemplates();
      case 'emoji':
        return renderEmojiHub();
      case 'emoji-import-url':
        return renderEmojiUrlImport(top.data.groupId);
      default: return renderProfileList();
    }
  }

  function renderTop() {
    if (!stackEl) return;
    var body = stackEl.querySelector('[data-mq-me-body]');
    if (!body) return;
    var top = navStack[navStack.length - 1];
    var albumMod = global.MiyaChatAlbum;
    var savedAlbumScroll = null;
    var savedAlbumViewKey = null;
    if (top && top.screen === 'album' && albumMod && albumMod.captureScroll) {
      savedAlbumScroll = albumMod.captureScroll(stackEl);
      savedAlbumViewKey = albumMod.viewScrollKey(top.data);
    }
    stackEl.classList.toggle('mi-me-page--album', !!(top && top.screen === 'album'));
    body.innerHTML = renderScreen();
    hydrateProfileAvatars(body);
    hydrateEmojiThumbs(body);
    hydrateWallpaperThumbs(body);
    if (top && top.screen === 'favorites') {
      hydrateFavMedia(body);
    }
    if (top && top.screen === 'album' && albumMod) {
      albumMod.hydrateThumbs(body);
      if (savedAlbumScroll && albumMod.viewScrollKey(top.data) === savedAlbumViewKey) {
        albumMod.restoreScroll(stackEl, savedAlbumScroll);
      }
    }
    bindEmojiLongPress(body);
    if (top && top.screen === 'emoji') {
      syncEmojiHubChrome(top.data);
    } else if (stackEl) {
      stackEl.classList.remove('mi-me--emo-delete');
      var closeBtn = stackEl.querySelector('[data-mq-me-close]');
      if (closeBtn) {
        closeBtn.textContent = '×';
        closeBtn.classList.remove('mi-me-header__close--done');
        closeBtn.setAttribute('aria-label', '关闭');
      }
    }
    if (top && top.screen === 'dress') {
      var cabMod = global.MiyaChatAppBeautify;
      var cabWrap = body.querySelector('[data-cab-root]');
      if (cabMod && cabWrap) {
        cabMod.bindPanelRoot(cabWrap);
      }
      var bfMod = global.MiyaChatBeautify;
      var bfWrap = body.querySelector('.mi-bf-wrap--dress');
      if (bfMod && bfWrap) {
        bfMod.bindAtelierRoot(bfWrap, null, function () { renderTop(); });
        bfMod.refreshAppliedList(bfWrap);
      }
    }
    if (top && top.screen === 'heartvoice-tpl') {
      var hvTplMod = global.MiyaChatHeartVoiceTemplates;
      var hvTplRoot = body.querySelector('[data-mq-hv-tpl-root]');
      if (hvTplMod && hvTplRoot && typeof hvTplMod.bindEditorRoot === 'function') {
        hvTplMod.bindEditorRoot(hvTplRoot);
      }
    }
  }

  function bindStackEvents() {
    if (!stackEl || stackEl.dataset.bound) return;
    stackEl.dataset.bound = '1';

    stackEl.addEventListener('click', function (e) {
      var topNav = navStack[navStack.length - 1];
      var inEmoDelete = topNav && topNav.screen === 'emoji' && topNav.data && topNav.data.deleteMode;

      if (e.target.closest('[data-mq-me-close]')) {
        if (inEmoDelete) {
          exitEmojiDeleteMode();
          return;
        }
        close();
        return;
      }
      if (e.target.closest('[data-mq-me-back]')) {
        if (inEmoDelete) {
          exitEmojiDeleteMode();
          return;
        }
        pop();
        return;
      }

      var quickDelItem = e.target.closest('[data-mq-emo-quick-del-item]');
      if (quickDelItem) {
        e.preventDefault();
        e.stopPropagation();
        var qPack = quickDelItem.getAttribute('data-mq-emo-quick-del-pack');
        var qItem = quickDelItem.getAttribute('data-mq-emo-quick-del-item');
        store.deleteEmojiItem(qPack, qItem).then(function () {
          toast('已删除');
          renderTop();
        }).catch(function () { toast('删除失败'); });
        return;
      }

      var quickDelGroup = e.target.closest('[data-mq-emo-quick-del-group]');
      if (quickDelGroup) {
        e.preventDefault();
        e.stopPropagation();
        promptDeleteEmojiGroup(quickDelGroup.getAttribute('data-mq-emo-quick-del-group'));
        return;
      }

      var delGroup = e.target.closest('[data-mq-emo-del-group]');
      if (delGroup) {
        e.preventDefault();
        e.stopPropagation();
        promptDeleteEmojiGroup(delGroup.getAttribute('data-mq-emo-del-group'));
        return;
      }

      var dressHub = e.target.closest('[data-mq-dress-hub]');
      if (dressHub) {
        var hubAct = dressHub.getAttribute('data-mq-dress-hub');
        if (hubAct === 'dress') {
          var chain = global.MiyaChatBeautify ? global.MiyaChatBeautify.whenPresetsReady() : Promise.resolve();
          chain.then(function () { push('dress'); });
        } else if (hubAct === 'emoji') {
          push('emoji', { expandedGroups: {} });
        } else if (hubAct === 'heartvoice') {
          var hvChain = global.MiyaChatHeartVoiceTemplates && global.MiyaChatHeartVoiceTemplates.whenPresetsReady
            ? global.MiyaChatHeartVoiceTemplates.whenPresetsReady()
            : Promise.resolve();
          hvChain.then(function () { push('heartvoice-tpl'); });
        }
        return;
      }

      if (e.target.closest('[data-mq-prof-create]')) {
        dialog({ mode: 'prompt', title: '新建面具', message: '为这个身份取一个名字', placeholder: '例如：日常的我' }).then(function (name) {
          if (!name || !String(name).trim()) return;
          store.createProfile(String(name).trim()).then(function (p) {
            toast('面具已创建');
            if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
            push('edit', { profileId: p.id });
          }).catch(function () { toast('创建失败'); });
        });
        return;
      }

      var openProf = e.target.closest('[data-mq-prof-open]');
      if (openProf) {
        push('edit', { profileId: openProf.getAttribute('data-mq-prof-open') });
        return;
      }

      var openWallet = e.target.closest('[data-mq-wallet-open]');
      if (openWallet) {
        push('wallet-detail', { profileId: openWallet.getAttribute('data-mq-wallet-open') });
        return;
      }

      if (e.target.closest('[data-mq-wall-upload]')) {
        var wallInp = stackEl.querySelector('[data-mq-wall-import]');
        if (wallInp) wallInp.click();
        return;
      }

      var wallDel = e.target.closest('[data-mq-wall-del]');
      if (wallDel) {
        var wallId = wallDel.getAttribute('data-mq-wall-del');
        confirmDialog('删除壁纸', '确定从壁纸库中删除这张壁纸？已使用该壁纸的聊天不会自动更换。').then(function (ok) {
          if (!ok || !store.removeChatWallpaper) return;
          store.removeChatWallpaper(wallId).then(function () {
            toast('已删除');
            renderTop();
          }).catch(function () { toast('删除失败'); });
        });
        return;
      }

      var adjustWallet = e.target.closest('[data-mq-wallet-adjust]');
      if (adjustWallet) {
        var wPid = adjustWallet.getAttribute('data-mq-wallet-adjust');
        var wProf = store.getProfiles().find(function (x) { return x.id === wPid; });
        var curBal = wProf && store.getWallet ? (Number(store.getWallet(wPid).balance) || 0) : 0;
        dialog({
          mode: 'prompt',
          title: '调整余额',
          message: '设置「' + (wProf ? wProf.name : '面具') + '」的余额（当前 ¥' + curBal + '）',
          placeholder: '例如：1000',
          defaultValue: String(curBal)
        }).then(function (val) {
          if (val == null || val === '') return;
          var next = Number(String(val).trim());
          if (!Number.isFinite(next) || next < 0) {
            toast('请输入有效金额');
            return;
          }
          if (!store.setWalletBalance) {
            toast('钱包未加载');
            return;
          }
          store.setWalletBalance(wPid, next).then(function () {
            toast('余额已更新');
            if (global.miyaChatApp && global.miyaChatApp.refreshProfileUI) {
              global.miyaChatApp.refreshProfileUI();
            }
            renderTop();
          }).catch(function () { toast('更新失败'); });
        });
        return;
      }

      var favDel = e.target.closest('[data-mq-fav-del]');
      if (favDel) {
        e.preventDefault();
        e.stopPropagation();
        var favId = favDel.getAttribute('data-mq-fav-del');
        store.removeSavedMessage(favId).then(function () {
          toast('已取消收藏');
          renderTop();
        }).catch(function () { toast('操作失败'); });
        return;
      }

      var favOpen = e.target.closest('[data-mq-fav-open]');
      if (favOpen && !e.target.closest('[data-mq-fav-del]')) {
        var chatId = favOpen.getAttribute('data-mq-fav-open');
        if (chatId && global.miyaChatApp && global.miyaChatApp.openChatById) {
          close();
          global.miyaChatApp.openChatById(chatId);
        }
        return;
      }

      var avaBtn = e.target.closest('[data-mq-prof-ava-btn]');
      if (avaBtn) {
        var fid = avaBtn.getAttribute('data-mq-prof-ava-btn');
        var finp = stackEl.querySelector('[data-mq-prof-file="' + fid + '"]');
        if (finp) finp.click();
        return;
      }

      var avaReset = e.target.closest('[data-mq-prof-ava-reset]');
      if (avaReset) {
        var rid = avaReset.getAttribute('data-mq-prof-ava-reset');
        var prof = store.getProfiles().find(function (x) { return x.id === rid; });
        if (prof && prof.avatarId) {
          store.invalidateBlobUrl(prof.avatarId);
          store.idbDeleteRecord(prof.avatarId);
        }
        store.updateProfile(rid, { avatarId: null }).then(function () {
          var urlIn = stackEl.querySelector('[data-mq-prof-ava-url="' + rid + '"]');
          if (urlIn) urlIn.value = '';
          toast('已恢复默认头像');
          hydrateProfileAvatars(stackEl);
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        });
        return;
      }

      var avaUrlApply = e.target.closest('[data-mq-prof-ava-url-apply]');
      if (avaUrlApply) {
        var aid = avaUrlApply.getAttribute('data-mq-prof-ava-url-apply');
        var urlEl = stackEl.querySelector('[data-mq-prof-ava-url="' + aid + '"]');
        var avUrl = urlEl ? String(urlEl.value || '').trim() : '';
        if (!avUrl) { toast('请填写图片链接'); return; }
        fetch(avUrl).then(function (r) {
          if (!r.ok) throw new Error('fetch');
          return r.blob();
        }).then(function (blob) {
          var file = new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' });
          return store.setProfileAvatar(aid, file);
        }).then(function () {
          toast('头像已更新');
          hydrateProfileAvatars(stackEl);
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        }).catch(function () { toast('链接无效'); });
        return;
      }

      var useBtn = e.target.closest('[data-mq-prof-use]');
      if (useBtn) {
        store.setActiveProfile(useBtn.getAttribute('data-mq-prof-use')).then(function () {
          toast('已切换当前面具');
          if (global.miyaChatApp && global.miyaChatApp.refreshProfileUI) {
            global.miyaChatApp.refreshProfileUI();
          } else if (global.miyaChatApp && global.miyaChatApp.refreshLists) {
            global.miyaChatApp.refreshLists();
          }
          renderTop();
        });
        return;
      }

      var saveBtn = e.target.closest('[data-mq-prof-save]');
      if (saveBtn) {
        var pid = saveBtn.getAttribute('data-mq-prof-save');
        var root = stackEl.querySelector('.mi-me-flow');
        var patch = {
          name: (root.querySelector('[data-mq-f-name]') || {}).value,
          gender: (root.querySelector('[data-mq-f-gender]') || {}).value,
          birthday: (root.querySelector('[data-mq-f-birthday]') || {}).value,
          persona: (root.querySelector('[data-mq-f-persona]') || {}).value
        };
        store.updateProfile(pid, patch).then(function () {
          toast('面具已保存');
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        }).catch(function () { toast('保存失败'); });
        return;
      }

      var delBtn = e.target.closest('[data-mq-prof-del]');
      if (delBtn) {
        var delId = delBtn.getAttribute('data-mq-prof-del');
        confirmDialog('删除面具', '删除后无法恢复，确定吗？').then(function (ok) {
          if (!ok) return;
          store.deleteProfile(delId).then(function () {
            toast('已删除');
            pop();
            if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
          }).catch(function () { toast('至少保留一个面具'); });
        });
        return;
      }

      var accToggle = e.target.closest('[data-mq-emo-acc-toggle]');
      if (accToggle) {
        toggleExpandedGroup(accToggle.getAttribute('data-mq-emo-acc-toggle'));
        return;
      }

      var grpImportUrl = e.target.closest('[data-mq-emo-grp-import-url]');
      if (grpImportUrl) {
        var gidUrl = grpImportUrl.getAttribute('data-mq-emo-grp-import-url') || 'default';
        var topNav = navStack[navStack.length - 1];
        if (topNav && topNav.screen === 'emoji') {
          topNav.data.importGroupId = gidUrl;
        }
        push('emoji-import-url', { groupId: gidUrl });
        return;
      }

      var grpImportAlbum = e.target.closest('[data-mq-emo-grp-import-album]');
      if (grpImportAlbum) {
        var gidAlbum = grpImportAlbum.getAttribute('data-mq-emo-grp-import-album') || 'default';
        if (navStack.length && navStack[navStack.length - 1].screen === 'emoji') {
          navStack[navStack.length - 1].data.importGroupId = gidAlbum;
        }
        var inpAlbum = stackEl.querySelector('[data-mq-emo-import]');
        if (inpAlbum) {
          inpAlbum.setAttribute('data-mq-emo-import-gid-active', gidAlbum);
          inpAlbum.click();
        }
        return;
      }

      if (e.target.closest('[data-mq-emo-url-preview]')) {
        var taPrev = stackEl.querySelector('[data-mq-emo-url-ta]');
        var gidPrev = stackEl.querySelector('[data-mq-emo-import-gid]');
        var rawPrev = taPrev ? String(taPrev.value || '') : '';
        if (!rawPrev.trim()) {
          toast('请先粘贴链接');
          return;
        }
        openUrlImportPreviewModal(
          gidPrev ? gidPrev.value : 'default',
          rawPrev
        );
        return;
      }

      if (e.target.closest('[data-mq-emo-add-group]')) {
        openAddEmojiGroupModal();
        return;
      }
    });

    stackEl.addEventListener('change', function (e) {
      var finp = e.target.closest('[data-mq-prof-file]');
      if (finp && finp.files && finp.files[0]) {
        var pid = finp.getAttribute('data-mq-prof-file');
        store.setProfileAvatar(pid, finp.files[0]).then(function () {
          finp.value = '';
          toast('头像已更新');
          hydrateProfileAvatars(stackEl);
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        }).catch(function () { toast('上传失败'); });
        return;
      }
      if (e.target.matches('[data-mq-emo-import]')) {
        var files = e.target.files;
        if (!files || !files.length) return;
        var gid = e.target.getAttribute('data-mq-emo-import-gid-active') ||
          (stackEl.querySelector('[data-mq-emo-import-gid]') || {}).value ||
          'default';
        e.target.removeAttribute('data-mq-emo-import-gid-active');
        openImageImportPreviewModal(gid, files);
        e.target.value = '';
      }
      if (e.target.matches('[data-mq-wall-import]')) {
        var wallFiles = e.target.files;
        if (!wallFiles || !wallFiles.length || !store.addChatWallpapersFromFiles) return;
        toast('正在上传…');
        store.addChatWallpapersFromFiles(wallFiles).then(function (added) {
          e.target.value = '';
          toast('已添加 ' + (added && added.length ? added.length : 0) + ' 张壁纸');
          renderTop();
        }).catch(function (err) {
          e.target.value = '';
          if (err && err.message === 'no_images') toast('请选择图片文件');
          else toast('上传失败');
        });
      }
    });
  }

  global.miyaChatMe = {
    open: open,
    close: close,
    openProfiles: function () { return open('profiles'); },
    openWallet: function () { return open('wallet'); },
    openFavorites: function () { return open('favorites'); },
    openWallpapers: function () { return open('wallpapers'); },
    openAlbum: function () {
      var chain = Promise.resolve();
      if (global.MiyaChatAlbum && typeof global.MiyaChatAlbum.whenReady === 'function') {
        chain = global.MiyaChatAlbum.whenReady();
      }
      return chain.then(function () {
        return open('album', {
          view: 'home',
          category: 'all',
          homeMode: 'carousel',
          carouselIndex: 0,
          detailGroupId: 'default',
          detailViewMode: 'grid',
          menuOpen: false,
          photoSheetId: '',
          batchMode: false,
          selectedIds: {},
          editingGroupId: ''
        });
      });
    },
    openDress: function () { return open('dress-hub'); },
    openDressApp: function () { return open('dress'); },
    openEmoji: function () { return open('emoji', { expandedGroups: {} }); },
    openHeartVoiceTemplates: function () {
      var chain = global.MiyaChatHeartVoiceTemplates && global.MiyaChatHeartVoiceTemplates.whenPresetsReady
        ? global.MiyaChatHeartVoiceTemplates.whenPresetsReady()
        : Promise.resolve();
      return chain.then(function () { return open('heartvoice-tpl'); });
    }
  };
})(window);
