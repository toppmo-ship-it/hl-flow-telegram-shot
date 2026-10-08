/* 하이퍼 리포트 — 데이터 모으기 → 섹션 만들기 (그리는 일은 rep-render.js 가 함)
   탬퍼몽키 스크리너의 3분 리포트(★핵심 · 지수·원자재 · 전종목 · TOP5 4종 · 최근 진입 · 급변동)를 같은 구성으로 만듦.
   설정(tg_shot_cfg): rep(켬/끔) · repEvery(분) · repOrder(항목 순서, 위→아래) · repOff(끈 항목) · repCols(표 칸) · repRows(전종목 줄 수) · repSurge(급변동 구간, 분) */
import fs from "node:fs";
import path from "node:path";
import { pickRow } from "./extras.mjs";
import { splitKo, isStock, FIXED_INDEX } from "./repnames.mjs";
import { loadBars, saveBars, ensureBars, patchLive, fetchMids, calcCoin, changeOver } from "./repcalc.mjs";

export const BLOCK_IDS = ["sum", "core", "index", "all", "topVol", "topChg", "topKel", "topStreak", "recent", "surge"];
export const COL_IDS = ["chg", "ntl", "kel", "gap", "pwr", "w", "h4", "g3", "g5", "d15s", "d15", "d30", "vwap", "sqz", "jb", "rv", "kelu", "cumT"];
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
const rel2 = (x) => (nul(x) ? cell("-", C.sub) : cell((x > 0 ? "+" : "") + x.toFixed(2) + "%p", x > 0 ? C.up : x < 0 ? C.dn : C.txt, true));
const plain = (x) => (nul(x) ? cell("-", C.sub) : cell(Number.isInteger(x) ? String(x) : x.toFixed(1)));
const WC = { 2: ["#1e7d4a", "#7dffb4"], 1: ["#8a5a12", "#ffcf7a"], 0: ["#3a3d46", "#c7ccd6"], "-1": ["#1c4a86", "#9ec6ff"], "-2": ["#14306b", "#7ea6ff"] };
const cW = (w) => { if (nul(w)) return cell("-", C.sub); const c = WC[String(Math.round(w))] || WC[0]; return cell((w > 0 ? "+" : "") + Math.round(w), c[1], true, c[0]); };
const cStage = (x) => (nul(x) ? cell("-", C.sub) : x >= 4 ? cell(String(x), "#7dffb4", true, "#1e7d4a") : x >= 3 ? cell(String(x), "#ffcf7a", true, "#8a5a12") : x >= 1 ? cell(String(x)) : cell("–", C.no));
const c4H = (v) => (v.h4u === 1 ? cell("{F}", "#ffffff", true, "#0fb36b") : v.h4m === 1 ? cell("{o}", C.ok, true) : dash());
const cKel = (kc) => (kc === 1 ? cell("{o}", "#26a86a", false, null, 0.92) : dash());
const cGap = (x) => (nul(x) ? cell("-", C.sub) : cell(x.toFixed(1), x >= 15 ? C.up : x >= 8 ? C.mark : C.txt, x >= 8));
const cT = (x) => (nul(x) ? cell("-", C.sub) : cell(Number.isInteger(x) ? String(x) : x.toFixed(1), x >= 5 ? C.ok : x >= 2 ? C.mark : C.txt, x >= 2));
const eokText = (e, sign) => { if (nul(e)) return "-"; const a = Math.abs(e); return (e < 0 ? "-" : sign && e > 0 ? "+" : "") + (a >= 9.95 ? Math.round(a).toLocaleString("en-US") : a.toFixed(1)); };
const H = { px: "#ffffff", tr: "#6ee7a8", ov: "#ffb066", au: "#8fd6d0", sp: "#f0a7c0" };
/* 표 칸 정의 — repCols 로 켜고 끔. 순서는 스크리너 화면 순서 그대로 */
const COLS = {
  chg: ["등락", "r", H.px, (v) => pct(v.chg)],
  ntl: ["억원", "r", H.px, (v) => cell(eokText(v.eok), null, true)],
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

/* ───────── 메인: 데이터 → 섹션 ───────── */
export async function buildReport({ cfg, info, uni, fx, cacheDir, log, deadline, limit }) {
  const now = Date.now();
  const order = (Array.isArray(cfg.repOrder) ? cfg.repOrder : BLOCK_IDS).filter((b, i, arr) => BLOCK_IDS.includes(b) && arr.indexOf(b) === i);
  BLOCK_IDS.forEach((b) => { if (!order.includes(b)) order.push(b); });
  const off = new Set(Array.isArray(cfg.repOff) ? cfg.repOff : []), blocks = order.filter((b) => !off.has(b));   /* repOrder = 전체 순서, repOff = 끈 항목 */
  const colIds = (Array.isArray(cfg.repCols) ? cfg.repCols : COL_IDS).filter((c) => COL_IDS.includes(c));
  const allRows = Math.min(100, Math.max(10, +cfg.repRows || 45)), surgeMin = [5, 15, 30, 60].includes(+cfg.repSurge) ? +cfg.repSurge : 15;
  /* 대상 종목: 사이트 관심종목 전부(코인·지수·원자재 포함). 10Y(금리)는 제외 */
  const tickers = []; info.watch.forEach(([, items]) => items.split(",").forEach((t) => { if (t && t !== "10Y" && !tickers.includes(t)) tickers.push(t); }));
  let coins = tickers.map((t) => { const r = pickRow(uni, t, info); return r ? { tk: t, full: r.full } : null; }).filter(Boolean);
  const seen = new Set(); coins = coins.filter((c) => (seen.has(c.full) ? false : (seen.add(c.full), true)));
  if (limit) coins = coins.slice(0, limit);
  /* 캔들 받기(예산 안에서) → 저장 → 지금 가격 끼우기 */
  const S = loadBars(cacheDir);
  const st0 = await ensureBars(S, coins, { deadline, log });
  saveBars(cacheDir, S);
  const mids = await fetchMids(coins, log);
  patchLive(S, coins, mids, now);
  const rows = [];
  coins.forEach((c) => {
    const e = S.c[c.full]; if (!e) return; const v = calcCoin(e, now); if (!v) return;
    v.eok = v.usd * fx / 1e8;
    const kn = splitKo(c.tk, (info.koFull || info.ko || {})[c.tk] || (info.ko || {})[c.tk], (info.sectorOf || {})[c.tk] ? String(info.sectorOf[c.tk]).replace(/\s*\(.*?\)/g, "") : "");
    rows.push({ tk: c.tk, full: c.full, name: kn.name, sec: kn.sec || "-", v, stock: isStock(c.tk), e });
  });
  const cover = rows.length / Math.max(1, coins.length);
  const meta = { total: coins.length, ok: rows.length, cover, left: st0 ? st0.left : 0, fetched: st0 ? st0.fetched : 0 };
  if (rows.length < 20 || cover < 0.8) return { skip: "데이터 준비 중 (" + rows.length + "/" + coins.length + "종목 계산 가능 · 남은 받기 " + meta.left + "건)", meta };
  const pass = rows.filter((r) => r.v.w >= 0), core = rows.filter((r) => isCore(r.v));
  const byEok = (a, b) => b.v.eok - a.v.eok;
  /* 진입 상태 */
  const stFile = path.join(cacheDir, "rep_state.json");
  let S2 = { flags: {}, log: [], day: "", cnt: {}, passed: [] }; try { S2 = Object.assign(S2, JSON.parse(fs.readFileSync(stFile, "utf8"))); } catch (e) {}
  const cur = {}; rows.forEach((r) => { cur[r.tk] = flagsOf(r.v); });
  const baseline = Object.keys(S2.flags).length >= 20;
  if (baseline) { transitions(S2.flags, cur).forEach((x) => { S2.log.unshift({ k: x.k, t: now, kinds: x.kinds }); }); S2.log = S2.log.slice(0, 80); }
  const prevPassed = new Set(S2.passed || []), nowPassed = pass.map((r) => r.tk);
  const newIn = baseline ? nowPassed.filter((t) => !prevPassed.has(t)) : [], gone = baseline ? [...prevPassed].filter((t) => !nowPassed.includes(t)) : [];
  S2.flags = cur; S2.passed = nowPassed; S2.t = now;
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(stFile, JSON.stringify(S2)); } catch (e) {}

  /* ── 섹션들 ── */
  const indCols = colIds.map((id) => [COLS[id][0], COLS[id][1], COLS[id][2]]);
  const indCells = (v) => colIds.map((id) => COLS[id][3](v));
  const bigCols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"]].concat(indCols);
  const bigRow = (r, i, star) => [cell(i + 1, star ? C.gold : C.sub, star), cell((star ? "{S}" : "") + r.tk, star ? "#ffffff" : null, true), cell(nameOf(r), star ? "#ffffff" : null), cell(wcut(r.sec, 14), C.sub)].concat(indCells(r.v));
  const mini = [["#", "c"], ["종목", "l"], ["이름", "l"], ["등락", "r"], ["억원", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]];
  const miniRow = (r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r)), pct(r.v.chg), cell(eokText(r.v.eok)), cW(r.v.w), cKel(r.v.kc), c4H(r.v)];
  const goldBg = (list) => list.map((r) => (isCore(r.v) ? GOLD_ROW : null));
  const sec = {};
  const topN = (title, list, extraSub, cols, fn) => ({ half: true, title, sub: extraSub, empty: "— 해당 없음 —", cols, rowbg: goldBg(list), rows: list.map(fn) });

  sec.core = () => { const l = core.slice().sort(byEok), s = l.slice(0, 5); return { feature: true, title: "핵심 · 켈상단 + 4H켈중심", sub: l.length + "종목 중 · 양W +2 + 켈상단 + 4H켈중심", empty: "— 지금 조건 충족 종목 없음 —", cols: bigCols, rowbg: undefined, rows: s.map((r, i) => bigRow(r, i, true)) }; };
  sec.index = () => {
    const non = rows.filter((r) => !r.stock), fixed = FIXED_INDEX.map((t) => non.find((r) => r.tk === t)).filter(Boolean);
    const rest = non.filter((r) => !FIXED_INDEX.includes(r.tk)).sort(byEok).slice(0, 6), l = fixed.concat(rest);
    return { index: true, title: "지수 · 원자재", sub: "시장 기준 (고정)", empty: "— 없음 —", cols: bigCols, rows: l.map((r, i) => [cell(i + 1, "#9fb3d9"), cell(r.tk, "#dce6f7", true), cell(nameOf(r), "#dce6f7"), cell(wcut(r.sec, 14), C.sub)].concat(indCells(r.v))) };
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
    const cols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["켈유", "r"], ["등락", "r"], ["억원", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]];
    return topN("④ 켈유 TOP5", l.slice(0, 5), l.length + "종목 중", cols, (r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r)), cell(Math.round(r.v.kelu) + "일", C.mark, true), pct(r.v.chg), cell(eokText(r.v.eok)), cW(r.v.w), cKel(r.v.kc), c4H(r.v)]);
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
  return { sections, header, foot, caption, meta: Object.assign(meta, { pass: pass.length, core: core.length }) };
}
