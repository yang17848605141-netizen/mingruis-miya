(function (global) {
  'use strict';

  var BOOT_SEEN_KEY = 'miya_boot_seen_session';
  var SPLASH_MS_FIRST = 1400;
  var SPLASH_MS_RETURN = 600;
  var FAILSAFE_MS = 2200;

  function splashDuration() {
    try {
      if (sessionStorage.getItem(BOOT_SEEN_KEY)) return SPLASH_MS_RETURN;
    } catch (e) {}
    return SPLASH_MS_FIRST;
  }

  function markBootSeen() {
    try { sessionStorage.setItem(BOOT_SEEN_KEY, '1'); } catch (e) {}
  }

  var splashEl = null;
  var timers = [];
  var playing = false;
  var playResolve = null;

  var SPLASH_TAGLINE = '把日常过成慢镜头';

  function $(id) {
    return document.getElementById(id);
  }

  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(function (id) { clearTimeout(id); });
    timers = [];
  }

  function resetSplashClasses() {
    if (!splashEl) return;
    splashEl.classList.remove('is-active', 'is-pop', 'is-reveal', 'is-exit', 'is-done');
  }

  function syncSplashCopy() {
    var tagline = $('miya-splash-tagline');
    if (!tagline) return;
    tagline.textContent = SPLASH_TAGLINE;
  }

  function resolvePlay() {
    if (!playResolve) return;
    var done = playResolve;
    playResolve = null;
    done();
  }

  function showPhone() {
    document.documentElement.classList.remove('miya-splash-pending');
    document.body.classList.remove('miya-splash-active', 'miya-splash-reveal');
  }

  function finishSplash() {
    if (!playing) return;
    playing = false;
    clearTimers();
    showPhone();
    resolvePlay();
    if (!splashEl) return;

    splashEl.classList.add('is-exit', 'is-done');
    splashEl.setAttribute('aria-hidden', 'true');

    later(function () {
      splashEl.hidden = true;
      splashEl.style.display = 'none';
      resetSplashClasses();
    }, 420);
  }

  function skipSplash() {
    if (!playing || !splashEl) return;
    clearTimers();
    splashEl.classList.add('is-active', 'is-pop', 'is-reveal', 'is-exit');
    document.body.classList.add('miya-splash-reveal');
    later(finishSplash, 260);
  }

  function shouldPlay() {
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
  }

  function playSplash() {
    splashEl = $('miya-splash');
    if (!splashEl || playing) return Promise.resolve();

    if (!shouldPlay()) {
      showPhone();
      return Promise.resolve();
    }

    playing = true;
    clearTimers();
    resetSplashClasses();
    splashEl.classList.remove('is-done');
    splashEl.hidden = false;
    splashEl.style.display = '';
    syncSplashCopy();

    splashEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-splash-active');
    document.body.classList.remove('miya-splash-reveal');

    return new Promise(function (resolve) {
      playResolve = resolve;

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!playing || !splashEl) return;
          splashEl.classList.add('is-active');
        });
      });

      later(function () {
        if (!playing || !splashEl) return;
        splashEl.classList.add('is-pop');
      }, 100);

      later(function () {
        if (!playing || !splashEl) return;
        splashEl.classList.add('is-reveal');
        document.body.classList.add('miya-splash-reveal');
      }, Math.max(280, splashDuration() - 500));

      later(function () {
        if (!playing || !splashEl) return;
        splashEl.classList.add('is-exit');
      }, Math.max(420, splashDuration() - 120));

      var dur = splashDuration();
      later(finishSplash, dur);
      later(finishSplash, FAILSAFE_MS);
      markBootSeen();
    });
  }

  function init() {
    splashEl = $('miya-splash');
    var skipBtn = $('miya-splash-skip');
    if (skipBtn) skipBtn.addEventListener('click', skipSplash);
    syncSplashCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaSplash = {
    play: playSplash,
    skip: skipSplash,
    init: init
  };
})(window);
