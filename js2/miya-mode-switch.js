(function (global) {
  'use strict';

  var MODES = {
    sim: { id: 'sim', bodyClass: 'miya-mode-sim', layerId: 'miya-simulator-app', label: '模拟器' },
    phone: { id: 'phone', bodyClass: 'miya-mode-phone', layerId: 'miya-phone-layer', label: '小手机' },
    world: { id: 'world', bodyClass: 'miya-mode-world', layerId: 'miya-world-app', label: '大世界' }
  };

  var currentMode = 'phone';
  var transitioning = false;
  var simInited = false;

  function $(id) { return document.getElementById(id); }

  function getLayer(modeId) {
    var cfg = MODES[modeId];
    if (!cfg) return null;
    if (modeId === 'phone') return document.querySelector('.phone.miya-mode-layer');
    return $(cfg.layerId);
  }

  function railShouldShow() {
    return currentMode === 'sim' || currentMode === 'world';
  }

  function syncRail() {
    var rail = $('miya-mode-rail');
    if (!rail) return;
    var show = railShouldShow();
    rail.hidden = !show;
    rail.setAttribute('aria-hidden', show ? 'false' : 'true');
    rail.querySelectorAll('[data-miya-mode]').forEach(function (btn) {
      var mode = btn.getAttribute('data-miya-mode');
      btn.classList.toggle('is-active', mode === currentMode);
    });
  }

  function ensureRail() {
    if (!railShouldShow()) {
      syncRail();
      return;
    }
    buildRail();
    syncRail();
  }

  function applyBodyClass(modeId) {
    var body = document.body;
    body.classList.remove('miya-mode-sim', 'miya-mode-phone', 'miya-mode-world');
    var cfg = MODES[modeId];
    if (cfg) body.classList.add(cfg.bodyClass);
  }

  function ensureSimulatorReady() {
    var load = global.miyaLazyEnsure
      ? global.miyaLazyEnsure('simulator')
      : Promise.resolve();
    return load.then(function () {
      if (!simInited && global.miyaSimulatorApp && typeof global.miyaSimulatorApp.init === 'function') {
        global.miyaSimulatorApp.init();
        simInited = true;
      }
    });
  }

  function setMode(modeId, opts) {
    opts = opts || {};
    if (transitioning || !MODES[modeId] || modeId === currentMode) return Promise.resolve();
    if (modeId === 'world' && !opts.force) {
      if (global.miyaDialog && global.miyaDialog.alert) {
        global.miyaDialog.alert({ title: '大世界', message: '大世界玩法正在绘制分镜中，敬请期待。' });
      }
      return Promise.resolve();
    }

    var prep = modeId === 'sim' ? ensureSimulatorReady() : Promise.resolve();
    return prep.then(function () {
      transitioning = true;
      var prev = currentMode;
      currentMode = modeId;

      document.body.classList.add('miya-mode-transition');
      applyBodyClass(modeId);
      ensureRail();

      var prevLayer = getLayer(prev);
      var nextLayer = getLayer(modeId);

      if (prevLayer) {
        prevLayer.classList.remove('is-active');
        prevLayer.classList.add('is-leaving');
      }
      if (nextLayer) {
        nextLayer.classList.remove('is-leaving');
        nextLayer.classList.add('is-active');
      }

      if (global.MiyaSimulatorStore) {
        global.MiyaSimulatorStore.setLastMode(modeId === 'sim' ? 'simulator' : modeId);
      }

      return new Promise(function (resolve) {
        setTimeout(function () {
          if (prevLayer) prevLayer.classList.remove('is-leaving');
          document.body.classList.remove('miya-mode-transition');
          transitioning = false;
          resolve();
        }, 680);
      });
    });
  }

  function buildRail() {
    if ($('miya-mode-rail')) return;
    var nav = document.createElement('nav');
    nav.id = 'miya-mode-rail';
    nav.className = 'miya-mode-rail';
    nav.hidden = true;
    nav.setAttribute('aria-hidden', 'true');
    nav.setAttribute('aria-label', '玩法切换');
    nav.innerHTML =
      '<button type="button" class="miya-mode-rail__btn" data-miya-mode="sim">模拟器</button>' +
      '<button type="button" class="miya-mode-rail__btn" data-miya-mode="phone">小手机</button>';
    document.body.appendChild(nav);

    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-miya-mode]');
      if (!btn) return;
      setMode(btn.getAttribute('data-miya-mode'));
    });
  }

  function wrapPhoneLayer() {
    var phone = document.querySelector('.phone');
    if (!phone) return;
    if (!phone.classList.contains('miya-mode-layer')) phone.classList.add('miya-mode-layer');
    if (!phone.id) phone.id = 'miya-phone-layer';
  }

  function applyInitialMode(lastMode) {
    var simLayer = $('miya-simulator-app');
    var phoneLayer = getLayer('phone');
    var worldLayer = $('miya-world-app');

    if (simLayer) simLayer.classList.add('miya-mode-layer');
    if (worldLayer) worldLayer.classList.add('miya-mode-layer');

    currentMode = lastMode;
    applyBodyClass(lastMode);
    ensureRail();

    [simLayer, phoneLayer, worldLayer].forEach(function (layer) {
      if (layer) layer.classList.remove('is-active', 'is-leaving');
    });
    var activeLayer = getLayer(lastMode);
    if (activeLayer) activeLayer.classList.add('is-active');
  }

  function resolveLastMode() {
    if (typeof global.miyaLazyPeekSimMode === 'function') {
      return global.miyaLazyPeekSimMode();
    }
    if (global.MiyaSimulatorStore) {
      var stored = global.MiyaSimulatorStore.getLastMode();
      if (stored === 'simulator' || stored === 'sim') return 'sim';
    }
    return 'phone';
  }

  function init() {
    wrapPhoneLayer();

    var lastMode = resolveLastMode();
    if (lastMode === 'sim') {
      applyInitialMode('phone');
      ensureSimulatorReady().then(function () {
        applyInitialMode('sim');
      }).catch(function () {
        applyInitialMode('phone');
      });
      return;
    }

    applyInitialMode(lastMode);
  }

  global.miyaModeSwitch = {
    init: init,
    setMode: setMode,
    getMode: function () { return currentMode; }
  };
})(window);
