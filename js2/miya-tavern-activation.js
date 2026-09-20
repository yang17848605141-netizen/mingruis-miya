(function (global) {
  'use strict';

  var LS_KEY = 'miya-tavern-import-lic-v1';
  var core = global.MiyaTavernActivationCore;
  var _ready = false;
  var _activated = false;
  var _deviceCode = '';
  var modalRoot = null;
  var modalResolve = null;

  function getDeviceId() {
    if (global.miyaAuth && typeof global.miyaAuth.getDeviceId === 'function') {
      return global.miyaAuth.getDeviceId();
    }
    try {
      var id = localStorage.getItem('miya-device-id');
      if (!id) {
        id = (global.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem('miya-device-id', id);
      }
      return id;
    } catch (e) {
      return 'd-fallback';
    }
  }

  function copyText(text) {
    text = String(text || '');
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return Promise.resolve(fallbackCopy(text));
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      document.body.removeChild(ta);
      return false;
    }
  }

  function toast(msg) {
    if (global.miyaContactsApp && global.miyaContactsApp.toast) {
      global.miyaContactsApp.toast(msg);
    }
  }

  function refreshDeviceCode() {
    if (!core) { _deviceCode = ''; return ''; }
    _deviceCode = core.deviceIdToDeviceCode(getDeviceId());
    return _deviceCode;
  }

  function loadActivationState() {
    if (!core) { _activated = false; return false; }
    var deviceId = getDeviceId();
    refreshDeviceCode();
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) { _activated = false; return false; }
      var stored = JSON.parse(raw);
      if (!stored || stored.deviceId !== deviceId || !stored.code) {
        _activated = false;
        return false;
      }
      if (!core.verifyActivationCode(deviceId, stored.code)) {
        localStorage.removeItem(LS_KEY);
        _activated = false;
        return false;
      }
      _activated = true;
      return true;
    } catch (e) {
      _activated = false;
      return false;
    }
  }

  function activateWithCode(code) {
    if (!core) return false;
    var deviceId = getDeviceId();
    if (!core.verifyActivationCode(deviceId, code)) return false;
    _activated = true;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        deviceId: deviceId,
        code: core.normalizeActivationCode(code),
        activatedAt: Date.now()
      }));
    } catch (e) {
      return false;
    }
    return true;
  }

  function ensureModal() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement('div');
    modalRoot.className = 'mn-tavern-lic';
    modalRoot.hidden = true;
    modalRoot.innerHTML =
      '<div class="mn-tavern-lic__veil" data-tc-lic-close></div>' +
      '<div class="mn-tavern-lic__card" role="dialog" aria-modal="true">' +
      '<h2 class="mn-tavern-lic__title">酒馆卡导入 · 激活</h2>' +
      '<p class="mn-tavern-lic__desc">复制设备码发给管理员，收到激活码后填入下方。本设备激活后永久有效。</p>' +
      '<label class="mn-tavern-lic__label">本机设备码</label>' +
      '<div class="mn-tavern-lic__code-row">' +
      '<code class="mn-tavern-lic__code" id="mn-tavern-lic-device">—</code>' +
      '<button type="button" class="mn-btn" id="mn-tavern-lic-copy-device">复制</button>' +
      '</div>' +
      '<label class="mn-tavern-lic__label" for="mn-tavern-lic-input">激活码</label>' +
      '<input type="text" class="mn-input mn-tavern-lic__input" id="mn-tavern-lic-input" placeholder="TC-ACT-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">' +
      '<p class="mn-tavern-lic__err" id="mn-tavern-lic-err" hidden></p>' +
      '<div class="mn-tavern-lic__foot">' +
      '<button type="button" class="mn-btn" data-tc-lic-close>取消</button>' +
      '<button type="button" class="mn-btn mn-btn--fill" id="mn-tavern-lic-submit">激活</button>' +
      '</div></div>';
    document.body.appendChild(modalRoot);

    modalRoot.querySelector('#mn-tavern-lic-copy-device').addEventListener('click', function () {
      copyText(_deviceCode).then(function (ok) { toast(ok ? '设备码已复制' : '复制失败'); });
    });
    modalRoot.querySelector('#mn-tavern-lic-submit').addEventListener('click', submitModal);
    modalRoot.querySelector('#mn-tavern-lic-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitModal();
    });
    modalRoot.querySelectorAll('[data-tc-lic-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(false); });
    });
    return modalRoot;
  }

  function closeModal(result) {
    if (!modalRoot) return;
    modalRoot.hidden = true;
    document.body.classList.remove('mn-tavern-lic-open');
    var err = modalRoot.querySelector('#mn-tavern-lic-err');
    if (err) err.hidden = true;
    if (modalResolve) {
      modalResolve(!!result);
      modalResolve = null;
    }
  }

  function submitModal() {
    if (!modalRoot) return;
    var input = modalRoot.querySelector('#mn-tavern-lic-input');
    var errEl = modalRoot.querySelector('#mn-tavern-lic-err');
    var code = input ? String(input.value || '').trim() : '';
    if (!code) {
      if (errEl) { errEl.textContent = '请输入激活码'; errEl.hidden = false; }
      return;
    }
    if (activateWithCode(code)) {
      toast('酒馆卡导入已激活');
      closeModal(true);
      return;
    }
    if (errEl) { errEl.textContent = '激活码无效'; errEl.hidden = false; }
  }

  function showActivationModal() {
    ensureModal();
    refreshDeviceCode();
    var codeEl = modalRoot.querySelector('#mn-tavern-lic-device');
    var input = modalRoot.querySelector('#mn-tavern-lic-input');
    var errEl = modalRoot.querySelector('#mn-tavern-lic-err');
    if (codeEl) codeEl.textContent = _deviceCode || '—';
    if (input) input.value = '';
    if (errEl) errEl.hidden = true;
    modalRoot.hidden = false;
    document.body.classList.add('mn-tavern-lic-open');
    return new Promise(function (resolve) {
      modalResolve = resolve;
      setTimeout(function () { if (input) input.focus(); }, 60);
    });
  }

  function whenReady() {
    if (_ready) return Promise.resolve(_activated);
    _ready = true;
    loadActivationState();
    return Promise.resolve(_activated);
  }

  function ensureLicensed() {
    return whenReady().then(function (ok) {
      if (ok) return true;
      return showActivationModal();
    });
  }

  global.miyaTavernActivation = {
    whenReady: whenReady,
    isLicensed: function () { return _activated; },
    ensureLicensed: ensureLicensed,
    getDeviceCode: function () { refreshDeviceCode(); return _deviceCode; },
    showActivationModal: showActivationModal
  };
})(window);
