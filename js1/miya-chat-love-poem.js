/**
 * Miya 单聊 · 情诗（文风选择 + 卡片渲染）
 */
(function (global) {
  'use strict';

  var LOVE_POEM_STYLES = [
    { id: 'classical', label: '古风文言文', hint: '骈俪对仗 · 含蓄隽永', emoji: '🏮' },
    { id: 'modern', label: '现代抒情诗', hint: '自由体 · 直抒胸臆', emoji: '🌙' },
    { id: 'wabi', label: '日系物哀风', hint: '季语意象 · 轻愁淡写', emoji: '🍃' },
    { id: 'french', label: '法式浪漫诗', hint: '意象流动 · 呢喃低语', emoji: '🥀' },
    { id: 'sonnet', label: '英伦十四行', hint: '格律严谨 · 层层递进', emoji: '✒️' },
    { id: 'neo_cn', label: '新中式写意', hint: '留白写意 · 现代古韵', emoji: '🎋' },
    { id: 'cyber', label: '赛博朋克情话', hint: '霓虹代码 · 未来浪漫', emoji: '💠' },
    { id: 'shanghai', label: '海派闲情诗', hint: '弄堂晚风 · 都市絮语', emoji: '🌆' },
    { id: 'gothic', label: '暗黑哥特韵', hint: '暗夜玫瑰 · 炽烈沉郁', emoji: '🦋' },
    { id: 'minimal', label: '极简留白体', hint: '短句断行 · 余韵悠长', emoji: '◻️' }
  ];

  function trim(s) {
    return String(s || '').trim();
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function findStyleByLabel(label) {
    var key = trim(label);
    if (!key) return null;
    var i;
    for (i = 0; i < LOVE_POEM_STYLES.length; i++) {
      if (LOVE_POEM_STYLES[i].label === key) return LOVE_POEM_STYLES[i];
    }
    return { id: 'custom', label: key, hint: '', emoji: '💌' };
  }

  function findStyleIndex(label) {
    var key = trim(label);
    if (!key) return '';
    var i;
    for (i = 0; i < LOVE_POEM_STYLES.length; i++) {
      if (LOVE_POEM_STYLES[i].label === key) return String(i + 1).padStart(2, '0');
    }
    return '';
  }

  function buildStylePickerHtml() {
    var tiles = LOVE_POEM_STYLES.map(function (st, idx) {
      var no = String(idx + 1).padStart(2, '0');
      return (
        '<button type="button" class="qq-lovepoem-pick" data-lovepoem-style="' +
        esc(st.label) +
        '">' +
        '<span class="qq-lovepoem-pick__ghost" aria-hidden="true">' +
        no +
        '</span>' +
        '<span class="qq-lovepoem-pick__no">' +
        no +
        '</span>' +
        '<span class="qq-lovepoem-pick__name">' +
        esc(st.label) +
        '</span>' +
        '<span class="qq-lovepoem-pick__mark" aria-hidden="true"></span>' +
        '</button>'
      );
    }).join('');
    return (
      '<div class="qq-sheet qq-sheet--lovepoem" role="dialog" aria-modal="true" aria-labelledby="qq-lovepoem-sheet-title">' +
      '<div class="qq-lovepoem-sheet">' +
      '<button type="button" class="qq-lovepoem-sheet__close" data-sheet-close aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
      '</button>' +
      '<header class="qq-lovepoem-sheet__mast">' +
      '<p class="qq-lovepoem-sheet__kicker">Poem</p>' +
      '<h2 class="qq-lovepoem-sheet__title" id="qq-lovepoem-sheet-title">情诗</h2>' +
      '<span class="qq-lovepoem-sheet__rule" aria-hidden="true"></span>' +
      '</header>' +
      '<div class="qq-lovepoem-sheet__list">' +
      tiles +
      '</div>' +
      '</div></div>'
    );
  }

  function bindStylePicker(onPick) {
    document.querySelectorAll('[data-lovepoem-style]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var style = btn.getAttribute('data-lovepoem-style');
        if (style && typeof onPick === 'function') onPick(style);
      });
    });
  }

  function renderLovePoemCard(m, escFn) {
    var e = typeof escFn === 'function' ? escFn : esc;
    var lp = m.lovePoem;
    if (!lp || !Array.isArray(lp.lines) || !lp.lines.length) return '';
    var isMe = m.role === 'user';
    var dir = isMe ? 'out' : 'in';
    var styleLabel = trim(lp.style) || '情诗';
    var styleNo = findStyleIndex(styleLabel);
    var title = trim(lp.title);
    var untitled = !title || title === '（无题）';
    if (untitled) title = '';
    var linesHtml = lp.lines
      .map(function (line) {
        return '<p class="qq-card-lovepoem__line">' + e(trim(line)) + '</p>';
      })
      .join('');
    return (
      '<div class="qq-card qq-card-lovepoem qq-card-lovepoem--' +
      dir +
      '" data-msg-id="' +
      e(m.id) +
      '">' +
      '<div class="qq-card-lovepoem__sheet">' +
      '<header class="qq-card-lovepoem__mast">' +
      '<span class="qq-card-lovepoem__kicker">Poem</span>' +
      (styleNo
        ? '<span class="qq-card-lovepoem__idx">' + e(styleNo) + '</span>'
        : '') +
      '</header>' +
      '<div class="qq-card-lovepoem__main">' +
      (untitled
        ? '<h3 class="qq-card-lovepoem__title qq-card-lovepoem__title--untitled">无题</h3>'
        : '<h3 class="qq-card-lovepoem__title">' + e(title) + '</h3>') +
      '<span class="qq-card-lovepoem__rule" aria-hidden="true"></span>' +
      '<div class="qq-card-lovepoem__lines">' +
      linesHtml +
      '</div></div></div></div>'
    );
  }

  function buildLovePoemInjectBlock(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var style = trim(opts.style) || '现代抒情诗';
    var roleName = trim(opts.roleName) || '角色';
    return [
      '【本轮·情诗任务·' + roleName + '】',
      '用户请求你以「' + style + '」文风写一首情诗并发送。',
      '本轮正文须严格按以下顺序（均占独立一行，仍须完整 <thinking> → 正文 → <miyavoice> 三段式）：',
      '1. 第一行必须是情诗卡片，格式：情诗-' + style + '｜标题｜诗句内容',
      '   · 标题写出诗题；若无题则写（无题）',
      '   · 诗句多句用半角斜杠 / 分隔，如：句一/句二/句三（建议 2–6 句，贴合所选文风）',
      '   · 情诗正文（标题除外）总字数须至少 100 字，须写足、写满，禁止过短或敷衍',
      '   · 该行只发情诗，勿与普通对白混在同一行',
      '2. 情诗行之后，再写 1–3 行普通对白气泡，说说写这首诗时的心情或对用户的话',
      '情诗须原创、真挚、贴合人设与当下情境；正文至少 100 字；禁止抄袭名篇；禁止每轮都写情诗以外的重复套路。',
      '发出前自检：第一行是否为「情诗-' + style + '｜…｜…」格式；其后是否有 1–3 行对白。'
    ].join('\n');
  }

  global.MiyaChatLovePoem = {
    STYLES: LOVE_POEM_STYLES,
    findStyleByLabel: findStyleByLabel,
    buildStylePickerHtml: buildStylePickerHtml,
    bindStylePicker: bindStylePicker,
    renderLovePoemCard: renderLovePoemCard,
    buildLovePoemInjectBlock: buildLovePoemInjectBlock
  };
})(typeof window !== 'undefined' ? window : global);
