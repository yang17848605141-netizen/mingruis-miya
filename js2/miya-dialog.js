(function (global) {
  'use strict';

  var root = null;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'miya-dialog-root';
    root.hidden = true;
    root.innerHTML =
      '<div class="miya-dialog-backdrop" data-miya-dialog-close></div>' +
      '<div class="miya-dialog-card glass" role="dialog" aria-modal="true">' +
      '<h3 class="miya-dialog-title" id="miya-dialog-title"></h3>' +
      '<p class="miya-dialog-msg" id="miya-dialog-msg"></p>' +
      '<input type="text" class="miya-dialog-input" id="miya-dialog-input" hidden>' +
      '<textarea class="miya-dialog-input miya-dialog-textarea" id="miya-dialog-textarea" hidden rows="8"></textarea>' +
      '<div class="miya-dialog-actions" id="miya-dialog-actions"></div>' +
      '</div>';
    document.body.appendChild(root);
    if (global.miyaApplyFontSizeForKey) global.miyaApplyFontSizeForKey('system');
    root.querySelector('[data-miya-dialog-close]').addEventListener('click', function () {
      if (!root._resolve) return;
      if (root._openedAt && Date.now() - root._openedAt < 350) return;
      root._resolve(root._mode === 'confirm' ? false : null);
      hide();
    });
    return root;
  }

  function setFieldVisible(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.classList.toggle('is-active', !!on);
  }

  function hide() {
    if (!root) return;
    root.hidden = true;
    root._resolve = null;
    root._mode = null;
    root._openedAt = 0;
    document.body.classList.remove('miya-dialog-open');
    setFieldVisible(document.getElementById('miya-dialog-input'), false);
    setFieldVisible(document.getElementById('miya-dialog-textarea'), false);
    var card = root.querySelector('.miya-dialog-card');
    if (card) card.classList.remove('miya-dialog-card--large');
  }

  function show(opts) {
    ensureRoot();
    var titleEl = document.getElementById('miya-dialog-title');
    var msgEl = document.getElementById('miya-dialog-msg');
    var inp = document.getElementById('miya-dialog-input');
    var ta = document.getElementById('miya-dialog-textarea');
    var card = root.querySelector('.miya-dialog-card');
    var actions = document.getElementById('miya-dialog-actions');
    var field = inp;
    titleEl.textContent = opts.title || '';
    var msg = opts.message || '';
    msgEl.textContent = msg;
    msgEl.hidden = !msg;
    actions.innerHTML = '';
    if (card) card.classList.toggle('miya-dialog-card--large', opts.size === 'large');

    if (opts.mode === 'prompt') {
      var useMultiline = !!opts.multiline;
      if (useMultiline && ta) {
        setFieldVisible(inp, false);
        setFieldVisible(ta, true);
        ta.value = opts.defaultValue || '';
        ta.placeholder = opts.placeholder || '';
        ta.rows = Math.max(4, parseInt(opts.rows, 10) || 8);
        field = ta;
      } else {
        setFieldVisible(ta, false);
        setFieldVisible(inp, true);
        inp.value = opts.defaultValue || '';
        inp.placeholder = opts.placeholder || '';
        field = inp;
      }
    } else {
      setFieldVisible(inp, false);
      setFieldVisible(ta, false);
    }

    var activeEl = document.activeElement;
    if (activeEl && activeEl.closest && activeEl.closest('.qq-room__foot, .qq-room__input-box')) {
      activeEl.blur();
    }

    return new Promise(function (resolve) {
      root._resolve = resolve;
      root._mode = opts.mode;
      root._openedAt = Date.now();
      function done(val) {
        resolve(val);
        hide();
      }
      if (opts.mode === 'confirm') {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'miya-dialog-btn';
        cancel.textContent = opts.cancelText || '取消';
        cancel.addEventListener('click', function () { done(false); });
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'miya-dialog-btn miya-dialog-btn--primary';
        ok.textContent = opts.confirmText || '确定';
        ok.addEventListener('click', function () { done(true); });
        actions.appendChild(cancel);
        actions.appendChild(ok);
      } else if (opts.mode === 'prompt') {
        var c2 = document.createElement('button');
        c2.type = 'button';
        c2.className = 'miya-dialog-btn';
        c2.textContent = opts.cancelText || '取消';
        c2.addEventListener('click', function () { done(null); });
        var o2 = document.createElement('button');
        o2.type = 'button';
        o2.className = 'miya-dialog-btn miya-dialog-btn--primary';
        o2.textContent = opts.confirmText || '确定';
        o2.addEventListener('click', function () { done(field.value); });
        actions.appendChild(c2);
        actions.appendChild(o2);
        setTimeout(function () { field.focus(); field.select(); }, 50);
      } else {
        var a = document.createElement('button');
        a.type = 'button';
        a.className = 'miya-dialog-btn miya-dialog-btn--primary';
        a.textContent = opts.confirmText || '知道了';
        a.addEventListener('click', function () { done(true); });
        actions.appendChild(a);
      }
      root.hidden = false;
      document.body.classList.add('miya-dialog-open');
    });
  }

  global.miyaDialog = {
    alert: function (opts) { return show(Object.assign({ mode: 'alert' }, opts || {})); },
    confirm: function (opts) { return show(Object.assign({ mode: 'confirm' }, opts || {})); },
    prompt: function (opts) { return show(Object.assign({ mode: 'prompt' }, opts || {})); }
  };

  global.miyaSlidePanel = {
    open: function (el) {
      if (!el) return;
      el.hidden = false;
      el.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () { el.classList.add('is-open'); });
    },
    close: function (el, opts) {
      opts = opts || {};
      if (!el || el.hidden) return;
      var ms = opts.ms != null ? opts.ms : 340;
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
      setTimeout(function () {
        el.hidden = true;
        if (typeof opts.onDone === 'function') opts.onDone();
      }, ms);
    }
  };
})(window);
