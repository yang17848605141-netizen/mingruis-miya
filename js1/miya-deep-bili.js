/**
 * miya-deep-bili.js — 深入 · 角色手机 bilibili（粉白 · 双栏推荐 · 底栏多页）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var TABS = [
    { id: 'home', label: '首页' },
    { id: 'dyn', label: '动态' },
    { id: 'bangumi', label: '追番' },
    { id: 'mine', label: '我的' }
  ];

  var KIND_LABEL = {
    video: '视频',
    article: '图文',
    live: '直播',
    bangumi: '番剧'
  };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    biliData: null,
    refreshing: false,
    built: false,
    page: 'home',
    category: '推荐',
    videoId: '',
    playerTab: 'intro',
    descOpen: false,
    homeScroll: 0
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function biliStore() { return global.miyaDeepBiliStore || null; }
  function biliBridge() { return global.miyaDeepBiliBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-bili-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-bili-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的bilibili数据');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function updateStatusBar() {
    var bar = $('dp-bili-status');
    var text = $('dp-bili-status-text');
    if (!bar || !text) return;
    var data = state.biliData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的bilibili数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = 'bilibili 已同步';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-bili__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-bili__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-bili-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.biliData && state.biliData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.biliData && state.biliData.bili ? state.biliData.bili : null;
  }

  function hasContent(b) {
    if (!b) return false;
    return !!(
      (b.feed && b.feed.length) ||
      (b.dynamics && b.dynamics.length) ||
      (b.watching && b.watching.length) ||
      (b.favorites && b.favorites.length) ||
      (b.history && b.history.length) ||
      (b.following && b.following.length) ||
      (b.services && b.services.length) ||
      trim(b.uname) ||
      trim(b.sign) ||
      (b.hero && trim(b.hero.title)) ||
      trim(b.footerNote) ||
      trim(b.nightThought)
    );
  }

  function persistPayload() {
    var ts = biliStore();
    if (!ts || !state.contactId || !state.biliData) return Promise.resolve(null);
    return ts.patchBili(state.contactId, { bili: state.biliData.bili }).then(function (saved) {
      state.biliData = saved;
      return saved;
    });
  }

  function captureScroll() {
    var sc = $('dp-bili-scroll');
    return sc ? sc.scrollTop : 0;
  }

  function restoreScroll(top) {
    var sc = $('dp-bili-scroll');
    if (sc) sc.scrollTop = top || 0;
  }

  function avatarLetter(name) {
    var n = trim(name) || 'B';
    return n.charAt(0);
  }

  function buildTopChrome(b) {
    var hint = trim(b.searchHint) || '搜索视频、番剧或 UP';
    return (
      '<div class="dp-bili__top">' +
        '<div class="dp-bili__search-row">' +
          '<span class="dp-bili__mini-av" aria-hidden="true">' + esc(avatarLetter(b.uname || state.contactName)) + '</span>' +
          '<div class="dp-bili__search" role="search">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
              '<circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/>' +
            '</svg>' +
            '<span>' + esc(hint) + '</span>' +
          '</div>' +
          '<button type="button" class="dp-bili__icon-btn" data-act="bili-refresh" id="dp-bili-refresh-inline" aria-label="刷新">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
              '<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4v5h-5"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="dp-bili__cats" id="dp-bili-cats">' +
          (b.tabs || ['推荐']).map(function (t) {
            var on = (state.category || b.activeTab || '推荐') === t;
            return '<button type="button" class="dp-bili__cat' + (on ? ' is-on' : '') + '" data-act="cat" data-cat="' + esc(t) + '">' + esc(t) + '</button>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function buildHero(b) {
    var h = b.hero;
    if (!h || !trim(h.title)) return '';
    return (
      '<button type="button" class="dp-bili__hero" data-act="open-hero" data-tone="' + esc(h.coverTone || 'rose') + '">' +
        '<span class="dp-bili__hero-wash" aria-hidden="true"></span>' +
        '<span class="dp-bili__hero-play" aria-hidden="true"></span>' +
        '<span class="dp-bili__hero-meta">' +
          (h.duration ? '<i>' + esc(h.duration) + '</i>' : '') +
          (h.views ? '<i>' + esc(h.views) + ' 播放</i>' : '') +
        '</span>' +
        '<span class="dp-bili__hero-copy">' +
          '<span class="dp-bili__hero-title">' + esc(h.title) + '</span>' +
          (h.upName ? '<span class="dp-bili__hero-up">' + esc(h.upName) + '</span>' : '') +
        '</span>' +
      '</button>'
    );
  }

  function buildPromo(b) {
    var p = b.promo;
    if (!p || !trim(p.title)) return '';
    return (
      '<div class="dp-bili__promo">' +
        '<span class="dp-bili__promo-mark" aria-hidden="true"></span>' +
        '<span class="dp-bili__promo-copy">' +
          '<span class="dp-bili__promo-title">' + esc(p.title) + '</span>' +
        '</span>' +
        '<span class="dp-bili__promo-cta">' + esc(p.cta || '去看看') + '</span>' +
      '</div>'
    );
  }

  function buildFeedCard(f, i) {
    return (
      '<article class="dp-bili__card' + (f.liked ? ' is-liked' : '') +
        '" data-feed-id="' + esc(f.id) + '" style="--i:' + i + '" data-tone="' + esc(f.coverTone || 'mist') + '">' +
        '<button type="button" class="dp-bili__card-cover" data-act="open-video" data-id="' + esc(f.id) + '">' +
          '<span class="dp-bili__card-shade" aria-hidden="true"></span>' +
          '<span class="dp-bili__card-play" aria-hidden="true"></span>' +
          '<span class="dp-bili__card-stats">' +
            (f.views ? '<i>' + esc(f.views) + '</i>' : '') +
            (f.comments ? '<i>' + esc(f.comments) + '</i>' : '') +
            (f.duration ? '<em>' + esc(f.duration) + '</em>' : '') +
          '</span>' +
          (f.tag || f.kind === 'article'
            ? '<span class="dp-bili__card-badge">' + esc(f.tag || KIND_LABEL[f.kind] || '') + '</span>'
            : '') +
        '</button>' +
        '<div class="dp-bili__card-body">' +
          '<button type="button" class="dp-bili__card-title" data-act="open-video" data-id="' + esc(f.id) + '">' +
            esc(f.title) +
          '</button>' +
          '<div class="dp-bili__card-foot">' +
            '<span class="dp-bili__card-up">' + esc(f.upName || 'UP') + '</span>' +
            '<button type="button" class="dp-bili__like" data-act="like-feed" data-id="' + esc(f.id) + '" aria-label="喜欢">' +
              (f.liked ? '♥' : '♡') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function buildFeedGrid(b) {
    var list = b.feed || [];
    if (!list.length) return '';
    var left = [];
    var right = [];
    list.forEach(function (f, i) {
      (i % 2 === 0 ? left : right).push(buildFeedCard(f, i));
    });
    return (
      '<section class="dp-bili__masonry">' +
        '<div class="dp-bili__col">' + left.join('') + '</div>' +
        '<div class="dp-bili__col">' + right.join('') + '</div>' +
      '</section>'
    );
  }

  function buildHomePage(b) {
    return [
      buildTopChrome(b),
      buildHero(b),
      buildPromo(b),
      buildFeedGrid(b)
    ].join('');
  }

  function buildDynPage(b) {
    var list = b.dynamics || [];
    return (
      '<section class="dp-bili__page-head">' +
        '<span class="dp-bili__page-kicker">Dynamics</span>' +
        '<h2>动态</h2>' +
        '<p>ta 刷过又没说出口的那些更新</p>' +
      '</section>' +
      '<div class="dp-bili__dyn-list">' +
        (list.length ? list.map(function (d, i) {
          return (
            '<button type="button" class="dp-bili__dyn' + (d.opened ? ' is-open' : '') +
              '" data-act="toggle-dyn" data-id="' + esc(d.id) + '" style="--i:' + i + '">' +
              '<span class="dp-bili__dyn-type">' + esc(d.type || 'text') + '</span>' +
              '<span class="dp-bili__dyn-text">' + esc(d.text) + '</span>' +
              '<span class="dp-bili__dyn-meta">' +
                (d.time ? '<i>' + esc(d.time) + '</i>' : '') +
                (d.likes ? '<i>赞 ' + esc(d.likes) + '</i>' : '') +
                (d.replies ? '<i>评 ' + esc(d.replies) + '</i>' : '') +
              '</span>' +
              (d.opened && trim(d.detail)
                ? '<span class="dp-bili__dyn-detail">' + esc(d.detail) + '</span>'
                : '') +
            '</button>'
          );
        }).join('') : '<p class="dp-bili__empty-line">还没有动态</p>') +
      '</div>'
    );
  }

  function buildBangumiPage(b) {
    var watching = b.watching || [];
    var favs = b.favorites || [];
    var hist = b.history || [];
    return (
      '<section class="dp-bili__page-head">' +
        '<span class="dp-bili__page-kicker">Watching</span>' +
        '<h2>追番与收藏</h2>' +
        '<p>进度条停在哪，心情就停在哪</p>' +
      '</section>' +
      (watching.length
        ? '<section class="dp-bili__block">' +
            '<header class="dp-bili__block-head"><h3>正在追</h3><span>' + watching.length + '</span></header>' +
            '<div class="dp-bili__watch-rail">' +
              watching.map(function (w) {
                return (
                  '<button type="button" class="dp-bili__watch' + (w.opened ? ' is-open' : '') +
                    '" data-act="toggle-watch" data-id="' + esc(w.id) + '" data-tone="' + esc(w.coverTone || 'plum') + '">' +
                    '<span class="dp-bili__watch-cover" aria-hidden="true"></span>' +
                    '<span class="dp-bili__watch-title">' + esc(w.title) + '</span>' +
                    '<span class="dp-bili__watch-prog">' + esc(w.progress || w.episode || '') + '</span>' +
                    (w.opened && trim(w.note)
                      ? '<span class="dp-bili__watch-note">' + esc(w.note) + '</span>'
                      : '') +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        : '') +
      (favs.length
        ? '<section class="dp-bili__block">' +
            '<header class="dp-bili__block-head"><h3>收藏夹</h3><span>' + favs.length + '</span></header>' +
            '<div class="dp-bili__fav-list">' +
              favs.map(function (f) {
                return (
                  '<button type="button" class="dp-bili__fav' + (f.opened ? ' is-open' : '') +
                    '" data-act="toggle-fav" data-id="' + esc(f.id) + '">' +
                    '<span class="dp-bili__fav-folder">' + esc(f.folder || '默认收藏夹') + '</span>' +
                    '<span class="dp-bili__fav-title">' + esc(f.title) + '</span>' +
                    ((!f.opened && trim(f.note)) ? '<span class="dp-bili__fav-note">' + esc(f.note) + '</span>' : '') +
                    (f.opened && trim(f.body) ? '<span class="dp-bili__fav-body">' + esc(f.body) + '</span>' : '') +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        : '') +
      (hist.length
        ? '<section class="dp-bili__block dp-bili__block--mute">' +
            '<header class="dp-bili__block-head"><h3>稍后再看 / 历史</h3></header>' +
            '<ul class="dp-bili__hist">' +
              hist.map(function (h) {
                return (
                  '<li data-tone="' + esc(h.coverTone || 'tea') + '">' +
                    '<span class="dp-bili__hist-dot" aria-hidden="true"></span>' +
                    '<span class="dp-bili__hist-copy">' +
                      '<span class="dp-bili__hist-title">' + esc(h.title) + '</span>' +
                      '<span class="dp-bili__hist-meta">' +
                        (h.watchedAt ? esc(h.watchedAt) : '') +
                        (h.progress ? (h.watchedAt ? ' · ' : '') + esc(h.progress) : '') +
                      '</span>' +
                    '</span>' +
                  '</li>'
                );
              }).join('') +
            '</ul>' +
          '</section>'
        : '')
    );
  }

  function buildMinePage(b) {
    var st = b.stats || {};
    var follow = b.following || [];
    var services = b.services || [];
    var creation = b.creation || { items: [] };
    var banner = b.memberBanner;
    return (
      '<section class="dp-bili__profile">' +
        '<div class="dp-bili__profile-row">' +
          '<div class="dp-bili__av" aria-hidden="true">' + esc(avatarLetter(b.uname || state.contactName)) + '</div>' +
          '<div class="dp-bili__profile-copy">' +
            '<div class="dp-bili__name-row">' +
              '<h2>' + esc(trim(b.uname) || state.contactName || '用户') + '</h2>' +
              (b.level ? '<span class="dp-bili__lv">LV' + esc(String(b.level)) + '</span>' : '') +
            '</div>' +
            (trim(b.vipLabel) ? '<span class="dp-bili__vip">' + esc(b.vipLabel) + '</span>' : '') +
            '<div class="dp-bili__coin-row">' +
              (b.bCoins !== '' ? '<span>B币 ' + esc(b.bCoins) + '</span>' : '') +
              (b.coins !== '' ? '<span>硬币 ' + esc(b.coins) + '</span>' : '') +
            '</div>' +
            (trim(b.sign) ? '<p class="dp-bili__sign">' + esc(b.sign) + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<div class="dp-bili__stats">' +
          '<div><strong>' + esc(st.dynamics || '0') + '</strong><span>动态</span></div>' +
          '<div><strong>' + esc(st.following || '0') + '</strong><span>关注</span></div>' +
          '<div><strong>' + esc(st.followers || '0') + '</strong><span>粉丝</span></div>' +
        '</div>' +
      '</section>' +
      (banner && trim(banner.text)
        ? '<button type="button" class="dp-bili__vip-banner' + (banner.opened ? ' is-open' : '') + '" data-act="toggle-banner">' +
            '<span class="dp-bili__vip-text">' + esc(banner.text) + '</span>' +
            '<span class="dp-bili__vip-cta">' + esc(banner.cta || '大会员中心') + '</span>' +
            (banner.opened && trim(banner.body)
              ? '<span class="dp-bili__vip-body">' + esc(banner.body) + '</span>'
              : '') +
          '</button>'
        : '') +
      ((creation.items && creation.items.length) || trim(creation.note)
        ? '<section class="dp-bili__block">' +
            '<header class="dp-bili__block-head">' +
              '<h3>创作中心</h3>' +
              (creation.drafts ? '<span class="dp-bili__pill">草稿 ' + esc(creation.drafts) + '</span>' : '') +
            '</header>' +
            (trim(creation.note) ? '<p class="dp-bili__block-note">' + esc(creation.note) + '</p>' : '') +
            (trim(creation.incentive) ? '<p class="dp-bili__incentive">' + esc(creation.incentive) + '</p>' : '') +
            '<div class="dp-bili__create-grid">' +
              (creation.items || []).map(function (it) {
                return (
                  '<button type="button" class="dp-bili__create' + (it.opened ? ' is-open' : '') +
                    '" data-act="toggle-create" data-id="' + esc(it.id) + '">' +
                    '<span class="dp-bili__create-name">' + esc(it.name) + '</span>' +
                    (it.badge ? '<em>' + esc(it.badge) + '</em>' : '') +
                    (it.opened && trim(it.body)
                      ? '<span class="dp-bili__create-body">' + esc(it.body) + '</span>'
                      : '') +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        : '') +
      (services.length
        ? '<section class="dp-bili__block">' +
            '<header class="dp-bili__block-head"><h3>我的服务</h3></header>' +
            '<div class="dp-bili__svc-grid">' +
              services.map(function (s, i) {
                return (
                  '<button type="button" class="dp-bili__svc' + (s.opened ? ' is-open' : '') +
                    '" data-act="toggle-svc" data-id="' + esc(s.id) + '" style="--i:' + i + '">' +
                    '<span class="dp-bili__svc-ico" aria-hidden="true"></span>' +
                    '<span class="dp-bili__svc-name">' + esc(s.name) + '</span>' +
                    (trim(s.hint) && !s.opened ? '<span class="dp-bili__svc-hint">' + esc(s.hint) + '</span>' : '') +
                    (s.opened && trim(s.body) ? '<span class="dp-bili__svc-body">' + esc(s.body) + '</span>' : '') +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        : '') +
      (follow.length
        ? '<section class="dp-bili__block">' +
            '<header class="dp-bili__block-head"><h3>特别关注</h3></header>' +
            '<div class="dp-bili__follow-list">' +
              follow.map(function (f) {
                return (
                  '<div class="dp-bili__follow" data-tone="' + esc(f.coverTone || 'sky') + '">' +
                    '<span class="dp-bili__follow-av" aria-hidden="true">' + esc(avatarLetter(f.name)) + '</span>' +
                    '<span class="dp-bili__follow-copy">' +
                      '<span class="dp-bili__follow-name">' + esc(f.name) + '</span>' +
                      (trim(f.reason) ? '<span class="dp-bili__follow-why">' + esc(f.reason) + '</span>' : '') +
                      (f.lastUpdate ? '<span class="dp-bili__follow-time">' + esc(f.lastUpdate) + '</span>' : '') +
                    '</span>' +
                  '</div>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        : '') +
      (trim(b.nightThought)
        ? '<p class="dp-bili__night">' + esc(b.nightThought) + '</p>'
        : '')
    );
  }

  function buildFooter(b) {
    if (!trim(b.footerNote)) return '';
    return (
      '<footer class="dp-bili__footer">' +
        '<span class="dp-bili__footer-rule" aria-hidden="true"></span>' +
        '<p>' + esc(b.footerNote) + '</p>' +
      '</footer>'
    );
  }

  function resolveVideo(b, id) {
    if (id === '__hero__' && b.hero) {
      var h = b.hero;
      return {
        id: '__hero__',
        title: h.title,
        upName: h.upName || '',
        views: h.views || '',
        comments: '',
        duration: h.duration || '',
        kind: 'video',
        coverTone: h.coverTone || 'rose',
        tag: '',
        preview: '',
        body: h.desc || '',
        note: h.desc || '',
        coins: '',
        date: '',
        upFans: '',
        upVideos: '',
        bgm: '',
        series: '',
        liked: !!h.liked,
        coined: !!h.coined,
        faved: !!h.faved,
        followed: !!h.followed
      };
    }
    return findIn(b.feed, id);
  }

  function relatedVideos(b, currentId) {
    return (b.feed || []).filter(function (f) { return f && f.id !== currentId; }).slice(0, 6);
  }

  function annotationText(v) {
    return trim(v && (v.note || v.body || v.preview)) || '';
  }

  function buildPlayerHtml(b, v) {
    var name = trim(state.contactName) || trim(b.uname) || 'ta';
    var note = annotationText(v);
    var related = relatedVideos(b, v.id);
    var tab = state.playerTab || 'intro';
    var descOpen = state.descOpen;

    return (
      '<div class="dp-bili__stage" data-tone="' + esc(v.coverTone || 'rose') + '">' +
        '<button type="button" class="dp-bili__stage-back" data-act="close-player" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="dp-bili__stage-screen">' +
          '<span class="dp-bili__stage-wash" aria-hidden="true"></span>' +
          '<span class="dp-bili__stage-logo" aria-hidden="true">bili</span>' +
          '<span class="dp-bili__stage-play" aria-hidden="true"></span>' +
          (v.duration ? '<span class="dp-bili__stage-dur">' + esc(v.duration) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (trim(v.preview)
        ? '<div class="dp-bili__strip"><span>' + esc(v.preview) + '</span></div>'
        : '') +
      '<div class="dp-bili__ptabs">' +
        '<button type="button" class="dp-bili__ptab' + (tab === 'intro' ? ' is-on' : '') + '" data-act="player-tab" data-tab="intro">简介</button>' +
        '<button type="button" class="dp-bili__ptab' + (tab === 'comments' ? ' is-on' : '') + '" data-act="player-tab" data-tab="comments">评论' +
          (v.comments ? ' ' + esc(v.comments) : '') +
        '</button>' +
      '</div>' +
      '<div class="dp-bili__pup">' +
        '<span class="dp-bili__pup-av" aria-hidden="true">' + esc(avatarLetter(v.upName || 'U')) + '</span>' +
        '<div class="dp-bili__pup-copy">' +
          '<strong>' + esc(v.upName || 'UP主') + '</strong>' +
          '<span>' +
            (v.upFans ? esc(v.upFans) + '粉丝' : '') +
            (v.upFans && v.upVideos ? ' · ' : '') +
            (v.upVideos ? esc(v.upVideos) + '视频' : '') +
          '</span>' +
        '</div>' +
        '<button type="button" class="dp-bili__follow-btn' + (v.followed ? ' is-on' : '') + '" data-act="toggle-follow" data-id="' + esc(v.id) + '">' +
          (v.followed ? '已关注' : '+ 关注') +
        '</button>' +
      '</div>' +
      '<section class="dp-bili__pinfo">' +
        '<button type="button" class="dp-bili__ptitle' + (descOpen ? ' is-open' : '') + '" data-act="toggle-desc">' +
          '<span>' + esc(v.title) + '</span>' +
          '<i aria-hidden="true"></i>' +
        '</button>' +
        '<div class="dp-bili__pstats">' +
          (v.views ? '<span>' + esc(v.views) + ' 播放</span>' : '') +
          (v.comments ? '<span>' + esc(v.comments) + ' 弹幕</span>' : '') +
          (v.date ? '<span>' + esc(v.date) + '</span>' : '') +
        '</div>' +
        (descOpen && trim(v.body)
          ? '<p class="dp-bili__pdesc">' + esc(v.body) + '</p>'
          : '') +
      '</section>' +
      '<div class="dp-bili__pacts">' +
        '<button type="button" class="dp-bili__pact' + (v.liked ? ' is-on' : '') + '" data-act="like-video" data-id="' + esc(v.id) + '"><i>♡</i><span>点赞</span></button>' +
        '<button type="button" class="dp-bili__pact' + (v.coined ? ' is-on' : '') + '" data-act="coin-video" data-id="' + esc(v.id) + '"><i>○</i><span>' + esc(v.coins || '投币') + '</span></button>' +
        '<button type="button" class="dp-bili__pact' + (v.faved ? ' is-on' : '') + '" data-act="fav-video" data-id="' + esc(v.id) + '"><i>☆</i><span>收藏</span></button>' +
        '<button type="button" class="dp-bili__pact" data-act="share-video"><i>↗</i><span>分享</span></button>' +
      '</div>' +
      (trim(v.series)
        ? '<div class="dp-bili__series"><span>合集 · ' + esc(v.series) + '</span></div>'
        : '') +
      (trim(v.bgm)
        ? '<div class="dp-bili__bgm"><span>♪ ' + esc(v.bgm) + '</span></div>'
        : '') +
      (note
        ? '<aside class="dp-bili__note">' +
            '<header><em>角色批注</em><span>' + esc(name) + '</span></header>' +
            '<p>' + esc(note) + '</p>' +
          '</aside>'
        : '') +
      (tab === 'comments'
        ? '<section class="dp-bili__comments">' +
            '<p class="dp-bili__comment-empty">评论区很安静。批注里才有 ' + esc(name) + ' 真正想说的。</p>' +
          '</section>'
        : '') +
      (related.length
        ? '<section class="dp-bili__related">' +
            '<header class="dp-bili__block-head"><h3>更多推荐</h3></header>' +
            related.map(function (r) {
              return (
                '<button type="button" class="dp-bili__rel" data-act="open-video" data-id="' + esc(r.id) + '" data-tone="' + esc(r.coverTone || 'mist') + '">' +
                  '<span class="dp-bili__rel-thumb"><i></i>' +
                    (r.duration ? '<em>' + esc(r.duration) + '</em>' : '') +
                  '</span>' +
                  '<span class="dp-bili__rel-copy">' +
                    '<span class="dp-bili__rel-title">' + esc(r.title) + '</span>' +
                    '<span class="dp-bili__rel-meta">' +
                      '<b>UP</b> ' + esc(r.upName || '') +
                      (r.views ? ' · ' + esc(r.views) : '') +
                    '</span>' +
                  '</span>' +
                '</button>'
              );
            }).join('') +
          '</section>'
        : '')
    );
  }

  function setPlayerVisible(show) {
    var panel = $('dp-bili-player');
    var dock = $('dp-bili-dock-host');
    var chrome = document.querySelector('#dp-bili .dp-bili__chrome');
    var scroll = $('dp-bili-scroll');
    if (!panel) return;
    if (show) {
      panel.hidden = false;
      panel.classList.add('is-open');
      if (dock) dock.classList.add('is-dim');
      if (chrome) chrome.classList.add('is-dim');
      if (scroll) scroll.classList.add('is-locked');
    } else {
      panel.classList.remove('is-open');
      panel.hidden = true;
      if (dock) dock.classList.remove('is-dim');
      if (chrome) chrome.classList.remove('is-dim');
      if (scroll) scroll.classList.remove('is-locked');
    }
  }
  function renderPlayer() {
    var b = getPayload();
    var sc = $('dp-bili-player-scroll');
    if (!b || !sc || !state.videoId) return;
    var v = resolveVideo(b, state.videoId);
    if (!v) {
      closePlayer(true);
      return;
    }
    sc.innerHTML = buildPlayerHtml(b, v);
  }

  function openPlayer(id, keepRelatedScroll) {
    var b = getPayload();
    if (!b || !id) return;
    var v = resolveVideo(b, id);
    if (!v) return;
    var wasOpen = !!state.videoId;
    if (!wasOpen) state.homeScroll = captureScroll();
    state.videoId = id;
    state.playerTab = 'intro';
    state.descOpen = false;
    renderPlayer();
    setPlayerVisible(true);
    var sc = $('dp-bili-player-scroll');
    if (sc && !keepRelatedScroll) sc.scrollTop = 0;
  }

  function closePlayer(instant) {
    state.videoId = '';
    state.playerTab = 'intro';
    state.descOpen = false;
    setPlayerVisible(false);
    if (instant) {
      var panel = $('dp-bili-player');
      if (panel) {
        panel.classList.remove('is-open');
        panel.hidden = true;
      }
    }
    restoreScroll(state.homeScroll || 0);
  }

  function patchHomeLike(id, liked) {
    var card = document.querySelector('#dp-bili-stream .dp-bili__card[data-feed-id="' + id + '"]');
    if (!card) return;
    card.classList.toggle('is-liked', !!liked);
    var btn = card.querySelector('.dp-bili__like');
    if (btn) btn.textContent = liked ? '♥' : '♡';
  }

  function updateDockTabs() {
    var host = $('dp-bili-dock-host');
    if (!host) return;
    var btns = host.querySelectorAll('.dp-bili__dock-btn[data-tab]');
    var i;
    for (i = 0; i < btns.length; i++) {
      var tab = btns[i].getAttribute('data-tab');
      btns[i].classList.toggle('is-on', tab === state.page);
    }
  }

  function ensureDock() {
    var dockHost = $('dp-bili-dock-host');
    if (!dockHost || dockHost.querySelector('.dp-bili__dock')) return;
    dockHost.innerHTML = buildDock();
  }

  function patchDynToggle(id) {
    var b = getPayload();
    if (!b) return;
    var d = findIn(b.dynamics, id);
    if (!d) return;
    d.opened = !d.opened;
    var btn = document.querySelector('#dp-bili-stream .dp-bili__dyn[data-id="' + id + '"]');
    if (btn) {
      btn.classList.toggle('is-open', !!d.opened);
      var detail = btn.querySelector('.dp-bili__dyn-detail');
      if (d.opened && trim(d.detail)) {
        if (!detail) {
          detail = document.createElement('span');
          detail.className = 'dp-bili__dyn-detail';
          btn.appendChild(detail);
        }
        detail.textContent = d.detail;
      } else if (detail) {
        detail.remove();
      }
    }
    persistPayload();
  }

  function patchWatchToggle(id) {
    var b = getPayload();
    if (!b) return;
    var w = findIn(b.watching, id);
    if (!w) return;
    w.opened = !w.opened;
    var btn = document.querySelector('#dp-bili-stream .dp-bili__watch[data-id="' + id + '"]');
    if (btn) {
      btn.classList.toggle('is-open', !!w.opened);
      var note = btn.querySelector('.dp-bili__watch-note');
      if (w.opened && trim(w.note)) {
        if (!note) {
          note = document.createElement('span');
          note.className = 'dp-bili__watch-note';
          btn.appendChild(note);
        }
        note.textContent = w.note;
      } else if (note) {
        note.remove();
      }
    }
    persistPayload();
  }

  function patchFavToggle(id) {
    var b = getPayload();
    if (!b) return;
    var f = findIn(b.favorites, id);
    if (!f) return;
    f.opened = !f.opened;
    var btn = document.querySelector('#dp-bili-stream .dp-bili__fav[data-id="' + id + '"]');
    if (btn) {
      btn.classList.toggle('is-open', !!f.opened);
      var note = btn.querySelector('.dp-bili__fav-note');
      var body = btn.querySelector('.dp-bili__fav-body');
      if (f.opened) {
        if (note) note.remove();
        if (trim(f.body)) {
          if (!body) {
            body = document.createElement('span');
            body.className = 'dp-bili__fav-body';
            btn.appendChild(body);
          }
          body.textContent = f.body;
        } else if (body) {
          body.remove();
        }
      } else {
        if (body) body.remove();
        if (trim(f.note)) {
          if (!note) {
            note = document.createElement('span');
            note.className = 'dp-bili__fav-note';
            btn.appendChild(note);
          }
          note.textContent = f.note;
        } else if (note) {
          note.remove();
        }
      }
    }
    persistPayload();
  }

  function switchDockTab(tab) {
    tab = String(tab || '').trim();
    if (!tab || tab === state.page) return;
    if (state.videoId) closePlayer(true);
    state.page = tab;
    var b = getPayload();
    if (b) {
      renderStream(b, false);
      restoreScroll(0);
    }
    updateDockTabs();
  }

  function handleRootClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t || !state.open) return;
    var act = t.getAttribute('data-act');
    if (act === 'tab') {
      e.preventDefault();
      e.stopPropagation();
      switchDockTab(t.getAttribute('data-tab'));
    }
  }

  function wireDockButtons() {
    var root = $('dp-bili');
    if (!root || root._dpBiliDockBound) return;
    root._dpBiliDockBound = true;
    root.addEventListener('click', handleRootClick);
  }

  function mountDock() {
    var dockHost = $('dp-bili-dock-host');
    if (!dockHost) return;
    dockHost.innerHTML = buildDock();
    wireDockButtons();
  }

  function buildDock() {
    return (
      '<nav class="dp-bili__dock" aria-label="bilibili 导航">' +
        TABS.map(function (t) {
          return (
            '<button type="button" class="dp-bili__dock-btn' + (state.page === t.id ? ' is-on' : '') +
              '" data-act="tab" data-tab="' + esc(t.id) + '" aria-label="' + esc(t.label) + '">' +
              '<span class="dp-bili__dock-ico" data-tab="' + esc(t.id) + '" aria-hidden="true"></span>' +
              '<span class="dp-bili__dock-label">' + esc(t.label) + '</span>' +
            '</button>'
          );
        }).join('') +
      '</nav>'
    );
  }

  function renderStream(b, keepScroll) {
    var el = $('dp-bili-stream');
    if (!el) return;
    var snap = keepScroll ? captureScroll() : null;
    var pageHtml = '';
    if (state.page === 'dyn') pageHtml = buildDynPage(b);
    else if (state.page === 'bangumi') pageHtml = buildBangumiPage(b);
    else if (state.page === 'mine') pageHtml = buildMinePage(b);
    else pageHtml = buildHomePage(b);

    el.classList.add('is-static');
    el.innerHTML = pageHtml + buildFooter(b);
    updateDockTabs();

    updateRefreshBtn();
    var inline = $('dp-bili-refresh-inline');
    var busy = state.refreshing || (state.biliData && state.biliData.refreshStatus === 'loading');
    if (inline) {
      inline.disabled = !!busy;
      inline.classList.toggle('is-spinning', !!busy);
    }

    if (snap != null) {
      restoreScroll(snap);
      requestAnimationFrame(function () { restoreScroll(snap); });
    }
  }

  function buildFullUI() {
    var b = getPayload();
    var empty = $('dp-bili-empty');
    var stream = $('dp-bili-stream');
    var dockHost = $('dp-bili-dock-host');
    var has = hasContent(b);
    if (empty) empty.hidden = !!has;
    if (stream) {
      stream.hidden = !has;
      if (has) renderStream(b);
      else stream.innerHTML = '';
    }
    if (dockHost) {
      dockHost.hidden = !has;
      if (has) mountDock();
      else dockHost.innerHTML = '';
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadBiliData(contactId) {
    var ts = biliStore();
    if (!ts) return Promise.resolve(null);
    return ts.getBili(contactId).then(function (data) {
      state.biliData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-bili-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = biliStore();
    var br = biliBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchBili(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的bilibili数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.biliData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
        var inline = $('dp-bili-refresh-inline');
        if (inline) {
          inline.disabled = true;
          inline.classList.add('is-spinning');
        }
      }
      return br.generateBili(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchBili(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        bili: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.biliData = saved;
        state.refreshing = false;
        if (saved.bili && saved.bili.activeTab) state.category = saved.bili.activeTab;
        if (state.open) {
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchBili(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.biliData = saved;
          state.refreshing = false;
          if (state.open) {
            updateStatusBar();
            updateRefreshBtn();
            var inline = $('dp-bili-refresh-inline');
            if (inline) {
              inline.disabled = false;
              inline.classList.remove('is-spinning');
            }
          }
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.biliData && state.biliData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function findIn(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  function toggleAndRender(mutator) {
    var b = getPayload();
    if (!b) return;
    mutator(b);
    renderStream(b, true);
    persistPayload();
  }

  function handleStreamClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    var b = getPayload();
    if (!b) return;

    if (act === 'bili-refresh') {
      handleRefresh();
      return;
    }
    if (act === 'cat') {
      state.category = t.getAttribute('data-cat') || '推荐';
      var cats = document.querySelectorAll('#dp-bili-cats .dp-bili__cat');
      var i;
      for (i = 0; i < cats.length; i++) {
        cats[i].classList.toggle('is-on', cats[i].getAttribute('data-cat') === state.category);
      }
      return;
    }
    if (act === 'open-hero') {
      openPlayer('__hero__');
      return;
    }
    if (act === 'open-video') {
      openPlayer(id);
      return;
    }
    if (act === 'like-feed') {
      e.stopPropagation();
      var lf = findIn(b.feed, id);
      if (lf) {
        lf.liked = !lf.liked;
        patchHomeLike(id, lf.liked);
        persistPayload();
      }
      return;
    }
    if (act === 'toggle-banner' && b.memberBanner) {
      toggleAndRender(function (payload) {
        payload.memberBanner.opened = !payload.memberBanner.opened;
      });
      return;
    }
    if (act === 'toggle-dyn') {
      patchDynToggle(id);
      return;
    }
    if (act === 'toggle-watch') {
      patchWatchToggle(id);
      return;
    }
    if (act === 'toggle-fav') {
      patchFavToggle(id);
      return;
    }
    if (act === 'toggle-svc') {
      toggleAndRender(function (payload) {
        var s = findIn(payload.services, id);
        if (s) s.opened = !s.opened;
      });
      return;
    }
    if (act === 'toggle-create') {
      toggleAndRender(function (payload) {
        var cr = findIn((payload.creation && payload.creation.items) || [], id);
        if (cr) cr.opened = !cr.opened;
      });
      return;
    }
  }

  function mutateActiveVideo(mutator) {
    var b = getPayload();
    if (!b || !state.videoId) return null;
    if (state.videoId === '__hero__' && b.hero) {
      mutator(b.hero);
      persistPayload().then(function () { renderPlayer(); });
      return b.hero;
    }
    var f = findIn(b.feed, state.videoId);
    if (f) {
      mutator(f);
      persistPayload().then(function () {
        renderPlayer();
        if (Object.prototype.hasOwnProperty.call(f, 'liked')) patchHomeLike(f.id, f.liked);
      });
    }
    return f;
  }

  function handlePlayerClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    var b = getPayload();
    if (!b) return;

    if (act === 'close-player') {
      closePlayer();
      return;
    }
    if (act === 'open-video') {
      openPlayer(id);
      return;
    }
    if (act === 'player-tab') {
      state.playerTab = t.getAttribute('data-tab') || 'intro';
      renderPlayer();
      return;
    }
    if (act === 'toggle-desc') {
      state.descOpen = !state.descOpen;
      renderPlayer();
      return;
    }
    if (act === 'toggle-follow') {
      mutateActiveVideo(function (v) { v.followed = !v.followed; });
      return;
    }
    if (act === 'like-video') {
      mutateActiveVideo(function (v) { v.liked = !v.liked; });
      return;
    }
    if (act === 'coin-video') {
      mutateActiveVideo(function (v) { v.coined = !v.coined; });
      return;
    }
    if (act === 'fav-video') {
      mutateActiveVideo(function (v) { v.faved = !v.faved; });
      return;
    }
    if (act === 'share-video') {
      toast('已记下想分享的瞬间');
    }
  }

  function handleChromeBack() {
    if (state.videoId) {
      closePlayer();
      return;
    }
    close();
  }

  function bindOnce() {
    var root = $('dp-bili');
    if (!root || root._biliBound) return;
    root._biliBound = true;

    var back = $('dp-bili-back');
    if (back) back.addEventListener('click', handleChromeBack);

    var refresh = $('dp-bili-refresh');
    if (refresh) refresh.addEventListener('click', function () { handleRefresh(); });

    var stream = $('dp-bili-stream');
    if (stream) stream.addEventListener('click', handleStreamClick);

    var player = $('dp-bili-player');
    if (player) player.addEventListener('click', handlePlayerClick);

    var emptyRefresh = $('dp-bili-empty-refresh');
    if (emptyRefresh) emptyRefresh.addEventListener('click', function () { handleRefresh(); });

    wireDockButtons();
  }

  function open(contactId, phoneData, contactName) {
    var root = $('dp-bili');
    if (!root) {
      toast('bilibili 界面未就绪');
      return;
    }
    bindOnce();
    state.open = true;
    state.contactId = String(contactId || '');
    state.contactName = String(contactName || '');
    state.phoneData = phoneData || null;
    state.page = 'home';
    state.built = false;
    state.videoId = '';
    closePlayer(true);

    root.hidden = false;
    requestAnimationFrame(function () {
      root.classList.add('is-open');
    });

    loadBiliData(state.contactId).then(function (data) {
      if (!state.open || state.contactId !== String(contactId || '')) return;
      state.biliData = data;
      if (data && data.refreshStatus === 'loading') state.refreshing = true;
      if (data && data.bili && data.bili.activeTab) state.category = data.bili.activeTab;
      buildFullUI();
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        runRefreshJob(state.contactId, state.phoneData).catch(function () {});
      }
    });
  }

  function close() {
    var root = $('dp-bili');
    state.open = false;
    state.videoId = '';
    stopStatusDots();
    clearSuccessFlash();
    closePlayer(true);
    if (root) {
      root.classList.remove('is-open');
      setTimeout(function () {
        if (!state.open) root.hidden = true;
      }, 280);
    }
  }

  global.miyaDeepBili = {
    open: open,
    close: close,
    refresh: handleRefresh
  };
})(typeof window !== 'undefined' ? window : global);
