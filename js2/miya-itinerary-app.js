/**
 * miya-itinerary-app.js — 行程轨迹
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: 'roster',
    selectedContactId: '',
    selectedDayIndex: 0,
    generatingContactId: '',
    batchRunning: false
  };

  var batchState = {
    active: false,
    done: 0,
    total: 0,
    status: 'idle'
  };

  var toastTimer = 0;
  var doneBannerTimer = 0;

  var PERIOD_LABELS = {
    dawn: '晨曦', morning: '上午', noon: '午间', afternoon: '午后',
    evening: '傍晚', night: '夜晚', midnight: '深夜'
  };

  function store() { return global.miyaItineraryStore || null; }
  function bridge() { return global.miyaItineraryBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('it-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2600);
  }

  function showLoading(text) {
    var el = $('it-loading');
    var tx = $('it-loading-text');
    if (el) el.hidden = false;
    if (tx) tx.textContent = text || '生成中…';
  }

  function hideLoading() {
    var el = $('it-loading');
    if (el) el.hidden = true;
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    return cs.getContacts().find(function (c) { return c && c.id === id; }) || null;
  }

  function chronicleAvatar(contact) {
    var cts = global.miyaContactsStore;
    if (!cts || !contact) return '';
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    if (!roleId || typeof cts.findCharacter !== 'function') return '';
    var ch = cts.findCharacter(roleId);
    return ch && ch.avatar ? String(ch.avatar).trim() : '';
  }

  function resolveAvatarUrl(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    var direct = String(contact.avatar || '').trim();
    if (direct) return Promise.resolve(direct);
    var blobId = String(contact.avatarBlobId || '').trim();
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) {
          return url || chronicleAvatar(contact) || '';
        }).catch(function () {
          return chronicleAvatar(contact) || '';
        });
      }
    }
    var chAv = chronicleAvatar(contact);
    return Promise.resolve(chAv || '');
  }

  function avatarPlaceholderHtml(contact, cls) {
    cls = cls || 'it-card__ava';
    var ch = String(contact && contact.name || '?').charAt(0);
    return '<div class="' + cls + ' ' + cls + '--ph" data-it-ava-id="' + esc(contact.id) + '">' + esc(ch) + '</div>';
  }

  function avatarWrapHtml(contact) {
    return '<div class="it-card__ava-wrap" data-it-ava-wrap="' + esc(contact.id) + '">' +
      avatarPlaceholderHtml(contact, 'it-card__ava') + '</div>';
  }

  function setAvatarInto(el, url, contact, phCls) {
    if (!el) return;
    phCls = phCls || 'it-card__ava';
    var isDetail = phCls === 'it-detail-head__ava';
    if (url) {
      if (isDetail) {
        el.classList.remove('it-detail-head__ava--ph');
        el.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
      } else {
        el.innerHTML = '<img class="' + phCls + '" src="' + esc(url) + '" alt="" loading="lazy">';
      }
      return;
    }
    if (isDetail) {
      el.classList.add('it-detail-head__ava--ph');
      el.textContent = String(contact && contact.name || '?').charAt(0);
      return;
    }
    el.innerHTML = avatarPlaceholderHtml(contact, phCls);
  }

  function hydrateAvatarEl(wrapEl, contact, phCls) {
    if (!wrapEl || !contact) return;
    resolveAvatarUrl(contact).then(function (url) {
      setAvatarInto(wrapEl, url, contact, phCls);
    });
  }

  function hydrateAllAvatars() {
    document.querySelectorAll('[data-it-ava-wrap]').forEach(function (wrap) {
      var id = wrap.getAttribute('data-it-ava-wrap');
      hydrateAvatarEl(wrap, getContact(id), 'it-card__ava');
    });
    document.querySelectorAll('.it-pick-item__ring[data-it-pick-ava]').forEach(function (ring) {
      var id = ring.getAttribute('data-it-pick-ava');
      var contact = getContact(id);
      if (!contact) return;
      resolveAvatarUrl(contact).then(function (url) {
        if (url) {
          ring.innerHTML = '<span class="it-pick-item__ava"><img src="' + esc(url) + '" alt="" loading="lazy"></span>';
        } else {
          var ch = String(contact.name || '?').charAt(0);
          ring.innerHTML = '<span class="it-pick-item__ava it-pick-item__ava--ph">' + esc(ch) + '</span>';
        }
      });
    });
    var detailAva = $('it-detail-ava');
    var contact = getContact(state.selectedContactId);
    if (detailAva && contact) {
      hydrateAvatarEl(detailAva, contact, 'it-detail-head__ava');
    }
  }

  function isContactGenerating(contactId) {
    return !!contactId && state.generatingContactId === contactId;
  }

  function withGenerationTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('生成超时，行程内容较多请稍后重试'));
      }, ms);
      promise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  function contactStatus(contact) {
    var st = store();
    if (!st) return 'empty';
    if (!st.isEnabled(contact.id)) return 'disabled';
    if (isContactGenerating(contact.id)) return 'generating';
    var sch = st.getSchedule(contact.id);
    if (!sch) return 'empty';
    if (st.isScheduleExpired(sch)) return 'expired';
    return 'active';
  }

  function statusLabel(status) {
    if (status === 'active') return '进行中';
    if (status === 'expired') return '已过期';
    if (status === 'generating') return '生成中';
    if (status === 'empty') return '未生成';
    return '';
  }

  function updateHomeStatus() {
    var el = $('itinerary-home-status');
    var tx = $('itinerary-home-status-text');
    if (!el || !tx) return;
    if (!batchState.active && batchState.status !== 'done') {
      el.hidden = true;
      el.classList.remove('is-visible', 'is-done');
      return;
    }
    el.hidden = false;
    if (batchState.status === 'generating') {
      tx.textContent = '正在更新角色行程 ' + batchState.done + '/' + batchState.total;
      el.classList.add('is-visible');
      el.classList.remove('is-done');
    } else if (batchState.status === 'done') {
      tx.textContent = '行程更新完毕';
      el.classList.add('is-visible', 'is-done');
      clearTimeout(doneBannerTimer);
      doneBannerTimer = setTimeout(function () {
        batchState.status = 'idle';
        el.classList.remove('is-visible', 'is-done');
        setTimeout(function () { el.hidden = true; }, 400);
      }, 3200);
    }
  }

  function emitProgress() {
    updateHomeStatus();
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('miya-itinerary-progress', { detail: Object.assign({}, batchState) }));
      } catch (e) {}
    }
  }

  function generateForContact(contact, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var br = bridge();
    var st = store();
    if (!br || !st || !contact) return Promise.reject(new Error('模块未就绪'));
    if (isContactGenerating(contact.id)) return Promise.reject(new Error('该角色正在生成中'));
    var profile = br.getProfileForContact(contact);
    state.generatingContactId = contact.id;
    if (!opts.silent) showLoading('正在生成「' + (contact.name || '角色') + '」的一周行程…');
    renderRoster();
    return withGenerationTimeout(br.generateWeekSchedule(contact, profile), 300000).then(function (schedule) {
      st.saveSchedule(contact.id, schedule);
      return schedule;
    }).catch(function (err) {
      if (typeof st.markGenerateFail === 'function') st.markGenerateFail(contact.id);
      return Promise.reject(err);
    }).finally(function () {
      if (state.generatingContactId === contact.id) state.generatingContactId = '';
      if (!opts.silent) hideLoading();
      renderAll();
    });
  }

  function runBatchGenerate(contacts) {
    if (!contacts || !contacts.length || state.batchRunning) return Promise.resolve();
    state.batchRunning = true;
    batchState.active = true;
    batchState.done = 0;
    batchState.total = contacts.length;
    batchState.status = 'generating';
    emitProgress();

    var chain = Promise.resolve();
    contacts.forEach(function (contact) {
      chain = chain.then(function () {
        return generateForContact(contact, { silent: true }).then(function () {
          batchState.done += 1;
          emitProgress();
          renderRoster();
        }).catch(function (err) {
          console.warn('[itinerary] generate failed:', contact && contact.name, err);
          batchState.done += 1;
          emitProgress();
        });
      });
    });

    return chain.finally(function () {
      state.batchRunning = false;
      batchState.active = false;
      batchState.status = 'done';
      emitProgress();
      hideLoading();
      renderAll();
    });
  }

  function checkAutoGenerate() {
    var st = store();
    if (!st || !st.getSettings().autoGenerate) return;
    var expired = st.getExpiredEnabledContacts();
    if (!expired.length) return;
    runBatchGenerate(expired);
  }

  function renderSettingsBar() {
    var st = store();
    var toggle = $('it-auto-toggle');
    if (!toggle || !st) return;
    var on = st.getSettings().autoGenerate;
    toggle.classList.toggle('is-on', on);
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    var countEl = $('it-pick-count');
    if (countEl) {
      var n = st.getEnabledContactIds().length;
      countEl.textContent = n + ' 已选';
    }
  }

  function renderPickGrid() {
    var st = store();
    var gridEl = $('it-pick-grid');
    if (!gridEl || !st) return;
    var rows = st.getAllContactRows();
    if (!rows.length) {
      gridEl.innerHTML = '<p class="it-pick-empty">暂无联系人 · 请先在聊天中添加角色</p>';
      return;
    }
    gridEl.innerHTML = rows.map(function (contact) {
      var on = st.isEnabled(contact.id);
      var ch = String(contact.name || '?').charAt(0);
      return (
        '<button type="button" class="it-pick-item' + (on ? ' is-on' : '') + '" data-it-pick="' + esc(contact.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="it-pick-item__ring" data-it-pick-ava="' + esc(contact.id) + '">' +
            '<span class="it-pick-item__ava it-pick-item__ava--ph">' + esc(ch) + '</span>' +
          '</span>' +
          '<span class="it-pick-item__check" aria-hidden="true">✓</span>' +
          '<span class="it-pick-item__name">' + esc(contact.name || '未命名') + '</span>' +
        '</button>'
      );
    }).join('');
    hydrateAllAvatars();
  }

  function renderRoster() {
    var st = store();
    var listEl = $('it-roster-list');
    var countEl = $('it-roster-count');
    if (!listEl || !st) return;
    var rows = st.getAllContactRows().filter(function (c) { return st.isEnabled(c.id); });
    if (countEl) countEl.textContent = String(rows.length).padStart(2, '0') + ' TRACKING';
    if (!rows.length) {
      listEl.innerHTML =
        '<div class="it-empty">' +
          '<p class="it-empty__script">Select</p>' +
          '<p class="it-empty__title">尚未选择角色</p>' +
          '<p class="it-empty__hint">请在上方勾选需要追踪行程的角色</p>' +
        '</div>';
      return;
    }
    listEl.innerHTML = rows.map(function (contact) {
      var status = contactStatus(contact);
      var enabled = st.isEnabled(contact.id);
      var sch = st.getSchedule(contact.id);
      var meta = '';
      if (sch && status === 'active') {
        meta = sch.weekStart + ' — ' + sch.weekEnd;
        if (sch.weekTheme) meta += ' · ' + sch.weekTheme;
      } else if (status === 'expired') {
        meta = '行程已过期，等待更新';
      } else if (status === 'empty' && enabled) {
        meta = '已开启，等待首次生成';
      } else if (!enabled) {
        meta = '未开启行程追踪';
      }
      return (
        '<article class="it-card" data-it-contact="' + esc(contact.id) + '">' +
          avatarWrapHtml(contact) +
          '<div class="it-card__info">' +
            '<p class="it-card__name">' + esc(contact.name || '未命名') + '</p>' +
            '<p class="it-card__meta">' + esc(meta) + '</p>' +
          '</div>' +
          (status !== 'disabled'
            ? '<span class="it-card__status it-card__status--' + esc(status) + '">' + esc(statusLabel(status)) + '</span>'
            : '') +
        '</article>'
      );
    }).join('');
    hydrateAllAvatars();
  }

  function renderDetail() {
    var st = store();
    var contact = getContact(state.selectedContactId);
    var nameEl = $('it-detail-name');
    var themeEl = $('it-detail-theme');
    var rangeEl = $('it-detail-range');
    var tabsEl = $('it-day-tabs');
    var timelineEl = $('it-timeline');
    var introEl = $('it-day-intro');
    if (!contact || !st) return;

    var sch = st.getSchedule(contact.id);
    if (nameEl) nameEl.textContent = contact.name || '未命名';
    if (themeEl) themeEl.textContent = sch && sch.weekTheme ? sch.weekTheme : '—';
    if (rangeEl) {
      rangeEl.textContent = sch
        ? 'VOL. ' + sch.weekStart.replace(/-/g, '.') + ' — ' + sch.weekEnd.replace(/-/g, '.')
        : '';
    }

    var detailAva = $('it-detail-ava');
    if (detailAva && contact) {
      setAvatarInto(detailAva, '', contact, 'it-detail-head__ava');
      hydrateAvatarEl(detailAva, contact, 'it-detail-head__ava');
    }

    var regenBtn = $('it-regen-btn');
    if (regenBtn) regenBtn.disabled = isContactGenerating(contact.id);

    if (!sch || !sch.days || !sch.days.length) {
      if (tabsEl) tabsEl.innerHTML = '';
      if (timelineEl) {
        timelineEl.innerHTML =
          '<div class="it-empty">' +
            '<p class="it-empty__script">Await</p>' +
            '<p class="it-empty__title">尚无行程</p>' +
            '<p class="it-empty__hint">点击下方按钮，生成该角色的一周私人行程</p>' +
          '</div>';
      }
      if (introEl) introEl.innerHTML = '';
      return;
    }

    if (state.selectedDayIndex >= sch.days.length) state.selectedDayIndex = 0;

    if (tabsEl) {
      tabsEl.innerHTML = sch.days.map(function (day, i) {
        var d = store().parseIso(day.dateLabel);
        var num = d ? d.getDate() : i + 1;
        return (
          '<button type="button" class="it-day-tab' + (i === state.selectedDayIndex ? ' is-active' : '') + '" data-it-day="' + i + '">' +
            '<span class="it-day-tab__dow">' + esc(day.weekday || '') + '</span>' +
            '<span class="it-day-tab__num">' + num + '</span>' +
          '</button>'
        );
      }).join('');
    }

    var day = sch.days[state.selectedDayIndex];
    if (introEl) {
      introEl.innerHTML =
        (day.dayMood ? '<p class="it-day-intro__mood">' + esc(day.dayMood) + '</p>' : '') +
        (day.dayTheme ? '<p class="it-day-intro__theme">' + esc(day.dayTheme) + '</p>' : '');
    }

    if (timelineEl && day && day.slots) {
      timelineEl.innerHTML = day.slots.map(function (slot) {
        var period = PERIOD_LABELS[slot.period] || slot.period || '';
        return (
          '<article class="it-slot' + (slot.involvesUser ? ' it-slot--user' : '') + '">' +
            '<span class="it-slot__dot" aria-hidden="true"></span>' +
            '<div class="it-slot__time">' +
              '<span class="it-slot__start">' + esc(slot.timeStart || '') + '</span>' +
              (slot.timeEnd ? '<span class="it-slot__end">' + esc(slot.timeEnd) + '</span>' : '') +
            '</div>' +
            '<div class="it-slot__body">' +
              (period ? '<div class="it-slot__period">' + esc(period) + '</div>' : '') +
              '<h4 class="it-slot__title">' + esc(slot.title || slot.activity || '') + '</h4>' +
              (slot.location ? '<p class="it-slot__loc">' + esc(slot.location) + '</p>' : '') +
              (slot.detail ? '<p class="it-slot__detail">' + esc(slot.detail) + '</p>' : '') +
              (slot.innerNote ? '<p class="it-slot__note">' + esc(slot.innerNote) + '</p>' : '') +
              (slot.involvesUser ? '<span class="it-slot__tag">WITH YOU</span>' : '') +
            '</div>' +
          '</article>'
        );
      }).join('');
    }
  }

  function setView(view) {
    state.view = view;
    var app = $('miya-itinerary-app');
    if (app) app.classList.toggle('is-detail', view === 'detail');
    document.querySelectorAll('.it-page').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-it-page') === view);
    });
  }

  function openDetail(contactId) {
    state.selectedContactId = contactId;
    state.selectedDayIndex = 0;
    setView('detail');
    renderDetail();
  }

  function renderAll() {
    renderSettingsBar();
    renderPickGrid();
    renderRoster();
    if (state.view === 'detail') renderDetail();
    var issueEl = $('it-issue-no');
    if (issueEl) {
      var d = new Date();
      issueEl.textContent = '№ ' + d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0');
    }
  }

  function bindEvents() {
    var back = $('it-back');
    if (back) back.addEventListener('click', closeItineraryApp);

    var autoToggle = $('it-auto-toggle');
    if (autoToggle) {
      autoToggle.addEventListener('click', function () {
        var st = store();
        if (!st) return;
        var next = !st.getSettings().autoGenerate;
        if (next && !st.getEnabledContactIds().length) {
          toast('请先在下方勾选要追踪的角色');
          return;
        }
        st.setAutoGenerate(next);
        renderSettingsBar();
        toast(next ? '已开启自动生成' : '已关闭自动生成');
        if (next) checkAutoGenerate();
      });
    }

    var pickGrid = $('it-pick-grid');
    if (pickGrid) {
      pickGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-it-pick]');
        if (!btn) return;
        var id = btn.getAttribute('data-it-pick');
        var st = store();
        if (!st || !id) return;
        var next = !st.isEnabled(id);
        st.setEnabled(id, next);
        renderSettingsBar();
        renderPickGrid();
        renderRoster();
        if (next && st.getSettings().autoGenerate) {
          var contact = getContact(id);
          var sch = st.getSchedule(id);
          if (contact && (!sch || st.isScheduleExpired(sch)) && !state.batchRunning && !isContactGenerating(id)) {
            generateForContact(contact).catch(function (err) {
              toast(err && err.message ? err.message : '生成失败');
            });
          }
        }
        toast(next ? '已加入追踪' : '已取消追踪');
      });
    }

    var rosterList = $('it-roster-list');
    if (rosterList) {
      rosterList.addEventListener('click', function (e) {
        var card = e.target.closest('[data-it-contact]');
        if (card) openDetail(card.getAttribute('data-it-contact'));
      });
    }

    var detailBack = $('it-detail-back');
    if (detailBack) detailBack.addEventListener('click', function () {
      setView('roster');
    });

    var regenBtn = $('it-regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', function () {
        var contact = getContact(state.selectedContactId);
        if (!contact || isContactGenerating(contact.id)) return;
        generateForContact(contact).catch(function (err) {
          toast(err && err.message ? err.message : '生成失败');
        });
      });
    }

    var dayTabs = $('it-day-tabs');
    if (dayTabs) {
      dayTabs.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-it-day]');
        if (!tab) return;
        state.selectedDayIndex = parseInt(tab.getAttribute('data-it-day'), 10) || 0;
        renderDetail();
      });
    }
  }

  function openItineraryApp() {
    var el = $('miya-itinerary-app');
    if (!el) return;
    var chain = Promise.resolve();
    var cs = chatStore();
    if (cs && cs.init) chain = chain.then(function () { return cs.init(); });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () { return cts.whenReady(); });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      state.view = 'roster';
      state.selectedContactId = '';
      setView('roster');
      requestAnimationFrame(function () { renderAll(); });
    });
  }

  function closeItineraryApp() {
    var el = $('miya-itinerary-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('#miya-music-app.is-open') &&
        !document.querySelector('#miya-chat-app.is-open') &&
        !document.querySelector('#miya-memory-app.is-open') &&
        !document.querySelector('#miya-offline-app.is-open') &&
        !document.querySelector('#miya-typewriter-app.is-open') &&
        !document.querySelector('#miya-forum-app.is-open') &&
        !document.querySelector('.miya-cstore-app.is-open') &&
        !document.querySelector('.miya-itinerary-app.is-open') &&
        !document.querySelector('.miya-couple-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  bindEvents();

  function initWhenReady() {
    var cs = chatStore();
    var chain = Promise.resolve();
    if (cs && cs.init) chain = chain.then(function () { return cs.init(); });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () { return cts.whenReady(); });
    chain.then(function () {
      setTimeout(checkAutoGenerate, 800);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady);
  } else {
    initWhenReady();
  }

  global.miyaItineraryApp = {
    open: openItineraryApp,
    close: closeItineraryApp,
    checkAutoGenerate: checkAutoGenerate,
    runBatchGenerate: runBatchGenerate,
    getBatchState: function () { return Object.assign({}, batchState); }
  };
})(typeof window !== 'undefined' ? window : global);
