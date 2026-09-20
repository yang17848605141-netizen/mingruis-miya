/**
 * miya-deep-deco.js — 深入 · 角色手机装修（独立存储）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var WIDGET_SLOTS = {
    p1: { slotId: 'dp-wg-p1', widgetId: 'blank_4x3_3', type: 'calendar', label: '月历志' },
    p2a: { slotId: 'dp-wg-p2a', widgetId: 'blank_4x2_5', type: 'glassdeck', label: '浮光拼贴' },
    p2b: { slotId: 'dp-wg-p2b', widgetId: 'blank_4x1_7', type: 'weekmood', label: '周历心情' },
    p2mini: { slotId: 'dp-wg-p2-mini', widgetId: 'blank_2x2_9', type: 'miniplayer', label: '音乐播放器' },
    p2sleeve: { slotId: 'dp-wg-p2-sleeve', widgetId: 'blank_2x2_5', type: 'sleeve', label: '透明卡套' },
    p3: { slotId: 'dp-wg-p3', widgetId: 'blank_4x4_3', type: 'inshome', label: '灰白ins主页' }
  };

  var DOCK_ICONS = [
    { id: 'dock_phone', label: '电话' },
    { id: 'dock_sms', label: '短信' },
    { id: 'dock_browser', label: '浏览器' },
    { id: 'dock_settings', label: '设置' }
  ];

  var state = {
    open: false,
    tab: 'scene',
    wgEditorSlot: '',
    iconPickKey: ''
  };

  function store() { return global.miyaDeepStore || null; }
  function appState() { return global.miyaDeepAppState || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaDeepApp && typeof global.miyaDeepApp.toast === 'function') {
      global.miyaDeepApp.toast(msg);
      return;
    }
    var el = $('dp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function getPhoneData() {
    var s = appState();
    return s && s.phoneData ? s.phoneData : null;
  }

  function getContactId() {
    var s = appState();
    return s && s.contactId ? s.contactId : '';
  }

  function getDecor() {
    var data = getPhoneData();
    if (!data) return store() ? store().defaultDecor() : { wallpaper: null, icons: {}, iconFrameless: false, widgets: {} };
    return data.decor || (store() ? store().defaultDecor() : {});
  }

  function saveDecor(patch) {
    var st = store();
    var contactId = getContactId();
    var data = getPhoneData();
    if (!st || !contactId || !data) return Promise.resolve(null);
    var base = st.normalizeDecor(data.decor);
    data.decor = Object.assign({}, base, patch || {});
    if (patch && patch.icons) {
      data.decor.icons = Object.assign({}, base.icons, patch.icons);
      Object.keys(data.decor.icons).forEach(function (k) {
        if (!data.decor.icons[k]) delete data.decor.icons[k];
      });
    }
    if (patch && patch.widgets) {
      data.decor.widgets = Object.assign({}, base.widgets);
      Object.keys(patch.widgets).forEach(function (k) {
        var next = patch.widgets[k];
        /* null/undefined = 删除该槽自定义；对象则整槽替换（支持清空字段与恢复默认） */
        if (next == null) delete data.decor.widgets[k];
        else data.decor.widgets[k] = Object.assign({}, next);
      });
    }
    return st.savePhone(contactId, data).then(function (saved) {
      if (saved && appState()) appState().phoneData = saved;
      return saved;
    });
  }

  function setDecorField(path, value) {
    var decor = getDecor();
    if (path === 'wallpaper') return saveDecor({ wallpaper: value || null });
    if (path === 'iconFrameless') return saveDecor({ iconFrameless: !!value });
    if (path.indexOf('icons.') === 0) {
      var key = path.slice(6);
      var icons = Object.assign({}, decor.icons || {});
      if (value) icons[key] = value; else delete icons[key];
      return saveDecor({ icons: icons });
    }
    if (path.indexOf('widgets.') === 0) {
      var rest = path.slice(8).split('.');
      var slot = rest[0];
      var field = rest[1];
      var widgets = {};
      var slotCfg = Object.assign({}, (decor.widgets || {})[slot] || {});
      if (value) slotCfg[field] = value; else delete slotCfg[field];
      widgets[slot] = slotCfg;
      return saveDecor({ widgets: widgets });
    }
    return Promise.resolve(null);
  }

  function collectDecorMediaIds(decor, bag) {
    bag = bag || {};
    function add(ref) {
      if (!ref) return;
      var id = typeof ref === 'object' ? ref.id : ref;
      if (id && typeof id === 'string' && id.indexOf('miya_') === 0) bag[id] = true;
    }
    if (!decor) return bag;
    add(decor.wallpaper);
    var icons = decor.icons || {};
    Object.keys(icons).forEach(function (k) { add(icons[k]); });
    var widgets = decor.widgets || {};
    Object.keys(widgets).forEach(function (slot) {
      var cfg = widgets[slot];
      if (!cfg || typeof cfg !== 'object') return;
      Object.keys(cfg).forEach(function (k) {
        var v = cfg[k];
        if (v && (typeof v === 'string' || (typeof v === 'object' && v.id))) add(v);
      });
    });
    return bag;
  }

  function mediaGet(id) {
    return new Promise(function (resolve) {
      var req = indexedDB.open('miya-theme-media', 1);
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction('blobs', 'readonly');
          var g = tx.objectStore('blobs').get(id);
          g.onsuccess = function () { resolve(g.result || null); };
          g.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      };
      req.onerror = function () { resolve(null); };
    });
  }

  function mediaPut(id, value) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('miya-theme-media', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction('blobs', 'readwrite');
          tx.objectStore('blobs').put(value, id);
          tx.oncomplete = function () { resolve(id); };
          tx.onerror = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function serializeMediaRecord(rec) {
    if (!rec || !(rec.blob instanceof Blob)) return Promise.resolve(rec ? Object.assign({}, rec) : null);
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var out = Object.assign({}, rec);
        out.__blob = 'dataUrl';
        out.blobDataUrl = reader.result;
        delete out.blob;
        resolve(out);
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(rec.blob);
    });
  }

  function deserializeMediaRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (rec.__blob === 'dataUrl' && rec.blobDataUrl) {
      var parts = String(rec.blobDataUrl).split(',');
      var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
      var bin = atob(parts[1] || '');
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return Object.assign({}, rec, { blob: new Blob([arr], { type: mime }) });
    }
    return rec.blob ? rec : null;
  }

  function exportPack() {
    var contactId = getContactId();
    var decor = getDecor();
    if (!contactId) return Promise.reject(new Error('no_contact'));
    var ids = Object.keys(collectDecorMediaIds(decor, {}));
    return Promise.all(ids.map(function (id) {
      return mediaGet(id).then(function (rec) {
        if (!rec) return null;
        return serializeMediaRecord(rec).then(function (s) { return s ? { id: id, data: s } : null; });
      });
    })).then(function (rows) {
      var media = {};
      rows.forEach(function (row) { if (row) media[row.id] = row.data; });
      return JSON.stringify({
        miyaDeepDecorPack: true,
        version: 1,
        contactId: contactId,
        exportedAt: Date.now(),
        decor: JSON.parse(JSON.stringify(decor)),
        media: media
      });
    });
  }

  function importPack(jsonStr) {
    var data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (!data || !data.decor || !data.miyaDeepDecorPack) throw new Error('invalid_pack');
    var media = data.media || {};
    var keys = Object.keys(media);
    return Promise.all(keys.map(function (id) {
      var rec = deserializeMediaRecord(media[id]);
      return rec ? mediaPut(id, rec) : Promise.resolve();
    })).then(function () {
      var st = store();
      var decor = st ? st.normalizeDecor(data.decor) : data.decor;
      return saveDecor(decor).then(function () {
        return applyDecor();
      }).then(function () {
        if (global.miyaDeepApp && typeof global.miyaDeepApp.remountWidgets === 'function') {
          return global.miyaDeepApp.remountWidgets();
        }
      });
    });
  }

  function applyWallpaper(ref) {
    var wall = document.querySelector('.dp-phone__wall');
    if (!wall) return Promise.resolve();
    if (!ref) {
      wall.style.backgroundImage = '';
      wall.classList.remove('has-custom-wall');
      return Promise.resolve();
    }
    return (global.miyaResolveMediaUrl ? global.miyaResolveMediaUrl(ref) : Promise.resolve(ref)).then(function (url) {
      if (!url) return;
      wall.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
      wall.classList.add('has-custom-wall');
    });
  }

  function applyIconBg(host, ref) {
    if (!host) return Promise.resolve();
    var existing = host.querySelector('.dp-icon-bg');
    if (!ref) {
      if (existing) existing.remove();
      host.classList.remove('has-custom-icon');
      host.querySelectorAll('svg').forEach(function (svg) { svg.style.opacity = ''; });
      return Promise.resolve();
    }
    return (global.miyaResolveMediaUrl ? global.miyaResolveMediaUrl(ref) : Promise.resolve(ref)).then(function (url) {
      if (!url) return;
      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'dp-icon-bg';
        existing.setAttribute('aria-hidden', 'true');
        host.insertBefore(existing, host.firstChild);
      }
      existing.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
      host.classList.add('has-custom-icon');
      host.querySelectorAll('svg').forEach(function (svg) { svg.style.opacity = '0'; });
    });
  }

  function applyDecor() {
    var decor = getDecor();
    var root = $('dp-phone-root');
    if (root) root.classList.toggle('dp-icon-frameless', !!decor.iconFrameless);

    var promises = [applyWallpaper(decor.wallpaper)];

    document.querySelectorAll('[data-dp-app]').forEach(function (btn) {
      var id = btn.getAttribute('data-dp-app');
      var ib = btn.querySelector('.dp-ib');
      if (ib) promises.push(applyIconBg(ib, decor.icons && decor.icons[id]));
    });

    DOCK_ICONS.forEach(function (dock) {
      var btn = document.querySelector('[data-dp-dock="' + dock.id + '"] .dp-ib');
      if (btn) promises.push(applyIconBg(btn, decor.icons && decor.icons[dock.id]));
    });

    return Promise.all(promises);
  }

  var filePickResolve = null;
  var fileInputsBound = false;

  function bindFileInputs() {
    if (fileInputsBound) return;
    fileInputsBound = true;
    ['dp-deco-file-wall', 'dp-deco-file-icon', 'dp-deco-file-wg'].forEach(function (id) {
      var inp = $(id);
      if (!inp) return;
      inp.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (filePickResolve) {
          var resolve = filePickResolve;
          filePickResolve = null;
          resolve(file || null);
        }
      });
    });
  }

  function pickImageFile(inputId) {
    bindFileInputs();
    var input = $(inputId || 'dp-deco-file-wall');
    if (!input) return Promise.resolve(null);
    return new Promise(function (resolve) {
      filePickResolve = resolve;
      if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(input);
      else input.click();
    });
  }

  function normalizeMediaId(ref) {
    if (!ref) return '';
    if (typeof ref === 'object' && ref.id) return String(ref.id).trim();
    return String(ref).trim();
  }

  function storeImageRef(file, replaceId) {
    if (!file) return Promise.reject(new Error('no_file'));
    if (!(file.size > 0)) return Promise.reject(new Error('empty_file'));
    if (!global.miyaStoreImageFile) return Promise.reject(new Error('no_store'));
    var rid = replaceId ? String(replaceId).trim() : '';
    return global.miyaStoreImageFile(file, rid ? { replaceId: rid } : undefined);
  }

  function storeImageUrl(url, replaceId) {
    if (!url) return Promise.reject(new Error('no_url'));
    if (global.miyaStoreImageUrl) return global.miyaStoreImageUrl(url);
    return Promise.resolve(url);
  }

  function getEditorFields(widgetType) {
    return (global.miyaCUSTOM_WIDGET_EDITOR_FIELDS || {})[widgetType] || [];
  }

  function getWidgetSlotConfig(slotKey) {
    var decor = getDecor();
    return (decor.widgets || {})[slotKey] || {};
  }

  function mergeWidgetConfig(slotKey, baseConfig) {
    var slotCfg = getWidgetSlotConfig(slotKey);
    return Object.assign({}, baseConfig || {}, slotCfg);
  }

  function renderDecoPanel() {
    var layer = $('dp-deco');
    if (!layer) return;
    var name = (appState() && appState().contactName) || '角色';
    var decor = getDecor();

    layer.innerHTML =
      '<div class="dp-deco__veil" aria-hidden="true"></div>' +
      '<span class="dp-deco__deco dp-deco__deco--vert" aria-hidden="true">SKIN · PHONE · DECO</span>' +
      '<header class="dp-deco__head">' +
        '<button type="button" class="dp-deco__back" id="dp-deco-back" aria-label="返回">← BACK</button>' +
        '<div class="dp-deco__mast">' +
          '<span class="dp-deco__kicker">CHAR PHONE · SURFACE</span>' +
          '<h2 class="dp-deco__title">Dec<em>or</em>ate</h2>' +
        '</div>' +
        '<span class="dp-deco__issue" aria-hidden="true">04</span>' +
      '</header>' +
      '<nav class="dp-deco__tabs" aria-label="装修分区">' +
        '<button type="button" class="dp-deco__tab' + (state.tab === 'scene' ? ' is-active' : '') + '" data-dp-deco-tab="scene">壁纸</button>' +
        '<button type="button" class="dp-deco__tab' + (state.tab === 'glyph' ? ' is-active' : '') + '" data-dp-deco-tab="glyph">图标</button>' +
        '<button type="button" class="dp-deco__tab' + (state.tab === 'vault' ? ' is-active' : '') + '" data-dp-deco-tab="vault">方案</button>' +
      '</nav>' +
      '<div class="dp-deco__scroll">' +
        '<p class="dp-deco__for">为 <strong>' + esc(name) + '</strong> 单独装修桌面<br>壁纸与图标仅作用于该角色手机</p>' +
        '<p class="dp-deco__hint">小组件请在主屏直接点按编辑，内容与图片独立保存。</p>' +

        '<section class="dp-deco__panel' + (state.tab === 'scene' ? ' is-active' : '') + '" data-dp-deco-panel="scene"' + (state.tab !== 'scene' ? ' hidden' : '') + '>' +
          '<div class="dp-deco__section-head"><span class="dp-deco__section-no">01</span><h3 class="dp-deco__section-title">Wallpaper</h3></div>' +
          '<div class="dp-deco__wall-showcase">' +
            '<div class="dp-deco__wall-frame" id="dp-deco-wall-preview" data-dp-deco-wall-pick role="button" tabindex="0">' +
              '<span class="dp-deco__wall-label">点击上传壁纸</span>' +
            '</div>' +
          '</div>' +
          '<div class="dp-deco__actions">' +
            '<button type="button" class="dp-deco__chip dp-deco__chip--accent" data-dp-deco-wall-pick>上传壁纸</button>' +
            '<button type="button" class="dp-deco__chip" data-dp-deco-wall-clear>恢复默认</button>' +
          '</div>' +
          '<div class="dp-deco__url-row">' +
            '<input type="url" class="dp-deco__input" id="dp-deco-wall-url" placeholder="图片链接" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="dp-deco__chip" data-dp-deco-wall-url>应用</button>' +
          '</div>' +
        '</section>' +

        '<section class="dp-deco__panel' + (state.tab === 'glyph' ? ' is-active' : '') + '" data-dp-deco-panel="glyph"' + (state.tab !== 'glyph' ? ' hidden' : '') + '>' +
          '<div class="dp-deco__section-head"><span class="dp-deco__section-no">02</span><h3 class="dp-deco__section-title">Icons</h3></div>' +
          '<label class="dp-deco__toggle-row">' +
            '<span><strong>去掉图标外框</strong><em>自定义图标铺满圆角</em></span>' +
            '<input type="checkbox" class="dp-deco__toggle" id="dp-deco-icon-frameless"' + (decor.iconFrameless ? ' checked' : '') + '>' +
          '</label>' +
          '<p class="dp-deco__sub-label">第一页</p>' +
          '<div class="dp-deco__icon-grid" id="dp-deco-icons-p1"></div>' +
          '<p class="dp-deco__sub-label">第二页</p>' +
          '<div class="dp-deco__icon-grid" id="dp-deco-icons-p2"></div>' +
          '<p class="dp-deco__sub-label">第三页</p>' +
          '<div class="dp-deco__icon-grid" id="dp-deco-icons-p3"></div>' +
          '<p class="dp-deco__sub-label">Dock</p>' +
          '<div class="dp-deco__icon-grid" id="dp-deco-icons-dock"></div>' +
          '<div class="dp-deco__url-row">' +
            '<input type="url" class="dp-deco__input" id="dp-deco-icon-url" placeholder="图标链接" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="dp-deco__chip" id="dp-deco-icon-url-apply">应用</button>' +
            '<button type="button" class="dp-deco__chip" id="dp-deco-icon-clear">清除</button>' +
          '</div>' +
        '</section>' +

        '<section class="dp-deco__panel' + (state.tab === 'vault' ? ' is-active' : '') + '" data-dp-deco-panel="vault"' + (state.tab !== 'vault' ? ' hidden' : '') + '>' +
          '<div class="dp-deco__section-head"><span class="dp-deco__section-no">03</span><h3 class="dp-deco__section-title">Vault</h3></div>' +
          '<p class="dp-deco__vault-desc">导出或导入该角色的装修包，包含壁纸、图标与小组件自定义内容。</p>' +
          '<div class="dp-deco__vault-actions">' +
            '<button type="button" class="dp-deco__chip dp-deco__chip--accent" id="dp-deco-export">导出装修包</button>' +
            '<button type="button" class="dp-deco__chip" id="dp-deco-import">导入装修包</button>' +
          '</div>' +
          '<input type="file" id="dp-deco-import-file" accept="application/json,.json" hidden>' +
        '</section>' +
      '</div>';

    buildIconGrids(decor);
    refreshWallPreview(decor.wallpaper);
    bindDecoEvents();
  }

  function buildIconGrids(decor) {
    var apps = global.miyaDeepAppList || [];
    function fillGrid(id, list) {
      var grid = $(id);
      if (!grid) return;
      grid.innerHTML = list.map(function (app) {
        var has = decor.icons && decor.icons[app.id];
        return (
          '<button type="button" class="dp-deco__icon-item' + (has ? ' has-custom' : '') + '" data-dp-deco-icon="' + esc(app.id) + '">' +
            '<span class="dp-deco__icon-thumb" data-dp-deco-icon-thumb="' + esc(app.id) + '"></span>' +
            '<span class="dp-deco__icon-name">' + esc(app.label) + '</span>' +
          '</button>'
        );
      }).join('');
      list.forEach(function (app) {
        var thumb = document.querySelector('[data-dp-deco-icon-thumb="' + app.id + '"]');
        var ref = decor.icons && decor.icons[app.id];
        if (!thumb || !ref) return;
        (global.miyaResolveMediaUrl ? global.miyaResolveMediaUrl(ref) : Promise.resolve(ref)).then(function (url) {
          if (url && thumb) thumb.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        });
      });
    }
    fillGrid('dp-deco-icons-p1', apps.filter(function (a) { return a.page === 0; }));
    fillGrid('dp-deco-icons-p2', apps.filter(function (a) { return a.page === 1; }));
    fillGrid('dp-deco-icons-p3', apps.filter(function (a) { return a.page === 2; }));
    fillGrid('dp-deco-icons-dock', DOCK_ICONS);
  }

  function refreshWallPreview(ref) {
    var preview = $('dp-deco-wall-preview');
    if (!preview) return;
    if (!ref) {
      preview.style.backgroundImage = '';
      preview.classList.remove('has-custom');
      return;
    }
    (global.miyaResolveMediaUrl ? global.miyaResolveMediaUrl(ref) : Promise.resolve(ref)).then(function (url) {
      if (!url || !preview) return;
      preview.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
      preview.classList.add('has-custom');
    });
  }

  function handleWallPick() {
    pickImageFile('dp-deco-file-wall').then(function (file) {
      if (!file) return;
      if (!(file.size > 0)) {
        toast('文件为空');
        return;
      }
      var oldId = normalizeMediaId(getDecor().wallpaper);
      return storeImageRef(file, oldId).then(function (ref) {
        return setDecorField('wallpaper', ref);
      }).then(function () {
        return applyWallpaper(getDecor().wallpaper);
      }).then(function () {
        refreshWallPreview(getDecor().wallpaper);
        toast('壁纸已更新');
      });
    }).catch(function (err) {
      if (err && err.message === 'empty_file') toast('文件为空');
      else toast('上传失败');
    });
  }

  function handleWallUrl() {
    var input = $('dp-deco-wall-url');
    var url = input && input.value ? input.value.trim() : '';
    if (!url) { toast('请输入图片链接'); return; }
    storeImageUrl(url).then(function (ref) {
      return setDecorField('wallpaper', ref);
    }).then(function () {
      return applyWallpaper(getDecor().wallpaper);
    }).then(function () {
      refreshWallPreview(getDecor().wallpaper);
      toast('壁纸已更新');
    }).catch(function () { toast('链接无效'); });
  }

  function handleIconPick(key) {
    state.iconPickKey = key;
    pickImageFile('dp-deco-file-icon').then(function (file) {
      if (!file) return;
      if (!(file.size > 0)) {
        toast('文件为空');
        return;
      }
      var oldId = normalizeMediaId(getDecor().icons && getDecor().icons[key]);
      return storeImageRef(file, oldId).then(function (ref) {
        var icons = {};
        icons[key] = ref;
        return saveDecor({ icons: icons });
      }).then(function () {
        return applyDecor();
      }).then(function () {
        renderDecoPanel();
        toast('图标已更新');
      });
    }).catch(function (err) {
      if (err && err.message === 'empty_file') toast('文件为空');
      else toast('上传失败');
    });
  }

  function handleIconUrlApply() {
    var key = state.iconPickKey;
    var input = $('dp-deco-icon-url');
    var url = input && input.value ? input.value.trim() : '';
    if (!key) { toast('请先点选一个图标'); return; }
    if (!url) { toast('请输入图片链接'); return; }
    storeImageUrl(url).then(function (ref) {
      var icons = {};
      icons[key] = ref;
      return saveDecor({ icons: icons });
    }).then(function () {
      return applyDecor();
    }).then(function () {
      renderDecoPanel();
      toast('图标已更新');
    }).catch(function () { toast('链接无效'); });
  }

  function bindDecoEvents() {
    var back = $('dp-deco-back');
    if (back) back.onclick = closeDecoPanel;

    document.querySelectorAll('[data-dp-deco-tab]').forEach(function (btn) {
      btn.onclick = function () {
        state.tab = btn.getAttribute('data-dp-deco-tab') || 'scene';
        renderDecoPanel();
      };
    });

    document.querySelectorAll('[data-dp-deco-wall-pick]').forEach(function (btn) {
      btn.onclick = handleWallPick;
    });
    var wallClear = document.querySelector('[data-dp-deco-wall-clear]');
    if (wallClear) wallClear.onclick = function () {
      setDecorField('wallpaper', null).then(function () {
        return applyWallpaper(null);
      }).then(function () {
        refreshWallPreview(null);
        toast('已恢复默认壁纸');
      });
    };
    var wallUrl = document.querySelector('[data-dp-deco-wall-url]');
    if (wallUrl) wallUrl.onclick = handleWallUrl;

    var frameless = $('dp-deco-icon-frameless');
    if (frameless) frameless.onchange = function () {
      setDecorField('iconFrameless', frameless.checked).then(applyDecor);
    };

    document.querySelectorAll('[data-dp-deco-icon]').forEach(function (btn) {
      btn.onclick = function () {
        state.iconPickKey = btn.getAttribute('data-dp-deco-icon') || '';
        document.querySelectorAll('[data-dp-deco-icon]').forEach(function (b) {
          b.classList.toggle('is-picked', b === btn);
        });
        handleIconPick(state.iconPickKey);
      };
    });

    var iconUrlApply = $('dp-deco-icon-url-apply');
    if (iconUrlApply) iconUrlApply.onclick = handleIconUrlApply;

    var iconClear = $('dp-deco-icon-clear');
    if (iconClear) iconClear.onclick = function () {
      var key = state.iconPickKey;
      if (!key) { toast('请先点选一个图标'); return; }
      var icons = {};
      icons[key] = null;
      saveDecor({ icons: icons }).then(applyDecor).then(function () {
        renderDecoPanel();
        toast('已恢复默认图标');
      });
    };

    var exportBtn = $('dp-deco-export');
    if (exportBtn) exportBtn.onclick = function () {
      exportPack().then(function (json) {
        var name = (appState() && appState().contactName) || 'char';
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'miya-deep-deco-' + name + '-' + Date.now() + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('装修包已导出');
      }).catch(function () { toast('导出失败'); });
    };

    var importBtn = $('dp-deco-import');
    var importFile = $('dp-deco-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = function () { importFile.click(); };
      importFile.onchange = function () {
        var file = importFile.files && importFile.files[0];
        importFile.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importPack(reader.result).then(function () {
              renderDecoPanel();
              toast('装修包已导入');
            }).catch(function () { toast('导入失败'); });
          } catch (e) { toast('文件格式无效'); }
        };
        reader.readAsText(file);
      };
    }
  }

  function openDecoPanel() {
    if (!getContactId() || !getPhoneData()) {
      toast('请先进入角色手机');
      return;
    }
    var layer = $('dp-deco');
    if (!layer) return;
    state.open = true;
    state.tab = 'scene';
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    renderDecoPanel();
  }

  function closeDecoPanel() {
    var layer = $('dp-deco');
    if (!layer) return;
    state.open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
    closeWidgetEditor();
  }

  function renderWidgetEditor(slotKey) {
    var sheet = $('dp-wg-editor');
    if (!sheet) return;
    var slot = WIDGET_SLOTS[slotKey];
    if (!slot) return;
    var fields = getEditorFields(slot.type);
    var cfg = getWidgetSlotConfig(slotKey);

    sheet.innerHTML =
      '<div class="dp-wg-editor__veil" data-dp-wg-close></div>' +
      '<div class="dp-wg-editor__sheet">' +
        '<header class="dp-wg-editor__head">' +
          '<span class="dp-wg-editor__kicker">WIDGET · EDIT</span>' +
          '<h3 class="dp-wg-editor__title">' + esc(slot.label) + '</h3>' +
          '<button type="button" class="dp-wg-editor__close" data-dp-wg-close aria-label="关闭">×</button>' +
        '</header>' +
        '<div class="dp-wg-editor__body" id="dp-wg-editor-body"></div>' +
        '<footer class="dp-wg-editor__foot">' +
          '<button type="button" class="dp-deco__chip" data-dp-wg-reset>恢复默认</button>' +
          '<button type="button" class="dp-deco__chip dp-deco__chip--accent" data-dp-wg-save>保存</button>' +
        '</footer>' +
      '</div>';

    var body = $('dp-wg-editor-body');
    if (!body) return;

    fields.forEach(function (field) {
      var row = document.createElement('div');
      row.className = 'dp-wg-editor__field';
      row.innerHTML = '<label class="dp-wg-editor__label">' + esc(field.label) + '</label>';

      if (field.type === 'image') {
        var wrap = document.createElement('button');
        wrap.type = 'button';
        wrap.className = 'dp-wg-editor__img';
        wrap.setAttribute('data-dp-wg-field', field.key);
        wrap.setAttribute('data-dp-wg-type', 'image');
        var val = cfg[field.key];
        if (val) {
          (global.miyaResolveMediaUrl ? global.miyaResolveMediaUrl(val) : Promise.resolve(val)).then(function (url) {
            if (url) wrap.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
          });
        }
        wrap.innerHTML = '<span>点击更换图片</span>';
        row.appendChild(wrap);
      } else {
        var input = document.createElement(field.multiline ? 'textarea' : 'input');
        input.className = 'dp-deco__input dp-wg-editor__text';
        input.setAttribute('data-dp-wg-field', field.key);
        input.setAttribute('data-dp-wg-type', 'text');
        if (field.maxLength) input.maxLength = field.maxLength;
        input.value = cfg[field.key] != null ? String(cfg[field.key]) : '';
        if (field.multiline) input.rows = 2;
        row.appendChild(input);
      }
      body.appendChild(row);
    });

    sheet.querySelectorAll('[data-dp-wg-close]').forEach(function (btn) {
      btn.onclick = closeWidgetEditor;
    });

    var resetBtn = sheet.querySelector('[data-dp-wg-reset]');
    if (resetBtn) resetBtn.onclick = function () {
      var widgets = {};
      widgets[slotKey] = null;
      saveDecor({ widgets: widgets }).then(function () {
        if (global.miyaDeepApp && typeof global.miyaDeepApp.remountWidgets === 'function') {
          return global.miyaDeepApp.remountWidgets();
        }
      }).then(function () {
        closeWidgetEditor();
        toast('已恢复默认');
      }).catch(function () { toast('恢复失败'); });
    };

    var saveBtn = sheet.querySelector('[data-dp-wg-save]');
    if (saveBtn) saveBtn.onclick = function () {
      var next = {};
      sheet.querySelectorAll('[data-dp-wg-field]').forEach(function (el) {
        var key = el.getAttribute('data-dp-wg-field');
        var type = el.getAttribute('data-dp-wg-type');
        if (type === 'text') {
          var v = el.value != null ? String(el.value).trim() : '';
          if (v) next[key] = v;
        } else if (type === 'image' && el._dpRef) {
          next[key] = el._dpRef;
        } else if (type === 'image' && cfg[key]) {
          next[key] = cfg[key];
        }
      });
      var widgets = {};
      widgets[slotKey] = next;
      saveDecor({ widgets: widgets }).then(function () {
        if (global.miyaDeepApp && typeof global.miyaDeepApp.remountWidgets === 'function') {
          return global.miyaDeepApp.remountWidgets();
        }
      }).then(function () {
        closeWidgetEditor();
        toast('小组件已保存');
      }).catch(function () { toast('保存失败'); });
    };

    sheet.querySelectorAll('[data-dp-wg-type="image"]').forEach(function (btn) {
      btn.onclick = function () {
        pickImageFile('dp-deco-file-wg').then(function (file) {
          if (!file) return;
          if (!(file.size > 0)) {
            toast('文件为空');
            return;
          }
          var fieldKey = btn.getAttribute('data-dp-wg-field');
          var oldId = normalizeMediaId(cfg[fieldKey]);
          return storeImageRef(file, oldId);
        }).then(function (ref) {
          if (!ref) return;
          btn._dpRef = ref;
          return global.miyaResolveMediaUrl(ref);
        }).then(function (url) {
          if (url) btn.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        }).catch(function (err) {
          if (err && err.message === 'empty_file') toast('文件为空');
          else toast('上传失败');
        });
      };
    });

    sheet.removeAttribute('hidden');
    requestAnimationFrame(function () { sheet.classList.add('is-open'); });
    state.wgEditorSlot = slotKey;
  }

  function openWidgetEditor(slotKey) {
    if (!getContactId()) return;
    renderWidgetEditor(slotKey);
  }

  function closeWidgetEditor() {
    var sheet = $('dp-wg-editor');
    if (!sheet) return;
    state.wgEditorSlot = '';
    sheet.classList.remove('is-open');
    sheet.setAttribute('hidden', '');
  }

  function bindWidgetSlotClicks() {
    Object.keys(WIDGET_SLOTS).forEach(function (slotKey) {
      var def = WIDGET_SLOTS[slotKey];
      var slot = $(def.slotId);
      if (!slot || slot._dpWgBound) return;
      slot._dpWgBound = true;
      slot.classList.add('dp-widget-slot--editable');
      slot.setAttribute('data-dp-wg-slot', slotKey);
      slot.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        openWidgetEditor(slotKey);
      });
    });
  }

  global.miyaDeepDeco = {
    WIDGET_SLOTS: WIDGET_SLOTS,
    DOCK_ICONS: DOCK_ICONS,
    open: openDecoPanel,
    close: closeDecoPanel,
    applyDecor: applyDecor,
    mergeWidgetConfig: mergeWidgetConfig,
    getWidgetSlotConfig: getWidgetSlotConfig,
    bindWidgetSlotClicks: bindWidgetSlotClicks,
    bindFileInputs: bindFileInputs,
    exportPack: exportPack,
    importPack: importPack,
    isOpen: function () { return state.open; }
  };

  bindFileInputs();
})(typeof window !== 'undefined' ? window : global);
