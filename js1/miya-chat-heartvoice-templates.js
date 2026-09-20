/**
 * Miya 自定义心声模版 · 预设库（装扮与表情编辑）+ 各聊天选用
 */
(function (global) {
  'use strict';

  var PRESETS_LS = 'miya-chat-heartvoice-presets-v1';
  var presetsCache = null;
  var presetsReady = null;

  var DRAFT_KEY = 'miya-chat-heartvoice-draft-v1';

  var EXAMPLE_CUSTOM_PROMPT =
    '每次正文输出结束后必须按照以下要求输出心声！先输出「对话」（一句温柔的话），后输出「心声」（用括号写真实想法），再输出「动作」（一个温柔的肢体动作）；每项独占一行，行首写字段名，再用短横线接内容。只输出纯文本，不要写 HTML、样式或解释说明。';

  var TUTORIAL_TXT =
    '自定义心声完整教程\n' +
    '====================\n' +
    '\n' +
    '这个功能能做什么？\n' +
    '--------------------\n' +
    '你可以自己决定 AI 伴侣的心声「说什么」（纯文本字段）和「长什么样」（HTML 模板本地渲染）。\n' +
    'AI 只输出字段文字，不会输出 HTML；页面自动把文字套进你的模板显示。\n' +
    '\n' +
    '核心概念（只记三样）\n' +
    '--------------------\n' +
    '1. 自定义提示词：告诉 AI 怎么写心声（最重要，会替换默认心声说明）\n' +
    '2. 输出字段：字段名给 HTML 占位用；「输出要求」会接在提示词后面注入，写细一点更好\n' +
    '3. HTML 模板：用 {{字段名}} 占位，系统把 AI 的纯文本填进去并展示\n' +
    '\n' +
    '工作流程\n' +
    '--------------------\n' +
    '你发消息\n' +
    '  → AI 按「自定义提示词 + 字段说明」输出纯文本心声（包在 miyavoice 里）\n' +
    '  → 系统解析各字段文字\n' +
    '  → 页面把文字套进 HTML 模板\n' +
    '  → 点对方头像打开心声面板查看效果\n' +
    '\n' +
    '────────────────────\n' +
    '30 秒快速上手\n' +
    '────────────────────\n' +
    '第1步：打开「装扮与表情」→「自定义心声」\n' +
    '第2步：点「加载示例」（会填好提示词、字段、模板）\n' +
    '第3步：点「保存为预设」，起个名字\n' +
    '第4步：进入某个单聊 → 聊天设置 →「对话表现」→「心声模版」选刚保存的预设并保存\n' +
    '第5步：正常聊天后，点对方头像看自定义心声效果\n' +
    '\n' +
    '────────────────────\n' +
    '各部分怎么填\n' +
    '────────────────────\n' +
    '\n' +
    '【一、自定义提示词】（优先注入，作用最大）\n' +
    '作用：替换默认心声那一段提示，用你的话告诉 AI「先输出什么、后输出什么、语气怎样」。\n' +
    '建议写法：\n' +
    '· 写清顺序：先…后…再…\n' +
    '· 写清格式：每项一行，行首字段名，短横线接内容\n' +
    '· 强调只要纯文本，不要 HTML\n' +
    '示例：\n' +
    '每次正文输出结束后必须按照以下要求输出心声！先输出「对话」（一句温柔的话），后输出「心声」（用括号写真实想法），再输出「动作」（一个温柔的肢体动作）；每项独占一行，行首写字段名，再用短横线接内容。只输出纯文本，不要写 HTML、样式或解释说明。\n' +
    '\n' +
    '【二、输出字段】\n' +
    '作用：\n' +
    '· 字段名 = HTML 里 {{字段名}} 的占位符，也是 AI 行首标签\n' +
    '· 输出要求 = 该字段的详细说明，会接在自定义提示词后面注入\n' +
    '规则：\n' +
    '· 字段名可用中文，不要重复，不要带空格\n' +
    '· 输出要求越具体越好（语气、长度、格式限制）\n' +
    '示例：\n' +
    '  字段名：对话　输出要求：用温柔的语气说一句话，只写这句话本身\n' +
    '  字段名：心声　输出要求：用括号表达内心想法，只写想法本身\n' +
    '  字段名：动作　输出要求：描述一个温柔的动作，只写动作本身\n' +
    '操作：点「＋ 添加字段」增加；点字段右上角 ✕ 删除（至少留 1 个）\n' +
    '建议：3～5 个字段最合适；字段越多 token 越多。\n' +
    '\n' +
    '【三、HTML 模板】（只给页面用，AI 看不到也不会输出）\n' +
    '作用：决定心声面板里长什么样。\n' +
    '占位符：{{字段名}} 必须和字段名完全一致（不能少括号、不能多空格）。\n' +
    '正确：{{对话}}　　错误：{{聊天}} / {对话} / {{ 对话 }}\n' +
    '可用：完整 HTML / CSS / JavaScript（含 button、input、svg、onclick等交互）。\n' +
    '模板在独立预览框中完整执行脚本；点头像打开心声时同样完整可交互。\n' +
    '可直接粘贴整页 HTML（含 <!DOCTYPE html>），也可只写片段。\n' +
    '\n' +
    '最简单模板：\n' +
    '<div>{{对话}}</div>\n' +
    '\n' +
    '加颜色示例：\n' +
    '<div style="color:#1c1c1e;font-size:20px;">💬 {{对话}}</div>\n' +
    '<div style="color:#8e8e93;font-size:15px;margin-top:8px;">💭 {{心声}}</div>\n' +
    '<div style="color:#aeaeb2;font-size:13px;margin-top:6px;">✨ {{动作}}</div>\n' +
    '\n' +
    '【三·附、系统占位符·当前聊天头像】（不用建字段，AI 也不会输出）\n' +
    '打开心声面板时，系统会自动把「当前这对聊天」的头像 URL 填进模板。\n' +
    '直接写在 HTML 里即可：\n' +
    '  {{char头像}}  → 角色（对方）当前头像\n' +
    '  {{user头像}}  → 用户（你的面具）当前头像\n' +
    '同义写法（效果相同）：{{角色头像}} / {{用户头像}} / {{char_avatar}} / {{user_avatar}}\n' +
    '\n' +
    '示例（双人头像）：\n' +
    '<div style="display:flex;gap:12px;align-items:center;">\n' +
    '  <img src="{{char头像}}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">\n' +
    '  <img src="{{user头像}}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">\n' +
    '</div>\n' +
    '<div>{{对话}}</div>\n' +
    '\n' +
    '注意：\n' +
    '· 请用双引号写 src="{{char头像}}"，不要用单引号。\n' +
    '· 不要把「char头像 / user头像」建成输出字段（系统保留名）；字段只管 AI 写的文字。\n' +
    '· 编辑页预览会尽量用当前面具头像；角色头像在预览里可能是占位图，进聊天点头像打开才是真实双方头像。\n' +
    '\n' +
    '【四、预览样例文字】\n' +
    '作用：本地假数据预览模板效果，不会发给 AI。改字段旁的预览输入框即可实时刷新。\n' +
    '\n' +
    '【五、预设库】\n' +
    '· 保存为预设：把「提示词 + 字段 + HTML」整套存起来\n' +
    '· 读取预设：覆盖当前编辑区\n' +
    '· 删除预设：从库中移除（已选用该预设的聊天会回退系统默认）\n' +
    '· 保存草稿：只存本页编辑进度，不等于预设\n' +
    '\n' +
    '────────────────────\n' +
    '在单聊里启用\n' +
    '────────────────────\n' +
    '1. 打开该联系人聊天 → 右上角更多 → 聊天设置\n' +
    '2. 找到「对话表现」→「心声模版」\n' +
    '3. 选你的预设（「系统默认」= 原来的好感度四行）\n' +
    '4. 保存设置后继续聊天即可生效\n' +
    '\n' +
    '────────────────────\n' +
    'AI 实际会输出什么样（纯文本）\n' +
    '────────────────────\n' +
    '<miyavoice>\n' +
    '对话-今天好想你呀～\n' +
    '心声-（她主动找我了...好开心）\n' +
    '动作-开心地晃了晃脑袋\n' +
    '</miyavoice>\n' +
    '\n' +
    '你在面板里看到的，是上面文字套进 HTML 模板后的样子。\n' +
    '\n' +
    '────────────────────\n' +
    '字段怎么写才能被正确解析\n' +
    '────────────────────\n' +
    '基本规则：每个字段开头必须单独占一行。\n' +
    '\n' +
    '正确示例：\n' +
    'voice1-第一行内容\n' +
    '续写第二行\n' +
    '续写第三行\n' +
    'voice2-下一项\n' +
    '\n' +
    '规则说明：\n' +
    '1. 开新字段 → 必须单独一行：字段名-内容（半角/全角短横线或冒号均可）\n' +
    '2. 同一字段要写多行 → 后面几行不要再写字段名；系统会自动并进当前字段，并填入 HTML 的 {{字段名}}\n' +
    '3. 不能把两个字段挤在同一行（错误示例：voice1-aaa voice2-bbb），否则解析会乱\n' +
    '\n' +
    '所以不是「每一行文字都必须是新字段」，而是：换字段时必须换行起头写字段名；一个字段内部可以分行。\n' +
    '在自定义提示词里也建议写明这套多行写法，减少模型写错格式。\n' +
    '\n' +
    '────────────────────\n' +
    '常见问题\n' +
    '────────────────────\n' +
    'Q：占位符没被替换？\n' +
    'A：检查 {{字段名}} 是否与字段名完全一致。头像请用 {{char头像}} / {{user头像}}（系统注入，无需建字段）。\n' +
    '\n' +
    'Q：HTML 里怎么显示双方头像？\n' +
    'A：写 <img src="{{char头像}}"> 和 <img src="{{user头像}}">，点头像打开心声面板时会填入当前聊天双方头像。\n' +
    '\n' +
    'Q：字段必须一行一项吗？多行写不进去？\n' +
    'A：换字段必须换行写「字段名-」；同一字段可以接着写多行（不要重复字段名），系统会拼进该字段。\n' +
    '\n' +
    'Q：AI 输出多了废话？\n' +
    'A：在自定义提示词和字段「输出要求」里写死「只输出…不要解释」。\n' +
    '\n' +
    'Q：改完没变化？\n' +
    'A：确认已「保存为预设」；聊天设置里已选中该预设并保存；新回复后才看得到（旧记录用当时快照）。\n' +
    '\n' +
    'Q：要自己写 miyavoice 吗？\n' +
    'A：不用。系统会强制要求包裹；你把精力放在自定义提示词和字段上即可。\n' +
    '\n' +
    'Q：HTML 写在提示词里给 AI 吗？\n' +
    'A：不要。HTML 只填在「HTML 模板」；提示词里明确说「只输出纯文本」。\n' +
    '\n' +
    '记住一句话：\n' +
    '自定义提示词决定 AI 怎么写；字段名决定占位与行标签；HTML 模板决定长什么样；{{char头像}}/{{user头像}} 显示当前聊天双方头像。\n';

  var EXAMPLE_GENTLE = {
    name: '温柔女友风',
    customPrompt: EXAMPLE_CUSTOM_PROMPT,
    fields: [
      { name: '对话', requirement: '用温柔的语气说一句话，只写这句话本身' },
      { name: '心声', requirement: '用括号表达内心想法，只写想法本身' },
      { name: '动作', requirement: '描述一个温柔的动作，只写动作本身' }
    ],
    htmlTemplate:
      '<div style="background:#fff5f5;border-radius:16px;padding:24px;border:1px solid #ffd9d9;max-width:320px;">' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">' +
      '<img src="{{char头像}}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #ffd9d9;">' +
      '<img src="{{user头像}}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;opacity:.9;">' +
      '</div>' +
      '<div style="font-size:22px;color:#c0392b;">💬 {{对话}}</div>' +
      '<div style="color:#e74c3c;font-style:italic;margin-top:12px;padding-left:16px;border-left:3px solid #e74c3c;">💭 {{心声}}</div>' +
      '<div style="color:#f39c12;font-size:14px;margin-top:8px;">✨ {{动作}}</div>' +
      '</div>',
    sampleValues: {
      对话: '今天好想你呀～',
      心声: '（她主动找我了...好开心）',
      动作: '开心地晃了晃脑袋'
    }
  };

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaChatApp && global.miyaChatApp.toast) {
      global.miyaChatApp.toast(msg);
      return;
    }
    if (global.miyaSettingsApp && global.miyaSettingsApp.toast) {
      global.miyaSettingsApp.toast(msg);
      return;
    }
    var el = document.createElement('div');
    el.className = 'ins-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 2400);
  }

  function promptFn(opts) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(
      prompt((opts.message || '') + '\n' + (opts.placeholder || ''), opts.defaultValue || '')
    );
  }

  function confirmFn(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(confirm(opts.message || '确定？'));
  }

  function normalizeField(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim();
    if (!name || isSystemAvatarKey(name)) return null;
    return {
      name: name.slice(0, 40),
      requirement: String(raw.requirement || '').trim().slice(0, 4000)
    };
  }

  function normalizePresetRow(raw) {
    if (!raw || !raw.name) return null;
    var fields = Array.isArray(raw.fields)
      ? raw.fields.map(normalizeField).filter(Boolean)
      : [];
    if (!fields.length) return null;
    var seen = {};
    fields = fields.filter(function (f) {
      if (seen[f.name]) return false;
      seen[f.name] = true;
      return true;
    });
    return {
      name: String(raw.name).trim().slice(0, 60),
      customPrompt: String(raw.customPrompt || '').trim().slice(0, 50000),
      fields: fields,
      htmlTemplate: String(raw.htmlTemplate || '').slice(0, 200000),
      savedAt: raw.savedAt || Date.now()
    };
  }

  function hydratePresetsSync() {
    if (presetsCache) return presetsCache;
    var raw = null;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      raw = global.miyaSyncReadJsonKey(PRESETS_LS);
    }
    if (!Array.isArray(raw)) {
      try {
        var ls = localStorage.getItem(PRESETS_LS);
        if (ls) raw = JSON.parse(ls);
      } catch (eLs) {
        raw = null;
      }
    }
    if (Array.isArray(raw)) {
      presetsCache = raw.map(normalizePresetRow).filter(Boolean);
      return presetsCache;
    }
    return null;
  }

  function normalizePresetSnapshot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var row = normalizePresetRow(
      Object.assign({}, raw, { name: String(raw.name || raw.presetName || 'preset').trim() || 'preset' })
    );
    return row;
  }

  function resolvePresetName(chatSettings) {
    return normalizeChatPresetName(chatSettings && chatSettings.heartVoicePreset);
  }

  function resolvePresetForChat(chatSettings) {
    hydratePresetsSync();
    var name = resolvePresetName(chatSettings);
    if (!name) return null;
    /* 优先用预设库最新版（改提示词后立刻生效）；库里没有再回退聊天快照 */
    var live = findPreset(name);
    if (live) return live;
    var snap = chatSettings && chatSettings.heartVoicePresetSnapshot;
    if (snap && typeof snap === 'object') {
      var snapName = String(snap.name || snap.presetName || '').trim();
      if (!snapName || snapName === name) {
        var fromSnap = normalizePresetSnapshot(Object.assign({}, snap, { name: name }));
        if (fromSnap) return fromSnap;
      }
    }
    return null;
  }

  function buildSnapshotFromPreset(preset) {
    if (!preset) return null;
    var row = normalizePresetRow(preset);
    if (!row) return null;
    return {
      name: row.name,
      customPrompt: row.customPrompt,
      fields: row.fields,
      htmlTemplate: row.htmlTemplate,
      savedAt: row.savedAt || Date.now()
    };
  }

  function whenPresetsReady() {
    if (presetsReady) return presetsReady;
    var chain =
      typeof global.miyaReadLsJsonKey === 'function'
        ? global.miyaReadLsJsonKey(PRESETS_LS, [])
        : Promise.resolve([]);
    presetsReady = chain
      .then(function (parsed) {
        if (!Array.isArray(parsed)) parsed = [];
        presetsCache = parsed.map(normalizePresetRow).filter(Boolean);
        return presetsCache.slice();
      })
      .catch(function () {
        presetsCache = [];
        return [];
      });
    return presetsReady;
  }

  function loadPresets() {
    var hydrated = hydratePresetsSync();
    if (hydrated) return hydrated.slice();
    return [];
  }

  function persistPresets(list) {
    presetsCache = Array.isArray(list) ? list.slice() : [];
    presetsReady = null;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(PRESETS_LS, presetsCache).then(function () {
        return presetsCache.slice();
      });
    }
    try {
      localStorage.setItem(PRESETS_LS, JSON.stringify(presetsCache));
    } catch (e) {}
    return Promise.resolve(presetsCache.slice());
  }

  function findPreset(name) {
    var label = String(name || '').trim();
    if (!label) return null;
    return loadPresets().find(function (p) {
      return p.name === label;
    }) || null;
  }

  function savePreset(name, state) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    var row = normalizePresetRow(
      Object.assign({ name: label, savedAt: Date.now() }, state || {})
    );
    if (!row) return Promise.reject(new Error('invalid_preset'));
    return whenPresetsReady().then(function (list) {
      var next = list.filter(function (p) {
        return p.name !== label;
      });
      next.unshift(row);
      return persistPresets(next).then(function () {
        var saved = findPreset(label);
        /* 同步刷新已选用该预设的聊天快照，避免旧 snapshot 盖住新提示词 */
        try {
          var store = global.miyaChatStore;
          var snap = buildSnapshotFromPreset(saved);
          if (
            store &&
            snap &&
            typeof store.getChats === 'function' &&
            typeof store.getChatSettings === 'function' &&
            typeof store.saveChatSettings === 'function'
          ) {
            var chats = store.getChats('all') || [];
            chats.forEach(function (ch) {
              if (!ch || !ch.id) return;
              var s = store.getChatSettings(ch.id);
              if (!s || String(s.heartVoicePreset || '').trim() !== label) return;
              store.saveChatSettings(ch.id, { heartVoicePresetSnapshot: snap });
            });
          }
        } catch (eSync) {}
        return saved;
      });
    });
  }

  function deletePreset(name) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    return whenPresetsReady().then(function (list) {
      var next = list.filter(function (p) {
        return p.name !== label;
      });
      if (next.length === list.length) return Promise.reject(new Error('not_found'));
      return persistPresets(next);
    });
  }

  function normalizeChatPresetName(raw) {
    return String(raw || '').trim();
  }

  function getFieldNames(preset) {
    if (!preset || !Array.isArray(preset.fields)) return [];
    return preset.fields.map(function (f) {
      return f.name;
    });
  }

  /**
   * 自定义心声允许完整交互 HTML（脚本/按钮/表单/svg/事件等）。
   * 模板为用户自写预设，不再剥标签；仅保留函数名以兼容旧调用。
   */
  function sanitizeHtmlTemplate(html) {
    return String(html == null ? '' : html);
  }

  function escapeFieldValue(v) {
    return esc(String(v == null ? '' : v));
  }

  /** 系统保留占位：当前聊天 char / user 头像 URL（多别名同一值） */
  var SYSTEM_AVATAR_KEYS = {
    char头像: 'charAvatar',
    角色头像: 'charAvatar',
    char_avatar: 'charAvatar',
    user头像: 'userAvatar',
    用户头像: 'userAvatar',
    user_avatar: 'userAvatar'
  };

  function isSystemAvatarKey(name) {
    return Object.prototype.hasOwnProperty.call(SYSTEM_AVATAR_KEYS, String(name || '').trim());
  }

  function buildSystemPlaceholderMap(ctx) {
    ctx = ctx && typeof ctx === 'object' ? ctx : {};
    var charAva = String(ctx.charAvatar != null ? ctx.charAvatar : ctx.avatarUrl || '');
    var userAva = String(ctx.userAvatar != null ? ctx.userAvatar : '');
    var out = {};
    Object.keys(SYSTEM_AVATAR_KEYS).forEach(function (alias) {
      var kind = SYSTEM_AVATAR_KEYS[alias];
      out[alias] = kind === 'userAvatar' ? userAva : charAva;
    });
    return out;
  }

  /**
   * 将 {{字段名}} / {{char头像}} / {{user头像}} 替换进模板。
   * fieldsMap：AI 字段纯文本；ctx：系统头像等（保留名优先，不被字段覆盖）。
   */
  function renderTemplate(htmlTemplate, fieldsMap, ctx) {
    var map = fieldsMap && typeof fieldsMap === 'object' ? fieldsMap : {};
    var sys = buildSystemPlaceholderMap(ctx);
    var src = sanitizeHtmlTemplate(htmlTemplate);
    return src.replace(/\{\{([^{}]+)\}\}/g, function (_, rawName) {
      var key = String(rawName || '').trim();
      if (!key) return '';
      if (Object.prototype.hasOwnProperty.call(sys, key)) {
        return escapeFieldValue(sys[key]);
      }
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        return escapeFieldValue(map[key]);
      }
      return '';
    });
  }

  function avatarFallbackDataUrl(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return (
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
          '<rect width="80" height="80" rx="40" fill="#ece8e1"/>' +
          '<text x="40" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#9a948a">' +
          ch +
          '</text></svg>'
      )
    );
  }

  function isPlaceholderAva(url) {
    return !url || String(url).indexOf('data:image/svg+xml') === 0;
  }

  /** 编辑预览用：尽量取当前面具 / 当前打开聊天的头像 */
  function resolveEditorAvatarContext(done) {
    var store = global.miyaChatStore;
    var room = global.miyaChatRoom;
    var charAva = avatarFallbackDataUrl('TA');
    var userAva = avatarFallbackDataUrl('我');
    var pending = 2;

    function finishOne() {
      pending -= 1;
      if (pending > 0) return;
      if (typeof done === 'function') {
        done({ charAvatar: charAva, userAvatar: userAva });
      }
    }

    function resolveUser() {
      var profile = store && store.getActiveProfile ? store.getActiveProfile() : null;
      if (!profile || !store) {
        finishOne();
        return;
      }
      if (typeof store.resolveProfileDisplayAvatarSync === 'function') {
        var sync = store.resolveProfileDisplayAvatarSync(profile);
        if (sync) userAva = sync;
      }
      if (
        isPlaceholderAva(userAva) &&
        store.hasProfileDisplayAvatarOverride &&
        store.hasProfileDisplayAvatarOverride(profile) &&
        typeof store.resolveProfileDisplayAvatarAsync === 'function'
      ) {
        store
          .resolveProfileDisplayAvatarAsync(profile)
          .then(function (url) {
            if (url) userAva = url;
            finishOne();
          })
          .catch(function () {
            finishOne();
          });
        return;
      }
      if (isPlaceholderAva(userAva) && profile.avatarId && store.getAvatarUrl) {
        store
          .getAvatarUrl(profile.avatarId)
          .then(function (url) {
            if (url) userAva = url;
            finishOne();
          })
          .catch(function () {
            finishOne();
          });
        return;
      }
      finishOne();
    }

    function resolveChar() {
      var chatId =
        room && typeof room.getOpenChatId === 'function' ? room.getOpenChatId() : '';
      var contact = null;
      if (chatId && store && store.findChat && store.findContact) {
        var chat = store.findChat(chatId);
        if (chat && chat.contactId) contact = store.findContact(chat.contactId);
      }
      if (!contact || !store) {
        finishOne();
        return;
      }
      if (typeof store.resolveContactDisplayAvatarSync === 'function') {
        var sync = store.resolveContactDisplayAvatarSync(contact);
        if (sync) charAva = sync;
      }
      var direct = String(contact.avatar || '').trim();
      if (direct) charAva = direct;
      if (
        isPlaceholderAva(charAva) &&
        store.hasContactDisplayAvatarOverride &&
        store.hasContactDisplayAvatarOverride(contact) &&
        typeof store.resolveContactDisplayAvatarAsync === 'function'
      ) {
        store
          .resolveContactDisplayAvatarAsync(contact)
          .then(function (url) {
            if (url) charAva = url;
            finishOne();
          })
          .catch(function () {
            finishOne();
          });
        return;
      }
      if (isPlaceholderAva(charAva) && contact.avatarBlobId && store.getAvatarUrl) {
        store
          .getAvatarUrl(contact.avatarBlobId)
          .then(function (url) {
            if (url) charAva = url;
            finishOne();
          })
          .catch(function () {
            finishOne();
          });
        return;
      }
      finishOne();
    }

    resolveUser();
    resolveChar();
  }

  function isFullHtmlDocument(html) {
    return /^\s*(<!doctype\s+html\b|<html[\s>])/i.test(String(html || ''));
  }

  /** 片段补成可独立执行的完整文档，整页 HTML 原样保留 */
  function buildInteractiveDocument(html) {
    var src = String(html || '');
    if (!src.trim()) {
      return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
      );
    }
    if (isFullHtmlDocument(src)) return src;
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;padding:0;background:transparent;}</style>' +
      '</head><body>' +
      src +
      '</body></html>'
    );
  }

  /**
   * 用 iframe+srcdoc 挂载，脚本/按钮/翻页等交互可完整执行；
   * 事件留在框内，不与心声面板关闭/历史点击冲突。
   */
  function mountInteractiveHtml(container, html, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!container) return null;
    container.innerHTML = '';
    var frame = document.createElement('iframe');
    frame.className = opts.frameClass || 'mc-hv__interactive-frame';
    frame.setAttribute('title', opts.title || '自定义心声');
    /* 不设 sandbox：用户自写模版需完整执行 script / 翻页 / 表单等交互 */
    frame.setAttribute('allow', 'autoplay; clipboard-write; fullscreen');
    frame.srcdoc = buildInteractiveDocument(html);
    container.appendChild(frame);
    return frame;
  }

  /** 非 iframe 场景：innerHTML 后重建 script 节点以执行 */
  function activateInteractiveHtml(root) {
    if (!root) return;
    var scripts = root.querySelectorAll('script');
    Array.prototype.slice.call(scripts).forEach(function (old) {
      var s = document.createElement('script');
      Array.prototype.slice.call(old.attributes || []).forEach(function (attr) {
        try {
          s.setAttribute(attr.name, attr.value);
        } catch (e) {}
      });
      if (old.textContent) s.text = old.textContent;
      if (old.parentNode) old.parentNode.replaceChild(s, old);
    });
  }

  function buildHeartVoiceRulesFromPreset(roleName, preset) {
    var rn = String(roleName || '').trim() || '角色';
    if (!preset || !Array.isArray(preset.fields) || !preset.fields.length) return '';
    var n = preset.fields.length;
    var customPrompt = String(preset.customPrompt || '').trim();
    /* 固定壳：包裹标签 + 纯文本字段；自定义提示词为主，字段说明辅 */
    var lines = [
      '【线上格式规则·心声·' + rn + '】',
      '【强制·完整 miyavoice】必须按照要求完整输出 <miyavoice>...</miyavoice> 模块：开闭标签均必填；段内须写满下方全部 ' +
        n +
        ' 个字段，禁止省略、禁止截断、禁止写到一半就结束、禁止用「略」「同上」「……」敷衍。系统不会替你补全缺失字段。',
      '心声为每轮输出的第三段，须单独包裹在 <miyavoice>...</miyavoice> 内；禁止写入 <thinking> 或正文气泡行。',
      '心声段内只输出纯文本字段行（字段名-内容），禁止输出 HTML、CSS、标签、模板代码或其它非字段内容；页面展示由系统用 HTML 模板自动渲染。',
      '输出长度不受「写短一点」约束：字段内容该多长就写多长，须写完所有字段后再闭合 </miyavoice>。',
      '【多行字段写法】同一字段若有多行：第一行写「字段名-第一行内容」，其后各行直接写正文（不要再写字段名）；系统会自动拼进该字段并填入 HTML 的 {{字段名}}。写到下一字段名时再换字段。示例：\nvoice1-第一行心声\n第二行继续\n第三行继续\nvoice2-下一项待办'
    ];
    if (customPrompt) {
      lines.push('【自定义心声要求·须优先遵守】');
      lines.push(customPrompt);
    }
    lines.push(
      '【字段说明·须全部输出】以下 ' +
        n +
        ' 行每行一项，换行分隔；行首标签必须与字段名完全一致，用半角或全角短横线/冒号连接纯文本内容：'
    );
    preset.fields.forEach(function (f) {
      var req = String(f.requirement || '').trim() || '按人设与当下情境填写本字段内容';
      lines.push(f.name + '-' + req);
    });
    lines.push(
      '禁止省略任一字段；禁止把这些字段行写进正文气泡。发出前自检：字段开头数量是否等于 ' +
        n +
        '；若不足必须补全后再结束。'
    );
    lines.push(
      '若系统另行注入「上一轮心声」，本轮须对照更新，禁止输出重复/相同的心声（各字段均不得与前一轮雷同）。'
    );
    return lines.join('\n');
  }

  function buildExampleMiyavoiceLines(preset) {
    if (!preset || !Array.isArray(preset.fields)) return [];
    var samples = EXAMPLE_GENTLE.sampleValues || {};
    return preset.fields.map(function (f, i) {
      var sample =
        samples[f.name] ||
        (i === 0 ? '今天也好想你呀～' : i === 1 ? '（心里软软的）' : '轻轻点了点头');
      return f.name + '-' + sample;
    });
  }

  /** 旧运转规则/提示词里若仍写死默认四行 → 剥掉并改为只服从「线上格式规则·心声」 */
  function rewriteDefaultHeartVoiceMentions(text) {
    var src = String(text || '');
    if (!src) return src;
    var replacement =
      '每轮末尾必须按照要求完整输出 <miyavoice> 心声段，须严格按当前「线上格式规则·心声」中定义的字段逐行写满（字段名与行数以该规则为准），禁止省略、禁止截断、禁止写到一半就结束；心声字段行不得出现在正文气泡里';
    src = src.replace(
      /每轮末尾必须(?:按照要求完整)?输出\s*<miyavoice>\s*心声段（好感度、欲望值、行为动作、角色心声四行）[^。\n]*[。]?/g,
      replacement + '。'
    );
    src = src.replace(
      /每轮末尾必须(?:按照要求完整)?输出\s*<miyavoice>\s*心声段[^。\n]*好感度[^。\n]*欲望值[^。\n]*[。]?/g,
      replacement + '。'
    );
    src = src.replace(
      /「角色心声」行须写足\s*40\s*字以上（指内心独白，非行为动作）/g,
      '各字段内容须符合「线上格式规则·心声」中的输出要求'
    );
    src = src.replace(
      /好感度、欲望值、行为动作、角色心声四行/g,
      '「线上格式规则·心声」中的全部字段'
    );
    src = src.replace(
      /好感度[、,]\s*欲望值[、,]\s*行为动作[、,]\s*角色心声/g,
      '当前心声规则中的各字段'
    );
    src = src.replace(/<miyavoice>\s*行为动作也不得与近几轮雷同/g, '<miyavoice> 各字段也不得与近几轮雷同');
    src = src.replace(/心声四行不得出现在正文气泡里/g, '心声字段行不得出现在正文气泡里');
    /* 自定义启用时：删掉仍残留的默认四行字段示例行 */
    src = src.replace(/^\s*好感度-数值[^\n]*$/gm, '');
    src = src.replace(/^\s*欲望值-数值[^\n]*$/gm, '');
    src = src.replace(/^\s*行为动作-[^\n]*$/gm, '');
    src = src.replace(/^\s*角色心声-[^\n]*$/gm, '');
    src = src.replace(/\n{3,}/g, '\n\n');
    return src;
  }

  /** 置末：自定义心声提示词覆盖默认；此聊天不得再使用默认四行 */
  function buildCustomHeartVoicePriorityBlock(roleName, preset) {
    if (!preset || !Array.isArray(preset.fields) || !preset.fields.length) return '';
    var rn = String(roleName || '').trim() || '角色';
    var n = preset.fields.length;
    var names = preset.fields
      .map(function (f) {
        return f && f.name ? String(f.name) : '';
      })
      .filter(Boolean)
      .join(' / ');
    var lines = [
      '【本轮心声·仅自定义·禁用默认四行·' + rn + '】',
      '本聊天已启用自定义心声预设「' + String(preset.name || '自定义') + '」。',
      '默认四行（好感度/欲望值/行为动作/角色心声）对本聊天无效，禁止输出。',
      '必须按照要求完整输出 <miyavoice>...</miyavoice>：开闭标签必填；只写自定义字段。',
      '须按字段名原样写满全部 ' + n + ' 个字段：' + names,
      '缺字段、截断、偷懒均视为失败；写完所有字段后再闭合 </miyavoice>。'
    ];
    var customPrompt = String(preset.customPrompt || '').trim();
    if (customPrompt) {
      lines.push('【自定义心声提示词·覆盖默认·须严格执行】');
      lines.push(customPrompt);
    }
    return lines.join('\n');
  }

  function formatCustomSnapshotLines(entry) {
    if (!entry || typeof entry !== 'object') return '';
    var fields = entry.fields && typeof entry.fields === 'object' ? entry.fields : null;
    if (!fields) return '';
    var lines = [];
    Object.keys(fields).forEach(function (k) {
      var v = String(fields[k] == null ? '' : fields[k]).trim();
      if (v) lines.push(k + '-' + v);
    });
    return lines.join('\n');
  }

  function isCustomEntry(entry) {
    return !!(
      entry &&
      (entry.mode === 'custom' ||
        (entry.fields && typeof entry.fields === 'object' && Object.keys(entry.fields).length > 0) ||
        (entry.htmlTemplate && entry.fields && typeof entry.fields === 'object'))
    );
  }

  function previewTextFromEntry(entry) {
    if (!entry) return '';
    if (isCustomEntry(entry) && entry.fields) {
      var keys = Object.keys(entry.fields);
      var i;
      for (i = 0; i < keys.length; i++) {
        var t = String(entry.fields[keys[i]] || '').trim();
        if (t) return t;
      }
      return '自定义心声';
    }
    return String(entry.monologue || entry.action || '').trim();
  }

  /* ── Chat settings picker ── */

  function buildPresetSelectOptions(selectedName, includeDefault) {
    var html =
      includeDefault !== false
        ? '<option value="">' +
          esc(includeDefault === 'settings' ? '选择预设' : '系统默认') +
          '</option>'
        : '';
    loadPresets().forEach(function (p) {
      html +=
        '<option value="' +
        esc(p.name) +
        '"' +
        (p.name === selectedName ? ' selected' : '') +
        '>' +
        esc(p.name) +
        '</option>';
    });
    return html;
  }

  function refreshPresetSelect(root, selectedName, selector) {
    var sel = root && root.querySelector(selector || '[data-mq-hv-tpl-preset-pick]');
    if (!sel) return;
    var includeDefault = sel.getAttribute('data-mq-hv-tpl-include-default');
    sel.innerHTML = buildPresetSelectOptions(selectedName, includeDefault || true);
  }

  function buildChatSettingsPickerHtml(selectedName) {
    var preset = normalizeChatPresetName(selectedName);
    return (
      '<div class="mi-oprules-pick">' +
      '<div class="mi-oprules-pick__head">' +
      '<span class="mi-oprules-pick__kicker">Heart Voice</span>' +
      '<span class="mi-oprules-pick__label">心声模版</span>' +
      '</div>' +
      '<div class="mi-oprules-pick__field">' +
      '<select class="mi-oprules-pick__select" data-mq-set-hv-tpl-preset data-mq-hv-tpl-include-default="chat">' +
      buildPresetSelectOptions(preset, true) +
      '</select>' +
      '</div>' +
      '<p class="st-form-hint" style="margin-top:8px;">选「系统默认」用内置四行心声；选自定义预设后将注入你的自定义提示词与字段说明（AI 只输出纯文本，HTML 本地渲染）。</p>' +
      '</div>'
    );
  }

  function readChatPresetFromRoot(root, base) {
    var sel = root && root.querySelector('[data-mq-set-hv-tpl-preset]');
    if (!sel) return normalizeChatPresetName(base);
    return String(sel.value || '').trim();
  }

  function syncChatPresetSelect(root, storedName) {
    if (!root) return;
    var sel = root.querySelector('[data-mq-set-hv-tpl-preset]');
    if (!sel) return;
    var stored = normalizeChatPresetName(storedName);
    refreshPresetSelect(root, stored, '[data-mq-set-hv-tpl-preset]');
    if (stored) sel.value = stored;
  }

  /* ── Editor UI ── */

  function defaultDraft() {
    return {
      customPrompt: EXAMPLE_GENTLE.customPrompt || EXAMPLE_CUSTOM_PROMPT,
      fields: EXAMPLE_GENTLE.fields.map(function (f) {
        return { name: f.name, requirement: f.requirement };
      }),
      htmlTemplate: EXAMPLE_GENTLE.htmlTemplate,
      sampleValues: Object.assign({}, EXAMPLE_GENTLE.sampleValues),
      presetPick: ''
    };
  }

  function loadDraft() {
    try {
      var raw =
        typeof global.miyaSyncReadJsonKey === 'function'
          ? global.miyaSyncReadJsonKey(DRAFT_KEY)
          : JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return defaultDraft();
      var fields = Array.isArray(raw.fields)
        ? raw.fields.map(normalizeField).filter(Boolean)
        : [];
      if (!fields.length) return defaultDraft();
      return {
        customPrompt: String(raw.customPrompt || ''),
        fields: fields,
        htmlTemplate: String(raw.htmlTemplate || ''),
        sampleValues:
          raw.sampleValues && typeof raw.sampleValues === 'object' ? raw.sampleValues : {},
        presetPick: String(raw.presetPick || '')
      };
    } catch (e) {
      return defaultDraft();
    }
  }

  function persistDraft(draft) {
    try {
      if (typeof global.miyaWriteLsJsonKey === 'function') {
        global.miyaWriteLsJsonKey(DRAFT_KEY, draft);
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      }
    } catch (e) {}
  }

  function buildFieldRowHtml(field, idx) {
    return (
      '<article class="mi-hv-tpl-field" data-mq-hv-tpl-field>' +
      '<div class="mi-hv-tpl-field__top">' +
      '<span class="mi-hv-tpl-field__idx">字段' +
      (idx + 1) +
      '</span>' +
      '<button type="button" class="mi-hv-tpl-field__del" data-mq-hv-tpl-field-del aria-label="删除字段">✕</button>' +
      '</div>' +
      '<label class="mi-hv-tpl-label">字段名' +
      '<input type="text" class="mi-input mi-hv-tpl-input" data-mq-hv-tpl-fname value="' +
      esc(field.name || '') +
      '" placeholder="如：对话" maxlength="40">' +
      '</label>' +
      '<label class="mi-hv-tpl-label">输出要求' +
      '<input type="text" class="mi-input mi-hv-tpl-input" data-mq-hv-tpl-freq value="' +
      esc(field.requirement || '') +
      '" placeholder="如：用温柔的语气说一句话" maxlength="4000">' +
      '</label>' +
      '</article>'
    );
  }

  function buildEditorHtml(draft) {
    draft = draft || loadDraft();
    var fieldsHtml = (draft.fields || [])
      .map(function (f, i) {
        return buildFieldRowHtml(f, i);
      })
      .join('');
    var sampleRows = (draft.fields || [])
      .map(function (f) {
        var v = (draft.sampleValues && draft.sampleValues[f.name]) || '';
        return (
          '<label class="mi-hv-tpl-label">预览·' +
          esc(f.name) +
          '<input type="text" class="mi-input mi-hv-tpl-input" data-mq-hv-tpl-sample="' +
          esc(f.name) +
          '" value="' +
          esc(v) +
          '" placeholder="预览用文字">' +
          '</label>'
        );
      })
      .join('');
    return (
      '<div class="mi-me-flow mi-hv-tpl" data-mq-hv-tpl-root>' +
      '<p class="mi-me-lead">自定义提示词告诉 AI 怎么写心声；字段用于占位与明细；HTML 仅本地渲染，AI 只输出纯文本字段行。</p>' +
      '<details class="mi-hv-tpl-guide">' +
      '<summary class="mi-hv-tpl-guide__sum">' +
      '<span class="mi-hv-tpl-guide__sum-l">完整教程</span>' +
      '<span class="mi-hv-tpl-guide__sum-r">默认折叠 · 点开查看</span>' +
      '</summary>' +
      '<div class="mi-hv-tpl-guide__body">' +
      '<div class="mi-hv-tpl-guide__actions">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-guide-copy>复制教程</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-guide-dl>下载为 txt</button>' +
      '</div>' +
      '<pre class="mi-hv-tpl-guide__pre" data-mq-hv-tpl-guide-text>' +
      esc(TUTORIAL_TXT) +
      '</pre>' +
      '</div>' +
      '</details>' +
      '<div class="mi-hv-tpl__toolbar">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-example>加载示例</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-clear>清空当前内容</button>' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-hv-tpl-save-draft>保存草稿</button>' +
      '</div>' +
      '<section class="mi-hv-tpl__section">' +
      '<h3 class="mi-hv-tpl__h">自定义提示词</h3>' +
      '<p class="mi-empty-hint">替换默认心声说明，优先注入给 AI。不必写 &lt;miyavoice&gt;，系统会强制包裹。</p>' +
      '<textarea class="mi-input mi-input--area mi-hv-tpl__ta mi-hv-tpl__ta--prompt" data-mq-hv-tpl-prompt rows="6" placeholder="例如：每次正文输出结束后必须按照以下要求输出心声！先输出…后输出…">' +
      esc(draft.customPrompt || '') +
      '</textarea>' +
      '</section>' +
      '<section class="mi-hv-tpl__section">' +
      '<h3 class="mi-hv-tpl__h">输出字段</h3>' +
      '<p class="mi-empty-hint">辅助 HTML 占位 {{字段名}}，明细会接在自定义提示词后面注入</p>' +
      '<div class="mi-hv-tpl__fields" data-mq-hv-tpl-fields>' +
      fieldsHtml +
      '</div>' +
      '<button type="button" class="mi-btn mi-btn--ghost mi-btn--block" data-mq-hv-tpl-field-add>＋ 添加字段</button>' +
      '</section>' +
      '<section class="mi-hv-tpl__section">' +
      '<h3 class="mi-hv-tpl__h">HTML 模板</h3>' +
      '<p class="mi-empty-hint">用 {{字段名}} 占位；头像可用 {{char头像}} / {{user头像}}（系统自动填当前聊天双方头像，无需建字段）</p>' +
      '<textarea class="mi-input mi-input--area mi-hv-tpl__ta" data-mq-hv-tpl-html rows="10" placeholder="<img src=&quot;{{char头像}}&quot;><div>{{对话}}</div>">' +
      esc(draft.htmlTemplate || '') +
      '</textarea>' +
      '</section>' +
      '<section class="mi-hv-tpl__section">' +
      '<h3 class="mi-hv-tpl__h">预览样例文字</h3>' +
      '<div data-mq-hv-tpl-samples>' +
      sampleRows +
      '</div>' +
      '<div class="mi-hv-tpl__preview" data-mq-hv-tpl-preview></div>' +
      '</section>' +
      '<section class="mi-hv-tpl__section">' +
      '<h3 class="mi-hv-tpl__h">预设库</h3>' +
      '<select class="mi-input" data-mq-hv-tpl-preset-pick data-mq-hv-tpl-include-default="settings">' +
      buildPresetSelectOptions(draft.presetPick || '', 'settings') +
      '</select>' +
      '<div class="mi-hv-tpl__vault-btns">' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-hv-tpl-preset-save>保存为预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-preset-load>读取预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-preset-delete>删除预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-preset-export>导出当前心声预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-hv-tpl-preset-import>导入心声预设</button>' +
      '</div>' +
      '<input type="file" accept="application/json,.json" hidden multiple data-mq-hv-tpl-preset-import-file>' +
      '</section>' +
      '</div>'
    );
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('read_failed'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 批量解析心声预设文件；优先用文件名作为预设名，并逐个自动写入预设库 */
  function importMiyavoiceFiles(files) {
    var fileArr = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!fileArr.length) {
      return Promise.resolve({ ok: 0, fail: 0, last: null, names: [] });
    }
    var fail = 0;
    var saved = [];
    /* 逐个读取并保存，保证多选时每一个都会落库 */
    return fileArr
      .reduce(function (chain, file) {
        return chain.then(function () {
          return readFileText(file)
            .then(function (text) {
              var parsed = JSON.parse(text);
              var state = parseMiyavoiceImport(parsed);
              if (!state) {
                fail += 1;
                return;
              }
              var fromFile = presetNameFromImportFile(file);
              if (fromFile) state.presetPick = fromFile;
              if (!String(state.presetPick || '').trim()) {
                state.presetPick = '导入预设';
              }
              return savePreset(state.presetPick, {
                customPrompt: state.customPrompt,
                fields: state.fields,
                htmlTemplate: state.htmlTemplate
              }).then(function (row) {
                saved.push({ state: state, row: row });
              });
            })
            .catch(function () {
              fail += 1;
            });
        });
      }, Promise.resolve())
      .then(function () {
        return {
          ok: saved.length,
          fail: fail,
          last: saved.length ? saved[saved.length - 1] : null,
          names: saved.map(function (s) {
            return (s.state && s.state.presetPick) || '';
          })
        };
      });
  }

  function emptyEditorState(presetPick) {
    return {
      customPrompt: '',
      fields: [{ name: '', requirement: '' }],
      htmlTemplate: '',
      sampleValues: {},
      presetPick: String(presetPick || '')
    };
  }

  function sanitizeExportFileName(name) {
    return String(name || 'preset')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'preset';
  }

  /** 从导入文件名推导预设名（去掉 .json 与导出前缀 miyavoice） */
  function presetNameFromImportFile(fileOrName) {
    var raw = typeof fileOrName === 'string' ? fileOrName : (fileOrName && fileOrName.name) || '';
    var base = String(raw)
      .replace(/^.*[\\/]/, '')
      .replace(/\.json$/i, '')
      .trim();
    if (!base) return '';
    base = base.replace(/^miyavoice[-_\s]*/i, '');
    return base.trim().slice(0, 60);
  }

  function buildMiyavoiceExportPayload(preset) {
    var row = normalizePresetRow(preset);
    if (!row) return null;
    return {
      format: 'miyavoice',
      name: row.name,
      customPrompt: row.customPrompt,
      fields: row.fields.map(function (f) {
        return { name: f.name, requirement: f.requirement };
      }),
      htmlTemplate: row.htmlTemplate
    };
  }

  function parseMiyavoiceImport(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (String(raw.format || '').trim() !== 'miyavoice') return null;
    var row = normalizePresetRow({
      name: raw.name || '导入预设',
      customPrompt: raw.customPrompt,
      fields: raw.fields,
      htmlTemplate: raw.htmlTemplate
    });
    if (!row) return null;
    return {
      customPrompt: row.customPrompt,
      fields: row.fields.map(function (f) {
        return { name: f.name, requirement: f.requirement };
      }),
      htmlTemplate: row.htmlTemplate,
      sampleValues: {},
      presetPick: row.name
    };
  }

  function downloadMiyavoicePreset(preset) {
    var payload = buildMiyavoiceExportPayload(preset);
    if (!payload) return false;
    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'miyavoice' + sanitizeExportFileName(payload.name) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (eRev) {}
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readEditorState(root) {
    if (!root) return defaultDraft();
    var fields = [];
    root.querySelectorAll('[data-mq-hv-tpl-field]').forEach(function (row) {
      var name = String((row.querySelector('[data-mq-hv-tpl-fname]') || {}).value || '').trim();
      var requirement = String(
        (row.querySelector('[data-mq-hv-tpl-freq]') || {}).value || ''
      ).trim();
      if (name) fields.push({ name: name, requirement: requirement });
    });
    var sampleValues = {};
    root.querySelectorAll('[data-mq-hv-tpl-sample]').forEach(function (inp) {
      var k = inp.getAttribute('data-mq-hv-tpl-sample');
      if (k) sampleValues[k] = String(inp.value || '');
    });
    var ta = root.querySelector('[data-mq-hv-tpl-html]');
    var promptTa = root.querySelector('[data-mq-hv-tpl-prompt]');
    var pick = root.querySelector('[data-mq-hv-tpl-preset-pick]');
    return {
      customPrompt: promptTa ? String(promptTa.value || '') : '',
      fields: fields,
      htmlTemplate: ta ? String(ta.value || '') : '',
      sampleValues: sampleValues,
      presetPick: pick ? String(pick.value || '') : ''
    };
  }

  function updatePreview(root) {
    if (!root) return;
    var state = readEditorState(root);
    var box = root.querySelector('[data-mq-hv-tpl-preview]');
    if (!box) return;
    var map = {};
    (state.fields || []).forEach(function (f) {
      if (!f.name || isSystemAvatarKey(f.name)) return;
      map[f.name] =
        (state.sampleValues && state.sampleValues[f.name]) != null
          ? state.sampleValues[f.name]
          : '';
    });
    var gen = (Number(box.getAttribute('data-hv-preview-gen')) || 0) + 1;
    box.setAttribute('data-hv-preview-gen', String(gen));
    function paint(ctx) {
      if (String(box.getAttribute('data-hv-preview-gen')) !== String(gen)) return;
      var html = renderTemplate(state.htmlTemplate, map, ctx);
      box.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'mi-hv-tpl__preview-inner';
      box.appendChild(wrap);
      if (String(html || '').trim()) {
        mountInteractiveHtml(wrap, html, {
          frameClass: 'mi-hv-tpl__preview-frame',
          title: '心声模版预览'
        });
      } else {
        wrap.textContent = '（模板为空）';
      }
    }
    resolveEditorAvatarContext(paint);
  }

  function refreshSamplesAndPreview(root) {
    if (!root) return;
    var state = readEditorState(root);
    var wrap = root.querySelector('[data-mq-hv-tpl-samples]');
    if (wrap) {
      wrap.innerHTML = (state.fields || [])
        .map(function (f) {
          var v = (state.sampleValues && state.sampleValues[f.name]) || '';
          return (
            '<label class="mi-hv-tpl-label">预览·' +
            esc(f.name) +
            '<input type="text" class="mi-input mi-hv-tpl-input" data-mq-hv-tpl-sample="' +
            esc(f.name) +
            '" value="' +
            esc(v) +
            '" placeholder="预览用文字">' +
            '</label>'
          );
        })
        .join('');
    }
    updatePreview(root);
  }

  function reindexFields(root) {
    if (!root) return;
    root.querySelectorAll('[data-mq-hv-tpl-field]').forEach(function (row, i) {
      var idx = row.querySelector('.mi-hv-tpl-field__idx');
      if (idx) idx.textContent = '字段' + (i + 1);
    });
  }

  function applyStateToEditor(root, state) {
    if (!root || !state) return;
    var list = root.querySelector('[data-mq-hv-tpl-fields]');
    if (list) {
      list.innerHTML = (state.fields || [])
        .map(function (f, i) {
          return buildFieldRowHtml(f, i);
        })
        .join('');
    }
    var ta = root.querySelector('[data-mq-hv-tpl-html]');
    if (ta) ta.value = state.htmlTemplate || '';
    var promptTa = root.querySelector('[data-mq-hv-tpl-prompt]');
    if (promptTa) promptTa.value = state.customPrompt || '';
    var pick = root.querySelector('[data-mq-hv-tpl-preset-pick]');
    if (pick) {
      var pendingName = String(state.presetPick || '').trim();
      refreshPresetSelect(root, pendingName, '[data-mq-hv-tpl-preset-pick]');
      if (pendingName) {
        var hasOpt = false;
        Array.prototype.forEach.call(pick.options, function (opt) {
          if (opt.value === pendingName) hasOpt = true;
        });
        if (!hasOpt) {
          var opt = document.createElement('option');
          opt.value = pendingName;
          opt.textContent = pendingName;
          pick.appendChild(opt);
        }
        pick.value = pendingName;
      }
    }
    refreshSamplesAndPreview(root);
  }

  function fallbackCopyText(text, onOk) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof onOk === 'function') onOk();
    } catch (err) {
      toast('复制失败，请手动选中教程文字');
    }
  }

  function downloadTutorialTxt() {
    try {
      var blob = new Blob([TUTORIAL_TXT], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '自定义心声完整教程.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (eRev) {}
      }, 1500);
      toast('已开始下载');
    } catch (e) {
      toast('下载失败');
    }
  }

  function bindEditorRoot(root) {
    if (!root || root.dataset.hvTplBound) return;
    root.dataset.hvTplBound = '1';

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-mq-hv-tpl-guide-copy]')) {
        e.preventDefault();
        var copyText = TUTORIAL_TXT;
        var done = function () {
          toast('教程已复制');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyText).then(done).catch(function () {
            fallbackCopyText(copyText, done);
          });
        } else {
          fallbackCopyText(copyText, done);
        }
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-guide-dl]')) {
        e.preventDefault();
        downloadTutorialTxt();
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-field-add]')) {
        var list = root.querySelector('[data-mq-hv-tpl-fields]');
        if (!list) return;
        var idx = list.querySelectorAll('[data-mq-hv-tpl-field]').length;
        list.insertAdjacentHTML('beforeend', buildFieldRowHtml({ name: '', requirement: '' }, idx));
        refreshSamplesAndPreview(root);
        return;
      }
      var del = e.target.closest('[data-mq-hv-tpl-field-del]');
      if (del) {
        var row = del.closest('[data-mq-hv-tpl-field]');
        if (row && row.parentNode) {
          var count = root.querySelectorAll('[data-mq-hv-tpl-field]').length;
          if (count <= 1) {
            toast('至少保留一个字段');
            return;
          }
          row.parentNode.removeChild(row);
          reindexFields(root);
          refreshSamplesAndPreview(root);
        }
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-example]')) {
        applyStateToEditor(root, {
          customPrompt: EXAMPLE_GENTLE.customPrompt || EXAMPLE_CUSTOM_PROMPT,
          fields: EXAMPLE_GENTLE.fields.map(function (f) {
            return { name: f.name, requirement: f.requirement };
          }),
          htmlTemplate: EXAMPLE_GENTLE.htmlTemplate,
          sampleValues: Object.assign({}, EXAMPLE_GENTLE.sampleValues),
          presetPick: ''
        });
        toast('已加载示例');
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-clear]')) {
        var pickKeep = root.querySelector('[data-mq-hv-tpl-preset-pick]');
        applyStateToEditor(
          root,
          emptyEditorState(pickKeep ? String(pickKeep.value || '') : '')
        );
        toast('已清空');
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-save-draft]')) {
        var draft = readEditorState(root);
        if (!draft.fields.length) {
          toast('请至少添加一个字段');
          return;
        }
        persistDraft(draft);
        toast('草稿已保存');
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-preset-save]')) {
        var st = readEditorState(root);
        var reservedHit = (st.fields || []).some(function (f) {
          return f && isSystemAvatarKey(f.name);
        });
        if (reservedHit) {
          toast('「char头像 / user头像」是系统占位，请勿用作字段名');
          return;
        }
        if (!st.fields.length) {
          toast('请至少添加一个字段');
          return;
        }
        if (!String(st.htmlTemplate || '').trim()) {
          toast('请填写 HTML 模板');
          return;
        }
        if (!String(st.customPrompt || '').trim()) {
          toast('请填写自定义提示词');
          return;
        }
        var defaultName = st.presetPick || '';
        promptFn({
          title: '保存心声预设',
          message: '给这个心声模版取个名字',
          placeholder: '例如：温柔女友风',
          defaultValue: defaultName
        }).then(function (name) {
          if (!name || !String(name).trim()) return;
          savePreset(String(name).trim(), {
            customPrompt: st.customPrompt,
            fields: st.fields,
            htmlTemplate: st.htmlTemplate
          })
            .then(function (row) {
              st.presetPick = row.name;
              persistDraft(st);
              refreshPresetSelect(root, row.name, '[data-mq-hv-tpl-preset-pick]');
              var pick = root.querySelector('[data-mq-hv-tpl-preset-pick]');
              if (pick) pick.value = row.name;
              toast('预设已保存');
            })
            .catch(function () {
              toast('保存失败');
            });
        });
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-preset-load]')) {
        var pickEl = root.querySelector('[data-mq-hv-tpl-preset-pick]');
        var pname = pickEl ? String(pickEl.value || '').trim() : '';
        if (!pname) {
          toast('请先选择预设');
          return;
        }
        whenPresetsReady().then(function () {
          var p = findPreset(pname);
          if (!p) {
            toast('预设不存在');
            return;
          }
          applyStateToEditor(root, {
            customPrompt: p.customPrompt || '',
            fields: p.fields.slice(),
            htmlTemplate: p.htmlTemplate,
            sampleValues: {},
            presetPick: p.name
          });
          toast('已读取「' + p.name + '」');
        });
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-preset-delete]')) {
        var pickDel = root.querySelector('[data-mq-hv-tpl-preset-pick]');
        var delName = pickDel ? String(pickDel.value || '').trim() : '';
        if (!delName) {
          toast('请先选择预设');
          return;
        }
        confirmFn({
          title: '删除预设',
          message: '确定删除「' + delName + '」？聊天里已选该预设的联系人将回退为系统默认。'
        }).then(function (ok) {
          if (!ok) return;
          deletePreset(delName)
            .then(function () {
              refreshPresetSelect(root, '', '[data-mq-hv-tpl-preset-pick]');
              toast('已删除');
            })
            .catch(function () {
              toast('删除失败');
            });
        });
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-preset-export]')) {
        var pickExp = root.querySelector('[data-mq-hv-tpl-preset-pick]');
        var expName = pickExp ? String(pickExp.value || '').trim() : '';
        if (!expName) {
          toast('请先保存为预设后再导出');
          return;
        }
        whenPresetsReady().then(function () {
          var expPreset = findPreset(expName);
          if (!expPreset) {
            toast('请先保存为预设后再导出');
            return;
          }
          if (downloadMiyavoicePreset(expPreset)) {
            toast('已导出「' + expPreset.name + '」');
          } else {
            toast('导出失败');
          }
        });
        return;
      }
      if (e.target.closest('[data-mq-hv-tpl-preset-import]')) {
        var finp = root.querySelector('[data-mq-hv-tpl-preset-import-file]');
        if (finp && global.miyaTriggerFileInput) global.miyaTriggerFileInput(finp);
        else if (finp) finp.click();
        return;
      }
    });

    var importFile = root.querySelector('[data-mq-hv-tpl-preset-import-file]');
    if (importFile && !importFile.dataset.hvTplImportBound) {
      importFile.dataset.hvTplImportBound = '1';
      if (!importFile.multiple) importFile.multiple = true;
      importFile.addEventListener('change', function (ev) {
        /* FileList 是活引用：先拷贝再清空 value，否则 files 会立刻变空 */
        var fileArr = Array.prototype.slice.call((ev.target && ev.target.files) || []);
        ev.target.value = '';
        if (!fileArr.length) return;
        toast('正在导入 ' + fileArr.length + ' 个心声预设…');
        importMiyavoiceFiles(fileArr)
          .then(function (result) {
            if (!result.ok) {
              toast(
                result.fail > 1
                  ? '导入失败，请选择有效的 miyavoice JSON'
                  : '不是有效的 miyavoice 预设文件'
              );
              return;
            }
            var last = result.last;
            var state = last.state;
            applyStateToEditor(root, state);
            persistDraft(state);
            refreshPresetSelect(root, state.presetPick, '[data-mq-hv-tpl-preset-pick]');
            var pick = root.querySelector('[data-mq-hv-tpl-preset-pick]');
            if (pick) pick.value = state.presetPick;
            if (result.ok === 1 && !result.fail) {
              toast('导入成功，已保存「' + (state.presetPick || '心声预设') + '」');
            } else if (result.fail) {
              toast('导入完成：成功 ' + result.ok + ' 个，失败 ' + result.fail + ' 个');
            } else {
              toast('导入成功，已保存 ' + result.ok + ' 个心声预设');
            }
          })
          .catch(function () {
            toast('导入失败');
          });
      });
    }

    root.addEventListener('input', function (e) {
      var t = e.target;
      if (!t) return;
      if (
        t.matches('[data-mq-hv-tpl-html]') ||
        t.matches('[data-mq-hv-tpl-sample]') ||
        t.matches('[data-mq-hv-tpl-fname]') ||
        t.matches('[data-mq-hv-tpl-freq]')
      ) {
        if (t.matches('[data-mq-hv-tpl-fname]')) {
          refreshSamplesAndPreview(root);
        } else {
          updatePreview(root);
        }
      }
    });

    updatePreview(root);
  }

  global.MiyaChatHeartVoiceTemplates = {
    PRESETS_LS: PRESETS_LS,
    EXAMPLE_GENTLE: EXAMPLE_GENTLE,
    EXAMPLE_CUSTOM_PROMPT: EXAMPLE_CUSTOM_PROMPT,
    TUTORIAL_TXT: TUTORIAL_TXT,
    whenPresetsReady: whenPresetsReady,
    loadPresets: loadPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    findPreset: findPreset,
    resolvePresetName: resolvePresetName,
    resolvePresetForChat: resolvePresetForChat,
    buildSnapshotFromPreset: buildSnapshotFromPreset,
    normalizePresetSnapshot: normalizePresetSnapshot,
    getFieldNames: getFieldNames,
    sanitizeHtmlTemplate: sanitizeHtmlTemplate,
    isSystemAvatarKey: isSystemAvatarKey,
    buildSystemPlaceholderMap: buildSystemPlaceholderMap,
    renderTemplate: renderTemplate,
    resolveEditorAvatarContext: resolveEditorAvatarContext,
    buildInteractiveDocument: buildInteractiveDocument,
    mountInteractiveHtml: mountInteractiveHtml,
    activateInteractiveHtml: activateInteractiveHtml,
    buildHeartVoiceRulesFromPreset: buildHeartVoiceRulesFromPreset,
    buildExampleMiyavoiceLines: buildExampleMiyavoiceLines,
    rewriteDefaultHeartVoiceMentions: rewriteDefaultHeartVoiceMentions,
    buildCustomHeartVoicePriorityBlock: buildCustomHeartVoicePriorityBlock,
    formatCustomSnapshotLines: formatCustomSnapshotLines,
    isCustomEntry: isCustomEntry,
    previewTextFromEntry: previewTextFromEntry,
    buildPresetSelectOptions: buildPresetSelectOptions,
    refreshPresetSelect: refreshPresetSelect,
    buildChatSettingsPickerHtml: buildChatSettingsPickerHtml,
    readChatPresetFromRoot: readChatPresetFromRoot,
    syncChatPresetSelect: syncChatPresetSelect,
    normalizeChatPresetName: normalizeChatPresetName,
    buildEditorHtml: buildEditorHtml,
    bindEditorRoot: bindEditorRoot,
    loadDraft: loadDraft,
    persistDraft: persistDraft
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({ whenReady: whenPresetsReady });
  }
  whenPresetsReady();
})(window);
