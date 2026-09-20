(function (global) {
  'use strict';

  var SECRET = 'miya-tc-v1-w8n4k2p9x';

  function clean(raw, prefix) {
    return String(raw || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/-/g, '')
      .toUpperCase()
      .replace(new RegExp('^' + prefix), '');
  }

  function normalizeDeviceCode(raw) {
    return clean(raw, 'TCDEV');
  }

  function normalizeActivationCode(raw) {
    return clean(raw, 'TCACT');
  }

  function hash(text) {
    var s = SECRET + '|' + String(text || '');
    var h = 2166136261;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36).toUpperCase();
  }

  function formatCode(prefix, body) {
    body = String(body || '').replace(/[^A-Z0-9]/g, '').toUpperCase();
    while (body.length < 16) body += hash(body + prefix).replace(/[^A-Z0-9]/g, '');
    return prefix + '-' + body.slice(0, 4) + '-' + body.slice(4, 8) + '-' + body.slice(8, 12) +
      (prefix === 'TC-ACT' ? '-' + body.slice(12, 16) : '');
  }

  function deviceIdToDeviceCode(deviceId) {
    var id = String(deviceId || '').trim();
    if (!id) return '';
    return formatCode('TC-DEV', hash('dev:' + id));
  }

  function generateActivationCode(deviceCode) {
    var norm = normalizeDeviceCode(deviceCode);
    if (!norm) return '';
    return formatCode('TC-ACT', hash('act:' + norm));
  }

  function verifyActivationCode(deviceId, activationCode) {
    var devCode = deviceIdToDeviceCode(deviceId);
    if (!devCode) return false;
    var expected = generateActivationCode(devCode);
    return normalizeActivationCode(expected) === normalizeActivationCode(activationCode);
  }

  global.MiyaTavernActivationCore = {
    normalizeDeviceCode: normalizeDeviceCode,
    normalizeActivationCode: normalizeActivationCode,
    deviceIdToDeviceCode: deviceIdToDeviceCode,
    generateActivationCode: generateActivationCode,
    verifyActivationCode: verifyActivationCode
  };
})(typeof window !== 'undefined' ? window : global);
