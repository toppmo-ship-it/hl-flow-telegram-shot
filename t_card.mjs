import fs from "node:fs"; import http from "node:http"; import path from "node:path"; import puppeteer from "puppeteer-core";
import { loadSiteInfo, loadUniverse, usdKrw, pickRow, buildCardData, renderCard, flushCardCache } from "./extras.mjs";
const SITE = path.resolve("site"), log = () => {};
const srv = http.createServer((q, r) => { const f = path.join(SITE, q.url.split("?")[0]); if (fs.existsSync(f) && fs.statSync(f).isFile()) r.end(fs.readFileSync(f)); else { r.statusCode = 404; r.end(); } }).listen(30991);
const info = loadSiteInfo(SITE), uni = await loadUniverse(log), fx = await usdKrw(log);
const exe = fs.readdirSync("C:/Users/toppm/AppData/Local/ms-playwright").filter(x => x.startsWith("chromium-")).map(x => "C:/Users/toppm/AppData/Local/ms-playwright/" + x + "/chrome-win64/chrome.exe")[0];
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1200, height: 1100, deviceScaleFactor: 2 } });
const pg = await b.newPage(); pg.on("pageerror", e => console.log("PAGEERR", e.message));
for (const [t, iv, days] of JSON.parse(process.argv[2])) {
  const row = pickRow(uni, t, info); const d = await buildCardData({ row, ticker: t, info, iv, days, fx, log, cacheDir: ".tcache", mode: "pattern" });
  const png = await renderCard(pg, "http://localhost:30991", d); fs.writeFileSync("card_" + t + "_" + iv + "_" + days + ".png", png); console.log(d.caption.split("\n").filter(l => /점수|패턴/.test(l)).join("\n"));
}
flushCardCache(".tcache"); await b.close(); srv.close();
