/* 흐름차트 → 텔레그램 자동 발송 (GitHub Actions 실행기)
   - 이 저장소의 site/ (흐름차트 화면) 를 자기 안에서 열고(로컬 서버), /api/flow-fetch 도 로컬에서 처리 → Vercel·로그인 우회키 불필요
   - 헤드리스 크롬으로 /flow.html?shot=1 을 열어 캡처 → 텔레그램 사진 + 원본 PNG 문서
   - 설정(기간·봉·필터·해상도 등)은 Supabase hlgrid_settings 의 tg_shot_cfg (설정 페이지에서 변경) — 이 값을 5분마다 읽음
   - 캔들 저장본은 .cache/store.json (GitHub 캐시로 실행 간 이어받음) + Supabase 백업(1시간 간격)
   환경변수: TG_BOT_TOKEN, TG_CHAT_ID (GitHub Secrets), 선택: SHOT_DRY=1(전송 안 함), SHOT_OVERRIDES="res=pc&vz=200", CHROME_PATH */
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSiteInfo, loadUniverse, usdKrw, buildWeeklyTexts, buildSurgeText, pickRow, buildCardData, renderCard, flushCardCache, buildPatternRankText } from "./extras.mjs";
import { buildReport } from "./report.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, "site");
const CACHE = path.join(ROOT, ".cache");
const STORE_FILE = path.join(CACHE, "store.json");

const SBU = "https://atauxczcjtvcrjjlnapm.supabase.co";
/* 사이트(flow-data.js)가 브라우저에서 이미 쓰는 공개(anon) 키와 같은 값 */
const SBK = process.env.SB_OFF ? "" : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXV4Y3pjanR2Y3JqamxuYXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTMxMzgsImV4cCI6MjA5MjA2OTEzOH0.jyB9SGyjdaHYRw8MpktX8dHtKOgA6rbGTJbdrycnXgA";
const STORE_KEY = "flow_srv_raw_v2";   /* v2: 일봉에 거래량 포함 + 봉 간격별 원본 캔들(raw[iv]) */
const CFG_KEY = "tg_shot_cfg";
const DEF_CFG = { frame: "20D", iv: "15m", vol: ["v4", "v3"], kel: ["above", "mid"], lead: false, alt: false, sectors: null, idx: ["XYZ100", "KR200", "SP500"], cmd: ["BRENTOIL"], sw: 2, swi: 3, swc: 3, cardIv: "4h", cardDays: 60 };
/* 해상도 프리셋: 화면(CSS) 크기 × 배율 = 사진 픽셀. 폴드는 거의 정사각형, PC는 16:9 와이드 */
const RES = {
  fcover: { w: 900, h: 1996, dsf: 1.2, fixed: true, label: "폴드 접힘 세로 1080×2395" },   /* 폴드 접은(커버) 화면 세로에 꽉 차게(비율 9:20) */
  fwide: { w: 1092, h: 921, dsf: 2, fixed: true, label: "폴드 펼침 가로 2184×1842" },   /* 폴드 펼친 화면을 가로로 돌렸을 때 꽉 차게(비율 1.186) */
  pcxl: { w: 1920, h: 1080, dsf: 5 / 3, fixed: true, label: "PC 16:9 3200×1800" },   /* PC 가로 와이드 고해상도 */
};
const normRes = (v) => (RES[v] ? v : (v === "wide" || v === "pc" ? "pcxl" : "fwide"));   /* 예전 값(fold·wide·pc)은 가장 가까운 새 3종으로 */
const MAX_PIXELS = 24e6;   /* 실행기는 CPU가 충분 → 큰 사진도 가능(텔레그램 사진은 변 합 10000px 이하) */

const sbH = () => ({ apikey: SBK, Authorization: "Bearer " + SBK });
let lastUpload = 0;
async function sbRead(key) {
  if (!SBK) return null;
  try {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value,updated_at&key=eq." + key, { headers: sbH() });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    const v = rows[0].value;
    const js = v && v.z && v.d ? zlib.gunzipSync(Buffer.from(v.d, "base64")).toString("utf8") : JSON.stringify(v);
    if (key === STORE_KEY) lastUpload = Date.parse(rows[0].updated_at) || 0;
    return JSON.parse(js);
  } catch (e) { return null; }
}
async function sbWriteStore(obj) {
  if (!SBK) return false;
  try {
    const d = zlib.gzipSync(Buffer.from(JSON.stringify(obj))).toString("base64");
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?on_conflict=key", {
      method: "POST", headers: { ...sbH(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: STORE_KEY, value: { z: 1, d }, updated_at: new Date().toISOString() }),
    });
    if (r.ok) lastUpload = Date.now();
    return r.ok;
  } catch (e) { return false; }
}
async function loadStore() {
  try { if (fs.existsSync(STORE_FILE)) { const m = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); if (m && m.ver === 2) { lastUpload = m.t || 0; return { store: m, from: "캐시" }; } } } catch (e) {}
  const r = await sbRead(STORE_KEY);
  return r && r.ver === 2 ? { store: r, from: "Supabase" } : { store: null, from: "없음" };
}

/* ── 로컬 서버: site/ 정적 파일 + /api/flow-fetch (원래 Vercel 함수 코드를 그대로 씀) ── */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".txt": "text/plain", ".json": "application/json", ".png": "image/png" };
async function startServer() {
  const { default: flowFetch } = await import(pathToFileURL(path.join(SITE, "api", "flow-fetch.js")).href);
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/api/flow-fetch") {
        req.query = Object.fromEntries(u.searchParams);
        const rs = { setHeader: (k, v) => res.setHeader(k, v), status(c) { this.code = c; return this; }, json(o) { res.writeHead(this.code || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); return this; } };
        await flowFetch(req, rs);
        return;
      }
      const rel = u.pathname === "/" ? "/flow.html" : decodeURIComponent(u.pathname);
      const f = path.resolve(path.join(SITE, rel));
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(f).pipe(res);
    } catch (e) { try { res.writeHead(500); res.end(String(e)); } catch (e2) {} }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

/* 페이지 안에서 실행: 저장본 → IndexedDB (페이지 코드가 읽는 형식 raw|day, raw|<iv>) */
function seedInPage(store, iv) {
  return new Promise((resolve) => {
    const q = indexedDB.open("flowcache", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("frames");
    q.onerror = () => resolve(false);
    q.onsuccess = () => {
      const db = q.result, tx = db.transaction("frames", "readwrite"), os = tx.objectStore("frames");
      const dec = (m) => {
        const out = {};
        Object.keys(m || {}).forEach((tk) => {
          const e = m[tk]; let t = e.t0; const cs = [];
          for (let i = 0; i < e.dt.length; i++) { t += e.dt[i] * 60000; const cd = { t, h: e.h[i], l: e.l[i], c: e.c[i], o: e.c[i] }; if (e.v) cd.v = e.v[i]; cs.push(cd); }
          out[tk] = { t: e.at, candles: cs };
        });
        return out;
      };
      if (store && store.day) os.put({ data: dec(store.day) }, "raw|day");
      if (store && store.raw && store.raw[iv]) os.put({ data: dec(store.raw[iv]) }, "raw|" + iv);
      tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
    };
  });
}
/* 페이지 안에서 실행: 메모리의 원본 캔들 → 압축 저장 형식 */
function dumpInPage(iv) {
  const F = window.__flow; if (!F) return null;
  const enc = (m) => {
    const out = {};
    Object.keys(m || {}).forEach((tk) => {
      const r = m[tk]; if (!r || !r.candles || !r.candles.length) return;
      const cs = r.candles, t0 = Math.round(cs[0].t / 60000), dt = [], h = [], l = [], c = [], v = [];
      const hasV = cs[cs.length - 1].v != null;
      let prev = t0;
      cs.forEach((x, i) => { const tm = Math.round(x.t / 60000); dt.push(i ? tm - prev : 0); prev = tm; h.push(+(+x.h).toPrecision(7)); l.push(+(+x.l).toPrecision(7)); c.push(+(+x.c).toPrecision(7)); if (hasV) v.push(+(+x.v || 0).toPrecision(6)); });
      out[tk] = { at: r.t, t0: t0 * 60000, dt, h, l, c, v: hasV ? v : undefined };
    });
    return out;
  };
  return { ver: 2, day: enc(F.dayC), raw: { [iv]: enc(F.raw && F.raw[iv]) } };
}

const kstText = () => {
  const d = new Date(Date.now() + 9 * 3600e3), p = (n) => String(n).padStart(2, "0"), wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "(" + wd + ") " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " KST";
};
/* Secrets에 따옴표·공백·"bot" 접두어가 섞여 들어가도 정리 */
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const tgToken = () => clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, "");
async function sendPhoto(buf, caption) {
  const form = new FormData();
  form.append("chat_id", clean(process.env.TG_CHAT_ID));
  form.append("caption", caption);
  form.append("photo", new Blob([buf], { type: "image/png" }), "flow.png");
  let r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendPhoto", { method: "POST", body: form });
  let j = await r.json().catch(() => ({}));
  if (r.status === 429) {   /* 분당 발송 한도 — 알려준 시간만큼 기다렸다가 한 번 더 */
    const wait = Math.min(60, +(j.parameters && j.parameters.retry_after) || 10);
    console.log("텔레그램 429 — " + wait + "초 대기 후 재시도");
    await new Promise((ok) => setTimeout(ok, (wait + 1) * 1000));
    r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendPhoto", { method: "POST", body: form });
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok || !j.ok) {
    const t = tgToken();   /* 값은 노출하지 않고 형식만 알려줌 */
    throw new Error("텔레그램 전송 실패 " + r.status + " " + (j.description || "") + " · 토큰 형식: 길이 " + t.length + ", 콜론 " + (t.includes(":") ? "있음" : "없음") + " · chat_id: " + (/^-?\d+$/.test(clean(process.env.TG_CHAT_ID)) ? "숫자형 OK" : "숫자 아님"));
  }
  return j.result && j.result.message_id;
}
async function sendDocument(buf, name, replyTo) {
  const form = new FormData();
  form.append("chat_id", clean(process.env.TG_CHAT_ID));
  form.append("document", new Blob([buf], { type: "image/png" }), name);
  form.append("disable_content_type_detection", "true");
  if (replyTo) form.append("reply_to_message_id", String(replyTo));
  const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendDocument", { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error("원본 문서 전송 실패 " + r.status + " " + (j.description || ""));
  return j.result && j.result.message_id;
}

/* ── 진행 상황을 Supabase(tg_shot_status)에 올림 → 설정 페이지 하단 박스가 2초마다 읽어서 실시간으로 보여줌 ── */
const STATUS_ON = !!SBK && (process.env.SHOT_STATUS === "1" || !/^(1|true)$/i.test(process.env.SHOT_DRY || ""));
const ST = { run: process.env.GITHUB_RUN_NUMBER || String(Date.now()), start: Date.now(), state: "running", pct: 0, label: "시작", lines: [], updated: 0, done: 0 };
let stTimer = null;
async function stPost() {
  ST.updated = Date.now();
  try { await fetch(SBU + "/rest/v1/hlgrid_settings?on_conflict=key", { method: "POST", headers: { apikey: SBK, Authorization: "Bearer " + SBK, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "tg_shot_status", value: ST, updated_at: new Date().toISOString() }) }); } catch (e) {}
}
function stFlush(force) {
  if (!STATUS_ON) return Promise.resolve();
  if (force) { clearTimeout(stTimer); stTimer = null; return stPost(); }
  if (!stTimer) stTimer = setTimeout(() => { stTimer = null; stPost(); }, 1200);
  return Promise.resolve();
}
const stLine = (m) => { ST.lines.push([Date.now(), String(m).slice(0, 220)]); if (ST.lines.length > 40) ST.lines.shift(); };
const log = (...a) => { console.log(new Date().toISOString().slice(11, 19), ...a); stLine(a.map(String).join(" ")); stFlush(); };
const stage = (pct, label) => { ST.pct = Math.max(ST.pct, pct); ST.label = label; stLine("▶ " + label); stFlush(); };

/* ── 추가 기능: 순위 텍스트 · 종목별 카드 (실행 주기 상태는 .cache/state.json 로 이어받음) ── */
const STATE_FILE = path.join(CACHE, "state.json");
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) { return {}; } };
const saveState = (st) => { try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(st)); } catch (e) {} };
const due = (last, everyMin) => !everyMin || !last || Date.now() - last >= everyMin * 60000 - 30000;
async function sendText(text) {
  const lines = text.split("\n"), chunks = []; let cur = "";
  for (const ln of lines) { if ((cur + "\n" + ln).length > 3900) { chunks.push(cur); cur = ln; } else cur = cur ? cur + "\n" + ln : ln; }
  if (cur) chunks.push(cur);
  for (const c of chunks) {
    const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: clean(process.env.TG_CHAT_ID), text: c, disable_web_page_preview: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error("텍스트 전송 실패 " + r.status + " " + (j.description || ""));
  }
}
/* 카드 사진에 답장으로 붙는 패턴 상세 분석 글. 사진은 이미 갔으므로 실패해도 전체를 멈추지 않고 로그만 남김(429는 한 번 재시도) */
async function sendDetail(text, replyTo) {
  const body = { chat_id: clean(process.env.TG_CHAT_ID), text: String(text).slice(0, 4000), disable_web_page_preview: true };
  if (replyTo) body.reply_to_message_id = replyTo;
  for (let a = 0; a < 2; a++) {
    const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return j.result && j.result.message_id;
    if (r.status === 429 && a === 0) { const wait = Math.min(60, +(j.parameters && j.parameters.retry_after) || 10); console.log("텔레그램 429 — " + wait + "초 대기 후 상세 분석 재시도"); await new Promise((ok) => setTimeout(ok, (wait + 1) * 1000)); continue; }
    console.log("상세 분석 전송 실패 " + r.status + " " + (j.description || "")); return null;
  }
  return null;
}
let _uni = null, _fx = null;   /* 같은 실행 안에서 유니버스·환율은 한 번만 받음 */
const getUni = async () => _uni || (_uni = await loadUniverse(log));
const getFx = async () => _fx || (_fx = await usdKrw(log));

/* ── 하이퍼 리포트(사진): 탬퍼몽키 3분 리포트와 같은 구성. 데이터·섹션은 report.mjs, 그리기는 rep-render.js ── */
const REP_W = { fcover: 1360, fwide: 2184, pcxl: 3200 };   /* 해상도 3종 → 리포트 가로 픽셀(세로는 내용만큼) */
async function runReport({ cfg0, q, dry }) {
  const want = q.rep != null ? q.rep === "1" : cfg0.rep !== false;
  if (!want) return;
  const st0 = loadState(), now = Date.now(), force = q.force === "1" || q.rep === "1";
  const every = cfg0.repEvery != null ? +cfg0.repEvery : 15;
  if (!(force || due(st0.lastRep, every))) { log("하이퍼 리포트: 아직 보낼 주기가 아님"); return; }
  stage(90, "하이퍼 리포트 데이터 모으는 중");
  const info = loadSiteInfo(SITE), uni = await getUni(), fx = await getFx();
  const out = await buildReport({ cfg: cfg0, info, uni, fx, cacheDir: CACHE, log, deadline: Date.now() + (+process.env.REP_MS || 130000), limit: +process.env.REP_LIMIT || 0 });
  if (out.skip) { log("하이퍼 리포트:", out.skip); return; }
  log("하이퍼 리포트 데이터 OK", JSON.stringify(out.meta));
  stage(95, "하이퍼 리포트 그리는 중");
  const key = normRes(String(q.res || cfg0.res || "fwide")), W0 = REP_W[key] || 2184;
  const browser = await launchChrome({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: { width: 1600, height: 1000 } });
  let buf = null, dim = "";
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("리포트 페이지 오류:", String(e.message).slice(0, 160)));
    await page.setContent("<html><body style='margin:0;background:#17181c'></body></html>");
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, "rep-render.js"), "utf8") });
    for (let k = 0, w = W0; k < 3; k++, w = Math.round(w * 0.78)) {   /* 텔레그램 사진 10MB 한도 — 넘으면 한 단계 줄여 다시 */
      const r = await page.evaluate((spec) => window.drawReport(spec), { header: out.header, sections: out.sections, foot: out.foot, outW: w });
      buf = Buffer.from(r.url.split(",")[1], "base64"); dim = r.w + "x" + r.h;
      if (buf.length < 9.5e6) break;
    }
  } finally { await browser.close(); }
  log("하이퍼 리포트 PNG", dim, Math.round(buf.length / 1024) + "KB");
  if (process.env.SHOT_SAVE_REPORT) fs.writeFileSync(process.env.SHOT_SAVE_REPORT, buf);
  if (dry) { log("dry 모드 — 리포트 전송 생략"); return; }
  const mid = await sendPhoto(buf, out.caption);
  log("하이퍼 리포트 사진 전송", mid);
  if (cfg0.doc !== false) {
    try { const d = new Date(now + 9 * 3600e3), p = (n) => String(n).padStart(2, "0"); const did = await sendDocument(buf, "report_" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "_" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + ".png", mid); log("리포트 원본 문서 전송", did); }
    catch (e) { log(String((e && e.message) || e)); }
  }
  const st = loadState(); st.lastRep = now; saveState(st);
}

/* ── 텔레그램 방 진단(한 번만): 봇이 이 방의 글을 읽을 수 있는지 확인용. 키·방 번호는 기록하지 않고 종류/권한만 Supabase tg_diag 에 남김 ── */
async function tgDiag() {
  const out = { at: new Date().toISOString() };
  const tg = async (m, p) => { try { const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/" + m, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p || {}) }); return await r.json(); } catch (e) { return { ok: false, description: String(e.message || e) }; } };
  const chat = clean(process.env.TG_CHAT_ID);
  const me = await tg("getMe"); out.bot = me.ok ? { username: me.result.username, can_read_all_group_messages: me.result.can_read_all_group_messages, can_join_groups: me.result.can_join_groups } : { error: me.description };
  const ch = await tg("getChat", { chat_id: chat }); out.chat = ch.ok ? { type: ch.result.type, title: ch.result.type === "private" ? null : (ch.result.title || null), is_forum: !!ch.result.is_forum } : { error: ch.description };
  if (ch.ok && ch.result.type !== "private" && me.ok) { const m = await tg("getChatMember", { chat_id: chat, user_id: me.result.id }); out.member = m.ok ? { status: m.result.status } : { error: m.description }; }
  const wh = await tg("getWebhookInfo"); out.webhook = wh.ok ? { url_set: !!wh.result.url, pending: wh.result.pending_update_count, last_error: wh.result.last_error_message || null } : { error: wh.description };
  try { await fetch(SBU + "/rest/v1/hlgrid_settings?on_conflict=key", { method: "POST", headers: { apikey: SBK, Authorization: "Bearer " + SBK, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: "tg_diag", value: out, updated_at: new Date().toISOString() }) }); } catch (e) {}
  return out;
}

async function runExtras({ cfg0, q, dry, base }) {
  const flag = (qv, cv) => (qv != null ? qv === "1" : !!cv);
  const wantW = flag(q.rankw, cfg0.rankWeekly), wantS = flag(q.ranks, cfg0.rankSurge);
  const cards = (q.cards != null ? String(q.cards).split(",") : (Array.isArray(cfg0.cards) ? cfg0.cards : [])).map((x) => x.replace(/[^0-9A-Za-z]/g, "")).filter(Boolean).slice(0, 30);   /* 텔레그램 그룹 분당 20건 제한은 아래 발송 간격·429 재시도로 지킴 */
  const wantP = flag(q.rankp, cfg0.rankPattern !== false);   /* 패턴 확률 순위(별도 메시지) — 기본 켬 */
  if (!wantW && !wantS && !wantP && !cards.length) return;
  const st = loadState(), now = Date.now(), force = q.force === "1";
  const dueRank = (wantW || wantS) && (force || due(st.lastRank, +cfg0.rankEvery || 0));
  const dueCards = cards.length && (force || due(st.lastCards, cfg0.cardEvery != null ? +cfg0.cardEvery : 0));
  const dueP = wantP && (force || due(st.lastPat, cfg0.rankPatEvery != null ? +cfg0.rankPatEvery : 60));
  if (!dueRank && !dueCards && !dueP) { log("추가 기능: 아직 보낼 주기가 아님"); return; }
  const info = loadSiteInfo(SITE), uni = await getUni(), fx = await getFx();
  log("추가 기능 시작 — HIP-3 " + uni.length + "종목, 환율 " + fx.toFixed(1));
  if (dueP) {
    stage(73, "패턴 확률 순위 계산 중 (종목 스캔)");
    const tx = await buildPatternRankText({ uni, info, log, cacheDir: CACHE, tf0: String(cfg0.cardIv || "4h"), scanN: 50 });
    for (const t of tx) { if (dry) console.log("\n──── 패턴 확률 순위 ────\n" + t + "\n─────────────────────"); else await sendText(t); }
    log("패턴 확률 순위", tx.length + "건", dry ? "(dry — 출력만)" : "전송");
    st.lastPat = now; flushCardCache(CACHE);
  }
  if (dueRank) {
    stage(75, "순위 데이터 모으는 중");
    const texts = [];
    if (wantW) { const r = await buildWeeklyTexts({ uni, info, fx, cacheDir: CACHE, log }); texts.push(...r.texts); if (r.note) log(r.note); }
    if (wantS) texts.push(...await buildSurgeText({ uni, info, fx, log, cacheDir: CACHE }));
    stage(84, "순위 텍스트 보내는 중");
    for (const t of texts) { if (dry) console.log("\n──── 텔레그램 텍스트 ────\n" + t + "\n─────────────────────"); else await sendText(t); }
    log("순위 텍스트", texts.length + "건", dry ? "(dry — 출력만)" : "전송");
    st.lastRank = now;
  }
  if (dueCards) {
    stage(88, "종목 카드 준비 중");
    const iv = String(cfg0.cardIv || "1h").replace(/[^0-9a-z]/g, ""), days = Math.min(150, Math.max(3, +cfg0.cardDays || 60));
    const browser = await launchChrome({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: { width: 1200, height: 1100, deviceScaleFactor: 2 } });
    try {
      const page = await browser.newPage();
      let n = 0, lastSent = 0;
      for (const t of cards) {
        stage(88 + Math.round(10 * n / Math.max(1, cards.length)), "종목 카드 " + (n + 1) + "/" + cards.length + " 만드는 중 · " + t);
        const row = pickRow(uni, t, info);
        if (!row) { log("카드 종목 없음:", t); continue; }
        const d = await buildCardData({ row, ticker: t, info, iv, days, fx, log, cacheDir: CACHE, mode: cfg0.mode });
        if (!d) { log("카드 데이터 부족:", t); continue; }
        d.colors = cfg0.colors || null;
        /* 일봉 미니차트(카드 왼쪽 아래): 켜기·크기·일봉 개수·넣을 지표. 패턴·패턴 글자는 항상 없음. 기본값 = 켬 · 보통 · 60개 · 지표 전부 */
        { const ind = Array.isArray(cfg0.cardDailyInd) ? cfg0.cardDailyInd : ["kel", "vwap", "vol", "rsi"];
          d.mini = { on: cfg0.cardDaily !== false, size: ["s", "m", "l"].includes(cfg0.cardDailySize) ? cfg0.cardDailySize : "m", bars: [30, 60, 90].includes(+cfg0.cardDailyBars) ? +cfg0.cardDailyBars : 60, kel: ind.includes("kel"), vwap: ind.includes("vwap"), vol: ind.includes("vol"), rsi: ind.includes("rsi") }; }
        d.vp = ({ pcxl: { w: 1600, h: 900 }, fwide: { w: 1092, h: 921 }, fcover: { w: 540, h: 1197 } })[normRes(String(q.res || cfg0.res || cfg0.cardRes || "fwide"))];   /* 카드 사진도 흐름 사진과 같은 3종: 폴드 접힘 1080×2394 / 폴드 펼침 가로 2184×1842 / PC 16:9 3200×1800 */
        d.textOn = cfg0.cardText !== false;   /* 사진 아래 글 켜기/끄기 — 끄면 기본 정보 2줄(종목·가격·24h 거래대금)만 */
        d.scale = cfg0.cardScale === "price" ? "price" : "all";   /* 가격 스케일: 오토(지표 포함) / 가격만(캔들 중심) */
        d.layers = cfg0.layers ? { pattern: !!cfg0.layers.pattern, vwap: !!cfg0.layers.vwap, ict: !!cfg0.layers.ict } : (cfg0.mode === "ict" ? { pattern: false, vwap: false, ict: true } : { pattern: true, vwap: true, ict: false });   /* 기본: 차트패턴 + VWAP 지지·저항 (ICT 꺼짐) */
        const png = await renderCard(page, base, d);
        if (dry) { const f = path.join(ROOT, "out_card_" + t + ".png"); fs.writeFileSync(f, png); console.log("\n──── 카드 " + t + " ────\n" + d.caption + (d.detail ? "\n\n[상세 분석 메시지]\n" + d.detail : "")); }
        else { const mid = await sendPhoto(png, d.caption); if (d.detail && cfg0.cardDetail === true) { await new Promise((ok) => setTimeout(ok, 3300)); await sendDetail(d.detail, mid); lastSent = Date.now(); }   /* 패턴 상세 분석 메시지는 기본 꺼짐 — 설정(tg_shot_cfg)에 cardDetail:true 를 넣으면 다시 나옴 */ const gap = 3300 - (Date.now() - lastSent); if (gap > 0) await new Promise((ok) => setTimeout(ok, gap)); lastSent = Date.now(); }   /* 분당 18장 이하로 간격 유지 */
        n++;
      }
      log("종목 카드", n + "장", dry ? "(dry — 파일 저장)" : "전송");
    } finally { await browser.close(); flushCardCache(CACHE); }
    st.lastCards = now;
  }
  saveState(st);
}

/* GitHub 러너가 느려 크롬이 30초 안에 안 뜨는 일이 있음(2026-10-06 05:46 실패 원인) → 대기 60초 + 최대 3번 재시도 */
async function launchChrome(opts) {
  let err;
  for (let i = 1; i <= 3; i++) {
    try { return await puppeteer.launch({ ...opts, timeout: 60000 }); }
    catch (e) { err = e; log("크롬 시작 실패 " + i + "/3:", String((e && e.message) || e).slice(0, 120)); await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw err;
}

async function main() {
  const T0 = Date.now();
  let deadline = T0 + 150000;
  const dry = process.env.SHOT_DRY === "1" || /^(1|true)$/i.test(process.env.SHOT_DRY || "");
  if (!dry && (!process.env.TG_BOT_TOKEN || !process.env.TG_CHAT_ID)) {   /* 아직 Secrets 미설정이면 실패(알림 메일)시키지 않고 조용히 건너뜀 */
    log("TG_BOT_TOKEN / TG_CHAT_ID 가 설정되지 않아 건너뜀 — 저장소 Settings → Secrets and variables → Actions 에 추가하세요");
    return;
  }
  const q = Object.fromEntries(new URLSearchParams(process.env.SHOT_OVERRIDES || ""));   /* 수동 실행 시 한 번만 덮어쓰기: 예) res=pc&vz=200 */
  stage(3, "설정 읽는 중");
  const cfg0 = Object.assign({}, DEF_CFG, (await sbRead(CFG_KEY)) || {});
  /* 설정 페이지의 「지금 보내기」: 새 요청이면 설정된 사진을 전부 바로 보냄(주기 무시). 처리하면 그 시각부터 모든 주기를 새로 시작 */
  const sendCmd = process.env.SHOT_CMD ? JSON.parse(process.env.SHOT_CMD) : await sbRead("tg_shot_cmd");
  const manual = !!(sendCmd && sendCmd.id && sendCmd.id !== loadState().lastCmd);
  if (manual) { q.force = "1"; const s0 = loadState(); s0.lastCmd = sendCmd.id; saveState(s0); log("📤 「지금 보내기」 요청 — 설정된 사진을 모두 바로 보냅니다 (" + (sendCmd.at || "") + ")"); }
  { const sd = loadState(); if (!dry && !sd.diag1) { try { const r = await tgDiag(); log("텔레그램 방 진단", JSON.stringify({ chat: r.chat && r.chat.type, bot_read_all: r.bot && r.bot.can_read_all_group_messages, member: r.member && r.member.status, webhook: r.webhook && r.webhook.url_set })); } catch (e) { log("진단 오류", String(e && e.message || e)); } sd.diag1 = Date.now(); saveState(sd); } }
  const wantFlow = q.force === "1" || due(loadState().lastFlow, cfg0.flowEvery != null ? +cfg0.flowEvery : 0);   /* 가격흐름 사진 보내는 주기(0 = 매번 5분) */
  const list = (v, def) => (v == null ? def : String(v).split(",").map((x) => x.replace(/[^0-9a-z]/g, "")).filter(Boolean));
  const frame = String(q.frame || cfg0.frame).replace(/[^0-9A-Za-z]/g, ""), iv = String(q.iv || cfg0.iv).replace(/[^0-9a-z]/g, "");
  const vol = list(q.vol, cfg0.vol), kel = list(q.kel, cfg0.kel);
  const R = RES[normRes(String(q.res || cfg0.res || "fwide"))];
  const tk = (v, def) => (v == null ? def : String(v).split(",").map((x) => x.replace(/[^0-9A-Za-z]/g, "")).filter(Boolean).slice(0, 20));
  const idx = tk(q.idx, Array.isArray(cfg0.idx) ? cfg0.idx : DEF_CFG.idx), cmd = tk(q.cmd, Array.isArray(cfg0.cmd) ? cfg0.cmd : DEF_CFG.cmd);
  const lvl = (qv, cv, d) => Math.min(5, Math.max(1, Math.round(+(qv != null ? qv : cv) || d)));
  const sw = lvl(q.sw, cfg0.sw, 2), swi = lvl(q.swi, cfg0.swi, 3), swc = lvl(q.swc, cfg0.swc, 3);
  const VW = R.w, dsf0 = Math.min(4, Math.max(1, +q.dsf || R.dsf));
  const vz = Math.min(300, Math.max(100, Math.round(+(q.vz != null ? q.vz : cfg0.vz) || 100)));
  const VH = R.fixed ? R.h : R.h + Math.round((vz / 100 - 1) * 0.6 * (R.h - 110));   /* 와이드(fixed)는 화면 비율을 지키려고 '세로 길이' 슬라이더를 적용하지 않음 — 폴드만 세로를 늘림 */
  const dsf = Math.max(1, Math.min(dsf0, Math.sqrt(MAX_PIXELS / (VW * VH))));
  const sendDoc = q.doc != null ? q.doc === "1" : cfg0.doc !== false;
  const bool = (qv, cv, old) => (qv != null ? qv === "1" : (cv != null ? !!cv : !!old));
  const lead = bool(q.lead, cfg0.lead, cfg0.coins), alt = bool(q.alt, cfg0.alt, cfg0.coins);
  const secRaw = q.sec != null ? String(q.sec) : (Array.isArray(cfg0.sectors) ? cfg0.sectors.join(",") : "");
  const sectors = secRaw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  log("설정", R.label, frame + "/" + iv, "거래대금[" + vol + "] 켈[" + kel + "] 대장" + (lead ? "O" : "X") + " 알트" + (alt ? "O" : "X"), "섹터", sectors.length || "전체", "세로" + ("고정"), "굵기" + sw + "/" + swi + "/" + swc, "지수" + idx.length, "원자재" + cmd.length, "→", Math.round(VW * dsf) + "x" + Math.round(VH * dsf));

  stage(8, "저장된 캔들 이어받는 중");
  const { store, from } = await loadStore();
  log("저장본", from, store ? Object.keys(store.day || {}).length + "/" + Object.keys((store.raw && store.raw[iv]) || {}).length + "종목" : "");
  const { server, base } = await startServer();
  let browser = null;
  try {
    if (!wantFlow) log("가격흐름 사진: 아직 보낼 주기가 아님");
    if (wantFlow) {
    stage(14, "차트 화면 여는 중");
    browser = await launchChrome({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"],
      defaultViewport: { width: VW, height: VH, deviceScaleFactor: dsf },
    });
    deadline = Math.max(deadline, Date.now() + 100000);   /* 크롬 재시도로 시간을 썼어도 데이터 수집 시간은 확보 */
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("페이지 오류:", String(e.message).slice(0, 160)));
    await page.goto(base + "/robots.txt", { waitUntil: "domcontentloaded", timeout: 20000 });
    if (store) await page.evaluate(seedInPage, store, iv);
    const url = base + "/flow.html?shot=1&frame=" + frame + "&iv=" + iv + "&vol=" + vol.join(",") + "&kel=" + kel.join(",") + "&lead=" + (lead ? 1 : 0) + "&alt=" + (alt ? 1 : 0) + "&vz=" + (R.fixed ? 100 : vz) + "&sw=" + sw + "&swi=" + swi + "&swc=" + swc + "&idx=" + idx.join(",") + "&cmd=" + cmd.join(",") + (sectors.length ? "&sec=" + encodeURIComponent(sectors.join(",")) : "") + (q.nolive ? "&nolive=1" : "");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    let info = null, readyAt = 0, lastLog = 0;
    const needLive = !q.nolive;
    const dataOk = (i) => !!(i && !i.loading && i.grid > 0 && i.tot > 0 && i.n >= Math.ceil(i.tot * 0.9) && i.day >= Math.ceil(i.dayTot * 0.9));
    while (Date.now() < deadline) {
      info = await page.evaluate(() => (window.__shotInfo ? window.__shotInfo() : null)).catch(() => null);
      if (info && info.tot > 0) { ST.pct = Math.max(ST.pct, Math.round(18 + 38 * Math.min(1, ((info.n / info.tot) + (info.dayTot ? info.day / info.dayTot : 1)) / 2))); ST.label = "차트 데이터 받는 중 (종목 " + info.n + "/" + info.tot + ")"; stFlush(); }
      if (info && Date.now() - lastLog > 5000) { lastLog = Date.now(); log("대기 n=" + info.n + "/" + info.tot, "day=" + info.day + "/" + info.dayTot, "loading=" + info.loading, JSON.stringify(info.fetch)); }
      if (dataOk(info)) {
        if (!readyAt) readyAt = Date.now();
        if (!needLive || info.live > 0 || Date.now() - readyAt > 10000) break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const ready = dataOk(info);
    log("준비", ready ? "완료" : "미완", JSON.stringify(info && { n: info.n, tot: info.tot, day: info.day, live: !!info.live, fetch: info.fetch }));
    stage(58, ready ? "차트 사진 찍는 중" : "데이터 수집이 덜 끝남");
    await page.evaluate(() => { window.__shotFreeze = true; }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    let png = null;
    if (ready) { png = await page.screenshot({ type: "png" }); log("캡처 PNG", Math.round(png.length / 1024) + "KB", Math.round(VW * dsf) + "x" + Math.round(VH * dsf)); }
    /* 저장본 갱신(다음 실행이 이어받음): 로컬 파일은 매번, Supabase 백업은 1시간 간격 */
    const dump = await page.evaluate(dumpInPage, iv).catch(() => null);
    if (dump && (Object.keys((dump.raw && dump.raw[iv]) || {}).length || Object.keys(dump.day || {}).length)) {
      if (store && store.raw) Object.keys(store.raw).forEach((k) => { if (k !== iv && !dump.raw[k]) dump.raw[k] = store.raw[k]; });
      dump.t = Date.now();
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(dump));
      if (Date.now() - lastUpload > 60 * 60000) log("Supabase 백업", (await sbWriteStore(dump)) ? "OK" : "실패");
    }
    await browser.close(); browser = null;
    if (process.env.SHOT_SAVE && png) fs.writeFileSync(process.env.SHOT_SAVE, png);
    if (!ready) log("데이터 수집 중 — 이번엔 차트 사진을 보내지 않음(다음 실행이 이어받음)");
    else if (dry) log("dry 모드 — 차트 사진 전송 생략");
    else {
      stage(64, "텔레그램으로 차트 사진 보내는 중");
      const mid = await sendPhoto(png, "📈 흐름차트 · " + frame + " · " + ({ "4h": "4시간", "1h": "1시간", "8h": "8시간", "15m": "15분", "30m": "30분", "3m": "3분" }[iv] || iv) + "봉 · " + (lead || alt ? "" : "코인 제외 · ") + kstText());
      log("사진 전송", mid); stage(72, "차트 사진 전송 완료");
      { const s2 = loadState(); s2.lastFlow = Date.now(); saveState(s2); }
      if (sendDoc) {
        try {
          const d = new Date(Date.now() + 9 * 3600e3), p2 = (n) => String(n).padStart(2, "0");
          const did = await sendDocument(png, "flow_" + frame + "_" + iv + "_" + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "_" + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + ".png", mid);
          log("원본 문서 전송", did);
        } catch (e) { log(String((e && e.message) || e)); }
      }
    }
    }
    /* 사진 직후 바로: 순위 텍스트 · 종목 카드 (설정 페이지의 토글) */
    try { await runExtras({ cfg0, q, dry, base }); } catch (e) { log("추가 기능 오류:", String((e && e.message) || e)); }
    try { await runReport({ cfg0, q, dry }); } catch (e) { log("하이퍼 리포트 오류:", String((e && e.message) || e)); }
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    server.close();
  }
  if (manual) {   /* 누른 시각을 새 기준으로: 모든 주기가 그 시각부터 다시 시작, 5분 격자도 그 시각에 맞춤 */
    const T = Date.parse(sendCmd.at) || T0, s = loadState();
    Object.assign(s, { lastFlow: T, lastCards: T, lastRep: T, lastRank: T, lastPat: T }); saveState(s);
    try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(path.join(CACHE, "anchor.json"), JSON.stringify({ t: T })); } catch (e) {}
    log("주기 기준을 " + new Date(T + 9 * 3600e3).toISOString().slice(11, 19) + " KST 로 새로 시작");
  }
  log("끝", Math.round((Date.now() - T0) / 1000) + "초");
  ST.state = "done"; ST.pct = 100; ST.label = "완료"; ST.done = Date.now(); stLine("✅ 모두 끝 (" + Math.round((Date.now() - T0) / 1000) + "초)");
  await stFlush(true);
}

main().then(() => process.exit(0)).catch(async (e) => { console.error("오류:", e && e.message || e); ST.state = "error"; ST.label = "오류"; stLine("❌ " + String((e && e.message) || e)); ST.done = Date.now(); await stFlush(true); process.exit(1); });
