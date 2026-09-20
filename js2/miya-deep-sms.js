/**
 * miya-deep-sms.js — 深入 · 角色手机 短信界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var LOADING_MSG = '正在读取他的短信数据';

  var CATEGORY_LABELS = {
    personal: '私人',
    family: '家人',
    work: '工作',
    service: '服务',
    verify: '验证',
    spam: '垃圾',
    unknown: '其他'
  };

  var ROW_TONES = [
    'tone-pearl', 'tone-blush', 'tone-sage', 'tone-sky',
    'tone-sand', 'tone-lilac', 'tone-mint', 'tone-dust',
    'tone-rose', 'tone-cream', 'tone-mauve', 'tone-olive'
  ];

  var ROW_LAYOUTS = [
    'lay-rail', 'lay-offset', 'lay-wide', 'lay-narrow',
    'lay-peek', 'lay-stack', 'lay-float', 'lay-tight'
  ];

  var STYLE_ALIASES = {
    classic: 'lay-rail', offset: 'lay-offset', wide: 'lay-wide',
    narrow: 'lay-narrow', peek: 'lay-peek', stack: 'lay-stack',
    float: 'lay-float', tight: 'lay-tight'
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
    smsData: null,
    refreshing: false,
    view: 'list',
    activeThreadId: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function smsStore() { return global.miyaDeepSmsStore || null; }
  function smsBridge() { return global.miyaDeepSmsBridge || null; }

  function loadingMsg() {
    var br = smsBridge();
    return (br && br.LOADING_MSG) ? br.LOADING_MSG : LOADING_MSG;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-sms-toast');
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
    var text = $('dp-sms-status-text');
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
    var bar = $('dp-sms-status');
    var text = $('dp-sms-status-text');
    if (!bar || !text) return;
    var data = state.smsData;
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
      bar.className = 'dp-sms__ticker';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-sms__ticker' + (kind === 'success' ? ' is-success' : kind === 'error' ? ' is-error' : '');
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-sms-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.smsData && state.smsData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function updateCarrierSim() {
    var el = $('dp-sms-carrier-sim');
    if (!el) return;
    var name = state.contactName || 'ta';
    el.textContent = 'SIM · ' + name + ' 的本机';
  }

  function getActiveThread() {
    var threads = state.smsData && state.smsData.threads || [];
    if (!state.activeThreadId) return null;
    for (var i = 0; i < threads.length; i++) {
      if (threads[i].id === state.activeThreadId) return threads[i];
    }
    return null;
  }

  function countMessages() {
    var threads = state.smsData && state.smsData.threads || [];
    var total = 0;
    threads.forEach(function (t) { total += (t.messages || []).length; });
    return total;
  }

  function renderHeader() {
    var el = $('dp-sms-header');
    if (!el) return;
    var threads = state.smsData && state.smsData.threads || [];
    var msgCount = countMessages();
    var name = state.contactName || 'ta';
    el.innerHTML =
      '<div class="dp-sms__mast-row">' +
        '<h1 class="dp-sms__mast-title"><em>收信</em>台账</h1>' +
        '<div class="dp-sms__mast-stats">' +
          '<span class="dp-sms__mast-chip">' + (threads.length || '—') + ' 会话</span>' +
          '<span class="dp-sms__mast-chip">' + (msgCount || '—') + ' 条</span>' +
        '</div>' +
      '</div>' +
      '<p class="dp-sms__mast-desc">' +
        (msgCount
          ? name + ' 的运营商短信 · 按来源归档'
          : '点上方 ◎ 同步 · 读取 ' + name + ' 的短信') +
      '</p>';
  }

  function renderThreadRow(thread, index) {
    var tone = ROW_TONES[index % ROW_TONES.length];
    var catLabel = CATEGORY_LABELS[thread.category] || '其他';
    var idxLabel = (index + 1) < 10 ? '0' + (index + 1) : '' + (index + 1);
    var preview = thread.preview ? esc(thread.preview) : '';
    var timeLine = thread.lastTime ? esc(thread.lastTime) : '';
    var label = thread.senderLabel ? esc(thread.senderLabel) : '';
    var unreadDot = thread.unread > 0 ? '<span class="dp-sms__slip-unread" aria-label="未读"></span>' : '';

    return (
      '<button type="button" class="dp-sms__slip ' + tone + '" data-dp-sms-thread="' + esc(thread.id) + '">' +
        unreadDot +
        '<div class="dp-sms__slip-sheet">' +
          '<div class="dp-sms__slip-head">' +
            '<span class="dp-sms__slip-seq">' + idxLabel + '</span>' +
            '<div class="dp-sms__slip-main">' +
              '<div class="dp-sms__slip-title-row">' +
                '<h2 class="dp-sms__slip-name">' + esc(thread.sender) + '</h2>' +
                '<span class="dp-sms__slip-badge cat-' + esc(thread.category) + '">' + catLabel + '</span>' +
              '</div>' +
              (label ? '<span class="dp-sms__slip-num">' + label + '</span>' : '') +
            '</div>' +
            (timeLine ? '<time class="dp-sms__slip-time">' + timeLine + '</time>' : '') +
          '</div>' +
          (preview ? '<p class="dp-sms__slip-body">' + preview + '</p>' : '') +
        '</div>' +
      '</button>'
    );
  }

  function renderThreadList() {
    var list = $('dp-sms-list');
    var empty = $('dp-sms-empty');
    if (!list) return;

    var threads = state.smsData && state.smsData.threads || [];
    if (!threads.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = threads.map(renderThreadRow).join('');
  }

  function renderMessage(m, index) {
    var isOut = m.direction === 'out';
    var dirLabel = isOut ? 'OUT' : 'IN';
    var timeLine = m.time ? '<time class="dp-sms__line-time">' + esc(m.time) + '</time>' : '';

    return (
      '<article class="dp-sms__line ' + (isOut ? 'is-out' : 'is-in') + '">' +
        '<div class="dp-sms__line-meta">' +
          '<span class="dp-sms__line-tag">' + dirLabel + '</span>' +
          timeLine +
        '</div>' +
        '<p class="dp-sms__line-content">' + esc(m.content) + '</p>' +
      '</article>'
    );
  }

  function renderThreadDetail() {
    var el = $('dp-sms-detail');
    var listView = $('dp-sms-list-view');
    if (!el) return;

    var thread = getActiveThread();
    if (!thread) {
      state.view = 'list';
      state.activeThreadId = '';
      if (listView) listView.hidden = false;
      el.hidden = true;
      return;
    }

    var catLabel = CATEGORY_LABELS[thread.category] || '其他';
    var msgsHtml = (thread.messages || []).map(function (m, i) {
      return renderMessage(m, i);
    }).join('');

    el.innerHTML =
      '<header class="dp-sms__transcript-head">' +
        '<button type="button" class="dp-sms__transcript-back" id="dp-sms-detail-back">← 返回收信箱</button>' +
        '<h2 class="dp-sms__transcript-title">' + esc(thread.sender) + '</h2>' +
        '<span class="dp-sms__transcript-sub">' +
          catLabel +
          (thread.senderLabel ? ' · ' + esc(thread.senderLabel) : '') +
        '</span>' +
      '</header>' +
      '<div class="dp-sms__transcript-scroll" id="dp-sms-detail-scroll">' +
        '<div class="dp-sms__transcript-body">' + msgsHtml + '</div>' +
      '</div>';

    if (listView) listView.hidden = true;
    el.hidden = false;

    var backBtn = $('dp-sms-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        state.view = 'list';
        state.activeThreadId = '';
        renderView();
      });
    }

    var scroll = $('dp-sms-detail-scroll');
    if (scroll) {
      requestAnimationFrame(function () {
        scroll.scrollTop = scroll.scrollHeight;
      });
    }
  }

  function renderView() {
    var root = $('dp-sms');
    if (root) root.classList.toggle('is-detail', state.view === 'detail');

    if (state.view === 'detail') {
      renderThreadDetail();
    } else {
      var detail = $('dp-sms-detail');
      var listView = $('dp-sms-list-view');
      if (detail) { detail.hidden = true; detail.innerHTML = ''; }
      if (listView) listView.hidden = false;
      renderHeader();
      renderThreadList();
    }
    updateStatusBar();
    updateRefreshBtn();
    updateCarrierSim();
  }

  function renderAll() {
    renderView();
  }

  function loadSmsData(contactId) {
    var ss = smsStore();
    if (!ss) return Promise.resolve(null);
    return ss.getSms(contactId).then(function (data) {
      state.smsData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-sms-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ss = smsStore();
    var br = smsBridge();
    if (!ss || !br) return Promise.reject(new Error('模块未就绪'));

    var msg = loadingMsg();

    var job = ss.patchSms(contactId, {
      refreshStatus: 'loading',
      refreshMessage: msg,
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.smsData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateSms(contactId, phoneData, {
        onProgress: function (p) {
          var progressMsg = p && p.message ? p.message : msg;
          ss.patchSms(contactId, {
            refreshStatus: 'loading',
            refreshMessage: progressMsg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.smsData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ss.patchSms(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        threads: result.threads
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.smsData = saved;
        state.refreshing = false;
        state.view = 'list';
        state.activeThreadId = '';
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
      return ss.patchSms(contactId, {
        refreshStatus: 'error',
        refreshMessage: errMsg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.smsData = saved;
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
    if (state.refreshing || (state.smsData && state.smsData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function openThread(threadId) {
    state.activeThreadId = String(threadId || '');
    state.view = 'detail';
    renderView();
  }

  function bindEvents() {
    var root = $('dp-sms');
    if (!root || root._dpSmsBound) return;
    root._dpSmsBound = true;

    var back = $('dp-sms-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-sms-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    var listEl = $('dp-sms-list');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dp-sms-thread]');
        if (!btn) return;
        openThread(btn.getAttribute('data-dp-sms-thread'));
      });
    }

    global.addEventListener('miya-deep-sms-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadSmsData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-sms');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.view = 'list';
    state.activeThreadId = '';
    state.refreshing = !!activeJobs[state.contactId];

    updateCarrierSim();

    try {
      window.scrollTo(0, 0);
      if (typeof window.__miyaSetAppHeight === 'function') window.__miyaSetAppHeight(true);
    } catch (e) {}

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadSmsData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          smsStore().patchSms(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.smsData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-sms');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.open = false;
    state.view = 'list';
    state.activeThreadId = '';
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

  global.miyaDeepSms = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
