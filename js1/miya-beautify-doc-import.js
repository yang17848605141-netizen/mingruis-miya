/**
 * 美化 CSS · 从 docx / txt / css 快捷导入（线上聊天 / 线下 / 桌面歌词）
 */
(function (global) {
  'use strict';

  var FILE_ACCEPT = '.txt,.docx,.css,text/plain,text/css,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function looksLikeCssBlock(text) {
    var s = String(text || '').trim();
    if (!s) return false;
    return /[{][\s\S]*?[}]/.test(s);
  }

  /** 从混合文稿中提取 CSS 段落；纯 CSS 则原样返回 */
  function extractCssFromText(raw) {
    var s = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!s) return '';

    var fenced = s.match(/```(?:css)?\s*\r?\n([\s\S]*?)```/i);
    if (fenced && fenced[1].trim()) return fenced[1].trim();

    var marked = s.match(
      /(?:^|\n)\s*(?:#{1,3}\s*)?(?:自定义\s*)?CSS\s*[：:]?\s*\r?\n([\s\S]*?)(?=\n\s*(?:#{1,3}\s+|={3,}|-{3,}\s*\n|选择器参考|源码参考|源码 ·|类名参考|$))/i
    );
    if (marked && marked[1].trim() && looksLikeCssBlock(marked[1])) return marked[1].trim();

    var parts = s.split(/\n\s*-{3,}\s*\n/);
    if (parts.length > 1) {
      for (var i = parts.length - 1; i >= 0; i--) {
        if (looksLikeCssBlock(parts[i])) return parts[i].trim();
      }
    }

    return s;
  }

  function extractTextFromFile(file) {
    if (!file) return Promise.reject(new Error('no_file'));
    if (!global.miyaWorldbookExtractFileText) {
      return Promise.reject(new Error('import_module_missing'));
    }
    return global.miyaWorldbookExtractFileText(file);
  }

  function isEditableCssTextarea(el) {
    if (!el || el.tagName !== 'TEXTAREA') return false;
    if (el.readOnly || el.hasAttribute('readonly')) return false;
    if (el.hasAttribute('data-mq-bf-src-readonly') || el.hasAttribute('data-xw-bf-src-readonly')) {
      return false;
    }
    return true;
  }

  /** 清空可编辑框并写入全文；不触碰只读参考区与预设下拉 */
  function fillCssTextarea(textarea, text) {
    if (!isEditableCssTextarea(textarea)) return false;
    textarea.value = String(text || '').replace(/^\uFEFF/, '').trim();
    try {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      var ev = document.createEvent('Event');
      ev.initEvent('input', true, true);
      textarea.dispatchEvent(ev);
    }
    return true;
  }

  function importFileToTextarea(file, textarea) {
    return extractTextFromFile(file).then(function (raw) {
      var t = String(raw || '').trim();
      if (!t) return Promise.reject(new Error('empty_text'));
      if (!fillCssTextarea(textarea, t)) return Promise.reject(new Error('no_target'));
      return t;
    });
  }

  function pickAndImport(textarea) {
    return new Promise(function (resolve, reject) {
      if (!isEditableCssTextarea(textarea)) {
        reject(new Error('no_target'));
        return;
      }
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = FILE_ACCEPT;
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        inp.remove();
        if (!file) {
          reject(new Error('no_file'));
          return;
        }
        importFileToTextarea(file, textarea).then(resolve).catch(reject);
      });
      document.body.appendChild(inp);
      if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(inp);
      else inp.click();
    });
  }

  function toastError(err, toastFn) {
    var code = err && err.message;
    var msg = '导入失败';
    if (code === 'unsupported_type') msg = '仅支持 .txt、.docx 与 .css';
    else if (code === 'empty_text') msg = '未能识别到文字内容';
    else if (code === 'jszip_missing') msg = '文档解析库未加载';
    else if (code === 'import_module_missing') msg = '文档解析模块未加载';
    else if (code === 'no_file') return;
    if (typeof toastFn === 'function') toastFn(msg);
  }

  global.miyaBeautifyDocImport = {
    ACCEPT: FILE_ACCEPT,
    extractCssFromText: extractCssFromText,
    importFileToTextarea: importFileToTextarea,
    pickAndImport: pickAndImport,
    toastError: toastError
  };
})(window);
