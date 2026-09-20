/**
 * miya · 更新提醒 & 更新一览
 */
(function (global) {
  'use strict';

  var PREFS_KEY = 'miya-update-notice-v1';

  /*
   * ═══════════════════════════════════════════════════════════════
   * 【开发者维护区 — 更新日志】
   * 此处仅由开发者手动维护，请勿在普通功能改动时自动修改本区块。
   * 每次发版追加一条；开屏弹窗只展示最新一条，历史条目见设置「更新一览」。
   * ═══════════════════════════════════════════════════════════════
   */
  var UPDATE_LOG = [
    {
      id: 'v1.0-2026-06',
      version: '1.0',
      title: 'miya机1.0本次更新提示',
      date: '2026-06-21',
      items: [
        'n次优化掉格式',
        '修复线下无法保存预设的bug',
        '新增日记，在第三页',
        '新增情侣空间壳子',
        '修复记忆阅览看不全的问题',
        '修复char发动态不显示头像的问题',
        '更新订阅可在设置里关闭'
      ]
    },
    {
      id: 'v1.0-2026-06-22',
      version: '1.0',
      title: '今日更新速递',
      date: '2026-06-22',
      items: [
        '修复设置app延迟和重复加载',
        '日记新增定时自动写日记并弹窗提醒（需要开保活）、新增uu自己写日记（有概率被char偷看！）',
        '线下：修复了一退出就不保留记录的bug，改为手动封存记录；线下如果想玩小剧场或HTML直接发送指令即可，HTML有放大查看功能',
        '优化聊天提示词',
        '心声和气泡可以一起重roll了'
      ]
    },
    {
      id: 'v1.0-2026-06-23',
      version: '1.0',
      title: '一则午间小更新',
      date: '2026-06-23',
      items: [
        '修复表情包分组、上传壁纸、设置无法滑动等问题，去掉气泡已编辑样式，优化美化类名，能自定义的地方更多啦',
        '音乐新增外观装修和自定义桌面歌词外观',
        '新增聊天内快捷切换char和user头像，不影响档案里设置的头像',
        '♪下次更新不会太快，会多做几个功能一起搬上来，中间会有修修bug的'
      ]
    },
    {
      id: 'v1.0-2026-06-25',
      version: '1.0',
      title: 'miya机本次更新一览',
      date: '2026-06-25',
      items: [
        '更新生图，需要在设置里配置，联系人生图专属提示词需要在聊天设置里设置，当前仅线上聊天和朋友圈生效',
        '更改角色自动发朋友圈的方式：每多少轮对话触发一次/每隔几小时触发一次',
        '修复朋友圈渲染、评论召唤不稳定、char不回复、不自主发动态问题',
        '修复日记掉格式',
        '线上增加旁白模式，工具栏右滑最后一个图标点一下进入旁白模式、再点一下退出旁白模式；增加旁白是否注入上下文记忆开关，在聊天设置里配置',
        '线下增加开场白、重发功能：开场白：在线上设置里设置可添加多个开场白保存为预设，每个char单独存储；重发是给我方和对方气泡都增加一个重发按钮，点击我方气泡的重发是重发我方这条消息并撤回后面的所有对话重新调用api发消息；点击对方气泡的重发是撤回对方这一轮以及后面的所有气泡（如果有）重发本轮',
        '优化翻译，支持发朋友圈带翻译',
        '线下支持自定义美化啦！',
        '修复了线上预览和界面不同步',
        '优化了发烫问题'
      ]
    },
    {
      id: 'v1.0-2026-06-26',
      version: '1.0',
      title: '本次更新一览',
      date: '2026-06-26',
      items: [
        '修复了视频通话解析出错',
        '优化了行程提示词，现在更细致了',
        '增加token明细和查看原始思维链',
        '增加了根据人设主动给你发消息，在聊天设置里配置',
        '群聊新增邀请群成员；新增群转让、群管理、群头衔、群聊翻译；群管理可以更改群员的群头衔（测试这个功能的时候没给我笑鼠……）',
        '下一次更新会更新情侣空间和更完善的群聊，正在严肃施工中，会耗时较久，加了很多有趣的小东西😋'
      ]
    },
    {
      id: 'v1.0-2026-06-28',
      version: '1.0',
      title: '近日更新',
      date: '2026-06-28',
      items: [
        '总而言之修修补补了一些bug',
        'char可以自己给自己换头像了，可以发给char一张图片让他换，char还可以给uu换',
        '新增我的相册，在相册里上传的图片可以快捷切换为头像/选择某一张发朋友圈/同步给char使用。同步给char使用的话char可以随时用相册里某一张照片当头像或者发动态或者给uu换',
        '增加录音功能，发语音和视频通话的时候都可以直接说话了',
        '新增主页自定义布局，内置了小组件，可长按拖拽改变布局，和固定布局不冲突，自由diy主页吧'
      ]
    },
    {
      id: 'v7.4-2026-07-04',
      version: '7.4',
      title: '7.4更新',
      date: '2026-07-04',
      items: [
        '动态图片可保存',
        '新增若干小组件、新增4✖️4、2✖️1尺寸',
        '聊天新增查看思维链、让char写情诗功能',
        '收藏的消息可以显示正确的格式并跳转',
        '情侣空间上线啦'
      ],
      sections: [
        {
          title: '🌟情侣空间',
          items: [
            '打卡摄像机：可以在这里互相打卡报备行程，可开启生图',
            '时光轴：可以在这里自然记录时光、写信、扭蛋、记录下重要纪念事项、char也会时不时写下内容',
            '留言板：随手贴、挑战、每周问答等',
            '深夜私语：文游式私语剧情，可以自己上传立绘、定义文风、听语音、互动式选项、会保留记录等等',
            '照片墙：会显示聊天里发过的所有图片'
          ]
        }
      ]
    },
    {
      id: 'v7.6-2026-07-06',
      version: '7.6',
      title: '7.6更新优化',
      date: '2026-07-06',
      items: [
        '聊天-我的-壁纸管理，在这里上传的壁纸，可以在聊天设置里快捷切换',
        '线上线下桌面歌词美化新增快捷导入docx/txt/css文件，会自动识别填入框内',
        '可以在聊天页内单独为该角色绑定的所有世界书排序（注入顺序，排在最上面的是最先注入的，只影响这一个人）',
        '动态评论区继续优化：一个char的评论区下面其他互相认识的char之间也能互相评论了，不会在仅仅只与发动态的人有互动、uu评论区下面也是',
        '线下新增回车不发送模式，在参数里切换',
        'API预设新增可删除',
        '修复情侣空间留言板显示问题'
      ]
    },
    {
      id: 'v7.8-2026-07-08',
      version: '7.8',
      title: '7.8小更新',
      date: '2026-07-08',
      items: [
        '修复日记截断',
        '新增未读消息提示',
        '新增自定义线上运转规则和思维链，在设置app设置好以后再去聊天设置里为char单独选择',
        '优化自定义布局长按滑动效果'
      ]
    },
    {
      id: 'v7.9-2026-07-14',
      version: '7.9',
      title: '近期更新',
      date: '2026-07-14',
      items: [
        '群聊功能扩展：可以发拼手气红包和专属红包（成员也可以）',
        '聊天app可美化，同时设置了三种预设自由切换',
        '查手机可用：设置、装修、微信、音乐、记事本、健康、小说、短信、浏览器；健康新增一项神秘数据',
        '修复了线上识图失败bug',
        '又优化了一轮卡顿',
        '修复字体大小调整',
        '修复查手机截断',
        '世界书优化：局部世界书也可以分类了，和全局一样；世界书深度可设置前中后',
        '优化线上线下记忆互通',
        '线下模式素纸主题：右侧导航栏点击内部空白位置可隐藏，正文会铺满全屏',
        '线上旁白可在聊天设置里更改人称'
      ]
    },
    {
      id: 'v8.0-2026-07-15',
      version: '8.0',
      title: '今日更新',
      date: '2026-07-15',
      items: [
        '优化和修复：自动总结偶尔失效、后台保活自动关闭、token计量部分不准、群聊后台自动消息阻塞、时间感知不准确',
        '查手机更新：待办、游戏、情侣手册；这三个内容都非常多哦！玩的开心咪'
      ]
    },
    {
      id: 'v8.1-2026-07-16',
      version: '8.1',
      title: '今日更新',
      date: '2026-07-16',
      items: [
        '导出导入备份已经可以正常使用'
      ]
    },
    {
      id: 'v8.2-2026-07-16',
      version: '8.2',
      title: '今日更新',
      date: '2026-07-16',
      items: [
        '查手机20个app已全部完结！',
        '字体支持url链接上传',
        '群聊增加局部世界书关闭注入'
      ],
      sections: [
        {
          title: '查手机 · 20个App',
          items: [
            '微信：私聊/群聊会话列表，含文件传输助手；可点开看完整聊天记录',
            '短信：亲友往来 + 验证码/通知类短信线程，可点开看完整对话',
            '抖音：首页关注/推荐/同城、朋友动态、消息私信、个人页（作品/日常/收藏/喜欢）；视频可看文案、评论与私密批注',
            '健康：13项指标（睡眠、步数、心率等，含私密生理状态）；今日轨迹 + 健康洞察',
            '小红书：首页关注/发现/附近、市集好物、消息（赞关评+私信）、个人页（笔记/收藏/赞过/评论）',
            '小说：5个分类书架，每架6本；含读到哪一章、批注，以及本周阅读统计',
            'Music：3个歌单各10首歌；本周最常听、听歌时长与高峰时段',
            '记事本：10条手帐碎片，带时间标签、划掉内容与样式',
            '待办：今日必办/若有余力/私密纸条三栏；事项可翻看详情、子任务、密封笺、明日种子',
            '情侣手册：封面亲密度 + 图鉴/机密/心跳/仪式/碎片/愿望/词典/未寄信/默契等多页恋爱档案',
            '游戏：封面 + 抉择/翻牌/默契/心温/剧本/抽签/任务/戳章等互动对局',
            '资产：钱包总览、银行卡、零钱包、收支流水；另有情感净值、藏品、保险箱、情绪流水、持仓/负债/保单等',
            'bilibili：首页推荐流、动态、追番、我的（收藏/历史/关注/创作中心）；视频可看简介与评论',
            '相册：30张照片 + 4组回忆；相册含个人收藏/最近保存/私密/最近删除/回忆',
            '浏览器：搜索记录、打开的标签页、浏览历史（含网页正文与评论）、收藏夹、本周摘要',
            '网盘：文件袋柜、最近上传、上锁信封、与对方相关分享、语音备忘、未发出草稿、回收站',
            '设置：为该角色单独配查手机 Base URL / Key / Model / 温度，留空继承对话主 API',
            '装修：壁纸、图标、方案三栏；可改桌面小组件与 Dock',
            '购物：会员名片、在途物流、购物车、订单（支付/地址/短评）、想买清单、常逛店、优惠券、收货地址',
            '外卖：今日餐盘、进行中订单、历史订单、口味忌口、一周饮食、收藏店、优惠券、想吃清单'
          ]
        }
      ]
    },
    {
      id: 'v8.3-2026-07-19',
      version: '8.3',
      title: '今日更新',
      date: '2026-07-19',
      items: [
        '4✖️1新增纯照片',
        '自定义心声模版已上线，指路：聊天-我的-装扮与表情-自定义心声',
        '新增全局悬浮球切换api',
        '新增实心初始图标，喜欢用初始图标的可以在美化里面更换',
        '自定义布局自定义小组件已上线，可自由diy，随心搭配桌面：入口：美化-自定义布局-组件-自定义组件',
        '新增四个软件：固定布局新增p4，其中剧场app已经实装，可以自行输入想要观看的小剧场内容进行单人/多人小剧场'
      ]
    },
    {
      id: 'v8.4-2026-07-24',
      version: '8.4',
      title: '今日更新',
      date: '2026-07-24',
      items: [
        '旁白文字大小、群聊消息间距略微缩小',
        '天气软件已上线',
        '赛事软件已上线'
      ],
      sections: [
        {
          title: '天气',
          items: [
            '会请求授权地址，由浏览器读取真实所在地当前天气状况，每日更新',
            'char 会根据你那边的天气状况，每日上线时发来关心问候（弹窗关心；关心写在天气里，不进聊天）',
            '你也可以根据 char 的天气状况给 ta 送去关心 / 回复 ta'
          ]
        },
        {
          title: '赛事',
          items: [
            'char 之间来场酣畅淋漓的对决吧！你是主持人兼裁判',
            '分为单人赛和阵营赛，胜者可获得 uu 准备的专属奖品；每场比赛都支持分享给 char',
            '支持上传自定义比赛，也支持 char 发起比赛',
            '内置·咪运会：跑步、拔河、跳绳等十个体力项目，均可单独参赛决出胜负；uu 可为每一名次设置/更改奖品（有奖品或没有均可）',
            '内置·才艺大赛：唱歌、跳舞、绘画等多种才艺比拼'
          ]
        }
      ]
    },
    {
      id: 'v8.5-2026-07-30',
      version: '8.5',
      title: '今日更新',
      date: '2026-07-30',
      items: [],
      sections: [
        {
          title: '线下优化升级',
          items: [
            '多人线下已上线',
            '线下显示优化，增加正文美化',
            '线下新增悬浮状态栏，单人多人皆适配；可用内置或自定义线上心声预设，快速读取与保存',
            '已经封存的场景可以命名'
          ]
        },
        {
          title: '娱乐 App 开放',
          items: [
            '娱乐 App 已开放，目前上线「你说我猜」——群里小宝做的许愿'
          ]
        }
      ]
    }
  ];
  /* ── 开发者维护区结束 ── */

  var splashDone = false;
  var popupVisible = false;
  var popupQueued = false;
  var watchTimer = null;
  var watchUntil = 0;

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          return {
            reminderEnabled: p.reminderEnabled !== false,
            seenVersionId: p.seenVersionId || null
          };
        }
      }
    } catch (e) {}
    return { reminderEnabled: true, seenVersionId: null };
  }

  function savePrefs(partial) {
    var next = Object.assign({}, loadPrefs(), partial || {});
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return next;
  }

  function getLatestUpdate() {
    if (!UPDATE_LOG.length) return null;
    return UPDATE_LOG[UPDATE_LOG.length - 1];
  }

  function shouldShowPopup() {
    var latest = getLatestUpdate();
    if (!latest) return false;
    var prefs = loadPrefs();
    if (!prefs.reminderEnabled) return false;
    return prefs.seenVersionId !== latest.id;
  }

  function markSeen() {
    var latest = getLatestUpdate();
    if (!latest) return;
    savePrefs({ seenVersionId: latest.id });
  }

  function isSplashBlocking() {
    var el = $('miya-splash');
    if (!el || el.hidden || el.classList.contains('is-done')) return false;
    if (el.classList.contains('is-exit')) return false;
    if (document.body.classList.contains('miya-splash-active')) return true;
    if (document.documentElement.classList.contains('miya-splash-pending')) return true;
    return el.classList.contains('is-active');
  }

  function isLockBlocking() {
    if (!global.miyaIsLockActive || !global.miyaIsLockActive()) return false;
    var el = $('miya-lockscreen');
    if (!el || el.hidden) return false;
    return el.classList.contains('is-show');
  }

  function isEntryComplete() {
    return !isSplashBlocking() && !isLockBlocking();
  }

  function formatDate(str) {
    if (!str) return '';
    var m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return str;
    return m[1] + '年' + parseInt(m[2], 10) + '月' + parseInt(m[3], 10) + '日';
  }

  function renderItemRows(items, itemClass, numClass, textClass, mode) {
    return (items || []).map(function (item, i) {
      var textHtml = textClass
        ? '<span class="' + textClass + '">' + esc(item) + '</span>'
        : '<span>' + esc(item) + '</span>';
      var extra = mode === 'popup' ? ' style="--upd-i:' + i + ';"' : '';
      var highlight = mode === 'popup' && itemClass.indexOf('--sub') === -1 && i === (items.length - 1)
        ? ' miya-upd-dialog__item--highlight' : '';
      return '<li class="' + itemClass + highlight + '"' + extra + '>' +
        '<span class="' + numClass + '">' + esc(String(i + 1)) + '</span>' +
        textHtml +
      '</li>';
    }).join('');
  }

  function renderSections(sections, mode) {
    if (!sections || !sections.length) return '';
    var isPopup = mode === 'popup';
    return sections.map(function (sec, si) {
      var itemClass = isPopup ? 'miya-upd-dialog__item miya-upd-dialog__item--sub' : 'miya-upd-history__item miya-upd-history__item--sub';
      var numClass = isPopup ? 'miya-upd-dialog__num' : 'miya-upd-history__num';
      var textClass = isPopup ? 'miya-upd-dialog__text' : '';
      var titleClass = isPopup ? 'miya-upd-dialog__section-title' : 'miya-upd-history__section-title';
      var wrapClass = isPopup ? 'miya-upd-dialog__section' : 'miya-upd-history__section';
      var listClass = isPopup ? 'miya-upd-dialog__list miya-upd-dialog__list--nested' : 'miya-upd-history__list miya-upd-history__list--nested';
      var wrapStyle = isPopup ? ' style="--upd-si:' + si + ';"' : '';
      return '<div class="' + wrapClass + '"' + wrapStyle + '>' +
        (isPopup ? '<div class="miya-upd-dialog__section-glow" aria-hidden="true"></div>' : '') +
        '<h4 class="' + titleClass + '">' + esc(sec.title || '') + '</h4>' +
        '<ol class="' + listClass + '">' + renderItemRows(sec.items, itemClass, numClass, textClass, mode) + '</ol>' +
      '</div>';
    }).join('');
  }

  function renderPopupContent() {
    var latest = getLatestUpdate();
    if (!latest) return;
    var titleEl = $('miya-update-title');
    var bodyEl = $('miya-update-list');
    var dateEl = $('miya-update-date');
    var verEl = $('miya-update-ver');
    if (titleEl) titleEl.textContent = latest.title || '';
    if (dateEl) dateEl.textContent = latest.date ? formatDate(latest.date) : '';
    if (verEl) verEl.textContent = latest.version ? 'v' + latest.version : '';
    if (!bodyEl) return;
    bodyEl.innerHTML =
      '<ol class="miya-upd-dialog__list miya-upd-dialog__list--timeline">' +
        renderItemRows(latest.items, 'miya-upd-dialog__item', 'miya-upd-dialog__num', 'miya-upd-dialog__text', 'popup') +
      '</ol>' +
      renderSections(latest.sections, 'popup');
  }

  function showPopup() {
    if (popupVisible || !shouldShowPopup()) return;
    var overlay = $('miya-update-overlay');
    if (!overlay) return;
    renderPopupContent();
    popupVisible = true;
    overlay.hidden = false;
    overlay.removeAttribute('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('is-show');
      });
    });
    document.body.classList.add('miya-upd-open');
    stopWatch();
  }

  function hidePopup() {
    var overlay = $('miya-update-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-show');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('miya-upd-open');
    popupVisible = false;
    markSeen();
    setTimeout(function () {
      if (!popupVisible) {
        overlay.hidden = true;
        overlay.setAttribute('hidden', '');
      }
    }, 380);
  }

  function tryShowPopup() {
    if (popupVisible || popupQueued) return;
    if (!shouldShowPopup()) return;
    if (!splashDone && !isEntryComplete()) return;
    if (!isEntryComplete()) return;

    popupQueued = true;
    setTimeout(function () {
      popupQueued = false;
      if (!isEntryComplete()) {
        startWatch();
        return;
      }
      showPopup();
    }, 480);
  }

  function onEntryStep(step) {
    if (step === 'splash') splashDone = true;
    tryShowPopup();
    startWatch();
  }

  function onLockDismissed() {
    tryShowPopup();
    startWatch();
  }

  function bootstrapSplashDone() {
    var theme = global.miyaGetTheme ? global.miyaGetTheme() : {};
    if (theme.splashEnabled === false) splashDone = true;
  }

  function tickWatch() {
    if (popupVisible || !shouldShowPopup()) {
      stopWatch();
      return;
    }
    if (Date.now() > watchUntil) {
      stopWatch();
      return;
    }
    if (isEntryComplete()) {
      if (!splashDone) splashDone = true;
      tryShowPopup();
    }
  }

  function startWatch() {
    if (popupVisible || !shouldShowPopup()) return;
    watchUntil = Date.now() + 30000;
    if (watchTimer) return;
    watchTimer = setInterval(tickWatch, 1500);
    tickWatch();
  }

  function stopWatch() {
    if (!watchTimer) return;
    clearInterval(watchTimer);
    watchTimer = null;
  }

  function renderHistoryPanel() {
    var box = $('miya-st-updates-list');
    if (!box) return;
    if (!UPDATE_LOG.length) {
      box.innerHTML = '<p class="st-form-hint">暂无更新记录</p>';
      return;
    }
    var html = UPDATE_LOG.slice().reverse().map(function (entry, idx) {
      var isLatest = idx === 0;
      var items = (entry.items || []).map(function (item, i) {
        return '<li class="miya-upd-history__item">' +
          '<span class="miya-upd-history__num">' + esc(String(i + 1)) + '</span>' +
          '<span>' + esc(item) + '</span>' +
        '</li>';
      }).join('');
      return '<article class="miya-upd-history__card' + (isLatest ? ' is-latest' : '') + '">' +
        '<header class="miya-upd-history__head">' +
          '<div class="miya-upd-history__meta">' +
            (entry.version ? '<span class="miya-upd-history__ver">v' + esc(entry.version) + '</span>' : '') +
            (isLatest ? '<span class="miya-upd-history__tag">最新</span>' : '') +
          '</div>' +
          '<h3 class="miya-upd-history__title">' + esc(entry.title || '更新') + '</h3>' +
          (entry.date ? '<time class="miya-upd-history__date">' + esc(formatDate(entry.date)) + '</time>' : '') +
        '</header>' +
        '<ol class="miya-upd-history__list">' + items + '</ol>' +
        renderSections(entry.sections, 'history') +
      '</article>';
    }).join('');
    box.innerHTML = html;
  }

  function syncSettingsToggle() {
    var sw = $('miya-st-sw-update-remind');
    if (!sw) return;
    var on = loadPrefs().reminderEnabled;
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function setReminderEnabled(on) {
    savePrefs({ reminderEnabled: !!on });
    syncSettingsToggle();
  }

  function bindUi() {
    var closeBtn = $('miya-update-close');
    if (closeBtn) closeBtn.addEventListener('click', hidePopup);
  }

  function init() {
    bootstrapSplashDone();
    bindUi();
    syncSettingsToggle();
    startWatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaUpdateNotice = {
    onEntryStep: onEntryStep,
    onLockDismissed: onLockDismissed,
    renderHistoryPanel: renderHistoryPanel,
    syncSettingsToggle: syncSettingsToggle,
    setReminderEnabled: setReminderEnabled,
    isReminderEnabled: function () { return loadPrefs().reminderEnabled; },
    getUpdateLog: function () { return UPDATE_LOG.slice(); }
  };
})(window);
