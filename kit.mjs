/* 텔레그램 보내기 · 사진 그리기 공용 도구 — 챗봇(chatbot.mjs)과 코인 리포트(coinjob.mjs)가 함께 씀 (한 곳만 고치면 둘 다 바뀜)
   - tg/say/photo : 텔레그램 전송(429 재시도·HTML 오류 시 태그 없이 재전송) · BOT_DRY(시험)면 전송 없이 화면·파일로만
   - makeCard    : 종목 카드 사진(주기 카드와 같은 그림) · drawReportPng : 리포트/표 사진(테마 색 지원)
   크롬은 한 개를 계속 쓰고 10분 놀면 닫음 */
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pickRow, buildCardData, renderCard, flushCardCache, applyCardCfg } from "./extras.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const REP_W = { fcover: 1360, fwide: 2184, pcxl: 3200 };   /* 해상도 3종 → 리포트 가로 픽셀 */
export const resKeyOf = (cfg) => (["fcover", "fwide", "pcxl"].includes(cfg.res) ? cfg.res : "fwide");
const strip = (t) => String(t || "").replace(/<\/?[a-z]+[^>]*>/g, "");

export function createKit({ dry, token, chat, root, site, cache, log, getCtx, busy, outDir }) {
  let outN = 0;
  const OUT = outDir || path.join(root, "out_chat");
  async function tg(method, payload, isForm) {
    if (dry) return { ok: true, result: { message_id: ++outN } };
    for (let a = 0; a < 3; a++) {
      try {
        const sig = AbortSignal.timeout(method === "getUpdates" ? 70000 : 60000);
        const r = await fetch("https://api.telegram.org/bot" + token + "/" + method, isForm ? { method: "POST", body: payload, signal: sig } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}), signal: sig });
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
      if (dry) { console.log("\n┌─ 봇 답장 ─────────────\n" + strip(chunks[i]) + (extra && i === chunks.length - 1 ? "\n└─ [버튼] " + JSON.stringify(extra).slice(0, 200) : "\n└──────────────")); outN++; continue; }
      last = await tg("sendMessage", { chat_id: chat, text: chunks[i], parse_mode: "HTML", disable_web_page_preview: true, ...(i === chunks.length - 1 && extra ? { reply_markup: extra } : {}) });
      if (!last.ok) { log("전송 실패", last.description); last = await tg("sendMessage", { chat_id: chat, text: strip(chunks[i]), disable_web_page_preview: true }); }   /* HTML 오류면 태그 없이 다시 */
    }
    return last && last.result && last.result.message_id;
  }
  async function photo(buf, caption, markup, html, name) {
    if (dry) { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, (name || String(++outN).padStart(2, "0")) + ".png"); fs.writeFileSync(f, buf); console.log("\n┌─ 봇 사진 ─ " + f + " (" + Math.round(buf.length / 1024) + "KB)\n" + strip(caption) + "\n└──────────────"); return outN; }
    const send = async () => { const f = new FormData(); f.append("chat_id", chat); if (caption) { f.append("caption", String(caption).slice(0, 1000)); if (html) f.append("parse_mode", "HTML"); } if (markup) f.append("reply_markup", JSON.stringify(markup)); f.append("photo", new Blob([buf], { type: "image/png" }), "chart.png"); return tg("sendPhoto", f, true); };
    let j = await send();
    if (!j.ok && /429|Too Many/i.test(String(j.description))) { await sleep(8000); j = await send(); }
    if (!j.ok) { log("사진 전송 실패", j.description); throw new Error("사진 전송 실패: " + j.description); }
    return j.result.message_id;
  }
  async function document(buf, filename, replyTo) {   /* 원본 PNG 파일(사진은 압축되므로) */
    if (dry) return null;
    const f = new FormData(); f.append("chat_id", chat); f.append("document", new Blob([buf], { type: "image/png" }), filename); f.append("disable_content_type_detection", "true"); if (replyTo) f.append("reply_to_message_id", String(replyTo));
    return tg("sendDocument", f, true);
  }
  const action = (a) => (dry ? null : tg("sendChatAction", { chat_id: chat, action: a || "upload_photo" }));
  const delMsg = (id) => (dry || !id ? null : tg("deleteMessage", { chat_id: chat, message_id: id }));

  /* ── 그리기 ── */
  let SRV = null, BR = null, brUse = 0, brIdle = null;
  async function server() {
    if (SRV) return SRV;
    const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".txt": "text/plain" };
    const s = http.createServer((q, r) => { try { const f = path.resolve(path.join(site, decodeURIComponent(new URL(q.url, "http://x").pathname))); if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" }); fs.createReadStream(f).pipe(r); } catch (e) { r.writeHead(500); r.end(); } });
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
  /* 카드 한 장 → { png, caption, detail }.  rowOverride = 하이퍼리퀴드 이름을 직접 줄 때({full, short, dex}) — 소문자 k 코인(kPEPE) 등 */
  async function makeCard(tk, iv, days, cfg, resKey, rowOverride) {
    busy(1);
    try {
      const C = await getCtx();
      const row = rowOverride || pickRow(C.uni, tk, C.info);
      if (!row) return null;
      const d = await buildCardData({ row, ticker: tk, info: C.info, iv, days, fx: C.fx, log: () => {}, cacheDir: cache, mode: cfg.mode });
      if (!d) return null;
      applyCardCfg(d, cfg, resKey || cfg.res || cfg.cardRes, { noMini: iv === "1d" });   /* 일봉 카드에는 일봉 미니차트가 중복이라 뺌 */
      const { base } = await server(), b = await browser(), page = await b.newPage();
      try { page.on("pageerror", () => {}); const png = await renderCard(page, base, d); flushCardCache(cache); return { png: Buffer.from(png), caption: d.caption, detail: d.detail }; }
      finally { await page.close().catch(() => {}); }
    } finally { busy(-1); }
  }
  /* 리포트·표 사진: out = { header, sections, foot, theme? } */
  async function drawReportPng(out, resKey) {
    const b = await browser(), page = await b.newPage();
    try {
      await page.setContent("<html><body style='margin:0;background:" + ((out.theme && out.theme.ic && out.theme.ic.bg) || "#17181c") + "'></body></html>");
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, "rep-render.js"), "utf8") });
      let buf = null;
      for (let k = 0, w = REP_W[resKey] || 2184; k < 3; k++, w = Math.round(w * 0.78)) {   /* 텔레그램 사진 10MB 한도 */
        const r = await page.evaluate((spec) => window.drawReport(spec), { header: out.header, sections: out.sections, foot: out.foot, theme: out.theme, outW: w });
        buf = Buffer.from(r.url.split(",")[1], "base64");
        if (buf.length < 9.5e6) break;
      }
      return buf;
    } finally { await page.close().catch(() => {}); }
  }
  async function close() { clearTimeout(brIdle); try { if (BR) await BR.close(); } catch (e) {} BR = null; }
  return { tg, say, photo, document, action, delMsg, makeCard, drawReportPng, close };
}
