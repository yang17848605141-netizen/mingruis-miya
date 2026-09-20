/**
 * miya-couple-checkin.js — 打卡摄像机 · UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    contactId: '',
    selectedDate: '',
    calYear: 0,
    calMonth: 0,
    busy: false,
    composeFiles: []
  };

  function store() { return global.miyaCoupleStore || null; }
  function bridge() { return global.miyaCoupleCheckinBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
      global.miyaCoupleApp.toast(msg);
      return;
    }
    var el = $('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function todayIso() {
    var st = store();
    return st && st.isoToday ? st.isoToday() : isoLocal();
  }

  function isoLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function parseIso(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return new Date();
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDisplayDate(iso) {
    var d = parseIso(iso);
    var wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + wd;
  }

  function formatCheckInTime(ci) {
    if (!ci) return '';
    if (ci.timeAt) return String(ci.timeAt).trim();
    var d = new Date(ci.checkInAt || ci.createdAt || Date.now());
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    return (cs.getContacts() || []).find(function (c) { return c && c.id === id; }) || null;
  }

  function getSpaceNames(contactId) {
    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    var contact = getContact(contactId);
    var cs = chatStore();
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (!profile && cs && cs.getActiveProfile) profile = cs.getActiveProfile();
    return {
      profileName: profile && profile.name ? String(profile.name).trim() : (sp && sp.profileName ? sp.profileName : '我'),
      charName: contact && contact.name ? String(contact.name).trim() : (sp && sp.charName ? sp.charName : 'TA')
    };
  }

  function blobUrl(blobId) {
    var cs = chatStore();
    if (!cs || !blobId) return Promise.resolve('');
    if (typeof cs.getCachedBlobUrl === 'function') {
      var cached = cs.getCachedBlobUrl(blobId);
      if (cached) return Promise.resolve(cached);
    }
    if (typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(blobId).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function setLoading(show, text) {
    var el = $('cp-checkin-loading');
    var tx = $('cp-checkin-loading-text');
    if (el) el.hidden = !show;
    if (tx && text) tx.textContent = text;
    state.busy = !!show;
    var genBtn = $('cp-checkin-generate');
    var userBtn = $('cp-checkin-user-btn');
    if (genBtn) genBtn.disabled = !!show;
    if (userBtn) userBtn.disabled = !!show;
  }

  function setViewVisible(show) {
    var view = $('cp-view-checkin');
    var app = $('miya-couple-app');
    if (view) view.hidden = !show;
    if (app) app.classList.toggle('is-checkin', !!show);
  }

  function open(contactId) {
    if (!contactId) return;
    state.contactId = contactId;
    var now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth() + 1;
    state.selectedDate = todayIso();
    setViewVisible(true);
    renderAll();
  }

  function close() {
    var cid = state.contactId;
    setViewVisible(false);
    state.contactId = '';
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderCheckinSpotlight === 'function') {
      global.miyaCoupleApp.renderCheckinSpotlight(cid);
    }
  }

  function renderHeader() {
    var names = getSpaceNames(state.contactId);
    var titleEl = $('cp-checkin-title-sub');
    if (titleEl) {
      titleEl.textContent = names.charName + ' 的日常报备';
    }
  }

  function renderCalendar() {
    var grid = $('cp-checkin-cal-grid');
    var label = $('cp-checkin-cal-label');
    if (!grid) return;

    var y = state.calYear;
    var m = state.calMonth;
    if (label) label.textContent = y + '年' + m + '月';

    var st = store();
    var marked = st && st.getCheckInDatesInMonth
      ? st.getCheckInDatesInMonth(state.contactId, y, m)
      : [];
    var markSet = {};
    marked.forEach(function (d) { markSet[d] = true; });

    var first = new Date(y, m - 1, 1);
    var startWd = first.getDay();
    var daysInMonth = new Date(y, m, 0).getDate();
    var today = todayIso();

    var html = '';
    var wdLabels = ['日', '一', '二', '三', '四', '五', '六'];
    wdLabels.forEach(function (w) {
      html += '<div class="cp-ci-cal-wd">' + w + '</div>';
    });

    var i;
    for (i = 0; i < startWd; i++) {
      html += '<div class="cp-ci-cal-day is-empty"></div>';
    }
    for (i = 1; i <= daysInMonth; i++) {
      var iso = y + '-' + pad(m) + '-' + pad(i);
      var cls = 'cp-ci-cal-day';
      if (iso === state.selectedDate) cls += ' is-selected';
      if (iso === today) cls += ' is-today';
      if (markSet[iso]) cls += ' has-dot';
      html += '<button type="button" class="' + cls + '" data-ci-date="' + iso + '">' + i + '</button>';
    }
    grid.innerHTML = html;
  }

  function slotIcon(slot) {
    var map = {
      morning: '🌅',
      noon: '☀️',
      afternoon: '🌤',
      evening: '🌆',
      night: '🌙'
    };
    return map[slot] || '📸';
  }

  function canRegenImage(ci) {
    return !!(ci && ci.scenePrompt && bridge() &&
      bridge().isImageGenAvailable &&
      bridge().isImageGenAvailable(state.contactId));
  }

  function renderCheckInCard(ci, names) {
    if (!ci) return '';
    var isChar = ci.author === 'char';
    var authorName = isChar ? names.charName : names.profileName;
    var authorCls = isChar ? ' is-char' : ' is-user';

    var mediaHtml = '';
    var blobIds = [];
    if (ci.blobIds && ci.blobIds.length) {
      blobIds = ci.blobIds.slice();
    } else if (ci.blobId) {
      blobIds = [ci.blobId];
    }
    if (blobIds.length) {
      var imgsCls = blobIds.length === 1 ? 'cp-ci-card__imgs is-single' : 'cp-ci-card__imgs';
      mediaHtml = '<div class="' + imgsCls + '">' + blobIds.map(function (blobId) {
        return '<div class="cp-ci-card__img" data-ci-blob="' + esc(blobId) + '"><div class="cp-ci-card__img-ph"></div></div>';
      }).join('') + '</div>';
    } else if (ci.imageGenPending) {
      mediaHtml = '<div class="cp-ci-card__img is-pending">' +
        '<span class="cp-ci-pending-label">生图中</span>' +
      '</div>';
    }

    var regenHtml = '';
    if (ci.imageGenFailed && canRegenImage(ci) && !ci.imageGenPending) {
      regenHtml = '<button type="button" class="cp-ci-regen" data-ci-regen="' + esc(ci.id) + '" aria-label="重新生成配图" title="重新生成">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 12a8 8 0 0 1 13.7-5.7M20 12a8 8 0 0 1-13.7 5.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M20 4v4h-4M4 20v-4h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';
    }

    var meta = [];
    if (ci.slotLabel) meta.push(ci.slotLabel);
    if (ci.location) meta.push(ci.location);
    if (ci.mood) meta.push(ci.mood);
    meta.push(formatCheckInTime(ci));

    var commentsHtml = '';
    if (Array.isArray(ci.comments) && ci.comments.length) {
      commentsHtml = '<div class="cp-ci-comments">' + ci.comments.map(function (c) {
        var cName = c.author === 'user' ? names.profileName : names.charName;
        var cCls = c.author === 'user' ? ' is-user' : ' is-char';
        return '<div class="cp-ci-comment' + cCls + '">' +
          '<span class="cp-ci-comment__who">' + esc(cName) + '</span>' +
          '<p class="cp-ci-comment__text">' + esc(c.text) + '</p>' +
        '</div>';
      }).join('') + '</div>';
    }

    var st = store();
    var pinned = st && st.getTimeline
      ? (st.getTimeline(state.contactId) || []).some(function (e) {
          return e && e.linkedCheckInId === ci.id;
        })
      : false;
    var pinHtml = '<button type="button" class="cp-ci-pin-tl' + (pinned ? ' is-pinned' : '') + '" data-ci-pin="' + esc(ci.id) + '">' +
      (pinned ? '已钉上时光轴' : '钉上时光轴 →') +
    '</button>';

    return (
      '<article class="cp-ci-card' + authorCls + '" data-ci-id="' + esc(ci.id) + '">' +
        '<header class="cp-ci-card__head">' +
          '<span class="cp-ci-card__icon">' + slotIcon(ci.slot) + '</span>' +
          '<div class="cp-ci-card__meta">' +
            '<span class="cp-ci-card__author">' + esc(authorName) + '</span>' +
            '<span class="cp-ci-card__tags">' + esc(meta.join(' · ')) + '</span>' +
          '</div>' +
          regenHtml +
        '</header>' +
        '<div class="cp-ci-card__body">' +
          '<p class="cp-ci-card__caption">' + esc(ci.caption) + '</p>' +
          '<p class="cp-ci-card__detail">' + esc(ci.detail) + '</p>' +
        '</div>' +
        mediaHtml +
        commentsHtml +
        pinHtml +
        '<form class="cp-ci-reply" data-ci-reply="' + esc(ci.id) + '">' +
          '<input type="text" class="cp-ci-reply__input" placeholder="说点什么…" maxlength="200" autocomplete="off">' +
          '<button type="submit" class="cp-ci-reply__send" aria-label="发送">→</button>' +
        '</form>' +
      '</article>'
    );
  }

  function hydrateImages(root) {
    if (!root) return;
    root.querySelectorAll('[data-ci-blob]').forEach(function (el) {
      var blobId = el.getAttribute('data-ci-blob');
      if (!blobId) return;
      blobUrl(blobId).then(function (url) {
        if (!url) return;
        el.innerHTML = '<img src="' + url.replace(/"/g, '&quot;') + '" alt="" loading="lazy">';
        el.classList.add('is-loaded');
      });
    });
  }

  function renderFeed() {
    var feed = $('cp-checkin-feed');
    var dateLabel = $('cp-checkin-date-label');
    var empty = $('cp-checkin-empty');
    if (!feed) return;

    var st = store();
    var list = st && st.getCheckInsByDate
      ? st.getCheckInsByDate(state.contactId, state.selectedDate)
      : [];
    var names = getSpaceNames(state.contactId);

    if (dateLabel) dateLabel.textContent = formatDisplayDate(state.selectedDate);
    if (empty) empty.hidden = list.length > 0;

    if (!list.length) {
      feed.innerHTML = '';
      return;
    }

    feed.innerHTML = list.map(function (ci) {
      return renderCheckInCard(ci, names);
    }).join('');

    hydrateImages(feed);
  }

  function renderAll() {
    renderHeader();
    renderCalendar();
    renderFeed();
  }

  function shiftMonth(delta) {
    var m = state.calMonth + delta;
    var y = state.calYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    state.calMonth = m;
    state.calYear = y;
    renderCalendar();
  }

  function handleGenerate() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.generateCharCheckIns !== 'function') {
      toast('生成模块未就绪');
      return;
    }
    setLoading(true, '正在生成今日报备…');
    br.generateCharCheckIns(state.contactId, {
      onProgress: function (p) {
        if (p && p.phase === 'text' && p.message) setLoading(true, p.message);
      }
    }).then(function (res) {
      setLoading(false);
      if (res && res.todayIso) state.selectedDate = res.todayIso;
      renderAll();
      toast('今日报备已生成');
      if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderCheckinSpotlight === 'function') {
        global.miyaCoupleApp.renderCheckinSpotlight(state.contactId);
      }
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '生成失败');
    });
  }

  function resetComposeDraft() {
    state.composeFiles = [];
    var caption = $('cp-checkin-compose-caption');
    var detail = $('cp-checkin-compose-detail');
    var mood = $('cp-checkin-compose-mood');
    var location = $('cp-checkin-compose-location');
    if (caption) caption.value = '';
    if (detail) detail.value = '';
    if (mood) mood.value = '';
    if (location) location.value = '';
    renderComposeMedia();
  }

  function renderComposeMedia() {
    var box = $('cp-checkin-compose-media');
    if (!box) return;
    box.innerHTML = state.composeFiles.map(function (file, idx) {
      var url = '';
      try { url = URL.createObjectURL(file); } catch (e) { /* ignore */ }
      var style = url ? ' style="background-image:url(\'' + url.replace(/'/g, '') + '\')"' : '';
      return '<div class="cp-checkin-compose__thumb"' + style + '>' +
        '<button type="button" class="cp-checkin-compose__thumb-remove" data-cp-compose-rm="' + idx + '" aria-label="移除">×</button>' +
      '</div>';
    }).join('');
  }

  function openCompose() {
    if (state.busy) return;
    resetComposeDraft();
    var overlay = $('cp-checkin-compose');
    if (overlay) overlay.hidden = false;
    var caption = $('cp-checkin-compose-caption');
    if (caption) caption.focus();
  }

  function closeCompose() {
    var overlay = $('cp-checkin-compose');
    if (overlay) overlay.hidden = true;
    resetComposeDraft();
  }

  function handleComposePick(files) {
    if (!files || !files.length) return;
    var imgApi = global.MiyaChatImage;
    var max = 9;
    for (var i = 0; i < files.length && state.composeFiles.length < max; i++) {
      var f = files[i];
      if (!f) continue;
      if (imgApi && typeof imgApi.isLikelyImageFile === 'function') {
        if (!imgApi.isLikelyImageFile(f)) continue;
      } else if (!f.type || f.type.indexOf('image/') !== 0) {
        continue;
      }
      state.composeFiles.push(f);
    }
    renderComposeMedia();
  }

  function handleComposeSubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.createUserCheckIn !== 'function') {
      toast('打卡模块未就绪');
      return;
    }
    var caption = trim($('cp-checkin-compose-caption') && $('cp-checkin-compose-caption').value);
    var detail = trim($('cp-checkin-compose-detail') && $('cp-checkin-compose-detail').value);
    var mood = trim($('cp-checkin-compose-mood') && $('cp-checkin-compose-mood').value);
    var location = trim($('cp-checkin-compose-location') && $('cp-checkin-compose-location').value);
    if (!caption && !detail && !state.composeFiles.length) {
      toast('请填写报备内容或添加图片');
      return;
    }
    var files = state.composeFiles.slice();
    closeCompose();
    setLoading(true, '发送打卡中…');
    br.createUserCheckIn(state.contactId, {
      caption: caption,
      detail: detail,
      mood: mood,
      location: location,
      files: files
    }, {
      onProgress: function (p) {
        if (p && p.message) setLoading(true, p.message);
      }
    }).then(function (res) {
      setLoading(false);
      state.selectedDate = todayIso();
      renderAll();
      if (res && res.commentError) {
        toast('打卡已发送，但角色回应失败：' + res.commentError);
      } else {
        toast('打卡成功');
      }
      if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderCheckinSpotlight === 'function') {
        global.miyaCoupleApp.renderCheckinSpotlight(state.contactId);
      }
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '打卡失败');
    });
  }

  function handleRegenerate(checkInId) {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.regenerateCheckInImage !== 'function') {
      toast('生图模块未就绪');
      return;
    }
    br.regenerateCheckInImage(state.contactId, checkInId).then(function () {
      renderFeed();
    }).catch(function (err) {
      renderFeed();
      toast(err && err.message === 'image_gen_disabled' ? '生图未开启' : '生成失败');
    });
  }

  function handleComment(checkInId, text) {
    if (state.busy || !trim(text)) return;
    var br = bridge();
    if (!br || typeof br.addUserComment !== 'function') {
      toast('评论模块未就绪');
      return;
    }
    setLoading(true, '发送中…');
    br.addUserComment(state.contactId, checkInId, text).then(function () {
      setLoading(false);
      renderFeed();
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '评论失败');
    });
  }

  function handlePinToTimeline(checkInId) {
    var st = store();
    if (!st || typeof st.pinCheckInToTimeline !== 'function') {
      toast('时光轴未就绪');
      return;
    }
    var entry = st.pinCheckInToTimeline(state.contactId, checkInId);
    if (!entry) {
      toast('已钉过或打卡不存在');
      return;
    }
    toast('已钉上时光轴');
    renderFeed();
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('miya-couple-timeline-updated', {
          detail: { contactId: state.contactId }
        }));
      } catch (e) { /* ignore */ }
    }
  }

  function trim(s) { return String(s || '').trim(); }

  function bindEvents() {
    var back = $('cp-checkin-back');
    if (back) {
      back.addEventListener('click', function () {
        close();
        if (global.miyaCoupleApp && typeof global.miyaCoupleApp.showSpaceView === 'function') {
          global.miyaCoupleApp.showSpaceView();
        }
      });
    }

    var prev = $('cp-checkin-cal-prev');
    var next = $('cp-checkin-cal-next');
    if (prev) prev.addEventListener('click', function () { shiftMonth(-1); });
    if (next) next.addEventListener('click', function () { shiftMonth(1); });

    var grid = $('cp-checkin-cal-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-ci-date]');
        if (!btn) return;
        state.selectedDate = btn.getAttribute('data-ci-date');
        renderCalendar();
        renderFeed();
      });
    }

    var genBtn = $('cp-checkin-generate');
    if (genBtn) genBtn.addEventListener('click', handleGenerate);

    var userBtn = $('cp-checkin-user-btn');
    var fileInput = $('cp-checkin-file');
    if (userBtn) {
      userBtn.addEventListener('click', function () {
        if (!state.busy) openCompose();
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var files = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
        fileInput.value = '';
        if (files.length) {
          if ($('cp-checkin-compose') && $('cp-checkin-compose').hidden) openCompose();
          handleComposePick(files);
        }
      });
    }

    var composePick = $('cp-checkin-compose-pick');
    if (composePick && fileInput) {
      composePick.addEventListener('click', function () {
        if (!state.busy) fileInput.click();
      });
    }

    var composeSubmit = $('cp-checkin-compose-submit');
    if (composeSubmit) {
      composeSubmit.addEventListener('click', function () {
        handleComposeSubmit();
      });
    }

    var composeOverlay = $('cp-checkin-compose');
    if (composeOverlay) {
      composeOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-cp-compose-close]')) {
          closeCompose();
          return;
        }
        var rm = e.target.closest('[data-cp-compose-rm]');
        if (rm) {
          var idx = parseInt(rm.getAttribute('data-cp-compose-rm'), 10);
          if (Number.isFinite(idx)) {
            state.composeFiles.splice(idx, 1);
            renderComposeMedia();
          }
        }
      });
    }

    var feed = $('cp-checkin-feed');
    if (feed) {
      feed.addEventListener('click', function (e) {
        var pin = e.target.closest('[data-ci-pin]');
        if (pin && !pin.classList.contains('is-pinned')) {
          e.preventDefault();
          e.stopPropagation();
          handlePinToTimeline(pin.getAttribute('data-ci-pin'));
          return;
        }
        var regen = e.target.closest('[data-ci-regen]');
        if (regen) {
          e.preventDefault();
          e.stopPropagation();
          handleRegenerate(regen.getAttribute('data-ci-regen'));
        }
      });
      feed.addEventListener('submit', function (e) {
        var form = e.target.closest('[data-ci-reply]');
        if (!form) return;
        e.preventDefault();
        var input = form.querySelector('.cp-ci-reply__input');
        var text = input ? input.value : '';
        if (input) input.value = '';
        handleComment(form.getAttribute('data-ci-reply'), text);
      });
    }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('miya-couple-checkin-updated', function (e) {
        var d = e && e.detail ? e.detail : {};
        if (d.contactId && d.contactId !== state.contactId) return;
        renderFeed();
        if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderCheckinSpotlight === 'function') {
          global.miyaCoupleApp.renderCheckinSpotlight(state.contactId);
        }
      });
    }
  }

  bindEvents();

  global.miyaCoupleCheckin = {
    open: open,
    close: close,
    renderAll: renderAll,
    renderFeed: renderFeed
  };
})(typeof window !== 'undefined' ? window : global);
