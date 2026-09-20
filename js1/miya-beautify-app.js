(function (global) {
  'use strict';

  var ICON_LABELS = {
    music: '音乐',
    memo: '论坛',
    set: '设置',
    book: '世界书',
    memory: '记忆',
    chat: '聊天',
    beauty: '美化',
    store: '线下',
    contacts: '联系人',
    pet: '打字机',
    pen: '模拟器',
    polaroid_1: '拍立得 · 前景',
    polaroid_2: '拍立得 · 中层',
    polaroid_3: '拍立得 · 底层',
    memo_ava_1: 'MEMO · 左头像',
    memo_ava_2: 'MEMO · 右头像',
    profile_bg: '名片 · 封面',
    profile_ava: '名片 · 头像',
    weekcal_bg: '名片 · 整体背景',
    player_cover: '播放器封面（旧）',
    player_bg: '播放器背景（旧）',
    tile_deep: '深入 · 磁贴',
    tile_notes: '日记 · 磁贴',
    tile_match: '赛事 · 磁贴',
    tile_fun: '娱乐 · 磁贴',
    tile_echo: '共鸣 · 磁贴',
    tile_log: '记录 · 磁贴',
    tile_couple: '情侣空间 · 磁贴',
    tile_themeshop: '行程轨迹 · 磁贴',
    tile_cstore: '便利店 · 磁贴',
    tile_rift: '错位时空 · 磁贴',
    p2_scrap_base: '手帐 · 底纸',
    p2_polaroid_1: '拍立得 · ①',
    p2_polaroid_2: '拍立得 · ②',
    p2_polaroid_3: '拍立得 · ③',
    p2_film_1: '胶卷 · 格 1',
    p2_film_2: '胶卷 · 格 2',
    p2_film_3: '胶卷 · 格 3',
    p2_film_4: '胶卷 · 格 4',
    p2_canister: '胶卷罐 · 顶盖',
    p2_memo_img: '便签卡 · 背景',
    p2_tape_deco: '和纸胶带 · 装饰',
    p2_stamp_img: '印章 · 图案',
    p2_ticket_bg: '票根 · 堆叠',
    folio_art: '刊物封面 · 背景',
    reel_a: '胶片 · 格 1',
    reel_b: '胶片 · 格 2',
    reel_c: '胶片 · 格 3',
    lunar_bg: '账册 · 纸张',
    tile_weather: '天气 · 悬笺',
    tile_map: '地图 · 悬笺',
    tile_apps: '应用 · 悬笺',
    tile_theater: '剧场 · 雾框',
    p4_mist_a: '雾底 · 背景',
    p4_mist_b: '光晕 · 点缀',
    p4_chip: '小笺 · 背景',
    p4_mood: '雾窗 · 侧图'
  };

  var pendingIconKey = null;
  var selectedIconKey = null;
  var selectedExtraKey = null;
  var selectedP2IconKey = null;
  var selectedP2WidgetKey = null;
  var selectedP3IconKey = null;
  var selectedP3WidgetKey = null;
  var selectedP4IconKey = null;
  var selectedP4WidgetKey = null;
  var pendingFont = null;
  var selectedCustomIconKey = null;

  function isCustomLayoutMode() {
    return global.miyaGetDeskLayoutMode && global.miyaGetDeskLayoutMode() === 'custom';
  }

  function getActiveSurfaceTheme() {
    if (isCustomLayoutMode() && global.miyaGetCustomDeskTheme) {
      return global.miyaGetCustomDeskTheme();
    }
    return global.miyaGetTheme ? global.miyaGetTheme() : {};
  }

  function isCustomDeskIconKey(key) {
    return (global.miyaCUSTOM_DESK_ICON_KEYS || []).indexOf(key) >= 0;
  }

  function isP2TileKey(key) {
    return (global.miyaP2_TILE_KEYS || []).indexOf(key) >= 0;
  }

  function isP2WidgetKey(key) {
    return (global.miyaP2_WIDGET_KEYS || []).indexOf(key) >= 0;
  }

  function isP3TileKey(key) {
    return (global.miyaP3_TILE_KEYS || []).indexOf(key) >= 0;
  }

  function isP3WidgetKey(key) {
    return (global.miyaP3_WIDGET_KEYS || []).indexOf(key) >= 0;
  }

  function isP4TileKey(key) {
    return (global.miyaP4_TILE_KEYS || []).indexOf(key) >= 0;
  }

  function isP4WidgetKey(key) {
    return (global.miyaP4_WIDGET_KEYS || []).indexOf(key) >= 0;
  }

  function isP1AppIconKey(key) {
    return (global.miyaAPP_KEYS || []).indexOf(key) >= 0;
  }

  function getThemeMediaRef(key, theme) {
    theme = theme || getActiveSurfaceTheme();
    if (key.indexOf('polaroid_') === 0) return theme.polaroids && theme.polaroids[key];
    if (key.indexOf('memo_ava_') === 0 || key === 'profile_ava') return theme.memoAvas && theme.memoAvas[key];
    if (isP2TileKey(key)) return theme.p2Tiles && theme.p2Tiles[key];
    if (isP3TileKey(key)) return theme.p3Tiles && theme.p3Tiles[key];
    if (isP4TileKey(key)) return theme.p4Tiles && theme.p4Tiles[key];
    if (isP2WidgetKey(key)) return theme.p2Widgets && theme.p2Widgets[key];
    if (isP3WidgetKey(key)) return theme.p3Widgets && theme.p3Widgets[key];
    if (isP4WidgetKey(key)) return theme.p4Widgets && theme.p4Widgets[key];
    if (key === 'profile_bg') return theme.profileBg;
    if (key === 'weekcal_bg') return theme.weekcalBg;
    if (key === 'player_cover') return theme.playerCover;
    if (key === 'player_bg') return theme.playerBg;
    return theme.icons && theme.icons[key];
  }

  function defaultIconGlyph(key) {
    if (global.miyaAppSvg && global.miyaAppSvg[key]) return global.miyaAppSvg[key];
    var map = {
      music: '♪', memo: 'M', set: '⚙', book: '书', memory: '忆', chat: '聊',
      beauty: '美', store: '店', contacts: '人', pet: '打', pen: '模',
      tile_deep: '深', tile_notes: '日', tile_match: '赛', tile_fun: '娱',
      tile_echo: '鸣', tile_log: '录',
      tile_couple: '侣', tile_themeshop: '程', tile_cstore: '店', tile_rift: '错',
      couple: '侣', itinerary: '程', cstore: '店', rift: '错',
      deep: '深', notes: '日', match: '赛', fun: '娱', echo: '鸣', log: '录',
      weather: '天', map: '图', apps: '应', theater: '剧',
      tile_weather: '天', tile_map: '图', tile_apps: '应', tile_theater: '剧',
      p2_scrap_base: '纸', p2_polaroid_1: '①', p2_polaroid_2: '②', p2_polaroid_3: '③',
      p2_film_1: '1', p2_film_2: '2', p2_film_3: '3', p2_film_4: '4',
      p2_canister: '罐', p2_memo_img: '笺', p2_tape_deco: '胶', p2_stamp_img: '印', p2_ticket_bg: '票',
      profile_bg: '封', profile_ava: '像', weekcal_bg: '底',
      folio_art: '刊', reel_a: '1', reel_b: '2', reel_c: '3', lunar_bg: '账',
      p4_mist_a: '雾', p4_mist_b: '霭', p4_chip: '笺', p4_mood: '光'
    };
    return map[key] || '◆';
  }

  function $(id) { return document.getElementById(id); }

  function resolveTextMode(theme) {
    if (!theme) return 'black';
    if (theme.textColorMode === 'white' || theme.textColorMode === 'black') return theme.textColorMode;
    var c = String(theme.textColor || '').toLowerCase();
    if (c.indexOf('255') >= 0 && c.indexOf('rgb') >= 0) return 'white';
    return 'black';
  }

  function syncTextModeUi(theme) {
    var mode = resolveTextMode(theme);
    var pick = document.getElementById('miya-bf-text-pick');
    if (!pick) return;
    pick.querySelectorAll('[data-bf-text-mode]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-bf-text-mode') === mode);
    });
  }

  function toast(msg) {
    var div = document.createElement('div');
    div.className = 'ins-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () { div.remove(); }, 2400);
  }

  function promptUrl(label) {
    if (!global.miyaDialog || !global.miyaDialog.prompt) {
      return Promise.resolve(prompt(label || '输入图片 URL') || null);
    }
    return global.miyaDialog.prompt({
      title: '图片链接',
      message: label || '粘贴可访问的图片地址',
      placeholder: 'https://'
    });
  }

  function buildIconGrid() {
    var gridApps = $('miya-bf-icon-grid');
    var gridExtra = $('miya-bf-extra-grid');
    var gridP2Icons = $('miya-bf-p2-icon-grid');
    var gridP2Widgets = $('miya-bf-p2-widget-grid');
    var gridP3Icons = $('miya-bf-p3-icon-grid');
    var gridP3Widgets = $('miya-bf-p3-widget-grid');
    var gridP4Icons = $('miya-bf-p4-icon-grid');
    var gridP4Widgets = $('miya-bf-p4-widget-grid');
    if (!gridApps || !gridExtra) return;

    function appendItem(grid, key) {
      var item = document.createElement('article');
      item.className = 'ins-icon-pick';
      item.innerHTML =
        '<button type="button" class="ins-icon-pick__btn" data-bf-pick="' + key + '">' +
          '<span class="ins-icon-pick__preview" data-bf-preview="' + key + '">' +
            '<span class="ins-icon-pick__glyph" data-bf-glyph="' + key + '">' + defaultIconGlyph(key) + '</span>' +
          '</span>' +
          '<span class="ins-icon-pick__name">' + (ICON_LABELS[key] || key) + '</span>' +
        '</button>' +
        '<button type="button" class="ins-chip ins-chip--dim ins-icon-pick__reset" data-bf-clear="' + key + '">恢复默认</button>';
      grid.appendChild(item);
    }

    gridApps.innerHTML = '';
    gridExtra.innerHTML = '';
    if (gridP2Icons) gridP2Icons.innerHTML = '';
    if (gridP2Widgets) gridP2Widgets.innerHTML = '';
    if (gridP3Icons) gridP3Icons.innerHTML = '';
    if (gridP3Widgets) gridP3Widgets.innerHTML = '';
    if (gridP4Icons) gridP4Icons.innerHTML = '';
    if (gridP4Widgets) gridP4Widgets.innerHTML = '';
    (global.miyaAPP_KEYS || []).forEach(function (k) { appendItem(gridApps, k); });
    (global.miyaPOLAROID_KEYS || []).concat([
      'profile_bg', 'profile_ava', 'weekcal_bg',
      'memo_ava_1', 'memo_ava_2'
    ]).forEach(function (k) {
      appendItem(gridExtra, k);
    });
    (global.miyaP2_TILE_KEYS || []).forEach(function (k) {
      if (gridP2Icons) appendItem(gridP2Icons, k);
    });
    (global.miyaP3_TILE_KEYS || []).forEach(function (k) {
      if (gridP3Icons) appendItem(gridP3Icons, k);
    });
    (global.miyaP4_TILE_KEYS || []).forEach(function (k) {
      if (gridP4Icons) appendItem(gridP4Icons, k);
    });
    (global.miyaP2_WIDGET_KEYS || []).forEach(function (k) {
      if (gridP2Widgets) appendItem(gridP2Widgets, k);
    });
    (global.miyaP3_WIDGET_KEYS || []).forEach(function (k) {
      if (gridP3Widgets) appendItem(gridP3Widgets, k);
    });
    (global.miyaP4_WIDGET_KEYS || []).forEach(function (k) {
      if (gridP4Widgets) appendItem(gridP4Widgets, k);
    });
    refreshIconPreviews();
  }

  function buildCustomIconGrid() {
    var grid = $('miya-bf-custom-icon-grid');
    if (!grid) return;
    var labels = global.miyaCUSTOM_DESK_LABELS || ICON_LABELS;
    grid.innerHTML = '';
    (global.miyaCUSTOM_DESK_ICON_KEYS || []).forEach(function (key) {
      var item = document.createElement('article');
      item.className = 'ins-icon-pick';
      item.innerHTML =
        '<button type="button" class="ins-icon-pick__btn" data-bf-pick="' + key + '">' +
          '<span class="ins-icon-pick__preview" data-bf-preview="' + key + '">' +
            '<span class="ins-icon-pick__glyph" data-bf-glyph="' + key + '">' + defaultIconGlyph(key) + '</span>' +
          '</span>' +
          '<span class="ins-icon-pick__name">' + (labels[key] || ICON_LABELS[key] || key) + '</span>' +
        '</button>' +
        '<button type="button" class="ins-chip ins-chip--dim ins-icon-pick__reset" data-bf-clear="' + key + '">恢复默认</button>';
      grid.appendChild(item);
    });
  }

  function buildCustomWidgetGallery() {
    var grid = $('miya-bf-custom-wg-showcase');
    if (!grid) return;
    grid.innerHTML = '';
    var ids = global.miyaGetEditableCustomWidgetIds
      ? global.miyaGetEditableCustomWidgetIds()
      : ['profile', 'memo', 'polaroid'];
    if (!ids.length) {
      grid.innerHTML = '<p class="ins-atelier-panel-desc">暂无可用组件</p>';
      return;
    }
    ids.forEach(function (id) {
      var card = global.miyaBuildCustomWidgetPreview
        ? global.miyaBuildCustomWidgetPreview(id)
        : null;
      if (card) grid.appendChild(card);
    });
  }

  function syncLayoutModeUi() {
    var mode = isCustomLayoutMode() ? 'custom' : 'fixed';
    var pick = $('miya-bf-layout-pick');
    if (pick) {
      pick.querySelectorAll('[data-bf-layout]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-bf-layout') === mode);
      });
    }
    var hint = $('miya-bf-layout-hint');
    if (hint) {
      hint.textContent = mode === 'custom'
        ? '自定义布局 · 壁纸、图标与字体独立保存；左滑翻页可自动增加空白页'
        : '固定布局 · 四页杂志风桌面';
    }
    var presetTitle = $('miya-bf-preset-title');
    var presetHint = $('miya-bf-preset-hint');
    if (presetTitle) {
      presetTitle.textContent = mode === 'custom' ? '自定义布局方案' : '固定布局方案';
    }
      if (presetHint) {
      presetHint.textContent = mode === 'custom'
        ? '保存壁纸、图标、字体、桌面布局与自定义小组件库，与固定布局方案分开存储'
        : '保存壁纸、图标与字体组合，可随时切换';
    }
    var app = $('miya-beautify-app');
    if (app) {
      app.querySelectorAll('.is-fixed-layout-only').forEach(function (el) {
        el.hidden = mode === 'custom';
      });
      app.querySelectorAll('.is-custom-layout-only').forEach(function (el) {
        el.hidden = mode !== 'custom';
      });
      var activePanel = app.querySelector('[data-bf-panel].is-active');
      if (activePanel && activePanel.hidden) switchBeautifyTab('scene');
    }
    var lede = $('miya-bf-masthead-lede');
    if (lede) {
      lede.textContent = mode === 'custom'
        ? '在这里换壁纸和图标；桌面小组件请回到主屏点按编辑，每个实例独立保存。'
        : '在这里换壁纸和图标；固定布局可在组件页替换挂件图片。';
    }
    var wallTitle = document.querySelector('[data-bf-panel="scene"] .ins-atelier-showcase-side .ins-atelier-panel-title');
    if (wallTitle) {
      wallTitle.textContent = mode === 'custom' ? '自定义壁纸' : '主屏壁纸';
    }
    if (mode === 'custom') buildCustomWidgetGallery();
  }

  function refreshIconPreviews() {
    var theme = getActiveSurfaceTheme();
    document.querySelectorAll('[data-bf-preview]').forEach(function (el) {
      var key = el.getAttribute('data-bf-preview');
      var ref = getThemeMediaRef(key, theme);
      var glyph = el.querySelector('[data-bf-glyph]');
      if (!ref) {
        el.style.backgroundImage = '';
        el.classList.remove('has-image');
        if (glyph) glyph.hidden = false;
        return;
      }
      global.miyaResolveMediaUrl(ref).then(function (url) {
        if (!url) return;
        el.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        el.classList.add('has-image');
        if (glyph) glyph.hidden = true;
      });
    });
  }

  function markIconSelection(key, gridKind) {
    if (gridKind === 'extra') selectedExtraKey = key;
    else if (gridKind === 'custom-icon') selectedCustomIconKey = key;
    else if (gridKind === 'p2-icon') selectedP2IconKey = key;
    else if (gridKind === 'p2-widget') selectedP2WidgetKey = key;
    else if (gridKind === 'p3-icon') selectedP3IconKey = key;
    else if (gridKind === 'p3-widget') selectedP3WidgetKey = key;
    else if (gridKind === 'p4-icon') selectedP4IconKey = key;
    else if (gridKind === 'p4-widget') selectedP4WidgetKey = key;
    else selectedIconKey = key;

    var label = ICON_LABELS[key] || key;
    var labelMap = {
      icon: 'miya-bf-icon-url-label',
      'custom-icon': 'miya-bf-icon-url-label',
      extra: 'miya-bf-extra-url-label',
      'p2-icon': 'miya-bf-p2-icon-url-label',
      'p2-widget': 'miya-bf-p2-widget-url-label',
      'p3-icon': 'miya-bf-p3-icon-url-label',
      'p3-widget': 'miya-bf-p3-widget-url-label',
      'p4-icon': 'miya-bf-p4-icon-url-label',
      'p4-widget': 'miya-bf-p4-widget-url-label'
    };
    var gridMap = {
      icon: 'miya-bf-icon-grid',
      'custom-icon': 'miya-bf-custom-icon-grid',
      extra: 'miya-bf-extra-grid',
      'p2-icon': 'miya-bf-p2-icon-grid',
      'p2-widget': 'miya-bf-p2-widget-grid',
      'p3-icon': 'miya-bf-p3-icon-grid',
      'p3-widget': 'miya-bf-p3-widget-grid',
      'p4-icon': 'miya-bf-p4-icon-grid',
      'p4-widget': 'miya-bf-p4-widget-grid'
    };
    var labelEl = $(labelMap[gridKind] || labelMap.icon);
    if (labelEl) labelEl.textContent = '链接替换 · ' + label;
    var grid = $(gridMap[gridKind] || gridMap.icon);
    if (!grid) return;
    grid.querySelectorAll('.ins-icon-pick').forEach(function (tile) {
      var pick = tile.querySelector('[data-bf-pick]');
      tile.classList.toggle('is-selected', !!(pick && pick.getAttribute('data-bf-pick') === key));
    });
  }

  function gridKindFromPickBtn(btn) {
    if (btn.closest('#miya-bf-custom-icon-grid')) return 'custom-icon';
    if (btn.closest('#miya-bf-extra-grid')) return 'extra';
    if (btn.closest('#miya-bf-p2-icon-grid')) return 'p2-icon';
    if (btn.closest('#miya-bf-p2-widget-grid')) return 'p2-widget';
    if (btn.closest('#miya-bf-p3-icon-grid')) return 'p3-icon';
    if (btn.closest('#miya-bf-p3-widget-grid')) return 'p3-widget';
    if (btn.closest('#miya-bf-p4-icon-grid')) return 'p4-icon';
    if (btn.closest('#miya-bf-p4-widget-grid')) return 'p4-widget';
    return 'icon';
  }

  function isFontFile(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    return /\.(woff2?|ttf|otf)$/.test(name);
  }

  function isFontUrl(url) {
    try {
      var path = decodeURIComponent(String(url || '').split('?')[0].split('#')[0]).toLowerCase();
      return /\.(woff2?|ttf|otf)$/.test(path);
    } catch (e) {
      return false;
    }
  }

  function fontNameFromInputUrl(url) {
    if (global.miyaFontNameFromUrl) return global.miyaFontNameFromUrl(url);
    try {
      var path = decodeURIComponent(String(url || '').split('?')[0].split('#')[0]);
      var seg = path.split('/').pop() || '';
      return seg.replace(/\.[^.]+$/, '') || 'Custom';
    } catch (e) {
      return 'Custom';
    }
  }

  function handleFontStored(res, options) {
    options = options || {};
    pendingFont = res;
    syncFontActionUi();
    return loadPreviewFontFace(res).then(function (ok) {
      if (!ok) return Promise.reject(new Error('font_load_failed'));
      syncUiFromTheme();
      return applyPendingFont();
    }).catch(function (err) {
      if (!options.suppressToast) toast('字体加载失败');
      return Promise.reject(err || new Error('font_load_failed'));
    });
  }

  function getActiveFontRef() {
    if (pendingFont && pendingFont.id) return pendingFont;
    var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    if (theme.fontId && theme.fontName) return { id: theme.fontId, name: theme.fontName };
    return null;
  }

  function promptFontPresetName(defaultName) {
    if (global.miyaDialog && typeof global.miyaDialog.prompt === 'function') {
      return global.miyaDialog.prompt({
        title: '保存为预设',
        message: '为这款字体取个名字',
        defaultValue: defaultName || '我的字体',
        confirmText: '保存',
        cancelText: '取消',
        maxLength: 32
      }).then(function (val) {
        return val ? String(val).trim() : '';
      });
    }
    var n = prompt('为这款字体取个名字', defaultName || '我的字体');
    return Promise.resolve(n ? String(n).trim() : '');
  }

  function loadPreviewFontFace(ref) {
    if (!ref || !ref.id || !global.miyaEnsureFontLoaded) return Promise.resolve(false);
    return global.miyaEnsureFontLoaded(ref.id, ref.name);
  }

  function syncFontActionUi() {
    var hasPending = !!(pendingFont && pendingFont.id);
    var saveBtn = document.querySelector('[data-bf-font-save-preset]');
    var applyBtn = document.querySelector('[data-bf-font-apply]');
    if (saveBtn) saveBtn.disabled = !hasPending;
    if (applyBtn) applyBtn.disabled = !hasPending;
  }

  function renderFontPresets() {
    var listEl = $('miya-bf-font-preset-list');
    if (!listEl || typeof global.miyaGetFontPresets !== 'function') return;
    var list = global.miyaGetFontPresets();
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<p class="ins-atelier-panel-desc ins-atelier-panel-desc--tight">暂无预设，上传字体后可保存。</p>';
      return;
    }
    list.forEach(function (p) {
      var row = document.createElement('article');
      row.className = 'ins-archive-item';
      var date = p.savedAt ? new Date(p.savedAt).toLocaleDateString('zh-CN') : '';
      row.innerHTML =
        '<strong>' + (p.name || p.fontName || '自定义字体') + '</strong>' +
        '<small>' + date + '</small>' +
        '<div class="ins-archive-actions">' +
        '<button type="button" class="ins-chip ins-chip--gold" data-font-preset-apply="' + p.id + '">应用</button>' +
        '<button type="button" class="ins-chip ins-chip--dim" data-font-preset-del="' + p.id + '">删除</button>' +
        '</div>';
      listEl.appendChild(row);
    });
  }

  function applyPendingFont() {
    if (!pendingFont || !pendingFont.id) {
      toast('请先上传字体或选择预设');
      return Promise.resolve(false);
    }
    global.miyaSetTheme({ fontId: pendingFont.id, fontName: pendingFont.name });
    return global.miyaApplyFont().then(function () {
      if (isCustomLayoutMode() && global.miyaApplyCustomDesk) {
        return global.miyaApplyCustomDesk();
      }
      return global.miyaApplyTheme();
    }).then(function () {
      syncUiFromTheme();
      toast('字体已应用');
      return true;
    }).catch(function () {
      toast('字体应用失败');
      return false;
    });
  }

  function renderPresets() {
    var listEl = $('miya-bf-preset-list');
    if (!listEl) return;
    var isCustom = isCustomLayoutMode();
    var list = isCustom
      ? (global.miyaGetCustomPresets ? global.miyaGetCustomPresets() : [])
      : (global.miyaGetPresets ? global.miyaGetPresets() : []);
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<p class="ins-atelier-panel-desc">还没有保存的方案，保存后会显示在这里。</p>';
      return;
    }
    list.forEach(function (p) {
      var row = document.createElement('article');
      row.className = 'ins-archive-item ins-archive-item--clickable';
      row.setAttribute('data-preset-id', p.id);
      row.setAttribute('data-preset-kind', isCustom ? 'custom' : 'fixed');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      var date = p.savedAt ? new Date(p.savedAt).toLocaleDateString('zh-CN') : '';
      row.innerHTML =
        '<strong>' + (p.name || '未命名') + '</strong>' +
        '<small>' + date + '</small>' +
        '<div class="ins-archive-actions">' +
        '<button type="button" class="ins-chip ins-chip--gold" data-preset-load="' + p.id + '">应用</button>' +
        '<button type="button" class="ins-chip ins-chip--dim" data-preset-del="' + p.id + '">删除</button>' +
        '</div>';
      listEl.appendChild(row);
    });
  }

  function loadPresetById(id) {
    if (isCustomLayoutMode()) {
      return global.miyaLoadCustomPreset(id).then(function (ok) {
        if (ok) {
          syncUiFromTheme();
          refreshIconPreviews();
          toast('方案已应用');
        }
        return ok;
      });
    }
    return global.miyaLoadPreset(id).then(function (ok) {
      if (ok) {
        syncUiFromTheme();
        toast('方案已应用');
      }
      return ok;
    });
  }

  function refreshWallPreview() {
    var frame = $('miya-bf-wall-preview');
    if (!frame) return;
    var theme = getActiveSurfaceTheme();
    var label = frame.querySelector('.ins-atelier-frame-label');
    global.miyaResolveMediaUrl(theme.wallpaper).then(function (url) {
      if (url) {
        frame.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        frame.style.backgroundSize = 'cover';
        frame.style.backgroundPosition = 'center';
        if (label) label.textContent = '壁纸预览';
      } else {
        frame.style.backgroundImage = '';
        if (label) label.textContent = '点击上传壁纸';
      }
    });
  }

  var WD_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function syncLockPreviewClock() {
    var d = new Date();
    var t = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var timeEl = $('miya-bf-lock-preview-time');
    var dateEl = $('miya-bf-lock-preview-date');
    if (timeEl) timeEl.textContent = t;
    if (dateEl) dateEl.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WD_ZH[d.getDay()];
  }

  function refreshLockWallPreview() {
    var frame = $('miya-bf-lock-wall-preview');
    if (!frame || !global.miyaGetLockSettings) return;
    syncLockPreviewClock();
    var lock = global.miyaGetLockSettings();
    var placeholder = frame.querySelector('.ins-atelier-lock-preview__placeholder');
    if (!lock.wallpaper) {
      frame.style.backgroundImage = '';
      frame.classList.remove('has-image');
      if (placeholder) placeholder.textContent = '点击上传锁屏壁纸';
      return;
    }
    global.miyaResolveMediaUrl(lock.wallpaper).then(function (url) {
      if (url) {
        frame.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        frame.classList.add('has-image');
        if (placeholder) placeholder.textContent = '锁屏预览';
      } else {
        frame.style.backgroundImage = '';
        frame.classList.remove('has-image');
        if (placeholder) placeholder.textContent = '点击上传锁屏壁纸';
      }
    });
  }

  function syncLockUi() {
    if (!global.miyaGetLockSettings) return;
    var lock = global.miyaGetLockSettings();

    var wallSw = $('miya-bf-lock-wall-switch');
    var wallStatus = $('miya-bf-lock-wall-status');
    var wallPanel = $('miya-bf-lock-wall-panel');
    if (wallSw) {
      wallSw.classList.toggle('is-on', !!lock.wallpaperEnabled);
      wallSw.setAttribute('aria-checked', lock.wallpaperEnabled ? 'true' : 'false');
    }
    if (wallStatus) {
      wallStatus.textContent = lock.wallpaperEnabled
        ? (lock.wallpaper ? '已开启 · 已设置壁纸' : '已开启 · 待上传壁纸')
        : '未开启';
    }
    if (wallPanel) wallPanel.hidden = !lock.wallpaperEnabled;

    var passSw = $('miya-bf-lock-pass-switch');
    var passStatus = $('miya-bf-lock-pass-status');
    var passPanel = $('miya-bf-lock-pass-panel');
    if (passSw) {
      passSw.classList.toggle('is-on', !!lock.passcodeEnabled);
      passSw.setAttribute('aria-checked', lock.passcodeEnabled ? 'true' : 'false');
    }
    if (passStatus) {
      passStatus.textContent = lock.passcodeEnabled ? '已开启 · 四位数字' : '未开启';
    }
    if (passPanel) passPanel.hidden = !lock.passcodeEnabled;

    refreshLockWallPreview();
  }

  function isValidPasscode(v) {
    return /^\d{4}$/.test(String(v || '').trim());
  }

  function promptPasscode(title, message) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt({
        title: title || '设置锁屏密码',
        message: message || '请输入四位数字密码',
        placeholder: '0000'
      }).then(function (val) {
        if (!val) return null;
        val = String(val).trim();
        return isValidPasscode(val) ? val : '__invalid__';
      });
    }
    var val = prompt(message || '请输入四位数字密码') || '';
    val = String(val).trim();
    if (!val) return null;
    return isValidPasscode(val) ? val : '__invalid__';
  }

  function setupPasscode() {
    return promptPasscode('设置锁屏密码', '请输入四位数字密码').then(function (first) {
      if (!first) return null;
      if (first === '__invalid__') {
        toast('密码须为四位数字');
        return setupPasscode();
      }
      return promptPasscode('确认锁屏密码', '请再次输入以确认').then(function (second) {
        if (!second) return null;
        if (second === '__invalid__') {
          toast('密码须为四位数字');
          return setupPasscode();
        }
        if (first !== second) {
          toast('两次输入不一致');
          return setupPasscode();
        }
        return first;
      });
    });
  }

  function enablePasscode() {
    return setupPasscode().then(function (code) {
      if (!code) return false;
      global.miyaSetLockSettings({ passcodeEnabled: true, passcode: code });
      syncLockUi();
      toast('锁屏密码已设置');
      return true;
    });
  }

  function disablePasscode() {
    global.miyaSetLockSettings({ passcodeEnabled: false, passcode: null });
    syncLockUi();
    toast('锁屏密码已关闭');
  }

  function switchBeautifyTab(tabId) {
    var app = $('miya-beautify-app');
    if (!app) return;
    app.querySelectorAll('[data-bf-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-bf-tab') === tabId);
    });
    app.querySelectorAll('[data-bf-panel]').forEach(function (panel) {
      var on = panel.getAttribute('data-bf-panel') === tabId;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    if (tabId === 'object' && isCustomLayoutMode()) buildCustomWidgetGallery();
  }

  function syncSplashUi(theme) {
    var on = !theme || theme.splashEnabled !== false;
    var splash = $('miya-bf-splash-switch');
    if (splash) {
      splash.classList.toggle('is-on', on);
      splash.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var status = $('miya-bf-splash-status');
    if (status) {
      status.textContent = on ? '已开启 · 进入时自动播放' : '已关闭 · 进入时不再播放';
    }
    var preview = $('miya-bf-splash-preview');
    if (preview) {
      preview.disabled = !on;
      preview.classList.toggle('is-disabled', !on);
    }
  }

  function syncIconFrameUi(theme) {
    var on = !!(theme && theme.iconFrameless);
    var sw = $('miya-bf-icon-frame-switch');
    if (sw) {
      sw.classList.toggle('is-on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var status = $('miya-bf-icon-frame-status');
    if (status) {
      status.textContent = on ? '已开启 · 自定义图标无外框' : '已关闭 · 自定义图标保留玻璃外框';
    }
  }

  function syncAltIconStyleUi(theme) {
    var on = !!(theme && theme.altIconStyle);
    var sw = $('miya-bf-alt-icon-switch');
    if (sw) {
      sw.classList.toggle('is-on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var status = $('miya-bf-alt-icon-status');
    if (status) {
      status.textContent = on ? '已开启 · 实心初始图标（已自定义图片不受影响）' : '已关闭 · 使用线稿初始图标';
    }
  }

  function refreshDefaultIconGlyphs() {
    document.querySelectorAll('[data-bf-glyph]').forEach(function (glyph) {
      var key = glyph.getAttribute('data-bf-glyph');
      if (!key) return;
      glyph.innerHTML = defaultIconGlyph(key);
    });
  }

  function syncUiFromTheme() {
    syncLayoutModeUi();
    var theme = getActiveSurfaceTheme();
    syncSplashUi(global.miyaGetTheme ? global.miyaGetTheme() : {});
    syncIconFrameUi(theme);
    syncAltIconStyleUi(theme);
    refreshWallPreview();
    syncLockUi();
    syncTextModeUi(theme);
    var fixedTheme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    var fontHint = $('miya-bf-font-name');
    var activeFont = getActiveFontRef();
    if (fontHint) {
      if (activeFont) {
        var applied = fixedTheme.fontId === activeFont.id;
        fontHint.textContent = applied
          ? '当前字体 · ' + activeFont.name + (isCustomLayoutMode() ? ' · 与固定布局同步' : '')
          : '待应用 · ' + activeFont.name + '（点击「应用字体」生效）';
      } else {
        fontHint.textContent = '支持本地上传或粘贴链接 · .woff / .woff2 / .ttf / .otf · 全局字体与固定布局同步';
      }
    }
    var previewIn = $('miya-bf-font-preview-input');
    if (previewIn) previewIn.value = fixedTheme.fontPreviewText || '';
    var previewSize = $('miya-bf-font-preview-size');
    if (previewSize) previewSize.value = fixedTheme.fontPreviewSize || 18;
    syncFontActionUi();
    updateFontPreview();
    renderAppFontSizes();
    renderFontPresets();
    renderPresets();
  }

  function formatSizeLabel(size) {
    if (global.miyaFormatFontSizeLabel) return global.miyaFormatFontSizeLabel(size);
    size = parseFloat(size);
    if (!Number.isFinite(size)) return '18';
    return size % 1 === 0 ? String(size) : size.toFixed(1);
  }

  function renderAppFontSizes() {
    var listEl = $('miya-bf-app-font-list');
    if (!listEl || !global.miyaAPP_FONT_TARGETS) return;
    var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    var defaultSize = parseFloat(theme.fontPreviewSize) || 18;
    var sizes = theme.appFontSizes || {};
    listEl.innerHTML = '';
    (global.miyaAPP_FONT_TARGETS || []).forEach(function (t) {
      var hasOverride = sizes[t.key] != null;
      var val = hasOverride ? sizes[t.key] : defaultSize;
      var label = formatSizeLabel(val);
      var row = document.createElement('div');
      row.className = 'ins-app-font-row' + (hasOverride ? ' is-custom' : '');
      row.setAttribute('data-app-font-key', t.key);
      row.innerHTML =
        '<span class="ins-app-font-row__name">' + t.label + '</span>' +
        '<div class="ins-app-font-row__ctrl">' +
          '<span class="ins-app-font-row__val">' + label + '</span>' +
          '<input type="range" class="ins-range ins-range--compact" data-app-font-range="' + t.key + '" min="12" max="36" step="0.5" value="' + val + '">' +
        '</div>' +
        '<button type="button" class="ins-chip ins-chip--dim ins-app-font-row__reset" data-app-font-reset="' + t.key + '"' + (hasOverride ? '' : ' hidden') + '>默认</button>';
      listEl.appendChild(row);
    });
  }

  function syncAppFontSizeRow(appKey) {
    var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    var defaultSize = parseFloat(theme.fontPreviewSize) || 18;
    var sizes = theme.appFontSizes || {};
    var hasOverride = sizes[appKey] != null;
    var val = hasOverride ? sizes[appKey] : defaultSize;
    var row = document.querySelector('[data-app-font-key="' + appKey + '"]');
    if (!row) return;
    row.classList.toggle('is-custom', hasOverride);
    var valEl = row.querySelector('.ins-app-font-row__val');
    var range = row.querySelector('[data-app-font-range="' + appKey + '"]');
    var resetBtn = row.querySelector('[data-app-font-reset="' + appKey + '"]');
    if (valEl) valEl.textContent = formatSizeLabel(val);
    if (range) range.value = String(val);
    if (resetBtn) resetBtn.hidden = !hasOverride;
  }

  function syncAllAppFontSizeRows() {
    (global.miyaAPP_FONT_TARGETS || []).forEach(function (t) {
      syncAppFontSizeRow(t.key);
    });
  }

  function sizesEqual(a, b) {
    if (global.miyaFontSizesEqual) return global.miyaFontSizesEqual(a, b);
    return parseFloat(a) === parseFloat(b);
  }

  function setAppFontSize(appKey, size, defaultSize) {
    var patch = {};
    if (sizesEqual(size, defaultSize)) {
      patch[appKey] = null;
    } else {
      patch[appKey] = size;
    }
    global.miyaSetTheme({ appFontSizes: patch });
    syncAppFontSizeRow(appKey);
    if (global.miyaApplyFontSizeForKey) global.miyaApplyFontSizeForKey(appKey);
  }

  function updateFontPreview() {
    var sample = $('miya-bf-font-preview-sample');
    var badge = $('miya-bf-font-preview-badge');
    var sizeLbl = $('miya-bf-font-preview-size-lbl');
    var sizeIn = $('miya-bf-font-preview-size');
    if (!sample) return;
    var theme = global.miyaGetTheme();
    var activeFont = getActiveFontRef();
    var text = (theme.fontPreviewText || '').trim() ||
      'miya · 雪景窗\nABCDEFG abcdefghijk 0123456789';
    sample.textContent = text;
    var size = sizeIn ? parseFloat(sizeIn.value) : 18;
    if (!Number.isFinite(size)) size = 18;
    var scale = global.miyaSizeToFontScale ? global.miyaSizeToFontScale(size) : 1;
    sample.style.fontSize = Math.round(18 * scale * 10) / 10 + 'px';
    if (sizeLbl) sizeLbl.textContent = formatSizeLabel(size);
    var family = activeFont
      ? "'" + (activeFont.name || 'Custom').replace(/'/g, '') + "', var(--miya-font)"
      : 'var(--miya-font)';
    sample.style.fontFamily = family;
    if (badge) badge.textContent = activeFont ? activeFont.name : '系统默认';
  }

  function applyMediaKey(key, ref) {
    if (isCustomLayoutMode()) {
      if (isCustomDeskIconKey(key)) return global.miyaCustomSetIcon(key, ref);
      if (key.indexOf('polaroid_') === 0) {
        return global.miyaCustomSetPolaroid ? global.miyaCustomSetPolaroid(key, ref) : Promise.resolve();
      }
      if (key.indexOf('memo_ava_') === 0 || key === 'profile_ava') {
        return global.miyaCustomSetMemoAva ? global.miyaCustomSetMemoAva(key, ref) : Promise.resolve();
      }
      if (key === 'profile_bg') {
        return global.miyaCustomSetProfileBg ? global.miyaCustomSetProfileBg(ref) : Promise.resolve();
      }
    }
    if (key.indexOf('polaroid_') === 0) return global.miyaSetPolaroid(key, ref);
    if (key.indexOf('memo_ava_') === 0 || key === 'profile_ava') return global.miyaSetMemoAva(key, ref);
    if (isP2TileKey(key)) return global.miyaSetP2Tile(key, ref);
    if (isP3TileKey(key)) return global.miyaSetP3Tile(key, ref);
    if (isP4TileKey(key)) return global.miyaSetP4Tile(key, ref);
    if (isP2WidgetKey(key)) return global.miyaSetP2Widget(key, ref);
    if (isP3WidgetKey(key)) return global.miyaSetP3Widget(key, ref);
    if (isP4WidgetKey(key)) return global.miyaSetP4Widget(key, ref);
    if (key === 'profile_bg') return global.miyaSetProfileBg(ref);
    if (key === 'weekcal_bg') return global.miyaSetWeekcalBg(ref);
    if (key === 'player_cover') return global.miyaSetPlayerCover(ref);
    if (key === 'player_bg') return global.miyaSetPlayerBg(ref);
    return global.miyaSetIcon(key, ref);
  }

  function bindEvents() {
    var app = $('miya-beautify-app');
    if (!app || app.dataset.bound) return;
    app.dataset.bound = '1';

    $('miya-bf-back').addEventListener('click', function () {
      if (isCustomWidgetSubpageOpen()) {
        closeCustomWidgetTemplates();
        return;
      }
      closeBeautifyApp();
    });

    buildIconGrid();
    buildCustomIconGrid();
    buildCustomWidgetGallery();
    syncUiFromTheme();

    var layoutPick = $('miya-bf-layout-pick');
    if (layoutPick) {
      layoutPick.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-bf-layout]');
        if (!btn) return;
        var next = btn.getAttribute('data-bf-layout') === 'custom' ? 'custom' : 'fixed';
        if (next === (isCustomLayoutMode() ? 'custom' : 'fixed')) return;
        if (!global.miyaSwitchDeskLayout) return;
        global.miyaSwitchDeskLayout(next).then(function () {
          syncUiFromTheme();
          refreshIconPreviews();
          toast(next === 'custom' ? '已切换至自定义布局' : '已切换至固定布局');
        });
      });
    }

    app.querySelectorAll('[data-bf-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchBeautifyTab(btn.getAttribute('data-bf-tab'));
      });
    });

    app.addEventListener('click', function (e) {
      if (e.target.closest('[data-bf-wall-pick]')) {
        var wallFileInp = $('miya-bf-file-wall');
        if (wallFileInp && global.miyaTriggerFileInput) global.miyaTriggerFileInput(wallFileInp);
        else if (wallFileInp) wallFileInp.click();
        return;
      }
      if (e.target.closest('[data-bf-lock-wall-pick]')) {
        var lockWallInp = $('miya-bf-file-lock-wall');
        if (lockWallInp && global.miyaTriggerFileInput) global.miyaTriggerFileInput(lockWallInp);
        else if (lockWallInp) lockWallInp.click();
        return;
      }
      if (e.target.closest('[data-bf-lock-wall-url-apply]')) {
        var lockUrl = ($('miya-bf-lock-wall-url') || {}).value ? $('miya-bf-lock-wall-url').value.trim() : '';
        if (!lockUrl) { toast('请填写图片链接'); return; }
        global.miyaStoreImageUrl(lockUrl).then(function (id) {
          return global.miyaSetLockWallpaper(id);
        }).then(function () {
          global.miyaSetLockSettings({ wallpaperEnabled: true });
          refreshLockWallPreview();
          syncLockUi();
          if (global.miyaLockscreen && global.miyaLockscreen.refreshWallpaper) {
            global.miyaLockscreen.refreshWallpaper();
          }
          toast('锁屏壁纸已更新');
        }).catch(function () {
          global.miyaSetLockWallpaper(lockUrl).then(function () {
            global.miyaSetLockSettings({ wallpaperEnabled: true });
            refreshLockWallPreview();
            syncLockUi();
            toast('锁屏壁纸已更新');
          });
        });
        return;
      }
      if (e.target.closest('[data-bf-lock-wall-clear]')) {
        global.miyaSetLockWallpaper(null).then(function () {
          if ($('miya-bf-lock-wall-url')) $('miya-bf-lock-wall-url').value = '';
          refreshLockWallPreview();
          syncLockUi();
          if (global.miyaLockscreen && global.miyaLockscreen.refreshWallpaper) {
            global.miyaLockscreen.refreshWallpaper();
          }
          toast('锁屏壁纸已清除');
        });
        return;
      }
      if (e.target.closest('[data-bf-lock-pass-change]')) {
        enablePasscode();
        return;
      }
      if (e.target.closest('[data-bf-lock-pass-off]')) {
        disablePasscode();
        return;
      }
      if (e.target.closest('[data-bf-wall-url-apply]')) {
        var wallUrl = ($('miya-bf-wall-url') || {}).value ? $('miya-bf-wall-url').value.trim() : '';
        if (!wallUrl) { toast('请填写图片链接'); return; }
        var setWall = isCustomLayoutMode() ? global.miyaCustomSetWallpaper : global.miyaSetWallpaper;
        global.miyaStoreImageUrl(wallUrl).then(function (id) {
          return setWall(id);
        }).then(function () { refreshWallPreview(); toast('壁纸已更新'); })
          .catch(function () {
            setWall(wallUrl).then(function () {
              refreshWallPreview();
              toast('壁纸已更新');
            });
          });
        return;
      }
      if (e.target.closest('[data-bf-wall-clear]')) {
        var clearWall = isCustomLayoutMode()
          ? global.miyaCustomClearWallpaper
          : function () { return global.miyaSetWallpaper(null); };
        clearWall().then(function () {
          refreshWallPreview();
          if ($('miya-bf-wall-url')) $('miya-bf-wall-url').value = '';
          toast('已恢复默认壁纸');
        });
        return;
      }
      var pickBtn = e.target.closest('[data-bf-pick]');
      if (pickBtn) {
        pendingIconKey = pickBtn.getAttribute('data-bf-pick');
        var kind = gridKindFromPickBtn(pickBtn);
        markIconSelection(pendingIconKey, kind);
        if (global.miyaTriggerFileInput) global.miyaTriggerFileInput($('miya-bf-file-icon'));
        else $('miya-bf-file-icon').click();
        return;
      }
      var clearKey = e.target.closest('[data-bf-clear]');
      if (clearKey) {
        var ck = clearKey.getAttribute('data-bf-clear');
        applyMediaKey(ck, null).then(function () {
          if (isCustomLayoutMode()) {
            global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
          } else {
            global.miyaApplyTheme && global.miyaApplyTheme();
          }
          refreshIconPreviews();
          toast('已恢复默认');
        });
        return;
      }
      if (e.target.closest('[data-bf-font-upload]')) {
        if (global.miyaTriggerFileInput) global.miyaTriggerFileInput($('miya-bf-file-font'));
        else $('miya-bf-file-font').click();
        return;
      }
      if (e.target.closest('[data-bf-font-url-apply]')) {
        var fontUrl = ($('miya-bf-font-url') || {}).value ? $('miya-bf-font-url').value.trim() : '';
        if (!fontUrl) { toast('请填写字体链接'); return; }
        if (!isFontUrl(fontUrl)) {
          toast('链接须为 .woff / .woff2 / .ttf / .otf 字体文件');
          return;
        }
        if (!global.miyaStoreFontUrl) {
          toast('字体链接功能不可用');
          return;
        }
        global.miyaStoreFontUrl(fontUrl).then(function (res) {
          if ($('miya-bf-font-url')) $('miya-bf-font-url').value = '';
          return handleFontStored(res, { suppressToast: true });
        }).catch(function () {
          return handleFontStored({
            id: fontUrl,
            name: fontNameFromInputUrl(fontUrl)
          }, { suppressToast: true });
        }).catch(function () {
          toast('字体加载失败，请检查链接或跨域设置');
        });
        return;
      }
      if (e.target.closest('[data-bf-font-save-preset]')) {
        if (!pendingFont || !pendingFont.id) {
          toast('请先上传字体');
          return;
        }
        promptFontPresetName(pendingFont.name).then(function (name) {
          if (!name) return;
          var result = global.miyaSaveFontPreset(pendingFont.id, pendingFont.name, name);
          if (!result) {
            toast('保存失败');
            return;
          }
          if (result.error === 'max') {
            toast('字体预设最多 12 个');
            return;
          }
          renderFontPresets();
          toast('已保存为「' + name + '」');
        });
        return;
      }
      if (e.target.closest('[data-bf-font-apply]')) {
        applyPendingFont();
        return;
      }
      var fontPresetApply = e.target.closest('[data-font-preset-apply]');
      if (fontPresetApply) {
        var presetId = fontPresetApply.getAttribute('data-font-preset-apply');
        var preset = (global.miyaGetFontPresets ? global.miyaGetFontPresets() : [])
          .filter(function (p) { return p.id === presetId; })[0];
        if (!preset) {
          toast('预设不存在');
          return;
        }
        pendingFont = { id: preset.fontId, name: preset.fontName };
        loadPreviewFontFace(pendingFont).then(function () {
          syncFontActionUi();
          updateFontPreview();
          return applyPendingFont();
        });
        return;
      }
      var fontPresetDel = e.target.closest('[data-font-preset-del]');
      if (fontPresetDel) {
        global.miyaDeleteFontPreset(fontPresetDel.getAttribute('data-font-preset-del'));
        renderFontPresets();
        toast('预设已删除');
        return;
      }
      if (e.target.closest('[data-bf-font-reset]')) {
        pendingFont = null;
        if ($('miya-bf-font-url')) $('miya-bf-font-url').value = '';
        global.miyaSetTheme({ fontId: null, fontName: null });
        var resetChain = global.miyaApplyFont ? global.miyaApplyFont() : global.miyaApplyTheme();
        resetChain.then(function () {
          if (isCustomLayoutMode() && global.miyaApplyCustomDesk) {
            return global.miyaApplyCustomDesk();
          }
          return global.miyaApplyTheme();
        }).then(function () {
          syncUiFromTheme();
          toast('已恢复系统字体');
        });
        return;
      }
      if (e.target.closest('[data-bf-preset-save]')) {
        var name = ($('miya-bf-preset-name') || {}).value || '';
        if (!String(name).trim()) {
          toast('请填写方案名称');
          return;
        }
        if (isCustomLayoutMode()) {
          global.miyaSaveCustomPreset(name.trim());
        } else {
          global.miyaSavePreset(name.trim());
        }
        renderPresets();
        toast('方案已保存');
        return;
      }
      var loadId = e.target.closest('[data-preset-load]');
      if (loadId) {
        loadPresetById(loadId.getAttribute('data-preset-load'));
        return;
      }
      var presetRow = e.target.closest('.ins-archive-item--clickable[data-preset-id]');
      if (presetRow && !e.target.closest('.ins-archive-actions')) {
        loadPresetById(presetRow.getAttribute('data-preset-id'));
        return;
      }
      var delId = e.target.closest('[data-preset-del]');
      if (delId) {
        if (isCustomLayoutMode()) {
          global.miyaDeleteCustomPreset(delId.getAttribute('data-preset-del'));
        } else {
          global.miyaDeletePreset(delId.getAttribute('data-preset-del'));
        }
        renderPresets();
        toast('已删除');
        return;
      }
      if (e.target.closest('[data-bf-export]')) {
        var exportFn = isCustomLayoutMode()
          ? global.miyaExportCustomDecorPack
          : global.miyaExportDecorPack;
        if (!exportFn) { toast('导出失败'); return; }
        exportFn().then(function (json) {
          var blob = new Blob([json], { type: 'application/json' });
          var a = document.createElement('a');
          a.download = (isCustomLayoutMode() ? 'miya-custom-' : 'miya-decor-') + Date.now() + '.json';
          a.href = URL.createObjectURL(blob);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
          toast('外观 JSON 已导出');
        }).catch(function () { toast('导出失败'); });
        return;
      }
      if (e.target.closest('[data-bf-import]')) {
        if (global.miyaTriggerFileInput) global.miyaTriggerFileInput($('miya-bf-file-import'));
        else $('miya-bf-file-import').click();
        return;
      }
      if (e.target.closest('[data-bf-open-custom-wg-tpl]')) {
        openCustomWidgetTemplates();
        return;
      }
      if (e.target.closest('[data-bf-close-custom-wg-tpl]')) {
        closeCustomWidgetTemplates();
        return;
      }
      if (e.target.closest('[data-bf-import-custom-wg]')) {
        var cwgInp = $('miya-bf-file-custom-wg-import');
        if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(cwgInp);
        else if (cwgInp) cwgInp.click();
        return;
      }
    });

    var splashSw = $('miya-bf-splash-switch');
    if (splashSw) {
      splashSw.addEventListener('click', function () {
        var on = !splashSw.classList.contains('is-on');
        global.miyaSetTheme({ splashEnabled: on });
        syncSplashUi(global.miyaGetTheme());
        document.documentElement.classList.toggle('miya-splash-pending', on);
        toast(on ? '开屏动画已开启' : '开屏动画已关闭');
      });
    }

    var iconFrameSw = $('miya-bf-icon-frame-switch');
    if (iconFrameSw) {
      iconFrameSw.addEventListener('click', function () {
        var on = !iconFrameSw.classList.contains('is-on');
        if (isCustomLayoutMode()) {
          global.miyaSetCustomDeskTheme({ iconFrameless: on });
          global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
          syncIconFrameUi(getActiveSurfaceTheme());
        } else {
          global.miyaSetTheme({ iconFrameless: on });
          global.miyaApplyTheme && global.miyaApplyTheme();
          syncIconFrameUi(global.miyaGetTheme());
        }
        toast(on ? '已去掉图标外框' : '已恢复图标外框');
      });
    }

    var altIconSw = $('miya-bf-alt-icon-switch');
    if (altIconSw) {
      altIconSw.addEventListener('click', function () {
        var on = !altIconSw.classList.contains('is-on');
        if (isCustomLayoutMode()) {
          global.miyaSetCustomDeskTheme({ altIconStyle: on });
          global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
          syncAltIconStyleUi(getActiveSurfaceTheme());
        } else {
          global.miyaSetTheme({ altIconStyle: on });
          global.miyaApplyTheme && global.miyaApplyTheme();
          syncAltIconStyleUi(global.miyaGetTheme());
        }
        refreshDefaultIconGlyphs();
        refreshIconPreviews();
        toast(on ? '已切换为实心初始图标' : '已恢复线稿初始图标');
      });
    }

    var splashPreview = $('miya-bf-splash-preview');
    if (splashPreview) {
      splashPreview.addEventListener('click', function () {
        var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
        if (theme.splashEnabled === false) {
          toast('请先开启开屏动画');
          return;
        }
        if (!global.miyaSplash || !global.miyaSplash.play) {
          toast('开屏模块未加载');
          return;
        }
        closeBeautifyApp();
        setTimeout(function () {
          global.miyaSplash.play();
        }, 320);
      });
    }

    var lockWallSw = $('miya-bf-lock-wall-switch');
    if (lockWallSw) {
      lockWallSw.addEventListener('click', function () {
        var lock = global.miyaGetLockSettings();
        var on = !lock.wallpaperEnabled;
        global.miyaSetLockSettings({ wallpaperEnabled: on });
        syncLockUi();
        toast(on ? '锁屏壁纸已开启' : '锁屏壁纸已关闭');
      });
    }

    var lockPassSw = $('miya-bf-lock-pass-switch');
    if (lockPassSw) {
      lockPassSw.addEventListener('click', function () {
        var lock = global.miyaGetLockSettings();
        if (lock.passcodeEnabled) {
          disablePasscode();
          return;
        }
        enablePasscode().then(function (ok) {
          if (!ok) syncLockUi();
        });
      });
    }

    var textPick = $('miya-bf-text-pick');
    if (textPick) {
      textPick.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-bf-text-mode]');
        if (!btn) return;
        var mode = btn.getAttribute('data-bf-text-mode') === 'white' ? 'white' : 'black';
        var patch = {
          textColorMode: mode,
          textColor: mode === 'white' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.88)'
        };
        if (isCustomLayoutMode()) {
          global.miyaSetCustomDeskTheme(patch);
          global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
          syncTextModeUi(getActiveSurfaceTheme());
        } else {
          global.miyaSetTheme(patch);
          global.miyaApplyTheme();
          syncTextModeUi(global.miyaGetTheme());
        }
      });
    }

    var previewIn = $('miya-bf-font-preview-input');
    if (previewIn) {
      previewIn.addEventListener('input', function () {
        global.miyaSetTheme({ fontPreviewText: previewIn.value });
        updateFontPreview();
      });
    }
    var previewSize = $('miya-bf-font-preview-size');
    if (previewSize) {
      previewSize.addEventListener('input', function () {
        global.miyaSetTheme({ fontPreviewSize: previewSize.value });
        updateFontPreview();
        syncAllAppFontSizeRows();
        if (global.miyaApplyFontSize) global.miyaApplyFontSize();
      });
    }

    var appFontList = $('miya-bf-app-font-list');
    if (appFontList) {
      appFontList.addEventListener('input', function (e) {
        var range = e.target.closest('[data-app-font-range]');
        if (!range) return;
        var appKey = range.getAttribute('data-app-font-range');
        var defaultSize = parseFloat(global.miyaGetTheme().fontPreviewSize || 18);
        var row = range.closest('.ins-app-font-row');
        var valEl = row ? row.querySelector('.ins-app-font-row__val') : null;
        if (valEl) valEl.textContent = formatSizeLabel(range.value);
        setAppFontSize(appKey, range.value, defaultSize);
      });
      appFontList.addEventListener('click', function (e) {
        var resetBtn = e.target.closest('[data-app-font-reset]');
        if (!resetBtn) return;
        var appKey = resetBtn.getAttribute('data-app-font-reset');
        var defaultSize = parseFloat(global.miyaGetTheme().fontPreviewSize || 18);
        var range = appFontList.querySelector('[data-app-font-range="' + appKey + '"]');
        if (range) range.value = String(defaultSize);
        setAppFontSize(appKey, defaultSize, defaultSize);
      });
    }

    var wallFileInp = $('miya-bf-file-wall');
    if (wallFileInp) {
      wallFileInp.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || !(file.size > 0)) {
          toast(file ? '文件为空' : '');
          return;
        }
        var theme = getActiveSurfaceTheme();
        var oldId = theme && theme.wallpaper ? String(theme.wallpaper).trim() : '';
        var setWall = isCustomLayoutMode() ? global.miyaCustomSetWallpaper : global.miyaSetWallpaper;
        global.miyaStoreImageFile(file, oldId ? { replaceId: oldId } : undefined).then(function (id) {
          return setWall(id);
        }).then(function () {
          refreshWallPreview();
          toast('壁纸已保存');
        })
          .catch(function () { toast('上传失败'); });
      });
    }

    var lockWallFileInp = $('miya-bf-file-lock-wall');
    if (lockWallFileInp) {
      lockWallFileInp.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || !(file.size > 0)) {
          toast(file ? '文件为空' : '');
          return;
        }
        var lock = global.miyaGetLockSettings ? global.miyaGetLockSettings() : {};
        var oldId = lock && lock.wallpaper ? String(lock.wallpaper).trim() : '';
        global.miyaStoreImageFile(file, oldId ? { replaceId: oldId } : undefined).then(function (id) {
          return global.miyaSetLockWallpaper(id);
        }).then(function () {
          global.miyaSetLockSettings({ wallpaperEnabled: true });
          refreshLockWallPreview();
          syncLockUi();
          if (global.miyaLockscreen && global.miyaLockscreen.refreshWallpaper) {
            global.miyaLockscreen.refreshWallpaper();
          }
          toast('锁屏壁纸已保存');
        }).catch(function () { toast('上传失败'); });
      });
    }

    $('miya-bf-file-icon').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file || !pendingIconKey) return;
      if (!(file.size > 0)) {
        toast('文件为空');
        return;
      }
      var key = pendingIconKey;
      var theme = getActiveSurfaceTheme();
      var oldId = getThemeMediaRef(key, theme);
      oldId = oldId ? String(oldId).trim() : '';
      var fitIcon = (isP1AppIconKey(key) || isCustomDeskIconKey(key)) && global.miyaAutoFitSquareIconFile;
      var readyP = fitIcon
        ? global.miyaAutoFitSquareIconFile(file)
        : Promise.resolve(file);
      readyP.then(function (readyFile) {
        return global.miyaStoreImageFile(readyFile, oldId ? { replaceId: oldId } : undefined);
      }).then(function (id) {
        return applyMediaKey(key, id);
      }).then(function () {
        if (isCustomLayoutMode()) {
          global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
        } else {
          global.miyaApplyTheme && global.miyaApplyTheme();
        }
        refreshIconPreviews();
        toast('图片已更新');
      })
        .catch(function () { toast('上传失败'); });
    });

    function bindUrlApply(btnId, inputId, getKey) {
      var btn = $(btnId);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var key = getKey();
        if (!key) { toast('请先点击要替换的图标'); return; }
        var inputEl = $(inputId);
        var url = inputEl ? String(inputEl.value || '').trim() : '';
        if (!url) { toast('请填写图片链接'); return; }
        global.miyaStoreImageUrl(url).then(function (id) {
          return applyMediaKey(key, id);
        }).then(function () {
          if (isCustomLayoutMode()) {
            global.miyaApplyCustomDesk && global.miyaApplyCustomDesk();
          } else {
            global.miyaApplyTheme && global.miyaApplyTheme();
          }
          refreshIconPreviews();
          toast('已更新');
        }).catch(function () {
          applyMediaKey(key, url).then(function () {
            global.miyaApplyTheme && global.miyaApplyTheme();
            refreshIconPreviews();
            toast('已更新');
          });
        });
      });
    }

    bindUrlApply('miya-bf-icon-url-apply', 'miya-bf-icon-url-input', function () { return selectedIconKey; });
    bindUrlApply('miya-bf-extra-url-apply', 'miya-bf-extra-url-input', function () { return selectedExtraKey; });
    bindUrlApply('miya-bf-p2-icon-url-apply', 'miya-bf-p2-icon-url-input', function () { return selectedP2IconKey; });
    bindUrlApply('miya-bf-p2-widget-url-apply', 'miya-bf-p2-widget-url-input', function () { return selectedP2WidgetKey; });
    bindUrlApply('miya-bf-p3-icon-url-apply', 'miya-bf-p3-icon-url-input', function () { return selectedP3IconKey; });
    bindUrlApply('miya-bf-p3-widget-url-apply', 'miya-bf-p3-widget-url-input', function () { return selectedP3WidgetKey; });
    bindUrlApply('miya-bf-p4-icon-url-apply', 'miya-bf-p4-icon-url-input', function () { return selectedP4IconKey; });
    bindUrlApply('miya-bf-p4-widget-url-apply', 'miya-bf-p4-widget-url-input', function () { return selectedP4WidgetKey; });

    var fontFileInp = $('miya-bf-file-font');
    if (fontFileInp) {
      fontFileInp.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!isFontFile(file)) {
          toast('请选择 .woff / .woff2 / .ttf / .otf 字体文件');
          return;
        }
        global.miyaStoreFontFile(file).then(function (res) {
          return handleFontStored(res, { suppressToast: true });
        }).catch(function () { toast('字体加载失败'); });
      });
    }

    $('miya-bf-file-import').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = reader.result;
          var data = JSON.parse(text);
          var tpl = global.MiyaDeskCustomWidgetTemplates;
          /* 单独的自定义小组件 JSON 也可从方案页导入 */
          if (
            tpl &&
            data &&
            !data.miyaCustomDecorPack &&
            !data.miyaDecorPack &&
            (data.format === 'miyacustomwg' ||
              data.format === 'miya-custom-widget' ||
              data.customWidgetPresets ||
              (Array.isArray(data.slots) && data.htmlTemplate != null) ||
              (Array.isArray(data) && data[0] && Array.isArray(data[0].slots)))
          ) {
            var parsed = tpl.parseImportAuto(data);
            if (parsed) {
              importCustomWidgetJsonFile(file);
              return;
            }
          }
          var importFn = (data && data.miyaCustomDecorPack)
            ? global.miyaImportCustomDecorPack
            : global.miyaImportDecorPack;
          if (!importFn) { toast('导入失败'); return; }
          importFn(text).then(function () {
            syncUiFromTheme();
            refreshIconPreviews();
            if (global.miyaSyncCustomWidgetCatalog) global.miyaSyncCustomWidgetCatalog();
            buildCustomWidgetGallery();
            toast('外观 JSON 已导入');
          }).catch(function () {
            toast('文件格式无效或布局不匹配');
          });
        } catch (err) {
          toast('文件格式无效');
        }
      };
      reader.readAsText(file, 'utf-8');
    });

    var cwgImport = $('miya-bf-file-custom-wg-import');
    if (cwgImport) {
      if (!cwgImport.multiple) cwgImport.multiple = true;
      cwgImport.addEventListener('change', function (e) {
        /* FileList 是活引用：先拷贝再清空 value，否则 files 会立刻变空 */
        var fileArr = Array.prototype.slice.call((e.target && e.target.files) || []);
        e.target.value = '';
        if (!fileArr.length) return;
        toast('正在导入 ' + fileArr.length + ' 个小组件…');
        importCustomWidgetJsonFiles(fileArr);
      });
    }
  }

  function openCustomWidgetTemplates() {
    openBeautifyApp();
    switchBeautifyTab('object');
    var page = $('miya-bf-custom-wg-tpl-page');
    var host = $('miya-bf-custom-wg-tpl-host');
    var app = $('miya-beautify-app');
    var tpl = global.MiyaDeskCustomWidgetTemplates;
    if (!page || !host || !tpl) {
      toast('自定义小组件模块未就绪');
      return;
    }
    if (typeof tpl.remountEditor === 'function') {
      tpl.remountEditor(host, tpl.loadDraft ? tpl.loadDraft() : null);
    } else {
      host.innerHTML = tpl.buildEditorHtml(tpl.loadDraft ? tpl.loadDraft() : null);
      var root = host.querySelector('[data-mq-cwg-tpl-root]');
      if (root) tpl.bindEditorRoot(root, { remountHost: host });
    }
    page.hidden = false;
    page.setAttribute('aria-hidden', 'false');
    if (app) app.classList.add('has-subpage');
    page.scrollTop = 0;
    if (host) host.scrollTop = 0;
  }

  function closeCustomWidgetTemplates() {
    var page = $('miya-bf-custom-wg-tpl-page');
    var app = $('miya-beautify-app');
    if (page) {
      page.hidden = true;
      page.setAttribute('aria-hidden', 'true');
    }
    if (app) app.classList.remove('has-subpage');
    if (global.miyaSyncCustomWidgetCatalog) global.miyaSyncCustomWidgetCatalog();
    buildCustomWidgetGallery();
  }

  function isCustomWidgetSubpageOpen() {
    var page = $('miya-bf-custom-wg-tpl-page');
    return !!(page && !page.hidden);
  }

  function importCustomWidgetJsonFiles(files) {
    var fileArr = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!fileArr.length) return;
    var tpl = global.MiyaDeskCustomWidgetTemplates;
    if (!tpl || typeof tpl.importCustomWidgetFiles !== 'function') {
      toast('自定义小组件模块未就绪');
      return;
    }
    tpl
      .importCustomWidgetFiles(fileArr)
      .then(function (result) {
        if (!result || !result.ok) {
          toast('无法识别的小组件 JSON');
          return;
        }
        if (global.miyaSyncCustomWidgetCatalog) global.miyaSyncCustomWidgetCatalog();
        buildCustomWidgetGallery();
        openCustomWidgetTemplates();
        var host = $('miya-bf-custom-wg-tpl-host');
        var last = result.items[result.items.length - 1];
        var saved =
          (tpl.findPresetByName && last && tpl.findPresetByName(last.name)) || last;
        if (host && tpl.remountEditor && saved) {
          tpl.remountEditor(
            host,
            Object.assign({}, saved, {
              sampleValues: {},
              presetPick: saved.id || ''
            })
          );
        }
        if (result.ok === 1 && !result.fail) {
          toast('导入成功，已保存「' + ((saved && saved.name) || '自定义小组件') + '」');
        } else if (result.fail) {
          toast('导入完成：成功 ' + result.ok + ' 个，失败 ' + result.fail + ' 个');
        } else {
          toast('导入成功，已保存 ' + result.ok + ' 个自定义小组件');
        }
      })
      .catch(function () {
        toast('导入失败');
      });
  }

  function importCustomWidgetJsonFile(file) {
    importCustomWidgetJsonFiles(file ? [file] : []);
  }

  function openBeautifyApp() {
    var app = $('miya-beautify-app');
    if (!app) return;
    var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    pendingFont = theme.fontId && theme.fontName
      ? { id: theme.fontId, name: theme.fontName }
      : null;
    app.removeAttribute('hidden');
    switchBeautifyTab('scene');
    buildIconGrid();
    buildCustomIconGrid();
    buildCustomWidgetGallery();
    syncUiFromTheme();
    app.classList.add('is-open');
    app.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
  }

  function closeBeautifyApp() {
    var app = $('miya-beautify-app');
    if (!app) return;
    closeCustomWidgetTemplates();
    app.classList.remove('is-open');
    app.setAttribute('hidden', '');
    app.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  bindEvents();
  global.miyaBeautifyApp = {
    open: openBeautifyApp,
    close: closeBeautifyApp,
    toast: toast,
    openCustomWidgetTemplates: openCustomWidgetTemplates,
    closeCustomWidgetTemplates: closeCustomWidgetTemplates
  };
})(window);
