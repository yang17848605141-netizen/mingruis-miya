/**
 * miya-fun-app.js — 娱乐 · 主页（Ins 极简玻璃果冻）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    bound: false,
    toastTimer: 0
  };

  var GAME_LABELS = {
    sayguess: '你说我猜',
    chain: '成语接龙 / 故事接龙',
    undercover: '谁是卧底',
    escape: '密室逃脱',
    custom: '自定义游戏'
  };

  function toast(msg) {
    var el = $('fn-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2200);
  }

  function openGame(id) {
    if (id === 'custom') {
      toast('自定义游戏稍后开放 · 可上传自己的玩法');
      return;
    }
    if (id === 'sayguess') {
      if (global.miyaFunSayGuessApp && typeof global.miyaFunSayGuessApp.open === 'function') {
        global.miyaFunSayGuessApp.open();
      } else {
        toast('你说我猜加载中，请稍后再试');
      }
      return;
    }
    if (!GAME_LABELS[id]) return;
    toast(GAME_LABELS[id] + ' · 玩法页即将到来');
  }

  function bindEvents() {
    if (state.bound) return;
    var root = $('miya-fun-app');
    if (!root) return;
    state.bound = true;

    var closeBtn = $('fn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeFunApp();
      });
    }

    root.addEventListener('click', function (e) {
      var tile = e.target.closest('[data-fn-game]');
      if (!tile || !root.contains(tile)) return;
      openGame(tile.getAttribute('data-fn-game'));
    });
  }

  function openFunApp() {
    var el = $('miya-fun-app');
    if (!el) return;
    el.removeAttribute('hidden');
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
    if (global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(el);
    bindEvents();
  }

  function closeFunApp() {
    var el = $('miya-fun-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (
      !document.querySelector('.miya-beautify-app.is-open') &&
      !document.querySelector('.miya-settings-app.is-open') &&
      !document.querySelector('.miya-worldbook-app.is-open') &&
      !document.querySelector('.miya-contacts-app.is-open') &&
      !document.querySelector('#miya-music-app.is-open') &&
      !document.querySelector('#miya-chat-app.is-open') &&
      !document.querySelector('#miya-memory-app.is-open') &&
      !document.querySelector('#miya-diary-app.is-open') &&
      !document.querySelector('#miya-theater-app.is-open') &&
      !document.querySelector('#miya-offline-app.is-open') &&
      !document.querySelector('#miya-typewriter-app.is-open') &&
      !document.querySelector('#miya-forum-app.is-open') &&
      !document.querySelector('.miya-cstore-app.is-open') &&
      !document.querySelector('.miya-itinerary-app.is-open') &&
      !document.querySelector('.miya-couple-app.is-open') &&
      !document.querySelector('.miya-weather-app.is-open') &&
      !document.querySelector('.miya-match-app.is-open') &&
      !document.querySelector('#miya-fun-app.is-open') &&
      !document.querySelector('#miya-fun-sayguess.is-open') &&
      !document.querySelector('#miya-deep-app.is-open')
    ) {
      document.body.classList.remove('miya-app-open');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  global.miyaFunApp = {
    open: openFunApp,
    close: closeFunApp
  };
})(typeof window !== 'undefined' ? window : global);
