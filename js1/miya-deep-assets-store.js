/**
 * miya-deep-assets-store.js — 深入 · 角色手机 资产（私产账本）数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function assetsKey(contactId) {
    return 'assets:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_assets_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_assets_idb_blocked'));
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

  function defaultAssetsData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      assets: null
    };
  }

  function normalizeEquity(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        title: '',
        netWorth: 0,
        unit: '心',
        trend: '',
        trendNote: '',
        statusLine: '',
        partnerAlias: '',
        softPledge: ''
      };
    }
    return {
      title: String(raw.title || raw.coverTitle || '').trim(),
      netWorth: Math.max(0, Math.min(999, Number(raw.netWorth != null ? raw.netWorth : raw.score) || 0)),
      unit: String(raw.unit || '心').trim() || '心',
      trend: String(raw.trend || raw.delta || '').trim(),
      trendNote: String(raw.trendNote || raw.note || '').trim(),
      statusLine: String(raw.statusLine || raw.status || '').trim(),
      partnerAlias: String(raw.partnerAlias || raw.alias || raw.nickname || '').trim(),
      softPledge: String(raw.softPledge || raw.pledge || raw.vow || '').trim()
    };
  }

  function normalizeWallet(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        totalLabel: '',
        totalAmount: '',
        available: '',
        frozen: '',
        currency: 'CNY',
        monthIn: '',
        monthOut: '',
        note: ''
      };
    }
    return {
      totalLabel: String(raw.totalLabel || raw.label || '总资产').trim() || '总资产',
      totalAmount: String(raw.totalAmount != null ? raw.totalAmount : (raw.total != null ? raw.total : raw.balance || '')).trim(),
      available: String(raw.available != null ? raw.available : raw.cash || '').trim(),
      frozen: String(raw.frozen || '').trim(),
      currency: String(raw.currency || 'CNY').trim() || 'CNY',
      monthIn: String(raw.monthIn || raw.income || '').trim(),
      monthOut: String(raw.monthOut || raw.expense || '').trim(),
      note: String(raw.note || raw.remark || '').trim()
    };
  }

  function normalizeCard(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var bank = String(raw.bank || raw.bankName || raw.issuer || '').trim();
    var last4 = String(raw.last4 || raw.tail || raw.number || '').replace(/\D/g, '').slice(-4);
    var balance = String(raw.balance != null ? raw.balance : (raw.amount != null ? raw.amount : '')).trim();
    if (!bank && !last4 && !balance) return null;
    var kind = String(raw.kind || raw.type || raw.cardType || 'debit').trim().toLowerCase();
    if (kind !== 'credit' && kind !== 'debit' && kind !== 'prepaid') kind = 'debit';
    var theme = String(raw.theme || raw.skin || raw.color || 'obsidian').trim().toLowerCase();
    if (['obsidian', 'pearl', 'slate', 'smoke', 'ivory'].indexOf(theme) < 0) theme = 'obsidian';
    return {
      id: String(raw.id || 'card-' + (index + 1)),
      bank: bank || ('卡 ' + (index + 1)),
      kind: kind,
      last4: last4 || '0000',
      holder: String(raw.holder || raw.name || raw.cardholder || '').trim(),
      balance: balance,
      limit: String(raw.limit || raw.creditLimit || '').trim(),
      network: String(raw.network || raw.brand || '银联').trim(),
      theme: theme,
      note: String(raw.note || raw.remark || '').trim(),
      flipped: !!raw.flipped
    };
  }

  function normalizePocket(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.app || '').trim();
    var balance = String(raw.balance != null ? raw.balance : (raw.amount != null ? raw.amount : '')).trim();
    if (!name && !balance) return null;
    return {
      id: String(raw.id || 'pk-' + (index + 1)),
      name: name || ('账户 ' + (index + 1)),
      balance: balance,
      kind: String(raw.kind || raw.type || 'wallet').trim(),
      note: String(raw.note || '').trim()
    };
  }

  function normalizeTxn(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'tx-' + (index + 1),
          time: '',
          title: '交易',
          merchant: '',
          direction: 'out',
          amount: '',
          category: '',
          channel: '',
          note: raw.trim(),
          expanded: false
        };
      }
      return null;
    }
    var title = String(raw.title || raw.name || raw.merchant || '').trim();
    var amount = String(raw.amount != null ? raw.amount : (raw.value != null ? raw.value : '')).trim();
    var note = String(raw.note || raw.remark || raw.text || '').trim();
    if (!title && !amount && !note) return null;
    var dir = String(raw.direction || raw.side || raw.type || 'out').trim().toLowerCase();
    if (dir === 'income' || dir === '+') dir = 'in';
    if (dir === 'expense' || dir === '-') dir = 'out';
    if (dir !== 'in' && dir !== 'out') dir = 'out';
    return {
      id: String(raw.id || 'tx-' + (index + 1)),
      time: String(raw.time || raw.when || raw.stamp || raw.date || '').trim(),
      title: title || '交易',
      merchant: String(raw.merchant || raw.payee || '').trim(),
      direction: dir,
      amount: amount,
      category: String(raw.category || raw.tag || '').trim(),
      channel: String(raw.channel || raw.card || raw.account || '').trim(),
      note: note,
      expanded: !!raw.expanded
    };
  }

  function normalizeHolding(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.item || '').trim();
    var note = String(raw.note || raw.detail || raw.text || raw.content || '').trim();
    if (!name && !note) return null;
    return {
      id: String(raw.id || 'hd-' + (index + 1)),
      name: name || ('藏品 ' + (index + 1)),
      category: String(raw.category || raw.kind || raw.tag || '').trim(),
      rarity: String(raw.rarity || raw.grade || '').trim(),
      valueLabel: String(raw.valueLabel || raw.value || raw.worth || '').trim(),
      note: note,
      inspected: !!raw.inspected
    };
  }

  function normalizeVault(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'vx-' + (index + 1)),
      label: String(raw.label || raw.title || raw.name || '上锁私箱').trim(),
      grade: String(raw.grade || raw.level || 'SEALED').trim(),
      content: content,
      unlocked: !!raw.unlocked
    };
  }

  function normalizeFlow(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'cf-' + (index + 1),
          time: '',
          title: '流水',
          direction: 'hold',
          amount: '',
          note: raw.trim(),
          pinned: false
        };
      }
      return null;
    }
    var note = String(raw.note || raw.text || raw.content || raw.body || '').trim();
    var title = String(raw.title || raw.name || raw.label || '').trim();
    if (!note && !title) return null;
    var dir = String(raw.direction || raw.side || raw.type || 'hold').trim().toLowerCase();
    if (dir !== 'in' && dir !== 'out' && dir !== 'hold') dir = 'hold';
    return {
      id: String(raw.id || 'cf-' + (index + 1)),
      time: String(raw.time || raw.when || raw.stamp || '').trim(),
      title: title || '流水',
      direction: dir,
      amount: String(raw.amount || raw.value || raw.delta || '').trim(),
      note: note,
      pinned: !!raw.pinned
    };
  }

  function normalizePortfolio(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.asset || '').trim();
    var thesis = String(raw.thesis || raw.note || raw.text || raw.content || '').trim();
    if (!name && !thesis) return null;
    return {
      id: String(raw.id || 'pf-' + (index + 1)),
      name: name || ('持仓 ' + (index + 1)),
      thesis: thesis,
      horizon: String(raw.horizon || raw.term || raw.when || '').trim(),
      risk: String(raw.risk || raw.level || '').trim(),
      watched: !!raw.watched
    };
  }

  function normalizeDebt(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.text || '').trim();
    var owed = String(raw.owed || raw.detail || raw.content || raw.note || '').trim();
    if (!title && !owed) return null;
    var side = String(raw.side || raw.from || 'us').trim().toLowerCase();
    if (side !== 'me' && side !== 'you' && side !== 'us') side = 'us';
    return {
      id: String(raw.id || 'db-' + (index + 1)),
      title: title || ('负债 ' + (index + 1)),
      owed: owed,
      side: side,
      settled: !!raw.settled
    };
  }

  function normalizeClaim(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'cl-' + (index + 1), text: raw.trim(), intensity: '', stamped: false };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.claim || raw.title || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'cl-' + (index + 1)),
      text: text,
      intensity: String(raw.intensity || raw.tone || raw.tag || '').trim(),
      stamped: !!raw.stamped
    };
  }

  function normalizeAuction(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var lot = String(raw.lot || raw.title || raw.name || raw.item || '').trim();
    if (!lot) return null;
    return {
      id: String(raw.id || 'aq-' + (index + 1)),
      lot: lot,
      bid: String(raw.bid || raw.price || raw.offer || '').trim(),
      fantasy: String(raw.fantasy || raw.detail || raw.note || raw.text || '').trim(),
      placed: !!raw.placed
    };
  }

  function normalizeDividend(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var note = String(raw.note || raw.text || raw.content || '').trim();
    if (!title && !note) return null;
    return {
      id: String(raw.id || 'dv-' + (index + 1)),
      title: title || ('分红 ' + (index + 1)),
      yield: String(raw.yield || raw.amount || raw.value || '').trim(),
      note: note,
      claimed: !!raw.claimed
    };
  }

  function normalizePolicy(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || '').trim();
    var clause = String(raw.clause || raw.content || raw.text || raw.body || '').trim();
    if (!name && !clause) return null;
    return {
      id: String(raw.id || 'pl-' + (index + 1)),
      name: name || ('保单 ' + (index + 1)),
      coverage: String(raw.coverage || raw.cover || '').trim(),
      premium: String(raw.premium || raw.cost || '').trim(),
      clause: clause,
      expanded: !!raw.expanded
    };
  }

  function normalizeAppraisal(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var q = String(raw.q || raw.question || raw.prompt || '').trim();
    var a = String(raw.a || raw.answer || raw.reveal || '').trim();
    if (!q) return null;
    return {
      id: String(raw.id || 'ap-' + (index + 1)),
      q: q,
      a: a,
      hint: String(raw.hint || '').trim(),
      revealed: !!raw.revealed
    };
  }

  function mapArr(raw, key, alt, fn) {
    if (Array.isArray(raw[key])) return raw[key].map(fn).filter(Boolean);
    if (alt && Array.isArray(raw[alt])) return raw[alt].map(fn).filter(Boolean);
    return [];
  }

  function normalizeAssetsPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      dateLabel: String(raw.dateLabel || raw.date || '').trim(),
      vaultId: String(raw.vaultId || raw.fileNo || raw.caseNo || raw.ledgerId || '').trim(),
      wallet: normalizeWallet(raw.wallet || raw.finance || raw.money),
      cards: mapArr(raw, 'cards', 'bankCards', normalizeCard),
      pockets: mapArr(raw, 'pockets', 'accounts', normalizePocket),
      txns: mapArr(raw, 'txns', 'transactions', normalizeTxn),
      equity: normalizeEquity(raw.equity || raw.hero),
      manifesto: String(raw.manifesto || raw.openLetter || raw.letter || raw.preface || '').trim(),
      overview: String(raw.overview || raw.summary || raw.note || '').trim(),
      holdings: mapArr(raw, 'holdings', 'collectibles', normalizeHolding),
      vaultBoxes: mapArr(raw, 'vaultBoxes', 'vaults', normalizeVault),
      cashflow: mapArr(raw, 'cashflow', 'ledger', normalizeFlow),
      portfolio: mapArr(raw, 'portfolio', 'investments', normalizePortfolio),
      debts: mapArr(raw, 'debts', 'liabilities', normalizeDebt),
      claims: mapArr(raw, 'claims', 'ownership', normalizeClaim),
      auctions: mapArr(raw, 'auctions', 'lots', normalizeAuction),
      dividends: mapArr(raw, 'dividends', 'yields', normalizeDividend),
      policies: mapArr(raw, 'policies', 'insurance', normalizePolicy),
      appraisal: mapArr(raw, 'appraisal', 'quiz', normalizeAppraisal),
      sealNote: String(raw.sealNote || raw.footerSeal || raw.footerNote || raw.closing || '').trim()
    };
  }

  function normalizeAssetsData(raw, contactId) {
    var base = defaultAssetsData(contactId);
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
      assets: normalizeAssetsPayload(raw.assets)
    };
  }

  function getCached(contactId) {
    var key = assetsKey(contactId);
    return cache[key] ? normalizeAssetsData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = assetsKey(contactId);
    cache[key] = normalizeAssetsData(data, contactId);
    return cache[key];
  }

  function getAssets(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultAssetsData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(assetsKey(id)).then(function (raw) {
      var data = normalizeAssetsData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultAssetsData(id);
    });
  }

  function saveAssets(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeAssetsData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(assetsKey(id), next).then(function () { return next; });
  }

  function patchAssets(contactId, patch) {
    return getAssets(contactId).then(function (cur) {
      return saveAssets(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepAssetsStore = {
    defaultAssetsData: defaultAssetsData,
    normalizeAssetsData: normalizeAssetsData,
    normalizeAssetsPayload: normalizeAssetsPayload,
    getAssets: getAssets,
    saveAssets: saveAssets,
    patchAssets: patchAssets,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
