/**
 * miya-deep-shop.js — 深入 · 角色手机 购物界面
 * 布局：会员名片 + 物流轨 + 购物车条 + Ins 种草双列 + iOS 订单组（与其他深入 App 完全不同）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var TONE_MAP = {
    sand: 'tone-sand',
    mist: 'tone-mist',
    ink: 'tone-ink',
    coral: 'tone-coral',
    sage: 'tone-sage'
  };

  var TONE_FALLBACK = ['tone-sand', 'tone-mist', 'tone-ink', 'tone-coral', 'tone-sage'];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    shopData: null,
    refreshing: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function shopStore() { return global.miyaDeepShopStore || null; }
  function shopBridge() { return global.miyaDeepShopBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-shop-toast');
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
    var text = $('dp-shop-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的购物数据');
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
    var bar = $('dp-shop-status');
    var text = $('dp-shop-status-text');
    if (!bar || !text) return;
    var data = state.shopData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的购物数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已成功读取';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-shop__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-shop__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-shop-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.shopData && state.shopData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function initialOf(name) {
    var s = String(name || '').trim();
    if (!s) return '购';
    return s.charAt(0);
  }

  function money(v) {
    var s = String(v || '').trim().replace(/^[¥￥]/, '');
    if (!s) return '';
    return '<small>¥</small>' + esc(s);
  }

  function moneyText(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    return s.indexOf('¥') === 0 || s.indexOf('￥') === 0 ? s : ('¥' + s);
  }

  function statusClass(status) {
    var s = String(status || '');
    if (/收货|完成|已评|签收/.test(s)) return 'is-done';
    if (/运输|派送|途中|揽收/.test(s)) return 'is-ing';
    if (/待|支付|取件|发货/.test(s)) return 'is-wait';
    return '';
  }

  function hasAnyContent(shop) {
    if (!shop) return false;
    return !!(
      (shop.orders && shop.orders.length) ||
      (shop.cart && shop.cart.length) ||
      (shop.wishlist && shop.wishlist.length) ||
      (shop.packages && shop.packages.length) ||
      (shop.follows && shop.follows.length) ||
      (shop.browsed && shop.browsed.length) ||
      (shop.coupons && shop.coupons.length) ||
      (shop.addresses && shop.addresses.length) ||
      (shop.gifts && shop.gifts.length) ||
      (shop.member && (shop.member.tier || shop.member.style || shop.member.spendMonth)) ||
      (shop.habits && (shop.habits.prefer || shop.habits.routine)) ||
      shop.overview ||
      shop.footerNote
    );
  }

  function renderMember(shop) {
    var el = $('dp-shop-member');
    if (!el) return;
    var m = shop && shop.member;
    var has =
      m && (m.tier || m.points || m.spendMonth || m.orderCount || m.style || m.note);
    if (!has && !(shop && shop.dateLabel)) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    m = m || {};
    el.innerHTML =
      '<div class="dp-shop__member">' +
        '<div class="dp-shop__member-top">' +
          '<div class="dp-shop__member-avatar">' + esc(initialOf(state.contactName)) + '</div>' +
          '<div class="dp-shop__member-meta">' +
            '<div class="dp-shop__member-name">' +
              esc(state.contactName || 'ta') +
              (m.tier ? '<em>' + esc(m.tier) + '</em>' : '') +
            '</div>' +
            (m.style ? '<p class="dp-shop__member-style">' + esc(m.style) + '</p>' : '') +
            (shop.dateLabel ? '<span class="dp-shop__member-date">' + esc(shop.dateLabel) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="dp-shop__member-stats">' +
          '<div><b>' + esc(m.spendMonth || '—') + '</b><span>本月消费</span></div>' +
          '<div><b>' + esc(m.orderCount || '—') + '</b><span>本月订单</span></div>' +
          '<div><b>' + esc(m.points || '—') + '</b><span>积分</span></div>' +
        '</div>' +
        (m.note ? '<p class="dp-shop__member-note">' + esc(m.note) + '</p>' : '') +
      '</div>';
  }

  function renderPackages(shop) {
    var el = $('dp-shop-packages');
    if (!el) return;
    var list = shop && shop.packages || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-shop__sec-head">' +
        '<h2 class="dp-shop__sec-title">在途包裹</h2>' +
        '<span class="dp-shop__sec-more">' + list.length + '件</span>' +
      '</div>' +
      '<div class="dp-shop__pkg-rail">' +
        list.map(function (p, i) {
          var pct = Math.max(0, Math.min(100, Number(p.progress) || 0));
          return (
            '<article class="dp-shop__pkg" style="--pk-i:' + i + '">' +
              '<div class="dp-shop__pkg-side">' +
                '<i class="dp-shop__pkg-dot"></i>' +
                (i < list.length - 1 ? '<span class="dp-shop__pkg-line"></span>' : '') +
              '</div>' +
              '<div class="dp-shop__pkg-card">' +
                '<div class="dp-shop__pkg-head">' +
                  '<span class="dp-shop__pkg-status ' + statusClass(p.status) + '">' + esc(p.status || '运输中') + '</span>' +
                  (p.eta ? '<span class="dp-shop__pkg-eta">' + esc(p.eta) + '</span>' : '') +
                '</div>' +
                (p.shop ? '<div class="dp-shop__pkg-shop">' + esc(p.shop) + '</div>' : '') +
                (p.title ? '<h3 class="dp-shop__pkg-title">' + esc(p.title) + '</h3>' : '') +
                '<div class="dp-shop__pkg-track" role="progressbar" aria-valuenow="' + pct + '">' +
                  '<span style="width:' + pct + '%"></span>' +
                '</div>' +
                '<div class="dp-shop__pkg-foot">' +
                  '<span>' +
                    (p.carrier ? esc(p.carrier) : '') +
                    (p.tracking ? (p.carrier ? ' · ' : '') + '尾号 ' + esc(p.tracking) : '') +
                  '</span>' +
                  (p.price ? '<span class="dp-shop__price">' + money(p.price) + '</span>' : '') +
                '</div>' +
              '</div>' +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderCart(shop) {
    var el = $('dp-shop-cart');
    if (!el) return;
    var list = shop && shop.cart || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-shop__sec-head">' +
        '<h2 class="dp-shop__sec-title">购物车</h2>' +
        '<span class="dp-shop__sec-more">' + list.length + '件待结算</span>' +
      '</div>' +
      '<div class="dp-shop__cart-sheet">' +
        list.map(function (c, i) {
          return (
            '<div class="dp-shop__cart-row" style="--ct-i:' + i + '">' +
              '<div class="dp-shop__cart-thumb">' + esc(initialOf(c.title || c.shop)) + '</div>' +
              '<div class="dp-shop__cart-body">' +
                (c.shop ? '<span class="dp-shop__cart-shop">' + esc(c.shop) + '</span>' : '') +
                '<strong>' + esc(c.title) + '</strong>' +
                (c.sku ? '<span class="dp-shop__cart-sku">' + esc(c.sku) + '</span>' : '') +
                '<div class="dp-shop__cart-foot">' +
                  '<span class="dp-shop__price">' + money(c.price) + '</span>' +
                  (c.origin ? '<s>' + esc(moneyText(c.origin)) + '</s>' : '') +
                  (c.tag ? '<em class="dp-shop__cart-tag">' + esc(c.tag) + '</em>' : '') +
                  '<span class="dp-shop__cart-qty">×' + (c.qty || 1) + '</span>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>';
  }

  function renderWishlist(shop) {
    var el = $('dp-shop-wishlist');
    if (!el) return;
    var list = shop && shop.wishlist || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-shop__sec-head">' +
        '<h2 class="dp-shop__sec-title">想买清单</h2>' +
        '<span class="dp-shop__sec-more">种草 ' + list.length + '</span>' +
      '</div>' +
      '<div class="dp-shop__wish-grid">' +
        list.map(function (w, i) {
          var tone = TONE_MAP[w.tone] || TONE_FALLBACK[i % TONE_FALLBACK.length];
          return (
            '<article class="dp-shop__wish ' + tone + '" style="--ws-i:' + i + '">' +
              '<div class="dp-shop__wish-cover">' +
                '<span>' + esc(initialOf(w.title)) + '</span>' +
              '</div>' +
              '<div class="dp-shop__wish-body">' +
                '<h3>' + esc(w.title) + '</h3>' +
                (w.shop ? '<span class="dp-shop__wish-shop">' + esc(w.shop) + '</span>' : '') +
                (w.price ? '<div class="dp-shop__price">' + money(w.price) + '</div>' : '') +
                (w.reason ? '<p>' + esc(w.reason) + '</p>' : '') +
              '</div>' +
            '</article>'
          );
        }).join('') +
      '</div>';
  }

  function renderOrderCard(order, index) {
    var itemsHtml = (order.items || []).map(function (it) {
      return (
        '<li>' +
          '<span>' + esc(it.name) + (it.sku ? ' · ' + esc(it.sku) : '') + '</span>' +
          '<span>×' + (it.qty || 1) + '</span>' +
          (it.price ? '<span>' + esc(moneyText(it.price)) + '</span>' : '') +
        '</li>'
      );
    }).join('');

    return (
      '<article class="dp-shop__order" style="--od-i:' + index + '">' +
        '<header class="dp-shop__order-head">' +
          '<div>' +
            '<strong>' + esc(order.shop || '店铺') + '</strong>' +
            (order.time ? '<span>' + esc(order.time) + '</span>' : '') +
          '</div>' +
          (order.status
            ? '<em class="dp-shop__order-status ' + statusClass(order.status) + '">' + esc(order.status) + '</em>'
            : '') +
        '</header>' +
        (order.title ? '<h3 class="dp-shop__order-title">' + esc(order.title) + '</h3>' : '') +
        (itemsHtml ? '<ul class="dp-shop__order-items">' + itemsHtml + '</ul>' : '') +
        '<div class="dp-shop__order-sum">' +
          (order.freight ? '<span>运费 ' + esc(moneyText(order.freight)) + '</span>' : '<span></span>') +
          (order.amount ? '<span class="dp-shop__price">实付 ' + money(order.amount) + '</span>' : '') +
        '</div>' +
        '<div class="dp-shop__order-meta">' +
          (order.category ? '<span>' + esc(order.category) + '</span>' : '') +
          (order.payMethod ? '<span>' + esc(order.payMethod) + '</span>' : '') +
        '</div>' +
        (order.review ? '<p class="dp-shop__order-review">' + esc(order.review) + '</p>' : '') +
        (order.reason ? '<p class="dp-shop__order-reason">' + esc(order.reason) + '</p>' : '') +
        (order.address ? '<p class="dp-shop__order-addr">' + esc(order.address) + '</p>' : '') +
      '</article>'
    );
  }

  function renderOrders(shop) {
    var el = $('dp-shop-orders');
    if (!el) return;
    var list = shop && shop.orders || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-shop__sec-head">' +
        '<h2 class="dp-shop__sec-title">我的订单</h2>' +
        '<span class="dp-shop__sec-more">' + list.length + '单</span>' +
      '</div>' +
      '<div class="dp-shop__order-stack">' + list.map(renderOrderCard).join('') + '</div>';
  }

  function renderHabits(shop) {
    var el = $('dp-shop-habits');
    if (!el) return;
    var h = shop && shop.habits;
    if (!h || (!h.budget && !h.prefer && !h.avoid && !h.routine)) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var rows = [];
    if (h.budget) {
      rows.push('<div class="dp-shop__habit-row"><span>预算</span><b>' + esc(h.budget) + '</b></div>');
    }
    if (h.prefer) {
      rows.push('<div class="dp-shop__habit-row"><span>常买</span><b>' + esc(h.prefer) + '</b></div>');
    }
    if (h.avoid) {
      rows.push('<div class="dp-shop__habit-row"><span>不买</span><b>' + esc(h.avoid) + '</b></div>');
    }
    if (h.routine) {
      rows.push('<div class="dp-shop__habit-row"><span>习惯</span><b>' + esc(h.routine) + '</b></div>');
    }
    el.innerHTML =
      '<div class="dp-shop__sec-head">' +
        '<h2 class="dp-shop__sec-title">购物习惯</h2>' +
      '</div>' +
      '<div class="dp-shop__habit-sheet">' + rows.join('') + '</div>';
  }

  function renderSides(shop) {
    var el = $('dp-shop-sides');
    if (!el) return;
    var parts = [];

    var follows = shop && shop.follows || [];
    if (follows.length) {
      parts.push(
        '<section class="dp-shop__side">' +
          '<h3>常逛店铺</h3>' +
          '<div class="dp-shop__follow-wrap">' +
            follows.map(function (f) {
              return (
                '<div class="dp-shop__follow">' +
                  '<span class="dp-shop__follow-mark">' + esc(initialOf(f.shop)) + '</span>' +
                  '<div>' +
                    '<strong>' + esc(f.shop) + '</strong>' +
                    (f.category ? '<span>' + esc(f.category) + '</span>' : '') +
                    (f.note ? '<p>' + esc(f.note) + '</p>' : '') +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
        '</section>'
      );
    }

    var coupons = shop && shop.coupons || [];
    if (coupons.length) {
      parts.push(
        '<section class="dp-shop__side">' +
          '<h3>优惠券</h3>' +
          '<div class="dp-shop__coupon-rail">' +
            coupons.map(function (c) {
              return (
                '<div class="dp-shop__coupon">' +
                  '<div class="dp-shop__coupon-val">' + esc(c.value || c.title) + '</div>' +
                  '<div class="dp-shop__coupon-body">' +
                    '<strong>' + esc(c.title) + '</strong>' +
                    (c.scope ? '<span>' + esc(c.scope) + '</span>' : '') +
                    (c.expire ? '<span>至 ' + esc(c.expire) + '</span>' : '') +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
        '</section>'
      );
    }

    var browsed = shop && shop.browsed || [];
    if (browsed.length) {
      parts.push(
        '<section class="dp-shop__side">' +
          '<h3>最近浏览</h3>' +
          '<ul class="dp-shop__browse-list">' +
            browsed.map(function (b) {
              return (
                '<li>' +
                  '<div>' +
                    '<strong>' + esc(b.title) + '</strong>' +
                    (b.shop ? '<span>' + esc(b.shop) + '</span>' : '') +
                  '</div>' +
                  '<div class="dp-shop__browse-right">' +
                    (b.price ? '<em class="dp-shop__price">' + money(b.price) + '</em>' : '') +
                    (b.when ? '<span>' + esc(b.when) + '</span>' : '') +
                  '</div>' +
                '</li>'
              );
            }).join('') +
          '</ul>' +
        '</section>'
      );
    }

    var addresses = shop && shop.addresses || [];
    if (addresses.length) {
      parts.push(
        '<section class="dp-shop__side">' +
          '<h3>收货地址</h3>' +
          addresses.map(function (a) {
            return (
              '<div class="dp-shop__addr' + (a.isDefault ? ' is-default' : '') + '">' +
                '<div class="dp-shop__addr-top">' +
                  '<strong>' + esc(a.label) + '</strong>' +
                  (a.isDefault ? '<em>默认</em>' : '') +
                  (a.phone ? '<span>' + esc(a.phone) + '</span>' : '') +
                '</div>' +
                (a.detail ? '<p>' + esc(a.detail) + '</p>' : '') +
              '</div>'
            );
          }).join('') +
        '</section>'
      );
    }

    var gifts = shop && shop.gifts || [];
    if (gifts.length) {
      parts.push(
        '<section class="dp-shop__side">' +
          '<h3>相关往来</h3>' +
          '<div class="dp-shop__gift-list">' +
            gifts.map(function (g) {
              return (
                '<div class="dp-shop__gift">' +
                  (g.withWho ? '<span>' + esc(g.withWho) + '</span>' : '') +
                  (g.item ? '<strong>' + esc(g.item) + '</strong>' : '') +
                  (g.memory ? '<p>' + esc(g.memory) + '</p>' : '') +
                '</div>'
              );
            }).join('') +
          '</div>' +
        '</section>'
      );
    }

    if (!parts.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = parts.join('');
  }

  function renderOverview(shop) {
    var el = $('dp-shop-overview');
    if (!el) return;
    if (!shop || (!shop.overview && !shop.footerNote)) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      (shop.overview
        ? '<div class="dp-shop__sec-head"><h2 class="dp-shop__sec-title">本月购物概况</h2></div>' +
          '<p class="dp-shop__overview">' + esc(shop.overview) + '</p>'
        : '') +
      (shop.footerNote ? '<p class="dp-shop__footer-note">' + esc(shop.footerNote) + '</p>' : '');
  }

  function renderEmpty(show) {
    var el = $('dp-shop-empty');
    if (!el) return;
    el.hidden = !show;
  }

  function renderAll() {
    var shop = state.shopData && state.shopData.shop;
    var has = hasAnyContent(shop);
    renderEmpty(!has);
    renderMember(shop);
    renderPackages(shop);
    renderCart(shop);
    renderWishlist(shop);
    renderOrders(shop);
    renderHabits(shop);
    renderSides(shop);
    renderOverview(shop);
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadShopData(contactId) {
    var ss = shopStore();
    if (!ss) return Promise.resolve(null);
    return ss.getShop(contactId).then(function (data) {
      state.shopData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-shop-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ss = shopStore();
    var br = shopBridge();
    if (!ss || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ss.patchShop(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的购物数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.shopData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateShop(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的购物数据';
          ss.patchShop(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.shopData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ss.patchShop(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        shop: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.shopData = saved;
        state.refreshing = false;
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ss.patchShop(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.shopData = saved;
          state.refreshing = false;
          if (state.open) renderAll();
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
    if (state.refreshing || (state.shopData && state.shopData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function bindEvents() {
    var root = $('dp-shop');
    if (!root || root._dpShopBound) return;
    root._dpShopBound = true;

    var back = $('dp-shop-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-shop-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    global.addEventListener('miya-deep-shop-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadShopData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-shop');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.refreshing = !!activeJobs[state.contactId];

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadShopData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          shopStore().patchShop(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.shopData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-shop');
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

  global.miyaDeepShop = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
