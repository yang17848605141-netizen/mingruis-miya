/**
 * miya-typewriter-vessels.js — 八种截然不同的典籍置物器
 * 超过八本时按索引循环复用
 */
(function (global) {
  'use strict';

  var VESSEL_ORDER = [
    'typewriter',
    'watch',
    'phone',
    'inkwell',
    'gramophone',
    'candlestick',
    'lunarium',
    'telescope'
  ];

  var VESSEL_LABELS = {
    typewriter: 'Remington · No. 7',
    watch: 'Pocket Chronometer',
    phone: 'Bakelite Receiver',
    inkwell: 'Quill & Inkstand',
    gramophone: 'His Master\'s Voice',
    candlestick: 'Wax & Wick',
    lunarium: 'Lunar Orrery',
    telescope: 'Brass Refractor'
  };

  function vesselHtml(vessel) {
    switch (vessel) {
      case 'watch': return watchHtml();
      case 'phone': return phoneHtml();
      case 'inkwell': return inkwellHtml();
      case 'gramophone': return gramophoneHtml();
      case 'candlestick': return candlestickHtml();
      case 'lunarium': return lunariumHtml();
      case 'telescope': return telescopeHtml();
      default: return typewriterHtml();
    }
  }

  function typewriterHtml() {
    return (
      '<div class="tw-v tw-v--typewriter" aria-hidden="true">' +
        '<div class="tw-v-tw__scene">' +
          '<div class="tw-v-tw__hood"></div>' +
          '<div class="tw-v-tw__platen">' +
            '<span class="tw-v-tw__roller tw-v-tw__roller--l"></span>' +
            '<span class="tw-v-tw__roller tw-v-tw__roller--r"></span>' +
            '<div class="tw-v-tw__sheet">' +
              '<span class="tw-v-tw__typed"></span>' +
              '<span class="tw-v-tw__typed tw-v-tw__typed--short"></span>' +
              '<span class="tw-v-tw__caret"></span>' +
            '</div>' +
          '</div>' +
          '<div class="tw-v-tw__carriage">' +
            '<span class="tw-v-tw__rail"></span>' +
            '<span class="tw-v-tw__return"></span>' +
          '</div>' +
          '<div class="tw-v-tw__deck">' +
            '<div class="tw-v-tw__row tw-v-tw__row--back">' +
              '<span></span><span></span><span></span><span></span><span></span><span></span><span></span>' +
            '</div>' +
            '<div class="tw-v-tw__row tw-v-tw__row--mid">' +
              '<span></span><span></span><span class="tw-v-tw__key-hit"></span><span></span><span></span><span></span><span></span>' +
            '</div>' +
            '<div class="tw-v-tw__row tw-v-tw__row--front">' +
              '<span></span><span></span><span></span><span></span><span></span>' +
            '</div>' +
            '<span class="tw-v-tw__spacebar"></span>' +
          '</div>' +
          '<div class="tw-v-tw__chassis">' +
            '<span class="tw-v-tw__badge">REMINGTON</span>' +
            '<span class="tw-v-tw__foot tw-v-tw__foot--l"></span>' +
            '<span class="tw-v-tw__foot tw-v-tw__foot--r"></span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function watchHtml() {
    return (
      '<div class="tw-v tw-v--watch" aria-hidden="true">' +
        '<div class="tw-v-wt__velvet">' +
          '<div class="tw-v-wt__chain">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
          '</div>' +
          '<div class="tw-v-wt__case">' +
            '<div class="tw-v-wt__bezel"></div>' +
            '<div class="tw-v-wt__dial">' +
              '<span class="tw-v-wt__tick tw-v-wt__tick--12"></span>' +
              '<span class="tw-v-wt__tick tw-v-wt__tick--3"></span>' +
              '<span class="tw-v-wt__tick tw-v-wt__tick--6"></span>' +
              '<span class="tw-v-wt__tick tw-v-wt__tick--9"></span>' +
              '<span class="tw-v-wt__num tw-v-wt__num--12">XII</span>' +
              '<span class="tw-v-wt__num tw-v-wt__num--3">III</span>' +
              '<span class="tw-v-wt__num tw-v-wt__num--6">VI</span>' +
              '<span class="tw-v-wt__num tw-v-wt__num--9">IX</span>' +
              '<span class="tw-v-wt__hand tw-v-wt__hand--hour"></span>' +
              '<span class="tw-v-wt__hand tw-v-wt__hand--minute"></span>' +
              '<span class="tw-v-wt__hand tw-v-wt__hand--second"></span>' +
              '<span class="tw-v-wt__jewel"></span>' +
            '</div>' +
            '<div class="tw-v-wt__crown"></div>' +
            '<div class="tw-v-wt__hinge"></div>' +
          '</div>' +
          '<div class="tw-v-wt__fob">CHRONOMETER</div>' +
        '</div>' +
      '</div>'
    );
  }

  function phoneHtml() {
    return (
      '<div class="tw-v tw-v--phone" aria-hidden="true">' +
        '<div class="tw-v-ph__scene">' +
          '<div class="tw-v-ph__handset">' +
            '<span class="tw-v-ph__grip"></span>' +
            '<span class="tw-v-ph__earcup"></span>' +
            '<span class="tw-v-ph__mouthcup"></span>' +
          '</div>' +
          '<div class="tw-v-ph__cradle">' +
            '<span class="tw-v-ph__cradle-arm tw-v-ph__cradle-arm--l"></span>' +
            '<span class="tw-v-ph__cradle-arm tw-v-ph__cradle-arm--r"></span>' +
          '</div>' +
          '<div class="tw-v-ph__body">' +
            '<div class="tw-v-ph__dial">' +
              '<span class="tw-v-ph__dial-ring"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--1"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--2"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--3"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--4"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--5"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--6"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--7"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--8"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--9"></span>' +
              '<span class="tw-v-ph__dial-hole tw-v-ph__dial-hole--0"></span>' +
              '<span class="tw-v-ph__finger"></span>' +
            '</div>' +
            '<span class="tw-v-ph__hook"></span>' +
          '</div>' +
          '<span class="tw-v-ph__pulse tw-v-ph__pulse--1"></span>' +
          '<span class="tw-v-ph__pulse tw-v-ph__pulse--2"></span>' +
        '</div>' +
      '</div>'
    );
  }

  function inkwellHtml() {
    return (
      '<div class="tw-v tw-v--inkwell" aria-hidden="true">' +
        '<div class="tw-v-ik__desk">' +
          '<div class="tw-v-ik__parchment"></div>' +
          '<div class="tw-v-ik__stand">' +
            '<div class="tw-v-ik__pot">' +
              '<div class="tw-v-ik__glass"></div>' +
              '<div class="tw-v-ik__ink">' +
                '<span class="tw-v-ik__ripple tw-v-ik__ripple--1"></span>' +
                '<span class="tw-v-ik__ripple tw-v-ik__ripple--2"></span>' +
              '</div>' +
              '<div class="tw-v-ik__rim"></div>' +
              '<div class="tw-v-ik__seal">W</div>' +
            '</div>' +
            '<div class="tw-v-ik__quill">' +
              '<div class="tw-v-ik__feather"></div>' +
              '<div class="tw-v-ik__nib"></div>' +
              '<div class="tw-v-ik__drop"></div>' +
            '</div>' +
            '<div class="tw-v-ik__blot"></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function gramophoneHtml() {
    return (
      '<div class="tw-v tw-v--gramophone" aria-hidden="true">' +
        '<div class="tw-v-gr__stage">' +
          '<div class="tw-v-gr__cabinet">' +
            '<div class="tw-v-gr__lid"></div>' +
            '<div class="tw-v-gr__turntable">' +
              '<div class="tw-v-gr__disc">' +
                '<span class="tw-v-gr__label">HMV</span>' +
                '<span class="tw-v-gr__groove"></span>' +
              '</div>' +
              '<div class="tw-v-gr__tonearm">' +
                '<span class="tw-v-gr__needle"></span>' +
              '</div>' +
            '</div>' +
            '<div class="tw-v-gr__crank"></div>' +
          '</div>' +
          '<div class="tw-v-gr__horn">' +
            '<div class="tw-v-gr__horn-inner"></div>' +
            '<div class="tw-v-gr__horn-mouth"></div>' +
          '</div>' +
          '<div class="tw-v-gr__sound">' +
            '<span></span><span></span><span></span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function candlestickHtml() {
    return (
      '<div class="tw-v tw-v--candlestick" aria-hidden="true">' +
        '<div class="tw-v-cd__niche">' +
          '<div class="tw-v-cd__arch"></div>' +
          '<div class="tw-v-cd__candelabra">' +
            '<div class="tw-v-cd__arm tw-v-cd__arm--l">' +
              '<div class="tw-v-cd__cup"></div>' +
              '<div class="tw-v-cd__candle">' +
                '<div class="tw-v-cd__wax-drip"></div>' +
                '<div class="tw-v-cd__flame">' +
                  '<span class="tw-v-cd__flame-core"></span>' +
                  '<span class="tw-v-cd__flame-glow"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="tw-v-cd__stem"></div>' +
            '<div class="tw-v-cd__arm tw-v-cd__arm--r">' +
              '<div class="tw-v-cd__cup"></div>' +
              '<div class="tw-v-cd__candle tw-v-cd__candle--short">' +
                '<div class="tw-v-cd__flame tw-v-cd__flame--small">' +
                  '<span class="tw-v-cd__flame-core"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="tw-v-cd__base"></div>' +
          '</div>' +
          '<div class="tw-v-cd__warmth"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function lunariumHtml() {
    return (
      '<div class="tw-v tw-v--lunarium" aria-hidden="true">' +
        '<div class="tw-v-lu__frame">' +
          '<div class="tw-v-lu__orbit tw-v-lu__orbit--outer">' +
            '<span class="tw-v-lu__mark"></span>' +
            '<span class="tw-v-lu__mark"></span>' +
            '<span class="tw-v-lu__mark"></span>' +
            '<span class="tw-v-lu__mark"></span>' +
          '</div>' +
          '<div class="tw-v-lu__orbit tw-v-lu__orbit--mid">' +
            '<div class="tw-v-lu__arm">' +
              '<div class="tw-v-lu__moon-disc">' +
                '<span class="tw-v-lu__phase tw-v-lu__phase--1"></span>' +
                '<span class="tw-v-lu__phase tw-v-lu__phase--2"></span>' +
                '<span class="tw-v-lu__phase tw-v-lu__phase--3"></span>' +
                '<span class="tw-v-lu__phase tw-v-lu__phase--4"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="tw-v-lu__hub">' +
            '<span class="tw-v-lu__hub-ring"></span>' +
            '<span class="tw-v-lu__hub-core"></span>' +
          '</div>' +
          '<div class="tw-v-lu__stars">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
          '</div>' +
          '<div class="tw-v-lu__engrave">LUNAR ORRERY</div>' +
        '</div>' +
      '</div>'
    );
  }

  function telescopeHtml() {
    return (
      '<div class="tw-v tw-v--telescope" aria-hidden="true">' +
        '<div class="tw-v-tp__dome">' +
          '<div class="tw-v-tp__sky">' +
            '<span class="tw-v-tp__star tw-v-tp__star--1"></span>' +
            '<span class="tw-v-tp__star tw-v-tp__star--2"></span>' +
            '<span class="tw-v-tp__star tw-v-tp__star--3"></span>' +
            '<span class="tw-v-tp__star tw-v-tp__star--4"></span>' +
            '<span class="tw-v-tp__star tw-v-tp__star--5"></span>' +
            '<span class="tw-v-tp__comet"></span>' +
          '</div>' +
          '<div class="tw-v-tp__mount">' +
            '<div class="tw-v-tp__tripod">' +
              '<span class="tw-v-tp__leg tw-v-tp__leg--l"></span>' +
              '<span class="tw-v-tp__leg tw-v-tp__leg--r"></span>' +
              '<span class="tw-v-tp__leg tw-v-tp__leg--c"></span>' +
            '</div>' +
            '<div class="tw-v-tp__tube">' +
              '<div class="tw-v-tp__lens-front"></div>' +
              '<div class="tw-v-tp__body"></div>' +
              '<div class="tw-v-tp__finder"></div>' +
              '<div class="tw-v-tp__eyepiece"></div>' +
              '<div class="tw-v-tp__focus-knob"></div>' +
            '</div>' +
          '</div>' +
          '<div class="tw-v-tp__plaque">REFRACTOR · 1892</div>' +
        '</div>' +
      '</div>'
    );
  }

  function pickVessel(index) {
    return VESSEL_ORDER[index % VESSEL_ORDER.length];
  }

  function resolveVessel(book, index) {
    var vessel = String((book && book.vessel) || '');
    if (VESSEL_ORDER.indexOf(vessel) >= 0) return vessel;
    return pickVessel(index);
  }

  global.miyaTypewriterVessels = {
    ORDER: VESSEL_ORDER,
    LABELS: VESSEL_LABELS,
    html: vesselHtml,
    pick: pickVessel,
    resolve: resolveVessel
  };
})(window);
