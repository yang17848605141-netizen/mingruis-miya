/**
 * 自定义桌面小组件 · 预设库（HTML + 图片/文案槽）
 * 与自定义心声对称：结构在库里，实例槽位值在 layout item.config
 */
(function (global) {
  'use strict';

  var PRESETS_LS = 'miya-desk-custom-widget-presets-v1';
  var DRAFT_KEY = 'miya-desk-custom-widget-draft-v1';
  var FORMAT = 'miyacustomwg';
  var MAX_SLOTS = 16;
  var presetsCache = null;
  var presetsReady = null;

  var SIZE_OPTIONS = [
    { key: '4x1', w: 4, h: 1, label: '4×1' },
    { key: '4x2', w: 4, h: 2, label: '4×2' },
    { key: '4x3', w: 4, h: 3, label: '4×3' },
    { key: '4x4', w: 4, h: 4, label: '4×4' },
    { key: '2x1', w: 2, h: 1, label: '2×1' },
    { key: '2x2', w: 2, h: 2, label: '2×2' }
  ];

  var TUTORIAL_TXT =
    '自定义小组件完整教程\n' +
    '====================\n' +
    '\n' +
    '这个功能能做什么？\n' +
    '--------------------\n' +
    '你可以自己设计主屏幕上的小组件「长什么样」（HTML + CSS）和「能填什么」（图片槽 / 文案槽）。\n' +
    '版式保存在「预设库」；放到主屏后，每个实例可以单独上传多张照片、改文案，图片长期存在本机。\n' +
    '它和内置拍立得、照片墙一样：主屏点一下就能改内容。\n' +
    '\n' +
    '核心概念（只记四样）\n' +
    '--------------------\n' +
    '1. 尺寸：占主屏网格几格（如 2×2、4×2），决定出现在「添加小组件」的哪个分区\n' +
    '2. 槽位：图片槽（可多张上传）或文案槽（标题、颜色、短句等）\n' +
    '3. HTML 模板：用 {{槽位名}} 占位；图片槽会变成可填图区域\n' +
    '4. 预设：整套「名称 + 尺寸 + 槽位 + HTML + 样式」存进库，可反复放到桌面\n' +
    '\n' +
    '工作流程\n' +
    '--------------------\n' +
    '美化 → 制作自定义小组件（本页）\n' +
    '  → 写好并「保存为预设」\n' +
    '  → 回到主屏，长按进入编辑 → 点「+」添加小组件\n' +
    '  → 在对应尺寸分区找到你的自制组件并放置\n' +
    '  → 点主屏上的实例 → 上传图片 / 改文案 → 保存\n' +
    '\n' +
    '────────────────────\n' +
    '30 秒快速上手\n' +
    '────────────────────\n' +
    '第1步：点「加载示例」（会填好尺寸、槽位、HTML）\n' +
    '第2步：改一下名称，点「保存为预设」\n' +
    '第3步：退出美化，主屏长按进入编辑布局\n' +
    '第4步：点右下角「+」→ 在 2×2（或你选的尺寸）分区点自制组件\n' +
    '第5步：退出编辑后，点该组件 → 上传照片、改标题 → 保存\n' +
    '\n' +
    '────────────────────\n' +
    '各部分怎么填\n' +
    '────────────────────\n' +
    '\n' +
    '【一、名称与尺寸】\n' +
    '名称：出现在小组件库列表里，建议好认，如「我的拼贴」「双人拍立得」。\n' +
    '尺寸：必须和主屏网格对齐，且内容区左右与同列软件图标外缘对齐（系统自动内缩）。\n' +
    '主屏是 4 列网格；单行高约 78px，行距 6px；图标约 58×58。\n' +
    '组件外框由系统按「列×行」分配，HTML 写在「对齐图标后」的内容区里，不要按电脑网页大画布来排。\n' +
    '\n' +
    '各尺寸内容区大致范围（已扣图标对齐内缩；宽随手机略变，高相对固定）：\n' +
    '  · 4×1　宽约 280～360px × 高约 78px　极扁全宽条（对齐四枚图标左右外缘）\n' +
    '  · 4×2　宽约 280～360px × 高约 162px　宽卡片（约 2:1）\n' +
    '  · 4×3　宽约 280～360px × 高约 246px　约 4:3 横版\n' +
    '  · 4×4　宽约 280～360px × 高约 330px　接近正方形\n' +
    '  · 2×1　宽约 140～170px × 高约 58px　半宽横条（对齐两枚图标外缘，高度同图标）\n' +
    '  · 2×2　宽约 140～170px × 高约 162px　方卡（对齐两枚图标左右外缘）\n' +
    '\n' +
    '按尺寸排版时请遵守：\n' +
    '· 所有可见内容必须落在上表宽高内；超出部分会被裁掉，看起来像「缺了一块」\n' +
    '· 不要写死过大宽高（如 width:600px、height:400px、整屏布局）\n' +
    '· 也不要按过大画布居中一小块：格子本身就小，空太多会显得空荡\n' +
    '· 根节点用 width:100%; height:100%; box-sizing:border-box 铺满「对齐后」的内容区\n' +
    '· 内部用 % / flex / grid 分配；字号按手机控件来（常见 10～14px，标题最多约 16～18px）\n' +
    '· 4×1 / 2×1 极矮：只排一行信息，少用多层堆叠\n' +
    '· 2×2：元素宜少而大（一大图 + 一行字），避免密密麻麻小字\n' +
    '· 改尺寸后要重新「保存为预设」；已放到桌面的实例不会自动变尺寸\n' +
    '\n' +
    '【二、槽位（图片 / 文案）】\n' +
    '作用：定义这个组件「有几处可改内容」。\n' +
    '\n' +
    '图片槽：\n' +
    '· 类型选「图片」；槽位名如 photo、img1、avatar（英文或中文均可，不要空格）\n' +
    '· 显示名是编辑器里给人看的标签，如「头像」「封面」\n' +
    '· 可加多个图片槽（最多 16 个槽位合计），多张图互不影响\n' +
    '· 图片上传后存进本机 IndexedDB，长期保留；外观方案导出也会打包媒体\n' +
    '\n' +
    '文案槽：\n' +
    '· 类型选「文案」；用于标题、副标、日期、短句等\n' +
    '· 若要把颜色写进样式，也可建文案槽，在 HTML 里用 {{颜色槽名}} 接到 style 上\n' +
    '\n' +
    '规则：\n' +
    '· 槽位名不要重复；不要用下划线开头（系统保留）\n' +
    '· 槽位名必须和 HTML 里 {{槽位名}} 完全一致\n' +
    '正确：{{photo}}　　错误：{{照片}}（若槽位名是 photo）/ {photo} / {{ photo }}\n' +
    '操作：点「＋ 添加槽位」；点「删除」去掉（至少留 1 个）\n' +
    '\n' +
    '【三、样式（外壳旋钮）】\n' +
    '作用：可选。给组件最外层垫一层背景/圆角/内边距（系统不再画边框，避免手机多一圈框）。\n' +
    '· 圆角：0～28；默认 0\n' +
    '· 内边距：0～24；默认 0\n' +
    '· 背景色：transparent / #fffaf3 等；默认透明\n' +
    '若外观全写在 HTML 里，请保持圆角 0、内边距 0、背景透明。\n' +
    '改完后须重新「保存为预设」；桌面旧实例建议删掉再添加。\n' +
    '更复杂的版式请直接写在 HTML 的 <style> 里（见下一节）。\n' +
    '\n' +
    '【四、HTML 模板】（决定长什么样）\n' +
    '作用：只描述「格子里的组件本体」，不是完整网页。\n' +
    '\n' +
    '粘贴规则（很重要）：\n' +
    '· 只贴组件根节点及其内部 + 可选的 <style>…</style>\n' +
    '· 不要贴 <!DOCTYPE>、<html>、<head>、<body>、整页预览壳、演示用编辑器、按钮区\n' +
    '· 不要贴 <script>；桌面侧以静态渲染为主\n' +
    '· 若误贴了整页演示 HTML，保存时会尽量抽出组件片段，但仍建议手写干净片段\n' +
    '· 样式选择器请写在组件自己的 class 下（如 .polaroid-2x2 .title），不要写 body / html / *\n' +
    '\n' +
    '正确示例（仅组件）：\n' +
    '<style>\n' +
    '.polaroid-2x2{width:100%;height:100%;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;background:#fcf8f2;border-radius:12px;}\n' +
    '.polaroid-2x2 .pic{flex:1;min-height:0;border-radius:8px;overflow:hidden;}\n' +
    '.polaroid-2x2 .ttl{margin-top:6px;font-size:11px;}\n' +
    '</style>\n' +
    '<div class="polaroid-2x2">\n' +
    '  <div class="pic" data-miya-img="photo"></div>\n' +
    '  <div class="ttl" data-miya-text="title">今日瞬间</div>\n' +
    '</div>\n' +
    '\n' +
    '两种占位写法（任选或混用）：\n' +
    '\n' +
    'A. 双花括号（推荐新手）\n' +
    '  图片槽：写 {{photo}} → 系统自动变成可填图的方块（背景图 cover）\n' +
    '  文案槽：写 {{title}} → 填入你保存的文字（已转义，防注入）\n' +
    '\n' +
    'B. data 属性（适合保留默认字、精细控制）\n' +
    '  图片：<div class="avatar" data-miya-img="photo"></div>\n' +
    '  文案：<span data-miya-text="title">默认标题</span>\n' +
    '  说明：文案槽若尚未填写，会保留 HTML 里的默认文字；填了才覆盖。\n' +
    '\n' +
    '可写：HTML + <style>…</style>（建议把样式包在组件根 class 下，避免影响别的组件）\n' +
    '不建议依赖 <script>（桌面渲染以静态 DOM 为主；日期等可用文案槽手动填）\n' +
    '\n' +
    '最简单模板（1 图 + 1 标题）：\n' +
    '<div style="padding:8px;height:100%;box-sizing:border-box;">\n' +
    '  <div style="height:70%;border-radius:12px;overflow:hidden;">{{photo}}</div>\n' +
    '  <p style="margin:8px 0 0;font-size:12px;">{{title}}</p>\n' +
    '</div>\n' +
    '\n' +
    '多图横排示例：\n' +
    '<div style="display:flex;gap:6px;height:100%;padding:6px;box-sizing:border-box;">\n' +
    '  <div style="flex:1;border-radius:8px;overflow:hidden;">{{photo1}}</div>\n' +
    '  <div style="flex:1;border-radius:8px;overflow:hidden;">{{photo2}}</div>\n' +
    '  <div style="flex:1;border-radius:8px;overflow:hidden;">{{photo3}}</div>\n' +
    '</div>\n' +
    '\n' +
    '文案接到样式示例（先建文案槽 accent）：\n' +
    '<div style="color:{{accent}};padding:8px;">{{title}}</div>\n' +
    '\n' +
    '外链装饰图（固定资源，不必建槽）：\n' +
    '<img src="https://example.com/deco.png" alt="" style="width:40px;">\n' +
    '\n' +
    '布局提示：\n' +
    '· 根节点务必 width:100%; height:100%; box-sizing:border-box，铺满格子\n' +
    '· 根节点不要再写 aspect-ratio（格子高宽已定；再写比例容易把内容挤出裁切）\n' +
    '· 图片区用 flex:1; min-height:0 吃剩余高度，不要再给图片区写死正方形 aspect-ratio 去抢高度\n' +
    '· 用 flex / grid 做左右分栏；图片容器设 overflow:hidden + border-radius\n' +
    '· 字号用较小 px 或 clamp()；2×2 / 2×1 里避免超过约 14px 的大段正文\n' +
    '· 先对照所选尺寸的宽高范围画版式，再写 HTML；预览区比例与真机格子一致，以预览为准微调\n' +
    '· 装饰图若用外链 <img>，给明确小尺寸（如 width:28px），不要让大图把格子撑破\n' +
    '\n' +
    '【五、预览样例】\n' +
    '作用：本地假数据看模板效果，不会写进桌面实例。\n' +
    '改文案槽旁的预览输入，下方预览区会刷新。\n' +
    '图片槽在预览里是空槽位；真正填图请放到主屏后再点组件上传。\n' +
    '\n' +
    '【六、预设库】\n' +
    '· 保存为预设：写入全局库；主屏添加列表立刻可看到\n' +
    '· 读取预设：用库里内容覆盖当前编辑区\n' +
    '· 删除预设：从库移除（已放在桌面上的实例仍保留当时快照的 HTML，一般还能显示）\n' +
    '· 保存草稿：只记本页编辑进度，不等于预设，主屏看不到\n' +
    '· 导出 JSON：单独分享一个组件（format 为 miyacustomwg）\n' +
    '· 导入 JSON：自动识别 miyacustomwg；也可一次导入多个\n' +
    '\n' +
    '────────────────────\n' +
    '放到主屏幕\n' +
    '────────────────────\n' +
    '1. 确认美化里布局模式是「自定义布局」\n' +
    '2. 回到主屏，长按空白处进入编辑（图标会晃）\n' +
    '3. 点「+」打开小组件库\n' +
    '4. 滚到你保存时选的尺寸分区（如 4×2）\n' +
    '5. 点名称带「自制 ·」的那一项；当前页要有足够空位\n' +
    '6. 退出编辑 → 点该组件打开编辑器 → 上传 / 链接 / 清除图片，改文案 → 保存\n' +
    '\n' +
    '入口备忘：\n' +
    '· 美化 → 组件 →「制作自定义小组件」（本二级页）\n' +
    '· 美化 → 组件 →「导入小组件 JSON」\n' +
    '· 主屏小组件库右上角「自定义」也可进本页\n' +
    '\n' +
    '────────────────────\n' +
    '导入 / 导出\n' +
    '────────────────────\n' +
    '【单独导出一个组件】\n' +
    '本页「导出 JSON」→ 得到 miyacustomwg-名称.json\n' +
    '内容含：名称、尺寸、槽位、HTML、样式（不含已上传的照片本体）\n' +
    '\n' +
    '【单独导入】\n' +
    '本页「导入 JSON」或美化组件页「导入小组件 JSON」\n' +
    '识别 format: "miyacustomwg"（无 format 但带 htmlTemplate + slots 也会尝试解析）\n' +
    '导入后请再点「保存为预设」，才会进库并出现在添加列表\n' +
    '\n' +
    '【整套外观方案】\n' +
    '美化 → 方案 → 导出 / 导入 JSON（自定义布局包）\n' +
    '会带上：壁纸、图标、布局、各组件实例的图片，以及自定义小组件整库\n' +
    '换机迁移优先用外观方案，而不是只导单个组件\n' +
    '\n' +
    '────────────────────\n' +
    '和内置组件的差别\n' +
    '────────────────────\n' +
    '· 内置：版式写死在 App 里，只能改配置里的图和字\n' +
    '· 自定义：版式由你 HTML 决定，槽位可增减，可导出分享\n' +
    '· 填图方式相同：点组件 → 上传 / 粘贴链接\n' +
    '\n' +
    '────────────────────\n' +
    '常见问题\n' +
    '────────────────────\n' +
    'Q：保存了预设，添加列表里找不到？\n' +
    'A：看你选的尺寸分区对不对；确认已点「保存为预设」而不是只「保存草稿」；下拉刷新打开小组件库再试。\n' +
    '\n' +
    'Q：桌面上只看到一部分 / 字被裁掉 / 看起来空荡？\n' +
    'A：多半是版式超出或远小于所选尺寸，或误贴了整页 HTML（含预览壳、演示控件）。对照尺寸表；根节点用 100% + flex；去掉根节点 / 图片区的 aspect-ratio；外壳圆角内边距边框先全关。只保留组件片段后重新保存预设。\n' +
    '\n' +
    'Q：外面多了一层透明方框 / 细边？\n' +
    'A：系统外壳边框已关闭。若仍看见，多半是手机缓存了旧 CSS：强刷或清站点数据后再进。桌面旧实例删掉重加。圆角卡片四角透出壁纸是正常的，不是外框。\n' +
    '\n' +
    'Q：{{photo}} 没有变成图？\n' +
    'A：确认有同名「图片」槽位；放到主屏后要点组件上传；预览区本来就不显示真实照片。\n' +
    '\n' +
    'Q：占位符没被替换？\n' +
    'A：检查 {{槽位名}} 与槽位名完全一致（区分大小写）；不要写成单括号或带空格。\n' +
    '\n' +
    'Q：文案改了桌面没变？\n' +
    'A：改的是预设模板还是实例？改模板需重新保存预设；改桌面内容需点主屏实例保存。已放置实例用的是放置时的 HTML 快照。\n' +
    '\n' +
    'Q：当前页没有足够空间？\n' +
    'A：左滑增加空白页，或挪开占位图标/其他组件后再添加。\n' +
    '\n' +
    'Q：颜色文案槽填了不生效？\n' +
    'A：必须在 HTML 里用到该槽，例如 style="color:{{accent}}"，并在主屏实例编辑器里填写并保存。\n' +
    '\n' +
    'Q：能不能写 JavaScript？\n' +
    'A：桌面侧以静态渲染为主，不要依赖 script 做关键逻辑；动态日期请用文案槽。\n' +
    '\n' +
    'Q：分享给别人照片还在吗？\n' +
    'A：单独导出 JSON 不含照片；对方导入后需自己重新上传。整套外观方案导出会带媒体。\n';

  var EXAMPLE_HTML_2X2 =
    '<div class="wg-custom-demo wg-custom-demo--2x2">' +
    '<div class="wg-custom-demo__photo">{{photo}}</div>' +
    '<p class="wg-custom-demo__title">{{title}}</p>' +
    '<p class="wg-custom-demo__note">{{note}}</p>' +
    '</div>';

  var EXAMPLE_HTML_4X2 =
    '<div class="wg-custom-demo wg-custom-demo--4x2">' +
    '<div class="wg-custom-demo__grid">' +
    '<div class="wg-custom-demo__cell">{{photo1}}</div>' +
    '<div class="wg-custom-demo__cell">{{photo2}}</div>' +
    '<div class="wg-custom-demo__cell">{{photo3}}</div>' +
    '</div>' +
    '<p class="wg-custom-demo__caption">{{caption}}</p>' +
    '</div>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function genId(prefix) {
    return (
      (prefix || 'cwg') +
      '_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function findSizeOption(keyOrWH) {
    var key = String(keyOrWH || '').trim();
    var i;
    for (i = 0; i < SIZE_OPTIONS.length; i++) {
      if (SIZE_OPTIONS[i].key === key) return SIZE_OPTIONS[i];
    }
    var m = key.match(/^(\d+)x(\d+)$/i);
    if (m) {
      for (i = 0; i < SIZE_OPTIONS.length; i++) {
        if (SIZE_OPTIONS[i].w === +m[1] && SIZE_OPTIONS[i].h === +m[2]) {
          return SIZE_OPTIONS[i];
        }
      }
    }
    return SIZE_OPTIONS[5]; /* 2x2 */
  }

  function normalizeSlot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var key = String(raw.key || raw.name || '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40);
    if (!key || key.charAt(0) === '_') return null;
    if (!/^[A-Za-z\u4e00-\u9fff_][\w\u4e00-\u9fff]*$/.test(key)) return null;
    var type = raw.type === 'text' ? 'text' : 'image';
    return {
      key: key,
      type: type,
      label: String(raw.label || key).trim().slice(0, 40),
      maxLength: type === 'text' ? Math.min(200, Math.max(4, parseInt(raw.maxLength, 10) || 48)) : undefined
    };
  }

  function normalizeStyleHints(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var radius = parseInt(raw.radius, 10);
    if (isNaN(radius) || radius < 0) radius = 0;
    if (radius > 28) radius = 28;
    var padding = parseInt(raw.padding, 10);
    if (isNaN(padding) || padding < 0) padding = 0;
    if (padding > 24) padding = 24;
    var bg = String(raw.bg || '').trim().slice(0, 40);
    if (!bg) bg = 'transparent';
    var border = String(raw.border != null ? raw.border : 'none').trim();
    if (['none', 'soft', 'strong'].indexOf(border) < 0) border = 'none';
    return { radius: radius, padding: padding, bg: bg, border: border };
  }

  function normalizePresetRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim().slice(0, 60);
    if (!name) return null;
    var size = findSizeOption(raw.size || raw.sizeKey || raw.w + 'x' + raw.h);
    var slots = Array.isArray(raw.slots) ? raw.slots.map(normalizeSlot).filter(Boolean) : [];
    var seen = {};
    slots = slots.filter(function (s) {
      if (seen[s.key]) return false;
      seen[s.key] = true;
      return true;
    }).slice(0, MAX_SLOTS);
    if (!slots.length) {
      slots = [{ key: 'photo', type: 'image', label: '照片' }];
    }
    var id = String(raw.id || '').trim();
    if (!id) id = genId('cwg');
    return {
      id: id,
      name: name,
      size: size.key,
      w: size.w,
      h: size.h,
      slots: slots,
      htmlTemplate: sanitizeHtmlTemplate(String(raw.htmlTemplate || '')).slice(0, 200000),
      styleHints: normalizeStyleHints(raw.styleHints),
      savedAt: raw.savedAt || Date.now()
    };
  }

  function catalogWidgetId(presetId) {
    return 'custom_lib_' + String(presetId || '').trim();
  }

  function parseCatalogWidgetId(widgetId) {
    var id = String(widgetId || '');
    if (id.indexOf('custom_lib_') !== 0) return null;
    return id.slice('custom_lib_'.length) || null;
  }

  function hydratePresetsSync() {
    if (presetsCache) return presetsCache;
    var raw = null;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      raw = global.miyaSyncReadJsonKey(PRESETS_LS);
    }
    if (!Array.isArray(raw)) {
      try {
        var ls = localStorage.getItem(PRESETS_LS);
        if (ls) raw = JSON.parse(ls);
      } catch (eLs) {
        raw = null;
      }
    }
    if (Array.isArray(raw)) {
      presetsCache = raw.map(normalizePresetRow).filter(Boolean);
      return presetsCache;
    }
    return null;
  }

  function whenPresetsReady() {
    if (presetsReady) return presetsReady;
    var chain =
      typeof global.miyaReadLsJsonKey === 'function'
        ? global.miyaReadLsJsonKey(PRESETS_LS, [])
        : Promise.resolve([]);
    presetsReady = chain
      .then(function (parsed) {
        if (!Array.isArray(parsed)) parsed = [];
        presetsCache = parsed.map(normalizePresetRow).filter(Boolean);
        if (!presetsCache.length) {
          /* 空读只给内存种子，禁止落盘——否则会盖掉尚未 hydrate 完的用户组件库 */
          presetsCache = buildSeedPresets();
        }
        return presetsCache.slice();
      })
      .catch(function () {
        presetsCache = buildSeedPresets();
        return presetsCache.slice();
      });
    return presetsReady;
  }

  function buildSeedPresets() {
    return [
      normalizePresetRow({
        id: 'cwg_seed_polaroid',
        name: '自定义·拍立得卡',
        size: '2x2',
        slots: [
          { key: 'photo', type: 'image', label: '照片' },
          { key: 'title', type: 'text', label: '标题', maxLength: 24 },
          { key: 'note', type: 'text', label: '副文', maxLength: 40 }
        ],
        htmlTemplate: EXAMPLE_HTML_2X2,
        styleHints: { radius: 16, padding: 8, bg: '#fffaf3', border: 'soft' }
      }),
      normalizePresetRow({
        id: 'cwg_seed_strip',
        name: '自定义·三联横条',
        size: '4x2',
        slots: [
          { key: 'photo1', type: 'image', label: '图 1' },
          { key: 'photo2', type: 'image', label: '图 2' },
          { key: 'photo3', type: 'image', label: '图 3' },
          { key: 'caption', type: 'text', label: '说明', maxLength: 40 }
        ],
        htmlTemplate: EXAMPLE_HTML_4X2,
        styleHints: { radius: 14, padding: 6, bg: 'rgba(255,255,255,0.72)', border: 'soft' }
      })
    ].filter(Boolean);
  }

  function loadPresets() {
    var hydrated = hydratePresetsSync();
    if (hydrated) return hydrated.slice();
    return [];
  }

  function persistPresets(list) {
    presetsCache = Array.isArray(list) ? list.slice() : [];
    presetsReady = null;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(PRESETS_LS, presetsCache).then(function () {
        notifyCatalogChanged();
        return presetsCache.slice();
      });
    }
    try {
      localStorage.setItem(PRESETS_LS, JSON.stringify(presetsCache));
    } catch (e) {}
    notifyCatalogChanged();
    return Promise.resolve(presetsCache.slice());
  }

  function notifyCatalogChanged() {
    try {
      if (typeof global.miyaSyncCustomWidgetCatalog === 'function') {
        global.miyaSyncCustomWidgetCatalog();
      }
    } catch (e) {}
  }

  function findPresetById(id) {
    var key = String(id || '').trim();
    if (!key) return null;
    return (
      loadPresets().find(function (p) {
        return p.id === key;
      }) || null
    );
  }

  function findPresetByName(name) {
    var label = String(name || '').trim();
    if (!label) return null;
    return (
      loadPresets().find(function (p) {
        return p.name === label;
      }) || null
    );
  }

  function savePreset(name, state, opts) {
    opts = opts || {};
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    var keepId = opts.id || (state && state.id) || '';
    var row = normalizePresetRow(
      Object.assign({}, state || {}, {
        id: keepId || genId('cwg'),
        name: label,
        savedAt: Date.now()
      })
    );
    if (!row) return Promise.reject(new Error('invalid_preset'));
    return whenPresetsReady().then(function (list) {
      var next = list.filter(function (p) {
        return p.id !== row.id && p.name !== row.name;
      });
      next.unshift(row);
      return persistPresets(next).then(function () {
        return findPresetById(row.id);
      });
    });
  }

  function deletePreset(idOrName) {
    var key = String(idOrName || '').trim();
    if (!key) return Promise.reject(new Error('empty_name'));
    return whenPresetsReady().then(function (list) {
      var next = list.filter(function (p) {
        return p.id !== key && p.name !== key;
      });
      if (next.length === list.length) return Promise.reject(new Error('not_found'));
      return persistPresets(next);
    });
  }

  function replaceAllPresets(list) {
    var next = (Array.isArray(list) ? list : []).map(normalizePresetRow).filter(Boolean);
    if (!next.length) next = buildSeedPresets();
    return persistPresets(next);
  }

  function mergePresets(list, mode) {
    mode = mode || 'upsert';
    return whenPresetsReady().then(function (cur) {
      var map = {};
      cur.forEach(function (p) {
        map[p.id] = p;
      });
      (Array.isArray(list) ? list : []).forEach(function (raw) {
        var row = normalizePresetRow(raw);
        if (!row) return;
        if (mode === 'replace') {
          map[row.id] = row;
          return;
        }
        var byName = null;
        Object.keys(map).some(function (id) {
          if (map[id].name === row.name) {
            byName = map[id];
            return true;
          }
          return false;
        });
        if (map[row.id]) {
          row.id = map[row.id].id;
          map[row.id] = row;
        } else if (byName) {
          row.id = byName.id;
          map[row.id] = row;
        } else {
          map[row.id] = row;
        }
      });
      var out = Object.keys(map).map(function (k) {
        return map[k];
      });
      out.sort(function (a, b) {
        return (b.savedAt || 0) - (a.savedAt || 0);
      });
      return persistPresets(out);
    });
  }

  function getLibrarySnapshot() {
    return loadPresets().map(function (p) {
      return {
        id: p.id,
        name: p.name,
        size: p.size,
        w: p.w,
        h: p.h,
        slots: p.slots.map(function (s) {
          return { key: s.key, type: s.type, label: s.label, maxLength: s.maxLength };
        }),
        htmlTemplate: p.htmlTemplate,
        styleHints: Object.assign({}, p.styleHints),
        savedAt: p.savedAt
      };
    });
  }

  function buildInstanceConfig(preset, existing) {
    var row = normalizePresetRow(preset);
    if (!row) return existing && typeof existing === 'object' ? Object.assign({}, existing) : {};
    var out = existing && typeof existing === 'object' ? Object.assign({}, existing) : {};
    out._presetId = row.id;
    out._presetName = row.name;
    out._size = row.size;
    out._w = row.w;
    out._h = row.h;
    out._slots = row.slots.map(function (s) {
      return { key: s.key, type: s.type, label: s.label, maxLength: s.maxLength };
    });
    out._htmlTemplate = row.htmlTemplate;
    out._styleHints = Object.assign({}, row.styleHints);
    row.slots.forEach(function (s) {
      if (!Object.prototype.hasOwnProperty.call(out, s.key)) {
        out[s.key] = s.type === 'text' ? '' : null;
      }
    });
    return out;
  }

  function resolvePresetFromConfig(cfg) {
    cfg = cfg || {};
    if (cfg._presetId) {
      var live = findPresetById(cfg._presetId);
      if (live) return live;
    }
    if (cfg._htmlTemplate || (cfg._slots && cfg._slots.length)) {
      return normalizePresetRow({
        id: cfg._presetId || genId('cwg_snap'),
        name: cfg._presetName || '自定义',
        size: cfg._size || cfg._w + 'x' + cfg._h,
        w: cfg._w,
        h: cfg._h,
        slots: cfg._slots,
        htmlTemplate: cfg._htmlTemplate,
        styleHints: cfg._styleHints
      });
    }
    return null;
  }

  function editorFieldsFromConfig(cfg) {
    var preset = resolvePresetFromConfig(cfg);
    var slots = (preset && preset.slots) || (cfg && cfg._slots) || [];
    return slots.map(function (s) {
      return {
        key: s.key,
        type: s.type === 'text' ? 'text' : 'image',
        label: s.label || s.key,
        maxLength: s.maxLength || 48,
        multiline: s.type === 'text' && (s.maxLength || 48) > 32
      };
    });
  }

  function scrubInjectedCss(css) {
    var out = String(css || '');
    /* 去掉会污染整机桌面的全局规则 */
    out = out.replace(/(^|})\s*(html|body|\*)\s*\{[^}]*\}/gi, '$1');
    out = out.replace(
      /(^|})\s*\.(preview-wrapper|preview-label|demo-controls|demo-row|demo-row\s+label|btn-group|btn|btn-primary|btn-outline|badge|footnote|flex-row)[^{]*\{[^}]*\}/gi,
      '$1'
    );
    return out.trim();
  }

  function extractStylesFromHtml(html) {
    var styles = [];
    String(html || '').replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (_, css) {
      var cleaned = scrubInjectedCss(css);
      if (cleaned) styles.push(cleaned);
      return '';
    });
    return styles;
  }

  function extractBodyHtml(html) {
    var raw = String(html || '');
    var m = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (m) return m[1];
    if (/<!DOCTYPE|<html[\s>]/i.test(raw)) {
      return raw
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<\/?body[^>]*>/gi, '');
    }
    return raw;
  }

  /**
   * 从整页演示 HTML 里抽出可上桌的组件片段（去掉预览壳、演示控件、script）
   */
  function extractWidgetFragment(html) {
    var raw = String(html || '');
    var styles = extractStylesFromHtml(raw);
    var bodyHtml = extractBodyHtml(raw)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    if (typeof document === 'undefined') {
      return (styles.length ? '<style>' + styles.join('\n') + '</style>' : '') + bodyHtml;
    }

    var box = document.createElement('div');
    box.innerHTML = bodyHtml;
    box.querySelectorAll('script, .demo-controls, .preview-label, .footnote').forEach(function (n) {
      n.remove();
    });

    var root = null;
    var wrap = box.querySelector('.preview-wrapper');
    if (wrap) {
      var kids = Array.prototype.slice.call(wrap.children);
      kids = kids.filter(function (el) {
        return !/(preview-label|demo-controls|footnote)/i.test(el.className || '');
      });
      if (kids.length === 1) root = kids[0];
      else if (kids.length > 1) {
        var frag = document.createElement('div');
        frag.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
        kids.forEach(function (k) {
          frag.appendChild(k);
        });
        root = frag;
      }
    }
    if (!root) {
      var hit = box.querySelector('[data-miya-img], [data-miya-text]');
      if (hit) {
        root = hit;
        while (
          root.parentElement &&
          root.parentElement !== box &&
          root.parentElement.children.length === 1
        ) {
          root = root.parentElement;
        }
      } else if (box.children.length === 1) {
        root = box.firstElementChild;
      }
    }

    var fragment = root ? root.outerHTML : box.innerHTML;
    var styleBlock = styles.length ? '<style>' + styles.join('\n') + '</style>' : '';
    return (styleBlock + fragment).trim();
  }

  function sanitizeHtmlTemplate(html) {
    var raw = String(html || '');
    if (/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(raw)) {
      raw = extractWidgetFragment(raw);
    }
    return raw
      .replace(/<\/script/gi, '<\\/script')
      .replace(/on\w+\s*=/gi, 'data-stripped=');
  }

  function escapeFieldValue(v) {
    return esc(v);
  }

  /**
   * 渲染模板：图片槽 → data-miya-img 节点；文案槽 → 转义文本
   */
  function renderTemplateHtml(htmlTemplate, slots, values) {
    var slotMap = {};
    (slots || []).forEach(function (s) {
      slotMap[s.key] = s;
    });
    var map = values && typeof values === 'object' ? values : {};
    var src = sanitizeHtmlTemplate(htmlTemplate);
    if (!String(src).trim()) {
      src =
        '<div class="wg-custom__fallback">' +
        (slots || [])
          .map(function (s) {
            if (s.type === 'image') {
              return '<div class="wg-custom__img" data-miya-img="' + esc(s.key) + '"></div>';
            }
            return '<p class="wg-custom__text" data-miya-text="' + esc(s.key) + '"></p>';
          })
          .join('') +
        '</div>';
    }
    return src.replace(/\{\{([^{}]+)\}\}/g, function (_, rawName) {
      var key = String(rawName || '').trim();
      if (!key) return '';
      var slot = slotMap[key];
      if (slot && slot.type === 'image') {
        return (
          '<div class="wg-custom__img" data-miya-img="' +
          esc(key) +
          '" role="img" aria-label="' +
          esc(slot.label || key) +
          '"></div>'
        );
      }
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        return escapeFieldValue(map[key]);
      }
      if (slot && slot.type === 'text') {
        return (
          '<span class="wg-custom__text" data-miya-text="' + esc(key) + '"></span>'
        );
      }
      return '';
    });
  }

  function applyStyleHintsToEl(el, hints) {
    if (!el) return;
    hints = normalizeStyleHints(hints);
    /* 系统外壳禁止再画边框（旧预设 soft/strong 在手机上就是那圈「外框」） */
    hints.border = 'none';
    var bg = String(hints.bg || 'transparent').trim().toLowerCase();
    var isTransparent = !bg || bg === 'transparent' || bg === 'none';
    /* 旧默认：透明底 + 圆角 + 内边距 → 看起来像空心方框，自动拆除 */
    if (isTransparent && (hints.radius > 0 || hints.padding > 0)) {
      hints.radius = 0;
      hints.padding = 0;
    }
    el.style.setProperty('--wg-custom-radius', hints.radius + 'px');
    el.style.setProperty('--wg-custom-pad', hints.padding + 'px');
    el.style.setProperty('--wg-custom-bg', hints.bg || 'transparent');
    el.setAttribute('data-wg-custom-border', 'none');
    var hasShell =
      hints.radius > 0 ||
      hints.padding > 0 ||
      (!isTransparent);
    el.setAttribute('data-wg-has-shell', hasShell ? '1' : '0');
  }

  function getCatalogEntries() {
    return loadPresets().map(function (p) {
      return {
        widgetId: catalogWidgetId(p.id),
        w: p.w,
        h: p.h,
        size: p.size,
        label: p.name,
        widget: 'custom',
        editable: true,
        customPresetId: p.id
      };
    });
  }

  /* ── 草稿 / 编辑器 ── */

  function defaultDraft() {
    return {
      name: '',
      size: '2x2',
      slots: [
        { key: 'photo', type: 'image', label: '照片' },
        { key: 'title', type: 'text', label: '标题', maxLength: 24 }
      ],
      htmlTemplate: EXAMPLE_HTML_2X2,
      styleHints: { radius: 0, padding: 0, bg: 'transparent', border: 'none' },
      sampleValues: { title: '慢一点' },
      presetPick: '',
      id: ''
    };
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return defaultDraft();
      var parsed = JSON.parse(raw);
      var row = normalizePresetRow(
        Object.assign({}, parsed, { name: parsed.name || '草稿', id: parsed.id || 'draft' })
      );
      if (!row) return defaultDraft();
      return {
        name: parsed.name || '',
        size: row.size,
        slots: row.slots,
        htmlTemplate: row.htmlTemplate,
        styleHints: row.styleHints,
        sampleValues: parsed.sampleValues && typeof parsed.sampleValues === 'object' ? parsed.sampleValues : {},
        presetPick: String(parsed.presetPick || ''),
        id: String(parsed.id || '')
      };
    } catch (e) {
      return defaultDraft();
    }
  }

  function saveDraft(state) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state || defaultDraft()));
    } catch (e) {}
  }

  function buildSlotRowHtml(slot, index) {
    slot = slot || { key: '', type: 'image', label: '' };
    return (
      '<div class="mi-cwg-tpl__slot" data-mq-cwg-slot data-idx="' +
      index +
      '">' +
      '<label class="mi-cwg-tpl-label">槽位名' +
      '<input type="text" class="mi-input mi-cwg-tpl-input" data-mq-cwg-skey maxlength="40" value="' +
      esc(slot.key) +
      '" placeholder="photo1">' +
      '</label>' +
      '<label class="mi-cwg-tpl-label">显示名' +
      '<input type="text" class="mi-input mi-cwg-tpl-input" data-mq-cwg-slabel maxlength="40" value="' +
      esc(slot.label || '') +
      '" placeholder="主图">' +
      '</label>' +
      '<label class="mi-cwg-tpl-label">类型' +
      '<select class="mi-input" data-mq-cwg-stype>' +
      '<option value="image"' +
      (slot.type !== 'text' ? ' selected' : '') +
      '>图片</option>' +
      '<option value="text"' +
      (slot.type === 'text' ? ' selected' : '') +
      '>文案</option>' +
      '</select>' +
      '</label>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-slot-del aria-label="删除槽位">删除</button>' +
      '</div>'
    );
  }

  function buildSizeOptionsHtml(selected) {
    return SIZE_OPTIONS.map(function (opt) {
      return (
        '<option value="' +
        opt.key +
        '"' +
        (opt.key === selected ? ' selected' : '') +
        '>' +
        opt.label +
        '</option>'
      );
    }).join('');
  }

  function buildPresetSelectOptions(pick) {
    var list = loadPresets();
    var html = '<option value="">选择已存预设…</option>';
    list.forEach(function (p) {
      html +=
        '<option value="' +
        esc(p.id) +
        '"' +
        (p.id === pick ? ' selected' : '') +
        '>' +
        esc(p.name) +
        ' · ' +
        esc(p.size) +
        '</option>';
    });
    return html;
  }

  function buildEditorHtml(draft) {
    draft = draft || loadDraft();
    var slotsHtml = (draft.slots || []).map(buildSlotRowHtml).join('');
    var sampleRows = (draft.slots || [])
      .filter(function (s) {
        return s.type === 'text';
      })
      .map(function (s) {
        var v = (draft.sampleValues && draft.sampleValues[s.key]) || '';
        return (
          '<label class="mi-cwg-tpl-label">预览·' +
          esc(s.label || s.key) +
          '<input type="text" class="mi-input mi-cwg-tpl-input" data-mq-cwg-sample="' +
          esc(s.key) +
          '" value="' +
          esc(v) +
          '" placeholder="预览用文字">' +
          '</label>'
        );
      })
      .join('');
    var sh = draft.styleHints || normalizeStyleHints({});
    return (
      '<div class="mi-me-flow mi-cwg-tpl" data-mq-cwg-tpl-root>' +
      '<p class="mi-me-lead">用 HTML 自定义桌面小组件版式；图片槽可上传多张并长期保存。保存后出现在主屏「添加小组件」对应尺寸分区。</p>' +
      '<details class="mi-cwg-tpl-guide">' +
      '<summary class="mi-cwg-tpl-guide__sum">' +
      '<span>完整教程</span><span>默认折叠 · 点开查看</span>' +
      '</summary>' +
      '<div class="mi-cwg-tpl-guide__body">' +
      '<div class="mi-cwg-tpl-guide__actions">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-guide-copy>复制教程</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-guide-dl>下载为 txt</button>' +
      '</div>' +
      '<pre class="mi-cwg-tpl-guide__pre" data-mq-cwg-guide-text>' +
      esc(TUTORIAL_TXT) +
      '</pre>' +
      '</div>' +
      '</details>' +
      '<div class="mi-cwg-tpl__toolbar">' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-example>加载示例</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-clear>清空</button>' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-cwg-save-draft>保存草稿</button>' +
      '</div>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">名称与尺寸</h3>' +
      '<label class="mi-cwg-tpl-label">预设名称' +
      '<input type="text" class="mi-input" data-mq-cwg-name maxlength="60" value="' +
      esc(draft.name || '') +
      '" placeholder="例如：我的拼贴">' +
      '</label>' +
      '<label class="mi-cwg-tpl-label">网格尺寸' +
      '<select class="mi-input" data-mq-cwg-size>' +
      buildSizeOptionsHtml(draft.size || '2x2') +
      '</select>' +
      '</label>' +
      '</section>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">槽位（图片 / 文案）</h3>' +
      '<p class="mi-empty-hint">图片槽支持多张上传，点主屏实例即可填图；文案槽用 {{槽位名}} 写入模板</p>' +
      '<div class="mi-cwg-tpl__slots" data-mq-cwg-slots>' +
      slotsHtml +
      '</div>' +
      '<button type="button" class="mi-btn mi-btn--ghost mi-btn--block" data-mq-cwg-slot-add>＋ 添加槽位</button>' +
      '</section>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">样式</h3>' +
      '<p class="mi-empty-hint">外壳边框已关闭（避免手机多一圈框）。圆角/内边距/背景仅在需要「系统垫一层」时使用；外观请写在 HTML 里。</p>' +
      '<div class="mi-cwg-tpl__style-row">' +
      '<label class="mi-cwg-tpl-label">圆角' +
      '<input type="number" class="mi-input" data-mq-cwg-radius min="0" max="28" value="' +
      esc(sh.radius) +
      '">' +
      '</label>' +
      '<label class="mi-cwg-tpl-label">内边距' +
      '<input type="number" class="mi-input" data-mq-cwg-padding min="0" max="24" value="' +
      esc(sh.padding) +
      '">' +
      '</label>' +
      '<label class="mi-cwg-tpl-label">背景色' +
      '<input type="text" class="mi-input" data-mq-cwg-bg value="' +
      esc(sh.bg) +
      '" placeholder="transparent / #fff">' +
      '</label>' +
      '<input type="hidden" data-mq-cwg-border value="none">' +
      '</div>' +
      '</section>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">HTML 模板</h3>' +
      '<p class="mi-empty-hint">只贴组件片段（不要整页 html/body/演示控件）。{{photo}} 会变成可填图区域；也可用 data-miya-img / data-miya-text。外观自带圆角时，上方样式边框请选「无」。</p>' +
      '<textarea class="mi-input mi-input--area mi-cwg-tpl__ta" data-mq-cwg-html rows="10" placeholder="<div>{{photo}}</div><p>{{title}}</p>">' +
      esc(draft.htmlTemplate || '') +
      '</textarea>' +
      '</section>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">预览样例</h3>' +
      '<div data-mq-cwg-samples>' +
      sampleRows +
      '</div>' +
      '<div class="mi-cwg-tpl__preview" data-mq-cwg-preview></div>' +
      '</section>' +
      '<section class="mi-cwg-tpl__section">' +
      '<h3 class="mi-cwg-tpl__h">预设库</h3>' +
      '<select class="mi-input" data-mq-cwg-preset-pick>' +
      buildPresetSelectOptions(draft.presetPick || '') +
      '</select>' +
      '<div class="mi-cwg-tpl__vault-btns">' +
      '<button type="button" class="mi-btn mi-btn--dark" data-mq-cwg-preset-save>保存为预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-preset-load>读取预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-preset-delete>删除预设</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-preset-export>导出 JSON</button>' +
      '<button type="button" class="mi-btn mi-btn--ghost" data-mq-cwg-preset-import>导入 JSON</button>' +
      '</div>' +
      '<input type="file" accept="application/json,.json" hidden multiple data-mq-cwg-preset-import-file>' +
      '<input type="hidden" data-mq-cwg-id value="' +
      esc(draft.id || '') +
      '">' +
      '</section>' +
      '</div>'
    );
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('read_failed'));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  /**
   * 批量解析自定义小组件 JSON：单条用文件名作预设名，列表内保留各自名字；
   * 逐个自动写入预设库。
   */
  function importCustomWidgetFiles(files) {
    var fileArr = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!fileArr.length) {
      return Promise.resolve({ ok: 0, fail: 0, items: [] });
    }
    var fail = 0;
    var collected = [];
    /* 逐个读取，再一次性合并落库（内部按名字 upsert） */
    return fileArr
      .reduce(function (chain, file) {
        return chain.then(function () {
          return readFileText(file)
            .then(function (text) {
              var parsed = parseImportAuto(text);
              if (!parsed) {
                fail += 1;
                return;
              }
              var items = [];
              if (parsed.kind === 'list') {
                items = parsed.items.slice();
              } else if (parsed.item) {
                applyImportFileName(parsed.item, file);
                if (!String(parsed.item.name || '').trim()) {
                  parsed.item.name = '导入小组件';
                }
                items = [parsed.item];
              }
              if (!items.length) {
                fail += 1;
                return;
              }
              items.forEach(function (item) {
                if (!item || !String(item.name || '').trim()) return;
                collected.push(item);
              });
            })
            .catch(function () {
              fail += 1;
            });
        });
      }, Promise.resolve())
      .then(function () {
        if (!collected.length) {
          return { ok: 0, fail: fail || fileArr.length, items: [] };
        }
        /* 串行 savePreset，确保每一个都成功写入 */
        return collected
          .reduce(function (chain, item) {
            return chain.then(function (acc) {
              return savePreset(item.name, item)
                .then(function (saved) {
                  acc.push(saved || item);
                  return acc;
                })
                .catch(function () {
                  fail += 1;
                  return acc;
                });
            });
          }, Promise.resolve([]))
          .then(function (savedItems) {
            return {
              ok: savedItems.length,
              fail: fail,
              items: savedItems
            };
          });
      });
  }

  function readEditorState(root) {
    if (!root) return defaultDraft();
    var slots = [];
    root.querySelectorAll('[data-mq-cwg-slot]').forEach(function (row) {
      var key = String((row.querySelector('[data-mq-cwg-skey]') || {}).value || '').trim();
      var label = String((row.querySelector('[data-mq-cwg-slabel]') || {}).value || '').trim();
      var typeEl = row.querySelector('[data-mq-cwg-stype]');
      var type = typeEl && typeEl.value === 'text' ? 'text' : 'image';
      var slot = normalizeSlot({ key: key, label: label || key, type: type });
      if (slot) slots.push(slot);
    });
    var sampleValues = {};
    root.querySelectorAll('[data-mq-cwg-sample]').forEach(function (inp) {
      sampleValues[inp.getAttribute('data-mq-cwg-sample')] = inp.value;
    });
    return {
      name: String((root.querySelector('[data-mq-cwg-name]') || {}).value || '').trim(),
      size: String((root.querySelector('[data-mq-cwg-size]') || {}).value || '2x2'),
      slots: slots.length ? slots : defaultDraft().slots,
      htmlTemplate: String((root.querySelector('[data-mq-cwg-html]') || {}).value || ''),
      styleHints: normalizeStyleHints({
        radius: (root.querySelector('[data-mq-cwg-radius]') || {}).value,
        padding: (root.querySelector('[data-mq-cwg-padding]') || {}).value,
        bg: (root.querySelector('[data-mq-cwg-bg]') || {}).value,
        border: (root.querySelector('[data-mq-cwg-border]') || {}).value
      }),
      sampleValues: sampleValues,
      presetPick: String((root.querySelector('[data-mq-cwg-preset-pick]') || {}).value || ''),
      id: String((root.querySelector('[data-mq-cwg-id]') || {}).value || '')
    };
  }

  function refreshPreview(root) {
    if (!root) return;
    var host = root.querySelector('[data-mq-cwg-preview]');
    if (!host) return;
    var state = readEditorState(root);
    var row = normalizePresetRow(
      Object.assign({}, state, { name: state.name || '预览', id: state.id || 'preview' })
    );
    if (!row) {
      host.innerHTML = '';
      return;
    }
    var html = renderTemplateHtml(row.htmlTemplate, row.slots, state.sampleValues || {});
    host.innerHTML =
      '<div class="desk-custom__wg desk-custom__wg--custom mi-cwg-tpl__preview-stage" data-size="' +
      esc(row.size) +
      '"><div class="wg-custom__host">' +
      html +
      '</div></div>';
    var stage = host.querySelector('.desk-custom__wg--custom');
    applyStyleHintsToEl(stage, row.styleHints);
    row.slots.forEach(function (s) {
      if (s.type !== 'text') return;
      var val = (state.sampleValues && state.sampleValues[s.key]) || '';
      stage.querySelectorAll('[data-miya-text="' + s.key + '"]').forEach(function (el) {
        el.textContent = val;
      });
    });
  }

  function toast(msg) {
    if (global.miyaBeautifyApp && global.miyaBeautifyApp.toast) {
      global.miyaBeautifyApp.toast(msg);
      return;
    }
    var div = document.createElement('div');
    div.className = 'ins-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () {
      div.remove();
    }, 2200);
  }

  function sanitizeExportFileName(name) {
    return (
      String(name || 'preset')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || 'preset'
    );
  }

  /** 从导入文件名推导预设名（去掉 .json 与导出前缀 miyacustomwg-） */
  function presetNameFromImportFile(fileOrName) {
    var raw = typeof fileOrName === 'string' ? fileOrName : (fileOrName && fileOrName.name) || '';
    var base = String(raw)
      .replace(/^.*[\\/]/, '')
      .replace(/\.json$/i, '')
      .trim();
    if (!base) return '';
    base = base.replace(/^miyacustomwg[-_\s]*/i, '').replace(/^miya-custom-widget[-_\s]*/i, '');
    return base.trim().slice(0, 60);
  }

  function applyImportFileName(item, fileOrName) {
    if (!item) return item;
    var fromFile = presetNameFromImportFile(fileOrName);
    if (fromFile) item.name = fromFile;
    return item;
  }

  function buildExportPayload(preset) {
    var row = normalizePresetRow(preset);
    if (!row) return null;
    return {
      format: FORMAT,
      version: 1,
      name: row.name,
      size: row.size,
      w: row.w,
      h: row.h,
      slots: row.slots.map(function (s) {
        return { key: s.key, type: s.type, label: s.label, maxLength: s.maxLength };
      }),
      htmlTemplate: row.htmlTemplate,
      styleHints: Object.assign({}, row.styleHints)
    };
  }

  function parseImport(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var fmt = String(raw.format || '').trim();
    if (fmt && fmt !== FORMAT && fmt !== 'miya-custom-widget') return null;
    var row = normalizePresetRow({
      name: raw.name || '导入小组件',
      size: raw.size || raw.w + 'x' + raw.h,
      slots: raw.slots,
      htmlTemplate: raw.htmlTemplate,
      styleHints: raw.styleHints,
      id: raw.id
    });
    if (!row) return null;
    return {
      name: row.name,
      size: row.size,
      slots: row.slots,
      htmlTemplate: row.htmlTemplate,
      styleHints: row.styleHints,
      sampleValues: {},
      presetPick: '',
      id: ''
    };
  }

  /** 宽松解析：数组 / 单条 / 嵌套 presets */
  function parseImportAuto(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    if (Array.isArray(raw)) {
      var list = raw.map(function (item) {
        return parseImport(item) || (item && item.format ? null : parseImport(Object.assign({ format: FORMAT }, item)));
      }).filter(Boolean);
      return list.length ? { kind: 'list', items: list } : null;
    }
    if (raw.presets && Array.isArray(raw.presets)) {
      return parseImportAuto(raw.presets);
    }
    if (raw.customWidgetPresets && Array.isArray(raw.customWidgetPresets)) {
      return parseImportAuto(raw.customWidgetPresets);
    }
    var one = parseImport(raw);
    if (one) return { kind: 'one', item: one };
    /* 无 format 字段时也尝试当自定义小组件 */
    if (raw.htmlTemplate || raw.slots) {
      one = parseImport(Object.assign({ format: FORMAT }, raw));
      if (one) return { kind: 'one', item: one };
    }
    return null;
  }

  function downloadExport(preset) {
    var payload = buildExportPayload(preset);
    if (!payload) return false;
    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'miyacustomwg-' + sanitizeExportFileName(payload.name) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (eRev) {}
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function copyTutorialText() {
    var copyText = TUTORIAL_TXT;
    var done = function () {
      toast('教程已复制');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyText).then(done).catch(function () {
        fallbackCopyTutorial(copyText, done);
      });
      return;
    }
    fallbackCopyTutorial(copyText, done);
  }

  function fallbackCopyTutorial(text, onOk) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof onOk === 'function') onOk();
    } catch (err) {
      toast('复制失败，请手动选中教程文字');
    }
  }

  function downloadTutorialTxt() {
    try {
      var blob = new Blob([TUTORIAL_TXT], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '自定义小组件完整教程.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (eRev) {}
      }, 1500);
      toast('已开始下载');
    } catch (e) {
      toast('下载失败');
    }
  }

  function remountEditor(host, draft) {
    if (!host) return null;
    host.innerHTML = buildEditorHtml(draft);
    var root = host.querySelector('[data-mq-cwg-tpl-root]');
    if (root) bindEditorRoot(root, { remountHost: host });
    return root;
  }

  function bindEditorRoot(root, opts) {
    opts = opts || {};
    if (!root || root.getAttribute('data-cwg-bound') === '1') return;
    root.setAttribute('data-cwg-bound', '1');

    function remount(draft) {
      if (opts.remountHost) {
        remountEditor(opts.remountHost, draft);
        return;
      }
      var parent = root.parentNode;
      if (!parent) return;
      parent.innerHTML = buildEditorHtml(draft);
      var next = parent.querySelector('[data-mq-cwg-tpl-root]');
      if (next) bindEditorRoot(next, opts);
    }

    root.addEventListener('input', function () {
      refreshPreview(root);
    });
    root.addEventListener('change', function () {
      refreshPreview(root);
    });

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-mq-cwg-guide-copy]')) {
        e.preventDefault();
        copyTutorialText();
        return;
      }
      if (t.closest('[data-mq-cwg-guide-dl]')) {
        e.preventDefault();
        downloadTutorialTxt();
        return;
      }
      if (t.closest('[data-mq-cwg-example]')) {
        remount({
          name: '示例·拍立得卡',
          size: '2x2',
          slots: [
            { key: 'photo', type: 'image', label: '照片' },
            { key: 'title', type: 'text', label: '标题', maxLength: 24 },
            { key: 'note', type: 'text', label: '副文', maxLength: 40 }
          ],
          htmlTemplate: EXAMPLE_HTML_2X2,
          styleHints: { radius: 16, padding: 8, bg: '#fffaf3', border: 'soft' },
          sampleValues: { title: '三楼拐角', note: '慢慢过' },
          presetPick: '',
          id: ''
        });
        return;
      }
      if (t.closest('[data-mq-cwg-clear]')) {
        remount(defaultDraft());
        return;
      }
      if (t.closest('[data-mq-cwg-save-draft]')) {
        var st = readEditorState(root);
        saveDraft(st);
        toast('草稿已保存');
        return;
      }
      if (t.closest('[data-mq-cwg-slot-add]')) {
        var cur = readEditorState(root);
        if (cur.slots.length >= MAX_SLOTS) {
          toast('最多 ' + MAX_SLOTS + ' 个槽位');
          return;
        }
        cur.slots.push({
          key: 'photo' + (cur.slots.length + 1),
          type: 'image',
          label: '照片 ' + (cur.slots.length + 1)
        });
        remount(cur);
        return;
      }
      if (t.closest('[data-mq-cwg-slot-del]')) {
        var row = t.closest('[data-mq-cwg-slot]');
        var stateDel = readEditorState(root);
        var idx = row ? parseInt(row.getAttribute('data-idx'), 10) : -1;
        if (idx >= 0 && stateDel.slots.length > 1) {
          stateDel.slots.splice(idx, 1);
          remount(stateDel);
        } else {
          toast('至少保留一个槽位');
        }
        return;
      }
      if (t.closest('[data-mq-cwg-preset-save]')) {
        var toSave = readEditorState(root);
        var name = toSave.name;
        var ask =
          global.miyaDialog && global.miyaDialog.prompt
            ? global.miyaDialog.prompt({
                title: '保存自定义小组件',
                message: '预设名称',
                placeholder: '我的组件',
                value: name || ''
              })
            : Promise.resolve(prompt('预设名称', name || '') || '');
        ask.then(function (val) {
          if (!val && val !== 0) return;
          var label = String(val).trim();
          if (!label) return;
          toSave.name = label;
          savePreset(label, toSave, { id: toSave.id }).then(function (saved) {
            toSave.id = saved.id;
            toSave.presetPick = saved.id;
            saveDraft(toSave);
            remount(toSave);
            toast('已保存「' + label + '」');
          }).catch(function () {
            toast('保存失败');
          });
        });
        return;
      }
      if (t.closest('[data-mq-cwg-preset-load]')) {
        var pick = String((root.querySelector('[data-mq-cwg-preset-pick]') || {}).value || '');
        var found = findPresetById(pick);
        if (!found) {
          toast('请先选择预设');
          return;
        }
        remount({
          name: found.name,
          size: found.size,
          slots: found.slots,
          htmlTemplate: found.htmlTemplate,
          styleHints: found.styleHints,
          sampleValues: {},
          presetPick: found.id,
          id: found.id
        });
        toast('已读取');
        return;
      }
      if (t.closest('[data-mq-cwg-preset-delete]')) {
        var delPick = String((root.querySelector('[data-mq-cwg-preset-pick]') || {}).value || '');
        if (!delPick) {
          toast('请先选择预设');
          return;
        }
        var confirmFn =
          global.miyaDialog && global.miyaDialog.confirm
            ? global.miyaDialog.confirm({ title: '删除预设', message: '确定删除该自定义小组件？' })
            : Promise.resolve(confirm('确定删除？'));
        confirmFn.then(function (ok) {
          if (!ok) return;
          deletePreset(delPick).then(function () {
            var cleared = defaultDraft();
            remount(cleared);
            toast('已删除');
          }).catch(function () {
            toast('删除失败');
          });
        });
        return;
      }
      if (t.closest('[data-mq-cwg-preset-export]')) {
        var expState = readEditorState(root);
        var expRow = normalizePresetRow(
          Object.assign({}, expState, {
            name: expState.name || '未命名',
            id: expState.id || genId('cwg')
          })
        );
        if (!downloadExport(expRow)) toast('导出失败');
        else toast('JSON 已导出');
        return;
      }
      if (t.closest('[data-mq-cwg-preset-import]')) {
        var fileInp = root.querySelector('[data-mq-cwg-preset-import-file]');
        if (fileInp) {
          if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(fileInp);
          else fileInp.click();
        }
      }
    });

    var importFile = root.querySelector('[data-mq-cwg-preset-import-file]');
    if (importFile) {
      if (!importFile.multiple) importFile.multiple = true;
      importFile.addEventListener('change', function () {
        /* FileList 是活引用：先拷贝再清空 value，否则 files 会立刻变空 */
        var fileArr = Array.prototype.slice.call(importFile.files || []);
        importFile.value = '';
        if (!fileArr.length) return;
        toast('正在导入 ' + fileArr.length + ' 个小组件…');
        importCustomWidgetFiles(fileArr)
          .then(function (result) {
            if (!result.ok) {
              toast('无法识别的小组件 JSON');
              return;
            }
            var last = result.items[result.items.length - 1];
            var saved = findPresetByName(last.name) || last;
            remount(
              Object.assign({}, saved, {
                sampleValues: {},
                presetPick: saved.id || ''
              })
            );
            if (result.ok === 1 && !result.fail) {
              toast('导入成功，已保存「' + (saved.name || '自定义小组件') + '」');
            } else if (result.fail) {
              toast('导入完成：成功 ' + result.ok + ' 个，失败 ' + result.fail + ' 个');
            } else {
              toast('导入成功，已保存 ' + result.ok + ' 个预设');
            }
          })
          .catch(function () {
            toast('导入失败');
          });
      });
    }

    refreshPreview(root);
  }

  global.MiyaDeskCustomWidgetTemplates = {
    PRESETS_LS: PRESETS_LS,
    FORMAT: FORMAT,
    SIZE_OPTIONS: SIZE_OPTIONS,
    TUTORIAL_TXT: TUTORIAL_TXT,
    whenReady: whenPresetsReady,
    loadPresets: loadPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    findPresetById: findPresetById,
    findPresetByName: findPresetByName,
    replaceAllPresets: replaceAllPresets,
    mergePresets: mergePresets,
    getLibrarySnapshot: getLibrarySnapshot,
    getCatalogEntries: getCatalogEntries,
    catalogWidgetId: catalogWidgetId,
    parseCatalogWidgetId: parseCatalogWidgetId,
    normalizePresetRow: normalizePresetRow,
    buildInstanceConfig: buildInstanceConfig,
    resolvePresetFromConfig: resolvePresetFromConfig,
    editorFieldsFromConfig: editorFieldsFromConfig,
    renderTemplateHtml: renderTemplateHtml,
    applyStyleHintsToEl: applyStyleHintsToEl,
    buildExportPayload: buildExportPayload,
    parseImport: parseImport,
    parseImportAuto: parseImportAuto,
    importCustomWidgetFiles: importCustomWidgetFiles,
    presetNameFromImportFile: presetNameFromImportFile,
    applyImportFileName: applyImportFileName,
    downloadExport: downloadExport,
    buildEditorHtml: buildEditorHtml,
    bindEditorRoot: bindEditorRoot,
    remountEditor: remountEditor,
    loadDraft: loadDraft,
    saveDraft: saveDraft,
    defaultDraft: defaultDraft
  };
})(window);
