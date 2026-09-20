/**
 * Miya 聊天 · 钱包与转账记账（用户面具 / 角色联系人）
 */
(function (global) {
    'use strict';

    function store() {
        return global.miyaChatStore || null;
    }

    function roundMoney(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function formatMoney(n) {
        var v = roundMoney(n);
        var s = v.toFixed(2);
        if (s.slice(-3) === '.00') return s.slice(0, -3);
        if (s.charAt(s.length - 1) === '0') return s.slice(0, -1);
        return s;
    }

    function formatDisplay(n) {
        return '¥' + formatMoney(n);
    }

    function errCode(err) {
        if (!err) return '';
        if (typeof err === 'string') return err;
        return String(err.message || err.code || '');
    }

    function notifyWalletChanged() {
        if (global.miyaChatApp && typeof global.miyaChatApp.refreshProfileUI === 'function') {
            global.miyaChatApp.refreshProfileUI();
        }
    }

    function shouldSettle(rp) {
        if (!rp || typeof rp !== 'object') return false;
        if (rp.walletSettled) return false;
        return rp.walletHeld === true;
    }

    /** 用户向角色转账 — 从面具钱包扣款（托管） */
    function holdUserOutgoingTransfer(profileId, amount) {
        var st = store();
        if (!st || typeof st.adjustWalletBalance !== 'function') {
            return Promise.reject(new Error('no_store'));
        }
        var pid = String(profileId || '').trim();
        var amt = roundMoney(amount);
        if (!pid) return Promise.reject(new Error('profile_missing'));
        if (!(amt > 0)) return Promise.reject(new Error('invalid_amount'));
        return st.adjustWalletBalance(pid, -amt).then(function (bal) {
            notifyWalletChanged();
            return bal;
        });
    }

    /** 角色处理用户转账回执：已收 → 角色钱包入账；已退 → 退回用户面具 */
    function settleUserOutgoingTransfer(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var st = store();
        if (!st || !shouldSettle(opts.redPacket)) return Promise.resolve(false);
        var amt = roundMoney(opts.amount);
        if (!(amt > 0)) return Promise.resolve(false);
        var contactId = String(opts.contactId || '').trim();
        var profileId = String(opts.profileId || '').trim();
        var action = opts.action === 'refund' ? 'refund' : 'accept';
        var chain;
        if (action === 'accept') {
            if (!contactId || typeof st.adjustContactWalletBalance !== 'function') {
                return Promise.resolve(false);
            }
            chain = st.adjustContactWalletBalance(contactId, amt);
        } else {
            if (!profileId) return Promise.resolve(false);
            chain = st.adjustWalletBalance(profileId, amt);
        }
        return chain
            .then(function () {
                notifyWalletChanged();
                return true;
            })
            .catch(function () {
                return false;
            });
    }

    /** 角色向用户转账 — 从角色钱包扣款（托管） */
    function holdRoleOutgoingTransfer(contactId, amount) {
        var st = store();
        if (!st || typeof st.adjustContactWalletBalance !== 'function') {
            return Promise.reject(new Error('no_store'));
        }
        var cid = String(contactId || '').trim();
        var amt = roundMoney(amount);
        if (!cid) return Promise.reject(new Error('contact_missing'));
        if (!(amt > 0)) return Promise.reject(new Error('invalid_amount'));
        return st.adjustContactWalletBalance(cid, -amt).then(function (bal) {
            notifyWalletChanged();
            return bal;
        });
    }

    /** 用户处理角色转账：已收 → 入账当前面具；已退 → 退回角色钱包 */
    function settleRoleOutgoingTransfer(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var st = store();
        if (!st || !shouldSettle(opts.redPacket)) return Promise.resolve(false);
        var amt = roundMoney(opts.amount);
        if (!(amt > 0)) return Promise.resolve(false);
        var contactId = String(opts.contactId || '').trim();
        var profileId = String(opts.profileId || '').trim();
        var action = opts.action === 'refund' ? 'refund' : 'accept';
        var chain;
        if (action === 'accept') {
            if (!profileId) return Promise.resolve(false);
            chain = st.adjustWalletBalance(profileId, amt);
        } else {
            if (!contactId || typeof st.adjustContactWalletBalance !== 'function') {
                return Promise.resolve(false);
            }
            chain = st.adjustContactWalletBalance(contactId, amt);
        }
        return chain
            .then(function () {
                notifyWalletChanged();
                return true;
            })
            .catch(function () {
                return false;
            });
    }

    function walletErrorMessage(code) {
        if (code === 'insufficient_balance') return '余额不足';
        if (code === 'profile_missing') return '请先选择面具';
        if (code === 'contact_missing') return '联系人无效';
        if (code === 'invalid_amount') return '金额无效';
        return '钱包操作失败';
    }

    global.MiyaChatWallet = {
        formatMoney: formatMoney,
        formatDisplay: formatDisplay,
        holdUserOutgoingTransfer: holdUserOutgoingTransfer,
        settleUserOutgoingTransfer: settleUserOutgoingTransfer,
        holdRoleOutgoingTransfer: holdRoleOutgoingTransfer,
        settleRoleOutgoingTransfer: settleRoleOutgoingTransfer,
        walletErrorMessage: walletErrorMessage,
        errCode: errCode
    };
})(window);
