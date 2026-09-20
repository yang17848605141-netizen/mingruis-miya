(function (global) {
  'use strict';

  var LAYOUT_MODE_KEY = 'miya-desk-layout-mode';
  var CUSTOM_META_KEY = 'miya-desk-custom-v1';
  var CUSTOM_PRESETS_KEY = 'miya-desk-custom-presets-v1';

  var GRID_COLS = 4;
  var GRID_ROWS = 7;
  var GRID_SLOT_COUNT = GRID_COLS * GRID_ROWS;
  var DOCK_SLOT_COUNT = 4;

  var CUSTOM_GRID_APPS = [
    'music', 'memo', 'set', 'book', 'memory', 'chat', 'beauty', 'store',
    'couple', 'itinerary', 'cstore', 'rift',
    'deep', 'notes', 'match', 'fun', 'echo', 'log',
    'weather', 'map', 'apps', 'theater'
  ];

  var DEFAULT_DOCK = ['contacts', 'pet', 'pen'];
  var ALL_APPS = CUSTOM_GRID_APPS.concat(DEFAULT_DOCK);
  var CUSTOM_ICON_KEYS = ALL_APPS.slice();

  var MIN_DOCK = 1;
  var MAX_DOCK = 4;
  var DOCK_METRICS = {
    1: { gap: 0, pad: 16 },
    2: { gap: 26, pad: 16 },
    3: { gap: 22, pad: 18 },
    4: { gap: 18, pad: 20 }
  };
  var LONG_PRESS_MS = 380;
  var MOVE_CANCEL_PX = 10;
  var DRAG_START_PX = 6;
  var PAGE_EDGE_PX = 36;
  var PAGE_EDGE_HOLD_MS = 280;
  var PAGE_EDGE_COOLDOWN_MS = 520;
  var pageEdgeSwitchAt = 0;
  var pageEdgeDwellStart = 0;
  var pageEdgeSide = null;

  var APP_LABELS = {
    music: '音乐', memo: '论坛', set: '设置', book: '世界书',
    memory: '记忆', chat: '聊天', beauty: '美化', store: '线下',
    couple: '情侣空间', itinerary: '行程轨迹', cstore: '74号便利店', rift: '错位时空',
    deep: '深入', notes: '日记', match: '赛事', fun: '娱乐', echo: '共鸣', log: '记录',
    weather: '天气', map: '地图', apps: '应用', theater: '剧场',
    contacts: '联系人', pet: '打字机', pen: '模拟器'
  };

  var WIDGET_CATALOG = buildWidgetCatalog();

  function getCustomWgTpl() {
    return global.MiyaDeskCustomWidgetTemplates || null;
  }

  function syncCustomWidgetCatalog() {
    var tpl = getCustomWgTpl();
    if (!tpl || typeof tpl.getCatalogEntries !== 'function') return;
    Object.keys(WIDGET_CATALOG).forEach(function (id) {
      if (WIDGET_CATALOG[id] && WIDGET_CATALOG[id].widget === 'custom') {
        delete WIDGET_CATALOG[id];
      }
    });
    tpl.getCatalogEntries().forEach(function (entry) {
      WIDGET_CATALOG[entry.widgetId] = {
        w: entry.w,
        h: entry.h,
        label: entry.label,
        widget: 'custom',
        editable: true,
        customPresetId: entry.customPresetId
      };
    });
  }

  /** 布局里已落盘的自定义组件：即使 preset 库短暂为空，也从 item.config 重建 catalog */
  function ensureLayoutCustomWidgetsInCatalog(layout) {
    var pages = layout && Array.isArray(layout.pages) ? layout.pages : null;
    if (!pages && customThemeState && customThemeState.layout) {
      pages = customThemeState.layout.pages;
    }
    if (!pages) return;
    pages.forEach(function (pg) {
      if (!pg || !Array.isArray(pg.items)) return;
      pg.items.forEach(function (item) {
        if (!item || item.kind !== 'widget') return;
        var wid = resolveWidgetId(item.widgetId);
        if (!wid) return;
        ensureCustomCatalogEntry(wid, item.config || getWidgetConfig(item));
      });
    });
  }

  function ensureCustomCatalogEntry(widgetId, cfg) {
    if (!widgetId || WIDGET_CATALOG[widgetId]) return WIDGET_CATALOG[widgetId] || null;
    var tpl = getCustomWgTpl();
    var presetId = tpl && tpl.parseCatalogWidgetId
      ? tpl.parseCatalogWidgetId(widgetId)
      : (String(widgetId).indexOf('custom_lib_') === 0 ? String(widgetId).slice(11) : null);
    if (!presetId && !(cfg && cfg._htmlTemplate)) return null;
    var preset = null;
    if (tpl && cfg) preset = tpl.resolvePresetFromConfig(cfg);
    if (!preset && tpl && presetId) preset = tpl.findPresetById(presetId);
    var w = (preset && preset.w) || (cfg && cfg._w) || 2;
    var h = (preset && preset.h) || (cfg && cfg._h) || 2;
    var label = (preset && preset.name) || (cfg && cfg._presetName) || '自定义';
    WIDGET_CATALOG[widgetId] = {
      w: w,
      h: h,
      label: label,
      widget: 'custom',
      editable: true,
      customPresetId: (preset && preset.id) || presetId || (cfg && cfg._presetId) || ''
    };
    return WIDGET_CATALOG[widgetId];
  }

  var defaultCustomTheme = {
    version: 5,
    wallpaper: null,
    icons: {},
    textColorMode: 'black',
    iconFrameless: false,
    altIconStyle: false,
    profileBg: null,
    memoAvas: {},
    polaroids: {},
    copy: {},
    layout: null
  };

  var customThemeState = null;
  var customPresetsCache = null;
  var layoutModeCache = null;
  var customDeskHydrated = false;
  /** sync 读不到 IDB 数据时临时装上的默认布局；hydrate 合并时不得覆盖真数据 */
  var layoutFromFallback = false;
  var customDeskReady = null;
  var fixedDockHtml = null;
  var dragBound = false;
  var editBound = false;
  var pagerBound = false;
  var pickerBound = false;
  var dragConsumedUntil = 0;
  var customPagerSwipedUntil = 0;
  var cancelCustomPagerGesture = null;
  var saveLayoutTimer = 0;
  var editMode = false;
  var dragRaf = 0;
  var dragPointer = { x: 0, y: 0 };
  var dragHitCache = null;
  var ghostPos = { x: 0, y: 0 };
  var currentPage = 0;
  var itemIdSeq = 0;
  var glassBusyTimer = 0;
  var renderCustomLayoutPending = false;
  var renderCustomLayoutDirty = false;
  var customPageScrollLock = false;

  var drag = {
    pending: false,
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    grabOX: 0,
    grabOY: 0,
    ghostW: 0,
    ghostH: 0,
    ghost: null,
    sourceEl: null,
    sourceCell: null,
    fromSlot: null,
    hoverCell: null,
    timer: null,
    appKey: null,
    itemId: null,
    itemWrap: null,
    dragKind: null,
    pageIndex: 0,
    wasWidgetTap: false,
    tapItemId: null,
    pressAt: 0,
    startScrollLeft: 0
  };

  var WIDGET_ID_ALIASES = {
    profile: 'blank_4x3_1',
    memo: 'blank_2x2_1',
    polaroid: 'blank_2x2_2',
    blank_4x2_7: 'blank_4x1_6',
    blank_4x2_9: 'blank_4x1_7',
    blank_4x3_6: 'blank_4x2_8',
    insdiary: 'blank_4x4_4'
  };

  function suspendGlass(ms) {
    document.documentElement.setAttribute('data-glass-busy', '1');
    if (glassBusyTimer) clearTimeout(glassBusyTimer);
    glassBusyTimer = setTimeout(function () {
      document.documentElement.removeAttribute('data-glass-busy');
      glassBusyTimer = 0;
    }, ms || 360);
  }

  function customPageWidth() {
    var track = $('desk-custom-track');
    var viewport = $('desk-custom-viewport');
    return track ? (track.clientWidth || (viewport && viewport.clientWidth) || 1) : 1;
  }

  function markFarCustomPages() {
    var track = $('desk-custom-track');
    if (!track) return;
    var pages = track.querySelectorAll('.desk-custom__page');
    var i;
    for (i = 0; i < pages.length; i++) {
      var idx = parseInt(pages[i].getAttribute('data-custom-page'), 10) || 0;
      pages[i].toggleAttribute('data-desk-far', Math.abs(idx - currentPage) > 1);
    }
  }

  function syncCustomPageFromScroll() {
    var viewport = $('desk-custom-viewport');
    if (viewport) viewport.setAttribute('data-desk-page', String(currentPage));
    markFarCustomPages();
  }

  function captureFlipTargets(pageIndex) {
    var grid = getPageGrid(pageIndex);
    if (!grid) return null;
    var map = {};
    var els = grid.querySelectorAll('.desk-custom__item');
    var i;
    for (i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('is-drag-source')) continue;
      var id = el.getAttribute('data-item-id');
      if (!id) continue;
      var r = el.getBoundingClientRect();
      map[id] = { el: el, x: r.left, y: r.top };
    }
    return map;
  }

  function runFlipBefore(before) {
    if (!before) return;
    var moved = [];
    var ids = Object.keys(before);
    var i;
    for (i = 0; i < ids.length; i++) {
      var item = before[ids[i]];
      var el = item.el;
      if (!el || !el.isConnected) continue;
      var r = el.getBoundingClientRect();
      var dx = item.x - r.left;
      var dy = item.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moved.push(el);
    }
    if (!moved.length) return;
    void moved[0].offsetWidth;
    for (i = 0; i < moved.length; i++) {
      moved[i].style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      moved[i].style.transform = '';
    }
    setTimeout(function () {
      for (i = 0; i < moved.length; i++) {
        moved[i].style.transition = '';
        moved[i].style.transform = '';
      }
    }, 240);
  }

  function buildWidgetCatalog() {
    var cat = {};
    var specs = [
      { prefix: 'blank_4x2', w: 4, h: 2, label: '4×2' },
      { prefix: 'blank_4x3', w: 4, h: 3, label: '4×3' },
      { prefix: 'blank_2x2', w: 2, h: 2, label: '2×2' }
    ];
    specs.forEach(function (spec) {
      for (var i = 1; i <= 5; i++) {
        cat[spec.prefix + '_' + i] = {
          w: spec.w, h: spec.h, label: spec.label + ' · ' + i, blank: true, variant: i
        };
      }
    });
    cat.blank_4x1_1 = { w: 4, h: 1, label: '胶片行记', widget: 'filmstrip', editable: true };
    cat.blank_4x1_2 = { w: 4, h: 1, label: '余白浪', widget: 'wave', editable: true };
    cat.blank_4x1_3 = { w: 4, h: 1, label: '慢票根', widget: 'ticket', editable: true };
    cat.blank_4x1_4 = { w: 4, h: 1, label: '轨道相', widget: 'orbit', editable: true };
    cat.blank_4x1_5 = { w: 4, h: 1, label: '细账簿', widget: 'ledger', editable: true };
    cat.blank_4x1_6 = { w: 4, h: 1, label: '心情日记', widget: 'mooddiary', editable: true };
    cat.blank_4x1_7 = { w: 4, h: 1, label: '周历心情', widget: 'weekmood', editable: true };
    cat.blank_4x1_8 = { w: 4, h: 1, label: '纯照片', widget: 'ticketphoto', editable: true };
    cat.blank_4x2_1 = { w: 4, h: 2, label: '音轨舱', widget: 'player', editable: true };
    cat.blank_4x2_2 = { w: 4, h: 2, label: '对白轴', widget: 'dialogue', editable: true };
    cat.blank_4x2_3 = { w: 4, h: 2, label: '刊面包', widget: 'magazine', editable: true };
    cat.blank_4x2_4 = { w: 4, h: 2, label: 'INS主页', widget: 'instprofile', editable: true };
    cat.blank_4x2_5 = { w: 4, h: 2, label: '浮光拼贴', widget: 'glassdeck', editable: true };
    cat.blank_4x2_6 = { w: 4, h: 2, label: '双头像连线', widget: 'avalink', editable: true };
    cat.blank_4x2_8 = { w: 4, h: 2, label: '滚动歌词', widget: 'scrolllyrics', editable: true };
    cat.blank_4x3_1 = { w: 4, h: 3, label: '半醒手记', widget: 'profile', editable: true };
    cat.blank_4x3_2 = { w: 4, h: 3, label: '照片墙', widget: 'photowall', editable: true };
    cat.blank_4x3_3 = { w: 4, h: 3, label: '月历志', widget: 'calendar', editable: true };
    cat.blank_4x3_4 = { w: 4, h: 3, label: '私人账册', widget: 'journal', editable: true };
    cat.blank_4x3_5 = { w: 4, h: 3, label: 'INS动态', widget: 'moment', editable: true };
    cat.blank_4x4_1 = { w: 4, h: 4, label: '四列胶囊', widget: 'instriple', editable: true };
    cat.blank_4x4_2 = { w: 4, h: 4, label: '双人ins风头像', widget: 'inspair', editable: true };
    cat.blank_4x4_3 = { w: 4, h: 4, label: '灰白ins主页', widget: 'inshome', editable: true };
    cat.blank_4x4_4 = { w: 4, h: 4, label: '朋友圈', widget: 'wxmoments', editable: true };
    cat.blank_2x2_1 = { w: 2, h: 2, label: '双头像 MEMO', widget: 'memo', editable: true };
    cat.blank_2x2_2 = { w: 2, h: 2, label: '拍立得', widget: 'polaroid', editable: true };
    cat.blank_2x2_3 = { w: 2, h: 2, label: '吧唧相', widget: 'badgepin', editable: true };
    cat.blank_2x2_4 = { w: 2, h: 2, label: '黑胶碟', widget: 'vinyl', editable: true };
    cat.blank_2x2_5 = { w: 2, h: 2, label: '透明卡套', widget: 'sleeve', editable: true };
    cat.blank_2x2_6 = { w: 2, h: 2, label: '纯照片', widget: 'framephoto', editable: true };
    cat.blank_2x2_7 = { w: 2, h: 2, label: '明信片', widget: 'postcard', editable: true };
    cat.blank_2x2_8 = { w: 2, h: 2, label: '波点文件夹', widget: 'folder', editable: true };
    cat.blank_2x2_9 = { w: 2, h: 2, label: '音乐播放器', widget: 'miniplayer', editable: true };
    cat.blank_2x1_1 = { w: 2, h: 1, label: '涂鸦表盘', widget: 'insclock', editable: true };
    cat.blank_2x1_2 = { w: 2, h: 1, label: '封面音轨', widget: 'instune', editable: true };
    cat.blank_2x1_3 = { w: 2, h: 1, label: '对白条', widget: 'insquote', editable: true };
    cat.blank_2x1_4 = { w: 2, h: 1, label: '文件夹签', widget: 'insmood', editable: true };
    cat.blank_2x1_5 = { w: 2, h: 1, label: '环扣月历', widget: 'insnote', editable: true };
    cat.blank_2x1_6 = { w: 2, h: 1, label: '横排三联', widget: 'inscard', editable: true };
    return cat;
  }

  function resolveWidgetId(widgetId) {
    return WIDGET_ID_ALIASES[widgetId] || widgetId;
  }

  var WIDGET_EDITOR_FIELDS = {
    profile: [
      { key: 'profileBg', type: 'image', label: '封面背景' },
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'name', type: 'text', label: '标题', maxLength: 24 },
      { key: 'bio', type: 'text', label: '简介', maxLength: 48, multiline: true }
    ],
    memo: [
      { key: 'ava1', type: 'image', label: '左头像' },
      { key: 'ava2', type: 'image', label: '右头像' },
      { key: 'line1', type: 'text', label: '备忘 01', maxLength: 32 },
      { key: 'line2', type: 'text', label: '备忘 02', maxLength: 32 },
      { key: 'line3', type: 'text', label: '备忘 03', maxLength: 32 }
    ],
    polaroid: [
      { key: 'photo1', type: 'image', label: '前景照片' },
      { key: 'photo2', type: 'image', label: '中层照片' },
      { key: 'photo3', type: 'image', label: '底层照片' },
      { key: 'cap1', type: 'text', label: '前景说明', maxLength: 24 },
      { key: 'cap2', type: 'text', label: '中层说明', maxLength: 24 },
      { key: 'cap3', type: 'text', label: '底层说明', maxLength: 24 },
      { key: 'date', type: 'text', label: '日期标记', maxLength: 16 }
    ],
    filmstrip: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'photo', type: 'image', label: '胶片照片' },
      { key: 'title', type: 'text', label: '标题', maxLength: 20 },
      { key: 'note', type: 'text', label: '副标', maxLength: 28 }
    ],
    wave: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'photo', type: 'image', label: '圆形照片' },
      { key: 'tag', type: 'text', label: '标签', maxLength: 16 },
      { key: 'title', type: 'text', label: '主文案', maxLength: 24 }
    ],
    ticket: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'photo', type: 'image', label: '票根照片' },
      { key: 'code', type: 'text', label: '编号', maxLength: 12 },
      { key: 'title', type: 'text', label: '标题', maxLength: 20 },
      { key: 'date', type: 'text', label: '日期', maxLength: 20 }
    ],
    ticketphoto: [
      { key: 'photo', type: 'image', label: '照片' }
    ],
    orbit: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'photo', type: 'image', label: '相框照片' },
      { key: 'name', type: 'text', label: '名称', maxLength: 18 },
      { key: 'mood', type: 'text', label: '心情语', maxLength: 24 }
    ],
    ledger: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'photo', type: 'image', label: '账页照片' },
      { key: 'line1', type: 'text', label: '第一行', maxLength: 28 },
      { key: 'line2', type: 'text', label: '第二行', maxLength: 28 }
    ],
    player: [
      { key: 'cover', type: 'image', label: '专辑封面' },
      { key: 'title', type: 'text', label: '曲名', maxLength: 24 },
      { key: 'artist', type: 'text', label: '歌手', maxLength: 20 },
      { key: 'time', type: 'text', label: '时长标记', maxLength: 12 }
    ],
    dialogue: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'ava1', type: 'image', label: '左头像' },
      { key: 'ava2', type: 'image', label: '右头像' },
      { key: 'msg1', type: 'text', label: '对话 01', maxLength: 40, multiline: true },
      { key: 'msg2', type: 'text', label: '对话 02', maxLength: 40, multiline: true },
      { key: 'msg3', type: 'text', label: '对话 03', maxLength: 40, multiline: true },
      { key: 'stamp', type: 'text', label: '时间戳', maxLength: 16 }
    ],
    magazine: [
      { key: 'photo', type: 'image', label: '封面大图' },
      { key: 'tag', type: 'text', label: '刊号标签', maxLength: 12 },
      { key: 'headline', type: 'text', label: '主标题', maxLength: 24 },
      { key: 'subtitle', type: 'text', label: '副标题', maxLength: 32 }
    ],
    instprofile: [
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'post1', type: 'image', label: '帖子 01' },
      { key: 'post2', type: 'image', label: '帖子 02' },
      { key: 'post3', type: 'image', label: '帖子 03' },
      { key: 'username', type: 'text', label: '用户名', maxLength: 20 },
      { key: 'bio', type: 'text', label: '简介', maxLength: 48, multiline: true },
      { key: 'stats', type: 'text', label: '数据栏', maxLength: 40 }
    ],
    glassdeck: [
      { key: 'photo', type: 'image', label: '主图' },
      { key: 'tag', type: 'text', label: '浮动标签', maxLength: 16 },
      { key: 'quote', type: 'text', label: '引言', maxLength: 48, multiline: true },
      { key: 'sticker', type: 'text', label: '贴纸文案', maxLength: 20 }
    ],
    avalink: [
      { key: 'ava1', type: 'image', label: '左头像' },
      { key: 'ava2', type: 'image', label: '右头像' }
    ],
    mooddiary: [
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'headTitle', type: 'text', label: '页眉标题', maxLength: 20 },
      { key: 'username', type: 'text', label: '用户名', maxLength: 24 },
      { key: 'body', type: 'text', label: '日记正文', maxLength: 48, multiline: true },
      { key: 'stamp', type: 'text', label: '时间戳', maxLength: 20 }
    ],
    weekmood: [
      { key: 'bg', type: 'image', label: '背景' },
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'line1', type: 'text', label: '主文案', maxLength: 32 },
      { key: 'line2', type: 'text', label: '副文案', maxLength: 32 }
    ],
    photowall: [
      { key: 'photo1', type: 'image', label: '主图 · 大' },
      { key: 'photo2', type: 'image', label: '照片 · 圆角' },
      { key: 'photo3', type: 'image', label: '照片 · 斜' },
      { key: 'photo4', type: 'image', label: '照片 · 切角' },
      { key: 'photo5', type: 'image', label: '拍立得' },
      { key: 'cap1', type: 'text', label: '说明 · 主图', maxLength: 20 },
      { key: 'cap2', type: 'text', label: '说明 · 斜', maxLength: 20 },
      { key: 'cap3', type: 'text', label: '说明 · 拍立得', maxLength: 20 }
    ],
    calendar: [
      { key: 'bg', type: 'image', label: '背景照片' },
      { key: 'photo', type: 'image', label: '圆形照片' },
      { key: 'month', type: 'text', label: '月份', maxLength: 12 },
      { key: 'year', type: 'text', label: '年份', maxLength: 8 },
      { key: 'highlightDay', type: 'text', label: '高亮日期', maxLength: 2 },
      { key: 'tag', type: 'text', label: '标签', maxLength: 16 },
      { key: 'note', type: 'text', label: '今日备忘', maxLength: 48, multiline: true }
    ],
    journal: [
      { key: 'bg3', type: 'image', label: '顶层账页' },
      { key: 'bg1', type: 'image', label: '底层背景' },
      { key: 'bg2', type: 'image', label: '中层背景' },
      { key: 'eyebrow', type: 'text', label: '刊头', maxLength: 20 },
      { key: 'serial', type: 'text', label: '编号', maxLength: 16 },
      { key: 'day', type: 'text', label: '日期', maxLength: 2 },
      { key: 'mon', type: 'text', label: '月份', maxLength: 4 },
      { key: 'dow', type: 'text', label: '星期', maxLength: 4 },
      { key: 'row1', type: 'text', label: '条目 01', maxLength: 16 },
      { key: 'row2', type: 'text', label: '条目 02', maxLength: 16 },
      { key: 'row3', type: 'text', label: '条目 03', maxLength: 16 },
      { key: 'amt1', type: 'text', label: '金额 01', maxLength: 8 },
      { key: 'amt2', type: 'text', label: '金额 02', maxLength: 8 },
      { key: 'amt3', type: 'text', label: '金额 03', maxLength: 8 },
      { key: 'balance', type: 'text', label: '结余', maxLength: 12 },
      { key: 'receiptAmt', type: 'text', label: '收据金额', maxLength: 10 }
    ],
    moment: [
      { key: 'photo', type: 'image', label: '帖子主图' },
      { key: 'accent', type: 'image', label: '头像' },
      { key: 'sub', type: 'text', label: '用户名', maxLength: 20 },
      { key: 'title', type: 'text', label: '心情标签', maxLength: 16 },
      { key: 'quote', type: 'text', label: '发帖文案', maxLength: 48, multiline: true }
    ],
    inspair: [
      { key: 'cover', type: 'image', label: '顶部背景' },
      { key: 'ava1', type: 'image', label: '左头像' },
      { key: 'ava2', type: 'image', label: '右头像' },
      { key: 'name1', type: 'text', label: '左用户名', maxLength: 16 },
      { key: 'name2', type: 'text', label: '右用户名', maxLength: 16 },
      { key: 'quote', type: 'text', label: '状态语', maxLength: 40 },
      { key: 'location', type: 'text', label: '地点', maxLength: 24 }
    ],
    inshome: [
      { key: 'bg', type: 'image', label: '卡片背景' },
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'post1', type: 'image', label: '帖子 01' },
      { key: 'post2', type: 'image', label: '帖子 02' },
      { key: 'post3', type: 'image', label: '帖子 03' },
      { key: 'time', type: 'text', label: '时间气泡', maxLength: 8 },
      { key: 'username', type: 'text', label: '昵称', maxLength: 24 },
      { key: 'bio', type: 'text', label: '简介', maxLength: 40 },
      { key: 'date', type: 'text', label: '日期', maxLength: 20 },
      { key: 'plog', type: 'text', label: 'plog 标题', maxLength: 32 },
      { key: 'anniv', type: 'text', label: '纪念日文案', maxLength: 32 },
      { key: 'days', type: 'text', label: '倒计时', maxLength: 12 },
      { key: 'quote', type: 'text', label: '底部引言', maxLength: 48 }
    ],
    wxmoments: [
      { key: 'cover', type: 'image', label: '封面背景' },
      { key: 'avatar', type: 'image', label: '头像' },
      { key: 'nickname', type: 'text', label: '昵称', maxLength: 16 },
      { key: 'signature', type: 'text', label: '个性签名', maxLength: 32 },
      { key: 'momentText', type: 'text', label: '朋友圈文案', maxLength: 60, multiline: true },
      { key: 'momentPhoto', type: 'image', label: '朋友圈配图' },
      { key: 'momentTime', type: 'text', label: '发布时间', maxLength: 16 }
    ],
    scrolllyrics: [
      { key: 'colorScheme', type: 'choice', label: '色系', choices: [
        { value: 'gray', label: '灰白色' },
        { value: 'black', label: '黑色系' },
        { value: 'blue', label: '淡蓝色' },
        { value: 'pink', label: '淡粉色' },
        { value: 'yellow', label: '淡黄色' }
      ]},
      { key: 'title', type: 'text', label: '曲名', maxLength: 16 },
      { key: 'line1', type: 'text', label: '歌词 · 上一句', maxLength: 32 },
      { key: 'line2', type: 'text', label: '歌词 · 当前', maxLength: 40, multiline: true },
      { key: 'line3', type: 'text', label: '歌词 · 下一句', maxLength: 32 },
      { key: 'line4', type: 'text', label: '歌词 · 再下', maxLength: 32 }
    ],
    instriple: [
      { key: 'photo1', type: 'image', label: '照片 01' },
      { key: 'photo2', type: 'image', label: '照片 02' },
      { key: 'photo3', type: 'image', label: '照片 03' },
      { key: 'photo4', type: 'image', label: '照片 04' }
    ],
    badgepin: [
      { key: 'photo', type: 'image', label: '主吧唧照片' },
      { key: 'photo2', type: 'image', label: '小吧唧照片' }
    ],
    vinyl: [
      { key: 'label', type: 'image', label: '唱片标签图' }
    ],
    sleeve: [
      { key: 'photo', type: 'image', label: '小卡照片' },
      { key: 'tag', type: 'text', label: '分类标签', maxLength: 16 },
      { key: 'name', type: 'text', label: '名称', maxLength: 20 },
      { key: 'caption', type: 'text', label: '说明', maxLength: 32 }
    ],
    framephoto: [
      { key: 'photo', type: 'image', label: '照片' }
    ],
    postcard: [
      { key: 'photo', type: 'image', label: '明信片照片' },
      { key: 'message', type: 'text', label: '寄语', maxLength: 40, multiline: true },
      { key: 'to', type: 'text', label: '收件人', maxLength: 20 }
    ],
    folder: [
      { key: 'photo', type: 'image', label: '文件夹照片' }
    ],
    miniplayer: [
      { key: 'cover', type: 'image', label: '封面大图' },
      { key: 'thumb', type: 'image', label: '播放器缩略图' },
      { key: 'title', type: 'text', label: '曲名', maxLength: 24 },
      { key: 'artist', type: 'text', label: '歌手', maxLength: 20 }
    ],
    insclock: [
      { key: 'time', type: 'text', label: '时间', maxLength: 8 },
      { key: 'date', type: 'text', label: '日期', maxLength: 20 },
      { key: 'note', type: 'text', label: '备注', maxLength: 16 }
    ],
    instune: [
      { key: 'cover', type: 'image', label: '封面' },
      { key: 'title', type: 'text', label: '曲名', maxLength: 20 },
      { key: 'artist', type: 'text', label: '歌手', maxLength: 18 },
      { key: 'note', type: 'text', label: '短句', maxLength: 24 },
      { key: 'pct', type: 'text', label: '进度', maxLength: 6 }
    ],
    insquote: [
      { key: 'ava', type: 'image', label: '头像' },
      { key: 'msg', type: 'text', label: '对话', maxLength: 48, multiline: true },
      { key: 'stamp', type: 'text', label: '时间', maxLength: 12 }
    ],
    insmood: [
      { key: 'tab', type: 'text', label: '标签', maxLength: 12 },
      { key: 'num', type: 'text', label: '数字', maxLength: 6 },
      { key: 'label', type: 'text', label: '主文案', maxLength: 20 },
      { key: 'sub', type: 'text', label: '副文案', maxLength: 20 }
    ],
    insnote: [
      { key: 'month', type: 'text', label: '月份', maxLength: 12 },
      { key: 'highlightDay', type: 'text', label: '高亮日期', maxLength: 2 },
      { key: 'note', type: 'text', label: '备忘', maxLength: 24 }
    ],
    inscard: [
      { key: 'photo1', type: 'image', label: '照片 01' },
      { key: 'photo2', type: 'image', label: '照片 02' },
      { key: 'photo3', type: 'image', label: '照片 03' }
    ],
    /* 字段由预设槽位动态生成；占位保证 isEditableWidgetItem 识别 */
    custom: []
  };

  function formatMooddiaryStamp(date) {
    var now = date || new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
  }

  var WIDGET_DEFAULT_CONFIG = {
    profile: {
      profileBg: null, avatar: null,
      name: '半醒手记', bio: '白日太长，适合慢慢过'
    },
    memo: {
      ava1: null, ava2: null,
      line1: '猫在键盘上踩字', line2: '冰箱还有布丁', line3: '别忘记交电费'
    },
    polaroid: {
      photo1: null, photo2: null, photo3: null,
      cap1: '三楼拐角见', cap2: 'window seat', cap3: 'archive · 02', date: '24.06.02'
    },
    filmstrip: {
      bg: null, photo: null, title: '午后底片', note: 'frame · 07 / soft light'
    },
    wave: {
      bg: null, photo: null, tag: 'daily', title: '留白也是答案'
    },
    ticket: {
      bg: null, photo: null, code: 'NO.042', title: '慢车月台', date: '06 · 28 · sun'
    },
    ticketphoto: {
      photo: null
    },
    orbit: {
      bg: null, photo: null, name: 'orbit diary', mood: 'floating calm'
    },
    ledger: {
      bg: null, photo: null, line1: '今日消费：一杯冰美式', line2: '备注：窗边的位置最好'
    },
    player: {
      cover: null, title: '慢速浪漫', artist: 'miya playlist', time: '1:24 / 3:48'
    },
    dialogue: {
      bg: null, ava1: null, ava2: null,
      msg1: '今晚有空吗，想去看海',
      msg2: '好呀，我带胶片机',
      msg3: '记得穿浅色衣服',
      stamp: '22:04'
    },
    magazine: {
      photo: null, tag: 'vol.03', headline: '城市里的慢快门', subtitle: 'editorial · summer issue'
    },
    instprofile: {
      avatar: null, post1: null, post2: null, post3: null,
      username: 'miya.daily', bio: '记录慢生活与审美碎片',
      stats: '128 posts · 2.4k followers · 892 following'
    },
    glassdeck: {
      photo: null, tag: 'soft mood', quote: '把日常过成可以收藏的样子',
      sticker: 'daily archive'
    },
    avalink: {
      ava1: null, ava2: null
    },
    mooddiary: {
      avatar: null,
      headTitle: '日记',
      username: 'miya',
      body: '把今天发生的小事，留在这里。',
      stamp: formatMooddiaryStamp()
    },
    weekmood: {
      bg: null,
      avatar: null,
      line1: '今天也要慢慢来',
      line2: 'meet slowly.'
    },
    photowall: {
      photo1: null, photo2: null, photo3: null, photo4: null, photo5: null,
      cap1: 'our first date', cap2: 'coffee & rain', cap3: 'always us'
    },
    calendar: {
      bg: null, photo: null, month: '', year: '', highlightDay: '',
      tag: 'today', note: '把寻常日子，过成慢镜头'
    },
    journal: {
      bg1: null, bg2: null, bg3: null, eyebrow: 'Private Ledger', serial: '№ 2026·06',
      day: '06', mon: 'JUN', dow: 'SAT',
      row1: '夜间咖啡', row2: '稿费入账', row3: '胶片冲洗',
      amt1: '−28', amt2: '+640', amt3: '−86',
      balance: '526.00', receiptAmt: '28.00'
    },
    moment: {
      photo: null, accent: null,
      sub: 'dustmoth.lab', title: 'SECTOR NINE',
      quote: 'The vending machine issued a passport. I said nothing.'
    },
    badgepin: {
      photo: null, photo2: null
    },
    vinyl: {
      label: null
    },
    sleeve: {
      photo: null,
      tag: 'photocard', name: 'window light', caption: '06 · archive'
    },
    framephoto: {
      photo: null
    },
    postcard: {
      photo: null,
      message: '愿你在每一个寻常日子，都能被温柔接住。',
      to: 'to · miya'
    },
    folder: {
      photo: null
    },
    miniplayer: {
      cover: null,
      thumb: null,
      title: '',
      artist: ''
    },
    inspair: {
      cover: null, ava1: null, ava2: null,
      name1: 'miya._', name2: 'you.zz',
      quote: '— ♡ 我的世界很小，刚刚好装下你 —',
      location: '上海 · 外滩'
    },
    inshome: {
      bg: null,
      avatar: null, post1: null, post2: null, post3: null,
      time: '14:32',
      username: 'miya ♡₊˚',
      bio: '★ ‹ 把琐碎过成诗 ›',
      date: '2026/07/02 THU',
      plog: '「plog ✨ ʚɞ ˚ !! ♪」',
      anniv: '💕 · · 距离见面 还有',
      days: '128 days',
      quote: '世界很吵，但你是我的安静。'
    },
    wxmoments: {
      cover: null,
      avatar: null,
      nickname: 'miya',
      signature: '把琐碎的日子过成诗',
      momentText: '今天天气很好，想把这片云分享给你。',
      momentPhoto: null,
      momentTime: '2分钟前'
    },
    scrolllyrics: {
      colorScheme: 'gray',
      title: '浅眠循环',
      line1: '把噪音关在门外',
      line2: '把呼吸放慢\n跟着节拍沉降',
      line3: '窗外天色渐暗',
      line4: '醒来仍是好天气'
    },
    instriple: {
      photo1: null,
      photo2: null,
      photo3: null,
      photo4: null
    },
    insclock: {
      time: '14:32',
      date: 'WED · 07/01',
      note: '慢慢过今天'
    },
    instune: {
      cover: null,
      title: '浅眠循环',
      artist: 'lofi desk',
      note: '把噪音关在门外',
      pct: '42%'
    },
    insquote: {
      ava: null,
      msg: '今晚有空吗，想去看海',
      stamp: '22:04'
    },
    insmood: {
      tab: 'archive',
      num: '128',
      label: '天已记录',
      sub: 'keep going'
    },
    insnote: {
      month: '七月',
      highlightDay: '',
      note: '把寻常日子过成慢镜头'
    },
    inscard: {
      photo1: null,
      photo2: null,
      photo3: null
    },
    custom: {}
  };

  var wgEditorState = {
    open: false,
    itemId: null,
    widgetType: null,
    draft: null,
    pendingImageKey: null,
    openedAt: 0
  };
  var wgEditorBound = false;
  var WG_EDITOR_GHOST_MS = 480;

  function isWgEditorGhostClick() {
    return wgEditorState.open && (Date.now() - (wgEditorState.openedAt || 0) < WG_EDITOR_GHOST_MS);
  }

  function getWidgetType(widgetId) {
    var def = WIDGET_CATALOG[widgetId];
    if (!def && widgetId) ensureCustomCatalogEntry(widgetId, null);
    def = WIDGET_CATALOG[widgetId];
    return def && def.widget ? def.widget : null;
  }

  function isEditableWidgetItem(item) {
    if (!item || item.kind !== 'widget') return false;
    var type = getWidgetType(item.widgetId);
    if (type === 'custom') return true;
    return !!(type && WIDGET_EDITOR_FIELDS[type]);
  }

  function defaultWidgetConfig(widgetType) {
    var base = WIDGET_DEFAULT_CONFIG[widgetType];
    if (!base) return {};
    var out = Object.assign({}, base);
    if (widgetType === 'mooddiary') out.stamp = formatMooddiaryStamp();
    return out;
  }

  function migrateThemeToWidgetConfig(widgetType, theme) {
    theme = theme || loadCustomTheme();
    var copy = theme.copy || {};
    var out = {};
    if (widgetType === 'profile') {
      if (theme.profileBg) out.profileBg = theme.profileBg;
      if (theme.memoAvas && theme.memoAvas.profile_ava) out.avatar = theme.memoAvas.profile_ava;
      if (copy.profileName) out.name = copy.profileName;
      if (copy.profileBio) out.bio = copy.profileBio;
    } else if (widgetType === 'memo') {
      if (theme.memoAvas) {
        if (theme.memoAvas.memo_ava_1) out.ava1 = theme.memoAvas.memo_ava_1;
        if (theme.memoAvas.memo_ava_2) out.ava2 = theme.memoAvas.memo_ava_2;
      }
      if (copy.memoLine1) out.line1 = copy.memoLine1;
      if (copy.memoLine2) out.line2 = copy.memoLine2;
      if (copy.memoLine3) out.line3 = copy.memoLine3;
    } else if (widgetType === 'polaroid') {
      if (theme.polaroids) {
        if (theme.polaroids.polaroid_1) out.photo1 = theme.polaroids.polaroid_1;
        if (theme.polaroids.polaroid_2) out.photo2 = theme.polaroids.polaroid_2;
        if (theme.polaroids.polaroid_3) out.photo3 = theme.polaroids.polaroid_3;
      }
      if (copy.polaroidCap1) out.cap1 = copy.polaroidCap1;
      if (copy.polaroidCap2) out.cap2 = copy.polaroidCap2;
      if (copy.polaroidCap3) out.cap3 = copy.polaroidCap3;
      if (copy.polaroidDate) out.date = copy.polaroidDate;
    }
    return out;
  }

  function normalizeSavedWidgetConfig(widgetType, saved) {
    if (!saved || typeof saved !== 'object') return saved;
    var out = Object.assign({}, saved);
    if (widgetType === 'instprofile') {
      if (out.photo && !out.avatar) out.avatar = out.photo;
      if (out.title && !out.username) out.username = out.title;
      if (out.mood && !out.bio) out.bio = out.mood;
      if (out.date && !out.stats) out.stats = out.date;
    } else if (widgetType === 'glassdeck') {
      if (out.caption && !out.tag) out.tag = out.caption;
      if (out.note && !out.quote) out.quote = out.note;
    } else if (widgetType === 'journal') {
      if (out.bg && !out.bg3) out.bg3 = out.bg;
      delete out.bg;
    } else if (widgetType === 'scrolllyrics') {
      if (['gray', 'black', 'blue', 'pink', 'yellow'].indexOf(out.colorScheme) < 0) {
        out.colorScheme = 'gray';
      }
    }
    return out;
  }

  function getWidgetConfig(item) {
    if (!item || item.kind !== 'widget') return null;
    var type = getWidgetType(item.widgetId);
    if (!type) {
      ensureCustomCatalogEntry(item.widgetId, item.config);
      type = getWidgetType(item.widgetId);
    }
    if (!type) return null;
    if (type === 'custom') {
      var tpl = getCustomWgTpl();
      var savedCustom = item.config && typeof item.config === 'object' ? Object.assign({}, item.config) : {};
      if (tpl) {
        var def = WIDGET_CATALOG[item.widgetId];
        var preset = null;
        if (savedCustom._htmlTemplate || savedCustom._slots) {
          preset = tpl.resolvePresetFromConfig(savedCustom);
        } else if (def && def.customPresetId) {
          preset = tpl.findPresetById(def.customPresetId);
        } else {
          var pid = tpl.parseCatalogWidgetId(item.widgetId);
          if (pid) preset = tpl.findPresetById(pid);
        }
        if (preset) return tpl.buildInstanceConfig(preset, savedCustom);
      }
      return savedCustom;
    }
    var base = defaultWidgetConfig(type);
    var saved = item.config && typeof item.config === 'object'
      ? normalizeSavedWidgetConfig(type, item.config)
      : null;
    if (saved) return Object.assign({}, base, saved);
    return Object.assign({}, base, migrateThemeToWidgetConfig(type, loadCustomTheme()));
  }

  function findLayoutItemById(itemId) {
    if (!itemId) return null;
    var layout = getLayout();
    for (var pi = 0; pi < layout.pages.length; pi++) {
      var it = findItemById(layout.pages[pi], itemId);
      if (it) return { pageIndex: pi, item: it };
    }
    return null;
  }

  function escapeWidgetText(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setMemoBubble(el, num, text) {
    if (!el) return;
    el.innerHTML = '<span class="wg-memo__label">' + num + '</span> ' + escapeWidgetText(text);
  }

  function applyMediaToEl(el, ref, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve();
    if (!ref) {
      el.style.backgroundImage = '';
      if (opts.bgMode) el.style.background = '';
      el.classList.remove(opts.doneClass || 'has-custom-photo');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (opts.bgMode) {
        el.style.background = 'url("' + url.replace(/"/g, '%22') + '") center/cover no-repeat';
      } else {
        el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
      el.classList.add(opts.doneClass || 'has-custom-photo');
    });
  }

  var CAL_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var CAL_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var CAL_MONTHS_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  var CAL_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function resolveCalendarMonthIdx(cfg, now) {
    if (!cfg.month) return now.getMonth();
    var cn = CAL_MONTHS_CN.indexOf(cfg.month);
    if (cn >= 0) return cn;
    var en = CAL_MONTHS.indexOf(String(cfg.month).toUpperCase());
    if (en >= 0) return en;
    var num = parseInt(cfg.month, 10);
    if (num >= 1 && num <= 12) return num - 1;
    return now.getMonth();
  }

  function paintCalendarGrid(wgEl, cfg) {
    var weekrow = wgEl.querySelector('.wg-4x3-cal__weekrow');
    if (!weekrow) return;
    var now = new Date();
    var year = parseInt(cfg.year, 10) || now.getFullYear();
    var monthIdx = resolveCalendarMonthIdx(cfg, now);
    var highlight = parseInt(cfg.highlightDay, 10) || now.getDate();
    var center = new Date(year, monthIdx, highlight);
    var startDow = center.getDay();
    var html = '';
    var i, d, cls, cellDate, cellMonth, cellYear;
    for (i = 0; i < 7; i++) {
      cellDate = new Date(year, monthIdx, highlight - startDow + i);
      d = cellDate.getDate();
      cellMonth = cellDate.getMonth();
      cellYear = cellDate.getFullYear();
      cls = 'wg-4x3-cal__cell';
      if (cellMonth !== monthIdx || cellYear !== year) cls += ' is-other';
      if (d === highlight && cellMonth === monthIdx && cellYear === year) cls += ' is-today';
      html += '<span class="' + cls + '">' + d + '</span>';
    }
    weekrow.innerHTML = html;

    var monthEl = wgEl.querySelector('.wg-4x3-cal__month');
    var yearEl = wgEl.querySelector('.wg-4x3-cal__year');
    var dayNumEl = wgEl.querySelector('.wg-4x3-cal__daynum');
    var weekdayEl = wgEl.querySelector('.wg-4x3-cal__weekday');
    if (monthEl) monthEl.textContent = cfg.month || CAL_MONTHS_CN[monthIdx] || CAL_MONTHS[monthIdx];
    if (yearEl) yearEl.textContent = cfg.year || String(year);
    if (dayNumEl) dayNumEl.textContent = String(highlight).padStart(2, '0');
    if (weekdayEl) {
      var dowDate = new Date(year, monthIdx, highlight);
      weekdayEl.textContent = cfg.dow || CAL_DOW[dowDate.getDay()] || '';
    }
  }

  function paintWeekmoodBar(wgEl) {
    var highlight = CAL_DOW[new Date().getDay()];
    wgEl.querySelectorAll('.wg-4x1-weekmood__day').forEach(function (dayEl) {
      dayEl.classList.toggle('is-active', dayEl.textContent.trim().toUpperCase() === highlight);
    });
  }

  function paint2x1CalWeek(wgEl, cfg) {
    var weekEl = wgEl.querySelector('.wg-2x1-cal__week');
    if (!weekEl) return;
    var now = new Date();
    var highlight = parseInt(cfg.highlightDay, 10) || now.getDate();
    var monthIdx = resolveCalendarMonthIdx(cfg, now);
    var year = now.getFullYear();
    var center = new Date(year, monthIdx, highlight);
    var startDow = center.getDay();
    var html = '';
    var i, cellDate, d, cls;
    for (i = 0; i < 7; i++) {
      cellDate = new Date(year, monthIdx, highlight - startDow + i);
      d = cellDate.getDate();
      cls = 'wg-2x1-cal__day';
      if (d === highlight && cellDate.getMonth() === monthIdx) cls += ' is-active';
      html +=
        '<div class="' + cls + '">' +
          '<span class="wg-2x1-cal__dow">' + CAL_WEEKDAYS[cellDate.getDay()] + '</span>' +
          '<span class="wg-2x1-cal__num">' + d + '</span>' +
        '</div>';
    }
    weekEl.innerHTML = html;
    var monthEl = wgEl.querySelector('.wg-2x1-cal__month');
    if (monthEl) {
      monthEl.textContent = cfg.month || CAL_MONTHS_CN[monthIdx] || CAL_MONTHS[monthIdx];
    }
  }

  function paintInsclockHands(wgEl, timeStr) {
    var hourHand = wgEl.querySelector('.wg-2x1-dial__hand--h');
    var minHand = wgEl.querySelector('.wg-2x1-dial__hand--m');
    if (!hourHand || !minHand) return;
    var parts = String(timeStr || '').split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) {
      var now = new Date();
      h = now.getHours();
      m = now.getMinutes();
    }
    var hourDeg = (h % 12) * 30 + m * 0.5;
    var minDeg = m * 6;
    hourHand.setAttribute('transform', 'rotate(' + hourDeg + ' 23 23)');
    minHand.setAttribute('transform', 'rotate(' + minDeg + ' 23 23)');
  }

  function paintWidgetElement(wgEl, item) {
    if (!wgEl || !item || item.kind !== 'widget') return Promise.resolve();
    var type = getWidgetType(item.widgetId);
    if (!type) return Promise.resolve();
    var cfg = getWidgetConfig(item);
    var promises = [];

    if (type === 'profile') {
      var cover = wgEl.querySelector('.wg-profile__cover-bg');
      var ava = wgEl.querySelector('.wg-profile__avatar');
      var nameEl = wgEl.querySelector('.wg-profile__name');
      var bioEl = wgEl.querySelector('.wg-profile__bio');
      if (nameEl) nameEl.textContent = cfg.name || '';
      if (bioEl) bioEl.textContent = cfg.bio || '';
      promises.push(applyMediaToEl(cover, cfg.profileBg, { bgMode: true, doneClass: 'has-custom-cover' }).then(function () {
        wgEl.classList.toggle('has-custom-cover', !!cfg.profileBg);
      }));
      promises.push(applyMediaToEl(ava, cfg.avatar, { doneClass: 'has-custom-ava' }).then(function () {
        wgEl.classList.toggle('has-custom-ava', !!cfg.avatar);
      }));
    } else if (type === 'memo') {
      setMemoBubble(wgEl.querySelector('.wg-memo__person:nth-child(1) .wg-memo__bubble'), '01', cfg.line1);
      setMemoBubble(wgEl.querySelector('.wg-memo__person:nth-child(2) .wg-memo__bubble'), '02', cfg.line2);
      setMemoBubble(wgEl.querySelector('.wg-memo__pill'), '03', cfg.line3);
      promises.push(applyMediaToEl(
        wgEl.querySelector('.wg-memo__person:nth-child(1) .wg-memo__ava'),
        cfg.ava1, { doneClass: 'has-custom-ava' }
      ));
      promises.push(applyMediaToEl(
        wgEl.querySelector('.wg-memo__person:nth-child(2) .wg-memo__ava'),
        cfg.ava2, { doneClass: 'has-custom-ava' }
      ));
    } else if (type === 'polaroid') {
      var cap1 = wgEl.querySelector('.wg-polaroid__card--1 .wg-polaroid__cap');
      var cap2 = wgEl.querySelector('.wg-polaroid__card--2 .wg-polaroid__cap');
      var cap3 = wgEl.querySelector('.wg-polaroid__card--3 .wg-polaroid__cap');
      var dateEl = wgEl.querySelector('.wg-polaroid__date');
      if (cap1) cap1.textContent = cfg.cap1 || '';
      if (cap2) cap2.textContent = cfg.cap2 || '';
      if (cap3) cap3.textContent = cfg.cap3 || '';
      if (dateEl) dateEl.textContent = cfg.date || '';
      ['photo1', 'photo2', 'photo3'].forEach(function (key, idx) {
        var slot = String(idx + 1);
        var card = wgEl.querySelector('.wg-polaroid__card--' + slot + ' .wg-polaroid__photo');
        promises.push(applyMediaToEl(card, cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'filmstrip') {
      var filmRoot = wgEl.querySelector('.wg-4x1-film');
      var filmTitle = wgEl.querySelector('.wg-4x1-film__title');
      var filmNote = wgEl.querySelector('.wg-4x1-film__note');
      if (filmTitle) filmTitle.textContent = cfg.title || '';
      if (filmNote) filmNote.textContent = cfg.note || '';
      promises.push(applyMediaToEl(filmRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-film__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'wave') {
      var waveRoot = wgEl.querySelector('.wg-4x1-wave');
      var waveTag = wgEl.querySelector('.wg-4x1-wave__tag');
      var waveTitle = wgEl.querySelector('.wg-4x1-wave__title');
      if (waveTag) waveTag.textContent = cfg.tag || '';
      if (waveTitle) waveTitle.textContent = cfg.title || '';
      promises.push(applyMediaToEl(waveRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-wave__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'ticket') {
      var ticketRoot = wgEl.querySelector('.wg-4x1-ticket');
      var ticketCode = wgEl.querySelector('.wg-4x1-ticket__code');
      var ticketTitle = wgEl.querySelector('.wg-4x1-ticket__title');
      var ticketDate = wgEl.querySelector('.wg-4x1-ticket__date');
      if (ticketCode) ticketCode.textContent = cfg.code || '';
      if (ticketTitle) ticketTitle.textContent = cfg.title || '';
      if (ticketDate) ticketDate.textContent = cfg.date || '';
      promises.push(applyMediaToEl(ticketRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-ticket__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'ticketphoto') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-ticketphoto__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'orbit') {
      var orbitRoot = wgEl.querySelector('.wg-4x1-orbit');
      var orbitName = wgEl.querySelector('.wg-4x1-orbit__name');
      var orbitMood = wgEl.querySelector('.wg-4x1-orbit__mood');
      if (orbitName) orbitName.textContent = cfg.name || '';
      if (orbitMood) orbitMood.textContent = cfg.mood || '';
      promises.push(applyMediaToEl(orbitRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-orbit__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'ledger') {
      var ledgerRoot = wgEl.querySelector('.wg-4x1-ledger');
      var ledgerLine1 = wgEl.querySelector('.wg-4x1-ledger__line1');
      var ledgerLine2 = wgEl.querySelector('.wg-4x1-ledger__line2');
      if (ledgerLine1) ledgerLine1.textContent = cfg.line1 || '';
      if (ledgerLine2) ledgerLine2.textContent = cfg.line2 || '';
      promises.push(applyMediaToEl(ledgerRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-ledger__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'player') {
      var playerTrack = wgEl.querySelector('.wg-4x2-player__track');
      var playerArtist = wgEl.querySelector('.wg-4x2-player__artist');
      var playerTime = wgEl.querySelector('.wg-4x2-player__time');
      if (playerTrack) playerTrack.textContent = cfg.title || '';
      if (playerArtist) playerArtist.textContent = cfg.artist || '';
      if (playerTime) playerTime.textContent = cfg.time || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-player__cover'), cfg.cover, { doneClass: 'has-custom-photo' }));
    } else if (type === 'dialogue') {
      var dlgRoot = wgEl.querySelector('.wg-4x2-dialogue');
      var dlgMsg1 = wgEl.querySelector('.wg-4x2-dialogue__bubble--1');
      var dlgMsg2 = wgEl.querySelector('.wg-4x2-dialogue__bubble--2');
      var dlgMsg3 = wgEl.querySelector('.wg-4x2-dialogue__bubble--3');
      var dlgStamp = wgEl.querySelector('.wg-4x2-dialogue__time');
      if (dlgMsg1) dlgMsg1.textContent = cfg.msg1 || '';
      if (dlgMsg2) dlgMsg2.textContent = cfg.msg2 || '';
      if (dlgMsg3) dlgMsg3.textContent = cfg.msg3 || '';
      if (dlgStamp) dlgStamp.textContent = cfg.stamp || '';
      promises.push(applyMediaToEl(dlgRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }));
      wgEl.querySelectorAll('.wg-4x2-dialogue__ava--a').forEach(function (avaEl) {
        promises.push(applyMediaToEl(avaEl, cfg.ava1, { doneClass: 'has-custom-photo' }));
      });
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-dialogue__ava--b'), cfg.ava2, { doneClass: 'has-custom-photo' }));
    } else if (type === 'magazine') {
      var magTag = wgEl.querySelector('.wg-4x2-mag__tag');
      var magHeadline = wgEl.querySelector('.wg-4x2-mag__headline');
      var magSub = wgEl.querySelector('.wg-4x2-mag__sub');
      if (magTag) magTag.textContent = cfg.tag || '';
      if (magHeadline) magHeadline.textContent = cfg.headline || '';
      if (magSub) magSub.textContent = cfg.subtitle || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-mag__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'instprofile') {
      var insUser = wgEl.querySelector('.wg-4x2-ins__username');
      var insBio = wgEl.querySelector('.wg-4x2-ins__bio');
      var insStats = wgEl.querySelector('.wg-4x2-ins__stats');
      if (insUser) insUser.textContent = cfg.username || '';
      if (insBio) insBio.textContent = cfg.bio || '';
      if (insStats) insStats.textContent = cfg.stats || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-ins__avatar'), cfg.avatar, { doneClass: 'has-custom-photo' }));
      ['post1', 'post2', 'post3'].forEach(function (key, idx) {
        var cell = wgEl.querySelector('.wg-4x2-ins__post--' + (idx + 1));
        promises.push(applyMediaToEl(cell, cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'glassdeck') {
      var glassTag = wgEl.querySelector('.wg-4x2-glass__tag');
      var glassQuote = wgEl.querySelector('.wg-4x2-glass__quote');
      var glassSticker = wgEl.querySelector('.wg-4x2-glass__sticker');
      if (glassTag) glassTag.textContent = cfg.tag || '';
      if (glassQuote) glassQuote.textContent = cfg.quote || '';
      if (glassSticker) glassSticker.textContent = cfg.sticker || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-glass__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'avalink') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-avalink__ava--1 .wg-4x2-avalink__photo'), cfg.ava1, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x2-avalink__ava--2 .wg-4x2-avalink__photo'), cfg.ava2, { doneClass: 'has-custom-photo' }));
    } else if (type === 'mooddiary') {
      var mdHead = wgEl.querySelector('.wg-4x1-mooddiary__head-title');
      var mdUser = wgEl.querySelector('.wg-4x1-mooddiary__username');
      var mdBody = wgEl.querySelector('.wg-4x1-mooddiary__body');
      var mdStamp = wgEl.querySelector('.wg-4x1-mooddiary__stamp');
      if (mdHead) mdHead.textContent = cfg.headTitle || '';
      if (mdUser) mdUser.textContent = cfg.username || '';
      if (mdBody) mdBody.textContent = cfg.body || '';
      if (mdStamp) mdStamp.textContent = cfg.stamp || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-mooddiary__avatar'), cfg.avatar, { doneClass: 'has-custom-photo' }));
    } else if (type === 'weekmood') {
      var wmRoot = wgEl.querySelector('.wg-4x1-weekmood');
      var wmLine1 = wgEl.querySelector('.wg-4x1-weekmood__line1');
      var wmLine2 = wgEl.querySelector('.wg-4x1-weekmood__line2');
      if (wmLine1) wmLine1.textContent = cfg.line1 || '';
      if (wmLine2) wmLine2.textContent = cfg.line2 || '';
      paintWeekmoodBar(wgEl);
      promises.push(applyMediaToEl(wmRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }).then(function () {
        if (wmRoot) wmRoot.classList.toggle('has-custom-bg', !!cfg.bg);
      }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x1-weekmood__avatar'), cfg.avatar, { doneClass: 'has-custom-photo' }));
    } else if (type === 'photowall') {
      var capMap = { cap1: '.wg-4x3-wall__cap--1', cap2: '.wg-4x3-wall__cap--2', cap3: '.wg-4x3-wall__cap--3' };
      Object.keys(capMap).forEach(function (key) {
        var capEl = wgEl.querySelector(capMap[key]);
        if (capEl) capEl.textContent = cfg[key] || '';
      });
      var photoMap = {
        photo1: '.wg-4x3-wall__tile--hero .wg-4x3-wall__photo',
        photo2: '.wg-4x3-wall__tile--b .wg-4x3-wall__photo',
        photo3: '.wg-4x3-wall__tile--c .wg-4x3-wall__photo',
        photo4: '.wg-4x3-wall__tile--d .wg-4x3-wall__photo',
        photo5: '.wg-4x3-wall__tile--e .wg-4x3-wall__photo'
      };
      Object.keys(photoMap).forEach(function (key) {
        promises.push(applyMediaToEl(wgEl.querySelector(photoMap[key]), cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'calendar') {
      var calTag = wgEl.querySelector('.wg-4x3-cal__tag');
      var calNote = wgEl.querySelector('.wg-4x3-cal__note');
      var calRoot = wgEl.querySelector('.wg-4x3-cal');
      if (calTag) calTag.textContent = cfg.tag || '';
      if (calNote) calNote.textContent = cfg.note || '';
      paintCalendarGrid(wgEl, cfg);
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x3-cal__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(calRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }).then(function () {
        if (calRoot) calRoot.classList.toggle('has-custom-bg', !!cfg.bg);
      }));
    } else if (type === 'journal') {
      var jEyebrow = wgEl.querySelector('.wg-4x3-journal__eyebrow');
      var jSerial = wgEl.querySelector('.wg-4x3-journal__serial');
      var jDay = wgEl.querySelector('.wg-4x3-journal__day');
      var jMon = wgEl.querySelector('.wg-4x3-journal__mon');
      var jDow = wgEl.querySelector('.wg-4x3-journal__dow');
      var jBalance = wgEl.querySelector('.wg-4x3-journal__balance');
      var jReceiptAmt = wgEl.querySelector('.wg-4x3-journal__receipt-amt');
      if (jEyebrow) jEyebrow.textContent = cfg.eyebrow || '';
      if (jSerial) jSerial.textContent = cfg.serial || '';
      if (jDay) jDay.textContent = cfg.day || '';
      if (jMon) jMon.textContent = cfg.mon || '';
      if (jDow) jDow.textContent = cfg.dow || '';
      if (jBalance) jBalance.textContent = cfg.balance || '';
      if (jReceiptAmt) jReceiptAmt.textContent = cfg.receiptAmt || '';
      var rowItems = wgEl.querySelectorAll('.wg-4x3-journal__row-item');
      var rowAmts = wgEl.querySelectorAll('.wg-4x3-journal__row-amt');
      var rowDates = wgEl.querySelectorAll('.wg-4x3-journal__row-date');
      var rows = [cfg.row1, cfg.row2, cfg.row3];
      var amts = [cfg.amt1, cfg.amt2, cfg.amt3];
      var dates = [cfg.day, String(parseInt(cfg.day, 10) - 1 || '05'), String(parseInt(cfg.day, 10) - 2 || '04')];
      rows.forEach(function (txt, idx) {
        if (rowItems[idx]) rowItems[idx].textContent = txt || '';
        if (rowAmts[idx]) {
          rowAmts[idx].textContent = amts[idx] || '';
          rowAmts[idx].classList.toggle('wg-4x3-journal__row-amt--plus', String(amts[idx] || '').indexOf('+') === 0);
        }
        if (rowDates[idx]) rowDates[idx].textContent = dates[idx] || '';
      });
      var jRoot = wgEl.querySelector('.wg-4x3-journal');
      var jSheet = jRoot && jRoot.querySelector('.wg-4x3-journal__sheet');
      promises.push(applyMediaToEl(
        jRoot && jRoot.querySelector('.wg-4x3-journal__sheet-art'),
        cfg.bg3, { bgMode: true, doneClass: 'has-custom-photo' }
      ).then(function () {
        if (jSheet) jSheet.classList.toggle('has-custom-sheet', !!cfg.bg3);
      }));
      promises.push(applyMediaToEl(
        jRoot && jRoot.querySelector('.wg-4x3-journal__leaf--3 .wg-4x3-journal__leaf-art'),
        cfg.bg1, { bgMode: true, doneClass: 'has-custom-photo' }
      ));
      promises.push(applyMediaToEl(
        jRoot && jRoot.querySelector('.wg-4x3-journal__leaf--2 .wg-4x3-journal__leaf-art'),
        cfg.bg2, { bgMode: true, doneClass: 'has-custom-photo' }
      ));
    } else if (type === 'moment') {
      var mTitle = wgEl.querySelector('.wg-4x3-moment__title');
      var mSub = wgEl.querySelector('.wg-4x3-moment__sub');
      var mQuote = wgEl.querySelector('.wg-4x3-moment__quote');
      if (mTitle) mTitle.textContent = cfg.title || '';
      if (mSub) mSub.textContent = cfg.sub || '';
      if (mQuote) mQuote.textContent = cfg.quote || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x3-moment__hero'), cfg.photo, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x3-moment__accent'), cfg.accent, { doneClass: 'has-custom-photo' }));
    } else if (type === 'badgepin') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-badge__main-photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-badge__mini-photo'), cfg.photo2, { doneClass: 'has-custom-photo' }));
    } else if (type === 'vinyl') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-vinyl__label'), cfg.label, { doneClass: 'has-custom-photo' }));
    } else if (type === 'sleeve') {
      var sleeveTag = wgEl.querySelector('.wg-2x2-sleeve__tag');
      var sleeveName = wgEl.querySelector('.wg-2x2-sleeve__name');
      var sleeveCaption = wgEl.querySelector('.wg-2x2-sleeve__caption');
      if (sleeveTag) sleeveTag.textContent = cfg.tag || '';
      if (sleeveName) sleeveName.textContent = cfg.name || '';
      if (sleeveCaption) sleeveCaption.textContent = cfg.caption || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-sleeve__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'framephoto') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-framephoto__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'postcard') {
      var pcMsg = wgEl.querySelector('.wg-2x2-postcard__message');
      var pcTo = wgEl.querySelector('.wg-2x2-postcard__to');
      if (pcMsg) pcMsg.textContent = cfg.message || '';
      if (pcTo) pcTo.textContent = cfg.to || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-postcard__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'folder') {
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-folder__photo'), cfg.photo, { doneClass: 'has-custom-photo' }));
    } else if (type === 'miniplayer') {
      var mpTitle = wgEl.querySelector('.wg-2x2-miniplayer__title');
      var mpArtist = wgEl.querySelector('.wg-2x2-miniplayer__artist');
      if (mpTitle) mpTitle.textContent = cfg.title || '';
      if (mpArtist) mpArtist.textContent = cfg.artist || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-miniplayer__cover'), cfg.cover, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x2-miniplayer__thumb'), cfg.thumb, { doneClass: 'has-custom-photo' }));
    } else if (type === 'scrolllyrics') {
      var slRoot = wgEl.querySelector('.wg-4x2-lyrics');
      var slScheme = cfg.colorScheme || 'gray';
      if (['gray', 'black', 'blue', 'pink', 'yellow'].indexOf(slScheme) < 0) slScheme = 'gray';
      if (slRoot) {
        slRoot.classList.remove('wg-4x2-lyrics--gray', 'wg-4x2-lyrics--black', 'wg-4x2-lyrics--blue', 'wg-4x2-lyrics--pink', 'wg-4x2-lyrics--yellow');
        slRoot.classList.add('wg-4x2-lyrics--' + slScheme);
      }
      var slTitle = wgEl.querySelector('.wg-4x2-lyrics__title');
      var slPrev = wgEl.querySelector('.wg-4x2-lyrics__prev');
      var slCurr = wgEl.querySelector('.wg-4x2-lyrics__curr');
      var slNext = wgEl.querySelector('.wg-4x2-lyrics__next');
      var slDim = wgEl.querySelector('.wg-4x2-lyrics__dim');
      if (slTitle) {
        var slT = cfg.title || '';
        slTitle.textContent = slT.indexOf('《') === 0 ? slT : ('《' + slT + '》');
      }
      if (slPrev) slPrev.textContent = cfg.line1 || '';
      if (slCurr) slCurr.textContent = cfg.line2 || '';
      if (slNext) slNext.textContent = cfg.line3 || '';
      if (slDim) slDim.textContent = cfg.line4 || '';
    } else if (type === 'inspair') {
      var pairName1 = wgEl.querySelector('.wg-4x4-pair__name--1');
      var pairName2 = wgEl.querySelector('.wg-4x4-pair__name--2');
      var pairQuote = wgEl.querySelector('.wg-4x4-pair__quote');
      var pairLoc = wgEl.querySelector('.wg-4x4-pair__loc');
      if (pairName1) pairName1.textContent = cfg.name1 || '';
      if (pairName2) pairName2.textContent = cfg.name2 || '';
      if (pairQuote) pairQuote.textContent = cfg.quote || '';
      if (pairLoc) {
        pairLoc.innerHTML = cfg.location
          ? '<span class="wg-4x4-pair__pin" aria-hidden="true"></span><span>' + cfg.location + '</span>'
          : '';
      }
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-pair__cover'), cfg.cover, { bgMode: true, doneClass: 'has-custom-cover' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-pair__ava--1'), cfg.ava1, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-pair__ava--2'), cfg.ava2, { doneClass: 'has-custom-photo' }));
    } else if (type === 'inshome') {
      var homeTime = wgEl.querySelector('.wg-4x4-home__time');
      var homeUser = wgEl.querySelector('.wg-4x4-home__user');
      var homeBio = wgEl.querySelector('.wg-4x4-home__bio');
      var homeDate = wgEl.querySelector('.wg-4x4-home__date');
      var homePlog = wgEl.querySelector('.wg-4x4-home__plog-title');
      var homeAnniv = wgEl.querySelector('.wg-4x4-home__anniv-left');
      var homeDays = wgEl.querySelector('.wg-4x4-home__days');
      var homeQuote = wgEl.querySelector('.wg-4x4-home__quote');
      if (homeTime) homeTime.textContent = cfg.time || '';
      if (homeUser) homeUser.textContent = cfg.username || '';
      if (homeBio) homeBio.textContent = cfg.bio || '';
      if (homeDate) homeDate.textContent = cfg.date || '';
      if (homePlog) homePlog.textContent = cfg.plog || '';
      if (homeAnniv) homeAnniv.textContent = cfg.anniv || '';
      if (homeDays) homeDays.textContent = cfg.days || '';
      if (homeQuote) homeQuote.textContent = cfg.quote || '';
      var homeRoot = wgEl.querySelector('.wg-4x4-home');
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-home__ava'), cfg.avatar, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(homeRoot, cfg.bg, { bgMode: true, doneClass: 'has-custom-bg' }).then(function () {
        if (homeRoot) homeRoot.classList.toggle('has-custom-bg', !!cfg.bg);
      }));
      ['post1', 'post2', 'post3'].forEach(function (key, idx) {
        promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-home__post--' + (idx + 1)), cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'wxmoments') {
      var wxNick = wgEl.querySelector('.wg-4x4-wx__nick');
      var wxSign = wgEl.querySelector('.wg-4x4-wx__sign');
      var wxMomentName = wgEl.querySelector('.wg-4x4-wx__moment-name');
      var wxMomentText = wgEl.querySelector('.wg-4x4-wx__moment-text');
      var wxMomentTime = wgEl.querySelector('.wg-4x4-wx__moment-time');
      var wxMomentPhoto = wgEl.querySelector('.wg-4x4-wx__moment-photo');
      if (wxNick) wxNick.textContent = cfg.nickname || '';
      if (wxSign) wxSign.textContent = cfg.signature || '';
      if (wxMomentName) wxMomentName.textContent = cfg.nickname || '';
      if (wxMomentText) wxMomentText.textContent = cfg.momentText || '';
      if (wxMomentTime) wxMomentTime.textContent = cfg.momentTime || '';
      if (wxMomentPhoto) wxMomentPhoto.classList.toggle('is-hidden', !cfg.momentPhoto);
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-wx__cover-img'), cfg.cover, { bgMode: true, doneClass: 'has-custom-cover' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-wx__avatar'), cfg.avatar, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-4x4-wx__moment-ava'), cfg.avatar, { doneClass: 'has-custom-photo' }));
      promises.push(applyMediaToEl(wxMomentPhoto, cfg.momentPhoto, { doneClass: 'has-custom-photo' }).then(function () {
        if (wxMomentPhoto) wxMomentPhoto.classList.toggle('is-hidden', !cfg.momentPhoto);
      }));
    } else if (type === 'instriple') {
      var triplePhotos = wgEl.querySelectorAll('.wg-4x4-triple__photo');
      ['photo1', 'photo2', 'photo3', 'photo4'].forEach(function (key, idx) {
        promises.push(applyMediaToEl(triplePhotos[idx], cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'insclock') {
      var dialTime = wgEl.querySelector('.wg-2x1-dial__time');
      var dialDate = wgEl.querySelector('.wg-2x1-dial__date');
      var dialNote = wgEl.querySelector('.wg-2x1-dial__note');
      if (dialTime) dialTime.textContent = cfg.time || '';
      if (dialDate) dialDate.textContent = cfg.date || '';
      if (dialNote) dialNote.textContent = cfg.note || '';
      paintInsclockHands(wgEl, cfg.time);
    } else if (type === 'instune') {
      var playTitle = wgEl.querySelector('.wg-2x1-play__title');
      var playArtist = wgEl.querySelector('.wg-2x1-play__artist');
      var playNote = wgEl.querySelector('.wg-2x1-play__note');
      var playPct = wgEl.querySelector('.wg-2x1-play__pct');
      var playFill = wgEl.querySelector('.wg-2x1-play__bar-fill');
      if (playTitle) playTitle.textContent = cfg.title || '';
      if (playArtist) playArtist.textContent = cfg.artist || '';
      if (playNote) playNote.textContent = cfg.note || '';
      if (playPct) playPct.textContent = cfg.pct || '';
      if (playFill) {
        var pctNum = parseInt(String(cfg.pct || '').replace(/%/g, ''), 10);
        if (!isNaN(pctNum)) playFill.style.width = Math.max(0, Math.min(100, pctNum)) + '%';
      }
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x1-play__cover'), cfg.cover, { doneClass: 'has-custom-photo' }));
    } else if (type === 'insquote') {
      var chatMsg = wgEl.querySelector('.wg-2x1-chat__bubble');
      var chatStamp = wgEl.querySelector('.wg-2x1-chat__stamp');
      if (chatMsg) chatMsg.textContent = cfg.msg || '';
      if (chatStamp) chatStamp.textContent = cfg.stamp || '';
      promises.push(applyMediaToEl(wgEl.querySelector('.wg-2x1-chat__ava'), cfg.ava, { doneClass: 'has-custom-photo' }));
    } else if (type === 'insmood') {
      var foldTab = wgEl.querySelector('.wg-2x1-fold__tab');
      var foldNum = wgEl.querySelector('.wg-2x1-fold__num');
      var foldLabel = wgEl.querySelector('.wg-2x1-fold__label');
      var foldSub = wgEl.querySelector('.wg-2x1-fold__sub');
      if (foldTab) foldTab.textContent = cfg.tab || '';
      if (foldNum) foldNum.textContent = cfg.num || '';
      if (foldLabel) foldLabel.textContent = cfg.label || '';
      if (foldSub) foldSub.textContent = cfg.sub || '';
    } else if (type === 'insnote') {
      var calNote = wgEl.querySelector('.wg-2x1-cal__note');
      if (calNote) calNote.textContent = cfg.note || '';
      paint2x1CalWeek(wgEl, cfg);
    } else if (type === 'inscard') {
      var stripPhotos = wgEl.querySelectorAll('.wg-2x1-strip__photo');
      ['photo1', 'photo2', 'photo3'].forEach(function (key, idx) {
        promises.push(applyMediaToEl(stripPhotos[idx], cfg[key], { doneClass: 'has-custom-photo' }));
      });
    } else if (type === 'custom') {
      promises.push(paintCustomWidgetElement(wgEl, item, cfg));
    }
    return Promise.all(promises);
  }

  function paintCustomWidgetElement(wgEl, item, cfg) {
    var tpl = getCustomWgTpl();
    if (!tpl || !wgEl) return Promise.resolve();
    cfg = cfg || getWidgetConfig(item) || {};
    var preset = tpl.resolvePresetFromConfig(cfg);
    if (!preset) {
      var def = WIDGET_CATALOG[item && item.widgetId];
      if (def && def.customPresetId) preset = tpl.findPresetById(def.customPresetId);
    }
    if (!preset) return Promise.resolve();
    var host = wgEl.querySelector('.wg-custom__host');
    if (!host) return Promise.resolve();
    var textMap = {};
    (preset.slots || []).forEach(function (s) {
      if (s.type === 'text') textMap[s.key] = cfg[s.key] != null ? String(cfg[s.key]) : '';
    });
    host.innerHTML = tpl.renderTemplateHtml(preset.htmlTemplate, preset.slots, textMap);
    tpl.applyStyleHintsToEl(wgEl, preset.styleHints || cfg._styleHints);
    (preset.slots || []).forEach(function (s) {
      if (s.type !== 'text') return;
      var val = textMap[s.key] || '';
      host.querySelectorAll('[data-miya-text="' + s.key + '"]').forEach(function (el) {
        /* 空值保留模板默认文案，避免清空默认字 */
        if (String(val).trim() !== '') el.textContent = val;
      });
    });
    var mediaPromises = [];
    (preset.slots || []).forEach(function (s) {
      if (s.type !== 'image') return;
      var nodes = host.querySelectorAll('[data-miya-img="' + s.key + '"]');
      if (!nodes.length) return;
      nodes.forEach(function (node) {
        mediaPromises.push(applyMediaToEl(node, cfg[s.key], { doneClass: 'has-custom-photo' }));
      });
    });
    return Promise.all(mediaPromises);
  }

  function wgEditorToast(msg) {
    if (global.miyaBeautifyApp && global.miyaBeautifyApp.toast) {
      global.miyaBeautifyApp.toast(msg);
      return;
    }
    var div = document.createElement('div');
    div.className = 'ins-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () { div.remove(); }, 2400);
  }

  function refreshWgEditorImagePreviews() {
    var body = $('desk-custom-wg-editor-body');
    if (!body || !wgEditorState.draft) return;
    body.querySelectorAll('[data-wg-ed-img]').forEach(function (el) {
      var key = el.getAttribute('data-wg-ed-img');
      var ref = wgEditorState.draft[key];
      var ph = el.querySelector('.desk-custom-wg-editor__img-ph');
      if (!ref) {
        el.style.backgroundImage = '';
        el.classList.remove('has-image');
        if (ph) ph.hidden = false;
        return;
      }
      global.miyaResolveMediaUrl(ref).then(function (url) {
        if (!url) return;
        el.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
        el.classList.add('has-image');
        if (ph) ph.hidden = true;
      });
    });
  }

  function buildWgEditorBody(widgetType, cfg) {
    var body = $('desk-custom-wg-editor-body');
    if (!body) return;
    var fields = WIDGET_EDITOR_FIELDS[widgetType] || [];
    if (widgetType === 'custom') {
      var tpl = getCustomWgTpl();
      fields = tpl && tpl.editorFieldsFromConfig ? tpl.editorFieldsFromConfig(cfg) : [];
    }
    body.innerHTML = '';
    if (widgetType === 'custom' && !fields.length) {
      var empty = document.createElement('p');
      empty.className = 'desk-custom-wg-editor__hint';
      empty.textContent = '该自定义组件没有可编辑槽位，请先在美化页完善模板。';
      body.appendChild(empty);
      return;
    }
    fields.forEach(function (field) {
      var row = document.createElement('div');
      row.className = 'desk-custom-wg-editor__field';
      row.innerHTML = '<label class="desk-custom-wg-editor__label">' + field.label + '</label>';
      if (field.type === 'image') {
        var imgWrap = document.createElement('div');
        imgWrap.className = 'desk-custom-wg-editor__img-wrap';
        imgWrap.innerHTML =
          '<button type="button" class="desk-custom-wg-editor__img" data-wg-ed-img="' + field.key + '" aria-label="' + field.label + '">' +
            '<span class="desk-custom-wg-editor__img-ph">点击上传</span>' +
          '</button>' +
          '<div class="desk-custom-wg-editor__img-actions">' +
            '<button type="button" class="ins-chip ins-chip--gold" data-wg-ed-upload="' + field.key + '">上传</button>' +
            '<button type="button" class="ins-chip" data-wg-ed-url="' + field.key + '">链接</button>' +
            '<button type="button" class="ins-chip ins-chip--dim" data-wg-ed-clear-img="' + field.key + '">清除</button>' +
          '</div>';
        row.appendChild(imgWrap);
      } else if (field.type === 'choice') {
        var choiceWrap = document.createElement('div');
        choiceWrap.className = 'desk-custom-wg-editor__choices';
        var currentChoice = cfg[field.key];
        if (currentChoice == null && field.choices && field.choices.length) {
          currentChoice = field.choices[0].value;
        }
        (field.choices || []).forEach(function (opt) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ins-chip' + (opt.value === currentChoice ? ' ins-chip--gold' : '');
          btn.setAttribute('data-wg-ed-choice', field.key);
          btn.setAttribute('data-wg-ed-choice-value', opt.value);
          btn.textContent = opt.label;
          choiceWrap.appendChild(btn);
        });
        row.appendChild(choiceWrap);
      } else {
        var input;
        if (field.multiline) {
          input = document.createElement('textarea');
          input.className = 'desk-custom-wg-editor__textarea ins-text-input';
          input.rows = 2;
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'desk-custom-wg-editor__input ins-text-input';
        }
        input.setAttribute('data-wg-ed-text', field.key);
        input.value = cfg[field.key] != null ? String(cfg[field.key]) : '';
        if (field.maxLength) input.maxLength = field.maxLength;
        input.placeholder = field.label;
        row.appendChild(input);
      }
      body.appendChild(row);
    });
    refreshWgEditorImagePreviews();
  }

  function collectWgEditorDraft() {
    var body = $('desk-custom-wg-editor-body');
    if (!body || !wgEditorState.draft) return null;
    var draft = Object.assign({}, wgEditorState.draft);
    body.querySelectorAll('[data-wg-ed-text]').forEach(function (input) {
      draft[input.getAttribute('data-wg-ed-text')] = input.value.trim();
    });
    body.querySelectorAll('[data-wg-ed-choice]').forEach(function (btn) {
      if (btn.classList.contains('ins-chip--gold')) {
        draft[btn.getAttribute('data-wg-ed-choice')] = btn.getAttribute('data-wg-ed-choice-value');
      }
    });
    return draft;
  }

  function saveWidgetItemConfig(itemId, config) {
    suspendGlass();
    var layout = getLayout();
    var found = findLayoutItemById(itemId);
    if (!found) return false;
    found.item.config = config;
    saveLayout(layout);
    var wrap = document.querySelector('[data-item-id="' + itemId + '"]');
    var wgEl = wrap && wrap.querySelector('.desk-custom__wg');
    if (wgEl) paintWidgetElement(wgEl, found.item);
    return true;
  }

  function triggerWidgetQuickUpload(itemId, imageKey) {
    var fileInp = $('desk-custom-wg-editor-file');
    var found = findLayoutItemById(itemId);
    if (!found || !fileInp) {
      openWidgetEditor(itemId);
      return;
    }
    var cfg = getWidgetConfig(found.item);
    var handler = function () {
      var file = fileInp.files && fileInp.files[0];
      fileInp.value = '';
      fileInp.removeEventListener('change', handler);
      if (!file) return;
      var store = global.miyaStoreImageFile || global.miyaStoreAppearanceImageFile;
      if (!store) {
        wgEditorToast('上传失败');
        return;
      }
      store(file).then(function (id) {
        cfg[imageKey] = id;
        if (saveWidgetItemConfig(itemId, cfg)) wgEditorToast('照片已更新');
      }).catch(function () { wgEditorToast('上传失败'); });
    };
    fileInp.addEventListener('change', handler);
    if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(fileInp);
    else fileInp.click();
  }

  function openWidgetEditor(itemId) {
    var found = findLayoutItemById(itemId);
    if (!found || !isEditableWidgetItem(found.item)) return;
    var type = getWidgetType(found.item.widgetId);
    var def = WIDGET_CATALOG[found.item.widgetId];
    /* 打开编辑前清掉主屏手势，避免 capture 把弹窗点击吞掉 */
    var captId = drag.pointerId;
    cancelPending();
    drag.pointerId = null;
    drag.sourceEl = null;
    drag.fromSlot = null;
    drag.itemWrap = null;
    drag.wasWidgetTap = false;
    drag.tapItemId = null;
    var phone = $('miya-phone-layer');
    if (phone && captId != null) {
      try { phone.releasePointerCapture(captId); } catch (e) {}
    }
    wgEditorState.open = true;
    wgEditorState.itemId = itemId;
    wgEditorState.widgetType = type;
    wgEditorState.draft = getWidgetConfig(found.item);
    wgEditorState.pendingImageKey = null;
    wgEditorState.openedAt = Date.now();
    /* 挡住打开瞬间的合成 click，避免点在遮罩上立刻关掉 */
    dragConsumedUntil = Math.max(dragConsumedUntil, Date.now() + WG_EDITOR_GHOST_MS);

    var editor = $('desk-custom-wg-editor');
    var title = $('desk-custom-wg-editor-title');
    if (title) title.textContent = def ? def.label : '编辑组件';
    buildWgEditorBody(type, wgEditorState.draft);
    if (editor) {
      editor.hidden = false;
      editor.setAttribute('aria-hidden', 'false');
    }
    document.documentElement.classList.add('is-custom-wg-editing');
    try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) {}
  }

  function closeWidgetEditor() {
    wgEditorState.open = false;
    wgEditorState.itemId = null;
    wgEditorState.widgetType = null;
    wgEditorState.draft = null;
    wgEditorState.pendingImageKey = null;
    wgEditorState.openedAt = 0;
    var editor = $('desk-custom-wg-editor');
    if (editor) {
      editor.hidden = true;
      editor.setAttribute('aria-hidden', 'true');
    }
    document.documentElement.classList.remove('is-custom-wg-editing');
  }

  function saveWidgetEditor() {
    if (!wgEditorState.itemId) return;
    var draft = collectWgEditorDraft();
    if (!draft) return;
    if (saveWidgetItemConfig(wgEditorState.itemId, draft)) {
      wgEditorToast('已保存');
      closeWidgetEditor();
    }
  }

  function bindWidgetEditor() {
    if (wgEditorBound) return;
    wgEditorBound = true;
    var editor = $('desk-custom-wg-editor');
    var saveBtn = $('desk-custom-wg-editor-save');
    var closeBtn = $('desk-custom-wg-editor-close');
    var cancelBtn = $('desk-custom-wg-editor-cancel');
    var fileInp = $('desk-custom-wg-editor-file');

    if (saveBtn) saveBtn.addEventListener('click', saveWidgetEditor);
    if (closeBtn) closeBtn.addEventListener('click', closeWidgetEditor);
    if (cancelBtn) cancelBtn.addEventListener('click', closeWidgetEditor);
    if (editor) {
      /* capture：吞掉打开瞬间的幽灵 click（首行点按落点常在遮罩区） */
      editor.addEventListener('click', function (e) {
        if (isWgEditorGhostClick()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.target === editor) closeWidgetEditor();
      }, true);
    }
    if (fileInp) {
      fileInp.addEventListener('change', function () {
        var file = fileInp.files && fileInp.files[0];
        var key = wgEditorState.pendingImageKey;
        if (!file || !key || !wgEditorState.draft) return;
        fileInp.value = '';
        var store = global.miyaStoreImageFile || global.miyaStoreAppearanceImageFile;
        if (!store) return;
        store(file).then(function (id) {
          wgEditorState.draft[key] = id;
          refreshWgEditorImagePreviews();
        }).catch(function () { wgEditorToast('上传失败'); });
      });
    }
    document.addEventListener('click', function (e) {
      if (!wgEditorState.open) return;
      if (isWgEditorGhostClick()) return;
      var uploadKey = e.target.closest('[data-wg-ed-upload]');
      if (uploadKey) {
        wgEditorState.pendingImageKey = uploadKey.getAttribute('data-wg-ed-upload');
        if (fileInp) {
          if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(fileInp);
          else fileInp.click();
        }
        return;
      }
      var imgBtn = e.target.closest('[data-wg-ed-img]');
      if (imgBtn) {
        wgEditorState.pendingImageKey = imgBtn.getAttribute('data-wg-ed-img');
        if (fileInp) {
          if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(fileInp);
          else fileInp.click();
        }
        return;
      }
      var urlBtn = e.target.closest('[data-wg-ed-url]');
      if (urlBtn) {
        var urlKey = urlBtn.getAttribute('data-wg-ed-url');
        var promptFn = global.miyaDialog && global.miyaDialog.prompt
          ? global.miyaDialog.prompt({ title: '图片链接', message: '粘贴可访问的图片地址', placeholder: 'https://' })
          : Promise.resolve(prompt('图片链接') || '');
        promptFn.then(function (val) {
          if (!val || val === false) return;
          var url = String(val).trim();
          if (!url || !wgEditorState.draft) return;
          var storeUrl = global.miyaStoreImageUrl;
          if (storeUrl) {
            storeUrl(url).then(function (id) {
              wgEditorState.draft[urlKey] = id;
              refreshWgEditorImagePreviews();
            }).catch(function () {
              wgEditorState.draft[urlKey] = url;
              refreshWgEditorImagePreviews();
            });
          } else {
            wgEditorState.draft[urlKey] = url;
            refreshWgEditorImagePreviews();
          }
        });
        return;
      }
      var choiceBtn = e.target.closest('[data-wg-ed-choice]');
      if (choiceBtn) {
        var choiceKey = choiceBtn.getAttribute('data-wg-ed-choice');
        choiceBtn.parentElement.querySelectorAll('[data-wg-ed-choice="' + choiceKey + '"]').forEach(function (btn) {
          btn.classList.toggle('ins-chip--gold', btn === choiceBtn);
        });
        return;
      }
      var clearBtn = e.target.closest('[data-wg-ed-clear-img]');
      if (clearBtn) {
        var clearKey = clearBtn.getAttribute('data-wg-ed-clear-img');
        if (wgEditorState.draft) {
          wgEditorState.draft[clearKey] = null;
          refreshWgEditorImagePreviews();
        }
      }
    });
  }

  function buildCustomWidgetPreview(widgetId) {
    var def = WIDGET_CATALOG[widgetId];
    if (!def || !def.widget) return null;
    var wrap = document.createElement('div');
    wrap.className = 'ins-custom-wg-showcase__card';
    wrap.innerHTML = '<p class="ins-custom-wg-showcase__name">' + def.label + '</p>';
    var stage = document.createElement('div');
    stage.className = 'ins-custom-wg-showcase__stage ins-custom-wg-showcase__stage--' + def.w + 'x' + def.h;
    var item = { kind: 'widget', widgetId: widgetId, config: null };
    var wg = createWidgetElement(widgetId);
    if (wg) {
      stage.appendChild(wg);
      wrap.appendChild(stage);
      paintWidgetElement(wg, item);
    }
    return wrap;
  }

  function genItemId() {
    itemIdSeq += 1;
    return 'ci_' + Date.now().toString(36) + '_' + itemIdSeq;
  }

  function genId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function $(id) { return document.getElementById(id); }

  function emptyDockSlots() {
    return [null, null, null, null];
  }

  function defaultPageItems() {
    var items = [];
    CUSTOM_GRID_APPS.forEach(function (k, i) {
      items.push({
        id: genItemId(),
        kind: 'app',
        key: k,
        x: i % GRID_COLS,
        y: Math.floor(i / GRID_COLS),
        w: 1,
        h: 1
      });
    });
    return items;
  }

  function defaultLayout() {
    var dockSlots = emptyDockSlots();
    DEFAULT_DOCK.forEach(function (k, i) { dockSlots[i] = k; });
    return { pages: [{ items: defaultPageItems() }], dockSlots: dockSlots };
  }

  function countDockApps(dockSlots) {
    var n = 0;
    dockSlots.forEach(function (k) { if (k) n++; });
    return n;
  }

  function migrateOldLayout(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.pages) return null;
    if (raw.gridSlots && raw.dockSlots) {
      var items = [];
      raw.gridSlots.forEach(function (k, i) {
        if (k && ALL_APPS.indexOf(k) >= 0) {
          items.push({
            id: genItemId(), kind: 'app', key: k,
            x: i % GRID_COLS, y: Math.floor(i / GRID_COLS), w: 1, h: 1
          });
        }
      });
      return { pages: [{ items: items }], dockSlots: raw.dockSlots.slice(0, DOCK_SLOT_COUNT) };
    }
    var gridSlots = emptyGridSlots();
    var dockSlots = emptyDockSlots();
    var gridList = Array.isArray(raw.grid) ? raw.grid.slice() : CUSTOM_GRID_APPS.slice();
    var dockList = Array.isArray(raw.dock) ? raw.dock.slice() : DEFAULT_DOCK.slice();
    var items2 = [];
    gridList.forEach(function (k, i) {
      if (i < GRID_SLOT_COUNT && ALL_APPS.indexOf(k) >= 0) {
        items2.push({
          id: genItemId(), kind: 'app', key: k,
          x: i % GRID_COLS, y: Math.floor(i / GRID_COLS), w: 1, h: 1
        });
      }
    });
    dockList.forEach(function (k, i) {
      if (i < DOCK_SLOT_COUNT && ALL_APPS.indexOf(k) >= 0) dockSlots[i] = k;
    });
    return { pages: [{ items: items2 }], dockSlots: dockSlots };
  }

  function emptyGridSlots() {
    var a = [];
    for (var i = 0; i < GRID_SLOT_COUNT; i++) a.push(null);
    return a;
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'widget') {
      ensureCustomCatalogEntry(raw.widgetId, raw.config);
    }
    var def = raw.kind === 'widget'
      ? WIDGET_CATALOG[raw.widgetId]
      : null;
    var w = raw.w || (def ? def.w : 1);
    var h = raw.h || (def ? def.h : 1);
    var item = {
      id: raw.id || genItemId(),
      kind: raw.kind === 'widget' ? 'widget' : 'app',
      x: Math.max(0, Math.min(GRID_COLS - 1, parseInt(raw.x, 10) || 0)),
      y: Math.max(0, Math.min(GRID_ROWS - 1, parseInt(raw.y, 10) || 0)),
      w: Math.max(1, Math.min(GRID_COLS, w)),
      h: Math.max(1, Math.min(GRID_ROWS, h))
    };
    if (item.kind === 'app') {
      if (!raw.key || ALL_APPS.indexOf(raw.key) < 0) return null;
      item.key = raw.key;
      item.w = 1;
      item.h = 1;
    } else {
      var widgetId = resolveWidgetId(raw.widgetId);
      var rawCfg = raw.config && typeof raw.config === 'object' ? raw.config : null;
      ensureCustomCatalogEntry(widgetId, rawCfg);
      var isCustomLib = !!(widgetId && String(widgetId).indexOf('custom_lib_') === 0);
      var hasHtmlSnap = !!(rawCfg && rawCfg._htmlTemplate);
      if (!widgetId) return null;
      if (!WIDGET_CATALOG[widgetId]) {
        /* 自定义组件：catalog 尚未就绪时仍保留布局项，避免 normalize 把整页洗成默认 */
        if (!(isCustomLib || hasHtmlSnap)) return null;
        WIDGET_CATALOG[widgetId] = {
          w: Math.max(1, Math.min(GRID_COLS, parseInt(raw.w, 10) || (rawCfg && rawCfg._w) || 2)),
          h: Math.max(1, Math.min(GRID_ROWS, parseInt(raw.h, 10) || (rawCfg && rawCfg._h) || 2)),
          label: (rawCfg && rawCfg._presetName) || '自定义',
          widget: 'custom',
          editable: true,
          customPresetId: (rawCfg && rawCfg._presetId) || (isCustomLib ? String(widgetId).slice(11) : '')
        };
      }
      item.widgetId = widgetId;
      var cat = WIDGET_CATALOG[item.widgetId];
      item.w = (cat && cat.w) || Math.max(1, parseInt(raw.w, 10) || 2);
      item.h = (cat && cat.h) || Math.max(1, parseInt(raw.h, 10) || 2);
      if (rawCfg) {
        item.config = rawCfg;
      }
    }
    if (item.x + item.w > GRID_COLS || item.y + item.h > GRID_ROWS) return null;
    return item;
  }

  function normalizeLayout(raw) {
    var migrated = migrateOldLayout(raw);
    if (migrated) raw = migrated;
    var base = defaultLayout();
    if (!raw || typeof raw !== 'object') return base;

    var pages = Array.isArray(raw.pages) && raw.pages.length
      ? raw.pages.map(function (pg) {
        var items = Array.isArray(pg.items) ? pg.items : [];
        return { items: items.map(normalizeItem).filter(Boolean) };
      })
      : base.pages.slice();

    if (!pages.length) pages = [{ items: defaultPageItems() }];

    var dockSlots = Array.isArray(raw.dockSlots)
      ? raw.dockSlots.slice(0, DOCK_SLOT_COUNT)
      : base.dockSlots.slice();
    while (dockSlots.length < DOCK_SLOT_COUNT) dockSlots.push(null);

    dockSlots = dockSlots.map(function (k) {
      return k && ALL_APPS.indexOf(k) >= 0 ? k : null;
    });

    pages.forEach(function (pg) {
      var packed = [];
      pg.items.forEach(function (item) {
        if (item.kind === 'widget') {
          if (canPlaceRect(packed, item.x, item.y, item.w, item.h, null)) packed.push(item);
          return;
        }
        if (canPlaceRect(packed, item.x, item.y, 1, 1, null)) packed.push(item);
      });
      pg.items = packed;
    });

    var placedApps = {};
    var dockApps = {};
    dockSlots.forEach(function (k) {
      if (k) dockApps[k] = true;
    });
    pages.forEach(function (pg) {
      pg.items = pg.items.filter(function (item) {
        if (item.kind === 'widget') return true;
        if (placedApps[item.key] || dockApps[item.key]) return false;
        placedApps[item.key] = true;
        return true;
      });
    });

    pages.forEach(function (pg) {
      var kept = [];
      pg.items.forEach(function (item) {
        var w = item.w || 1;
        var h = item.h || 1;
        if (canPlaceRect(kept, item.x, item.y, w, h, null)) {
          kept.push(item);
          return;
        }
        if (item.kind === 'app') {
          var appSpot = findEmptyRect(kept, 1, 1);
          if (appSpot) {
            kept.push({
              id: item.id || genItemId(),
              kind: 'app',
              key: item.key,
              x: appSpot.x,
              y: appSpot.y,
              w: 1,
              h: 1
            });
          }
          return;
        }
        var widgetSpot = findEmptyRect(kept, w, h);
        if (widgetSpot) {
          kept.push(Object.assign({}, item, { x: widgetSpot.x, y: widgetSpot.y }));
        }
      });
      pg.items = kept;
    });

    ALL_APPS.forEach(function (k) {
      if (placedApps[k] || dockApps[k]) return;
      var placed = false;
      for (var pi = 0; pi < pages.length && !placed; pi++) {
        var spot = findEmptyRect(pages[pi].items, 1, 1);
        if (spot) {
          pages[pi].items.push({
            id: genItemId(), kind: 'app', key: k,
            x: spot.x, y: spot.y, w: 1, h: 1
          });
          placedApps[k] = true;
          placed = true;
        }
      }
      if (!placed) {
        pages.push({
          items: [{
            id: genItemId(), kind: 'app', key: k,
            x: 0, y: 0, w: 1, h: 1
          }]
        });
        placedApps[k] = true;
      }
    });

    var dockCount = countDockApps(dockSlots);
    if (dockCount < MIN_DOCK) {
      for (var pi2 = 0; pi2 < pages.length && dockCount < MIN_DOCK; pi2++) {
        pages[pi2].items = pages[pi2].items.filter(function (item) {
          if (item.kind !== 'app' || dockCount >= MIN_DOCK) return true;
          for (var d = 0; d < DOCK_SLOT_COUNT; d++) {
            if (!dockSlots[d]) {
              dockSlots[d] = item.key;
              dockCount++;
              return false;
            }
          }
          return true;
        });
      }
    }

    if (countDockApps(dockSlots) > MAX_DOCK) {
      var kept = 0;
      dockSlots = dockSlots.map(function (k) {
        if (!k) return null;
        kept++;
        if (kept <= MAX_DOCK) return k;
        var spot2 = findEmptyRect(pages[0].items, 1, 1);
        if (spot2) {
          pages[0].items.push({
            id: genItemId(), kind: 'app', key: k,
            x: spot2.x, y: spot2.y, w: 1, h: 1
          });
        }
        return null;
      });
    }

    return { pages: pages, dockSlots: dockSlots };
  }

  function buildOccupancy(items, skipId) {
    var occ = [];
    var r, c;
    for (r = 0; r < GRID_ROWS; r++) {
      occ[r] = [];
      for (c = 0; c < GRID_COLS; c++) occ[r][c] = null;
    }
    items.forEach(function (item) {
      if (skipId && item.id === skipId) return;
      for (r = item.y; r < item.y + item.h; r++) {
        for (c = item.x; c < item.x + item.w; c++) {
          if (r < GRID_ROWS && c < GRID_COLS) occ[r][c] = item.id;
        }
      }
    });
    return occ;
  }

  function canPlaceRect(items, x, y, w, h, skipId) {
    if (x < 0 || y < 0 || x + w > GRID_COLS || y + h > GRID_ROWS) return false;
    var occ = buildOccupancy(items, skipId);
    var r, c;
    for (r = y; r < y + h; r++) {
      for (c = x; c < x + w; c++) {
        if (occ[r][c]) return false;
      }
    }
    return true;
  }

  function findEmptyRect(items, w, h) {
    var y, x;
    for (y = 0; y <= GRID_ROWS - h; y++) {
      for (x = 0; x <= GRID_COLS - w; x++) {
        if (canPlaceRect(items, x, y, w, h, null)) return { x: x, y: y };
      }
    }
    return null;
  }

  function resolveWidgetDropAnchor(page, hoverX, hoverY, w, h, skipId) {
    var dy, dx, ax, ay;
    for (dy = 0; dy < h; dy++) {
      for (dx = 0; dx < w; dx++) {
        ax = hoverX - dx;
        ay = hoverY - dy;
        if (ax < 0 || ay < 0 || ax + w > GRID_COLS || ay + h > GRID_ROWS) continue;
        if (canPlaceRect(page.items, ax, ay, w, h, skipId)) return { x: ax, y: ay };
      }
    }
    return null;
  }

  function getWidgetDropAnchor(layout, from, to) {
    if (!from || !to || to.type !== 'grid') return null;
    var fromItem = getItemInSlot(layout, from);
    if (!fromItem || fromItem.kind !== 'widget') return null;
    var page = layout.pages[to.page];
    if (!page) return null;
    var skipId = from.page === to.page ? fromItem.id : null;
    return resolveWidgetDropAnchor(page, to.x, to.y, fromItem.w, fromItem.h, skipId);
  }

  function isPageEmpty(page) {
    return !page || !page.items || !page.items.length;
  }

  function getLayout() {
    if (!customThemeState) loadCustomTheme();
    if (!customThemeState.layout) customThemeState.layout = defaultLayout();
    return customThemeState.layout;
  }

  function saveLayout(layout) {
    if (!customThemeState) loadCustomTheme();
    customThemeState.layout = normalizeLayout(layout);
    layoutFromFallback = false;
    flushThemeMemCache();
    if (saveLayoutTimer) clearTimeout(saveLayoutTimer);
    saveLayoutTimer = setTimeout(function () {
      saveLayoutTimer = 0;
      saveCustomTheme();
    }, 0);
  }

  function applyThemeFromRaw(raw) {
    if (!raw || typeof raw !== 'object') {
      customThemeState = Object.assign({}, defaultCustomTheme, { icons: {}, memoAvas: {}, polaroids: {}, copy: {}, layout: defaultLayout() });
      layoutFromFallback = true;
      return customThemeState;
    }
    customThemeState = Object.assign({}, defaultCustomTheme, raw);
    customThemeState.icons = Object.assign({}, raw.icons || {});
    customThemeState.memoAvas = Object.assign({}, raw.memoAvas || {});
    customThemeState.polaroids = Object.assign({}, raw.polaroids || {});
    customThemeState.copy = Object.assign({}, raw.copy || {});
    customThemeState.iconFrameless = raw.iconFrameless === true;
    customThemeState.altIconStyle = raw.altIconStyle === true;
    customThemeState.layout = normalizeLayout(raw.layout);
    layoutFromFallback = false;
    return customThemeState;
  }

  /** 异步 hydrate 完成时合并远端数据，保留当前内存里已编辑的图标/布局等 */
  function mergeThemeFromRaw(raw) {
    if (!customThemeState) {
      applyThemeFromRaw(raw);
      return customThemeState;
    }
    if (!raw || typeof raw !== 'object') return customThemeState;
    var keepLocalLayout = !layoutFromFallback;
    var local = {
      icons: Object.assign({}, customThemeState.icons || {}),
      memoAvas: Object.assign({}, customThemeState.memoAvas || {}),
      polaroids: Object.assign({}, customThemeState.polaroids || {}),
      copy: Object.assign({}, customThemeState.copy || {}),
      layout: customThemeState.layout
    };
    applyThemeFromRaw(raw);
    customThemeState.icons = Object.assign({}, customThemeState.icons || {}, local.icons);
    customThemeState.memoAvas = Object.assign({}, customThemeState.memoAvas || {}, local.memoAvas);
    customThemeState.polaroids = Object.assign({}, customThemeState.polaroids || {}, local.polaroids);
    customThemeState.copy = Object.assign({}, customThemeState.copy || {}, local.copy);
    /* 勿用 sync 阶段装上的默认布局盖掉 IDB 里的真实自定义布局 */
    if (keepLocalLayout && local.layout && local.layout.pages && local.layout.pages.length) {
      customThemeState.layout = local.layout;
    }
    layoutFromFallback = false;
    return customThemeState;
  }

  function flushThemeMemCache() {
    if (!customDeskHydrated || !customThemeState || layoutFromFallback) return;
    var payload = snapshotCustomTheme();
    if (typeof global.miyaSyncFlushJsonKey === 'function') {
      global.miyaSyncFlushJsonKey(CUSTOM_META_KEY, payload);
    }
  }

  function hydrateThemeSync() {
    if (customDeskHydrated && customThemeState) return customThemeState;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(CUSTOM_META_KEY);
      if (raw != null) {
        applyThemeFromRaw(raw);
        return customThemeState;
      }
    }
    return null;
  }

  function loadCustomTheme() {
    var hydrated = hydrateThemeSync();
    if (hydrated) return hydrated;
    if (!customThemeState) {
      customThemeState = Object.assign({}, defaultCustomTheme, { icons: {}, layout: defaultLayout() });
      layoutFromFallback = true;
    }
    return customThemeState;
  }

  function snapshotCustomTheme() {
    loadCustomTheme();
    var tpl = getCustomWgTpl();
    var library = tpl && typeof tpl.getLibrarySnapshot === 'function'
      ? tpl.getLibrarySnapshot()
      : [];
    return {
      version: customThemeState.version || defaultCustomTheme.version,
      wallpaper: customThemeState.wallpaper,
      icons: Object.assign({}, customThemeState.icons || {}),
      textColorMode: customThemeState.textColorMode,
      iconFrameless: customThemeState.iconFrameless,
      altIconStyle: customThemeState.altIconStyle === true,
      profileBg: customThemeState.profileBg || null,
      memoAvas: Object.assign({}, customThemeState.memoAvas || {}),
      polaroids: Object.assign({}, customThemeState.polaroids || {}),
      copy: Object.assign({}, customThemeState.copy || {}),
      layout: normalizeLayout(customThemeState.layout),
      customWidgetLibrary: library
    };
  }

  function persistCustomTheme() {
    if (!customDeskHydrated || layoutFromFallback) return Promise.resolve(false);
    var payload = snapshotCustomTheme();
    customThemeState = Object.assign({}, defaultCustomTheme, payload);
    customThemeState.icons = Object.assign({}, payload.icons || {});
    customThemeState.memoAvas = Object.assign({}, payload.memoAvas || {});
    customThemeState.polaroids = Object.assign({}, payload.polaroids || {});
    customThemeState.copy = Object.assign({}, payload.copy || {});
    customThemeState.layout = normalizeLayout(payload.layout);
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(CUSTOM_META_KEY, payload);
    }
    try { localStorage.setItem(CUSTOM_META_KEY, JSON.stringify(payload)); } catch (e) {}
    return Promise.resolve(true);
  }

  function saveCustomTheme() {
    /* hydrate 完成前禁止落盘，避免默认布局/空组件库写入内存热缓存盖掉 IDB 真数据 */
    if (!customDeskHydrated || layoutFromFallback) return;
    persistCustomTheme();
  }

  function parseLayoutModeValue(raw) {
    if (raw === 'custom' || raw === 'fixed') return raw;
    if (raw && typeof raw === 'object') {
      var m = raw.mode || raw.value || raw.layout;
      if (m === 'custom' || m === 'fixed') return m;
    }
    return null;
  }

  function readLayoutModeFromLsPlain() {
    try {
      var raw = localStorage.getItem(LAYOUT_MODE_KEY);
      if (raw === 'custom' || raw === 'fixed') return raw;
    } catch (e) {}
    return null;
  }

  function hydrateLayoutModeSync() {
    if (layoutModeCache === 'custom' || layoutModeCache === 'fixed') return layoutModeCache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var parsed = parseLayoutModeValue(global.miyaSyncReadJsonKey(LAYOUT_MODE_KEY));
      if (parsed) {
        layoutModeCache = parsed;
        return layoutModeCache;
      }
    }
    var plain = readLayoutModeFromLsPlain();
    if (plain) {
      layoutModeCache = plain;
      return layoutModeCache;
    }
    return null;
  }

  function getLayoutMode() {
    var synced = hydrateLayoutModeSync();
    if (synced) return synced;
    return layoutModeCache || 'fixed';
  }

  function persistLayoutMode(mode) {
    var next = mode === 'custom' ? 'custom' : 'fixed';
    layoutModeCache = next;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(LAYOUT_MODE_KEY, next);
    }
    try { localStorage.setItem(LAYOUT_MODE_KEY, next); } catch (e) {}
    return Promise.resolve(true);
  }

  function setLayoutMode(mode) {
    var next = mode === 'custom' ? 'custom' : 'fixed';
    layoutModeCache = next;
    persistLayoutMode(next);
    document.documentElement.dataset.miyaDeskLayout = next;
    return next;
  }

  function hydratePresetsFromRaw(raw) {
    customPresetsCache = Array.isArray(raw) ? raw.slice() : [];
    return customPresetsCache;
  }

  function hydratePresetsSync() {
    if (customDeskHydrated && customPresetsCache) return customPresetsCache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(CUSTOM_PRESETS_KEY);
      if (raw != null) return hydratePresetsFromRaw(raw);
    }
    return null;
  }

  function loadCustomPresets() {
    var synced = hydratePresetsSync();
    if (synced) return synced;
    if (!customPresetsCache) customPresetsCache = [];
    return customPresetsCache;
  }

  function persistCustomPresets(list) {
    customPresetsCache = Array.isArray(list) ? list.slice() : [];
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(CUSTOM_PRESETS_KEY, customPresetsCache);
    }
    try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(customPresetsCache)); } catch (e) {}
    return Promise.resolve(true);
  }

  function whenCustomDeskReady() {
    if (customDeskReady) return customDeskReady;
    var readKey = global.miyaReadLsJsonKey
      ? function (key, fb) { return global.miyaReadLsJsonKey(key, fb); }
      : function (key, fb) {
        try {
          var raw = localStorage.getItem(key);
          return Promise.resolve(raw ? JSON.parse(raw) : fb);
        } catch (e) {
          return Promise.resolve(fb);
        }
      };

    customDeskReady = Promise.all([
      readKey(CUSTOM_META_KEY, null),
      readKey(CUSTOM_PRESETS_KEY, []),
      readKey(LAYOUT_MODE_KEY, null)
    ]).then(function (rows) {
      if (customThemeState) mergeThemeFromRaw(rows[0]);
      else applyThemeFromRaw(rows[0]);
      hydratePresetsFromRaw(rows[1]);
      var mode = parseLayoutModeValue(rows[2]) || readLayoutModeFromLsPlain() || 'fixed';
      layoutModeCache = mode;
      if (parseLayoutModeValue(rows[2]) == null && readLayoutModeFromLsPlain()) {
        persistLayoutMode(mode);
      }
      var tpl = getCustomWgTpl();
      var ready = tpl && tpl.whenReady ? tpl.whenReady() : Promise.resolve([]);
      return ready.then(function () {
        var libSource = null;
        if (customThemeState && Array.isArray(customThemeState.customWidgetLibrary) && customThemeState.customWidgetLibrary.length) {
          libSource = customThemeState;
        } else if (rows[0] && Array.isArray(rows[0].customWidgetLibrary) && rows[0].customWidgetLibrary.length) {
          libSource = rows[0];
        }
        var libraryApply = libSource
          ? applyCustomWidgetLibraryFromTheme(libSource)
          : Promise.resolve();
        return libraryApply.then(function () {
          syncCustomWidgetCatalog();
          ensureLayoutCustomWidgetsInCatalog(customThemeState && customThemeState.layout);
          customDeskHydrated = true;
          layoutFromFallback = false;
          return {
            theme: customThemeState,
            presets: customPresetsCache,
            layoutMode: layoutModeCache
          };
        });
      });
    }).catch(function () {
      loadCustomTheme();
      loadCustomPresets();
      layoutModeCache = getLayoutMode();
      syncCustomWidgetCatalog();
      ensureLayoutCustomWidgetsInCatalog(customThemeState && customThemeState.layout);
      customDeskHydrated = true;
      return {
        theme: customThemeState,
        presets: customPresetsCache,
        layoutMode: layoutModeCache
      };
    });
    return customDeskReady;
  }

  function slotKey(type, pageOrIndex, cellIndex) {
    if (type === 'grid') return 'grid:' + pageOrIndex + ':' + cellIndex;
    return 'dock:' + pageOrIndex;
  }

  function parseSlotEl(el) {
    if (!el) return null;
    var cell = el.closest('[data-custom-slot]');
    if (!cell) return null;
    var s = cell.getAttribute('data-custom-slot');
    if (!s) return null;
    var p = s.split(':');
    if (p[0] === 'grid') {
      return {
        type: 'grid',
        page: parseInt(p[1], 10) || 0,
        index: parseInt(p[2], 10) || 0,
        x: (parseInt(p[2], 10) || 0) % GRID_COLS,
        y: Math.floor((parseInt(p[2], 10) || 0) / GRID_COLS),
        cell: cell
      };
    }
    if (p[0] === 'dock') {
      return { type: 'dock', index: parseInt(p[1], 10), cell: cell };
    }
    return null;
  }

  function findItemAt(page, x, y) {
    if (!page || !page.items) return null;
    for (var i = 0; i < page.items.length; i++) {
      var it = page.items[i];
      if (it.x === x && it.y === y) return it;
    }
    return null;
  }

  function findItemById(page, id) {
    if (!page || !page.items || !id) return null;
    for (var i = 0; i < page.items.length; i++) {
      if (page.items[i].id === id) return page.items[i];
    }
    return null;
  }

  function getItemInSlot(layout, slot) {
    if (!slot) return null;
    if (slot.type === 'dock') return null;
    var page = layout.pages[slot.page];
    if (!page) return null;
    if (slot.itemId) return findItemById(page, slot.itemId);
    return findItemAt(page, slot.x, slot.y);
  }

  function slotFromItem(pageIndex, item) {
    return {
      type: 'grid',
      page: pageIndex,
      index: item.y * GRID_COLS + item.x,
      x: item.x,
      y: item.y,
      itemId: item.id
    };
  }

  function getAppInSlot(layout, slot) {
    if (!slot) return null;
    if (slot.type === 'dock') return layout.dockSlots[slot.index];
    var page = layout.pages[slot.page];
    if (!page) return null;
    var item = page.items.filter(function (it) {
      return it.kind === 'app' && it.x === slot.x && it.y === slot.y;
    })[0];
    return item ? item.key : null;
  }

  function pageIndexFromEl(el) {
    var pageEl = el && el.closest('[data-custom-page]');
    if (!pageEl) return currentPage;
    return parseInt(pageEl.getAttribute('data-custom-page'), 10) || currentPage;
  }

  function hasDragTarget(slot) {
    if (!slot) return false;
    if (slot.type === 'dock') return !!getLayout().dockSlots[slot.index];
    return !!getItemInSlot(getLayout(), slot);
  }

  function captureFixedDock() {
    if (fixedDockHtml) return;
    var dock = document.querySelector('.foot__dock');
    if (dock) fixedDockHtml = dock.innerHTML;
  }

  function restoreFixedDock() {
    var dock = document.querySelector('.foot__dock');
    if (dock && fixedDockHtml) {
      dock.innerHTML = fixedDockHtml;
      dock.classList.remove('foot__dock--custom');
      if (global.miyaFillAppIcons) global.miyaFillAppIcons(dock);
    }
  }

  function resolveTextColorMode(theme) {
    if (!theme) return 'black';
    if (theme.textColorMode === 'white' || theme.textColorMode === 'black') return theme.textColorMode;
    return 'black';
  }

  function applyCustomTextColor(theme) {
    var mode = resolveTextColorMode(theme);
    var ink = mode === 'white' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.88)';
    var inkSoft = mode === 'white' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(0, 0, 0, 0.65)';
    var inkFaint = mode === 'white' ? 'rgba(255, 255, 255, 0.52)' : 'rgba(0, 0, 0, 0.45)';
    document.documentElement.style.setProperty('--ink', ink);
    document.documentElement.style.setProperty('--ink-soft', inkSoft);
    document.documentElement.style.setProperty('--ink-faint', inkFaint);
    document.documentElement.style.setProperty('--miya-text', ink);
    document.documentElement.dataset.miyaTextMode = mode;
  }

  function applyWallToPhone(urlOrNull) {
    var wall = document.querySelector('.phone__wall');
    if (!wall) return;
    if (!urlOrNull) {
      wall.style.backgroundImage = '';
      wall.classList.remove('has-custom-wall');
      if (global.miyaRepaintGlass) global.miyaRepaintGlass();
      return;
    }
    wall.style.backgroundImage = 'url("' + String(urlOrNull).replace(/"/g, '%22') + '")';
    wall.style.backgroundSize = 'cover';
    wall.style.backgroundPosition = 'center';
    wall.classList.add('has-custom-wall');
    if (global.miyaRepaintGlass) global.miyaRepaintGlass();
  }

  function iconApplyHost(btn) {
    if (!btn) return null;
    var box = btn.querySelector('.ic__box');
    if (box) return { host: box, mode: 'grid' };
    var dockBtn = btn.querySelector('.foot__dock-btn');
    if (dockBtn) return { host: dockBtn, mode: 'dock' };
    return null;
  }

  function applyIconBg(btn, ref) {
    if (!btn) return Promise.resolve();
    var target = iconApplyHost(btn);
    if (!target) return Promise.resolve();
    var host = target.host;
    var existing = host.querySelector('.miya-icon-bg');
    if (!ref) {
      if (existing) existing.remove();
      btn.classList.remove('has-custom-icon');
      host.style.backgroundImage = '';
      if (target.mode === 'dock') btn.querySelectorAll('svg').forEach(function (s) { s.style.opacity = ''; });
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'miya-icon-bg';
        existing.setAttribute('aria-hidden', 'true');
        host.insertBefore(existing, host.firstChild);
      }
      existing.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      btn.classList.add('has-custom-icon');
      if (target.mode === 'dock') btn.querySelectorAll('svg').forEach(function (s) { s.style.opacity = '0'; });
    });
  }

  function createEmptyGridInner() {
    var el = document.createElement('span');
    el.className = 'desk-custom__empty';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="desk-custom__empty-ring"></span>';
    return el;
  }

  function createEmptyDockInner() {
    var el = document.createElement('span');
    el.className = 'foot__dock-slot__empty-inner';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="foot__dock-slot__ring"></span>';
    return el;
  }

  function createGridIcon(appKey) {
    var btn = document.createElement('button');
    btn.className = 'ic desk-custom__ic';
    btn.type = 'button';
    btn.setAttribute('data-app', appKey);
    btn.innerHTML =
      '<span class="ic__box glass" data-i="' + appKey + '"></span>' +
      '<span class="ic__lbl">' + (APP_LABELS[appKey] || appKey) + '</span>';
    return btn;
  }

  function createDockIcon(appKey) {
    var btn = document.createElement('button');
    btn.className = 'foot__dock-item desk-custom__dock-ic';
    btn.type = 'button';
    btn.setAttribute('data-app', appKey);
    btn.innerHTML =
      '<span class="foot__dock-btn"><span data-i="' + appKey + '"></span></span>' +
      '<span class="foot__dock-lbl">' + (APP_LABELS[appKey] || appKey) + '</span>';
    return btn;
  }

  function createBlankWidgetEl(widgetId, def) {
    var el = document.createElement('div');
    el.className = 'desk-custom__wg desk-custom__wg--blank desk-custom__wg--blank-v' + def.variant;
    el.setAttribute('data-widget-id', widgetId);
    el.innerHTML =
      '<span class="desk-custom__wg-blank-label">' + def.label + '</span>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createProfileWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-profile desk-custom__wg desk-custom__wg--profile';
    el.setAttribute('aria-label', '半醒手记');
    el.innerHTML =
      '<div class="wg-profile__cover" aria-hidden="true">' +
        '<div class="wg-profile__cover-bg"></div>' +
      '</div>' +
      '<div class="wg-profile__body">' +
        '<div class="wg-profile__avatar desk-custom__wg-avatar" aria-hidden="true"></div>' +
        '<div class="wg-profile__info">' +
          '<h2 class="wg-profile__name" data-miya-copy="profileName">半醒手记</h2>' +
          '<p class="wg-profile__bio" data-miya-copy="profileBio">白日太长，适合慢慢过</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createMemoWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-memo desk-custom__wg desk-custom__wg--memo';
    el.setAttribute('aria-label', 'MEMO');
    el.innerHTML =
      '<div class="wg-memo__pair">' +
        '<div class="wg-memo__person">' +
          '<p class="wg-memo__bubble" data-miya-copy="memoLine1"><span class="wg-memo__label">01</span> 猫在键盘上踩字</p>' +
          '<div class="wg-memo__ava" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="wg-memo__person">' +
          '<p class="wg-memo__bubble" data-miya-copy="memoLine2"><span class="wg-memo__label">02</span> 冰箱还有布丁</p>' +
          '<div class="wg-memo__ava" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<div class="wg-memo__days">' +
        '<span class="wg-memo__wing wg-memo__wing--l" aria-hidden="true"></span>' +
        '<p class="wg-memo__pill" data-miya-copy="memoLine3"><span class="wg-memo__label">03</span> 别忘记交电费</p>' +
        '<span class="wg-memo__wing wg-memo__wing--r" aria-hidden="true"></span>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createPolaroidWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-polaroid desk-custom__wg desk-custom__wg--polaroid';
    el.setAttribute('aria-label', '拍立得');
    el.innerHTML =
      '<div class="wg-polaroid__stack">' +
        '<div class="wg-polaroid__card wg-polaroid__card--3" aria-hidden="true">' +
          '<div class="wg-polaroid__photo"></div>' +
          '<p class="wg-polaroid__cap" data-miya-copy="polaroidCap3">archive · 02</p>' +
        '</div>' +
        '<div class="wg-polaroid__card wg-polaroid__card--2" aria-hidden="true">' +
          '<div class="wg-polaroid__photo wg-polaroid__photo--b"></div>' +
          '<p class="wg-polaroid__cap" data-miya-copy="polaroidCap2">window seat</p>' +
        '</div>' +
        '<div class="wg-polaroid__card wg-polaroid__card--1">' +
          '<span class="wg-polaroid__tape" aria-hidden="true"></span>' +
          '<div class="wg-polaroid__photo wg-polaroid__photo--c"></div>' +
          '<p class="wg-polaroid__cap" data-miya-copy="polaroidCap1">三楼拐角见</p>' +
          '<span class="wg-polaroid__date" data-miya-copy="polaroidDate">24.06.02</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createFilmstripWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--filmstrip desk-custom__wg desk-custom__wg--filmstrip';
    el.setAttribute('aria-label', '胶片行记');
    el.innerHTML =
      '<div class="wg-4x1-film">' +
        '<div class="wg-4x1-film__holes wg-4x1-film__holes--t" aria-hidden="true"></div>' +
        '<div class="wg-4x1-film__body">' +
          '<div class="wg-4x1-film__frame"><div class="wg-4x1-film__photo"></div></div>' +
          '<div class="wg-4x1-film__meta">' +
            '<p class="wg-4x1-film__title">午后底片</p>' +
            '<p class="wg-4x1-film__note">frame · 07 / soft light</p>' +
          '</div>' +
        '</div>' +
        '<div class="wg-4x1-film__holes wg-4x1-film__holes--b" aria-hidden="true"></div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createWaveWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--wave desk-custom__wg desk-custom__wg--wave';
    el.setAttribute('aria-label', '余白浪');
    el.innerHTML =
      '<div class="wg-4x1-wave">' +
        '<div class="wg-4x1-wave__content">' +
          '<span class="wg-4x1-wave__tag">daily</span>' +
          '<h3 class="wg-4x1-wave__title">留白也是答案</h3>' +
        '</div>' +
        '<div class="wg-4x1-wave__photo-wrap">' +
          '<div class="wg-4x1-wave__photo"></div>' +
          '<span class="wg-4x1-wave__ring" aria-hidden="true"></span>' +
        '</div>' +
        '<svg class="wg-4x1-wave__curve" viewBox="0 0 360 18" preserveAspectRatio="none" aria-hidden="true">' +
          '<path d="M0,8 C60,18 120,0 180,8 C240,16 300,2 360,10 L360,18 L0,18 Z"></path>' +
        '</svg>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createTicketWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--ticket desk-custom__wg desk-custom__wg--ticket';
    el.setAttribute('aria-label', '慢票根');
    el.innerHTML =
      '<div class="wg-4x1-ticket">' +
        '<div class="wg-4x1-ticket__stub">' +
          '<div class="wg-4x1-ticket__photo"></div>' +
          '<span class="wg-4x1-ticket__code">NO.042</span>' +
        '</div>' +
        '<div class="wg-4x1-ticket__tear" aria-hidden="true"></div>' +
        '<div class="wg-4x1-ticket__main">' +
          '<p class="wg-4x1-ticket__title">慢车月台</p>' +
          '<p class="wg-4x1-ticket__date">06 · 28 · sun</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createTicketphotoWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--ticketphoto desk-custom__wg desk-custom__wg--ticketphoto';
    el.setAttribute('aria-label', '纯照片');
    el.innerHTML =
      '<div class="wg-4x1-ticketphoto">' +
        '<div class="wg-4x1-ticketphoto__photo"></div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createOrbitWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--orbit desk-custom__wg desk-custom__wg--orbit';
    el.setAttribute('aria-label', '轨道相');
    el.innerHTML =
      '<div class="wg-4x1-orbit">' +
        '<div class="wg-4x1-orbit__visual">' +
          '<span class="wg-4x1-orbit__ring" aria-hidden="true"></span>' +
          '<div class="wg-4x1-orbit__photo"></div>' +
        '</div>' +
        '<div class="wg-4x1-orbit__copy">' +
          '<p class="wg-4x1-orbit__name">orbit diary</p>' +
          '<p class="wg-4x1-orbit__mood">floating calm</p>' +
          '<span class="wg-4x1-orbit__dotline" aria-hidden="true"></span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createLedgerWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--ledger desk-custom__wg desk-custom__wg--ledger';
    el.setAttribute('aria-label', '细账簿');
    el.innerHTML =
      '<div class="wg-4x1-ledger">' +
        '<div class="wg-4x1-ledger__left">' +
          '<div class="wg-4x1-ledger__photo"></div>' +
          '<span class="wg-4x1-ledger__clip" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="wg-4x1-ledger__fold" aria-hidden="true"></div>' +
        '<div class="wg-4x1-ledger__right">' +
          '<div class="wg-4x1-ledger__rules" aria-hidden="true"></div>' +
          '<p class="wg-4x1-ledger__line1">今日消费：一杯冰美式</p>' +
          '<p class="wg-4x1-ledger__line2">备注：窗边的位置最好</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createPlayerWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--player desk-custom__wg desk-custom__wg--player';
    el.setAttribute('aria-label', '音轨舱');
    el.innerHTML =
      '<div class="wg-4x2-player">' +
        '<div class="wg-4x2-player__disc-wrap">' +
          '<div class="wg-4x2-player__cover"></div>' +
          '<div class="wg-4x2-player__disc" aria-hidden="true"></div>' +
        '</div>' +
        '<div class="wg-4x2-player__panel">' +
          '<p class="wg-4x2-player__track">慢速浪漫</p>' +
          '<p class="wg-4x2-player__artist">miya playlist</p>' +
          '<div class="wg-4x2-player__bars" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span><span></span><span></span>' +
            '<span></span><span></span><span></span><span></span><span></span><span></span>' +
          '</div>' +
          '<div class="wg-4x2-player__progress"><span class="wg-4x2-player__progress-fill"></span></div>' +
          '<div class="wg-4x2-player__ctrl">' +
            '<span class="wg-4x2-player__time">1:24 / 3:48</span>' +
            '<button type="button" class="wg-4x2-player__play" aria-hidden="true">▶</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createDialogueWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--dialogue desk-custom__wg desk-custom__wg--dialogue';
    el.setAttribute('aria-label', '对白轴');
    el.innerHTML =
      '<div class="wg-4x2-dialogue">' +
        '<div class="wg-4x2-dialogue__rows">' +
          '<div class="wg-4x2-dialogue__row wg-4x2-dialogue__row--a">' +
            '<div class="wg-4x2-dialogue__ava wg-4x2-dialogue__ava--a"></div>' +
            '<p class="wg-4x2-dialogue__bubble wg-4x2-dialogue__bubble--a wg-4x2-dialogue__bubble--1">今晚有空吗，想去看海</p>' +
          '</div>' +
          '<div class="wg-4x2-dialogue__row wg-4x2-dialogue__row--b">' +
            '<p class="wg-4x2-dialogue__bubble wg-4x2-dialogue__bubble--b wg-4x2-dialogue__bubble--2">好呀，我带胶片机</p>' +
            '<div class="wg-4x2-dialogue__ava wg-4x2-dialogue__ava--b"></div>' +
          '</div>' +
          '<div class="wg-4x2-dialogue__row wg-4x2-dialogue__row--a">' +
            '<div class="wg-4x2-dialogue__ava wg-4x2-dialogue__ava--a"></div>' +
            '<p class="wg-4x2-dialogue__bubble wg-4x2-dialogue__bubble--a wg-4x2-dialogue__bubble--3">记得穿浅色衣服</p>' +
          '</div>' +
        '</div>' +
        '<span class="wg-4x2-dialogue__time">22:04</span>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createMagazineWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--magazine desk-custom__wg desk-custom__wg--magazine';
    el.setAttribute('aria-label', '刊面包');
    el.innerHTML =
      '<div class="wg-4x2-mag">' +
        '<div class="wg-4x2-mag__hero">' +
          '<div class="wg-4x2-mag__photo"></div>' +
          '<span class="wg-4x2-mag__tag">vol.03</span>' +
        '</div>' +
        '<div class="wg-4x2-mag__foot">' +
          '<h3 class="wg-4x2-mag__headline">城市里的慢快门</h3>' +
          '<p class="wg-4x2-mag__sub">editorial · summer issue</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInstprofileWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--instprofile desk-custom__wg desk-custom__wg--instprofile';
    el.setAttribute('aria-label', 'INS主页');
    el.innerHTML =
      '<div class="wg-4x2-ins">' +
        '<div class="wg-4x2-ins__top">' +
          '<span class="wg-4x2-ins__username">miya.daily</span>' +
          '<span class="wg-4x2-ins__menu" aria-hidden="true">' +
            '<span></span><span></span><span></span>' +
          '</span>' +
        '</div>' +
        '<div class="wg-4x2-ins__head">' +
          '<div class="wg-4x2-ins__avatar-wrap">' +
            '<div class="wg-4x2-ins__avatar"></div>' +
            '<span class="wg-4x2-ins__ring" aria-hidden="true"></span>' +
          '</div>' +
          '<p class="wg-4x2-ins__stats">128 posts · 2.4k followers · 892 following</p>' +
        '</div>' +
        '<p class="wg-4x2-ins__bio">记录慢生活与审美碎片</p>' +
        '<div class="wg-4x2-ins__grid">' +
          '<div class="wg-4x2-ins__post wg-4x2-ins__post--1"></div>' +
          '<div class="wg-4x2-ins__post wg-4x2-ins__post--2"></div>' +
          '<div class="wg-4x2-ins__post wg-4x2-ins__post--3"></div>' +
        '</div>' +
        '<div class="wg-4x2-ins__tabs" aria-hidden="true">' +
          '<span class="wg-4x2-ins__tab is-active"></span>' +
          '<span class="wg-4x2-ins__tab"></span>' +
          '<span class="wg-4x2-ins__tab"></span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createGlassdeckWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--glassdeck desk-custom__wg desk-custom__wg--glassdeck';
    el.setAttribute('aria-label', '浮光拼贴');
    el.innerHTML =
      '<div class="wg-4x2-glass">' +
        '<span class="wg-4x2-glass__orb wg-4x2-glass__orb--1" aria-hidden="true"></span>' +
        '<span class="wg-4x2-glass__orb wg-4x2-glass__orb--2" aria-hidden="true"></span>' +
        '<span class="wg-4x2-glass__spark wg-4x2-glass__spark--1" aria-hidden="true">✦</span>' +
        '<span class="wg-4x2-glass__spark wg-4x2-glass__spark--2" aria-hidden="true">♡</span>' +
        '<span class="wg-4x2-glass__spark wg-4x2-glass__spark--3" aria-hidden="true">✧</span>' +
        '<span class="wg-4x2-glass__dash" aria-hidden="true"></span>' +
        '<div class="wg-4x2-glass__cluster">' +
          '<div class="wg-4x2-glass__frame">' +
            '<div class="wg-4x2-glass__photo"></div>' +
            '<span class="wg-4x2-glass__corner wg-4x2-glass__corner--tl" aria-hidden="true"></span>' +
            '<span class="wg-4x2-glass__corner wg-4x2-glass__corner--br" aria-hidden="true"></span>' +
          '</div>' +
          '<span class="wg-4x2-glass__tape" aria-hidden="true"></span>' +
          '<div class="wg-4x2-glass__panel">' +
            '<span class="wg-4x2-glass__tag">soft mood</span>' +
            '<p class="wg-4x2-glass__quote">把日常过成可以收藏的样子</p>' +
            '<span class="wg-4x2-glass__sticker">daily archive</span>' +
          '</div>' +
        '</div>' +
        '<span class="wg-4x2-glass__dotline" aria-hidden="true"></span>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createAvalinkWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--avalink desk-custom__wg desk-custom__wg--avalink';
    el.setAttribute('aria-label', '双头像连线');
    el.innerHTML =
      '<div class="wg-4x2-avalink">' +
        '<div class="wg-4x2-avalink__stage">' +
          '<svg class="wg-4x2-avalink__wire" viewBox="0 0 340 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
            '<path d="M8 50 H16 M20 50 C26 50 28 24 56 24 C84 24 86 50 92 50 H118 C124 50 128 28 142 24 C150 28 154 36 158 42 C162 36 166 28 174 24 C188 28 192 50 198 50 H224 L228 44 L232 56 L236 40 L240 52 L244 48 H270 C276 50 278 24 306 24 C334 24 336 50 342 50 H350" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M154 40 C154 34 160 30 166 34 C172 30 178 34 178 40 C178 48 166 56 166 56 C166 56 154 48 154 40 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
            '<circle cx="18" cy="50" r="3.2" fill="currentColor"/>' +
            '<circle cx="322" cy="50" r="3.2" fill="currentColor"/>' +
          '</svg>' +
          '<div class="wg-4x2-avalink__ava wg-4x2-avalink__ava--1">' +
            '<div class="wg-4x2-avalink__photo"></div>' +
          '</div>' +
          '<div class="wg-4x2-avalink__ava wg-4x2-avalink__ava--2">' +
            '<div class="wg-4x2-avalink__photo"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createMooddiaryWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--mooddiary desk-custom__wg desk-custom__wg--mooddiary';
    el.setAttribute('aria-label', '心情日记');
    el.innerHTML =
      '<div class="wg-4x1-mooddiary">' +
        '<span class="wg-4x1-mooddiary__back" aria-hidden="true"></span>' +
        '<div class="wg-4x1-mooddiary__avatar"></div>' +
        '<div class="wg-4x1-mooddiary__main">' +
          '<div class="wg-4x1-mooddiary__top">' +
            '<span class="wg-4x1-mooddiary__head-title">日记</span>' +
            '<span class="wg-4x1-mooddiary__username">miya</span>' +
          '</div>' +
          '<p class="wg-4x1-mooddiary__body">把今天发生的小事，留在这里。</p>' +
        '</div>' +
        '<div class="wg-4x1-mooddiary__aside">' +
        '<span class="wg-4x1-mooddiary__stamp">' + escapeWidgetText(formatMooddiaryStamp()) + '</span>' +
        '<div class="wg-4x1-mooddiary__actions" aria-hidden="true">' +
          '<span class="wg-4x1-mooddiary__icon wg-4x1-mooddiary__icon--like"></span>' +
          '<span class="wg-4x1-mooddiary__icon wg-4x1-mooddiary__icon--save"></span>' +
        '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createWeekmoodWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x1 wg-4x1--weekmood desk-custom__wg desk-custom__wg--weekmood';
    el.setAttribute('aria-label', '周历心情');
    el.innerHTML =
      '<div class="wg-4x1-weekmood">' +
        '<div class="wg-4x1-weekmood__avatar"></div>' +
        '<div class="wg-4x1-weekmood__copy">' +
          '<p class="wg-4x1-weekmood__line1">今天也要慢慢来</p>' +
          '<p class="wg-4x1-weekmood__line2">meet slowly.</p>' +
        '</div>' +
        '<div class="wg-4x1-weekmood__week">' +
          '<div class="wg-4x1-weekmood__days">' +
            '<span class="wg-4x1-weekmood__day">SUN</span>' +
            '<span class="wg-4x1-weekmood__day">MON</span>' +
            '<span class="wg-4x1-weekmood__day">TUE</span>' +
            '<span class="wg-4x1-weekmood__day">WED</span>' +
            '<span class="wg-4x1-weekmood__day">THU</span>' +
            '<span class="wg-4x1-weekmood__day">FRI</span>' +
            '<span class="wg-4x1-weekmood__day">SAT</span>' +
          '</div>' +
          '<span class="wg-4x1-weekmood__paw" aria-hidden="true"></span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    paintWeekmoodBar(el);
    return el;
  }

  function createPhotowallWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x3 wg-4x3--photowall desk-custom__wg desk-custom__wg--photowall';
    el.setAttribute('aria-label', '照片墙');
    el.innerHTML =
      '<div class="wg-4x3-wall">' +
        '<div class="wg-4x3-wall__mosaic">' +
          '<span class="wg-4x3-wall__tape wg-4x3-wall__tape--1" aria-hidden="true"></span>' +
          '<span class="wg-4x3-wall__tape wg-4x3-wall__tape--2" aria-hidden="true"></span>' +
          '<div class="wg-4x3-wall__tile wg-4x3-wall__tile--hero">' +
            '<div class="wg-4x3-wall__photo"></div>' +
            '<p class="wg-4x3-wall__cap wg-4x3-wall__cap--1">our first date</p>' +
          '</div>' +
          '<div class="wg-4x3-wall__tile wg-4x3-wall__tile--b"><div class="wg-4x3-wall__photo"></div></div>' +
          '<div class="wg-4x3-wall__tile wg-4x3-wall__tile--c">' +
            '<div class="wg-4x3-wall__photo"></div>' +
            '<p class="wg-4x3-wall__cap wg-4x3-wall__cap--2">coffee &amp; rain</p>' +
          '</div>' +
          '<div class="wg-4x3-wall__tile wg-4x3-wall__tile--d"><div class="wg-4x3-wall__photo"></div></div>' +
          '<div class="wg-4x3-wall__tile wg-4x3-wall__tile--e">' +
            '<div class="wg-4x3-wall__photo"></div>' +
            '<p class="wg-4x3-wall__cap wg-4x3-wall__cap--3">always us</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createCalendarWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x3 wg-4x3--calendar desk-custom__wg desk-custom__wg--calendar';
    el.setAttribute('aria-label', '月历志');
    el.innerHTML =
      '<div class="wg-4x3-cal">' +
        '<header class="wg-4x3-cal__head">' +
          '<div class="wg-4x3-cal__mast">' +
            '<span class="wg-4x3-cal__month">六月</span>' +
            '<span class="wg-4x3-cal__year">2026</span>' +
          '</div>' +
          '<div class="wg-4x3-cal__avatar"><div class="wg-4x3-cal__photo"></div></div>' +
        '</header>' +
        '<section class="wg-4x3-cal__hero">' +
          '<span class="wg-4x3-cal__daynum">28</span>' +
          '<div class="wg-4x3-cal__meta">' +
            '<span class="wg-4x3-cal__weekday">SUN</span>' +
            '<span class="wg-4x3-cal__tag">today</span>' +
          '</div>' +
        '</section>' +
        '<section class="wg-4x3-cal__week">' +
          '<div class="wg-4x3-cal__weekhead">' +
            '<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>' +
          '</div>' +
          '<div class="wg-4x3-cal__weekrow"></div>' +
        '</section>' +
        '<p class="wg-4x3-cal__note">把寻常日子，过成慢镜头</p>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createJournalWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x3 wg-4x3--journal desk-custom__wg desk-custom__wg--journal';
    el.setAttribute('aria-label', '私人账册');
    el.innerHTML =
      '<div class="wg-4x3-journal">' +
        '<div class="wg-4x3-journal__face">' +
          '<div class="wg-4x3-journal__substrate" aria-hidden="true">' +
            '<div class="wg-4x3-journal__leaf wg-4x3-journal__leaf--3">' +
              '<div class="wg-4x3-journal__leaf-art"></div>' +
            '</div>' +
            '<div class="wg-4x3-journal__leaf wg-4x3-journal__leaf--2">' +
              '<div class="wg-4x3-journal__leaf-art"></div>' +
            '</div>' +
          '</div>' +
          '<div class="wg-4x3-journal__sheet">' +
            '<div class="wg-4x3-journal__sheet-art" aria-hidden="true"></div>' +
            '<div class="wg-4x3-journal__grain" aria-hidden="true"></div>' +
            '<div class="wg-4x3-journal__ruled" aria-hidden="true"></div>' +
            '<div class="wg-4x3-journal__margin-line" aria-hidden="true"></div>' +
            '<div class="wg-4x3-journal__foil" aria-hidden="true"></div>' +
            '<header class="wg-4x3-journal__head">' +
              '<div class="wg-4x3-journal__brand">' +
                '<span class="wg-4x3-journal__eyebrow">Private Ledger</span>' +
                '<span class="wg-4x3-journal__serial">№ 2026·06</span>' +
              '</div>' +
              '<div class="wg-4x3-journal__datechip">' +
                '<time class="wg-4x3-journal__day">06</time>' +
                '<div class="wg-4x3-journal__datemeta">' +
                  '<span class="wg-4x3-journal__mon">JUN</span>' +
                  '<span class="wg-4x3-journal__dow">SAT</span>' +
                '</div>' +
              '</div>' +
            '</header>' +
            '<div class="wg-4x3-journal__cols" aria-hidden="true">' +
              '<span>DATE</span><span>ENTRY</span><span>AMT</span>' +
            '</div>' +
            '<ul class="wg-4x3-journal__rows">' +
              '<li>' +
                '<span class="wg-4x3-journal__row-date">06</span>' +
                '<span class="wg-4x3-journal__row-item">夜间咖啡</span>' +
                '<span class="wg-4x3-journal__row-amt">−28</span>' +
              '</li>' +
              '<li>' +
                '<span class="wg-4x3-journal__row-date">05</span>' +
                '<span class="wg-4x3-journal__row-item">稿费入账</span>' +
                '<span class="wg-4x3-journal__row-amt wg-4x3-journal__row-amt--plus">+640</span>' +
              '</li>' +
              '<li>' +
                '<span class="wg-4x3-journal__row-date">04</span>' +
                '<span class="wg-4x3-journal__row-item">胶片冲洗</span>' +
                '<span class="wg-4x3-journal__row-amt">−86</span>' +
              '</li>' +
            '</ul>' +
            '<footer class="wg-4x3-journal__foot">' +
              '<span class="wg-4x3-journal__balance-lbl">Balance</span>' +
              '<span class="wg-4x3-journal__balance">526.00</span>' +
              '<span class="wg-4x3-journal__currency">CNY</span>' +
            '</footer>' +
            '<div class="wg-4x3-journal__seal" aria-hidden="true"><span>记</span></div>' +
            '<div class="wg-4x3-journal__corner-mark" aria-hidden="true">◆</div>' +
          '</div>' +
          '<div class="wg-4x3-journal__receipt" aria-hidden="true">' +
            '<div class="wg-4x3-journal__receipt-perf"></div>' +
            '<span class="wg-4x3-journal__receipt-tag">Receipt</span>' +
            '<span class="wg-4x3-journal__receipt-line"></span>' +
            '<span class="wg-4x3-journal__receipt-amt">28.00</span>' +
          '</div>' +
          '<div class="wg-4x3-journal__clip" aria-hidden="true"></div>' +
          '<div class="wg-4x3-journal__shadow" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createMomentWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x3 wg-4x3--moment desk-custom__wg desk-custom__wg--moment';
    el.setAttribute('aria-label', 'INS动态');
    el.innerHTML =
      '<div class="wg-4x3-moment">' +
        '<div class="wg-4x3-moment__shell">' +
          '<div class="wg-4x3-moment__pattern" aria-hidden="true"></div>' +
          '<header class="wg-4x3-moment__bar">' +
            '<span class="wg-4x3-moment__deco wg-4x3-moment__deco--heart">♡</span>' +
            '<span class="wg-4x3-moment__bar-spark">✦</span>' +
          '</header>' +
          '<div class="wg-4x3-moment__media">' +
            '<div class="wg-4x3-moment__hero"></div>' +
            '<span class="wg-4x3-moment__float wg-4x3-moment__float--a">✧</span>' +
            '<span class="wg-4x3-moment__float wg-4x3-moment__float--b">♡</span>' +
          '</div>' +
          '<div class="wg-4x3-moment__bubble">' +
            '<div class="wg-4x3-moment__user">' +
              '<div class="wg-4x3-moment__accent"></div>' +
              '<div class="wg-4x3-moment__ids">' +
                '<span class="wg-4x3-moment__sub">dustmoth.lab</span>' +
                '<span class="wg-4x3-moment__title">SECTOR NINE</span>' +
              '</div>' +
            '</div>' +
            '<p class="wg-4x3-moment__quote">The vending machine issued a passport. I said nothing.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createBadgepinWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--badgepin desk-custom__wg desk-custom__wg--badgepin';
    el.setAttribute('aria-label', '吧唧相');
    el.innerHTML =
      '<div class="wg-2x2-badge">' +
        '<div class="wg-2x2-badge__scene">' +
          '<span class="wg-2x2-badge__sparkle wg-2x2-badge__sparkle--1" aria-hidden="true"></span>' +
          '<span class="wg-2x2-badge__sparkle wg-2x2-badge__sparkle--2" aria-hidden="true"></span>' +
          '<div class="wg-2x2-badge__mini">' +
            '<div class="wg-2x2-badge__mini-face">' +
              '<div class="wg-2x2-badge__mini-photo"></div>' +
            '</div>' +
            '<span class="wg-2x2-badge__mini-pin" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="wg-2x2-badge__main">' +
            '<div class="wg-2x2-badge__main-face">' +
              '<div class="wg-2x2-badge__main-photo"></div>' +
              '<span class="wg-2x2-badge__shine" aria-hidden="true"></span>' +
            '</div>' +
            '<span class="wg-2x2-badge__pinback" aria-hidden="true"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createVinylWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--vinyl desk-custom__wg desk-custom__wg--vinyl';
    el.setAttribute('aria-label', '黑胶碟');
    el.innerHTML =
      '<div class="wg-2x2-vinyl">' +
        '<div class="wg-2x2-vinyl__deck">' +
          '<div class="wg-2x2-vinyl__platter">' +
            '<div class="wg-2x2-vinyl__disc">' +
              '<div class="wg-2x2-vinyl__label"></div>' +
              '<span class="wg-2x2-vinyl__spindle" aria-hidden="true"></span>' +
            '</div>' +
            '<div class="wg-2x2-vinyl__tonearm" aria-hidden="true">' +
              '<span class="wg-2x2-vinyl__tonearm-head"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createSleeveWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--sleeve desk-custom__wg desk-custom__wg--sleeve';
    el.setAttribute('aria-label', '透明卡套');
    el.innerHTML =
      '<div class="wg-2x2-sleeve">' +
        '<span class="wg-2x2-sleeve__clip" aria-hidden="true"></span>' +
        '<div class="wg-2x2-sleeve__pouch">' +
          '<div class="wg-2x2-sleeve__card">' +
            '<div class="wg-2x2-sleeve__photo"></div>' +
          '</div>' +
          '<span class="wg-2x2-sleeve__tape" aria-hidden="true"></span>' +
          '<span class="wg-2x2-sleeve__sheen" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="wg-2x2-sleeve__note">' +
          '<span class="wg-2x2-sleeve__tag">photocard</span>' +
          '<p class="wg-2x2-sleeve__name">window light</p>' +
          '<p class="wg-2x2-sleeve__caption">06 · archive</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createFramephotoWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--framephoto desk-custom__wg desk-custom__wg--framephoto';
    el.setAttribute('aria-label', '纯照片');
    el.innerHTML =
      '<div class="wg-2x2-framephoto">' +
        '<div class="wg-2x2-framephoto__frame">' +
          '<div class="wg-2x2-framephoto__photo"></div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createScrolllyricsWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x2 wg-4x2--scrolllyrics desk-custom__wg desk-custom__wg--scrolllyrics';
    el.setAttribute('aria-label', '滚动歌词');
    el.innerHTML =
      '<div class="wg-4x2-lyrics wg-4x2-lyrics--gray">' +
        '<div class="wg-4x2-lyrics__device">' +
          '<div class="wg-4x2-lyrics__screen">' +
            '<span class="wg-4x2-lyrics__title">《浅眠循环》</span>' +
            '<div class="wg-4x2-lyrics__lines">' +
              '<p class="wg-4x2-lyrics__prev">把噪音关在门外</p>' +
              '<p class="wg-4x2-lyrics__curr">把呼吸放慢\n跟着节拍沉降</p>' +
              '<p class="wg-4x2-lyrics__next">窗外天色渐暗</p>' +
              '<p class="wg-4x2-lyrics__dim">醒来仍是好天气</p>' +
            '</div>' +
          '</div>' +
          '<div class="wg-4x2-lyrics__wheel-zone">' +
            '<div class="wg-4x2-lyrics__wheel" aria-hidden="true">' +
              '<span class="wg-4x2-lyrics__wheel-menu">MENU</span>' +
              '<span class="wg-4x2-lyrics__wheel-prev">|◀◀</span>' +
              '<span class="wg-4x2-lyrics__wheel-next">▶▶|</span>' +
              '<span class="wg-4x2-lyrics__wheel-play">▶<span class="wg-4x2-lyrics__pause-bars"></span></span>' +
              '<span class="wg-4x2-lyrics__wheel-center"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInspairWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x4 wg-4x4--inspair desk-custom__wg desk-custom__wg--inspair';
    el.setAttribute('aria-label', '双人ins风头像');
    el.innerHTML =
      '<div class="wg-4x4-pair">' +
        '<div class="wg-4x4-pair__cover" aria-hidden="true"></div>' +
        '<div class="wg-4x4-pair__sheet">' +
          '<div class="wg-4x4-pair__avatars">' +
            '<div class="wg-4x4-pair__person">' +
              '<div class="wg-4x4-pair__ava wg-4x4-pair__ava--1"></div>' +
              '<span class="wg-4x4-pair__name wg-4x4-pair__name--1">miya._</span>' +
            '</div>' +
            '<div class="wg-4x4-pair__person">' +
              '<div class="wg-4x4-pair__ava wg-4x4-pair__ava--2"></div>' +
              '<span class="wg-4x4-pair__name wg-4x4-pair__name--2">you.zz</span>' +
            '</div>' +
          '</div>' +
          '<p class="wg-4x4-pair__quote">— ♡ 我的世界很小，刚刚好装下你 —</p>' +
          '<p class="wg-4x4-pair__loc"><span class="wg-4x4-pair__pin" aria-hidden="true"></span><span>上海 · 外滩</span></p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInshomeWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x4 wg-4x4--inshome desk-custom__wg desk-custom__wg--inshome';
    el.setAttribute('aria-label', '灰白ins主页');
    el.innerHTML =
      '<div class="wg-4x4-home">' +
        '<header class="wg-4x4-home__head">' +
          '<div class="wg-4x4-home__ava-wrap">' +
            '<div class="wg-4x4-home__ava"></div>' +
            '<span class="wg-4x4-home__time">14:32</span>' +
            '<span class="wg-4x4-home__cam" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="wg-4x4-home__profile">' +
            '<div class="wg-4x4-home__name-row">' +
              '<span class="wg-4x4-home__user">miya ♡₊˚</span>' +
              '<span class="wg-4x4-home__album" aria-hidden="true"></span>' +
            '</div>' +
            '<p class="wg-4x4-home__bio">★ ‹ 把琐碎过成诗 ›</p>' +
            '<span class="wg-4x4-home__date">2026/07/02 THU</span>' +
          '</div>' +
        '</header>' +
        '<div class="wg-4x4-home__rule" aria-hidden="true"></div>' +
        '<div class="wg-4x4-home__plog">' +
          '<span class="wg-4x4-home__plog-title">「plog ✨ ʚɞ ˚ !! ♪」</span>' +
          '<span class="wg-4x4-home__plog-arrow">›</span>' +
        '</div>' +
        '<div class="wg-4x4-home__grid">' +
          '<div class="wg-4x4-home__post wg-4x4-home__post--1"></div>' +
          '<div class="wg-4x4-home__post wg-4x4-home__post--2"></div>' +
          '<div class="wg-4x4-home__post wg-4x4-home__post--3"></div>' +
        '</div>' +
        '<div class="wg-4x4-home__anniv">' +
          '<span class="wg-4x4-home__anniv-left">💕 · · 距离见面 还有</span>' +
          '<span class="wg-4x4-home__days">128 days</span>' +
        '</div>' +
        '<div class="wg-4x4-home__bubble">' +
          '<p class="wg-4x4-home__quote">世界很吵，但你是我的安静。</p>' +
          '<div class="wg-4x4-home__icons" aria-hidden="true">' +
            '<span>@</span><span class="wg-4x4-home__icon-chat"></span><span>♡</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createWxmomentsWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x4 wg-4x4--wxmoments desk-custom__wg desk-custom__wg--wxmoments';
    el.setAttribute('aria-label', '朋友圈');
    el.innerHTML =
      '<div class="wg-4x4-wx">' +
        '<div class="wg-4x4-wx__header">' +
          '<div class="wg-4x4-wx__cover-img"></div>' +
          '<span class="wg-4x4-wx__nick">miya</span>' +
          '<div class="wg-4x4-wx__avatar"></div>' +
        '</div>' +
        '<div class="wg-4x4-wx__feed">' +
          '<p class="wg-4x4-wx__sign">把琐碎的日子过成诗</p>' +
          '<div class="wg-4x4-wx__moment">' +
            '<div class="wg-4x4-wx__moment-ava"></div>' +
            '<div class="wg-4x4-wx__moment-body">' +
              '<span class="wg-4x4-wx__moment-name">miya</span>' +
              '<p class="wg-4x4-wx__moment-text">今天天气很好，想把这片云分享给你。</p>' +
              '<div class="wg-4x4-wx__moment-photo is-hidden"></div>' +
              '<span class="wg-4x4-wx__moment-time">2分钟前</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInstripleWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-4x4 wg-4x4--instriple desk-custom__wg desk-custom__wg--instriple';
    el.setAttribute('aria-label', '四列胶囊');
    el.innerHTML =
      '<div class="wg-4x4-triple">' +
        '<div class="wg-4x4-triple__photo"></div>' +
        '<div class="wg-4x4-triple__photo"></div>' +
        '<div class="wg-4x4-triple__photo"></div>' +
        '<div class="wg-4x4-triple__photo"></div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createPostcardWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--postcard desk-custom__wg desk-custom__wg--postcard';
    el.setAttribute('aria-label', '明信片');
    el.innerHTML =
      '<div class="wg-2x2-postcard">' +
        '<div class="wg-2x2-postcard__stack">' +
          '<div class="wg-2x2-postcard__card wg-2x2-postcard__card--back" aria-hidden="true"></div>' +
          '<div class="wg-2x2-postcard__card wg-2x2-postcard__card--front">' +
            '<span class="wg-2x2-postcard__stamp" aria-hidden="true"></span>' +
            '<div class="wg-2x2-postcard__photo"></div>' +
            '<p class="wg-2x2-postcard__message">愿你在每一个寻常日子，都能被温柔接住。</p>' +
            '<span class="wg-2x2-postcard__to">to · miya</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createFolderWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--folder desk-custom__wg desk-custom__wg--folder';
    el.setAttribute('aria-label', '波点文件夹');
    el.innerHTML =
      '<div class="wg-2x2-folder">' +
        '<div class="wg-2x2-folder__shell">' +
          '<div class="wg-2x2-folder__tab">' +
            '<span class="wg-2x2-folder__heart" aria-hidden="true">♥</span>' +
          '</div>' +
          '<div class="wg-2x2-folder__body">' +
            '<div class="wg-2x2-folder__window">' +
              '<div class="wg-2x2-folder__photo"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createMiniplayerWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x2 wg-2x2--miniplayer desk-custom__wg desk-custom__wg--miniplayer';
    el.setAttribute('aria-label', '音乐播放器');
    el.innerHTML =
      '<div class="wg-2x2-miniplayer">' +
        '<div class="wg-2x2-miniplayer__disc">' +
          '<div class="wg-2x2-miniplayer__cover"></div>' +
        '</div>' +
        '<div class="wg-2x2-miniplayer__panel">' +
          '<div class="wg-2x2-miniplayer__panel-inner">' +
            '<div class="wg-2x2-miniplayer__thumb"></div>' +
            '<div class="wg-2x2-miniplayer__meta">' +
              '<div class="wg-2x2-miniplayer__transport" aria-hidden="true">' +
                '<span class="wg-2x2-miniplayer__btn wg-2x2-miniplayer__btn--prev"></span>' +
                '<span class="wg-2x2-miniplayer__btn wg-2x2-miniplayer__btn--pause"></span>' +
                '<span class="wg-2x2-miniplayer__btn wg-2x2-miniplayer__btn--next"></span>' +
              '</div>' +
              '<span class="wg-2x2-miniplayer__sparkline" aria-hidden="true">✦ ♪ ✧ ♡ ✦</span>' +
              '<p class="wg-2x2-miniplayer__title"></p>' +
              '<div class="wg-2x2-miniplayer__progress" aria-hidden="true">' +
                '<span class="wg-2x2-miniplayer__playdot"></span>' +
                '<span class="wg-2x2-miniplayer__bar"><span class="wg-2x2-miniplayer__bar-fill"></span></span>' +
              '</div>' +
              '<p class="wg-2x2-miniplayer__artist"></p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInsclockWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--insclock desk-custom__wg desk-custom__wg--insclock';
    el.setAttribute('aria-label', '涂鸦表盘');
    el.innerHTML =
      '<div class="wg-2x1-dial">' +
        '<div class="wg-2x1-dial__face" aria-hidden="true">' +
          '<svg class="wg-2x1-dial__ring" viewBox="0 0 46 46">' +
            '<path d="M23 4 C12 4 4 13 4 23 C4 33 12 42 23 42 C34 42 42 33 42 23 C42 13 34 4 23 4 Z" fill="none" stroke="#c8c8d0" stroke-width="1.4" stroke-dasharray="2 3"/>' +
            '<text x="23" y="10" text-anchor="middle" font-size="4" fill="#b0b0b8">12</text>' +
            '<text x="38" y="25" text-anchor="middle" font-size="4" fill="#b0b0b8">3</text>' +
            '<text x="23" y="40" text-anchor="middle" font-size="4" fill="#b0b0b8">6</text>' +
            '<text x="8" y="25" text-anchor="middle" font-size="4" fill="#b0b0b8">9</text>' +
            '<line class="wg-2x1-dial__hand wg-2x1-dial__hand--h" x1="23" y1="23" x2="23" y2="13" stroke="#4a4a52" stroke-width="1.6" stroke-linecap="round"/>' +
            '<line class="wg-2x1-dial__hand wg-2x1-dial__hand--m" x1="23" y1="23" x2="23" y2="9" stroke="#2a2a30" stroke-width="1.2" stroke-linecap="round"/>' +
            '<circle cx="23" cy="23" r="1.6" fill="#2a2a30"/>' +
          '</svg>' +
        '</div>' +
        '<div class="wg-2x1-dial__meta">' +
          '<p class="wg-2x1-dial__time">14:32</p>' +
          '<p class="wg-2x1-dial__date">WED · 07/01</p>' +
          '<p class="wg-2x1-dial__note">慢慢过今天</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInstuneWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--instune desk-custom__wg desk-custom__wg--instune';
    el.setAttribute('aria-label', '封面音轨');
    el.innerHTML =
      '<div class="wg-2x1-play">' +
        '<div class="wg-2x1-play__top">' +
          '<div class="wg-2x1-play__cover"></div>' +
          '<div class="wg-2x1-play__meta">' +
            '<p class="wg-2x1-play__title">浅眠循环</p>' +
            '<p class="wg-2x1-play__artist">lofi desk</p>' +
            '<span class="wg-2x1-play__note">把噪音关在门外</span>' +
          '</div>' +
        '</div>' +
        '<div class="wg-2x1-play__foot">' +
          '<span class="wg-2x1-play__icon" aria-hidden="true">♪</span>' +
          '<div class="wg-2x1-play__bar"><span class="wg-2x1-play__bar-fill"></span></div>' +
          '<span class="wg-2x1-play__pct">42%</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInsquoteWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--insquote desk-custom__wg desk-custom__wg--insquote';
    el.setAttribute('aria-label', '对白条');
    el.innerHTML =
      '<div class="wg-2x1-chat">' +
        '<div class="wg-2x1-chat__ava"></div>' +
        '<div class="wg-2x1-chat__body">' +
          '<p class="wg-2x1-chat__bubble">今晚有空吗，想去看海</p>' +
          '<span class="wg-2x1-chat__stamp">22:04</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInsmoodWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--insmood desk-custom__wg desk-custom__wg--insmood';
    el.setAttribute('aria-label', '文件夹签');
    el.innerHTML =
      '<div class="wg-2x1-fold">' +
        '<span class="wg-2x1-fold__tab">archive</span>' +
        '<div class="wg-2x1-fold__inner">' +
          '<p class="wg-2x1-fold__num">128</p>' +
          '<div class="wg-2x1-fold__copy">' +
            '<p class="wg-2x1-fold__label">天已记录</p>' +
            '<p class="wg-2x1-fold__sub">keep going</p>' +
          '</div>' +
          '<span class="wg-2x1-fold__deco" aria-hidden="true">✦</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInsnoteWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--insnote desk-custom__wg desk-custom__wg--insnote';
    el.setAttribute('aria-label', '环扣月历');
    el.innerHTML =
      '<div class="wg-2x1-cal">' +
        '<div class="wg-2x1-cal__rings" aria-hidden="true">' +
          '<span class="wg-2x1-cal__ring"></span>' +
          '<span class="wg-2x1-cal__ring"></span>' +
          '<span class="wg-2x1-cal__ring"></span>' +
        '</div>' +
        '<div class="wg-2x1-cal__sheet">' +
          '<p class="wg-2x1-cal__month">七月</p>' +
          '<div class="wg-2x1-cal__week"></div>' +
          '<p class="wg-2x1-cal__note">把寻常日子过成慢镜头</p>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createInscardWidgetEl() {
    var el = document.createElement('article');
    el.className = 'wg wg-2x1 wg-2x1--inscard desk-custom__wg desk-custom__wg--inscard';
    el.setAttribute('aria-label', '横排三联');
    el.innerHTML =
      '<div class="wg-2x1-strip">' +
        '<div class="wg-2x1-strip__cell"><div class="wg-2x1-strip__photo"></div></div>' +
        '<div class="wg-2x1-strip__cell"><div class="wg-2x1-strip__photo"></div></div>' +
        '<div class="wg-2x1-strip__cell"><div class="wg-2x1-strip__photo"></div></div>' +
      '</div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function createWidgetElement(widgetId) {
    var def = WIDGET_CATALOG[widgetId];
    if (!def) return null;
    if (def.blank) return createBlankWidgetEl(widgetId, def);
    if (def.widget === 'profile') return createProfileWidgetEl();
    if (def.widget === 'memo') return createMemoWidgetEl();
    if (def.widget === 'polaroid') return createPolaroidWidgetEl();
    if (def.widget === 'filmstrip') return createFilmstripWidgetEl();
    if (def.widget === 'wave') return createWaveWidgetEl();
    if (def.widget === 'ticket') return createTicketWidgetEl();
    if (def.widget === 'ticketphoto') return createTicketphotoWidgetEl();
    if (def.widget === 'orbit') return createOrbitWidgetEl();
    if (def.widget === 'ledger') return createLedgerWidgetEl();
    if (def.widget === 'player') return createPlayerWidgetEl();
    if (def.widget === 'dialogue') return createDialogueWidgetEl();
    if (def.widget === 'magazine') return createMagazineWidgetEl();
    if (def.widget === 'instprofile') return createInstprofileWidgetEl();
    if (def.widget === 'glassdeck') return createGlassdeckWidgetEl();
    if (def.widget === 'avalink') return createAvalinkWidgetEl();
    if (def.widget === 'mooddiary') return createMooddiaryWidgetEl();
    if (def.widget === 'weekmood') return createWeekmoodWidgetEl();
    if (def.widget === 'photowall') return createPhotowallWidgetEl();
    if (def.widget === 'calendar') return createCalendarWidgetEl();
    if (def.widget === 'journal') return createJournalWidgetEl();
    if (def.widget === 'moment') return createMomentWidgetEl();
    if (def.widget === 'scrolllyrics') return createScrolllyricsWidgetEl();
    if (def.widget === 'badgepin') return createBadgepinWidgetEl();
    if (def.widget === 'vinyl') return createVinylWidgetEl();
    if (def.widget === 'sleeve') return createSleeveWidgetEl();
    if (def.widget === 'framephoto') return createFramephotoWidgetEl();
    if (def.widget === 'instriple') return createInstripleWidgetEl();
    if (def.widget === 'inspair') return createInspairWidgetEl();
    if (def.widget === 'inshome') return createInshomeWidgetEl();
    if (def.widget === 'wxmoments') return createWxmomentsWidgetEl();
    if (def.widget === 'postcard') return createPostcardWidgetEl();
    if (def.widget === 'folder') return createFolderWidgetEl();
    if (def.widget === 'miniplayer') return createMiniplayerWidgetEl();
    if (def.widget === 'insclock') return createInsclockWidgetEl();
    if (def.widget === 'instune') return createInstuneWidgetEl();
    if (def.widget === 'insquote') return createInsquoteWidgetEl();
    if (def.widget === 'insmood') return createInsmoodWidgetEl();
    if (def.widget === 'insnote') return createInsnoteWidgetEl();
    if (def.widget === 'inscard') return createInscardWidgetEl();
    if (def.widget === 'custom') return createCustomWidgetEl(def);
    return null;
  }

  function createCustomWidgetEl(def) {
    var el = document.createElement('article');
    var size = (def && def.w && def.h) ? (def.w + 'x' + def.h) : '2x2';
    el.className = 'wg wg-custom desk-custom__wg desk-custom__wg--custom desk-custom__wg--custom-' + size;
    el.setAttribute('aria-label', (def && def.label) || '自定义小组件');
    el.setAttribute('data-wg-custom-size', size);
    el.setAttribute('data-wg-custom-border', 'none');
    el.setAttribute('data-wg-has-shell', '0');
    el.innerHTML =
      '<div class="wg-custom__host"></div>' +
      '<button type="button" class="desk-custom__wg-remove" aria-label="移除小组件">×</button>';
    return el;
  }

  function resolveSlot(elOrSlot) {
    if (!elOrSlot) return null;
    if (typeof elOrSlot.type === 'string' && elOrSlot.index != null) return elOrSlot;
    return parseSlotEl(elOrSlot);
  }

  function dockMode() {
    return drag.active ? 'full' : 'compact';
  }

  function shouldShowEmptySlot(zone) {
    /* 编辑模式与拖拽时：网格/dock 空位一律可见，方便落点 */
    return editMode || drag.active;
  }

  function fillCell(cell, appKey, zone) {
    cell.innerHTML = '';
    var showEmpty = shouldShowEmptySlot(zone);
    if (zone === 'dock') {
      cell.classList.toggle('foot__dock-slot--filled', !!appKey);
      cell.classList.toggle('foot__dock-slot--empty', !appKey);
    } else {
      cell.classList.toggle('desk-custom__cell--filled', !!appKey);
      cell.classList.toggle('desk-custom__cell--empty', !appKey);
      cell.classList.toggle('desk-custom__cell--hidden', !appKey && !showEmpty);
    }
    if (appKey) {
      cell.appendChild(zone === 'dock' ? createDockIcon(appKey) : createGridIcon(appKey));
    } else if (showEmpty) {
      cell.appendChild(zone === 'dock' ? createEmptyDockInner() : createEmptyGridInner());
    }
  }

  function createItemElement(item, pageIndex) {
    var wrap = document.createElement('div');
    wrap.className = 'desk-custom__item';
    wrap.setAttribute('data-item-id', item.id);
    wrap.style.gridColumn = (item.x + 1) + ' / span ' + item.w;
    wrap.style.gridRow = (item.y + 1) + ' / span ' + item.h;

    if (item.kind === 'app') {
      wrap.classList.add('desk-custom__item--app');
      wrap.setAttribute('data-custom-slot', slotKey('grid', pageIndex, item.y * GRID_COLS + item.x));
      wrap.appendChild(createGridIcon(item.key));
    } else {
      wrap.classList.add('desk-custom__item--widget');
      wrap.setAttribute('data-custom-slot', slotKey('grid', pageIndex, item.y * GRID_COLS + item.x));
      var cfg = getWidgetConfig(item) || item.config;
      var def = WIDGET_CATALOG[item.widgetId] || ensureCustomCatalogEntry(item.widgetId, cfg);
      var wg = createWidgetElement(item.widgetId);
      if (wg) {
        var isCustom = (def && def.widget === 'custom') || String(item.widgetId || '').indexOf('custom_') === 0;
        if (isCustom) {
          var cw = item.w || (def && def.w) || 2;
          var ch = item.h || (def && def.h) || 2;
          wrap.classList.add('desk-custom__item--custom');
          wrap.classList.add('desk-custom__item--custom-' + cw + 'x' + ch);
          wrap.setAttribute('data-custom-wg-size', cw + 'x' + ch);
        }
        wrap.appendChild(wg);
        paintWidgetElement(wg, item);
      }
    }
    return wrap;
  }

  function renderCustomPage(pageIndex, pageData) {
    var page = document.createElement('main');
    page.className = 'desk-custom desk-custom__page';
    page.setAttribute('data-custom-page', String(pageIndex));
    page.setAttribute('role', 'list');

    var grid = document.createElement('div');
    grid.className = 'desk-custom__grid';
    grid.id = pageIndex === currentPage ? 'desk-custom-grid' : '';

    var occ = buildOccupancy(pageData.items);
    var showEmpty = shouldShowEmptySlot('grid');
    var i, x, y, cellIndex, cell, occupied;

    /* 始终铺满 4×7 格子：编辑/拖拽时全部可见，占用格作底轨 */
    for (i = 0; i < GRID_SLOT_COUNT; i++) {
      x = i % GRID_COLS;
      y = Math.floor(i / GRID_COLS);
      cellIndex = y * GRID_COLS + x;
      occupied = !!occ[y][x];
      cell = document.createElement('div');
      cell.className = 'desk-custom__cell';
      cell.setAttribute('data-custom-slot', slotKey('grid', pageIndex, cellIndex));
      cell.style.gridColumn = (x + 1) + ' / span 1';
      cell.style.gridRow = (y + 1) + ' / span 1';
      if (occupied) {
        cell.classList.add('desk-custom__cell--occupied');
        if (showEmpty) {
          cell.classList.add('desk-custom__cell--edit-guide', 'desk-custom__cell--empty');
          cell.appendChild(createEmptyGridInner());
        } else {
          cell.classList.add('desk-custom__cell--hidden');
        }
      } else {
        fillCell(cell, null, 'grid');
        if (!showEmpty) cell.classList.add('desk-custom__cell--hidden');
      }
      grid.appendChild(cell);
    }

    pageData.items.forEach(function (item) {
      grid.appendChild(createItemElement(item, pageIndex));
    });

    page.appendChild(grid);
    return page;
  }

  function renderCustomPageAt(pageIndex) {
    var track = $('desk-custom-track');
    if (!track) return;
    var layout = getLayout();
    var pg = layout.pages[pageIndex];
    if (!pg) return;
    var existing = track.querySelector('[data-custom-page="' + pageIndex + '"]');
    var pageEl = renderCustomPage(pageIndex, pg);
    if (existing) existing.replaceWith(pageEl);
    else track.appendChild(pageEl);
    if (global.miyaFillAppIcons) global.miyaFillAppIcons(pageEl);
    applyIconsOnly(pageEl);
  }

  function renderCustomPages() {
    var track = $('desk-custom-track');
    if (!track) return;
    var layout = getLayout();
    track.innerHTML = '';
    layout.pages.forEach(function (pg, idx) {
      track.appendChild(renderCustomPage(idx, pg));
    });
    if (global.miyaFillAppIcons) global.miyaFillAppIcons(track);
    paintCustomPager();
    track.classList.add('is-programmatic');
    track.scrollTo({ left: currentPage * customPageWidth(), behavior: 'auto' });
    requestAnimationFrame(function () {
      track.classList.remove('is-programmatic');
      syncCustomPageFromScroll();
    });
    applyIconsOnly(track);
  }

  function updateDockLayoutMetrics(dock, dockSlots) {
    var n = countDockApps(dockSlots);
    var showEmpty = shouldShowEmptySlot('dock');
    var visibleCount = showEmpty ? DOCK_SLOT_COUNT : Math.max(n, MIN_DOCK);
    var metrics = DOCK_METRICS[visibleCount] || DOCK_METRICS[MAX_DOCK];

    for (var c = MIN_DOCK; c <= MAX_DOCK; c++) dock.classList.remove('foot__dock--count-' + c);
    dock.classList.add('foot__dock--count-' + visibleCount);
    dock.dataset.dockCount = String(n);
    dock.style.setProperty('--dock-gap', metrics.gap + 'px');
    dock.style.setProperty('--dock-pad-x', metrics.pad + 'px');
  }

  function renderCustomDock(dockSlots) {
    var dock = document.querySelector('.foot__dock');
    if (!dock) return;
    var dismiss = dock.querySelector('.foot__dock-dismiss');
    var hadSlots = dock.querySelector('[data-custom-slot^="dock:"]');
    if (!hadSlots) {
      Array.from(dock.children).forEach(function (ch) {
        if (ch !== dismiss) ch.remove();
      });
      for (var i = 0; i < DOCK_SLOT_COUNT; i++) {
        var cell = document.createElement('div');
        cell.className = 'foot__dock-slot';
        cell.setAttribute('data-custom-slot', slotKey('dock', i));
        dock.appendChild(cell);
      }
    }
    dock.classList.add('foot__dock--custom');
    refreshDockSlotVisibility(dockSlots);
    if (global.miyaFillAppIcons) global.miyaFillAppIcons(dock);
  }

  function refreshDockSlotVisibility(dockSlots) {
    var dock = document.querySelector('.foot__dock.foot__dock--custom');
    if (!dock) return;
    dockSlots = dockSlots || getLayout().dockSlots;
    var showEmpty = shouldShowEmptySlot('dock');
    dock.classList.toggle('foot__dock--compact', !showEmpty);
    dock.classList.toggle('foot__dock--full', showEmpty);
    updateDockLayoutMetrics(dock, dockSlots);

    for (var i = 0; i < DOCK_SLOT_COUNT; i++) {
      var cell = dock.querySelector('[data-custom-slot="' + slotKey('dock', i) + '"]');
      if (!cell) continue;
      var appKey = dockSlots[i];
      var curApp = cell.querySelector('[data-app]');
      var curKey = curApp ? curApp.getAttribute('data-app') : null;
      if (curKey !== (appKey || null)) {
        fillCell(cell, appKey, 'dock');
      } else if (!appKey) {
        cell.classList.toggle('foot__dock-slot--filled', false);
        cell.classList.toggle('foot__dock-slot--empty', true);
        var ring = cell.querySelector('.foot__dock-slot__empty-inner');
        if (showEmpty && !ring) {
          cell.innerHTML = '';
          cell.appendChild(createEmptyDockInner());
        } else if (!showEmpty && ring) {
          cell.innerHTML = '';
        }
      }
      cell.classList.toggle('foot__dock-slot--hidden', !showEmpty && !appKey);
    }
  }

  function ensureDockSlotCell(index) {
    var dock = document.querySelector('.foot__dock.foot__dock--custom');
    if (!dock) return null;
    return dock.querySelector('[data-custom-slot="' + slotKey('dock', index) + '"]');
  }

  function appendCustomPage(pageIndex) {
    var track = $('desk-custom-track');
    if (!track) return;
    var layout = getLayout();
    var pg = layout.pages[pageIndex];
    if (!pg) return;
    var pageEl = renderCustomPage(pageIndex, pg);
    track.appendChild(pageEl);
    if (global.miyaFillAppIcons) global.miyaFillAppIcons(pageEl);
    applyIconsOnly(pageEl);
    paintCustomPager();
    if (drag.active) invalidateDragHitCache();
  }

  function refreshEmptySlotVisibility() {
    refreshDockSlotVisibility();
    var showEmpty = shouldShowEmptySlot('grid');
    var layout = getLayout();
    var dragItem = null;
    if (drag.active && drag.fromSlot && drag.fromSlot.type === 'grid') {
      dragItem = getItemInSlot(layout, drag.fromSlot);
    }
    var occByPage = {};
    document.querySelectorAll('#desk-custom-viewport .desk-custom__cell').forEach(function (cell) {
      var slot = parseSlotEl(cell);
      if (!slot || slot.type !== 'grid') return;
      if (!occByPage[slot.page]) {
        var page = layout.pages[slot.page];
        occByPage[slot.page] = page ? buildOccupancy(page.items) : null;
      }
      var occ = occByPage[slot.page];
      var occId = occ && occ[slot.y] ? occ[slot.y][slot.x] : null;
      var underDrag = !!(dragItem && drag.fromSlot && slot.page === drag.fromSlot.page &&
        slot.x >= dragItem.x && slot.x < dragItem.x + dragItem.w &&
        slot.y >= dragItem.y && slot.y < dragItem.y + dragItem.h);
      var occupied = !!occId && !underDrag;
      cell.classList.toggle('desk-custom__cell--occupied', occupied);
      cell.classList.toggle('desk-custom__cell--edit-guide', showEmpty && occupied);
      cell.classList.toggle('desk-custom__cell--hidden', !showEmpty);
      cell.classList.toggle('desk-custom__cell--empty', showEmpty);
      cell.classList.toggle('desk-custom__cell--interactive', showEmpty && !occupied);
      var hasPlaceholder = cell.querySelector('.desk-custom__empty');
      if (showEmpty && !hasPlaceholder) {
        cell.innerHTML = '';
        cell.appendChild(createEmptyGridInner());
      } else if (!showEmpty && hasPlaceholder) {
        cell.innerHTML = '';
      }
    });
  }

  function renderCustomLayout() {
    if (!renderCustomLayoutPending) {
      renderCustomLayoutNow();
      renderCustomLayoutPending = true;
      requestAnimationFrame(function () {
        renderCustomLayoutPending = false;
        if (renderCustomLayoutDirty) {
          renderCustomLayoutDirty = false;
          renderCustomLayoutNow();
        }
      });
    } else {
      renderCustomLayoutDirty = true;
    }
  }

  function renderCustomLayoutNow() {
    var layout = getLayout();
    renderCustomPages();
    renderCustomDock(layout.dockSlots);
    applyIconsOnly();
  }

  function applyIconsOnly(root) {
    var theme = loadCustomTheme();
    CUSTOM_ICON_KEYS.forEach(function (key) {
      var ref = theme.icons && theme.icons[key];
      var btns;
      if (root && root !== document) {
        btns = root.querySelectorAll('[data-app="' + key + '"]');
      } else {
        btns = document.querySelectorAll(
          '#desk-custom-viewport [data-app="' + key + '"], .foot__dock.foot__dock--custom [data-app="' + key + '"]'
        );
      }
      btns.forEach(function (btn) {
        applyIconBg(btn, ref);
      });
    });
  }

  function applyCustomIconFrameless(theme) {
    document.documentElement.classList.toggle('miya-custom-desk-icon-frameless', !!(theme && theme.iconFrameless));
  }

  function applyCustomAltIconStyle(theme) {
    var on = !!(theme && theme.altIconStyle);
    if (global.miyaSyncAppIconStyle) global.miyaSyncAppIconStyle(on);
    else document.documentElement.classList.toggle('miya-alt-app-icons', on);
  }

  function applyHomeCopyToCustomWidgets() {
    var vp = $('desk-custom-viewport');
    if (!vp) return Promise.resolve();
    var layout = getLayout();
    var promises = [];
    layout.pages.forEach(function (pg) {
      pg.items.forEach(function (item) {
        if (item.kind !== 'widget') return;
        var wrap = vp.querySelector('[data-item-id="' + item.id + '"] .desk-custom__wg');
        if (wrap) promises.push(paintWidgetElement(wrap, item));
      });
    });
    return Promise.all(promises);
  }

  function applyCustomWidgetMedia() {
    return applyHomeCopyToCustomWidgets();
  }

  function applyCustomDeskTheme(theme) {
    theme = theme || loadCustomTheme();
    applyCustomTextColor(theme);
    applyCustomIconFrameless(theme);
    applyCustomAltIconStyle(theme);
    if (getLayoutMode() === 'custom') renderCustomLayout();
    var promises = [
      global.miyaResolveMediaUrl(theme.wallpaper).then(function (url) { applyWallToPhone(url); })
    ];
    if (global.miyaApplyFont) {
      promises.push(global.miyaApplyFont(global.miyaGetTheme ? global.miyaGetTheme() : {}));
    }
    CUSTOM_ICON_KEYS.forEach(function (key) {
      var ref = theme.icons && theme.icons[key];
      document.querySelectorAll(
        '#desk-custom-viewport [data-app="' + key + '"], .foot__dock.foot__dock--custom [data-app="' + key + '"]'
      ).forEach(function (btn) {
        promises.push(applyIconBg(btn, ref));
      });
    });
    promises.push(applyCustomWidgetMedia());
    return Promise.all(promises);
  }

  function paintCustomPager() {
    var pager = $('desk-pager');
    if (!pager) return;
    var layout = getLayout();
    var count = layout.pages.length;
    var dots = pager.querySelectorAll('[data-desk-page]');
    if (dots.length === count) {
      dots.forEach(function (dot, i) {
        var on = i === currentPage;
        dot.classList.toggle('is-active', on);
        if (on) dot.setAttribute('aria-current', 'page');
        else dot.removeAttribute('aria-current');
      });
    } else {
      pager.innerHTML = '';
      for (var i = 0; i < count; i++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'desk-pager__dot' + (i === currentPage ? ' is-active' : '');
        dot.setAttribute('data-desk-page', String(i));
        dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 页');
        if (i === currentPage) dot.setAttribute('aria-current', 'page');
        pager.appendChild(dot);
      }
    }
    pager.hidden = getLayoutMode() !== 'custom';
  }

  function scrollCustomToPage(dx, behavior) {
    var track = $('desk-custom-track');
    var viewport = $('desk-custom-viewport');
    if (!track) return;
    var w = track.clientWidth || (viewport && viewport.clientWidth) || 1;
    var left = currentPage * w + (dx || 0);
    customPageScrollLock = true;
    if (behavior === 'auto') track.classList.add('is-programmatic');
    track.scrollTo({ left: Math.max(0, left), behavior: behavior || 'auto' });
    if (behavior === 'auto') {
      requestAnimationFrame(function () {
        track.classList.remove('is-programmatic');
        customPageScrollLock = false;
      });
    } else {
      setTimeout(function () { customPageScrollLock = false; }, 380);
    }
    syncCustomPageFromScroll();
  }

  function paintCustomTrack(dx) {
    scrollCustomToPage(dx || 0, 'auto');
  }

  function setCustomPage(n, dx) {
    var layout = getLayout();
    currentPage = Math.max(0, Math.min(layout.pages.length - 1, n));
    if (drag.active) {
      dragHitCache = null;
      refreshEmptySlotVisibility();
    }
    paintCustomPager();
    scrollCustomToPage(dx || 0, (drag.active || dx) ? 'auto' : 'smooth');
    if (drag.active) {
      requestAnimationFrame(function () {
        if (!drag.active) return;
        buildDragHitCache();
        updateDragHover(dragPointer.x, dragPointer.y);
      });
    }
  }

  function addCustomPage() {
    var layout = getLayout();
    layout.pages.push({ items: [] });
    saveLayout(layout);
    if (drag.active) appendCustomPage(layout.pages.length - 1);
    else renderCustomPages();
    return layout.pages.length - 1;
  }

  function removeCustomPage(index) {
    var layout = getLayout();
    if (layout.pages.length <= 1 || index <= 0 || index >= layout.pages.length) return;
    layout.pages.splice(index, 1);
    saveLayout(layout);
    if (currentPage >= layout.pages.length) currentPage = layout.pages.length - 1;
    renderCustomPages();
  }

  function trimEmptyTrailingPages(fromIndex) {
    var layout = getLayout();
    var i = fromIndex;
    while (i > 0 && i < layout.pages.length && isPageEmpty(layout.pages[i])) {
      layout.pages.splice(i, 1);
      if (currentPage >= layout.pages.length) currentPage = layout.pages.length - 1;
      i = fromIndex;
    }
    if (layout.pages.length !== getLayout().pages.length) {
      saveLayout(layout);
      renderCustomPages();
    }
  }

  function isPagerSwipeBlockedTarget(el) {
    if (!el) return false;
    if (el.closest('.desk-custom-add-wg, .desk-custom-wg-picker, .desk-custom-wg-editor, .foot__dock-dismiss')) {
      return true;
    }
    if (editMode) {
      return !!el.closest('.desk-custom__ic, .desk-custom__dock-ic, .desk-custom__item--widget');
    }
    return false;
  }

  function dismissCustomPagerGesture() {
    if (cancelCustomPagerGesture) cancelCustomPagerGesture();
  }

  function bindCustomPager() {
    if (pagerBound) return;
    pagerBound = true;
    var viewport = $('desk-custom-viewport');
    var track = $('desk-custom-track');
    var pager = $('desk-pager');
    if (!viewport || !track) return;

    var scrollRaf = 0;
    var edgeStartX = 0;
    var edgeStartY = 0;
    var edgePage = 0;

    function pageWidth() {
      return track.clientWidth || viewport.clientWidth || 1;
    }

    function syncFromScroll() {
      if (getLayoutMode() !== 'custom' || wgEditorState.open) return;
      /* 拖着图标/组件时才锁页；编辑模式正常左右滑不受影响 */
      if (drag.active && !customPageScrollLock) {
        var lockedLeft = currentPage * pageWidth();
        if (Math.abs(track.scrollLeft - lockedLeft) > 1) {
          track.classList.add('is-programmatic');
          track.scrollLeft = lockedLeft;
          requestAnimationFrame(function () { track.classList.remove('is-programmatic'); });
        }
        return;
      }
      if (drag.active) return;
      /* 浏览态翻页中取消长按，避免滑到一半误进编辑 */
      if (!editMode && drag.pending && !drag.active && hasPendingScrollMoved()) {
        cancelPending();
        drag.pointerId = null;
        drag.sourceEl = null;
        drag.fromSlot = null;
      }
      if (editMode && drag.pending) return;
      var layout = getLayout();
      var i = Math.round(track.scrollLeft / pageWidth());
      i = Math.max(0, Math.min(layout.pages.length - 1, i));
      if (i !== currentPage) {
        var from = currentPage;
        currentPage = i;
        paintCustomPager();
        syncCustomPageFromScroll();
        if (!editMode && from > currentPage && layout.pages[from] && isPageEmpty(layout.pages[from])) {
          removeCustomPage(from);
        }
      } else {
        syncCustomPageFromScroll();
      }
    }

    function onScroll() {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(function () {
        scrollRaf = 0;
        syncFromScroll();
      });
    }

    function resetGesture() {
      scrollCustomToPage(0, 'auto');
    }

    cancelCustomPagerGesture = resetGesture;

    if (!track._customScrollBound) {
      track._customScrollBound = true;
      track.addEventListener('scroll', onScroll, { passive: true });
    }

    track.addEventListener('touchstart', function (e) {
      if (getLayoutMode() !== 'custom' || drag.active || drag.pending || wgEditorState.open) return;
      if (e.touches.length !== 1) return;
      if (isPagerSwipeBlockedTarget(e.target)) return;
      edgeStartX = e.touches[0].clientX;
      edgeStartY = e.touches[0].clientY;
      edgePage = currentPage;
    }, { passive: true });

    track.addEventListener('touchend', function (e) {
      if (getLayoutMode() !== 'custom' || editMode || drag.active || wgEditorState.open) return;
      var layout = getLayout();
      var touch = e.changedTouches[0];
      if (!touch) return;
      var dx = touch.clientX - edgeStartX;
      var dy = touch.clientY - edgeStartY;
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
      customPagerSwipedUntil = Date.now() + 480;
      if (drag.pending) cancelPending();
      if (dx < 0 && edgePage === layout.pages.length - 1 && currentPage === edgePage) {
        addCustomPage();
        setCustomPage(currentPage + 1);
      }
    }, { passive: true });

    if (pager && !pager._customPagerBound) {
      pager._customPagerBound = true;
      pager.addEventListener('click', function (e) {
        var dot = e.target.closest('[data-desk-page]');
        if (!dot || getLayoutMode() !== 'custom') return;
        setCustomPage(parseInt(dot.getAttribute('data-desk-page'), 10) || 0);
      });
    }
  }

  function restoreFixedPager() {
    var pager = $('desk-pager');
    if (!pager) return;
    pager.innerHTML =
      '<button type="button" class="desk-pager__dot is-active" data-desk-page="0" aria-current="page" aria-label="第一页"></button>' +
      '<button type="button" class="desk-pager__dot" data-desk-page="1" aria-label="第二页"></button>' +
      '<button type="button" class="desk-pager__dot" data-desk-page="2" aria-label="第三页"></button>' +
      '<button type="button" class="desk-pager__dot" data-desk-page="3" aria-label="第四页"></button>';
    pager.hidden = false;
  }

  function updateLayoutVisibility(mode) {
    var isCustom = mode === 'custom';
    if (!isCustom && editMode) exitEditMode();
    var fixedVp = $('desk-viewport');
    var customVp = $('desk-custom-viewport');
    if (fixedVp) fixedVp.hidden = isCustom;
    if (customVp) customVp.hidden = !isCustom;
    if (isCustom) paintCustomPager();
    else restoreFixedPager();
    document.documentElement.dataset.miyaDeskLayout = mode;
    if (isCustom) { captureFixedDock(); renderCustomLayout(); }
    else restoreFixedDock();
  }

  function applyActiveLayout() {
    var mode = getLayoutMode();
    updateLayoutVisibility(mode);
    if (mode === 'custom') return applyCustomDeskTheme();
    document.documentElement.classList.remove('miya-custom-desk-icon-frameless');
    if (global.miyaApplyTheme) return global.miyaApplyTheme(global.miyaGetTheme && global.miyaGetTheme());
    return Promise.resolve();
  }

  function switchDeskLayout(mode) {
    setLayoutMode(mode);
    return applyActiveLayout();
  }

  /* ── 编辑模式 ── */

  function ensureFullEditGrid() {
    var layout = getLayout();
    var showEmpty = shouldShowEmptySlot('grid');
    if (!showEmpty) return;
    layout.pages.forEach(function (pg, pageIndex) {
      var grid = getPageGrid(pageIndex);
      if (!grid) return;
      var occ = buildOccupancy(pg.items);
      var i, x, y, cell;
      for (i = 0; i < GRID_SLOT_COUNT; i++) {
        x = i % GRID_COLS;
        y = Math.floor(i / GRID_COLS);
        cell = findGridCellEl(pageIndex, x, y);
        if (!cell) {
          cell = document.createElement('div');
          cell.className = 'desk-custom__cell';
          cell.setAttribute('data-custom-slot', slotKey('grid', pageIndex, i));
          cell.style.gridColumn = (x + 1) + ' / span 1';
          cell.style.gridRow = (y + 1) + ' / span 1';
          grid.appendChild(cell);
        }
        if (occ[y][x]) cell.classList.add('desk-custom__cell--occupied');
        else cell.classList.remove('desk-custom__cell--occupied');
      }
    });
  }

  function enterEditMode() {
    if (editMode) return;
    suspendGlass();
    editMode = true;
    document.documentElement.classList.add('is-custom-edit-mode');
    if (drag.sourceEl) drag.sourceEl.classList.remove('is-press-pending');
    if (drag.itemWrap) drag.itemWrap.classList.remove('is-press-pending');
    var addBtn = $('desk-custom-add-wg');
    if (addBtn) addBtn.hidden = false;
    /* 就地补齐 4×7 格子，避免重绘打断长按中的拖拽引用 */
    ensureFullEditGrid();
    refreshEmptySlotVisibility();
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
  }

  function exitEditMode() {
    if (!editMode) return;
    editMode = false;
    document.documentElement.classList.remove('is-custom-edit-mode');
    closeWidgetPicker();
    var addBtn = $('desk-custom-add-wg');
    if (addBtn) addBtn.hidden = true;
    if (drag.active) endDrag(false, null);
    renderCustomLayout();
  }

  function isEditMode() { return editMode; }

  /* ── 小组件库 ── */

  function buildWidgetPicker() {
    var body = $('desk-custom-wg-picker-body');
    if (!body) return;
    body.innerHTML = '';
    syncCustomWidgetCatalog();

    function customIdsForSize(w, h) {
      return Object.keys(WIDGET_CATALOG).filter(function (id) {
        var def = WIDGET_CATALOG[id];
        return def && def.widget === 'custom' && def.w === w && def.h === h;
      });
    }

    function addSection(title, ids) {
      var sec = document.createElement('section');
      sec.className = 'desk-custom-wg-picker__section';
      sec.innerHTML = '<h4>' + title + '</h4>';
      var grid = document.createElement('div');
      grid.className = 'desk-custom-wg-picker__grid';
      var added = 0;
      ids.forEach(function (id) {
        var def = WIDGET_CATALOG[id];
        if (!def) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'desk-custom-wg-picker__item';
        if (def.widget === 'custom') btn.classList.add('desk-custom-wg-picker__item--custom');
        btn.setAttribute('data-wg-pick', id);
        var previewCls = 'desk-custom-wg-picker__preview desk-custom-wg-picker__preview--' +
          def.w + 'x' + def.h;
        if (def.widget) previewCls += ' desk-custom-wg-picker__preview--widget';
        else if (def.variant) previewCls += ' desk-custom-wg-picker__preview--v' + def.variant;
        btn.innerHTML = '<span class="' + previewCls + '"></span>' +
          '<span class="desk-custom-wg-picker__name">' + def.label + '</span>';
        if (def.widget) {
          var previewSpan = btn.querySelector('.desk-custom-wg-picker__preview');
          var mini = createWidgetElement(id);
          if (mini && previewSpan) {
            previewSpan.appendChild(mini);
            var paintCfg = null;
            if (def.widget === 'custom') {
              var tpl = getCustomWgTpl();
              var preset = tpl && def.customPresetId ? tpl.findPresetById(def.customPresetId) : null;
              paintCfg = preset && tpl ? tpl.buildInstanceConfig(preset, {}) : null;
            }
            paintWidgetElement(mini, { kind: 'widget', widgetId: id, config: paintCfg });
          }
        }
        grid.appendChild(btn);
        added += 1;
      });
      if (!added) return;
      sec.appendChild(grid);
      body.appendChild(sec);
    }

    addSection('4×1', ['blank_4x1_1', 'blank_4x1_2', 'blank_4x1_3', 'blank_4x1_8', 'blank_4x1_4', 'blank_4x1_5', 'blank_4x1_6', 'blank_4x1_7'].concat(customIdsForSize(4, 1)));
    addSection('4×2', ['blank_4x2_1', 'blank_4x2_2', 'blank_4x2_3', 'blank_4x2_4', 'blank_4x2_5', 'blank_4x2_6', 'blank_4x2_8'].concat(customIdsForSize(4, 2)));
    addSection('4×3', ['blank_4x3_1', 'blank_4x3_2', 'blank_4x3_3', 'blank_4x3_4', 'blank_4x3_5'].concat(customIdsForSize(4, 3)));
    addSection('4×4', ['blank_4x4_1', 'blank_4x4_2', 'blank_4x4_3', 'blank_4x4_4'].concat(customIdsForSize(4, 4)));
    addSection('2×1', ['blank_2x1_1', 'blank_2x1_2', 'blank_2x1_3', 'blank_2x1_4', 'blank_2x1_5', 'blank_2x1_6'].concat(customIdsForSize(2, 1)));
    addSection('2×2', ['blank_2x2_1', 'blank_2x2_2', 'blank_2x2_3', 'blank_2x2_4', 'blank_2x2_5', 'blank_2x2_6', 'blank_2x2_7', 'blank_2x2_8', 'blank_2x2_9'].concat(customIdsForSize(2, 2)));
  }

  function openWidgetPicker() {
    var picker = $('desk-custom-wg-picker');
    if (!picker) return;
    buildWidgetPicker();
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
  }

  function closeWidgetPicker() {
    var picker = $('desk-custom-wg-picker');
    if (!picker) return;
    picker.hidden = true;
    picker.setAttribute('aria-hidden', 'true');
  }

  function placeWidget(widgetId) {
    syncCustomWidgetCatalog();
    var def = WIDGET_CATALOG[widgetId];
    if (!def) return false;
    var layout = getLayout();
    var page = layout.pages[currentPage];
    if (!page) return false;
    var spot = findEmptyRect(page.items, def.w, def.h);
    if (!spot) return false;
    var item = {
      id: genItemId(),
      kind: 'widget',
      widgetId: widgetId,
      x: spot.x,
      y: spot.y,
      w: def.w,
      h: def.h
    };
    if (def.widget === 'custom') {
      var tpl = getCustomWgTpl();
      var preset = tpl && def.customPresetId ? tpl.findPresetById(def.customPresetId) : null;
      if (preset && tpl) item.config = tpl.buildInstanceConfig(preset, {});
    }
    page.items.push(item);
    saveLayout(layout);
    renderCustomLayout();
    applyCustomWidgetMedia();
    return true;
  }

  function removeWidgetItem(itemId) {
    suspendGlass();
    var layout = getLayout();
    var page = layout.pages[currentPage];
    if (!page) return;
    page.items = page.items.filter(function (it) { return it.id !== itemId; });
    saveLayout(layout);
    renderCustomLayout();
  }

  function bindWidgetPicker() {
    if (pickerBound) return;
    pickerBound = true;
    var addBtn = $('desk-custom-add-wg');
    var picker = $('desk-custom-wg-picker');
    var closeBtn = $('desk-custom-wg-picker-close');
    var manageBtn = $('desk-custom-wg-picker-manage');
    if (addBtn) addBtn.addEventListener('click', openWidgetPicker);
    if (closeBtn) closeBtn.addEventListener('click', closeWidgetPicker);
    if (manageBtn) {
      manageBtn.addEventListener('click', function () {
        closeWidgetPicker();
        if (global.miyaBeautifyApp && typeof global.miyaBeautifyApp.openCustomWidgetTemplates === 'function') {
          global.miyaBeautifyApp.openCustomWidgetTemplates();
        } else if (global.miyaOpenBeautifyApp) {
          global.miyaOpenBeautifyApp();
        }
      });
    }
    if (picker) {
      picker.addEventListener('click', function (e) {
        if (e.target === picker) closeWidgetPicker();
        var pick = e.target.closest('[data-wg-pick]');
        if (!pick) return;
        var ok = placeWidget(pick.getAttribute('data-wg-pick'));
        if (ok) {
          closeWidgetPicker();
          try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) {}
        } else if (global.miyaBeautifyApp && global.miyaBeautifyApp.toast) {
          global.miyaBeautifyApp.toast('当前页没有足够空间');
        }
      });
    }
  }

  /* ── 拖拽 ── */

  function getPageGrid(pageIndex) {
    var page = document.querySelector('#desk-custom-viewport [data-custom-page="' + pageIndex + '"]');
    return page ? page.querySelector('.desk-custom__grid') : null;
  }

  function findItemElById(id) {
    if (!id) return null;
    return document.querySelector('#desk-custom-viewport [data-item-id="' + id + '"]');
  }

  function findGridCellEl(pageIndex, x, y) {
    var idx = y * GRID_COLS + x;
    return document.querySelector(
      '#desk-custom-viewport [data-custom-slot="grid:' + pageIndex + ':' + idx + '"].desk-custom__cell'
    );
  }

  function setGridItemSlot(itemEl, pageIndex, x, y, w, h) {
    w = w || 1;
    h = h || 1;
    itemEl.style.gridColumn = (x + 1) + ' / span ' + w;
    itemEl.style.gridRow = (y + 1) + ' / span ' + h;
    itemEl.setAttribute('data-custom-slot', slotKey('grid', pageIndex, y * GRID_COLS + x));
  }

  function ensureGridEmptyCell(pageIndex, x, y) {
    if (findGridCellEl(pageIndex, x, y)) return;
    var grid = getPageGrid(pageIndex);
    if (!grid) return;
    var cell = document.createElement('div');
    cell.className = 'desk-custom__cell desk-custom__cell--empty desk-custom__cell--interactive';
    cell.setAttribute('data-custom-slot', slotKey('grid', pageIndex, y * GRID_COLS + x));
    cell.style.gridColumn = (x + 1) + ' / span 1';
    cell.style.gridRow = (y + 1) + ' / span 1';
    cell.appendChild(createEmptyGridInner());
    grid.appendChild(cell);
  }

  function removeGridEmptyCell(pageIndex, x, y) {
    var cell = findGridCellEl(pageIndex, x, y);
    if (cell) cell.remove();
  }

  function replaceItemAppKey(itemEl, appKey) {
    var btn = itemEl.querySelector('[data-app]');
    if (!btn || !appKey) return;
    btn.setAttribute('data-app', appKey);
    var box = btn.querySelector('[data-i]');
    if (box) box.setAttribute('data-i', appKey);
    var lbl = btn.querySelector('.ic__lbl');
    if (lbl) lbl.textContent = APP_LABELS[appKey] || appKey;
    if (global.miyaFillAppIcons) global.miyaFillAppIcons(btn);
    var theme = loadCustomTheme();
    applyIconBg(btn, theme.icons && theme.icons[appKey]);
  }

  function patchWidgetGridDrop(from, to, movedItem, movedEl, layout) {
    if (from.page === to.page && movedEl) {
      setGridItemSlot(movedEl, to.page, movedItem.x, movedItem.y, movedItem.w, movedItem.h);
      return true;
    }
    if (movedEl && from.page !== to.page) {
      var destGrid = getPageGrid(to.page);
      if (destGrid) {
        destGrid.appendChild(movedEl);
        setGridItemSlot(movedEl, to.page, movedItem.x, movedItem.y, movedItem.w, movedItem.h);
      }
      renderCustomPageAt(from.page);
      return true;
    }
    renderCustomPageAt(from.page);
    if (to.page !== from.page) renderCustomPageAt(to.page);
    return true;
  }

  function patchGridToGridDrop(from, to, layout) {
    var fromPage = layout.pages[from.page];
    var toPage = layout.pages[to.page];
    var movedEl = drag.itemWrap || findItemElById(drag.itemId);
    if (!movedEl) return false;

    var movedItem = drag.itemId
      ? (findItemById(toPage, drag.itemId) || findItemById(fromPage, drag.itemId))
      : findItemAt(toPage, to.x, to.y);
    if (!movedItem) return false;

    if (movedItem.kind === 'widget') {
      return patchWidgetGridDrop(from, to, movedItem, movedEl, layout);
    }

    var destPage = to.page;
    var destGrid = getPageGrid(destPage);
    if (!destGrid) return false;
    if (from.page !== destPage) destGrid.appendChild(movedEl);

    setGridItemSlot(movedEl, destPage, movedItem.x, movedItem.y, 1, 1);
    removeGridEmptyCell(destPage, to.x, to.y);

    var atFrom = findItemAt(fromPage, from.x, from.y);
    if (atFrom && atFrom.kind === 'app' && atFrom.id !== movedItem.id) {
      var swapEl = findItemElById(atFrom.id);
      if (swapEl) {
        if (from.page !== destPage) getPageGrid(from.page).appendChild(swapEl);
        setGridItemSlot(swapEl, from.page, atFrom.x, atFrom.y, 1, 1);
      }
      removeGridEmptyCell(from.page, from.x, from.y);
    } else if (editMode) {
      ensureGridEmptyCell(from.page, from.x, from.y);
    } else {
      removeGridEmptyCell(from.page, from.x, from.y);
    }
    return true;
  }

  function patchGridToDockDrop(from, to, layout) {
    var fromPage = layout.pages[from.page];
    refreshDockSlotVisibility(layout.dockSlots);
    var movedEl = drag.itemWrap || findItemElById(drag.itemId);
    var fromItem = drag.itemId ? findItemById(fromPage, drag.itemId) : null;

    if (movedEl && fromItem) {
      setGridItemSlot(movedEl, from.page, fromItem.x, fromItem.y, 1, 1);
      replaceItemAppKey(movedEl, fromItem.key);
    } else if (movedEl) {
      movedEl.remove();
      if (editMode) ensureGridEmptyCell(from.page, from.x, from.y);
    }
    return true;
  }

  function patchDockToGridDrop(from, to, layout) {
    refreshDockSlotVisibility(layout.dockSlots);
    /* 整页重绘，避免增量补丁导致 dock→桌面图标不显示 */
    renderCustomPageAt(to.page);
    var pageEl = document.querySelector('#desk-custom-viewport [data-custom-page="' + to.page + '"]');
    if (pageEl) {
      if (global.miyaFillAppIcons) global.miyaFillAppIcons(pageEl);
      applyIconsOnly(pageEl);
    }
    refreshEmptySlotVisibility();
    return true;
  }

  function patchDropDom(from, to) {
    var layout = getLayout();
    var flipBefore = null;
    try {
      if (from.type === 'dock' && to.type === 'dock') {
        refreshDockSlotVisibility(layout.dockSlots);
        return true;
      }
      if (from.type === 'grid' && to.type === 'grid') {
        if (from.page === to.page) flipBefore = captureFlipTargets(from.page);
        var gridOk = patchGridToGridDrop(from, to, layout);
        if (gridOk && flipBefore) {
          requestAnimationFrame(function () { runFlipBefore(flipBefore); });
        }
        return gridOk;
      }
      if (from.type === 'grid' && to.type === 'dock') return patchGridToDockDrop(from, to, layout);
      if (from.type === 'dock' && to.type === 'grid') return patchDockToGridDrop(from, to, layout);
    } catch (err) {}
    return false;
  }

  function clearHover() {
    if (drag.hoverCell) {
      drag.hoverCell.classList.remove('is-drop-target');
      drag.hoverCell = null;
    }
  }

  function setHoverCell(cell) {
    if (drag.hoverCell === cell) return;
    clearHover();
    if (cell) {
      drag.hoverCell = cell;
      cell.classList.add('is-drop-target');
    }
  }

  function resolveDockDropTarget(x, y, tentative) {
    var dock = document.querySelector('.foot__dock.foot__dock--custom');
    if (!dock) return tentative;
    var br = dock.getBoundingClientRect();
    if (y < br.top - 24 || y > br.bottom + 24) return tentative;
    if (x < br.left - 24 || x > br.right + 24) return tentative;
    if (tentative && dock.contains(tentative)) return tentative;
    var slots = dock.querySelectorAll('[data-custom-slot^="dock:"]');
    var i;
    for (i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var r = slot.getBoundingClientRect();
      var left = r.left - (i === 0 ? 16 : 6);
      var right = r.right + (i === slots.length - 1 ? 16 : 6);
      if (x >= left && x <= right && y >= r.top - 8 && y <= r.bottom + 8) return slot;
    }
    var rel = (x - br.left) / Math.max(1, br.width);
    var idx = Math.min(DOCK_SLOT_COUNT - 1, Math.max(0, Math.floor(rel * DOCK_SLOT_COUNT)));
    return ensureDockSlotCell(idx) || tentative;
  }

  function invalidateDragHitCache() {
    dragHitCache = null;
  }

  function buildDragHitCache() {
    var page = currentPage;
    var entries = [];
    var cells = document.querySelectorAll(
      '#desk-custom-viewport [data-custom-slot^="grid:' + page + ':"].desk-custom__cell'
    );
    var i, cell, r, item, slotEl;
    for (i = 0; i < cells.length; i++) {
      cell = cells[i];
      if (cell.classList.contains('desk-custom__cell--hidden')) continue;
      if (cell.classList.contains('desk-custom__cell--occupied')) continue;
      r = cell.getBoundingClientRect();
      entries.push({
        el: cell, kind: 'cell',
        l: r.left, t: r.top, r: r.right, b: r.bottom,
        cx: r.left + r.width * 0.5, cy: r.top + r.height * 0.5
      });
    }
    var pageEl = document.querySelector('#desk-custom-viewport [data-custom-page="' + page + '"]');
    if (pageEl) {
      var items = pageEl.querySelectorAll('.desk-custom__item');
      for (i = 0; i < items.length; i++) {
        item = items[i];
        slotEl = item.closest('[data-custom-slot]') || item;
        if (slotEl.classList && slotEl.classList.contains('is-drag-source')) continue;
        r = item.getBoundingClientRect();
        entries.push({
          el: slotEl, kind: item.classList.contains('desk-custom__item--widget') ? 'widget' : 'app',
          l: r.left, t: r.top, r: r.right, b: r.bottom,
          cx: r.left + r.width * 0.5, cy: r.top + r.height * 0.5
        });
      }
    }
    var dock = document.querySelector('.foot__dock.foot__dock--custom');
    var dockRect = null;
    var dockSlots = [];
    if (dock) {
      dockRect = dock.getBoundingClientRect();
      var slots = dock.querySelectorAll('[data-custom-slot^="dock:"]');
      for (i = 0; i < slots.length; i++) {
        cell = slots[i];
        r = cell.getBoundingClientRect();
        dockSlots.push({
          el: cell, idx: i,
          l: r.left, t: r.top, r: r.right, b: r.bottom,
          cx: r.left + r.width * 0.5, cy: r.top + r.height * 0.5
        });
      }
    }
    dragHitCache = { page: page, entries: entries, dockRect: dockRect, dockSlots: dockSlots };
    var track = $('desk-custom-track');
    dragHitCache.scrollLeft = track ? track.scrollLeft : 0;
  }

  function ensureDragHitCacheFresh() {
    if (!dragHitCache || dragHitCache.page !== currentPage) {
      buildDragHitCache();
      return;
    }
    var track = $('desk-custom-track');
    var scrollLeft = track ? track.scrollLeft : 0;
    if (dragHitCache.scrollLeft !== scrollLeft) buildDragHitCache();
  }

  function getDragProbe(x, y) {
    if (!drag.ghost) return { x: x, y: y };
    return {
      x: ghostPos.x - drag.grabOX + drag.ghostW * 0.5,
      y: ghostPos.y - drag.grabOY + drag.ghostH * 0.5
    };
  }

  function pointInRect(px, py, rect) {
    return px >= rect.l && px <= rect.r && py >= rect.t && py <= rect.b;
  }

  function resolveDockDropTargetCached(x, y, tentative) {
    if (!dragHitCache || !dragHitCache.dockSlots.length) return tentative;
    var slots = dragHitCache.dockSlots;
    var i, slot;
    for (i = 0; i < slots.length; i++) {
      slot = slots[i];
      var left = slot.l - (i === 0 ? 16 : 6);
      var right = slot.r + (i === slots.length - 1 ? 16 : 6);
      if (x >= left && x <= right && y >= slot.t - 8 && y <= slot.b + 8) return slot.el;
    }
    var dr = dragHitCache.dockRect;
    if (!dr) return tentative;
    var rel = (x - dr.left) / Math.max(1, dr.width);
    var idx = Math.min(DOCK_SLOT_COUNT - 1, Math.max(0, Math.floor(rel * DOCK_SLOT_COUNT)));
    return slots[idx] ? slots[idx].el : (ensureDockSlotCell(idx) || tentative);
  }

  function findNearestGridSlotCached(x, y) {
    if (!dragHitCache) return null;
    var best = null;
    var bestDist = Infinity;
    var maxDist = drag.active && drag.dragKind === 'widget' ? 140 : 80;
    var entries = dragHitCache.entries;
    var i, e, dist;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.kind !== 'cell') continue;
      dist = Math.hypot(x - e.cx, y - e.cy);
      if (dist < bestDist) { bestDist = dist; best = e.el; }
    }
    return bestDist < maxDist ? best : null;
  }

  function findGridCellAtPoint(x, y, pageIndex) {
    var cells = document.querySelectorAll(
      '#desk-custom-viewport [data-custom-slot^="grid:' + pageIndex + ':"].desk-custom__cell'
    );
    var i, cell, r;
    for (i = 0; i < cells.length; i++) {
      cell = cells[i];
      if (cell.classList.contains('desk-custom__cell--hidden')) continue;
      if (cell.classList.contains('desk-custom__cell--occupied')) continue;
      r = cell.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return cell;
    }
    return null;
  }

  function findNearestGridSlot(x, y) {
    var cells = document.querySelectorAll('#desk-custom-viewport [data-custom-slot^="grid:' + currentPage + ':"]');
    var best = null;
    var bestDist = Infinity;
    var maxDist = drag.active && drag.dragKind === 'widget' ? 140 : 80;
    cells.forEach(function (cell) {
      if (cell.classList.contains('desk-custom__cell--hidden')) return;
      if (cell.classList.contains('desk-custom__cell--occupied')) return;
      if (!cell.classList.contains('desk-custom__cell')) return;
      var r = cell.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) { bestDist = dist; best = cell; }
    });
    return bestDist < maxDist ? best : null;
  }

  function hitCell(x, y) {
    ensureDragHitCacheFresh();
    var probe = getDragProbe(x, y);
    var px = probe.x;
    var py = probe.y;
    var widgetDrag = drag.active && drag.dragKind === 'widget';
    var entries = dragHitCache.entries;
    var cellAtPoint = null;
    var i, e;

    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.kind !== 'cell') continue;
      if (pointInRect(px, py, e)) { cellAtPoint = e.el; break; }
    }
    if (widgetDrag && cellAtPoint) return cellAtPoint;

    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.kind === 'cell') continue;
      if (widgetDrag && e.kind === 'widget') continue;
      if (pointInRect(px, py, e)) return e.el;
    }
    if (cellAtPoint) return cellAtPoint;

    var dr = dragHitCache.dockRect;
    if (dr && py >= dr.top - 24 && py <= dr.bottom + 24 &&
        px >= dr.left - 24 && px <= dr.right + 24) {
      return resolveDockDropTargetCached(px, py, null);
    }
    return findNearestGridSlotCached(px, py);
  }

  function checkDragPageEdge(clientX) {
    if (!drag.active) return;
    var now = Date.now();
    if (now < pageEdgeSwitchAt) return;
    var vp = $('desk-custom-viewport');
    if (!vp) return;
    var r = vp.getBoundingClientRect();
    var layout = getLayout();
    var atLeft = clientX <= r.left + PAGE_EDGE_PX;
    var atRight = clientX >= r.right - PAGE_EDGE_PX;

    if (!atLeft && !atRight) {
      pageEdgeDwellStart = 0;
      pageEdgeSide = null;
      return;
    }

    var side = atLeft ? 'left' : 'right';
    if (pageEdgeSide !== side) {
      pageEdgeSide = side;
      pageEdgeDwellStart = now;
      return;
    }
    if (now - pageEdgeDwellStart < PAGE_EDGE_HOLD_MS) return;

    pageEdgeSwitchAt = now + PAGE_EDGE_COOLDOWN_MS;
    pageEdgeDwellStart = 0;
    pageEdgeSide = null;

    if (side === 'left') {
      if (currentPage > 0) setCustomPage(currentPage - 1);
      return;
    }
    if (currentPage < layout.pages.length - 1) {
      setCustomPage(currentPage + 1);
    } else {
      addCustomPage();
      setCustomPage(currentPage + 1);
    }
  }

  function canDrop(from, toElOrSlot) {
    var to = resolveSlot(toElOrSlot);
    if (!from || !to) return false;
    var layout = getLayout();

    if (from.type === 'dock') {
      if (!layout.dockSlots[from.index]) return false;
      if (to.type === 'dock' && from.index === to.index) return false;
      if (to.type === 'dock') return true;
      if (to.type === 'grid') {
        var pageDock = layout.pages[to.page];
        if (!pageDock) return false;
        var occupantDock = findItemAt(pageDock, to.x, to.y);
        if (occupantDock && occupantDock.kind === 'widget') return false;
        if (occupantDock && occupantDock.kind === 'app') return true;
        return canPlaceRect(pageDock.items, to.x, to.y, 1, 1, null);
      }
      return false;
    }

    var fromItem = getItemInSlot(layout, from);
    if (!fromItem) return false;

    if (fromItem.kind !== 'app' && to.type === 'dock') return false;

    if (from.type === 'grid' && to.type === 'grid') {
      if (from.page === to.page && from.x === to.x && from.y === to.y) return false;
      var toPage = layout.pages[to.page];
      if (!toPage) return false;
      if (fromItem.kind === 'widget') {
        return !!getWidgetDropAnchor(layout, from, to);
      }
      var toItem = findItemAt(toPage, to.x, to.y);
      if (toItem && toItem.kind === 'widget') return false;
      if (toItem && toItem.kind === 'app') return true;
      return canPlaceRect(
        toPage.items, to.x, to.y, 1, 1,
        from.page === to.page ? fromItem.id : null
      );
    }

    if (fromItem.kind === 'app') {
      if (from.type === 'grid' && to.type === 'dock') return true;
    }
    return false;
  }

  function applyGridMove(from, to) {
    var layout = getLayout();
    var fromPage = layout.pages[from.page];
    var toPage = layout.pages[to.page];
    if (!fromPage || !toPage) return false;

    var fromItem = getItemInSlot(layout, from);
    if (!fromItem) return false;

    if (fromItem.kind === 'widget') {
      var anchor = getWidgetDropAnchor(layout, from, to);
      if (!anchor) return false;
      fromPage.items = fromPage.items.filter(function (it) { return it.id !== fromItem.id; });
      fromItem.x = anchor.x;
      fromItem.y = anchor.y;
      toPage.items.push(fromItem);
      saveLayout(layout);
      return true;
    }

    var toItem = findItemAt(toPage, to.x, to.y);
    if (from.page === to.page) {
      if (toItem && toItem.kind === 'app') {
        var tx = toItem.x; var ty = toItem.y;
        toItem.x = fromItem.x; toItem.y = fromItem.y;
        fromItem.x = tx; fromItem.y = ty;
      } else {
        if (!canPlaceRect(fromPage.items, to.x, to.y, 1, 1, fromItem.id)) return false;
        fromItem.x = to.x;
        fromItem.y = to.y;
      }
      saveLayout(layout);
      return true;
    }

    if (toItem) {
      if (toItem.kind !== 'app') return false;
      fromPage.items = fromPage.items.filter(function (it) { return it.id !== fromItem.id; });
      toPage.items = toPage.items.filter(function (it) { return it.id !== toItem.id; });
      var ox = fromItem.x; var oy = fromItem.y;
      fromItem.x = to.x; fromItem.y = to.y;
      toItem.x = ox; toItem.y = oy;
      fromPage.items.push(toItem);
      toPage.items.push(fromItem);
    } else {
      if (!canPlaceRect(toPage.items, to.x, to.y, 1, 1, null)) return false;
      fromPage.items = fromPage.items.filter(function (it) { return it.id !== fromItem.id; });
      fromItem.x = to.x;
      fromItem.y = to.y;
      toPage.items.push(fromItem);
    }
    saveLayout(layout);
    return true;
  }

  function applyDrop(from, to) {
    var layout = getLayout();
    var dock = layout.dockSlots.slice();

    if (from.type === 'dock' && to.type === 'dock') {
      var tmp = dock[from.index];
      dock[from.index] = dock[to.index] || null;
      dock[to.index] = tmp || null;
      saveLayout({ pages: layout.pages, dockSlots: dock });
      return true;
    }

    if (from.type === 'grid' && to.type === 'grid') {
      return applyGridMove(from, to);
    }

    if (from.type === 'grid' && to.type === 'dock') {
      var page2 = layout.pages[from.page];
      var fromItem2 = getItemInSlot(layout, from);
      if (!fromItem2 || fromItem2.kind !== 'app') return false;
      var dockApp = dock[to.index];
      dock[to.index] = fromItem2.key;
      if (dockApp) {
        fromItem2.key = dockApp;
      } else {
        page2.items = page2.items.filter(function (it) { return it.id !== fromItem2.id; });
      }
      saveLayout({ pages: layout.pages, dockSlots: dock });
      return true;
    }

    if (from.type === 'dock' && to.type === 'grid') {
      var dockApp2 = dock[from.index];
      if (!dockApp2) return false;
      var page3 = layout.pages[to.page];
      if (!page3) return false;
      var existItem = findItemAt(page3, to.x, to.y);
      if (existItem) {
        if (existItem.kind !== 'app') return false;
        dock[from.index] = existItem.key;
        existItem.key = dockApp2;
      } else {
        if (!canPlaceRect(page3.items, to.x, to.y, 1, 1, null)) return false;
        dock[from.index] = null;
        page3.items.push({
          id: genItemId(), kind: 'app', key: dockApp2,
          x: to.x, y: to.y, w: 1, h: 1
        });
      }
      saveLayout({ pages: layout.pages, dockSlots: dock });
      return true;
    }

    return false;
  }

  function buildGhost(sourceEl) {
    var visualEl = (drag.dragKind === 'app' && drag.sourceEl) ? drag.sourceEl : sourceEl;
    var rect = visualEl.getBoundingClientRect();
    drag.grabOX = drag.startX - rect.left;
    drag.grabOY = drag.startY - rect.top;
    drag.ghostW = rect.width;
    drag.ghostH = rect.height;
    var tx = drag.startX - drag.grabOX;
    var ty = drag.startY - drag.grabOY;
    var ghost = document.createElement('div');
    ghost.className = 'desk-custom-drag-ghost';
    if (drag.dragKind === 'app' && drag.sourceEl) {
      ghost.classList.add('desk-custom-drag-ghost--app');
      var iconClone = drag.sourceEl.cloneNode(true);
      iconClone.classList.remove('is-drag-source', 'is-press-pending');
      iconClone.removeAttribute('data-app');
      ghost.appendChild(iconClone);
    } else {
      var clone = sourceEl.cloneNode(true);
      clone.classList.remove('is-drag-source', 'is-press-pending');
      clone.removeAttribute('data-app');
      ghost.appendChild(clone);
    }
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(1.06)';
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    ghostPos.x = drag.startX;
    ghostPos.y = drag.startY;
  }

  function flushDragFrame() {
    dragRaf = 0;
    if (!drag.active) return;
    if (drag.ghost) {
      drag.ghost.style.transform =
        'translate3d(' + (ghostPos.x - drag.grabOX) + 'px,' + (ghostPos.y - drag.grabOY) + 'px,0) scale(1.06)';
    }
    checkDragPageEdge(dragPointer.x);
    updateDragHover(dragPointer.x, dragPointer.y);
  }

  function scheduleDragFrame() {
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(flushDragFrame);
  }

  function updateGhost(x, y) {
    if (!drag.ghost) return;
    ghostPos.x = x;
    ghostPos.y = y;
    scheduleDragFrame();
  }

  function updateDragHover(x, y) {
    var cell = hitCell(x, y);
    if (cell === drag.hoverCell) return;
    if (cell && drag.fromSlot && canDrop(drag.fromSlot, cell)) {
      setHoverCell(cell);
    } else {
      clearHover();
    }
  }

  function animateGhostToCell(cell, done) {
    if (!drag.ghost) { if (done) done(); return; }
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    if (!cell || !cell.isConnected) {
      var orphan = drag.ghost;
      drag.ghost = null;
      orphan.remove();
      if (done) done();
      return;
    }
    var rect = cell.getBoundingClientRect();
    var gw = drag.ghostW || drag.ghost.offsetWidth;
    var gh = drag.ghostH || drag.ghost.offsetHeight;
    var tx = rect.left + (rect.width - gw) / 2;
    var ty = rect.top + (rect.height - gh) / 2;
    drag.ghost.classList.add('is-snapping', 'is-dissolving');
    drag.ghost.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(1)';
    var g = drag.ghost;
    drag.ghost = null;
    setTimeout(function () {
      g.remove();
      if (done) done();
    }, 110);
  }

  function finishSuccessfulDrop(targetCell, e, patched) {
    var phone = $('miya-phone-layer');
    if (phone && e && e.pointerId != null) {
      try { phone.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    drag.active = false;
    if (drag.itemWrap) drag.itemWrap.classList.remove('is-drag-source');
    else if (drag.sourceEl) drag.sourceEl.classList.remove('is-drag-source');
    document.documentElement.classList.remove('is-custom-dragging');
    var dragTrack = $('desk-custom-track');
    if (dragTrack) dragTrack.classList.remove('is-dragging');
    refreshEmptySlotVisibility();
    animateGhostToCell(targetCell, function () { cleanupDragState(e, { skipRender: patched }); });
  }

  function enterDragMode() {
    dismissCustomPagerGesture();
    suspendGlass();
    drag.active = true;
    drag.pending = false;
    drag.itemWrap = drag.sourceEl ? drag.sourceEl.closest('.desk-custom__item') : null;
    var ghostSource = drag.itemWrap || drag.sourceEl;
    drag.appKey = drag.sourceEl && drag.sourceEl.getAttribute('data-app');
    drag.itemId = drag.itemWrap ? drag.itemWrap.getAttribute('data-item-id') : null;
    drag.dragKind = drag.itemWrap && drag.itemWrap.classList.contains('desk-custom__item--widget') ? 'widget' : 'app';
    drag.sourceCell = ghostSource ? ghostSource.closest('[data-custom-slot]') : null;
    if (drag.fromSlot && drag.itemId) drag.fromSlot.itemId = drag.itemId;
    pageEdgeSwitchAt = 0;
    pageEdgeDwellStart = 0;
    pageEdgeSide = null;

    document.documentElement.classList.add('is-custom-dragging');
    var track = $('desk-custom-track');
    if (track) track.classList.add('is-dragging');
    refreshEmptySlotVisibility();
    if (!ghostSource) {
      drag.active = false;
      document.documentElement.classList.remove('is-custom-dragging');
      if (track) track.classList.remove('is-dragging');
      return;
    }
    buildGhost(ghostSource);
    buildDragHitCache();
    if (drag.itemWrap) drag.itemWrap.classList.add('is-drag-source');
    else if (drag.sourceEl) drag.sourceEl.classList.add('is-drag-source');
    var phone = $('miya-phone-layer');
    if (phone && drag.pointerId != null) {
      try { phone.setPointerCapture(drag.pointerId); } catch (e) {}
    }
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
  }

  function cancelPending() {
    drag.pending = false;
    drag.wasWidgetTap = false;
    drag.tapItemId = null;
    drag.startScrollLeft = 0;
    if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
    if (drag.sourceEl) drag.sourceEl.classList.remove('is-press-pending');
    if (drag.itemWrap) drag.itemWrap.classList.remove('is-press-pending');
  }

  function currentTrackScrollLeft() {
    var track = $('desk-custom-track');
    return track ? track.scrollLeft : 0;
  }

  function hasPendingScrollMoved() {
    return Math.abs(currentTrackScrollLeft() - (drag.startScrollLeft || 0)) > 4;
  }

  function armLongPressEdit(pointerId) {
    if (drag.timer) clearTimeout(drag.timer);
    drag.timer = setTimeout(function () {
      if (!drag.pending || drag.pointerId !== pointerId) return;
      /* 已经在翻页就别进编辑，避免手势被截成「要滑两次」 */
      if (hasPendingScrollMoved()) {
        cancelPending();
        drag.pointerId = null;
        drag.sourceEl = null;
        drag.fromSlot = null;
        return;
      }
      drag.wasWidgetTap = false;
      drag.tapItemId = null;
      enterEditMode();
    }, LONG_PRESS_MS);
  }

  function cleanupDragState(e, opts) {
    opts = opts || {};
    cancelPending();
    clearHover();
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    invalidateDragHitCache();
    if (drag.itemWrap) drag.itemWrap.classList.remove('is-drag-source');
    if (drag.sourceEl) drag.sourceEl.classList.remove('is-drag-source', 'is-press-pending');
    drag.active = false;
    drag.pointerId = null;
    drag.fromSlot = null;
    drag.sourceEl = null;
    drag.sourceCell = null;
    drag.appKey = null;
    drag.itemId = null;
    drag.itemWrap = null;
    drag.dragKind = null;
    drag.wasWidgetTap = false;
    drag.tapItemId = null;
    pageEdgeSwitchAt = 0;
    pageEdgeDwellStart = 0;
    pageEdgeSide = null;
    var phone = $('miya-phone-layer');
    if (phone && e && e.pointerId != null) {
      try { phone.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    document.documentElement.classList.remove('is-custom-dragging');
    var dragTrack = $('desk-custom-track');
    if (dragTrack) dragTrack.classList.remove('is-dragging');
    if (opts.skipRender) {
      refreshEmptySlotVisibility();
    } else {
      requestAnimationFrame(function () { renderCustomLayout(); });
    }
  }

  function endDrag(commit, e) {
    if (!drag.active) { cleanupDragState(e, { skipRender: true }); return; }
    dragConsumedUntil = Date.now() + 420;
    var targetCell = drag.hoverCell;
    var fromSlot = drag.fromSlot;
    var toSlot = targetCell ? resolveSlot(targetCell) : null;
    var valid = commit && fromSlot && toSlot && canDrop(fromSlot, toSlot);
    if (valid && applyDrop(fromSlot, toSlot)) {
      var patched = patchDropDom(fromSlot, toSlot);
      finishSuccessfulDrop(targetCell, e, patched);
      return;
    }
    var phone = $('miya-phone-layer');
    if (phone && e && e.pointerId != null) {
      try { phone.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    drag.active = false;
    if (drag.itemWrap) drag.itemWrap.classList.remove('is-drag-source');
    else if (drag.sourceEl) drag.sourceEl.classList.remove('is-drag-source');
    document.documentElement.classList.remove('is-custom-dragging');
    if (drag.ghost) {
      var r = drag.ghost.getBoundingClientRect();
      drag.ghost.style.setProperty('--gx', r.left + 'px');
      drag.ghost.style.setProperty('--gy', r.top + 'px');
      drag.ghost.classList.add('is-cancelled');
      var g = drag.ghost;
      setTimeout(function () { g.remove(); }, 120);
      drag.ghost = null;
    }
    cleanupDragState(e, { skipRender: true });
  }

  function isCustomOverlayTarget(el) {
    return !!(el && el.closest && el.closest(
      '.desk-custom-wg-editor, .desk-custom-wg-picker, .desk-custom-add-wg'
    ));
  }

  function resolveWidgetAtPoint(clientX, clientY, eventTarget) {
    if (wgEditorState.open) return null;
    var vp = $('desk-custom-viewport');
    if (!vp || vp.hidden) return null;
    if (isCustomOverlayTarget(eventTarget)) return null;
    var i;
    if (eventTarget && eventTarget.closest) {
      var direct = eventTarget.closest('.desk-custom__item--widget');
      if (direct && vp.contains(direct)) return direct;
    }
    var stack = null;
    try {
      if (typeof document.elementsFromPoint === 'function') {
        stack = document.elementsFromPoint(clientX, clientY);
      }
    } catch (err) {
      stack = null;
    }
    if (stack && stack.length) {
      for (i = 0; i < stack.length; i++) {
        var el = stack[i];
        if (!el || !el.closest) continue;
        /* 先碰到编辑/选择浮层就停止，禁止穿透到主屏组件 */
        if (el.closest('.desk-custom-wg-editor, .desk-custom-wg-picker')) return null;
        var hit = el.closest('.desk-custom__item--widget');
        if (hit && vp.contains(hit)) return hit;
      }
    }
    /* 最后用包围盒兜底：安卓部分机型 elementsFromPoint 对 grid 重叠不可靠 */
    var widgets = vp.querySelectorAll('.desk-custom__item--widget');
    var best = null;
    var bestArea = Infinity;
    for (i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      var r = w.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      var area = r.width * r.height;
      if (area > 0 && area < bestArea) {
        bestArea = area;
        best = w;
      }
    }
    return best;
  }

  function onPointerDown(e) {
    if (getLayoutMode() !== 'custom') return;
    if (wgEditorState.open || isCustomOverlayTarget(e.target)) return;
    if (drag.active || drag.pending) return;
    var removeBtn = e.target.closest('.desk-custom__wg-remove');
    if (removeBtn && editMode) {
      var itemEl = removeBtn.closest('[data-item-id]');
      if (itemEl) {
        removeWidgetItem(itemEl.getAttribute('data-item-id'));
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    /* 安卓：重叠格子可能抢走 target，用坐标回找真正的小组件 */
    var widgetItem = resolveWidgetAtPoint(e.clientX, e.clientY, e.target);
    if (widgetItem && !e.target.closest('.desk-custom__wg-remove')) {
      if (editMode) {
        dismissCustomPagerGesture();
        drag.pending = true;
        drag.pointerId = e.pointerId;
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.pressAt = Date.now();
        drag.tapItemId = widgetItem.getAttribute('data-item-id');
        drag.itemWrap = widgetItem;
        drag.sourceEl = widgetItem.querySelector('.desk-custom__wg') || widgetItem;
        drag.fromSlot = parseSlotEl(widgetItem);
        if (drag.fromSlot) {
          drag.fromSlot.itemId = widgetItem.getAttribute('data-item-id');
          drag.fromSlot.page = pageIndexFromEl(widgetItem);
        }
        widgetItem.classList.add('is-press-pending');
        /* 阻止翻页滚动抢走手势，与 App 图标 touch-action:none 对齐 */
        if (e.cancelable) e.preventDefault();
        var phoneLayer = $('miya-phone-layer');
        if (phoneLayer && e.pointerId != null) {
          try { phoneLayer.setPointerCapture(e.pointerId); } catch (err) {}
        }
        return;
      }
      drag.pending = true;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.pressAt = Date.now();
      drag.startScrollLeft = currentTrackScrollLeft();
      drag.wasWidgetTap = true;
      drag.tapItemId = widgetItem.getAttribute('data-item-id');
      drag.sourceEl = widgetItem;
      drag.itemWrap = widgetItem;
      widgetItem.classList.add('is-press-pending');
      /* 安卓顶部：不 preventDefault / 不 capture 时，首行点按常被过度滚动掐掉 */
      if (e.cancelable) e.preventDefault();
      var phoneBrowse = $('miya-phone-layer');
      if (phoneBrowse && e.pointerId != null) {
        try { phoneBrowse.setPointerCapture(e.pointerId); } catch (err) {}
      }
      armLongPressEdit(e.pointerId);
      return;
    }

    var el = e.target.closest('.desk-custom__ic, .desk-custom__dock-ic');
    if (!el) return;
    if (e.target.closest('.foot__dock-dismiss')) return;
    if (editMode) dismissCustomPagerGesture();
    drag.pending = true;
    drag.pointerId = e.pointerId;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.pressAt = Date.now();
    drag.startScrollLeft = currentTrackScrollLeft();
    drag.sourceEl = el;
    drag.itemWrap = el.closest('.desk-custom__item--app');
    drag.fromSlot = parseSlotEl(el);
    if (drag.fromSlot && drag.fromSlot.type === 'grid') {
      drag.fromSlot.page = pageIndexFromEl(el);
      if (drag.itemWrap) drag.fromSlot.itemId = drag.itemWrap.getAttribute('data-item-id');
    }
    if (drag.fromSlot && drag.fromSlot.type === 'dock' && !getLayout().dockSlots[drag.fromSlot.index]) {
      drag.pending = false;
      drag.pointerId = null;
      drag.sourceEl = null;
      drag.fromSlot = null;
      drag.itemWrap = null;
      return;
    }
    if (!hasDragTarget(drag.fromSlot)) {
      drag.pending = false;
      drag.pointerId = null;
      drag.sourceEl = null;
      drag.fromSlot = null;
      drag.itemWrap = null;
      return;
    }
    if (drag.itemWrap) drag.itemWrap.classList.add('is-press-pending');
    else el.classList.add('is-press-pending');
    if (editMode) {
      if (e.cancelable) e.preventDefault();
      var phoneLayer = $('miya-phone-layer');
      if (phoneLayer && e.pointerId != null) {
        try { phoneLayer.setPointerCapture(e.pointerId); } catch (err) {}
      }
      return;
    }
    armLongPressEdit(e.pointerId);
  }

  function launchCustomDeskApp(appKey) {
    if (!appKey || editMode) return;
    if (global.miyaLaunchApp && global.miyaLaunchApp(appKey)) return;
    var btn = document.querySelector('[data-app="' + appKey + '"]');
    if (btn) btn.click();
  }

  /** 点按打开小组件编辑；安卓顶部竖滑噪音用更宽的纵向容差 */
  function isWidgetTapGesture(dx, dy, asWidget) {
    if (Math.abs(dx) > MOVE_CANCEL_PX) return false;
    var yLimit = asWidget ? MOVE_CANCEL_PX * 3 : MOVE_CANCEL_PX;
    return Math.abs(dy) <= yLimit;
  }

  function tryOpenWidgetFromTap(itemId, e) {
    if (!itemId || wgEditorState.open) return false;
    var found = findLayoutItemById(itemId);
    if (!found || !isEditableWidgetItem(found.item)) return false;
    dragConsumedUntil = Date.now() + 380;
    var tapDef = WIDGET_CATALOG[found.item.widgetId];
    if (!editMode && tapDef && tapDef.tapUpload) {
      triggerWidgetQuickUpload(itemId, tapDef.tapUpload);
    } else {
      openWidgetEditor(itemId);
    }
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    return true;
  }

  function onPointerMove(e) {
    if (wgEditorState.open) return;
    if (drag.pointerId !== e.pointerId) return;
    if (drag.pending && !drag.active) {
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (editMode) {
        if (e.cancelable) e.preventDefault();
        if (Math.abs(dx) > DRAG_START_PX || Math.abs(dy) > DRAG_START_PX) enterDragMode();
        return;
      }
      /* 小组件：安卓顶部常有竖向抖动，勿因小幅 dy 取消点按；横滑/翻页仍立即放弃 */
      if (drag.wasWidgetTap) {
        if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX * 3 || hasPendingScrollMoved()) {
          cancelPending();
          drag.pointerId = null;
          drag.sourceEl = null;
          drag.fromSlot = null;
        }
        return;
      }
      /* 横滑优先：明显横向位移时立刻放弃长按，把滚动交给页面 */
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX || hasPendingScrollMoved()) {
        cancelPending();
        drag.pointerId = null;
        drag.sourceEl = null;
        drag.fromSlot = null;
      }
      return;
    }
    if (!drag.active) return;
    e.preventDefault();
    dragPointer.x = e.clientX;
    dragPointer.y = e.clientY;
    ghostPos.x = e.clientX;
    ghostPos.y = e.clientY;
    scheduleDragFrame();
  }

  function onPointerUp(e) {
    if (wgEditorState.open) {
      if (drag.pointerId === e.pointerId) {
        cancelPending();
        drag.pointerId = null;
        drag.sourceEl = null;
        drag.fromSlot = null;
        var phoneOpen = $('miya-phone-layer');
        if (phoneOpen && e.pointerId != null) {
          try { phoneOpen.releasePointerCapture(e.pointerId); } catch (err) {}
        }
      }
      return;
    }
    if (drag.pointerId !== e.pointerId) return;
    if (drag.active) endDrag(true, e);
    else if (drag.pending) {
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      var asWidget = !!(drag.wasWidgetTap || (drag.itemWrap && drag.itemWrap.classList.contains('desk-custom__item--widget')));
      var wasTap = isWidgetTapGesture(dx, dy, asWidget);
      var widgetWrap = drag.itemWrap && drag.itemWrap.classList.contains('desk-custom__item--widget')
        ? drag.itemWrap : null;
      var itemId = drag.tapItemId || (widgetWrap && widgetWrap.getAttribute('data-item-id'));
      var sourceEl = drag.sourceEl;
      var appBtn = sourceEl && sourceEl.matches && sourceEl.matches('.desk-custom__ic, .desk-custom__dock-ic')
        ? sourceEl : null;
      var appKey = appBtn ? appBtn.getAttribute('data-app') : null;
      var pressAge = Date.now() - (drag.pressAt || 0);
      cancelPending();
      drag.pointerId = null;
      drag.sourceEl = null;
      drag.fromSlot = null;
      var phone = $('miya-phone-layer');
      if (phone && e.pointerId != null) {
        try { phone.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (wasTap && itemId && pressAge < LONG_PRESS_MS - 40) {
        if (tryOpenWidgetFromTap(itemId, e)) return;
      }
      if (wasTap && appKey && !editMode && pressAge < LONG_PRESS_MS - 40) {
        dragConsumedUntil = Date.now() + 380;
        e.preventDefault();
        e.stopPropagation();
        launchCustomDeskApp(appKey);
      }
    } else {
      cancelPending();
      drag.pointerId = null;
      drag.sourceEl = null;
      drag.fromSlot = null;
    }
  }

  function onPointerCancel(e) {
    if (drag.pointerId !== e.pointerId) return;
    if (drag.active) {
      endDrag(false, e);
      return;
    }
    /* 安卓顶部：点按常被系统收成 pointercancel，短按仍视为打开编辑 */
    if (drag.pending && drag.wasWidgetTap && drag.tapItemId) {
      var pressAge = Date.now() - (drag.pressAt || 0);
      var itemId = drag.tapItemId;
      if (pressAge < LONG_PRESS_MS - 40 && !hasPendingScrollMoved()) {
        cancelPending();
        drag.pointerId = null;
        drag.sourceEl = null;
        drag.fromSlot = null;
        var phoneKeep = $('miya-phone-layer');
        if (phoneKeep && e.pointerId != null) {
          try { phoneKeep.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        tryOpenWidgetFromTap(itemId, e);
        return;
      }
    }
    cancelPending();
    drag.pointerId = null;
    drag.sourceEl = null;
    drag.fromSlot = null;
    var phone = $('miya-phone-layer');
    if (phone && e.pointerId != null) {
      try { phone.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  }

  function onAndroidTouchEndFallback(e) {
    if (!document.documentElement.classList.contains('is-android') &&
        !(document.documentElement.classList.contains('is-mobile') &&
          !document.documentElement.classList.contains('is-ios'))) {
      return;
    }
    if (getLayoutMode() !== 'custom' || editMode || drag.active) return;
    if (Date.now() < dragConsumedUntil || wgEditorState.open) return;
    if (isCustomOverlayTarget(e.target)) return;
    var touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    /* 若 pointer 路径已接管，不再重复打开 */
    if (drag.pending || drag.pointerId != null) return;
    var widgetItem = resolveWidgetAtPoint(touch.clientX, touch.clientY, e.target);
    if (!widgetItem) return;
    var itemId = widgetItem.getAttribute('data-item-id');
    if (tryOpenWidgetFromTap(itemId, e)) return;
  }

  function onWidgetClickFallback(e) {
    if (getLayoutMode() !== 'custom' || editMode || drag.active || drag.pending) return;
    if (Date.now() < dragConsumedUntil) return;
    if (wgEditorState.open || isCustomOverlayTarget(e.target)) return;
    var widgetItem = resolveWidgetAtPoint(e.clientX, e.clientY, e.target);
    if (!widgetItem || (e.target.closest && e.target.closest('.desk-custom__wg-remove'))) return;
    var itemId = widgetItem.getAttribute('data-item-id');
    if (tryOpenWidgetFromTap(itemId, e)) return;
  }

  function onEditModeTap(e) {
    if (!editMode || drag.active || drag.pending) return;
    if (Date.now() < dragConsumedUntil) return;
    if (getLayoutMode() !== 'custom') return;
    if (Date.now() < customPagerSwipedUntil) return;
    if (wgEditorState.open || isCustomOverlayTarget(e.target)) return;
    if (e.target.closest('.desk-custom__ic, .desk-custom__dock-ic')) return;
    if (e.target.closest('.desk-custom__item--widget')) return;
    if (e.target.closest('.desk-custom-add-wg, .desk-custom-wg-picker')) return;
    if (e.target.closest('.desk-custom__wg-remove')) return;
    if (e.target.closest('.foot__dock-dismiss')) return;
    exitEditMode();
  }

  function bindCustomDrag() {
    if (dragBound) return;
    dragBound = true;
    var phone = $('miya-phone-layer');
    if (!phone) return;
    phone.addEventListener('pointerdown', onPointerDown);
    phone.addEventListener('pointermove', onPointerMove, { passive: false });
    phone.addEventListener('pointerup', onPointerUp);
    phone.addEventListener('pointercancel', onPointerCancel);
    if (!editBound) {
      editBound = true;
      phone.addEventListener('click', onEditModeTap, true);
      /* 安卓：pointer 序列被取消时，仍可能落到 click，作打开编辑兜底 */
      phone.addEventListener('click', onWidgetClickFallback, true);
      /* 安卓顶部：部分机型只派发 touch、不派发完整 pointer */
      phone.addEventListener('touchend', onAndroidTouchEndFallback, { capture: true, passive: true });
    }
  }

  /* ── 自定义方案 ── */

  function getCustomPresets() {
    loadCustomPresets();
    return customPresetsCache.slice();
  }

  function saveCustomPreset(name) {
    var theme = global.miyaGetCustomDeskTheme ? global.miyaGetCustomDeskTheme() : loadCustomTheme();
    var preset = {
      id: genId('cpreset'),
      name: String(name || '未命名').trim() || '未命名',
      savedAt: Date.now(),
      theme: JSON.parse(JSON.stringify(theme))
    };
    var list = getCustomPresets();
    list.push(preset);
    persistCustomPresets(list);
    return preset;
  }

  function loadCustomPreset(id) {
    var found = getCustomPresets().filter(function (p) { return p.id === id; })[0];
    if (!found || !found.theme) return Promise.resolve(false);
    return Promise.resolve(global.miyaSetCustomDeskTheme(found.theme)).then(function () {
      return applyCustomDeskTheme().then(function () { return true; });
    });
  }

  function deleteCustomPreset(id) {
    var list = getCustomPresets().filter(function (p) { return p.id !== id; });
    persistCustomPresets(list);
  }

  function applyCustomWidgetLibraryFromTheme(theme) {
    var tpl = getCustomWgTpl();
    if (!tpl || !theme || !Array.isArray(theme.customWidgetLibrary)) return Promise.resolve();
    return tpl.mergePresets(theme.customWidgetLibrary, 'upsert').then(function () {
      syncCustomWidgetCatalog();
    });
  }

  function initCustomDesk() {
    return whenCustomDeskReady().then(function () {
      var tpl = getCustomWgTpl();
      var ready = tpl && tpl.whenReady ? tpl.whenReady() : Promise.resolve([]);
      return ready.then(function () {
        syncCustomWidgetCatalog();
        ensureLayoutCustomWidgetsInCatalog(customThemeState && customThemeState.layout);
        captureFixedDock();
        bindCustomDrag();
        bindCustomPager();
        bindWidgetPicker();
        bindWidgetEditor();
        setLayoutMode(getLayoutMode());
        return applyActiveLayout();
      });
    });
  }

  global.miyaGetDeskLayoutMode = getLayoutMode;
  global.miyaSetDeskLayoutMode = setLayoutMode;
  global.miyaSwitchDeskLayout = switchDeskLayout;
  global.miyaCustomDragDidConsume = function () {
    return Date.now() < dragConsumedUntil || Date.now() < customPagerSwipedUntil;
  };
  global.miyaCustomEditModeActive = function () {
    return editMode || wgEditorState.open;
  };
  global.miyaGetCustomDeskTheme = function () {
    if (!customThemeState) loadCustomTheme();
    var snap = snapshotCustomTheme();
    return Object.assign({}, snap, {
      icons: Object.assign({}, snap.icons || {}),
      memoAvas: Object.assign({}, snap.memoAvas || {}),
      polaroids: Object.assign({}, snap.polaroids || {}),
      copy: Object.assign({}, snap.copy || {}),
      layout: normalizeLayout(snap.layout),
      customWidgetLibrary: (snap.customWidgetLibrary || []).slice()
    });
  };
  global.miyaSetCustomDeskTheme = function (partial) {
    if (!customThemeState) loadCustomTheme();
    if (!partial || typeof partial !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(partial, 'icons')) {
      customThemeState.icons = Object.assign({}, partial.icons || {});
      delete partial.icons;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'memoAvas')) {
      customThemeState.memoAvas = Object.assign({}, partial.memoAvas || {});
      delete partial.memoAvas;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'polaroids')) {
      customThemeState.polaroids = Object.assign({}, partial.polaroids || {});
      delete partial.polaroids;
    }
    if (partial.copy) {
      customThemeState.copy = Object.assign({}, customThemeState.copy || {}, partial.copy);
      delete partial.copy;
    }
    if (partial.layout) {
      customThemeState.layout = normalizeLayout(partial.layout);
      delete partial.layout;
    }
    var libraryPromise = Promise.resolve();
    if (Object.prototype.hasOwnProperty.call(partial, 'customWidgetLibrary')) {
      libraryPromise = applyCustomWidgetLibraryFromTheme(partial);
      delete partial.customWidgetLibrary;
    }
    Object.assign(customThemeState, partial);
    saveCustomTheme();
    return libraryPromise;
  };
  global.miyaApplyCustomDesk = applyCustomDeskTheme;
  global.miyaInitCustomDesk = initCustomDesk;
  global.miyaSyncCustomWidgetCatalog = syncCustomWidgetCatalog;
  global.miyaCUSTOM_GRID_APPS = CUSTOM_GRID_APPS.slice();
  global.miyaCUSTOM_DESK_ICON_KEYS = CUSTOM_ICON_KEYS.slice();
  global.miyaCUSTOM_DESK_LABELS = Object.assign({}, APP_LABELS);
  global.miyaCUSTOM_WIDGET_CATALOG = WIDGET_CATALOG;
  global.miyaCUSTOM_WIDGET_EDITOR_FIELDS = WIDGET_EDITOR_FIELDS;
  global.miyaBuildCustomWidgetPreview = buildCustomWidgetPreview;

  function mountCustomWidgetEmbed(widgetId, config) {
    var wg = createWidgetElement(widgetId);
    if (!wg) return null;
    var removeBtn = wg.querySelector('.desk-custom__wg-remove');
    if (removeBtn) removeBtn.remove();
    paintWidgetElement(wg, {
      kind: 'widget',
      widgetId: widgetId,
      config: config || null
    });
    return wg;
  }

  global.miyaMountCustomWidgetEmbed = mountCustomWidgetEmbed;

  global.miyaGetEditableCustomWidgetIds = function () {
    syncCustomWidgetCatalog();
    return Object.keys(WIDGET_CATALOG).filter(function (id) {
      var def = WIDGET_CATALOG[id];
      if (!def || !def.editable || !def.widget) return false;
      if (def.widget === 'custom') return true;
      return !!WIDGET_EDITOR_FIELDS[def.widget];
    });
  };
  global.miyaOpenCustomWidgetEditor = openWidgetEditor;
  global.miyaGetCustomPresets = getCustomPresets;
  global.miyaSaveCustomPreset = saveCustomPreset;
  global.miyaLoadCustomPreset = loadCustomPreset;
  global.miyaDeleteCustomPreset = deleteCustomPreset;
  global.miyaCustomDeskStore = {
    STORE_KEYS: [CUSTOM_META_KEY, CUSTOM_PRESETS_KEY, LAYOUT_MODE_KEY],
    whenReady: whenCustomDeskReady,
    persistTheme: persistCustomTheme,
    persistPresets: persistCustomPresets,
    persistLayoutMode: persistLayoutMode
  };
  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore(global.miyaCustomDeskStore);
  }
  /* 模板库就绪后同步 catalog（脚本可能后于 desk-custom 加载） */
  setTimeout(function () {
    try {
      var tpl = getCustomWgTpl();
      if (tpl && tpl.whenReady) {
        tpl.whenReady().then(function () { syncCustomWidgetCatalog(); });
      } else {
        syncCustomWidgetCatalog();
      }
    } catch (eSync) {}
  }, 0);
  whenCustomDeskReady();
  global.miyaCustomSetWallpaper = function (ref) {
    global.miyaSetCustomDeskTheme({ wallpaper: ref });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
  global.miyaCustomSetIcon = function (key, ref) {
    var icons = Object.assign({}, (customThemeState || loadCustomTheme()).icons || {});
    if (ref) icons[key] = ref; else delete icons[key];
    global.miyaSetCustomDeskTheme({ icons: icons });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
  global.miyaCustomClearWallpaper = function () {
    global.miyaSetCustomDeskTheme({ wallpaper: null });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
  global.miyaCustomSetProfileBg = function (ref) {
    global.miyaSetCustomDeskTheme({ profileBg: ref || null });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
  global.miyaCustomSetMemoAva = function (key, ref) {
    var memoAvas = Object.assign({}, (customThemeState || loadCustomTheme()).memoAvas || {});
    if (ref) memoAvas[key] = ref; else delete memoAvas[key];
    global.miyaSetCustomDeskTheme({ memoAvas: memoAvas });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
  global.miyaCustomSetPolaroid = function (key, ref) {
    var polaroids = Object.assign({}, (customThemeState || loadCustomTheme()).polaroids || {});
    if (ref) polaroids[key] = ref; else delete polaroids[key];
    global.miyaSetCustomDeskTheme({ polaroids: polaroids });
    return getLayoutMode() === 'custom' ? applyCustomDeskTheme() : Promise.resolve();
  };
})(window);
