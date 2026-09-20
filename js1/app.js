(function () {
  /* 启动时强制关闭全屏应用层，避免透明遮罩挡住主屏触摸 */
  (function resetOverlayApps() {
    document.body.classList.remove('miya-app-open');
    document.querySelectorAll(
      '.miya-beautify-app, .miya-settings-app, .miya-worldbook-app, .miya-contacts-app, #miya-music-app, #miya-chat-app, #miya-memory-app, #miya-diary-app, #miya-theater-app, #miya-offline-app, #miya-typewriter-app, #miya-forum-app, #miya-cstore-app, #miya-itinerary-app, #miya-couple-app, #miya-deep-app, #miya-fun-app, #miya-fun-sayguess, #miya-match-app'
    ).forEach(function (el) {
      if (!el.classList.contains('is-open')) {
        el.setAttribute('hidden', '');
        el.setAttribute('aria-hidden', 'true');
      }
    });
  })();

  var S = 'rgba(70,74,80,0.82)';
  var L = 'rgba(130,136,145,0.65)';

  var SVG_CLASSIC = {
    music: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 17V5l11-2v12" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="17" r="2" stroke="rgba(130,136,145,0.65)" stroke-width="1.2"/><circle cx="18" cy="15" r="2" stroke="rgba(130,136,145,0.65)" stroke-width="1.2"/></svg>',
    memo: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M9 8h6M9 12h6M9 16h4" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="rgba(130,136,145,0.65)" stroke-width="1.2"/><path d="M12.22 4h-.44a1.4 1.4 0 00-1.4 1.4v.12a1.4 1.4 0 01-.7 1.22l-.1.06a1.4 1.4 0 01-1.54-.26l-.08-.08a1.4 1.4 0 00-1.98.61l-.14.24a1.4 1.4 0 00.51 1.92l.1.06a1.4 1.4 0 01.7 1.22v.12a1.4 1.4 0 01-.7 1.22l-.1.06a1.4 1.4 0 00-.51 1.92l.14.24a1.4 1.4 0 001.98.61l.08-.08a1.4 1.4 0 011.54-.26l.1.06a1.4 1.4 0 01.7 1.22V18.6a1.4 1.4 0 001.4 1.4h.44a1.4 1.4 0 001.4-1.4v-.12a1.4 1.4 0 01.7-1.22l.1-.06a1.4 1.4 0 011.54.26l.08.08a1.4 1.4 0 001.98-.61l.14-.24a1.4 1.4 0 00-.51-1.92l-.1-.06a1.4 1.4 0 01-.7-1.22v-.12a1.4 1.4 0 01.7-1.22l.1-.06a1.4 1.4 0 00.51-1.92l-.14-.24a1.4 1.4 0 00-1.98-.61l-.08.08a1.4 1.4 0 01-1.54.26l-.1-.06a1.4 1.4 0 01-.7-1.22V5.4a1.4 1.4 0 00-1.4-1.4z" stroke="rgba(70,74,80,0.82)" stroke-width="1.05" stroke-linejoin="round"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5h7v14H6a1 1 0 01-1-1V5zM12 5h7a1 1 0 011 1v12h-8V5z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    memory: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 22h4M12 2a6 6 0 00-4 10.5V16h8v-3.5A6 6 0 0012 2z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H7l-3 3V6z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 11h8" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/><circle cx="16" cy="9" r="2" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/><path d="M4 16c1.5-2 3.5-3 6-3s4.5 1 6 3" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="7" width="16" height="11" rx="3" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M10 10.5l5 2.5-5 2.5v-5z" fill="rgba(130,136,145,0.65)"/></svg>',
    beauty: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 7.5l1.3 3.2L16.5 12l-3.2 1.3L12 16.5l-1.3-3.2L7.5 12l3.2-1.3z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M18.5 5.5l.7 1.6L20.8 8l-1.6.7L18.5 10.3l-.7-1.6L16.2 8l1.6-.7z" stroke="rgba(130,136,145,0.65)" stroke-width="1"/><path d="M7.5 17l.55 1.25L9.3 18.8l-1.25.55L7.5 20.6l-.55-1.25L5.7 18.8l1.25-.55z" stroke="rgba(130,136,145,0.65)" stroke-width="1"/><path d="M19 14.5l.45 1.05L20.5 16l-1.05.45L19 17.5l-.45-1.05L17.5 16l1.05-.45z" stroke="rgba(130,136,145,0.65)" stroke-width="0.9" opacity="0.75"/></svg>',
    store: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 8h12l-1.2 11H7.2L6 8z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 8a3 3 0 016 0" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><circle cx="8.5" cy="11" r="1.5" fill="rgba(130,136,145,0.65)"/><path d="M3 16l4-3 3 2 4-3 6 5" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linejoin="round"/></svg>',
    world: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><ellipse cx="12" cy="12" rx="3" ry="7.5" stroke="rgba(130,136,145,0.65)" stroke-width="1"/><path d="M4.5 12h15" stroke="rgba(130,136,145,0.65)" stroke-width="1"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none"><rect x="7" y="2" width="10" height="20" rx="2.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M11 18h2" stroke="rgba(130,136,145,0.65)" stroke-width="1.2" stroke-linecap="round"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M3 20c0-3.3 2.7-6 6-6" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/><circle cx="17" cy="9" r="2.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.1"/><path d="M14 20c.5-2.2 2-3.5 4-3.5s3.5 1.3 4 3.5" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    pet: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="10" rx="1.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M6 8V6.5A2.5 2.5 0 018.5 4h7A2.5 2.5 0 0118 6.5V8" stroke="rgba(70,74,80,0.82)" stroke-width="1.1"/><path d="M5 14h14M7 17h2M11 17h2M15 17h2" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/><circle cx="18" cy="11" r="1" fill="rgba(130,136,145,0.65)"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20l5-1 10-10-4-4L5 15l-1 5z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M13 7l4 4" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/></svg>',
    couple: '<svg viewBox="0 0 24 24" fill="none"><circle cx="5.5" cy="7" r="1.8" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><circle cx="18.5" cy="7" r="1.8" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M3.5 10.5h4v7.5H3.5a1 1 0 01-1-1v-5.5a1 1 0 011-1z" stroke="rgba(70,74,80,0.82)" stroke-width="1.1" stroke-linejoin="round"/><path d="M16.5 10.5H21v6.5a1 1 0 01-1 1h-3.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.1" stroke-linejoin="round"/><path d="M12 11.5c-.7-.7-1.8-.7-2.5 0-.7.7-.7 1.8 0 2.5L12 15.5l2.5-2.5c.7-.7.7-1.8 0-2.5-.7-.7-1.8-.7-2.5 0z" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linejoin="round"/></svg>',
    itinerary: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h14" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linecap="round"/><circle cx="18" cy="12" r="2" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/><path d="M18 6v2M18 16v2" stroke="rgba(130,136,145,0.65)" stroke-width="1" stroke-linecap="round"/></svg>',
    cstore: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 9h14l-1.2 10H6.2L5 9z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 9a4 4 0 018 0" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/><circle cx="10" cy="14" r="1" fill="rgba(130,136,145,0.65)"/><circle cx="14" cy="14" r="1" fill="rgba(130,136,145,0.65)"/></svg>',
    rift: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M12 5v14M5 12h14" stroke="rgba(130,136,145,0.65)" stroke-width="1" opacity="0.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    deep: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 4v16M8 4h7a2 2 0 012 2v12H8" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M11 9h4M11 12h3M11 15h2" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 19.5l3.8-1 8.8-8.8-2.8-2.8-8.8 8.8-1 3.8z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M13.8 6.5l2.8 2.8" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/><path d="M4.5 21.5h.15" stroke="rgba(130,136,145,0.65)" stroke-width="1.4" stroke-linecap="round"/><path d="M16 4.5l2 2-1.4 1.4-2-2 1.4-1.4z" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linejoin="round"/></svg>',
    match: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 8h14a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 8v8" stroke="rgba(130,136,145,0.65)" stroke-width="1" stroke-dasharray="2 2"/><circle cx="8.5" cy="12" r="1" fill="rgba(130,136,145,0.65)"/></svg>',
    fun: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="10" rx="1.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M3 9.5h18M3 14.5h18" stroke="rgba(130,136,145,0.65)" stroke-width="0.9" opacity="0.55"/><path d="M10 10.5l4.5 2.5-4.5 2.5v-5z" fill="rgba(130,136,145,0.65)"/></svg>',
    echo: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="2.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><circle cx="12" cy="12" r="5.5" stroke="rgba(130,136,145,0.65)" stroke-width="1" opacity="0.75"/><circle cx="12" cy="12" r="8.5" stroke="rgba(130,136,145,0.65)" stroke-width="0.9" opacity="0.4"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="12" height="16" rx="1.5" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><rect x="9" y="10" width="6" height="5" rx="0.5" stroke="rgba(130,136,145,0.65)" stroke-width="1.1"/><path d="M8 7.5h8" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>',
    weather: '<svg viewBox="0 0 24 24" fill="none"><circle cx="16.5" cy="8" r="2.6" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M16.5 4.2v1M16.5 10.8v1M12.7 8h1M19.3 8h1" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/><path d="M7 17.5c-2 0-3.5-1.4-3.5-3.1S5 11.3 7 11.3c.4-1.9 2.1-3.3 4.2-3.3 2.3 0 4.2 1.7 4.4 3.9 1.6.1 2.9 1.4 2.9 2.9 0 1.6-1.4 3-3.1 3H7z" stroke="rgba(70,74,80,0.82)" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 7.2l5-2.4 5 2.4 5-2.4v12.2l-5 2.4-5-2.4-5 2.4V7.2z" stroke="rgba(70,74,80,0.82)" stroke-width="1.15" stroke-linejoin="round"/><path d="M9.5 4.8v12.2M14.5 7.2v12.2" stroke="rgba(130,136,145,0.65)" stroke-width="1.05" stroke-linecap="round"/><path d="M5.2 10.2l3.6-1.1M10.2 11.5l3.5 1.2M15.1 9.8l3.4-1" stroke="rgba(130,136,145,0.55)" stroke-width="0.95" stroke-linecap="round"/><circle cx="12" cy="11.2" r="2.15" stroke="rgba(70,74,80,0.82)" stroke-width="1.1"/><path d="M12 9.05v2.15l1.35.8" stroke="rgba(130,136,145,0.7)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 13.35v2.1" stroke="rgba(130,136,145,0.65)" stroke-width="1.05" stroke-linecap="round"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.8" y="3.8" width="7" height="7" rx="2.1" stroke="rgba(70,74,80,0.82)" stroke-width="1.15"/><rect x="13.2" y="3.8" width="7" height="7" rx="2.1" stroke="rgba(70,74,80,0.82)" stroke-width="1.15"/><rect x="3.8" y="13.2" width="7" height="7" rx="2.1" stroke="rgba(70,74,80,0.82)" stroke-width="1.15"/><rect x="13.2" y="13.2" width="7" height="7" rx="2.1" stroke="rgba(70,74,80,0.82)" stroke-width="1.15"/><circle cx="7.3" cy="7.3" r="1.05" stroke="rgba(130,136,145,0.65)" stroke-width="1"/><path d="M15.4 6.2h2.6M16.7 5v2.5" stroke="rgba(130,136,145,0.65)" stroke-width="1" stroke-linecap="round"/><path d="M5.6 15.8h3.4M5.6 17.4h2.2" stroke="rgba(130,136,145,0.65)" stroke-width="1" stroke-linecap="round"/><circle cx="15.5" cy="15.5" r="0.7" fill="rgba(130,136,145,0.65)"/><circle cx="17.7" cy="15.5" r="0.7" fill="rgba(130,136,145,0.55)"/><circle cx="15.5" cy="17.7" r="0.7" fill="rgba(130,136,145,0.55)"/><circle cx="17.7" cy="17.7" r="0.7" fill="rgba(130,136,145,0.45)"/></svg>',
    theater: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="6" width="17" height="12" rx="2" stroke="rgba(70,74,80,0.82)" stroke-width="1.2"/><path d="M3.5 9.5h17" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/><path d="M10.2 12.2l4.2 2.4-4.2 2.4v-4.8z" fill="rgba(130,136,145,0.65)"/></svg>'
  };

  var SVG_ENT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 4H7C4.24 4 2 6.24 2 9v7.88a3.124 3.124 0 0 0 5.33 2.21l1.96-1.96c.71-.71 1.7-1.12 2.71-1.12s1.99.41 2.71 1.12l1.96 1.96A3.124 3.124 0 0 0 22 16.88V9c0-2.76-2.24-5-5-5M7 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m9.5-5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1m-2 4c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m2 2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m2-2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"></path></svg>';

  var SVG_ALT = {
    music: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11h12v2H3zm0-5h12v2H3zm0 10h9v2H3zm14-9v8.05a2.5 2.5 0 1 0-.5 4.95 2.5 2.5 0 0 0 2.5-2.5V8h2V6h-3c-.55 0-1 .45-1 1"></path></svg>',
    memo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.93 3.07c-1.27-1.27-3.42-1.42-6.06-.4-.94.36-1.9.86-2.87 1.46-.97-.61-1.93-1.1-2.87-1.46-2.63-1.01-4.79-.87-6.06.4C1.28 4.86 1.8 8.31 4.12 12c-2.32 3.69-2.84 7.14-1.05 8.93.71.71 1.7 1.07 2.89 1.07.94 0 2.01-.22 3.17-.67.94-.36 1.9-.86 2.87-1.46.97.61 1.93 1.1 2.87 1.46 1.16.45 2.23.67 3.17.67 1.19 0 2.18-.36 2.89-1.07 1.79-1.79 1.27-5.24-1.05-8.93 2.32-3.69 2.84-7.14 1.05-8.93M4.48 4.48C4.8 4.16 5.31 4 5.97 4c.68 0 1.52.18 2.44.53.58.22 1.18.51 1.79.85-.87.67-1.74 1.43-2.56 2.25-.84.84-1.58 1.69-2.25 2.55-1.45-2.6-1.79-4.82-.91-5.7M12 6.54c1 .72 2 1.56 2.95 2.51.97.97 1.8 1.97 2.5 2.95-.7.98-1.53 1.97-2.5 2.95C14 15.9 13 16.74 12 17.46c-1-.72-2-1.56-2.95-2.51-.97-.97-1.8-1.97-2.5-2.95.7-.98 1.53-1.97 2.5-2.95C10 8.1 11 7.26 12 6.54M8.41 19.46c-1.8.69-3.27.71-3.93.05-.88-.88-.54-3.1.91-5.7.66.85 1.41 1.71 2.25 2.55a25 25 0 0 0 2.56 2.25c-.61.34-1.2.63-1.79.85m11.1.05c-.66.66-2.13.64-3.93-.05-.58-.22-1.18-.51-1.79-.85.87-.67 1.74-1.43 2.56-2.25.84-.84 1.58-1.69 2.25-2.55 1.45 2.6 1.79 4.82.91 5.7m-.91-9.33c-.66-.85-1.41-1.71-2.25-2.55a25 25 0 0 0-2.56-2.25c.61-.34 1.2-.63 1.79-.85.92-.35 1.76-.53 2.44-.53s1.16.16 1.49.48c.88.88.54 3.1-.91 5.7"></path><path d="M13.77 13.77c.98-.98.98-2.56 0-3.54s-2.56-.98-3.54 0-.98 2.56 0 3.54 2.56.98 3.54 0"></path></svg>',
    set: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m21.16 7.86-1-1.73a1.997 1.997 0 0 0-2.73-.73l-.53.31c-.58-.46-1.22-.83-1.9-1.11V4c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v.6c-.67.28-1.31.66-1.9 1.11l-.53-.31c-.96-.55-2.18-.22-2.73.73l-1 1.73c-.55.96-.22 2.18.73 2.73l.5.29c-.05.37-.08.74-.08 1.11s.03.74.08 1.11l-.5.29c-.96.55-1.28 1.78-.73 2.73l1 1.73c.55.95 1.78 1.28 2.73.73l.53-.31c.58.46 1.22.83 1.9 1.11v.6c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-.6a8.7 8.7 0 0 0 1.9-1.11l.53.31c.96.55 2.18.22 2.73-.73l1-1.73c.55-.96.22-2.18-.73-2.73l-.5-.29c.05-.37.08-.74.08-1.11s-.03-.74-.08-1.11l.5-.29c.96-.55 1.28-1.78.73-2.73M12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4"></path></svg>',
    book: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H6C4.35 2 3 3.35 3 5v14c0 1.65 1.35 3 3 3h15v-2H6c-.55 0-1-.45-1-1s.45-1 1-1h14c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1m-3 6H8V6h9z"></path></svg>',
    memory: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 22h12c1.1 0 2-.9 2-2V6c0-.27-.11-.52-.29-.71l-3-3A1 1 0 0 0 16 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2m7-17h2v4h-2zm-3 0h2v4h-2zM7 5h2v4H7z"></path></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h3v2c0 .36.19.69.51.87.15.09.32.13.49.13s.36-.05.51-.14L13.27 19h6.72c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm-4.65 8.21L12 14.5l-3.35-3.29-.06-.06c-.82-.85-.79-2.2.06-3.01.87-.86 2.26-.86 3.12 0l.22.22.22-.22c.87-.86 2.26-.86 3.12 0l.06.06c.82.85.79 2.2-.06 3.01Z"></path></svg>',
    board: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.93 3.07c-1.27-1.27-3.42-1.42-6.06-.4-.94.36-1.9.86-2.87 1.46-.97-.61-1.93-1.1-2.87-1.46-2.63-1.01-4.79-.87-6.06.4C1.28 4.86 1.8 8.31 4.12 12c-2.32 3.69-2.84 7.14-1.05 8.93.71.71 1.7 1.07 2.89 1.07.94 0 2.01-.22 3.17-.67.94-.36 1.9-.86 2.87-1.46.97.61 1.93 1.1 2.87 1.46 1.16.45 2.23.67 3.17.67 1.19 0 2.18-.36 2.89-1.07 1.79-1.79 1.27-5.24-1.05-8.93 2.32-3.69 2.84-7.14 1.05-8.93M4.48 4.48C4.8 4.16 5.31 4 5.97 4c.68 0 1.52.18 2.44.53.58.22 1.18.51 1.79.85-.87.67-1.74 1.43-2.56 2.25-.84.84-1.58 1.69-2.25 2.55-1.45-2.6-1.79-4.82-.91-5.7M12 6.54c1 .72 2 1.56 2.95 2.51.97.97 1.8 1.97 2.5 2.95-.7.98-1.53 1.97-2.5 2.95C14 15.9 13 16.74 12 17.46c-1-.72-2-1.56-2.95-2.51-.97-.97-1.8-1.97-2.5-2.95.7-.98 1.53-1.97 2.5-2.95C10 8.1 11 7.26 12 6.54M8.41 19.46c-1.8.69-3.27.71-3.93.05-.88-.88-.54-3.1.91-5.7.66.85 1.41 1.71 2.25 2.55a25 25 0 0 0 2.56 2.25c-.61.34-1.2.63-1.79.85m11.1.05c-.66.66-2.13.64-3.93-.05-.58-.22-1.18-.51-1.79-.85.87-.67 1.74-1.43 2.56-2.25.84-.84 1.58-1.69 2.25-2.55 1.45 2.6 1.79 4.82.91 5.7m-.91-9.33c-.66-.85-1.41-1.71-2.25-2.55a25 25 0 0 0-2.56-2.25c.61-.34 1.2-.63 1.79-.85.92-.35 1.76-.53 2.44-.53s1.16.16 1.49.48c.88.88.54 3.1-.91 5.7"></path><path d="M13.77 13.77c.98-.98.98-2.56 0-3.54s-2.56-.98-3.54 0-.98 2.56 0 3.54 2.56.98 3.54 0"></path></svg>',
    play: SVG_ENT,
    beauty: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.41 10.41a.998.998 0 0 0 0-1.82l-4.15-1.84-1.84-4.15a.99.99 0 0 0-.91-.59c-.39 0-.74.23-.91.58L6.75 6.6 2.57 8.61c-.35.17-.57.53-.57.92s.24.74.59.9l4.15 1.84 1.84 4.15a.998.998 0 0 0 1.82 0l1.84-4.15 4.15-1.84Zm5.19 5.98-2.77-1.23-1.23-2.77a.68.68 0 0 0-.6-.4c-.27-.02-.5.15-.61.39l-1.23 2.67-2.78 1.34c-.23.11-.38.35-.38.61s.16.49.4.6l2.77 1.23 1.23 2.77a.663.663 0 0 0 1.22 0l1.23-2.77 2.77-1.23c.24-.11.4-.35.4-.61s-.16-.5-.4-.61ZM7.76 18.63l-1.66-.74-.74-1.66a.41.41 0 0 0-.36-.24c-.16-.01-.3.09-.37.23l-.74 1.6-1.67.8c-.14.07-.23.21-.23.37s.1.3.24.36l1.66.74.74 1.66a.404.404 0 0 0 .74 0l.74-1.66 1.66-.74a.404.404 0 0 0 0-.74Z"></path></svg>',
    store: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m20.2 4.02-10-2c-.29-.06-.6.02-.83.21S9 2.7 9 3v1H4c-.55 0-1 .45-1 1v14c0 .55.45 1 1 1h5v1c0 .3.13.58.37.77.18.15.4.23.63.23.07 0 .13 0 .2-.02l10-2c.47-.09.8-.5.8-.98V5c0-.48-.34-.89-.8-.98M5 18V6h4v12zm8-5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"></path></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v4c0 1.01.39 1.91 1 2.62V20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-9.38c.61-.7 1-1.61 1-2.62V4c0-1.1-.9-2-2-2M8 8c0 1.1-.9 2-2 2s-2-.9-2-2V4h4zm2-4h4v4c0 1.1-.9 2-2 2s-2-.9-2-2zm5 16H9v-5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1zm5-12c0 1.1-.9 2-2 2s-2-.9-2-2V4h4z"></path></svg>',
    world: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H6C4.35 2 3 3.35 3 5v14c0 1.65 1.35 3 3 3h15v-2H6c-.55 0-1-.45-1-1s.45-1 1-1h14c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1m-3 6H8V6h9z"></path></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 2H5c-.55 0-1 .45-1 1v4H2v2h2v2H2v2h2v2H2v2h2v4c0 .55.45 1 1 1h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-6.5 5C13.93 7 15 8.07 15 9.5S13.93 12 12.5 12 10 10.93 10 9.5 11.07 7 12.5 7M17 17H8v-1c0-1.66 1.34-3 3-3h3c1.66 0 3 1.34 3 3z"></path></svg>',
    contacts: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 2H5c-.55 0-1 .45-1 1v4H2v2h2v2H2v2h2v2H2v2h2v4c0 .55.45 1 1 1h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-6.5 5C13.93 7 15 8.07 15 9.5S13.93 12 12.5 12 10 10.93 10 9.5 11.07 7 12.5 7M17 17H8v-1c0-1.66 1.34-3 3-3h3c1.66 0 3 1.34 3 3z"></path></svg>',
    pet: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3h-7c-.77 0-1.47.3-2 .78-.53-.48-1.23-.78-2-.78H3c-.55 0-1 .45-1 1v15c0 .55.45 1 1 1h5.76c.53 0 1.04.21 1.41.59l1.12 1.12s.02.01.03.02c.09.08.18.15.29.2.12.05.25.08.38.08s.26-.03.38-.08c.11-.05.21-.12.29-.2 0 0 .02-.01.03-.02l1.12-1.12c.37-.37.89-.59 1.41-.59h5.76c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1Zm-1 15h-4.76c-.8 0-1.58.25-2.24.69V6c0-.55.45-1 1-1h6z"></path></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m22 2-2 2h-6l-2-2v7c0 2.76 2.24 5 5 5s5-2.24 5-5V4h-.01V2Zm-7 7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m4 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"></path><path d="M11.09 10H5.5C4.67 10 4 9.33 4 8.5S4.67 7 5.5 7C7.06 7 10 6.16 10 3V2H8v1c0 1.88-2.09 2-2.5 2C3.57 5 2 6.57 2 8.5c0 1.42.85 2.63 2.06 3.18L5 21.1a1 1 0 0 0 1 .9h3c.55 0 1-.45 1-1v-3h4v3c0 .55.45 1 1 1h3c.51 0 .94-.38.99-.89l.75-6.78c-.82.43-1.76.67-2.75.67-2.97 0-5.43-2.17-5.91-5Z"></path></svg>',
    couple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4m14.5 5h-.7c-.84 0-1.61.42-2.08 1.11L13.46 16h-2.93l-3.26-4.89C6.81 10.41 6.03 10 5.19 10h-.7a2.5 2.5 0 0 0-2.5 2.5V18h5v-3.7l1.87 2.81c.37.56.99.89 1.66.89h2.93c.67 0 1.29-.33 1.66-.89l1.87-2.81V18h5v-5.5a2.5 2.5 0 0 0-2.5-2.5ZM19 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4"></path><path d="M14.51 10.17c.65-.67.65-1.74 0-2.41-.66-.67-1.69-.67-2.34 0l-.17.17-.17-.17c-.65-.67-1.69-.67-2.34 0-.65.68-.65 1.74 0 2.41L12 12.75z"></path></svg>',
    itinerary: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.17 5.11A2 2 0 0 0 17.38 4H4c-1.1 0-2 .9-2 2v9c0 1.1.9 2 2 2 0 1.65 1.35 3 3 3s3-1.35 3-3h4c0 1.65 1.35 3 3 3s3-1.35 3-3c1.1 0 2-.9 2-2v-3.76c0-.31-.07-.62-.21-.89zM17.38 6l.89.45L20 10h-4.13V6zm-4.13 0v4h-3.5V6zm-5.5 0v4H4V6zM7 18a1.003 1.003 0 0 1-.87-1.5c.36-.62 1.33-.63 1.72-.02A.95.95 0 0 1 8 17c0 .55-.45 1-1 1m10 0a1.003 1.003 0 0 1-.87-1.5c.36-.62 1.33-.63 1.72-.02A.95.95 0 0 1 18 17c0 .55-.45 1-1 1"></path></svg>',
    cstore: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v4c0 1.01.39 1.91 1 2.62V20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-9.38c.61-.7 1-1.61 1-2.62V4c0-1.1-.9-2-2-2M8 8c0 1.1-.9 2-2 2s-2-.9-2-2V4h4zm2-4h4v4c0 1.1-.9 2-2 2s-2-.9-2-2zm5 16H9v-5c0-.55.45-1 1-1h4c.55 0 1 .45 1 1zm5-12c0 1.1-.9 2-2 2s-2-.9-2-2V4h4z"></path></svg>',
    rift: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.22 3s-5 0-7.22 7.82C9.78 3 4.78 3 4.78 3 3.25 3 2 4.25 2 5.79v4.47c0 2.81 1.88 5.17 4.44 5.91-.67.61-1.1 1.49-1.1 2.48C5.34 20.5 6.83 22 8.67 22S12 19 12 16c0 3 1.49 6 3.33 6s3.33-1.5 3.33-3.35c0-.98-.43-1.86-1.1-2.48 2.56-.73 4.44-3.1 4.44-5.91V5.79C22 4.25 20.76 3 19.22 3"></path></svg>',
    deep: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 22h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2M7 4h10v16H7z"></path><path d="M9 8a1 1 0 1 0 0 2 1 1 0 1 0 0-2m2.32-1.57a1 1 0 1 0 0 2 1 1 0 1 0 0-2M9 5a1 1 0 1 0 0 2 1 1 0 1 0 0-2"></path></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 21c.08 0 .16 0 .24-.03l4-1c.18-.04.34-.13.46-.26L20.99 7.42c.78-.78.78-2.05 0-2.83L19.4 3c-.78-.78-2.05-.78-2.83 0l-2.09 2.09-1.79-1.79a.996.996 0 0 0-1.41 0l-6 6 1.41 1.41 5.29-5.29 1.09 1.09-8.78 8.78c-.13.13-.22.29-.26.46l-1 4c-.09.34.01.7.26.95.19.19.45.29.71.29ZM18 4.41l1.59 1.58-2.09 2.09-1.59-1.59L18 4.4Z"></path></svg>',
    match: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 11h-11a2.5 2.5 0 0 1 0-5H10v2l4-3-4-3v2H6.5C4.02 4 2 6.02 2 8.5S4.02 13 6.5 13h11a2.5 2.5 0 0 1 0 5H7.82A2.99 2.99 0 0 0 5 16c-1.65 0-3 1.35-3 3s1.35 3 3 3c1.3 0 2.4-.84 2.82-2h9.68c2.48 0 4.5-2.02 4.5-4.5S19.98 11 17.5 11M19 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6"></path></svg>',
    fun: SVG_ENT,
    echo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4m-1.5 5 .12 1.63.08 1.23.15 2.05.15 2.04V22h2v-.05l.15-2.04.15-2.05.08-1.23.12-1.63z"></path><path d="M12 2C6.49 2 2 6.49 2 12c0 4.45 2.93 8.23 6.96 9.52l-.16-2.2C5.98 18.08 4 15.27 4 11.99c0-4.41 3.59-8 8-8s8 3.59 8 8c0 3.27-1.98 6.09-4.8 7.33l-.16 2.2C19.07 20.23 22 16.45 22 12c0-5.51-4.49-10-10-10"></path><path d="m15.6 13.72-.1 1.42-.13 1.82A6 6 0 0 0 18.01 12c0-3.31-2.69-6-6-6s-6 2.69-6 6c0 2.06 1.05 3.88 2.64 4.96l-.13-1.82-.1-1.42c-.25-.52-.4-1.1-.4-1.72 0-2.21 1.79-4 4-4s4 1.79 4 4c0 .62-.15 1.2-.4 1.72Z"></path></svg>',
    log: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-2V2h-2v2H9V2H7v2H5c-1.1 0-2 .9-2 2v1h18V6c0-1.1-.9-2-2-2M3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8H3zm4-8h10v2H7zm0 4h7v2H7z"></path></svg>',
    weather: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-2.97 0-5.43 2.17-5.91 5H2v2h20v-2h-4.09c-.48-2.83-2.94-5-5.91-5m0 2c1.86 0 3.41 1.28 3.86 3H8.14c.45-1.72 2-3 3.86-3m-1-7h2v3h-2zm6.71 5.71 1-1 1-1L19 5l-.71-.71-1 1-1 1L17 7zm-11.42 0L7 7l.71-.71-1-1-1-1L5 5l-.71.71 1 1zM9 16h11v2H9zm-5 0h3v2H4zm2 4h10v2H6z"></path></svg>',
    map: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 8.44c-.02 5.1 5.17 9.18 5.39 9.35.18.14.4.21.61.21s.43-.07.61-.21c.22-.17 5.41-4.25 5.39-9.35C18 4.89 15.31 2 12 2S6 4.89 6 8.44m10 0c.01 3.19-2.74 6.08-4 7.24-1.26-1.15-4.01-4.04-4-7.24C8 5.99 9.79 4 12 4s4 1.99 4 4.44"></path><path d="M12 6a2 2 0 1 0 0 4 2 2 0 1 0 0-4m6.02 8.73c-.4.64-.84 1.23-1.27 1.76C18.88 16.97 20 17.68 20 18c0 .51-2.75 2-8 2s-8-1.49-8-2c0-.32 1.12-1.03 3.25-1.51-.43-.53-.86-1.12-1.27-1.76C3.66 15.37 2 16.44 2 18c0 2.75 5.18 4 10 4s10-1.25 10-4c0-1.56-1.67-2.63-3.98-3.27"></path></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 10c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4v2h-4V6c0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4h2v4H6c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4v-2h4v2c0 2.21 1.79 4 4 4s4-1.79 4-4-1.79-4-4-4h-2v-4zm-2-4c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2h-2zM8 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2h2zM8 8H6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2zm6 6h-4v-4h4zm4 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2v-2z"></path></svg>',
    theater: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 7.5C22 4.47 19.53 2 16.5 2c-1.86 0-3.5.93-4.5 2.35C11 2.93 9.36 2 7.5 2A5.51 5.51 0 0 0 2 7.5c0 1.86.93 3.5 2.35 4.5C2.93 13 2 14.64 2 16.5 2 19.53 4.47 22 7.5 22c1.86 0 3.5-.93 4.5-2.35 1 1.42 2.64 2.35 4.5 2.35 3.03 0 5.5-2.47 5.5-5.5 0-1.86-.93-3.5-2.35-4.5C21.07 11 22 9.36 22 7.5M15 12v.02c-.02 1.66-1.32 2.96-3.02 2.98-1.65-.01-2.96-1.32-2.98-3.02.02-1.66 1.32-2.96 3.02-2.98 1.65.01 2.96 1.32 2.98 2.98zM7.5 4c1.8 0 3.28 1.36 3.48 3.1h-.01c-.01 0-.03 0-.04.01-.28.06-.55.15-.81.25l-.21.09a5.4 5.4 0 0 0-.77.44c-.5.35-.94.79-1.28 1.3 0 0 0 .01-.01.02-.35.53-.61 1.12-.74 1.76-1.74-.2-3.1-1.68-3.1-3.48 0-1.93 1.57-3.5 3.5-3.5Zm0 16C5.57 20 4 18.43 4 16.5c0-1.8 1.36-3.28 3.1-3.48v.01c0 .02.01.03.01.05.06.28.15.54.25.8.03.07.06.14.1.21.1.21.21.42.34.61a4.95 4.95 0 0 0 1.4 1.43s.01 0 .02.01c.53.35 1.11.61 1.76.74-.2 1.74-1.68 3.1-3.48 3.1Zm9 0c-1.8 0-3.28-1.36-3.48-3.1h.01c.02 0 .03 0 .05-.01.28-.06.54-.15.8-.25.08-.03.16-.07.23-.11.2-.09.38-.19.56-.31.07-.04.14-.08.21-.13.47-.33.88-.74 1.21-1.21.04-.06.08-.13.12-.19.12-.19.23-.39.32-.59.03-.07.07-.14.09-.21.11-.28.21-.56.27-.86 1.74.2 3.1 1.68 3.1 3.48 0 1.93-1.57 3.5-3.5 3.5Zm.4-9.02v-.01c0-.02-.01-.03-.01-.05-.06-.28-.15-.54-.25-.8-.03-.07-.06-.14-.1-.21-.1-.21-.21-.42-.34-.61a4.95 4.95 0 0 0-1.4-1.43s-.01 0-.02-.01a4.9 4.9 0 0 0-1.76-.74c.2-1.74 1.68-3.1 3.48-3.1 1.93 0 3.5 1.57 3.5 3.5 0 1.8-1.36 3.28-3.1 3.48Z"></path></svg>'
  };

  var SVG = SVG_CLASSIC;

  var NAMES = {
    music: '音乐', memo: '论坛', set: '设置', book: '世界书',
    memory: '记忆', chat: '聊天', board: '论坛', play: '游戏',
    beauty: '美化', store: '线下', photo: '多相', world: '世界',
    phone: '电话', contacts: '联系人', pet: '打字机', pen: '模拟器',
    deep: '深入', notes: '日记', match: '赛事', fun: '娱乐', echo: '共鸣', log: '记录',
    couple: '情侣空间', itinerary: '行程轨迹', cstore: '74号便利店', rift: '错位时空',
    weather: '天气', map: '地图', apps: '应用', theater: '剧场'
  };

  var WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function tick() {
    var clock = document.getElementById('hero-clock');
    var meta = document.getElementById('hero-meta');
    if (!clock || !meta) return;
    var d = new Date();
    var t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    clock.textContent = t;
    meta.textContent =
      (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WD[d.getDay()] + ' · 多云 19°C';
  }

  if (document.getElementById('hero-clock')) {
    tick();
    setInterval(tick, 10000);
  }

  document.querySelectorAll('[data-i]').forEach(function (el) {
    var k = el.getAttribute('data-i');
    if (SVG[k]) el.innerHTML = SVG[k];
  });

  function getActiveAppSvgPack() {
    return document.documentElement.classList.contains('miya-alt-app-icons')
      ? Object.assign({}, SVG_CLASSIC, SVG_ALT)
      : SVG_CLASSIC;
  }

  function fillAppIcons(root) {
    var pack = getActiveAppSvgPack();
    var scope = root || document;
    scope.querySelectorAll('[data-i]').forEach(function (el) {
      var k = el.getAttribute('data-i');
      if (pack[k]) el.innerHTML = pack[k];
    });
    window.miyaAppSvg = pack;
  }

  function syncAppIconStyle(on) {
    document.documentElement.classList.toggle('miya-alt-app-icons', !!on);
    fillAppIcons();
  }

  window.miyaFillAppIcons = fillAppIcons;
  window.miyaSyncAppIconStyle = syncAppIconStyle;
  window.miyaAppSvgClassic = SVG_CLASSIC;
  window.miyaAppSvgAlt = SVG_ALT;
  window.miyaAppSvg = SVG_CLASSIC;

  document.addEventListener('visibilitychange', function () {
    document.documentElement.classList.toggle('miya-tab-hidden', document.hidden);
  });

  (function initP2Meta() {
    var el = document.getElementById('p2-log-date');
    if (!el) return;
    function sync() {
      var d = new Date();
      el.textContent = pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    }
    sync();
    setInterval(sync, 60000);
  })();

  (function initLedgerWidget() {
    var dayEl = document.getElementById('ledger-day');
    var monEl = document.getElementById('ledger-mon');
    var dowEl = document.getElementById('ledger-dow');
    var serialEl = document.getElementById('ledger-serial');
    var rowD1 = document.getElementById('ledger-row-d1');
    if (!dayEl) return;

    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    function sync() {
      var d = new Date();
      dayEl.textContent = pad(d.getDate());
      if (monEl) monEl.textContent = MON[d.getMonth()];
      if (dowEl) dowEl.textContent = WD[d.getDay()];
      if (serialEl) {
        serialEl.textContent = '№ ' + d.getFullYear() + '·' + pad(d.getMonth() + 1);
      }
      if (rowD1) rowD1.textContent = pad(d.getDate());
    }

    sync();
    setInterval(sync, 60000);
  })();

  (function initP2Scrapbook() {
    var dayEl = document.getElementById('p2f-date-day');
    var metaEl = document.getElementById('p2f-date-meta');
    var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    function syncDate() {
      var now = new Date();
      if (dayEl) dayEl.textContent = String(now.getDate()).padStart(2, '0');
      if (metaEl) metaEl.textContent = MON[now.getMonth()] + ' · ' + DOW[now.getDay()];
    }

    syncDate();
    setInterval(syncDate, 60000);

    document.querySelectorAll('[data-p2f-flip]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-miya-copy]')) return;
        card.classList.toggle('is-flipped');
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.classList.toggle('is-flipped');
        }
      });
    });

    var viewport = document.getElementById('p2f-reel-viewport');
    var track = document.getElementById('p2f-reel-track');
    if (!viewport || !track) return;

    var frameCount = 4;
    var index = 0;
    var startX = 0;
    var dragX = 0;
    var pressing = false;

    function frameWidth() {
      return viewport.clientWidth / 3 || 1;
    }

    function paint(dx) {
      var w = frameWidth();
      var x = -(index * w) + dx;
      track.style.transform = 'translate3d(' + x + 'px,0,0)';
    }

    function snap() {
      track.classList.remove('is-dragging');
      paint(0);
    }

    function onDown(clientX) {
      pressing = true;
      startX = clientX;
      dragX = 0;
      track.classList.add('is-dragging');
    }

    function onMove(clientX) {
      if (!pressing) return;
      dragX = clientX - startX;
      paint(dragX);
    }

    function onUp() {
      if (!pressing) return;
      pressing = false;
      var threshold = frameWidth() * 0.22;
      if (dragX < -threshold && index < frameCount - 3) index += 1;
      else if (dragX > threshold && index > 0) index -= 1;
      snap();
    }

    viewport.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) onDown(e.touches[0].clientX);
    }, { passive: true });

    viewport.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) onMove(e.touches[0].clientX);
    }, { passive: true });

    viewport.addEventListener('touchend', onUp);
    viewport.addEventListener('touchcancel', onUp);

    viewport.addEventListener('mousedown', function (e) {
      onDown(e.clientX);
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (pressing) onMove(e.clientX);
    });

    window.addEventListener('mouseup', onUp);
  })();

  (function initDeskPager() {
    var viewport = document.getElementById('desk-viewport');
    var track = document.getElementById('desk-track');
    var pager = document.getElementById('desk-pager');
    if (!viewport || !track) return;

    var PAGE_COUNT = 4;
    var page = 0;
    var scrollRaf = 0;

    function pageWidth() {
      return track.clientWidth || 1;
    }

    function updateUI(n) {
      page = Math.max(0, Math.min(PAGE_COUNT - 1, n));
      viewport.setAttribute('data-desk-page', String(page));
      var dots = document.querySelectorAll('.desk-pager__dot');
      dots.forEach(function (dot, i) {
        var on = i === page;
        dot.classList.toggle('is-active', on);
        dot.setAttribute('aria-current', on ? 'page' : 'false');
      });
    }

    function setPage(n, behavior) {
      var target = Math.max(0, Math.min(PAGE_COUNT - 1, n));
      updateUI(target);
      if (behavior === 'auto') track.classList.add('is-programmatic');
      track.scrollTo({ left: target * pageWidth(), behavior: behavior || 'smooth' });
      if (behavior === 'auto') {
        requestAnimationFrame(function () {
          track.classList.remove('is-programmatic');
        });
      }
    }

    function onScroll() {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(function () {
        scrollRaf = 0;
        var i = Math.round(track.scrollLeft / pageWidth());
        if (i !== page) updateUI(i);
      });
    }

    if (!track._deskScrollBound) {
      track._deskScrollBound = true;
      track.addEventListener('scroll', onScroll, { passive: true });
    }

    if (pager && !pager._deskPagerBound) {
      pager._deskPagerBound = true;
      pager.addEventListener('click', function (e) {
        var dot = e.target.closest('[data-desk-page]');
        if (!dot) return;
        setPage(parseInt(dot.getAttribute('data-desk-page'), 10) || 0, 'smooth');
      });
    }

    window.addEventListener('resize', function () {
      track.scrollTo({ left: page * pageWidth(), behavior: 'auto' });
    });

    updateUI(0);
    track.scrollTo({ left: 0, behavior: 'auto' });
    if (window.miyaBindScrollBlur) {
      window.miyaBindScrollBlur(track, { idleMs: 120 });
    }
  })();

  var APP_HANDLERS = {
    music: function () {
      if (window.miyaMusicApp && window.miyaMusicApp.open) window.miyaMusicApp.open();
    },
    set: function () {
      if (window.miyaSettingsApp && window.miyaSettingsApp.open) window.miyaSettingsApp.open();
    },
    beauty: function () {
      if (window.miyaBeautifyApp && window.miyaBeautifyApp.open) window.miyaBeautifyApp.open();
    },
    book: function () {
      if (window.miyaWorldbookApp && window.miyaWorldbookApp.open) window.miyaWorldbookApp.open();
    },
    chat: function () {
      if (window.miyaChatApp && window.miyaChatApp.open) window.miyaChatApp.open();
    },
    contacts: function () {
      if (window.miyaContactsApp && window.miyaContactsApp.open) window.miyaContactsApp.open();
    },
    memory: function () {
      if (window.miyaMemoryApp && window.miyaMemoryApp.open) window.miyaMemoryApp.open();
    },
    store: function () {
      if (window.miyaOfflineApp && window.miyaOfflineApp.open) window.miyaOfflineApp.open();
    },
    pen: function () {
      if (window.miyaModeSwitch && window.miyaModeSwitch.setMode) {
        window.miyaModeSwitch.setMode('sim');
      }
    },
    pet: function () {
      if (window.miyaTypewriterApp && window.miyaTypewriterApp.open) window.miyaTypewriterApp.open();
    },
    memo: function () {
      if (window.miyaForumApp && window.miyaForumApp.open) window.miyaForumApp.open();
    },
    cstore: function () {
      if (window.miyaCstoreApp && window.miyaCstoreApp.open) window.miyaCstoreApp.open();
    },
    itinerary: function () {
      if (window.miyaItineraryApp && window.miyaItineraryApp.open) window.miyaItineraryApp.open();
    },
    weather: function () {
      if (window.miyaWeatherApp && window.miyaWeatherApp.open) window.miyaWeatherApp.open();
    },
    couple: function () {
      if (window.miyaCoupleApp && window.miyaCoupleApp.open) window.miyaCoupleApp.open();
    },
    notes: function () {
      if (window.miyaDiaryApp && window.miyaDiaryApp.open) window.miyaDiaryApp.open();
    },
    theater: function () {
      if (window.miyaTheaterApp && window.miyaTheaterApp.open) window.miyaTheaterApp.open();
    },
    match: function () {
      if (window.miyaMatchApp && window.miyaMatchApp.open) window.miyaMatchApp.open();
    },
    fun: function () {
      if (window.miyaFunApp && window.miyaFunApp.open) window.miyaFunApp.open();
    },
    deep: function () {
      if (window.miyaDeepApp && window.miyaDeepApp.open) window.miyaDeepApp.open();
    }
  };

  /* 安卓：打开全屏应用后，同一次触摸的 ghost click 会落到新页面按钮上（如设置→运转规则） */
  var OPEN_CLICK_GUARD_MS = 420;

  function armOpenClickGuard(root) {
    if (!root || !root.appendChild) return;
    var shield = null;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains('miya-open-click-guard')) {
        shield = kids[i];
        break;
      }
    }
    if (!shield) {
      shield = document.createElement('div');
      shield.className = 'miya-open-click-guard';
      shield.setAttribute('aria-hidden', 'true');
      root.appendChild(shield);
    }
    shield.hidden = false;
    root.classList.add('is-open-guard');
    if (root._miyaOpenGuardTimer) clearTimeout(root._miyaOpenGuardTimer);
    root._miyaOpenGuardTimer = setTimeout(function () {
      shield.hidden = true;
      root.classList.remove('is-open-guard');
      root._miyaOpenGuardTimer = 0;
    }, OPEN_CLICK_GUARD_MS);
  }

  window.miyaArmOpenClickGuard = armOpenClickGuard;

  function launchApp(id) {
    if (!id) return false;
    if (APP_HANDLERS[id]) {
      var run = function () {
        APP_HANDLERS[id]();
      };
      if (window.miyaLazyEnsureApp) {
        window.miyaLazyEnsureApp(id).then(run).catch(run);
      } else {
        run();
      }
      return true;
    }
    if (id === 'pen' && window.miyaModeSwitch) {
      if (window.miyaLazyEnsureApp) {
        window.miyaLazyEnsureApp('pen').then(function () {
          window.miyaModeSwitch.setMode('sim');
        }).catch(function () {
          window.miyaModeSwitch.setMode('sim');
        });
      } else {
        window.miyaModeSwitch.setMode('sim');
      }
      return true;
    }
    var modal = document.getElementById('modal');
    if (!modal) return false;
    document.getElementById('modal-icon').innerHTML = SVG[id] || '';
    document.getElementById('modal-title').textContent = NAMES[id] || id;
    modal.hidden = false;
    return true;
  }

  window.miyaLaunchApp = launchApp;

  var phoneLayer = document.getElementById('miya-phone-layer');
  if (phoneLayer) {
    phoneLayer.addEventListener('click', function (e) {
    if (window.miyaCustomDragDidConsume && window.miyaCustomDragDidConsume()) return;
    if (window.miyaCustomEditModeActive && window.miyaCustomEditModeActive()) return;
    var btn = e.target.closest('[data-app]');
    if (!btn) return;
    launchApp(btn.getAttribute('data-app'));
  });
  }

  function runPhoneBoot() {
    if (typeof window.miyaHydrateTheme === 'function') {
      window.miyaHydrateTheme().then(function () {
        var theme = window.miyaGetTheme && window.miyaGetTheme();
        var afterEntry = function () {
          document.documentElement.classList.remove('miya-splash-pending');
          if (window.miyaLockscreen && window.miyaLockscreen.showIfNeeded) {
            window.miyaLockscreen.showIfNeeded();
          }
          if (window.miyaUpdateNotice && window.miyaUpdateNotice.onEntryStep) {
            window.miyaUpdateNotice.onEntryStep('splash');
          }
        };
        if (window.miyaLockscreen && window.miyaLockscreen.showIfNeeded) {
          window.miyaLockscreen.showIfNeeded();
        }
        if (theme && theme.splashEnabled !== false && window.miyaSplash && window.miyaSplash.play) {
          window.miyaSplash.play().then(afterEntry);
        } else {
          afterEntry();
        }
      }).catch(function () {
        document.documentElement.classList.remove('miya-splash-pending');
        if (typeof window.miyaInitHomeCopyEdit === 'function') window.miyaInitHomeCopyEdit();
        if (window.miyaLockscreen && window.miyaLockscreen.showIfNeeded) {
          window.miyaLockscreen.showIfNeeded();
        }
        if (window.miyaUpdateNotice && window.miyaUpdateNotice.onEntryStep) {
          window.miyaUpdateNotice.onEntryStep('splash');
        }
      });
    } else if (typeof window.miyaInitHomeCopyEdit === 'function') {
      window.miyaInitHomeCopyEdit();
      if (window.miyaUpdateNotice && window.miyaUpdateNotice.onEntryStep) {
        window.miyaUpdateNotice.onEntryStep('splash');
      }
    }
  }

  if (window.miyaAuth && typeof window.miyaAuth.whenReady === 'function') {
    window.miyaAuth.whenReady().then(runPhoneBoot);
  } else {
    runPhoneBoot();
  }

  document.getElementById('modal-close').addEventListener('click', function () {
    document.getElementById('modal').hidden = true;
  });
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target.id === 'modal') document.getElementById('modal').hidden = true;
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js?v=52').then(function (reg) {
        try { reg.update(); } catch (e) {}
      }).catch(function () {});
    });
  }

  if (window.miyaModeSwitch && window.miyaModeSwitch.init) {
    window.miyaModeSwitch.init();
  }

  /* 程序坞 · 点击空白隐藏 / 点击底部显示 */
  (function initDockToggle() {
    var foot = document.querySelector('.foot');
    var dock = document.querySelector('.foot__dock');
    var dismiss = document.querySelector('.foot__dock-dismiss');
    var phone = document.getElementById('miya-phone-layer');
    if (!foot || !dock) return;

    var REVEAL_H = 120;

    function hideDock() {
      foot.classList.add('is-dock-hidden');
      if (phone) phone.classList.add('is-dock-hidden');
    }

    function showDock() {
      foot.classList.remove('is-dock-hidden');
      if (phone) phone.classList.remove('is-dock-hidden');
    }

    if (dismiss) {
      dismiss.addEventListener('click', function (e) {
        if (foot.classList.contains('is-dock-hidden')) return;
        e.preventDefault();
        e.stopPropagation();
        hideDock();
      });
    }


    foot.addEventListener('click', function () {
      if (foot.classList.contains('is-dock-hidden')) showDock();
    });

    if (phone) {
      phone.addEventListener('click', function (e) {
        if (!foot.classList.contains('is-dock-hidden')) return;
        var rect = phone.getBoundingClientRect();
        if (e.clientY >= rect.bottom - REVEAL_H) showDock();
      });
    }
  })();

  /* 桌面音乐播放器小组件 */
  (function initPlayer() {
    var player = document.getElementById('wg-player');
    var toggle = document.getElementById('player-toggle');
    var fill = document.getElementById('player-fill');
    var head = player && player.querySelector('.wg-player__bar-head');
    var cur = document.getElementById('player-cur');
    var lyric = document.getElementById('player-lyric');
    if (!player || !toggle) return;

    var LYRICS = [
      '把灯关小一点就好',
      '电梯里有人在哼歌',
      '路口红灯闪了三下',
      '回家路上买了橘子和牛奶'
    ];
    var total = 222;
    var pos = 84;
    var li = 0;
    var timer = null;

    function fmt(s) {
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return pad(m) + ':' + pad(sec);
    }

    function syncBar() {
      var pct = Math.min(100, (pos / total) * 100);
      if (fill) fill.style.width = pct + '%';
      if (head) head.style.left = pct + '%';
      if (cur) cur.textContent = fmt(pos);
    }

    function cycleLyric() {
      if (!lyric) return;
      var custom = window.miyaGetTheme && window.miyaGetTheme().copy;
      if (custom && custom.playerLyric) return;
      lyric.classList.add('is-fade');
      setTimeout(function () {
        li = (li + 1) % LYRICS.length;
        lyric.textContent = LYRICS[li];
        lyric.classList.remove('is-fade');
      }, 500);
    }

    function tickPlayer() {
      if (!player.classList.contains('is-playing')) return;
      pos += 1;
      if (pos >= total) pos = 0;
      syncBar();
      if (pos % 18 === 0) cycleLyric();
    }

    function pauseDeskPlayerTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function resumeDeskPlayerTimer() {
      if (!player.classList.contains('is-playing') || timer) return;
      if (document.hidden || document.body.classList.contains('miya-app-open')) return;
      timer = setInterval(tickPlayer, 1000);
    }

    function setPlaying(on) {
      player.classList.toggle('is-playing', on);
      toggle.setAttribute('aria-label', on ? '暂停' : '播放');
      if (on) resumeDeskPlayerTimer();
      else pauseDeskPlayerTimer();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseDeskPlayerTimer();
      else resumeDeskPlayerTimer();
    });

    if (typeof MutationObserver === 'function' && document.body) {
      new MutationObserver(function () {
        if (document.body.classList.contains('miya-app-open')) pauseDeskPlayerTimer();
        else resumeDeskPlayerTimer();
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setPlaying(!player.classList.contains('is-playing'));
    });

    player.addEventListener('click', function (e) {
      if (e.target.closest('.wg-player__btn')) return;
      if (e.target.closest('[data-miya-copy]')) return;
      setPlaying(!player.classList.contains('is-playing'));
    });

    syncBar();
  })();

  (function initP4MistRail() {
    var desk = document.querySelector('.desk--p4');
    var rail = document.getElementById('p4-haze-rail');
    var knob = document.getElementById('p4-haze-knob');
    var track = document.getElementById('p4-haze-track');
    if (!desk || !rail || !knob || !track) return;

    var dragging = false;

    function setHaze(ratio) {
      var t = Math.max(0.08, Math.min(0.95, ratio));
      desk.style.setProperty('--p4-haze', String(Math.round(t * 100) / 100));
      knob.style.left = (t * 100) + '%';
    }

    function ratioFromEvent(e) {
      var rect = track.getBoundingClientRect();
      var clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
      if (!rect.width) return 0.55;
      return (clientX - rect.left) / rect.width;
    }

    function onDown(e) {
      dragging = true;
      rail.classList.add('is-dragging');
      setHaze(ratioFromEvent(e));
      e.preventDefault();
      e.stopPropagation();
    }

    function onMove(e) {
      if (!dragging) return;
      setHaze(ratioFromEvent(e));
      e.preventDefault();
      e.stopPropagation();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove('is-dragging');
    }

    setHaze(0.55);
    rail.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  })();

  if (window.miyaBootstrapKvStoresIdle) {
    window.miyaBootstrapKvStoresIdle();
  } else if (window.miyaBootstrapKvStores) {
    window.miyaBootstrapKvStores().catch(function () {});
  }

  if (window.miyaRequestPersistentStorage) {
    window.miyaRequestPersistentStorage();
  }
})();
