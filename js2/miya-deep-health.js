/**
 * miya-deep-health.js — 深入 · 角色手机 健康界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var ICON_SVG = {
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    run: '<path d="M13 5a1 1 0 1 0-2 0v2H9.5a1 1 0 0 0-.8 1.6l1.5 2-2.2 3.3a1 1 0 0 0 .83 1.54H14a1 1 0 0 0 .8-.4l2.5-3.3 2.8 1.4a1 1 0 0 0 1.3-.5l1-2a1 1 0 0 0-.5-1.3l-3.2-1.6a1 1 0 0 0-1.1.2l-1.5 2-1.2-1.6H13V5z"/>',
    steps: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
    drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    screen: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    battery: '<rect width="16" height="10" x="2" y="7" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/>',
    lotus: '<path d="M12 10c-2-2.67-4-4-6-4a6 6 0 0 0 6 6 6 6 0 0 0 6-6c-2 0-4 1.33-6 4Z"/><path d="M12 14c-1.5-2-3-3-5-3a5 5 0 0 0 5 5 5 5 0 0 0 5-5c-2 0-3.5 1-5 3Z"/>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    veil: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12.5 12 15l2.5-2.5"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  var LAYOUT_SLOTS = [
    'slot-wide', 'slot-narrow', 'slot-tall', 'slot-offset-r',
    'slot-offset-l', 'slot-wide', 'slot-narrow', 'slot-tall',
    'slot-offset-r', 'slot-offset-l', 'slot-wide', 'slot-narrow',
    'slot-tall'
  ];

  var TONE_CLASSES = [
    'tone-sky', 'tone-sage', 'tone-blush', 'tone-sand',
    'tone-lilac', 'tone-mint', 'tone-rose', 'tone-cream',
    'tone-olive', 'tone-mauve', 'tone-dust', 'tone-pearl'
  ];

  var METRIC_TONES = {
    sleep: 'tone-lilac',
    exercise: 'tone-sage',
    steps: 'tone-sky',
    heartRate: 'tone-rose',
    activeEnergy: 'tone-sand',
    mood: 'tone-blush',
    hydration: 'tone-mint',
    screenTime: 'tone-dust',
    nutrition: 'tone-olive',
    recovery: 'tone-pearl',
    mindfulness: 'tone-mauve',
    socialEnergy: 'tone-cream',
    intimatePhysio: 'tone-blush'
  };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    healthData: null,
    refreshing: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function healthStore() { return global.miyaDeepHealthStore || null; }
  function healthBridge() { return global.miyaDeepHealthBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-health-toast');
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
    var text = $('dp-health-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的健康数据');
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
    var bar = $('dp-health-status');
    var text = $('dp-health-status-text');
    if (!bar || !text) return;
    var data = state.healthData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的健康数据';
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
      bar.className = 'dp-health__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-health__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-health-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.healthData && state.healthData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function renderIcon(iconKey) {
    var path = ICON_SVG[iconKey] || ICON_SVG.dot;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' + path + '</svg>';
  }

  function renderWeekBars(bars) {
    if (!Array.isArray(bars) || !bars.length) return '';
    var days = ['一', '二', '三', '四', '五', '六', '日'];
    var html = bars.map(function (val, i) {
      var h = Math.max(4, Math.min(100, Number(val) || 0));
      return (
        '<div class="dp-health__bar-col">' +
          '<div class="dp-health__bar-track"><span class="dp-health__bar-fill" style="height:' + h + '%"></span></div>' +
          '<span class="dp-health__bar-day">' + (days[i] || String(i + 1)) + '</span>' +
        '</div>'
      );
    }).join('');
    return '<div class="dp-health__bars">' + html + '</div>';
  }

  function renderSubItems(items) {
    if (!Array.isArray(items) || !items.length) return '';
    var html = items.map(function (si) {
      return (
        '<div class="dp-health__sub-item">' +
          '<span class="dp-health__sub-key">' + esc(si.key) + '</span>' +
          '<span class="dp-health__sub-val">' + esc(si.value) + '</span>' +
        '</div>'
      );
    }).join('');
    return '<div class="dp-health__sub-grid">' + html + '</div>';
  }

  function scoreRingClass(score) {
    var s = Number(score) || 0;
    if (s >= 80) return 'dp-health__ring--excellent';
    if (s >= 60) return 'dp-health__ring--good';
    if (s >= 40) return 'dp-health__ring--fair';
    return 'dp-health__ring--low';
  }

  function metricTone(metric, index) {
    var id = metric && metric.id;
    return METRIC_TONES[id] || TONE_CLASSES[index % TONE_CLASSES.length];
  }

  function renderScoreRing(score) {
    var s = Math.max(0, Math.min(100, Number(score) || 0));
    var dash = (s / 100) * 251.2;
    return (
      '<div class="dp-health__ring ' + scoreRingClass(s) + '" aria-label="综合健康分 ' + s + '">' +
        '<svg viewBox="0 0 88 88" class="dp-health__ring-svg">' +
          '<circle cx="44" cy="44" r="40" class="dp-health__ring-bg"/>' +
          '<circle cx="44" cy="44" r="40" class="dp-health__ring-fg" stroke-dasharray="' + dash + ' 251.2"/>' +
        '</svg>' +
        '<div class="dp-health__ring-center">' +
          '<span class="dp-health__ring-num">' + s + '</span>' +
          '<span class="dp-health__ring-label">综合</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderHero(health) {
    var el = $('dp-health-hero');
    if (!el) return;
    if (!health) {
      el.innerHTML =
        '<div class="dp-health__hero-stack">' +
          '<span class="dp-health__hero-tab" aria-hidden="true">HEALTH</span>' +
          '<div class="dp-health__hero-card">' +
            '<span class="dp-health__hero-kicker">ARCHIVE · WELLNESS</span>' +
            '<h1 class="dp-health__hero-title">健康档案</h1>' +
            '<p class="dp-health__hero-hint">点击右上角 ↻ 读取 ta 的健康数据</p>' +
          '</div>' +
        '</div>';
      return;
    }
    var trend = health.hero && health.hero.trend || 'stable';
    var trendIcon = trend === 'up' ? '↑' : (trend === 'down' ? '↓' : '→');
    el.innerHTML =
      '<div class="dp-health__hero-stack">' +
        '<span class="dp-health__hero-folder dp-health__hero-folder--back" aria-hidden="true"></span>' +
        '<span class="dp-health__hero-folder dp-health__hero-folder--mid" aria-hidden="true"></span>' +
        '<div class="dp-health__hero-card">' +
          '<span class="dp-health__hero-tab" aria-hidden="true">HEALTH</span>' +
          '<span class="dp-health__hero-stamp" aria-hidden="true">' + esc(health.dateLabel || '今日') + '</span>' +
          '<div class="dp-health__hero-row">' +
            '<div class="dp-health__hero-main">' +
              '<span class="dp-health__hero-kicker">ARCHIVE · WELLNESS</span>' +
              '<h1 class="dp-health__hero-title">健康</h1>' +
              (health.hero && health.hero.greeting
                ? '<p class="dp-health__hero-greeting">' + esc(health.hero.greeting) + '</p>'
                : '') +
              (health.hero && health.hero.status
                ? '<p class="dp-health__hero-status"><span class="dp-health__trend dp-health__trend--' + esc(trend) + '">' + trendIcon + '</span> ' + esc(health.hero.status) + '</p>'
                : '') +
            '</div>' +
            '<div class="dp-health__hero-side">' + renderScoreRing(health.overallScore) + '</div>' +
          '</div>' +
          (health.overallNote
            ? '<p class="dp-health__hero-note">' + esc(health.overallNote) + '</p>'
            : '') +
        '</div>' +
      '</div>';
  }

  function renderMetricCard(metric, index) {
    var slot = LAYOUT_SLOTS[index % LAYOUT_SLOTS.length];
    var tone = metricTone(metric, index);
    var valueLine = metric.value
      ? '<span class="dp-health__metric-value">' + esc(metric.value) + (metric.unit ? '<small>' + esc(metric.unit) + '</small>' : '') + '</span>'
      : '';
    var labelLine = metric.label
      ? '<span class="dp-health__metric-label">' + esc(metric.label) + '</span>'
      : '';
    return (
      '<article class="dp-health__metric ' + slot + ' ' + tone + '" data-metric-id="' + esc(metric.id) + '">' +
        '<div class="dp-health__metric-head">' +
          '<span class="dp-health__metric-icon">' + renderIcon(metric.icon) + '</span>' +
          '<div class="dp-health__metric-title-wrap">' +
            '<h3 class="dp-health__metric-name">' + esc(metric.name) + '</h3>' +
            '<span class="dp-health__metric-score">' + (metric.score || 0) + '<small>分</small></span>' +
          '</div>' +
        '</div>' +
        '<div class="dp-health__metric-main">' + valueLine + labelLine + '</div>' +
        (metric.detail ? '<p class="dp-health__metric-detail">' + esc(metric.detail) + '</p>' : '') +
        renderSubItems(metric.subItems) +
        renderWeekBars(metric.weekBars) +
        (metric.note ? '<p class="dp-health__metric-note">「' + esc(metric.note) + '」</p>' : '') +
        '<span class="dp-health__metric-corner" aria-hidden="true"></span>' +
      '</article>'
    );
  }

  function renderMetrics(health) {
    var el = $('dp-health-metrics');
    var empty = $('dp-health-empty');
    if (!el) return;
    var metrics = health && health.metrics || [];
    if (!metrics.length) {
      el.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    el.innerHTML = '<div class="dp-health__collage">' + metrics.map(renderMetricCard).join('') + '</div>';
  }

  function renderHighlights(health) {
    var el = $('dp-health-highlights');
    if (!el) return;
    var items = health && health.highlights || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var html = items.map(function (h, i) {
      return (
        '<div class="dp-health__highlight" style="--hl-i:' + i + '">' +
          '<time class="dp-health__highlight-time">' + esc(h.time || '') + '</time>' +
          (h.metric ? '<span class="dp-health__highlight-metric">' + esc(h.metric) + '</span>' : '') +
          '<p class="dp-health__highlight-text">' + esc(h.text) + '</p>' +
        '</div>'
      );
    }).join('');
    el.innerHTML =
      '<div class="dp-health__section-head">' +
        '<span class="dp-health__section-kicker">TIMELINE</span>' +
        '<h2 class="dp-health__section-title">今日轨迹</h2>' +
      '</div>' +
      '<div class="dp-health__highlight-list">' + html + '</div>';
  }

  function renderInsights(health) {
    var el = $('dp-health-insights');
    if (!el) return;
    var items = health && health.insights || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var html = items.map(function (ins, i) {
      return (
        '<div class="dp-health__insight" style="--ins-i:' + i + '">' +
          (ins.title ? '<h4 class="dp-health__insight-title">' + esc(ins.title) + '</h4>' : '') +
          '<p class="dp-health__insight-text">' + esc(ins.text) + '</p>' +
        '</div>'
      );
    }).join('');
    el.innerHTML =
      '<div class="dp-health__section-head">' +
        '<span class="dp-health__section-kicker">INSIGHT</span>' +
        '<h2 class="dp-health__section-title">健康洞察</h2>' +
      '</div>' +
      '<div class="dp-health__insight-list">' + html + '</div>';
  }

  function renderFooter(health) {
    var el = $('dp-health-footer');
    if (!el) return;
    if (!health || !health.footerNote) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-health__footer-card">' +
        '<span class="dp-health__footer-mark" aria-hidden="true">—</span>' +
        '<p class="dp-health__footer-note">' + esc(health.footerNote) + '</p>' +
      '</div>';
  }

  function renderAll() {
    var health = state.healthData && state.healthData.health;
    renderHero(health);
    renderMetrics(health);
    renderHighlights(health);
    renderInsights(health);
    renderFooter(health);
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadHealthData(contactId) {
    var hs = healthStore();
    if (!hs) return Promise.resolve(null);
    return hs.getHealth(contactId).then(function (data) {
      state.healthData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-health-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var hs = healthStore();
    var br = healthBridge();
    if (!hs || !br) return Promise.reject(new Error('模块未就绪'));

    var job = hs.patchHealth(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的健康数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.healthData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateHealth(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的健康数据';
          hs.patchHealth(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.healthData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return hs.patchHealth(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        health: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.healthData = saved;
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
      return hs.patchHealth(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.healthData = saved;
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
    if (state.refreshing || (state.healthData && state.healthData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function bindEvents() {
    var root = $('dp-health');
    if (!root || root._dpHealthBound) return;
    root._dpHealthBound = true;

    var back = $('dp-health-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-health-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    global.addEventListener('miya-deep-health-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadHealthData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-health');
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

    loadHealthData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          healthStore().patchHealth(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.healthData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-health');
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

  global.miyaDeepHealth = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
