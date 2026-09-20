/**
 * miya-deep-couple.js — 深入 · 角色手机 情侣手册（莫兰迪粉白 · 秘密档案卷宗）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var RAIL = [
    { id: 'cover', label: '封面' },
    { id: 'atlas', label: '图鉴' },
    { id: 'secret', label: '机密' },
    { id: 'pulse', label: '心跳' },
    { id: 'ritual', label: '仪式' },
    { id: 'memory', label: '碎片' },
    { id: 'wish', label: '愿望' },
    { id: 'dict', label: '词典' },
    { id: 'letter', label: '未寄' },
    { id: 'bond', label: '默契' }
  ];

  var SIDE_LABEL = { me: '我方', you: '对方', us: '我们' };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    coupleData: null,
    refreshing: false,
    rail: 'cover',
    built: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function coupleStore() { return global.miyaDeepCoupleStore || null; }
  function coupleBridge() { return global.miyaDeepCoupleBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-couple-toast');
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
    var text = $('dp-couple-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的情侣手册');
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
    var bar = $('dp-couple-status');
    var text = $('dp-couple-status-text');
    if (!bar || !text) return;
    var data = state.coupleData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的情侣手册';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '档案已归档';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-couple__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-couple__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-couple-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.coupleData && state.coupleData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.coupleData && state.coupleData.couple ? state.coupleData.couple : null;
  }

  function hasContent(cp) {
    if (!cp) return false;
    return !!(
      trim(cp.openLetter) ||
      trim(cp.summary) ||
      (cp.loveAtlas && cp.loveAtlas.length) ||
      (cp.secretFiles && cp.secretFiles.length) ||
      (cp.heartbeatLog && cp.heartbeatLog.length) ||
      (cp.coupleRituals && cp.coupleRituals.length) ||
      (cp.memoryShards && cp.memoryShards.length) ||
      (cp.wishDrawer && cp.wishDrawer.length) ||
      (cp.privateDictionary && cp.privateDictionary.length) ||
      (cp.confessionQueue && cp.confessionQueue.length) ||
      (cp.promiseLedger && cp.promiseLedger.length) ||
      (cp.sceneTickets && cp.sceneTickets.length) ||
      (cp.nightNotes && cp.nightNotes.length) ||
      (cp.bondQuiz && cp.bondQuiz.length) ||
      (cp.moodForecast && cp.moodForecast.length) ||
      trim(cp.footerSeal)
    );
  }

  function trim(s) { return String(s || '').trim(); }

  function persistPayload() {
    var ts = coupleStore();
    if (!ts || !state.contactId || !state.coupleData) return Promise.resolve(null);
    return ts.patchCouple(state.contactId, { couple: state.coupleData.couple }).then(function (saved) {
      state.coupleData = saved;
      return saved;
    });
  }

  function findIn(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  function secHead(kicker, title, sub) {
    return (
      '<header class="dp-couple__sec-head">' +
        '<span class="dp-couple__sec-kicker">' + esc(kicker) + '</span>' +
        '<h2 class="dp-couple__sec-title">' + esc(title) + '</h2>' +
        (sub ? '<p class="dp-couple__sec-sub">' + esc(sub) + '</p>' : '') +
      '</header>'
    );
  }

  function renderRail() {
    var el = $('dp-couple-rail');
    if (!el) return;
    var has = hasContent(getPayload());
    el.hidden = !has;
    if (!has) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = RAIL.map(function (r) {
      return (
        '<button type="button" class="dp-couple__tab' + (state.rail === r.id ? ' is-on' : '') + '" data-act="rail" data-rail="' + r.id + '">' +
          '<span>' + esc(r.label) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function showPanel(id) {
    RAIL.forEach(function (r) {
      var panel = $('dp-couple-panel-' + r.id);
      if (panel) panel.hidden = r.id !== id;
    });
    state.rail = id;
    renderRail();
  }

  function intimacyRingHtml(index) {
    var v = Math.max(0, Math.min(100, Number(index) || 0));
    var r = 42;
    var c = 2 * Math.PI * r;
    var offset = c - (v / 100) * c;
    return (
      '<div class="dp-couple__ring" aria-hidden="true">' +
        '<svg viewBox="0 0 100 100">' +
          '<circle class="dp-couple__ring-track" cx="50" cy="50" r="' + r + '" fill="none"/>' +
          '<circle class="dp-couple__ring-fill" cx="50" cy="50" r="' + r + '" fill="none" ' +
            'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
        '</svg>' +
        '<div class="dp-couple__ring-num">' + v + '</div>' +
      '</div>'
    );
  }

  function renderCover(cp) {
    var el = $('dp-couple-panel-cover');
    if (!el) return;
    if (!cp || !hasContent(cp)) {
      el.innerHTML = '';
      return;
    }
    var hero = cp.hero || {};
    var alias = hero.partnerAlias || state.contactName || 'ta';
    el.innerHTML =
      '<div class="dp-couple__cover">' +
        '<div class="dp-couple__cover-meta">' +
          '<span class="dp-couple__stamp">' + esc(hero.coverStamp || 'PRIVATE') + '</span>' +
          '<span class="dp-couple__file-no">' + esc(cp.fileNo || 'CP-····') + '</span>' +
        '</div>' +
        '<p class="dp-couple__date">' + esc(cp.dateLabel || '') + '</p>' +
        '<h1 class="dp-couple__cover-title">' + esc(hero.coverTitle || '恋爱秘密档案') + '</h1>' +
        '<p class="dp-couple__cover-alias">档案对象 · ' + esc(alias) + '</p>' +
        '<div class="dp-couple__cover-body">' +
          intimacyRingHtml(hero.intimacyIndex) +
          '<div class="dp-couple__cover-side">' +
            '<p class="dp-couple__intimacy-label">' + esc(hero.intimacyLabel || '亲密度') + '</p>' +
            (hero.statusLine ? '<p class="dp-couple__status-line">' + esc(hero.statusLine) + '</p>' : '') +
            (hero.softVow ? '<blockquote class="dp-couple__vow">「' + esc(hero.softVow) + '」</blockquote>' : '') +
          '</div>' +
        '</div>' +
        (cp.summary ? '<p class="dp-couple__summary">' + esc(cp.summary) + '</p>' : '') +
        (cp.openLetter
          ? '<article class="dp-couple__letter">' +
              '<span class="dp-couple__letter-label">开卷私信</span>' +
              '<p>' + esc(cp.openLetter) + '</p>' +
            '</article>'
          : '') +
        (cp.moodForecast && cp.moodForecast.length
          ? '<div class="dp-couple__forecast">' +
              secHead('FORECAST', '心情预报', '接下来几天 ta 对你们的感觉') +
              '<div class="dp-couple__forecast-row">' +
                cp.moodForecast.map(function (f) {
                  return (
                    '<div class="dp-couple__forecast-card">' +
                      '<strong>' + esc(f.day) + '</strong>' +
                      (f.mood ? '<em>' + esc(f.mood) + '</em>' : '') +
                      (f.note ? '<p>' + esc(f.note) + '</p>' : '') +
                    '</div>'
                  );
                }).join('') +
              '</div>' +
            '</div>'
          : '') +
        (cp.nightNotes && cp.nightNotes.length
          ? '<div class="dp-couple__nights">' +
              secHead('NIGHT', '夜记', '深夜留给对方的几行') +
              cp.nightNotes.map(function (n) {
                return (
                  '<div class="dp-couple__night">' +
                    (n.time ? '<time>' + esc(n.time) + '</time>' : '') +
                    '<p>' + esc(n.text) + '</p>' +
                  '</div>'
                );
              }).join('') +
            '</div>'
          : '') +
        (cp.footerSeal ? '<p class="dp-couple__seal">' + esc(cp.footerSeal) + '</p>' : '') +
      '</div>';
  }

  function renderAtlas(cp) {
    var el = $('dp-couple-panel-atlas');
    if (!el) return;
    var items = cp && cp.loveAtlas || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>图鉴页空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('ATLAS', '恋爱图鉴', '按章节整理的相处轨迹') +
      '<div class="dp-couple__atlas">' +
        items.map(function (a) {
          return (
            '<article class="dp-couple__chapter' + (a.starred ? ' is-starred' : '') + '">' +
              '<button type="button" class="dp-couple__star" data-act="star-atlas" data-id="' + esc(a.id) + '" aria-label="收藏章节">' +
                (a.starred ? '★' : '☆') +
              '</button>' +
              '<div class="dp-couple__chapter-meta">' +
                '<span class="dp-couple__chapter-no">' + esc(a.chapter) + '</span>' +
                (a.when ? '<span>' + esc(a.when) + '</span>' : '') +
                (a.mood ? '<span class="dp-couple__mood">' + esc(a.mood) + '</span>' : '') +
              '</div>' +
              '<h3>' + esc(a.title) + '</h3>' +
              (a.body ? '<p>' + esc(a.body) + '</p>' : '') +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderSecret(cp) {
    var el = $('dp-couple-panel-secret');
    if (!el) return;
    var items = cp && cp.secretFiles || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>无密封档案</p></div>';
      return;
    }
    el.innerHTML =
      secHead('SECRET', '机密夹', '轻触拆封 · 仍可再次合上') +
      '<div class="dp-couple__secrets">' +
        items.map(function (s) {
          return (
            '<button type="button" class="dp-couple__envelope' + (s.unsealed ? ' is-open' : '') + '" data-act="unseal" data-id="' + esc(s.id) + '">' +
              '<div class="dp-couple__envelope-top">' +
                '<strong>' + esc(s.title) + '</strong>' +
                '<span>' + esc(s.grade || 'CONFIDENTIAL') + '</span>' +
              '</div>' +
              '<p>' + (s.unsealed ? esc(s.content) : '━━ 密封中 · 轻触拆封 ━━') + '</p>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderPulse(cp) {
    var el = $('dp-couple-panel-pulse');
    if (!el) return;
    var items = cp && cp.heartbeatLog || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>心跳日志为空</p></div>';
      return;
    }
    el.innerHTML =
      secHead('PULSE', '心跳日志', '展开可读完整脉搏笔记') +
      '<ol class="dp-couple__pulse-list">' +
        items.map(function (h) {
          return (
            '<li class="dp-couple__pulse' + (h.expanded ? ' is-open' : '') + '">' +
              '<button type="button" data-act="pulse" data-id="' + esc(h.id) + '">' +
                '<div class="dp-couple__pulse-head">' +
                  (h.time ? '<time>' + esc(h.time) + '</time>' : '<time>·</time>') +
                  (h.beat ? '<em>' + esc(h.beat) + '</em>' : '') +
                '</div>' +
                '<p>' + esc(h.expanded || h.note.length < 42 ? h.note : (h.note.slice(0, 36) + '…')) + '</p>' +
              '</button>' +
            '</li>'
          );
        }).join('') +
      '</ol>';
  }

  function renderRitual(cp) {
    var el = $('dp-couple-panel-ritual');
    if (!el) return;
    var rituals = cp && cp.coupleRituals || [];
    var promises = cp && cp.promiseLedger || [];
    var tickets = cp && cp.sceneTickets || [];
    if (!rituals.length && !promises.length && !tickets.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>仪式与账本空白</p></div>';
      return;
    }
    var html = secHead('RITUAL', '仪式与约定', '可勾选完成 · 可盖章收藏');
    if (rituals.length) {
      html +=
        '<div class="dp-couple__rituals">' +
          rituals.map(function (r) {
            return (
              '<button type="button" class="dp-couple__ritual' + (r.done ? ' is-done' : '') + '" data-act="ritual" data-id="' + esc(r.id) + '">' +
                '<i class="dp-couple__check" aria-hidden="true"></i>' +
                '<div>' +
                  '<strong>' + esc(r.title) + '</strong>' +
                  (r.cadence ? '<em>' + esc(r.cadence) + '</em>' : '') +
                  (r.note ? '<p>' + esc(r.note) + '</p>' : '') +
                '</div>' +
              '</button>'
            );
          }).join('') +
        '</div>';
    }
    if (promises.length) {
      html +=
        '<div class="dp-couple__promises">' +
          '<p class="dp-couple__mini-label">承诺账本</p>' +
          promises.map(function (p) {
            return (
              '<button type="button" class="dp-couple__promise' + (p.kept ? ' is-kept' : '') + '" data-act="promise" data-id="' + esc(p.id) + '">' +
                '<span class="dp-couple__promise-side">' + esc(SIDE_LABEL[p.side] || '我们') + '</span>' +
                '<p>' + esc(p.text) + '</p>' +
                '<span class="dp-couple__promise-mark">' + (p.kept ? '已守住' : '轻触标记') + '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>';
    }
    if (tickets.length) {
      html +=
        '<div class="dp-couple__tickets">' +
          '<p class="dp-couple__mini-label">幻想约会票根</p>' +
          '<div class="dp-couple__ticket-row">' +
            tickets.map(function (t) {
              return (
                '<button type="button" class="dp-couple__ticket' + (t.stamped ? ' is-stamped' : '') + '" data-act="stamp" data-id="' + esc(t.id) + '">' +
                  '<strong>' + esc(t.title) + '</strong>' +
                  '<div class="dp-couple__ticket-meta">' +
                    (t.when ? '<span>' + esc(t.when) + '</span>' : '') +
                    (t.place ? '<span>' + esc(t.place) + '</span>' : '') +
                  '</div>' +
                  (t.detail ? '<p>' + esc(t.detail) + '</p>' : '') +
                  '<span class="dp-couple__ticket-stamp">' + (t.stamped ? 'COLLECTED' : '盖章收藏') + '</span>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  function renderMemory(cp) {
    var el = $('dp-couple-panel-memory');
    if (!el) return;
    var items = cp && cp.memoryShards || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>还没有记忆碎片</p></div>';
      return;
    }
    el.innerHTML =
      secHead('MEMORY', '记忆碎片', '轻触翻转 · 看背面私语') +
      '<div class="dp-couple__shards">' +
        items.map(function (m) {
          return (
            '<button type="button" class="dp-couple__shard' + (m.flipped ? ' is-flipped' : '') + '" data-act="flip" data-id="' + esc(m.id) + '">' +
              '<div class="dp-couple__shard-inner">' +
                '<div class="dp-couple__shard-face dp-couple__shard-face--front">' +
                  '<span>SHARD</span>' +
                  '<strong>' + esc(m.front) + '</strong>' +
                  (m.place ? '<em>' + esc(m.place) + '</em>' : '') +
                  '<small>轻触翻转</small>' +
                '</div>' +
                '<div class="dp-couple__shard-face dp-couple__shard-face--back">' +
                  '<p>' + esc(m.back || '（空白）') + '</p>' +
                '</div>' +
              '</div>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderWish(cp) {
    var el = $('dp-couple-panel-wish');
    if (!el) return;
    var items = cp && cp.wishDrawer || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>愿望抽屉是空的</p></div>';
      return;
    }
    el.innerHTML =
      secHead('WISH', '愿望抽屉', '收藏 ta 想和你做的事') +
      '<div class="dp-couple__wishes">' +
        items.map(function (w) {
          return (
            '<button type="button" class="dp-couple__wish' + (w.starred ? ' is-starred' : '') + '" data-act="star-wish" data-id="' + esc(w.id) + '">' +
              '<span class="dp-couple__wish-star">' + (w.starred ? '★' : '☆') + '</span>' +
              '<div>' +
                (w.tone ? '<em>' + esc(w.tone) + '</em>' : '') +
                '<p>' + esc(w.text) + '</p>' +
              '</div>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderDict(cp) {
    var el = $('dp-couple-panel-dict');
    if (!el) return;
    var items = cp && cp.privateDictionary || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>私密词典尚未编纂</p></div>';
      return;
    }
    el.innerHTML =
      secHead('LEXICON', '私密词典', '只有两人懂的词条') +
      '<dl class="dp-couple__dict">' +
        items.map(function (d) {
          return (
            '<div class="dp-couple__dict-item">' +
              '<dt>' + esc(d.word) + '</dt>' +
              '<dd>' +
                (d.meaning ? '<p>' + esc(d.meaning) + '</p>' : '') +
                (d.usage ? '<span>用法 · ' + esc(d.usage) + '</span>' : '') +
              '</dd>' +
            '</div>'
          );
        }).join('') +
      '</dl>';
  }

  function renderLetter(cp) {
    var el = $('dp-couple-panel-letter');
    if (!el) return;
    var items = cp && cp.confessionQueue || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>没有未寄出的信</p></div>';
      return;
    }
    el.innerHTML =
      secHead('UNSENT', '未寄出的信', '轻触拆开 · 读完可合上') +
      '<div class="dp-couple__confessions">' +
        items.map(function (c) {
          return (
            '<button type="button" class="dp-couple__mail' + (c.revealed ? ' is-open' : '') + '" data-act="reveal" data-id="' + esc(c.id) + '">' +
              '<div class="dp-couple__mail-top">' +
                '<strong>' + esc(c.title) + '</strong>' +
                (c.urgency ? '<span>' + esc(c.urgency) + '</span>' : '') +
              '</div>' +
              '<p>' + (c.revealed ? esc(c.content) : '信还折着 · 轻触拆开') + '</p>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderBond(cp) {
    var el = $('dp-couple-panel-bond');
    if (!el) return;
    var items = cp && cp.bondQuiz || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-couple__void"><p>默契小测空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('QUIZ', '默契小测', '先想答案，再揭晓 ta 的版本') +
      '<div class="dp-couple__quiz">' +
        items.map(function (q, i) {
          return (
            '<article class="dp-couple__quiz-card' + (q.revealed ? ' is-open' : '') + '">' +
              '<span class="dp-couple__quiz-no">Q' + (i + 1) + '</span>' +
              '<h3>' + esc(q.q) + '</h3>' +
              (!q.revealed && q.hint ? '<p class="dp-couple__quiz-hint">提示 · ' + esc(q.hint) + '</p>' : '') +
              (q.revealed
                ? '<p class="dp-couple__quiz-ans">' + esc(q.a || '（未写答案）') + '</p>'
                : '<button type="button" class="dp-couple__quiz-btn" data-act="quiz" data-id="' + esc(q.id) + '">揭晓答案</button>') +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderEmpty(has) {
    var empty = $('dp-couple-empty');
    if (!empty) return;
    empty.hidden = !!has;
  }

  function buildFullUI() {
    var cp = getPayload();
    var has = hasContent(cp);
    renderRail();
    renderCover(cp);
    renderAtlas(cp);
    renderSecret(cp);
    renderPulse(cp);
    renderRitual(cp);
    renderMemory(cp);
    renderWish(cp);
    renderDict(cp);
    renderLetter(cp);
    renderBond(cp);
    renderEmpty(has);
    if (has) showPanel(state.rail || 'cover');
    else {
      RAIL.forEach(function (r) {
        var panel = $('dp-couple-panel-' + r.id);
        if (panel) panel.hidden = true;
      });
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadCoupleData(contactId) {
    var ts = coupleStore();
    if (!ts) return Promise.resolve(null);
    return ts.getCouple(contactId).then(function (data) {
      state.coupleData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-couple-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = coupleStore();
    var br = coupleBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchCouple(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的情侣手册',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.coupleData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateCouple(contactId, phoneData, {});
    }).then(function (result) {
      state.rail = 'cover';
      return ts.patchCouple(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        couple: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.coupleData = saved;
        state.refreshing = false;
        if (state.open) {
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchCouple(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.coupleData = saved;
          state.refreshing = false;
          if (state.open) {
            updateStatusBar();
            updateRefreshBtn();
          }
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
    if (state.refreshing || (state.coupleData && state.coupleData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function patchListItem(listKey, id, mutator, rerender) {
    var cp = getPayload();
    if (!cp || !cp[listKey]) return;
    var item = findIn(cp[listKey], id);
    if (!item) return;
    mutator(item);
    rerender(cp);
    persistPayload();
  }

  function onRootClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    ev.preventDefault();
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');

    if (act === 'couple-back') {
      close();
      return;
    }
    if (act === 'couple-refresh') {
      handleRefresh();
      return;
    }
    if (act === 'rail') {
      showPanel(btn.getAttribute('data-rail') || 'cover');
      return;
    }
    if (act === 'unseal') {
      patchListItem('secretFiles', id, function (s) { s.unsealed = !s.unsealed; }, renderSecret);
      return;
    }
    if (act === 'pulse') {
      patchListItem('heartbeatLog', id, function (h) { h.expanded = !h.expanded; }, renderPulse);
      return;
    }
    if (act === 'ritual') {
      patchListItem('coupleRituals', id, function (r) { r.done = !r.done; }, renderRitual);
      return;
    }
    if (act === 'promise') {
      patchListItem('promiseLedger', id, function (p) { p.kept = !p.kept; }, renderRitual);
      return;
    }
    if (act === 'stamp') {
      patchListItem('sceneTickets', id, function (t) { t.stamped = !t.stamped; }, renderRitual);
      return;
    }
    if (act === 'flip') {
      patchListItem('memoryShards', id, function (m) { m.flipped = !m.flipped; }, renderMemory);
      return;
    }
    if (act === 'star-wish') {
      patchListItem('wishDrawer', id, function (w) { w.starred = !w.starred; }, renderWish);
      return;
    }
    if (act === 'star-atlas') {
      patchListItem('loveAtlas', id, function (a) { a.starred = !a.starred; }, renderAtlas);
      return;
    }
    if (act === 'reveal') {
      patchListItem('confessionQueue', id, function (c) { c.revealed = !c.revealed; }, renderLetter);
      return;
    }
    if (act === 'quiz') {
      patchListItem('bondQuiz', id, function (q) { q.revealed = true; }, renderBond);
    }
  }

  function bindEvents() {
    var root = $('dp-couple');
    if (!root || root._dpCoupleBound) return;
    root._dpCoupleBound = true;
    root.addEventListener('click', onRootClick);

    global.addEventListener('miya-deep-couple-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      if (activeJobs[cid] || state.refreshing) return;
      loadCoupleData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-couple');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.rail = 'cover';
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadCoupleData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          coupleStore().patchCouple(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.coupleData = fixed;
            buildFullUI();
          });
          return;
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      buildFullUI();
    });
  }

  function close() {
    var layer = $('dp-couple');
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

  global.miyaDeepCouple = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
