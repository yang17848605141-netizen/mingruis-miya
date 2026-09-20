(function (global) {
  'use strict';

  var LS_KEY = 'miya-simulator-v2';
  var LS_KEY_LEGACY = 'miya-simulator-v1';
  var LS_BACKUP_KEY = 'miya-simulator-v2-backup';
  var API_CONFIG_KEY = 'miya-api-config';
  var cache = null;
  var _ready = null;
  var _hydrated = false;
  var _persistChain = Promise.resolve();
  var _lastPersistedRichness = -1;
  /** 叙事/总结生成中（仅内存，不持久化；刷新即失效） */
  var _playGenerating = {};

  var DEFAULT_WRITING_STYLE =
    '文学性强、展览级叙事质感。以镜头语言组织段落——远景定场、中景交锋、特写收束，格与格之间留呼吸。\n' +
    '对白自然克制，情绪藏于细节；少用直白心理说明，多用环境与动作暗示。';

  var DEFAULT_STAT_MAX = 1000;
  var DEFAULT_STAT_INITIAL = 50;
  var DAYS_PER_WEEK = 7;
  var WEEKS_PER_MONTH = 4;
  var MONTHS_PER_YEAR = 12;

  var STAT_REFERENCE = [
    { id: 'physique', name: '体质', max: DEFAULT_STAT_MAX, initial: DEFAULT_STAT_INITIAL },
    { id: 'mind', name: '智力', max: DEFAULT_STAT_MAX, initial: DEFAULT_STAT_INITIAL },
    { id: 'charm', name: '魅力', max: DEFAULT_STAT_MAX, initial: DEFAULT_STAT_INITIAL },
    { id: 'luck', name: '幸运', max: DEFAULT_STAT_MAX, initial: DEFAULT_STAT_INITIAL },
    { id: 'wealth', name: '财力', max: DEFAULT_STAT_MAX, initial: DEFAULT_STAT_INITIAL }
  ];

  var RANK_REFERENCE_SHOWBIZ = [
    { rank: 1, name: '十八线糊咖', expRequired: 0, requirements: [] },
    { rank: 2, name: '龙套艺人', expRequired: 80, requirements: [{ statName: '魅力', min: 12 }] },
    { rank: 3, name: '小有名气', expRequired: 200, requirements: [{ statName: '魅力', min: 22 }, { statName: '名气', min: 15 }] },
    { rank: 4, name: '网剧女主', expRequired: 500, requirements: [{ statName: '魅力', min: 35 }, { statName: '名气', min: 28 }] },
    { rank: 5, name: '卫视女配', expRequired: 1200, requirements: [{ statName: '魅力', min: 48 }, { statName: '演技', min: 40 }] },
    { rank: 6, name: '一线花旦', expRequired: 3000, requirements: [{ statName: '魅力', min: 58 }, { statName: '名气', min: 55 }] },
    { rank: 7, name: '影后提名', expRequired: 6000, requirements: [{ statName: '演技', min: 68 }, { statName: '人脉', min: 50 }] },
    { rank: 8, name: '金马影后', expRequired: 12000, requirements: [{ statName: '演技', min: 78 }, { statName: '名气', min: 72 }] },
    { rank: 9, name: '国际影后', expRequired: 25000, requirements: [{ statName: '魅力', min: 85 }, { statName: '名气', min: 88 }] },
    { rank: 10, name: '传奇巨星', expRequired: 50000, requirements: [{ statName: '演技', min: 92 }, { statName: '人脉', min: 85 }] }
  ];

  var RANK_REFERENCE_GUFENG = [
    { rank: 1, name: '入宫宫女', expRequired: 0, requirements: [] },
    { rank: 2, name: '粗使宫女', expRequired: 30, requirements: [{ statName: '体质', min: 8 }] },
    { rank: 3, name: '洒扫宫女', expRequired: 60, requirements: [{ statName: '体质', min: 15 }] },
    { rank: 4, name: '贴身宫女', expRequired: 100, requirements: [{ statName: '魅力', min: 18 }] },
    { rank: 5, name: '答应', expRequired: 150, requirements: [{ statName: '魅力', min: 25 }] },
    { rank: 6, name: '常在', expRequired: 220, requirements: [{ statName: '魅力', min: 32 }, { statName: '圣宠', min: 20 }] },
    { rank: 7, name: '贵人', expRequired: 320, requirements: [{ statName: '魅力', min: 40 }, { statName: '圣宠', min: 30 }] },
    { rank: 8, name: '嫔', expRequired: 450, requirements: [{ statName: '智谋', min: 35 }, { statName: '圣宠', min: 42 }] },
    { rank: 9, name: '妃', expRequired: 650, requirements: [{ statName: '智谋', min: 48 }, { statName: '权势', min: 38 }] },
    { rank: 10, name: '贵妃', expRequired: 900, requirements: [{ statName: '圣宠', min: 55 }, { statName: '权势', min: 48 }] },
    { rank: 11, name: '皇贵妃', expRequired: 1300, requirements: [{ statName: '智谋', min: 58 }, { statName: '权势', min: 55 }] },
    { rank: 12, name: '协理六宫', expRequired: 1800, requirements: [{ statName: '智谋', min: 65 }, { statName: '圣宠', min: 62 }] },
    { rank: 13, name: '皇后', expRequired: 2500, requirements: [{ statName: '权势', min: 72 }, { statName: '圣宠', min: 70 }] },
    { rank: 14, name: '垂帘听政', expRequired: 3500, requirements: [{ statName: '智谋', min: 78 }, { statName: '权势', min: 78 }] },
    { rank: 15, name: '圣母皇太后', expRequired: 5000, requirements: [{ statName: '权势', min: 85 }] },
    { rank: 16, name: '太皇太后', expRequired: 7000, requirements: [{ statName: '智谋', min: 88 }, { statName: '权势', min: 88 }] },
    { rank: 17, name: '万世名后', expRequired: 10000, requirements: [{ statName: '圣宠', min: 90 }, { statName: '权势', min: 92 }] },
    { rank: 18, name: '海岛太后', expRequired: 15000, requirements: [{ statName: '智谋', min: 92 }] },
    { rank: 19, name: '谪仙太后', expRequired: 22000, requirements: [{ statName: '权势', min: 95 }] },
    { rank: 20, name: '青史皇后', expRequired: 30000, requirements: [{ statName: '智谋', min: 95 }, { statName: '权势', min: 98 }] }
  ];

  var TURN_UNITS = {
    day: { id: 'day', label: '天' },
    week: { id: 'week', label: '周' },
    month: { id: 'month', label: '月' },
    year: { id: 'year', label: '年' }
  };

  var GENRES = {
    gufeng: { id: 'gufeng', label: '古风', glyph: '古', tone: 'ink-wash' },
    modern: { id: 'modern', label: '现代', glyph: '今', tone: 'city-grid' },
    showbiz: { id: 'showbiz', label: '娱乐圈', glyph: '星', tone: 'spotlight' },
    infinite: { id: 'infinite', label: '无限流', glyph: '∞', tone: 'glitch' },
    custom: { id: 'custom', label: '自定义', glyph: '自', tone: 'blank' }
  };

  var BUILTIN_SCRIPTS = [
    {
      id: 'builtin_gufeng_palace',
      builtin: true,
      genre: 'gufeng',
      genreLabel: '古风',
      title: '宫阙长歌',
      subtitle: '从掖庭宫女到权倾朝野 · 十二卷主线',
      tagline: '「深宫如海，一步踏错便是万劫。」',
      coverGlyph: '阙',
      episodes: 12,
      difficulty: '极难',
      features: ['派系斗争', '宠妃养成', '情报网', '宫宴抉择', '太医脉案', '出宫支线']
    },
    {
      id: 'builtin_modern_city',
      builtin: true,
      genre: 'modern',
      genreLabel: '现代',
      title: '深城手记',
      subtitle: '二十八岁 · 租房、职场、恋爱与破产边缘',
      tagline: '「地铁末班车之后，城市才真正醒来。」',
      coverGlyph: '城',
      episodes: 8,
      difficulty: '普通',
      features: ['职业树', '房贷压力', '社交能量', '副业', '城市地图', '随机新闻']
    },
    {
      id: 'builtin_showbiz_star',
      builtin: true,
      genre: 'showbiz',
      genreLabel: '娱乐圈',
      title: '星途浮沉',
      subtitle: '练习生到顶流 · 合约、绯闻与舆论战',
      tagline: '「镜头亮起来时，连呼吸都要算绩效。」',
      coverGlyph: '光',
      episodes: 10,
      difficulty: '困难',
      features: ['通告排期', '粉丝舆论', 'CP线', '黑料池', '奖项季', '经纪合约']
    },
    {
      id: 'builtin_infinite_loop',
      builtin: true,
      genre: 'infinite',
      genreLabel: '无限流',
      title: '副本降临',
      subtitle: 'Ω-017 通关者 · 规则怪谈与队友生死',
      tagline: '「欢迎回来，幸存者。本轮存活率 3.7%。」',
      coverGlyph: 'Ω',
      episodes: 99,
      difficulty: '地狱',
      features: ['副本池', '规则书', '队友羁绊', '道具诅咒', 'SAN值', '主神商店']
    }
  ];

  function uid(prefix) {
    return (prefix || 'sim') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function clampInt(v, lo, hi, fb) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fb;
    return Math.min(hi, Math.max(lo, n));
  }

  function defaultScriptConfig(overrides) {
    var base = {
      genreLabel: '',
      playerName: '',
      playerAvatar: '',
      playerGender: '',
      playerAge: 18,
      worldview: '',
      writingStyle: DEFAULT_WRITING_STYLE,
      turnUnit: 'day',
      playerStats: [],
      rankLevels: [],
      initialSkills: [],
      initialTalents: []
    };
    if (overrides && typeof overrides === 'object') {
      Object.keys(overrides).forEach(function (k) {
        if (overrides[k] !== undefined) base[k] = overrides[k];
      });
    }
    return base;
  }

  function normalizeStatRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    var max = clampInt(raw.max, 1, 999999, DEFAULT_STAT_MAX);
    var initial = clampInt(
      raw.initial != null ? raw.initial : (raw.initialValue != null ? raw.initialValue : DEFAULT_STAT_INITIAL),
      0,
      max,
      DEFAULT_STAT_INITIAL
    );
    return {
      id: String(raw.id || uid('stat')),
      name: name.slice(0, 16),
      max: max,
      initial: initial
    };
  }

  function normalizeRankRequirement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var statId = String(raw.statId || raw.id || '').trim();
    var statName = String(raw.statName || raw.name || raw.stat || '').trim();
    if (!statId && !statName) return null;
    return {
      statId: statId.slice(0, 24),
      statName: statName.slice(0, 16),
      min: clampInt(raw.min, 0, 999999, 0)
    };
  }

  function normalizeRankLevel(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    var reqs = Array.isArray(raw.requirements)
      ? raw.requirements.map(normalizeRankRequirement).filter(Boolean)
      : [];
    return {
      rank: clampInt(raw.rank, 1, 99, index + 1),
      name: name.slice(0, 24),
      expRequired: clampInt(raw.expRequired != null ? raw.expRequired : raw.exp, 0, 999999999, 0),
      requirements: reqs
    };
  }

  function normalizeScriptConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var unit = TURN_UNITS[src.turnUnit] ? src.turnUnit : 'day';
    return {
      genreLabel: String(src.genreLabel || '').slice(0, 32),
      playerName: String(src.playerName || '').slice(0, 24),
      playerAvatar: String(src.playerAvatar || '').slice(0, 120000),
      playerGender: String(src.playerGender || '').slice(0, 12),
      playerAge: clampInt(src.playerAge, 1, 200, 18),
      worldview: String(src.worldview || '').slice(0, 8000),
      writingStyle: String(src.writingStyle || DEFAULT_WRITING_STYLE).slice(0, 4000),
      turnUnit: unit,
      playerStats: Array.isArray(src.playerStats)
        ? src.playerStats.map(normalizeStatRow).filter(Boolean)
        : [],
      rankLevels: Array.isArray(src.rankLevels)
        ? src.rankLevels.map(normalizeRankLevel).filter(Boolean)
        : [],
      initialSkills: Array.isArray(src.initialSkills)
        ? src.initialSkills.map(normalizeConfigSkillRow).filter(Boolean).slice(0, 12)
        : [],
      initialTalents: Array.isArray(src.initialTalents)
        ? src.initialTalents.map(normalizeConfigTalentRow).filter(Boolean).slice(0, 20)
        : []
    };
  }

  function defaultGameTime() {
    return { year: 1, month: 1, week: 1, day: 1 };
  }

  function normalizeGameTime(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      year: clampInt(src.year, 1, 99999, 1),
      month: clampInt(src.month, 1, MONTHS_PER_YEAR, 1),
      week: clampInt(src.week, 1, WEEKS_PER_MONTH, 1),
      day: clampInt(src.day, 1, DAYS_PER_WEEK, 1)
    };
  }

  function formatGameTime(raw) {
    var gt = normalizeGameTime(raw);
    return gt.year + '年' + gt.month + '月' + gt.week + '周' + gt.day + '日';
  }

  function advanceGameTime(raw, turnUnit) {
    var gt = normalizeGameTime(raw);
    var unit = TURN_UNITS[turnUnit] ? turnUnit : 'day';
    if (unit === 'year') {
      gt.year += 1;
      return gt;
    }
    if (unit === 'month') {
      gt.month += 1;
      if (gt.month > MONTHS_PER_YEAR) {
        gt.month = 1;
        gt.year += 1;
      }
      return gt;
    }
    if (unit === 'week') {
      gt.week += 1;
      if (gt.week > WEEKS_PER_MONTH) {
        gt.week = 1;
        gt.month += 1;
        if (gt.month > MONTHS_PER_YEAR) {
          gt.month = 1;
          gt.year += 1;
        }
      }
      return gt;
    }
    gt.day += 1;
    if (gt.day > DAYS_PER_WEEK) {
      gt.day = 1;
      gt.week += 1;
      if (gt.week > WEEKS_PER_MONTH) {
        gt.week = 1;
        gt.month += 1;
        if (gt.month > MONTHS_PER_YEAR) {
          gt.month = 1;
          gt.year += 1;
        }
      }
    }
    return gt;
  }

  function buildCustomStatsFromConfig(cfg) {
    var out = {};
    var stats = (cfg && cfg.playerStats) || [];
    stats.forEach(function (st) {
      if (!st || !st.id) return;
      out[st.id] = clampInt(st.initial, 0, st.max, DEFAULT_STAT_INITIAL);
    });
    return out;
  }

  function syncCustomStatsFromConfig(save, cfg) {
    if (!save) return;
    if (!save.customStats || typeof save.customStats !== 'object') save.customStats = {};
    var stats = (cfg && cfg.playerStats) || [];
    stats.forEach(function (st) {
      if (!st || !st.id) return;
      if (save.customStats[st.id] == null) {
        save.customStats[st.id] = clampInt(st.initial, 0, st.max, DEFAULT_STAT_INITIAL);
      }
    });
  }

  function defaultPlayMeta() {
    return {
      retainRounds: 5,
      summaryAutoEvery: 3,
      turnsSinceSummary: 0,
      manualMemoryNotes: ''
    };
  }

  function normalizeGeneratingFlag(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      kind: String(raw.kind || 'turn').slice(0, 24),
      label: String(raw.label || '生成中…').slice(0, 48),
      startedAt: parseInt(raw.startedAt, 10) || Date.now()
    };
  }

  function getPlayGenerating(scriptId) {
    var sid = String(scriptId || '').trim();
    if (!sid) return null;
    return _playGenerating[sid] || null;
  }

  function setPlayGenerating(scriptId, raw) {
    var sid = String(scriptId || '').trim();
    if (!sid) return null;
    if (!raw) {
      delete _playGenerating[sid];
      return null;
    }
    var next = normalizeGeneratingFlag(raw);
    _playGenerating[sid] = next;
    return next;
  }

  function clearAllPlayGenerating() {
    _playGenerating = {};
  }

  function stripPersistedGenerating(state) {
    if (!state || !state.saves || typeof state.saves !== 'object') return;
    Object.keys(state.saves).forEach(function (sid) {
      var save = state.saves[sid];
      if (!save || !save.playMeta || typeof save.playMeta !== 'object') return;
      if (save.playMeta.generating != null) delete save.playMeta.generating;
    });
  }

  function normalizePlayMeta(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      retainRounds: clampInt(src.retainRounds, 1, 50, 5),
      summaryAutoEvery: clampInt(src.summaryAutoEvery, 0, 50, 3),
      turnsSinceSummary: clampInt(src.turnsSinceSummary, 0, 9999, 0),
      manualMemoryNotes: String(src.manualMemoryNotes || '').slice(0, 4000)
    };
  }

  function normalizeNarrativeChange(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = String(raw.type || raw.kind || 'note').trim().slice(0, 16);
    var name = String(raw.name || raw.label || raw.target || '').trim().slice(0, 32);
    if (!name && type !== 'note') return null;
    var delta = raw.delta != null ? raw.delta : raw.change;
    var after = raw.after != null ? raw.after : raw.value;
    return {
      type: type,
      name: name,
      delta: delta,
      after: after,
      note: String(raw.note || raw.detail || '').slice(0, 120)
    };
  }

  function normalizeNarrativeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var body = String(raw.body || raw.text || raw.content || '').trim();
    if (!body) return null;
    var changes = Array.isArray(raw.changes)
      ? raw.changes.map(normalizeNarrativeChange).filter(Boolean)
      : [];
    return {
      id: String(raw.id || uid('nev')),
      turn: clampInt(raw.turn, 0, 999999, 0),
      timeLabel: String(raw.timeLabel || raw.time || raw.at || '').slice(0, 32),
      title: String(raw.title || raw.headline || '').slice(0, 48),
      body: body.slice(0, 480),
      changes: changes,
      source: String(raw.source || 'turn').slice(0, 16),
      createdAt: parseInt(raw.createdAt, 10) || Date.now()
    };
  }

  function normalizeRoundSummary(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.summary || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || uid('sum')),
      turn: clampInt(raw.turn, 0, 999999, 0),
      turnEnd: clampInt(raw.turnEnd != null ? raw.turnEnd : raw.turn, 0, 999999, 0),
      gameTime: String(raw.gameTime || '').slice(0, 48),
      content: content.slice(0, 2000),
      required: raw.required !== false,
      auto: !!raw.auto,
      createdAt: parseInt(raw.createdAt, 10) || Date.now()
    };
  }

  function normalizeRoundMemory(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || '').trim();
    if (!content) return null;
    return {
      turn: clampInt(raw.turn, 0, 999999, 0),
      content: content.slice(0, 1200),
      createdAt: parseInt(raw.createdAt, 10) || Date.now()
    };
  }

  function normalizeAssetCategory(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid('asset')),
      name: name.slice(0, 20),
      icon: String(raw.icon || raw.emoji || '◆').slice(0, 4),
      value: Number(raw.value),
      unit: String(raw.unit || '').slice(0, 8),
      note: String(raw.note || raw.desc || '').slice(0, 80),
      trend: String(raw.trend || '').slice(0, 12)
    };
  }

  function defaultAssetCategories(genre) {
    if (genre === 'gufeng') {
      return [
        { name: '银两', icon: '银', value: 120, unit: '两' },
        { name: '田产', icon: '田', value: 0, unit: '亩' },
        { name: '首饰', icon: '钗', value: 3, unit: '件' },
        { name: '人情债', icon: '债', value: 0, unit: '笔' }
      ];
    }
    if (genre === 'showbiz') {
      return [
        { name: '活期', icon: '¥', value: 86000, unit: '元' },
        { name: '合约金', icon: '契', value: 0, unit: '元' },
        { name: '代言', icon: '代', value: 0, unit: '单' },
        { name: '负债', icon: '−', value: 0, unit: '元' }
      ];
    }
    return [
      { name: '现金', icon: '¥', value: 12800, unit: '元' },
      { name: '存款', icon: '存', value: 42000, unit: '元' },
      { name: '不动产', icon: '⌂', value: 0, unit: '套' },
      { name: '投资', icon: '↗', value: 0, unit: '份' }
    ];
  }

  function ensureNarrative(save) {
    if (!save) return { lines: [], events: [], pendingChoices: [] };
    if (!save.narrative || typeof save.narrative !== 'object') {
      save.narrative = { lines: [], events: [], pendingChoices: [] };
    }
    if (!Array.isArray(save.narrative.lines)) save.narrative.lines = [];
    if (!Array.isArray(save.narrative.pendingChoices)) save.narrative.pendingChoices = [];
    if (!Array.isArray(save.narrative.events)) {
      save.narrative.events = save.narrative.lines.map(function (line, i) {
        return normalizeNarrativeEvent({
          id: uid('nev'),
          turn: save.turn || 1,
          timeLabel: '',
          title: '',
          body: String(line || ''),
          changes: [],
          source: 'legacy'
        });
      }).filter(Boolean);
    } else {
      save.narrative.events = save.narrative.events.map(normalizeNarrativeEvent).filter(Boolean);
    }
    return save.narrative;
  }

  function ensureAssets(save, scriptMeta) {
    var mods = ensureModules(save);
    if (!mods.assets || typeof mods.assets !== 'object') mods.assets = {};
    var cats = Array.isArray(mods.assets.categories) ? mods.assets.categories : [];
    if (!cats.length) {
      var genre = scriptMeta && scriptMeta.genre ? scriptMeta.genre : 'modern';
      cats = defaultAssetCategories(genre).map(normalizeAssetCategory).filter(Boolean);
    } else {
      cats = cats.map(normalizeAssetCategory).filter(Boolean);
    }
    mods.assets.categories = cats.slice(0, 24);
    mods.assets.updatedAt = mods.assets.updatedAt || Date.now();
    return mods.assets;
  }

  function ensureMemory(save) {
    var mods = ensureModules(save);
    if (!mods.memory || typeof mods.memory !== 'object') {
      mods.memory = { summaries: [], roundMemories: [] };
    }
    if (!Array.isArray(mods.memory.summaries)) mods.memory.summaries = [];
    mods.memory.summaries = mods.memory.summaries.map(normalizeRoundSummary).filter(Boolean);
    if (!Array.isArray(mods.memory.roundMemories)) mods.memory.roundMemories = [];
    mods.memory.roundMemories = mods.memory.roundMemories.map(normalizeRoundMemory).filter(Boolean);
    return mods.memory;
  }

  function ensurePlayMeta(save) {
    if (!save.playMeta || typeof save.playMeta !== 'object') save.playMeta = defaultPlayMeta();
    save.playMeta = normalizePlayMeta(save.playMeta);
    return save.playMeta;
  }

  function normalizeSaveData(save, scriptMeta) {
    if (!save || typeof save !== 'object') return save;
    var cfg = (scriptMeta && scriptMeta.config) || defaultScriptConfig();
    if (!save.gameTime) save.gameTime = defaultGameTime();
    else save.gameTime = normalizeGameTime(save.gameTime);
    if (save.turn == null || !Number.isFinite(Number(save.turn))) save.turn = 1;
    save.turn = clampInt(save.turn, 0, 999999, 1);
    save.turnUnitLabel = (TURN_UNITS[cfg.turnUnit] || TURN_UNITS.day).label;
    syncCustomStatsFromConfig(save, cfg);
    ensureNarrative(save);
    ensureAssets(save, scriptMeta);
    ensureMemory(save);
    ensurePlayMeta(save);
    ensureNpcs(save);
    ensureModules(save);
    return save;
  }

  function resolveStatValue(save, script, req) {
    if (!save || !req) return 0;
    var sid = String(req.statId || '').trim();
    var sname = String(req.statName || '').trim();
    if (sid && save.stats && save.stats[sid] != null) return Number(save.stats[sid]) || 0;
    if (sid && save.customStats && save.customStats[sid] != null) return Number(save.customStats[sid]) || 0;
    var cfgStats = (script && script.config && script.config.playerStats) || [];
    var i;
    for (i = 0; i < cfgStats.length; i++) {
      var st = cfgStats[i];
      if (!st) continue;
      if (sid && st.id === sid) {
        if (save.customStats && save.customStats[st.id] != null) return Number(save.customStats[st.id]) || 0;
        break;
      }
      if (sname && st.name === sname) {
        if (save.customStats && save.customStats[st.id] != null) return Number(save.customStats[st.id]) || 0;
        if (save.stats && save.stats[st.id] != null) return Number(save.stats[st.id]) || 0;
        break;
      }
    }
    if (sname) {
      var keys = ['physique', 'mind', 'charm', 'luck', 'wealth', 'social', 'fame', 'san', 'mood', 'stress', 'health'];
      var map = { 体质: 'physique', 智力: 'mind', 魅力: 'charm', 幸运: 'luck', 财力: 'wealth', 名气: 'fame', 声望: 'fame' };
      var key = map[sname];
      if (key && save.stats && save.stats[key] != null) return Number(save.stats[key]) || 0;
    }
    return 0;
  }

  function getRankLadder(script) {
    var cfg = script && script.config ? script.config : {};
    return Array.isArray(cfg.rankLevels) ? cfg.rankLevels : [];
  }

  function getRankProgress(script, save) {
    var ladder = getRankLadder(script);
    if (!ladder.length) return null;
    var idx = clampInt(save && save.rankIndex, 0, ladder.length - 1, 0);
    var current = ladder[idx] || ladder[0];
    var next = idx < ladder.length - 1 ? ladder[idx + 1] : null;
    return {
      index: idx,
      current: current,
      next: next,
      exp: clampInt(save && save.rankExp, 0, 999999999, 0),
      maxRank: ladder.length
    };
  }

  function evaluateRankPromotion(script, save) {
    var prog = getRankProgress(script, save);
    if (!prog || !prog.next) {
      return { canPromote: false, reason: prog ? 'max_rank' : 'no_ladder', progress: prog };
    }
    var exp = prog.exp;
    var next = prog.next;
    if (exp < next.expRequired) {
      return {
        canPromote: false,
        reason: 'exp',
        needExp: next.expRequired - exp,
        progress: prog
      };
    }
    var failed = [];
    (next.requirements || []).forEach(function (req) {
      var val = resolveStatValue(save, script, req);
      if (val < req.min) {
        failed.push({
          statName: req.statName || req.statId,
          need: req.min,
          have: val
        });
      }
    });
    if (failed.length) {
      return { canPromote: false, reason: 'stats', failed: failed, progress: prog };
    }
    return { canPromote: true, progress: prog };
  }

  function promoteRank(scriptId) {
    var script = findScript(scriptId);
    var save = getSave(scriptId);
    if (!script || !save) return null;
    var check = evaluateRankPromotion(script, save);
    if (!check.canPromote) return check;
    var ladder = getRankLadder(script);
    var idx = clampInt(save.rankIndex, 0, ladder.length - 1, 0);
    if (idx >= ladder.length - 1) return check;
    save.rankIndex = idx + 1;
    save.updatedAt = Date.now();
    persistCache();
    return { promoted: true, rank: ladder[save.rankIndex], progress: getRankProgress(script, save) };
  }

  function defaultApiConfig() {
    return { baseUrl: '', apiKey: '', model: '', temperature: 0.85 };
  }

  function normalizeApiConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      baseUrl: String(src.baseUrl || '').trim(),
      apiKey: String(src.apiKey || '').trim(),
      model: String(src.model || '').trim(),
      temperature: Math.min(2, Math.max(0, parseFloat(src.temperature) || 0.85))
    };
  }

  function defaultStats(genre) {
    var base = {
      physique: 42,
      mind: 48,
      charm: 55,
      luck: 38,
      social: 44,
      wealth: 30,
      mood: 72,
      stress: 18,
      health: 88,
      fame: 12,
      san: 100
    };
    if (genre === 'gufeng') {
      base.charm = 62;
      base.wealth = 18;
      base.fame = 8;
    }
    if (genre === 'showbiz') {
      base.fame = 35;
      base.charm = 68;
    }
    if (genre === 'infinite') {
      base.san = 86;
      base.luck = 52;
    }
    return base;
  }

  function defaultSchedule() {
    return [
      { slot: 'morning', label: '晨', event: '未安排', status: 'idle' },
      { slot: 'noon', label: '午', event: '未安排', status: 'idle' },
      { slot: 'dusk', label: '暮', event: '未安排', status: 'idle' },
      { slot: 'night', label: '夜', event: '未安排', status: 'idle' }
    ];
  }

  var NPC_MAX_COUNT = 80;

  function normalizeNpc(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    var identity = String(raw.identity || raw.role || raw.身份 || '').trim();
    return {
      id: String(raw.id || uid('npc')),
      avatar: String(raw.avatar || '').slice(0, 120000),
      name: name.slice(0, 24),
      gender: String(raw.gender || raw.性别 || '').slice(0, 12),
      age: (function () {
        var a = raw.age != null ? raw.age : raw.年龄;
        if (a === '' || a == null) return '';
        return clampInt(a, 0, 200, 0);
      })(),
      identity: identity.slice(0, 48),
      occupation: String(raw.occupation || raw.职业 || '').slice(0, 48),
      persona: String(raw.persona || raw.人设 || raw.bio || raw.personality || '').slice(0, 600),
      affinity: clampInt(raw.affinity, -100, 100, 0),
      role: String(raw.role || '').slice(0, 32),
      mood: String(raw.mood || '').slice(0, 24),
      metTurn: clampInt(raw.metTurn, 0, 999999, 0),
      createdAt: parseInt(raw.createdAt, 10) || Date.now()
    };
  }

  function ensureNpcs(save) {
    if (!save) return [];
    if (!Array.isArray(save.npcs)) save.npcs = [];
    save.npcs = save.npcs.map(normalizeNpc).filter(Boolean).slice(0, NPC_MAX_COUNT);
    return save.npcs;
  }

  function findNpcByName(save, name) {
    var n = String(name || '').trim();
    if (!n || !save) return null;
    ensureNpcs(save);
    return save.npcs.find(function (npc) { return npc.name === n; }) || null;
  }

  function getNpcs(scriptId) {
    var save = getSave(scriptId);
    if (!save) return [];
    return ensureNpcs(save);
  }

  function upsertNpc(scriptId, patch) {
    var save = getSave(scriptId);
    if (!save) return null;
    var row = normalizeNpc(patch);
    if (!row) return null;
    ensureNpcs(save);
    var idx = save.npcs.findIndex(function (n) {
      return n.id === row.id || n.name === row.name;
    });
    if (idx >= 0) {
      row.id = save.npcs[idx].id;
      row.createdAt = save.npcs[idx].createdAt;
      if (!row.metTurn && save.npcs[idx].metTurn) row.metTurn = save.npcs[idx].metTurn;
      save.npcs[idx] = Object.assign({}, save.npcs[idx], row);
      row = save.npcs[idx];
    } else {
      if (!row.metTurn) row.metTurn = save.turn || 1;
      save.npcs.push(row);
      if (save.npcs.length > NPC_MAX_COUNT) save.npcs = save.npcs.slice(-NPC_MAX_COUNT);
    }
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function removeNpc(scriptId, npcId) {
    var save = getSave(scriptId);
    if (!save) return false;
    ensureNpcs(save);
    var before = save.npcs.length;
    save.npcs = save.npcs.filter(function (n) { return n.id !== npcId; });
    if (save.npcs.length === before) return false;
    save.updatedAt = Date.now();
    persistCache();
    return true;
  }

  function mergeNewContacts(scriptId, list, opts) {
    opts = opts || {};
    var save = getSave(scriptId);
    if (!save || !list || !list.length) return [];
    var added = [];
    list.forEach(function (raw) {
      if (!raw) return;
      var name = String(raw.name || raw.名称 || '').trim();
      if (!name || findNpcByName(save, name)) return;
      var row = upsertNpc(scriptId, Object.assign({}, raw, {
        name: name,
        metTurn: opts.turn != null ? opts.turn : save.turn || 1
      }));
      if (row) added.push(row);
    });
    return added;
  }

  function npcForApiContext(npc) {
    if (!npc) return null;
    return {
      name: npc.name,
      gender: npc.gender,
      age: npc.age,
      identity: npc.identity || npc.role,
      occupation: npc.occupation,
      persona: trimCtxTextStore(npc.persona, 200),
      affinity: npc.affinity,
      mood: npc.mood
    };
  }

  function trimCtxTextStore(str, max) {
    var s = String(str || '').trim();
    if (!s) return '';
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  function normalizeFavorite(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var body = String(raw.body || '').trim();
    if (!body) return null;
    return {
      id: String(raw.id || uid('fav')),
      eventId: String(raw.eventId || '').slice(0, 48),
      turn: clampInt(raw.turn, 0, 999999, 0),
      timeLabel: String(raw.timeLabel || '').slice(0, 32),
      title: String(raw.title || '').slice(0, 48),
      body: body.slice(0, 480),
      changes: Array.isArray(raw.changes) ? raw.changes.map(normalizeNarrativeChange).filter(Boolean) : [],
      favoritedAt: parseInt(raw.favoritedAt, 10) || Date.now()
    };
  }

  function ensureFavorites(save) {
    var mods = ensureModules(save);
    if (!Array.isArray(mods.favorites)) mods.favorites = [];
    mods.favorites = mods.favorites.map(normalizeFavorite).filter(Boolean).slice(0, 200);
    return mods.favorites;
  }

  function isEventFavorited(scriptId, eventId) {
    var save = getSave(scriptId);
    if (!save || !eventId) return false;
    return ensureFavorites(save).some(function (f) { return f.eventId === eventId; });
  }

  function toggleNarrativeFavorite(scriptId, eventId) {
    var save = getSave(scriptId);
    if (!save || !eventId) return { favorited: false };
    var favs = ensureFavorites(save);
    var idx = favs.findIndex(function (f) { return f.eventId === eventId; });
    if (idx >= 0) {
      favs.splice(idx, 1);
      save.updatedAt = Date.now();
      persistCache();
      return { favorited: false };
    }
    var narr = ensureNarrative(save);
    var ev = narr.events.find(function (e) { return e.id === eventId; });
    if (!ev) return { favorited: false, error: 'not_found' };
    favs.unshift(normalizeFavorite({
      eventId: ev.id,
      turn: ev.turn,
      timeLabel: ev.timeLabel,
      title: ev.title,
      body: ev.body,
      changes: ev.changes
    }));
    save.updatedAt = Date.now();
    persistCache();
    return { favorited: true };
  }

  function removeFavorite(scriptId, favId) {
    var save = getSave(scriptId);
    if (!save) return false;
    var favs = ensureFavorites(save);
    var before = favs.length;
    var mods = ensureModules(save);
    mods.favorites = favs.filter(function (f) { return f.id !== favId; });
    if (mods.favorites.length === before) return false;
    save.updatedAt = Date.now();
    persistCache();
    return true;
  }

  function getFavorites(scriptId) {
    var save = getSave(scriptId);
    if (!save) return [];
    return ensureFavorites(save);
  }

  function defaultNpcs(genre) {
    var maps = {
      gufeng: [
        { id: 'npc_empress', name: '皇后', gender: '女', age: 32, identity: '掌权者', occupation: '六宫之主', persona: '表面温厚，实则步步为营。', affinity: 12, mood: '警惕' },
        { id: 'npc_healer', name: '沈太医', gender: '男', age: 28, identity: '盟友', occupation: '太医院当值', persona: '寡言守信，擅察脉象与人心。', affinity: 28, mood: '温和' },
        { id: 'npc_rival', name: '丽嫔', gender: '女', age: 19, identity: '对手', occupation: '嫔位', persona: '明艳好胜，最忌被人看轻。', affinity: -15, mood: '敌意' }
      ],
      modern: [
        { id: 'npc_boss', name: '周总监', gender: '男', age: 38, identity: '上司', occupation: '部门负责人', persona: '结果导向，不喜解释。', affinity: 5, mood: '冷淡' },
        { id: 'npc_roomie', name: '阿禾', gender: '女', age: 22, identity: '室友', occupation: '自由插画', persona: '乐天派，爱收集城市边角料故事。', affinity: 42, mood: '开朗' },
        { id: 'npc_ex', name: '陈予', gender: '非二元', age: 24, identity: '前任', occupation: '产品经理', persona: '理性克制，偶尔仍会破例帮忙。', affinity: -8, mood: '复杂' }
      ],
      showbiz: [
        { id: 'npc_agent', name: '林经纪', gender: '女', age: 34, identity: '经纪人', occupation: '艺人经纪', persona: '算盘精，护短也护己。', affinity: 35, mood: '算计' },
        { id: 'npc_rival_star', name: '顾星野', gender: '男', age: 26, identity: '竞品', occupation: '流量艺人', persona: '镜头前完美，私下争强好胜。', affinity: -6, mood: '假笑' },
        { id: 'npc_fanlead', name: '站姐·小满', gender: '女', age: 20, identity: '粉头', occupation: '应援组织', persona: '信息灵通，情绪起伏大。', affinity: 58, mood: '狂热' }
      ],
      infinite: [
        { id: 'npc_veteran', name: '老K', gender: '男', age: 30, identity: '老手', occupation: '资深轮回者', persona: '见过太多副本，只信规则与筹码。', affinity: 22, mood: '冷静' },
        { id: 'npc_rookie', name: '小舟', gender: '女', age: 18, identity: '新人', occupation: '新人轮回者', persona: '胆小但直觉敏锐。', affinity: 40, mood: '恐惧' },
        { id: 'npc_system', name: '主神', gender: '未知', age: '', identity: '规则', occupation: '系统', persona: '无情绪，只下达任务与奖惩。', affinity: 0, mood: '???' }
      ]
    };
    return (maps[genre] || maps.modern).map(function (n) {
      return normalizeNpc(Object.assign({ metTurn: 1 }, n));
    }).filter(Boolean);
  }

  var DEFAULT_SCRIPT_DECOR_CSS =
    '/* 剧本叙事区 · 装修示例（可整段复制修改） */\n' +
    '.sim-exhibit__frame {\n' +
    '  background: linear-gradient(165deg, #faf6ef 0%, #f0e8dc 52%, #e8dfd2 100%);\n' +
    '  box-shadow: inset 0 0 0 1px rgba(92, 72, 48, 0.14);\n' +
    '}\n' +
    '.sim-exhibit__para {\n' +
    '  line-height: 1.88;\n' +
    '  letter-spacing: 0.05em;\n' +
    '  color: #3a342c;\n' +
    '}\n' +
    '.sim-exhibit__para.is-stage {\n' +
    '  font-style: italic;\n' +
    '  opacity: 0.92;\n' +
    '}\n' +
    '.sim-play-top__title {\n' +
    '  letter-spacing: 0.12em;\n' +
    '}';

  var BUILTIN_STAT_LABELS = {
    physique: '体质',
    mind: '智力',
    charm: '魅力',
    luck: '幸运',
    wealth: '财力',
    social: '社交',
    fame: '名气',
    mood: '心情',
    stress: '压力',
    health: '健康',
    san: '理智'
  };

  var SKILL_MAX_LEVEL = 100;
  var SKILL_MAX_COUNT = 100;

  function defaultPlayerProfile(cfg) {
    var c = cfg || {};
    var playerName = String(c.playerName || '').trim() || '旅人';
    return {
      name: playerName,
      avatar: c.playerAvatar || '',
      gender: c.playerGender || '',
      age: clampInt(c.playerAge, 1, 200, 18),
      birthday: '',
      appearance: '',
      personality: '',
      identity: '',
      occupation: '',
      statusTitle: '',
      statusDesc: ''
    };
  }

  function normalizePlayerProfile(raw, cfg) {
    var base = defaultPlayerProfile(cfg);
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      name: String(src.name || base.name).slice(0, 24),
      avatar: String(src.avatar || base.avatar).slice(0, 120000),
      gender: String(src.gender || base.gender).slice(0, 12),
      age: clampInt(src.age != null ? src.age : base.age, 1, 200, base.age),
      birthday: String(src.birthday || base.birthday).slice(0, 32),
      appearance: String(src.appearance || base.appearance).slice(0, 500),
      personality: String(src.personality || base.personality).slice(0, 500),
      identity: String(src.identity || base.identity).slice(0, 120),
      occupation: String(src.occupation || base.occupation).slice(0, 120),
      statusTitle: String(src.statusTitle || base.statusTitle).slice(0, 48),
      statusDesc: String(src.statusDesc || base.statusDesc).slice(0, 300)
    };
  }

  function skillExpForLevel(level) {
    var lv = clampInt(level, 1, SKILL_MAX_LEVEL, 1);
    if (lv <= 1) return 0;
    var total = 0;
    for (var i = 1; i < lv; i += 1) total += i * 10;
    return total;
  }

  function skillExpToNext(level) {
    var lv = clampInt(level, 1, SKILL_MAX_LEVEL, 1);
    if (lv >= SKILL_MAX_LEVEL) return 0;
    return lv * 10;
  }

  function normalizeSkill(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    var level = clampInt(raw.level, 1, SKILL_MAX_LEVEL, 1);
    var exp = clampInt(raw.exp, 0, 9999999, skillExpForLevel(level));
    var minExp = skillExpForLevel(level);
    var maxExp = level >= SKILL_MAX_LEVEL ? minExp : skillExpForLevel(level + 1) - 1;
    if (exp < minExp) exp = minExp;
    if (exp > maxExp) exp = maxExp;
    var row = {
      id: String(raw.id || uid('skill')),
      name: name.slice(0, 24),
      desc: String(raw.desc || raw.description || '').slice(0, 280),
      level: level,
      exp: exp
    };
    if (raw.treeX != null && Number.isFinite(Number(raw.treeX))) {
      row.treeX = Math.min(1, Math.max(0, Number(raw.treeX)));
    }
    if (raw.treeY != null && Number.isFinite(Number(raw.treeY))) {
      row.treeY = Math.min(1, Math.max(0, Number(raw.treeY)));
    }
    return row;
  }

  function normalizeTalent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid('talent')),
      name: name.slice(0, 24),
      desc: String(raw.desc || raw.description || '').slice(0, 280)
    };
  }

  function normalizeConfigSkillRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.名称 || '').trim();
    if (!name) return null;
    return {
      name: name.slice(0, 24),
      desc: String(raw.desc || raw.description || raw.介绍 || '').slice(0, 280)
    };
  }

  function normalizeConfigTalentRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      name: name.slice(0, 24),
      desc: String(raw.desc || raw.description || '').slice(0, 280)
    };
  }

  function configRowsToModuleSkills(rows) {
    return (rows || []).map(function (r) {
      return normalizeSkill({ name: r.name, desc: r.desc, level: 1, exp: 0 });
    }).filter(Boolean);
  }

  function configRowsToModuleTalents(rows) {
    return (rows || []).map(function (r) {
      return normalizeTalent({ name: r.name, desc: r.desc });
    }).filter(Boolean);
  }

  function seedModulesFromConfig(save, cfg) {
    if (!save || !cfg) return;
    var mods = ensureModules(save);
    var skills = cfg.initialSkills || [];
    var talents = cfg.initialTalents || [];
    if (!mods.skills.length && skills.length) {
      mods.skills = configRowsToModuleSkills(skills).slice(0, SKILL_MAX_COUNT);
    }
    if (!mods.talents.length && talents.length) {
      mods.talents = configRowsToModuleTalents(talents);
    }
  }

  function normalizeAchievement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid('ach')),
      name: name.slice(0, 32),
      desc: String(raw.desc || raw.description || '').slice(0, 280),
      turn: clampInt(raw.turn, 0, 999999, 0),
      unlockedAt: raw.unlockedAt || Date.now(),
      auto: !!raw.auto
    };
  }

  function ensureModules(save) {
    if (!save) return { skills: [], talents: [], achievements: [] };
    if (!save.modules || typeof save.modules !== 'object') save.modules = {};
    if (!Array.isArray(save.modules.skills)) save.modules.skills = [];
    save.modules.skills = save.modules.skills.map(normalizeSkill).filter(Boolean).slice(0, SKILL_MAX_COUNT);
    if (!Array.isArray(save.modules.talents)) save.modules.talents = [];
    save.modules.talents = save.modules.talents.map(normalizeTalent).filter(Boolean);
    if (!Array.isArray(save.modules.achievements)) save.modules.achievements = [];
    save.modules.achievements = save.modules.achievements.map(normalizeAchievement).filter(Boolean);
    if (!Array.isArray(save.modules.favorites)) save.modules.favorites = [];
    return save.modules;
  }

  function getSkills(scriptId) {
    var save = getSave(scriptId);
    if (!save) return [];
    return ensureModules(save).skills;
  }

  function getTalents(scriptId) {
    var save = getSave(scriptId);
    if (!save) return [];
    return ensureModules(save).talents;
  }

  function getAchievements(scriptId) {
    var save = getSave(scriptId);
    if (!save) return [];
    return ensureModules(save).achievements;
  }

  function getSkillProgress(skill) {
    var row = normalizeSkill(skill);
    if (!row) return { level: 1, exp: 0, cur: 0, need: 10, pct: 0, maxed: false };
    var cur = row.exp - skillExpForLevel(row.level);
    var need = skillExpToNext(row.level);
    var pct = need > 0 ? Math.round((cur / need) * 100) : 100;
    return {
      level: row.level,
      exp: row.exp,
      cur: cur,
      need: need,
      pct: pct,
      maxed: row.level >= SKILL_MAX_LEVEL
    };
  }

  function setSkills(scriptId, skills) {
    var save = getSave(scriptId);
    if (!save) return null;
    var mods = ensureModules(save);
    mods.skills = (skills || []).map(normalizeSkill).filter(Boolean).slice(0, SKILL_MAX_COUNT);
    save.updatedAt = Date.now();
    persistCache();
    return mods.skills;
  }

  function upsertSkill(scriptId, skill) {
    var save = getSave(scriptId);
    if (!save) return null;
    var row = normalizeSkill(skill);
    if (!row) return null;
    var mods = ensureModules(save);
    var idx = mods.skills.findIndex(function (s) { return s.id === row.id; });
    if (idx >= 0) mods.skills[idx] = row;
    else {
      if (mods.skills.length >= SKILL_MAX_COUNT) return null;
      mods.skills.push(row);
    }
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function removeSkill(scriptId, skillId) {
    var save = getSave(scriptId);
    if (!save || !skillId) return null;
    var mods = ensureModules(save);
    mods.skills = mods.skills.filter(function (s) { return s.id !== skillId; });
    save.updatedAt = Date.now();
    persistCache();
    return mods.skills;
  }

  function setTalents(scriptId, talents) {
    var save = getSave(scriptId);
    if (!save) return null;
    var mods = ensureModules(save);
    mods.talents = (talents || []).map(normalizeTalent).filter(Boolean);
    save.updatedAt = Date.now();
    persistCache();
    return mods.talents;
  }

  function upsertTalent(scriptId, talent) {
    var save = getSave(scriptId);
    if (!save) return null;
    var row = normalizeTalent(talent);
    if (!row) return null;
    var mods = ensureModules(save);
    var idx = mods.talents.findIndex(function (t) { return t.id === row.id; });
    if (idx >= 0) mods.talents[idx] = row;
    else mods.talents.push(row);
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function removeTalent(scriptId, talentId) {
    var save = getSave(scriptId);
    if (!save || !talentId) return null;
    var mods = ensureModules(save);
    mods.talents = mods.talents.filter(function (t) { return t.id !== talentId; });
    save.updatedAt = Date.now();
    persistCache();
    return mods.talents;
  }

  function addAchievement(scriptId, achievement) {
    var save = getSave(scriptId);
    if (!save) return null;
    var row = normalizeAchievement(Object.assign({ turn: save.turn || 1, auto: true }, achievement || {}));
    if (!row) return null;
    var mods = ensureModules(save);
    mods.achievements.unshift(row);
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function upsertAchievement(scriptId, achievement) {
    var save = getSave(scriptId);
    if (!save) return null;
    var row = normalizeAchievement(achievement);
    if (!row) return null;
    var mods = ensureModules(save);
    var idx = mods.achievements.findIndex(function (a) { return a.id === row.id; });
    if (idx >= 0) mods.achievements[idx] = row;
    else mods.achievements.unshift(row);
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function removeAchievement(scriptId, achId) {
    var save = getSave(scriptId);
    if (!save || !achId) return null;
    var mods = ensureModules(save);
    mods.achievements = mods.achievements.filter(function (a) { return a.id !== achId; });
    save.updatedAt = Date.now();
    persistCache();
    return mods.achievements;
  }

  function defaultScriptDecor() {
    return { customCss: '', activePresetId: '', presets: [], updatedAt: 0 };
  }

  function normalizeDecorPreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || uid('decor')),
      name: name.slice(0, 24),
      css: String(raw.css || '').slice(0, 48000),
      createdAt: raw.createdAt || Date.now()
    };
  }

  function normalizeScriptDecor(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var presets = Array.isArray(src.presets)
      ? src.presets.map(normalizeDecorPreset).filter(Boolean)
      : [];
    return {
      customCss: String(src.customCss || '').slice(0, 48000),
      activePresetId: String(src.activePresetId || '').slice(0, 48),
      presets: presets.slice(0, 32),
      updatedAt: parseInt(src.updatedAt, 10) || 0
    };
  }

  function touchScriptDecor(decor) {
    if (!decor || typeof decor !== 'object') return defaultScriptDecor();
    decor.updatedAt = Date.now();
    return decor;
  }

  function defaultSave(scriptMeta) {
    var genre = scriptMeta.genre || 'modern';
    var cfg = scriptMeta.config || defaultScriptConfig();
    return {
      scriptId: scriptMeta.id,
      version: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turn: 1,
      turnUnitLabel: (TURN_UNITS[cfg.turnUnit] || TURN_UNITS.day).label,
      gameTime: defaultGameTime(),
      episode: 1,
      episodeTitle: '序章 · 开幕',
      player: defaultPlayerProfile(cfg),
      stats: defaultStats(genre),
      customStats: buildCustomStatsFromConfig(cfg),
      schedule: defaultSchedule(),
      npcs: defaultNpcs(genre),
      inventory: [],
      quests: { main: [], side: [], hidden: [] },
      narrative: {
        lines: [],
        events: [],
        pendingChoices: []
      },
      playMeta: defaultPlayMeta(),
      flags: {},
      log: [],
      modules: {},
      rankIndex: 0,
      rankExp: 0
    };
  }

  function defaultSaveWithConfig(scriptMeta) {
    var save = defaultSave(scriptMeta);
    seedModulesFromConfig(save, scriptMeta.config || defaultScriptConfig());
    return save;
  }

  function defaultState() {
    return {
      version: 2,
      lastScriptId: null,
      lastMode: 'phone',
      apiConfig: defaultApiConfig(),
      customScripts: [],
      saves: {},
      scriptDecor: defaultScriptDecor(),
      storageMeta: { deletedScriptIds: {} }
    };
  }

  function normalizeStorageMeta(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var ids = src.deletedScriptIds && typeof src.deletedScriptIds === 'object' ? src.deletedScriptIds : {};
    return { deletedScriptIds: ids };
  }

  function markScriptDeleted(id) {
    if (!id || !cache) return;
    cache.storageMeta = normalizeStorageMeta(cache.storageMeta);
    cache.storageMeta.deletedScriptIds[String(id)] = Date.now();
  }

  function filterScriptsRespectingTombstones(list, meta) {
    var tomb = meta && meta.deletedScriptIds ? meta.deletedScriptIds : {};
    return (list || []).filter(function (raw) {
      var sid = raw && (raw.id || raw.scriptId);
      return !sid || !tomb[String(sid)];
    });
  }

  function migrateFromV1(parsed) {
    if (!parsed || parsed.version >= 2) return parsed;
    var next = Object.assign(defaultState(), parsed || {});
    next.version = 2;
    next.apiConfig = defaultApiConfig();
    next.customScripts = (next.customScripts || []).map(function (raw) {
      var row = normalizeCustomScript(raw);
      if (!row) return null;
      if (!row.config.genreLabel && GENRES[row.genre]) {
        row.config.genreLabel = GENRES[row.genre].label;
      }
      return row;
    }).filter(Boolean);
    return next;
  }

  function normalizeCustomScriptLenient(raw) {
    var row = normalizeCustomScript(raw);
    if (row) return row;
    if (!raw || typeof raw !== 'object') return null;
    var fallbackTitle = String(
      raw.title || raw.subtitle || raw.name || raw.tagline || raw.id || '未命名剧本'
    ).trim();
    if (!fallbackTitle) return null;
    return normalizeCustomScript(Object.assign({}, raw, { title: fallbackTitle }));
  }

  function normalizeCustomScript(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || '').trim();
    if (!title) return null;
    var cfg = normalizeScriptConfig(raw.config || {
      genreLabel: raw.genreLabel || (GENRES[raw.genre] ? GENRES[raw.genre].label : ''),
      playerName: raw.playerName,
      playerAvatar: raw.playerAvatar,
      playerGender: raw.playerGender,
      playerAge: raw.playerAge,
      worldview: raw.worldview,
      writingStyle: raw.writingStyle,
      turnUnit: raw.turnUnit,
      playerStats: raw.playerStats,
      rankLevels: raw.rankLevels
    });
    if (!cfg.genreLabel && raw.genre && GENRES[raw.genre]) cfg.genreLabel = GENRES[raw.genre].label;
    return {
      id: String(raw.id || uid('custom')),
      builtin: false,
      genre: 'custom',
      genreLabel: cfg.genreLabel,
      title: title.slice(0, 32),
      subtitle: String(raw.subtitle || cfg.genreLabel || '自定义人生剧本').slice(0, 64),
      tagline: String(raw.tagline || '「你的故事，从零开始。」').slice(0, 96),
      coverGlyph: String(raw.coverGlyph || title.charAt(0) || '自').slice(0, 1),
      episodes: clampInt(raw.episodes, 1, 999, 12),
      difficulty: String(raw.difficulty || '自由').slice(0, 8),
      features: Array.isArray(raw.features)
        ? raw.features.slice(0, 12).map(function (f) { return String(f || '').slice(0, 16); }).filter(Boolean)
        : ['自由叙事', '自定义养成'],
      config: cfg,
      createdAt: raw.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  function scriptsFromState(state) {
    return BUILTIN_SCRIPTS.concat((state && state.customScripts) || []);
  }

  function findScriptInState(state, id) {
    return scriptsFromState(state).find(function (s) { return s.id === id; }) || null;
  }

  function stateRichness(raw) {
    if (!raw || typeof raw !== 'object') return 0;
    var scripts = Array.isArray(raw.customScripts) ? raw.customScripts.length : 0;
    var saves = raw.saves && typeof raw.saves === 'object' ? Object.keys(raw.saves).length : 0;
    var api = raw.apiConfig && (raw.apiConfig.baseUrl || raw.apiConfig.apiKey) ? 5 : 0;
    var decor = raw.scriptDecor && (raw.scriptDecor.customCss || (raw.scriptDecor.presets || []).length) ? 1 : 0;
    return scripts * 100 + saves * 10 + api + decor;
  }

  function readJsonSyncLs(key) {
    var k = String(key || '');
    if (!k) return null;
    try {
      var raw = localStorage.getItem(k);
      if (raw == null) return null;
      if (global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw)) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function scriptUpdatedAt(s) {
    return (s && (s.updatedAt || s.createdAt)) || 0;
  }

  function mergeScriptsArrays(into, fromList) {
    var map = {};
    (into || []).forEach(function (s) {
      if (s && s.id) map[s.id] = s;
    });
    (fromList || []).forEach(function (raw) {
      var row = normalizeCustomScriptLenient(raw);
      if (!row || !row.id) return;
      var prev = map[row.id];
      if (!prev || scriptUpdatedAt(row) >= scriptUpdatedAt(prev)) map[row.id] = row;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function mergeSavesObjects(into, from) {
    var out = Object.assign({}, into || {});
    var src = from && typeof from === 'object' ? from : {};
    Object.keys(src).forEach(function (sid) {
      var incoming = src[sid];
      if (!incoming || typeof incoming !== 'object') return;
      var cur = out[sid];
      if (!cur || (incoming.updatedAt || 0) >= (cur.updatedAt || 0)) out[sid] = incoming;
    });
    return out;
  }

  function mergeRawIntoState(target, source, opts) {
    if (!target || !source || typeof source !== 'object') return target;
    opts = opts || {};
    var incomingScripts = source.customScripts || [];
    if (opts.respectTombstones) {
      incomingScripts = filterScriptsRespectingTombstones(incomingScripts, target.storageMeta);
    }
    target.customScripts = mergeScriptsArrays(target.customScripts, incomingScripts);
    target.saves = mergeSavesObjects(target.saves, source.saves);
    var srcApi = source.apiConfig;
    if (srcApi && (srcApi.baseUrl || srcApi.apiKey)) {
      var curApi = target.apiConfig || {};
      if (!curApi.baseUrl && !curApi.apiKey) target.apiConfig = normalizeApiConfig(srcApi);
      else if (!curApi.model && srcApi.model) {
        target.apiConfig = normalizeApiConfig(Object.assign({}, curApi, srcApi));
      }
    }
    if (source.scriptDecor) {
      var td = normalizeScriptDecor(target.scriptDecor || defaultScriptDecor());
      var sd = normalizeScriptDecor(source.scriptDecor);
      var tAt = td.updatedAt || 0;
      var sAt = sd.updatedAt || 0;
      if (sAt > tAt) {
        target.scriptDecor = sd;
      } else if (sAt === tAt && sAt === 0) {
        var legacyDecor = Object.assign({}, td);
        if ((!legacyDecor.presets || !legacyDecor.presets.length) && sd.presets && sd.presets.length) {
          legacyDecor.presets = sd.presets.slice();
        }
        target.scriptDecor = normalizeScriptDecor(legacyDecor);
      }
    }
    if (source.lastScriptId && !target.lastScriptId) target.lastScriptId = source.lastScriptId;
    return target;
  }

  function mergeStates(candidates) {
    var merged = null;
    (candidates || []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      if (!merged) {
        merged = migrateFromV1(Object.assign(defaultState(), JSON.parse(JSON.stringify(c))));
        return;
      }
      mergeRawIntoState(merged, c);
    });
    return merged;
  }

  function normalizeLoaded(parsed) {
    var next = migrateFromV1(Object.assign(defaultState(), parsed || {}));
    next.customScripts = (next.customScripts || []).map(normalizeCustomScriptLenient).filter(Boolean);
    next.saves = next.saves && typeof next.saves === 'object' ? next.saves : {};
    next.apiConfig = normalizeApiConfig(next.apiConfig);
    next.scriptDecor = normalizeScriptDecor(next.scriptDecor);
    if (
      (next.scriptDecor.customCss || (next.scriptDecor.presets || []).length) &&
      !next.scriptDecor.updatedAt
    ) {
      next.scriptDecor.updatedAt = Date.now();
    }
    next.storageMeta = normalizeStorageMeta(next.storageMeta);
    Object.keys(next.saves).forEach(function (sid) {
      var meta = findScriptInState(next, sid);
      if (meta && next.saves[sid]) {
        next.saves[sid].player = normalizePlayerProfile(next.saves[sid].player, meta.config);
        normalizeSaveData(next.saves[sid], meta);
      }
    });
    stripPersistedGenerating(next);
    clearAllPlayGenerating();
    cache = next;
    return cache;
  }

  function collectAllSourceCandidates() {
    var list = [];
    [LS_KEY, LS_KEY_LEGACY, LS_BACKUP_KEY].forEach(function (key) {
      var j = readJsonSyncLs(key);
      if (j) list.push(j);
    });
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var syncV2 = global.miyaSyncReadJsonKey(LS_KEY);
      if (syncV2) list.push(syncV2);
      var syncBk = global.miyaSyncReadJsonKey(LS_BACKUP_KEY);
      if (syncBk) list.push(syncBk);
      var syncV1 = global.miyaSyncReadJsonKey(LS_KEY_LEGACY);
      if (syncV1) list.push(syncV1);
    }
    var read = global.miyaReadLsJsonKey;
    if (typeof read !== 'function') return Promise.resolve(list);
    return Promise.all([
      read(LS_KEY, null),
      read(LS_BACKUP_KEY, null),
      read(LS_KEY_LEGACY, null)
    ]).then(function (asyncRows) {
      asyncRows.forEach(function (row) {
        if (row && typeof row === 'object') list.push(row);
      });
      return list;
    }).catch(function () { return list; });
  }

  function mergeDiskIntoCache() {
    return collectAllSourceCandidates().then(function (candidates) {
      var merged = mergeStates(candidates);
      if (!merged || !cache) return merged;
      mergeRawIntoState(cache, merged);
      return merged;
    });
  }

  function hydrateCacheSync() {
    if (cache && _hydrated) return cache;
    var list = [];
    [LS_KEY, LS_KEY_LEGACY, LS_BACKUP_KEY].forEach(function (key) {
      var j = readJsonSyncLs(key);
      if (j) list.push(j);
    });
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var sync = global.miyaSyncReadJsonKey(LS_KEY);
      if (sync) list.push(sync);
      var syncBk = global.miyaSyncReadJsonKey(LS_BACKUP_KEY);
      if (syncBk) list.push(syncBk);
    }
    var merged = mergeStates(list);
    if (merged && stateRichness(merged) > 0) return normalizeLoaded(merged);
    return null;
  }

  function load() {
    if (cache) return cache;
    var hydrated = hydrateCacheSync();
    if (hydrated) {
      _hydrated = true;
      return cache;
    }
    cache = defaultState();
    return cache;
  }

  function writeSnapshotToAllKeys(snapshot) {
    if (!snapshot) return Promise.resolve(false);
    var payload = snapshot;
    stripPersistedGenerating(payload);
    var tasks = [];
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      tasks.push(global.miyaWriteLsJsonKey(LS_KEY, payload));
      tasks.push(global.miyaWriteLsJsonKey(LS_BACKUP_KEY, payload));
    }
    return Promise.all(tasks).then(function () {
      var str = '';
      try { str = JSON.stringify(payload); } catch (eStr) { return false; }
      try { localStorage.setItem(LS_KEY, str); } catch (e1) {}
      try { localStorage.setItem(LS_BACKUP_KEY, str); } catch (e2) {}
      try { localStorage.setItem(LS_KEY_LEGACY, str); } catch (e3) {}
      _lastPersistedRichness = stateRichness(payload);
      return true;
    }).catch(function () {
      try {
        var str2 = JSON.stringify(payload);
        localStorage.setItem(LS_KEY, str2);
        localStorage.setItem(LS_BACKUP_KEY, str2);
        localStorage.setItem(LS_KEY_LEGACY, str2);
        _lastPersistedRichness = stateRichness(payload);
        return true;
      } catch (e4) {
        return false;
      }
    });
  }

  function persist() {
    if (!_hydrated || !cache) return Promise.resolve();
    _persistChain = _persistChain.then(function () {
      return mergeDiskIntoCache().then(function (diskMerged) {
        var diskScripts = diskMerged && diskMerged.customScripts ? diskMerged.customScripts.length : 0;
        var cacheScripts = (cache.customScripts || []).length;
        if (cacheScripts === 0 && diskScripts > 0) {
          cache.storageMeta = normalizeStorageMeta({ deletedScriptIds: {} });
          mergeRawIntoState(cache, diskMerged);
        } else if (diskScripts > cacheScripts) {
          mergeRawIntoState(cache, diskMerged, { respectTombstones: true });
        }
        var richness = stateRichness(cache);
        if (richness === 0 && _lastPersistedRichness > 0) {
          return mergeDiskIntoCache().then(function () {
            if (stateRichness(cache) === 0) return false;
            return writeSnapshotToAllKeys(cache);
          });
        }
        if (richness === 0) return false;
        return writeSnapshotToAllKeys(cache);
      });
    }).catch(function () {});
    return _persistChain;
  }

  function persistCache() {
    if (!_hydrated) return;
    persist();
  }

  function flushCacheSync() {
    if (!cache) return;
    stripPersistedGenerating(cache);
    var str = '';
    try { str = JSON.stringify(cache); } catch (eStr) { return; }
    try { localStorage.setItem(LS_KEY, str); } catch (e1) {}
    try { localStorage.setItem(LS_BACKUP_KEY, str); } catch (e2) {}
    try { localStorage.setItem(LS_KEY_LEGACY, str); } catch (e3) {}
    _lastPersistedRichness = stateRichness(cache);
  }

  function saveScriptDecorState() {
    _hydrated = true;
    flushCacheSync();
    persistCache();
  }

  function maybeMergeApiFromSettings(state) {
    if (!state) return Promise.resolve(state);
    var cur = state.apiConfig || {};
    if (cur.baseUrl && cur.apiKey) return Promise.resolve(state);
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var syncApi = global.miyaSyncReadJsonKey(API_CONFIG_KEY);
      if (syncApi && typeof syncApi === 'object' && (syncApi.baseUrl || syncApi.apiKey)) {
        state.apiConfig = normalizeApiConfig(syncApi);
        return Promise.resolve(state);
      }
    }
    if (typeof global.miyaReadLsJsonKey !== 'function') return Promise.resolve(state);
    return global.miyaReadLsJsonKey(API_CONFIG_KEY, null).then(function (api) {
      if (!api || typeof api !== 'object') return state;
      if (!api.baseUrl && !api.apiKey) return state;
      state.apiConfig = normalizeApiConfig(api);
      return state;
    }).catch(function () { return state; });
  }

  function loadFromAllSources() {
    return collectAllSourceCandidates().then(function (candidates) {
      var merged = mergeStates(candidates);
      if (merged && stateRichness(merged) > 0) {
        normalizeLoaded(merged);
        _hydrated = true;
        _lastPersistedRichness = stateRichness(cache);
        return maybeMergeApiFromSettings(cache).then(function () {
          return writeSnapshotToAllKeys(cache).then(function () { return cache; });
        });
      }
      cache = defaultState();
      _hydrated = true;
      return maybeMergeApiFromSettings(cache).then(function () {
        if (cache.apiConfig && (cache.apiConfig.baseUrl || cache.apiConfig.apiKey)) {
          return writeSnapshotToAllKeys(cache).then(function () { return cache; });
        }
        return cache;
      });
    });
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = loadFromAllSources().catch(function () {
      var fallback = hydrateCacheSync();
      if (fallback) {
        _hydrated = true;
        _lastPersistedRichness = stateRichness(cache);
        return cache;
      }
      cache = defaultState();
      _hydrated = true;
      return cache;
    });
    return _ready;
  }

  function tryRecoverFromStorage() {
    return collectAllSourceCandidates().then(function (candidates) {
      var merged = mergeStates(candidates);
      if (!merged || stateRichness(merged) <= 0) {
        return { ok: false, customScripts: 0, saves: 0, apiConfigured: false };
      }
      normalizeLoaded(merged);
      _hydrated = true;
      return maybeMergeApiFromSettings(cache).then(function () {
        return writeSnapshotToAllKeys(cache).then(function () {
          return {
            ok: true,
            customScripts: (cache.customScripts || []).length,
            saves: Object.keys(cache.saves || {}).length,
            apiConfigured: !!(cache.apiConfig && cache.apiConfig.baseUrl && cache.apiConfig.apiKey)
          };
        });
      });
    });
  }

  function invalidateCache() {
    cache = null;
    _ready = null;
    _hydrated = false;
  }

  function allScripts() {
    load();
    return BUILTIN_SCRIPTS.concat(cache.customScripts || []);
  }

  function findScript(id) {
    return allScripts().find(function (s) { return s.id === id; }) || null;
  }

  function getSave(scriptId) {
    load();
    if (!scriptId) return null;
    if (!cache.saves[scriptId]) {
      var meta = findScript(scriptId);
      if (!meta) return null;
      cache.saves[scriptId] = defaultSaveWithConfig(meta);
      persistCache();
    }
    var scriptMeta = findScript(scriptId);
    normalizeSaveData(cache.saves[scriptId], scriptMeta);
    return cache.saves[scriptId];
  }

  function advanceTurn(scriptId) {
    var script = findScript(scriptId);
    var data = getSave(scriptId);
    if (!script || !data) return null;
    var unit = (script.config && script.config.turnUnit) || 'day';
    data.turn = clampInt(data.turn, 0, 999999, 1) + 1;
    data.gameTime = advanceGameTime(data.gameTime, unit);
    data.updatedAt = Date.now();
    persistCache();
    return data;
  }

  function touchSave(scriptId, patch) {
    var data = getSave(scriptId);
    if (!data) return null;
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        data[k] = patch[k];
      });
    }
    data.updatedAt = Date.now();
    cache.lastScriptId = scriptId;
    persistCache();
    return data;
  }

  function deleteSave(scriptId) {
    load();
    if (cache.saves[scriptId]) {
      delete cache.saves[scriptId];
      persistCache();
    }
  }

  function getApiConfig() {
    load();
    return Object.assign({}, cache.apiConfig || defaultApiConfig());
  }

  function setApiConfig(next) {
    load();
    cache.apiConfig = normalizeApiConfig(next);
    persistCache();
    return cache.apiConfig;
  }

  function isApiConfigured() {
    var c = getApiConfig();
    return !!(c.baseUrl && c.apiKey && c.model);
  }

  function addCustomScript(payload) {
    var row = normalizeCustomScript(Object.assign({}, payload, { id: uid('custom') }));
    if (!row) return null;
    load();
    cache.customScripts.unshift(row);
    cache.saves[row.id] = defaultSaveWithConfig(row);
    cache.lastScriptId = row.id;
    persistCache();
    return row;
  }

  function updateCustomScript(id, payload) {
    load();
    var idx = (cache.customScripts || []).findIndex(function (s) { return s.id === id; });
    if (idx < 0) return null;
    var merged = Object.assign({}, cache.customScripts[idx], payload || {}, { id: id, builtin: false, updatedAt: Date.now() });
    var row = normalizeCustomScript(merged);
    if (!row) return null;
    cache.customScripts[idx] = row;
    var saveData = getSave(id);
    if (saveData && saveData.player) {
      saveData.player.name = row.config.playerName || saveData.player.name;
      saveData.player.avatar = row.config.playerAvatar || '';
      saveData.player.gender = row.config.playerGender || '';
      saveData.player.age = row.config.playerAge || 18;
      saveData.turnUnitLabel = (TURN_UNITS[row.config.turnUnit] || TURN_UNITS.day).label;
      var ladder = row.config.rankLevels || [];
      if (ladder.length) {
        if (saveData.rankIndex == null) saveData.rankIndex = 0;
        if (saveData.rankExp == null) saveData.rankExp = 0;
        if (saveData.rankIndex >= ladder.length) saveData.rankIndex = Math.max(0, ladder.length - 1);
      }
      syncCustomStatsFromConfig(saveData, row.config);
      seedModulesFromConfig(saveData, row.config);
      normalizeSaveData(saveData, row);
      saveData.updatedAt = Date.now();
    }
    persistCache();
    return row;
  }

  function removeCustomScript(id) {
    load();
    markScriptDeleted(id);
    cache.customScripts = (cache.customScripts || []).filter(function (s) { return s.id !== id; });
    delete cache.saves[id];
    if (cache.lastScriptId === id) cache.lastScriptId = null;
    persistCache();
  }

  function exportScriptBundle(scriptId) {
    var script = findScript(scriptId);
    if (!script) return null;
    var save = getSave(scriptId);
    try {
      return {
        format: 'miya-simulator-script-bundle',
        version: 1,
        exportedAt: Date.now(),
        script: JSON.parse(JSON.stringify(script)),
        save: JSON.parse(JSON.stringify(save))
      };
    } catch (e) {
      return null;
    }
  }

  function exportScriptConfig(scriptId) {
    var script = findScript(scriptId);
    if (!script) return null;
    var copy = JSON.parse(JSON.stringify(script));
    delete copy.builtin;
    return {
      format: 'miya-simulator-script-config',
      version: 1,
      exportedAt: Date.now(),
      script: copy
    };
  }

  function extractConfigFromImportBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return null;
    if (bundle.format === 'miya-simulator-script-config' && bundle.script) {
      return bundle.script;
    }
    if (bundle.format === 'miya-simulator-script-bundle' && bundle.script) {
      return bundle.script;
    }
    if (bundle.config || bundle.title) return bundle;
    return null;
  }

  function applyConfigToSave(save, scriptMeta, cfg) {
    if (!save || !cfg) return;
    save.player = normalizePlayerProfile({
      name: cfg.playerName,
      avatar: cfg.playerAvatar,
      gender: cfg.playerGender,
      age: cfg.playerAge,
      birthday: save.player && save.player.birthday,
      appearance: save.player && save.player.appearance,
      personality: save.player && save.player.personality,
      identity: save.player && save.player.identity,
      occupation: save.player && save.player.occupation
    }, cfg);
    save.turnUnitLabel = (TURN_UNITS[cfg.turnUnit] || TURN_UNITS.day).label;
    syncCustomStatsFromConfig(save, cfg);
    seedModulesFromConfig(save, cfg);
    normalizeSaveData(save, scriptMeta);
    save.updatedAt = Date.now();
  }

  function importScriptConfigToCurrent(scriptId, bundle) {
    var scriptRaw = extractConfigFromImportBundle(bundle);
    if (!scriptRaw) return { ok: false, reason: 'invalid' };
    var script = findScript(scriptId);
    if (!script) return { ok: false, reason: 'no_script' };
    load();
    var cfg = normalizeScriptConfig(scriptRaw.config || scriptRaw);
    if (!script.builtin) {
      var merged = Object.assign({}, script, {
        title: String(scriptRaw.title || script.title).trim() || script.title,
        subtitle: scriptRaw.subtitle != null ? scriptRaw.subtitle : script.subtitle,
        tagline: scriptRaw.tagline != null ? scriptRaw.tagline : script.tagline,
        difficulty: scriptRaw.difficulty != null ? scriptRaw.difficulty : script.difficulty,
        features: scriptRaw.features || script.features,
        config: cfg
      });
      var row = updateCustomScript(scriptId, merged);
      if (!row) return { ok: false, reason: 'invalid' };
      script = row;
    } else {
      script = Object.assign({}, script, { config: cfg });
    }
    var saveData = getSave(scriptId);
    applyConfigToSave(saveData, script, cfg);
    persistCache();
    return { ok: true, script: script };
  }

  function importScriptConfigWithTarget(bundle, opts) {
    var scriptRaw = extractConfigFromImportBundle(bundle);
    if (!scriptRaw) return null;
    opts = opts || {};
    load();
    if (opts.overwriteId) {
      var existing = findScript(opts.overwriteId);
      if (!existing || existing.builtin) return null;
      var merged = Object.assign({}, existing, scriptRaw, {
        id: opts.overwriteId,
        builtin: false,
        config: normalizeScriptConfig(scriptRaw.config || scriptRaw)
      });
      var row = updateCustomScript(opts.overwriteId, merged);
      if (!row) return null;
      if (opts.importSave && bundle.save) {
        cache.saves[opts.overwriteId] = Object.assign(defaultSave(row), bundle.save, {
          scriptId: opts.overwriteId,
          updatedAt: Date.now()
        });
        normalizeSaveData(cache.saves[opts.overwriteId], row);
      } else {
        applyConfigToSave(getSave(opts.overwriteId), row, row.config);
      }
      persistCache();
      return row;
    }
    var rowNew = normalizeCustomScript(Object.assign({}, scriptRaw, {
      id: uid('custom'),
      builtin: false,
      createdAt: Date.now()
    }));
    if (!rowNew) return null;
    cache.customScripts.unshift(rowNew);
    if (opts.importSave && bundle.save) {
      cache.saves[rowNew.id] = Object.assign(defaultSave(rowNew), bundle.save, {
        scriptId: rowNew.id,
        updatedAt: Date.now()
      });
    } else {
      cache.saves[rowNew.id] = defaultSaveWithConfig(rowNew);
    }
    cache.lastScriptId = rowNew.id;
    persistCache();
    return rowNew;
  }

  function importScriptBundle(bundle, opts) {
    if (!bundle || typeof bundle !== 'object') return null;
    opts = opts || {};
    if (bundle.format === 'miya-simulator-script-config') {
      if (opts.targetScriptId) {
        var r = importScriptConfigWithTarget(bundle, { overwriteId: opts.targetScriptId });
        return r;
      }
      return importScriptConfigWithTarget(bundle, {});
    }
    if (bundle.format !== 'miya-simulator-script-bundle') return null;
    if (opts.overwriteId) {
      return importScriptConfigWithTarget(bundle, {
        overwriteId: opts.overwriteId,
        importSave: true
      });
    }
    var scriptRaw = bundle.script;
    var saveRaw = bundle.save;
    if (!scriptRaw || typeof scriptRaw !== 'object') return null;
    var row = normalizeCustomScript(Object.assign({}, scriptRaw, {
      id: uid('custom'),
      builtin: false,
      createdAt: Date.now()
    }));
    if (!row) return null;
    load();
    cache.customScripts.unshift(row);
    if (saveRaw && typeof saveRaw === 'object') {
      cache.saves[row.id] = Object.assign(defaultSave(row), saveRaw, {
        scriptId: row.id,
        updatedAt: Date.now()
      });
      normalizeSaveData(cache.saves[row.id], row);
    } else {
      cache.saves[row.id] = defaultSaveWithConfig(row);
    }
    cache.lastScriptId = row.id;
    persistCache();
    return row;
  }

  function findStatIdByName(script, name) {
    var n = String(name || '').trim();
    if (!n) return null;
    var cfgStats = (script && script.config && script.config.playerStats) || [];
    var i;
    for (i = 0; i < cfgStats.length; i++) {
      if (cfgStats[i] && cfgStats[i].name === n) return { id: cfgStats[i].id, max: cfgStats[i].max, source: 'custom' };
    }
    var keys = Object.keys(BUILTIN_STAT_LABELS);
    for (i = 0; i < keys.length; i++) {
      if (BUILTIN_STAT_LABELS[keys[i]] === n) return { id: keys[i], max: 100, source: 'builtin' };
    }
    if (BUILTIN_STAT_LABELS[n]) return { id: n, max: 100, source: 'builtin' };
    return null;
  }

  function parseDeltaNumber(delta) {
    if (typeof delta === 'number' && Number.isFinite(delta)) return delta;
    var s = String(delta || '').trim();
    if (!s) return 0;
    var m = s.match(/([+\-]?\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function applyNarrativeChanges(scriptId, changes) {
    var script = findScript(scriptId);
    var save = getSave(scriptId);
    if (!script || !save || !changes || !changes.length) return [];
    var applied = [];
    var mods = ensureModules(save);
    ensureAssets(save, script);

    changes.forEach(function (ch) {
      if (!ch) return;
      var type = String(ch.type || '').toLowerCase();
      var name = String(ch.name || '').trim();
      if (!name && type !== 'note') return;

      if (type === 'stat' || type === '属性') {
        var statRef = findStatIdByName(script, name);
        if (!statRef) return;
        var curList = getPlayableStats(script, save);
        var curRow = curList.find(function (r) { return r.id === statRef.id || r.name === name; });
        var curVal = curRow ? curRow.value : 0;
        var nextVal = ch.after != null && Number.isFinite(Number(ch.after))
          ? clampInt(ch.after, 0, statRef.max, curVal)
          : clampInt(curVal + parseDeltaNumber(ch.delta), 0, statRef.max, curVal);
        setPlayableStat(scriptId, statRef.id, nextVal, statRef.source);
        applied.push({ type: 'stat', name: name, after: nextVal });
        return;
      }

      if (type === 'skill' || type === '技能') {
        var sk = mods.skills.find(function (s) { return s.name === name; });
        if (!sk) return;
        var expAdd = parseDeltaNumber(ch.delta);
        if (String(ch.delta || '').indexOf('级') >= 0 || String(ch.note || '').indexOf('升级') >= 0) {
          sk.level = clampInt(sk.level + parseDeltaNumber(ch.delta), 1, SKILL_MAX_LEVEL, sk.level);
          sk.exp = skillExpForLevel(sk.level);
        } else if (expAdd) {
          sk.exp = clampInt(sk.exp + expAdd, 0, 9999999, sk.exp);
          while (sk.level < SKILL_MAX_LEVEL && sk.exp >= skillExpForLevel(sk.level + 1)) {
            sk.level += 1;
          }
        }
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          sk.level = clampInt(ch.after, 1, SKILL_MAX_LEVEL, sk.level);
          sk.exp = skillExpForLevel(sk.level);
        }
        upsertSkill(scriptId, sk);
        applied.push({ type: 'skill', name: name, after: sk.level });
        return;
      }

      if (type === 'rank' || type === '等级' || type === '境界') {
        var expDelta = parseDeltaNumber(ch.delta);
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          save.rankExp = clampInt(ch.after, 0, 999999999, save.rankExp || 0);
        } else {
          save.rankExp = clampInt((save.rankExp || 0) + expDelta, 0, 999999999, 0);
        }
        var promo = evaluateRankPromotion(script, save);
        if (promo.canPromote) promoteRank(scriptId);
        applied.push({ type: 'rank', name: name || '经验', after: save.rankExp });
        return;
      }

      if (type === 'relation' || type === '人际' || type === 'npc') {
        ensureNpcs(save);
        var npc = findNpcByName(save, name);
        if (!npc) {
          npc = upsertNpc(scriptId, {
            name: name,
            affinity: 0,
            metTurn: save.turn || 1,
            identity: String(ch.note || '').slice(0, 48) || '新识'
          });
          if (!npc) return;
        }
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          npc.affinity = clampInt(ch.after, -100, 100, npc.affinity || 0);
        } else {
          npc.affinity = clampInt((npc.affinity || 0) + parseDeltaNumber(ch.delta), -100, 100, 0);
        }
        upsertNpc(scriptId, npc);
        applied.push({ type: 'relation', name: name, after: npc.affinity });
        return;
      }

      if (type === 'asset' || type === '财产' || type === '资产') {
        var cat = mods.assets.categories.find(function (c) { return c.name === name; });
        if (!cat) return;
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          cat.value = Number(ch.after);
        } else {
          cat.value = (Number(cat.value) || 0) + parseDeltaNumber(ch.delta);
        }
        mods.assets.updatedAt = Date.now();
        applied.push({ type: 'asset', name: name, after: cat.value });
        return;
      }

      if (type === 'achievement' || type === '成就') {
        addAchievement(scriptId, { name: name, desc: ch.note || '', turn: save.turn, auto: true });
        applied.push({ type: 'achievement', name: name });
      }
    });

    save.updatedAt = Date.now();
    persistCache();
    return applied;
  }

  function revertNarrativeChanges(scriptId, changes) {
    var script = findScript(scriptId);
    var save = getSave(scriptId);
    if (!script || !save || !changes || !changes.length) return [];
    var applied = [];
    var mods = ensureModules(save);
    ensureAssets(save, script);

    changes.slice().reverse().forEach(function (ch) {
      if (!ch) return;
      var type = String(ch.type || '').toLowerCase();
      var name = String(ch.name || '').trim();
      if (!name && type !== 'note') return;

      if (type === 'stat' || type === '属性') {
        var statRef = findStatIdByName(script, name);
        if (!statRef) return;
        var curList = getPlayableStats(script, save);
        var curRow = curList.find(function (r) { return r.id === statRef.id || r.name === name; });
        var curVal = curRow ? curRow.value : 0;
        var nextVal;
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          var appliedDelta = Number(ch.after) - curVal;
          nextVal = clampInt(curVal - appliedDelta, 0, statRef.max, curVal);
        } else {
          nextVal = clampInt(curVal - parseDeltaNumber(ch.delta), 0, statRef.max, curVal);
        }
        setPlayableStat(scriptId, statRef.id, nextVal, statRef.source);
        applied.push({ type: 'stat', name: name, after: nextVal });
        return;
      }

      if (type === 'skill' || type === '技能') {
        var sk = mods.skills.find(function (s) { return s.name === name; });
        if (!sk) return;
        var expSub = parseDeltaNumber(ch.delta);
        if (String(ch.delta || '').indexOf('级') >= 0 || String(ch.note || '').indexOf('升级') >= 0) {
          sk.level = clampInt(sk.level - parseDeltaNumber(ch.delta), 1, SKILL_MAX_LEVEL, sk.level);
          sk.exp = skillExpForLevel(sk.level);
        } else if (expSub) {
          sk.exp = clampInt(sk.exp - expSub, 0, 9999999, sk.exp);
          while (sk.level > 1 && sk.exp < skillExpForLevel(sk.level)) {
            sk.level -= 1;
          }
        }
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          var lvlDelta = Number(ch.after) - sk.level;
          sk.level = clampInt(sk.level - lvlDelta, 1, SKILL_MAX_LEVEL, sk.level);
          sk.exp = skillExpForLevel(sk.level);
        }
        upsertSkill(scriptId, sk);
        applied.push({ type: 'skill', name: name, after: sk.level });
        return;
      }

      if (type === 'rank' || type === '等级' || type === '境界') {
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          var rankDelta = Number(ch.after) - (save.rankExp || 0);
          save.rankExp = clampInt((save.rankExp || 0) - rankDelta, 0, 999999999, 0);
        } else {
          save.rankExp = clampInt((save.rankExp || 0) - parseDeltaNumber(ch.delta), 0, 999999999, 0);
        }
        applied.push({ type: 'rank', name: name || '经验', after: save.rankExp });
        return;
      }

      if (type === 'relation' || type === '人际' || type === 'npc') {
        var npc = (save.npcs || []).find(function (n) { return n.name === name; });
        if (!npc) return;
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          var affDelta = Number(ch.after) - (npc.affinity || 0);
          npc.affinity = clampInt((npc.affinity || 0) - affDelta, -100, 100, 0);
        } else {
          npc.affinity = clampInt((npc.affinity || 0) - parseDeltaNumber(ch.delta), -100, 100, 0);
        }
        applied.push({ type: 'relation', name: name, after: npc.affinity });
        return;
      }

      if (type === 'asset' || type === '财产' || type === '资产') {
        var cat = mods.assets.categories.find(function (c) { return c.name === name; });
        if (!cat) return;
        if (ch.after != null && Number.isFinite(Number(ch.after))) {
          var valDelta = Number(ch.after) - (Number(cat.value) || 0);
          cat.value = (Number(cat.value) || 0) - valDelta;
        } else {
          cat.value = (Number(cat.value) || 0) - parseDeltaNumber(ch.delta);
        }
        mods.assets.updatedAt = Date.now();
        applied.push({ type: 'asset', name: name, after: cat.value });
      }
    });

    save.updatedAt = Date.now();
    persistCache();
    return applied;
  }

  function clearTurnNarrative(scriptId, turn) {
    var save = getSave(scriptId);
    if (!save) return { removed: 0 };
    var narr = ensureNarrative(save);
    var turnNo = turn != null ? turn : save.turn || 1;
    var toRemove = narr.events.filter(function (ev) { return (ev.turn || 0) === turnNo; });
    var allChanges = [];
    toRemove.forEach(function (ev) {
      if (ev.changes && ev.changes.length) allChanges = allChanges.concat(ev.changes);
    });
    if (allChanges.length) revertNarrativeChanges(scriptId, allChanges);

    var mods = ensureModules(save);
    if (mods.achievements && mods.achievements.length) {
      mods.achievements = mods.achievements.filter(function (a) {
        return !(a.auto && a.turn === turnNo);
      });
    }

    narr.events = narr.events.filter(function (ev) { return (ev.turn || 0) !== turnNo; });
    var mem = ensureMemory(save);
    mem.roundMemories = mem.roundMemories.filter(function (m) { return m.turn !== turnNo; });
    mem.summaries = mem.summaries.filter(function (s) {
      return !(s.turn === turnNo && (s.turnEnd == null || s.turnEnd === turnNo));
    });
    save.updatedAt = Date.now();
    persistCache();
    return { removed: toRemove.length };
  }

  function appendNarrativeEvents(scriptId, events, opts) {
    var save = getSave(scriptId);
    if (!save) return [];
    var narr = ensureNarrative(save);
    opts = opts || {};
    var turn = opts.turn != null ? opts.turn : save.turn;
    var source = opts.source || 'turn';
    var rows = (events || []).map(function (ev) {
      return normalizeNarrativeEvent(Object.assign({}, ev, {
        turn: ev.turn != null ? ev.turn : turn,
        source: ev.source || source
      }));
    }).filter(Boolean);
    narr.events = narr.events.concat(rows);
    if (narr.events.length > 800) narr.events = narr.events.slice(-800);
    save.updatedAt = Date.now();
    persistCache();
    return rows;
  }

  function setAssetCategories(scriptId, categories) {
    var save = getSave(scriptId);
    var script = findScript(scriptId);
    if (!save) return null;
    var mods = ensureModules(save);
    mods.assets = ensureAssets(save, script);
    mods.assets.categories = (categories || []).map(normalizeAssetCategory).filter(Boolean).slice(0, 24);
    mods.assets.updatedAt = Date.now();
    save.updatedAt = Date.now();
    persistCache();
    return mods.assets.categories;
  }

  function getAssetCategories(scriptId) {
    var save = getSave(scriptId);
    var script = findScript(scriptId);
    if (!save) return [];
    return ensureAssets(save, script).categories;
  }

  function updatePlayMeta(scriptId, patch) {
    var save = getSave(scriptId);
    if (!save) return null;
    var meta = ensurePlayMeta(save);
    if (patch && typeof patch === 'object') {
      if (patch.retainRounds != null) meta.retainRounds = clampInt(patch.retainRounds, 1, 50, meta.retainRounds);
      if (patch.summaryAutoEvery != null) meta.summaryAutoEvery = clampInt(patch.summaryAutoEvery, 0, 50, meta.summaryAutoEvery);
      if (patch.turnsSinceSummary != null) meta.turnsSinceSummary = clampInt(patch.turnsSinceSummary, 0, 9999, meta.turnsSinceSummary);
      if (patch.manualMemoryNotes != null) meta.manualMemoryNotes = String(patch.manualMemoryNotes).slice(0, 4000);
      if (patch.generating === null) setPlayGenerating(scriptId, null);
      else if (patch.generating && typeof patch.generating === 'object') {
        setPlayGenerating(scriptId, patch.generating);
      }
    }
    save.playMeta = meta;
    save.updatedAt = Date.now();
    persistCache();
    return meta;
  }

  function addRoundSummary(scriptId, summary) {
    var save = getSave(scriptId);
    if (!save) return null;
    var mem = ensureMemory(save);
    var row = normalizeRoundSummary(summary);
    if (!row) return null;
    mem.summaries.unshift(row);
    mem.summaries = mem.summaries.slice(0, 120);
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function addRoundMemory(scriptId, turn, content) {
    var save = getSave(scriptId);
    if (!save) return null;
    var mem = ensureMemory(save);
    var row = normalizeRoundMemory({ turn: turn, content: content });
    if (!row) return null;
    mem.roundMemories = mem.roundMemories.filter(function (m) { return m.turn !== row.turn; });
    mem.roundMemories.push(row);
    mem.roundMemories.sort(function (a, b) { return a.turn - b.turn; });
    var meta = ensurePlayMeta(save);
    var keep = meta.retainRounds;
    if (mem.roundMemories.length > keep) {
      mem.roundMemories = mem.roundMemories.slice(-keep);
    }
    save.updatedAt = Date.now();
    persistCache();
    return row;
  }

  function getNarrativeEventsForTurns(scriptId, turnCount) {
    var save = getSave(scriptId);
    if (!save) return [];
    var narr = ensureNarrative(save);
    var n = clampInt(turnCount, 1, 50, 5);
    var minTurn = Math.max(1, (save.turn || 1) - n + 1);
    return narr.events.filter(function (ev) { return ev.turn >= minTurn; });
  }

  function getScriptDecor() {
    load();
    return Object.assign({}, cache.scriptDecor || defaultScriptDecor());
  }

  function setScriptDecorCss(css) {
    load();
    cache.scriptDecor = touchScriptDecor(normalizeScriptDecor(cache.scriptDecor));
    cache.scriptDecor.customCss = String(css || '').slice(0, 48000);
    cache.scriptDecor.activePresetId = '';
    saveScriptDecorState();
    return cache.scriptDecor;
  }

  function saveScriptDecorPreset(name, css) {
    var preset = normalizeDecorPreset({ name: name, css: css });
    if (!preset) return null;
    load();
    cache.scriptDecor = touchScriptDecor(normalizeScriptDecor(cache.scriptDecor));
    cache.scriptDecor.presets.unshift(preset);
    cache.scriptDecor.presets = cache.scriptDecor.presets.slice(0, 32);
    cache.scriptDecor.activePresetId = preset.id;
    cache.scriptDecor.customCss = preset.css;
    saveScriptDecorState();
    return preset;
  }

  function applyScriptDecorPreset(presetId) {
    load();
    cache.scriptDecor = touchScriptDecor(normalizeScriptDecor(cache.scriptDecor));
    var preset = (cache.scriptDecor.presets || []).find(function (p) { return p.id === presetId; });
    if (!preset) return null;
    cache.scriptDecor.activePresetId = preset.id;
    cache.scriptDecor.customCss = preset.css;
    saveScriptDecorState();
    return preset;
  }

  function removeScriptDecorPreset(presetId) {
    load();
    cache.scriptDecor = touchScriptDecor(normalizeScriptDecor(cache.scriptDecor));
    cache.scriptDecor.presets = (cache.scriptDecor.presets || []).filter(function (p) {
      return p.id !== presetId;
    });
    if (cache.scriptDecor.activePresetId === presetId) {
      cache.scriptDecor.activePresetId = '';
      cache.scriptDecor.customCss = '';
    }
    saveScriptDecorState();
  }

  function updatePlayerProfile(scriptId, patch) {
    var save = getSave(scriptId);
    if (!save) return null;
    save.player = normalizePlayerProfile(Object.assign({}, save.player, patch || {}), null);
    save.updatedAt = Date.now();
    persistCache();
    return save.player;
  }

  function getPlayableStats(script, save) {
    if (!save) return [];
    var cfg = (script && script.config) || {};
    var list = [];
    if (cfg.playerStats && cfg.playerStats.length) {
      cfg.playerStats.forEach(function (st) {
        if (!st || !st.id) return;
        var val = save.customStats && save.customStats[st.id] != null
          ? save.customStats[st.id]
          : st.initial;
        list.push({
          id: st.id,
          name: st.name,
          max: st.max,
          value: clampInt(val, 0, st.max, st.initial),
          source: 'custom'
        });
      });
      return list;
    }
    var stats = save.stats || {};
    Object.keys(stats).forEach(function (key) {
      list.push({
        id: key,
        name: BUILTIN_STAT_LABELS[key] || key,
        max: 100,
        value: clampInt(stats[key], 0, 999999, 0),
        source: 'builtin'
      });
    });
    return list;
  }

  function setPlayableStat(scriptId, statId, value, source) {
    var script = findScript(scriptId);
    var save = getSave(scriptId);
    if (!script || !save || !statId) return null;
    if (source === 'custom' || (save.customStats && save.customStats[statId] != null)) {
      var cfgStats = (script.config && script.config.playerStats) || [];
      var row = cfgStats.find(function (s) { return s && s.id === statId; });
      var max = row ? row.max : 1000;
      if (!save.customStats) save.customStats = {};
      save.customStats[statId] = clampInt(value, 0, max, 0);
    } else if (save.stats) {
      save.stats[statId] = clampInt(value, 0, 999999, 0);
    }
    save.updatedAt = Date.now();
    persistCache();
    return getPlayableStats(script, save);
  }

  function getProgress(scriptId) {
    var saveData = cache && cache.saves && cache.saves[scriptId];
    if (!saveData) return null;
    return {
      turn: saveData.turn,
      gameTime: saveData.gameTime,
      episode: saveData.episode,
      updatedAt: saveData.updatedAt
    };
  }

  function setLastMode(mode) {
    load();
    cache.lastMode = mode;
    persistCache();
  }

  function getLastMode() {
    return load().lastMode || 'phone';
  }

  function genreDisplay(script) {
    if (!script) return '—';
    return String(script.genreLabel || (GENRES[script.genre] && GENRES[script.genre].label) || '自定义');
  }

  function turnUnitLabel(config) {
    var cfg = config || {};
    var u = TURN_UNITS[cfg.turnUnit] || TURN_UNITS.day;
    return '每回合 +1' + u.label;
  }

  global.MiyaSimulatorStore = {
    LS_KEY: LS_KEY,
    GENRES: GENRES,
    TURN_UNITS: TURN_UNITS,
    BUILTIN_SCRIPTS: BUILTIN_SCRIPTS,
    DEFAULT_WRITING_STYLE: DEFAULT_WRITING_STYLE,
    STAT_REFERENCE: STAT_REFERENCE,
    RANK_REFERENCE_SHOWBIZ: RANK_REFERENCE_SHOWBIZ,
    RANK_REFERENCE_GUFENG: RANK_REFERENCE_GUFENG,
    getRankLadder: getRankLadder,
    getRankProgress: getRankProgress,
    evaluateRankPromotion: evaluateRankPromotion,
    promoteRank: promoteRank,
    DEFAULT_STAT_MAX: DEFAULT_STAT_MAX,
    DEFAULT_STAT_INITIAL: DEFAULT_STAT_INITIAL,
    formatGameTime: formatGameTime,
    advanceTurn: advanceTurn,
    advanceGameTime: advanceGameTime,
    load: load,
    save: persistCache,
    whenReady: whenReady,
    invalidateCache: invalidateCache,
    persist: persist,
    allScripts: allScripts,
    findScript: findScript,
    getSave: getSave,
    touchSave: touchSave,
    deleteSave: deleteSave,
    getApiConfig: getApiConfig,
    setApiConfig: setApiConfig,
    isApiConfigured: isApiConfigured,
    addCustomScript: addCustomScript,
    updateCustomScript: updateCustomScript,
    removeCustomScript: removeCustomScript,
    exportScriptBundle: exportScriptBundle,
    exportScriptConfig: exportScriptConfig,
    importScriptBundle: importScriptBundle,
    importScriptConfigToCurrent: importScriptConfigToCurrent,
    importScriptConfigWithTarget: importScriptConfigWithTarget,
    extractConfigFromImportBundle: extractConfigFromImportBundle,
    getScriptDecor: getScriptDecor,
    setScriptDecorCss: setScriptDecorCss,
    saveScriptDecorPreset: saveScriptDecorPreset,
    applyScriptDecorPreset: applyScriptDecorPreset,
    removeScriptDecorPreset: removeScriptDecorPreset,
    DEFAULT_SCRIPT_DECOR_CSS: DEFAULT_SCRIPT_DECOR_CSS,
    BUILTIN_STAT_LABELS: BUILTIN_STAT_LABELS,
    updatePlayerProfile: updatePlayerProfile,
    getPlayableStats: getPlayableStats,
    setPlayableStat: setPlayableStat,
    normalizePlayerProfile: normalizePlayerProfile,
    SKILL_MAX_LEVEL: SKILL_MAX_LEVEL,
    SKILL_MAX_COUNT: SKILL_MAX_COUNT,
    skillExpForLevel: skillExpForLevel,
    skillExpToNext: skillExpToNext,
    getSkillProgress: getSkillProgress,
    ensureModules: ensureModules,
    getSkills: getSkills,
    getTalents: getTalents,
    getAchievements: getAchievements,
    setSkills: setSkills,
    upsertSkill: upsertSkill,
    removeSkill: removeSkill,
    setTalents: setTalents,
    upsertTalent: upsertTalent,
    removeTalent: removeTalent,
    addAchievement: addAchievement,
    upsertAchievement: upsertAchievement,
    removeAchievement: removeAchievement,
    normalizeSkill: normalizeSkill,
    normalizeTalent: normalizeTalent,
    normalizeConfigSkillRow: normalizeConfigSkillRow,
    normalizeConfigTalentRow: normalizeConfigTalentRow,
    seedModulesFromConfig: seedModulesFromConfig,
    normalizeAchievement: normalizeAchievement,
    getProgress: getProgress,
    setLastMode: setLastMode,
    getLastMode: getLastMode,
    defaultSave: defaultSave,
    defaultScriptConfig: defaultScriptConfig,
    normalizeScriptConfig: normalizeScriptConfig,
    genreDisplay: genreDisplay,
    resolveStatValue: resolveStatValue,
    turnUnitLabel: turnUnitLabel,
    tryRecoverFromStorage: tryRecoverFromStorage,
    isHydrated: function () { return _hydrated; },
    defaultPlayMeta: defaultPlayMeta,
    normalizeNarrativeEvent: normalizeNarrativeEvent,
    ensureNarrative: ensureNarrative,
    ensureAssets: ensureAssets,
    ensureMemory: ensureMemory,
    ensurePlayMeta: ensurePlayMeta,
    applyNarrativeChanges: applyNarrativeChanges,
    revertNarrativeChanges: revertNarrativeChanges,
    clearTurnNarrative: clearTurnNarrative,
    appendNarrativeEvents: appendNarrativeEvents,
    setAssetCategories: setAssetCategories,
    getAssetCategories: getAssetCategories,
    updatePlayMeta: updatePlayMeta,
    getPlayGenerating: getPlayGenerating,
    setPlayGenerating: setPlayGenerating,
    addRoundSummary: addRoundSummary,
    addRoundMemory: addRoundMemory,
    getNarrativeEventsForTurns: getNarrativeEventsForTurns,
    normalizeAssetCategory: normalizeAssetCategory,
    normalizeRoundSummary: normalizeRoundSummary,
    NPC_MAX_COUNT: NPC_MAX_COUNT,
    normalizeNpc: normalizeNpc,
    ensureNpcs: ensureNpcs,
    getNpcs: getNpcs,
    findNpcByName: findNpcByName,
    upsertNpc: upsertNpc,
    removeNpc: removeNpc,
    mergeNewContacts: mergeNewContacts,
    npcForApiContext: npcForApiContext,
    getFavorites: getFavorites,
    isEventFavorited: isEventFavorited,
    toggleNarrativeFavorite: toggleNarrativeFavorite,
    removeFavorite: removeFavorite
  };

  if (global.miyaRegisterPagehideFlush) {
    global.miyaRegisterPagehideFlush(function (opts) {
      if (!(cache && _hydrated)) return;
      if (opts && opts.urgent === false) {
        persistCache();
        return;
      }
      flushCacheSync();
    });
  }

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore({ whenReady: whenReady });
})(window);
