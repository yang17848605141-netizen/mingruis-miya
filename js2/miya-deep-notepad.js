/**
 * miya-deep-notepad.js — 深入 · 角色手机 记事本界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var FONT_CLASSES = [
    'font-wenkai', 'font-mashan', 'font-longcang', 'font-xiaowei', 'font-serif-ink',
    'font-wenkai-loose', 'font-mashan-note', 'font-longcang-soft', 'font-zhi-light', 'font-wenkai-ink'
  ];

  var STRIKE_FONT_CLASSES = [
    'font-wenkai-soft', 'font-serif-ink', 'font-longcang-soft', 'font-wenkai-soft', 'font-serif-ink',
    'font-wenkai-soft', 'font-serif-ink', 'font-longcang-soft', 'font-wenkai-soft', 'font-serif-ink'
  ];

  var TONE_CLASSES = [
    'tone-rose', 'tone-sage', 'tone-sand', 'tone-mauve', 'tone-sky',
    'tone-blush', 'tone-olive', 'tone-lilac', 'tone-cream', 'tone-dust'
  ];

  /* 每条笔记的排版槽位：外框位置 + 内部结构 */
  var LAYOUT_SLOTS = [
    { slot: 'slot-spread', inner: 'inner-banner' },
    { slot: 'slot-float-r', inner: 'inner-side-meta' },
    { slot: 'slot-overlap-l', inner: 'inner-ticket' },
    { slot: 'slot-center', inner: 'inner-watermark' },
    { slot: 'slot-spine-r', inner: 'inner-split' },
    { slot: 'slot-cluster-a', inner: 'inner-loose' },
    { slot: 'slot-spine-l', inner: 'inner-spine' },
    { slot: 'slot-tall-r', inner: 'inner-column' },
    { slot: 'slot-peek', inner: 'inner-corner' },
    { slot: 'slot-finale', inner: 'inner-epilogue' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    notepadData: null,
    refreshing: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function notepadStore() { return global.miyaDeepNotepadStore || null; }
  function notepadBridge() { return global.miyaDeepNotepadBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toast(msg) {
    var el = $('dp-notepad-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function formatDatetime(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var d = new Date(s.replace(/-/g, '/'));
    if (!isNaN(d.getTime())) {
      return d.getMonth() + 1 + '.' + pad(d.getDate()) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return s;
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-notepad-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的记事本');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function updateStatusBar() {
    var bar = $('dp-notepad-status');
    var text = $('dp-notepad-status-text');
    if (!bar || !text) return;
    var data = state.notepadData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的记事本';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已成功读取';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-notepad__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-notepad__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-notepad-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.notepadData && state.notepadData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function renderHero() {
    var el = $('dp-notepad-hero');
    if (!el) return;
    var count = state.notepadData && state.notepadData.notes
      ? state.notepadData.notes.length
      : 0;
    el.innerHTML =
      '<div class="dp-notepad__hero-stack">' +
        '<span class="dp-notepad__hero-folder dp-notepad__hero-folder--back" aria-hidden="true"></span>' +
        '<span class="dp-notepad__hero-folder dp-notepad__hero-folder--mid" aria-hidden="true"></span>' +
        '<div class="dp-notepad__hero-card">' +
          '<span class="dp-notepad__hero-tab" aria-hidden="true">PRIVATE</span>' +
          '<span class="dp-notepad__hero-stamp" aria-hidden="true">碎片</span>' +
          '<div class="dp-notepad__hero-row">' +
            '<div class="dp-notepad__hero-main">' +
              '<span class="dp-notepad__hero-kicker">ARCHIVE · NOTEPAD</span>' +
              '<h1 class="dp-notepad__hero-title">记事本</h1>' +
            '</div>' +
            '<div class="dp-notepad__hero-side">' +
              '<span class="dp-notepad__hero-vol">VOL.</span>' +
              '<span class="dp-notepad__hero-count">' + (count ? count : '—') + '</span>' +
              '<span class="dp-notepad__hero-count-label">条</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderNoteDeco(style, index) {
    var html = '<span class="dp-notepad__note-paper" aria-hidden="true"></span>';
    if (style === 'tape-left' || style === 'wide') {
      html += '<span class="dp-notepad__tape dp-notepad__tape--left" aria-hidden="true"></span>';
      html += '<span class="dp-notepad__tape dp-notepad__tape--right" aria-hidden="true"></span>';
    }
    if (style === 'pinned' || style === 'dashed') {
      html += '<span class="dp-notepad__pin" aria-hidden="true"></span>';
    }
    if (style === 'offset-left' || style === 'narrow-tall') {
      html += '<span class="dp-notepad__corner-fold" aria-hidden="true"></span>';
    }
    if (style === 'offset-right') {
      html += '<span class="dp-notepad__coffee-ring" aria-hidden="true"></span>';
    }
    if (style === 'numbered' || style === 'classic') {
      html += '<span class="dp-notepad__clip" aria-hidden="true"></span>';
    }
    if (style === 'strikethrough') {
      html += '<span class="dp-notepad__scribble" aria-hidden="true"></span>';
    }
    if (index % 3 === 0) {
      html += '<span class="dp-notepad__margin-line" aria-hidden="true"></span>';
    }
    if (index % 4 === 1) {
      html += '<span class="dp-notepad__dot-grid" aria-hidden="true"></span>';
    }
    return html;
  }

  function renderNoteInner(note, index, layout, fontCls, strikeFontCls, timeLine, numberHtml, tagHtml, strikeHtml) {
    var body = '<p class="dp-notepad__note-body ' + fontCls + '">' + esc(note.content) + '</p>';
    var time = timeLine ? '<time class="dp-notepad__note-time">' + timeLine + '</time>' : '';
    var inner = layout.inner || 'inner-loose';

    if (inner === 'inner-banner') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--banner">' +
          '<header class="dp-notepad__note-head">' + time + tagHtml + '</header>' +
          numberHtml + strikeHtml + body +
        '</div>'
      );
    }
    if (inner === 'inner-side-meta') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--side-meta">' +
          '<aside class="dp-notepad__note-rail">' + numberHtml + time + '</aside>' +
          '<div class="dp-notepad__note-main">' + tagHtml + strikeHtml + body + '</div>' +
        '</div>'
      );
    }
    if (inner === 'inner-ticket') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--ticket">' +
          '<div class="dp-notepad__note-ticket-stub">' + numberHtml + time + '</div>' +
          '<div class="dp-notepad__note-ticket-body">' + tagHtml + strikeHtml + body + '</div>' +
        '</div>'
      );
    }
    if (inner === 'inner-watermark') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--watermark">' +
          numberHtml +
          '<div class="dp-notepad__note-flow">' + time + tagHtml + strikeHtml + body + '</div>' +
        '</div>'
      );
    }
    if (inner === 'inner-split') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--split">' +
          '<div class="dp-notepad__note-split-top">' + time + tagHtml + '</div>' +
          numberHtml + strikeHtml +
          '<div class="dp-notepad__note-split-body">' + body + '</div>' +
        '</div>'
      );
    }
    if (inner === 'inner-spine') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--spine">' +
          '<span class="dp-notepad__note-spine-dot" aria-hidden="true"></span>' +
          numberHtml + time + tagHtml + strikeHtml + body +
        '</div>'
      );
    }
    if (inner === 'inner-column') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--column">' +
          '<header class="dp-notepad__note-col-head">' + numberHtml + time + tagHtml + '</header>' +
          strikeHtml +
          '<div class="dp-notepad__note-col-body">' + body + '</div>' +
        '</div>'
      );
    }
    if (inner === 'inner-corner') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--corner">' +
          '<div class="dp-notepad__note-corner-meta">' + time + tagHtml + numberHtml + '</div>' +
          strikeHtml + body +
        '</div>'
      );
    }
    if (inner === 'inner-epilogue') {
      return (
        '<div class="dp-notepad__note-inner dp-notepad__note-inner--epilogue">' +
          numberHtml + time + tagHtml + strikeHtml +
          '<blockquote class="dp-notepad__note-epilogue ' + fontCls + '">' + esc(note.content) + '</blockquote>' +
        '</div>'
      );
    }
    return (
      '<div class="dp-notepad__note-inner dp-notepad__note-inner--loose">' +
        numberHtml + time + tagHtml + strikeHtml + body +
      '</div>'
    );
  }

  function renderNoteCard(note, index) {
    var style = note.style || 'classic';
    var layout = LAYOUT_SLOTS[index % LAYOUT_SLOTS.length];
    var fontCls = FONT_CLASSES[index % FONT_CLASSES.length];
    var strikeFontCls = STRIKE_FONT_CLASSES[index % STRIKE_FONT_CLASSES.length];
    var toneCls = TONE_CLASSES[index % TONE_CLASSES.length];
    var dt = formatDatetime(note.datetime);
    var timeLine = note.timeLabel
      ? esc(note.timeLabel) + (dt ? ' · ' + esc(dt) : '')
      : esc(dt);

    var numberHtml = note.number
      ? '<span class="dp-notepad__note-no">' + esc(note.number) + '</span>'
      : '';

    var strikeHtml = note.strikethrough
      ? '<p class="dp-notepad__note-strike ' + strikeFontCls + '">' + esc(note.strikethrough) + '</p>'
      : '';

    var tagHtml = note.tag
      ? '<span class="dp-notepad__note-tag">' + esc(note.tag) + '</span>'
      : '';

    var slotCls = layout.slot || 'slot-loose';
    var innerHtml = renderNoteInner(note, index, layout, fontCls, strikeFontCls, timeLine, numberHtml, tagHtml, strikeHtml);

    return (
      '<article class="dp-notepad__note dp-notepad__note--' + esc(style) + ' ' + toneCls + ' ' + slotCls + '" data-dp-notepad-idx="' + index + '">' +
        renderNoteDeco(style, index) +
        innerHtml +
        '<span class="dp-notepad__note-footer" aria-hidden="true"></span>' +
      '</article>'
    );
  }

  function renderNotes() {
    var el = $('dp-notepad-notes');
    var empty = $('dp-notepad-empty');
    if (!el) return;
    var notes = state.notepadData && state.notepadData.notes || [];
    if (!notes.length) {
      el.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    var chunks = [];
    var i;
    for (i = 0; i < notes.length; i++) {
      var layout = LAYOUT_SLOTS[i % LAYOUT_SLOTS.length];
      if (layout.slot === 'slot-cluster-a' && i + 1 < notes.length) {
        chunks.push(
          '<div class="dp-notepad__cluster">' +
            renderNoteCard(notes[i], i) +
            renderNoteCard(notes[i + 1], i + 1) +
          '</div>'
        );
        i += 1;
        continue;
      }
      if (layout.slot === 'slot-spread') {
        chunks.push(
          '<div class="dp-notepad__spread">' +
            '<span class="dp-notepad__spread-label" aria-hidden="true">PAGE ' + pad(Math.floor(i / 3) + 1) + '</span>' +
            renderNoteCard(notes[i], i) +
          '</div>'
        );
        continue;
      }
      chunks.push(renderNoteCard(notes[i], i));
    }

    el.innerHTML =
      '<div class="dp-notepad__river" aria-hidden="true">' +
        '<span class="dp-notepad__river-spine"></span>' +
      '</div>' +
      '<div class="dp-notepad__collage">' + chunks.join('') + '</div>';
  }

  function renderAll() {
    renderHero();
    renderNotes();
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadNotepadData(contactId) {
    var ns = notepadStore();
    if (!ns) return Promise.resolve(null);
    return ns.getNotepad(contactId).then(function (data) {
      state.notepadData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-notepad-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ns = notepadStore();
    var br = notepadBridge();
    if (!ns || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ns.patchNotepad(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的记事本',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.notepadData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateNotepad(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的记事本';
          ns.patchNotepad(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.notepadData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ns.patchNotepad(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        notes: result.notes
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.notepadData = saved;
        state.refreshing = false;
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ns.patchNotepad(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.notepadData = saved;
          state.refreshing = false;
          if (state.open) renderAll();
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.notepadData && state.notepadData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function bindEvents() {
    var root = $('dp-notepad');
    if (!root || root._dpNotepadBound) return;
    root._dpNotepadBound = true;

    var back = $('dp-notepad-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-notepad-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    global.addEventListener('miya-deep-notepad-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadNotepadData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-notepad');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.refreshing = !!activeJobs[state.contactId];

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadNotepadData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          notepadStore().patchNotepad(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.notepadData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-notepad');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
  }

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaDeepNotepad = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
