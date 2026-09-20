/**
 * miya-couple-whisper.js — 深夜私语 · UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var FEATURE_LABELS = {
    confide: '匿名倾诉',
    bottle: '心事漂流瓶',
    company: '声音陪伴',
    diary: '秘密日记'
  };

  var TAB_LABELS = {
    discover: '发现',
    favorite: '收藏',
    profile: '我的'
  };

  var state = {
    contactId: '',
    menuOpen: false,
    playing: false,
    avatarUrls: { user: '', char: '' },
    activeTab: 'home',
    session: null,
    generating: false,
    portraitUrls: { user: '', char: '' },
    bgUrl: '',
    roomSettings: null,
    replayFavId: ''
  };

  function store() { return global.miyaCoupleStore || null; }
  function chatStore() { return global.miyaChatStore || null; }
  function wpStore() { return global.miyaCoupleWhisperStore || null; }
  function wpEngine() { return global.miyaCoupleWhisperEngine || null; }

  function toast(msg) {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
      global.miyaCoupleApp.toast(msg);
      return;
    }
    var el = $('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function confirmDialog(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(window.confirm(String((opts.title || '') + '\n' + (opts.message || ''))));
  }

  function promptDialog(opts) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt(opts);
    }
    var v = window.prompt(String(opts.message || opts.title || ''), String(opts.defaultValue || ''));
    return Promise.resolve(v);
  }

  function setViewVisible(show) {
    var view = $('cp-view-whisper');
    var app = $('miya-couple-app');
    if (view) view.hidden = !show;
    if (app) {
      app.classList.toggle('is-whisper', !!show);
      if (!show) app.classList.remove('is-whisper-room');
    }
    if (!show) closeRoom();
  }

  function closeMenu() {
    state.menuOpen = false;
    var pop = $('cp-whisper-menu-pop');
    if (pop) pop.hidden = true;
  }

  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    var pop = $('cp-whisper-menu-pop');
    if (pop) pop.hidden = !state.menuOpen;
  }

  function getSpaceNames(contactId) {
    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    var cs = chatStore();
    var contact = null;
    if (cs && contactId) {
      contact = cs.findContact ? cs.findContact(contactId) : null;
      if (!contact) {
        contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
      }
    }
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (!profile && cs && cs.getActiveProfile) profile = cs.getActiveProfile();
    return { contact: contact, profile: profile };
  }

  function resolveAvatars(contactId) {
    var names = getSpaceNames(contactId);
    var cs = chatStore();
    state.avatarUrls = { user: '', char: '' };

    function applyAvatar(el, url, fallbackChar) {
      if (!el) return;
      if (url) {
        el.src = url;
        el.alt = el.getAttribute('data-name') || el.alt || '';
      } else {
        el.removeAttribute('src');
      }
    }

    var charUrl = '';
    var userUrl = '';
    var userEl = $('cp-whisper-av-user');
    var charEl = $('cp-whisper-av-char');
    var userName = names.profile && names.profile.name ? trim(names.profile.name) : '我';
    var charName = names.contact && names.contact.name ? trim(names.contact.name) : 'TA';

    if (userEl) {
      userEl.alt = userName;
      userEl.setAttribute('data-name', userName);
    }
    if (charEl) {
      charEl.alt = charName;
      charEl.setAttribute('data-name', charName);
    }

    if (names.profile) {
      var p = names.profile;
      userUrl = trim(p.avatarUrl || p.avatar);
      if (!userUrl && cs && trim(p.avatarId || p.avatarBlobId) && typeof cs.getAvatarUrl === 'function') {
        cs.getAvatarUrl(p.avatarId || p.avatarBlobId).then(function (url) {
          state.avatarUrls.user = url || '';
          applyAvatar(userEl, url);
        }).catch(function () {});
      }
    }

    if (names.contact) {
      var c = names.contact;
      charUrl = trim(c.avatar);
      if (!charUrl && cs && trim(c.avatarBlobId) && typeof cs.getAvatarUrl === 'function') {
        cs.getAvatarUrl(c.avatarBlobId).then(function (url) {
          state.avatarUrls.char = url || '';
          applyAvatar(charEl, url);
        }).catch(function () {});
      }
    }

    applyAvatar(userEl, userUrl);
    applyAvatar(charEl, charUrl);
  }

  function syncPlayer() {
    var player = $('cp-whisper-player');
    var btn = $('cp-whisper-play');
    if (player) player.classList.toggle('is-playing', state.playing);
    if (btn) btn.innerHTML = state.playing
      ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="6" width="3" height="12" fill="currentColor"/><rect x="14" y="6" width="3" height="12" fill="currentColor"/></svg>暂停'
      : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7l8 5-8 5V7z" fill="currentColor"/></svg>播放';
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('[data-cp-whisper-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-cp-whisper-tab') === tab);
    });
    var home = $('cp-whisper-panel-home');
    var fav = $('cp-whisper-panel-favorite');
    if (home) {
      home.hidden = tab !== 'home';
      home.classList.toggle('is-active', tab === 'home');
    }
    if (fav) {
      fav.hidden = tab !== 'favorite';
      fav.classList.toggle('is-active', tab === 'favorite');
    }
    if (tab === 'favorite') renderFavorites();
  }

  function blobUrl(blobId) {
    var cs = chatStore();
    if (!cs || !blobId) return Promise.resolve('');
    if (typeof cs.getCachedBlobUrl === 'function') {
      var cached = cs.getCachedBlobUrl(blobId);
      if (cached) return Promise.resolve(cached);
    }
    if (typeof cs.getBlobUrl === 'function') {
      return cs.getBlobUrl(blobId).catch(function () { return ''; });
    }
    if (typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(blobId).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function uploadImage(file) {
    var cs = chatStore();
    if (!cs || !file) return Promise.reject(new Error('no_file'));
    if (typeof cs.storeMediaBlob === 'function') {
      return cs.storeMediaBlob(file, 'chat');
    }
    return Promise.reject(new Error('store_missing'));
  }

  function showRoomSheet(show) {
    var sheet = $('cp-whisper-room-sheet');
    if (sheet) sheet.hidden = !show;
  }

  function showSettings(show) {
    var el = $('cp-whisper-settings');
    if (el) el.hidden = !show;
  }

  function loadSettingsForm() {
    if (!wpStore() || !state.contactId) return;
    state.roomSettings = wpStore().getRoomSettings(state.contactId);
    var rs = state.roomSettings;
    var styleEl = $('cp-whisper-style');
    if (styleEl) styleEl.value = rs.customStyleGuide || '';
    var toggle = $('cp-whisper-auto-voice');
    if (toggle) {
      toggle.classList.toggle('is-on', !!rs.autoVoice);
      toggle.setAttribute('aria-checked', rs.autoVoice ? 'true' : 'false');
    }
    renderSettingsPreviews(rs);
  }

  function setPreviewFrame(frameId, url, isBg) {
    var frame = $(frameId);
    if (!frame) return;
    frame.classList.toggle('has-img', !!url);
    var old = frame.querySelector('img');
    if (old) old.remove();
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      frame.insertBefore(img, frame.firstChild);
    }
    var ph = frame.querySelector('.cp-wp-upload__ph');
    if (ph) ph.hidden = !!url;
  }

  function renderSettingsPreviews(rs) {
    Promise.all([
      rs.charPortraitBlobId ? blobUrl(rs.charPortraitBlobId) : Promise.resolve(''),
      rs.userPortraitBlobId ? blobUrl(rs.userPortraitBlobId) : Promise.resolve(''),
      rs.bgBlobId ? blobUrl(rs.bgBlobId) : Promise.resolve('')
    ]).then(function (urls) {
      setPreviewFrame('cp-whisper-prev-char', urls[0]);
      setPreviewFrame('cp-whisper-prev-user', urls[1]);
      setPreviewFrame('cp-whisper-prev-bg', urls[2], true);
    });
  }

  function saveSettingsForm() {
    if (!wpStore() || !state.contactId) return;
    var styleEl = $('cp-whisper-style');
    var toggle = $('cp-whisper-auto-voice');
    var patch = {
      customStyleGuide: styleEl ? trim(styleEl.value) : '',
      autoVoice: toggle ? toggle.classList.contains('is-on') : false
    };
    if (state.roomSettings) {
      patch.charPortraitBlobId = state.roomSettings.charPortraitBlobId;
      patch.userPortraitBlobId = state.roomSettings.userPortraitBlobId;
      patch.bgBlobId = state.roomSettings.bgBlobId;
    }
    state.roomSettings = wpStore().saveRoomSettings(state.contactId, patch);
    toast('房间设置已保存');
    showSettings(false);
  }

  function handleUpload(inputId, field) {
    var input = $(inputId);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file || !wpStore() || !state.contactId) return;
      uploadImage(file).then(function (blobId) {
        var patch = {};
        patch[field] = blobId;
        state.roomSettings = wpStore().saveRoomSettings(state.contactId, patch);
        renderSettingsPreviews(state.roomSettings);
        toast('已上传');
      }).catch(function () {
        toast('上传失败');
      });
    });
  }

  function resolveRoomAssets() {
    var rs = state.roomSettings || (wpStore() ? wpStore().getRoomSettings(state.contactId) : null);
    var names = getSpaceNames(state.contactId);
    state.portraitUrls = { user: '', char: '' };
    state.bgUrl = '';

    var promises = [];
    var charPortrait = rs && rs.charPortraitBlobId;
    var userPortrait = rs && rs.userPortraitBlobId;
    var bgBlob = rs && rs.bgBlobId;

    promises.push(
      charPortrait
        ? blobUrl(charPortrait)
        : Promise.resolve(state.avatarUrls.char || '')
    );
    promises.push(
      userPortrait
        ? blobUrl(userPortrait)
        : Promise.resolve(state.avatarUrls.user || '')
    );
    promises.push(bgBlob ? blobUrl(bgBlob) : Promise.resolve(''));

    return Promise.all(promises).then(function (urls) {
      state.portraitUrls.char = urls[0] || '';
      state.portraitUrls.user = urls[1] || '';
      state.bgUrl = urls[2] || '';
    });
  }

  function applyRoomBackground() {
    var bg = $('cp-whisper-room-bg');
    if (!bg) return;
    if (state.bgUrl) {
      bg.classList.add('has-custom');
      bg.style.backgroundImage = 'url("' + state.bgUrl.replace(/"/g, '\\"') + '")';
    } else {
      bg.classList.remove('has-custom');
      bg.style.backgroundImage = '';
    }
  }

  function showRoom(show) {
    var room = $('cp-whisper-room');
    var app = $('miya-couple-app');
    if (room) room.hidden = !show;
    if (app) app.classList.toggle('is-whisper-room', !!show);
  }

  function setGenerating(on) {
    state.generating = !!on;
    var el = $('cp-whisper-room-gen');
    if (el) el.hidden = !on;
  }

  function currentLine() {
    if (!state.session || !state.session.lines) return null;
    var idx = state.session.lineIndex || 0;
    return state.session.lines[idx] || null;
  }

  function getWhisperContext() {
    var cs = chatStore();
    if (!cs || !state.contactId) return null;
    var sp = store() ? store().getSpace(state.contactId) : null;
    var contact = cs.findContact ? cs.findContact(state.contactId) : null;
    if (!contact) return null;
    var pid = sp && sp.profileId ? trim(sp.profileId) : '';
    if (!pid) pid = trim(contact.defaultProfileId) || '';
    if (!pid && cs.getActiveProfile) {
      var ap = cs.getActiveProfile();
      if (ap && ap.id) pid = trim(ap.id);
    }
    var chat = cs.findChatByContact ? cs.findChatByContact(state.contactId, pid) : null;
    if (!chat && cs.findChatByContact) {
      chat = cs.findChatByContact(state.contactId, '');
    }
    return {
      contact: contact,
      chat: chat,
      chatId: chat && chat.id ? chat.id : '',
      profileId: pid
    };
  }

  function getChatId() {
    var ctx = getWhisperContext();
    return ctx && ctx.chatId ? ctx.chatId : '';
  }

  function ensureLineId(line) {
    if (!line) return line;
    if (!line.id && wpStore()) {
      line.id = wpStore().uid('wpl');
      persistSession();
    }
    return line;
  }

  function playCharLine(line, playBtn, auto) {
    if (!line || line.type !== 'char') return;
    var tts = global.MiyaChatVoiceTts;
    if (!tts) {
      toast('语音模块未加载');
      return;
    }
    ensureLineId(line);
    var ctx = getWhisperContext();
    var chatId = ctx && ctx.chatId ? ctx.chatId : '';
    if (typeof tts.playWhisperLine === 'function') {
      tts.playWhisperLine({
        text: line.text,
        chatId: chatId,
        contactId: state.contactId,
        sessionId: state.session && state.session.id,
        lineId: line.id,
        hostEl: $('cp-whisper-room-dialogue'),
        playBtn: playBtn || $('cp-whisper-room-voice')
      });
      return;
    }
    if (typeof tts.playPlainText === 'function') {
      tts.playPlainText(line.text, chatId, state.contactId);
      return;
    }
    toast('语音播放未就绪');
  }

  function renderRoomLine() {
    var line = currentLine();
    var nameRow = $('cp-whisper-room-name-row');
    var nameEl = $('cp-whisper-room-name');
    var voiceBtn = $('cp-whisper-room-voice');
    var textEl = $('cp-whisper-room-text');
    var portraitWrap = $('cp-whisper-room-portrait');
    var portraitImg = $('cp-whisper-room-portrait-img');
    var tapHint = $('cp-whisper-room-tap');
    var dialogue = $('cp-whisper-room-dialogue');
    var choices = $('cp-whisper-room-choices');

    if (!line) {
      if (state.session && state.session.awaitingChoice) {
        showChoices();
        return;
      }
      if (textEl) textEl.textContent = '';
      return;
    }

    if (choices) choices.hidden = true;
    if (dialogue) dialogue.hidden = false;

    if (line.type === 'narration') {
      if (nameRow) nameRow.hidden = true;
      if (voiceBtn) voiceBtn.hidden = true;
      if (portraitWrap) portraitWrap.hidden = true;
      if (textEl) {
        textEl.textContent = line.text;
        textEl.classList.add('is-narration');
      }
    } else if (line.type === 'char') {
      ensureLineId(line);
      if (nameRow) nameRow.hidden = false;
      if (nameEl) {
        nameEl.hidden = false;
        nameEl.textContent = line.speakerName || getSpaceNames(state.contactId).contact.name || 'TA';
      }
      if (voiceBtn) voiceBtn.hidden = false;
      if (textEl) {
        textEl.textContent = line.text;
        textEl.classList.remove('is-narration');
      }
      if (portraitWrap && portraitImg) {
        var charImg = state.portraitUrls.char || state.avatarUrls.char;
        if (charImg) {
          portraitWrap.hidden = false;
          portraitImg.src = charImg;
          portraitImg.alt = nameEl ? nameEl.textContent : '';
          portraitImg.classList.toggle('is-avatar-fallback', !state.portraitUrls.char);
        } else {
          portraitWrap.hidden = true;
        }
      }
      maybeAutoVoice(line);
    } else if (line.type === 'user') {
      if (nameRow) nameRow.hidden = false;
      if (nameEl) {
        nameEl.hidden = false;
        nameEl.textContent = '我';
      }
      if (voiceBtn) voiceBtn.hidden = true;
      if (textEl) {
        textEl.textContent = line.text;
        textEl.classList.remove('is-narration');
      }
      if (portraitWrap && portraitImg) {
        var userImg = state.portraitUrls.user || state.avatarUrls.user;
        if (userImg) {
          portraitWrap.hidden = false;
          portraitImg.src = userImg;
          portraitImg.alt = '我';
          portraitImg.classList.toggle('is-avatar-fallback', !state.portraitUrls.user);
        } else {
          portraitWrap.hidden = true;
        }
      }
    }

    var atEnd = state.session.lineIndex >= state.session.lines.length - 1;
    if (tapHint) tapHint.hidden = !atEnd || state.session.awaitingChoice;
  }

  function maybeAutoVoice(line) {
    var rs = state.roomSettings || (wpStore() ? wpStore().getRoomSettings(state.contactId) : null);
    if (!rs || !rs.autoVoice || !line) return;
    playCharLine(line, $('cp-whisper-room-voice'), true);
  }

  function showChoices() {
    var dialogue = $('cp-whisper-room-dialogue');
    var choices = $('cp-whisper-room-choices');
    var list = $('cp-whisper-room-choices-list');
    var portraitWrap = $('cp-whisper-room-portrait');
    if (dialogue) dialogue.hidden = true;
    if (portraitWrap) portraitWrap.hidden = true;
    if (!choices || !list || !state.session) return;

    choices.hidden = false;
    var opts = (state.session.lastChoices || []).slice(0, 3);
    while (opts.length < 3) opts.push('…');
    var html = opts.map(function (opt, i) {
      return '<button type="button" class="cp-wp-room__choice" data-cp-wp-choice="' + i + '">' + esc(opt) + '</button>';
    }).join('');
    html += '<button type="button" class="cp-wp-room__choice cp-wp-room__choice--custom" data-cp-wp-choice="custom">自定义…</button>';
    list.innerHTML = html;
  }

  function advanceLine() {
    if (state.generating || !state.session) return;
    if (state.session.awaitingChoice) return;

    var atEnd = state.session.lineIndex >= state.session.lines.length - 1;
    if (atEnd) {
      state.session.awaitingChoice = true;
      persistSession();
      showChoices();
      return;
    }

    state.session.lineIndex += 1;
    persistSession();
    renderRoomLine();
  }

  function persistSession() {
    if (wpStore() && state.contactId && state.session) {
      wpStore().saveActiveSession(state.contactId, state.session);
    }
  }

  function appendParsed(parsed, lineIndex) {
    if (!state.session || !parsed) return;
    (parsed.lines || []).forEach(function (l) {
      state.session.lines.push({
        id: wpStore() ? wpStore().uid('wpl') : 'wpl_' + Date.now(),
        type: l.type,
        text: l.text,
        speakerName: l.speakerName
      });
    });
    if (parsed.title) state.session.title = parsed.title;
    state.session.lastChoices = parsed.choices || [];
    state.session.awaitingChoice = false;
    state.session.lineIndex = lineIndex != null ? lineIndex : 0;
    persistSession();
    renderRoomLine();
  }

  function startOpeningGeneration() {
    var eng = wpEngine();
    if (!eng || !state.contactId) return;
    var ctx = eng.resolveChatForContact(state.contactId);
    if (!ctx || !ctx.contact) {
      toast('找不到角色');
      return;
    }

    state.roomSettings = wpStore() ? wpStore().getRoomSettings(state.contactId) : null;
    state.session = {
      id: wpStore() ? wpStore().uid('wps') : 'wps_' + Date.now(),
      contactId: state.contactId,
      charName: trim(ctx.contact.name) || 'TA',
      profileName: ctx.profile && ctx.profile.name ? trim(ctx.profile.name) : '我',
      lines: [],
      status: 'active',
      lineIndex: 0,
      awaitingChoice: false,
      lastChoices: [],
      title: '深夜私语',
      createdAt: Date.now(),
      endedAt: 0
    };
    persistSession();

    resolveRoomAssets().then(function () {
      applyRoomBackground();
      showRoom(true);
      setGenerating(true);
      return eng.runCompletion(ctx, state.session, '', {
        isOpening: true,
        roomSettings: state.roomSettings
      });
    }).then(function (parsed) {
      appendParsed(parsed);
    }).catch(function (err) {
      toast(eng.fmtApiErr(err));
      closeRoom();
    }).finally(function () {
      setGenerating(false);
    });
  }

  function onUserChoice(choiceText) {
    if (!choiceText || state.generating || !state.session) return;
    var eng = wpEngine();
    var ctx = eng ? eng.resolveChatForContact(state.contactId) : null;
    if (!eng || !ctx) return;

    state.session.lines.push({
      id: wpStore() ? wpStore().uid('wpl') : 'wpl_' + Date.now(),
      type: 'user',
      text: choiceText,
      speakerName: '我'
    });
    var userLineIdx = state.session.lines.length - 1;
    state.session.awaitingChoice = false;
    persistSession();

    setGenerating(true);
    var choicesEl = $('cp-whisper-room-choices');
    if (choicesEl) choicesEl.hidden = true;
    var dialogue = $('cp-whisper-room-dialogue');
    if (dialogue) dialogue.hidden = true;
    var portraitWrap = $('cp-whisper-room-portrait');
    if (portraitWrap) portraitWrap.hidden = true;

    eng.runCompletion(ctx, state.session, choiceText, {
      isOpening: false,
      roomSettings: state.roomSettings
    }).then(function (parsed) {
      if (dialogue) dialogue.hidden = false;
      appendParsed(parsed, userLineIdx);
    }).catch(function (err) {
      toast(eng.fmtApiErr(err));
      state.session.awaitingChoice = true;
      if (dialogue) dialogue.hidden = false;
      showChoices();
    }).finally(function () {
      setGenerating(false);
    });
  }

  function endSession() {
    if (!state.session) {
      closeRoom();
      return;
    }
    confirmDialog({
      title: '结束私语',
      message: '结束后的记录会永久保存在收藏里，确定结束吗？'
    }).then(function (ok) {
      if (!ok) return;
      state.session.status = 'ended';
      state.session.endedAt = Date.now();
      if (wpStore()) {
        wpStore().addFavorite(state.session);
        wpStore().clearActiveSession(state.contactId);
      }
      toast('已保存至收藏');
      closeRoom();
      if (state.activeTab === 'favorite') renderFavorites();
    });
  }

  function closeRoom() {
    showRoom(false);
    state.session = null;
    setGenerating(false);
    var tts = global.MiyaChatVoiceTts;
    if (tts && typeof tts.stopPlayback === 'function') tts.stopPlayback();
  }

  function renderFavorites() {
    var listEl = $('cp-whisper-fav-list');
    var emptyEl = $('cp-whisper-fav-empty');
    if (!listEl || !wpStore()) return;
    var list = wpStore().listFavorites(state.contactId);
    if (!list.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = list.map(function (f) {
      var date = new Date(f.endedAt || f.createdAt);
      var dateStr = date.getFullYear() + '.' + pad(date.getMonth() + 1) + '.' + pad(date.getDate());
      return '<button type="button" class="cp-wp-fav-item" data-cp-wp-fav="' + esc(f.id) + '">' +
        '<div class="cp-wp-fav-item__meta">' +
          '<span class="cp-wp-fav-item__title">' + esc(f.title || '深夜私语') + '</span>' +
          '<span class="cp-wp-fav-item__sub">' + esc(f.charName || 'TA') + ' · ' + dateStr + ' · ' + (f.lines ? f.lines.length : 0) + ' 句</span>' +
        '</div>' +
        '<span aria-hidden="true">›</span>' +
      '</button>';
    }).join('');
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  var VOICE_PLAY_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7l8 5-8 5V7z" fill="currentColor"/></svg>';

  function playReplayCharLine(fav, line, playBtn) {
    if (!fav || !line || line.type !== 'char') return;
    ensureLineId(line);
    var tts = global.MiyaChatVoiceTts;
    if (!tts) {
      toast('语音模块未加载');
      return;
    }
    var ctx = getWhisperContext();
    if (!ctx || fav.contactId !== state.contactId) {
      var cs = chatStore();
      var contact = cs && cs.findContact ? cs.findContact(fav.contactId) : null;
      var chat = cs && cs.findChatByContact ? cs.findChatByContact(fav.contactId, '') : null;
      ctx = { chatId: chat && chat.id ? chat.id : '', contact: contact };
    }
    var chatId = ctx && ctx.chatId ? ctx.chatId : '';
    if (typeof tts.playWhisperLine !== 'function') {
      toast('语音播放未就绪');
      return;
    }
    tts.playWhisperLine({
      text: line.text,
      chatId: chatId,
      contactId: fav.contactId,
      sessionId: fav.id,
      lineId: line.id,
      hostEl: playBtn && playBtn.closest('.cp-wp-replay__line'),
      playBtn: playBtn
    });
  }

  function openReplay(favId) {
    if (!wpStore()) return;
    var fav = wpStore().getFavorite(favId);
    if (!fav) return;
    state.replayFavId = favId;
    var replay = $('cp-whisper-replay');
    var title = $('cp-whisper-replay-title');
    var body = $('cp-whisper-replay-body');
    if (title) title.textContent = fav.title || '深夜私语';
    if (body) {
      body.innerHTML = (fav.lines || []).map(function (line, idx) {
        if (!line.id) line.id = 'wpl_' + fav.id + '_' + idx;
        var cls = line.type === 'narration' ? ' is-narration' : '';
        var headHtml = '';
        if (line.type === 'char') {
          headHtml =
            '<div class="cp-wp-replay__line-head">' +
              '<div class="cp-wp-replay__line-name">' + esc(line.speakerName || fav.charName || 'TA') + '</div>' +
              '<button type="button" class="cp-wp-replay__voice" data-mq-voice-play data-cp-wp-replay-voice="' + esc(line.id) + '" aria-label="播放">' + VOICE_PLAY_SVG + '</button>' +
            '</div>';
        } else if (line.type === 'user') {
          headHtml = '<div class="cp-wp-replay__line-head"><div class="cp-wp-replay__line-name">我</div></div>';
        }
        return '<div class="cp-wp-replay__line' + cls + '" data-cp-wp-replay-line="' + esc(line.id) + '">' + headHtml +
          '<p class="cp-wp-replay__line-text">' + esc(line.text).replace(/\n/g, '<br>') + '</p></div>';
      }).join('');
      body._wpReplayFav = fav;
    }
    if (replay) replay.hidden = false;
  }

  function closeReplay() {
    state.replayFavId = '';
    var replay = $('cp-whisper-replay');
    if (replay) replay.hidden = true;
  }

  function open(contactId) {
    if (!contactId) return;
    state.contactId = contactId;
    state.playing = false;
    closeMenu();
    closeReplay();
    closeRoom();
    showSettings(false);
    showRoomSheet(false);
    resolveAvatars(contactId);
    syncPlayer();
    setActiveTab('home');
    setViewVisible(true);
  }

  function close() {
    closeRoom();
    closeReplay();
    showSettings(false);
    showRoomSheet(false);
    setViewVisible(false);
    closeMenu();
    state.contactId = '';
    state.playing = false;
    syncPlayer();
  }

  function bindEvents() {
    var menuBtn = $('cp-whisper-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu();
      });
    }

    var backBtn = $('cp-whisper-back');
    if (backBtn) backBtn.addEventListener('click', close);

    var enterBtn = $('cp-whisper-enter-room');
    if (enterBtn) {
      enterBtn.addEventListener('click', function () {
        showRoomSheet(true);
      });
    }

    document.querySelectorAll('[data-cp-wp-sheet-close]').forEach(function (el) {
      el.addEventListener('click', function () { showRoomSheet(false); });
    });

    var actionEnter = $('cp-whisper-action-enter');
    if (actionEnter) {
      actionEnter.addEventListener('click', function () {
        showRoomSheet(false);
        startOpeningGeneration();
      });
    }

    var actionSettings = $('cp-whisper-action-settings');
    if (actionSettings) {
      actionSettings.addEventListener('click', function () {
        showRoomSheet(false);
        loadSettingsForm();
        showSettings(true);
      });
    }

    var settingsBack = $('cp-whisper-settings-back');
    if (settingsBack) settingsBack.addEventListener('click', function () { showSettings(false); });

    var settingsSave = $('cp-whisper-settings-save');
    if (settingsSave) settingsSave.addEventListener('click', saveSettingsForm);

    var autoVoice = $('cp-whisper-auto-voice');
    if (autoVoice) {
      autoVoice.addEventListener('click', function () {
        autoVoice.classList.toggle('is-on');
        autoVoice.setAttribute('aria-checked', autoVoice.classList.contains('is-on') ? 'true' : 'false');
      });
    }

    handleUpload('cp-whisper-up-char', 'charPortraitBlobId');
    handleUpload('cp-whisper-up-user', 'userPortraitBlobId');
    handleUpload('cp-whisper-up-bg', 'bgBlobId');

    var dialogue = $('cp-whisper-room-dialogue');
    if (dialogue) {
      dialogue.addEventListener('click', function (e) {
        if (e.target.closest('#cp-whisper-room-voice')) return;
        advanceLine();
      });
    }

    var voiceBtn = $('cp-whisper-room-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var line = currentLine();
        if (!line || line.type !== 'char') return;
        playCharLine(line, voiceBtn, false);
      });
    }

    var roomEnd = $('cp-whisper-room-end');
    if (roomEnd) roomEnd.addEventListener('click', endSession);

    var choicesList = $('cp-whisper-room-choices-list');
    if (choicesList) {
      choicesList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-wp-choice]');
        if (!btn || state.generating) return;
        var key = btn.getAttribute('data-cp-wp-choice');
        if (key === 'custom') {
          promptDialog({
            title: '自定义回复',
            message: '你想说什么？',
            defaultValue: ''
          }).then(function (text) {
            text = trim(text);
            if (text) onUserChoice(text);
          });
          return;
        }
        var idx = parseInt(key, 10);
        var opt = state.session && state.session.lastChoices ? state.session.lastChoices[idx] : '';
        if (opt) onUserChoice(opt);
      });
    }

    var favList = $('cp-whisper-fav-list');
    if (favList) {
      favList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-wp-fav]');
        if (!btn) return;
        openReplay(btn.getAttribute('data-cp-wp-fav'));
      });
    }

    var replayBack = $('cp-whisper-replay-back');
    if (replayBack) replayBack.addEventListener('click', closeReplay);

    var replayBody = $('cp-whisper-replay-body');
    if (replayBody) {
      replayBody.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-wp-replay-voice]');
        if (!btn || !replayBody._wpReplayFav) return;
        e.stopPropagation();
        var lineId = btn.getAttribute('data-cp-wp-replay-voice');
        var fav = replayBody._wpReplayFav;
        var line = (fav.lines || []).find(function (l) { return l && l.id === lineId; });
        if (line) playReplayCharLine(fav, line, btn);
      });
    }

    var playBtn = $('cp-whisper-play');
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        state.playing = !state.playing;
        syncPlayer();
      });
    }

    document.querySelectorAll('[data-cp-whisper-feature]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var feat = btn.getAttribute('data-cp-whisper-feature');
        toast((FEATURE_LABELS[feat] || feat) + ' · 即将上线');
      });
    });

    document.querySelectorAll('[data-cp-whisper-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-cp-whisper-tab');
        if (tab === 'home' || tab === 'favorite') {
          closeReplay();
          setActiveTab(tab);
          return;
        }
        toast((TAB_LABELS[tab] || tab) + ' · 即将上线');
      });
    });

    document.addEventListener('click', function (e) {
      if (!state.menuOpen) return;
      if (e.target.closest('#cp-whisper-menu') || e.target.closest('#cp-whisper-menu-pop')) return;
      closeMenu();
    });
  }

  bindEvents();

  global.miyaCoupleWhisper = {
    open: open,
    close: close
  };
})(typeof window !== 'undefined' ? window : global);
