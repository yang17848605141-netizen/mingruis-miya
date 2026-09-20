/**
 * miya-cstore-app.js — 74号便利店（探灵事务所）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    tab: 'normal',
    refreshing: false,
    negotiating: false,
    keeperTyping: false,
    transactionFulfilled: false,
    fulfilledTitle: '',
    pendingItem: null,
    pendingContact: null,
    keeperLines: []
  };

  var MYST_CATS = [
    { key: 'timeline', code: 'CHR', title: '过去与未来', hint: '选择角色，窥探完整时间线' },
    { key: 'wish', code: 'WSH', title: '交易愿望', hint: '实现你的愿望，或角色的愿望' },
    { key: 'antique', code: 'REL', title: '灵物古董', hint: '与角色羁绊的灵韵旧物' },
    { key: 'intel', code: 'INT', title: '情报信息', hint: '窥探角色不可示人的秘密' }
  ];

  var CUSTOM_LOT = {
    isCustom: true,
    name: '自定义契约',
    emoji: '◇',
    tag: 'CUS',
    desc: '向掌柜陈述你的渴求，说明交换之物，由他斟酌是否应允',
    exchangeHint: '记忆、誓言、旧物、时间……皆可呈上',
    rarity: 'rare'
  };

  var RARITY_LABELS = { common: '凡品', rare: '稀品', legendary: '至宝' };

  var CAT_CODES = {
    timeline: 'CHR', wish: 'WSH', antique: 'REL', intel: 'INT',
    '零食': 'SNK', '饮料': 'BEV', '便当': 'BNT', '日用品': 'DLY',
    '杂志': 'MAG', '便利': 'CVS', '食品': 'FOD', '其他': 'OTH'
  };

  function store() { return global.miyaChatStore || null; }
  function bridge() { return global.miyaCstoreBridge || null; }
  function wallet() { return global.MiyaChatWallet || null; }

  function hashStr(s) {
    var h = 0;
    var str = String(s || '');
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function itemTag(item) {
    if (item && item.tag) return String(item.tag).slice(0, 4).toUpperCase();
    var cat = item && (item.category || item.mysticalType) || '';
    if (CAT_CODES[cat]) return CAT_CODES[cat];
    var c = String(cat).replace(/\s/g, '');
    if (c.length >= 3) return c.slice(0, 3).toUpperCase();
    var name = String(item && item.name || 'LOT');
    return (name.slice(0, 2) + (c[0] || 'X')).toUpperCase();
  }

  function itemSku(item, index) {
    var h = hashStr((item && item.name || '') + (item && item.category || ''));
    var seq = typeof index === 'number' ? String(index + 1).padStart(3, '0') : String(h % 1000).padStart(3, '0');
    return '74-' + seq + '-' + itemTag(item);
  }

  function itemEmoji(item, fallback) {
    var e = item && item.emoji;
    if (e && String(e).trim()) return String(e).trim().slice(0, 4);
    return fallback || '📦';
  }

  function itemEmojiHtml(item, opts) {
    opts = opts || {};
    var fb = opts.bag ? '📦' : (opts.mystical ? '✦' : '🏪');
    var cls = 'cs-item-emoji' + (opts.sm ? ' cs-item-emoji--sm' : '') + (opts.lg ? ' cs-item-emoji--lg' : '');
    return '<span class="' + cls + '" aria-hidden="true">' + esc(itemEmoji(item, fb)) + '</span>';
  }

  function itemSigilHtml(item, opts) {
    opts = opts || {};
    var name = item && item.name || '';
    var cat = item && (item.category || item.mysticalType) || 'default';
    var h = hashStr(name + cat);
    var variant = h % 8;
    var hue = h % 360;
    var tone = opts.tone || (item && item.kind === 'mystical' ? 'myst' : 'norm');
    var size = opts.size ? ' cs-sigil--' + opts.size : '';
    return (
      '<div class="cs-sigil cs-sigil--v' + variant + ' cs-sigil--' + tone + size + '" style="--cs-sigil-h:' + hue + '" aria-hidden="true">' +
        '<span class="cs-sigil__mark"></span>' +
        '<span class="cs-sigil__tag">' + esc(itemTag(item)) + '</span>' +
      '</div>'
    );
  }

  function formatMoney(n) {
    if (wallet() && wallet().formatDisplay) return wallet().formatDisplay(n);
    return '¥' + (Number(n) || 0).toFixed(2);
  }

  var toastTimer = 0;
  function toast(msg) {
    var el = $('cs-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function showLoading(text) {
    var el = $('cs-loading');
    var tx = $('cs-loading-text');
    if (el) el.hidden = false;
    if (tx) tx.textContent = text || '加载中…';
  }

  function hideLoading() {
    var el = $('cs-loading');
    if (el) el.hidden = true;
  }

  function getActiveProfile() {
    var st = store();
    return st && st.getActiveProfile ? st.getActiveProfile() : null;
  }

  function getMaskInfo() {
    var prof = getActiveProfile();
    if (!prof) return null;
    return {
      id: prof.id,
      name: prof.name,
      nickname: prof.name,
      persona: prof.persona || ''
    };
  }

  function syncWallet() {
    var prof = getActiveProfile();
    var el = $('cs-wallet-val');
    if (!el) return;
    if (!prof) {
      el.textContent = '—';
      return;
    }
    var w = store().getWallet(prof.id);
    el.textContent = formatMoney(w.balance);
  }

  function formatRefreshTime(ts) {
    if (!ts) return '尚未刷新';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' · ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.cs-rail__tab').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-cs-tab') === tab);
    });
    document.querySelectorAll('.cs-page').forEach(function (pg) {
      pg.classList.toggle('is-active', pg.getAttribute('data-cs-page') === tab);
    });
    if (tab === 'bag') renderBackpack();
  }

  function buildLotHtml(item, opts) {
    opts = opts || {};
    var isMyst = !!opts.mystical;
    var footPrice = isMyst
      ? '<span class="cs-lot__price cs-lot__price--ex">交换</span>'
      : '<span class="cs-lot__price">' + formatMoney(item.price) + '</span>';
    var rarity = '';
    if (isMyst && item.rarity) {
      var rLabel = RARITY_LABELS[item.rarity] || '凡品';
      rarity = '<span class="cs-lot__rarity cs-lot__rarity--' + esc(item.rarity) + '">' + rLabel + '</span>';
    }
    return (
      '<div class="cs-lot__frame">' +
        '<div class="cs-lot__sigil-wrap">' + itemEmojiHtml(item, { mystical: isMyst, sm: true }) + '</div>' +
        '<div class="cs-lot__content">' +
          '<div class="cs-lot__head">' +
            '<span class="cs-lot__tag">' + esc(itemTag(item)) + '</span>' +
            rarity +
            footPrice +
          '</div>' +
          '<p class="cs-lot__cat">' + esc(isMyst ? (item.exchangeHint || '以物易之') : (item.category || '便利')) + '</p>' +
          '<p class="cs-lot__name">' + esc(item.name) + '</p>' +
          '<p class="cs-lot__desc">' + esc(item.desc || '') + '</p>' +
        '</div>' +
      '</div>'
    );
  }

  function renderNormalGrid() {
    var grid = $('cs-normal-grid');
    var empty = $('cs-normal-empty');
    var meta = $('cs-normal-meta');
    if (!grid) return;
    var cat = store() ? store().getShopCatalog() : { items: [], refreshedAt: 0 };
    if (meta) meta.textContent = 'REF · ' + formatRefreshTime(cat.refreshedAt);
    grid.innerHTML = '';
    if (!cat.items.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    cat.items.forEach(function (item, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'cs-lot';
      card.innerHTML = buildLotHtml(item, { index: i });
      card.addEventListener('click', function () { openBuySheet(item, 'normal'); });
      grid.appendChild(card);
    });
  }

  function buildCustomLot(catKey) {
    return Object.assign({}, CUSTOM_LOT, { category: catKey });
  }

  function renderMysticalGrid() {
    MYST_CATS.forEach(function (cat) {
      var container = $('cs-myst-' + cat.key);
      if (!container) return;
      container.innerHTML = '';
    });
    var catalog = store() ? store().getCstoreMystical() : { items: [] };
    var meta = $('cs-myst-meta');
    if (meta) meta.textContent = 'THR · ' + formatRefreshTime(catalog.refreshedAt);

    MYST_CATS.forEach(function (catDef) {
      var container = $('cs-myst-' + catDef.key);
      if (!container) return;
      var items = catalog.items.filter(function (it) { return it.category === catDef.key; });
      if (!items.length) {
        var emptyNote = document.createElement('p');
        emptyNote.className = 'cs-empty cs-empty--inline';
        emptyNote.style.cssText = 'padding:10px 0;font-size:10px;grid-column:1/-1';
        emptyNote.textContent = '暂无陈列 · 执行 OPEN 指令';
        container.appendChild(emptyNote);
      } else {
        items.forEach(function (item, i) {
          var card = document.createElement('button');
          card.type = 'button';
          card.className = 'cs-lot cs-lot--myst';
          card.innerHTML = buildLotHtml(item, { mystical: true, index: i });
          card.addEventListener('click', function () { openKeeperFlow(item); });
          container.appendChild(card);
        });
      }
      var customItem = buildCustomLot(catDef.key);
      var customCard = document.createElement('button');
      customCard.type = 'button';
      customCard.className = 'cs-lot cs-lot--myst cs-lot--custom';
      customCard.innerHTML = buildLotHtml(customItem, { mystical: true, index: items.length });
      customCard.addEventListener('click', function () { openKeeperFlow(customItem); });
      container.appendChild(customCard);
    });
  }

  function renderBackpack() {
    var list = $('cs-bag-list');
    var empty = $('cs-bag-empty');
    if (!list) return;
    var prof = getActiveProfile();
    list.innerHTML = '';
    if (!prof) {
      if (empty) {
        empty.hidden = false;
        var t = empty.querySelector('.cs-bag-empty__text');
        if (t) t.textContent = '请先创建聊天面具';
      }
      return;
    }
    var items = store().getProfileInventory(prof.id);
    if (!items.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    items.forEach(function (item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cs-hold-row';
      var tagCls = item.kind === 'mystical' ? 'cs-hold-row__tag cs-hold-row__tag--myst' : 'cs-hold-row__tag';
      var tagText = item.kind === 'mystical' ? '门扉' : '日常';
      var meta = item.category;
      if (item.targetName) meta += ' · ' + item.targetName;
      row.innerHTML =
        '<div class="cs-hold-row__sigil">' + itemEmojiHtml(item, { mystical: item.kind === 'mystical', bag: true, sm: true }) + '</div>' +
        '<div class="cs-hold-row__body">' +
          '<p class="cs-hold-row__name">' + esc(item.name) + '</p>' +
          '<p class="cs-hold-row__meta">' + esc(meta) + ' · ' + esc(itemSku(item)) + '</p>' +
        '</div>' +
        '<span class="' + tagCls + '">' + tagText + '</span>';
      row.addEventListener('click', function () { openItemDetail(item); });
      list.appendChild(row);
    });
  }

  function openBuySheet(item, kind) {
    var sheet = $('cs-buy-sheet');
    if (!sheet) return;
    state.pendingItem = { item: item, kind: kind };
    $('cs-buy-title').textContent = item.name || '';
    $('cs-buy-desc').textContent = item.desc || '';
    $('cs-buy-price').textContent = formatMoney(item.price);
    sheet.hidden = false;
  }

  function closeBuySheet() {
    var sheet = $('cs-buy-sheet');
    if (sheet) sheet.hidden = true;
    state.pendingItem = null;
  }

  function confirmBuy() {
    var pending = state.pendingItem;
    if (!pending || pending.kind !== 'normal') return;
    var item = pending.item;
    var prof = getActiveProfile();
    if (!prof) { toast('请先在聊天中创建面具'); return; }
    var price = Number(item.price) || 0;
    if (!(price > 0)) { toast('价格无效'); return; }
    store().adjustWalletBalance(prof.id, -price).then(function () {
      return store().addInventoryItem(prof.id, {
        name: item.name,
        emoji: itemEmoji(item, '🏪'),
        tag: itemTag(item),
        desc: item.desc,
        price: price,
        category: item.category || '便利',
        kind: 'normal'
      });
    }).then(function () {
      syncWallet();
      closeBuySheet();
      toast('已购入 · 存入背包');
      if (state.tab === 'bag') renderBackpack();
    }).catch(function (e) {
      var msg = String(e && e.message || e);
      toast(msg === 'insufficient_balance' ? '余额不足' : msg);
    });
  }

  function formatItemContent(item) {
    var br = bridge();
    var raw = item && item.content;
    var text = br && br.normalizeContent ? br.normalizeContent(raw) : String(raw || '').trim();
    if (!text || text === '[object Object]') text = String(item && item.desc || '').trim();
    return text || '（暂无详情）';
  }

  function openItemDetail(item) {
    var el = $('cs-detail');
    if (!el) return;
    $('cs-detail-title').textContent = item.name || '';
    var contentEl = $('cs-detail-content');
    if (!contentEl) return;
    var br = bridge();
    if (item.kind === 'mystical' && br && br.renderMysticalDetailHtml) {
      contentEl.className = 'cs-detail__content cs-detail__content--myst';
      contentEl.innerHTML = br.renderMysticalDetailHtml(item);
    } else {
      contentEl.className = 'cs-detail__content';
      contentEl.textContent = formatItemContent(item);
    }
    el.hidden = false;
  }

  function closeItemDetail() {
    var el = $('cs-detail');
    if (el) el.hidden = true;
  }

  function openKeeperFlow(item) {
    state.pendingItem = item;
    state.pendingContact = null;
    state.keeperLines = [];
    state.keeperTyping = false;
    state.transactionFulfilled = false;
    state.fulfilledTitle = '';
    state.isCustomFlow = !!(item && item.isCustom);
    var keeper = $('cs-keeper');
    if (!keeper) return;
    keeper.hidden = false;
    renderKeeperDialogue();
    renderKeeperForm(item);

    var greetEl = $('cs-keeper-greet');
    var offerRef = String(item.exchangeHint || CUSTOM_LOT.exchangeHint || '').trim();
    if (greetEl) {
      greetEl.textContent = state.isCustomFlow
        ? '自定义契约——你想要什么？又愿用什么交换？'
        : '「' + (item.name || '') + '」——你想用什么来换？';
      if (offerRef) greetEl.textContent += '\n提示：' + offerRef;
    }

    requestAnimationFrame(function () {
      var formEl = $('cs-keeper-form');
      var hintEl = formEl && formEl.querySelector('.cs-keeper__hint--offer');
      if (hintEl) hintEl.scrollIntoView({ block: 'nearest' });
    });

    var br = bridge();
    var mask = getMaskInfo();
    if (br && br.getShopkeeperGreeting) {
      br.getShopkeeperGreeting(mask).then(function (lines) {
        lines.forEach(function (l) { appendKeeperLine(l, false); });
      });
    }
  }

  function closeKeeperFlow() {
    var keeper = $('cs-keeper');
    if (keeper) keeper.hidden = true;
    state.pendingItem = null;
    state.pendingContact = null;
    state.keeperLines = [];
    state.keeperTyping = false;
    state.negotiating = false;
    state.transactionFulfilled = false;
    state.fulfilledTitle = '';
    state.isCustomFlow = false;
  }

  function setKeeperTyping(on) {
    state.keeperTyping = !!on;
    renderKeeperDialogue();
  }

  function renderKeeperDialogue() {
    var box = $('cs-keeper-dialogue');
    if (!box) return;
    box.innerHTML = '';
    state.keeperLines.forEach(function (entry) {
      var div = document.createElement('div');
      div.className = 'cs-keeper__line' + (entry.user ? ' cs-keeper__line--user' : '');
      div.textContent = entry.text;
      box.appendChild(div);
    });
    if (state.keeperTyping) {
      var typing = document.createElement('div');
      typing.className = 'cs-keeper__line cs-keeper__line--typing';
      typing.setAttribute('aria-live', 'polite');
      typing.textContent = '掌柜正在回复…';
      box.appendChild(typing);
    }
    box.scrollTop = box.scrollHeight;
  }

  function appendKeeperLine(text, isUser) {
    state.keeperLines.push({ text: text, user: !!isUser });
    renderKeeperDialogue();
  }

  function renderContactPicker(form) {
    var pickWrap = document.createElement('div');
    pickWrap.className = 'cs-keeper__field';
    pickWrap.innerHTML = '<label>选择联动角色</label>';
    var chips = document.createElement('div');
    chips.className = 'cs-contact-pick';
    var contacts = store() ? store().getContacts() : [];
    if (!contacts.length) {
      pickWrap.innerHTML += '<p class="cs-keeper__hint">暂无联系人，请先在聊天中添加角色</p>';
    } else {
      contacts.forEach(function (c) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cs-contact-chip';
        chip.textContent = c.name || '未命名';
        chip.addEventListener('click', function () {
          state.pendingContact = c;
          chips.querySelectorAll('.cs-contact-chip').forEach(function (x) {
            x.classList.toggle('is-active', x === chip);
          });
        });
        chips.appendChild(chip);
      });
    }
    pickWrap.appendChild(chips);
    form.appendChild(pickWrap);
  }

  function renderKeeperForm(item) {
    var form = $('cs-keeper-form');
    if (!form) return;
    form.innerHTML = '';

    renderContactPicker(form);

    if (state.isCustomFlow) {
      var wantField = document.createElement('div');
      wantField.className = 'cs-keeper__field';
      wantField.innerHTML =
        '<label>我想要</label>' +
        '<textarea id="cs-keeper-want" placeholder="向掌柜陈述你的渴求……" rows="3"></textarea>';
      form.appendChild(wantField);
    }

    if (item.category === 'wish' && !state.isCustomFlow) {
      var wishField = document.createElement('div');
      wishField.className = 'cs-keeper__field';
      wishField.innerHTML =
        '<label>你的愿望</label>' +
        '<textarea id="cs-keeper-wish" placeholder="写下你想实现的愿望；也可同时触及角色的愿望…" rows="2"></textarea>';
      form.appendChild(wishField);
    }

    var offerHint = String(item.exchangeHint || CUSTOM_LOT.exchangeHint || '记忆、誓言、旧物、时间……皆可呈上').trim();
    var offerField = document.createElement('div');
    offerField.className = 'cs-keeper__field';
    offerField.innerHTML =
      '<label>用于交换之物</label>' +
      (offerHint
        ? '<p class="cs-keeper__hint cs-keeper__hint--offer">提示：' + esc(offerHint) + '</p>'
        : '') +
      '<textarea id="cs-keeper-offer" placeholder="记忆、旧物、誓言、时间……你想用什么来换？" rows="3"></textarea>';
    form.appendChild(offerField);

    var chatField = document.createElement('div');
    chatField.className = 'cs-keeper__field cs-keeper__field--chat';
    chatField.innerHTML =
      '<label>与掌柜交谈</label>' +
      '<div class="cs-keeper__chat-row">' +
        '<input type="text" id="cs-keeper-chat" placeholder="有话可对掌柜说…" autocomplete="off">' +
        '<button type="button" class="cs-keeper__chat-btn" id="cs-keeper-chat-btn">说</button>' +
      '</div>';
    form.appendChild(chatField);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-keeper__submit';
    btn.id = 'cs-keeper-submit';
    btn.textContent = '呈上交换之物';
    btn.addEventListener('click', submitNegotiation);
    form.appendChild(btn);

    var chatBtn = $('cs-keeper-chat-btn');
    if (chatBtn) chatBtn.addEventListener('click', submitKeeperChat);
    var chatInput = $('cs-keeper-chat');
    if (chatInput) {
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitKeeperChat();
        }
      });
    }
  }

  function getKeeperFormValues() {
    var offerEl = $('cs-keeper-offer');
    var wishEl = $('cs-keeper-wish');
    var wantEl = $('cs-keeper-want');
    return {
      offer: offerEl ? offerEl.value.trim() : '',
      userWish: wishEl ? wishEl.value.trim() : '',
      customWant: wantEl ? wantEl.value.trim() : ''
    };
  }

  function buildKeeperPayload() {
    var br = bridge();
    var vals = getKeeperFormValues();
    var contactCtx = '';
    if (state.pendingContact && br && br.buildContactContext) {
      contactCtx = br.buildContactContext(state.pendingContact, getActiveProfile());
    }
    return {
      item: state.pendingItem,
      offer: vals.offer,
      maskInfo: getMaskInfo(),
      contactContext: contactCtx,
      userWish: vals.userWish,
      customWant: vals.customWant,
      isCustom: state.isCustomFlow,
      transactionFulfilled: state.transactionFulfilled,
      fulfilledTitle: state.fulfilledTitle,
      chatHistory: state.keeperLines.map(function (row) {
        return { text: row.text, user: !!row.user };
      })
    };
  }

  function submitKeeperChat() {
    if (state.negotiating) return;
    var chatEl = $('cs-keeper-chat');
    var message = chatEl ? chatEl.value.trim() : '';
    if (!message) { toast('请输入想说的话'); return; }
    if (!state.pendingContact) { toast('请先选择联动角色'); return; }

    appendKeeperLine(message, true);
    if (chatEl) chatEl.value = '';
    state.negotiating = true;
    setKeeperTyping(true);
    var chatBtn = $('cs-keeper-chat-btn');
    if (chatBtn) { chatBtn.disabled = true; chatBtn.textContent = '…'; }
    if (chatEl) chatEl.disabled = true;

    var br = bridge();
    if (!br || !br.chatWithKeeper) {
      toast('模块未加载');
      state.negotiating = false;
      setKeeperTyping(false);
      if (chatBtn) { chatBtn.disabled = false; chatBtn.textContent = '说'; }
      if (chatEl) chatEl.disabled = false;
      return;
    }

    var payload = buildKeeperPayload();
    payload.message = message;

    br.chatWithKeeper(payload).then(function (result) {
      result.lines.forEach(function (l) { appendKeeperLine(l, false); });
      if (result.accepted) {
        return fulfillMysticalItem(state.pendingItem, {
          resultTitle: result.resultTitle,
          resultContent: result.resultContent
        }, state.pendingContact);
      }
    }).catch(function (e) {
      appendKeeperLine('……此事，暂且作罢吧。', false);
      toast(String(e.message || e));
    }).finally(function () {
      state.negotiating = false;
      setKeeperTyping(false);
      if (chatBtn) { chatBtn.disabled = false; chatBtn.textContent = '说'; }
      if (chatEl) chatEl.disabled = false;
    });
  }

  function submitNegotiation() {
    if (state.negotiating) return;
    var item = state.pendingItem;
    if (!item) return;
    var vals = getKeeperFormValues();
    if (!vals.offer) { toast('请说明你想用什么交换'); return; }
    if (!state.pendingContact) { toast('请先选择联动角色'); return; }
    if (state.isCustomFlow && !vals.customWant) { toast('请说明你想要什么'); return; }

    appendKeeperLine('（呈上：' + vals.offer + '）', true);
    if (state.isCustomFlow && vals.customWant) {
      appendKeeperLine('（渴求：' + vals.customWant + '）', true);
    }
    state.negotiating = true;
    setKeeperTyping(true);
    var btn = $('cs-keeper-submit');
    if (btn) { btn.disabled = true; btn.textContent = '店长正在考量…'; }

    var br = bridge();
    if (!br || !br.negotiatePurchase) {
      toast('模块未加载');
      state.negotiating = false;
      setKeeperTyping(false);
      if (btn) { btn.disabled = false; btn.textContent = '呈上交换之物'; }
      return;
    }

    br.negotiatePurchase(buildKeeperPayload()).then(function (result) {
      result.shopkeeperLines.forEach(function (l) { appendKeeperLine(l, false); });
      if (result.accepted) {
        return fulfillMysticalItem(item, result, state.pendingContact);
      }
      toast('交换未达成 · 可继续与掌柜交谈或调整交换物');
    }).catch(function (e) {
      appendKeeperLine('……此事，暂且作罢吧。', false);
      toast(String(e.message || e));
    }).finally(function () {
      state.negotiating = false;
      setKeeperTyping(false);
      if (btn) { btn.disabled = false; btn.textContent = '呈上交换之物'; }
    });
  }

  function fulfillMysticalItem(item, result, contact) {
    var prof = getActiveProfile();
    if (!prof) { toast('面具未找到'); return Promise.resolve(); }
    var content = result.resultContent;
    var targetName = contact ? contact.name : '';
    if (content && typeof content === 'object' && content.targetName) {
      targetName = content.targetName || targetName;
    }
    var title = result.resultTitle || item.name;
    if (state.isCustomFlow && !result.resultTitle) {
      var wantEl = $('cs-keeper-want');
      var customWant = wantEl ? wantEl.value.trim() : '';
      if (customWant) title = customWant.slice(0, 24);
    }
    return store().addInventoryItem(prof.id, {
      name: title,
      emoji: itemEmoji(item, '✦'),
      tag: itemTag(item),
      desc: item.desc,
      price: 0,
      category: MYST_CATS.find(function (c) { return c.key === item.category; })
        ? MYST_CATS.find(function (c) { return c.key === item.category; }).title
        : '门扉',
      kind: 'mystical',
      mysticalType: item.category,
      content: content,
      targetContactId: contact ? contact.id : '',
      targetName: targetName
    }).then(function () {
      state.transactionFulfilled = true;
      state.fulfilledTitle = title;
      toast('交易达成 · 已存入背包');
    });
  }

  async function refreshNormal() {
    if (state.refreshing) return;
    var br = bridge();
    var st = store();
    if (!br || !st) { toast('模块未加载'); return; }
    state.refreshing = true;
    var btn = $('cs-refresh-normal');
    if (btn) btn.disabled = true;
    showLoading('正在刷新货架…');
    try {
      var mask = getMaskInfo();
      var items = await br.generateNormalItems(mask);
      await st.saveShopCatalog({
        mode: 'gift',
        refreshedAt: Date.now(),
        searchQuery: '',
        items: items
      });
      renderNormalGrid();
      toast('货架已刷新');
    } catch (e) {
      toast(String(e.message || e));
    }
    hideLoading();
    state.refreshing = false;
    if (btn) btn.disabled = false;
  }

  async function refreshMystical() {
    if (state.refreshing) return;
    var br = bridge();
    var st = store();
    if (!br || !st) { toast('模块未加载'); return; }
    state.refreshing = true;
    var btn = $('cs-refresh-myst');
    if (btn) btn.disabled = true;
    showLoading('门扉正在开启…');
    try {
      var mask = getMaskInfo();
      var items = await br.generateMysticalItems(mask);
      await st.saveCstoreMystical({
        refreshedAt: Date.now(),
        items: items
      });
      renderMysticalGrid();
      var greet = $('cs-door-greet');
      if (greet && br.getShopkeeperGreeting) {
        var lines = await br.getShopkeeperGreeting(mask);
        greet.textContent = lines.join(' ');
      }
      toast('门扉商品已更新');
    } catch (e) {
      toast(String(e.message || e));
    }
    hideLoading();
    state.refreshing = false;
    if (btn) btn.disabled = false;
  }

  function renderAll() {
    syncWallet();
    renderNormalGrid();
    renderMysticalGrid();
    if (state.tab === 'bag') renderBackpack();
  }

  function bindEvents() {
    var back = $('cs-back');
    if (back) back.addEventListener('click', closeCstoreApp);

    document.querySelectorAll('.cs-rail__tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTab(btn.getAttribute('data-cs-tab'));
      });
    });

    var rn = $('cs-refresh-normal');
    if (rn) rn.addEventListener('click', refreshNormal);

    var rm = $('cs-refresh-myst');
    if (rm) rm.addEventListener('click', refreshMystical);

    var buyCancel = $('cs-buy-cancel');
    if (buyCancel) buyCancel.addEventListener('click', closeBuySheet);

    var buyConfirm = $('cs-buy-confirm');
    if (buyConfirm) buyConfirm.addEventListener('click', confirmBuy);

    var keeperBack = $('cs-keeper-back');
    if (keeperBack) keeperBack.addEventListener('click', closeKeeperFlow);

    var detailBack = $('cs-detail-back');
    if (detailBack) detailBack.addEventListener('click', closeItemDetail);

    var sheet = $('cs-buy-sheet');
    if (sheet) {
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) closeBuySheet();
      });
    }
  }

  function openCstoreApp() {
    var el = $('miya-cstore-app');
    if (!el) return;
    var chain = Promise.resolve();
    var st = store();
    if (st && st.init) chain = chain.then(function () { return st.init(); });
    var cs = global.miyaContactsStore;
    if (cs && cs.whenReady) chain = chain.then(function () { return cs.whenReady(); });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      setTab('normal');
      closeBuySheet();
      closeKeeperFlow();
      closeItemDetail();
      requestAnimationFrame(function () {
        syncWallet();
        renderNormalGrid();
        requestAnimationFrame(function () {
          renderMysticalGrid();
        });
      });
    });
  }

  function closeCstoreApp() {
    var el = $('miya-cstore-app');
    if (!el) return;
    closeBuySheet();
    closeKeeperFlow();
    closeItemDetail();
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('#miya-music-app.is-open') &&
        !document.querySelector('#miya-chat-app.is-open') &&
        !document.querySelector('#miya-memory-app.is-open') &&
        !document.querySelector('#miya-offline-app.is-open') &&
        !document.querySelector('#miya-typewriter-app.is-open') &&
        !document.querySelector('#miya-forum-app.is-open') &&
        !document.querySelector('.miya-cstore-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  bindEvents();

  global.miyaCstoreGlyphs = {
    itemSigilHtml: itemSigilHtml,
    itemEmojiHtml: itemEmojiHtml,
    itemEmoji: itemEmoji,
    itemTag: itemTag,
    itemSku: itemSku,
    esc: esc
  };

  global.miyaCstoreApp = {
    open: openCstoreApp,
    close: closeCstoreApp
  };
})(typeof window !== 'undefined' ? window : global);
