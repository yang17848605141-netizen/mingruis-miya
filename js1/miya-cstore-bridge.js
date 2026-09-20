/**
 * miya-cstore-bridge.js — 74号便利店 API 生成与店长交涉
 */
(function (global) {
  'use strict';

  var SHOPKEEPER_PERSONA =
    '你是74号便利店（探灵事务所）的店长。外貌：男子，白发长发，修长身形，俊美容貌，神秘气质。' +
    '性格：表面温润如玉，对用户很感兴趣——因为用户是少数能深入门扉之人，有探灵师潜质（但尚早，不必强调）。' +
    '说话优雅、含蓄、略带神秘感，偶尔用隐喻；不卑不亢，像古老商号的掌柜。';

  function extractJsonObject(text) {
    var t = String(text || '').trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    var j = t.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    try {
      var obj = JSON.parse(t.slice(i, j + 1));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function coerceMysticalRaw(val) {
    if (val == null) return null;
    if (typeof val === 'object') return val;
    var s = String(val).trim();
    if (!s || s === '[object Object]') return null;
    if ((s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') ||
        (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']')) {
      try { return JSON.parse(s); } catch (e) {}
    }
    return s;
  }

  var BLOCK_META = {
    timeline: { glyphClass: 'neutral', title: '时间经纬', subtitle: 'Chronicle' },
    past: { glyphClass: 'past', title: '过去', subtitle: 'Past', tone: 'past' },
    future: { glyphClass: 'future', title: '未来', subtitle: 'Future', tone: 'future' },
    wish: { glyphClass: 'wish', title: '愿望回响', subtitle: 'Wish', tone: 'wish' },
    antique: { glyphClass: 'antique', title: '灵物余韵', subtitle: 'Relic', tone: 'antique' },
    intel: { glyphClass: 'intel', title: '秘闻札记', subtitle: 'Intel', tone: 'intel' },
    prose: { glyphClass: 'prose', title: '记要', subtitle: 'Record', tone: 'prose' }
  };

  var MYST_TYPE_META = {
    timeline: { code: 'CHR', label: '过去与未来', en: 'Chronicle' },
    wish: { code: 'WSH', label: '交易愿望', en: 'Wish' },
    antique: { code: 'REL', label: '灵物古董', en: 'Relic' },
    intel: { code: 'INT', label: '情报信息', en: 'Intel' },
    custom: { code: 'CUS', label: '自定义契约', en: 'Bespoke' }
  };

  var FIVE_SECTION_GUIDE = {
    timeline:
      '须恰好 5 个板块，紧扣目标角色，每板块正文 180–350 字、叙事细腻：' +
      '①「起源之影」童年或相遇前的关键底色；②「转折之刻」改变命运的事件；' +
      '③「隐秘过往」角色不为人知的秘密片段；④「当下残响」与访客/当前关系交织的现在；' +
      '⑤「未来可能」多条命运分支或预兆。',
    wish:
      '须恰好 5 个板块，兼顾访客与目标角色，每板块正文 180–350 字：' +
      '①「访客之愿」访客想实现的愿望及执念；②「角色之愿」目标角色深藏的愿望；' +
      '③「交换印记」以何物易愿、契约如何缔结；④「实现路径」愿望如何被兑现或逼近；' +
      '⑤「回响与代价」达成后的余波、代价或未尽之言。',
    antique:
      '须恰好 5 个板块，灵物与目标角色深度绑定，每板块正文 180–350 字：' +
      '①「灵物名状」古董外观、触感与第一印象；②「来历考据」年代、流转与入手经过；' +
      '③「角色牵连」此物与目标角色的羁绊往事；④「灵韵低语」附着其上的记忆或低语；' +
      '⑤「持握者当知」访客持握后当知的警示或馈赠。',
    intel:
      '须恰好 5 个板块，揭露目标角色多层情报，每板块正文 180–350 字：' +
      '①「公开表象」外人眼中的他/她；②「隐秘档案」不为外人所知的背景；' +
      '③「未言之秘」角色刻意隐瞒的核心秘密；④「关系暗线」与访客及其他人的暗线；' +
      '⑤「情报余波」知晓此情报后的影响与风险。'
  };

  function renderSigilHtml(item) {
    var glyphs = global.miyaCstoreGlyphs;
    if (glyphs && glyphs.itemSigilHtml) {
      return glyphs.itemSigilHtml(item, { tone: 'myst', size: 'lg' });
    }
    var code = (item && item.tag) || (item && item.mysticalType && MYST_TYPE_META[item.mysticalType]
      ? MYST_TYPE_META[item.mysticalType].code : 'ARC');
    return '<div class="cs-sigil cs-sigil--v0 cs-sigil--myst cs-sigil--lg" aria-hidden="true">' +
      '<span class="cs-sigil__mark"></span>' +
      '<span class="cs-sigil__tag">' + escHtml(code) + '</span></div>';
  }

  function blockText(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(blockText).filter(Boolean).join('\n\n');
    if (typeof val === 'object') {
      if (val.text != null) return blockText(val.text);
      if (val.content != null) return blockText(val.content);
      if (val.body != null) return blockText(val.body);
      if (val.event != null) return blockText(val.event);
      if (val.description != null) return blockText(val.description);
      try { return JSON.stringify(val, null, 2); } catch (e) { return ''; }
    }
    return '';
  }

  function parseBracketSections(text) {
    var sections = [];
    var re = /【([^】]+)】/g;
    var matches = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ key: m[1].trim(), start: m.index, end: m.index + m[0].length });
    }
    for (var i = 0; i < matches.length; i++) {
      var bodyStart = matches[i].end;
      var bodyEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
      var body = text.slice(bodyStart, bodyEnd).trim();
      sections.push({ key: matches[i].key, body: body });
    }
    return sections;
  }

  function parsePeriodLabel(raw) {
    var text = String(raw || '').trim();
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var first = lines[0] || text;
    var rest = lines.slice(1).join('\n').trim();
    var zh = first.match(/^(过去|未来)/);
    if (zh) {
      var enM = first.match(/[（(]([^)）]+)[)）]/);
      return {
        title: zh[1],
        subtitle: enM ? enM[1] : (zh[1] === '过去' ? 'Past' : 'Future'),
        tone: zh[1] === '未来' ? 'future' : 'past',
        text: rest
      };
    }
    if (/^past\b/i.test(first)) {
      return { title: '过去', subtitle: 'Past', tone: 'past', text: rest || text };
    }
    if (/^future\b/i.test(first)) {
      return { title: '未来', subtitle: 'Future', tone: 'future', text: rest || text };
    }
    return { title: first, subtitle: '', tone: '', text: rest };
  }

  function parseTimelineBody(body) {
    var entries = [];
    var inner = parseBracketSections(body);
    if (!inner.length) {
      if (body.trim()) entries.push({ title: '时光', subtitle: '', tone: '', text: body.trim() });
      return entries;
    }
    var current = null;
    inner.forEach(function (sec) {
      var k = sec.key.toLowerCase();
      if (k === 'period' || k === '时期' || k === '时段') {
        if (current && (current.text || current.title)) entries.push(current);
        current = parsePeriodLabel(sec.body);
        if (!current.text) current.text = '';
      } else if (k === 'event' || k === '事件' || k === '片段' || k === '记忆') {
        if (!current) current = { title: '时光', subtitle: '', tone: '', text: '' };
        current.text = sec.body;
      } else if (/^(过去|未来)/.test(sec.key) || /^(past|future)$/i.test(sec.key)) {
        entries.push(parsePeriodEntry(sec.key, sec.body));
      } else if (sec.body) {
        entries.push({ title: sec.key, subtitle: '', tone: '', text: sec.body });
      }
    });
    if (current && (current.text || current.title)) entries.push(current);
    return entries;
  }

  function parsePeriodEntry(key, body) {
    var row = parsePeriodLabel(key + (body ? '\n' + body : ''));
    if (!row.text && body) row.text = body;
    if (!row.tone) {
      if (/未来|future/i.test(key)) row.tone = 'future';
      else if (/过去|past/i.test(key)) row.tone = 'past';
    }
    return row;
  }

  function normalizeBlockType(key) {
    var k = String(key || '').trim().toLowerCase();
    if (k === '过去' || k === 'past') return 'past';
    if (k === '未来' || k === 'future') return 'future';
    if (k === 'period' || k === '时期' || k === '时段') return 'period';
    if (k === 'event' || k === '事件' || k === '片段' || k === '记忆') return 'event';
    if (k === 'timeline' || k === '时间线' || k === '时间经纬') return 'timeline';
    if (k === 'wish' || k === '愿望' || k === '愿望回响') return 'wish';
    if (k === 'antique' || k === '灵物' || k === '古董' || k === '灵物余韵') return 'antique';
    if (k === 'intel' || k === '情报' || k === '秘闻' || k === '秘闻札记') return 'intel';
    if (/^关于/.test(key)) return 'about';
    return 'prose';
  }

  function readTimelinePair(sections, index) {
    var sec = sections[index];
    var t = normalizeBlockType(sec.key);
    if (t !== 'period' && t !== 'past' && t !== 'future') return null;
    var entry = t === 'period' ? parsePeriodLabel(sec.body) : parsePeriodEntry(sec.key, sec.body);
    var next = sections[index + 1];
    if (next && normalizeBlockType(next.key) === 'event') {
      entry.text = next.body;
      return { entry: entry, nextIndex: index + 2 };
    }
    if (!entry.text && sec.body) entry.text = sec.body;
    return { entry: entry, nextIndex: index + 1 };
  }

  function parseMysticalString(text) {
    var parsed = { targetName: '', timeline: [], blocks: [], prose: '' };
    var sections = parseBracketSections(text);
    var i = 0;
    while (i < sections.length) {
      var sec = sections[i];
      var t = normalizeBlockType(sec.key);
      if (t === 'about') {
        var aboutM = sec.key.match(/关于\s*[·•]?\s*(.+)/);
        parsed.targetName = aboutM ? aboutM[1].trim() : sec.body.split('\n')[0].trim();
        i++;
      } else if (t === 'timeline') {
        i++;
        while (i < sections.length) {
          var pair = readTimelinePair(sections, i);
          if (!pair) break;
          parsed.timeline.push(pair.entry);
          i = pair.nextIndex;
        }
      } else if (t === 'period' || t === 'past' || t === 'future') {
        var solo = readTimelinePair(sections, i);
        if (solo) {
          parsed.timeline.push(solo.entry);
          i = solo.nextIndex;
        } else i++;
      } else if (t === 'wish' || t === 'antique' || t === 'intel') {
        var blockTextVal = sec.body;
        if (!blockTextVal && i + 1 < sections.length && normalizeBlockType(sections[i + 1].key) === 'prose') {
          blockTextVal = sections[i + 1].key + '\n' + sections[i + 1].body;
          i++;
        }
        parsed.blocks.push({ type: t, text: blockTextVal });
        i++;
      } else if (t === 'prose' && sec.body) {
        parsed.blocks.push({ type: 'prose', title: sec.key, text: sec.body });
        i++;
      } else {
        i++;
      }
    }
    return parsed;
  }

  function normalizeSections(val) {
    if (!val || typeof val !== 'object') return [];
    var rows = val.sections;
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row, i) {
      if (!row || typeof row !== 'object') return null;
      var title = String(row.title || row.label || row.name || ('篇章 ' + (i + 1))).trim();
      var body = blockText(row.body != null ? row.body : (row.text || row.content || row.event));
      if (!title && !body) return null;
      return { title: title || ('篇章 ' + (i + 1)), body: body };
    }).filter(Boolean);
  }

  function parseMysticalContent(raw) {
    var parsed = { targetName: '', timeline: [], blocks: [], sections: [], prose: '' };
    var val = coerceMysticalRaw(raw);
    if (val == null) return parsed;

    if (typeof val === 'object' && !Array.isArray(val)) {
      parsed.sections = normalizeSections(val);
      if (val.targetName) parsed.targetName = String(val.targetName).trim();
      if (parsed.sections.length) return parsed;
      var past = val.past != null ? val.past : val['过去'];
      var future = val.future != null ? val.future : val['未来'];
      if (past != null && String(blockText(past)).trim()) {
        parsed.timeline.push({
          title: '过去', subtitle: 'Past', tone: 'past', text: blockText(past)
        });
      }
      if (future != null && String(blockText(future)).trim()) {
        parsed.timeline.push({
          title: '未来', subtitle: 'Future', tone: 'future', text: blockText(future)
        });
      }
      if (val.timeline != null) {
        var tl = val.timeline;
        if (Array.isArray(tl)) {
          tl.forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            var period = row.period || row.label || row.title || row.time || '';
            var entry = parsePeriodLabel(period);
            entry.text = blockText(row.event || row.text || row.body || row.content || row);
            if (entry.text) parsed.timeline.push(entry);
          });
        } else if (typeof tl === 'object') {
          var periods = tl.period || tl.periods;
          var events = tl.event || tl.events;
          if (Array.isArray(periods) && Array.isArray(events)) {
            periods.forEach(function (p, i) {
              var entry = parsePeriodLabel(p);
              entry.text = blockText(events[i] || '');
              if (entry.text || entry.title) parsed.timeline.push(entry);
            });
          } else {
            Object.keys(tl).forEach(function (k) {
              var t = normalizeBlockType(k);
              if (t === 'past' || t === 'future') {
                parsed.timeline.push(parsePeriodEntry(k, blockText(tl[k])));
              }
            });
            if (!parsed.timeline.length) {
              parsed.timeline = parseTimelineBody(blockText(tl));
            }
          }
        } else {
          parsed.timeline = parseTimelineBody(blockText(tl));
        }
      }
      Object.keys(val).forEach(function (k) {
        if (k === 'past' || k === 'future' || k === '过去' || k === '未来' || k === 'timeline' ||
            k === 'sections' || k === 'targetName') return;
        var t = normalizeBlockType(k);
        var text = blockText(val[k]);
        if (!text) return;
        if (t === 'about') {
          var aboutM = k.match(/关于\s*[·•]?\s*(.+)/);
          if (aboutM) parsed.targetName = aboutM[1].trim();
          else parsed.targetName = text.split('\n')[0].trim();
        } else if (t === 'past' || t === 'future') {
          parsed.timeline.push(parsePeriodEntry(k, text));
        } else if (t === 'timeline') {
          parsed.timeline = parsed.timeline.concat(parseTimelineBody(text));
        } else if (t === 'wish' || t === 'antique' || t === 'intel') {
          parsed.blocks.push({ type: t, text: text });
        } else if (t !== 'prose') {
          parsed.blocks.push({ type: t, text: text });
        }
      });
      return parsed;
    }

    var text = String(val).trim();
    if (!text) return parsed;

    if (!/【/.test(text)) {
      parsed.prose = text;
      return parsed;
    }

    return parseMysticalString(text);
  }

  function formatProseHtml(text) {
    var paras = String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!paras.length) return '';
    return paras.map(function (p) {
      return '<p class="cs-myst__p">' + escHtml(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderTimelineEntry(entry, index) {
    var tone = entry.tone || (entry.title === '未来' ? 'future' : entry.title === '过去' ? 'past' : 'neutral');
    var meta = BLOCK_META[tone] || BLOCK_META.prose;
    var title = entry.title || meta.title;
    var subtitle = entry.subtitle || meta.subtitle;
    return (
      '<article class="cs-chrono cs-chrono--' + escHtml(tone) + '" style="--cs-chrono-i:' + index + '">' +
        '<div class="cs-chrono__rail" aria-hidden="true">' +
          '<span class="cs-chrono__node"></span>' +
          (index < 99 ? '<span class="cs-chrono__line"></span>' : '') +
        '</div>' +
        '<div class="cs-chrono__panel">' +
          '<header class="cs-chrono__head">' +
            '<span class="cs-chrono__glyph cs-chrono__glyph--' + escHtml(meta.glyphClass || 'neutral') + '" aria-hidden="true"></span>' +
            '<div class="cs-chrono__labels">' +
              '<span class="cs-chrono__title">' + escHtml(title) + '</span>' +
              (subtitle ? '<span class="cs-chrono__sub">' + escHtml(subtitle) + '</span>' : '') +
            '</div>' +
          '</header>' +
          '<div class="cs-chrono__body">' + formatProseHtml(entry.text) + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderSectionBlock(section, index, mystType) {
    var tone = mystType || 'prose';
    var meta = BLOCK_META[tone] || BLOCK_META.prose;
    var bodyHtml = formatProseHtml(section.body);
    if (!bodyHtml) return '';
    return (
      '<section class="cs-myst-block cs-myst-block--section cs-myst-block--' + escHtml(tone) + '" style="--cs-block-i:' + index + '">' +
        '<header class="cs-myst-block__head">' +
          '<span class="cs-myst-block__glyph cs-myst-block__glyph--' + escHtml(meta.glyphClass || 'prose') + '" aria-hidden="true"></span>' +
          '<div>' +
            '<p class="cs-myst-block__kicker">篇章 ' + String(index + 1).padStart(2, '0') + ' · ' + escHtml(meta.subtitle || 'Arcana') + '</p>' +
            '<h4 class="cs-myst-block__title">' + escHtml(section.title) + '</h4>' +
          '</div>' +
        '</header>' +
        '<div class="cs-myst-block__body">' + bodyHtml + '</div>' +
      '</section>'
    );
  }

  function renderMystBlock(block, index) {
    var meta = BLOCK_META[block.type] || BLOCK_META.prose;
    var title = block.title || meta.title;
    var bodyHtml = formatProseHtml(block.text);
    if (!bodyHtml) return '';

  if (block.type === 'wish') {
      return (
        '<section class="cs-myst-block cs-myst-block--wish" style="--cs-block-i:' + index + '">' +
          '<div class="cs-myst-block__halo" aria-hidden="true"></div>' +
          '<header class="cs-myst-block__head">' +
            '<span class="cs-myst-block__glyph cs-myst-block__glyph--' + escHtml(meta.glyphClass || 'prose') + '" aria-hidden="true"></span>' +
            '<div><p class="cs-myst-block__kicker">' + escHtml(meta.subtitle) + '</p>' +
            '<h4 class="cs-myst-block__title">' + escHtml(title) + '</h4></div>' +
          '</header>' +
          '<div class="cs-myst-block__quote">' + bodyHtml + '</div>' +
        '</section>'
      );
    }

    if (block.type === 'antique') {
      var antiqueTitle = '';
      var antiqueBody = block.text || '';
      var antiqueLines = antiqueBody.split('\n');
      if (antiqueLines.length > 1 && antiqueLines[0].trim()) {
        antiqueTitle = antiqueLines[0].trim();
        antiqueBody = antiqueLines.slice(1).join('\n').trim();
      }
      return (
        '<section class="cs-myst-block cs-myst-block--antique" style="--cs-block-i:' + index + '">' +
          '<div class="cs-myst-block__frame" aria-hidden="true"></div>' +
          '<header class="cs-myst-block__head">' +
            '<span class="cs-myst-block__glyph cs-myst-block__glyph--' + escHtml(meta.glyphClass || 'prose') + '" aria-hidden="true"></span>' +
            '<div><p class="cs-myst-block__kicker">' + escHtml(meta.subtitle) + '</p>' +
            '<h4 class="cs-myst-block__title">' + escHtml(antiqueTitle || title) + '</h4></div>' +
          '</header>' +
          '<div class="cs-myst-block__body cs-myst-block__body--relic">' + formatProseHtml(antiqueBody || antiqueTitle) + '</div>' +
        '</section>'
      );
    }

    if (block.type === 'intel') {
      return (
        '<section class="cs-myst-block cs-myst-block--intel" style="--cs-block-i:' + index + '">' +
          '<div class="cs-myst-block__stamp" aria-hidden="true">CONFIDENTIAL</div>' +
          '<header class="cs-myst-block__head">' +
            '<span class="cs-myst-block__glyph cs-myst-block__glyph--' + escHtml(meta.glyphClass || 'prose') + '" aria-hidden="true"></span>' +
            '<div><p class="cs-myst-block__kicker">' + escHtml(meta.subtitle) + '</p>' +
            '<h4 class="cs-myst-block__title">' + escHtml(title) + '</h4></div>' +
          '</header>' +
          '<div class="cs-myst-block__body cs-myst-block__body--dossier">' + bodyHtml + '</div>' +
        '</section>'
      );
    }

    return (
      '<section class="cs-myst-block cs-myst-block--prose" style="--cs-block-i:' + index + '">' +
        '<header class="cs-myst-block__head">' +
          '<span class="cs-myst-block__glyph cs-myst-block__glyph--' + escHtml(meta.glyphClass || 'prose') + '" aria-hidden="true"></span>' +
          '<div><p class="cs-myst-block__kicker">' + escHtml(meta.subtitle) + '</p>' +
          '<h4 class="cs-myst-block__title">' + escHtml(title) + '</h4></div>' +
        '</header>' +
        '<div class="cs-myst-block__body">' + bodyHtml + '</div>' +
      '</section>'
    );
  }

  function renderMysticalDetailHtml(item) {
    item = item && typeof item === 'object' ? item : {};
    var parsed = parseMysticalContent(item.content);
    var targetName = String(item.targetName || parsed.targetName || '').trim();
    var mystType = String(item.mysticalType || '').trim();
    var typeMeta = MYST_TYPE_META[mystType] || { code: 'ARC', label: item.category || '门扉秘藏', en: 'Arcana' };
    var parts = [];

    parts.push(
      '<div class="cs-myst">' +
        '<div class="cs-myst__veil" aria-hidden="true"></div>' +
        '<header class="cs-myst__hero">' +
          '<div class="cs-myst__sigil-slot"><span class="cs-item-emoji cs-item-emoji--lg">' +
            escHtml(String(item.emoji || '✦').trim().slice(0, 4)) +
          '</span></div>' +
          '<div class="cs-myst__hero-text">' +
            '<p class="cs-myst__eyebrow">' + escHtml(typeMeta.label) + ' · ' + escHtml(typeMeta.en) + '</p>' +
            '<h4 class="cs-myst__item-name">' + escHtml(item.name || '') + '</h4>' +
            (targetName
              ? '<p class="cs-myst__subject"><span class="cs-myst__subject-label">关于</span>' + escHtml(targetName) + '</p>'
              : '') +
            (item.desc ? '<p class="cs-myst__lede">' + escHtml(item.desc) + '</p>' : '') +
          '</div>' +
        '</header>'
    );

    if (parsed.sections.length) {
      parts.push('<div class="cs-myst__sections">');
      parts.push('<div class="cs-myst__section-label"><span>门扉五章</span><i aria-hidden="true"></i></div>');
      parsed.sections.forEach(function (sec, i) {
        parts.push(renderSectionBlock(sec, i, mystType));
      });
      parts.push('</div>');
    } else if (parsed.timeline.length) {
      parts.push('<div class="cs-myst__timeline">');
      parts.push('<div class="cs-myst__section-label"><span>时间经纬</span><i aria-hidden="true"></i></div>');
      parsed.timeline.forEach(function (entry, i) {
        parts.push(renderTimelineEntry(entry, i));
      });
      parts.push('</div>');
    }

    parsed.blocks.forEach(function (block, i) {
      parts.push(renderMystBlock(block, i));
    });

    if (parsed.prose && !parsed.sections.length && !parsed.timeline.length && !parsed.blocks.length) {
      parts.push('<div class="cs-myst__prose">' + formatProseHtml(parsed.prose) + '</div>');
    }

    if (!parsed.sections.length && !parsed.timeline.length && !parsed.blocks.length && !parsed.prose) {
      var fallback = blockText(item.content) || String(item.desc || '').trim();
      if (fallback && fallback !== '[object Object]') {
        parts.push('<div class="cs-myst__prose">' + formatProseHtml(fallback) + '</div>');
      } else {
        parts.push('<p class="cs-myst__empty">暂无详情</p>');
      }
    }

    parts.push(
        '<footer class="cs-myst__foot">' +
          '<span class="cs-myst__seal">门扉所授 · 仅供持钥者阅览</span>' +
        '</footer>' +
      '</div>'
    );

    return parts.join('');
  }

  /** 将 API/存储中的物品正文统一为可读字符串 */
  function normalizeContent(val) {
    if (val == null) return '';
    if (typeof val === 'string') {
      var s = val.trim();
      return s === '[object Object]' ? '' : s;
    }
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
      return val.map(normalizeContent).filter(Boolean).join('\n\n');
    }
    if (typeof val === 'object') {
      var secRows = normalizeSections(val);
      if (secRows.length) {
        return secRows.map(function (row) {
          return '【' + row.title + '】\n' + row.body;
        }).join('\n\n');
      }
      var past = val.past != null ? val.past : val['过去'];
      var future = val.future != null ? val.future : val['未来'];
      if (past != null || future != null) {
        var parts = [];
        if (past != null && String(past).trim()) parts.push('【过去】\n' + String(past).trim());
        if (future != null && String(future).trim()) parts.push('【未来】\n' + String(future).trim());
        if (parts.length) return parts.join('\n\n');
      }
      if (val.text != null) return normalizeContent(val.text);
      if (val.content != null) return normalizeContent(val.content);
      if (val.body != null) return normalizeContent(val.body);
      var lines = [];
      Object.keys(val).forEach(function (k) {
        var nested = normalizeContent(val[k]);
        if (nested) lines.push('【' + k + '】\n' + nested);
      });
      return lines.join('\n\n');
    }
    return '';
  }

  function callApi(systemHint, userContent) {
    var br = global.miyaForumBridge;
    if (br && typeof br.callCstoreCompletionsRaw === 'function') {
      return br.callCstoreCompletionsRaw(systemHint, userContent);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function buildMaskContext(maskInfo) {
    if (!maskInfo) return '访客';
    var lines = [];
    if (maskInfo.nickname || maskInfo.name) lines.push('访客名：' + (maskInfo.nickname || maskInfo.name));
    if (maskInfo.persona) lines.push('访客人设：' + truncateStr(maskInfo.persona, 400));
    if (maskInfo.signature) lines.push('签名：' + truncateStr(maskInfo.signature, 120));
    return lines.length ? lines.join('\n') : '访客';
  }

  function buildContactContext(contact, profile) {
    if (!contact) return '';
    var cs = global.miyaChatStore;
    var cts = global.miyaContactsStore;
    var aw = global.MiyaChatAwareness;
    var parts = [];
    parts.push('【目标角色】' + String(contact.name || '未知'));
    if (contact.persona) parts.push('人设：' + truncateStr(contact.persona, 600));
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    var chat = cs && cs.findChatByContact ? cs.findChatByContact(contact.id, profile && profile.id) : null;
    var settings = (chat && chat.chatSettings) || contact.chatSettings || {};
    if (aw) {
      var rel = aw.buildRelationshipLine(settings, contact);
      if (rel) parts.push(rel);
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }
    if (settings.charMemoryList && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-8).map(function (m) {
        return String(m && m.content ? m.content : m).trim();
      }).filter(Boolean);
      if (mems.length) parts.push('角色记忆：\n' + mems.join('\n'));
    }
    if (profile) {
      parts.push('【访客（用户面具）】' + String(profile.name || '用户'));
      if (profile.persona) parts.push('访客人设：' + truncateStr(profile.persona, 300));
    }
    if (chat && cs && cs.getMessages) {
      var msgs = cs.getMessages(chat.id) || [];
      if (msgs.length) {
        var recent = msgs.slice(-8).map(function (m) {
          var role = m.role === 'user' ? (profile && profile.name) || '用户' : contact.name;
          var txt = String(m.content || '').replace(/\s+/g, ' ').trim();
          return role + '：' + truncateStr(txt, 120);
        }).filter(function (l) { return l.length > 3; });
        if (recent.length) parts.push('近期对话：\n' + recent.join('\n'));
      }
    }
    return parts.join('\n\n');
  }

  function generateNormalItems(maskInfo) {
    var sys =
      '你是便利店货架策划。为「74号便利店」日常区生成真实便利店商品 JSON。' +
      '仅输出 JSON，不要 markdown。格式：{"items":[{"name":"","shop":"74号","price":数字,"category":"","emoji":"","tag":"三字母品类码","desc":""}]}。' +
      'tag 为品类缩写（如 SNK/BEV/BNT/DLY/MAG）。emoji 为单个贴合商品的表情符号。' +
      '生成 12–16 件：零食、饮料、便当、日用品、杂志等，价格合理（3–68元），名称具体有生活感，描述细腻有质感。';
    var user = '当前顾客：\n' + buildMaskContext(maskInfo) + '\n\n请生成今日货架。';
    return callApi(sys, user).then(function (text) {
      var obj = extractJsonObject(text);
      if (!obj || !Array.isArray(obj.items)) throw new Error('生成格式无效');
      return obj.items.map(function (it) {
        return {
          id: '',
          name: it.name,
          shop: it.shop || '74号',
          price: it.price,
          category: it.category || '便利',
          emoji: String(it.emoji || '').trim().slice(0, 4) || '🏪',
          tag: String(it.tag || it.category || 'CVS').slice(0, 4).toUpperCase(),
          desc: it.desc || '',
          kind: 'gift'
        };
      });
    });
  }

  function generateMysticalItems(maskInfo) {
    var sys =
      '你是探灵事务所「深入门扉」区的商品策划。生成四类神秘商品 JSON。' +
      '仅输出 JSON。格式：{"items":[{"name":"","category":"timeline|wish|antique|intel","emoji":"","tag":"三字母编号","desc":"","exchangeHint":"","rarity":"common|rare|legendary"}]}。' +
      'emoji 为贴合商品的单个表情或符号。tag 按类别：timeline=CHR, wish=WSH, antique=REL, intel=INT。' +
      '每类至少 2 件，共 8–12 件。' +
      'timeline=窥探某人过去与未来时间线；wish=交易愿望（可实现访客或角色之愿）；antique=与某人羁绊的灵物古董；intel=关于某人的秘密情报。' +
      '名称富有诗意与神秘感，描述层次丰富（80–120字），exchangeHint 暗示交换物（记忆、誓言、旧物等），不要写具体价格。' +
      '商品描述须暗示可与特定角色产生联动。';
    var user = '当前能深入门扉的访客：\n' + buildMaskContext(maskInfo) + '\n\n请生成门扉商品。';
    return callApi(sys, user).then(function (text) {
      var obj = extractJsonObject(text);
      if (!obj || !Array.isArray(obj.items)) throw new Error('生成格式无效');
      var tagByCat = { timeline: 'CHR', wish: 'WSH', antique: 'REL', intel: 'INT' };
      return obj.items.map(function (it) {
        var cat = String(it.category || '').trim();
        return {
          name: it.name,
          category: cat,
          emoji: String(it.emoji || '').trim().slice(0, 4) || '✦',
          tag: String(it.tag || tagByCat[cat] || 'ARC').slice(0, 4).toUpperCase(),
          desc: it.desc || '',
          exchangeHint: it.exchangeHint || '',
          rarity: it.rarity || 'common'
        };
      });
    });
  }

  function buildNegotiationSystemPrompt(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var item = opts.item || {};
    var isCustom = !!opts.isCustom;
    var cat = String(item.category || 'timeline').trim();
    var catLabels = {
      timeline: '窥探时间线（过去与未来及更多时光篇章）',
      wish: '交易愿望（访客与角色之愿）',
      antique: '灵物古董（与角色羁绊的旧物）',
      intel: '情报信息（角色秘密档案）'
    };
    var catLabel = catLabels[cat] || '神秘物品';
    var sectionGuide = FIVE_SECTION_GUIDE[cat] || FIVE_SECTION_GUIDE.timeline;
    var itemName = isCustom
      ? String(opts.customWant || '自定义渴求').trim()
      : String(item.name || '').trim();

    return (
      SHOPKEEPER_PERSONA +
      '\n\n你正在与访客交涉。' +
      (isCustom
        ? '访客提出自定义契约，渴求：「' + itemName + '」（' + catLabel + '）。'
        : '访客想换取：「' + itemName + '」（' + catLabel + '）。') +
      (isCustom ? '' : '\n商品描述：' + String(item.desc || '')) +
      '\n参考交换提示：' + String(item.exchangeHint || '任意有诚意之物') +
      '\n若【此前对话】中你已应允或访客已补充交换信息，须承接语境，勿重复追问。' +
      '\n请评估访客提供的交换物是否足够（可苛刻，也可被诚意打动；若对话中访客补充了更有分量的交换，可改判接受）。' +
      '\n仅输出 JSON：{"accepted":true/false,"shopkeeperLines":["店长台词1","台词2"],"reason":"简短理由","resultTitle":"成交后物品标题","resultContent":{"targetName":"角色名或空","sections":[{"title":"板块标题","body":"正文"}]}}。' +
      '\n若 accepted 为 true，resultContent 必须含恰好 5 个 sections，title 与 body 均由你创作：' + sectionGuide +
      '\n每段 body 须充实、有画面感、与目标角色及访客人设紧密相关。禁止在 body 内使用【】标记。' +
      '\nshopkeeperLines 2–4 句，温润神秘，像对话。若 rejected，resultContent 的 sections 留空数组。'
    );
  }

  function formatChatHistoryLines(history, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var rows = Array.isArray(history) ? history.slice() : [];
    if (opts.excludeLastUserMessage && rows.length) {
      var last = rows[rows.length - 1];
      var current = String(opts.currentMessage || '').trim();
      if (last && last.user && String(last.text || '').trim() === current) rows.pop();
    }
    return rows.map(function (row) {
      if (!row || !row.text) return '';
      return (row.user ? '访客：' : '掌柜：') + String(row.text).trim();
    }).filter(Boolean);
  }

  function buildNegotiationUserPrompt(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var item = opts.item || {};
    var maskInfo = opts.maskInfo;
    var contactCtx = opts.contactContext || '';
    var isCustom = !!opts.isCustom;
    var cat = String(item.category || '').trim();
    var catLabels = {
      timeline: '窥探时间线',
      wish: '交易愿望',
      antique: '灵物古董',
      intel: '情报信息'
    };
    var catLabel = catLabels[cat] || '神秘物品';

    var userParts = ['【访客】\n' + buildMaskContext(maskInfo)];
    if (isCustom) {
      userParts.push('【自定义渴求】\n' + String(opts.customWant || '').trim());
      userParts.push('【契约类型】' + catLabel);
    } else {
      userParts.push('【欲购】' + String(item.name || '') + '（' + catLabel + '）');
    }
    userParts.push('【访客提供的交换物】\n' + String(opts.offer || '').trim());
    if (opts.userWish && cat === 'wish') {
      userParts.push('【访客愿望】\n' + String(opts.userWish));
    }
    if (contactCtx) {
      userParts.push('【关于目标角色】\n' + contactCtx);
    }
    if (Array.isArray(opts.chatHistory) && opts.chatHistory.length) {
      var chatLines = formatChatHistoryLines(opts.chatHistory);
      if (chatLines.length) userParts.push('【此前对话 — 须完整阅读并承接语境】\n' + chatLines.join('\n'));
    }
    if (opts.transactionFulfilled) {
      userParts.push('【系统】契约状态：已成交，所得「' + String(opts.fulfilledTitle || '').trim() + '」已存入背包');
    }
    return userParts.join('\n\n');
  }

  function normalizeResultContent(raw, fallbackTitle) {
    var val = coerceMysticalRaw(raw);
    if (!val || typeof val !== 'object') {
      var prose = blockText(raw);
      if (prose) {
        return {
          targetName: '',
          sections: [{ title: fallbackTitle || '门扉所授', body: prose }]
        };
      }
      return { targetName: '', sections: [] };
    }
    var sections = normalizeSections(val);
    var legacy = null;
    if (!sections.length) {
      legacy = parseMysticalContent(val);
      if (legacy.timeline.length) {
        sections = legacy.timeline.map(function (entry) {
          return { title: entry.title || '时光', body: entry.text || '' };
        });
      }
      if (!sections.length && legacy.blocks.length) {
        sections = legacy.blocks.map(function (block) {
          return { title: block.title || block.type || '篇章', body: block.text || '' };
        });
      }
      if (!sections.length && legacy.prose) {
        sections = [{ title: fallbackTitle || '门扉所授', body: legacy.prose }];
      }
    }
    return {
      targetName: String(val.targetName || (legacy && legacy.targetName) || '').trim(),
      sections: sections
    };
  }

  function negotiatePurchase(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var item = opts.item || {};
    var offer = String(opts.offer || '').trim();
    var maskInfo = opts.maskInfo;
    if (!offer) return Promise.reject(new Error('请提供交换之物'));
    if (opts.isCustom && !String(opts.customWant || '').trim()) {
      return Promise.reject(new Error('请说明你想要什么'));
    }

    var sys = buildNegotiationSystemPrompt(opts);
    var user = buildNegotiationUserPrompt(opts);

    return callApi(sys, user).then(function (text) {
      var obj = extractJsonObject(text);
      if (!obj || typeof obj.accepted !== 'boolean') throw new Error('交涉回应格式无效');
      var normalized = normalizeResultContent(
        obj.resultContent,
        String(obj.resultTitle || item.name || '').trim()
      );
      return {
        accepted: !!obj.accepted,
        shopkeeperLines: Array.isArray(obj.shopkeeperLines)
          ? obj.shopkeeperLines.map(function (l) { return String(l || '').trim(); }).filter(Boolean)
          : [String(obj.reason || '……')],
        reason: String(obj.reason || '').trim(),
        resultTitle: String(obj.resultTitle || item.name || '').trim(),
        resultContent: normalized
      };
    });
  }

  function chatWithKeeper(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var item = opts.item || {};
    var message = String(opts.message || '').trim();
    var maskInfo = opts.maskInfo;
    if (!message) return Promise.reject(new Error('请输入想说的话'));

    var isCustom = !!opts.isCustom;
    var fulfilled = !!opts.transactionFulfilled;
    var fulfilledTitle = String(opts.fulfilledTitle || item.name || '').trim();
    var cat = String(item.category || 'timeline').trim();
    var catLabels = {
      timeline: '窥探时间线', wish: '交易愿望', antique: '灵物古董', intel: '情报信息'
    };
    var catLabel = catLabels[cat] || '神秘契约';
    var sectionGuide = FIVE_SECTION_GUIDE[cat] || FIVE_SECTION_GUIDE.timeline;

    var statusNote = fulfilled
      ? '契约已缔结完成，访客已获得「' + fulfilledTitle + '」并存入背包。' +
        '你必须基于【此前对话】与已成之事回应，禁止再追问「用什么交换」或假装交换尚未发生。' +
        '可回应致谢、简述所得、或祝其善用。accepted 必须为 false。'
      : '访客正在与你继续交谈。你必须完整阅读【此前对话】，承接已有语境——' +
        '若对话中你已应允成交、或访客已呈上交换物且你曾认可，不得重复追问「用什么来换」。' +
        '仅在交换确实尚未达成、且需补充信息时，才可继续洽商。';

    var sys =
      SHOPKEEPER_PERSONA +
      '\n\n' + statusNote +
      '\n契约类型：' + catLabel + '。' +
      (isCustom ? '自定义渴求：「' + String(opts.customWant || '') + '」。' : '商品：「' + String(item.name || '') + '」。') +
      (fulfilled
        ? '\n当前状态：已成交。'
        : '\n访客已提供交换物：' + (opts.offer ? String(opts.offer) : '（尚未呈上）')) +
      '\n你可回应、追问、婉拒；若认为交换已足够且尚未成交，可同意成交。' +
      '\n仅输出 JSON：{"lines":["台词"],"accepted":false,"resultTitle":"","resultContent":{"targetName":"","sections":[]}}。' +
      (fulfilled
        ? 'accepted 必须为 false，resultContent 留空。'
        : 'accepted 仅在为 true 时填写 resultTitle 与 resultContent（恰好 5 个 sections）：' + sectionGuide) +
      '\nlines 1–3 句。';

    var priorChat = formatChatHistoryLines(opts.chatHistory, {
      excludeLastUserMessage: true,
      currentMessage: message
    });

    var userParts = ['【访客】\n' + buildMaskContext(maskInfo)];
    if (opts.contactContext) userParts.push('【关于目标角色】\n' + opts.contactContext);
    if (isCustom && opts.customWant) userParts.push('【自定义渴求】\n' + String(opts.customWant));
    else if (!isCustom && item.name) userParts.push('【洽谈商品】' + String(item.name) + '（' + catLabel + '）');
    if (opts.offer) userParts.push('【已呈交换物】\n' + String(opts.offer));
    if (opts.userWish && cat === 'wish') userParts.push('【访客愿望】\n' + String(opts.userWish));
    if (priorChat.length) userParts.push('【此前对话 — 须完整阅读并承接语境】\n' + priorChat.join('\n'));
    userParts.push('【访客此刻说】\n' + message);
    if (fulfilled) {
      userParts.push('【系统】契约状态：已成交，所得「' + fulfilledTitle + '」已存入背包');
    }

    return callApi(sys, userParts.join('\n\n')).then(function (text) {
      var obj = extractJsonObject(text);
      if (!obj || !Array.isArray(obj.lines)) throw new Error('对话回应格式无效');
      var accepted = fulfilled ? false : !!obj.accepted;
      var normalized = accepted
        ? normalizeResultContent(obj.resultContent, String(obj.resultTitle || item.name || '').trim())
        : { targetName: '', sections: [] };
      return {
        lines: obj.lines.map(function (l) { return String(l || '').trim(); }).filter(Boolean),
        accepted: accepted,
        resultTitle: String(obj.resultTitle || '').trim(),
        resultContent: normalized
      };
    });
  }

  function getShopkeeperGreeting(maskInfo) {
    return callApi(
      SHOPKEEPER_PERSONA + '\n仅输出 JSON：{"lines":["一句","两句"]}。访客刚踏入深入门扉，店长温和招呼，暗示对其潜质的一丝兴趣，但不要啰嗦。',
      '访客：\n' + buildMaskContext(maskInfo)
    ).then(function (text) {
      var obj = extractJsonObject(text);
      if (obj && Array.isArray(obj.lines) && obj.lines.length) return obj.lines;
      return ['欢迎。', '能走到这里的，不多。'];
    }).catch(function () {
      return ['夜深了，请进。', '你想换些什么？'];
    });
  }

  global.miyaCstoreBridge = {
    generateNormalItems: generateNormalItems,
    generateMysticalItems: generateMysticalItems,
    negotiatePurchase: negotiatePurchase,
    chatWithKeeper: chatWithKeeper,
    getShopkeeperGreeting: getShopkeeperGreeting,
    buildContactContext: buildContactContext,
    buildMaskContext: buildMaskContext,
    normalizeContent: normalizeContent,
    coerceMysticalRaw: coerceMysticalRaw,
    parseMysticalContent: parseMysticalContent,
    renderMysticalDetailHtml: renderMysticalDetailHtml
  };
})(typeof window !== 'undefined' ? window : global);
