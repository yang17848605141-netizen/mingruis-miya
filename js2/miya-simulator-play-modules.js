/**
 * 人生分镜馆 · 游玩侧栏模块：设置 / 外观 / 个人 / 属性
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'sim-script-decor-style';
  var pendingImportBundle = null;

  var SHELL_REFERENCE =
    '/* 剧本游玩页 · CSS 选择器参考 */\n' +
    '#miya-simulator-app.is-in-play .sim-play-stage     ← 整页舞台\n' +
    '.sim-play-top / .sim-play-top__title               ← 顶栏标题\n' +
    '.sim-exhibit / .sim-exhibit__frame                 ← 叙事外框\n' +
    '.sim-exhibit__scroll / .sim-exhibit__para          ← 叙事正文段落\n' +
    '.sim-exhibit__para.is-stage                        ← 分镜/舞台句\n' +
    '.sim-rail / .sim-rail__item                        ← 右侧功能栏\n' +
    '.sim-drawer__panel                                 ← 侧拉抽屉\n';

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function store() { return global.MiyaSimulatorStore; }

  function toast(msg) {
    if (global.miyaSimulatorApp && global.miyaSimulatorApp.toast) {
      global.miyaSimulatorApp.toast(msg);
      return;
    }
    var el = document.getElementById('sim-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2600);
  }

  function copyText(text) {
    var t = String(text || '');
    if (!t) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  function scriptId() {
    return global.miyaSimulatorApp && global.miyaSimulatorApp.getScriptId
      ? global.miyaSimulatorApp.getScriptId()
      : null;
  }

  function injectDecorCss(css) {
    var text = String(css || '');
    var el = document.getElementById(STYLE_ID);
    if (!text) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = text;
  }

  function applyDecorFromStore() {
    var st = store();
    if (!st) return;
    var decor = st.getScriptDecor();
    injectDecorCss(decor.customCss || '');
  }

  function downloadJson(obj, filename) {
    if (typeof global.miyaDownloadBlobAsync === 'function') {
      var json = global.miyaSafeJsonStringify ? global.miyaSafeJsonStringify(obj) : null;
      if (json == null) {
        try { json = JSON.stringify(obj); } catch (e) { json = null; }
      }
      if (json == null) {
        toast('导出失败：数据过大或格式异常');
        return Promise.resolve(false);
      }
      return global.miyaDownloadBlobAsync(
        new Blob([json], { type: 'application/json;charset=utf-8' }),
        filename
      ).then(function (ok) {
        if (!ok) toast('导出失败：数据过大或格式异常');
        return ok;
      });
    }
    var ok = false;
    if (typeof global.miyaDownloadJson === 'function') {
      ok = global.miyaDownloadJson(obj, filename);
    }
    if (!ok) toast('导出失败：数据过大或格式异常');
    return Promise.resolve(ok);
  }

  function renderSettingsOverlay(scriptIdVal) {
    var st = store();
    var script = st.findScript(scriptIdVal);
    if (!script) return '';
    var isCustom = !script.builtin;
    var customs = (st.allScripts() || []).filter(function (s) { return !s.builtin; });
    var overwriteOpts = customs.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === scriptIdVal ? ' selected' : '') + '>' +
        esc(s.title) + '</option>';
    }).join('');

    return (
      '<div class="sim-api__veil" id="sim-ss-veil"></div>' +
      '<div class="sim-api__panel sim-ss__panel">' +
        '<header class="sim-api__head">' +
          '<h2>剧本设置</h2>' +
          '<p>' + esc(script.title) + '</p>' +
          '<button type="button" class="sim-api__close" id="sim-ss-close">×</button>' +
        '</header>' +
        '<div class="sim-api__body sim-ss__body">' +
          '<p class="sim-ss__section-label">导出</p>' +
          '<button type="button" class="sim-ss__btn" id="sim-ss-export">导出全部信息（剧本+存档 JSON）</button>' +
          '<button type="button" class="sim-ss__btn sim-ss__btn--ghost" id="sim-ss-export-config">导出剧本配置（仅配置）</button>' +
          '<p class="sim-ss__section-label">导入 · 覆盖</p>' +
          (isCustom
            ? '<button type="button" class="sim-ss__btn" id="sim-ss-edit-config">编辑剧本配置</button>'
            : '<p class="sim-ed-hint">内置剧本不可改配置定义；可导入配置同步到当前存档。</p>') +
          '<label class="sim-ss__btn sim-ss__btn--file">' +
            '覆盖导入 · 当前剧本配置<input type="file" id="sim-ss-import-current" accept="application/json,.json" hidden>' +
          '</label>' +
          '<label class="sim-ss__btn sim-ss__btn--file">' +
            '导入其他剧本配置<input type="file" id="sim-ss-import-other" accept="application/json,.json" hidden>' +
          '</label>' +
          '<label class="sim-ss__btn sim-ss__btn--file">' +
            '导入全部数据（新剧本）<input type="file" id="sim-ss-import" accept="application/json,.json" hidden>' +
          '</label>' +
          '<div class="sim-ss-import-target" id="sim-ss-import-target" hidden>' +
            '<p class="sim-ed-hint">已读取配置，选择导入方式后确认（覆盖不可恢复）</p>' +
            '<div class="sim-ss-import-target__modes">' +
              '<label class="sim-ss-radio"><input type="radio" name="sim-ss-import-mode" value="new" checked> 作为新剧本</label>' +
              '<label class="sim-ss-radio"><input type="radio" name="sim-ss-import-mode" value="overwrite"> 覆盖已有剧本</label>' +
            '</div>' +
            '<select class="sim-ss-import-target__sel" id="sim-ss-overwrite-select"' +
              (overwriteOpts ? '' : ' disabled') + '>' +
              overwriteOpts || '<option value="">暂无自定义剧本</option>' +
            '</select>' +
            '<label class="sim-ss-check" id="sim-ss-import-save-wrap" hidden>' +
              '<input type="checkbox" id="sim-ss-import-save"> 同时覆盖存档数据（仅全部 JSON 包）</label>' +
            '<div class="sim-ss-import-target__actions">' +
              '<button type="button" class="sim-btn" id="sim-ss-import-cancel">取消</button>' +
              '<button type="button" class="sim-btn sim-btn--primary" id="sim-ss-import-confirm">确认覆盖导入</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function showImportTargetPanel(bundle, isFullBundle) {
    pendingImportBundle = bundle;
    var panel = document.getElementById('sim-ss-import-target');
    var saveWrap = document.getElementById('sim-ss-import-save-wrap');
    if (panel) panel.hidden = false;
    if (saveWrap) saveWrap.hidden = !isFullBundle;
  }

  function hideImportTargetPanel() {
    pendingImportBundle = null;
    var panel = document.getElementById('sim-ss-import-target');
    if (panel) panel.hidden = true;
  }

  function confirmOtherImport() {
    if (!pendingImportBundle) return;
    var st = store();
    var modeEl = document.querySelector('input[name="sim-ss-import-mode"]:checked');
    var mode = modeEl ? modeEl.value : 'new';
    var sel = document.getElementById('sim-ss-overwrite-select');
    var importSave = document.getElementById('sim-ss-import-save');
    var bundle = pendingImportBundle;
    var isFull = bundle.format === 'miya-simulator-script-bundle';
    hideImportTargetPanel();

    if (mode === 'overwrite') {
      var oid = sel && sel.value;
      if (!oid) {
        toast('请选择要覆盖的剧本');
        return;
      }
      var confirmFn = global.miyaDialog && global.miyaDialog.confirm
        ? global.miyaDialog.confirm({
          title: '覆盖剧本',
          message: '将用导入内容覆盖「' + (st.findScript(oid) || {}).title + '」，不可恢复。'
        })
        : Promise.resolve(confirm('确认覆盖该剧本？'));
      confirmFn.then(function (ok) {
        if (!ok) return;
        var row = st.importScriptBundle(bundle, {
          overwriteId: oid,
          importSave: isFull && importSave && importSave.checked
        });
        if (row) {
          toast('已覆盖：' + row.title);
          global.miyaSimulatorApp.closeScriptSettings();
          global.miyaSimulatorApp.openScript(row.id);
        } else toast('导入失败');
      });
      return;
    }

    var rowNew = isFull
      ? st.importScriptBundle(bundle, {})
      : st.importScriptConfigWithTarget(bundle, {});
    if (rowNew) {
      toast('新剧本：' + rowNew.title);
      global.miyaSimulatorApp.closeScriptSettings();
      global.miyaSimulatorApp.openScript(rowNew.id);
    } else toast('导入格式无效');
  }

  function handleImportCurrentFile(file) {
    var sid = scriptId();
    if (!file || !sid) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var bundle = JSON.parse(String(reader.result || ''));
        var confirmFn = global.miyaDialog && global.miyaDialog.confirm
          ? global.miyaDialog.confirm({
            title: '覆盖当前剧本配置',
            message: '将用文件内容覆盖当前剧本配置与相关存档字段，不可恢复。'
          })
          : Promise.resolve(confirm('覆盖导入当前剧本配置？'));
        confirmFn.then(function (ok) {
          if (!ok) return;
          var res = store().importScriptConfigToCurrent(sid, bundle);
          if (res && res.ok) {
            toast('当前剧本配置已覆盖');
            global.miyaSimulatorApp.closeScriptSettings();
            global.miyaSimulatorApp.render();
          } else toast('导入格式无效');
        });
      } catch (e) {
        toast('JSON 解析失败');
      }
    };
    reader.readAsText(file);
  }

  function handleImportOtherFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var bundle = JSON.parse(String(reader.result || ''));
        if (!store().extractConfigFromImportBundle(bundle) && bundle.format !== 'miya-simulator-script-bundle') {
          toast('不是有效的剧本配置/数据包');
          return;
        }
        showImportTargetPanel(bundle, bundle.format === 'miya-simulator-script-bundle');
      } catch (e) {
        toast('JSON 解析失败');
      }
    };
    reader.readAsText(file);
  }

  function renderAppearanceHtml() {
    var st = store();
    var decor = st.getScriptDecor();
    var css = decor.customCss || '';
    var sample = st.DEFAULT_SCRIPT_DECOR_CSS || '';
    var presets = decor.presets || [];
    var presetRows = presets.length
      ? presets.map(function (p) {
        var active = decor.activePresetId === p.id;
        return '<div class="sim-decor-preset' + (active ? ' is-active' : '') + '" data-sim-decor-preset="' + esc(p.id) + '">' +
          '<span>' + esc(p.name) + '</span>' +
          '<button type="button" data-sim-decor-apply="' + esc(p.id) + '">应用</button>' +
          '<button type="button" data-sim-decor-del="' + esc(p.id) + '">删</button>' +
        '</div>';
      }).join('')
      : '<p class="sim-ed-hint">暂无装修包，填写 CSS 后保存即可。</p>';

    return (
      '<div class="sim-mod sim-mod--decor">' +
        '<p class="sim-mod__lead">剧本外观 CSS 全剧本通用，可随时替换装修包。</p>' +
        '<details class="sim-decor-ref">' +
          '<summary>可复制 · DOM 参考</summary>' +
          '<pre class="sim-decor-ref__pre">' + esc(SHELL_REFERENCE) + '</pre>' +
          '<button type="button" class="sim-btn sim-btn--ghost" data-sim-decor-copy-ref>复制参考</button>' +
        '</details>' +
        '<details class="sim-decor-ref">' +
          '<summary>可复制 · 示例装修 CSS</summary>' +
          '<pre class="sim-decor-ref__pre sim-decor-ref__pre--css">' + esc(sample) + '</pre>' +
          '<button type="button" class="sim-btn sim-btn--ghost" data-sim-decor-copy-sample>复制示例 CSS</button>' +
        '</details>' +
        '<label class="sim-mod-field sim-mod-field--area">' +
          '<span>自定义 CSS</span>' +
          '<textarea id="sim-decor-css" rows="10" spellcheck="false" placeholder="写入 .sim-exhibit__frame 等选择器…">' +
            esc(css) + '</textarea>' +
        '</label>' +
        '<div class="sim-mod-actions">' +
          '<button type="button" class="sim-btn sim-btn--primary" data-sim-decor-apply-live>应用预览</button>' +
          '<button type="button" class="sim-btn" data-sim-decor-commit>应用</button>' +
          '<button type="button" class="sim-btn" data-sim-decor-save>保存为装修包</button>' +
          '<button type="button" class="sim-btn sim-btn--ghost" data-sim-decor-copy-current>复制当前 CSS</button>' +
          '<button type="button" class="sim-btn sim-btn--ghost" data-sim-decor-clear>清除样式</button>' +
        '</div>' +
        '<div class="sim-decor-presets">' +
          '<h4>剧本装修包</h4>' + presetRows +
        '</div>' +
      '</div>'
    );
  }

  function engine() { return global.MiyaSimulatorEngine; }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function skillTierClass(level) {
    var lv = parseInt(level, 10) || 1;
    if (lv >= 76) return 'is-tier-4';
    if (lv >= 51) return 'is-tier-3';
    if (lv >= 26) return 'is-tier-2';
    return 'is-tier-1';
  }

  function buildSkillTwigPath(cx, trunkTop, x, y, ring, side) {
    var anchorY = trunkTop + 52 + ring * 36;
    var mx = cx + (x - cx) * 0.42;
    var my = (anchorY + y) * 0.52;
    return 'M' + cx + ' ' + anchorY +
      ' C' + mx + ' ' + my + ' ' + (x - side * 12) + ' ' + (y - 8) +
      ' ' + x + ' ' + (y + 16);
  }

  function updateSkillTwigForFruit(fruit, x, y) {
    var tree = fruit.closest('.sim-skill-tree');
    if (!tree) return;
    var skillId = fruit.getAttribute('data-sim-skill-id');
    if (!skillId) return;
    var twig = tree.querySelector('[data-sim-skill-twig="' + skillId + '"]');
    if (!twig) return;
    var treeW = tree.offsetWidth;
    var treeH = tree.offsetHeight;
    var cx = treeW * 0.5;
    var trunkTop = treeH * 0.18;
    var ring = parseInt(fruit.getAttribute('data-sim-skill-ring'), 10) || 0;
    var side = parseInt(fruit.getAttribute('data-sim-skill-side'), 10);
    if (!side) side = x >= cx ? 1 : -1;
    twig.setAttribute('d', buildSkillTwigPath(cx, trunkTop, x, y, ring, side));
  }

  function getSkillTreeSize(skillCount, fullscreen) {
    var count = skillCount || 0;
    return {
      w: Math.max(fullscreen ? 960 : 720, Math.ceil(count / 4) * 200 + 480),
      h: Math.max(fullscreen ? 680 : 480, Math.ceil(count / 4) * 120 + 360)
    };
  }

  function layoutSkillNodes(skills, treeW, treeH) {
    var cx = treeW * 0.5;
    var trunkTop = treeH * 0.18;
    var baseY = treeH - 48;
    var cols = Math.max(4, Math.ceil(Math.sqrt(Math.max(skills.length, 1) * 1.8)));
    var nodes = skills.map(function (skill, i) {
      var ring = Math.floor(i / cols);
      var pos = i % cols;
      var side = pos % 2 === 0 ? -1 : 1;
      var spread = 92 + ring * 86 + (pos % 3) * 18;
      var x = cx + side * spread * (0.52 + (ring % 2) * 0.12);
      var y = trunkTop + 72 + ring * 108 + (pos % 4) * 22 + (side > 0 ? 8 : 0);
      x = Math.max(64, Math.min(treeW - 64, x));
      y = Math.max(56, Math.min(treeH - 110, y));
      if (skill.treeX != null && skill.treeY != null) {
        x = Math.max(64, Math.min(treeW - 64, skill.treeX * treeW));
        y = Math.max(56, Math.min(treeH - 110, skill.treeY * treeH));
      }
      return { skill: skill, x: x, y: y, i: i, ring: ring, side: side };
    });
    return { cx: cx, trunkTop: trunkTop, baseY: baseY, nodes: nodes };
  }

  function buildSkillTreeSvg(layout, treeW, treeH, svgId) {
    var cx = layout.cx;
    var trunkTop = layout.trunkTop;
    var baseY = layout.baseY;
    var twigs = layout.nodes.map(function (n) {
      return '<path class="sim-skill-tree__twig" data-sim-skill-twig="' + esc(n.skill.id) + '" d="' +
        buildSkillTwigPath(cx, trunkTop, n.x, n.y, n.ring, n.side) + '"/>';
    }).join('');
    var roots =
      '<path class="sim-skill-tree__root sim-skill-tree__root--l" d="M' + cx + ' ' + baseY +
        ' Q' + (cx - 70) + ' ' + (baseY + 18) + ' ' + (cx - 120) + ' ' + (baseY + 8) + '"/>' +
      '<path class="sim-skill-tree__root sim-skill-tree__root--r" d="M' + cx + ' ' + baseY +
        ' Q' + (cx + 65) + ' ' + (baseY + 22) + ' ' + (cx + 115) + ' ' + (baseY + 12) + '"/>';
    var leaves = '';
    var leafSpots = [
      [cx - 90, trunkTop + 20], [cx + 80, trunkTop + 10], [cx - 140, trunkTop + 55],
      [cx + 130, trunkTop + 48], [cx - 40, trunkTop - 8], [cx + 50, trunkTop - 12],
      [cx - 170, trunkTop + 90], [cx + 160, trunkTop + 82]
    ];
    leafSpots.forEach(function (p, i) {
      leaves += '<ellipse class="sim-skill-tree__leaf" cx="' + p[0] + '" cy="' + p[1] +
        '" rx="' + (22 + (i % 3) * 8) + '" ry="' + (14 + (i % 2) * 6) +
        '" transform="rotate(' + (i * 24 - 30) + ' ' + p[0] + ' ' + p[1] + ')"/>';
    });
    return (
      '<svg class="sim-skill-tree__svg" viewBox="0 0 ' + treeW + ' ' + treeH + '" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="' + svgId + '-trunk" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#7d5a3c"/>' +
            '<stop offset="45%" stop-color="#5a3d28"/>' +
            '<stop offset="100%" stop-color="#2e1f14"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + svgId + '-sky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#1a2840"/>' +
            '<stop offset="35%" stop-color="#3d5a48"/>' +
            '<stop offset="70%" stop-color="#6b8f5a"/>' +
            '<stop offset="100%" stop-color="#a8c48a"/>' +
          '</linearGradient>' +
          '<radialGradient id="' + svgId + '-moon" cx="50%" cy="50%" r="50%">' +
            '<stop offset="0%" stop-color="#fff8e8"/>' +
            '<stop offset="100%" stop-color="#f0e4c8" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<filter id="' + svgId + '-glow"><feGaussianBlur stdDeviation="3" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
        '</defs>' +
        '<rect class="sim-skill-tree__sky" width="' + treeW + '" height="' + treeH + '" fill="url(#' + svgId + '-sky)"/>' +
        '<ellipse class="sim-skill-tree__moon" cx="' + (treeW - 70) + '" cy="58" rx="28" ry="28" fill="url(#' + svgId + '-moon)" opacity="0.88"/>' +
        '<ellipse class="sim-skill-tree__hill" cx="' + cx + '" cy="' + baseY + '" rx="' + (treeW * 0.55) + '" ry="80" />' +
        leaves +
        roots +
        '<path class="sim-skill-tree__trunk" stroke="url(#' + svgId + '-trunk)" d="M' + cx + ' ' + baseY +
          ' C' + (cx - 12) + ' ' + (baseY - treeH * 0.25) + ' ' + (cx + 10) + ' ' + (trunkTop + 80) +
          ' ' + cx + ' ' + trunkTop + '" />' +
        '<path class="sim-skill-tree__branch sim-skill-tree__branch--l" stroke="url(#' + svgId + '-trunk)" d="M' + cx + ' ' + (trunkTop + 70) +
          ' Q' + (cx - treeW * 0.22) + ' ' + (trunkTop + 40) + ' ' + (cx - treeW * 0.32) + ' ' + (trunkTop + 18) + '"/>' +
        '<path class="sim-skill-tree__branch sim-skill-tree__branch--r" stroke="url(#' + svgId + '-trunk)" d="M' + cx + ' ' + (trunkTop + 58) +
          ' Q' + (cx + treeW * 0.24) + ' ' + (trunkTop + 32) + ' ' + (cx + treeW * 0.34) + ' ' + (trunkTop + 12) + '"/>' +
        twigs +
      '</svg>'
    );
  }

  function renderSkillFruit(skill, node) {
    var st = store();
    var prog = st.getSkillProgress(skill);
    var pct = prog.maxed ? 100 : prog.pct;
    return (
      '<button type="button" class="sim-skill-fruit ' + skillTierClass(skill.level) + '" ' +
        'data-sim-skill-id="' + esc(skill.id) + '" ' +
        'data-sim-skill-ring="' + node.ring + '" data-sim-skill-side="' + node.side + '" ' +
        'style="left:' + node.x + 'px;top:' + node.y + 'px;--sim-fruit-pct:' + pct + '%" ' +
        'title="' + esc(skill.name) + ' · ' + esc(skill.desc || '') + '">' +
        '<span class="sim-skill-fruit__vine" aria-hidden="true"></span>' +
        '<span class="sim-skill-fruit__leaf" aria-hidden="true"></span>' +
        '<span class="sim-skill-fruit__halo" aria-hidden="true"></span>' +
        '<span class="sim-skill-fruit__glow" aria-hidden="true"></span>' +
        '<span class="sim-skill-fruit__body" aria-hidden="true">' +
          '<span class="sim-skill-fruit__shine"></span>' +
          '<span class="sim-skill-fruit__ring"></span>' +
        '</span>' +
        '<span class="sim-skill-fruit__stem" aria-hidden="true"></span>' +
        '<span class="sim-skill-fruit__name">' + esc(skill.name) + '</span>' +
        '<span class="sim-skill-fruit__lv">Lv.' + prog.level + '</span>' +
        '<span class="sim-skill-fruit__exp">' +
          (prog.maxed ? 'MAX' : prog.cur + '/' + prog.need) +
        '</span>' +
        '<span class="sim-skill-fruit__del" data-sim-skill-del="' + esc(skill.id) + '" aria-label="删除">×</span>' +
      '</button>'
    );
  }

  function buildSkillTreeStage(skills, opts) {
    opts = opts || {};
    var wrapId = opts.wrapId || 'sim-skill-tree-wrap';
    var overlayId = opts.overlayId || 'sim-skill-gen-overlay';
    var svgId = opts.svgId || 'simTree';
    var fullscreen = !!opts.fullscreen;
    var count = skills.length;
    var size = getSkillTreeSize(count, fullscreen);
    var treeW = size.w;
    var treeH = size.h;
    var layout = layoutSkillNodes(skills, treeW, treeH);
    var fruits = layout.nodes.map(function (n) { return renderSkillFruit(n.skill, n); }).join('');
    var fireflies = '';
    for (var f = 0; f < 12; f += 1) {
      fireflies += '<span class="sim-skill-tree__firefly" style="left:' +
        (8 + (f * 17) % 88) + '%;top:' + (12 + (f * 23) % 70) +
        '%;animation-delay:' + (f * 0.35) + 's"></span>';
    }
    return (
      '<div class="sim-skill-stage' + (fullscreen ? ' sim-skill-stage--fs' : '') + '">' +
        '<div class="sim-skill-gen-overlay" id="' + overlayId + '" hidden>' +
          '<div class="sim-skill-gen-overlay__inner">' +
            '<span class="sim-skill-gen-overlay__spin" aria-hidden="true"></span>' +
            '<p>生成中…</p>' +
            '<small>正在读取剧本与角色信息</small>' +
          '</div>' +
        '</div>' +
        '<div class="sim-skill-tree-wrap' + (fullscreen ? ' sim-skill-tree-wrap--fs' : '') + '" id="' + wrapId + '">' +
          '<div class="sim-skill-tree-pan" id="' + wrapId + '-pan">' +
            '<div class="sim-skill-tree" style="width:' + treeW + 'px;height:' + treeH + 'px">' +
              buildSkillTreeSvg(layout, treeW, treeH, svgId) +
              '<div class="sim-skill-tree__mist" aria-hidden="true"></div>' +
              '<div class="sim-skill-tree__fireflies" aria-hidden="true">' + fireflies + '</div>' +
              '<div class="sim-skill-tree__canopy" aria-hidden="true"></div>' +
              '<div class="sim-skill-tree__fruits">' + fruits + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function skillToolbarHtml(st, skills, opts) {
    opts = opts || {};
    var empty = !skills.length;
    var countId = opts.countId || 'sim-skill-gen-count';
    return (
      '<div class="sim-skill-toolbar">' +
        '<label class="sim-skill-gen-count" for="' + countId + '">' +
          '<span>生成数量</span>' +
          '<input type="number" id="' + countId + '" min="1" max="12" value="4" inputmode="numeric">' +
        '</label>' +
        (empty
          ? '<button type="button" class="sim-btn sim-btn--primary" data-sim-skill-gen="initial">生成初始技能</button>'
          : '') +
        '<button type="button" class="sim-btn" data-sim-skill-add>手动添加</button>' +
        '<button type="button" class="sim-btn" data-sim-skill-gen="new">生成新技能</button>' +
        (skills.length ? '<button type="button" class="sim-btn sim-btn--ghost" data-sim-skill-gen="regen">重新生成全部</button>' : '') +
        (opts.showFullscreen !== false
          ? '<button type="button" class="sim-btn sim-btn--ghost" data-sim-skill-fullscreen>全屏</button>'
          : '') +
        '<span class="sim-skill-toolbar__count">' + skills.length + ' / ' + st.SKILL_MAX_COUNT + '</span>' +
      '</div>'
    );
  }

  function renderSkillsHtml(sid, opts) {
    opts = opts || {};
    var st = store();
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var skills = st.getSkills(sid);
    var empty = !skills.length;
    var emptyHint = empty
      ? '<div class="sim-skill-empty">' +
          '<p class="sim-skill-empty__glyph" aria-hidden="true">🌳</p>' +
          '<p><strong>远古技能树等待结果</strong></p>' +
          '<p class="sim-ed-hint">填写生成数量后点击「生成初始技能」，将读取剧本配置与个人信息。</p>' +
        '</div>'
      : '';

    return (
      '<div class="sim-mod sim-mod--skills" data-sim-module="skills" data-sim-script-id="' + esc(sid) + '">' +
        '<p class="sim-mod__lead">技能树 · 满级 ' + st.SKILL_MAX_LEVEL + ' 级 · 拖动画布浏览 · 拖动果实调位置 · 点击果实编辑 · 可全屏</p>' +
        skillToolbarHtml(st, skills, opts) +
        '<div class="sim-skill-scene">' +
          buildSkillTreeStage(skills, opts) +
          emptyHint +
        '</div>' +
      '</div>'
    );
  }

  var skillFsOpen = false;

  function isSkillFullscreenOpen() {
    return skillFsOpen;
  }

  function openSkillFullscreen(sid) {
    var layer = document.getElementById('sim-skill-fs');
    if (!layer || !sid) return;
    skillFsOpen = true;
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    layer.classList.add('is-open');
    layer.innerHTML =
      '<header class="sim-skill-fs__head">' +
        '<div class="sim-skill-fs__head-meta">' +
          '<span class="sim-skill-fs__tag">SKILL TREE</span>' +
          '<h2>技能树 · 全屏</h2>' +
        '</div>' +
        '<button type="button" class="sim-skill-fs__close" data-sim-skill-fs-close aria-label="退出全屏">×</button>' +
      '</header>' +
      '<div class="sim-skill-fs__body">' +
        renderSkillsHtml(sid, {
          fullscreen: true,
          wrapId: 'sim-skill-fs-tree-wrap',
          overlayId: 'sim-skill-fs-gen-overlay',
          svgId: 'simTreeFs',
          countId: 'sim-skill-fs-gen-count',
          showFullscreen: false
        }) +
      '</div>';
    bindSkillTree('sim-skill-fs-tree-wrap', sid, true);
    document.body.classList.add('sim-skill-fs-active');
  }

  function closeSkillFullscreen() {
    var layer = document.getElementById('sim-skill-fs');
    if (!layer) return;
    skillFsOpen = false;
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    layer.classList.remove('is-open');
    layer.innerHTML = '';
    document.body.classList.remove('sim-skill-fs-active');
  }

  function refreshSkillsViews(sid) {
    if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
      global.miyaSimulatorApp.refreshDrawerModule('skills');
    }
    if (skillFsOpen && sid) openSkillFullscreen(sid);
  }

  function renderTalentsHtml(sid) {
    var st = store();
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var talents = st.getTalents(sid);
    var cards = talents.map(function (t, i) {
      return (
        '<article class="sim-talent-card" data-sim-talent-id="' + esc(t.id) + '">' +
          '<span class="sim-talent-card__sigil" aria-hidden="true">' + esc(String(i + 1).padStart(2, '0')) + '</span>' +
          '<div class="sim-talent-card__aura" aria-hidden="true"></div>' +
          '<h4 class="sim-talent-card__name">' + esc(t.name) + '</h4>' +
          '<p class="sim-talent-card__desc">' + esc(t.desc || '暂无介绍') + '</p>' +
          '<div class="sim-talent-card__actions">' +
            '<button type="button" class="sim-talent-card__btn" data-sim-talent-edit="' + esc(t.id) + '">编辑</button>' +
            '<button type="button" class="sim-talent-card__btn sim-talent-card__btn--del" data-sim-talent-del="' + esc(t.id) + '">删除</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    return (
      '<div class="sim-mod sim-mod--talents" data-sim-module="talents">' +
        '<p class="sim-mod__lead">天赋 · 生来即有 · 不可升级 · 数量不限</p>' +
        '<div class="sim-talent-toolbar">' +
          '<button type="button" class="sim-btn sim-btn--primary" data-sim-talent-add>添加天赋</button>' +
          '<button type="button" class="sim-btn" data-sim-talent-gen>AI 生成</button>' +
          '<span class="sim-talent-toolbar__count">共 ' + talents.length + ' 项</span>' +
        '</div>' +
        '<div class="sim-talent-gen-overlay" id="sim-talent-gen-overlay" hidden>' +
          '<div class="sim-skill-gen-overlay__inner">' +
            '<span class="sim-skill-gen-overlay__spin" aria-hidden="true"></span>' +
            '<p>生成中…</p>' +
          '</div>' +
        '</div>' +
        (cards
          ? '<div class="sim-talent-grid">' + cards + '</div>'
          : '<div class="sim-talent-empty">' +
              '<p class="sim-talent-empty__glyph" aria-hidden="true">✦</p>' +
              '<p><strong>尚未记录天赋</strong></p>' +
              '<p class="sim-ed-hint">可手动添加，或点击 AI 生成（读取剧本配置与个人信息）。</p>' +
            '</div>') +
      '</div>'
    );
  }

  function renderAchievementsHtml(sid) {
    var st = store();
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var list = st.getAchievements(sid);
    var shelfRows = '';
    if (list.length) {
      for (var r = 0; r < list.length; r += 3) {
        var chunk = list.slice(r, r + 3).map(function (a, j) {
          var idx = r + j;
          var tier = idx % 3;
          return (
            '<div class="sim-trophy" data-sim-ach-id="' + esc(a.id) + '">' +
              '<div class="sim-trophy__pedestal" aria-hidden="true"></div>' +
              '<div class="sim-trophy__cup sim-trophy__cup--' + tier + '" aria-hidden="true">' +
                '<span class="sim-trophy__star"></span>' +
              '</div>' +
              '<div class="sim-trophy__plaque">' +
                '<strong>' + esc(a.name) + '</strong>' +
                '<span>' + esc(a.desc || '') + '</span>' +
                (a.turn ? '<em>第 ' + a.turn + ' 回合</em>' : '') +
              '</div>' +
              '<button type="button" class="sim-trophy__edit" data-sim-ach-edit="' + esc(a.id) + '" aria-label="编辑">✎</button>' +
            '</div>'
          );
        }).join('');
        shelfRows +=
          '<div class="sim-ach-shelf">' +
            '<div class="sim-ach-shelf__board" aria-hidden="true"></div>' +
            '<div class="sim-ach-shelf__row">' + chunk + '</div>' +
          '</div>';
      }
    }

    return (
      '<div class="sim-mod sim-mod--achieve" data-sim-module="achieve">' +
        '<p class="sim-mod__lead">成就展架 · 随回合推进自动解锁 · 亦可手动编辑</p>' +
        '<div class="sim-ach-showcase">' +
          '<div class="sim-ach-showcase__backdrop" aria-hidden="true"></div>' +
          '<header class="sim-ach-showcase__head">' +
            '<span class="sim-ach-showcase__tag">TROPHY CASE</span>' +
            '<h3>荣誉陈列</h3>' +
            '<p>已收集 ' + list.length + ' 座奖杯</p>' +
          '</header>' +
          (list.length
            ? '<div class="sim-ach-shelves">' + shelfRows + '</div>'
            : '<div class="sim-ach-empty-shelf">' +
                '<div class="sim-ach-shelf sim-ach-shelf--ghost">' +
                  '<div class="sim-ach-shelf__board" aria-hidden="true"></div>' +
                  '<div class="sim-ach-shelf__row sim-ach-shelf__row--ghost">' +
                    '<span></span><span></span><span></span>' +
                  '</div>' +
                '</div>' +
                '<p><strong>展架尚空</strong></p>' +
                '<p class="sim-ed-hint">推进回合后，系统可自动添加成就；也可在此手动添加奖杯。</p>' +
              '</div>') +
          '<footer class="sim-ach-foot">' +
            '<button type="button" class="sim-btn sim-btn--primary" data-sim-ach-add>添加成就</button>' +
          '</footer>' +
        '</div>' +
      '</div>'
    );
  }

  var relationUi = { view: 'list', npcId: null };

  function npcAvatarHtml(npc) {
    if (npc && npc.avatar) {
      return '<img src="' + esc(npc.avatar) + '" alt="">';
    }
    var ch = (npc && npc.name) ? npc.name.charAt(0) : '?';
    return '<span class="sim-rel-card__ph">' + esc(ch) + '</span>';
  }

  function affinityBarHtml(affinity) {
    var v = Number(affinity) || 0;
    var pct = Math.round(((v + 100) / 200) * 100);
    return '<span class="sim-rel-card__aff" style="--aff-pct:' + pct + '%">' + (v > 0 ? '+' : '') + v + '</span>';
  }

  function renderRelationDetailHtml(sid, npc) {
    if (!npc) return '<p class="sim-ed-hint">人物不存在</p>';
    return (
      '<div class="sim-mod sim-mod--relation-detail">' +
        '<button type="button" class="sim-rel-back" data-sim-rel-back>← 人际列表</button>' +
        '<div class="sim-rel-detail">' +
          '<label class="sim-rel-detail__ava" title="上传头像">' +
            '<input type="file" id="sim-rel-avatar" accept="image/*" data-sim-rel-avatar="' + esc(npc.id) + '" hidden>' +
            '<span class="sim-rel-detail__ava-ring">' + npcAvatarHtml(npc) + '</span>' +
            '<em>点击换头像</em>' +
          '</label>' +
          '<div class="sim-rel-detail__fields">' +
            journalField('sim-rel-name', '姓名', npc.name, '') +
            journalField('sim-rel-gender', '性别', npc.gender, '男/女/其他') +
            journalField('sim-rel-age', '年龄', npc.age, '', 'number') +
            journalField('sim-rel-identity', '身份', npc.identity, '社会身份') +
            journalField('sim-rel-occupation', '职业', npc.occupation, '') +
            journalField('sim-rel-affinity', '好感', npc.affinity, '-100~100', 'number') +
          '</div>' +
          journalArea('sim-rel-persona', '人设', npc.persona, '性格、背景、与主角关系…') +
          '<footer class="sim-rel-detail__foot">' +
            '<button type="button" class="sim-btn" data-sim-rel-del="' + esc(npc.id) + '">删除</button>' +
            '<button type="button" class="sim-btn sim-btn--primary" data-sim-rel-save="' + esc(npc.id) + '">保存</button>' +
          '</footer>' +
        '</div>' +
      '</div>'
    );
  }

  function renderRelationsHtml(sid) {
    var st = store();
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var npcs = st.getNpcs(sid);
    if (relationUi.view === 'detail' && relationUi.npcId) {
      var npc = npcs.find(function (n) { return n.id === relationUi.npcId; });
      return renderRelationDetailHtml(sid, npc);
    }
    var cards = npcs.map(function (n) {
      var sub = [n.identity, n.occupation].filter(Boolean).join(' · ');
      return '<button type="button" class="sim-rel-card" data-sim-rel-open="' + esc(n.id) + '">' +
        '<span class="sim-rel-card__ava">' + npcAvatarHtml(n) + '</span>' +
        '<span class="sim-rel-card__main">' +
          '<strong>' + esc(n.name) + '</strong>' +
          '<span class="sim-rel-card__sub">' + esc(sub || '点击查看档案') + '</span>' +
        '</span>' +
        affinityBarHtml(n.affinity) +
      '</button>';
    }).join('');
    return (
      '<div class="sim-mod sim-mod--relations">' +
        '<p class="sim-mod__lead">人际关系 · 每次叙事 API 会读取已有人物 · 回合中可认识新人</p>' +
        '<div class="sim-rel-toolbar">' +
          '<button type="button" class="sim-btn sim-btn--primary" data-sim-rel-add>手动添加</button>' +
          '<button type="button" class="sim-btn" data-sim-rel-gen>AI 生成</button>' +
        '</div>' +
        (npcs.length
          ? '<div class="sim-rel-list">' + cards + '</div>'
          : '<div class="sim-rel-empty"><p>尚无人际档案</p><p class="sim-ed-hint">可手动添加，或由 AI / 回合叙事自动加入。</p></div>') +
      '</div>'
    );
  }

  function readRelationFromDom(npcId) {
    function g(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }
    return {
      id: npcId,
      name: g('sim-rel-name').trim(),
      gender: g('sim-rel-gender').trim(),
      age: g('sim-rel-age'),
      identity: g('sim-rel-identity').trim(),
      occupation: g('sim-rel-occupation').trim(),
      affinity: parseInt(g('sim-rel-affinity'), 10) || 0,
      persona: g('sim-rel-persona').trim()
    };
  }

  function openRelationDetail(npcId) {
    relationUi.view = 'detail';
    relationUi.npcId = npcId;
    refreshModule('relations');
  }

  function closeRelationDetail() {
    relationUi.view = 'list';
    relationUi.npcId = null;
    refreshModule('relations');
  }

  function runRelationGenerate(sid) {
    var st = store();
    var eng = engine();
    if (!st || !eng || !eng.generateRelations) {
      toast('生成模块未就绪');
      return;
    }
    if (!st.isApiConfigured()) {
      toast('请先配置 API');
      return;
    }
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return;
    toast('人际生成中…');
    eng.generateRelations(script, save, { count: 2 })
      .then(function (rows) {
        toast('已添加 ' + rows.length + ' 位新人物');
        refreshModule('relations');
      })
      .catch(function (err) {
        toast(formatGenError(err));
      });
  }

  function bindSkillTree(wrapId, scriptId, pan2d) {
    bindSkillTreePan(wrapId, pan2d);
    bindSkillFruitDrag(wrapId, scriptId);
  }

  function bindSkillTreePan(wrapId, pan2d) {
    var wrap = document.getElementById(wrapId || 'sim-skill-tree-wrap');
    if (!wrap || wrap._simPanBound) return;
    wrap._simPanBound = true;
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var scrollLeft = 0;
    var scrollTop = 0;
    function onMove(e) {
      if (!dragging) return;
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      wrap.scrollLeft = scrollLeft - (clientX - startX);
      if (pan2d) wrap.scrollTop = scrollTop - (clientY - startY);
    }
    function onUp() {
      dragging = false;
      wrap.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    function beginDrag(clientX, clientY) {
      dragging = true;
      startX = clientX;
      startY = clientY;
      scrollLeft = wrap.scrollLeft;
      scrollTop = wrap.scrollTop;
      wrap.classList.add('is-dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    wrap.addEventListener('mousedown', function (e) {
      if (e.target.closest('.sim-skill-fruit')) return;
      beginDrag(e.clientX, e.clientY);
    });
    wrap.addEventListener('touchstart', function (e) {
      if (e.target.closest('.sim-skill-fruit')) return;
      beginDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    wrap.addEventListener('touchmove', onMove, { passive: true });
    wrap.addEventListener('touchend', onUp);
  }

  function bindSkillFruitDrag(wrapId, scriptId) {
    var wrap = document.getElementById(wrapId || 'sim-skill-tree-wrap');
    if (!wrap || wrap._simFruitDragBound) return;
    wrap._simFruitDragBound = true;
    var st = store();
    var drag = null;
    var DRAG_THRESHOLD = 6;

    function resolveScriptId() {
      if (scriptId) return scriptId;
      var mod = wrap.closest('[data-sim-script-id]');
      return mod ? mod.getAttribute('data-sim-script-id') : '';
    }

    function clampPos(x, y, tree) {
      var w = tree.offsetWidth;
      var h = tree.offsetHeight;
      return {
        x: Math.max(48, Math.min(w - 48, x)),
        y: Math.max(40, Math.min(h - 100, y))
      };
    }

    function finishDrag(commit) {
      if (!drag) return;
      var d = drag;
      drag = null;
      d.fruit.classList.remove('is-pos-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      if (!commit || !d.moved) return;
      d.fruit._simSkipClick = true;
      var sid = resolveScriptId();
      var skillId = d.fruit.getAttribute('data-sim-skill-id');
      if (!sid || !skillId) return;
      var skill = st.getSkills(sid).find(function (s) { return s.id === skillId; });
      if (!skill) return;
      var treeW = d.tree.offsetWidth;
      var treeH = d.tree.offsetHeight;
      var left = parseFloat(d.fruit.style.left) || 0;
      var top = parseFloat(d.fruit.style.top) || 0;
      st.upsertSkill(sid, Object.assign({}, skill, {
        treeX: left / treeW,
        treeY: top / treeH
      }));
      updateSkillTwigForFruit(d.fruit, left, top);
    }

    function onMove(e) {
      if (!drag) return;
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      var dx = clientX - drag.startClientX;
      var dy = clientY - drag.startClientY;
      if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        drag.moved = true;
        drag.fruit.classList.add('is-pos-dragging');
      }
      if (!drag.moved) return;
      if (e.cancelable) e.preventDefault();
      var pos = clampPos(drag.originX + dx, drag.originY + dy, drag.tree);
      drag.fruit.style.left = pos.x + 'px';
      drag.fruit.style.top = pos.y + 'px';
      updateSkillTwigForFruit(drag.fruit, pos.x, pos.y);
    }

    function onUp() {
      finishDrag(true);
    }

    function beginDrag(fruit, clientX, clientY) {
      var tree = fruit.closest('.sim-skill-tree');
      if (!tree) return;
      drag = {
        fruit: fruit,
        tree: tree,
        startClientX: clientX,
        startClientY: clientY,
        originX: parseFloat(fruit.style.left) || 0,
        originY: parseFloat(fruit.style.top) || 0,
        moved: false
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }

    wrap.addEventListener('mousedown', function (e) {
      if (e.target.closest('[data-sim-skill-del]')) return;
      var fruit = e.target.closest('.sim-skill-fruit');
      if (!fruit) return;
      e.stopPropagation();
      beginDrag(fruit, e.clientX, e.clientY);
    });

    wrap.addEventListener('touchstart', function (e) {
      if (e.target.closest('[data-sim-skill-del]')) return;
      var fruit = e.target.closest('.sim-skill-fruit');
      if (!fruit) return;
      e.stopPropagation();
      beginDrag(fruit, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  function setSkillGenOverlay(show) {
    ['sim-skill-gen-overlay', 'sim-skill-fs-gen-overlay'].forEach(function (id) {
      setGenOverlay(id, show);
    });
  }

  function readSkillGenCount() {
    var el = document.getElementById('sim-skill-gen-count') ||
      document.getElementById('sim-skill-fs-gen-count');
    var n = el ? parseInt(el.value, 10) : 4;
    if (isNaN(n)) n = 4;
    return Math.max(1, Math.min(12, n));
  }

  function formatGenError(err) {
    var eng = engine();
    if (eng && eng.formatPlayGenError) return eng.formatPlayGenError(err);
    return err && err.message ? String(err.message) : '未知错误';
  }

  function setGenOverlay(id, show) {
    var el = document.getElementById(id);
    if (el) el.hidden = !show;
  }

  function promptText(title, defaultValue, placeholder) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt({ title: title, defaultValue: defaultValue || '', placeholder: placeholder || '' });
    }
    return Promise.resolve(prompt(title, defaultValue || ''));
  }

  function confirmAction(title, message) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm({ title: title, message: message });
    }
    return Promise.resolve(window.confirm(message || title));
  }

  function ensureSkillEditLayer() {
    var layer = document.getElementById('sim-skill-edit-layer');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'sim-skill-edit-layer';
    layer.className = 'sim-skill-edit-layer';
    layer.hidden = true;
    layer.innerHTML =
      '<div class="sim-skill-edit-layer__veil" data-sim-skill-edit-close></div>' +
      '<form class="sim-skill-edit-layer__card" id="sim-skill-edit-form">' +
        '<header class="sim-skill-edit-layer__head">' +
          '<h3 id="sim-skill-edit-title">编辑技能</h3>' +
          '<button type="button" class="sim-skill-edit-layer__x" data-sim-skill-edit-close aria-label="关闭">×</button>' +
        '</header>' +
        '<label class="sim-skill-edit-field">' +
          '<span>技能名称</span>' +
          '<input type="text" id="sim-skill-edit-name" maxlength="24" placeholder="2-8 字" required>' +
        '</label>' +
        '<label class="sim-skill-edit-field">' +
          '<span>技能介绍</span>' +
          '<textarea id="sim-skill-edit-desc" rows="4" maxlength="280" placeholder="用途与成长方向"></textarea>' +
        '</label>' +
        '<label class="sim-skill-edit-field sim-skill-edit-field--inline">' +
          '<span>等级</span>' +
          '<input type="number" id="sim-skill-edit-level" min="1" step="1">' +
          '<em class="sim-skill-edit-field__hint" id="sim-skill-edit-level-hint"></em>' +
        '</label>' +
        '<footer class="sim-skill-edit-layer__foot">' +
          '<button type="button" class="sim-btn" data-sim-skill-edit-close>取消</button>' +
          '<button type="submit" class="sim-btn sim-btn--primary">保存</button>' +
        '</footer>' +
      '</form>';
    document.body.appendChild(layer);
    return layer;
  }

  function editSkillDialog(skill) {
    var st = store();
    var prog = st.getSkillProgress(skill);
    var isNew = !String(skill.name || '').trim();
    var layer = ensureSkillEditLayer();
    var titleEl = document.getElementById('sim-skill-edit-title');
    var nameEl = document.getElementById('sim-skill-edit-name');
    var descEl = document.getElementById('sim-skill-edit-desc');
    var levelEl = document.getElementById('sim-skill-edit-level');
    var hintEl = document.getElementById('sim-skill-edit-level-hint');
    var form = document.getElementById('sim-skill-edit-form');
    if (!titleEl || !nameEl || !descEl || !levelEl || !form) {
      return Promise.resolve(null);
    }

    titleEl.textContent = isNew ? '添加技能' : '编辑技能';
    nameEl.value = skill.name || '';
    descEl.value = skill.desc || '';
    levelEl.value = String(prog.level);
    levelEl.max = String(st.SKILL_MAX_LEVEL);
    if (hintEl) hintEl.textContent = '1 – ' + st.SKILL_MAX_LEVEL + ' 级';

    return new Promise(function (resolve) {
      function close(val) {
        layer.hidden = true;
        form.removeEventListener('submit', onSubmit);
        layer.querySelectorAll('[data-sim-skill-edit-close]').forEach(function (btn) {
          btn.removeEventListener('click', onCancel);
        });
        resolve(val);
      }
      function onCancel() { close(null); }
      function onSubmit(e) {
        e.preventDefault();
        var name = String(nameEl.value || '').trim();
        if (!name) {
          toast('名称不能为空');
          nameEl.focus();
          return;
        }
        var level = parseInt(levelEl.value, 10);
        if (isNaN(level)) level = prog.level;
        level = Math.max(1, Math.min(st.SKILL_MAX_LEVEL, level));
        var row = {
          id: skill.id,
          name: name,
          desc: String(descEl.value || '').trim(),
          level: level,
          exp: st.skillExpForLevel(level)
        };
        if (skill.treeX != null) row.treeX = skill.treeX;
        if (skill.treeY != null) row.treeY = skill.treeY;
        close(row);
      }
      form.addEventListener('submit', onSubmit);
      layer.querySelectorAll('[data-sim-skill-edit-close]').forEach(function (btn) {
        btn.addEventListener('click', onCancel);
      });
      layer.hidden = false;
      setTimeout(function () { nameEl.focus(); nameEl.select(); }, 40);
    });
  }

  function editTalentDialog(talent) {
    return promptText('天赋名称', talent ? talent.name : '', '2-8 字').then(function (name) {
      if (name == null) return null;
      name = String(name).trim();
      if (!name) return toast('名称不能为空'), null;
      return promptText('天赋介绍', talent ? talent.desc : '', '天生特质').then(function (desc) {
        if (desc == null) return null;
        return {
          id: talent ? talent.id : uid('talent'),
          name: name,
          desc: String(desc || '').trim()
        };
      });
    });
  }

  function editAchievementDialog(ach) {
    return promptText('成就名称', ach ? ach.name : '', '奖杯标题').then(function (name) {
      if (name == null) return null;
      name = String(name).trim();
      if (!name) return toast('名称不能为空'), null;
      return promptText('成就介绍', ach ? ach.desc : '', '达成说明').then(function (desc) {
        if (desc == null) return null;
        return {
          id: ach ? ach.id : uid('ach'),
          name: name,
          desc: String(desc || '').trim(),
          turn: ach ? ach.turn : 0,
          auto: ach ? ach.auto : false
        };
      });
    });
  }

  function runSkillGenerate(sid, mode) {
    var st = store();
    var eng = engine();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!eng || !script || !save) return;
    if (!st.isApiConfigured()) {
      toast('请先在 API 设置中配置接口地址、Key 和模型');
      return;
    }
    var count = readSkillGenCount();
    if (mode === 'regen') {
      confirmAction('重新生成', '将清空现有技能并重新生成 ' + count + ' 个技能，确定？').then(function (ok) {
        if (!ok) return;
        doGen(count);
      });
      return;
    }
    doGen(count);

    function doGen(genCount) {
      setSkillGenOverlay(true);
      eng.generateSkills(script, save, { mode: mode, count: genCount }).then(function (rows) {
        var normalized = rows.map(function (r) {
          return st.normalizeSkill(Object.assign({ id: uid('skill') }, r));
        }).filter(Boolean);
        if (!normalized.length) throw new Error('empty_result');
        if (mode === 'regen') st.setSkills(sid, normalized);
        else {
          var existing = st.getSkills(sid);
          normalized.forEach(function (r) {
            if (existing.length < st.SKILL_MAX_COUNT) {
              st.upsertSkill(sid, r);
              existing = st.getSkills(sid);
            }
          });
        }
        toast('已生成 ' + normalized.length + ' 个技能');
        refreshSkillsViews(sid);
      }).catch(function (err) {
        toast('生成失败：' + formatGenError(err));
      }).finally(function () {
        setSkillGenOverlay(false);
      });
    }
  }

  function runTalentGenerate(sid) {
    var st = store();
    var eng = engine();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!eng || !script || !save) return;
    if (!st.isApiConfigured()) {
      toast('请先在 API 设置中配置模型');
      return;
    }
    promptText('生成几个天赋？', '3', '1-20').then(function (val) {
      if (val == null) return;
      var count = Math.max(1, Math.min(20, parseInt(val, 10) || 3));
      setGenOverlay('sim-talent-gen-overlay', true);
      eng.generateTalents(script, save, count).then(function (rows) {
        rows.forEach(function (r) {
          st.upsertTalent(sid, Object.assign({ id: uid('talent') }, r));
        });
        toast('已生成 ' + rows.length + ' 个天赋');
        refreshModule('talents');
      }).catch(function (err) {
        toast('生成失败：' + (err && err.message ? err.message : '未知错误'));
      }).finally(function () {
        setGenOverlay('sim-talent-gen-overlay', false);
      });
    });
  }

  function refreshModule(moduleId) {
    if (moduleId === 'skills') {
      refreshSkillsViews(scriptId());
      return;
    }
    if (global.miyaSimulatorApp && global.miyaSimulatorApp.refreshDrawerModule) {
      global.miyaSimulatorApp.refreshDrawerModule(moduleId);
    }
  }

  function renderProfileHtml(sid) {
    var st = store();
    var save = st.getSave(sid);
    if (!save) return '<p class="sim-ed-hint">暂无存档</p>';
    var p = save.player || st.normalizePlayerProfile({}, null);
    var ava = p.avatar
      ? '<img src="' + esc(p.avatar) + '" alt="">'
      : '<span class="sim-journal__ava-ph">' + esc((p.name || '我').charAt(0)) + '</span>';

    return (
      '<div class="sim-mod sim-mod--journal">' +
        '<div class="sim-journal">' +
          '<div class="sim-journal__binder" aria-hidden="true"></div>' +
          '<div class="sim-journal__rings" aria-hidden="true"><span></span><span></span><span></span></div>' +
          '<header class="sim-journal__head">' +
            '<span class="sim-journal__tag">PLAYER FILE</span>' +
            '<h3>身份手帐</h3>' +
            '<p class="sim-journal__stamp">可随时编辑 · 即时保存</p>' +
          '</header>' +
          '<div class="sim-journal__hero">' +
            '<label class="sim-journal__ava" title="点击更换头像">' +
              '<input type="file" id="sim-profile-avatar" accept="image/*" hidden>' +
              '<span class="sim-journal__ava-ring">' + ava + '</span>' +
              '<em>点击换头像</em>' +
            '</label>' +
            '<div class="sim-journal__name-block">' +
              '<label><span>姓名</span><input type="text" id="sim-profile-name" value="' + esc(p.name) + '"></label>' +
              '<label><span>性别</span><input type="text" id="sim-profile-gender" value="' + esc(p.gender) + '" placeholder="男/女/其他"></label>' +
            '</div>' +
          '</div>' +
          '<div class="sim-journal__grid">' +
            journalField('sim-profile-birthday', '生日', p.birthday, '如 2001-03-14 或 三月十四') +
            journalField('sim-profile-age', '年龄', p.age, '', 'number') +
            journalField('sim-profile-identity', '身份', p.identity, '社会身份、头衔') +
            journalField('sim-profile-occupation', '职业', p.occupation, '当前职业') +
          '</div>' +
          journalArea('sim-profile-appearance', '外貌', p.appearance, '五官、发型、气质…') +
          journalArea('sim-profile-personality', '性格', p.personality, '性格关键词、习惯…') +
          '<section class="sim-journal__status">' +
            '<div class="sim-journal__status-head">' +
              '<span class="sim-journal__status-tag">STATUS</span>' +
              '<h4>社会地位</h4>' +
              '<p class="sim-ed-hint">随回合推进可自动更新 · 也可随时手动设定</p>' +
            '</div>' +
            journalField('sim-profile-status-title', '地位头衔', p.statusTitle, '如：庶民、练习生、外门弟子') +
            journalArea('sim-profile-status-desc', '地位说明', p.statusDesc, '当前社会阶层、声望与处境…') +
          '</section>' +
          '<footer class="sim-journal__foot">' +
            '<button type="button" class="sim-btn sim-btn--primary" data-sim-profile-save>保存档案</button>' +
          '</footer>' +
          '<div class="sim-journal__deco sim-journal__deco--tape" aria-hidden="true"></div>' +
          '<div class="sim-journal__deco sim-journal__deco--clip" aria-hidden="true"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function journalField(id, label, val, ph, type) {
    type = type || 'text';
    return '<label class="sim-journal__field" for="' + id + '">' +
      '<span>' + esc(label) + '</span>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(val != null ? val : '') + '" placeholder="' + esc(ph || '') + '">' +
    '</label>';
  }

  function journalArea(id, label, val, ph) {
    return '<label class="sim-journal__field sim-journal__field--area" for="' + id + '">' +
      '<span>' + esc(label) + '</span>' +
      '<textarea id="' + id + '" rows="3" placeholder="' + esc(ph || '') + '">' + esc(val || '') + '</textarea>' +
    '</label>';
  }

  function renderAttrsHtml(sid) {
    var st = store();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    if (!script || !save) return '<p class="sim-ed-hint">暂无存档</p>';
    var stats = st.getPlayableStats(script, save);
    if (!stats.length) {
      return '<div class="sim-mod"><p class="sim-ed-hint">本剧本暂无可编辑属性。自定义剧本请在配置中添加「玩家数值机制」。</p></div>';
    }
    var rows = stats.map(function (row) {
      var pct = row.max > 0 ? Math.round((row.value / row.max) * 100) : 0;
      return '<button type="button" class="sim-attr-row" data-sim-attr-id="' + esc(row.id) + '" data-sim-attr-source="' + esc(row.source) + '">' +
        '<span class="sim-attr-row__name">' + esc(row.name) + '</span>' +
        '<span class="sim-attr-row__val" data-sim-attr-val="' + esc(row.id) + '">' + row.value + '</span>' +
        '<span class="sim-attr-row__max">/' + row.max + '</span>' +
        '<span class="sim-attr-row__bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="sim-attr-row__edit">编辑</span>' +
      '</button>';
    }).join('');

    return (
      '<div class="sim-mod sim-mod--attrs">' +
        '<p class="sim-mod__lead">本剧本养成数值 · 点击任一项编辑并保存 · 实时读取存档</p>' +
        '<div class="sim-attr-list" id="sim-attr-list">' + rows + '</div>' +
        '<p class="sim-ed-hint sim-attr-hint" id="sim-attr-hint">共 ' + stats.length + ' 项</p>' +
      '</div>'
    );
  }

  function readProfileFromDom() {
    function g(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }
    return {
      name: g('sim-profile-name').trim(),
      gender: g('sim-profile-gender').trim(),
      birthday: g('sim-profile-birthday').trim(),
      age: parseInt(g('sim-profile-age'), 10) || 18,
      identity: g('sim-profile-identity').trim(),
      occupation: g('sim-profile-occupation').trim(),
      appearance: g('sim-profile-appearance').trim(),
      personality: g('sim-profile-personality').trim(),
      statusTitle: g('sim-profile-status-title').trim(),
      statusDesc: g('sim-profile-status-desc').trim()
    };
  }

  function refreshAttrsList(sid) {
    var list = document.getElementById('sim-attr-list');
    if (!list) return;
    var st = store();
    var script = st.findScript(sid);
    var save = st.getSave(sid);
    var stats = st.getPlayableStats(script, save);
    stats.forEach(function (row) {
      var valEl = list.querySelector('[data-sim-attr-val="' + row.id + '"]');
      var bar = list.querySelector('[data-sim-attr-id="' + row.id + '"] .sim-attr-row__bar i');
      if (valEl) valEl.textContent = String(row.value);
      if (bar) {
        var pct = row.max > 0 ? Math.round((row.value / row.max) * 100) : 0;
        bar.style.width = pct + '%';
      }
    });
  }

  function bindModuleEvents(appEl) {
    if (!appEl || appEl._simModBound) return;
    appEl._simModBound = true;

    appEl.addEventListener('click', function (e) {
      var sid = scriptId();
      var st = store();
      if (!st) return;

      if (e.target.closest('#sim-ss-export')) {
        var bundle = st.exportScriptBundle(sid);
        if (!bundle) {
          toast('导出失败：存档数据异常');
          return;
        }
        downloadJson(bundle, 'miya-script-full-' + sid + '.json').then(function (ok) {
          if (ok) toast('已导出全部信息');
        });
        return;
      }
      if (e.target.closest('#sim-ss-export-config')) {
        var cfgBundle = st.exportScriptConfig(sid);
        if (!cfgBundle) {
          toast('导出失败');
          return;
        }
        downloadJson(cfgBundle, 'miya-script-config-' + sid + '.json').then(function (ok) {
          if (ok) toast('已导出剧本配置');
        });
        return;
      }
      if (e.target.closest('#sim-ss-import-cancel')) {
        hideImportTargetPanel();
        return;
      }
      if (e.target.closest('#sim-ss-import-confirm')) {
        confirmOtherImport();
        return;
      }
      if (e.target.closest('[data-sim-decor-copy-ref]')) {
        copyText(SHELL_REFERENCE).then(function () { toast('已复制 DOM 参考'); });
        return;
      }
      if (e.target.closest('[data-sim-decor-copy-sample]')) {
        copyText(st.DEFAULT_SCRIPT_DECOR_CSS || '').then(function () { toast('已复制示例 CSS'); });
        return;
      }
      if (e.target.closest('[data-sim-decor-copy-current]')) {
        var ta = document.getElementById('sim-decor-css');
        copyText(ta ? ta.value : '').then(function () { toast('已复制当前 CSS'); });
        return;
      }
      if (e.target.closest('[data-sim-decor-apply-live]')) {
        var cssLive = (document.getElementById('sim-decor-css') || {}).value || '';
        injectDecorCss(cssLive);
        toast(cssLive.trim() ? '已预览（未保存，关闭面板后恢复）' : '已恢复初始外观');
        return;
      }
      if (e.target.closest('[data-sim-decor-commit]')) {
        var cssApply = (document.getElementById('sim-decor-css') || {}).value || '';
        st.setScriptDecorCss(cssApply);
        injectDecorCss(cssApply);
        toast(cssApply.trim() ? '已应用（全剧本通用）' : '已恢复初始外观');
        return;
      }
      if (e.target.closest('[data-sim-decor-clear]')) {
        st.setScriptDecorCss('');
        injectDecorCss('');
        var taClr = document.getElementById('sim-decor-css');
        if (taClr) taClr.value = '';
        toast('已清除装修');
        return;
      }
      if (e.target.closest('[data-sim-decor-save]')) {
        var cssSave = (document.getElementById('sim-decor-css') || {}).value || '';
        var nameFn = global.miyaDialog && global.miyaDialog.prompt
          ? global.miyaDialog.prompt({ title: '装修包名称', defaultValue: '我的剧本装修', placeholder: '名称' })
          : Promise.resolve(prompt('装修包名称', '我的剧本装修'));
        nameFn.then(function (name) {
          if (!name) return;
          st.saveScriptDecorPreset(name, cssSave);
          injectDecorCss(cssSave);
          toast('装修包已保存');
          if (global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('appearance');
          }
        });
        return;
      }
      var applyPreset = e.target.closest('[data-sim-decor-apply]');
      if (applyPreset) {
        var pid = applyPreset.getAttribute('data-sim-decor-apply');
        var preset = st.applyScriptDecorPreset(pid);
        if (preset) {
          injectDecorCss(preset.css);
          if (global.miyaSimulatorApp.refreshDrawerModule) {
            global.miyaSimulatorApp.refreshDrawerModule('appearance');
          }
          toast('已切换：' + preset.name);
        }
        return;
      }
      var delPreset = e.target.closest('[data-sim-decor-del]');
      if (delPreset) {
        st.removeScriptDecorPreset(delPreset.getAttribute('data-sim-decor-del'));
        applyDecorFromStore();
        if (global.miyaSimulatorApp.refreshDrawerModule) {
          global.miyaSimulatorApp.refreshDrawerModule('appearance');
        }
        toast('已删除装修包');
        return;
      }
      if (e.target.closest('[data-sim-profile-save]')) {
        if (!sid) return;
        st.updatePlayerProfile(sid, readProfileFromDom());
        toast('档案已保存');
        if (global.miyaSimulatorApp.render) global.miyaSimulatorApp.render();
        return;
      }

      if (e.target.closest('[data-sim-rel-back]')) {
        closeRelationDetail();
        return;
      }
      var relOpen = e.target.closest('[data-sim-rel-open]');
      if (relOpen) {
        openRelationDetail(relOpen.getAttribute('data-sim-rel-open'));
        return;
      }
      if (e.target.closest('[data-sim-rel-add]') && sid) {
        var row = st.upsertNpc(sid, {
          id: uid('npc'),
          name: '新人物',
          metTurn: (st.getSave(sid) || {}).turn || 1
        });
        if (row) {
          toast('已添加，请完善档案');
          openRelationDetail(row.id);
        }
        return;
      }
      if (e.target.closest('[data-sim-rel-gen]') && sid) {
        runRelationGenerate(sid);
        return;
      }
      var relSave = e.target.closest('[data-sim-rel-save]');
      if (relSave && sid) {
        var rid = relSave.getAttribute('data-sim-rel-save');
        var patch = readRelationFromDom(rid);
        if (!patch.name) {
          toast('请填写姓名');
          return;
        }
        st.upsertNpc(sid, patch);
        toast('人际档案已保存');
        return;
      }
      var relDel = e.target.closest('[data-sim-rel-del]');
      if (relDel && sid) {
        var did = relDel.getAttribute('data-sim-rel-del');
        confirmAction('删除人物', '确定从人际档案中删除？').then(function (ok) {
          if (!ok) return;
          st.removeNpc(sid, did);
          toast('已删除');
          closeRelationDetail();
        });
        return;
      }
      if (e.target.id === 'sim-rel-avatar' && e.target.files && e.target.files[0] && sid) {
        var npcAid = e.target.getAttribute('data-sim-rel-avatar');
        var fileR = e.target.files[0];
        var readerR = new FileReader();
        readerR.onload = function () {
          var ava = String(readerR.result || '');
          var ring = document.querySelector('.sim-rel-detail__ava-ring');
          if (ring) ring.innerHTML = '<img src="' + esc(ava) + '" alt="">';
          var npcRow = st.getNpcs(sid).find(function (n) { return n.id === npcAid; });
          if (npcRow) st.upsertNpc(sid, Object.assign({}, npcRow, { avatar: ava }));
          toast('头像已更新');
        };
        readerR.readAsDataURL(fileR);
        e.target.value = '';
        return;
      }

      var skillGen = e.target.closest('[data-sim-skill-gen]');
      if (skillGen && sid) {
        runSkillGenerate(sid, skillGen.getAttribute('data-sim-skill-gen'));
        return;
      }
      if (e.target.closest('[data-sim-skill-fullscreen]') && sid) {
        openSkillFullscreen(sid);
        return;
      }
      if (e.target.closest('[data-sim-skill-fs-close]')) {
        closeSkillFullscreen();
        return;
      }
      if (e.target.closest('[data-sim-skill-add]') && sid) {
        editSkillDialog({ id: uid('skill'), name: '', desc: '', level: 1, exp: 0 }).then(function (row) {
          if (!row) return;
          if (st.upsertSkill(sid, row)) {
            toast('技能已添加');
            refreshSkillsViews(sid);
          } else toast('已达上限 ' + st.SKILL_MAX_COUNT + ' 个技能');
        });
        return;
      }
      var skillDel = e.target.closest('[data-sim-skill-del]');
      if (skillDel && sid) {
        e.stopPropagation();
        var delId = skillDel.getAttribute('data-sim-skill-del');
        confirmAction('删除技能', '确定删除该技能？').then(function (ok) {
          if (!ok) return;
          st.removeSkill(sid, delId);
          toast('已删除技能');
          refreshSkillsViews(sid);
        });
        return;
      }
      var skillBtn = e.target.closest('[data-sim-skill-id]');
      if (skillBtn && sid) {
        if (skillBtn._simSkipClick) {
          skillBtn._simSkipClick = false;
          return;
        }
        var skillId = skillBtn.getAttribute('data-sim-skill-id');
        var skill = st.getSkills(sid).find(function (s) { return s.id === skillId; });
        if (!skill) return;
        editSkillDialog(skill).then(function (row) {
          if (!row) return;
          st.upsertSkill(sid, row);
          toast('技能已更新');
          refreshSkillsViews(sid);
        });
        return;
      }

      if (e.target.closest('[data-sim-talent-add]') && sid) {
        editTalentDialog(null).then(function (row) {
          if (!row) return;
          st.upsertTalent(sid, row);
          toast('天赋已添加');
          refreshModule('talents');
        });
        return;
      }
      if (e.target.closest('[data-sim-talent-gen]') && sid) {
        runTalentGenerate(sid);
        return;
      }
      var talentEdit = e.target.closest('[data-sim-talent-edit]');
      if (talentEdit && sid) {
        var tid = talentEdit.getAttribute('data-sim-talent-edit');
        var talent = st.getTalents(sid).find(function (t) { return t.id === tid; });
        if (!talent) return;
        editTalentDialog(talent).then(function (row) {
          if (!row) return;
          st.upsertTalent(sid, row);
          toast('天赋已更新');
          refreshModule('talents');
        });
        return;
      }
      var talentDel = e.target.closest('[data-sim-talent-del]');
      if (talentDel && sid) {
        st.removeTalent(sid, talentDel.getAttribute('data-sim-talent-del'));
        toast('已删除天赋');
        refreshModule('talents');
        return;
      }

      if (e.target.closest('[data-sim-ach-add]') && sid) {
        editAchievementDialog(null).then(function (row) {
          if (!row) return;
          var save = st.getSave(sid);
          row.turn = save ? save.turn : 1;
          st.upsertAchievement(sid, row);
          toast('成就已添加');
          refreshModule('achieve');
        });
        return;
      }
      var achEdit = e.target.closest('[data-sim-ach-edit]');
      if (achEdit && sid) {
        var aid = achEdit.getAttribute('data-sim-ach-edit');
        var ach = st.getAchievements(sid).find(function (a) { return a.id === aid; });
        if (!ach) return;
        editAchievementDialog(ach).then(function (row) {
          if (!row) return;
          st.upsertAchievement(sid, row);
          toast('成就已更新');
          refreshModule('achieve');
        });
        return;
      }

      var attrBtn = e.target.closest('[data-sim-attr-id]');
      if (attrBtn) {
        var statId = attrBtn.getAttribute('data-sim-attr-id');
        var source = attrBtn.getAttribute('data-sim-attr-source');
        var script = st.findScript(sid);
        var save = st.getSave(sid);
        var stats = st.getPlayableStats(script, save);
        var row = stats.find(function (s) { return s.id === statId; });
        if (!row) return;
        var promptFn = global.miyaDialog && global.miyaDialog.prompt
          ? global.miyaDialog.prompt({
            title: '编辑 · ' + row.name,
            defaultValue: String(row.value),
            placeholder: '0 – ' + row.max
          })
          : Promise.resolve(prompt('新数值（0-' + row.max + '）', String(row.value)));
        promptFn.then(function (val) {
          if (val == null || val === '') return;
          st.setPlayableStat(sid, statId, val, source);
          refreshAttrsList(sid);
          toast(row.name + ' → ' + val);
        });
      }
    });

    appEl.addEventListener('change', function (e) {
      var sid = scriptId();
      var stCh = store();
      if (!stCh) return;
      if (e.target.id === 'sim-ss-import-current' && e.target.files && e.target.files[0]) {
        handleImportCurrentFile(e.target.files[0]);
        e.target.value = '';
      }
      if (e.target.id === 'sim-ss-import-other' && e.target.files && e.target.files[0]) {
        handleImportOtherFile(e.target.files[0]);
        e.target.value = '';
      }
      if (e.target.id === 'sim-ss-import' && e.target.files && e.target.files[0]) {
        var fFull = e.target.files[0];
        e.target.value = '';
        var readerFull = new FileReader();
        readerFull.onload = function () {
          try {
            var b = JSON.parse(String(readerFull.result || ''));
            var rowFull = stCh.importScriptBundle(b, {});
            if (rowFull) {
              toast('已导入：' + rowFull.title);
              global.miyaSimulatorApp.closeScriptSettings();
              global.miyaSimulatorApp.openScript(rowFull.id);
            } else toast('导入格式无效');
          } catch (err) {
            toast('JSON 解析失败');
          }
        };
        readerFull.readAsText(fFull);
      }
      if (e.target.id === 'sim-profile-avatar' && e.target.files && e.target.files[0]) {
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          var ava = String(reader.result || '');
          var ring = document.querySelector('.sim-journal__ava-ring');
          if (ring) ring.innerHTML = '<img src="' + esc(ava) + '" alt="">';
          if (sid) stCh.updatePlayerProfile(sid, { avatar: ava });
          toast('头像已更新');
          if (global.miyaSimulatorApp.render) global.miyaSimulatorApp.render();
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      }
    });
  }

  global.MiyaSimulatorPlayModules = {
    STYLE_ID: STYLE_ID,
    applyDecorFromStore: applyDecorFromStore,
    injectDecorCss: injectDecorCss,
    renderSettingsOverlay: renderSettingsOverlay,
    renderAppearanceHtml: renderAppearanceHtml,
    renderProfileHtml: renderProfileHtml,
    renderAttrsHtml: renderAttrsHtml,
    renderSkillsHtml: renderSkillsHtml,
    renderTalentsHtml: renderTalentsHtml,
    renderAchievementsHtml: renderAchievementsHtml,
    renderRelationsHtml: renderRelationsHtml,
    closeRelationDetail: closeRelationDetail,
    bindSkillTreePan: bindSkillTreePan,
    bindSkillTree: bindSkillTree,
    openSkillFullscreen: openSkillFullscreen,
    closeSkillFullscreen: closeSkillFullscreen,
    refreshAttrsList: refreshAttrsList,
    bindModuleEvents: bindModuleEvents,
    SHELL_REFERENCE: SHELL_REFERENCE
  };
})(window);
