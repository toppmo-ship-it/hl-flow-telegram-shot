/* 연구 3단계: 분석·순위 (v2)
   · 순위 단위 = 패턴 × 일봉 켈트너 구간(롱 A·B / 숏 C·D 중 가장 좋은 구간 묶음) — 6점 점수는 순위 필터가 아니라 '현재 상태 표시·종목 정렬'용
     (연구 결과 점수는 성공 확률을 높이지 못했음 → 데이터 끼워맞추기 방지)
   · 통과 기준: 표본 n ≥ 40, 앞 60% 성공률 ≥ 50% 그리고 뒤 40% 성공률 ≥ 50% (두 기간 모두 우위), 정렬 = 전체 Wilson 95% 신뢰하한
   · 순열검정: 라벨을 섞어도 이만큼 좋은 조합이 나올 확률(우연 가능성) 계산
   · 결과: research/out/report.md + pattern_rank.json */
import fs from "node:fs";
import path from "node:path";
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), OUT = path.join(ROOT, "out");
const ev = JSON.parse(fs.readFileSync(path.join(OUT, "events.json"), "utf8"));
const NAME = {}; ev.forEach((e) => { NAME[e.type] = e.name; });
const wilson = (s, n) => { if (!n) return 0; const z = 1.96, p = s / n, d = 1 + z * z / n; return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d; };
const resolved = (a) => a.filter((e) => e.state === "success" || e.state === "fail");
const stat = (a) => { const r = resolved(a), s = r.filter((e) => e.state === "success").length, n = r.length; return { n, s, win: n ? s / n : null, lb: wilson(s, n), flat: a.filter((e) => e.state === "flat").length }; };
const pct = (x, d) => (x == null ? "—" : (x * 100).toFixed(d == null ? 1 : d) + "%");
const times = ev.map((e) => e.t).sort((a, b) => a - b), cut = times[Math.floor(times.length * 0.6)];
const isTrain = (e) => e.t <= cut, ymd = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const Z = { L: { AB: ["A", "B"], A: ["A"], B: ["B"] }, S: { CD: ["C", "D"], C: ["C"], D: ["D"] } };
const sc = (e, side) => (side === "L" ? e.score : 6 - e.score);
const avg = (a) => { const b = a.filter((x) => x != null); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; };
const lines = [], P = (s) => lines.push(s == null ? "" : s);
const L = ev.filter((e) => e.dir > 0), S = ev.filter((e) => e.dir < 0), types = [...new Set(ev.map((e) => e.type))];

P("# 패턴 확률 연구 리포트"); P();
P("- 생성: " + new Date().toISOString().slice(0, 16) + "Z · 이벤트 " + ev.length + "건 · 종목 " + new Set(ev.map((e) => e.sym)).size + "개(평일 하루 평균 거래대금 상위) · 기간 " + ymd(times[0]) + " ~ " + ymd(times[times.length - 1]));
P("- 봉 간격 1h · 2h · 4h 최대 기간(거래소 제공 한도), 일봉 켈트너(20/10/1.5)는 전날 확정 일봉 기준(미래 정보 없음)");
P("- 성공 = 돌파/이탈 후 패턴 높이의 60%에 닿음, 실패 = 반대로 60%에 먼저 닿음(같은 봉에 둘 다 닿으면 실패로 보수 처리), 보합 = 기간 내 둘 다 아님(제외)");
P("- 시간 분할: 앞 60%(~" + ymd(cut) + ")로 선정 · 뒤 40%로 검증");
P(); P("## 1. 기준선");
[["롱(상향 돌파)", L], ["숏(하향 이탈)", S]].forEach(([n, a]) => { const t = stat(a); P("- " + n + ": 성공률 " + pct(t.win) + " (n=" + t.n + ", 보합 " + t.flat + ")"); });
P("- 해석: 이 기준선 대비 몇 %p 높은지가 패턴·구간의 실제 우위입니다. 숏은 기준선이 50% 안팎이라 우위가 약합니다.");

P(); P("## 2. 일봉 켈트너 구간별 성공률");
P("| 구간 | 롱 n | 롱 성공률 | 숏 n | 숏 성공률 |"); P("|---|---|---|---|---|");
[["A", "상단 위"], ["B", "중심~상단"], ["C", "하단~중심"], ["D", "하단 아래"]].forEach(([z, nm]) => { const l = stat(L.filter((e) => e.zone === z)), s = stat(S.filter((e) => e.zone === z)); P("| " + z + " " + nm + " | " + l.n + " | " + pct(l.win) + " | " + s.n + " | " + pct(s.win) + " |"); });
const zt = (a, b) => { const x = stat(a), y = stat(b), p = (x.s + y.s) / (x.n + y.n), se = Math.sqrt(p * (1 - p) * (1 / x.n + 1 / y.n)); return { d: x.win - y.win, z: (x.win - y.win) / se, x, y }; };
const zL = zt(L.filter((e) => ["A", "B"].includes(e.zone)), L.filter((e) => ["C", "D"].includes(e.zone))), zS = zt(S.filter((e) => ["C", "D"].includes(e.zone)), S.filter((e) => ["A", "B"].includes(e.zone)));
P("- 구간 효과 검정(두 비율 z검정): 롱 상단(A·B) " + pct(zL.x.win) + " vs 하단(C·D) " + pct(zL.y.win) + " → 차이 " + (zL.d * 100).toFixed(1) + "%p, z=" + zL.z.toFixed(2) + " / 숏 하단(C·D) " + pct(zS.x.win) + " vs 상단(A·B) " + pct(zS.y.win) + " → 차이 " + (zS.d * 100).toFixed(1) + "%p, z=" + zS.z.toFixed(2) + " (|z|≥1.96 이면 5% 수준 유의)");
P("- 롱은 상단 쪽(A·B)이, 숏은 '하단~중심(C)'이 가장 낫습니다. 하단 아래(D)에서는 오히려 되돌림이 많아 숏 성공률이 낮습니다.");

P(); P("## 3. 봉 간격별 (롱 A·B / 숏 C·D)");
P("| 봉 | 롱 성공률 | 앞60% | 뒤40% | 숏 성공률 | 앞60% | 뒤40% |"); P("|---|---|---|---|---|---|---|");
["1h", "2h", "4h"].forEach((tf) => { const a = L.filter((e) => e.iv === tf && ["A", "B"].includes(e.zone)), b = S.filter((e) => e.iv === tf && ["C", "D"].includes(e.zone)); const f = (x) => pct(stat(x).win, 0) + "(" + stat(x).n + ")"; P("| " + tf + " | " + f(a) + " | " + f(a.filter(isTrain)) + " | " + f(a.filter((e) => !isTrain(e))) + " | " + f(b) + " | " + f(b.filter(isTrain)) + " | " + f(b.filter((e) => !isTrain(e))) + " |"); });
P("- 큰 봉이 더 믿을 만하다는 가설은 이 표본에서는 뚜렷하게 확인되지 않았습니다(4h 표본은 적음).");

P(); P("## 4. 6점 지표 점수는 성공 확률을 높였나?");
P("| 조건 | 롱 성공률(A·B) | 숏 성공률(C·D, 하락 점수 기준) |"); P("|---|---|---|");
const La = L.filter((e) => ["A", "B"].includes(e.zone)), Sa = S.filter((e) => ["C", "D"].includes(e.zone));
[["점수 6", (e, s) => sc(e, s) === 6], ["점수 5 이상", (e, s) => sc(e, s) >= 5], ["점수 4 이하", (e, s) => sc(e, s) <= 4], ["점수 3 이하", (e, s) => sc(e, s) <= 3]].forEach(([n, f]) => { const l = stat(La.filter((e) => f(e, "L"))), s = stat(Sa.filter((e) => f(e, "S"))); P("| " + n + " | " + pct(l.win) + " (" + l.n + ") | " + pct(s.win) + " (" + s.n + ") |"); });
P("- 결론: 돌파가 확정되는 시점에는 대부분의 지표가 이미 같은 방향을 보고 있어(점수 5~6이 대다수), 점수가 높다고 성공 확률이 더 높지는 않았습니다. 그래서 점수는 순위 필터가 아니라 '현재 상태 표시'와 종목 정렬에만 씁니다.");
P(); P("| 지표 | 롱 켜짐 | 롱 꺼짐 | 숏(하락신호 켜짐) | 숏 꺼짐 |"); P("|---|---|---|---|---|");
[["vol", "거래량"], ["rsi", "RSI"], ["macd", "MACD(10/25/8)"], ["w14", "윌리엄스 14"], ["w48", "윌리엄스 48"], ["vwap", "앵커드 VWAP"]].forEach(([k, nm]) => {
  const lo = stat(La.filter((e) => e.pts[k])), lf = stat(La.filter((e) => !e.pts[k])), so = stat(Sa.filter((e) => !e.pts[k])), sf = stat(Sa.filter((e) => e.pts[k]));
  P("| " + nm + " | " + pct(lo.win) + " (" + lo.n + ") | " + pct(lf.win) + " (" + lf.n + ") | " + pct(so.win) + " (" + so.n + ") | " + pct(sf.win) + " (" + sf.n + ") |"); });
P("- 표본이 작은 '꺼짐' 쪽은 오차가 커서 차이를 우위로 해석하기 어렵습니다.");

/* ── 5. 패턴 × 구간 후보 ── */
const cands = [];
types.forEach((t) => ["L", "S"].forEach((side) => Object.entries(Z[side]).forEach(([zg, zs]) => {
  const a = (side === "L" ? L : S).filter((e) => e.type === t && zs.includes(e.zone)), s = stat(a), tr = stat(a.filter(isTrain)), te = stat(a.filter((e) => !isTrain(e)));
  if (s.n < 20) return;
  cands.push({ type: t, name: NAME[t], side, zone: zg, n: s.n, s: s.s, win: s.win, lb: s.lb, trN: tr.n, trWin: tr.win, teN: te.n, teWin: te.win, fw: avg(a.map((e) => e.fw2)), hPct: avg(a.map((e) => e.hPct)) });
})));
const ok = (c) => c.n >= 40 && c.trWin >= 0.5 && c.teWin >= 0.5;
P(); P("## 5. 패턴 × 켈트너 구간 성적표 (n ≥ 20, 신뢰하한 순)");
P("| 구분 | 패턴 | 구간 | n | 성공률 | 신뢰하한 | 앞60% | 뒤40% | 평균 후속수익 | 통과 |"); P("|---|---|---|---|---|---|---|---|---|---|");
cands.slice().sort((a, b) => b.lb - a.lb).forEach((c) => P("| " + (c.side === "L" ? "롱" : "숏") + " | " + c.name + " | " + c.zone + " | " + c.n + " | " + pct(c.win) + " | " + pct(c.lb) + " | " + pct(c.trWin, 0) + " (" + c.trN + ") | " + pct(c.teWin, 0) + " (" + c.teN + ") | " + (c.fw == null ? "—" : c.fw.toFixed(2) + "%") + " | " + (ok(c) ? "✅" : "") + " |"));
P("- 통과 기준: n ≥ 40, 앞 60%·뒤 40% 모두 성공률 ≥ 50%. (후속수익 = 돌파 후 일정 봉 뒤 방향 기준 평균 수익률)");

/* ── 6. 최종 순위: 패턴별 최고 구간 하나만, 신뢰하한 순 ── */
const best = (side) => { const m = {}; cands.filter((c) => c.side === side && ok(c)).forEach((c) => { if (!m[c.type] || c.lb > m[c.type].lb) m[c.type] = c; }); return Object.values(m).sort((a, b) => b.lb - a.lb); };
const finalL = best("L"), finalS = best("S");
P(); P("## 6. 최종 순위 (통과한 것만, 패턴당 가장 좋은 구간 1개)");
P("| 구분 | 순위 | 패턴 | 켈트너 구간 | n | 성공률 | 신뢰하한 | 앞60% | 뒤40% |"); P("|---|---|---|---|---|---|---|---|---|");
finalL.slice(0, 5).forEach((c, i) => P("| 롱 | " + (i + 1) + " | " + c.name + " | " + c.zone + " | " + c.n + " | " + pct(c.win) + " | " + pct(c.lb) + " | " + pct(c.trWin, 0) + " | " + pct(c.teWin, 0) + " |"));
finalS.slice(0, 3).forEach((c, i) => P("| 숏 | " + (i + 1) + " | " + c.name + " | " + c.zone + " | " + c.n + " | " + pct(c.win) + " | " + pct(c.lb) + " | " + pct(c.trWin, 0) + " | " + pct(c.teWin, 0) + " |"));

/* ── 7. 순열검정: 라벨을 섞어도 이만큼 좋은 최고 신뢰하한이 나오는가 ── */
function permTest(side, realBest, iters) {
  const arr = resolved(side === "L" ? L : S).filter((e) => (side === "L" ? ["A", "B"] : ["C", "D"]).includes(e.zone)), labels = arr.map((e) => e.state === "success" ? 1 : 0);
  const groups = []; types.forEach((t) => Object.entries(Z[side]).forEach(([zg, zs]) => { const idx = []; arr.forEach((e, i) => { if (e.type === t && zs.includes(e.zone)) idx.push(i); }); if (idx.length >= 40) groups.push(idx); }));
  let ge = 0, seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let it = 0; it < iters; it++) {
    const lab = labels.slice(); for (let i = lab.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = lab[i]; lab[i] = lab[j]; lab[j] = t; }
    let mx = 0; groups.forEach((idx) => { let s = 0; idx.forEach((i) => { s += lab[i]; }); const v = wilson(s, idx.length); if (v > mx) mx = v; });
    if (mx >= realBest) ge++;
  }
  return { p: (ge + 1) / (iters + 1), groups: groups.length };
}
P(); P("## 7. 우연 검정 (순열검정 2000회)");
[["L", finalL], ["S", finalS]].forEach(([side, fin]) => { if (!fin.length) { P("- " + (side === "L" ? "롱" : "숏") + ": 통과한 조합 없음"); return; } const rb = Math.max(...cands.filter((c) => c.side === side && c.n >= 40).map((c) => c.lb)), r = permTest(side, rb, 2000); P("- " + (side === "L" ? "롱" : "숏") + ": 가장 좋은 조합의 신뢰하한 " + pct(rb) + " — 결과를 무작위로 섞었을 때 그 이상이 나올 확률 p = " + r.p.toFixed(3) + " (후보 " + r.groups + "개 중 최고를 고른 효과까지 반영)"); });
P("- p 가 0.05 보다 작으면 '우연히 이 정도 최고 성적이 나올 가능성이 5% 미만'이라는 뜻입니다. 0.05~0.3 이면 우위가 있을 수 있으나 확신하기 어렵다는 뜻입니다.");

P(); P("## 8. 종목별 일관성 (쌍바닥 롱 · 쌍천장 숏)");
[["doubleBottom", 1, "쌍바닥 롱"], ["doubleTop", -1, "쌍천장 숏"]].forEach(([t, d, nm]) => { const m = {}; ev.filter((e) => e.type === t && e.dir === d).forEach((e) => (m[e.sym] = m[e.sym] || []).push(e)); const r = Object.entries(m).map(([k, a]) => [k, stat(a)]).filter(([, s]) => s.n >= 8), up = r.filter(([, s]) => s.win > 0.5).length; P("- " + nm + ": 표본 8건 이상 종목 " + r.length + "개 중 " + up + "개가 50% 초과 (" + r.sort((a, b) => b[1].win - a[1].win).map(([k, s]) => k + " " + pct(s.win, 0)).join(", ") + ")"); });

P(); P("## 9. 사용자 가설 점검");
const tri = L.filter((e) => ["ascTriangle", "symTriangle"].includes(e.type));
[["삼각수렴 + 켈트너 상단 위(A)", tri.filter((e) => e.zone === "A")], ["삼각수렴 + A + 앵커드VWAP 위", tri.filter((e) => e.zone === "A" && e.pts.vwap)], ["삼각수렴 + A·B + VWAP 위", tri.filter((e) => ["A", "B"].includes(e.zone) && e.pts.vwap)], ["삼각수렴 구간 무관", tri]].forEach(([n, a]) => { const t = stat(a); P("- " + n + ": 성공률 " + pct(t.win) + " (n=" + t.n + ", 신뢰하한 " + pct(t.lb) + ")"); });
P("- 구조(롱 성공률): " + [...new Set(L.map((e) => e.lab))].filter(Boolean).map((l) => { const t = stat(L.filter((e) => e.lab === l)); return l + " " + pct(t.win, 0) + "(" + t.n + ")"; }).join(" · "));
if (fs.existsSync(path.join(OUT, "model.md"))) { P(); P(fs.readFileSync(path.join(OUT, "model.md"), "utf8")); P("- 결론: 돌파 시점의 지표·구간·패턴 크기·구조를 모두 넣은 확률 모델도 검증 구간에서는 무작위 수준이었습니다(학습에서만 좋아 보임 = 과적합). 즉 이 특징들로 개별 돌파의 성공 여부를 미리 맞추기는 어렵고, 아래 순위는 '과거에 상대적으로 나았던 패턴·구간'을 보여주는 참고 정보입니다."); }
P(); P("> 주의: 이벤트는 시간·종목 간 상관이 있어 표본이 보이는 것보다 독립적이지 않습니다. 과거 확률이며 미래 수익을 보장하지 않습니다.");

const pack = (c) => ({ type: c.type, name: c.name, side: c.side, zone: c.zone, minScore: 0, n: c.n, win: +c.win.toFixed(4), lb: +c.lb.toFixed(4), trN: c.trN, trWin: c.trWin, teN: c.teN, teWin: c.teWin, fw: c.fw });
const permL = finalL.length ? permTest("L", Math.max(...cands.filter((c) => c.side === "L" && c.n >= 40).map((c) => c.lb)), 2000).p : null, permS = finalS.length ? permTest("S", Math.max(...cands.filter((c) => c.side === "S" && c.n >= 40).map((c) => c.lb)), 2000).p : null;
const final = { baseline: { L: stat(L).win, S: stat(S).win }, perm: { L: permL, S: permS }, zoneZ: { L: zL.z, S: zS.z }, modelAuc: { L: 0.451, S: 0.484 }, generatedAt: new Date().toISOString(), params: { target: "높이60%", stop: "높이60%", split: "60/40", pass: "n>=40, 앞/뒤 모두 >=50%", scoreUse: "표시·정렬용(필터 아님)" }, universe: [...new Set(ev.map((e) => e.sym))], events: ev.length, L: { ALL: finalL.slice(0, 3).map(pack) }, S: { ALL: finalS.slice(0, 1).map(pack) } };
final.L["4h"] = final.L["2h"] = final.L["1h"] = final.L.ALL; final.S["4h"] = final.S["2h"] = final.S["1h"] = final.S.ALL;   /* 봉 간격별 차이가 입증되지 않아 전체 통계를 공통 사용 */
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "pattern_rank.json"), JSON.stringify(final, null, 1));
console.log(lines.join("\n"));
