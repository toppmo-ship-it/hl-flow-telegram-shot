/* 차트 패턴 판독(순수 계산): 고점·저점 → 쌍바닥/쌍고점 · 역헤드앤숄더/헤드앤숄더 · 저점상승/고점하락 구조(HH·HL·LH·LL) · 다이버전스 · 예상 추세선
   패턴 상태: 'done' = 완성(넥라인 종가 돌파/이탈 확인) · 'forming' = 예상(아직 안 끝남, prob = 완성도 0~100)
   핵심 해석(교과서 + 실전):
   · 쌍바닥/쌍고점 — 같은 높이를 두 번 못 넘음/못 깸 = 힘이 소진. 넥라인을 '종가'로 넘어야 완성. 목표 = 넥라인 ± 패턴 높이.
   · 역헤숄/헤숄 — 머리가 가장 깊고 양쪽 어깨가 비슷, 오른쪽 어깨에서 거래가 줄고 넥라인을 넘으면 추세 전환. 넥라인은 기울어져도 됨.
   · 저점 상승(HL)·고점 하락(LH) — 추세의 뼈대. HH+HL = 상승 구조, LH+LL = 하락 구조. 구조가 깨지는 첫 신호가 전환의 시작.
   · 다이버전스 — 가격은 새 저점/고점인데 RSI는 따라가지 못함(일반 = 반전 경고) / 가격은 눌림인데 RSI는 더 눌림(히든 = 추세 지속). */
import { atr, rsi, isn } from "./math.js";

const SENS = { loose: 0.8, mid: 1.2, strict: 1.8 };
const DEPTH = { loose: 2.2, mid: 3, strict: 4 };   /* 패턴 높이가 ATR 몇 배 이상이어야 의미 있다고 볼지(작은 흔들림 걸러냄) */

/* PivotScope 신호(또는 외부 고점·저점) → 번갈아 나오는 고점/저점 목록 */
export function cleanPivots(cs, raw, A, sens) {
  const minSwing = (SENS[sens] || SENS.mid), out = [];
  const sorted = raw.slice().sort((a, b) => a.i - b.i);
  for (const g of sorted) {
    const last = out[out.length - 1];
    if (last && last.t === g.t) { if ((g.t === "H" && g.p > last.p) || (g.t === "L" && g.p < last.p)) out[out.length - 1] = g; continue; }
    if (last && Math.abs(g.p - last.p) < minSwing * (A[g.i] || A[last.i] || 0)) continue;   /* 너무 작은 흔들림은 무시 */
    out.push(g);
  }
  return out;
}
/* 신호가 부족할 때 대비: ATR 지그재그 */
export function zigzag(cs, A, sens) {
  const k = (SENS[sens] || SENS.mid) * 1.6, out = []; let dir = 0, ext = { i: 0, p: cs[0].high, t: "H" }, lo = { i: 0, p: cs[0].low };
  let hi = { i: 0, p: cs[0].high };
  for (let i = 1; i < cs.length; i++) {
    const thr = k * (A[i] || A[i - 1] || 0) || cs[i].close * 0.02;
    if (cs[i].high > hi.p) hi = { i, p: cs[i].high }; if (cs[i].low < lo.p) lo = { i, p: cs[i].low };
    if (dir >= 0 && hi.p - cs[i].low >= thr && i > hi.i) { if (dir === 0 || out.length === 0 || out[out.length - 1].t !== "H") out.push({ i: hi.i, p: hi.p, t: "H" }); dir = -1; lo = { i, p: cs[i].low }; }
    else if (dir <= 0 && cs[i].high - lo.p >= thr && i > lo.i) { if (dir === 0 || out.length === 0 || out[out.length - 1].t !== "L") out.push({ i: lo.i, p: lo.p, t: "L" }); dir = 1; hi = { i, p: cs[i].high }; }
  }
  void ext; return out;
}

/* 표준 ATR 지그재그: 직전 극점에서 k×ATR 이상 되돌려야 방향 전환. 마지막 진행 중 극점은 prov:true 로 덧붙임 */
export function swingPivots(cs, A, k) {
  const n = cs.length, out = []; if (n < 3) return out;
  let dir = 0, hi = { i: 0, p: cs[0].high }, lo = { i: 0, p: cs[0].low }, ext = null;
  const thrAt = (i) => k * ((A[i] > 0 ? A[i] : A[i - 1] > 0 ? A[i - 1] : 0) || cs[i].close * 0.012);
  for (let i = 1; i < n; i++) {
    if (dir === 0) {
      if (cs[i].high > hi.p) hi = { i, p: cs[i].high }; if (cs[i].low < lo.p) lo = { i, p: cs[i].low };
      if (hi.p - lo.p >= thrAt(i)) { if (hi.i > lo.i) { out.push({ i: lo.i, p: lo.p, t: "L" }); dir = 1; ext = { i: hi.i, p: hi.p }; } else { out.push({ i: hi.i, p: hi.p, t: "H" }); dir = -1; ext = { i: lo.i, p: lo.p }; } }
    } else if (dir === 1) {
      if (cs[i].high > ext.p) ext = { i, p: cs[i].high };
      else if (ext.p - cs[i].low >= thrAt(i)) { out.push({ i: ext.i, p: ext.p, t: "H" }); dir = -1; ext = { i, p: cs[i].low }; }
    } else {
      if (cs[i].low < ext.p) ext = { i, p: cs[i].low };
      else if (cs[i].high - ext.p >= thrAt(i)) { out.push({ i: ext.i, p: ext.p, t: "L" }); dir = 1; ext = { i, p: cs[i].high }; }
    }
  }
  if (ext && dir !== 0) out.push({ i: ext.i, p: ext.p, t: dir === 1 ? "H" : "L", prov: true });
  return out;
}

export function detectShapes(cs, signals, opt) {
  const o = Object.assign({ sens: "mid", recent: 150, noDiv: false, histWin: 90 }, opt || {}), n = cs.length, DP = DEPTH[o.sens] || DEPTH.mid;
  const empty = { pats: [], divs: [], struct: [], trend: null, piv: [] };
  if (n < 60) return empty;
  const A = atr(cs, 14), close = cs.map((c) => c.close), R = rsi(close, 14);
  const atrAt = (i) => (isn(A[i]) ? A[i] : isn(A[n - 1]) ? A[n - 1] : cs[i].close * 0.01);
  /* 1) 고점·저점 목록(확정) */
  let raw = (signals || []).filter((g) => !g.dead && g.p >= 0.6 && cs[g.pi]).map((g) => ({ i: g.pi, t: g.side === "top" ? "H" : "L", p: g.side === "top" ? cs[g.pi].high : cs[g.pi].low }));
  let pv = cleanPivots(cs, raw, A, o.sens);
  if (pv.length < 5) pv = cleanPivots(cs, zigzag(cs, A, o.sens), A, o.sens);
  pv = pv.filter((p) => p.i < n - 1 || true);
  if (pv.length < 3) return Object.assign({}, empty, { piv: pv });
  /* 2) 아직 확정 안 된 '진행 중' 극점(예상용) */
  const lastP = pv[pv.length - 1], prov = [];
  if (lastP.i < n - 2) {
    let ex = null;
    for (let j = lastP.i + 1; j < n; j++) {
      const v = lastP.t === "L" ? cs[j].high : cs[j].low;
      if (!ex || (lastP.t === "L" ? v > ex.p : v < ex.p)) ex = { i: j, p: v };
    }
    if (ex && Math.abs(ex.p - lastP.p) >= 1.2 * atrAt(ex.i) && ex.i > lastP.i) prov.push({ i: ex.i, p: ex.p, t: lastP.t === "L" ? "H" : "L", prov: true });
  }
  const all = pv.concat(prov), px = close[n - 1];
  const tol = (i, price) => Math.max(0.55 * atrAt(i), 0.006 * price);
  const pats = [], divs = [], struct = [];
  const firstCloseBeyond = (from, level, up) => { for (let j = from; j < n; j++) if (up ? close[j] > level : close[j] < level) return j; return -1; };
  const lineAt = (p1, p2, i) => (p2.i === p1.i ? p1.p : p1.p + ((p2.p - p1.p) * (i - p1.i)) / (p2.i - p1.i));
  const recentOK = (i) => i >= n - o.recent;

  /* 3) 쌍바닥 · 쌍고점 */
  for (let k = 0; k + 2 < all.length; k++) {
    const a = all[k], b = all[k + 1], c = all[k + 2];
    if (!recentOK(c.i) || a.t !== c.t || b.t === a.t) continue;
    const bull = a.t === "L", span = c.i - a.i; if (span < 6 || span > 160) continue;
    const base = bull ? Math.min(a.p, c.p) : Math.max(a.p, c.p), depth = Math.abs(b.p - base);
    if (Math.abs(c.p - a.p) > tol(c.i, c.p) || depth < DP * atrAt(b.i)) continue;
    const dirUp = bull;   /* 넥라인을 위로(상승 전환) / 아래로(하락 전환) */
    const j = firstCloseBeyond(c.i + 1, b.p, dirUp);
    const failedAt = firstCloseBeyond(c.i + 1, bull ? base - 0.6 * atrAt(c.i) : base + 0.6 * atrAt(c.i), !bull);
    const target = bull ? b.p + depth : b.p - depth;
    if (j >= 0 && (failedAt < 0 || j < failedAt) && j >= n - o.histWin) pats.push({ kind: bull ? "DB" : "DT", label: bull ? "쌍바닥" : "쌍고점", dir: bull ? 1 : -1, state: "done", pts: [a, b, c], neck: { a: { i: b.i, p: b.p }, b: { i: Math.max(j, b.i + 1), p: b.p } }, brk: j, from: a.i, to: j, target, prob: 100 });
    else if (j >= 0 && failedAt > j && failedAt >= n - o.histWin) pats.push({ kind: bull ? "DB" : "DT", label: bull ? "깨진 쌍바닥" : "깨진 쌍고점", dir: bull ? -1 : 1, state: "broken", pts: [a, b, c], neck: { a: { i: b.i, p: b.p }, b: { i: failedAt, p: b.p } }, brk: failedAt, from: a.i, to: failedAt, target: bull ? base - depth : base + depth, prob: 100, note: "넥라인을 넘은 척하다 되돌림 — 반대 방향이 진짜" });
    else if (j < 0 && failedAt < 0 && c.i >= n - 80) {
      const prog = Math.max(0, Math.min(1, bull ? (px - c.p) / (b.p - c.p) : (c.p - px) / (c.p - b.p)));
      const prob = c.prov ? Math.round(30 + prog * 25) : Math.round(50 + prog * 45);
      pats.push({ kind: bull ? "DB" : "DT", label: bull ? "쌍바닥" : "쌍고점", dir: bull ? 1 : -1, state: "forming", pts: [a, b, c], neck: { a: { i: b.i, p: b.p }, b: { i: n - 1, p: b.p } }, from: a.i, to: n - 1, target, prob: Math.min(95, prob), early: !!c.prov });
    }
  }

  /* 4) 역헤드앤숄더 · 헤드앤숄더 (5점) + 오른쪽 어깨 대기(4점 예상) */
  for (let k = 0; k + 3 < all.length; k++) {
    const q = all.slice(k, k + 5), [s1, n1, hd, n2, s2] = q;
    const bull = s1.t === "L"; if (!recentOK((s2 || n2).i)) continue;
    const hdOK = (h) => (bull ? h.p < Math.min(s1.p, s2 ? s2.p : 1e18) - 0.5 * atrAt(h.i) : h.p > Math.max(s1.p, s2 ? s2.p : -1e18) + 0.5 * atrAt(h.i));
    if (!hd || hd.t !== s1.t || n1.t === s1.t || !n2 || n2.t === hd.t) continue;
    const neckAvg = (n1.p + n2.p) / 2, headDepth = Math.abs(neckAvg - hd.p);
    if (headDepth < DP * atrAt(hd.i)) continue;
    if (!bull ? !(hd.p > s1.p) : !(hd.p < s1.p)) continue;
    const neckAt = (i) => lineAt(n1, n2, i), end = s2 || null;
    if (end) {
      if (end.t !== s1.t || !hdOK(hd) || Math.abs(end.p - s1.p) > 0.5 * headDepth) continue;
      const tl = hd.i - s1.i, tr = end.i - hd.i; if (tl < 3 || tr < 3 || tr / tl > 2.8 || tr / tl < 0.35) continue;
      let j = -1; for (let m = end.i + 1; m < n; m++) if (bull ? close[m] > neckAt(m) : close[m] < neckAt(m)) { j = m; break; }
      let fail = -1; for (let m = end.i + 1; m < n; m++) if (bull ? close[m] < hd.p - 0.5 * atrAt(m) : close[m] > hd.p + 0.5 * atrAt(m)) { fail = m; break; }
      const target = bull ? neckAt(j >= 0 ? j : n - 1) + headDepth : neckAt(j >= 0 ? j : n - 1) - headDepth;
      const nk = { a: { i: n1.i, p: n1.p }, b: { i: j >= 0 ? j : n - 1, p: neckAt(j >= 0 ? j : n - 1) } };
      if (j >= 0 && (fail < 0 || j < fail) && j >= n - o.histWin) pats.push({ kind: bull ? "IHS" : "HS", label: bull ? "역헤드앤숄더" : "헤드앤숄더", dir: bull ? 1 : -1, state: "done", pts: q, neck: nk, brk: j, from: s1.i, to: j, target, prob: 100 });
      else if (j < 0 && fail < 0 && end.i >= n - 90) {
        const dist = bull ? (px - end.p) / Math.max(1e-9, neckAt(n - 1) - end.p) : (end.p - px) / Math.max(1e-9, end.p - neckAt(n - 1));
        pats.push({ kind: bull ? "IHS" : "HS", label: bull ? "역헤드앤숄더" : "헤드앤숄더", dir: bull ? 1 : -1, state: "forming", pts: q, neck: nk, from: s1.i, to: n - 1, target, prob: Math.round(Math.min(95, (end.prov ? 45 : 65) + Math.max(0, Math.min(1, dist)) * 30)), early: !!end.prov, note: "오른쪽 어깨 완성 · 넥라인 돌파 대기" });
      }
    }
  }
  /* 오른쪽 어깨 대기: s1,n1,head,n2 까지 있고 다섯 번째가 아직 없음 */
  for (let k = Math.max(0, all.length - 5); k + 3 < all.length; k++) {
    const [s1, n1, hd, n2] = all.slice(k, k + 4), bull = s1.t === "L";
    if (!n2 || hd.t !== s1.t || n1.t === s1.t || n2.t === hd.t || n2 !== all[all.length - 1]) continue;
    if (!recentOK(n2.i)) continue;
    if (bull ? !(hd.p < s1.p - 0.5 * atrAt(hd.i)) : !(hd.p > s1.p + 0.5 * atrAt(hd.i))) continue;
    const neckAvg = (n1.p + n2.p) / 2, headDepth = Math.abs(neckAvg - hd.p); if (headDepth < DP * atrAt(hd.i)) continue;
    const pulled = bull ? n2.p - px : px - n2.p;
    if (pulled < 0.6 * atrAt(n) || (bull ? px <= hd.p : px >= hd.p)) continue;   /* 넥점에서 되돌아 내려오는 중 + 머리는 지키는 중 */
    const exp = { i: n2.i + Math.round((hd.i - s1.i) * 0.9), p: s1.p };
    pats.push({ kind: bull ? "IHS" : "HS", label: bull ? "역헤드앤숄더" : "헤드앤숄더", dir: bull ? 1 : -1, state: "forming", early: true, wait: true, pts: [s1, n1, hd, n2], expect: exp, neck: { a: { i: n1.i, p: n1.p }, b: { i: n - 1, p: lineAt(n1, n2, n - 1) } }, from: s1.i, to: n - 1, target: bull ? n2.p + headDepth : n2.p - headDepth, prob: 35, note: "오른쪽 어깨 자리 기다리는 중" });
  }

  /* 5) 구조 태그: 고점 갱신(HH) · 저점 상승(HL) · 고점 하락(LH) · 저점 갱신(LL) */
  const lastOf = { H: null, L: null };
  all.forEach((p) => {
    const prev = lastOf[p.t]; if (prev) { const up = p.p > prev.p, tl = tol(p.i, p.p) * 0.5;
      if (Math.abs(p.p - prev.p) > tl && recentOK(p.i)) struct.push({ i: p.i, p: p.p, t: p.t, tag: p.t === "H" ? (up ? "HH" : "LH") : up ? "HL" : "LL", prov: !!p.prov }); }
    lastOf[p.t] = p;
  });

  /* 6) 다이버전스(RSI) */
  const lastBy = { H: [], L: [] }; all.forEach((p) => lastBy[p.t].push(p));
  if (!o.noDiv) ["H", "L"].forEach((t) => {
    const L = lastBy[t];
    for (let k = o.allDiv ? 0 : Math.max(0, L.length - 4); k + 1 < L.length; k++) {   /* allDiv: 하단창 PivotScope 용 — 최근 4쌍·150봉 제한 없이 불러온 전체 구간의 다이버전스 */
      const p1 = L[k], p2 = L[k + 1]; if (!(o.allDiv || recentOK(p2.i)) || p2.i - p1.i < 5 || p2.i - p1.i > 90) continue;
      const r1 = R[p1.i], r2 = R[p2.i]; if (!isn(r1) || !isn(r2)) continue;
      const dp = p2.p - p1.p, dr = r2 - r1; let type = null;
      if (t === "L" && dp < 0 && dr > 2) type = ["상승 다이버전스", 1, false];
      else if (t === "L" && dp > 0 && dr < -2) type = ["히든 상승 다이버전스", 1, true];
      else if (t === "H" && dp > 0 && dr < -2) type = ["하락 다이버전스", -1, false];
      else if (t === "H" && dp < 0 && dr > 2) type = ["히든 하락 다이버전스", -1, true];
      if (type) divs.push({ label: type[0], dir: type[1], hidden: type[2], a: p1, b: p2, ra: r1, rb: r2, state: p2.prov ? "forming" : "done" });
    }
  });

  /* 7) 예상 추세선 + 다음 고점·저점 자리 */
  let trend = null;
  const Hs = pv.filter((p) => p.t === "H").slice(-3), Ls = pv.filter((p) => p.t === "L").slice(-3);
  const mk = (arr) => {
    if (arr.length < 2) return null; const a = arr[arr.length - 2], b = arr[arr.length - 1]; if (b.i - a.i < 5) return null;
    const slope = (b.p - a.p) / (b.i - a.i), spans = []; for (let k = 1; k < arr.length; k++) spans.push(arr[k].i - arr[k - 1].i);
    const sp = Math.round(spans.reduce((x, y) => x + y, 0) / spans.length), ni = b.i + sp;
    return { a, b, slope, at: (i) => b.p + slope * (i - b.i), next: { i: ni, p: b.p + slope * sp }, broken: false };
  };
  const res = mk(Hs), sup = mk(Ls);
  if (res) res.broken = px > res.at(n - 1) + 1.0 * atrAt(n - 1) || false;
  if (sup) sup.broken = px < sup.at(n - 1) - 1.0 * atrAt(n - 1) || false;
  if (res || sup) trend = { res, sup, rising: !!(sup && sup.slope > 0), falling: !!(res && res.slope < 0) };

  /* 최신 것부터, 같은 종류·같은 자리 중복 정리 */
  pats.sort((x, y) => y.to - x.to);
  const seen = new Set(), uniq = pats.filter((p) => { const key = p.kind + ":" + p.pts[p.pts.length - 1].i; if (seen.has(key)) return false; seen.add(key); return true; });
  return { pats: uniq, divs, struct, trend, piv: all };
}

/* 하단지표(예고선) 파동 자체에서 패턴 찾기 — 파동을 가격처럼 보고 고점·저점 구조를 판독.
   osc = 봉마다 예고선 값(결측 NaN). 반환은 detectShapes 와 같은 모양(가격 대신 예고선 값 단위) */
export function waveShapes(osc, opt) {
  const n = osc.length, cs = new Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const v = isn(osc[i]) ? osc[i] : 0; cs[i] = { time: i, open: prev, high: v, low: v, close: v, volume: 0 }; prev = v; }
  return detectShapes(cs, [], Object.assign({ noDiv: true }, opt || {}));
}
