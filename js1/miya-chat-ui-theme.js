/**
 * miya-chat-ui-theme.js — 聊天 UI 主题（INS 高级软刊风）
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-chat-ui-theme';
  var THEMES = ['soft'];
  var current = 'soft';

  function getApp() {
    return document.getElementById('miya-chat-app');
  }

  function getStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'magazine' || v === 'cinema' || v === 'ins' || v === 'noir') return 'soft';
      return THEMES.indexOf(v) >= 0 ? v : 'soft';
    } catch (e) {
      return 'soft';
    }
  }

  function persist(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) { /* ignore */ }
  }

  function applyClasses(theme) {
    var app = getApp();
    if (!app) return;
    app.classList.remove('theme-soft', 'theme-ins');
    app.classList.add('theme-soft', 'theme-ins');
    app.setAttribute('data-chat-ui', theme);
  }

  function apply(theme, opts) {
    opts = opts || {};
    if (THEMES.indexOf(theme) < 0) theme = 'soft';
    var prev = current;
    current = theme;
    persist(theme);
    applyClasses(theme);
    if (global.miyaChatApp && typeof global.miyaChatApp.onUiThemeChange === 'function') {
      global.miyaChatApp.onUiThemeChange(theme, prev);
    }
  }

  function get() {
    return current;
  }

  function toggle() {
    return current;
  }

  function init() {
    apply(getStored(), { animate: false });
  }

  global.miyaChatUiTheme = {
    init: init,
    get: get,
    apply: apply,
    toggle: toggle,
    THEMES: THEMES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
