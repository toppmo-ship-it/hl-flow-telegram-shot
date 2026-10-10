/* 코인 리포트 데이터 — 하이퍼리퀴드 메인 거래소의 코인(무기한 선물) 전체
   ① fetchCtx : 한 번의 호출로 전 코인의 가격·24h 전 가격·펀딩·미결제·24h 거래대금 (가벼움)
   ② 캔들 저장소(.cache/coin_bars.json.gz) : 일봉 150개 · 4시간봉 300개만 쌓고, 새 봉이 생길 때만 이어받음(15분봉은 쓰지 않음)
      오늘 일봉·지금 4시간봉은 '지금 가격'으로 만들어 항상 최신 → 호출 부담이 거의 없음
   ③ 스냅샷(.cache/coin_snap.json) : 10분마다 가격·미결제를 저장해 1시간·4시간·24시간 변화를 계산
   ④ getMeta : 시총·순위·도미넌스(코인게코) · 공포탐욕지수(alternative.me) — Supabase tg_coin_meta 에 저장해 하루 2번만 받음 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { hl, pool } from "./extras.mjs";
import { agg } from "./repcalc.mjs";
import { sbGet, sbPut } from "./sb.mjs";

const D1 = 864e5, H4 = 144e5, ND = 150, N4 = 300;
const p7 = (x) => +(+x).toPrecision(8);

/* ───────── ① 전 코인 한 번에 ───────── */
export async function fetchCtx(log) {
  const r = await hl({ type: "metaAndAssetCtxs" }, log);
  if (!r || !r[0] || !r[0].universe) return null;
  return r[0].universe.map((u, i) => {
    const c = r[1][i] || {}, px = +c.markPx || +c.midPx || 0;
    return { name: u.name, delisted: !!u.isDelisted, px, prev: +c.prevDayPx || 0, funding: +c.funding || 0, oi: (+c.openInterest || 0) * px, day: +c.dayNtlVlm || 0, lev: u.maxLeverage };
  }).filter((x) => !x.delisted && x.px > 0);
}

/* ───────── ② 캔들 저장소 ───────── */
const fileOf = (dir, n) => path.join(dir, n);
export function loadStore(dir) {
  try { const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(fileOf(dir, "coin_bars.json.gz"))).toString("utf8")); if (j && j.v === 1) return j; } catch (e) {}
  return { v: 1, c: {} };
}
export function saveStore(dir, S) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(dir, "coin_bars.json.gz"), zlib.gzipSync(Buffer.from(JSON.stringify(S)), { level: 6 })); } catch (e) {} }
const toRows = (got) => (got || []).map((c) => [+c.t, p7(c.h), p7(c.l), p7(c.c), p7(c.v)]).filter((r) => isFinite(r[0]) && r[3] > 0);
const merge = (old, rows, keep) => { const m = new Map((old || []).map((r) => [r[0], r])); rows.forEach((r) => m.set(r[0], r)); return [...m.values()].sort((a, b) => a[0] - b[0]).slice(-keep); };

/* 이 코인이 지금 받아야 할 것: 일봉(어제까지 완결본이 없을 때) · 4시간봉(직전 완결본이 없을 때) */
function needs(e, now) {
  const out = [], td = Math.floor(now / D1) * D1, h4 = Math.floor(now / H4) * H4;
  if (e.bad && now - e.bad < 6 * 3600e3) return out;
  const have = (a) => Array.isArray(a) && a.length > 0;
  if (!have(e.d)) { if (!e.dHist) out.push({ k: "d", full: true, pri: 0 }); } else if (e.d[e.d.length - 1][0] < td - D1) out.push({ k: "d", full: false, pri: 1 });
  if (!have(e.h4)) { if (!e.hHist) out.push({ k: "h4", full: true, pri: 0 }); } else if (e.h4[e.h4.length - 1][0] < h4 - H4) out.push({ k: "h4", full: false, pri: 1 });
  return out;
}
export async function ensureBars(S, names, { deadline, log, par = 4 }) {
  const now = Date.now(), tasks = [];
  names.forEach((n) => { const e = S.c[n] || (S.c[n] = {}); needs(e, now).forEach((x) => tasks.push({ n, e, ...x })); });
  tasks.sort((a, b) => a.pri - b.pri);
  let fetched = 0;
  await pool(tasks, par, async (t) => {
    if (Date.now() > deadline) return;
    const { n, e } = t, tn = Date.now();
    try {
      if (t.k === "d") {
        const from = t.full ? tn - ND * D1 : e.d[e.d.length - 1][0];
        const got = await hl({ type: "candleSnapshot", req: { coin: n, interval: "1d", startTime: from, endTime: tn } }, log);
        if (got === null) return;
        const rows = toRows(got).filter((r) => r[0] + D1 <= tn + 1000);   /* 완결된 날만 저장(오늘은 4시간봉+지금 가격으로 만듦) */
        if (!rows.length && t.full) { e.fail = (e.fail || 0) + 1; if (e.fail >= 3) e.bad = tn; return; }
        e.d = merge(e.d, rows, ND); if (t.full && rows.length < ND - 5) e.dHist = true;   /* 상장한 지 얼마 안 돼 처음부터 다 받은 경우 */
      } else {
        const from = t.full ? tn - N4 * H4 : e.h4[e.h4.length - 1][0];
        const got = await hl({ type: "candleSnapshot", req: { coin: n, interval: "4h", startTime: from, endTime: tn } }, log);
        if (got === null) return;
        const rows = toRows(got).filter((r) => r[0] + H4 <= tn + 1000);
        if (!rows.length && t.full) { e.fail = (e.fail || 0) + 1; if (e.fail >= 3) e.bad = tn; return; }
        e.h4 = merge(e.h4, rows, N4); if (t.full && rows.length < N4 - 5) e.hHist = true;
      }
      e.fail = 0; fetched++;
    } catch (err) {}
  });
  const left = tasks.filter((t) => needs(S.c[t.n] || {}, Date.now()).some((x) => x.k === t.k)).length;
  return { total: tasks.length, fetched, left };
}

/* 지금 4시간 봉의 고가·저가를 10분마다 찍은 가격으로 추적(새 4시간봉이 시작되면 직전 종가에서 다시 시작) */
export function trackLive(e, px, now) {
  const h4s = Math.floor(now / H4) * H4;
  if (!e.cur || e.cur.t !== h4s) { const lc = e.h4 && e.h4.length ? e.h4[e.h4.length - 1][3] : px; e.cur = { t: h4s, hi: Math.max(lc, px), lo: Math.min(lc, px) }; }
  else { e.cur.hi = Math.max(e.cur.hi, px); e.cur.lo = Math.min(e.cur.lo, px); }
}
/* 계산용 봉 배열: D = 완결 일봉 + 오늘(4시간봉 합) · H = 완결 4시간봉 + 지금 4시간봉.  행: [t,h,l,c,v] */
export function liveBars(e, px, now) {
  const td = Math.floor(now / D1) * D1, h4s = Math.floor(now / H4) * H4;
  const H = (e.h4 || []).filter((b) => b[0] + H4 <= now + 1000 && b[0] < h4s).slice(-N4);
  const cur = e.cur && e.cur.t === h4s ? e.cur : { hi: px, lo: px };
  H.push([h4s, Math.max(cur.hi, px), Math.min(cur.lo, px), px, 0]);
  const D = (e.d || []).filter((b) => b[0] < td).slice(-ND), todayRows = H.filter((b) => b[0] >= td);
  if (todayRows.length) D.push(agg(todayRows, D1)[0]);
  return { D, H };
}

/* ───────── ③ 스냅샷(1시간·4시간·24시간 변화용) ───────── */
export function loadSnaps(dir) { try { const j = JSON.parse(fs.readFileSync(fileOf(dir, "coin_snap.json"), "utf8")); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
export function saveSnaps(dir, a) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(dir, "coin_snap.json"), JSON.stringify(a)); } catch (e) {} }
export function pushSnap(snaps, rows, now) {
  const px = {}, oi = {}, day = {};
  rows.forEach((r) => { px[r.name] = p7(r.px); oi[r.name] = Math.round(r.oi); day[r.name] = Math.round(r.day); });
  if (snaps.length && now - snaps[snaps.length - 1].t < 4 * 60000) return snaps;   /* 너무 자주 찍지 않음 */
  snaps.push({ t: now, px, oi, day });
  while (snaps.length && now - snaps[0].t > 27 * 3600e3) snaps.shift();
  return snaps;
}
/* mins 분 전에 가장 가까운 스냅샷(허용 오차 ±max(10분, mins×20%)) */
export function snapAgo(snaps, now, mins) {
  const want = now - mins * 60000, tol = Math.max(10 * 60000, mins * 12000); let best = null;
  for (const s of snaps) if (Math.abs(s.t - want) <= tol && (!best || Math.abs(s.t - want) < Math.abs(best.t - want))) best = s;
  return best;
}
export async function restoreSnaps(dir) {   /* 캐시가 없으면 Supabase 백업에서 */
  let a = loadSnaps(dir); if (a.length) return a;
  const v = await sbGet("tg_coin_snap");
  if (v && v.z && v.d) { try { a = JSON.parse(zlib.gunzipSync(Buffer.from(v.d, "base64")).toString("utf8")); } catch (e) {} }
  return Array.isArray(a) ? a : [];
}
export async function backupSnaps(a, noWrite) { if (noWrite) return; try { await sbPut("tg_coin_snap", { z: 1, d: zlib.gzipSync(Buffer.from(JSON.stringify(a))).toString("base64") }); } catch (e) {} }

/* ───────── ④ 시총·도미넌스·공포탐욕 ───────── */
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", accept: "application/json" };
const getj = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(url.split("?")[0].split("/").slice(2, 6).join("/") + " " + r.status); return r.json(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 하이퍼리퀴드 이름 → 코인게코 시총: 같은 심볼이 여럿이면 가격이 맞는(0.6~1.6배) 것 중 순위가 높은 쪽 */
async function markets(rows, log) {
  /* 시총 상위 1500개(6쪽)를 받아 심볼로 찾음 — symbols= 로 한꺼번에 묻는 방식은 심볼이 많으면 400 오류 */
  const sym = (n) => n.replace(/^k(?=[A-Z])/, "").toLowerCase(), all = [];
  for (let p = 1; p <= 6; p++) {
    let j = null;
    for (let a = 0; a < 3 && !j; a++) { try { j = await getj("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=" + p + "&sparkline=false"); } catch (e) { if (/429/.test(String(e.message))) await sleep(30000); else throw e; } }
    if (!j) throw new Error("코인게코 시총 " + p + "쪽 실패"); all.push(...j); if (j.length < 250) break; await sleep(2500);
  }
  const by = {}; all.forEach((c) => { (by[String(c.symbol).toLowerCase()] = by[String(c.symbol).toLowerCase()] || []).push(c); });
  const m = {};
  rows.forEach((r) => {
    const k = /^k[A-Z]/.test(r.name) ? 1000 : 1, cand = (by[sym(r.name)] || []).filter((c) => c.market_cap > 0 && c.current_price > 0 && (r.px / k) / c.current_price > 0.6 && (r.px / k) / c.current_price < 1.6).sort((a, b) => (a.market_cap_rank || 9e9) - (b.market_cap_rank || 9e9))[0];
    if (cand) m[r.name] = { id: cand.id, cg: cand.name, mc: cand.market_cap, rank: cand.market_cap_rank || 0 };
  });
  log && log("코인 시총: " + Object.keys(m).length + "/" + rows.length + "종목");
  return m;
}
export async function getMeta(rows, { log, noWrite }) {
  const now = Date.now(); let cur = (await sbGet("tg_coin_meta")) || {}, dirty = false;
  if (!cur.m || !cur.tm || now - cur.tm > 12 * 3600e3) { try { cur.m = Object.assign({}, cur.m || {}, await markets(rows, log)); cur.tm = now; dirty = true; } catch (e) { log && log("코인 시총 받기 실패:", String((e && e.message) || e).slice(0, 80)); if (!cur.tm) cur.tm = now - 11.5 * 3600e3; } }
  if (!cur.g || !cur.tg || now - cur.tg > 25 * 60000) {
    try { const j = (await getj("https://api.coingecko.com/api/v3/global")).data; cur.g = { btcD: j.market_cap_percentage.btc, ethD: j.market_cap_percentage.eth, usdtD: j.market_cap_percentage.usdt, total: j.total_market_cap.usd, chg24: j.market_cap_change_percentage_24h_usd }; cur.tg = now; dirty = true; } catch (e) { log && log("도미넌스 받기 실패:", String((e && e.message) || e).slice(0, 80)); }
  }
  if (!cur.f || !cur.tf || now - cur.tf > 55 * 60000) {
    try { const j = (await getj("https://api.alternative.me/fng/?limit=2")).data; cur.f = { v: +j[0].value, cls: j[0].value_classification, prev: j[1] ? +j[1].value : null }; cur.tf = now; dirty = true; } catch (e) { log && log("공포탐욕 받기 실패:", String((e && e.message) || e).slice(0, 80)); }
  }
  if (dirty && !noWrite) await sbPut("tg_coin_meta", cur);
  return cur;
}
