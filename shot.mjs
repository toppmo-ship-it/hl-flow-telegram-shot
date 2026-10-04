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
  fold: { w: 1092, h: 984, dsf: 2, label: "폴드 2184×1968" },
  pc: { w: 1600, h: 900, dsf: 1.6, label: "PC 2560×1440" },
  pcxl: { w: 1920, h: 1080, dsf: 5 / 3, label: "PC 3200×1800" },
};
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
  const r = await fetch("https://api.telegram.org/bot" + tgToken() + "/sendPhoto", { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
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
async function runExtras({ cfg0, q, dry, base }) {
  const flag = (qv, cv) => (qv != null ? qv === "1" : !!cv);
  const wantW = flag(q.rankw, cfg0.rankWeekly), wantS = flag(q.ranks, cfg0.rankSurge);
  const cards = (q.cards != null ? String(q.cards).split(",") : (Array.isArray(cfg0.cards) ? cfg0.cards : [])).map((x) => x.replace(/[^0-9A-Za-z]/g, "")).filter(Boolean).slice(0, 12);
  const wantP = flag(q.rankp, cfg0.rankPattern !== false);   /* 패턴 확률 순위(별도 메시지) — 기본 켬 */
  if (!wantW && !wantS && !wantP && !cards.length) return;
  const st = loadState(), now = Date.now(), force = q.force === "1";
  const dueRank = (wantW || wantS) && (force || due(st.lastRank, +cfg0.rankEvery || 0));
  const dueCards = cards.length && (force || due(st.lastCards, cfg0.cardEvery != null ? +cfg0.cardEvery : 0));
  const dueP = wantP && (force || due(st.lastPat, cfg0.rankPatEvery != null ? +cfg0.rankPatEvery : 60));
  if (!dueRank && !dueCards && !dueP) { log("추가 기능: 아직 보낼 주기가 아님"); return; }
  const info = loadSiteInfo(SITE), uni = await loadUniverse(log), fx = await usdKrw(log);
  log("추가 기능 시작 — HIP-3 " + uni.length + "종목, 환율 " + fx.toFixed(1));
  if (dueP) {
    stage(73, "패턴 확률 순위 계산 중 (종목 스캔)");
    const tx = await buildPatternRankText({ uni, info, log, cacheDir: CACHE, tf0: String(cfg0.cardIv || "4h"), scanN: 30 });
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
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: { width: 1200, height: 1100, deviceScaleFactor: 2 } });
    try {
      const page = await browser.newPage();
      let n = 0;
      for (const t of cards) {
        stage(88 + Math.round(10 * n / Math.max(1, cards.length)), "종목 카드 " + (n + 1) + "/" + cards.length + " 만드는 중 · " + t);
        const row = pickRow(uni, t, info);
        if (!row) { log("카드 종목 없음:", t); continue; }
        const d = await buildCardData({ row, ticker: t, info, iv, days, fx, log, cacheDir: CACHE, mode: cfg0.mode });
        if (!d) { log("카드 데이터 부족:", t); continue; }
        d.colors = cfg0.colors || null;
        d.layers = cfg0.layers ? { pattern: !!cfg0.layers.pattern, vwap: !!cfg0.layers.vwap, ict: !!cfg0.layers.ict } : (cfg0.mode === "ict" ? { pattern: false, vwap: false, ict: true } : { pattern: true, vwap: true, ict: false });   /* 기본: 차트패턴 + VWAP 지지·저항 (ICT 꺼짐) */
        const png = await renderCard(page, base, d);
        if (dry) { const f = path.join(ROOT, "out_card_" + t + ".png"); fs.writeFileSync(f, png); console.log("\n──── 카드 " + t + " ────\n" + d.caption); }
        else await sendPhoto(png, d.caption);
        n++;
      }
      log("종목 카드", n + "장", dry ? "(dry — 파일 저장)" : "전송");
    } finally { await browser.close(); flushCardCache(CACHE); }
    st.lastCards = now;
  }
  saveState(st);
}

async function main() {
  const T0 = Date.now(), deadline = T0 + 150000;
  const dry = process.env.SHOT_DRY === "1" || /^(1|true)$/i.test(process.env.SHOT_DRY || "");
  if (!dry && (!process.env.TG_BOT_TOKEN || !process.env.TG_CHAT_ID)) {   /* 아직 Secrets 미설정이면 실패(알림 메일)시키지 않고 조용히 건너뜀 */
    log("TG_BOT_TOKEN / TG_CHAT_ID 가 설정되지 않아 건너뜀 — 저장소 Settings → Secrets and variables → Actions 에 추가하세요");
    return;
  }
  const q = Object.fromEntries(new URLSearchParams(process.env.SHOT_OVERRIDES || ""));   /* 수동 실행 시 한 번만 덮어쓰기: 예) res=pc&vz=200 */
  stage(3, "설정 읽는 중");
  const cfg0 = Object.assign({}, DEF_CFG, (await sbRead(CFG_KEY)) || {});
  const list = (v, def) => (v == null ? def : String(v).split(",").map((x) => x.replace(/[^0-9a-z]/g, "")).filter(Boolean));
  const frame = String(q.frame || cfg0.frame).replace(/[^0-9A-Za-z]/g, ""), iv = String(q.iv || cfg0.iv).replace(/[^0-9a-z]/g, "");
  const vol = list(q.vol, cfg0.vol), kel = list(q.kel, cfg0.kel);
  const R = RES[String(q.res || cfg0.res || "fold")] || RES.fold;
  const tk = (v, def) => (v == null ? def : String(v).split(",").map((x) => x.replace(/[^0-9A-Za-z]/g, "")).filter(Boolean).slice(0, 20));
  const idx = tk(q.idx, Array.isArray(cfg0.idx) ? cfg0.idx : DEF_CFG.idx), cmd = tk(q.cmd, Array.isArray(cfg0.cmd) ? cfg0.cmd : DEF_CFG.cmd);
  const lvl = (qv, cv, d) => Math.min(5, Math.max(1, Math.round(+(qv != null ? qv : cv) || d)));
  const sw = lvl(q.sw, cfg0.sw, 2), swi = lvl(q.swi, cfg0.swi, 3), swc = lvl(q.swc, cfg0.swc, 3);
  const VW = R.w, dsf0 = Math.min(4, Math.max(1, +q.dsf || R.dsf));
  const vz = Math.min(300, Math.max(100, Math.round(+(q.vz != null ? q.vz : cfg0.vz) || 100)));
  const VH = R.h + Math.round((vz / 100 - 1) * 0.6 * (R.h - 110));
  const dsf = Math.max(1, Math.min(dsf0, Math.sqrt(MAX_PIXELS / (VW * VH))));
  const sendDoc = q.doc != null ? q.doc === "1" : cfg0.doc !== false;
  const bool = (qv, cv, old) => (qv != null ? qv === "1" : (cv != null ? !!cv : !!old));
  const lead = bool(q.lead, cfg0.lead, cfg0.coins), alt = bool(q.alt, cfg0.alt, cfg0.coins);
  const secRaw = q.sec != null ? String(q.sec) : (Array.isArray(cfg0.sectors) ? cfg0.sectors.join(",") : "");
  const sectors = secRaw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  log("설정", R.label, frame + "/" + iv, "거래대금[" + vol + "] 켈[" + kel + "] 대장" + (lead ? "O" : "X") + " 알트" + (alt ? "O" : "X"), "섹터", sectors.length || "전체", "세로" + vz + "%", "굵기" + sw + "/" + swi + "/" + swc, "지수" + idx.length, "원자재" + cmd.length, "→", Math.round(VW * dsf) + "x" + Math.round(VH * dsf));

  stage(8, "저장된 캔들 이어받는 중");
  const { store, from } = await loadStore();
  log("저장본", from, store ? Object.keys(store.day || {}).length + "/" + Object.keys((store.raw && store.raw[iv]) || {}).length + "종목" : "");
  const { server, base } = await startServer();
  let browser = null;
  try {
    stage(14, "차트 화면 여는 중");
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"],
      defaultViewport: { width: VW, height: VH, deviceScaleFactor: dsf },
    });
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("페이지 오류:", String(e.message).slice(0, 160)));
    await page.goto(base + "/robots.txt", { waitUntil: "domcontentloaded", timeout: 20000 });
    if (store) await page.evaluate(seedInPage, store, iv);
    const url = base + "/flow.html?shot=1&frame=" + frame + "&iv=" + iv + "&vol=" + vol.join(",") + "&kel=" + kel.join(",") + "&lead=" + (lead ? 1 : 0) + "&alt=" + (alt ? 1 : 0) + "&vz=" + vz + "&sw=" + sw + "&swi=" + swi + "&swc=" + swc + "&idx=" + idx.join(",") + "&cmd=" + cmd.join(",") + (sectors.length ? "&sec=" + encodeURIComponent(sectors.join(",")) : "") + (q.nolive ? "&nolive=1" : "");
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
      if (sendDoc) {
        try {
          const d = new Date(Date.now() + 9 * 3600e3), p2 = (n) => String(n).padStart(2, "0");
          const did = await sendDocument(png, "flow_" + frame + "_" + iv + "_" + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "_" + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + ".png", mid);
          log("원본 문서 전송", did);
        } catch (e) { log(String((e && e.message) || e)); }
      }
    }
    /* 사진 직후 바로: 순위 텍스트 · 종목 카드 (설정 페이지의 토글) */
    try { await runExtras({ cfg0, q, dry, base }); } catch (e) { log("추가 기능 오류:", String((e && e.message) || e)); }
  } finally {
    try { if (browser) await browser.close(); } catch (e) {}
    server.close();
  }
  log("끝", Math.round((Date.now() - T0) / 1000) + "초");
  ST.state = "done"; ST.pct = 100; ST.label = "완료"; ST.done = Date.now(); stLine("✅ 모두 끝 (" + Math.round((Date.now() - T0) / 1000) + "초)");
  await stFlush(true);
}

main().then(() => process.exit(0)).catch(async (e) => { console.error("오류:", e && e.message || e); ST.state = "error"; ST.label = "오류"; stLine("❌ " + String((e && e.message) || e)); ST.done = Date.now(); await stFlush(true); process.exit(1); });
