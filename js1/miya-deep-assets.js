/**
 * miya-deep-assets.js — 深入 · 角色手机 资产（黑白灰 Ins 私产刊）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var SIDE_LABEL = { me: '我欠', you: '对方欠', us: '未结清' };
  var DIR_LABEL = { in: '入', out: '出', hold: '冻' };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    assetsData: null,
    refreshing: false,
    built: false,
    pocketIndex: 0
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;
  var deckTouch = null;

  function assetsStore() { return global.miyaDeepAssetsStore || null; }
  function assetsBridge() { return global.miyaDeepAssetsBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-assets-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-assets-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的资产数据');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function updateStatusBar() {
    var bar = $('dp-assets-status');
    var text = $('dp-assets-status-text');
    if (!bar || !text) return;
    var data = state.assetsData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的资产数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '私产已入账';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-assets__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-assets__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-assets-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.assetsData && state.assetsData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.assetsData && state.assetsData.assets ? state.assetsData.assets : null;
  }

  function hasContent(as) {
    if (!as) return false;
    return !!(
      (as.wallet && (trim(as.wallet.totalAmount) || trim(as.wallet.available))) ||
      (as.cards && as.cards.length) ||
      (as.pockets && as.pockets.length) ||
      (as.txns && as.txns.length) ||
      trim(as.manifesto) ||
      trim(as.overview) ||
      (as.holdings && as.holdings.length) ||
      (as.vaultBoxes && as.vaultBoxes.length) ||
      (as.cashflow && as.cashflow.length) ||
      (as.portfolio && as.portfolio.length) ||
      (as.debts && as.debts.length) ||
      (as.claims && as.claims.length) ||
      (as.auctions && as.auctions.length) ||
      (as.dividends && as.dividends.length) ||
      (as.policies && as.policies.length) ||
      (as.appraisal && as.appraisal.length) ||
      trim(as.sealNote) ||
      (as.equity && (trim(as.equity.title) || trim(as.equity.statusLine) || Number(as.equity.netWorth) > 0))
    );
  }

  function persistPayload() {
    var ts = assetsStore();
    if (!ts || !state.contactId || !state.assetsData) return Promise.resolve(null);
    return ts.patchAssets(state.contactId, { assets: state.assetsData.assets }).then(function (saved) {
      state.assetsData = saved;
      return saved;
    });
  }

  function findIn(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  function band(no, title, hint) {
    return (
      '<header class="dp-assets__band">' +
        '<div class="dp-assets__band-left">' +
          '<span class="dp-assets__band-no">' + esc(no) + '</span>' +
          '<h2 class="dp-assets__band-title">' + esc(title) + '</h2>' +
        '</div>' +
        (hint ? '<span class="dp-assets__band-hint">' + esc(hint) + '</span>' : '') +
      '</header>'
    );
  }

  function kindLabel(kind) {
    if (kind === 'credit') return 'CREDIT';
    if (kind === 'prepaid') return 'PREPAID';
    return 'DEBIT';
  }

  function monoTheme(theme) {
    var t = String(theme || 'obsidian');
    if (t === 'pearl' || t === 'ivory') return t;
    if (t === 'smoke' || t === 'slate') return t;
    return 'obsidian';
  }

  function buildHero(as) {
    var eq = as.equity || {};
    var nw = Number(eq.netWorth) || 0;
    var has =
      eq.partnerAlias || as.vaultId || as.dateLabel || nw ||
      eq.title || eq.statusLine || eq.softPledge || as.manifesto || as.overview;
    if (!has) return '';
    return (
      '<section class="dp-assets__hero" id="as-hero">' +
        '<div class="dp-assets__hero-deco" aria-hidden="true">' +
          '<span class="dp-assets__hero-deco-ring"></span>' +
          '<span class="dp-assets__hero-deco-dots"></span>' +
          '<span class="dp-assets__hero-deco-line"></span>' +
        '</div>' +
        '<div class="dp-assets__hero-meta">' +
          '<span class="dp-assets__eyebrow">PRIVATE</span>' +
          '<div class="dp-assets__ids">' +
            (as.vaultId ? '<span>' + esc(as.vaultId) + '</span>' : '') +
            (as.dateLabel ? '<span>' + esc(as.dateLabel) + '</span>' : '') +
          '</div>' +
        '</div>' +
        (eq.partnerAlias ? '<p class="dp-assets__alias">' + esc(eq.partnerAlias) + '</p>' : '') +
        '<div class="dp-assets__figure">' +
          '<strong>' + esc(String(nw)) + '</strong>' +
          '<div class="dp-assets__figure-side">' +
            '<em>' + esc(eq.unit || '心') + '</em>' +
            '<span>净值</span>' +
            (eq.trend ? '<b>' + esc(eq.trend) + '</b>' : '') +
          '</div>' +
        '</div>' +
        (eq.title ? '<p class="dp-assets__hero-title">' + esc(eq.title) + '</p>' : '') +
        (eq.statusLine ? '<p class="dp-assets__hero-line">' + esc(eq.statusLine) + '</p>' : '') +
        (eq.softPledge
          ? '<blockquote class="dp-assets__pledge">' + esc(eq.softPledge) + '</blockquote>'
          : '') +
        (as.manifesto ? '<p class="dp-assets__manifesto">' + esc(as.manifesto) + '</p>' : '') +
        (as.overview ? '<p class="dp-assets__overview">' + esc(as.overview) + '</p>' : '') +
      '</section>'
    );
  }

  function buildMoney(as) {
    var w = as.wallet || {};
    var hasWallet = !!(trim(w.totalAmount) || trim(w.available) || trim(w.monthIn) || trim(w.monthOut));
    if (!hasWallet) return '';
    var cells = [];
    if (w.available) cells.push({ k: '可用', v: w.available });
    if (w.frozen) cells.push({ k: '冻结', v: w.frozen });
    if (w.monthIn) cells.push({ k: '本月入', v: w.monthIn });
    if (w.monthOut) cells.push({ k: '本月出', v: w.monthOut });
    return (
      '<section class="dp-assets__block" id="as-money">' +
        band('01', '总资产', '概览') +
        '<div class="dp-assets__money">' +
          '<div class="dp-assets__money-head">' +
            '<span>' + esc(w.totalLabel || 'TOTAL') + '</span>' +
            '<em class="dp-assets__money-badge">' + esc(w.currency || 'CNY') + '</em>' +
          '</div>' +
          '<div class="dp-assets__money-total">' +
            '<b>¥</b><strong>' + esc(w.totalAmount || '—') + '</strong>' +
          '</div>' +
          (cells.length
            ? '<div class="dp-assets__money-strip">' +
                cells.map(function (c) {
                  return (
                    '<div class="dp-assets__money-cell">' +
                      '<span>' + esc(c.k) + '</span>' +
                      '<strong>' + esc(c.v) + '</strong>' +
                    '</div>'
                  );
                }).join('') +
              '</div>'
            : '') +
          (w.note ? '<p class="dp-assets__money-note">' + esc(w.note) + '</p>' : '') +
        '</div>' +
      '</section>'
    );
  }

  function buildCards(as) {
    var list = as.cards || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-cards">' +
        band('02', '银行卡', '横滑 · 点按翻面') +
        '<div class="dp-assets__card-rail">' +
        list.map(function (c) {
          return (
            '<button type="button" class="dp-assets__card dp-assets__card--' + esc(monoTheme(c.theme)) + (c.flipped ? ' is-flip' : '') + '" data-act="flip-card" data-id="' + esc(c.id) + '">' +
              '<div class="dp-assets__card-face dp-assets__card-face--front">' +
                '<div class="dp-assets__card-top">' +
                  '<span class="dp-assets__card-bank">' + esc(c.bank) + '</span>' +
                  '<span class="dp-assets__card-chip" aria-hidden="true"></span>' +
                '</div>' +
                '<div class="dp-assets__card-no">••••  ••••  ••••  ' + esc(c.last4) + '</div>' +
                '<div class="dp-assets__card-bot">' +
                  '<div>' +
                    '<span>HOLDER</span>' +
                    '<strong>' + esc(c.holder || '—') + '</strong>' +
                  '</div>' +
                  '<div class="dp-assets__card-right">' +
                    '<span>' + esc(kindLabel(c.kind)) + '</span>' +
                    '<em>' + esc(c.network || '') + '</em>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="dp-assets__card-face dp-assets__card-face--back">' +
                '<span class="dp-assets__card-bal-label">BALANCE</span>' +
                '<strong class="dp-assets__card-bal">¥ ' + esc(c.balance || '—') + '</strong>' +
                (c.limit ? '<span class="dp-assets__card-limit">LIMIT ' + esc(c.limit) + '</span>' : '') +
                (c.note ? '<p>' + esc(c.note) + '</p>' : '') +
              '</div>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildPockets(as) {
    var list = as.pockets || [];
    if (!list.length) return '';
    var idx = state.pocketIndex;
    if (idx < 0) idx = 0;
    if (idx >= list.length) idx = list.length - 1;
    state.pocketIndex = idx;
    return (
      '<section class="dp-assets__block" id="as-pockets">' +
        band('03', '零钱包', '叠层封面 · 滑动翻页') +
        '<div class="dp-assets__deck" data-deck="pockets">' +
          '<div class="dp-assets__deck-stage" id="dp-assets-pocket-stage">' +
          list.map(function (p, i) {
            var rel = i - idx;
            var cls = 'dp-assets__cover';
            if (rel === 0) cls += ' is-front';
            else if (rel === 1 || (idx === list.length - 1 && i === 0 && list.length > 1)) cls += ' is-next';
            else if (rel === -1 || (idx === 0 && i === list.length - 1 && list.length > 1)) cls += ' is-prev';
            else cls += ' is-back';
            return (
              '<article class="' + cls + '" data-pocket-i="' + i + '" style="--rel:' + rel + '">' +
                '<div class="dp-assets__cover-shade" aria-hidden="true"></div>' +
                '<span class="dp-assets__cover-tape" aria-hidden="true"></span>' +
                '<span class="dp-assets__cover-fab" aria-hidden="true">+</span>' +
                '<span class="dp-assets__cover-idx">' + (('0' + (i + 1)).slice(-2)) + '</span>' +
                '<span class="dp-assets__cover-label">POCKET</span>' +
                '<strong class="dp-assets__cover-name">' + esc(p.name) + '</strong>' +
                '<b class="dp-assets__cover-bal">¥ ' + esc(p.balance || '0') + '</b>' +
                (p.note ? '<p class="dp-assets__cover-note">' + esc(p.note) + '</p>' : '') +
                '<i class="dp-assets__cover-mark">cover</i>' +
              '</article>'
            );
          }).join('') +
          '</div>' +
          '<div class="dp-assets__deck-bar">' +
            '<button type="button" class="dp-assets__deck-btn" data-act="pocket-prev" aria-label="上一页">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M15 6L9 12l6 6"/></svg>' +
            '</button>' +
            '<div class="dp-assets__deck-dots" role="tablist">' +
              list.map(function (_, i) {
                return '<button type="button" class="dp-assets__dot' + (i === idx ? ' is-on' : '') + '" data-act="pocket-goto" data-i="' + i + '" aria-label="第' + (i + 1) + '页"></button>';
              }).join('') +
            '</div>' +
            '<span class="dp-assets__deck-count">' + (idx + 1) + ' / ' + list.length + '</span>' +
            '<button type="button" class="dp-assets__deck-btn" data-act="pocket-next" aria-label="下一页">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function buildTxns(as) {
    var list = as.txns || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-txns">' +
        band('04', '金钱流水', '点按展开') +
        '<div class="dp-assets__sheet">' +
        list.map(function (t) {
          var sign = t.direction === 'in' ? '+' : '−';
          return (
            '<button type="button" class="dp-assets__txn' + (t.expanded ? ' is-on' : '') + '" data-act="expand-txn" data-id="' + esc(t.id) + '">' +
              '<div class="dp-assets__txn-main">' +
                '<span class="dp-assets__txn-dir dp-assets__txn-dir--' + esc(t.direction || 'out') + '" aria-hidden="true"></span>' +
                '<div class="dp-assets__txn-left">' +
                  '<strong>' + esc(t.title) + '</strong>' +
                  '<span>' + esc([t.time, t.category, t.channel].filter(Boolean).join(' · ')) + '</span>' +
                '</div>' +
                '<b class="dp-assets__txn-amt dp-assets__txn-amt--' + esc(t.direction) + '">' +
                  sign + esc(t.amount || '0') +
                '</b>' +
              '</div>' +
              (t.expanded
                ? '<div class="dp-assets__txn-detail">' +
                    (t.merchant ? '<span>商户 · ' + esc(t.merchant) + '</span>' : '') +
                    (t.note ? '<p>' + esc(t.note) + '</p>' : '') +
                  '</div>'
                : '') +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildHoldings(as) {
    var list = as.holdings || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-hold">' +
        band('05', '藏品', '横滑 · 点开检视') +
        '<div class="dp-assets__rail">' +
        list.map(function (h) {
          return (
            '<button type="button" class="dp-assets__plate' + (h.inspected ? ' is-on' : '') + '" data-act="inspect" data-id="' + esc(h.id) + '">' +
              '<span class="dp-assets__plate-frame" aria-hidden="true"></span>' +
              '<span class="dp-assets__plate-cat">' + esc(h.category || h.rarity || 'ITEM') + '</span>' +
              '<strong>' + esc(h.name) + '</strong>' +
              (h.valueLabel ? '<span class="dp-assets__plate-val">' + esc(h.valueLabel) + '</span>' : '') +
              (h.inspected && h.note ? '<p>' + esc(h.note) + '</p>' : '<i>检视</i>') +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildVaults(as) {
    var list = as.vaultBoxes || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-vault">' +
        band('06', '保险箱', '点按解锁') +
        '<div class="dp-assets__vaults">' +
        list.map(function (v) {
          return (
            '<button type="button" class="dp-assets__vault' + (v.unlocked ? ' is-on' : '') + '" data-act="unlock" data-id="' + esc(v.id) + '">' +
              '<div class="dp-assets__vault-face">' +
                '<span class="dp-assets__vault-grade">' + esc(v.grade || 'SEALED') + '</span>' +
                '<strong>' + esc(v.label) + '</strong>' +
                '<em class="dp-assets__vault-lock">' + (v.unlocked ? 'UNLOCKED' : 'LOCKED') + '</em>' +
              '</div>' +
              '<div class="dp-assets__vault-inner">' +
                (v.unlocked
                  ? '<p>' + esc(v.content) + '</p>'
                  : '<span>内容已封存</span>') +
              '</div>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildFlow(as) {
    var list = as.cashflow || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-flow">' +
        band('07', '流水', '点按钉住') +
        '<div class="dp-assets__timeline">' +
        list.map(function (f) {
          return (
            '<button type="button" class="dp-assets__tl' + (f.pinned ? ' is-on' : '') + '" data-act="pin-flow" data-id="' + esc(f.id) + '">' +
              '<span class="dp-assets__tl-dot" aria-hidden="true"></span>' +
              '<div class="dp-assets__tl-body">' +
                '<div class="dp-assets__tl-top">' +
                  '<span class="dp-assets__tl-time">' + esc(f.time || '—') + '</span>' +
                  '<span class="dp-assets__tl-dir">' + esc(DIR_LABEL[f.direction] || '·') + '</span>' +
                '</div>' +
                '<strong>' + esc(f.title) + '</strong>' +
                (f.amount ? '<b>' + esc(f.amount) + '</b>' : '') +
                (f.note ? '<p>' + esc(f.note) + '</p>' : '') +
              '</div>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildPort(as) {
    var list = as.portfolio || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-port">' +
        band('08', '持仓', '点按关注') +
        '<div class="dp-assets__sheet">' +
        list.map(function (p) {
          return (
            '<button type="button" class="dp-assets__row' + (p.watched ? ' is-on' : '') + '" data-act="watch" data-id="' + esc(p.id) + '">' +
              '<div class="dp-assets__row-head">' +
                '<strong>' + esc(p.name) + '</strong>' +
                '<span>' + esc([p.horizon, p.risk].filter(Boolean).join(' · ') || 'HOLD') + '</span>' +
              '</div>' +
              (p.thesis ? '<p>' + esc(p.thesis) + '</p>' : '') +
              '<i>' + (p.watched ? '已关注' : '关注') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildDebts(as) {
    var list = as.debts || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-debt">' +
        band('09', '负债', '点按结清') +
        '<div class="dp-assets__sheet">' +
        list.map(function (d) {
          return (
            '<button type="button" class="dp-assets__row' + (d.settled ? ' is-done' : '') + '" data-act="settle" data-id="' + esc(d.id) + '">' +
              '<div class="dp-assets__row-head">' +
                '<strong>' + esc(d.title) + '</strong>' +
                '<span>' + esc(SIDE_LABEL[d.side] || d.side) + '</span>' +
              '</div>' +
              (d.owed ? '<p>' + esc(d.owed) + '</p>' : '') +
              '<i>' + (d.settled ? '已结清' : '结清') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildClaims(as) {
    var list = as.claims || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-claim">' +
        band('10', '声明', '点按盖章') +
        '<div class="dp-assets__claims">' +
        list.map(function (c) {
          return (
            '<button type="button" class="dp-assets__claim' + (c.stamped ? ' is-on' : '') + '" data-act="stamp" data-id="' + esc(c.id) + '">' +
              (c.intensity ? '<span>' + esc(c.intensity) + '</span>' : '') +
              '<p>' + esc(c.text) + '</p>' +
              '<i>' + (c.stamped ? 'STAMPED' : 'STAMP') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildLots(as) {
    var list = as.auctions || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-lot">' +
        band('11', '拍卖', '横滑 · 点按出价') +
        '<div class="dp-assets__rail">' +
        list.map(function (a) {
          return (
            '<button type="button" class="dp-assets__plate dp-assets__plate--wide' + (a.placed ? ' is-on' : '') + '" data-act="bid" data-id="' + esc(a.id) + '">' +
              '<span class="dp-assets__plate-frame" aria-hidden="true"></span>' +
              '<span class="dp-assets__plate-cat">LOT</span>' +
              '<strong>' + esc(a.lot) + '</strong>' +
              (a.bid ? '<span class="dp-assets__plate-val">' + esc(a.bid) + '</span>' : '') +
              (a.fantasy ? '<p>' + esc(a.fantasy) + '</p>' : '') +
              '<i>' + (a.placed ? '已出价' : '出价') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildDivs(as) {
    var list = as.dividends || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-div">' +
        band('12', '分红', '点按领取') +
        '<div class="dp-assets__sheet">' +
        list.map(function (d) {
          return (
            '<button type="button" class="dp-assets__row' + (d.claimed ? ' is-on' : '') + '" data-act="claim-div" data-id="' + esc(d.id) + '">' +
              '<div class="dp-assets__row-head">' +
                '<strong>' + esc(d.title) + '</strong>' +
                (d.yield ? '<span>' + esc(d.yield) + '</span>' : '') +
              '</div>' +
              (d.note ? '<p>' + esc(d.note) + '</p>' : '') +
              '<i>' + (d.claimed ? '已领' : '领取') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildPols(as) {
    var list = as.policies || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-pol">' +
        band('13', '保单', '点按展开') +
        '<div class="dp-assets__sheet">' +
        list.map(function (p) {
          return (
            '<button type="button" class="dp-assets__row' + (p.expanded ? ' is-on' : '') + '" data-act="expand-pol" data-id="' + esc(p.id) + '">' +
              '<div class="dp-assets__row-head">' +
                '<strong>' + esc(p.name) + '</strong>' +
                (p.premium ? '<span>' + esc(p.premium) + '</span>' : '') +
              '</div>' +
              (p.coverage ? '<em class="dp-assets__cover-line">' + esc(p.coverage) + '</em>' : '') +
              (p.expanded && p.clause ? '<p>' + esc(p.clause) + '</p>' : '') +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildQuiz(as) {
    var list = as.appraisal || [];
    if (!list.length) return '';
    return (
      '<section class="dp-assets__block" id="as-quiz">' +
        band('14', '估值', '点按揭晓') +
        '<div class="dp-assets__sheet">' +
        list.map(function (q) {
          return (
            '<button type="button" class="dp-assets__row' + (q.revealed ? ' is-on' : '') + '" data-act="reveal" data-id="' + esc(q.id) + '">' +
              '<strong class="dp-assets__q">' + esc(q.q) + '</strong>' +
              (!q.revealed && q.hint ? '<em class="dp-assets__hint">' + esc(q.hint) + '</em>' : '') +
              (q.revealed && q.a ? '<p>' + esc(q.a) + '</p>' : '') +
              '<i>' + (q.revealed ? '已揭晓' : '揭晓') + '</i>' +
            '</button>'
          );
        }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildSeal(as) {
    if (!trim(as.sealNote)) return '';
    return (
      '<footer class="dp-assets__seal">' +
        '<span class="dp-assets__seal-mark">SEAL</span>' +
        '<p>' + esc(as.sealNote) + '</p>' +
      '</footer>'
    );
  }

  function pocketCount() {
    var as = getPayload();
    return (as && as.pockets && as.pockets.length) || 0;
  }

  function shiftPocket(delta) {
    var n = pocketCount();
    if (n < 2) return;
    state.pocketIndex = (state.pocketIndex + delta + n) % n;
    var as = getPayload();
    if (as) renderStream(as, true);
  }

  function gotoPocket(i) {
    var n = pocketCount();
    var idx = Number(i);
    if (!n || isNaN(idx) || idx < 0 || idx >= n) return;
    state.pocketIndex = idx;
    var as = getPayload();
    if (as) renderStream(as, true);
  }

  function captureScroll() {
    var main = $('dp-assets-scroll');
    var rails = [];
    var root = $('dp-assets-stream');
    if (root) {
      var nodes = root.querySelectorAll('.dp-assets__card-rail, .dp-assets__rail');
      for (var i = 0; i < nodes.length; i++) {
        rails.push(nodes[i].scrollLeft || 0);
      }
    }
    return {
      main: main ? main.scrollTop : 0,
      rails: rails,
      pocketIndex: state.pocketIndex
    };
  }

  function restoreScroll(snap) {
    if (!snap) return;
    var main = $('dp-assets-scroll');
    if (main) main.scrollTop = snap.main;
    var root = $('dp-assets-stream');
    if (!root) return;
    var nodes = root.querySelectorAll('.dp-assets__card-rail, .dp-assets__rail');
    for (var i = 0; i < nodes.length; i++) {
      if (typeof snap.rails[i] === 'number') nodes[i].scrollLeft = snap.rails[i];
    }
  }

  function renderStream(as, keepScroll) {
    var el = $('dp-assets-stream');
    if (!el) return;
    var snap = keepScroll ? captureScroll() : null;
    el.innerHTML = [
      buildHero(as),
      buildMoney(as),
      buildCards(as),
      buildPockets(as),
      buildTxns(as),
      buildHoldings(as),
      buildVaults(as),
      buildFlow(as),
      buildPort(as),
      buildDebts(as),
      buildClaims(as),
      buildLots(as),
      buildDivs(as),
      buildPols(as),
      buildQuiz(as),
      buildSeal(as)
    ].join('');
    if (snap) {
      restoreScroll(snap);
      requestAnimationFrame(function () { restoreScroll(snap); });
    }
  }

  function buildFullUI() {
    var as = getPayload();
    var empty = $('dp-assets-empty');
    var stream = $('dp-assets-stream');
    var has = hasContent(as);
    if (empty) empty.hidden = !!has;
    if (stream) {
      stream.hidden = !has;
      if (has) renderStream(as);
      else stream.innerHTML = '';
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadAssetsData(contactId) {
    var ts = assetsStore();
    if (!ts) return Promise.resolve(null);
    return ts.getAssets(contactId).then(function (data) {
      state.assetsData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-assets-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = assetsStore();
    var br = assetsBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchAssets(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的资产数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.assetsData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateAssets(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchAssets(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        assets: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.assetsData = saved;
        state.refreshing = false;
        state.pocketIndex = 0;
        if (state.open) {
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchAssets(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.assetsData = saved;
          state.refreshing = false;
          if (state.open) {
            updateStatusBar();
            updateRefreshBtn();
          }
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.assetsData && state.assetsData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function patchListItem(listKey, id, mutator) {
    var as = getPayload();
    if (!as || !as[listKey]) return;
    var item = findIn(as[listKey], id);
    if (!item) return;
    mutator(item);
    renderStream(as, true);
    persistPayload();
  }

  function onRootClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    ev.preventDefault();
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');

    if (act === 'assets-back') { close(); return; }
    if (act === 'assets-refresh') { handleRefresh(); return; }
    if (act === 'pocket-prev') { shiftPocket(-1); return; }
    if (act === 'pocket-next') { shiftPocket(1); return; }
    if (act === 'pocket-goto') {
      gotoPocket(btn.getAttribute('data-i'));
      return;
    }
    if (act === 'flip-card') {
      var asCards = getPayload();
      var card = asCards && findIn(asCards.cards, id);
      if (!card) return;
      card.flipped = !card.flipped;
      btn.classList.toggle('is-flip', !!card.flipped);
      persistPayload();
      return;
    }
    if (act === 'expand-txn') {
      patchListItem('txns', id, function (t) { t.expanded = !t.expanded; });
      return;
    }
    if (act === 'inspect') {
      patchListItem('holdings', id, function (h) { h.inspected = !h.inspected; });
      return;
    }
    if (act === 'unlock') {
      patchListItem('vaultBoxes', id, function (v) { v.unlocked = !v.unlocked; });
      return;
    }
    if (act === 'pin-flow') {
      patchListItem('cashflow', id, function (f) { f.pinned = !f.pinned; });
      return;
    }
    if (act === 'watch') {
      patchListItem('portfolio', id, function (p) { p.watched = !p.watched; });
      return;
    }
    if (act === 'settle') {
      patchListItem('debts', id, function (d) { d.settled = !d.settled; });
      return;
    }
    if (act === 'stamp') {
      patchListItem('claims', id, function (c) { c.stamped = !c.stamped; });
      return;
    }
    if (act === 'bid') {
      patchListItem('auctions', id, function (a) { a.placed = !a.placed; });
      return;
    }
    if (act === 'claim-div') {
      patchListItem('dividends', id, function (d) { d.claimed = !d.claimed; });
      return;
    }
    if (act === 'expand-pol') {
      patchListItem('policies', id, function (p) { p.expanded = !p.expanded; });
      return;
    }
    if (act === 'reveal') {
      patchListItem('appraisal', id, function (q) { q.revealed = true; });
    }
  }

  function onDeckTouchStart(ev) {
    var stage = ev.target && ev.target.closest ? ev.target.closest('#dp-assets-pocket-stage') : null;
    if (!stage) return;
    var t = ev.changedTouches && ev.changedTouches[0];
    if (!t) return;
    deckTouch = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onDeckTouchEnd(ev) {
    if (!deckTouch) return;
    var stage = ev.target && ev.target.closest ? ev.target.closest('#dp-assets-pocket-stage') : null;
    var t = ev.changedTouches && ev.changedTouches[0];
    var start = deckTouch;
    deckTouch = null;
    if (!stage || !t) return;
    var dx = t.clientX - start.x;
    var dy = t.clientY - start.y;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (Date.now() - start.t > 800) return;
    shiftPocket(dx < 0 ? 1 : -1);
  }

  function bindEvents() {
    var root = $('dp-assets');
    if (!root || root._dpAssetsBound) return;
    root._dpAssetsBound = true;
    root.addEventListener('click', onRootClick);
    root.addEventListener('touchstart', onDeckTouchStart, { passive: true });
    root.addEventListener('touchend', onDeckTouchEnd, { passive: true });

    global.addEventListener('miya-deep-assets-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      if (activeJobs[cid] || state.refreshing) return;
      loadAssetsData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-assets');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.pocketIndex = 0;
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadAssetsData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          assetsStore().patchAssets(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.assetsData = fixed;
            buildFullUI();
          });
          return;
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      buildFullUI();
    });
  }

  function close() {
    var layer = $('dp-assets');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
  }

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaDeepAssets = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
