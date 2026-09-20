/**
 * miya-typewriter-text.js — 分章与分页工具
 */
(function (global) {
  'use strict';

  var CHARS_PER_PAGE = 520;

  var CHAPTER_LINE_RE = /^(第\s*[一二三四五六七八九十百千万零〇\d]+\s*[章节回幕部卷集](?:[：:、\s].*)?|Chapter\s+\d+(?:\s*[:：\-—].*)?|CHAPTER\s+\d+(?:\s*[:：\-—].*)?|楔子(?:[：:、\s].*)?|序章(?:[：:、\s].*)?|序言(?:[：:、\s].*)?|引子(?:[：:、\s].*)?|尾声(?:[：:、\s].*)?|后记(?:[：:、\s].*)?|番外(?:[：:、\s].*)?)$/i;

  function trim(s) { return String(s || '').trim(); }

  function splitChapters(content) {
    var text = trim(content);
    if (!text) return [{ title: '正文', content: '' }];

    var lines = text.split('\n');
    var chapters = [];
    var currentTitle = '';
    var buf = [];

    function flush() {
      var body = buf.join('\n').trim();
      if (!body && !currentTitle) return;
      chapters.push({
        title: currentTitle || (chapters.length ? '未命名章节' : '正文'),
        content: body
      });
      buf = [];
    }

    lines.forEach(function (line) {
      var t = trim(line);
      if (t && CHAPTER_LINE_RE.test(t)) {
        flush();
        currentTitle = t;
        return;
      }
      buf.push(line);
    });
    flush();

    if (chapters.length <= 1 && !CHAPTER_LINE_RE.test(chapters[0] && chapters[0].title)) {
      return [{ title: '全文', content: text }];
    }
    return chapters;
  }

  function splitPages(content) {
    var text = trim(content);
    if (!text) return ['（空白篇章）'];
    var paras = text.split(/\n{2,}/);
    var pages = [];
    var buf = '';
    paras.forEach(function (p) {
      var chunk = trim(p);
      if (!chunk) return;
      if ((buf + '\n\n' + chunk).length > CHARS_PER_PAGE && buf) {
        pages.push(buf.trim());
        buf = chunk;
      } else {
        buf = buf ? buf + '\n\n' + chunk : chunk;
      }
    });
    if (buf) pages.push(buf.trim());
    if (!pages.length) pages.push(text.slice(0, CHARS_PER_PAGE));
    return pages;
  }

  function buildPages(chaptersOrContent) {
    var chapters;
    if (Array.isArray(chaptersOrContent)) {
      chapters = chaptersOrContent;
    } else if (chaptersOrContent && chaptersOrContent.chapters) {
      chapters = chaptersOrContent.chapters;
    } else {
      chapters = splitChapters(chaptersOrContent);
    }

    var pages = [];
    chapters.forEach(function (ch, ci) {
      var chPages = splitPages(ch.content);
      chPages.forEach(function (text, pi) {
        pages.push({
          text: text,
          chapterTitle: ch.title,
          chapterIndex: ci,
          isChapterStart: pi === 0
        });
      });
    });

    if (!pages.length) {
      pages.push({
        text: '（空白篇章）',
        chapterTitle: '正文',
        chapterIndex: 0,
        isChapterStart: true
      });
    }
    return pages;
  }

  function parseImportedText(content) {
    var chapters = splitChapters(content);
    return {
      chapters: chapters,
      content: content
    };
  }

  global.miyaTypewriterText = {
    CHARS_PER_PAGE: CHARS_PER_PAGE,
    splitChapters: splitChapters,
    splitPages: splitPages,
    buildPages: buildPages,
    parseImportedText: parseImportedText
  };
})(window);
