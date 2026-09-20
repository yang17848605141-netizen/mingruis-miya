/**
 * miya-couple-timeline.js — 时光轴 · UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var TYPE_LABELS = {
    milestone: '里程碑',
    memory: '闪念',
    checkin_pin: '打卡',
    gacha: '扭蛋',
    sealed: '未拆的信',
    letter: '来信',
    commemoration: '纪念事项'
  };

  var GACHA_COLORS = ['rose', 'sky', 'gold', 'mint', 'lavender', 'coral', 'lemon'];

  var state = {
    contactId: '',
    busy: false,
    detailId: '',
    composeFiles: [],
    composeMode: 'memory'
  };

  function store() { return global.miyaCoupleStore || null; }
  function bridge() { return global.miyaCoupleTimelineBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

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
    return st && st.isoToday ? st.isoToday() : '';
  }

  function getSpaceNames(contactId) {
    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    var cs = chatStore();
    var contact = null;
    if (cs && contactId) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
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

  function parseDateParts(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return { month: '—', day: '—', year: '—' };
    return {
      month: MONTH_EN[Number(p[1]) - 1] || p[1],
      day: String(Number(p[2])),
      year: p[0]
    };
  }

  function blobUrl(blobId) {
    var cs = chatStore();
    if (!cs || !blobId) return Promise.resolve('');
    if (typeof cs.getCachedBlobUrl === 'function') {
      var cached = cs.getCachedBlobUrl(blobId);
      if (cached) return Promise.resolve(cached);
    }
    if (typeof cs.getBlobUrl === 'function') {
      return cs.getBlobUrl(blobId).catch(function () { return ''; });
    }
    if (typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(blobId).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function setLoading(show, text) {
    var el = $('cp-tl-loading');
    var tx = $('cp-tl-loading-text');
    if (el) el.hidden = !show;
    if (tx) tx.textContent = text || (show ? '生成中…' : '处理中…');
    state.busy = !!show;
  }

  function setBtnBusy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.tlIdleText) btn.dataset.tlIdleText = btn.textContent || '';
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      if (btn.dataset.tlIdleText) {
        btn.textContent = btn.dataset.tlIdleText;
        delete btn.dataset.tlIdleText;
      }
    }
  }

  function setGachaGenerating(on, text) {
    var overlay = $('cp-tl2-gacha');
    var runBtn = $('cp-tl2-gacha-run');
    var status = $('cp-tl2-gacha-status');
    if (overlay) overlay.classList.toggle('is-generating', !!on);
    if (runBtn) runBtn.hidden = !!on;
    if (status) {
      status.hidden = !on;
      if (on && text) status.textContent = text;
    }
    state.busy = !!on;
  }

  function setCharLetterGenerating(on, text) {
    var overlay = $('cp-tl2-char-letter');
    var submitBtn = $('cp-tl2-char-letter-submit');
    var status = $('cp-tl2-char-letter-status');
    if (overlay) overlay.classList.toggle('is-generating', !!on);
    setBtnBusy(submitBtn, on, on ? (text || '正在动笔…') : '');
    if (status) {
      status.hidden = !on;
      if (on && text) status.textContent = text;
    }
    state.busy = !!on;
  }

  function composeLoadingText(data) {
    if (data.sealed) return '封存中…';
    if (data.dualPerspective && data.requestEcho !== false) return '生成中…';
    if (data.dualPerspective) return '生成双视角中…';
    if (data.requestEcho !== false) return '生成回响中…';
    return '保存中…';
  }

  function setViewVisible(show) {
    var view = $('cp-view-timeline');
    var app = $('miya-couple-app');
    if (view) view.hidden = !show;
    if (app) app.classList.toggle('is-timeline', !!show);
  }

  function dispatchUpdated() {
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('miya-couple-timeline-updated', {
          detail: { contactId: state.contactId }
        }));
      } catch (e) { /* ignore */ }
    }
  }

  function open(contactId) {
    if (!contactId) return;
    state.contactId = contactId;
    var st = store();
    if (st) {
      if (typeof st.revealDueSealedEntries === 'function') {
        var revealed = st.revealDueSealedEntries(contactId);
        if (revealed.length) toast('有 ' + revealed.length + ' 封信到了拆开的日子');
      }
      if (typeof st.seedOpenSpaceMilestone === 'function') st.seedOpenSpaceMilestone(contactId);
      if (typeof st.syncAnniversaryMilestones === 'function') st.syncAnniversaryMilestones(contactId);
    }
    setViewVisible(true);
    renderAll();
  }

  function close() {
    var cid = state.contactId;
    setViewVisible(false);
    state.contactId = '';
    state.detailId = '';
    closeDetail();
    closeLetterFullscreen();
    closeMemoryCompose();
    closeLetterCompose();
    closeCommemCompose();
    closeGacha();
    closeCharLetter();
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderTimelinePreview === 'function') {
      global.miyaCoupleApp.renderTimelinePreview(cid);
    }
  }

  function isLetterEntry(entry) {
    if (!entry) return false;
    if (entry.type === 'letter' || entry.type === 'sealed') return true;
    return !!(entry.meta && entry.meta.letter);
  }

  function isOpenLetterEntry(entry) {
    if (!isLetterEntry(entry)) return false;
    if (!entry.sealed) return true;
    return String(entry.dateIso || '') <= todayIso();
  }

  function normalizeLetterBody(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var pass;
    for (pass = 0; pass < 3; pass++) {
      var prev = t;
      t = t
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      if (t === prev) break;
    }
    return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  function letterPreviewText(body, maxLen) {
    var t = normalizeLetterBody(body).replace(/\s+/g, ' ').trim();
    var n = maxLen || 120;
    return t.length <= n ? t : t.slice(0, n) + '…';
  }

  function formatLetterBodyHtml(body) {
    var t = normalizeLetterBody(body);
    if (!t) return '';
    var paras = t.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (paras.length <= 1) {
      return esc(t).replace(/\n/g, '<br>');
    }
    return paras.map(function (p) {
      return '<p class="cp-letter-paper__para">' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderEnvelopeMini(opts) {
    opts = opts || {};
    var from = esc(opts.from || '—');
    var to = esc(opts.to || '—');
    var wax = esc(opts.wax || '♡');
    var cls = 'cp-env' + (opts.sealed ? ' is-sealed' : '') + (opts.fromChar ? ' is-from-char' : '') +
      (opts.open ? ' is-open' : '') + (opts.large ? ' is-large' : '') + (opts.className ? ' ' + opts.className : '');
    return (
      '<div class="' + cls + '" aria-hidden="true">' +
        '<div class="cp-env__shadow"></div>' +
        '<div class="cp-env__body">' +
          '<div class="cp-env__paper"></div>' +
          '<div class="cp-env__flap"></div>' +
          '<div class="cp-env__seal"><span>' + wax + '</span></div>' +
        '</div>' +
        (opts.showAddr ? (
          '<div class="cp-env__addr">' +
            '<span class="cp-env__addr-from">' + from + '</span>' +
            '<span class="cp-env__addr-to">' + to + '</span>' +
          '</div>'
        ) : '') +
      '</div>'
    );
  }

  function renderLetterPaper(entry, names, opts) {
    opts = opts || {};
    var fromName = entry.author === 'char' ? names.charName : names.profileName;
    var toName = entry.author === 'char' ? names.profileName : names.charName;
    var dp = parseDateParts(entry.dateIso);
    var meta = [];
    if (entry.mood) meta.push(entry.mood);
    if (entry.location) meta.push(entry.location);
    return (
      '<article class="cp-letter-paper' + (entry.author === 'char' ? ' is-from-char' : '') +
        (opts.reveal ? ' is-reveal' : '') + (opts.fullscreen ? ' cp-letter-paper--fullscreen' : '') + '">' +
        '<div class="cp-letter-paper__grain" aria-hidden="true"></div>' +
        '<div class="cp-letter-paper__stamp" aria-hidden="true"><span>LOVE</span></div>' +
        '<header class="cp-letter-paper__head">' +
          '<span class="cp-letter-paper__date">' + esc(dp.year + '.' + dp.month + '.' + dp.day) + '</span>' +
          '<span class="cp-letter-paper__tag">Private Letter</span>' +
        '</header>' +
        '<p class="cp-letter-paper__dear">Dear ' + esc(toName) + ',</p>' +
        '<h2 class="cp-letter-paper__title">' + esc(entry.title) + '</h2>' +
        (entry.body ? '<div class="cp-letter-paper__body">' + formatLetterBodyHtml(entry.body) + '</div>' : '') +
        (meta.length ? '<p class="cp-letter-paper__meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '<footer class="cp-letter-paper__foot">' +
          '<span class="cp-letter-paper__sign">Yours, ' + esc(fromName) + '</span>' +
          '<span class="cp-letter-paper__scribble" aria-hidden="true"></span>' +
        '</footer>' +
      '</article>'
    );
  }

  function gachaColorId(entryOrColor) {
    if (entryOrColor && typeof entryOrColor === 'object') {
      return trim(entryOrColor.gachaColor) ||
        trim(entryOrColor.meta && entryOrColor.meta.gachaColor) ||
        GACHA_COLORS[Number(entryOrColor.meta && entryOrColor.meta.gachaIndex) % GACHA_COLORS.length] ||
        GACHA_COLORS[0];
    }
    var c = trim(entryOrColor);
    return GACHA_COLORS.indexOf(c) >= 0 ? c : GACHA_COLORS[0];
  }

  function getGachaCapsules(entry) {
    if (!entry) return [];
    if (entry.meta && entry.meta.isBatch && Array.isArray(entry.meta.capsules)) {
      return entry.meta.capsules.filter(Boolean);
    }
    if (entry.type === 'gacha') {
      return [{
        title: entry.title,
        body: entry.body,
        dateIso: entry.dateIso,
        mood: entry.mood,
        location: entry.location,
        gachaColor: entry.meta && entry.meta.gachaColor,
        gachaIndex: entry.meta && entry.meta.gachaIndex
      }];
    }
    return [];
  }

  function synthesizeGachaBatchFromSiblings(siblings) {
    var list = (siblings || []).slice().sort(function (a, b) {
      return (a.meta && a.meta.gachaIndex != null ? a.meta.gachaIndex : 0) -
        (b.meta && b.meta.gachaIndex != null ? b.meta.gachaIndex : 0);
    });
    if (!list.length) return null;
    var first = list[0];
    var batchKey = (first.meta && first.meta.gachaBatch) || first.gachaWeek || '';
    return {
      id: first.id,
      type: 'gacha',
      author: first.author,
      dateIso: first.dateIso,
      title: '本周七色胶囊',
      body: '',
      gachaWeek: first.gachaWeek,
      createdAt: first.createdAt,
      meta: {
        isBatch: true,
        gachaBatch: batchKey,
        week: first.gachaWeek,
        source: 'weekly_gacha',
        _legacyIds: list.map(function (e) { return e.id; }),
        capsules: list.map(function (e, i) {
          return {
            title: e.title,
            body: e.body,
            dateIso: e.dateIso,
            mood: e.mood,
            location: e.location,
            gachaColor: e.meta && e.meta.gachaColor,
            gachaIndex: e.meta && e.meta.gachaIndex != null ? e.meta.gachaIndex : i
          };
        })
      }
    };
  }

  function collapseGachaBatches(list) {
    if (!Array.isArray(list) || !list.length) return list || [];
    var batchMap = {};
    var hideIds = {};
    var i;

    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.type !== 'gacha' || (e.meta && e.meta.isBatch)) continue;
      var key = (e.meta && e.meta.gachaBatch) || e.gachaWeek || '';
      if (!key) continue;
      if (!batchMap[key]) batchMap[key] = [];
      batchMap[key].push(e);
    }

    Object.keys(batchMap).forEach(function (key) {
      var items = batchMap[key];
      if (items.length <= 1) return;
      items.forEach(function (item) { hideIds[item.id] = true; });
      batchMap[key] = synthesizeGachaBatchFromSiblings(items);
    });

    if (!Object.keys(hideIds).length) return list;

    var out = [];
    var inserted = {};
    for (i = 0; i < list.length; i++) {
      var entry = list[i];
      if (hideIds[entry.id]) {
        var batchKey = (entry.meta && entry.meta.gachaBatch) || entry.gachaWeek || '';
        if (batchKey && batchMap[batchKey] && !inserted[batchKey]) {
          out.push(batchMap[batchKey]);
          inserted[batchKey] = true;
        }
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  function resolveGachaEntry(entry) {
    if (!entry || entry.type !== 'gacha') return entry;
    if (entry.meta && entry.meta.isBatch) return entry;
    var st = store();
    if (!st || !st.getTimeline) return entry;
    var batchKey = (entry.meta && entry.meta.gachaBatch) || entry.gachaWeek || '';
    if (!batchKey) return entry;
    var siblings = st.getTimeline(state.contactId).filter(function (e) {
      return e && e.type === 'gacha' && !(e.meta && e.meta.isBatch) &&
        (((e.meta && e.meta.gachaBatch) || e.gachaWeek || '') === batchKey);
    });
    if (siblings.length <= 1) return entry;
    return synthesizeGachaBatchFromSiblings(siblings) || entry;
  }

  function renderGachaBatchPreview(capsules) {
    var list = Array.isArray(capsules) ? capsules : [];
    if (!list.length) return '';
    return (
      '<div class="cp-tl2-card__gacha-row">' +
        list.map(function (cap, idx) {
          return '<div class="cp-tl2-card__gacha-item" style="--tl-gi:' + idx + '">' +
            renderGachaCapsule(false, cap) +
          '</div>';
        }).join('') +
      '</div>'
    );
  }

  function renderGachaDetailHtml(entry, names) {
    var capsules = getGachaCapsules(entry);
    if (!capsules.length) return '';
    return (
      '<div class="cp-tl2-gacha-detail is-batch">' +
        '<span class="cp-tl2-gacha-detail__badge">Weekly Capsule ×' + capsules.length + '</span>' +
        '<div class="cp-tl2-gacha-detail__capsules">' +
          capsules.map(function (cap, idx) {
            return '<div class="cp-tl2-gacha-detail__cap" style="--tl-gi:' + idx + '">' +
              renderGachaCapsule(false, cap) +
            '</div>';
          }).join('') +
        '</div>' +
        '<ul class="cp-tl2-gacha-detail__list">' +
          capsules.map(function (cap) {
            return (
              '<li class="cp-tl2-gacha-detail__item">' +
                renderGachaCapsule(false, cap) +
                '<div class="cp-tl2-gacha-detail__copy">' +
                  '<h3 class="cp-tl2-gacha-detail__title">' + esc(cap.title || '小记忆') + '</h3>' +
                  (cap.body ? '<p class="cp-tl2-gacha-detail__body">' + esc(cap.body) + '</p>' : '') +
                  (cap.mood || cap.location
                    ? '<p class="cp-tl2-gacha-detail__meta">' + esc([cap.mood, cap.location].filter(Boolean).join(' · ')) + '</p>'
                    : '') +
                '</div>' +
              '</li>'
            );
          }).join('') +
        '</ul>' +
        '<span class="cp-tl2-gacha-detail__from">— ' + esc(names.charName) + ' 为你扭开</span>' +
      '</div>'
    );
  }

  function renderGachaCapsule(large, colorId) {
    var color = gachaColorId(colorId);
    return (
      '<div class="cp-gacha-capsule is-color-' + esc(color) + (large ? ' is-large' : '') + '" aria-hidden="true">' +
        '<div class="cp-gacha-capsule__glass"></div>' +
        '<div class="cp-gacha-capsule__band"></div>' +
        '<div class="cp-gacha-capsule__core"><span>✦</span></div>' +
        '<div class="cp-gacha-capsule__shine"></div>' +
      '</div>'
    );
  }

  function renderGachaSpinGrid() {
    return (
      '<div class="cp-tl2-gacha__spin-grid is-spinning" aria-hidden="true">' +
        GACHA_COLORS.map(function (color, idx) {
          return (
            '<div class="cp-tl2-gacha__spin-item" style="--tl-gi:' + idx + '">' +
              renderGachaCapsule(false, color) +
            '</div>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderGachaReveal(entries) {
    var entry = Array.isArray(entries) ? entries[0] : entries;
    if (!entry) return '';
    entry = resolveGachaEntry(entry);
    var capsules = getGachaCapsules(entry);
    if (!capsules.length) return '';
    return (
      '<div class="cp-tl2-gacha__reveal">' +
        '<div class="cp-tl2-gacha__reveal-capsules">' +
          capsules.map(function (cap, idx) {
            return (
              '<div class="cp-tl2-gacha__reveal-cap" style="--tl-gi:' + idx + '">' +
                renderGachaCapsule(false, cap) +
              '</div>'
            );
          }).join('') +
        '</div>' +
        '<ul class="cp-tl2-gacha__reveal-list">' +
          capsules.map(function (cap) {
            return (
              '<li>' +
                renderGachaCapsule(false, cap) +
                '<div class="cp-tl2-gacha__reveal-copy">' +
                  '<strong>' + esc(cap.title || '小记忆') + '</strong>' +
                  (cap.body ? '<span>' + esc(cap.body) + '</span>' : '') +
                '</div>' +
              '</li>'
            );
          }).join('') +
        '</ul>' +
        '<button type="button" class="cp-tl2-btn-primary" data-tl-gacha-view data-tl-id="' + esc(entry.id) + '">查看全部</button>' +
      '</div>'
    );
  }

  function entryTypeClass(type) {
    return ' is-type-' + String(type || 'memory').replace(/_/g, '-');
  }

  function renderEntryCard(entry, idx, names) {
    if (!entry) return '';
    var dp = parseDateParts(entry.dateIso);
    var cls = 'cp-tl2-card' + entryTypeClass(entry.type);
    if (entry.author === 'char') cls += ' is-char';
    if (entry.author === 'system') cls += ' is-system';
    if (isLetterEntry(entry)) cls += ' is-letter';
    if (idx % 2 === 1) cls += ' is-offset';
    var animDelay = Math.min(idx * 0.06, 0.48);

    var tag = TYPE_LABELS[entry.type] || '记忆';
    if (entry.type === 'sealed' && entry.author === 'char') tag = 'TA 的信';
    var authorHint = entry.author === 'char' ? names.charName :
      entry.author === 'user' ? names.profileName : '我们';

    var imgHtml = '';
    if (entry.blobId) {
      imgHtml = '<div class="cp-tl2-card__media" data-tl-blob="' + esc(entry.blobId) + '">' +
        '<div class="cp-tl2-card__media-ph"></div></div>';
    }

    var letterPreview = '';
    if (isLetterEntry(entry) && !entry.blobId) {
      letterPreview = renderEnvelopeMini({
        from: authorHint,
        to: entry.author === 'char' ? names.profileName : names.charName,
        fromChar: entry.author === 'char',
        sealed: entry.sealed,
        wax: entry.author === 'char' ? '✉' : '♡',
        className: 'cp-env--card'
      });
    }

    var gachaPreview = '';
    var gachaCountLine = '';
    if (entry.type === 'gacha') {
      var gachaCapsules = getGachaCapsules(entry);
      gachaPreview = renderGachaBatchPreview(gachaCapsules);
      if (gachaCapsules.length > 1) {
        gachaCountLine = '<p class="cp-tl2-card__body cp-tl2-card__body--gacha">' +
          esc(gachaCapsules.length + ' 颗记忆胶囊') + '</p>';
      }
    }

    var dualBadge = entry.dualPerspective && entry.charPerspective
      ? '<span class="cp-tl2-card__dual" aria-hidden="true">双视角</span>' : '';
    var echoBadge = entry.charEcho
      ? '<span class="cp-tl2-card__echo-dot" aria-hidden="true" title="有 TA 的回响"></span>' : '';

    var meta = [];
    if (entry.mood) meta.push(entry.mood);
    if (entry.location) meta.push(entry.location);

    return (
      '<article class="' + cls + '" data-tl-id="' + esc(entry.id) + '" style="--tl-delay:' + animDelay + 's">' +
        '<div class="cp-tl2-card__date">' +
          '<span class="cp-tl2-card__mon">' + esc(dp.month) + '</span>' +
          '<span class="cp-tl2-card__day">' + esc(dp.day) + '</span>' +
          '<span class="cp-tl2-card__yr">' + esc(dp.year) + '</span>' +
        '</div>' +
        '<div class="cp-tl2-card__main">' +
          '<div class="cp-tl2-card__top">' +
            '<span class="cp-tl2-card__tag">' + esc(tag) + '</span>' +
            dualBadge + echoBadge +
            '<span class="cp-tl2-card__who">' + esc(authorHint) + '</span>' +
          '</div>' +
          letterPreview + gachaPreview + imgHtml +
          '<h3 class="cp-tl2-card__title">' + esc(entry.title) + '</h3>' +
          gachaCountLine +
          (entry.body && !isLetterEntry(entry) && entry.type !== 'gacha'
            ? '<p class="cp-tl2-card__body">' + esc(entry.body) + '</p>' : '') +
          (isLetterEntry(entry) && entry.body
            ? '<p class="cp-tl2-card__body cp-tl2-card__body--letter">' + esc(letterPreviewText(entry.body, 120)) + '</p>' : '') +
          (meta.length ? '<p class="cp-tl2-card__meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function renderSealedCard(entry, idx, names) {
    var dp = parseDateParts(entry.dateIso);
    var animDelay = Math.min(idx * 0.08, 0.4);
    names = names || getSpaceNames(state.contactId);
    var fromChar = entry.author === 'char';
    var fromName = fromChar ? names.charName : names.profileName;
    var toName = fromChar ? names.profileName : names.charName;
    return (
      '<article class="cp-tl2-sealed' + (fromChar ? ' is-from-char' : '') + '" data-tl-sealed="' + esc(entry.id) + '" style="--tl-delay:' + animDelay + 's">' +
        renderEnvelopeMini({
          from: fromName,
          to: toName,
          fromChar: fromChar,
          sealed: true,
          wax: fromChar ? '✉' : '♡',
          showAddr: true,
          className: 'cp-env--sealed-card'
        }) +
        '<div class="cp-tl2-sealed__info">' +
          '<span class="cp-tl2-sealed__label">' + (fromChar ? 'TA 未拆的信' : '未拆的信') + '</span>' +
          '<span class="cp-tl2-sealed__date">' + esc(dp.year + '.' + dp.month + '.' + dp.day) + '</span>' +
          '<span class="cp-tl2-sealed__hint">' + esc(entry.title || '待到那一天') + '</span>' +
        '</div>' +
      '</article>'
    );
  }

  function renderOnThisDayCard(entry, names) {
    var dp = parseDateParts(entry.dateIso);
  var yearsAgo = '';
    var p = String(entry.dateIso || '').split('-');
    var t = todayIso().split('-');
    if (p[0] && t[0]) {
      var diff = Number(t[0]) - Number(p[0]);
      if (diff > 0) yearsAgo = diff + ' 年前';
    }
    return (
      '<button type="button" class="cp-tl2-otd-item" data-tl-id="' + esc(entry.id) + '">' +
        '<span class="cp-tl2-otd-item__yr">' + esc(yearsAgo || dp.year) + '</span>' +
        '<span class="cp-tl2-otd-item__title">' + esc(entry.title) + '</span>' +
        '<span class="cp-tl2-otd-item__arrow">→</span>' +
      '</button>'
    );
  }

  function hydrateImages(root) {
    if (!root) return;
    root.querySelectorAll('[data-tl-blob]').forEach(function (el) {
      var blobId = el.getAttribute('data-tl-blob');
      if (!blobId || el.dataset.tlLoaded) return;
      blobUrl(blobId).then(function (url) {
        if (!url) return;
        el.dataset.tlLoaded = '1';
        el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
        el.classList.add('is-loaded');
      });
    });
  }

  function renderStream() {
    var st = store();
    var stream = $('cp-tl2-stream');
    var empty = $('cp-tl2-empty');
    var sealedWrap = $('cp-tl2-sealed-wrap');
    var sealedList = $('cp-tl2-sealed-list');
    var otdWrap = $('cp-tl2-otd-wrap');
    var otdTrack = $('cp-tl2-otd-track');
    if (!stream || !st) return;

    var names = getSpaceNames(state.contactId);
    var sealed = st.getSealedTimeline ? st.getSealedTimeline(state.contactId) : [];
    var otd = st.getOnThisDayEntries ? st.getOnThisDayEntries(state.contactId) : [];
    var list = collapseGachaBatches(st.getVisibleTimeline ? st.getVisibleTimeline(state.contactId) : []);

    if (sealedWrap && sealedList) {
      sealedWrap.hidden = !sealed.length;
      sealedList.innerHTML = sealed.map(function (e, i) { return renderSealedCard(e, i, names); }).join('');
    }

    if (otdWrap && otdTrack) {
      otdWrap.hidden = !otd.length;
      otdTrack.innerHTML = otd.map(function (e) { return renderOnThisDayCard(e, names); }).join('');
    }

    if (!list.length) {
      stream.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    var byYear = {};
    list.forEach(function (e) {
      var y = String(e.dateIso || '').split('-')[0] || '—';
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(e);
    });
    var years = Object.keys(byYear).sort(function (a, b) { return Number(b) - Number(a); });
    var html = '';
    var globalIdx = 0;
    years.forEach(function (y) {
      html += '<div class="cp-tl2-year" data-tl-year="' + esc(y) + '">' +
        '<div class="cp-tl2-year__label"><span>' + esc(y) + '</span></div>' +
        '<div class="cp-tl2-year__cards">';
      byYear[y].forEach(function (entry) {
        html += renderEntryCard(entry, globalIdx, names);
        globalIdx += 1;
      });
      html += '</div></div>';
    });
    stream.innerHTML = html;
    hydrateImages(stream);
  }

  function renderHeader() {
    var names = getSpaceNames(state.contactId);
    var sub = $('cp-tl2-head-sub');
    var count = $('cp-tl2-head-count');
    var st = store();
    if (sub) sub.textContent = names.profileName + ' & ' + names.charName;
    if (count && st) {
      var visible = st.getVisibleTimeline ? st.getVisibleTimeline(state.contactId) : [];
      var n = collapseGachaBatches(visible).length;
      count.textContent = String(n).padStart(2, '0') + ' moments';
    }
    var gachaBtn = $('cp-tl2-gacha-btn');
    if (gachaBtn && st && st.canRunWeeklyGacha) {
      gachaBtn.classList.toggle('is-ready', st.canRunWeeklyGacha(state.contactId));
    }
  }

  function renderAll() {
    renderHeader();
    renderStream();
  }

  function renderGiftBoxScene() {
    return (
      '<div class="cp-gift-scene" aria-hidden="true">' +
        '<div class="cp-gift-box">' +
          '<div class="cp-gift-box__glow"></div>' +
          '<div class="cp-gift-box__shadow"></div>' +
          '<div class="cp-gift-box__body">' +
            '<div class="cp-gift-box__texture"></div>' +
            '<div class="cp-gift-box__shine"></div>' +
          '</div>' +
          '<div class="cp-gift-box__lid">' +
            '<div class="cp-gift-box__lid-face"></div>' +
            '<div class="cp-gift-box__lid-shine"></div>' +
          '</div>' +
          '<div class="cp-gift-box__ribbon cp-gift-box__ribbon--v"></div>' +
          '<div class="cp-gift-box__ribbon cp-gift-box__ribbon--h"></div>' +
          '<div class="cp-gift-box__bow">' +
            '<span class="cp-gift-box__bow-loop cp-gift-box__bow-loop--l"></span>' +
            '<span class="cp-gift-box__bow-loop cp-gift-box__bow-loop--r"></span>' +
            '<span class="cp-gift-box__bow-knot"></span>' +
            '<span class="cp-gift-box__bow-tail cp-gift-box__bow-tail--l"></span>' +
            '<span class="cp-gift-box__bow-tail cp-gift-box__bow-tail--r"></span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function detailAuthorName(entry, names) {
    if (entry.author === 'char') return names.charName;
    if (entry.author === 'user') return names.profileName;
    return '我们';
  }

  function renderDetailHero(entry) {
    if (entry.type === 'memory' && entry.blobId) {
      return (
        '<div class="cp-tl2-detail__hero is-polaroid">' +
          '<div class="cp-moment-polaroid">' +
            '<div class="cp-moment-polaroid__frame">' +
              '<div class="cp-moment-polaroid__photo" data-tl-blob="' + esc(entry.blobId) + '">' +
                '<div class="cp-moment-polaroid__photo-ph"><span class="cp-moment-polaroid__icon">✦</span></div>' +
              '</div>' +
              '<div class="cp-moment-polaroid__caption-line"></div>' +
              '<div class="cp-moment-polaroid__caption-line cp-moment-polaroid__caption-line--short"></div>' +
              '<span class="cp-moment-polaroid__tape cp-moment-polaroid__tape--l"></span>' +
              '<span class="cp-moment-polaroid__tape cp-moment-polaroid__tape--r"></span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }
    if (entry.type === 'commemoration') {
      return '<div class="cp-tl2-detail__hero is-gift">' + renderGiftBoxScene() + '</div>';
    }
    if (entry.type === 'milestone') {
      return (
        '<div class="cp-tl2-detail__hero is-milestone" aria-hidden="true">' +
          '<span class="cp-tl2-detail__milestone-star">✦</span>' +
        '</div>'
      );
    }
    if (entry.type === 'checkin_pin') {
      return (
        '<div class="cp-tl2-detail__hero is-checkin" aria-hidden="true">' +
          '<span class="cp-tl2-detail__checkin-pin">📍</span>' +
        '</div>'
      );
    }
    if (isLetterEntry(entry)) {
      return (
        '<div class="cp-tl2-detail__hero is-letter" aria-hidden="true">' +
          '<span class="cp-tl2-detail__letter-seal">' + (entry.author === 'char' ? '✉' : '♡') + '</span>' +
        '</div>'
      );
    }
    if (entry.type === 'gacha') {
      var caps = getGachaCapsules(resolveGachaEntry(entry));
      return (
        '<div class="cp-tl2-detail__hero is-gacha" aria-hidden="true">' +
          renderGachaCapsule(true, caps[0] || 'rose') +
        '</div>'
      );
    }
    return '';
  }

  function renderDetailContent(entry, names) {
    var dp = parseDateParts(entry.dateIso);
    var tag = TYPE_LABELS[entry.type] || '记忆';
    if (entry.type === 'sealed' && entry.author === 'char') tag = 'TA 的来信';

    var canDelete = entry.type !== 'milestone';
    var actions = canDelete
      ? '<button type="button" class="cp-tl2-btn-ghost cp-tl2-btn-danger" data-tl-delete>删除</button>'
      : '';

    var footExtra = '';
    if (entry.type === 'memory' && !entry.dualPerspective) {
      footExtra += '<button type="button" class="cp-tl2-btn-ghost" data-tl-request-dual>生成双视角</button>';
    }

    var bodyHtml = '';

    if (entry.type === 'gacha') {
      bodyHtml = renderGachaDetailHtml(resolveGachaEntry(entry), names);
    } else if (isLetterEntry(entry)) {
      var today = todayIso();
      var isDue = !entry.sealed || String(entry.dateIso) <= today;
      if (entry.sealed && !isDue) {
        bodyHtml =
          '<div class="cp-tl2-letter-detail is-sealed is-locked">' +
            renderEnvelopeMini({
              from: entry.author === 'char' ? names.charName : names.profileName,
              to: entry.author === 'char' ? names.profileName : names.charName,
              fromChar: entry.author === 'char',
              sealed: true,
              wax: entry.author === 'char' ? '✉' : '♡',
              showAddr: true,
              large: true,
              className: 'cp-env--detail'
            }) +
            '<p class="cp-tl2-letter-detail__hint">封存至 ' + esc(dp.year + '.' + dp.month + '.' + dp.day) + ' · 尚未到拆开的日子</p>' +
            (entry.title ? '<p class="cp-tl2-letter-detail__title">' + esc(entry.title) + '</p>' : '') +
          '</div>';
      } else if (entry.sealed && isDue) {
        bodyHtml =
          '<div class="cp-tl2-letter-detail is-sealed" data-tl-letter-open>' +
            renderEnvelopeMini({
              from: entry.author === 'char' ? names.charName : names.profileName,
              to: entry.author === 'char' ? names.profileName : names.charName,
              fromChar: entry.author === 'char',
              sealed: true,
              wax: entry.author === 'char' ? '✉' : '♡',
              showAddr: true,
              large: true,
              className: 'cp-env--detail'
            }) +
            '<p class="cp-tl2-letter-detail__hint">已到拆开的日子 · 轻触拆封</p>' +
            '<div class="cp-tl2-letter-detail__reveal" hidden>' +
              renderLetterPaper(entry, names, { reveal: true }) +
            '</div>' +
          '</div>';
      } else {
        bodyHtml =
          '<div class="cp-tl2-letter-detail is-open">' +
            renderEnvelopeMini({
              from: entry.author === 'char' ? names.charName : names.profileName,
              to: entry.author === 'char' ? names.profileName : names.charName,
              fromChar: entry.author === 'char',
              open: true,
              large: true,
              className: 'cp-env--detail'
            }) +
            renderLetterPaper(entry, names, { reveal: true }) +
          '</div>';
      }
    } else {
      var showPolaroidHero = entry.type === 'memory' && entry.blobId;
      var frontImg = entry.blobId && !showPolaroidHero
        ? '<div class="cp-tl2-flip__media" data-tl-blob="' + esc(entry.blobId) + '"><div class="cp-tl2-flip__media-ph"></div></div>'
        : '';

      var dualHtml = '';
      if (entry.dualPerspective && entry.charPerspective) {
        dualHtml =
          '<section class="cp-tl2-dual">' +
            '<div class="cp-tl2-dual__col is-user">' +
              '<span class="cp-tl2-dual__who">' + esc(names.profileName) + '</span>' +
              '<p>' + esc(entry.body || entry.title) + '</p>' +
            '</div>' +
            '<div class="cp-tl2-dual__divider" aria-hidden="true"></div>' +
            '<div class="cp-tl2-dual__col is-char">' +
              '<span class="cp-tl2-dual__who">' + esc(names.charName) + '</span>' +
              '<p>' + esc(entry.charPerspective) + '</p>' +
            '</div>' +
          '</section>';
      }

      var echoHtml = entry.charEcho
        ? '<div class="cp-tl2-flip__back-body">' +
            '<span class="cp-tl2-flip__back-label">TA 的回响</span>' +
            '<p class="cp-tl2-flip__echo">' + esc(entry.charEcho) + '</p>' +
            '<span class="cp-tl2-flip__echo-sign">— ' + esc(names.charName) + '</span>' +
          '</div>'
        : '<div class="cp-tl2-flip__back-body cp-tl2-flip__back-empty">' +
            '<p>还没有 TA 的回响</p>' +
            (entry.author === 'user' && entry.type === 'memory'
              ? '<button type="button" class="cp-tl2-btn-ghost" data-tl-request-echo>请 TA 写一句</button>'
              : '') +
          '</div>';

      var flipHint = entry.charEcho
        ? '<button type="button" class="cp-tl2-flip__hint" data-tl-flip-toggle><span class="cp-tl2-flip__hint-icon" aria-hidden="true">↻</span>轻触翻面 · TA 的回响</button>'
        : '';

      bodyHtml =
        '<div class="cp-tl2-flip' + (entry.charEcho ? ' has-echo' : '') + '" data-tl-flip tabindex="0" role="button" aria-label="记忆卡片 · 点击翻面">' +
          '<div class="cp-tl2-flip__inner">' +
            '<div class="cp-tl2-flip__face cp-tl2-flip__front">' +
              '<div class="cp-tl2-flip__front-inner">' +
                frontImg +
                '<h2 class="cp-tl2-flip__title">' + esc(entry.title) + '</h2>' +
                (entry.body && !dualHtml ? '<p class="cp-tl2-flip__body">' + esc(entry.body) + '</p>' : '') +
                dualHtml +
                flipHint +
              '</div>' +
            '</div>' +
            '<div class="cp-tl2-flip__face cp-tl2-flip__back">' +
              '<div class="cp-tl2-flip__back-inner">' +
                echoHtml +
                '<button type="button" class="cp-tl2-flip__hint" data-tl-flip-toggle><span class="cp-tl2-flip__hint-icon" aria-hidden="true">↻</span>翻回正面</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    var typeCls = entryTypeClass(entry.type);
    var authorName = detailAuthorName(entry, names);
    var metaBits = [entry.mood, entry.location].filter(Boolean);
    var hero = renderDetailHero(entry);

    return (
      '<button type="button" class="cp-tl2-detail__close" data-tl-detail-close aria-label="关闭">×</button>' +
      '<article class="cp-tl2-detail__card' + typeCls + ' is-author-' + esc(entry.author || 'user') + '">' +
        '<div class="cp-tl2-detail__grain" aria-hidden="true"></div>' +
        hero +
        '<header class="cp-tl2-detail__head">' +
          '<p class="cp-tl2-detail__eyebrow">' + esc(tag) + '</p>' +
          '<div class="cp-tl2-detail__date">' +
            '<span class="cp-tl2-detail__day">' + esc(dp.day) + '</span>' +
            '<span class="cp-tl2-detail__mon-yr">' + esc(dp.month) + ' · ' + esc(dp.year) + '</span>' +
          '</div>' +
          '<span class="cp-tl2-detail__who">' + esc(authorName) + '</span>' +
        '</header>' +
        (metaBits.length ? '<p class="cp-tl2-detail__meta">' + esc(metaBits.join(' · ')) + '</p>' : '') +
        '<div class="cp-tl2-detail__body">' + bodyHtml + '</div>' +
        '<footer class="cp-tl2-detail__foot">' + footExtra + actions + '</footer>' +
      '</article>'
    );
  }

  function openDetail(entryId) {
    var st = store();
    var entry = st && st.findTimelineEntry ? st.findTimelineEntry(state.contactId, entryId) : null;
    if (!entry) return;
    if (entry.type === 'gacha') entry = resolveGachaEntry(entry);
    state.detailId = entryId;
    var overlay = $('cp-tl2-detail');
    var inner = $('cp-tl2-detail-inner');
    if (!overlay || !inner) return;

    var names = getSpaceNames(state.contactId);
    inner.className = 'cp-tl2-detail__dialog' + entryTypeClass(entry.type);
    inner.innerHTML = renderDetailContent(entry, names);

    overlay.hidden = false;
    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
    });
    hydrateImages(inner);
  }

  function closeDetail() {
    var overlay = $('cp-tl2-detail');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay.hidden = true;
      var inner = $('cp-tl2-detail-inner');
      if (inner) {
        inner.innerHTML = '';
        inner.className = 'cp-tl2-detail__dialog';
      }
    }, 350);
    state.detailId = '';
  }

  function openLetterFullscreen(entryOrId) {
    var entry = entryOrId;
    if (!entry || typeof entry === 'string') {
      var st = store();
      entry = st && st.findTimelineEntry
        ? st.findTimelineEntry(state.contactId, String(entryOrId || ''))
        : null;
    }
    if (!entry || !isOpenLetterEntry(entry)) return;
    var overlay = $('cp-tl2-letter-fs');
    var inner = $('cp-tl2-letter-fs-inner');
    if (!overlay || !inner) return;
    var names = getSpaceNames(state.contactId);
    inner.innerHTML = renderLetterPaper(entry, names, { reveal: true, fullscreen: true });
    overlay.hidden = false;
    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
    });
  }

  function closeLetterFullscreen() {
    var overlay = $('cp-tl2-letter-fs');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay.hidden = true;
      var inner = $('cp-tl2-letter-fs-inner');
      if (inner) inner.innerHTML = '';
    }, 280);
  }

  function openMemoryCompose() {
    state.composeFiles = [];
    var overlay = $('cp-tl2-memory');
    if (!overlay) return;
    resetMemoryForm();
    renderMemoryPolaroid();
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    var inp = $('cp-tl2-memory-title-input');
    if (inp) inp.focus();
  }

  function closeMemoryCompose() {
    var overlay = $('cp-tl2-memory');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay.hidden = true;
      resetMemoryForm();
    }, 280);
  }

  function resetMemoryForm() {
    state.composeFiles = [];
    ['cp-tl2-memory-title-input', 'cp-tl2-memory-body', 'cp-tl2-memory-mood', 'cp-tl2-memory-location'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
    var dual = $('cp-tl2-memory-dual');
    if (dual) dual.checked = false;
    var echo = $('cp-tl2-memory-echo');
    if (echo) echo.checked = true;
    var dateEl = $('cp-tl2-memory-date');
    if (dateEl) dateEl.value = todayIso();
    renderMemoryPolaroid();
  }

  function renderMemoryPolaroid() {
    var photo = $('cp-tl2-memory-polaroid-photo');
    var pickBtn = $('cp-tl2-memory-pick');
    if (!photo) return;
    var file = state.composeFiles[0];
    var ph = photo.querySelector('.cp-moment-polaroid__photo-ph');
    if (file) {
      var url = '';
      try { url = URL.createObjectURL(file); } catch (e) { /* ignore */ }
      photo.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '') + '")' : '';
      photo.classList.add('has-photo');
      if (ph) ph.hidden = true;
      if (pickBtn) {
        pickBtn.innerHTML =
          '<span class="cp-tl2-memory__photo-btn-icon">↻</span>' +
          '<span class="cp-tl2-memory__photo-btn-text">更换照片</span>';
      }
    } else {
      photo.style.backgroundImage = '';
      photo.classList.remove('has-photo');
      if (ph) ph.hidden = false;
      if (pickBtn) {
        pickBtn.innerHTML =
          '<span class="cp-tl2-memory__photo-btn-icon">＋</span>' +
          '<span class="cp-tl2-memory__photo-btn-text">添加一张照片</span>';
      }
    }
  }

  function handleMemorySubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.createUserMemory !== 'function') {
      toast('模块未就绪');
      return;
    }
    var title = trim($('cp-tl2-memory-title-input') && $('cp-tl2-memory-title-input').value);
    var body = trim($('cp-tl2-memory-body') && $('cp-tl2-memory-body').value);
    var mood = trim($('cp-tl2-memory-mood') && $('cp-tl2-memory-mood').value);
    var location = trim($('cp-tl2-memory-location') && $('cp-tl2-memory-location').value);
    var dateIso = trim($('cp-tl2-memory-date') && $('cp-tl2-memory-date').value);
    var dual = $('cp-tl2-memory-dual') && $('cp-tl2-memory-dual').checked;
    var requestEcho = !($('cp-tl2-memory-echo') && $('cp-tl2-memory-echo').checked === false);
    if (!title) {
      toast('请填写标题');
      return;
    }
    closeMemoryCompose();
    var payload = {
      title: title,
      body: body,
      mood: mood,
      location: location,
      dateIso: dateIso,
      sealed: false,
      dualPerspective: !!dual,
      requestEcho: requestEcho
    };
    var loadingText = composeLoadingText(payload);
    setBtnBusy($('cp-tl2-memory-submit'), true, loadingText);
    setLoading(true, loadingText);
    br.createUserMemory(state.contactId, payload, state.composeFiles.slice()).then(function () {
      setLoading(false);
      setBtnBusy($('cp-tl2-memory-submit'), false);
      renderAll();
      dispatchUpdated();
      toast('已记入时光轴');
    }).catch(function (err) {
      setLoading(false);
      setBtnBusy($('cp-tl2-memory-submit'), false);
      toast(err && err.message ? err.message : '保存失败');
    });
  }

  function resetLetterForm() {
    ['cp-tl2-envletter-title-input', 'cp-tl2-envletter-body', 'cp-tl2-envletter-mood', 'cp-tl2-envletter-location'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
    var dateEl = $('cp-tl2-envletter-date');
    if (dateEl) {
      var d = new Date();
      d.setDate(d.getDate() + 7);
      dateEl.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }

  function openLetterCompose() {
    var overlay = $('cp-tl2-envletter');
    if (!overlay) return;
    var names = getSpaceNames(state.contactId);
    var fromEl = $('cp-tl2-envletter-from');
    var toEl = $('cp-tl2-envletter-to');
    if (fromEl) fromEl.textContent = names.profileName;
    if (toEl) toEl.textContent = names.charName;
    resetLetterForm();
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    var inp = $('cp-tl2-envletter-title-input');
    if (inp) inp.focus();
  }

  function closeLetterCompose() {
    var overlay = $('cp-tl2-envletter');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay.hidden = true;
      resetLetterForm();
    }, 280);
  }

  function handleLetterSubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.createUserMemory !== 'function') {
      toast('模块未就绪');
      return;
    }
    var title = trim($('cp-tl2-envletter-title-input') && $('cp-tl2-envletter-title-input').value);
    var body = trim($('cp-tl2-envletter-body') && $('cp-tl2-envletter-body').value);
    var mood = trim($('cp-tl2-envletter-mood') && $('cp-tl2-envletter-mood').value);
    var location = trim($('cp-tl2-envletter-location') && $('cp-tl2-envletter-location').value);
    var dateIso = trim($('cp-tl2-envletter-date') && $('cp-tl2-envletter-date').value);
    if (!title) {
      toast('请填写信笺抬头');
      return;
    }
    closeLetterCompose();
    setBtnBusy($('cp-tl2-envletter-submit'), true, '封蜡中…');
    setLoading(true, '封蜡中…');
    br.createUserMemory(state.contactId, {
      title: title,
      body: body,
      mood: mood,
      location: location,
      dateIso: dateIso,
      sealed: true,
      dualPerspective: false,
      requestEcho: false
    }, []).then(function () {
      setLoading(false);
      setBtnBusy($('cp-tl2-envletter-submit'), false);
      renderAll();
      dispatchUpdated();
      toast('信已封好');
    }).catch(function (err) {
      setLoading(false);
      setBtnBusy($('cp-tl2-envletter-submit'), false);
      toast(err && err.message ? err.message : '保存失败');
    });
  }

  function resetCommemForm() {
    ['cp-tl2-commem-title-input', 'cp-tl2-commem-body', 'cp-tl2-commem-mood', 'cp-tl2-commem-location'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
    var dateEl = $('cp-tl2-commem-date');
    if (dateEl) dateEl.value = todayIso();
  }

  function openCommemCompose() {
    var overlay = $('cp-tl2-commem');
    if (!overlay) return;
    resetCommemForm();
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    var inp = $('cp-tl2-commem-title-input');
    if (inp) inp.focus();
  }

  function closeCommemCompose() {
    var overlay = $('cp-tl2-commem');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay.hidden = true;
      resetCommemForm();
    }, 280);
  }

  function handleCommemSubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.createUserCommemoration !== 'function') {
      toast('模块未就绪');
      return;
    }
    var title = trim($('cp-tl2-commem-title-input') && $('cp-tl2-commem-title-input').value);
    var body = trim($('cp-tl2-commem-body') && $('cp-tl2-commem-body').value);
    var mood = trim($('cp-tl2-commem-mood') && $('cp-tl2-commem-mood').value);
    var location = trim($('cp-tl2-commem-location') && $('cp-tl2-commem-location').value);
    var dateIso = trim($('cp-tl2-commem-date') && $('cp-tl2-commem-date').value);
    if (!title) {
      toast('请填写标题');
      return;
    }
    closeCommemCompose();
    setBtnBusy($('cp-tl2-commem-submit'), true, '封存中…');
    setLoading(true, '封存中…');
    br.createUserCommemoration(state.contactId, {
      title: title,
      body: body,
      mood: mood,
      location: location,
      dateIso: dateIso
    }).then(function () {
      setLoading(false);
      setBtnBusy($('cp-tl2-commem-submit'), false);
      renderAll();
      dispatchUpdated();
      toast('已封入礼盒');
    }).catch(function (err) {
      setLoading(false);
      setBtnBusy($('cp-tl2-commem-submit'), false);
      toast(err && err.message ? err.message : '保存失败');
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function openGacha() {
    var overlay = $('cp-tl2-gacha');
    var st = store();
    if (!overlay) return;
    var can = st && st.canRunWeeklyGacha && st.canRunWeeklyGacha(state.contactId);
    var body = $('cp-tl2-gacha-body');
    var runBtn = $('cp-tl2-gacha-run');
    var result = $('cp-tl2-gacha-result');
    var capsule = $('cp-tl2-gacha-capsule');
    var status = $('cp-tl2-gacha-status');
    overlay.classList.remove('is-generating');
    if (status) status.hidden = true;
    if (result) {
      result.hidden = true;
      result.innerHTML = '';
    }
    if (capsule) {
      capsule.classList.remove('is-spinning', 'is-opened');
      capsule.innerHTML = can ? renderGachaSpinGrid().replace(' is-spinning', '') : renderGachaCapsule(true);
    }
    if (body) {
      body.hidden = false;
      body.innerHTML = can
        ? '<p class="cp-tl2-gacha__intro">扭开本周胶囊，一次扭出七颗不同颜色的记忆——TA 会从你们的日常里挖出七件小事。</p>' +
          '<p class="cp-tl2-gacha__sub">Capsule · Weekly Drop ×7</p>'
        : '<p class="cp-tl2-gacha__intro cp-tl2-gacha__done">本周已扭过 · 下周再来</p>';
    }
    if (runBtn) {
      runBtn.hidden = !can;
      setBtnBusy(runBtn, false);
    }
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
  }

  function openCharLetter() {
    var overlay = $('cp-tl2-char-letter');
    var names = getSpaceNames(state.contactId);
    var sealedRow = $('cp-tl2-char-letter-sealed-row');
    var dateEl = $('cp-tl2-char-letter-date');
    var envBox = $('cp-tl2-char-letter-env');
    var status = $('cp-tl2-char-letter-status');
    if (overlay) overlay.classList.remove('is-generating');
    setBtnBusy($('cp-tl2-char-letter-submit'), false);
    if (status) status.hidden = true;
    if (envBox) {
      envBox.innerHTML = renderEnvelopeMini({
        from: names.charName,
        to: names.profileName,
        fromChar: true,
        wax: '✉',
        showAddr: true,
        large: true,
        className: 'cp-env--compose'
      });
    }
    var sealedChk = $('cp-tl2-char-letter-sealed');
    if (sealedChk) sealedChk.checked = false;
    if (sealedRow) sealedRow.hidden = true;
    if (dateEl) {
      var d = new Date();
      d.setDate(d.getDate() + 14);
      dateEl.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    if (overlay) overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
  }

  function closeCharLetter() {
    var overlay = $('cp-tl2-char-letter');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () { overlay.hidden = true; }, 260);
  }

  function handleCharLetterSubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.generateCharLetter !== 'function') {
      toast('来信模块未就绪');
      return;
    }
    var sealedChk = $('cp-tl2-char-letter-sealed');
    var dateEl = $('cp-tl2-char-letter-date');
    var isSealed = !!(sealedChk && sealedChk.checked);
    var dateIso = trim(dateEl && dateEl.value);
    var loadingText = isSealed ? '正在封存来信…' : '正在动笔…';
    setCharLetterGenerating(true, loadingText);
    var watchdog = setTimeout(function () {
      if (!state.busy) return;
      setCharLetterGenerating(false);
      toast('来信生成超时，请重试');
    }, 300000);
    br.generateCharLetter(state.contactId, {
      sealed: isSealed,
      dateIso: dateIso
    }).then(function (entry) {
      clearTimeout(watchdog);
      setCharLetterGenerating(false);
      closeCharLetter();
      renderAll();
      dispatchUpdated();
      toast(isSealed ? 'TA 的信已封好，待到那天拆开' : '收到 TA 的来信');
      if (entry && entry.id && !isSealed) openLetterFullscreen(entry);
    }).catch(function (err) {
      clearTimeout(watchdog);
      setCharLetterGenerating(false);
      toast(err && err.message ? err.message : '来信失败');
    });
  }

  function toggleFlipCard(flipEl) {
    if (!flipEl || !flipEl.classList.contains('has-echo')) return;
    flipEl.classList.toggle('is-flipped');
  }

  function openSealedLetter(entryId) {
    openDetail(entryId);
  }

  function revealLetterInDetail(root) {
    if (!root) return;
    var wrap = root.querySelector('[data-tl-letter-open]');
    if (!wrap || wrap.classList.contains('is-opened')) return;
    wrap.classList.add('is-opened');
    var env = wrap.querySelector('.cp-env');
    if (env) env.classList.add('is-open');
    var reveal = wrap.querySelector('.cp-tl2-letter-detail__reveal');
    if (reveal) reveal.hidden = false;
    var hint = wrap.querySelector('.cp-tl2-letter-detail__hint');
    if (hint) hint.textContent = '已拆封';
  }

  function closeGacha() {
    var overlay = $('cp-tl2-gacha');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(function () { overlay.hidden = true; }, 260);
  }

  function handleGachaRun() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.generateWeeklyGacha !== 'function') {
      toast('扭蛋模块未就绪');
      return;
    }
    var capsule = $('cp-tl2-gacha-capsule');
    var body = $('cp-tl2-gacha-body');
    if (capsule) {
      capsule.classList.add('is-spinning');
      capsule.innerHTML = renderGachaSpinGrid();
    }
    if (body) body.hidden = true;
    setGachaGenerating(true, '扭蛋生成中…');
    br.generateWeeklyGacha(state.contactId).then(function (entries) {
      var list = Array.isArray(entries) ? entries : (entries ? [entries] : []);
      setGachaGenerating(false);
      if (capsule) {
        capsule.classList.remove('is-spinning');
        capsule.classList.add('is-opened');
        capsule.innerHTML = renderGachaSpinGrid().replace(' is-spinning', '');
      }
      var result = $('cp-tl2-gacha-result');
      var runBtn = $('cp-tl2-gacha-run');
      if (runBtn) runBtn.hidden = true;
      if (result && list.length) {
        result.hidden = false;
        result.innerHTML = renderGachaReveal(list);
      }
      renderHeader();
      renderStream();
      dispatchUpdated();
      toast('本周扭出 ' + (list[0] ? getGachaCapsules(list[0]).length : 0) + ' 颗记忆胶囊');
    }).catch(function (err) {
      setGachaGenerating(false);
      if (capsule) {
        capsule.classList.remove('is-spinning', 'is-opened');
        capsule.innerHTML = renderGachaSpinGrid().replace(' is-spinning', '');
      }
      if (body) body.hidden = false;
      toast(err && err.message ? err.message : '扭蛋失败');
    });
  }

  function handleDelete(entryId) {
    var st = store();
    if (!st || !st.removeTimelineEntry) return;
    if (!confirm('确定删除这条记忆？')) return;
    var entry = st.findTimelineEntry ? st.findTimelineEntry(state.contactId, entryId) : null;
    if (entry && entry.type === 'gacha') entry = resolveGachaEntry(entry);
    if (entry && entry.meta && Array.isArray(entry.meta._legacyIds) && entry.meta._legacyIds.length) {
      entry.meta._legacyIds.forEach(function (id) {
        st.removeTimelineEntry(state.contactId, id);
      });
    } else {
      st.removeTimelineEntry(state.contactId, entryId);
    }
    closeDetail();
    renderAll();
    dispatchUpdated();
    toast('已删除');
  }

  function handleEnrich(entryId, opts) {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.enrichEntry !== 'function') return;
    var loadingText = opts.echo ? '生成回响中…' : '生成双视角中…';
    setLoading(true, loadingText);
    var detailInner = $('cp-tl2-detail-inner');
    if (detailInner) {
      detailInner.querySelectorAll('[data-tl-request-echo], [data-tl-request-dual]').forEach(function (btn) {
        setBtnBusy(btn, true, '生成中…');
      });
    }
    br.enrichEntry(state.contactId, entryId, opts).then(function () {
      setLoading(false);
      openDetail(entryId);
      renderStream();
      dispatchUpdated();
      toast('生成完成');
    }).catch(function () {
      setLoading(false);
      if (detailInner) {
        detailInner.querySelectorAll('[data-tl-request-echo], [data-tl-request-dual]').forEach(function (btn) {
          setBtnBusy(btn, false);
        });
      }
      toast('生成失败');
    });
  }

  function bindEvents() {
    var back = $('cp-tl2-back');
    if (back) {
      back.addEventListener('click', function () {
        close();
        if (global.miyaCoupleApp && typeof global.miyaCoupleApp.showSpaceView === 'function') {
          global.miyaCoupleApp.showSpaceView();
        }
      });
    }

    var addBtn = $('cp-tl2-fab');
    if (addBtn) addBtn.addEventListener('click', openMemoryCompose);

    var memorySubmit = $('cp-tl2-memory-submit');
    if (memorySubmit) memorySubmit.addEventListener('click', handleMemorySubmit);

    var memoryClose = $('cp-tl2-memory-close');
    if (memoryClose) memoryClose.addEventListener('click', closeMemoryCompose);

    var memoryOverlay = $('cp-tl2-memory');
    if (memoryOverlay) {
      memoryOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-memory-close]') || e.target.classList.contains('cp-tl2-memory__backdrop')) {
          closeMemoryCompose();
        }
      });
    }

    var memoryPick = $('cp-tl2-memory-pick');
    var memoryFile = $('cp-tl2-memory-file');
    if (memoryPick && memoryFile) {
      memoryPick.addEventListener('click', function () { if (!state.busy) memoryFile.click(); });
    }
    if (memoryFile) {
      memoryFile.addEventListener('change', function () {
        var files = memoryFile.files ? Array.prototype.slice.call(memoryFile.files) : [];
        memoryFile.value = '';
        if (files[0]) state.composeFiles = [files[0]];
        renderMemoryPolaroid();
      });
    }
    var polaroidPhoto = $('cp-tl2-memory-polaroid-photo');
    if (polaroidPhoto && memoryFile) {
      polaroidPhoto.addEventListener('click', function () { if (!state.busy) memoryFile.click(); });
    }

    var sealedBtn = $('cp-tl2-sealed-btn');
    if (sealedBtn) sealedBtn.addEventListener('click', openLetterCompose);

    var envletterSubmit = $('cp-tl2-envletter-submit');
    if (envletterSubmit) envletterSubmit.addEventListener('click', handleLetterSubmit);

    var envletterClose = $('cp-tl2-envletter-close');
    if (envletterClose) envletterClose.addEventListener('click', closeLetterCompose);

    var envletterOverlay = $('cp-tl2-envletter');
    if (envletterOverlay) {
      envletterOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-envletter-close]') || e.target.classList.contains('cp-tl2-envletter__backdrop')) {
          closeLetterCompose();
        }
      });
    }

    var commemBtn = $('cp-tl2-commem-btn');
    if (commemBtn) commemBtn.addEventListener('click', openCommemCompose);

    var commemSubmit = $('cp-tl2-commem-submit');
    if (commemSubmit) commemSubmit.addEventListener('click', handleCommemSubmit);

    var commemClose = $('cp-tl2-commem-close');
    if (commemClose) commemClose.addEventListener('click', closeCommemCompose);

    var commemOverlay = $('cp-tl2-commem');
    if (commemOverlay) {
      commemOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-commem-close]') || e.target.classList.contains('cp-tl2-commem__backdrop')) {
          closeCommemCompose();
        }
      });
    }

    var gachaBtn = $('cp-tl2-gacha-btn');
    if (gachaBtn) gachaBtn.addEventListener('click', openGacha);

    var charLetterBtn = $('cp-tl2-char-letter-btn');
    if (charLetterBtn) charLetterBtn.addEventListener('click', openCharLetter);

    var charLetterSubmit = $('cp-tl2-char-letter-submit');
    if (charLetterSubmit) charLetterSubmit.addEventListener('click', handleCharLetterSubmit);

    var charLetterClose = $('cp-tl2-char-letter-close');
    if (charLetterClose) charLetterClose.addEventListener('click', closeCharLetter);

    var charLetterSealed = $('cp-tl2-char-letter-sealed');
    var charLetterSealedRow = $('cp-tl2-char-letter-sealed-row');
    if (charLetterSealed && charLetterSealedRow) {
      charLetterSealed.addEventListener('change', function () {
        charLetterSealedRow.hidden = !charLetterSealed.checked;
      });
    }

    var charLetterOverlay = $('cp-tl2-char-letter');
    if (charLetterOverlay) {
      charLetterOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-char-letter-close]') || e.target.classList.contains('cp-tl2-char-letter__backdrop')) {
          closeCharLetter();
        }
      });
    }

    var gachaRun = $('cp-tl2-gacha-run');
    if (gachaRun) gachaRun.addEventListener('click', handleGachaRun);

    var gachaClose = $('cp-tl2-gacha-close');
    if (gachaClose) gachaClose.addEventListener('click', closeGacha);

    var stream = $('cp-tl2-stream');
    var otdTrack = $('cp-tl2-otd-track');
    function onCardClick(e) {
      var card = e.target.closest('[data-tl-id]');
      if (!card) return;
      var id = card.getAttribute('data-tl-id');
      var st = store();
      var entry = st && st.findTimelineEntry ? st.findTimelineEntry(state.contactId, id) : null;
      if (entry && isOpenLetterEntry(entry)) {
        openLetterFullscreen(entry);
        return;
      }
      openDetail(id);
    }
    if (stream) stream.addEventListener('click', onCardClick);
    if (otdTrack) otdTrack.addEventListener('click', onCardClick);

    var sealedListEl = $('cp-tl2-sealed-list');
    if (sealedListEl) {
      sealedListEl.addEventListener('click', function (e) {
        var card = e.target.closest('[data-tl-sealed]');
        if (!card) return;
        openSealedLetter(card.getAttribute('data-tl-sealed'));
      });
    }

    var detailOverlay = $('cp-tl2-detail');
    if (detailOverlay) {
      detailOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-detail-close]') || e.target === detailOverlay.querySelector('.cp-tl2-detail__backdrop')) {
          closeDetail();
          return;
        }
        if (e.target.closest('[data-tl-flip-toggle]')) {
          toggleFlipCard(detailOverlay.querySelector('[data-tl-flip]'));
          return;
        }
        var flipCard = e.target.closest('[data-tl-flip]');
        if (flipCard && flipCard.classList.contains('has-echo') &&
            !e.target.closest('[data-tl-request-echo]') &&
            !e.target.closest('.cp-tl2-btn-ghost')) {
          toggleFlipCard(flipCard);
          return;
        }
        if (e.target.closest('[data-tl-letter-open]')) {
          revealLetterInDetail(detailOverlay);
          return;
        }
        if (e.target.closest('[data-tl-delete]')) {
          handleDelete(state.detailId);
          return;
        }
        if (e.target.closest('[data-tl-request-echo]')) {
          handleEnrich(state.detailId, { echo: true });
          return;
        }
        if (e.target.closest('[data-tl-request-dual]')) {
          handleEnrich(state.detailId, { dual: true });
        }
      });
      detailOverlay.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var flipCard = e.target.closest('[data-tl-flip]');
        if (flipCard && flipCard.classList.contains('has-echo')) {
          e.preventDefault();
          toggleFlipCard(flipCard);
        }
      });
    }

    var gachaOverlay = $('cp-tl2-gacha');
    if (gachaOverlay) {
      gachaOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-tl-gacha-close]') || e.target.classList.contains('cp-tl2-gacha__backdrop')) {
          closeGacha();
        }
        var view = e.target.closest('[data-tl-gacha-view]');
        if (view) {
          closeGacha();
          openDetail(view.getAttribute('data-tl-id'));
        }
      });
    }

    var letterFsOverlay = $('cp-tl2-letter-fs');
    if (letterFsOverlay) {
      letterFsOverlay.addEventListener('click', function (e) {
        if (e.target.closest('.cp-letter-paper')) return;
        closeLetterFullscreen();
      });
    }
  }

  bindEvents();

  global.miyaCoupleTimeline = {
    open: open,
    close: close,
    renderAll: renderAll,
    renderStream: renderStream
  };
})(typeof window !== 'undefined' ? window : global);
