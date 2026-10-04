/* 사진 발송 직후 같이 보내는 추가 기능 (GitHub Actions 실행기)
   ① HIP-3(하이퍼리퀴드 주식·원자재·지수 퍼프) 평일 하루 평균 거래대금 순위 + 큰 흐름/작은 흐름/기간별/섹터별 분석 (규칙 기반 — AI 호출 없음)
   ② HIP-3 거래량 급증 순위: 30분·1시간·2시간·4시간·24시간
   ③ 설정 페이지에서 체크한 종목별 1시간봉 20일 카드(캔들 + 하단 거래량 + 지지·저항 + 고점·저점 라벨)
   데이터: Hyperliquid 공식 API(candleSnapshot·metaAndAssetCtxs), 환율 open.er-api.com */
import fs from "node:fs";
import path from "node:path";

const HL = "https://api.hyperliquid.xyz/info";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KST_MS = 9 * 3600e3;

/* ── HL 호출: 분당 가중치 예산(900) + 429 재시도 ── */
const BUDGET = 900;
let used = [];
const weightOf = (b) => {
  if (b && b.type === "candleSnapshot" && b.req) {
    const ivm = { "30m": 30, "1h": 60, "2h": 120, "4h": 240, "1d": 1440, "15m": 15 }[b.req.interval] || 60;
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
export async function loadUniverse(log) {
  const dexs = await hl({ type: "perpDexs" }, log);
  const names = (dexs || []).filter((d) => d && d.name).map((d) => d.name);
  const rows = [];
  await pool(names, 3, async (dx) => {
    const r = await hl({ type: "metaAndAssetCtxs", dex: dx }, log);
    if (!r) return;
    r[0].universe.forEach((u, i) => { const c = r[1][i] || {}; rows.push({ dex: dx, full: u.name, short: u.name.includes(":") ? u.name.split(":")[1] : u.name, dayNtl: +c.dayNtlVlm || 0, px: +c.markPx || +c.midPx || 0 }); });
  });
  return rows.sort((a, b) => b.dayNtl - a.dayNtl);
}
export async function usdKrw(log) {
  try { const r = await fetch("https://open.er-api.com/v6/latest/USD"); const j = await r.json(); if (j && j.rates && j.rates.KRW) return j.rates.KRW; } catch (e) {}
  return 1350;
}
const coinLabel = (row, info) => {
  const ko = info.ko[row.short] || info.ko[Object.keys(info.alias).find((k) => info.alias[k] === row.short)];
  const flag = row.short === "SKHX" || row.short === "SMSN" ? " 🇰🇷" : "";
  return (row.dex === "xyz" ? "xyz:" : row.dex + ":") + row.short + (ko && ko !== row.short ? " (" + ko + ")" : "") + flag;
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
  const header = "📊 HIP-3 평일 하루 평균 거래대금\n\n🕐 조회: " + kstStamp(now) + " | ✅ Hyperliquid 공식 API 일봉 | 💱 1달러 = " + fmt(fx * 10) / 10 + "원\n📅 기간: 최근 평일 " + days.length + "일(" + firstD + "~" + lastD + ", UTC 날짜 기준)";
  const head2 = header.replace(/\| 💱 1달러 = [^\n]*/, "| 💱 1달러 = " + fx.toFixed(1) + "원");
  const concl = "\n\n💰 결론: 평일 하루 평균 약 " + jo(tot3w) +
    "\n🟦 평일 " + Math.round(days.length / 5) + "주 평균: " + jo(tot3w) +
    "\n🟦 지난주 평일 평균(" + md(w5Days[0]) + "~" + md(w5Days[4]) + "): " + jo(totLast) + " " + arrow(chg(totLast, totPrev)) + " " + pc(chg(totLast, totPrev)) + " (전 2주 대비)" +
    "\n⬜ 주말 평균: " + jo(weekendAvg) +
    "\n⬜ 오늘 " + todayName + "요일(24시간): " + jo(todayTot) +
    "\n\n👉 평일 거래대금은 주말의 약 " + (weekendAvg > 0 ? (tot3w / weekendAvg).toFixed(1) : "—") + "배, 상위 25종목이 전체의 " + (top25Sum / tot3w * 100).toFixed(1) + "%를 차지합니다.";
  const rule = "\n\n📐 큰 흐름 = 지난주 평균 vs 그 전 2주 평균(겹치지 않음) · 작은 흐름 = 최근 2평일 vs 직전 5평일\n표시: ➖ ±10% 이내 · 🔺/🔽 ±10~50% · 🔺🔺/🔽🔽 ±50% 이상 (🔺=증가 빨강, 🔽=감소 파랑)";
  const lines = top25.map((x, i) => {
    const big = chg(x.last, x.prev), sm = chg(x.s2, x.s5);
    return (i + 1) + ". " + coinLabel(x.r, info) + "\n    " + fmt(x.prev) + " → " + fmt(x.last) + " 억  큰흐름 " + pc(big) + " " + arrow(big) + "  |  작은흐름 " + pc(sm) + " " + arrow(sm);
  });
  const msg1 = head2 + concl + rule + "\n\n🏆 평일 거래대금 TOP 25 (하루 평균, 억원 · 전 2주 → 지난주)\n" + lines.join("\n");

  /* ── 분석 메시지 (규칙 기반: 수치·화살표만) ── */
  const MINV = 50;   /* 억원 미만 종목은 급증·급감 목록에서 제외(잡음) */
  const pool2 = rowsOut.filter((x) => x.avg3w >= MINV);
  const lst = (arr, key, n, up) => arr.map((x) => ({ x, p: key(x) })).filter((o) => o.p != null).sort((a, b) => (up ? b.p - a.p : a.p - b.p)).slice(0, n)
    .map((o) => coinLabel(o.x.r, info).replace(/ \(.*?\)/, "") + " " + pc(o.p)).join(", ");
  const big = (x) => chg(x.last, x.prev), sm = (x) => chg(x.s2, x.s5);
  const totS2 = sum("s2"), totS5 = sum("s5");
  const a3 = rowsOut.reduce((s, x) => s + x.avg3w, 0) / cover;
  const per = [
    ["지난주(5평일) vs 직전 5평일", chg(totLast, rowsOut.reduce((s, x) => s + mean(days.slice(-10, -5).map((d, i) => 0)), 0) || null)],
  ];
  /* 기간별: 지난주 평균을 (직전 1주 / 전 2주 / 평일 전체 평균) 과 각각 비교 */
  const prev1 = rowsOut.reduce((s, x) => s + x.prevWeek1, 0);
  void per; void prev1;
  /* 직전 1주 평균은 일봉에서 다시 계산 */
  let prevWk = 0;
  top.forEach((r) => {
    const cs = cache.data[r.full]; if (!cs) return;
    const wd = cs.filter((c) => c[0] + 864e5 <= now).filter((c) => { const g = new Date(c[0]).getUTCDay(); return g >= 1 && g <= 5; }).slice(-15);
    if (wd.length >= 10) prevWk += mean(wd.slice(-10, -5).map((c) => eok(c[4] * (c[1] + c[2] + c[3]) / 3, fx)));
  });
  prevWk /= cover;
  const sec = {};
  rowsOut.forEach((x) => { const s = info.sectorOf[x.r.short] || info.sectorOf[Object.keys(info.alias).find((k) => info.alias[k] === x.r.short)] || "기타"; (sec[s] = sec[s] || []).push(x); });
  const secLines = Object.entries(sec).map(([name, arr]) => { const l = arr.reduce((s, x) => s + x.last, 0), p = arr.reduce((s, x) => s + x.prev, 0); return { name, l, p, c: chg(l, p), n: arr.length }; })
    .filter((o) => o.l + o.p > 100).sort((a, b) => b.l - a.l).slice(0, 10)
    .map((o) => " " + arrow(o.c) + " " + o.name + " " + pc(o.c) + " (" + fmt(o.p) + "→" + fmt(o.l) + "억/" + o.n + "종목)");
  const msg2 = "🔎 큰 흐름 (주 단위)\n지난주 평균 vs 전 2주 평균\n 전체 " + arrow(chg(totLast, totPrev)) + " " + pc(chg(totLast, totPrev)) + " (" + jo(totPrev) + " → " + jo(totLast) + ")\n" +
    " 🔺 급증: " + lst(pool2, big, 5, true) + "\n 🔽 감소: " + lst(pool2, big, 5, false) +
    "\n\n🔍 작은 흐름 (일 단위)\n최근 2평일 평균 vs 직전 5평일 평균\n 전체 " + arrow(chg(totS2, totS5)) + " " + pc(chg(totS2, totS5)) + " (" + jo(totS5) + " → " + jo(totS2) + ")\n" +
    " 🔺 급증: " + lst(pool2, sm, 5, true) + "\n 🔽 감소: " + lst(pool2, sm, 5, false) +
    "\n\n📆 기간별 전체 거래대금 (지난주 평균 기준)\n vs 직전 1주 " + arrow(chg(totLast, prevWk)) + " " + pc(chg(totLast, prevWk)) +
    "\n vs 전 2주 " + arrow(chg(totLast, totPrev)) + " " + pc(chg(totLast, totPrev)) +
    "\n vs 3주 평균 " + arrow(chg(totLast, a3)) + " " + pc(chg(totLast, a3)) +
    "\n\n🧭 섹터별 이동 (지난주 vs 전 2주, 관심종목 섹터 기준)\n" + secLines.join("\n") +
    "\n\n⚠️ 일봉 거래량 × (고+저+종)/3 로 추정한 값이라 실제 체결대금과 몇 % 오차가 있을 수 있어요. 순위·흐름 판단에는 영향이 작습니다.";
  return { texts: [msg1, msg2] };
}

/* ═════════ ② 거래량 급증 순위 (30분·1시간·2시간·4시간·24시간) ═════════ */
export async function buildSurgeText({ uni, info, fx, log }) {
  const now = Date.now(), top = uni.slice(0, 30);
  const start = now - 8.5 * 864e5, bars = {};
  await pool(top, 3, async (r) => {
    const cs = await hl({ type: "candleSnapshot", req: { coin: r.full, interval: "30m", startTime: start, endTime: now } }, log);
    if (cs && cs.length) bars[r.full] = cs.map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c, n: +c.v * (+c.h + +c.l + +c.c) / 3 }));
  });
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
      const prevs = []; for (let j = 1; j <= 20; j++) { const g = grp(endStart - j * W); if (g) prevs.push(g.v); }
      if (prevs.length < 12) return;
      const MINV = { "30분": 1.5e5, "1시간": 3e5, "2시간": 6e5, "4시간": 1e6 }[nm];   /* 너무 작은 거래대금(USD)은 급증 순위에서 제외 */
      const av = mean(prevs); if (av <= 0 || cur.v < MINV) return;
      res[nm].push({ r, ratio: cur.v / av, vol: cur.v, px: (cur.c / cur.o - 1) * 100 });
    });
    /* 24시간: 마지막 완료 30분봉까지 최근 48봉 합 vs 그 앞 7개의 48봉 합 평균 */
    const lastIdx = lastDone;
    const sumRange = (endT, cnt) => { let v = 0, o = null, c = null; for (let i = cnt - 1; i >= 0; i--) { const x = byT.get(endT - i * H); if (!x) return null; v += x.n; if (o == null) o = x.o; c = x.c; } return { v, o, c }; };
    const cur = sumRange(lastIdx, 48); if (!cur) return;
    const prevs = []; for (let j = 1; j <= 7; j++) { const g = sumRange(lastIdx - j * 48 * H, 48); if (g) prevs.push(g.v); }
    if (prevs.length < 4) return;
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
const IVMS = { "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14400e3 };
export async function buildCardData({ row, ticker, info, iv, days, fx, log }) {
  const ms = IVMS[iv] || 3600e3, now = Date.now();
  const n = Math.min(900, Math.ceil(days * 864e5 / ms));
  const cs0 = await hl({ type: "candleSnapshot", req: { coin: row.full, interval: iv, startTime: now - n * ms, endTime: now } }, log);
  if (!cs0 || cs0.length < 30) return null;
  const candles = cs0.map((c) => ({ time: Math.round(c.t / 1000), open: +c.o, high: +c.h, low: +c.l, close: +c.c, volume: +c.v * (+c.h + +c.l + +c.c) / 3 }));   /* 거래량 = 거래대금(USD) */
  const last = candles[candles.length - 1], prev20 = candles.slice(-21, -1).map((c) => c.volume), avg = mean(prev20);
  const mult = avg > 0 ? last.volume / avg : null, body = (last.close / last.open - 1) * 100, rsi = rsi14(candles.map((c) => c.close));
  const turn24 = candles.filter((c) => c.time * 1000 > now - 864e5).reduce((s, c) => s + c.volume, 0);
  const name = (info.ko[ticker] || "") ;
  const price = last.close;
  const fmtP = (v) => (v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
  const ivKo = { "15m": "15분", "30m": "30분", "1h": "1시간", "2h": "2시간", "4h": "4시간" }[iv] || iv;
  const dot = mult == null ? "⬜" : mult >= 3 ? "🟥" : mult >= 2 ? "🟧" : mult >= 1.5 ? "🟨" : "⬜";
  const caption = "📈 [" + (row.dex === "xyz" ? "HIP-3" : row.dex) + "] " + ticker + (name ? " (" + name + ")" : "") + " (" + iv.toUpperCase() + ")\n\n" +
    dot + " 거래량: 평소의 " + (mult == null ? "—" : mult.toFixed(1)) + "배 (직전 20봉 평균 대비)\n" +
    (body >= 0 ? "🔺" : "🔽") + " 몸통: " + (body >= 0 ? "+" : "") + body.toFixed(2) + "%" + (rsi != null ? " (RSI " + Math.round(rsi) + ")" : "") + "\n" +
    "💰 현재가: " + fmtP(price) + "\n💵 24시간 거래대금: " + fmt(eok(turn24, fx)) + "억원 ($" + (turn24 / 1e6).toFixed(1) + "M)\n⏱ " + kstStamp(now).slice(-9) + " · " + ivKo + "봉 진행 중";
  return { title: ticker + (name ? " (" + name + ")" : "") + " - " + iv.toUpperCase() + " (Vol) (HYPERLIQUID)", price: fmtP(price), candles, sr: levels(candles, price), swings: swings(candles), caption };
}
export function pickRow(uni, ticker, info) {
  const alias = info.alias[ticker] || ticker;
  return uni.find((r) => r.short === alias && r.dex === "xyz") || uni.find((r) => r.short === alias) || null;
}
/* 카드 이미지 렌더(site/card.html) */
export async function renderCard(page, base, data) {
  await page.goto(base + "/card.html", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate((d) => window.renderCard(d), data);
  await sleep(500);
  return await page.screenshot({ type: "png" });
}
