(function (global) {
  'use strict';

  var ui = {
    view: 'hub',
    scriptId: null,
    editorMode: 'create',
    editorDraft: null,
    editorCompletingModule: null,
    editorAbilityGen: null,
    railOpen: true,
    drawerModule: null,
    reviewSelectedTurn: null,
    overlay: null
  };

  var PLAY_MENU = [
    { id: 'settings', label: '设置', glyph: '设' },
    { id: 'appearance', label: '外观', glyph: '观' },
    { id: 'profile', label: '个人', glyph: '人' },
    { id: 'attrs', label: '属性', glyph: '属' },
    { id: 'skills', label: '技能', glyph: '技' },
    { id: 'talents', label: '天赋', glyph: '赋' },
    { id: 'levels', label: '等级', glyph: '级' },
    { id: 'achieve', label: '成就', glyph: '成' },
    { id: 'favorites', label: '收藏', glyph: '藏' },
    { id: 'map', label: '地图', glyph: '图' },
    { id: 'relations', label: '人际', glyph: '际' },
    { id: 'assets', label: '财产', glyph: '财' },
    { id: 'shop', label: '商店', glyph: '店' },
    { id: 'events', label: '事件', glyph: '事' },
    { id: 'memory', label: '记忆', glyph: '忆' },
    { id: 'review', label: '回顾', glyph: '回' },
    { id: 'contacts', label: '联络', glyph: '络' },
    { id: 'forum', label: '论坛', glyph: '坛' },
    { id: 'todo', label: '待办', glyph: '办' },
    { id: 'next_turn', label: '下一回合', glyph: '续', accent: true }
  ];

  var MODULE_HINTS = {
    settings: '剧本配置 · 导出导入 · 回合机制',
    appearance: '剧本 CSS 装修 · 装修包 · 全剧本通用',
    profile: '手帐档案 · 头像 · 身份职业 · 社会地位 · 即时保存',
    attrs: '养成数值 · 点击编辑 · 实时同步存档',
    skills: '可习得技能 · 技能树 · 满级100 · AI生成',
    talents: '天生天赋 · 不可升级 · 自由编辑',
    levels: '综合等级 · 境界 · 段位',
    achieve: '成就展架 · 奖杯收集 · 随回合解锁',
    favorites: '叙事事件收藏 · 随时回顾',
    map: '世界地图 · 地点探索（开发中）',
    relations: '人际档案 · 好感 · AI/手动添加',
    assets: '货币 · 资产 · 负债',
    shop: '道具 · 装备 · 限购与刷新',
    events: '主线 · 支线 · 随机池',
    memory: '长期记忆 · 关键抉择回顾',
    review: '历史回合 · 浏览过往叙事',
    contacts: '可联络角色 · 消息 · 邀约',
    forum: '剧情讨论 · 攻略 · 玩家社区',
    todo: '待办清单 · 提醒 · 截止',
    next_turn: '推进时间 · 触发 AI 叙事'
  };

  function $(id) { return document.getElementById(id); }

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
    var el = $('sim-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2600);
  }

  function formatProgress(script, saveData) {
    if (!saveData) return '未开始';
    var st = store();
    var timeStr = st.formatGameTime(saveData.gameTime);
    return '第' + (saveData.turn || 1) + '回合 · ' + timeStr;
  }

  function progressPercent(script, saveData) {
    if (!saveData || !script.episodes) return 0;
    return Math.min(100, Math.round((saveData.episode / script.episodes) * 100));
  }

  function hubStats() {
    var st = store();
    if (!st) return { scripts: 0, days: 0, customs: 0 };
    var scripts = st.allScripts();
    var days = 0;
    var customs = 0;
    scripts.forEach(function (s) {
      if (!s.builtin) customs++;
      var p = st.getProgress(s.id);
      if (p) days += p.turn || 0;
    });
    return { scripts: scripts.length, days: days, customs: customs };
  }

  function narrativeMod() {
    return global.MiyaSimulatorNarrative;
  }

  function buildNarrativeHtml(data) {
    var nar = narrativeMod();
    if (nar && nar.buildNarrativeHtml) return nar.buildNarrativeHtml(data);
    return '<div class="sim-exhibit__empty"><p>叙事模块未加载</p></div>';
  }

  function emptyEditorDraft() {
    var st = store();
    return {
      title: '',
      subtitle: '',
      tagline: '',
      difficulty: '自由',
      features: [],
      config: st.defaultScriptConfig()
    };
  }

  function draftFromScript(script) {
    if (!script) return emptyEditorDraft();
    return {
      id: script.id,
      title: script.title || '',
      subtitle: script.subtitle || '',
      tagline: script.tagline || '',
      difficulty: script.difficulty || '自由',
      features: (script.features || []).slice(),
      config: store().normalizeScriptConfig(script.config || {})
    };
  }

  function readEditorFromDom() {
    var draft = ui.editorDraft || emptyEditorDraft();
    var g = function (id) { var el = $(id); return el ? el.value : ''; };
    draft.title = g('sim-ed-title').trim();
    draft.subtitle = g('sim-ed-sub').trim();
    draft.tagline = g('sim-ed-tag').trim();
    draft.difficulty = g('sim-ed-diff').trim() || '自由';
    draft.config = store().normalizeScriptConfig({
      genreLabel: g('sim-ed-genre').trim(),
      playerName: g('sim-ed-pname').trim(),
      playerAvatar: ui.editorDraft && ui.editorDraft.config ? ui.editorDraft.config.playerAvatar : '',
      playerGender: g('sim-ed-pgender').trim(),
      playerAge: g('sim-ed-page'),
      worldview: g('sim-ed-world').trim(),
      writingStyle: g('sim-ed-style').trim() || store().DEFAULT_WRITING_STYLE,
      turnUnit: g('sim-ed-turn-unit'),
      playerStats: collectStatsFromDom(),
      rankLevels: collectRanksFromDom(),
      initialSkills: collectConfigSkillsFromDom(),
      initialTalents: collectConfigTalentsFromDom()
    });
    return draft;
  }

  function readEditorAbilityCount(id, fallback) {
    var el = $(id);
    var n = parseInt(el && el.value, 10);
    if (!Number.isFinite(n)) n = fallback;
    return Math.max(1, Math.min(20, n));
  }

  function collectConfigSkillsFromDom() {
    var st = store();
    var rows = document.querySelectorAll('[data-sim-config-skill-row]');
    var list = [];
    rows.forEach(function (row) {
      var name = (row.querySelector('[data-sim-config-skill-name]') || {}).value;
      if (!name || !String(name).trim()) return;
      var desc = (row.querySelector('[data-sim-config-skill-desc]') || {}).value || '';
      var norm = st.normalizeConfigSkillRow({ name: String(name).trim(), desc: String(desc).trim() });
      if (norm) list.push(norm);
    });
    return list;
  }

  function collectConfigTalentsFromDom() {
    var st = store();
    var rows = document.querySelectorAll('[data-sim-config-talent-row]');
    var list = [];
    rows.forEach(function (row) {
      var name = (row.querySelector('[data-sim-config-talent-name]') || {}).value;
      if (!name || !String(name).trim()) return;
      var desc = (row.querySelector('[data-sim-config-talent-desc]') || {}).value || '';
      var norm = st.normalizeConfigTalentRow({ name: String(name).trim(), desc: String(desc).trim() });
      if (norm) list.push(norm);
    });
    return list;
  }

  function configSkillRowHtml(skill, idx) {
    return '<div class="sim-ed-ability" data-sim-config-skill-row="' + idx + '">' +
      '<input type="text" data-sim-config-skill-name placeholder="技能名 2-8 字" value="' + esc(skill && skill.name) + '">' +
      '<input type="text" data-sim-config-skill-desc placeholder="技能介绍" value="' + esc(skill && skill.desc) + '">' +
      '<button type="button" class="sim-ed-ability__del" data-sim-config-skill-del aria-label="删除">×</button>' +
    '</div>';
  }

  function configTalentRowHtml(talent, idx) {
    return '<div class="sim-ed-ability" data-sim-config-talent-row="' + idx + '">' +
      '<input type="text" data-sim-config-talent-name placeholder="天赋名 2-8 字" value="' + esc(talent && talent.name) + '">' +
      '<input type="text" data-sim-config-talent-desc placeholder="天赋介绍" value="' + esc(talent && talent.desc) + '">' +
      '<button type="button" class="sim-ed-ability__del" data-sim-config-talent-del aria-label="删除">×</button>' +
    '</div>';
  }

  function renderConfigAbilitiesHtml(cfg) {
    var genBusy = !!ui.editorAbilityGen;
    var aiBusy = isEditorAiBusy();
    var skills = (cfg && cfg.initialSkills) || [];
    var talents = (cfg && cfg.initialTalents) || [];
    var skillsHtml = skills.length
      ? skills.map(configSkillRowHtml).join('')
      : '<p class="sim-ed-stats__empty">可 AI 生成或手动添加；开局时写入存档（仅当存档尚无技能时）。</p>';
    var talentsHtml = talents.length
      ? talents.map(configTalentRowHtml).join('')
      : '<p class="sim-ed-stats__empty">可 AI 生成或手动添加；开局时写入存档（仅当存档尚无天赋时）。</p>';
    return (
      '<div class="sim-ed-abilities">' +
        '<div class="sim-ed-abilities__block">' +
          '<h4 class="sim-ed-abilities__sub">初始技能</h4>' +
          '<div class="sim-ed-ability sim-ed-ability--head" aria-hidden="true">' +
            '<span>名称</span><span>介绍</span><span></span>' +
          '</div>' +
          '<div class="sim-ed-abilities__list" id="sim-ed-config-skills">' + skillsHtml + '</div>' +
          '<div class="sim-ed-stats__actions">' +
            '<label class="sim-ed-ability-count">数量<input type="number" id="sim-ed-config-skill-count" min="1" max="12" value="4"></label>' +
            '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-config-skill-gen"' +
              (genBusy || aiBusy ? ' disabled' : '') + '>' +
              (ui.editorAbilityGen === 'skills' ? '生成中…' : 'AI 生成技能') + '</button>' +
            '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-config-skill-add"' +
              (genBusy || aiBusy ? ' disabled' : '') + '>+ 添加技能</button>' +
          '</div>' +
        '</div>' +
        '<div class="sim-ed-abilities__block">' +
          '<h4 class="sim-ed-abilities__sub">初始天赋</h4>' +
          '<div class="sim-ed-ability sim-ed-ability--head" aria-hidden="true">' +
            '<span>名称</span><span>介绍</span><span></span>' +
          '</div>' +
          '<div class="sim-ed-abilities__list" id="sim-ed-config-talents">' + talentsHtml + '</div>' +
          '<div class="sim-ed-stats__actions">' +
            '<label class="sim-ed-ability-count">数量<input type="number" id="sim-ed-config-talent-count" min="1" max="20" value="3"></label>' +
            '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-config-talent-gen"' +
              (genBusy || aiBusy ? ' disabled' : '') + '>' +
              (ui.editorAbilityGen === 'talents' ? '生成中…' : 'AI 生成天赋') + '</button>' +
            '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-config-talent-add"' +
              (genBusy || aiBusy ? ' disabled' : '') + '>+ 添加天赋</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function runEditorConfigSkillGen() {
    var eng = engine();
    var st = store();
    if (!eng || !st || typeof eng.generateConfigSkills !== 'function') {
      toast('生成功能未就绪');
      return;
    }
    if (!st.isApiConfigured()) {
      toast('请先在分镜馆配置模拟器 API');
      openApiOverlay();
      return;
    }
    var draft = readEditorFromDom();
    if (!draft.title || !draft.config.genreLabel) {
      toast('请先填写剧本名称与题材');
      return;
    }
    var regen = !!(draft.config.initialSkills && draft.config.initialSkills.length);
    var count = readEditorAbilityCount('sim-ed-config-skill-count', 4);
    var proceed = function () {
      ui.editorAbilityGen = 'skills';
      renderEditor();
      eng.generateConfigSkills(draft, { mode: regen ? 'regen' : 'initial', count: count })
        .then(function (rows) {
          ui.editorDraft = readEditorFromDom();
          ui.editorDraft.config.initialSkills = rows.map(st.normalizeConfigSkillRow).filter(Boolean);
          ui.editorAbilityGen = null;
          renderEditor();
          toast('已生成 ' + rows.length + ' 个初始技能');
        })
        .catch(function (err) {
          ui.editorAbilityGen = null;
          renderEditor();
          toast(aiCompleteErrorText(err));
        });
    };
    if (regen && draft.config.initialSkills && draft.config.initialSkills.length) {
      var confirmFn = global.miyaDialog && global.miyaDialog.confirm
        ? global.miyaDialog.confirm({ title: '重新生成', message: '将替换配置中的全部初始技能，确定？' })
        : Promise.resolve(confirm('将替换配置中的全部初始技能，确定？'));
      confirmFn.then(function (ok) { if (ok) proceed(); });
      return;
    }
    proceed();
  }

  function runEditorConfigTalentGen() {
    var eng = engine();
    var st = store();
    if (!eng || !st || typeof eng.generateConfigTalents !== 'function') {
      toast('生成功能未就绪');
      return;
    }
    if (!st.isApiConfigured()) {
      toast('请先在分镜馆配置模拟器 API');
      openApiOverlay();
      return;
    }
    var draft = readEditorFromDom();
    if (!draft.title || !draft.config.genreLabel) {
      toast('请先填写剧本名称与题材');
      return;
    }
    var count = readEditorAbilityCount('sim-ed-config-talent-count', 3);
    ui.editorAbilityGen = 'talents';
    renderEditor();
    eng.generateConfigTalents(draft, count)
      .then(function (rows) {
        ui.editorDraft = readEditorFromDom();
        var existing = (ui.editorDraft.config.initialTalents || []).slice();
        rows.forEach(function (r) {
          var norm = st.normalizeConfigTalentRow(r);
          if (norm) existing.push(norm);
        });
        ui.editorDraft.config.initialTalents = existing.slice(0, 20);
        ui.editorAbilityGen = null;
        renderEditor();
        toast('已生成 ' + rows.length + ' 个天赋');
      })
      .catch(function (err) {
        ui.editorAbilityGen = null;
        renderEditor();
        toast(aiCompleteErrorText(err));
      });
  }

  function parseRankRequirementsText(raw) {
    var text = String(raw || '').trim();
    if (!text) return [];
    var list = [];
    text.split(/[,，;；\n]/).forEach(function (chunk) {
      var part = String(chunk).trim();
      if (!part) return;
      var m = part.match(/^([^≥:=>]+?)\s*(?:≥|>=|[:：=])\s*(\d+)/);
      if (m) {
        list.push({ statName: String(m[1]).trim(), min: parseInt(m[2], 10) || 0 });
        return;
      }
      var m2 = part.match(/^([a-zA-Z_][\w]*)\s*[:：=]\s*(\d+)/);
      if (m2) list.push({ statId: m2[1], min: parseInt(m2[2], 10) || 0 });
    });
    return list;
  }

  function formatRankRequirements(reqs) {
    if (!reqs || !reqs.length) return '';
    return reqs.map(function (r) {
      var label = r.statName || r.statId || '属性';
      return label + '≥' + (r.min != null ? r.min : 0);
    }).join(',');
  }

  function collectRanksFromDom() {
    var rows = document.querySelectorAll('[data-sim-rank-row]');
    var list = [];
    rows.forEach(function (row, idx) {
      var name = (row.querySelector('[data-sim-rank-name]') || {}).value;
      if (!name || !String(name).trim()) return;
      var exp = (row.querySelector('[data-sim-rank-exp]') || {}).value;
      var reqRaw = (row.querySelector('[data-sim-rank-req]') || {}).value || '';
      list.push({
        rank: idx + 1,
        name: String(name).trim(),
        expRequired: parseInt(exp, 10) || 0,
        requirements: parseRankRequirementsText(reqRaw)
      });
    });
    return list;
  }

  function rankRowHtml(rank, idx) {
    var reqsStr = formatRankRequirements(rank && rank.requirements);
    return '<div class="sim-ed-rank" data-sim-rank-row="' + idx + '">' +
      '<span class="sim-ed-rank__no">' + String(idx + 1).padStart(2, '0') + '</span>' +
      '<input type="text" data-sim-rank-name placeholder="等级名，如：常在" value="' + esc(rank && rank.name) + '">' +
      '<input type="number" data-sim-rank-exp placeholder="所需经验" min="0" value="' +
        (rank && rank.expRequired != null ? rank.expRequired : '') + '">' +
      '<input type="text" data-sim-rank-req placeholder="属性:魅力≥50,演技≥40" value="' + esc(reqsStr) + '">' +
      '<button type="button" class="sim-ed-rank__del" data-sim-rank-del aria-label="删除">×</button>' +
    '</div>';
  }

  function collectStatsFromDom() {
    var st = store();
    var defMax = (st && st.DEFAULT_STAT_MAX) || 1000;
    var defInit = (st && st.DEFAULT_STAT_INITIAL) || 50;
    var rows = document.querySelectorAll('[data-sim-stat-row]');
    var list = [];
    rows.forEach(function (row) {
      var name = (row.querySelector('[data-sim-stat-name]') || {}).value;
      if (!name || !String(name).trim()) return;
      var max = (row.querySelector('[data-sim-stat-max]') || {}).value;
      var initial = (row.querySelector('[data-sim-stat-initial]') || {}).value;
      var maxN = parseInt(max, 10);
      if (!Number.isFinite(maxN)) maxN = defMax;
      var initN = parseInt(initial, 10);
      if (!Number.isFinite(initN)) initN = defInit;
      list.push({
        id: row.getAttribute('data-sim-stat-row') || ('stat_' + list.length),
        name: String(name).trim(),
        max: maxN,
        initial: Math.min(maxN, Math.max(0, initN))
      });
    });
    return list;
  }

  function statRowHtml(stat, idx) {
    var st = store();
    var defMax = (st && st.DEFAULT_STAT_MAX) || 1000;
    var defInit = (st && st.DEFAULT_STAT_INITIAL) || 50;
    var id = (stat && stat.id) || ('stat_' + idx);
    var maxVal = stat && stat.max != null ? stat.max : defMax;
    var initVal = stat && stat.initial != null ? stat.initial : defInit;
    return '<div class="sim-ed-stat" data-sim-stat-row="' + esc(id) + '">' +
      '<input type="text" data-sim-stat-name placeholder="数值名，如：魅力" value="' + esc(stat && stat.name) + '">' +
      '<input type="number" data-sim-stat-max placeholder="上限" min="1" value="' + maxVal + '">' +
      '<input type="number" data-sim-stat-initial placeholder="初始" min="0" value="' + initVal + '">' +
      '<button type="button" class="sim-ed-stat__del" data-sim-stat-del aria-label="删除">×</button>' +
    '</div>';
  }

  function turnUnitOptions(selected) {
    var st = store();
    return Object.keys(st.TURN_UNITS).map(function (k) {
      var u = st.TURN_UNITS[k];
      return '<option value="' + esc(k) + '"' + (selected === k ? ' selected' : '') + '>' + esc(u.label) + '</option>';
    }).join('');
  }

  function renderHub() {
    var root = $('sim-root');
    if (!root) return;
    var st = store();
    if (!st) return;
    var stats = hubStats();
    var scripts = st.allScripts();
    var apiOk = st.isApiConfigured();

    var cards = scripts.map(function (script, idx) {
      var saveData = st.getSave(script.id);
      var pct = progressPercent(script, saveData);
      var panel =
        '<div class="sim-script-card__panel">' +
          '<span class="sim-script-card__no">NO.' + String(idx + 1).padStart(2, '0') + '</span>' +
          '<span class="sim-script-card__genre">' + esc(st.genreDisplay(script)) + '</span>' +
          '<span class="sim-script-card__glyph">' + esc(script.coverGlyph) + '</span>' +
          '<h3 class="sim-script-card__title">' + esc(script.title) + '</h3>' +
          '<p class="sim-script-card__sub">' + esc(script.subtitle) + '</p>' +
          '<div class="sim-script-card__progress"><span style="width:' + pct + '%"></span></div>' +
          '<div class="sim-script-card__foot">' +
            '<span>' + esc(formatProgress(script, saveData)) + '</span>' +
            '<span>' + esc(script.difficulty) + '</span>' +
          '</div>' +
        '</div>';
      if (script.builtin) {
        return '<button type="button" class="sim-script-card" data-sim-open="' + esc(script.id) + '">' + panel + '</button>';
      }
      return '<div class="sim-script-card sim-script-card--custom">' +
        '<button type="button" class="sim-script-card__del" data-sim-del="' + esc(script.id) + '" aria-label="删除">×</button>' +
        '<button type="button" class="sim-script-card__edit" data-sim-edit="' + esc(script.id) + '" aria-label="编辑配置">✎</button>' +
        '<button type="button" class="sim-script-card__open" data-sim-open="' + esc(script.id) + '">' + panel + '</button>' +
      '</div>';
    }).join('');

    cards += '<button type="button" class="sim-script-card sim-script-card--create" id="sim-create-open">' +
      '<div class="sim-script-card__panel">' +
        '<span class="sim-script-card__plus">＋</span>' +
        '<span class="sim-script-card__title">自定义剧本</span>' +
        '<p class="sim-script-card__sub">全屏撰写 · AI 补全 · 独立存档</p>' +
      '</div>' +
    '</button>';

    root.innerHTML =
      '<div class="sim-bg sim-bg--ins" aria-hidden="true">' +
        '<div class="sim-bg__grid"></div>' +
        '<div class="sim-bg__frame"></div>' +
        '<span class="sim-bg__stamp">EXHIBITION · LIFE SIM</span>' +
        '<div class="sim-bg__ink"></div>' +
      '</div>' +
      '<div class="sim-shell sim-shell--hub">' +
        '<section class="sim-hub sim-hub--ins">' +
          '<header class="sim-masthead sim-masthead--ins">' +
            '<div class="sim-masthead__main">' +
              '<p class="sim-masthead__eyebrow">MIYA · LIFE SIMULATOR</p>' +
              '<h1 class="sim-masthead__title">人生分镜馆</h1>' +
            '</div>' +
            '<div class="sim-masthead__actions">' +
              '<button type="button" class="sim-api-chip' + (apiOk ? ' is-ready' : '') + '" id="sim-api-open">' +
                '<span class="sim-api-chip__dot"></span>' +
                '<span>API' + (apiOk ? ' · 已配置' : ' · 未配置') + '</span>' +
              '</button>' +
              '<div class="sim-masthead__folio" aria-hidden="true">' +
                '<span class="sim-masthead__folio-no">' + String(stats.scripts).padStart(2, '0') + '</span>' +
                '<span class="sim-masthead__folio-tag">藏本</span>' +
              '</div>' +
            '</div>' +
          '</header>' +
          '<div class="sim-stats-strip sim-stats-strip--ins">' +
            '<div class="sim-stat-chip"><strong>' + stats.days + '</strong><span>累计回合</span></div>' +
            '<div class="sim-stat-chip"><strong>' + stats.customs + '</strong><span>自定义本</span></div>' +
            '<div class="sim-stat-chip"><strong>4</strong><span>内置题材</span></div>' +
            '<div class="sim-stat-chip"><strong>16</strong><span>侧栏模块</span></div>' +
          '</div>' +
          '<div class="sim-script-grid" id="sim-script-grid">' + cards + '</div>' +
        '</section>' +
      '</div>';

    setPlayMode(false);
  }

  function renderPlay() {
    var root = $('sim-root');
    var st = store();
    if (!root || !st || !ui.scriptId) return;
    var script = st.findScript(ui.scriptId);
    var data = st.getSave(ui.scriptId);
    if (!script || !data) {
      ui.view = 'hub';
      renderHub();
      return;
    }

    var cfg = script.config || st.defaultScriptConfig();
    var timeStr = st.formatGameTime(data.gameTime);
    var menu = PLAY_MENU.map(function (item) {
      var cls = 'sim-rail__item' + (item.accent ? ' sim-rail__item--accent' : '');
      return '<button type="button" class="' + cls + '" data-sim-module="' + esc(item.id) + '" title="' + esc(item.label) + '">' +
        '<span class="sim-rail__glyph">' + esc(item.glyph) + '</span>' +
        '<span class="sim-rail__lbl">' + esc(item.label) + '</span>' +
      '</button>';
    }).join('');

    root.innerHTML =
      '<div class="sim-play-veil" aria-hidden="true">' +
        '<div class="sim-play-veil__line"></div>' +
        '<div class="sim-play-veil__arch"></div>' +
      '</div>' +
      '<div class="sim-shell sim-shell--play">' +
        '<section class="sim-play-stage' + (ui.railOpen ? ' is-rail-open' : '') + '">' +
          '<header class="sim-play-top">' +
            '<button type="button" class="sim-play-top__back" id="sim-play-back" aria-label="返回">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' +
            '</button>' +
            '<div class="sim-play-top__meta">' +
              '<h1 class="sim-play-top__title">' + esc(script.title) + '</h1>' +
              '<p class="sim-play-top__sub">第' + (data.turn || 1) + '回合 · ' + esc(timeStr) + '</p>' +
              '<p class="sim-play-top__hint">' + esc(st.genreDisplay(script)) + ' · ' + esc(st.turnUnitLabel(cfg)) + '</p>' +
            '</div>' +
            '<button type="button" class="sim-play-top__gear" id="sim-play-settings" aria-label="剧本设置">⚙</button>' +
          '</header>' +
          '<div class="sim-play-body">' +
            '<div class="sim-play-main">' +
              '<article class="sim-exhibit" aria-label="AI 叙事">' +
                '<div class="sim-exhibit__frame">' +
                  '<div class="sim-exhibit__corners" aria-hidden="true"></div>' +
                  '<header class="sim-exhibit__head">' +
                    '<span class="sim-exhibit__kicker">NARRATIVE OUTPUT</span>' +
                    '<span class="sim-exhibit__ep">第' + data.episode + '幕 · ' + esc(data.episodeTitle || '进行中') + '</span>' +
                  '</header>' +
                  '<div class="sim-exhibit__scroll" id="sim-narrative-body">' + buildNarrativeHtml(data) + '</div>' +
                '</div>' +
              '</article>' +
              (narrativeMod() && narrativeMod().renderNarrativeComposer ? narrativeMod().renderNarrativeComposer() : '') +
            '</div>' +
            (narrativeMod() && narrativeMod().renderNextTurnModal ? narrativeMod().renderNextTurnModal() : '') +
            '<aside class="sim-rail" aria-label="功能菜单">' +
              '<button type="button" class="sim-rail__toggle" id="sim-rail-toggle" aria-label="展开菜单">' +
                '<span></span><span></span><span></span>' +
              '</button>' +
              '<nav class="sim-rail__nav">' + menu + '</nav>' +
            '</aside>' +
          '</div>' +
        '</section>' +
      '</div>';

    setPlayMode(true);
    var modsDecor = global.MiyaSimulatorPlayModules;
    if (modsDecor && modsDecor.applyDecorFromStore) modsDecor.applyDecorFromStore();
    var nar = narrativeMod();
    if (nar && nar.renderGeneratingBanner) {
      var stage = document.querySelector('.sim-play-stage');
      var banHtml = nar.renderGeneratingBanner(ui.scriptId);
      if (stage) {
        var oldBan = $('sim-gen-banner');
        if (oldBan) oldBan.remove();
        if (banHtml) stage.insertAdjacentHTML('afterbegin', banHtml);
      }
    }
  }

  function setPlayMode(on) {
    var app = $('miya-simulator-app');
    if (app) app.classList.toggle('is-in-play', !!on);
    document.body.classList.toggle('sim-in-script-play', !!on);
  }

  function isEditorAiBusy() {
    return !!ui.editorCompletingModule;
  }

  function sectionAiBtn(moduleId) {
    var busy = ui.editorCompletingModule === moduleId;
    var disabled = isEditorAiBusy();
    return '<button type="button" class="sim-ed-section__ai' + (busy ? ' is-busy' : '') + '" data-sim-ai-module="' + moduleId + '" ' +
      (disabled ? 'disabled' : '') + ' title="读取其余配置，仅重写本模块">' +
      (busy ? '生成中…' : 'AI 扩写') + '</button>';
  }

  function sectionTitleHtml(no, label, moduleId, optionalEm) {
    var em = optionalEm ? ' <em>' + optionalEm + '</em>' : '';
    var ai = moduleId ? sectionAiBtn(moduleId) : '';
    return '<h3 class="sim-ed-section__title"><span>' + no + '</span> ' + label + em + ai + '</h3>';
  }

  function aiCompleteErrorText(err) {
    var code = err && err.message;
    if (code === 'api_not_configured') return '请先配置 API';
    if (code === 'parse_failed') return 'AI 返回格式无效，请重试';
    if (code === 'unknown_module') return '未知模块';
    return '补全失败，请检查 API';
  }

  function runAiModule(moduleId) {
    var eng = engine();
    var st = store();
    if (!eng || !st || !moduleId) return;
    if (!st.isApiConfigured()) {
      toast('请先在分镜馆配置模拟器 API');
      openApiOverlay();
      return;
    }
    var draft = readEditorFromDom();
    if (!draft.title || !draft.config.genreLabel) {
      toast('请先填写剧本名称与题材');
      return;
    }
    if (typeof eng.completeScriptModule !== 'function') {
      toast('模块扩写未就绪');
      return;
    }
    ui.editorCompletingModule = moduleId;
    renderEditor();
    eng.completeScriptModule(draft, moduleId)
      .then(function (merged) {
        ui.editorDraft = merged;
        ui.editorCompletingModule = null;
        renderEditor();
        var labels = {
          basic: '基本信息',
          player: '玩家角色',
          world: '世界与文风',
          stats: '数值机制',
          ranks: '等级阶梯',
          abilities: '初始技能与天赋'
        };
        toast('「' + (labels[moduleId] || moduleId) + '」已 AI 扩写');
      })
      .catch(function (err) {
        ui.editorCompletingModule = null;
        renderEditor();
        toast(aiCompleteErrorText(err));
      });
  }

  function renderEditor() {
    var layer = $('sim-editor');
    if (!layer) return;
    var st = store();
    var draft = ui.editorDraft || emptyEditorDraft();
    var cfg = draft.config || st.defaultScriptConfig();
    var isEdit = ui.editorMode === 'edit';
    var ref = st.STAT_REFERENCE || [];
    var refHint = ref.map(function (r) {
      return r.name + '(上限' + r.max + '·初始' + r.initial + ')';
    }).join(' · ');

    var statsHtml = (cfg.playerStats && cfg.playerStats.length)
      ? cfg.playerStats.map(statRowHtml).join('')
      : '';
    if (!statsHtml) statsHtml = '<p class="sim-ed-stats__empty">每项填写：数值名、上限（默认1000）、初始值（默认50，可自由修改）。</p>';

    var ranks = cfg.rankLevels || [];
    var ranksHtml = ranks.length ? ranks.map(rankRowHtml).join('') : '';
    if (!ranksHtml) {
      ranksHtml = '<p class="sim-ed-stats__empty">可留空；配置身份/咖位阶梯。升级需达到经验值，且满足属性门槛（与上方数值名对应，如 魅力≥50）。</p>';
    }

    layer.innerHTML =
      '<div class="sim-editor__veil" id="sim-editor-veil"></div>' +
      '<div class="sim-editor__panel">' +
        '<header class="sim-editor__head">' +
          '<button type="button" class="sim-editor__back" id="sim-editor-close">返回</button>' +
          '<div>' +
            '<p class="sim-editor__kicker">CUSTOM SCRIPT · FULL SCREEN</p>' +
            '<h2>' + (isEdit ? '编辑剧本配置' : '撰写自定义剧本') + '</h2>' +
          '</div>' +
          '<button type="button" class="sim-editor__ai' + (ui.editorCompletingModule === 'all' ? ' is-busy' : '') + '" id="sim-editor-ai" ' +
            (isEditorAiBusy() ? 'disabled' : '') + ' title="除名称/题材/回合/姓名头像性别外，其余全部重写">' +
            (ui.editorCompletingModule === 'all' ? '生成中…' : 'AI 全部扩写') +
          '</button>' +
        '</header>' +
        '<p class="sim-editor__ai-hint">顶部为全部扩写（含初始技能与天赋）；各模块标题旁可单独扩写。全局扩写保留剧本名、题材、回合与玩家姓名/头像/性别。</p>' +
        '<div class="sim-editor__scroll">' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('01', '基本信息', 'basic') +
            '<div class="sim-ed-grid">' +
              field('sim-ed-title', '剧本名称', 'text', draft.title, '例：赛博江湖 · 2077', true) +
              field('sim-ed-genre', '题材类型', 'text', cfg.genreLabel, '自由输入，如：赛博朋克、民国、校园', true) +
              field('sim-ed-sub', '副标题', 'text', draft.subtitle, '一句话概括主线') +
              field('sim-ed-tag', '卷首语', 'text', draft.tagline, '「」内开场白') +
              field('sim-ed-diff', '难度标签', 'text', draft.difficulty, '自由 / 普通 / 困难…') +
            '</div>' +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('02', '玩家角色', 'player') +
            '<div class="sim-ed-player">' +
              '<div class="sim-ed-avatar" id="sim-ed-avatar-preview">' +
                (cfg.playerAvatar
                  ? '<img src="' + esc(cfg.playerAvatar) + '" alt="">'
                  : '<span class="sim-ed-avatar__ph">' + esc((cfg.playerName || '玩家').charAt(0) || '我') + '</span>') +
              '</div>' +
              '<div class="sim-ed-grid sim-ed-grid--player">' +
                field('sim-ed-pname', '玩家姓名', 'text', cfg.playerName, '你在故事中的名字', true) +
                field('sim-ed-pgender', '性别', 'text', cfg.playerGender, '男 / 女 / 其他 / 保密', true) +
                field('sim-ed-page', '初始年龄', 'number', cfg.playerAge, '', true) +
                '<label class="sim-ed-upload">' +
                  '<input type="file" id="sim-ed-avatar-file" accept="image/*" hidden>' +
                  '<span>上传头像</span>' +
                '</label>' +
              '</div>' +
            '</div>' +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('03', '世界与文风', 'world') +
            fieldArea('sim-ed-world', '世界观', cfg.worldview, '时代背景、势力、规则、禁忌…', 6) +
            fieldArea('sim-ed-style', 'AI 输出文风', cfg.writingStyle || st.DEFAULT_WRITING_STYLE, '叙事节奏、修辞、禁忌', 5) +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('04', '回合机制') +
            '<p class="sim-ed-hint">选择时间单位；每推进一回合，游戏时间 +1 个该单位（天/周/月/年），并自动进位。</p>' +
            '<div class="sim-ed-turn">' +
              '<label>每回合推进<select id="sim-ed-turn-unit">' + turnUnitOptions(cfg.turnUnit) + '</select></label>' +
            '</div>' +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('05', '玩家数值机制', 'stats', '可选') +
            '<p class="sim-ed-hint sim-ed-stats__legend">表头：数值名 · 上限 · 初始值 · 参考 ' + esc(refHint) + '</p>' +
            '<div class="sim-ed-stat sim-ed-stat--head" aria-hidden="true">' +
              '<span>数值名</span><span>上限</span><span>初始</span><span></span>' +
            '</div>' +
            '<div class="sim-ed-stats" id="sim-ed-stats">' + statsHtml + '</div>' +
            '<div class="sim-ed-stats__actions">' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-stat-add">+ 添加数值</button>' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-stat-ref">填入参考模板</button>' +
            '</div>' +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('06', '身份等级阶梯', 'ranks', '可选') +
            '<p class="sim-ed-hint">如娱乐圈 10 级（十八线→国际影后）、宫斗 20 级（宫女→皇后）。每级填写升级所需经验；属性门槛格式：魅力≥50,演技≥40</p>' +
            '<div class="sim-ed-ranks" id="sim-ed-ranks">' + ranksHtml + '</div>' +
            '<div class="sim-ed-stats__actions">' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-rank-add">+ 添加等级</button>' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-rank-ref-showbiz">娱乐圈模板</button>' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-ed-rank-ref-gufeng">宫斗模板</button>' +
            '</div>' +
          '</section>' +
          '<section class="sim-ed-section">' +
            sectionTitleHtml('07', '初始技能与天赋', 'abilities', '可选') +
            '<p class="sim-ed-hint">配置开局默认技能/天赋；新存档或存档为空时会写入。游玩中 AI 生成、手动编辑的存档数据不会被覆盖。</p>' +
            renderConfigAbilitiesHtml(cfg) +
          '</section>' +
        '</div>' +
        '<footer class="sim-editor__foot">' +
          '<button type="button" class="sim-btn" id="sim-editor-cancel">取消</button>' +
          '<button type="button" class="sim-btn sim-btn--primary" id="sim-editor-save">' +
            (isEdit ? '保存配置' : '保存并开始游玩') +
          '</button>' +
        '</footer>' +
      '</div>';

    layer.classList.add('is-open');
    ui.editorDraft = draft;
  }

  function field(id, label, type, val, ph, req) {
    return '<label class="sim-ed-field' + (req ? ' is-req' : '') + '" for="' + id + '">' +
      '<span>' + esc(label) + '</span>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(val != null ? val : '') + '" placeholder="' + esc(ph || '') + '">' +
    '</label>';
  }

  function fieldArea(id, label, val, ph, rows) {
    return '<label class="sim-ed-field sim-ed-field--area" for="' + id + '">' +
      '<span>' + esc(label) + '</span>' +
      '<textarea id="' + id + '" rows="' + (rows || 4) + '" placeholder="' + esc(ph || '') + '">' + esc(val || '') + '</textarea>' +
    '</label>';
  }

  function closeEditor() {
    var layer = $('sim-editor');
    if (layer) layer.classList.remove('is-open');
    ui.editorDraft = null;
    ui.editorCompletingModule = null;
    ui.editorAbilityGen = null;
  }

  function openCreateEditor() {
    ui.editorMode = 'create';
    ui.editorDraft = emptyEditorDraft();
    renderEditor();
  }

  function openEditEditor(scriptId) {
    var script = store().findScript(scriptId);
    if (!script) return;
    ui.editorMode = 'edit';
    ui.editorDraft = draftFromScript(script);
    ui.editorDraft.id = script.id;
    renderEditor();
  }

  function saveEditor(andPlay) {
    var st = store();
    var draft = readEditorFromDom();
    if (!draft.title) {
      toast('请填写剧本名称');
      return;
    }
    if (!draft.config.genreLabel) {
      toast('请填写题材类型');
      return;
    }
    if (!draft.config.playerName) {
      toast('请填写玩家姓名');
      return;
    }
    draft.coverGlyph = draft.title.charAt(0);
    draft.features = draft.features && draft.features.length
      ? draft.features
      : ['自由叙事', '自定义养成'];

    var row;
    if (ui.editorMode === 'edit' && draft.id) {
      row = st.updateCustomScript(draft.id, draft);
      toast('剧本配置已保存');
      closeEditor();
      if (ui.view === 'play') renderPlay();
      else renderHub();
      return;
    }
    row = st.addCustomScript(draft);
    closeEditor();
    if (row) {
      toast('剧本「' + row.title + '」已保存');
      if (andPlay !== false) openScript(row.id);
      else renderHub();
    }
  }

  function runAiComplete() {
    var eng = engine();
    var st = store();
    if (!eng || !st) return;
    if (!st.isApiConfigured()) {
      toast('请先在分镜馆配置模拟器 API');
      openApiOverlay();
      return;
    }
    var draft = readEditorFromDom();
    if (!draft.title || !draft.config.genreLabel) {
      toast('请先填写剧本名称与题材');
      return;
    }
    ui.editorCompletingModule = 'all';
    renderEditor();
    eng.completeScriptDraft(draft)
      .then(function (merged) {
        ui.editorDraft = merged;
        ui.editorCompletingModule = null;
        renderEditor();
        toast('AI 已扩写全部可改字段，可继续编辑后保存');
      })
      .catch(function (err) {
        ui.editorCompletingModule = null;
        renderEditor();
        toast(aiCompleteErrorText(err));
      });
  }

  function renderApiOverlay() {
    var layer = $('sim-api');
    if (!layer) return;
    var st = store();
    var cfg = st.getApiConfig();
    layer.innerHTML =
      '<div class="sim-api__veil" id="sim-api-veil"></div>' +
      '<div class="sim-api__panel">' +
        '<header class="sim-api__head">' +
          '<h2>模拟器 API</h2>' +
          '<p>独立于小手机，仅用于人生分镜馆与 AI 补全。</p>' +
          '<button type="button" class="sim-api__close" id="sim-api-close">×</button>' +
        '</header>' +
        '<div class="sim-api__body">' +
          '<label class="sim-ed-field"><span>接口地址 Base URL</span>' +
            '<input type="url" id="sim-api-base" value="' + esc(cfg.baseUrl) + '" placeholder="https://api.example.com/v1">' +
          '</label>' +
          '<label class="sim-ed-field"><span>API Key</span>' +
            '<input type="password" id="sim-api-key" value="' + esc(cfg.apiKey) + '" placeholder="sk-…" autocomplete="off">' +
          '</label>' +
          '<label class="sim-ed-field sim-ed-field--model"><span>模型 Model</span>' +
            '<div class="sim-api__model-row">' +
              '<select id="sim-api-model" class="sim-api-model-select">' +
                modelSelectOptionsHtml(cfg.model) +
              '</select>' +
              '<button type="button" class="sim-btn sim-btn--ghost" id="sim-api-fetch-models">拉取模型</button>' +
            '</div>' +
            '<p class="sim-ed-hint sim-api__model-hint" id="sim-api-model-hint">拉取后可滚动选择全部模型；亦可下方手动填写未在列表中的模型名。</p>' +
            '<input type="text" id="sim-api-model-custom" class="sim-api-model-custom" value="" placeholder="不在列表中时在此填写模型 ID">' +
          '</label>' +
          '<label class="sim-ed-field"><span>温度 Temperature</span>' +
            '<input type="number" id="sim-api-temp" min="0" max="2" step="0.05" value="' + (cfg.temperature != null ? cfg.temperature : 0.85) + '">' +
          '</label>' +
        '</div>' +
        '<footer class="sim-api__foot">' +
          '<button type="button" class="sim-btn" id="sim-api-cancel">取消</button>' +
          '<button type="button" class="sim-btn sim-btn--primary" id="sim-api-save">保存</button>' +
        '</footer>' +
      '</div>';
    layer.classList.add('is-open');
  }

  function openApiOverlay() { renderApiOverlay(); }

  function closeApiOverlay() {
    var layer = $('sim-api');
    if (layer) layer.classList.remove('is-open');
  }

  function readApiFormCredentials() {
    return {
      baseUrl: ($('sim-api-base') || {}).value || '',
      apiKey: ($('sim-api-key') || {}).value || ''
    };
  }

  function modelSelectOptionsHtml(currentModel) {
    var cur = String(currentModel || '').trim();
    if (!cur) {
      return '<option value="">选择模型（先拉取或手动填写下方）</option>';
    }
    return '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
  }

  function resolveModelFromForm() {
    var custom = ($('sim-api-model-custom') || {}).value;
    if (String(custom || '').trim()) return String(custom).trim();
    return ($('sim-api-model') || {}).value || '';
  }

  function fillSimModelSelect(ids, keepValue) {
    var sel = $('sim-api-model');
    if (!sel) return;
    var cur = String(keepValue != null ? keepValue : resolveModelFromForm() || '').trim();
    var hint = $('sim-api-model-hint');
    sel.innerHTML = '<option value="">选择模型</option>';
    (ids || []).forEach(function (id) {
      var op = document.createElement('option');
      op.value = id;
      op.textContent = id;
      sel.appendChild(op);
    });
    if (cur && ids && ids.indexOf(cur) >= 0) {
      sel.value = cur;
      if ($('sim-api-model-custom')) $('sim-api-model-custom').value = '';
    } else if (cur) {
      var extra = document.createElement('option');
      extra.value = cur;
      extra.textContent = cur + '（当前）';
      sel.appendChild(extra);
      sel.value = cur;
    }
    if (hint) {
      hint.textContent = ids && ids.length
        ? '共 ' + ids.length + ' 个模型，可在下拉框内滚动选择；未列出时请用下方输入框。'
        : '拉取后可滚动选择全部模型；亦可下方手动填写未在列表中的模型名。';
    }
  }

  function runFetchSimModels(btn) {
    var eng = engine();
    if (!eng) return;
    var cred = readApiFormCredentials();
    if (!String(cred.baseUrl).trim() || !String(cred.apiKey).trim()) {
      toast('请先填写接口地址与 API Key');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '拉取中…';
    }
    eng.fetchModels(cred)
      .then(function (ids) {
        var cur = resolveModelFromForm();
        fillSimModelSelect(ids, cur || (ids[0] || ''));
        var sel = $('sim-api-model');
        if (sel && !sel.value && ids[0]) sel.value = ids[0];
        toast('已载入 ' + ids.length + ' 个模型，下拉可滚动查看');
      })
      .catch(function (err) {
        toast(eng.fetchModelsErrorMessage ? eng.fetchModelsErrorMessage(err) : '拉取模型失败');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '拉取模型';
        }
      });
  }

  function saveApiFromDom() {
    var st = store();
    st.setApiConfig({
      baseUrl: ($('sim-api-base') || {}).value || '',
      apiKey: ($('sim-api-key') || {}).value || '',
      model: resolveModelFromForm(),
      temperature: parseFloat(($('sim-api-temp') || {}).value) || 0.85
    });
    closeApiOverlay();
    toast('模拟器 API 已保存');
    if (ui.view === 'hub') renderHub();
  }

  function renderScriptSettingsOverlay() {
    var layer = $('sim-script-settings');
    if (!layer || !ui.scriptId) return;
    var mods = global.MiyaSimulatorPlayModules;
    if (!mods || !store().findScript(ui.scriptId)) return;
    layer.innerHTML = mods.renderSettingsOverlay(ui.scriptId);
    layer.classList.add('is-open');
  }

  function closeScriptSettings() {
    var layer = $('sim-script-settings');
    if (layer) layer.classList.remove('is-open');
  }

  function refreshDrawerModule(moduleId) {
    if (ui.drawerModule !== moduleId) return;
    openModuleDrawer(moduleId);
  }

  function openModuleDrawer(moduleId) {
    var item = PLAY_MENU.find(function (m) { return m.id === moduleId; });
    ui.drawerModule = moduleId;
    var drawer = $('sim-drawer');
    var title = $('sim-drawer-title');
    var hint = $('sim-drawer-hint');
    var body = $('sim-drawer-body');
    if (!drawer || !body) return;
    if (title) title.textContent = item ? item.label : moduleId;
    if (hint) hint.textContent = MODULE_HINTS[moduleId] || '';

    if (moduleId === 'settings') {
      closeDrawer();
      renderScriptSettingsOverlay();
      return;
    }

    if (moduleId === 'appearance') {
      var modsA = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsA ? modsA.renderAppearanceHtml() : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'profile') {
      var modsP = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsP ? modsP.renderProfileHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'attrs') {
      var modsAt = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsAt ? modsAt.renderAttrsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins');
      return;
    }

    if (moduleId === 'levels') {
      body.innerHTML = renderLevelsModuleHtml();
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins');
      return;
    }

    if (moduleId === 'skills') {
      var modsSk = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsSk ? modsSk.renderSkillsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      if (modsSk && modsSk.bindSkillTree) modsSk.bindSkillTree('sim-skill-tree-wrap', ui.scriptId, false);
      return;
    }

    if (moduleId === 'talents') {
      var modsTl = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsTl ? modsTl.renderTalentsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'achieve') {
      var modsAc = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsAc ? modsAc.renderAchievementsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'assets') {
      var narA = narrativeMod();
      body.innerHTML = narA ? narA.renderAssetsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'memory') {
      var narM = narrativeMod();
      body.innerHTML = narM ? narM.renderMemoryHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'review') {
      var narRv = narrativeMod();
      body.innerHTML = narRv ? narRv.renderReviewHtml(ui.scriptId, ui.reviewSelectedTurn) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'favorites') {
      var narF = narrativeMod();
      body.innerHTML = narF ? narF.renderFavoritesHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'map') {
      var narMap = narrativeMod();
      body.innerHTML = narMap ? narMap.renderMapPlaceholderHtml() : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins');
      return;
    }

    if (moduleId === 'relations') {
      var modsRel = global.MiyaSimulatorPlayModules;
      body.innerHTML = modsRel ? modsRel.renderRelationsHtml(ui.scriptId) : '';
      drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
      return;
    }

    if (moduleId === 'next_turn') {
      var narT = narrativeMod();
      if (narT && narT.openNextTurnModal) {
        narT.openNextTurnModal();
      } else {
        toast('叙事模块未加载');
      }
      return;
    }

    body.innerHTML =
      '<div class="sim-module-placeholder">' +
        '<span class="sim-module-placeholder__no">' + esc(item ? item.glyph : '·') + '</span>' +
        '<p><strong>' + esc(item ? item.label : moduleId) + '</strong> 模块 UI 已就位，具体玩法将在下一阶段接入。</p>' +
      '</div>';
    drawer.classList.add('is-open', 'sim-drawer--side', 'sim-drawer--ins');
  }

  function renderLevelsModuleHtml() {
    var st = store();
    var script = st.findScript(ui.scriptId);
    var save = st.getSave(ui.scriptId);
    if (!script || !save) return '<p class="sim-ed-hint">暂无存档</p>';
    var ladder = st.getRankLadder(script);
    if (!ladder.length) {
      return '<div class="sim-module-placeholder">' +
        '<p>本剧本未配置等级阶梯。在<strong>自定义剧本 → 身份等级阶梯</strong>中设置，或于剧本设置中编辑配置。</p></div>';
    }
    var prog = st.getRankProgress(script, save);
    var check = st.evaluateRankPromotion(script, save);
    var rows = ladder.map(function (lv, i) {
      var done = i < prog.index;
      var cur = i === prog.index;
      var cls = 'sim-rank-ladder__row' + (done ? ' is-done' : '') + (cur ? ' is-current' : '');
      var req = (lv.requirements || []).map(function (r) {
        return esc(r.statName || r.statId) + '≥' + r.min;
      }).join(' · ');
      return '<div class="' + cls + '">' +
        '<span class="sim-rank-ladder__no">' + lv.rank + '</span>' +
        '<div class="sim-rank-ladder__main">' +
          '<strong>' + esc(lv.name) + '</strong>' +
          '<span>经验 ' + lv.expRequired + (req ? ' · ' + req : '') + '</span>' +
        '</div>' +
        (cur ? '<em class="sim-rank-ladder__tag">当前</em>' : '') +
      '</div>';
    }).join('');
    var nextHint = '';
    if (prog.next) {
      if (check.reason === 'exp') {
        nextHint = '<p class="sim-ed-hint">距「' + esc(prog.next.name) + '」还差 ' + check.needExp + ' 经验（当前 ' + prog.exp + ' / ' + prog.next.expRequired + '）</p>';
      } else if (check.reason === 'stats' && check.failed && check.failed.length) {
        nextHint = '<p class="sim-ed-hint">经验已够，属性未达标：' +
          check.failed.map(function (f) {
            return esc(f.statName) + ' ' + f.have + '/' + f.need;
          }).join(' · ') + '</p>';
      } else if (check.canPromote) {
        nextHint = '<p class="sim-ed-hint">已满足晋升「' + esc(prog.next.name) + '」条件（玩法接入后将自动晋升）</p>';
      } else if (check.reason === 'max_rank') {
        nextHint = '<p class="sim-ed-hint">已达最高等级</p>';
      }
    }
    return '<div class="sim-rank-ladder">' +
      '<p class="sim-rank-ladder__head">当前 <strong>' + esc(prog.current.name) + '</strong> · 经验 ' + prog.exp + '</p>' +
      nextHint +
      '<div class="sim-rank-ladder__list">' + rows + '</div>' +
    '</div>';
  }

  function closeDrawer() {
    var wasAppearance = ui.drawerModule === 'appearance';
    ui.drawerModule = null;
    ui.reviewSelectedTurn = null;
    var drawer = $('sim-drawer');
    if (drawer) drawer.classList.remove('is-open', 'sim-drawer--side', 'sim-drawer--ins', 'sim-drawer--wide');
    var mods = global.MiyaSimulatorPlayModules;
    if (mods && mods.closeSkillFullscreen) mods.closeSkillFullscreen();
    if (mods && mods.closeRelationDetail) mods.closeRelationDetail();
    if (wasAppearance && mods && mods.applyDecorFromStore) mods.applyDecorFromStore();
  }

  function render() {
    if (ui.view === 'play') renderPlay();
    else renderHub();
  }

  function openScript(id) {
    ui.scriptId = id;
    ui.view = 'play';
    ui.railOpen = true;
    store().touchSave(id, {});
    closeEditor();
    closeApiOverlay();
    closeScriptSettings();
    render();
  }

  function backToHub() {
    ui.view = 'hub';
    ui.scriptId = null;
    closeDrawer();
    closeScriptSettings();
    render();
  }

  function bindEvents() {
    var app = $('miya-simulator-app');
    if (!app || app._simBound) return;
    app._simBound = true;

    app.addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-sim-edit]');
      if (editBtn) {
        e.stopPropagation();
        openEditEditor(editBtn.getAttribute('data-sim-edit'));
        return;
      }
      var openBtn = e.target.closest('[data-sim-open]');
      if (openBtn) {
        openScript(openBtn.getAttribute('data-sim-open'));
        return;
      }
      var delBtn = e.target.closest('[data-sim-del]');
      if (delBtn) {
        e.stopPropagation();
        var delId = delBtn.getAttribute('data-sim-del');
        var confirmFn = global.miyaDialog && global.miyaDialog.confirm
          ? global.miyaDialog.confirm({ title: '删除剧本', message: '将同时删除该剧本的全部存档，不可恢复。' })
          : Promise.resolve(confirm('删除该剧本及存档？'));
        confirmFn.then(function (ok) {
          if (ok) {
            store().removeCustomScript(delId);
            renderHub();
            toast('剧本已删除');
          }
        });
        return;
      }
      if (e.target.closest('#sim-create-open')) {
        openCreateEditor();
        return;
      }
      if (e.target.closest('#sim-api-open')) {
        openApiOverlay();
        return;
      }
      if (e.target.closest('#sim-play-back')) {
        backToHub();
        return;
      }
      if (e.target.closest('#sim-play-settings')) {
        renderScriptSettingsOverlay();
        return;
      }
      if (e.target.closest('#sim-rail-toggle')) {
        ui.railOpen = !ui.railOpen;
        var stage = e.target.closest('.sim-play-stage');
        if (stage) stage.classList.toggle('is-rail-open', ui.railOpen);
        return;
      }
      var modBtn = e.target.closest('[data-sim-module]');
      if (modBtn) {
        var modId = modBtn.getAttribute('data-sim-module');
        if (modId === 'review') ui.reviewSelectedTurn = null;
        openModuleDrawer(modId);
        return;
      }
      if (e.target.closest('#sim-drawer-close') || e.target.closest('#sim-drawer-veil')) {
        closeDrawer();
        return;
      }
      if (e.target.closest('#sim-api-veil') || e.target.closest('#sim-api-close') || e.target.closest('#sim-api-cancel')) {
        closeApiOverlay();
        return;
      }
      if (e.target.closest('#sim-api-save')) {
        saveApiFromDom();
        return;
      }
      if (e.target.closest('#sim-api-fetch-models')) {
        runFetchSimModels(e.target.closest('#sim-api-fetch-models'));
        return;
      }
      if (e.target.closest('#sim-editor-close') || e.target.closest('#sim-editor-veil') || e.target.closest('#sim-editor-cancel')) {
        closeEditor();
        return;
      }
      if (e.target.closest('#sim-editor-save')) {
        saveEditor(true);
        return;
      }
      if (e.target.closest('#sim-editor-ai')) {
        runAiComplete();
        return;
      }
      var modAiBtn = e.target.closest('[data-sim-ai-module]');
      if (modAiBtn) {
        runAiModule(modAiBtn.getAttribute('data-sim-ai-module'));
        return;
      }
      if (e.target.closest('#sim-ed-stat-add')) {
        var wrap = $('sim-ed-stats');
        if (wrap) {
          var empty = wrap.querySelector('.sim-ed-stats__empty');
          if (empty) empty.remove();
          wrap.insertAdjacentHTML('beforeend', statRowHtml(null, wrap.querySelectorAll('[data-sim-stat-row]').length));
        }
        return;
      }
      if (e.target.closest('#sim-ed-stat-ref')) {
        var st = store();
        var wrap2 = $('sim-ed-stats');
        if (!wrap2 || !st) return;
        wrap2.innerHTML = st.STAT_REFERENCE.map(statRowHtml).join('');
        toast('已填入参考模板，可随意删改');
        return;
      }
      var statDel = e.target.closest('[data-sim-stat-del]');
      if (statDel) {
        var row = statDel.closest('[data-sim-stat-row]');
        if (row) row.remove();
        return;
      }
      if (e.target.closest('#sim-ed-rank-add')) {
        var rankWrap = $('sim-ed-ranks');
        if (rankWrap) {
          var emptyRank = rankWrap.querySelector('.sim-ed-stats__empty');
          if (emptyRank) emptyRank.remove();
          rankWrap.insertAdjacentHTML('beforeend', rankRowHtml(null, rankWrap.querySelectorAll('[data-sim-rank-row]').length));
        }
        return;
      }
      if (e.target.closest('#sim-ed-rank-ref-showbiz')) {
        var rw1 = $('sim-ed-ranks');
        var st1 = store();
        if (rw1 && st1) {
          rw1.innerHTML = (st1.RANK_REFERENCE_SHOWBIZ || []).map(rankRowHtml).join('');
          toast('已填入娱乐圈 10 级模板');
        }
        return;
      }
      if (e.target.closest('#sim-ed-rank-ref-gufeng')) {
        var rw2 = $('sim-ed-ranks');
        var st2 = store();
        if (rw2 && st2) {
          rw2.innerHTML = (st2.RANK_REFERENCE_GUFENG || []).map(rankRowHtml).join('');
          toast('已填入宫斗 20 级模板');
        }
        return;
      }
      var rankDel = e.target.closest('[data-sim-rank-del]');
      if (rankDel) {
        var rankRow = rankDel.closest('[data-sim-rank-row]');
        if (rankRow) rankRow.remove();
        return;
      }
      if (e.target.closest('#sim-ed-config-skill-add')) {
        var skillWrap = $('sim-ed-config-skills');
        if (skillWrap) {
          var emptySk = skillWrap.querySelector('.sim-ed-stats__empty');
          if (emptySk) emptySk.remove();
          skillWrap.insertAdjacentHTML('beforeend', configSkillRowHtml(null, skillWrap.querySelectorAll('[data-sim-config-skill-row]').length));
        }
        return;
      }
      if (e.target.closest('#sim-ed-config-skill-gen')) {
        runEditorConfigSkillGen();
        return;
      }
      var skillCfgDel = e.target.closest('[data-sim-config-skill-del]');
      if (skillCfgDel) {
        var skillCfgRow = skillCfgDel.closest('[data-sim-config-skill-row]');
        if (skillCfgRow) skillCfgRow.remove();
        return;
      }
      if (e.target.closest('#sim-ed-config-talent-add')) {
        var talentWrap = $('sim-ed-config-talents');
        if (talentWrap) {
          var emptyTl = talentWrap.querySelector('.sim-ed-stats__empty');
          if (emptyTl) emptyTl.remove();
          talentWrap.insertAdjacentHTML('beforeend', configTalentRowHtml(null, talentWrap.querySelectorAll('[data-sim-config-talent-row]').length));
        }
        return;
      }
      if (e.target.closest('#sim-ed-config-talent-gen')) {
        runEditorConfigTalentGen();
        return;
      }
      var talentCfgDel = e.target.closest('[data-sim-config-talent-del]');
      if (talentCfgDel) {
        var talentCfgRow = talentCfgDel.closest('[data-sim-config-talent-row]');
        if (talentCfgRow) talentCfgRow.remove();
        return;
      }
      if (e.target.closest('#sim-ss-veil') || e.target.closest('#sim-ss-close')) {
        closeScriptSettings();
        return;
      }
      if (e.target.closest('#sim-ss-edit-config')) {
        closeScriptSettings();
        openEditEditor(ui.scriptId);
        return;
      }
    });

    app.addEventListener('change', function (e) {
      if (e.target.id === 'sim-ed-avatar-file' && e.target.files && e.target.files[0]) {
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          if (!ui.editorDraft) ui.editorDraft = readEditorFromDom();
          ui.editorDraft.config.playerAvatar = String(reader.result || '');
          var prev = $('sim-ed-avatar-preview');
          if (prev) {
            prev.innerHTML = '<img src="' + esc(ui.editorDraft.config.playerAvatar) + '" alt="">';
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function init() {
    bindEvents();
    var app = $('miya-simulator-app');
    if (global.MiyaSimulatorPlayModules && global.MiyaSimulatorPlayModules.bindModuleEvents) {
      global.MiyaSimulatorPlayModules.bindModuleEvents(app);
    }
    if (global.MiyaSimulatorNarrative && global.MiyaSimulatorNarrative.bindNarrativeEvents) {
      global.MiyaSimulatorNarrative.bindNarrativeEvents(app);
    }
    var boot = global.miyaBootstrapKvStores
      ? global.miyaBootstrapKvStores()
      : Promise.resolve();
    boot.then(function () { return store().whenReady(); }).then(function () {
      var st = store();
      var before = hubStats().customs;
      var chain = st.tryRecoverFromStorage ? st.tryRecoverFromStorage() : Promise.resolve({ ok: false });
      return chain.then(function (info) {
        var after = hubStats().customs;
        if (info && info.ok && after > before) {
          toast('已从本地备份恢复 ' + after + ' 个自定义剧本');
        }
        if (global.MiyaSimulatorPlayModules && global.MiyaSimulatorPlayModules.applyDecorFromStore) {
          global.MiyaSimulatorPlayModules.applyDecorFromStore();
        }
        render();
      });
    });
  }

  global.miyaSimulatorApp = {
    init: init,
    render: render,
    openScript: openScript,
    backToHub: backToHub,
    getView: function () { return ui.view; },
    getScriptId: function () { return ui.scriptId; },
    toast: toast,
    closeScriptSettings: closeScriptSettings,
    refreshDrawerModule: refreshDrawerModule,
    setReviewTurn: function (turn) {
      ui.reviewSelectedTurn = turn == null || turn === '' ? null : parseInt(turn, 10);
      if (ui.drawerModule === 'review') refreshDrawerModule('review');
      else openModuleDrawer('review');
    }
  };
})(window);
