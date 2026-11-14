/* 晨鐘 Morningbell — 前端（無外部套件）。讀 data/latest.json（每日資料管線）與 data/notes.json（每日判讀）。
   圖表工具（lineChart、barChart、candleChart、panel、kpi、meter…）沿用破曉 Daybreak。漲跌顏色採台灣慣例：紅漲綠跌。 */
(function () {
  'use strict';
  var D = null, N = null;
  /* 語言（2026-11-15）：index.html 開頭決定 MB_LANG（?lang= → 自己選過的 → IP 地區 → 瀏覽器語言），英文時先載入 assets/i18n-en.js。
     _t：中文原句查字典，缺字回傳中文；_T：直接給兩種語言；tx：資料欄位的 *_en 版本；yi：「億」換成 NT$…B */
  var LANG = window.MB_LANG === 'en' ? 'en' : 'zh', EN = window.MB_EN || {};
  function _t(s) { return LANG === 'en' && EN[s] != null ? EN[s] : s; }
  function _T(zh, en) { return LANG === 'en' && en != null ? en : zh; }
  function tx(o, k) { return !o ? '' : LANG === 'en' && o[k + '_en'] ? o[k + '_en'] : o[k]; }
  function yi(v, d) { return v == null ? '—' : LANG === 'en' ? (v < 0 ? '−' : '') + 'NT$' + fmt.n(Math.abs(v) / 10, d == null ? 1 : d) + 'B' : fmt.n(v, 0) + ' 億'; }
  /* 英文版：把資料裡的中文換掉。有 *_en 的欄位直接用英文；固定的名稱、標籤查字典。quad 是拿來比對的值，不換（顯示時再 _t） */
  function locData(o, k) {
    if (LANG !== 'en' || !o || typeof o !== 'object') return o;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) { if (typeof o[i] === 'string') { if (EN[o[i]] != null) o[i] = EN[o[i]]; } else locData(o[i]); } return o; }
    Object.keys(o).forEach(function (key) {
      var v = o[key];
      if (/_en$/.test(key) || key === 'quad') return;
      if (o[key + '_en'] != null && o[key + '_en'] !== '') { o[key] = o[key + '_en']; return; }
      if (key === 'name' && typeof o.en === 'string' && o.en) { o.name = o.en; return; }   // 基金持股：資料裡有英文名
      if (typeof v === 'string') { if (EN[v] != null) o[key] = EN[v]; }
      else if (v && typeof v === 'object') locData(v);
    });
    return o;
  }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = {
    n: function (v, d) { return v == null || isNaN(v) ? '—' : (+v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); },
    usd: function (v) { return v == null ? '—' : '$' + fmt.n(v); },
    k: function (v) { return v == null ? '—' : (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K' : fmt.n(v)); },
    pct: function (v, d) { return v == null ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(d == null ? 1 : d) + '%'; },
    date: function (dn) { var t = new Date(dn * 864e5); return t.getUTCFullYear() + '/' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + t.getUTCDate()).slice(-2); },
    md: function (s) { return s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) : '—'; }
  };
  var dnOf = function (s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5); };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MQ = window.matchMedia('(max-width: 860px)');   // 行動版：導航橫排
  try { history.scrollRestoration = 'manual'; } catch (e) {}   // 由網址決定開在哪一版，不沿用瀏覽器記住的捲動位置

  /* ---------------- Tooltip ---------------- */
  var tip = null;
  function showTip(x, y, html) {
    if (!tip) tip = $('#tip');
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    var left = x + 16, top = y + 14;
    if (left + w > vw - 8) left = x - w - 16;
    if (top + h > vh - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  /* ---------------- Chart kit ---------------- */
  var mounted = [];
  function mount(el, draw) { if (!el) return; el._draw = draw; mounted.push(el); draw(el); }
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) {
    es.forEach(function (e) { var el = e.target; if (el._w !== el.clientWidth && el._draw) { el._w = el.clientWidth; el._draw(el); } });
  }) : null;
  function observe(el) { if (ro && el) { el._w = el.clientWidth; ro.observe(el); } }

  function niceStep(span, n) { var r = span / n, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function svgEl(W, Ht, inner, label) { return '<svg viewBox="0 0 ' + W + ' ' + Ht + '" width="' + W + '" height="' + Ht + '" role="img" aria-label="' + esc(label || '') + '">' + inner + '</svg>'; }
  function bisect(a, x) { var lo = 0, hi = a.length - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (a[m][0] < x) lo = m; else hi = m; } return Math.abs(a[lo][0] - x) <= Math.abs(a[hi][0] - x) ? lo : hi; }
  function animateLines(el) {
    if (reduced || el._drawn) return; el._drawn = true;
    el.querySelectorAll('path.ln').forEach(function (p) { try { var L = p.getTotalLength(); p.style.setProperty('--len', L); p.classList.add('draw'); } catch (e) {} });
  }

  /* 折線／面積圖：x 為日期序號（天）或數值；可對數 y；參考線、區段、標記；十字線 tooltip */
  function lineChart(el, cfg) {
    var W = Math.max(280, el.clientWidth), Ht = cfg.h || (W < 520 ? 210 : 260);
    var ML = cfg.ml || 8, MR = cfg.mr || 58, MT = 14, MB = 24, pw = W - ML - MR, ph = Ht - MT - MB;
    var all = []; cfg.series.forEach(function (s) { s.data.forEach(function (p) { if (p[1] != null) all.push(p); }); });
    if (all.length < 2) { el.innerHTML = _t('<p class="note">本日未取得資料。</p>'); return; }
    var x0 = cfg.x0 != null ? cfg.x0 : Math.min.apply(null, all.map(function (p) { return p[0]; }));
    var x1 = cfg.x1 != null ? cfg.x1 : Math.max.apply(null, all.map(function (p) { return p[0]; }));
    var ys = all.map(function (p) { return p[1]; }); (cfg.refs || []).forEach(function (r) { if (r.inRange !== false) ys.push(r.y); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (cfg.y0 != null) lo = Math.min(lo, cfg.y0); if (cfg.y1 != null) hi = Math.max(hi, cfg.y1);
    var lg = !!cfg.log, T = function (v) { return lg ? Math.log10(v) : v; };
    var tl = T(lo), th = T(hi), pad = (th - tl) * 0.08 || 1; tl -= pad; th += pad;
    var X = function (x) { return ML + (x - x0) / (x1 - x0 || 1) * pw; };
    var Y = function (v) { return MT + (1 - (T(v) - tl) / (th - tl)) * ph; };
    var s = '', yf = cfg.yFmt || function (v) { return fmt.k(v); };
    // y grid
    var ticks = [];
    if (lg) { [0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].forEach(function (t) { if (T(t) >= tl && T(t) <= th) ticks.push(t); }); if (ticks.length > 7) ticks = ticks.filter(function (t, i) { return i % 2 === 0; }); }
    else { var st = niceStep(th - tl, W < 520 ? 3 : 4); for (var t = Math.ceil(tl / st) * st; t <= th + 1e-9; t += st) ticks.push(+t.toFixed(10)); }
    ticks.forEach(function (t) { var y = Y(t); s += '<line class="gl" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (ML + pw + 8) + '" y="' + (y + 3.5).toFixed(1) + '">' + yf(t) + '</text>'; });
    // x ticks
    if (cfg.xType !== 'num') {
      var span = x1 - x0, step = span > 2500 ? 24 : span > 1100 ? 12 : span > 500 ? 6 : span > 150 ? 2 : 1, d = new Date(x0 * 864e5), lastX = -99;
      d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
      while (d.getTime() / 864e5 <= x1) {
        var mo = d.getUTCMonth();
        if ((step >= 12 ? mo === 0 && (step === 12 || d.getUTCFullYear() % 2 === 0) : mo % step === 0)) {
          var xx = X(d.getTime() / 864e5);
          if (xx - lastX > 46) { s += '<text class="ax" x="' + xx.toFixed(1) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + (step >= 12 || mo === 0 ? d.getUTCFullYear() : (String(d.getUTCFullYear()).slice(2) + '/' + (mo + 1))) + '</text>'; lastX = xx; }
        }
        d.setUTCMonth(d.getUTCMonth() + 1);
      }
    } else (cfg.xticks || []).forEach(function (t) { s += '<text class="ax" x="' + X(t[0]).toFixed(1) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + esc(t[1]) + '</text>'; });
    // vertical bands & lines
    (cfg.vbands || []).forEach(function (b) { var a = Math.max(ML, X(b.x0)), z = Math.min(ML + pw, X(b.x1)); if (z > a) s += '<rect x="' + a.toFixed(1) + '" y="' + MT + '" width="' + (z - a).toFixed(1) + '" height="' + ph + '" fill="' + (b.color || 'var(--flare-dim)') + '"/>' + (b.label ? '<text class="ax" x="' + (a + 6).toFixed(1) + '" y="' + (MT + 12) + '">' + esc(b.label) + '</text>' : ''); });
    (cfg.vlines || []).forEach(function (v) { var xx = X(v.x); if (xx < ML || xx > ML + pw) return; s += '<line x1="' + xx.toFixed(1) + '" x2="' + xx.toFixed(1) + '" y1="' + MT + '" y2="' + (MT + ph) + '" stroke="var(--ink-3)" stroke-dasharray="2 4" stroke-width="1"/>' + (v.label ? '<text class="ax" x="' + (xx + 5).toFixed(1) + '" y="' + (MT + ph - 6) + '">' + esc(v.label) + '</text>' : ''); });
    (cfg.hbands || []).forEach(function (b) { var a = Math.max(MT, Y(b.y1)), z = Math.min(MT + ph, Y(b.y0)); if (z <= a) return; s += '<rect x="' + ML + '" y="' + a.toFixed(1) + '" width="' + pw + '" height="' + Math.max(1, z - a).toFixed(1) + '" fill="' + b.color + '"/>'; });
    // refs
    (cfg.refs || []).forEach(function (r) { var y = Y(r.y); if (y < MT - 2 || y > MT + ph + 2) return; s += '<line class="ref" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + r.color + '"/>'; if (r.label) s += '<text class="reflab" x="' + (ML + 6) + '" y="' + (y + (r.below ? 13 : -5)).toFixed(1) + '" fill="' + r.color + '">' + esc(r.label) + '</text>'; });
    // series
    var defs = '';
    cfg.series.forEach(function (sr, si) {
      var pts = sr.data.filter(function (p) { return p[1] != null; }); if (pts.length < 2) return;
      var dpath = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('');
      if (sr.area) { var gid = 'g' + Math.random().toString(36).slice(2, 8); defs += '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sr.color + '" stop-opacity=".28"/><stop offset="1" stop-color="' + sr.color + '" stop-opacity="0"/></linearGradient>'; s += '<path d="' + dpath + 'L' + X(pts[pts.length - 1][0]).toFixed(1) + ',' + (MT + ph) + 'L' + X(pts[0][0]).toFixed(1) + ',' + (MT + ph) + 'Z" fill="url(#' + gid + ')"/>'; }
      s += '<path class="ln" d="' + dpath + '" stroke="' + sr.color + '" stroke-width="' + (sr.w || 2) + '"' + (sr.dash ? ' stroke-dasharray="' + sr.dash + '"' : '') + ' style="animation-delay:' + (si * 0.12) + 's"/>';
      if (sr.end !== false) { var lp = pts[pts.length - 1]; s += '<circle cx="' + X(lp[0]).toFixed(1) + '" cy="' + Y(lp[1]).toFixed(1) + '" r="4" fill="' + sr.color + '" stroke="var(--deck)" stroke-width="2"/>'; }
    });
    (cfg.marks || []).forEach(function (m) { var xx = X(m.x), yy = Y(m.y); s += '<circle cx="' + xx.toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="4.5" fill="var(--deck)" stroke="' + (m.color || 'var(--flare)') + '" stroke-width="2"/>' + (m.label ? '<text class="reflab" x="' + (xx + (m.left ? -8 : 8)).toFixed(1) + '" y="' + (yy + (m.below ? 15 : -8)).toFixed(1) + '" fill="' + (m.color || 'var(--flare)') + '"' + (m.left ? ' text-anchor="end"' : '') + '>' + esc(m.label) + '</text>' : ''); });
    s += '<line class="xh" x1="0" x2="0" y1="' + MT + '" y2="' + (MT + ph) + '" visibility="hidden"/><g class="hdots"></g><rect class="hit" x="' + ML + '" y="' + MT + '" width="' + pw + '" height="' + ph + '"/>';
    el.innerHTML = svgEl(W, Ht, '<defs>' + defs + '</defs>' + s, cfg.aria);
    animateLines(el);
    var svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), dots = svg.querySelector('.hdots'), hit = svg.querySelector('.hit');
    function move(ev) {
      var r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * W / r.width, xv = x0 + (mx - ML) / pw * (x1 - x0), rows = [], g = '', xs = null;
      cfg.series.forEach(function (sr) {
        var pts = sr.data.filter(function (p) { return p[1] != null; }); if (!pts.length || sr.tip === false) return;
        var i = bisect(pts, xv), p = pts[i]; if (xs == null) xs = p[0];
        g += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="4" fill="' + sr.color + '" stroke="var(--deck)" stroke-width="2"/>';
        rows.push('<div class="r"><i style="background:' + sr.color + '"></i><span>' + esc(sr.name) + '</span><b>' + (cfg.tipFmt || yf)(p[1]) + '</b></div>');
      });
      if (xs == null) return;
      xh.setAttribute('x1', X(xs)); xh.setAttribute('x2', X(xs)); xh.setAttribute('visibility', 'visible'); dots.innerHTML = g;
      showTip(ev.clientX, ev.clientY, '<div class="t">' + (cfg.xType === 'num' ? (cfg.xTipFmt ? cfg.xTipFmt(xs) : xs) : fmt.date(xs)) + '</div>' + rows.join(''));
    }
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', function () { xh.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; hideTip(); });
  }

  /* 長條圖：data [[label, value, tipHtml]]，正負配色 */
  function barChart(el, cfg) {
    var W = Math.max(280, el.clientWidth), Ht = cfg.h || 220, ML = 8, MR = 52, MT = 12, MB = cfg.mb || 24, pw = W - ML - MR, ph = Ht - MT - MB;
    var d = cfg.data; if (!d || !d.length) { el.innerHTML = _t('<p class="note">本日未取得資料。</p>'); return; }
    var vals = d.map(function (r) { return r[1]; }), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    var st = niceStep(hi - lo || 1, 4); lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
    var Y = function (v) { return MT + (1 - (v - lo) / (hi - lo || 1)) * ph; }, bw = pw / d.length, gap = Math.min(6, bw * 0.28), s = '';
    for (var t = lo; t <= hi + 1e-9; t += st) { var y = Y(t); s += '<line class="' + (Math.abs(t) < 1e-9 ? 'base' : 'gl') + '" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (ML + pw + 8) + '" y="' + (y + 3.5).toFixed(1) + '">' + (cfg.yFmt || fmt.k)(t) + '</text>'; }
    var every = Math.ceil(d.length / Math.max(1, Math.floor(pw / 46)));
    d.forEach(function (r, i) {
      var x = ML + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = Y(0), y = Y(r[1]), top = Math.min(y, y0), h = Math.max(1, Math.abs(y - y0));
      var col = cfg.color ? cfg.color(r, i) : (r[1] >= 0 ? 'var(--up)' : 'var(--down)');
      var rad = Math.min(4, w / 2);
      s += '<rect class="bar" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + rad + '" fill="' + col + '"' + (r[3] ? ' opacity=".45"' : '') + '><animate attributeName="height" from="0" to="' + h.toFixed(1) + '" dur="' + (reduced ? '0.01' : '0.7') + 's" fill="freeze"/></rect>';
      if (i % every === 0 || i === d.length - 1) s += '<text class="ax" x="' + (x + w / 2).toFixed(1) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + esc(r[0]) + '</text>';
    });
    el.innerHTML = svgEl(W, Ht, s, cfg.aria);
    el.querySelectorAll('.bar').forEach(function (b) {
      var r = d[+b.getAttribute('data-i')];
      b.addEventListener('pointermove', function (ev) { showTip(ev.clientX, ev.clientY, r[2] || ('<div class="t">' + esc(r[0]) + _t('</div><div class="r"><i style="background:currentColor"></i><span>值</span><b>') + fmt.n(r[1], 1) + '</b></div>')); });
      b.addEventListener('pointerleave', hideTip);
    });
  }

  /* K 線 */
  function candleChart(el, rows, lines) {
    var W = Math.max(280, el.clientWidth), Ht = W < 520 ? 240 : 300, ML = 8, MR = 62, MT = 12, MB = 24, pw = W - ML - MR, ph = Ht - MT - MB;
    var lo = Math.min.apply(null, rows.map(function (r) { return r[3]; })), hi = Math.max.apply(null, rows.map(function (r) { return r[2]; }));
    lines.forEach(function (l) { if (l.v > lo * 0.97 && l.v < hi * 1.03) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); } });
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var Y = function (v) { return MT + (1 - (v - lo) / (hi - lo)) * ph; }, bw = pw / rows.length, s = '', st = niceStep(hi - lo, 5);
    for (var t = Math.ceil(lo / st) * st; t <= hi; t += st) { var y = Y(t); s += '<line class="gl" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text class="ax" x="' + (ML + pw + 8) + '" y="' + (y + 3.5).toFixed(1) + '">' + fmt.k(t) + '</text>'; }
    var used = []; lines.filter(function (l) { return l.v >= lo && l.v <= hi; }).sort(function (a, b) { return b.v - a.v; }).forEach(function (l) { var y = Y(l.v), ty = y - 4; while (used.some(function (u) { return Math.abs(u - ty) < 12; })) ty += 13; used.push(ty); s += '<line class="ref" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + l.color + '"/><text class="reflab" x="' + (ML + 4) + '" y="' + ty.toFixed(1) + '" fill="' + l.color + '">' + esc(l.label) + '</text>'; });
    rows.forEach(function (r, i) {
      var x = ML + i * bw + bw / 2, up = r[4] >= r[1], col = up ? 'var(--up)' : 'var(--down)', w = Math.max(3, bw * 0.56);
      s += '<g class="cd" data-i="' + i + '"><rect x="' + (ML + i * bw) + '" y="' + MT + '" width="' + bw + '" height="' + ph + '" fill="transparent"/><line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + Y(r[2]).toFixed(1) + '" y2="' + Y(r[3]).toFixed(1) + '" stroke="' + col + '" stroke-width="1.4"/>' +
        '<rect x="' + (x - w / 2).toFixed(1) + '" y="' + Y(Math.max(r[1], r[4])).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1.5, Math.abs(Y(r[1]) - Y(r[4]))).toFixed(1) + '" rx="1.5" fill="' + col + '"/></g>';
      var ev = Math.ceil(rows.length / Math.max(1, Math.floor(pw / 52))); if ((i % ev === 0 && rows.length - 1 - i >= ev) || i === rows.length - 1) s += '<text class="ax" x="' + x.toFixed(1) + '" y="' + (Ht - 6) + '" text-anchor="middle">' + r[0] + '</text>';
    });
    el.innerHTML = svgEl(W, Ht, s, _t('近 20 日 K 線'));
    el.querySelectorAll('.cd').forEach(function (g) {
      var r = rows[+g.getAttribute('data-i')];
      g.addEventListener('pointermove', function (ev) { showTip(ev.clientX, ev.clientY, '<div class="t">' + r[0] + '</div>' + [[_t('開'), r[1]], [_t('高'), r[2]], [_t('低'), r[3]], [_t('收'), r[4]]].map(function (p) { return '<div class="r"><i style="background:' + (r[4] >= r[1] ? 'var(--up)' : 'var(--down)') + '"></i><span>' + p[0] + '</span><b>' + fmt.n(p[1]) + '</b></div>'; }).join('') + _t('<div class="r"><i></i><span>漲跌</span><b>') + fmt.pct((r[4] / r[1] - 1) * 100, 2) + '</b></div>'); });
      g.addEventListener('pointerleave', hideTip);
    });
  }

  /* 水平階梯（掛單簿、籌碼分布） */
  function ladderHtml(rows, opt) {
    var mx = Math.max.apply(null, rows.map(function (r) { return r.v; })) || 1;
    return '<div class="ladder' + (opt && opt.dense ? ' dense' : '') + '">' + rows.map(function (r, i) {
      return '<div class="row' + (r.cls ? ' ' + r.cls : '') + '" data-i="' + i + '"><span class="p">' + esc(r.label) + '</span><span class="b"><i style="width:' + (r.v / mx * 100).toFixed(1) + '%;background:' + r.color + ';animation-delay:' + (i * 0.015).toFixed(2) + 's"></i>' + (r.prev != null ? '<u style="position:absolute;top:-2px;bottom:-2px;left:' + (r.prev / mx * 100).toFixed(1) + '%;width:2px;background:var(--ink-2)"></u>' : '') + '</span><span class="m">' + esc(r.right) + '</span></div>';
    }).join('') + '</div>';
  }
  function bindLadder(el, rows) {
    el.querySelectorAll('.ladder .row').forEach(function (n) { var r = rows[+n.getAttribute('data-i')]; if (!r.tip) return; n.addEventListener('pointermove', function (ev) { showTip(ev.clientX, ev.clientY, r.tip); }); n.addEventListener('pointerleave', hideTip); });
  }

  /* ---------------- Shared bits ---------------- */
  function panel(cls, title, src, body, extra) { return '<section class="panel ' + cls + '"><div class="panel-h"><h2>' + title + '</h2>' + (extra || '') + (src ? '<span class="src">' + src + '</span>' : '') + '</div>' + body + '</section>'; }
  function kpi(k, v, n, bar, cls) { return '<div class="kpi"><span class="k">' + k + '</span><span class="v' + (cls ? ' ' + cls : '') + '">' + v + '</span>' + (n ? '<span class="n">' + n + '</span>' : '') + (bar != null ? '<span class="bar"><i style="width:' + Math.max(2, Math.min(100, bar)).toFixed(1) + '%"></i></span>' : '') + '</div>'; }
  function legend(items) { return '<div class="legend">' + items.map(function (it) { return '<span style="color:' + it[1] + '"><i class="' + (it[2] || '') + '"></i><b style="color:var(--ink-2);font-weight:400">' + esc(it[0]) + '</b></span>'; }).join('') + '</div>'; }
  function meter(lab, sub, pos, val, valSub, ticks) {
    return '<div class="meter"><span class="lab"><b>' + lab + '</b><span>' + sub + '</span></span><span class="track">' + (ticks || []).map(function (t) { return '<u style="left:' + t + '%"></u>'; }).join('') + '<em data-pos="' + Math.max(0, Math.min(100, pos)).toFixed(1) + '" style="left:0%"></em></span><span class="val">' + val + (valSub ? '<small>' + valSub + '</small>' : '') + '</span></div>';
  }
  function settleMeters(root) { requestAnimationFrame(function () { root.querySelectorAll('.meter em').forEach(function (e) { e.style.left = e.getAttribute('data-pos') + '%'; }); }); }

  function countUp(el, v, dec) {
    if (reduced || !el) return; var t0 = performance.now(), from = v * 0.82, dur = 1100;
    (function step(t) { var k = Math.max(0, Math.min(1, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 4); el.textContent = fmt.n(from + (v - from) * e, dec || 0); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  function tapeHtml() { var one = tapeItems(); return _t('<div class="tape" aria-label="今日數據帶"><div class="tape-track">') + one + one + '</div></div>'; }
  /* 數字解碼：每個數字先亂跳，再由左到右依序定格 */
  function decodeNums(root) {
    if (reduced || !root) return;
    root.querySelectorAll('.kpi .v, .watch .v, .news-sum b, .mod-h .idx').forEach(function (el, k) {
      var txt = el.textContent, f = 0, tot = 18 + k * 2;
      (function step() { f++; el.textContent = txt.replace(/\d/g, function (d, i) { return f / tot * txt.length > i ? d : String((Math.random() * 10) | 0); }); if (f < tot) setTimeout(step, 32); else el.textContent = txt; })();
    });
  }

  /* ================= 晨鐘：共用小工具 ================= */
  var Q = function (k) { return (D.quotes || {})[k] || null; };
  var cls = function (v) { return v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : ''; };
  var pc = function (v, d) { return '<span class="' + cls(v) + '">' + fmt.pct(v, d == null ? 2 : d) + '</span>'; };
  var px = function (v) { return v == null ? '—' : fmt.n(v, v >= 1000 ? 0 : v >= 10 ? 2 : 3); };
  var nm = function (k) { var q = Q(k); return q && q.name || k.replace('TW_', ''); };
  var code = function (k) { return k.indexOf('FUND_') === 0 ? ((Q(k) || {}).name || k) : k.replace('TW_', ''); };
  var SHORT = { SPY: 'S&P 500', QQQ: 'QQQ', TW_0050: '0050', FUND_FJV: _t('日本價值'), FUND_NBTJ: _t('台日雙星'), FUND_ABIT: _t('國際科技'), FUND_ABUS: _t('精選美國'), FUND_AZTT: _t('台灣科技'), FUND_CTHD: _t('台灣高股息') };
  var short = function (k) { return SHORT[k] || code(k); };
  var EDN = function () { return D.meta.edition === 'tw' ? _t('午後刊') : _t('晨刊'); };
  var mdOf = function (s) { return s ? fmt.md(s) : '—'; };
  function spk(v, w, h) {
    if (!v || v.length < 2) return '';
    w = w || 72; h = h || 22;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), up = v[v.length - 1] >= v[0];
    var d = v.map(function (x, i) { return (i ? 'L' : 'M') + (i / (v.length - 1) * w).toFixed(1) + ',' + (h - 2 - (x - lo) / (hi - lo || 1) * (h - 4)).toFixed(1); }).join('');
    return '<svg class="spk" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" stroke="' + (up ? 'var(--up)' : 'var(--down)') + '"/></svg>';
  }
  /* 熱度底色：正紅負綠，|v| 到 scale 時最深 */
  function heat(v, scale, d) {
    if (v == null) return '<td class="h">—</td>';
    var a = Math.min(1, Math.abs(v) / (scale || 10)) * 0.32, c = v >= 0 ? 'var(--up)' : 'var(--down)';
    return '<td class="h"><span style="background:color-mix(in srgb,' + c + ' ' + (a * 100).toFixed(0) + '%,transparent)">' + fmt.pct(v, d == null ? 1 : d) + '</span></td>';
  }
  function p52(q) { return q && q.pos52 != null ? _t('<div class="p52" title="52 週區間位置 ') + q.pos52 + '%"><i style="left:calc(' + q.pos52 + '% - 1px)"></i></div>' : ''; }
  var QUAD = { '領漲': 'lead', '轉弱': 'weak', '落後': 'lag', '改善': 'imp' };
  function qchip(q) { return q ? '<span class="q-chip ' + QUAD[q] + '">' + _t(q) + '</span>' : '—'; }
  function regChip(r) { return r ? '<span class="chip ' + (r.tone === 'up' ? 'up' : r.tone === 'warn' ? 'warn' : 'down') + '">' + esc(r.label) + '</span>' : ''; }

  function impChip(i) { return '<span class="imp ' + i + '">' + ({ bull: _t('偏多'), bear: _t('偏空'), neutral: _t('中性') })[i] + '</span>'; }
  function staleTag() { return (N && N.stale ? _t('<span class="chip">上一期 ') + fmt.md(N.date) + '</span>' : '') + (N && N.zh_only ? '<span class="chip">Commentary in Chinese today</span>' : ''); }
  function readBar(key) {
    var m = N && N.modules && N.modules[key]; if (!m) return '';
    if (N.zh_only) return '<div class="read" data-k="' + key + '" lang="zh-Hant"><span class="tag">Today’s read · \u4e2d\u6587</span><div><p>' + esc(m.lead) + '</p><ul>' + (m.points || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div></div>';
    return '<div class="read" data-k="' + key + _t('"><span class="tag">今日判讀</span><div><p>') + esc(m.lead) + '</p><ul>' + (m.points || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div></div>';
  }
  function actionsHtml() {
    var a = N && N.actions || [], L = { do: _t('可以做'), dont: _t('不要做'), watch: _t('要盯'), flip: _t('會推翻') };
    if (!a.length) return _t('<p class="note">本期沒有寫。</p>');
    return '<ul class="acts">' + a.map(function (x) { return '<li><span class="b ' + esc(x.kind) + '">' + (L[x.kind] || esc(x.kind)) + '</span><span><b>' + esc(x.head) + '</b>' + esc(x.text || '') + '</span></li>'; }).join('') + '</ul>';
  }
  function changesHtml() {
    var a = N && N.changes || [], AR = { up: ['▲', 'u'], down: ['▼', 'd'], flat: ['■', ''] };
    if (!a.length) return _t('<p class="note">本期沒有寫。</p>');
    return '<ul class="deltas">' + a.map(function (x) { var r = AR[x.dir] || AR.flat; return '<li><span class="ar ' + r[1] + '">' + r[0] + '</span><div><h3>' + esc(x.title) + '</h3>' + (x.fig ? '<div class="fig num">' + esc(x.fig) + '</div>' : '') + '<p>' + esc(x.say || '') + '</p></div></li>'; }).join('') + '</ul>';
  }
  function newsItem(n, lead) {
    return '<article class="' + (lead ? 'news-lead' : 'news-item') + '"><div class="news-meta"><span class="cat">' + esc(n.cat) + '</span>' + impChip(n.impact) + '<span>' + esc(n.time.slice(5).replace('-', '/')) + '</span></div><h3>' + esc(n.title) + _t('</h3><div class="read-box"><b class="lbl">解讀</b>') + esc(n.read) + _t('</div><div class="src-link">來源：<a href="') + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.source) + '</a>' + (n.module ? ' · <a href="#' + n.module + _t('">看相關數據 →</a>') : '') + '</div></article>';
  }

  /* ---------------- 數字解讀：當日數值套固定門檻（門檻寫在句子裡），不是預測 ---------------- */
  var TONE = { pos: [_t('偏多'), 'up'], neg: [_t('偏空'), 'down'], warn: [_t('留意'), 'warn'], neu: [_t('中性'), ''] };
  function band(v, cuts, words) { for (var i = 0; i < cuts.length; i++) if (v < cuts[i]) return words[i]; return words[cuts.length]; }
  function tnHtml(t) { t = TONE[t] || TONE.neu; return '<span class="tn ' + t[1] + '">' + t[0] + '</span>'; }
  function interpHtml(items) {
    items = items.filter(function (x) { return x && x[2]; });
    return items.length ? '<div class="interp">' + items.map(function (x) { return '<div class="it"><span class="k">' + esc(x[0]) + '</span><span class="v num">' + x[1] + '</span>' + tnHtml(x[3]) + '<span class="d">' + esc(x[2]) + '</span></div>'; }).join('') + '</div>' : '';
  }
  function interpPanel(items, src) { var h = interpHtml(items); return h ? panel('span-12', _t('這些數字代表什麼'), src || _t('依當日數值套固定門檻自動產生 · 非投資建議'), h) : ''; }

  function rdVix(v) { if (v == null) return null; return [band(v, [13, 20, 30, 40], [_t('低於 13：市場非常平靜，常出現在漲勢中段；平靜本身不是賣出訊號'), _t('13–20：正常範圍'), _t('20–30：緊張，市場在擔心某件事'), _t('30–40：恐慌。歷史上 VIX 衝過 30 的日子，之後一年 S&P 500 多半是上漲的，是長期加碼的常見區'), _t('40 以上：極度恐慌（2008、2020、2025-04 等級）')]), v < 20 ? 'neu' : v < 30 ? 'warn' : 'pos']; }
  function rdTerm(r) { if (r == null) return null; return [r >= 1 ? _t('VIX 高於 3 個月 VIX（期限結構倒掛）：短期恐慌大於長期，通常出現在急跌當下；倒掛解除常是恐慌退潮的訊號') : r >= 0.9 ? _t('接近倒掛（≥ 0.9）：短期避險需求升高，留意') : _t('正常向上（< 0.9）：市場預期短期比長期平靜'), r >= 1 ? 'warn' : r >= 0.9 ? 'warn' : 'neu']; }
  function rdFng(f) { if (!f) return null; var s = f.score; return [band(s, [25, 45, 55, 75], [_t('極度恐懼（< 25）：大家都想賣，逆向來看常是加碼區'), _t('恐懼（25–45）'), _t('中性（45–55）'), _t('貪婪（55–75）'), _t('極度貪婪（≥ 75）：追高要小心，不代表馬上會跌')]) + _t('；一週前 ') + fmt.n(f.prev_week, 0) + _t('、一個月前 ') + fmt.n(f.prev_month, 0) + _t('。'), s < 25 ? 'pos' : s < 75 ? 'neu' : 'warn']; }
  function rdDd(q, name) { if (!q || q.dd_ath == null) return null; var d = q.dd_ath;
    return [name + _t('距歷史高點 ') + fmt.pct(d, 1) + _t('（') + fmt.md(q.ath_d) + _t(' 高點）；') + band(-d, [5, 10, 20], [_t('不到 5%：還在高點附近'), _t('5–10%：一般回檔，一年常見好幾次'), _t('10–20%：修正，平均一到兩年一次'), _t('20% 以上：熊市')]) + _t('。'), d > -5 ? 'neu' : d > -10 ? 'warn' : 'pos']; }
  function rdDev(q, name) { if (!q || q.dev200 == null) return null; var d = q.dev200;
    return [name + (d >= 0 ? _t('在 200 日均線之上 ') : _t('在 200 日均線之下 ')) + fmt.pct(Math.abs(d), 1).replace('+', '') + (q.sma200_up ? _t('，均線仍上升') : _t('，均線已走平或下降')) + _t('；') + band(d, [-10, 0, 10, 20], [_t('遠低於均線，超跌'), _t('跌破長期趨勢線，回撤可能拉長'), _t('趨勢向上的正常區'), _t('漲多，離均線偏遠'), _t('過熱，離均線超過 20%')]) + _t('。'), d < 0 ? 'warn' : d > 20 ? 'warn' : 'pos']; }
  function rdRsi(q, name) { if (!q || q.rsi == null) return null; var r = q.rsi; return [name + ' RSI ' + r + _t('：') + band(r, [30, 45, 55, 70], [_t('低於 30 超賣，短線跌多'), _t('偏弱'), _t('中性'), _t('偏強'), _t('高於 70 超買，短線漲多')]) + _t('。'), r < 30 ? 'pos' : r > 70 ? 'warn' : 'neu']; }
  function rdHy(m) { if (!m) return null; var v = m.v; return [_t('高收益債利差 ') + fmt.n(v, 2) + _t('%（十年第 ') + fmt.n(m.pct10y, 0) + _t(' 百分位）：') + band(v, [3, 4.5, 6], [_t('低於 3%：信用市場很放心，景氣樂觀'), _t('3–4.5%：正常'), _t('4.5–6%：信用開始緊張，留意景氣'), _t('6% 以上：信用壓力大，常伴隨衰退或危機')]) + _t('；一個月變化 ') + fmt.n(m.chg1m, 2) + _t(' 個百分點。'), v < 4.5 ? 'neu' : v < 6 ? 'warn' : 'neg']; }
  function rdCurve(l) { if (!l) return null; return [_t('10 年減 3 個月 ') + fmt.n(l.s10_3m, 2) + _t(' 個百分點、10 年減 2 年 ') + fmt.n(l.s10_2, 2) + _t('：') + (l.s10_3m < 0 ? _t('殖利率曲線倒掛，歷史上是衰退的領先訊號（但領先期長達 6–24 個月）') : _t('曲線正斜率；倒掛解除後重新變陡，歷史上常落在衰退前後，要和就業數據一起看')) + _t('。'), l.s10_3m < 0 ? 'warn' : 'neu']; }
  function rdY10(l) { if (!l) return null; return [_t('10 年期殖利率 ') + fmt.n(l.y10, 2) + _t('%，一個月 ') + (l.y10_1m >= 0 ? '+' : '') + fmt.n(l.y10_1m, 2) + _t(' 個百分點：') + (Math.abs(l.y10_1m) >= 0.3 ? (l.y10_1m > 0 ? _t('一個月升超過 0.3，對科技股估值是壓力（QQQ、GOOGL 較敏感）') : _t('一個月降超過 0.3，對成長股估值有利')) : _t('變動不大')) + _t('。'), l.y10_1m >= 0.3 ? 'neg' : l.y10_1m <= -0.3 ? 'pos' : 'neu']; }
  function rdRsp(r) { if (!r) return null; return [_t('等權重相對市值權重 3 個月 ') + fmt.pct(r.chg3m, 1) + _t('：') + (r.chg3m < -2 ? _t('大型權值股遠強於一般股票，漲勢集中在少數公司，結構偏脆弱') : r.chg3m > 2 ? _t('一般股票追上來，漲勢擴散，結構較健康') : _t('大小型股差不多')) + _t('。'), r.chg3m < -2 ? 'warn' : r.chg3m > 2 ? 'pos' : 'neu']; }
  function rdInst(s) { if (!s) return null; return [(LANG === 'en' ? 'Foreign investors ' + (s.f5 >= 0 ? 'bought ' : 'sold ') + yi(Math.abs(s.f5)) + ' net in 5 days and ' + (s.f20 >= 0 ? 'bought ' : 'sold ') + yi(Math.abs(s.f20)) + ' in 20 days' + (Math.abs(s.streak) >= 3 ? ', ' + Math.abs(s.streak) + ' days of net ' + (s.streak > 0 ? 'buying' : 'selling') + ' in a row' : '') + '. ' : _t('外資近 5 日 ') + (s.f5 >= 0 ? _t('買超 ') : _t('賣超 ')) + fmt.n(Math.abs(s.f5), 0) + _t(' 億、近 20 日 ') + (s.f20 >= 0 ? _t('買超 ') : _t('賣超 ')) + yi(Math.abs(s.f20)) + (Math.abs(s.streak) >= 3 ? _t('，已連 ') + Math.abs(s.streak) + _t(' 日') + (s.streak > 0 ? _t('買超') : _t('賣超')) : '') + _t('：')) + (s.f5 < -500 ? _t('短期大賣，常伴隨台幣轉弱、權值股壓力') : s.f5 > 500 ? _t('短期大買，資金回流') : _t('進出不大')) + _t('。'), s.f5 < -500 ? 'neg' : s.f5 > 500 ? 'pos' : 'neu']; }
  function rdMargin(m) { if (!m) return null; return [_T('融資餘額 ' + fmt.n(m.v, 0) + ' 億，20 日 ' + fmt.pct(m.chg20, 1) + _t('：'), 'Margin balance ' + yi(m.v) + ', ' + fmt.pct(m.chg20, 1) + ' in 20 days. ') + (m.chg20 > 5 ? _t('散戶槓桿快速增加，行情偏熱，急跌時容易出現斷頭賣壓') : m.chg20 < -5 ? _t('融資大減，籌碼已清洗，常出現在修正後段') : _t('變化不大')) + _t('。'), m.chg20 > 5 ? 'warn' : m.chg20 < -5 ? 'pos' : 'neu']; }
  function rdFut(f) { if (!f) return null; return [_t('外資台指期淨未平倉 ') + fmt.n(f.oi, 0) + _t(' 口（5 日 ') + (f.chg5 >= 0 ? '+' : '') + fmt.n(f.chg5, 0) + _t('）：') + (f.oi < -30000 ? _t('空單偏多，外資在避險或看空') : f.oi > 10000 ? _t('多單，外資偏多') : _t('中性')) + _t('；常和現貨一起看，期現同向賣才是明確的偏空訊號。'), f.oi < -30000 ? 'neg' : f.oi > 10000 ? 'pos' : 'neu']; }
  function rdAdr(a) { if (!a) return null; return [_t('台積電 ADR 溢價 ') + fmt.pct(a.v, 1) + _t('：ADR 是美國投資人買台積電的價格；') + (a.v > 20 ? _t('溢價偏高，美方追價意願強') : a.v < 5 ? _t('溢價偏低，美方態度保守') : _t('一般範圍')) + _t('。匯率用 FRED 資料（') + fmt.md(a.fx_d) + _t('），會晚幾天。'), a.v > 20 ? 'pos' : a.v < 5 ? 'neg' : 'neu']; }

  /* ---------------- 版頭：巨型收盤（晨刊＝S&P 500，午後刊＝加權指數） ---------------- */
  function heroKey() { return D.meta.edition === 'tw' ? 'TW_TAIEX' : (Q('SPX') && Q('SPX').d === D.meta.us_date ? 'SPX' : 'SPY'); }
  function megaHtml() {
    var k = heroKey(), q = Q(k), cl = (D.charts[k] || []).slice(-20).map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, cl), hi = Math.max.apply(null, cl), n = cl.length;
    var Y = function (v) { return 90 - (v - lo) / (hi - lo || 1) * 80; };
    var d = cl.map(function (v, i) { return (i ? 'L' : 'M') + (i / (n - 1) * 1000).toFixed(1) + ',' + Y(v).toFixed(2); }).join('');
    return '<div class="mega" id="mega"><div class="hud tl"><span>' + esc(q.name) + _t(' · 收盤</span><b id="h-d">') + q.d.replace(/-/g, '.') + '</b></div>' +
      _t('<div class="hud tr"><span>日漲跌</span><b id="h-c" class="') + cls(q.chg_pct) + '">' + fmt.pct(q.chg_pct, 2) + '</b></div>' +
      '<b class="big" id="mega-n">' + fmt.n(q.c, 0) + '</b>' +
      '<div class="spark" aria-hidden="true"><svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path class="line" d="' + d + '" style="stroke:' + (q.chg_pct >= 0 ? 'var(--up)' : 'var(--down)') + '"/></svg><span class="scrub" id="m-scrub"></span><span class="dot" id="m-dot" style="left:100%;top:' + Y(cl[n - 1]).toFixed(2) + '%"></span></div>' +
      _t('<p class="mega-hint">滑過數字，逐日回看近 20 天</p></div>');
  }
  function bindMega() {
    var m = $('#mega'); if (!m) return;
    var k = heroKey(), q = Q(k), pts = (D.charts[k] || []).slice(-20), n = pts.length, cl = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, cl), hi = Math.max.apply(null, cl);
    var big = $('#mega-n'), fin = fmt.n(q.c, 0), dot = $('#m-dot'), sc = $('#m-scrub'), sp = m.querySelector('.spark'), last = n - 1;
    function show(i) {
      if (i === last) return; last = i; var v = cl[i], ch = i ? (v / cl[i - 1] - 1) * 100 : null, Y = 90 - (v - lo) / (hi - lo || 1) * 80;
      big.textContent = fmt.n(v, 0); dot.style.left = (i / (n - 1) * 100) + '%'; dot.style.top = Y + '%'; sc.style.left = dot.style.left;
      $('#h-d').textContent = fmt.date(pts[i][0]).replace(/\//g, '.');
      var hc = $('#h-c'); hc.textContent = ch == null ? '—' : fmt.pct(ch, 2); hc.className = cls(ch);
    }
    m.addEventListener('pointermove', function (ev) { var b = sp.getBoundingClientRect(); show(Math.round(Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * (n - 1))); m.classList.add('scrubbing'); });
    m.addEventListener('pointerleave', function () { m.classList.remove('scrubbing'); show(n - 1); big.textContent = fin; $('#h-d').textContent = q.d.replace(/-/g, '.'); var hc = $('#h-c'); hc.textContent = fmt.pct(q.chg_pct, 2); hc.className = cls(q.chg_pct); });
    mount(m, function () { var cw = m.clientWidth - parseFloat(getComputedStyle(m).paddingLeft) * 2; big.style.fontSize = ''; var cur = big.textContent; big.textContent = fin; var fs = parseFloat(getComputedStyle(big).fontSize), w = big.offsetWidth; big.textContent = cur; if (w > 0) big.style.fontSize = Math.min(fs * cw / w * 0.97, 520) + 'px'; });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { m._draw && m._draw(m); });
    countUp(big, q.c);
  }

  function tapeItems() {
    var s = D.sentiment || {}, ml = (D.macro || {}).last || {}, tw = D.taiwan || {}, fx = (D.macro || {}).DEXTAUS || {};
    var it = [['S&P 500', Q('SPX') || Q('SPY')], [_t('那斯達克 100'), Q('NDX')], [_t('費城半導體'), Q('SOX')], [_t('加權指數'), Q('TW_TAIEX')], ['0050', Q('TW_0050')], [_t('台積電'), Q('TW_2330')], ['GOOGL', Q('GOOGL')], ['NVDA', Q('NVDA')]]
      .filter(function (x) { return x[1]; }).map(function (x) { return [x[0], px(x[1].c), fmt.pct(x[1].chg_pct, 2), x[1].chg_pct]; });
    if (s.vix) it.push(['VIX', fmt.n(s.vix.v, 2), (s.vix.chg >= 0 ? '+' : '') + fmt.n(s.vix.chg, 2), null]);
    if (ml.y10 != null) it.push([_t('美債 10 年'), fmt.n(ml.y10, 2) + '%', fmt.md(ml.d), null]);
    if (fx.v) it.push([_t('美元/台幣'), fmt.n(fx.v, 2), fmt.md(fx.d), null]);
    if (tw.inst_sum) it.push([_t('外資'), (tw.inst_sum.f1 >= 0 ? '+' : '') + yi(tw.inst_sum.f1), fmt.md(tw.inst_sum.d), tw.inst_sum.f1]);
    if (s.fng) it.push([_t('恐懼貪婪'), fmt.n(s.fng.score, 0), s.fng.rating, null]);
    return it.map(function (x) { return '<span class="tape-item">' + x[0] + ' <b>' + x[1] + '</b>' + (x[2] ? '<i class="' + cls(x[3]) + '">' + esc(x[2]) + '</i>' : '') + '</span>'; }).join('');
  }
  function healthHtml() {
    // FRED 的匯率、美元指數本來就晚一週左右，容許 14 天；其他來源 5 天
    var h = D.health || [], late = h.filter(function (x) { return !x.d || (dnOf(D.meta.bar_date) - dnOf(x.d)) > (/FRED/.test(x.name) ? 14 : 5); }), er = D.errors || [];
    return '<details class="health' + (late.length ? ' warn' : '') + _t('"><summary>資料狀態：') + (late.length ? late.length + _t(' 個來源延遲或未取得') : _t('全部來源正常')) + _t(' · 產出 ') + (D.meta.generated_utc || '').slice(0, 16).replace('T', ' ') + ' UTC</summary>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + h.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="num">' + (x.d || _t('本日未取得')) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (er.length ? '<ul class="note">' + er.slice(0, 8).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') + '</details>';
  }
  function boardRows(keys) {
    return '<table class="qt"><tbody>' + keys.filter(Q).map(function (k) { var q = Q(k); return '<tr><td class="n"><b>' + esc(code(k) === k ? k : code(k)) + '</b>' + esc(q.name) + '</td><td class="v">' + px(q.c) + '</td><td class="c">' + pc(q.chg_pct) + '</td><td class="s">' + spk(q.spark.slice(-30)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function holdCards() {
    var hs = (D.position || {}).targets || [];
    return '<div class="holds">' + hs.map(function (h, i) {
      var q = Q(h.key), nx = h.next;
      return '<div class="hold"><span class="k"><b>' + esc(code(h.key)) + '</b>' + esc(h.name) + '</span>' +
        '<span class="px">' + px(h.c) + '<small class="' + cls(q.chg_pct) + '">' + fmt.pct(q.chg_pct, 2) + '</small></span>' +
        '<div class="uw" id="uw-' + i + '"></div>' +
        _t('<span class="row"><span>距高點</span><b class="') + (h.dd < -0.05 ? 'down' : '') + '">' + fmt.pct(h.dd, 1) + '</b></span>' +
        _t('<span class="row"><span>狀態</span>') + regChip(h.regime) + '</span>' +
        _t('<span class="row"><span>下一個加碼階</span><b>') + (nx ? nx.dd + _t('%（') + px(nx.px) + _t('）') : _t('全部觸發')) + '</b></span>' +
        _t('<span class="row"><span>還要跌</span><b>') + (nx ? fmt.pct(nx.dist, 1) : '—') + '</b></span></div>';
    }).join('') + '</div>';
  }
  function drawUw(el, pts, tiers) {
    var W = Math.max(160, el.clientWidth), H = 46, lo = Math.min(-12, Math.min.apply(null, pts.map(function (p) { return p[1]; }))), n = pts.length;
    var X = function (i) { return i / (n - 1) * W; }, Y = function (v) { return 2 + (-v) / (-lo) * (H - 4); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('');
    var s = '<path d="' + d + 'L' + W + ',2L0,2Z" fill="var(--down-dim)"/><path d="' + d + '" fill="none" stroke="var(--down)" stroke-width="1.4"/>';
    (tiers || []).forEach(function (t) { if (t > lo) s += '<line x1="0" x2="' + W + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="var(--ink-3)" stroke-dasharray="2 3" stroke-width=".8"/>'; });
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + _t('" role="img" aria-label="近三年距高點的回撤">') + s + '</svg>';
  }

  /* ---------------- 代號：文字裡第一次提到的股票、ETF、基金，自動補上代號（台股代號、美股代碼、基金 ISIN） ---------------- */
  var EXTRA = { '台積電 ADR': 'TSM', '台積電ADR': 'TSM', '旺矽': '6223', '台光電': '2383', '欣興': '3037', '國巨': '2327', '華邦電': '2344', '創意': '3443', '台燿': '6274', '致茂': '2360', '緯穎': '6669', '信驊': '5274', '川湖': '2059', '聯電': '2303', '南電': '8046', '金像電': '2368', '世芯': '3661', '鴻勁': '7769', '穎崴': '6515', '台塑': '1301', '南亞': '1303', '台化': '1326', '大立光': '3008',
    '美光': 'MU', '英特爾': 'INTC', '高盛': 'GS', '富國銀行': 'WFC', 'Sandisk': 'SNDK', 'SanDisk': 'SNDK', 'SK 海力士': '000660.KS', 'Salesforce': 'CRM', '嬌生': 'JNJ',
    '瑞穗': '8411.T', '三菱 UFJ': '8306.T', '三菱UFJ': '8306.T', '日本郵政銀行': '7182.T', '三菱電機': '6503.T', '村田製作所': '6981.T', '西鐵城': '7762.T', 'Mebuki 金融': '7167.T', '住友不動產': '8830.T', '日本特殊陶業': '5334.T' };
  var CODE_RE = null, CODES = {};
  function buildCodes() {
    Object.keys(D.quotes || {}).forEach(function (k) { var q = D.quotes[k]; if (!q || !q.name || q.kind === 'sector' || k === 'TW_TAIEX') return;
      if (k.indexOf('TW_') === 0) CODES[q.name] = k.slice(3); else if (q.kind === 'stock' && /[^A-Za-z .]/.test(q.name)) CODES[q.name] = k; });
    FI().forEach(function (x) { if (x.type === 'fund') { CODES[x.name] = x.code; CODES[x.full] = x.code; } });
    Object.keys(EXTRA).forEach(function (n) { if (!CODES[n]) CODES[n] = EXTRA[n]; });
    var names = Object.keys(CODES).filter(function (n) { return n.length >= 2; }).sort(function (a, b) { return b.length - a.length; });
    CODE_RE = new RegExp('(' + names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![（(A-Za-z0-9])', 'g');
  }
  var CODE_SEL = '.dek p, .watch .n, .read, .news-lead, .news-item, .news-card, .acts, .deltas, .fview, .fpts, .fnews, .fsec .sg, .interp .d, .fdesc';
  function annotateCodes(root) {
    if (LANG === 'en') return;   // 英文判讀本身就寫了代號（Nvidia (NVDA)），名稱也已換成英文
    if (!CODE_RE) buildCodes();
    root.querySelectorAll(CODE_SEL).forEach(function (box) {
      if (box.getAttribute('data-coded')) return; box.setAttribute('data-coded', '1');   // 同一塊只標一次
      var seen = {}, w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
      while (w.nextNode()) nodes.push(w.currentNode);
      nodes.forEach(function (t) {
        if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('code')) return;
        var txt = t.nodeValue; CODE_RE.lastIndex = 0; if (!CODE_RE.test(txt)) return; CODE_RE.lastIndex = 0;
        var frag = document.createDocumentFragment(), last = 0, m;
        while ((m = CODE_RE.exec(txt))) {
          var n = m[1], c = CODES[n], end = m.index + n.length;
          if (seen[c] || txt.slice(end, end + 12).indexOf(c) >= 0) continue;   // 這段已經標過或文字本身已寫了代號
          seen[c] = 1; frag.appendChild(document.createTextNode(txt.slice(last, end)));
          var sp = document.createElement('span'); sp.className = 'code'; sp.textContent = _t('（') + c + _t('）'); frag.appendChild(sp); last = end;
        }
        if (last) { frag.appendChild(document.createTextNode(txt.slice(last))); t.parentNode.replaceChild(frag, t); }
      });
    });
  }

  /* ================= 版面 ================= */
  var V = {};
  var ROUTES = [
    ['overview', _t('頭版'), _t('今天的市場')],
    ['regime', _t('多空判定'), _t('回調還是轉空')],
    ['news', _t('消息'), _t('新聞與解讀')],
    ['focus', _t('重點追蹤'), _t('九檔指數 ETF 與基金')],
    ['position', _t('加碼框架'), _t('回撤與加碼位置')],
    ['longrun', _t('長線視角'), _t('把這次放回歷史裡')],
    ['macro', _t('宏觀'), _t('利率、美元與信用')],
    ['sentiment', _t('情緒'), _t('恐慌、貪婪與寬度')],
    ['sectors', _t('板塊'), _t('資金往哪裡去')],
    ['taiwan', _t('台股籌碼'), _t('法人、融資與 ETF')],
    ['watch', _t('觀察清單'), _t('個股與 ETF')],
    ['method', _t('方法'), _t('資料與限制')]
  ];

  V.overview = function () {
    var news = (N && N.news || []).slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
    var wd = [_t('日'), _t('一'), _t('二'), _t('三'), _t('四'), _t('五'), _t('六')][new Date(D.meta.bar_date + 'T12:00:00Z').getUTCDay()];
    var hl = esc(N ? N.headline : _t('今天的判讀還沒寫好，數字已是最新')).replace(/(\d{1,2}\/\d{1,2}(?!\d)|[+\-−]?\d[\d,.]*(?:\s?(?:%|億|萬|兆|倍|點|個基點|基點|bp|K|M|B)(?![A-Za-z]))?)/g, '<em>$1</em>');
    var watch = (N && N.watch || []).map(function (w) { var q = Q(w.sym) || {}, dd = q.c ? (w.value / q.c - 1) * 100 : null; return '<div><span class="k">' + esc(w.label) + '</span><span class="v ' + (dd >= 0 ? 'up' : 'dn') + '">' + fmt.pct(dd, 1) + '</span><span class="px">' + esc(code(w.sym || '')) + ' ' + px(w.value) + '</span><span class="n">' + esc(w.note) + '</span></div>'; }).join('');
    var front = '<section class="front" id="front"><div class="dateline"><b>' + EDN() + '</b><span>MORNINGBELL No.' + ('00' + (N ? N.edition : 0)).slice(-3) + '</span><hr><span>' + D.meta.bar_date.replace(/-/g, '.') + _t('（') + wd + _t('）') + (D.meta.edition === 'tw' ? _t('台股收盤版') : _t('美股收盤版')) + '</span></div>' +
      '<h2 class="reveal">' + hl + '</h2>' + megaHtml() +
      '<div class="front-foot"><div class="dek"><div class="stamp"><span class="chip flare"><i></i>' + esc(N ? N.stance.label : '—') + '</span>' + (N && N.stance.short ? '<span class="chip">' + esc(N.stance.short) + '</span>' : '') + '</div><p>' + esc(N ? N.summary : '') + '</p></div><div class="watch">' + watch + '</div></div></section>';
    var board = _t('<div class="board"><div><h3>美股 <small>') + D.meta.us_date + _t(' 收盤</small></h3>') + boardRows(['SPX', 'NDX', 'SOX', 'IWM', 'VOO', 'QQQ', 'GOOGL', 'NVDA']) + _t('</div><div><h3>台股 <small>') + D.meta.tw_date + _t(' 收盤</small></h3>') + boardRows(['TW_TAIEX', 'TW_0050', 'TW_006208', 'TW_0056', 'TW_2330', 'TW_2454', 'TW_2317', 'TW_00679B']) + '</div></div>';
    var newsBlock = news.length ? _t('<div class="sec-h"><h2>今日要聞</h2><span class="en">The Brief</span><hr><a href="#news">全部 ') + news.length + _t(' 則 →</a></div><div class="news-front">') + newsItem(news[0], true) + '<div class="news-side">' + news.slice(1, 4).map(function (n) { return newsItem(n); }).join('') + '</div></div>' : '';
    var s = D.sentiment || {}, ml = (D.macro || {}).last || {}, tw = D.taiwan || {}, hy = (D.macro || {}).BAMLH0A0HYM2;
    var kp = '<div class="kpis">' +
      kpi(_t('VIX 恐慌指數'), fmt.n((s.vix || {}).v, 2), _t('一年第 ') + fmt.n((s.vix || {}).pct1y, 0) + _t(' 百分位 · 30 以上為恐慌'), ((s.vix || {}).v || 0) / 40 * 100) +
      kpi(_t('恐懼貪婪'), s.fng ? fmt.n(s.fng.score, 0) : '—', s.fng ? esc(s.fng.rating) + ' · CNN' : _t('本日未取得'), s.fng ? s.fng.score : null) +
      kpi(_t('美債 10 年'), fmt.n(ml.y10, 2) + '%', _t('一個月 ') + (ml.y10_1m >= 0 ? '+' : '') + fmt.n(ml.y10_1m, 2) + ' · ' + fmt.md(ml.d)) +
      kpi(_t('高收益債利差'), hy ? fmt.n(hy.v, 2) + '%' : '—', hy ? _t('十年第 ') + fmt.n(hy.pct10y, 0) + _t(' 百分位') : _t('本日未取得'), hy ? hy.pct10y : null) +
      kpi(_t('外資近 5 日'), tw.inst_sum ? (tw.inst_sum.f5 >= 0 ? '+' : '') + yi(tw.inst_sum.f5) : '—', tw.inst_sum ? _t('今日 ') + (tw.inst_sum.f1 >= 0 ? '+' : '') + yi(tw.inst_sum.f1) : '', null, tw.inst_sum ? cls(tw.inst_sum.f5) : '') + '</div>';
    var ev = (N && N.events || []).map(function (e) { var dd = dnOf(e.date) - dnOf(new Date().toISOString().slice(0, 10)); return '<div class="event"><span class="d">' + e.date.slice(5).replace('-', '/') + '</span><span>' + esc(e.label) + '</span><span class="in' + (dd === 0 ? ' now' : '') + '">' + (dd > 0 ? dd + _t(' 天後') : dd === 0 ? _t('今天') : _t('已過')) + '</span></div>'; }).join('');
    var plan = _t('<div class="sec-h"><h2>今天該做什麼</h2><span class="en">The Plan</span><hr>') + staleTag() + '</div><div class="grid">' +
      panel('span-7', _t('今天該做什麼、盯什麼'), _t('依加碼框架 · 非投資建議'), actionsHtml()) + panel('span-5', _t('今天變了什麼'), _t('相對上一期'), changesHtml()) + '</div>';
    return _t('<a class="guide-cta" href="guide.html"><b>第一次來？</b>3 分鐘看懂晨鐘：每天看哪裡、標籤是什麼意思、大跌時看哪一版 <span aria-hidden="true">→</span></a>') + front + _t('<div class="tape" aria-label="今日數據帶"><div class="tape-track">') + tapeItems() + tapeItems() + '</div></div>' + healthHtml() +
      _t('<div class="sec-h"><h2>多空判定</h2><span class="en">Pullback or Bear?</span><hr><a href="#regime">完整判定 →</a></div>') + regimeStrip() +
      _t('<div class="sec-h"><h2>兩市收盤</h2><span class="en">The Close</span><hr></div>') + board +
      newsBlock + plan +
      _t('<div class="sec-h"><h2>重點追蹤</h2><span class="en">Focus List</span><hr><a href="#focus">九檔完整分析 →</a></div>') + focusTable(true) +
      _t('<div class="sec-h"><h2>今日數據</h2><span class="en">The Numbers</span><hr></div>') + kp +
      '<div class="grid">' + interpPanel([['VIX', fmt.n((s.vix || {}).v, 2)].concat(rdVix((s.vix || {}).v) || []), [_t('恐懼貪婪'), s.fng ? fmt.n(s.fng.score, 0) : '—'].concat(rdFng(s.fng) || []), [_t('S&P 500 回撤'), fmt.pct((Q('SPY') || {}).dd_ath, 1)].concat(rdDd(Q('SPY'), 'S&P 500 ') || []), [_t('加權指數回撤'), fmt.pct((Q('TW_TAIEX') || {}).dd_ath, 1)].concat(rdDd(Q('TW_TAIEX'), _t('加權指數')) || []), [_t('10 年期殖利率'), fmt.n(ml.y10, 2) + '%'].concat(rdY10(ml) || []), [_t('外資'), tw.inst_sum ? yi(tw.inst_sum.f5) : '—'].concat(rdInst(tw.inst_sum) || [])]) +
      panel('span-6', _t('S&P 500 近一年'), _t('FRED · 200 日均線'), '<div class="chart" id="c-ov-spx"></div>') +
      panel('span-6', _t('加權指數近一年'), _t('證交所 · 200 日均線'), '<div class="chart" id="c-ov-tw"></div>') +
      panel('span-12', _t('接下來的日期'), _t('台北時間'), '<div class="events">' + (ev || _t('<p class="note">本期沒有寫。</p>')) + '</div>') + '</div>';
  };
  function pxChart(id, key, name) {
    var q = Q(key), h = D.charts[key] || [], cut = h.length ? h[h.length - 1][0] - 370 : 0;
    mount($(id), function (el) { lineChart(el, { h: 240, series: [{ name: name, data: h.filter(function (p) { return p[0] >= cut; }), color: 'var(--s1)', area: true }], refs: q && q.sma200 ? [{ y: q.sma200, color: 'var(--ink-3)', label: _t('200 日均線 ') + px(q.sma200), below: true }] : [], tipFmt: px, yFmt: fmt.k, aria: name + _t('近一年') }); });
  }
  V.overview.after = function () {
    bindMega();
    pxChart('#c-ov-spx', Q('SPX') ? 'SPX' : 'SPY', 'S&P 500'); pxChart('#c-ov-tw', 'TW_TAIEX', _t('加權指數'));
    var tiers = (D.model || {}).ladder ? D.model.ladder.map(function (t) { return t.dd; }) : [-5, -10, -15, -20, -30];
  };

  V.news = function () {
    var news = (N && N.news || []);
    if (!news.length) return _t('<p class="err">今天還沒有整理好的消息。</p>');
    var cats = ['*'].concat(news.map(function (n) { return n.cat; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    var cnt = function (k) { return news.filter(function (n) { return n.impact === k; }).length; };
    return _t('<div class="news-sum"><div><span class="note">偏多</span><b style="color:var(--up)">') + ('0' + cnt('bull')).slice(-2) + _t('</b></div><div><span class="note">偏空</span><b style="color:var(--down)">') + ('0' + cnt('bear')).slice(-2) + _t('</b></div><div><span class="note">中性</span><b>') + ('0' + cnt('neutral')).slice(-2) + '</b></div></div>' +
      _t('<div class="filters" id="nf" role="group" aria-label="分類">') + cats.map(function (c, i) { return '<button type="button" aria-pressed="' + (i === 0) + '" data-c="' + esc(c) + '">' + esc(c === '*' ? _t('全部') : c) + '</button>'; }).join('') + '</div>' +
      _t('<div class="news-grid" id="ng"></div><p class="note">每則消息都查證過發布日期；「解讀」說明它對美股、台股的意義，並對照本站數據。消息只作參考，不改變加碼框架。</p>');
  };
  V.news.after = function () {
    var news = (N && N.news || []).slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0) || (b.time > a.time ? 1 : -1); });
    if (!news.length) return;
    function draw(cat) { $('#ng').innerHTML = news.filter(function (n) { return cat === '*' || n.cat === cat; }).map(function (n) { return '<article class="news-card"><div class="news-meta"><span class="cat">' + esc(n.cat) + '</span>' + impChip(n.impact) + '<span>' + esc(n.time.slice(5).replace('-', '/')) + '</span></div><h3>' + esc(n.title) + _t('</h3><div class="read-box"><b class="lbl">解讀</b>') + esc(n.read) + _t('</div><div class="src-link">來源：<a href="') + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.source) + '</a></div>' + (n.module ? '<a class="go" href="#' + n.module + _t('">看相關數據 →</a>') : '') + '</article>'; }).join(''); }
    var draw0 = draw; draw = function (c) { draw0(c); try { annotateCodes($('#ng').parentNode); } catch (e) {} };
    draw('*');
    $('#nf').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); draw(b.getAttribute('data-c')); });
  };

  /* ---------------- 多空判定：回調還是轉空（2026-11-05）：規則化的市場階段、系統性風險燈、恐慌見底訊號、歷史條件機率、防守規則 ---------------- */
  function RG() { return D.regime || {}; }
  var TONE2 = { up: 'up', warn: 'warn', down: 'down', pos: 'up', neg: 'down', neu: '' };
  function lightRow(x, bad) { return '<div class="lt' + (x.on ? (bad ? ' on-bad' : ' on-good') : '') + '"><span class="mk">' + (x.on ? '●' : '○') + '</span><b>' + esc(x.label) + '</b><span class="v num">' + esc(x.val || '—') + '</span><span class="note">' + esc(x.rule || '') + (x.d ? ' · ' + mdOf(x.d) : '') + '</span></div>'; }
  function regimeStrip() {
    var ms = RG().markets || []; if (!ms.length) return '';
    return '<div class="rg-strip">' + ms.map(function (m) { return '<a href="#regime" class="rg-chip"><span class="n">' + esc(m.name) + '</span><span class="tn ' + TONE2[m.stage.tone] + '">' + esc(m.stage.label) + '</span><b class="' + TONE2[m.view.tone] + _t('">傾向：') + esc(m.view.lean) + _t('</b><small>距高點 ') + fmt.pct(m.dd, 1) + _t(' · 風險燈 ') + m.risk_on + '/' + m.risk_n + _t(' · 恐慌訊號 ') + m.cap_on + '/' + m.cap_n + '</small></a>'; }).join('') + '</div>';
  }
  function anaRow(lab, a, cur) {
    if (!a) return '<tr><td>' + lab + _t('</td><td class="num">0</td><td colspan="6" class="note">沒有同樣條件的歷史樣本</td></tr>');
    return '<tr><td>' + lab + '</td><td class="num">' + a.n + '</td><td class="num">' + a.to20 + _t('（') + fmt.n(a.to20 / a.n * 100, 0) + _t('%）</td>') + heat(a.depth_med, 40) + heat(a.f6m_med, 30) + heat(a.f12m_med, 40) + '<td class="num">' + (a.f12m_pos == null ? '—' : a.f12m_pos + '%') + '</td><td class="num">' + (a.rec_med == null ? '—' : a.rec_med + _t(' 天')) + '</td></tr>';
  }
  function analogHtml(m) {
    var a = m.analogs; if (!a) return _t('<p class="note">距 52 週高點不到 5%，不做歷史比對。</p>');
    var al = a.all || {}, fa = a.fast_above;
    var say = '<p class="say">' + esc(m.name) + _t(' 自 ') + a.from.slice(0, 4) + _t(' 年以來，從 52 週高點跌到 <b>') + fmt.pct(a.level, 1) + _t('</b> 的有 ') + (al.n || 0) + _t(' 段，其中 ') + (al.to20 || 0) + _t(' 段最後跌破 −20%。') +
      (fa ? _t('但條件和現在一樣——') + a.fast_days + _t(' 個交易日內跌到這裡、當時仍在 200 日線之上——的只有 ') + fa.n + _t(' 段，') + fa.to20 + _t(' 段跌破 −20%、最深中位數 ') + fmt.pct(fa.depth_med, 1) + _t('。') : _t('跌得一樣快、且當時仍在 200 日線之上的情況，歷史上沒有出現過。')) + '</p>';
    var tb = _t('<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>條件</th><th class="num">次數</th><th class="num">最後跌破 −20%</th><th class="num">最深（中位）</th><th class="num">6 個月後</th><th class="num">12 個月後</th><th class="num">12 個月上漲比例</th><th class="num">收復高點</th></tr></thead><tbody>') +
      anaRow(_t('全部'), a.all) + anaRow(a.fast_days + _t(' 天內跌到這裡'), a.fast) + anaRow(_t('當時仍在 200 日線上'), a.above) + anaRow(_t('跌破 200 日線之後才到這裡'), a.below) + anaRow(_t('<b>和現在一樣（快速＋線上）</b>'), a.fast_above) + '</tbody></table></div>';
    var ev = (a.events || []).slice().reverse().slice(0, 8).map(function (e) { return '<tr><td>' + e.d + '</td><td class="num">' + e.days + _t(' 天</td><td>') + (e.above200 ? _t('線上') : _t('線下')) + '</td>' + heat(e.depth, 40) + heat(e.f3m, 20) + heat(e.f6m, 30) + heat(e.f12m, 40) + '<td class="num">' + (e.rec == null ? _t('未收復') : e.rec + _t(' 天')) + '</td></tr>'; }).join('');
    return say + tb + _t('<details class="ev"><summary>最近幾段的明細</summary><div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>觸及日</th><th class="num">從高點</th><th>200 日線</th><th class="num">這段最深</th><th class="num">3 個月後</th><th class="num">6 個月後</th><th class="num">12 個月後</th><th class="num">收復高點</th></tr></thead><tbody>') + ev + '</tbody></table></div></details>' +
      _t('<p class="note">「一段」＝從 52 週高點跌到這個深度，價格回到距 52 週高點 5% 以內才算下一段；報酬只算價格。樣本少（次數 < 5）時只能當參考，不能當機率。</p>');
  }
  function marketCard(m, i) {
    var v = m.view || {}, d = m.defense || {};
    var checks = (m.trend_checks || []).map(function (c) { return '<div class="ck' + (c.ok ? ' ok' : ' no') + '"><span class="mk">' + (c.ok ? '✓' : '×') + '</span><b>' + esc(c.label) + '</b><span class="v num">' + esc(c.val) + '</span><span class="note">' + esc(c.say) + '</span></div>'; }).join('');
    var head = '<header class="fcard-h"><span class="fno">' + ('0' + (i + 1)).slice(-2) + '</span><div class="fname"><h3>' + esc(m.name) + '</h3><p>' + mdOf(m.d) + _t(' 收盤 ') + fmtN(m.c) + _t(' · 高點 ') + mdOf(m.peak_d) + ' ' + fmtN(m.peak) + _t('（') + m.days + _t(' 個交易日前）</p></div>') +
      '<div class="fstate"><span class="tn ' + TONE2[m.stage.tone] + '">' + esc(m.stage.label) + '</span></div><div class="fpx"><b class="' + cls(m.dd) + '">' + fmt.pct(m.dd, 1) + _t('</b><small>距高點</small></div></header>');
    var verdict = '<div class="rg-verdict ' + TONE2[v.tone] + _t('"><span class="k">傾向</span><b>') + esc(v.lean) + '</b><p>' + esc(v.why) + '</p></div>';
    var flips = '<ul class="flips">' + (v.flips || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
    var dfn = _t('<p class="note">防守規則：') + (d.on ? _t('<b class="down">已觸發</b>') : _t('未觸發')) + _t('（收盤連 ') + d.below_run + _t('／') + d.need + _t(' 日在 200 日線之下）。') + esc(RG().defense_note || '') + '</p>';
    return '<article class="fcard" id="rg-' + m.key + '">' + head + verdict +
      '<div class="fcard-b"><div class="fcol">' + fsec(_t('趨勢檢查'), '<div class="cks">' + checks + '</div>', _t('<small>四項全 ✓ 才是完整的多頭</small>')) + fsec(_t('會推翻這個看法的條件'), flips) + fsec(_t('防守規則'), dfn) + '</div>' +
      '<div class="fcol">' + fsec(_t('系統性風險燈（轉空佐證）'), '<div class="lts">' + (RG().systemic || []).concat(m.local || []).map(function (x) { return lightRow(x, true); }).join('') + '</div>', _t('<small>亮 ') + m.risk_on + _t('／') + m.risk_n + '</small>') +
      fsec(_t('恐慌見底訊號（回調佐證）'), '<div class="lts">' + (m.cap || []).map(function (x) { return lightRow(x, false); }).join('') + '</div>', _t('<small>亮 ') + m.cap_on + _t('／') + m.cap_n + '</small>') + '</div></div>' +
      fsec(_t('歷史上跌到這裡之後'), analogHtml(m)) + (m.key === 'TW_TAIEX' && RG().breadth ? fsec(_t('台股市場寬度'), _t('<div class="grid2"><div><p class="note">站上 200 日線／50 日線的股票比例（上市普通股）</p><div class="chart" id="c-br-ma"></div></div><div><p class="note">創 52 週新高／新低的股票占比（牛市寬度）</p><div class="chart" id="c-br-hl"></div></div></div>') + hindHtml() + _t('<p class="note">寬度看的是「多數股票」而不是指數：指數還在 200 日線上、但多數股票已跌破，代表跌勢擴散；新低家數暴增後縮小，常是賣壓宣洩的訊號。</p>')) : '') + '</article>';
  }
  function hindHtml() {
    var b = RG().breadth || {}, n = b.now || {}, h = b.hindenburg || [];
    return _t('<p class="say">台股版興登堡預兆（寬度背離預警）：') + (h.length ? _t('近一年觸發 ') + h.length + _t(' 次，最近一次 <b>') + h[h.length - 1] + '</b>' + (n.hind_30d ? _t('，近 30 天內有 ') + n.hind_30d + _t(' 次') : '') : _t('近一年沒有觸發')) + _t('。麥克連振盪指標 ') + fmt.n(n.mco, 0) + _t('（< 0 代表下跌家數占優）。</p>') +
      _t('<p class="note">興登堡預兆原本用美國紐約證交所全市場，本站改用台股上市普通股：同一天新高、新低占比都 ≥ 2.2%、新高 ≤ 新低 × 2、加權指數高於 50 個交易日前、麥克連振盪指標 < 0。它的意思是「指數還在漲，但市場已經分裂」；誤報率高，只當提醒，不是規則。</p>');
  }
  var fmtN = function (x) { return x == null ? '—' : fmt.n(x, x >= 1000 ? 0 : 2); };
  V.regime = function () {
    var r = RG(), ms = r.markets || [];
    if (!ms.length) return _t('<p class="err">本日未取得多空判定資料。</p>');
    return readBar('regime') + '<div class="grid">' +
      panel('span-12', _t('怎麼讀這一版'), _t('規則寫死、每天自動計算 · 參數在 data/model.json'), _t('<p class="say">大跌時要回答兩個問題：<b>趨勢壞了沒有</b>（價格與均線），以及<b>是不是景氣或信用出問題</b>（系統性風險燈）。趨勢還在、風險燈不亮，比較像多頭裡的回調；趨勢轉弱、風險燈一個個亮起，才是轉空的樣子。恐慌見底訊號越多，代表賣壓越接近宣洩，但它不保證就是低點。</p><p class="note">這些是規則讀值與歷史統計，不是預測，也不是買賣建議。</p>')) +
      '<nav class="fnav">' + ms.map(function (m) { return '<button type="button" data-k="' + m.key + '"><i class="' + TONE2[m.stage.tone] + '"></i>' + esc(m.name) + _t('：') + esc(m.view.lean) + '</button>'; }).join('') + '</nav>' +
      ms.map(marketCard).join('') + '</div>';
  };
  V.regime.after = function () {
    var nv = document.querySelector('#pg-regime .fnav');
    if (nv) nv.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var el = document.getElementById('rg-' + b.getAttribute('data-k')); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyH() - 12, behavior: reduced ? 'auto' : 'smooth' }); });
    var br = RG().breadth; if (!br) return;
    mount($('#c-br-ma'), function (el) { lineChart(el, { h: 200, series: [{ name: _t('站上 50 日線'), data: br.pct50, color: 'var(--s2)', w: 1.5 }, { name: _t('站上 200 日線'), data: br.pct200, color: 'var(--s1)' }], y0: 0, y1: 100, refs: [{ y: 50, color: 'var(--ink-3)' }, { y: 20, color: 'var(--down)', label: _t('20% 洗盤') }], yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.n(v, 1) + '%'; }, aria: _t('台股市場寬度') }); });
    var hv = (br.hindenburg || []).map(function (d) { return { x: dnOf(d), label: '' }; });
    mount($('#c-br-hl'), function (el) { lineChart(el, { h: 200, series: [{ name: _t('52 週新高占比'), data: (br.hipct || []).map(function (r) { return [r[0], r[1]]; }), color: 'var(--up)', w: 1.5 }, { name: _t('52 週新低占比'), data: (br.hipct || []).map(function (r) { return [r[0], r[2]]; }), color: 'var(--down)', w: 1.5 }], vlines: hv, y0: 0, yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.n(v, 1) + '%'; }, aria: _t('新高新低占比；虛線為興登堡預兆') }); });
  };

  /* ---------------- 重點追蹤：本刊長期追蹤的九檔指數 ETF 與基金（只呈現標的本身的數據） ---------------- */
  function FI() { return (D.focus || {}).items || []; }
  function focusTable(mini) {
    var it = FI(); if (!it.length) return _t('<p class="note">本日未取得。</p>');
    return _t('<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>標的</th>') + (mini ? '' : _t('<th>類型</th>')) + _t('<th class="num">價格／淨值</th><th class="num">日期</th><th class="num">今日</th><th class="num">1 個月</th><th class="num">今年</th><th class="num">1 年</th>') +
      (mini ? '' : _t('<th class="num">3 年年化</th><th class="num">年化波動</th><th class="num">3 年最大回撤</th>')) + _t('<th class="num">距高點</th><th>規則讀值</th></tr></thead><tbody>') +
      it.map(function (x) { var q = Q(x.key) || {}, r = x.risk || {};
        return '<tr><td><b>' + esc(short(x.key)) + '</b>' + (x.type === 'fund' ? ' <span class="fcode">' + esc(x.code) + '</span>' : '') + (mini ? '' : '<br><span class="note">' + esc(x.full) + '</span>') + '</td>' + (mini ? '' : '<td><span class="note">' + esc(x.type === 'fund' ? _t('基金・') + (x.style || '') : 'ETF') + '<br>' + esc(x.region || '') + '</span></td>') +
          '<td class="num">' + px(q.c) + '</td><td class="num">' + mdOf(q.d) + '</td>' + heat(q.chg_pct, 3, 2) + heat(q.r1m, 12) + heat(q.ytd, 60) + heat(q.r1y, 80) +
          (mini ? '' : heat(r.cagr3y, 40) + '<td class="num">' + (r.vol1y == null ? '—' : fmt.n(r.vol1y, 1) + '%') + '</td>' + heat(r.mdd3y, 40)) + heat(q.dd_ath, 30) + '<td>' + ruleChips(x, mini) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' + (mini ? _t('<p class="note">本刊長期追蹤的指數 ETF 與基金；基金淨值通常晚一到兩天公布，日期欄是資料日。</p>') : '');
  }
  var TN = { pos: 'up', neg: 'down', warn: 'warn', neu: '' };
  function ruleChips(x, first) {
    var sg = (x.rule || {}).signals || []; if (first) sg = sg.slice(0, 2);
    return sg.map(function (g) { return '<span class="tn ' + (TN[g.tone] || '') + '" title="' + esc(g.say) + '">' + esc(g.label) + '</span>'; }).join(' ');
  }
  function FN(k) { return N && N.focus_items && N.focus_items[k] || null; }
  function levelsHtml(x) {
    var r = x.rule || {}, c = r.c, lv = (r.levels || []).slice(); if (!lv.length || !c) return '';
    // 52 週高點與歷史高點常是同一價位，合併成一列
    var ath = lv.filter(function (l) { return l.k === 'ath'; })[0], hi = lv.filter(function (l) { return l.k === 'hi'; })[0];
    if (ath && hi && Math.abs(ath.px - hi.px) < 1e-6) { lv = lv.filter(function (l) { return l !== hi; }); ath = Object.assign({}, ath, { label: LANG === 'en' ? ath.label.replace('All-time high', 'All-time high = 52-week high') : ath.label.replace('歷史高點', '歷史高點＝52 週高點') }); lv = lv.map(function (l) { return l.k === 'ath' ? ath : l; }); }
    var cur = _t('<tr class="hl"><td><b>現在</b></td><td class="num"><b>') + px(c) + '</b></td><td class="num">—</td></tr>', done = false, out = '';
    lv.forEach(function (l) { if (!done && l.px < c) { out += cur; done = true; } out += '<tr><td>' + esc(l.label) + (l.hit ? _t(' <span class="tn up">本段已觸發</span>') : '') + '</td><td class="num">' + px(l.px) + '</td><td class="num ' + cls((l.px / c - 1) * 100) + '">' + fmt.pct((l.px / c - 1) * 100, 1) + '</td></tr>'; });
    if (!done) out += cur;
    return '<table class="tbl lv"><tbody>' + out + '</tbody></table>';
  }
  /* 每檔左欄：今日判讀 → 規則讀值 → 相關消息，三節同一種小標題樣式 */
  function fsec(title, body, extra) { return body ? '<section class="fsec"><h4>' + title + (extra || '') + '</h4>' + body + '</section>' : ''; }
  function focusView(x) {
    var n = FN(x.key), r = x.rule || {}, sg = r.signals || [];
    var view = n ? '<p class="fview">' + esc(n.view || '') + '</p>' + (n.points && n.points.length ? '<ul class="fpts">' + n.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') : _t('<p class="note">本期沒有寫。</p>');
    var rule = sg.map(function (g) { return '<div class="sg"><span class="tn ' + (TN[g.tone] || '') + '">' + esc(g.label) + '</span><span>' + esc(g.say) + '</span></div>'; }).join('');
    var news = n && n.news && n.news.length ? n.news.map(function (m) { return '<div class="fnews"><span class="d">' + esc((m.date || '').slice(5).replace('-', '/')) + '</span><div><a href="' + esc(m.url) + '" target="_blank" rel="noopener">' + esc(m.title) + '</a> <span class="note">' + esc(m.source || '') + '</span>' + (m.read ? '<p>' + esc(m.read) + '</p>' : '') + '</div></div>'; }).join('') : '';
    return fsec(_t('今日判讀'), view, N && N.stale ? _t('<small>上一期</small>') : '') + fsec(_t('規則讀值'), rule, _t('<small>依公開規則自動計算</small>')) + fsec(_t('相關消息'), news);
  }
  function corrHtml() {
    var it = FI(), c = (D.focus || {}).corr || [];
    if (!c.length) return '';
    var cell = function (v, i, j) { if (v == null) return '<td class="h">—</td>'; if (i === j) return '<td class="h"><span>—</span></td>'; var a = Math.max(0, v) * 0.4; return '<td class="h"><span style="background:color-mix(in srgb,var(--red) ' + (a * 100).toFixed(0) + '%,transparent)">' + v.toFixed(2) + '</span></td>'; };
    return '<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th></th>' + it.map(function (x) { return '<th class="num">' + esc(short(x.key)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      it.map(function (x, i) { return '<tr><td><b>' + esc(short(x.key)) + '</b></td>' + c[i].map(function (v, j) { return cell(v, i, j); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function overlapHtml() {
    var o = (D.focus || {}).overlap || [];
    if (!o.length) return _t('<p class="note">前十大持股沒有重疊。</p>');
    return _t('<div class="tbl-wrap"><table class="tbl"><thead><tr><th>兩檔</th><th class="num">共同持股</th><th class="num">重疊權重</th><th>重疊的股票</th></tr></thead><tbody>') +
      o.map(function (x) { return '<tr><td><b>' + esc(short(x.a)) + '</b> × <b>' + esc(short(x.b)) + '</b></td><td class="num">' + x.n + _t(' 檔</td><td class="num">') + fmt.n(x.w, 1) + '%</td><td>' + esc(x.names.join(_t('、'))) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      _t('<p class="note">只比對各基金公布的前十大持股（日期見各檔），重疊權重＝共同持股在兩檔中較低的那個權重加總。ETF 沒有列入比對。</p>');
  }
  /* 一檔一張卡：卡頭（名稱・狀態・價格）→ 數字列 → 左欄分析／右欄數據 */
  function focusCard(x, i) {
    var q = Q(x.key) || {}, r = x.risk || {}, inf = x.info || {}, h = x.hold || {}, top = h.top || [], n = FN(x.key), st = (x.rule || {}).state || {};
    var aum = inf.aum ? (inf.ccy === 'TWD' ? _T(fmt.n(inf.aum / 1e8, 0) + ' 億台幣', 'NT$' + fmt.n(inf.aum / 1e9, 1) + 'B') : inf.ccy === 'USD' ? _T(fmt.n(inf.aum / 1e8, 1) + ' 億美元', 'US$' + fmt.n(inf.aum / 1e9, 2) + 'B') : '') : '';
    var facts = [[_t('計價'), inf.ccy_name || x.ccy], [_t('經理費'), inf.fee != null ? inf.fee + '%' : ''], [_t('規模'), aum], [_t('成立'), inf.since || '']].filter(function (f) { return f[1]; });
    var tags = [x.type === 'fund' ? _t('主動型基金') : _t('指數 ETF'), x.region, x.style].filter(Boolean);
    var rows = top.map(function (t) { return { label: t.name.length > 14 ? t.name.slice(0, 14) + '…' : t.name, v: t.w, color: 'var(--s1)', right: fmt.n(t.w, 1) + '%' }; });
    var top10 = top.reduce(function (s, t) { return s + t.w; }, 0), cty = {};
    top.forEach(function (t) { cty[t.country || _t('其他')] = (cty[t.country || _t('其他')] || 0) + t.w; });
    var stat = function (k, v, c) { return '<div><span>' + k + '</span><b class="' + (c || '') + '">' + v + '</b></div>'; };
    var head = '<header class="fcard-h"><span class="fno">' + ('0' + (i + 1)).slice(-2) + '</span><div class="fname"><h3>' + esc(short(x.key)) + '</h3><p>' + esc(x.full) + ' <span class="fcode">' + esc(x.code) + '</span></p><div class="ftags">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div></div>' +
      '<div class="fstate">' + (n && n.tag ? '<span class="tn ' + (TN[n.tone] || '') + '">' + esc(n.tag) + '</span>' : ruleChips(x, true)) + '</div>' +
      '<div class="fpx"><b>' + px(q.c) + '</b><span class="' + cls(q.chg_pct) + '">' + fmt.pct(q.chg_pct, 2) + '</span><small>' + mdOf(q.d) + (x.type === 'fund' ? _t(' 淨值') : _t(' 收盤')) + '</small></div></header>';
    var stats = '<div class="fstats">' + stat(_t('今年'), fmt.pct(q.ytd, 1), cls(q.ytd)) + stat(_t('1 年'), fmt.pct(q.r1y, 1), cls(q.r1y)) + stat(_t('距高點'), fmt.pct(q.dd_ath, 1), cls(q.dd_ath)) + stat(_t('高於 200 日線'), fmt.pct(q.dev200, 1)) + stat(_t('年化波動'), r.vol1y == null ? '—' : fmt.n(r.vol1y, 1) + '%') + stat(_t('3 年最大回撤'), fmt.pct(r.mdd3y, 1), 'down') + '</div>';
    var right = fsec(_t('近一年走勢'), '<div class="chart" id="c-fx-' + i + '"></div>', _t('<small>虛線：200 日線</small>')) + fsec(_t('關鍵價位'), levelsHtml(x)) +
      (top.length ? fsec(_t('前十大持股'), '<div class="fx-top-' + i + '">' + ladderHtml(rows, { dense: true }) + '</div>', '<small>' + mdOf(h.d) + _t(' · 合計 ') + fmt.n(top10, 1) + '% · ' + Object.keys(cty).sort(function (a, b) { return cty[b] - cty[a]; }).slice(0, 3).map(function (c) { return esc(c) + ' ' + fmt.n(cty[c], 0) + '%'; }).join(_t('、')) + '</small>') : '');
    return '<article class="fcard" id="fx-' + x.key + '">' + head + stats + '<p class="fdesc">' + esc(x.desc || '') + (facts.length ? '<span class="note">' + facts.map(function (f) { return f[0] + ' ' + esc(f[1]); }).join(' · ') + '</span>' : '') + '</p>' +
      '<div class="fcard-b"><div class="fcol">' + focusView(x) + '</div><div class="fcol">' + right + '</div></div></article>';
  }
  function focusReads() {
    var it = FI(); if (!it.length) return [];
    var by = function (f) { return it.slice().filter(function (x) { return f(x) != null; }).sort(function (a, b) { return f(b) - f(a); }); };
    var hot = by(function (x) { return (Q(x.key) || {}).ytd; })[0], vol = by(function (x) { return (x.risk || {}).vol1y; })[0], dd = by(function (x) { return -(Q(x.key) || {}).dd_ath; })[0], ext = by(function (x) { return (Q(x.key) || {}).dev200; })[0];
    var o = ((D.focus || {}).overlap || [])[0], out = [];
    if (hot) out.push([_t('今年最強'), short(hot.key), short(hot.key) + _t(' 今年 ') + fmt.pct(Q(hot.key).ytd, 1) + _t('、一年 ') + fmt.pct(Q(hot.key).r1y, 1) + _t('；漲幅越大，回檔時的跌幅通常也越大。'), 'warn']);
    if (vol) out.push([_t('波動最大'), short(vol.key), short(vol.key) + _t(' 年化波動 ') + fmt.n(vol.risk.vol1y, 1) + _t('%（S&P 500 約 ') + fmt.n(((it.filter(function (x) { return x.key === 'SPY'; })[0] || {}).risk || {}).vol1y, 1) + _t('%），三年最大回撤 ') + fmt.pct(vol.risk.mdd3y, 1) + _t('。'), 'warn']);
    if (ext && Q(ext.key).dev200 != null) out.push([_t('離長期均線最遠'), short(ext.key), short(ext.key) + _t(' 高於 200 日均線 ') + fmt.pct(Q(ext.key).dev200, 1) + _t('；超過 20% 屬於漲多。'), Q(ext.key).dev200 > 20 ? 'warn' : 'neu']);
    if (dd) out.push([_t('回撤最深'), short(dd.key), short(dd.key) + _t(' 距高點 ') + fmt.pct(Q(dd.key).dd_ath, 1) + _t('（') + Q(dd.key).regime.label + _t('）。'), Q(dd.key).dd_ath < -10 ? 'pos' : 'neu']);
    if (o) out.push([_t('持股重疊最高'), short(o.a) + ' × ' + short(o.b), _t('前十大有 ') + o.n + _t(' 檔相同（') + o.names.slice(0, 4).join(_t('、')) + _t('），重疊權重 ') + fmt.n(o.w, 1) + _t('%；兩檔同時存在時，分散效果比看起來小。'), 'warn']);
    return out;
  }
  V.focus = function () {
    return readBar('focus') + '<div class="grid">' +
      panel('span-12', _t('九檔一覽'), _t('價格與淨值：Nasdaq、證交所、鉅亨網 · 依當日資料自動計算'), focusTable(false) + _t('<p class="note">規則讀值：同一套公開規則套在每一檔上——加碼區與接近加碼階來自加碼框架（距歷史高點 −5%、−10%、−15%、−20%、−30%）；偏熱／過熱看價格高於 200 日線的幅度（20%／30%）；短線超買看 RSI ≥ 70。') + esc(D.heat_note || '') + '</p>') +
      interpPanel(focusReads().map(function (r) { return [r[0], esc(r[1]), r[2], r[3]]; })) +
      _t('<nav class="fnav" aria-label="跳到某一檔">') + FI().map(function (x) { var st = (x.rule || {}).state || {}; return '<button type="button" data-k="' + x.key + '"><i class="' + (TN[st.tone] || '') + '"></i>' + esc(short(x.key)) + '</button>'; }).join('') + '</nav>' +
      FI().map(focusCard).join('') +
      panel('span-12', _t('彼此的連動'), _t('近一年週報酬相關係數 · 1 代表同漲同跌，0 代表互不相關'), corrHtml() + _t('<p class="note">相關係數越高，放在一起的分散效果越小。台股與美股平常相關不高，但遇到 AI、半導體這類共同題材修正時，會一起下跌。</p>')) +
      panel('span-12', _t('前十大持股重疊'), _t('基金公布的前十大'), overlapHtml()) + '</div>';
  };
  V.focus.after = function () {
    var nv = document.querySelector('#pg-focus .fnav');
    if (nv) nv.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var el = document.getElementById('fx-' + b.getAttribute('data-k')); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyH() - 12, behavior: reduced ? 'auto' : 'smooth' }); });
    FI().forEach(function (x, i) {
      var q = Q(x.key) || {};
      mount($('#c-fx-' + i), function (el) { lineChart(el, { h: 170, series: [{ name: short(x.key), data: x.hist, color: 'var(--s1)', area: true }], refs: q.sma200 ? [{ y: q.sma200, color: 'var(--ink-3)', label: _t('200 日線'), below: true }] : [], tipFmt: px, yFmt: fmt.k, aria: x.name + _t(' 近一年') }); });
      var tp = document.querySelector('.fx-top-' + i); if (tp) bindLadder(tp, ((x.hold || {}).top || []).map(function (t) { return { tip: '<div class="t">' + esc(t.name) + '</div><div class="r"><i style="background:var(--s1)"></i><span>' + esc((t.sector || '') + ' ' + (t.country || '')) + '</span><b>' + fmt.n(t.w, 2) + '%</b></div>' }; }));
    });
  };

  /* ---------------- 長線視角（2026-11-06）：圖的構想參考老錢日日談 Big Picture，資料與程式為本站自有；data/longrun.json 打開這一版才載入 ---------------- */
  var LR = null, LRI = 0;
  function lrSeg(id, opts, cur) { return '<div class="seg" id="' + id + '">' + opts.map(function (o, i) { return '<button type="button" aria-pressed="' + (i === cur) + '" data-i="' + i + '">' + esc(o) + '</button>'; }).join('') + '</div>'; }
  function bindSeg(id, fn) { var sg = $('#' + id); if (!sg) return; sg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; sg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); fn(+b.getAttribute('data-i')); }); }
  var ymdn = function (y) { return Math.round(Date.UTC(y, 0, 1) / 864e5); };
  function annualSvg(el, rows) {
    var W = Math.max(300, el.clientWidth), H = 260, ML = 8, MR = 46, MT = 14, MB = 24, pw = W - ML - MR, ph = H - MT - MB, n = rows.length;
    var hi = Math.max(10, Math.max.apply(null, rows.map(function (r) { return r.ret; }))), lo = Math.min(-10, Math.min.apply(null, rows.map(function (r) { return Math.min(r.ret, r.dd); })));
    var Y = function (v) { return MT + (hi - v) / (hi - lo) * ph; }, bw = pw / n, s = '', stp = niceStep(hi - lo, 5);
    for (var t = Math.ceil(lo / stp) * stp; t <= hi; t += stp) s += '<line class="' + (t === 0 ? 'base' : 'gl') + '" x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/><text class="ax" x="' + (ML + pw + 6) + '" y="' + (Y(t) + 3.5).toFixed(1) + '">' + t + '%</text>';
    var every = Math.ceil(n / Math.max(1, Math.floor(pw / 40)));
    rows.forEach(function (r, i) {
      var x = ML + i * bw, w = Math.max(1, bw * 0.7), y0 = Y(0), y = Y(r.ret);
      s += '<g class="yr" data-i="' + i + '"><rect x="' + x.toFixed(1) + '" y="' + MT + '" width="' + bw.toFixed(1) + '" height="' + ph + '" fill="transparent"/><rect x="' + (x + (bw - w) / 2).toFixed(1) + '" y="' + Math.min(y, y0).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y - y0)).toFixed(1) + '" fill="' + (r.ret >= 0 ? 'var(--up)' : 'var(--down)') + '" opacity="' + (r.part ? .45 : .85) + '"/>' +
        '<circle cx="' + (x + bw / 2).toFixed(1) + '" cy="' + Y(r.dd).toFixed(1) + '" r="' + Math.min(3, bw / 2.5).toFixed(1) + '" fill="var(--ink-2)"/></g>';
      if (i % every === 0 || i === n - 1) s += '<text class="ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + r.y + '</text>';
    });
    el.innerHTML = svgEl(W, H, s, _t('年度報酬與年內最大回撤'));
    el.querySelectorAll('.yr').forEach(function (g) { var r = rows[+g.getAttribute('data-i')]; g.addEventListener('pointermove', function (ev) { showTip(ev.clientX, ev.clientY, '<div class="t">' + r.y + (r.part ? _t('（今年至今）') : '') + '</div><div class="r"><i style="background:' + (r.ret >= 0 ? 'var(--up)' : 'var(--down)') + _t('"></i><span>全年報酬</span><b>') + fmt.pct(r.ret, 1) + _t('</b></div><div class="r"><i style="background:var(--ink-2)"></i><span>年內最大回撤</span><b>') + fmt.pct(r.dd, 1) + '</b></div>'); }); g.addEventListener('pointerleave', hideTip); });
  }
  function distHtml(rows) {
    var bins = [[-99, -40], [-40, -30], [-30, -20], [-20, -10], [-10, 0], [0, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 999]], full = rows.filter(function (r) { return !r.part; });
    var col = bins.map(function (b) { return full.filter(function (r) { return r.ret >= b[0] && r.ret < b[1]; }); }), mx = Math.max.apply(null, col.map(function (c) { return c.length; }));
    var lab = function (b) { return b[0] === -99 ? '< −40%' : b[1] === 999 ? '≥ 50%' : b[0] + _t('～') + b[1] + '%'; };
    var avg = full.reduce(function (s, r) { return s + r.ret; }, 0) / full.length, pos = full.filter(function (r) { return r.ret > 0; }).length;
    return '<p class="say">' + full.length + _t(' 個完整年度裡，<b>') + pos + _t(' 年上漲（') + fmt.n(pos / full.length * 100, 0) + _t('%）</b>，平均 ') + fmt.pct(avg, 1) + _t('；但真正落在 0～20% 「平均附近」的只有 ') + (col[5].length + col[6].length) + _t(' 年——單一年份很少剛好等於平均。</p>') +
      '<div class="dist">' + col.map(function (c, i) { return '<div class="dc"><div class="stack" style="height:' + (mx * 19) + 'px">' + c.map(function (r) { return '<span class="' + (r.ret >= 0 ? 'u' : 'd') + '" title="' + r.y + _t('：') + fmt.pct(r.ret, 1) + '">' + String(r.y).slice(2) + '</span>'; }).join('') + '</div><b>' + c.length + '</b><small>' + lab(bins[i]) + '</small></div>'; }).join('') + _t('</div><p class="note">每一格是一年（顯示年份後兩碼），只算價格、不含股息。</p>');
  }
  function matrixHtml(ye, span) {
    var ys = ye.slice(-span - 1), n = ys.length, s = _t('<div class="tbl-wrap"><table class="mx"><thead><tr><th>買入＼賣出</th>');
    for (var j = 1; j < n; j++) s += '<th>' + String(ys[j][0]).slice(2) + '</th>';
    s += '</tr></thead><tbody>';
    for (var i = 0; i < n - 1; i++) {
      s += '<tr><th>' + ys[i][0] + '</th>';
      for (var k = 1; k < n; k++) {
        if (k <= i) { s += '<td></td>'; continue; }
        var r = (Math.pow(ys[k][1] / ys[i][1], 1 / (k - i)) - 1) * 100, a = Math.min(1, Math.abs(r) / 20) * 0.75;
        s += '<td style="background:color-mix(in srgb,' + (r >= 0 ? 'var(--up)' : 'var(--down)') + ' ' + (a * 100).toFixed(0) + '%,transparent)" title="' + ys[i][0] + _t(' 年底買、') + ys[k][0] + _t(' 年底賣：年化 ') + fmt.pct(r, 1) + '">' + (Math.abs(r) >= 10 ? Math.round(r) : r.toFixed(0)) + '</td>';
      }
      s += '</tr>';
    }
    return s + _t('</tbody></table></div><p class="note">列＝哪一年年底買進，欄＝哪一年年底賣出，格子＝年化報酬（%，只算價格）。越往右下（持有越久），紅色越多。</p>');
  }
  function monthlyHtml(mo, since) {
    var by = {}; mo.forEach(function (r) { (by[r[0]] = by[r[0]] || {})[r[1]] = r[2]; });
    var ys = Object.keys(by).map(Number).sort(), all = ys.filter(function (y) { return y >= since; }), MN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    var stat = MN.map(function (_, m) { var v = ys.map(function (y) { return by[y][m + 1]; }).filter(function (x) { return x != null; }); return { up: v.filter(function (x) { return x > 0; }).length / v.length * 100, avg: v.reduce(function (s, x) { return s + x; }, 0) / v.length, n: v.length }; });
    var s = _t('<div class="tbl-wrap"><table class="tbl heat mo"><thead><tr><th>年</th>') + MN.map(function (m) { return '<th class="num">' + m + _t(' 月</th>'); }).join('') + _t('<th class="num">全年</th></tr></thead><tbody>');
    all.slice().reverse().forEach(function (y) { var tot = 1; s += '<tr><td>' + y + '</td>' + MN.map(function (_, m) { var v = by[y][m + 1]; if (v != null) tot *= 1 + v / 100; return v == null ? '<td></td>' : heat(v, 8); }).join('') + heat((tot - 1) * 100, 30) + '</tr>'; });
    s += _t('<tr class="hl"><td><b>上漲機率</b></td>') + stat.map(function (x) { return '<td class="num"><b>' + fmt.n(x.up, 0) + '%</b></td>'; }).join('') + _t('<td></td></tr><tr class="hl"><td><b>平均</b></td>') + stat.map(function (x) { return heat(x.avg, 3); }).join('') + '<td></td></tr></tbody></table></div>';
    return s + _t('<p class="note">上漲機率與平均用 ') + ys[0] + _t(' 年以來全部 ') + stat[0].n + _t(' 年計算；表格只列 ') + since + _t(' 年起。季節性只是統計傾向，樣本內每個月都有大漲也有大跌。</p>');
  }
  function cycleTable(cyc) {
    var rows = cyc.slice().reverse().slice(0, 14);
    return _t('<div class="tbl-wrap"><table class="tbl heat"><thead><tr><th>階段</th><th>起</th><th>迄</th><th class="num">漲跌</th><th class="num">交易日</th><th class="num">約幾年</th></tr></thead><tbody>') +
      rows.map(function (c) { return '<tr' + (c.ongoing ? ' class="hl"' : '') + '><td><span class="tn ' + (c.k === 'bull' ? 'up' : 'down') + '">' + (c.k === 'bull' ? _t('牛市') : _t('熊市')) + '</span>' + (c.ongoing ? _t(' 進行中') : '') + '</td><td>' + c.s + '</td><td>' + (c.ongoing ? _t('至今') : c.e) + '</td>' + heat(c.chg, 80) + '<td class="num">' + c.days + '</td><td class="num">' + fmt.n(c.cal / 365.25, 1) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function cycleStats(cyc) {
    var b = cyc.filter(function (c) { return c.k === 'bull' && !c.ongoing; }), r = cyc.filter(function (c) { return c.k === 'bear' && !c.ongoing; }), med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : null; };
    var cur = cyc[cyc.length - 1];
    return _t('<p class="say">以 ±20% 劃分，') + b.length + _t(' 次牛市中位數 <b>') + fmt.pct(med(b.map(function (c) { return c.chg; })), 0) + _t('</b>、約 ') + fmt.n(med(b.map(function (c) { return c.cal; })) / 365.25, 1) + _t(' 年；') + r.length + _t(' 次熊市中位數 <b>') + fmt.pct(med(r.map(function (c) { return c.chg; })), 0) + _t('</b>、約 ') + fmt.n(med(r.map(function (c) { return c.cal; })) / 365.25, 1) + _t(' 年。') +
      _t('現在是') + (cur.k === 'bull' ? _t('牛市') : _t('熊市')) + _t('，從 ') + cur.s + _t(' 起 ') + fmt.pct(cur.chg, 1) + _t('、') + fmt.n(cur.cal / 365.25, 1) + _t(' 年') + (cur.ext ? _t('（本段') + (cur.k === 'bull' ? _t('高點') : _t('低點')) + ' ' + cur.ext + _t('）') : '') + _t('。</p>');
  }
  function lrIdx() { return (LR && LR.idx || [])[LRI]; }
  function lrCut(pts, yrs) { if (!yrs || !pts.length) return pts; var c = pts[pts.length - 1][0] - yrs * 365.25; return pts.filter(function (p) { return p[0] >= c; }); }
  var LRV = { vol: 2, roll: 2, mx: 30, cyc: 0 };
  function drawIdx() {
    var x = lrIdx(); if (!x) return;
    var first = x.weekly[0][0], yrs = [0, 30, 10][LRV.cyc];
    $('#lr-cyc-say').innerHTML = cycleStats(x.cycles); $('#lr-cyc-tb').innerHTML = cycleTable(x.cycles);
    var bands = x.cycles.filter(function (c) { return c.k === 'bear'; }).map(function (c) { return { x0: dnOf(c.s), x1: dnOf(c.e), color: 'var(--down-dim)' }; });
    mount($('#c-lr-cyc'), function (el) { lineChart(el, { h: 280, log: true, series: [{ name: x.name, data: lrCut(x.weekly, yrs), color: 'var(--ink)', w: 1.5, end: true }], vbands: bands, tipFmt: function (v) { return fmt.n(v, 0); }, yFmt: fmt.k, aria: x.name + _t(' 牛熊週期') }); });
    mount($('#c-lr-ann'), function (el) { annualSvg(el, x.annual.slice(-[999, 50, 30][LRV.cyc] || -999)); });
    $('#lr-ann-say').innerHTML = (function () { var f = x.annual.filter(function (r) { return !r.part; }), dd10 = f.filter(function (r) { return r.dd <= -10; }).length, pos = f.filter(function (r) { return r.ret > 0; }).length, med = f.map(function (r) { return r.dd; }).sort(function (a, b) { return a - b; })[Math.floor(f.length / 2)];
      return '<p class="say">' + f.length + _t(' 個完整年度裡，年內最大回撤的中位數是 <b>') + fmt.pct(med, 1) + _t('</b>，') + dd10 + _t(' 年（') + fmt.n(dd10 / f.length * 100, 0) + _t('%）曾跌超過 10%；但全年收紅的有 ') + pos + _t(' 年（') + fmt.n(pos / f.length * 100, 0) + _t('%）。一年中出現一次像樣的回檔是常態。</p>'); })();
    $('#lr-dist').innerHTML = distHtml(x.annual);
    $('#lr-mx').innerHTML = matrixHtml(x.year_end, LRV.mx);
    $('#lr-mo').innerHTML = monthlyHtml(x.monthly, x.key === 'TW_TAIEX' ? 2001 : 2000);
    var W = [1, 5, 10, 20][LRV.roll], ser = x.rolling.map(function (r) { return [r[0], r[[0, 1, 2, 3, 4][[1, 5, 10, 20].indexOf(W) + 1]]]; }).filter(function (p) { return p[1] != null; });
    var vals = ser.map(function (p) { return p[1]; }), neg = vals.filter(function (v) { return v < 0; }).length;
    $('#lr-roll-say').innerHTML = _t('<p class="say">任意時點往回看 ') + W + _t(' 年，年化報酬為負的時間占 <b>') + fmt.n(neg / vals.length * 100, 0) + _t('%</b>；最差 ') + fmt.pct(Math.min.apply(null, vals), 1) + _t('、最好 ') + fmt.pct(Math.max.apply(null, vals), 1) + _t('、現在 ') + fmt.pct(vals[vals.length - 1], 1) + _t('。持有越久，虧損的機率越低。</p>');
    mount($('#c-lr-roll'), function (el) { lineChart(el, { h: 240, series: [{ name: W + _t(' 年年化'), data: ser, color: 'var(--s1)', area: true }], refs: [{ y: 0, color: 'var(--ink)' }], yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.pct(v, 1); }, aria: _t('滾動報酬') }); });
    var bl = x.bulls, cur = bl.filter(function (b) { return b.ongoing; })[0], mxd = Math.max(cur ? cur.pts.length * 5 * 2 : 1500, 750);
    var ser2 = bl.filter(function (b) { return !b.ongoing; }).map(function (b) { return { name: b.s.slice(0, 7) + _t('（') + fmt.pct(b.chg, 0) + _t('）'), data: b.pts.map(function (v, i) { return [i * 5, v]; }).filter(function (p) { return p[0] <= mxd; }), color: 'var(--ink-3)', w: 1, end: false }; });
    if (cur) ser2.push({ name: _t('這一輪（') + cur.s + _t(' 起）'), data: cur.pts.map(function (v, i) { return [i * 5, v]; }), color: 'var(--red)', w: 3 });
    $('#lr-bull-say').innerHTML = cur ? _t('<p class="say">這一輪牛市從 ') + cur.s + _t(' 起 ') + cur.days + _t(' 個交易日、') + fmt.pct(cur.chg, 1) + _t('；同一時間點，過去 ') + (ser2.length - 1) + _t(' 輪牛市的中位數是 <b>') + (function () { var v = bl.filter(function (b) { return !b.ongoing && b.pts.length > Math.floor(cur.days / 5); }).map(function (b) { return b.pts[Math.floor(cur.days / 5)]; }).sort(function (a, b) { return a - b; }); return v.length ? fmt.pct(v[Math.floor(v.length / 2)], 0) + _t('（有 ') + v.length + _t(' 輪走到這麼久）') : _t('—（沒有一輪走到這麼久）'); })() + _t('</b>。</p>') : _t('<p class="note">目前不在牛市。</p>');
    var lg = function (sr) { return sr.map(function (o) { return Object.assign({}, o, { data: o.data.map(function (p) { return [p[0], 100 + p[1]]; }) }); }); };   // 對數座標：起點＝100
    mount($('#c-lr-bull'), function (el) { lineChart(el, { h: 300, xType: 'num', x0: 0, x1: mxd, log: true, series: lg(ser2), xticks: [0, 250, 500, 750, 1000, 1250, 1500, 2000, 2500].filter(function (t) { return t <= mxd; }).map(function (t) { return [t, t ? (t / 250).toFixed(0) + _t(' 年') : _t('起點')]; }), xTipFmt: function (v) { return _t('第 ') + v + _t(' 個交易日'); }, yFmt: function (v) { return fmt.pct(v - 100, 0); }, tipFmt: function (v) { return fmt.pct(v - 100, 0); }, aria: _t('牛市路徑比較（對數座標）') }); });
    var vy = [1, 3, 10, 0][LRV.vol], vv = lrCut(x.vol, vy);
    mount($('#c-lr-vol'), function (el) { lineChart(el, { h: 220, series: [{ name: _t('60 日'), data: vv.map(function (r) { return [r[0], r[2]]; }), color: 'var(--s2)', w: 1.5 }, { name: _t('20 日'), data: vv.map(function (r) { return [r[0], r[1]]; }), color: 'var(--s1)' }], refs: [{ y: 30, color: 'var(--down)', label: _t('30% 高波動') }], y0: 0, yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.n(v, 1) + '%'; }, aria: _t('波動率') }); });
    document.querySelectorAll('.lr-name').forEach(function (e) { e.textContent = x.name; });
  }
  function drawGlobal() {
    var L = LR; if (!L) return;
    var spx = L.idx[0];
    if (spx) mount($('#c-lr-vix'), function (el) { lineChart(el, { h: 280, log: true, series: [{ name: 'S&P 500', data: spx.weekly.filter(function (p) { return p[0] >= dnOf('1990-01-01'); }), color: 'var(--ink)', w: 1.5 }], vbands: L.vix30.map(function (p) { return { x0: p[0], x1: p[1], color: 'var(--down-dim)' }; }), tipFmt: function (v) { return fmt.n(v, 0); }, yFmt: fmt.k, aria: _t('VIX 恐慌期間與 S&P 500') }); });
    var c = L.cape; if (c) { $('#lr-cape-say').innerHTML = _t('<p class="say">席勒本益比 <b>') + fmt.n(c.now, 1) + _t('</b>（') + fmt.md(c.d) + _t('），1871 年以來第 <b>') + c.pct + _t('</b> 百分位；長期平均 ') + c.mean + _t('、1990 年以來平均 ') + c.mean_1990 + _t('。高估值不代表馬上會跌，但歷史上起點估值越高，之後十年的報酬通常越低。</p>');
      mount($('#c-lr-cape'), function (el) { lineChart(el, { h: 240, series: [{ name: 'CAPE', data: c.hist, color: 'var(--s1)', area: true }], refs: [{ y: c.mean, color: 'var(--ink-3)', label: _t('長期平均 ') + c.mean }, { y: c.mean_1990, color: 'var(--warn)', label: _t('1990 起平均 ') + c.mean_1990 }], yFmt: function (v) { return v.toFixed(0); }, tipFmt: function (v) { return fmt.n(v, 1); }, aria: _t('席勒本益比') }); }); }
    var b = L.buffett; if (b) { $('#lr-buf-say').innerHTML = _t('<p class="say">改良版巴菲特指標 <b>') + fmt.n(b.now, 0) + _t('%</b>（') + b.d.slice(0, 7) + _t(' 季資料），') + (b.pct >= 99 ? _t('是 1945 年以來最高') : _t('在 1945 年以來第 ') + b.pct + _t(' 百分位')) + _t('；平均 ') + b.mean + _t('%。分母加上 Fed 資產，扣掉央行擴表推升市值的部分。</p>');
      mount($('#c-lr-buf'), function (el) { lineChart(el, { h: 240, series: [{ name: _t('原版（÷ GDP）'), data: b.hist.map(function (r) { return [r[0], r[2]]; }), color: 'var(--ink-3)', w: 1.5, dash: '4 4' }, { name: _t('改良版（÷ GDP＋Fed 資產）'), data: b.hist.map(function (r) { return [r[0], r[1]]; }), color: 'var(--s1)' }], refs: [{ y: b.mean, color: 'var(--ink-3)', label: _t('改良版平均 ') + b.mean + '%' }], yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.n(v, 0) + '%'; }, aria: _t('巴菲特指標') }); }); }
    var m = L.misery; if (m) { $('#lr-mis-say').innerHTML = _t('<p class="say">痛苦指數 <b>') + fmt.n(m.now, 1) + _t('</b>（') + m.d.slice(0, 7) + _t('）＝ CPI 年增率 ＋ 失業率，長期平均 ') + m.mean + _t('。數字越高，代表通膨與失業對家庭的壓力越大，也常是 Fed 兩難的時候。</p>');
      mount($('#c-lr-mis'), function (el) { lineChart(el, { h: 220, series: [{ name: _t('失業率'), data: m.hist.map(function (r) { return [r[0], r[3]]; }), color: 'var(--s3)', w: 1.2 }, { name: _t('CPI 年增率'), data: m.hist.map(function (r) { return [r[0], r[2]]; }), color: 'var(--s2)', w: 1.2 }, { name: _t('痛苦指數'), data: m.hist.map(function (r) { return [r[0], r[1]]; }), color: 'var(--s1)' }], refs: [{ y: m.mean, color: 'var(--ink-3)', label: _t('平均 ') + m.mean }], yFmt: function (v) { return v.toFixed(0); }, tipFmt: function (v) { return fmt.n(v, 1); }, aria: _t('痛苦指數') }); }); }
    var s7 = L.m7; if (s7) { var l7 = s7.hist[s7.hist.length - 1]; $('#lr-m7-say').innerHTML = '<p class="say">' + s7.from.slice(0, 4) + _t(' 年起，七巨頭等權指數從 100 到 <b>') + fmt.n(l7[1], 0) + _t('</b>，同期 S&P 500 到 ') + fmt.n(l7[2], 0) + _t('；這也是大盤越來越集中的原因。</p>');
      mount($('#c-lr-m7'), function (el) { lineChart(el, { h: 240, log: true, series: [{ name: _t('S&P 500（SPY）'), data: s7.hist.map(function (r) { return [r[0], r[2]]; }), color: 'var(--ink-3)', w: 1.5 }, { name: _t('七巨頭等權'), data: s7.hist.map(function (r) { return [r[0], r[1]]; }), color: 'var(--s1)' }], yFmt: fmt.k, tipFmt: function (v) { return fmt.n(v, 0); }, aria: _t('七巨頭等權指數') }); }); }
    var e = L.eps; if (e) mount($('#c-lr-eps'), function (el) { lineChart(el, { h: 220, log: true, series: [{ name: _t('每股盈餘'), data: e.hist, color: 'var(--s3)', area: true }], yFmt: fmt.k, tipFmt: function (v) { return fmt.n(v, 2); }, aria: _t('S&P 500 每股盈餘') }); });
  }
  V.longrun = function () {
    var p = function (id, t, src, body, extra, span) { return panel(span || 'span-12', t, src, body, extra); };
    return readBar('longrun') + '<div class="grid">' +
      panel('span-12', _t('把這次放回歷史裡'), _t('圖的構想參考老錢日日談 Big Picture · 資料與計算為本站自有'), _t('<p class="say">短線看新聞，長線看分布：漲多少、跌多少、多久、多常發生。下面前七張圖可以切換 <b>S&P 500（1928 起）</b>、<b>那斯達克 100（1985 起）</b>、<b>台股加權（2000 起）</b>；後面幾張是美股的估值與總經。報酬只算價格、不含股息。</p>') + lrSeg('lr-idx', ['S&P 500', _t('那斯達克 100'), _t('台股加權')], 0)) +
      p('', _t('<span class="lr-name">S&P 500</span>牛熊週期'), _t('±20% 劃分 · 綠底為熊市'), '<div id="lr-cyc-say"></div><div class="chart" id="c-lr-cyc"></div><div id="lr-cyc-tb"></div>', lrSeg('lr-cyc-sg', [_t('全部'), _t('30 年'), _t('10 年')], 0)) +
      p('', _t('<span class="lr-name">S&P 500</span>年度報酬與年內最大回撤'), _t('柱＝全年報酬 · 點＝當年從高點最大回撤'), '<div id="lr-ann-say"></div><div class="chart" id="c-lr-ann"></div>') +
      p('', _t('<span class="lr-name">S&P 500</span>年度報酬分布'), _t('每一格是一年'), '<div id="lr-dist"></div>') +
      p('', _t('<span class="lr-name">S&P 500</span>跨年持有年化報酬'), _t('年底買、年底賣'), '<div id="lr-mx"></div>', lrSeg('lr-mx-sg', [_t('近 20 年'), _t('近 30 年'), _t('近 40 年')], 1)) +
      p('', _t('<span class="lr-name">S&P 500</span>月度漲跌'), _t('各月上漲機率與平均'), '<div id="lr-mo"></div>') +
      p('', _t('<span class="lr-name">S&P 500</span>滾動報酬'), _t('月底取樣 · 往回看 N 年的年化報酬'), '<div id="lr-roll-say"></div><div class="chart" id="c-lr-roll"></div>', lrSeg('lr-roll-sg', [_t('1 年'), _t('5 年'), _t('10 年'), _t('20 年')], 2)) +
      p('', _t('<span class="lr-name">S&P 500</span>牛市路徑比較'), _t('從牛市起點算的漲幅 · 灰線為歷次牛市 · 對數座標'), '<div id="lr-bull-say"></div><div class="chart" id="c-lr-bull"></div>') +
      p('', _t('<span class="lr-name">S&P 500</span>波動率'), _t('20 日與 60 日年化實際波動 · 30% 以上屬高波動'), legend([[_t('20 日'), 'var(--s1)'], [_t('60 日'), 'var(--s2)']]) + '<div class="chart" id="c-lr-vol"></div>', lrSeg('lr-vol-sg', [_t('1 年'), _t('3 年'), _t('10 年'), _t('全部')], 2)) +
      p('', _t('VIX 恐慌期間與 S&P 500'), _t('綠底＝VIX 連續 5 日以上收在 30 之上 · 對數座標'), _t('<div class="chart" id="c-lr-vix"></div><p class="note">恐慌期間常出現在跌勢的後段，但不是每次都是低點（2008 年恐慌持續了好幾個月）。</p>')) +
      p('', _t('席勒本益比（CAPE）'), _t('multpl · 月資料 · 1871 起'), '<div id="lr-cape-say"></div><div class="chart" id="c-lr-cape"></div>', '', 'span-6') +
      p('', _t('改良版巴菲特指標'), _t('FRED · 季資料'), '<div id="lr-buf-say"></div>' + legend([[_t('改良版（÷ GDP＋Fed 資產）'), 'var(--s1)'], [_t('原版（÷ GDP）'), 'var(--ink-3)', 'dash']]) + _t('<div class="chart" id="c-lr-buf"></div><p class="note">分子用 FRED 的非金融企業股權市值，和常見的「全市場總市值」口徑不同，看趨勢與相對位置比看絕對值有意義。</p>'), '', 'span-6') +
      p('', _t('痛苦指數'), _t('FRED · CPI 年增率 ＋ 失業率'), '<div id="lr-mis-say"></div>' + legend([[_t('痛苦指數'), 'var(--s1)'], [_t('CPI 年增率'), 'var(--s2)'], [_t('失業率'), 'var(--s3)']]) + '<div class="chart" id="c-lr-mis"></div>', '', 'span-6') +
      p('', _t('S&P 500 每股盈餘'), _t('multpl · 十二個月滾動 · 對數座標'), _t('<div class="chart" id="c-lr-eps"></div><p class="note">股價長期跟著盈餘走；估值（本益比）決定的是中間的起伏。資料約晚兩到三個月。</p>'), '', 'span-6') +
      p('', _t('七巨頭等權指數 vs S&P 500'), _t('蘋果、微軟、輝達、Alphabet、亞馬遜、Meta、特斯拉 · 每週等權再平衡'), '<div id="lr-m7-say"></div>' + legend([[_t('七巨頭等權'), 'var(--s1)'], [_t('S&P 500（SPY）'), 'var(--ink-3)']]) + '<div class="chart" id="c-lr-m7"></div>') + '</div>';
  };
  V.longrun.after = function () {
    var go2 = function () { drawIdx(); drawGlobal(); };
    load('data/longrun.json').then(function (j) { LR = locData(j); go2();
      bindSeg('lr-idx', function (i) { LRI = i; drawIdx(); }); bindSeg('lr-cyc-sg', function (i) { LRV.cyc = i; drawIdx(); }); bindSeg('lr-mx-sg', function (i) { LRV.mx = [20, 30, 40][i]; drawIdx(); });
      bindSeg('lr-roll-sg', function (i) { LRV.roll = i; drawIdx(); }); bindSeg('lr-vol-sg', function (i) { LRV.vol = i; drawIdx(); });
    }).catch(function (e) { var el = $('#lr-cyc-say'); if (el) el.innerHTML = _t('<p class="err">長線資料載入失敗：') + esc(e.message) + '</p>'; });
  };

  /* ---------------- 加碼框架 ---------------- */
  function ladderSvg(h) {
    var lv = h.levels, lo = Math.min(h.c, lv[lv.length - 1].px) * 0.97, hi = h.ath * 1.015, W = 1000, Ht = 130, ML = 16, MR = 16, pw = W - ML - MR, y = 64;
    var X = function (v) { return ML + (v - lo) / (hi - lo) * pw; }, s = '';
    s += '<line x1="' + ML + '" x2="' + (ML + pw) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line-2)" stroke-width="2"/>';
    lv.forEach(function (t) { var on = h.hit.indexOf(t.dd) >= 0, xx = X(t.px); s += '<g><title>' + t.dd + _t('%：') + px(t.px) + _t('，加碼 ') + t.add + '%</title><rect x="' + (xx - 2).toFixed(1) + '" y="' + (y - 12) + '" width="4" height="24" rx="2" fill="' + (on ? 'var(--red)' : 'var(--ink-3)') + '"/><text x="' + xx.toFixed(1) + '" y="' + (y + 28) + '" text-anchor="middle" style="font-family:var(--f-mono);font-size:11px" fill="' + (on ? 'var(--red-ink)' : 'var(--ink-2)') + '">' + t.dd + '%</text><text x="' + xx.toFixed(1) + '" y="' + (y + 42) + '" text-anchor="middle" style="font-family:var(--f-mono);font-size:10.5px" fill="var(--ink-3)">' + px(t.px) + '</text></g>'; });
    var ax = X(h.ath); s += '<line x1="' + ax.toFixed(1) + '" x2="' + ax.toFixed(1) + '" y1="' + (y - 14) + '" y2="' + (y + 14) + '" stroke="var(--ink)" stroke-width="2"/><text x="' + (ax + 6).toFixed(1) + '" y="' + (y + 28) + _t('" text-anchor="end" style="font-family:var(--f-mono);font-size:11px" fill="var(--ink)">高點</text>');
    var cx = X(h.c); s += '<circle cx="' + cx.toFixed(1) + '" cy="' + y + '" r="13" fill="var(--red)" opacity=".16"><animate attributeName="r" values="10;17;10" dur="3s" repeatCount="indefinite"/></circle><circle cx="' + cx.toFixed(1) + '" cy="' + y + '" r="6.5" fill="var(--ink)" stroke="var(--deck)" stroke-width="2.5"/><text x="' + cx.toFixed(1) + '" y="' + (y - 22) + _t('" text-anchor="middle" style="font-family:var(--f-mono);font-size:12.5px;font-weight:700" fill="var(--ink)">現在 ') + px(h.c) + '</text>';
    return '<div class="runway"><svg viewBox="0 0 ' + W + ' ' + Ht + '" role="img" aria-label="' + esc(h.name) + _t(' 現價到各加碼階的距離">') + s + '</svg></div>';
  }
  V.position = function () {
    var P = D.position || {}, M = D.model || {}, hs = P.targets || [], bt = P.backtest || [];
    var ladderTbl = _t('<div class="tbl-wrap"><table class="tbl"><thead><tr><th>階</th><th class="num">距歷史高點</th><th class="num">加碼（預留資金的 %）</th><th class="num">累計</th></tr></thead><tbody>') +
      (M.ladder || []).map(function (t, i, a) { var cum = a.slice(0, i + 1).reduce(function (s, x) { return s + x.add; }, 0); return _t('<tr><td>第 ') + (i + 1) + _t(' 階</td><td class="num">') + t.dd + '%</td><td class="num">' + t.add + '%</td><td class="num">' + cum + '%</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="note">' + esc(M.ladder_note || '') + ' ' + esc((M.accel || {}).note || '') + ' ' + esc((M.trend || {}).note || '') + '</p>' +
      _t('<p class="note">現在 VIX ') + fmt.n(P.vix, 2) + (P.accel_on ? _t('，<b>已達恐慌門檻，下一階可提前</b>') : _t('，未達恐慌門檻（') + (M.accel || {}).vix + _t('）')) + _t('。這是範例框架、不是投資建議；比例請依自己的資金與風險承受度調整。</p>');
    var cards = hs.map(function (h, i) {
      return panel('span-12', esc(short(h.key)) + (short(h.key) !== h.name ? ' <span class="note">' + esc(h.name) + '</span>' : ''), _t('高點 ') + fmt.md(h.ath_d) + _t(' · 本段最低 ') + fmt.pct(h.ep_low, 1) + _t(' · 已觸發 ') + (h.hit.length ? h.hit.join(_t('、')) + '%' : _t('無')) + _t('（累計 ') + h.used + _t('%）'),
        _t('<p class="say">距歷史高點 <b>') + fmt.pct(h.dd, 1) + _t('</b>，') + (h.next ? _t('跌到 ') + px(h.next.px) + _t('（') + fmt.pct(h.next.dist, 1) + _t('）觸發第 ') + ((M.ladder || []).map(function (t) { return t.dd; }).indexOf(h.next.dd) + 1) + _t(' 階，加碼預留資金的 ') + h.next.add + '%' : _t('所有階梯都已觸發')) + _t('。') +
        (h.dev200 != null ? _t('價格') + (h.dev200 >= 0 ? _t('在 200 日均線之上 ') : _t('在 200 日均線之下 ')) + fmt.pct(Math.abs(h.dev200), 1).replace('+', '') + _t('。') : '') + (h.hist_from > '2016' ? _t('（歷史資料從 ') + h.hist_from.slice(0, 4) + _t(' 年起）') : '') + '</p>' + ladderSvg(h) + '<div class="chart" id="c-uw-' + i + '"></div>');
    }).join('');
    var sim = panel('span-12', _t('加碼模擬'), _t('拖動回撤，看框架會加碼多少'), _t('<div class="sim2"><div><label class="note" for="sim-dd">假設從高點回撤</label><input type="range" id="sim-dd" min="-50" max="0" step="1" value="-12"><div class="out" id="sim-out">−12%</div><p class="note" id="sim-say"></p></div><ul class="steps" id="sim-steps"></ul></div>'));
    var btSel = bt.length ? '<div class="seg" id="bt-seg">' + bt.map(function (b, i) { return '<button type="button" aria-pressed="' + (i === 0) + '" data-i="' + i + '">' + esc(b.name) + '</button>'; }).join('') + '</div>' : '';
    return readBar('position') + '<div class="grid">' +
      panel('span-12', _t('加碼階梯'), _t('範例參數 · data/model.json'), ladderTbl) + cards + sim +
      panel('span-12', _t('歷史上，跌到每一階之後發生什麼'), _t('每段回撤只算第一次觸及 · 創新高後重置'), '<div id="bt-body"></div>', btSel) +
      panel('span-12', _t('這次回撤 vs 歷次回撤'), _t('從高點起算的交易日 · 灰線為歷次 10% 以上回撤'), '<div id="bt-path-say"></div><div class="chart" id="c-path"></div>') +
      panel('span-12', _t('歷次 10% 以上回撤'), _t('高點 → 低點 → 收復'), '<div id="bt-eps"></div>') + '</div>';
  };
  function btBody(b) {
    var t = b.tiers;
    var tbl = '<p class="say">' + esc(b.name) + _t('（') + b.from.slice(0, 4) + '–' + b.to.slice(0, 4) + _t('）：跌到 −10% 的 ') + (t[1] || {}).n + _t(' 次裡，一年後上漲的比例是 <b>') + fmt.n((t[1] || {}).f1y_pos, 0) + _t('%</b>，一年報酬中位數 ') + fmt.pct((t[1] || {}).f1y_med, 1) + _t('；但觸及之後通常還會再跌（中位數 ') + fmt.pct((t[1] || {}).more_med, 1) + _t('），所以才要分批。</p>') +
      _t('<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>觸及</th><th class="num">次數</th><th class="num">一年後中位數</th><th class="num">一年後上漲比例</th><th class="num">一年後最差</th><th class="num">三年後中位數</th><th class="num">之後再跌（中位）</th><th class="num">之後再跌（最深）</th></tr></thead><tbody>') +
      t.map(function (x) { return '<tr><td><b>' + x.dd + '%</b></td><td class="num">' + x.n + '</td>' + heat(x.f1y_med, 30) + '<td class="num">' + (x.f1y_pos == null ? '—' : x.f1y_pos + '%') + '</td>' + heat(x.f1y_min, 40) + heat(x.f3y_med, 60) + heat(x.more_med, 30) + heat(x.more_min, 50) + '</tr>'; }).join('') +
      _t('</tbody></table></div><p class="note">報酬只算價格、不含股息；過去不代表未來。樣本少的階（次數 < 5）參考價值低。') + (b.key === 'SPX' ? _t('S&P 500 長歷史暫時沒取得，這裡只有 10 年。') : '') + '</p>';
    var last = t[1] && t[1].events || [];
    if (last.length) tbl += _t('<div class="tbl-wrap"><table class="tbl heat"><thead><tr><th>最近幾次觸及 −10%</th><th class="num">六個月後</th><th class="num">一年後</th><th class="num">之後再跌</th><th class="num">幾天收復高點</th></tr></thead><tbody>') + last.slice(-6).reverse().map(function (e) { return '<tr><td class="num" style="text-align:left">' + e.d + '</td>' + heat(e.f6m, 20) + heat(e.f1y, 30) + heat(e.more, 30) + '<td class="num">' + (e.rec_days == null ? _t('尚未') : e.rec_days + _t(' 天')) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return tbl;
  }
  function epsHtml(b) {
    return _t('<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>高點</th><th>低點</th><th class="num">最大跌幅</th><th class="num">下跌天數</th><th class="num">收復天數</th><th>收復日</th></tr></thead><tbody>') +
      b.episodes.slice().reverse().map(function (e) { return '<tr' + (e.ongoing ? ' class="hl"' : '') + '><td>' + e.peak + '</td><td>' + e.trough + '</td>' + heat(e.depth, 40) + '<td class="num">' + e.down_days + '</td><td class="num">' + (e.ongoing ? _t('進行中') : e.up_days) + '</td><td>' + (e.ongoing ? _t('現在 ') + fmt.pct(e.now, 1) : e.rec) + '</td></tr>'; }).join('') + _t('</tbody></table></div><p class="note">天數為交易日。</p>');
  }
  V.position.after = function () {
    var P = D.position || {}, M = D.model || {}, tiers = (M.ladder || []).map(function (t) { return t.dd; });
    (P.targets || []).forEach(function (h, i) {
      mount($('#c-uw-' + i), function (el) { lineChart(el, { h: 190, series: [{ name: _t('距高點'), data: h.uw, color: 'var(--down)', area: true }], refs: tiers.map(function (t) { return { y: t, color: 'var(--ink-3)', label: t + '%', below: true }; }).filter(function (r) { return r.y >= Math.min.apply(null, h.uw.map(function (p) { return p[1]; })) - 6; }), y1: 0, yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.pct(v, 1); }, aria: h.name + _t(' 距高點回撤') }); });
    });
    var bt = P.backtest || [], sel = 0;
    function drawBt() {
      var b = bt[sel]; if (!b) return;
      $('#bt-body').innerHTML = btBody(b); $('#bt-eps').innerHTML = epsHtml(b);
      var p = b.paths, st = p.step, ser = p.past.map(function (e) { return { name: e.label + _t('（') + e.depth + _t('%）'), data: e.pts.map(function (v, i) { return [i * st, v]; }), color: 'var(--ink-3)', w: 1, end: false }; });
      ser.push({ name: _t('這次（') + b.cur.peak + _t(' 起）'), data: p.cur.map(function (v, i) { return [i * st, v]; }), color: 'var(--red)', w: 3 });
      $('#bt-path-say').innerHTML = '<p class="say">' + esc(b.name) + _t(' 這段回撤從 ') + b.cur.peak + _t(' 起已 ') + b.cur.days + _t(' 個交易日，目前 <b>') + fmt.pct(b.cur.now, 1) + _t('</b>（本段最深 ') + fmt.pct(b.cur.depth, 1) + _t('）。</p>');
      mount($('#c-path'), function (el) { lineChart(el, { h: 300, xType: 'num', series: ser, x0: 0, x1: p.span, y1: 0, xticks: [[0, _t('高點')], [Math.round(p.span / 4), Math.round(p.span / 4) + _t(' 天')], [Math.round(p.span / 2), Math.round(p.span / 2) + _t(' 天')], [Math.round(p.span * 3 / 4), Math.round(p.span * 3 / 4) + _t(' 天')]], xTipFmt: function (x) { return _t('高點後第 ') + x + _t(' 天'); }, yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.pct(v, 1); }, aria: _t('這次回撤與歷次回撤的路徑比較') }); });
    }
    drawBt();
    var sg = $('#bt-seg'); if (sg) sg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; sel = +b.getAttribute('data-i'); sg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); drawBt(); });
    var r = $('#sim-dd');
    function sim() {
      var v = +r.value, used = 0;
      $('#sim-out').textContent = (v < 0 ? '−' : '') + Math.abs(v) + '%';
      $('#sim-steps').innerHTML = (M.ladder || []).map(function (t, i) { var on = v <= t.dd; if (on) used += t.add; return '<li class="' + (on ? 'on' : '') + _t('"><span>第 ') + (i + 1) + _t(' 階</span><span class="num">') + t.dd + '%</span><span>' + (on ? _t('✓ 加碼 ') + t.add + '%' : _t('未觸發（+') + t.add + _t('%）')) + '</span></li>'; }).join('');
      $('#sim-say').textContent = _t('回撤 ') + Math.abs(v) + _t('% 時，框架已用掉預留資金的 ') + used + _t('%，還留 ') + (100 - used) + _t('% 給更深的下跌。') + (v <= -20 ? _t('20% 以上的熊市，平均要一到兩年才收復，分批的意義就在這裡。') : '');
    }
    if (r) { r.addEventListener('input', sim); sim(); }
  };

  /* ---------------- 宏觀 ---------------- */
  V.macro = function () {
    var m = D.macro || {}, l = m.last || {}, hy = m.BAMLH0A0HYM2, ri = m.DFII10, dx = m.DTWEXBGS, fx = m.DEXTAUS;
    var kp = '<div class="kpis">' + kpi(_t('美債 10 年'), fmt.n(l.y10, 2) + '%', fmt.md(l.d) + _t(' · 一個月 ') + (l.y10_1m >= 0 ? '+' : '') + fmt.n(l.y10_1m, 2)) + kpi(_t('美債 2 年'), fmt.n(l.y2, 2) + '%', _t('最貼近 Fed 利率預期')) + kpi(_t('10 年 − 3 個月'), fmt.n(l.s10_3m, 2), l.s10_3m < 0 ? _t('倒掛') : _t('正斜率')) +
      kpi(_t('實質利率 10 年'), ri ? fmt.n(ri.v, 2) + '%' : '—', ri ? _t('扣掉通膨後的利率 · ') + fmt.md(ri.d) : _t('本日未取得')) + kpi(_t('美元指數（廣義）'), dx ? fmt.n(dx.v, 1) : '—', dx ? _t('一個月 ') + (dx.chg1m >= 0 ? '+' : '') + fmt.n(dx.chg1m, 2) + ' · ' + fmt.md(dx.d) : '') + kpi(_t('美元/台幣'), fx ? fmt.n(fx.v, 2) : '—', fx ? _t('一個月 ') + (fx.chg1m >= 0 ? '+' : '') + fmt.n(fx.chg1m, 2) + ' · ' + fmt.md(fx.d) : '') + '</div>';
    return readBar('macro') + kp + '<div class="grid">' +
      interpPanel([[_t('10 年期殖利率'), fmt.n(l.y10, 2) + '%'].concat(rdY10(l) || []), [_t('殖利率曲線'), fmt.n(l.s10_3m, 2)].concat(rdCurve(l) || []), [_t('高收益債利差'), hy ? fmt.n(hy.v, 2) + '%' : '—'].concat(rdHy(hy) || []),
        [_t('美元/台幣'), fx ? fmt.n(fx.v, 2) : '—'].concat(fx ? [fx.chg1m > 0.5 ? _t('台幣一個月貶超過 0.5 元，通常伴隨外資匯出、台股權值股承壓') : fx.chg1m < -0.5 ? _t('台幣一個月升超過 0.5 元，外資匯入，對台股資金面有利') : _t('台幣變動不大'), fx.chg1m > 0.5 ? 'neg' : fx.chg1m < -0.5 ? 'pos' : 'neu'] : [])]) +
      panel('span-6', _t('殖利率曲線'), _t('美國財政部 · 今天 vs 一個月前 vs 一年前'), legend([[_t('今天 ') + fmt.md((m.curve || {}).now && m.curve.now[0]), 'var(--red)'], [_t('一個月前'), 'var(--s2)', 'dash'], [_t('一年前'), 'var(--ink-3)', 'dash']]) + '<div class="chart" id="c-curve"></div>') +
      panel('span-6', _t('短中長天期殖利率'), _t('近三年'), legend([[_t('10 年'), 'var(--red)'], [_t('2 年'), 'var(--s2)'], [_t('3 個月'), 'var(--ink-3)']]) + '<div class="chart" id="c-yld"></div>') +
      panel('span-6', _t('殖利率利差'), _t('10 年 − 3 個月、10 年 − 2 年 · 低於 0 為倒掛'), legend([['10Y − 3M', 'var(--red)'], ['10Y − 2Y', 'var(--s2)']]) + '<div class="chart" id="c-spread"></div>') +
      panel('span-6', _t('高收益債利差'), _t('FRED · 信用市場的警報器'), '<div class="chart" id="c-hy"></div>') +
      panel('span-6', _t('美元指數（廣義）'), 'FRED', '<div class="chart" id="c-dxy"></div>') +
      panel('span-6', _t('美元兌新台幣'), _t('FRED · 數字越大台幣越弱'), '<div class="chart" id="c-fx"></div>') + '</div>';
  };
  V.macro.after = function () {
    var m = D.macro || {};
    if (m.curve) {
      var T = m.curve.tenors, xs = [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30], L = function (v) { return Math.log(v * 12); };
      var row = function (r) { return r.slice(1).map(function (v, i) { return [L(xs[i]), v]; }).filter(function (p) { return p[1] != null; }); };
      mount($('#c-curve'), function (el) { lineChart(el, { h: 240, xType: 'num', series: [{ name: _t('一年前'), data: row(m.curve.y1), color: 'var(--ink-3)', dash: '4 4', w: 1.5 }, { name: _t('一個月前'), data: row(m.curve.m1), color: 'var(--s2)', dash: '4 4', w: 1.5 }, { name: _t('今天'), data: row(m.curve.now), color: 'var(--red)', w: 2.5 }], xticks: [[L(0.25), '3M'], [L(1), '1Y'], [L(2), '2Y'], [L(5), '5Y'], [L(10), '10Y'], [L(30), '30Y']], xTipFmt: function (x) { var i = xs.map(L).reduce(function (b, v, j, a) { return Math.abs(v - x) < Math.abs(a[b] - x) ? j : b; }, 0); return T[i]; }, yFmt: function (v) { return v.toFixed(1) + '%'; }, tipFmt: function (v) { return fmt.n(v, 2) + '%'; }, aria: _t('殖利率曲線') }); });
    }
    var p2 = function (v) { return fmt.n(v, 2) + '%'; };
    if (m.y10) mount($('#c-yld'), function (el) { lineChart(el, { h: 240, series: [{ name: _t('3 個月'), data: m.y3m, color: 'var(--ink-3)', w: 1.5 }, { name: _t('2 年'), data: m.y2, color: 'var(--s2)', w: 1.5 }, { name: _t('10 年'), data: m.y10, color: 'var(--red)' }], yFmt: function (v) { return v.toFixed(1) + '%'; }, tipFmt: p2, aria: _t('殖利率走勢') }); });
    if (m.s10_2) mount($('#c-spread'), function (el) { lineChart(el, { h: 240, series: [{ name: '10Y − 2Y', data: m.s10_2, color: 'var(--s2)', w: 1.5 }, { name: '10Y − 3M', data: m.s10_3m, color: 'var(--red)' }], refs: [{ y: 0, color: 'var(--ink)', label: _t('0：倒掛線') }], yFmt: function (v) { return v.toFixed(1); }, tipFmt: function (v) { return fmt.n(v, 2); }, aria: _t('殖利率利差') }); });
    [['#c-hy', 'BAMLH0A0HYM2', p2, [{ y: 4.5, color: 'var(--warn)', label: _t('4.5% 緊張') }]], ['#c-dxy', 'DTWEXBGS', function (v) { return fmt.n(v, 1); }], ['#c-fx', 'DEXTAUS', function (v) { return fmt.n(v, 2); }]].forEach(function (x) {
      var s = m[x[1]]; if (!s) { var el = $(x[0]); if (el) el.innerHTML = _t('<p class="note">本日未取得資料。</p>'); return; }
      mount($(x[0]), function (el) { lineChart(el, { h: 220, series: [{ name: s.name, data: s.hist, color: 'var(--s1)', area: true }], refs: x[3] || [], yFmt: x[2], tipFmt: x[2], aria: s.name }); });
    });
  };

  /* ---------------- 情緒 ---------------- */
  V.sentiment = function () {
    var s = D.sentiment || {}, v = s.vix || {}, b = s.breadth || {}, f = s.fng;
    var kp = '<div class="kpis">' + kpi('VIX', fmt.n(v.v, 2), _t('一年第 ') + fmt.n(v.pct1y, 0) + _t(' 百分位 · ') + v.since.slice(0, 4) + _t(' 年以來中位數 ') + fmt.n(v.median_all, 1), (v.v || 0) / 40 * 100) +
      kpi(_t('VIX ÷ 3 個月 VIX'), fmt.n(v.ratio_3m, 2), _t('≥ 1 為倒掛（短期恐慌）'), (v.ratio_3m || 0) / 1.2 * 100) +
      kpi(_t('恐懼貪婪'), f ? fmt.n(f.score, 0) : '—', f ? esc(f.rating) + ' · ' + fmt.md(f.d) : _t('本日未取得'), f ? f.score : null) +
      kpi(_t('類股站上 200 日線'), b.sectors_above200 + ' / ' + b.sectors_n, _t('S&P 500 的 11 個類股'), b.sectors_above200 / b.sectors_n * 100) +
      kpi(_t('等權重 vs 市值權重'), fmt.pct((s.rsp_spy || {}).chg3m, 1), _t('3 個月 · 負值＝漲勢集中在大型股')) + '</div>';
    return readBar('sentiment') + kp + '<div class="grid">' +
      interpPanel([['VIX', fmt.n(v.v, 2)].concat(rdVix(v.v) || []), [_t('期限結構'), fmt.n(v.ratio_3m, 2)].concat(rdTerm(v.ratio_3m) || []), [_t('恐懼貪婪'), f ? fmt.n(f.score, 0) : '—'].concat(rdFng(f) || []), [_t('漲勢集中度'), fmt.pct((s.rsp_spy || {}).chg3m, 1)].concat(rdRsp(s.rsp_spy) || [])]) +
      panel('span-5', _t('VIX 期限結構'), _t('CBOE · 9 天 → 6 個月'), legend([[_t('今天'), 'var(--red)'], [_t('一個月前'), 'var(--ink-3)', 'dash']]) + _t('<div class="chart" id="c-term"></div><p class="note">正常是向上傾斜（長天期較高）；恐慌時短天期衝高、變成向下。</p>')) +
      panel('span-7', _t('VIX 近兩年'), _t('20 以上緊張 · 30 以上恐慌'), '<div class="chart" id="c-vix"></div>') +
      panel('span-6', _t('恐懼貪婪指數'), _t('CNN · 0 極度恐懼 → 100 極度貪婪'), f ? '<div class="meters">' + meter(_t('今天'), esc(f.rating), f.score, fmt.n(f.score, 0), '', [25, 45, 55, 75]) + meter(_t('一週前'), '', f.prev_week || 0, fmt.n(f.prev_week, 0), '', [25, 45, 55, 75]) + meter(_t('一個月前'), '', f.prev_month || 0, fmt.n(f.prev_month, 0), '', [25, 45, 55, 75]) + '</div><div class="chart" id="c-fng"></div>' : _t('<p class="note">本日未取得（CNN 有時會擋自動抓取）。</p>')) +
      panel('span-6', _t('等權重 ÷ 市值權重（RSP ÷ SPY）'), _t('往下＝少數大型股撐盤'), '<div class="chart" id="c-rsp"></div>') + '</div>';
  };
  V.sentiment.after = function () {
    var s = D.sentiment || {};
    if (s.term) { var lab = [_t('9 天'), _t('1 個月'), _t('3 個月'), _t('6 個月')], mk = function (a) { return a.map(function (x, i) { return [i, x.v]; }).filter(function (p) { return p[1] != null; }); };
      mount($('#c-term'), function (el) { lineChart(el, { h: 220, xType: 'num', series: [{ name: _t('一個月前'), data: mk(s.term_m1), color: 'var(--ink-3)', dash: '4 4', w: 1.5 }, { name: _t('今天'), data: mk(s.term), color: 'var(--red)', w: 2.5 }], xticks: lab.map(function (l, i) { return [i, l]; }), x0: -0.2, x1: 3.2, xTipFmt: function (x) { return lab[Math.round(x)]; }, yFmt: function (v) { return v.toFixed(0); }, tipFmt: function (v) { return fmt.n(v, 2); }, aria: _t('VIX 期限結構') }); }); }
    if (s.vix_hist) mount($('#c-vix'), function (el) { lineChart(el, { h: 240, series: [{ name: 'VIX', data: s.vix_hist, color: 'var(--s1)', area: true }], refs: [{ y: 20, color: 'var(--warn)', label: _t('20 緊張') }, { y: 30, color: 'var(--down)', label: _t('30 恐慌') }], tipFmt: function (v) { return fmt.n(v, 2); }, yFmt: function (v) { return v.toFixed(0); }, aria: _t('VIX 近兩年') }); });
    if (s.fng && s.fng.hist && $('#c-fng')) mount($('#c-fng'), function (el) { lineChart(el, { h: 160, series: [{ name: _t('恐懼貪婪'), data: s.fng.hist, color: 'var(--s1)' }], y0: 0, y1: 100, hbands: [{ y0: 0, y1: 25, color: 'var(--up-dim)' }, { y0: 75, y1: 100, color: 'var(--down-dim)' }], yFmt: function (v) { return v.toFixed(0); }, tipFmt: function (v) { return fmt.n(v, 0); }, aria: _t('恐懼貪婪近一年') }); });
    if (s.rsp_spy) mount($('#c-rsp'), function (el) { lineChart(el, { h: 220, series: [{ name: 'RSP ÷ SPY', data: s.rsp_spy.hist, color: 'var(--s2)' }], yFmt: function (v) { return v.toFixed(1); }, tipFmt: function (v) { return fmt.n(v, 2); }, aria: _t('等權重相對市值權重') }); });
  };

  /* ---------------- 板塊 ---------------- */
  function rrgSvg(items, title) {
    var pts = []; items.forEach(function (s) { (s.rrg || []).forEach(function (p) { pts.push(p); }); });
    if (!pts.length) return _t('<p class="note">歷史還不夠長，算不出輪動象限。</p>');
    var W = 640, H = 420, M = 30, lastP = items.filter(function (s) { return s.rrg && s.rrg.length; }).map(function (s) { return s.rrg[s.rrg.length - 1]; });
    var rx = Math.max(1.5, Math.max.apply(null, lastP.map(function (p) { return Math.abs(p[1] - 100); }))) * 1.35, ry = Math.max(0.8, Math.max.apply(null, lastP.map(function (p) { return Math.abs(p[2] - 100); }))) * 1.35;
    var X = function (v) { return M + (v - 100 + rx) / (2 * rx) * (W - 2 * M); }, Y = function (v) { return M + (1 - (v - 100 + ry) / (2 * ry)) * (H - 2 * M); };
    var cid = 'rc' + Math.random().toString(36).slice(2, 7);
    var s = '<defs><clipPath id="' + cid + '"><rect x="' + M + '" y="' + M + '" width="' + (W - 2 * M) + '" height="' + (H - 2 * M) + '"/></clipPath></defs><rect x="' + X(100) + '" y="' + M + '" width="' + (W - M - X(100)) + '" height="' + (Y(100) - M) + '" fill="var(--up-dim)"/><rect x="' + M + '" y="' + Y(100) + '" width="' + (X(100) - M) + '" height="' + (H - M - Y(100)) + '" fill="var(--down-dim)"/>';
    s += '<line x1="' + X(100) + '" x2="' + X(100) + '" y1="' + M + '" y2="' + (H - M) + '" stroke="var(--ink-3)" stroke-width="1"/><line x1="' + M + '" x2="' + (W - M) + '" y1="' + Y(100) + '" y2="' + Y(100) + '" stroke="var(--ink-3)" stroke-width="1"/>';
    s += '<text class="ql" x="' + (W - M - 6) + '" y="' + (M + 16) + _t('" text-anchor="end" fill="var(--up)">領漲</text><text class="ql" x="') + (W - M - 6) + '" y="' + (H - M - 8) + _t('" text-anchor="end" fill="var(--warn)">轉弱</text><text class="ql" x="') + (M + 6) + '" y="' + (H - M - 8) + _t('" fill="var(--down)">落後</text><text class="ql" x="') + (M + 6) + '" y="' + (M + 16) + _t('" fill="var(--red-ink)">改善</text>');
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + _t('" text-anchor="middle" style="font-size:11px" fill="var(--ink-3)">相對強度 →（相對大盤）</text><text x="10" y="') + (H / 2) + '" text-anchor="middle" style="font-size:11px" fill="var(--ink-3)" transform="rotate(-90 10 ' + (H / 2) + _t(')">動能 →</text>');
    var Cq = { '領漲': 'var(--up)', '轉弱': 'var(--warn)', '落後': 'var(--down)', '改善': 'var(--red-ink)' };
    items.forEach(function (it) {
      var p = it.rrg; if (!p || !p.length) return; var c = Cq[it.quad] || 'var(--ink-3)', l = p[p.length - 1];
      s += '<g clip-path="url(#' + cid + ')"><path d="' + p.map(function (q, i) { return (i ? 'L' : 'M') + X(q[1]).toFixed(1) + ',' + Y(q[2]).toFixed(1); }).join('') + '" fill="none" stroke="' + c + '" stroke-width="1.4" opacity=".55"/>';
      p.slice(0, -1).forEach(function (q) { s += '<circle cx="' + X(q[1]).toFixed(1) + '" cy="' + Y(q[2]).toFixed(1) + '" r="2" fill="' + c + '" opacity=".5"/>'; });
      s += '</g>';
      s += '<circle cx="' + X(l[1]).toFixed(1) + '" cy="' + Y(l[2]).toFixed(1) + '" r="5.5" fill="' + c + '" stroke="var(--deck)" stroke-width="2"><title>' + esc(it.name) + _t('：') + _t(it.quad) + '</title></circle><text class="lb" x="' + (X(l[1]) + 8).toFixed(1) + '" y="' + (Y(l[2]) + 4).toFixed(1) + '">' + esc(it.label || it.name) + '</text>';
    });
    return '<div class="rrg"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">' + s + '</svg></div>';
  }
  function secTable(rows, us) {
    return '<div class="tbl-wrap"><table class="tbl heat wide"><thead><tr><th>' + (us ? _t('類股 ETF') : _t('類股指數')) + _t('</th><th class="num">今日</th><th class="num">1 週</th><th class="num">1 個月</th><th class="num">3 個月</th>') + (us ? _t('<th class="num">今年</th><th class="num">200 日線</th>') : '') + _t('<th>象限</th></tr></thead><tbody>') +
      rows.map(function (s) { return '<tr><td><b>' + esc(us ? s.sym : s.name) + '</b>' + (us ? ' <span class="note">' + esc(s.name) + '</span>' : '') + '</td>' + heat(s.chg_pct, 3, 2) + heat(s.r1w, 6) + heat(s.r1m, 10) + heat(s.r3m, 20) + (us ? heat(s.ytd, 30) + heat(s.dev200, 15) : '') + '<td>' + qchip(s.quad) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  V.sectors = function () {
    var S = D.sectors || {}, us = (S.us || []).slice().sort(function (a, b) { return (b.r1m || 0) - (a.r1m || 0); }), tw = S.tw || [];
    var lead = us.filter(function (s) { return s.quad === '領漲'; }).map(function (s) { return s.name; }), imp = us.filter(function (s) { return s.quad === '改善'; }).map(function (s) { return s.name; });
    return readBar('sectors') +
      '<div class="grid">' + panel('span-12', _t('怎麼看輪動象限'), _t('相對強度與動能 · 週線'), _t('<p class="say">橫軸是「相對大盤強不強」，縱軸是「這個強弱正在變好還是變壞」。板塊通常沿順時針轉：<b>改善 → 領漲 → 轉弱 → 落後</b>。找潛力板塊，看的是剛從左上「改善」往右上走的那幾個；尾巴是過去 6 週的軌跡。</p>') +
        _t('<p class="note">美股目前領漲：') + (lead.join(_t('、')) || _t('無')) + _t('；正在改善：') + (imp.join(_t('、')) || _t('無')) + _t('。象限是相對大盤的強弱，不代表會漲。</p>')) +
      panel('span-7', _t('美股類股輪動'), _t('相對 S&P 500（SPY）'), rrgSvg(us.map(function (s) { return Object.assign({ label: s.name }, s); }), _t('美股類股輪動象限'))) +
      panel('span-5', _t('美股類股表現'), _t('SPDR 類股 ETF · 依 1 個月排序'), secTable(us, true)) +
      panel('span-7', _t('台股類股輪動'), _t('相對加權指數 · 證交所類股指數'), rrgSvg(tw.filter(function (s) { return s.rrg; }).slice(0, 8).concat(tw.filter(function (s) { return s.rrg; }).slice(-4)), _t('台股類股輪動象限'))) +
      panel('span-5', _t('台股類股表現'), _t('依 1 個月排序 · 前 8 與後 4'), secTable(tw.slice(0, 8).concat(tw.slice(-4)), false)) + '</div>';
  };

  /* ---------------- 台股籌碼 ---------------- */
  function twTable(keys, etf) {
    return _t('<div class="tbl-wrap"><table class="tbl heat wide"><colgroup><col style="width:22%"></colgroup><thead><tr><th>代號</th><th class="num">收盤</th><th class="num">今日</th><th class="num">1 個月</th><th class="num">今年</th><th class="num">距高點</th>') +
      (etf ? _t('<th class="num">折溢價</th><th class="num">淨值</th>') : _t('<th class="num">本益比</th><th class="num">殖利率</th><th class="num">月營收年增</th>')) + _t('<th>52 週位置</th></tr></thead><tbody>') +
      keys.filter(Q).map(function (k) { var q = Q(k), rv = q.rev || {}, nv = q.nav || {};
        return '<tr><td><b>' + code(k) + '</b> <span class="note">' + esc(q.name) + '</span></td><td class="num">' + px(q.c) + '</td>' + heat(q.chg_pct, 4, 2) + heat(q.r1m, 12) + heat(q.ytd, 40) + heat(q.dd_ath, 30) +
          (etf ? '<td class="num ' + cls(nv.prem) + '">' + (nv.prem == null ? '—' : fmt.pct(nv.prem, 2)) + '</td><td class="num">' + (nv.nav == null ? '—' : fmt.n(nv.nav, 2)) + '</td>'
               : '<td class="num">' + (q.pe ? fmt.n(q.pe, 1) : '—') + '</td><td class="num">' + (q.yield ? fmt.n(q.yield, 2) + '%' : '—') + '</td>' + heat(rv.yoy, 50) ) +
          '<td>' + p52(q) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  V.taiwan = function () {
    var t = D.taiwan || {}, s = t.inst_sum, m = t.margin_last, f = t.fut_last, a = t.adr;
    var kp = '<div class="kpis">' + kpi(_t('外資今日'), s ? (s.f1 >= 0 ? '+' : '') + yi(s.f1) : '—', s ? fmt.md(s.d) + (Math.abs(s.streak) >= 2 ? _t(' · 連 ') + Math.abs(s.streak) + _t(' 日') + (s.streak > 0 ? _t('買') : _t('賣')) : '') : '', null, s ? cls(s.f1) : '') +
      kpi(_t('外資近 20 日'), s ? (s.f20 >= 0 ? '+' : '') + yi(s.f20) : '—', _t('投信近 5 日 ') + (s ? (s.t5 >= 0 ? '+' : '') + yi(s.t5) : '—'), null, s ? cls(s.f20) : '') +
      kpi(_t('融資餘額'), m ? yi(m.v) : '—', m ? _t('20 日 ') + fmt.pct(m.chg20, 1) + ' · ' + fmt.md(m.d) : '') +
      kpi(_t('外資台指期淨單'), f ? fmt.n(f.oi, 0) + _t(' 口') : '—', f ? _t('5 日 ') + (f.chg5 >= 0 ? '+' : '') + fmt.n(f.chg5, 0) + ' · ' + fmt.md(f.d) : '', null, f ? cls(f.oi) : '') +
      kpi(_t('台積電 ADR 溢價'), a ? fmt.pct(a.v, 1) : '—', a ? _t('ADR 換算 ÷ 台股') : '') + '</div>';
    var etfs = ['TW_0050', 'TW_006208', 'TW_0056', 'TW_00878', 'TW_00919', 'TW_00929', 'TW_00713', 'TW_00679B'];
    var stocks = Object.keys(D.quotes).filter(function (k) { return k.indexOf('TW_') === 0 && (Q(k) || {}).kind === 'stock'; });
    return readBar('taiwan') + kp + '<div class="grid">' +
      interpPanel([[_t('外資現貨'), s ? yi(s.f5) : '—'].concat(rdInst(s) || []), [_t('外資期貨'), f ? fmt.n(f.oi, 0) + _t(' 口') : '—'].concat(rdFut(f) || []), [_t('融資'), m ? yi(m.v) : '—'].concat(rdMargin(m) || []), [_t('ADR 溢價'), a ? fmt.pct(a.v, 1) : '—'].concat(rdAdr(a) || [])]) +
      panel('span-7', _t('外資買賣超'), _t('證交所 · 近 60 日 · 億元'), '<div class="chart" id="c-inst"></div>') +
      panel('span-5', _t('投信買賣超'), _t('近 60 日 · 億元 · 投信常是中小型股的主力'), '<div class="chart" id="c-trust"></div>') +
      panel('span-6', _t('外資台指期淨未平倉'), _t('期交所 · 口 · 負值為淨空單'), '<div class="chart" id="c-fut"></div>') +
      panel('span-6', _t('融資餘額'), _t('證交所 · 億元 · 散戶槓桿'), '<div class="chart" id="c-margin"></div>') +
      panel('span-12', _t('台股 ETF'), _t('證交所 · 折溢價為盤後預估淨值'), twTable(etfs, true) + _t('<p class="note">折溢價：市價比淨值貴（正）或便宜（負）。溢價超過 1% 時買進等於多付錢，高股息 ETF 在除息前後常出現。</p>')) +
      panel('span-12', _t('台股權值與 AI 供應鏈'), _t('本益比、殖利率：證交所 · 月營收：最新公布月份'), twTable(stocks, false) + _t('<p class="note">月營收每月 10 日前公布，是台股最即時的基本面數據；年增率連續轉強常領先股價。</p>')) +
      panel('span-12', _t('台積電 ADR 溢價'), _t('近一年 · %'), '<div class="chart" id="c-adr"></div>') + '</div>';
  };
  V.taiwan.after = function () {
    var t = D.taiwan || {};
    if (t.inst) {
      var bar = function (id, col) { mount($(id), function (el) { barChart(el, { h: 220, data: t.inst.map(function (r) { return [fmt.md(r[0]), r[col] || 0, '<div class="t">' + r[0] + '</div><div class="r"><i style="background:currentColor"></i><span>' + (col === 1 ? _t('外資') : _t('投信')) + '</span><b>' + yi(r[col], 2) + '</b></div>']; }), color: function (r) { return r[1] >= 0 ? 'var(--up)' : 'var(--down)'; }, yFmt: function (v) { return fmt.n(v, 0); }, aria: _t('買賣超') }); }); };
      bar('#c-inst', 1); bar('#c-trust', 2);
    }
    if (t.fut) mount($('#c-fut'), function (el) { lineChart(el, { h: 220, series: [{ name: _t('外資淨未平倉'), data: t.fut, color: 'var(--s2)' }], refs: [{ y: 0, color: 'var(--ink-3)' }], yFmt: fmt.k, tipFmt: function (v) { return fmt.n(v, 0) + _t(' 口'); }, aria: _t('外資台指期淨未平倉') }); });
    if (t.margin) mount($('#c-margin'), function (el) { lineChart(el, { h: 220, series: [{ name: _t('融資餘額'), data: t.margin, color: 'var(--s1)', area: true }], yFmt: function (v) { return fmt.n(v, 0); }, tipFmt: function (v) { return yi(v); }, aria: _t('融資餘額') }); });
    if (t.adr) mount($('#c-adr'), function (el) { lineChart(el, { h: 200, series: [{ name: _t('ADR 溢價'), data: t.adr.hist, color: 'var(--s1)' }], refs: [{ y: 0, color: 'var(--ink-3)' }], yFmt: function (v) { return v.toFixed(0) + '%'; }, tipFmt: function (v) { return fmt.pct(v, 1); }, aria: _t('台積電 ADR 溢價') }); });
  };

  /* ---------------- 觀察清單 ---------------- */
  function watchTable(keys) {
    return _t('<div class="tbl-wrap"><table class="tbl heat wide"><colgroup><col style="width:20%"><col style="width:10%"><col><col><col><col><col><col><col style="width:7%"><col style="width:12%"></colgroup><thead><tr><th>代號</th><th class="num">收盤</th><th class="num">今日</th><th class="num">1 個月</th><th class="num">今年</th><th class="num">距高點</th><th class="num">200 日線</th><th class="num">RSI</th><th>52 週</th><th>近 60 日</th></tr></thead><tbody>') +
      keys.filter(Q).map(function (k) { var q = Q(k); return '<tr><td><b>' + code(k) + '</b> <span class="note">' + esc(q.name) +  + '</span></td><td class="num">' + px(q.c) + '</td>' + heat(q.chg_pct, 4, 2) + heat(q.r1m, 15) + heat(q.ytd, 50) + heat(q.dd_ath, 40) + heat(q.dev200, 25) + '<td class="num ' + (q.rsi >= 70 ? 'up' : q.rsi <= 30 ? 'down' : '') + '">' + fmt.n(q.rsi, 0) + '</td><td>' + p52(q) + '</td><td>' + spk(q.spark, 100, 24) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  V.watch = function () {
    var ks = Object.keys(D.quotes), grp = {}, twG = {};
    ks.forEach(function (k) { var q = Q(k); if (q && q.kind === 'stock') { var g = (k.indexOf('TW_') === 0 ? _t('台股・') : _t('美股・')) + (q.group || _t('其他')); (grp[g] = grp[g] || []).push(k); if (k.indexOf('TW_') === 0) twG[g] = 1; } });
    var idx = ['SPY', 'VOO', 'QQQ', 'DIA', 'IWM', 'RSP', 'SMH', 'TLT', 'GLD'];
    return readBar('watch') + '<div class="grid">' +
      panel('span-12', _t('美股指數與 ETF'), 'Nasdaq', watchTable(idx)) +
      Object.keys(grp).sort().map(function (g) { return panel('span-12', esc(g), twG[g] ? _t('證交所') : 'Nasdaq', watchTable(grp[g])); }).join('') +
      panel('span-12', _t('怎麼用這張表'), '', _t('<p class="say">找加碼點時，先看<b>距高點</b>與 <b>200 日線</b>：好公司跌到 200 日線附近、RSI 接近 30，常是分批的時機；漲到離 200 日線 20% 以上、RSI 超過 70，追價就要小心。<b>52 週位置</b>的豎線越靠左，代表越接近一年低點。</p><p class="note">這是觀察清單，不是推薦名單。個股波動遠大於指數，單一個股的部位要控制。</p>')) + '</div>';
  };

  V.method = function () {
    var src = [['Nasdaq', _t('美股、ETF、那斯達克與費半指數日線（近 10 年）'), _t('每日')], [_t('FRED（聖路易聯儲）'), _t('S&P 500 指數、那斯達克 100 長歷史、高收益債利差、實質利率、美元指數、美元兌台幣'), _t('每日（部分晚 1–7 天）')], [_t('美國財政部'), _t('殖利率曲線'), _t('每日')], ['CBOE', _t('VIX、VIX9D、VIX3M、VIX6M'), _t('每日')], ['CNN', _t('恐懼貪婪指數'), _t('每日（常擋自動抓取）')], [_t('臺灣證券交易所'), _t('加權指數、個股與 ETF 日線、三大法人、融資融券、類股指數、本益比與殖利率、月營收、ETF 預估淨值'), _t('每個交易日')], [_t('臺灣期貨交易所'), _t('三大法人台指期未平倉'), _t('每個交易日')], [_t('鉅亨網'), _t('共同基金淨值、經理費、規模、前十大持股（重點追蹤版）'), _t('每日（境外基金晚一到兩天）')], ['multpl', _t('席勒本益比、S&P 500 每股盈餘（長線視角版）'), _t('每月')], ['Yahoo', _t('S&P 500 1928 年起日線、美股收盤當天的最新收盤'), _t('每日')], [_t('老錢日日談 Big Picture'), _t('長線視角版多張圖的構想參考（stock.laoqianriritan.com）；資料與程式為本站自有'), '—']];
    return '<div class="grid">' + panel('span-12', _t('這是什麼'), '', _t('<div class="prose"><p>晨鐘是一份給長期投資人的美股、台股日報：看懂市場今天發生什麼、現在在什麼位置、資金往哪裡去，以及在回檔時依照事先寫好的規則分批加碼。它是破曉 Daybreak（比特幣日報）的姊妹刊。</p>') +
      _t('<p><b>原則</b>：數字由程式每天自動抓、自動算，取不到就顯示「本日未取得」，不推估、不沿用舊值。文字判讀由 Claude 每天讀數據後撰寫，只解釋數字、不改數字。加碼框架是範例參數，每月檢討才改。</p>') +
      _t('<p><b>發刊</b>：晨刊（美股收盤後，台北約 07:00）以 S&P 500 為頭版；午後刊（台股收盤、法人數據公布後，台北約 16:00）以加權指數為頭版。</p>') +
      _t('<p><b>顏色</b>：採台灣慣例，紅色是漲、綠色是跌。</p></div>')) +
      panel('span-12', _t('資料來源'), _t('全部免費、不需金鑰'), _t('<div class="tbl-wrap"><table class="tbl"><thead><tr><th>來源</th><th>用在哪裡</th><th>更新</th></tr></thead><tbody>') + src.map(function (s) { return '<tr><td><b>' + s[0] + '</b></td><td>' + s[1] + '</td><td>' + s[2] + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      panel('span-12', _t('限制'), '', _t('<div class="prose"><p>報酬只算價格，不含股息（高股息 ETF 的實際報酬會比圖上高）。0050 在 2025-06-18 一拆四，之前的價格已除以 4。美股個股與 ETF 的「距高點」只看近 10 年；S&P 500 指數回測用 Yahoo 1928 年起的日線。輪動象限是本站自算的簡化版，和商業軟體的數值不同。台積電 ADR 溢價的匯率來自 FRED，會晚幾天。</p><p>本站僅供研究參考，不構成任何投資建議；投資前請自行判斷並承擔風險。</p></div>')) + '</div>';
  };

  /* ---------------- 版面切換（沿用破曉） ---------------- */
  var cur = null, seen = {};
  function ids0() { return ROUTES.map(function (r) { return r[0]; }); }
  function stickyH() { var el = MQ.matches ? document.querySelector('.rail') : document.querySelector('.top'); return el ? el.offsetHeight : 0; }
  var GAP = 16;   // 跳轉與換頁頓點時，版面標題上方留白
  function renderAll() {
    var v = $('#view');
    v.innerHTML = ROUTES.map(function (r, i) {
      var mh = r[0] === 'overview' ? '' : '<header class="mod-h"><span class="idx">' + ('0' + (i + 1)).slice(-2) + '</span><h1>' + r[1] + '</h1><p>' + r[2] + ' · ' + fmt.md(D.meta.bar_date) + ' ' + EDN() + '</p></header>';
      var body; try { body = V[r[0]](); } catch (e) { body = _t('<p class="err">這個模組載入失敗：') + esc(e.message) + '</p>'; console.error(e); }
      return '<section class="pg" id="pg-' + r[0] + '" data-r="' + r[0] + '" aria-label="' + r[1] + '">' + mh + body + '</section>';
    }).join('');
    ROUTES.forEach(function (r) { try { if (V[r[0]].after) V[r[0]].after(); } catch (e) { console.error(e); } });
    mounted.forEach(observe); settleMeters(v);
    try { annotateCodes(v); } catch (e) { console.error(e); }
    void v.offsetWidth; v.classList.add('view-enter');
  }
  function activate(id) {
    if (id === cur) return;
    var r = ROUTES.filter(function (x) { return x[0] === id; })[0], ids = ids0();
    if (cur && !reduced) {
      var fwd = ids.indexOf(id) > ids.indexOf(cur), w = $('#wipe');
      w.className = 'wipe ' + (MQ.matches ? (fwd ? 'rtl' : 'ltr') : 'v ' + (fwd ? 'up' : 'down')); void w.offsetWidth; w.classList.add('on');
    }
    cur = id; hideTip();
    document.querySelectorAll('#view .pg').forEach(function (sec) { sec.classList.toggle('cur', sec.getAttribute('data-r') === id); });
    document.querySelectorAll('.nav button').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-r') === id ? 'page' : 'false'); });
    var nv = $('#nav'), nb = nv.querySelector('[aria-current="page"]');   // 行動版頂部導航可橫向捲動：把目前版面捲到中間
    if (nb && nv.scrollWidth > nv.clientWidth) nv.scrollTo({ left: nb.offsetLeft - nv.offsetLeft - (nv.clientWidth - nb.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
    $('#crumb-k').textContent = r[2]; $('#crumb-t').textContent = r[1];
    document.title = (id === 'overview' ? _t('晨鐘 Morningbell') : r[1] + _t('｜晨鐘 Morningbell'));
    if (location.hash.slice(1) !== id) { try { history.replaceState(null, '', '#' + id); } catch (e) {} }
    if (!seen[id]) { seen[id] = 1; decodeNums($('#pg-' + id)); }
  }
  // 目前版面＝開頭已經捲過畫面 40% 高度的最後一個版面
  function spy() {
    if (MQ.matches) return;   // 行動版分頁顯示，不跟捲動切換
    var line = stickyH() + (window.innerHeight - stickyH()) * 0.4, pick = ROUTES[0][0];
    document.querySelectorAll('#view .pg').forEach(function (sec) { if (sec.getBoundingClientRect().top <= line) pick = sec.getAttribute('data-r'); });
    activate(pick);
  }
  function docTop(sec) { var y = 0; for (var el = sec; el; el = el.offsetParent) y += el.offsetTop; return y; }   // 用 offsetTop 計算，不受進場動畫的位移影響
  // 行動版換版後回到頂部：手指左右滑常帶一點上下動作，手機會在換版後繼續慣性捲動、把回頂蓋掉；
  // 先短暫鎖住捲動讓慣性停下，再回頂，之後幾個時間點再確認一次
  function toTop() {
    var de = document.documentElement, b = document.body;
    de.style.overflow = b.style.overflow = 'hidden';
    window.scrollTo(0, 0); de.scrollTop = b.scrollTop = 0;
    requestAnimationFrame(function () { de.style.overflow = b.style.overflow = ''; window.scrollTo(0, 0); });
    [80, 250, 500].forEach(function (t) { setTimeout(function () { if (MQ.matches && window.scrollY > 0) window.scrollTo(0, 0); }, t); });
  }
  function go(id) {
    var sec = $('#pg-' + id); if (!sec) return;
    if (MQ.matches) { activate(id); toTop(); return; }
    window.scrollTo(0, id === ROUTES[0][0] ? 0 : docTop(sec) - stickyH() - GAP);
    spy();
  }
  function shell() {
    if (LANG === 'en') {
      document.querySelectorAll('[data-en]').forEach(function (el) { el.textContent = el.getAttribute('data-en'); });
      document.querySelectorAll('[data-en-href]').forEach(function (el) { el.setAttribute('href', el.getAttribute('data-en-href')); });
      document.querySelectorAll('[data-en-label]').forEach(function (el) { el.setAttribute('aria-label', el.getAttribute('data-en-label')); });
    }
    $('#nav').innerHTML = ROUTES.map(function (r, i) { return '<button type="button" data-r="' + r[0] + '"><span class="i">' + ('0' + (i + 1)).slice(-2) + '</span><span>' + r[1] + '</span></button>'; }).join('');
    $('#nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(b.getAttribute('data-r')); });
    document.addEventListener('keydown', function (e) { if ((e.target.closest && e.target.closest('input,textarea')) || e.metaKey || e.ctrlKey || e.altKey) return; var n = e.key === '0' ? 10 : +e.key; if (n >= 1 && n <= ROUTES.length) go(ROUTES[n - 1][0]); });
    // 跨過 860px（旋轉、縮放視窗）時切換顯示方式，停在同一版
    var onMode = function () { if (MQ.matches) window.scrollTo(0, 0); else go(cur); };
    if (MQ.addEventListener) MQ.addEventListener('change', onMode); else if (MQ.addListener) MQ.addListener(onMode);
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (h !== cur) go(h); });
    // 桌面換頁頓點：滾輪捲過版面開頭時，先停在「該版標題貼齊頂部列」的位置，頓 HOLD 毫秒（期間的滾輪與慣性吃掉），之後照常捲動
    var hold = 0, HOLD = 260;
    window.addEventListener('wheel', function (e) {
      if (MQ.matches || e.ctrlKey || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      var now = Date.now();
      if (now < hold) { e.preventDefault(); return; }
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1), doc = document.documentElement;
      for (var el = e.target; el && el.nodeType === 1 && el !== doc; el = el.parentElement)   // 內層可捲動區還沒捲完就交給它
        if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY) && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return;
      var y = window.scrollY, to = y + dy, sh = stickyH(), secs = document.querySelectorAll('#view .pg');
      for (var i = 1; i < secs.length; i++) {
        var b = docTop(secs[i]) - sh - GAP;
        if ((dy > 0 && y < b - 1 && to >= b) || (dy < 0 && y > b + 1 && to <= b)) { e.preventDefault(); window.scrollTo(0, b); hold = now + HOLD; return; }
      }
    }, { passive: false });
    var ticking = false;
    window.addEventListener('scroll', function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; spy(); }); }, { passive: true });
    // 行動版：在內容區左右滑動切換到相鄰版面。圖表、表格、滑桿等本身要橫向操作的區域，以及螢幕邊緣（瀏覽器返回手勢）不觸發
    var sw = null, view = $('#view');
    view.addEventListener('touchstart', function (e) {
      sw = null;
      var p = e.touches[0];
      if (e.touches.length !== 1 || !MQ.matches || p.clientX < 16 || p.clientX > window.innerWidth - 16) return;
      if (e.target.closest('input, textarea, select')) return;   // 滑桿要自己用橫向手勢
      for (var el = e.target; el && el !== view; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
      sw = { x: p.clientX, y: p.clientY, t: Date.now() };
    }, { passive: true });
    view.addEventListener('touchcancel', function () { sw = null; }, { passive: true });
    view.addEventListener('touchend', function (e) {
      if (!sw) return;
      var p = e.changedTouches[0], dx = p.clientX - sw.x, dy = p.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2 || dt > 1000) return;
      var i = ROUTES.map(function (r) { return r[0]; }).indexOf(cur) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < ROUTES.length) go(ROUTES[i][0]);
    }, { passive: true });
    // 日刊／夜刊：桌面在側欄、行動版在頂部列右上；語言：選了就記住（daybreak.lang），重新載入套用
    var tt = $('#theme'), mt = $('#m-theme'), SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>', MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
    function setTheme(v) {
      if (v === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
      tt.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-t') === v); });
      if (mt) { mt.innerHTML = v === 'dark' ? MOON : SUN; mt.setAttribute('data-v', v); }
    }
    function pickTheme(v) { setTheme(v); try { localStorage.setItem('morningbell.theme', v); } catch (er) {} mounted.forEach(function (el) { el._draw && el._draw(el); }); }
    tt.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) pickTheme(b.getAttribute('data-t')); });
    if (mt) mt.addEventListener('click', function () { pickTheme(mt.getAttribute('data-v') === 'dark' ? 'light' : 'dark'); });
    try { setTheme(localStorage.getItem('morningbell.theme') === 'dark' ? 'dark' : 'light'); } catch (e) { setTheme('light'); }
    // 中／EN：選了就記住（morningbell.lang），網址上的 ?lang= 拿掉後重新載入；切換時字先散成點再換
    var lg = $('#lang');
    if (lg) {
      lg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-l') === LANG); });
      lg.classList.toggle('en', LANG === 'en');
      lg.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b || b.getAttribute('data-l') === LANG) return;
        var to = b.getAttribute('data-l'); try { localStorage.setItem('morningbell.lang', to); } catch (er) {}
        lg.classList.toggle('en', to === 'en'); lg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        var u = new URL(location.href); u.searchParams.delete('lang');
        document.documentElement.classList.add('lang-out');
        setTimeout(function () { location.replace(u.pathname + u.search + u.hash); }, reduced ? 0 : 260);
      });
    }
    var pad = function (x) { return ('0' + x).slice(-2); };
    // 下一期：晨刊台北 07:00（UTC 23:00）、午後刊台北 16:00（UTC 08:00）
    function tick() { var t = new Date(), c = [8, 23].map(function (h) { var n = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), h, 0)); if (n <= t) n = new Date(+n + 864e5); return n; }), nx = c[0] < c[1] ? c[0] : c[1], d = Math.floor((nx - t) / 1000); $('#nxt').textContent = 'T−' + pad(Math.floor(d / 3600)) + ':' + pad(Math.floor(d % 3600 / 60)) + ':' + pad(d % 60); }
    tick(); setInterval(tick, 1000);
    var fs = $('#fs'); fs.addEventListener('click', function () { var d = document; try { if (d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen().catch(function () {}); } catch (e) {} });
    var q = Q(heroKey());
    $('#tk-px').textContent = (D.meta.edition === 'tw' ? _t('加權 ') : 'S&P ') + fmt.n(q.c, 0);
    $('#tk-chg').textContent = fmt.pct(q.chg_pct, 2); $('#tk-chg').className = 'chip ' + cls(q.chg_pct);
    $('#tk-stance').innerHTML = '<i></i>' + esc(N ? N.stance.label : '—');
    $('#tk-asof').textContent = EDN() + ' · ' + fmt.md(D.meta.bar_date) + _t(' 收盤');
    $('#ed-date').textContent = D.meta.bar_date + (N ? _t(' · 第 ') + N.edition + _t(' 期') : '');
    $('#ed-gen').textContent = _t('資料 ') + (D.meta.generated_utc || '').slice(11, 16) + _t(' UTC 產出');
  }

  function load(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
  // 英文版：判讀讀 data/notes.en.json；沒有、或比中文版舊，就用中文版並標示「今天只有中文」
  Promise.all([load('data/latest.json'), load('data/notes.json').catch(function () { return null; }), LANG === 'en' ? load('data/notes.en.json').catch(function () { return null; }) : null]).then(function (a) {
    D = locData(a[0]); var nn = a[1], ne = a[2];
    if (ne && nn && ne.date === nn.date && (ne.slot || 'tw') === (nn.slot || 'tw')) nn = ne; else if (nn && LANG === 'en') nn.zh_only = true;
    N = nn && nn.date === D.meta.bar_date && (nn.slot || 'tw') === D.meta.edition ? nn : (nn ? Object.assign({}, nn, { stale: true }) : null);
    shell();
    renderAll();
    var start = location.hash.slice(1);
    if (start && start !== 'overview' && $('#pg-' + start)) {
      go(start);
      var y0 = window.scrollY; if (document.fonts) document.fonts.ready.then(function () { if (Math.abs(window.scrollY - y0) < 2) go(start); });
    } else { window.scrollTo(0, 0); activate(ROUTES[0][0]); }
  }).catch(function (e) { $('#view').innerHTML = _t('<p class="err">資料載入失敗：') + esc(e.message) + _t('。請稍後重新整理。</p>'); console.error(e); });
})();
