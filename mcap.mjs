/* 리포트의 '시총' 칸 데이터 — 본주 시가총액(주식·ADR은 본주) · ETF는 순자산 · 코인은 코인 시총. 지수·금리·원자재는 해당 없음
   출처: 야후 파이낸스(주식·ETF, 쿠키+crumb) · 코인게코(코인). 하루 2번만 받아 Supabase tg_mcap 에 저장 → 모든 실행기가 같은 값을 씀(받기에 실패하면 저장된 값 그대로)
   저장 값은 달러 기준(환율 변동에 안 흔들리게) → 표에 그릴 때 원화로 환산 */
import { sbGet, sbPut } from "./sb.mjs";
import { isStock } from "./repnames.mjs";
import { pickRow } from "./extras.mjs";

const KEY = "tg_mcap", TTL = 12 * 3600e3;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
/* 하이퍼리퀴드 티커 → 야후 심볼(미국 상장은 티커 그대로). ADR(SKHY)은 본주 시총 */
const YMAP = { SMSN: "005930.KS", SAMSUNG: "005930.KS", SKHX: "000660.KS", SKHYNIX: "000660.KS", SKHY: "000660.KS", SOFTBANK: "9984.T", HYUNDAI: "005380.KS", KIOXIA: "285A.T" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, h) => fetch(url, { headers: Object.assign({}, UA, h || {}), signal: AbortSignal.timeout(20000) });

/* 대상 종목 나누기: 코인 / 주식·ETF(야후) / 제외(지수·금리·원자재 등) */
export function classify(info, uni) {
  const coins = [], eq = [];
  const all = []; info.watch.forEach(([, items]) => items.split(",").filter(Boolean).forEach((t) => { if (!all.includes(t)) all.push(t); }));
  all.forEach((t) => {
    if (!isStock(t)) return;   /* 지수·금리·원자재·환율·곡물 + 지수·원자재 박스의 ETF 는 표에 시총 칸이 없음 */
    const r = pickRow(uni, t, info);
    if (r && r.dex === "코인") coins.push({ tk: t, sym: String(r.full).replace(/^k(?=[A-Z])/, "").toUpperCase() });
    else eq.push({ tk: t, y: t in YMAP ? YMAP[t] : t });
  });
  return { coins, eq };
}

async function yahoo(eq, log) {
  const out = {};
  const r0 = await fetch("https://fc.yahoo.com", { headers: UA, redirect: "manual", signal: AbortSignal.timeout(20000) });
  const ck = (r0.headers.getSetCookie ? r0.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
  const cr = await get("https://query1.finance.yahoo.com/v1/test/getcrumb", { cookie: ck }), crumb = await cr.text();
  if (!cr.ok || !crumb || crumb.length > 30) throw new Error("야후 crumb 실패 " + cr.status);
  const syms = [...new Set(eq.map((e) => e.y).concat(["KRW=X", "JPY=X"]))], res = {};
  for (let i = 0; i < syms.length; i += 40) {
    const r = await get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + syms.slice(i, i + 40).map(encodeURIComponent).join(",") + "&crumb=" + encodeURIComponent(crumb), { cookie: ck });
    if (!r.ok) throw new Error("야후 quote " + r.status);
    const j = await r.json(); (j.quoteResponse.result || []).forEach((q) => { res[q.symbol] = q; });
    await sleep(400);
  }
  for (const s of syms) {   /* 야후가 묶음 조회에서 가끔 일부를 빠뜨림 → 빠진 것만 하나씩 다시 */
    if (res[s]) continue;
    for (let a = 0; a < 2 && !res[s]; a++) {
      try { const r = await get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(s) + "&crumb=" + encodeURIComponent(crumb), { cookie: ck }); if (r.ok) { const j = await r.json(); (j.quoteResponse.result || []).forEach((q) => { res[q.symbol] = q; }); } } catch (e) {}
      await sleep(300);
    }
  }
  const rate = (s) => (res[s] && res[s].regularMarketPrice) || 0, krw = rate("KRW=X"), jpy = rate("JPY=X");
  const toUsd = (v, cur) => (cur === "USD" ? v : cur === "KRW" && krw ? v / krw : cur === "JPY" && jpy ? v / jpy : null);
  const etfs = [];
  eq.forEach((e) => {
    const q = res[e.y]; if (!q) return;
    const px = toUsd(q.regularMarketPrice, q.currency);
    if (q.marketCap) { const u = toUsd(q.marketCap, q.currency); if (u) out[e.tk] = { usd: u, px, y: e.y }; }
    else if (q.quoteType === "ETF") etfs.push(e);
  });
  for (const e of etfs) {   /* ETF: 시가총액이 없고 순자산(AUM) 이 있음 */
    try {
      const r = await get("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(e.y) + "?modules=summaryDetail&crumb=" + encodeURIComponent(crumb), { cookie: ck });
      if (r.ok) { const j = await r.json(), sd = j.quoteSummary.result[0].summaryDetail; if (sd && sd.totalAssets && sd.totalAssets.raw) out[e.tk] = { usd: sd.totalAssets.raw, aum: true, px: toUsd(res[e.y].regularMarketPrice, res[e.y].currency), y: e.y }; }
    } catch (err) {}
    await sleep(300);
  }
  log && log("시총: 야후 " + Object.keys(out).length + "/" + eq.length + "종목");
  return out;
}
async function gecko(coins, log) {
  const out = {};
  if (!coins.length) return out;
  const syms = [...new Set(coins.map((c) => c.sym.toLowerCase()))].join(",");
  const r = await get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=" + encodeURIComponent(syms) + "&order=market_cap_desc&per_page=250&page=1");
  if (!r.ok) throw new Error("코인게코 " + r.status);
  const j = await r.json(), best = {};
  j.forEach((c) => { const s = String(c.symbol).toUpperCase(); if (c.market_cap && (!best[s] || c.market_cap > best[s].market_cap)) best[s] = c; });   /* 같은 심볼이면 시총 큰 쪽 */
  coins.forEach((c) => { const b = best[c.sym]; if (b) out[c.tk] = { usd: b.market_cap, px: b.current_price, coin: true }; });
  log && log("시총: 코인게코 " + Object.keys(out).length + "/" + coins.length + "종목");
  return out;
}

/* 저장된 값(12시간 이내)을 쓰고, 오래됐으면 새로 받음. 실패해도 이전 값으로 계속 진행. opt.noWrite = 시험용(운영 저장소에 안 씀) */
export async function getMcap({ info, uni, log, noWrite }) {
  let cur = await sbGet(KEY);
  if (cur && cur.t && Date.now() - cur.t < TTL && cur.m) return cur.m;
  const { coins, eq } = classify(info, uni), m = Object.assign({}, cur && cur.m ? cur.m : {});
  let okAny = false;
  try { Object.assign(m, await yahoo(eq, log)); okAny = true; } catch (e) { log && log("시총 야후 실패:", String((e && e.message) || e).slice(0, 100)); }
  try { Object.assign(m, await gecko(coins, log)); okAny = true; } catch (e) { log && log("시총 코인게코 실패:", String((e && e.message) || e).slice(0, 100)); }
  if (okAny && !noWrite) await sbPut(KEY, { t: Date.now(), m });
  else if (!okAny && cur && cur.m) await sbPut(KEY, { t: Date.now() - TTL + 30 * 60e3, m: cur.m });   /* 전부 실패하면 30분 뒤 다시 시도(매 5분 두드리지 않게) */
  return m;
}

/* ───── 그리기용 ───── */
/* 원화 짧게: 10조 이상 정수('1720조') · 10조 미만 소수 한 자리('7.2조') · 1조 미만 억('9400억') */
export function fmtKrw(krw) {
  if (!(krw > 0)) return "";
  if (krw >= 1e12) { const v = krw / 1e12; return (v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1).replace(/\.0$/, "") : "1") + "조"; }
  return Math.max(1, Math.round(krw / 1e8)) + "억";
}
/* 한 줄(r.tk, r.v.px)에 붙일 시총 글자. 가격이 크게 다르면(티커가 다른 회사와 겹친 경우) 표시 안 함 */
export function mcapText(m, r, fx) {
  const e = m && m[r.tk]; if (!e || !(e.usd > 0)) return "";
  const nonUsd = e.y && /\.(KS|T)$/.test(e.y);
  if (!nonUsd && e.px > 0 && r.v && r.v.px > 0) { const q = r.v.px / e.px; const k = /^k[A-Z]/.test(r.full || "") ? 1000 : 1; if (q / k < 0.5 || q / k > 2) return ""; }
  const t = fmtKrw(e.usd * fx);
  return t ? t + (e.aum ? "(순)" : "") : "";
}
