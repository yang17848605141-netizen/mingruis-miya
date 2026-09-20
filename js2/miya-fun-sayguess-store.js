/**
 * miya-fun-sayguess-store.js — 你说我猜 · 题库与对局持久化
 */
(function (global) {
  'use strict';

  var BANKS_KEY = 'miya-fun-sayguess-banks-v1';
  var SESSIONS_KEY = 'miya-fun-sayguess-sessions-v1';

  var banksCache = null;
  var sessionsCache = null;

  function uid(prefix) {
    return (prefix || 'sg') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function safeParse(raw, fallback) {
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function clip(s, max) {
    var t = String(s == null ? '' : s).trim();
    if (!max || t.length <= max) return t;
    return t.slice(0, max);
  }

  function isValidWord(w) {
    var t = String(w == null ? '' : w).trim().replace(/\s+/g, '');
    if (!t) return false;
    var len = Array.from(t).length;
    return len >= 2 && len <= 10;
  }

  function normalizeWord(w) {
    return String(w == null ? '' : w).trim().replace(/\s+/g, '');
  }

  function loadBanks() {
    if (banksCache) return banksCache;
    var raw = '';
    try {
      raw = localStorage.getItem(BANKS_KEY) || '';
    } catch (e) {}
    var data = safeParse(raw, { version: 1, banks: [] });
    if (!data || !Array.isArray(data.banks)) data = { version: 1, banks: [] };
    data.version = 1;
    data.banks = data.banks.map(normalizeBank).filter(Boolean);
    banksCache = data;
    return banksCache;
  }

  function saveBanks() {
    try {
      localStorage.setItem(BANKS_KEY, JSON.stringify(loadBanks()));
    } catch (e) {}
  }

  function normalizeBank(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var words = Array.isArray(raw.words)
      ? raw.words.map(normalizeWord).filter(isValidWord)
      : [];
    var seen = {};
    words = words.filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });
    return {
      id: String(raw.id || uid('bank')),
      name: clip(raw.name || '题库', 24) || '题库',
      words: words,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function listBanks() {
    return loadBanks().banks.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function findBank(id) {
    var sid = String(id || '');
    return loadBanks().banks.find(function (b) {
      return b && String(b.id) === sid;
    }) || null;
  }

  function nextBankName() {
    var n = loadBanks().banks.length + 1;
    var name = '题库' + n;
    while (listBanks().some(function (b) { return b.name === name; })) {
      n += 1;
      name = '题库' + n;
    }
    return name;
  }

  function createBank(opts) {
    opts = opts || {};
    var bank = normalizeBank({
      id: uid('bank'),
      name: clip(opts.name || nextBankName(), 24),
      words: opts.words || [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    loadBanks().banks.unshift(bank);
    saveBanks();
    return bank;
  }

  function updateBank(id, patch) {
    var bank = findBank(id);
    if (!bank) return null;
    if (patch && patch.name != null) bank.name = clip(patch.name, 24) || bank.name;
    if (patch && Array.isArray(patch.words)) {
      bank.words = patch.words.map(normalizeWord).filter(isValidWord);
      var seen = {};
      bank.words = bank.words.filter(function (w) {
        if (seen[w]) return false;
        seen[w] = true;
        return true;
      });
    }
    bank.updatedAt = Date.now();
    saveBanks();
    return bank;
  }

  function deleteBank(id) {
    var data = loadBanks();
    var before = data.banks.length;
    data.banks = data.banks.filter(function (b) {
      return b && String(b.id) !== String(id);
    });
    if (data.banks.length === before) return false;
    saveBanks();
    return true;
  }

  function addWords(bankId, words) {
    var bank = findBank(bankId);
    if (!bank) return null;
    var list = Array.isArray(words) ? words : [words];
    var seen = {};
    bank.words.forEach(function (w) { seen[w] = true; });
    var added = [];
    list.forEach(function (w) {
      var n = normalizeWord(w);
      if (!isValidWord(n) || seen[n]) return;
      seen[n] = true;
      bank.words.push(n);
      added.push(n);
    });
    bank.updatedAt = Date.now();
    saveBanks();
    return { bank: bank, added: added };
  }

  function removeWord(bankId, word) {
    var bank = findBank(bankId);
    if (!bank) return null;
    var target = normalizeWord(word);
    bank.words = bank.words.filter(function (w) { return w !== target; });
    bank.updatedAt = Date.now();
    saveBanks();
    return bank;
  }

  function moveWord(fromBankId, toBankId, word) {
    var from = findBank(fromBankId);
    var to = findBank(toBankId);
    if (!from || !to || String(from.id) === String(to.id)) return null;
    var target = normalizeWord(word);
    if (!from.words.some(function (w) { return w === target; })) return null;
    from.words = from.words.filter(function (w) { return w !== target; });
    if (!to.words.some(function (w) { return w === target; })) {
      to.words.push(target);
    }
    from.updatedAt = Date.now();
    to.updatedAt = Date.now();
    saveBanks();
    return { from: from, to: to };
  }

  function loadSessions() {
    if (sessionsCache) return sessionsCache;
    var raw = '';
    try {
      raw = localStorage.getItem(SESSIONS_KEY) || '';
    } catch (e) {}
    var data = safeParse(raw, { sessions: [] });
    if (!data || !Array.isArray(data.sessions)) data = { sessions: [] };
    sessionsCache = data;
    return sessionsCache;
  }

  function saveSessions() {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(loadSessions()));
    } catch (e) {}
  }

  function normalizePrizes(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    return {
      first: clip(r.first || '', 40),
      second: clip(r.second || '', 40),
      third: clip(r.third || '', 40)
    };
  }

  function createSession(opts) {
    opts = opts || {};
    var session = {
      id: uid('sgs'),
      status: 'setup',
      mode: opts.mode === 'other_lead' ? 'other_lead' : 'user_lead',
      totalRounds: Math.max(1, Math.min(30, Number(opts.totalRounds) || 5)),
      currentRound: 0,
      bankId: String(opts.bankId || ''),
      bankName: String(opts.bankName || ''),
      profileId: String(opts.profileId || ''),
      profileName: String(opts.profileName || ''),
      players: Array.isArray(opts.players) ? opts.players : [],
      scores: {},
      usedWords: [],
      rounds: [],
      prizes: normalizePrizes(opts.prizes),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    (session.players || []).forEach(function (p) {
      if (p && p.id) session.scores[p.id] = 0;
    });
    loadSessions().sessions.unshift(session);
    saveSessions();
    return session;
  }

  function findSession(id) {
    return loadSessions().sessions.find(function (s) {
      return s && String(s.id) === String(id);
    }) || null;
  }

  function updateSession(id, patch) {
    var s = findSession(id);
    if (!s) return null;
    Object.keys(patch || {}).forEach(function (k) {
      s[k] = patch[k];
    });
    s.updatedAt = Date.now();
    saveSessions();
    return s;
  }

  function listSessions() {
    return loadSessions().sessions.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function deleteSession(id) {
    var data = loadSessions();
    var before = data.sessions.length;
    data.sessions = data.sessions.filter(function (s) {
      return s && String(s.id) !== String(id);
    });
    if (data.sessions.length === before) return false;
    saveSessions();
    return true;
  }

  function buildContextDigest(session) {
    if (!session) return '';
    var lines = [];
    lines.push('【你说我猜 · 游戏记录】');
    lines.push('模式：' + (session.mode === 'other_lead' ? '你们说我猜' : '我说你们猜'));
    lines.push('轮数：' + (session.totalRounds || 0));
    lines.push('题库：' + (session.bankName || ''));
    lines.push('用户面具：' + (session.profileName || '我'));
    lines.push('');
    lines.push('【玩家】');
    (session.players || []).forEach(function (p) {
      lines.push('- ' + (p.name || '') + (p.kind === 'user' ? '（用户）' : '') +
        ' · ' + ((session.scores && session.scores[p.id]) || 0) + ' 分');
    });
    var prizes = normalizePrizes(session.prizes);
    if (prizes.first || prizes.second || prizes.third) {
      lines.push('');
      lines.push('【奖励】');
      if (prizes.first) lines.push('- 第1名：' + prizes.first);
      if (prizes.second) lines.push('- 第2名：' + prizes.second);
      if (prizes.third) lines.push('- 第3名：' + prizes.third);
    }
    lines.push('');
    lines.push('【逐轮记录】');
    (session.rounds || []).forEach(function (r, idx) {
      var describer = (session.players || []).find(function (p) {
        return String(p.id) === String(r.describerId);
      });
      lines.push('—— 第' + (idx + 1) + '轮 ——');
      lines.push('出题人：' + (describer ? describer.name : '—'));
      lines.push('答案：' + (r.word || ''));
      if (r.description) lines.push('描述：' + r.description);
      if (Array.isArray(r.dialogue) && r.dialogue.length) {
        lines.push('对话：');
        r.dialogue.forEach(function (d) {
          lines.push((d.name || '') + '：' + (d.speech || ''));
          if (d.guess) lines.push('　→ 猜：' + d.guess);
        });
      }
      if (Array.isArray(r.review) && r.review.length) {
        lines.push('揭晓后讨论：');
        r.review.forEach(function (d) {
          lines.push((d.name || '') + '：' + (d.speech || ''));
        });
      }
      (r.guesses || []).forEach(function (g) {
        var who = (session.players || []).find(function (p) {
          return String(p.id) === String(g.playerId);
        });
        lines.push(
          (who ? who.name : '?') + ' 猜「' + (g.text || '') + '」' +
          (g.hit ? ' ✓' : '') +
          (g.speech && g.speech !== g.text ? '｜' + g.speech : '')
        );
      });
    });
    if (Array.isArray(session.reactions) && session.reactions.length) {
      lines.push('');
      lines.push('【终局感想】');
      session.reactions.forEach(function (rx) {
        lines.push((rx.name || '') + '：' + (rx.text || ''));
      });
    }
    return lines.join('\n');
  }

  /** 猜测文本是否命中答案（去空白、忽略大小写；发言中包含完整答案词） */
  function guessHitsWord(guessText, answer) {
    var g = normalizeWord(guessText).toLowerCase();
    var a = normalizeWord(answer).toLowerCase();
    if (!g || !a) return false;
    g = g.replace(/[，。！？、；：""''（）\[\]【】\s\.\,\!\?\-\_]/g, '');
    a = a.replace(/[，。！？、；：""''（）\[\]【】\s\.\,\!\?\-\_]/g, '');
    if (!g || !a) return false;
    return g.indexOf(a) !== -1;
  }

  global.miyaFunSayGuessStore = {
    BANKS_KEY: BANKS_KEY,
    SESSIONS_KEY: SESSIONS_KEY,
    uid: uid,
    isValidWord: isValidWord,
    normalizeWord: normalizeWord,
    listBanks: listBanks,
    findBank: findBank,
    nextBankName: nextBankName,
    createBank: createBank,
    updateBank: updateBank,
    deleteBank: deleteBank,
    addWords: addWords,
    removeWord: removeWord,
    moveWord: moveWord,
    createSession: createSession,
    findSession: findSession,
    updateSession: updateSession,
    listSessions: listSessions,
    deleteSession: deleteSession,
    normalizePrizes: normalizePrizes,
    guessHitsWord: guessHitsWord,
    buildContextDigest: buildContextDigest
  };
})(typeof window !== 'undefined' ? window : global);
