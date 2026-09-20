/**
 * miya-music-desktop-lyrics.js — 桌面歌词悬浮层
 */
(function (global) {
  'use strict';

  var eng = global.miyaMusicEngine;
  if (!eng) return;

  var root = null;
  var lineCurrent = null;
  var lineNext = null;
  var titleEl = null;
  var artistEl = null;
  var coverEl = null;
  var progressFill = null;
  var playBtn = null;
  var lastLineKey = '';
  var lastTrackId = '';
  var changeTimer = null;
  var tickCache = {};
  var dragging = false;
  var dragMoved = false;
  var dragStartPos = { x: 0, y: 0 };
  var dragOffset = { x: 0, y: 0 };
  var bound = false;

  function $(sel) { return root ? root.querySelector(sel) : null; }

  function getViewport() {
    return { w: window.innerWidth || 1, h: window.innerHeight || 1 };
  }

  function clampPct(xPct, yPct) {
    return {
      xPct: Math.max(8, Math.min(92, xPct)),
      yPct: Math.max(4, Math.min(88, yPct))
    };
  }

  function applyPosition() {
    if (!root) return;
    var pos = eng.getDesktopLyricsPos();
    var vp = getViewport();
    var w = root.offsetWidth || 300;
    var h = root.offsetHeight || 80;
    var left = (pos.xPct / 100) * vp.w - w / 2;
    var top = (pos.yPct / 100) * vp.h;
    left = Math.max(0, Math.min(vp.w - w, left));
    top = Math.max(0, Math.min(vp.h - h, top));
    root.style.left = Math.round(left) + 'px';
    root.style.top = Math.round(top) + 'px';
  }

  function savePositionFromRect() {
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var vp = getViewport();
    var xPct = ((rect.left + rect.width / 2) / vp.w) * 100;
    var yPct = (rect.top / vp.h) * 100;
    eng.setDesktopLyricsPos(clampPct(xPct, yPct));
  }

  function pauseSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  }

  function playSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }

  function prevSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>';
  }

  function nextSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z"/></svg>';
  }

  function normalizeCover(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return u.replace(/^http:\/\//i, 'https://');
  }

  function setMinimized(on, opts) {
    opts = opts || {};
    eng.setDesktopLyricsMinimized(!!on);
    if (!root) return;
    root.classList.toggle('is-minimized', !!on);
    if (opts.reposition !== false) {
      requestAnimationFrame(function () {
        applyPosition();
      });
    }
  }

  function toggleMinimized() {
    setMinimized(!eng.getDesktopLyricsMinimized());
  }

  function getLyricPair(snap) {
    var lrc = snap.parsedLrc || [];
    var idx = eng.getLyricsActiveIndex();
    if (!lrc.length) {
      return {
        current: snap.lyricLine || (snap.title ? '♪ ' + snap.title : '等待播放…'),
        next: snap.artist || '',
        hasLrc: false
      };
    }
    if (idx < 0) idx = 0;
    var current = lrc[idx] && lrc[idx].text ? String(lrc[idx].text) : '';
    var next = lrc[idx + 1] && lrc[idx + 1].text ? String(lrc[idx + 1].text) : '';
    if (!current && snap.lyricLine) current = snap.lyricLine;
    return { current: current, next: next, hasLrc: true };
  }

  function setLineText(el, text, isPlaceholder) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('mdl__line--placeholder', !!isPlaceholder && !text);
  }

  function animateLineChange(currentText, nextText, hasLrc, immediate) {
    if (!lineCurrent || !lineNext) return;
    var key = currentText + '|' + nextText;
    if (key === lastLineKey) return;
    lastLineKey = key;

    if (immediate) {
      if (changeTimer) clearTimeout(changeTimer);
      lineCurrent.classList.remove('is-changing');
      lineNext.classList.remove('is-changing');
      setLineText(lineCurrent, currentText, !hasLrc);
      setLineText(lineNext, nextText, !hasLrc);
      return;
    }

    lineCurrent.classList.add('is-changing');
    lineNext.classList.add('is-changing');

    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(function () {
      setLineText(lineCurrent, currentText, !hasLrc);
      setLineText(lineNext, nextText, !hasLrc);
      lineCurrent.classList.remove('is-changing');
      lineNext.classList.remove('is-changing');
    }, 120);
  }

  function tickUi() {
    if (!root || !eng.getDesktopLyricsEnabled()) return;

    var snap = eng.buildSnapshot();
    var data = eng.getData();
    var trackId = data.nowPlaying && data.nowPlaying.id ? data.nowPlaying.id : '';
    var trackChanged = trackId !== lastTrackId;
    if (trackChanged) {
      lastTrackId = trackId;
      lastLineKey = '';
      tickCache = {};
    }

    var ct = snap.currentTime || 0;
    eng.updateLyricsActive(ct);

    var title = snap.title || '未在播放';
    var artist = snap.artist || '—';
    if (tickCache.title !== title && titleEl) {
      tickCache.title = title;
      titleEl.textContent = title;
    }
    if (tickCache.artist !== artist && artistEl) {
      tickCache.artist = artist;
      artistEl.textContent = artist;
    }

    var cover = normalizeCover(snap.coverUrl);
    if (tickCache.cover !== cover && coverEl) {
      tickCache.cover = cover;
      var coverWrap = root.querySelector('.mdl__cover-wrap');
      if (cover) {
        coverEl.src = cover;
        coverEl.hidden = false;
        if (coverWrap) coverWrap.classList.remove('is-fallback');
      } else {
        coverEl.removeAttribute('src');
        coverEl.hidden = true;
        if (coverWrap) {
          coverWrap.classList.add('is-fallback');
          coverWrap.setAttribute('data-fallback', snap.title ? snap.title.charAt(0) : '♪');
        }
      }
    }

    var pair = getLyricPair(snap);
    animateLineChange(pair.current, pair.next, pair.hasLrc, trackChanged);

    var dur = snap.duration || 0;
    var progressKey = Math.round((snap.currentTime || 0) * 4) + '|' + Math.round(dur);
    if (trackChanged || tickCache.progressKey !== progressKey) {
      tickCache.progressKey = progressKey;
      if (progressFill) {
        var pct = dur > 0 ? Math.min(100, ((snap.currentTime || 0) / dur) * 100) : 0;
        progressFill.style.width = pct + '%';
      }
    }

    var playing = snap.isPlaying;
    if (tickCache.playing !== playing) {
      tickCache.playing = playing;
      root.classList.toggle('is-playing', !!playing);
      if (playBtn) playBtn.innerHTML = playing ? pauseSvg() : playSvg();
      if (playBtn) playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    }
  }

  function showWidget(animate) {
    if (!root) return;
    root.removeAttribute('hidden');
    root.setAttribute('aria-hidden', 'false');
    setMinimized(eng.getDesktopLyricsMinimized(), { reposition: false });
    if (animate !== false) {
      requestAnimationFrame(function () {
        root.classList.add('is-visible');
        requestAnimationFrame(applyPosition);
      });
    } else {
      root.classList.add('is-visible');
      requestAnimationFrame(applyPosition);
    }
    tickUi();
  }

  function hideWidget() {
    if (!root) return;
    root.classList.remove('is-visible');
    root.setAttribute('aria-hidden', 'true');
    setTimeout(function () {
      if (!eng.getDesktopLyricsEnabled() && root) {
        root.setAttribute('hidden', '');
      }
    }, 420);
  }

  function setEnabled(on, opts) {
    opts = opts || {};
    eng.setDesktopLyricsEnabled(!!on);
    if (on) {
      showWidget(opts.animate !== false);
    } else {
      hideWidget();
    }
    if (!opts.silent && global.miyaMusicApp && global.miyaMusicApp.toast) {
      global.miyaMusicApp.toast(on ? '桌面歌词已开启' : '桌面歌词已关闭');
    }
  }

  function togglePlayPause() {
    eng.resumeOrTogglePlayback(function () {
      if (global.miyaMusicApp && global.miyaMusicApp._tickUi) global.miyaMusicApp._tickUi();
      tickUi();
    });
  }

  function onDragStart(clientX, clientY) {
    if (!root) return;
    dragging = true;
    dragMoved = false;
    dragStartPos.x = clientX;
    dragStartPos.y = clientY;
    root.classList.add('is-dragging');
    var rect = root.getBoundingClientRect();
    dragOffset.x = clientX - rect.left;
    dragOffset.y = clientY - rect.top;
  }

  function onDragMove(clientX, clientY) {
    if (!dragging || !root) return;
    if (Math.abs(clientX - dragStartPos.x) > 3 || Math.abs(clientY - dragStartPos.y) > 3) {
      dragMoved = true;
    }
    var x = clientX - dragOffset.x;
    var y = clientY - dragOffset.y;
    var vp = getViewport();
    var w = root.offsetWidth;
    var h = root.offsetHeight;
    x = Math.max(0, Math.min(vp.w - w, x));
    y = Math.max(0, Math.min(vp.h - h, y));
    root.style.left = Math.round(x) + 'px';
    root.style.top = Math.round(y) + 'px';
  }

  function onDragEnd() {
    if (!dragging || !root) return;
    dragging = false;
    root.classList.remove('is-dragging');
    savePositionFromRect();
  }

  function bindDragHandle(el) {
    if (!el || el.dataset.dragBound) return;
    el.dataset.dragBound = '1';

    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || e.target.closest('.mdl__close') || e.target.closest('.mdl__shrink')) return;
      e.preventDefault();
      onDragStart(e.clientX, e.clientY);

      function onMove(ev) {
        onDragMove(ev.clientX, ev.clientY);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        onDragEnd();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    el.addEventListener('touchstart', function (e) {
      if (e.target.closest('.mdl__close') || e.target.closest('.mdl__shrink')) return;
      var t = e.touches[0];
      if (!t) return;
      onDragStart(t.clientX, t.clientY);

      function onMove(ev) {
        if (!ev.touches || !ev.touches.length) return;
        ev.preventDefault();
        onDragMove(ev.touches[0].clientX, ev.touches[0].clientY);
      }
      function onEnd() {
        el.removeEventListener('touchmove', onMove);
        el.removeEventListener('touchend', onEnd);
        el.removeEventListener('touchcancel', onEnd);
        onDragEnd();
      }
      el.addEventListener('touchmove', onMove, { passive: false });
      el.addEventListener('touchend', onEnd);
      el.addEventListener('touchcancel', onEnd);
    }, { passive: true });
  }

  function bindDrag() {
    bindDragHandle(root.querySelector('.mdl__bar'));
    bindDragHandle(root.querySelector('[data-mdl-expand]'));
  }

  function bindEvents() {
    if (bound || !root) return;
    bound = true;

    var closeBtn = root.querySelector('.mdl__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setEnabled(false, { animate: true });
      });
    }

    var shrinkBtn = root.querySelector('[data-mdl-shrink]');
    if (shrinkBtn) {
      shrinkBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setMinimized(true);
      });
    }

    var expandArea = root.querySelector('[data-mdl-expand]');
    if (expandArea) {
      expandArea.addEventListener('click', function () {
        if (!root.classList.contains('is-minimized') || dragMoved) return;
        setMinimized(false);
      });
    }

    var prevBtn = root.querySelector('[data-mdl-prev]');
    var nextBtn = root.querySelector('[data-mdl-next]');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        lastLineKey = '';
        tickUi();
        eng.playAdjacent(-1, false, function () {
          if (global.miyaMusicApp && global.miyaMusicApp._tickUi) global.miyaMusicApp._tickUi();
          tickUi();
        });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        lastLineKey = '';
        tickUi();
        eng.playAdjacent(1, false, function () {
          if (global.miyaMusicApp && global.miyaMusicApp._tickUi) global.miyaMusicApp._tickUi();
          tickUi();
        });
      });
    }
    if (playBtn) playBtn.addEventListener('click', togglePlayPause);

    bindDrag();

    global.addEventListener('miya-music-state', function () {
      if (eng.getDesktopLyricsEnabled()) tickUi();
    });

    window.addEventListener('resize', function () {
      if (eng.getDesktopLyricsEnabled()) applyPosition();
    });
  }

  function ensureDom() {
    root = document.getElementById('miya-desk-lyrics');
    if (!root) return false;
    lineCurrent = root.querySelector('.mdl__line--current');
    lineNext = root.querySelector('.mdl__line--next');
    titleEl = root.querySelector('.mdl__title');
    artistEl = root.querySelector('.mdl__artist');
    coverEl = root.querySelector('.mdl__cover');
    progressFill = root.querySelector('.mdl__progress-fill');
    playBtn = root.querySelector('[data-mdl-play]');
    return true;
  }

  function init() {
    if (!ensureDom()) return;
    bindEvents();
    if (global.MiyaMusicBeautify) global.MiyaMusicBeautify.applyAppearance();
    eng.loadDataWithTimeout(8000).then(function () {
      if (eng.getDesktopLyricsEnabled()) {
        showWidget(false);
      }
    }).catch(function () {
      if (eng.getDesktopLyricsEnabled()) showWidget(false);
    });
  }

  global.MiyaDesktopLyrics = {
    init: init,
    setEnabled: setEnabled,
    isEnabled: function () { return eng.getDesktopLyricsEnabled(); },
    tick: tickUi
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
