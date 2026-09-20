/**
 * miya-deep-wechat.js — 深入 · 角色手机 微信界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var LOADING_MSG = '正在读取他的微信';

  var ROW_TONES = [
    'tone-rose', 'tone-sage', 'tone-sand', 'tone-mauve',
    'tone-sky', 'tone-blush', 'tone-lilac'
  ];

  var ROW_LAYOUTS = [
    'lay-classic', 'lay-rail', 'lay-offset', 'lay-banner',
    'lay-loose', 'lay-compact', 'lay-peek'
  ];

  var STYLE_ALIASES = {
    line: 'lay-classic', offset: 'lay-offset', stack: 'lay-loose',
    split: 'lay-compact', tag: 'lay-banner', wide: 'lay-peek', narrow: 'lay-classic'
  };

  function resolveLayout(raw, index) {
    var key = String(raw || '').trim();
    if (STYLE_ALIASES[key]) key = STYLE_ALIASES[key];
    if (ROW_LAYOUTS.indexOf(key) >= 0) return key;
    return ROW_LAYOUTS[index % ROW_LAYOUTS.length];
  }

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    wechatData: null,
    refreshing: false,
    view: 'list',
    activeConvId: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function wechatStore() { return global.miyaDeepWechatStore || null; }
  function wechatBridge() { return global.miyaDeepWechatBridge || null; }

  function loadingMsg() {
    var br = wechatBridge();
    return (br && br.LOADING_MSG) ? br.LOADING_MSG : LOADING_MSG;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-wechat-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-wechat-status-text');
    if (!text) return;
    var base = String(baseText || loadingMsg());
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
    var bar = $('dp-wechat-status');
    var text = $('dp-wechat-status-text');
    if (!bar || !text) return;
    var data = state.wechatData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = loadingMsg();
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已读取完成';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-wechat__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-wechat__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-wechat-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.wechatData && state.wechatData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getActiveConversation() {
    var convs = state.wechatData && state.wechatData.conversations || [];
    if (!state.activeConvId) return null;
    for (var i = 0; i < convs.length; i++) {
      if (convs[i].id === state.activeConvId) return convs[i];
    }
    return null;
  }

  function isCharSender(sender, charName) {
    var s = String(sender || '').trim();
    var c = String(charName || state.contactName || '').trim();
    return s === c || s.indexOf(c) === 0;
  }

  function renderHeader() {
    var el = $('dp-wechat-header');
    if (!el) return;
    var count = state.wechatData && state.wechatData.conversations
      ? state.wechatData.conversations.length
      : 0;
    el.innerHTML =
      '<div class="dp-wechat__hero">' +
        '<div class="dp-wechat__hero-card">' +
          '<span class="dp-wechat__hero-stripe" aria-hidden="true"></span>' +
          '<div class="dp-wechat__hero-body">' +
            '<span class="dp-wechat__hero-kicker">INBOX · MESSAGE ARCHIVE</span>' +
            '<h1 class="dp-wechat__hero-title">微信</h1>' +
            '<p class="dp-wechat__hero-desc">' +
              (count ? count + ' 段对话 · ta 的私信索引' : '点击刷新 · 读取他的微信') +
            '</p>' +
          '</div>' +
          '<div class="dp-wechat__hero-badge">' +
            '<span class="dp-wechat__hero-badge-num">' + (count || '—') + '</span>' +
            '<span class="dp-wechat__hero-badge-label">threads</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderConvRow(conv, index) {
    var tone = ROW_TONES[index % ROW_TONES.length];
    var layout = resolveLayout(conv.style, index);
    var typeLabel = conv.type === 'group' ? '群聊' : (conv.isFileAssistant ? '助手' : '私聊');
    var timeLine = conv.lastTime ? esc(conv.lastTime) : '';
    var preview = conv.preview ? esc(conv.preview) : '';
    var count = conv.messages ? conv.messages.length : 0;
    var idxLabel = (index + 1) < 10 ? '0' + (index + 1) : '' + (index + 1);

    return (
      '<button type="button" class="dp-wechat__card ' + tone + ' ' + layout + '" data-dp-wechat-conv="' + esc(conv.id) + '">' +
        '<span class="dp-wechat__card-no" aria-hidden="true">' + idxLabel + '</span>' +
        '<div class="dp-wechat__card-inner">' +
          '<header class="dp-wechat__card-head">' +
            '<span class="dp-wechat__card-type">' + typeLabel + '</span>' +
            (timeLine ? '<time class="dp-wechat__card-time">' + timeLine + '</time>' : '') +
          '</header>' +
          '<h2 class="dp-wechat__card-name">' + esc(conv.title) + '</h2>' +
          (preview ? '<p class="dp-wechat__card-preview">' + preview + '</p>' : '') +
          '<footer class="dp-wechat__card-foot">' +
            '<span class="dp-wechat__card-count">' + count + ' 条</span>' +
            '<span class="dp-wechat__card-arrow" aria-hidden="true">→</span>' +
          '</footer>' +
        '</div>' +
      '</button>'
    );
  }

  function renderConvList() {
    var el = $('dp-wechat-list');
    var empty = $('dp-wechat-empty');
    if (!el) return;
    var convs = state.wechatData && state.wechatData.conversations || [];
    if (!convs.length) {
      el.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    el.innerHTML = '<div class="dp-wechat__feed">' +
      convs.map(function (c, i) { return renderConvRow(c, i); }).join('') +
    '</div>';
  }

  function renderMessage(msg, index, conv, charName) {
    var isSelf = isCharSender(msg.sender, charName);
    var side = isSelf ? 'is-self' : 'is-other';
    var isGroup = conv && conv.type === 'group';
    var timeHtml = msg.time
      ? '<time class="dp-wechat__bubble-time">' + esc(msg.time) + '</time>'
      : '';

    return (
      '<div class="dp-wechat__bubble-wrap ' + side + (isGroup && !isSelf ? ' is-group' : '') + '">' +
        '<span class="dp-wechat__bubble-name">' + esc(msg.sender) + '</span>' +
        '<div class="dp-wechat__bubble">' +
          '<p class="dp-wechat__bubble-text">' + esc(msg.content) + '</p>' +
        '</div>' +
        timeHtml +
      '</div>'
    );
  }

  function renderChatDetail() {
    var el = $('dp-wechat-detail');
    var listView = $('dp-wechat-list-view');
    if (!el) return;

    var conv = getActiveConversation();
    if (!conv) {
      state.view = 'list';
      state.activeConvId = '';
      if (listView) listView.hidden = false;
      el.hidden = true;
      return;
    }

    var charName = state.contactName || 'ta';
    var typeLabel = conv.type === 'group' ? '群聊' : (conv.isFileAssistant ? '文件传输助手' : '私聊');
    var msgsHtml = (conv.messages || []).map(function (m, i) {
      return renderMessage(m, i, conv, charName);
    }).join('');

    el.innerHTML =
      '<header class="dp-wechat__chat-head">' +
        '<button type="button" class="dp-wechat__ctrl dp-wechat__ctrl--back" id="dp-wechat-detail-back" aria-label="返回列表">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6L8 12l6.5 6"/></svg>' +
        '</button>' +
        '<div class="dp-wechat__chat-meta">' +
          '<span class="dp-wechat__chat-type">' + typeLabel + '</span>' +
          '<h2 class="dp-wechat__chat-title">' + esc(conv.title) + '</h2>' +
        '</div>' +
      '</header>' +
      '<div class="dp-wechat__chat-scroll" id="dp-wechat-detail-scroll">' +
        '<div class="dp-wechat__chat-body">' + msgsHtml + '</div>' +
      '</div>';

    if (listView) listView.hidden = true;
    el.hidden = false;

    var backBtn = $('dp-wechat-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        state.view = 'list';
        state.activeConvId = '';
        renderView();
      });
    }

    var scroll = $('dp-wechat-detail-scroll');
    if (scroll) {
      requestAnimationFrame(function () {
        scroll.scrollTop = scroll.scrollHeight;
      });
    }
  }

  function renderView() {
    var root = $('dp-wechat');
    if (root) root.classList.toggle('is-detail', state.view === 'detail');

    if (state.view === 'detail') {
      renderChatDetail();
    } else {
      var detail = $('dp-wechat-detail');
      var listView = $('dp-wechat-list-view');
      if (detail) { detail.hidden = true; detail.innerHTML = ''; }
      if (listView) listView.hidden = false;
      renderHeader();
      renderConvList();
    }
    updateStatusBar();
    updateRefreshBtn();
  }

  function renderAll() {
    renderView();
  }

  function loadWechatData(contactId) {
    var ws = wechatStore();
    if (!ws) return Promise.resolve(null);
    return ws.getWechat(contactId).then(function (data) {
      state.wechatData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-wechat-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ws = wechatStore();
    var br = wechatBridge();
    if (!ws || !br) return Promise.reject(new Error('模块未就绪'));

    var msg = loadingMsg();

    var job = ws.patchWechat(contactId, {
      refreshStatus: 'loading',
      refreshMessage: msg,
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.wechatData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateWechat(contactId, phoneData, {
        onProgress: function (p) {
          var progressMsg = p && p.message ? p.message : msg;
          ws.patchWechat(contactId, {
            refreshStatus: 'loading',
            refreshMessage: progressMsg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.wechatData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ws.patchWechat(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        conversations: result.conversations
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.wechatData = saved;
        state.refreshing = false;
        state.view = 'list';
        state.activeConvId = '';
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var errMsg = err && err.message ? err.message : '读取失败';
      return ws.patchWechat(contactId, {
        refreshStatus: 'error',
        refreshMessage: errMsg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.wechatData = saved;
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
    if (state.refreshing || (state.wechatData && state.wechatData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function openConversation(convId) {
    state.activeConvId = String(convId || '');
    state.view = 'detail';
    renderView();
  }

  function bindEvents() {
    var root = $('dp-wechat');
    if (!root || root._dpWechatBound) return;
    root._dpWechatBound = true;

    var back = $('dp-wechat-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-wechat-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    var listEl = $('dp-wechat-list');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dp-wechat-conv]');
        if (!btn) return;
        openConversation(btn.getAttribute('data-dp-wechat-conv'));
      });
    }

    global.addEventListener('miya-deep-wechat-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadWechatData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-wechat');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.view = 'list';
    state.activeConvId = '';
    state.refreshing = !!activeJobs[state.contactId];

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadWechatData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          wechatStore().patchWechat(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.wechatData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-wechat');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.open = false;
    state.view = 'list';
    state.activeConvId = '';
    layer.classList.remove('is-open');
    layer.classList.remove('is-detail');
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

  global.miyaDeepWechat = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
