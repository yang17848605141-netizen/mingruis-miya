(function (global) {
    'use strict';

    function getFmt() {
        return global.MiyaChatOnlineFormat || null;
    }

    function journalShell(tag, title, subtitle, bodyHtml, sendLabel, sendId) {
        return (
            '<div class="qq-journal">' +
            '<div class="qq-journal__backdrop" data-sheet-close aria-hidden="true"></div>' +
            '<div class="qq-journal__book">' +
            '<div class="qq-journal__veil" aria-hidden="true">' +
            '<div class="qq-journal__grain"></div>' +
            '<div class="qq-journal__line qq-journal__line--a"></div>' +
            '<div class="qq-journal__line qq-journal__line--b"></div>' +
            '<div class="qq-journal__orb qq-journal__orb--a"></div>' +
            '<div class="qq-journal__orb qq-journal__orb--b"></div></div>' +
            '<div class="qq-journal__spine" aria-hidden="true"></div>' +
            '<div class="qq-journal__clip" aria-hidden="true"></div>' +
            '<header class="qq-journal__head">' +
            '<span class="qq-journal__tag">' +
            tag +
            '</span>' +
            '<h2 class="qq-journal__title">' +
            title +
            '</h2>' +
            (subtitle ? '<p class="qq-journal__sub">' + subtitle + '</p>' : '') +
            '</header>' +
            '<div class="qq-journal__body">' +
            bodyHtml +
            '</div>' +
            '<footer class="qq-journal__foot">' +
            '<button type="button" class="qq-journal__send" id="' +
            sendId +
            '">' +
            sendLabel +
            '</button>' +
            '<button type="button" class="qq-journal__cancel" data-sheet-close>收起</button>' +
            '</footer></div></div>'
        );
    }

    function fieldHtml(no, label, en, id, placeholder, opts) {
        opts = opts || {};
        var type = opts.type || 'text';
        var area = opts.area
            ? '<textarea class="qq-journal__input qq-journal__input--area" id="' +
              id +
              '" rows="' +
              (opts.rows || 2) +
              '" maxlength="' +
              (opts.max || 400) +
              '" placeholder="' +
              placeholder +
              '"></textarea>'
            : '<input class="qq-journal__input" id="' +
              id +
              '" type="' +
              type +
              '" maxlength="' +
              (opts.max || 120) +
              '" placeholder="' +
              placeholder +
              '"' +
              (opts.min != null ? ' min="' + opts.min + '"' : '') +
              (opts.step ? ' step="' + opts.step + '"' : '') +
              '>';
        return (
            '<label class="qq-journal__field">' +
            '<span class="qq-journal__label"><em>' +
            no +
            '</em> ' +
            label +
            '<i>' +
            en +
            '</i></span>' +
            area +
            '</label>'
        );
    }

    function buildTakeoutFormHtml() {
        var fields =
            fieldHtml('01', '店铺', 'Shop', 'qq-to-shop', '例如：喜茶 · 滨海万达店', { max: 60 }) +
            fieldHtml('02', '菜品', 'Items', 'qq-to-items', '多肉葡萄×1、烤黑糖波波×1', {
                area: true,
                rows: 2,
                max: 400
            }) +
            fieldHtml('03', '合计', 'Total', 'qq-to-amt', '0.00', { type: 'number', min: 0.01, step: 0.01, max: 12 }) +
            fieldHtml('04', '备注', 'Note', 'qq-to-note', '送达地址、口味要求…', { area: true, rows: 2, max: 200 });
        return journalShell(
            'TAKEOUT · 外卖',
            '手帐点单',
            '填写后将作为外卖卡片发送',
            fields,
            '下单发送',
            'qq-to-send'
        );
    }

    function buildGiftFormHtml() {
        var fields =
            fieldHtml('01', '礼品', 'Gift', 'qq-gift-name', '例如：丝绒玫瑰礼盒', { max: 80 }) +
            fieldHtml('02', '数量', 'Qty', 'qq-gift-qty', '1', { type: 'number', min: 1, max: 99 }) +
            fieldHtml('03', '赠言', 'Message', 'qq-gift-note', '写下心意…', { area: true, rows: 3, max: 200 });
        return journalShell(
            'GIFT · 送礼',
            '心意手札',
            '包装成礼品卡片送出',
            fields,
            '封缄发送',
            'qq-gift-send'
        );
    }

    function bindTakeoutSend(sendMessage, closeOverlay, toast, $) {
        var btn = $('qq-to-send');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var shop = ($('qq-to-shop') && $('qq-to-shop').value || '').trim();
            var items = ($('qq-to-items') && $('qq-to-items').value || '').trim();
            var amt = Number(($('qq-to-amt') && $('qq-to-amt').value) || 0);
            var note = ($('qq-to-note') && $('qq-to-note').value || '').trim();
            if (!shop) return toast('请填写店铺');
            if (!items) return toast('请填写菜品');
            if (!amt || amt <= 0) return toast('请输入有效金额');
            var order = {
                shop: shop,
                items: items,
                amount: Math.round(amt * 100) / 100,
                note: note,
                status: 'ordered'
            };
            var fmt = getFmt();
            var content =
                fmt && typeof fmt.formatTakeoutForApi === 'function'
                    ? fmt.formatTakeoutForApi(order)
                    : '[外卖] ' + shop + ' ¥' + order.amount;
            sendMessage({
                role: 'user',
                type: 'takeout',
                content: content || '[外卖] ' + shop,
                takeoutOrder: order
            })
                .then(function () {
                    closeOverlay();
                    toast('外卖已发送');
                })
                .catch(function () {
                    toast('发送失败');
                });
        });
    }

    function bindGiftSend(sendMessage, closeOverlay, toast, $) {
        var btn = $('qq-gift-send');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var name = ($('qq-gift-name') && $('qq-gift-name').value || '').trim();
            var qty = Math.max(1, Math.min(99, Math.round(Number(($('qq-gift-qty') && $('qq-gift-qty').value) || 1))));
            var note = ($('qq-gift-note') && $('qq-gift-note').value || '').trim();
            if (!name) return toast('请填写礼品名称');
            var parcel = {
                items: [{ name: name, qty: qty, price: 0, shop: '', emoji: '🎁' }],
                total: 0,
                note: note,
                ribbon: 'WITH LOVE',
                status: 'sent'
            };
            var fmt = getFmt();
            var content =
                fmt && typeof fmt.formatGiftForApi === 'function'
                    ? fmt.formatGiftForApi(parcel)
                    : '[礼品] ' + name;
            sendMessage({
                role: 'user',
                type: 'gift',
                content: content || '[礼品] ' + name,
                giftParcel: parcel
            })
                .then(function () {
                    closeOverlay();
                    toast('礼品已发送');
                })
                .catch(function () {
                    toast('发送失败');
                });
        });
    }

    function renderTakeoutCard(m, esc, formatMoney) {
        var fmt = getFmt();
        var od =
            fmt && typeof fmt.resolveTakeoutOrderFromMessage === 'function'
                ? fmt.resolveTakeoutOrderFromMessage(m)
                : m.takeoutOrder;
        if (!od || !od.shop) return '';
        var isMe = m.role === 'user';
        var dir = isMe ? 'out' : 'in';
        var dirLabel = isMe ? '我为你点' : '为你下单';
        var amt = formatMoney(Number(od.amount) || 0);
        var items = String(od.items || '—');
        var note = String(od.note || '').trim() || '（无备注）';
        var issueNo = String((Number(m.createdAt) || Date.now()) % 900 + 100);
        return (
            '<div class="qq-card qq-card-to qq-card-to--' +
            dir +
            '" data-msg-id="' +
            esc(m.id) +
            '">' +
            '<div class="qq-card-to__frame" aria-hidden="true">' +
            '<span class="qq-card-to__frame-corner qq-card-to__frame-corner--tl"></span>' +
            '<span class="qq-card-to__frame-corner qq-card-to__frame-corner--br"></span></div>' +
            '<div class="qq-card-to__grain" aria-hidden="true"></div>' +
            '<div class="qq-card-to__glow" aria-hidden="true"></div>' +
            '<header class="qq-card-to__mast">' +
            '<div class="qq-card-to__mast-col">' +
            '<span class="qq-card-to__vol">Takeout · Ed.</span>' +
            '<span class="qq-card-to__mast-rule" aria-hidden="true"></span>' +
            '<span class="qq-card-to__mast-cn">食事纪</span></div>' +
            '<div class="qq-card-to__mast-meta">' +
            '<span class="qq-card-to__issue">№ ' + esc(issueNo) + '</span>' +
            '<span class="qq-card-to__badge">' + esc(dirLabel) + '</span></div></header>' +
            '<div class="qq-card-to__hero" aria-hidden="true">' +
            '<div class="qq-card-to__hero-plate">' +
            '<span class="qq-card-to__hero-steam"></span>' +
            '<span class="qq-card-to__hero-steam qq-card-to__hero-steam--b"></span>' +
            '<span class="qq-card-to__hero-dot"></span>' +
            '<span class="qq-card-to__hero-dot qq-card-to__hero-dot--b"></span>' +
            '<span class="qq-card-to__hero-dot qq-card-to__hero-dot--c"></span></div>' +
            '<span class="qq-card-to__hero-tag">Fresh · 现做送达</span></div>' +
            '<div class="qq-card-to__shop">' +
            '<span class="qq-card-to__shop-kicker">From the kitchen of</span>' +
            '<h3 class="qq-card-to__shop-name">' + esc(od.shop) + '</h3>' +
            '<span class="qq-card-to__shop-rule" aria-hidden="true"></span></div>' +
            '<section class="qq-card-to__spread">' +
            '<div class="qq-card-to__spread-head">' +
            '<span class="qq-card-to__sec-no">01</span>' +
            '<div class="qq-card-to__spread-titles">' +
            '<span class="qq-card-to__sec-title">今日点单</span>' +
            '<span class="qq-card-to__sec-en">Today\'s Order</span></div></div>' +
            '<div class="qq-card-to__menu-body">' +
            '<p class="qq-card-to__items">' + esc(items) + '</p></div></section>' +
            '<section class="qq-card-to__spread qq-card-to__spread--note">' +
            '<div class="qq-card-to__spread-head">' +
            '<span class="qq-card-to__sec-no">02</span>' +
            '<div class="qq-card-to__spread-titles">' +
            '<span class="qq-card-to__sec-title">送达备注</span>' +
            '<span class="qq-card-to__sec-en">Delivery Note</span></div></div>' +
            '<blockquote class="qq-card-to__note">' + esc(note) + '</blockquote></section>' +
            '<footer class="qq-card-to__foot">' +
            '<div class="qq-card-to__total-block">' +
            '<span class="qq-card-to__total-label">合计 · Total</span>' +
            '<span class="qq-card-to__total"><small>¥</small>' + esc(amt) + '</span></div>' +
            '<div class="qq-card-to__foot-side">' +
            '<div class="qq-card-to__barcode" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '<span></span><span></span><span></span></div>' +
            '<span class="qq-card-to__stamp">MIYA EATS</span></div></footer></div>'
        );
    }

    function renderGiftCard(m, esc) {
        var fmt = getFmt();
        var gp =
            fmt && typeof fmt.resolveGiftParcelFromMessage === 'function'
                ? fmt.resolveGiftParcelFromMessage(m)
                : m.giftParcel;
        if (!gp || !gp.items || !gp.items.length) return '';
        var isMe = m.role === 'user';
        var dir = isMe ? 'out' : 'in';
        var dirLabel = isMe ? '我的心意' : '赠予你';
        var item = gp.items[0];
        var name =
            gp.items.length === 1
                ? String(item.name || '礼品')
                : '臻选礼盒 · ' + gp.items.length + ' 件';
        var qty = gp.items.length === 1 ? Math.max(1, Number(item.qty) || 1) : gp.items.length;
        var note = String(gp.note || '').trim() || '（无赠言）';
        var ribbon = String(gp.ribbon || 'FOR YOU').trim();
        return (
            '<div class="qq-card qq-card-gift qq-card-gift--' +
            dir +
            '" data-msg-id="' +
            esc(m.id) +
            '">' +
            '<div class="qq-card-gift__wm" aria-hidden="true">礼</div>' +
            '<div class="qq-card-gift__grain" aria-hidden="true"></div>' +
            '<div class="qq-card-gift__sheen" aria-hidden="true"></div>' +
            '<div class="qq-card-gift__side-ribbon" aria-hidden="true">' +
            esc(ribbon) +
            '</div>' +
            '<div class="qq-card-gift__bow" aria-hidden="true">' +
            '<span class="qq-card-gift__bow-loop qq-card-gift__bow-loop--l"></span>' +
            '<span class="qq-card-gift__bow-loop qq-card-gift__bow-loop--r"></span>' +
            '<span class="qq-card-gift__bow-knot"></span>' +
            '<span class="qq-card-gift__bow-tail qq-card-gift__bow-tail--l"></span>' +
            '<span class="qq-card-gift__bow-tail qq-card-gift__bow-tail--r"></span></div>' +
            '<header class="qq-card-gift__head">' +
            '<div class="qq-card-gift__brand">' +
            '<span class="qq-card-gift__title-cn">心意礼笺</span>' +
            '<span class="qq-card-gift__title-en">Gift · 礼品</span></div>' +
            '<span class="qq-card-gift__badge">' +
            esc(dirLabel) +
            '</span></header>' +
            '<div class="qq-card-gift__stage">' +
            '<div class="qq-card-gift__lid" aria-hidden="true"></div>' +
            '<div class="qq-card-gift__box">' +
            '<div class="qq-card-gift__box-inner">' +
            '<span class="qq-card-gift__emoji" aria-hidden="true">' +
            esc(item.emoji || '🎁') +
            '</span>' +
            '<div class="qq-card-gift__meta">' +
            '<h3 class="qq-card-gift__name">' +
            esc(name) +
            '</h3>' +
            '<span class="qq-card-gift__qty">数量 · ×' +
            esc(qty) +
            '</span></div>' +
            '<div class="qq-card-gift__wax"><span>心</span></div></div></div></div>' +
            '<div class="qq-card-gift__letter">' +
            '<div class="qq-card-gift__letter-head">' +
            '<span class="qq-card-gift__letter-no">03</span>' +
            '<span class="qq-card-gift__letter-label">赠言 MESSAGE</span></div>' +
            '<blockquote class="qq-card-gift__note">' +
            '<span class="qq-card-gift__quote-mark">“</span>' +
            esc(note) +
            '<span class="qq-card-gift__quote-mark qq-card-gift__quote-mark--end">”</span></blockquote></div>' +
            '<footer class="qq-card-gift__foot">' +
            '<div class="qq-card-gift__seal" aria-hidden="true">' +
            '<span class="qq-card-gift__seal-ring"></span>' +
            '<span class="qq-card-gift__seal-text">GIFT</span></div>' +
            '<span class="qq-card-gift__foot-tag">Handpicked with care</span></footer></div>'
        );
    }

    global.MiyaChatOrderUi = {
        buildTakeoutFormHtml: buildTakeoutFormHtml,
        buildGiftFormHtml: buildGiftFormHtml,
        bindTakeoutSend: bindTakeoutSend,
        bindGiftSend: bindGiftSend,
        renderTakeoutCard: renderTakeoutCard,
        renderGiftCard: renderGiftCard,
        openTakeoutForm: function (ctx) {
            if (!ctx || typeof ctx.openOverlay !== 'function') return;
            ctx.openOverlay(buildTakeoutFormHtml());
            bindTakeoutSend(ctx.sendMessage, ctx.closeOverlay, ctx.toast, ctx.$);
        },
        openGiftForm: function (ctx) {
            if (!ctx || typeof ctx.openOverlay !== 'function') return;
            ctx.openOverlay(buildGiftFormHtml());
            bindGiftSend(ctx.sendMessage, ctx.closeOverlay, ctx.toast, ctx.$);
        }
    };
})(window);
