/**
 * Shared performance helpers — glass refresh, clone, yield, scroll-blur, rAF coalesce.
 * Disable all optional opts: localStorage.miyaPerfOff = '1'
 */
(function (global) {
  'use strict';

  function perfEnabled() {
    try {
      return localStorage.getItem('miyaPerfOff') !== '1';
    } catch (e) {
      return true;
    }
  }

  function isLowEnd() {
    return !!(document.documentElement && document.documentElement.classList.contains('is-low-end'));
  }

  function isMobile() {
    return !!(document.documentElement && document.documentElement.classList.contains('is-mobile'));
  }

  var glassPassFrame = 0;

  function repaintGlass() {
    var el = document.documentElement;
    if (!el) return;
    if (glassPassFrame) cancelAnimationFrame(glassPassFrame);
    el.setAttribute('data-glass-pass', el.getAttribute('data-glass-pass') === '1' ? '0' : '1');
    glassPassFrame = requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        glassPassFrame = 0;
        el.setAttribute('data-glass-pass', el.getAttribute('data-glass-pass') === '1' ? '0' : '1');
      });
    });
  }

  function deepClone(value) {
    if (value == null) return value;
    if (typeof global.structuredClone === 'function') {
      try {
        return global.structuredClone(value);
      } catch (e) {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function yieldToMain() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function rafCoalesce(slotHolder, key, fn) {
    if (!slotHolder) slotHolder = {};
    var prev = slotHolder[key];
    if (prev) cancelAnimationFrame(prev);
    slotHolder[key] = requestAnimationFrame(function () {
      slotHolder[key] = 0;
      fn();
    });
    return slotHolder;
  }

  var scrollBlurTimers = new WeakMap();

  function bindScrollBlur(scrollEl, opts) {
    if (!perfEnabled() || !scrollEl || scrollEl.__miyaScrollBlurBound) return;
    opts = opts || {};
    var root = opts.root || document.documentElement;
    var cls = opts.className || 'miya-is-scrolling';
    var idleMs = opts.idleMs != null ? opts.idleMs : 140;
    scrollEl.__miyaScrollBlurBound = true;
    scrollEl.addEventListener(
      'scroll',
      function () {
        root.classList.add(cls);
        var prev = scrollBlurTimers.get(scrollEl);
        if (prev) clearTimeout(prev);
        scrollBlurTimers.set(
          scrollEl,
          setTimeout(function () {
            root.classList.remove(cls);
            scrollBlurTimers.delete(scrollEl);
          }, idleMs)
        );
      },
      { passive: true }
    );
  }

  function scheduleIdle(fn, timeout) {
    if (typeof global.requestIdleCallback === 'function') {
      return global.requestIdleCallback(fn, { timeout: timeout != null ? timeout : 1800 });
    }
    return setTimeout(fn, 1);
  }

  /**
   * Coalesce visibility/pageshow resume work and run after first paint.
   * Avoids stacking checkAll × focus × pageshow on the same frame as style restore.
   */
  var fgQueue = [];
  var fgFlushRaf1 = 0;
  var fgFlushRaf2 = 0;
  var fgFlushTimer = 0;

  function flushForegroundQueue() {
    fgFlushTimer = 0;
    fgFlushRaf1 = 0;
    fgFlushRaf2 = 0;
    if (document.hidden) return;
    var list = fgQueue.splice(0);
    var i = 0;
    function step() {
      if (document.hidden) {
        for (; i < list.length; i++) {
          if (fgQueue.indexOf(list[i]) < 0) fgQueue.push(list[i]);
        }
        return;
      }
      if (i >= list.length) return;
      var fn = list[i++];
      try {
        fn();
      } catch (e) {}
      if (i < list.length) setTimeout(step, 0);
    }
    step();
  }

  function scheduleForeground(fn) {
    if (typeof fn === 'function' && fgQueue.indexOf(fn) < 0) {
      fgQueue.push(fn);
    }
    if (document.hidden) return;
    if (fgFlushTimer || fgFlushRaf1 || fgFlushRaf2) return;
    fgFlushRaf1 = requestAnimationFrame(function () {
      fgFlushRaf1 = 0;
      fgFlushRaf2 = requestAnimationFrame(function () {
        fgFlushRaf2 = 0;
        fgFlushTimer = setTimeout(flushForegroundQueue, 48);
      });
    });
  }

  function bindForeground(fn) {
    if (typeof fn !== 'function') return;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleForeground(fn);
    });
    window.addEventListener('pageshow', function () {
      if (!document.hidden) scheduleForeground(fn);
    });
  }

  global.miyaIsLowEnd = isLowEnd;
  global.miyaIsMobile = isMobile;
  global.miyaRepaintGlass = repaintGlass;
  global.miyaPerfEnabled = perfEnabled;
  global.miyaDeepClone = deepClone;
  global.miyaYieldToMain = yieldToMain;
  global.miyaRafCoalesce = rafCoalesce;
  global.miyaBindScrollBlur = bindScrollBlur;
  global.miyaScheduleIdle = scheduleIdle;
  global.miyaScheduleForeground = scheduleForeground;
  global.miyaBindForeground = bindForeground;
})(typeof window !== 'undefined' ? window : self);
