/**
 * miya-couple-app.js — 情侣空间 · Our Space
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = 0;
  var rippleBound = false;
  var gateListFingerprint = '';
  var spaceHydrateKey = '';

  var state = {
    view: 'gate',
    selectedContactId: '',
    selectedProfileId: '',
    activeSpaceContactId: ''
  };

  var FEATURE_LABELS = {
    timeline: '时光轴',
    board: '留言板',
    whisper: '深夜私语',
    photos: '照片墙',
    checkin: '打卡摄像机'
  };

  function store() { return global.miyaCoupleStore || null; }
  function chatStore() { return global.miyaChatStore || null; }
  function inviteApi() { return global.miyaCoupleInvite || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    return (cs.getContacts() || []).find(function (c) { return c && c.id === id; }) || null;
  }

  function resolveCharDisplayName(contact, sp) {
    if (contact && contact.name) return String(contact.name).trim();
    if (sp && sp.charName) return String(sp.charName).trim();
    return 'TA';
  }

  function resolveProfileDisplayName(sp, profile) {
    if (profile && profile.name) return String(profile.name).trim();
    if (sp && sp.profileName) return String(sp.profileName).trim();
    return '我';
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
        }).catch(function () { return chronicleAvatar(contact) || ''; });
      }
    }
    return Promise.resolve(chronicleAvatar(contact) || '');
  }

  function resolveProfileAvatarFromId(profile) {
    var cs = chatStore();
    if (!profile) return Promise.resolve('');
    var direct = String(profile.avatarUrl || profile.avatar || '').trim();
    if (direct && direct.indexOf('blob:') !== 0) return Promise.resolve(direct);
    var blobId = String(profile.avatarId || profile.avatarBlobId || '').trim();
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) { return url || ''; }).catch(function () { return ''; });
      }
    }
    return Promise.resolve('');
  }

  function resolveProfileAvatarUrl(profile) {
    var cs = chatStore();
    if (!profile) return Promise.resolve('');
    if (cs && typeof cs.resolveProfileDisplayAvatarSync === 'function') {
      var displaySync = cs.resolveProfileDisplayAvatarSync(profile);
      if (displaySync) return Promise.resolve(displaySync);
    }
    if (cs && typeof cs.hasProfileDisplayAvatarOverride === 'function' && cs.hasProfileDisplayAvatarOverride(profile)) {
      if (typeof cs.resolveProfileDisplayAvatarAsync === 'function') {
        return cs.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
          return url || resolveProfileAvatarFromId(profile);
        });
      }
    }
    return resolveProfileAvatarFromId(profile);
  }

  function setView(view) {
    state.view = view;
    var gate = $('cp-view-gate');
    var onboard = $('cp-view-onboard');
    var space = $('cp-view-space');
    if (gate) gate.hidden = view !== 'gate';
    if (onboard) onboard.hidden = view !== 'onboard';
    if (space) space.hidden = view !== 'space';
    var app = $('miya-couple-app');
    if (app) app.classList.toggle('is-space', view === 'space');
  }

  function daysTogether(annivDate) {
    var st = store();
    if (st && typeof st.daysTogether === 'function') return st.daysTogether(annivDate);
    var start = new Date(String(annivDate || '') + 'T00:00:00');
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var diff = Math.floor((now - start) / 86400000);
    return diff >= 0 ? diff : 0;
  }

  function syncAnniversary(contactId) {
    var st = store();
    var sp = st && contactId ? st.getSpace(contactId) : null;
    var anniv = sp && sp.annivDate ? sp.annivDate : (st && st.isoToday ? st.isoToday() : '2023-05-20');
    var days = daysTogether(anniv);
    var weeks = Math.floor(days / 7);
    var months = Math.floor(days / 30);
    var years = Math.floor(days / 365);
    var yearsLabel = years >= 1 ? years + '+' : '0';

    var contact = getContact(contactId);
    var cs = chatStore();
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (!profile && cs && cs.getActiveProfile) profile = cs.getActiveProfile();
    var profileName = resolveProfileDisplayName(sp, profile);
    var charName = resolveCharDisplayName(contact, sp);

    var namePlate = document.querySelector('.cp-name-plate');
    var plateHtml =
      '<span class="cp-n">' + esc(profileName) + '</span>' +
      '<span class="cp-amp">&</span>' +
      '<span class="cp-n">' + esc(charName) + '</span>';
    if (namePlate && namePlate.innerHTML !== plateHtml) {
      namePlate.innerHTML = plateHtml;
    }

    var daysEl = $('cp-days-num');
    var weeksEl = $('cp-weeks-num');
    var monthsEl = $('cp-months-num');
    var yearsEl = $('cp-years-num');
    var dateEl = $('cp-anniv-date');

    if (daysEl) daysEl.textContent = String(days);
    if (weeksEl) weeksEl.textContent = String(weeks);
    if (monthsEl) monthsEl.textContent = String(months);
    if (yearsEl) yearsEl.textContent = yearsLabel;
    if (dateEl) {
      var parts = anniv.split('-');
      if (parts.length >= 3) {
        dateEl.innerHTML = 'Since<br>' + parts[0] + '.' + parts[1] + '.' + parts[2];
      }
    }

    hydrateSpaceAvatars(contactId, profileName);
  }

  function applyAvatarFill(el, url, fallbackChar) {
    if (!el) return;
    var nextUrl = url ? 'url("' + url.replace(/"/g, '') + '")' : '';
    if (nextUrl) {
      if (el.dataset.cpAvatarUrl === url) return;
      el.dataset.cpAvatarUrl = url;
      el.style.backgroundImage = nextUrl;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
      return;
    }
    if (el.dataset.cpAvatarUrl === '' && el.textContent === fallbackChar) return;
    el.dataset.cpAvatarUrl = '';
    el.style.backgroundImage = '';
    el.textContent = fallbackChar;
  }

  function hydrateSpaceAvatars(contactId, profileName) {
    var hydrateKey = String(contactId || '') + '|' + String(profileName || '');
    if (spaceHydrateKey === hydrateKey) return;
    spaceHydrateKey = hydrateKey;

    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    var contact = getContact(contactId);
    var cs = chatStore();
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (!profile && cs && cs.getActiveProfile) profile = cs.getActiveProfile();

    var fillA = document.querySelector('.cp-avatar-fill-a');
    var fillB = document.querySelector('.cp-avatar-fill-b');

    if (profile && fillA) {
      resolveProfileAvatarUrl(profile).then(function (url) {
        applyAvatarFill(fillA, url, String(profileName || profile.name || '我').charAt(0));
      });
    }
    if (contact && fillB) {
      resolveAvatarUrl(contact).then(function (url) {
        applyAvatarFill(fillB, url, String(contact.name || '?').charAt(0));
      });
    }
  }

  function renderAll() {
    renderGateList(true);
    if (state.view === 'onboard') renderOnboardPicks();
    if (state.view === 'space' && state.activeSpaceContactId) {
      spaceHydrateKey = '';
      syncAnniversary(state.activeSpaceContactId);
      renderTimelinePreview(state.activeSpaceContactId);
      renderPhotosPreview(state.activeSpaceContactId);
    }
  }

  function renderGateList(force) {
    var listEl = $('cp-gate-list');
    var countEl = $('cp-gate-count');
    var st = store();
    var cs = chatStore();
    if (!listEl || !st) return;

    var rows = st.getAllSpaceRows().filter(function (sp) {
      return sp && (sp.status === 'open' || sp.status === 'pending' || sp.status === 'declined');
    });

    var openCount = rows.filter(function (sp) { return sp.status === 'open'; }).length;
    var nextFingerprint = rows.length
      ? rows.map(function (sp) {
          var contact = getContact(sp.contactId);
          return [
            sp.contactId,
            sp.status,
            sp.annivDate,
            resolveProfileDisplayName(sp, null),
            resolveCharDisplayName(contact, sp)
          ].join(':');
        }).join('|')
      : 'empty';

    if (countEl) countEl.textContent = String(openCount).padStart(2, '0') + ' OPEN';
    if (!force && gateListFingerprint === nextFingerprint) return;
    gateListFingerprint = nextFingerprint;

    if (!rows.length) {
      listEl.innerHTML =
        '<div class="cp-gate-empty">' +
          '<p>还没有情侣空间</p>' +
          '<p>点击上方按钮，向心仪的角色发出第一份邀请</p>' +
        '</div>';
      return;
    }

    rows.sort(function (a, b) {
      var rank = { open: 0, pending: 1, declined: 2 };
      var ra = rank[a.status] != null ? rank[a.status] : 9;
      var rb = rank[b.status] != null ? rank[b.status] : 9;
      if (ra !== rb) return ra - rb;
      return (b.openedAt || b.lastInviteAt || 0) - (a.openedAt || a.lastInviteAt || 0);
    });

    listEl.innerHTML = rows.map(function (sp) {
      var contact = getContact(sp.contactId);
      var charName = resolveCharDisplayName(contact, sp);
      var cs2 = chatStore();
      var profile = null;
      if (cs2 && sp.profileId) {
        profile = (cs2.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
      }
      var profileName = resolveProfileDisplayName(sp, profile);
      var badge = 'OPEN';
      var badgeCls = '';
      var meta = '';
      if (sp.status === 'open') {
        meta = '在一起 ' + daysTogether(sp.annivDate) + ' 天';
        badgeCls = '';
      } else if (sp.status === 'pending') {
        badge = 'WAIT';
        badgeCls = ' cp-gate-card__badge--pending';
        meta = '等待回应 · 可再次发送邀请';
      } else {
        badge = '—';
        badgeCls = ' cp-gate-card__badge--declined';
        meta = '可重新发送邀请';
      }
      var ch = contact ? String(contact.name || '?').charAt(0) : '?';
      var ph = String(profileName).charAt(0);
      return (
        '<button type="button" class="cp-gate-card" data-cp-gate-card="' + esc(sp.contactId) + '" data-cp-status="' + esc(sp.status) + '">' +
          '<div class="cp-gate-card__avas">' +
            '<div class="cp-gate-card__ava" data-cp-gate-ava="p-' + esc(sp.contactId) + '">' + esc(ph) + '</div>' +
            '<div class="cp-gate-card__ava cp-gate-card__ava--b" data-cp-gate-ava="c-' + esc(sp.contactId) + '">' + esc(ch) + '</div>' +
          '</div>' +
          '<div class="cp-gate-card__info">' +
            '<p class="cp-gate-card__names">' + esc(profileName) + ' & ' + esc(charName) + '</p>' +
            '<p class="cp-gate-card__meta">' + esc(meta) + '</p>' +
          '</div>' +
          '<span class="cp-gate-card__badge' + badgeCls + '">' + esc(badge) + '</span>' +
        '</button>'
      );
    }).join('');

    rows.forEach(function (sp) {
      var contact = getContact(sp.contactId);
      var cs2 = chatStore();
      var profile = null;
      if (cs2 && sp.profileId) {
        profile = (cs2.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
      }
      var pEl = listEl.querySelector('[data-cp-gate-ava="p-' + sp.contactId + '"]');
      var cEl = listEl.querySelector('[data-cp-gate-ava="c-' + sp.contactId + '"]');
      if (profile && pEl) {
        resolveProfileAvatarUrl(profile).then(function (url) {
          if (url) pEl.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
        });
      }
      if (contact && cEl) {
        resolveAvatarUrl(contact).then(function (url) {
          if (url) cEl.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
        });
      }
    });
  }

  function renderOnboardPicks() {
    var profEl = $('cp-profile-pick');
    var charEl = $('cp-char-pick');
    var sendBtn = $('cp-send-invite');
    var cs = chatStore();
    var st = store();
    if (!profEl || !charEl || !cs) return;

    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    if (!state.selectedProfileId && profiles[0]) state.selectedProfileId = profiles[0].id;

    profEl.innerHTML = profiles.length
      ? profiles.map(function (p) {
          var on = p.id === state.selectedProfileId;
          var ch = String(p.name || '?').charAt(0);
          return (
            '<button type="button" class="cp-onboard-pick' + (on ? ' is-on' : '') + '" data-cp-profile="' + esc(p.id) + '">' +
              '<span class="cp-onboard-pick__ring" data-cp-prof-ava="' + esc(p.id) + '">' + esc(ch) + '</span>' +
              '<span class="cp-onboard-pick__name">' + esc(p.name || '未命名') + '</span>' +
            '</button>'
          );
        }).join('')
      : '<p class="cp-gate-empty">请先在聊天中创建用户人设</p>';

    profiles.forEach(function (p) {
      var ring = profEl.querySelector('[data-cp-prof-ava="' + p.id + '"]');
      if (!ring) return;
      resolveProfileAvatarUrl(p).then(function (url) {
        if (url) ring.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
      });
    });

    var contacts = cs.getContacts ? cs.getContacts() : [];
    charEl.innerHTML = contacts.length
      ? contacts.map(function (c) {
          var on = c.id === state.selectedContactId;
          var opened = st && st.isOpen(c.id);
          var spRow = st && st.getSpace(c.id);
          var pending = spRow && spRow.status === 'pending';
          var declined = spRow && spRow.status === 'declined';
          var disabled = opened;
          var ch = String(c.name || '?').charAt(0);
          var tag = opened ? '已开启' : pending ? '可重发' : declined ? '可重发' : '';
          return (
            '<button type="button" class="cp-onboard-char' + (on ? ' is-on' : '') + (disabled ? ' is-disabled' : '') + '" data-cp-char="' + esc(c.id) + '">' +
              '<span class="cp-onboard-char__ava" data-cp-char-ava="' + esc(c.id) + '">' + esc(ch) + '</span>' +
              '<span class="cp-onboard-char__name">' + esc(c.name || '未命名') + '</span>' +
              (tag ? '<span class="cp-onboard-char__tag">' + esc(tag) + '</span>' : '') +
            '</button>'
          );
        }).join('')
      : '<p class="cp-gate-empty">暂无联系人 · 请先在聊天中添加角色</p>';

    contacts.forEach(function (c) {
      var ava = charEl.querySelector('[data-cp-char-ava="' + c.id + '"]');
      if (!ava) return;
      resolveAvatarUrl(c).then(function (url) {
        if (url) ava.innerHTML = '<img src="' + esc(url) + '" alt="" loading="lazy">';
      });
    });

    if (sendBtn) {
      var canSend = !!(state.selectedProfileId && state.selectedContactId);
      if (canSend && st && st.isOpen(state.selectedContactId)) canSend = false;
      sendBtn.disabled = !canSend;
      var labelEl = sendBtn.querySelector('[data-cp-send-label]');
      if (labelEl) {
        var spSel = st && state.selectedContactId ? st.getSpace(state.selectedContactId) : null;
        var isResend = spSel && (spSel.status === 'pending' || spSel.status === 'declined');
        labelEl.textContent = isResend ? '再次发送开通情侣空间邀请' : '发送开通情侣空间邀请';
      }
    }
  }

  function openSpaceView(contactId) {
    if (state.view === 'space' && state.activeSpaceContactId === contactId) return;
    state.activeSpaceContactId = contactId;
    spaceHydrateKey = '';
    setView('space');
    var st = store();
    if (st) {
      if (typeof st.revealDueSealedEntries === 'function') st.revealDueSealedEntries(contactId);
      if (typeof st.seedOpenSpaceMilestone === 'function') st.seedOpenSpaceMilestone(contactId);
      if (typeof st.syncAnniversaryMilestones === 'function') st.syncAnniversaryMilestones(contactId);
    }
    syncAnniversary(contactId);
    syncImageGenSetting(contactId);
    renderCheckinSpotlight(contactId);
    renderTimelinePreview(contactId);
    renderBoardPreview(contactId);
    renderPhotosPreview(contactId);
    initRipple();
  }

  function isGlobalImageGenReady() {
    var ig = global.MiyaImageGen;
    if (!ig || typeof ig.isGlobalEnabled !== 'function') return false;
    if (!ig.isGlobalEnabled()) return false;
    var cid = state.activeSpaceContactId;
    if (cid && typeof ig.isContactEnabled === 'function' && !ig.isContactEnabled(cid)) return false;
    return true;
  }

  function syncImageGenSetting(contactId) {
    var st = store();
    var toggle = $('cp-image-gen-toggle');
    var hint = $('cp-image-gen-hint');
    var cid = contactId || state.activeSpaceContactId;
    if (!st || !cid) return;

    var on = st.isImageGenEnabled ? st.isImageGenEnabled(cid) : false;
    if (toggle) {
      toggle.classList.toggle('is-on', on);
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      toggle.disabled = !isGlobalImageGenReady();
    }
    if (hint) {
      if (!isGlobalImageGenReady()) {
        hint.textContent = '请先在系统设置中开启生图 API，并为该角色启用生图';
      } else if (on) {
        hint.textContent = '已开启 · 打卡生成时最多自动配图 2 张，其余仅文字';
      } else {
        hint.textContent = '开启后，打卡摄像机可为报备自动生成配图';
      }
    }
  }

  function toggleImageGenSetting() {
    var st = store();
    var cid = state.activeSpaceContactId;
    if (!st || !cid || !isGlobalImageGenReady()) {
      toast('请先在系统设置中开启生图');
      return;
    }
    var next = !(st.isImageGenEnabled && st.isImageGenEnabled(cid));
    st.setImageGenEnabled(cid, next);
    syncImageGenSetting(cid);
    toast(next ? '已开启情侣空间生图' : '已关闭情侣空间生图');
  }

  function showSpaceView() {
    setView('space');
    var checkinView = $('cp-view-checkin');
    var timelineView = $('cp-view-timeline');
    var boardView = $('cp-view-board');
    var whisperView = $('cp-view-whisper');
    var photosView = $('cp-view-photos');
    if (checkinView) checkinView.hidden = true;
    if (timelineView) timelineView.hidden = true;
    if (boardView) boardView.hidden = true;
    if (whisperView) whisperView.hidden = true;
    if (photosView) photosView.hidden = true;
    var app = $('miya-couple-app');
    if (app) {
      app.classList.remove('is-checkin');
      app.classList.remove('is-timeline');
      app.classList.remove('is-board');
      app.classList.remove('is-whisper');
      app.classList.remove('is-photos');
    }
  }

  var MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderTimelinePreview(contactId) {
    var st = store();
    var cid = contactId || state.activeSpaceContactId;
    var stream = $('cp-tl-home-stream');
    var mini = $('cp-mini-tl-preview');
    if (!st || !cid) return;

    var list = st.getVisibleTimeline ? st.getVisibleTimeline(cid).slice(0, 3) : [];
    var miniList = list.slice(0, 3);

    if (mini) {
      mini.innerHTML = miniList.length
        ? miniList.map(function (e) {
            return '<div class="cp-mini-tl-item">' + esc(e.title || '记忆') + '</div>';
          }).join('')
        : '<div class="cp-mini-tl-item">还没有记忆 · 点击进入</div>';
    }

    if (!stream) return;
    if (!list.length) {
      stream.innerHTML =
        '<div class="cp-tl-entry cp-tl-entry--empty">' +
          '<div class="cp-tl-card"><div class="cp-tl-card-body">' +
            '<div class="cp-tl-card-title">开始书写</div>' +
            '<div class="cp-tl-card-desc">记录你们的第一个瞬间</div>' +
          '</div></div>' +
        '</div>';
      return;
    }

    stream.innerHTML = list.map(function (entry) {
      var p = String(entry.dateIso || '').split('-');
      var mon = p.length >= 2 ? (MONTH_EN[Number(p[1]) - 1] || p[1]) : '—';
      var day = p.length >= 3 ? String(Number(p[2])) : '—';
      var yr = p[0] || '—';
      var imgCls = 'cp-tl-card-img' + (entry.blobId ? '' : (entry.type === 'milestone' ? ' alt-a' : ' alt-b'));
      var imgHtml = entry.blobId
        ? '<div class="' + imgCls + '" data-cp-tl-prev-blob="' + esc(entry.blobId) + '"></div>'
        : '<div class="' + imgCls + '"></div>';
      return (
        '<div class="cp-tl-entry">' +
          '<div class="cp-tl-date-block">' +
            '<div class="cp-tl-month">' + esc(mon) + '</div>' +
            '<div class="cp-tl-day">' + esc(day) + '</div>' +
            '<div class="cp-tl-year">' + esc(yr) + '</div>' +
          '</div>' +
          '<div class="cp-tl-card">' +
            imgHtml +
            '<div class="cp-tl-card-body">' +
              '<div class="cp-tl-card-title">' + esc(entry.title) + '</div>' +
              '<div class="cp-tl-card-desc">' + esc(entry.body || '') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    stream.querySelectorAll('[data-cp-tl-prev-blob]').forEach(function (el) {
      var blobId = el.getAttribute('data-cp-tl-prev-blob');
      if (!blobId) return;
      var cs = chatStore();
      if (!cs) return;
      function apply(url) {
        if (!url) return;
        el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) apply(cached);
        else if (typeof cs.getAvatarUrl === 'function') {
          cs.getAvatarUrl(blobId).then(apply).catch(function () {});
        }
      }
    });
  }

  function renderPhotosPreview(contactId) {
    var ph = global.miyaCouplePhotos;
    if (!ph || typeof ph.renderHomePreview !== 'function') return;
    var cid = contactId || state.activeSpaceContactId;
    if (!cid) return;
    var cs = chatStore();
    var boot = cs && typeof cs.init === 'function' ? cs.init() : Promise.resolve();
    Promise.resolve(boot).then(function () {
      ph.renderHomePreview(cid);
    });
  }

  function renderBoardPreview(contactId) {
    var st = store();
    var cid = contactId || state.activeSpaceContactId;
    if (!st || !cid) return;

    var quoteEl = document.querySelector('.cp-b-cell-message .cp-b-quote');
    var letterBody = document.querySelector('.cp-letter-section .cp-letter-body');
    var letterSign = document.querySelector('.cp-letter-section .cp-letter-sign');
    var badge = document.querySelector('.cp-b-cell-message .cp-b-badge');

    var entry = st.getLatestBoardPreview ? st.getLatestBoardPreview(cid) : null;
    var unread = st.getBoardUnreadCount ? st.getBoardUnreadCount(cid) : 0;
    var names = { profileName: '我', charName: 'TA' };
    var sp = st.getSpace(cid);
    var contact = getContact(cid);
    var cs = chatStore();
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (contact || sp) {
      names.charName = resolveCharDisplayName(contact, sp);
      names.profileName = resolveProfileDisplayName(sp, profile);
    }

    if (badge) badge.hidden = unread <= 0;

    var previewText = entry
      ? (entry.author === 'char' ? names.charName + '：' : '') + (entry.text || '')
      : '贴第一条便签，或刷新 TA 今日留言';

    if (quoteEl) quoteEl.textContent = '"' + previewText.slice(0, 80) + (previewText.length > 80 ? '…' : '') + '"';
    if (letterBody) letterBody.textContent = previewText;
    if (letterSign) {
      letterSign.textContent = entry
        ? '— ' + (entry.author === 'char' ? names.charName : names.profileName)
        : '— Pinboard';
    }

    var letterTag = document.querySelector('.cp-letter-section .cp-letter-tag');
    if (letterTag) {
      letterTag.textContent = unread > 0
        ? 'Pinboard · ' + unread + ' new'
        : 'Pinboard · Editorial Note';
    }
  }

  function renderCheckinSpotlight(contactId) {
    var preview = $('cp-checkin-preview');
    if (!preview) return;
    var st = store();
    var cid = contactId || state.activeSpaceContactId;
    if (!st || !cid) {
      preview.textContent = 'TA 的今日报备会出现在这里';
      return;
    }
    var today = st.isoToday ? st.isoToday() : '';
    var slotHint = st.getCurrentSlotHint ? st.getCurrentSlotHint() : { slot: 'custom', label: '打卡' };
    var todayList = st.getCheckInsByDate ? st.getCheckInsByDate(cid, today).filter(function (ci) {
      return ci && ci.author === 'char';
    }) : [];
    var latest = null;
    if (todayList.length) {
      latest = todayList.find(function (ci) { return ci.slot === slotHint.slot; }) || todayList[todayList.length - 1];
    }
    var contact = getContact(cid);
    var sp = st.getSpace(cid);
    var charName = resolveCharDisplayName(contact, sp);
    var previewText = '';
    var previewHtml = '';

    if (latest) {
      previewHtml =
        '<span class="cp-checkin-spotlight__tag">' + esc(latest.slotLabel || slotHint.label) + '</span>' +
        esc(charName) + '：' + esc(latest.caption || latest.detail || '已打卡');
    } else {
      previewText = '今日暂无 ' + charName + ' 的' + slotHint.label + '，点击进入生成';
    }

    if (previewHtml) {
      if (preview.innerHTML !== previewHtml) preview.innerHTML = previewHtml;
    } else if (preview.textContent !== previewText) {
      preview.textContent = previewText;
    }
  }

  function openOnboard(preselectContactId) {
    if (preselectContactId) state.selectedContactId = preselectContactId;
    var cs = chatStore();
    if (cs && cs.getActiveProfile && !state.selectedProfileId) {
      var ap = cs.getActiveProfile();
      if (ap) state.selectedProfileId = ap.id;
    }
    setView('onboard');
    renderOnboardPicks();
  }

  function sendInvite() {
    var inv = inviteApi();
    if (!inv || typeof inv.send !== 'function') {
      toast('邀请模块未就绪');
      return;
    }
    if (!state.selectedContactId || !state.selectedProfileId) {
      toast('请选择人设与角色');
      return;
    }
    var loading = $('cp-onboard-loading');
    var loadingTx = $('cp-onboard-loading-text');
    if (loading) loading.hidden = false;
    if (loadingTx) loadingTx.textContent = '正在发送邀请并跳转聊天…';

    inv.send(state.selectedContactId, state.selectedProfileId).then(function () {
      if (loading) loading.hidden = true;
    }).catch(function (err) {
      if (loading) loading.hidden = true;
      toast(err && err.message ? err.message : '发送失败');
    });
  }

  function initRipple() {
    if (rippleBound) return;
    var app = $('miya-couple-app');
    var canvas = $('cp-ripple-canvas');
    if (!app || !canvas) return;

    var ctx = canvas.getContext('2d', { alpha: true });
    var lowEnd = document.documentElement && document.documentElement.classList.contains('is-low-end');
    var SCALE = lowEnd ? 7 : 4;
    var THROTTLE_MS = lowEnd ? 90 : 60;
    var MIN_DIST = lowEnd ? 24 : 18;
    var MAX_DPR = lowEnd ? 1.5 : 2;

    var gw, gh, bufA, bufB, imageData;
    var lastX = -1;
    var lastY = -1;
    var lastTime = 0;
    var animating = false;
    var rafId = null;

    function initGrid() {
      var rect = app.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      gw = Math.ceil(rect.width / SCALE);
      gh = Math.ceil(rect.height / SCALE);
      var len = gw * gh;
      bufA = new Float32Array(len);
      bufB = new Float32Array(len);
      imageData = ctx.createImageData(rect.width, rect.height);
    }

    function disturb(gx, gy, radius, strength) {
      var r = Math.ceil(radius);
      var y, x, dx, dy, dist, falloff;
      for (y = gy - r; y <= gy + r; y++) {
        for (x = gx - r; x <= gx + r; x++) {
          if (x < 1 || x >= gw - 1 || y < 1 || y >= gh - 1) continue;
          dx = x - gx;
          dy = y - gy;
          dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            falloff = 1 - dist / radius;
            bufA[y * gw + x] += strength * falloff * falloff;
          }
        }
      }
    }

    function step() {
      var damp = 0.965;
      var y, x, i;
      for (y = 1; y < gh - 1; y++) {
        for (x = 1; x < gw - 1; x++) {
          i = y * gw + x;
          bufB[i] = (bufA[i - 1] + bufA[i + 1] + bufA[i - gw] + bufA[i + gw]) * 0.5 - bufB[i];
          bufB[i] *= damp;
        }
      }
      var tmp = bufA;
      bufA = bufB;
      bufB = tmp;
    }

    function render() {
      var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      var w = canvas.width / dpr;
      var h = canvas.height / dpr;
      var data = imageData.data;
      var s = SCALE;
      var y, x, i, val, alpha, sy, sx, px, pi;

      data.fill(0);

      for (y = 1; y < gh - 1; y++) {
        for (x = 1; x < gw - 1; x++) {
          i = y * gw + x;
          val = bufA[i];
          alpha = Math.min(38, Math.abs(val) * 420);
          if (alpha < 1) continue;

          for (sy = 0; sy < s; sy++) {
            for (sx = 0; sx < s; sx++) {
              px = (y * s + sy) * w + (x * s + sx);
              if (px < 0 || px >= w * h) continue;
              pi = px * 4;
              data[pi] = 255;
              data[pi + 1] = 255;
              data[pi + 2] = 255;
              data[pi + 3] = alpha;
            }
          }
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(imageData, 0, 0);
    }

    function tick() {
      step();
      render();

      var energy = 0;
      var i;
      for (i = 0; i < bufA.length; i += 16) energy += Math.abs(bufA[i]);
      if (energy > 0.15) {
        rafId = requestAnimationFrame(tick);
      } else {
        animating = false;
        var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      }
    }

    function startAnim() {
      if (!animating) {
        animating = true;
        rafId = requestAnimationFrame(tick);
      }
    }

    function toLocal(clientX, clientY) {
      var rect = app.getBoundingClientRect();
      return {
        gx: Math.floor((clientX - rect.left) / SCALE),
        gy: Math.floor((clientY - rect.top) / SCALE),
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function onPointerMove(clientX, clientY) {
      var now = Date.now();
      var pos = toLocal(clientX, clientY);

      if (pos.x < 0 || pos.y < 0 || pos.x > app.clientWidth || pos.y > app.clientHeight) return;
      if (now - lastTime < THROTTLE_MS) return;
      if (lastX >= 0 && Math.hypot(pos.x - lastX, pos.y - lastY) < MIN_DIST) return;

      disturb(pos.gx, pos.gy, 2.5, 0.55);
      lastX = pos.x;
      lastY = pos.y;
      lastTime = now;
      startAnim();
    }

    function onPointerEnd() {
      lastX = -1;
      lastY = -1;
    }

    app.addEventListener('touchmove', function (e) {
      onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    app.addEventListener('touchend', onPointerEnd, { passive: true });
    app.addEventListener('touchcancel', onPointerEnd, { passive: true });

    app.addEventListener('mousemove', function (e) {
      if (e.buttons === 1) onPointerMove(e.clientX, e.clientY);
    });

    app.addEventListener('mouseup', onPointerEnd);

    window.addEventListener('resize', function () {
      if (rafId) cancelAnimationFrame(rafId);
      animating = false;
      initGrid();
    });

    initGrid();
    rippleBound = true;
  }

  function openCoupleApp(contactId) {
    var el = $('miya-couple-app');
    if (!el) return;
    var alreadyOpen = el.classList.contains('is-open');
    el.removeAttribute('hidden');
    el.classList.add('is-open');
    if (!alreadyOpen) {
      el.classList.add('is-entering');
      el.addEventListener('animationend', function onEnterEnd(ev) {
        if (ev.animationName !== 'cpFadeIn') return;
        el.classList.remove('is-entering');
        el.removeEventListener('animationend', onEnterEnd);
      });
    }
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');

    var st = store();
    if (contactId && st && st.isOpen(contactId)) {
      openSpaceView(contactId);
      return;
    }
    if (alreadyOpen && !contactId) return;

    setView('gate');
    renderGateList();
  }

  function closeCoupleApp() {
    var el = $('miya-couple-app');
    if (!el) return;
    el.classList.remove('is-open', 'is-space');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    spaceHydrateKey = '';
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

  function bindEvents() {
    var back = $('cp-back');
    if (back) {
      back.addEventListener('click', function () {
        setView('gate');
        renderGateList();
      });
    }

    var gateBack = $('cp-gate-back');
    if (gateBack) gateBack.addEventListener('click', closeCoupleApp);

    var onboardBack = $('cp-onboard-back');
    if (onboardBack) {
      onboardBack.addEventListener('click', function () {
        setView('gate');
        renderGateList();
      });
    }

    var openOnboardBtn = $('cp-open-onboard');
    if (openOnboardBtn) openOnboardBtn.addEventListener('click', function () { openOnboard(); });

    var imageGenToggle = $('cp-image-gen-toggle');
    if (imageGenToggle) imageGenToggle.addEventListener('click', toggleImageGenSetting);

    var sendBtn = $('cp-send-invite');
    if (sendBtn) sendBtn.addEventListener('click', sendInvite);

    var gateList = $('cp-gate-list');
    if (gateList) {
      gateList.addEventListener('click', function (e) {
        var card = e.target.closest('[data-cp-gate-card]');
        if (!card) return;
        var cid = card.getAttribute('data-cp-gate-card');
        var status = card.getAttribute('data-cp-status');
        if (status === 'open') {
          openSpaceView(cid);
        } else {
          openOnboard(cid);
        }
      });
    }

    var profPick = $('cp-profile-pick');
    if (profPick) {
      profPick.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-profile]');
        if (!btn) return;
        state.selectedProfileId = btn.getAttribute('data-cp-profile');
        renderOnboardPicks();
      });
    }

    var charPick = $('cp-char-pick');
    if (charPick) {
      charPick.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-char]');
        if (!btn || btn.classList.contains('is-disabled')) return;
        state.selectedContactId = btn.getAttribute('data-cp-char');
        renderOnboardPicks();
      });
    }

    document.querySelectorAll('[data-cp-feature]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var feat = btn.getAttribute('data-cp-feature');
        if (feat === 'checkin') {
          var cid = state.activeSpaceContactId;
          if (!cid) {
            toast('请先进入情侣空间');
            return;
          }
          var checkin = global.miyaCoupleCheckin;
          if (checkin && typeof checkin.open === 'function') {
            checkin.open(cid);
          } else {
            toast('打卡摄像机未就绪');
          }
          return;
        }
        if (feat === 'timeline') {
          var cidTl = state.activeSpaceContactId;
          if (!cidTl) {
            toast('请先进入情侣空间');
            return;
          }
          var tl = global.miyaCoupleTimeline;
          if (tl && typeof tl.open === 'function') {
            tl.open(cidTl);
          } else {
            toast('时光轴未就绪');
          }
          return;
        }
        if (feat === 'board') {
          var cidBd = state.activeSpaceContactId;
          if (!cidBd) {
            toast('请先进入情侣空间');
            return;
          }
          var bd = global.miyaCoupleBoard;
          if (bd && typeof bd.open === 'function') {
            bd.open(cidBd);
          } else {
            toast('留言板未就绪');
          }
          return;
        }
        if (feat === 'whisper') {
          var cidWp = state.activeSpaceContactId;
          if (!cidWp) {
            toast('请先进入情侣空间');
            return;
          }
          var wp = global.miyaCoupleWhisper;
          if (wp && typeof wp.open === 'function') {
            wp.open(cidWp);
          } else {
            toast('深夜私语未就绪');
          }
          return;
        }
        if (feat === 'photos') {
          var cidPh = state.activeSpaceContactId;
          if (!cidPh) {
            toast('请先进入情侣空间');
            return;
          }
          var ph = global.miyaCouplePhotos;
          if (ph && typeof ph.open === 'function') {
            ph.open(cidPh);
          } else {
            toast('照片墙未就绪');
          }
          return;
        }
        toast((FEATURE_LABELS[feat] || feat) + ' · 即将上线');
      });
    });

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('miya-couple-invite-resolved', function () {
        renderAll();
      });
      global.addEventListener('miya-couple-timeline-updated', function (e) {
        var d = e && e.detail ? e.detail : {};
        if (d.contactId && state.activeSpaceContactId && d.contactId !== state.activeSpaceContactId) return;
        renderTimelinePreview(state.activeSpaceContactId);
      });
      global.addEventListener('miya-couple-board-updated', function (e) {
        var d = e && e.detail ? e.detail : {};
        if (d.contactId && state.activeSpaceContactId && d.contactId !== state.activeSpaceContactId) return;
        renderBoardPreview(state.activeSpaceContactId);
      });
    }
  }

  bindEvents();

  global.miyaCoupleApp = {
    open: openCoupleApp,
    close: closeCoupleApp,
    renderAll: renderAll,
    toast: toast,
    showSpaceView: showSpaceView,
    renderCheckinSpotlight: renderCheckinSpotlight,
    renderTimelinePreview: renderTimelinePreview,
    renderBoardPreview: renderBoardPreview,
    renderPhotosPreview: renderPhotosPreview
  };
})(typeof window !== 'undefined' ? window : global);
