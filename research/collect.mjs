/* 연구 1단계: 데이터 수집
   · 평일 하루 평균 거래대금 상위 25개(HIP-3) 선정 → 1h · 2h · 4h 최대치 + 일봉 최대치를 research/data 에 저장
   · HL 분당 가중치 한도(1200)보다 낮게(1000) 호출 — 약 6~8분 걸림 */
import fs from "node:fs";
import path from "node:path";
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "data");
fs.mkdirSync(DIR, { recursive: true });
const HL = "https://api.hyperliquid.xyz/info", sleep = (ms) => new Promise((r) => setTimeout(r, ms)), BUDGET = 1000;
let used = [];
const IVMIN = { "1h": 60, "2h": 120, "4h": 240, "1d": 1440 };
async function hl(body, expectBars) {
  const w = body.type === "candleSnapshot" ? 20 + Math.ceil((expectBars || 60) / 60) : 20;
  for (let a = 0; a < 8; a++) {
    for (;;) { const now = Date.now(); used = used.filter((x) => now - x[0] < 60000); const sum = used.reduce((s, x) => s + x[1], 0); if (sum + w <= BUDGET || !used.length) break; await sleep(Math.min(3000, used[0][0] + 60000 - now + 80)); }
    used.push([Date.now(), w]);
    try { const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (r.ok) return await r.json(); if (r.status === 429) { console.log("429 대기"); await sleep(10000 + a * 5000); continue; } await sleep(1500); } catch (e) { await sleep(1500); }
  }
  return null;
}
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const T0 = Date.now();
log("유니버스 수집");
const dexs = await hl({ type: "perpDexs" });
const rows = [];
for (const dx of (dexs || []).filter((d) => d && d.name).map((d) => d.name)) {
  const r = await hl({ type: "metaAndAssetCtxs", dex: dx }); if (!r) continue;
  r[0].universe.forEach((u, i) => { const c = r[1][i] || {}; rows.push({ dex: dx, full: u.name, short: u.name.includes(":") ? u.name.split(":")[1] : u.name, dayNtl: +c.dayNtlVlm || 0 }); });
}
rows.sort((a, b) => b.dayNtl - a.dayNtl);
const cand = rows.slice(0, 60);
log("후보 60종목 일봉 수집(평일 평균 거래대금 순위용 + 켈트너용)");
const daily = {};
for (const r of cand) {
  const now = Date.now(), cs = await hl({ type: "candleSnapshot", req: { coin: r.full, interval: "1d", startTime: now - 5000 * 864e5, endTime: now } }, 400);
  if (cs && cs.length > 30) daily[r.full] = cs.map((c) => [c.t, +c.o, +c.h, +c.l, +c.c, +c.v]);
}
const rank = cand.map((r) => {
  const d = daily[r.full]; if (!d) return null;
  const wd = d.filter((c) => c[0] + 864e5 <= Date.now()).filter((c) => { const g = new Date(c[0]).getUTCDay(); return g >= 1 && g <= 5; }).slice(-15);
  if (wd.length < 8) return null;
  const avg = wd.reduce((s, c) => s + c[5] * (c[2] + c[3] + c[4]) / 3, 0) / wd.length;
  return Object.assign({ avg }, r);
}).filter(Boolean).sort((a, b) => b.avg - a.avg).slice(0, 25);
fs.writeFileSync(path.join(DIR, "universe.json"), JSON.stringify(rank.map((r) => ({ full: r.full, short: r.short, dex: r.dex, avgNtl: r.avg }))));
log("상위 25:", rank.map((r) => r.short).join(", "));
for (const r of rank) fs.writeFileSync(path.join(DIR, r.short.replace(/[^A-Za-z0-9]/g, "_") + "_1d.json"), JSON.stringify(daily[r.full]));
let k = 0;
for (const r of rank) {
  k++;
  for (const iv of ["1h", "2h", "4h"]) {
    const ms = IVMIN[iv] * 60000, now = Date.now(), want = 5000;
    const cs = await hl({ type: "candleSnapshot", req: { coin: r.full, interval: iv, startTime: now - want * ms, endTime: now } }, iv === "1h" ? 5000 : iv === "2h" ? 2600 : 1500);
    if (!cs || cs.length < 100) { log(r.short, iv, "데이터 부족"); continue; }
    fs.writeFileSync(path.join(DIR, r.short.replace(/[^A-Za-z0-9]/g, "_") + "_" + iv + ".json"), JSON.stringify(cs.map((c) => [c.t, +c.o, +c.h, +c.l, +c.c, +c.v])));
  }
  log(k + "/25", r.short, "완료", "경과", Math.round((Date.now() - T0) / 1000) + "초");
}
log("수집 끝", Math.round((Date.now() - T0) / 1000) + "초");
