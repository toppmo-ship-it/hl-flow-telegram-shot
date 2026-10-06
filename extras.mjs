/* 사진 발송 직후 같이 보내는 추가 기능 (GitHub Actions 실행기)
   ① HIP-3(하이퍼리퀴드 주식·원자재·지수 퍼프) 평일 하루 평균 거래대금 순위 + 큰 흐름/작은 흐름/기간별/섹터별 분석 (규칙 기반 — AI 호출 없음)
   ② HIP-3 거래량 급증 순위: 30분·1시간·2시간·4시간·24시간
   ③ 설정 페이지에서 체크한 종목별 1시간봉 20일 카드(캔들 + 하단 거래량 + 지지·저항 + 고점·저점 라벨)
   데이터: Hyperliquid 공식 API(candleSnapshot·metaAndAssetCtxs), 환율 open.er-api.com */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./site/patterns.js";
import "./site/quant.js";
import { confluence, volBurst, sessOf, isWeekend } from "./patfeat.mjs";

const HL = "https://api.hyperliquid.xyz/info";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KST_MS = 9 * 3600e3;

/* ── HL 호출: 분당 가중치 예산(900) + 429 재시도 ── */
const BUDGET = 1100;   /* HL 실제 한도는 분당 1200 — 여유 100을 두고 사용 (이전 900 은 매 실행 ~55초 대기를 만들었음) */
let used = [];
const weightOf = (b) => {
  if (b && b.type === "candleSnapshot" && b.req) {
    const ivm = { "30m": 30, "1h": 60, "2h": 120, "4h": 240, "8h": 480, "1d": 1440, "15m": 15 }[b.req.interval] || 60;
    return 20 + Math.ceil(Math.max(0, (b.req.endTime - b.req.startTime) / (ivm * 60000)) / 60);
  }
  return 20;
};
async function hl(body, log) {
  const w = weightOf(body);
  for (let a = 0; a < 6; a++) {
    for (;;) {
      const now = Date.now();
      used = used.filter((x) => now - x[0] < 60000);
      const sum = used.reduce((s, x) => s + x[1], 0);
      if (sum + w <= BUDGET || !used.length) break;
      await sleep(Math.min(2000, used[0][0] + 60000 - now + 50));
    }
    used.push([Date.now(), w]);
    try {
      const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
      if (r.status === 429) { log && log("HL 429 — 잠시 대기"); await sleep(8000 + a * 4000); continue; }
      if (r.status >= 500) { await sleep(1500); continue; }
      return null;
    } catch (e) { await sleep(1500); }
  }
  return null;
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* ── 사이트(site/flow-data.js)의 섹터·한글 이름을 그대로 읽어 옴 ── */
export function loadSiteInfo(siteDir) {
  const info = { watch: [], alias: { SKHYNIX: "SKHX" }, ko: {} };
  try {
    const src = fs.readFileSync(path.join(siteDir, "flow-data.js"), "utf8");
    const w = /const WATCH=(\[[\s\S]*?\n\]);/.exec(src);
    if (w) info.watch = new Function("return " + w[1])();
    const k = /F\.NAME_KO=(\{[\s\S]*?\});/.exec(src);
    if (k) info.ko = new Function("return " + k[1])();
    const e = /F\.EXTRA_OLD=(\[[^\]]*\])/.exec(src);
    if (e) info.extra = new Function("return " + e[1])();
  } catch (e) {}
  info.koFull = Object.assign({}, info.ko);
  try { Object.assign(info.koFull, JSON.parse(fs.readFileSync(path.join(siteDir, "names-ko.json"), "utf8"))); } catch (e) {}   /* 사이트 메인의 전체 한글 이름(var KO) */
  const sectorOf = {};
  info.watch.forEach(([nm, items]) => { const name = nm.replace(/^\S+\s+/, ""); items.split(",").forEach((t) => { if (t && !sectorOf[t]) sectorOf[t] = name; }); });
  info.sectorOf = sectorOf;
  return info;
}

/* ── 공통 서식 ── */
const p2 = (n) => String(n).padStart(2, "0");
const kst = (ms) => new Date(ms + KST_MS);
const WDK = ["일", "월", "화", "수", "목", "금", "토"];
const kstStamp = (ms) => { const d = kst(ms); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) + "(" + WDK[d.getUTCDay()] + ") " + p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + " KST"; };
const md = (ms) => { const d = new Date(ms); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const eok = (usd, fx) => (usd * fx) / 1e8;
const jo = (e) => { const j = Math.floor(e / 10000), r = Math.round(e % 10000); return j > 0 ? j + "조 " + fmt(r) + "억원" : fmt(e) + "억원"; };
/* 화살표(색): 상승=빨강 🔺 / 하락=파랑 🔽 — ±10% 이내 보합, 10~50% 한 개, 50% 이상 두 개 */
const arrow = (pct) => (pct == null || !isFinite(pct) ? "▫️" : Math.abs(pct) < 10 ? "➖" : pct > 0 ? (pct >= 50 ? "🔺🔺" : "🔺") : (pct <= -50 ? "🔽🔽" : "🔽"));
const pc = (pct) => (pct == null || !isFinite(pct) ? "—" : (pct >= 0 ? "+" : "") + Math.round(pct) + "%");
const chg = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/* ── 유니버스(HIP-3 전 종목) + 24h 거래대금 ── */
let DUP = new Set();
export async function loadUniverse(log) {
  const dexs = await hl({ type: "perpDexs" }, log);
  const names = (dexs || []).filter((d) => d && d.name).map((d) => d.name);
  const rows = [];
  await pool(names, 3, async (dx) => {
    const r = await hl({ type: "metaAndAssetCtxs", dex: dx }, log);
    if (!r) return;
    r[0].universe.forEach((u, i) => { const c = r[1][i] || {}; rows.push({ dex: dx, full: u.name, short: u.name.includes(":") ? u.name.split(":")[1] : u.name, dayNtl: +c.dayNtlVlm || 0, px: +c.markPx || +c.midPx || 0 }); });
  });
  const cnt = {}; rows.forEach((r) => { cnt[r.short] = (cnt[r.short] || 0) + 1; });
  DUP = new Set(Object.keys(cnt).filter((k) => cnt[k] > 1));   /* 여러 거래소에 같은 티커가 있는 경우(예: SNDK) — 이름표에서 구분용으로만 거래소를 붙임 */
  return rows.sort((a, b) => b.dayNtl - a.dayNtl);
}
export async function usdKrw(log) {
  try { const r = await fetch("https://open.er-api.com/v6/latest/USD"); const j = await r.json(); if (j && j.rates && j.rates.KRW) return j.rates.KRW; } catch (e) {}
  return 1350;
}
const coinLabel = (row, info) => {
  const kmap = info.koFull || info.ko, ko = kmap[row.short] || kmap[Object.keys(info.alias).find((k) => info.alias[k] === row.short)];
  const flag = row.short === "SKHX" || row.short === "SMSN" ? " 🇰🇷" : "";
  /* 거래소명(xyz: 등)은 표시하지 않음 → '티커 (종목설명)'. 같은 티커가 다른 거래소에도 있을 때만 xyz 외 쪽에 ·거래소 를 붙여 구분 */
  return row.short + (row.dex !== "xyz" && DUP.has(row.short) ? "·" + row.dex : "") + (ko && ko !== row.short ? " (" + ko + ")" : "") + flag;
};

/* ═════════ ① 평일 거래대금 순위 + 큰/작은 흐름 분석 ═════════ */
export async function buildWeeklyTexts({ uni, info, fx, cacheDir, log }) {
  const now = Date.now();
  const top = uni.slice(0, 60);
  const cover = top.reduce((s, r) => s + r.dayNtl, 0) / Math.max(1, uni.reduce((s, r) => s + r.dayNtl, 0));
  /* 일봉 캐시: UTC 날짜가 바뀌었거나 12시간이 지나면 새로 받음(완료된 날은 안 바뀌므로 하루 1번이면 충분) */
  const cf = path.join(cacheDir, "rank_daily.json");
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) {}
  const todayUtc = Math.floor(now / 864e5);
  if (!cache || cache.day !== todayUtc || now - cache.t > 12 * 3600e3) {
    log("일봉 수집(상위 60종목)…");
    const start = now - 34 * 864e5, data = {};
    await pool(top, 3, async (r) => {
      const cs = await hl({ type: "candleSnapshot", req: { coin: r.full, interval: "1d", startTime: start, endTime: now } }, log);
      if (cs && cs.length) data[r.full] = cs.map((c) => [c.t, +c.h, +c.l, +c.c, +c.v]);
    });
    cache = { t: now, day: todayUtc, data };
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(cache)); } catch (e) {}
  }
  const rowsOut = [];
  let wkDaysAll = null, weekendAll = [];
  top.forEach((r) => {
    const cs = cache.data[r.full]; if (!cs) return;
    const done = cs.filter((c) => c[0] + 864e5 <= now);   /* 완료된 날만 */
    const wd = done.filter((c) => { const g = new Date(c[0]).getUTCDay(); return g >= 1 && g <= 5; });
    const we = done.filter((c) => { const g = new Date(c[0]).getUTCDay(); return g === 0 || g === 6; });
    const nt = (c) => eok(c[4] * (c[1] + c[2] + c[3]) / 3, fx);   /* 거래량 × (고+저+종)/3 → 억원 */
    const last15 = wd.slice(-15);
    if (last15.length < 8) return;
    const w5 = last15.slice(-5), prev = last15.slice(0, -5);
    const small2 = last15.slice(-2), small5 = last15.slice(-7, -2);
    rowsOut.push({
      r, avg3w: mean(last15.map(nt)), last: mean(w5.map(nt)), prev: mean(prev.map(nt)),
      s2: mean(small2.map(nt)), s5: mean(small5.map(nt)),
      weekend: we.slice(-6).map(nt), days: last15.map((c) => c[0]),
    });
  });
  if (!rowsOut.length) return { texts: [], note: "일봉 데이터를 받지 못했어요" };
  const sum = (k) => rowsOut.reduce((s, x) => s + x[k], 0) / cover;   /* 상위 60종목 합 ÷ 커버율 = 전체 추정 */
  const tot3w = sum("avg3w"), totLast = sum("last"), totPrev = sum("prev");
  const weekendAvg = rowsOut.reduce((s, x) => s + mean(x.weekend), 0) / cover;
  const todayTot = uni.reduce((s, r) => s + eok(r.dayNtl, fx), 0);
  const rank = rowsOut.slice().sort((a, b) => b.avg3w - a.avg3w);
  const top25 = rank.slice(0, 25), top25Sum = top25.reduce((s, x) => s + x.avg3w, 0) / cover;
  const days = rank[0].days, firstD = md(days[0]), lastD = md(days[days.length - 1]);
  const w5Days = days.slice(-5);
  const todayName = WDK[kst(now).getUTCDay()];
  /* ── 표시용 보조: 섹터 이름(괄호 설명 제거) · 억/조 표기 ── */
  const secOf = (r) => info.sectorOf[r.short] || info.sectorOf[Object.keys(info.alias).find((k) => info.alias[k] === r.short)] || "기타";
  const secShort = (s) => s.replace(/\s*\(.*?\)/g, "").trim();
  const eokTxt = (e) => (e >= 10000 ? (e / 10000).toFixed(1) + "조" : fmt(e) + "억");
  const ratio = weekendAvg > 0 ? (tot3w / weekendAvg).toFixed(1) : "—";
  const dn = kst(now), stampShort = (dn.getUTCMonth() + 1) + "/" + dn.getUTCDate() + "(" + WDK[dn.getUTCDay()] + ") " + p2(dn.getUTCHours()) + ":" + p2(dn.getUTCMinutes());

  /* ── 메시지 1: 평일 거래대금 TOP 25 (종목 · 섹터 · 하루 평균 · 1주 증감) ── */
  const star = (p) => (p != null && p >= 150 ? " 🚀" : "");
  const lines = top25.map((x, i) => {
    const d = chg(x.last, x.prev);
    return (i + 1) + ". " + coinLabel(x.r, info) + "\n    " + secShort(secOf(x.r)) + " · " + eokTxt(x.avg3w) + " · " + arrow(d) + pc(d) + star(d);
  });
  const msg1 = "📊 HIP-3 평일 거래대금 · " + stampShort +
    "\n\n💰 하루 평균 " + jo(tot3w) +
    "\n지난주 " + jo(totLast) + " " + arrow(chg(totLast, totPrev)) + pc(chg(totLast, totPrev)) +
    "\n주말 " + jo(weekendAvg) + " · 오늘(24h) " + jo(todayTot) +
    "\n평일이 주말의 " + ratio + "배 · 상위 25종목이 " + (top25Sum / tot3w * 100).toFixed(0) + "%" +
    "\n\n🏆 TOP 25  (하루 평균 · 1주 증감)\n" + lines.join("\n");

  /* ── 메시지 2: 급증·감소 TOP 5 + 전체·섹터 흐름 ── */
  const MINV = 50;   /* 억원 미만 종목은 급증·급감 목록에서 제외(잡음) */
  const pool2 = rowsOut.filter((x) => x.avg3w >= MINV);
  const medal = ["🥇", "🥈", "🥉"];
  /* 상위 n개 + (증가 쪽) +150% 이상은 개수와 상관없이 전부 🚀 로 추가 */
  const lst = (up) => {
    const all = pool2.map((x) => ({ x, p: chg(x.last, x.prev) })).filter((o) => o.p != null && isFinite(o.p)).sort((a, b) => (up ? b.p - a.p : a.p - b.p));
    const extra = up ? all.filter((o, i) => i >= 5 && o.p >= 150).length : 0;
    return all.slice(0, 5 + extra).map((o, i) => (i < 3 ? medal[i] : (i + 1) + ".") + " " + coinLabel(o.x.r, info) + "  " + pc(o.p) + star(o.p) + "\n    " + secShort(secOf(o.x.r)) + " · " + eokTxt(o.x.prev) + " → " + eokTxt(o.x.last)).join("\n");
  };
  const a3 = rowsOut.reduce((s, x) => s + x.avg3w, 0) / cover;
  /* 직전 1주 평균(일봉에서 다시 계산) */
  let prevWk = 0;
  top.forEach((r) => {
    const cs = cache.data[r.full]; if (!cs) return;
    const wd = cs.filter((c) => c[0] + 864e5 <= now).filter((c) => { const g = new Date(c[0]).getUTCDay(); return g >= 1 && g <= 5; }).slice(-15);
    if (wd.length >= 10) prevWk += mean(wd.slice(-10, -5).map((c) => eok(c[4] * (c[1] + c[2] + c[3]) / 3, fx)));
  });
  prevWk /= cover;
  const sec = {};
  rowsOut.forEach((x) => { const s = secShort(secOf(x.r)); (sec[s] = sec[s] || []).push(x); });
  const secLines = Object.entries(sec).map(([name, arr]) => { const l = arr.reduce((s, x) => s + x.last, 0), p = arr.reduce((s, x) => s + x.prev, 0); return { name, l, p, c: chg(l, p), n: arr.length }; })
    .filter((o) => o.l + o.p > 100).sort((a, b) => b.l - a.l).slice(0, 10)
    .map((o) => arrow(o.c) + " " + o.name + "  " + eokTxt(o.l) + " · " + pc(o.c) + " · " + o.n + "종목");
  const msg2 = "🔥 거래대금 급증 TOP 5  (지난주 vs 전 2주)\n" + lst(true) +
    "\n\n🧊 감소 TOP 5\n" + lst(false) +
    "\n\n📈 전체 " + jo(totPrev) + " → " + jo(totLast) + " " + arrow(chg(totLast, totPrev)) + pc(chg(totLast, totPrev)) +
    "\n직전 1주 " + arrow(chg(totLast, prevWk)) + pc(chg(totLast, prevWk)) + " · 3주 평균 " + arrow(chg(totLast, a3)) + pc(chg(totLast, a3)) +
    "\n\n🧭 섹터별  (지난주 거래대금 · 증감)\n" + secLines.join("\n");
  return { texts: [msg1, msg2] };
}

/* ═════════ ② 거래량 급증 순위 (30분·1시간·2시간·4시간·24시간) ═════════ */
export async function buildSurgeText({ uni, info, fx, log, cacheDir }) {
  const now = Date.now(), top = uni.slice(0, 30);
  const start = now - 8.5 * 864e5, bars = {};
  /* 미리받기(증분): 30분봉 저장본을 .cache/surge30m.json 에 두고, 매번 마지막 3봉부터만 새로 받아 합침 (가중치 27 → 21, 전송량 1/100) */
  const cf = cacheDir ? path.join(cacheDir, "surge30m.json") : null; let sc = {};
  try { if (cf) sc = JSON.parse(fs.readFileSync(cf, "utf8")); } catch (e) {}
  let inc = 0, full = 0;
  await pool(top, 3, async (r) => {
    const old = sc[r.full], have = old && old.length > 100 && old[0].t <= start + 36e5;
    const from = have ? old[old.length - 3].t : start;
    const cs = await hl({ type: "candleSnapshot", req: { coin: r.full, interval: "30m", startTime: from, endTime: now } }, log);
    if (!cs || !cs.length) { if (have) bars[r.full] = old.filter((x) => x.t >= start); return; }
    const add = cs.map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c, n: +c.v * (+c.h + +c.l + +c.c) / 3 }));
    const m = new Map((have ? old : []).map((x) => [x.t, x])); add.forEach((x) => m.set(x.t, x));
    bars[r.full] = [...m.values()].filter((x) => x.t >= start).sort((x, y) => x.t - y.t);
    if (have) inc++; else full++;
  });
  if (cf) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(bars)); } catch (e) {} }
  log && log("급증 순위 데이터: 증분 " + inc + "종목 · 전체 " + full + "종목");
  const H = 1800e3, res = { "30분": [], "1시간": [], "2시간": [], "4시간": [], "24시간": [] };
  const spec = [["30분", 1], ["1시간", 2], ["2시간", 4], ["4시간", 8]];
  top.forEach((r) => {
    const b = bars[r.full]; if (!b || b.length < 60) return;
    const byT = new Map(b.map((x) => [x.t, x]));
    const lastDone = Math.floor((now - H) / H) * H;   /* 마지막으로 완료된 30분봉 시작 */
    spec.forEach(([nm, k]) => {
      const W = k * H, endStart = Math.floor((lastDone + H) / W) * W - W;   /* 마지막 완료 W봉 시작 */
      const grp = (s) => { let v = 0, o = null, c = null; for (let i = 0; i < k; i++) { const x = byT.get(s + i * H); if (!x) return null; v += x.n; if (o == null) o = x.o; c = x.c; } return { v, o, c }; };
      const cur = grp(endStart); if (!cur) return;
      const wkOf = (t) => { const g = new Date(t).getUTCDay(); return g === 0 || g === 6; }, curWk = wkOf(endStart);
      const prevs = []; for (let j = 1, got = 0; j <= 60 && got < 20; j++) { const st = endStart - j * W; if (wkOf(st) !== curWk) continue; const g = grp(st); if (g) { prevs.push(g.v); got++; } }   /* 주말 봉은 평일 비교에서 제외 */
      if (prevs.length < (curWk ? 6 : 12)) return;
      const MINV = { "30분": 1.5e5, "1시간": 3e5, "2시간": 6e5, "4시간": 1e6 }[nm];   /* 너무 작은 거래대금(USD)은 급증 순위에서 제외 */
      const av = mean(prevs); if (av <= 0 || cur.v < MINV) return;
      res[nm].push({ r, ratio: cur.v / av, vol: cur.v, px: (cur.c / cur.o - 1) * 100 });
    });
    /* 24시간: 마지막 완료 30분봉까지 최근 48봉 합 vs 그 앞 7개의 48봉 합 평균 */
    const lastIdx = lastDone;
    const sumRange = (endT, cnt) => { let v = 0, o = null, c = null; for (let i = cnt - 1; i >= 0; i--) { const x = byT.get(endT - i * H); if (!x) return null; v += x.n; if (o == null) o = x.o; c = x.c; } return { v, o, c }; };
    const cur = sumRange(lastIdx, 48); if (!cur) return;
    const wkOf2 = (t) => { const g = new Date(t).getUTCDay(); return g === 0 || g === 6; }, curWk2 = wkOf2(lastIdx - 12 * 3600e3);
    const prevs = []; for (let j = 1, got = 0; j <= 14 && got < 7; j++) { const e0 = lastIdx - j * 48 * H; if (wkOf2(e0 - 12 * 3600e3) !== curWk2) continue; const g = sumRange(e0, 48); if (g) { prevs.push(g.v); got++; } }
    if (prevs.length < (curWk2 ? 2 : 4)) return;
    const av = mean(prevs); if (av > 0 && cur.v >= 3e6) res["24시간"].push({ r, ratio: cur.v / av, vol: cur.v, px: (cur.c / cur.o - 1) * 100 });
  });
  const dot = (x) => (x >= 3 ? "🟥" : x >= 2 ? "🟧" : x >= 1.5 ? "🟨" : "⬜");
  const parts = ["🔥 HIP-3 거래량 급증 순위", "🕐 " + kstStamp(now) + " | 기준: 완료된 봉 거래대금 ÷ 직전 20봉 평균 (24시간은 직전 7일 평균) · 24h 거래대금 상위 30종목", "표시: 🟥 3배↑ · 🟧 2~3배 · 🟨 1.5~2배 · 가격 🔺상승(빨강)/🔽하락(파랑)"];
  for (const nm of ["30분", "1시간", "2시간", "4시간", "24시간"]) {
    const top8 = res[nm].sort((a, b) => b.ratio - a.ratio).slice(0, 8);
    parts.push("\n⏱ " + nm + " 급증 TOP " + top8.length);
    if (!top8.length) parts.push(" (데이터 부족)");
    top8.forEach((x, i) => parts.push((i + 1) + ". " + dot(x.ratio) + " " + coinLabel(x.r, info) + "  " + x.ratio.toFixed(1) + "배 · " + fmt(eok(x.vol, fx)) + "억 · " + (Math.abs(x.px) < 0.05 ? "➖0.0" : (x.px >= 0 ? "🔺+" : "🔽") + x.px.toFixed(1)) + "%"));
  }
  return [parts.join("\n")];
}

/* ═════════ ③ 종목별 1시간봉 카드 ═════════ */
const rsi14 = (cl) => {
  if (cl.length < 16) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = cl[i] - cl[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let ag = g / 14, al = l / 14;
  for (let i = 15; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; ag = (ag * 13 + Math.max(d, 0)) / 14; al = (al * 13 + Math.max(-d, 0)) / 14; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
};
/* 지지·저항: 피벗(좌우 5봉) 고점·저점을 0.7% 안에서 묶고 터치 횟수가 많은 가격대를 선택 */
function levels(cs, px) {
  const k = 5, piv = [];
  for (let i = k; i < cs.length - k; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= k; j++) { if (cs[i].high <= cs[i - j].high || cs[i].high < cs[i + j].high) hi = false; if (cs[i].low >= cs[i - j].low || cs[i].low > cs[i + j].low) lo = false; }
    if (hi) piv.push(cs[i].high); if (lo) piv.push(cs[i].low);
  }
  const cl = [];
  piv.sort((a, b) => a - b).forEach((p) => { const c = cl.find((x) => Math.abs(x.p - p) / x.p < 0.007); if (c) { c.p = (c.p * c.n + p) / (c.n + 1); c.n++; } else cl.push({ p, n: 1 }); });
  const strong = cl.filter((c) => c.n >= 2);
  const res = strong.filter((c) => c.p > px * 1.002).sort((a, b) => a.p - b.p).slice(0, 2).map((c) => ({ price: c.p, type: "R" }));
  const sup = strong.filter((c) => c.p < px * 0.998).sort((a, b) => b.p - a.p).slice(0, 3).map((c) => ({ price: c.p, type: "S" }));
  return [...res, ...sup];
}
function swings(cs) {
  const k = 12, out = [];
  for (let i = k; i < cs.length - 1; i++) {
    const hiN = Math.min(cs.length - 1, i + k);
    let hi = true, lo = true;
    for (let j = Math.max(0, i - k); j <= hiN; j++) { if (j === i) continue; if (cs[j].high > cs[i].high) hi = false; if (cs[j].low < cs[i].low) lo = false; }
    if (hi) out.push({ time: cs[i].time, price: cs[i].high, type: "H" });
    else if (lo) out.push({ time: cs[i].time, price: cs[i].low, type: "L" });
  }
  return out.slice(-10);
}
const IVMS = { "1d": 864e5, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14400e3, "8h": 28800e3 };
/* 카드용 캔들 저장본(.cache/cardbars.json): 패턴 통계를 위해 최대 5000봉(약 240일)을 쌓아 두고 매번 마지막 3봉부터만 이어받음 */
let CB = null, CBFILE = null, CBDIRTY = false;
function cbLoad(cacheDir) { if (CB) return; CB = {}; CBFILE = cacheDir ? path.join(cacheDir, "cardbars.json") : null; try { if (CBFILE) CB = JSON.parse(fs.readFileSync(CBFILE, "utf8")); } catch (e) { CB = {}; } }
export function flushCardCache(cacheDir) { if (!CB || !CBDIRTY || !CBFILE) return; try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(CBFILE, JSON.stringify(CB)); } catch (e) {} CBDIRTY = false; }
/* 캔들 저장본 + 마지막 3봉부터 이어받기 (카드·패턴 순위 공용) */
async function getRows(coin, iv, lookN, cacheDir, log) {
  const ms = IVMS[iv] || 3600e3, now = Date.now(); cbLoad(cacheDir);
  const key = coin + "|" + iv, old = CB[key], have = old && old.length > 20 && old[0][0] <= now - lookN * ms + Math.min(36 * ms, 3 * 864e5);
  const from = have ? old[old.length - 3][0] : now - lookN * ms;
  const got = await hl({ type: "candleSnapshot", req: { coin, interval: iv, startTime: from, endTime: now } }, log);
  let rows = have ? old : [];
  if (got && got.length) { const m = new Map(rows.map((x) => [x[0], x])); got.forEach((c) => m.set(c.t, [c.t, +c.o, +c.h, +c.l, +c.c, +c.v])); rows = [...m.values()].sort((a, b) => a[0] - b[0]).slice(-lookN); CB[key] = rows; CBDIRTY = true; }
  return rows;
}
export async function buildCardData({ row, ticker, info, iv, days, fx, log, cacheDir, mode }) {
  const ms = IVMS[iv] || 3600e3, now = Date.now();
  const lookN = Math.min(5000, Math.ceil((days + 60) * 864e5 / ms));   /* 패턴이 윈도 앞에서 시작해도 잡히도록 표시 구간 앞쪽 여유 포함 */
  const rows = await getRows(row.full, iv, lookN, cacheDir, log);
  if (!rows || rows.length < 30) return null;
  const candles = rows.map((c) => ({ time: Math.round(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] * (c[2] + c[3] + c[4]) / 3 }));
  const windowBars = Math.min(candles.length, Math.ceil(days * 864e5 / ms));   /* 거래량 = 거래대금(USD) */
  /* 일봉(켈트너 20/10/1.5·ICT용): 최근 120일 */
  const dd = await getRows(row.full, "1d", 220, cacheDir, log).catch(() => null);
  const daily = (dd || []).map((c) => ({ time: Math.round(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  const last = candles[candles.length - 1], isWkd = (ms) => { const g = new Date(ms).getUTCDay(); return g === 0 || g === 6; }, lastWk = isWkd(last.time * 1000);
  const prev20 = candles.slice(0, -1).filter((c) => isWkd(c.time * 1000) === lastWk).slice(-20).map((c) => c.volume), avg = mean(prev20);   /* 주말 거래량이 평일 평균을 왜곡하지 않게 같은 종류끼리만 비교 */
  const frac = Math.min(1, Math.max(0, (now - last.time * 1000) / ms));   /* 진행 중인 봉이 얼마나 지났는지 — 봉 초반에 ×0.0 처럼 나오지 않게 경과 시간만큼 보정 */
  const mult = avg > 0 && prev20.length >= 8 && frac >= 0.08 ? last.volume / (avg * frac) : null, body = (last.close / last.open - 1) * 100, rsi = rsi14(candles.map((c) => c.close));
  const turn24 = candles.filter((c) => c.time * 1000 > now - 864e5).reduce((s, c) => s + c.volume, 0);
  const kmap = info.koFull || info.ko, name0 = kmap[ticker] || kmap[row.short] || kmap[Object.keys(info.alias).find((k) => info.alias[k] === row.short)] || "", name = name0 && name0 !== ticker && name0 !== row.short ? name0 : "";
  const price = last.close;
  const fmtP = (v) => (v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
  const ivKo = { "15m": "15분", "30m": "30분", "1h": "1시간", "2h": "2시간", "4h": "4시간", "8h": "8시간" }[iv] || iv;
  const perEn = { "15m": "15min", "30m": "30min", "1h": "1hour", "2h": "2hour", "4h": "4hour", "8h": "8hour" }[iv] || iv;
  const sec = info.sectorOf[ticker] || info.sectorOf[row.short] || info.sectorOf[Object.keys(info.alias).find((k) => info.alias[k] === row.short)] || "";
  const ttl = ticker + (name ? " · " + name : ""), subTxt = (sec ? sec + " · " : "") + (row.dex === "코인" ? "Hyperliquid 무기한 선물" : "Hyperliquid " + row.full + " 무기한");
  const dot = mult == null ? "⬜" : mult >= 3 ? "🟥" : mult >= 2 ? "🟧" : mult >= 1.5 ? "🟨" : "⬜";
  const secS = sec.replace(/\s*\(.*?\)/g, "").trim();
  const caption = "📈 " + ticker + (name ? " (" + name + ")" : "") + (secS ? " · " + secS : "") + "\n" +
    "💰 " + fmtP(price) + " · 24h 거래대금 " + fmt(eok(turn24, fx)) + "억원 ($" + (turn24 / 1e6).toFixed(1) + "M)\n\n" +
    (body >= 0 ? "🔺" : "🔽") + " " + ivKo + "봉 몸통 " + (body >= 0 ? "+" : "") + body.toFixed(2) + "%" + (rsi != null ? " · RSI " + Math.round(rsi) : "") + "\n" +
    dot + " 거래량 평소의 ×" + (mult == null ? "—" : mult.toFixed(1)) + (mult == null ? " (봉 집계 초반)" : lastWk ? " (주말 평균 대비 · 경과시간 보정)" : " (직전 20봉 평균 대비 · 경과시간 보정)") + "\n" +
    "⏱ " + kstStamp(now).slice(-9) + " · 진행 중";
  return { iv, mode: mode || "pattern", windowBars, daily, tk: ticker, nm: name, ivKo, ttl, sub: subTxt, period: days + "day-" + perEn, title: ticker + (name ? " (" + name + ")" : "") + " - " + iv.toUpperCase() + " (Vol) (HYPERLIQUID)", price: fmtP(price), candles, sr: levels(candles, price), swings: swings(candles), caption };
}

/* ═════════ ④ 패턴 셋업 리포트 (연구 결과 pattern_rank.json v3 기반 · 별도 메시지) ═════════
   셋업 = 패턴 × 조건(켈트너 구간·지지/저항 중복·거래량 급증·시간대). 연구에서 앞 60%로 고르고 뒤 40%로 검증한 순위를 쓰고,
   지금 그 셋업 조건에 맞는 종목(형성 중 / 최근 10봉 안에 돌파·이탈 확정)을 연구와 똑같은 정의로 찾아 보여 줌 */
const GRP_TYPES = { 쌍바닥: ["doubleBottom"], 쌍천장: ["doubleTop"], 헤드앤숄더: ["headShoulders"], 역헤드앤숄더: ["invHeadShoulders"], 컵위드핸들: ["cupHandle"], 상승깃발: ["bullFlag"], 하락깃발: ["bearFlag"], 삼각수렴: ["ascTriangle", "symTriangle", "descTriangle"], 쐐기: ["fallingWedge", "risingWedge"], 박스권: ["box"] };
const GRP_NOTE = {
  쌍바닥: { L: "같은 가격대에서 저점을 두 번 지지 → 넥라인 돌파로 확정" }, 쌍천장: { S: "같은 가격대에서 고점을 두 번 저항 → 넥라인 이탈로 확정" },
  헤드앤숄더: { S: "머리가 가장 높은 3봉우리 → 넥라인 이탈로 확정" }, 역헤드앤숄더: { L: "머리가 가장 낮은 3저점 → 넥라인 돌파로 확정" },
  컵위드핸들: { L: "둥근 바닥 뒤 얕은 눌림(손잡이) → 고점 돌파로 확정" }, 상승깃발: { L: "급등 뒤 좁은 눌림(깃발) → 깃발 상단 돌파로 확정" }, 하락깃발: { S: "급락 뒤 좁은 반등(깃발) → 깃발 하단 이탈로 확정" },
  삼각수렴: { L: "고점·저점이 좁혀지는 삼각형 → 상단선 돌파로 확정", S: "고점·저점이 좁혀지는 삼각형 → 하단선 이탈로 확정" },
  쐐기: { L: "하락폭이 줄며 좁아지는 쐐기 → 상단선 돌파로 확정", S: "상승폭이 줄며 좁아지는 쐐기 → 하단선 이탈로 확정" }, 박스권: { L: "고점·저점이 수평 반복 → 박스 상단 돌파로 확정", S: "고점·저점이 수평 반복 → 박스 하단 이탈로 확정" },
};
const MEDAL = ["🥇", "🥈", "🥉", "4️⃣"];
const ZN = { A: "켈트너 상단 위", B: "켈트너 중심~상단", C: "켈트너 하단~중심", D: "켈트너 하단 아래" };
export async function buildPatternRankText({ uni, info, log, cacheDir, tf0, scanN }) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "pattern_rank.json");
  let R; try { R = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return []; }
  const PT = globalThis.Patterns, QT = globalThis.Quant; if (!PT || !QT || !R.setups) return [];
  const has = (k) => R.setups[k] && ((R.setups[k].L || []).length || (R.setups[k].S || []).length);
  const tf = (tf0 === "4h" || tf0 === "8h") && has("4h") ? "4h" : has("1h") ? "1h" : has("4h") ? "4h" : null;
  if (!tf) return [];
  const rowsL = (R.setups[tf].L || []).slice(0, 4), rowsS = (R.setups[tf].S || []).slice(0, 3);
  const seen = new Set(), scan = [];
  for (const r of uni) { if (seen.has(r.short) || r.dayNtl < 1e6) continue; seen.add(r.short); scan.push(r); if (scan.length >= (scanN || 50)) break; }
  const ms = IVMS[tf] || 3600e3, lookN = Math.min(5000, Math.ceil(110 * 864e5 / ms));
  const live = [];
  await pool(scan, 3, async (r) => {
    try {
      const rows = await getRows(r.full, tf, lookN, cacheDir, log), drows = await getRows(r.full, "1d", 220, cacheDir, log);
      if (!rows || rows.length < 120 || !drows || drows.length < 30) return;
      const cs = rows.map((c) => ({ time: Math.round(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] * (c[2] + c[3] + c[4]) / 3 }));
      const daily = drows.map((c) => ({ time: Math.round(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
      const n = cs.length, pq = QT.prepare(cs), f = pq.at(n - 1), zoner = QT.makeZoner(daily), z = zoner(cs[n - 1].time, cs[n - 1].close); if (!f || !z) return;
      PT.detect(cs).pats.forEach((p) => {
        if (PT.META[p.type].info) return;
        const fresh = p.state === "forming" || (p.state === "confirmed" && p.confirmI >= n - 1 - 10);
        if (!fresh || (p.state === "confirmed" && isWeekend(cs[p.confirmI].time))) return;   /* 주말에 확정된 건 연구 대상에서 제외했으므로 표시도 제외 */
        live.push({ r, p, f, z, n, cs, pq, zoner });
      });
    } catch (e) { log && log("패턴 스캔 실패", r.short, String((e && e.message) || e)); }
  });
  const nameOf = (r) => { const km = info.koFull || info.ko, ko = km[r.short] || ""; return r.short + (ko && ko !== r.short ? " (" + ko + ")" : ""); };
  const p1 = (x) => (x == null ? "—" : Math.round(x * 100) + "%"), pp = (x) => { const r = Math.round(x * 100); return r === 0 ? "±0%p" : (r > 0 ? "+" : "") + r + "%p"; };
  const fx2 = (v) => (v >= 1000 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));
  const sgn = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  /* 한 셋업에 대해 지금 맞는 종목 */
  const matches = (row) => {
    const side = row.side, types = GRP_TYPES[row.grp] || [], out = [], got = new Set();
    live.forEach(({ r, p, f, z, n, cs, pq, zoner }) => {
      if (!types.includes(p.type)) return;
      const dirNow = p.state === "confirmed" ? p.dirReal : (p.dir || 0);
      if (side === "L" ? dirNow < 0 : dirNow > 0) return;
      const d = side === "L" ? 1 : -1, conf = p.state === "confirmed";
      const cf = confluence(cs, p, d, pq, zoner, 0.5), vb = conf ? volBurst(cs, p.confirmI) : null, ss = conf ? sessOf(cs[p.confirmI].time) : null;
      const zOK = side === "L" ? (z.z === "A" || z.z === "B") : (z.z === "C" || z.z === "D");
      const test = { z: () => zOK, c2: () => cf.conf >= 2, sr: () => cf.srC, vw: () => cf.vwapC, ke: () => cf.keltC, vb: () => (conf ? vb != null && vb >= 1.5 : null), us: () => (conf ? ss === "US" : null) };
      const res = row.conds.map((c) => test[c]());
      if (res.some((x) => x === false)) return;   /* 확정된 조건이 하나라도 어긋나면 제외 */
      if (got.has(r.short)) return; got.add(r.short);
      const pend = row.conds.filter((c, i) => res[i] === null), px = cs[n - 1].close;
      const lvl = side === "L" ? (p._lines && p._lines.up ? p._lines.up(n - 1) : null) : (p._lines && p._lines.lo ? p._lines.lo(n - 1) : null);
      const dist = !conf && lvl != null ? (lvl / px - 1) * 100 : null, age = conf ? n - 1 - p.confirmI : null, toTgt = conf && p.target != null ? (p.target / px - 1) * 100 : null;
      if (!conf && dist != null && Math.abs(dist) > 6) return;   /* 돌파선·이탈선까지 6% 넘게 남았으면 숨김 */
      out.push({ r, sc: side === "L" ? f.score : 6 - f.score, lab: f.lab, conf, dist, age, toTgt, cf, pend, vb, zn: ZN[z.z], imminent: dist != null && Math.abs(dist) <= 0.8 });
    });
    return out.sort((a, b) => (b.imminent - a.imminent) || ((a.conf ? 0 : 1) - (b.conf ? 0 : 1)) || (a.conf && b.conf ? a.age - b.age : Math.abs(a.dist == null ? 99 : a.dist) - Math.abs(b.dist == null ? 99 : b.dist)) || (b.sc - a.sc)).slice(0, 4);
  };
  const PENDTXT = { vb: (sd) => (sd === "L" ? "돌파봉" : "이탈봉") + " 거래량 1.5배↑", us: (sd) => "미국장 시간대 " + (sd === "L" ? "돌파" : "이탈") };
  const block = (rows, side) => rows.map((row, i) => {
    const got = matches(row), cond = row.condText && row.condText.length ? row.condText.join(" · ") : "패턴 단독 (추가 조건 없음)";
    const title = row.grp + (row.condText && row.condText.length ? " + " + shortCond(row, side) : "");
    const L = [MEDAL[i] + " " + (i + 1) + "위 · " + title];
    L.push("   📈 성공률 " + p1(row.win) + "  (n=" + row.n + " · 기준선 대비 " + pp(row.lift) + ")");
    L.push("   🔬 검증 구간 " + p1(row.teWin) + " (n=" + row.teN + ") · 선정 구간 " + p1(row.trWin) + " (n=" + row.trN + ")");
    L.push("   🧩 " + ((GRP_NOTE[row.grp] || {})[side] || ""));
    L.push("   🎯 조건: " + cond);
    if (!got.length) L.push("   — 지금 조건에 맞는 종목 없음");
    else { L.push("   ▶ 지금 해당 종목 " + got.length + "개"); got.forEach((g, k) => {
      const st = g.conf ? ((side === "L" ? "돌파" : "이탈") + " 확정 " + g.age + "봉 전" + (g.toTgt != null ? " · 목표까지 " + sgn(g.toTgt) : "")) : "형성 중 · " + (side === "L" ? "돌파선" : "이탈선") + "까지 " + (g.dist == null ? "—" : sgn(g.dist)) + (g.imminent ? " 🔥임박" : "");
      const sup = g.cf.conf ? "  " + (side === "L" ? "🛡 지지" : "🛡 저항") + " " + g.cf.conf + "중첩(" + [g.cf.srC ? (side === "L" ? "지지대" : "저항대") : null, g.cf.vwapC ? "VWAP" : null, g.cf.keltC ? "켈트너 " + g.cf.keltAt : null].filter(Boolean).join("·") + ")" : "";
      L.push("     " + (k + 1) + ". " + nameOf(g.r) + " · " + g.sc + "/6점" + (g.lab ? " · " + g.lab : ""));
      L.push("        " + st + sup + (g.pend.length ? "\n        ⏳ 확인 대기: " + g.pend.map((c) => PENDTXT[c] ? PENDTXT[c](side) : c).join(" · ") : ""));
    }); }
    return L.join("\n");
  }).join("\n\n");
  const shortCond = (row, side) => row.conds.map((c) => ({ z: side === "L" ? "켈트너 상단권" : "켈트너 하단권", c2: side === "L" ? "지지 중복" : "저항 중복", sr: side === "L" ? "지지대 겹침" : "저항대 겹침", vw: side === "L" ? "VWAP 지지" : "VWAP 저항", ke: "켈트너 겹침", vb: "거래량 급증", us: "미국장" }[c])).join(" + ");
  /* 🔔 지금 포착된 신호: 순위와 상관없이 '방금 돌파·이탈 확정(3봉 이내)' 또는 '선까지 0.8% 이내 임박'한 패턴. 과거 성공률은 그 패턴 전체 통계 */
  const GS = (R.groupStats && R.groupStats[tf]) || {}, grpOf = (type) => Object.keys(GRP_TYPES).find((g) => GRP_TYPES[g].includes(type));
  const sigs = [];
  live.forEach(({ r, p, f, z, n, cs, pq, zoner }) => {
    const conf = p.state === "confirmed", px = cs[n - 1].close, g = grpOf(p.type); if (!g) return;
    let side = conf ? (p.dirReal > 0 ? "L" : "S") : (p.dir > 0 ? "L" : p.dir < 0 ? "S" : null), dist = null;
    const up = p._lines && p._lines.up ? p._lines.up(n - 1) : null, lo = p._lines && p._lines.lo ? p._lines.lo(n - 1) : null;
    if (!conf) {
      if (!side) { const du = up != null ? (up / px - 1) * 100 : null, dl = lo != null ? (lo / px - 1) * 100 : null; if (du == null && dl == null) return; side = (du != null && (dl == null || Math.abs(du) <= Math.abs(dl))) ? "L" : "S"; dist = side === "L" ? du : dl; }
      else { const lv = side === "L" ? up : lo; if (lv == null) return; dist = (lv / px - 1) * 100; }
      if (Math.abs(dist) > 0.8) return;   /* 임박만 */
    } else if (n - 1 - p.confirmI > 3) return;
    const d = side === "L" ? 1 : -1, cf = confluence(cs, p, d, pq, zoner, 0.5), vb = conf ? volBurst(cs, p.confirmI) : null, age = conf ? n - 1 - p.confirmI : null, gs = (GS[g] || {})[side];
    sigs.push({ r, g, side, conf, dist, age, cf, vb, gs, sc: side === "L" ? f.score : 6 - f.score });
  });
  sigs.sort((a, b) => ((b.conf ? 1 : 0) - (a.conf ? 1 : 0)) || (a.conf ? a.age - b.age : Math.abs(a.dist) - Math.abs(b.dist)));
  const supTxt = (cf, side) => (cf.conf ? (side === "L" ? "🛡 지지 " : "🛡 저항 ") + cf.conf + "중첩(" + [cf.srC ? (side === "L" ? "지지대" : "저항대") : null, cf.vwapC ? "VWAP" : null, cf.keltC ? "켈트너 " + cf.keltAt : null].filter(Boolean).join("·") + ")" : "");
  const sigBlock = sigs.length ? sigs.slice(0, 8).map((s) => {
    const dirTxt = s.side === "L" ? "▲ 상단 돌파" : "▼ 하단 이탈", hist = s.gs ? "과거 성공률 " + p1(s.gs.win) + " (n=" + s.gs.n + " · 기준선 대비 " + pp(s.gs.lift) + ")" : "과거 표본 부족";
    const head2 = s.conf ? "✅ " + nameOf(s.r) + " · " + s.g + " " + dirTxt + " 확정 " + s.age + "봉 전" : "⏳ " + nameOf(s.r) + " · " + s.g + " " + dirTxt + " 임박 (" + sgn(s.dist) + ")";
    const extra = [hist, supTxt(s.cf, s.side), s.conf && s.vb != null ? "거래량 ×" + s.vb.toFixed(1) : null].filter(Boolean).join(" · ");
    return head2 + "\n     " + extra;
  }).join("\n") : "지금 새로 포착된 신호 없음";
  const bl = R.baseline || {}, ivTxt = tf === "1h" ? "1시간봉" : tf === "4h" ? "4시간봉" : tf;
  const head = "🏆 패턴 셋업 리포트 · " + kstStamp(Date.now()) +
    "\n📊 " + ivTxt + " · 평일 거래대금 상위 " + (R.universe || []).length + "종목 · 과거 " + R.period.from + " ~ " + R.period.to +
    "\n📚 평일 돌파·이탈 " + R.resolved + "건으로 검증 (앞 60%로 선정 → 뒤 40%로 확인)" +
    "\n📏 전체 패턴 평균 성공률: 롱 " + p1(bl.L && bl.L[tf]) + " · 숏 " + p1(bl.S && bl.S[tf]) +
    "\n✅ 성공 = 돌파 후 패턴 높이의 60% 도달 · ❌ 실패 = 반대로 60% 이동";
  const msgs = [];
  msgs.push(head + "\n\n🔔 지금 포착된 신호  (방금 돌파·이탈했거나 곧 돌파·이탈할 패턴)\n" + sigBlock + (rowsL.length ? "\n\n━━━━━━━━━━━━━━\n🔺 롱 셋업 — 상단선 돌파\n━━━━━━━━━━━━━━\n\n" + block(rowsL, "L") : ""));
  if (rowsS.length) msgs.push("━━━━━━━━━━━━━━\n🔻 숏 셋업 — 하단선 이탈\n━━━━━━━━━━━━━━\n\n" + block(rowsS, "S"));
  return msgs;
}

export function pickRow(uni, ticker, info) {
  const alias = info.alias[ticker] || ticker;
  return uni.find((r) => r.short === alias && r.dex === "xyz") || uni.find((r) => r.short === alias && r.dayNtl > 1e5) || (/^[A-Z0-9]{2,8}$/.test(ticker) ? { full: ticker, short: ticker, dex: "코인" } : null);
}
/* 카드 이미지 렌더(site/card.html) */
export async function renderCard(page, base, data) {
  if (data.vp) await page.setViewport({ width: data.vp.w, height: data.vp.h, deviceScaleFactor: 2 });   /* 카드 사진 크기: 폴드 1200×1100 / 갤탭·PC 16:10 1600×1000 */
  await page.goto(base + "/card.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  { const k = kst(Date.now()); data.stamp = k.getUTCFullYear() + "-" + p2(k.getUTCMonth() + 1) + "-" + p2(k.getUTCDate()) + "(" + WDK[k.getUTCDay()] + ") " + p2(k.getUTCHours()) + ":" + p2(k.getUTCMinutes()) + ":" + p2(k.getUTCSeconds()); }
  const sum = await page.evaluate((d) => window.renderCard(d), data);
  await sleep(700);
  if (data.textOn === false) {   /* 글 끄기: 기본 정보 2줄(📈 종목 · 섹터 / 💰 가격 · 24h 거래대금)만 남김 */
    data.caption = data.caption.split("\n").slice(0, 2).join("\n"); data.detail = null;
  } else if (sum) {
    const L = [];
    if (sum.kel) L.push("🟠 일봉 켈트너 → " + sum.kel.pos + "\n   중심 " + sum.kel.mid.toPrecision(5) + " · 상단 " + sum.kel.up.toPrecision(5) + " · 하단 " + sum.kel.lo.toPrecision(5));
    if (sum.quant) {
      const q = sum.quant, nm = { vol: "거래량", rsi: "RSI", macd: "MACD", w14: "%R14", w48: "%R48", vwap: "VWAP" }, ks = Object.keys(nm);
      const ok = ks.filter((k) => q.pts[k]).map((k) => nm[k]), no = ks.filter((k) => !q.pts[k]).map((k) => nm[k]);
      const labMap = { "HH/HL": "상승 구조(HH/HL)", "LH/LL": "하락 구조(LH/LL)", "HH/LL": "확장(HH/LL)", "LH/HL": "수렴(LH/HL)" };
      L.push("🧮 지표 점수 " + q.score + "/6" + (q.lab ? " · " + (labMap[q.lab] || q.lab) : "") + (ok.length ? "\n   ✅ " + ok.join(" · ") : "") + (no.length ? "\n   ❌ " + no.join(" · ") : ""));
    }
    if (sum.patterns) {
      const dt = sum.patterns.detail || [];
      L.push(dt.length ? dt.map((d) => "🧩 " + d.short).join("\n") : "🧩 진행 중인 패턴 없음");
      if (dt.length) data.detail = "🔎 " + data.tk + (data.nm ? " (" + data.nm + ")" : "") + " 패턴 분석 · " + data.ivKo + "봉\n" + dt.map((d) => d.text).join("\n\n─────────────\n\n");
    }
    const t = sum.ict; if (t) L.push("🧭 ICT: " + t.trend + " · 최근 " + t.last + " · " + t.pd + " 구간 · FVG " + t.fvg + " · OB " + t.ob + (t.eqh || t.eql ? " · EQH " + t.eqh + "/EQL " + t.eql : ""));
    if (t && t.flips.length) L.push("🔁 전환 레벨: " + t.flips.join(", "));
    if (sum.rsi != null && !sum.quant) L.push("📊 RSI " + sum.rsi);
    data.caption += "\n\n" + L.join("\n");
    if (data.caption.length > 1000) data.caption = data.caption.slice(0, 997) + "…";
  }
  return await page.screenshot({ type: "png" });
}
