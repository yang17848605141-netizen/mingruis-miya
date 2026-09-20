/**
 * miya-deep-food.js — 深入 · 角色手机 外卖界面
 * 布局：故事环收藏店 + 圆形今日餐盘 + 配送进度带 + 票根订单流（与其他深入 App 完全不同）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var TONE_MAP = {
    sage: 'tone-sage',
    sky: 'tone-sky',
    sand: 'tone-sand',
    blush: 'tone-blush',
    ink: 'tone-ink'
  };

  var TONE_FALLBACK = ['tone-sage', 'tone-sky', 'tone-sand', 'tone-blush', 'tone-ink'];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    foodData: null,
    refreshing: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function foodStore() { return global.miyaDeepFoodStore || null; }
  function foodBridge() { return global.miyaDeepFoodBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-food-toast');
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
    var text = $('dp-food-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的外卖数据');
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
    var bar = $('dp-food-status');
    var text = $('dp-food-status-text');
    if (!bar || !text) return;
    var data = state.foodData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的外卖数据';
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
      bar.className = 'dp-food__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-food__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-food-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.foodData && state.foodData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function initialOf(name) {
    var s = String(name || '').trim();
    if (!s) return '店';
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

  function stars(n) {
    var v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    if (!v) return '';
    return '<span class="dp-food__stars" aria-label="' + v + '星">' + '★'.repeat(v) + '<span class="dp-food__stars-empty">' + '★'.repeat(5 - v) + '</span></span>';
  }

  function statusClass(status) {
    var s = String(status || '');
    if (/送达|完成|已评/.test(s)) return 'is-done';
    if (/配送|骑手|制作|出餐/.test(s)) return 'is-ing';
    if (/待|支付|取餐/.test(s)) return 'is-wait';
    return '';
  }

  function fakeScore(seed) {
    var n = 0;
    var str = String(seed || 'x');
    var i;
    for (i = 0; i < str.length; i++) n += str.charCodeAt(i);
    return (4.2 + (n % 8) / 10).toFixed(1);
  }

  function splitChips(text, tone) {
    var parts = String(text || '').split(/[、,，;/｜|·]/).map(function (p) {
      return String(p || '').trim();
    }).filter(Boolean);
    if (!parts.length && text) parts = [String(text).trim()];
    return parts.map(function (p) {
      return '<span class="dp-food__chip' + (tone ? ' ' + tone : '') + '">' + esc(p) + '</span>';
    }).join('');
  }

  function couponValueHtml(value) {
    var v = String(value || '').trim();
    var m = v.match(/(\d+(?:\.\d+)?)/);
    if (m && /减|折|¥|￥/.test(v)) {
      return '<b>' + esc(m[1]) + '</b><small>' + (v.indexOf('折') >= 0 ? '折' : '元') + '</small>';
    }
    return '<b style="font-size:14px">' + esc(v || '券') + '</b>';
  }

  function progressSteps(pct) {
    var steps = ['已下单', '商家接单', '配送中', '待送达'];
    var idx = pct >= 95 ? 3 : (pct >= 55 ? 2 : (pct >= 25 ? 1 : 0));
    return (
      '<div class="dp-food__steps" aria-hidden="true">' +
        steps.map(function (label, i) {
          var cls = i < idx ? 'is-done' : (i === idx ? 'is-on' : '');
          return '<div class="dp-food__step ' + cls + '"><i></i>' + label + '</div>';
        }).join('') +
      '</div>'
    );
  }

  function hasAnyContent(food) {
    if (!food) return false;
    return !!(
      (food.orders && food.orders.length) ||
      (food.favorites && food.favorites.length) ||
      (food.activeOrders && food.activeOrders.length) ||
      (food.weekMeals && food.weekMeals.length) ||
      (food.coupons && food.coupons.length) ||
      (food.addresses && food.addresses.length) ||
      (food.cravings && food.cravings.length) ||
      (food.shared && food.shared.length) ||
      (food.todayPlate && (food.todayPlate.shop || food.todayPlate.heroDish)) ||
      (food.taste && (food.taste.prefer || food.taste.habits || food.taste.avoid)) ||
      food.overview ||
      food.footerNote
    );
  }

  function renderFavorites(food) {
    var el = $('dp-food-favorites');
    if (!el) return;
    var list = food && food.favorites || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-food__sec-head">' +
        '<h2 class="dp-food__sec-title">常点商家</h2>' +
        '<span class="dp-food__sec-more">共' + list.length + '家</span>' +
      '</div>' +
      '<div class="dp-food__fav-track">' +
        list.map(function (f, i) {
          var tone = TONE_MAP[f.tone] || TONE_FALLBACK[i % TONE_FALLBACK.length];
          return (
            '<div class="dp-food__fav ' + tone + '" style="--fav-i:' + i + '">' +
              '<div class="dp-food__fav-cover">' +
                '<span class="dp-food__fav-glyph">' + esc(initialOf(f.shop)) + '</span>' +
                (f.times ? '<span class="dp-food__fav-times">点过' + f.times + '次</span>' : '') +
              '</div>' +
              '<div class="dp-food__fav-body">' +
                '<span class="dp-food__fav-name">' + esc(f.shop) + '</span>' +
                (f.dish ? '<span class="dp-food__fav-dish">常点 · ' + esc(f.dish) + '</span>' : '') +
                (f.note ? '<span class="dp-food__fav-note">' + esc(f.note) + '</span>' : '') +
                (f.lastOrder ? '<span class="dp-food__fav-dish">' + esc(f.lastOrder) + '</span>' : '') +
              '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>';
  }

  function renderPlate(food) {
    var el = $('dp-food-plate');
    if (!el) return;
    var plate = food && food.todayPlate;
    var loc = food && food.location;
    if (!plate || (!plate.shop && !plate.heroDish)) {
      el.innerHTML = hasAnyContent(food)
        ? '<div class="dp-food__plate-empty"><p class="dp-food__plate-hint">暂无今日主推订单</p></div>'
        : '';
      return;
    }
    var sc = statusClass(plate.status);
    var score = fakeScore(plate.shop);
    el.innerHTML =
      '<div class="dp-food__hero">' +
        '<div class="dp-food__loc-bar">' +
          '<span class="dp-food__loc-pin" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>' +
          '</span>' +
          '<div class="dp-food__loc-main">' +
            '<div class="dp-food__loc-label">' +
              esc((loc && loc.label) || '收货地址') +
              ((loc && loc.label) ? '<em>送这里</em>' : '') +
            '</div>' +
            (loc && loc.address
              ? '<div class="dp-food__loc-addr">' + esc(loc.address) + (loc.note ? ' · ' + esc(loc.note) : '') + '</div>'
              : '<div class="dp-food__loc-addr">点击刷新后同步地址</div>') +
          '</div>' +
          (food.dateLabel ? '<div class="dp-food__loc-date">' + esc(food.dateLabel) + '</div>' : '') +
        '</div>' +
        '<div class="dp-food__shop-card">' +
          '<div class="dp-food__shop-thumb">' +
            (plate.meal ? '<span class="dp-food__meal-tag">' + esc(plate.meal) + '</span>' : '') +
            '<span>' + esc(initialOf(plate.shop || plate.heroDish)) + '</span>' +
          '</div>' +
          '<div class="dp-food__shop-body">' +
            '<h3 class="dp-food__shop-name">' + esc(plate.shop || '今日商家') + '</h3>' +
            '<div class="dp-food__shop-sub">' +
              '<span class="dp-food__score">' + score + '分</span>' +
              (plate.eta ? '<span>' + esc(plate.eta) + '送达</span>' : '') +
              '<span>美团专送</span>' +
            '</div>' +
            (plate.heroDish ? '<div class="dp-food__shop-dish">主推 · ' + esc(plate.heroDish) + '</div>' : '') +
            '<div class="dp-food__shop-foot">' +
              (plate.amount ? '<span class="dp-food__price">' + money(plate.amount) + '</span>' : '<span></span>') +
              (plate.status
                ? '<span class="dp-food__status-pill ' + sc + '">' + esc(plate.status) + '</span>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        (plate.note
          ? '<p class="dp-food__hero-note"><strong>备注</strong> · ' + esc(plate.note) + '</p>'
          : '') +
      '</div>';
  }

  function renderActive(food) {
    var el = $('dp-food-active');
    if (!el) return;
    var list = food && food.activeOrders || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-food__sec-head">' +
        '<h2 class="dp-food__sec-title">进行中的订单</h2>' +
        '<span class="dp-food__sec-more">实时配送</span>' +
      '</div>' +
      list.map(function (ao, i) {
        var pct = Math.max(0, Math.min(100, Number(ao.progress) || 0));
        return (
          '<div class="dp-food__active" style="--ao-i:' + i + '">' +
            '<div class="dp-food__active-banner">' +
              '<span class="dp-food__active-status">' + esc(ao.status || '配送中') + '</span>' +
              (ao.eta ? '<span class="dp-food__active-eta">预计 ' + esc(ao.eta) + '</span>' : '') +
            '</div>' +
            '<div class="dp-food__active-body">' +
              '<div class="dp-food__active-shop">' + esc(ao.shop) + '</div>' +
              (ao.items ? '<p class="dp-food__active-items">' + esc(ao.items) + '</p>' : '') +
              progressSteps(pct) +
              '<div class="dp-food__progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
                '<span class="dp-food__progress-fill" style="width:' + pct + '%"></span>' +
              '</div>' +
              '<div class="dp-food__active-foot">' +
                (ao.rider ? '<span>骑手 · ' + esc(ao.rider) + '</span>' : '<span>美团跑腿</span>') +
                (ao.amount ? '<span class="dp-food__price">' + money(ao.amount) + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');
  }

  function renderOrderTicket(order, index) {
    var itemsHtml = (order.items || []).map(function (it) {
      return (
        '<li class="dp-food__ticket-item">' +
          '<span class="dp-food__ticket-item-name">' + esc(it.name) +
            (it.spec ? '<small>' + esc(it.spec) + '</small>' : '') +
          '</span>' +
          '<span class="dp-food__ticket-item-qty">×' + (it.qty || 1) + '</span>' +
          (it.price ? '<span class="dp-food__ticket-item-price">' + esc(moneyText(it.price)) + '</span>' : '') +
        '</li>'
      );
    }).join('');

    var sc = statusClass(order.status);
    var tags = [];
    if (order.category) tags.push('<span class="dp-food__tag is-yellow">' + esc(order.category) + '</span>');
    if (order.meal) tags.push('<span class="dp-food__tag is-green">' + esc(order.meal) + '</span>');
    if (order.payMethod) tags.push('<span class="dp-food__tag">' + esc(order.payMethod) + '</span>');

    return (
      '<article class="dp-food__ticket" style="--tk-i:' + index + '">' +
        '<header class="dp-food__ticket-head">' +
          '<div class="dp-food__ticket-shop-row">' +
            '<span class="dp-food__ticket-avatar">' + esc(initialOf(order.shop)) + '</span>' +
            '<div style="min-width:0">' +
              '<h3 class="dp-food__ticket-shop">' + esc(order.shop) + '</h3>' +
              '<div class="dp-food__ticket-meta">' +
                (order.time ? '<span>' + esc(order.time) + '</span>' : '') +
                (order.meal ? '<span>' + esc(order.meal) + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          (order.status
            ? '<span class="dp-food__ticket-status ' + sc + '">' + esc(order.status) + '</span>'
            : '') +
        '</header>' +
        '<div class="dp-food__ticket-body">' +
          (order.heroDish ? '<p class="dp-food__ticket-hero">主菜 · ' + esc(order.heroDish) + '</p>' : '') +
          (itemsHtml ? '<ul class="dp-food__ticket-list">' + itemsHtml + '</ul>' : '') +
          '<div class="dp-food__ticket-fees">' +
            (order.packFee ? '<span>包装费 ' + esc(moneyText(order.packFee)) + '</span>' : '') +
            (order.deliveryFee ? '<span>配送费 ' + esc(moneyText(order.deliveryFee)) + '</span>' : '') +
          '</div>' +
          '<div class="dp-food__ticket-total">' +
            '<span>实付</span>' +
            (order.amount ? '<strong>' + money(order.amount) + '</strong>' : '') +
          '</div>' +
          ((order.rating || order.review)
            ? '<div class="dp-food__ticket-review">' + stars(order.rating) +
                (order.review ? '<p>' + esc(order.review) + '</p>' : '') +
              '</div>'
            : '') +
        '</div>' +
        (tags.length ? '<div class="dp-food__ticket-tags">' + tags.join('') + '</div>' : '') +
        '<div class="dp-food__ticket-foot">' +
          (order.address ? '<p class="dp-food__ticket-addr">📍 ' + esc(order.address) + '</p>' : '') +
          (order.note ? '<p class="dp-food__ticket-note">备注 · ' + esc(order.note) + '</p>' : '') +
          (order.reason ? '<p class="dp-food__ticket-reason">' + esc(order.reason) + '</p>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function renderOrders(food) {
    var el = $('dp-food-orders');
    if (!el) return;
    var list = food && food.orders || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-food__sec-head">' +
        '<h2 class="dp-food__sec-title">我的订单</h2>' +
        '<span class="dp-food__sec-more">' + list.length + '单</span>' +
      '</div>' +
      '<div class="dp-food__ticket-stack">' + list.map(renderOrderTicket).join('') + '</div>';
  }

  function renderTaste(food) {
    var el = $('dp-food-taste');
    if (!el) return;
    var t = food && food.taste;
    if (!t || !(t.spice || t.avoid || t.prefer || t.budget || t.habits)) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var rows = [];
    if (t.spice) {
      rows.push(
        '<div class="dp-food__taste-row">' +
          '<span class="dp-food__taste-key">辣度</span>' +
          '<div class="dp-food__taste-chips">' + splitChips(t.spice) + '</div>' +
        '</div>'
      );
    }
    if (t.avoid) {
      rows.push(
        '<div class="dp-food__taste-row">' +
          '<span class="dp-food__taste-key">忌口</span>' +
          '<div class="dp-food__taste-chips">' + splitChips(t.avoid, 'is-red') + '</div>' +
        '</div>'
      );
    }
    if (t.prefer) {
      rows.push(
        '<div class="dp-food__taste-row">' +
          '<span class="dp-food__taste-key">偏好</span>' +
          '<div class="dp-food__taste-chips">' + splitChips(t.prefer, 'is-green') + '</div>' +
        '</div>'
      );
    }
    if (t.budget) {
      rows.push(
        '<div class="dp-food__taste-row">' +
          '<span class="dp-food__taste-key">预算</span>' +
          '<span class="dp-food__taste-val">' + esc(t.budget) + '</span>' +
        '</div>'
      );
    }
    if (t.habits) {
      rows.push(
        '<div class="dp-food__taste-row">' +
          '<span class="dp-food__taste-key">习惯</span>' +
          '<span class="dp-food__taste-val">' + esc(t.habits) + '</span>' +
        '</div>'
      );
    }
    el.innerHTML =
      '<div class="dp-food__sec-head">' +
        '<h2 class="dp-food__sec-title">口味偏好</h2>' +
        '<span class="dp-food__sec-more">点餐画像</span>' +
      '</div>' +
      '<div class="dp-food__taste-sheet">' + rows.join('') + '</div>';
  }

  function renderWeek(food) {
    var el = $('dp-food-week');
    if (!el) return;
    var list = food && food.weekMeals || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="dp-food__sec-head">' +
        '<h2 class="dp-food__sec-title">本周吃什么</h2>' +
        '<span class="dp-food__sec-more">七日餐次</span>' +
      '</div>' +
      '<div class="dp-food__week-rail">' +
        list.map(function (d, i) {
          return (
            '<div class="dp-food__week-day" style="--wd-i:' + i + '">' +
              '<span class="dp-food__week-label">' + esc(d.day) + '</span>' +
              '<div class="dp-food__week-meals">' +
                (d.breakfast ? '<span><i>早</i>' + esc(d.breakfast) + '</span>' : '') +
                (d.lunch ? '<span><i>午</i>' + esc(d.lunch) + '</span>' : '') +
                (d.dinner ? '<span><i>晚</i>' + esc(d.dinner) + '</span>' : '') +
              '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>';
  }

  function renderSideBlocks(food) {
    var el = $('dp-food-sides');
    if (!el) return;
    var parts = [];

    var coupons = food && food.coupons || [];
    if (coupons.length) {
      parts.push(
        '<section class="dp-food__side-block">' +
          '<h3 class="dp-food__side-title">红包卡券</h3>' +
          coupons.map(function (c) {
            return (
              '<div class="dp-food__coupon">' +
                '<div class="dp-food__coupon-val">' + couponValueHtml(c.value || c.title) + '</div>' +
                '<div class="dp-food__coupon-body">' +
                  '<strong>' + esc(c.title) + '</strong>' +
                  (c.shop ? '<span>适用于 ' + esc(c.shop) + '</span>' : '') +
                  (c.expire ? '<span class="dp-food__coupon-exp">有效期至 ' + esc(c.expire) + '</span>' : '') +
                '</div>' +
              '</div>'
            );
          }).join('') +
        '</section>'
      );
    }

    var addresses = food && food.addresses || [];
    if (addresses.length) {
      parts.push(
        '<section class="dp-food__side-block">' +
          '<h3 class="dp-food__side-title">收货地址</h3>' +
          addresses.map(function (a) {
            return (
              '<div class="dp-food__addr' + (a.isDefault ? ' is-default' : '') + '">' +
                '<div class="dp-food__addr-top">' +
                  '<strong>' + esc(a.label) + '</strong>' +
                  (a.isDefault ? '<span class="dp-food__addr-tag">默认</span>' : '') +
                  (a.phone ? '<span class="dp-food__addr-phone">' + esc(a.phone) + '</span>' : '') +
                '</div>' +
                (a.detail ? '<p>' + esc(a.detail) + '</p>' : '') +
              '</div>'
            );
          }).join('') +
        '</section>'
      );
    }

    var cravings = food && food.cravings || [];
    if (cravings.length) {
      parts.push(
        '<section class="dp-food__side-block">' +
          '<h3 class="dp-food__side-title">想吃清单</h3>' +
          '<ul class="dp-food__crave-list">' +
            cravings.map(function (c) {
              return (
                '<li>' +
                  '<span class="dp-food__crave-text">' + esc(c.text) + '</span>' +
                  (c.trigger ? '<span class="dp-food__crave-when">' + esc(c.trigger) + '</span>' : '') +
                '</li>'
              );
            }).join('') +
          '</ul>' +
        '</section>'
      );
    }

    var shared = food && food.shared || [];
    if (shared.length) {
      parts.push(
        '<section class="dp-food__side-block">' +
          '<h3 class="dp-food__side-title">一起点过</h3>' +
          '<div class="dp-food__shared-list">' +
            shared.map(function (s) {
              return (
                '<div class="dp-food__shared">' +
                  (s.withWho ? '<span class="dp-food__shared-who">' + esc(s.withWho) + '</span>' : '') +
                  (s.dish ? '<strong>' + esc(s.dish) + '</strong>' : '') +
                  (s.memory ? '<p>' + esc(s.memory) + '</p>' : '') +
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

  function renderOverview(food) {
    var el = $('dp-food-overview');
    if (!el) return;
    if (!food || (!food.overview && !food.footerNote)) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      (food.overview
        ? '<div class="dp-food__sec-head"><h2 class="dp-food__sec-title">本周点餐概况</h2></div>' +
          '<p class="dp-food__overview">' + esc(food.overview) + '</p>'
        : '') +
      (food.footerNote ? '<p class="dp-food__footer-note">' + esc(food.footerNote) + '</p>' : '');
  }

  function renderEmpty(show) {
    var el = $('dp-food-empty');
    if (!el) return;
    el.hidden = !show;
  }

  function renderAll() {
    var food = state.foodData && state.foodData.food;
    var has = hasAnyContent(food);
    renderEmpty(!has);
    renderFavorites(food);
    renderPlate(food);
    renderActive(food);
    renderOrders(food);
    renderTaste(food);
    renderWeek(food);
    renderSideBlocks(food);
    renderOverview(food);
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadFoodData(contactId) {
    var fs = foodStore();
    if (!fs) return Promise.resolve(null);
    return fs.getFood(contactId).then(function (data) {
      state.foodData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-food-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var fs = foodStore();
    var br = foodBridge();
    if (!fs || !br) return Promise.reject(new Error('模块未就绪'));

    var job = fs.patchFood(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的外卖数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.foodData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateFood(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的外卖数据';
          fs.patchFood(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.foodData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return fs.patchFood(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        food: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.foodData = saved;
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
      return fs.patchFood(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.foodData = saved;
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
    if (state.refreshing || (state.foodData && state.foodData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function bindEvents() {
    var root = $('dp-food');
    if (!root || root._dpFoodBound) return;
    root._dpFoodBound = true;

    var back = $('dp-food-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-food-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    global.addEventListener('miya-deep-food-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadFoodData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-food');
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

    loadFoodData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          foodStore().patchFood(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.foodData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-food');
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

  global.miyaDeepFood = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
