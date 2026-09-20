/**
 * Miya 聊天 · 我的相册（上传 / 识图 / 同步 Char / 换头像 / 发朋友圈）
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'miya-album-v1';
  var BATCH_RECOGNIZE_MAX = 5;
  var _cache = null;
  var _ready = null;
  var _dirty = false;
  var _thumbUrls = {};

  function trim(s) {
    return String(s || '').trim();
  }

  function uid(prefix) {
    return String(prefix || 'alb') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaChatApp && global.miyaChatApp.toast) global.miyaChatApp.toast(msg);
  }

  function getStore() {
    return global.miyaChatStore || null;
  }

  function defaultAlbum() {
    return {
      charSyncEnabled: false,
      groups: [{ id: 'default', name: '默认', sort: 0, contactIds: [] }],
      photos: []
    };
  }

  function defaultGroups() {
    return [{ id: 'default', name: '默认', sort: 0, contactIds: [] }];
  }

  function normalizeGroup(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = trim(raw.id);
    if (!id) return null;
    return {
      id: id,
      name: trim(raw.name) || '未命名',
      sort: Number(raw.sort) || 0,
      contactIds: Array.isArray(raw.contactIds)
        ? raw.contactIds.map(function (x) { return trim(x); }).filter(Boolean)
        : []
    };
  }

  function ensureDefaultGroup(groups) {
    var list = (Array.isArray(groups) ? groups : [])
      .map(normalizeGroup)
      .filter(Boolean)
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    if (!list.some(function (g) { return g.id === 'default'; })) {
      list.unshift({ id: 'default', name: '默认', sort: 0, contactIds: [] });
    }
    return list;
  }

  function defaultState() {
    return { albums: {} };
  }

  function normalizePhoto(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var blobId = trim(raw.blobId);
    if (!blobId) return null;
    return {
      id: trim(raw.id) || uid('alb'),
      blobId: blobId,
      groupId: trim(raw.groupId) || 'default',
      addedAt: Number(raw.addedAt) || Date.now(),
      visionText: trim(raw.visionText),
      visionUpdatedAt: Number(raw.visionUpdatedAt) || 0,
      syncedToChar: raw.syncedToChar !== false,
      favorite: !!raw.favorite
    };
  }

  function normalizeState(raw) {
    var st = raw && typeof raw === 'object' ? raw : {};
    var albums = {};
    Object.keys(st.albums || {}).forEach(function (pid) {
      var row = st.albums[pid] || {};
      albums[pid] = {
        charSyncEnabled: !!row.charSyncEnabled,
        groups: ensureDefaultGroup(row.groups),
        photos: (Array.isArray(row.photos) ? row.photos : [])
          .map(normalizePhoto)
          .filter(Boolean)
          .sort(function (a, b) {
            return (b.addedAt || 0) - (a.addedAt || 0);
          })
      };
    });
    return { albums: albums };
  }

  function readState() {
    if (_cache) return _cache;
    if (global.miyaSyncReadJsonKey) {
      var raw = global.miyaSyncReadJsonKey(STORE_KEY);
      if (raw != null) {
        _cache = normalizeState(raw);
        return _cache;
      }
    }
    return defaultState();
  }

  function persist(st) {
    _cache = st;
    _dirty = true;
    if (global.miyaWriteLsJsonKey) {
      return global.miyaWriteLsJsonKey(STORE_KEY, st).then(function () { return st; });
    }
    return Promise.resolve(st);
  }

  function whenReady() {
    if (_ready) return _ready;
    _ready = (global.miyaReadLsJsonKey
      ? global.miyaReadLsJsonKey(STORE_KEY).then(function (raw) {
          if (!_dirty) _cache = normalizeState(raw);
          return _cache || normalizeState(raw);
        })
      : Promise.resolve(readState())
    ).catch(function () {
      if (!_dirty) _cache = defaultState();
      return _cache || defaultState();
    });
    if (global.miyaRegisterKvStore) {
      global.miyaRegisterKvStore({ STORE_KEY: STORE_KEY, whenReady: whenReady });
    }
    return _ready;
  }

  function resolveProfileId(profileId) {
    var st = getStore();
    if (profileId) return String(profileId);
    var p = st && st.getActiveProfile ? st.getActiveProfile() : null;
    return p && p.id ? String(p.id) : '';
  }

  function getAlbum(profileId) {
    var pid = resolveProfileId(profileId);
    if (!pid) return defaultAlbum();
    var st = readState();
    return st.albums[pid] ? normalizeState({ albums: { x: st.albums[pid] } }).albums.x : defaultAlbum();
  }

  function saveAlbum(profileId, album) {
    var pid = resolveProfileId(profileId);
    if (!pid) return Promise.reject(new Error('no_profile'));
    var st = readState();
    st.albums[pid] = {
      charSyncEnabled: !!album.charSyncEnabled,
      groups: ensureDefaultGroup(album.groups),
      photos: (Array.isArray(album.photos) ? album.photos : [])
        .map(normalizePhoto)
        .filter(Boolean)
        .sort(function (a, b) {
          return (b.addedAt || 0) - (a.addedAt || 0);
        })
    };
    return persist(st);
  }

  function mutateAlbum(profileId, fn) {
    var album = getAlbum(profileId);
    fn(album);
    return saveAlbum(profileId, album);
  }

  function isRecognized(photo) {
    return !!(photo && trim(photo.visionText));
  }

  function isCharUsable(photo, album) {
    if (!photo || !isRecognized(photo)) return false;
    if (!album || !album.charSyncEnabled) return false;
    return photo.syncedToChar !== false;
  }

  function getPhotoGroup(album, photo) {
    var gid = trim(photo && photo.groupId) || 'default';
    var groups = ensureDefaultGroup(album && album.groups);
    return groups.find(function (g) { return g.id === gid; }) || groups[0];
  }

  function groupAppliesToContact(group, contactId) {
    if (!group) return false;
    var ids = Array.isArray(group.contactIds) ? group.contactIds : [];
    if (!ids.length) return true;
    var cid = trim(contactId);
    if (!cid) return true;
    return ids.indexOf(cid) >= 0;
  }

  function getCharUsablePhotos(profileId, contactId) {
    var album = getAlbum(profileId);
    return album.photos.filter(function (p) {
      if (!isCharUsable(p, album)) return false;
      return groupAppliesToContact(getPhotoGroup(album, p), contactId);
    });
  }

  function resolveCharPhoto(profileId, index, contactId) {
    var list = getCharUsablePhotos(profileId, contactId);
    var idx = Math.max(1, Number(index) || 1) - 1;
    return list[idx] || null;
  }

  function addPhotos(profileId, files, groupId) {
    var st = getStore();
    var img = global.MiyaChatImage;
    if (!st || !files || !files.length) return Promise.resolve([]);
    var gid = trim(groupId) || 'default';
    var arr = Array.prototype.slice.call(files);
    var chain = Promise.resolve([]);
    var added = [];
    arr.forEach(function (file) {
      chain = chain.then(function () {
        if (img && img.isLikelyImageFile && !img.isLikelyImageFile(file)) return;
        var compress = img && img.compressImageFileToBlob
          ? img.compressImageFileToBlob(file)
          : Promise.resolve(file);
        return compress.then(function (blob) {
          return st.storeMediaBlob(blob, 'album').then(function (blobId) {
            if (!blobId) return;
            added.push(normalizePhoto({
              id: uid('alb'),
              blobId: blobId,
              groupId: gid,
              addedAt: Date.now()
            }));
          });
        }).catch(function () {});
      });
    });
    return chain.then(function () {
      if (!added.length) return [];
      return mutateAlbum(profileId, function (album) {
        album.photos = added.concat(album.photos);
      }).then(function () { return added; });
    });
  }

  function deletePhotos(profileId, photoIds) {
    var ids = (Array.isArray(photoIds) ? photoIds : [photoIds]).map(trim).filter(Boolean);
    if (!ids.length) return Promise.resolve();
    return mutateAlbum(profileId, function (album) {
      album.photos = album.photos.filter(function (p) {
        return ids.indexOf(p.id) < 0;
      });
    });
  }

  function updateVisionText(profileId, photoId, text) {
    return mutateAlbum(profileId, function (album) {
      album.photos.forEach(function (p) {
        if (p.id === photoId) {
          p.visionText = trim(text).slice(0, 2000);
          p.visionUpdatedAt = Date.now();
        }
      });
    });
  }

  function setCharSyncEnabled(profileId, enabled) {
    return mutateAlbum(profileId, function (album) {
      album.charSyncEnabled = !!enabled;
    });
  }

  function setPhotosSynced(profileId, photoIds, synced) {
    var ids = (Array.isArray(photoIds) ? photoIds : [photoIds]).map(trim).filter(Boolean);
    return mutateAlbum(profileId, function (album) {
      album.photos.forEach(function (p) {
        if (ids.indexOf(p.id) >= 0) p.syncedToChar = !!synced;
      });
    });
  }

  function togglePhotoFavorite(profileId, photoId) {
    var pid = trim(photoId);
    if (!pid) return Promise.reject(new Error('invalid'));
    return mutateAlbum(profileId, function (album) {
      album.photos.forEach(function (p) {
        if (p.id === pid) p.favorite = !p.favorite;
      });
    });
  }

  function addAlbumGroup(profileId, name) {
    var n = trim(name);
    if (!n) return Promise.reject(new Error('name_required'));
    return mutateAlbum(profileId, function (album) {
      album.groups = ensureDefaultGroup(album.groups);
      album.groups.push({
        id: uid('albgrp'),
        name: n,
        sort: album.groups.length,
        contactIds: []
      });
    });
  }

  function renameAlbumGroup(profileId, groupId, name) {
    var gid = trim(groupId);
    var n = trim(name);
    if (!gid || !n) return Promise.reject(new Error('invalid'));
    return mutateAlbum(profileId, function (album) {
      album.groups = ensureDefaultGroup(album.groups);
      album.groups.forEach(function (g) {
        if (g.id === gid) g.name = n;
      });
    });
  }

  function deleteAlbumGroup(profileId, groupId) {
    var gid = trim(groupId);
    if (!gid || gid === 'default') return Promise.reject(new Error('default_group'));
    return mutateAlbum(profileId, function (album) {
      album.groups = ensureDefaultGroup(album.groups).filter(function (g) {
        return g.id !== gid;
      });
      album.photos.forEach(function (p) {
        if (trim(p.groupId) === gid) p.groupId = 'default';
      });
    });
  }

  function setAlbumGroupContacts(profileId, groupId, contactIds) {
    var gid = trim(groupId);
    if (!gid) return Promise.reject(new Error('invalid'));
    var ids = Array.isArray(contactIds)
      ? contactIds.map(function (x) { return trim(x); }).filter(Boolean)
      : [];
    return mutateAlbum(profileId, function (album) {
      album.groups = ensureDefaultGroup(album.groups);
      album.groups.forEach(function (g) {
        if (g.id === gid) g.contactIds = ids;
      });
    });
  }

  function movePhotoToGroup(profileId, photoId, groupId) {
    var pid = trim(photoId);
    var gid = trim(groupId) || 'default';
    if (!pid) return Promise.reject(new Error('invalid'));
    return mutateAlbum(profileId, function (album) {
      album.groups = ensureDefaultGroup(album.groups);
      if (!album.groups.some(function (g) { return g.id === gid; })) return;
      album.photos.forEach(function (p) {
        if (p.id === pid) p.groupId = gid;
      });
    });
  }

  function recognizeBatch(profileId, photoIds) {
    var ids = (Array.isArray(photoIds) ? photoIds : [photoIds]).map(trim).filter(Boolean);
    if (!ids.length) return Promise.reject(new Error('empty_selection'));
    if (ids.length > BATCH_RECOGNIZE_MAX) {
      return Promise.reject(new Error('too_many'));
    }
    var album = getAlbum(profileId);
    var targets = album.photos.filter(function (p) {
      return ids.indexOf(p.id) >= 0;
    });
    if (!targets.length) return Promise.reject(new Error('not_found'));
    var st = getStore();
    var img = global.MiyaChatImage;
    if (!st || !img || typeof img.recognizeImageBatchBlobIds !== 'function') {
      return Promise.reject(new Error('api_unavailable'));
    }
    return img.recognizeImageBatchBlobIds(st, targets.map(function (p) { return p.blobId; }))
      .then(function (descriptions) {
        return mutateAlbum(profileId, function (alb) {
          targets.forEach(function (t, i) {
            var desc = descriptions[i] || '';
            alb.photos.forEach(function (p) {
              if (p.id === t.id && desc) {
                p.visionText = desc;
                p.visionUpdatedAt = Date.now();
              }
            });
          });
        });
      });
  }

  function setProfileAvatarFromPhoto(profileId, photoId) {
    var st = getStore();
    var pid = resolveProfileId(profileId);
    var photo = getAlbum(pid).photos.find(function (p) { return p.id === photoId; });
    if (!st || !pid || !photo) return Promise.reject(new Error('not_found'));
    return st.getAvatarUrl(photo.blobId).then(function (url) {
      if (!url) return Promise.reject(new Error('no_blob'));
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('fetch_failed');
        return res.blob();
      }).then(function (blob) {
        var file = new File([blob], 'album-avatar.jpg', { type: blob.type || 'image/jpeg' });
        return st.setProfileAvatar(pid, file).then(function () {
          if (global.miyaChatApp && global.miyaChatApp.refreshProfileUI) {
            global.miyaChatApp.refreshProfileUI();
          }
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) {
            global.miyaChatApp.refreshLists({ force: true });
          }
          toast('已设为头像');
        });
      });
    });
  }

  function publishPhotoToMoments(profileId, photoId, text) {
    var mm = global.MiyaChatMoments;
    var st = getStore();
    var pid = resolveProfileId(profileId);
    var photo = getAlbum(pid).photos.find(function (p) { return p.id === photoId; });
    if (!mm || !st || !photo) return Promise.reject(new Error('not_found'));
    return st.getAvatarUrl(photo.blobId).then(function (url) {
      if (!url) return Promise.reject(new Error('no_blob'));
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('fetch_failed');
        return res.blob();
      }).then(function (blob) {
        var file = new File([blob], 'album-moment.jpg', { type: blob.type || 'image/jpeg' });
        return mm.publishUserPost({
          text: trim(text) || (photo.visionText ? photo.visionText.slice(0, 120) : ''),
          media: [{ kind: 'real-image', file: file }]
        });
      });
    });
  }

  function buildAlbumContextBlock(profileId, contactId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var charEnabled = !!opts.charAvatarSwapEnabled;
    var userEnabled = !!opts.userAvatarSwapEnabled;
    var pid = resolveProfileId(profileId);
    if (!pid) return '';
    var album = getAlbum(pid);
    if (!album.charSyncEnabled) return '';
    var usable = getCharUsablePhotos(pid, contactId);
    if (!usable.length) return '';
    if (!charEnabled && !userEnabled) return '';
    var st = getStore();
    var userName = '用户';
    if (st && st.getActiveProfile) {
      var p = st.getProfiles().find(function (x) { return x.id === pid; }) || st.getActiveProfile();
      if (p && p.name) userName = trim(p.name) || userName;
    }
    var lines = [
      '【用户相册·已同步·' + userName + '】',
      '以下为相册中已识别、已同步且当前角色可用的照片（#1=最新一张，依次更早）。上下文与提示词仅使用文字描述，不直接传图。',
      '未识别、未同步或分组未授权给当前角色的照片不可使用。'
    ];
    usable.forEach(function (ph, i) {
      lines.push('#' + (i + 1) + '：' + trim(ph.visionText));
    });
    lines.push('可用指令（单独成行，不显示为气泡）：');
    if (userEnabled) {
      lines.push(
        '· 为' + userName + '换聊天头像：给用户换头像-相册#1（#N=上表编号；勿写成「换头像-相册#1」；成功后系统会记录为你执行）'
      );
    }
    if (charEnabled) {
      lines.push(
        '· 你换自己的聊天头像：换头像-相册#1（可随心意随时换；须单独输出指令行才生效，禁止只在对话里说换了）'
      );
    }
    lines.push('· 发朋友圈配相册图：【发朋友圈：正文|相册配图1：#1】（最多相册配图9，须使用上表编号）');
    return lines.join('\n');
  }

  function resolveAlbumPhotoForSwap(profileId, index, contactId) {
    var photo = resolveCharPhoto(profileId, index, contactId);
    if (!photo) return null;
    return {
      blobId: photo.blobId,
      desc: trim(photo.visionText).slice(0, 500),
      albumIndex: Math.max(1, Number(index) || 1),
      photoId: photo.id
    };
  }

  function recordAvatarChangeInChat(chatId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var st = getStore();
    if (!st || !chatId || typeof st.addMessage !== 'function') return Promise.resolve();
    var roleName = trim(opts.roleName) || 'Ta';
    var userName = trim(opts.userName) || '用户';
    var idx = Math.max(1, Number(opts.albumIndex) || 1);
    var desc = trim(opts.desc) || '相册照片';
    var note = trim(opts.note);
    var content;
    if (opts.target === 'profile') {
      content =
        '【相册·换头像·' +
        roleName +
        '操作】' +
        roleName +
        '将' +
        userName +
        '的聊天头像换为相册第' +
        idx +
        '张：' +
        desc +
        '（系统记录：以上为用户聊天头像更换，由你在上一轮流式中执行，请知晓）';
    } else {
      content = '【相册·换头像·' + roleName + '操作】' + roleName + '将聊天头像换为相册第' + idx + '张：' + desc;
    }
    if (note) content += '（' + note + '）';
    return st.addMessage(chatId, {
      role: 'system',
      type: 'text',
      content: content,
      systemKind: 'album-avatar-change',
      excludedFromContext: false,
      createdAt: Date.now()
    });
  }

  function resolveAlbumMediaForMoments(profileId, albumIndex, contactId) {
    var photo = resolveCharPhoto(profileId, albumIndex, contactId);
    if (!photo) return null;
    return {
      kind: 'real-image',
      imageKey: photo.blobId,
      mime: 'image/jpeg',
      visionSummary: trim(photo.visionText)
    };
  }

  /* ── UI ── */
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatAlbumDate(ts) {
    var d = new Date(Number(ts) || Date.now());
    return MONTHS_EN[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function displayGroupName(group) {
    if (!group) return 'Daily Life';
    var n = trim(group.name);
    if (!n || n === '默认') return 'Daily Life';
    return n;
  }

  function photosInGroup(album, groupId) {
    var gid = trim(groupId) || 'default';
    var groups = ensureDefaultGroup(album && album.groups);
    var validIds = {};
    groups.forEach(function (g) { validIds[g.id] = true; });
    return (album.photos || []).filter(function (ph) {
      var pg = trim(ph.groupId) || 'default';
      if (gid === 'default' && !validIds[pg]) return true;
      return pg === gid;
    });
  }

  function resolveAlbumGroup(groups, groupId) {
    var gid = trim(groupId) || 'default';
    var group = (groups || []).find(function (g) { return g.id === gid; });
    if (!group) group = (groups || []).find(function (g) { return g.id === 'default'; });
    if (!group) group = (groups || [])[0];
    return group || { id: 'default', name: '默认', sort: 0, contactIds: [] };
  }

  function resolveVisibleGroups(groups, album, data) {
    var category = trim(data.category) || 'all';
    var filtered = filterGroupsByCategory(groups, album, category);
    if (!filtered.length) filtered = (groups || []).slice();
    return filtered;
  }

  function resolveActiveGroupId(data, groups, album) {
    if (trim(data.view) === 'detail') {
      return resolveAlbumGroup(groups, data.detailGroupId).id;
    }
    var filtered = resolveVisibleGroups(groups, album, data);
    var idx = Math.min(
      Math.max(0, Number(data.carouselIndex) || 0),
      Math.max(0, filtered.length - 1)
    );
    return (filtered[idx] || resolveAlbumGroup(groups, 'default')).id;
  }

  function groupCoverBlob(album, groupId) {
    var list = photosInGroup(album, groupId);
    return list.length ? list[0].blobId : '';
  }

  function groupLatestTs(album, groupId) {
    var list = photosInGroup(album, groupId);
    if (!list.length) return Date.now();
    return list.reduce(function (max, ph) {
      return Math.max(max, Number(ph.addedAt) || 0);
    }, 0);
  }

  function filterGroupsByCategory(groups, album, category) {
    var cat = trim(category) || 'all';
    return groups.filter(function (g) {
      var photos = photosInGroup(album, g.id);
      if (cat === 'all') return true;
      if (cat === 'people') {
        return (Array.isArray(g.contactIds) ? g.contactIds : []).length > 0;
      }
      if (cat === 'places') {
        return g.id !== 'default' && /旅行|地点|place|trip|journey|风景/i.test(trim(g.name));
      }
      if (cat === 'favorites') {
        return photos.some(function (p) { return !!p.favorite; });
      }
      return true;
    });
  }

  function masonrySizeClass(i) {
    var m = i % 5;
    if (m === 0 || m === 3) return 'mi-album-masonry__item--tall';
    if (m === 2) return 'mi-album-masonry__item--wide';
    return 'mi-album-masonry__item--sq';
  }

  function svgIcon(name) {
    var icons = {
      back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" stroke-linecap="round"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
      arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
      people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg>',
      places: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21s6-5.2 6-10a6 6 0 10-12 0c0 4.8 6 10 6 10z"/><circle cx="12" cy="11" r="2"/></svg>',
      favorites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 17.3l-5.5 3 1-6.2L2 9.7l6.3-.9L12 3l3.7 5.8 6.3.9-5.5 4.4 1 6.2z"/></svg>',
      menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h10" stroke-linecap="round"/></svg>',
      camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V10a2 2 0 012-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
      grid: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
      gridOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13" stroke-linecap="round"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
      heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20.5l-1.2-1.1C5.4 14.8 2 11.9 2 8.5A4.5 4.5 0 017.5 4 5.5 5.5 0 0112 6.1 5.5 5.5 0 0116.5 4 4.5 4.5 0 0122 8.5c0 3.4-3.4 6.3-8.8 10.9L12 20.5z"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9l6 6 6-6" stroke-linecap="round"/></svg>',
      play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
    };
    return icons[name] || '';
  }

  function flowerSvg() {
    return '<svg class="mi-album-quote__flower" viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
      '<path d="M40 70V30"/><path d="M40 45c-8-12-22-8-22 2s10 14 22 6"/><path d="M40 38c8-10 20-6 20 4s-12 12-20 4"/>' +
      '<ellipse cx="40" cy="26" rx="5" ry="8" transform="rotate(-15 40 26)"/>' +
      '<ellipse cx="48" cy="30" rx="4" ry="7" transform="rotate(25 48 30)"/>' +
      '<ellipse cx="32" cy="30" rx="4" ry="7" transform="rotate(-30 32 30)"/>' +
    '</svg>';
  }

  function groupScopeLabel(group) {
    var ids = group && Array.isArray(group.contactIds) ? group.contactIds : [];
    if (!ids.length) return '全部角色';
    return ids.length + ' 个角色';
  }

  function renderGroupContactsPanel(group, contacts, draftIds) {
    if (!group) return '';
    var ids = Array.isArray(draftIds) ? draftIds : (group.contactIds || []);
    var allOn = !ids.length;
    var rows = (contacts || []).map(function (c) {
      var cid = trim(c.id);
      if (!cid) return '';
      var name = trim(c.remarkName || c.name) || '未命名';
      var checked = !allOn && ids.indexOf(cid) >= 0;
      return '<label class="mi-album-grp-contact">' +
        '<input type="checkbox" data-mq-alb-grp-contact="' + esc(cid) + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + esc(name) + '</span>' +
      '</label>';
    }).join('');
    return '<div class="mi-album-grp-panel" data-mq-alb-grp-panel="' + esc(group.id) + '">' +
      '<div class="mi-album-grp-panel__head">' +
        '<strong>「' + esc(group.name) + '」可用角色</strong>' +
        '<button type="button" class="mi-album-grp-panel__close" data-mq-alb-grp-close aria-label="关闭">×</button>' +
      '</div>' +
      '<label class="mi-album-grp-contact mi-album-grp-contact--all">' +
        '<input type="checkbox" data-mq-alb-grp-all' + (allOn ? ' checked' : '') + '>' +
        '<span>全部角色可用</span>' +
      '</label>' +
      (rows
        ? '<div class="mi-album-grp-contacts' + (allOn ? ' is-disabled' : '') + '">' + rows + '</div>'
        : '<p class="mi-empty-hint mi-album-grp-empty">暂无联系人，请先添加角色</p>') +
      '<button type="button" class="mi-btn mi-btn--dark mi-btn--block" data-mq-alb-grp-save="' + esc(group.id) + '">保存分组权限</button>' +
    '</div>';
  }

  function renderCarouselCard(group, album, isBack) {
    var photos = photosInGroup(album, group.id);
    var blob = groupCoverBlob(album, group.id);
    var name = displayGroupName(group);
    var date = formatAlbumDate(groupLatestTs(album, group.id));
    var count = photos.length;
    var cls = 'mi-album-carousel__card' + (isBack ? ' mi-album-carousel__card--back' : ' mi-album-carousel__card--front');
    if (isBack) {
      return '<div class="' + cls + '" aria-hidden="true">' +
        (blob ? '<img class="mi-album-carousel__img" data-mq-alb-thumb="' + esc(blob) + '" alt="">' : '<div class="mi-album-carousel__img"></div>') +
      '</div>';
    }
    return '<button type="button" class="' + cls + '" data-mq-alb-open="' + esc(group.id) + '">' +
      (blob ? '<img class="mi-album-carousel__img" data-mq-alb-thumb="' + esc(blob) + '" alt="">' : '<div class="mi-album-carousel__img"></div>') +
      '<div class="mi-album-carousel__overlay">' +
        '<div class="mi-album-carousel__overlay-row">' +
          '<div>' +
            '<p class="mi-album-carousel__name">' + esc(name) + '</p>' +
            '<p class="mi-album-carousel__meta">' + esc(date) + ' · ' + count + ' photos</p>' +
          '</div>' +
          '<span class="mi-album-carousel__arrow" aria-hidden="true">' + svgIcon('arrow') + '</span>' +
        '</div>' +
      '</div>' +
    '</button>';
  }

  function renderAlbumHome(data, album, profile, groups, contacts) {
    var category = trim(data.category) || 'all';
    var homeMode = trim(data.homeMode) || 'carousel';
    var batchMode = !!data.batchMode;
    var selected = data.selectedIds || {};

    var cats = [
      { id: 'all', label: 'All', icon: 'all' },
      { id: 'people', label: 'People', icon: 'people' },
      { id: 'places', label: 'Places', icon: 'places' },
      { id: 'favorites', label: 'Favorites', icon: 'favorites' }
    ];

    return '<div class="mi-album-app' + (batchMode ? ' is-batch' : '') + '">' +
      '<div class="mi-album-app__scroll">' +
        '<header class="mi-album-header">' +
          '<div class="mi-album-header__brand">' +
            '<h1 class="mi-album-header__title">Album</h1>' +
            '<span class="mi-album-header__script">Memories</span>' +
          '</div>' +
          '<button type="button" class="mi-album-header__avatar" data-mq-alb-back aria-label="返回" data-mq-alb-profile-avatar></button>' +
        '</header>' +
        '<div class="mi-album-home-body" data-mq-alb-home-body>' +
        renderHomeBodyContent(data, album, groups) +
        '</div>' +
        '<nav class="mi-album-cats" aria-label="Categories">' +
          cats.map(function (c) {
            return '<button type="button" class="mi-album-cats__item' + (category === c.id ? ' is-active' : '') + '" data-mq-alb-category="' + c.id + '">' +
              svgIcon(c.icon) + '<span>' + c.label + '</span>' +
            '</button>';
          }).join('') +
        '</nav>' +
      '</div>' +
      (batchMode
        ? '<div class="mi-album-batch-bar">' +
            '<span>已选 ' + Object.keys(selected).filter(function (k) { return selected[k]; }).length + '</span>' +
            '<button type="button" data-mq-alb-recognize>识图</button>' +
            '<button type="button" data-mq-alb-sync-selected>同步</button>' +
            '<button type="button" data-mq-alb-delete>删除</button>' +
            '<button type="button" data-mq-alb-batch-toggle>完成</button>' +
          '</div>'
        : '') +
      '<nav class="mi-album-dock" aria-label="Actions">' +
        '<button type="button" class="mi-album-dock__side" data-mq-alb-menu-open aria-label="菜单">' + svgIcon('menu') + '</button>' +
        '<button type="button" class="mi-album-dock__cam" data-mq-alb-add aria-label="添加照片">' + svgIcon('camera') + '</button>' +
        '<button type="button" class="mi-album-dock__side' + (homeMode === 'grid' ? ' is-active' : '') + '" data-mq-alb-home-mode="' + (homeMode === 'grid' ? 'carousel' : 'grid') + '" aria-label="切换视图">' + svgIcon('grid') + '</button>' +
      '</nav>' +
      renderMenuSheet(data, album, groups, contacts, profile) +
      '<input type="file" accept="image/*" multiple hidden data-mq-alb-file>' +
    '</div>';
  }

  function renderDetailPhotos(photos, album, data) {
    var batchMode = !!data.batchMode;
    var selected = data.selectedIds || {};
    var viewMode = trim(data.detailViewMode) || 'grid';
    var list = photos.slice();

    if (!list.length) {
      return '<div class="mi-album-empty">' +
        '<p class="mi-album-empty__script">Empty</p>' +
        '<p class="mi-album-empty__hint">这个相册还没有照片</p>' +
        '<button type="button" class="mi-album-empty__btn" data-mq-alb-add>添加照片</button>' +
      '</div>';
    }

    if (viewMode === 'list') {
      return '<div class="mi-album-list">' + list.map(function (ph) {
        var rec = isRecognized(ph);
        var sel = !!selected[ph.id];
        return '<div class="mi-album-list__row' + (sel ? ' is-selected' : '') + '" data-mq-alb-card="' + esc(ph.id) + '">' +
          (batchMode
            ? '<label class="mi-album-masonry__pick"><input type="checkbox" data-mq-alb-check="' + esc(ph.id) + '"' + (sel ? ' checked' : '') + '></label>'
            : '') +
          '<button type="button" data-mq-alb-photo-open="' + esc(ph.id) + '" style="display:flex;align-items:center;gap:12px;flex:1;border:none;background:none;padding:0;cursor:pointer;text-align:left;">' +
            '<img class="mi-album-list__thumb" data-mq-alb-thumb="' + esc(ph.blobId) + '" alt="">' +
            '<div class="mi-album-list__info">' +
              '<p class="mi-album-list__date">' + esc(formatAlbumDate(ph.addedAt)) + '</p>' +
              '<p class="mi-album-list__tag">' + (rec ? 'Recognized' : 'Pending') + '</p>' +
            '</div>' +
          '</button>' +
          '<button type="button" class="mi-album-list__heart' + (ph.favorite ? ' is-on' : '') + '" data-mq-alb-fav="' + esc(ph.id) + '" aria-label="Favorite">' + svgIcon('heart') + '</button>' +
        '</div>';
      }).join('') + '</div>';
    }

    var masonry = list.map(function (ph, i) {
      var sel = !!selected[ph.id];
      var heartStyle = i % 2 === 1 ? ' style="top:auto;bottom:10px;"' : '';
      return '<article class="mi-album-masonry__item ' + masonrySizeClass(i) + (sel ? ' is-selected' : '') + '" data-mq-alb-card="' + esc(ph.id) + '">' +
        (batchMode
          ? '<label class="mi-album-masonry__pick"><input type="checkbox" data-mq-alb-check="' + esc(ph.id) + '"' + (sel ? ' checked' : '') + '></label>'
          : '') +
        '<button type="button" class="mi-album-masonry__btn" data-mq-alb-photo-open="' + esc(ph.id) + '">' +
          '<img data-mq-alb-thumb="' + esc(ph.blobId) + '" alt="" loading="lazy">' +
        '</button>' +
        '<button type="button" class="mi-album-masonry__heart' + (ph.favorite ? ' is-on' : '') + '" data-mq-alb-fav="' + esc(ph.id) + '" aria-label="Favorite"' + heartStyle + '>' + svgIcon('heart') + '</button>' +
      '</article>';
    }).join('');

    var polaroid = list.length >= 4
      ? '<div class="mi-album-polaroid">' +
          '<div class="mi-album-polaroid__inner">' +
            '<img data-mq-alb-thumb="' + esc(list[list.length - 1].blobId) + '" alt="">' +
            '<div class="mi-album-polaroid__play">' + svgIcon('play') + '</div>' +
          '</div>' +
        '</div>'
      : '';

    return '<div class="mi-album-masonry">' + masonry + polaroid + '</div>';
  }

  function renderMenuSheet(data, album, groups, contacts, profile, currentGroup) {
    if (!data.menuOpen) return '';
    var batchMode = !!data.batchMode;
    var gid = currentGroup ? currentGroup.id : (trim(data.detailGroupId) || 'default');
    return '<div class="mi-album-sheet-backdrop" data-mq-alb-menu-close></div>' +
      '<div class="mi-album-sheet" role="dialog" aria-label="Album menu">' +
        '<div class="mi-album-sheet__handle"></div>' +
        '<div class="mi-album-sheet__head">' +
          '<h3 class="mi-album-sheet__title">Settings</h3>' +
          '<button type="button" class="mi-album-sheet__close" data-mq-alb-menu-close aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="mi-album-sheet__body">' +
          '<div class="mi-album-sheet__row">' +
            '<div><strong>同步给 Char</strong><span>识图后按分组授权，供 Char 换头像或发动态</span></div>' +
            '<button type="button" class="mi-toggle' + (album.charSyncEnabled ? ' is-on' : '') + '" role="switch" data-mq-alb-sync></button>' +
          '</div>' +
          '<div class="mi-album-sheet__row">' +
            '<div><strong>批量操作</strong><span>识图 · 同步 · 删除</span></div>' +
            '<button type="button" class="mi-album-sheet__act' + (batchMode ? ' is-on' : '') + '" data-mq-alb-batch-toggle>' + (batchMode ? '进行中' : '开启') + '</button>' +
          '</div>' +
          '<p style="margin:16px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9a948c;">Albums</p>' +
          '<div class="mi-album-sheet__groups">' +
            groups.map(function (g) {
              return '<button type="button" class="mi-album-sheet__grp' + (g.id === gid ? ' is-active' : '') + '" data-mq-alb-open="' + esc(g.id) + '">' + esc(displayGroupName(g)) + '</button>';
            }).join('') +
            '<button type="button" class="mi-album-sheet__grp" data-mq-alb-grp-add>＋ 新建</button>' +
          '</div>' +
          (currentGroup
            ? '<div class="mi-album-sheet__actions">' +
                '<button type="button" class="mi-album-sheet__act" data-mq-alb-grp-edit="' + esc(currentGroup.id) + '">角色权限</button>' +
                (currentGroup.id !== 'default'
                  ? '<button type="button" class="mi-album-sheet__act mi-album-sheet__act--danger" data-mq-alb-grp-del="' + esc(currentGroup.id) + '">删除相册</button>'
                  : '') +
              '</div>'
            : '') +
        '</div>' +
      '</div>';
  }

  function renderPhotoSheet(data, album) {
    var pid = trim(data.photoSheetId);
    if (!pid) return '';
    var photo = (album.photos || []).find(function (p) { return p.id === pid; });
    if (!photo) return '';
    var rec = isRecognized(photo);
    return '<div class="mi-album-sheet-backdrop" data-mq-alb-photo-close></div>' +
      '<div class="mi-album-sheet" role="dialog" aria-label="Photo detail">' +
        '<div class="mi-album-sheet__handle"></div>' +
        '<div class="mi-album-sheet__head">' +
          '<h3 class="mi-album-sheet__title">Photo</h3>' +
          '<button type="button" class="mi-album-sheet__close" data-mq-alb-photo-close aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="mi-album-sheet__body">' +
          '<img class="mi-album-sheet__preview" data-mq-alb-thumb="' + esc(photo.blobId) + '" alt="">' +
          '<div class="mi-album-sheet__actions">' +
            '<button type="button" class="mi-album-sheet__act" data-mq-alb-avatar="' + esc(photo.id) + '">设为头像</button>' +
            '<button type="button" class="mi-album-sheet__act" data-mq-alb-moment="' + esc(photo.id) + '">发朋友圈</button>' +
            (rec
              ? '<button type="button" class="mi-album-sheet__act' + (photo.syncedToChar !== false ? ' is-on' : '') + '" data-mq-alb-char="' + esc(photo.id) + '">' + (photo.syncedToChar !== false ? '已同步 Char' : '同步 Char') + '</button>'
              : '') +
            '<button type="button" class="mi-album-sheet__act" data-mq-alb-reone="' + esc(photo.id) + '">识图</button>' +
            '<button type="button" class="mi-album-sheet__act' + (photo.favorite ? ' is-on' : '') + '" data-mq-alb-fav="' + esc(photo.id) + '">收藏</button>' +
            '<button type="button" class="mi-album-sheet__act mi-album-sheet__act--danger" data-mq-alb-del="' + esc(photo.id) + '">删除</button>' +
          '</div>' +
          (rec
            ? '<textarea class="mi-album-sheet__vision" data-mq-alb-vision="' + esc(photo.id) + '" rows="5" placeholder="识图描述…">' + esc(photo.visionText) + '</textarea>' +
              '<button type="button" class="mi-album-sheet__act is-on" data-mq-alb-save-vision="' + esc(photo.id) + '">保存描述</button>'
            : '<p style="font-size:12px;color:#9a948c;margin:8px 0;">尚未识图 · Char 不可使用</p>') +
        '</div>' +
      '</div>';
  }

  function renderAlbumDetail(data, album, profile, groups, contacts) {
    var group = resolveAlbumGroup(groups, data.detailGroupId);
    var gid = group.id;
    var photos = photosInGroup(album, gid);
    var batchMode = !!data.batchMode;
    var selected = data.selectedIds || {};
    var viewMode = trim(data.detailViewMode) || 'grid';
    var editingGroupId = trim(data.editingGroupId) || '';
    var editingGroup = editingGroupId ? groups.find(function (g) { return g.id === editingGroupId; }) : null;
    var draftContactIds = data.draftGroupContacts && data.draftGroupContacts[editingGroupId]
      ? data.draftGroupContacts[editingGroupId]
      : (editingGroup ? editingGroup.contactIds.slice() : []);

    return '<div class="mi-album-app' + (batchMode ? ' is-batch' : '') + '">' +
      '<div class="mi-album-app__scroll">' +
        '<header class="mi-album-header mi-album-header--detail">' +
          '<div class="mi-album-header__side">' +
            '<button type="button" class="mi-album-icon-btn" data-mq-alb-view-home aria-label="返回">' + svgIcon('back') + '</button>' +
          '</div>' +
          '<div class="mi-album-header__center">' +
            '<h2 class="mi-album-header__album-title">' + esc(displayGroupName(group)) + '</h2>' +
            '<span class="mi-album-header__album-date">' + esc(formatAlbumDate(groupLatestTs(album, gid))) + '</span>' +
          '</div>' +
          '<div class="mi-album-header__side">' +
            '<button type="button" class="mi-album-icon-btn mi-album-icon-btn--ghost" data-mq-alb-menu-open aria-label="更多">' + svgIcon('more') + '</button>' +
          '</div>' +
        '</header>' +
        '<div class="mi-album-view-toggle">' +
          '<div class="mi-album-view-toggle__pill">' +
            '<button type="button" class="mi-album-view-toggle__btn' + (viewMode === 'grid' ? ' is-active' : '') + '" data-mq-alb-view-mode="grid" aria-label="Grid">' + svgIcon('gridOutline') + '</button>' +
            '<button type="button" class="mi-album-view-toggle__btn' + (viewMode === 'list' ? ' is-active' : '') + '" data-mq-alb-view-mode="list" aria-label="List">' + svgIcon('list') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="mi-album-detail-photos" data-mq-alb-detail-photos>' +
        renderDetailPhotos(photos, album, data) +
        '</div>' +
        '<footer class="mi-album-detail-foot">' +
          photos.length + ' photos' +
          svgIcon('chevron') +
        '</footer>' +
      '</div>' +
      (batchMode
        ? '<div class="mi-album-batch-bar">' +
            '<span>已选 ' + Object.keys(selected).filter(function (k) { return selected[k]; }).length + '</span>' +
            '<button type="button" data-mq-alb-recognize>识图</button>' +
            '<button type="button" data-mq-alb-sync-selected>同步</button>' +
            '<button type="button" data-mq-alb-delete>删除</button>' +
            '<button type="button" data-mq-alb-batch-toggle>完成</button>' +
          '</div>'
        : '') +
      '<nav class="mi-album-dock" aria-label="Actions">' +
        '<button type="button" class="mi-album-dock__side" data-mq-alb-menu-open aria-label="菜单">' + svgIcon('menu') + '</button>' +
        '<button type="button" class="mi-album-dock__cam" data-mq-alb-add aria-label="添加照片">' + svgIcon('camera') + '</button>' +
        '<button type="button" class="mi-album-dock__side' + (viewMode === 'grid' ? ' is-active' : '') + '" data-mq-alb-view-mode="' + (viewMode === 'grid' ? 'list' : 'grid') + '" aria-label="切换视图">' + svgIcon('grid') + '</button>' +
      '</nav>' +
      renderMenuSheet(data, album, groups, contacts, profile, group) +
      renderPhotoSheet(data, album) +
      (editingGroup ? renderGroupContactsPanel(editingGroup, contacts, draftContactIds) : '') +
      '<input type="file" accept="image/*" multiple hidden data-mq-alb-file>' +
    '</div>';
  }

  function renderAlbumPage(data) {
    data = data && typeof data === 'object' ? data : {};
    var st = getStore();
    var profile = st && st.getActiveProfile ? st.getActiveProfile() : null;
    var album = getAlbum(profile && profile.id);
    var groups = ensureDefaultGroup(album.groups);
    var contacts = st && st.getContacts ? st.getContacts('all') : [];
    if (trim(data.view) === 'detail') {
      return renderAlbumDetail(data, album, profile, groups, contacts);
    }
    return renderAlbumHome(data, album, profile, groups, contacts);
  }

  function hydrateThumbs(root) {
    if (!root) return;
    var st = getStore();
    if (!st) return;
    root.querySelectorAll('[data-mq-alb-thumb]').forEach(function (img) {
      var bid = img.getAttribute('data-mq-alb-thumb');
      if (!bid) return;
      if (_thumbUrls[bid]) {
        img.src = _thumbUrls[bid];
        return;
      }
      st.getAvatarUrl(bid).then(function (url) {
        if (!url) return;
        _thumbUrls[bid] = url;
        img.src = url;
      });
    });
    var avEl = root.querySelector('[data-mq-alb-profile-avatar]');
    if (avEl && st.getActiveProfile) {
      var prof = st.getActiveProfile();
      if (prof && prof.avatarId) {
        st.getAvatarUrl(prof.avatarId).then(function (url) {
          if (url) avEl.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
        });
      }
    }
    var carousel = root.querySelector('[data-mq-alb-carousel]');
    if (carousel) {
      var initIdx = Number(carousel.getAttribute('data-mq-alb-carousel-index')) || 0;
      var initSlide = carousel.querySelector('[data-mq-alb-slide="' + initIdx + '"]');
      if (initSlide && !carousel.dataset.albScrolled) {
        carousel.dataset.albScrolled = '1';
        requestAnimationFrame(function () {
          carousel.scrollLeft = initSlide.offsetLeft - (carousel.clientWidth - initSlide.offsetWidth) / 2;
        });
      }
      if (!carousel.dataset.albScrollInit) {
        carousel.dataset.albScrollInit = '1';
        carousel.addEventListener('scroll', function () {
          var slides = carousel.querySelectorAll('[data-mq-alb-slide]');
          if (!slides.length) return;
          var idx = 0;
          var minDist = Infinity;
          var left = carousel.scrollLeft + carousel.clientWidth / 2;
          slides.forEach(function (slide, i) {
            var center = slide.offsetLeft + slide.offsetWidth / 2;
            var dist = Math.abs(center - left);
            if (dist < minDist) {
              minDist = dist;
              idx = i;
            }
          });
          var dotsWrap = carousel.parentElement;
          if (dotsWrap) {
            dotsWrap.querySelectorAll('.mi-album-carousel__dot').forEach(function (dot, i) {
              dot.classList.toggle('is-active', i === idx);
            });
          }
        }, { passive: true });
      }
    }
  }

  function getAlbumRenderContext() {
    var st = getStore();
    var profile = st && st.getActiveProfile ? st.getActiveProfile() : null;
    if (!profile) return null;
    var album = getAlbum(profile.id);
    return {
      st: st,
      profile: profile,
      album: album,
      groups: ensureDefaultGroup(album.groups),
      contacts: st && st.getContacts ? st.getContacts('all') : []
    };
  }

  function findAlbumApp(root) {
    if (!root) return null;
    var body = root.querySelector('[data-mq-me-body]') || root;
    return body.querySelector('.mi-album-app');
  }

  function getAlbumScrollEl(root) {
    var app = findAlbumApp(root);
    return app ? app.querySelector('.mi-album-app__scroll') : null;
  }

  function captureAlbumScroll(root) {
    var scrollEl = getAlbumScrollEl(root);
    if (!scrollEl) return null;
    return { scrollTop: scrollEl.scrollTop };
  }

  function restoreAlbumScroll(root, state) {
    if (!state) return;
    var scrollEl = getAlbumScrollEl(root);
    if (!scrollEl) return;
    var top = state.scrollTop;
    scrollEl.scrollTop = top;
    requestAnimationFrame(function () {
      scrollEl.scrollTop = top;
    });
  }

  function albumViewScrollKey(data) {
    data = data || {};
    return (trim(data.view) || 'home') + ':' + (trim(data.detailGroupId) || 'default');
  }

  function withAlbumScroll(root, fn) {
    var saved = captureAlbumScroll(root);
    fn();
    restoreAlbumScroll(root, saved);
  }

  function replaceInnerHtml(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  function renderHomeBodyContent(data, album, groups) {
    var homeMode = trim(data.homeMode) || 'carousel';
    var carouselIndex = Math.max(0, Number(data.carouselIndex) || 0);
    var filtered = resolveVisibleGroups(groups, album, data);
    var curIdx = Math.min(carouselIndex, Math.max(0, filtered.length - 1));

    var carouselHtml = filtered.length
      ? '<div class="mi-album-carousel-wrap">' +
          '<div class="mi-album-carousel" data-mq-alb-carousel data-mq-alb-carousel-index="' + curIdx + '">' +
            filtered.map(function (g, i) {
              var peek = filtered[(i + 1) % filtered.length] || g;
              return '<div class="mi-album-carousel__slide" data-mq-alb-slide="' + i + '">' +
                '<div class="mi-album-carousel__stack">' +
                  renderCarouselCard(peek, album, true) +
                  renderCarouselCard(g, album, false) +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          (filtered.length > 1
            ? '<div class="mi-album-carousel__dots">' + filtered.map(function (g, i) {
                return '<button type="button" class="mi-album-carousel__dot' + (i === curIdx ? ' is-active' : '') + '" data-mq-alb-dot="' + i + '" aria-label="Album ' + (i + 1) + '"></button>';
              }).join('') + '</div>'
            : '') +
        '</div>'
      : '<div class="mi-album-empty">' +
          '<p class="mi-album-empty__script">Empty</p>' +
          '<p class="mi-album-empty__hint">还没有相册 · 点下方相机开始收集美好瞬间</p>' +
          '<button type="button" class="mi-album-empty__btn" data-mq-alb-add>添加照片</button>' +
        '</div>';

    var albumsGridHtml = filtered.map(function (g) {
      var blob = groupCoverBlob(album, g.id);
      var cnt = photosInGroup(album, g.id).length;
      return '<button type="button" class="mi-album-albums__card" data-mq-alb-open="' + esc(g.id) + '">' +
        (blob ? '<img class="mi-album-albums__img" data-mq-alb-thumb="' + esc(blob) + '" alt="">' : '<div class="mi-album-albums__img"></div>') +
        '<div class="mi-album-albums__info">' +
          '<p class="mi-album-albums__name">' + esc(displayGroupName(g)) + '</p>' +
          '<p class="mi-album-albums__count">' + cnt + ' photos</p>' +
        '</div>' +
      '</button>';
    }).join('');

    return (homeMode === 'grid'
      ? '<div class="mi-album-albums">' + (albumsGridHtml || '<div class="mi-album-empty"><p class="mi-album-empty__hint">暂无相册</p></div>') + '</div>'
      : carouselHtml) +
      (homeMode === 'carousel'
        ? '<div class="mi-album-quote">' +
            '<p class="mi-album-quote__text">Collect <em>beautiful</em> moments.</p>' +
            flowerSvg() +
          '</div>'
        : '');
  }

  function clearAlbumOverlays(app) {
    app.querySelectorAll('.mi-album-sheet-backdrop, .mi-album-sheet, .mi-album-grp-panel').forEach(function (el) {
      el.remove();
    });
  }

  function insertAlbumOverlayHtml(app, html) {
    if (!html) return;
    var anchor = app.querySelector('[data-mq-alb-file]');
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) {
      if (anchor) app.insertBefore(wrap.firstChild, anchor);
      else app.appendChild(wrap.firstChild);
    }
  }

  function patchAlbumOverlays(stackEl, data) {
    var app = findAlbumApp(stackEl);
    var ctx = getAlbumRenderContext();
    if (!app || !ctx) return false;
    withAlbumScroll(stackEl, function () {
      clearAlbumOverlays(app);
      var view = trim(data.view) === 'detail' ? 'detail' : 'home';
      var html = '';
      if (view === 'detail') {
        var group = resolveAlbumGroup(ctx.groups, data.detailGroupId);
        html += renderMenuSheet(data, ctx.album, ctx.groups, ctx.contacts, ctx.profile, group);
        html += renderPhotoSheet(data, ctx.album);
        var editingGroupId = trim(data.editingGroupId) || '';
        if (editingGroupId) {
          var editingGroup = ctx.groups.find(function (g) { return g.id === editingGroupId; });
          if (editingGroup) {
            var draftContactIds = data.draftGroupContacts && data.draftGroupContacts[editingGroupId]
              ? data.draftGroupContacts[editingGroupId]
              : editingGroup.contactIds.slice();
            html += renderGroupContactsPanel(editingGroup, ctx.contacts, draftContactIds);
          }
        }
      } else {
        html += renderMenuSheet(data, ctx.album, ctx.groups, ctx.contacts, ctx.profile, null);
      }
      insertAlbumOverlayHtml(app, html);
      hydrateThumbs(app);
    });
    return true;
  }

  function patchAlbumHomeBody(stackEl, data) {
    var app = findAlbumApp(stackEl);
    var ctx = getAlbumRenderContext();
    if (!app || !ctx) return false;
    var bodyEl = app.querySelector('[data-mq-alb-home-body]');
    if (!bodyEl) return false;
    withAlbumScroll(stackEl, function () {
      replaceInnerHtml(bodyEl, renderHomeBodyContent(data, ctx.album, ctx.groups));
      var category = trim(data.category) || 'all';
      app.querySelectorAll('[data-mq-alb-category]').forEach(function (btn) {
        btn.classList.toggle('is-active', (btn.getAttribute('data-mq-alb-category') || '') === category);
      });
      var homeMode = trim(data.homeMode) || 'carousel';
      app.querySelectorAll('[data-mq-alb-home-mode]').forEach(function (btn) {
        btn.classList.toggle('is-active', homeMode === 'grid');
        btn.setAttribute('data-mq-alb-home-mode', homeMode === 'grid' ? 'carousel' : 'grid');
      });
      hydrateThumbs(app);
    });
    return true;
  }

  function patchAlbumDetailPhotos(stackEl, data) {
    var app = findAlbumApp(stackEl);
    var ctx = getAlbumRenderContext();
    if (!app || !ctx) return false;
    var photosEl = app.querySelector('[data-mq-alb-detail-photos]');
    if (!photosEl) return false;
    withAlbumScroll(stackEl, function () {
      var group = resolveAlbumGroup(ctx.groups, data.detailGroupId);
      var photos = photosInGroup(ctx.album, group.id);
      replaceInnerHtml(photosEl, renderDetailPhotos(photos, ctx.album, data));
      var viewMode = trim(data.detailViewMode) || 'grid';
      app.querySelectorAll('[data-mq-alb-view-mode]').forEach(function (btn) {
        var mode = btn.getAttribute('data-mq-alb-view-mode') || '';
        if (mode === 'grid' || mode === 'list') {
          btn.classList.toggle('is-active', mode === viewMode);
        } else {
          btn.classList.toggle('is-active', viewMode === 'grid');
          btn.setAttribute('data-mq-alb-view-mode', viewMode === 'grid' ? 'list' : 'grid');
        }
      });
      app.querySelectorAll('.mi-album-view-toggle__btn').forEach(function (btn) {
        btn.classList.toggle('is-active', (btn.getAttribute('data-mq-alb-view-mode') || '') === viewMode);
      });
      var foot = app.querySelector('.mi-album-detail-foot');
      if (foot) {
        foot.childNodes[0].textContent = photos.length + ' photos';
      }
      hydrateThumbs(app);
    });
    return true;
  }

  function patchAlbumBatchSelection(stackEl, data) {
    var app = findAlbumApp(stackEl);
    if (!app) return false;
    var selected = data.selectedIds || {};
    var count = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    var bar = app.querySelector('.mi-album-batch-bar span');
    if (bar) bar.textContent = '已选 ' + count;
    app.querySelectorAll('[data-mq-alb-card]').forEach(function (card) {
      var id = card.getAttribute('data-mq-alb-card') || '';
      card.classList.toggle('is-selected', !!selected[id]);
      var chk = card.querySelector('[data-mq-alb-check]');
      if (chk) chk.checked = !!selected[id];
    });
    return true;
  }

  function getTopNavData() {
    return null;
  }

  function bindAlbumEvents(stackEl, getNav, setNav, renderTop, setHeadFn, popFn) {
    if (!stackEl || stackEl.dataset.albBound) return;
    stackEl.dataset.albBound = '1';

    function navData() {
      var top = getNav();
      return (top && top.data) || {};
    }

    function patchNav(patch) {
      var top = getNav();
      if (!top) return;
      top.data = Object.assign({}, top.data || {}, patch || {});
      setNav(top);
    }

    function rerender() {
      renderTop();
    }

    function patchOverlays() {
      patchAlbumOverlays(stackEl, navData());
    }

    function patchHomeBody() {
      patchAlbumHomeBody(stackEl, navData());
    }

    function patchDetailPhotos() {
      patchAlbumDetailPhotos(stackEl, navData());
    }

    function patchBatchUI() {
      patchAlbumBatchSelection(stackEl, navData());
    }

    function refreshAlbumContent() {
      if (trim(navData().view) === 'detail') patchDetailPhotos();
      else patchHomeBody();
    }

    function promptNewGroup() {
      var promptFn = global.miyaDialog && global.miyaDialog.prompt
        ? global.miyaDialog.prompt.bind(global.miyaDialog)
        : function (o) { return Promise.resolve(prompt(o.message || '分组名称')); };
      return promptFn({ title: '新建分组', message: '输入分组名称', placeholder: '例如：日常、旅行' }).then(function (name) {
        if (name == null || !trim(name)) return;
        var st2 = getStore();
        var prof = st2 && st2.getActiveProfile ? st2.getActiveProfile() : null;
        if (!prof) return;
        return addAlbumGroup(prof.id, name).then(function () {
          toast('分组已创建');
          patchNav({ menuOpen: true });
          rerender();
        });
      });
    }

    stackEl.addEventListener('change', function (e) {
      var chk = e.target.closest('[data-mq-alb-check]');
      if (!chk) return;
      var top = getNav();
      if (!top || top.screen !== 'album') return;
      var id = chk.getAttribute('data-mq-alb-check');
      var sel = Object.assign({}, navData().selectedIds || {});
      if (chk.checked) sel[id] = true;
      else delete sel[id];
      patchNav({ selectedIds: sel });
      patchBatchUI();
    });

    stackEl.addEventListener('click', function (e) {
      var top = getNav();
      if (!top || top.screen !== 'album') return;
      var st = getStore();
      var profile = st && st.getActiveProfile ? st.getActiveProfile() : null;
      if (!profile) return;

      var backBtn = e.target.closest('[data-mq-alb-back]');
      if (backBtn) {
        e.preventDefault();
        if (typeof popFn === 'function') popFn();
        return;
      }

      var homeBtn = e.target.closest('[data-mq-alb-view-home]');
      if (homeBtn) {
        e.preventDefault();
        patchNav({ view: 'home', photoSheetId: '', menuOpen: false, editingGroupId: '' });
        rerender();
        return;
      }

      var openAlbum = e.target.closest('[data-mq-alb-open]');
      if (openAlbum) {
        e.preventDefault();
        var ogid = openAlbum.getAttribute('data-mq-alb-open') || 'default';
        var groupsNow = ensureDefaultGroup(getAlbum(profile.id).groups);
        var resolved = resolveAlbumGroup(groupsNow, ogid);
        patchNav({
          view: 'detail',
          detailGroupId: resolved.id,
          menuOpen: false,
          photoSheetId: '',
          selectedIds: {}
        });
        rerender();
        return;
      }

      var catBtn = e.target.closest('[data-mq-alb-category]');
      if (catBtn) {
        e.preventDefault();
        patchNav({
          category: catBtn.getAttribute('data-mq-alb-category') || 'all',
          carouselIndex: 0
        });
        patchHomeBody();
        return;
      }

      var dotBtn = e.target.closest('[data-mq-alb-dot]');
      if (dotBtn) {
        e.preventDefault();
        var dotIdx = Number(dotBtn.getAttribute('data-mq-alb-dot')) || 0;
        patchNav({ carouselIndex: dotIdx });
        var carousel = stackEl.querySelector('[data-mq-alb-carousel]');
        var slide = carousel && carousel.querySelector('[data-mq-alb-slide="' + dotIdx + '"]');
        if (carousel && slide) {
          carousel.querySelectorAll('.mi-album-carousel__dot').forEach(function (dot, i) {
            dot.classList.toggle('is-active', i === dotIdx);
          });
          carousel.scrollTo({ left: slide.offsetLeft - (carousel.clientWidth - slide.offsetWidth) / 2, behavior: 'smooth' });
        }
        return;
      }

      var menuOpen = e.target.closest('[data-mq-alb-menu-open]');
      if (menuOpen) {
        e.preventDefault();
        patchNav({ menuOpen: true, photoSheetId: '' });
        patchOverlays();
        return;
      }

      var menuClose = e.target.closest('[data-mq-alb-menu-close]');
      if (menuClose) {
        e.preventDefault();
        patchNav({ menuOpen: false });
        patchOverlays();
        return;
      }

      var photoOpen = e.target.closest('[data-mq-alb-photo-open]');
      if (photoOpen) {
        e.preventDefault();
        if (navData().batchMode) return;
        patchNav({ photoSheetId: photoOpen.getAttribute('data-mq-alb-photo-open') || '', menuOpen: false });
        patchOverlays();
        return;
      }

      var photoClose = e.target.closest('[data-mq-alb-photo-close]');
      if (photoClose) {
        e.preventDefault();
        patchNav({ photoSheetId: '' });
        patchOverlays();
        return;
      }

      var favBtn = e.target.closest('[data-mq-alb-fav]');
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        var fvid = favBtn.getAttribute('data-mq-alb-fav') || '';
        togglePhotoFavorite(profile.id, fvid).then(function () {
          favBtn.classList.toggle('is-on');
          if (navData().photoSheetId) patchOverlays();
        });
        return;
      }

      var viewModeBtn = e.target.closest('[data-mq-alb-view-mode]');
      if (viewModeBtn) {
        e.preventDefault();
        patchNav({ detailViewMode: viewModeBtn.getAttribute('data-mq-alb-view-mode') || 'grid' });
        patchDetailPhotos();
        return;
      }

      var homeModeBtn = e.target.closest('[data-mq-alb-home-mode]');
      if (homeModeBtn) {
        e.preventDefault();
        patchNav({ homeMode: homeModeBtn.getAttribute('data-mq-alb-home-mode') || 'carousel' });
        patchHomeBody();
        return;
      }

      var syncBtn = e.target.closest('[data-mq-alb-sync]');
      if (syncBtn) {
        e.preventDefault();
        var next = !syncBtn.classList.contains('is-on');
        setCharSyncEnabled(profile.id, next).then(function () {
          toast(next ? '已开启 Char 同步' : '已关闭 Char 同步');
          syncBtn.classList.toggle('is-on', next);
        });
        return;
      }

      var addBtn = e.target.closest('[data-mq-alb-add]');
      if (addBtn) {
        e.preventDefault();
        var finp = stackEl.querySelector('[data-mq-alb-file]');
        if (finp) finp.click();
        return;
      }

      var batchBtn = e.target.closest('[data-mq-alb-batch-toggle]');
      if (batchBtn) {
        e.preventDefault();
        var nextBatch = !navData().batchMode;
        patchNav({
          batchMode: nextBatch,
          selectedIds: {},
          editingGroupId: '',
          photoSheetId: '',
          menuOpen: nextBatch ? false : navData().menuOpen
        });
        rerender();
        return;
      }

      var grpAdd = e.target.closest('[data-mq-alb-grp-add]');
      if (grpAdd) {
        e.preventDefault();
        promptNewGroup();
        return;
      }

      var grpEdit = e.target.closest('[data-mq-alb-grp-edit]');
      if (grpEdit) {
        e.preventDefault();
        var egid = grpEdit.getAttribute('data-mq-alb-grp-edit') || '';
        patchNav({ editingGroupId: egid, menuOpen: false });
        patchOverlays();
        return;
      }

      var grpClose = e.target.closest('[data-mq-alb-grp-close]');
      if (grpClose) {
        e.preventDefault();
        patchNav({ editingGroupId: '' });
        patchOverlays();
        return;
      }

      var grpDel = e.target.closest('[data-mq-alb-grp-del]');
      if (grpDel) {
        e.preventDefault();
        var dgid = grpDel.getAttribute('data-mq-alb-grp-del') || '';
        if (!dgid || dgid === 'default') { toast('默认分组不能删除'); return; }
        var confirmFn = global.miyaDialog && global.miyaDialog.confirm
          ? global.miyaDialog.confirm.bind(global.miyaDialog)
          : function (o) { return Promise.resolve(confirm(o.message || '确定？')); };
        confirmFn({ title: '删除分组', message: '删除后组内照片将移至默认分组' }).then(function (ok) {
          if (!ok) return;
          deleteAlbumGroup(profile.id, dgid).then(function () {
            toast('分组已删除');
            var nd = navData();
            var patch = { editingGroupId: '', menuOpen: true };
            if (nd.detailGroupId === dgid) {
              patch.view = 'home';
              patch.detailGroupId = '';
            }
            patchNav(patch);
            rerender();
          });
        });
        return;
      }

      var grpSave = e.target.closest('[data-mq-alb-grp-save]');
      if (grpSave) {
        e.preventDefault();
        var sgid = grpSave.getAttribute('data-mq-alb-grp-save') || '';
        var panel = stackEl.querySelector('[data-mq-alb-grp-panel="' + sgid + '"]');
        var allBox = panel && panel.querySelector('[data-mq-alb-grp-all]');
        var contactIds = [];
        if (!allBox || !allBox.checked) {
          if (panel) {
            panel.querySelectorAll('[data-mq-alb-grp-contact]:checked').forEach(function (inp) {
              var cid2 = inp.getAttribute('data-mq-alb-grp-contact');
              if (cid2) contactIds.push(cid2);
            });
          }
        }
        setAlbumGroupContacts(profile.id, sgid, contactIds).then(function () {
          toast(contactIds.length ? '已保存角色权限' : '已设为全部角色可用');
          patchNav({ editingGroupId: '' });
          patchOverlays();
        });
        return;
      }

      function selectedIds() {
        return Object.keys(navData().selectedIds || {}).filter(function (k) {
          return navData().selectedIds[k];
        });
      }

      var recBatch = e.target.closest('[data-mq-alb-recognize]');
      if (recBatch) {
        e.preventDefault();
        var ids = selectedIds();
        if (!ids.length) { toast('请先选择照片'); return; }
        if (ids.length > BATCH_RECOGNIZE_MAX) {
          toast('一次最多识图 ' + BATCH_RECOGNIZE_MAX + ' 张');
          return;
        }
        toast('识图中…');
        recognizeBatch(profile.id, ids).then(function () {
          toast('识图完成');
          patchNav({ selectedIds: {} });
          refreshAlbumContent();
          patchBatchUI();
        }).catch(function (err) {
          var msg = (err && err.message) || '';
          if (msg === 'api_not_configured') toast('请先在设置中配置 API');
          else toast('识图失败');
        });
        return;
      }

      var syncSel = e.target.closest('[data-mq-alb-sync-selected]');
      if (syncSel) {
        e.preventDefault();
        var sids = selectedIds();
        if (!sids.length) { toast('请先选择照片'); return; }
        var alb = getAlbum(profile.id);
        var ok = sids.filter(function (id) {
          var ph = alb.photos.find(function (p) { return p.id === id; });
          return ph && isRecognized(ph);
        });
        if (!ok.length) { toast('所选照片尚未识图'); return; }
        setPhotosSynced(profile.id, ok, true).then(function () {
          if (!alb.charSyncEnabled) return setCharSyncEnabled(profile.id, true);
        }).then(function () {
          toast('已同步 ' + ok.length + ' 张');
          patchNav({ selectedIds: {} });
          refreshAlbumContent();
          patchBatchUI();
        });
        return;
      }

      var delBatch = e.target.closest('[data-mq-alb-delete]');
      if (delBatch) {
        e.preventDefault();
        var dids = selectedIds();
        if (!dids.length) { toast('请先选择照片'); return; }
        deletePhotos(profile.id, dids).then(function () {
          toast('已删除');
          patchNav({ selectedIds: {}, photoSheetId: '' });
          patchOverlays();
          refreshAlbumContent();
          patchBatchUI();
        });
        return;
      }

      var avBtn = e.target.closest('[data-mq-alb-avatar]');
      if (avBtn) {
        e.preventDefault();
        setProfileAvatarFromPhoto(profile.id, avBtn.getAttribute('data-mq-alb-avatar')).catch(function () {
          toast('设置头像失败');
        });
        return;
      }

      var momBtn = e.target.closest('[data-mq-alb-moment]');
      if (momBtn) {
        e.preventDefault();
        publishPhotoToMoments(profile.id, momBtn.getAttribute('data-mq-alb-moment')).catch(function () {
          toast('发布失败');
        });
        return;
      }

      var charBtn = e.target.closest('[data-mq-alb-char]');
      if (charBtn) {
        e.preventDefault();
        var cid = charBtn.getAttribute('data-mq-alb-char');
        var cph = getAlbum(profile.id).photos.find(function (p) { return p.id === cid; });
        if (!cph || !isRecognized(cph)) { toast('请先识图'); return; }
        var nextSync = cph.syncedToChar === false;
        setPhotosSynced(profile.id, [cid], nextSync).then(function () {
          if (nextSync) return setCharSyncEnabled(profile.id, true);
        }).then(function () {
          toast(nextSync ? '已同步给 Char' : '已取消同步');
          patchOverlays();
        });
        return;
      }

      var reone = e.target.closest('[data-mq-alb-reone]');
      if (reone) {
        e.preventDefault();
        var rid = reone.getAttribute('data-mq-alb-reone');
        toast('识图中…');
        recognizeBatch(profile.id, [rid]).then(function () {
          toast('识图完成');
          patchOverlays();
          if (trim(navData().view) === 'detail') patchDetailPhotos();
        }).catch(function () {
          toast('识图失败，请检查 API 配置');
        });
        return;
      }

      var saveVis = e.target.closest('[data-mq-alb-save-vision]');
      if (saveVis) {
        e.preventDefault();
        var vid = saveVis.getAttribute('data-mq-alb-save-vision');
        var ta = stackEl.querySelector('[data-mq-alb-vision="' + vid + '"]');
        updateVisionText(profile.id, vid, ta ? ta.value : '').then(function () {
          toast('已保存');
        });
        return;
      }

      var delOne = e.target.closest('[data-mq-alb-del]');
      if (delOne) {
        e.preventDefault();
        deletePhotos(profile.id, delOne.getAttribute('data-mq-alb-del')).then(function () {
          toast('已删除');
          patchNav({ photoSheetId: '' });
          patchOverlays();
          if (trim(navData().view) === 'detail') patchDetailPhotos();
          else patchHomeBody();
        });
        return;
      }
    });

    stackEl.addEventListener('change', function (e) {
      if (e.target.matches('[data-mq-alb-grp-all]')) {
        var top = getNav();
        if (!top || top.screen !== 'album') return;
        var panel = e.target.closest('[data-mq-alb-grp-panel]');
        if (!panel) return;
        var box = panel.querySelector('.mi-album-grp-contacts');
        if (box) box.classList.toggle('is-disabled', e.target.checked);
        if (e.target.checked) {
          panel.querySelectorAll('[data-mq-alb-grp-contact]').forEach(function (inp) {
            inp.checked = false;
          });
        }
        return;
      }
      if (e.target.matches('[data-mq-alb-grp-contact]')) {
        var top2 = getNav();
        if (!top2 || top2.screen !== 'album') return;
        var panel2 = e.target.closest('[data-mq-alb-grp-panel]');
        var allBox2 = panel2 && panel2.querySelector('[data-mq-alb-grp-all]');
        if (allBox2 && e.target.checked) {
          allBox2.checked = false;
          var box2 = panel2.querySelector('.mi-album-grp-contacts');
          if (box2) box2.classList.remove('is-disabled');
        }
        return;
      }
      if (!e.target.matches('[data-mq-alb-file]')) return;
      var top = getNav();
      if (!top || top.screen !== 'album') return;
      var files = e.target.files;
      if (!files || !files.length) return;
      var profile = getStore() && getStore().getActiveProfile();
      if (!profile) return;
      var albumNow = getAlbum(profile.id);
      var groupsNow = ensureDefaultGroup(albumNow.groups);
      var gid = resolveActiveGroupId(navData(), groupsNow, albumNow);
      toast('上传中…');
      addPhotos(profile.id, files, gid).then(function (added) {
        e.target.value = '';
        toast(added.length ? '已添加 ' + added.length + ' 张' : '未添加有效图片');
        var filtered = resolveVisibleGroups(groupsNow, albumNow, navData());
        var idx = filtered.findIndex(function (g) { return g.id === gid; });
        patchNav({
          detailGroupId: gid,
          carouselIndex: idx >= 0 ? idx : 0
        });
        if (trim(navData().view) === 'detail') patchDetailPhotos();
        else patchHomeBody();
      });
    });
  }

  whenReady();

  global.MiyaChatAlbum = {
    STORE_KEY: STORE_KEY,
    BATCH_RECOGNIZE_MAX: BATCH_RECOGNIZE_MAX,
    invalidateCache: function () { _cache = null; },
    whenReady: whenReady,
    getAlbum: getAlbum,
    addPhotos: addPhotos,
    deletePhotos: deletePhotos,
    updateVisionText: updateVisionText,
    setCharSyncEnabled: setCharSyncEnabled,
    setPhotosSynced: setPhotosSynced,
    togglePhotoFavorite: togglePhotoFavorite,
    addAlbumGroup: addAlbumGroup,
    renameAlbumGroup: renameAlbumGroup,
    deleteAlbumGroup: deleteAlbumGroup,
    setAlbumGroupContacts: setAlbumGroupContacts,
    movePhotoToGroup: movePhotoToGroup,
    groupAppliesToContact: groupAppliesToContact,
    recognizeBatch: recognizeBatch,
    isRecognized: isRecognized,
    isCharUsable: isCharUsable,
    getCharUsablePhotos: getCharUsablePhotos,
    resolveCharPhoto: resolveCharPhoto,
    resolveAlbumPhotoForSwap: resolveAlbumPhotoForSwap,
    resolveAlbumMediaForMoments: resolveAlbumMediaForMoments,
    buildAlbumContextBlock: buildAlbumContextBlock,
    recordAvatarChangeInChat: recordAvatarChangeInChat,
    setProfileAvatarFromPhoto: setProfileAvatarFromPhoto,
    publishPhotoToMoments: publishPhotoToMoments,
    renderAlbumPage: renderAlbumPage,
    hydrateThumbs: hydrateThumbs,
    captureScroll: captureAlbumScroll,
    restoreScroll: restoreAlbumScroll,
    viewScrollKey: albumViewScrollKey,
    bindAlbumEvents: bindAlbumEvents
  };
})(window);
