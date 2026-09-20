/**
 * miya-deep-couple-store.js — 深入 · 角色手机 情侣手册数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function coupleKey(contactId) {
    return 'couple:' + String(contactId || '').trim();
  }

  function invalidateDb(promise) {
    if (dbPromise === promise) dbPromise = null;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      var settled = false;
      req.onerror = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(req.error || new Error('deep_couple_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_couple_idb_blocked'));
      };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(PHONES_STORE)) {
          db.createObjectStore(PHONES_STORE);
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (e) {}
          invalidateDb(dbPromise);
        };
        db.onclose = function () { invalidateDb(dbPromise); };
        if (settled) {
          try { db.close(); } catch (e2) {}
          return;
        }
        resolve(db);
      };
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readonly');
        var req = tx.objectStore(PHONES_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readwrite');
        tx.objectStore(PHONES_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function defaultCoupleData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      couple: null
    };
  }

  function normalizeItem(raw, index, prefix, textKeys) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: prefix + '-' + (index + 1), text: raw.trim() };
      }
      return null;
    }
    var text = '';
    var i;
    for (i = 0; i < textKeys.length; i++) {
      text = String(raw[textKeys[i]] || '').trim();
      if (text) break;
    }
    if (!text && !String(raw.title || '').trim()) return null;
    return Object.assign({}, raw, {
      id: String(raw.id || prefix + '-' + (index + 1)),
      text: text || String(raw.title || '').trim()
    });
  }

  function normalizeHero(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        coverTitle: '',
        intimacyIndex: 0,
        intimacyLabel: '',
        statusLine: '',
        softVow: '',
        coverStamp: '',
        partnerAlias: ''
      };
    }
    return {
      coverTitle: String(raw.coverTitle || raw.title || '').trim(),
      intimacyIndex: Math.max(0, Math.min(100, Number(raw.intimacyIndex != null ? raw.intimacyIndex : raw.score) || 0)),
      intimacyLabel: String(raw.intimacyLabel || raw.label || '').trim(),
      statusLine: String(raw.statusLine || raw.status || '').trim(),
      softVow: String(raw.softVow || raw.vow || '').trim(),
      coverStamp: String(raw.coverStamp || raw.stamp || '').trim(),
      partnerAlias: String(raw.partnerAlias || raw.alias || raw.nickname || '').trim()
    };
  }

  function normalizeAtlas(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var body = String(raw.body || raw.content || raw.text || raw.detail || '').trim();
    if (!title && !body) return null;
    return {
      id: String(raw.id || 'atlas-' + (index + 1)),
      chapter: String(raw.chapter || raw.no || (index + 1)).trim(),
      title: title || ('章节 ' + (index + 1)),
      when: String(raw.when || raw.date || raw.time || '').trim(),
      mood: String(raw.mood || raw.tag || '').trim(),
      body: body,
      starred: !!raw.starred
    };
  }

  function normalizeSecret(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'sec-' + (index + 1)),
      title: String(raw.title || raw.label || '机密页').trim(),
      grade: String(raw.grade || raw.level || 'CONFIDENTIAL').trim(),
      content: content,
      unsealed: !!raw.unsealed
    };
  }

  function normalizePulse(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'pulse-' + (index + 1), time: '', beat: '', note: raw.trim(), expanded: false };
      }
      return null;
    }
    var note = String(raw.note || raw.text || raw.content || raw.body || '').trim();
    if (!note) return null;
    return {
      id: String(raw.id || 'pulse-' + (index + 1)),
      time: String(raw.time || raw.when || raw.stamp || '').trim(),
      beat: String(raw.beat || raw.mood || raw.pulse || '').trim(),
      note: note,
      expanded: !!raw.expanded
    };
  }

  function normalizeRitual(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.text || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'rit-' + (index + 1)),
      title: title,
      cadence: String(raw.cadence || raw.freq || raw.when || '').trim(),
      note: String(raw.note || raw.detail || '').trim(),
      done: !!raw.done
    };
  }

  function normalizeMemory(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var front = String(raw.front || raw.title || raw.caption || '').trim();
    var back = String(raw.back || raw.content || raw.text || raw.body || '').trim();
    if (!front && !back) return null;
    return {
      id: String(raw.id || 'mem-' + (index + 1)),
      front: front || '记忆碎片',
      back: back,
      place: String(raw.place || raw.where || '').trim(),
      flipped: !!raw.flipped
    };
  }

  function normalizeWish(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'wish-' + (index + 1), text: raw.trim(), tone: '', starred: false };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.title || raw.wish || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'wish-' + (index + 1)),
      text: text,
      tone: String(raw.tone || raw.mood || raw.tag || '').trim(),
      starred: !!raw.starred
    };
  }

  function normalizeDict(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var word = String(raw.word || raw.term || raw.key || raw.title || '').trim();
    var meaning = String(raw.meaning || raw.def || raw.text || raw.content || '').trim();
    if (!word && !meaning) return null;
    return {
      id: String(raw.id || 'dict-' + (index + 1)),
      word: word || ('词条 ' + (index + 1)),
      meaning: meaning,
      usage: String(raw.usage || raw.example || '').trim()
    };
  }

  function normalizeForecast(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var day = String(raw.day || raw.date || raw.when || '').trim();
    var mood = String(raw.mood || raw.feeling || '').trim();
    var note = String(raw.note || raw.text || raw.content || '').trim();
    if (!day && !mood && !note) return null;
    return {
      id: String(raw.id || 'fc-' + (index + 1)),
      day: day || ('Day ' + (index + 1)),
      mood: mood,
      note: note
    };
  }

  function normalizeConfession(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'cf-' + (index + 1)),
      title: String(raw.title || raw.label || '未寄出的信').trim(),
      content: content,
      urgency: String(raw.urgency || raw.tone || '').trim(),
      revealed: !!raw.revealed
    };
  }

  function normalizePromise(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var text = String(raw.text || raw.promise || raw.content || raw.title || '').trim();
    if (!text) return null;
    var side = String(raw.side || raw.from || 'us').trim().toLowerCase();
    if (side !== 'me' && side !== 'you' && side !== 'us') side = 'us';
    return {
      id: String(raw.id || 'pr-' + (index + 1)),
      text: text,
      side: side,
      kept: !!raw.kept
    };
  }

  function normalizeTicket(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.scene || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'tk-' + (index + 1)),
      title: title,
      when: String(raw.when || raw.time || '').trim(),
      place: String(raw.place || raw.where || '').trim(),
      detail: String(raw.detail || raw.note || raw.text || '').trim(),
      stamped: !!raw.stamped
    };
  }

  function normalizeNight(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'night-' + (index + 1), time: '', text: raw.trim() };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.body || raw.note || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'night-' + (index + 1)),
      time: String(raw.time || raw.when || '').trim(),
      text: text
    };
  }

  function normalizeQuiz(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var q = String(raw.q || raw.question || raw.prompt || '').trim();
    var a = String(raw.a || raw.answer || raw.reveal || '').trim();
    if (!q) return null;
    return {
      id: String(raw.id || 'qz-' + (index + 1)),
      q: q,
      a: a,
      hint: String(raw.hint || '').trim(),
      revealed: !!raw.revealed
    };
  }

  function normalizeCouplePayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      dateLabel: String(raw.dateLabel || raw.date || '').trim(),
      fileNo: String(raw.fileNo || raw.caseNo || raw.dossierId || raw.archiveNo || '').trim(),
      hero: normalizeHero(raw.hero),
      openLetter: String(raw.openLetter || raw.letter || raw.preface || '').trim(),
      summary: String(raw.summary || raw.overview || raw.note || '').trim(),
      loveAtlas: Array.isArray(raw.loveAtlas)
        ? raw.loveAtlas.map(normalizeAtlas).filter(Boolean)
        : (Array.isArray(raw.atlas) ? raw.atlas.map(normalizeAtlas).filter(Boolean) : []),
      secretFiles: Array.isArray(raw.secretFiles)
        ? raw.secretFiles.map(normalizeSecret).filter(Boolean)
        : (Array.isArray(raw.secrets) ? raw.secrets.map(normalizeSecret).filter(Boolean) : []),
      heartbeatLog: Array.isArray(raw.heartbeatLog)
        ? raw.heartbeatLog.map(normalizePulse).filter(Boolean)
        : (Array.isArray(raw.pulses) ? raw.pulses.map(normalizePulse).filter(Boolean) : []),
      coupleRituals: Array.isArray(raw.coupleRituals)
        ? raw.coupleRituals.map(normalizeRitual).filter(Boolean)
        : (Array.isArray(raw.rituals) ? raw.rituals.map(normalizeRitual).filter(Boolean) : []),
      memoryShards: Array.isArray(raw.memoryShards)
        ? raw.memoryShards.map(normalizeMemory).filter(Boolean)
        : (Array.isArray(raw.memories) ? raw.memories.map(normalizeMemory).filter(Boolean) : []),
      wishDrawer: Array.isArray(raw.wishDrawer)
        ? raw.wishDrawer.map(normalizeWish).filter(Boolean)
        : (Array.isArray(raw.wishes) ? raw.wishes.map(normalizeWish).filter(Boolean) : []),
      privateDictionary: Array.isArray(raw.privateDictionary)
        ? raw.privateDictionary.map(normalizeDict).filter(Boolean)
        : (Array.isArray(raw.dictionary) ? raw.dictionary.map(normalizeDict).filter(Boolean) : []),
      moodForecast: Array.isArray(raw.moodForecast)
        ? raw.moodForecast.map(normalizeForecast).filter(Boolean)
        : (Array.isArray(raw.forecast) ? raw.forecast.map(normalizeForecast).filter(Boolean) : []),
      confessionQueue: Array.isArray(raw.confessionQueue)
        ? raw.confessionQueue.map(normalizeConfession).filter(Boolean)
        : (Array.isArray(raw.confessions) ? raw.confessions.map(normalizeConfession).filter(Boolean) : []),
      promiseLedger: Array.isArray(raw.promiseLedger)
        ? raw.promiseLedger.map(normalizePromise).filter(Boolean)
        : (Array.isArray(raw.promises) ? raw.promises.map(normalizePromise).filter(Boolean) : []),
      sceneTickets: Array.isArray(raw.sceneTickets)
        ? raw.sceneTickets.map(normalizeTicket).filter(Boolean)
        : (Array.isArray(raw.tickets) ? raw.tickets.map(normalizeTicket).filter(Boolean) : []),
      nightNotes: Array.isArray(raw.nightNotes)
        ? raw.nightNotes.map(normalizeNight).filter(Boolean)
        : (Array.isArray(raw.nights) ? raw.nights.map(normalizeNight).filter(Boolean) : []),
      bondQuiz: Array.isArray(raw.bondQuiz)
        ? raw.bondQuiz.map(normalizeQuiz).filter(Boolean)
        : (Array.isArray(raw.quiz) ? raw.quiz.map(normalizeQuiz).filter(Boolean) : []),
      footerSeal: String(raw.footerSeal || raw.footerNote || raw.closing || raw.seal || '').trim()
    };
  }

  function normalizeCoupleData(raw, contactId) {
    var base = defaultCoupleData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var status = String(raw.refreshStatus || 'idle');
    if (status !== 'loading' && status !== 'success' && status !== 'error') status = 'idle';
    return {
      version: 1,
      contactId: String(raw.contactId || contactId || ''),
      updatedAt: Number(raw.updatedAt) || 0,
      refreshStatus: status,
      refreshMessage: String(raw.refreshMessage || ''),
      refreshStartedAt: Number(raw.refreshStartedAt) || 0,
      lastRefreshedAt: Number(raw.lastRefreshedAt) || 0,
      couple: normalizeCouplePayload(raw.couple)
    };
  }

  function getCached(contactId) {
    var key = coupleKey(contactId);
    return cache[key] ? normalizeCoupleData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = coupleKey(contactId);
    cache[key] = normalizeCoupleData(data, contactId);
    return cache[key];
  }

  function getCouple(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultCoupleData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(coupleKey(id)).then(function (raw) {
      var data = normalizeCoupleData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultCoupleData(id);
    });
  }

  function saveCouple(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeCoupleData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(coupleKey(id), next).then(function () { return next; });
  }

  function patchCouple(contactId, patch) {
    return getCouple(contactId).then(function (cur) {
      return saveCouple(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepCoupleStore = {
    defaultCoupleData: defaultCoupleData,
    normalizeCoupleData: normalizeCoupleData,
    normalizeCouplePayload: normalizeCouplePayload,
    getCouple: getCouple,
    saveCouple: saveCouple,
    patchCouple: patchCouple,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
