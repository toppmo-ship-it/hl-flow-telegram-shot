/* ═══════════════════════════════════════════════════════════════
   공용 차트 라이브러리 (텔레그램 카드 card.html · 실시간 차트 chart.html 이 같이 씀)
   · 일봉 켈트너(20/10/1.5): 중심선(주황)·상하단(노랑), 선 굵기 설정 / 분·시간봉에서는 '그날의 일봉 값'을 계단 수평선으로
   · 하단 지표: 거래량 → RSI(과매수·과매도) → 스토캐스틱 5/3/3 → 스토캐스틱 25/9/9 (버튼으로 켜고 끔, 순서 고정)
   · ICT: 지지·저항(과거 저항→지지/지지→저항 '전환' 구분), 구조(BOS·CHoCH), FVG, 오더블록, 유동성(EQH/EQL·스윕), 프리미엄/디스카운트
   ═══════════════════════════════════════════════════════════════ */
(function () {
"use strict";
const root_ = typeof window !== "undefined" ? window : globalThis;
const LW = window.LightweightCharts, KST = 9 * 3600, DAY = 86400;
const COL = { up: "#ff4d5d", dn: "#4fc3ff", kMid: "#ff9f1a", kBand: "#ffd84d", kBand1: "#f0dc6e", rsi: "#c792ff", sk: "#4fc3ff", sd: "#ff9f43", vol: "#ffd84d" };
/* 소수 인덱스도 안전하게: 정수 두 점 사이를 직접 보간 (logicalToCoordinate 는 소수에서 0을 돌려줄 때가 있음) */
function lc(ts, i) { const f = Math.floor(i), a = ts.logicalToCoordinate(f); if (a == null) return null; if (f === i) return a; const b = ts.logicalToCoordinate(f + 1); return b == null ? a : a + (b - a) * (i - f); }
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
  for (let i = 10; i < n; i++) out[i] = { mid: basis[i], up: basis[i] + 1.5 * A[i], lo: basis[i] - 1.5 * A[i], up1: basis[i] + 1.0 * A[i], lo1: basis[i] - 1.0 * A[i] };
  return out;
}
/* 어떤 봉이든 '그 봉이 속한 날의 일봉 켈트너 값'으로 채움(계단 수평선). 마지막 날은 진행 중인 일봉이라 실시간으로 움직임 */
function stepKeltner(bars, daily, dk) {
  const idx = new Map(daily.map((d, i) => [d.time, i]));
  const mid = [], up = [], lo = [], up1 = [], lo1 = [], rows = [];
  bars.forEach((b, bi) => {
    const i = idx.get(Math.floor(b.time / DAY) * DAY), v = i != null ? dk[i] : null;
    if (!v) return;
    mid.push({ time: b.time + KST, value: v.mid }); up.push({ time: b.time + KST, value: v.up }); lo.push({ time: b.time + KST, value: v.lo });
    up1.push({ time: b.time + KST, value: v.up1 }); lo1.push({ time: b.time + KST, value: v.lo1 }); rows.push({ i: bi, up: v.up, up1: v.up1, lo1: v.lo1, lo: v.lo });
  });
  return { mid, up, lo, up1, lo1, rows };
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
        const yt = Math.min(y1, y2), hh = Math.max(1, Math.abs(y2 - y1));
        if (it.fade) { const g = c.createLinearGradient(xa, 0, xa + Math.min(120, xb - xa), 0); g.addColorStop(0, it.fade); g.addColorStop(1, it.fill); c.fillStyle = g; } else c.fillStyle = it.fill;
        c.fillRect(xa, yt, xb - xa, hh);
        if (it.edge) { c.strokeStyle = it.edge; c.lineWidth = 1; c.beginPath(); c.moveTo(xa, yt + .5); c.lineTo(xb, yt + .5); c.moveTo(xa, yt + hh - .5); c.lineTo(xb, yt + hh - .5); c.stroke(); }
        if (it.mid) { c.strokeStyle = it.mid; c.lineWidth = it.midW || 1.5; c.setLineDash(it.sdash || []); c.beginPath(); c.moveTo(xa, yt + hh / 2); c.lineTo(xb, yt + hh / 2); c.stroke(); c.setLineDash([]); }
        if (it.stroke) { c.strokeStyle = it.stroke; c.lineWidth = 1; c.setLineDash(it.sdash || []); c.strokeRect(xa + 0.5, yt + 0.5, xb - xa - 1, hh - 1); c.setLineDash([]); }
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

/* 켈트너 1.0 ~ 1.5 사이 음영 (연한 그린). 일중 봉은 계단 모양으로 */
class BandFill {
  constructor() { this.rows = []; this.step = false; this.color = "rgba(61,220,151,.13)"; this.chart = null; this.series = null; this.req = null; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  set(rows, step, color) { this.rows = rows; this.step = step; this.color = color; this.req && this.req(); }
  paneViews() { const self = this; return [{ zOrder: () => "bottom", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s)) }) }]; }
  draw({ context: c }) {
    if (!this.chart || !this.series || !this.rows.length) return;
    const ts = this.chart.timeScale(), Y = (p) => this.series.priceToCoordinate(p);
    const poly = (ka, kb) => {
      const top = [], bot = [];
      this.rows.forEach((r, k) => {
        const x = ts.logicalToCoordinate(r.i); if (x == null) return;
        const ya = Y(r[ka]), yb = Y(r[kb]); if (ya == null || yb == null) return;
        if (this.step && k > 0 && top.length) { top.push([x, top[top.length - 1][1]]); bot.push([x, bot[bot.length - 1][1]]); }
        top.push([x, ya]); bot.push([x, yb]);
      });
      if (top.length < 2) return;
      c.beginPath(); c.moveTo(top[0][0], top[0][1]); top.forEach((q) => c.lineTo(q[0], q[1])); for (let k = bot.length - 1; k >= 0; k--) c.lineTo(bot[k][0], bot[k][1]); c.closePath(); c.fill();
    };
    c.save(); c.fillStyle = this.color; poly("up", "up1"); poly("lo1", "lo"); c.restore();
  }
}
/* 주말 밤 음영: 미장 금요일 마감(16:00 ET) ~ 월요일 08:00 KST (거래량이 줄어드는 시간) */
class NightBand {
  constructor() { this.bands = []; this.color = "#5b6cff"; this.chart = null; this.req = null; }
  attached(p) { this.chart = p.chart; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  set(b, col) { this.bands = b; this.color = col; this.req && this.req(); }
  paneViews() { const self = this; return [{ zOrder: () => "bottom", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s)) }) }]; }
  draw({ context: c, mediaSize }) {
    if (!this.chart) return;
    const ts = this.chart.timeScale(), n = parseInt(this.color.slice(1), 16), R = n >> 16 & 255, G = n >> 8 & 255, B = n & 255;
    c.save();
    this.bands.forEach((b) => {
      const x1 = lc(ts, b.a), x2 = lc(ts, b.b); if (x1 == null || x2 == null) return;
      const xa = Math.max(0, x1), xb = Math.min(mediaSize.width, x2); if (xb <= xa) return;
      const g = c.createLinearGradient(0, 0, 0, mediaSize.height);
      g.addColorStop(0, "rgba(" + R + "," + G + "," + B + ",.15)"); g.addColorStop(1, "rgba(" + R + "," + G + "," + B + ",.05)");
      c.fillStyle = g; c.fillRect(xa, 0, xb - xa, mediaSize.height);
      c.strokeStyle = "rgba(" + R + "," + G + "," + B + ",.28)"; c.lineWidth = 1; c.beginPath();
      if (x1 >= 0) { c.moveTo(Math.round(x1) + .5, 0); c.lineTo(Math.round(x1) + .5, mediaSize.height); }
      if (x2 <= mediaSize.width) { c.moveTo(Math.round(x2) + .5, 0); c.lineTo(Math.round(x2) + .5, mediaSize.height); }
      c.stroke();
    });
    c.restore();
  }
}
/* RSI 과매수(위)·과매도(아래) 구간 노란 음영 */
class RsiZones {
  constructor(ob, os) { this.ob = ob; this.os = os; this.series = null; this.req = null; }
  attached(p) { this.series = p.series; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  paneViews() { const self = this; return [{ zOrder: () => "bottom", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s)) }) }]; }
  draw({ context: c, mediaSize }) {
    if (!this.series) return;
    const Y = (v) => this.series.priceToCoordinate(v), yOb = Y(this.ob), yOs = Y(this.os), y100 = Y(100), y0 = Y(0);
    c.save();
    if (yOb != null && y100 != null) { const g = c.createLinearGradient(0, y100, 0, yOb); g.addColorStop(0, "rgba(255,216,77,.26)"); g.addColorStop(1, "rgba(255,216,77,.09)"); c.fillStyle = g; c.fillRect(0, Math.min(y100, yOb), mediaSize.width, Math.abs(yOb - y100)); }
    if (yOs != null && y0 != null) { const g = c.createLinearGradient(0, yOs, 0, y0); g.addColorStop(0, "rgba(255,216,77,.09)"); g.addColorStop(1, "rgba(255,216,77,.26)"); c.fillStyle = g; c.fillRect(0, Math.min(y0, yOs), mediaSize.width, Math.abs(y0 - yOs)); }
    c.restore();
  }
}
/* 시각(UTC초+KST) → 소수 인덱스, 주말 밤 구간 계산 */
function weekendBands(TT) {
  if (TT.length < 2) return [];
  const dt = (TT[TT.length - 1] - TT[0]) / (TT.length - 1);
  const fi = (t) => {
    if (t <= TT[0]) return (t - TT[0]) / dt;
    if (t >= TT[TT.length - 1]) return TT.length - 1 + (t - TT[TT.length - 1]) / dt;
    let lo = 0, hi = TT.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (TT[m] <= t) lo = m; else hi = m; }
    return lo + (t - TT[lo]) / (TT[hi] - TT[lo]);
  };
  const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  const out = [], t0 = TT[0] - KST - 6 * DAY, t1 = TT[TT.length - 1] - KST + 6 * DAY;
  for (let d = Math.floor(t0 / DAY) * DAY; d <= t1; d += DAY) {
    const dd = new Date(d * 1000); if (dd.getUTCDay() !== 5) continue;
    const y = dd.getUTCFullYear(), m = dd.getUTCMonth(), day = dd.getUTCDate();
    let inst = Date.UTC(y, m, day, 20); if (String(ny.format(new Date(inst))).replace(/\D/g, "") !== "16") inst = Date.UTC(y, m, day, 21);
    const a = inst / 1000 + KST, b = Date.UTC(y, m, day + 3, 8) / 1000;   /* 월요일 08:00 KST (표시 시간대 기준) */
    if (b < TT[0] || a > TT[TT.length - 1] + 40 * dt) continue;
    out.push({ a: fi(a), b: fi(b) });
  }
  return out;
}

/* ───────── Nubia VWAP 지지·저항 (TradingView 'Nubia - HighSpeed Optimized' 이식) ─────────
   봉마다: 최근 len봉 안의 최고가(최저가) 봉 이후 구간만 거래량 가중평균(VWAP). 고점 VWAP(빨강선)·저점 VWAP(초록선) + 중심(hlc3) VWAP 까지 음영.
   #1 26 · #2 130 · #3 520 · #4 1040 봉. 바깥 레벨은 안쪽 레벨보다 더 바깥일 때만 보임(원본 규칙 그대로). */
const NUBIA_LENS = [26, 130, 520, 1040];
function nubiaVwap(cs, lens) {
  const n = cs.length, PV = new Float64Array(n + 1), PH = new Float64Array(n + 1), PL = new Float64Array(n + 1), PM = new Float64Array(n + 1);
  cs.forEach((c, i) => {
    const m = (c.high + c.low + c.close) / 3, v = m > 0 ? c.volume / m : 0;   /* 데이터의 volume 은 거래대금이라 가격으로 나눠 수량으로 되돌림 */
    PV[i + 1] = PV[i] + v; PH[i + 1] = PH[i] + v * c.high; PL[i + 1] = PL[i] + v * c.low; PM[i + 1] = PM[i] + v * m;
  });
  const levels = lens.map(() => ({ hi: new Array(n).fill(null), lo: new Array(n).fill(null) }));
  lens.forEach((L, li) => {
    const out = levels[li];
    for (let i = 0; i < n; i++) {
      let hI = i, lI = i;
      for (let j = i; j > i - L && j >= 0; j--) { if (cs[j].high > cs[hI].high) hI = j; if (cs[j].low < cs[lI].low) lI = j; }
      const at = (k, P) => { const v = PV[i + 1] - PV[i + 1 - k]; return v > 0 ? (P[i + 1] - P[i + 1 - k]) / v : null; };
      const kh = i - hI, kl = i - lI;
      if (kh > 0) { const val = at(kh, PH), mid = at(kh, PM); if (val != null && mid != null) out.hi[i] = { val, mid }; }
      if (kl > 0) { const val = at(kl, PL), mid = at(kl, PM); if (val != null && mid != null) out.lo[i] = { val, mid }; }
    }
  });
  /* 보임 규칙: 해당 레벨 선이 이번 봉 범위에 닿을 것 + 안쪽 레벨보다 바깥일 것 */
  const raw = levels.map((o) => ({ hi: o.hi.slice(), lo: o.lo.slice() }));   /* 원본처럼 안쪽 레벨은 '걸러지기 전 값'으로 비교 */
  levels.forEach((o, li) => {
    const prev = li ? raw[li - 1] : null;
    o.hi = raw[li].hi.map((p, i) => (p && p.val > cs[i].low && (!prev || !prev.hi[i] || prev.hi[i].val < p.val)) ? p : null);
    o.lo = raw[li].lo.map((p, i) => (p && p.val < cs[i].high && (!prev || !prev.lo[i] || prev.lo[i].val > p.val)) ? p : null);
  });
  return levels;
}
class NubiaLayer {
  constructor() { this.lv = []; this.chart = null; this.series = null; this.req = null; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  set(cs) { this.lv = nubiaVwap(cs, NUBIA_LENS); this.req && this.req(); }
  paneViews() { const self = this; return [{ zOrder: () => "bottom", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s)) }) }]; }
  draw({ context: c, mediaSize }) {
    if (!this.chart || !this.series || !this.lv.length) return;
    const ts = this.chart.timeScale(), Y = (p) => this.series.priceToCoordinate(p), W = mediaSize.width;
    const sty = { hi: { line: "rgba(255,92,96,", fill: "rgba(16,112,134,", mid: "rgba(140,205,225," }, lo: { line: "rgba(76,214,84,", fill: "rgba(58,170,70,", mid: "rgba(150,230,150," } };
    const fillA = [0.5, 0.44, 0.4, 0.36], lineW = [1.2, 1.8, 2.4, 3];
    c.save(); c.lineJoin = "round";
    for (let li = this.lv.length - 1; li >= 0; li--) {
      ["hi", "lo"].forEach((side) => {
        const arr = this.lv[li][side], st = sty[side];
        let seg = [];
        const flush = () => {
          if (seg.length >= 2) {
            c.beginPath(); seg.forEach((q, k) => (k ? c.lineTo(q.x, q.yv) : c.moveTo(q.x, q.yv)));
            for (let k = seg.length - 1; k >= 0; k--) c.lineTo(seg[k].x, seg[k].ym);
            c.closePath(); c.fillStyle = st.fill + fillA[li] + ")"; c.fill();
            c.beginPath(); seg.forEach((q, k) => (k ? c.lineTo(q.x, q.ym) : c.moveTo(q.x, q.ym))); c.strokeStyle = st.mid + "0.45)"; c.lineWidth = 1; c.stroke();
            c.beginPath(); seg.forEach((q, k) => (k ? c.lineTo(q.x, q.yv) : c.moveTo(q.x, q.yv))); c.strokeStyle = st.line + "0.95)"; c.lineWidth = lineW[li]; c.stroke();
          }
          seg = [];
        };
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i]; if (!p) { flush(); continue; }
          const x = ts.logicalToCoordinate(i), yv = Y(p.val), ym = Y(p.mid);
          if (x == null || yv == null || ym == null || x < -40 || x > W + 40) { if (x != null && x > W + 40) break; flush(); continue; }
          seg.push({ x, yv, ym });
        }
        flush();
      });
    }
    c.restore();
  }
}

/* ───────── 차트 패턴 표시 (선·수직선·수평선 + 이름표). 이름표는 캔들을 절대 가리지 않는 빈 자리에만 놓음 ───────── */
const PCOL = { up: "#ff5d6e", dn: "#4fb4ff", neu: "#b79cff" };
class PatternLayer {
  constructor() { this.res = null; this.from = 0; this.cs = null; this.ext = 30; this.chart = null; this.series = null; this.req = null; this.obs = null; }
  attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() {}
  updateAllViews() {}
  set(res, from, cs, ext) { this.res = res; this.from = from; this.cs = cs; this.ext = ext; this.req && this.req(); }
  paneViews() { const self = this; return [{ zOrder: () => "top", renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s)) }) }]; }
  draw({ context: c, mediaSize }) {
    if (!this.chart || !this.series || !this.res || !this.cs) return;
    const ts = this.chart.timeScale(), W = mediaSize.width, Hh = mediaSize.height, cs = this.cs, n = cs.length, xExt = n - 1 + this.ext;
    const X = (i) => lc(ts, i), Y = (p) => this.series.priceToCoordinate(p);
    const PT = root_.Patterns, FONT = '"Pretendard","Malgun Gothic","Nanum Gothic",sans-serif';
    const pats = this.res.pats.filter((p) => p.end >= this.from - 5);
    const live = (p) => p.state === "forming" || p.state === "confirmed";
    const dirOf = (p) => (p.dirFinal != null ? p.dirFinal : p.dir);
    const colOf = (p) => (dirOf(p) > 0 ? PCOL.up : dirOf(p) < 0 ? PCOL.dn : PCOL.neu);
    const rgba = (h, al) => { const n2 = parseInt(h.slice(1), 16); return "rgba(" + (n2 >> 16 & 255) + "," + (n2 >> 8 & 255) + "," + (n2 & 255) + "," + al + ")"; };
    const lineAt = (a, b, x) => (b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
    /* ── 가리면 안 되는 것(캔들 · 켈트너/VWAP 선)을 5px 격자 점유표에 기록 → 라벨은 빈 칸에만 놓음 ──
       occC = 캔들만, occL = 캔들 + 지표선. 합계표(적분이미지)로 사각형 검사는 O(1) */
    let sp = 6;
    { const x1 = X(n - 1), x0 = X(Math.max(0, n - 2)); if (x1 != null && x0 != null) sp = Math.max(1, Math.abs(x1 - x0)); }
    const pad = Math.max(3, sp * 0.5 + 2.5), CELL = 5, gw = Math.ceil(W / CELL) + 2, gh = Math.ceil(Hh / CELL) + 2, occC = new Uint8Array(gw * gh), occL = new Uint8Array(gw * gh);
    const mark = (occ, x0, y0, x1, y1) => { const a = Math.max(0, Math.floor(x0 / CELL)), b = Math.min(gw - 1, Math.floor(x1 / CELL)), c0 = Math.max(0, Math.floor(y0 / CELL)), d = Math.min(gh - 1, Math.floor(y1 / CELL)); for (let yy = c0; yy <= d; yy++) for (let xx = a; xx <= b; xx++) occ[yy * gw + xx] = 1; };
    for (let i = Math.max(0, this.from - 3); i < n; i++) { const x = X(i); if (x == null || x < -20 || x > W + 20) continue; const yh = Y(cs[i].high), yl = Y(cs[i].low); if (yh == null || yl == null) continue; mark(occC, x - pad, Math.min(yh, yl) - pad, x + pad, Math.max(yh, yl) + pad); }
    occL.set(occC);
    { const yl = Y(cs[n - 1].close); if (yl != null) mark(occL, 0, yl - 3, W, yl + 3); }   /* 현재가 점선도 가리지 않음 */
    (this.obs ? this.obs() : []).forEach((ln) => {   /* 켈트너·VWAP 선: 계단선은 가로 후 세로, 일반선은 직선으로 따라가며 표시 */
      let px = null, py = null;
      for (const q of ln.pts) {
        const x = X(q[0]), y0 = Y(q[1]); if (x == null || y0 == null) { px = null; continue; }
        if (x > W + 30) break;
        const y = Math.max(-20, Math.min(Hh + 20, y0));
        if (px != null && x >= -30) {
          if (ln.step) { for (let xx = Math.max(px, -5); xx <= x; xx += 4) mark(occL, xx - 2, py - 2.5, xx + 2, py + 2.5); for (let yy = Math.min(py, y); yy <= Math.max(py, y); yy += 4) mark(occL, x - 2.5, yy - 2, x + 2.5, yy + 2); }
          else { const stp = Math.max(1, Math.ceil(Math.max(Math.abs(x - px), Math.abs(y - py)) / 4)); for (let k = 0; k <= stp; k++) { const xx = px + (x - px) * k / stp, yy = py + (y - py) * k / stp; mark(occL, xx - 2.5, yy - 2.5, xx + 2.5, yy + 2.5); } }
        }
        px = x; py = y;
      }
    });
    const sw = gw + 1, mkSat = (occ) => { const sat = new Int32Array(sw * (gh + 1)); for (let yy = 0; yy < gh; yy++) { let row = 0; for (let xx = 0; xx < gw; xx++) { row += occ[yy * gw + xx]; sat[(yy + 1) * sw + xx + 1] = sat[yy * sw + xx + 1] + row; } } return sat; };
    const satC = mkSat(occC), satL = mkSat(occL);
    /* strict=true: 캔들+지표선 모두 피함 · false: 캔들만 피함 */
    const blockedRect = (x, y, w, h, strict) => { const sat = strict ? satL : satC, a = Math.max(0, Math.floor((x - 1) / CELL)), b = Math.min(gw - 1, Math.floor((x + w + 1) / CELL)), c0 = Math.max(0, Math.floor((y - 1) / CELL)), d = Math.min(gh - 1, Math.floor((y + h + 1) / CELL)); return sat[(d + 1) * sw + b + 1] - sat[c0 * sw + b + 1] - sat[(d + 1) * sw + a] + sat[c0 * sw + a] > 0; };
    c.save(); c.lineJoin = "round"; c.lineCap = "round";
    const tags = [], labelRects = [{ x: 0, y: 0, w: 520, h: 36 }];   /* 왼쪽 위 범례 글자 자리는 비워 둠 */
    const rectHit = (r, list) => list.some((q) => r.x < q.x + q.w + 3 && r.x + r.w + 3 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y);
    /* 돌파선·손절선·이탈선 이름표: 선 끝(ax, ay) 근처에서 캔들·지표선을 피한 빈 자리를 찾음. 오른쪽 여백(최신 봉 뒤)을 가장 먼저 씀.
       up=true 면 선 위쪽, false 면 아래쪽을 선호. 1차 캔들+지표선 회피 → 2차 캔들만 회피 → 마지막엔 선 끝에 그대로 */
    const pill = (txt, ax, ay, col, up) => {
      c.font = "800 11px " + FONT; const w = Math.ceil(c.measureText(txt).width + 12), h = 17;
      const bx0 = Math.min(W - w - 3, ax + 6), by0 = ay - h / 2, cand = [];
      for (let dx = -360; dx <= 0; dx += 5) for (let dy = -64; dy <= 64; dy += 3) {
        const x = bx0 + dx, y = by0 + dy; if (x < 2 || x + w > W - 2 || y < 2 || y + h > Hh - 2) continue;
        cand.push({ x, y, cost: Math.abs(dx) + Math.abs(dy) * 1.6 + ((up ? dy > 0 : dy < 0) ? 14 : 0) });
      }
      cand.sort((p, q) => p.cost - q.cost);
      let pos = null;
      for (const strict of [true, false]) { for (const q of cand) { const r = { x: q.x, y: q.y, w, h }; if (!blockedRect(r.x, r.y, w, h, strict) && !rectHit(r, labelRects)) { pos = r; break; } } if (pos) break; }
      if (!pos) pos = { x: Math.max(2, Math.min(W - w - 2, bx0)), y: Math.max(2, Math.min(Hh - h - 2, by0 + (up ? -h - 3 : h + 3))), w, h };
      const { x, y } = pos;
      c.fillStyle = "rgba(8,13,24,.9)"; c.strokeStyle = rgba(col, 0.7); c.lineWidth = 1; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, 6) : c.rect(x, y, w, h); c.fill(); c.stroke(); c.fillStyle = col; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(txt, x + 6, y + h / 2 + 0.5); labelRects.push(pos);
    };
    const P = (i, v) => { const x = X(i), y = Y(v); return x == null || y == null ? null : [x, y]; };
    const seg = (a, b, col, w, dash) => { if (!a || !b) return; c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); };

    pats.forEach((p) => {
      const lv = live(p), col = colOf(p), a = lv ? 1 : 0.45, dE = dirOf(p), role = PT && PT.META[p.type];
      const xe = p.confirmI > 0 ? p.confirmI : p.end;
      /* 삼각형·깃발·박스·쐐기·채널: 면 + 두 추세선 (진행 중이면 오른쪽으로 연장) */
      if (p.lines) {
        const L0 = p.lines[0], L1 = p.lines[1];
        let xr = lv ? xExt : xe, apex = null;
        const s0 = (L0[1][1] - L0[0][1]) / Math.max(1, L0[1][0] - L0[0][0]), s1 = (L1[1][1] - L1[0][1]) / Math.max(1, L1[1][0] - L1[0][0]);
        if (lv && Math.abs(s0 - s1) > 1e-9) { const xa = (L1[0][1] - L0[0][1] + s0 * L0[0][0] - s1 * L1[0][0]) / (s0 - s1); if (xa > p.end && xa < xExt) { apex = xa; xr = xa; } }
        const pa = P(L0[0][0], L0[0][1]), pb = P(xr, lineAt(L0[0], L0[1], xr)), pc2 = P(xr, lineAt(L1[0], L1[1], xr)), pd = P(L1[0][0], L1[0][1]);
        if (pa && pb && pc2 && pd) { c.fillStyle = rgba(col, lv ? 0.07 : 0.032); c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.lineTo(pc2[0], pc2[1]); c.lineTo(pd[0], pd[1]); c.closePath(); c.fill(); }
        /* 실선(패턴 구간) + 점선(연장) */
        const e0 = P(p.end, lineAt(L0[0], L0[1], p.end)), e1 = P(p.end, lineAt(L1[0], L1[1], p.end));
        seg(pa, e0, rgba(col, 0.9 * a), lv ? 1.9 : 1.4); seg(pd, e1, rgba(col, 0.9 * a), lv ? 1.9 : 1.4);
        if (lv) {
          seg(e0, pb, rgba(col, 0.95), 1.9, [7, 5]); seg(e1, pc2, rgba(col, 0.95), 1.9, [7, 5]);
          if (apex != null) { const t0 = P(apex, lineAt(L0[0], L0[1], apex)); if (t0) { c.strokeStyle = rgba(col, 0.3); c.lineWidth = 1.1; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(t0[0], 6); c.lineTo(t0[0], Hh - 6); c.stroke(); c.setLineDash([]); } }
          /* 돌파선/손절선(또는 이탈선) 이름 */
          const up = dE >= 0 ? "돌파선" : "손절선", lo = dE > 0 ? "손절선" : "이탈선";
          if (pb) pill(dE === 0 ? "상단 돌파" : up, pb[0], pb[1], col, true);
          if (pc2) pill(dE === 0 ? "하단 이탈" : lo, pc2[0], pc2[1], col, false);
        }
      }
      /* 컵 곡선 */
      if (p.type === "cupHandle" && p.cup) {
        const r1 = P(p.pts[0][0], p.pts[0][1]), bt2 = P(p.pts[1][0], p.pts[1][1]), r2 = P(p.pts[2][0], p.pts[2][1]), hl = P(p.pts[3][0], p.pts[3][1]);
        if (r1 && bt2 && r2 && hl) { c.strokeStyle = rgba(col, 0.9 * a); c.lineWidth = lv ? 2.4 : 1.6; c.beginPath(); c.moveTo(r1[0], r1[1]); c.quadraticCurveTo((r1[0] + r2[0]) / 2, 2 * bt2[1] - (r1[1] + r2[1]) / 2, r2[0], r2[1]); c.lineTo(hl[0], hl[1]); c.stroke(); }
      } else if (p.pts && p.pts.length > 1 && !(p.lines && !p.pole)) {
        c.strokeStyle = rgba(col, 0.9 * a); c.lineWidth = lv ? (p.pole ? 2.8 : 2.3) : 1.5; c.beginPath(); let st = false;
        p.pts.forEach((q) => { const z = P(q[0], q[1]); if (!z) return; if (!st) { c.moveTo(z[0], z[1]); st = true; } else c.lineTo(z[0], z[1]); }); c.stroke();
      }
      if (lv) (p.pts || []).forEach((q) => { if (p.lines && !p.pole) return; const z = P(q[0], q[1]); if (!z) return; c.fillStyle = "#0a0f19"; c.beginPath(); c.arc(z[0], z[1], 4, 0, 6.3); c.fill(); c.strokeStyle = rgba(col, 1); c.lineWidth = 1.8; c.stroke(); });
      /* 넥라인(수평) + 수직 연결선 + 손절선: 진행 중이면 오른쪽 끝까지 */
      if (p.neck) {
        const n0 = P(p.neck[0][0], p.neck[0][1]), xn = lv ? xExt : xe, n1 = P(xn, lineAt(p.neck[0], p.neck[1], xn)), nEnd = P(Math.min(xn, xe), lineAt(p.neck[0], p.neck[1], Math.min(xn, xe)));
        seg(n0, nEnd, rgba(col, 0.85 * a), 1.5, [6, 5]);
        if (lv && n1) {
          seg(nEnd, n1, rgba(col, 0.95), 1.7, [3, 4]);
          pill(dE >= 0 ? "돌파선" : "이탈선", n1[0], n1[1], col, dE >= 0);
          /* 수직선: 각 꼭짓점 ↔ 넥라인 */
          (p.pts || []).forEach((q, k) => { const isKey = (p.type === "doubleBottom" || p.type === "doubleTop") ? k !== 1 : (p.type === "headShoulders" || p.type === "invHeadShoulders") ? k % 2 === 0 : false; if (!isKey) return; const z = P(q[0], q[1]), nl = P(q[0], lineAt(p.neck[0], p.neck[1], q[0])); if (z && nl) seg(z, nl, rgba(col, 0.45), 1.2, [2, 4]); });
          if (p.stop != null) { const s0p = P(p.pts[0][0], p.stop), s1p = P(xExt, p.stop); if (s0p && s1p) { seg(s0p, s1p, "rgba(160,174,200,.6)", 1.3, [5, 5]); pill("손절선", s1p[0], s1p[1], "#a9b6d0", dE < 0); } }
        }
      }
      /* 돌파 지점 표시(작게) */
      if (p.confirmI > 0) { const z = P(p.confirmI, p.entry); if (z) { c.fillStyle = col; c.beginPath(); c.arc(z[0], z[1], 4.5, 0, 6.3); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 1.3; c.stroke(); } }
      /* 이름표 후보 */
      const ys = (p.pts || []).concat(p.lines ? p.lines.flat() : []).map((q) => Y(q[1])).filter((y) => y != null), xs = (p.pts || []).map((q) => X(q[0])).filter((x) => x != null);
      if (!ys.length || !xs.length) return;
      const dmap = (PT && PT.DESC[p.type]) || {}, desc = (live(p) && p.state === "confirmed" ? dmap.confirmed : dmap.forming) || "";
      tags.push({ p, col, name: p.name, stTxt: p.state === "forming" ? "형성 중" : p.state === "confirmed" ? (p.dirReal > 0 ? "돌파 확정" : "이탈 확정") : null, desc, cx: (Math.min(...xs) + Math.max(...xs)) / 2, top: Math.min(...ys), bot: Math.max(...ys), below: dE > 0, lv, end: p.end, info: role && role.info });
    });

    /* ── 이름표 배치: 캔들·지표선(켈트너/VWAP)·다른 이름표·가격선 라벨과 겹치지 않는 가장 가까운 빈 자리 ──
       우선순위: ① 캔들+지표선 모두 피하는 자리(설명 포함 → 이름+상태 → 이름만) ② 그래도 없으면 캔들만 피하는 자리. 진행 중(live) 패턴만 설명 카드, 지난 패턴은 작은 이름표(최근 8개) */
    tags.sort((a, b) => (b.lv - a.lv) || (b.end - a.end));
    const placed = labelRects.slice();
    const hit = (r) => placed.some((q) => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
    let pastSeen = 0;
    const measure = (L, compact) => {
      c.font = L[0].f; const wName = c.measureText(L[0].txt).width; let wFirst = wName; if (L[1] && L[1].inline) { c.font = L[1].f; wFirst += 10 + c.measureText(L[1].txt).width; }
      let w = wFirst; const rest = L.filter((l, k) => k > 0 && !l.inline); rest.forEach((l) => { c.font = l.f; w = Math.max(w, c.measureText(l.txt).width); });
      return { w: w + (compact ? 20 : 24), h: (compact ? 22 : 27) + rest.length * 17, wName, rest };
    };
    tags.forEach((t) => {
      if (!t.lv && pastSeen++ >= 8) return;
      const full = [{ txt: t.name, f: "800 14px " + FONT, col: "#ffffff" }];
      if (t.stTxt) full.push({ txt: t.stTxt, f: "800 11.5px " + FONT, col: t.col, inline: true });
      const variants = [];
      if (t.lv && t.desc) variants.push({ L: full.concat([{ txt: t.desc, f: "500 11.5px " + FONT, col: "#aebdd8" }]), compact: false });
      if (t.lv) variants.push({ L: full, compact: false });
      variants.push({ L: [{ txt: t.name, f: "700 12px " + FONT, col: "#c9d5ec" }], compact: true });
      variants.forEach((v) => { v.m = measure(v.L, v.compact); });
      const cache = {};
      const spot = (m, strict) => {
        const key = Math.round(m.w) + "|" + m.h; let cand = cache[key];
        if (!cand) {   /* 패턴 가까운 순 후보 */
          const want = t.below ? t.bot + 14 : t.top - 14 - m.h; cand = [];
          for (let dy = -Hh; dy <= Hh; dy += 8) for (let dx = -W * 0.6; dx <= W * 0.6; dx += 14) {
            const x = t.cx - m.w / 2 + dx, y = want + dy; if (x < 4 || x + m.w > W - 4 || y < 4 || y + m.h > Hh - 4) continue;
            const inside = y < t.bot + 4 && y + m.h > t.top - 4; cand.push({ x, y, cost: Math.abs(dx) * 0.8 + Math.abs(dy) + (inside ? 160 : 0) });
          }
          cand.sort((a, b) => a.cost - b.cost); cache[key] = cand;
        }
        for (const q of cand) { const r = { x: q.x, y: q.y, w: m.w, h: m.h }; if (!blockedRect(r.x, r.y, r.w, r.h, strict) && !hit(r)) return r; }
        return null;
      };
      let pos = null, pick = null;
      for (const strict of [true, false]) { for (const v of variants) { const r = spot(v.m, strict); if (r) { pos = r; pick = v; break; } } if (pos) break; }
      if (!pos) return;
      const { L, compact, m } = pick, { w, h, wName, rest } = m;
      placed.push(pos);
      const { x, y } = pos, r = 9;
      c.fillStyle = "rgba(8,13,24,.9)"; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.fill();
      c.strokeStyle = rgba(t.col, t.lv ? 0.65 : 0.4); c.lineWidth = 1; c.stroke();
      c.fillStyle = t.col; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x, y, x, y + h, r); c.arcTo(x, y + h, x + r, y + h, r); c.lineTo(x + 4, y + h); c.lineTo(x + 4, y); c.closePath(); c.fill();
      let yy = y + 7; c.textAlign = "left"; c.textBaseline = "top";
      c.font = L[0].f; c.fillStyle = L[0].col; c.fillText(L[0].txt, x + (compact ? 11 : 13), yy - (compact ? 1 : 0));
      if (L[1] && L[1].inline) { c.font = L[1].f; c.fillStyle = L[1].col; c.fillText(L[1].txt, x + 13 + wName + 10, yy + 2); }
      yy += 20; rest.forEach((l) => { c.font = l.f; c.fillStyle = l.col; c.fillText(l.txt, x + 13, yy); yy += 17; });
      /* 연결선: 이름표 가장자리 → 패턴 한가운데 (연한 점선 + 끝에 작은 고리) */
      { const mx = t.cx, my = (t.top + t.bot) / 2, ex = Math.max(x + 10, Math.min(x + w - 10, mx)), ey = (my > y + h) ? y + h : (my < y ? y : (y + h / 2));
        if (Math.hypot(mx - ex, my - ey) > 16) { c.strokeStyle = rgba(t.col, 0.32); c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(ex, ey); c.lineTo(mx, my); c.stroke(); c.setLineDash([]); c.strokeStyle = rgba(t.col, 0.55); c.beginPath(); c.arc(mx, my, 3, 0, 6.3); c.stroke(); } }
    });
    c.restore();
  }
}

/* ICT 결과 → 도형 목록 */
function ictItems(a, o, col, th) {
  const items = [], rgba = (h, al) => { const n = parseInt(h.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + al + ")"; };
  col = col || {};
  if (o.pd && a.pd) {
    items.push({ kind: "line", t1: a.pd.t1, t2: undefined, p: a.pd.eq, color: "rgba(200,210,230,.55)", dash: [3, 5], w: 1, label: "EQ 50%" });
  }
  if (o.fvg) a.fvg.forEach((g) => items.push({ kind: "box", t1: g.t1, t2: undefined, p1: g.hi, p2: g.lo, fill: g.dir > 0 ? "rgba(176,140,255,.11)" : "rgba(96,176,255,.11)", edge: g.dir > 0 ? "rgba(176,140,255,.35)" : "rgba(96,176,255,.35)", label: "FVG", text: g.dir > 0 ? "#cdb8ff" : "#a9d3ff" }));
  if (o.ob) a.ob.forEach((b) => items.push({ kind: "box", t1: b.t1, t2: undefined, p1: b.hi, p2: b.lo, fill: b.dir > 0 ? "rgba(176,140,255,.14)" : "rgba(96,176,255,.14)", stroke: b.dir > 0 ? "rgba(190,160,255,.75)" : "rgba(120,190,255,.75)", sdash: [4, 3], label: b.dir > 0 ? "OB ↑" : "OB ↓", text: "#e8e0ff" }));
  if (o.struct) a.struct.forEach((s) => items.push({ kind: "line", t1: s.t1, t2: s.t2, p: s.price, color: s.kind === "CHoCH" ? "#ffb020" : "#9fb4d8", dash: [5, 4], w: s.kind === "CHoCH" ? 2 : 1.4, label: s.kind + (s.dir > 0 ? "↑" : "↓"), below: s.dir < 0 }));
  if (o.liq) {
    a.liq.forEach((l) => items.push({ kind: "line", t1: l.t1, t2: undefined, p: l.price, color: "#e8e8ff", dash: [2, 4], w: 1.2, label: l.type === "H" ? "EQH" : "EQL", below: l.type === "L" }));
    a.sweeps.forEach((s) => false && items.push({ kind: "tag", t1: s.t, p: s.price, color: "#ffe36a", label: s.type === "BSL" ? "BSL 스윕▼" : "SSL 스윕▲", below: s.type === "SSL" }));
  }
  /* 지지(그린)·저항(주황) 존: 두께감 + 왼쪽에서 번지는 그라데이션 + 중심선. 전환(R→S, S→R)은 점선 테두리로 구분 */
  if (o.sr !== false) a.sr.forEach((l) => {
    const sup = l.role === "S", base = sup ? (col.sup || "#2ee6a6") : (col.res || "#ff9f43"), flip = !!l.flip;
    items.push({ kind: "box", t1: l.t1, t2: undefined, p1: l.price + th, p2: l.price - th, fill: rgba(base, flip ? 0.26 : 0.17), fade: rgba(base, 0), edge: rgba(base, flip ? 0.7 : 0.38), mid: rgba(base, flip ? 0.95 : 0.7), midW: flip ? 1.8 : 1.3, sdash: flip ? [6, 4] : null, label: flip ? (l.flip === "R→S" ? "지지 전환" : "저항 전환") : null, text: rgba(base, 1) });
  });
  return items;
}

/* ───────── 차트 만들기 ─────────
   data: { candles:[{time(UTC초),open,high,low,close,volume}], daily:[같은 형식, 일봉], precision? }
   opt : { iv, subs:["vol","rsi","st533","st2599"], rsiOB, rsiOS, kel:{on,wC,wB}, ict:{sr,struct,fvg,ob,liq,pd}, ... } */
const SUB_TITLE = { vol: "거래량 (거래대금$) · 노랑선=20봉 평균", rsi: "RSI (14) · 노랑 음영 = 과매수(70↑)·과매도(30↓)" };
const SUB_ORDER = ["vol", "rsi"];   /* 스토캐스틱은 제거 — 위아래 공간을 메인 차트에 */
function build(el, data, opt) {
  opt = opt || {}; el.innerHTML = "";
  const subs = SUB_ORDER.filter((s) => (opt.subs || SUB_ORDER).includes(s));
  const chart = LW.createChart(el, {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0a0f19" }, textColor: "#9fb1cf", fontFamily: '"Pretendard","Malgun Gothic","Nanum Gothic",system-ui,sans-serif', fontSize: 14, panes: { separatorColor: "#34507f", separatorHoverColor: "#6f9bff", enableResize: false } },
    grid: { vertLines: { color: "#101a2b" }, horzLines: { color: "#101a2b" } },
    rightPriceScale: { borderColor: "#1c2a44", scaleMargins: { top: 0.04, bottom: 0.04 } },
    timeScale: { borderColor: "#1c2a44", timeVisible: true, rightOffset: 18, barSpacing: opt.barSpacing || 8,
      tickMarkFormatter: (t, type) => { const x = new Date(t * 1000), p = (n) => String(n).padStart(2, "0"), W = ["일", "월", "화", "수", "목", "금", "토"]; return type <= 2 ? (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + "(" + W[x.getUTCDay()] + ")" : p(x.getUTCHours()) + ":" + p(x.getUTCMinutes()); } },
    localization: { timeFormatter: (t) => { const x = new Date(t * 1000), p = (n) => String(n).padStart(2, "0"); return (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + " " + p(x.getUTCHours()) + ":" + p(x.getUTCMinutes()); } },
    crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
  });
  const cs = data.candles, last = cs[cs.length - 1], pf = last.close >= 100 ? 2 : (last.close >= 1 ? 4 : 6);
  const main = chart.addSeries(LW.CandlestickSeries, { upColor: COL.up, downColor: COL.dn, borderUpColor: COL.up, borderDownColor: COL.dn, wickUpColor: COL.up, wickDownColor: COL.dn, priceLineColor: "", priceLineStyle: 2, priceFormat: { type: "price", precision: pf, minMove: Math.pow(10, -pf) } }, 0);
  main.setData(cs.map((c) => ({ time: c.time + KST, open: c.open, high: c.high, low: c.low, close: c.close })));
  const col = Object.assign({ kShade: "#3ddc97", sup: "#2ee6a6", res: "#ff9f43", night: "#5b6cff" }, opt.colors || {});
  const rgba = (h, al) => { const n = parseInt(String(h).slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + al + ")"; };
  /* 레이어: opt.layers {pattern, vwap, ict} 가 있으면 그대로(겹쳐 표시 가능), 없으면 예전 opt.mode(pattern|ict) 방식 */
  const LY = opt.layers || { pattern: opt.mode !== "ict", ict: opt.mode === "ict", vwap: false };
  const patOn = !!LY.pattern && !!(root_.Patterns), patMode = !LY.ict;   /* patMode = ICT 숨김 */
  const quantPrep = root_.Quant ? root_.Quant.prepare(cs0_(data)) : null;
  const ctl = { chart, main, overlay: new Overlay(), band: new BandFill(), priceLines: [], kel: {}, subSeries: {}, opt, data, subs, patMode };
  main.attachPrimitive(ctl.band); main.attachPrimitive(ctl.overlay);
  const TT = cs.map((c) => c.time + KST), nights = weekendBands(TT);
  { const nb = new NightBand(); nb.set(nights, col.night); main.attachPrimitive(nb); ctl.nights = [nb]; }
  const lw = (lvl) => [1, 1.4, 2, 2.8, 3.6][Math.min(5, Math.max(1, lvl || 2)) - 1];

  /* 일봉 켈트너: 일봉 차트면 그대로 선, 분·시간봉이면 그날의 일봉 값을 계단 수평선으로 */
  const K = opt.kel || {}, isDaily = opt.iv === "1d", priceOnly = opt.scale === "price";
  function drawKeltner() {
    ["mid", "up", "lo", "up1", "lo1"].forEach((k) => { if (ctl.kel[k]) { try { chart.removeSeries(ctl.kel[k]); } catch (e) {} ctl.kel[k] = null; } });
    if (K.on === false || !data.daily || data.daily.length < 12) { ctl.dk = null; ctl.obsLines = []; ctl.band.set([], false, "rgba(0,0,0,0)"); return; }
    const dk = dailyKeltner(data.daily); ctl.dk = dk;
    const sk = stepKeltner(cs, data.daily, dk);
    const st = isDaily ? { mid: [], up: [], lo: [], up1: [], lo1: [] } : sk;
    if (isDaily) data.daily.forEach((d, i) => { const v = dk[i]; if (!v) return; st.mid.push({ time: d.time + KST, value: v.mid }); st.up.push({ time: d.time + KST, value: v.up }); st.lo.push({ time: d.time + KST, value: v.lo }); st.up1.push({ time: d.time + KST, value: v.up1 }); st.lo1.push({ time: d.time + KST, value: v.lo1 }); });
    ctl.band.set(sk.rows, !isDaily, rgba(col.kShade, 0.13));
    /* 스케일 모드 '가격만': 켈트너 선이 눈금 범위에 영향을 주지 않음(null) → 캔들 기준으로 눈금이 맞춰지고 선은 범위 밖이면 잘림 */
    const mk = (pts, color, w, lv) => { const s = chart.addSeries(LW.LineSeries, Object.assign({ color, lineWidth: lw(w), lineType: isDaily ? 0 : 1, priceLineVisible: false, lastValueVisible: lv !== false, crosshairMarkerVisible: false, priceFormat: { type: "price", precision: pf, minMove: Math.pow(10, -pf) } }, priceOnly ? { autoscaleInfoProvider: () => null } : {}), 0); s.setData(pts); return s; };
    const w1 = Math.max(1, (K.wB || 3) - 1);   /* 1.0 선은 1.5 선보다 한 단계 얇게 · 중심선은 1.5 설정과 같은 굵기 */
    ctl.kel.mid = mk(st.mid, COL.kMid, K.wC); ctl.kel.up = mk(st.up, COL.kBand, K.wB); ctl.kel.lo = mk(st.lo, COL.kBand, K.wB);
    ctl.kel.up1 = mk(st.up1, COL.kBand1, w1, false); ctl.kel.lo1 = mk(st.lo1, COL.kBand1, w1, false);
    /* 패턴 이름표가 피해야 할 선(캔들 번호 i, 값 v) — 계단선(분·시간봉)은 가로→세로로 따라감 */
    const ixOf = new Map(); cs.forEach((c, i) => ixOf.set(c.time + KST, i));
    ctl.obsLines = ["mid", "up", "lo", "up1", "lo1"].map((k) => ({ step: !isDaily, pts: (st[k] || []).map((p) => { const i = ixOf.get(p.time); return i == null ? null : [i, p.value]; }).filter(Boolean) }));
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
      const r = rsiArr(closes, 14), ob = opt.rsiOB || 70, os = opt.rsiOS || 30;
      const s = chart.addSeries(LW.LineSeries, { color: COL.rsi, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(1), minMove: 0.1 }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, pane);
      s.setData(cs.map((c, i) => (r[i] == null ? { time: T(c) } : { time: T(c), value: r[i] })));
      s.attachPrimitive(new RsiZones(ob, os));
      s.createPriceLine({ price: ob, color: "#ffd84d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
      s.createPriceLine({ price: os, color: "#ffd84d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" });
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
  Object.keys(ctl.subSeries).forEach((k) => { const nb = new NightBand(); nb.set(nights, col.night); ctl.subSeries[k].attachPrimitive(nb); ctl.nights.push(nb); });
  const ps = chart.panes(); ps[0].setStretchFactor(subs.length ? 6.5 : 1); subs.forEach((id, i) => ps[i + 1] && ps[i + 1].setStretchFactor(id === "rsi" ? 1.7 : 1));

  /* ICT: 도형 + 지지·저항(전환 구분) */
  const I = patMode ? {} : (opt.ict || {});
  const winFrom = opt.windowBars ? Math.max(-1, cs.length - opt.windowBars) : -1;
  function drawIct() {
    ctl.priceLines.forEach((l) => { try { main.removePriceLine(l); } catch (e) {} }); ctl.priceLines = [];
    if (patMode) { ctl.ictRes = { sr: [], struct: [], fvg: [], ob: [], liq: [], sweeps: [], pd: null, trend: 0, lastEvent: null }; return ctl.ictRes; }
    const a = ictAnalyze(cs); ctl.ictRes = a;
    let rg = 0; const nr = Math.min(60, cs.length); for (let i = cs.length - nr; i < cs.length; i++) rg += cs[i].high - cs[i].low;
    const th = Math.max(rg / nr * 0.6, cs[cs.length - 1].close * 0.0018);   /* 존 두께의 절반: 최근 봉 평균 변동폭의 60% (최소 0.18%) */
    ctl.overlay.setItems(ictItems(a, I, col, th));
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
  if (LY.vwap) { ctl.vw = new NubiaLayer(); main.attachPrimitive(ctl.vw); ctl.vw.set(cs); }
  if (patOn) { ctl.pat = root_.Patterns.detect(cs); ctl.patLayer = new PatternLayer(); main.attachPrimitive(ctl.patLayer);
    ctl.patLayer.obs = () => {   /* 이름표 회피 대상 지표선: 켈트너 5선 + VWAP 지지·저항선(끊긴 구간은 따로) */
      const o = (ctl.obsLines || []).slice();
      if (ctl.vw) ctl.vw.lv.forEach((lvl) => ["hi", "lo"].forEach((side) => { let cur = []; (lvl[side] || []).forEach((p, i) => { if (p) cur.push([i, p.val]); else if (cur.length) { o.push({ step: false, pts: cur }); cur = []; } }); if (cur.length) o.push({ step: false, pts: cur }); }));
      return o;
    }; ctl.patLayer.set(ctl.pat, winFrom, cs, Math.max(14, Math.round((cs.length - winFrom) * 0.09) - 2)); }

  /* 패널 제목(왼쪽 위) */
  function titles() {
    el.querySelectorAll(".paneTitle").forEach((x) => x.remove());
    const pr = chart.panes(), base = el.getBoundingClientRect(), mk = (txt, top) => { const d = document.createElement("div"); d.className = "paneTitle"; d.textContent = txt; d.style.cssText = "position:absolute;left:10px;top:" + (top + 4) + "px;z-index:6;font:700 13px 'Pretendard','Malgun Gothic','Nanum Gothic',sans-serif;color:#aebfdc;background:rgba(10,15,25,.78);padding:2px 7px;border-radius:5px;pointer-events:none"; el.appendChild(d); };
    subs.forEach((id, i) => { const p = pr[i + 1]; if (!p || !p.getHTMLElement()) return; mk(SUB_TITLE[id], p.getHTMLElement().getBoundingClientRect().top - base.top); });
    const lg = []; if (K.on !== false) lg.push("일봉 켈트너(20/10/1.5) — 중심선 주황 · 상하단 노랑" + (isDaily ? "" : " · 그날의 일봉 값(계단)"));
    const d = document.createElement("div"); d.className = "paneTitle"; d.textContent = lg.join(""); d.style.cssText = "position:absolute;left:10px;top:6px;z-index:6;font:700 13px 'Pretendard','Malgun Gothic','Nanum Gothic',sans-serif;color:#c9d6ee;background:rgba(10,15,25,.78);padding:2px 7px;border-radius:5px;pointer-events:none"; if (lg.length) el.appendChild(d);
  }
  chart.timeScale().setVisibleLogicalRange({ from: winFrom, to: cs.length - 1 + Math.max(18, Math.round((cs.length - winFrom) * 0.09)) });   /* 오른쪽 여백 18봉: 최신 봉·가격 숫자가 겹치지 않게 */
  setTimeout(titles, 60); ctl.titles = titles;
  /* 라이브 갱신용 */
  ctl.refreshAll = () => { drawKeltner(); if (ctl.vw) ctl.vw.set(cs); const r = drawIct(); if (ctl.patLayer) { ctl.pat = root_.Patterns.detect(cs); ctl.patLayer.set(ctl.pat, winFrom, cs, Math.max(14, Math.round((cs.length - winFrom) * 0.09) - 2)); } return r; };
  ctl.quant = quantPrep; ctl.summary = () => summarize(ctl, cs, data.daily);
  return ctl;
}

/* 요약(텔레그램 문구·화면 하단 공통) */
function cs0_(data) { return data.candles; }
function summarize(ctl, cs, daily) {
  const price = cs[cs.length - 1].close, a = ctl.ictRes || ictAnalyze(cs), out = { ict: {}, kel: null };
  if (ctl.dk) {
    const v = ctl.dk[ctl.dk.length - 1];
    if (v) out.kel = { mid: v.mid, up: v.up, lo: v.lo, pos: price > v.up ? "상단 위(돌파)" : price > v.mid ? "중심선~상단" : price > v.lo ? "하단~중심선" : "하단 아래" };
  }
  const ev = a.lastEvent;
  out.ict = { trend: a.trend > 0 ? "상승 구조" : a.trend < 0 ? "하락 구조" : "구조 불명", last: ev ? ev.kind + (ev.dir > 0 ? "↑" : "↓") + " (" + (cs.length - 1 - ev.i) + "봉 전)" : "—", fvg: a.fvg.length, ob: a.ob.length,
    pd: a.pd ? a.pd.zone : "—", flips: a.sr.filter((x) => x.flip).map((x) => x.flip + " " + x.price.toPrecision(5)), eqh: a.liq.filter((x) => x.type === "H").length, eql: a.liq.filter((x) => x.type === "L").length, sweeps: a.sweeps.map((s) => s.type) };
  if (ctl.pat) {
    const live = ctl.pat.pats.filter((p) => p.state === "forming" || p.state === "confirmed").filter((p) => !(root_.Patterns.META[p.type].info)).slice(-4);
    out.patterns = { live: live.map((p) => ({ name: p.name, state: p.state, dirReal: p.dirReal, pct: p.targetPct })), span: ctl.pat.span, stats: Object.values(ctl.pat.stats).map((x) => ({ name: x.name, s: x.s, f: x.f })).filter((x) => x.s + x.f >= 3).sort((a, b) => (b.s + b.f) - (a.s + a.f)).slice(0, 5) };
  }
  const lastRsi = ctl.rsi ? ctl.rsi[ctl.rsi.length - 1] : null; out.rsi = lastRsi == null ? null : Math.round(lastRsi);
  ["st533", "st2599"].forEach((id) => { const s = ctl[id]; if (s) out[id] = { k: Math.round(s.k[s.k.length - 1] || 0), d: Math.round(s.d[s.d.length - 1] || 0) }; });
  if (ctl.patMode) delete out.ict;
  if (ctl.quant) out.quant = ctl.quant.at(cs.length - 1);
  return out;
}

window.ChartLib = { build, dailyKeltner, stepKeltner, rsiArr, stochArr, ictAnalyze, summarize, COL, KST, DAY, SUB_ORDER };
})();
