/**
 * miya-chat-room.js — INS 风单聊界面
 */
(function (global) {
  'use strict';

  var store = null;
  var engine = null;
  var roomEl = null;
  var BUBBLE_STAGGER_MS = 480;
  var BUBBLE_STAGGER_MS_LOW_END = 200;
  var SCROLL_BOTTOM_THRESHOLD = 72;
  var scrollByChat = {};
  var scrollSaveTimer = null;
  var roomPinBottomUntil = 0;
  var roomOpenGen = 0;
  var grpRpOpening = {};
  var roomChatPanes = {};
  var groupRenderGen = 0;
  var groupPendingPrepend = {};
  var GROUP_MSG_RENDER_INITIAL = 40;
  var GROUP_MSG_RENDER_INITIAL_LOW_END = 24;
  /** 首次进房只先画更少气泡，让壳层先上屏，其余靠滚动上拉渐进补全 */
  var GROUP_MSG_RENDER_OPEN = 28;
  var GROUP_MSG_RENDER_OPEN_LOW_END = 18;
  var GROUP_MSG_RENDER_CHUNK = 40;
  var GROUP_MSG_RENDER_CHUNK_LOW_END = 24;
  var GROUP_HISTORY_SCROLL_THRESHOLD = 140;
  var userPinnedBottom = true;
  var SHOW_TIMESTAMPS_KEY = 'miya-chat-show-timestamps-v1';

  function afterNextPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { resolve(); });
      });
    });
  }

  function armQuietPinBottom(ms) {
    userPinnedBottom = true;
    roomPinBottomUntil = Date.now() + (ms != null ? ms : 1200);
  }

  function readShowTimestampsPref() {
    try {
      if (typeof global.miyaSyncReadJsonKey === 'function') {
        var raw = global.miyaSyncReadJsonKey(SHOW_TIMESTAMPS_KEY);
        if (raw === true || raw === false) return raw;
      }
      var ls = localStorage.getItem(SHOW_TIMESTAMPS_KEY);
      if (ls === '1' || ls === 'true') return true;
      if (ls === '0' || ls === 'false') return false;
    } catch (e) {}
    return false;
  }

  function persistShowTimestampsPref(val) {
    try {
      if (typeof global.miyaWriteLsJsonKey === 'function') {
        global.miyaWriteLsJsonKey(SHOW_TIMESTAMPS_KEY, !!val);
        return;
      }
      localStorage.setItem(SHOW_TIMESTAMPS_KEY, val ? '1' : '0');
    } catch (e) {}
  }

  var state = {
    chatId: null,
    sending: false,
    awaitingAssistantReply: false,
    showTypingIndicator: false,
    revealTimers: [],
    avatars: {},
    quoteRef: null,
    multiSelectMode: false,
    multiSelectIds: null,
    showTimestamps: readShowTimestampsPref(),
    narrationMode: false
  };
  var longPressTimer = null;
  var longPressPointerId = null;
  var longPressStartX = 0;
  var longPressStartY = 0;
  var msgMenuId = null;
  var msgMenuBlockPointerId = null;
  var msgMenuSuppressClickUntil = 0;
  var msgMenuActLock = '';
  var emojiPanelOpen = false;
  var toolbarOpen = false;
  var refreshListsTimer = null;
  var keyboardInsetBound = false;
  var iosKbRecoveryTimers = [];
  var iosKeyboardWasOpen = false;
  var iosViewportBaselineH = 0;
  var roomViewportResetTimer = null;
  var roomViewportLifecycleBound = false;
  var stickerSuggestTimer = null;

  function isIOSChat() {
    return document.documentElement.classList.contains('is-ios');
  }

  function syncChatAppKeyboardShell(open, vv) {
    var app = $('miya-chat-app');
    if (!app) return;
    if (open && vv) {
      var fill = Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height));
      app.style.setProperty('--qq-kb-fill', fill + 'px');
      app.classList.add('qq-kb-active');
    } else {
      app.style.removeProperty('--qq-kb-fill');
      app.classList.remove('qq-kb-active');
    }
  }

  function captureIosViewportBaseline() {
    if (!isIOSChat()) return;
    iosViewportBaselineH = window.innerHeight || 0;
  }

  function keyboardInsetPx() {
    var vv = window.visualViewport;
    if (!vv) return 0;
    return Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
  }

  function isIosKeyboardOpen() {
    if (keyboardInsetPx() > 40) return true;
    /* 聚焦即视为键盘态，等 vv/innerHeight 跟上后再靠 inset 判断 */
    if (isComposeInputFocused()) return true;
    var innerH = window.innerHeight || 0;
    var base = iosViewportBaselineH || innerH;
    if (base - innerH > 48) return true;
    return false;
  }

  function clearIosRoomKeyboardLayout() {
    if (!roomEl) return;
    roomEl.classList.remove('qq-room--keyboard');
    roomEl.style.setProperty('--qq-kb-offset', '0px');
    roomEl.style.removeProperty('--qq-kb-top');
    roomEl.style.removeProperty('--qq-kb-height');
  }

  function clearKeyboardState() {
    clearIosRoomKeyboardLayout();
    syncChatAppKeyboardShell(false);
  }

  function syncAppHeight(force) {
    if (global.__miyaSetAppHeight) global.__miyaSetAppHeight(!!force);
  }

  function isRoomFootFloating() {
    if (!roomEl || roomEl.hidden || roomEl.classList.contains('qq-room--keyboard')) return false;
    var foot = roomEl.querySelector('.qq-room__foot');
    if (!foot) return false;
    var rect = foot.getBoundingClientRect();
    var vv = window.visualViewport;
    var expectedBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    return expectedBottom - rect.bottom > 12;
  }

  function resetRoomViewportLayout(resync, retryDepth) {
    retryDepth = retryDepth || 0;
    cancelIosKbRecovery();
    iosKeyboardWasOpen = false;
    clearKeyboardState();
    captureIosViewportBaseline();
    if (!isIOSChat()) {
      if (resync && roomEl && !roomEl.hidden && state.chatId) syncKeyboardInset();
      return;
    }
    window.scrollTo(0, 0);
    syncAppHeight(true);
    if (!resync) return;
    setTimeout(function () {
      syncAppHeight(true);
      window.scrollTo(0, 0);
    }, 80);
    setTimeout(function () {
      syncAppHeight(true);
      window.scrollTo(0, 0);
      if (state.chatId && roomEl && !roomEl.hidden && isRoomFootFloating() && retryDepth < 2) {
        resetRoomViewportLayout(true, retryDepth + 1);
      }
    }, 220);
  }

  function scheduleRoomViewportReset(reason) {
    if (!isIOSChat()) return;
    clearTimeout(roomViewportResetTimer);
    var delay = reason === 'close' ? 0 : 60;
    roomViewportResetTimer = setTimeout(function () {
      roomViewportResetTimer = null;
      if (reason === 'close') {
        resetRoomViewportLayout(false);
        return;
      }
      if (!state.chatId || !roomEl || roomEl.hidden) return;
      if (isComposeInputFocused()) return;
      resetRoomViewportLayout(true);
    }, delay);
  }

  function bindRoomViewportLifecycle() {
    if (roomViewportLifecycleBound) return;
    roomViewportLifecycleBound = true;
    if (!isIOSChat()) return;

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (state.chatId) scheduleRoomViewportReset('visible');
      else {
        window.scrollTo(0, 0);
        syncAppHeight(true);
      }
    });

    window.addEventListener('pageshow', function () {
      if (state.chatId) scheduleRoomViewportReset('pageshow');
      else syncAppHeight(true);
    });

    /* 从咪呀机其它 App 返回聊天时，overlay 关闭不会触发 open/close */
    var overlayMoTimer = null;
    function onOverlayViewportSignal() {
      if (!state.chatId) return;
      clearTimeout(overlayMoTimer);
      overlayMoTimer = setTimeout(function () {
        overlayMoTimer = null;
        if (!state.chatId || isComposeInputFocused()) return;
        if (isRoomFootFloating()) scheduleRoomViewportReset('overlay');
      }, 120);
    }
    var overlayObserver = new MutationObserver(onOverlayViewportSignal);
    var overlayWatchRoots = [
      document.body,
      document.getElementById('miya-chat-app'),
      document.getElementById('qq-room-overlay'),
      document.getElementById('miya-settings-app'),
      document.getElementById('miya-beautify-app'),
      document.getElementById('ncm-overlay'),
      roomEl
    ];
    overlayWatchRoots.forEach(function (el) {
      if (!el) return;
      overlayObserver.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'hidden', 'aria-hidden'],
        subtree: el === roomEl
      });
    });
  }

  function cancelIosKbRecovery() {
    iosKbRecoveryTimers.forEach(function (id) {
      clearTimeout(id);
    });
    iosKbRecoveryTimers = [];
  }

  function isComposeInputFocused() {
    var input = $('qq-room-input');
    return !!(input && document.activeElement === input);
  }

  function recoverIosViewportAfterKeyboard() {
    if (!isIOSChat()) return;
    cancelIosKbRecovery();
    iosKeyboardWasOpen = false;
    [0, 80, 180, 360, 520].forEach(function (delay) {
      iosKbRecoveryTimers.push(setTimeout(function () {
        if (isComposeInputFocused()) return;
        clearKeyboardState();
        window.scrollTo(0, 0);
        syncAppHeight(true);
        captureIosViewportBaseline();
      }, delay));
    });
  }

  function syncIosKeyboardInset(vv, inset) {
    if (!vv) vv = window.visualViewport;
    inset = inset || 0;
    roomEl.style.setProperty('--qq-kb-offset', inset + 'px');

    var open = isIosKeyboardOpen();
    var wasOpen = iosKeyboardWasOpen;
    iosKeyboardWasOpen = open;

    if (open && vv) {
      roomEl.classList.add('qq-room--keyboard');
      roomEl.style.setProperty('--qq-kb-top', Math.round(vv.offsetTop || 0) + 'px');
      roomEl.style.setProperty('--qq-kb-height', Math.round(vv.height) + 'px');
      syncChatAppKeyboardShell(true, vv);
      if ((vv.offsetTop || 0) > 0) window.scrollTo(0, 0);
      scrollRoomToBottom($('qq-room-scroll'), true);
      return;
    }

    clearKeyboardState();
    if (wasOpen) recoverIosViewportAfterKeyboard();
  }

  function dismissMsgMenuIfOutside(target) {
    if (!msgMenuId) return;
    if (msgMenuBlockPointerId != null) return;
    if (Date.now() < msgMenuSuppressClickUntil) return;
    if (target && target.closest && target.closest('.qq-msg-menu')) return;
    closeMsgMenu();
  }

  var PLUS_TOOL_KEYS = ['transfer', 'takeout', 'gift', 'location', 'call', 'clock', 'narration', 'thinking', 'lovePoem'];
  var GROUP_TOOL_KEYS = ['image', 'redo', 'mic', 'emoji', 'groupRedPacket'];
  var TOOL_KEYS = ['image', 'redo', 'mic', 'emoji'].concat(PLUS_TOOL_KEYS);
  var AI_STAR_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<polygon fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="12,4 14.5,9.5 20,12 14.5,14.5 12,20 9.5,14.5 4,12 9.5,9.5"/>' +
    '<polygon fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="18,5 18.7,6.5 20,7 18.7,7.5 18,9 17.3,7.5 16,7 17.3,6.5"/>' +
    '<polygon fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="6.5,16.5 7.1,17.6 8,18 7.1,18.4 6.5,19.5 5.9,18.4 5,18 5.9,17.6"/>' +
    '</svg>';
  var COMPOSE_PLUS_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' +
    '</svg>';
  var COMPOSE_HEART_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
    '</svg>';
  var THINK_CLOUD_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' +
    '</svg>';
  var LOVE_POEM_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M18.8 3.4c-1.6 2.4-3.4 5.2-5.2 8.4-1.4 2.5-2.7 4.6-3.9 6.1-1 1.1-1.8 1.8-2.4 2.2"/>' +
    '<path d="M17.2 5.1 9.1 16.4"/>' +
    '<path d="M15.5 7.2 12.1 8.8 M13.8 9.3 10.3 10.9 M12.4 11.4 8.9 12.9 M11 13.5 7.7 14.8 M9.7 15.6 6.8 16.7 M8.6 17.1 6.4 18.1"/>' +
    '<path d="M16.2 6.1 18.5 4.2 M14.8 8.1 17 6.8 M13.4 10.2 15.6 8.8 M12.2 12 14 10.8"/>' +
    '<path d="M9.1 16.4 5.3 19.7 M5.3 19.7 3.9 21.1 M5.3 19.7 6.6 20.8"/>' +
    '</svg>';
  var TOOL_SVG = {
    mic: '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    redo:
      '<svg viewBox="0 0 24 24">' +
      '<path d="M23 4v6h-6"/>' +
      '<path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>' +
      '</svg>',
    mask:
      '<svg viewBox="0 0 24 24">' +
      '<path d="M12 3c-4 0-7 2-7 5v4c0 3 3 5 7 5s7-2 7-5V8c0-3-3-5-7-5z"/>' +
      '<circle cx="9" cy="11" r="1" fill="currentColor"/>' +
      '<circle cx="15" cy="11" r="1" fill="currentColor"/>' +
      '</svg>',
    emoji: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    transfer: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    takeout: '<svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>',
    location: '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    call: '<svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    narration:
      '<svg viewBox="0 0 24 24">' +
      '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>' +
      '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>' +
      '<line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>' +
      '</svg>',
    thinking: THINK_CLOUD_SVG,
    lovePoem: LOVE_POEM_SVG,
    groupRedPacket:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/>' +
      '<circle cx="12" cy="14" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '</svg>'
  };
  var TOOL_LABELS = {
    mic: '语音',
    image: '图片',
    redo: '重回',
    mask: '触发回复',
    emoji: '表情',
    transfer: '转账',
    takeout: '点外卖',
    gift: '送礼',
    location: '位置',
    call: '视频通话',
    clock: '时间',
    narration: '旁白模式',
    thinking: '思维链',
    lovePoem: '情诗',
    groupRedPacket: '红包'
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('qq-room-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function dialog(opts) {
    var chain;
    if (global.miyaDialog) {
      if (opts.mode === 'confirm' && global.miyaDialog.confirm) chain = global.miyaDialog.confirm(opts);
      else if (global.miyaDialog.prompt) chain = global.miyaDialog.prompt(opts);
    }
    if (!chain) chain = Promise.resolve(null);
    return chain.finally(function () {
      restoreComposeAfterOverlay();
    });
  }

  function avatarFallback(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#EDE8E0"/><stop offset="100%" stop-color="#D8D0C4"/></linearGradient></defs>' +
      '<rect width="120" height="120" rx="4" fill="url(#g)"/>' +
      '<text x="60" y="72" text-anchor="middle" font-family="Georgia,serif" font-size="42" fill="#7A7268">' + ch + '</text></svg>'
    );
  }

  function formatMoney(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function sheetGrabHead(kicker, title, desc) {
    return (
      '<div class="qq-sheet__grab" aria-hidden="true"></div>' +
      '<header class="qq-sheet__head">' +
      '<span class="qq-sheet__kicker">' + kicker + '</span>' +
      '<h3 class="qq-sheet__title">' + title + '</h3>' +
      (desc ? '<p class="qq-sheet__desc">' + desc + '</p>' : '') +
      '</header>'
    );
  }

  function sheetField(no, label, en, inputHtml) {
    return (
      '<label class="qq-sheet__field">' +
      '<span class="qq-sheet__label"><em>' + no + '</em> ' + label + ' <i>' + en + '</i></span>' +
      inputHtml +
      '</label>'
    );
  }

  function sheetOpt(icon, title, sub, attrs, accent) {
    return (
      '<button type="button" class="qq-sheet__opt' + (accent ? ' qq-sheet__opt--accent' : '') + '" ' + attrs + '>' +
      '<span class="qq-sheet__opt-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="qq-sheet__opt-text"><strong>' + title + '</strong>' +
      (sub ? '<em>' + sub + '</em>' : '') +
      '</span>' +
      '<span class="qq-sheet__opt-chev" aria-hidden="true">›</span></button>'
    );
  }

  function formatMsgTime(ts) {
    var d = new Date(Number(ts) || Date.now());
    if (Number.isNaN(d.getTime())) return '';
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()) {
      return hm;
    }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  function scheduleRefreshLists() {
    clearTimeout(refreshListsTimer);
    refreshListsTimer = setTimeout(function () {
      refreshListsTimer = null;
      if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
        global.miyaChatApp.refreshLists();
      }
    }, 280);
  }

  function syncKeyboardInset() {
    if (!roomEl) return;
    var vv = window.visualViewport;
    var inset = 0;
    if (vv) {
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
    }
    roomEl.style.setProperty('--qq-kb-offset', inset + 'px');

    if (isIOSChat()) {
      syncIosKeyboardInset(vv, inset);
      return;
    }

    var open = inset > 40;
    roomEl.classList.toggle('qq-room--keyboard', open);
    if (open && vv) {
      roomEl.style.setProperty('--qq-kb-top', Math.round(vv.offsetTop || 0) + 'px');
      roomEl.style.setProperty('--qq-kb-height', Math.round(vv.height) + 'px');
      syncChatAppKeyboardShell(true, vv);
      if ((vv.offsetTop || 0) > 0) window.scrollTo(0, 0);
      scrollRoomToBottom($('qq-room-scroll'), true);
    } else {
      roomEl.style.removeProperty('--qq-kb-top');
      roomEl.style.removeProperty('--qq-kb-height');
      syncChatAppKeyboardShell(false);
    }
  }

  var keyboardInsetRaf = 0;

  function bindKeyboardInset() {
    if (keyboardInsetBound) return;
    keyboardInsetBound = true;
    bindRoomViewportLifecycle();
    var vv = window.visualViewport;
    function onViewportChange() {
      if (!state.chatId) return;
      if (keyboardInsetRaf) cancelAnimationFrame(keyboardInsetRaf);
      keyboardInsetRaf = requestAnimationFrame(function () {
        keyboardInsetRaf = 0;
        syncKeyboardInset();
      });
    }
    if (vv) {
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('resize', onViewportChange);
  }

  function snapScrollToBottom(sc) {
    if (!sc) sc = $('qq-room-scroll');
    if (!sc) return;
    sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    if (shouldQuietPinBottom()) return;
    var rows = sc.querySelectorAll('[data-msg-id]');
    var anchor = sc.querySelector('.qq-room__typing-row');
    var last = anchor || (rows.length ? rows[rows.length - 1] : null);
    if (last) {
      try {
        last.scrollIntoView({ block: 'end', inline: 'nearest' });
      } catch (e) {}
    }
    sc.scrollTop = Math.max(sc.scrollTop, sc.scrollHeight - sc.clientHeight);
  }

  function settleChatScrollBottom(sc, opts) {
    opts = opts || {};
    if (!sc) sc = $('qq-room-scroll');
    if (!sc || sc.id !== 'qq-room-scroll') return;
    var guardGen = opts.gen;
    var guardChatId = opts.chatId;
    var isFirstOpen = !!opts.isFirstOpen;
    function ok() {
      if (guardGen != null && guardGen !== roomOpenGen) return false;
      if (guardChatId != null && String(state.chatId) !== String(guardChatId)) return false;
      return !!(sc.isConnected && sc.id === 'qq-room-scroll');
    }
    function tick() {
      if (!ok()) return;
      snapScrollToBottom(sc);
    }
    armQuietPinBottom(isFirstOpen ? 1200 : 400);
    tick();
    requestAnimationFrame(tick);
    if (isFirstOpen) {
      setTimeout(tick, 60);
    }
  }

  function shouldQuietPinBottom() {
    if (!userPinnedBottom) return false;
    return Date.now() < roomPinBottomUntil;
  }

  function scrollRoomToBottom(sc, force) {
    if (!sc) sc = $('qq-room-scroll');
    if (!sc) return;
    if (force || (scrollMetrics(sc) || {}).nearBottom) {
      snapScrollToBottom(sc);
    }
  }

  function scrollMetrics(sc) {
    if (!sc) return null;
    var max = Math.max(0, sc.scrollHeight - sc.clientHeight);
    var top = sc.scrollTop;
    return {
      top: top,
      height: sc.scrollHeight,
      client: sc.clientHeight,
      max: max,
      nearBottom: max - top <= SCROLL_BOTTOM_THRESHOLD
    };
  }

  function captureScrollAnchor(sc) {
    if (!sc) return null;
    var metrics = scrollMetrics(sc);
    var anchorId = '';
    var offset = 0;
    var rows = sc.querySelectorAll('[data-msg-id]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowTop = row.offsetTop;
      if (rowTop + row.offsetHeight > metrics.top + 1) {
        anchorId = row.getAttribute('data-msg-id') || '';
        offset = metrics.top - rowTop;
        break;
      }
    }
    return { metrics: metrics, anchorId: anchorId, offset: offset };
  }

  function restoreScrollAnchor(sc, anchor, opts) {
    if (!sc) return;
    opts = opts || {};
    if (opts.toBottom || opts.stickBottom) {
      snapScrollToBottom(sc);
      return;
    }
    if (!anchor || !anchor.metrics) return;
    if (anchor.metrics.nearBottom) {
      snapScrollToBottom(sc);
      return;
    }
    if (anchor.anchorId) {
      var escId = String(anchor.anchorId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var row = sc.querySelector('[data-msg-id="' + escId + '"]');
      if (row) {
        sc.scrollTop = Math.max(0, row.offsetTop + anchor.offset);
        return;
      }
    }
    var delta = sc.scrollHeight - anchor.metrics.height;
    sc.scrollTop = Math.max(0, anchor.metrics.top + delta);
  }

  function applyScrollAfterLayout(sc, anchor, opts) {
    if (!sc) return;
    opts = opts || {};
    if (opts.toBottom || opts.stickBottom) {
      snapScrollToBottom(sc);
      /* 进房/贴底已 quiet-pin 时跳过强制回流，避免同帧双倍 layout */
      if (!shouldQuietPinBottom() && !opts.isFirstOpen) {
        void sc.offsetHeight;
        snapScrollToBottom(sc);
      }
      return;
    }
    restoreScrollAnchor(sc, anchor, opts);
    requestAnimationFrame(function () {
      restoreScrollAnchor(sc, anchor, opts);
    });
  }

  function rememberChatScroll(chatId) {
    if (!chatId) return;
    var sc = $('qq-room-scroll');
    if (!sc) return;
    scrollByChat[chatId] = captureScrollAnchor(sc);
  }

  function stickScrollIfNearBottom(sc) {
    if (!sc) return;
    var m = scrollMetrics(sc);
    if (m && m.nearBottom) snapScrollToBottom(sc);
  }

  function settleRoomScroll(sc, renderOpts) {
    if (!sc) return;
    renderOpts = renderOpts || {};
    if (renderOpts.toBottom || renderOpts.stickBottom) {
      snapScrollToBottom(sc);
      return;
    }
    if (renderOpts.restore) {
      restoreScrollAnchor(sc, renderOpts.restore, {});
    }
  }

  function revealRoomBoot(sc, renderOpts, isWarm) {
    renderOpts = renderOpts || {};
    settleRoomScroll(sc, renderOpts);
    void (sc && sc.offsetHeight);
    settleRoomScroll(sc, renderOpts);
    if (renderOpts.toBottom || renderOpts.stickBottom) {
      if (!isWarm) roomPinBottomUntil = Date.now() + 400;
      snapScrollToBottom(sc);
    }
  }

  function bindScrollMemory() {
    ensurePaneStack();
    var stack = $('qq-room-pane-stack');
    if (!stack) return;
    stack.querySelectorAll('.qq-room__chat-pane').forEach(bindPaneScroll);
    var sc = $('qq-room-scroll');
    if (sc) bindPaneScroll(sc);
  }

  function buildToolbarHtml(isGroup) {
    var keys = isGroup ? GROUP_TOOL_KEYS : TOOL_KEYS;
    return keys.map(function (key) {
      var isPlus = PLUS_TOOL_KEYS.indexOf(key) >= 0;
      var label = TOOL_LABELS[key] || key;
      var cls = 'qq-room__tool-icon';
      if (key === 'groupRedPacket') cls += ' qq-room__tool-icon--gold';
      var attrs = isPlus
        ? ' data-plus="' + key + '" aria-label="' + label + '"'
        : ' data-qq-tool="' + key + '" aria-label="' + label + '"' +
          (key === 'redo' ? ' title="重回"' : '');
      return '<button type="button" class="' + cls + '"' + attrs + '>' + TOOL_SVG[key] + '</button>';
    }).join('');
  }

  function syncNarrationModeUi() {
    if (roomEl) roomEl.classList.toggle('qq-room--narration-mode', !!state.narrationMode);
    var narrBtn = roomEl && roomEl.querySelector('[data-plus="narration"]');
    if (narrBtn) narrBtn.classList.toggle('is-active', !!state.narrationMode);
    var input = $('qq-room-input');
    if (input) {
      input.placeholder = state.narrationMode ? '写一段动作/场景旁白…' : 'Write something…';
    }
  }

  function toggleNarrationMode() {
    state.narrationMode = !state.narrationMode;
    syncNarrationModeUi();
    toast(state.narrationMode ? '已进入旁白模式' : '已退出旁白模式');
  }

  function syncToolbarPanel() {
    var bar = roomEl && roomEl.querySelector('.qq-room__toolbar');
    var toggle = $('qq-room-tools-toggle');
    if (!bar) return;
    bar.hidden = !toolbarOpen;
    bar.setAttribute('aria-hidden', toolbarOpen ? 'false' : 'true');
    if (roomEl) roomEl.classList.toggle('qq-room--tools-open', toolbarOpen);
    if (toggle) {
      var wechatFoot = roomEl && roomEl.classList.contains('mq-foot-wechat');
      toggle.innerHTML = wechatFoot ? COMPOSE_PLUS_SVG : (toolbarOpen ? COMPOSE_HEART_SVG : COMPOSE_PLUS_SVG);
      toggle.setAttribute('aria-label', toolbarOpen ? '收起工具' : '更多工具');
      toggle.setAttribute('aria-expanded', toolbarOpen ? 'true' : 'false');
      toggle.classList.toggle('is-active', toolbarOpen && !wechatFoot);
    }
  }

  function closeToolbarPanel() {
    if (!toolbarOpen) return;
    toolbarOpen = false;
    syncToolbarPanel();
  }

  function toggleToolbarPanel() {
    toolbarOpen = !toolbarOpen;
    if (toolbarOpen) closeEmojiPanel();
    syncToolbarPanel();
  }

  function roomInnerHtml() {
    return '<div class="mc-room-deco" aria-hidden="true">' +
        '<div class="mc-room-deco__grain"></div>' +
        '<div class="mc-room-deco__watermark">MIYA</div>' +
      '</div>' +
      '<div class="qq-room__toast" id="qq-room-toast"></div>' +
      '<header class="qq-room__head">' +
        '<div class="qq-room__head-profile">' +
          '<button type="button" class="qq-room__back" id="qq-room-back" aria-label="返回">' +
            '<svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
            '<span>Back</span>' +
          '</button>' +
          '<div class="qq-room__head-avatar">' +
            '<img id="qq-room-head-ava" src="" alt="">' +
          '</div>' +
          '<div class="qq-room__head-info">' +
            '<div class="qq-room__head-name" id="qq-room-title"></div>' +
            '<div class="qq-room__head-status" id="qq-room-head-status"></div>' +
          '</div>' +
          '<button type="button" class="qq-room__menu" id="qq-room-more" aria-label="更多">' +
            '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>' +
          '</button>' +
          '<div class="qq-room__head-divider"></div>' +
        '</div>' +
      '</header>' +
      '<div class="qq-room__main">' +
        '<div class="qq-room__pane-stack" id="qq-room-pane-stack">' +
          '<div class="qq-room__scroll qq-room__chat-pane" id="qq-room-scroll" data-chat-pane=""></div>' +
        '</div>' +
        '<div class="qq-room__loading" id="qq-room-loading" hidden aria-hidden="true" aria-live="polite">' +
          '<div class="qq-room__loading-spin" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<div class="qq-emo-panel" id="qq-emo-panel" hidden aria-hidden="true">' +
        '<div class="qq-emo-panel__top">' +
          '<div class="qq-emo-panel__rail" id="qq-emo-rail" role="tablist"></div>' +
          '<button type="button" class="qq-emo-panel__fold" id="qq-emo-close" data-qq-emo-close aria-label="收起表情">收起</button>' +
        '</div>' +
        '<div class="qq-emo-panel__mosaic" id="qq-emo-mosaic"></div>' +
      '</div>' +
      '<div class="qq-multi-bar" id="qq-room-multi-bar" hidden aria-hidden="true">' +
        '<div class="qq-multi-bar__main">' +
          '<span class="qq-multi-bar__tag">SELECT</span>' +
          '<span class="qq-multi-bar__count" id="qq-room-multi-count">0</span>' +
          '<span class="qq-multi-bar__hint">点选消息加入删除</span>' +
        '</div>' +
        '<div class="qq-multi-bar__actions">' +
          '<button type="button" class="qq-multi-bar__btn" data-qq-multi-cancel>取消</button>' +
          '<button type="button" class="qq-multi-bar__btn qq-multi-bar__btn--del" data-qq-multi-del>删除</button>' +
        '</div>' +
      '</div>' +
      '<footer class="qq-room__foot">' +
        '<div class="qq-room__quote-bar" id="qq-room-quote-bar" hidden aria-hidden="true"></div>' +
        '<div class="qq-room__toolbar" id="qq-room-toolbar" hidden aria-hidden="true">' + buildToolbarHtml() + '</div>' +
        '<div class="qq-room__sticker-suggest" id="qq-room-sticker-suggest" hidden aria-hidden="true"></div>' +
        '<div class="qq-room__input-box">' +
          '<button type="button" class="qq-room__compose-btn qq-room__compose-btn--ai" id="qq-room-ai" aria-label="触发回复">' +
            AI_STAR_SVG +
          '</button>' +
          '<button type="button" class="qq-room__compose-btn qq-room__compose-btn--plus" id="qq-room-tools-toggle" aria-label="更多工具" aria-expanded="false">' +
            COMPOSE_PLUS_SVG +
          '</button>' +
          '<textarea class="qq-room__input" id="qq-room-input" rows="1" placeholder="Write something…"></textarea>' +
          '<button type="button" class="qq-room__send" id="qq-room-send" aria-label="发送">' +
            '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '</button>' +
        '</div>' +
      '</footer>' +
      '<div class="qq-room__overlay" id="qq-room-overlay" hidden></div>' +
      '<div class="qq-think-pop" id="qq-room-think-pop" hidden aria-hidden="true">' +
        '<div class="qq-think-pop__card" role="dialog" aria-modal="true" aria-labelledby="qq-think-pop-title">' +
          '<header class="qq-think-pop__head">' +
            '<h2 class="qq-think-pop__title" id="qq-think-pop-title">思维链</h2>' +
          '</header>' +
          '<div class="qq-think-pop__body" id="qq-think-pop-body"></div>' +
        '</div>' +
      '</div>';
  }

  function ensurePaneStack() {
    if (!roomEl) return null;
    var stack = $('qq-room-pane-stack');
    if (stack) return stack;
    var main = roomEl.querySelector('.qq-room__main');
    if (!main) return null;
    var sc = $('qq-room-scroll') || main.querySelector('.qq-room__scroll');
    stack = document.createElement('div');
    stack.className = 'qq-room__pane-stack';
    stack.id = 'qq-room-pane-stack';
    if (sc) {
      sc.classList.add('qq-room__chat-pane');
      main.insertBefore(stack, main.firstChild);
      stack.appendChild(sc);
    } else {
      main.insertBefore(stack, main.firstChild);
    }
    return stack;
  }

  function bindPaneScroll(sc) {
    if (!sc || sc.dataset.scrollMemBound) return;
    sc.dataset.scrollMemBound = '1';
    sc.addEventListener('scroll', function () {
      if (!state.chatId) return;
      if (sc.id !== 'qq-room-scroll') return;
      var m = scrollMetrics(sc);
      if (m) {
        if (m.nearBottom) userPinnedBottom = true;
        else userPinnedBottom = false;
      }
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(function () {
        rememberChatScroll(state.chatId);
      }, 120);
      maybeLoadGroupHistory(sc);
    }, { passive: true });
  }

  function clearGroupPendingPrepend(chatId) {
    if (chatId != null) delete groupPendingPrepend[String(chatId)];
    else groupPendingPrepend = {};
  }

  function prependGroupHistoryChunk(pending) {
    if (!pending || pending.chunkEnd <= 0) return false;
    var sc = pending.sc;
    if (!sc || !sc.isConnected) return false;
    var anchor = captureScrollAnchor(sc);
    var chunkStart = Math.max(0, pending.chunkEnd - resolveHistoryRenderChunk());
    var hvIndex = resolveHeartVoiceHighlightIndex(pending.chatId, pending.ctx);
    var chunkHtml = buildMessagesHtml(pending.msgs, pending.ctx, pending.roles, chunkStart, pending.chunkEnd, hvIndex);
    pending.chunkEnd = chunkStart;
    if (!chunkHtml) {
      if (chunkStart > 0) return prependGroupHistoryChunk(pending);
      clearGroupPendingPrepend(pending.chatId);
      return false;
    }
    var tmp = document.createElement('div');
    tmp.innerHTML = chunkHtml;
    var insertBefore = sc.querySelector('[data-msg-id]');
    if (!insertBefore && pending.pack && pending.pack.hidden > 0) {
      var hint = sc.querySelector('.qq-room__mount-hint');
      insertBefore = hint ? hint.nextElementSibling : sc.firstChild;
    }
    var frag = document.createDocumentFragment();
    var newNodes = [];
    while (tmp.firstChild) {
      newNodes.push(tmp.firstChild);
      frag.appendChild(tmp.firstChild);
    }
    sc.insertBefore(frag, insertBefore);
    for (var ni = 0; ni < newNodes.length; ni++) {
      if (newNodes[ni] && newNodes[ni].nodeType === 1) hydrateBubbleMedia(newNodes[ni]);
    }
    restoreScrollAnchor(sc, anchor, {});
    if (pending.chunkEnd <= 0) clearGroupPendingPrepend(pending.chatId);
    return true;
  }

  function maybeLoadGroupHistory(sc) {
    if (!sc || sc.id !== 'qq-room-scroll' || !state.chatId) return;
    var pending = groupPendingPrepend[String(state.chatId)];
    if (!pending || pending.gen !== groupRenderGen) return;
    var m = scrollMetrics(sc);
    if (!m || m.top > GROUP_HISTORY_SCROLL_THRESHOLD) return;
    prependGroupHistoryChunk(pending);
  }

  function purgeDetachedChatPanes() {
    Object.keys(roomChatPanes).forEach(function (id) {
      var entry = roomChatPanes[id];
      if (entry && entry.pane && !entry.pane.isConnected) delete roomChatPanes[id];
    });
  }

  function resolveChatScrollEl(chatId) {
    var cid = String(chatId || state.chatId || '').trim();
    if (cid && roomChatPanes[cid] && roomChatPanes[cid].pane) {
      var pane = roomChatPanes[cid].pane;
      if (pane.isConnected) {
        if (state.chatId && String(state.chatId) === cid && pane.id !== 'qq-room-scroll') {
          pane.id = 'qq-room-scroll';
        }
        return pane;
      }
    }
    var sc = $('qq-room-scroll');
    if (sc && sc.isConnected) return sc;
    return null;
  }

  function snapshotChatPane(chatId) {
    if (!chatId || !roomChatPanes[chatId]) return;
    var entry = roomChatPanes[chatId];
    var pack = getVisibleMessages(chatId);
    entry.scrollTop = entry.pane.scrollTop;
    var m = scrollMetrics(entry.pane);
    entry.wasNearBottom = !!(m && m.nearBottom);
    entry.avatars = Object.assign({}, state.avatars);
    entry.msgCount = pack.visible.length;
    entry.lastMsgId = pack.visible.length ? String(pack.visible[pack.visible.length - 1].id) : '';
    entry.loaded = entry.pane.querySelector('[data-msg-id], .qq-room__empty') != null;
  }

  function ensureChatPane(chatId) {
    ensureRoomRoot();
    ensurePaneStack();
    var cid = String(chatId);
    if (roomChatPanes[cid]) return roomChatPanes[cid];

    var stack = $('qq-room-pane-stack');
    var pane = stack && stack.querySelector('.qq-room__chat-pane[data-chat-pane=""]');
    if (!pane && stack) {
      pane = stack.querySelector('.qq-room__chat-pane:not([data-chat-pane])');
    }
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'qq-room__scroll qq-room__chat-pane';
      pane.hidden = true;
      if (stack) stack.appendChild(pane);
    }
    pane.setAttribute('data-chat-pane', cid);
    bindPaneScroll(pane);
    roomChatPanes[cid] = {
      pane: pane,
      loaded: false,
      scrollTop: 0,
      wasNearBottom: true,
      avatars: {},
      msgCount: 0,
      lastMsgId: ''
    };
    return roomChatPanes[cid];
  }

  function activateChatPane(chatId) {
    var cid = String(chatId);
    purgeDetachedChatPanes();
    var entry = roomChatPanes[cid];
    if (!entry) entry = ensureChatPane(chatId);
    var stack = $('qq-room-pane-stack');
    if (stack) {
      stack.querySelectorAll('.qq-room__chat-pane').forEach(function (pane) {
        pane.hidden = true;
        pane.removeAttribute('id');
      });
    }
    Object.keys(roomChatPanes).forEach(function (id) {
      var item = roomChatPanes[id];
      if (!item || !item.pane) return;
      if (id === cid) {
        item.pane.hidden = false;
        item.pane.id = 'qq-room-scroll';
      } else {
        item.pane.hidden = true;
        item.pane.removeAttribute('id');
      }
    });
    return entry.pane;
  }

  function parkActiveChatPane() {
    var chatId = state.chatId;
    if (!chatId) return;
    snapshotChatPane(chatId);
    rememberChatScroll(chatId);
    var entry = roomChatPanes[String(chatId)];
    if (entry && entry.pane) {
      entry.pane.hidden = true;
      entry.pane.removeAttribute('id');
    }
  }

  function isChatPaneCached(chatId) {
    var entry = roomChatPanes[String(chatId)];
    return !!(
      entry &&
      entry.loaded &&
      entry.pane &&
      entry.pane.isConnected &&
      entry.pane.querySelector('[data-msg-id], .qq-room__empty')
    );
  }

  function isChatPaneStale(chatId) {
    var entry = roomChatPanes[String(chatId)];
    if (!entry || !entry.loaded || !entry.pane) return true;
    var sc = entry.pane;
    if (sc.querySelector('.qq-room__sys:not([data-msg-id])')) return true;
    var pack = getVisibleMessages(chatId);
    var msgs = pack.visible.filter(function (m) {
      if (!m || m.id == null || m.deleted) return false;
      if (m.role === 'system') {
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) return false;
      }
      return true;
    });
    var domRows = sc.querySelectorAll('[data-msg-id]');
    if (domRows.length !== msgs.length) return true;
    for (var i = 0; i < msgs.length; i++) {
      if (String(domRows[i].getAttribute('data-msg-id')) !== String(msgs[i].id)) return true;
    }
    return false;
  }

  function syncChatPaneMessages(chatId) {
    var entry = roomChatPanes[String(chatId)];
    if (!entry || !entry.loaded) return false;
    if (isChatPaneStale(chatId)) {
      renderMessages(chatId, { toBottom: true });
      snapshotChatPane(chatId);
      return true;
    }
    var sc = entry.pane;
    var pack = getVisibleMessages(chatId);
    var msgs = pack.visible;
    var domIds = {};
    sc.querySelectorAll('[data-msg-id]').forEach(function (row) {
      var id = row.getAttribute('data-msg-id') || '';
      domIds[id] = true;
    });
    var firstMissing = -1;
    var i;
    for (i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m || m.id == null) continue;
      var fmt0 = global.MiyaChatOnlineFormat;
      if (m.role === 'system' && fmt0 && typeof fmt0.isRoomInvisibleMessage === 'function' && fmt0.isRoomInvisibleMessage(m)) {
        continue;
      }
      if (!domIds[String(m.id)]) {
        firstMissing = i;
        break;
      }
    }
    if (firstMissing < 0) {
      snapshotChatPane(chatId);
      return false;
    }
    for (i = firstMissing; i < msgs.length; i++) {
      var mid = msgs[i];
      if (!mid || mid.id == null) continue;
      var fmt1 = global.MiyaChatOnlineFormat;
      if (mid.role === 'system' && fmt1 && typeof fmt1.isRoomInvisibleMessage === 'function' && fmt1.isRoomInvisibleMessage(mid)) {
        continue;
      }
      if (domIds[String(mid.id)]) {
        renderMessages(chatId, { toBottom: true });
        snapshotChatPane(chatId);
        return true;
      }
    }
    var appended = false;
    for (i = firstMissing; i < msgs.length; i++) {
      var msg = msgs[i];
      if (!msg || msg.id == null) continue;
      var fmt2 = global.MiyaChatOnlineFormat;
      if (msg.role === 'system' && fmt2 && typeof fmt2.isRoomInvisibleMessage === 'function' && fmt2.isRoomInvisibleMessage(msg)) {
        continue;
      }
      if (domIds[String(msg.id)]) continue;
      appendBubbleEl(msg, { stickBottom: false, instant: true });
      appended = true;
    }
    if (pack.hidden > 0) {
      var hint = sc.querySelector('.qq-room__mount-hint');
      var hintText = '仅显示最近 ' + pack.limit + ' 条（共 ' + packTotalCount(pack) + ' 条）';
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'qq-room__mount-hint';
        sc.insertBefore(hint, sc.firstChild);
      }
      hint.textContent = hintText;
    }
    snapshotChatPane(chatId);
    return appended;
  }

  function enterChatAtLatest(sc, opts) {
    settleChatScrollBottom(sc, opts || {});
  }

  function ensureRoomLoadingShell() {
    if (!roomEl) return;
    ensurePaneStack();
    var main = roomEl.querySelector('.qq-room__main');
    if (!main) return;
    if (!$('qq-room-loading')) {
      var loading = document.createElement('div');
      loading.id = 'qq-room-loading';
      loading.className = 'qq-room__loading';
      loading.hidden = true;
      loading.setAttribute('aria-hidden', 'true');
      loading.setAttribute('aria-live', 'polite');
      loading.innerHTML = '<div class="qq-room__loading-spin" aria-hidden="true"></div>';
      main.appendChild(loading);
    }
  }

  function showRoomLoading(on) {
    ensureRoomLoadingShell();
    var el = $('qq-room-loading');
    if (!roomEl || !el) return;
    if (on) {
      el.hidden = false;
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-busy', 'true');
      roomEl.classList.add('qq-room--loading');
    } else {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('aria-busy');
      roomEl.classList.remove('qq-room--loading');
    }
  }

  function ensureRoomRoot() {
    roomEl = $('qq-room');
    if (!roomEl) {
      roomEl = document.createElement('div');
      roomEl.id = 'qq-room';
      roomEl.className = 'qq-room';
      roomEl.hidden = true;
      roomEl.setAttribute('aria-hidden', 'true');
      roomEl.innerHTML = roomInnerHtml();
      var app = $('miya-chat-app');
      if (app) app.appendChild(roomEl);
      else document.body.appendChild(roomEl);
      bindRoomEvents();
      bindScrollMemory();
    } else if (
      !roomEl.querySelector('#qq-emo-panel') ||
      !roomEl.querySelector('#qq-room-quote-bar') ||
      !roomEl.querySelector('#qq-room-multi-bar') ||
      !roomEl.querySelector('#qq-room-sticker-suggest') ||
      !roomEl.querySelector('#qq-room-head-ava') ||
      !roomEl.querySelector('#qq-room-tools-toggle') ||
      !roomEl.querySelector('#qq-room-think-pop') ||
      (!isGroupRoom() && !roomEl.querySelector('[data-plus="thinking"]'))
    ) {
      var hvKeep = roomEl.querySelector('#mc-hv-panel');
      roomEl.innerHTML = roomInnerHtml();
      if (hvKeep) roomEl.appendChild(hvKeep);
      roomChatPanes = {};
      roomOpenGen += 1;
      groupRenderGen += 1;
      clearGroupPendingPrepend();
      delete roomEl.dataset.bound;
      bindRoomEvents();
      bindScrollMemory();
    }
    bindKeyboardInset();
    ensurePaneStack();
    ensureRoomLoadingShell();
    return roomEl;
  }

  function isGroupRoom() {
    if (!state.chatId || !store) return false;
    var chat = store.findChat(state.chatId);
    return !!(chat && chat.type === 'group');
  }

  function getChatContext(chatId) {
    var chat = store.findChat(chatId);
    if (!chat) return null;
    var profile = null;
    if (chat.profileId && store.getProfiles) {
      profile = store.getProfiles().find(function (p) { return p.id === chat.profileId; }) || null;
    }
    if (!profile && store.getActiveProfile) profile = store.getActiveProfile();
    var gg = global.MiyaChatGroup;
    if (chat.type === 'group' && gg) {
      var members = typeof gg.getMembers === 'function' ? gg.getMembers(store, chat) : [];
      return { chat: chat, contact: null, profile: profile, members: members, isGroup: true };
    }
    var contact = store.findContact(chat.contactId);
    return { chat: chat, contact: contact, profile: profile, isGroup: false };
  }

  function resolveSenderContact(ctx, m) {
    if (!ctx || !ctx.isGroup || !m || m.role !== 'assistant') return null;
    if (ctx._senderCache && m.id != null) {
      var cacheKey = String(m.id);
      if (Object.prototype.hasOwnProperty.call(ctx._senderCache, cacheKey)) {
        return ctx._senderCache[cacheKey];
      }
    }
    var sid = String(m.senderContactId || '').trim();
    if (sid && ctx.members) {
      for (var i = 0; i < ctx.members.length; i++) {
        if (ctx.members[i].id === sid) {
          if (ctx._senderCache && m.id != null) ctx._senderCache[String(m.id)] = ctx.members[i];
          return ctx.members[i];
        }
      }
    }
    var gg = global.MiyaChatGroup;
    var raw = String(m.content || '').trim();
    var labelMatch = raw.match(/^【([^】]+)】/);
    if (labelMatch && gg && typeof gg.resolveMemberByLabel === 'function') {
      var hitLabel = gg.resolveMemberByLabel(labelMatch[1], ctx.members, store, ctx.chat.id);
      if (ctx._senderCache && m.id != null) ctx._senderCache[String(m.id)] = hitLabel;
      return hitLabel;
    }
    var colonMatch = raw.match(/^([^：:\n|｜]{1,32})[：:]/);
    if (colonMatch && gg && typeof gg.resolveMemberByLabel === 'function') {
      var hitColon = gg.resolveMemberByLabel(colonMatch[1], ctx.members, store, ctx.chat.id);
      if (ctx._senderCache && m.id != null) ctx._senderCache[String(m.id)] = hitColon;
      return hitColon;
    }
    if (ctx._senderCache && m.id != null) ctx._senderCache[String(m.id)] = null;
    return null;
  }

  function senderNameForBubble(ctx, m, fallback) {
    var gg = global.MiyaChatGroup;
    var sc = resolveSenderContact(ctx, m);
    if (sc && gg && typeof gg.memberDisplayName === 'function') {
      return gg.memberDisplayName(store, sc, ctx.chat.id);
    }
    var fb = String(fallback || '').trim();
    if (!fb || fb === 'TA') return '成员';
    return fb;
  }

  function renderGroupMemberTitleBadge(ctx, m) {
    if (!ctx || !ctx.isGroup) return '';
    var gg = global.MiyaChatGroup;
    if (!gg || typeof gg.getMemberTitle !== 'function') return '';
    var memberId = '';
    if (m && m.role === 'user') {
      memberId = gg.USER_OWNER_ID || '__user__';
    } else {
      var sc = resolveSenderContact(ctx, m);
      if (!sc) return '';
      memberId = sc.id;
    }
    return renderGroupTitleBadgeByMemberId(ctx, memberId);
  }

  function renderGroupTitleBadgeByMemberId(ctx, memberId) {
    if (!ctx || !ctx.isGroup || !memberId) return '';
    var gg = global.MiyaChatGroup;
    if (!gg || typeof gg.getMemberTitle !== 'function') return '';
    var settings = store && store.getChatSettings ? store.getChatSettings(ctx.chat.id) : null;
    var title = gg.getMemberTitle(settings, memberId);
    if (!title || !title.name) return '';
    var color = title.color || gg.DEFAULT_TITLE_COLOR || '#8b7355';
    return '<span class="qq-room__member-title qq-room__bubble-title" style="--grp-title-color:' + esc(color) + '">' + esc(title.name) + '</span>';
  }

  function renderGroupRoleBadge(ctx, m) {
    if (!ctx || !ctx.isGroup) return '';
    var gg = global.MiyaChatGroup;
    if (!gg || typeof gg.getMemberRole !== 'function') return '';
    var sc = resolveSenderContact(ctx, m);
    if (!sc) return '';
    var settings = store && store.getChatSettings ? store.getChatSettings(ctx.chat.id) : null;
    var role = gg.getMemberRole(settings, sc.id);
    var label = gg.roleLabel ? gg.roleLabel(role) : '';
    if (!label) return '';
    var cls = 'qq-room__role-badge';
    if (role === 'owner') cls += ' qq-room__role-badge--owner';
    else if (role === 'admin') cls += ' qq-room__role-badge--admin';
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  function messageRoleKey(m, ctx) {
    if (!m || m.role === 'system') return 'system';
    if (m.role === 'user') return 'user';
    if (ctx && ctx.isGroup) {
      var sc = resolveSenderContact(ctx, m);
      return sc ? 'assistant:' + sc.id : 'assistant:unknown';
    }
    return 'assistant';
  }

  var DEFAULT_MESSAGE_RENDER_LIMIT = 100;

  function resolveDisplayLimit(chatId) {
    if (!store || !chatId || !store.getChatSettings) return DEFAULT_MESSAGE_RENDER_LIMIT;
    var settings = store.getChatSettings(chatId);
    var n = settings && Number(settings.messageRenderLimit);
    if (!Number.isFinite(n)) return DEFAULT_MESSAGE_RENDER_LIMIT;
    return Math.min(500, Math.max(20, Math.floor(n)));
  }

  function isLowEndDevice() {
    return !!(document.documentElement && document.documentElement.classList.contains('is-low-end'));
  }

  function resolveHistoryRenderChunk() {
    return isLowEndDevice() ? GROUP_MSG_RENDER_CHUNK_LOW_END : GROUP_MSG_RENDER_CHUNK;
  }

  function resolveBubbleStaggerMs() {
    return isLowEndDevice() ? BUBBLE_STAGGER_MS_LOW_END : BUBBLE_STAGGER_MS;
  }

  function resolveInitialRenderCount(chatId, opts) {
    var limit = resolveDisplayLimit(chatId);
    var firstOpen = !!(opts && opts.isFirstOpen);
    var base = firstOpen
      ? (isLowEndDevice() ? GROUP_MSG_RENDER_OPEN_LOW_END : GROUP_MSG_RENDER_OPEN)
      : (isLowEndDevice() ? GROUP_MSG_RENDER_INITIAL_LOW_END : GROUP_MSG_RENDER_INITIAL);
    var floor = firstOpen ? 16 : 24;
    return Math.min(base, Math.max(floor, Math.floor(limit / (firstOpen ? 3 : 2))));
  }

  function canIncrementalAppend(sc, msgs, opts) {
    if (!sc || !msgs || !msgs.length) return false;
    if (opts.restore || opts.forceRefresh) return false;
    var rows = sc.querySelectorAll('.qq-room__row[data-msg-id]');
    if (!rows.length) return false;
    var lastDomId = rows[rows.length - 1].getAttribute('data-msg-id');
    var lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || !lastDomId) return false;
    /* 已包含最新一条：无需增量追加（是否整表刷新由调用方决定） */
    if (String(lastMsg.id) === String(lastDomId)) return false;
    /* 可见列表变长：DOM 应为 msgs 的严格前缀 */
    if (rows.length < msgs.length) {
      var alignMsg = msgs[rows.length - 1];
      return !!(alignMsg && String(alignMsg.id) === String(lastDomId));
    }
    /* 已达渲染上限：条数不变但末尾滑动了 1 条 */
    if (rows.length === msgs.length) {
      var prevMsg = msgs[msgs.length - 2];
      return !!(prevMsg && String(prevMsg.id) === String(lastDomId));
    }
    return false;
  }

  function appendTrailingMessages(sc, msgs, opts) {
    var rows = sc.querySelectorAll('.qq-room__row[data-msg-id]');
    if (!rows.length || !msgs.length) return false;
    var lastDomId = rows[rows.length - 1].getAttribute('data-msg-id');
    if (!lastDomId) return false;
    var startIdx = -1;
    var i;
    for (i = 0; i < msgs.length; i++) {
      if (msgs[i] && String(msgs[i].id) === String(lastDomId)) {
        startIdx = i + 1;
        break;
      }
    }
    if (startIdx < 0 || startIdx >= msgs.length) return false;
    for (i = startIdx; i < msgs.length; i++) {
      appendBubbleEl(msgs[i], {
        stickBottom: opts.toBottom !== false,
        instant: true
      });
    }
    return true;
  }

  function getVisibleMessages(chatId) {
    var limit = resolveDisplayLimit(chatId);
    if (store && typeof store.getRecentVisibleMessages === 'function') {
      var pack = store.getRecentVisibleMessages(chatId, limit);
      return {
        all: pack.visible,
        visible: pack.visible,
        hidden: pack.hidden || 0,
        limit: pack.limit || limit,
        total: pack.total != null ? pack.total : pack.visible.length
      };
    }
    var all = store.getMessages(chatId).filter(function (m) { return m && !m.deleted; });
    if (all.length <= limit) {
      return { all: all, visible: all, hidden: 0, limit: limit, total: all.length };
    }
    return {
      all: all,
      visible: all.slice(-limit),
      hidden: all.length - limit,
      limit: limit,
      total: all.length
    };
  }

  function packTotalCount(pack) {
    if (!pack) return 0;
    if (pack.total != null) return pack.total;
    return pack.all ? pack.all.length : (pack.visible ? pack.visible.length : 0);
  }

  function trimDisplayedRows(sc, chatId) {
    if (!sc) return;
    var limit = resolveDisplayLimit(chatId);
    var hint = sc.querySelector('.qq-room__mount-hint');
    var rows = sc.querySelectorAll('.qq-room__row:not(.qq-room__typing-row)');
    while (rows.length > limit) {
      rows[0].remove();
      rows = sc.querySelectorAll('.qq-room__row:not(.qq-room__typing-row)');
    }
    var pack = getVisibleMessages(chatId);
    if (pack.hidden > 0) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'qq-room__mount-hint';
        sc.insertBefore(hint, sc.firstChild);
      }
      hint.textContent = '仅显示最近 ' + pack.limit + ' 条（共 ' + packTotalCount(pack) + ' 条）';
    } else if (hint) {
      hint.remove();
    }
  }

  function resolveHeaderStatus(ctx) {
    if (!ctx) return 'ONLINE';
    if (ctx.isGroup) {
      var n = ctx.members ? ctx.members.length : 0;
      var pn = (ctx.profile && ctx.profile.name) || '我';
      return pn + ' · ' + n + ' 位成员';
    }
    if (!ctx.contact) return 'ONLINE';
    var parts = ['Online'];
    var c = ctx.contact;
    if (c.gender) parts.push(String(c.gender).trim());
    else if (c.birthday) parts.push(String(c.birthday).trim());
    return parts.join(' · ');
  }

  function resolveDisplayName(ctx) {
    if (!ctx) return '聊天';
    if (ctx.isGroup) return String((ctx.chat && ctx.chat.title) || '群聊').trim();
    if (!ctx.contact) return '聊天';
    return String(ctx.contact.remarkName || ctx.contact.name || '未命名').trim();
  }

  function profileAvatarKey(profile) {
    return profile && profile.id ? 'profile:' + profile.id : 'profile:active';
  }

  function getChatDisplayAvatars(chatId) {
    if (!chatId || !store || !store.getChatSettings) return null;
    var settings = store.getChatSettings(chatId);
    return settings && settings.chatDisplayAvatars;
  }

  function hasChatDisplayAvatarOverride(chatId, kind) {
    var da = getChatDisplayAvatars(chatId);
    if (!da) return false;
    if (kind === 'profile') {
      return !!(String(da.profileUrl || '').trim() || da.profileBlobId);
    }
    return !!(String(da.contactUrl || '').trim() || da.contactBlobId);
  }

  function resolveChatDisplayAvatarSync(chatId, kind) {
    var da = getChatDisplayAvatars(chatId);
    if (!da) return '';
    var url = kind === 'profile' ? da.profileUrl : da.contactUrl;
    var blobId = kind === 'profile' ? da.profileBlobId : da.contactBlobId;
    var u = String(url || '').trim();
    if (u) return u;
    if (blobId && store.getCachedBlobUrl) {
      return store.getCachedBlobUrl(blobId) || '';
    }
    return '';
  }

  function resolveChatDisplayAvatarAsync(chatId, kind) {
    var sync = resolveChatDisplayAvatarSync(chatId, kind);
    if (sync) return Promise.resolve(sync);
    var da = getChatDisplayAvatars(chatId);
    if (!da || !store.getAvatarUrl) return Promise.resolve('');
    var blobId = kind === 'profile' ? da.profileBlobId : da.contactBlobId;
    if (!blobId) return Promise.resolve('');
    return store.getAvatarUrl(blobId).then(function (url) {
      return url || '';
    }).catch(function () {
      return '';
    });
  }

  function resolveProfileAvatarUrl(profile, chatId) {
    chatId = chatId || state.chatId;
    if (profile) {
      var extras = global.miyaChatRoomExtras;
      if (extras && typeof extras.resolveProfileDisplayAvatarSync === 'function') {
        var overrideSync = extras.resolveProfileDisplayAvatarSync(profile);
        if (overrideSync) {
          var pKey = profileAvatarKey(profile);
          state.avatars[pKey] = overrideSync;
          return Promise.resolve(overrideSync);
        }
      }
      if (store && store.hasProfileDisplayAvatarOverride && store.hasProfileDisplayAvatarOverride(profile)) {
        if (extras && typeof extras.resolveProfileDisplayAvatarAsync === 'function') {
          return extras.resolveProfileDisplayAvatarAsync(profile).then(function (override) {
            if (!override) return resolveProfileAvatarUrlFromArchive(profile);
            var pKey2 = profileAvatarKey(profile);
            state.avatars[pKey2] = override;
            return override;
          });
        }
        return resolveProfileAvatarUrlFromArchive(profile);
      }
    }
    return resolveProfileAvatarUrlFromArchive(profile);
  }

  function resolveProfileAvatarUrlFromArchive(profile) {
    if (!profile) {
      var fb = avatarFallback('我');
      state.avatars['profile:active'] = fb;
      return Promise.resolve(fb);
    }
    var key = profileAvatarKey(profile);
    if (state.avatars[key]) return Promise.resolve(state.avatars[key]);
    if (profile.avatarId && store.getAvatarUrl) {
      return store.getAvatarUrl(profile.avatarId).then(function (url) {
        var u = url || avatarFallback(profile.name);
        state.avatars[key] = u;
        return u;
      });
    }
    var fallback = avatarFallback(profile.name);
    state.avatars[key] = fallback;
    return Promise.resolve(fallback);
  }

  function findArchiveAvatar(contact) {
    if (!contact) return '';
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.findCharacter !== 'function') return '';
    try {
      var chronicleId = String(contact.chronicleId || '').trim();
      var characterId = String(contact.characterId || '').trim();
      var row =
        (chronicleId && cs.findCharacter(chronicleId)) ||
        (characterId && cs.findCharacter(characterId)) ||
        null;
      return row && row.avatar ? String(row.avatar).trim() : '';
    } catch (e) {
      return '';
    }
  }

  function resolveAvatarUrlSync(contact, chatId) {
    if (!contact) return '';
    chatId = chatId || state.chatId;
    var key = contact.id;
    if (state.avatars[key]) return state.avatars[key];
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveContactAvatarUrl === 'function') {
      var fromExtras = extras.resolveContactAvatarUrl(contact, chatId);
      if (fromExtras) return fromExtras;
    }
    if (store && store.hasContactDisplayAvatarOverride && store.hasContactDisplayAvatarOverride(contact)) {
      return '';
    }
    var av = String(contact.avatar || '').trim();
    if (av) return av;
    var archiveAv = findArchiveAvatar(contact);
    if (archiveAv) return archiveAv;
    var blobId = String(contact.avatarBlobId || '').trim();
    if (blobId && store && typeof store.getCachedBlobUrl === 'function') {
      return store.getCachedBlobUrl(blobId) || '';
    }
    return '';
  }

  function resolveAvatarUrl(contact, chatId) {
    if (!contact) return Promise.resolve('');
    chatId = chatId || state.chatId;
    var key = contact.id;
    var sync = resolveAvatarUrlSync(contact, chatId);
    if (sync) {
      state.avatars[key] = sync;
      return Promise.resolve(sync);
    }
    return resolveAvatarUrlFromContact(contact, key, chatId);
  }

  function resolveAvatarUrlFromContact(contact, key, chatId) {
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
      return extras.resolveContactAvatarUrlAsync(contact, chatId).then(function (url) {
        var u = url || '';
        if (u) state.avatars[key] = u;
        return u;
      });
    }
    var blobId = String(contact.avatarBlobId || '').trim();
    if (blobId && store && store.getAvatarUrl) {
      return store.getAvatarUrl(blobId).then(function (url) {
        var u = url || findArchiveAvatar(contact) || '';
        state.avatars[key] = u;
        return u;
      }).catch(function () {
        var u = findArchiveAvatar(contact) || '';
        state.avatars[key] = u;
        return u;
      });
    }
    var archiveOnly = findArchiveAvatar(contact);
    state.avatars[key] = archiveOnly || '';
    return Promise.resolve(state.avatars[key]);
  }

  function stripApiTimePrefix(text) {
    var aw = global.MiyaChatAwareness;
    if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
      return aw.stripTimelinePrefixForDisplay(text);
    }
    return String(text || '').trim();
  }

  function stripThinkingForDisplay(text) {
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.stripThinkingForApi === 'function') {
      return eng.stripThinkingForApi(text);
    }
    return String(text || '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/\<think\>[\s\S]*?<\/think>/gi, '')
      .trim();
  }

  function displayProfileName() {
    var ctx = getChatContext(state.chatId);
    return (ctx && ctx.profile && ctx.profile.name) || '我';
  }

  function displayContactName(contact) {
    if (!contact) return 'TA';
    return String(contact.remarkName || contact.name || 'TA').trim();
  }

  function messageQuoteableText(m) {
    if (!m || m.deleted) return '';
    var fmt = global.MiyaChatOnlineFormat;
    if (fmt && typeof fmt.formatMessageBodyOnly === 'function') {
      return fmt.formatMessageBodyOnly(m);
    }
    var raw = messagePlainText(m);
    if (fmt && fmt.RE_QUOTE) {
      raw = raw.replace(new RegExp('^引用[-－—][^\\n]*\\n?', 'gm'), '');
    }
    return raw.trim();
  }

  function messagePlainText(m) {
    if (!m || m.deleted || m.recalled) return '';
    if (m.type === 'html' || m.renderAsHtml) return '〔HTML 交互页〕';
    if (m.role === 'system') return stripApiTimePrefix(m.content || '');
    var fmt = global.MiyaChatOnlineFormat;
    if (fmt && typeof fmt.formatMessageBodyOnly === 'function') {
      var body = stripApiTimePrefix(fmt.formatMessageBodyOnly(m));
      if (body) return body;
    }
    if (m.type === 'voice') return m.voiceText || m.content || '';
    if (m.type === 'location' && m.locationCard) {
      return (m.locationCard.name || '') + ' ' + (m.locationCard.address || '');
    }
    if (m.type === 'transfer' && m.redPacket) {
      return '转账 ¥' + m.redPacket.amount + (m.redPacket.note ? ' · ' + m.redPacket.note : '');
    }
    if (m.type === 'group_red_packet' && m.groupRedPacket) {
      var grpPrev = (m.groupRedPacket.mode === 'exclusive' ? '专属' : '拼手气') + ' ¥' + m.groupRedPacket.totalAmount;
      if (m.groupRedPacket.note) grpPrev += ' · ' + m.groupRedPacket.note;
      return '[红包] ' + grpPrev;
    }
    if (m.type === 'love_poem' && m.lovePoem) {
      var lpPrev = String(m.lovePoem.style || '情诗').trim();
      var lpTitle = String(m.lovePoem.title || '').trim();
      if (lpTitle && lpTitle !== '（无题）') lpPrev += ' · ' + lpTitle;
      return '[情诗] ' + lpPrev;
    }
    if (m.type === 'match_record' && m.matchRecord) {
      var mrPrev = String(m.matchRecord.eventName || '赛事').trim();
      if (m.matchRecord.eventItemName) mrPrev += ' · ' + m.matchRecord.eventItemName;
      return '[赛事记录] ' + mrPrev;
    }
    if (m.type === 'sayguess_record' && m.sayguessRecord) {
      var sgPrev = '你说我猜';
      if (m.sayguessRecord.bankName) sgPrev += ' · ' + m.sayguessRecord.bankName;
      return '[你说我猜] ' + sgPrev;
    }
    var raw = stripApiTimePrefix(m.voiceText || m.content);
    if (m.role === 'assistant') raw = stripThinkingForDisplay(raw);
    return raw;
  }

  function copyTextSync(text) {
    var t = String(text || '');
    if (!t.trim()) return false;
    function tryOnce(readonly) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        if (readonly) ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '2em';
        ta.style.height = '2em';
        ta.style.padding = '0';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.opacity = '0';
        ta.style.fontSize = '16px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, t.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) {
        return false;
      }
    }
    return tryOnce(true) || tryOnce(false);
  }

  function copyText(text) {
    var t = String(text || '');
    if (!t.trim()) return Promise.reject(new Error('empty'));
    if (copyTextSync(t)) return Promise.resolve();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    return Promise.reject(new Error('copy failed'));
  }

  function buildQuoteRefFromMessage(msg) {
    if (!msg) return null;
    var ref = {
      dir: msg.role === 'user' ? 'out' : 'in',
      text: messageQuoteableText(msg).slice(0, 200),
      ts: msg.createdAt,
      msgId: msg.id,
      msgType: String(msg.type || 'text')
    };
    if (msg.imageDataKey) ref.imageDataKey = msg.imageDataKey;
    if (msg.imageKind) ref.imageKind = msg.imageKind;
    if (msg.stickerBlobId) ref.stickerBlobId = msg.stickerBlobId;
    if (msg.stickerUrl) ref.stickerUrl = msg.stickerUrl;
    if (msg.stickerName) ref.stickerName = msg.stickerName;
    return ref;
  }

  function quoteRefWhoLabel(quoteRef, msg) {
    if (!quoteRef) return '';
    if (quoteRef.dir === 'out') return displayProfileName();
    if (quoteRef.speakerName) return String(quoteRef.speakerName);
    var ctx = getChatContext(state.chatId);
    if (ctx && ctx.isGroup && msg && msg.role === 'assistant') {
      return senderNameForBubble(ctx, msg, '成员');
    }
    return displayContactName(ctx && ctx.contact);
  }

  function resolveMessageQuoteRef(m) {
    if (!m) return null;
    var ref = null;
    if (m.quoteRef && m.quoteRef.text) ref = m.quoteRef;
    if (!ref) {
      var fmt = global.MiyaChatOnlineFormat;
      var payload = fmt && fmt.parseDisplayPayload
        ? fmt.parseDisplayPayload(m)
        : { kind: 'text', msg: m, text: m.content };
      ref = payload.quoteRef || null;
    }
    if (!ref || !ref.text) return null;
    var aw = global.MiyaChatAwareness;
    if (aw && typeof aw.stripQuotePromptLeakage === 'function') {
      var cleaned = aw.stripQuotePromptLeakage(String(ref.text));
      if (!cleaned) return null;
      if (cleaned !== ref.text) ref = Object.assign({}, ref, { text: cleaned });
    }
    return ref;
  }

  function findQuotedMessage(quoteRef, beforeMsg) {
    if (!quoteRef || !store || !state.chatId) return null;
    if (quoteRef.msgId) {
      var hit = store.findMessage(state.chatId, quoteRef.msgId);
      if (hit && !hit.deleted) return hit;
    }
    var qt = String(quoteRef.text || '').trim();
    if (!qt) return null;
    var fmt = global.MiyaChatOnlineFormat;
    var matchQuote = fmt && typeof fmt.messageMatchesQuoteRef === 'function'
      ? fmt.messageMatchesQuoteRef
      : null;
    var list = store.getMessages(state.chatId);
    var endIdx = list.length - 1;
    if (beforeMsg && beforeMsg.id) {
      var j;
      for (j = list.length - 1; j >= 0; j--) {
        if (list[j] && list[j].id === beforeMsg.id) {
          endIdx = j - 1;
          break;
        }
      }
    }
    var i;
    for (i = endIdx; i >= 0; i--) {
      var row = list[i];
      if (!row || row.deleted) continue;
      if (matchQuote) {
        if (matchQuote(row, quoteRef, messageQuoteableText)) return row;
      } else {
        var body = messageQuoteableText(row);
        if (body === qt) return row;
        if ((qt === '[图片]' || qt.indexOf('图片') === 0) && row.type === 'image' && row.imageDataKey) return row;
      }
    }
    return null;
  }

  function resolveQuotePreviewMsg(quoteRef, quotedMsg) {
    if (quotedMsg && !quotedMsg.deleted) return quotedMsg;
    if (!quoteRef) return null;
    if (quoteRef.msgId && store && state.chatId) {
      var hit = store.findMessage(state.chatId, quoteRef.msgId);
      if (hit && !hit.deleted) return hit;
    }
    var qt = String(quoteRef.text || '').trim();
    if (!qt) return null;
    return {
      role: quoteRef.dir === 'out' ? 'user' : 'assistant',
      type: quoteRef.msgType || 'text',
      content: qt,
      imageDataKey: quoteRef.imageDataKey || '',
      imageKind: quoteRef.imageKind || '',
      stickerBlobId: quoteRef.stickerBlobId || '',
      stickerUrl: quoteRef.stickerUrl || '',
      stickerName: quoteRef.stickerName || ''
    };
  }

  function renderQuoteCardMini(payload, srcMsg) {
    if (!payload || !srcMsg) return '';
    var fmt = global.MiyaChatOnlineFormat;
    var displayMsg = payload.msg || srcMsg;
    if (payload.kind === 'takeout') {
      var od = fmt && fmt.resolveTakeoutOrderFromMessage
        ? fmt.resolveTakeoutOrderFromMessage(displayMsg)
        : displayMsg.takeoutOrder;
      if (!od || !od.shop) return '';
      return '<div class="qq-refchip__card qq-refchip__card--to">' +
        '<span class="qq-refchip__card-kicker">外卖 · Takeout</span>' +
        '<span class="qq-refchip__card-title">' + esc(od.shop) + '</span>' +
        '<span class="qq-refchip__card-meta">' + esc(od.items || '—') + ' · ¥' + esc(formatMoney(Number(od.amount) || 0)) + '</span>' +
        '</div>';
    }
    if (payload.kind === 'gift') {
      var gp = fmt && fmt.resolveGiftParcelFromMessage
        ? fmt.resolveGiftParcelFromMessage(displayMsg)
        : displayMsg.giftParcel;
      if (!gp || !gp.items || !gp.items.length) return '';
      var gName = gp.items.length === 1 ? String(gp.items[0].name || '礼品') : '礼盒 · ' + gp.items.length + ' 件';
      return '<div class="qq-refchip__card qq-refchip__card--gift">' +
        '<span class="qq-refchip__card-kicker">礼品 · Gift</span>' +
        '<span class="qq-refchip__card-title">' + esc(gName) + '</span></div>';
    }
    if (payload.kind === 'transfer' && displayMsg.redPacket) {
      var rp = displayMsg.redPacket;
      return '<div class="qq-refchip__card qq-refchip__card--xfer">' +
        '<span class="qq-refchip__card-kicker">转账 · Transfer</span>' +
        '<span class="qq-refchip__card-title">¥' + esc(formatMoney(Number(rp.amount) || 0)) + '</span>' +
        '<span class="qq-refchip__card-meta">' + esc(rp.note || '（无附言）') + '</span></div>';
    }
    if (payload.kind === 'location' && displayMsg.locationCard) {
      var lc = displayMsg.locationCard;
      return '<div class="qq-refchip__card qq-refchip__card--loc">' +
        '<span class="qq-refchip__card-kicker">位置 · Location</span>' +
        '<span class="qq-refchip__card-title">' + esc(lc.name || '位置') + '</span>' +
        (lc.address ? '<span class="qq-refchip__card-meta">' + esc(lc.address) + '</span>' : '') +
        '</div>';
    }
    if (payload.kind === 'voice') {
      var vt = String(payload.voiceText || displayMsg.voiceText || '').trim();
      return '<div class="qq-refchip__card qq-refchip__card--voice">' +
        '<span class="qq-refchip__card-kicker">语音 · Voice</span>' +
        '<span class="qq-refchip__card-meta">' + esc(vt || '…') + '</span></div>';
    }
    return '';
  }

  function renderQuoteMediaInner(quoteRef, quotedMsg) {
    var srcMsg = resolveQuotePreviewMsg(quoteRef, quotedMsg);
    if (!srcMsg) return '';
    var fmt = global.MiyaChatOnlineFormat;
    var payload = fmt && fmt.parseDisplayPayload
      ? fmt.parseDisplayPayload(srcMsg)
      : { kind: 'text', msg: srcMsg, text: srcMsg.content };
    var cardMini = renderQuoteCardMini(payload, srcMsg);
    if (cardMini) return cardMini;
    if (payload.kind === 'photo' && srcMsg.imageDataKey) {
      return '<img class="qq-refchip__thumb" data-msg-img="' + esc(srcMsg.imageDataKey) + '" alt="" loading="lazy">';
    }
    if (payload.kind === 'sticker') {
      var stickerUrl = srcMsg.stickerUrl || payload.stickerUrl || '';
      var blobId = srcMsg.stickerBlobId || payload.stickerBlobId || '';
      if (stickerUrl) {
        return '<img class="qq-refchip__thumb qq-refchip__thumb--sticker" src="' + esc(stickerUrl) + '" alt="" loading="lazy">';
      }
      if (blobId) {
        return '<img class="qq-refchip__thumb qq-refchip__thumb--sticker" data-msg-sticker="' + esc(blobId) + '" alt="" loading="lazy">';
      }
    }
    if (payload.kind === 'textImage') {
      var cap = payload.caption || String(srcMsg.content || '').trim().replace(/^图片[-－—]\s*/, '') || '[图片]';
      return '<div class="qq-refchip__card qq-refchip__card--img">' +
        '<span class="qq-refchip__card-kicker">图片 · Image</span>' +
        '<span class="qq-refchip__card-meta">' + esc(cap) + '</span></div>';
    }
    return '';
  }

  function renderMessageQuote(m) {
    var quoteRef = resolveMessageQuoteRef(m);
    if (!quoteRef || !quoteRef.text) return '';
    var qLabel = quoteRefWhoLabel(quoteRef, m);
    var quotedMsg = findQuotedMessage(quoteRef, m);
    var mediaHtml = renderQuoteMediaInner(quoteRef, quotedMsg);
    if (mediaHtml) {
      return '<div class="qq-refchip qq-refchip--media" aria-label="引用">' +
        '<div class="qq-refchip__body">' +
        '<span class="qq-refchip__tag"><span class="qq-refchip__tag-kicker" aria-hidden="true">REF · </span>' + esc(qLabel) + '</span>' +
        mediaHtml +
        '</div></div>';
    }
    return '<div class="qq-refchip" aria-label="引用">' +
      '<span class="qq-refchip__tag"><span class="qq-refchip__tag-kicker" aria-hidden="true">REF · </span>' + esc(qLabel) + '</span>' +
      '<p class="qq-refchip__text">' + esc(quoteRef.text) + '</p>' +
      '</div>';
  }

  function renderQuoteBar() {
    var bar = $('qq-room-quote-bar');
    if (!bar) return;
    if (!state.quoteRef) {
      bar.hidden = true;
      bar.setAttribute('aria-hidden', 'true');
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.setAttribute('aria-hidden', 'false');
    var label = quoteRefWhoLabel(state.quoteRef, null);
    bar.innerHTML =
      '<div class="qq-refbar" role="note">' +
      '<div class="qq-refbar__main">' +
      '<span class="qq-refbar__tag"><span class="qq-refbar__tag-kicker" aria-hidden="true">REF · </span>回复 ' + esc(label) + '</span>' +
      '<p class="qq-refbar__text">' + esc(state.quoteRef.text) + '</p>' +
      '</div>' +
      '<button type="button" class="qq-refbar__close" data-qq-quote-cancel aria-label="取消引用">取消</button>' +
      '</div>';
  }

  function cancelQuote() {
    state.quoteRef = null;
    renderQuoteBar();
  }

  function enterQuoteMode(msg) {
    if (!msg) return;
    state.quoteRef = buildQuoteRefFromMessage(msg);
    renderQuoteBar();
    focusComposeInput();
  }

  function renderTransferCard(m, opts) {
    opts = opts || {};
    var rp = m.redPacket || {};
    var amt = formatMoney(rp.amount || 0);
    var note = String(rp.note || '').trim() || '恭喜发财，大吉大利';
    var fmt = global.MiyaChatOnlineFormat;
    var status = fmt && fmt.transferStatusLabel ? fmt.transferStatusLabel(rp) : '';
    var dir = rp.dir === 'in' ? 'in' : 'out';
    var pending = !opts.preview && m.role === 'assistant' && dir === 'in' && rp.status === 'pending';
    var dirLabel = dir === 'in' ? 'Incoming' : 'Outgoing';
    var actions = pending
      ? '<div class="qq-card-xfer__acts">' +
        '<button type="button" class="qq-card-xfer__btn qq-card-xfer__btn--ok" data-xfer-act="accept">确认收款</button>' +
        '<button type="button" class="qq-card-xfer__btn" data-xfer-act="refund">退回</button></div>'
      : '';
    return '<div class="qq-card qq-card-xfer qq-card-xfer--' + dir + '" data-msg-id="' + esc(m.id) + '">' +
      '<div class="qq-card-xfer__grain" aria-hidden="true"></div>' +
      '<div class="qq-card-xfer__line qq-card-xfer__line--a" aria-hidden="true"></div>' +
      '<div class="qq-card-xfer__line qq-card-xfer__line--b" aria-hidden="true"></div>' +
      '<header class="qq-card-xfer__head">' +
        '<span class="qq-card-xfer__kicker">Transfer · 转账</span>' +
        '<span class="qq-card-xfer__dir">' + esc(dirLabel) + '</span>' +
      '</header>' +
      '<div class="qq-card-xfer__body">' +
        '<div class="qq-card-xfer__seal" aria-hidden="true">' +
          '<span class="qq-card-xfer__seal-ring"></span>' +
          '<span class="qq-card-xfer__icon">¥</span>' +
        '</div>' +
        '<div class="qq-card-xfer__amt"><small>CNY</small>' + esc(amt) + '</div>' +
        '<div class="qq-card-xfer__note">' + esc(note) + '</div>' +
      '</div>' +
      '<footer class="qq-card-xfer__foot">' +
        (status ? '<span class="qq-card-xfer__status">' + esc(status) + '</span>' : '<span class="qq-card-xfer__status">—</span>') +
        '<span class="qq-card-xfer__mark" aria-hidden="true">PAY</span>' +
      '</footer>' +
      actions +
    '</div>';
  }

  function scrubMatchRecordProse(text, participants) {
    var br = global.miyaMatchBridge;
    if (br && typeof br.scrubMatchProse === 'function') {
      return br.scrubMatchProse(text, { participants: participants || [] });
    }
    var t = String(text == null ? '' : text);
    t = t.replace(/\bcontactId\s*[=：:]\s*[A-Za-z0-9_\-]+/gi, '');
    t = t.replace(/[（(\[【]\s*ct_[A-Za-z0-9_]+\s*[）)\]】]/g, '');
    t = t.replace(/\bct_[A-Za-z0-9_]+\b/g, '');
    (participants || []).forEach(function (p) {
      var cid = String(p && p.contactId || '').trim();
      if (cid.length >= 4) {
        t = t.split(cid).join('');
      }
    });
    return t.replace(/[（(\[【]\s*[）)\]】]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function parseMatchRecordSegments(text, nameList) {
    var br = global.miyaMatchBridge;
    if (br && typeof br.parseMatchBeatSegments === 'function') {
      return br.parseMatchBeatSegments(text, nameList);
    }
    var raw = String(text || '');
    if (!raw.trim()) return [];
    var names = (nameList || []).map(function (n) { return String(n || '').trim(); }).filter(Boolean)
      .sort(function (a, b) { return b.length - a.length; });
    var nameAlt = names.map(function (n) {
      return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|');
    var reQuoted = /^(.{1,24}?)\s*[：:]\s*[「“"](.+?)[」”"]\s*$/;
    var reKnown = nameAlt ? new RegExp('^(' + nameAlt + ')\\s*[：:]\\s*(.+)$') : null;
    var lines = raw.split(/\n/);
    var segs = [];
    var buf = [];
    function flush() {
      var n = buf.join('\n').trim();
      if (n) segs.push({ type: 'narration', text: n });
      buf = [];
    }
    lines.forEach(function (line) {
      var trimmed = String(line || '').trim();
      if (!trimmed) {
        if (buf.length) buf.push('');
        return;
      }
      var m = trimmed.match(reQuoted) || (reKnown && trimmed.match(reKnown));
      if (m && m[1] && m[2]) {
        flush();
        segs.push({
          type: 'speech',
          name: String(m[1]).trim(),
          text: String(m[2]).trim().replace(/^[「“"]+/, '').replace(/[」”"]+$/, '').trim()
        });
        return;
      }
      buf.push(line);
    });
    flush();
    return segs.length ? segs : [{ type: 'narration', text: raw.trim() }];
  }

  function matchRecordSpeakerAvatarHtml(mr, speakerName) {
    var name = String(speakerName || '').trim();
    var hit = (mr.participants || []).find(function (p) {
      return p && String(p.name) === name;
    });
    var url = '';
    if (hit) {
      url = String(hit.avatar || hit.avatarUrl || '').trim();
      if (!url) {
        var contact = store && store.findContact ? store.findContact(hit.contactId) : null;
        if (contact) url = resolveAvatarUrlSync(contact, '') || '';
      }
    } else {
      var isHost = (mr.profileName && String(mr.profileName) === name) ||
        name === '我' || name === '主持人' || name === '用户';
      var profile = null;
      if (mr.profileId && store.getProfiles) {
        profile = (store.getProfiles() || []).find(function (p) {
          return String(p.id) === String(mr.profileId);
        }) || null;
      }
      if (!profile && mr.profileName && store.getProfiles) {
        profile = (store.getProfiles() || []).find(function (p) {
          return String(p.name) === String(mr.profileName);
        }) || null;
      }
      if (profile && String(profile.name || '') === name) isHost = true;
      if (isHost) {
        url = String(mr.profileAvatar || '').trim();
        if (!url && profile) {
          var pKey = profileAvatarKey(profile);
          if (state.avatars[pKey]) url = state.avatars[pKey];
        }
        if (!url && profile && store.resolveProfileDisplayAvatarSync) {
          url = String(store.resolveProfileDisplayAvatarSync(profile) || '').trim();
        }
        if (!url && profile && profile.avatarId && store.getCachedBlobUrl) {
          url = String(store.getCachedBlobUrl(profile.avatarId) || '').trim();
        }
        if (!url && profile) {
          url = String(profile.avatarUrl || profile.avatar || '').trim();
        }
        if (!url && profile) {
          resolveProfileAvatarUrl(profile).then(function (loaded) {
            var u = String(loaded || '').trim();
            if (!u) return;
            document.querySelectorAll('.qq-card-match__speech-av--ph').forEach(function (el) {
              var row = el.closest('.qq-card-match__speech');
              if (!row) return;
              var nm = row.querySelector('.qq-card-match__speech-name');
              if (!nm || String(nm.textContent || '').trim() !== name) return;
              var img = document.createElement('img');
              img.className = 'qq-card-match__speech-av';
              img.src = u;
              img.alt = '';
              el.replaceWith(img);
            });
          });
        }
      }
    }
    if (url) {
      return '<img class="qq-card-match__speech-av" src="' + esc(url) + '" alt="">';
    }
    return '<div class="qq-card-match__speech-av qq-card-match__speech-av--ph">' +
      esc((name || '?').slice(0, 1)) + '</div>';
  }

  function renderMatchBeatBodyHtml(beatText, mr) {
    var cleaned = scrubMatchRecordProse(beatText, mr.participants || []);
    var names = [];
    if (mr.profileName) names.push(mr.profileName);
    (mr.participants || []).forEach(function (p) {
      if (p && p.name) names.push(p.name);
    });
    var segs = parseMatchRecordSegments(cleaned, names);
    return segs.map(function (seg) {
      if (seg.type === 'speech') {
        return '<div class="qq-card-match__speech">' +
          matchRecordSpeakerAvatarHtml(mr, seg.name) +
          '<div class="qq-card-match__speech-body">' +
            '<div class="qq-card-match__speech-name">' + esc(seg.name) + '</div>' +
            '<div class="qq-card-match__speech-text">' + esc(seg.text) + '</div>' +
          '</div></div>';
      }
      return '<div class="qq-card-match__narration">' + esc(seg.text) + '</div>';
    }).join('');
  }

  function renderMatchRecordCard(m) {
    try {
      return renderMatchRecordCardInner(m);
    } catch (err) {
      console.warn('[miyaChatRoom] match record card render failed', err);
      var fallback = String((m && m.content) || '').trim() || '[赛事记录]';
      return '<div class="qq-card qq-card-match" data-msg-id="' + esc(m && m.id) + '">' +
        '<div class="qq-card-match__body"><div class="qq-card-match__title">赛事记录</div>' +
        '<div class="qq-card-match__hl">' + esc(fallback.slice(0, 240)) + '</div></div></div>';
    }
  }

  function renderMatchRecordCardInner(m) {
    var mr = m.matchRecord && typeof m.matchRecord === 'object' ? m.matchRecord : {};
    var eventName = String(mr.eventName || '').trim() || '赛事';
    var itemName = String(mr.eventItemName || '').trim() || '比赛';
    var highlight = scrubMatchRecordProse(mr.highlight || '', mr.participants || []);
    var modeLabel = mr.mode === 'team' ? '阵营赛' : '单人赛';
    var rankLines = [];
    if (mr.mode === 'team') {
      rankLines.push('胜方 · 阵营 ' + (mr.winnerTeam || '—'));
      if (mr.mvpContactId) {
        var mvp = (mr.participants || []).find(function (p) {
          return String(p.contactId) === String(mr.mvpContactId);
        });
        rankLines.push('MVP · ' + (mvp && mvp.name ? mvp.name : mr.mvpContactId));
      }
      var prizes = mr.prizes || {};
      if (prizes.teamWin) rankLines.push('胜方奖品 · ' + prizes.teamWin);
      if (prizes.teamLose) rankLines.push('败方奖品 · ' + prizes.teamLose);
      if (prizes.mvp) rankLines.push('MVP奖品 · ' + prizes.mvp);
    } else if (Array.isArray(mr.rankings)) {
      mr.rankings.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); }).forEach(function (row) {
        var who = (mr.participants || []).find(function (p) {
          return String(p.contactId) === String(row.contactId);
        });
        var prize = (mr.prizes && mr.prizes.soloRanks && mr.prizes.soloRanks[(row.rank || 1) - 1]) || '';
        rankLines.push(
          '第' + row.rank + '名 · ' + (who && who.name ? who.name : '选手') +
          (prize ? ' · ' + prize : '') +
          (row.note ? ' · ' + scrubMatchRecordProse(row.note, mr.participants || []) : '')
        );
      });
    }
    var beats = Array.isArray(mr.beats) && mr.beats.length
      ? mr.beats
      : (String(mr.narrative || '').trim() ? [String(mr.narrative).trim()] : []);
    var beatsHtml = beats.map(function (b, i) {
      return '<div class="qq-card-match__beat"><span class="qq-card-match__beat-no">SCENE ' + (i + 1) + '</span>' +
        renderMatchBeatBodyHtml(b, mr) + '</div>';
    }).join('');
    var reactionsHtml = '';
    if (Array.isArray(mr.reactions) && mr.reactions.length) {
      reactionsHtml = '<div class="qq-card-match__rx-full">' +
        mr.reactions.map(function (rx) {
          return '<div class="qq-card-match__rx-item"><strong>' + esc(rx.name || '角色') + '</strong>' +
            '<p>' + esc(scrubMatchRecordProse(rx.text || '', mr.participants || [])) + '</p></div>';
        }).join('') +
        '</div>';
    }
    return '<div class="qq-card qq-card-match" data-msg-id="' + esc(m.id) + '" data-match-expand>' +
      '<div class="qq-card-match__grain" aria-hidden="true"></div>' +
      '<header class="qq-card-match__head">' +
        '<span class="qq-card-match__kicker">Match · 赛事记录</span>' +
        '<span class="qq-card-match__mode">' + esc(modeLabel) + '</span>' +
      '</header>' +
      '<div class="qq-card-match__body">' +
        '<div class="qq-card-match__title">' + esc(eventName) + ' · ' + esc(itemName) + '</div>' +
        (highlight ? '<div class="qq-card-match__hl">' + esc(highlight) + '</div>' : '') +
        (rankLines.length
          ? '<ul class="qq-card-match__ranks">' + rankLines.map(function (l) {
              return '<li>' + esc(l) + '</li>';
            }).join('') + '</ul>'
          : '') +
        '<div class="qq-card-match__detail">' +
          (beatsHtml ? '<div class="qq-card-match__detail-label">完整赛程</div>' + beatsHtml : '') +
          (reactionsHtml ? '<div class="qq-card-match__detail-label">选手感想</div>' + reactionsHtml : '') +
        '</div>' +
      '</div>' +
      '<footer class="qq-card-match__foot">' +
        '<span class="qq-card-match__tip">点按展开 / 收起全文</span>' +
        '<span class="qq-card-match__mark" aria-hidden="true">LIVE</span>' +
      '</footer>' +
    '</div>';
  }

  function renderSayGuessRecordCard(m) {
    try {
      return renderSayGuessRecordCardInner(m);
    } catch (err) {
      console.warn('[miyaChatRoom] sayguess record card render failed', err);
      var fallback = String((m && m.content) || '').trim() || '[你说我猜]';
      return '<div class="qq-card qq-card-sayguess" data-msg-id="' + esc(m && m.id) + '">' +
        '<div class="qq-card-sayguess__body"><div class="qq-card-sayguess__title">你说我猜</div>' +
        '<div class="qq-card-sayguess__hl">' + esc(fallback.slice(0, 240)) + '</div></div></div>';
    }
  }

  function renderSayGuessRecordCardInner(m) {
    var sg = m.sayguessRecord && typeof m.sayguessRecord === 'object' ? m.sayguessRecord : {};
    var modeLabel = sg.mode === 'other_lead' ? '你们说我猜' : '我说你们猜';
    var winner = Array.isArray(sg.rankings) && sg.rankings[0] ? sg.rankings[0] : null;
    var rankLines = Array.isArray(sg.rankings)
      ? sg.rankings.map(function (r) {
          var prize = '';
          if (r.rank === 1 && sg.prizes && sg.prizes.first) prize = sg.prizes.first;
          if (r.rank === 2 && sg.prizes && sg.prizes.second) prize = sg.prizes.second;
          if (r.rank === 3 && sg.prizes && sg.prizes.third) prize = sg.prizes.third;
          return '第' + r.rank + '名 · ' + (r.name || '玩家') + ' · ' + (r.score || 0) + '分' +
            (prize ? ' · ' + prize : '');
        })
      : [];
    var roundsHtml = (Array.isArray(sg.rounds) ? sg.rounds : []).map(function (r, i) {
      var describer = (sg.players || []).find(function (p) {
        return String(p.id) === String(r.describerId);
      });
      var parts = [];
      parts.push('<div class="qq-card-sayguess__round">');
      parts.push('<div class="qq-card-sayguess__round-no">第 ' + (i + 1) + ' 轮</div>');
      parts.push('<div class="qq-card-sayguess__meta">出题 · ' + esc((describer && describer.name) || '—') +
        '　答案 · <b>' + esc(r.word || '') + '</b></div>');
      if (r.description) {
        parts.push('<div class="qq-card-sayguess__desc">' + esc(r.description) + '</div>');
      }
      (Array.isArray(r.dialogue) ? r.dialogue : []).forEach(function (ln) {
        parts.push('<div class="qq-card-sayguess__line"><strong>' + esc(ln.name || '') + '</strong>' +
          '<p>' + esc(ln.speech || '') + '</p>' +
          (ln.guess ? '<span class="qq-card-sayguess__guess">' + esc(ln.guess) + '</span>' : '') +
          '</div>');
      });
      if (!(r.dialogue || []).length) {
        (Array.isArray(r.guesses) ? r.guesses : []).forEach(function (g) {
          var who = (sg.players || []).find(function (p) {
            return String(p.id) === String(g.playerId);
          });
          parts.push('<div class="qq-card-sayguess__line"><strong>' + esc((who && who.name) || '?') + '</strong>' +
            (g.speech && g.speech !== g.text ? '<p>' + esc(g.speech) + '</p>' : '') +
            '<span class="qq-card-sayguess__guess">' + esc(g.text || '') + '</span>' +
            (g.hit ? '<em>+1</em>' : '') +
            '</div>');
        });
      }
      if (Array.isArray(r.review) && r.review.length) {
        parts.push('<div class="qq-card-sayguess__meta">揭晓讨论</div>');
        r.review.forEach(function (ln) {
          parts.push('<div class="qq-card-sayguess__line"><strong>' + esc(ln.name || '') + '</strong>' +
            '<p>' + esc(ln.speech || '') + '</p></div>');
        });
      }
      parts.push('</div>');
      return parts.join('');
    }).join('');
    var reactionsHtml = '';
    if (Array.isArray(sg.reactions) && sg.reactions.length) {
      reactionsHtml = '<div class="qq-card-sayguess__rx">' +
        sg.reactions.map(function (rx) {
          return '<div><strong>' + esc(rx.name || '') + '</strong><p>' + esc(rx.text || '') + '</p></div>';
        }).join('') + '</div>';
    }
    return '<div class="qq-card qq-card-sayguess" data-msg-id="' + esc(m.id) + '" data-sg-expand>' +
      '<header class="qq-card-sayguess__head">' +
        '<span class="qq-card-sayguess__kicker">Say · 你说我猜</span>' +
        '<span class="qq-card-sayguess__mode">' + esc(modeLabel) + '</span>' +
      '</header>' +
      '<div class="qq-card-sayguess__body">' +
        '<div class="qq-card-sayguess__title">' + esc(sg.bankName || '你说我猜') + '</div>' +
        (winner
          ? '<div class="qq-card-sayguess__hl">' + esc(winner.name) + ' 赢了 · ' + (winner.score || 0) + ' 分</div>'
          : '') +
        (rankLines.length
          ? '<ul class="qq-card-sayguess__ranks">' + rankLines.map(function (l) {
              return '<li>' + esc(l) + '</li>';
            }).join('') + '</ul>'
          : '') +
        '<div class="qq-card-sayguess__detail">' +
          (roundsHtml ? '<div class="qq-card-sayguess__detail-label">完整对局</div>' + roundsHtml : '') +
          (reactionsHtml ? '<div class="qq-card-sayguess__detail-label">感想</div>' + reactionsHtml : '') +
        '</div>' +
      '</div>' +
      '<footer class="qq-card-sayguess__foot">' +
        '<span>点按展开 / 收起</span>' +
        '<span>' + esc(String(sg.totalRounds || 0)) + ' 轮</span>' +
      '</footer>' +
    '</div>';
  }

  function renderLocationCard(m) {
    var card = m.locationCard || {};
    var name = String(card.name || '').trim() || '位置';
    var addr = String(card.address || '').trim();
    return '<div class="qq-card qq-card-loc">' +
      '<div class="qq-card-loc__map" aria-hidden="true">' +
        '<div class="qq-card-loc__grid"></div>' +
        '<div class="qq-card-loc__ring"></div>' +
        '<span class="qq-card-loc__pin"></span>' +
        '<span class="qq-card-loc__cross qq-card-loc__cross--h"></span>' +
        '<span class="qq-card-loc__cross qq-card-loc__cross--v"></span>' +
      '</div>' +
      '<div class="qq-card-loc__body">' +
        '<span class="qq-card-loc__kicker">Location · 位置</span>' +
        '<div class="qq-card-loc__name">' + esc(name) + '</div>' +
        (addr ? '<div class="qq-card-loc__addr">' + esc(addr) + '</div>' : '') +
      '</div>' +
      '<footer class="qq-card-loc__foot">' +
        '<span class="qq-card-loc__coord">PIN · DROPPED</span>' +
        '<span class="qq-card-loc__chev" aria-hidden="true">›</span>' +
      '</footer>' +
    '</div>';
  }

  function renderVoiceCard(m, opts) {
    opts = opts || {};
    var text = stripApiTimePrefix(m.voiceText || m.content || '').replace(/^语音[-－—]\s*/, '');
    var userRecDur =
      typeof m.voiceDurationSec === 'number' &&
      Number.isFinite(m.voiceDurationSec) &&
      m.voiceDurationSec > 0
        ? Math.max(1, Math.round(m.voiceDurationSec))
        : 0;
    var cachedDur =
      typeof m.voiceTtsDurationSec === 'number' &&
      Number.isFinite(m.voiceTtsDurationSec) &&
      m.voiceTtsDurationSec > 0
        ? Math.max(1, Math.round(m.voiceTtsDurationSec))
        : 0;
    var dur = userRecDur || cachedDur || Math.min(59, Math.max(1, Math.ceil(String(text).replace(/\s/g, '').length / 4)));
    var isRoleVoice = m.role === 'assistant';
    var hasUserRecording = m.role === 'user' && !!String(m.voiceAudioIdbKey || '').trim();
    var showPlay = !opts.preview && (isRoleVoice || hasUserRecording);
    var playBtn = showPlay
      ? '<button type="button" class="qq-card-voice__play" data-mq-voice-play data-msg-id="' +
        esc(m.id) +
        '" aria-label="播放语音"></button>'
      : '';
    var roleCls = isRoleVoice ? ' qq-card-voice--role' : '';
    if (hasUserRecording) roleCls += ' qq-card-voice--recorded';
    return '<div class="qq-card qq-card-voice' + roleCls + '" data-voice-toggle aria-label="语音 ' + dur + ' 秒">' +
      '<div class="qq-card-voice__row">' +
        playBtn +
        '<span class="qq-card-voice__wave" aria-hidden="true">' +
          '<span class="qq-card-voice__bar"></span><span class="qq-card-voice__bar"></span>' +
          '<span class="qq-card-voice__bar"></span><span class="qq-card-voice__bar"></span>' +
          '<span class="qq-card-voice__bar"></span>' +
        '</span>' +
        '<span class="qq-card-voice__dur" data-mq-voice-tts-dur>' + dur + '″</span>' +
      '</div>' +
      '<p class="qq-card-voice__text">' + esc(text || '…') + '</p>' +
    '</div>';
  }

  function isChatImageGenerating(m, chatId) {
    if (!m || m.imageDataKey || m.imageGenFailed) return false;
    if (m.imageGenPending) return true;
    var ig = global.MiyaImageGen;
    var cid = chatId != null ? chatId : state.chatId;
    if (!ig || typeof ig.shouldAutoGenerateChatMessage !== 'function') return false;
    return !!cid && ig.shouldAutoGenerateChatMessage(cid, m);
  }

  function renderImageCard(m, payload, opts) {
    opts = opts || {};
    var preview = !!opts.preview;
    if (payload.kind === 'photo' && m.imageDataKey) {
      return '<div class="qq-card qq-card-photo">' +
        '<span class="qq-card-photo__kicker">Photo · 图片</span>' +
        '<button type="button" class="qq-card-photo__frame qq-card-photo__tap" data-mq-img-view data-msg-img="' + esc(m.imageDataKey) + '" aria-label="查看大图">' +
          '<span class="qq-card-photo__corner qq-card-photo__corner--tl" aria-hidden="true"></span>' +
          '<span class="qq-card-photo__corner qq-card-photo__corner--br" aria-hidden="true"></span>' +
          '<img class="qq-card-img" data-msg-img="' + esc(m.imageDataKey) + '" alt="图片" loading="lazy">' +
        '</button>' +
        '<footer class="qq-card-photo__foot"><span>IMAGE</span><span class="qq-card-photo__idx">01</span></footer>' +
      '</div>';
    }
    if (isChatImageGenerating(m, opts.chatId)) {
      var capPending = payload.caption || stripApiTimePrefix(m.content || '').replace(/^图片[-－—]\s*/, '') || '文字图片';
      return '<div class="qq-card qq-card-txtimg qq-card-txtimg--gen">' +
        '<div class="qq-card-txtimg__grain" aria-hidden="true"></div>' +
        '<header class="qq-card-txtimg__head">' +
          '<span class="qq-card-txtimg__kicker qq-card-txtimg__kicker--gen">生图中…</span>' +
        '</header>' +
        '<div class="qq-card-txtimg__canvas qq-card-txtimg__canvas--gen">' +
          '<span class="qq-card-gen-spin" aria-hidden="true"></span>' +
          '<p class="qq-card-txtimg__text">' + esc(capPending) + '</p>' +
        '</div>' +
      '</div>';
    }
    if (m.imageGenFailed) {
      var capFailed = payload.caption || stripApiTimePrefix(m.content || '').replace(/^图片[-－—]\s*/, '') || '文字图片';
      return '<div class="qq-card qq-card-txtimg qq-card-txtimg--failed">' +
        '<div class="qq-card-txtimg__grain" aria-hidden="true"></div>' +
        '<header class="qq-card-txtimg__head">' +
          '<span class="qq-card-txtimg__kicker qq-card-txtimg__kicker--fail">生图失败</span>' +
        '</header>' +
        '<div class="qq-card-txtimg__canvas qq-card-txtimg__canvas--fail">' +
          '<p class="qq-card-txtimg__text">' + esc(capFailed) + '</p>' +
          (preview ? '' : '<button type="button" class="qq-card-txtimg__retry" data-mq-img-gen-retry data-msg-id="' + esc(m.id) + '">重试</button>') +
        '</div>' +
      '</div>';
    }
    var cap = payload.caption || stripApiTimePrefix(m.content || '').replace(/^图片[-－—]\s*/, '') || '文字图片';
    return '<div class="qq-card qq-card-txtimg">' +
      '<div class="qq-card-txtimg__grain" aria-hidden="true"></div>' +
      '<span class="qq-card-txtimg__corner qq-card-txtimg__corner--tl" aria-hidden="true"></span>' +
      '<span class="qq-card-txtimg__corner qq-card-txtimg__corner--br" aria-hidden="true"></span>' +
      '<header class="qq-card-txtimg__head">' +
        '<span class="qq-card-txtimg__kicker">Text Image · 文字图片</span>' +
        '<span class="qq-card-txtimg__stamp">TXT</span>' +
      '</header>' +
      '<div class="qq-card-txtimg__canvas">' +
        '<p class="qq-card-txtimg__text">' + esc(cap) + '</p>' +
      '</div>' +
      '<footer class="qq-card-txtimg__foot">' +
        '<span class="qq-card-txtimg__tag">Rendered as image</span>' +
        '<span class="qq-card-txtimg__rule" aria-hidden="true"></span>' +
      '</footer>' +
    '</div>';
  }

  function renderStickerCard(m, payload) {
    var name = payload.stickerName || m.stickerName || '表情';
    var url = payload.stickerUrl || m.stickerUrl || '';
    var blobId = payload.stickerBlobId || m.stickerBlobId || '';
    if (!url && blobId && store && typeof store.getCachedBlobUrl === 'function') {
      url = store.getCachedBlobUrl(blobId) || '';
    }
    if (url) {
      return '<img class="qq-card-sticker" src="' + esc(url) + '" alt="' + esc(name) + '">';
    }
    if (blobId) {
      return '<img class="qq-card-sticker" data-msg-sticker="' + esc(blobId) + '" alt="' + esc(name) + '">';
    }
    return '<span class="qq-card-sticker-fallback">[' + esc(name) + ']</span>';
  }

  function renderDiaryPeekNotice(m) {
    var text = String(m.content || '偷看了你的日记！').trim();
    return '<div class="qq-room__sys qq-room__sys--diary-peek" data-msg-id="' + esc(m.id) + '">' +
      '<div class="qq-diary-peek-card">' +
        '<span class="qq-diary-peek-card__icon" aria-hidden="true">📔</span>' +
        '<div class="qq-diary-peek-card__body">' +
          '<span class="qq-diary-peek-card__kicker">Diary · 偷看留痕</span>' +
          '<p class="qq-diary-peek-card__text">' + esc(text) + '</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderRecallNotice(m, ctx) {
    var meta = m.recallMeta || {};
    var isUser = meta.by === 'user';
    var label = isUser
      ? '你撤回了一条消息'
      : esc(meta.byName || displayContactName(ctx && ctx.contact) || 'TA') + '撤回了一条消息';
    var sysTime = state.showTimestamps && m.createdAt
      ? '<time class="qq-room__msg-time qq-room__msg-time--sys">' + esc(formatMsgTime(m.createdAt)) + '</time>'
      : '';
    return '<div class="qq-room__sys qq-room__sys--recall" data-msg-id="' + esc(m.id) + '">' +
      '<button type="button" class="qq-recall-notice" data-recall-view="' + esc(m.id) + '">' +
        '<span class="qq-recall-notice__text">' + label + '</span>' +
        '<span class="qq-recall-notice__link">，点击查看</span>' +
      '</button>' +
      sysTime +
    '</div>';
  }

  function showRecalledMessage(m) {
    if (!m || !m.recalled || !m.recallMeta) return;
    var preview = String(m.recallMeta.preview || '').trim();
    if (!preview) {
      toast('没有可查看的内容');
      return;
    }
    dialog({
      mode: 'confirm',
      title: '撤回的消息',
      message: preview,
      confirmText: '关闭',
      cancelText: ''
    });
  }

  function renderCoupleSpaceInviteCard(m) {
    var inv = m.coupleSpaceInvite || {};
    var status = String(inv.status || 'pending').trim();
    var profileName = String(inv.profileName || '我').trim();
    var charName = String(inv.charName || 'TA').trim();
    var isPending = status === 'pending';
    var isAccepted = status === 'accepted';
    var isDeclined = status === 'declined';
    var isExpired = status === 'expired';
    var statusCls = isAccepted ? 'accepted' : isDeclined ? 'declined' : isExpired ? 'expired' : 'pending';
    var statusLabel = isAccepted ? 'SPACE OPEN' : isDeclined ? 'DECLINED' : isExpired ? 'EXPIRED' : 'AWAITING';
    var statusZh = isAccepted ? '已开启情侣空间' : isDeclined ? '已婉拒邀请' : isExpired ? '邀请已失效' : '等待 TA 回应';
    var note = String(inv.responseNote || '').trim();
    var sent = inv.sentAt ? new Date(inv.sentAt) : null;
    var dateStr = sent
      ? sent.getFullYear() + '.' + String(sent.getMonth() + 1).padStart(2, '0') + '.' + String(sent.getDate()).padStart(2, '0')
      : '';
    var sealText = isAccepted ? 'US' : isDeclined ? '—' : isExpired ? '×' : '♡';
    return (
      '<div class="qq-card qq-card-cpinv qq-card-cpinv--' + esc(statusCls) + '" data-msg-id="' + esc(m.id) + '">' +
        '<div class="qq-card-cpinv__grain" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__halo" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__thread qq-card-cpinv__thread--a" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__thread qq-card-cpinv__thread--b" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__spark qq-card-cpinv__spark--1" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__spark qq-card-cpinv__spark--2" aria-hidden="true"></div>' +
        '<div class="qq-card-cpinv__spark qq-card-cpinv__spark--3" aria-hidden="true"></div>' +
        '<header class="qq-card-cpinv__head">' +
          '<span class="qq-card-cpinv__vol">Vol. · Private Edition</span>' +
          '<span class="qq-card-cpinv__badge">Couple Space</span>' +
        '</header>' +
        '<div class="qq-card-cpinv__hero">' +
          '<div class="qq-card-cpinv__orb qq-card-cpinv__orb--a" aria-hidden="true"></div>' +
          '<div class="qq-card-cpinv__orb qq-card-cpinv__orb--b" aria-hidden="true"></div>' +
          '<svg class="qq-card-cpinv__heart" viewBox="0 0 48 42" fill="none" aria-hidden="true">' +
            '<path d="M24 38 C24 38 4 24 4 14 C4 8 8 4 14 4 C18 4 21 6 24 10 C27 6 30 4 34 4 C40 4 44 8 44 14 C44 24 24 38 24 38Z" stroke="currentColor" stroke-width="1.2" fill="url(#cpinv-hg)"/>' +
            '<defs><linearGradient id="cpinv-hg" x1="4" y1="4" x2="44" y2="38"><stop stop-color="#F4E4EA"/><stop offset="1" stop-color="#D4E4F0"/></linearGradient></defs>' +
          '</svg>' +
          '<div class="qq-card-cpinv__names">' +
            '<span class="qq-card-cpinv__n">' + esc(profileName) + '</span>' +
            '<span class="qq-card-cpinv__amp">&</span>' +
            '<span class="qq-card-cpinv__n">' + esc(charName) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="qq-card-cpinv__body">' +
          '<h3 class="qq-card-cpinv__title">' + (isAccepted ? 'Our Space is Open' : isDeclined ? 'Not This Time' : isExpired ? 'Invite Expired' : 'Invite to Our Space') + '</h3>' +
          '<p class="qq-card-cpinv__desc">' +
            (isAccepted
              ? '专属情侣领地已开启 · 纪念日、时光轴与私语，只属于你们两人'
              : isDeclined
                ? (note ? esc(note) : 'TA 暂时还没有准备好，但你们的故事仍在继续')
                : isExpired
                  ? '此邀请已被新邀请取代 · 以最新卡片为准'
                  : '邀请你共建私密双人空间 · 记录每一个值得珍藏的日常') +
          '</p>' +
          (isPending ? '<div class="qq-card-cpinv__pulse" aria-hidden="true"><span></span><span></span><span></span></div>' : '') +
        '</div>' +
        '<footer class="qq-card-cpinv__foot">' +
          '<div class="qq-card-cpinv__foot-l">' +
            '<span class="qq-card-cpinv__status">' + esc(statusZh) + '</span>' +
            (dateStr ? '<span class="qq-card-cpinv__date">' + esc(dateStr) + '</span>' : '') +
          '</div>' +
          '<div class="qq-card-cpinv__seal" aria-hidden="true"><span>' + sealText + '</span></div>' +
          '<span class="qq-card-cpinv__mark">' + esc(statusLabel) + '</span>' +
        '</footer>' +
      '</div>'
    );
  }

  function renderListenTogetherCapsule(m) {
    var cap = m.listenTogetherCapsule || {};
    var lt = global.MiyaMusicListenTogether;
    var dur = lt && typeof lt.formatDuration === 'function'
      ? lt.formatDuration(cap.durationSec)
      : '00:00';
    var text = dur;
    if (cap.trackTitle) text += ' · ' + cap.trackTitle;
    var sessionId = String(cap.sessionId || m.sessionId || '');
    return '<div class="mc-call-record-wrap qq-room__sys qq-room__sys--call" data-msg-id="' + esc(m.id) + '">' +
      '<button type="button" class="mc-call-record" data-qq-lt-capsule data-chat-id="' +
      esc(state.chatId || '') + '" data-session-id="' + esc(sessionId) + '">' +
      '<svg class="mc-call-record-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>' +
      '<span class="mc-call-record-text">' + esc(text) + '</span>' +
      '</button></div>';
  }

  function renderCallCapsule(m, msgIdx) {
    var cap = m.callCapsule || {};
    var calls = global.MiyaChatCalls;
    var dur = calls && typeof calls.formatCallDuration === 'function'
      ? calls.formatCallDuration(cap.durationSec)
      : '00:00';
    var callId = String(cap.callId || m.callId || '');
    var text = dur;
    return '<div class="mc-call-record-wrap qq-room__sys qq-room__sys--call" data-msg-id="' + esc(m.id) + '">' +
      '<button type="button" class="mc-call-record" data-qq-call-capsule data-chat-id="' +
      esc(state.chatId || '') + '" data-call-id="' + esc(callId) + '">' +
      '<svg class="mc-call-record-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path fill="currentColor" d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>' +
      '<span class="mc-call-record-text">' + esc(text) + '</span>' +
      '</button></div>';
  }

  function renderHtmlMessageBody(m, payload, edited) {
    var htmlApi = global.MiyaChatHtml;
    if (payload.useIframe && payload.iframeSrcdoc) {
      var b64 =
        htmlApi && typeof htmlApi.encodeSrcdocB64 === 'function'
          ? htmlApi.encodeSrcdocB64(payload.iframeSrcdoc)
          : '';
      return (
        '<div class="qq-room__html-panel is-interactive">' +
        '<div class="qq-room__html-toolbar">' +
        '<button type="button" class="qq-room__html-fs" data-miya-chat-html-fs="1">全屏查看</button>' +
        '</div>' +
        '<iframe class="qq-room__html-iframe" data-miya-chat-html-iframe="1" data-miya-chat-srcdoc-b64="' +
        esc(b64) +
        '" sandbox="allow-scripts allow-modals allow-same-origin" referrerpolicy="no-referrer" title="HTML 交互页"></iframe>' +
        edited +
        '</div>'
      );
    }
    var safe = String(payload.html || '').trim();
    if (!safe) safe = '<span>（空 HTML）</span>';
    return (
      '<div class="qq-room__html-panel">' +
      '<div class="qq-room__html-content">' +
      safe +
      '</div>' +
      edited +
      '</div>'
    );
  }

  function renderBubbleBody(m, opts) {
    opts = opts || {};
    var previewChatId = opts.chatId != null ? opts.chatId : state.chatId;
    var fmt = global.MiyaChatOnlineFormat;
    if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) return '';
    if (m.role === 'system') return esc(stripApiTimePrefix(m.content)).replace(/\n/g, '<br>');
    var payload = fmt && fmt.parseDisplayPayload
      ? fmt.parseDisplayPayload(m)
      : { kind: 'text', text: m.content, msg: m };
    var displayMsg = payload.msg || m;
    var edited = m.edited && m.role !== 'assistant' ? '<span class="qq-room__bubble-edited">已编辑</span>' : '';
    if (payload.kind === 'html') {
      return renderHtmlMessageBody(m, payload, edited);
    }
    var body = '';
    if (payload.kind === 'transfer' && displayMsg.redPacket) body = renderTransferCard(displayMsg, opts);
    else if (payload.kind === 'match_record' && displayMsg.matchRecord) body = renderMatchRecordCard(displayMsg);
    else if (payload.kind === 'sayguess_record' && displayMsg.sayguessRecord) body = renderSayGuessRecordCard(displayMsg);
    else if (payload.kind === 'location' && displayMsg.locationCard) body = renderLocationCard(displayMsg);
    else if (payload.kind === 'takeout') {
      var orderUi = global.MiyaChatOrderUi;
      body = orderUi && typeof orderUi.renderTakeoutCard === 'function'
        ? orderUi.renderTakeoutCard(displayMsg, esc, formatMoney)
        : '';
    }
    else if (payload.kind === 'gift') {
      var giftUi = global.MiyaChatOrderUi;
      body = giftUi && typeof giftUi.renderGiftCard === 'function'
        ? giftUi.renderGiftCard(displayMsg, esc, formatMoney)
        : '';
    }
    else if (payload.kind === 'love_poem') {
      var poemUi = global.MiyaChatLovePoem;
      body = poemUi && typeof poemUi.renderLovePoemCard === 'function'
        ? poemUi.renderLovePoemCard(displayMsg, esc)
        : '';
    }
    else if (payload.kind === 'group_red_packet' && displayMsg.groupRedPacket) {
      var grpRp = global.MiyaChatGroupRedPacket;
      var grpCtx = opts.ctx || getChatContext(previewChatId);
      body = grpRp && typeof grpRp.renderCard === 'function'
        ? grpRp.renderCard(displayMsg, esc, formatMoney, grpCtx)
        : '';
    }
    else if (payload.kind === 'couple_space_invite' && displayMsg.coupleSpaceInvite) {
      body = renderCoupleSpaceInviteCard(displayMsg);
    }
    else if (payload.kind === 'voice') body = renderVoiceCard(displayMsg, opts);
    else if (payload.kind === 'photo' || payload.kind === 'textImage') body = renderImageCard(displayMsg, payload, opts);
    else if (payload.kind === 'sticker') body = renderStickerCard(displayMsg, payload);
    else body = esc(stripApiTimePrefix(payload.text != null ? payload.text : m.content)).replace(/\n/g, '<br>');
    var trMod = global.MiyaChatTranslate;
    if (!opts.preview && trMod && typeof trMod.buildTranslateHtml === 'function' && previewChatId && m.role === 'assistant') {
      body += trMod.buildTranslateHtml(previewChatId, m, esc);
    }
    return body + edited;
  }

  function renderTranslateAttach(m) {
    var trMod = global.MiyaChatTranslate;
    if (!trMod || !state.chatId || m.role !== 'assistant') return '';
    if (typeof trMod.buildTranslateHtml !== 'function') return '';
    return trMod.buildTranslateHtml(state.chatId, m, esc);
  }

  function msgHasHeartVoice(chatId, msgId, hvIndex) {
    if (!store || !chatId || !msgId) return false;
    if (hvIndex && typeof hvIndex === 'object') return !!hvIndex[String(msgId)];
    var chat = store.findChat(chatId);
    if (!chat || !Array.isArray(chat.heartVoiceLog) || !chat.heartVoiceLog.length) return false;
    var hv = global.MiyaChatHeartVoice;
    if (hv && typeof hv.messageHasHeartVoiceEntry === 'function') {
      return hv.messageHasHeartVoiceEntry(chat, store, msgId);
    }
    return chat.heartVoiceLog.some(function (entry) {
      return String(entry && entry.msgId) === String(msgId);
    });
  }

  function resolveHeartVoiceHighlightIndex(chatId, ctx) {
    if (!ctx || ctx.isGroup || !store || !chatId) return null;
    var hv = global.MiyaChatHeartVoice;
    if (!hv || typeof hv.buildHeartVoiceHighlightIndex !== 'function') return null;
    var chat = store.findChat(chatId);
    if (!chat) return null;
    return hv.buildHeartVoiceHighlightIndex(chat, store);
  }

  function resolveBubbleAvatarUrl(m, ctx) {
    if (!m || m.role === 'system') return '';
    var isMe = m.role === 'user';
    if (isMe) {
      return state.avatars[profileAvatarKey(ctx.profile)] || avatarFallback((ctx.profile && ctx.profile.name) || '我');
    }
    if (ctx.isGroup) {
      var sc = resolveSenderContact(ctx, m);
      if (sc) {
        return state.avatars[sc.id] || resolveAvatarUrlSync(sc) || avatarFallback(senderNameForBubble(ctx, m, sc.name));
      }
    }
    var cid = (ctx.contact && ctx.contact.id) || '';
    return state.avatars[cid] || resolveAvatarUrlSync(ctx.contact) || avatarFallback(resolveDisplayName(ctx));
  }

  function bubbleHtml(m, ctx, round, msgIdx, hvIndex) {
    if (m.recalled && m.recallMeta) {
      return renderRecallNotice(m, ctx);
    }
    var isMe = m.role === 'user';
    var isSys = m.role === 'system';
    if (isSys && m.type === 'call_capsule') {
      return renderCallCapsule(m, msgIdx);
    }
    if (isSys && m.type === 'listen_together_capsule') {
      return renderListenTogetherCapsule(m);
    }
    if (isSys && m.type === 'diary_peek_notice') {
      return renderDiaryPeekNotice(m);
    }
    if (isSys && (m.type === 'group_title_change' || m.systemKind === 'group_title_change')) {
      var ggTc = global.MiyaChatGroup;
      var tcText = ggTc && typeof ggTc.formatTitleChangeForApi === 'function'
        ? ggTc.formatTitleChangeForApi(m)
        : String(m.content || '');
      var sysTimeTc = state.showTimestamps && m.createdAt
        ? '<time class="qq-room__msg-time qq-room__msg-time--sys">' + esc(formatMsgTime(m.createdAt)) + '</time>'
        : '';
      return '<div class="qq-room__sys qq-room__sys--title-change" data-msg-id="' + esc(m.id) + '">' +
        '<span class="qq-room__sys-title-icon" aria-hidden="true">冠</span>' +
        esc(tcText) +
        sysTimeTc +
      '</div>';
    }
    if (isSys && global.MiyaChatGroupRedPacket && typeof global.MiyaChatGroupRedPacket.isGroupRedPacketSystem === 'function' &&
        global.MiyaChatGroupRedPacket.isGroupRedPacketSystem(m)) {
      var grpRpMod = global.MiyaChatGroupRedPacket;
      var rpSysText =
        grpRpMod && typeof grpRpMod.formatSystemForDisplay === 'function'
          ? grpRpMod.formatSystemForDisplay(m)
          : String(m.content || '');
      var sysTimeRp = state.showTimestamps && m.createdAt
        ? '<time class="qq-room__msg-time qq-room__msg-time--sys">' + esc(formatMsgTime(m.createdAt)) + '</time>'
        : '';
      return '<div class="qq-room__sys qq-room__sys--grp-rp" data-msg-id="' + esc(m.id) + '">' +
        '<span class="qq-room__sys-rp-icon" aria-hidden="true">福</span>' +
        esc(rpSysText) +
        sysTimeRp +
      '</div>';
    }
    if (isSys) {
      var fmt = global.MiyaChatOnlineFormat;
      if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) return '';
      var isNarr =
        fmt && typeof fmt.isOnlineNarrationMessage === 'function' && fmt.isOnlineNarrationMessage(m);
      var sysCls = 'qq-room__sys' + (isNarr ? ' qq-room__sys--narration' : '');
      var sysTime = state.showTimestamps && m.createdAt
        ? '<time class="qq-room__msg-time qq-room__msg-time--sys">' + esc(formatMsgTime(m.createdAt)) + '</time>'
        : '';
      return '<div class="' + sysCls + '" data-msg-id="' + esc(m.id) + '">' + renderBubbleBody(m) + sysTime + '</div>';
    }
    var cls = 'qq-room__row' + (isMe ? ' qq-room__row--me' : ' qq-room__row--them');
    if (round) cls += ' qq-room__row--' + round;
    if (state.multiSelectMode && state.multiSelectIds && state.multiSelectIds[m.id]) {
      cls += ' is-picked';
    }
    var ava = resolveBubbleAvatarUrl(m, ctx);
    var body = renderBubbleBody(m, { ctx: ctx });
    if (!body) return '';
    var quoteHtml = renderMessageQuote(m);
    var isHtmlMsg = m.type === 'html' || m.renderAsHtml || body.indexOf('qq-room__html-panel') >= 0;
    var isTakeoutCard = body.indexOf('qq-card-to') >= 0;
    var isGrpRpCard = body.indexOf('grp-rp-card') >= 0;
    var isCard =
      !isGrpRpCard &&
      (isHtmlMsg ||
        body.indexOf('qq-card') >= 0 ||
        body.indexOf('qq-card-img') >= 0 ||
        body.indexOf('qq-card-sticker') >= 0);
    if (isCard) cls += ' qq-room__row--card';
    if (isGrpRpCard) cls += ' qq-room__row--grp-rp';
    if (isHtmlMsg) cls += ' qq-room__row--html';
    if (isTakeoutCard) cls += ' qq-room__row--takeout';
    var bubbleWrap;
    if (isGrpRpCard) {
      bubbleWrap = body;
    } else {
      var bubbleInner = isCard ? body : '<div class="qq-room__bubble">' + body + '</div>';
      var bubbleWrapCls = 'qq-room__bubble-wrap';
      if (isCard) {
        bubbleWrapCls += ' qq-room__bubble-wrap--card';
        if (isHtmlMsg) bubbleWrapCls += ' qq-room__bubble-wrap--html';
        if (isTakeoutCard) bubbleWrapCls += ' qq-room__bubble-wrap--takeout';
      }
      bubbleWrap = '<div class="' + bubbleWrapCls + '">' + bubbleInner + '</div>';
    }
    var transAttach = isCard && !isMe && !isHtmlMsg && !isGrpRpCard ? renderTranslateAttach(m) : '';
    var timeHtml = state.showTimestamps && m.createdAt
      ? '<time class="qq-room__msg-time">' + esc(formatMsgTime(m.createdAt)) + '</time>'
      : '';
    /* 群聊头衔仍在气泡上方原位；连续条隐藏以免重复 */
    var hideTitleMeta = ctx.isGroup && (round === 'mid' || round === 'last');
    var titleAboveBubble = ctx.isGroup && !hideTitleMeta ? renderGroupMemberTitleBadge(ctx, m) : '';
    var titleRow = titleAboveBubble
      ? '<div class="qq-room__bubble-title-row' + (isMe ? ' qq-room__bubble-title-row--me' : '') + '">' + titleAboveBubble + '</div>'
      : '';
    var stackInner = titleRow + quoteHtml + bubbleWrap + transAttach + timeHtml;
    var stack = '<div class="qq-room__bubble-stack">' + stackInner + '</div>';
    if (isMe) {
      return '<div class="' + cls + '" data-msg-id="' + esc(m.id) + '">' +
        stack +
        '<img class="qq-room__bubble-ava" src="' + esc(ava) + '" alt="">' +
      '</div>';
    }
    var hvCls = !isCard && !ctx.isGroup && msgHasHeartVoice(state.chatId, m.id, hvIndex) ? ' qq-room__bubble-ava--hv' : '';
    var themAva = '<img class="qq-room__bubble-ava' + hvCls + '"' +
      (ctx.isGroup ? '' : ' data-hv-ava="1"') +
      ' src="' + esc(ava) + '" alt=""' +
      (ctx.isGroup ? '' : ' title="查看心声"') + '>';
    if (ctx.isGroup) {
      var hideSenderMeta = round === 'mid' || round === 'last';
      var roleBadge = renderGroupRoleBadge(ctx, m);
      var senderCol =
        '<div class="qq-room__sender-col' + (hideSenderMeta ? ' qq-room__sender-col--ghost' : '') + '">' +
          themAva +
          '<span class="qq-room__sender-tag">' + esc(senderNameForBubble(ctx, m, '成员')) + '</span>' +
          (roleBadge ? '<span class="qq-room__sender-badges">' + roleBadge + '</span>' : '') +
        '</div>';
      return '<div class="' + cls + ' qq-room__row--group-member" data-msg-id="' + esc(m.id) + '">' +
        senderCol +
        stack +
      '</div>';
    }
    return '<div class="' + cls + '" data-msg-id="' + esc(m.id) + '">' +
      themAva +
      stack +
    '</div>';
  }

  function onBubbleMediaLoaded(sc, beforeSnap) {
    if (!sc) return;
    var before = beforeSnap || scrollMetrics(sc);
    if (!before) return;
    if (shouldQuietPinBottom()) {
      snapScrollToBottom(sc);
      return;
    }
    if (before.nearBottom) {
      scrollRoomToBottom(sc, true);
      return;
    }
    var afterMax = Math.max(0, sc.scrollHeight - sc.clientHeight);
    var delta = afterMax - before.max;
    if (delta > 0) sc.scrollTop = before.top + delta;
  }

  function hydrateBubbleMedia(root) {
    if (!root || !store) return;
    var sc = root.id === 'qq-room-scroll' ? root : $('qq-room-scroll');
    var stickerIds = [];
    root.querySelectorAll('[data-msg-sticker]').forEach(function (el) {
      var key = el.getAttribute('data-msg-sticker');
      if (!key || el.src) return;
      stickerIds.push(key);
    });
    var imgIds = [];
    root.querySelectorAll('[data-msg-img]').forEach(function (el) {
      var key = el.getAttribute('data-msg-img');
      if (!key || el.src) return;
      imgIds.push(key);
    });
    function bindMediaLoad(el) {
      var snap = scrollMetrics(sc);
      if (el.complete) onBubbleMediaLoaded(sc, snap);
      else el.addEventListener('load', function () { onBubbleMediaLoaded(sc, snap); }, { once: true });
    }
    function applyStickerUrls(map) {
      root.querySelectorAll('[data-msg-sticker]').forEach(function (el) {
        var key = el.getAttribute('data-msg-sticker');
        if (!key || el.src) return;
        var url = map[key];
        if (!url) return;
        el.src = url;
        bindMediaLoad(el);
      });
    }
    function applyImgUrls(map) {
      root.querySelectorAll('[data-msg-img]').forEach(function (el) {
        var key = el.getAttribute('data-msg-img');
        if (!key || el.src) return;
        var url = map[key];
        if (!url) return;
        el.src = url;
        bindMediaLoad(el);
      });
    }
    if (stickerIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(stickerIds).then(applyStickerUrls);
    } else if (stickerIds.length && store.getEmojiItemUrl) {
      stickerIds.forEach(function (key) {
        store.getEmojiItemUrl(key).then(function (url) {
          if (!url) return;
          var map = {};
          map[key] = url;
          applyStickerUrls(map);
        });
      });
    }
    if (imgIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(imgIds).then(applyImgUrls);
    } else if (imgIds.length && store.getAvatarUrl) {
      imgIds.forEach(function (key) {
        store.getAvatarUrl(key).then(function (url) {
          if (!url) return;
          var map = {};
          map[key] = url;
          applyImgUrls(map);
        });
      });
    }
    var htmlApi = global.MiyaChatHtml;
    if (htmlApi && typeof htmlApi.hydrateChatHtmlIframesInContainer === 'function') {
      htmlApi.hydrateChatHtmlIframesInContainer(root);
    }
  }

  function computeRoundPos(roles, index) {
    var role = roles[index];
    if (role === 'system') return 'solo';
    var prev = index > 0 ? roles[index - 1] : null;
    var next = index < roles.length - 1 ? roles[index + 1] : null;
    var samePrev = prev === role;
    var sameNext = next === role;
    if (!samePrev && !sameNext) return 'solo';
    if (!samePrev && sameNext) return 'first';
    if (samePrev && sameNext) return 'mid';
    return 'last';
  }

  function collectStickerBlobIdsFromMessages(msgs) {
    var seen = {};
    var ids = [];
    (msgs || []).forEach(function (m) {
      if (!m || m.deleted) return;
      var fmt = global.MiyaChatOnlineFormat;
      var payload = fmt && fmt.parseDisplayPayload ? fmt.parseDisplayPayload(m) : null;
      var blobId = (payload && payload.stickerBlobId) || m.stickerBlobId || '';
      blobId = String(blobId || '').trim();
      if (!blobId || seen[blobId]) return;
      seen[blobId] = true;
      ids.push(blobId);
    });
    return ids;
  }

  function patchBubbleAvatars(chatId) {
    var sc = $('qq-room-scroll');
    if (!sc || !store) return;
    var ctx = getChatContext(chatId);
    if (!ctx) return;
    var pack = getVisibleMessages(chatId);
    pack.visible.forEach(function (m) {
      if (!m || m.role === 'system') return;
      var escId = String(m.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var row = sc.querySelector('[data-msg-id="' + escId + '"]');
      if (!row) return;
      var url = resolveBubbleAvatarUrl(m, ctx);
      if (!url) return;
      row.querySelectorAll('.qq-room__bubble-ava').forEach(function (img) {
        if (img.src !== url) img.src = url;
      });
    });
  }

  function buildMessagesHtml(msgs, ctx, roles, startIdx, endIdx, hvIndex) {
    var html = '';
    var i;
    for (i = startIdx; i < endIdx; i++) {
      html += bubbleHtml(msgs[i], ctx, computeRoundPos(roles, i), i, hvIndex);
    }
    return html;
  }

  function mountHintHtml(pack) {
    if (!pack || pack.hidden <= 0) return '';
    return '<div class="qq-room__mount-hint">仅显示最近 ' + pack.limit + ' 条（共 ' + packTotalCount(pack) + ' 条）</div>';
  }

  function paintMessagesShell(sc, html, chatId, opts, anchor) {
    sc.innerHTML = html || '<div class="qq-room__empty">还没有消息，发一条试试吧</div>';
    if (opts.deferMedia) {
      requestAnimationFrame(function () {
        if (state.chatId !== chatId) return;
        hydrateBubbleMedia(sc);
      });
    } else {
      hydrateBubbleMedia(sc);
    }
    syncMultiSelectDom();
    if (state.showTypingIndicator) appendTyping({ noScroll: true });
    applyScrollAfterLayout(sc, anchor, {
      toBottom: !!opts.toBottom,
      stickBottom: !!opts.stickBottom,
      isFirstOpen: !!opts.isFirstOpen
    });
    if (state.chatId === chatId) rememberChatScroll(chatId);
  }

  function renderMessagesProgressive(sc, chatId, opts, ctx, pack, msgs, roles) {
    var gen = ++groupRenderGen;
    clearGroupPendingPrepend(chatId);
    var anchor = null;
    if (opts.restore) {
      anchor = opts.restore;
    } else if (!opts.toBottom && !opts.stickBottom && opts.preserveScroll !== false && sc.querySelector('[data-msg-id]')) {
      anchor = captureScrollAnchor(sc);
    }
    var initialCount = resolveInitialRenderCount(chatId, opts);
    var startIdx = Math.max(0, msgs.length - initialCount);
    var paintOpts = Object.assign({ stickBottom: true, toBottom: true, deferMedia: !!opts.isFirstOpen }, opts);
    var hvIndex = resolveHeartVoiceHighlightIndex(chatId, ctx);
    var html = mountHintHtml(pack) + buildMessagesHtml(msgs, ctx, roles, startIdx, msgs.length, hvIndex);
    var stickerIds = collectStickerBlobIdsFromMessages(msgs.slice(startIdx));
    paintMessagesShell(sc, html, chatId, paintOpts, anchor);
    snapScrollToBottom(sc);

    if (startIdx > 0) {
      groupPendingPrepend[String(chatId)] = {
        chatId: String(chatId),
        gen: gen,
        chunkEnd: startIdx,
        msgs: msgs,
        roles: roles,
        ctx: ctx,
        pack: pack,
        sc: sc
      };
    }

    if (stickerIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(stickerIds).then(function () {
        if (state.chatId === chatId && shouldQuietPinBottom()) snapScrollToBottom(sc);
        else if (state.chatId === chatId) hydrateBubbleMedia(sc);
      }).catch(function () {});
    }
  }

  function renderMessages(chatId, opts) {
    opts = opts || {};
    var sc = resolveChatScrollEl(chatId);
    if (!sc || !store) return;
    var anchor = null;
    if (opts.restore) {
      anchor = opts.restore;
    } else if (!opts.toBottom && opts.preserveScroll !== false && sc.querySelector('[data-msg-id]')) {
      anchor = captureScrollAnchor(sc);
    }
    var ctx = getChatContext(chatId);
    if (ctx) ctx._senderCache = {};
    var pack = getVisibleMessages(chatId);
    var msgs = pack.visible;
    var roles = msgs.map(function (m) {
      return messageRoleKey(m, ctx);
    });
    /* 增量追加优先于整表/渐进重绘，长会话发消息时避免整页重建 */
    if (canIncrementalAppend(sc, msgs, opts) && appendTrailingMessages(sc, msgs, opts)) {
      return;
    }
    var initialThreshold = resolveInitialRenderCount(chatId, opts);
    if (msgs.length > initialThreshold && !opts.restore) {
      renderMessagesProgressive(sc, chatId, opts, ctx, pack, msgs, roles);
      return;
    }
    var hvIndex = resolveHeartVoiceHighlightIndex(chatId, ctx);
    var html = mountHintHtml(pack);
    html += msgs.map(function (m, i) {
      return bubbleHtml(m, ctx, computeRoundPos(roles, i), i, hvIndex);
    }).join('');
    var stickerIds = collectStickerBlobIdsFromMessages(msgs);
    paintMessagesShell(sc, html, chatId, Object.assign({ deferMedia: !!opts.isFirstOpen }, opts), anchor);
    if (stickerIds.length && store.prefetchBlobUrls) {
      store.prefetchBlobUrls(stickerIds).then(function () {
        if (state.chatId === chatId) hydrateBubbleMedia(sc);
      }).catch(function () {});
    }
  }

  function patchRowRoundClass(row, round) {
    if (!row || !round) return;
    row.classList.remove('qq-room__row--solo', 'qq-room__row--first', 'qq-room__row--mid', 'qq-room__row--last');
    row.classList.add('qq-room__row--' + round);
  }

  function syncBubbleRoundPositions(chatId) {
    var sc = $('qq-room-scroll');
    if (!sc || !chatId || !store) return;
    var pack = getVisibleMessages(chatId);
    var msgs = pack.visible;
    var ctxRound = getChatContext(chatId);
    var roles = msgs.map(function (m) {
      return messageRoleKey(m, ctxRound);
    });
    msgs.forEach(function (m, i) {
      if (m.role === 'system') return;
      var row = sc.querySelector('[data-msg-id="' + String(m.id).replace(/"/g, '\\"') + '"]');
      if (!row) return;
      patchRowRoundClass(row, computeRoundPos(roles, i));
    });
  }

  function appendBubbleEl(m, opts) {
    opts = opts || {};
    var sc = resolveChatScrollEl(state.chatId);
    if (!sc || !m) return;
    var stickBottom = opts.stickBottom != null
      ? !!opts.stickBottom
      : !!(scrollMetrics(sc) || {}).nearBottom;
    var empty = sc.querySelector('.qq-room__empty');
    if (empty) empty.remove();
    var ctx = getChatContext(state.chatId);
    var pack = getVisibleMessages(state.chatId);
    var msgs = pack.visible;
    var idx = -1;
    var mi;
    for (mi = 0; mi < msgs.length; mi++) {
      if (String(msgs[mi].id) === String(m.id)) {
        idx = mi;
        break;
      }
    }
    if (idx < 0) idx = Math.max(0, msgs.length - 1);
    var roles = msgs.map(function (x) {
      return messageRoleKey(x, ctx);
    });
    var hvIndex = resolveHeartVoiceHighlightIndex(state.chatId, ctx);
    var tmp = document.createElement('div');
    tmp.innerHTML = bubbleHtml(m, ctx, computeRoundPos(roles, idx), idx, hvIndex);
    var el = tmp.firstElementChild;
    if (el) {
      var existing = sc.querySelector('[data-msg-id="' + String(m.id).replace(/"/g, '\\"') + '"]');
      if (existing) {
        existing.replaceWith(el);
        hydrateBubbleMedia(el);
        if (stickBottom) scrollRoomToBottom(sc, true);
        if (state.chatId) rememberChatScroll(state.chatId);
        return;
      }
      if (!opts.instant) el.classList.add('qq-room__row--enter');
      var typingRow = sc.querySelector('.qq-room__typing-row');
      if (typingRow) sc.insertBefore(el, typingRow);
      else sc.appendChild(el);
      if (idx > 0 && m.role !== 'system') {
        var prevMsg = msgs[idx - 1];
        if (prevMsg && prevMsg.role === m.role) {
          var prevRow = sc.querySelector('[data-msg-id="' + String(prevMsg.id).replace(/"/g, '\\"') + '"]');
          if (prevRow) patchRowRoundClass(prevRow, computeRoundPos(roles, idx - 1));
        }
      }
      hydrateBubbleMedia(el);
      if (opts.instant) {
        if (stickBottom) scrollRoomToBottom(sc, true);
        requestAnimationFrame(function () {
          trimDisplayedRows(sc, state.chatId);
        });
      } else {
        trimDisplayedRows(sc, state.chatId);
        if (stickBottom) scrollRoomToBottom(sc, true);
      }
      if (state.chatId) rememberChatScroll(state.chatId);
    }
  }

  function resolveTypingLabel(ctx) {
    if (!ctx) return { name: '对方', suffix: '正在输入…' };
    if (ctx.isGroup) {
      return {
        name: String((ctx.chat && ctx.chat.title) || '群聊').trim() || '群聊',
        suffix: '正在输入…'
      };
    }
    return { name: resolveDisplayName(ctx), suffix: '正在输入…' };
  }

  function appendTyping(opts) {
    opts = opts || {};
    var sc = $('qq-room-scroll');
    if (!sc || sc.querySelector('.qq-room__typing-row, .qq-room__typing-indicator')) return;
    var stickBottom = !opts.noScroll && (scrollMetrics(sc) || {}).nearBottom;
    var ctx = getChatContext(state.chatId);
    var label = resolveTypingLabel(ctx);
    var el = document.createElement('div');
    el.className = 'qq-room__typing-row';
    el.innerHTML =
      '<div class="qq-room__typing-indicator" aria-label="' + esc(label.name + label.suffix) + '">' +
        '<span class="qq-room__typing-deco" aria-hidden="true">"</span>' +
        '<span class="qq-room__typing-name">' + esc(label.name) + '</span>' +
        '<span class="qq-room__typing-dot"></span>' +
        '<span class="qq-room__typing-dot"></span>' +
        '<span class="qq-room__typing-dot"></span>' +
        '<span class="qq-room__typing-text">' + esc(label.suffix) + '</span>' +
      '</div>';
    sc.appendChild(el);
    if (stickBottom) snapScrollToBottom(sc);
  }

  function removeTyping() {
    var sc = $('qq-room-scroll');
    if (!sc) return;
    sc.querySelectorAll('.qq-room__typing-row, .qq-room__typing-indicator').forEach(function (node) {
      node.remove();
    });
  }

  function startTypingWait() {
    state.showTypingIndicator = true;
    state.awaitingAssistantReply = true;
    appendTyping();
  }

  function stopTypingWait() {
    state.showTypingIndicator = false;
    state.awaitingAssistantReply = false;
    removeTyping();
  }

  function setComposeDisabled(disabled) {
    var input = $('qq-room-input');
    var ai = $('qq-room-ai');
    var toolsToggle = $('qq-room-tools-toggle');
    var send = $('qq-room-send');
    if (input) input.disabled = !!disabled;
    if (ai) ai.disabled = !!disabled;
    if (toolsToggle) toolsToggle.disabled = !!disabled;
    if (send) send.disabled = !!disabled;
  }

  function focusComposeInput(preventScroll) {
    var input = $('qq-room-input');
    if (input && !input.disabled) {
      var noScroll = preventScroll !== false;
      try {
        if (noScroll) input.focus({ preventScroll: true });
        else input.focus();
      } catch (e) {
        input.focus();
      }
      if (!noScroll) syncKeyboardInset();
    }
  }

  function blurComposeInput() {
    var input = $('qq-room-input');
    if (input && document.activeElement === input) input.blur();
  }

  function restoreComposeAfterOverlay(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!state.chatId || state.multiSelectMode) return;
    var ov = $('qq-room-overlay');
    if (ov && !ov.hidden && !ov.innerHTML.trim()) {
      ov.hidden = true;
    }
    if (!state.sending) setComposeDisabled(false);
    var input = $('qq-room-input');
    if (input) {
      input.readOnly = false;
      if (!state.sending) input.disabled = false;
    }
    var foot = roomEl && roomEl.querySelector('.qq-room__foot');
    if (foot) foot.style.pointerEvents = '';
    if (isIOSChat() && !isComposeInputFocused()) scheduleRoomViewportReset('overlay');
    if (opts.focusInput) {
      requestAnimationFrame(function () {
        if (!state.sending) focusComposeInput(true);
      });
    }
  }

  function cancelStaggerReveal() {
    state.revealTimers.forEach(clearTimeout);
    state.revealTimers = [];
  }

  function revealAssistantMessages(msgs) {
    cancelStaggerReveal();
    if (!msgs || !msgs.length) {
      stopTypingWait();
      return Promise.resolve();
    }
    var cid = state.chatId;
    if (!cid) {
      stopTypingWait();
      return Promise.resolve();
    }
    var sc = resolveChatScrollEl(cid);
    var stickBottom = sc ? !!(scrollMetrics(sc) || {}).nearBottom : true;
    var pending = msgs.filter(function (m) {
      if (!m || !m.id) return false;
      if (m.deleted) return false;
      var fmt = global.MiyaChatOnlineFormat;
      if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) return false;
      if (!sc) return true;
      return !sc.querySelector('[data-msg-id="' + String(m.id).replace(/"/g, '\\"') + '"]');
    });
    if (!pending.length) {
      stopTypingWait();
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var idx = 0;
      function step() {
        if (state.chatId !== cid) {
          stopTypingWait();
          resolve();
          return;
        }
        if (idx >= pending.length) {
          stopTypingWait();
          syncBubbleRoundPositions(cid);
          resolve();
          return;
        }
        var msg = pending[idx];
        idx += 1;
        stopTypingWait();
        appendBubbleEl(msg, { stickBottom: stickBottom });
        if (idx < pending.length) {
          startTypingWait();
          var t = setTimeout(step, resolveBubbleStaggerMs());
          state.revealTimers.push(t);
        } else {
          var tDone = setTimeout(function () {
            stopTypingWait();
            syncBubbleRoundPositions(cid);
            resolve();
          }, 80);
          state.revealTimers.push(tDone);
        }
      }
      stopTypingWait();
      var t0 = setTimeout(step, 160);
      state.revealTimers.push(t0);
    });
  }

  function requestAiReply(isRetry, emptyReplyAttempt, sendOpts) {
    var cid = state.chatId;
    if (!cid) return;
    var emptyTry = Math.max(0, Number(emptyReplyAttempt) || 0);
    var extraSendOpts = sendOpts && typeof sendOpts === 'object' ? sendOpts : {};
    if (state.sending && !isRetry) {
      toast('正在等待回复…');
      return;
    }
    if (engine && typeof engine.isChatApiBusy === 'function' && engine.isChatApiBusy(cid)) {
      if (!isRetry) {
        setTimeout(function () { requestAiReply(true); }, 2000);
        return;
      }
      toast('该会话正在请求 API');
      return;
    }

    var cfg = engine.getApiConfig();
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      toast('请先在设置中配置对话 API');
      return;
    }

    cancelStaggerReveal();
    state.sending = true;
    setComposeDisabled(true);
    startTypingWait();

    function scheduleEmptyReplyRetry() {
      if (emptyTry >= 2 || state.chatId !== cid) return false;
      state.sending = false;
      setTimeout(function () {
        if (state.chatId === cid) requestAiReply(true, emptyTry + 1);
      }, 800);
      return true;
    }

    return engine.sendChat(cid, '', Object.assign({ skipUserMessage: true }, extraSendOpts))
      .then(function (result) {
        var msgs = result && result.messages ? result.messages : [];
        var roomStillHere = state.chatId === cid;
        if (msgs.length && roomStillHere) {
          return revealAssistantMessages(msgs);
        }
        if (roomStillHere) {
          stopTypingWait();
          if (!msgs.length && scheduleEmptyReplyRetry()) return;
          if (!msgs.length) toast('角色未返回正文，请重试');
          renderMessages(cid);
        }
      })
      .catch(function (err) {
        if (state.chatId === cid) {
          stopTypingWait();
          var code = err && err.message ? err.message : String(err);
          if (code === 'api_not_configured') toast('请先在设置中配置对话 API');
          else if (code === 'chat_api_busy') toast('该会话正在请求 API');
          else if (code === 'empty_reply' || code === 'empty') {
            if (scheduleEmptyReplyRetry()) return;
            toast('角色未返回正文，请重试');
          } else if (code.indexOf('HTTP') === 0) toast('请求失败 · ' + code.slice(0, 60));
          else toast('回复失败，请检查网络与 API');
          renderMessages(cid);
        }
      })
      .finally(function () {
        state.sending = false;
        if (state.chatId === cid) {
          setComposeDisabled(false);
          restoreComposeAfterOverlay();
          blurComposeInput();
          scheduleRefreshLists();
        }
      });
  }

  function sendMessage(payload) {
    if (!state.chatId || !store) return Promise.reject();
    var savedQuote = state.quoteRef;
    if (savedQuote) payload.quoteRef = savedQuote;
    state.quoteRef = null;
    renderQuoteBar();
    var entry = typeof store.addMessageImmediate === 'function'
      ? store.addMessageImmediate(state.chatId, payload)
      : null;
    if (!entry) return Promise.reject(new Error('empty'));
    appendBubbleEl(entry, { stickBottom: true, instant: true });
    scrollRoomToBottom($('qq-room-scroll'), true);
    scheduleRefreshLists();
    return Promise.resolve(entry);
  }

  function handleSend() {
    if (!state.chatId) return;
    var input = $('qq-room-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    hideStickerSuggest();
    if (state.narrationMode) {
      sendMessage({
        role: 'system',
        type: 'text',
        content: text,
        systemKind: 'online-narration',
        narrationFrom: 'user',
        excludedFromContext: false
      }).catch(function () {
        toast('发送失败');
        restoreComposeAfterOverlay();
      });
      return;
    }
    sendMessage({ role: 'user', content: text, type: 'text' }).catch(function () {
      toast('发送失败');
      restoreComposeAfterOverlay();
    });
  }

  function closeOverlay() {
    if (global.MiyaChatVoiceRecord && typeof global.MiyaChatVoiceRecord.destroyActive === 'function') {
      global.MiyaChatVoiceRecord.destroyActive();
    }
    var ov = $('qq-room-overlay');
    if (ov) { ov.hidden = true; ov.innerHTML = ''; }
    restoreComposeAfterOverlay();
  }

  function openOverlay(html) {
    closeEmojiPanel();
    var ov = $('qq-room-overlay');
    if (!ov) return;
    ov.innerHTML = html;
    ov.hidden = false;
  }

  function getActiveThinkingText() {
    if (!state.chatId || !store) return '';
    var chat = store.findChat(state.chatId);
    return chat && chat.activeThinking ? String(chat.activeThinking).trim() : '';
  }

  function syncThinkingBtn() {
    var btn = roomEl && roomEl.querySelector('[data-plus="thinking"]');
    if (!btn) return;
    var has = !!getActiveThinkingText();
    btn.classList.toggle('is-dim', !has);
    btn.setAttribute('aria-disabled', has ? 'false' : 'true');
  }

  function closeThinkingPop() {
    var pop = $('qq-room-think-pop');
    if (!pop) return;
    pop.hidden = true;
    pop.setAttribute('aria-hidden', 'true');
    pop.classList.remove('is-open');
  }

  function openThinkingPop() {
    closeEmojiPanel();
    var pop = $('qq-room-think-pop');
    var body = $('qq-think-pop-body');
    if (!pop || !body) return;
    var text = getActiveThinkingText();
    if (text) {
      body.innerHTML = '<pre class="qq-think-pop__text">' + esc(text) + '</pre>';
    } else {
      body.innerHTML = '<p class="qq-think-pop__empty">暂无</p>';
    }
    pop.hidden = false;
    pop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      pop.classList.add('is-open');
    });
  }

  function openLovePoemPicker() {
    if (isGroupRoom()) {
      toast('情诗仅支持单聊');
      return;
    }
    var poemUi = global.MiyaChatLovePoem;
    if (!poemUi || typeof poemUi.buildStylePickerHtml !== 'function') {
      toast('情诗模块未加载');
      return;
    }
    closeToolbarPanel();
    openOverlay(poemUi.buildStylePickerHtml());
    if (typeof poemUi.bindStylePicker === 'function') {
      poemUi.bindStylePicker(function (style) {
        closeOverlay();
        if (!style || !state.chatId) return;
        if (state.sending) {
          toast('正在等待回复…');
          return;
        }
        requestAiReply(false, 0, { lovePoemMode: true, lovePoemStyle: style });
      });
    }
  }

  function toolVoiceManual() {
    dialog({ mode: 'prompt', title: '语音', message: '输入语音转写内容', placeholder: '想说的话…' }).then(function (txt) {
      if (!txt) return;
      sendMessage({ role: 'user', type: 'voice', content: '语音-' + txt, voiceText: txt }).catch(function () { toast('发送失败'); });
    });
  }

  function toolVoiceRecord() {
    var rec = global.MiyaChatVoiceRecord;
    if (!rec || typeof rec.openPanel !== 'function' || !rec.supportsRecording()) {
      toolVoiceManual();
      return;
    }
    rec.openPanel({
      openOverlay: openOverlay,
      closeOverlay: closeOverlay,
      onSend: function (payload) {
        return sendMessage({
          role: 'user',
          type: 'voice',
          content: '语音-' + payload.voiceText,
          voiceText: payload.voiceText,
          voiceAudioIdbKey: payload.voiceAudioIdbKey,
          voiceDurationSec: payload.voiceDurationSec
        });
      }
    });
  }

  function toolVoice() {
    var recOk = global.MiyaChatVoiceRecord && global.MiyaChatVoiceRecord.supportsRecording();
    openOverlay(
      '<div class="qq-sheet qq-sheet--voice">' +
      '<div class="qq-sheet__panel">' +
      sheetGrabHead('Voice · 语音', '发送语音', '录音识别或手动输入文字') +
      '<div class="qq-sheet__options">' +
      (recOk
        ? sheetOpt('◉', '录音发送', '边说边识别，随时可编辑', 'data-voice-pick="record"', true)
        : '') +
      sheetOpt('✎', '手动输入', '直接键入语音转写内容', 'data-voice-pick="text"', false) +
      '</div>' +
      '<button type="button" class="qq-sheet__cancel" data-sheet-close>取消</button>' +
      '</div></div>'
    );
  }

  function toolImage() {
    openOverlay(
      '<div class="qq-sheet qq-sheet--image">' +
      '<div class="qq-sheet__panel">' +
      sheetGrabHead('Photo · 图片', '发送图片', '从相册选择或文字描述画面') +
      '<div class="qq-sheet__options">' +
      sheetOpt('◫', '相册选图', '上传本地照片', 'data-pick="photo"', true) +
      sheetOpt('✎', '文字描述', '用文字描绘画面内容', 'data-pick="text"', false) +
      '</div>' +
      '<button type="button" class="qq-sheet__cancel" data-sheet-close>取消</button>' +
      '</div></div>'
    );
  }

  function toolRegenerate() {
    if (!state.chatId || !engine || !store) return;
    if (state.sending) {
      toast('正在等待回复…');
      return;
    }
    if (engine.isChatApiBusy && engine.isChatApiBusy(state.chatId)) {
      toast('该会话正在请求 API');
      return;
    }
    if (!engine.withdrawLastAssistantRound) {
      toast('重回功能未加载');
      return;
    }
    var cid = state.chatId;
    var historyForRedo =
      store.getMergedMessagesForApi && typeof store.getMergedMessagesForApi === 'function'
        ? store.getMergedMessagesForApi(cid)
        : engine.resolveApiChatId && typeof engine.resolveApiChatId === 'function'
          ? store.getMessages(engine.resolveApiChatId(cid))
          : store.getMessages(cid);
    var assistantRound = engine.getTrailingAssistantRound
      ? engine.getTrailingAssistantRound(historyForRedo)
      : [];
    var hasAssistantBubble = assistantRound.some(function (m) {
      return m && m.role === 'assistant';
    });
    if (!hasAssistantBubble) {
      toast('没有可撤回的角色回复');
      return;
    }

    cancelStaggerReveal();
    state.sending = true;
    setComposeDisabled(true);
    startTypingWait();
    engine
      .withdrawLastAssistantRound(cid)
      .then(function () {
        renderMessages(cid);
        if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        requestAiReply(true, 0, { isRegenerate: true });
      })
      .catch(function (err) {
        stopTypingWait();
        state.sending = false;
        setComposeDisabled(false);
        var code = err && err.message ? err.message : '';
        if (code === 'no_assistant_round') toast('没有可撤回的角色回复');
        else toast('撤回失败');
        renderMessages(cid);
      });
  }

  function isLikelyImageFile(file) {
    var imgApi = global.MiyaChatImage;
    if (imgApi && typeof imgApi.isLikelyImageFile === 'function') {
      return imgApi.isLikelyImageFile(file);
    }
    if (!file) return false;
    var t = String(file.type || '').toLowerCase();
    if (t.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(String(file.name || ''));
  }

  function compressChatImageFile(file) {
    var imgApi = global.MiyaChatImage;
    if (!imgApi) return Promise.reject(new Error('no_image_api'));
    if (typeof imgApi.compressImageFileToBlob === 'function') {
      return imgApi.compressImageFileToBlob(file, { maxEdge: 960, quality: 0.78 }).catch(function () {
        if (typeof imgApi.compressImageFile === 'function') return imgApi.compressImageFile(file);
        return file;
      });
    }
    if (typeof imgApi.compressImageFile === 'function') {
      return imgApi.compressImageFile(file).catch(function () { return file; });
    }
    return Promise.resolve(file);
  }

  function storeChatImageBlob(blobOrFile) {
    if (!store) return Promise.reject(new Error('no_store'));
    if (blobOrFile instanceof File) return store.storeChatMedia(blobOrFile, 'chat-img');
    if (typeof store.storeMediaBlob === 'function') return store.storeMediaBlob(blobOrFile, 'chat-img');
    return store.storeChatMedia(blobOrFile, 'chat-img');
  }

  function pickPhotoFile() {
    closeOverlay();
    var inp = $('qq-room-img-file');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*,.heic,.heif';
      inp.id = 'qq-room-img-file';
      inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.value = '';
        if (!f || !isLikelyImageFile(f)) {
          if (f) toast('请选择图片文件');
          return;
        }
        if (!store) {
          toast('发送失败');
          return;
        }
        compressChatImageFile(f).then(function (blobOrFile) {
          return storeChatImageBlob(blobOrFile);
        }).then(function (blobId) {
          if (!blobId) throw new Error('store_failed');
          return sendMessage({
            role: 'user',
            type: 'image',
            imageKind: 'photo',
            content: '[图片]',
            imageDataKey: blobId
          });
        }).catch(function () { toast('发送失败'); });
      });
    }
    inp.click();
  }

  function pickTextImage() {
    closeOverlay();
    dialog({ mode: 'prompt', title: '文字图片', message: '用文字描述画面', placeholder: '例如：窗边的白玫瑰…' }).then(function (txt) {
      if (!txt) return;
      sendMessage({ role: 'user', type: 'image', imageKind: 'text', content: '图片-' + txt }).catch(function () { toast('发送失败'); });
    });
  }

  function isEmojiPanelVisible() {
    var panel = $('qq-emo-panel');
    return !!(panel && !panel.hidden);
  }

  function hideStickerSuggest() {
    var panel = $('qq-room-sticker-suggest');
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '';
  }

  function collectStickerSuggestions(keyword) {
    if (!store || typeof store.getAllEmojiItemsFlat !== 'function') return [];
    var kw = String(keyword || '').trim();
    if (!kw) return [];
    var q = kw.toLowerCase();
    var hits = [];
    store.getAllEmojiItemsFlat().forEach(function (row) {
      var it = row && row.item;
      if (!it) return;
      var name = String(it.name || '').trim();
      if (!name) return;
      if (name.indexOf(kw) >= 0 || name.toLowerCase().indexOf(q) >= 0) hits.push(it);
    });
    return hits.slice(0, 8);
  }

  function stickerSuggestKeyword(text) {
    var raw = String(text || '');
    var m = raw.match(/表情包[-－—]?\s*(.*)$/);
    if (m) return String(m[1] || '').trim();
    if (raw.trim().length >= 2) return raw.trim();
    return '';
  }

  function updateStickerSuggestFromInput() {
    var input = $('qq-room-input');
    var panel = $('qq-room-sticker-suggest');
    if (!input || !panel) return;
    var text = input.value || '';
    var hasStickerPrefix = /表情包/.test(text);
    var kw = stickerSuggestKeyword(text);
    if (!kw) {
      hideStickerSuggest();
      return;
    }
    if (hasStickerPrefix && !text.match(/表情包[-－—]?\s*.+/)) {
      hideStickerSuggest();
      return;
    }
    var hits = collectStickerSuggestions(kw);
    if (!hits.length) {
      hideStickerSuggest();
      return;
    }
    renderStickerSuggest(hits);
  }

  function scheduleStickerSuggestUpdate() {
    clearTimeout(stickerSuggestTimer);
    stickerSuggestTimer = setTimeout(updateStickerSuggestFromInput, 80);
  }

  function renderStickerSuggest(items) {
    var panel = $('qq-room-sticker-suggest');
    if (!panel || !items || !items.length) {
      hideStickerSuggest();
      return;
    }
    panel.innerHTML = items.map(function (it) {
      var name = esc(String(it.name || '表情').trim());
      var bg = it.url
        ? ' data-qq-sticker-suggest-url="' + esc(it.url) + '"'
        : ' data-qq-sticker-suggest-blob="' + esc(it.blobId || '') + '"';
      return '<button type="button" class="qq-room__sticker-suggest__item" data-qq-sticker-suggest' +
        ' data-qq-sticker-name="' + name + '"' + bg +
        ' aria-label="' + name + '" title="' + name + '"></button>';
    }).join('');
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    hydrateStickerSuggestThumbs(panel);
    panel.querySelectorAll('[data-qq-sticker-suggest]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-qq-sticker-name') || '';
        var payload = { role: 'user', type: 'sticker', content: '表情包-' + name, stickerName: name };
        var url = btn.getAttribute('data-qq-sticker-suggest-url');
        var blob = btn.getAttribute('data-qq-sticker-suggest-blob');
        if (url) payload.stickerUrl = url;
        if (blob) payload.stickerBlobId = blob;
        var input = $('qq-room-input');
        if (input) {
          input.value = '';
          input.style.height = 'auto';
        }
        hideStickerSuggest();
        sendMessage(payload).catch(function () { toast('发送失败'); });
      });
    });
  }

  function hydrateStickerSuggestThumbs(root) {
    if (!root || !store) return;
    root.querySelectorAll('[data-qq-sticker-suggest-url]').forEach(function (el) {
      var u = el.getAttribute('data-qq-sticker-suggest-url');
      if (u) el.style.backgroundImage = 'url("' + u.replace(/"/g, '') + '")';
    });
    var pending = [];
    root.querySelectorAll('[data-qq-sticker-suggest-blob]').forEach(function (el) {
      if (el.getAttribute('data-qq-sticker-suggest-url')) return;
      var bid = el.getAttribute('data-qq-sticker-suggest-blob');
      if (!bid) return;
      pending.push({ el: el, bid: bid });
    });
    if (!pending.length) return;
    function paint(map) {
      pending.forEach(function (p) {
        var url = map[p.bid];
        if (url) p.el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    }
    if (store.prefetchBlobUrls) {
      store.prefetchBlobUrls(pending.map(function (p) { return p.bid; })).then(paint);
      return;
    }
    pending.forEach(function (p) {
      if (!store.getEmojiItemUrl) return;
      store.getEmojiItemUrl(p.bid).then(function (url) {
        if (url) p.el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function closeEmojiPanel() {
    hideStickerSuggest();
    var sc = $('qq-room-scroll');
    var anchor = sc ? captureScrollAnchor(sc) : null;
    emojiPanelOpen = false;
    var panel = $('qq-emo-panel');
    if (panel) {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    }
    if (roomEl) roomEl.classList.remove('qq-room--emo-open');
    if (sc) applyScrollAfterLayout(sc, anchor, {});
    restoreComposeAfterOverlay();
  }

  function hydrateEmojiPanelThumbs(root) {
    if (!root || !store) return;
    root.querySelectorAll('[data-qq-emo-thumb-url]').forEach(function (el) {
      var u = el.getAttribute('data-qq-emo-thumb-url');
      if (u) el.style.backgroundImage = 'url("' + u.replace(/"/g, '') + '")';
    });
    var pending = [];
    root.querySelectorAll('[data-qq-emo-thumb]').forEach(function (el) {
      if (el.getAttribute('data-qq-emo-thumb-url')) return;
      var bid = el.getAttribute('data-qq-emo-thumb');
      if (!bid) return;
      pending.push({ el: el, bid: bid });
    });
    if (!pending.length) return;
    var ids = pending.map(function (p) { return p.bid; });
    function paint(map) {
      pending.forEach(function (p) {
        var url = map[p.bid];
        if (url) p.el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    }
    if (store.prefetchBlobUrls) {
      store.prefetchBlobUrls(ids).then(paint);
      return;
    }
    pending.forEach(function (p) {
      if (!store.getEmojiItemUrl) return;
      store.getEmojiItemUrl(p.bid).then(function (url) {
        if (url) p.el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function bindEmojiMosaic(root) {
    if (!root) return;
    root.querySelectorAll('[data-qq-emo-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-qq-emo-name') || '';
        var payload = { role: 'user', type: 'sticker', content: '表情包-' + name, stickerName: name };
        var url = btn.getAttribute('data-qq-emo-pick-url');
        var blob = btn.getAttribute('data-qq-emo-pick-blob');
        if (url) payload.stickerUrl = url;
        if (blob) payload.stickerBlobId = blob;
        sendMessage(payload).catch(function () { toast('发送失败'); });
      });
    });
  }

  function fillEmojiMosaic(groupId) {
    var mosaic = $('qq-emo-mosaic');
    if (!mosaic || !store) return;
    var html = '';
    function cell(it) {
      var rawName = String(it.name || '表情').trim();
      var nm = esc(rawName);
      var bg = it.url
        ? ' data-qq-emo-thumb-url="' + esc(it.url) + '" data-qq-emo-pick-url="' + esc(it.url) + '"'
        : ' data-qq-emo-thumb="' + esc(it.blobId || '') + '" data-qq-emo-pick-blob="' + esc(it.blobId || '') + '"';
      return '<button type="button" class="qq-emo-cell" data-qq-emo-pick data-qq-emo-name="' + nm + '"' + bg +
        ' aria-label="' + nm + '" title="' + nm + '"></button>';
    }
    if (groupId === '__all__' && typeof store.getAllEmojiItemsFlat === 'function') {
      store.getAllEmojiItemsFlat().forEach(function (row) {
        if (row.item) html += cell(row.item);
      });
    } else {
      store.getEmojiPacks(groupId).forEach(function (pk) {
        (pk.items || []).forEach(function (it) { html += cell(it); });
      });
    }
    mosaic.innerHTML = html ||
      '<p class="qq-emo-panel__empty">还没有表情，去「我的 → 表情包」添加</p>';
    hydrateEmojiPanelThumbs(mosaic);
    bindEmojiMosaic(mosaic);
  }

  function hydrateEmojiPanel() {
    if (!store || !store.getEmojiGroups) return false;
    var groups = store.getEmojiGroups();
    if (!groups.length) return false;
    var rail = $('qq-emo-rail');
    if (!rail) return false;
    var tabList = [{ id: '__all__', name: '全部' }].concat(groups);
    rail.innerHTML = tabList.map(function (g, i) {
      return '<button type="button" class="qq-emo-panel__tab' + (i === 0 ? ' is-active' : '') +
        '" role="tab" data-qq-emo-tab="' + esc(g.id) + '">' + esc(g.name) + '</button>';
    }).join('');
    rail.querySelectorAll('[data-qq-emo-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        rail.querySelectorAll('.qq-emo-panel__tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        fillEmojiMosaic(tab.getAttribute('data-qq-emo-tab'));
      });
    });
    fillEmojiMosaic('__all__');
    return true;
  }

  function openEmojiPanel() {
    closeToolbarPanel();
    if (!hydrateEmojiPanel()) {
      toast('请先在「我的」添加表情包');
      return;
    }
    closeOverlay();
    blurComposeInput();
    var sc = $('qq-room-scroll');
    var anchor = sc ? captureScrollAnchor(sc) : null;
    emojiPanelOpen = true;
    var panel = $('qq-emo-panel');
    if (panel) {
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
    }
    if (roomEl) roomEl.classList.add('qq-room--emo-open');
    if (sc) applyScrollAfterLayout(sc, anchor, {});
  }

  function toolEmoji() {
    if (emojiPanelOpen || isEmojiPanelVisible()) {
      closeEmojiPanel();
      return;
    }
    openEmojiPanel();
  }

  function openGroupRedPacketSheet() {
    if (!isGroupRoom()) return;
    var grpRp = global.MiyaChatGroupRedPacket;
    if (!grpRp || typeof grpRp.buildSendSheetHtml !== 'function') {
      toast('群红包模块未加载');
      return;
    }
    var ctx = getChatContext(state.chatId);
    if (!ctx || !ctx.profile) {
      toast('请先选择面具');
      return;
    }
    var walletApi = global.MiyaChatWallet;
    closeToolbarPanel();
    openOverlay(grpRp.buildSendSheetHtml(ctx, esc, walletApi && walletApi.formatDisplay));
    var ov = $('qq-room-overlay');
    if (ov && typeof grpRp.bindSendSheet === 'function') {
      grpRp.bindSendSheet(ov, store, state.chatId, ctx, function (res) {
        if (!res) return;
        if (res.error) {
          var msg = walletApi && walletApi.walletErrorMessage
            ? walletApi.walletErrorMessage(res.error)
            : '发送失败';
          toast(msg);
          return;
        }
        closeOverlay();
        if (res.msg) {
          appendBubbleEl(res.msg, { stickBottom: true, instant: true });
          scrollRoomToBottom($('qq-room-scroll'), true);
          scheduleRefreshLists();
        }
      });
    }
  }

  function dismissGroupRedPacketOpenLayers() {
    document.querySelectorAll('[data-grp-rp-open-layer]').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function showGroupRedPacketOpenOverlay(amount, note) {
    var grpRp = global.MiyaChatGroupRedPacket;
    if (!grpRp || typeof grpRp.buildOpenOverlayHtml !== 'function') return;
    dismissGroupRedPacketOpenLayers();
    var layer = document.createElement('div');
    layer.innerHTML = grpRp.buildOpenOverlayHtml(amount, note);
    var root = layer.firstElementChild;
    if (!root) return;
    document.body.appendChild(root);
    function closeLayer() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }
    var closeBtn = root.querySelector('[data-grp-rp-open-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeLayer);
    root.addEventListener('click', function (e) {
      if (e.target === root) closeLayer();
    });
  }

  function applyGroupRedPacketClaimUi(msgId, result) {
    var sc = $('qq-room-scroll');
    function hasRow(id) {
      if (!sc || !id) return false;
      return !!sc.querySelector('[data-msg-id="' + String(id).replace(/"/g, '\\"') + '"]');
    }
    if (result && result.packet) patchMessageBubble(msgId);
    if (result && result.claimMsg && !hasRow(result.claimMsg.id)) {
      appendBubbleEl(result.claimMsg, { stickBottom: false, instant: true });
    }
    if (result && result.doneMsg && !hasRow(result.doneMsg.id)) {
      appendBubbleEl(result.doneMsg, { stickBottom: false, instant: true });
    }
    scheduleRefreshLists();
  }

  function resolveGroupRedPacketOpen(msgId, triggerBtn) {
    var grpRp = global.MiyaChatGroupRedPacket;
    if (!grpRp || !store || !state.chatId) return;
    var openKey = String(state.chatId) + ':' + String(msgId);
    if (grpRpOpening[openKey]) return;
    var msg = store.findMessage(state.chatId, msgId);
    if (!msg || !msg.groupRedPacket) return;
    var ctx = getChatContext(state.chatId);
    var grp =
      typeof grpRp.resolveMessageGroupRedPacket === 'function'
        ? grpRp.resolveMessageGroupRedPacket(msg)
        : grpRp.normalizeGroupRedPacket(msg.groupRedPacket);
    if (!grp) return;
    var mineId = grpRp.USER_OWNER_ID;
    if (grp.status === 'active' && grpRp.canClaim(grp, mineId, ctx.members, ctx)) {
      grpRpOpening[openKey] = true;
      if (triggerBtn) {
        triggerBtn.classList.add('is-claiming');
        triggerBtn.disabled = true;
      }
      grpRp.claimPacket(store, state.chatId, msgId, mineId, ctx).then(function (result) {
        var hit =
          result &&
          result.claimMsg &&
          result.claimMsg.groupRedPacketRef &&
          result.claimMsg.groupRedPacketRef.claim;
        if (!hit) {
          var pkt = result && result.packet && result.packet.groupRedPacket;
          var claims = pkt && pkt.claims ? pkt.claims : [];
          for (var i = claims.length - 1; i >= 0; i--) {
            if (claims[i] && String(claims[i].whoId) === String(mineId)) {
              hit = claims[i];
              break;
            }
          }
        }
        if (hit) showGroupRedPacketOpenOverlay(hit.amount, grp.note);
        applyGroupRedPacketClaimUi(msgId, result);
      }).catch(function () {
        toast('领取失败');
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.classList.remove('is-claiming');
        }
      }).finally(function () {
        delete grpRpOpening[openKey];
      });
      return;
    }
    openOverlay(grpRp.buildDetailHtml(Object.assign({}, msg, { groupRedPacket: grp }), ctx, esc));
  }

  function openTransferSheet() {
    var ctx = getChatContext(state.chatId);
    var balHint = '';
    if (ctx && ctx.profile && store.getWallet && global.MiyaChatWallet) {
      var w = store.getWallet(ctx.profile.id);
      balHint = '<p class="qq-sheet__hint">当前面具余额 ' + global.MiyaChatWallet.formatDisplay(w.balance) + '</p>';
    }
    openOverlay(
      '<div class="qq-sheet qq-sheet--xfer">' +
      '<div class="qq-sheet__panel">' +
      sheetGrabHead('Transfer · 转账', '发送转账', '金额将从当前面具余额预扣') +
      balHint +
      '<div class="qq-sheet__body">' +
      sheetField(
        '01',
        '金额',
        'Amount',
        '<div class="qq-sheet__input-wrap qq-sheet__input-wrap--prefix">' +
        '<span class="qq-sheet__prefix">¥</span>' +
        '<input class="qq-sheet__input" id="qq-xfer-amt" type="number" min="0.01" step="0.01" placeholder="0.00" inputmode="decimal">' +
        '</div>'
      ) +
      sheetField(
        '02',
        '附言',
        'Note',
        '<input class="qq-sheet__input" id="qq-xfer-note" type="text" maxlength="120" placeholder="想说的话…">'
      ) +
      '</div>' +
      '<div class="qq-sheet__actions">' +
      '<button type="button" class="qq-sheet__btn qq-sheet__btn--primary" id="qq-xfer-send">发送</button>' +
      '<button type="button" class="qq-sheet__btn qq-sheet__btn--ghost" data-sheet-close>取消</button>' +
      '</div></div></div>'
    );
    var sendBtn = $('qq-xfer-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var amt = Number(($('qq-xfer-amt') && $('qq-xfer-amt').value) || 0);
        var note = ($('qq-xfer-note') && $('qq-xfer-note').value) || '';
        if (!amt || amt <= 0) return toast('请输入有效金额');
        var ctx = getChatContext(state.chatId);
        var profileId = ctx && ctx.profile && ctx.profile.id;
        if (!profileId) return toast('请先选择面具');
        var walletApi = global.MiyaChatWallet;
        var holdChain = walletApi && typeof walletApi.holdUserOutgoingTransfer === 'function'
          ? walletApi.holdUserOutgoingTransfer(profileId, amt)
          : Promise.resolve();
        holdChain.then(function () {
          return sendMessage({
            role: 'user', type: 'transfer', content: '[转账] ¥' + amt,
            redPacket: {
              amount: amt,
              note: note,
              status: 'pending',
              dir: 'out',
              resolvedAt: 0,
              walletHeld: !!(walletApi && typeof walletApi.holdUserOutgoingTransfer === 'function')
            }
          });
        }).then(function () {
          closeOverlay();
          toast('已发送');
        }).catch(function (err) {
          var code = walletApi && walletApi.errCode ? walletApi.errCode(err) : '';
          var msg = walletApi && walletApi.walletErrorMessage
            ? walletApi.walletErrorMessage(code)
            : '发送失败';
          toast(msg);
        });
      });
    }
  }

  function orderUiCtx() {
    return {
      openOverlay: openOverlay,
      closeOverlay: closeOverlay,
      sendMessage: sendMessage,
      toast: toast,
      $: $
    };
  }

  function openTakeoutSheet() {
    var ui = global.MiyaChatOrderUi;
    if (ui && typeof ui.openTakeoutForm === 'function') {
      ui.openTakeoutForm(orderUiCtx());
      return;
    }
    toast('外卖模块未加载');
  }

  function openGiftSheet() {
    var ui = global.MiyaChatOrderUi;
    if (ui && typeof ui.openGiftForm === 'function') {
      ui.openGiftForm(orderUiCtx());
      return;
    }
    toast('送礼模块未加载');
  }

  function openLocationSheet() {
    openOverlay(
      '<div class="qq-sheet qq-sheet--loc">' +
      '<div class="qq-sheet__panel">' +
      sheetGrabHead('Location · 位置', '分享位置', '填写地点名称与详细地址') +
      '<div class="qq-sheet__body">' +
      sheetField(
        '01',
        '地点',
        'Place',
        '<input class="qq-sheet__input" id="qq-loc-name" type="text" maxlength="80" placeholder="例如：滨海咖啡">'
      ) +
      sheetField(
        '02',
        '地址',
        'Address',
        '<input class="qq-sheet__input" id="qq-loc-addr" type="text" maxlength="160" placeholder="街道、楼层或详细描述">'
      ) +
      '</div>' +
      '<div class="qq-sheet__actions">' +
      '<button type="button" class="qq-sheet__btn qq-sheet__btn--primary" id="qq-loc-send">发送</button>' +
      '<button type="button" class="qq-sheet__btn qq-sheet__btn--ghost" data-sheet-close>取消</button>' +
      '</div></div></div>'
    );
    var btn = $('qq-loc-send');
    if (btn) {
      btn.addEventListener('click', function () {
        var name = ($('qq-loc-name') && $('qq-loc-name').value || '').trim();
        var addr = ($('qq-loc-addr') && $('qq-loc-addr').value || '').trim();
        if (!name || !addr) return toast('请填写地点和地址');
        sendMessage({
          role: 'user', type: 'location', content: '[位置] ' + name,
          locationCard: { name: name, address: addr, lat: 0, lng: 0 }
        }).then(function () { closeOverlay(); }).catch(function () { toast('发送失败'); });
      });
    }
  }

  function handleTool(key) {
    if (key === 'mic') toolVoice();
    else if (key === 'image') toolImage();
    else if (key === 'redo' || key === 'camera') toolRegenerate();
    else if (key === 'emoji') toolEmoji();
    else if (key === 'groupRedPacket') openGroupRedPacketSheet();
    else if (key === 'transfer') openTransferSheet();
    else if (key === 'takeout') openTakeoutSheet();
    else if (key === 'gift') openGiftSheet();
    else if (key === 'location') openLocationSheet();
    else if (key === 'call') {
      if (global.MiyaChatCalls) global.MiyaChatCalls.openCallPicker(state.chatId);
      else toast('视频通话模块未加载');
    }
    else if (key === 'clock') toggleTimestamps();
    else if (key === 'narration') toggleNarrationMode();
    else if (key === 'lovePoem') openLovePoemPicker();
  }

  function toggleTimestamps() {
    state.showTimestamps = !state.showTimestamps;
    persistShowTimestampsPref(state.showTimestamps);
    if (roomEl) roomEl.classList.toggle('qq-room--show-time', state.showTimestamps);
    var clockBtn = roomEl && roomEl.querySelector('[data-plus="clock"]');
    if (clockBtn) clockBtn.classList.toggle('is-active', state.showTimestamps);
    if (state.chatId) renderMessages(state.chatId);
    toast(state.showTimestamps ? '已显示时间' : '已隐藏时间');
  }

  function bindToolbarEvents() {
    var aiBtn = $('qq-room-ai');
    if (!aiBtn || aiBtn.dataset.boundReply) return;
    aiBtn.dataset.boundReply = '1';
    aiBtn.addEventListener('click', function () { requestAiReply(); });
  }

  function ensureToolbarFresh() {
    var bar = roomEl && roomEl.querySelector('.qq-room__toolbar');
    if (!bar) return;
    var grp = isGroupRoom();
    if (bar.dataset.grpMode === (grp ? '1' : '0') && bar.querySelector('[data-qq-tool]')) {
      bindToolbarEvents();
      syncToolbarPanel();
      syncNarrationModeUi();
      syncThinkingBtn();
      return;
    }
    bar.dataset.grpMode = grp ? '1' : '0';
    bar.innerHTML = buildToolbarHtml(grp);
    var clockBtn = bar.querySelector('[data-plus="clock"]');
    if (clockBtn) clockBtn.classList.toggle('is-active', state.showTimestamps);
    syncNarrationModeUi();
    syncThinkingBtn();
    bindToolbarEvents();
    syncToolbarPanel();
  }

  function multiSelectCount() {
    if (!state.multiSelectIds) return 0;
    return Object.keys(state.multiSelectIds).length;
  }

  function isMsgMultiSelected(msgId) {
    return !!(state.multiSelectMode && state.multiSelectIds && state.multiSelectIds[String(msgId || '')]);
  }

  function syncMultiSelectDom() {
    var sc = $('qq-room-scroll');
    if (sc) {
      sc.querySelectorAll('[data-msg-id]').forEach(function (el) {
        el.classList.toggle('is-picked', isMsgMultiSelected(el.getAttribute('data-msg-id')));
      });
    }
    var bar = $('qq-room-multi-bar');
    var cnt = $('qq-room-multi-count');
    if (bar) {
      bar.hidden = !state.multiSelectMode;
      bar.setAttribute('aria-hidden', state.multiSelectMode ? 'false' : 'true');
    }
    if (cnt) cnt.textContent = String(multiSelectCount());
    if (roomEl) roomEl.classList.toggle('qq-room--pick', !!state.multiSelectMode);
  }

  function exitMultiSelectMode() {
    state.multiSelectMode = false;
    state.multiSelectIds = null;
    syncMultiSelectDom();
    restoreComposeAfterOverlay();
  }

  function enterMultiSelectMode(seedMsgId) {
    closeMsgMenu();
    cancelQuote();
    closeEmojiPanel();
    closeToolbarPanel();
    blurComposeInput();
    state.multiSelectMode = true;
    state.multiSelectIds = {};
    if (seedMsgId) state.multiSelectIds[String(seedMsgId)] = true;
    syncMultiSelectDom();
  }

  function toggleMultiSelectMsg(msgId) {
    if (!state.multiSelectMode || !msgId) return;
    var key = String(msgId);
    if (!state.multiSelectIds) state.multiSelectIds = {};
    if (state.multiSelectIds[key]) delete state.multiSelectIds[key];
    else state.multiSelectIds[key] = true;
    syncMultiSelectDom();
  }

  function deleteSelectedMessages() {
    if (!state.chatId || !store || !state.multiSelectIds) return;
    var ids = Object.keys(state.multiSelectIds);
    if (!ids.length) {
      toast('请先选择消息');
      return;
    }
    store.deleteMessages(state.chatId, ids).then(function (removed) {
      exitMultiSelectMode();
      renderMessages(state.chatId);
      if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
      toast('已删除 ' + (removed || ids.length) + ' 条');
    });
  }

  function closeMsgMenu() {
    msgMenuId = null;
    msgMenuBlockPointerId = null;
    msgMenuSuppressClickUntil = 0;
    var menu = document.querySelector('.qq-msg-menu');
    if (menu) menu.remove();
  }

  function openMsgMenu(msgId, anchorEl) {
    var msg = store.findMessage(state.chatId, msgId);
    if (!msg || msg.deleted || msg.recalled) return;
    if (msgMenuId === msgId) {
      closeMsgMenu();
      return;
    }
    closeMsgMenu();
    msgMenuId = msgId;
    if (longPressPointerId != null) {
      msgMenuBlockPointerId = longPressPointerId;
    }
    longPressPointerId = null;
    msgMenuSuppressClickUntil = Date.now() + 450;
    var canEdit = msg.role === 'user' || msg.role === 'assistant';
    var favorited = store.isMessageFavorited && store.isMessageFavorited(state.chatId, msg.id);
    var fmtRecall = global.MiyaChatOnlineFormat;
    var canRecall =
      msg.role === 'user' &&
      fmtRecall &&
      typeof fmtRecall.canRecallUserMessage === 'function' &&
      fmtRecall.canRecallUserMessage(store, state.chatId, msg);
    var items = [
      { act: 'quote', label: '引用' },
      { act: 'copy', label: '复制' },
      canEdit ? { act: 'edit', label: '编辑' } : null,
      canRecall ? { act: 'recall', label: '撤回' } : null,
      { act: 'favorite', label: favorited ? '取消收藏' : '收藏' },
      { act: 'delete', label: '删除', danger: true }
    ].filter(Boolean);
    var menu = document.createElement('div');
    menu.className = 'qq-msg-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(function (it) {
      return '<button type="button" class="qq-msg-menu__btn' + (it.danger ? ' is-danger' : '') +
        '" data-msg-act="' + it.act + '" role="menuitem">' + esc(it.label) + '</button>';
    }).join('');
    function runMenuAction(e, act) {
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      var lockKey = act + ':' + msg.id;
      if (msgMenuActLock === lockKey) return;
      msgMenuActLock = lockKey;
      setTimeout(function () {
        if (msgMenuActLock === lockKey) msgMenuActLock = '';
      }, 450);
      handleMsgAction(act, msg);
    }
    menu.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('[data-msg-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-msg-act');
      if (act === 'copy' || act === 'edit') return;
      runMenuAction(e, act);
    }, true);
    menu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-msg-act]');
      if (!btn) return;
      runMenuAction(e, btn.getAttribute('data-msg-act'));
    }, true);
    menu.classList.add('qq-msg-menu--portal');
    document.body.appendChild(menu);
    if (anchorEl) {
      var bubble = anchorEl.querySelector('.qq-room__bubble-stack') || anchorEl;
      var r = bubble.getBoundingClientRect();
      var gap = 2;
      var topAbove = r.top - menu.offsetHeight - gap;
      var topBelow = r.bottom + gap;
      var top = topAbove >= 8 ? topAbove : topBelow;
      var isMe = anchorEl.classList.contains('qq-room__row--me');
      var left = isMe
        ? r.right - menu.offsetWidth
        : r.left;
      left = Math.min(Math.max(8, left), window.innerWidth - menu.offsetWidth - 8);
      menu.style.top = top + 'px';
      menu.style.left = left + 'px';
    }
  }

  function handleMsgAction(act, msg) {
    if (!msg || !state.chatId || !store) return;
    if (act === 'copy') {
      var text = messagePlainText(msg);
      var copied = copyTextSync(text);
      closeMsgMenu();
      if (copied) {
        toast('已复制');
        return;
      }
      copyText(text)
        .then(function () { toast('已复制'); })
        .catch(function () { toast('复制失败'); });
      return;
    }
    closeMsgMenu();
    if (act === 'quote') {
      enterQuoteMode(msg);
      return;
    }
    if (act === 'edit') {
      cancelQuote();
      dialog({ mode: 'prompt', title: '编辑消息', message: '修改内容', defaultValue: messagePlainText(msg) }).then(function (val) {
        if (val == null || val === false) return;
        var t = String(val).trim();
        if (!t) return toast('内容不能为空');
        var fmt = global.MiyaChatOnlineFormat;
        var patch = fmt && typeof fmt.buildEditPatchFromContent === 'function'
          ? fmt.buildEditPatchFromContent(msg, t)
          : { content: t, edited: true, editedAt: Date.now() };
        patch.edited = true;
        patch.editedAt = Date.now();
        store.updateMessage(state.chatId, msg.id, patch).then(function () {
          renderMessages(state.chatId);
          toast('已保存');
        });
      });
      return;
    }
    if (act === 'delete') {
      enterMultiSelectMode(msg.id);
      return;
    }
    if (act === 'recall') {
      if (!store.recallMessage) {
        toast('撤回失败');
        return;
      }
      store.recallMessage(state.chatId, msg.id, { by: 'user' }).then(function () {
        renderMessages(state.chatId);
        scheduleRefreshLists();
        toast('已撤回');
      }).catch(function (err) {
        var code = err && err.message ? err.message : '';
        if (code === 'already_recalled') toast('该消息已撤回');
        else if (code === 'not_recent') toast('只能撤回近期发送的消息');
        else toast('撤回失败');
      });
      return;
    }
    if (act === 'favorite') {
      var ctx = getChatContext(state.chatId);
      if (store.isMessageFavorited && store.isMessageFavorited(state.chatId, msg.id)) {
        store.removeSavedMessageByRef(state.chatId, msg.id).then(function () {
          toast('已取消收藏');
        }).catch(function () { toast('操作失败'); });
        return;
      }
      store.addSavedMessage({
        chatId: state.chatId,
        messageId: msg.id,
        text: messagePlainText(msg),
        from: msg.role === 'user' ? displayProfileName() : displayContactName(ctx && ctx.contact),
        chatName: displayContactName(ctx && ctx.contact),
        role: msg.role,
        message: msg
      }).then(function () {
        toast('已收藏');
      }).catch(function () { toast('收藏失败'); });
      return;
    }
  }

  function resolveTransferAction(msgId, action) {
    var msg = store.findMessage(state.chatId, msgId);
    if (!msg || !msg.redPacket || msg.redPacket.status !== 'pending') return;
    var ctx = getChatContext(state.chatId);
    var walletApi = global.MiyaChatWallet;
    var settleChain = Promise.resolve();
    if (
      walletApi &&
      typeof walletApi.settleRoleOutgoingTransfer === 'function' &&
      ctx &&
      ctx.contact &&
      ctx.profile
    ) {
      settleChain = walletApi.settleRoleOutgoingTransfer({
        contactId: ctx.contact.id,
        profileId: ctx.profile.id,
        amount: msg.redPacket.amount,
        action: action === 'accept' ? 'accept' : 'refund',
        redPacket: msg.redPacket
      });
    }
    settleChain.then(function () {
      return store.updateMessage(state.chatId, msgId, {
        redPacket: Object.assign({}, msg.redPacket, {
          status: action === 'accept' ? 'accepted' : 'refunded',
          dir: 'in',
          resolvedAt: Date.now(),
          walletSettled: !!(msg.redPacket && msg.redPacket.walletHeld)
        })
      });
    }).then(function () {
      renderMessages(state.chatId);
      toast(action === 'accept' ? '已收款' : '已退回');
    }).catch(function () {
      toast('操作失败');
    });
  }

  function findMsgRowFromTarget(target) {
    if (!target || !target.closest) return null;
    var row = target.closest('[data-msg-id]');
    if (row) return row;
    row = target.closest('.qq-room__row[data-msg-id]');
    if (row) return row;
    return target.closest('.qq-room__sys[data-msg-id]');
  }

  function shouldCancelLongPress(clientX, clientY) {
    if (!longPressTimer) return false;
    var dx = Math.abs(clientX - longPressStartX);
    var dy = Math.abs(clientY - longPressStartY);
    return dx > 12 || dy > 12;
  }

  function beginLongPress(e, row) {
    clearTimeout(longPressTimer);
    longPressStartX = e.clientX != null ? e.clientX : 0;
    longPressStartY = e.clientY != null ? e.clientY : 0;
    longPressPointerId = e.pointerId != null ? e.pointerId : null;
    var id = row.getAttribute('data-msg-id');
    if (!id) return;
    longPressTimer = setTimeout(function () { openMsgMenu(id, row); }, 480);
  }

  function bindLongPress() {
    var root = roomEl || $('qq-room');
    if (!root || root.dataset.lpBound) return;
    root.dataset.lpBound = '1';
    root.addEventListener('contextmenu', function (e) {
      if (findMsgRowFromTarget(e.target)) e.preventDefault();
    });
    root.addEventListener('selectstart', function (e) {
      if (findMsgRowFromTarget(e.target)) e.preventDefault();
    });
    root.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.qq-msg-menu')) return;
      if (state.multiSelectMode) return;
      var row = findMsgRowFromTarget(e.target);
      if (!row) return;
      beginLongPress(e, row);
    }, { capture: true, passive: true });
    root.addEventListener('pointerup', function (e) {
      clearTimeout(longPressTimer);
      longPressPointerId = null;
      if (msgMenuBlockPointerId === e.pointerId) {
        msgMenuBlockPointerId = null;
        msgMenuSuppressClickUntil = Math.max(msgMenuSuppressClickUntil, Date.now() + 400);
      }
    });
    root.addEventListener('pointercancel', function (e) {
      clearTimeout(longPressTimer);
      longPressPointerId = null;
      if (msgMenuBlockPointerId === e.pointerId) {
        msgMenuBlockPointerId = null;
        msgMenuSuppressClickUntil = Math.max(msgMenuSuppressClickUntil, Date.now() + 400);
      }
    });
    root.addEventListener('pointermove', function (e) {
      if (shouldCancelLongPress(e.clientX, e.clientY)) {
        clearTimeout(longPressTimer);
      }
    }, { passive: true });
    root.addEventListener(
      'touchmove',
      function (e) {
        var t = e.touches && e.touches[0];
        if (!t) return;
        if (shouldCancelLongPress(t.clientX, t.clientY)) {
          clearTimeout(longPressTimer);
        }
      },
      { passive: true }
    );
    root.addEventListener('click', function (e) {
      if (!state.multiSelectMode) {
        dismissMsgMenuIfOutside(e.target);
        return;
      }
      var row = findMsgRowFromTarget(e.target);
      if (!row) return;
      e.preventDefault();
      toggleMultiSelectMsg(row.getAttribute('data-msg-id'));
    });
  }

  function bindGlobalCallClicks() {
    if (document.documentElement.getAttribute('data-miya-call-click') === '1') return;
    document.documentElement.setAttribute('data-miya-call-click', '1');
    document.addEventListener('click', function (e) {
      var calls = global.MiyaChatCalls;
      if (calls && typeof calls.handleClick === 'function') calls.handleClick(e);
    }, true);
  }

  function bindMatchCardExpand() {
    if (document.documentElement.getAttribute('data-miya-match-expand') === '1') return;
    document.documentElement.setAttribute('data-miya-match-expand', '1');
    document.addEventListener('click', function (e) {
      var card = e.target && e.target.closest
        ? e.target.closest('.qq-card-match[data-match-expand], .qq-card-sayguess[data-sg-expand]')
        : null;
      if (!card) return;
      card.classList.toggle('is-expanded');
    }, true);
  }

  var imageLightboxState = { blobKey: '', url: '', filename: 'miya-chat-image.png' };

  function ensureImageLightbox() {
    var host = document.getElementById('qq-img-lightbox');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'qq-img-lightbox';
    host.className = 'qq-img-lightbox';
    host.hidden = true;
    host.innerHTML =
      '<div class="qq-img-lightbox__backdrop" data-mq-img-lb-close aria-hidden="true"></div>' +
      '<div class="qq-img-lightbox__panel" role="dialog" aria-modal="true" aria-label="查看图片">' +
        '<img class="qq-img-lightbox__img" alt="大图预览">' +
        '<div class="qq-img-lightbox__bar">' +
          '<button type="button" class="qq-img-lightbox__btn" data-mq-img-lb-download>保存图片</button>' +
          '<button type="button" class="qq-img-lightbox__btn qq-img-lightbox__btn--ghost" data-mq-img-lb-close>关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(host);
    return host;
  }

  function closeImageLightbox() {
    var host = document.getElementById('qq-img-lightbox');
    if (!host) return;
    host.hidden = true;
    document.documentElement.classList.remove('qq-img-lightbox-open');
    var img = host.querySelector('.qq-img-lightbox__img');
    if (img) img.removeAttribute('src');
    imageLightboxState.blobKey = '';
    imageLightboxState.url = '';
  }

  function resolveChatImageUrl(blobKey) {
    if (!blobKey || !store) return Promise.resolve('');
    if (typeof store.getCachedBlobUrl === 'function') {
      var cached = store.getCachedBlobUrl(blobKey);
      if (cached) return Promise.resolve(cached);
    }
    if (typeof store.getAvatarUrl === 'function') {
      return store.getAvatarUrl(blobKey).then(function (url) { return url || ''; });
    }
    return Promise.resolve('');
  }

  function openImageLightbox(blobKey) {
    var key = String(blobKey || '').trim();
    if (!key) return;
    resolveChatImageUrl(key).then(function (url) {
      if (!url) {
        toast('图片加载失败');
        return;
      }
      var host = ensureImageLightbox();
      var img = host.querySelector('.qq-img-lightbox__img');
      if (!img) return;
      imageLightboxState.blobKey = key;
      imageLightboxState.url = url;
      imageLightboxState.filename = 'miya-chat-image-' + Date.now() + '.png';
      img.src = url;
      host.hidden = false;
      document.documentElement.classList.add('qq-img-lightbox-open');
    }).catch(function () {
      toast('图片加载失败');
    });
  }

  function downloadImageLightbox() {
    var url = imageLightboxState.url;
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.download = imageLightboxState.filename || 'miya-chat-image.png';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function bindGlobalImageClicks() {
    if (document.documentElement.getAttribute('data-miya-img-click') === '1') return;
    document.documentElement.setAttribute('data-miya-img-click', '1');
    document.addEventListener('click', function (e) {
      var retryBtn = e.target.closest('[data-mq-img-gen-retry]');
      if (retryBtn) {
        e.preventDefault();
        e.stopPropagation();
        var msgId = retryBtn.getAttribute('data-msg-id') || '';
        var cid = state.chatId;
        var ig = global.MiyaImageGen;
        if (!cid || !msgId || !ig || typeof ig.retryChatMessage !== 'function') return;
        retryBtn.disabled = true;
        ig.retryChatMessage(cid, msgId).catch(function () {
          toast('重试失败');
        }).then(function () {
          retryBtn.disabled = false;
        });
        return;
      }
      var dlBtn = e.target.closest('[data-mq-img-lb-download]');
      if (dlBtn) {
        e.preventDefault();
        e.stopPropagation();
        downloadImageLightbox();
        return;
      }
      if (e.target.closest('[data-mq-img-lb-close]')) {
        e.preventDefault();
        e.stopPropagation();
        closeImageLightbox();
        return;
      }
      var viewBtn = e.target.closest('[data-mq-img-view]');
      if (!viewBtn) return;
      e.preventDefault();
      e.stopPropagation();
      var blobKey = viewBtn.getAttribute('data-msg-img') || '';
      if (!blobKey) {
        var innerImg = viewBtn.querySelector('[data-msg-img]');
        blobKey = innerImg ? innerImg.getAttribute('data-msg-img') || '' : '';
      }
      openImageLightbox(blobKey);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var host = document.getElementById('qq-img-lightbox');
      if (host && !host.hidden) closeImageLightbox();
    });
  }

  function bindGlobalHtmlClicks() {
    if (document.documentElement.getAttribute('data-miya-html-click') === '1') return;
    document.documentElement.setAttribute('data-miya-html-click', '1');
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-miya-chat-html-fs="1"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var panel = btn.closest('.qq-room__html-panel');
      var frame = panel && panel.querySelector('iframe[data-miya-chat-html-iframe="1"]');
      var htmlApi = global.MiyaChatHtml;
      if (!frame || !htmlApi) return;
      var srcdoc =
        typeof htmlApi.decodeSrcdocB64 === 'function'
          ? htmlApi.decodeSrcdocB64(frame.getAttribute('data-miya-chat-srcdoc-b64'))
          : '';
      if (srcdoc && typeof htmlApi.openChatHtmlFullscreen === 'function') {
        htmlApi.openChatHtmlFullscreen(srcdoc);
      }
    }, true);
  }

  function bindRoomEvents() {
    if (!roomEl || roomEl.dataset.bound) return;
    roomEl.dataset.bound = '1';
    bindGlobalCallClicks();
    bindMatchCardExpand();
    bindGlobalHtmlClicks();
    bindGlobalImageClicks();
    if (global.MiyaChatCalls && typeof global.MiyaChatCalls.ensureCallHost === 'function') {
      global.MiyaChatCalls.ensureCallHost();
    }

    $('qq-room-back').addEventListener('click', function () {
      if (state.multiSelectMode) {
        exitMultiSelectMode();
        return;
      }
      close();
    });
    var moreBtn = $('qq-room-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        if (!state.chatId || !global.miyaChatContactSettings) return;
        var cid = state.chatId;
        requestAnimationFrame(function () {
          if (String(state.chatId) !== String(cid)) return;
          global.miyaChatContactSettings.open(cid);
        });
      });
    }
    var thinkPop = $('qq-room-think-pop');
    if (thinkPop) {
      thinkPop.addEventListener('click', function () {
        closeThinkingPop();
      });
    }
    var aiBtn = $('qq-room-ai');
    bindToolbarEvents();
    var sendBtn = $('qq-room-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        handleSend();
      });
    }
    roomEl.addEventListener('pointerup', function (e) {
      if (msgMenuBlockPointerId === e.pointerId) {
        msgMenuBlockPointerId = null;
        msgMenuSuppressClickUntil = Math.max(msgMenuSuppressClickUntil, Date.now() + 400);
      }
    });
    roomEl.addEventListener('click', function (e) {
      var t = e.target;
      dismissMsgMenuIfOutside(t);
      if (t.closest('#qq-emo-close') || t.closest('[data-qq-emo-close]')) {
        e.preventDefault();
        e.stopPropagation();
        closeEmojiPanel();
        return;
      }
      if (t.closest('[data-hv-ava]')) {
        if (isGroupRoom()) return;
        e.preventDefault();
        var hvRow = t.closest('[data-msg-id]');
        var hvMsgId = hvRow ? hvRow.getAttribute('data-msg-id') : '';
        var hvImg = t.closest('[data-hv-ava]');
        var hvApi = global.MiyaChatHeartVoice;
        if (hvApi && state.chatId && typeof hvApi.onAvatarClick === 'function') {
          hvApi.onAvatarClick(state.chatId, hvMsgId, hvImg ? hvImg.src : '');
        }
        return;
      }
      if (t.closest('[data-qq-quote-cancel]')) {
        e.preventDefault();
        cancelQuote();
        return;
      }
      var recallBtn = t.closest('[data-recall-view]');
      if (recallBtn) {
        e.preventDefault();
        e.stopPropagation();
        var recallId = recallBtn.getAttribute('data-recall-view');
        var recallMsg = recallId && store ? store.findMessage(state.chatId, recallId) : null;
        if (recallMsg) showRecalledMessage(recallMsg);
        return;
      }
      if (t.closest('[data-qq-multi-cancel]')) {
        e.preventDefault();
        exitMultiSelectMode();
        return;
      }
      if (t.closest('[data-qq-multi-del]')) {
        e.preventDefault();
        deleteSelectedMessages();
        return;
      }
      if (t.closest('[data-sheet-close]') || (t.closest('.qq-sheet') && !t.closest('.qq-sheet__panel') && !t.closest('.qq-lovepoem-sheet') && !t.closest('.qq-journal__book'))) {
        if (t.closest('[data-sheet-close]') || t.classList.contains('qq-room__overlay')) closeOverlay();
      }
      if (t.closest('[data-pick="photo"]')) { e.preventDefault(); pickPhotoFile(); return; }
      if (t.closest('[data-pick="text"]')) { e.preventDefault(); pickTextImage(); return; }
      if (t.closest('[data-voice-pick="record"]')) { e.preventDefault(); toolVoiceRecord(); return; }
      if (t.closest('[data-voice-pick="text"]')) { e.preventDefault(); closeOverlay(); toolVoiceManual(); return; }
      if (t.closest('[data-plus="transfer"]')) { e.preventDefault(); openTransferSheet(); return; }
      if (t.closest('[data-plus="takeout"]')) { e.preventDefault(); openTakeoutSheet(); return; }
      if (t.closest('[data-plus="gift"]')) { e.preventDefault(); openGiftSheet(); return; }
      if (t.closest('[data-plus="location"]')) { e.preventDefault(); openLocationSheet(); return; }
      if (t.closest('[data-plus="call"]')) {
        e.preventDefault();
        if (global.MiyaChatCalls) global.MiyaChatCalls.openCallPicker(state.chatId);
        else toast('视频通话模块未加载');
        return;
      }
      if (global.MiyaChatCalls && typeof global.MiyaChatCalls.handleClick === 'function') {
        if (global.MiyaChatCalls.handleClick(e)) return;
      }
      if (global.MiyaMusicListenTogether && typeof global.MiyaMusicListenTogether.handleClick === 'function') {
        if (global.MiyaMusicListenTogether.handleClick(e)) return;
      }
      if (t.closest('[data-plus="clock"]')) { e.preventDefault(); toggleTimestamps(); return; }
      if (t.closest('[data-plus="narration"]')) { e.preventDefault(); toggleNarrationMode(); return; }
      if (t.closest('[data-plus="thinking"]')) { e.preventDefault(); openThinkingPop(); return; }
      if (t.closest('[data-plus="lovePoem"]')) { e.preventDefault(); openLovePoemPicker(); return; }
      if (t.closest('#qq-room-tools-toggle')) { e.preventDefault(); toggleToolbarPanel(); return; }
      var tool = t.closest('[data-qq-tool]');
      if (tool) { e.preventDefault(); handleTool(tool.getAttribute('data-qq-tool')); return; }
      var xfer = t.closest('[data-xfer-act]');
      if (xfer) {
        e.preventDefault();
        var card = t.closest('[data-msg-id]');
        if (card) resolveTransferAction(card.getAttribute('data-msg-id'), xfer.getAttribute('data-xfer-act'));
        return;
      }
      var grpRpBtn = t.closest('[data-grp-rp-open]');
      if (grpRpBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (grpRpBtn.disabled || grpRpBtn.classList.contains('is-claiming')) return;
        resolveGroupRedPacketOpen(grpRpBtn.getAttribute('data-grp-rp-open'), grpRpBtn);
        return;
      }
      var voicePlayBtn = t.closest('[data-mq-voice-play]');
      if (voicePlayBtn) {
        e.preventDefault();
        e.stopPropagation();
        var playRow = voicePlayBtn.closest('[data-msg-id]');
        var playMsgId =
          voicePlayBtn.getAttribute('data-msg-id') ||
          (playRow ? playRow.getAttribute('data-msg-id') : '');
        var playCid = state.chatId;
        var playMsg = playCid && store ? store.findMessage(playCid, playMsgId) : null;
        var userRec = global.MiyaChatVoiceRecord;
        if (
          playMsg &&
          playMsg.role === 'user' &&
          playMsg.voiceAudioIdbKey &&
          userRec &&
          typeof userRec.handlePlay === 'function'
        ) {
          userRec.handlePlay(playRow, playMsgId, playCid);
        } else {
          var tts = global.MiyaChatVoiceTts;
          if (playCid && playMsgId && tts && typeof tts.handlePlay === 'function') {
            tts.handlePlay(playRow, playMsgId, playCid);
          }
        }
        return;
      }
      var voice = t.closest('[data-voice-toggle]');
      if (voice) {
        e.preventDefault();
        voice.classList.toggle('is-open');
      }
    });

    var input = $('qq-room-input');
    if (input) {
      var inputHeightRaf = 0;
      var focusKbTimers = [];
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
      input.addEventListener('input', function () {
        if (inputHeightRaf) cancelAnimationFrame(inputHeightRaf);
        inputHeightRaf = requestAnimationFrame(function () {
          inputHeightRaf = 0;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
        scheduleStickerSuggestUpdate();
      });
      input.addEventListener('focus', function () {
        cancelIosKbRecovery();
        focusKbTimers.forEach(function (id) { clearTimeout(id); });
        focusKbTimers = [];
        syncKeyboardInset();
        requestAnimationFrame(function () {
          syncKeyboardInset();
          scrollRoomToBottom($('qq-room-scroll'), true);
        });
        focusKbTimers.push(setTimeout(syncKeyboardInset, 120));
        focusKbTimers.push(setTimeout(syncKeyboardInset, 280));
      });
      input.addEventListener('blur', function () {
        focusKbTimers.forEach(function (id) { clearTimeout(id); });
        focusKbTimers = [];
        if (isIOSChat()) {
          iosKeyboardWasOpen = true;
          recoverIosViewportAfterKeyboard();
          return;
        }
        requestAnimationFrame(syncKeyboardInset);
      });
    }
    bindLongPress();
    var roomScroll = $('qq-room-scroll');
    if (roomScroll && typeof global.miyaBindScrollBlur === 'function') {
      global.miyaBindScrollBlur(roomScroll, { idleMs: 120 });
    }
  }

  function hydrateHeader(chatId) {
    var ctx = getChatContext(chatId);
    var title = $('qq-room-title');
    var status = $('qq-room-head-status');
    var headAva = $('qq-room-head-ava');
    var headAvaWrap = headAva && headAva.parentElement;
    var name = resolveDisplayName(ctx);
    if (title) title.textContent = name;
    if (status) status.textContent = resolveHeaderStatus(ctx);
    if (headAva) {
      if (ctx && ctx.isGroup) {
        var gg = global.MiyaChatGroup;
        if (headAvaWrap) {
          headAvaWrap.classList.add('qq-room__head-avatar--group');
          headAvaWrap.querySelectorAll('.mq-grp-head-stack, .mq-grp-head-ava').forEach(function (n) { n.remove(); });
        }
        headAva.hidden = false;
        var custom = gg && store && gg.resolveGroupAvatarFromSettings
          ? gg.resolveGroupAvatarFromSettings(store.getChatSettings(chatId), store)
          : '';
        if (custom) {
          headAva.src = custom;
        } else if (gg && gg.renderGroupCollageHtml) {
          var collageHtml = gg.renderGroupCollageHtml(ctx.members, function (c) {
            return state.avatars[c.id] || resolveAvatarUrlSync(c) || avatarFallback(c.name);
          }, 'mq-grp-head');
          if (headAvaWrap) {
            headAva.hidden = true;
            var tmp = document.createElement('div');
            tmp.innerHTML = collageHtml;
            while (tmp.firstChild) headAvaWrap.appendChild(tmp.firstChild);
          }
        } else {
          headAva.src = avatarFallback('群');
        }
        headAva.alt = name;
      } else {
        if (headAvaWrap) {
          headAvaWrap.classList.remove('qq-room__head-avatar--group');
          headAvaWrap.querySelectorAll('.mq-grp-head-stack').forEach(function (n) { n.remove(); });
        }
        headAva.hidden = false;
        var ava = ctx && ctx.contact
          ? state.avatars[ctx.contact.id] || resolveAvatarUrlSync(ctx.contact) || avatarFallback(name)
          : avatarFallback('?');
        headAva.src = ava;
        headAva.alt = name;
      }
    }
    var aiBtn = $('qq-room-ai');
    if (aiBtn) {
      var lbl = aiBtn.querySelector('.qq-room__tool-reply-label');
      if (lbl) lbl.remove();
    }
    syncThinkingBtn();
  }

  function preloadAvatars(chatId, opts) {
    opts = opts || {};
    var ctx = getChatContext(chatId);
    if (!ctx) return Promise.resolve();
    if (!opts.keepCache) {
      if (ctx.profile) delete state.avatars[profileAvatarKey(ctx.profile)];
      if (ctx.contact) delete state.avatars[ctx.contact.id];
      if (ctx.isGroup && ctx.members && ctx.members.length) {
        ctx.members.forEach(function (c) {
          delete state.avatars[c.id];
        });
      }
    }
    if (ctx.isGroup && ctx.members && ctx.members.length) {
      var jobs = [resolveProfileAvatarUrl(ctx.profile)];
      ctx.members.forEach(function (c) {
        jobs.push(resolveAvatarUrl(c));
      });
      return Promise.all(jobs);
    }
    return Promise.all([
      resolveAvatarUrl(ctx.contact),
      resolveProfileAvatarUrl(ctx.profile)
    ]);
  }

  function prepareShell(contact) {
    store = global.miyaChatStore;
    ensureRoomRoot();
    resetRoomViewportLayout(false);
    roomOpenGen += 1;
    if (state.chatId) parkActiveChatPane();
    var app = $('miya-chat-app');
    if (app) app.classList.add('qq-room-open');
    state.chatId = null;
    state.avatars = {};
    state.quoteRef = null;
    state.narrationMode = false;
    state.multiSelectMode = false;
    state.multiSelectIds = null;
    roomEl.hidden = false;
    roomEl.classList.remove('qq-room--group');
    ensureToolbarFresh();
    toolbarOpen = false;
    syncToolbarPanel();
    closeEmojiPanel();
    blurComposeInput();
    renderQuoteBar();
    syncMultiSelectDom();
    roomEl.classList.add('is-open');
    roomEl.classList.toggle('qq-room--show-time', state.showTimestamps);
    roomEl.setAttribute('aria-hidden', 'false');
    var name = contact ? String(contact.name || contact.remark || '联系人').trim() || '联系人' : '…';
    var titleEl = $('qq-room-title');
    var statusEl = $('qq-room-head-status');
    var headAva = $('qq-room-head-ava');
    var headAvaWrap = headAva && headAva.parentElement;
    if (titleEl) titleEl.textContent = name;
    if (statusEl) statusEl.textContent = 'ONLINE';
    if (headAvaWrap) {
      headAvaWrap.classList.remove('qq-room__head-avatar--group');
      headAvaWrap.querySelectorAll('.mq-grp-head-stack').forEach(function (n) { n.remove(); });
    }
    if (headAva) {
      headAva.hidden = false;
      headAva.src = avatarFallback(name);
      headAva.alt = name;
    }
    showRoomLoading(true);
    scheduleRoomViewportReset('open');
  }

  function resumePendingChatImages(chatId) {
    var ig = global.MiyaImageGen;
    if (!ig || typeof ig.resumeChatImageGeneration !== 'function' || !chatId) return;
    ig.resumeChatImageGeneration(chatId).catch(function () {});
  }

  function open(chatId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    store = global.miyaChatStore;
    engine = global.miyaChatEngine;
    if (!store || !chatId) return Promise.resolve();
    ensureRoomRoot();
    purgeDetachedChatPanes();
    resetRoomViewportLayout(false);
    if (state.chatId && String(state.chatId) !== String(chatId)) {
      parkActiveChatPane();
    }
    var app = $('miya-chat-app');
    if (app) app.classList.add('qq-room-open');
    state.chatId = chatId;
    if (store.updateChat) {
      store.updateChat(chatId, { unread: 0 }).catch(function () {});
    }
    state.quoteRef = null;
    state.narrationMode = false;
    state.multiSelectMode = false;
    state.multiSelectIds = null;
    var openCtx = getChatContext(chatId);
    var cached = isChatPaneCached(chatId);
    var entry = roomChatPanes[String(chatId)];
    state.avatars = cached && entry ? Object.assign({}, entry.avatars) : {};
    roomEl.hidden = false;
    if (roomEl) roomEl.classList.toggle('qq-room--group', !!(openCtx && openCtx.isGroup));
    ensureToolbarFresh();
    toolbarOpen = false;
    syncToolbarPanel();
    closeEmojiPanel();
    blurComposeInput();
    renderQuoteBar();
    syncMultiSelectDom();
    bindScrollMemory();
    roomEl.classList.add('is-open');
    roomEl.classList.toggle('qq-room--show-time', state.showTimestamps);
    roomEl.setAttribute('aria-hidden', 'false');
    var titleEl = $('qq-room-title');
    var statusEl = $('qq-room-head-status');
    if (openCtx) {
      if (titleEl) titleEl.textContent = resolveDisplayName(openCtx);
      if (statusEl) statusEl.textContent = resolveHeaderStatus(openCtx);
    }
    syncKeyboardInset();
    scheduleRoomViewportReset('open');
    /* 先 quiet-pin，后续贴底跳过昂贵 scrollIntoView / 双回流 */
    armQuietPinBottom(1200);

    if (cached) {
      showRoomLoading(false);
      activateChatPane(chatId);
      hydrateHeader(chatId);
      syncChatPaneMessages(chatId);
      var scCached = $('qq-room-scroll');
      snapScrollToBottom(scCached);

      function refreshCachedIfNeeded() {
        if (String(state.chatId) !== String(chatId)) return;
        if (!(opts.forceRefresh || opts.toBottom || isChatPaneStale(chatId))) return;
        var paneEntryCheck = roomChatPanes[String(chatId)];
        var packCheck = getVisibleMessages(chatId);
        if (
          opts.forceRefresh ||
          isChatPaneStale(chatId) ||
          (paneEntryCheck && paneEntryCheck.msgCount !== packCheck.visible.length)
        ) {
          renderMessages(chatId, { stickBottom: true, toBottom: true, isFirstOpen: true });
          snapshotChatPane(chatId);
        }
        snapScrollToBottom(scCached);
      }

      /* 缓存命中：先亮壳+旧消息，重绘放到下一帧，避免挡住进房动画 */
      if (opts.forceRefresh || opts.toBottom || isChatPaneStale(chatId)) {
        afterNextPaint().then(refreshCachedIfNeeded).catch(function () {});
      }

      preloadAvatars(chatId, { keepCache: true }).then(function () {
        if (String(state.chatId) !== String(chatId)) return;
        hydrateHeader(chatId);
        patchBubbleAvatars(chatId);
        if (shouldQuietPinBottom()) snapScrollToBottom(scCached);
      }).catch(function () {});
      if (global.MiyaChatBeautify && global.MiyaChatBeautify.applyForChat) {
        afterNextPaint().then(function () {
          if (String(state.chatId) !== String(chatId)) return;
          return global.MiyaChatBeautify.applyForChat(chatId);
        }).then(function () {
          if (String(state.chatId) !== String(chatId)) return;
          if (shouldQuietPinBottom()) snapScrollToBottom($('qq-room-scroll'));
        }).catch(function () {});
      }
      resumePendingChatImages(chatId);
      return Promise.resolve();
    }

    /* 未缓存：短会话同步灌完；长会话先亮壳，消息放到下一帧，点击不卡死 */
    ensureChatPane(chatId);
    activateChatPane(chatId);
    var sc = resolveChatScrollEl(chatId);
    if (sc) sc.innerHTML = '';
    hydrateHeader(chatId);

    var gen = ++roomOpenGen;
    var earlyPack = getVisibleMessages(chatId);
    var lightOpen = (earlyPack.visible || []).length <= 16;
    if (!lightOpen) showRoomLoading(true);
    else showRoomLoading(false);

    function finishOpen() {
      if (gen !== roomOpenGen || String(state.chatId) !== String(chatId)) return;
      armQuietPinBottom(1200);
      renderMessages(chatId, { stickBottom: true, toBottom: true, isFirstOpen: true });
      snapScrollToBottom(sc);
      showRoomLoading(false);
      settleChatScrollBottom(sc, { isFirstOpen: true, gen: gen, chatId: chatId });
      snapshotChatPane(chatId);
      var paneEntry = roomChatPanes[String(chatId)];
      if (paneEntry) paneEntry.loaded = true;

      preloadAvatars(chatId).then(function () {
        if (gen !== roomOpenGen || String(state.chatId) !== String(chatId)) return;
        hydrateHeader(chatId);
        patchBubbleAvatars(chatId);
        snapshotChatPane(chatId);
        if (shouldQuietPinBottom()) snapScrollToBottom(sc);
      }).catch(function () {});
      resumePendingChatImages(chatId);
    }

    var openPaint;
    if (lightOpen) {
      try { finishOpen(); } catch (e) {}
      openPaint = Promise.resolve();
    } else {
      openPaint = afterNextPaint().then(finishOpen);
    }

    if (global.MiyaChatBeautify && global.MiyaChatBeautify.applyForChat) {
      openPaint.then(function () {
        if (String(state.chatId) !== String(chatId)) return;
        return global.MiyaChatBeautify.applyForChat(chatId);
      }).then(function () {
        if (String(state.chatId) !== String(chatId)) return;
        if (shouldQuietPinBottom()) snapScrollToBottom($('qq-room-scroll'));
      }).catch(function () {});
    }

    return openPaint.catch(function () {});
  }

  function close() {
    var closingChatId = state.chatId;
    var tts = global.MiyaChatVoiceTts;
    if (tts && typeof tts.stopPlayback === 'function') tts.stopPlayback();
    roomOpenGen += 1;
    groupRenderGen += 1;
    clearGroupPendingPrepend();
    showRoomLoading(false);
    parkActiveChatPane();
    roomPinBottomUntil = 0;
    cancelStaggerReveal();
    closeMsgMenu();
    exitMultiSelectMode();
    closeOverlay();
    dismissGroupRedPacketOpenLayers();
    closeThinkingPop();
    closeEmojiPanel();
    closeToolbarPanel();
    if (global.MiyaChatHeartVoice && typeof global.MiyaChatHeartVoice.close === 'function') {
      global.MiyaChatHeartVoice.close();
    }
    state.chatId = null;
    state.sending = false;
    stopTypingWait();
    state.quoteRef = null;
    renderQuoteBar();
    blurComposeInput();
    scheduleRoomViewportReset('close');
    if (roomEl) {
      roomEl.classList.remove('is-open', 'qq-room--booting');
      roomEl.hidden = true;
      roomEl.setAttribute('aria-hidden', 'true');
    }
    var app = $('miya-chat-app');
    if (app) app.classList.remove('qq-room-open');
    if (closingChatId && store && store.updateChat) {
      store.updateChat(closingChatId, { unread: 0 }).catch(function () {});
    }
    if (global.miyaChatApp && typeof global.miyaChatApp.flushPendingListRefresh === 'function') {
      global.miyaChatApp.flushPendingListRefresh();
    }
  }

  function refreshAllAvatars() {
    state.avatars = {};
    if (state.chatId) refresh({ forceAvatars: true });
  }

  function refresh(opts) {
    if (!state.chatId) return;
    opts = opts && typeof opts === 'object' ? opts : {};
    if (opts.forceAvatars && state.avatars) {
      state.avatars = {};
    }
    preloadAvatars(state.chatId, opts.keepAvatarCache ? { keepCache: true } : {}).then(function () {
      renderMessages(state.chatId, {
        toBottom: !!opts.toBottom,
        stickBottom: opts.toBottom !== false
      });
      hydrateHeader(state.chatId);
      if (global.MiyaChatBeautify && global.MiyaChatBeautify.applyForChat) {
        global.MiyaChatBeautify.applyForChat(state.chatId);
      }
      if (opts.focusInput) focusComposeInput();
    });
  }

  function getOpenChatId() { return state.chatId; }

  function patchMessageBubble(msgId) {
    var sc = $('qq-room-scroll');
    if (!sc || !state.chatId || !store || !msgId) return;
    var sid = String(msgId);
    var row = sc.querySelector('[data-msg-id="' + sid.replace(/"/g, '\\"') + '"]');
    if (!row) return;
    var pack = getVisibleMessages(state.chatId);
    var msgs = pack.visible;
    var idx = -1;
    for (var i = 0; i < msgs.length; i++) {
      if (String(msgs[i].id) === sid) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    var m = (typeof store.findMessage === 'function' && store.findMessage(state.chatId, sid)) || msgs[idx];
    var ctx = getChatContext(state.chatId);
    var roles = msgs.map(function (x) {
      return messageRoleKey(x, ctx);
    });
    var hvIndex = resolveHeartVoiceHighlightIndex(state.chatId, ctx);
    var tmp = document.createElement('div');
    tmp.innerHTML = bubbleHtml(m, ctx, computeRoundPos(roles, idx), undefined, hvIndex);
    var next = tmp.firstElementChild;
    if (!next) return;
    if (row.classList.contains('is-picked')) next.classList.add('is-picked');
    row.replaceWith(next);
    hydrateBubbleMedia(sc);
  }

  function renderMessagePreview(m, chatId) {
    if (!m) return '';
    return renderBubbleBody(m, { chatId: chatId, preview: true });
  }

  global.miyaChatRoom = {
    open: open,
    close: close,
    prepareShell: prepareShell,
    refresh: refresh,
    refreshAllAvatars: refreshAllAvatars,
    getOpenChatId: getOpenChatId,
    toast: toast,
    requestAiReply: requestAiReply,
    handleSend: handleSend,
    appendBubble: appendBubbleEl,
    revealAssistantMessages: revealAssistantMessages,
    patchMessageBubble: patchMessageBubble,
    restoreCompose: restoreComposeAfterOverlay,
    renderMessagePreview: renderMessagePreview,
    hydrateMessageMedia: hydrateBubbleMedia,
    resetViewportLayout: function () {
      resetRoomViewportLayout(true);
    }
  };
})(window);
