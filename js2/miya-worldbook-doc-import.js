(function (global) {
  'use strict';

  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function reportProgress(onProgress, pct, status) {
    if (typeof onProgress === 'function') onProgress(pct, status);
  }

  function localName(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.localName) return node.localName;
    var tag = String(node.tagName || '');
    var idx = tag.indexOf(':');
    return idx >= 0 ? tag.slice(idx + 1) : tag;
  }

  function isWordNs(ns) {
    return !ns || ns === W_NS || ns.indexOf('wordprocessingml') >= 0;
  }

  function decodeXmlEntities(s) {
    return String(s || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function collectByLocalName(root, name, out, nsFilter) {
    if (!root) return;
    (function walk(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        var ln = localName(node);
        if (ln === name) {
          if (!nsFilter || nsFilter(node.namespaceURI || '')) out.push(node);
        }
        for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      }
    })(root);
  }

  function appendRunText(node, parts) {
    if (!node || node.nodeType !== 1) return;
    var ln = localName(node);
    var ns = node.namespaceURI || '';

    if ((ln === 't' || ln === 'instrText' || ln === 'delText') && isWordNs(ns)) {
      parts.push(node.textContent || '');
      return;
    }
    if (ln === 't' && ns === A_NS) {
      parts.push(node.textContent || '');
      return;
    }
    if (ln === 'tab' || ln === 'ptab') {
      parts.push('\t');
      return;
    }
    if (ln === 'br' || ln === 'cr' || ln === 'lastRenderedPageBreak') {
      parts.push('\n');
      return;
    }
    if (ln === 'noBreakHyphen') {
      parts.push('-');
      return;
    }
    if (ln === 'softHyphen') {
      return;
    }
    if (ln === 'sym') {
      var ch = node.getAttributeNS(W_NS, 'char')
        || node.getAttribute('w:char')
        || node.getAttribute('char');
      if (ch) {
        var code = parseInt(ch, 16);
        if (!isNaN(code)) parts.push(String.fromCharCode(code));
      }
      return;
    }
    for (var i = 0; i < node.childNodes.length; i++) {
      appendRunText(node.childNodes[i], parts);
    }
  }

  function extractParagraphText(p) {
    var parts = [];
    appendRunText(p, parts);
    return parts.join('').replace(/\u00AD/g, '');
  }

  function extractDrawingTexts(root, seen) {
    var texts = [];
    collectByLocalName(root, 't', texts, function (ns) { return ns === A_NS; });
    var out = [];
    for (var i = 0; i < texts.length; i++) {
      var t = String(texts[i].textContent || '');
      if (!t || seen[t]) continue;
      seen[t] = true;
      out.push(t);
    }
    return out;
  }

  function isNestedParagraph(p) {
    var parent = p.parentElement;
    while (parent) {
      if (localName(parent) === 'p' && isWordNs(parent.namespaceURI || '')) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function collectParagraphs(root, out) {
    var allP = [];
    collectByLocalName(root, 'p', allP, isWordNs);
    for (var i = 0; i < allP.length; i++) {
      if (!isNestedParagraph(allP[i])) out.push(allP[i]);
    }
  }

  function docxXmlToPlain(xmlString) {
    var xml = String(xmlString || '');
    if (!xml.trim()) return '';

    var doc;
    try {
      doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (e) {
      doc = null;
    }

    if (!doc || doc.querySelector('parsererror')) {
      return docxPlainFromRegex(xml);
    }

    var paragraphs = [];
    collectParagraphs(doc.documentElement, paragraphs);

    var lines = [];
    var seenDrawing = {};

    if (paragraphs.length) {
      for (var i = 0; i < paragraphs.length; i++) {
        lines.push(extractParagraphText(paragraphs[i]));
      }
    }

    var drawingLines = extractDrawingTexts(doc.documentElement, seenDrawing);
    if (drawingLines.length) {
      lines = lines.concat(drawingLines);
    }

    var body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body) return body;

    return docxPlainFromRegex(xml);
  }

  function docxPlainFromRegex(xml) {
    var lines = [];
    var pRe = /<w:p\b[\s\S]*?<\/w:p>/gi;
    var pMatch;
    var foundP = false;

    while ((pMatch = pRe.exec(xml))) {
      foundP = true;
      lines.push(extractParagraphFromRegexBlock(pMatch[0]));
    }

    if (foundP) {
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    var allT = [];
    var tRe = /<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/gi;
    var tMatch;
    while ((tMatch = tRe.exec(xml))) {
      allT.push(decodeXmlEntities(tMatch[1]));
    }
    return allT.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function extractParagraphFromRegexBlock(block) {
    var parts = [];
    block.replace(/<w:tab\s*\/>/gi, function () { parts.push('\t'); return ''; });
    block.replace(/<w:ptab\b[^>]*\/>/gi, function () { parts.push('\t'); return ''; });
    block.replace(/<w:br\b[^>]*\/>/gi, function () { parts.push('\n'); return ''; });
    block.replace(/<w:cr\b[^>]*\/>/gi, function () { parts.push('\n'); return ''; });
    block.replace(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/gi, function (_, t) {
      parts.push(decodeXmlEntities(t));
      return '';
    });
    return parts.join('').replace(/\u00AD/g, '');
  }

  function docxPartSortScore(path) {
    if (/document\.xml$/i.test(path)) return 0;
    if (/header\d+\.xml$/i.test(path)) return 1;
    if (/footer\d+\.xml$/i.test(path)) return 2;
    if (/footnotes\.xml$/i.test(path)) return 3;
    if (/endnotes\.xml$/i.test(path)) return 4;
    return 5;
  }

  function listDocxTextParts(zip) {
    var paths = [];
    zip.forEach(function (relativePath, file) {
      if (!file || file.dir) return;
      if (/^word\/(document\d*|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(relativePath)) {
        paths.push(relativePath);
      }
    });
    if (!paths.length && zip.file('word/document.xml')) {
      paths.push('word/document.xml');
    }
    paths.sort(function (a, b) {
      var d = docxPartSortScore(a) - docxPartSortScore(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
    return paths;
  }

  function readDocxArrayBuffer(buf, onProgress) {
    reportProgress(onProgress, 58, '正在解压文档…');
    if (!global.JSZip) return Promise.reject(new Error('jszip_missing'));
    return global.JSZip.loadAsync(buf).then(function (zip) {
      var paths = listDocxTextParts(zip);
      if (!paths.length) return Promise.reject(new Error('docx_no_document'));
      reportProgress(onProgress, 72, '正在提取正文…');
      return Promise.all(paths.map(function (path) {
        return zip.file(path).async('string');
      }));
    }).then(function (xmlStrings) {
      reportProgress(onProgress, 86, '正在整理段落…');
      var chunks = [];
      for (var i = 0; i < xmlStrings.length; i++) {
        var part = docxXmlToPlain(xmlStrings[i]);
        if (part) chunks.push(part);
      }
      return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    });
  }

  function isValidUtf8(u8) {
    var i = 0;
    while (i < u8.length) {
      var b = u8[i];
      if (b <= 0x7F) { i++; continue; }
      if (b >= 0xC2 && b <= 0xDF) {
        if (i + 1 >= u8.length || (u8[i + 1] & 0xC0) !== 0x80) return false;
        i += 2;
        continue;
      }
      if (b >= 0xE0 && b <= 0xEF) {
        if (i + 2 >= u8.length) return false;
        var b1 = u8[i + 1];
        var b2 = u8[i + 2];
        if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80) return false;
        if (b === 0xE0 && b1 < 0xA0) return false;
        if (b === 0xED && b1 >= 0xA0) return false;
        i += 3;
        continue;
      }
      if (b >= 0xF0 && b <= 0xF4) {
        if (i + 3 >= u8.length) return false;
        var c1 = u8[i + 1];
        var c2 = u8[i + 2];
        var c3 = u8[i + 3];
        if ((c1 & 0xC0) !== 0x80 || (c2 & 0xC0) !== 0x80 || (c3 & 0xC0) !== 0x80) return false;
        if (b === 0xF0 && c1 < 0x90) return false;
        if (b === 0xF4 && c1 >= 0x90) return false;
        i += 4;
        continue;
      }
      return false;
    }
    return true;
  }

  function decodeWithLabel(u8, label) {
    try {
      return new TextDecoder(label).decode(u8);
    } catch (e) {
      return '';
    }
  }

  function decodeTxtBuffer(buf) {
    var u8 = new Uint8Array(buf || []);
    if (!u8.length) return '';

    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(u8.subarray(2));
    }

    if (isValidUtf8(u8)) {
      return new TextDecoder('utf-8').decode(u8);
    }

    if (global.miyaDecodeGbkBuffer) {
      return global.miyaDecodeGbkBuffer(u8);
    }

    var labels = ['gb18030', 'gbk', 'gb2312', 'windows-936'];
    for (var i = 0; i < labels.length; i++) {
      var text = decodeWithLabel(u8, labels[i]);
      if (text) return text;
    }

    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }

  function readArrayBufferWithProgress(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onprogress = function (e) {
        if (!e.lengthComputable) return;
        reportProgress(onProgress, Math.min(52, Math.round((e.loaded / e.total) * 52)), '正在读取文件…');
      };
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('read_failed')); };
      reportProgress(onProgress, 2, '正在读取文件…');
      reader.readAsArrayBuffer(file);
    });
  }

  function readTxtFile(file, onProgress) {
    return readArrayBufferWithProgress(file, onProgress).then(function (buf) {
      reportProgress(onProgress, 58, '正在识别编码…');
      return new Promise(function (resolve) {
        setTimeout(function () {
          reportProgress(onProgress, 72, '正在解码正文…');
          var text = decodeTxtBuffer(buf);
          reportProgress(onProgress, 88, '正在整理内容…');
          resolve(text);
        }, 0);
      });
    });
  }

  function extractTextFromFile(file, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;
    if (!file) return Promise.reject(new Error('no_file'));
    var ext = extOf(file.name);
    if (ext === 'txt' || ext === 'css') return readTxtFile(file, onProgress);
    if (ext === 'docx') {
      return readArrayBufferWithProgress(file, onProgress).then(function (buf) {
        return readDocxArrayBuffer(buf, onProgress);
      });
    }
    return Promise.reject(new Error('unsupported_type'));
  }

  global.miyaWorldbookExtractFileText = extractTextFromFile;
})(window);
