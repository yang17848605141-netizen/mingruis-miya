/**
 * miya-deep-game.js — 深入 · 角色手机 游戏（雾感手账）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var FOLIOS = [
    { id: 'cover', label: '封面', roman: '00' },
    { id: 'choice', label: '抉择', roman: '01' },
    { id: 'cipher', label: '翻牌', roman: '02' },
    { id: 'arena', label: '默契', roman: '03' },
    { id: 'thermo', label: '心温', roman: '04' },
    { id: 'scene', label: '剧本', roman: '05' },
    { id: 'lot', label: '抽签', roman: '06' },
    { id: 'mission', label: '任务', roman: '07' },
    { id: 'stamp', label: '戳章', roman: '08' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    gameData: null,
    refreshing: false,
    folio: 'cover',
    cipherPick: [],
    thermoDraft: {},
    built: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;
  var cipherLock = false;

  function gameStore() { return global.miyaDeepGameStore || null; }
  function gameBridge() { return global.miyaDeepGameBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-game-toast');
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
    var text = $('dp-game-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的游戏数据');
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
    var bar = $('dp-game-status');
    var text = $('dp-game-status-text');
    if (!bar || !text) return;
    var data = state.gameData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的游戏数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '对局已归档';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-game__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-game__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-game-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.gameData && state.gameData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.gameData && state.gameData.game ? state.gameData.game : null;
  }

  function hasContent(g) {
    if (!g) return false;
    return !!(
      trim(g.briefing) ||
      trim(g.summary) ||
      (g.choiceFiles && g.choiceFiles.length) ||
      (g.cipherDeck && g.cipherDeck.length) ||
      (g.bondArena && g.bondArena.length) ||
      (g.thermoRounds && g.thermoRounds.length) ||
      (g.sceneReel && g.sceneReel.length) ||
      (g.lotDrawer && g.lotDrawer.length) ||
      (g.missionBoard && g.missionBoard.length) ||
      (g.stampRack && g.stampRack.length) ||
      trim(g.footerSeal)
    );
  }

  function findIn(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  function persistPayload() {
    var ts = gameStore();
    if (!ts || !state.contactId || !state.gameData) return Promise.resolve(null);
    return ts.patchGame(state.contactId, { game: state.gameData.game }).then(function (saved) {
      state.gameData = saved;
      return saved;
    });
  }

  function calcEarned(g) {
    if (!g) return 0;
    var score = 0;
    (g.choiceFiles || []).forEach(function (c) {
      if (!c || !c.picked) return;
      var opt = findIn(c.options, c.picked);
      if (opt) score += Number(opt.score) || 0;
    });
    (g.cipherDeck || []).forEach(function (c) {
      if (c && c.matched) score += 1;
    });
    (g.bondArena || []).forEach(function (q) {
      if (q && q.answered >= 0) {
        score += q.answered === q.correct ? 3 : 1;
      }
    });
    (g.thermoRounds || []).forEach(function (t) {
      if (!t || !t.resolved || t.guess == null) return;
      var diff = Math.abs(Number(t.guess) - Number(t.target));
      if (diff <= Number(t.tolerance)) score += 4;
      else if (diff <= Number(t.tolerance) * 2) score += 2;
      else score += 1;
    });
    (g.sceneReel || []).forEach(function (s) {
      if (s && s.choiceIndex >= 0) score += 2;
    });
    (g.lotDrawer || []).forEach(function (l) {
      if (l && l.drawn) score += 1;
    });
    (g.missionBoard || []).forEach(function (m) {
      if (m && m.done) score += 2;
    });
    return score;
  }

  function syncStamps(g) {
    if (!g || !g.stampRack) return;
    var choicesDone = (g.choiceFiles || []).filter(function (c) { return c && c.picked; }).length;
    var matched = (g.cipherDeck || []).filter(function (c) { return c && c.matched; }).length;
    var arenaDone = (g.bondArena || []).filter(function (q) { return q && q.answered >= 0; }).length;
    var thermoDone = (g.thermoRounds || []).filter(function (t) { return t && t.resolved; }).length;
    var scenesDone = (g.sceneReel || []).filter(function (s) { return s && s.choiceIndex >= 0; }).length;
    var lots = (g.lotDrawer || []).filter(function (l) { return l && l.drawn; }).length;
    var missions = (g.missionBoard || []).filter(function (m) { return m && m.done; }).length;
    var flags = [
      choicesDone >= 1,
      matched >= 2,
      arenaDone >= 2,
      thermoDone >= 1 || scenesDone >= 1 || lots >= 2 || missions >= 2
    ];
    g.stampRack.forEach(function (st, i) {
      if (st && flags[i]) st.unlocked = true;
    });
  }

  function refreshDock() {
    var g = getPayload();
    var dock = $('dp-game-dock');
    if (!dock) return;
    if (!hasContent(g)) {
      dock.hidden = true;
      return;
    }
    g.earnedScore = calcEarned(g);
    syncStamps(g);
    dock.hidden = false;
    var alias = (g.hero && g.hero.opponentAlias) || state.contactName || 'ta';
    var affinity = (g.hero && g.hero.affinityLabel) || '对局进行中';
    dock.innerHTML =
      '<div class="dp-game__dock-inner">' +
        '<div class="dp-game__dock-score">' +
          '<span class="dp-game__dock-kicker">SCORE</span>' +
          '<strong>' + esc(String(g.earnedScore || 0)) + '</strong>' +
        '</div>' +
        '<div class="dp-game__dock-meta">' +
          '<span class="dp-game__dock-affinity">' + esc(affinity) + '</span>' +
          '<span class="dp-game__dock-alias">with · ' + esc(alias) + '</span>' +
        '</div>' +
        '<div class="dp-game__dock-file">' + esc(g.fileNo || 'GM-····') + '</div>' +
      '</div>';
  }

  function secHead(kicker, title, sub) {
    return (
      '<header class="dp-game__sec-head">' +
        '<span class="dp-game__sec-kicker">' + esc(kicker) + '</span>' +
        '<h2 class="dp-game__sec-title">' + esc(title) + '</h2>' +
        (sub ? '<p class="dp-game__sec-sub">' + esc(sub) + '</p>' : '') +
      '</header>'
    );
  }

  function renderTabs() {
    var el = $('dp-game-tabs');
    if (!el) return;
    var has = hasContent(getPayload());
    el.hidden = !has;
    if (!has) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = FOLIOS.map(function (f) {
      return (
        '<button type="button" class="dp-game__tab' + (state.folio === f.id ? ' is-on' : '') + '" data-act="folio" data-folio="' + f.id + '">' +
          '<em>' + esc(f.roman) + '</em>' +
          '<span>' + esc(f.label) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderSpine() {
    var el = $('dp-game-spine');
    if (!el) return;
    var has = hasContent(getPayload());
    el.hidden = !has;
    if (!has) {
      el.innerHTML = '';
      return;
    }
    var g = getPayload();
    el.innerHTML =
      '<div class="dp-game__spine-inner">' +
        '<span class="dp-game__spine-class">' + esc((g && g.classification) || 'FILE') + '</span>' +
        FOLIOS.map(function (f) {
          return (
            '<button type="button" class="dp-game__spine-mark' + (state.folio === f.id ? ' is-on' : '') + '" data-act="folio" data-folio="' + f.id + '" aria-label="' + esc(f.label) + '">' +
              esc(f.roman) +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function showFolio(id) {
    FOLIOS.forEach(function (f) {
      var panel = $('dp-game-panel-' + f.id);
      if (panel) panel.hidden = f.id !== id;
    });
    state.folio = id;
    renderTabs();
    renderSpine();
  }

  function renderCover(g) {
    var el = $('dp-game-panel-cover');
    if (!el) return;
    if (!g || !hasContent(g)) {
      el.innerHTML = '';
      return;
    }
    var hero = g.hero || {};
    el.innerHTML =
      '<div class="dp-game__cover">' +
        '<div class="dp-game__cover-meta">' +
          '<span class="dp-game__badge">' + esc(hero.clearance || g.classification || 'CONFIDENTIAL') + '</span>' +
          '<span class="dp-game__file-no">' + esc(g.fileNo || 'GM-····') + '</span>' +
        '</div>' +
        (g.dateLabel ? '<p class="dp-game__date">' + esc(g.dateLabel) + '</p>' : '') +
        '<h1 class="dp-game__cover-title">' + esc(hero.title || '机密对局卷宗') + '</h1>' +
        (hero.subtitle ? '<p class="dp-game__cover-sub">' + esc(hero.subtitle) + '</p>' : '') +
        '<p class="dp-game__cover-alias">✦ playfile · ' + esc(hero.opponentAlias || state.contactName || 'ta') + '</p>' +
        (hero.statusLine ? '<p class="dp-game__status-line">' + esc(hero.statusLine) + '</p>' : '') +
        (g.briefing ? '<blockquote class="dp-game__briefing">' + esc(g.briefing) + '</blockquote>' : '') +
        (g.summary ? '<p class="dp-game__summary">' + esc(g.summary) + '</p>' : '') +
        (g.footerSeal ? '<p class="dp-game__seal">— ' + esc(g.footerSeal) + ' —</p>' : '') +
      '</div>';
  }

  function renderChoice(g) {
    var el = $('dp-game-panel-choice');
    if (!el) return;
    var items = g && g.choiceFiles || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>抉择页空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('BRANCH', '抉择卷', '点选一条路，读取 ta 的反应') +
      '<div class="dp-game__choice-list">' +
        items.map(function (c, i) {
          var picked = c.picked ? findIn(c.options, c.picked) : null;
          return (
            '<article class="dp-game__choice' + (picked ? ' is-done' : '') + '">' +
              '<div class="dp-game__choice-top">' +
                '<span class="dp-game__choice-no">CASE ' + String(i + 1).padStart(2, '0') + '</span>' +
                '<h3>' + esc(c.title) + '</h3>' +
              '</div>' +
              (c.setup ? '<p class="dp-game__choice-setup">' + esc(c.setup) + '</p>' : '') +
              (picked
                ? (
                  '<div class="dp-game__choice-result">' +
                    '<span class="dp-game__pill">已选 · ' + esc(picked.label) + ' · +' + esc(String(picked.score || 0)) + '</span>' +
                    '<p>' + esc(picked.reaction || '') + '</p>' +
                    '<button type="button" class="dp-game__ghost" data-act="choice-reset" data-id="' + esc(c.id) + '">重选</button>' +
                  '</div>'
                )
                : (
                  '<div class="dp-game__opts">' +
                    (c.options || []).map(function (o) {
                      return (
                        '<button type="button" class="dp-game__opt" data-act="choice-pick" data-id="' + esc(c.id) + '" data-opt="' + esc(o.id) + '">' +
                          '<span>' + esc(o.label) + '</span>' +
                        '</button>'
                      );
                    }).join('') +
                  '</div>'
                )) +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderCipher(g) {
    var el = $('dp-game-panel-cipher');
    if (!el) return;
    var items = g && g.cipherDeck || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>牌面空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('DECODE', '翻牌解码', '翻开两张配对 · 读出暗号') +
      '<div class="dp-game__cipher-grid">' +
        items.map(function (c) {
          var open = c.flipped || c.matched;
          return (
            '<button type="button" class="dp-game__cipher' + (open ? ' is-open' : '') + (c.matched ? ' is-matched' : '') + '" data-act="cipher" data-id="' + esc(c.id) + '"' + (c.matched ? ' disabled' : '') + '>' +
              '<span class="dp-game__cipher-face">' +
                '<span class="dp-game__cipher-front">' + esc(c.face) + '</span>' +
                '<span class="dp-game__cipher-back">' + esc(c.back) + '</span>' +
              '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderArena(g) {
    var el = $('dp-game-panel-arena');
    if (!el) return;
    var items = g && g.bondArena || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>默契对战空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('ARENA', '默契对战', '猜 ta 会选哪一句') +
      '<div class="dp-game__arena-list">' +
        items.map(function (q, i) {
          var answered = q.answered >= 0;
          var ok = answered && q.answered === q.correct;
          return (
            '<article class="dp-game__arena' + (answered ? (ok ? ' is-ok' : ' is-miss') : '') + '">' +
              '<span class="dp-game__arena-no">Q' + (i + 1) + '</span>' +
              '<h3>' + esc(q.q) + '</h3>' +
              '<div class="dp-game__opts">' +
                (q.choices || []).map(function (ch, idx) {
                  var cls = 'dp-game__opt';
                  if (answered) {
                    if (idx === q.correct) cls += ' is-correct';
                    if (idx === q.answered && idx !== q.correct) cls += ' is-wrong';
                  }
                  return (
                    '<button type="button" class="' + cls + '" data-act="arena" data-id="' + esc(q.id) + '" data-idx="' + idx + '"' + (answered ? ' disabled' : '') + '>' +
                      '<span>' + esc(ch) + '</span>' +
                    '</button>'
                  );
                }).join('') +
              '</div>' +
              (answered && q.explain ? '<p class="dp-game__explain">' + esc(q.explain) + '</p>' : '') +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderThermo(g) {
    var el = $('dp-game-panel-thermo');
    if (!el) return;
    var items = g && g.thermoRounds || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>心温空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('THERMO', '心温对局', '滑动猜测 · 提交对照真相') +
      '<div class="dp-game__thermo-list">' +
        items.map(function (t) {
          var draft = state.thermoDraft[t.id];
          if (draft == null) draft = t.guess != null ? t.guess : 50;
          var note = '';
          if (t.resolved && t.guess != null) {
            var diff = Math.abs(Number(t.guess) - Number(t.target));
            if (diff <= Number(t.tolerance)) note = t.hitNote;
            else if (Number(t.guess) < Number(t.target)) note = t.coldNote;
            else note = t.hotNote;
          }
          return (
            '<article class="dp-game__thermo' + (t.resolved ? ' is-done' : '') + '">' +
              '<h3>' + esc(t.prompt) + '</h3>' +
              '<div class="dp-game__thermo-row">' +
                '<span>0°</span>' +
                '<input type="range" min="0" max="100" value="' + esc(String(draft)) + '" data-act="thermo-slide" data-id="' + esc(t.id) + '"' + (t.resolved ? ' disabled' : '') + '>' +
                '<span>100°</span>' +
              '</div>' +
              '<div class="dp-game__thermo-val"><em id="dp-game-thermo-val-' + esc(t.id) + '">' + esc(String(draft)) + '</em>°</div>' +
              (!t.resolved
                ? '<button type="button" class="dp-game__solid" data-act="thermo-submit" data-id="' + esc(t.id) + '">提交猜测</button>'
                : (
                  '<div class="dp-game__thermo-result">' +
                    '<span class="dp-game__pill">真相 · ' + esc(String(t.target)) + '°</span>' +
                    (note ? '<p>' + esc(note) + '</p>' : '') +
                  '</div>'
                )) +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderScene(g) {
    var el = $('dp-game-panel-scene');
    if (!el) return;
    var items = g && g.sceneReel || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>剧本空白</p></div>';
      return;
    }
    el.innerHTML =
      secHead('REEL', '剧本转盘', '读开场 · 选一句台词') +
      '<div class="dp-game__scene-list">' +
        items.map(function (s) {
          var picked = s.choiceIndex >= 0 && s.choices ? s.choices[s.choiceIndex] : null;
          return (
            '<article class="dp-game__scene' + (picked ? ' is-done' : '') + '">' +
              '<div class="dp-game__scene-meta">' +
                '<h3>' + esc(s.title) + '</h3>' +
                (s.setting ? '<span>' + esc(s.setting) + '</span>' : '') +
              '</div>' +
              (s.body ? '<p class="dp-game__scene-body">' + esc(s.body) + '</p>' : '') +
              (picked
                ? (
                  '<div class="dp-game__choice-result">' +
                    '<span class="dp-game__pill">台词 · ' + esc(picked.label) + '</span>' +
                    '<p>' + esc(picked.nextNote || '') + '</p>' +
                  '</div>'
                )
                : (
                  '<div class="dp-game__opts">' +
                    (s.choices || []).map(function (ch, idx) {
                      return (
                        '<button type="button" class="dp-game__opt" data-act="scene" data-id="' + esc(s.id) + '" data-idx="' + idx + '">' +
                          '<span>' + esc(ch.label) + '</span>' +
                        '</button>'
                      );
                    }).join('') +
                  '</div>'
                )) +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderLot(g) {
    var el = $('dp-game-panel-lot');
    if (!el) return;
    var items = g && g.lotDrawer || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>抽签匣空</p></div>';
      return;
    }
    el.innerHTML =
      secHead('LOTS', '抽签匣', '抽出一支 · 展开签文') +
      '<div class="dp-game__lot-grid">' +
        items.map(function (l) {
          return (
            '<button type="button" class="dp-game__lot' + (l.drawn ? ' is-drawn' : '') + '" data-act="lot" data-id="' + esc(l.id) + '">' +
              '<span class="dp-game__lot-kind">' + esc(l.kind) + '</span>' +
              '<strong>' + esc(l.drawn ? l.back || l.front : l.front) + '</strong>' +
              '<em>' + (l.drawn ? '已展开' : '轻触抽取') + '</em>' +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderMission(g) {
    var el = $('dp-game-panel-mission');
    if (!el) return;
    var items = g && g.missionBoard || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>任务板空</p></div>';
      return;
    }
    el.innerHTML =
      secHead('MISSION', '秘密任务板', '打卡 ta 悄悄布置的任务') +
      '<div class="dp-game__mission-list">' +
        items.map(function (m) {
          return (
            '<label class="dp-game__mission' + (m.done ? ' is-done' : '') + '" data-act="mission" data-id="' + esc(m.id) + '">' +
              '<input type="checkbox"' + (m.done ? ' checked' : '') + '>' +
              '<div>' +
                '<h3>' + esc(m.title) + '</h3>' +
                (m.detail ? '<p>' + esc(m.detail) + '</p>' : '') +
                (m.reward ? '<span class="dp-game__pill">奖 · ' + esc(m.reward) + '</span>' : '') +
              '</div>' +
            '</label>'
          );
        }).join('') +
      '</div>';
  }

  function renderStamp(g) {
    var el = $('dp-game-panel-stamp');
    if (!el) return;
    var items = g && g.stampRack || [];
    if (!items.length) {
      el.innerHTML = '<div class="dp-game__void"><p>戳章架空</p></div>';
      return;
    }
    el.innerHTML =
      secHead('STAMP', '通关戳章', '玩得越多 · 章盖得越满') +
      '<div class="dp-game__stamp-grid">' +
        items.map(function (s) {
          return (
            '<article class="dp-game__stamp' + (s.unlocked ? ' is-on' : '') + '">' +
              '<div class="dp-game__stamp-seal">' + esc(s.unlocked ? 'OK' : '—') + '</div>' +
              '<h3>' + esc(s.name) + '</h3>' +
              (s.condition ? '<p class="dp-game__stamp-cond">' + esc(s.condition) + '</p>' : '') +
              (s.unlocked && s.flavor ? '<p class="dp-game__stamp-flavor">' + esc(s.flavor) + '</p>' : '') +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderEmpty(has) {
    var empty = $('dp-game-empty');
    if (!empty) return;
    empty.hidden = !!has;
  }

  function buildFullUI() {
    var g = getPayload();
    var has = hasContent(g);
    renderTabs();
    renderSpine();
    renderCover(g);
    renderChoice(g);
    renderCipher(g);
    renderArena(g);
    renderThermo(g);
    renderScene(g);
    renderLot(g);
    renderMission(g);
    renderStamp(g);
    renderEmpty(has);
    refreshDock();
    if (has) showFolio(state.folio || 'cover');
    else {
      FOLIOS.forEach(function (f) {
        var panel = $('dp-game-panel-' + f.id);
        if (panel) panel.hidden = true;
      });
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadGameData(contactId) {
    var ts = gameStore();
    if (!ts) return Promise.resolve(null);
    return ts.getGame(contactId).then(function (data) {
      state.gameData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-game-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = gameStore();
    var br = gameBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchGame(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的游戏数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.gameData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateGame(contactId, phoneData, {});
    }).then(function (result) {
      state.folio = 'cover';
      state.cipherPick = [];
      state.thermoDraft = {};
      return ts.patchGame(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        game: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.gameData = saved;
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
      return ts.patchGame(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.gameData = saved;
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
    if (state.refreshing || (state.gameData && state.gameData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function afterPlay(rerender) {
    var g = getPayload();
    if (!g) return;
    g.earnedScore = calcEarned(g);
    syncStamps(g);
    if (typeof rerender === 'function') rerender(g);
    refreshDock();
    persistPayload();
  }

  function handleCipher(id) {
    var g = getPayload();
    if (!g || cipherLock) return;
    var card = findIn(g.cipherDeck, id);
    if (!card || card.matched || card.flipped) return;
    card.flipped = true;
    state.cipherPick.push(card.id);
    renderCipher(g);
    if (state.cipherPick.length < 2) {
      persistPayload();
      return;
    }
    var a = findIn(g.cipherDeck, state.cipherPick[0]);
    var b = findIn(g.cipherDeck, state.cipherPick[1]);
    state.cipherPick = [];
    if (a && b && a.pairKey && a.pairKey === b.pairKey && a.id !== b.id) {
      a.matched = true;
      b.matched = true;
      afterPlay(renderCipher);
      toast('配对成功');
      return;
    }
    cipherLock = true;
    setTimeout(function () {
      if (a) a.flipped = false;
      if (b) b.flipped = false;
      cipherLock = false;
      renderCipher(getPayload());
      persistPayload();
    }, 720);
  }

  function onRootClick(ev) {
    var t = ev.target;
    if (t && t.matches && t.matches('input[type="range"]')) return;

    var btn = t && t.closest ? t.closest('[data-act]') : null;
    if (!btn) return;

    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');

    if (act === 'game-back') {
      ev.preventDefault();
      close();
      return;
    }
    if (act === 'game-refresh') {
      ev.preventDefault();
      handleRefresh();
      return;
    }
    if (act === 'folio') {
      ev.preventDefault();
      showFolio(btn.getAttribute('data-folio') || 'cover');
      return;
    }
    if (act === 'choice-pick') {
      ev.preventDefault();
      var g1 = getPayload();
      var item = findIn(g1 && g1.choiceFiles, id);
      if (!item || item.picked) return;
      item.picked = btn.getAttribute('data-opt');
      afterPlay(renderChoice);
      return;
    }
    if (act === 'choice-reset') {
      ev.preventDefault();
      var g2 = getPayload();
      var ch = findIn(g2 && g2.choiceFiles, id);
      if (!ch) return;
      ch.picked = null;
      afterPlay(renderChoice);
      return;
    }
    if (act === 'cipher') {
      ev.preventDefault();
      handleCipher(id);
      return;
    }
    if (act === 'arena') {
      ev.preventDefault();
      var g3 = getPayload();
      var q = findIn(g3 && g3.bondArena, id);
      if (!q || q.answered >= 0) return;
      q.answered = Number(btn.getAttribute('data-idx'));
      afterPlay(renderArena);
      return;
    }
    if (act === 'thermo-submit') {
      ev.preventDefault();
      var g4 = getPayload();
      var th = findIn(g4 && g4.thermoRounds, id);
      if (!th || th.resolved) return;
      var val = state.thermoDraft[id];
      if (val == null) val = 50;
      th.guess = Number(val);
      th.resolved = true;
      afterPlay(renderThermo);
      return;
    }
    if (act === 'scene') {
      ev.preventDefault();
      var g5 = getPayload();
      var sc = findIn(g5 && g5.sceneReel, id);
      if (!sc || sc.choiceIndex >= 0) return;
      sc.choiceIndex = Number(btn.getAttribute('data-idx'));
      sc.played = true;
      afterPlay(renderScene);
      return;
    }
    if (act === 'lot') {
      ev.preventDefault();
      var g6 = getPayload();
      var lot = findIn(g6 && g6.lotDrawer, id);
      if (!lot) return;
      lot.drawn = !lot.drawn;
      afterPlay(renderLot);
      return;
    }
    if (act === 'mission') {
      var g7 = getPayload();
      var mission = findIn(g7 && g7.missionBoard, id);
      if (!mission) return;
      setTimeout(function () {
        var input = btn.querySelector ? btn.querySelector('input[type="checkbox"]') : null;
        mission.done = !!(input && input.checked);
        afterPlay(function (gg) {
          renderMission(gg);
          renderStamp(gg);
        });
      }, 0);
    }
  }

  function onRootInput(ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-act') !== 'thermo-slide') return;
    var id = t.getAttribute('data-id');
    var val = Number(t.value) || 0;
    state.thermoDraft[id] = val;
    var lab = $('dp-game-thermo-val-' + id);
    if (lab) lab.textContent = String(val);
  }

  function bindEvents() {
    var root = $('dp-game');
    if (!root || root._dpGameBound) return;
    root._dpGameBound = true;
    root.addEventListener('click', onRootClick);
    root.addEventListener('input', onRootInput);

    global.addEventListener('miya-deep-game-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      if (activeJobs[cid] || state.refreshing) return;
      loadGameData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-game');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.folio = 'cover';
    state.cipherPick = [];
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadGameData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          gameStore().patchGame(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.gameData = fixed;
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
    var layer = $('dp-game');
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

  global.miyaDeepGame = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
