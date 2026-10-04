/* 연구 4단계(보조): 로지스틱 회귀로 '돌파 시점 특징 → 성공 확률' 모델이 시간 분할 검증에서 의미 있는지 확인
   · 롱/숏 따로, 앞 60%로 학습 → 뒤 40%에서 AUC·구간별 실제 성공률(교정) 확인 · L2 정규화로 과적합 억제 */
import fs from "node:fs";
import path from "node:path";
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), OUT = path.join(ROOT, "out");
const ev = JSON.parse(fs.readFileSync(path.join(OUT, "events.json"), "utf8")).filter((e) => e.state === "success" || e.state === "fail");
const types = [...new Set(ev.map((e) => e.type))].sort();
const times = ev.map((e) => e.t).sort((a, b) => a - b), cut = times[Math.floor(times.length * 0.6)];
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
function feats(e) {
  const f = {};
  ["A", "B", "C"].forEach((z) => { f["z" + z] = e.zone === z ? 1 : 0; });
  f.zpos = clip(e.zpos, -3, 3);
  ["vol", "rsi", "macd", "w14", "w48", "vwap"].forEach((k) => { f["p_" + k] = e.pts[k] ? 1 : 0; });
  f.rsi = (e.rsi == null ? 50 : e.rsi) / 100; f.avGap = clip(e.avGap == null ? 0 : e.avGap, -8, 8) / 8;
  f.hPct = clip(e.hPct, 0, 15) / 15; f.width = Math.log(1 + (e.width || 0)) / 6;
  f.tf2 = e.iv === "2h" ? 1 : 0; f.tf4 = e.iv === "4h" ? 1 : 0;
  types.forEach((t) => { f["t_" + t] = e.type === t ? 1 : 0; });
  return f;
}
const names = Object.keys(feats(ev[0]));
const sig = (z) => 1 / (1 + Math.exp(-z));
function fit(rows, y, lam, iters) {
  const d = names.length, w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    rows.forEach((x, i) => { let z = b; for (let k = 0; k < d; k++) z += w[k] * x[k]; const err = sig(z) - y[i]; for (let k = 0; k < d; k++) gw[k] += err * x[k]; gb += err; });
    const lr = 0.5; for (let k = 0; k < d; k++) w[k] -= lr * (gw[k] / rows.length + lam * w[k]); b -= lr * gb / rows.length;
  }
  return { w, b };
}
const pred = (m, x) => { let z = m.b; for (let k = 0; k < x.length; k++) z += m.w[k] * x[k]; return sig(z); };
function auc(p, y) { const idx = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]); let rs = 0, n1 = 0, n0 = 0; idx.forEach(([, yy], i) => { if (yy) { rs += i + 1; n1++; } else n0++; }); return n1 && n0 ? (rs - n1 * (n1 + 1) / 2) / (n1 * n0) : 0.5; }
const out = [];
for (const [side, dir] of [["롱", 1], ["숏", -1]]) {
  const a = ev.filter((e) => e.dir === dir), tr = a.filter((e) => e.t <= cut), te = a.filter((e) => e.t > cut);
  const X = (arr) => arr.map((e) => names.map((n) => feats(e)[n])), y = (arr) => arr.map((e) => (e.state === "success" ? 1 : 0));
  const m = fit(X(tr), y(tr), 0.02, 600), ptr = X(tr).map((x) => pred(m, x)), pte = X(te).map((x) => pred(m, x));
  const base = te.filter((e) => e.state === "success").length / te.length;
  /* 예측 확률 상위/하위 3분위의 실제 성공률 (뒤 40% 구간) */
  const order = pte.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), tercile = (s, e2) => { const idx = order.slice(Math.floor(order.length * s), Math.floor(order.length * e2)).map((o) => o[1]); const w = idx.filter((i) => te[i].state === "success").length; return { n: idx.length, win: w / idx.length }; };
  const lo = tercile(0, 1 / 3), mid = tercile(1 / 3, 2 / 3), hi = tercile(2 / 3, 1);
  const top = names.map((n, k) => [n, m.w[k]]).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 6).map(([n, v]) => n + (v >= 0 ? " +" : " ") + v.toFixed(2)).join(", ");
  out.push("**" + side + "**: 학습 " + tr.length + "건 / 검증 " + te.length + "건 · 검증 AUC " + auc(pte, y(te)).toFixed(3) + " (학습 " + auc(ptr, y(tr)).toFixed(3) + ") · 검증 기준선 " + (base * 100).toFixed(1) + "%\n  - 예측 하위 1/3 → 실제 " + (lo.win * 100).toFixed(1) + "% (n=" + lo.n + "), 중간 → " + (mid.win * 100).toFixed(1) + "%, 상위 1/3 → " + (hi.win * 100).toFixed(1) + "% (n=" + hi.n + ")\n  - 영향 큰 변수: " + top);
}
const txt = "## 10. 확률 모델 실험 (로지스틱 회귀, 앞 60% 학습 → 뒤 40% 검증)\n\n" + out.join("\n\n") + "\n\n- AUC 0.5 = 무작위, 0.55 이상이면 약한 예측력, 0.6 이상이면 의미 있는 수준입니다.\n";
fs.writeFileSync(path.join(OUT, "model.md"), txt);
console.log(txt);
