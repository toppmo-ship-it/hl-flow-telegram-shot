/* 흐름차트 "미리 갱신" 실행기 (GitHub Actions)
   - 사람이 안 열어도 서버 저장본(Supabase)이 항상 최신이도록, 주기적으로 흐름차트를 대신 열어 둠
   - site/ 를 자기 안에서 열고(로컬 서버, /api/flow-fetch 도 로컬 처리 → Vercel·로그인 불필요)
     /flow.html?warm=1 을 헤드리스 크롬으로 엶. warm=1 은 설정 저장·실시간 연결을 끄고,
     사용자가 마지막에 쓴 기간/봉(서버에 동기화된 설정)으로 열어 그 프레임 + 미리받기 프레임들을 새로 받아
     서버 스냅샷(flow_v6_*)·일봉 켈트너·4h 중심선·3일 거래대금 공유본에 저장함
   환경변수: CHROME_PATH(선택), WARM_NO_WRITE=1(시험용: Supabase 쓰기 차단), WARM_EXTRA="pre=0" 등 */
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, "site");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".txt": "text/plain", ".json": "application/json", ".png": "image/png" };
const log = (...a) => console.log("[미리갱신]", ...a);

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

async function launchChrome(opts) {
  let err;
  for (let i = 1; i <= 3; i++) {
    try { return await puppeteer.launch({ ...opts, timeout: 60000 }); }
    catch (e) { err = e; log("크롬 시작 실패 " + i + "/3:", String((e && e.message) || e).slice(0, 120)); await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_MS = 8 * 60 * 1000;   /* 한 번에 최대 8분 */

async function main() {
  const T0 = Date.now();
  const { server, base } = await startServer();
  const browser = await launchChrome({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 } });
  let ok = false;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => log("페이지 오류:", String(e.message).slice(0, 140)));
    let writes = 0;
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const u = r.url();
      if (/\.supabase\.co\//.test(u) && r.method() !== "GET") {
        writes++;
        if (process.env.WARM_NO_WRITE === "1") return r.abort();   /* 시험용: 운영 DB에 쓰지 않음 */
      }
      r.continue();
    });
    const extra = process.env.WARM_EXTRA ? "&" + process.env.WARM_EXTRA : "";
    await page.goto(base + "/flow.html?warm=1" + extra, { waitUntil: "domcontentloaded", timeout: 30000 });
    log("열림 +" + (Date.now() - T0) + "ms");
    /* 끝났는지 판단: 첫 화면이 그려진 뒤 3초가 지나고, 불러오는 중·미리받기·뒤 작업이 모두 없는 상태가 연속 4번(≈8초) 이어지면 끝 */
    let calm = 0, last = "";
    while (Date.now() - T0 < MAX_MS) {
      await sleep(2000);
      let i = null;
      try { i = await page.evaluate(() => (window.__warmInfo ? window.__warmInfo() : null)); } catch (e) {}
      const line = i ? `불러오는중=${i.loading} 미리받기=${i.pre} 뒤작업=${i.bg} 종목=${i.n} ${i.src || ""}` : "화면 준비 중";
      if (line !== last) { log(line, "(" + Math.round((Date.now() - T0) / 1000) + "초)"); last = line; }
      if (i && i.grid > 0 && !i.loading && !i.pre && !i.bg && Date.now() - T0 > 6000) { if (++calm >= 4) { ok = true; break; } } else calm = 0;
    }
    log(ok ? "완료" : "시간 초과(8분) — 진행분은 저장됨", "· 서버 저장 요청", writes + "건 · 총 " + Math.round((Date.now() - T0) / 1000) + "초");
  } finally { await browser.close(); server.close(); }
  if (!ok) process.exitCode = 0;   /* 시간 초과여도 실패로 만들지 않음(다음 실행이 이어받음) */
}

main().catch((e) => { console.error("[미리갱신] 오류:", e && e.stack || e); process.exit(1); });
