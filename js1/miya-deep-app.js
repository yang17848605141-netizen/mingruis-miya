/**
 * miya-deep-app.js — 深入 · 角色选择与 Char Phone
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: 'pick',
    contactId: '',
    contactName: '',
    phoneData: null,
    pageIndex: 0,
    pickIndex: 0,
    pickRows: [],
    settingsOpen: false,
    decoOpen: false
  };

  global.miyaDeepAppState = state;

  var clockTimer = 0;
  var toastTimer = 0;
  var phoneBound = false;

  var APP_LIST = [
    { id: 'wechat', label: '微信', page: 0 },
    { id: 'sms', label: '短信', page: 0 },
    { id: 'douyin', label: '抖音', page: 0 },
    { id: 'health', label: '健康', page: 0 },
    { id: 'xhs', label: '小红书', page: 0 },
    { id: 'novel', label: '小说', page: 0 },
    { id: 'music', label: 'Music', page: 0 },
    { id: 'notepad', label: '记事本', page: 0 },
    { id: 'todo', label: '待办', page: 1 },
    { id: 'couple', label: '情侣手册', page: 1 },
    { id: 'game', label: '游戏', page: 1 },
    { id: 'assets', label: '资产', page: 1 },
    { id: 'bili', label: 'bilibili', page: 1 },
    { id: 'album', label: '相册', page: 1 },
    { id: 'browser', label: '浏览器', page: 1 },
    { id: 'cloud', label: '网盘', page: 1 },
    { id: 'settings', label: '设置', page: 2 },
    { id: 'deco', label: '装修', page: 2 },
    { id: 'shop', label: '购物', page: 2 },
    { id: 'food', label: '外卖', page: 2 }
  ];

  global.miyaDeepAppList = APP_LIST;

  var ICONS = {
    wechat: '<path d="M12 2C6.49 2 2 6.49 2 12c0 2.12.68 4.19 1.93 5.9l-1.75 2.53c-.21.31-.24.7-.06 1.03.17.33.51.54.89.54h9c5.51 0 10-4.49 10-10S17.51 2 12 2m3.35 10.21L12 15.5l-3.35-3.29-.06-.06c-.82-.85-.79-2.2.06-3.01.87-.86 2.26-.86 3.12 0l.22.22.22-.22c.87-.86 2.26-.86 3.12 0l.06.06c.82.85.79 2.2-.06 3.01Z"/>',
    sms: '<path d="M12 3C6.49 3 2 6.59 2 11s4.3 7.85 9.66 8l3.74 2.8c.18.13.39.2.6.2.15 0 .31-.04.45-.11A1 1 0 0 0 17 21v-3.07c3.1-1.42 5-4.03 5-6.93 0-4.41-4.49-8-10-8"/>',
    douyin: '<path d="M17.46 8.32c-.31 1.09-1.13 3.08-3.21 4.24.77-1.85 1.12-3.89 0-6.11-.76-1.5-2.65-3.08-3.73-3.89-.31-.23-.73-.04-.79.34-.15.96-.73 2.62-2.79 4.66C4.52 9.95 3 12.39 3 14.78c0 2.77 1.74 6.26 4.46 7.05.44.13.79-.34.58-.74-2.19-4.05 1.71-7.43 1.71-7.43 0 5 2.25 8.33 5.62 8.33 1.87 0 5.62-1.11 5.62-7.22 0-3.59-1.73-5.74-2.72-6.68a.5.5 0 0 0-.83.22Z"/>',
    health: '<path d="M8.76 7.95c-.19.19-.19.51 0 .71l.1.1c.76.76 2.07.76 2.83 0l3.04-3.04.71.71-.9.9 5.78 5.78c2.29-2.36 2.27-6.01-.07-8.35-2.16-2.15-5.42-2.31-7.77-.54L8.77 7.96Z"/><path d="m9.59 15.81.71-.71 4 4 1.19-1.19-4.01-4.01.71-.71 4.01 4.01 1.19-1.19L13.38 12l.71-.71 4.01 4.01 1.51-1.5-5.79-5.78-1.43 1.43c-.57.57-1.32.88-2.12.88s-1.55-.31-2.12-.88l-.1-.1c-.58-.58-.58-1.53 0-2.12l3.21-3.24c-2.33-1.55-5.42-1.31-7.5.75-2.36 2.37-2.36 6.07 0 8.43l7.53 7.52c.19.19.45.29.71.29s.51-.1.71-.29l.89-.89-4-4Z"/>',
    xhs: '<path d="M12 6c-.64 0-1.26.1-1.84.29C12.46 4.07 15.79 4 16 4V2c-.1 0-10 .11-10 10 0 .64.1 1.26.29 1.84C4.07 11.54 4 8.21 4 8H2c0 .1.11 10 10 10 .64 0 1.26-.1 1.84-.29C11.54 19.93 8.21 20 8 20v2c.1 0 10-.11 10-10 0-.64-.1-1.26-.29-1.84C19.93 12.46 20 15.79 20 16h2c0-.1-.11-10-10-10m-2.5 6a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1-5 0"/>',
    novel: '<path d="M19 2H5c-.55 0-1 .45-1 1v4H2v2h2v2H2v2h2v2H2v2h2v4c0 .55.45 1 1 1h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 18h-3v-2.5h3zm0-4.5h-3V13h3zm0-4.5h-3V8.5h3zm0-4.5h-3V4h3z"/>',
    music: '<path d="M21 3H9c-.55 0-1 .45-1 1v9.56c-.59-.34-1.27-.56-2-.56-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V5h10v8.56c-.59-.34-1.27-.56-2-.56-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V4c0-.55-.45-1-1-1"/>',
    notepad: '<path d="M19 2H5c-.55 0-1 .45-1 1v4H2v2h2v2H2v2h2v2H2v2h2v4c0 .55.45 1 1 1h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-6.5 5C13.93 7 15 8.07 15 9.5S13.93 12 12.5 12 10 10.93 10 9.5 11.07 7 12.5 7M17 17H8v-1c0-1.66 1.34-3 3-3h3c1.66 0 3 1.34 3 3z"/>',
    todo: '<path d="M19 9.09V6c0-.55-.45-1-1-1h-3.09L12.7 2.79a.996.996 0 0 0-1.41 0L9.08 5H5.99c-.55 0-1 .45-1 1v3.09L2.78 11.3a.996.996 0 0 0 0 1.41l2.21 2.21v3.09c0 .55.45 1 1 1h3.09l2.21 2.21c.2.2.45.29.71.29s.51-.1.71-.29l2.21-2.21h3.09c.55 0 1-.45 1-1v-3.09l2.21-2.21a.996.996 0 0 0 0-1.41l-2.21-2.21Zm-8 6.33-2.71-2.71L9.7 11.3l1.29 1.29 3.29-3.29 1.41 1.41-4.71 4.71Z"/>',
    couple: '<path d="M20.24 4.76c-2.31-2.29-5.87-2.35-8.24-.19-2.37-2.16-5.93-2.09-8.24.2-2.36 2.37-2.36 6.07 0 8.43l7.53 7.52c.19.19.45.29.71.29s.51-.1.71-.29l7.53-7.52c2.36-2.36 2.36-6.06 0-8.43ZM5.18 11.78a3.92 3.92 0 0 1 0-5.6C5.97 5.39 6.98 5 7.99 5s2.02.39 2.8 1.18l.5.5c.12.12.26.19.4.23L9.99 12h4l-1.97 6.55-.03.03-6.82-6.81ZM20 8.99v-.02z"/>',
    game: '<path d="M21.11 11.11c.58-.93.89-2.01.89-3.13 0-1.6-.62-3.1-1.75-4.23S17.62 2 16.02 2c-1.12 0-2.2.31-3.13.89l-.24-.24a.996.996 0 0 0-1.41 0L9.65 4.24a.996.996 0 0 0 0 1.41l.13.13-4 4-.13-.13a.996.996 0 0 0-1.41 0l-1.59 1.59a.996.996 0 0 0 0 1.41l.24.24c-.58.93-.89 2.01-.89 3.13 0 1.6.62 3.1 1.75 4.23S6.38 22 7.98 22c1.12 0 2.2-.31 3.13-.89l.24.24c.39.39 1.02.39 1.41 0l1.59-1.59a.996.996 0 0 0 0-1.41l-.13-.13 4-4 .13.13c.39.39 1.02.39 1.41 0l1.59-1.59a.996.996 0 0 0 0-1.41zM7.5 15c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m1-2c0-.28.22-.5.5-.5s.5.22.5.5-.22.5-.5.5-.5-.22-.5-.5m1 4c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m1.5-1.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m3-7c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m1-2c0-.28.22-.5.5-.5s.5.22.5.5-.22.5-.5.5-.5-.22-.5-.5m1 4c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5M17.5 9c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5"/>',
    assets: '<path d="M20 7H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-2h-5c-1.1 0-2-.9-2-2v-3c0-1.1.9-2 2-2h5V9c0-1.1-.9-2-2-2"/><path d="M17 13h5v3h-5zm-.43-10.82a1 1 0 0 0-.93-.11L8.01 5H17V3c0-.33-.16-.64-.43-.82"/>',
    bili: '<path d="M11.29 9.71c.2.2.45.29.71.29s.51-.1.71-.29l2-2A1 1 0 0 0 15 7V3c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v4c0 .27.11.52.29.71zM21 9h-4c-.27 0-.52.11-.71.29l-2 2a.996.996 0 0 0 0 1.41l2 2c.19.19.44.29.71.29h4c.55 0 1-.45 1-1v-4c0-.55-.45-1-1-1Zm-8.29 5.29a.996.996 0 0 0-1.41 0l-2 2a1 1 0 0 0-.29.71v4c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-4c0-.27-.11-.52-.29-.71l-2-2Zm-3-3-2-2A1 1 0 0 0 7 9H3c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h4c.27 0 .52-.11.71-.29l2-2a.996.996 0 0 0 0-1.41Z"/>',
    album: '<path d="M12 11a2 2 0 1 0 0 4 2 2 0 1 0 0-4"/><path d="M20 5h-3l-2.32-1.79a.98.98 0 0 0-.61-.21H9.93c-.22 0-.44.07-.61.21L7 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m-8 12c-2.17 0-4-1.83-4-4s1.83-4 4-4 4 1.83 4 4-1.83 4-4 4m7-8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"/>',
    browser: '<path d="M9.68 16.58C10.23 20.01 11.32 22 12 22s1.76-1.98 2.32-5.42c-.76.05-1.54.08-2.32.08s-1.55-.03-2.32-.08m4.64-9.16C13.77 3.99 12.68 2 12 2s-1.76 1.98-2.32 5.42c.76-.05 1.54-.08 2.32-.08s1.55.03 2.32.08m2.26 2.26c.05.76.08 1.54.08 2.32s-.03 1.55-.08 2.32C20.01 13.77 22 12.68 22 12s-1.98-1.76-5.42-2.32m4.98-.61c-.97-3.16-3.47-5.66-6.63-6.63.68 1.36 1.16 3.18 1.44 5.19 2.01.28 3.83.77 5.19 1.44M12 9.33c-.91 0-1.76.04-2.56.11-.07.8-.11 1.65-.11 2.56s.04 1.76.11 2.56c.8.07 1.65.11 2.56.11s1.76-.04 2.56-.11c.07-.8.11-1.65.11-2.56s-.04-1.76-.11-2.56A29 29 0 0 0 12 9.33m-9.56 5.6c.97 3.16 3.47 5.66 6.63 6.63-.68-1.36-1.16-3.18-1.44-5.19-2.01-.28-3.83-.77-5.19-1.44m12.49 6.63c3.16-.97 5.66-3.47 6.63-6.63-1.36.68-3.18 1.16-5.19 1.44-.28 2.01-.77 3.83-1.44 5.19M2.44 9.07c1.36-.68 3.18-1.16 5.19-1.44.28-2.01.77-3.83 1.44-5.19-3.16.97-5.66 3.47-6.63 6.63M7.33 12c0-.78.03-1.55.08-2.32-3.43.55-5.42 1.64-5.42 2.32s1.98 1.76 5.42 2.32c-.05-.76-.08-1.54-.08-2.32"/>',
    cloud: '<path d="M20.5 3h-17C2.67 3 2 3.67 2 4.5v12c0 .83.67 1.5 1.5 1.5H11v2H8v2h8v-2h-3v-2h7.5c.83 0 1.5-.67 1.5-1.5v-12c0-.83-.67-1.5-1.5-1.5M7 7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1m-1 7 3-4 1.5 2 3-4 4.5 6z"/>',
    settings: '<path d="m19.59 5.82 1.12-1.12-1.41-1.41-1.12 1.12c-.64-.43-1.38-.71-2.18-.83V2h-2v1.65c-.73.17-1.4.5-1.98.95l-1.06-1.06-1.41 1.41 1.14 1.14c-.43.72-.69 1.55-.73 2.44L8.71 7.28 7.3 8.69l1.25 1.25c-.89.04-1.72.3-2.44.73L4.97 9.53l-1.41 1.41L4.62 12c-.45.58-.78 1.25-.95 1.98H2.02v2H3.6c.12.79.4 1.54.83 2.18l-1.12 1.12 1.41 1.41 1.12-1.12c.64.43 1.38.71 2.18.83v1.58h2v-1.56c1.01-.1 1.97-.35 2.88-.69l.76 1.27 1.71-1.03-.66-1.1c.78-.46 1.5-1 2.15-1.62l.94.94 1.41-1.41-1.03-1.03c.46-.61.85-1.27 1.18-1.96l1.19.6.89-1.79-1.38-.69c.17-.62.31-1.26.37-1.91h1.56V8h-1.58a5.35 5.35 0 0 0-.83-2.18ZM7.5 16.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5S9 14.17 9 15s-.67 1.5-1.5 1.5m5 .5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m-.5-3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m-.5-4c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2"/>',
    deco: '<path d="M22 9h-2c-.55 0-1 .45-1 1v3H5v-3c0-.55-.45-1-1-1H2c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1h2v4h2v-4h12v4h2v-4h2c.55 0 1-.45 1-1v-7c0-.55-.45-1-1-1"/><path d="M7 8.5V11h10V8.5c0-.83.67-1.5 1.5-1.5H21V4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v3h2.5C6.33 7 7 7.67 7 8.5"/>',
    shop: '<path d="M10 18a2 2 0 1 0 0 4 2 2 0 1 0 0-4m7 0a2 2 0 1 0 0 4 2 2 0 1 0 0-4m4-12H7.05L5.94 2.68A1 1 0 0 0 4.99 2h-3v2h2.28l3.54 10.63A2 2 0 0 0 9.71 16h7.59a2 2 0 0 0 1.87-1.3l2.76-7.35A.997.997 0 0 0 21 6m-8 7.91-2.71-2.71 1.41-1.41 1.29 1.29 3.29-3.29 1.41 1.41-4.71 4.71Z"/>',
    food: '<path d="M5.94 20.79c.14.7.76 1.21 1.47 1.21H8.8L7.6 10H3.79l2.16 10.79ZM13.19 22l1.2-12H9.61l1.2 12zm3.4 0c.71 0 1.33-.51 1.47-1.21L20.22 10h-3.81l-1.2 12h1.39Zm2.17-16.76A3.5 3.5 0 0 0 15.5 3c-.32 0-.63.04-.93.13a3.487 3.487 0 0 0-5.14 0C9.12 3.04 8.81 3 8.5 3c-1.47 0-2.75.91-3.26 2.24A3.5 3.5 0 0 0 3.04 8h17.92a3.5 3.5 0 0 0-2.2-2.76"/>',
    phone: '<path d="M20.76 3.48C19.86 2.54 18.6 2 17.31 2H7.58c-1.83 0-3.4.59-4.42 1.66-.79.83-1.2 1.92-1.15 3.05.04.96.39 1.87 1 2.62v10.68c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9.33c.6-.75.95-1.66 1-2.62.05-1.19-.38-2.33-1.24-3.23ZM12 9c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m3.5 2c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5m.5-3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"/>'
  };

  function store() { return global.miyaDeepStore || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toast(msg) {
    var el = $('dp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.name || '未命名').trim();
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    return (cs.getContacts() || []).find(function (c) { return c && c.id === id; }) || null;
  }

  function resolveAvatarUrl(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    var direct = String(contact.avatar || '').trim();
    if (direct) return Promise.resolve(direct);
    var blobId = String(contact.avatarBlobId || '').trim();
    if (cs && blobId && typeof cs.getAvatarUrl === 'function') {
      return cs.getAvatarUrl(blobId).catch(function () { return ''; });
    }
    var cts = global.miyaContactsStore;
    if (cts && typeof cts.findCharacter === 'function') {
      var roleId = String(contact.characterId || contact.chronicleId || '').trim();
      if (roleId) {
        var ch = cts.findCharacter(roleId);
        if (ch && ch.avatar) return Promise.resolve(String(ch.avatar));
      }
    }
    return Promise.resolve('');
  }

  function iconSvg(id) {
    var path = ICONS[id] || ICONS.settings;
    return '<svg viewBox="0 0 24 24" fill="currentColor">' + path + '</svg>';
  }

  function appBtn(app) {
    return (
      '<button type="button" class="dp-app" data-dp-app="' + esc(app.id) + '">' +
        '<div class="dp-ib">' + iconSvg(app.id) + '</div>' +
        '<span class="dp-al">' + esc(app.label) + '</span>' +
      '</button>'
    );
  }

  function mountCustomWidget(slotId, widgetId, config) {
    var slot = $(slotId);
    var mount = global.miyaMountCustomWidgetEmbed;
    if (!slot || !mount) return;
    slot.innerHTML = '';
    var wg = mount(widgetId, config);
    if (wg) slot.appendChild(wg);
  }

  function buildCalendarConfig(w, avatarUrl) {
    var base = {
      tag: 'today',
      note: String(w.moodLine || '把寻常日子，过成慢镜头'),
      photo: avatarUrl || null
    };
    return mergeSlotConfig('p1', base);
  }

  function buildGlassdeckConfig(w, avatarUrl) {
    var music = w.music || {};
    var quoteLine = String(w.quote || '').split('\n').filter(Boolean)[0] || '';
    var base = {
      tag: 'soft mood',
      quote: quoteLine || '把日常过成可以收藏的样子',
      sticker: String(music.title || 'daily archive'),
      photo: avatarUrl || null
    };
    return mergeSlotConfig('p2a', base);
  }

  function buildWeekmoodConfig(w, avatarUrl) {
    var base = {
      line1: String(w.moodLine || '今天也要慢慢来'),
      line2: 'meet slowly.',
      avatar: avatarUrl || null
    };
    return mergeSlotConfig('p2b', base);
  }

  function buildMiniplayerConfig(w, avatarUrl) {
    var music = w.music || {};
    var base = {
      title: String(music.title || 'Dream It Possible'),
      artist: String(music.artist || 'Delacey'),
      cover: avatarUrl || null,
      thumb: avatarUrl || null
    };
    return mergeSlotConfig('p2mini', base);
  }

  function buildSleeveConfig(w, avatarUrl) {
    var base = {
      photo: avatarUrl || null,
      tag: 'photocard',
      name: String(w.photoCaption || 'window light'),
      caption: formatPolaroidDate(new Date()) + ' · archive'
    };
    return mergeSlotConfig('p2sleeve', base);
  }

  function formatPolaroidDate(d) {
    return String(d.getFullYear()).slice(-2) + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function mergeSlotConfig(slotKey, baseConfig) {
    var deco = global.miyaDeepDeco;
    if (deco && typeof deco.mergeWidgetConfig === 'function') {
      return deco.mergeWidgetConfig(slotKey, baseConfig);
    }
    return baseConfig;
  }

  function buildInshomeConfig(w, now, charName, avatarUrl) {
    var cd = w.countdown || {};
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var base = {
      time: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      username: String(charName || 'miya') + ' ♡₊˚',
      bio: String(w.profileBio || '★ ‹ 把琐碎过成诗 ›'),
      date: now.getFullYear() + '/' + pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + ' ' + days[now.getDay()],
      plog: String(w.plogTitle || '「plog ✨ ʚɞ ˚ !! ♪」'),
      anniv: '💕 · · ' + String(cd.label || '距离见面 还有'),
      days: Number(cd.days || 0) + ' days',
      quote: String(w.moodQuote || '世界很吵，但你是我的安静。'),
      avatar: avatarUrl || null
    };
    return mergeSlotConfig('p3', base);
  }

  function remountPhoneWidgets() {
    if (!state.phoneData) return Promise.resolve();
    var w = state.phoneData.widgets || {};
    var now = new Date();
    var charName = state.contactName || 'miya';
    return resolveAvatarUrl(getContact(state.contactId)).then(function (avatarUrl) {
      mountPhoneWidgets(w, now, charName, avatarUrl);
      var deco = global.miyaDeepDeco;
      if (deco && typeof deco.bindWidgetSlotClicks === 'function') deco.bindWidgetSlotClicks();
    });
  }

  function mountPhoneWidgets(w, now, charName, avatarUrl) {
    mountCustomWidget('dp-wg-p1', 'blank_4x3_3', buildCalendarConfig(w, avatarUrl));
    mountCustomWidget('dp-wg-p2a', 'blank_4x2_5', buildGlassdeckConfig(w, avatarUrl));
    mountCustomWidget('dp-wg-p2b', 'blank_4x1_7', buildWeekmoodConfig(w, avatarUrl));
    mountCustomWidget('dp-wg-p2-mini', 'blank_2x2_9', buildMiniplayerConfig(w, avatarUrl));
    mountCustomWidget('dp-wg-p2-sleeve', 'blank_2x2_5', buildSleeveConfig(w, avatarUrl));
    mountCustomWidget('dp-wg-p3', 'blank_4x4_3', buildInshomeConfig(w, now, charName, avatarUrl));
  }

  function appBtnP2(app, slot) {
    return (
      '<button type="button" class="dp-app dp-app--p2-' + slot + '" data-dp-app="' + esc(app.id) + '">' +
        '<div class="dp-ib">' + iconSvg(app.id) + '</div>' +
        '<span class="dp-al">' + esc(app.label) + '</span>' +
      '</button>'
    );
  }

  function buildPage2Html(apps) {
    var dock = apps.slice(0, 4);
    var foot = apps.slice(4, 8);
    while (dock.length < 4) dock.push({ id: 'settings', label: '' });
    while (foot.length < 4) foot.push({ id: 'settings', label: '' });
    return (
      '<div class="dp-page2-grid">' +
        '<div class="dp-widget-slot dp-widget-slot--4x2" id="dp-wg-p2a"></div>' +
        '<div class="dp-widget-slot dp-widget-slot--4x1" id="dp-wg-p2b"></div>' +
        '<div class="dp-widget-slot dp-widget-slot--2x2 dp-widget-slot--2x2-r" id="dp-wg-p2-mini"></div>' +
        '<div class="dp-widget-slot dp-widget-slot--2x2 dp-widget-slot--2x2-l" id="dp-wg-p2-sleeve"></div>' +
        appBtnP2(dock[0], 'dock1') +
        appBtnP2(dock[1], 'dock2') +
        appBtnP2(dock[2], 'dock3') +
        appBtnP2(dock[3], 'dock4') +
        appBtnP2(foot[0], 'foot1') +
        appBtnP2(foot[1], 'foot2') +
        appBtnP2(foot[2], 'foot3') +
        appBtnP2(foot[3], 'foot4') +
      '</div>'
    );
  }

  function appRowsHtml(apps) {
    var rows = [];
    var i;
    for (i = 0; i < apps.length; i += 4) {
      rows.push('<div class="dp-app-row">' + apps.slice(i, i + 4).map(appBtn).join('') + '</div>');
    }
    return rows.join('');
  }

  function renderPhoneView(data) {
    var root = $('dp-phone-root');
    if (!root) return;
    var page1Apps = APP_LIST.filter(function (a) { return a.page === 0; });
    var page2Apps = APP_LIST.filter(function (a) { return a.page === 1; });
    var page3Apps = APP_LIST.filter(function (a) { return a.page === 2; });

    var w = data && data.widgets ? data.widgets : {};
    var now = new Date();
    var charName = state.contactName || 'miya';

    root.innerHTML =
      '<div class="dp-phone__wall" aria-hidden="true"></div>' +
      '<div class="dp-phone__top">' +
        '<button type="button" class="dp-phone__switch" id="dp-switch-char">换角色</button>' +
        '<span class="dp-phone__who" id="dp-phone-who">' + esc(w.greeting || '') + '</span>' +
        '<button type="button" class="dp-phone__close" id="dp-phone-close">关闭</button>' +
      '</div>' +
      '<div class="dp-pages" id="dp-pages">' +
        '<div class="dp-page dp-page--1">' +
          '<div class="dp-widget-slot dp-widget-slot--4x3" id="dp-wg-p1"></div>' +
          appRowsHtml(page1Apps) +
        '</div>' +
        '<div class="dp-page dp-page--2">' +
          buildPage2Html(page2Apps) +
        '</div>' +
        '<div class="dp-page dp-page--3">' +
          '<div class="dp-widget-slot dp-widget-slot--4x4" id="dp-wg-p3"></div>' +
          appRowsHtml(page3Apps) +
        '</div>' +
      '</div>' +
      '<div class="dp-bottom">' +
        '<div class="dp-dots" id="dp-dots">' +
          '<button type="button" class="dp-dot on" data-dp-page="0"></button>' +
          '<button type="button" class="dp-dot" data-dp-page="1"></button>' +
          '<button type="button" class="dp-dot" data-dp-page="2"></button>' +
        '</div>' +
        '<div class="dp-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>Search</div>' +
        '<div class="dp-dock">' +
          '<div class="dp-app" data-dp-dock="dock_phone"><div class="dp-ib">' + iconSvg('phone') + '</div></div>' +
          '<div class="dp-app" data-dp-dock="dock_sms"><div class="dp-ib">' + iconSvg('sms') + '</div></div>' +
          '<div class="dp-app" data-dp-dock="dock_browser"><div class="dp-ib">' + iconSvg('browser') + '</div></div>' +
          '<button type="button" class="dp-app dp-app--dock" data-dp-app="settings" data-dp-dock="dock_settings" aria-label="设置">' +
            '<div class="dp-ib">' + iconSvg('settings') + '</div>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="dp-home-bar"></div>';

    bindPhoneEvents();
    tickClock();
    resolveAvatarUrl(getContact(state.contactId)).then(function (avatarUrl) {
      mountPhoneWidgets(w, now, charName, avatarUrl);
      var deco = global.miyaDeepDeco;
      if (deco) {
        if (typeof deco.bindWidgetSlotClicks === 'function') deco.bindWidgetSlotClicks();
        if (typeof deco.applyDecor === 'function') return deco.applyDecor();
      }
    });
    restorePageIndex(data.pageIndex || 0);
  }

  function restorePageIndex(index) {
    var pages = $('dp-pages');
    if (!pages) return;
    var i = Math.max(0, Math.min(2, index || 0));
    state.pageIndex = i;
    pages.scrollTo({ left: i * pages.clientWidth, behavior: 'auto' });
    updateDots(i);
  }

  function updateDots(index) {
    var dots = document.querySelectorAll('#dp-dots .dp-dot');
    dots.forEach(function (dot, j) {
      dot.classList.toggle('on', j === index);
    });
  }

  function tickClock() {
    var n = new Date();
    var t = pad(n.getHours()) + ':' + pad(n.getMinutes());
    var homeTime = document.querySelector('.dp-phone .wg-4x4-home__time');
    if (homeTime) homeTime.textContent = t;
  }

  function startClock() {
    tickClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 30000);
  }

  function stopClock() {
    clearInterval(clockTimer);
  }

  function savePageIndex() {
    var st = store();
    if (!st || !state.contactId || !state.phoneData) return;
    state.phoneData.pageIndex = state.pageIndex;
    st.savePhone(state.contactId, state.phoneData);
  }

  function getChatApiSnapshot() {
    var st = store();
    if (!st || typeof st.getChatApiConfig !== 'function') {
      return { baseUrl: '', apiKey: '', model: '', temperature: 1 };
    }
    return st.getChatApiConfig();
  }

  function formatSettingsTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function fetchOpenAiModels(base, key) {
    var img = global.miyaImageGen;
    if (img && typeof img.fetchOpenAiModels === 'function') {
      return img.fetchOpenAiModels(base, key);
    }
    var url = String(base || '').trim().replace(/\/+$/, '');
    if (!url) return Promise.reject(new Error('no_base'));
    return fetch(url + '/models', {
      headers: { Authorization: 'Bearer ' + String(key || '').trim() }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!Array.isArray(j.data)) return [];
      return j.data.map(function (x) { return x && x.id ? String(x.id) : ''; }).filter(Boolean).sort();
    });
  }

  function fillSettingsModelSelect(ids, keepValue) {
    var sel = $('dp-set-model');
    if (!sel) return;
    var cur = String(keepValue != null ? keepValue : sel.value || '').trim();
    var list = (ids || []).map(function (id) { return String(id || '').trim(); }).filter(Boolean);
    sel.innerHTML = '<option value="">继承对话主 API</option>';
    list.forEach(function (id) {
      var op = document.createElement('option');
      op.value = id;
      op.textContent = id;
      sel.appendChild(op);
    });
    if (cur && list.indexOf(cur) < 0) {
      var custom = document.createElement('option');
      custom.value = cur;
      custom.textContent = cur;
      sel.appendChild(custom);
    }
    if (cur) sel.value = cur;
  }

  function updateSettingsTempLabel(temp, inherited) {
    var num = $('dp-set-temp-num');
    var src = $('dp-set-temp-src');
    if (num) num.textContent = String(temp);
    if (src) src.textContent = inherited ? '继承对话主 API' : '专属温度';
  }

  function updateSettingsStatusCards() {
    var st = store();
    if (!st || !state.phoneData) return;
    var resolved = st.resolvePhoneApiConfig(state.phoneData);
    var ready = !!(resolved.normalizedBaseUrl && resolved.apiKey && resolved.model);
    var statusEl = $('dp-set-status');
    var pulseEl = $('dp-set-pulse-dot');
    var modelEl = $('dp-set-model-preview');
    if (statusEl) {
      statusEl.textContent = ready ? '就绪' : '待配置';
      statusEl.classList.toggle('is-ready', ready);
      statusEl.classList.toggle('is-warn', !ready);
    }
    if (pulseEl) pulseEl.classList.toggle('is-on', ready);
    if (modelEl) {
      modelEl.textContent = resolved.model || '继承对话主模型';
    }
  }

  function renderSettingsPanel() {
    var layer = $('dp-settings');
    if (!layer) return;
    var name = state.contactName || '角色';
    var chat = getChatApiSnapshot();
    var api = state.phoneData && state.phoneData.api ? state.phoneData.api : {};
    var savedTemp = api.temperature;
    var showTemp = savedTemp != null ? savedTemp : chat.temperature;
    var inherited = savedTemp == null;
    var updated = formatSettingsTime(state.phoneData && state.phoneData.updatedAt);

    layer.innerHTML =
      '<div class="dp-settings__veil" aria-hidden="true"></div>' +
      '<span class="dp-settings__deco dp-settings__deco--vert" aria-hidden="true">ISSUE · PHONE · API</span>' +
      '<span class="dp-settings__deco dp-settings__deco--arc" aria-hidden="true"></span>' +
      '<span class="dp-settings__deco dp-settings__deco--dots" aria-hidden="true"></span>' +
      '<span class="dp-settings__deco dp-settings__deco--spark dp-settings__deco--spark-1" aria-hidden="true">✦</span>' +
      '<span class="dp-settings__deco dp-settings__deco--spark dp-settings__deco--spark-2" aria-hidden="true">✦</span>' +
      '<span class="dp-settings__deco dp-settings__deco--spark dp-settings__deco--spark-3" aria-hidden="true">✦</span>' +
      '<header class="dp-settings__head">' +
        '<button type="button" class="dp-settings__back" id="dp-set-back" aria-label="返回">← BACK</button>' +
        '<div class="dp-settings__mast">' +
          '<span class="dp-settings__kicker">CHAR PHONE · PREFERENCES</span>' +
          '<h2 class="dp-settings__title">Pref<em>er</em>ences</h2>' +
        '</div>' +
        '<span class="dp-settings__issue" aria-hidden="true">03</span>' +
      '</header>' +
      '<div class="dp-settings__scroll">' +
        '<p class="dp-settings__for">为 <strong>' + esc(name) + '</strong> 配置查手机专用接口<br>留空项将自动继承对话主 API</p>' +
        '<p class="dp-settings__hint">此处设置仅作用于该角色的手机内容生成，不影响全局对话线路。</p>' +
        '<section class="dp-settings__section">' +
          '<div class="dp-settings__section-head">' +
            '<span class="dp-settings__section-no">01</span>' +
            '<h3 class="dp-settings__section-title">Gateway</h3>' +
            '<span class="dp-settings__section-rule" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="dp-settings__card">' +
            '<label class="dp-settings__field">' +
              '<span class="dp-settings__label">Base URL</span>' +
              '<input type="text" class="dp-settings__input" id="dp-set-base" placeholder="留空则用对话主 API" autocomplete="off" spellcheck="false" value="' + esc(api.baseUrl || '') + '">' +
            '</label>' +
            '<label class="dp-settings__field">' +
              '<span class="dp-settings__label">API Key</span>' +
              '<div class="dp-settings__row">' +
                '<input type="password" class="dp-settings__input" id="dp-set-key" placeholder="留空则用对话主 API" autocomplete="off" value="' + esc(api.apiKey || '') + '">' +
                '<button type="button" class="dp-settings__fetch" id="dp-set-fetch">MODELS</button>' +
              '</div>' +
            '</label>' +
            '<label class="dp-settings__field">' +
              '<span class="dp-settings__label">Model</span>' +
              '<select class="dp-settings__select" id="dp-set-model"></select>' +
            '</label>' +
          '</div>' +
        '</section>' +
        '<section class="dp-settings__section">' +
          '<div class="dp-settings__section-head">' +
            '<span class="dp-settings__section-no">02</span>' +
            '<h3 class="dp-settings__section-title">Temperature</h3>' +
            '<span class="dp-settings__section-rule" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="dp-settings__card">' +
            '<div class="dp-settings__temp-block">' +
              '<input type="range" class="dp-settings__range" id="dp-set-temp" min="0" max="2" step="0.05" value="' + showTemp + '">' +
              '<div class="dp-settings__temp-val">' +
                '<span class="dp-settings__temp-num" id="dp-set-temp-num">' + showTemp + '</span>' +
                '<span class="dp-settings__temp-src" id="dp-set-temp-src">' + (inherited ? '继承对话主 API' : '专属温度') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<div class="dp-settings__deco-grid" aria-hidden="false">' +
          '<div class="dp-settings__stat">' +
            '<span class="dp-settings__stat-k">连接状态</span>' +
            '<div class="dp-settings__pulse">' +
              '<span class="dp-settings__pulse-dot" id="dp-set-pulse-dot"></span>' +
              '<span class="dp-settings__stat-v" id="dp-set-status">—</span>' +
            '</div>' +
          '</div>' +
          '<div class="dp-settings__stat">' +
            '<span class="dp-settings__stat-k">生效模型</span>' +
            '<span class="dp-settings__stat-v" id="dp-set-model-preview">—</span>' +
          '</div>' +
          '<div class="dp-settings__stat dp-settings__stat--wide">' +
            '<span class="dp-settings__stat-k">Last saved · ' + esc(updated) + '</span>' +
            '<blockquote class="dp-settings__quote">「每一部手机，都是一扇只为你敞开的窗。」<cite>— CHAR PHONE ARCHIVE</cite></blockquote>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<footer class="dp-settings__foot">' +
        '<button type="button" class="dp-settings__save" id="dp-set-save">保存设置</button>' +
        '<p class="dp-settings__foot-note">MIYA · DEEP PHONE · ' + esc(name) + '</p>' +
      '</footer>';

    fillSettingsModelSelect(api.model ? [api.model] : [], api.model || '');
    updateSettingsTempLabel(showTemp, inherited);
    updateSettingsStatusCards();
    bindSettingsEvents(chat.temperature);
  }

  function readSettingsApiForm(chatTemp) {
    var base = ($('dp-set-base') || {}).value ? $('dp-set-base').value.trim() : '';
    var key = ($('dp-set-key') || {}).value ? $('dp-set-key').value.trim() : '';
    var model = ($('dp-set-model') || {}).value || '';
    var tempRaw = ($('dp-set-temp') || {}).value;
    var temp = tempRaw != null ? parseFloat(tempRaw) : chatTemp;
    if (!Number.isFinite(temp)) temp = chatTemp;
    if (!Number.isFinite(chatTemp)) chatTemp = 1;

    var slice = {};
    if (base) slice.baseUrl = base;
    if (key) slice.apiKey = key;
    if (model) slice.model = model;
    if (Math.abs(temp - chatTemp) > 0.001) slice.temperature = temp;
    return slice;
  }

  function saveSettingsFromForm() {
    var st = store();
    if (!st || !state.contactId || !state.phoneData) return;
    var chat = getChatApiSnapshot();
    var nextApi = readSettingsApiForm(chat.temperature);
    state.phoneData.api = nextApi;
    st.savePhone(state.contactId, state.phoneData).then(function (saved) {
      if (saved) state.phoneData = saved;
      updateSettingsStatusCards();
      var tempEl = $('dp-set-temp');
      var inherited = !(state.phoneData.api && state.phoneData.api.temperature != null);
      updateSettingsTempLabel(
        tempEl ? parseFloat(tempEl.value) : chat.temperature,
        inherited
      );
      toast('设置已保存');
    }).catch(function () {
      toast('保存失败，请重试');
    });
  }

  function bindSettingsEvents(chatTemp) {
    if (!Number.isFinite(chatTemp)) chatTemp = 1;

    var back = $('dp-set-back');
    if (back) back.onclick = closeSettings;

    var save = $('dp-set-save');
    if (save) save.onclick = saveSettingsFromForm;

    var temp = $('dp-set-temp');
    if (temp) {
      temp.oninput = function () {
        var val = parseFloat(temp.value);
        if (!Number.isFinite(val)) val = chatTemp;
        var inherited = Math.abs(val - chatTemp) < 0.001;
        updateSettingsTempLabel(val, inherited);
      };
    }

    var fetchBtn = $('dp-set-fetch');
    if (fetchBtn) {
      fetchBtn.onclick = function () {
        var baseEl = $('dp-set-base');
        var keyEl = $('dp-set-key');
        var b = baseEl && baseEl.value ? baseEl.value.trim() : '';
        var k = keyEl && keyEl.value ? keyEl.value.trim() : '';
        if (!b || !k) {
          var chat = getChatApiSnapshot();
          if (!b) b = chat.baseUrl;
          if (!k) k = chat.apiKey;
        }
        if (!b || !k) {
          toast('请填写网关与密钥，或先在全局设置对话 API');
          return;
        }
        fetchOpenAiModels(b, k).then(function (ids) {
          fillSettingsModelSelect(ids, ($('dp-set-model') || {}).value);
          toast('已载入 ' + ids.length + ' 个模型');
        }).catch(function () {
          toast('连接失败');
        });
      };
    }
  }

  function openSettings() {
    if (!state.contactId || !state.phoneData) {
      toast('请先进入角色手机');
      return;
    }
    closeDecoPanel();
    var layer = $('dp-settings');
    if (!layer) return;
    state.settingsOpen = true;
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });
    renderSettingsPanel();
  }

  function closeSettings() {
    var layer = $('dp-settings');
    if (!layer) return;
    state.settingsOpen = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
  }

  function closeDecoPanel() {
    var deco = global.miyaDeepDeco;
    if (deco && typeof deco.close === 'function') deco.close();
    state.decoOpen = false;
  }

  function openDecoPanel() {
    var deco = global.miyaDeepDeco;
    if (!deco || typeof deco.open !== 'function') {
      toast('装修功能加载中');
      return;
    }
    closeSettings();
    state.decoOpen = true;
    deco.open();
  }

  function handleAppOpen(appId) {
    if (appId === 'settings') {
      openSettings();
      return;
    }
    if (appId === 'deco') {
      openDecoPanel();
      return;
    }
    if (appId === 'music') {
      var dm = global.miyaDeepMusic;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dm && typeof dm.open === 'function') {
        dm.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('Music 模块加载中');
      }
      return;
    }
    if (appId === 'novel') {
      var dn = global.miyaDeepNovel;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dn && typeof dn.open === 'function') {
        dn.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('小说 模块加载中');
      }
      return;
    }
    if (appId === 'notepad') {
      var dnp = global.miyaDeepNotepad;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dnp && typeof dnp.open === 'function') {
        dnp.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('记事本 模块加载中');
      }
      return;
    }
    if (appId === 'wechat') {
      var dwc = global.miyaDeepWechat;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dwc && typeof dwc.open === 'function') {
        dwc.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('微信 模块加载中');
      }
      return;
    }
    if (appId === 'health') {
      var dh = global.miyaDeepHealth;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dh && typeof dh.open === 'function') {
        dh.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('健康 模块加载中');
      }
      return;
    }
    if (appId === 'todo') {
      var dtd = global.miyaDeepTodo;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dtd && typeof dtd.open === 'function') {
        dtd.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('待办 模块加载中');
      }
      return;
    }
    if (appId === 'couple') {
      var dcp = global.miyaDeepCouple;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dcp && typeof dcp.open === 'function') {
        dcp.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('情侣手册 模块加载中');
      }
      return;
    }
    if (appId === 'game') {
      var dgm = global.miyaDeepGame;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dgm && typeof dgm.open === 'function') {
        dgm.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('游戏 模块加载中');
      }
      return;
    }
    if (appId === 'assets') {
      var das = global.miyaDeepAssets;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (das && typeof das.open === 'function') {
        das.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('资产 模块加载中');
      }
      return;
    }
    if (appId === 'cloud') {
      var dcl = global.miyaDeepCloud;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dcl && typeof dcl.open === 'function') {
        dcl.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('网盘 模块加载中');
      }
      return;
    }
    if (appId === 'bili') {
      var dbi = global.miyaDeepBili;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dbi && typeof dbi.open === 'function') {
        dbi.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('bilibili 模块加载中');
      }
      return;
    }
    if (appId === 'douyin') {
      var ddy = global.miyaDeepDouyin;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (ddy && typeof ddy.open === 'function') {
        ddy.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('抖音 模块加载中');
      }
      return;
    }
    if (appId === 'xhs') {
      var dxhs = global.miyaDeepXhs;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dxhs && typeof dxhs.open === 'function') {
        dxhs.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('小红书 模块加载中');
      }
      return;
    }
    if (appId === 'album') {
      var dal = global.miyaDeepAlbum;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dal && typeof dal.open === 'function') {
        dal.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('相册 模块加载中');
      }
      return;
    }
    if (appId === 'sms') {
      var dsms = global.miyaDeepSms;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dsms && typeof dsms.open === 'function') {
        dsms.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('短信 模块加载中');
      }
      return;
    }
    if (appId === 'browser') {
      var dbr = global.miyaDeepBrowser;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dbr && typeof dbr.open === 'function') {
        dbr.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('浏览器 模块加载中');
      }
      return;
    }
    if (appId === 'food') {
      var dfd = global.miyaDeepFood;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dfd && typeof dfd.open === 'function') {
        dfd.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('外卖 模块加载中');
      }
      return;
    }
    if (appId === 'shop') {
      var dsh = global.miyaDeepShop;
      if (!state.contactId) {
        toast('请先进入角色手机');
        return;
      }
      if (dsh && typeof dsh.open === 'function') {
        dsh.open(state.contactId, state.phoneData, state.contactName);
      } else {
        toast('购物 模块加载中');
      }
      return;
    }
    var label = (APP_LIST.find(function (a) { return a.id === appId; }) || {}).label || appId;
    toast(label + ' · 即将开放');
  }

  function bindPhoneEvents() {
    var pages = $('dp-pages');
    if (pages && !pages._dpBound) {
      pages._dpBound = true;
      pages.addEventListener('scroll', function () {
        var i = Math.round(pages.scrollLeft / (pages.clientWidth || 1));
        if (i !== state.pageIndex) {
          state.pageIndex = i;
          updateDots(i);
          savePageIndex();
        }
      }, { passive: true });
    }

    var dotsWrap = $('dp-dots');
    if (dotsWrap && !dotsWrap._dpBound) {
      dotsWrap._dpBound = true;
      dotsWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dp-page]');
        if (!btn || !pages) return;
        var idx = parseInt(btn.getAttribute('data-dp-page'), 10) || 0;
        pages.scrollTo({ left: idx * pages.clientWidth, behavior: 'smooth' });
      });
    }

    var switchBtn = $('dp-switch-char');
    if (switchBtn) switchBtn.onclick = showPickView;

    var closeBtn = $('dp-phone-close');
    if (closeBtn) closeBtn.onclick = closeDeepApp;

    var phoneRoot = $('dp-phone-root');
    if (phoneRoot && !phoneRoot._dpAppBound) {
      phoneRoot._dpAppBound = true;
      phoneRoot.addEventListener('click', function (e) {
        var app = e.target.closest('[data-dp-app]');
        if (!app) return;
        var id = app.getAttribute('data-dp-app');
        handleAppOpen(id);
      });
    }
  }

  function getCharacterRow(contact) {
    var cts = global.miyaContactsStore;
    if (!cts || typeof cts.findCharacter !== 'function' || !contact) return null;
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    return roleId ? cts.findCharacter(roleId) : null;
  }

  function characterQuote(contact) {
    var row = getCharacterRow(contact);
    var parts = [];
    if (row) {
      ['personality', 'description', 'background'].forEach(function (k) {
        var v = String(row[k] || '').trim();
        if (v) parts.push(v.split(/\n+/)[0]);
      });
    }
    if (parts.length) return parts[0].slice(0, 48);
    return '进入 ta 的私人界面';
  }

  function characterCv(contact) {
    var name = displayName(contact);
    return 'CV. ' + name;
  }

  function setPickControlsEnabled(enabled) {
    var orb = $('dp-pick-choose');
    var cta = $('dp-pick-choose-text');
    if (orb) orb.disabled = !enabled;
    if (cta) cta.disabled = !enabled;
  }

  function updatePickCounter(index, total) {
    var idxEl = $('dp-pick-idx');
    var totEl = $('dp-pick-total');
    if (idxEl) idxEl.textContent = pad(index + 1);
    if (totEl) totEl.textContent = pad(total);
  }

  function updatePickCard(contact) {
    var card = $('dp-pick-card');
    var empty = $('dp-pick-empty');
    var portrait = $('dp-pick-portrait');
    var nameEn = $('dp-pick-name-en');
    var quote = $('dp-pick-quote');
    var cv = $('dp-pick-cv');
    if (!contact) {
      if (card) card.classList.add('is-empty');
      if (empty) empty.removeAttribute('hidden');
      setPickControlsEnabled(false);
      return;
    }
    if (card) card.classList.remove('is-empty');
    if (empty) empty.setAttribute('hidden', '');
    setPickControlsEnabled(true);

    var name = displayName(contact);
    var initial = name.charAt(0) || '?';
    if (nameEn) nameEn.textContent = name.toUpperCase();
    if (quote) quote.textContent = characterQuote(contact);
    if (cv) cv.textContent = characterCv(contact);
    if (portrait) {
      portrait.innerHTML = '<span class="dp-pick__card-placeholder">' + esc(initial) + '</span>';
      resolveAvatarUrl(contact).then(function (url) {
        if (!url || !portrait) return;
        portrait.innerHTML = '<img src="' + esc(url) + '" alt="">';
      });
    }
  }

  function selectPickContact(index, opts) {
    var rows = state.pickRows || [];
    if (!rows.length) {
      state.pickIndex = 0;
      state.contactId = '';
      updatePickCounter(0, 0);
      updatePickCard(null);
      return;
    }
    var i = Math.max(0, Math.min(rows.length - 1, index || 0));
    state.pickIndex = i;
    state.contactId = rows[i].id;
    updatePickCounter(i, rows.length);
    updatePickCard(rows[i]);

    document.querySelectorAll('.dp-pick__thumb').forEach(function (btn, j) {
      btn.classList.toggle('is-active', j === i);
    });

    if (!opts || !opts.silent) {
      var active = document.querySelector('.dp-pick__thumb.is-active');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function renderPickView() {
    var list = $('dp-pick-grid');
    var st = store();
    if (!list || !st) return;
    var rows = st.getAllContactRows();
    state.pickRows = rows;

    if (!rows.length) {
      list.innerHTML = '';
      updatePickCounter(0, 0);
      updatePickCard(null);
      var empty = $('dp-pick-empty');
      if (empty) empty.removeAttribute('hidden');
      setPickControlsEnabled(false);
      return;
    }

    var emptyEl = $('dp-pick-empty');
    if (emptyEl) emptyEl.setAttribute('hidden', '');

    var startIndex = 0;
    if (state.contactId) {
      var found = rows.findIndex(function (c) { return c.id === state.contactId; });
      if (found >= 0) startIndex = found;
    }

    list.innerHTML = rows.map(function (contact, i) {
      var name = displayName(contact);
      var initial = name.charAt(0) || '?';
      var active = i === startIndex ? ' is-active' : '';
      var idx = String(i + 1).padStart(2, '0');
      return (
        '<button type="button" class="dp-pick__thumb' + active + '" data-dp-contact="' + esc(contact.id) + '" data-dp-index="' + i + '">' +
          '<span class="dp-pick__thumb-star" aria-hidden="true">✦</span>' +
          '<div class="dp-pick__thumb-img" data-dp-ava="' + esc(contact.id) + '">' +
            '<span class="dp-pick__thumb-initial">' + esc(initial) + '</span>' +
          '</div>' +
          '<div class="dp-pick__thumb-meta">' +
            '<span class="dp-pick__thumb-name">' + esc(name.toUpperCase()) + '</span>' +
            '<span class="dp-pick__thumb-num">' + idx + '</span>' +
          '</div>' +
        '</button>'
      );
    }).join('');

    rows.forEach(function (contact) {
      resolveAvatarUrl(contact).then(function (url) {
        if (!url) return;
        var ava = document.querySelector('[data-dp-ava="' + contact.id + '"]');
        if (ava) ava.innerHTML = '<img src="' + esc(url) + '" alt="">';
      });
    });

    selectPickContact(startIndex, { silent: true });
  }

  function confirmPickChoice() {
    if (!state.contactId) {
      toast('请先选择角色');
      return;
    }
    enterPhone(state.contactId);
  }

  function showPickView() {
    state.view = 'pick';
    closeSettings();
    closeDecoPanel();
    stopClock();
    var pick = $('dp-pick');
    var phone = $('dp-phone');
    if (pick) pick.removeAttribute('hidden');
    if (phone) phone.setAttribute('hidden', '');
    renderPickView();
  }

  function enterPhone(contactId) {
    var st = store();
    var contact = getContact(contactId);
    if (!st || !contact) return;
    var name = displayName(contact);
    st.getOrCreatePhone(contactId, name).then(function (data) {
      if (data && data.widgets) {
        data.widgets.greeting = name + ' 的手机';
      }
      state.contactId = contactId;
      state.contactName = name;
      state.phoneData = data;
      state.view = 'phone';
      return st.setMeta({ lastContactId: contactId }).then(function () {
        var pick = $('dp-pick');
        var phone = $('dp-phone');
        if (pick) pick.setAttribute('hidden', '');
        if (phone) phone.removeAttribute('hidden');
        renderPhoneView(data);
        startClock();
      });
    }).catch(function () {
      toast('加载失败，请重试');
    });
  }

  function setViewOnOpen() {
    showPickView();
  }

  function bindEvents() {
    if (phoneBound) return;
    phoneBound = true;

    var back = $('dp-pick-back');
    if (back) back.addEventListener('click', closeDeepApp);

    var grid = $('dp-pick-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var thumb = e.target.closest('[data-dp-index]');
        if (!thumb) return;
        var index = parseInt(thumb.getAttribute('data-dp-index'), 10) || 0;
        selectPickContact(index);
      });
    }

    var choose = $('dp-pick-choose');
    if (choose) choose.addEventListener('click', confirmPickChoice);

    var chooseText = $('dp-pick-choose-text');
    if (chooseText) chooseText.addEventListener('click', confirmPickChoice);

    var info = $('dp-pick-info');
    if (info) {
      info.addEventListener('click', function () {
        var contact = getContact(state.contactId);
        if (!contact) {
          toast('请先选择角色');
          return;
        }
        var quote = characterQuote(contact);
        toast(displayName(contact) + ' · ' + quote);
      });
    }
  }

  function openDeepApp() {
    var el = $('miya-deep-app');
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
      setViewOnOpen();
    });
  }

  function closeDeepApp() {
    savePageIndex();
    closeSettings();
    closeDecoPanel();
    var dm = global.miyaDeepMusic;
    if (dm && typeof dm.close === 'function') dm.close();
    var dn = global.miyaDeepNovel;
    if (dn && typeof dn.close === 'function') dn.close();
    var dnp = global.miyaDeepNotepad;
    if (dnp && typeof dnp.close === 'function') dnp.close();
    var dwc = global.miyaDeepWechat;
    if (dwc && typeof dwc.close === 'function') dwc.close();
    var dsms = global.miyaDeepSms;
    if (dsms && typeof dsms.close === 'function') dsms.close();
    var dh = global.miyaDeepHealth;
    if (dh && typeof dh.close === 'function') dh.close();
    var dtd = global.miyaDeepTodo;
    if (dtd && typeof dtd.close === 'function') dtd.close();
    var dcp = global.miyaDeepCouple;
    if (dcp && typeof dcp.close === 'function') dcp.close();
    var dgmClose = global.miyaDeepGame;
    if (dgmClose && typeof dgmClose.close === 'function') dgmClose.close();
    var das = global.miyaDeepAssets;
    if (das && typeof das.close === 'function') das.close();
    var dal = global.miyaDeepAlbum;
    if (dal && typeof dal.close === 'function') dal.close();
    var dbr = global.miyaDeepBrowser;
    if (dbr && typeof dbr.close === 'function') dbr.close();
    var dfd = global.miyaDeepFood;
    if (dfd && typeof dfd.close === 'function') dfd.close();
    var ddyClose = global.miyaDeepDouyin;
    if (ddyClose && typeof ddyClose.close === 'function') ddyClose.close();
    stopClock();
    var el = $('miya-deep-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    state.view = 'pick';
    state.contactId = '';
    state.phoneData = null;

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
        !document.querySelector('.miya-couple-app.is-open') &&
        !document.querySelector('.miya-deep-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  bindEvents();

  global.miyaDeepApp = {
    open: openDeepApp,
    close: closeDeepApp,
    toast: toast,
    remountWidgets: remountPhoneWidgets,
    resolvePhoneApiConfig: function (contactId) {
      var st = store();
      if (!st) return null;
      if (contactId && state.contactId === contactId && state.phoneData) {
        return st.resolvePhoneApiConfig(state.phoneData);
      }
      return st.getPhone(contactId).then(function (raw) {
        var normalized = st.normalizePhone(raw, contactId, '');
        return st.resolvePhoneApiConfig(normalized);
      });
    }
  };
})(typeof window !== 'undefined' ? window : global);
