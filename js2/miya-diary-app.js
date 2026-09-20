/**
 * miya-diary-app.js — 日记
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    selectedContactId: '',
    selectedProfileId: '',
    settingsContactId: '',
    readingDiaryId: '',
    readingUserDiaryId: '',
    readerKind: 'char',
    userEditing: false,
    generating: false
  };

  var toastTimer = 0;
  var LAYOUTS = ['a', 'b', 'c'];
  var WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function store() { return global.miyaDiaryStore || null; }
  function bridge() { return global.miyaDiaryBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function repairDiaryRow(row) {
    var br = bridge();
    if (!br || !row || typeof br.parseDiaryFromApi !== 'function') return row;
    var content = String(row.content || '').trim();
    if (!/^\{/.test(content) || !/"content"\s*:/.test(content)) return row;
    try {
      var parsed = br.parseDiaryFromApi(content);
      if (parsed.content && !/^\{/.test(String(parsed.content || '').trim())) {
        return Object.assign({}, row, {
          title: parsed.title || row.title,
          mood: parsed.mood || row.mood,
          content: parsed.content
        });
      }
    } catch (e) { /* keep original */ }
    return row;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dy-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2600);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDateChip() {
    var d = new Date();
    return WEEKDAY_CN[d.getDay()] + ' · ' + MONTH_EN[d.getMonth()] + ' ' + d.getDate();
  }

  function formatDiaryDate(iso) {
    var parts = String(iso || '').split('-').map(Number);
    if (parts.length < 3) return iso || '';
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return parts[0] + '.' + pad(parts[1]) + '.' + pad(parts[2]) + '  ' + WEEKDAY_CN[d.getDay()];
  }

  function diaryMetaParts(iso) {
    var parts = String(iso || '').split('-').map(Number);
    if (parts.length < 3) return { day: '—', mon: '—', wd: '—' };
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return {
      day: pad(parts[2]),
      mon: pad(parts[1]) + '月',
      wd: WEEKDAY_CN[d.getDay()]
    };
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    return (cs.getContacts() || []).find(function (c) { return c && c.id === id; }) || null;
  }

  function getProfiles() {
    var cs = chatStore();
    return cs && cs.getProfiles ? cs.getProfiles() : [];
  }

  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.remarkName || contact.name || '未命名').trim();
  }

  function profileDisplayName(profile) {
    if (!profile) return '未命名面具';
    return String(profile.name || '未命名面具').trim();
  }

  function chronicleAvatar(contact) {
    var cts = global.miyaContactsStore;
    if (!cts || !contact) return '';
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    if (!roleId || typeof cts.findCharacter !== 'function') return '';
    var ch = cts.findCharacter(roleId);
    return ch && ch.avatar ? String(ch.avatar).trim() : '';
  }

  function resolveAvatarUrl(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    var direct = String(contact.avatar || '').trim();
    if (direct) return Promise.resolve(direct);
    var blobId = String(contact.avatarBlobId || '').trim();
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) {
          return url || chronicleAvatar(contact) || '';
        }).catch(function () {
          return chronicleAvatar(contact) || '';
        });
      }
    }
    return Promise.resolve(chronicleAvatar(contact) || '');
  }

  function resolveProfileAvatarUrl(profile) {
    var cs = chatStore();
    if (!profile) return Promise.resolve('');
    var direct = String(profile.avatarUrl || profile.avatar || '').trim();
    if (direct) return Promise.resolve(direct);
    var blobId = String(profile.avatarId || profile.avatarBlobId || '').trim();
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).catch(function () { return ''; });
      }
    }
    return Promise.resolve('');
  }

  function profileAvatarHtml(profile, cls, letter) {
    cls = cls || 'dy-user-chip__ava';
    var ch = letter || String(profileDisplayName(profile)).charAt(0);
    return '<span class="' + cls + ' ' + cls + '--ph" data-dy-profile-ava="' + esc(profile.id) + '">' + esc(ch) + '</span>';
  }

  function hydrateProfileAvatars() {
    document.querySelectorAll('[data-dy-profile-ava]').forEach(function (el) {
      var id = el.getAttribute('data-dy-profile-ava');
      var profile = getProfiles().find(function (p) { return p && p.id === id; }) || null;
      if (!profile) return;
      resolveProfileAvatarUrl(profile).then(function (url) {
        if (!url) return;
        var cls = el.className.replace(/\s*--ph/g, '').split(' ').filter(Boolean).join(' ');
        el.outerHTML = '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy" data-dy-profile-ava="' + esc(id) + '">';
      });
    });
  }

  function avatarHtml(contact, cls, letter) {
    cls = cls || 'dy-bookmark__ava';
    var ch = letter || String(displayName(contact)).charAt(0);
    return '<span class="' + cls + ' ' + cls + '--ph" data-dy-ava="' + esc(contact.id) + '">' + esc(ch) + '</span>';
  }

  function hydrateAvatars() {
    document.querySelectorAll('[data-dy-ava]').forEach(function (el) {
      var id = el.getAttribute('data-dy-ava');
      var contact = getContact(id);
      if (!contact) return;
      resolveAvatarUrl(contact).then(function (url) {
        if (!url) return;
        var cls = el.className.replace(/\s*--ph/g, '').split(' ').filter(Boolean).join(' ');
        el.outerHTML = '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy" data-dy-ava="' + esc(id) + '">';
      });
    });
  }

  function excerpt(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    max = max || 120;
    return t.length <= max ? t : t.slice(0, max) + '…';
  }

  function layoutForIndex(i) { return LAYOUTS[i % LAYOUTS.length]; }

  function renderIndex() {
    var listEl = $('dy-index-list');
    var st = store();
    if (!listEl || !st) return;
    var rows = st.getAllContactRows();
    if (!rows.length) {
      listEl.innerHTML = '<p class="dy-empty-hint">暂无角色 · 请先添加联系人</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (contact) {
      var active = state.selectedContactId === contact.id ? ' is-active' : '';
      var count = st.getContactDiaries(contact.id).length;
      return (
        '<button type="button" class="dy-bookmark' + active + '" data-dy-contact="' + esc(contact.id) + '">' +
          '<span class="dy-bookmark__tab">' +
            avatarHtml(contact, 'dy-bookmark__ava') +
            '<span class="dy-bookmark__name">' + esc(displayName(contact)) + '</span>' +
          '</span>' +
          '<span class="dy-bookmark__count">' + count + 'p</span>' +
        '</button>'
      );
    }).join('');
    hydrateAvatars();
  }

  function renderShelf() {
    var shelfEl = $('dy-shelf');
    var heroName = $('dy-hero-name');
    var heroSub = $('dy-hero-sub');
    var heroAva = $('dy-hero-ava');
    var heroSticker = $('dy-hero-sticker');
    var st = store();
    if (!shelfEl || !st) return;

    var contact = getContact(state.selectedContactId);
    if (!contact) {
      if (heroName) heroName.textContent = '选一位角色';
      if (heroSub) heroSub.textContent = '从下方滑动选择';
      if (heroAva) heroAva.innerHTML = '<span class="dy-hero__ava dy-hero__ava--ph">?</span>';
      if (heroSticker) heroSticker.textContent = 'entries';
      shelfEl.innerHTML =
        '<div class="dy-empty">' +
          '<p>先选一位角色<br>再写下或生成今日日记</p>' +
          '<em>pick someone</em>' +
        '</div>';
      return;
    }

    var count = st.getContactDiaries(contact.id).length;
    if (heroName) heroName.textContent = displayName(contact);
    if (heroSub) heroSub.textContent = count ? ('已留下 ' + count + ' 篇') : '还没有日记';
    if (heroSticker) heroSticker.textContent = count + ' entries';
    if (heroAva) {
      heroAva.innerHTML = avatarHtml(contact, 'dy-hero__ava');
      resolveAvatarUrl(contact).then(function (url) {
        if (!url || !heroAva) return;
        heroAva.innerHTML = '<img class="dy-hero__ava" src="' + esc(url) + '" alt="" loading="lazy">';
      });
    }

    var diaries = st.getContactDiaries(contact.id);
    if (!diaries.length) {
      shelfEl.innerHTML =
        '<div class="dy-empty">' +
          '<p>空白的一页<br>点「写今日」或底部 ＋</p>' +
          '<em>new page</em>' +
        '</div>';
      return;
    }

    shelfEl.innerHTML = diaries.map(function (row, i) {
      return renderCharDiaryCard(row, i);
    }).join('');
  }

  function renderDiaryCard(row, i, readAttr) {
    row = repairDiaryRow(row);
    var layout = layoutForIndex(i);
    var mood = row.mood || (readAttr === 'data-dy-user-read' ? '我的' : '日记');
    var words = row.wordCount || String(row.content || '').replace(/\s/g, '').length;
    var meta = diaryMetaParts(row.dateIso);
    var notchHtml = layout === 'a'
      ? '<span class="dy-page__notch dy-page__notch--l" aria-hidden="true"></span>' +
        '<span class="dy-page__notch dy-page__notch--r" aria-hidden="true"></span>'
      : '';
    return (
      '<button type="button" class="dy-card" ' + readAttr + '="' + esc(row.id) + '">' +
        '<article class="dy-page dy-page--' + layout + '">' +
          '<span class="dy-page__ribbon" aria-hidden="true"></span>' +
          notchHtml +
          '<header class="dy-page__head">' +
            '<span class="dy-page__date">' + esc(formatDiaryDate(row.dateIso)) + '</span>' +
            '<span class="dy-page__mood">' + esc(mood) + '</span>' +
          '</header>' +
          '<h3 class="dy-page__title">' + esc(row.title) + '</h3>' +
          '<div class="dy-page__meta" aria-hidden="true">' +
            '<div class="dy-page__meta-item"><span class="dy-page__meta-label">Day</span><span class="dy-page__meta-val">' + esc(meta.day) + '</span></div>' +
            '<div class="dy-page__meta-item"><span class="dy-page__meta-label">Month</span><span class="dy-page__meta-val">' + esc(meta.mon) + '</span></div>' +
            '<div class="dy-page__meta-item"><span class="dy-page__meta-label">Words</span><span class="dy-page__meta-val">' + words + '</span></div>' +
          '</div>' +
          '<p class="dy-page__excerpt">' + esc(excerpt(row.content, 140)) + '</p>' +
          '<footer class="dy-page__foot">' +
            '<span class="dy-page__cursive">' + esc(String(mood).slice(0, 12) || 'noted') + '</span>' +
            '<span class="dy-page__open">阅读</span>' +
          '</footer>' +
        '</article>' +
      '</button>'
    );
  }

  function renderCharDiaryCard(row, i) {
    return renderDiaryCard(row, i, 'data-dy-read');
  }

  function renderUserMaskChips() {
    var listEl = $('dy-user-mask-chips');
    if (!listEl) return;
    var profiles = getProfiles();
    if (!profiles.length) {
      listEl.innerHTML = '<p class="dy-user-empty-hint">暂无面具 · 请先在聊天中创建</p>';
      return;
    }
    listEl.innerHTML = profiles.map(function (profile) {
      var active = state.selectedProfileId === profile.id ? ' is-active' : '';
      var st = store();
      var count = st ? st.getUserDiaries(profile.id).length : 0;
      return (
        '<button type="button" class="dy-user-chip' + active + '" data-dy-user-profile="' + esc(profile.id) + '">' +
          profileAvatarHtml(profile, 'dy-user-chip__ava') +
          '<span class="dy-user-chip__name">' + esc(profileDisplayName(profile)) + '</span>' +
          '<span class="dy-user-chip__count">' + count + '</span>' +
        '</button>'
      );
    }).join('');
    hydrateProfileAvatars();
  }

  function renderUserShelf() {
    var shelfEl = $('dy-user-shelf');
    var heroName = $('dy-user-hero-name');
    var heroSub = $('dy-user-hero-sub');
    var heroAva = $('dy-user-hero-ava');
    var st = store();
    if (!shelfEl || !st) return;

    var profiles = getProfiles();
    var profile = profiles.find(function (p) { return p && p.id === state.selectedProfileId; }) || null;
    if (!profile) {
      if (heroName) heroName.textContent = '选一面具';
      if (heroSub) heroSub.textContent = '以该身份记录今日心事';
      if (heroAva) heroAva.innerHTML = '<span class="dy-hero__ava dy-hero__ava--ph">我</span>';
      shelfEl.innerHTML =
        '<div class="dy-empty">' +
          '<p>从上方选一面具<br>开始写下心事</p>' +
          '<em>my pages</em>' +
        '</div>';
      return;
    }

    if (heroName) heroName.textContent = profileDisplayName(profile);
    if (heroSub) heroSub.textContent = st.getUserDiaries(profile.id).length + ' 篇日记';
    if (heroAva) {
      heroAva.innerHTML = profileAvatarHtml(profile, 'dy-hero__ava');
      resolveProfileAvatarUrl(profile).then(function (url) {
        if (!url || !heroAva) return;
        heroAva.innerHTML = '<img class="dy-hero__ava" src="' + esc(url) + '" alt="" loading="lazy">';
      });
    }

    var diaries = st.getUserDiaries(profile.id);
    if (!diaries.length) {
      shelfEl.innerHTML =
        '<div class="dy-empty">' +
          '<p>这个面具还没有日记<br>点右上角「＋ 写」</p>' +
          '<em>start writing</em>' +
        '</div>';
      return;
    }

    shelfEl.innerHTML = diaries.map(function (row, i) {
      return renderUserDiaryCard(row, i);
    }).join('');
  }

  function renderUserDiaryCard(row, i) {
    return renderDiaryCard(row, i, 'data-dy-user-read');
  }

  function setReaderFootVisible(visible) {
    var footEl = document.querySelector('#dy-reader .dy-reader__foot');
    if (footEl) footEl.hidden = !visible;
  }

  function setReaderTools(html, visible) {
    var toolsEl = $('dy-reader-tools');
    if (!toolsEl) return;
    if (!visible || !html) {
      toolsEl.hidden = true;
      toolsEl.innerHTML = '';
      return;
    }
    toolsEl.hidden = false;
    toolsEl.innerHTML = html;
  }

  function renderReader(diaryId, kind) {
    kind = kind || state.readerKind || 'char';
    state.readerKind = kind;
    var reader = $('dy-reader');
    var st = store();
    if (!reader || !st) return;

    var row = null;
    if (kind === 'user') {
      if (!state.selectedProfileId) return;
      row = st.findUserDiary(state.selectedProfileId, diaryId);
      state.readingUserDiaryId = diaryId;
      state.readingDiaryId = '';
    } else {
      if (!state.selectedContactId) return;
      row = st.getContactDiaries(state.selectedContactId).find(function (d) { return d && d.id === diaryId; });
      state.readingDiaryId = diaryId;
      state.readingUserDiaryId = '';
    }
    if (!row) {
      reader.classList.remove('is-open');
      return;
    }
    row = repairDiaryRow(row);

    var modeTitle = $('dy-reader-mode-title');
    var titleEl = $('dy-reader-title');
    var dateEl = $('dy-reader-date');
    var moodEl = $('dy-reader-mood');
    var bodyEl = $('dy-reader-body');
    var editEl = $('dy-reader-edit');
    var wcEl = $('dy-reader-wc');
    var actsEl = $('dy-reader-acts');

    if (modeTitle) modeTitle.textContent = kind === 'user' ? '我的日记' : '正文';
    if (titleEl) titleEl.textContent = row.title || '日记';
    if (dateEl) dateEl.textContent = formatDiaryDate(row.dateIso);
    if (moodEl) {
      if (kind === 'user' || !row.mood) {
        moodEl.hidden = true;
      } else {
        moodEl.textContent = row.mood;
        moodEl.hidden = false;
      }
    }

    if (kind === 'user' && state.userEditing) {
      if (bodyEl) {
        bodyEl.hidden = true;
        bodyEl.innerHTML = '';
      }
      if (editEl) {
        editEl.hidden = false;
        editEl.value = row.content || '';
      }
      if (actsEl) {
        actsEl.innerHTML =
          '<button type="button" class="dy-reader__save" id="dy-reader-save">保存</button>' +
          '<button type="button" class="dy-reader__cancel" id="dy-reader-cancel-edit">取消</button>';
      }
      setReaderFootVisible(true);
      setReaderTools('', false);
    } else {
      if (bodyEl) {
        bodyEl.hidden = false;
        var paras = String(row.content || '').split(/\n+/).filter(Boolean);
        bodyEl.innerHTML = paras.map(function (p) {
          return '<p>' + esc(p) + '</p>';
        }).join('');
      }
      if (editEl) {
        editEl.hidden = true;
        editEl.value = '';
      }
      if (kind === 'user') {
        setReaderFootVisible(false);
        setReaderTools(
          '<button type="button" class="dy-reader__tool" id="dy-reader-edit-btn">编辑</button>' +
          '<button type="button" class="dy-reader__tool dy-reader__tool--del" id="dy-reader-del">删除</button>',
          true
        );
      } else {
        setReaderFootVisible(true);
        setReaderTools('', false);
        if (actsEl) {
          actsEl.innerHTML = '<button type="button" class="dy-reader__del" id="dy-reader-del">删除</button>';
        }
      }
    }

    if (wcEl) {
      var wc = row.wordCount || String(row.content || '').replace(/\s/g, '').length;
      wcEl.textContent = wc + ' words';
    }
    reader.classList.add('is-open');
    bindReaderDynamicActions(kind);
  }

  function bindReaderDynamicActions(kind) {
    var saveBtn = $('dy-reader-save');
    var cancelBtn = $('dy-reader-cancel-edit');
    var editBtn = $('dy-reader-edit-btn');
    var delBtn = $('dy-reader-del');

    if (saveBtn) saveBtn.onclick = saveUserDiaryEdit;
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        state.userEditing = false;
        if (state.readingUserDiaryId) renderReader(state.readingUserDiaryId, 'user');
      };
    }
    if (editBtn) {
      editBtn.onclick = function () {
        state.userEditing = true;
        renderReader(state.readingUserDiaryId, 'user');
      };
    }
    if (delBtn) {
      delBtn.onclick = function () {
        if (kind === 'user') deleteCurrentUserDiary();
        else deleteCurrentDiary();
      };
    }
  }

  function openUserCompose() {
    if (!state.selectedProfileId) {
      toast('请先选择一面具');
      return;
    }
    var st = store();
    if (!st) return;
    var today = st.isoDate(new Date());
    state.userEditing = true;
    state.readerKind = 'user';
    state.readingUserDiaryId = '';
    var reader = $('dy-reader');
    if (reader) reader.classList.add('is-open');

    var modeTitle = $('dy-reader-mode-title');
    var titleEl = $('dy-reader-title');
    var dateEl = $('dy-reader-date');
    var moodEl = $('dy-reader-mood');
    var bodyEl = $('dy-reader-body');
    var editEl = $('dy-reader-edit');
    var wcEl = $('dy-reader-wc');
    var actsEl = $('dy-reader-acts');

    if (modeTitle) modeTitle.textContent = '写一篇';
    if (titleEl) titleEl.textContent = today + ' 的随笔';
    if (dateEl) dateEl.textContent = formatDiaryDate(today);
    if (moodEl) moodEl.hidden = true;
    if (bodyEl) {
      bodyEl.hidden = true;
      bodyEl.innerHTML = '';
    }
    if (editEl) {
      editEl.hidden = false;
      editEl.value = '';
    }
    if (wcEl) wcEl.textContent = '新日记';
    setReaderFootVisible(true);
    setReaderTools('', false);
    if (actsEl) {
      actsEl.innerHTML =
        '<button type="button" class="dy-reader__save" id="dy-reader-save">保存</button>' +
        '<button type="button" class="dy-reader__cancel" id="dy-reader-cancel-compose">取消</button>';
    }
    var cancelCompose = $('dy-reader-cancel-compose');
    if (cancelCompose) {
      cancelCompose.onclick = function () {
        state.userEditing = false;
        closeReader();
      };
    }
    bindReaderDynamicActions('user');
    if (editEl) editEl.focus();
  }

  function saveUserDiaryEdit() {
    var st = store();
    var editEl = $('dy-reader-edit');
    if (!st || !editEl || !state.selectedProfileId) return;
    var content = String(editEl.value || '').trim();
    if (!content) {
      toast('写点什么吧');
      return;
    }
    var titleEl = $('dy-reader-title');
    var title = titleEl ? String(titleEl.textContent || '').trim() : '';
    var today = st.isoDate(new Date());
    var existing = state.readingUserDiaryId ? st.findUserDiary(state.selectedProfileId, state.readingUserDiaryId) : null;
    var row = st.saveUserDiary(state.selectedProfileId, {
      id: existing ? existing.id : undefined,
      dateIso: existing ? existing.dateIso : today,
      title: title || (today + ' 的随笔'),
      content: content,
      createdAt: existing ? existing.createdAt : Date.now()
    });
    if (!row) {
      toast('保存失败');
      return;
    }
    state.userEditing = false;
    state.readingUserDiaryId = row.id;
    toast('已保存');
    renderUserAll();
    renderReader(row.id, 'user');
  }

  function closeReader() {
    var reader = $('dy-reader');
    if (reader) reader.classList.remove('is-open');
    setReaderFootVisible(true);
    setReaderTools('', false);
    state.readingDiaryId = '';
    state.readingUserDiaryId = '';
    state.userEditing = false;
  }

  function closeSettings() {
    var panel = $('dy-settings');
    if (!panel) return;
    var wasOpen = panel.classList.contains('is-open');
    panel.hidden = true;
    panel.classList.remove('is-open');
    if (wasOpen) saveSettingsFromForm();
  }

  function openSettings() {
    closeUserPage();
    closeReader();
    var panel = $('dy-settings');
    if (!panel) return;
    var contacts = store() ? store().getAllContactRows() : [];
    if (!state.settingsContactId && contacts.length) {
      state.settingsContactId = state.selectedContactId || contacts[0].id;
    }
    populateSettingsForm();
    panel.hidden = false;
    panel.classList.add('is-open');
  }

  function closeUserPage() {
    var panel = $('dy-user');
    if (panel) {
      panel.hidden = true;
      panel.classList.remove('is-open');
    }
    closeReader();
  }

  function openUserPage() {
    closeSettings();
    closeReader();
    var panel = $('dy-user');
    if (!panel) return;
    var profiles = getProfiles();
    if (!state.selectedProfileId && profiles.length) {
      state.selectedProfileId = profiles[0].id;
    }
    renderUserAll();
    panel.hidden = false;
    panel.classList.add('is-open');
  }

  function populateSettingsForm() {
    var select = $('dy-settings-contact');
    var st = store();
    if (!select || !st) return;
    var contacts = st.getAllContactRows();
    select.innerHTML = contacts.map(function (c) {
      var sel = state.settingsContactId === c.id ? ' selected' : '';
      return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(displayName(c)) + '</option>';
    }).join('');
    if (!state.settingsContactId && contacts.length) {
      state.settingsContactId = contacts[0].id;
    }
    loadSettingsToForm(state.settingsContactId);
  }

  function loadSettingsToForm(contactId) {
    var st = store();
    if (!st || !contactId) return;
    var s = st.getDiarySettings(contactId);
    var autoEnabled = $('dy-set-auto-enabled');
    var autoTime = $('dy-set-auto-time');
    var peekEnabled = $('dy-set-peek-enabled');
    var peekChance = $('dy-set-peek-chance');
    var peekVal = $('dy-set-peek-val');
    if (autoEnabled) autoEnabled.checked = !!s.autoWrite.enabled;
    if (autoTime) {
      autoTime.value = pad(s.autoWrite.hour) + ':' + pad(s.autoWrite.minute);
    }
    if (peekEnabled) peekEnabled.checked = !!s.peek.enabled;
    if (peekChance) peekChance.value = String(s.peek.chance);
    if (peekVal) peekVal.textContent = s.peek.chance + '%';
  }

  function saveSettingsFromForm() {
    var st = store();
    var contactId = state.settingsContactId;
    if (!st || !contactId) return;
    var autoEnabled = $('dy-set-auto-enabled');
    var autoTime = $('dy-set-auto-time');
    var peekEnabled = $('dy-set-peek-enabled');
    var peekChance = $('dy-set-peek-chance');
    var hour = 22;
    var minute = 0;
    if (autoTime && autoTime.value) {
      var parts = String(autoTime.value).split(':');
      hour = parseInt(parts[0], 10);
      minute = parseInt(parts[1], 10);
    }
    st.saveDiarySettings(contactId, {
      autoWrite: {
        enabled: !!(autoEnabled && autoEnabled.checked),
        hour: hour,
        minute: minute
      },
      peek: {
        enabled: !!(peekEnabled && peekEnabled.checked),
        chance: peekChance ? parseInt(peekChance.value, 10) : 15
      }
    });
  }

  function renderAll() {
    var chip = $('dy-date-chip');
    if (chip) chip.textContent = formatDateChip();
    renderIndex();
    renderShelf();
    if (state.readingDiaryId && state.readerKind === 'char') renderReader(state.readingDiaryId, 'char');
  }

  function renderUserAll() {
    renderUserMaskChips();
    renderUserShelf();
    if (state.readingUserDiaryId && state.readerKind === 'user') renderReader(state.readingUserDiaryId, 'user');
  }

  function setLoading(on, text) {
    var el = $('dy-loading');
    var tx = $('dy-loading-text');
    var star = $('dy-gen-star');
    var dock = $('dy-dock-gen');
    if (el) el.hidden = !on;
    if (tx && text) tx.textContent = text;
    if (star) star.classList.toggle('is-busy', !!on);
    if (dock) dock.classList.toggle('is-busy', !!on);
    state.generating = !!on;
  }

  function todayIsoForContact(contact) {
    var br = bridge();
    if (!br || typeof br.buildDiaryContext !== 'function') {
      var st = store();
      return st && st.isoDate ? st.isoDate(new Date()) : '';
    }
    return br.buildDiaryContext(contact).todayIso;
  }

  function generateDiary() {
    var contact = getContact(state.selectedContactId);
    var br = bridge();
    var st = store();
    if (!contact) {
      toast('请先选择一位角色');
      return;
    }
    if (!br || !st || state.generating) return;

    var today = todayIsoForContact(contact);
    var existing = st.findByDate(contact.id, today);
    if (existing) {
      if (global.miyaDialog && global.miyaDialog.confirm) {
        global.miyaDialog.confirm({
          title: '今日已有日记',
          message: '「' + displayName(contact) + '」今天已经写过日记了，要重新生成并覆盖吗？',
          confirmText: '重新生成',
          cancelText: '取消'
        }).then(function (ok) {
          if (ok) doGenerate(contact);
        });
        return;
      }
    }
    doGenerate(contact);
  }

  function doGenerate(contact) {
    var br = bridge();
    if (!br || state.generating) return;
    setLoading(true, '正在写日记…');
    br.generateTodayDiary(contact).then(function (row) {
      toast('「' + displayName(contact) + '」的今日日记写好了');
      renderAll();
      if (row && row.id) {
        state.readerKind = 'char';
        state.readingDiaryId = row.id;
        renderReader(row.id, 'char');
      }
    }).catch(function (err) {
      toast(err && err.message ? err.message : '生成失败');
    }).finally(function () {
      setLoading(false);
    });
  }

  function deleteCurrentDiary() {
    var st = store();
    if (!st || !state.selectedContactId || !state.readingDiaryId) return;
    var run = function () {
      st.removeDiary(state.selectedContactId, state.readingDiaryId);
      closeReader();
      renderAll();
      toast('已删除');
    };
    if (global.miyaDialog && global.miyaDialog.confirm) {
      global.miyaDialog.confirm({
        title: '删除日记',
        message: '删除后无法恢复，确定吗？',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function (ok) {
        if (ok) run();
      });
      return;
    }
    run();
  }

  function deleteCurrentUserDiary() {
    var st = store();
    if (!st || !state.selectedProfileId || !state.readingUserDiaryId) return;
    var run = function () {
      st.removeUserDiary(state.selectedProfileId, state.readingUserDiaryId);
      closeReader();
      renderUserAll();
      toast('已删除');
    };
    if (global.miyaDialog && global.miyaDialog.confirm) {
      global.miyaDialog.confirm({
        title: '删除日记',
        message: '删除后无法恢复，确定吗？',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function (ok) {
        if (ok) run();
      });
      return;
    }
    run();
  }

  function bindEvents() {
    var back = $('dy-back');
    if (back) back.addEventListener('click', closeDiaryApp);

    var star = $('dy-gen-star');
    if (star) star.addEventListener('click', generateDiary);

    var promptGen = $('dy-prompt-gen');
    if (promptGen) promptGen.addEventListener('click', generateDiary);

    var dockGen = $('dy-dock-gen');
    if (dockGen) dockGen.addEventListener('click', generateDiary);

    var dockSettings = $('dy-dock-settings');
    if (dockSettings) dockSettings.addEventListener('click', openSettings);

    var userEntry = $('dy-user-entry');
    if (userEntry) userEntry.addEventListener('click', openUserPage);

    var userBack = $('dy-user-back');
    if (userBack) userBack.addEventListener('click', closeUserPage);

    var userCompose = $('dy-user-compose');
    if (userCompose) userCompose.addEventListener('click', openUserCompose);

    var settingsBtn = $('dy-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    var settingsBack = $('dy-settings-back');
    if (settingsBack) settingsBack.addEventListener('click', closeSettings);

    var settingsContact = $('dy-settings-contact');
    if (settingsContact) {
      settingsContact.addEventListener('change', function () {
        saveSettingsFromForm();
        state.settingsContactId = settingsContact.value || '';
        loadSettingsToForm(state.settingsContactId);
      });
    }

    var peekChance = $('dy-set-peek-chance');
    var peekVal = $('dy-set-peek-val');
    if (peekChance && peekVal) {
      peekChance.addEventListener('input', function () {
        peekVal.textContent = peekChance.value + '%';
      });
      peekChance.addEventListener('change', saveSettingsFromForm);
    }

    ['dy-set-auto-enabled', 'dy-set-peek-enabled', 'dy-set-auto-time'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', saveSettingsFromForm);
    });

    var indexList = $('dy-index-list');
    if (indexList) {
      indexList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dy-contact]');
        if (!btn) return;
        state.selectedContactId = btn.getAttribute('data-dy-contact') || '';
        state.settingsContactId = state.selectedContactId;
        closeReader();
        renderAll();
      });
    }

    var shelf = $('dy-shelf');
    if (shelf) {
      shelf.addEventListener('click', function (e) {
        var card = e.target.closest('[data-dy-read]');
        if (!card) return;
        state.readerKind = 'char';
        state.readingDiaryId = card.getAttribute('data-dy-read') || '';
        renderReader(state.readingDiaryId, 'char');
      });
    }

    var maskList = $('dy-user-mask-chips');
    if (maskList) {
      maskList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dy-user-profile]');
        if (!btn) return;
        state.selectedProfileId = btn.getAttribute('data-dy-user-profile') || '';
        closeReader();
        renderUserAll();
      });
    }

    var userShelf = $('dy-user-shelf');
    if (userShelf) {
      userShelf.addEventListener('click', function (e) {
        var card = e.target.closest('[data-dy-user-read]');
        if (!card) return;
        state.readerKind = 'user';
        state.readingUserDiaryId = card.getAttribute('data-dy-user-read') || '';
        state.userEditing = false;
        renderReader(state.readingUserDiaryId, 'user');
      });
    }

    var readerBack = $('dy-reader-back');
    if (readerBack) readerBack.addEventListener('click', closeReader);
  }

  function openDiaryApp() {
    var el = $('miya-diary-app');
    if (!el) return;
    var chain = Promise.resolve();
    var cs = chatStore();
    if (cs && cs.init) chain = chain.then(function () { return cs.init(); });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () { return cts.whenReady(); });
    chain.then(function () {
      var rows = store() ? store().getAllContactRows() : [];
      var profiles = getProfiles();
      if (!state.selectedContactId && rows.length) {
        state.selectedContactId = rows[0].id;
      }
      if (!state.selectedProfileId && profiles.length) {
        state.selectedProfileId = profiles[0].id;
      }
      state.settingsContactId = state.selectedContactId;
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      closeReader();
      closeSettings();
      closeUserPage();
      requestAnimationFrame(function () { renderAll(); });
    });
  }

  function closeDiaryApp() {
    var el = $('miya-diary-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    closeReader();
    closeSettings();
    closeUserPage();
    if (!document.querySelector('.miya-beautify-app.is-open') &&
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
        !document.querySelector('.miya-couple-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function onAutoDiaryReady(contactId) {
    if (state.selectedContactId === contactId) {
      renderAll();
    }
  }

  bindEvents();

  global.miyaDiaryApp = {
    open: openDiaryApp,
    close: closeDiaryApp,
    onAutoDiaryReady: onAutoDiaryReady
  };
})(typeof window !== 'undefined' ? window : global);
