/* ═══════════════════════════════════════════════════════════════
   공용 차트 라이브러리 (텔레그램 카드 card.html · 실시간 차트 chart.html 이 같이 씀)
   · 일봉 켈트너(20/10/1.5): 중심선(주황)·상하단(노랑), 선 굵기 설정 / 분·시간봉에서는 '그날의 일봉 값'을 계단 수평선으로
   · 하단 지표: 거래량 → RSI(과매수·과매도) → 스토캐스틱 5/3/3 → 스토캐스틱 25/9/9 (버튼으로 켜고 끔, 순서 고정)
   · ICT: 지지·저항(과거 저항→지지/지지→저항 '전환' 구분), 구조(BOS·CHoCH), FVG, 오더블록, 유동성(EQH/EQL·스윕), 프리미엄/디스카운트
   ═══════════════════════════════════════════════════════════════ */
(function () {
"use strict";
const LW = window.LightweightCharts, KST = 9 * 3600, DAY = 86400;
const COL = { up: "#ff4d5d", dn: "#4fc3ff", kMid: "#ff9f1a", kBand: "#ffd84d", rsi: "#c792ff", sk: "#4fc3ff", sd: "#ff9f43", vol: "#ffd84d" };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/* ───────── 지표 계산 ───────── */
/* 일봉 켈트너(20/10/1.5) — 사이트 computeDailyKel 과 같은 식: EMA20(첫 종가 시드) ± Wilder ATR10 × 1.5 */
function dailyKeltner(daily) {
  const n = daily.length, out = new Array(n).fill(null);
  if (n < 12) return out;
  const k = 2 / 21; let b = daily[0].close; const basis = [b];
  for (let i = 1; i < n; i++) { b = daily[i].close * k + b * (1 - k); basis.push(b); }
  const tr = [];
  for (let i = 1; i < n; i++) { const h = daily[i].high, l = daily[i].low, pc = daily[i - 1].close; tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
  if (tr.length < 10) return out;
  let atr = mean(tr.slice(0, 10)); const A = new Array(n).fill(null); A[10] = atr;
  for (let j = 10; j < tr.length; j++) { atr = (atr * 9 + tr[j]) / 10; A[j + 1] = atr; }
  for (let i = 10; i < n; i++) out[i] = { mid: basis[i], up: basis[i] + 1.5 * A[i], lo: basis[i] - 1.5 * A[i] };
  return out;
}
/* 어떤 봉이든 '그 봉이 속한 날의 일봉 켈트너 값'으로 채움(계단 수평선). 마지막 날은 진행 중인 일봉이라 실시간으로 움직임 */
function stepKeltner(bars, daily, dk) {
  const idx = new Map(daily.map((d, i) => [d.time, i]));
  const mid = [], up = [], lo = [];
  bars.forEach((b) => {
    const i = idx.get(Math.floor(b.time / DAY) * DAY), v = i != null ? dk[i] : null;
    if (!v) return;
    mid.push({ time: b.time + KST, value: v.mid }); up.push({ time: b.time + KST, value: v.up }); lo.push({ time: b.time + KST, value: v.lo });
  });
  return { mid, up, lo };
}
function rsiArr(cl, p) {
  p = p || 14; const out = new Array(cl.length).fill(null);
  if (cl.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = cl[i] - cl[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / p, al = l / p; out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  return out;
}
/* 스토캐스틱: %K = 원시K를 smoothK 이동평균, %D = %K의 d 이동평균 (5/3/3, 25/9/9) */
function stochArr(cs, n, sk, d) {
  const len = cs.length, raw = new Array(len).fill(null);
  for (let i = n - 1; i < len; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, cs[j].high); ll = Math.min(ll, cs[j].low); }
    raw[i] = hh === ll ? 50 : (cs[i].close - ll) / (hh - ll) * 100;
  }
  const sma = (a, w) => a.map((_, i) => { if (i < w - 1) return null; let s = 0; for (let j = i - w + 1; j <= i; j++) { if (a[j] == null) return null; s += a[j]; } return s / w; });
  const K = sma(raw, sk), D = sma(K, d);
  return { k: K, d: D };
}

/* ───────── ICT 분석 ───────── */
function ictAnalyze(cs, o) {
  o = o || {}; const n = cs.length, k = o.k || 5, price = n ? cs[n - 1].close : 0;
  const res = { sr: [], struct: [], fvg: [], ob: [], liq: [], sweeps: [], pd: null, trend: 0, lastEvent: null };
  if (n < 30) return res;
  const hi = (i) => cs[i].high, lo = (i) => cs[i].low;
  const piv = [];
  for (let i = k; i < n - k; i++) {
    let H = true, L = true;
    for (let j = 1; j <= k; j++) { if (hi(i) <= hi(i - j) || hi(i) < hi(i + j)) H = false; if (lo(i) >= lo(i - j) || lo(i) > lo(i + j)) L = false; }
    if (H) piv.push({ i, type: "H", price: hi(i) });
    if (L) piv.push({ i, type: "L", price: lo(i) });
  }
  /* 구조: 확정된 최근 스윙 고점/저점의 종가 돌파 → 추세 방향이면 BOS, 반대면 CHoCH */
  let lastSH = null, lastSL = null, trend = 0, pi = 0;
  for (let i = 0; i < n; i++) {
    while (pi < piv.length && piv[pi].i <= i - k) { const p = piv[pi++]; if (p.type === "H") lastSH = { i: p.i, price: p.price, broken: false }; else lastSL = { i: p.i, price: p.price, broken: false }; }
    const c = cs[i].close;
    if (lastSH && !lastSH.broken && c > lastSH.price) {
      lastSH.broken = true; const kind = trend < 0 ? "CHoCH" : "BOS"; trend = 1;
      res.struct.push({ kind, dir: 1, t1: cs[lastSH.i].time, t2: cs[i].time, price: lastSH.price, i });
      let m = lastSH.i; for (let j = lastSH.i; j <= i; j++) if (lo(j) < lo(m)) m = j;
      let j = m; while (j > 0 && cs[j].close >= cs[j].open) j--;
      res.ob.push({ dir: 1, i: j, t1: cs[j].time, lo: lo(j), hi: hi(j), at: i });
    } else if (lastSL && !lastSL.broken && c < lastSL.price) {
      lastSL.broken = true; const kind = trend > 0 ? "CHoCH" : "BOS"; trend = -1;
      res.struct.push({ kind, dir: -1, t1: cs[lastSL.i].time, t2: cs[i].time, price: lastSL.price, i });
      let m = lastSL.i; for (let j = lastSL.i; j <= i; j++) if (hi(j) > hi(m)) m = j;
      let j = m; while (j > 0 && cs[j].close <= cs[j].open) j--;
      res.ob.push({ dir: -1, i: j, t1: cs[j].time, lo: lo(j), hi: hi(j), at: i });
    }
  }
  res.trend = trend; res.lastEvent = res.struct.length ? res.struct[res.struct.length - 1] : null;
  res.struct = res.struct.slice(-4);
  /* 오더블록: 이후 종가가 구역을 완전히 이탈하면(미티게이트) 제거 */
  res.ob = res.ob.filter((b) => { for (let j = b.at + 1; j < n; j++) { if (b.dir > 0 && cs[j].close < b.lo) return false; if (b.dir < 0 && cs[j].close > b.hi) return false; } return true; }).slice(-2);
  /* FVG: 3봉 갭, 이후 가격이 갭을 완전히 메우면 제거 */
  const fv = [];
  for (let i = 2; i < n; i++) {
    if (lo(i) > hi(i - 2) && (lo(i) - hi(i - 2)) / price > 0.0008) fv.push({ dir: 1, i, t1: cs[i - 2].time, lo: hi(i - 2), hi: lo(i) });
    else if (hi(i) < lo(i - 2) && (lo(i - 2) - hi(i)) / price > 0.0008) fv.push({ dir: -1, i, t1: cs[i - 2].time, lo: hi(i), hi: lo(i - 2) });
  }
  res.fvg = fv.filter((g) => { for (let j = g.i + 1; j < n; j++) { if (g.dir > 0 && lo(j) <= g.lo) return false; if (g.dir < 0 && hi(j) >= g.hi) return false; } return true; }).slice(-3);
  /* 유동성: 같은 가격대 스윙(EQH/EQL) + 스윕(꼬리로 훑고 종가는 되돌림) */
  const H = piv.filter((p) => p.type === "H").slice(-14), L = piv.filter((p) => p.type === "L").slice(-14);
  const eq = (arr, type) => {
    for (let a = arr.length - 1; a >= 1; a--) for (let b = a - 1; b >= 0; b--) {
      if (arr[a].i - arr[b].i >= 3 && Math.abs(arr[a].price - arr[b].price) / arr[a].price < 0.0015) {
        const p = (arr[a].price + arr[b].price) / 2; let swept = false;
        for (let j = arr[a].i + 1; j < n; j++) if (type === "H" ? hi(j) > p : lo(j) < p) { swept = true; break; }
        if (!swept && res.liq.filter((x) => x.type === type).length < 2) res.liq.push({ type, t1: cs[arr[b].i].time, t2: cs[arr[a].i].time, price: p });
      }
    }
  };
  eq(H, "H"); eq(L, "L");
  piv.slice(-16).forEach((p) => {
    for (let j = p.i + k + 1; j < n; j++) {
      if (p.type === "H" && hi(j) > p.price) { if (cs[j].close < p.price) res.sweeps.push({ type: "BSL", t: cs[j].time, price: hi(j) }); break; }
      if (p.type === "L" && lo(j) < p.price) { if (cs[j].close > p.price) res.sweeps.push({ type: "SSL", t: cs[j].time, price: lo(j) }); break; }
    }
  });
  res.sweeps = res.sweeps.slice(-2);
  /* 프리미엄/디스카운트: 최근 150봉 범위의 50%(EQ) 위=프리미엄, 아래=디스카운트 */
  const from = Math.max(0, n - 150); let hh = -Infinity, ll = Infinity, hi_i = from, lo_i = from;
  for (let i = from; i < n; i++) { if (hi(i) > hh) { hh = hi(i); hi_i = i; } if (lo(i) < ll) { ll = lo(i); lo_i = i; } }
  res.pd = { hi: hh, lo: ll, eq: (hh + ll) / 2, t1: cs[Math.min(hi_i, lo_i)].time, zone: price > (hh + ll) / 2 ? "프리미엄" : "디스카운트" };
  /* 지지·저항 + '전환'(과거 저항→지지 / 과거 지지→저항): 같은 가격대(0.7%) 피벗을 묶고 시간순 역할 변화를 봄 */
  const cl = [];
  piv.slice().sort((a, b) => a.price - b.price).forEach((p) => {
    const c = cl.find((x) => Math.abs(x.p - p.price) / x.p < 0.007);
    if (c) { c.p = (c.p * c.t.length + p.price) / (c.t.length + 1); c.t.push(p); } else cl.push({ p: p.price, t: [p] });
  });
  const lv = cl.filter((c) => c.t.length >= 2).map((c) => {
    const t = c.t.slice().sort((a, b) => a.i - b.i), role = (x) => (x.type === "H" ? "R" : "S");
    const first = role(t[0]), last = role(t[t.length - 1]), now = price > c.p ? "S" : "R";
    const flip = first !== last && last === now ? (first === "R" ? "R→S" : "S→R") : null;
    return { price: c.p, role: now, flip, n: t.length, t1: cs[t[0].i].time, dist: Math.abs(c.p - price) / price };
  });
  const near = lv.filter((x) => x.dist < 0.25).sort((a, b) => a.dist - b.dist);
  const flips = near.filter((x) => x.flip).slice(0, 3), rest = near.filter((x) => !x.flip);
  const R = rest.filter((x) => x.role === "R").slice(0, 2), S = rest.filter((x) => x.role === "S").slice(0, 3);
  res.sr = [...R, ...S, ...flips].sort((a, b) => b.price - a.price);
  return res;
}

/* ───────── ICT 도형 그리기(시리즈 프리미티브) ───────── */
class Overlay {
  constructor() { this.items = []; this.series = null; this.chart = null; this.req = null; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  setItems(it) { this.items = it; this.req && this.req(); }
  paneViews() {
    const self = this;
    return [
      { zOrder: () => "bottom", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s, "box")) }) },
      { zOrder: () => "top", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s, "line")) }) },
    ];
  }
  draw({ context: c, mediaSize }, layer) {
    if (!this.chart || !this.series) return;
    const ts = this.chart.timeScale(), X = (t) => (t == null ? mediaSize.width : ts.timeToCoordinate(t + KST)), Y = (p) => this.series.priceToCoordinate(p);
    c.save(); c.font = '700 13px "Pretendard","Malgun Gothic","Nanum Gothic",sans-serif'; c.textBaseline = "middle";
    this.items.forEach((it) => {
      const x1 = X(it.t1), x2 = it.t2 === undefined ? mediaSize.width : X(it.t2);
      if (it.kind === "box" && layer === "box") {
        const y1 = Y(it.p1), y2 = Y(it.p2); if (x1 == null || y1 == null || y2 == null) return;
        const xa = Math.max(0, Math.min(x1, x2 == null ? x1 : x2)), xb = x2 == null ? mediaSize.width : Math.max(x1, x2);
        c.fillStyle = it.fill; c.fillRect(xa, Math.min(y1, y2), xb - xa, Math.abs(y2 - y1));
        if (it.stroke) { c.strokeStyle = it.stroke; c.lineWidth = 1; c.strokeRect(xa + 0.5, Math.min(y1, y2) + 0.5, xb - xa - 1, Math.abs(y2 - y1) - 1); }
        if (it.label && xb - xa > 90) { c.fillStyle = it.text || "#fff"; c.textAlign = "right"; c.fillText(it.label, xb - 6, Math.min(y1, y2) + Math.min(11, Math.abs(y2 - y1) / 2 + 1)); }
      } else if (it.kind === "line" && layer === "line") {
        const y = Y(it.p); if (y == null || x1 == null) return;
        const xe = x2 == null ? mediaSize.width : x2;
        c.strokeStyle = it.color; c.lineWidth = it.w || 1.5; c.setLineDash(it.dash || [6, 5]); c.beginPath(); c.moveTo(x1, y); c.lineTo(xe, y); c.stroke(); c.setLineDash([]);
        if (it.label && xe - x1 > 90) { c.fillStyle = it.color; c.textAlign = "center"; c.fillText(it.label, (x1 + xe) / 2, y + (it.below ? 12 : -9)); }
      } else if (it.kind === "tag" && layer === "line") {
        const y = Y(it.p); if (y == null || x1 == null) return;
        c.fillStyle = it.color; c.textAlign = "center"; c.fillText(it.label, x1, y + (it.below ? 14 : -10));
      }
    });
    c.restore();
  }
}

/* ICT 결과 → 도형 목록 */
function ictItems(a, o) {
  const items = [], rgba = (h, al) => { const n = parseInt(h.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + al + ")"; };
  if (o.pd && a.pd) {
    items.push({ kind: "box", t1: a.pd.t1, t2: undefined, p1: a.pd.hi, p2: a.pd.eq, fill: "rgba(255,150,80,.055)" });
    items.push({ kind: "box", t1: a.pd.t1, t2: undefined, p1: a.pd.eq, p2: a.pd.lo, fill: "rgba(90,200,255,.055)" });
    items.push({ kind: "line", t1: a.pd.t1, t2: undefined, p: a.pd.eq, color: "rgba(200,210,230,.55)", dash: [3, 5], w: 1, label: "EQ 50%" });
  }
  if (o.fvg) a.fvg.forEach((g) => items.push({ kind: "box", t1: g.t1, t2: undefined, p1: g.hi, p2: g.lo, fill: g.dir > 0 ? "rgba(255,77,93,.17)" : "rgba(79,195,255,.17)", label: "FVG", text: g.dir > 0 ? "#ff9aa5" : "#9fdcff" }));
  if (o.ob) a.ob.forEach((b) => items.push({ kind: "box", t1: b.t1, t2: undefined, p1: b.hi, p2: b.lo, fill: b.dir > 0 ? "rgba(255,77,93,.24)" : "rgba(79,195,255,.24)", stroke: b.dir > 0 ? "rgba(255,120,130,.9)" : "rgba(120,210,255,.9)", label: b.dir > 0 ? "OB ↑" : "OB ↓", text: "#fff" }));
  if (o.struct) a.struct.forEach((s) => items.push({ kind: "line", t1: s.t1, t2: s.t2, p: s.price, color: s.kind === "CHoCH" ? "#ffb020" : "#9fb4d8", dash: [5, 4], w: s.kind === "CHoCH" ? 2 : 1.4, label: s.kind + (s.dir > 0 ? "↑" : "↓"), below: s.dir < 0 }));
  if (o.liq) {
    a.liq.forEach((l) => items.push({ kind: "line", t1: l.t1, t2: undefined, p: l.price, color: "#e8e8ff", dash: [2, 4], w: 1.2, label: l.type === "H" ? "EQH" : "EQL", below: l.type === "L" }));
    a.sweeps.forEach((s) => false && items.push({ kind: "tag", t1: s.t, p: s.price, color: "#ffe36a", label: s.type === "BSL" ? "BSL 스윕▼" : "SSL 스윕▲", below: s.type === "SSL" }));
  }
  void rgba; return items;
}

/* ───────── 차트 만들기 ─────────
   data: { candles:[{time(UTC초),open,high,low,close,volume}], daily:[같은 형식, 일봉], precision? }
   opt : { iv, subs:["vol","rsi","st533","st2599"], rsiOB, rsiOS, kel:{on,wC,wB}, ict:{sr,struct,fvg,ob,liq,pd}, ... } */
const SUB_TITLE = { vol: "거래량 (거래대금$) · 노랑선=20봉 평균", rsi: "RSI (14)", st533: "스토캐스틱 5/3/3", st2599: "스토캐스틱 25/9/9" };
const SUB_ORDER = ["vol", "rsi", "st533", "st2599"];
function build(el, data, opt) {
  opt = opt || {}; el.innerHTML = "";
  const subs = SUB_ORDER.filter((s) => (opt.subs || SUB_ORDER).includes(s));
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0a0f19" }, textColor: "#9fb1cf", fontFamily: '"Pretendard","Malgun Gothic","Nanum Gothic",system-ui,sans-serif', fontSize: 14, panes: { separatorColor: "#34507f", separatorHoverColor: "#6f9bff", enableResize: false } },
    grid: { vertLines: { color: "#101a2b" }, horzLines: { color: "#101a2b" } },
    rightPriceScale: { borderColor: "#1c2a44", scaleMargins: { top: 0.07, bottom: 0.06 } },
    timeScale: { borderColor: "#1c2a44", timeVisible: true, rightOffset: 18, barSpacing: opt.barSpacing || 8,
      tickMarkFormatter: (t, type) => { const x = new Date(t * 1000), p = (n) => String(n).padStart(2, "0"), W = ["일", "월", "화", "수", "목", "금", "토"]; return type <= 2 ? (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + "(" + W[x.getUTCDay()] + ")" : p(x.getUTCHours()) + ":" + p(x.getUTCMinutes()); } },
    localization: { timeFormatter: (t) => { const x = new Date(t * 1000), p = (n) => String(n).padStart(2, "0"); return (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + " " + p(x.getUTCHours()) + ":" + p(x.getUTCMinutes()); } },
    crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
  });
  const cs = data.candles, last = cs[cs.length - 1], pf = last.close >= 100 ? 2 : (last.close >= 1 ? 4 : 6);
  const main = chart.addSeries(LW.CandlestickSeries, { upColor: COL.up, downColor: COL.dn, borderUpColor: COL.up, borderDownColor: COL.dn, wickUpColor: COL.up, wickDownColor: COL.dn, priceLineColor: "", priceLineStyle: 2, priceFormat: { type: "price", precision: pf, minMove: Math.pow(10, -pf) } }, 0);
  main.setData(cs.map((c) => ({ time: c.time + KST, open: c.open, high: c.high, low: c.low, close: c.close })));
  const ctl = { chart, main, overlay: new Overlay(), priceLines: [], kel: {}, subSeries: {}, opt, data, subs };
  main.attachPrimitive(ctl.overlay);
  const lw = (lvl) => [1, 1.4, 2, 2.8, 3.6][Math.min(5, Math.max(1, lvl || 2)) - 1];

  /* 일봉 켈트너: 일봉 차트면 그대로 선, 분·시간봉이면 그날의 일봉 값을 계단 수평선으로 */
  const K = opt.kel || {}, isDaily = opt.iv === "1d";
  function drawKeltner() {
    ["mid", "up", "lo"].forEach((k) => { if (ctl.kel[k]) { try { chart.removeSeries(ctl.kel[k]); } catch (e) {} ctl.kel[k] = null; } });
    if (K.on === false || !data.daily || data.daily.length < 12) { ctl.dk = null; return; }
    const dk = dailyKeltner(data.daily); ctl.dk = dk;
    const st = isDaily ? { mid: [], up: [], lo: [] } : stepKeltner(cs, data.daily, dk);
    if (isDaily) data.daily.forEach((d, i) => { const v = dk[i]; if (!v) return; st.mid.push({ time: d.time + KST, value: v.mid }); st.up.push({ time: d.time + KST, value: v.up }); st.lo.push({ time: d.time + KST, value: v.lo }); });
    const mk = (pts, color, w) => { const s = chart.addSeries(LW.LineSeries, { color, lineWidth: lw(w), lineType: isDaily ? 0 : 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: pf, minMove: Math.pow(10, -pf) } }, 0); s.setData(pts); return s; };
    ctl.kel.mid = mk(st.mid, COL.kMid, K.wC); ctl.kel.up = mk(st.up, COL.kBand, K.wB); ctl.kel.lo = mk(st.lo, COL.kBand, K.wB);
  }
  drawKeltner();

  /* 하단 지표 패널 (순서: 거래량 → RSI → 스토 5/3/3 → 스토 25/9/9) */
  const closes = cs.map((c) => c.close), T = (c) => c.time + KST;
  subs.forEach((id, idx) => {
    const pane = idx + 1;
    if (id === "vol") {
      const vs = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "custom", formatter: (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v.toFixed(0)) }, priceLineVisible: false, lastValueVisible: false }, pane);
      vs.setData(cs.map((c) => ({ time: T(c), value: c.volume, color: c.close >= c.open ? "rgba(255,77,93,.78)" : "rgba(79,195,255,.78)" })));
      const ma = []; let s = 0; cs.forEach((c, i) => { s += c.volume; if (i >= 20) s -= cs[i - 20].volume; if (i >= 19) ma.push({ time: T(c), value: s / 20 }); });
      const ml = chart.addSeries(LW.LineSeries, { color: COL.vol, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane); ml.setData(ma);
      ctl.subSeries.vol = vs;
    } else if (id === "rsi") {
      const r = rsiArr(closes, 14), s = chart.addSeries(LW.LineSeries, { color: COL.rsi, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0), minMove: 1 } }, pane);
      s.setData(cs.map((c, i) => (r[i] == null ? { time: T(c) } : { time: T(c), value: r[i] })));
      const ob = opt.rsiOB || 70, os = opt.rsiOS || 30;
      s.createPriceLine({ price: ob, color: "rgba(255,77,93,.8)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: os, color: "rgba(79,195,255,.8)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 50, color: "rgba(150,165,190,.35)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: "" });
      ctl.subSeries.rsi = s; ctl.rsi = r;
    } else {
      const [n, a, b] = id === "st533" ? [5, 3, 3] : [25, 9, 9], st = stochArr(cs, n, a, b);
      const sk = chart.addSeries(LW.LineSeries, { color: COL.sk, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0), minMove: 1 } }, pane);
      const sd = chart.addSeries(LW.LineSeries, { color: COL.sd, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0), minMove: 1 } }, pane);
      sk.setData(cs.map((c, i) => (st.k[i] == null ? { time: T(c) } : { time: T(c), value: st.k[i] })));
      sd.setData(cs.map((c, i) => (st.d[i] == null ? { time: T(c) } : { time: T(c), value: st.d[i] })));
      sk.createPriceLine({ price: 80, color: "rgba(255,77,93,.75)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      sk.createPriceLine({ price: 20, color: "rgba(79,195,255,.75)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      ctl.subSeries[id] = sk; ctl[id] = st;
    }
  });
  const ps = chart.panes(); ps[0].setStretchFactor(subs.length ? 3.2 : 1); subs.forEach((_, i) => ps[i + 1] && ps[i + 1].setStretchFactor(1));

  /* ICT: 도형 + 지지·저항(전환 구분) */
  const I = opt.ict || {};
  function drawIct() {
    ctl.priceLines.forEach((l) => { try { main.removePriceLine(l); } catch (e) {} }); ctl.priceLines = [];
    const a = ictAnalyze(cs); ctl.ictRes = a;
    ctl.overlay.setItems(ictItems(a, I));
    if (I.sr !== false) a.sr.forEach((l) => {
      const flip = !!l.flip, color = flip ? (l.flip === "R→S" ? "#00e5c3" : "#ff5ee0") : (l.role === "R" ? "#ff8a6a" : "#5fd6a0");
      ctl.priceLines.push(main.createPriceLine({ price: l.price, color, lineWidth: flip ? 2 : 1, lineStyle: flip ? 2 : 0, axisLabelVisible: false, title: "" }));
    });
    const sw = []; /* 고점·저점 라벨(화살표 + 가격) */
    const k = 12;
    for (let i = k; i < cs.length - 1; i++) {
      let h = true, l = true; for (let j = Math.max(0, i - k); j <= Math.min(cs.length - 1, i + k); j++) { if (j === i) continue; if (cs[j].high > cs[i].high) h = false; if (cs[j].low < cs[i].low) l = false; }
      if (h) sw.push({ time: T(cs[i]), position: "aboveBar", color: "#ffffff", shape: "arrowDown", text: "" });
      else if (l) sw.push({ time: T(cs[i]), position: "belowBar", color: "#ffffff", shape: "arrowUp", text: "" });
    }
    if (ctl.mk) ctl.mk.setMarkers(sw.slice(-5)); else ctl.mk = LW.createSeriesMarkers(main, sw.slice(-5));
    return a;
  }
  const a = drawIct();

  /* 패널 제목(왼쪽 위) */
  function titles() {
    el.querySelectorAll(".paneTitle").forEach((x) => x.remove());
    const pr = chart.panes(), base = el.getBoundingClientRect(), mk = (txt, top) => { const d = document.createElement("div"); d.className = "paneTitle"; d.textContent = txt; d.style.cssText = "position:absolute;left:10px;top:" + (top + 4) + "px;z-index:6;font:700 13px 'Pretendard','Malgun Gothic','Nanum Gothic',sans-serif;color:#aebfdc;background:rgba(10,15,25,.78);padding:2px 7px;border-radius:5px;pointer-events:none"; el.appendChild(d); };
    subs.forEach((id, i) => { const p = pr[i + 1]; if (!p || !p.getHTMLElement()) return; mk(SUB_TITLE[id], p.getHTMLElement().getBoundingClientRect().top - base.top); });
    const lg = []; if (K.on !== false) lg.push("일봉 켈트너(20/10/1.5) — 중심선 주황 · 상하단 노랑" + (isDaily ? "" : " · 그날의 일봉 값(계단)"));
    const d = document.createElement("div"); d.className = "paneTitle"; d.textContent = lg.join(""); d.style.cssText = "position:absolute;left:10px;top:6px;z-index:6;font:700 13px 'Pretendard','Malgun Gothic','Nanum Gothic',sans-serif;color:#c9d6ee;background:rgba(10,15,25,.78);padding:2px 7px;border-radius:5px;pointer-events:none"; if (lg.length) el.appendChild(d);
  }
  chart.timeScale().setVisibleLogicalRange({ from: -1, to: cs.length - 1 + Math.max(18, Math.round(cs.length * 0.09)) });   /* 오른쪽 여백 18봉: 최신 봉·가격 숫자가 겹치지 않게 */
  setTimeout(titles, 60); ctl.titles = titles;
  /* 라이브 갱신용 */
  ctl.refreshAll = () => { drawKeltner(); const r = drawIct(); return r; };
  ctl.summary = () => summarize(ctl, cs, data.daily);
  return ctl;
}

/* 요약(텔레그램 문구·화면 하단 공통) */
function summarize(ctl, cs, daily) {
  const price = cs[cs.length - 1].close, a = ctl.ictRes || ictAnalyze(cs), out = { ict: {}, kel: null };
  if (ctl.dk) {
    const v = ctl.dk[ctl.dk.length - 1];
    if (v) out.kel = { mid: v.mid, up: v.up, lo: v.lo, pos: price > v.up ? "상단 위(돌파)" : price > v.mid ? "중심선~상단" : price > v.lo ? "하단~중심선" : "하단 아래" };
  }
  const ev = a.lastEvent;
  out.ict = { trend: a.trend > 0 ? "상승 구조" : a.trend < 0 ? "하락 구조" : "구조 불명", last: ev ? ev.kind + (ev.dir > 0 ? "↑" : "↓") + " (" + (cs.length - 1 - ev.i) + "봉 전)" : "—", fvg: a.fvg.length, ob: a.ob.length,
    pd: a.pd ? a.pd.zone : "—", flips: a.sr.filter((x) => x.flip).map((x) => x.flip + " " + x.price.toPrecision(5)), eqh: a.liq.filter((x) => x.type === "H").length, eql: a.liq.filter((x) => x.type === "L").length, sweeps: a.sweeps.map((s) => s.type) };
  const lastRsi = ctl.rsi ? ctl.rsi[ctl.rsi.length - 1] : null; out.rsi = lastRsi == null ? null : Math.round(lastRsi);
  ["st533", "st2599"].forEach((id) => { const s = ctl[id]; if (s) out[id] = { k: Math.round(s.k[s.k.length - 1] || 0), d: Math.round(s.d[s.d.length - 1] || 0) }; });
  return out;
}

window.ChartLib = { build, dailyKeltner, stepKeltner, rsiArr, stochArr, ictAnalyze, summarize, COL, KST, DAY, SUB_ORDER };
})();
