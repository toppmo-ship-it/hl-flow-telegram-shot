/* 연구 2단계: 백테스트 — 모든 종목·봉에서 패턴을 찾고, 돌파 확정 시점의 (일봉 켈트너 구간 · 6점 지표 점수 · 구조)와 결과를 기록
   · 미래 정보 금지: 지표·구간은 '돌파 확정 봉' 시점까지의 데이터만 사용 (구간은 전날 확정 일봉 기준)
   · 결과: success(패턴 높이의 60% 도달) / fail(60% 반대 이동) / flat(기간 내 둘 다 아님) / open(아직 진행) */
import fs from "node:fs";
import path from "node:path";
import "../site/patterns.js";
import "../site/quant.js";
const P = globalThis.Patterns, Q = globalThis.Quant;
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), DIR = path.join(ROOT, "data"), OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });
const uni = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
const load = (short, iv) => { const f = path.join(DIR, short.replace(/[^A-Za-z0-9]/g, "_") + "_" + iv + ".json"); if (!fs.existsSync(f)) return null; return JSON.parse(fs.readFileSync(f, "utf8")).map((c) => ({ time: Math.round(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] * (c[2] + c[3] + c[4]) / 3 })); };
const FWD = { "1h": [12, 48], "2h": [6, 24], "4h": [6, 18] };   /* 돌파 후 N봉 뒤 수익률(방향 기준) — 보조 지표 */
const events = [], meta = { symbols: 0, bars: {}, patterns: 0, t0: Date.now() };
const seenSym = new Set();
for (const u of uni) {
  if (seenSym.has(u.short)) continue; seenSym.add(u.short);   /* 같은 티커가 두 거래소에 있으면 한 번만 */
  const daily = load(u.short, "1d"); if (!daily || daily.length < 30) continue;
  const zoner = Q.makeZoner(daily);
  for (const iv of ["1h", "2h", "4h"]) {
    const cs = load(u.short, iv); if (!cs || cs.length < 200) continue;
    meta.symbols++; meta.bars[iv] = (meta.bars[iv] || 0) + cs.length;
    const pq = Q.prepare(cs), res = P.detect(cs);
    res.pats.forEach((p) => {
      if (!(p.confirmI > 0) || !p.dirReal || P.META[p.type].info) return;
      const j = p.confirmI, f = pq.at(j), z = zoner(cs[j].time, cs[j].close); if (!f || !z) return;
      meta.patterns++;
      const entry = cs[j].close, d = p.dirReal, fw = (FWD[iv] || [12, 48]).map((N) => (j + N < cs.length ? d * (cs[j + N].close / entry - 1) * 100 : null));
      events.push({ sym: u.short, iv, type: p.type, name: p.name, dir: d, t: cs[j].time, state: p.state, zone: z.z, zpos: +z.pos.toFixed(3), score: f.score, pts: f.pts, lab: f.lab, rsi: f.rsi, avGap: f.avGap, hPct: +(p.height / entry * 100).toFixed(2), width: p.end - p.start, fw1: fw[0], fw2: fw[1] });
    });
  }
}
fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify(events));
const by = {}; events.forEach((e) => { by[e.state] = (by[e.state] || 0) + 1; });
console.log("종목-봉 조합", meta.symbols, "봉 수", JSON.stringify(meta.bars), "이벤트", events.length, JSON.stringify(by), "소요", Math.round((Date.now() - meta.t0) / 1000) + "초");
