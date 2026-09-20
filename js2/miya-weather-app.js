/**
 * miya-weather-app.js — 天气 App UI（仿苹果天气，简洁清晰）
 */
(function (global) {
  'use strict';

  var state = {
    view: 'list', // list | detail | search | settings | cares | careDetail
    detailCityId: 'me',
    searchQuery: '',
    searchResults: [],
    searchPending: false,
    forecasts: {},
    loading: false,
    careDetailId: '',
    pendingBindPlace: null,
    popupCareId: ''
  };

  var bound = false;
  var scanTimer = null;
  var searchSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function store() {
    return global.miyaWeatherStore || null;
  }

  function bridge() {
    return global.miyaWeatherBridge || null;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('wx-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove('is-on');
    }, 2200);
  }

  function fmtTemp(n) {
    return n == null || !Number.isFinite(Number(n)) ? '—' : String(Math.round(Number(n))) + '°';
  }

  function fmtHm(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function weekdayZh(dateStr) {
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    var today = store() ? store().isoDate(new Date()) : '';
    if (dateStr === today) return '今天';
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || dateStr;
  }

  function contactName(contact) {
    if (!contact) return '角色';
    return String(contact.remarkName || contact.name || '角色').trim();
  }

  function avatarLetterSvg(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return (
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
          '<rect width="80" height="80" rx="40" fill="#E8EEF5"/>' +
          '<text x="40" y="48" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#8B949E">' +
          ch +
          '</text></svg>'
      )
    );
  }

  function contactAvatar(contact) {
    if (!contact) return '';
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveContactAvatarUrl === 'function') {
      var url = extras.resolveContactAvatarUrl(contact);
      if (url) return String(url);
    }
    var av = String(contact.avatar || '').trim();
    if (av) return av;
    var blobId = String(contact.avatarBlobId || '').trim();
    if (blobId) {
      var cs = global.miyaChatStore;
      if (cs && typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return cached;
      }
    }
    return '';
  }

  function contactAvatarOrFallback(contact) {
    return contactAvatar(contact) || avatarLetterSvg(contactName(contact));
  }

  function hydrateSettingsAvatars(host) {
    if (!host) return;
    var extras = global.miyaChatRoomExtras;
    var cs = global.miyaChatStore;
    host.querySelectorAll('img.wx-row__ava[data-avatar-contact]').forEach(function (img) {
      var cid = img.getAttribute('data-avatar-contact');
      if (!cid || !cs || !cs.findContact) return;
      var contact = cs.findContact(cid);
      if (!contact) return;
      var apply = function (url) {
        if (url && img.getAttribute('data-avatar-contact') === cid) img.src = url;
      };
      if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
        extras.resolveContactAvatarUrlAsync(contact).then(apply).catch(function () {});
        return;
      }
      var blobId = String(contact.avatarBlobId || '').trim();
      if (blobId && cs.getAvatarUrl) {
        cs.getAvatarUrl(blobId).then(apply).catch(function () {});
      }
    });
  }

  function listAllPlaces() {
    var st = store();
    if (!st) return [];
    var me = st.getMyLocation();
    var out = [];
    out.push({
      id: 'me',
      name: me.name || '我的位置',
      lat: me.lat,
      lon: me.lon,
      kind: 'me',
      source: me.source,
      contactId: ''
    });
    st.listCities().forEach(function (c) {
      out.push(c);
    });
    return out;
  }

  function forecastFor(city) {
    if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) return null;
    var key = Number(city.lat).toFixed(3) + ',' + Number(city.lon).toFixed(3);
    return state.forecasts[key] || null;
  }

  function setForecast(city, data) {
    if (!city || !data) return;
    var key = Number(city.lat).toFixed(3) + ',' + Number(city.lon).toFixed(3);
    state.forecasts[key] = data;
  }

  function ensureForecasts(cities) {
    var br = bridge();
    if (!br) return Promise.resolve();
    var jobs = [];
    (cities || []).forEach(function (city) {
      if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) return;
      jobs.push(
        br.fetchForecast(city.lat, city.lon).then(function (data) {
          if (data) setForecast(city, data);
        }).catch(function () {})
      );
    });
    return Promise.all(jobs);
  }

  function setView(view) {
    state.view = view;
    ['list', 'detail', 'search', 'settings', 'cares', 'careDetail'].forEach(function (name) {
      var el = $('wx-page-' + name);
      if (!el) return;
      el.classList.toggle('is-active', name === view);
    });
  }

  function updateDeskMeta() {
    var me = listAllPlaces()[0];
    var fc = forecastFor(me);
    var meta = document.querySelector('[data-miya-copy="p4WeatherMeta"]');
    if (meta && fc && fc.tempNow != null) meta.textContent = fmtTemp(fc.tempNow);
  }

  function latestCareForContact(contactId) {
    var st = store();
    if (!st) return null;
    var list = st.listCares({ contactId: contactId });
    return list[0] || null;
  }

  function renderList() {
    var host = $('wx-list-cards');
    if (!host) return;
    var places = listAllPlaces();
    var unread = store() ? store().getUnreadCount() : 0;
    var badge = $('wx-care-badge');
    if (badge) {
      badge.hidden = unread <= 0;
      badge.textContent = unread > 99 ? '99+' : String(unread);
    }

    if (places.length === 1 && !Number.isFinite(places[0].lat)) {
      host.innerHTML =
        '<div class="wx-empty">还没有位置。<br>点下方搜索添加城市，或在「设置」里开启定位。</div>';
      return;
    }

    host.innerHTML = places
      .map(function (city) {
        var fc = forecastFor(city);
        var theme = (fc && fc.theme) || 'cloudy';
        var sub = '';
        if (city.kind === 'me') {
          sub = city.source === 'gps' ? '我的位置' : city.source === 'manual' ? '已选位置' : '未设置位置';
        } else if (city.kind === 'char') {
          sub = '角色所在地 · ' + (city.label || city.name);
        } else {
          sub = fmtHm(Date.now());
        }
        var careHint = '';
        if (city.kind === 'char' && city.contactId) {
          var care = latestCareForContact(city.contactId);
          if (care && !care.read) {
            careHint =
              '<p class="wx-card__care">关心 · ' + esc(String(care.text || '').slice(0, 36)) + (care.text && care.text.length > 36 ? '…' : '') + '</p>';
          }
        }
        var cond = fc ? fc.text || '—' : '加载中';
        return (
          '<button type="button" class="wx-card" data-wx-open-city="' +
          esc(city.id) +
          '">' +
          '<span class="wx-card__bg wx-theme-' +
          esc(theme) +
          '" aria-hidden="true"></span>' +
          '<div class="wx-card__body">' +
          '<div class="wx-card__top">' +
          '<div class="wx-card__meta">' +
          '<p class="wx-card__name">' +
          esc(city.kind === 'me' ? city.name || '我的位置' : city.kind === 'char' ? city.label || city.name : city.name) +
          '</p>' +
          '<p class="wx-card__sub">' +
          esc(sub) +
          '</p>' +
          '</div>' +
          '<p class="wx-card__temp">' +
          esc(fc ? fmtTemp(fc.tempNow) : '—') +
          '</p>' +
          '</div>' +
          '<div class="wx-card__bottom">' +
          '<p class="wx-card__cond">' +
          esc(cond) +
          '</p>' +
          '<p class="wx-card__hl">最高' +
          esc(fc ? fmtTemp(fc.tempMax) : '—') +
          ' 最低' +
          esc(fc ? fmtTemp(fc.tempMin) : '—') +
          '</p>' +
          '</div>' +
          careHint +
          '</div>' +
          '</button>'
        );
      })
      .join('');
  }

  function renderHourly(fc) {
    if (!fc || !fc.hourly || !fc.hourly.length) {
      return '<p class="wx-hint">暂无逐小时数据</p>';
    }
    var br = bridge();
    return (
      '<div class="wx-hourly">' +
      fc.hourly
        .map(function (h, idx) {
          var label = idx === 0 ? '现在' : fmtHm(h.ts).slice(0, 2) + '时';
          var pop =
            h.pop != null && h.pop >= 10
              ? '<div class="wx-hour__pop">' + h.pop + '%</div>'
              : '<div class="wx-hour__pop"></div>';
          return (
            '<div class="wx-hour">' +
            '<div class="wx-hour__t">' +
            esc(label) +
            '</div>' +
            '<div class="wx-hour__icon">' +
            esc(br ? br.weatherIcon(h.code) : '🌤') +
            '</div>' +
            pop +
            '<div class="wx-hour__temp">' +
            esc(fmtTemp(h.temp)) +
            '</div>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderDaily(fc) {
    if (!fc || !fc.daily || !fc.daily.length) {
      return '<p class="wx-hint">暂无多日预报</p>';
    }
    var br = bridge();
    return fc.daily
      .map(function (d) {
        var pop =
          d.pop != null && d.pop >= 10
            ? '<span class="wx-day-row__pop">' + d.pop + '%</span>'
            : '<span class="wx-day-row__pop"></span>';
        return (
          '<div class="wx-day-row">' +
          '<span class="wx-day-row__day">' +
          esc(weekdayZh(d.date)) +
          '</span>' +
          '<span class="wx-day-row__icon" title="' +
          esc(d.text || '') +
          '">' +
          esc(br ? br.weatherIcon(d.code) : '') +
          '</span>' +
          pop +
          '<span class="wx-day-row__temps">' +
          '<span class="wx-day-row__lo">' +
          esc(fmtTemp(d.tempMin)) +
          '</span>' +
          '<span class="wx-day-row__hi">' +
          esc(fmtTemp(d.tempMax)) +
          '</span>' +
          '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function formatCareReplyLine(care, r) {
    if (!r || !r.text) return '';
    var who = r.from === 'char' ? care.contactName || 'TA' : '我';
    return (
      '<p class="wx-care-card__reply' +
      (r.from === 'char' ? ' is-char' : ' is-user') +
      '">' +
      esc(who) +
      '：' +
      esc(r.text) +
      '</p>'
    );
  }

  function renderCareRepliesHtml(care) {
    var replies = Array.isArray(care && care.replies) ? care.replies : [];
    if (!replies.length) return '';
    return (
      '<div class="wx-care-card__replies">' +
      replies
        .map(function (r) {
          return formatCareReplyLine(care, r);
        })
        .join('') +
      '</div>'
    );
  }

  function displayCareMainText(care) {
    var t = String((care && care.text) || '');
    if (t.indexOf('【我送出的关心】') === 0) return '我：' + t.slice('【我送出的关心】'.length);
    return t;
  }

  function renderCarePanelForCity(city) {
    if (!city || city.kind !== 'char' || !city.contactId) return '';
    var care = latestCareForContact(city.contactId);
    if (!care) {
      return (
        '<section class="wx-panel">' +
        '<p class="wx-panel__title">角色关心</p>' +
        '<p class="wx-panel__desc">还没有来自该角色的关心。可在「设置」里打开每日问候。</p>' +
        '<div class="wx-care-actions">' +
        '<button type="button" class="wx-btn" data-wx-send-care="' +
        esc(city.contactId) +
        '">现在生成一条关心</button>' +
        '<button type="button" class="wx-btn wx-btn--ghost" data-wx-reply-care-manual="' +
        esc(city.contactId) +
        '">给 Ta 送关心</button>' +
        '</div></section>'
      );
    }
    return (
      '<section class="wx-panel wx-care-card">' +
      '<p class="wx-panel__title">角色关心</p>' +
      '<div class="wx-care-card__from">' +
      '<div class="wx-care-card__meta">' +
      '<p class="wx-care-card__name">' +
      esc(care.contactName || 'TA') +
      '</p>' +
      '<p class="wx-care-card__time">' +
      esc(care.date + ' · ' + fmtHm(care.createdAt)) +
      '</p>' +
      '</div></div>' +
      '<p class="wx-care-card__text">' +
      esc(displayCareMainText(care)) +
      '</p>' +
      renderCareRepliesHtml(care) +
      '<div class="wx-care-actions">' +
      '<button type="button" class="wx-btn wx-btn--primary" data-wx-reply-care="' +
      esc(care.id) +
      '">回复关心</button>' +
      '<button type="button" class="wx-btn" data-wx-reply-care-manual="' +
      esc(city.contactId) +
      '">自己写一句</button>' +
      '</div></section>'
    );
  }

  function renderDetail() {
    var city = store() ? store().findCity(state.detailCityId) : null;
    if (!city) city = listAllPlaces()[0];
    var fc = forecastFor(city);
    var theme = (fc && fc.theme) || 'cloudy';
    var bg = $('wx-detail-bg');
    if (bg) bg.className = 'wx-detail__bg wx-theme-' + theme;
    var detail = document.querySelector('#wx-page-detail .wx-detail');
    if (detail) detail.setAttribute('data-wx-theme', theme);

    var nameEl = $('wx-detail-name');
    var subEl = $('wx-detail-sub');
    if (nameEl) {
      nameEl.textContent =
        city.kind === 'me'
          ? city.name || '我的位置'
          : city.kind === 'char'
            ? city.label || city.name
            : city.name;
    }
    if (subEl) {
      if (city.kind === 'me') subEl.textContent = city.source === 'gps' ? '我的位置' : '已选位置';
      else if (city.kind === 'char') subEl.textContent = '角色天气 · ' + (city.name || '');
      else subEl.textContent = '已保存城市';
    }

    var tempEl = $('wx-detail-temp');
    var hlEl = $('wx-detail-hl');
    var condEl = $('wx-detail-cond');
    if (tempEl) tempEl.textContent = fc ? fmtTemp(fc.tempNow) : '—';
    if (hlEl) {
      hlEl.textContent =
        '最高 ' + (fc ? fmtTemp(fc.tempMax) : '—') + ' 最低 ' + (fc ? fmtTemp(fc.tempMin) : '—');
    }
    if (condEl) condEl.textContent = fc ? fc.text || '' : '加载中…';

    var summary = $('wx-hourly-summary');
    if (summary) {
      if (fc && fc.wind != null) {
        summary.textContent = (fc.text || '今日天气') + '。阵风约 ' + fc.wind + ' 米/秒。';
      } else {
        summary.textContent = fc && fc.text ? fc.text + '。' : '正在获取预报…';
      }
    }
    var hourlyHost = $('wx-hourly-host');
    if (hourlyHost) hourlyHost.innerHTML = renderHourly(fc);
    var dailyHost = $('wx-daily-host');
    if (dailyHost) dailyHost.innerHTML = renderDaily(fc);
    var careHost = $('wx-detail-care');
    if (careHost) careHost.innerHTML = renderCarePanelForCity(city);
  }

  function renderSearch() {
    var host = $('wx-search-results');
    if (!host) return;
    var q = String(state.searchQuery || '').trim();
    if (!q) {
      host.innerHTML = '<div class="wx-empty">输入城市名开始搜索</div>';
      return;
    }
    if (state.searchPending) {
      host.innerHTML = '<div class="wx-empty">正在搜索…</div>';
      return;
    }
    if (!state.searchResults.length) {
      host.innerHTML = '<div class="wx-empty">没有找到「' + esc(q) + '」</div>';
      return;
    }
    host.innerHTML = state.searchResults
      .map(function (r, idx) {
        return (
          '<button type="button" class="wx-search-result" data-wx-pick-place="' +
          idx +
          '">' +
          '<span class="wx-search-result__name">' +
          esc(r.name) +
          '</span>' +
          '<span class="wx-search-result__label">' +
          esc(r.label) +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function listContacts() {
    var cs = global.miyaChatStore;
    if (!cs || !cs.getContacts) return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && !c.isGroup;
    });
  }

  function renderSettings() {
    var host = $('wx-settings-body');
    if (!host || !store()) return;
    var me = store().getMyLocation();
    var contacts = listContacts();
    var cities = store().listCities();

    var locBlock =
      '<section class="wx-section">' +
      '<h3 class="wx-section__title">我的位置</h3>' +
      '<p class="wx-section__desc">用于显示真实当地天气；角色每日关心也会参考这里的天气。与聊天「天气感知」分开，需要时再同步。</p>' +
      '<div class="wx-row"><div class="wx-row__main">' +
      '<p class="wx-row__name">' +
      esc(me.name || '尚未设置') +
      '</p>' +
      '<p class="wx-row__meta">' +
      esc(
        me.source === 'gps'
          ? '来源：浏览器定位'
          : me.source === 'manual'
            ? '来源：手动选择'
            : '还没有位置'
      ) +
      '</p></div>' +
      '<button type="button" class="wx-btn" data-wx-locate>重新定位</button></div>' +
      '<button type="button" class="wx-btn wx-btn--ghost" data-wx-goto-search style="width:100%;margin-top:8px">搜索城市设为我的位置</button>' +
      '</section>';

    var careRows = contacts
      .map(function (c) {
        var setting = store().getCareSetting(c.id);
        var boundCity = store().findCityByContact(c.id);
        return (
          '<div class="wx-row" style="flex-wrap:wrap">' +
          '<img class="wx-row__ava" src="' +
          esc(contactAvatarOrFallback(c)) +
          '" alt="" data-avatar-contact="' +
          esc(c.id) +
          '">' +
          '<div class="wx-row__main">' +
          '<p class="wx-row__name">' +
          esc(contactName(c)) +
          '</p>' +
          '<p class="wx-row__meta">' +
          (boundCity ? '角色城市：' + esc(boundCity.name) : '未绑定角色城市（可在添加城市时绑定）') +
          '</p>' +
          '<div class="wx-field"><label>问候时段（每天一次）</label>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
          '<input type="time" data-wx-care-start="' +
          esc(c.id) +
          '" value="' +
          esc(setting.windowStart) +
          '">' +
          '<span style="color:var(--wx-faint)">至</span>' +
          '<input type="time" data-wx-care-end="' +
          esc(c.id) +
          '" value="' +
          esc(setting.windowEnd) +
          '">' +
          '</div></div></div>' +
          '<button type="button" class="wx-toggle' +
          (setting.enabled ? ' is-on' : '') +
          '" role="switch" aria-checked="' +
          (setting.enabled ? 'true' : 'false') +
          '" data-wx-care-toggle="' +
          esc(c.id) +
          '" aria-label="开启每日关心"></button>' +
          '</div>'
        );
      })
      .join('');

    var cityRows = cities
      .map(function (city) {
        return (
          '<div class="wx-row">' +
          '<div class="wx-row__main"><p class="wx-row__name">' +
          esc(city.label || city.name) +
          '</p><p class="wx-row__meta">' +
          esc(city.kind === 'char' ? '角色城市' : '已保存') +
          '</p></div>' +
          '<button type="button" class="wx-btn wx-btn--ghost" data-wx-remove-city="' +
          esc(city.id) +
          '">删除</button></div>'
        );
      })
      .join('');

    host.innerHTML =
      locBlock +
      '<section class="wx-section">' +
      '<h3 class="wx-section__title">每日关心</h3>' +
      '<p class="wx-section__desc">开启后，角色会在设定时段根据「我的位置」天气发来关心（弹窗 + 写在天气里，不进聊天）。</p>' +
      (careRows || '<div class="wx-empty">暂无角色联系人</div>') +
      '</section>' +
      '<section class="wx-section">' +
      '<h3 class="wx-section__title">已保存城市</h3>' +
      '<p class="wx-section__desc">搜索添加的城市会出现在这里。绑定角色后，可查看 Ta 那边的天气并回关心。</p>' +
      (cityRows || '<div class="wx-empty">还没有额外城市</div>') +
      '</section>';
    hydrateSettingsAvatars(host);
  }

  function renderCares() {
    var host = $('wx-cares-body');
    if (!host || !store()) return;
    var list = store().listCares();
    if (!list.length) {
      host.innerHTML = '<div class="wx-empty">还没有关心记录。<br>在设置里为角色打开「每日关心」即可。</div>';
      return;
    }
    host.innerHTML = list
      .map(function (c) {
        return (
          '<button type="button" class="wx-care-item' +
          (!c.read ? ' is-unread' : '') +
          '" data-wx-open-care="' +
          esc(c.id) +
          '">' +
          '<div class="wx-care-item__top">' +
          '<p class="wx-care-item__name">' +
          esc(c.contactName || 'TA') +
          (!c.read ? ' · 未读' : '') +
          '</p>' +
          '<p class="wx-care-item__time">' +
          esc(c.date) +
          '</p></div>' +
          '<p class="wx-care-item__text">' +
          esc(c.text) +
          '</p></button>'
        );
      })
      .join('');
  }

  function renderCareDetail() {
    var host = $('wx-care-detail-body');
    if (!host || !store()) return;
    var care = store().getCare(state.careDetailId);
    if (!care) {
      host.innerHTML = '<div class="wx-empty">记录不存在</div>';
      return;
    }
    store().markCareRead(care.id);
    var snap = care.weatherSnapshot || {};
    host.innerHTML =
      '<section class="wx-panel">' +
      '<p class="wx-panel__title">来自 ' +
      esc(care.contactName || 'TA') +
      '</p>' +
      '<p class="wx-care-card__time">' +
      esc(care.date + ' · ' + fmtHm(care.createdAt)) +
      '</p>' +
      '<p class="wx-care-card__text" style="margin-top:10px">' +
      esc(displayCareMainText(care)) +
      '</p>' +
      (snap.name
        ? '<p class="wx-hint" style="margin-top:10px">当时天气：' +
          esc(snap.name) +
          ' · ' +
          esc(snap.text || '') +
          ' ' +
          esc(snap.temp != null ? snap.temp + '°' : '') +
          '</p>'
        : '') +
      renderCareRepliesHtml(care) +
      '<div class="wx-care-actions">' +
      '<button type="button" class="wx-btn wx-btn--primary" data-wx-reply-care="' +
      esc(care.id) +
      '">回复关心</button>' +
      '</div></section>';
  }

  function renderAll() {
    if (state.view === 'list') renderList();
    if (state.view === 'detail') renderDetail();
    if (state.view === 'search') renderSearch();
    if (state.view === 'settings') renderSettings();
    if (state.view === 'cares') renderCares();
    if (state.view === 'careDetail') renderCareDetail();
    updateDeskMeta();
  }

  function openCity(id) {
    state.detailCityId = String(id || 'me');
    setView('detail');
    var city = store() && store().findCity(state.detailCityId);
    ensureForecasts(city ? [city] : []).then(function () {
      renderDetail();
      if (city && city.kind === 'char' && city.contactId) {
        var care = latestCareForContact(city.contactId);
        if (care) store().markCareRead(care.id);
      }
    });
  }

  function showCarePopup(care) {
    if (!care) return;
    state.popupCareId = care.id;
    var br = bridge();
    if (br && typeof br.showCareBanner === 'function') {
      br.showCareBanner(care);
      return;
    }
    if (br && typeof br.notifyCare === 'function') {
      br.notifyCare(care);
    }
  }

  function hideCarePopup() {
    state.popupCareId = '';
    var br = bridge();
    if (br && typeof br.dismissCareBanner === 'function') br.dismissCareBanner();
  }

  function getOpenCareId() {
    if (state.view !== 'careDetail') return '';
    return String(state.careDetailId || '');
  }

  function openCare(careId) {
    var id = String(careId || '').trim();
    openWeatherApp({ careId: id, skipScanPopup: true });
  }

  function showBindModal(place) {
    state.pendingBindPlace = place;
    var modal = $('wx-bind-modal');
    var host = $('wx-bind-list');
    if (!host) return;
    var contacts = listContacts();
    host.innerHTML =
      '<button type="button" class="wx-search-result" data-wx-bind-mine>' +
      '<span class="wx-search-result__name">设为我的位置</span>' +
      '<span class="wx-search-result__label">用于真实当地天气与角色每日关心</span></button>' +
      '<button type="button" class="wx-search-result" data-wx-bind-none>' +
      '<span class="wx-search-result__name">只保存城市</span>' +
      '<span class="wx-search-result__label">不绑定角色，仅加入天气列表</span></button>' +
      (contacts
        .map(function (c) {
          return (
            '<button type="button" class="wx-search-result" data-wx-bind-contact="' +
            esc(c.id) +
            '">' +
            '<span class="wx-search-result__name">绑定给 ' +
            esc(contactName(c)) +
            '</span>' +
            '<span class="wx-search-result__label">之后可查看 Ta 那边天气并回关心</span></button>'
          );
        })
        .join('') || '<div class="wx-empty">暂无角色可绑定</div>');
    if (modal) modal.classList.add('is-open');
  }

  function hideBindModal() {
    var modal = $('wx-bind-modal');
    if (modal) modal.classList.remove('is-open');
    state.pendingBindPlace = null;
  }

  function addPlace(place, contactId) {
    var st = store();
    var br = bridge();
    if (!st || !place) return;
    if (!contactId && !st.getMyLocation().name && !Number.isFinite(st.getMyLocation().lat)) {
      // first place can be offered as my location via separate flow; here always add city
    }
    var contact = null;
    if (contactId) {
      contact = listContacts().find(function (c) {
        return String(c.id) === String(contactId);
      });
      var existing = st.findCityByContact(contactId);
      if (existing) st.removeCity(existing.id);
    }
    var city = st.upsertCity({
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      kind: contact ? 'char' : 'saved',
      contactId: contact ? contact.id : '',
      characterId: contact ? String(contact.characterId || contact.chronicleId || '') : '',
      label: contact ? contactName(contact) : ''
    });
    if (contact) {
      st.setCareSetting(contact.id, { cityId: city.id });
    }
    hideBindModal();
    toast(contact ? '已绑定「' + contactName(contact) + '」的城市' : '已添加城市');
    ensureForecasts([city]).then(function () {
      setView('list');
      renderAll();
    });
  }

  function promptReply(careId) {
    var dlg = global.miyaDialog;
    var ask = dlg && dlg.prompt
      ? dlg.prompt({
          title: '回复关心',
          message: '写一句回关心，随后角色会继续回复你。',
          placeholder: '例如：谢谢你，你也要注意保暖'
        })
      : Promise.resolve(window.prompt('写一句回关心', '') || '');

    Promise.resolve(ask).then(function (val) {
      if (val == null) return;
      var text = String(val).trim();
      if (!text) {
        toast('请输入内容');
        return;
      }
      toast('正在生成…');
      var br = bridge();
      if (!br || typeof br.replyToCareWithFollowUp !== 'function') {
        toast('天气模块未就绪');
        return;
      }
      return br
        .replyToCareWithFollowUp(careId, text)
        .then(function () {
          toast('角色已回复');
          if (store()) store().markCareRead(careId);
          renderAll();
        })
        .catch(function (err) {
          toast((err && err.message) || '回复失败');
          renderAll();
        });
    });
  }

  function sendManualCare(contactId) {
    var dlg = global.miyaDialog;
    var ask = dlg && dlg.prompt
      ? dlg.prompt({
          title: '给 Ta 送关心',
          message: '写一句关心，角色会根据天气继续回复你。',
          placeholder: '例如：那边下雨了，出门记得带伞'
        })
      : Promise.resolve(window.prompt('给 Ta 的关心', '') || '');

    Promise.resolve(ask).then(function (val) {
      if (val == null) return;
      var text = String(val).trim();
      if (!text) {
        toast('请输入内容');
        return;
      }
      var br = bridge();
      if (!br || typeof br.sendUserCareWithFollowUp !== 'function') {
        toast('天气模块未就绪');
        return;
      }
      toast('正在生成…');
      br.sendUserCareWithFollowUp(contactId, text)
        .then(function (res) {
          if (res && res.care && store()) store().markCareRead(res.care.id);
          toast('角色已回复');
          renderAll();
        })
        .catch(function (err) {
          toast((err && err.message) || '送出失败');
          renderAll();
        });
    });
  }

  function refreshAndRender() {
    var places = listAllPlaces().filter(function (p) {
      return Number.isFinite(p.lat) && Number.isFinite(p.lon);
    });
    state.loading = true;
    return ensureForecasts(places).then(function () {
      state.loading = false;
      renderAll();
    });
  }

  function maybeRequestLocationOnOpen() {
    var st = store();
    var br = bridge();
    if (!st || !br) return Promise.resolve();
    var me = st.getMyLocation();
    /* 已有坐标：只拉天气，不再弹定位；地址靠用户手动「重新定位」或搜城市 */
    if (Number.isFinite(me.lat) && Number.isFinite(me.lon)) {
      return br.fetchForecast(me.lat, me.lon).then(function (fc) {
        setForecast(me, fc);
      });
    }
    if (me.permission === 'denied') return Promise.resolve();
    return br
      .requestMyLocation()
      .then(function (loc) {
        toast('已获取：' + (loc.name || '我的位置'));
        return br.fetchForecast(loc.lat, loc.lon).then(function (fc) {
          setForecast(loc, fc);
        });
      })
      .catch(function () {
        toast('定位未开启，可在设置里手动搜城市');
      });
  }

  function runCareScan(showPopup) {
    var br = bridge();
    if (!br) return Promise.resolve();
    /* 打开天气 App 时也走「先刷今日天气再关心」，与后台上线逻辑一致 */
    var weatherP =
      typeof br.refreshTodayWeatherForCare === 'function'
        ? br.refreshTodayWeatherForCare().catch(function () {})
        : Promise.resolve();
    return weatherP.then(function () {
      return br.runDueCares().then(function (results) {
        var ok = (results || []).filter(function (r) {
          return r && r.ok && r.care;
        });
        if (ok.length && showPopup) showCarePopup(ok[0].care);
        if (ok.length) renderAll();
        return ok;
      });
    });
  }

  function startScan() {
    /* 后台调度改由 miya-weather-bridge 统一负责 */
  }

  function stopScan() {
    if (!scanTimer) return;
    if (typeof scanTimer === 'function') scanTimer();
    else clearInterval(scanTimer);
    scanTimer = null;
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    var root = $('miya-weather-app');
    if (!root) return;

    root.addEventListener('click', function (e) {
      if (e.target.closest('#wx-close') || e.target.closest('[data-wx-close]')) {
        closeWeatherApp();
        return;
      }
      if (e.target.closest('[data-wx-back-list]')) {
        setView('list');
        renderAll();
        return;
      }
      if (e.target.closest('[data-wx-open-settings]')) {
        setView('settings');
        renderSettings();
        return;
      }
      if (e.target.closest('[data-wx-open-cares]')) {
        setView('cares');
        renderCares();
        return;
      }
      if (e.target.closest('[data-wx-goto-search]')) {
        setView('search');
        renderSearch();
        var input = $('wx-search-input');
        if (input) input.focus();
        return;
      }
      if (e.target.closest('[data-wx-mark-all-read]')) {
        if (store()) store().markAllCaresRead();
        toast('已全部标为已读');
        renderCares();
        return;
      }

      var openCityBtn = e.target.closest('[data-wx-open-city]');
      if (openCityBtn) {
        openCity(openCityBtn.getAttribute('data-wx-open-city'));
        return;
      }

      var openCare = e.target.closest('[data-wx-open-care]');
      if (openCare) {
        state.careDetailId = openCare.getAttribute('data-wx-open-care');
        setView('careDetail');
        renderCareDetail();
        return;
      }

      if (e.target.closest('[data-wx-locate]')) {
        var br = bridge();
        if (!br) return;
        toast('正在定位…');
        br.requestMyLocation()
          .then(function (loc) {
            toast('已定位到 ' + (loc.name || '当前位置'));
            return refreshAndRender();
          })
          .catch(function () {
            toast('定位失败，请检查浏览器权限');
          });
        return;
      }

      var toggle = e.target.closest('[data-wx-care-toggle]');
      if (toggle) {
        var cid = toggle.getAttribute('data-wx-care-toggle');
        var cur = store().getCareSetting(cid);
        store().setCareSetting(cid, { enabled: !cur.enabled });
        renderSettings();
        toast(!cur.enabled ? '已开启每日关心' : '已关闭');
        return;
      }

      var removeCity = e.target.closest('[data-wx-remove-city]');
      if (removeCity) {
        store().removeCity(removeCity.getAttribute('data-wx-remove-city'));
        toast('已删除');
        renderSettings();
        return;
      }

      var pick = e.target.closest('[data-wx-pick-place]');
      if (pick) {
        var idx = Number(pick.getAttribute('data-wx-pick-place'));
        var place = state.searchResults[idx];
        if (!place) return;
        showBindModal(place);
        return;
      }

      if (e.target.closest('[data-wx-bind-mine]')) {
        var minePlace = state.pendingBindPlace;
        if (minePlace && bridge()) {
          bridge().setMyLocationManual(minePlace);
          hideBindModal();
          toast('已设为我的位置');
          ensureForecasts([store().getMyLocation()]).then(function () {
            setView('list');
            renderAll();
          });
        }
        return;
      }

      if (e.target.closest('[data-wx-bind-none]')) {
        addPlace(state.pendingBindPlace, '');
        return;
      }
      var bindC = e.target.closest('[data-wx-bind-contact]');
      if (bindC) {
        addPlace(state.pendingBindPlace, bindC.getAttribute('data-wx-bind-contact'));
        return;
      }
      if (e.target.closest('[data-wx-bind-cancel]')) {
        hideBindModal();
        return;
      }

      var sendCare = e.target.closest('[data-wx-send-care]');
      if (sendCare) {
        var sendId = sendCare.getAttribute('data-wx-send-care');
        var brSend = bridge();
        if (!brSend) {
          toast('天气模块未就绪');
          return;
        }
        if (typeof brSend.hasCharacterCareToday === 'function' && brSend.hasCharacterCareToday(sendId)) {
          toast('今天已经发过关心了');
          return;
        }
        toast('正在生成关心…');
        brSend
          .generateCareForContact(sendId)
          .then(function (care) {
            showCarePopup(care);
            renderAll();
          })
          .catch(function (err) {
            toast((err && err.message) || '生成失败');
          });
        return;
      }

      var replyCare = e.target.closest('[data-wx-reply-care]');
      if (replyCare) {
        promptReply(replyCare.getAttribute('data-wx-reply-care'));
        return;
      }
      var manual = e.target.closest('[data-wx-reply-care-manual]');
      if (manual) {
        sendManualCare(manual.getAttribute('data-wx-reply-care-manual'));
        return;
      }

      if (e.target.closest('[data-wx-popup-close]')) {
        hideCarePopup();
        return;
      }
      if (e.target.closest('[data-wx-popup-open]')) {
        var id = state.popupCareId;
        hideCarePopup();
        if (id) openCare(id);
        return;
      }
    });

    root.addEventListener('change', function (e) {
      var start = e.target.closest('[data-wx-care-start]');
      if (start) {
        store().setCareSetting(start.getAttribute('data-wx-care-start'), {
          windowStart: start.value || '08:00'
        });
        return;
      }
      var end = e.target.closest('[data-wx-care-end]');
      if (end) {
        store().setCareSetting(end.getAttribute('data-wx-care-end'), {
          windowEnd: end.value || '10:00'
        });
      }
    });

    var searchInput = $('wx-search-input');
    if (searchInput) {
      var searchTimer = null;
      searchInput.addEventListener('focus', function () {
        if (state.view !== 'search') {
          setView('search');
          renderSearch();
        }
      });
      searchInput.addEventListener('input', function () {
        var q = searchInput.value;
        state.searchQuery = q;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          var query = String(q || '').trim();
          var seq = ++searchSeq;
          if (!query) {
            state.searchPending = false;
            state.searchResults = [];
            renderSearch();
            return;
          }
          state.searchPending = true;
          renderSearch();
          var br = bridge();
          if (!br || !br.searchPlaces) {
            state.searchPending = false;
            state.searchResults = [];
            renderSearch();
            return;
          }
          br.searchPlaces(query)
            .then(function (rows) {
              if (seq !== searchSeq) return;
              state.searchPending = false;
              state.searchResults = rows || [];
              renderSearch();
            })
            .catch(function () {
              if (seq !== searchSeq) return;
              state.searchPending = false;
              state.searchResults = [];
              renderSearch();
            });
        }, 280);
      });
    }

    var listSearch = $('wx-list-search');
    if (listSearch) {
      listSearch.addEventListener('focus', function () {
        setView('search');
        renderSearch();
        var input = $('wx-search-input');
        if (input) {
          input.value = listSearch.value || '';
          state.searchQuery = input.value;
          input.focus();
        }
      });
      listSearch.addEventListener('input', function () {
        setView('search');
        var input = $('wx-search-input');
        if (input) {
          input.value = listSearch.value || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }
      });
    }
  }

  function openWeatherApp(opts) {
    opts = opts || {};
    var el = $('miya-weather-app');
    if (!el) return;
    var targetCareId = String(opts.careId || '').trim();
    var skipScanPopup = !!opts.skipScanPopup || !!targetCareId;
    var chain = Promise.resolve();
    var cs = global.miyaChatStore;
    if (cs && cs.init) chain = chain.then(function () {
      return cs.init();
    });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () {
      return cts.whenReady();
    });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      if (global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(el);
      bindEvents();
      if (targetCareId) {
        state.careDetailId = targetCareId;
        if (store()) store().markCareRead(targetCareId);
        setView('careDetail');
        renderCareDetail();
        refreshAndRender();
        return;
      }
      setView('list');
      maybeRequestLocationOnOpen()
        .then(function () {
          return refreshAndRender();
        })
        .then(function () {
          if (skipScanPopup) return null;
          return runCareScan(true);
        })
        .then(function (ok) {
          if (skipScanPopup) return;
          if (ok && ok.length) return;
          var unread = store() ? store().listCares({ unreadOnly: true }) : [];
          if (unread[0]) showCarePopup(unread[0]);
        });
      // 后台扫描由 weather-bridge 负责
    });
  }

  function closeWeatherApp() {
    var el = $('miya-weather-app');
    if (!el) return;
    hideCarePopup();
    hideBindModal();
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

  function bootScan() {
    /* bridge 侧已负责扫描 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindEvents();
    });
  } else {
    bindEvents();
  }

  global.miyaWeatherApp = {
    open: openWeatherApp,
    openCare: openCare,
    close: closeWeatherApp,
    refresh: refreshAndRender,
    runCareScan: runCareScan,
    showCarePopup: showCarePopup,
    getOpenCareId: getOpenCareId
  };
})(typeof window !== 'undefined' ? window : global);
