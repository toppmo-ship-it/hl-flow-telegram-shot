/* 5프레임 추세 리포트 전용 작업(GitHub Actions: trend.yml) — 다른 발송(흐름차트·카드·순위·하이퍼 리포트)과 완전히 따로 돈다.
   - 한 번 시작하면 TREND_LOOP_MS(기본 22분) 동안 20초마다: ① 설정 페이지의 「지금 보내기」 요청(tg_trend_cmd) ② 정해진 주기(5/15/30/60분, 시계 격자에 맞춤)를 확인
   - 발송 = 리포트 전용 방(TG_CHAT_ID2, 비면 기본 방)에 사진 + 원본 파일. 사진을 못 그리면 글로 대신
   - 진행 상황은 Supabase tg_trend_state 에 계속 남김(설정 페이지가 읽어 보여 줌 · 15초마다 심장박동) — '응답 없음' 오경보 방지
   - 캔들은 .cache/trendbars.json 에 저장해 두고, 마감된 봉이 새로 생겼을 때만 새로 받음(trendrep.mjs)
   환경변수: TG_BOT_TOKEN · TG_CHAT_ID · TG_CHAT_ID2 · CHROME_PATH(선택) · TREND_DRY=1(보내지도 저장하지도 않음) · TREND_ONCE=1(한 번 만들고 끝) · TREND_SAVE=파일(만든 사진 저장) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { loadUniverse, loadSiteInfo, usdKrw, normRes } from "./extras.mjs";
import { buildTrendData, trendText } from "./trendrep.mjs";
import { buildTrendSpec } from "./trendspec.mjs";
import { sbGet, sbPut } from "./sb.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url)), CACHE = path.join(ROOT, ".cache"), SITE = path.join(ROOT, "site");
const DRY = /^(1|true)$/i.test(process.env.TREND_DRY || ""), ONCE = /^(1|true)$/i.test(process.env.TREND_ONCE || "");
const LOOP_MS = +process.env.TREND_LOOP_MS || 22 * 60000, TICK_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19), ...a);
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const tgToken = () => clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, "");
const chatId = () => clean(process.env.TG_CHAT_ID2) || clean(process.env.TG_CHAT_ID);   /* 리포트 전용 방, 비어 있으면 기본 방 */
const OUT_W = { fcover: 1800, fwide: 2800, pcxl: 3400 };   /* 사진 가로 픽셀(해상도 설정별) — 선명하게. 가로+세로 ≤ 9800 은 그리기 쪽에서 지킴 */

/* ── 텔레그램 ── */
async function tg(method, body, isForm) {
  for (let a = 0; a < 2; a++) {
    const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/" + method, isForm ? { method: "POST", body, signal: AbortSignal.timeout(60000) } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 && a === 0) { const w = Math.min(60, +(j.parameters && j.parameters.retry_after) || 10); log("텔레그램 429 — " + w + "초 대기 후 재시도"); await sleep((w + 1) * 1000); if (isForm) body = cloneForm(body); continue; }
    if (!r.ok || !j.ok) throw new Error("텔레그램 " + method + " 실패 " + r.status + " " + (j.description || ""));
    return j.result;
  }
}
const formsrc = new WeakMap();
function cloneForm(f) { const s = formsrc.get(f); return s ? mkForm(s.fields, s.file) : f; }
function mkForm(fields, file) { const f = new FormData(); Object.entries(fields).forEach(([k, v]) => f.append(k, v)); f.append(file.field, new Blob([file.buf], { type: "image/png" }), file.name); formsrc.set(f, { fields, file }); return f; }
const sendPhoto = (buf, caption) => tg("sendPhoto", mkForm({ chat_id: chatId(), caption }, { field: "photo", buf, name: "trend.png" }), true).then((r) => r && r.message_id);
const sendDocument = (buf, name, replyTo) => tg("sendDocument", mkForm(Object.assign({ chat_id: chatId(), disable_content_type_detection: "true" }, replyTo ? { reply_to_message_id: String(replyTo) } : {}), { field: "document", buf, name }), true);
async function sendText(text) {
  const lines = text.split("\n"), chunks = []; let cur = "";
  for (const ln of lines) { if ((cur + "\n" + ln).length > 3900) { chunks.push(cur); cur = ln; } else cur = cur ? cur + "\n" + ln : ln; }
  if (cur) chunks.push(cur);
  for (const c of chunks) await tg("sendMessage", { chat_id: chatId(), text: c, disable_web_page_preview: true }, false);
}

/* ── 사진 그리기(하이퍼 리포트와 같은 rep-render.js) — 10MB 넘으면 가로를 줄여 다시 ── */
async function renderPhoto(spec, W0) {
  let browser = null, err;
  for (let i = 1; i <= 3 && !browser; i++) {
    try { browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: { width: 1600, height: 1000 }, timeout: 60000 }); }
    catch (e) { err = e; log("크롬 시작 실패 " + i + "/3:", String((e && e.message) || e).slice(0, 100)); await sleep(3000); }
  }
  if (!browser) throw err;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("사진 페이지 오류:", String(e.message).slice(0, 140)));
    await page.setContent("<html><body style='margin:0;background:#0a101f'></body></html>");
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, "rep-render.js"), "utf8") });
    let buf = null;
    for (let k = 0, w = W0; k < 3; k++, w = Math.round(w * 0.8)) {
      const r = await page.evaluate((sp) => window.drawReport(sp), { header: spec.header, sections: spec.sections, foot: spec.foot, theme: spec.theme, outW: w });
      buf = Buffer.from(r.url.split(",")[1], "base64"); log("사진", r.w + "x" + r.h, Math.round(buf.length / 1024) + "KB");
      if (buf.length < 9.5e6) break;
    }
    return buf;
  } finally { await browser.close(); }
}

/* ── 상태(설정 페이지·챗봇이 읽음): tg_trend_state ── */
const S = { last: 0, lastCmd: "", retryAt: 0, run: process.env.GITHUB_RUN_NUMBER || String(Date.now()), status: { state: "idle", pct: 0, label: "대기", updated: Date.now() }, info: null };
let postTimer = 0, lastPost = 0;
async function post(force) {
  if (DRY) return;
  const now = Date.now(); if (!force && now - lastPost < 2500) return; lastPost = now; S.status.updated = now;
  await sbPut("tg_trend_state", { last: S.last, lastCmd: S.lastCmd, run: S.run, status: S.status, info: S.info, at: now });
}
const setStatus = (state, pct, label, force) => { S.status = Object.assign({}, S.status, { state, pct: Math.round(pct), label }); if (state === "running") S.status.started = S.status.started || Date.now(); return post(force); };

/* ── 한 번 만들어서 보내기 ── */
async function runOnce({ manual, cfg }) {
  const t0 = Date.now(); S.status.started = t0;
  await setStatus("running", 3, manual ? "「지금 보내기」 요청 처리 시작" : "정기 발송 시작", true);
  const hb = setInterval(() => { post(true).catch(() => {}); }, 15000);   /* 15초마다 심장박동 — 오래 걸려도 '응답 없음'으로 보이지 않게 */
  try {
    const info = loadSiteInfo(SITE);
    await setStatus("running", 6, "종목·환율 불러오는 중");
    const uni = await loadUniverse(log), fx = await usdKrw(log);
    const prev = await sbGet("tg_trend_prev");
    const topN = [30, 50, 80].includes(+cfg.trendTop) ? +cfg.trendTop : 50;
    const data = await buildTrendData({
      uni, info, fx, log, cacheDir: CACHE, topN, minEok: cfg.trendMinEok != null ? +cfg.trendMinEok : 10, budgetMs: manual ? 9 * 60000 : 7 * 60000, prev,
      onProgress: (p) => { setStatus("running", 8 + 62 * p.done / Math.max(1, p.total), "캔들 확인 " + p.done + "/" + p.total + "종목" + (p.staleFrames ? " · 지연 " + p.staleFrames : "")).catch(() => {}); },
    });
    log("계산 완료 " + data.stats.n + "종목 · " + Math.round(data.stats.ms / 1000) + "초 · 갱신 지연 " + data.stale + " (" + Math.round(data.staleRatio * 100) + "%)");
    if (!manual && data.staleRatio > 0.25) {   /* 캐시가 덜 찬 첫 실행 등 — 반쯤 오래된 리포트를 보내지 않고 1분 뒤 이어서 */
      S.retryAt = Date.now() + 60000;
      await setStatus("running", 70, "데이터 수집 이어가는 중 (지연 " + Math.round(data.staleRatio * 100) + "%) — 1분 뒤 다시", true);
      log("지연 프레임이 25% 넘어 이번엔 보내지 않고 이어서 받습니다"); return false;
    }
    await setStatus("running", 74, "사진 그리는 중");
    const spec = buildTrendSpec({ data, info, fx });
    let photo = null;
    try { photo = await renderPhoto(spec, OUT_W[normRes(String(cfg.res || "fwide"))] || 2800); } catch (e) { log("사진 그리기 실패 — 글로 대신 보냅니다:", String((e && e.message) || e).slice(0, 160)); }
    if (photo && process.env.TREND_SAVE) fs.writeFileSync(process.env.TREND_SAVE, photo);
    if (DRY) { log("dry — 전송·저장 생략 (" + (photo ? "사진 " + Math.round(photo.length / 1024) + "KB" : "글") + ")"); if (!photo) console.log(trendText(data, info)); return true; }
    await setStatus("running", 88, "텔레그램으로 보내는 중", true);
    if (photo) {
      const mid = await sendPhoto(photo, spec.caption);
      if (cfg.doc !== false) { try { const d = new Date(Date.now() + 9 * 3600e3), p = (n) => String(n).padStart(2, "0"); await sendDocument(photo, "trend_" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "_" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + ".png", mid); } catch (e) { log("원본 문서 전송 실패:", String((e && e.message) || e).slice(0, 120)); } }
    } else await sendText(trendText(data, info));
    await sbPut("tg_trend_prev", data.state);
    S.last = Date.now(); S.retryAt = 0; S.info = { n: data.stats.n, sec: Math.round((Date.now() - t0) / 1000), stale: data.stale, flips: data.flips.length, photo: !!photo };
    await setStatus("done", 100, "완료 · " + S.info.sec + "초", true);
    log("발송 완료 " + S.info.sec + "초");
    return true;
  } finally { clearInterval(hb); }
}

/* ── 정해진 주기(시계 격자): 5/15/30/60분마다, 봉이 막 마감한 뒤(+45초)에 맞춰 ── */
const slotOf = (t, every) => Math.floor((t - 45000) / (every * 60000));
async function tick() {
  const [cfg0, cmd, mute] = await Promise.all([sbGet("tg_shot_cfg"), sbGet("tg_trend_cmd"), sbGet("tg_bot_mute")]);
  const cfg = Object.assign({}, cfg0 || {}, process.env.TREND_CFG_JSON ? JSON.parse(process.env.TREND_CFG_JSON) : {}), every = [5, 15, 30, 60].includes(+cfg.trendEvery) ? +cfg.trendEvery : 15, now = Date.now();
  if (cmd && cmd.id && cmd.id !== S.lastCmd) {   /* 설정 페이지의 「지금 보내기」 — 꺼져 있어도 보냄 */
    S.lastCmd = cmd.id; log("📤 「지금 보내기」 요청 (" + cmd.id + ")");
    await post(true); await runOnce({ manual: true, cfg }); return true;
  }
  if (cfg.trendOn !== true || now < S.retryAt) return false;
  if (mute && +mute.until > now) return false;
  if (slotOf(now, every) > slotOf(S.last || 0, every)) { log("정기 발송 시각 (" + every + "분마다)"); await runOnce({ manual: false, cfg }); return true; }
  return false;
}

async function main() {
  const st0 = DRY ? null : await sbGet("tg_trend_state");
  if (st0) { S.last = +st0.last || 0; S.lastCmd = st0.lastCmd || ""; S.info = st0.info || null; }
  if (!DRY && (!tgToken() || !chatId())) { log("TG_BOT_TOKEN / TG_CHAT_ID 가 설정되지 않아 건너뜀"); return; }
  log("추세 리포트 작업 시작 · 마지막 발송 " + (S.last ? new Date(S.last + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ") + " KST" : "없음") + (DRY ? " · dry" : ""));
  if (ONCE) { const cfg = Object.assign({}, (await sbGet("tg_shot_cfg")) || {}, process.env.TREND_CFG_JSON ? JSON.parse(process.env.TREND_CFG_JSON) : {}); await runOnce({ manual: true, cfg }); return; }
  const end = Date.now() + LOOP_MS; await setStatus("idle", 0, "대기 중", true);
  while (Date.now() < end) {
    try { const did = await tick(); if (!did && S.status.state !== "idle" && S.status.state !== "done") await setStatus("idle", 0, "대기 중"); }
    catch (e) { log("오류:", String((e && e.message) || e).slice(0, 200)); S.retryAt = Date.now() + 60000; await setStatus("error", 0, "오류: " + String((e && e.message) || e).slice(0, 80), true); }
    if (Date.now() - lastPost > 60000) await post(true);   /* 대기 중에도 1분마다 심장박동 */
    await sleep(TICK_MS);
  }
  log("이번 실행 종료(다음 실행이 이어받음)");
}
main().then(() => process.exit(0)).catch((e) => { console.error("치명적 오류:", e); process.exit(1); });
