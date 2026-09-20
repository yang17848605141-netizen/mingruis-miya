/**
 * miya-deep-game-store.js — 深入 · 角色手机 游戏（机密对局卷宗）数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function gameKey(contactId) {
    return 'game:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_game_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_game_idb_blocked'));
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

  function defaultGameData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      game: null
    };
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeHero(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        title: '',
        subtitle: '',
        clearance: '',
        affinityLabel: '',
        statusLine: '',
        opponentAlias: '',
        playScore: 0
      };
    }
    return {
      title: String(raw.title || raw.coverTitle || '').trim(),
      subtitle: String(raw.subtitle || raw.sub || '').trim(),
      clearance: String(raw.clearance || raw.grade || raw.stamp || '').trim(),
      affinityLabel: String(raw.affinityLabel || raw.label || '').trim(),
      statusLine: String(raw.statusLine || raw.status || '').trim(),
      opponentAlias: String(raw.opponentAlias || raw.alias || raw.partnerAlias || '').trim(),
      playScore: clamp(raw.playScore != null ? raw.playScore : (raw.score || 0), 0, 999)
    };
  }

  function normalizeChoiceOption(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'opt-' + (index + 1), label: raw.trim(), reaction: '', score: 1 };
      }
      return null;
    }
    var label = String(raw.label || raw.text || raw.choice || '').trim();
    if (!label) return null;
    return {
      id: String(raw.id || 'opt-' + (index + 1)),
      label: label,
      reaction: String(raw.reaction || raw.result || raw.outcome || raw.reveal || '').trim(),
      score: clamp(raw.score != null ? raw.score : 1, 0, 5)
    };
  }

  function normalizeChoice(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.scene || '').trim();
    var setup = String(raw.setup || raw.prompt || raw.context || raw.body || '').trim();
    var options = Array.isArray(raw.options)
      ? raw.options.map(normalizeChoiceOption).filter(Boolean)
      : [];
    if (!title && !setup && !options.length) return null;
    var picked = raw.picked != null && raw.picked !== '' ? String(raw.picked) : null;
    return {
      id: String(raw.id || 'choice-' + (index + 1)),
      title: title || ('抉择 ' + (index + 1)),
      setup: setup,
      options: options,
      picked: picked
    };
  }

  function normalizeCipher(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var face = String(raw.face || raw.front || raw.title || raw.cipher || '').trim();
    var back = String(raw.back || raw.content || raw.text || raw.secret || '').trim();
    if (!face && !back) return null;
    return {
      id: String(raw.id || 'cipher-' + (index + 1)),
      face: face || ('牌面 ' + (index + 1)),
      back: back,
      pairKey: String(raw.pairKey || raw.pair || raw.match || ('pair-' + Math.ceil((index + 1) / 2))).trim(),
      flipped: !!raw.flipped,
      matched: !!raw.matched
    };
  }

  function normalizeArena(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var q = String(raw.q || raw.question || raw.prompt || '').trim();
    if (!q) return null;
    var choices = [];
    if (Array.isArray(raw.choices)) {
      raw.choices.forEach(function (c) {
        var t = typeof c === 'string' ? c.trim() : String((c && (c.label || c.text)) || '').trim();
        if (t) choices.push(t);
      });
    }
    var correct = Number(raw.correct);
    if (!isFinite(correct)) correct = 0;
    correct = clamp(correct, 0, Math.max(0, choices.length - 1));
    var answered = raw.answered;
    if (answered == null || answered === '') answered = -1;
    else answered = clamp(answered, -1, Math.max(0, choices.length - 1));
    return {
      id: String(raw.id || 'arena-' + (index + 1)),
      q: q,
      choices: choices,
      correct: correct,
      explain: String(raw.explain || raw.a || raw.answer || raw.reveal || '').trim(),
      answered: answered
    };
  }

  function normalizeThermo(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var prompt = String(raw.prompt || raw.q || raw.title || raw.text || '').trim();
    if (!prompt) return null;
    var guess = raw.guess;
    if (guess == null || guess === '') guess = null;
    else guess = clamp(guess, 0, 100);
    return {
      id: String(raw.id || 'thermo-' + (index + 1)),
      prompt: prompt,
      target: clamp(raw.target != null ? raw.target : (raw.temp || raw.value || 50), 0, 100),
      tolerance: clamp(raw.tolerance != null ? raw.tolerance : 12, 4, 30),
      coldNote: String(raw.coldNote || raw.cold || '').trim(),
      hotNote: String(raw.hotNote || raw.hot || '').trim(),
      hitNote: String(raw.hitNote || raw.hit || raw.success || '').trim(),
      guess: guess,
      resolved: !!raw.resolved
    };
  }

  function normalizeSceneChoice(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { label: raw.trim(), nextNote: '' };
      }
      return null;
    }
    var label = String(raw.label || raw.text || raw.choice || '').trim();
    if (!label) return null;
    return {
      label: label,
      nextNote: String(raw.nextNote || raw.reaction || raw.result || raw.note || '').trim()
    };
  }

  function normalizeScene(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var setting = String(raw.setting || raw.place || raw.scene || '').trim();
    var body = String(raw.body || raw.script || raw.opening || '').trim();
    var choices = Array.isArray(raw.choices)
      ? raw.choices.map(normalizeSceneChoice).filter(Boolean)
      : [];
    if (!title && !body && !choices.length) return null;
    var choiceIndex = raw.choiceIndex;
    if (choiceIndex == null || choiceIndex === '') choiceIndex = -1;
    else choiceIndex = clamp(choiceIndex, -1, Math.max(0, choices.length - 1));
    return {
      id: String(raw.id || 'scene-' + (index + 1)),
      title: title || ('剧本 ' + (index + 1)),
      setting: setting,
      body: body,
      choices: choices,
      choiceIndex: choiceIndex,
      played: !!raw.played
    };
  }

  function normalizeLot(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var front = String(raw.front || raw.title || raw.label || '').trim();
    var back = String(raw.back || raw.content || raw.text || raw.body || '').trim();
    if (!front && !back) return null;
    return {
      id: String(raw.id || 'lot-' + (index + 1)),
      kind: String(raw.kind || raw.type || '心愿签').trim(),
      front: front || ('签 ' + (index + 1)),
      back: back,
      drawn: !!raw.drawn
    };
  }

  function normalizeMission(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.mission || '').trim();
    var detail = String(raw.detail || raw.text || raw.content || raw.body || '').trim();
    if (!title && !detail) return null;
    return {
      id: String(raw.id || 'mission-' + (index + 1)),
      title: title || ('任务 ' + (index + 1)),
      detail: detail,
      reward: String(raw.reward || raw.prize || '').trim(),
      done: !!raw.done
    };
  }

  function normalizeStamp(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.label || '').trim();
    if (!name) return null;
    return {
      id: String(raw.id || 'stamp-' + (index + 1)),
      name: name,
      condition: String(raw.condition || raw.req || raw.how || '').trim(),
      flavor: String(raw.flavor || raw.note || raw.text || '').trim(),
      unlocked: !!raw.unlocked
    };
  }

  function arr(raw, keys, mapper) {
    var i;
    for (i = 0; i < keys.length; i++) {
      if (Array.isArray(raw[keys[i]])) return raw[keys[i]].map(mapper).filter(Boolean);
    }
    return [];
  }

  function normalizeGamePayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      dateLabel: String(raw.dateLabel || raw.date || '').trim(),
      fileNo: String(raw.fileNo || raw.caseNo || raw.dossierId || raw.archiveNo || '').trim(),
      classification: String(raw.classification || raw.grade || 'CONFIDENTIAL').trim(),
      hero: normalizeHero(raw.hero),
      briefing: String(raw.briefing || raw.openLetter || raw.letter || raw.preface || '').trim(),
      summary: String(raw.summary || raw.overview || raw.note || '').trim(),
      choiceFiles: arr(raw, ['choiceFiles', 'choices', 'scenarios'], normalizeChoice),
      cipherDeck: arr(raw, ['cipherDeck', 'ciphers', 'cards'], normalizeCipher),
      bondArena: arr(raw, ['bondArena', 'quiz', 'arena'], normalizeArena),
      thermoRounds: arr(raw, ['thermoRounds', 'thermo', 'temps'], normalizeThermo),
      sceneReel: arr(raw, ['sceneReel', 'scenes', 'scripts'], normalizeScene),
      lotDrawer: arr(raw, ['lotDrawer', 'lots', 'lotsBox'], normalizeLot),
      missionBoard: arr(raw, ['missionBoard', 'missions', 'tasks'], normalizeMission),
      stampRack: arr(raw, ['stampRack', 'stamps', 'badges'], normalizeStamp),
      footerSeal: String(raw.footerSeal || raw.footerNote || raw.seal || '').trim(),
      earnedScore: clamp(raw.earnedScore != null ? raw.earnedScore : 0, 0, 999)
    };
  }

  function normalizeGameData(raw, contactId) {
    var base = defaultGameData(contactId);
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
      game: normalizeGamePayload(raw.game)
    };
  }

  function getCached(contactId) {
    var key = gameKey(contactId);
    return cache[key] ? normalizeGameData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = gameKey(contactId);
    cache[key] = normalizeGameData(data, contactId);
    return cache[key];
  }

  function getGame(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultGameData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(gameKey(id)).then(function (raw) {
      var data = normalizeGameData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultGameData(id);
    });
  }

  function saveGame(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeGameData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(gameKey(id), next).then(function () { return next; });
  }

  function patchGame(contactId, patch) {
    return getGame(contactId).then(function (cur) {
      return saveGame(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepGameStore = {
    defaultGameData: defaultGameData,
    normalizeGameData: normalizeGameData,
    normalizeGamePayload: normalizeGamePayload,
    getGame: getGame,
    saveGame: saveGame,
    patchGame: patchGame,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
