/* 하이퍼 리포트 — 지표 계산 + 캔들 저장·증분 받기
   파인스크리너 지표 'TM Matrix Screener v48.9'의 계산을 하이퍼리퀴드 캔들로 그대로 옮김.
   기준 봉 = 일봉(HL 일봉은 UTC 00:00 = 한국 09:00 경계). 오늘 일봉·현재 4시간봉은 15분봉을 모아서 만들어 항상 '지금 값'.
   캔들 저장: .cache/rep_bars.json.gz — 15분봉(≈7일)·4시간봉(≈50일)·일봉(≈150일)을 쌓고, 새 봉이 생길 때만 이어받음(HL 호출 최소) */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { hl, pool } from "./extras.mjs";

const M15 = 900000, M30 = 1800000, H4 = 14400000, D1 = 86400000;
const N15 = 720, N4H = 300, N1D = 150;   /* 저장할 봉 개수 */
const p7 = (x) => +(+x).toPrecision(8);

/* ───────────────── 기본 지표 함수 (파인스크립트 ta.* 와 같은 정의) ───────────────── */
const sma = (a, n) => { const o = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let s = 0, ok = true; for (let j = i - n + 1; j <= i; j++) { if (a[j] == null) { ok = false; break; } s += a[j]; } if (ok) o[i] = s / n; } return o; };
const ema = (a, n) => { const k = 2 / (n + 1), o = new Array(a.length).fill(null); let e = null; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x != null) e = e == null ? x : x * k + e * (1 - k); o[i] = e; } return o; };
const rma = (a, n) => { const o = new Array(a.length).fill(null); let r = null, cnt = 0, s = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; if (x == null) continue; if (r == null) { s += x; cnt++; if (cnt === n) { r = s / n; o[i] = r; } } else { r = (r * (n - 1) + x) / n; o[i] = r; } } return o; };
const trOf = (h, l, c) => h.map((x, i) => (i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
const hiN = (a, n, i) => { if (i < n - 1) return null; let m = -Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.max(m, a[j]); return m; };
const loN = (a, n, i) => { if (i < n - 1) return null; let m = Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.min(m, a[j]); return m; };
const stdevAt = (a, n, i) => { if (i < n - 1) return null; let s = 0, q = 0; for (let j = i - n + 1; j <= i; j++) { s += a[j]; q += a[j] * a[j]; } const m = s / n; return Math.sqrt(Math.max(q / n - m * m, 0)); };
const linregAt = (a, n, i) => { if (i < n - 1) return null; let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { const y = a[i - n + 1 + k]; if (y == null) return null; sx += k; sy += y; sxy += k * y; sxx += k * k; } const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - slope * sx) / n; return ic + slope * (n - 1); };
/* 파인 f_calc_smma: 처음 len 개는 SMA 로 시작해 이후 (이전×(len−1)+값)/len */
const smma = (a, n) => rma(a, n);

/* ───────────────── 파인 보조 로직 ───────────────── */
function wScore(h, l, c, i, s, lg) {   /* f_w_count(14,48): 단기·장기 W%R 각각 +1(≥−20)/−1(≤−80)/0 → 합 −2~+2 */
  const one = (n) => { const hh = hiN(h, n, i), ll = loN(l, n, i); if (hh == null) return 0; const w = hh === ll ? -50 : 100 * (c[i] - hh) / (hh - ll); return w >= -20 ? 1 : w <= -80 ? -1 : 0; };
  return one(s) + one(lg);
}
/* f_dual_logic / f_dual_sunbuy_logic — 마지막 봉에서 1/0 */
function dualAt(bars, sunbuy) {
  const n = bars.length; if (n < 80) return null;
  const h = bars.map((b) => b[1]), l = bars.map((b) => b[2]), c = bars.map((b) => b[3]), v = bars.map((b) => b[4] || 0);
  const src = bars.map((b) => (b[1] + b[2] + b[3]) / 3);
  const e1 = ema(src, 34), e2 = ema(e1, 34), mi = e1.map((x, i) => (x == null || e2[i] == null ? null : x + (x - e2[i])));
  const hi = sunbuy ? ema(h, 34) : smma(h, 34), lo = sunbuy ? ema(l, 34) : smma(l, 34);
  const md = mi.map((m, i) => (m == null || hi[i] == null || lo[i] == null ? null : m > hi[i] ? m - hi[i] : m < lo[i] ? m - lo[i] : 0));
  const sb = sma(md, 9), sh = md.map((m, i) => (m == null || sb[i] == null ? null : (m - sb[i]) * 3));
  const sv = c.map((x, i) => (i === 0 ? 0 : x > c[i - 1] ? v[i] : x < c[i - 1] ? -v[i] : 0));
  const vp = ema(sv, 14), tv = ema(v, 14);
  const vz = ema(vp.map((x, i) => 100 * (x / Math.max(tv[i], 1))), 4);
  const a = sh[n - 1], b = sh[n - 2];
  if (a == null || b == null || vz[n - 1] == null) return 0;
  return a > b && b <= 0 && vz[n - 1] > 0 ? 1 : 0;
}
/* SQZMOM(LazyBear) — 일봉. 반환 [sqzOn, sqzOff, histRed] */
function sqzmom(h, l, c) {
  const n = c.length; if (n < 42) return [false, false, false];
  const tr = trOf(h, l, c), i = n - 1;
  const basis = sma(c, 20), maK = sma(c, 20), rg = sma(tr, 20);
  const dev = 1.5 * stdevAt(c, 20, i), upBB = basis[i] + dev, loBB = basis[i] - dev;
  const upKC = maK[i] + rg[i] * 1.5, loKC = maK[i] - rg[i] * 1.5;
  const sqzOn = loBB > loKC && upBB < upKC, sqzOff = loBB < loKC && upBB > upKC;
  const src = c.map((x, j) => { const hh = hiN(h, 20, j), ll = loN(l, 20, j), m = maK[j]; return hh == null || m == null ? null : x - ((hh + ll) / 2 + m) / 2; });
  const val = linregAt(src, 20, i), prev = linregAt(src, 20, i - 1);
  return [sqzOn, sqzOff, val != null && val > 0 && val > (prev == null ? 0 : prev)];
}

/* ───────────────── 봉 만들기 ───────────────── */
/* 15분봉 → 더 큰 봉(30분·4시간·일)으로 묶기. 행: [t,h,l,c,v] */
function agg(rows, ms) {
  const out = []; let cur = null;
  for (const r of rows) {
    const t = Math.floor(r[0] / ms) * ms;
    if (!cur || cur[0] !== t) { cur = [t, r[1], r[2], r[3], r[4] || 0]; out.push(cur); }
    else { cur[1] = Math.max(cur[1], r[1]); cur[2] = Math.min(cur[2], r[2]); cur[3] = r[3]; cur[4] += r[4] || 0; }
  }
  return out;
}

/* ───────────────── 종목 하나의 모든 컬럼 계산 ───────────────── */
export function calcCoin(e, now) {
  const m15 = e.m || [], dDone = (e.d || []).filter((b) => b[0] + D1 <= now + 1000), h4Done = e.h4 || [];
  if (m15.length < 130 || dDone.length < 5) return null;
  const todayStart = Math.floor(now / D1) * D1, h4Start = Math.floor(now / H4) * H4;
  /* 일봉 = 완결 일봉 + 오늘(15분봉 합) */
  const todayRows = m15.filter((r) => r[0] >= todayStart);
  const D = dDone.filter((b) => b[0] < todayStart).slice(-N1D);
  if (todayRows.length) { const a = agg(todayRows, D1)[0]; D.push(a); }
  if (D.length < 25) return null;
  const dh = D.map((b) => b[1]), dl = D.map((b) => b[2]), dc = D.map((b) => b[3]), dv = D.map((b) => b[4] || 0);
  const n = D.length, i = n - 1, px = dc[i];
  /* 일봉 켈트너 상단 = EMA20 + ATR10 × 1.5, 켈유 = 상단 위 종가 연속 일수 */
  const em = ema(dc, 20), atr = rma(trOf(dh, dl, dc), 10);
  const up = dc.map((_, j) => (em[j] == null || atr[j] == null ? null : em[j] + atr[j] * 1.5));
  const above = dc.map((x, j) => up[j] != null && x > up[j]);
  let hold = 0; for (let j = i; j >= 0 && above[j]; j--) hold++;
  const kcGap = up[i] != null ? (px - up[i]) / Math.max(up[i], 0.001) * 100 : null;
  const pwr = (j) => (dc[j] - dl[j]) / Math.max(dh[j] - dl[j], 0.001) * 100;
  /* 4시간 켈트너(EMA40/ATR10/×2.5) — 완결 4시간봉 + 지금 4시간봉(15분봉 합) */
  const H = h4Done.filter((b) => b[0] + H4 <= now + 1000 && b[0] < h4Start).slice(-N4H);
  const curRows = m15.filter((r) => r[0] >= h4Start); if (curRows.length) H.push(agg(curRows, H4)[0]);
  let h4m = null, h4u = null, h4g = null;
  if (H.length >= 50) {
    const hc = H.map((b) => b[3]), hh = H.map((b) => b[1]), hl_ = H.map((b) => b[2]);
    const basis = ema(hc, 40), rng = rma(trOf(hh, hl_, hc), 10), k = H.length - 1;
    if (basis[k] != null && rng[k] != null) { const upper = basis[k] + rng[k] * 2.5; h4m = hc[k] > basis[k] ? 1 : 0; h4u = hc[k] > upper ? 1 : 0; h4g = (hc[k] - upper) / Math.max(upper, 0.001) * 100; }
  }
  /* 15분 이평(3격=60선·5격=120선) */
  const c15 = m15.map((r) => r[3]), s60 = sma(c15, 60), s120 = sma(c15, 120), L = m15.length - 1;
  const g3 = s60[L] != null ? (px - s60[L]) / s60[L] * 100 : null, g5 = s120[L] != null ? (px - s120[L]) / s120[L] * 100 : null;
  /* 일봉 W%R 듀얼 · RV구간 · 스퀴즈 */
  const w = wScore(dh, dl, dc, i, 14, 48);
  let rvz = 0;
  if (n >= 20) {
    let sPV = 0, sV = 0; for (let j = i - 19; j <= i; j++) { const s = (dh[j] + dl[j] + dc[j]) / 3; sPV += s * dv[j]; sV += dv[j]; }
    const rv = sV > 0 ? sPV / sV : (dh[i] + dl[i] + dc[i]) / 3; let sq = 0;
    for (let j = i - 19; j <= i; j++) { const s = (dh[j] + dl[j] + dc[j]) / 3, d = s - rv; sq += d * d * dv[j]; }
    const sd = sV > 0 ? Math.sqrt(sq / sV) : 0;
    rvz = px < rv ? 0 : px < rv + sd ? 1 : px < rv + sd * 1.5 ? 2 : px < rv + sd * 2 ? 3 : px < rv + sd * 2.5 ? 4 : 5;
  }
  const [sqOn, sqOff, hist] = sqzmom(dh, dl, dc);
  const sqz = sqOff && hist && above[i] ? 3 : sqOff && hist ? 2 : sqOn && hist ? 1 : 0;
  /* 현재T·누적T(최근 6일 합)·종배 */
  const tru = D.map((b, j) => (b[4] || 0) * dc[j] / 1e8), trSma = sma(tru, 5);
  const ma60At = (end) => { let k = -1; for (let j = m15.length - 1; j >= 0; j--) if (m15[j][0] < end) { k = j; break; } return k >= 59 ? s60[k] : null; };
  const sig = (j) => { const volUp = trSma[j] != null && tru[j] > trSma[j] * 1.2, strong = pwr(j) >= 70, m60 = j === i ? s60[L] : ma60At(D[j][0] + D1); return above[j] && volUp && strong && m60 != null && dc[j] > m60 ? 1 : 0; };
  let cumT = 0; for (let j = Math.max(0, i - 5); j <= i; j++) cumT += sig(j);
  const jb = above[i] && trSma[i] != null && tru[i] > trSma[i] * 1.2 && pwr(i) >= 70 ? 1 : 0;
  /* 듀얼선15 · 듀얼15 · 듀얼30 (15분봉·30분봉의 마지막 봉) */
  const m30 = agg(m15, M30), d15s = dualAt(m15, true), d15 = dualAt(m15, false), d30 = dualAt(m30, false);
  /* 당일 VWAP 점수(세션 = 한국 09:00 부터, 15분봉으로 계산) */
  let vw = 0;
  if (todayRows.length) {
    let sPV = 0, sV = 0, sSq = 0; for (const r of todayRows) { const s = (r[1] + r[2] + r[3]) / 3; sPV += s * r[4]; sV += r[4]; sSq += s * s * r[4]; }
    if (sV > 0) { const v0 = sPV / sV, sd = Math.sqrt(Math.max(sSq / sV - v0 * v0, 0)); vw = px > v0 + sd ? 2 : px > v0 ? 1 : px < v0 - sd ? -2 : -1; }
  }
  const prev = n >= 2 ? dc[i - 1] : null;
  const volDay = dv[i];
  return {
    px, chg: prev ? (px - prev) / prev * 100 : null, usd: volDay * px, pwr: Math.round(pwr(i)),
    kc: above[i] ? 1 : 0, gap: kcGap == null ? null : Math.round(kcGap * 10) / 10, w, h4m, h4u, h4g: h4g == null ? null : Math.round(h4g * 10) / 10,
    sqz, g3: g3 == null ? null : Math.round(g3 * 10) / 10, g5: g5 == null ? null : Math.round(g5 * 10) / 10, rv: rvz,
    d15s, d15, d30, vwap: vw, cumT, jb, kelu: above[i] ? hold : 0, days: n, asOf: e.tm || 0,
  };
}

/* 최근 N분 동안의 가격 변화(%)와 거래대금(USD) — 15분봉 + 지금 가격으로 보간. 급변동 순위용 */
export function changeOver(e, minutes, now) {
  const m = e.m || []; if (m.length < 4) return null;
  const T = now - minutes * 60000, pts = [];
  for (const r of m) pts.push([r[0] + M15, r[3]]);   /* 봉 끝 시각 → 종가 */
  const last = m[m.length - 1]; pts.push([now, last[3]]);
  const ps = pts.filter((p) => p[0] <= now).sort((a, b) => a[0] - b[0]);
  let a = null; for (let k = 0; k < ps.length - 1; k++) if (ps[k][0] <= T && ps[k + 1][0] >= T) { a = k; break; }
  if (a == null) return null;
  const [t0, p0] = ps[a], [t1, p1] = ps[a + 1], pT = t1 === t0 ? p0 : p0 + (p1 - p0) * (T - t0) / (t1 - t0);
  if (!(pT > 0)) return null;
  let usd = 0;
  for (const r of m) { const s = r[0], eMs = Math.min(r[0] + M15, now), len = Math.max(1, eMs - s), ov = Math.max(0, eMs - Math.max(s, T)); if (ov > 0) usd += (r[4] || 0) * ((r[1] + r[2] + r[3]) / 3) * (ov / len); }
  return { pct: (last[3] / pT - 1) * 100, usd };
}

/* ───────────────── 캔들 저장소 + 증분 받기 ───────────────── */
export function loadBars(cacheDir) {
  const f = path.join(cacheDir, "rep_bars.json.gz");
  try { const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); if (j && j.v === 1) return j; } catch (e) {}
  return { v: 1, c: {} };
}
export function saveBars(cacheDir, S) {
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, "rep_bars.json.gz"), zlib.gzipSync(Buffer.from(JSON.stringify(S)), { level: 6 })); } catch (e) {}
}
const toRows = (got, withV) => (got || []).map((c) => (withV ? [+c.t, p7(c.h), p7(c.l), p7(c.c), p7(c.v)] : [+c.t, p7(c.h), p7(c.l), p7(c.c)])).filter((r) => isFinite(r[0]) && r[3] > 0);
function merge(old, rows, keep) { const m = new Map((old || []).map((r) => [r[0], r])); rows.forEach((r) => m.set(r[0], r)); return [...m.values()].sort((a, b) => a[0] - b[0]).slice(-keep); }

/* 코인 하나가 지금 받아야 할 것(없으면 빈 배열) — 우선순위가 높을수록 앞 */
function needs(e, now) {
  const out = [];
  if (e.bad && now - e.bad < 6 * 3600e3) return out;
  const cur15 = Math.floor(now / M15) * M15, td = Math.floor(now / D1) * D1, c4 = Math.floor(now / H4) * H4;
  if (!e.m || (e.m.length < 400 && !e.mHist)) out.push({ k: "m", full: true, pri: 0 });
  else if ((e.tm || 0) < cur15) out.push({ k: "m", full: false, pri: 1 });
  if (!e.d || (e.d.length < 60 && !e.dHist)) out.push({ k: "d", full: true, pri: 0 });
  else if (e.d[e.d.length - 1][0] < td - D1) out.push({ k: "d", full: false, pri: 2 });
  if (!e.h4 || (e.h4.length < 80 && !e.hHist)) out.push({ k: "h4", full: true, pri: 0 });
  else if (e.h4[e.h4.length - 1][0] + H4 < c4) out.push({ k: "h4", full: false, pri: 2 });
  return out;
}
/* 받아 와야 하는 일을 예산(시간) 안에서 처리. 반환: { total, ok, fetched, left } */
export async function ensureBars(S, coins, { deadline, log, par = 4 }) {
  const now = Date.now(), tasks = [];
  coins.forEach((c) => { const e = S.c[c.full] || (S.c[c.full] = {}); needs(e, now).forEach((n) => tasks.push({ c, e, ...n })); });
  tasks.sort((a, b) => a.pri - b.pri);
  let fetched = 0, done = 0;
  await pool(tasks, par, async (t) => {
    if (Date.now() > deadline) return;
    const { c, e } = t, tn = Date.now();
    try {
      if (t.k === "m") {
        const from = t.full ? tn - N15 * M15 : Math.max(tn - N15 * M15, e.m[e.m.length - 1][0] - 2 * M15);
        const got = await hl({ type: "candleSnapshot", req: { coin: c.full, interval: "15m", startTime: from, endTime: tn } }, log);
        if (got === null) { e.fail = (e.fail || 0) + 1; if (e.fail >= 3) e.bad = tn; return; }
        const rows = toRows(got, true);
        if (!rows.length) { e.fail = (e.fail || 0) + 1; if (e.fail >= 3) e.bad = tn; return; }
        e.m = merge(e.m, rows, N15); e.tm = tn; e.fail = 0;
        if (t.full && rows.length < N15 - 20) e.mHist = true;   /* 상장된 지 얼마 안 돼 처음부터 다 받은 경우 */
      } else if (t.k === "d") {
        const from = t.full ? tn - N1D * D1 : e.d[e.d.length - 1][0];
        const got = await hl({ type: "candleSnapshot", req: { coin: c.full, interval: "1d", startTime: from, endTime: tn } }, log);
        if (got === null) return;
        const rows = toRows(got, true).filter((r) => r[0] + D1 <= tn + 1000);   /* 완결된 날만 저장(오늘은 15분봉으로 만듦) */
        e.d = merge(e.d, rows, N1D); if (t.full && rows.length < N1D - 5) e.dHist = true;
      } else {
        const from = t.full ? tn - N4H * H4 : e.h4[e.h4.length - 1][0];
        const got = await hl({ type: "candleSnapshot", req: { coin: c.full, interval: "4h", startTime: from, endTime: tn } }, log);
        if (got === null) return;
        const rows = toRows(got, false).filter((r) => r[0] + H4 <= tn + 1000);
        e.h4 = merge(e.h4, rows, N4H); if (t.full && rows.length < N4H - 5) e.hHist = true;
      }
      fetched++;
    } catch (err) {}
    done++;
  });
  const left = tasks.filter((t) => needs(S.c[t.c.full] || {}, Date.now()).some((n) => n.k === t.k)).length;
  return { total: tasks.length, fetched, left };
}

/* 지금 가격으로 마지막 15분봉을 갱신(없으면 새로 만듦). mids: { 'xyz:MSFT': 412.5, 'BTC': 62000 … } */
export function patchLive(S, coins, mids, now) {
  const cur = Math.floor(now / M15) * M15; let n = 0;
  coins.forEach((c) => {
    const e = S.c[c.full], px = +mids[c.full]; if (!e || !e.m || !e.m.length || !(px > 0)) return;
    const last = e.m[e.m.length - 1];
    if (last[0] < cur) e.m.push([cur, px, px, px, 0]); else { last[1] = Math.max(last[1], px); last[2] = Math.min(last[2], px); last[3] = px; }
    n++;
  });
  return n;
}
export async function fetchMids(coins, log) {
  const dexs = [...new Set(coins.map((c) => (c.full.includes(":") ? c.full.split(":")[0] : "")))], mids = {};
  await pool(dexs, 3, async (dx) => { const r = await hl(dx ? { type: "allMids", dex: dx } : { type: "allMids" }, log); if (r) Object.assign(mids, r); });
  return mids;
}
/* 저장해 둔 15분봉은 patchLive 가 끼워 넣은 '임시 봉'(거래량 0)을 포함할 수 있어, 저장 전에 새로 받은 것만 남기도록 정리 */
export function stripLive(S) { Object.values(S.c).forEach((e) => { if (e.m && e.m.length) { const l = e.m[e.m.length - 1]; if (l[4] === 0 && l[1] === l[2] && l[2] === l[3] && (e.tm || 0) < l[0]) e.m.pop(); } }); }
