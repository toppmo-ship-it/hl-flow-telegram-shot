/* 차트스캐너 텔레그램 자동 사진 전용 작업(GitHub Actions: chartscan.yml) — 다른 발송(흐름차트·카드·리포트·추세)과 완전히 따로 돈다.
   - 한 번 시작하면 CS_LOOP_MS(기본 22분) 동안 20초마다: ① 차트스캐너 상단 「텔레그램」 버튼의 「지금 보내기」(cs_shot_cmd) ② 정해 둔 주기(5/10/15/30분·1/4시간·하루, 시계 격자)를 확인
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

/* 사이트(브트 설정창)와 같은 공용 파일: 종목 고르기·순서 규칙 — 미리 본 순서 그대로 보냄. 실행기 폴더는 ES 모듈이라 require 가 안 되어 파일을 읽어 module 로 실행 */
const loadUmd = (rel) => { const m = { exports: {} }; new Function("module", "exports", fs.readFileSync(new URL(rel, import.meta.url), "utf8"))(m, m.exports); return m.exports; };
const CP = loadUmd("./site/cardpick.js"), SP = loadUmd("./site/shotplan.js").make(CP);
const EVERYS = [5, 10, 15, 30, 60, 240, 1440];   /* 보내는 주기(분) — 브트 설정창과 같은 7단계 */
const SRC_KO = { scan: "조건검색", auto: "자동 상위", pick: "직접 선택" };

const BASE = (process.env.CS_URL || "https://hl-chartscan.vercel.app").replace(/\/$/, "");
const DRY = /^(1|true)$/i.test(process.env.CS_DRY || ""), ONCE = /^(1|true)$/i.test(process.env.CS_ONCE || "");
const LOOP_MS = +process.env.CS_LOOP_MS || 22 * 60000, TICK_MS = 4000;
const SAVE_DIR = process.env.CS_SAVE || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19), ...a);
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const tgToken = () => clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, "");
const chatId = () => clean(process.env.TG_CHAT_ID);   /* 종목 카드와 같은 기본 방 */
const pad = (n) => String(n).padStart(2, "0");
const kstParts = (t) => { const d = new Date(t + 9 * 3600e3); return { ymd: "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()), hm: pad(d.getUTCHours()) + pad(d.getUTCMinutes()), text: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " KST" }; };
/* ── 텔레그램 글(캡션) 서식 ──
   1줄 이름·분야·시간대 / 2줄 현재가·24시간 등락률·24시간 거래대금 / 3줄 이 사진 시간대의 추세 / 4줄 일·4시간·2시간·1시간 추세
   화살표 모양은 차트와 같은 세 가지: 노란 굵은 화살표(강, 개수만큼) · 흰 빈 화살표(약) · 작은 형광 확인 화살표 — 마지막으로 생긴 화살표 기준 */
const AR = { yellow: { up: "⬆️", down: "⬇️" }, hollow: { up: "⇧", down: "⇩" }, neon: { up: "↑", down: "↓" } }, DOT = { yellow: "🟡", hollow: "⚪", neon: "🟢" };   /* 차트·신호 내역과 같은 구분: 노란 굵은 화살표(개수만큼 🟡) · 흰 속 빈 화살표(⚪ ⇧⇩) · 작은 형광 확인 화살표(🟢 ↑↓) */
const TYPE_KO = { yellow: "노란 화살표(강)", hollow: "빈 화살표(약)", neon: "형광 확인 화살표" };
const ageTxt = (sec) => { const m = Math.floor(sec / 60); if (m < 1) return "방금"; if (m < 60) return m + "M 전"; const h = Math.floor(m / 60); if (h < 24) return h + "H " + (m % 60) + "M 전"; const d = Math.floor(h / 24); return d + "D " + (h % 24) + "H 전"; };
const arrowIcon = (r) => (r.type === "yellow" ? DOT.yellow + AR.yellow[r.dir].repeat(r.n || 1) : DOT[r.type] + AR[r.type][r.dir]);
const dirKo = (r) => (r.dir === "up" ? "상승" : "하락");
const trendLine = (ivFull, r) => (!r || r.none ? "⚪ " + ivFull + " 추세 신호 없음" + (r && r.why ? " (" + r.why + ")" : "") : arrowIcon(r) + " " + ivFull + " " + dirKo(r) + "추세 · " + TYPE_KO[r.type] + (r.type === "yellow" && r.n > 1 ? " ×" + r.n : "") + " · " + ageTxt(r.ageSec));
const FRAMES = [["1d", "일"], ["4h", "4시간"], ["2h", "2시간"], ["1h", "1시간"]];
const sideKo = (r) => (r.dir === "up" ? "저점·상승전환 전" : "고점·하락전환 전");
const sigTxt = (r) => arrowIcon(r) + " " + sideKo(r) + (r.type === "yellow" ? " (노란 화살표 " + (r.n || 1) + "개)" : " (흰 빈 화살표)") + (r.p != null ? " · 확률 " + r.p + "%" : "") + " · " + ageTxt(r.ageSec);   /* 신호 내역 목록과 같은 표현 */
const framesLines = (map) => FRAMES.map(([k, ko]) => { const r = map[k]; if (!r || r.none) return ko + " ➖ 신호 없음";
  const a = r.sigLast ? sigTxt(r.sigLast) : "", b = r.neonLast ? arrowIcon(r.neonLast) + " " + dirKo(r.neonLast) + " 형광 확인 · " + ageTxt(r.neonLast.ageSec) : "";
  return ko + " " + (a && b ? a + "\n   → " + b : a || b || "➖ 신호 없음"); });
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
let lastPost = 0, postRun = null, postDirty = false;
/* 상태 저장은 한 번에 하나만 보내고, 보내는 동안 쌓인 요청은 마지막 상태 하나로 합쳐 다시 보냄 → 사진 만드는 흐름을 기다리게 하지 않음 */
function post(force) {
  if (DRY) return Promise.resolve();
  const now = Date.now(); if (!force && now - lastPost < 2500) return Promise.resolve(); lastPost = now;
  postDirty = true;
  if (!postRun) postRun = (async () => { while (postDirty) { postDirty = false; S.status.updated = Date.now(); try { await sbPut("cs_shot_state", { last: S.last, lastCmd: S.lastCmd, run: S.run, status: S.status, info: S.info, at: Date.now() }); } catch (e) { /* 다음에 다시 */ } } postRun = null; })();
  return postRun;
}
const setStatus = (state, pct, label, force, cur) => { S.status = Object.assign({}, S.status, { state, pct: Math.round(pct), label }, cur !== undefined ? { cur } : {}); return post(force); };
/* 진행 기록(설정창 하단에 시각과 함께 그대로 보임): 한 줄씩 쌓고 최근 16줄만 */
S.lines = [];
const note = (m) => { log(m); S.lines.push({ t: Date.now(), m }); if (S.lines.length > 16) S.lines.shift(); S.status = Object.assign({}, S.status, { lines: S.lines.slice() }); return post(true); };
/* 설정 읽기: 서버 설정 + (시험용) 환경변수 덮어쓰기 */
const mergeCfg = (c0) => Object.assign({}, c0 || {}, process.env.CS_CFG_JSON ? JSON.parse(process.env.CS_CFG_JSON) : {});
/* 보내는 내용에 영향을 주는 설정만 비교(켜기/주기는 따로 봄) — 바뀌면 진행 중이던 전송을 새 설정으로 처음부터 다시 */
const sigOf = (c) => JSON.stringify([c.max, c.doc, c.scale, c.iv, c.days, c.dailyDays, c.bars, c.mini, c.src, c.picks, c.exclude, c.sort, c.auto, c.filter, c.tail]);

/* 「지금 보내기」를 다시 눌렀거나(설정이 바뀐 것) 정기 전송 중에 끔으로 바꿨으면 → 진행 중이던 전송을 멈추고, 새 요청으로 처음부터 다시 */
async function superseded(manual) {
  const [cmd, cfg0] = await Promise.all([sbGet("cs_shot_cmd"), sbGet("cs_shot_cfg")]), cfg = cfg0 ? mergeCfg(cfg0) : null;
  if (cmd && cmd.id && cmd.id !== S.lastCmd) return "새 「지금 보내기」 요청";
  if (!manual && cfg && cfg.on === false) return "전송을 껐음";
  if (cfg && S.sig && sigOf(cfg) !== S.sig) { if (manual) S.redo = true; return "설정이 바뀜"; }
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
  S.lines = []; S.sig = sigOf(cfg); S.status = Object.assign({}, S.status, { lines: [], cur: null });
  await setStatus("running", 3, manual ? "「지금 보내기」 처리 시작" : "정기 전송 시작", true);
  await note(manual ? "📤 「지금 보내기」 요청을 받았어요 — 지금 설정으로 시작" : "⏰ 정해진 주기가 되어 시작해요");
  const hb = setInterval(() => { post(true).catch(() => {}); }, 15000);
  let browser = null; const extra = [];   /* extra = 추가로 띄운 크롬들(닫을 때 같이) */
  /* 즉시 중단: 새 「지금 보내기」·설정 변경·끔이 들어오면 3초 안에 감지 → 지금 하던 일(차트 불러오기·사진 찍기·전송 준비)을 그 자리에서 끊고 크롬을 닫고 처음부터 다시 */
  const ctl = { abort: "" };
  const wd = setInterval(() => { if (!ctl.abort) superseded(manual).then((why) => { if (why && !ctl.abort) ctl.abort = why; }).catch(() => {}); }, 3000);
  const guard = (pr) => new Promise((res, rej) => { const t = setInterval(() => { if (ctl.abort) { clearInterval(t); rej(new Error("ABORT")); } }, 250); Promise.resolve(pr).then((v) => { clearInterval(t); res(v); }, (e) => { clearInterval(t); rej(e); }); });
  try {
    const row = await sbGet("chartscan_state_v1"), state = row && row.state;
    if (!state || !(state.cfgs || []).length) throw new Error("저장된 차트스캐너 설정이 없어요 (사이트를 한 번 열어 설정을 저장해 주세요)");
    /* 선명도: 화면을 작게(1280x720) 잡고 4배로 그림 → 글자가 사진 안에서 상대적으로 크고, 원본은 5120x2880. 사진(미리보기)은 여기서 2560x1440으로 줄여(Lanczos) 텔레그램이 다시 줄이지 않게 함 */
    await note("저장된 차트 설정(지표·눈금·테마·조건검색식)을 불러왔어요");
    const W = 1280, H = 720, DSF = [2, 3, 4].includes(+cfg.scale) ? +cfg.scale : 4;
    await note("크롬 브라우저를 실행하는 중 (원본 " + (DSF * 1280) + "×" + (DSF * 720) + ")");
    { const bp = launch(); try { browser = await guard(bp); } catch (e) { bp.then((b) => b.close()).catch(() => {}); throw e; } }
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("페이지 오류:", String(e.message).slice(0, 140)));
    await page.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
    await page.evaluateOnNewDocument((st, saved) => { try { localStorage.setItem("hlcs_state_v1", st); if (saved) localStorage.setItem("hlcs_scr_saved_v1", saved); } catch (e) { /* 무시 */ } }, JSON.stringify(state), row.saved || "");
    await setStatus("running", 8, "차트스캐너 여는 중", true); await note("브트 차트 사이트를 여는 중");
    await guard(page.goto(BASE + "/?shot=1", { waitUntil: "domcontentloaded", timeout: 90000 }));
    await guard(page.waitForFunction(() => window.__shot, { timeout: 60000 }));
    if (!(await guard(page.evaluate(() => window.__shot.booted())))) throw new Error("차트스캐너가 시작되지 않았어요");
    /* 사진 만들기를 크롬 2개가 나눠서 함(속도). 두 번째 크롬은 조건검색 계산과 겹쳐서 미리 띄움. 보내는 순서는 아래에서 번호순으로 따로 지킴 */
    const NW = Math.max(1, Math.min(3, +process.env.CS_WORKERS || 2));
    const mkExtra = async () => {
      const b = await launch(); extra.push(b);
      const pg = await b.newPage(); pg.on("pageerror", (e) => log("페이지 오류(2):", String(e.message).slice(0, 140)));
      await pg.setViewport({ width: W, height: H, deviceScaleFactor: DSF });
      await pg.evaluateOnNewDocument((st, saved) => { try { localStorage.setItem("hlcs_state_v1", st); if (saved) localStorage.setItem("hlcs_scr_saved_v1", saved); } catch (e) { /* 무시 */ } }, JSON.stringify(state), row.saved || "");
      await pg.goto(BASE + "/?shot=1", { waitUntil: "domcontentloaded", timeout: 90000 }); await pg.waitForFunction(() => window.__shot, { timeout: 60000 });
      if (!(await pg.evaluate(() => window.__shot.booted()))) throw new Error("두 번째 차트가 시작되지 않았어요");
      return pg;
    };
    const extraP = Array.from({ length: NW - 1 }, () => mkExtra().catch((e) => { log("추가 크롬 준비 실패(하나로 진행):", String((e && e.message) || e).slice(0, 100)); return null; }));
    /* 조건검색 계산은 출처가 「조건검색」일 때만 (자동 상위·직접 선택은 필요 없어서 1~2분 아낌) */
    const useScan = cfg.src !== "pick" && cfg.src !== "auto";
    if (useScan) { await setStatus("running", 14, "조건검색 결과 계산 중", true); await note("사이트 준비 완료 — 조건검색 계산 중 (종목마다 일봉·지표 확인, 1~2분)"); }
    else await note("사이트 준비 완료 — " + (SRC_KO[cfg.src] || "") + " 모드라 조건검색 계산은 건너뛰어요");
    const L = useScan ? await guard(page.evaluate(() => window.__shot.list())) : { rows: [], inv: false, universe: 0, scanned: 0 };
    { const why = await superseded(manual); if (why) { await note("⏹ 중지 — " + why + (why === "설정이 바뀜" ? " → 새 설정으로 처음부터 다시 시작해요" : "")); S.again = true; await setStatus("idle", 0, "중지됨 (" + why + ")", true, null); return false; } }
    if (useScan) await note("조건검색 계산 끝 — " + L.rows.length + "종목 통과 (범위 " + L.universe + "종목)" + (L.inv ? " · 인버스 검색" : ""));
    log("조건검색 " + L.rows.length + "종목 통과 (범위 " + L.universe + "종목, 계산 " + L.scanned + ") · 인버스 " + (L.inv ? "켬" : "끔"));
    /* 무엇을 어떤 순서로: 설정창 「종목」 탭의 출처(조건검색/자동 상위/직접 선택) → shotplan.js 가 순서까지 정함 (맨 끝 = 지수·원자재·금리, 그 앞은 큰 분야·큰 거래대금 순 — 옛 텔레그램 사이트와 같음) */
    const sl = await sbGet("tg_stock_list"), rows = sl && Array.isArray(sl.rows) && sl.rows.length ? sl.rows : null;
    if (!rows) log("⚠ 종목 목록 스냅샷(tg_stock_list)이 없어 분야별 정렬 없이 보냄");
    const plan = SP.plan(cfg, { rows, inv: !!L.inv, scan: L.rows.map((r) => ({ t: r.short, coin: r.coin, chg: r.chg })) });
    const need = plan.filter((x) => !x.coin).map((x) => x.t), pairs = need.length ? await guard(page.evaluate((n) => window.__shot.resolvePairs(n), need)) : [], cm = {}; pairs.forEach((p) => { if (p.coin) cm[p.t] = p.coin; });
    const dropped = plan.filter((x) => !x.coin && !cm[x.t]).map((x) => x.t); if (dropped.length) log("거래소에서 못 찾은 종목(건너뜀): " + dropped.join(","));
    const cnt = {}, seq = {}; plan.forEach((x) => { cnt[x.src] = (cnt[x.src] || 0) + 1; });
    const jobs = plan.map((x) => Object.assign({}, x, { coin: x.coin || cm[x.t] })).filter((x) => x.coin).map((x) => { seq[x.src] = (seq[x.src] || 0) + 1; return Object.assign(x, { kind: x.src === "tail" ? "macro" : "scan", i: seq[x.src], n: cnt[x.src] }); });
    const picked = jobs.filter((j) => j.kind === "scan"), macroCoins = jobs.filter((j) => j.kind === "macro"), srcKo = SRC_KO[cfg.src] || SRC_KO.scan, total = cfg.src === "scan" ? L.rows.length : picked.length;
    const shotOpt = { iv: cfg.iv || "auto", days: +cfg.days || 0, dailyDays: +cfg.dailyDays || 0, bars: +cfg.bars || 0, mini: cfg.mini !== false };   /* 미니차트는 기본 켬 */
    await note("보낼 목록 확정: " + jobs.length + "장 (" + srcKo + " " + picked.length + " + 시장 지표 " + macroCoins.length + ") · 시간대 " + (shotOpt.iv === "auto" ? "내 화면 그대로" : shotOpt.iv) + (shotOpt.days ? " " + shotOpt.days + "일" : "") + " · 미니차트 " + (shotOpt.mini ? "켬" : "끔"));
    await note("보내는 순서: " + jobs.map((j) => j.t).join(" → "));
    let sent = 0, fail = 0; const now = kstParts(Date.now());
    const pages = [page]; for (const ep of extraP) { const pg = await guard(ep); if (pg) pages.push(pg); }
    const nw = Math.max(1, Math.min(pages.length, jobs.length)); await note("사진 만드는 크롬 " + nw + "개로 나눠서 진행 (보내는 순서는 그대로)");
    /* ── 만들기: 크롬마다 다음 번호를 가져가 사진·글을 만들어 번호 칸에 넣음 / 보내기: 번호순으로 한 장씩 꺼내 보냄 → 순서는 항상 그대로 ── */
    const slot = jobs.map(() => { let res; const pr = new Promise((r) => { res = r; }); return { pr, res }; });
    let nextK = 0, takenK = 0; const LOOK = nw * 2 + 1;   /* 보내기보다 너무 앞서 만들지 않게(메모리) */
    const render = async (pg, k) => {
      const j = jobs[k], T0 = Date.now(), LAP = [], lap = (n) => LAP.push(n + " " + ((Date.now() - T0) / 1000).toFixed(1));
      const r = await pg.evaluate((c, o) => window.__shot.show(c, o), j.coin, shotOpt);
      if (!r.ok) return { skip: "차트를 못 불러왔어요 (봉 " + r.n + "개)" };
      lap("차트");
      const d = await pg.evaluate((c) => window.__shot.describe(c), j.coin);
      const stamp = (d.ko ? d.ko + " (" + d.tk + ")" : d.tk || d.short) + (d.sector ? " · " + d.sector : "") + " · " + d.ivKo + " · " + now.text + (j.kind === "scan" ? " · " + srcKo + " " + j.i + "/" + j.n + (cfg.src === "scan" && L.inv ? " · INVERSE" : "") : " · 기본");
      await pg.evaluate((t) => window.__shot.stamp(t), stamp);
      lap("정보"); await sleep(120);
      const buf = Buffer.from(await pg.screenshot({ type: "png" }));   /* 원본(무손실) */
      lap("촬영");
      const small = await sharp(buf).resize({ width: 2560, kernel: "lanczos3" }).sharpen({ sigma: 0.6, m1: 0.8, m2: 1.2 }).png({ compressionLevel: 9 }).toBuffer();   /* 사진용 2560x1440 */
      const nm = (d.tk || d.short).replace(/[^A-Za-z0-9가-힣._-]+/g, "_") + "_" + d.iv + "_" + now.ymd + "_" + now.hm + ".png";
      lap("보정"); let tmap = {};
      try { const ivs = [...new Set([d.iv, ...FRAMES.map((f) => f[0])])], rs = await pg.evaluate((c, a) => window.__shot.trends(c, a), j.coin, ivs); ivs.forEach((v, q) => { tmap[v] = rs[q]; }); }
      catch (e) { log("추세 계산 실패(글에서 뺌):", j.t, String((e && e.message) || e).slice(0, 80)); tmap = null; }
      lap("추세");
      const sgn = d.chg == null ? "" : (d.chg >= 0 ? "+" : "") + d.chg.toFixed(2) + "%";
      const head = (d.ko ? d.ko + " (" + d.tk + ")" : d.tk || d.short) + (d.sector ? " · " + d.sector : "") + " · " + d.ivFull;
      const info = ["현재가 " + fmtPx(d.px), sgn ? "24시간 등락률 " + sgn : "", d.vKrw ? "24시간 거래대금 " + d.vKrw : ""].filter(Boolean);
      const cap = [head, ...info, ...(tmap ? ["", trendLine(d.ivFull, tmap[d.iv]), "", ...framesLines(tmap)] : [])].join("\n");   /* 정보마다 한 줄씩, 묶음 사이는 빈 줄 */
      return { buf, small, cap, nm, lap: LAP.join(" "), ms: r.ms };
    };
    const worker = async (pg) => {
      for (;;) {
        if (ctl.abort) return;
        while (nextK < jobs.length && nextK - takenK >= LOOK) { await sleep(100); if (ctl.abort) return; }
        const k = nextK++; if (k >= jobs.length) return;
        let out; try { out = await render(pg, k); } catch (e) { out = { err: e }; }
        slot[k].res(out);
      }
    };
    const workers = pages.slice(0, nw).map((pg) => worker(pg)); workers.forEach((w) => w.catch(() => {}));
    for (let k = 0; k < jobs.length; k++) {
      if (ctl.abort) throw new Error("ABORT");
      const j = jobs[k];
      void setStatus("running", 18 + 76 * k / jobs.length, (k + 1) + "/" + jobs.length + " " + j.t + " — 만드는 중", true, { k: k + 1, n: jobs.length, t: j.t, stage: "만드는 중" });
      const R = await guard(slot[k].pr); takenK = k + 1;
      if (R.err) { if (ctl.abort) throw R.err; await note("⚠ " + j.t + " 실패: " + String((R.err && R.err.message) || R.err).slice(0, 100)); fail++; continue; }
      if (R.skip) { await note("⚠ " + j.t + " " + R.skip + " — 건너뜀"); fail++; continue; }
      const { buf, small, cap, nm } = R;
      log("단계시간(초) " + j.t + ": " + R.lap);
      if (DRY) log("글 ↓\n" + cap);
      log((k + 1) + "/" + jobs.length, nm, Math.round(buf.length / 1024) + "KB 원본 · 사진 " + Math.round(small.length / 1024) + "KB", R.ms + "ms");
      if (SAVE_DIR) { fs.mkdirSync(SAVE_DIR, { recursive: true }); fs.writeFileSync(path.join(SAVE_DIR, String(k + 1).padStart(2, "0") + "_" + nm), buf); }
      if (DRY) { sent++; continue; }
      void setStatus("running", 18 + 76 * (k + 0.8) / jobs.length, (k + 1) + "/" + jobs.length + " " + j.t + " — 텔레그램으로 전송 중", true, { k: k + 1, n: jobs.length, t: j.t, stage: "전송 중" });
      const ts = Date.now(); let mid = null, docOk = false;
      if (small.length < 9.5e6) { try { mid = await guard(sendPhoto(small, cap, nm)); } catch (e) { if (ctl.abort) throw e; await note("⚠ " + j.t + " 사진 전송 실패: " + String((e && e.message) || e).slice(0, 80)); } }
      if (cfg.doc !== false || !mid) { try { await guard(sendDocument(buf, nm, mid)); docOk = true; } catch (e) { if (ctl.abort) throw e; await note("⚠ " + j.t + " 원본 전송 실패: " + String((e && e.message) || e).slice(0, 80)); if (!mid) { fail++; continue; } } }
      sent++; await note("✔ " + (k + 1) + "/" + jobs.length + " " + j.t + " 전송 완료 (사진 " + Math.round(small.length / 1024) + "KB" + (docOk ? " + 원본 " + Math.round(buf.length / 1024) + "KB" : "") + ") · 만들기 " + R.lap + " · 전송 " + ((Date.now() - ts) / 1000).toFixed(1));
      await sleep(500);   /* 텔레그램 분당 전송 제한(방당 ~20건) 여유 — 한도에 걸리면 위에서 알려준 시간만큼 자동 대기 */
    }
    await Promise.all(workers);
    S.last = Date.now(); S.retryAt = 0; S.info = { sent, fail, scan: picked.length, macro: macroCoins.length, passed: L.rows.length, src: cfg.src || "scan", inv: !!L.inv, sec: Math.round((Date.now() - t0) / 1000) };
    await note("🎉 모두 끝 — " + sent + "장 전송" + (fail ? " (실패 " + fail + ")" : "") + " · " + S.info.sec + "초");
    await setStatus("done", 100, "완료 · " + sent + "장 · " + S.info.sec + "초", true, null);
    log("전송 완료 " + sent + "장 (실패 " + fail + ") " + S.info.sec + "초");
    return true;
  } catch (e) {
    if (ctl.abort) {
      const why = ctl.abort; await note("⏹ 즉시 중지 — " + why + (why === "설정이 바뀜" || /지금 보내기/.test(why) ? " → 지금 설정으로 처음부터 다시 시작해요" : ""));
      S.again = true; await setStatus("idle", 0, "중지됨 (" + why + ")", true, null); return false;
    }
    throw e;
  } finally { clearInterval(hb); clearInterval(wd); if (browser) await browser.close().catch(() => {}); for (const b of extra) await b.close().catch(() => {}); }
}

/* ── 정해진 주기(시계 격자): 설정한 분마다, 봉이 막 마감한 뒤(+45초)에 맞춰 (하루 = 한국 아침 9시) ── */
const slotOf = (t, every) => Math.floor((t - 45000) / (every * 60000));
async function tick() {
  const [cfg0, cmd, mute] = await Promise.all([sbGet("cs_shot_cfg"), sbGet("cs_shot_cmd"), sbGet("tg_bot_mute")]);
  const cfg = mergeCfg(cfg0), every = EVERYS.includes(+cfg.every) ? +cfg.every : 5, now = Date.now();
  if (cmd && cmd.id && cmd.id !== S.lastCmd) {   /* 상단 「텔레그램」 → 「지금 보내기」 — 꺼져 있어도 보냄 */
    S.lastCmd = cmd.id; log("📤 「지금 보내기」 요청 (" + cmd.id + ")");
    await post(true); await runOnce({ manual: true, cfg });
    for (let n = 0; S.redo && n < 3; n++) { S.redo = false; await runOnce({ manual: true, cfg: mergeCfg(await sbGet("cs_shot_cfg")) }); }   /* 보내는 도중 설정이 바뀌면 새 설정으로 다시 */
    return true;
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
