/**
 * miya-couple-bridge.js — 情侣空间邀请 · API 决策与回执解析
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  var RE_COUPLE_RECEIPT = /^情侣空间回执[-－—]?\s*(同意|拒绝|已同意|已拒绝|accept|decline|reject)/i;
  var RE_COMMEMORATION = /^情侣纪念[-－—]\s*(.+?)(?:[|｜]([\s\S]+))?$/i;
  var COMMEMORATION_TITLE_MAX = 40;
  var COMMEMORATION_BODY_MAX = 500;

  function parseCoupleSpaceReceiptLine(line) {
    var t = trim(line);
    if (!t) return null;
    var m = t.match(RE_COUPLE_RECEIPT);
    if (!m) return null;
    var actionRaw = trim(m[1]).toLowerCase();
    var action = 'decline';
    if (actionRaw === '同意' || actionRaw === '已同意' || actionRaw === 'accept') action = 'accept';
    var note = '';
    var pipe = t.split(/[|｜]/);
    if (pipe.length > 1) note = trim(pipe.slice(1).join('|'));
    return { action: action, note: note };
  }

  function stripCoupleSpaceReceiptLines(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.filter(function (line) {
      return !parseCoupleSpaceReceiptLine(line);
    });
  }

  function parseCommemorationLine(line) {
    var t = trim(line);
    if (!t) return null;
    var m = t.match(RE_COMMEMORATION);
    if (!m) return null;
    var title = trim(m[1]);
    var body = trim(m[2] || '');
    if (!title) return null;
    if (title.length > COMMEMORATION_TITLE_MAX) title = title.slice(0, COMMEMORATION_TITLE_MAX);
    if (body.length > COMMEMORATION_BODY_MAX) body = body.slice(0, COMMEMORATION_BODY_MAX);
    return { title: title, body: body };
  }

  function stripCommemorationLines(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.filter(function (line) {
      return !parseCommemorationLine(line);
    });
  }

  function buildCoupleCommemorationBlock(contact) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !contact || !contact.id) return '';
    if (typeof cpStore.isOpen !== 'function' || !cpStore.isOpen(contact.id)) return '';
    var who = trim(contact.name) || '角色';
    return [
      '【情侣空间·纪念事项】' + who + '多数轮不写；触动时单独一行「情侣纪念-标题｜内容」，不计入气泡。'
    ].join('');
  }

  function dispatchTimelineUpdated(contactId) {
    if (typeof global.dispatchEvent !== 'function') return;
    try {
      global.dispatchEvent(new CustomEvent('miya-couple-timeline-updated', {
        detail: { contactId: contactId }
      }));
    } catch (e) { /* ignore */ }
  }

  function applyRoleCoupleCommemorations(chatId, bubbleLines, store) {
    if (!store || !chatId || !Array.isArray(bubbleLines) || !bubbleLines.length) {
      return Promise.resolve([]);
    }
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || typeof cpStore.addTimelineEntry !== 'function') return Promise.resolve([]);

    var chat = store.findChat ? store.findChat(chatId) : null;
    var contactId = chat && chat.contactId ? trim(chat.contactId) : '';
    if (!contactId || typeof cpStore.isOpen !== 'function' || !cpStore.isOpen(contactId)) {
      return Promise.resolve([]);
    }

    var saved = [];
    var i;
    for (i = 0; i < bubbleLines.length; i++) {
      var parsed = parseCommemorationLine(bubbleLines[i]);
      if (!parsed) continue;
      var today = cpStore.isoToday ? cpStore.isoToday() : '';
      var entry = cpStore.addTimelineEntry(contactId, {
        type: 'commemoration',
        author: 'char',
        dateIso: today,
        title: parsed.title,
        body: parsed.body,
        meta: { fromChat: true, source: 'chat_commemoration' }
      });
      if (entry) {
        saved.push(entry.id);
        dispatchTimelineUpdated(contactId);
      }
      break;
    }
    return Promise.resolve(saved);
  }

  function collectTrailingUserRound(history) {
    var list = Array.isArray(history) ? history : [];
    var round = [];
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'assistant') break;
      if (list[i].role === 'user') round.unshift(list[i]);
    }
    return round;
  }

  function collectPendingCoupleInvitesInRound(history) {
    return collectTrailingUserRound(history).filter(function (m) {
      return (
        m &&
        !m.deleted &&
        m.type === 'couple_space_invite' &&
        m.coupleSpaceInvite &&
        trim(m.coupleSpaceInvite.status) === 'pending'
      );
    });
  }

  function buildCoupleInviteRespondBlock(pendingList, roleName) {
    var who = trim(roleName) || '角色';
    var rows = (pendingList || []).map(function (m, idx) {
      var inv = m.coupleSpaceInvite || {};
      return (
        String(idx + 1) +
        '. 用户「' +
        (trim(inv.profileName) || '我') +
        '」邀请你开通情侣空间（专属双人领地，可记录纪念日、时光轴与私语）'
      );
    });
    if (!rows.length) return '';
    return [
      '【本轮 · 情侣空间邀请（仅本轮注入，须处理）】',
      '用户在本轮向你发送了情侣空间开通邀请。你必须结合人设与当前关系，真诚决定是否同意：',
      rows.join('\n'),
      '· 同意：单独一行输出「情侣空间回执-同意」',
      '· 拒绝：单独一行输出「情侣空间回执-拒绝｜简短理由」',
      '【硬性】回执行仅用于系统记账，不会在聊天界面展示；处理完回执后，请用 1–4 条正常气泡表达你的态度与情绪（同意时可甜蜜期待，拒绝时须温和坦诚）。',
      who + '不得忽略待处理的情侣空间邀请。'
    ].join('\n');
  }

  function findPendingInviteMessage(store, chatId, inviteId) {
    if (!store || !chatId) return null;
    var msgs = store.getMessages ? store.getMessages(chatId) : [];
    if (!Array.isArray(msgs)) return [];
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      if (!m || m.deleted) continue;
      if (m.type !== 'couple_space_invite' || !m.coupleSpaceInvite) continue;
      if (trim(m.coupleSpaceInvite.status) !== 'pending') continue;
      if (inviteId && trim(m.coupleSpaceInvite.inviteId) !== trim(inviteId)) continue;
      return m;
    }
    return null;
  }

  function applyRoleCoupleSpaceReceipts(chatId, bubbleLines, store) {
    if (!store || !chatId || !bubbleLines || !bubbleLines.length) {
      return Promise.resolve([]);
    }
    var pending = (store.getMessages(chatId) || []).filter(function (m) {
      return (
        m &&
        !m.deleted &&
        m.role === 'user' &&
        m.type === 'couple_space_invite' &&
        m.coupleSpaceInvite &&
        trim(m.coupleSpaceInvite.status) === 'pending'
      );
    });
    if (!pending.length) return Promise.resolve([]);

    var cpStore = global.miyaCoupleStore;
    var updatedIds = [];
    var chain = Promise.resolve();

    bubbleLines.forEach(function (line) {
      var receipt = parseCoupleSpaceReceiptLine(line);
      if (!receipt) return;
      var hit = pending[0];
      if (!hit || updatedIds.indexOf(hit.id) >= 0) return;
      updatedIds.push(hit.id);
      pending = pending.filter(function (m) { return m.id !== hit.id; });

      var inv = hit.coupleSpaceInvite || {};
      var nextStatus = receipt.action === 'accept' ? 'accepted' : 'declined';
      var decidedAt = Date.now();
      var contactId = trim(inv.contactId);

      chain = chain.then(function () {
        return store.updateMessage(chatId, hit.id, {
          coupleSpaceInvite: Object.assign({}, inv, {
            status: nextStatus,
            decidedAt: decidedAt,
            responseNote: receipt.note || ''
          })
        }).then(function () {
          var room = global.miyaChatRoom;
          if (
            room &&
            typeof room.patchMessageBubble === 'function' &&
            typeof room.getOpenChatId === 'function' &&
            room.getOpenChatId() === chatId
          ) {
            room.patchMessageBubble(hit.id);
          }
          if (!cpStore || !contactId) return;
          if (receipt.action === 'accept') {
            cpStore.openSpace(contactId, {
              inviteId: inv.inviteId,
              profileId: inv.profileId,
              profileName: inv.profileName,
              charName: inv.charName,
              sentAt: inv.sentAt || decidedAt,
              annivDate: cpStore.isoToday ? cpStore.isoToday() : ''
            });
            if (typeof cpStore.seedOpenSpaceMilestone === 'function') {
              cpStore.seedOpenSpaceMilestone(contactId);
            }
            if (inv.inviteId) cpStore.updateInvite(inv.inviteId, { status: 'accepted' });
          } else {
            cpStore.markDeclined(contactId, {
              inviteId: inv.inviteId,
              profileId: inv.profileId,
              profileName: inv.profileName,
              charName: inv.charName,
              sentAt: inv.sentAt || decidedAt
            });
            if (inv.inviteId) cpStore.updateInvite(inv.inviteId, { status: 'declined' });
          }
          if (typeof global.dispatchEvent === 'function') {
            try {
              global.dispatchEvent(new CustomEvent('miya-couple-invite-resolved', {
                detail: {
                  chatId: chatId,
                  msgId: hit.id,
                  contactId: contactId,
                  status: nextStatus,
                  inviteId: inv.inviteId
                }
              }));
            } catch (eEv) { /* ignore */ }
          }
        });
      });
    });

    return chain.then(function () { return updatedIds; });
  }

  function requestInviteDecision(chatId, inviteMsgId) {
    var engine = global.miyaChatEngine;
    var store = global.miyaChatStore;
    var room = global.miyaChatRoom;
    if (!engine || !store || !chatId) {
      return Promise.reject(new Error('模块未就绪'));
    }

    var msg = null;
    if (inviteMsgId) {
      var msgs = store.getMessages(chatId) || [];
      msg = msgs.find(function (m) { return m && m.id === inviteMsgId; }) || null;
    }
    if (!msg) msg = findPendingInviteMessage(store, chatId);
    if (!msg || !msg.coupleSpaceInvite || trim(msg.coupleSpaceInvite.status) !== 'pending') {
      return Promise.resolve({ skipped: true });
    }

    var inv = msg.coupleSpaceInvite;
    var systemLead = buildCoupleInviteRespondBlock([msg], inv.charName);

    function runReply() {
      if (room && typeof room.requestAiReply === 'function') {
        return room.requestAiReply(false, 0, { coupleInviteMode: true });
      }
      return engine.sendChat(chatId, '', {
        skipUserMessage: true,
        coupleInviteMode: true
      });
    }

    if (engine.isChatApiBusy && engine.isChatApiBusy(chatId)) {
      return new Promise(function (resolve, reject) {
        var tries = 0;
        function poll() {
          tries += 1;
          if (!engine.isChatApiBusy(chatId)) {
            runReply().then(resolve).catch(reject);
            return;
          }
          if (tries > 30) {
            reject(new Error('API 忙碌'));
            return;
          }
          setTimeout(poll, 500);
        }
        poll();
      });
    }

    return runReply();
  }

  global.miyaCoupleBridge = {
    RE_COUPLE_RECEIPT: RE_COUPLE_RECEIPT,
    RE_COMMEMORATION: RE_COMMEMORATION,
    parseCoupleSpaceReceiptLine: parseCoupleSpaceReceiptLine,
    parseCommemorationLine: parseCommemorationLine,
    stripCoupleSpaceReceiptLines: stripCoupleSpaceReceiptLines,
    stripCommemorationLines: stripCommemorationLines,
    buildCoupleCommemorationBlock: buildCoupleCommemorationBlock,
    applyRoleCoupleCommemorations: applyRoleCoupleCommemorations,
    collectPendingCoupleInvitesInRound: collectPendingCoupleInvitesInRound,
    buildCoupleInviteRespondBlock: buildCoupleInviteRespondBlock,
    applyRoleCoupleSpaceReceipts: applyRoleCoupleSpaceReceipts,
    requestInviteDecision: requestInviteDecision,
    findPendingInviteMessage: findPendingInviteMessage
  };
})(typeof window !== 'undefined' ? window : global);
