/**
 * Miya 群聊 · 群红包（拼手气 / 专属）
 */
(function (global) {
    'use strict';

    var USER_OWNER_ID = '__user__';
    /** 角色发的拼手气红包：先留给用户抢的秒数，过后 NPC 才开始自动领取 */
    var MEMBER_LUCKY_USER_GRACE_MS = 5000;
    var RE_PARSE = /^红包[-－—](拼手气|专属)[-－—]([^-－—]+)[-－—]([^-－—]+)[-－—](.+)$/;

    function trim(s) {
        return String(s || '').trim();
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

    function shuffle(arr) {
        var a = (arr || []).slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i];
            a[i] = a[j];
            a[j] = t;
        }
        return a;
    }

    function splitLuckyAmounts(total, count) {
        var t = roundMoney(total);
        var c = Math.max(1, Math.floor(Number(count) || 1));
        var min = 0.01;
        if (!(t >= min * c)) return null;
        var amounts = [];
        var remain = t;
        var remainCount = c;
        var i;
        for (i = 0; i < c - 1; i++) {
            var max = roundMoney(remain - min * (remainCount - 1));
            var amt = roundMoney(min + Math.random() * Math.max(0, max - min));
            if (amt < min) amt = min;
            amounts.push(amt);
            remain = roundMoney(remain - amt);
            remainCount--;
        }
        amounts.push(roundMoney(remain));
        return shuffle(amounts);
    }

    function splitEqualAmounts(total, count) {
        var t = roundMoney(total);
        var c = Math.max(1, Math.floor(Number(count) || 1));
        if (!(t >= 0.01 * c)) return null;
        var base = roundMoney(t / c);
        var amounts = [];
        var used = 0;
        var i;
        for (i = 0; i < c - 1; i++) {
            amounts.push(base);
            used = roundMoney(used + base);
        }
        amounts.push(roundMoney(t - used));
        return amounts;
    }

    function cleanNote(note) {
        var n = trim(note);
        if (!n) return '恭喜发财';
        var cut = n.split(/[-－—](?:发起人|进度|已领|待领|状态|手气王|最少|专属：)/)[0];
        n = trim(cut || n);
        var quoted = n.match(/^「([^」]*)」$/);
        if (quoted) n = trim(quoted[1]);
        n = n.replace(/^「+|」+$/g, '').trim();
        return n || '恭喜发财';
    }

    function extractNoteFromTail(tail) {
        tail = trim(tail);
        if (!tail) return '恭喜发财';
        var quoted = tail.match(/^「([^」]*)」/);
        if (quoted) return cleanNote(quoted[1]);
        var clean = tail.split(/[-－—](?:发起人|进度|已领|待领|状态|手气王|最少|专属：)/)[0];
        return cleanNote(clean);
    }

    function normalizeGroupRedPacket(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var mode = trim(raw.mode) === 'exclusive' ? 'exclusive' : 'lucky';
        var claims = Array.isArray(raw.claims)
            ? raw.claims
                  .map(function (c) {
                      if (!c || typeof c !== 'object') return null;
                      return {
                          whoId: trim(c.whoId),
                          whoName: trim(c.whoName),
                          amount: roundMoney(c.amount),
                          at: Number(c.at) || 0
                      };
                  })
                  .filter(function (c) {
                      return c && c.whoId;
                  })
            : [];
        var targetIds = Array.isArray(raw.targetIds)
            ? raw.targetIds.map(function (x) {
                  return trim(x);
              }).filter(Boolean)
            : [];
        var splits = Array.isArray(raw.splits)
            ? raw.splits.map(function (x) {
                  return roundMoney(x);
              })
            : [];
        var st = trim(raw.status);
        if (st !== 'done' && st !== 'expired') st = 'active';
        return {
            id: trim(raw.id) || 'grp_' + Date.now(),
            mode: mode,
            totalAmount: roundMoney(raw.totalAmount),
            count: Math.max(1, Math.floor(Number(raw.count) || 1)),
            note: cleanNote(raw.note) || '恭喜发财',
            targetIds: targetIds,
            status: st,
            senderRole: trim(raw.senderRole) === 'member' ? 'member' : 'user',
            senderContactId: trim(raw.senderContactId) || '',
            senderName: trim(raw.senderName),
            claims: claims,
            splits: splits,
            walletHeld: !!raw.walletHeld,
            walletSettled: !!raw.walletSettled,
            doneAt: Number(raw.doneAt) || 0
        };
    }

    function defaultEligibleCount(members) {
        return Math.max(1, (members || []).length + 1);
    }

    function resolveTargetId(label, members, store, groupChatId, profile) {
        var gg = global.MiyaChatGroup;
        var key = trim(label);
        if (!key) return '';
        if (key === '用户' || key === '我' || (profile && trim(profile.name) === key)) return USER_OWNER_ID;
        if (gg && typeof gg.resolveMemberByLabel === 'function') {
            var hit = gg.resolveMemberByLabel(key, members, store, groupChatId);
            if (hit) return hit.id;
        }
        return '';
    }

    function resolveWhoName(whoId, members, store, groupChatId, profile) {
        if (whoId === USER_OWNER_ID) return trim(profile && profile.name) || '用户';
        var hit = (members || []).find(function (c) {
            return c.id === whoId;
        });
        if (hit && global.MiyaChatGroup && typeof global.MiyaChatGroup.memberDisplayName === 'function') {
            return global.MiyaChatGroup.memberDisplayName(store, hit, groupChatId);
        }
        return hit ? trim(hit.name) || '成员' : '成员';
    }

    function getEligibleWhoIds(grp, members) {
        if (!grp) return [];
        if (grp.mode === 'exclusive') {
            return (grp.targetIds || []).slice();
        }
        var ids = [USER_OWNER_ID];
        (members || []).forEach(function (c) {
            if (c && c.id) ids.push(c.id);
        });
        return ids;
    }

    function claimedWhoIds(grp) {
        var set = {};
        (grp && grp.claims ? grp.claims : []).forEach(function (c) {
            if (c && c.whoId) set[c.whoId] = true;
        });
        return set;
    }

    function remainingSlots(grp) {
        if (!grp) return 0;
        return Math.max(0, grp.count - (grp.claims ? grp.claims.length : 0));
    }

    function unclaimedEligibleIds(grp, members) {
        var claimed = claimedWhoIds(grp);
        return getEligibleWhoIds(grp, members).filter(function (id) {
            return !claimed[id];
        });
    }

    function isPacketComplete(grp, members) {
        if (!grp) return false;
        if ((grp.claims || []).length >= grp.count) return true;
        return remainingSlots(grp) > 0 && !unclaimedEligibleIds(grp, members).length;
    }

    function canClaim(grp, whoId, members, ctx) {
        if (!grp || grp.status !== 'active' || !whoId) return false;
        if (remainingSlots(grp) <= 0) return false;
        ctx = ctx && typeof ctx === 'object' ? ctx : {};
        var claimed = claimedWhoIds(grp);
        if (claimed[whoId]) return false;
        var store = global.miyaChatStore;
        var chatId = ctx.chat && ctx.chat.id;
        var profile = ctx.profile;
        var whoName = resolveWhoName(whoId, members, store, chatId, profile);
        if (
            (grp.claims || []).some(function (c) {
                return c && whoName && c.whoName === whoName;
            })
        ) {
            return false;
        }
        var eligible = getEligibleWhoIds(grp, members);
        return eligible.indexOf(whoId) >= 0;
    }

    function senderDisplayName(grp, members, store, groupChatId, profile) {
        if (!grp) return '成员';
        if (grp.senderName) return grp.senderName;
        if (grp.senderRole === 'user') return trim(profile && profile.name) || '用户';
        if (grp.senderContactId) {
            return resolveWhoName(grp.senderContactId, members, store, groupChatId, profile);
        }
        return '成员';
    }

    function targetDisplayNames(grp, members, store, groupChatId, profile) {
        if (!grp || grp.mode !== 'exclusive') return '';
        return (grp.targetIds || [])
            .map(function (id) {
                return resolveWhoName(id, members, store, groupChatId, profile);
            })
            .join('、');
    }

    function formatClaimsInline(grp) {
        if (!grp || !grp.claims || !grp.claims.length) return '（无）';
        return grp.claims
            .map(function (c) {
                return trim(c.whoName) + '¥' + formatMoney(c.amount);
            })
            .join('、');
    }

    function formatPendingInline(grp, members, store, groupChatId, profile) {
        var claimed = claimedWhoIds(grp);
        var eligible = getEligibleWhoIds(grp, members);
        var pending = eligible.filter(function (id) {
            return !claimed[id];
        });
        if (!pending.length) return '（无）';
        return pending
            .map(function (id) {
                return resolveWhoName(id, members, store, groupChatId, profile);
            })
            .join('、');
    }

    function formatGroupRedPacketForApi(grp, members, profile, store, groupChatId) {
        grp = normalizeGroupRedPacket(grp);
        if (!grp) return '';
        var third =
            grp.mode === 'exclusive'
                ? targetDisplayNames(grp, members, store, groupChatId, profile) || '用户'
                : String(grp.count);
        var parts = [
            '红包-' +
                (grp.mode === 'exclusive' ? '专属' : '拼手气') +
                '-' +
                formatMoney(grp.totalAmount) +
                '-' +
                third +
                '-' +
                (grp.note || '恭喜发财')
        ];
        var sender = senderDisplayName(grp, members, store, groupChatId, profile);
        if (sender && grp.senderRole === 'member') {
            parts.push('发起人：' + sender);
        }
        if (grp.claims && grp.claims.length) {
            parts.push('已领：' + formatClaimsInline(grp));
        }
        if (grp.status === 'active') {
            var pending = formatPendingInline(grp, members, store, groupChatId, profile);
            if (pending && pending !== '（无）') {
                parts.push('待领：' + pending);
            }
            parts.push('状态：进行中');
        } else if (grp.status === 'done') {
            parts.push('状态：已领完');
            if (grp.mode === 'lucky' && grp.claims && grp.claims.length) {
                var sorted = grp.claims.slice().sort(function (a, b) {
                    return (b.amount || 0) - (a.amount || 0);
                });
                var best = sorted[0];
                if (best && trim(best.whoName)) {
                    parts.push('手气王：' + trim(best.whoName) + '¥' + formatMoney(best.amount));
                }
            }
        } else if (grp.status === 'expired') {
            parts.push('状态：已过期');
        }
        return parts.join('-');
    }

    function formatClaimSystemContent(grp, claim, packetMsgId) {
        grp = normalizeGroupRedPacket(grp);
        if (!grp || !claim) return '';
        return '领取-' + trim(claim.whoName) + '-¥' + formatMoney(claim.amount);
    }

    function formatDoneSystemContent(grp, packetMsgId) {
        grp = normalizeGroupRedPacket(grp);
        if (!grp) return '';
        return '完结-红包#' + trim(packetMsgId);
    }

    function buildMessageContent(grp, members, profile, store, groupChatId) {
        return formatGroupRedPacketForApi(grp, members, profile, store, groupChatId);
    }

    function createPacketFields(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var mode = trim(opts.mode) === 'exclusive' ? 'exclusive' : 'lucky';
        var total = roundMoney(opts.totalAmount);
        var members = opts.members || [];
        var count;
        var targetIds = [];
        var splits;
        if (mode === 'exclusive') {
            targetIds = Array.isArray(opts.targetIds) ? opts.targetIds.filter(Boolean) : [];
            if (!targetIds.length && opts.targetId) targetIds = [trim(opts.targetId)];
            count = Math.max(1, targetIds.length);
            splits = splitEqualAmounts(total, count);
        } else {
            count = Math.max(1, Math.floor(Number(opts.count) || defaultEligibleCount(members)));
            splits = splitLuckyAmounts(total, count);
        }
        if (!splits) return null;
        var grp = normalizeGroupRedPacket({
            id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            mode: mode,
            totalAmount: total,
            count: count,
            note: trim(opts.note) || '恭喜发财',
            targetIds: targetIds,
            status: 'active',
            senderRole: trim(opts.senderRole) === 'member' ? 'member' : 'user',
            senderContactId: trim(opts.senderContactId),
            senderName: trim(opts.senderName),
            claims: [],
            splits: splits,
            walletHeld: !!opts.walletHeld,
            walletSettled: false
        });
        return {
            type: 'group_red_packet',
            groupRedPacket: grp,
            content: buildMessageContent(grp, members, opts.profile, opts.store, opts.groupChatId)
        };
    }

    function parseGroupRedPacketBody(body, senderContactId, members, store, groupChatId, profile) {
        var raw = trim(body);
        var m = raw.match(RE_PARSE);
        if (!m) return null;
        var mode = trim(m[1]) === '专属' ? 'exclusive' : 'lucky';
        var amount = parseFloat(m[2]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var third = trim(m[3]).replace(/份$/, '');
        var note = extractNoteFromTail(m[4]);
        var count;
        var targetIds = [];
        if (mode === 'exclusive') {
            var tid = resolveTargetId(third, members, store, groupChatId, profile);
            if (!tid) return null;
            targetIds = [tid];
            count = 1;
        } else {
            count = parseInt(third, 10);
            if (!Number.isFinite(count) || count < 1) return null;
        }
        var splits = mode === 'exclusive' ? splitEqualAmounts(amount, count) : splitLuckyAmounts(amount, count);
        if (!splits) return null;
        var senderName = '';
        if (senderContactId) {
            senderName = resolveWhoName(senderContactId, members, store, groupChatId, profile);
        }
        var grp = normalizeGroupRedPacket({
            mode: mode,
            totalAmount: amount,
            count: count,
            note: note,
            targetIds: targetIds,
            status: 'active',
            senderRole: 'member',
            senderContactId: trim(senderContactId),
            senderName: senderName,
            claims: [],
            splits: splits,
            walletHeld: false,
            walletSettled: false
        });
        return {
            type: 'group_red_packet',
            groupRedPacket: grp,
            content: buildMessageContent(grp, members, profile, store, groupChatId)
        };
    }

    function nextClaimAmount(grp) {
        grp = normalizeGroupRedPacket(grp);
        if (!grp || !grp.splits || !grp.splits.length) return 0;
        var idx = grp.claims ? grp.claims.length : 0;
        if (idx >= grp.splits.length) return 0;
        return roundMoney(grp.splits[idx]);
    }

    function creditClaimWallet(st, profileId, whoId, amount, grp) {
        if (!st || !(amount > 0)) return Promise.resolve();
        if (whoId === USER_OWNER_ID) {
            if (!profileId || typeof st.adjustWalletBalance !== 'function') return Promise.resolve();
            return st.adjustWalletBalance(profileId, amount);
        }
        if (typeof st.adjustContactWalletBalance === 'function') {
            return st.adjustContactWalletBalance(whoId, amount);
        }
        return Promise.resolve();
    }

    function refundSenderWallet(st, profileId, senderContactId, amount, grp) {
        if (!st || !(amount > 0) || !grp || !grp.walletHeld || grp.walletSettled) return Promise.resolve();
        if (grp.senderRole === 'user') {
            if (!profileId || typeof st.adjustWalletBalance !== 'function') return Promise.resolve();
            return st.adjustWalletBalance(profileId, amount);
        }
        if (grp.senderContactId && typeof st.adjustContactWalletBalance === 'function') {
            return st.adjustContactWalletBalance(grp.senderContactId, amount);
        }
        return Promise.resolve();
    }

    function settleRemainder(st, profileId, grp) {
        grp = normalizeGroupRedPacket(grp);
        if (!grp || !grp.walletHeld || grp.walletSettled) return Promise.resolve(grp);
        var claimedSum = 0;
        (grp.claims || []).forEach(function (c) {
            claimedSum = roundMoney(claimedSum + (c.amount || 0));
        });
        var refund = roundMoney(grp.totalAmount - claimedSum);
        var chain = Promise.resolve();
        if (refund > 0) {
            chain = refundSenderWallet(st, profileId, grp.senderContactId, refund, grp);
        }
        return chain.then(function () {
            grp.walletSettled = true;
            if (global.miyaChatApp && typeof global.miyaChatApp.refreshProfileUI === 'function') {
                global.miyaChatApp.refreshProfileUI();
            }
            return grp;
        });
    }

    var claimInflight = {};

    function claimInflightKey(chatId, msgId, whoId) {
        return String(chatId) + ':' + String(msgId) + ':' + String(whoId);
    }

    function findExistingClaimSystem(store, chatId, packetMsgId, whoId) {
        if (!store || !chatId || !packetMsgId || !whoId) return null;
        var list = typeof store.getMessages === 'function' ? store.getMessages(chatId) : [];
        var i;
        for (i = list.length - 1; i >= 0; i--) {
            var m = list[i];
            if (!m || m.deleted || m.role !== 'system') continue;
            if (m.type !== 'group_red_packet_claim' && m.systemKind !== 'group_red_packet_claim') continue;
            var ref = m.groupRedPacketRef;
            if (!ref || String(ref.packetMsgId) !== String(packetMsgId)) continue;
            var c = ref.claim;
            if (c && String(c.whoId) === String(whoId)) return m;
        }
        return null;
    }

    function runClaimPacket(store, chatId, msgId, whoId, ctx) {
        ctx = ctx && typeof ctx === 'object' ? ctx : {};
        var msg = store.findMessage(chatId, msgId);
        if (!msg || !msg.groupRedPacket) return Promise.reject(new Error('not_found'));
        var grp = normalizeGroupRedPacket(msg.groupRedPacket);
        var members = ctx.members || [];
        var profile = ctx.profile;
        if (!canClaim(grp, whoId, members, ctx)) return Promise.reject(new Error('cannot_claim'));
        var existingSys = findExistingClaimSystem(store, chatId, msgId, whoId);
        if (existingSys) {
            return Promise.resolve({
                packet: msg,
                claimMsg: existingSys,
                done: grp.status === 'done'
            });
        }
        var amount = nextClaimAmount(grp);
        if (!(amount > 0)) return Promise.reject(new Error('no_amount'));
        var whoName = resolveWhoName(whoId, members, store, chatId, profile);
        var claim = { whoId: whoId, whoName: whoName, amount: amount, at: Date.now() };
        var nextClaims = (grp.claims || []).concat([claim]);
        var draftGrp = normalizeGroupRedPacket(Object.assign({}, grp, { claims: nextClaims }));
        var done = isPacketComplete(draftGrp, members);
        var nextGrp = normalizeGroupRedPacket(
            Object.assign({}, draftGrp, {
                status: done ? 'done' : 'active',
                doneAt: done ? Date.now() : 0
            })
        );
        var profileId = profile && profile.id;
        return creditClaimWallet(store, profileId, whoId, amount, nextGrp)
            .then(function () {
                var content = buildMessageContent(nextGrp, members, profile, store, chatId);
                return store.updateMessage(chatId, msgId, {
                    groupRedPacket: nextGrp,
                    content: content
                });
            })
            .then(function (updated) {
                var dupSys = findExistingClaimSystem(store, chatId, msgId, whoId);
                if (dupSys) {
                    return { packet: updated, claimMsg: dupSys, done: nextGrp.status === 'done' };
                }
                var sys = {
                    role: 'system',
                    type: 'group_red_packet_claim',
                    systemKind: 'group_red_packet_claim',
                    content: formatClaimSystemContent(nextGrp, claim, msgId),
                    groupRedPacketRef: { packetMsgId: msgId, claim: claim, packet: nextGrp }
                };
                return store.addMessage(chatId, sys).then(function (sysMsg) {
                    return { packet: updated, claimMsg: sysMsg, done: nextGrp.status === 'done' };
                });
            })
            .then(function (result) {
                if (!result.done) return result;
                return settleRemainder(store, profileId, nextGrp).then(function () {
                    var doneGrp = normalizeGroupRedPacket(
                        Object.assign({}, nextGrp, { walletSettled: true })
                    );
                    return store
                        .updateMessage(chatId, msgId, {
                            groupRedPacket: doneGrp,
                            content: buildMessageContent(doneGrp, members, profile, store, chatId)
                        })
                        .then(function (finalMsg) {
                            var doneSys = {
                                role: 'system',
                                type: 'group_red_packet_done',
                                systemKind: 'group_red_packet_done',
                                content: formatDoneSystemContent(doneGrp, msgId),
                                groupRedPacketRef: { packetMsgId: msgId, packet: doneGrp }
                            };
                            return store.addMessage(chatId, doneSys).then(function (doneMsg) {
                                result.packet = finalMsg;
                                result.doneMsg = doneMsg;
                                return result;
                            });
                        });
                });
            });
    }

    function claimPacket(store, chatId, msgId, whoId, ctx) {
        if (!store || !chatId || !msgId || !whoId) return Promise.reject(new Error('invalid'));
        var key = claimInflightKey(chatId, msgId, whoId);
        if (claimInflight[key]) return claimInflight[key];
        claimInflight[key] = runClaimPacket(store, chatId, msgId, whoId, ctx).finally(function () {
            delete claimInflight[key];
        });
        return claimInflight[key];
    }

    function holdOutgoing(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var wallet = global.MiyaChatWallet;
        var amt = roundMoney(opts.totalAmount);
        if (!(amt > 0)) return Promise.reject(new Error('invalid_amount'));
        if (opts.senderRole === 'member') {
            if (!wallet || typeof wallet.holdRoleOutgoingTransfer !== 'function') {
                return Promise.resolve(false);
            }
            return wallet.holdRoleOutgoingTransfer(opts.senderContactId, amt).then(function () {
                return true;
            });
        }
        if (!wallet || typeof wallet.holdUserOutgoingTransfer !== 'function') {
            return Promise.resolve(false);
        }
        return wallet.holdUserOutgoingTransfer(opts.profileId, amt).then(function () {
            return true;
        });
    }

    function refreshRoom(chatId) {
        var room = global.miyaChatRoom;
        if (room && typeof room.refresh === 'function' && typeof room.getOpenChatId === 'function') {
            if (String(room.getOpenChatId()) === String(chatId)) {
                room.refresh({ toBottom: true });
            }
        }
        if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
            global.miyaChatApp.refreshLists();
        }
    }

    var autoClaimTimers = {};
    /** 角色拼手气红包：等本轮消息全部显示后再统一开始计时 */
    var deferredMemberLuckyByChat = {};

    function clearAutoClaim(chatId, msgId) {
        var key = String(chatId) + ':' + String(msgId);
        if (autoClaimTimers[key]) {
            clearTimeout(autoClaimTimers[key].timer);
            delete autoClaimTimers[key];
        }
    }

    function finalizeIfStalled(store, chatId, msgId, ctx) {
        if (!store || !chatId || !msgId) return Promise.resolve();
        ctx = ctx && typeof ctx === 'object' ? ctx : {};
        var msg = store.findMessage(chatId, msgId);
        if (!msg || !msg.groupRedPacket) return Promise.resolve();
        var grp = normalizeGroupRedPacket(msg.groupRedPacket);
        if (grp.status === 'done') return Promise.resolve();
        var members = ctx.members || [];
        if (!isPacketComplete(grp, members)) return Promise.resolve();
        var profile = ctx.profile;
        var profileId = profile && profile.id;
        var doneGrp = normalizeGroupRedPacket(
            Object.assign({}, grp, { status: 'done', doneAt: Date.now() })
        );
        return settleRemainder(store, profileId, doneGrp).then(function () {
            doneGrp.walletSettled = true;
            return store
                .updateMessage(chatId, msgId, {
                    groupRedPacket: doneGrp,
                    content: buildMessageContent(doneGrp, members, profile, store, chatId)
                })
                .then(function (finalMsg) {
                    var doneSys = {
                        role: 'system',
                        type: 'group_red_packet_done',
                        systemKind: 'group_red_packet_done',
                        content: formatDoneSystemContent(doneGrp, msgId),
                        groupRedPacketRef: { packetMsgId: msgId, packet: doneGrp }
                    };
                    return store.addMessage(chatId, doneSys).then(function () {
                        return finalMsg;
                    });
                });
        });
    }

    function deferMemberLuckyAutoClaim(store, chatId, msgId, ctx) {
        if (!store || !chatId || !msgId) return;
        var key = String(chatId);
        if (!deferredMemberLuckyByChat[key]) deferredMemberLuckyByChat[key] = [];
        var dup = deferredMemberLuckyByChat[key].some(function (item) {
            return item && String(item.msgId) === String(msgId);
        });
        if (dup) return;
        deferredMemberLuckyByChat[key].push({
            store: store,
            msgId: msgId,
            ctx: ctx && typeof ctx === 'object' ? ctx : {}
        });
    }

    function onAssistantBatchDisplayed(chatId) {
        if (!chatId) return;
        var key = String(chatId);
        var list = deferredMemberLuckyByChat[key];
        if (!list || !list.length) return;
        deferredMemberLuckyByChat[key] = [];
        list.forEach(function (item) {
            if (!item || !item.store || !item.msgId) return;
            scheduleAutoClaims(item.store, chatId, item.msgId, item.ctx, {
                userGraceMs: MEMBER_LUCKY_USER_GRACE_MS
            });
        });
    }

    function isMemberLuckyPacket(grp) {
        grp = normalizeGroupRedPacket(grp);
        return !!(grp && grp.mode === 'lucky' && grp.senderRole === 'member');
    }

    function scheduleAutoClaims(store, chatId, msgId, ctx, opts) {
        if (!store || !chatId || !msgId) return;
        clearAutoClaim(chatId, msgId);
        var msg = store.findMessage(chatId, msgId);
        if (!msg || !msg.groupRedPacket) return;
        var grp = normalizeGroupRedPacket(msg.groupRedPacket);
        if (grp.status !== 'active') return;
        opts = opts && typeof opts === 'object' ? opts : {};
        var members = (ctx && ctx.members) || [];
        var claimed = claimedWhoIds(grp);
        var eligible = getEligibleWhoIds(grp, members);
        var aiIds = eligible.filter(function (id) {
            return id !== USER_OWNER_ID && !claimed[id];
        });
        if (!aiIds.length) return;
        aiIds = shuffle(aiIds);
        var idx = 0;
        var memberLucky = isMemberLuckyPacket(grp);
        function step() {
            var msgNow = store.findMessage(chatId, msgId);
            if (!msgNow || !msgNow.groupRedPacket) {
                clearAutoClaim(chatId, msgId);
                return;
            }
            var grpNow = normalizeGroupRedPacket(msgNow.groupRedPacket);
            if (grpNow.status !== 'active' || remainingSlots(grpNow) <= 0) {
                clearAutoClaim(chatId, msgId);
                return;
            }
            if (idx >= aiIds.length) {
                clearAutoClaim(chatId, msgId);
                finalizeIfStalled(store, chatId, msgId, ctx).then(function () {
                    refreshRoom(chatId);
                });
                return;
            }
            var whoId = aiIds[idx++];
            if (!canClaim(grpNow, whoId, members, ctx)) {
                step();
                return;
            }
            claimPacket(store, chatId, msgId, whoId, ctx)
                .then(function () {
                    refreshRoom(chatId);
                    var delay = memberLucky
                        ? 800 + Math.floor(Math.random() * 1200)
                        : 400 + Math.floor(Math.random() * 1600);
                    autoClaimTimers[String(chatId) + ':' + String(msgId)] = {
                        timer: setTimeout(step, delay)
                    };
                })
                .catch(function () {
                    step();
                });
        }
        var firstDelay;
        if (memberLucky) {
            firstDelay =
                typeof opts.userGraceMs === 'number' && opts.userGraceMs >= 0
                    ? opts.userGraceMs
                    : MEMBER_LUCKY_USER_GRACE_MS;
        } else {
            firstDelay = 500 + Math.floor(Math.random() * 900);
        }
        autoClaimTimers[String(chatId) + ':' + String(msgId)] = {
            timer: setTimeout(step, firstDelay)
        };
    }

    function sendUserPacket(store, chatId, opts, ctx) {
        var fields = createPacketFields(
            Object.assign({}, opts, {
                senderRole: 'user',
                members: ctx.members,
                profile: ctx.profile,
                store: store,
                groupChatId: chatId
            })
        );
        if (!fields) return Promise.reject(new Error('invalid_packet'));
        return holdOutgoing({
            senderRole: 'user',
            profileId: ctx.profile && ctx.profile.id,
            totalAmount: fields.groupRedPacket.totalAmount
        })
            .then(function (held) {
                fields.groupRedPacket.walletHeld = !!held;
                fields.role = 'user';
                return store.addMessage(chatId, fields);
            })
            .then(function (msg) {
                scheduleAutoClaims(store, chatId, msg.id, ctx);
                return msg;
            });
    }

    function processMemberPacketBubble(payload, contactId, store, chatId, members, profile) {
        if (!payload || payload.type !== 'group_red_packet' || !payload.groupRedPacket) return Promise.resolve(payload);
        var grp = normalizeGroupRedPacket(payload.groupRedPacket);
        grp.senderRole = 'member';
        grp.senderContactId = trim(contactId);
        grp.senderName = resolveWhoName(contactId, members, store, chatId, profile);
        payload.groupRedPacket = grp;
        payload.content = buildMessageContent(grp, members, profile, store, chatId);
        return holdOutgoing({
            senderRole: 'member',
            senderContactId: contactId,
            totalAmount: grp.totalAmount
        })
            .then(function (held) {
                payload.groupRedPacket = Object.assign({}, grp, { walletHeld: !!held });
                return payload;
            })
            .catch(function () {
                return payload;
            });
    }

    function afterMemberPacketSaved(store, chatId, msg, ctx) {
        if (!msg || msg.type !== 'group_red_packet' || !msg.groupRedPacket) return;
        var grp = normalizeGroupRedPacket(msg.groupRedPacket);
        if (isMemberLuckyPacket(grp)) {
            deferMemberLuckyAutoClaim(store, chatId, msg.id, ctx);
        } else {
            scheduleAutoClaims(store, chatId, msg.id, ctx);
        }
    }

    function isGroupRedPacketSystem(m) {
        if (!m || m.role !== 'system') return false;
        return (
            m.type === 'group_red_packet_claim' ||
            m.type === 'group_red_packet_done' ||
            m.systemKind === 'group_red_packet_claim' ||
            m.systemKind === 'group_red_packet_done'
        );
    }

    function formatSystemForApi(m) {
        return trim(m && m.content);
    }

    function formatSystemForDisplay(m) {
        if (!m) return '';
        var ref = m.groupRedPacketRef && typeof m.groupRedPacketRef === 'object' ? m.groupRedPacketRef : null;
        var kind = trim(m.type || m.systemKind);
        if (kind === 'group_red_packet_claim') {
            var claim = ref && ref.claim;
            if (claim && trim(claim.whoName)) {
                return trim(claim.whoName) + ' 领取了红包 ¥' + formatMoney(claim.amount);
            }
            var claimRaw = trim(m.content);
            var claimMatch = claimRaw.match(/^领取[-－—]([^-－—]+)[-－—]¥?([\d.]+)/);
            if (claimMatch) {
                return trim(claimMatch[1]) + ' 领取了红包 ¥' + formatMoney(claimMatch[2]);
            }
            return '有人领取了红包';
        }
        if (kind === 'group_red_packet_done') {
            var grp = ref && ref.packet ? normalizeGroupRedPacket(ref.packet) : null;
            if (grp && grp.claims && grp.claims.length) {
                if (grp.mode === 'lucky') {
                    var sorted = grp.claims.slice().sort(function (a, b) {
                        return (b.amount || 0) - (a.amount || 0);
                    });
                    var best = sorted[0];
                    if (best && trim(best.whoName)) {
                        return (
                            '红包已被领完，' +
                            trim(best.whoName) +
                            ' 手气最佳 ¥' +
                            formatMoney(best.amount)
                        );
                    }
                }
            }
            return '红包已被领完';
        }
        return '红包动态';
    }

    function parseGroupRedPacketLineSimple(body) {
        var raw = trim(body);
        var m = raw.match(RE_PARSE);
        if (!m) return null;
        var mode = trim(m[1]) === '专属' ? 'exclusive' : 'lucky';
        var amount = parseFloat(m[2]);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        var third = trim(m[3]).replace(/份$/, '');
        var note = extractNoteFromTail(m[4]);
        var count;
        var targetIds = [];
        if (mode === 'exclusive') {
            count = 1;
            targetIds = [third || 'exclusive_target'];
        } else {
            count = parseInt(third, 10);
            if (!Number.isFinite(count) || count < 1) return null;
        }
        var splits =
            mode === 'exclusive' ? splitEqualAmounts(amount, count) : splitLuckyAmounts(amount, count);
        if (!splits) return null;
        return normalizeGroupRedPacket({
            mode: mode,
            totalAmount: amount,
            count: count,
            note: note,
            targetIds: targetIds,
            status: 'active',
            senderRole: 'member',
            claims: [],
            splits: splits,
            walletHeld: false,
            walletSettled: false
        });
    }

    function mergeGroupRedPacketProgress(stored, fromContent) {
        stored = normalizeGroupRedPacket(stored);
        fromContent = normalizeGroupRedPacket(fromContent);
        if (!stored) return fromContent;
        if (!fromContent) return stored;
        var storedClaims = stored.claims || [];
        var contentClaims = fromContent.claims || [];
        var claims;
        if (contentClaims.length > storedClaims.length) {
            claims = contentClaims.map(function (c) {
                if (!c) return c;
                var hit = storedClaims.find(function (s) {
                    return s && s.whoName === c.whoName;
                });
                return hit ? Object.assign({}, c, { whoId: hit.whoId, at: hit.at || c.at }) : c;
            });
        } else if (storedClaims.length) {
            claims = storedClaims;
        } else {
            claims = contentClaims;
        }
        var status = stored.status;
        if (fromContent.status === 'done' || fromContent.status === 'expired') status = fromContent.status;
        else if (claims.length >= stored.count) status = 'done';
        else if (fromContent.status === 'active' && stored.status === 'active') status = 'active';
        return normalizeGroupRedPacket(
            Object.assign({}, stored, {
                claims: claims,
                status: status,
                doneAt: stored.doneAt || fromContent.doneAt
            })
        );
    }

    function resolveMessageGroupRedPacket(m) {
        if (!m || typeof m !== 'object') return null;
        var content = trim(m.content);
        if (m.groupRedPacket) {
            var existing = normalizeGroupRedPacket(m.groupRedPacket);
            if (existing) {
                if (content) {
                    var headOnly = content.split(/[-－—]发起人：/)[0];
                    var fromContent = parseGroupRedPacketLineSimple(headOnly);
                    if (!fromContent) {
                        var loose = content.match(/^红包[-－—](拼手气|专属)[-－—]([\d.]+)[-－—](\d+)/);
                        if (loose) {
                            fromContent = normalizeGroupRedPacket({
                                mode: trim(loose[1]) === '专属' ? 'exclusive' : 'lucky',
                                totalAmount: parseFloat(loose[2]),
                                count: parseInt(loose[3], 10),
                                claims: [],
                                status: 'active'
                            });
                        }
                    }
                    if (fromContent) {
                        var claimsMatch = content.match(/[-－—]已领：([^-－—]+)/);
                        if (claimsMatch) {
                            var claimStr = trim(claimsMatch[1]);
                            if (claimStr && claimStr !== '（无）') {
                                fromContent.claims = claimStr.split(/、/).map(function (part, idx) {
                                    var cm = trim(part).match(/^(.+?)¥([\d.]+)$/);
                                    if (!cm) return null;
                                    return {
                                        whoId: 'recovered_' + idx,
                                        whoName: trim(cm[1]),
                                        amount: roundMoney(cm[2]),
                                        at: 0
                                    };
                                }).filter(Boolean);
                            }
                        }
                        var statusMatch = content.match(/[-－—]状态：([^-－—]+)/);
                        if (statusMatch) {
                            var st = trim(statusMatch[1]);
                            if (st === '已领完') fromContent.status = 'done';
                            else if (st === '已过期') fromContent.status = 'expired';
                            else fromContent.status = 'active';
                        }
                        if (fromContent.claims.length >= fromContent.count) fromContent.status = 'done';
                    }
                    if (fromContent) return mergeGroupRedPacketProgress(existing, fromContent);
                }
                return existing;
            }
        }
        if (!content) return null;
        var head = content.split(/[-－—]发起人：/)[0];
        var parsed = parseGroupRedPacketLineSimple(head);
        if (!parsed) {
            var loose = content.match(/^红包[-－—](拼手气|专属)[-－—]([\d.]+)[-－—](\d+)/);
            if (!loose) return null;
            var modeLoose = trim(loose[1]) === '专属' ? 'exclusive' : 'lucky';
            var amtLoose = parseFloat(loose[2]);
            var cntLoose = parseInt(loose[3], 10);
            if (!Number.isFinite(amtLoose) || amtLoose <= 0 || !Number.isFinite(cntLoose) || cntLoose < 1) {
                return null;
            }
            var noteLoose = '恭喜发财';
            var noteMatch = content.match(/[-－—]「([^」]*)」/);
            if (noteMatch) noteLoose = trim(noteMatch[1]) || noteLoose;
            var splitsLoose =
                modeLoose === 'exclusive'
                    ? splitEqualAmounts(amtLoose, 1)
                    : splitLuckyAmounts(amtLoose, cntLoose);
            if (!splitsLoose) return null;
            parsed = normalizeGroupRedPacket({
                mode: modeLoose,
                totalAmount: amtLoose,
                count: modeLoose === 'exclusive' ? 1 : cntLoose,
                note: noteLoose,
                targetIds: modeLoose === 'exclusive' ? ['exclusive_target'] : [],
                status: 'active',
                claims: [],
                splits: splitsLoose
            });
        }
        if (!parsed) return null;
        var claimsMatch = content.match(/[-－—]已领：([^-－—]+)/);
        if (claimsMatch) {
            var claimStr = trim(claimsMatch[1]);
            if (claimStr && claimStr !== '（无）') {
                parsed.claims = claimStr.split(/、/).map(function (part, idx) {
                    var cm = trim(part).match(/^(.+?)¥([\d.]+)$/);
                    if (!cm) return null;
                    return {
                        whoId: 'recovered_' + idx,
                        whoName: trim(cm[1]),
                        amount: roundMoney(cm[2]),
                        at: 0
                    };
                }).filter(Boolean);
            }
        }
        var statusMatch = content.match(/[-－—]状态：([^-－—]+)/);
        if (statusMatch) {
            var st = trim(statusMatch[1]);
            if (st === '已领完') parsed.status = 'done';
            else if (st === '已过期') parsed.status = 'expired';
            else parsed.status = 'active';
        }
        if (parsed.claims.length >= parsed.count) parsed.status = 'done';
        return normalizeGroupRedPacket(parsed);
    }

    function buildSendSheetHtml(ctx, esc, walletFmt) {
        var members = (ctx && ctx.members) || [];
        var profile = ctx && ctx.profile;
        var bal = '';
        var st = global.miyaChatStore;
        if (st && ctx && ctx.profile && st.getWallet && walletFmt) {
            var w = st.getWallet(ctx.profile.id);
            bal =
                '<p class="qq-sheet__hint grp-rp-sheet__bal">余额 ' +
                esc(walletFmt(w.balance)) +
                '</p>';
        }
        var memberOpts = members
            .map(function (c) {
                var gg = global.MiyaChatGroup;
                var name =
                    gg && typeof gg.memberDisplayName === 'function'
                        ? gg.memberDisplayName(st, c, ctx.chat.id)
                        : c.name;
                return (
                    '<button type="button" class="grp-rp-target" data-grp-rp-target="' +
                    esc(c.id) +
                    '">' +
                    esc(name) +
                    '</button>'
                );
            })
            .join('');
        return (
            '<div class="qq-sheet qq-sheet--grp-rp">' +
            '<div class="qq-sheet__panel grp-rp-sheet__panel">' +
            '<div class="qq-sheet__grab"></div>' +
            '<header class="grp-rp-sheet__head">' +
            '<span class="grp-rp-sheet__kicker">群聊</span>' +
            '<h2 class="grp-rp-sheet__title">群红包</h2>' +
            '</header>' +
            bal +
            '<div class="grp-rp-sheet__modes" role="tablist">' +
            '<button type="button" class="grp-rp-mode is-active" data-grp-rp-mode="lucky">拼手气</button>' +
            '<button type="button" class="grp-rp-mode" data-grp-rp-mode="exclusive">专属</button>' +
            '</div>' +
            '<div class="qq-sheet__body grp-rp-sheet__body">' +
            '<label class="grp-rp-field"><span class="grp-rp-field__label">金额</span>' +
            '<div class="grp-rp-field__input-wrap"><span class="grp-rp-field__prefix">¥</span>' +
            '<input class="grp-rp-field__input" id="grp-rp-amt" type="number" min="0.01" step="0.01" placeholder="0.00" inputmode="decimal"></div></label>' +
            '<label class="grp-rp-field grp-rp-field--lucky"><span class="grp-rp-field__label">份数</span>' +
            '<input class="grp-rp-field__input" id="grp-rp-count" type="number" min="1" step="1" value="' +
            esc(String(Math.max(1, members.length + 1))) +
            '"></label>' +
            '<div class="grp-rp-field grp-rp-field--exclusive" hidden>' +
            '<span class="grp-rp-field__label">发给</span>' +
            '<div class="grp-rp-targets" id="grp-rp-targets">' +
            '<button type="button" class="grp-rp-target is-active" data-grp-rp-target="' +
            esc(USER_OWNER_ID) +
            '">' +
            esc((profile && profile.name) || '用户') +
            '</button>' +
            memberOpts +
            '</div></div>' +
            '<label class="grp-rp-field"><span class="grp-rp-field__label">祝福语</span>' +
            '<input class="grp-rp-field__input" id="grp-rp-note" type="text" maxlength="60" placeholder="恭喜发财"></label>' +
            '</div>' +
            '<div class="grp-rp-sheet__actions">' +
            '<button type="button" class="grp-rp-sheet__send" id="grp-rp-send">塞钱进红包</button>' +
            '<button type="button" class="qq-sheet__cancel" data-sheet-close>取消</button>' +
            '</div></div></div>'
        );
    }

    function bindSendSheet(root, store, chatId, ctx, onDone) {
        if (!root) return;
        var mode = 'lucky';
        var targetId = USER_OWNER_ID;
        var modeBtns = root.querySelectorAll('[data-grp-rp-mode]');
        var luckyField = root.querySelector('.grp-rp-field--lucky');
        var exField = root.querySelector('.grp-rp-field--exclusive');
        modeBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                mode = btn.getAttribute('data-grp-rp-mode') || 'lucky';
                modeBtns.forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                if (luckyField) luckyField.hidden = mode !== 'lucky';
                if (exField) exField.hidden = mode !== 'exclusive';
            });
        });
        root.querySelectorAll('[data-grp-rp-target]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                targetId = btn.getAttribute('data-grp-rp-target') || USER_OWNER_ID;
                root.querySelectorAll('[data-grp-rp-target]').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
            });
        });
        var sendBtn = root.querySelector('#grp-rp-send');
        if (!sendBtn) return;
        sendBtn.addEventListener('click', function () {
            var amtEl = root.querySelector('#grp-rp-amt');
            var cntEl = root.querySelector('#grp-rp-count');
            var noteEl = root.querySelector('#grp-rp-note');
            var amt = Number((amtEl && amtEl.value) || 0);
            var note = (noteEl && noteEl.value) || '';
            if (!(amt > 0)) return onDone && onDone({ error: 'invalid_amount' });
            var opts = {
                mode: mode,
                totalAmount: amt,
                note: note
            };
            if (mode === 'exclusive') {
                opts.targetIds = [targetId];
            } else {
                opts.count = Number((cntEl && cntEl.value) || 0);
            }
            sendUserPacket(store, chatId, opts, ctx)
                .then(function (msg) {
                    if (onDone) onDone({ ok: true, msg: msg });
                })
                .catch(function (err) {
                    var wallet = global.MiyaChatWallet;
                    var code = wallet && wallet.errCode ? wallet.errCode(err) : '';
                    if (onDone) onDone({ error: code || 'send_failed' });
                });
        });
    }

    function renderCard(m, esc, fmtMoney, ctx) {
        var grp = normalizeGroupRedPacket(m && m.groupRedPacket);
        if (!grp) return '';
        var store = global.miyaChatStore;
        var members = (ctx && ctx.members) || [];
        var profile = ctx && ctx.profile;
        var chatId = ctx && ctx.chat && ctx.chat.id;
        var claimed = claimedWhoIds(grp);
        var mineId = USER_OWNER_ID;
        var canOpen = grp.status === 'active' && canClaim(grp, mineId, members, ctx);
        var isExclusive = grp.mode === 'exclusive';
        var progress = (grp.claims ? grp.claims.length : 0) + '/' + grp.count;
        var sender = senderDisplayName(grp, members, store, chatId, profile);
        var note = grp.note || '恭喜发财，大吉大利';
        var done = grp.status === 'done';
        var locked =
            isExclusive &&
            !done &&
            !canOpen &&
            !claimed[mineId] &&
            getEligibleWhoIds(grp, members).indexOf(mineId) < 0;
        var modeEn = isExclusive ? 'Exclusive' : 'Lucky';
        var modeCn = isExclusive ? '专属' : '拼手气';
        var stateLabel = done ? '已领完' : locked ? '不可领' : canOpen ? '领取' : '查看';
        var targetLine = isExclusive
            ? '<p class="grp-rp-card__target">For ' +
              esc(targetDisplayNames(grp, members, store, chatId, profile)) +
              '</p>'
            : '';
        var cardCls =
            'grp-rp-card grp-rp-card--' +
            (done ? 'done' : 'active') +
            (canOpen ? ' is-ready' : '') +
            (locked ? ' is-locked' : '');
        return (
            '<button type="button" class="' +
            cardCls +
            '" data-msg-id="' +
            esc(m.id) +
            '" data-grp-rp-card data-grp-rp-open="' +
            esc(m.id) +
            '">' +
            '<div class="grp-rp-card__grain" aria-hidden="true"></div>' +
            '<div class="grp-rp-card__glow" aria-hidden="true"></div>' +
            '<div class="grp-rp-card__line grp-rp-card__line--a" aria-hidden="true"></div>' +
            '<div class="grp-rp-card__line grp-rp-card__line--b" aria-hidden="true"></div>' +
            '<header class="grp-rp-card__head">' +
            '<span class="grp-rp-card__kicker">Red Packet · 红包</span>' +
            '<span class="grp-rp-card__mode">' +
            esc(modeEn + ' · ' + modeCn) +
            '</span></header>' +
            '<div class="grp-rp-card__hero">' +
            '<div class="grp-rp-card__seal" aria-hidden="true">' +
            '<span class="grp-rp-card__seal-ring"></span>' +
            '<span class="grp-rp-card__seal-char">福</span></div>' +
            '<p class="grp-rp-card__amt"><small>CNY</small>¥' +
            esc(fmtMoney(grp.totalAmount)) +
            '</p>' +
            '<p class="grp-rp-card__note">' +
            esc(note) +
            '</p>' +
            targetLine +
            '</div>' +
            '<footer class="grp-rp-card__foot">' +
            '<span class="grp-rp-card__from">' +
            esc(sender) +
            '</span>' +
            '<span class="grp-rp-card__progress">' +
            esc(progress) +
            '</span></footer>' +
            '<div class="grp-rp-card__cta">' +
            esc(stateLabel) +
            '</div></button>'
        );
    }

    function buildOpenOverlayHtml(amount, note) {
        return (
            '<div class="grp-rp-open" data-grp-rp-open-layer>' +
            '<div class="grp-rp-open__panel">' +
            '<div class="grp-rp-open__grain" aria-hidden="true"></div>' +
            '<div class="grp-rp-open__glow" aria-hidden="true"></div>' +
            '<span class="grp-rp-open__kicker">Received · 领取成功</span>' +
            '<div class="grp-rp-open__seal" aria-hidden="true"><span>福</span></div>' +
            '<span class="grp-rp-open__amt"><small>CNY</small>¥' +
            formatMoney(amount) +
            '</span>' +
            '<p class="grp-rp-open__note">' +
            String(note || '恭喜发财').replace(/</g, '&lt;') +
            '</p>' +
            '<button type="button" class="grp-rp-open__close" data-grp-rp-open-close>完成</button></div></div>'
        );
    }

    function buildDetailHtml(msg, ctx, esc) {
        var grp = normalizeGroupRedPacket(msg && msg.groupRedPacket);
        if (!grp) return '';
        var store = global.miyaChatStore;
        var members = (ctx && ctx.members) || [];
        var profile = ctx && ctx.profile;
        var chatId = ctx && ctx.chat && ctx.chat.id;
        var rows = (grp.claims || [])
            .slice()
            .sort(function (a, b) {
                return (a.at || 0) - (b.at || 0);
            })
            .map(function (c) {
                return (
                    '<li class="grp-rp-detail__row"><span class="grp-rp-detail__who">' +
                    esc(c.whoName) +
                    '</span><span class="grp-rp-detail__amt">¥' +
                    esc(formatMoney(c.amount)) +
                    '</span></li>'
                );
            })
            .join('');
        if (!rows) rows = '<li class="grp-rp-detail__empty">暂无领取记录</li>';
        return (
            '<div class="qq-sheet qq-sheet--grp-rp-detail">' +
            '<div class="qq-sheet__panel grp-rp-detail__panel">' +
            '<div class="qq-sheet__grab"></div>' +
            '<header class="grp-rp-detail__head"><h3>' +
            esc(grp.note) +
            '</h3><p>¥' +
            esc(formatMoney(grp.totalAmount)) +
            ' · ' +
            esc(grp.mode === 'exclusive' ? '专属' : '拼手气') +
            '</p></header>' +
            '<ul class="grp-rp-detail__list">' +
            rows +
            '</ul>' +
            '<button type="button" class="qq-sheet__cancel" data-sheet-close>关闭</button></div></div>'
        );
    }

    global.MiyaChatGroupRedPacket = {
        USER_OWNER_ID: USER_OWNER_ID,
        normalizeGroupRedPacket: normalizeGroupRedPacket,
        formatGroupRedPacketForApi: formatGroupRedPacketForApi,
        formatClaimSystemContent: formatClaimSystemContent,
        formatDoneSystemContent: formatDoneSystemContent,
        formatSystemForApi: formatSystemForApi,
        formatSystemForDisplay: formatSystemForDisplay,
        parseGroupRedPacketLineSimple: parseGroupRedPacketLineSimple,
        resolveMessageGroupRedPacket: resolveMessageGroupRedPacket,
        parseGroupRedPacketBody: parseGroupRedPacketBody,
        createPacketFields: createPacketFields,
        canClaim: canClaim,
        claimPacket: claimPacket,
        sendUserPacket: sendUserPacket,
        scheduleAutoClaims: scheduleAutoClaims,
        processMemberPacketBubble: processMemberPacketBubble,
        afterMemberPacketSaved: afterMemberPacketSaved,
        onAssistantBatchDisplayed: onAssistantBatchDisplayed,
        isGroupRedPacketSystem: isGroupRedPacketSystem,
        buildSendSheetHtml: buildSendSheetHtml,
        bindSendSheet: bindSendSheet,
        renderCard: renderCard,
        buildOpenOverlayHtml: buildOpenOverlayHtml,
        buildDetailHtml: buildDetailHtml,
        defaultEligibleCount: defaultEligibleCount
    };
})(window);
