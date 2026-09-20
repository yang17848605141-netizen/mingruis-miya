(function (global) {
  'use strict';

  function store() {
    return global.MiyaSimulatorStore;
  }

  function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  /** 与小手机设置 openAiCompatibleApiRoot 一致，避免 /v1 拼错导致 /models 404 */
  function openAiCompatibleApiRoot(base) {
    var t = normalizeBaseUrl(base);
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = (u.pathname || '/').replace(/\/+$/, '');
      var segs = path.split('/').filter(Boolean);
      if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
      if (!path || path === '/') return u.origin + '/v1';
      return u.origin + path + '/v1';
    } catch (e) {
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  function resolveApiCredentials(override) {
    var o = override && typeof override === 'object' ? override : {};
    var fromForm = o.baseUrl != null || o.apiKey != null;
    if (fromForm) {
      return {
        baseUrl: String(o.baseUrl != null ? o.baseUrl : '').trim(),
        apiKey: String(o.apiKey != null ? o.apiKey : '').trim()
      };
    }
    var st = store();
    if (!st) return { baseUrl: '', apiKey: '' };
    var cfg = st.getApiConfig();
    return {
      baseUrl: String(cfg.baseUrl || '').trim(),
      apiKey: String(cfg.apiKey || '').trim()
    };
  }

  function parseModelsPayload(data) {
    if (!data || typeof data !== 'object') return [];
    var list = [];
    if (Array.isArray(data.data)) list = data.data;
    else if (Array.isArray(data.models)) list = data.models;
    else if (Array.isArray(data)) list = data;
    return list
      .map(function (m) {
        if (!m) return '';
        if (typeof m === 'string') return m;
        return m.id || m.name || m.model || '';
      })
      .map(function (id) { return String(id || '').trim(); })
      .filter(Boolean)
      .filter(function (id, i, arr) { return arr.indexOf(id) === i; })
      .sort();
  }

  function extractReplyContent(data) {
    if (!data) return '';
    if (data.choices && data.choices[0]) {
      var ch = data.choices[0];
      if (ch.message && ch.message.content != null) return String(ch.message.content).trim();
      if (ch.text != null) return String(ch.text).trim();
    }
    if (data.content != null) return String(data.content).trim();
    return '';
  }

  function parseJsonFromText(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    try {
      return JSON.parse(raw);
    } catch (e1) {
      var start = raw.indexOf('{');
      var end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch (e2) { /* ignore */ }
      }
    }
    return null;
  }

  function lockedConfigFromDraft(draft) {
    var c = (draft && draft.config) || {};
    return {
      genreLabel: c.genreLabel,
      playerName: c.playerName,
      playerAvatar: c.playerAvatar,
      playerGender: c.playerGender,
      turnUnit: c.turnUnit
    };
  }

  function pickAiConfig(ai) {
    var ac = ai && typeof ai === 'object' ? ai : {};
    var nested = ac.config && typeof ac.config === 'object' ? ac.config : {};
    return Object.assign({}, ac, nested);
  }

  function mergeAiComplete(draft, ai) {
    var out = Object.assign({}, draft || {});
    var baseCfg = Object.assign({}, (draft && draft.config) || {});
    var locked = lockedConfigFromDraft(draft);
    if (!ai || typeof ai !== 'object') return out;

    var ac = pickAiConfig(ai);

    if (ai.subtitle != null && String(ai.subtitle).trim()) out.subtitle = String(ai.subtitle).trim();
    if (ai.tagline != null && String(ai.tagline).trim()) out.tagline = String(ai.tagline).trim();
    if (ai.difficulty != null && String(ai.difficulty).trim()) out.difficulty = String(ai.difficulty).trim();
    if (Array.isArray(ai.features) && ai.features.length) {
      out.features = ai.features.map(function (f) { return String(f || '').trim(); }).filter(Boolean);
    }

    var cfg = Object.assign({}, baseCfg);
    if (ac.playerAge != null) cfg.playerAge = ac.playerAge;
    if (ac.worldview != null && String(ac.worldview).trim()) cfg.worldview = String(ac.worldview).trim();
    else if (ac.world_build != null && String(ac.world_build).trim()) cfg.worldview = String(ac.world_build).trim();
    if (ac.writingStyle != null && String(ac.writingStyle).trim()) cfg.writingStyle = String(ac.writingStyle).trim();
    if (Array.isArray(ac.playerStats) && ac.playerStats.length) cfg.playerStats = ac.playerStats;
    if (Array.isArray(ac.rankLevels) && ac.rankLevels.length) cfg.rankLevels = ac.rankLevels;
    if (Array.isArray(ai.initialSkills) && ai.initialSkills.length) cfg.initialSkills = ai.initialSkills;
    else if (Array.isArray(ac.initialSkills) && ac.initialSkills.length) cfg.initialSkills = ac.initialSkills;
    if (Array.isArray(ai.initialTalents) && ai.initialTalents.length) cfg.initialTalents = ai.initialTalents;
    else if (Array.isArray(ac.initialTalents) && ac.initialTalents.length) cfg.initialTalents = ac.initialTalents;

    Object.keys(locked).forEach(function (k) {
      if (locked[k] !== undefined && locked[k] !== null) cfg[k] = locked[k];
    });

    out.title = draft.title;
    out.config = store().normalizeScriptConfig(cfg);
    return out;
  }

  function buildCompletePrompt(draft) {
    var cfg = draft.config || {};
    var locked = {
      title: draft.title || '',
      genreLabel: cfg.genreLabel || '',
      playerName: cfg.playerName || '',
      playerGender: cfg.playerGender || '',
      playerAvatar: cfg.playerAvatar ? '（已上传）' : '',
      turnUnit: cfg.turnUnit || 'day'
    };
    var reference = {
      subtitle: draft.subtitle || '',
      tagline: draft.tagline || '',
      difficulty: draft.difficulty || '',
      features: draft.features || [],
      playerAge: cfg.playerAge || '',
      worldview: cfg.worldview || '',
      writingStyle: cfg.writingStyle || '',
      playerStats: cfg.playerStats || [],
      rankLevels: cfg.rankLevels || [],
      initialSkills: cfg.initialSkills || [],
      initialTalents: cfg.initialTalents || []
    };
    return (
      '你是人生模拟文游首席策划。请根据用户锁定的核心设定，**重写并扩写**剧本的其余全部内容。\n\n' +
      '【锁定 · 禁止改动】以下字段仅作参考，你的 JSON 中不要输出 title、genreLabel、playerName、playerGender、playerAvatar、turnUnit：\n' +
      JSON.stringify(locked, null, 2) + '\n\n' +
      '【用户当前草稿 · 可全部覆盖】以下字段即使用户已填写，也必须输出你的全新完整版本（更长、更具体、更可玩）：\n' +
      JSON.stringify(reference, null, 2) + '\n\n' +
      '【你必须输出的 JSON 字段】\n' +
      'subtitle, tagline, difficulty, features(8-12项玩法标签),\n' +
      'config: { playerAge, worldview, writingStyle, playerStats, rankLevels, initialSkills, initialTalents }\n\n' +
      '【playerStats · 重点】\n' +
      '- 必须输出 6-12 项养成数值，名称可自由创作（如 SAN、声望、灵根、负债、人脉…），与题材匹配。\n' +
      '- 每项含 name, max(默认1000), initial(默认50，初始值)。\n' +
      '- **即使用户已有数值草稿也要整表替换**为你的完整方案，可增删改名，不要保留用户旧表。\n\n' +
      '【rankLevels · 身份等级】\n' +
      '- 输出 8-20 级身份/咖位阶梯（如娱乐圈十八线→影后，或宫斗宫女→皇后），与题材匹配。\n' +
      '- 每项：rank(序号), name, expRequired(累计经验门槛), requirements([{statName,min}]，属性名与 playerStats 对应)。\n' +
      '- 等级越高经验与属性要求递增；第一级 expRequired=0、requirements=[]。\n\n' +
      '【initialSkills · 初始技能】\n' +
      '- 输出 4-8 项可习得技能（仅 name、desc），与题材/世界观匹配；desc 30-120 字。\n' +
      '- 即使用户已有草稿也输出完整新表。\n\n' +
      '【initialTalents · 初始天赋】\n' +
      '- 输出 3-6 项天生天赋（仅 name、desc），强调 innate 被动特质；与技能互补。\n\n' +
      '【其他】\n' +
      '- 只输出一个 JSON 对象，无 markdown。\n' +
      '- 内容越多越好，细节越丰富越好。'
    );
  }

  function buildContextSnapshot(draft) {
    var cfg = (draft && draft.config) || {};
    return {
      title: draft.title || '',
      genreLabel: cfg.genreLabel || '',
      subtitle: draft.subtitle || '',
      tagline: draft.tagline || '',
      difficulty: draft.difficulty || '',
      features: draft.features || [],
      playerName: cfg.playerName || '',
      playerGender: cfg.playerGender || '',
      playerAvatar: cfg.playerAvatar ? '（已上传）' : '',
      playerAge: cfg.playerAge,
      worldview: cfg.worldview || '',
      writingStyle: cfg.writingStyle || '',
      turnUnit: cfg.turnUnit || 'day',
      playerStats: cfg.playerStats || [],
      rankLevels: cfg.rankLevels || [],
      initialSkills: cfg.initialSkills || [],
      initialTalents: cfg.initialTalents || []
    };
  }

  var MODULE_SPECS = {
    basic: {
      label: '基本信息',
      system: '你只输出合法 JSON，含 subtitle, tagline, difficulty, features[]。不要输出其他字段。',
      task:
        '【本模块 · 基本信息】仅重写 subtitle(副标题), tagline(卷首语), difficulty(难度), features(8-12项玩法标签)。\n' +
        'title 与 genreLabel 仅作参考，不要输出。',
      output: '{ "subtitle", "tagline", "difficulty", "features": [] }'
    },
    player: {
      label: '玩家角色',
      system: '你只输出合法 JSON: { "config": { "playerAge": number } }。不要输出姓名、性别、头像。',
      task:
        '【本模块 · 玩家角色】仅重写 config.playerAge(初始年龄，须符合世界观与题材)。\n' +
        'playerName、playerGender、playerAvatar 禁止改动，不要输出。',
      output: '{ "config": { "playerAge": 18 } }'
    },
    world: {
      label: '世界与文风',
      system: '你只输出合法 JSON: { "config": { "worldview", "writingStyle" } }。',
      task:
        '【本模块 · 世界与文风】仅重写 worldview(详尽世界观，分点叙述时代/地理/势力/规则/禁忌) 与 writingStyle(AI 叙事文风指令)。',
      output: '{ "config": { "worldview", "writingStyle" } }'
    },
    stats: {
      label: '玩家数值机制',
      system: '你只输出合法 JSON，含 playerStats 数组(6-12项，每项 name,max,initial)。',
      task:
        '【本模块 · 玩家数值机制】仅重写 playerStats：6-12 项养成数值，每项 name、max(建议1000)、initial(建议50，可不同)。\n' +
        '即使用户已有草稿也输出完整新表。',
      output: '{ "playerStats": [] } 或 { "config": { "playerStats": [] } }'
    },
    ranks: {
      label: '身份等级阶梯',
      system: '你只输出合法 JSON，含 rankLevels 数组(8-20项，每项 rank,name,expRequired,requirements[{statName,min}])。',
      task:
        '【本模块 · 身份等级阶梯】仅重写 rankLevels：身份/咖位阶梯，经验与属性门槛递增；requirements 中 statName 与 playerStats 的 name 对应。\n' +
        '第一级 expRequired=0、requirements=[]。',
      output: '{ "rankLevels": [] } 或 { "config": { "rankLevels": [] } }'
    },
    abilities: {
      label: '初始技能与天赋',
      system:
        '你只输出合法 JSON，含 initialSkills、initialTalents 数组（每项仅 name、desc）。不要输出 level/exp/id。',
      task:
        '【本模块 · 初始技能与天赋】仅重写 initialSkills(4-8项可习得技能) 与 initialTalents(3-6项天生天赋)。\n' +
        '技能与天赋名称勿重复；即使用户已有草稿也输出完整新表。',
      output: '{ "initialSkills": [], "initialTalents": [] } 或 { "config": { "initialSkills": [], "initialTalents": [] } }'
    }
  };

  function buildModulePrompt(draft, moduleId) {
    var spec = MODULE_SPECS[moduleId];
    if (!spec) throw new Error('unknown_module');
    var ctx = buildContextSnapshot(draft);
    return (
      '你是人生模拟文游首席策划。请阅读下方【全剧本参考上下文】（只读），**仅重写当前模块**，其余模块不要输出。\n\n' +
      '【全剧本参考上下文 · 只读】\n' +
      JSON.stringify(ctx, null, 2) + '\n\n' +
      spec.task + '\n\n' +
      '【输出格式】\n' + spec.output + '\n' +
      '只输出一个 JSON 对象，无 markdown。内容越详尽越好。'
    );
  }

  function mergeModuleResult(draft, moduleId, ai) {
    if (!draft) return draft;
    if (!ai || typeof ai !== 'object') return draft;
    var out = Object.assign({}, draft);
    var cfg = Object.assign({}, draft.config || {});
    var ac = pickAiConfig(ai);

    if (moduleId === 'basic') {
      if (ai.subtitle != null && String(ai.subtitle).trim()) out.subtitle = String(ai.subtitle).trim();
      if (ai.tagline != null && String(ai.tagline).trim()) out.tagline = String(ai.tagline).trim();
      if (ai.difficulty != null && String(ai.difficulty).trim()) out.difficulty = String(ai.difficulty).trim();
      if (Array.isArray(ai.features) && ai.features.length) {
        out.features = ai.features.map(function (f) { return String(f || '').trim(); }).filter(Boolean);
      }
    } else if (moduleId === 'player') {
      if (ac.playerAge != null) cfg.playerAge = ac.playerAge;
      var locked = lockedConfigFromDraft(draft);
      Object.keys(locked).forEach(function (k) {
        if (locked[k] !== undefined && locked[k] !== null) cfg[k] = locked[k];
      });
    } else if (moduleId === 'world') {
      if (ac.worldview != null && String(ac.worldview).trim()) cfg.worldview = String(ac.worldview).trim();
      else if (ac.world_build != null && String(ac.world_build).trim()) cfg.worldview = String(ac.world_build).trim();
      if (ac.writingStyle != null && String(ac.writingStyle).trim()) cfg.writingStyle = String(ac.writingStyle).trim();
    } else if (moduleId === 'stats') {
      var stats = ai.playerStats || ac.playerStats;
      if (Array.isArray(stats) && stats.length) cfg.playerStats = stats;
    } else if (moduleId === 'ranks') {
      var ranks = ai.rankLevels || ac.rankLevels;
      if (Array.isArray(ranks) && ranks.length) cfg.rankLevels = ranks;
    } else if (moduleId === 'abilities') {
      var cfgSkills = ai.initialSkills || ac.initialSkills;
      var cfgTalents = ai.initialTalents || ac.initialTalents;
      if (Array.isArray(cfgSkills) && cfgSkills.length) cfg.initialSkills = cfgSkills;
      if (Array.isArray(cfgTalents) && cfgTalents.length) cfg.initialTalents = cfgTalents;
    }

    out.title = draft.title;
    out.config = store().normalizeScriptConfig(cfg);
    return out;
  }

  function requestAiJson(systemContent, userContent) {
    var st = store();
    if (!st) return Promise.reject(new Error('store_missing'));
    var cfg = st.getApiConfig();
    var cred = resolveApiCredentials();
    var baseUrl = openAiCompatibleApiRoot(cred.baseUrl);
    var apiKey = cred.apiKey;
    var model = String(cfg.model || '').trim();
    if (!baseUrl || !apiKey || !model) return Promise.reject(new Error('api_not_configured'));

    return fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        temperature: cfg.temperature != null ? cfg.temperature : 0.85,
        messages: (function () {
          var eng = global.miyaChatEngine;
          var msgs = [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent }
          ];
          return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
            ? eng.prependUniversalWorldbookMessage(msgs)
            : msgs;
        })()
      })
    })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 120) : ''));
        });
        return r.json();
      })
      .then(function (data) {
        var text = extractReplyContent(data);
        var parsed = parseJsonFromText(text);
        if (!parsed) throw new Error('parse_failed');
        return parsed;
      });
  }

  function extractStreamContent(obj) {
    if (!obj || !obj.choices || !obj.choices[0]) return '';
    var ch = obj.choices[0];
    if (ch.delta && ch.delta.content != null) return String(ch.delta.content);
    if (ch.message && ch.message.content != null) return String(ch.message.content);
    if (ch.text != null) return String(ch.text);
    return '';
  }

  function stripNdjsonLine(raw) {
    var line = String(raw || '').trim();
    if (!line) return '';
    if (line.indexOf('```') === 0) return '';
    if (line.charAt(0) === ',') line = line.slice(1).trim();
    return line;
  }

  function parseNdjsonLine(raw) {
    var line = stripNdjsonLine(raw);
    if (!line || line === '{' || line === '}' || line === '[' || line === ']') return null;
    try {
      return JSON.parse(line);
    } catch (e1) {
      var start = line.indexOf('{');
      var end = line.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(line.slice(start, end + 1));
        } catch (e2) { /* ignore */ }
      }
    }
    return null;
  }

  function isStreamMetaRow(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (String(obj.type || '').toLowerCase() === 'meta') return true;
    return obj.roundMemory != null || Array.isArray(obj.assetUpdates) || Array.isArray(obj.newContacts);
  }

  function isStreamEventRow(obj) {
    if (!obj || typeof obj !== 'object' || isStreamMetaRow(obj)) return false;
    return !!(String(obj.body || obj.text || obj.content || '').trim());
  }

  function requestAiStream(systemContent, userContent, handlers) {
    handlers = handlers || {};
    var st = store();
    if (!st) return Promise.reject(new Error('store_missing'));
    var cfg = st.getApiConfig();
    var cred = resolveApiCredentials();
    var baseUrl = openAiCompatibleApiRoot(cred.baseUrl);
    var apiKey = cred.apiKey;
    var model = String(cfg.model || '').trim();
    if (!baseUrl || !apiKey || !model) return Promise.reject(new Error('api_not_configured'));

    var lineBuf = '';
    var contentAcc = '';

    function emitLine(raw) {
      var obj = parseNdjsonLine(raw);
      if (!obj) return false;
      if (handlers.onLine) handlers.onLine(obj);
      return true;
    }

    function feedTextChunk(chunk) {
      if (!chunk) return;
      contentAcc += chunk;
      if (handlers.onDelta) handlers.onDelta(contentAcc);
      lineBuf += chunk;
      var parts = lineBuf.split('\n');
      lineBuf = parts.pop() || '';
      parts.forEach(function (part) { emitLine(part); });
    }

    function finishStream() {
      if (lineBuf.trim()) emitLine(lineBuf);
      lineBuf = '';
      if (handlers.onDone) handlers.onDone(contentAcc);
      return contentAcc;
    }

    function consumeSsePayload(trimmed) {
      if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return;
      if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
      if (!trimmed || trimmed === '[DONE]') return;
      try {
        var obj = JSON.parse(trimmed);
        feedTextChunk(extractStreamContent(obj));
      } catch (e) { /* ignore partial SSE line */ }
    }

    return fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        temperature: cfg.temperature != null ? cfg.temperature : 0.85,
        stream: true,
        messages: (function () {
          var eng = global.miyaChatEngine;
          var msgs = [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent }
          ];
          return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
            ? eng.prependUniversalWorldbookMessage(msgs)
            : msgs;
        })()
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
        });
      }
      if (!res.body || !res.body.getReader) {
        return res.json().then(function (data) {
          feedTextChunk(extractReplyContent(data));
          return finishStream();
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var sseBuf = '';
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return finishStream();
          sseBuf += decoder.decode(result.value, { stream: true });
          var parts = sseBuf.split('\n');
          sseBuf = parts.pop() || '';
          parts.forEach(consumeSsePayload);
          return pump();
        });
      }
      return pump();
    });
  }

  function completeScriptModule(draft, moduleId) {
    var spec = MODULE_SPECS[moduleId];
    if (!spec) return Promise.reject(new Error('unknown_module'));
    return requestAiJson(spec.system, buildModulePrompt(draft, moduleId)).then(function (parsed) {
      return mergeModuleResult(draft, moduleId, parsed);
    });
  }

  function completeScriptDraft(draft) {
    return requestAiJson(
      '你只输出合法 JSON。必须包含 subtitle, tagline, difficulty, features[], config{ playerAge, worldview, writingStyle, playerStats[], rankLevels[], initialSkills[], initialTalents[] }。' +
        'playerStats 6-12项且每项含 max、initial。initialSkills 4-8项、initialTalents 3-6项，每项仅 name、desc。除用户锁定的姓名/题材/回合单位/头像性别外，其余字段一律输出完整新内容，覆盖用户旧稿。',
      buildCompletePrompt(draft)
    ).then(function (parsed) {
      return mergeAiComplete(draft, parsed);
    });
  }

  function buildEditorContext(draft) {
    var cfg = (draft && draft.config) || {};
    return {
      title: draft.title || '',
      genreLabel: cfg.genreLabel || '',
      subtitle: draft.subtitle || '',
      tagline: trimCtxText(draft.tagline, 200),
      worldview: trimCtxText(cfg.worldview, 1600),
      writingStyle: trimCtxText(cfg.writingStyle, 800),
      playerName: cfg.playerName || '',
      playerGender: cfg.playerGender || '',
      playerAge: cfg.playerAge || 18,
      playerStats: (cfg.playerStats || []).slice(0, 16),
      rankLevels: (cfg.rankLevels || []).slice(0, 12),
      initialSkills: (cfg.initialSkills || []).map(function (s) { return { name: s.name }; }),
      initialTalents: (cfg.initialTalents || []).map(function (t) { return { name: t.name }; })
    };
  }

  function generateConfigSkills(draft, opts) {
    opts = opts || {};
    var mode = opts.mode || 'initial';
    var count = clampCount(opts.count, mode === 'initial' ? 4 : 1, 12);
    var ctx = buildEditorContext(draft);
    var avoid = (ctx.initialSkills || []).map(function (s) { return s.name; }).join('、');
    var task =
      mode === 'regen'
        ? '【任务】根据剧本设定，**重新生成** ' + count + ' 个全新初始技能（仅配置用，level=1），名称与旧表完全不同。'
        : mode === 'new'
          ? '【任务】在已有初始技能基础上，再创作 ' + count + ' 个新技能，不要重名。'
          : '【任务】为剧本配置生成 ' + count + ' 个初始技能（仅 name、desc），符合世界观。';
    var user =
      task + '\n\n' +
      '【剧本上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      (avoid ? '【已有技能 · 勿重复】' + avoid + '\n\n' : '') +
      '【输出格式】只输出 JSON：{ "initialSkills": [ { "name", "desc" } ] }\n' +
      '- name 2-8 字，desc 30-120 字。';
    return requestAiJson(
      '你是人生模拟文游技能策划。只输出合法 JSON，含 initialSkills 数组；每项必须有 name 和 desc。不要 markdown。',
      user
    ).then(function (parsed) {
      var list = parsed.initialSkills || (parsed.config && parsed.config.initialSkills) || extractSkillList(parsed);
      var rows = normalizeAiSkills(list, 1).map(function (r) {
        return { name: r.name, desc: r.desc };
      });
      if (!rows.length) throw new Error('empty_result');
      return rows.slice(0, count);
    });
  }

  function generateConfigTalents(draft, count) {
    var n = clampCount(count, 1, 20);
    var ctx = buildEditorContext(draft);
    var avoid = (ctx.initialTalents || []).map(function (t) { return t.name; }).join('、');
    var user =
      '【任务】根据剧本设定，生成 ' + n + ' 个**初始天赋**（剧本配置，不可升级）。\n\n' +
      '【剧本上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      (avoid ? '【已有天赋 · 勿重复】' + avoid + '\n\n' : '') +
      '【输出格式】只输出 JSON：{ "initialTalents": [ { "name", "desc" } ] }\n' +
      '- name 2-8 字，desc 30-120 字。';
    return requestAiJson(
      '你是人生模拟文游天赋策划。只输出合法 JSON，含 initialTalents 数组。',
      user
    ).then(function (parsed) {
      var list = parsed.initialTalents || (parsed.config && parsed.config.initialTalents) || parsed.talents || [];
      var rows = normalizeAiTalents(list);
      if (!rows.length) throw new Error('empty_result');
      return rows.slice(0, n);
    });
  }

  function trimCtxText(str, max) {
    var s = String(str || '').trim();
    if (!s) return '';
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  function buildPlayContext(script, save) {
    var cfg = (script && script.config) || {};
    var player = (save && save.player) || {};
    var st = store();
    var scriptId = (script && script.id) || (save && save.scriptId) || '';
    var skills = st && scriptId ? st.getSkills(scriptId) : [];
    var talents = st && scriptId ? st.getTalents(scriptId) : [];
    return {
      title: script ? script.title : '',
      genreLabel: cfg.genreLabel || '',
      subtitle: script ? script.subtitle : '',
      tagline: trimCtxText(script ? script.tagline : '', 200),
      worldview: trimCtxText(cfg.worldview, 1600),
      writingStyle: trimCtxText(cfg.writingStyle, 800),
      turnUnit: cfg.turnUnit || 'day',
      turn: save ? save.turn : 1,
      playerStats: (cfg.playerStats || []).slice(0, 16),
      rankLevels: (cfg.rankLevels || []).slice(0, 12),
      player: {
        name: player.name || cfg.playerName || '',
        gender: player.gender || cfg.playerGender || '',
        age: player.age || cfg.playerAge || 18,
        identity: trimCtxText(player.identity, 80),
        occupation: trimCtxText(player.occupation, 80),
        appearance: trimCtxText(player.appearance, 200),
        personality: trimCtxText(player.personality, 200),
        statusTitle: trimCtxText(player.statusTitle, 48),
        statusDesc: trimCtxText(player.statusDesc, 160)
      },
      existingSkills: skills.map(function (s) { return { name: s.name, level: s.level }; }),
      existingTalents: talents.map(function (t) { return { name: t.name }; }),
      relationships: st && scriptId ? st.getNpcs(scriptId).map(function (n) {
        return st.npcForApiContext(n);
      }).filter(Boolean) : []
    };
  }

  function extractSkillList(parsed) {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed !== 'object') return [];
    if (Array.isArray(parsed.skills)) return parsed.skills;
    if (Array.isArray(parsed.技能)) return parsed.技能;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (parsed.config && Array.isArray(parsed.config.skills)) return parsed.config.skills;
    if (parsed.data && Array.isArray(parsed.data.skills)) return parsed.data.skills;
    if (parsed.result && Array.isArray(parsed.result.skills)) return parsed.result.skills;
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i += 1) {
      var val = parsed[keys[i]];
      if (!Array.isArray(val) || !val.length) continue;
      if (val[0] && typeof val[0] === 'object' && (val[0].name || val[0].名称)) return val;
    }
    return [];
  }

  function normalizeAiSkills(list, defaultLevel) {
    var lv = defaultLevel != null ? defaultLevel : 1;
    var src = Array.isArray(list) ? list : extractSkillList(list);
    return src.map(function (raw) {
      if (!raw || typeof raw !== 'object') return null;
      var name = String(raw.name || raw.名称 || raw.skillName || raw.title || '').trim();
      if (!name) return null;
      return {
        name: name.slice(0, 24),
        desc: String(raw.desc || raw.description || raw.介绍 || raw.detail || raw.summary || '').slice(0, 280),
        level: lv,
        exp: 0
      };
    }).filter(Boolean);
  }

  function normalizeAiTalents(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (raw) {
      if (!raw || typeof raw !== 'object') return null;
      var name = String(raw.name || '').trim();
      if (!name) return null;
      return {
        name: name.slice(0, 24),
        desc: String(raw.desc || raw.description || '').slice(0, 280)
      };
    }).filter(Boolean);
  }

  function generateSkills(script, save, opts) {
    opts = opts || {};
    var mode = opts.mode || 'initial';
    var count = clampCount(opts.count, mode === 'initial' ? 4 : 1, 12);
    var ctx = buildPlayContext(script, save);
    var avoid = (ctx.existingSkills || []).map(function (s) { return s.name; }).join('、');
    var task =
      mode === 'regen'
        ? '【任务】根据剧本与角色，**重新生成** ' + count + ' 个全新一级技能（level=1），名称与介绍与旧技能完全不同。'
        : mode === 'new'
          ? '【任务】在已有技能基础上，再创作 ' + count + ' 个全新一级技能（level=1），不要与已有技能重名。'
          : '【任务】为角色生成 ' + count + ' 个初始一级技能（level=1），符合世界观与身份。';
    var user =
      task + '\n\n' +
      '【剧本与角色上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      (avoid ? '【已有技能 · 勿重复】' + avoid + '\n\n' : '') +
      '【输出格式】只输出 JSON：{ "skills": [ { "name", "desc" } ] }\n' +
      '- 每项 name 2-8 字，desc 30-120 字，说明技能用途与成长方向。\n' +
      '- 不要输出 level/exp/id，系统会自动设为 1 级。';
    return requestAiJson(
      '你是人生模拟文游技能策划。只输出合法 JSON，含 skills 数组；每项必须有 name 和 desc 字段。不要 markdown，不要代码块。',
      user
    ).then(function (parsed) {
      var rows = normalizeAiSkills(extractSkillList(parsed), 1);
      if (!rows.length) throw new Error('empty_result');
      return rows.slice(0, count);
    });
  }

  function formatPlayGenError(err) {
    var code = err && err.message ? String(err.message) : '';
    if (code === 'api_not_configured') return '请先在 API 设置中配置接口地址、Key 和模型';
    if (code === 'parse_failed') return 'AI 返回无法解析，请重试或更换模型';
    if (code === 'empty_result') return 'AI 未返回有效内容，请重试';
    if (code === 'store_missing') return '存档未就绪';
    if (code.indexOf('HTTP') === 0) return '接口请求失败（' + code + '）';
    return code || '未知错误';
  }

  function generateTalents(script, save, count) {
    var n = clampCount(count, 1, 20);
    var ctx = buildPlayContext(script, save);
    var avoid = (ctx.existingTalents || []).map(function (t) { return t.name; }).join('、');
    var user =
      '【任务】根据剧本、角色与已有技能，生成 ' + n + ' 个**天生天赋**（不可升级）。\n\n' +
      '【剧本与角色上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      (avoid ? '【已有天赋 · 勿重复】' + avoid + '\n\n' : '') +
      '【输出格式】只输出 JSON：{ "talents": [ { "name", "desc" } ] }\n' +
      '- name 2-8 字，desc 30-120 字，强调 innate 被动特质。\n' +
      '- 不要输出 id。';
    return requestAiJson(
      '你是人生模拟文游天赋策划。只输出合法 JSON，含 talents 数组。',
      user
    ).then(function (parsed) {
      var rows = normalizeAiTalents(parsed.talents || parsed.items || []);
      if (!rows.length) throw new Error('empty_result');
      return rows.slice(0, n);
    });
  }

  function clampCount(val, min, max) {
    var n = parseInt(val, 10);
    if (isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  var NARRATIVE_SYSTEM =
    '你是人生模拟文游叙事引擎。只输出合法 JSON，无 markdown。' +
    'events 数组每项含 timeLabel, title, body(100-200汉字), changes(变更列表)。' +
    'changes 每项含 type(stat|skill|rank|relation|asset|achievement|note), name, delta(数字或+3), after(可选终值), note。' +
    '另可含 roundMemory(本回合压缩记忆,80-200字), assetUpdates([{name,value}]) 同步财产, ' +
    'newContacts([{name,gender,age,identity,occupation,persona,affinity}]) 本回合新认识且应加入人际档案的人物（勿与已有重复）。' +
    '只能输出全新情节，不可与已有叙事重复。';

  var NARRATIVE_STREAM_SYSTEM =
    '你是人生模拟文游叙事引擎。以 NDJSON 流式输出：每行一个完整 JSON 对象，无 markdown、无代码块、无数组包裹。' +
    '事件行格式：{"timeLabel":"时段","title":"标题","body":"100-200字正文","changes":[...]}；changes 可省略。' +
    'changes 每项含 type(stat|skill|rank|relation|asset|achievement|note), name, delta, after(可选), note。' +
    '只能输出全新情节，不可与已有叙事或本回合已输出事件重复。';

  function trimList(arr, max, mapFn) {
    return (arr || []).slice(0, max).map(mapFn || function (x) { return x; });
  }

  function buildFullPlayContext(script, save, opts) {
    opts = opts || {};
    var st = store();
    var cfg = (script && script.config) || {};
    var sid = (script && script.id) || (save && save.scriptId);
    var base = buildPlayContext(script, save);
    var meta = st && save ? st.ensurePlayMeta(save) : {};
    var mem = st && save ? st.ensureMemory(save) : { summaries: [], roundMemories: [] };
    var narr = st && save ? st.ensureNarrative(save) : { events: [] };
    var assets = st && sid ? st.getAssetCategories(sid) : [];
    var retain = clampCount(meta.retainRounds, 1, 50, 5);
    var recentTurn = Math.max(1, (save.turn || 1) - retain + 1);
    var recentEvents = narr.events.filter(function (ev) {
      return ev.turn >= recentTurn;
    });
    var ctxRounds = clampCount(opts.contextRounds, 1, 50, retain);

    return Object.assign({}, base, {
      playerIntent: String(opts.playerIntent || '').slice(0, 500),
      playerProfile: save && save.player ? save.player : {},
      playableStats: st && script && save ? st.getPlayableStats(script, save) : [],
      rankProgress: st && script && save ? st.getRankProgress(script, save) : null,
      relationships: trimList(st && save ? st.getNpcs(sid) : [], 32, function (n) {
        return st.npcForApiContext(n);
      }),
      assets: assets.map(function (a) {
        return { name: a.name, value: a.value, unit: a.unit, note: a.note };
      }),
      achievements: trimList(st && sid ? st.getAchievements(sid) : [], 16, function (a) {
        return { name: a.name, turn: a.turn };
      }),
      skillsFull: trimList(st && sid ? st.getSkills(sid) : [], 24, function (sk) {
        return { name: sk.name, level: sk.level, exp: sk.exp, desc: trimCtxText(sk.desc, 80) };
      }),
      talentsFull: trimList(st && sid ? st.getTalents(sid) : [], 16, function (t) {
        return { name: t.name, desc: trimCtxText(t.desc, 60) };
      }),
      memoryNotes: trimCtxText(meta.manualMemoryNotes, 800),
      roundMemories: trimList(mem.roundMemories, retain, function (m) {
        return { turn: m.turn, content: trimCtxText(m.content, 280) };
      }),
      roundSummaries: trimList(mem.summaries, 12, function (s) {
        return {
          turn: s.turn,
          turnEnd: s.turnEnd,
          gameTime: s.gameTime,
          content: trimCtxText(s.content, 320),
          required: s.required
        };
      }),
      recentNarrativeEvents: trimList(recentEvents, 80, function (ev) {
        return {
          turn: ev.turn,
          timeLabel: ev.timeLabel,
          title: ev.title,
          body: trimCtxText(ev.body, 200),
          changes: ev.changes
        };
      }),
      narrativeEventsThisRound: narr.events.filter(function (ev) {
        return ev.turn === (save.turn || 1);
      }).length,
      contextRounds: ctxRounds
    });
  }

  function applyTurnMeta(scriptId, parsed, turn) {
    var st = store();
    if (!st || !parsed) return { newContacts: [] };
    if (Array.isArray(parsed.assetUpdates) && parsed.assetUpdates.length) {
      var cats = st.getAssetCategories(scriptId);
      parsed.assetUpdates.forEach(function (au) {
        if (!au || !au.name) return;
        var cat = cats.find(function (c) { return c.name === au.name; });
        if (cat && au.value != null) cat.value = Number(au.value);
      });
      st.setAssetCategories(scriptId, cats);
    }
    if (parsed.roundMemory) {
      st.addRoundMemory(scriptId, turn, String(parsed.roundMemory).trim());
    }
    var newContacts = parsed.newContacts || parsed.newPeople || parsed.contacts || [];
    return { newContacts: st.mergeNewContacts(scriptId, newContacts, { turn: turn }) };
  }

  function applySingleNarrativeEvent(scriptId, evObj, turn, source) {
    var st = store();
    if (!st || !isStreamEventRow(evObj)) return null;
    var rows = st.appendNarrativeEvents(scriptId, [evObj], {
      turn: turn,
      source: source || 'turn'
    });
    if (!rows.length) return null;
    var applied = [];
    if (rows[0].changes && rows[0].changes.length) {
      applied = st.applyNarrativeChanges(scriptId, rows[0].changes);
    }
    return { event: rows[0], applied: applied };
  }

  function applyTurnGenerationResult(scriptId, parsed, turn) {
    var st = store();
    if (!st || !parsed) return { events: [], applied: [] };
    var events = Array.isArray(parsed.events) ? parsed.events : [];
    var rows = st.appendNarrativeEvents(scriptId, events, { turn: turn, source: 'turn' });
    var applied = [];
    rows.forEach(function (ev) {
      if (ev.changes && ev.changes.length) {
        applied = applied.concat(st.applyNarrativeChanges(scriptId, ev.changes));
      }
    });
    var meta = applyTurnMeta(scriptId, parsed, turn);
    return {
      events: rows,
      applied: applied,
      newContacts: meta.newContacts || []
    };
  }

  function buildTurnStreamUserPrompt(script, save, opts) {
    opts = opts || {};
    var turn = opts.targetTurn != null ? opts.targetTurn : (save.turn || 1);
    var ctx = buildFullPlayContext(script, save, {
      playerIntent: opts.playerIntent || '',
      contextRounds: opts.contextRounds
    });
    var batchCount = clampCount(opts.batchCount, 1, 12, 8);
    var existingThisTurn = (ctx.narrativeEventsThisRound || 0) + (opts.alreadyGenerated || 0);
    var head =
      (opts.regenerate
        ? '【任务】**重新生成**第 ' + turn + ' 回合：流式输出 ' + batchCount + ' 条全新叙事事件（NDJSON 每行一条）。\n'
        : opts.continuation
          ? '【续写】第 ' + turn + ' 回合已生成 ' + existingThisTurn + ' 条，请再流式输出 ' + batchCount + ' 条**全新**事件（NDJSON 每行一条）。\n'
          : '【任务】为第 ' + turn + ' 回合流式输出 ' + batchCount + ' 条叙事事件（NDJSON 每行一条）。\n') +
      '每条 body 100-200 字；timeLabel 写清时段；changes 写明属性/技能/等级/人际/财产等变化（无变化可省略）。\n' +
      '须承接世界观、玩家档案、财产、技能天赋、等级、人际、近几回合记忆与回合总结、已有叙事。\n' +
      '**只能输出全新内容，不可与已有叙事或本回合已生成事件重复。**\n' +
      (opts.playerIntent
        ? '【玩家本回合打算】' + opts.playerIntent + '\n'
        : opts.continuation
          ? ''
          : '【玩家本回合打算】未指定，由剧情自然推进。\n') +
      '\n【当前上下文 JSON】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      '【输出要求】逐行输出事件 JSON，一行一条，不要数组包裹，不要 markdown。';
    return { turn: turn, user: head, batchCount: batchCount };
  }

  function generateTurnMeta(script, save, turn, eventCount) {
    var st = store();
    if (!st || !script || !save) return Promise.resolve({ newContacts: [] });
    var ctx = buildFullPlayContext(script, save, {});
    var user =
      '【任务】第 ' + turn + ' 回合已生成 ' + eventCount + ' 条叙事事件，请输出本回合收尾 JSON。\n' +
      '只能输出全新信息，不可重复已有叙事。\n\n' +
      '【上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      '只输出 JSON：{ "roundMemory": "80-200字压缩记忆", "assetUpdates": [{ "name", "value" }], "newContacts": [] }';
    return requestAiJson(
      '你是人生模拟文游档案员。只输出合法 JSON，含 roundMemory、assetUpdates、newContacts。不要 markdown。',
      user
    ).then(function (parsed) {
      return applyTurnMeta(script.id, parsed, turn);
    }).catch(function () {
      return { newContacts: [] };
    });
  }

  function streamTurnEventBatch(script, save, opts) {
    var st = store();
    var built = buildTurnStreamUserPrompt(script, save, opts);
    var turn = built.turn;
    var appliedAll = [];
    var rows = [];
    return requestAiStream(NARRATIVE_STREAM_SYSTEM, built.user, {
      onLine: function (obj) {
        if (isStreamMetaRow(obj)) return;
        var one = applySingleNarrativeEvent(script.id, obj, turn, 'turn');
        if (!one) return;
        rows.push(one.event);
        appliedAll = appliedAll.concat(one.applied || []);
        save = st.getSave(script.id) || save;
        if (opts.onEvent) opts.onEvent(one);
      }
    }).then(function () {
      return { events: rows, applied: appliedAll, count: rows.length };
    });
  }

  function generateTurnNarrative(script, save, opts) {
    opts = opts || {};
    var st = store();
    if (!st || !script || !save) return Promise.reject(new Error('store_missing'));
    var turn = opts.targetTurn != null ? opts.targetTurn : (save.turn || 1);
    var minEvents = clampCount(opts.minEvents, 20, 40, 20);

    if (opts.advanceOnSuccess) {
      st.advanceTurn(script.id);
      save = st.getSave(script.id) || save;
      turn = save.turn || turn;
    }

    var allEvents = [];
    var allApplied = [];
    var generated = 0;
    var metaResult = { newContacts: [] };
    var emptyBatchRetries = 0;

    function runNextBatch(isContinuation) {
      if (generated >= minEvents) return Promise.resolve();
      var need = minEvents - generated;
      var batchCount = Math.min(need, isContinuation ? 6 : 8);
      return streamTurnEventBatch(script, save, {
        playerIntent: opts.playerIntent,
        contextRounds: opts.contextRounds,
        regenerate: opts.regenerate && !isContinuation && !generated,
        continuation: isContinuation,
        alreadyGenerated: generated,
        batchCount: batchCount,
        targetTurn: turn,
        onEvent: function (one) {
          generated += 1;
          allEvents.push(one.event);
          allApplied = allApplied.concat(one.applied || []);
          save = st.getSave(script.id) || save;
          if (opts.onEvent) opts.onEvent(one, generated, minEvents);
        }
      }).then(function (batch) {
        if (!batch.count) {
          if (generated === 0) return Promise.reject(new Error('empty_result'));
          emptyBatchRetries += 1;
          if (emptyBatchRetries >= 4) return Promise.reject(new Error('empty_result'));
          return runNextBatch(true);
        }
        emptyBatchRetries = 0;
        if (generated < minEvents) return runNextBatch(true);
        return null;
      });
    }

    return runNextBatch(false)
      .then(function () {
        if (!generated) return Promise.reject(new Error('empty_result'));
        return generateTurnMeta(script, save, turn, generated);
      })
      .then(function (meta) {
        metaResult = meta || metaResult;
        return {
          events: allEvents,
          applied: allApplied,
          newContacts: metaResult.newContacts || []
        };
      });
  }

  function generatePlayerNarrativeEvents(script, save, playerRequest, opts) {
    opts = opts || {};
    var st = store();
    if (!st || !script || !save) return Promise.reject(new Error('store_missing'));
    var turn = save.turn || 1;
    var count = clampCount(opts.count, 1, 8, 3);
    var ctx = buildFullPlayContext(script, save, { playerIntent: playerRequest });
    var user =
      '【任务】根据玩家追加要求，为本回合第 ' + turn + ' 回合再生成 ' + count + ' 条**新**叙事事件（source=player），勿重复已有事件。\n' +
      '玩家要求：' + String(playerRequest || '').trim() + '\n\n' +
      '【上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      '【输出】{ "events": [...], "roundMemory": "" }';
    return requestAiJson(NARRATIVE_SYSTEM, user).then(function (parsed) {
      var events = Array.isArray(parsed.events) ? parsed.events : [];
      events.forEach(function (ev) { ev.source = 'player'; });
      return applyTurnGenerationResult(script.id, parsed, turn);
    });
  }

  function generateRoundSummary(script, save, opts) {
    opts = opts || {};
    var st = store();
    if (!st || !script || !save) return Promise.reject(new Error('store_missing'));
    var turnEnd = save.turn || 1;
    var turnStart = opts.turnStart != null ? opts.turnStart : Math.max(1, turnEnd);
    var narr = st.ensureNarrative(save);
    var slice = narr.events.filter(function (ev) {
      return ev.turn >= turnStart && ev.turn <= turnEnd;
    });
    var ctx = {
      turnStart: turnStart,
      turnEnd: turnEnd,
      gameTime: st.formatGameTime(save.gameTime),
      player: save.player,
      relationships: st.getNpcs(script.id).map(function (n) { return st.npcForApiContext(n); }),
      events: slice.map(function (ev) {
        return { turn: ev.turn, time: ev.timeLabel, title: ev.title, body: trimCtxText(ev.body, 220) };
      })
    };
    var user =
      '【回合总结·必读】以时间线客观总结第 ' + turnStart + '–' + turnEnd + ' 回合全部叙事事件。\n' +
      '区分玩家与 NPC，保留关键情节、数值/关系/财产变化；150-280字；不要修辞堆砌。\n\n' +
      JSON.stringify(ctx, null, 2) + '\n\n' +
      '只输出 JSON：{ "content": "总结正文", "timeline": ["时间点: 事件", ...] }';
    return requestAiJson(
      '你是人生模拟文游档案员。只输出合法 JSON，含 content 与 timeline 字符串数组。',
      user
    ).then(function (parsed) {
      var content = String(parsed.content || '').trim();
      var timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
      if (timeline.length) {
        content += '\n\n【时间线】\n' + timeline.map(function (t) { return '· ' + t; }).join('\n');
      }
      var row = st.addRoundSummary(script.id, {
        turn: turnStart,
        turnEnd: turnEnd,
        gameTime: st.formatGameTime(save.gameTime),
        content: content,
        required: true,
        auto: !!opts.auto
      });
      return row;
    });
  }

  function normalizeAiContacts(list) {
    if (!Array.isArray(list)) return [];
    var st = store();
    return list.map(function (raw) {
      if (!raw || typeof raw !== 'object') return null;
      var name = String(raw.name || raw.名称 || '').trim();
      if (!name) return null;
      return {
        name: name.slice(0, 24),
        gender: String(raw.gender || raw.性别 || '').slice(0, 12),
        age: raw.age != null ? raw.age : raw.年龄,
        identity: String(raw.identity || raw.role || raw.身份 || '').slice(0, 48),
        occupation: String(raw.occupation || raw.职业 || '').slice(0, 48),
        persona: String(raw.persona || raw.人设 || raw.bio || '').slice(0, 600),
        affinity: raw.affinity != null ? raw.affinity : 0
      };
    }).filter(Boolean);
  }

  function extractContactList(parsed) {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.contacts)) return parsed.contacts;
    if (Array.isArray(parsed.relationships)) return parsed.relationships;
    if (Array.isArray(parsed.npcs)) return parsed.npcs;
    if (parsed.data && Array.isArray(parsed.data.contacts)) return parsed.data.contacts;
    return [];
  }

  function generateRelations(script, save, opts) {
    opts = opts || {};
    var st = store();
    if (!st || !script || !save) return Promise.reject(new Error('store_missing'));
    var count = clampCount(opts.count, 1, 6, 2);
    var ctx = buildPlayContext(script, save);
    var existing = (ctx.relationships || []).map(function (n) { return n.name; }).join('、');
    var user =
      '【任务】根据剧本与当前进度，生成 ' + count + ' 个**新**人际关系角色（勿与已有人物重名）。\n\n' +
      '【剧本与角色上下文】\n' + JSON.stringify(ctx, null, 2) + '\n\n' +
      (existing ? '【已有人际 · 勿重复】' + existing + '\n\n' : '') +
      '【输出格式】只输出 JSON：{ "contacts": [ { "name", "gender", "age", "identity", "occupation", "persona", "affinity" } ] }\n' +
      '- name 2-8字；persona 50-180字人设；affinity -100~100。\n' +
      '- 不要输出 id、avatar。';
    return requestAiJson(
      '你是人生模拟文游角色策划。只输出合法 JSON，含 contacts 数组。',
      user
    ).then(function (parsed) {
      var rows = normalizeAiContacts(extractContactList(parsed));
      if (!rows.length) throw new Error('empty_result');
      var added = st.mergeNewContacts(script.id, rows.slice(0, count), { turn: save.turn || 1 });
      if (!added.length) throw new Error('empty_result');
      return added;
    });
  }

  function formatNarrativeError(err) {
    var code = err && err.message ? String(err.message) : '';
    if (code === 'api_not_configured') return '请先在 API 设置中配置接口';
    if (code === 'parse_failed') return 'AI 返回无法解析，请重试';
    if (code === 'store_missing') return '存档未就绪';
    if (code.indexOf('HTTP') === 0) return '接口失败（' + code + '）';
    return formatPlayGenError(err);
  }

  function fetchModels(override) {
    if (!store()) return Promise.reject(new Error('store_missing'));
    var cred = resolveApiCredentials(override);
    var root = openAiCompatibleApiRoot(cred.baseUrl);
    var apiKey = cred.apiKey;
    if (!cred.baseUrl || !apiKey) return Promise.reject(new Error('missing_credentials'));
    if (!root) return Promise.reject(new Error('invalid_base_url'));
    return fetch(root + '/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey }
    })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var hint = t ? String(t).replace(/\s+/g, ' ').slice(0, 160) : '';
            throw new Error('HTTP ' + r.status + (hint ? ' · ' + hint : ''));
          });
        }
        return r.json();
      })
      .then(function (data) {
        var ids = parseModelsPayload(data);
        if (!ids.length) throw new Error('empty_model_list');
        return ids;
      })
      .catch(function (err) {
        if (err && err.message === 'Failed to fetch') {
          throw new Error('network_or_cors');
        }
        throw err;
      });
  }

  function fetchModelsErrorMessage(err) {
    var code = err && err.message;
    if (code === 'missing_credentials') return '请先填写接口地址与 API Key（无需先点保存）';
    if (code === 'invalid_base_url') return '接口地址格式无效';
    if (code === 'empty_model_list') return '接口未返回模型列表，请检查中转是否支持 GET /v1/models';
    if (code === 'network_or_cors') return '网络或跨域被拦截，请用 http(s) 打开页面或检查代理 CORS';
    if (code === 'api_not_configured') return '请先配置 API';
    return code ? String(code).slice(0, 200) : '拉取失败';
  }

  global.MiyaSimulatorEngine = {
    normalizeBaseUrl: normalizeBaseUrl,
    openAiCompatibleApiRoot: openAiCompatibleApiRoot,
    completeScriptDraft: completeScriptDraft,
    completeScriptModule: completeScriptModule,
    buildPlayContext: buildPlayContext,
    generateSkills: generateSkills,
    generateTalents: generateTalents,
    generateConfigSkills: generateConfigSkills,
    generateConfigTalents: generateConfigTalents,
    buildEditorContext: buildEditorContext,
    formatPlayGenError: formatPlayGenError,
    fetchModels: fetchModels,
    fetchModelsErrorMessage: fetchModelsErrorMessage,
    mergeAiComplete: mergeAiComplete,
    buildFullPlayContext: buildFullPlayContext,
    generateTurnNarrative: generateTurnNarrative,
    generatePlayerNarrativeEvents: generatePlayerNarrativeEvents,
    generateRoundSummary: generateRoundSummary,
    generateRelations: generateRelations,
    formatNarrativeError: formatNarrativeError
  };
})(window);
