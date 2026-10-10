/* 코인 한 종목의 모든 지표 + 시장 국면(비트코인 도미넌스·알트시즌) 계산
   일봉 켈트너/켈유/양W/RV/스퀴즈/4H 켈트너는 주식 리포트와 '같은 함수'(repcalc.mjs dailyCore·h4Core) — 정의가 항상 같음 */
import { dailyCore, h4Core, IND } from "./repcalc.mjs";
import { liveBars } from "./coindata.mjs";
import { snapAgo } from "./coindata.mjs";

const { sma, rma, trOf } = IND;
export const FUND_BASE = 10.95;   /* 하이퍼리퀴드 기본 펀딩 = 8시간당 0.01% → 연환산 약 +11% (모든 코인이 이 근처면 '평소 수준') */
const med = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
export const median = med;
const ret = (dc, i, k) => (i - k >= 0 && dc[i - k] > 0 ? (dc[i] / dc[i - k] - 1) * 100 : null);
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

/* ctx = fetchCtx 한 줄({name,px,prev,funding,oi,day,lev}), e = 캔들 저장소 항목, snaps = 스냅샷 목록. 일봉이 12개 미만이면 null */
export function calcRow(e, c, now, fx, snaps, mc) {
  if (!e) return null;
  const { D, H } = liveBars(e, c.px, now);
  if (D.length < 12) return null;
  const k = dailyCore(D), h = H.length >= 50 ? h4Core(H) : { h4m: null, h4u: null, h4g: null };
  const { dc, dh, dl, i, px } = k;
  /* 일봉 3일선·5일선 이격(%) — 오늘(진행 중) 포함 */
  const gapN = (n) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += dc[j]; const m = s / n; return m > 0 ? (px - m) / m * 100 : null; };
  /* RSI(14, 일봉) */
  let rsi = null;
  if (dc.length >= 16) { const up = [], dn = []; for (let j = 1; j < dc.length; j++) { const d = dc[j] - dc[j - 1]; up.push(d > 0 ? d : 0); dn.push(d < 0 ? -d : 0); } const ru = rma(up, 14), rd = rma(dn, 14), a = ru[ru.length - 1], b = rd[rd.length - 1]; if (a != null && b != null) rsi = b === 0 ? 100 : 100 - 100 / (1 + a / b); }
  const hh = (n) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, dh[j]); return m; };
  const atr = rma(trOf(dh, dl, dc), 14)[i];
  /* 거래대금(USD): 7일 평균(완결 일봉) 대비 지금 24h */
  const nt = (b) => (b[4] || 0) * (b[1] + b[2] + b[3]) / 3, done = D.slice(0, -1).slice(-7).map(nt).filter((x) => x > 0), avg7 = done.length >= 3 ? done.reduce((s, x) => s + x, 0) / done.length : null;
  const apr = c.funding * 24 * 365 * 100;
  /* 스냅샷으로 가격·미결제 변화 */
  const chgAgo = (mins) => { const s = snapAgo(snaps, now, mins); return s && s.px[c.name] > 0 ? (c.px / s.px[c.name] - 1) * 100 : null; };
  const oiAgo = (mins) => { const s = snapAgo(snaps, now, mins); return s && s.oi[c.name] > 0 ? (c.oi / s.oi[c.name] - 1) * 100 : null; };
  const oi4 = oiAgo(240), ch4 = chgAgo(240);
  const quad = (oi, p) => (oi == null || p == null ? "" : oi >= 2 && p >= 0.3 ? "신규 롱 유입" : oi >= 2 && p <= -0.3 ? "신규 숏 유입" : oi <= -2 && p >= 0.3 ? "숏 청산(숏커버)" : oi <= -2 && p <= -0.3 ? "롱 청산(투매)" : "");
  const v = {
    px, prev: c.prev, chg: c.prev > 0 ? (px / c.prev - 1) * 100 : null, ret7: r1(ret(dc, i, 7)), ret30: r1(ret(dc, i, 30)), ret90: r1(ret(dc, i, 90)),
    eok: c.day * fx / 1e8, usd: c.day, volx: avg7 ? r1(c.day / avg7) : null, oiEok: c.oi * fx / 1e8, oiUsd: c.oi, apr: r1(apr), lev: c.lev,
    mc: mc || null, mcKrw: mc ? mc * fx : null, oiMc: mc ? r2(c.oi / mc * 100) : null, turn: mc ? r2(c.day / mc * 100) : null,
    kc: k.above[i] ? 1 : 0, kelu: k.above[i] ? k.hold : 0, gap: r1(k.kcGap), pwr: Math.round(k.pwr(i)), w: k.w, sqz: k.sqz, rv: k.rvz,
    h4m: h.h4m, h4u: h.h4u, h4g: r1(h.h4g), g3: r1(gapN(3)), g5: r1(gapN(5)), rsi: r1(rsi),
    hi90: r1((px / hh(90) - 1) * 100), hi150: r1((px / hh(150) - 1) * 100), atrPct: r2(atr != null ? atr / px * 100 : null), age: D.length,
    ch30: r2(chgAgo(30)), ch1h: r2(chgAgo(60)), ch4h: r2(ch4), oi1h: r1(oiAgo(60)), oi4h: r1(oi4), oi24h: r1(oiAgo(1440)), quad: quad(oi4, ch4),
  };
  return v;
}

/* ───────── 시장 국면: 비트코인 도미넌스 · 알트시즌 · 시장 열기 ─────────
   rows = [{ tk(HL이름), v, mc, stable? }], meta = getMeta 결과 */
export function marketView(rows, meta, snaps, now, hot) {
  const g = meta.g || {}, by = Object.fromEntries(rows.map((r) => [r.tk, r])), btc = by.BTC, eth = by.ETH;
  const out = { ok: !!btc, g, fng: meta.f || null };
  if (!btc) return out;
  const withMc = rows.filter((r) => r.mc > 0 && r.v);
  /* 도미넌스 변화(추정): 지금 시총을 가격 변화로 되돌려 '그때'의 시총을 추정 → 조회 기간 안의 도미넌스 변화(%p). 공급량 변화는 무시한 근사 */
  const domDelta = (key) => {
    let now_ = 0, past = 0, bn = 0, bp = 0, en = 0, ep = 0;
    withMc.forEach((r) => { const rr = r.v[key]; const f = rr == null ? 1 : 1 + rr / 100; now_ += r.mc; past += r.mc / f; if (r.tk === "BTC") { bn = r.mc; bp = r.mc / f; } if (r.tk === "ETH") { en = r.mc; ep = r.mc / f; } });
    if (!now_ || !bn) return null;
    const alt0 = now_ - bn - en, alt1 = past - bp - ep;
    return { btc: (bn / now_ - bp / past) * 100, eth: en ? (en / now_ - ep / past) * 100 : null, alt: alt1 > 0 ? (alt0 / alt1 - 1) * 100 : null };
  };
  out.d24 = domDelta("chg"); out.d7 = domDelta("ret7");
  const alts = withMc.filter((r) => r.tk !== "BTC" && !r.stable).sort((a, b) => b.mc - a.mc);
  const top50 = alts.slice(0, 50);
  const idx = (key) => { const b = btc.v[key]; if (b == null) return null; const xs = top50.filter((r) => r.v[key] != null); if (xs.length < 10) return null; return Math.round(xs.filter((r) => r.v[key] > b).length / xs.length * 100); };
  out.idx7 = idx("ret7"); out.idx30 = idx("ret30"); out.idx90 = idx("ret90");
  out.btc7 = btc.v.ret7; out.btc24 = btc.v.chg; out.alt7 = med(alts.map((r) => r.v.ret7)); out.alt24 = med(alts.map((r) => r.v.chg));
  out.ethbtc7 = eth && eth.v.ret7 != null && btc.v.ret7 != null ? ((1 + eth.v.ret7 / 100) / (1 + btc.v.ret7 / 100) - 1) * 100 : null;
  /* 시장 열기: 미결제 합 · 미결제 가중 펀딩(연환산) · 과열 개수 */
  let oiSum = 0, fw = 0; rows.forEach((r) => { if (r.v) { oiSum += r.v.oiUsd; fw += r.v.apr * r.v.oiUsd; } });
  out.oiSum = oiSum; out.fundW = oiSum ? fw / oiSum : null;
  out.hotLong = rows.filter((r) => r.v && r.v.apr >= hot).length; out.hotShort = rows.filter((r) => r.v && r.v.apr <= -hot).length;
  const s24 = snapAgo(snaps, now, 1440), s4 = snapAgo(snaps, now, 240);
  const sumOi = (s) => (s ? rows.reduce((a, r) => a + (s.oi[r.tk] || 0), 0) : null);
  const o24 = sumOi(s24), o4 = sumOi(s4); out.oi24 = o24 ? (oiSum / o24 - 1) * 100 : null; out.oi4 = o4 ? (oiSum / o4 - 1) * 100 : null;
  /* 판정(규칙 기반 · 참고용): 알트 쪽 점수 vs 비트코인 쪽 점수 */
  let a = 0, b = 0; const why = [];
  const d7 = out.d7 && out.d7.btc;
  if (d7 != null) { if (d7 <= -0.5) { a++; why.push("BTC.D 하락 " + d7.toFixed(1) + "%p"); } else if (d7 >= 0.5) { b++; why.push("BTC.D 상승 +" + d7.toFixed(1) + "%p"); } }
  if (out.alt7 != null && out.btc7 != null) { const df = out.alt7 - out.btc7; if (df >= 2) { a++; why.push("알트 중앙값 " + sg(out.alt7) + " > BTC " + sg(out.btc7)); } else if (df <= -2) { b++; why.push("BTC " + sg(out.btc7) + " > 알트 중앙값 " + sg(out.alt7)); } }
  if (out.idx30 != null) { if (out.idx30 >= 60) { a++; why.push("알트시즌지수(30일) " + out.idx30); } else if (out.idx30 <= 25) { b++; why.push("알트시즌지수(30일) " + out.idx30); } }
  if (out.ethbtc7 != null) { if (out.ethbtc7 >= 2) { a++; why.push("ETH/BTC " + sg(out.ethbtc7)); } else if (out.ethbtc7 <= -2) { b++; why.push("ETH/BTC " + sg(out.ethbtc7)); } }
  out.score = { a, b }; out.why = why;
  out.verdict = a >= 3 ? { t: "알트 강세장", c: "alt" } : a === 2 && b === 0 ? { t: "알트 강세 전환 시도", c: "alt2" } : b >= 3 ? { t: "비트코인 강세 · 알트 약세", c: "btc" } : b === 2 && a === 0 ? { t: "비트코인 우위", c: "btc2" } : { t: "혼조 · 방향 대기", c: "mix" };
  const ex = out.fundW == null ? null : out.fundW - FUND_BASE;   /* 기본선(+11%) 대비 */
  out.heat = ex == null ? "" : ex >= 40 ? "과열(롱 쏠림)" : ex >= 10 ? "따뜻함(롱 우세)" : ex <= -15 ? "냉각(숏 쏠림)" : "중립(기본선 수준)";
  /* CG 도미넌스를 못 받았을 때를 위한 대체값: 하이퍼리퀴드 코인 시총 합 기준 */
  const totU = withMc.reduce((s, r) => s + r.mc, 0); out.domU = totU ? { btc: btc.mc / totU * 100, eth: eth && eth.mc ? eth.mc / totU * 100 : null } : null;
  return out;
}
function sg(x) { return (x > 0 ? "+" : "") + x.toFixed(1) + "%"; }
