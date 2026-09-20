/**
 * miya-diary-scheduler.js — 角色定时自动写日记
 */
(function (global) {
  'use strict';

  var SCAN_MS = 30000;
  var SCAN_MS_MOBILE = 60000;
  var tickTimer = null;
  var tickBooted = false;
  var queue = [];
  var queued = Object.create(null);
  var workerBusy = false;
  var inFlight = Object.create(null);

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches);
  }

  function getScanMs() {
    return isMobileDevice() ? SCAN_MS_MOBILE : SCAN_MS;
  }

  function stopTick() {
    if (!tickTimer) return;
    if (typeof tickTimer === 'function') {
      tickTimer();
    } else {
      clearInterval(tickTimer);
    }
    tickTimer = null;
  }

  function startIntervalTick(ms) {
    if (global.miyaBgSetInterval) return global.miyaBgSetInterval(checkAllContacts, ms);
    return setInterval(checkAllContacts, ms);
  }

  function store() { return global.miyaDiaryStore || null; }
  function bridge() { return global.miyaDiaryBridge || null; }

  function displayName(contact) {
    if (!contact) return 'TA';
    return String(contact.remarkName || contact.name || 'TA').trim();
  }

  function getContact(id) {
    var cs = global.miyaChatStore;
    if (!cs || !id) return null;
    return (cs.getContacts() || []).find(function (c) { return c && c.id === id; }) || null;
  }

  function todayIsoForContact(contact) {
    var br = bridge();
    if (br && typeof br.buildDiaryContext === 'function') {
      return br.buildDiaryContext(contact).todayIso;
    }
    var st = store();
    return st && st.isoDate ? st.isoDate(new Date()) : '';
  }

  function notifyDiaryReady(contact) {
    var name = displayName(contact);
    var title = name + '今天的日记写好了';
    var body = '「' + name + '」的今日日记已自动写好，点开日记本看看吧。';
    if (global.miyaShowSystemNotification) {
      global.miyaShowSystemNotification(title, {
        body: body,
        tag: 'miya-diary-auto-' + String(contact.id || ''),
        data: { kind: 'diary_auto', contactId: String(contact.id || '') }
      });
    }
  }

  function enqueue(contactId) {
    var key = String(contactId || '');
    if (!key || queued[key]) return;
    queued[key] = true;
    queue.push(key);
    runWorker();
  }

  function runWorker() {
    if (workerBusy) return;
    workerBusy = true;
    (function next() {
      if (!queue.length) {
        workerBusy = false;
        return;
      }
      var cid = queue.shift();
      delete queued[cid];
      if (inFlight[cid]) return next();
      inFlight[cid] = true;
      triggerAutoWrite(cid).finally(function () {
        delete inFlight[cid];
        next();
      });
    })();
  }

  function triggerAutoWrite(contactId) {
    var st = store();
    var br = bridge();
    if (!st || !br || typeof br.generateTodayDiary !== 'function') {
      return Promise.resolve(false);
    }
    var contact = getContact(contactId);
    if (!contact) return Promise.resolve(false);
    var settings = st.getDiarySettings(contactId);
    if (!settings.autoWrite.enabled) return Promise.resolve(false);

    var today = todayIsoForContact(contact);
    if (settings.autoWrite.lastRunDateIso === today) return Promise.resolve(false);

  return br.generateTodayDiary(contact).then(function (row) {
      if (row) {
        st.saveDiarySettings(contactId, {
          autoWrite: { lastRunDateIso: today }
        });
        notifyDiaryReady(contact);
        if (global.miyaDiaryApp && typeof global.miyaDiaryApp.onAutoDiaryReady === 'function') {
          global.miyaDiaryApp.onAutoDiaryReady(contactId, row);
        }
        return true;
      }
      return false;
    }).catch(function () {
      return false;
    });
  }

  function isDueNow(settings, now) {
    if (!settings || !settings.autoWrite || !settings.autoWrite.enabled) return false;
    var aw = settings.autoWrite;
    var h = Number(aw.hour);
    var m = Number(aw.minute);
    if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return false;
    return now.getHours() === h && now.getMinutes() === m;
  }

  function checkAllContacts() {
    var st = store();
    if (!st) return;
    var contacts = st.getAllContactRows();
    if (!contacts.length) return;
    var now = new Date();
    contacts.forEach(function (contact) {
      if (!contact || !contact.id) return;
      var settings = st.getDiarySettings(contact.id);
      if (!isDueNow(settings, now)) return;
      var today = todayIsoForContact(contact);
      if (settings.autoWrite.lastRunDateIso === today) return;
      enqueue(contact.id);
    });
  }

  function startTick() {
    if (tickBooted) return;
    tickBooted = true;
    checkAllContacts();
    if (!document.hidden) {
      tickTimer = startIntervalTick(getScanMs());
    }
    if (!global.__miyaDiaryAutoVisBound) {
      global.__miyaDiaryAutoVisBound = true;
      function onDiaryForeground() {
        checkAllContacts();
        if (tickBooted && !tickTimer) {
          tickTimer = startIntervalTick(getScanMs());
        }
      }
      if (typeof global.miyaBindForeground === 'function') {
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) stopTick();
        });
        global.miyaBindForeground(onDiaryForeground);
      } else {
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) {
            stopTick();
            return;
          }
          onDiaryForeground();
        });
        window.addEventListener('pageshow', function () {
          if (!document.hidden) onDiaryForeground();
        });
      }
    }
  }

  function boot() {
    var chain = Promise.resolve();
    if (global.miyaBootstrapKvStores) {
      chain = chain.then(function () { return global.miyaBootstrapKvStores(); });
    }
    var cs = global.miyaChatStore;
    if (cs && typeof cs.init === 'function') {
      chain = chain.then(function () { return cs.init(); });
    }
    chain.then(function () {
      startTick();
    }).catch(function () {
      startTick();
    });
  }

  global.miyaDiaryScheduler = {
    boot: boot,
    checkAllContacts: checkAllContacts,
    triggerAutoWrite: triggerAutoWrite
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : global);
