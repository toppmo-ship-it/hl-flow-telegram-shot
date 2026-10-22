/* 차트스캐너 텔레그램 자동 사진 전용 작업(GitHub Actions: chartscan.yml) — 다른 발송(흐름차트·카드·리포트·추세)과 완전히 따로 돈다.
   - 한 번 시작하면 CS_LOOP_MS(기본 22분) 동안 20초마다: ① 차트스캐너 상단 「텔레그램」 버튼의 「지금 보내기」(cs_shot_cmd) ② 정해 둔 주기(5/15/30분, 시계 격자)를 확인
   - 하는 일: 사용자가 마지막에 저장한 차트스캐너 설정(chartscan_state_v1: 선택한 칸의 지표·눈금·시간대·테마·인버스·조건검색식)을 그대로 읽어
     헤드리스 크롬으로 https://hl-chartscan.vercel.app/?shot=1 (촬영 모드: 아무것도 저장 안 함)을 열고 → 조건검색 결과를 걸러서 → 종목마다 고화질 사진으로 찍어 텔레그램 기본 방으로 보냄
   - 순서: 조건검색 결과(가장 중요한 종목이 맨 마지막 — 인버스면 하락이 가장 큰 종목) → 맨 끝에 항상 나스닥 · S&P500 · 브렌트유 · 미국10년물
   - 사진(미리보기) + 원본 PNG 파일(BTC_4h_20261023_0607.png 형식)을 같이 보냄(원본은 설정에서 끌 수 있음)
   환경변수: TG_BOT_TOKEN · TG_CHAT_ID · CHROME_PATH(선택) · CS_URL(시험용 주소) · CS_DRY=1(보내지도 저장하지도 않고 사진만 CS_SAVE 폴더에) · CS_ONCE=1(한 번 만들고 끝) · CS_CFG_JSON(설정 덮어쓰기) */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { sbGet, sbPut } from "./sb.mjs";

const BASE = (process.env.CS_URL || "https://hl-chartscan.vercel.app").replace(/\/$/, "");
const DRY = /^(1|true)$/i.test(process.env.CS_DRY || ""), ONCE = /^(1|true)$/i.test(process.env.CS_ONCE || "");
const LOOP_MS = +process.env.CS_LOOP_MS || 22 * 60000, TICK_MS = 20000;
const SAVE_DIR = process.env.CS_SAVE || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19), ...a);
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const tgToken = () => clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, "");
const chatId = () => clean(process.env.TG_CHAT_ID);   /* 종목 카드와 같은 기본 방 */
const MACRO = ["XYZ100", "SP500", "BRENTOIL", "10Y"];   /* 나스닥100 · S&P500 · 브렌트유 · 미국10년물 — 항상 맨 끝 */
const pad = (n) => String(n).padStart(2, "0");
const kstParts = (t) => { const d = new Date(t + 9 * 3600e3); return { ymd: "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()), hm: pad(d.getUTCHours()) + pad(d.getUTCMinutes()), text: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " KST" }; };
const fmtPx = (v) => (v == null || !isFinite(v) ? "" : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4));

/* ── 텔레그램 ── */
const formsrc = new WeakMap();
function mkForm(fields, file) { const f = new FormData(); Object.entries(fields).forEach(([k, v]) => f.append(k, v)); f.append(file.field, new Blob([file.buf], { type: "image/png" }), file.name); formsrc.set(f, { fields, file }); return f; }
async function tg(method, form) {
  for (let a = 0; a < 3; a++) {
    const body = a === 0 ? form : (() => { const s = formsrc.get(form); return s ? mkForm(s.fields, s.file) : form; })();
    const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/" + method, { method: "POST", body, signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 && a < 2) { const w = Math.min(60, +(j.parameters && j.parameters.retry_after) || 10); log("텔레그램 429 — " + w + "초 대기"); await sleep((w + 1) * 1000); continue; }
    if (!r.ok || !j.ok) throw new Error("텔레그램 " + method + " 실패 " + r.status + " " + (j.description || ""));
    return j.result;
  }
}
const sendPhoto = (buf, caption, name) => tg("sendPhoto", mkForm({ chat_id: chatId(), caption }, { field: "photo", buf, name })).then((r) => r && r.message_id);
const sendDocument = (buf, name, replyTo) => tg("sendDocument", mkForm(Object.assign({ chat_id: chatId(), disable_content_type_detection: "true" }, replyTo ? { reply_to_message_id: String(replyTo) } : {}), { field: "document", buf, name }));

/* ── 상태(차트스캐너 상단 버튼이 읽음): cs_shot_state ── */
const S = { last: 0, lastCmd: "", retryAt: 0, run: process.env.GITHUB_RUN_NUMBER || String(Date.now()), status: { state: "idle", pct: 0, label: "대기", updated: Date.now() }, info: null };
let lastPost = 0;
async function post(force) {
  if (DRY) return;
  const now = Date.now(); if (!force && now - lastPost < 2500) return; lastPost = now; S.status.updated = now;
  await sbPut("cs_shot_state", { last: S.last, lastCmd: S.lastCmd, run: S.run, status: S.status, info: S.info, at: now });
}
const setStatus = (state, pct, label, force) => { S.status = Object.assign({}, S.status, { state, pct: Math.round(pct), label }); return post(force); };

/* 「지금 보내기」를 다시 눌렀거나(설정이 바뀐 것) 정기 전송 중에 끔으로 바꿨으면 → 진행 중이던 전송을 멈추고, 새 요청으로 처음부터 다시 */
async function superseded(manual) {
  const [cmd, cfg] = await Promise.all([sbGet("cs_shot_cmd"), manual ? null : sbGet("cs_shot_cfg")]);
  if (cmd && cmd.id && cmd.id !== S.lastCmd) return "새 「지금 보내기」 요청";
  if (!manual && cfg && cfg.on === false) return "전송을 껐음";
  return "";
}

/* ── 한 번 만들어서 보내기 ── */
async function launch() {
  let err;
  for (let i = 1; i <= 3; i++) {
    try { return await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage", "--font-render-hinting=none", "--force-color-profile=srgb"], timeout: 60000 }); }
    catch (e) { err = e; log("크롬 시작 실패 " + i + "/3:", String((e && e.message) || e).slice(0, 100)); await sleep(3000); }
  }
  throw err;
}

async function runOnce({ manual, cfg }) {
  const t0 = Date.now();
  await setStatus("running", 3, manual ? "「지금 보내기」 처리 시작" : "정기 전송 시작", true);
  const hb = setInterval(() => { post(true).catch(() => {}); }, 15000);
  let browser = null;
  try {
    const row = await sbGet("chartscan_state_v1"), state = row && row.state;
    if (!state || !(state.cfgs || []).length) throw new Error("저장된 차트스캐너 설정이 없어요 (사이트를 한 번 열어 설정을 저장해 주세요)");
    /* 선명도: 화면을 작게(1280x720) 잡고 4배로 그림 → 글자가 사진 안에서 상대적으로 크고, 원본은 5120x2880. 사진(미리보기)은 여기서 2560x1440으로 줄여(Lanczos) 텔레그램이 다시 줄이지 않게 함 */
    const W = 1280, H = 720, DSF = [2, 3, 4].includes(+cfg.scale) ? +cfg.scale : 4;
    browser = await launch();
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("페이지 오류:", String(e.message).slice(0, 140)));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
    await page.evaluateOnNewDocument((st, saved) => { try { localStorage.setItem("hlcs_state_v1", st); if (saved) localStorage.setItem("hlcs_scr_saved_v1", saved); } catch (e) { /* 무시 */ } }, JSON.stringify(state), row.saved || "");
    await setStatus("running", 8, "차트스캐너 여는 중", true);
    await page.goto(BASE + "/?shot=1", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.__shot, { timeout: 60000 });
    if (!(await page.evaluate(() => window.__shot.booted()))) throw new Error("차트스캐너가 시작되지 않았어요");
    await setStatus("running", 14, "조건검색 결과 계산 중", true);
    const L = await page.evaluate(() => window.__shot.list());
    { const why = await superseded(manual); if (why) { log("⏹ 중지 — " + why); S.again = true; await setStatus("idle", 0, "중지됨 (" + why + ")", true); return false; } }
    log("조건검색 " + L.rows.length + "종목 통과 (범위 " + L.universe + "종목, 계산 " + L.scanned + ") · 인버스 " + (L.inv ? "켬" : "끔"));
    const max = [5, 10, 15, 20].includes(+cfg.max) ? +cfg.max : 10;
    /* 가장 중요한 종목이 맨 마지막: 일반 검색은 상승이 큰 종목, 인버스 검색은 하락이 큰(마이너스가 가장 큰) 종목 */
    const macroCoins = await page.evaluate((n) => window.__shot.resolve(n), MACRO);
    const macroSet = new Set(macroCoins);
    const byImp = L.rows.filter((r) => !macroSet.has(r.coin)).sort((a, b) => (L.inv ? a.chg - b.chg : b.chg - a.chg));   /* 중요한 순(가장 중요한 것이 앞) */
    const picked = byImp.slice(0, max).reverse();   /* 거꾸로 → 가장 중요한 것이 맨 마지막 */
    const jobs = picked.map((r, i) => ({ coin: r.coin, kind: "scan", i: i + 1, n: picked.length, total: byImp.length })).concat(macroCoins.map((c) => ({ coin: c, kind: "macro" })));
    log("보낼 차트 " + jobs.length + "장 (조건검색 " + picked.length + " + 기본 " + macroCoins.length + ")");
    let sent = 0, fail = 0; const now = kstParts(Date.now());
    for (let k = 0; k < jobs.length; k++) {
      const j = jobs[k];
      { const why = k > 0 ? await superseded(manual) : ""; if (why) { log("⏹ 중지 — " + why + " (" + k + "/" + jobs.length + "장 보낸 뒤)"); S.again = true; await setStatus("idle", 0, "중지됨 (" + why + ") — 새로 시작", true); return false; } }
      await setStatus("running", 18 + 76 * k / jobs.length, "차트 " + (k + 1) + "/" + jobs.length + " 찍는 중", false);
      try {
        const r = await page.evaluate((c) => window.__shot.show(c), j.coin);
        if (!r.ok) { log("차트 로딩 실패:", j.coin, "(봉 " + r.n + ")"); fail++; continue; }
        const d = await page.evaluate((c) => window.__shot.describe(c), j.coin);
        const stamp = (d.ko || d.short) + " · " + d.ivKo + " · " + now.text + (j.kind === "scan" ? " · 조건검색 " + j.i + "/" + j.n + (L.inv ? " · INVERSE" : "") : " · 기본");
        await page.evaluate((t) => window.__shot.stamp(t), stamp);
        await sleep(250);
        const buf = Buffer.from(await page.screenshot({ type: "png" }));   /* 원본(무손실) */
        const small = await sharp(buf).resize({ width: 2560, kernel: "lanczos3" }).sharpen({ sigma: 0.6, m1: 0.8, m2: 1.2 }).png({ compressionLevel: 9 }).toBuffer();   /* 사진용 2560x1440 */
        const nm = (d.tk || d.short).replace(/[^A-Za-z0-9가-힣._-]+/g, "_") + "_" + d.iv + "_" + now.ymd + "_" + now.hm + ".png";
        const sgn = d.chg == null ? "" : (d.chg >= 0 ? "+" : "") + d.chg.toFixed(2) + "%";
        const cap = (j.kind === "scan" ? (L.inv ? "🔻" : "🔺") : "📌") + " " + (d.ko ? d.ko + " (" + d.tk + ")" : d.tk || d.short) + " · " + d.ivKo + "\n" + [fmtPx(d.px), sgn].filter(Boolean).join("  ") + (j.kind === "scan" ? "\n조건검색 " + j.i + "/" + j.n + (j.total > j.n ? " (통과 " + j.total + "종목 중)" : "") + (L.inv ? " · INVERSE 검색" : "") : "\n기본 시장 지표") + "\n" + nm;
        log((k + 1) + "/" + jobs.length, nm, Math.round(buf.length / 1024) + "KB 원본 · 사진 " + Math.round(small.length / 1024) + "KB", r.ms + "ms");
        if (SAVE_DIR) { fs.mkdirSync(SAVE_DIR, { recursive: true }); fs.writeFileSync(path.join(SAVE_DIR, String(k + 1).padStart(2, "0") + "_" + nm), buf); }
        if (DRY) { sent++; continue; }
        let mid = null;
        if (small.length < 9.5e6) { try { mid = await sendPhoto(small, cap, nm); } catch (e) { log("사진 전송 실패:", String((e && e.message) || e).slice(0, 120)); } }
        if (cfg.doc !== false || !mid) { try { await sendDocument(buf, nm, mid); } catch (e) { log("원본 전송 실패:", String((e && e.message) || e).slice(0, 120)); if (!mid) { fail++; continue; } } }
        sent++; await sleep(1200);   /* 텔레그램 분당 전송 제한(방당 ~20건) 여유 */
      } catch (e) { log("차트 실패:", j.coin, String((e && e.message) || e).slice(0, 140)); fail++; }
    }
    S.last = Date.now(); S.retryAt = 0; S.info = { sent, fail, scan: picked.length, macro: macroCoins.length, passed: L.rows.length, inv: !!L.inv, sec: Math.round((Date.now() - t0) / 1000) };
    await setStatus("done", 100, "완료 · " + sent + "장 · " + S.info.sec + "초", true);
    log("전송 완료 " + sent + "장 (실패 " + fail + ") " + S.info.sec + "초");
    return true;
  } finally { clearInterval(hb); if (browser) await browser.close().catch(() => {}); }
}

/* ── 정해진 주기(시계 격자): 5/15/30분마다, 봉이 막 마감한 뒤(+45초)에 맞춰 ── */
const slotOf = (t, every) => Math.floor((t - 45000) / (every * 60000));
async function tick() {
  const [cfg0, cmd, mute] = await Promise.all([sbGet("cs_shot_cfg"), sbGet("cs_shot_cmd"), sbGet("tg_bot_mute")]);
  const cfg = Object.assign({}, cfg0 || {}, process.env.CS_CFG_JSON ? JSON.parse(process.env.CS_CFG_JSON) : {}), every = [5, 15, 30].includes(+cfg.every) ? +cfg.every : 5, now = Date.now();
  if (cmd && cmd.id && cmd.id !== S.lastCmd) {   /* 상단 「텔레그램」 → 「지금 보내기」 — 꺼져 있어도 보냄 */
    S.lastCmd = cmd.id; log("📤 「지금 보내기」 요청 (" + cmd.id + ")");
    await post(true); await runOnce({ manual: true, cfg }); return true;
  }
  if (cfg.on !== true || now < S.retryAt) return false;
  if (mute && +mute.until > now) return false;
  if (slotOf(now, every) > slotOf(S.last || 0, every)) { log("정기 전송 시각 (" + every + "분마다)"); await runOnce({ manual: false, cfg }); return true; }
  return false;
}

async function main() {
  const st0 = DRY ? null : await sbGet("cs_shot_state");
  if (st0) { S.last = +st0.last || 0; S.lastCmd = st0.lastCmd || ""; S.info = st0.info || null; }
  if (!DRY && (!tgToken() || !chatId())) { log("TG_BOT_TOKEN / TG_CHAT_ID 가 설정되지 않아 건너뜀"); return; }
  log("차트스캐너 사진 작업 시작 · 마지막 전송 " + (S.last ? new Date(S.last + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ") + " KST" : "없음") + (DRY ? " · dry" : "") + " · " + BASE);
  if (ONCE) { const c0 = await sbGet("cs_shot_cmd"); S.lastCmd = c0 && c0.id ? c0.id : ""; const cfg = Object.assign({ max: 10, doc: true }, (await sbGet("cs_shot_cfg")) || {}, process.env.CS_CFG_JSON ? JSON.parse(process.env.CS_CFG_JSON) : {}); await runOnce({ manual: true, cfg }); return; }
  const end = Date.now() + LOOP_MS; await setStatus("idle", 0, "대기 중", true);
  while (Date.now() < end) {
    try { const did = await tick(); if (!did && S.status.state !== "idle" && S.status.state !== "done") await setStatus("idle", 0, "대기 중"); }
    catch (e) { log("오류:", String((e && e.message) || e).slice(0, 200)); S.retryAt = Date.now() + 60000; await setStatus("error", 0, "오류: " + String((e && e.message) || e).slice(0, 80), true); }
    if (Date.now() - lastPost > 60000) await post(true);
    if (S.again) S.again = false; else await sleep(TICK_MS);   /* 중지하고 새 요청으로 다시 시작할 땐 기다리지 않고 바로 */
  }
  log("이번 실행 종료(다음 실행이 이어받음)");
}
main().then(() => process.exit(0)).catch((e) => { console.error("치명적 오류:", e); process.exit(1); });
