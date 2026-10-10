/* 하이퍼 리포트 — 데이터 모으기 → 섹션 만들기 (그리는 일은 rep-render.js 가 함)
   탬퍼몽키 스크리너의 3분 리포트(★핵심 · 지수·원자재 · 전종목 · TOP5 4종 · 최근 진입 · 급변동)를 같은 구성으로 만듦.
   설정(tg_shot_cfg): rep(켬/끔) · repEvery(분) · repOrder(항목 순서, 위→아래) · repOff(끈 항목) · repCols(표 칸) · repRows(전종목 줄 수) · repSurge(급변동 구간, 분) */
import fs from "node:fs";
import path from "node:path";
import { pickRow, hl } from "./extras.mjs";
import { splitKo, isStock, FIXED_INDEX } from "./repnames.mjs";
import { mcapText } from "./mcap.mjs";
import { loadBars, saveBars, ensureBars, patchLive, fetchMids, calcCoin, changeOver } from "./repcalc.mjs";

export const BLOCK_IDS = ["sum", "core", "index", "all", "topVol", "topChg", "topKel", "topStreak", "recent", "surge"];
export const COL_IDS = ["px", "chg", "ntl", "mcap", "kel", "gap", "pwr", "w", "h4", "g3", "g5", "d15s", "d15", "d30", "vwap", "sqz", "jb", "rv", "kelu", "cumT"];
const KST = 9 * 3600e3, p2 = (n) => String(n).padStart(2, "0");
const kd = (ms) => new Date(ms + KST);
const hm = (ms) => { const d = kd(ms); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); };
const mdhm = (ms) => { const d = kd(ms); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + hm(ms); };
const sameDay = (a, b) => kd(a).toISOString().slice(0, 10) === kd(b).toISOString().slice(0, 10);
const short = (ms) => (sameDay(ms, Date.now()) ? "" : (kd(ms).getUTCMonth() + 1) + "/" + kd(ms).getUTCDate() + " ") + hm(ms);

/* ───────── 셀 만들기 (색·모양은 탬퍼몽키 리포트와 같게) ───────── */
const C = { up: "#ff6363", dn: "#5496ff", ok: "#3ddc84", no: "#5f636e", sub: "#969ba5", mark: "#e8a0b0", acc: "#8ab4f8", txt: "#e6e8ec", gold: "#f5c542" };
const cell = (t, c, b, bg, sz) => ({ t: String(t), c: c || null, b: !!b, bg: bg || null, sz: sz || 1 });
const dash = (sz) => cell("–", C.no, false, null, sz);
const nul = (x) => x == null || Number.isNaN(x);
const pct = (x) => (nul(x) ? cell("-", C.sub) : cell((x > 0 ? "+" : "") + x.toFixed(2) + "%", x > 0 ? C.up : x < 0 ? C.dn : C.txt, true));
const signed = (x, suffix) => (nul(x) ? cell("-", C.sub) : cell((x > 0 ? "+" : "") + (Number.isInteger(x) ? x : x.toFixed(1)) + (suffix || ""), x > 0 ? C.up : x < 0 ? C.dn : C.txt, true));
/* 가격 표시: 크기에 맞춰 자리수 조정. 미국 10년물은 금리(%) — 등락은 bp(0.01%p)로 */
const fmtPx = (p) => (nul(p) ? "-" : p >= 10000 ? Math.round(p).toLocaleString("en-US") : p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toPrecision(3));
const bpCell = (px, prev) => { if (nul(px) || nul(prev)) return cell("-", C.sub); const bp = (px - prev) * 100; return cell((bp > 0 ? "+" : "") + bp.toFixed(1) + "bp", bp > 0 ? C.up : bp < 0 ? C.dn : C.txt, true); };
const rel2 = (x) => (nul(x) ? cell("-", C.sub) : cell((x > 0 ? "+" : "") + x.toFixed(2) + "%p", x > 0 ? C.up : x < 0 ? C.dn : C.txt, true));
const plain = (x) => (nul(x) ? cell("-", C.sub) : cell(Number.isInteger(x) ? String(x) : x.toFixed(1)));
const WC = { 2: ["#1e7d4a", "#7dffb4"], 1: ["#8a5a12", "#ffcf7a"], 0: ["#3a3d46", "#c7ccd6"], "-1": ["#1c4a86", "#9ec6ff"], "-2": ["#14306b", "#7ea6ff"] };
const cW = (w) => { if (nul(w)) return cell("-", C.sub); const c = WC[String(Math.round(w))] || WC[0]; return cell((w > 0 ? "+" : "") + Math.round(w), c[1], true, c[0]); };
const cStage = (x) => (nul(x) ? cell("-", C.sub) : x >= 4 ? cell(String(x), "#7dffb4", true, "#1e7d4a") : x >= 3 ? cell(String(x), "#ffcf7a", true, "#8a5a12") : x >= 1 ? cell(String(x)) : cell("–", C.no));
const c4H = (v) => (v.h4u === 1 ? cell("{F}", "#ffffff", true, "#0fb36b") : v.h4m === 1 ? cell("{o}", C.ok, true) : dash());
const cKel = (kc) => (kc === 1 ? cell("{o}", "#26a86a", false, null, 0.92) : dash());
const cGap = (x) => (nul(x) ? cell("-", C.sub) : cell(x.toFixed(1), x >= 15 ? C.up : x >= 8 ? C.mark : C.txt, x >= 8));
const cT = (x) => (nul(x) ? cell("-", C.sub) : cell(Number.isInteger(x) ? String(x) : x.toFixed(1), x >= 5 ? C.ok : x >= 2 ? C.mark : C.txt, x >= 2));
const mcCell = (r) => (r && r.mt ? cell(r.mt, "#cdd5e6") : dash());   /* 시총 칸: 본주 시총(원화) · ETF는 (순)자산 · 없으면 – */
const eokText = (e, sign) => { if (nul(e)) return "-"; const a = Math.abs(e); return (e < 0 ? "-" : sign && e > 0 ? "+" : "") + (a >= 9.95 ? Math.round(a).toLocaleString("en-US") : a.toFixed(1)); };
const H = { px: "#ffffff", tr: "#6ee7a8", ov: "#ffb066", au: "#8fd6d0", sp: "#f0a7c0" };
/* 표 칸 정의 — repCols 로 켜고 끔. 순서는 스크리너 화면 순서 그대로 */
const COLS = {
  px: ["가격", "r", H.px, (v, r) => cell(r && r.tk === "10Y" ? (nul(v.px) ? "-" : v.px.toFixed(3) + "%") : fmtPx(v.px), null, true)],
  chg: ["등락", "r", H.px, (v, r) => (r && r.tk === "10Y" ? bpCell(v.px, v.prev) : pct(v.chg))],
  ntl: ["억원", "r", H.px, (v) => cell(eokText(v.eok), null, true)],
  mcap: ["시총", "r", H.px, (v, r) => mcCell(r)],
  kel: ["켈", "c", H.tr, (v) => cKel(v.kc)],
  gap: ["이격도", "r", H.ov, (v) => cGap(v.gap)],
  pwr: ["파워", "r", H.ov, (v) => plain(v.pwr)],
  w: ["양W", "c", H.tr, (v) => cW(v.w)],
  h4: ["4H", "c", H.tr, (v) => c4H(v)],
  g3: ["3격", "r", H.ov, (v) => signed(v.g3)],
  g5: ["5격", "r", H.ov, (v) => signed(v.g5)],
  d15s: ["듀선", "c", H.au, (v) => (v.d15s === 1 ? cell("{o}", "#7dffb4", false, null, 0.82) : dash(0.85))],
  d15: ["듀15", "c", H.au, (v) => (v.d15 === 1 ? cell("{o}", "#5ec8c0", false, null, 0.78) : dash(0.85))],
  d30: ["듀30", "c", H.au, (v) => (v.d30 === 1 ? cell("{o}", "#5ec8c0", false, null, 0.78) : dash(0.85))],
  vwap: ["VWAP", "c", H.au, (v) => signed(v.vwap)],
  sqz: ["스퀴즈", "c", H.au, (v) => cStage(v.sqz)],
  jb: ["종배", "c", H.sp, (v) => (v.jb === 1 ? cell("{d}", C.gold) : dash())],
  rv: ["RV", "c", H.au, (v) => cStage(v.rv)],
  kelu: ["켈유", "r", H.sp, (v) => (v.kelu > 0 ? cell(Math.round(v.kelu) + "일", C.mark, true) : dash())],
  cumT: ["누적T", "r", H.sp, (v) => cT(v.cumT)],
};
const isCore = (v) => v.w >= 2 && v.kc === 1 && v.h4m === 1;
const GOLD_ROW = "rgba(245,197,66,0.20)";
/* 요즘 중요한 매크로 6종 — 지수·원자재 박스에서 줄 전체에 은은한 보랏빛 음영(★핵심의 금색과 구분, 너무 튀지 않게) */
const MACRO = new Set(["XYZ100", "SP500", "KR200", "10Y", "CL", "BRENTOIL"]);
const MACRO_ROW = "rgba(150,130,255,0.17)";

/* ───────── 한 줄(종목) 만들기 ───────── */
function wcut(s, w) { let o = "", n = 0; for (const ch of String(s)) { const c = /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1; if (n + c > w) break; o += ch; n += c; } return o; }
const nameOf = (r) => wcut(r.name.replace(/\(.*?\)/g, "").trim(), 12);

/* ───────── 진입 감지 (탬퍼몽키 전환찾기와 같은 규칙) ───────── */
const flagsOf = (v) => { const p = v.w >= 0, p2 = v.w >= 2, kc = v.kc === 1, h4 = v.h4m === 1, hx = v.h4u === 1; return { p, p2, w: v.w, kc, h4, hx, core: p2 && kc && h4 }; };
function transitions(prev, cur) {
  const out = [];
  for (const [k, f] of Object.entries(cur)) {
    const q = prev[k], kinds = [];
    if (!q) { if (f.p2) kinds.push("양W:?>" + f.w); if (f.hx) kinds.push("발산:on"); if (f.core) kinds.push("핵심"); }
    else {
      if (f.w !== q.w && (f.w >= 1 || q.w >= 1)) kinds.push("양W:" + q.w + ">" + f.w);
      if (f.kc && !q.kc) kinds.push("켈:on");
      if (f.h4 && !q.h4) kinds.push("4H:on");
      if (f.hx && !q.hx) kinds.push("발산:on");
      if (f.core && !q.core) kinds.push("핵심");
    }
    if (kinds.length) out.push({ k, kinds });
  }
  return out;
}
const wTxt = (w) => (w === "?" || w == null ? "?" : w > 0 ? "+" + w : String(w));
function entryCell(kinds) {
  const a = kinds.filter((x) => x !== "핵심");
  if (!a.length) return cell("-", C.sub);
  let col = C.acc, hx = false;
  const txt = a.map((x) => {
    if (x.startsWith("발산")) { hx = true; return "4H발산 {o} {>} {F}"; }
    if (x.startsWith("양W:")) { const [q, f] = x.slice(3).split(">"); col = +f >= 2 ? C.ok : +f >= 1 ? "#ffcf7a" : C.dn; return "양W " + wTxt(q === "?" ? "?" : +q) + " {>} " + wTxt(+f); }
    if (x.startsWith("켈")) { if (col === C.acc) col = C.mark; return "켈상단 – {>} {o}"; }
    if (x.startsWith("4H")) { if (col === C.acc) col = C.ok; return "4H – {>} {o}"; }
    return x;
  }).join(" · ");
  return hx ? cell(txt, "#ffffff", true, "#0fb36b") : cell(txt, col, true);
}

/* 코인 리포트(coinreport.mjs)가 같은 모양의 셀·색·진입 감지를 쓰도록 내보냄 */
export const K = { C, H, cell, dash, nul, pct, signed, fmtPx, rel2, plain, cW, cStage, c4H, cKel, cGap, cT, eokText, wcut, WC, mdhm, hm, short, flagsOf, transitions, entryCell, isCore, GOLD_ROW, bpCell };

/* ───────── 메인: 데이터 → 섹션 ───────── */
/* 이름이 같은 종목이 여러 거래소에 있으면 xyz 우선, 아니면 거래대금 큰 쪽(거래가 적은 종목도 놓치지 않게). 없으면 기존 방식 */
function pickCoin(uni, t, info) {
  const a = (info.alias && info.alias[t]) || t, c = uni.filter((r) => r.short === a);
  if (c.length) return c.find((r) => r.dex === "xyz") || c.sort((x, y) => y.dayNtl - x.dayNtl)[0];
  return pickRow(uni, t, info);
}
/* 메인 거래소 perp 이름 + 현물(USDC) 페어 이름(@번호) — KNTQ 처럼 perp 가 아니라 현물인 종목 연결용. 12시간마다 갱신 */
async function resolveRef(S, log) {
  const now = Date.now(); if (S.ref && now - S.ref.t < 12 * 3600e3) return S.ref;
  const meta = await hl({ type: "meta" }, log), sm = await hl({ type: "spotMeta" }, log);
  if (!meta || !sm || !meta.universe || !sm.tokens) return S.ref || { t: 0, perps: [], spot: {} };
  const nameBy = {}; sm.tokens.forEach((t) => { nameBy[t.index] = t.name; });
  const spot = {}; sm.universe.forEach((u) => { const b = nameBy[u.tokens[0]]; if (nameBy[u.tokens[1]] === "USDC" && !(b in spot)) spot[b] = u.name; });
  S.ref = { t: now, perps: meta.universe.map((u) => u.name), spot };
  return S.ref;
}
/* 종목들의 지표 계산 결과(rows)를 모음 — 리포트·섹터 표·챗봇 조회가 함께 씀.
   only = 이 티커들만 / extra = 사이트 관심종목에 없어도 추가 / bars = 이미 메모리에 있는 캔들 저장소(주면 파일 읽기·저장 생략) */
/* 대상 코인 고르기(사이트 관심종목 + 추가 티커 → 하이퍼리퀴드 이름) */
async function pickCoins({ info, uni, S, log, limit, only, extra }) {
  const tickers = []; info.watch.forEach(([, items]) => items.split(",").forEach((t) => { if (t && !tickers.includes(t)) tickers.push(t); }));   /* 10Y(금리) 포함, 관심종목 전부 */
  (extra || []).forEach((t) => { if (t && !tickers.includes(t)) tickers.push(t); });
  const ref = await resolveRef(S, log);
  let coins = tickers.filter((t) => !only || only.includes(t)).map((t) => { const r = pickCoin(uni, t, info); if (!r) return null; let full = r.full; if (r.dex === "코인" && ref.perps.length && !ref.perps.includes(full) && ref.spot[full]) full = ref.spot[full]; return { tk: t, full }; }).filter(Boolean);
  const seen = new Set(); coins = coins.filter((c) => (seen.has(c.full) ? false : (seen.add(c.full), true)));
  if (limit) coins = coins.slice(0, limit);
  return coins;
}
/* 챗봇 백그라운드: 캔들만 조금씩 갱신(계산 없음) */
export async function refreshBars({ info, uni, bars, log, deadline }) {
  const coins = await pickCoins({ info, uni, S: bars, log });
  return ensureBars(bars, coins, { deadline, log, par: 3 });
}
export async function collectRows({ info, uni, fx, cacheDir, log, deadline, limit, only, extra, bars }) {
  const now = Date.now();
  const S = bars || loadBars(cacheDir), coins = await pickCoins({ info, uni, S, log, limit, only, extra });
  /* 캔들 받기(예산 안에서) → 저장 → 지금 가격 끼우기 */
  const st0 = await ensureBars(S, coins, { deadline, log });
  if (!bars) saveBars(cacheDir, S);
  const mids = await fetchMids(coins, log);
  patchLive(S, coins, mids, now);
  const rows = [];
  coins.forEach((c) => {
    const e = S.c[c.full]; if (!e) return; const v = calcCoin(e, now); if (!v) return;
    v.eok = v.usd * fx / 1e8;
    const kn = splitKo(c.tk, (info.koFull || info.ko || {})[c.tk] || (info.ko || {})[c.tk], (info.sectorOf || {})[c.tk] ? String(info.sectorOf[c.tk]).replace(/\s*\(.*?\)/g, "") : "");
    rows.push({ tk: c.tk, full: c.full, name: kn.name, sec: kn.sec || "-", v, stock: isStock(c.tk), e });
  });
  return { S, coins, rows, st0, now, mids };
}
export const rowFlags = flagsOf;
export const rowIsCore = isCore;

/* 섹터·테마 표 한 장: 고른 종목들을 (가격·등락·억원 + 설정한 표 칸)으로 보여 줌. 챗봇의 '메모리 대장주' 같은 요청용 */
export async function buildListReport({ title, sub, tickers, cfg, info, uni, fx, cacheDir, log, deadline, bars }) {
  const { rows, coins, st0, now } = await collectRows({ info, uni, fx, cacheDir, log, deadline, only: tickers, extra: tickers, bars });
  const colIds = (Array.isArray(cfg.repCols) ? cfg.repCols : COL_IDS.filter((c) => c !== "px")).filter((c) => COL_IDS.includes(c));
  const ids = ["px", "chg", "ntl"].concat(colIds.filter((c) => !["px", "chg", "ntl", "mcap"].includes(c)));
  const byTk = Object.fromEntries(rows.map((r) => [r.tk, r]));
  const ordered = tickers.map((t) => byTk[t]).filter(Boolean);
  const missing = tickers.filter((t) => !byTk[t]);
  const cols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"]].concat(ids.map((id) => [COLS[id][0], COLS[id][1], COLS[id][2]]));
  const sec = { index: true, title: title + " · " + ordered.length + "종목", sub, empty: "— 계산 가능한 종목 없음 —", cols,
    rowbg: ordered.map((r) => (isCore(r.v) ? GOLD_ROW : null)),
    rows: ordered.map((r, i) => [cell(i + 1, "#9fb3d9"), cell(r.tk, "#dce6f7", true), cell(nameOf(r), "#dce6f7"), cell(wcut(r.sec, 14), C.sub)].concat(ids.map((id) => COLS[id][3](r.v, r))) ,),
    notes: missing.length ? ["데이터 없음: " + missing.join(", ")] : [] };
  const header = { title: "TM 섹터 표 · " + hm(now), sub: mdhm(now) + " · 1$=" + Math.round(fx).toLocaleString("en-US") + "원 환산 · 억원=한화 · 금색 줄 = {S}핵심(양W +2 + 켈상단 + 4H켈중심) · {F} = 4H발산 · {o} = 충족" };
  return { sections: [sec], header, foot: "데이터: 하이퍼리퀴드 캔들 · 거래대금은 하이퍼리퀴드 체결 기준 · 지표 정의는 TM Matrix Screener v48.9 와 동일", caption: "🗂 " + title + " · " + ordered.length + "종목 · " + hm(now), meta: { ok: ordered.length, total: coins.length, left: st0 ? st0.left : 0 }, rows: ordered };
}

export async function buildReport({ cfg, info, uni, fx, cacheDir, log, deadline, limit, only, bars, stateIO, mcap }) {
  const order = (Array.isArray(cfg.repOrder) ? cfg.repOrder : BLOCK_IDS).filter((b, i, arr) => BLOCK_IDS.includes(b) && arr.indexOf(b) === i);
  BLOCK_IDS.forEach((b) => { if (!order.includes(b)) order.push(b); });
  const off = new Set(Array.isArray(cfg.repOff) ? cfg.repOff : []), blocks = order.filter((b) => !off.has(b));   /* repOrder = 전체 순서, repOff = 끈 항목 */
  const colIds = (Array.isArray(cfg.repCols) ? cfg.repCols : COL_IDS.filter((c) => c !== "px")).filter((c) => COL_IDS.includes(c));   /* 가격 칸은 기본 꺼짐(지수·원자재 박스에는 항상 들어감) */
  if (!colIds.includes("mcap")) colIds.splice(colIds.includes("ntl") ? colIds.indexOf("ntl") + 1 : 0, 0, "mcap");   /* 시총 칸은 켜고 끄는 설정 없이 항상 억원 바로 오른쪽 */
  const allRows = Math.min(100, Math.max(10, +cfg.repRows || 45)), surgeMin = [5, 15, 30, 60].includes(+cfg.repSurge) ? +cfg.repSurge : 15;
  const { rows, coins, st0, now } = await collectRows({ info, uni, fx, cacheDir, log, deadline, limit, only, bars });
  rows.forEach((r) => { r.mt = mcapText(mcap, r, fx); });
  const cover = rows.length / Math.max(1, coins.length);
  const meta = { total: coins.length, ok: rows.length, cover, left: st0 ? st0.left : 0, fetched: st0 ? st0.fetched : 0 };
  if (rows.length < 20 || cover < 0.8) return { skip: "데이터 준비 중 (" + rows.length + "/" + coins.length + "종목 계산 가능 · 남은 받기 " + meta.left + "건)", meta };
  const pass = rows.filter((r) => r.v.w >= 0), core = rows.filter((r) => isCore(r.v));
  const byEok = (a, b) => b.v.eok - a.v.eok;
  /* 진입 상태 */
  const stFile = path.join(cacheDir, "rep_state.json");
  let S2 = { flags: {}, log: [], day: "", cnt: {}, passed: [] }; try { S2 = Object.assign(S2, JSON.parse(fs.readFileSync(stFile, "utf8"))); } catch (e) {}
  if (stateIO) { try { const rs = await stateIO.read(); if (rs && rs.t && rs.t >= (S2.t || 0)) S2 = Object.assign(S2, rs); } catch (e) {} }   /* 챗봇·사슬이 같은 '진입 기록'을 공유(더 최근 것 사용) */
  const cur = {}; rows.forEach((r) => { cur[r.tk] = flagsOf(r.v); });
  const baseline = Object.keys(S2.flags).length >= 20;
  if (baseline) { transitions(S2.flags, cur).forEach((x) => { S2.log.unshift({ k: x.k, t: now, kinds: x.kinds }); }); S2.log = S2.log.slice(0, 80); }
  const prevPassed = new Set(S2.passed || []), nowPassed = pass.map((r) => r.tk);
  const newIn = baseline ? nowPassed.filter((t) => !prevPassed.has(t)) : [], gone = baseline ? [...prevPassed].filter((t) => !nowPassed.includes(t)) : [];
  S2.flags = cur; S2.passed = nowPassed; S2.t = now;
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(stFile, JSON.stringify(S2)); } catch (e) {}
  if (stateIO) { try { await stateIO.write(S2); } catch (e) {} }

  /* ── 섹션들 ── */
  const indCols = colIds.map((id) => [COLS[id][0], COLS[id][1], COLS[id][2]]);
  const indCells = (v, r) => colIds.map((id) => COLS[id][3](v, r));
  const bigCols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"]].concat(indCols);
  const bigRow = (r, i, star) => [cell(i + 1, star ? C.gold : C.sub, star), cell((star ? "{S}" : "") + r.tk, star ? "#ffffff" : null, true), cell(nameOf(r), star ? "#ffffff" : null), cell(wcut(r.sec, 14), C.sub)].concat(indCells(r.v, r));
  const mini = [["#", "c"], ["종목", "l"], ["이름", "l"], ["등락", "r"], ["억원", "r"], ["시총", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]];
  const miniRow = (r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r)), pct(r.v.chg), cell(eokText(r.v.eok)), mcCell(r), cW(r.v.w), cKel(r.v.kc), c4H(r.v)];
  const goldBg = (list) => list.map((r) => (isCore(r.v) ? GOLD_ROW : null));
  const sec = {};
  const topN = (title, list, extraSub, cols, fn) => ({ half: true, title, sub: extraSub, empty: "— 해당 없음 —", cols, rowbg: goldBg(list), rows: list.map(fn) });

  sec.core = () => { const l = core.slice().sort(byEok), s = l.slice(0, 5); return { feature: true, title: "{S} 핵심 · 켈상단 + 4H켈중심", sub: l.length + "종목 중 · 양W +2 + 켈상단 + 4H켈중심", empty: "— 지금 조건 충족 종목 없음 —", cols: bigCols, rowbg: undefined, rows: s.map((r, i) => bigRow(r, i, true)) }; };
  sec.index = () => {
    /* 지수 5 + 원자재 8 은 거래대금과 무관하게 항상(고정), 그 밖의 비주식은 거래대금 큰 순으로 뒤에. 가격 칸은 항상 맨 앞 — 코스피·금리 수준을 바로 보게 */
    const non = rows.filter((r) => !r.stock), fixed = FIXED_INDEX.map((t) => non.find((r) => r.tk === t)).filter(Boolean);
    const rest = non.filter((r) => !FIXED_INDEX.includes(r.tk)).sort(byEok).slice(0, 4), l = fixed.concat(rest);
    const ids = ["px"].concat(colIds.filter((c) => c !== "px" && c !== "mcap"));   /* 지수·원자재 박스에는 시총 칸 없음 */
    const cols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"]].concat(ids.map((id) => [COLS[id][0], COLS[id][1], COLS[id][2]]));
    return { index: true, title: "지수 · 원자재", sub: "시장 기준 (고정) · 가격 포함 · 미국10년물은 금리(%)·등락은 bp · 보랏빛 줄 = 핵심 매크로 6종", empty: "— 없음 —", cols, rowbg: l.map((r) => (MACRO.has(r.tk) ? MACRO_ROW : null)), rows: l.map((r, i) => [cell(i + 1, "#9fb3d9"), cell(r.tk, "#dce6f7", true), cell(nameOf(r), "#dce6f7"), cell(wcut(r.sec, 14), C.sub)].concat(ids.map((id) => COLS[id][3](r.v, r)))) };
  };
  sec.all = () => {
    const l = pass.filter((r) => r.stock).sort((a, b) => (b.v.w - a.v.w) || byEok(a, b)), s = l.slice(0, allRows);
    return { title: "전종목 " + s.length + (l.length > s.length ? " / " + l.length : ""), sub: "개별주 · 양W 2→1→0 · 그룹 안 대금순" + (l.length > s.length ? " · 상위 " + allRows : "") + " · {F} = 4H발산(켈상단) · 금색 줄 = {S}핵심", cols: bigCols, rowbg: goldBg(s), rows: s.map((r, i) => bigRow(r, i, isCore(r.v))), empty: "— 조건 충족 종목 없음 —" };
  };
  sec.topVol = () => { const l = pass.filter((r) => r.stock).sort(byEok); return topN("① 거래대금 TOP5", l.slice(0, 5), l.length + "종목 중", mini, miniRow); };
  sec.topChg = () => { const l = rows.filter((r) => r.stock && !nul(r.v.chg)).sort((a, b) => b.v.chg - a.v.chg); return topN("② 등락률 TOP5", l.slice(0, 5), "개별주 기준", mini, miniRow); };
  sec.topKel = () => { const l = pass.filter((r) => r.v.kc === 1).sort(byEok); return topN("③ 켈상단 돌파 · 대금 TOP5", l.slice(0, 5), l.length + "종목 중", mini, miniRow); };
  sec.topStreak = () => {
    const l = pass.filter((r) => r.v.kelu > 0).sort((a, b) => (b.v.kelu - a.v.kelu) || byEok(a, b));
    const cols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["켈유", "r"], ["등락", "r"], ["억원", "r"], ["시총", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]];
    return topN("④ 켈유 TOP5", l.slice(0, 5), l.length + "종목 중", cols, (r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r)), cell(Math.round(r.v.kelu) + "일", C.mark, true), pct(r.v.chg), cell(eokText(r.v.eok)), mcCell(r), cW(r.v.w), cKel(r.v.kc), c4H(r.v)]);
  };
  sec.recent = () => {
    const seenT = new Set(), l = [];
    for (const e of S2.log) { if (seenT.has(e.k)) continue; seenT.add(e.k); l.push(e); if (l.length >= 5) break; }
    const byTk = Object.fromEntries(rows.map((r) => [r.tk, r])), hxN = l.filter((e) => e.kinds.some((k) => k.startsWith("발산"))).length;
    const s = { half: true, title: "⑤ 최근 진입 5" + (hxN ? " · {F}" + hxN : ""), sub: "무엇에 진입했나", empty: "— 아직 진입 기록 없음 —", notes: l.length ? ["변화 읽는 법: 왼쪽 = 이전 값, 오른쪽 = 지금 값 · 금색 줄 = 지금 {S}핵심 종목"] : [],
      cols: [["#", "c"], ["시각", "l"], ["종목", "l"], ["이름", "l"], ["진입", "c"], ["등락", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]] };
    s.rowbg = l.map((e) => (byTk[e.k] && isCore(byTk[e.k].v) ? GOLD_ROW : null));
    s.rows = l.map((e, i) => { const r = byTk[e.k]; return [cell(i + 1, C.sub), cell(short(e.t), C.sub), cell(e.k, null, true), cell(r ? nameOf(r) : e.k), entryCell(e.kinds), r ? pct(r.v.chg) : cell("-", C.sub), r ? cW(r.v.w) : cell("-", C.sub), r ? cKel(r.v.kc) : dash(), r ? c4H(r.v) : dash()]; });
    return s;
  };
  sec.surge = () => {
    const list = [];
    pass.forEach((r) => { const c = changeOver(r.e, surgeMin, now); if (c) list.push({ r, pct: c.pct, usd: c.usd }); });
    const med = (() => { const a = list.map((x) => x.pct).sort((x, y) => x - y); return a.length >= 3 ? a[Math.floor(a.length / 2)] : 0; })();
    list.forEach((x) => { x.rel = x.pct - med; });
    const top = list.filter((x) => Math.abs(x.rel) >= 0.01).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel) || b.usd - a.usd).slice(0, 5);
    const s = { half: true, title: "⑥ 급변동 TOP5 (" + surgeMin + "분)", sub: hm(now - surgeMin * 60000) + "→" + hm(now) + " · 시장 " + (med >= 0 ? "+" : "") + med.toFixed(2) + "%p", empty: "— 시장 대비 튀는 종목 없음 —", notes: [],
      cols: [["#", "c"], ["종목", "l"], ["이름", "l"], ["상대변동", "r"], ["유입억원", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]] };
    s.rowbg = goldBg(top.map((x) => x.r));
    s.rows = top.map((x, i) => [cell(i + 1, C.sub), cell(x.r.tk, null, true), cell(nameOf(x.r)), rel2(x.rel), cell(eokText(x.usd * fx / 1e8, true), null, true), cW(x.r.v.w), cKel(x.r.v.kc), c4H(x.r.v)]);
    s.notes.push("시장 중앙값 " + (med >= 0 ? "+" : "") + med.toFixed(2) + "%p 대비 · 최근 " + surgeMin + "분 · " + list.length + "종목 비교");
    if (newIn.length) s.notes.push("+ 전종목 표 신규 진입: " + newIn.slice(0, 8).join(", ") + (newIn.length > 8 ? " 외 " + (newIn.length - 8) : ""));
    if (gone.length) s.notes.push("- 이탈: " + gone.slice(0, 8).join(", ") + (gone.length > 8 ? " 외 " + (gone.length - 8) : ""));
    return s;
  };
  sec.sum = () => {
    const kc = rows.filter((r) => r.v.kc === 1).length, hx = rows.filter((r) => r.v.h4u === 1).length, w2 = rows.filter((r) => r.v.w >= 2).length, sq = rows.filter((r) => r.v.sqz >= 3).length;
    const recent30 = new Set(S2.log.filter((e) => now - e.t <= 30 * 60000).map((e) => e.k)).size;
    return { kind: "chips", chips: [
      { label: "{S}핵심", value: core.length, color: C.gold, bg: "#3a3218" }, { label: "켈 돌파", value: kc, color: "#26d07c" }, { label: "{F}4H 발산", value: hx, color: "#ffab40" },
      { label: "양W +2", value: w2, color: "#7dffb4" }, { label: "스퀴즈 3", value: sq, color: "#ffcf7a" }, { label: "30분 내 진입", value: recent30, color: C.mark } ] };
  };
  const sections = blocks.map((b) => (sec[b] ? sec[b]() : null)).filter(Boolean);
  const header = { title: "TM Daily Report · " + hm(now),
    sub: mdhm(now) + " · " + pass.length + "종목 (수집 " + rows.length + ") · 1$=" + Math.round(fx).toLocaleString("en-US") + "원 환산 · 억원=한화 · 등락=전일대비 · {o}=충족 · {F}=4H 켈트너 상단 위(발산)" };
  const foot = "데이터: 하이퍼리퀴드 캔들(일봉 = 한국 09:00 기준) · 거래대금은 하이퍼리퀴드 체결 기준 · 지표 정의는 TM Matrix Screener v48.9 와 동일 · 진입은 리포트를 만들 때마다 직전과 비교";
  const caption = "📋 TM Daily Report · " + hm(now) + " · " + pass.length + "종목 (수집 " + rows.length + ") · ★핵심 " + core.length + (S2.log.length ? " · 최근 진입 " + S2.log[0].k : "");
  return { sections, header, foot, caption, ent: S2.log.slice(0, 40), meta: Object.assign(meta, { pass: pass.length, core: core.length }) };
}
