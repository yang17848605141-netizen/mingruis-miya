/**
 * 人生分镜馆 · 叙事 / 财产 / 记忆 / 下一回合
 */
(function (global) {
  'use strict';

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function store() { return global.MiyaSimulatorStore; }
  function engine() { return global.MiyaSimulatorEngine; }

  function toast(msg) {
    if (global.miyaSimulatorApp && global.miyaSimulatorApp.toast) {
      global.miyaSimulatorApp.toast(msg);
      return;
    }
  }

  function scriptId() {
    return global.miyaSimulatorApp && global.miyaSimulatorApp.getScriptId
      ? global.miyaSimulatorApp.getScriptId()
      : null;
  }

  function formatChangeChip(ch) {
    if (!ch) return '';
    var name = esc(ch.name || '');
    var delta = ch.delta;
    var after = ch.after;
    var type = String(ch.type || '').toLowerCase();
    var typeLbl = { stat: '属性', skill: '技能', rank: '等级', relation: '人际', asset: '财产', achievement: '成就' }[type] || type;
    var deltaStr = '';
    if (delta != null && delta !== '') {
      var d = typeof delta === 'number' ? (delta > 0 ? '+' + delta : String(delta)) : String(delta);
      deltaStr = '<em class="sim-nev-change__delta">' + esc(d) + '</em>';
    }
    var afterStr = after != null && after !== '' && Number.isFinite(Number(after))
      ? '<span class="sim-nev-change__after">→' + esc(after) + '</span>'
      : '';
    return '<li class="sim-nev-change sim-nev-change--' + esc(type) + '">' +
      '<span class="sim-nev-change__type">' + esc(typeLbl) + '</span>' +
      '<span class="sim-nev-change__name">' + name + '</span>' +
      deltaStr + afterStr +
    '</li>';
  }

  function favoriteBtnHtml(sid, eventId, isOn) {
    return '<button type="button" class="sim-nev-fav' + (isOn ? ' is-on' : '') + '" data-nev-fav="' + esc(eventId) + '" aria-label="' + (isOn ? '取消收藏' : '收藏') + '" title="' + (isOn ? '已收藏' : '收藏') + '">' +
      '<span class="sim-nev-fav__icon" aria-hidden="true">' + (isOn ? '★' : '☆') + '</span>' +
    '</button>';
  }

  function buildNarrativeHtml(data, opts) {
    opts = opts || {};
    var st = store();
    if (!st || !data) return '';
    var sid = data.scriptId || (global.miyaSimulatorApp && global.miyaSimulatorApp.getScriptId
      ? global.miyaSimulatorApp.getScriptId()
      : null);
    var narr = st.ensureNarrative(data);
    var events = narr.events || [];
    var currentTurn = data.turn || 1;
    var viewTurn = opts.viewTurn != null ? opts.viewTurn : currentTurn;
    var turnEvents = events.filter(function (ev) {
      return (ev.turn || 0) === viewTurn;
    });

    if (!turnEvents.length) {
      if (opts.viewTurn != null) {
        return (
          '<div class="sim-nev-stage sim-nev-stage--empty sim-nev-stage--compact">' +
            '<p class="sim-nev-stage__sub">第 ' + viewTurn + ' 回合暂无叙事记录。</p>' +
          '</div>'
        );
      }
      return (
        '<div class="sim-nev-stage sim-nev-stage--empty">' +
          '<div class="sim-nev-stage__grid" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span>' +
          '</div>' +
          '<header class="sim-nev-stage__head">' +
            '<span class="sim-nev-stage__tag">LIFE FEED · 第' + currentTurn + '回合</span>' +
            '<h3 class="sim-nev-stage__title">分镜尚未开启</h3>' +
            '<p class="sim-nev-stage__sub">点击右侧「下一回合」，AI 将写入至少 20 条带时间戳的事件；每条可触发属性、技能、等级、人际与财产变更。</p>' +
          '</header>' +
          '<ul class="sim-nev-stage__hints">' +
            '<li><strong>01</strong> 本回合打算（可留空）</li>' +
            '<li><strong>02</strong> 生成中可浏览财产 / 记忆等模块</li>' +
            '<li><strong>03</strong> 过往回合可在右侧「回顾」查看</li>' +
          '</ul>' +
        '</div>'
      );
    }

    var changesHtml = function (ev) {
      return (ev.changes || []).map(formatChangeChip).join('');
    };
    var cards = turnEvents.map(function (ev) {
      var changes = changesHtml(ev);
      var favOn = sid && st.isEventFavorited(sid, ev.id);
      return '<article class="sim-nev-card' + (ev.source === 'player' ? ' is-player' : '') + '" data-event-id="' + esc(ev.id) + '">' +
        '<div class="sim-nev-card__rail">' +
          '<time class="sim-nev-card__time">' + esc(ev.timeLabel || '—') + '</time>' +
          (ev.source === 'player' ? '<span class="sim-nev-card__badge">玩家追加</span>' : '') +
          (sid && !opts.readOnly ? favoriteBtnHtml(sid, ev.id, favOn) : '') +
        '</div>' +
        '<div class="sim-nev-card__body">' +
          (ev.title ? '<h4 class="sim-nev-card__title">' + esc(ev.title) + '</h4>' : '') +
          '<p class="sim-nev-card__text">' + esc(ev.body).replace(/\n/g, '<br>') + '</p>' +
          (changes ? '<ul class="sim-nev-card__changes">' + changes + '</ul>' : '') +
        '</div>' +
      '</article>';
    }).join('');

    return (
      '<div class="sim-nev-feed">' +
        '<section class="sim-nev-turn" data-turn="' + viewTurn + '">' +
          '<header class="sim-nev-turn__head">' +
            '<span class="sim-nev-turn__no">ROUND ' + String(viewTurn).padStart(2, '0') + '</span>' +
            '<span class="sim-nev-turn__count">' + turnEvents.length + ' 事件</span>' +
          '</header>' +
          cards +
        '</section>' +
      '</div>'
    );
  }

  function listPastTurns(save) {
    var st = store();
    if (!st || !save) return [];
    var currentTurn = save.turn || 1;
    var counts = {};
    (st.ensureNarrative(save).events || []).forEach(function (ev) {
      var t = ev.turn || 0;
      if (t >= currentTurn || t <= 0) return;
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.keys(counts).map(Number).sort(function (a, b) { return b - a; }).map(function (turn) {
      return { turn: turn, count: counts[turn] };
    });
  }

  function renderReviewHtml(sid, selectedTurn) {
    var st = store();
    if (!st || !sid) return '<p class="sim-ed-hint">暂无存档</p>';
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var currentTurn = save.turn || 1;

    if (selectedTurn != null) {
      var turnNo = parseInt(selectedTurn, 10);
      return (
        '<div class="sim-mod sim-mod--review">' +
          '<button type="button" class="sim-review-back" data-review-back aria-label="返回回合列表">← 回合列表</button>' +
          '<p class="sim-mod__lead">第 ' + turnNo + ' 回合 · 共 ' +
            (st.ensureNarrative(save).events || []).filter(function (ev) {
              return (ev.turn || 0) === turnNo;
            }).length + ' 条事件</p>' +
          '<div class="sim-review-detail">' +
            buildNarrativeHtml(save, { viewTurn: turnNo, readOnly: true }) +
          '</div>' +
        '</div>'
      );
    }

    var past = listPastTurns(save);
    if (!past.length) {
      return (
        '<div class="sim-mod sim-mod--review">' +
          '<p class="sim-mod__lead">当前为第 ' + currentTurn + ' 回合。尚无过往回合可回顾。</p>' +
          '<div class="sim-review-empty"><p>完成本回合并进入下一回合后，历史回合会出现在这里。</p></div>' +
        '</div>'
      );
    }

    var items = past.map(function (row) {
      return '<button type="button" class="sim-review-turn" data-review-turn="' + row.turn + '">' +
        '<span class="sim-review-turn__no">ROUND ' + String(row.turn).padStart(2, '0') + '</span>' +
        '<span class="sim-review-turn__meta">' + row.count + ' 条事件</span>' +
        '<span class="sim-review-turn__go" aria-hidden="true">›</span>' +
      '</button>';
    }).join('');

    return (
      '<div class="sim-mod sim-mod--review">' +
        '<p class="sim-mod__lead">选择要回顾的历史回合（当前第 ' + currentTurn + ' 回合在主界面展示）</p>' +
        '<div class="sim-review-list">' + items + '</div>' +
      '</div>'
    );
  }

  function renderNarrativeComposer() {
    var sid = scriptId();
    var hasTurnEvents = false;
    if (sid) {
      var st = store();
      var save = st && st.getSave(sid);
      if (save) {
        var turn = save.turn || 1;
        hasTurnEvents = (st.ensureNarrative(save).events || []).some(function (ev) {
          return (ev.turn || 0) === turn;
        });
      }
    }
    return (
      '<footer class="sim-nev-composer" id="sim-nev-composer">' +
        '<div class="sim-nev-composer__inner">' +
          '<label class="sim-nev-composer__label" for="sim-nev-request">追加本回合叙事</label>' +
          '<textarea id="sim-nev-request" class="sim-nev-composer__field" rows="2" placeholder="写下你想发生的事，将单独生成本回合新事件（100–200字/条）…"></textarea>' +
          (hasTurnEvents
            ? '<button type="button" class="sim-nev-composer__regen" id="sim-nev-regen-turn">重新生成本回合</button>'
            : '') +
          '<button type="button" class="sim-nev-composer__go" id="sim-nev-request-go">生成事件</button>' +
        '</div>' +
      '</footer>'
    );
  }

  function renderMapPlaceholderHtml() {
    return (
      '<div class="sim-module-placeholder sim-mod--map">' +
        '<span class="sim-module-placeholder__no">图</span>' +
        '<p><strong>地图</strong></p>' +
        '<p class="sim-ed-hint">世界地图与地点探索将在后续版本接入，敬请期待。</p>' +
      '</div>'
    );
  }

  function renderFavoritesHtml(sid) {
    var st = store();
    if (!st || !sid) return '<p class="sim-ed-hint">暂无存档</p>';
    var favs = st.getFavorites(sid);
    if (!favs.length) {
      return (
        '<div class="sim-mod sim-mod--favorites">' +
          '<p class="sim-mod__lead">叙事区事件旁的 ☆ 可收藏；收藏后在此回顾。</p>' +
          '<div class="sim-fav-empty"><p>尚无收藏</p></div>' +
        '</div>'
      );
    }
    var cards = favs.map(function (f) {
      var changes = (f.changes || []).map(formatChangeChip).join('');
      return '<article class="sim-fav-card" data-fav-id="' + esc(f.id) + '">' +
        '<header class="sim-fav-card__head">' +
          '<span class="sim-fav-card__turn">R' + String(f.turn || 0).padStart(2, '0') + '</span>' +
          '<time>' + esc(f.timeLabel || '—') + '</time>' +
          '<button type="button" class="sim-fav-card__del" data-fav-del="' + esc(f.id) + '" aria-label="移除收藏">×</button>' +
        '</header>' +
        (f.title ? '<h4 class="sim-fav-card__title">' + esc(f.title) + '</h4>' : '') +
        '<p class="sim-fav-card__text">' + esc(f.body).replace(/\n/g, '<br>') + '</p>' +
        (changes ? '<ul class="sim-nev-card__changes">' + changes + '</ul>' : '') +
      '</article>';
    }).join('');
    return (
      '<div class="sim-mod sim-mod--favorites">' +
        '<p class="sim-mod__lead">已收藏 ' + favs.length + ' 条叙事事件</p>' +
        '<div class="sim-fav-list">' + cards + '</div>' +
      '</div>'
    );
  }

  function renderGeneratingBanner(scriptIdVal) {
    var st = store();
    var gen = st && scriptIdVal && st.getPlayGenerating ? st.getPlayGenerating(scriptIdVal) : null;
    if (!gen) return '';
    return (
      '<div class="sim-gen-banner is-active" id="sim-gen-banner" role="status">' +
        '<span class="sim-gen-banner__pulse"></span>' +
        '<span class="sim-gen-banner__text">' + esc(gen.label || '生成中…') + '</span>' +
        '<span class="sim-gen-banner__hint">可继续浏览其他模块</span>' +
      '</div>'
    );
  }

  function renderNextTurnModal() {
    return (
      '<div class="sim-turn-modal" id="sim-turn-modal" hidden>' +
        '<div class="sim-turn-modal__veil" id="sim-turn-modal-veil"></div>' +
        '<div class="sim-turn-modal__panel" role="dialog" aria-labelledby="sim-turn-modal-title">' +
          '<header class="sim-turn-modal__head">' +
            '<span class="sim-turn-modal__kicker">NEXT ROUND</span>' +
            '<h2 id="sim-turn-modal-title">进入下一回合</h2>' +
            '<p class="sim-turn-modal__sub">AI 将读取剧本配置、档案、财产、记忆、总结与已有叙事，生成至少 20 条新事件。</p>' +
          '</header>' +
          '<label class="sim-turn-modal__field">' +
            '<span>本回合你打算做什么？<em>（可留空）</em></span>' +
            '<textarea id="sim-turn-intent" rows="4" placeholder="例：去试镜 / 还债 / 探查线索…"></textarea>' +
          '</label>' +
          '<div class="sim-turn-modal__actions">' +
            '<button type="button" class="sim-btn" id="sim-turn-cancel">取消</button>' +
            '<button type="button" class="sim-btn sim-btn--primary" id="sim-turn-confirm">进入下一回合</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function formatAssetValue(cat) {
    var v = Number(cat.value);
    if (!Number.isFinite(v)) v = 0;
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(Math.round(v * 100) / 100);
  }

  function renderAssetsHtml(sid) {
    var st = store();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return '<p class="sim-ed-hint">暂无存档</p>';
    var assets = st.ensureAssets(save, script);
    var cats = assets.categories || [];
    var total = cats.reduce(function (sum, c) { return sum + (Number(c.value) || 0); }, 0);
    var hero = cats.length
      ? cats.slice().sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); })[0]
      : null;

    var stories = cats.map(function (c, i) {
      return '<button type="button" class="sim-asset-story" data-asset-focus="' + esc(c.id) + '">' +
        '<span class="sim-asset-story__ring"><span class="sim-asset-story__icon">' + esc(c.icon || '◆') + '</span></span>' +
        '<span class="sim-asset-story__name">' + esc(c.name) + '</span>' +
      '</button>';
    }).join('');

    var cards = cats.map(function (c) {
      return '<article class="sim-asset-card" data-asset-id="' + esc(c.id) + '">' +
        '<div class="sim-asset-card__top">' +
          '<span class="sim-asset-card__icon">' + esc(c.icon || '◆') + '</span>' +
          '<input class="sim-asset-card__name" data-asset-name value="' + esc(c.name) + '" maxlength="20">' +
          '<button type="button" class="sim-asset-card__del" data-asset-del="' + esc(c.id) + '" aria-label="删除">×</button>' +
        '</div>' +
        '<div class="sim-asset-card__value">' +
          '<input type="number" class="sim-asset-card__num" data-asset-value value="' + esc(c.value) + '">' +
          '<input class="sim-asset-card__unit" data-asset-unit value="' + esc(c.unit || '') + '" maxlength="8" placeholder="单位">' +
        '</div>' +
        '<input class="sim-asset-card__note" data-asset-note value="' + esc(c.note || '') + '" placeholder="备注" maxlength="80">' +
        '<input class="sim-asset-card__icon-in" data-asset-icon value="' + esc(c.icon || '') + '" maxlength="4" placeholder="图标">' +
      '</article>';
    }).join('');

    return (
      '<div class="sim-assets sim-assets--ins">' +
        '<header class="sim-assets__hero">' +
          '<p class="sim-assets__eyebrow">PORTFOLIO · 第' + (save.turn || 1) + '回合</p>' +
          '<div class="sim-assets__total">' +
            '<span class="sim-assets__total-lbl">概览净值</span>' +
            '<strong class="sim-assets__total-num">' + esc(formatAssetValue({ value: total })) + '</strong>' +
            (hero ? '<span class="sim-assets__total-sub">最大项 · ' + esc(hero.name) + '</span>' : '') +
          '</div>' +
        '</header>' +
        '<div class="sim-assets__stories">' + (stories || '<p class="sim-ed-hint">添加财产种类</p>') + '</div>' +
        '<div class="sim-assets__grid" id="sim-assets-grid">' + (cards || '') + '</div>' +
        '<div class="sim-assets__bar">' +
          '<button type="button" class="sim-btn" id="sim-asset-add">+ 财产种类</button>' +
          '<button type="button" class="sim-btn sim-btn--primary" id="sim-asset-save">保存 · 同步存档</button>' +
        '</div>' +
        '<p class="sim-ed-hint">数值随叙事事件实时更新；种类与单位由你自定义，INS 展陈仅作界面参考。</p>' +
      '</div>'
    );
  }

  function renderMemoryHtml(sid) {
    var st = store();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return '<p class="sim-ed-hint">暂无存档</p>';
    var meta = st.ensurePlayMeta(save);
    var mem = st.ensureMemory(save);
    var summaries = mem.summaries || [];

    var sumCards = summaries.length
      ? summaries.map(function (s, i) {
          var range = s.turnEnd && s.turnEnd !== s.turn
            ? '第' + s.turn + '–' + s.turnEnd + '回合'
            : '第' + s.turn + '回合';
          var block = '<article class="sim-mem-clip' + (s.required ? ' is-required' : '') + '">' +
            '<header class="sim-mem-clip__head">' +
              '<time>' + esc(s.gameTime || range) + '</time>' +
              '<span>' + esc(range) + (s.auto ? ' · 自动' : ' · 手动') + '</span>' +
              (s.required ? '<em class="sim-mem-clip__must">必读</em>' : '') +
              '<button type="button" class="sim-mem-clip__del" data-sum-del="' + esc(s.id) + '">删除</button>' +
            '</header>' +
            '<div class="sim-mem-clip__body">' + esc(s.content).replace(/\n/g, '<br>') + '</div>' +
          '</article>';
          if (i > 0) return '<span class="sim-mem-clip__connector" aria-hidden="true"></span>' + block;
          return block;
        }).join('')
      : '<p class="sim-mem-empty">尚无回合总结。可手动提炼，或设置每 N 回合自动总结。</p>';

    var memLines = (mem.roundMemories || []).map(function (m) {
      return '<li><strong>第' + m.turn + '回合</strong> ' + esc(m.content) + '</li>';
    }).join('');

    return (
      '<div class="sim-memory sim-memory--ins">' +
        '<section class="sim-mem-console" aria-label="记忆设置">' +
          '<span class="sim-mem-console__label">记忆 · API 上下文</span>' +
          '<div class="sim-mem-console__row">' +
            '<label class="sim-mem-console__field">保留<input type="number" id="sim-mem-retain" min="1" max="50" value="' + meta.retainRounds + '">回合记忆</label>' +
            '<label class="sim-mem-console__field">每<input type="number" id="sim-mem-auto-sum" min="0" max="50" value="' + meta.summaryAutoEvery + '">回合自动总结</label>' +
          '</div>' +
          '<p class="sim-mem-console__hint">进入下一回合时，API 会携带保留回合内的压缩记忆与下方备注。设为 0 则仅手动总结。</p>' +
          '<label class="sim-mem-console__area">' +
            '<span>记忆备注（任意填写，注入每次回合 API）</span>' +
            '<textarea id="sim-mem-notes" rows="4" placeholder="关键人设、禁忌、你想让 AI 记住的事…">' + esc(meta.manualMemoryNotes) + '</textarea>' +
          '</label>' +
          '<div class="sim-mem-console__actions">' +
            '<button type="button" class="sim-btn" id="sim-mem-save-settings">保存设置</button>' +
            '<button type="button" class="sim-btn sim-btn--primary" id="sim-mem-sum-now">手动总结本回合</button>' +
          '</div>' +
        '</section>' +
        '<section class="sim-mem-section">' +
          '<h3 class="sim-mem-section__title">回合总结 <em>必读 · 时间线</em></h3>' +
          '<div class="sim-mem-timeline">' + sumCards + '</div>' +
        '</section>' +
        (memLines
          ? '<section class="sim-mem-section"><h3 class="sim-mem-section__title">回合压缩记忆</h3><ul class="sim-mem-rounds">' + memLines + '</ul></section>'
          : '') +
      '</div>'
    );
  }

  function collectAssetsFromDom() {
    var st = store();
    var rows = document.querySelectorAll('[data-asset-id]');
    var list = [];
    rows.forEach(function (row) {
      var id = row.getAttribute('data-asset-id');
      var nameEl = row.querySelector('[data-asset-name]');
      var valEl = row.querySelector('[data-asset-value]');
      if (!nameEl || !String(nameEl.value || '').trim()) return;
      list.push(st.normalizeAssetCategory({
        id: id,
        name: nameEl.value.trim(),
        icon: (row.querySelector('[data-asset-icon]') || {}).value || '◆',
        value: valEl ? valEl.value : 0,
        unit: (row.querySelector('[data-asset-unit]') || {}).value || '',
        note: (row.querySelector('[data-asset-note]') || {}).value || ''
      }));
    });
    return list.filter(Boolean);
  }

  function openNextTurnModal() {
    var modal = document.getElementById('sim-turn-modal');
    if (!modal) return;
    modal.hidden = false;
    var ta = document.getElementById('sim-turn-intent');
    if (ta) {
      ta.value = '';
      ta.focus();
    }
  }

  function closeNextTurnModal() {
    var modal = document.getElementById('sim-turn-modal');
    if (modal) modal.hidden = true;
  }

  function updateGenBanner(sid) {
    var host = document.querySelector('.sim-play-stage');
    if (!host) return;
    var old = document.getElementById('sim-gen-banner');
    if (old) old.remove();
    var html = renderGeneratingBanner(sid);
    if (html) host.insertAdjacentHTML('afterbegin', html);
  }

  function refreshNarrativeBody(scrollToEnd) {
    var body = document.getElementById('sim-narrative-body');
    var sid = scriptId();
    var st = store();
    if (!body || !sid || !st) return;
    var data = st.getSave(sid);
    body.innerHTML = buildNarrativeHtml(data);
    if (scrollToEnd) {
      body.scrollTop = body.scrollHeight;
    }
  }

  function patchPlayChrome(sid) {
    var st = store();
    var script = st && st.findScript(sid);
    var save = st && st.getSave(sid);
    if (!st || !script || !save) return;
    var timeStr = st.formatGameTime(save.gameTime);
    var sub = document.querySelector('.sim-play-top__sub');
    if (sub) sub.textContent = '第' + (save.turn || 1) + '回合 · ' + timeStr;
    var composer = document.getElementById('sim-nev-composer');
    if (composer) composer.outerHTML = renderNarrativeComposer();
  }

  function scrollNarrativeToEnd() {
    requestAnimationFrame(function () {
      var body = document.getElementById('sim-narrative-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
  }

  function refreshPlayUi(fullRender, scrollToEnd) {
    var sid = scriptId();
    refreshNarrativeBody(scrollToEnd);
    updateGenBanner(sid);
    if (fullRender && global.miyaSimulatorApp && global.miyaSimulatorApp.render) {
      global.miyaSimulatorApp.render();
      if (scrollToEnd) scrollNarrativeToEnd();
    }
  }

  function finishTurnGenerationUi(sid) {
    updateGenBanner(sid);
    patchPlayChrome(sid);
    refreshNarrativeBody(true);
  }

  function setGenerating(sid, on, label, kind, startedAt) {
    var st = store();
    if (!st || !st.setPlayGenerating) return;
    st.setPlayGenerating(
      sid,
      on ? {
        kind: kind || 'turn',
        label: label || '叙事生成中…',
        startedAt: startedAt || Date.now()
      } : null
    );
    updateGenBanner(sid);
  }

  function bumpTurnProgress(sid, targetTurn, count, total, startedAt) {
    setGenerating(
      sid,
      true,
      '第' + targetTurn + '回合 · 已生成 ' + count + '/' + total + ' 条…',
      'turn',
      startedAt
    );
    refreshNarrativeBody(true);
  }

  function maybeAutoSummary(sid) {
    var st = store();
    var eng = engine();
    if (!st || !eng) return Promise.resolve();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return Promise.resolve();
    var meta = st.ensurePlayMeta(save);
    if (!meta.summaryAutoEvery || meta.summaryAutoEvery <= 0) return Promise.resolve();
    if (meta.turnsSinceSummary < meta.summaryAutoEvery) return Promise.resolve();
    setGenerating(sid, true, '回合总结生成中…', 'summary');
    return eng.generateRoundSummary(script, save, { auto: true })
      .then(function () {
        st.updatePlayMeta(sid, { turnsSinceSummary: 0 });
        toast('已自动写入回合总结（必读）');
      })
      .catch(function () { /* ignore */ })
      .then(function () {
        setGenerating(sid, false);
      });
  }

  function runNextTurnGeneration(intent) {
    var sid = scriptId();
    var st = store();
    var eng = engine();
    if (!sid || !st || !eng) return;
    if (!st.isApiConfigured()) {
      toast('请先配置 API');
      return;
    }
    closeNextTurnModal();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return;

    var turn = save.turn || 1;
    var hasCurrentEvents = (st.ensureNarrative(save).events || []).some(function (ev) {
      return (ev.turn || 0) === turn;
    });
    var targetTurn = hasCurrentEvents ? turn + 1 : turn;

    var minEvents = 20;
    var genStarted = Date.now();
    setGenerating(sid, true, '第' + targetTurn + '回合叙事生成中…', 'turn', genStarted);

    eng.generateTurnNarrative(script, save, {
      playerIntent: intent,
      minEvents: minEvents,
      targetTurn: targetTurn,
      advanceOnSuccess: hasCurrentEvents,
      onEvent: function (_one, count, total) {
        bumpTurnProgress(sid, targetTurn, count, total || minEvents, genStarted);
      }
    })
      .then(function (result) {
        save = st.getSave(sid);
        if (hasCurrentEvents) {
          var meta = st.ensurePlayMeta(save);
          st.updatePlayMeta(sid, {
            turnsSinceSummary: (meta.turnsSinceSummary || 0) + 1
          });
        }
        setGenerating(sid, false);
        toast('第' + (save ? save.turn : '') + '回合已写入 ' + (result.events ? result.events.length : 0) + ' 条事件');
        finishTurnGenerationUi(sid);
        if (result.newContacts && result.newContacts.length) {
          toast('新认识 ' + result.newContacts.length + ' 人，已加入人际');
        }
        if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
          global.miyaSimulatorApp.refreshDrawerModule('assets');
          global.miyaSimulatorApp.refreshDrawerModule('memory');
          global.miyaSimulatorApp.refreshDrawerModule('relations');
          global.miyaSimulatorApp.refreshDrawerModule('review');
        }
        return maybeAutoSummary(sid);
      })
      .catch(function (err) {
        setGenerating(sid, false);
        toast(eng.formatNarrativeError ? eng.formatNarrativeError(err) : '生成失败');
      });
  }

  function confirmAction(title, message) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm({ title: title, message: message });
    }
    return Promise.resolve(window.confirm(message || title));
  }

  function runRegenerateCurrentTurn() {
    var sid = scriptId();
    var st = store();
    var eng = engine();
    if (!sid || !st || !eng) return;
    var save = st.getSave(sid);
    if (!save) return;
    var turn = save.turn || 1;
    var hasEvents = (st.ensureNarrative(save).events || []).some(function (ev) {
      return (ev.turn || 0) === turn;
    });
    if (!hasEvents) {
      toast('本回合尚无叙事内容');
      return;
    }
    if (!st.isApiConfigured()) {
      toast('请先配置 API');
      return;
    }
    confirmAction(
      '重新生成本回合',
      '将清空第' + turn + '回合全部叙事事件并回滚相关数值，再重新生成至少 20 条事件。确定？'
    ).then(function (ok) {
      if (!ok) return;
      var script = st.findScript(sid);
      save = st.getSave(sid);
      if (!script || !save) return;
      st.clearTurnNarrative(sid, turn);
      refreshNarrativeBody(false);
      if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
        global.miyaSimulatorApp.refreshDrawerModule('assets');
        global.miyaSimulatorApp.refreshDrawerModule('memory');
      }
      var regenStarted = Date.now();
      var regenMin = 20;
      setGenerating(sid, true, '第' + turn + '回合重新生成中…', 'turn', regenStarted);
      eng.generateTurnNarrative(script, save, {
        minEvents: regenMin,
        regenerate: true,
        onEvent: function (_one, count, total) {
          bumpTurnProgress(sid, turn, count, total || regenMin, regenStarted);
        }
      })
        .then(function (result) {
          setGenerating(sid, false);
          toast('第' + turn + '回合已重新生成 ' + (result.events ? result.events.length : 0) + ' 条事件');
          finishTurnGenerationUi(sid);
          if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('assets');
            global.miyaSimulatorApp.refreshDrawerModule('memory');
            global.miyaSimulatorApp.refreshDrawerModule('relations');
          }
        })
        .catch(function (err) {
          setGenerating(sid, false);
          toast(eng.formatNarrativeError ? eng.formatNarrativeError(err) : '重新生成失败');
          refreshNarrativeBody(true);
        });
    });
  }

  function runPlayerNarrativeRequest() {
    var sid = scriptId();
    var st = store();
    var eng = engine();
    var ta = document.getElementById('sim-nev-request');
    var text = ta ? String(ta.value || '').trim() : '';
    if (!text) {
      toast('请先填写叙事要求');
      return;
    }
    if (!sid || !st || !eng) return;
    if (!st.isApiConfigured()) {
      toast('请先配置 API');
      return;
    }
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    setGenerating(sid, true, '追加事件生成中…', 'player');
    eng.generatePlayerNarrativeEvents(script, save, text, { count: 3 })
      .then(function (result) {
        setGenerating(sid, false);
        if (ta) ta.value = '';
        toast('已追加 ' + (result.events ? result.events.length : 0) + ' 条事件');
        refreshNarrativeBody(true);
      })
      .catch(function (err) {
        setGenerating(sid, false);
        toast(eng.formatNarrativeError ? eng.formatNarrativeError(err) : '生成失败');
      });
  }

  function runManualSummary() {
    var sid = scriptId();
    var st = store();
    var eng = engine();
    if (!sid || !st || !eng) return;
    if (!st.isApiConfigured()) {
      toast('请先配置 API');
      return;
    }
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    setGenerating(sid, true, '回合总结生成中…', 'summary');
    eng.generateRoundSummary(script, save, { auto: false })
      .then(function () {
        st.updatePlayMeta(sid, { turnsSinceSummary: 0 });
        setGenerating(sid, false);
        toast('回合总结已写入（必读）');
        if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
          global.miyaSimulatorApp.refreshDrawerModule('memory');
        }
      })
      .catch(function (err) {
        setGenerating(sid, false);
        toast(eng.formatNarrativeError ? eng.formatNarrativeError(err) : '总结失败');
      });
  }

  function bindNarrativeEvents(app) {
    if (!app || app._simNarrBound) return;
    app._simNarrBound = true;

    app.addEventListener('click', function (e) {
      if (e.target.closest('#sim-turn-cancel') || e.target.closest('#sim-turn-modal-veil')) {
        closeNextTurnModal();
        return;
      }
      if (e.target.closest('#sim-turn-confirm')) {
        var intentEl = document.getElementById('sim-turn-intent');
        runNextTurnGeneration(intentEl ? intentEl.value.trim() : '');
        return;
      }
      if (e.target.closest('#sim-nev-regen-turn')) {
        runRegenerateCurrentTurn();
        return;
      }
      if (e.target.closest('#sim-nev-request-go')) {
        runPlayerNarrativeRequest();
        return;
      }
      var favBtn = e.target.closest('[data-nev-fav]');
      if (favBtn) {
        var sidF = scriptId();
        var evId = favBtn.getAttribute('data-nev-fav');
        if (sidF && evId) {
          var res = store().toggleNarrativeFavorite(sidF, evId);
          toast(res.favorited ? '已收藏' : '已取消收藏');
          refreshNarrativeBody(false);
          if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('favorites');
          }
        }
        return;
      }
      var reviewTurnBtn = e.target.closest('[data-review-turn]');
      if (reviewTurnBtn && global.miyaSimulatorApp && global.miyaSimulatorApp.setReviewTurn) {
        global.miyaSimulatorApp.setReviewTurn(reviewTurnBtn.getAttribute('data-review-turn'));
        return;
      }
      if (e.target.closest('[data-review-back]') && global.miyaSimulatorApp && global.miyaSimulatorApp.setReviewTurn) {
        global.miyaSimulatorApp.setReviewTurn(null);
        return;
      }
      var favDel = e.target.closest('[data-fav-del]');
      if (favDel) {
        var sidFd = scriptId();
        var fid = favDel.getAttribute('data-fav-del');
        if (sidFd && fid) {
          store().removeFavorite(sidFd, fid);
          toast('已移除收藏');
          if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('favorites');
          }
        }
        return;
      }
      if (e.target.closest('#sim-asset-save')) {
        var sid = scriptId();
        if (sid) {
          store().setAssetCategories(sid, collectAssetsFromDom());
          toast('财产已保存');
        }
        return;
      }
      if (e.target.closest('#sim-asset-add')) {
        var grid = document.getElementById('sim-assets-grid');
        var st = store();
        if (!grid || !st) return;
        var id = 'asset_' + Date.now().toString(36);
        grid.insertAdjacentHTML('beforeend',
          '<article class="sim-asset-card" data-asset-id="' + id + '">' +
            '<div class="sim-asset-card__top">' +
              '<span class="sim-asset-card__icon">◆</span>' +
              '<input class="sim-asset-card__name" data-asset-name value="新财产" maxlength="20">' +
              '<button type="button" class="sim-asset-card__del" data-asset-del="' + id + '">×</button>' +
            '</div>' +
            '<div class="sim-asset-card__value">' +
              '<input type="number" class="sim-asset-card__num" data-asset-value value="0">' +
              '<input class="sim-asset-card__unit" data-asset-unit value="元" maxlength="8">' +
            '</div>' +
            '<input class="sim-asset-card__note" data-asset-note placeholder="备注">' +
            '<input class="sim-asset-card__icon-in" data-asset-icon value="◆" maxlength="4">' +
          '</article>');
        return;
      }
      var assetDel = e.target.closest('[data-asset-del]');
      if (assetDel) {
        var row = assetDel.closest('[data-asset-id]');
        if (row) row.remove();
        return;
      }
      if (e.target.closest('#sim-mem-save-settings')) {
        var sid2 = scriptId();
        if (!sid2) return;
        var retain = document.getElementById('sim-mem-retain');
        var autoSum = document.getElementById('sim-mem-auto-sum');
        var notes = document.getElementById('sim-mem-notes');
        store().updatePlayMeta(sid2, {
          retainRounds: retain ? retain.value : 5,
          summaryAutoEvery: autoSum ? autoSum.value : 3,
          manualMemoryNotes: notes ? notes.value : ''
        });
        toast('记忆设置已保存');
        return;
      }
      if (e.target.closest('#sim-mem-sum-now')) {
        runManualSummary();
        return;
      }
      var sumDel = e.target.closest('[data-sum-del]');
      if (sumDel) {
        var sid3 = scriptId();
        var sumId = sumDel.getAttribute('data-sum-del');
        var save3 = sid3 && store().getSave(sid3);
        if (save3) {
          var mem = store().ensureMemory(save3);
          mem.summaries = mem.summaries.filter(function (s) { return s.id !== sumId; });
          store().touchSave(sid3, {});
          if (global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('memory');
          }
        }
        return;
      }
    });
  }

  global.MiyaSimulatorNarrative = {
    buildNarrativeHtml: buildNarrativeHtml,
    renderNarrativeComposer: renderNarrativeComposer,
    renderNextTurnModal: renderNextTurnModal,
    renderGeneratingBanner: renderGeneratingBanner,
    renderAssetsHtml: renderAssetsHtml,
    renderMemoryHtml: renderMemoryHtml,
    renderFavoritesHtml: renderFavoritesHtml,
    renderReviewHtml: renderReviewHtml,
    renderMapPlaceholderHtml: renderMapPlaceholderHtml,
    openNextTurnModal: openNextTurnModal,
    closeNextTurnModal: closeNextTurnModal,
    runNextTurnGeneration: runNextTurnGeneration,
    runRegenerateCurrentTurn: runRegenerateCurrentTurn,
    runPlayerNarrativeRequest: runPlayerNarrativeRequest,
    refreshPlayUi: refreshPlayUi,
    bindNarrativeEvents: bindNarrativeEvents
  };
})(window);
