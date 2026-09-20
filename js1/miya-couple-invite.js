/**
 * miya-couple-invite.js — 发送情侣空间邀请 · 跳转聊天 · 触发角色决策
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  function chatStore() { return global.miyaChatStore || null; }
  function cpStore() { return global.miyaCoupleStore || null; }
  function bridge() { return global.miyaCoupleBridge || null; }

  function toast(msg) {
    if (global.miyaChatApp && typeof global.miyaChatApp.toast === 'function') {
      global.miyaChatApp.toast(msg);
      return;
    }
    var el = document.getElementById('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function resolveProfile(profileId) {
    var st = chatStore();
    if (!st) return null;
    if (profileId) {
      var list = st.getProfiles ? st.getProfiles() : [];
      var hit = list.find(function (p) { return p && p.id === profileId; });
      if (hit) return hit;
    }
    return st.getActiveProfile ? st.getActiveProfile() : null;
  }

  function resolveContact(contactId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    var list = st.getContacts ? st.getContacts() : [];
    return list.find(function (c) { return c && c.id === contactId; }) || null;
  }

  function ensurePrivateChat(contactId, profileId) {
    var st = chatStore();
    if (!st) return Promise.reject(new Error('聊天未就绪'));
    var chat = st.findChatByContact ? st.findChatByContact(contactId) : null;
    if (chat) return Promise.resolve(chat);
    return st.createChat({ contactId: contactId, profileId: profileId || null });
  }

  function buildInviteMessage(contact, profile, inviteId) {
    var profileName = trim(profile && profile.name) || '我';
    var charName = trim(contact.name) || 'TA';
    return {
      role: 'user',
      type: 'couple_space_invite',
      content: '邀请你开通情侣空间',
      coupleSpaceInvite: {
        inviteId: inviteId,
        contactId: contact.id,
        profileId: profile && profile.id ? profile.id : '',
        profileName: profileName,
        charName: charName,
        status: 'pending',
        sentAt: Date.now(),
        decidedAt: 0,
        responseNote: ''
      }
    };
  }

  function navigateToChat(contactId) {
    var chatApp = global.miyaChatApp;
    if (!chatApp) return Promise.resolve();

    function openRoom() {
      if (typeof chatApp.openChatByContact === 'function') {
        return Promise.resolve(chatApp.openChatByContact(contactId));
      }
      return Promise.resolve();
    }

    if (typeof chatApp.open === 'function') {
      return chatApp.open().then(openRoom).catch(function () {
        return openRoom();
      });
    }
    return openRoom();
  }

  function closeCoupleApp() {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.close === 'function') {
      global.miyaCoupleApp.close();
    }
  }

  function expireOldPendingInvites(chatId, contactId) {
    var st = chatStore();
    if (!st || !chatId) return Promise.resolve();
    var msgs = st.getMessages(chatId) || [];
    var chain = Promise.resolve();
    msgs.forEach(function (m) {
      if (!m || m.deleted || m.type !== 'couple_space_invite' || !m.coupleSpaceInvite) return;
      if (trim(m.coupleSpaceInvite.status) !== 'pending') return;
      if (contactId && trim(m.coupleSpaceInvite.contactId) !== trim(contactId)) return;
      var inv = m.coupleSpaceInvite;
      chain = chain.then(function () {
        return st.updateMessage(chatId, m.id, {
          coupleSpaceInvite: Object.assign({}, inv, {
            status: 'expired',
            decidedAt: Date.now(),
            responseNote: '已重新发送邀请'
          })
        });
      });
    });
    return chain;
  }

  function sendInvite(contactId, profileId) {
    var st = chatStore();
    var cps = cpStore();
    var br = bridge();
    if (!st || !cps || !br) return Promise.reject(new Error('模块未就绪'));

    var contact = resolveContact(contactId);
    if (!contact) return Promise.reject(new Error('未找到该角色'));

    if (cps.isOpen(contactId)) {
      return Promise.reject(new Error('与该角色的情侣空间已开启'));
    }

    var profile = resolveProfile(profileId);
    if (!profile) return Promise.reject(new Error('请先创建用户人设'));

    var inviteId = cps.uid('cinv');
    var sentAt = Date.now();

    cps.markPending(contactId, {
      inviteId: inviteId,
      profileId: profile.id,
      profileName: profile.name,
      charName: contact.name,
      sentAt: sentAt
    });

    return ensurePrivateChat(contactId, profile.id).then(function (chat) {
      if (!chat || !chat.id) throw new Error('无法创建会话');
      return expireOldPendingInvites(chat.id, contactId).then(function () {
      var payload = buildInviteMessage(contact, profile, inviteId);
      return st.addMessage(chat.id, payload).then(function (msg) {
        cps.registerInvite({
          inviteId: inviteId,
          contactId: contactId,
          chatId: chat.id,
          msgId: msg && msg.id ? msg.id : '',
          profileId: profile.id,
          profileName: profile.name,
          charName: contact.name,
          sentAt: sentAt,
          status: 'pending'
        });
        closeCoupleApp();
        return navigateToChat(contactId).then(function () {
          return new Promise(function (resolve) {
            setTimeout(function () {
              var room = global.miyaChatRoom;
              var msgId = msg && msg.id ? msg.id : '';
              br.requestInviteDecision(chat.id, msgId).then(function (result) {
                if (room && typeof room.refresh === 'function' && room.getOpenChatId && room.getOpenChatId() === chat.id) {
                  room.refresh();
                }
                resolve({ chatId: chat.id, msgId: msgId, inviteId: inviteId, result: result });
              }).catch(function (err) {
                toast(err && err.message ? err.message : '等待角色回应失败，可再次发送邀请');
                resolve({ chatId: chat.id, msgId: msgId, inviteId: inviteId, error: err });
              });
            }, 420);
          });
        });
      });
      });
    });
  }

  global.miyaCoupleInvite = {
    send: sendInvite,
    buildInviteMessage: buildInviteMessage
  };
})(typeof window !== 'undefined' ? window : global);
