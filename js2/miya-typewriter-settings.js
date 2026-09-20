/**
 * miya-typewriter-settings.js — 阅读样式设置
 */
(function (global) {
  'use strict';

  var LS_KEY = 'miya-typewriter-settings-v1';

  var FONTS = [
    { id: 'noto-serif', label: '思源宋体', family: '"Noto Serif SC", "Songti SC", STSong, serif' },
    { id: 'noto-sans', label: '思源黑体', family: '"Noto Sans SC", "PingFang SC", -apple-system, sans-serif' },
    { id: 'songti', label: '宋体', family: '"Songti SC", STSong, SimSun, serif' },
    { id: 'kaiti', label: '楷体', family: '"LXGW WenKai SC", "Kaiti SC", STKaiti, "Kaiti TC", KaiTi, serif' },
    { id: 'pingfang', label: '苹方', family: '"PingFang SC", "Noto Sans SC", "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif' },
    { id: 'georgia', label: 'Georgia', family: 'Georgia, "Times New Roman", "Noto Serif SC", serif' },
    { id: 'times', label: 'Times', family: '"Times New Roman", Times, "Noto Serif SC", serif' },
    { id: 'helvetica', label: 'Helvetica', family: '"Helvetica Neue", Helvetica, "Noto Sans SC", Arial, sans-serif' }
  ];

  var BG_THEMES = [
    { id: 'parchment', label: '羊皮纸', paper: '#f5f5dc', text: '#1a1a1a', chrome: '#e8e4d9' },
    { id: 'white', label: '纯白', paper: '#ffffff', text: '#1a1a1a', chrome: '#f5f5f5' },
    { id: 'green', label: '护眼绿', paper: '#c7edcc', text: '#2d4a32', chrome: '#b5dfc0' },
    { id: 'yellow', label: '护眼黄', paper: '#f5f0dc', text: '#4a4228', chrome: '#ebe4c8' },
    { id: 'sepia', label: '复古棕', paper: '#f4ecd8', text: '#3d2f1e', chrome: '#e8dcc4' },
    { id: 'beige', label: '米杏', paper: '#faf3e8', text: '#3a342c', chrome: '#efe6d8' },
    { id: 'blue', label: '雾蓝', paper: '#e8eef5', text: '#2a3545', chrome: '#d8e2ed' },
    { id: 'rose', label: '淡粉', paper: '#faf0f0', text: '#4a3535', chrome: '#efe0e0' },
    { id: 'night', label: '夜间', paper: '#1e1e1e', text: '#c8c8c8', chrome: '#2a2a2a' },
    { id: 'ink', label: '墨黑', paper: '#121212', text: '#b0b0b0', chrome: '#1a1a1a' }
  ];

  var TEXT_COLORS = [
    { id: 'ink', value: '#1a1a1a', label: '墨黑' },
    { id: 'brown', value: '#3d2f1e', label: '深棕' },
    { id: 'slate', value: '#2a3545', label: '靛灰' },
    { id: 'forest', value: '#2d4a32', label: '墨绿' },
    { id: 'wine', value: '#4a2828', label: '酒红' },
    { id: 'light', value: '#c8c8c8', label: '浅灰' }
  ];

  var defaults = {
    fontId: 'noto-serif',
    fontSize: 15,
    colorId: 'ink',
    customColor: '',
    lineHeight: 1.82,
    bgId: 'parchment'
  };

  var settings = Object.assign({}, defaults);
  var ready = false;
  var readyPromise = null;

  function trySyncHydrate() {
    if (ready) return settings;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(LS_KEY);
      if (raw != null) {
        settings = normalize(raw);
        ready = true;
        return settings;
      }
    }
    return null;
  }

  function invalidateCache() {
    settings = Object.assign({}, defaults);
    ready = false;
    readyPromise = null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function findFont(id) {
    return FONTS.find(function (f) { return f.id === id; }) || FONTS[0];
  }

  function findBg(id) {
    return BG_THEMES.find(function (b) { return b.id === id; }) || BG_THEMES[0];
  }

  function findColor(id) {
    return TEXT_COLORS.find(function (c) { return c.id === id; }) || TEXT_COLORS[0];
  }

  function normalize(raw) {
    var s = Object.assign({}, defaults, raw || {});
    s.fontSize = Math.min(24, Math.max(12, parseInt(s.fontSize, 10) || defaults.fontSize));
    s.lineHeight = Math.min(2.4, Math.max(1.4, parseFloat(s.lineHeight) || defaults.lineHeight));
    if (FONTS.every(function (f) { return f.id !== s.fontId; })) s.fontId = defaults.fontId;
    if (BG_THEMES.every(function (b) { return b.id !== s.bgId; })) s.bgId = defaults.bgId;
    if (TEXT_COLORS.every(function (c) { return c.id !== s.colorId; })) s.colorId = defaults.colorId;
    return s;
  }

  function save() {
    if (global.miyaWriteLsJsonKey) return global.miyaWriteLsJsonKey(LS_KEY, settings);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = (global.miyaReadLsJsonKey
      ? global.miyaReadLsJsonKey(LS_KEY, clone(defaults))
      : Promise.resolve(clone(defaults))
    ).then(function (raw) {
      settings = normalize(raw);
      ready = true;
      apply();
      return settings;
    }).catch(function () {
      settings = normalize(defaults);
      ready = true;
      apply();
      return settings;
    });
    return readyPromise;
  }

  function get() {
    trySyncHydrate();
    return clone(settings);
  }

  function update(patch) {
    settings = normalize(Object.assign({}, settings, patch || {}));
    save();
    apply();
    return get();
  }

  function resolveTextColor() {
    if (settings.customColor && /^#[0-9a-fA-F]{3,8}$/.test(settings.customColor)) {
      return settings.customColor;
    }
    return findColor(settings.colorId).value;
  }

  var READER_FONT_SEL = '.tw-reader__page, .tw-reader__page-body, .tw-reader__text, .tw-reader__dropcap, .tw-reader__chapter';

  function applyReaderFont(scope) {
    var root = scope || document.getElementById('miya-typewriter-app');
    if (!root) return;
    var nodes = root.querySelectorAll(READER_FONT_SEL);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].style.removeProperty('font-family');
    }
  }

  function notifyTypographyChange() {
    try {
      document.dispatchEvent(new CustomEvent('miya-tw-read-typography'));
    } catch (e) {}
  }

  function apply() {
    var app = document.getElementById('miya-typewriter-app');
    if (!app) return;
    var font = findFont(settings.fontId);
    var bg = findBg(settings.bgId);
    var color = resolveTextColor();
    var isNight = bg.id === 'night' || bg.id === 'ink';

    app.setAttribute('data-tw-font', settings.fontId);
    app.style.setProperty('--tw-read-font', font.family);
    app.style.setProperty('--tw-read-size', settings.fontSize + 'px');
    app.style.setProperty('--tw-read-lh', String(settings.lineHeight));
    app.style.setProperty('--tw-read-color', color);
    app.style.setProperty('--tw-read-paper', bg.paper);
    app.style.setProperty('--tw-read-chrome', bg.chrome);
    app.classList.toggle('tw-theme-night', isNight);
    app.setAttribute('data-tw-bg', bg.id);
    applyReaderFont(app);
    notifyTypographyChange();
  }

  global.miyaTypewriterSettings = {
    LS_KEY: LS_KEY,
    FONTS: FONTS,
    BG_THEMES: BG_THEMES,
    TEXT_COLORS: TEXT_COLORS,
    defaults: clone(defaults),
    load: load,
    whenReady: function () { return load(); },
    isReady: function () { return ready; },
    invalidateCache: invalidateCache,
    get: get,
    update: update,
    apply: apply,
    applyReaderFont: applyReaderFont
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaTypewriterSettings);
})(window);
