/* 연구 3단계: 분석·셋업 순위 (v3)
   · 대상: 평일에 확정된 돌파·이탈 이벤트(주말 확정 이벤트는 유동성이 달라 별도 집계만)
   · 셋업 = 패턴 그룹 × 방향(롱/숏) × 조건 조합. 조건 목록은 결과를 보기 전에 정해 둔 고정 목록(끼워맞추기 방지)
   · 선정: 앞 60%(시간순)로 고르고 뒤 40%로 검증. 통과 = 표본·두 구간 모두 기준선 이상, 정렬 = Wilson 95% 신뢰하한
   · 순열검정: 라벨을 섞어도 이만큼 좋은 셋업이 나올 확률(후보 전체 중 최고를 고른 효과 반영)
   · 결과: research/out/report.md + pattern_rank.json (v3) */
import fs from "node:fs";
import path from "node:path";
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), OUT = path.join(ROOT, "out");
const evAll = JSON.parse(fs.readFileSync(path.join(OUT, "events.json"), "utf8"));
const wilson = (s, n) => { if (!n) return 0; const z = 1.96, p = s / n, d = 1 + z * z / n; return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d; };
const resolved = (a) => a.filter((e) => e.state === "success" || e.state === "fail");
const stat = (a) => { const r = resolved(a), s = r.filter((e) => e.state === "success").length, n = r.length; return { n, s, win: n ? s / n : null, lb: wilson(s, n), flat: a.filter((e) => e.state === "flat").length }; };
const pct = (x, d) => (x == null ? "—" : (x * 100).toFixed(d == null ? 1 : d) + "%");
const avg = (a) => { const b = a.filter((x) => x != null); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
const ymd = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const ev = evAll.filter((e) => !e.wk), evWk = evAll.filter((e) => e.wk);
const R = resolved(ev), times = R.map((e) => e.t).sort((a, b) => a - b), cut = times[Math.floor(times.length * 0.6)];
const isTrain = (e) => e.t <= cut;
const zt = (a, b) => { const x = stat(a), y = stat(b); if (!x.n || !y.n) return { d: null, z: null, x, y }; const p = (x.s + y.s) / (x.n + y.n), se = Math.sqrt(p * (1 - p) * (1 / x.n + 1 / y.n)); return { d: x.win - y.win, z: se > 0 ? (x.win - y.win) / se : 0, x, y }; };
const lines = [], P = (s) => lines.push(s == null ? "" : s);

/* ── 패턴 그룹(대중적으로 많이 알려진 정도를 famous 로 표시) ── */
const GRP = {
  doubleBottom: ["쌍바닥", true], doubleTop: ["쌍천장", true], headShoulders: ["헤드앤숄더", true], invHeadShoulders: ["역헤드앤숄더", true], cupHandle: ["컵위드핸들", true],
  bullFlag: ["상승깃발", true], bearFlag: ["하락깃발", true], ascTriangle: ["삼각수렴", true], symTriangle: ["삼각수렴", true], descTriangle: ["삼각수렴", true],
  fallingWedge: ["쐐기", false], risingWedge: ["쐐기", false], box: ["박스권", false],
};
ev.forEach((e) => { const g = GRP[e.type]; e.grp = g ? g[0] : e.name; e.famous = g ? g[1] : false; e.side = e.dir > 0 ? "L" : "S"; });
const groups = [...new Set(ev.map((e) => e.grp))];

/* ── 조건(고정 목록) ── */
const COND = {
  z: { f: (e) => (e.side === "L" ? e.zone === "A" || e.zone === "B" : e.zone === "C" || e.zone === "D"), txt: { L: "켈트너 상단권(상단 위·중심~상단)", S: "켈트너 하단권(하단~중심·하단 아래)" } },
  c2: { f: (e) => e.conf >= 2, txt: { L: "지지 중복 2개↑(지지대·VWAP·켈트너)", S: "저항 중복 2개↑(저항대·VWAP·켈트너)" } },
  sr: { f: (e) => e.srC, txt: { L: "과거 지지대와 겹침", S: "과거 저항대와 겹침" } },
  vw: { f: (e) => e.vwapC, txt: { L: "VWAP 지지", S: "VWAP 저항" } },
  ke: { f: (e) => e.keltC, txt: { L: "켈트너 지지선과 겹침", S: "켈트너 저항선과 겹침" } },
  vb: { f: (e) => e.volB != null && e.volB >= 1.5, txt: { L: "돌파봉 거래량 1.5배↑", S: "이탈봉 거래량 1.5배↑" } },
  us: { f: (e) => e.sess === "US", txt: { L: "미국장 시간대 돌파", S: "미국장 시간대 이탈" } },
};
const SETS = [[], ["z"], ["c2"], ["sr"], ["vw"], ["ke"], ["vb"], ["us"], ["z", "c2"], ["z", "vb"], ["c2", "vb"], ["z", "us"], ["vw", "vb"], ["z", "vw"], ["c2", "us"], ["vb", "us"], ["sr", "vb"], ["z", "sr"]];
const key = (c) => c.join("+") || "base";

/* ── 1. 개요·기준선 ── */
const syms = new Set(ev.map((e) => e.sym));
P("# 패턴 셋업 연구 리포트 (v3)"); P();
P("- 생성: " + new Date().toISOString().slice(0, 16) + "Z · 종목 " + syms.size + "개(HIP-3 평일 하루 평균 거래대금 상위) · 기간 " + ymd(Math.min(...evAll.map((e) => e.t))) + " ~ " + ymd(Math.max(...evAll.map((e) => e.t))));
P("- 이벤트: 전체 " + evAll.length + "건 → 평일 확정 " + ev.length + "건(주말 확정 " + evWk.length + "건은 유동성이 달라 제외) → 승패가 갈린 것 " + R.length + "건");
P("- 봉 간격 1h(주력) · 4h, 일봉 켈트너(20/10/1.5)는 전날 확정 일봉 기준(미래 정보 없음). 중복도·거래량도 확정 봉까지의 데이터만 사용");
P("- 성공 = 돌파/이탈 후 패턴 높이의 60%에 닿음 · 실패 = 반대로 60%에 먼저 닿음(같은 봉이면 실패) · 보합 = 기간 내 둘 다 아님(제외)");
P("- 시간 분할: 앞 60%(~" + ymd(cut) + ")로 선정 · 뒤 40%로 검증");
P(); P("## 1. 기준선 (전체 패턴 평균)");
P("| 봉 | 롱 성공률 | 롱 n | 숏 성공률 | 숏 n |"); P("|---|---|---|---|---|");
const BASE = { L: {}, S: {} };
["1h", "4h"].forEach((iv) => { const l = stat(ev.filter((e) => e.iv === iv && e.side === "L")), s = stat(ev.filter((e) => e.iv === iv && e.side === "S")); BASE.L[iv] = l.win; BASE.S[iv] = s.win; P("| " + iv + " | " + pct(l.win) + " | " + l.n + " | " + pct(s.win) + " | " + s.n + " |"); });

/* ── 2. 패턴 그룹별 성적(1h) ── */
P(); P("## 2. 패턴별 성적표 (1h, 평일)");
P("| 패턴 | 방향 | n | 성공률 | 신뢰하한 | 기준선 대비 | 앞60% | 뒤40% | 평균 후속수익 |"); P("|---|---|---|---|---|---|---|---|---|");
groups.forEach((g) => ["L", "S"].forEach((side) => {
  const a = ev.filter((e) => e.iv === "1h" && e.grp === g && e.side === side), s = stat(a); if (s.n < 20) return;
  const tr = stat(a.filter(isTrain)), te = stat(a.filter((e) => !isTrain(e)));
  P("| " + g + " | " + (side === "L" ? "상단 돌파(롱)" : "하단 이탈(숏)") + " | " + s.n + " | " + pct(s.win) + " | " + pct(s.lb) + " | " + ((s.win - BASE[side]["1h"]) * 100 >= 0 ? "+" : "") + ((s.win - BASE[side]["1h"]) * 100).toFixed(1) + "%p | " + pct(tr.win, 0) + " (" + tr.n + ") | " + pct(te.win, 0) + " (" + te.n + ") | " + (avg(a.map((e) => e.fw2)) == null ? "—" : avg(a.map((e) => e.fw2)).toFixed(2) + "%") + " |");
}));

/* ── 3. 요소별 효과(1h) ── */
P(); P("## 3. 조건 하나씩의 효과 (1h · 켜짐 vs 꺼짐, 두 비율 z검정 |z|≥1.96 이면 5% 수준 유의)");
P("| 조건 | 방향 | 켜짐 성공률 (n) | 꺼짐 성공률 (n) | 차이 | z |"); P("|---|---|---|---|---|---|");
["z", "c2", "sr", "vw", "ke", "vb", "us"].forEach((c) => ["L", "S"].forEach((side) => {
  const a = ev.filter((e) => e.iv === "1h" && e.side === side), on = a.filter(COND[c].f), off = a.filter((e) => !COND[c].f(e)), r = zt(on, off); if (r.x.n < 20) return;
  P("| " + COND[c].txt[side] + " | " + (side === "L" ? "롱" : "숏") + " | " + pct(r.x.win) + " (" + r.x.n + ") | " + pct(r.y.win) + " (" + r.y.n + ") | " + (r.d * 100 >= 0 ? "+" : "") + (r.d * 100).toFixed(1) + "%p | " + (r.z == null ? "—" : r.z.toFixed(2)) + " |");
}));
P(); P("### 지지·저항 중복도 개수별 (1h)");
P("| 중복 개수 | 롱 성공률 (n) | 숏 성공률 (n) |"); P("|---|---|---|");
[0, 1, 2, 3].forEach((k) => { const l = stat(ev.filter((e) => e.iv === "1h" && e.side === "L" && e.conf === k)), s = stat(ev.filter((e) => e.iv === "1h" && e.side === "S" && e.conf === k)); P("| " + k + "개 | " + pct(l.win) + " (" + l.n + ") | " + pct(s.win) + " (" + s.n + ") |"); });

/* ── 4. 사용자 가설 점검 ── */
P(); P("## 4. 가설 점검");
{
  const a = ev.filter((e) => e.iv === "1h"), fam = a.filter((e) => e.famous), nf = a.filter((e) => !e.famous), r = zt(fam, nf);
  P("- **'대중적으로 잘 알려진 패턴이 성공 돌파 확률도 높다'** (쌍바닥·쌍천장·헤드앤숄더·컵·깃발·삼각수렴 vs 쐐기·박스권, 1h): " + pct(r.x.win) + " (n=" + r.x.n + ") vs " + pct(r.y.win) + " (n=" + r.y.n + ") → 차이 " + (r.d * 100).toFixed(1) + "%p, z=" + r.z.toFixed(2));
  const dbL = ev.filter((e) => e.iv === "1h" && e.type === "doubleBottom"), dbOn = dbL.filter((e) => e.conf >= 2), dbOff = dbL.filter((e) => e.conf < 2), r2 = zt(dbOn, dbOff);
  P("- **쌍바닥 + 지지 중복(2개↑)** (1h): " + pct(r2.x.win) + " (n=" + r2.x.n + ") vs 중복 적음 " + pct(r2.y.win) + " (n=" + r2.y.n + ") → 차이 " + (r2.d * 100).toFixed(1) + "%p, z=" + (r2.z == null ? "—" : r2.z.toFixed(2)));
  const dbV = dbL.filter((e) => e.vwapC), dbNV = dbL.filter((e) => !e.vwapC), r3 = zt(dbV, dbNV);
  P("- **쌍바닥 + VWAP 지지** (1h): " + pct(r3.x.win) + " (n=" + r3.x.n + ") vs 아님 " + pct(r3.y.win) + " (n=" + r3.y.n + ") → 차이 " + (r3.d * 100).toFixed(1) + "%p, z=" + (r3.z == null ? "—" : r3.z.toFixed(2)));
  const tri = ev.filter((e) => e.iv === "1h" && e.grp === "삼각수렴" && e.side === "L"), triV = tri.filter(COND.vb.f), triN = tri.filter((e) => !COND.vb.f(e)), r4 = zt(triV, triN);
  P("- **삼각수렴 상단 돌파 + 돌파봉 거래량 1.5배↑** (1h): " + pct(r4.x.win) + " (n=" + r4.x.n + ") vs 거래량 약함 " + pct(r4.y.win) + " (n=" + r4.y.n + ") → 차이 " + (r4.d * 100).toFixed(1) + "%p, z=" + (r4.z == null ? "—" : r4.z.toFixed(2)) + " · 삼각수렴 상단 돌파 전체 " + pct(stat(tri).win) + " (n=" + stat(tri).n + ")");
}

/* ── 5. 셋업 후보 전체 + 통과 판정 ── */
const cands = [];
["1h", "4h"].forEach((iv) => ["L", "S"].forEach((side) => {
  const pop = ev.filter((e) => e.iv === iv && e.side === side), minN = iv === "1h" ? 40 : 30;
  [null, ...groups].forEach((g) => SETS.forEach((cs) => {
    if (g == null && cs.length === 0) return;   /* 전체-무조건은 기준선 */
    const a = pop.filter((e) => (g == null || e.grp === g) && cs.every((c) => COND[c].f(e))), s = stat(a); if (s.n < 20) return;
    const tr = stat(a.filter(isTrain)), te = stat(a.filter((e) => !isTrain(e)));
    const base = BASE[side][iv] || 0.5;
    cands.push({ iv, side, grp: g || "전체 패턴", conds: cs, n: s.n, s: s.s, win: s.win, lb: s.lb, trN: tr.n, trWin: tr.win, teN: te.n, teWin: te.win, fw: avg(a.map((e) => e.fw2)), base, lift: s.win - base, flat: s.flat,
      pass: s.n >= minN && tr.n >= 20 && te.n >= 15 && tr.win >= base && te.win >= base && s.lb > 0.40 });
  }));
}));
P(); P("## 5. 셋업 후보 성적표 (1h · n ≥ 40 · 신뢰하한 순 상위 40)");
P("| 방향 | 패턴 | 조건 | n | 성공률 | 기준선 대비 | 신뢰하한 | 앞60% | 뒤40% | 통과 |"); P("|---|---|---|---|---|---|---|---|---|---|");
cands.filter((c) => c.iv === "1h" && c.n >= 40).sort((a, b) => b.lb - a.lb).slice(0, 40).forEach((c) => P("| " + (c.side === "L" ? "롱" : "숏") + " | " + c.grp + " | " + (c.conds.map((k) => COND[k].txt[c.side]).join(" + ") || "—") + " | " + c.n + " | " + pct(c.win) + " | " + (c.lift * 100 >= 0 ? "+" : "") + (c.lift * 100).toFixed(1) + "%p | " + pct(c.lb) + " | " + pct(c.trWin, 0) + " (" + c.trN + ") | " + pct(c.teWin, 0) + " (" + c.teN + ") | " + (c.pass ? "✅" : "") + " |"));
P("- 통과 기준: n ≥ 40(4h는 30), 앞60% n ≥ 20 · 뒤40% n ≥ 15, 앞·뒤 모두 성공률 ≥ 해당 방향 기준선, 신뢰하한 > 40%");

/* ── 6. 최종 셋업: 패턴 그룹당 신뢰하한 최고 1개 ── */
const pick = (iv, side, n) => { const m = {}; cands.filter((c) => c.iv === iv && c.side === side && c.pass && c.grp !== "전체 패턴").forEach((c) => { if (!m[c.grp] || c.lb > m[c.grp].lb) m[c.grp] = c; }); return Object.values(m).sort((a, b) => b.lb - a.lb).slice(0, n); };
const FINAL = { "1h": { L: pick("1h", "L", 4), S: pick("1h", "S", 3) }, "4h": { L: pick("4h", "L", 3), S: pick("4h", "S", 2) } };
P(); P("## 6. 최종 셋업 순위 (그룹당 가장 좋은 조건 1개)");
P("| 봉 | 방향 | 순위 | 패턴 | 조건 | n | 성공률 | 기준선 대비 | 신뢰하한 | 앞60% | 뒤40% |"); P("|---|---|---|---|---|---|---|---|---|---|---|");
["1h", "4h"].forEach((iv) => ["L", "S"].forEach((side) => FINAL[iv][side].forEach((c, i) => P("| " + iv + " | " + (side === "L" ? "롱" : "숏") + " | " + (i + 1) + " | " + c.grp + " | " + (c.conds.map((k) => COND[k].txt[side]).join(" + ") || "—") + " | " + c.n + " | " + pct(c.win) + " | " + (c.lift * 100 >= 0 ? "+" : "") + (c.lift * 100).toFixed(1) + "%p | " + pct(c.lb) + " | " + pct(c.trWin, 0) + " (" + c.trN + ") | " + pct(c.teWin, 0) + " (" + c.teN + ") |"))));

/* ── 7. 순열검정 ── */
function permTest(iv, side, iters) {
  const pop = resolved(ev.filter((e) => e.iv === iv && e.side === side)), labels = pop.map((e) => (e.state === "success" ? 1 : 0)), minN = iv === "1h" ? 40 : 30;
  const gs = []; [null, ...groups].forEach((g) => SETS.forEach((cs) => { if (g == null && cs.length === 0) return; const idx = []; pop.forEach((e, i) => { if ((g == null || e.grp === g) && cs.every((c) => COND[c].f(e))) idx.push(i); }); if (idx.length >= minN) gs.push(idx); }));
  const obs = Math.max(...gs.map((idx) => { let s = 0; idx.forEach((i) => { s += labels[i]; }); return wilson(s, idx.length); }));
  let ge = 0, seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let it = 0; it < iters; it++) {
    const lab = labels.slice(); for (let i = lab.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = lab[i]; lab[i] = lab[j]; lab[j] = t; }
    let mx = 0; gs.forEach((idx) => { let s = 0; idx.forEach((i) => { s += lab[i]; }); const v = wilson(s, idx.length); if (v > mx) mx = v; });
    if (mx >= obs) ge++;
  }
  return { p: (ge + 1) / (iters + 1), groups: gs.length, obs };
}
P(); P("## 7. 우연 검정 (순열검정 2000회 · 후보 전체 중 최고를 고른 효과 반영)");
const PERM = {};
["1h", "4h"].forEach((iv) => ["L", "S"].forEach((side) => { const r = permTest(iv, side, 2000); (PERM[iv] = PERM[iv] || {})[side] = +r.p.toFixed(3); P("- " + iv + " " + (side === "L" ? "롱" : "숏") + ": 후보 " + r.groups + "개 중 최고 신뢰하한 " + pct(r.obs) + " → 라벨을 무작위로 섞어도 그 이상이 나올 확률 p = " + r.p.toFixed(3)); }));
P("- p 가 0.05 보다 작으면 '우연히 이 정도 최고 성적이 나올 가능성이 5% 미만'이라는 뜻입니다.");

/* ── 8. 종목별 일관성(최상위 셋업) ── */
P(); P("## 8. 종목별 일관성 (최상위 셋업, 1h)");
["L", "S"].forEach((side) => { const c = FINAL["1h"][side][0]; if (!c) return; const a = ev.filter((e) => e.iv === "1h" && e.side === side && e.grp === c.grp && c.conds.every((k) => COND[k].f(e))), m = {}; a.forEach((e) => (m[e.sym] = m[e.sym] || []).push(e)); const r = Object.entries(m).map(([k, x]) => [k, stat(x)]).filter(([, s]) => s.n >= 5), up = r.filter(([, s]) => s.win > 0.5).length; P("- " + (side === "L" ? "롱 " : "숏 ") + c.grp + (c.conds.length ? " + " + c.conds.map((k) => COND[k].txt[side]).join(" + ") : "") + ": 표본 5건 이상 종목 " + r.length + "개 중 " + up + "개가 50% 초과 (" + r.sort((a, b) => b[1].win - a[1].win).slice(0, 12).map(([k, s]) => k + " " + pct(s.win, 0) + "(" + s.n + ")").join(", ") + ")"); });
P(); P("> 이벤트는 시간·종목 간 상관이 있어 표본이 보이는 것보다 독립적이지 않습니다. 과거 확률이며 미래 수익을 보장하지 않습니다.");

/* ── 출력 ── */
const pack = (c) => ({ grp: c.grp, side: c.side, iv: c.iv, conds: c.conds, condText: c.conds.map((k) => COND[k].txt[c.side]), n: c.n, win: +c.win.toFixed(4), lb: +c.lb.toFixed(4), lift: +c.lift.toFixed(4), trN: c.trN, trWin: +c.trWin.toFixed(4), teN: c.teN, teWin: +c.teWin.toFixed(4), fw: c.fw == null ? null : +c.fw.toFixed(2) });
const final = {
  version: 3, generatedAt: new Date().toISOString(), universe: [...syms], events: ev.length, resolved: R.length, period: { from: ymd(Math.min(...evAll.map((e) => e.t))), to: ymd(Math.max(...evAll.map((e) => e.t))) },
  baseline: BASE, perm: PERM, weekendExcluded: evWk.length, params: { target: "높이60%", stop: "높이60%", split: "60/40", tolerance: "0.5%" },
  setups: { "1h": { L: FINAL["1h"].L.map(pack), S: FINAL["1h"].S.map(pack) }, "4h": { L: FINAL["4h"].L.map(pack), S: FINAL["4h"].S.map(pack) } },
};
/* 패턴 그룹별 과거 성적(순위에 못 든 패턴도 '지금 포착된 신호'에 과거 성공률을 붙이기 위해 저장) */
final.groupStats = {};
["1h", "4h"].forEach((iv) => { final.groupStats[iv] = {}; groups.forEach((g) => ["L", "S"].forEach((side) => { const s = stat(ev.filter((e) => e.iv === iv && e.grp === g && e.side === side)); if (s.n >= 10) (final.groupStats[iv][g] = final.groupStats[iv][g] || {})[side] = { n: s.n, win: +s.win.toFixed(4), lift: +(s.win - (BASE[side][iv] || 0.5)).toFixed(4) }; })); });
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "pattern_rank.json"), JSON.stringify(final, null, 1));
console.log(lines.join("\n"));
