/* 텔레그램 챗봇 — 방에 쓴 글(종목·섹터·명령어)을 읽고 차트/표/글로 답함. GitHub Actions 에서 약 5시간 40분씩 이어달리기(chat.yml).
   - 읽기: getUpdates 롱폴링(웹훅 아님). 이 방(TG_CHAT_ID) 글만 처리, 다른 방은 무시
   - 카드: extras.mjs 의 buildCardData/renderCard (주기 카드와 같은 그림), 섹터 표·리포트: report.mjs + rep-render.js
   - 가격흐름: shot.mjs 를 SHOT_ONLY=flow 로 따로 실행
   - 설정 변경: Supabase tg_shot_cfg 를 읽고-고치고-씀 (설정 페이지와 같은 값)
   환경변수: TG_BOT_TOKEN, TG_CHAT_ID, BOT_MAX_MIN(실행 분, 기본 335), BOT_DRY=1(전송·저장 안 함: 화면 출력·파일로만), BOT_INPUT=파일(줄마다 한 글 — 시험용), CHROME_PATH */
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSiteInfo, loadUniverse, usdKrw, pickRow, buildCardData, renderCard, flushCardCache, applyCardCfg, hl, buildWeeklyTexts, buildSurgeText, buildPatternRankText } from "./extras.mjs";
import { buildReport, buildListReport, collectRows, refreshBars } from "./report.mjs";
import { loadBars, saveBars, stripLive, changeOver } from "./repcalc.mjs";
import { FIXED_INDEX, KO } from "./repnames.mjs";
import { sbGet, sbPut } from "./sb.mjs";
import { norm, secName, parseCommand, parseRequest, parseEvery, snapEvery, everyKo, buildIndex, resolveSectors, IV_KO, MAX_CARDS, MAX_TABLE } from "./chatparse.mjs";
import * as F from "./chatfmt.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url)), SITE = path.join(ROOT, "site"), CACHE = path.join(ROOT, ".cache");
const DRY = /^(1|true)$/i.test(process.env.BOT_DRY || "");
const MAX_MS = (+process.env.BOT_MAX_MIN || 335) * 60000, T_START = Date.now();
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const TOKEN = clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, ""), CHAT = clean(process.env.TG_CHAT_ID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const W = async (k, v) => { if (DRY) { log("[dry] 저장 생략", k, JSON.stringify(v).slice(0, 120)); return true; } return sbPut(k, v); };   /* 시험 중에는 운영 DB에 쓰지 않음 */

/* ───────────────── 텔레그램 입출력 ───────────────── */
let outN = 0;
const OUT = path.join(ROOT, "out_chat");
async function tg(method, payload, isForm) {
  if (DRY) return { ok: true, result: { message_id: ++outN } };
  for (let a = 0; a < 3; a++) {
    try {
      const sig = AbortSignal.timeout(method === "getUpdates" ? 70000 : 60000);
      const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, isForm ? { method: "POST", body: payload, signal: sig } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}), signal: sig });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { const w = Math.min(60, +(j.parameters && j.parameters.retry_after) || 5); log("텔레그램 429 — " + w + "초 대기"); await sleep((w + 1) * 1000); if (isForm) return { ok: false, description: "429" }; continue; }
      return j;
    } catch (e) { if (a === 2) return { ok: false, description: String((e && e.message) || e) }; await sleep(1500); }
  }
  return { ok: false };
}
async function say(text, extra) {
  const chunks = []; let cur = "";
  for (const ln of String(text).split("\n")) { if ((cur + "\n" + ln).length > 3800) { chunks.push(cur); cur = ln; } else cur = cur ? cur + "\n" + ln : ln; }
  if (cur) chunks.push(cur);
  let last = null;
  for (let i = 0; i < chunks.length; i++) {
    if (DRY) { console.log("\n┌─ 봇 답장 ─────────────\n" + chunks[i].replace(/<\/?[a-z]+[^>]*>/g, "") + (extra && i === chunks.length - 1 ? "\n└─ [버튼] " + JSON.stringify(extra).slice(0, 200) : "\n└──────────────")); outN++; continue; }
    last = await tg("sendMessage", { chat_id: CHAT, text: chunks[i], parse_mode: "HTML", disable_web_page_preview: true, ...(i === chunks.length - 1 && extra ? { reply_markup: extra } : {}) });
    if (!last.ok) { log("전송 실패", last.description); last = await tg("sendMessage", { chat_id: CHAT, text: chunks[i].replace(/<\/?[a-z]+[^>]*>/g, ""), disable_web_page_preview: true }); }   /* HTML 오류면 태그 없이 다시 */
  }
  return last && last.result && last.result.message_id;
}
async function photo(buf, caption, markup) {
  if (DRY) { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, String(++outN).padStart(2, "0") + ".png"); fs.writeFileSync(f, buf); console.log("\n┌─ 봇 사진 ─ " + f + " (" + Math.round(buf.length / 1024) + "KB)\n" + String(caption || "").replace(/<\/?[a-z]+[^>]*>/g, "") + "\n└──────────────"); return outN; }
  const send = async (asDoc) => { const f = new FormData(); f.append("chat_id", CHAT); if (caption) { f.append("caption", String(caption).slice(0, 1000)); } if (markup) f.append("reply_markup", JSON.stringify(markup)); f.append(asDoc ? "document" : "photo", new Blob([buf], { type: "image/png" }), asDoc ? "chart.png" : "chart.png"); return tg(asDoc ? "sendDocument" : "sendPhoto", f, true); };
  let j = await send(false);
  if (!j.ok && /429|Too Many/i.test(String(j.description))) { await sleep(8000); j = await send(false); }
  if (!j.ok) { log("사진 전송 실패", j.description); throw new Error("사진 전송 실패: " + j.description); }
  return j.result.message_id;
}
const action = (a) => (DRY ? null : tg("sendChatAction", { chat_id: CHAT, action: a || "upload_photo" }));
const delMsg = (id) => (DRY || !id ? null : tg("deleteMessage", { chat_id: CHAT, message_id: id }));

/* ───────────────── 공용 자료 (시작할 때 한 번 + 주기 갱신) ───────────────── */
const C = { info: null, uni: [], fx: 1350, idx: null, bars: null, uniAt: 0, fxAt: 0, themes: {}, snap: null, snapAt: 0, busy: 0, up: Date.now() };
async function loadCtx(force) {
  const now = Date.now();
  if (!C.info) C.info = loadSiteInfo(SITE);
  if (force || !C.uni.length || now - C.uniAt > 8 * 60000) { const u = await loadUniverse(() => {}); if (u.length) { C.uni = u; C.uniAt = now; C.idx = null; } }
  if (force || now - C.fxAt > 30 * 60000) { C.fx = await usdKrw(() => {}); C.fxAt = now; }
  if (!C.bars) { C.bars = loadBars(CACHE); log("캔들 저장소", Object.keys(C.bars.c || {}).length + "종목 (파일에서)"); }
  const th = await sbGet("tg_bot_themes"); C.themes = th && typeof th === "object" ? th : (C.themes || {});
  if (!C.idx) C.idx = buildIndex(C.info, C.uni.map((r) => r.short), Object.values(C.themes).flat());
}
const cfgGet = async () => (await sbGet("tg_shot_cfg")) || {};
const cardCfg = (c) => c;   /* (가독용) */

/* 모든 종목 계산 결과 — 45초 안이면 재사용. 캔들은 백그라운드가 계속 채워 두므로 보통 빠름 */
async function snapshot(maxAgeMs, waitMs) {
  if (C.snap && Date.now() - C.snapAt < (maxAgeMs == null ? 45000 : maxAgeMs)) return C.snap;
  C.busy++;
  try {
    await loadCtx();
    const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + (waitMs || 20000), bars: C.bars });
    C.snap = r; C.snapAt = Date.now();
    return r;
  } finally { C.busy--; }
}
const rowsByTk = (rows) => Object.fromEntries(rows.map((r) => [r.tk, r]));

/* ───────────────── 그리기 (크롬 한 개를 계속 씀, 10분 놀면 닫음) ───────────────── */
let SRV = null, BR = null, brUse = 0, brIdle = null;
async function server() {
  if (SRV) return SRV;
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".txt": "text/plain" };
  const s = http.createServer((q, r) => { try { const f = path.resolve(path.join(SITE, decodeURIComponent(new URL(q.url, "http://x").pathname))); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" }); fs.createReadStream(f).pipe(r); } catch (e) { r.writeHead(500); r.end(); } });
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  SRV = { s, base: "http://127.0.0.1:" + s.address().port };
  return SRV;
}
async function browser() {
  clearTimeout(brIdle);
  if (BR && (!BR.connected || brUse >= 60)) { try { await BR.close(); } catch (e) {} BR = null; brUse = 0; }
  if (!BR) {
    let err;
    for (let i = 0; i < 3 && !BR; i++) { try { BR = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: { width: 1200, height: 1100, deviceScaleFactor: 2 }, timeout: 60000 }); } catch (e) { err = e; await sleep(2500); } }
    if (!BR) throw err;
  }
  brUse++;
  brIdle = setTimeout(async () => { try { if (BR) await BR.close(); } catch (e) {} BR = null; brUse = 0; }, 10 * 60000);
  return BR;
}
/* 카드 한 장 → { png, caption } */
async function makeCard(tk, iv, days, cfg, resKey) {
  C.busy++;
  try {
    await loadCtx();
    const row = pickRow(C.uni, tk, C.info);
    if (!row) return null;
    if (process.env.BOT_VERBOSE) log("카드 데이터 받는 중", tk, iv, days);
    const d = await buildCardData({ row, ticker: tk, info: C.info, iv, days, fx: C.fx, log: () => {}, cacheDir: CACHE, mode: cfg.mode });
    if (!d) return null;
    if (process.env.BOT_VERBOSE) log("카드 그리는 중", tk);
    applyCardCfg(d, cfg, resKey || cfg.res || cfg.cardRes, { noMini: iv === "1d" });   /* 일봉 카드에는 일봉 미니차트가 중복이라 뺌 */
    const { base } = await server(), b = await browser(), page = await b.newPage();
    try { page.on("pageerror", () => {}); const png = await renderCard(page, base, d); flushCardCache(CACHE); return { png: Buffer.from(png), caption: d.caption, detail: d.detail }; }
    finally { await page.close().catch(() => {}); }
  } finally { C.busy--; }
}
const REP_W = { fcover: 1360, fwide: 2184, pcxl: 3200 };
async function drawReportPng(out, resKey) {
  const b = await browser(), page = await b.newPage();
  try {
    await page.setContent("<html><body style='margin:0;background:#17181c'></body></html>");
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, "rep-render.js"), "utf8") });
    let buf = null;
    for (let k = 0, w = REP_W[resKey] || 2184; k < 3; k++, w = Math.round(w * 0.78)) {   /* 텔레그램 사진 10MB 한도 */
      const r = await page.evaluate((spec) => window.drawReport(spec), { header: out.header, sections: out.sections, foot: out.foot, outW: w });
      buf = Buffer.from(r.url.split(",")[1], "base64");
      if (buf.length < 9.5e6) break;
    }
    return buf;
  } finally { await page.close().catch(() => {}); }
}
const resKeyOf = (cfg) => (["fcover", "fwide", "pcxl"].includes(cfg.res) ? cfg.res : "fwide");

/* 설정(tg_shot_cfg) 읽고-고치고-쓰기 */
async function patchCfg(fn) {
  const cfg = await cfgGet();
  const note = fn(cfg);
  await W("tg_shot_cfg", cfg);
  return { cfg, note };
}

/* ───────────────── 명령 처리 ───────────────── */
const MAXC = 30;
const need = (cond, msg) => { if (!cond) throw new UserErr(msg); };
class UserErr extends Error {}

async function doHelp(arg, withKeyboard) {
  const cfg = await cfgGet();
  const k = norm((arg || [])[0] || "");
  const map = { 차트: "chart", 종목: "chart", 섹터: "sector", 테마: "sector", 조회: "query", 보내기: "send", 설정: "set" };
  if (map[k]) return say(F.helpCat(map[k], cfg), F.helpBack());
  if (withKeyboard) await say("⌨️ 아래 키보드 버튼으로도 바로 쓸 수 있어요", F.replyKeyboard());
  return say(F.helpMain(cfg), F.helpButtons());
}
async function doSectors(arg) {
  await loadCtx();
  if (arg && arg.length) return doRequest(arg.join(" "));   /* '섹터 메모리' = '메모리' */
  return say(F.sectorList(C.info, C.themes), F.sectorButtons(C.info, C.themes));
}

/* 섹터 이름(들) → 표 한 장 */
async function sendTable(title, sub, tickers, cfg, notes) {
  const prog = await say("⏳ <b>" + F.esc(title) + "</b> 표 만드는 중… (" + tickers.length + "종목)");
  action("upload_photo");
  C.busy++;
  try {
    await loadCtx();
    const out = await buildListReport({ title, sub, tickers, cfg, info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 25000, bars: C.bars });
    if (!out.rows.length) { await delMsg(prog); return say("⚠️ " + F.esc(title) + ": 지금 계산 가능한 종목이 없어요 (데이터 준비 중일 수 있어요 — 잠시 뒤 다시)"); }
    const png = await drawReportPng(out, resKeyOf(cfg));
    await photo(png, out.caption + (out.meta.left ? "\n(일부 종목 캔들 받는 중)" : ""));
  } finally { C.busy--; await delMsg(prog); }
  if (notes && notes.length) await say("ℹ️ " + notes.map(F.esc).join("\nℹ️ "));
}
/* 종목들 → 카드 여러 장 */
async function sendCards(tickers, iv, days, cfg, opt) {
  opt = opt || {};
  const prog = tickers.length > 1 ? await say("⏳ 카드 " + tickers.length + "장 만드는 중… (" + F.esc(IV_KO[iv] || iv) + "봉 · " + days + "일)") : null;
  let n = 0, fail = [];
  try {
    for (const tk of tickers) {
      action("upload_photo");
      try {
        const c = await makeCard(tk, iv, days, cfg, opt.res);
        if (!c) { fail.push(tk); continue; }
        await photo(c.png, c.caption, opt.buttons === false ? null : F.cardButtons(tk, iv));
        n++;
        if (tickers.length > 1) await sleep(DRY ? 0 : 1100);
      } catch (e) { log("카드 오류", tk, String((e && e.message) || e).slice(0, 120)); fail.push(tk); }
    }
  } finally { await delMsg(prog); }
  if (fail.length) await say("⚠️ 카드를 못 만든 종목: <b>" + F.esc(fail.join(", ")) + "</b>\n(상장 직후라 캔들이 모자라거나 하이퍼리퀴드에 없는 종목일 수 있어요)");
  return n;
}

/* 일반 글 → 차트 요청(종목·섹터) */
async function doRequest(text, forceCards) {
  await loadCtx();
  const cfg = await cfgGet();
  const q = parseRequest(text, C.idx, C.info, C.themes);
  if (!q.tickers.length) {
    const sug = [...C.idx.keys()].filter((t) => q.misses.some((m) => norm(m).length >= 2 && norm(t).startsWith(norm(m).slice(0, 2)))).slice(0, 5);
    return say("🤔 <b>" + F.esc(q.misses.join(" ") || text.slice(0, 30)) + "</b> — 못 찾았어요\n" + (sug.length ? "혹시: " + sug.map((s) => "<code>" + F.esc(s) + "</code>").join(" · ") + "\n" : "") + "종목 이름·티커·섹터 이름을 써 주세요.  <code>도움말</code> 을 눌러 보세요", F.helpButtons());
  }
  const iv = q.iv || String(cfg.cardIv || "4h"), days = q.days || Math.min(150, Math.max(3, +cfg.cardDays || 60));
  const notes = q.notes.slice();
  if (q.misses.length) notes.push("못 찾은 말: " + q.misses.join(", "));
  const asTable = q.sectors.length && !q.asCards && !forceCards || q.asTable;
  if (asTable) {
    let tk = q.tickers; if (tk.length > MAX_TABLE) { notes.push("종목이 많아 거래대금 상위가 아니라 앞 " + MAX_TABLE + "개만 보여요"); tk = tk.slice(0, MAX_TABLE); }
    const title = q.sectors.length ? (q.sectors.length > 2 ? q.sectors.slice(0, 2).join(" + ") + " 외 " + (q.sectors.length - 2) : q.sectors.join(" + ")) : "종목 " + tk.length + "개";
    return sendTable(title.replace(/\(.*?\)/g, "").trim(), q.sectors.length ? "섹터: " + q.sectors.map(secName).join(" · ") : "요청한 종목", tk, cfg, notes);
  }
  let tk = q.tickers;
  if (tk.length > MAX_CARDS) { notes.push("카드는 한 번에 " + MAX_CARDS + "장까지라 앞 " + MAX_CARDS + "개만 보내요 (나머지는 표로: 섹터 이름만 쓰세요)"); tk = tk.slice(0, MAX_CARDS); }
  await sendCards(tk, iv, days, cfg);
  if (notes.length) await say("ℹ️ " + notes.map(F.esc).join("\nℹ️ "));
}

/* 리포트 (설정된 항목·해상도로) */
async function doReport() {
  const cfg = await cfgGet();
  const prog = await say("⏳ 리포트 만드는 중… (보통 10~30초)");
  C.busy++;
  try {
    await loadCtx(); action("upload_photo");
    const out = await buildReport({ cfg, info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 25000, bars: C.bars, stateIO: { read: () => sbGet("tg_rep_state"), write: (s) => W("tg_rep_state", s) } });
    if (out.skip) { await delMsg(prog); return say("⏳ " + F.esc(out.skip) + "\n잠시 뒤 다시 시도해 주세요"); }
    const png = await drawReportPng(out, resKeyOf(cfg));
    const mid = await photo(png, out.caption);
    if (cfg.doc !== false && !DRY) { const f = new FormData(); f.append("chat_id", CHAT); f.append("document", new Blob([png], { type: "image/png" }), "report.png"); f.append("disable_content_type_detection", "true"); if (mid) f.append("reply_to_message_id", String(mid)); await tg("sendDocument", f, true); }
  } finally { C.busy--; await delMsg(prog); }
}
/* 설정해 둔 카드 종목 전부 */
async function doCards() {
  const cfg = await cfgGet(), list = (Array.isArray(cfg.cards) ? cfg.cards : []).slice(0, MAXC);
  if (!list.length) return say("🃏 설정한 카드 종목이 없어요.\n<code>카드추가 메타 애플</code> 로 넣거나, 그냥 <code>메타</code> 처럼 이름을 쓰세요");
  const iv = String(cfg.cardIv || "4h"), days = Math.min(150, Math.max(3, +cfg.cardDays || 60));
  await sendCards(list, iv, days, cfg, { buttons: true });
}
/* 순위 글 */
async function doRank() {
  const cfg = await cfgGet();
  const prog = await say("⏳ 순위 글 만드는 중… (거래대금·급증 순위)");
  C.busy++;
  try {
    await loadCtx();
    const texts = [];
    const weekly = await buildWeeklyTexts({ uni: C.uni, info: C.info, fx: C.fx, cacheDir: CACHE, log: () => {} }); texts.push(...weekly.texts);
    texts.push(...await buildSurgeText({ uni: C.uni, info: C.info, fx: C.fx, log: () => {}, cacheDir: CACHE }));
    flushCardCache(CACHE);
    for (const t of texts) { await say(F.esc(t).replace(/\n/g, "\n")); }
    if (!texts.length) await say("순위로 보여줄 내용이 없어요");
  } finally { C.busy--; await delMsg(prog); }
}
/* 패턴 셋업 리포트 (패턴 확률 순위 글) */
async function doPattern() {
  const cfg = await cfgGet();
  if (!process.env.PATTERN_RANK_JSON && !DRY) return say("⚠️ 패턴 순위 데이터(비밀값)가 이 봇에 없어 만들 수 없어요");
  const prog = await say("⏳ 패턴 셋업 리포트 만드는 중… (종목 스캔, 1분 안팎)");
  C.busy++;
  try {
    await loadCtx();
    const tx = await buildPatternRankText({ uni: C.uni, info: C.info, log: () => {}, cacheDir: CACHE, tf0: String(cfg.cardIv || "4h"), scanN: 50 });
    flushCardCache(CACHE);
    for (const t of tx) await say(F.esc(t));
    if (!tx.length) await say("패턴 셋업으로 보여줄 내용이 없어요");
  } finally { C.busy--; await delMsg(prog); }
}
/* 가격흐름 사진 — shot.mjs 를 따로 실행 */
let flowRunning = false;
async function doFlow() {
  if (flowRunning) return say("⏳ 가격흐름 사진을 이미 만드는 중이에요");
  if (DRY) return say("[dry] 가격흐름: shot.mjs SHOT_ONLY=flow 실행 생략");
  flowRunning = true;
  const prog = await say("⏳ 가격흐름 사진 만드는 중… (보통 1~2분)");
  action("upload_photo");
  try {
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(ROOT, "shot.mjs")], { env: { ...process.env, SHOT_ONLY: "flow" }, stdio: ["ignore", "pipe", "pipe"] });
      let tail = ""; const keep = (d) => { tail = (tail + d).slice(-1500); };
      p.stdout.on("data", keep); p.stderr.on("data", keep);
      const to = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, 9 * 60000);
      p.on("close", (c) => { clearTimeout(to); resolve({ c, tail }); });
    });
    if (code.c !== 0) { log("흐름 실패", code.tail.slice(-300)); await say("⚠️ 가격흐름 사진을 못 만들었어요 (데이터 수집 중일 수 있어요). 잠시 뒤 다시 시도해 주세요"); }
    else if (/데이터 수집 중/.test(code.tail)) await say("⏳ 가격흐름 데이터를 아직 모으는 중이에요. 1~2분 뒤 <code>흐름</code> 을 다시 눌러 주세요");
  } finally { flowRunning = false; await delMsg(prog); }
}
/* 지금 = 사슬에 '지금 보내기' 요청 */
async function doNow(by) {
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 6), at = new Date().toISOString();
  const ok = await W("tg_shot_cmd", { id, at, by: by || "텔레그램" });
  return say(ok ? "📤 <b>지금 보내기</b> 요청을 접수했어요\n설정된 사진이 1~3분 안에 차례로 도착하고, 주기는 지금부터 새로 시작해요" : "⚠️ 요청을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요");
}

/* ── 조회 ── */
async function pickTickers(args, limit) {
  await loadCtx();
  const q = parseRequest(args.join(" "), C.idx, C.info, C.themes);
  return { tickers: q.tickers.slice(0, limit || 10), q };
}
async function doQuote(args, detail) {
  need(args.length, "종목을 같이 써 주세요  예) " + (detail ? "지표 메타" : "시세 메타 애플"));
  const { tickers, q } = await pickTickers(args, detail ? 3 : 10);
  need(tickers.length, "'" + F.esc(args.join(" ")) + "' 못 찾았어요");
  const prog = await say("⏳ 계산 중…");
  C.busy++;
  try {
    const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 20000, only: tickers, extra: tickers, bars: C.bars });
    const by = rowsByTk(r.rows), got = tickers.filter((t) => by[t]), miss = tickers.filter((t) => !by[t]);
    await delMsg(prog);
    if (!got.length) return say("⚠️ " + F.esc(tickers.join(", ")) + ": 아직 계산할 캔들이 모자라요 (상장 직후이거나 데이터 준비 중)");
    await say(got.map((t) => (detail ? F.indicBlock(by[t]) : F.quoteBlock(by[t]))).join("\n\n") + (miss.length ? "\n\n⚠️ 계산 불가: " + F.esc(miss.join(", ")) : "") + "\n\n<i>" + F.hm(Date.now()) + " 기준 · 가격은 실시간</i>");
  } finally { C.busy--; }
}
const stockRows = (s) => s.rows.filter((r) => r.stock && r.v.w >= 0);
async function doList(kind) {
  const s = await snapshot(30000);
  const byEok = (a, b) => b.v.eok - a.v.eok, all = s.rows, st = stockRows(s);
  let title, sub, rows, extra;
  if (kind === "listCore") { rows = all.filter((r) => r.v.w >= 2 && r.v.kc === 1 && r.v.h4m === 1).sort(byEok); title = "⭐ 핵심"; sub = "양W+2 · 켈상단 · 4H켈중심 — " + rows.length + "종목"; }
  else if (kind === "listHx") { rows = all.filter((r) => r.v.h4u === 1 && r.v.w >= 0).sort(byEok); title = "🔥 4H 발산"; sub = rows.length + "종목 · 4H 켈트너 상단 위"; extra = F.tag; }
  else if (kind === "listKelu") { rows = all.filter((r) => r.v.kelu > 0 && r.v.w >= 0).sort((a, b) => (b.v.kelu - a.v.kelu) || byEok(a, b)); title = "📆 켈유 (켈상단 유지 일수)"; sub = rows.length + "종목"; extra = (r) => Math.round(r.v.kelu) + "일"; }
  else if (kind === "listVol") { rows = st.sort(byEok); title = "💰 거래대금"; sub = "개별주 · 양W 0 이상"; extra = F.tag; }
  else { rows = all.filter((r) => r.stock && !Number.isNaN(r.v.chg) && r.v.chg != null).sort((a, b) => b.v.chg - a.v.chg); title = "📈 등락률"; sub = "개별주 · 전일 대비"; const top = rows.slice(0, 5), bot = rows.slice(-5).reverse(); return say(F.listLines(title + " 상위", sub, top, F.tag) + "\n\n" + F.listLines("📉 등락률 하위", "", bot, F.tag) + "\n\n<i>" + F.hm(Date.now()) + " 기준</i>"); }
  await say(F.listLines(title, sub, rows.slice(0, 10), extra) + "\n\n<i>" + F.hm(Date.now()) + " 기준 · 거래대금 순 TOP10</i>");
}
async function doSurge(args) {
  let mins = 15; if (args && args[0]) { const e = parseEvery(args[0]); if (typeof e === "number" && e >= 5) mins = Math.min(240, e); else if (/^\d+$/.test(args[0])) mins = Math.min(240, Math.max(5, +args[0])); }
  const s = await snapshot(30000), now = Date.now(), list = [];
  s.rows.filter((r) => r.v.w >= 0).forEach((r) => { const c = changeOver(r.e, mins, now); if (c) list.push({ r, pct: c.pct, usd: c.usd }); });
  const a = list.map((x) => x.pct).sort((x, y) => x - y), med = a.length >= 3 ? a[Math.floor(a.length / 2)] : 0;
  list.forEach((x) => { x.rel = x.pct - med; });
  const top = list.filter((x) => Math.abs(x.rel) >= 0.01).sort((x, y) => Math.abs(y.rel) - Math.abs(x.rel) || y.usd - x.usd).slice(0, 8);
  if (!top.length) return say("🚨 급변동 (" + mins + "분): 시장 대비 튀는 종목이 없어요");
  const L = ["🚨 <b>급변동 TOP" + top.length + "</b>  <i>" + F.hm(now - mins * 60000) + "→" + F.hm(now) + " · 시장 " + (med >= 0 ? "+" : "") + med.toFixed(2) + "%p 대비</i>"];
  top.forEach((x, i) => L.push((i + 1) + ". <b>" + F.esc(x.r.tk) + "</b>" + (x.r.name && x.r.name !== x.r.tk ? " · " + F.esc(x.r.name) : "") + "  " + (x.rel > 0 ? "🔺+" : "🔽") + x.rel.toFixed(2) + "%p  유입 " + F.eok(x.usd * C.fx / 1e8) + "억  양W" + (x.r.v.w > 0 ? "+" : "") + x.r.v.w));
  await say(L.join("\n") + "\n\n<i>다른 구간: 급등 5분 · 급등 30분 · 급등 1시간</i>");
}
async function doEntries() {
  const prog = await say("⏳ 최신 상태로 진입 변화를 계산 중…");
  C.busy++;
  try {
    await loadCtx();
    const cfg = await cfgGet();
    const out = await buildReport({ cfg: { ...cfg, repOrder: ["sum"], repOff: [] }, info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 20000, bars: C.bars, stateIO: { read: () => sbGet("tg_rep_state"), write: (s) => W("tg_rep_state", s) } });
    await delMsg(prog);
    if (out.skip) return say("⏳ " + F.esc(out.skip));
    const by = rowsByTk((C.snap && C.snap.rows) || []);
    const seen = new Set(), L = ["🚪 <b>최근 진입</b>  <i>무엇에 진입했나</i>"];
    for (const e of out.ent) { if (seen.has(e.k)) continue; seen.add(e.k); L.push((seen.size) + ". " + F.entryLine(e, by)); if (seen.size >= 8) break; }
    if (!seen.size) L.push("— 아직 진입 기록이 없어요 —");
    await say(L.join("\n") + "\n\n<i>진입은 리포트를 만들 때마다 직전 상태와 비교해 기록돼요</i>");
  } finally { C.busy--; }
}
async function doMacro() {
  await loadCtx();
  const r0 = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 25000, only: FIXED_INDEX, extra: FIXED_INDEX, bars: C.bars }), by = rowsByTk(r0.rows);
  const L = ["🌐 <b>매크로</b>  <i>" + F.hm(Date.now()) + " 기준</i>", ""];
  const grp = [["지수", ["XYZ100", "SP500", "KR200", "JP225"]], ["금리", ["10Y"]], ["원자재", ["CL", "BRENTOIL", "NATGAS", "GOLD", "SILVER", "COPPER", "PLATINUM", "PALLADIUM"]]];
  for (const [g, tks] of grp) {
    L.push("<b>" + g + "</b>");
    tks.forEach((t) => { const r = by[t]; if (!r) return; const isR = t === "10Y"; const nm = (KO[t] || t).split(" · ")[0].replace(/\(.*?\)/g, ""); L.push("• " + F.esc(nm) + " <i>" + t + "</i>  <b>" + (isR ? r.v.px.toFixed(3) + "%" : F.fmtPx(r.v.px)) + "</b>  " + (isR ? (r.v.px - r.v.prev >= 0 ? "🔺+" : "🔽") + ((r.v.px - r.v.prev) * 100).toFixed(1) + "bp" : (r.v.chg >= 0 ? "🔺+" : "🔽") + r.v.chg.toFixed(2) + "%")); });
    L.push("");
  }
  await say(L.join("\n").trim());
}
async function doFx() {
  await loadCtx(true);
  const extra = [];
  try {
    const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 15000, only: ["DXY", "KRW", "JPY", "EUR", "GBP"], extra: ["DXY", "KRW", "JPY", "EUR", "GBP"], bars: C.bars });
    const by = rowsByTk(r.rows), lab = { DXY: "달러인덱스", KRW: "달러/원(하이퍼리퀴드)", JPY: "달러/엔", EUR: "유로/달러", GBP: "파운드/달러" };
    Object.keys(lab).forEach((t) => { if (by[t]) extra.push("• " + lab[t] + "  <b>" + F.fmtPx(by[t].v.px) + "</b>  " + (by[t].v.chg >= 0 ? "🔺+" : "🔽") + by[t].v.chg.toFixed(2) + "%"); });
  } catch (e) {}
  await say(F.fxText(C.fx, extra) + "\n<i>환산 기준(open.er-api) · 리포트의 억원도 이 값</i>");
}
/* 펀딩·미결제 */
let CTX = null, CTXAT = 0;
async function ctxAll() {
  if (CTX && Date.now() - CTXAT < 60000) return CTX;
  const dexs = await hl({ type: "perpDexs" }, () => {}); const names = [""].concat((dexs || []).filter((d) => d && d.name).map((d) => d.name));
  const rows = [];
  for (const dx of names) {
    const r = await hl(dx ? { type: "metaAndAssetCtxs", dex: dx } : { type: "metaAndAssetCtxs" }, () => {}); if (!r) continue;
    r[0].universe.forEach((u, i) => { const c = r[1][i] || {}; const px = +c.markPx || +c.midPx || 0; rows.push({ full: u.name, short: u.name.includes(":") ? u.name.split(":")[1] : u.name, funding: +c.funding || 0, oiUsd: (+c.openInterest || 0) * px, px, day: +c.dayNtlVlm || 0 }); });
  }
  CTX = rows; CTXAT = Date.now(); return rows;
}
const apr = (f) => f * 24 * 365 * 100;
async function doFunding(args) {
  need(args.length, "종목을 같이 써 주세요  예) 펀딩 BTC");
  const { tickers } = await pickTickers(args, 5); need(tickers.length, "'" + F.esc(args.join(" ")) + "' 못 찾았어요");
  const all = await ctxAll(), L = ["💸 <b>펀딩·미결제</b>", ""];
  tickers.forEach((t) => { const a = (C.info.alias && C.info.alias[t]) || t; const rs = all.filter((r) => r.short === a).sort((x, y) => y.oiUsd - x.oiUsd); if (!rs.length) { L.push("• " + F.esc(t) + ": 데이터 없음"); return; } const r = rs[0]; L.push("• <b>" + F.esc(t) + "</b>  펀딩 " + (r.funding >= 0 ? "+" : "") + (r.funding * 100).toFixed(4) + "%/시간 (연 " + (apr(r.funding) >= 0 ? "+" : "") + apr(r.funding).toFixed(1) + "%)  " + (r.funding > 0 ? "롱이 냄" : r.funding < 0 ? "숏이 냄" : "") + "\n    미결제 $" + (r.oiUsd / 1e6).toFixed(1) + "M (" + F.eok(r.oiUsd * C.fx / 1e8) + "억원) · 24h 대금 $" + (r.day / 1e6).toFixed(1) + "M"); });
  await say(L.join("\n"));
}
async function doFundRank() {
  const all = (await ctxAll()).filter((r) => r.oiUsd >= 2e6), hi = all.slice().sort((a, b) => b.funding - a.funding).slice(0, 5), lo = all.slice().sort((a, b) => a.funding - b.funding).slice(0, 5);
  const line = (r, i) => (i + 1) + ". <b>" + F.esc(r.short) + "</b>  " + (r.funding >= 0 ? "+" : "") + apr(r.funding).toFixed(0) + "%/년  OI $" + (r.oiUsd / 1e6).toFixed(0) + "M";
  await say("💸 <b>펀딩 순위</b> <i>(미결제 $2M 이상)</i>\n\n🔺 <b>롱이 많이 내는 쪽</b>\n" + hi.map(line).join("\n") + "\n\n🔽 <b>숏이 많이 내는 쪽</b>\n" + lo.map(line).join("\n"));
}
async function doOiRank() {
  const all = (await ctxAll()).slice().sort((a, b) => b.oiUsd - a.oiUsd).slice(0, 10);
  await say("📊 <b>미결제(OI) 순위</b>\n\n" + all.map((r, i) => (i + 1) + ". <b>" + F.esc(r.short) + "</b>  $" + (r.oiUsd / 1e6).toFixed(0) + "M (" + F.eok(r.oiUsd * C.fx / 1e8) + "억)  펀딩 " + (r.funding >= 0 ? "+" : "") + apr(r.funding).toFixed(0) + "%/년").join("\n"));
}

/* ── 상태·설정 ── */
async function doStatus() {
  const [last, st, cfg, mute] = await Promise.all([sbGet("tg_shot_last"), sbGet("tg_shot_status"), cfgGet(), sbGet("tg_bot_mute")]);
  const co = C.bars ? Object.values(C.bars.c || {}).filter((e) => e.m && e.m.length > 130).length : 0;
  await say(F.statusText({ last, st, cfg, mute, up: C.up, snapAge: C.snapAt ? C.snapAt : null, bars: C.bars ? { ok: co, total: Object.keys(C.bars.c || {}).length } : null }));
}
async function doConfig() { const [cfg, mute] = await Promise.all([cfgGet(), sbGet("tg_bot_mute")]); await loadCtx(); await say(F.configText(cfg, mute, C.themes)); }

const EVERY_LABEL = { report: "📋 리포트", flow: "📈 가격흐름", cards: "🃏 카드", rank: "📑 순위글", pattern: "🧩 패턴 셋업 리포트" };
async function doEvery(target, value) {
  let backup = null;
  if (target === "cards") backup = await sbGet("tg_bot_cards_backup");
  const { note } = await patchCfg((c) => {
    if (target === "report") { if (value === "off") c.rep = false; else if (value === "on") c.rep = true; else { c.rep = true; c.repEvery = snapEvery(value); } return c.rep === false ? "끔" : everyKo(c.repEvery != null ? +c.repEvery : 15) + "마다"; }
    if (target === "flow") { if (value === "off") { c.flowEvery = 1440; return "하루 1번 (가격흐름은 끌 수 없어서 가장 드물게)"; } if (value === "on") { c.flowEvery = 0; return "매번(5분)"; } c.flowEvery = snapEvery(value); return everyKo(c.flowEvery) + "마다"; }
    if (target === "cards") {
      if (value === "off") { if (Array.isArray(c.cards) && c.cards.length) { backup = c.cards.slice(); c.cards = []; } return "끔 (카드 종목 " + (backup ? backup.length : 0) + "개는 보관해 뒀어요 — '카드 켜기'로 복구)"; }
      if (value === "on") { if ((!c.cards || !c.cards.length) && backup && backup.length) c.cards = backup.slice(0, MAXC); return "켬 (카드 " + ((c.cards || []).length) + "장)"; }
      c.cardEvery = snapEvery(value); return everyKo(c.cardEvery) + "마다";
    }
    if (target === "rank") {
      if (value === "off") { c.rankWeekly = false; c.rankSurge = false; return "끔 (거래대금·급증 순위)"; }
      if (value === "on") { c.rankWeekly = true; c.rankSurge = true; return "켬 (거래대금·급증 순위)"; }
      c.rankEvery = snapEvery(value); return everyKo(c.rankEvery) + "마다";
    }
    if (target === "pattern") {
      if (value === "off") { c.rankPattern = false; return "끔"; }
      if (value === "on") { c.rankPattern = true; return "켬 (" + everyKo(c.rankPatEvery != null ? +c.rankPatEvery : 60) + "마다)"; }
      const v = [0, 60, 240, 1440].reduce((b, x) => (Math.abs(x - value) < Math.abs(b - value) ? x : b));   /* 설정 페이지의 선택지와 같게 */
      c.rankPattern = true; c.rankPatEvery = v; return everyKo(v) + "마다";
    }
  });
  if (target === "cards") { if (backup && backup.length) await W("tg_bot_cards_backup", backup); }
  const note2 = typeof note === "string" ? note : "";
  const sn = typeof value === "number" ? (target === "pattern" ? [0, 60, 240, 1440].reduce((b, x) => (Math.abs(x - value) < Math.abs(b - value) ? x : b)) : snapEvery(value)) : null;
  const adj = sn != null && value !== sn ? "\n<i>(" + value + "분은 선택지에 없어 가장 가까운 " + everyKo(sn) + "로 맞췄어요 — 가능: " + (target === "pattern" ? "매번·1시간·4시간·하루" : "매번·10분·15분·30분·1시간·4시간·하루") + ")</i>" : "";
  return say("✅ " + EVERY_LABEL[target] + " → <b>" + F.esc(note2) + "</b>" + adj + "\n<i>다음 발송부터 적용돼요 · 설정 페이지에도 반영돼요</i>");
}
async function doSetting(cmd, arg) {
  const a0 = arg[0] || "", n0 = norm(a0), reply = (t) => say("✅ " + t + "\n<i>설정 페이지에도 반영돼요</i>");
  if (cmd === "resSet") {
    const m = /폴드펼|펼침|펼친|가로|wide|fwide/.test(n0) ? "fwide" : /폴드|접힘|접힌|커버|세로|fcover/.test(n0) ? "fcover" : /pc|와이드|16:?9|pcxl|컴퓨터|데스크/.test(n0) ? "pcxl" : null;
    need(m, "해상도: <code>해상도 폴드</code> · <code>해상도 펼침</code> · <code>해상도 PC</code>");
    await patchCfg((c) => { c.res = m; c.cardRes = m; });
    return reply("해상도 → <b>" + ({ fcover: "폴드 접힘(세로)", fwide: "폴드 펼침(가로)", pcxl: "PC 16:9" })[m] + "</b>  (카드·가격흐름·리포트 모두)");
  }
  if (cmd === "miniSet") {
    need(arg.length, "<code>미니 끄기</code> · <code>미니 켜기</code> · <code>미니 30</code>/<code>60</code>/<code>90</code> · <code>미니 크게</code>");
    let t = "";
    await patchCfg((c) => { for (const w of arg) { const n = norm(w); if (/^(끄기|끔|off)$/.test(n)) { c.cardDaily = false; t += "끔 "; } else if (/^(켜기|켬|on)$/.test(n)) { c.cardDaily = true; t += "켬 "; } else if (/^(30|60|90)$/.test(n)) { c.cardDaily = true; c.cardDailyBars = +n; t += n + "개 "; } else if (/^(작게|소|s)$/.test(n)) { c.cardDailySize = "s"; t += "작게 "; } else if (/^(보통|중|m)$/.test(n)) { c.cardDailySize = "m"; t += "보통 "; } else if (/^(크게|대|l)$/.test(n)) { c.cardDailySize = "l"; t += "크게 "; } else throw new UserErr("모르는 말: " + w); } });
    return reply("일봉 미니차트 → <b>" + F.esc(t.trim()) + "</b>");
  }
  if (cmd === "ivSet") {
    const q = parseRequest(a0, C.idx || new Map(), { watch: [] }, {}); need(q.iv, "예) <code>기본봉 4시간</code>  (15분·30분·1시간·2시간·4시간·8시간·일봉)");
    await patchCfg((c) => { c.cardIv = q.iv; });
    return reply("카드 기본 봉 → <b>" + IV_KO[q.iv] + "</b>  (봉을 안 쓴 요청에 적용)");
  }
  if (cmd === "daysSet") {
    const m = /(\d+)/.exec(a0); need(m, "예) <code>기본기간 60일</code>  (3~150일)");
    const d = Math.min(150, Math.max(3, +m[1])); await patchCfg((c) => { c.cardDays = d; });
    return reply("카드 기본 기간 → <b>" + d + "일</b>");
  }
  if (cmd === "docSet") {
    const e = parseEvery(a0); need(e === "on" || e === "off", "<code>원본 켜기</code> / <code>원본 끄기</code>  (사진과 함께 오는 원본 PNG 파일)");
    await patchCfg((c) => { c.doc = e === "on"; }); return reply("원본 PNG 파일 → <b>" + (e === "on" ? "함께 보냄" : "안 보냄") + "</b>");
  }
  if (cmd === "rowsSet") {
    const m = /(\d+)/.exec(a0); need(m, "예) <code>리포트줄 60</code>  (20·30·45·60·80)");
    const v = [20, 30, 45, 60, 80].reduce((b, x) => (Math.abs(x - +m[1]) < Math.abs(b - +m[1]) ? x : b)); await patchCfg((c) => { c.repRows = v; }); return reply("리포트 전종목 줄 수 → <b>" + v + "</b>");
  }
  if (cmd === "surgeSet") {
    const m = /(\d+)/.exec(a0); need(m, "예) <code>급변구간 30</code>  (5·15·30·60분)");
    const v = [5, 15, 30, 60].reduce((b, x) => (Math.abs(x - +m[1]) < Math.abs(b - +m[1]) ? x : b)); await patchCfg((c) => { c.repSurge = v; }); return reply("급변동 구간 → <b>" + v + "분</b>");
  }
}
/* 카드 종목 추가/삭제/목록 */
async function doCardList(cmd, arg) {
  await loadCtx();
  if (cmd === "cardList") { const c = await cfgGet(), l = Array.isArray(c.cards) ? c.cards : []; return say("🃏 <b>카드 종목 " + l.length + "장</b>\n" + (l.length ? l.map((t, i) => (i + 1) + ". " + F.esc(t)).join("\n") : "— 없음 —") + "\n\n<i>카드추가 메타 애플 · 카드삭제 메타 · 카드초기화</i>"); }
  if (cmd === "cardClear") { await patchCfg((c) => { c.cards = []; }); return say("✅ 카드 종목을 모두 비웠어요 (설정 페이지에도 반영)"); }
  need(arg.length, cmd === "cardAdd" ? "예) <code>카드추가 메타 애플</code>" : "예) <code>카드삭제 메타</code>");
  const q = parseRequest(arg.join(" "), C.idx, C.info, C.themes); need(q.tickers.length, "'" + F.esc(arg.join(" ")) + "' 못 찾았어요");
  let added = [], removed = [], full = false;
  await patchCfg((c) => {
    const l = Array.isArray(c.cards) ? c.cards.slice() : [];
    if (cmd === "cardAdd") q.tickers.forEach((t) => { if (l.includes(t)) return; if (l.length >= MAXC) { full = true; return; } l.push(t); added.push(t); });
    else q.tickers.forEach((t) => { const i = l.indexOf(t); if (i >= 0) { l.splice(i, 1); removed.push(t); } });
    c.cards = l;
  });
  const c2 = await cfgGet();
  if (cmd === "cardAdd") return say("✅ 카드 추가: <b>" + F.esc(added.join(", ") || "없음(이미 있음)") + "</b>" + (full ? "\n⚠️ 최대 " + MAXC + "장이라 일부는 못 넣었어요" : "") + "\n지금 " + (c2.cards || []).length + "장 · <i>다음 카드 발송부터 포함돼요</i>");
  return say("✅ 카드 삭제: <b>" + F.esc(removed.join(", ") || "없음(목록에 없던 종목)") + "</b>\n지금 " + (c2.cards || []).length + "장");
}
/* 내 테마 */
async function doTheme(cmd, arg) {
  await loadCtx();
  if (cmd === "themeAdd") {
    need(arg.length >= 2, "예) <code>테마추가 내픽 NVDA 메타 애플</code>  (이름 + 종목들)");
    const name = arg[0].slice(0, 14), q = parseRequest(arg.slice(1).join(" "), C.idx, C.info, C.themes); need(q.tickers.length, "종목을 못 찾았어요");
    C.themes = { ...C.themes, [name]: q.tickers.slice(0, 40) }; await W("tg_bot_themes", C.themes); C.idx = null; await loadCtx();
    return say("⭐ 내 테마 <b>" + F.esc(name) + "</b> 저장: " + F.esc(q.tickers.slice(0, 40).join(", ")) + "\n이제 <code>" + F.esc(name) + "</code> 이라고 쓰면 표로, <code>" + F.esc(name) + " 카드</code> 는 카드로 와요");
  }
  need(arg.length, "예) <code>테마삭제 내픽</code>");
  const key = Object.keys(C.themes).find((k) => norm(k) === norm(arg[0])); need(key, "'" + F.esc(arg[0]) + "' 라는 내 테마가 없어요 (<code>섹터</code> 로 목록 확인)");
  const t = { ...C.themes }; delete t[key]; C.themes = t; await W("tg_bot_themes", t);
  return say("🗑 내 테마 <b>" + F.esc(key) + "</b> 를 지웠어요");
}
/* 조용히 / 재개 */
async function doMute(arg) {
  let min = 60;
  if (arg && arg.length) { const w = norm(arg.join("")); const e = parseEvery(arg[0]); if (typeof e === "number" && e > 0) min = e; else if (/^(오늘|하루|내일|종일)$/.test(w)) min = 24 * 60; else if (/^\d+$/.test(w)) min = +w; else throw new UserErr("예) <code>조용히 1시간</code> · <code>조용히 30분</code> · <code>조용히 하루</code>"); }
  min = Math.min(min, 7 * 24 * 60);
  const until = Date.now() + min * 60000; await W("tg_bot_mute", { until, at: Date.now() });
  return say("🔕 <b>조용히</b> — " + F.mdhm(until) + " KST 까지 주기 발송을 쉬어요 (" + (min >= 60 ? (min / 60).toFixed(min % 60 ? 1 : 0) + "시간" : min + "분") + ")\n질문하면 평소처럼 답하고, <code>지금</code> 은 쉬는 중에도 보내요 · <code>재개</code> 로 바로 풀어요");
}
async function doUnmute() { await W("tg_bot_mute", { until: 0, at: Date.now() }); return say("🔔 <b>재개</b> — 주기 발송이 다음 칸부터 다시 와요"); }

/* ───────────────── 라우터 ───────────────── */
async function handleText(text, from) {
  const cmd = parseCommand(text);
  const run = async () => {
    if (!cmd) return doRequest(text);
    switch (cmd.cmd) {
      case "help": return doHelp(cmd.arg, /^\/?start/i.test(String(text).trim()));
      case "sectors": return doSectors(cmd.arg);
      case "report": return doReport();
      case "now": return doNow();
      case "flow": return doFlow();
      case "cards": return doCards();
      case "rank": return doRank();
      case "pattern": return doPattern();
      case "status": return doStatus();
      case "config": return doConfig();
      case "mute": return doMute(cmd.arg);
      case "unmute": return doUnmute();
      case "quote": return doQuote(cmd.arg, false);
      case "indic": return doQuote(cmd.arg, true);
      case "listCore": case "listHx": case "listKelu": case "listVol": case "listChg": return doList(cmd.cmd);
      case "surge": return doSurge(cmd.arg);
      case "entries": return doEntries();
      case "macro": return doMacro();
      case "fx": return doFx();
      case "funding": return doFunding(cmd.arg);
      case "fundRank": return doFundRank();
      case "oiRank": return doOiRank();
      case "every": return doEvery(cmd.target, cmd.value);
      case "resSet": case "miniSet": case "ivSet": case "daysSet": case "docSet": case "rowsSet": case "surgeSet": return doSetting(cmd.cmd, cmd.arg);
      case "cardAdd": case "cardDel": case "cardList": case "cardClear": return doCardList(cmd.cmd, cmd.arg);
      case "themeAdd": case "themeDel": return doTheme(cmd.cmd, cmd.arg);
    }
  };
  try { await Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error("시간이 너무 오래 걸려 중단했어요")), 12 * 60000))]); }
  catch (e) {
    if (e instanceof UserErr) await say("🙋 " + e.message);   /* 안내 글은 이미 HTML(사용자 글은 need() 쪽에서 esc) */
    else { log("처리 오류:", text, String((e && e.stack) || e).slice(0, 400)); await say("⚠️ 처리 중 문제가 생겼어요: " + F.esc(String((e && e.message) || e).slice(0, 140)) + "\n잠시 뒤 다시 시도해 주세요"); }
  }
}
async function handleCallback(cb) {
  const d = String(cb.data || "");
  const ack = (t) => (DRY ? null : tg("answerCallbackQuery", { callback_query_id: cb.id, text: t || "" }));
  try {
    if (d.startsWith("h:")) {
      await ack();
      const cfg = await cfgGet(), k = d.slice(2), mid = cb.message && cb.message.message_id;
      const text = k === "main" ? F.helpMain(cfg) : F.helpCat(k, cfg), markup = k === "main" ? F.helpButtons() : F.helpBack();
      if (DRY) return say(text, markup);
      const r = await tg("editMessageText", { chat_id: CHAT, message_id: mid, text, parse_mode: "HTML", reply_markup: markup });
      if (!r.ok && !/not modified/i.test(String(r.description))) await say(text, markup);
      return;
    }
    await loadCtx();
    if (d.startsWith("s:") || d.startsWith("u:")) {
      const i = +d.slice(2), cfg = await cfgGet();
      if (d[0] === "s") { const s = C.info.watch[i]; if (!s) return ack("목록이 바뀌었어요"); await ack("표 만드는 중…"); return sendTable(secName(s[0]).replace(/\(.*?\)/g, "").trim(), "섹터: " + secName(s[0]), s[1].split(",").filter(Boolean), cfg, []); }
      const nm = Object.keys(C.themes)[i]; if (!nm) return ack("목록이 바뀌었어요"); await ack("표 만드는 중…"); return sendTable("내 테마 · " + nm, "내 테마", C.themes[nm], cfg, []);
    }
    if (d.startsWith("z:")) {
      const [, tk, iv] = d.split(":"); await ack((IV_KO[iv] || iv) + "봉으로 만드는 중…");
      const cfg = await cfgGet(); return sendCards([tk], iv, Math.min(150, Math.max(3, +cfg.cardDays || 60)), cfg);
    }
    await ack();
  } catch (e) { log("버튼 오류:", String((e && e.message) || e).slice(0, 200)); await say("⚠️ 처리 중 문제가 생겼어요: " + F.esc(String((e && e.message) || e).slice(0, 120))); }
}

/* ───────────────── 메인 루프 ───────────────── */
async function bgLoop() {   /* 놀 때 캔들을 조금씩 최신으로(리포트·조회가 바로 답하도록) */
  let lastSave = Date.now();
  while (Date.now() - T_START < MAX_MS) {
    try {
      if (C.busy === 0 && C.info && C.uni.length && C.bars) {
        await refreshBars({ info: C.info, uni: C.uni, bars: C.bars, log: () => {}, deadline: Date.now() + 10000 });
        if (Date.now() - lastSave > 8 * 60000) { stripLive(C.bars); saveBars(CACHE, C.bars); lastSave = Date.now(); }
      }
    } catch (e) { log("백그라운드 갱신 오류", String((e && e.message) || e).slice(0, 100)); }
    await sleep(C.busy ? 4000 : 6000);
  }
}
async function setupTelegram() {
  if (DRY) return;
  await tg("deleteWebhook", { drop_pending_updates: false });
  await tg("setMyCommands", { commands: F.MENU.map(([command, description]) => ({ command, description })) });
  const first = !(await sbGet("tg_bot_hello"));
  if (first || process.env.BOT_HELLO === "1") {
    await W("tg_bot_hello", { at: Date.now() });
    await say("👋 <b>선구안 봇이 켜졌어요!</b>\n이 방에 종목 이름을 쓰면 차트를 보내드려요.\n예)  <code>메타</code>   <code>메모리 대장주</code>   <code>리포트</code>");
    await doHelp([], true);
  }
}
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (!DRY && (!TOKEN || !CHAT)) { log("TG_BOT_TOKEN / TG_CHAT_ID 가 없어 종료"); return; }
  log("챗봇 시작", DRY ? "(시험 모드: 전송·저장 안 함)" : "", "최대", Math.round(MAX_MS / 60000) + "분");
  await loadCtx(true);
  log("준비: 종목 " + C.uni.length + " · 색인 " + C.idx.size + " · 내 테마 " + Object.keys(C.themes).length);
  await setupTelegram();
  /* 시험 입력(BOT_INPUT 파일): 줄마다 한 글. '@버튼:데이터' 줄은 버튼 누르기 */
  if (process.env.BOT_INPUT) {
    for (const ln of fs.readFileSync(process.env.BOT_INPUT, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"))) {
      console.log("\n══════════ 입력: " + ln + " ══════════");
      if (ln.startsWith("@")) await handleCallback({ id: "t", data: ln.slice(1), message: { message_id: 1 } }); else await handleText(ln);
    }
    flushCardCache(CACHE); process.exit(0);
  }
  bgLoop();
  let offset = 0; { const o = await sbGet("tg_bot_offset"); if (o && +o.next) offset = +o.next; }
  const seen = new Set();
  while (Date.now() - T_START < MAX_MS) {
    const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    if (!r.ok) { if (/409|Conflict/i.test(String(r.description))) { log("다른 곳에서 읽는 중(409) — 10초 뒤 재시도"); await sleep(10000); } else await sleep(3000); continue; }
    for (const u of r.result || []) {
      offset = u.update_id + 1;
      if (seen.has(u.update_id)) continue; seen.add(u.update_id); if (seen.size > 500) seen.delete(seen.values().next().value);
      const m = u.message, cb = u.callback_query;
      try {
        if (cb) { if (String(cb.message && cb.message.chat && cb.message.chat.id) !== CHAT) continue; await handleCallback(cb); }
        else if (m && m.text) {
          if (String(m.chat.id) !== CHAT) { log("다른 방의 글은 무시:", m.chat.type); continue; }   /* 이 방(설정된 TG_CHAT_ID)만 */
          if (Date.now() / 1000 - m.date > 20 * 60) { log("오래된 글 건너뜀:", m.text.slice(0, 20)); continue; }
          log("받음:", m.text.slice(0, 60));
          await handleText(m.text, m.from);
        }
      } catch (e) { log("업데이트 처리 오류", String((e && e.message) || e).slice(0, 200)); }
      await W("tg_bot_offset", { next: offset, at: Date.now() });   /* 처리한 데까지 기록 → 재시작해도 다시 처리 안 함 */
    }
  }
  log("실행 시간 끝 — 종료(다음 실행이 이어받음)");
  try { stripLive(C.bars); saveBars(CACHE, C.bars); flushCardCache(CACHE); if (BR) await BR.close(); } catch (e) {}
  process.exit(0);
}
main().catch((e) => { console.error("챗봇 오류:", e && e.stack || e); process.exit(1); });
