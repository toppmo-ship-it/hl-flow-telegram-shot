/* 로컬 확인용: 코인 종목 카드(코인 테마) 1시간봉 + 일봉 미니차트를 실제 운영과 같은 경로(kit.makeCard)로 그려 PNG 저장 */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadSiteInfo, usdKrw } from "./extras.mjs";
import { createKit } from "./kit.mjs";
const ROOT = path.dirname(fileURLToPath(import.meta.url)), SITE = path.join(ROOT, "site"), CACHE = path.join(ROOT, ".tcache"), OUT = path.join(ROOT, "out_test");
fs.mkdirSync(OUT, { recursive: true });
const exe = fs.readdirSync("C:/Users/toppm/AppData/Local/ms-playwright").filter((x) => x.startsWith("chromium-")).map((x) => "C:/Users/toppm/AppData/Local/ms-playwright/" + x + "/chrome-win64/chrome.exe")[0];
process.env.CHROME_PATH = exe;
const ctx = { info: loadSiteInfo(SITE), uni: [], fx: await usdKrw(() => {}) };
const kit = createKit({ dry: true, token: "", chat: () => "", root: ROOT, site: SITE, cache: CACHE, log: console.log, getCtx: async () => ctx, busy: () => {}, outDir: OUT });
const cfg = { mode: process.argv[3] || "ict", cardDaily: true, cardDailySize: "m", cardDailyBars: 60, cardDailyInd: ["kel", "vwap", "vol", "rsi"], res: "fwide" };
for (const tk of (process.argv[2] || "BTC,SOL").split(",")) {
  const row = { full: tk, short: tk, dex: "코인", ko: "", cat: "코인", theme: "fuchsia" };
  const c = await kit.makeCard(tk, "1h", 60, cfg, "fwide", row);
  if (!c) { console.log("데이터 부족", tk); continue; }
  const f = path.join(OUT, "coin_" + tk + "_" + cfg.mode + ".png"); fs.writeFileSync(f, c.png); console.log("저장", f, c.png.length);
}
await kit.close(); process.exit(0);
