/**
 * miya-couple-photos.js — 情侣空间 · 照片墙
 * 展示与该联系人在聊天中双方发送过的真实图片
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var ROTATIONS = [-2.5, 1.8, -1.2, 2.2, -1.8, 1.2, -2, 0.8, 2.5, -0.6];
  var DECOR = ['pin', 'tape', 'tape', 'pin', 'tape', 'tape', 'pin', 'tape'];

  var state = {
    contactId: '',
    page: 0,
    photos: []
  };

  function store() { return global.miyaCoupleStore || null; }

  function chatStore() { return global.miyaChatStore || null; }

  function toast(msg) {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
      global.miyaCoupleApp.toast(msg);
    }
  }

  function trim(s) { return String(s || '').trim(); }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setViewVisible(show) {
    var view = $('cp-view-photos');
    var app = $('miya-couple-app');
    if (view) view.hidden = !show;
    if (app) app.classList.toggle('is-photos', !!show);
  }

  function resolveProfileName(contactId) {
    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    if (sp && sp.profileName) return trim(sp.profileName);
    var cs = chatStore();
    if (cs && sp && sp.profileId && typeof cs.getProfiles === 'function') {
      var profile = (cs.getProfiles() || []).find(function (p) {
        return p && p.id === sp.profileId;
      });
      if (profile && profile.name) return trim(profile.name);
    }
    return 'Sunny';
  }

  function isRealChatPhoto(msg) {
    if (!msg || msg.deleted) return false;
    if (msg.type !== 'image') return false;
    if (!trim(msg.imageDataKey)) return false;
    if (msg.imageKind === 'text') return false;
    return true;
  }

  function collectChatPhotos(contactId) {
    var cs = chatStore();
    if (!cs || !contactId) return [];
    var chats = (cs.getChats('all') || []).filter(function (ch) {
      return ch && ch.contactId === contactId && ch.type !== 'group';
    });
    var items = [];
    var seen = {};
    chats.forEach(function (chat) {
      var msgs = cs.getMessages(chat.id) || [];
      msgs.forEach(function (msg) {
        if (!isRealChatPhoto(msg)) return;
        var key = trim(msg.imageDataKey);
        if (seen[key]) return;
        seen[key] = true;
        items.push({
          key: key,
          role: msg.role === 'user' ? 'user' : 'assistant',
          createdAt: Number(msg.createdAt) || 0,
          msgId: msg.id || ''
        });
      });
    });
    items.sort(function (a, b) { return b.createdAt - a.createdAt; });
    return items;
  }

  function formatPhotoDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '.' + m + '.' + day;
  }

  function roleLabel(role, contactId) {
    if (role === 'user') return '我';
    return resolveProfileName(contactId) || 'Ta';
  }

  function decorForIndex(i) {
    return DECOR[i % DECOR.length] || 'tape';
  }

  function rotationForIndex(i) {
    return ROTATIONS[i % ROTATIONS.length] || 0;
  }

  function renderProfile(contactId, count) {
    var nameEl = $('cp-photos-profile-name');
    if (nameEl) nameEl.textContent = resolveProfileName(contactId);

    var countEl = $('cp-photos-profile-count');
    if (countEl) countEl.textContent = count + (count === 1 ? ' photo' : ' photos');

    var barEl = $('cp-photos-profile-bar');
    if (barEl) {
      var pct = count ? Math.min(100, Math.round((Math.min(count, 50) / 50) * 100)) : 0;
      barEl.style.width = pct + '%';
    }

    var xpEl = $('cp-photos-profile-xp');
    if (xpEl) {
      xpEl.textContent = count
        ? '来自你们聊天里的 ' + count + ' 张真实图片'
        : '聊天里的真实图片';
    }

    var subEl = $('cp-photos-sub');
    if (subEl) {
      subEl.textContent = count
        ? '共 ' + count + ' 张 · 聊天里的真实瞬间'
        : '聊天里的真实瞬间';
    }
  }

  function buildCollageItem(photo, index, contactId) {
    var decor = decorForIndex(index);
    var rot = rotationForIndex(index);
    var meta = formatPhotoDate(photo.createdAt);
    var who = roleLabel(photo.role, contactId);
    var decorHtml = decor === 'pin'
      ? '<span class="cp-ph-pin" aria-hidden="true"></span>'
      : '<span class="cp-ph-tape" aria-hidden="true"></span>';
    var badge = index === 0
      ? '<span class="cp-ph-badge" aria-hidden="true"><span>new</span><i>✦</i></span>'
      : '';

    return (
      '<article class="cp-ph-item cp-ph-polaroid cp-ph-polaroid--live cp-ph-polaroid--' + decor + '" style="--ph-rot:' + rot + 'deg">' +
        decorHtml +
        '<button type="button" class="cp-ph-polaroid__btn" data-mq-img-view data-msg-img="' + escapeHtml(photo.key) + '" aria-label="查看图片">' +
          '<img class="cp-ph-polaroid__img" data-msg-img="' + escapeHtml(photo.key) + '" alt="" loading="lazy" decoding="async">' +
        '</button>' +
        badge +
        '<p class="cp-ph-polaroid__meta">' + escapeHtml(meta || who) + ' · ' + escapeHtml(who) + '</p>' +
      '</article>'
    );
  }

  function renderCollage(photos, contactId) {
    var wrap = $('cp-photos-collage-wrap');
    var grid = $('cp-photos-collage');
    var empty = $('cp-photos-empty');
    if (!grid) return;

    var hasPhotos = photos.length > 0;
    if (wrap) wrap.classList.toggle('cp-ph-collage--live', hasPhotos);
    if (empty) empty.hidden = hasPhotos;

    if (!hasPhotos) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = photos.map(function (photo, i) {
      return buildCollageItem(photo, i, contactId);
    }).join('');

    hydrateCollageImages(grid, photos);
  }

  function hydrateCollageImages(root, photos) {
    var cs = chatStore();
    if (!cs || !root) return;
    var keys = photos.map(function (p) { return p.key; }).filter(Boolean);
    if (!keys.length) return;

    var apply = function (map) {
      root.querySelectorAll('img[data-msg-img], img[data-ph-thumb]').forEach(function (img) {
        var key = img.getAttribute('data-msg-img') || img.getAttribute('data-ph-thumb');
        var url = map && key ? map[key] : '';
        if (url) img.src = url;
      });
      root.querySelectorAll('[data-ph-thumb]:not(img)').forEach(function (el) {
        var key = el.getAttribute('data-ph-thumb');
        var url = map && key ? map[key] : '';
        if (url) {
          el.classList.add('has-photo');
          el.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
        }
      });
    };

    if (typeof cs.prefetchBlobUrls === 'function') {
      cs.prefetchBlobUrls(keys).then(apply);
      return;
    }
    if (typeof cs.getAvatarUrl === 'function') {
      Promise.all(keys.map(function (key) {
        return cs.getAvatarUrl(key).then(function (url) {
          return { id: key, url: url || '' };
        });
      })).then(function (rows) {
        var map = {};
        rows.forEach(function (row) {
          if (row && row.id) map[row.id] = row.url;
        });
        apply(map);
      });
    }
  }

  function buildCollectionPages(photos) {
    var pages = [];
    for (var i = 0; i < photos.length; i += 3) {
      pages.push(photos.slice(i, i + 3));
    }
    return pages;
  }

  function renderCollections(photos, contactId) {
    var wrap = $('cp-photos-collections');
    var track = $('cp-photos-collections-track');
    var dots = $('cp-photos-dots');
    if (!wrap || !track) return;

    var pages = buildCollectionPages(photos);
    var total = photos.length;

    if (!pages.length) {
      wrap.hidden = true;
      if (dots) dots.innerHTML = '';
      return;
    }

    wrap.hidden = false;
    if (state.page >= pages.length) state.page = pages.length - 1;
    if (state.page < 0) state.page = 0;

    wrap.style.setProperty('--ph-col-page', String(state.page));
    wrap.setAttribute('data-page', String(state.page));
    wrap.setAttribute('data-pages', String(pages.length));

    track.innerHTML = pages.map(function (page, pageIdx) {
      return (
        '<div class="cp-ph-col-page">' +
          page.map(function (photo, cardIdx) {
            var globalIdx = pageIdx * 3 + cardIdx + 1;
            var title = roleLabel(photo.role, contactId);
            var date = formatPhotoDate(photo.createdAt);
            return (
              '<button type="button" class="cp-ph-col-card" data-cp-ph-col="1" data-mq-img-view data-msg-img="' + escapeHtml(photo.key) + '">' +
                '<span class="cp-ph-col-card__inner">' +
                  '<span class="cp-ph-col-card__title">' + escapeHtml(title) + (date ? ' · ' + escapeHtml(date) : '') + '</span>' +
                  '<span class="cp-ph-col-card__count">' + globalIdx + ' / ' + total + '</span>' +
                  '<span class="cp-ph-col-card__thumb" data-ph-thumb="' + escapeHtml(photo.key) + '"></span>' +
                '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>'
      );
    }).join('');

    if (dots) {
      if (pages.length <= 1) {
        dots.innerHTML = '';
        dots.hidden = true;
      } else {
        dots.hidden = false;
        dots.innerHTML = pages.map(function (_, i) {
          return '<button type="button" class="cp-ph-dots__dot' + (i === state.page ? ' is-active' : '') + '" data-cp-ph-dot="' + i + '" aria-label="第 ' + (i + 1) + ' 页"></button>';
        }).join('');
      }
    }

    hydrateCollageImages(track, photos);
  }

  function setPage(page) {
    var pages = buildCollectionPages(state.photos);
    if (!pages.length) return;
    state.page = Math.max(0, Math.min(pages.length - 1, page));
    renderCollections(state.photos, state.contactId);
  }

  function hydratePhotoKeys(root, keys) {
    var cs = chatStore();
    if (!cs || !root || !keys || !keys.length) return;
    var apply = function (map) {
      root.querySelectorAll('img[data-msg-img], img[data-ph-thumb]').forEach(function (img) {
        var key = img.getAttribute('data-msg-img') || img.getAttribute('data-ph-thumb');
        var url = map && key ? map[key] : '';
        if (url) img.src = url;
      });
      root.querySelectorAll('[data-ph-thumb]:not(img)').forEach(function (el) {
        var key = el.getAttribute('data-ph-thumb');
        var url = map && key ? map[key] : '';
        if (url) {
          el.classList.add('has-photo');
          el.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
        }
      });
    };
    if (typeof cs.prefetchBlobUrls === 'function') {
      cs.prefetchBlobUrls(keys).then(apply);
    } else if (typeof cs.getAvatarUrl === 'function') {
      Promise.all(keys.map(function (key) {
        return cs.getAvatarUrl(key).then(function (url) {
          return { id: key, url: url || '' };
        });
      })).then(function (rows) {
        var map = {};
        rows.forEach(function (row) {
          if (row && row.id) map[row.id] = row.url;
        });
        apply(map);
      });
    }
  }

  function renderHomePreview(contactId) {
    var cid = trim(contactId);
    if (!cid) return;

    var photos = collectChatPhotos(cid);
    var total = photos.length;
    var bentoRecent = photos.slice(0, 3);
    var wallRecent = photos.slice(0, 5);

    var subEl = $('cp-home-ph-sub');
    if (subEl) subEl.textContent = total + (total === 1 ? ' MEMORY' : ' MEMORIES');

    var countEl = $('cp-home-ph-count');
    if (countEl) countEl.textContent = total ? 'VIEW ALL' : 'EMPTY';

    var wallCount = $('cp-home-wall-count');
    if (wallCount) wallCount.textContent = total + (total === 1 ? ' photo' : ' photos');

    ['a', 'b', 'c'].forEach(function (slot, i) {
      var el = $('cp-home-ph-thumb-' + slot);
      if (!el) return;
      var photo = bentoRecent[i];
      el.classList.toggle('has-photo', !!photo);
      el.style.backgroundImage = '';
      if (photo) {
        el.innerHTML = '<img data-ph-thumb="' + escapeHtml(photo.key) + '" alt="" loading="lazy" decoding="async">';
      } else {
        el.innerHTML = '';
        el.removeAttribute('data-ph-thumb');
      }
    });

    var masonry = $('cp-home-wall-masonry');
    if (masonry) {
      if (!wallRecent.length) {
        masonry.innerHTML = '<div class="cp-wall-empty">聊天里发送的真实图片会出现在这里</div>';
      } else {
        masonry.innerHTML = wallRecent.map(function (photo) {
          var cap = formatPhotoDate(photo.createdAt) || roleLabel(photo.role, cid);
          return (
            '<div class="cp-polaroid">' +
              '<button type="button" class="cp-polaroid-img has-photo" data-mq-img-view data-msg-img="' + escapeHtml(photo.key) + '" aria-label="查看图片">' +
                '<img data-ph-thumb="' + escapeHtml(photo.key) + '" data-msg-img="' + escapeHtml(photo.key) + '" alt="" loading="lazy" decoding="async">' +
              '</button>' +
              '<div class="cp-polaroid-cap">' + escapeHtml(cap) + '</div>' +
            '</div>'
          );
        }).join('');
      }
    }

    var keys = [];
    bentoRecent.forEach(function (p) { if (p.key) keys.push(p.key); });
    wallRecent.forEach(function (p) {
      if (p.key && keys.indexOf(p.key) < 0) keys.push(p.key);
    });

    var hydrateRoot = document.getElementById('cp-view-space');
    if (hydrateRoot && keys.length) hydratePhotoKeys(hydrateRoot, keys);
  }

  function bootAndRenderHome(contactId) {
    var cs = chatStore();
    var boot = cs && typeof cs.init === 'function' ? cs.init() : Promise.resolve();
    return Promise.resolve(boot).then(function () {
      renderHomePreview(contactId);
    });
  }

  function renderAll(contactId) {
    var photos = collectChatPhotos(contactId);
    state.photos = photos;
    renderProfile(contactId, photos.length);
    renderCollage(photos, contactId);
    renderCollections(photos, contactId);
  }

  function open(contactId) {
    if (!contactId) return;
    state.contactId = contactId;
    state.page = 0;

    var cs = chatStore();
    var boot = cs && typeof cs.init === 'function' ? cs.init() : Promise.resolve();
    Promise.resolve(boot).then(function () {
      if (state.contactId !== contactId) return;
      renderAll(contactId);
      setViewVisible(true);
    });
  }

  function close() {
    setViewVisible(false);
    var prevContact = state.contactId;
    state.contactId = '';
    state.photos = [];
    state.page = 0;
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.showSpaceView === 'function') {
      global.miyaCoupleApp.showSpaceView();
    }
    if (prevContact) bootAndRenderHome(prevContact);
  }

  function bindEvents() {
    var back = $('cp-photos-back');
    if (back) back.addEventListener('click', close);

    var album = $('cp-photos-album');
    if (album) {
      album.addEventListener('click', function () {
        var wrap = $('cp-photos-collage-wrap');
        if (wrap) wrap.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    var scene = $('cp-photos-scene');
    if (scene) {
      scene.addEventListener('click', function (e) {
        var actionBtn = e.target.closest('[data-cp-ph-action]');
        if (actionBtn) {
          var action = actionBtn.getAttribute('data-cp-ph-action');
          var labels = { decorate: '装饰', shop: '商店', share: '分享' };
          toast((labels[action] || action) + ' · 即将上线');
          return;
        }
        var dot = e.target.closest('[data-cp-ph-dot]');
        if (dot) {
          setPage(Number(dot.getAttribute('data-cp-ph-dot')) || 0);
        }
      });
    }
  }

  bindEvents();

  global.miyaCouplePhotos = {
    open: open,
    close: close,
    collectChatPhotos: collectChatPhotos,
    renderHomePreview: renderHomePreview,
    refresh: function (contactId) {
      var cid = trim(contactId || state.contactId);
      if (!cid) return;
      renderAll(cid);
      bootAndRenderHome(cid);
    }
  };
})(typeof window !== 'undefined' ? window : global);
