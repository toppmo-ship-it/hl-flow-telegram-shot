/* ═══════════════════════════════════════════════════════════════
   퀀트 지표 모듈 (카드 · 순위 텍스트 · 백테스트가 같은 코드를 씀 — Node/브라우저 공용)
   · 6점 지표: 거래량 · RSI(14) · MACD(10/25/8) · 윌리엄스 %R 14 · 윌리엄스 %R 48 · 앵커드 VWAP(구조 시작점)
   · 구조(HH/HL/LH/LL): 확정된 지그재그 꼭짓점으로 판정, 마지막 꼭짓점에서 시작하는 VWAP 와 현재가를 비교
   · 일봉 켈트너(20/10/1.5) 구간: A 상단 위 · B 중심~상단 · C 하단~중심 · D 하단 아래
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
"use strict";
const DAY = 86400;
function ema(a, p, seed) {
  const k = 2 / (p + 1), out = new Array(a.length).fill(null); let e = null;
  for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? (seed != null ? seed : a[i]) : a[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function rsiArr(cs, p) {
  p = p || 14; const n = cs.length, out = new Array(n).fill(null); if (n <= p) return out;
  let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = cs[i].close - cs[i - 1].close; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / p, al = l / p; out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) { const d = cs[i].close - cs[i - 1].close; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  return out;
}
function macdArr(cs, f, s, sg) {
  f = f || 10; s = s || 25; sg = sg || 8; const cl = cs.map((c) => c.close), ef = ema(cl, f), es = ema(cl, s);
  const m = cl.map((_, i) => (i >= s - 1 ? ef[i] - es[i] : null)), sig = ema(m, sg);
  return { m, s: sig, h: m.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i])) };
}
function willrArr(cs, p) {
  const n = cs.length, out = new Array(n).fill(null);
  for (let i = p - 1; i < n; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - p + 1; j <= i; j++) { if (cs[j].high > hh) hh = cs[j].high; if (cs[j].low < ll) ll = cs[j].low; } out[i] = hh === ll ? -50 : (hh - cs[i].close) / (hh - ll) * -100; }
  return out;
}
/* 일봉 켈트너 (사이트와 동일: EMA20 ± Wilder ATR10 × 1.5, 1.0 밴드 포함) */
function dailyKeltner(daily) {
  const n = daily.length, out = new Array(n).fill(null); if (n < 12) return out;
  const k = 2 / 21; let b = daily[0].close; const basis = [b];
  for (let i = 1; i < n; i++) { b = daily[i].close * k + b * (1 - k); basis.push(b); }
  const tr = []; for (let i = 1; i < n; i++) { const h = daily[i].high, l = daily[i].low, pc = daily[i - 1].close; tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
  if (tr.length < 10) return out;
  let atr = tr.slice(0, 10).reduce((s, x) => s + x, 0) / 10; const A = new Array(n).fill(null); A[10] = atr;
  for (let j = 10; j < tr.length; j++) { atr = (atr * 9 + tr[j]) / 10; A[j + 1] = atr; }
  for (let i = 10; i < n; i++) out[i] = { mid: basis[i], up: basis[i] + 1.5 * A[i], lo: basis[i] - 1.5 * A[i], up1: basis[i] + A[i], lo1: basis[i] - A[i] };
  return out;
}
/* 봉 시각 t(UTC초)에 '이미 끝난 전날 일봉'의 켈트너로 구간 판정 (미래 정보 없음) */
function makeZoner(daily) {
  const dk = dailyKeltner(daily), idx = new Map(daily.map((d, i) => [d.time, i]));
  return function zoneAt(t, price) {
    const day = Math.floor(t / DAY) * DAY - DAY, i = idx.get(day); const v = i != null ? dk[i] : null;
    if (!v) return null;
    const z = price > v.up ? "A" : price > v.mid ? "B" : price > v.lo ? "C" : "D";
    return { z, mid: v.mid, up: v.up, lo: v.lo, pos: (price - v.mid) / Math.max(1e-9, v.up - v.mid) };
  };
}

/* 준비: 배열 지표 + 누적합(VWAP) + 구조 꼭짓점 */
function prepare(cs, opts) {
  opts = opts || {}; const n = cs.length, Pt = root.Patterns;
  const rsi = rsiArr(cs, 14), mac = macdArr(cs, 10, 25, 8), w14 = willrArr(cs, 14), w48 = willrArr(cs, 48);
  /* 단위 거래량 = 거래대금 ÷ 대표가 */
  const tp = cs.map((c) => (c.high + c.low + c.close) / 3), vu = cs.map((c, i) => (c.volume || 0) / (tp[i] || 1));
  const P0 = new Array(n + 1).fill(0), P1 = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) { P0[i + 1] = P0[i] + vu[i]; P1[i + 1] = P1[i] + vu[i] * tp[i]; }
  const upV = new Array(n + 1).fill(0), dnV = new Array(n + 1).fill(0), vS = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) { const up = cs[i].close >= cs[i].open; upV[i + 1] = upV[i] + (up ? cs[i].volume : 0); dnV[i + 1] = dnV[i] + (up ? 0 : cs[i].volume); vS[i + 1] = vS[i] + (cs[i].volume || 0); }
  const atr = Pt ? Pt.atrArr(cs, 14) : null, piv = Pt ? Pt.zigzag(cs, atr, opts.k || 3.0, opts.minPct || 0.006).filter((p) => !p.prov) : [];
  let pi = 0, lastH = [], lastL = [], anchor = null;
  const state = new Array(n);
  for (let i = 0; i < n; i++) {
    while (pi < piv.length && piv[pi].c <= i) { const p = piv[pi++]; anchor = p; (p.type === "H" ? lastH : lastL).push(p); if (lastH.length > 3) lastH.shift(); if (lastL.length > 3) lastL.shift(); }
    let lab = null;
    if (lastH.length >= 2 && lastL.length >= 2) {
      const h = lastH[lastH.length - 1].price > lastH[lastH.length - 2].price ? "HH" : "LH", l = lastL[lastL.length - 1].price > lastL[lastL.length - 2].price ? "HL" : "LL";
      lab = h + "/" + l;
    }
    state[i] = { anchor: anchor ? anchor.i : null, anchorType: anchor ? anchor.type : null, lab };
  }
  function at(i) {
    if (i < 60) return null;
    const c = cs[i], st = state[i];
    /* 거래량: 최근 5봉 평균 ≥ 20봉 평균 이고, 최근 10봉 양봉 거래대금 > 음봉 거래대금 */
    const v5 = (vS[i + 1] - vS[i - 4]) / 5, v20 = (vS[i + 1] - vS[i - 19]) / 20, up10 = upV[i + 1] - upV[i - 9], dn10 = dnV[i + 1] - dnV[i - 9];
    const volPt = v5 >= v20 && up10 > dn10;
    const rsiPt = rsi[i] > 50 && rsi[i] >= rsi[i - 3];
    const macPt = mac.h[i] > 0;
    const w14Pt = w14[i] > -50, w48Pt = w48[i] > -50;
    let av = null, vwPt = false;
    if (st.anchor != null && st.anchor <= i) { const a = st.anchor, den = P0[i + 1] - P0[a]; if (den > 0) { av = (P1[i + 1] - P1[a]) / den; vwPt = c.close > av; } }
    const pts = { vol: volPt, rsi: rsiPt, macd: macPt, w14: w14Pt, w48: w48Pt, vwap: vwPt };
    const score = (volPt ? 1 : 0) + (rsiPt ? 1 : 0) + (macPt ? 1 : 0) + (w14Pt ? 1 : 0) + (w48Pt ? 1 : 0) + (vwPt ? 1 : 0);
    return { i, score, pts, rsi: rsi[i], macd: mac.m[i], macdS: mac.s[i], macdH: mac.h[i], w14: w14[i], w48: w48[i], volX: v20 > 0 ? v5 / v20 : null, upDn: dn10 > 0 ? up10 / dn10 : null, avwap: av, avGap: av ? (c.close / av - 1) * 100 : null, anchorI: st.anchor, anchorType: st.anchorType, lab: st.lab };
  }
  return { at, rsi, mac, w14, w48, piv };
}

const api = { prepare, dailyKeltner, makeZoner, rsiArr, macdArr, willrArr, ema };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Quant = api;
})(typeof window !== "undefined" ? window : globalThis);
