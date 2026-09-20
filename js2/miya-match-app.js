/**
 * miya-match-app.js — 赛事 UI / 导航 / 发聊天
 */
(function (global) {
  'use strict';

  var state = {
    page: 'home',
    eventId: '',
    sessionId: '',
    mode: 'solo',
    selected: {},
    teams: {},
    profileId: '',
    prizes: null,
    sendSelected: {},
    bound: false,
    toastTimer: 0,
    setupBack: 'event',
    customEditId: '',
    customEditFrom: 'custom',
    editDraft: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function store() {
    return global.miyaMatchStore;
  }

  function bridge() {
    return global.miyaMatchBridge;
  }

  function chatStore() {
    return global.miyaChatStore;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('mt-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-on');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('is-on');
    }, 2200);
  }

  function confirmDialog(opts) {
    if (global.miyaDialog && typeof global.miyaDialog.confirm === 'function') {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(window.confirm((opts && opts.message) || '确定？'));
  }

  function downloadJson(payload, filename) {
    try {
      if (typeof global.miyaDownloadJson === 'function') {
        return !!global.miyaDownloadJson(payload, filename);
      }
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'miya-match-custom.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (eRev) {}
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function sanitizeFileName(name) {
    return String(name || 'custom')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 40) || 'custom';
  }

  function setOverlay(on, title, desc) {
    var el = $('mt-overlay');
    if (!el) return;
    if (on) {
      el.classList.add('is-on');
      var t = $('mt-overlay-title');
      var d = $('mt-overlay-desc');
      if (t) t.textContent = title || '请稍候…';
      if (d) d.textContent = desc || '';
    } else {
      el.classList.remove('is-on');
    }
  }

  function setPage(name) {
    state.page = name;
    var root = $('miya-match-app');
    if (!root) return;
    root.querySelectorAll('.mt-page').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'mt-page-' + name);
    });
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
    var cts = global.miyaContactsStore;
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    if (roleId && cts && typeof cts.findCharacter === 'function') {
      var ch = cts.findCharacter(roleId);
      if (ch && ch.avatar) return String(ch.avatar).trim();
    }
    return '';
  }

  /** 赛事一律用角色真名，不用备注名 */
  function characterTrueName(contact) {
    if (!contact) return '未命名';
    return String(contact.name || '未命名').trim() || '未命名';
  }

  function avatarHtml(contact, cls) {
    var url = resolveAvatarSync(contact);
    var name = characterTrueName(contact);
    if (url) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt="">';
    }
    return '<div class="' + cls + ' ' + cls + '--ph">' + esc(name.slice(0, 1)) + '</div>';
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
    var direct = String(profile.avatarUrl || profile.avatar || '').trim();
    if (direct) return direct;
    var avatarId = String(profile.avatarId || '').trim();
    if (avatarId && cs && typeof cs.getCachedBlobUrl === 'function') {
      return String(cs.getCachedBlobUrl(avatarId) || '').trim();
    }
    return '';
  }

  function findSessionProfile(session) {
    if (!session) return null;
    var cs = chatStore();
    var profiles = cs && cs.getProfiles ? cs.getProfiles() : [];
    if (!profiles.length) return null;
    var byId = session.profileId
      ? profiles.find(function (p) { return String(p.id) === String(session.profileId); })
      : null;
    if (byId) return byId;
    var name = String(session.profileName || '').trim();
    if (!name) return null;
    return profiles.find(function (p) { return String(p.name) === name; }) || null;
  }

  function isHostSpeakerName(session, speakerName) {
    var name = String(speakerName || '').trim();
    if (!name) return false;
    if (session && session.profileName && String(session.profileName) === name) return true;
    var profile = findSessionProfile(session);
    if (profile && String(profile.name || '') === name) return true;
    return name === '我' || name === '主持人' || name === '用户';
  }

  function participantAvatarHtml(session, speakerName, cls) {
    var name = String(speakerName || '').trim();
    var hit = (session.participants || []).find(function (p) {
      return p && String(p.name) === name;
    });
    if (hit) {
      var cs = chatStore();
      var contact = cs && cs.findContact ? cs.findContact(hit.contactId) : null;
      if (contact) return avatarHtml(contact, cls);
      if (hit.avatar) {
        return '<img class="' + cls + '" src="' + esc(hit.avatar) + '" alt="">';
      }
      return '<div class="' + cls + ' ' + cls + '--ph">' + esc(name.slice(0, 1) || '?') + '</div>';
    }
    if (isHostSpeakerName(session, name)) {
      var profile = findSessionProfile(session);
      var url = resolveProfileAvatarUrlSync(profile) || String(session.profileAvatar || '').trim();
      if (url) {
        return '<img class="' + cls + '" src="' + esc(url) + '" alt="">';
      }
      var label = (profile && profile.name) || session.profileName || name || '我';
      return '<div class="' + cls + ' ' + cls + '--ph">' + esc(String(label).slice(0, 1)) + '</div>';
    }
    return '<div class="' + cls + ' ' + cls + '--ph">' + esc((name || '?').slice(0, 1)) + '</div>';
  }

  function warmHostAvatar(session, onReady) {
    var profile = findSessionProfile(session);
    if (!profile) {
      if (onReady) onReady('');
      return;
    }
    var sync = resolveProfileAvatarUrlSync(profile);
    if (sync) {
      session.profileAvatar = sync;
      if (onReady) onReady(sync);
      return;
    }
    var cs = chatStore();
    var avatarId = String(profile.avatarId || '').trim();
    if (avatarId && cs && typeof cs.getAvatarUrl === 'function') {
      cs.getAvatarUrl(avatarId).then(function (url) {
        var u = String(url || '').trim();
        if (u) session.profileAvatar = u;
        if (onReady) onReady(u);
      }).catch(function () {
        if (onReady) onReady('');
      });
      return;
    }
    if (cs && typeof cs.resolveProfileDisplayAvatarAsync === 'function') {
      cs.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
        var u = String(url || '').trim();
        if (u) session.profileAvatar = u;
        if (onReady) onReady(u);
      }).catch(function () {
        if (onReady) onReady('');
      });
      return;
    }
    if (onReady) onReady('');
  }

  function scrubBeatText(text, session) {
    var br = bridge();
    if (br && typeof br.scrubMatchProse === 'function') {
      return br.scrubMatchProse(text, session);
    }
    return String(text || '').replace(/[（(\[【]?\s*ct_[A-Za-z0-9_]+\s*[）)\]】]?/g, '').trim();
  }

  function renderBeatBodyHtml(beatText, session) {
    var cleaned = scrubBeatText(beatText, session);
    var br = bridge();
    var names = br && typeof br.collectSpeakerNames === 'function'
      ? br.collectSpeakerNames(session)
      : (session.participants || []).map(function (p) { return p.name; }).concat(session.profileName || []);
    var segs = br && typeof br.parseMatchBeatSegments === 'function'
      ? br.parseMatchBeatSegments(cleaned, names)
      : [{ type: 'narration', text: cleaned }];
    return segs.map(function (seg) {
      if (seg.type === 'speech') {
        return '<div class="mt-speech">' +
          participantAvatarHtml(session, seg.name, 'mt-speech__av') +
          '<div class="mt-speech__body">' +
            '<div class="mt-speech__name">' + esc(seg.name) + '</div>' +
            '<div class="mt-speech__text">' + esc(seg.text) + '</div>' +
          '</div></div>';
      }
      return '<div class="mt-narration">' + esc(seg.text) + '</div>';
    }).join('');
  }

  function listContacts() {
    var cs = chatStore();
    if (!cs || !cs.getContacts) return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && !c.isGroup && c.id;
    });
  }

  function currentSession() {
    return store().findSession(state.sessionId);
  }

  /** 把场次里角色显示名刷成真名（兼容旧场次存的备注名） */
  function syncSessionCharTrueNames(session) {
    if (!session || !Array.isArray(session.participants)) return session;
    var cs = chatStore();
    var changed = false;
    var nameMap = {};
    session.participants.forEach(function (p) {
      if (!p || !p.contactId) return;
      var c = cs && cs.findContact ? cs.findContact(p.contactId) : null;
      if (!c) return;
      var trueName = characterTrueName(c);
      var old = String(p.name || '').trim();
      if (old && old !== trueName) nameMap[old] = trueName;
      if (c.remarkName) {
        var remark = String(c.remarkName).trim();
        if (remark) nameMap[remark] = trueName;
      }
      if (p.name !== trueName) {
        p.name = trueName;
        changed = true;
      }
    });
    if (session.proposerContactId) {
      var pc = cs && cs.findContact ? cs.findContact(session.proposerContactId) : null;
      if (pc) {
        var pn = characterTrueName(pc);
        if (session.proposerName !== pn) {
          session.proposerName = pn;
          changed = true;
        }
      }
    }
    if (Array.isArray(session.reactions) && Object.keys(nameMap).length) {
      session.reactions.forEach(function (rx) {
        if (!rx) return;
        var n = String(rx.name || '').trim();
        if (n && nameMap[n]) {
          rx.name = nameMap[n];
          changed = true;
        }
      });
    }
    if (changed && session.id) {
      store().updateSession(session.id, {
        participants: session.participants,
        proposerName: session.proposerName,
        reactions: session.reactions,
        contextDigest: ''
      });
    }
    return session;
  }

  /** 发送聊天记录前：角色名一律换成真名 */
  function sessionWithTrueNames(session) {
    if (!session) return session;
    var named = syncSessionCharTrueNames(Object.assign({}, session, {
      participants: (session.participants || []).map(function (p) {
        return p ? Object.assign({}, p) : p;
      }),
      reactions: Array.isArray(session.reactions)
        ? session.reactions.map(function (rx) { return rx ? Object.assign({}, rx) : rx; })
        : session.reactions
    }));
    return named;
  }

  function formatTime(ts) {
    var d = new Date(ts || Date.now());
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var hh = ('0' + d.getHours()).slice(-2);
    var mm = ('0' + d.getMinutes()).slice(-2);
    return m + '/' + day + ' ' + hh + ':' + mm;
  }

  function renderRecent() {
    var host = $('mt-recent-list');
    if (!host) return;
    var list = store().listSessions().filter(function (s) {
      return s && (s.status === 'done' || s.status === 'running' || (s.result && s.status !== 'draft'));
    }).slice(0, 5);
    if (!list.length) {
      host.innerHTML = '<div class="mt-empty">还没有比赛记录</div>';
      return;
    }
    host.innerHTML = list.map(function (s) {
      return (
        '<button type="button" class="mt-row" data-mt-open-session="' + esc(s.id) + '">' +
          '<div class="mt-row__main">' +
            '<p class="mt-row__title">' + esc(s.eventName) + ' · ' + esc(s.eventItemName) + '</p>' +
            '<p class="mt-row__meta">' + esc(formatTime(s.updatedAt || s.createdAt)) +
            ' · ' + (s.mode === 'team' ? '阵营赛' : '单人赛') +
            (s.reactions && s.reactions.length ? ' · 已颁奖' : '') + '</p>' +
          '</div>' +
        '</button>'
      );
    }).join('');
  }

  function renderHistory() {
    var host = $('mt-history-list');
    if (!host) return;
    var list = store().listSessions().filter(function (s) {
      return s && s.result;
    });
    if (!list.length) {
      host.innerHTML = '<div class="mt-empty">暂无历史场次</div>';
      return;
    }
    host.innerHTML = list.map(function (s) {
      return (
        '<button type="button" class="mt-row" data-mt-open-session="' + esc(s.id) + '">' +
          '<div class="mt-row__main">' +
            '<p class="mt-row__title">' + esc(s.eventName) + ' · ' + esc(s.eventItemName) + '</p>' +
            '<p class="mt-row__meta">' + esc(formatTime(s.updatedAt || s.createdAt)) +
            ' · ' + ((s.participants || []).length) + ' 人</p>' +
          '</div>' +
        '</button>'
      );
    }).join('');
  }

  function openEvent(eventId) {
    var ev = store().getEvent(eventId);
    if (!ev) return;
    state.eventId = eventId;
    var title = $('mt-event-title');
    var hint = $('mt-event-hint');
    if (title) title.textContent = ev.name;
    if (hint) hint.textContent = ev.subtitle || '选择一个项目单独开赛';
    var host = $('mt-item-list');
    if (host) {
      host.innerHTML = (ev.items || []).map(function (it) {
        return (
          '<button type="button" class="mt-row" data-mt-item="' + esc(it.id) + '">' +
            '<div class="mt-row__main">' +
              '<p class="mt-row__title">' + esc(it.name) + '</p>' +
              '<p class="mt-row__meta">' + esc(it.desc) + '</p>' +
            '</div>' +
          '</button>'
        );
      }).join('');
    }
    setPage('event');
  }

  function setSetupBack(target) {
    state.setupBack = target || 'event';
    var btn = $('mt-setup-back');
    if (btn) btn.setAttribute('data-mt-back', state.setupBack);
  }

  function beginSetup(itemId) {
    var item = store().getEventItem(state.eventId, itemId);
    if (!item) return;
    state.mode = 'solo';
    state.selected = {};
    state.teams = {};
    state.prizes = store().normalizePrizes(null, 'solo');
    var preset = store().getPrizePreset(state.eventId, itemId, 'solo');
    if (preset) state.prizes = store().normalizePrizes(preset, 'solo');

    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var active = chatStore() && chatStore().getActiveProfile ? chatStore().getActiveProfile() : null;
    state.profileId = active && active.id ? active.id : (profiles[0] && profiles[0].id) || '';

    try {
      var draft = store().createDraft({
        eventId: state.eventId,
        eventItemId: itemId,
        mode: state.mode,
        profileId: state.profileId,
        profileName: (active && active.name) || '',
        prizes: state.prizes,
        source: 'builtin'
      });
      state.sessionId = draft.id;
    } catch (e) {
      toast(e.message || '无法创建场次');
      return;
    }

    setSetupBack('event');
    var title = $('mt-setup-title');
    if (title) title.textContent = item.name;
    renderSetup();
    setPage('setup');
  }

  function beginSetupFromCustom(itemId) {
    var item = store().getCustomItem(itemId);
    if (!item) {
      toast('项目不存在');
      return;
    }
    var mode = item.defaultMode === 'team' ? 'team' : 'solo';
    state.eventId = 'custom';
    state.mode = mode;
    state.selected = {};
    state.teams = {};
    state.prizes = store().normalizePrizes(item.defaultPrizes || null, mode);
    var preset = store().getPrizePreset('custom', item.id, mode);
    if (preset) state.prizes = store().normalizePrizes(preset, mode);

    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var active = chatStore() && chatStore().getActiveProfile ? chatStore().getActiveProfile() : null;
    state.profileId = active && active.id ? active.id : (profiles[0] && profiles[0].id) || '';

    try {
      var draft = store().createDraft({
        source: item.fromChar ? 'char_invite' : 'user_custom',
        customItem: item,
        eventItemId: item.id,
        mode: mode,
        profileId: state.profileId,
        profileName: (active && active.name) || '',
        prizes: state.prizes,
        proposerContactId: item.proposerContactId,
        proposerName: item.proposerName
      });
      state.sessionId = draft.id;
      if (item.proposerContactId) {
        state.selected[item.proposerContactId] = true;
        if (mode === 'team') state.teams[item.proposerContactId] = 'A';
      }
    } catch (e) {
      toast(e.message || '无法创建场次');
      return;
    }

    setSetupBack('custom');
    var title = $('mt-setup-title');
    if (title) title.textContent = item.name;
    renderSetup();
    setPage('setup');
  }

  function renderCustomList() {
    var host = $('mt-custom-list');
    if (!host) return;
    var list = store().listCustomItems();
    if (!list.length) {
      host.innerHTML = '<div class="mt-empty">还没有自定义项目<br>点右上角「新建」或「导入」</div>';
      return;
    }
    host.innerHTML = list.map(function (it) {
      var meta = (it.desc || '').slice(0, 48) + ((it.desc || '').length > 48 ? '…' : '');
      var tag = it.fromChar
        ? '<span class="mt-tag">角色提议' + (it.proposerName ? ' · ' + esc(it.proposerName) : '') + '</span>'
        : '';
      return (
        '<div class="mt-row mt-row--custom" data-mt-custom-id="' + esc(it.id) + '">' +
          '<div class="mt-row__main">' +
            '<p class="mt-row__title">' + esc(it.name) + '</p>' +
            '<p class="mt-row__meta">' + esc(meta) + '</p>' +
            tag +
          '</div>' +
          '<div class="mt-row__acts">' +
            '<button type="button" class="mt-mini-link" data-mt-custom-start="' + esc(it.id) + '">开赛</button>' +
            '<button type="button" class="mt-mini-link" data-mt-custom-edit="' + esc(it.id) + '">编辑</button>' +
            '<button type="button" class="mt-mini-link" data-mt-custom-export-one="' + esc(it.id) + '">导出</button>' +
            '<button type="button" class="mt-mini-link mt-mini-link--danger" data-mt-custom-del="' + esc(it.id) + '">删除</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function openCustomLibrary() {
    renderCustomList();
    setPage('custom');
  }

  function openCustomEdit(itemId, fromPage) {
    state.customEditFrom = fromPage || 'custom';
    state.customEditId = itemId ? String(itemId) : '';
    var item = state.customEditId ? store().getCustomItem(state.customEditId) : null;
    state.editDraft = item
      ? {
          id: item.id,
          name: item.name,
          desc: item.desc,
          mood: item.mood || '',
          defaultMode: item.defaultMode || '',
          pitch: item.pitch || '',
          fromChar: !!item.fromChar,
          proposerContactId: item.proposerContactId || '',
          proposerName: item.proposerName || '',
          defaultPrizes: item.defaultPrizes || null
        }
      : {
          name: '',
          desc: '',
          mood: '',
          defaultMode: 'solo',
          pitch: '',
          fromChar: false,
          proposerContactId: '',
          proposerName: '',
          defaultPrizes: null
        };
    var title = $('mt-custom-edit-title');
    if (title) {
      title.textContent = state.customEditId
        ? (state.editDraft.fromChar ? '编辑角色提案' : '编辑项目')
        : '新建项目';
    }
    var backBtn = $('mt-custom-edit-back');
    if (backBtn) backBtn.setAttribute('data-mt-back', state.customEditFrom);
    renderCustomEditForm();
    setPage('custom-edit');
  }

  function openCustomEditFromProposal(proposal) {
    state.customEditFrom = 'char';
    state.customEditId = '';
    state.editDraft = {
      name: proposal.name || '',
      desc: proposal.desc || '',
      mood: proposal.mood || '',
      defaultMode: proposal.defaultMode === 'team' ? 'team' : 'solo',
      pitch: proposal.pitch || '',
      fromChar: true,
      proposerContactId: proposal.proposerContactId || '',
      proposerName: proposal.proposerName || '',
      defaultPrizes: null
    };
    var title = $('mt-custom-edit-title');
    if (title) title.textContent = '确认角色提案';
    var backBtn = $('mt-custom-edit-back');
    if (backBtn) backBtn.setAttribute('data-mt-back', 'char');
    renderCustomEditForm();
    setPage('custom-edit');
  }

  function renderCustomEditForm() {
    var host = $('mt-custom-edit-scroll');
    if (!host || !state.editDraft) return;
    var d = state.editDraft;
    var html = '';
    if (d.pitch) {
      html += '<div class="mt-pitch"><span class="mt-pitch__label">' +
        esc(d.proposerName || '角色') + ' 说</span>' + esc(d.pitch) + '</div>';
    }
    html += '<label class="mt-field"><span class="mt-field__label">项目名称</span>' +
      '<input id="mt-edit-name" maxlength="40" value="' + esc(d.name) + '" placeholder="例如：枕头大战"></label>';
    html += '<label class="mt-field"><span class="mt-field__label">规则 / 说明</span>' +
      '<textarea id="mt-edit-desc" maxlength="2000" rows="5" placeholder="比什么、怎么算赢">' +
      esc(d.desc) + '</textarea></label>';
    html += '<label class="mt-field"><span class="mt-field__label">氛围 / 场景（可选）</span>' +
      '<input id="mt-edit-mood" maxlength="500" value="' + esc(d.mood) + '" placeholder="卧室、枕头飞舞、笑声"></label>';
    html += '<p class="mt-section-label">默认赛制</p><div class="mt-chip-row">';
    html += '<button type="button" class="mt-chip' + (d.defaultMode !== 'team' ? ' is-on' : '') + '" data-mt-edit-mode="solo">单人赛</button>';
    html += '<button type="button" class="mt-chip' + (d.defaultMode === 'team' ? ' is-on' : '') + '" data-mt-edit-mode="team">阵营赛</button>';
    html += '</div>';
    if (d.fromChar && d.proposerName) {
      html += '<p class="mt-hint">发起角色：' + esc(d.proposerName) + ' · 保存后会出现在自定义库</p>';
    }
    host.innerHTML = html;
  }

  function readCustomEditForm() {
    if (!state.editDraft) state.editDraft = {};
    var nameEl = $('mt-edit-name');
    var descEl = $('mt-edit-desc');
    var moodEl = $('mt-edit-mood');
    if (nameEl) state.editDraft.name = nameEl.value || '';
    if (descEl) state.editDraft.desc = descEl.value || '';
    if (moodEl) state.editDraft.mood = moodEl.value || '';
    return state.editDraft;
  }

  function saveCustomItemFromForm(andStart) {
    var draft = readCustomEditForm();
    if (!String(draft.name || '').trim() || !String(draft.desc || '').trim()) {
      toast('请填写名称与规则说明');
      return;
    }
    try {
      var payload = {
        name: draft.name,
        desc: draft.desc,
        mood: draft.mood,
        defaultMode: draft.defaultMode === 'team' ? 'team' : 'solo',
        pitch: draft.pitch || '',
        fromChar: !!draft.fromChar,
        proposerContactId: draft.proposerContactId || '',
        proposerName: draft.proposerName || '',
        defaultPrizes: draft.defaultPrizes || null
      };
      if (state.customEditId) payload.id = state.customEditId;
      var saved = store().saveCustomItem(payload);
      state.customEditId = saved.id;
      toast(andStart ? '已保存，进入组赛' : '已保存到自定义库');
      if (andStart) {
        beginSetupFromCustom(saved.id);
      } else {
        openCustomLibrary();
      }
    } catch (e) {
      toast((e && e.message) || '保存失败');
    }
  }

  function deleteCustomItem(id) {
    var item = store().getCustomItem(id);
    if (!item) return;
    confirmDialog({
      title: '删除自定义项目',
      message: '确定删除「' + item.name + '」？只删预设，已完成的场次仍保留。'
    }).then(function (ok) {
      if (!ok) return;
      store().deleteCustomItem(id);
      toast('已删除');
      renderCustomList();
    });
  }

  function exportCustomAll() {
    var list = store().listCustomItems();
    if (!list.length) {
      toast('暂无项目可导出');
      return;
    }
    var payload = store().exportCustomPayload();
    var ok = downloadJson(payload, 'miya-match-custom-pack.json');
    toast(ok ? '已导出全部自定义项目' : '导出失败');
  }

  function exportCustomOne(id) {
    var item = store().getCustomItem(id);
    if (!item) return;
    var payload = store().exportCustomPayload([id]);
    var ok = downloadJson(payload, 'miya-match-' + sanitizeFileName(item.name) + '.json');
    toast(ok ? '已导出「' + item.name + '」' : '导出失败');
  }

  function importCustomFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var result = store().importCustomItems(String(reader.result || ''), { mode: 'rename' });
        toast('导入完成：新增 ' + result.added +
          (result.overwritten ? ' · 覆盖 ' + result.overwritten : '') +
          (result.skipped ? ' · 跳过 ' + result.skipped : ''));
        renderCustomList();
        setPage('custom');
      } catch (e) {
        toast((e && e.message) || '导入失败');
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  }

  function openCharPick() {
    var host = $('mt-char-pick-grid');
    if (!host) return;
    var contacts = listContacts();
    if (!contacts.length) {
      host.innerHTML = '<div class="mt-empty" style="grid-column:1/-1">暂无聊天联系人</div>';
    } else {
      host.innerHTML = contacts.map(function (c) {
        return (
          '<button type="button" class="mt-pick" data-mt-char-propose="' + esc(c.id) + '">' +
            avatarHtml(c, 'mt-pick__av') +
            '<span class="mt-pick__name">' + esc(characterTrueName(c)) + '</span>' +
          '</button>'
        );
      }).join('');
    }
    setPage('char');
  }

  function proposeFromChar(contactId) {
    var cs = chatStore();
    var contact = cs && cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      toast('找不到该角色');
      return;
    }
    setOverlay(true, '角色构思中…', characterTrueName(contact) + ' 正在提出想比的比赛');
    bridge().proposeMatch(contact).then(function (proposal) {
      setOverlay(false);
      openCustomEditFromProposal(proposal);
    }).catch(function (err) {
      setOverlay(false);
      toast((err && err.message) || '提案失败');
    });
  }

  function selectedParticipants() {
    var contacts = listContacts();
    var out = [];
    Object.keys(state.selected).forEach(function (id) {
      if (!state.selected[id]) return;
      var c = contacts.find(function (x) { return String(x.id) === String(id); });
      if (!c) return;
      out.push({
        contactId: c.id,
        name: characterTrueName(c),
        avatar: c.avatarUrl || c.avatar || '',
        team: state.mode === 'team' ? (state.teams[id] || '') : undefined
      });
    });
    return out;
  }

  function syncDraft() {
    if (!state.sessionId) return;
    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var profile = profiles.find(function (p) { return String(p.id) === String(state.profileId); });
    store().updateSession(state.sessionId, {
      mode: state.mode,
      participants: selectedParticipants(),
      profileId: state.profileId,
      profileName: profile ? profile.name : '',
      prizes: store().normalizePrizes(state.prizes, state.mode)
    });
  }

  function renderSetup() {
    var host = $('mt-setup-scroll');
    if (!host) return;
    var contacts = listContacts();
    var profiles = chatStore() && chatStore().getProfiles ? chatStore().getProfiles() : [];
    var session = currentSession();
    var itemName = session ? session.eventItemName : '';

    var html = '';
    html += '<p class="mt-hint">' + esc(itemName) + ' · 先选赛制，再点选角色' +
      (state.mode === 'team' ? '（再点一次切换阵营 A/B）' : '') + '</p>';

    html += '<p class="mt-section-label">赛制</p><div class="mt-chip-row">';
    html += '<button type="button" class="mt-chip' + (state.mode === 'solo' ? ' is-on' : '') + '" data-mt-mode="solo">单人赛 · 2–8 人排名</button>';
    html += '<button type="button" class="mt-chip' + (state.mode === 'team' ? ' is-on' : '') + '" data-mt-mode="team">阵营赛 · 两边人数相同</button>';
    html += '</div>';

    html += '<p class="mt-section-label">选手</p>';
    if (!contacts.length) {
      html += '<div class="mt-empty">暂无聊天联系人，请先添加角色</div>';
    } else {
      html += '<div class="mt-pick-grid">';
      contacts.forEach(function (c) {
        var on = !!state.selected[c.id];
        var team = state.teams[c.id] || '';
        html += '<button type="button" class="mt-pick' + (on ? ' is-on' : '') + '" data-mt-pick="' + esc(c.id) + '">';
        if (on && state.mode === 'team' && team) {
          html += '<span class="mt-pick__team">' + esc(team) + '</span>';
        }
        html += avatarHtml(c, 'mt-pick__av');
        html += '<span class="mt-pick__name">' + esc(characterTrueName(c)) + '</span>';
        html += '</button>';
      });
      html += '</div>';
    }

    html += '<p class="mt-section-label">主持面具</p><div class="mt-profile-row">';
    if (!profiles.length) {
      html += '<span class="mt-hint">暂无面具，将使用默认身份</span>';
    } else {
      profiles.forEach(function (p) {
        html += '<button type="button" class="mt-profile' + (String(p.id) === String(state.profileId) ? ' is-on' : '') + '" data-mt-profile="' + esc(p.id) + '">';
        var pav = resolveProfileAvatarUrlSync(p);
        if (pav) {
          html += '<img class="mt-profile__av" src="' + esc(pav) + '" alt="">';
        } else {
          html += '<div class="mt-profile__av mt-profile__av--ph">' + esc(String(p.name || '?').slice(0, 1)) + '</div>';
        }
        html += esc(p.name || '未命名') + '</button>';
      });
    }
    html += '</div>';

    html += '<p class="mt-section-label">名次奖品（可不填）</p>';
    var prizes = store().normalizePrizes(state.prizes, state.mode);
    state.prizes = prizes;
    if (state.mode === 'team') {
      html += '<label class="mt-field"><span class="mt-field__label">胜方</span><input data-mt-prize="teamWin" value="' + esc(prizes.teamWin || '') + '" placeholder="可不填"></label>';
      html += '<label class="mt-field"><span class="mt-field__label">败方</span><input data-mt-prize="teamLose" value="' + esc(prizes.teamLose || '') + '" placeholder="可不填"></label>';
      html += '<label class="mt-field"><span class="mt-field__label">MVP</span><input data-mt-prize="mvp" value="' + esc(prizes.mvp || '') + '" placeholder="可不填"></label>';
    } else {
      var n = Math.max(2, Math.min(8, selectedParticipants().length || 2));
      for (var i = 0; i < n; i++) {
        html += '<label class="mt-field"><span class="mt-field__label">第' + (i + 1) + '名</span>' +
          '<input data-mt-prize-rank="' + i + '" value="' + esc((prizes.soloRanks || [])[i] || '') + '" placeholder="可不填"></label>';
      }
    }

    host.innerHTML = html;
    updateSetupStatus();
  }

  function updateSetupStatus() {
    syncDraft();
    var session = currentSession();
    var v = store().validateParticipants(state.mode, session ? session.participants : []);
    var status = $('mt-setup-status');
    var btn = $('mt-start-btn');
    if (status) {
      status.textContent = v.message;
      status.classList.toggle('is-bad', !v.ok);
    }
    if (btn) btn.disabled = !v.ok;
  }

  function togglePick(contactId) {
    var id = String(contactId);
    if (state.selected[id]) {
      if (state.mode === 'team') {
        var t = state.teams[id] || 'A';
        if (t === 'A') {
          state.teams[id] = 'B';
        } else {
          delete state.selected[id];
          delete state.teams[id];
        }
      } else {
        delete state.selected[id];
      }
    } else {
      var count = Object.keys(state.selected).filter(function (k) { return state.selected[k]; }).length;
      if (count >= 8) {
        toast('最多 8 人');
        return;
      }
      state.selected[id] = true;
      if (state.mode === 'team') state.teams[id] = 'A';
    }
    renderSetup();
  }

  function readPrizeInputs() {
    var host = $('mt-setup-scroll');
    if (!host) return;
    if (state.mode === 'team') {
      state.prizes = {
        teamWin: (host.querySelector('[data-mt-prize="teamWin"]') || {}).value || '',
        teamLose: (host.querySelector('[data-mt-prize="teamLose"]') || {}).value || '',
        mvp: (host.querySelector('[data-mt-prize="mvp"]') || {}).value || ''
      };
    } else {
      var ranks = [];
      host.querySelectorAll('[data-mt-prize-rank]').forEach(function (inp) {
        ranks[Number(inp.getAttribute('data-mt-prize-rank'))] = inp.value || '';
      });
      state.prizes = { soloRanks: ranks };
    }
  }

  function startMatch() {
    readPrizeInputs();
    syncDraft();
    var session = currentSession();
    if (!session) return;
    var v = store().validateParticipants(session.mode, session.participants);
    if (!v.ok) {
      toast(v.message);
      return;
    }
    store().setPrizePreset(session.eventId, session.eventItemId, session.mode, session.prizes);
    store().updateSession(session.id, { status: 'running', result: null, reactions: null, prizesFinalizedAt: 0 });
    setOverlay(true, '裁判记录中…', '正在生成赛程，请稍候');
    bridge().runMatch(currentSession()).then(function (result) {
      store().updateSession(state.sessionId, {
        status: 'done',
        result: result,
        contextDigest: ''
      });
      var s = currentSession();
      if (s) {
        syncSessionCharTrueNames(s);
        store().updateSession(s.id, { contextDigest: store().buildContextDigest(s) });
      }
      setOverlay(false);
      renderResult();
      setPage('result');
    }).catch(function (err) {
      setOverlay(false);
      store().updateSession(state.sessionId, { status: 'draft' });
      toast((err && err.message) || '开赛失败');
    });
  }

  function prizeForRank(session, rank) {
    var prizes = session.prizes || {};
    if (session.mode === 'team') return '';
    return (prizes.soloRanks || [])[rank - 1] || '';
  }

  function renderResult() {
    var session = syncSessionCharTrueNames(currentSession());
    var host = $('mt-result-scroll');
    var dock = $('mt-result-dock');
    var title = $('mt-result-title');
    if (!session || !host) return;
    if (title) title.textContent = session.eventItemName || '成绩单';

    var result = session.result || {};
    var html = '';
    if (result.highlight) {
      html += '<div class="mt-panel"><p class="mt-panel__title">金句</p><p class="mt-highlight">' +
        esc(scrubBeatText(result.highlight, session)) + '</p></div>';
    }

    html += '<div class="mt-panel"><p class="mt-panel__title">成绩</p>';
    if (session.mode === 'team') {
      html += '<p class="mt-rank__name">胜方：阵营 ' + esc(result.winnerTeam || '—') + '</p>';
      var prizes = session.prizes || {};
      html += '<p class="mt-rank__prize">胜方奖品：' + esc(prizes.teamWin || '无') + '</p>';
      html += '<p class="mt-rank__prize">败方奖品：' + esc(prizes.teamLose || '无') + '</p>';
      if (result.mvpContactId) {
        var mvp = (session.participants || []).find(function (p) {
          return String(p.contactId) === String(result.mvpContactId);
        });
        html += '<p class="mt-rank__prize">MVP：' + esc(mvp && mvp.name ? mvp.name : result.mvpContactId) +
          (prizes.mvp ? ' · ' + esc(prizes.mvp) : '') + '</p>';
      }
      html += '<div class="mt-chip-row" style="margin-top:10px">';
      html += '<button type="button" class="mt-chip' + (result.winnerTeam === 'A' ? ' is-on' : '') + '" data-mt-winner="A">判 A 胜</button>';
      html += '<button type="button" class="mt-chip' + (result.winnerTeam === 'B' ? ' is-on' : '') + '" data-mt-winner="B">判 B 胜</button>';
      html += '</div>';
    } else {
      var rankings = (result.rankings || []).slice().sort(function (a, b) {
        return a.rank - b.rank;
      });
      rankings.forEach(function (row, idx) {
        var who = (session.participants || []).find(function (p) {
          return String(p.contactId) === String(row.contactId);
        });
        html += '<div class="mt-rank" data-rank-idx="' + idx + '">';
        html += '<div class="mt-rank__n">' + esc(row.rank) + '</div>';
        html += '<div class="mt-rank__body"><p class="mt-rank__name">' + esc(who && who.name ? who.name : row.contactId) + '</p>';
        html += '<p class="mt-rank__prize">奖品：' + esc(prizeForRank(session, row.rank) || '无') +
          (row.note ? ' · ' + esc(row.note) : '') + '</p></div>';
        html += '<div class="mt-rank__acts">';
        html += '<button type="button" class="mt-mini" data-mt-rank-up="' + idx + '" ' + (idx === 0 ? 'disabled' : '') + '>↑</button>';
        html += '<button type="button" class="mt-mini" data-mt-rank-down="' + idx + '" ' + (idx === rankings.length - 1 ? 'disabled' : '') + '>↓</button>';
        html += '</div></div>';
      });
    }
    html += '</div>';

    html += '<div class="mt-panel"><p class="mt-panel__title">完整赛程</p><div class="mt-beat-list">';
    var beats = Array.isArray(result.beats) && result.beats.length
      ? result.beats
      : [result.narrative || '（暂无）'];
    beats.forEach(function (b, i) {
      html += '<div class="mt-beat"><span class="mt-beat__no">SCENE ' + (i + 1) + '</span>' +
        renderBeatBodyHtml(b, session) + '</div>';
    });
    html += '</div></div>';

    if (Array.isArray(session.reactions) && session.reactions.length) {
      html += '<div class="mt-panel"><p class="mt-panel__title">选手最终感想</p>';
      session.reactions.forEach(function (rx) {
        html += '<div class="mt-react"><p class="mt-react__name">' + esc(rx.name) + '</p>' +
          '<p class="mt-react__text">' + esc(scrubBeatText(rx.text, session)) + '</p></div>';
      });
      html += '</div>';
    }

    host.innerHTML = html;

    if (dock) {
      var hasRx = Array.isArray(session.reactions) && session.reactions.length;
      var awardLabel = hasRx ? '重新生成感想' : '颁发奖品';
      var awardShort = hasRx ? '感想' : '颁奖';
      var awardIcon = hasRx
        ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 0113.6-4.4M19.5 12a7.5 7.5 0 01-13.6 4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M18.2 4.8V8h-3.2M5.8 19.2V16h3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 8V6.8A2.8 2.8 0 0110.8 4h2.4A2.8 2.8 0 0116 6.8V8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.5 8h11l-.7 10.2A2.5 2.5 0 0114.3 20.5H9.7a2.5 2.5 0 01-2.5-2.3L6.5 8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 11.5v5M9.8 14h4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      var dockHtml = '<nav class="mt-dock-bar" aria-label="成绩单操作">';
      dockHtml += '<button type="button" class="mt-dock-act' + (hasRx ? '' : ' mt-dock-act--accent') +
        '" id="mt-award-btn" aria-label="' + awardLabel + '" title="' + awardLabel + '">' +
        awardIcon + '<span class="mt-dock-act__lbl">' + awardShort + '</span></button>';
      dockHtml += '<button type="button" class="mt-dock-act" id="mt-send-open" aria-label="发送记录" title="' +
        (!hasRx ? '建议先颁发奖品' : '发送记录') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.4 4.2L4.6 10.4c-.7.28-.68 1.28.05 1.5l5.4 1.66 1.66 5.4c.22.73 1.22.76 1.5.05l6.2-15.8c.24-.62-.38-1.2-.99-.91z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.1 13.6l3.7-3.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
        '<span class="mt-dock-act__lbl">发送</span></button>';
      dockHtml += '<button type="button" class="mt-dock-act" id="mt-replay-btn" aria-label="再赛一场" title="再赛一场">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.2 7.2A6.4 6.4 0 0118.4 12M15.8 16.8A6.4 6.4 0 015.6 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M18.4 8.2V12h-3.8M5.6 15.8V12h3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.35" fill="currentColor"/></svg>' +
        '<span class="mt-dock-act__lbl">再赛</span></button>';
      dockHtml += '</nav>';
      dock.innerHTML = dockHtml;
      dock.classList.add('mt-dock--bar');
    }

    if (!session._hostAvatarWarming) {
      var before = String(session.profileAvatar || '').trim();
      var syncNow = resolveProfileAvatarUrlSync(findSessionProfile(session));
      if (syncNow && syncNow !== before) {
        session.profileAvatar = syncNow;
      }
      if (!resolveProfileAvatarUrlSync(findSessionProfile(session)) && !session.profileAvatar) {
        session._hostAvatarWarming = true;
        warmHostAvatar(session, function (url) {
          session._hostAvatarWarming = false;
          if (url && currentSession() && currentSession().id === session.id) {
            renderResult();
          }
        });
      }
    }
  }

  function swapRanks(idx, dir) {
    var session = currentSession();
    if (!session || !session.result || !session.result.rankings) return;
    var list = session.result.rankings.slice().sort(function (a, b) { return a.rank - b.rank; });
    var j = idx + dir;
    if (j < 0 || j >= list.length) return;
    var tmp = list[idx];
    list[idx] = list[j];
    list[j] = tmp;
    list.forEach(function (r, i) { r.rank = i + 1; });
    session.result.rankings = list;
    session.reactions = null;
    session.prizesFinalizedAt = 0;
    store().updateSession(session.id, {
      result: session.result,
      reactions: null,
      prizesFinalizedAt: 0,
      contextDigest: store().buildContextDigest(session)
    });
    renderResult();
  }

  function setWinner(team) {
    var session = currentSession();
    if (!session || !session.result) return;
    session.result.winnerTeam = team;
    session.reactions = null;
    store().updateSession(session.id, {
      result: session.result,
      reactions: null,
      prizesFinalizedAt: 0,
      contextDigest: store().buildContextDigest(session)
    });
    renderResult();
  }

  function awardPrizes() {
    var session = currentSession();
    if (!session || !session.result) return;
    setOverlay(true, '选手感言中…', '正在生成每位角色的最终感想');
    bridge().runReactions(session).then(function (reactions) {
      store().updateSession(session.id, {
        reactions: reactions,
        prizesFinalizedAt: Date.now()
      });
      var s = currentSession();
      if (s) store().updateSession(s.id, { contextDigest: store().buildContextDigest(s) });
      setOverlay(false);
      renderResult();
      toast('奖品已颁发，感想已生成');
    }).catch(function (err) {
      setOverlay(false);
      toast((err && err.message) || '感想生成失败');
    });
  }

  function openSend() {
    var session = currentSession();
    if (!session) return;
    if (!session.reactions || !session.reactions.length) {
      toast('建议先颁发奖品生成感想');
    }
    state.sendSelected = {};
    (session.participants || []).forEach(function (p) {
      state.sendSelected[p.contactId] = true;
    });
    renderSend();
    setPage('send');
  }

  function renderSend() {
    var session = syncSessionCharTrueNames(currentSession());
    var host = $('mt-send-scroll');
    if (!session || !host) return;
    var html = '<p class="mt-hint">将完整比赛记录以卡片形式发到所选角色的聊天（进入上下文）。</p>';
    html += '<p class="mt-section-label">选择接收角色</p>';
    (session.participants || []).forEach(function (p) {
      html += '<label class="mt-check"><input type="checkbox" data-mt-send="' + esc(p.contactId) + '"' +
        (state.sendSelected[p.contactId] ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
    });
    host.innerHTML = html;
  }

  function slimAvatarForStore(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^blob:/i.test(u)) return '';
    if (/^data:/i.test(u) && u.length > 2048) return '';
    return u;
  }

  function buildMatchRecordPayload(session) {
    var named = sessionWithTrueNames(session);
    var digest = store().buildContextDigest(named);
    var profile = findSessionProfile(named);
    var profileAvatar = slimAvatarForStore(
      resolveProfileAvatarUrlSync(profile) || String(named.profileAvatar || '').trim()
    );
    var participants = (named.participants || []).map(function (p) {
      if (!p || typeof p !== 'object') return null;
      var cs = chatStore();
      var c = cs && cs.findContact ? cs.findContact(p.contactId) : null;
      return {
        contactId: String(p.contactId || '').trim(),
        name: c ? characterTrueName(c) : String(p.name || '').trim(),
        avatar: slimAvatarForStore((c && (c.avatarUrl || c.avatar)) || p.avatar || p.avatarUrl || ''),
        team: p.team === 'B' ? 'B' : p.team === 'A' ? 'A' : undefined
      };
    }).filter(Boolean);
    return {
      role: 'user',
      type: 'match_record',
      content: digest,
      matchRecord: {
        sessionId: named.id,
        eventName: named.eventName,
        eventItemName: named.eventItemName,
        mode: named.mode,
        highlight: (named.result && named.result.highlight) || '',
        narrative: (named.result && named.result.narrative) || '',
        beats: (named.result && named.result.beats) || [],
        rankings: (named.result && named.result.rankings) || null,
        winnerTeam: (named.result && named.result.winnerTeam) || '',
        mvpContactId: (named.result && named.result.mvpContactId) || '',
        prizes: named.prizes || {},
        participants: participants,
        reactions: named.reactions || [],
        profileId: named.profileId || (profile && profile.id) || '',
        profileName: named.profileName || (profile && profile.name) || '',
        profileAvatar: profileAvatar,
        createdAt: named.createdAt
      }
    };
  }

  function ensureChatForContact(contactId, profileId) {
    var cs = chatStore();
    if (!cs) return Promise.reject(new Error('聊天未就绪'));
    var contact = cs.findContact(contactId);
    if (!contact) return Promise.reject(new Error('联系人不存在'));
    /* 发赛事记录必须进主会话（按消息量），勿按主持面具挑空壳会话 */
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
    var ids = Object.keys(state.sendSelected).filter(function (id) {
      return state.sendSelected[id];
    });
    if (!ids.length) {
      toast('请至少选择一位角色');
      return;
    }
    warmHostAvatar(session, function () {
      var payload = buildMatchRecordPayload(session);
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
    });
  }

  function openSession(id) {
    var s = store().findSession(id);
    if (!s || !s.result) {
      toast('场次无成绩');
      return;
    }
    state.sessionId = s.id;
    renderResult();
    setPage('result');
  }

  function replay() {
    var session = currentSession();
    if (!session) return;
    if (session.source === 'user_custom' || session.source === 'char_invite' || session.eventId === 'custom') {
      var item = store().getCustomItem(session.eventItemId);
      if (item) {
        beginSetupFromCustom(item.id);
        return;
      }
      try {
        var saved = store().saveCustomItem({
          name: session.eventItemName,
          desc: session.eventItemDesc,
          mood: session.eventMood,
          defaultMode: session.mode,
          fromChar: session.source === 'char_invite',
          proposerContactId: session.proposerContactId,
          proposerName: session.proposerName
        });
        beginSetupFromCustom(saved.id);
      } catch (e) {
        toast((e && e.message) || '无法再赛');
      }
      return;
    }
    state.eventId = session.eventId;
    beginSetup(session.eventItemId);
  }

  function bindEvents() {
    if (state.bound) return;
    state.bound = true;
    var root = $('miya-match-app');
    if (!root) return;

    root.addEventListener('click', function (e) {
      var t = e.target.closest(
        '[data-mt-gate],[data-mt-back],[data-mt-item],[data-mt-mode],[data-mt-pick],[data-mt-profile],' +
        '[data-mt-open-session],[data-mt-rank-up],[data-mt-rank-down],[data-mt-winner],' +
        '[data-mt-custom-start],[data-mt-custom-edit],[data-mt-custom-del],[data-mt-custom-export-one],' +
        '[data-mt-char-propose],[data-mt-edit-mode],' +
        '#mt-close,#mt-open-history,#mt-start-btn,#mt-award-btn,#mt-send-open,#mt-replay-btn,#mt-send-confirm,' +
        '#mt-custom-new,#mt-custom-import,#mt-custom-export,#mt-custom-save-start,#mt-custom-save-only'
      );
      if (!t) return;

      if (t.id === 'mt-close') {
        closeMatchApp();
        return;
      }
      if (t.id === 'mt-open-history') {
        renderHistory();
        setPage('history');
        return;
      }
      if (t.id === 'mt-start-btn') {
        startMatch();
        return;
      }
      if (t.id === 'mt-award-btn') {
        awardPrizes();
        return;
      }
      if (t.id === 'mt-send-open') {
        openSend();
        return;
      }
      if (t.id === 'mt-replay-btn') {
        replay();
        return;
      }
      if (t.id === 'mt-send-confirm') {
        confirmSend();
        return;
      }
      if (t.id === 'mt-custom-new') {
        openCustomEdit('', 'custom');
        return;
      }
      if (t.id === 'mt-custom-import') {
        var fileInp = $('mt-custom-import-file');
        if (fileInp) {
          fileInp.value = '';
          fileInp.click();
        }
        return;
      }
      if (t.id === 'mt-custom-export') {
        exportCustomAll();
        return;
      }
      if (t.id === 'mt-custom-save-start') {
        saveCustomItemFromForm(true);
        return;
      }
      if (t.id === 'mt-custom-save-only') {
        saveCustomItemFromForm(false);
        return;
      }

      var gate = t.getAttribute('data-mt-gate');
      if (gate === 'olympics' || gate === 'talent') {
        openEvent(gate);
        return;
      }
      if (gate === 'custom') {
        openCustomLibrary();
        return;
      }
      if (gate === 'char') {
        openCharPick();
        return;
      }

      var back = t.getAttribute('data-mt-back');
      if (back) {
        if (back === 'home') {
          renderRecent();
          setPage('home');
        } else if (back === 'event') {
          setPage('event');
        } else if (back === 'result') {
          setPage('result');
        } else if (back === 'custom') {
          openCustomLibrary();
        } else if (back === 'char') {
          openCharPick();
        } else if (back === 'custom-edit') {
          setPage('custom-edit');
        }
        return;
      }

      var item = t.getAttribute('data-mt-item');
      if (item) {
        beginSetup(item);
        return;
      }

      var customStart = t.getAttribute('data-mt-custom-start');
      if (customStart) {
        beginSetupFromCustom(customStart);
        return;
      }
      var customEdit = t.getAttribute('data-mt-custom-edit');
      if (customEdit) {
        openCustomEdit(customEdit, 'custom');
        return;
      }
      var customDel = t.getAttribute('data-mt-custom-del');
      if (customDel) {
        deleteCustomItem(customDel);
        return;
      }
      var customExp = t.getAttribute('data-mt-custom-export-one');
      if (customExp) {
        exportCustomOne(customExp);
        return;
      }

      var charPropose = t.getAttribute('data-mt-char-propose');
      if (charPropose) {
        proposeFromChar(charPropose);
        return;
      }

      var editMode = t.getAttribute('data-mt-edit-mode');
      if (editMode) {
        readCustomEditForm();
        state.editDraft.defaultMode = editMode === 'team' ? 'team' : 'solo';
        renderCustomEditForm();
        return;
      }

      var mode = t.getAttribute('data-mt-mode');
      if (mode) {
        readPrizeInputs();
        state.mode = mode === 'team' ? 'team' : 'solo';
        if (state.mode === 'solo') state.teams = {};
        else {
          Object.keys(state.selected).forEach(function (id) {
            if (state.selected[id] && !state.teams[id]) state.teams[id] = 'A';
          });
        }
        var sess = currentSession();
        state.prizes = store().normalizePrizes(
          store().getPrizePreset(state.eventId, sess && sess.eventItemId, state.mode) || state.prizes,
          state.mode
        );
        renderSetup();
        return;
      }

      var pick = t.getAttribute('data-mt-pick');
      if (pick) {
        readPrizeInputs();
        togglePick(pick);
        return;
      }

      var profile = t.getAttribute('data-mt-profile');
      if (profile) {
        readPrizeInputs();
        state.profileId = profile;
        renderSetup();
        return;
      }

      var sid = t.getAttribute('data-mt-open-session');
      if (sid) {
        openSession(sid);
        return;
      }

      if (t.hasAttribute('data-mt-rank-up')) {
        swapRanks(Number(t.getAttribute('data-mt-rank-up')), -1);
        return;
      }
      if (t.hasAttribute('data-mt-rank-down')) {
        swapRanks(Number(t.getAttribute('data-mt-rank-down')), 1);
        return;
      }
      var win = t.getAttribute('data-mt-winner');
      if (win) setWinner(win);
    });

    root.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'mt-custom-import-file') {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        importCustomFromFile(f);
        return;
      }
      var inp = e.target.closest('[data-mt-send]');
      if (!inp) return;
      state.sendSelected[inp.getAttribute('data-mt-send')] = !!inp.checked;
    });

    root.addEventListener('input', function (e) {
      if (e.target.closest('[data-mt-prize],[data-mt-prize-rank]')) {
        readPrizeInputs();
        syncDraft();
      }
    });
  }

  function openMatchApp() {
    var el = $('miya-match-app');
    if (!el) return;
    var chain = Promise.resolve();
    var cs = chatStore();
    if (cs && cs.init) chain = chain.then(function () { return cs.init(); });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () { return cts.whenReady(); });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      if (global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(el);
      bindEvents();
      renderRecent();
      setPage('home');
    });
  }

  function closeMatchApp() {
    var el = $('miya-match-app');
    if (!el) return;
    setOverlay(false);
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (
      !document.querySelector('.miya-beautify-app.is-open') &&
      !document.querySelector('.miya-settings-app.is-open') &&
      !document.querySelector('.miya-worldbook-app.is-open') &&
      !document.querySelector('.miya-contacts-app.is-open') &&
      !document.querySelector('#miya-music-app.is-open') &&
      !document.querySelector('#miya-chat-app.is-open') &&
      !document.querySelector('#miya-memory-app.is-open') &&
      !document.querySelector('#miya-offline-app.is-open') &&
      !document.querySelector('#miya-typewriter-app.is-open') &&
      !document.querySelector('#miya-forum-app.is-open') &&
      !document.querySelector('.miya-cstore-app.is-open') &&
      !document.querySelector('.miya-itinerary-app.is-open') &&
      !document.querySelector('.miya-couple-app.is-open') &&
      !document.querySelector('.miya-weather-app.is-open') &&
      !document.querySelector('.miya-match-app.is-open')
    ) {
      document.body.classList.remove('miya-app-open');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  global.miyaMatchApp = {
    open: openMatchApp,
    close: closeMatchApp,
    buildMatchRecordPayload: buildMatchRecordPayload
  };
})(typeof window !== 'undefined' ? window : this);
