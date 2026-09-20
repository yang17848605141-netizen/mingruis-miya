/**
 * Idle / on-demand loader for non-chat app stacks.
 * Chat + worldbook store/matcher/prompt stay in the critical path.
 * localStorage.miyaPerfOff = '1' → load every group immediately at boot.
 */
(function (global) {
  'use strict';

  var GROUPS = {
    deep: {
      css: [
        'css/miya-deep.css?v=13',
        'css/miya-deep-settings.css?v=1',
        'css/miya-deep-deco.css?v=1',
        'css/miya-deep-music.css?v=4',
        'css/miya-deep-novel.css?v=6',
        'css/miya-deep-notepad.css?v=4',
        'css/miya-deep-wechat.css?v=4',
        'css/miya-deep-sms.css?v=5',
        'css/miya-deep-health.css?v=2',
        'css/miya-deep-todo-gw.css?v=20260715gw',
        'css/miya-deep-couple.css?v=3',
        'css/miya-deep-game.css?v=5',
        'css/miya-deep-assets.css?v=11',
        'css/miya-deep-cloud.css?v=3',
        'css/miya-deep-bili.css?v=10',
        'css/miya-deep-douyin.css?v=10',
        'css/miya-deep-xhs.css?v=7',
        'css/miya-deep-album.css?v=2',
        'css/miya-deep-browser.css?v=3',
        'css/miya-deep-food.css?v=3',
        'css/miya-deep-shop.css?v=2'
      ],
      js: [
        'js2/miya-deep-store.js?v=3',
        'js1/miya-deep-deco.js?v=2',
        'js2/miya-deep-music-store.js?v=1',
        'js2/miya-deep-music-bridge.js?v=6',
        'js2/miya-deep-music.js?v=5',
        'js2/miya-deep-novel-store.js?v=1',
        'js2/miya-deep-novel-bridge.js?v=6',
        'js2/miya-deep-novel.js?v=5',
        'js2/miya-deep-notepad-store.js?v=1',
        'js2/miya-deep-notepad-bridge.js?v=5',
        'js2/miya-deep-notepad.js?v=4',
        'js2/miya-deep-wechat-store.js?v=1',
        'js2/miya-deep-wechat-bridge.js?v=7',
        'js2/miya-deep-wechat.js?v=3',
        'js2/miya-deep-sms-store.js?v=1',
        'js2/miya-deep-sms-bridge.js?v=8',
        'js2/miya-deep-sms.js?v=5',
        'js2/miya-deep-health-store.js?v=1',
        'js2/miya-deep-health-bridge.js?v=7',
        'js2/miya-deep-health.js?v=3',
        'js2/miya-deep-todo-store.js?v=2',
        'js2/miya-deep-todo-bridge.js?v=2',
        'js2/miya-deep-todo.js?v=20260715gw2',
        'js1/miya-deep-couple-store.js?v=2',
        'js1/miya-deep-couple-bridge.js?v=2',
        'js1/miya-deep-couple.js?v=2',
        'js1/miya-deep-game-store.js?v=3',
        'js1/miya-deep-game-bridge.js?v=3',
        'js2/miya-deep-game.js?v=3',
        'js1/miya-deep-assets-store.js?v=2',
        'js1/miya-deep-assets-bridge.js?v=4',
        'js1/miya-deep-assets.js?v=6',
        'js1/miya-deep-cloud-store.js?v=1',
        'js1/miya-deep-cloud-bridge.js?v=2',
        'js1/miya-deep-cloud.js?v=2',
        'js1/miya-deep-bili-store.js?v=2',
        'js1/miya-deep-bili-bridge.js?v=3',
        'js1/miya-deep-bili.js?v=9',
        'js1/miya-deep-douyin-store.js?v=1',
        'js1/miya-deep-douyin-bridge.js?v=3',
        'js1/miya-deep-douyin.js?v=5',
        'js2/miya-deep-xhs-store.js?v=3',
        'js2/miya-deep-xhs-bridge.js?v=4',
        'js2/miya-deep-xhs.js?v=3',
        'js1/miya-deep-album-store.js?v=1',
        'js1/miya-deep-album-bridge.js?v=2',
        'js1/miya-deep-album.js?v=1',
        'js1/miya-deep-browser-store.js?v=1',
        'js1/miya-deep-browser-bridge.js?v=7',
        'js1/miya-deep-browser.js?v=3',
        'js1/miya-deep-food-store.js?v=1',
        'js1/miya-deep-food-bridge.js?v=2',
        'js1/miya-deep-food.js?v=2',
        'js2/miya-deep-shop-store.js?v=1',
        'js2/miya-deep-shop-bridge.js?v=1',
        'js2/miya-deep-shop.js?v=1',
        'js1/miya-deep-app.js?v=25'
      ]
    },
    forum: {
      css: ['css/miya-forum.css?v=16'],
      js: [
        'js2/miya-forum-store.js?v=9',
        'js2/miya-forum-bridge.js?v=17',
        'js2/miya-forum-app.js?v=19'
      ]
    },
    simulator: {
      css: ['css/miya-simulator.css?v=10'],
      js: [
        'js2/miya-simulator-store.js?v=14',
        'js2/miya-simulator-engine.js?v=11',
        'js2/miya-simulator-narrative.js?v=2',
        'js2/miya-simulator-play-modules.js?v=7',
        'js2/miya-simulator-app.js?v=17'
      ]
    },
    coupleUi: {
      css: [
        'css/miya-couple.css?v=12',
        'css/miya-couple-whisper.css?v=9',
        'css/miya-couple-photos.css?v=4'
      ],
      js: [
        'js1/miya-couple-checkin.js?v=6',
        'js1/miya-couple-timeline.js?v=7',
        'js1/miya-couple-board.js?v=1',
        'js1/miya-couple-whisper-store.js?v=2',
        'js1/miya-couple-whisper-engine.js?v=2',
        'js1/miya-couple-whisper.js?v=4',
        'js1/miya-couple-photos.js?v=5',
        'js1/miya-couple-app.js?v=10'
      ]
    },
    diaryUi: {
      css: ['css/miya-diary.css?v=13'],
      js: [
        'js2/miya-diary-scheduler.js?v=3',
        'js2/miya-diary-app.js?v=10'
      ]
    },
    theaterUi: {
      css: ['css/miya-theater.css?v=3'],
      js: [
        'js2/miya-forum-bridge.js?v=17',
        'js2/miya-theater-app.js?v=3'
      ]
    },
    itineraryUi: {
      css: ['css/miya-itinerary.css?v=3'],
      js: ['js2/miya-itinerary-app.js?v=9']
    },
    weatherUi: {
      css: ['css/miya-weather.css?v=9'],
      js: [
        'js2/miya-forum-bridge.js?v=17',
        'js2/miya-weather-app.js?v=12'
      ]
    },
    cstoreUi: {
      css: ['css/miya-cstore.css?v=3'],
      js: ['js1/miya-cstore-app.js?v=4']
    },
    memoryUi: {
      css: ['css/miya-memory.css?v=8'],
      js: ['js2/miya-memory-app.js?v=9']
    },
    matchUi: {
      css: ['css/miya-match.css?v=4'],
      js: [
        'js2/miya-forum-bridge.js?v=17',
        'js2/miya-match-store.js?v=3',
        'js2/miya-match-bridge.js?v=5',
        'js2/miya-match-app.js?v=6'
      ]
    },
    funUi: {
      css: ['css/miya-fun.css?v=3', 'css/miya-fun-sayguess.css?v=5'],
      js: [
        'js2/miya-forum-bridge.js?v=17',
        'js2/miya-fun-sayguess-store.js?v=3',
        'js2/miya-fun-sayguess-bridge.js?v=6',
        'js2/miya-fun-sayguess-app.js?v=9',
        'js2/miya-fun-app.js?v=2'
      ]
    }
  };

  var APP_TO_GROUPS = {
    deep: ['deep'],
    memo: ['forum'],
    pen: ['simulator'],
    couple: ['coupleUi'],
    notes: ['diaryUi'],
    theater: ['theaterUi'],
    itinerary: ['itineraryUi'],
    weather: ['weatherUi'],
    cstore: ['cstoreUi'],
    memory: ['memoryUi'],
    match: ['matchUi'],
    fun: ['funUi']
  };

  var loadedCss = Object.create(null);
  var loadedJs = Object.create(null);
  var groupPromises = Object.create(null);
  var bootStarted = false;

  function perfOff() {
    try {
      return localStorage.getItem('miyaPerfOff') === '1';
    } catch (e) {
      return false;
    }
  }

  function loadCss(href) {
    if (loadedCss[href]) return loadedCss[href];
    loadedCss[href] = new Promise(function (resolve) {
      var existing = document.querySelector('link[data-miya-lazy="' + href + '"]');
      if (existing) {
        resolve();
        return;
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-miya-lazy', href);
      link.onload = function () { resolve(); };
      link.onerror = function () { resolve(); };
      document.head.appendChild(link);
    });
    return loadedCss[href];
  }

  function loadScript(src) {
    if (loadedJs[src]) return loadedJs[src];
    loadedJs[src] = new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-miya-lazy="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-miya-lazy', src);
      s.onload = function () { resolve(); };
      s.onerror = function () {
        loadedJs[src] = null;
        reject(new Error('lazy_script_fail:' + src));
      };
      document.body.appendChild(s);
    });
    return loadedJs[src];
  }

  function ensureGroup(name) {
    if (!GROUPS[name]) return Promise.resolve();
    if (groupPromises[name]) return groupPromises[name];
    var g = GROUPS[name];
    groupPromises[name] = Promise.all((g.css || []).map(loadCss))
      .then(function () {
        var chain = Promise.resolve();
        (g.js || []).forEach(function (src) {
          chain = chain.then(function () {
            return loadScript(src);
          });
        });
        return chain;
      })
      .catch(function (err) {
        groupPromises[name] = null;
        throw err;
      });
    return groupPromises[name];
  }

  function ensureGroups(names) {
    var list = Array.isArray(names) ? names : [names];
    var chain = Promise.resolve();
    list.forEach(function (n) {
      chain = chain.then(function () {
        return ensureGroup(n);
      });
    });
    return chain;
  }

  function ensureApp(appId) {
    var groups = APP_TO_GROUPS[appId];
    if (!groups || !groups.length) return Promise.resolve();
    return ensureGroups(groups);
  }

  function peekSimulatorLastMode() {
    try {
      var raw = localStorage.getItem('miya-simulator-v2');
      if (!raw) raw = localStorage.getItem('miya-simulator-v1');
      if (!raw) return 'phone';
      var data = JSON.parse(raw);
      var mode = data && data.lastMode;
      if (mode === 'simulator' || mode === 'sim') return 'sim';
      return 'phone';
    } catch (e) {
      return 'phone';
    }
  }

  function prefetchAllIdle() {
    if (bootStarted) return;
    bootStarted = true;
    var names = Object.keys(GROUPS);
    var i = 0;
    function next() {
      if (i >= names.length) return;
      var name = names[i++];
      ensureGroup(name)
        .catch(function () {})
        .then(function () {
          if (typeof global.miyaScheduleIdle === 'function') {
            global.miyaScheduleIdle(next, 2200);
          } else if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(next, { timeout: 2200 });
          } else {
            setTimeout(next, 80);
          }
        });
    }
    next();
  }

  function startBoot() {
    if (perfOff()) {
      ensureGroups(Object.keys(GROUPS)).catch(function () {});
      return;
    }
    function kick() {
      setTimeout(prefetchAllIdle, 400);
    }
    if (document.readyState === 'complete') kick();
    else global.addEventListener('load', kick);
  }

  global.miyaLazyEnsure = ensureGroup;
  global.miyaLazyEnsureGroups = ensureGroups;
  global.miyaLazyEnsureApp = ensureApp;
  global.miyaLazyPeekSimMode = peekSimulatorLastMode;
  global.miyaLazyGroups = GROUPS;

  startBoot();
})(typeof window !== 'undefined' ? window : self);
