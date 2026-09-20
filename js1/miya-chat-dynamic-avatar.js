/**
 * Miya 聊天 · 动态换头像（全局聊天展示，不影响联系人档案）
 */
(function (global) {
  'use strict';

  function trim(s) {
    return String(s || '').trim();
  }

  function normalizeDynamicAvatar(raw) {
    var d = { charEnabled: false, userEnabled: false };
    if (!raw || typeof raw !== 'object') return Object.assign({}, d);
    return {
      charEnabled: !!raw.charEnabled,
      userEnabled: !!raw.userEnabled
    };
  }

  function getStore() {
    return global.miyaChatStore || null;
  }

  function describeEntityDisplayAvatar(kind, entity, fallbackLabel) {
    var st = getStore();
    var desc = '';
    if (st && entity) {
      if (kind === 'contact' && entity.displayAvatar) desc = trim(entity.displayAvatar.desc);
      if (kind === 'profile' && entity.displayAvatar) desc = trim(entity.displayAvatar.desc);
    }
    if (desc) return desc;
    if (st) {
      if (kind === 'contact' && st.hasContactDisplayAvatarOverride && st.hasContactDisplayAvatarOverride(entity)) {
        return '已换为聊天专用头像（无文字描述）';
      }
      if (kind === 'profile' && st.hasProfileDisplayAvatarOverride && st.hasProfileDisplayAvatarOverride(entity)) {
        return '已换为聊天专用头像（无文字描述）';
      }
    }
    return fallbackLabel;
  }

  function buildChatAvatarContextBlock(chatSettings, contact, profile) {
    var da = (chatSettings && chatSettings.dynamicAvatar) || {};
    if (!da.charEnabled && !da.userEnabled) return '';
    var roleName = trim((contact && (contact.remarkName || contact.name)) || 'Ta') || 'Ta';
    var userName = trim((profile && profile.name) || '用户') || '用户';
    var lines = ['【聊天头像·全局展示】'];
    lines.push(
      '- ' +
        roleName +
        ' 当前聊天头像：' +
        describeEntityDisplayAvatar('contact', contact, '与联系人档案头像一致')
    );
    lines.push(
      '- ' +
        userName +
        ' 当前聊天头像：' +
        describeEntityDisplayAvatar(
          'profile',
          profile,
          '与面具「' + userName + '」档案头像一致'
        )
    );
    lines.push('以下换头像指令单独成行，不会显示为聊天气泡；不影响联系人档案处的头像；更换后在所有会话（含群聊）与通知中生效。');
    if (da.charEnabled) {
      lines.push(
        roleName +
          ' 可随心意随时换自己的聊天头像（有合适素材时）：喜欢用户发的照片时，用「换头像-用户#1」（#1=最近一张用户照片，#2 依次更早）；或用「换头像-自己#1」换为自己发过的照片；或用「换头像-相册#1」换为用户相册已同步照片；或用「换头像-生图-详细画面描述」生成新头像。可在行末加「｜说明」补充你为何换、头像内容是什么。'
      );
      lines.push(
        '换头像须单独输出指令行才生效；禁止只在对话里说「换了头像」而不输出指令。更换成功后界面头像会立即更新，并可能在对话中注入系统记录。'
      );
    }
    if (da.userEnabled) {
      lines.push(
        roleName +
          ' 可为用户换聊天头像：须用「给用户换头像-相册#1」（用户相册已同步照片，#N=相册编号；勿写成「换头像-相册#1」，后者是换你自己头像）；行末可加「｜说明」。更换成功后系统会注入记录，请知晓是你为用户换的。须符合情境与人设，不可每轮都换。'
      );
    }
    return lines.join('\n');
  }

  function isPhotoMessage(m) {
    if (!m || m.deleted || m.type !== 'image') return false;
    if (m.imageKind === 'text') return false;
    return !!trim(m.imageDataKey);
  }

  function photoDescFromMessage(m) {
    if (!m) return '';
    var vision = trim(m.imageVisionText);
    if (vision) return vision.slice(0, 500);
    var content = trim(m.content || '').replace(/^\[图片\]\s*/, '');
    content = content.replace(/^图片[-－—]\s*/, '');
    return content.slice(0, 500);
  }

  function collectRolePhotos(messages, role) {
    var list = (messages || []).filter(function (m) {
      if (!isPhotoMessage(m)) return false;
      return String(m.role || '') === role;
    });
    list.sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    return list;
  }

  function parseSwapSource(body) {
    var raw = trim(body);
    if (!raw) return null;
    var note = '';
    var pipe = raw.indexOf('｜');
    if (pipe < 0) pipe = raw.indexOf('|');
    if (pipe >= 0) {
      note = trim(raw.slice(pipe + 1));
      raw = trim(raw.slice(0, pipe));
    }
    var genMatch = raw.match(/^生图[-－—]\s*(.+)$/);
    if (genMatch) {
      return { kind: 'gen', scene: trim(genMatch[1]).slice(0, 1200), note: note };
    }
    var userMatch = raw.match(/^用户(?:最近|#(\d+))$/);
    if (userMatch) {
      var ui = userMatch[1] ? parseInt(userMatch[1], 10) : 1;
      return { kind: 'userPhoto', index: Math.max(1, ui || 1), note: note };
    }
    var selfMatch = raw.match(/^自己(?:最近|#(\d+))$/);
    if (selfMatch) {
      var si = selfMatch[1] ? parseInt(selfMatch[1], 10) : 1;
      return { kind: 'selfPhoto', index: Math.max(1, si || 1), note: note };
    }
    var albumMatch = raw.match(/^相册(?:照片|图片|图)?\s*(?:第\s*)?[＃#]?\s*(\d+)\s*(?:张|号)?$/);
    if (albumMatch) {
      return { kind: 'albumPhoto', index: Math.max(1, parseInt(albumMatch[1], 10) || 1), note: note };
    }
    var userAlbumMatch = raw.match(/^用户相册\s*[＃#]?\s*(\d+)$/);
    if (userAlbumMatch) {
      return { kind: 'albumPhoto', index: Math.max(1, parseInt(userAlbumMatch[1], 10) || 1), note: note };
    }
    var nthMatch = raw.match(/^第\s*(\d+)\s*(?:张|号)$/);
    if (nthMatch) {
      return { kind: 'albumPhoto', index: Math.max(1, parseInt(nthMatch[1], 10) || 1), note: note };
    }
    var hashOnly = raw.match(/^[＃#](\d+)$/);
    if (hashOnly) {
      return { kind: 'albumPhoto', index: Math.max(1, parseInt(hashOnly[1], 10) || 1), note: note };
    }
    var numOnly = raw.match(/^(\d+)$/);
    if (numOnly) {
      return { kind: 'albumPhoto', index: Math.max(1, parseInt(numOnly[1], 10) || 1), note: note };
    }
    return null;
  }

  function invalidateAvatarUi(contactId, profileId) {
    if (global.miyaChatApp && global.miyaChatApp.invalidateChatAvatarCache) {
      global.miyaChatApp.invalidateChatAvatarCache(null, contactId, profileId);
    }
    if (global.miyaChatRoom && typeof global.miyaChatRoom.refreshAllAvatars === 'function') {
      global.miyaChatRoom.refreshAllAvatars();
    } else if (global.miyaChatRoom && typeof global.miyaChatRoom.refresh === 'function') {
      global.miyaChatRoom.refresh({ forceAvatars: true });
    }
    if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
      global.miyaChatApp.refreshLists({ force: true });
    }
    if (global.miyaChatMoments && typeof global.MiyaChatMoments.refreshFeedUI === 'function') {
      global.MiyaChatMoments.refreshFeedUI();
    }
    if (global.miyaChatApp && typeof global.miyaChatApp.refreshProfileUI === 'function') {
      global.miyaChatApp.refreshProfileUI();
    }
  }

  function mergeDisplayPatch(targetKind, contactId, profileId, patch) {
    var st = getStore();
    if (!st) return Promise.resolve(false);
    var chain;
    if (targetKind === 'contact') {
      if (!contactId || typeof st.mergeContactDisplayAvatar !== 'function') {
        return Promise.resolve(false);
      }
      chain = st.mergeContactDisplayAvatar(contactId, patch);
    } else {
      if (!profileId || typeof st.mergeProfileDisplayAvatar !== 'function') {
        return Promise.resolve(false);
      }
      chain = st.mergeProfileDisplayAvatar(profileId, patch);
    }
    return chain.then(function () {
      invalidateAvatarUi(contactId, profileId);
      return true;
    });
  }

  function resolvePhotoSwap(source, messages, recentMsgs) {
    var merged = (messages || []).slice();
    (recentMsgs || []).forEach(function (m) {
      if (m && m.id) merged.push(m);
    });
    var role = source.kind === 'userPhoto' ? 'user' : 'assistant';
    var photos = collectRolePhotos(merged, role);
    var idx = Math.max(1, Number(source.index) || 1) - 1;
    var hit = photos[idx];
    if (!hit) return null;
    var desc = trim(source.note) || photoDescFromMessage(hit);
    return {
      blobId: trim(hit.imageDataKey),
      desc: desc,
      sourceMsgId: hit.id || ''
    };
  }

  function applyGenSwap(contactId, profileId, kind, scene, note) {
    var ig = global.MiyaImageGen;
    if (!ig || typeof ig.generateImageForScene !== 'function' || !ig.isGlobalEnabled || !ig.isGlobalEnabled()) {
      return Promise.resolve(false);
    }
    var sceneDesc = trim(scene);
    if (!sceneDesc) return Promise.resolve(false);
    return ig
      .generateImageForScene(contactId, sceneDesc, { skipContactCheck: true, size: '512x512' })
      .then(function (blob) {
        if (!blob) return false;
        var st = getStore();
        if (!st || typeof st.storeMediaBlob !== 'function') return false;
        return st.storeMediaBlob(blob, 'chat-avatar').then(function (blobId) {
          var desc = trim(note) || sceneDesc.slice(0, 500);
          return mergeDisplayPatch(kind, contactId, profileId, {
            url: '',
            blobId: blobId,
            desc: desc,
            sourceMsgId: ''
          });
        });
      })
      .catch(function () {
        return false;
      });
  }

  function resolveAlbumSwap(source, profileId, contactId) {
    var alb = global.MiyaChatAlbum;
    if (!alb || source.kind !== 'albumPhoto' || typeof alb.resolveAlbumPhotoForSwap !== 'function') {
      return null;
    }
    return alb.resolveAlbumPhotoForSwap(profileId, source.index, contactId);
  }

  function applyOneSwap(contactId, profileId, targetKind, source, messages, recentMsgs, chatId) {
    if (!source) return Promise.resolve(false);
    if (targetKind === 'profile' && source.kind !== 'albumPhoto') return Promise.resolve(false);
    if (source.kind === 'gen') {
      return applyGenSwap(contactId, profileId, targetKind, source.scene, source.note);
    }
    var resolved = source.kind === 'albumPhoto'
      ? resolveAlbumSwap(source, profileId, contactId)
      : resolvePhotoSwap(source, messages, recentMsgs);
    if (!resolved || !resolved.blobId) return Promise.resolve(false);
    return mergeDisplayPatch(targetKind, contactId, profileId, {
      url: '',
      blobId: resolved.blobId,
      desc: resolved.desc,
      sourceMsgId: resolved.sourceMsgId || ''
    }).then(function (ok) {
      if (!ok || source.kind !== 'albumPhoto') return ok;
      var alb = global.MiyaChatAlbum;
      if (!alb || typeof alb.recordAvatarChangeInChat !== 'function' || !chatId) return ok;
      var st = getStore();
      var contact = st && st.findContact ? st.findContact(contactId) : null;
      var profile = st && st.getProfiles
        ? (st.getProfiles().find(function (p) { return p.id === profileId; }) || null)
        : null;
      return alb
        .recordAvatarChangeInChat(chatId, {
          target: targetKind,
          albumIndex: resolved.albumIndex || source.index,
          desc: resolved.desc,
          note: source.note,
          roleName: contact && (contact.remarkName || contact.name),
          userName: profile && profile.name
        })
        .then(function () { return ok; })
        .catch(function () { return ok; });
    });
  }

  function recordAvatarSwapFailure(chatId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var st = getStore();
    if (!st || !chatId || typeof st.addMessage !== 'function') return Promise.resolve();
    var roleName = trim(opts.roleName) || 'Ta';
    var rawCmd = trim(opts.rawCmd);
    var reason = trim(opts.reason) || '素材不可用或未同步';
    var content =
      '【相册·换头像·未生效】' +
      roleName +
      '的换头像指令未能执行' +
      (rawCmd ? '（' + rawCmd + '）' : '') +
      '：' +
      reason +
      '。须使用正确格式单独成行；换自己用「换头像-相册#N」，给用户用「给用户换头像-相册#N」。';
    return st.addMessage(chatId, {
      role: 'system',
      type: 'text',
      content: content,
      systemKind: 'album-avatar-change-failed',
      excludedFromContext: false,
      createdAt: Date.now()
    }).then(function () {
      if (
        global.miyaChatRoom &&
        typeof global.miyaChatRoom.getOpenChatId === 'function' &&
        global.miyaChatRoom.getOpenChatId() === chatId &&
        typeof global.miyaChatRoom.refresh === 'function'
      ) {
        global.miyaChatRoom.refresh({ forceAvatars: true });
      }
    });
  }

  function applySwaps(chatId, swaps, recentMsgs, contactId, profileId) {
    if (!chatId || !swaps || !swaps.length) return Promise.resolve([]);
    var st = getStore();
    if (!st) return Promise.resolve([]);
    var messages = st.getMessages(chatId).filter(function (m) {
      return m && !m.deleted;
    });
    var contact = st.findContact ? st.findContact(contactId) : null;
    var profile = st.getProfiles
      ? (st.getProfiles().find(function (p) { return p.id === profileId; }) || null)
      : null;
    var chain = Promise.resolve([]);
    var applied = [];
    swaps.forEach(function (op) {
      chain = chain.then(function () {
        return applyOneSwap(contactId, profileId, op.target, op.source, messages, recentMsgs, chatId).then(function (ok) {
          if (ok) {
            applied.push(op);
            return;
          }
          var reason =
            op.source && op.source.kind === 'albumPhoto'
              ? '相册第' + (op.source.index || 1) + '张不可用、未识别或未同步给当前角色'
              : '素材不可用或格式有误';
          return recordAvatarSwapFailure(chatId, {
            roleName: contact && (contact.remarkName || contact.name),
            rawCmd: op.raw,
            reason: reason
          });
        });
      });
    });
    return chain.then(function () {
      return applied;
    });
  }

  function buildOnlineRulesAddon(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var roleName = trim(opts.roleName) || '角色';
    var lines = [];
    if (opts.charAvatarSwapEnabled) {
      lines.push(
        '',
        '· 换自己的聊天头像（单独一行，不显示为气泡）：换头像-用户#1｜可选说明（#1=用户最近一张照片；换头像-自己#1=自己最近照片；换头像-相册#1=用户相册已同步照片；换头像-生图-画面描述=生成头像）。你可随心意随时换（有合适素材时）；须单独输出指令行才生效，禁止只在对话里说换了而不输出指令；更换后在所有会话中生效。'
      );
    }
    if (opts.userAvatarSwapEnabled) {
      lines.push(
        '',
        '· 为用户换聊天头像（单独一行，勿写成换头像-相册）：给用户换头像-相册#1｜说明（#1=用户相册已同步照片编号；成功后系统会记录为你执行的操作）。须符合情境与人设。'
      );
    }
    if (!lines.length) return '';
    return '【聊天头像更换·' + roleName + '】' + lines.join('');
  }

  global.MiyaChatDynamicAvatar = {
    normalizeDynamicAvatar: normalizeDynamicAvatar,
    buildChatAvatarContextBlock: buildChatAvatarContextBlock,
    buildOnlineRulesAddon: buildOnlineRulesAddon,
    parseSwapSource: parseSwapSource,
    applySwaps: applySwaps,
    describeEntityDisplayAvatar: describeEntityDisplayAvatar
  };
})(typeof window !== 'undefined' ? window : globalThis);
