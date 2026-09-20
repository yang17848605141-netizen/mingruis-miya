/**
 * miya-fun-sayguess-app.js — 你说我猜 · 完整对局 UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    bound: false,
    page: 'hub',
    toastTimer: 0,
    bankId: '',
    sessionId: '',
    selected: {},
    profileId: '',
    rounds: 5,
    mode: 'user_lead',
    prizes: { first: '', second: '', third: '' },
    generating: false,
    moveWord: '',
    moveFromBankId: '',
    sendSelected: {}
  };

  function store() { return global.miyaFunSayGuessStore; }
  function bridge() { return global.miyaFunSayGuessBridge; }
  function chatStore() { return global.miyaChatStore; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('sg-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2200);
  }

  function setBusy(on, text) {
    state.generating = !!on;
    var ov = $('sg-busy');
    if (!ov) return;
    ov.classList.toggle('is-on', !!on);
    ov.setAttribute('aria-hidden', on ? 'false' : 'true');
    var tx = $('sg-busy-text');
    if (tx) tx.textContent = text || '生成中…';
  }

  function setPage(name) {
    state.page = name;
    var root = $('miya-fun-sayguess');
    if (!root) return;
    root.querySelectorAll('.sg-page').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-sg-page') === name);
    });
  }

  function listContacts() {
    var cs = chatStore();
    if (!cs || !cs.getContacts) return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && !c.isGroup && c.id;
    });
  }

  function chronicleAvatar(contact) {
    var cts = global.miyaContactsStore;
    var roleId = String((contact && (contact.characterId || contact.chronicleId)) || '').trim();
    if (!roleId || !cts || typeof cts.findCharacter !== 'function') return '';
    var ch = cts.findCharacter(roleId);
    return ch && ch.avatar ? String(ch.avatar).trim() : '';
  }

  function resolveAvatarSync(contact) {
    if (!contact) return '';
    var direct = String(contact.avatar || contact.avatarUrl || '').trim();
    if (direct) return direct;
    var blobId = String(contact.avatarBlobId || '').trim();
    var cs = chatStore();
    if (cs && blobId && typeof cs.getCachedBlobUrl === 'function') {
      var cached = cs.getCachedBlobUrl(blobId);
      if (cached) return cached;
    }
    return chronicleAvatar(contact) || '';
  }

  function resolveAvatarAsync(contact) {
    if (!contact) return Promise.resolve('');
    var sync = resolveAvatarSync(contact);
    if (sync) return Promise.resolve(sync);
    var blobId = String(contact.avatarBlobId || '').trim();
    var cs = chatStore();
    if (blobId && cs && typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(blobId).then(function (url) {
        return String(url || '').trim() || chronicleAvatar(contact) || '';
      }).catch(function () {
        return chronicleAvatar(contact) || '';
      });
    }
    return Promise.resolve(chronicleAvatar(contact) || '');
  }

  /** 你说我猜一律用角色真名，不用备注名 */
  function characterTrueName(contact) {
    if (!contact) return '未命名';
    return String(contact.name || '未命名').trim() || '未命名';
  }

  function avatarHtml(contact, cls, dataAttr) {
    var url = resolveAvatarSync(contact);
    var name = characterTrueName(contact);
    var attr = dataAttr ? ' ' + dataAttr : '';
    if (url) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt=""' + attr + '>';
    }
    return '<div class="' + cls + ' ' + cls + '--ph"' + attr + '>' + esc(name.slice(0, 1)) + '</div>';
  }

  function resolveProfileAvatarUrlSync(profile) {
    if (!profile) return '';
    var cs = chatStore();
    if (cs && typeof cs.resolveProfileDisplayAvatarSync === 'function') {
      var display = String(cs.resolveProfileDisplayAvatarSync(profile) || '').trim();
      if (display) return display;
    }
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveProfileDisplayAvatarSync === 'function') {
      var override = String(extras.resolveProfileDisplayAvatarSync(profile) || '').trim();
      if (override) return override;
    }
    var direct = String(profile.displayAvatar || profile.avatarUrl || profile.avatar || '').trim();
    if (direct && /^https?:|^data:|^blob:/.test(direct)) return direct;
    var avatarId = String(profile.avatarId || '').trim();
    if (avatarId && cs && typeof cs.getCachedBlobUrl === 'function') {
      return String(cs.getCachedBlobUrl(avatarId) || '').trim();
    }
    return '';
  }

  function resolveProfileAvatarAsync(profile) {
    if (!profile) return Promise.resolve('');
    var sync = resolveProfileAvatarUrlSync(profile);
    if (sync) return Promise.resolve(sync);
    var cs = chatStore();
    var avatarId = String(profile.avatarId || '').trim();
    if (avatarId && cs && typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(avatarId).then(function (url) {
        return String(url || '').trim();
      }).catch(function () { return ''; });
    }
    if (cs && typeof cs.resolveProfileDisplayAvatarAsync === 'function') {
      return cs.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
        return String(url || '').trim();
      }).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function profileAvatarHtml(profile, cls, dataAttr) {
    var url = resolveProfileAvatarUrlSync(profile);
    var name = String((profile && profile.name) || '我');
    var attr = dataAttr ? ' ' + dataAttr : '';
    if (url) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt=""' + attr + '>';
    }
    return '<div class="' + cls + ' ' + cls + '--ph"' + attr + '>' + esc(name.slice(0, 1)) + '</div>';
  }

  function hydrateSetupAvatars(root) {
    var host = root || $('sg-setup-scroll');
    if (!host) return;
    host.querySelectorAll('[data-sg-ava-contact]').forEach(function (el) {
      var id = el.getAttribute('data-sg-ava-contact');
      var contact = listContacts().find(function (c) { return String(c.id) === String(id); });
      if (!contact) return;
      resolveAvatarAsync(contact).then(function (url) {
        if (!url || !el.parentNode) return;
        if (el.tagName === 'IMG' && el.getAttribute('src') === url) return;
        var cls = el.className.replace(/\s*sg-pick__av--ph\s*/g, ' ').trim();
        el.outerHTML = '<img class="' + cls + '" src="' + esc(url) + '" alt="" data-sg-ava-contact="' + esc(id) + '">';
      });
    });
    host.querySelectorAll('[data-sg-ava-profile]').forEach(function (el) {
      var id = el.getAttribute('data-sg-ava-profile');
      var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
      var profile = profiles.find(function (p) { return String(p.id) === String(id); });
      if (!profile) return;
      resolveProfileAvatarAsync(profile).then(function (url) {
        if (!url || !el.parentNode) return;
        if (el.tagName === 'IMG' && el.getAttribute('src') === url) return;
        var cls = el.className.replace(/\s*sg-chip__av--ph\s*/g, ' ').replace(/\s*sg-pick__av--ph\s*/g, ' ').trim();
        el.outerHTML = '<img class="' + cls + '" src="' + esc(url) + '" alt="" data-sg-ava-profile="' + esc(id) + '">';
      });
    });
  }

  function currentSession() {
    return state.sessionId ? store().findSession(state.sessionId) : null;
  }

  /** 把对局里角色显示名刷成真名（兼容旧局存的备注名） */
  function syncSessionCharTrueNames(session) {
    if (!session || !Array.isArray(session.players)) return session;
    var changed = false;
    session.players.forEach(function (p) {
      if (!p || p.kind !== 'char' || !p.contactId) return;
      var c = listContacts().find(function (x) { return String(x.id) === String(p.contactId); });
      if (!c) return;
      var trueName = characterTrueName(c);
      if (p.name !== trueName) {
        p.name = trueName;
        changed = true;
      }
    });
    if (changed && session.id) {
      store().updateSession(session.id, { players: session.players });
    }
    return session;
  }

  function selectedCharCount() {
    return Object.keys(state.selected).filter(function (k) { return state.selected[k]; }).length;
  }

  function buildPlayers() {
    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var profile = profiles.find(function (p) { return String(p.id) === String(state.profileId); })
      || (chatStore() && chatStore().getActiveProfile ? chatStore().getActiveProfile() : null);
    var players = [];
    players.push({
      id: 'user:' + (profile && profile.id ? profile.id : 'default'),
      kind: 'user',
      name: profile ? String(profile.name || '我') : '我',
      contactId: '',
      profileId: profile ? profile.id : ''
    });
    listContacts().forEach(function (c) {
      if (!state.selected[c.id]) return;
      players.push({
        id: 'char:' + c.id,
        kind: 'char',
        name: characterTrueName(c),
        contactId: c.id,
        profileId: ''
      });
    });
    return players;
  }

  /* —— Hub —— */
  function renderHub() {
    var banks = store().listBanks();
    var meta = $('sg-hub-meta');
    if (meta) {
      meta.textContent = banks.length
        ? (banks.length + ' 题库 · ' + banks.reduce(function (n, b) { return n + (b.words || []).length; }, 0) + ' 词')
        : '';
    }
    setPage('hub');
  }

  /* —— Banks —— */
  function openBanks() {
    renderBanks();
    setPage('banks');
  }

  function renderBanks() {
    var host = $('sg-banks-list');
    if (!host) return;
    var banks = store().listBanks();
    if (!banks.length) {
      host.innerHTML = '<div class="sg-empty">暂无题库</div>';
      return;
    }
    host.innerHTML = banks.map(function (b) {
      return (
        '<button type="button" class="sg-bank-card" data-sg-open-bank="' + esc(b.id) + '">' +
          '<div class="sg-bank-card__top">' +
            '<strong>' + esc(b.name) + '</strong>' +
            '<span>' + (b.words || []).length + ' 词</span>' +
          '</div>' +
          '<p class="sg-bank-card__preview">' +
            esc((b.words || []).slice(0, 8).join(' · ') || '空题库') +
          '</p>' +
        '</button>'
      );
    }).join('');
  }

  function openBankDetail(bankId) {
    state.bankId = bankId;
    renderBankDetail();
    setPage('bank');
  }

  function renderBankDetail() {
    var bank = store().findBank(state.bankId);
    var title = $('sg-bank-title');
    var host = $('sg-bank-words');
    var nameInput = $('sg-bank-rename');
    if (!bank) {
      toast('题库不存在');
      openBanks();
      return;
    }
    if (title) title.textContent = bank.name;
    if (nameInput) nameInput.value = bank.name;
    if (!host) return;
    if (!(bank.words || []).length) {
      host.innerHTML = '<div class="sg-empty">暂无词语</div>';
      return;
    }
    var otherBanks = store().listBanks().filter(function (b) {
      return String(b.id) !== String(bank.id);
    });
    host.innerHTML = bank.words.map(function (w) {
      var moveOpts = otherBanks.map(function (b) {
        return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>';
      }).join('');
      return (
        '<div class="sg-word-row" data-sg-word="' + esc(w) + '">' +
          '<span class="sg-word-row__text">' + esc(w) + '</span>' +
          '<div class="sg-word-row__acts">' +
            (otherBanks.length
              ? ('<select class="sg-select sg-select--sm" data-sg-move-to data-word="' + esc(w) + '">' +
                  '<option value="">移到…</option>' + moveOpts +
                '</select>')
              : '') +
            '<button type="button" class="sg-text-btn sg-text-btn--danger" data-sg-del-word="' + esc(w) + '">删</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function aiGenerateIntoBank(bankId) {
    var input = bankId ? $('sg-ai-keywords-bank') : $('sg-ai-keywords');
    if (!input || !String(input.value || '').trim()) {
      input = $('sg-ai-keywords') || $('sg-ai-keywords-bank');
    }
    var kw = input ? String(input.value || '').trim() : '';
    if (!kw) {
      toast('先写几个关键词');
      return;
    }
    var createNew = !bankId;
    setBusy(true, 'AI 生成词语中…');
    bridge().generateWords(kw, 20).then(function (words) {
      var bank;
      if (createNew) {
        bank = store().createBank({ name: store().nextBankName(), words: words });
        state.bankId = bank.id;
      } else {
        var res = store().addWords(bankId, words);
        bank = res && res.bank;
      }
      setBusy(false);
      toast('已生成 ' + words.length + ' 个词 · ' + (bank ? bank.name : ''));
      if (createNew) {
        openBankDetail(bank.id);
      } else {
        renderBankDetail();
      }
    }).catch(function (err) {
      setBusy(false);
      toast((err && err.message) || '生成失败');
    });
  }

  function manualAddWord() {
    var input = $('sg-manual-word');
    var w = input ? String(input.value || '').trim() : '';
    if (!store().isValidWord(w)) {
      toast('词语需 2–10 字');
      return;
    }
    if (!state.bankId) {
      toast('请先打开题库');
      return;
    }
    var res = store().addWords(state.bankId, [w]);
    if (!res || !(res.added || []).length) {
      toast('已存在或无效');
      return;
    }
    if (input) input.value = '';
    renderBankDetail();
    toast('已添加');
  }

  /* —— Setup —— */
  function openSetup() {
    var banks = store().listBanks();
    if (!banks.length) {
      toast('先建题库');
      openBanks();
      return;
    }
    state.selected = {};
    state.rounds = 5;
    state.mode = 'user_lead';
    state.prizes = { first: '', second: '', third: '' };
    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var active = chatStore() && chatStore().getActiveProfile ? chatStore().getActiveProfile() : null;
    state.profileId = active ? active.id : (profiles[0] ? profiles[0].id : '');
    state.bankId = banks[0].id;
    renderSetup();
    setPage('setup');
  }

  function renderSetup() {
    var host = $('sg-setup-scroll');
    if (!host) return;
    var contacts = listContacts();
    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var banks = store().listBanks();
    var charN = selectedCharCount();
    var total = charN + 1;
    var activeProfile = profiles.find(function (p) { return String(p.id) === String(state.profileId); })
      || (chatStore() && chatStore().getActiveProfile ? chatStore().getActiveProfile() : null);

    var html = '';
    html += '<p class="sg-label">面具</p><div class="sg-chip-row">';
    if (!profiles.length) {
      html += '<span class="sg-hint">暂无面具</span>';
    } else {
      profiles.forEach(function (p) {
        var on = String(p.id) === String(state.profileId);
        html += '<button type="button" class="sg-chip sg-chip--avatar' + (on ? ' is-on' : '') + '" data-sg-profile="' + esc(p.id) + '">';
        html += profileAvatarHtml(p, 'sg-chip__av', 'data-sg-ava-profile="' + esc(p.id) + '"');
        html += '<span>' + esc(p.name || '未命名') + '</span></button>';
      });
    }
    html += '</div>';

    html += '<p class="sg-label">玩家</p>';
    html += '<div class="sg-pick-grid">';
    html += '<div class="sg-pick sg-pick--you is-on" aria-label="你">';
    html += profileAvatarHtml(activeProfile, 'sg-pick__av', activeProfile ? 'data-sg-ava-profile="' + esc(activeProfile.id) + '"' : '');
    html += '<span class="sg-pick__name">' + esc(activeProfile ? (activeProfile.name || '我') : '我') + '</span>';
    html += '<span class="sg-pick__tag">你</span>';
    html += '</div>';

    if (!contacts.length) {
      html += '</div><div class="sg-empty">暂无联系人</div>';
    } else {
      contacts.forEach(function (c) {
        var on = !!state.selected[c.id];
        html += '<button type="button" class="sg-pick' + (on ? ' is-on' : '') + '" data-sg-pick="' + esc(c.id) + '">';
        html += avatarHtml(c, 'sg-pick__av', 'data-sg-ava-contact="' + esc(c.id) + '"');
        html += '<span class="sg-pick__name">' + esc(characterTrueName(c)) + '</span>';
        html += '</button>';
      });
      html += '</div>';
    }

    html += '<p class="sg-label">轮数</p><div class="sg-chip-row">';
    [3, 5, 8, 10, 15, 20].forEach(function (n) {
      html += '<button type="button" class="sg-chip' + (state.rounds === n ? ' is-on' : '') + '" data-sg-rounds="' + n + '">' + n + '</button>';
    });
    html += '</div>';
    html += '<label class="sg-field"><span>自定义</span><input type="number" min="1" max="30" id="sg-rounds-custom" value="' + esc(state.rounds) + '"></label>';

    html += '<p class="sg-label">模式</p><div class="sg-mode-grid">';
    html += '<button type="button" class="sg-mode' + (state.mode === 'user_lead' ? ' is-on' : '') + '" data-sg-mode="user_lead">' +
      '<strong>我说你们猜</strong></button>';
    html += '<button type="button" class="sg-mode' + (state.mode === 'other_lead' ? ' is-on' : '') + '" data-sg-mode="other_lead">' +
      '<strong>你们说我猜</strong></button>';
    html += '</div>';

    html += '<p class="sg-label">题库</p><div class="sg-chip-row sg-chip-row--wrap">';
    banks.forEach(function (b) {
      html += '<button type="button" class="sg-chip' + (String(b.id) === String(state.bankId) ? ' is-on' : '') + '" data-sg-bank="' + esc(b.id) + '">' +
        esc(b.name) + ' · ' + (b.words || []).length + '</button>';
    });
    html += '</div>';

    html += '<p class="sg-label">奖励</p>';
    html += '<label class="sg-field"><span>第 1 名</span><input data-sg-prize="first" value="' + esc(state.prizes.first || '') + '" placeholder=""></label>';
    html += '<label class="sg-field"><span>第 2 名</span><input data-sg-prize="second" value="' + esc(state.prizes.second || '') + '" placeholder=""></label>';
    html += '<label class="sg-field"><span>第 3 名</span><input data-sg-prize="third" value="' + esc(state.prizes.third || '') + '" placeholder=""></label>';

    host.innerHTML = html;
    updateSetupDock();
    hydrateSetupAvatars(host);
  }

  function updateSetupDock() {
    var charN = selectedCharCount();
    var total = charN + 1;
    var bank = store().findBank(state.bankId);
    var status = $('sg-setup-status');
    var btn = $('sg-start-btn');
    var ok = true;
    var msg = total + ' 人 · ' + state.rounds + ' 轮';
    if (total < 2) { ok = false; msg = '至少再选 1 个角色'; }
    else if (total > 8) { ok = false; msg = '最多 8 人（含你）'; }
    else if (!bank || !(bank.words || []).length) { ok = false; msg = '题库至少要有 1 个词'; }
    if (status) {
      status.textContent = msg;
      status.classList.toggle('is-bad', !ok);
    }
    if (btn) btn.disabled = !ok;
  }

  function togglePick(id) {
    id = String(id);
    if (state.selected[id]) {
      delete state.selected[id];
    } else {
      if (selectedCharCount() >= 7) {
        toast('最多再选 7 个角色');
        return;
      }
      state.selected[id] = true;
    }
    renderSetup();
  }

  function startGame() {
    var players = buildPlayers();
    if (players.length < 2 || players.length > 8) {
      toast('人数需 2–8');
      return;
    }
    var bank = store().findBank(state.bankId);
    if (!bank || !(bank.words || []).length) {
      toast('请选择题库');
      return;
    }
    var custom = $('sg-rounds-custom');
    if (custom) {
      var n = parseInt(custom.value, 10);
      if (!isNaN(n)) state.rounds = Math.max(1, Math.min(30, n));
    }
    var profile = bridge().resolveProfile(state.profileId);
    var session = store().createSession({
      mode: state.mode,
      totalRounds: state.rounds,
      bankId: bank.id,
      bankName: bank.name,
      profileId: profile ? profile.id : state.profileId,
      profileName: profile ? profile.name : '我',
      players: players,
      prizes: store().normalizePrizes(state.prizes)
    });
    state.sessionId = session.id;
    beginRound(session, 0);
  }

  /* —— Play —— */
  function beginRound(session, roundIndex) {
    session = store().findSession(session.id) || session;
    var bank = store().findBank(session.bankId);
    if (!bank || !(bank.words || []).length) {
      toast('题库空了');
      return;
    }
    var pool = (bank.words || []).filter(function (w) {
      return (session.usedWords || []).indexOf(w) === -1;
    });
    if (!pool.length) {
      pool = bank.words.slice();
      session.usedWords = [];
    }
    var word = pool[Math.floor(Math.random() * pool.length)];
    var players = session.players || [];
    var describerIndex;
    if (roundIndex === 0) {
      if (session.mode === 'other_lead') {
        describerIndex = players.findIndex(function (p) { return p.kind === 'char'; });
        if (describerIndex < 0) describerIndex = 0;
      } else {
        describerIndex = 0;
      }
    } else {
      var prev = session.rounds[session.rounds.length - 1];
      var prevIdx = players.findIndex(function (p) {
        return prev && String(p.id) === String(prev.describerId);
      });
      describerIndex = (prevIdx + 1) % players.length;
    }

    var round = {
      index: roundIndex,
      word: word,
      describerId: players[describerIndex].id,
      description: '',
      guesses: [],
      phase: 'describe',
      revealed: false
    };

    var rounds = (session.rounds || []).slice();
    rounds.push(round);
    var used = (session.usedWords || []).concat([word]);
    store().updateSession(session.id, {
      status: 'playing',
      currentRound: roundIndex,
      rounds: rounds,
      usedWords: used
    });
    session = store().findSession(session.id);
    maybeAutoDescribe(session);
    renderPlay();
    setPage('play');
  }

  function currentRound(session) {
    session = session || currentSession();
    if (!session || !session.rounds || !session.rounds.length) return null;
    return session.rounds[session.rounds.length - 1];
  }

  function playerById(session, id) {
    return (session.players || []).find(function (p) {
      return String(p.id) === String(id);
    }) || null;
  }

  function maybeAutoDescribe(session) {
    var round = currentRound(session);
    if (!round || round.phase !== 'describe' || round.description) return;
    var describer = playerById(session, round.describerId);
    if (!describer || describer.kind !== 'char') return;
    if (round._describing) return;

    session._currentDescriberId = round.describerId;
    round._describing = true;
    store().updateSession(session.id, { rounds: session.rounds });
    setBusy(true, describer.name + ' 正在描述…');
    bridge().describeAsCharacter(session, describer, round.word).then(function (res) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (round) round._describing = false;
      var speech = (res && res.speech) || '';
      if (bridge().cleanDisplayText) speech = bridge().cleanDisplayText(speech) || speech;
      if (!speech) {
        toast('描述为空，可重试');
        renderPlay();
        return;
      }
      submitDescription(speech, true);
    }).catch(function (err) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (round) round._describing = false;
      toast((err && err.message) || '描述失败，可重试');
      renderPlay();
    });
  }

  function submitDescription(text, fromAi) {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.phase !== 'describe') return;
    var desc = String(text || '').trim();
    if (!desc) {
      toast('写一点描述吧');
      return;
    }
    var storeWord = store().normalizeWord(round.word);
    if (!fromAi && store().guessHitsWord(desc, storeWord)) {
      toast('描述里不能直接出现答案哦');
      return;
    }
    if (fromAi && store().guessHitsWord(desc, storeWord)) {
      toast('出题人差点泄题，继续猜吧');
    }
    round.description = desc;
    round.phase = 'guess';
    round.guesses = [];
    round.dialogue = [];
    round._charsGuessing = false;
    store().updateSession(session.id, { rounds: session.rounds });
    renderPlay();
    var user = (session.players || []).find(function (p) { return p.kind === 'user'; });
    var userNeedsGuess = user && String(user.id) !== String(round.describerId);
    if (!userNeedsGuess) {
      runCharGuessesBatch();
    }
  }

  function pendingGuessPlayers(session, round) {
    var guessed = {};
    (round.guesses || []).forEach(function (g) { guessed[g.playerId] = true; });
    return (session.players || []).filter(function (p) {
      return String(p.id) !== String(round.describerId) && !guessed[p.id];
    });
  }

  function pendingCharGuessers(session, round) {
    return pendingGuessPlayers(session, round).filter(function (p) { return p.kind === 'char'; });
  }

  /** 角色猜词：整轮只调一次 API，可互相对话 */
  function runCharGuessesBatch() {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.phase !== 'guess') return;
    if (round._charsGuessing) return;
    var chars = pendingCharGuessers(session, round);
    if (!chars.length) {
      if (!pendingGuessPlayers(session, round).length) revealRound();
      else renderPlay();
      return;
    }

    session._currentDescriberId = round.describerId;
    round._charsGuessing = true;
    store().updateSession(session.id, { rounds: session.rounds });

    var userGuess = (round.guesses || []).find(function (g) {
      var pl = playerById(session, g.playerId);
      return pl && pl.kind === 'user';
    });
    var userPlayer = (session.players || []).find(function (p) { return p.kind === 'user'; });
    var userInfo = userGuess ? {
      name: userPlayer ? userPlayer.name : '用户',
      text: userGuess.text,
      speech: userGuess.speech
    } : null;

    setBusy(true, '角色们正在讨论猜词…');
    bridge().guessRoundAsCharacters(session, chars, round.description, userInfo).then(function (res) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (!session || !round || round.phase !== 'guess') return;
      round._charsGuessing = false;

      round.dialogue = Array.isArray(res.lines) ? res.lines : [];
      var gotIds = {};
      (res.guesses || []).forEach(function (g) {
        if ((round.guesses || []).some(function (x) { return String(x.playerId) === String(g.playerId); })) {
          gotIds[g.playerId] = true;
          return;
        }
        var hit = store().guessHitsWord(g.text, round.word) ||
          store().guessHitsWord(g.speech, round.word);
        (round.dialogue || []).forEach(function (ln) {
          if (String(ln.playerId) !== String(g.playerId)) return;
          if (store().guessHitsWord(ln.speech, round.word) || store().guessHitsWord(ln.guess, round.word)) {
            hit = true;
          }
        });
        var cleanG = bridge().cleanGuessWord ? bridge().cleanGuessWord(g.text) : g.text;
        var cleanS = bridge().cleanDisplayText ? bridge().cleanDisplayText(g.speech) : g.speech;
        round.guesses.push({
          playerId: g.playerId,
          text: cleanG || g.text || '……',
          speech: cleanS || g.speech || '',
          hit: !!hit,
          fromAi: true
        });
        gotIds[g.playerId] = true;
      });
      // 兜底：API 结果仍缺人时补齐，避免只显示一个人
      chars.forEach(function (c) {
        if (gotIds[c.id]) return;
        if ((round.guesses || []).some(function (x) { return String(x.playerId) === String(c.id); })) return;
        round.guesses.push({
          playerId: c.id,
          text: '……',
          speech: '',
          hit: false,
          fromAi: true
        });
        round.dialogue.push({
          playerId: c.id,
          name: c.name,
          speech: '',
          guess: '……'
        });
      });
      // 对话里补猜词框：只加猜词，不再附带整段 speech（避免复读）
      chars.forEach(function (c) {
        var hasLineGuess = (round.dialogue || []).some(function (ln) {
          return String(ln.playerId) === String(c.id) && ln.guess;
        });
        if (hasLineGuess) return;
        var g = (round.guesses || []).find(function (x) { return String(x.playerId) === String(c.id); });
        if (!g || !g.text) return;
        round.dialogue.push({
          playerId: c.id,
          name: c.name,
          speech: '',
          guess: g.text || ''
        });
      });
      store().updateSession(session.id, { rounds: session.rounds });
      renderPlay();
      if (!pendingGuessPlayers(session, round).length) revealRound();
    }).catch(function (err) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (round) round._charsGuessing = false;
      toast((err && err.message) || '角色猜词失败');
      chars.forEach(function (c) {
        if (!round) return;
        if ((round.guesses || []).some(function (x) { return String(x.playerId) === String(c.id); })) return;
        round.guesses.push({
          playerId: c.id,
          text: '……',
          speech: '这题好难，我再想想。',
          hit: false,
          fromAi: true
        });
      });
      if (session && round) store().updateSession(session.id, { rounds: session.rounds });
      renderPlay();
      if (session && round && !pendingGuessPlayers(session, round).length) revealRound();
    });
  }

  function addUserGuess(guessText, speechText) {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.phase !== 'guess') return;
    var user = (session.players || []).find(function (p) { return p.kind === 'user'; });
    if (!user || String(user.id) === String(round.describerId)) return;
    if ((round.guesses || []).some(function (g) { return String(g.playerId) === String(user.id); })) return;
    var text = (bridge().cleanGuessWord ? bridge().cleanGuessWord(guessText) : '') || String(guessText || '').trim();
    if (!text) {
      toast('猜一个词吧');
      return;
    }
    var speech = String(speechText || '').trim();
    if (bridge().cleanDisplayText) speech = bridge().cleanDisplayText(speech) || speech;
    round.guesses.push({
      playerId: user.id,
      text: text,
      speech: speech,
      hit: !!store().guessHitsWord(text, round.word) ||
        !!(speech && store().guessHitsWord(speech, round.word)),
      fromAi: false
    });
    store().updateSession(session.id, { rounds: session.rounds });
    renderPlay();
    runCharGuessesBatch();
  }

  function revealRound() {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.revealed) return;
    round.phase = 'reveal';
    round.revealed = true;
    var scores = Object.assign({}, session.scores || {});
    (round.guesses || []).forEach(function (g) {
      if (!g.hit) return;
      scores[g.playerId] = (scores[g.playerId] || 0) + 1;
    });
    store().updateSession(session.id, { rounds: session.rounds, scores: scores });
    renderPlay();
  }

  function nextRoundOrFinish() {
    var session = currentSession();
    if (!session) return;
    var next = (session.currentRound || 0) + 1;
    if (next >= session.totalRounds) {
      finishGame();
      return;
    }
    beginRound(session, next);
  }

  function changeDescriber(playerId) {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.phase !== 'describe' || round.description) {
      toast('只能在描述前换出题人');
      return;
    }
    var p = playerById(session, playerId);
    if (!p) return;
    round.describerId = p.id;
    store().updateSession(session.id, { rounds: session.rounds });
    renderPlay();
    maybeAutoDescribe(store().findSession(session.id));
  }

  function renderPlay() {
    var session = syncSessionCharTrueNames(currentSession());
    var host = $('sg-play-scroll');
    if (!host || !session) return;
    var round = currentRound(session);
    if (!round) {
      host.innerHTML = '<div class="sg-empty">对局异常</div>';
      return;
    }
    var describer = playerById(session, round.describerId);
    var isUserDescriber = describer && describer.kind === 'user';
    var userPlayer = (session.players || []).find(function (p) { return p.kind === 'user'; });
    var userGuessed = (round.guesses || []).some(function (g) {
      return userPlayer && String(g.playerId) === String(userPlayer.id);
    });
    var showWord = isUserDescriber && round.phase === 'describe';

    var html = '';
    html += '<div class="sg-play-top">';
    html += '<div class="sg-play-round">第 ' + (round.index + 1) + ' / ' + session.totalRounds + ' 轮</div>';
    html += '<div class="sg-score-strip">';
    (session.players || []).forEach(function (p) {
      html += '<span class="sg-score-pill' + (String(p.id) === String(round.describerId) ? ' is-lead' : '') + '">' +
        esc(p.name) + ' <b>' + (session.scores[p.id] || 0) + '</b></span>';
    });
    html += '</div></div>';

    html += '<div class="sg-card">';
    html += '<p class="sg-card__kicker">出题人</p>';
    html += '<h3 class="sg-card__title">' + esc(describer ? describer.name : '—') + '</h3>';
    if (showWord) {
      html += '<div class="sg-secret"><span>本题</span><strong>' + esc(round.word) + '</strong></div>';
    } else if (round.phase === 'reveal') {
      html += '<div class="sg-secret sg-secret--open"><span>答案</span><strong>' + esc(round.word) + '</strong></div>';
    }
    html += '</div>';

    if (round.phase === 'describe' && !round.description) {
      html += '<p class="sg-label">出题人</p><div class="sg-chip-row sg-chip-row--wrap">';
      (session.players || []).forEach(function (p) {
        html += '<button type="button" class="sg-chip' + (String(p.id) === String(round.describerId) ? ' is-on' : '') + '" data-sg-describer="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      });
      html += '</div>';

      if (isUserDescriber) {
        html += '<label class="sg-field sg-field--area"><span>描述</span>' +
          '<textarea id="sg-desc-input" rows="3" placeholder=""></textarea></label>';
        html += '<button type="button" class="sg-btn sg-btn--primary" id="sg-desc-submit">提交描述</button>';
      } else {
        html += '<button type="button" class="sg-btn sg-btn--ghost" data-sg-retry-desc>重新让角色描述</button>';
      }
    }

    if (round.description) {
      html += '<div class="sg-bubble"><p class="sg-bubble__who">' + esc(describer ? describer.name : '出题人') + ' 说</p>' +
        '<p class="sg-bubble__text">' + esc(round.description) + '</p></div>';
    }

    if (round.phase === 'guess' || round.phase === 'reveal') {
      if (round.phase === 'guess' && userPlayer && String(userPlayer.id) !== String(round.describerId) && !userGuessed) {
        html += '<p class="sg-label">你的猜测</p>';
        html += '<label class="sg-field"><span>猜的词</span>' +
          '<input id="sg-guess-input" placeholder="最终猜词" maxlength="20"></label>';
        html += '<label class="sg-field sg-field--area"><span>想说的话</span>' +
          '<textarea id="sg-guess-speech" rows="2" placeholder="本轮想吐槽 / 接话（可选）"></textarea></label>';
        html += '<button type="button" class="sg-btn sg-btn--primary" id="sg-guess-submit">提交</button>';
      }

      var dialogue = Array.isArray(round.dialogue) ? round.dialogue : [];
      var userGuessRow = (round.guesses || []).find(function (g) {
        return userPlayer && String(g.playerId) === String(userPlayer.id);
      });

      if (userGuessRow) {
        html += '<div class="sg-guess' + (userGuessRow.hit && round.revealed ? ' is-hit' : '') + '">';
        html += '<div class="sg-guess__head"><strong>' + esc(userPlayer ? userPlayer.name : '我') + '</strong>';
        if (round.revealed) {
          html += userGuessRow.hit ? '<span class="sg-tag sg-tag--ok">+1</span>' : '<span class="sg-tag">未中</span>';
        }
        html += '</div>';
        if (userGuessRow.speech && userGuessRow.speech !== userGuessRow.text) {
          html += '<p class="sg-guess__speech">' + esc(userGuessRow.speech) + '</p>';
        }
        html += '<div class="sg-guess-word"><span>猜</span><strong>' + esc(userGuessRow.text || '') + '</strong></div>';
        html += '</div>';
      }

      if (dialogue.length) {
        html += '<div class="sg-guess-list">';
        dialogue.forEach(function (ln) {
          var pl = playerById(session, ln.playerId);
          var gHit = null;
          if (round.revealed && ln.playerId) {
            var gg = (round.guesses || []).find(function (x) { return String(x.playerId) === String(ln.playerId); });
            if (gg) gHit = !!gg.hit;
          }
          html += '<div class="sg-guess' + (gHit === true ? ' is-hit' : '') + '">';
          html += '<div class="sg-guess__head"><strong>' + esc((pl && pl.name) || ln.name || '?') + '</strong></div>';
          if (ln.speech) html += '<p class="sg-guess__speech">' + esc(ln.speech) + '</p>';
          if (ln.guess) {
            html += '<div class="sg-guess-word"><span>猜</span><strong>' + esc(ln.guess) + '</strong></div>';
          }
          html += '</div>';
        });
        html += '</div>';
      } else if ((round.guesses || []).some(function (g) {
        var pl = playerById(session, g.playerId);
        return pl && pl.kind === 'char';
      })) {
        html += '<div class="sg-guess-list">';
        (round.guesses || []).forEach(function (g) {
          var pl = playerById(session, g.playerId);
          if (!pl || pl.kind === 'user') return;
          html += '<div class="sg-guess' + (g.hit && round.revealed ? ' is-hit' : '') + '">';
          html += '<div class="sg-guess__head"><strong>' + esc(pl.name) + '</strong>';
          if (round.revealed) {
            html += g.hit ? '<span class="sg-tag sg-tag--ok">+1</span>' : '<span class="sg-tag">未中</span>';
          }
          html += '</div>';
          if (g.speech && g.speech !== g.text) {
            html += '<p class="sg-guess__speech">' + esc(g.speech) + '</p>';
          }
          html += '<div class="sg-guess-word"><span>猜</span><strong>' + esc(g.text || '') + '</strong></div>';
          html += '</div>';
        });
        html += '</div>';
      }
    }

    if (round.phase === 'reveal') {
      var hits = (round.guesses || []).filter(function (g) { return g.hit; }).length;
      html += '<div class="sg-reveal-note">本轮 ' + hits + ' 人猜中</div>';

      var review = Array.isArray(round.review) ? round.review : [];
      if (review.length) {
        html += '<div class="sg-guess-list">';
        review.forEach(function (ln) {
          html += '<div class="sg-guess"><div class="sg-guess__head"><strong>' +
            esc(ln.name || '?') + '</strong></div>';
          if (ln.speech) html += '<p class="sg-guess__speech">' + esc(ln.speech) + '</p>';
          html += '</div>';
        });
        html += '</div>';
      }

      var isLast = (round.index + 1) >= session.totalRounds;
      var hasChars = (session.players || []).some(function (p) { return p && p.kind === 'char'; });
      if (hasChars && !review.length) {
        html += '<button type="button" class="sg-btn sg-btn--ghost" id="sg-review-btn">生成讨论</button>';
      } else if (hasChars && review.length) {
        html += '<button type="button" class="sg-btn sg-btn--ghost" id="sg-review-btn">再讨论一次</button>';
      }
      html += '<button type="button" class="sg-btn sg-btn--primary" id="sg-next-round">' +
        (isLast ? '查看总成绩' : '下一轮') + '</button>';
    }

    host.innerHTML = html;
  }

  function runRoundReview() {
    var session = currentSession();
    var round = currentRound(session);
    if (!session || !round || round.phase !== 'reveal') return;
    var chars = (session.players || []).filter(function (p) { return p && p.kind === 'char'; });
    if (!chars.length) {
      toast('没有角色');
      return;
    }
    if (round._reviewing) return;
    round._reviewing = true;
    setBusy(true, '生成讨论…');
    bridge().discussRoundAsCharacters(session, round).then(function (res) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (!session || !round) return;
      round._reviewing = false;
      round.review = Array.isArray(res.lines) ? res.lines : [];
      store().updateSession(session.id, { rounds: session.rounds });
      renderPlay();
    }).catch(function (err) {
      setBusy(false);
      session = currentSession();
      round = currentRound(session);
      if (round) round._reviewing = false;
      toast((err && err.message) || '讨论失败');
      renderPlay();
    });
  }

  function finishGame() {
    var session = currentSession();
    if (!session) return;
    store().updateSession(session.id, { status: 'done' });
    renderResult();
    setPage('result');
  }

  function rankedPlayers(session) {
    return (session.players || []).slice().sort(function (a, b) {
      return (session.scores[b.id] || 0) - (session.scores[a.id] || 0);
    });
  }

  function prizeForRank(prizes, idx) {
    if (idx === 0) return prizes.first || '';
    if (idx === 1) return prizes.second || '';
    if (idx === 2) return prizes.third || '';
    return '';
  }

  function renderResult() {
    var session = syncSessionCharTrueNames(currentSession());
    var host = $('sg-result-scroll');
    if (!host || !session) return;
    var ranked = rankedPlayers(session);
    var prizes = store().normalizePrizes(session.prizes);
    var html = '';
    html += '<div class="sg-result-hero">';
    html += '<p class="sg-result-hero__kicker">Game over</p>';
    if (ranked[0]) {
      html += '<h2 class="sg-result-hero__title">' + esc(ranked[0].name) + ' 赢了</h2>';
      html += '<p class="sg-result-hero__sub">' + (session.scores[ranked[0].id] || 0) + ' 分 · 共 ' + session.totalRounds + ' 轮</p>';
    }
    html += '</div>';

    html += '<div class="sg-rank-list">';
    ranked.forEach(function (p, i) {
      var prize = prizeForRank(prizes, i);
      html += '<div class="sg-rank-row">' +
        '<span class="sg-rank-row__n">' + (i + 1) + '</span>' +
        '<div class="sg-rank-row__body">' +
          '<strong>' + esc(p.name) + '</strong>' +
          (prize ? ('<span class="sg-rank-row__prize">' + esc(prize) + '</span>') : '') +
        '</div>' +
        '<b class="sg-rank-row__score">' + (session.scores[p.id] || 0) + '</b>' +
      '</div>';
    });
    html += '</div>';

    html += '<div id="sg-celebrate-list" class="sg-celebrate"></div>';
    html += '<button type="button" class="sg-btn sg-btn--ghost" id="sg-celebrate-btn">听角色感想</button>';
    html += '<button type="button" class="sg-btn sg-btn--primary" id="sg-send-open">发送记录到聊天</button>';
    html += '<button type="button" class="sg-btn sg-btn--ghost" id="sg-again-btn">再来一局</button>';
    html += '<button type="button" class="sg-btn sg-btn--ghost" id="sg-back-hub-btn">回主页</button>';
    host.innerHTML = html;
  }

  function runCelebrations() {
    var session = currentSession();
    if (!session) return;
    var ranked = rankedPlayers(session);
    var prizes = store().normalizePrizes(session.prizes);
    var rankingText = ranked.map(function (p, i) {
      var prize = prizeForRank(prizes, i);
      return (i + 1) + '. ' + p.name + ' ' + (session.scores[p.id] || 0) + '分' +
        (prize ? ('（奖品：' + prize + '）') : '');
    }).join('\n');
    var chars = ranked.filter(function (p) { return p.kind === 'char'; });
    if (!chars.length) {
      toast('没有角色可发言');
      return;
    }
    if (!bridge().celebrateAsCharacters) {
      toast('感想模块未更新，请刷新页面');
      return;
    }
    var list = $('sg-celebrate-list');
    if (list) list.innerHTML = '';
    var prizeByPlayerId = {};
    chars.forEach(function (p) {
      var rankIdx = ranked.findIndex(function (x) { return String(x.id) === String(p.id); });
      prizeByPlayerId[p.id] = prizeForRank(prizes, rankIdx) || '';
    });
    setBusy(true, '角色感想生成中…');
    bridge().celebrateAsCharacters(session, chars, rankingText, prizeByPlayerId).then(function (res) {
      setBusy(false);
      session = currentSession();
      if (!session) return;
      var reactions = [];
      (res.lines || []).forEach(function (ln) {
        var speech = String(ln.speech || '').trim();
        if (!speech) return;
        var pl = playerById(session, ln.playerId) ||
          (session.players || []).find(function (p) { return p.name === ln.name; });
        var name = (pl && pl.name) || ln.name || '角色';
        if (list) {
          list.innerHTML += '<div class="sg-bubble"><p class="sg-bubble__who">' + esc(name) + '</p>' +
            '<p class="sg-bubble__text">' + esc(speech) + '</p></div>';
        }
        reactions.push({
          contactId: (pl && pl.contactId) || '',
          playerId: (pl && pl.id) || ln.playerId || '',
          name: name,
          text: speech
        });
      });
      session.reactions = reactions;
      store().updateSession(session.id, { reactions: reactions });
    }).catch(function (err) {
      setBusy(false);
      toast((err && err.message) || '感想生成失败');
    });
  }

  /* —— Send to chat —— */
  function openSend() {
    var session = currentSession();
    if (!session) return;
    state.sendSelected = {};
    (session.players || []).forEach(function (p) {
      if (p && p.kind === 'char' && p.contactId) state.sendSelected[p.contactId] = true;
    });
    renderSend();
    setPage('send');
  }

  function renderSend() {
    var session = syncSessionCharTrueNames(currentSession());
    var host = $('sg-send-scroll');
    if (!session || !host) return;
    var html = '';
    html += '<p class="sg-label">角色</p>';
    var chars = (session.players || []).filter(function (p) { return p && p.kind === 'char' && p.contactId; });
    if (!chars.length) {
      html += '<div class="sg-empty">没有可发送的角色</div>';
    } else {
      chars.forEach(function (p) {
        html += '<label class="sg-check"><input type="checkbox" data-sg-send="' + esc(p.contactId) + '"' +
          (state.sendSelected[p.contactId] ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
      });
    }
    host.innerHTML = html;
  }

  function slimAvatarForStore(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^blob:/i.test(u)) return '';
    if (/^data:/i.test(u) && u.length > 2048) return '';
    return u;
  }

  /** 发送聊天记录前：角色名一律换成真名（含对局里残留的备注名） */
  function sessionWithTrueNames(session) {
    if (!session) return session;
    var nameMap = {};
    var players = (session.players || []).map(function (p) {
      if (!p) return p;
      if (p.kind !== 'char') return p;
      var c = listContacts().find(function (x) { return String(x.id) === String(p.contactId); });
      var trueName = c ? characterTrueName(c) : String(p.name || '未命名').trim();
      var old = String(p.name || '').trim();
      if (old) nameMap[old] = trueName;
      if (c && c.remarkName) {
        var remark = String(c.remarkName).trim();
        if (remark) nameMap[remark] = trueName;
      }
      if (c && c.name) nameMap[String(c.name).trim()] = trueName;
      return Object.assign({}, p, { name: trueName });
    });
    function mapName(n) {
      var s = String(n || '').trim();
      return (s && nameMap[s]) || s;
    }
    function mapLine(ln) {
      if (!ln || typeof ln !== 'object') return ln;
      return Object.assign({}, ln, { name: mapName(ln.name) });
    }
    var rounds = (session.rounds || []).map(function (r) {
      if (!r) return r;
      return Object.assign({}, r, {
        dialogue: Array.isArray(r.dialogue) ? r.dialogue.map(mapLine) : [],
        review: Array.isArray(r.review) ? r.review.map(mapLine) : [],
        guesses: Array.isArray(r.guesses) ? r.guesses.slice() : []
      });
    });
    var reactions = Array.isArray(session.reactions)
      ? session.reactions.map(function (rx) {
          if (!rx || typeof rx !== 'object') return rx;
          return Object.assign({}, rx, { name: mapName(rx.name) });
        })
      : [];
    return Object.assign({}, session, {
      players: players,
      rounds: rounds,
      reactions: reactions
    });
  }

  function buildSayGuessRecordPayload(session) {
    var named = sessionWithTrueNames(session);
    var digest = store().buildContextDigest(named);
    var profile = bridge().resolveProfile(named.profileId);
    var profileAvatar = slimAvatarForStore(resolveProfileAvatarUrlSync(profile));
    var players = (named.players || []).map(function (p) {
      if (!p) return null;
      var avatar = '';
      if (p.kind === 'char') {
        var c = listContacts().find(function (x) { return String(x.id) === String(p.contactId); });
        avatar = slimAvatarForStore(resolveAvatarSync(c));
      } else {
        avatar = profileAvatar;
      }
      return {
        id: p.id,
        kind: p.kind,
        contactId: p.contactId || '',
        name: p.name || '',
        avatar: avatar,
        score: (named.scores && named.scores[p.id]) || 0
      };
    }).filter(Boolean);
    var ranked = rankedPlayers(named).map(function (p, i) {
      return { playerId: p.id, name: p.name, rank: i + 1, score: (named.scores && named.scores[p.id]) || 0 };
    });
    return {
      role: 'user',
      type: 'sayguess_record',
      content: digest,
      sayguessRecord: {
        sessionId: named.id,
        mode: named.mode,
        totalRounds: named.totalRounds,
        bankName: named.bankName || '',
        profileId: named.profileId || '',
        profileName: named.profileName || '',
        profileAvatar: profileAvatar,
        players: players,
        scores: named.scores || {},
        rankings: ranked,
        prizes: store().normalizePrizes(named.prizes),
        rounds: (named.rounds || []).map(function (r) {
          return {
            index: r.index,
            word: r.word,
            describerId: r.describerId,
            description: r.description || '',
            dialogue: Array.isArray(r.dialogue) ? r.dialogue : [],
            review: Array.isArray(r.review) ? r.review : [],
            guesses: Array.isArray(r.guesses) ? r.guesses : []
          };
        }),
        reactions: Array.isArray(named.reactions) ? named.reactions : [],
        createdAt: named.createdAt || Date.now()
      }
    };
  }

  function ensureChatForContact(contactId, profileId) {
    var cs = chatStore();
    if (!cs) return Promise.reject(new Error('聊天未就绪'));
    var contact = cs.findContact(contactId);
    if (!contact) return Promise.reject(new Error('联系人不存在'));
    var chat = cs.findChatByContact ? cs.findChatByContact(contactId) : null;
    if (chat) return Promise.resolve(chat);
    if (typeof cs.createChat === 'function') {
      return Promise.resolve(cs.createChat({
        contactId: contactId,
        profileId: profileId || contact.defaultProfileId || ''
      }));
    }
    return Promise.reject(new Error('无法打开会话'));
  }

  function confirmSend() {
    var session = currentSession();
    if (!session) return;
    var ids = Object.keys(state.sendSelected || {}).filter(function (id) {
      return state.sendSelected[id];
    });
    if (!ids.length) {
      toast('请至少选择一位角色');
      return;
    }
    var payload = buildSayGuessRecordPayload(session);
    var firstId = ids[0];
    var chain = Promise.resolve();
    ids.forEach(function (cid) {
      chain = chain.then(function () {
        return ensureChatForContact(cid, session.profileId).then(function (chat) {
          if (!chat || !chat.id) throw new Error('会话无效');
          return chatStore().addMessage(chat.id, payload);
        });
      });
    });
    chain.then(function () {
      toast('已发送 ' + ids.length + ' 条记录');
      var chatApp = global.miyaChatApp;
      if (chatApp && typeof chatApp.open === 'function') {
        return chatApp.open().then(function () {
          if (typeof chatApp.openChatByContact === 'function') {
            return chatApp.openChatByContact(firstId);
          }
        }).catch(function () {});
      }
    }).catch(function (err) {
      toast((err && err.message) || '发送失败');
    });
  }

  /* —— Open / Close / Bind —— */
  function openSayGuess() {
    var el = $('miya-fun-sayguess');
    if (!el) return;
    el.removeAttribute('hidden');
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
    if (global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(el);
    bindEvents();
    renderHub();
  }

  function closeSayGuess() {
    var el = $('miya-fun-sayguess');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    setBusy(false);
    if (
      !document.querySelector('.miya-beautify-app.is-open') &&
      !document.querySelector('.miya-settings-app.is-open') &&
      !document.querySelector('.miya-worldbook-app.is-open') &&
      !document.querySelector('.miya-contacts-app.is-open') &&
      !document.querySelector('#miya-music-app.is-open') &&
      !document.querySelector('#miya-chat-app.is-open') &&
      !document.querySelector('#miya-memory-app.is-open') &&
      !document.querySelector('#miya-diary-app.is-open') &&
      !document.querySelector('#miya-theater-app.is-open') &&
      !document.querySelector('#miya-offline-app.is-open') &&
      !document.querySelector('#miya-typewriter-app.is-open') &&
      !document.querySelector('#miya-forum-app.is-open') &&
      !document.querySelector('.miya-cstore-app.is-open') &&
      !document.querySelector('.miya-itinerary-app.is-open') &&
      !document.querySelector('.miya-couple-app.is-open') &&
      !document.querySelector('.miya-weather-app.is-open') &&
      !document.querySelector('.miya-match-app.is-open') &&
      !document.querySelector('#miya-fun-app.is-open') &&
      !document.querySelector('#miya-fun-sayguess.is-open') &&
      !document.querySelector('#miya-deep-app.is-open')
    ) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function bindEvents() {
    if (state.bound) return;
    var root = $('miya-fun-sayguess');
    if (!root) return;
    state.bound = true;

    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-sg-close],[data-sg-nav],[data-sg-open-bank],[data-sg-pick],[data-sg-profile],[data-sg-rounds],[data-sg-mode],[data-sg-bank],[data-sg-describer],[data-sg-del-word],[data-sg-retry-desc],button,select');
      if (!t || !root.contains(t)) {
        // still handle id buttons below via closest id
      }

      if (e.target.closest('[data-sg-close]')) {
        closeSayGuess();
        return;
      }
      var nav = e.target.closest('[data-sg-nav]');
      if (nav) {
        var to = nav.getAttribute('data-sg-nav');
        if (to === 'hub') renderHub();
        else if (to === 'banks') openBanks();
        else if (to === 'setup') openSetup();
        else if (to === 'bank') renderBankDetail(), setPage('bank');
        else if (to === 'result') { renderResult(); setPage('result'); }
        else if (to === 'send') openSend();
        return;
      }

      var openBank = e.target.closest('[data-sg-open-bank]');
      if (openBank) {
        openBankDetail(openBank.getAttribute('data-sg-open-bank'));
        return;
      }

      if (e.target.closest('#sg-new-bank')) {
        var bank = store().createBank({ name: store().nextBankName(), words: [] });
        openBankDetail(bank.id);
        toast('已新建 ' + bank.name);
        return;
      }
      if (e.target.closest('#sg-ai-gen-new')) {
        aiGenerateIntoBank('');
        return;
      }
      if (e.target.closest('#sg-ai-gen-bank')) {
        aiGenerateIntoBank(state.bankId);
        return;
      }
      if (e.target.closest('#sg-manual-add')) {
        manualAddWord();
        return;
      }
      if (e.target.closest('#sg-bank-save-name')) {
        var ni = $('sg-bank-rename');
        if (ni && state.bankId) {
          store().updateBank(state.bankId, { name: ni.value });
          toast('已改名');
          renderBankDetail();
          renderBanks();
        }
        return;
      }
      if (e.target.closest('#sg-bank-delete')) {
        if (!state.bankId) return;
        if (!confirm('删除这个题库？')) return;
        store().deleteBank(state.bankId);
        toast('已删除');
        openBanks();
        return;
      }
      var delW = e.target.closest('[data-sg-del-word]');
      if (delW) {
        store().removeWord(state.bankId, delW.getAttribute('data-sg-del-word'));
        renderBankDetail();
        return;
      }

      var pick = e.target.closest('[data-sg-pick]');
      if (pick) { togglePick(pick.getAttribute('data-sg-pick')); return; }
      var prof = e.target.closest('[data-sg-profile]');
      if (prof) { state.profileId = prof.getAttribute('data-sg-profile'); renderSetup(); return; }
      var rounds = e.target.closest('[data-sg-rounds]');
      if (rounds) {
        state.rounds = parseInt(rounds.getAttribute('data-sg-rounds'), 10) || 5;
        renderSetup();
        return;
      }
      var mode = e.target.closest('[data-sg-mode]');
      if (mode) { state.mode = mode.getAttribute('data-sg-mode'); renderSetup(); return; }
      var bankBtn = e.target.closest('[data-sg-bank]');
      if (bankBtn) { state.bankId = bankBtn.getAttribute('data-sg-bank'); renderSetup(); return; }

      if (e.target.closest('#sg-start-btn')) { startGame(); return; }

      var descBtn = e.target.closest('#sg-desc-submit');
      if (descBtn) {
        var ta = $('sg-desc-input');
        submitDescription(ta ? ta.value : '', false);
        return;
      }
      if (e.target.closest('[data-sg-retry-desc]')) {
        var session = currentSession();
        var round = currentRound(session);
        if (session && round) {
          round.description = '';
          store().updateSession(session.id, { rounds: session.rounds });
          maybeAutoDescribe(store().findSession(session.id));
        }
        return;
      }
      var des = e.target.closest('[data-sg-describer]');
      if (des) { changeDescriber(des.getAttribute('data-sg-describer')); return; }

      if (e.target.closest('#sg-guess-submit')) {
        var gi = $('sg-guess-input');
        var gs = $('sg-guess-speech');
        addUserGuess(gi ? gi.value : '', gs ? gs.value : '');
        return;
      }
      if (e.target.closest('#sg-review-btn')) { runRoundReview(); return; }
      if (e.target.closest('#sg-next-round')) { nextRoundOrFinish(); return; }
      if (e.target.closest('#sg-celebrate-btn')) { runCelebrations(); return; }
      if (e.target.closest('#sg-send-open')) { openSend(); return; }
      if (e.target.closest('#sg-send-confirm')) { confirmSend(); return; }
      if (e.target.closest('#sg-again-btn')) { openSetup(); return; }
      if (e.target.closest('#sg-back-hub-btn')) { renderHub(); return; }
    });

    root.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-sg-move-to]');
      if (sel && sel.value) {
        var word = sel.getAttribute('data-word');
        var toId = sel.value;
        store().moveWord(state.bankId, toId, word);
        toast('已转移');
        renderBankDetail();
        return;
      }
      var sendInp = e.target.closest('[data-sg-send]');
      if (sendInp) {
        state.sendSelected[sendInp.getAttribute('data-sg-send')] = !!sendInp.checked;
        return;
      }
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-sg-prize')) {
        state.prizes[e.target.getAttribute('data-sg-prize')] = e.target.value;
      }
    });

    root.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'sg-rounds-custom') {
        var n = parseInt(e.target.value, 10);
        if (!isNaN(n)) {
          state.rounds = Math.max(1, Math.min(30, n));
          updateSetupDock();
        }
      }
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-sg-prize')) {
        state.prizes[e.target.getAttribute('data-sg-prize')] = e.target.value;
      }
    });
  }

  global.miyaFunSayGuessApp = {
    open: openSayGuess,
    close: closeSayGuess
  };
})(typeof window !== 'undefined' ? window : global);
