/* 지표 계산 기본 함수. 모두 길이 n 의 일반 배열(결측 = NaN)을 돌려준다. */
export const NaNv = NaN;
export const isn = (v) => v === v && v != null;

export function sma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, c = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (isn(v)) { s += v; c++; }
    const o = i - n;
    if (o >= 0 && isn(a[o])) { s -= a[o]; c--; }
    if (i >= n - 1 && c === n) out[i] = s / n;
  }
  return out;
}
/* 지수이동평균: 첫 값을 시드로(카드·선구안과 같은 방식) */
export function ema(a, n) {
  const out = new Array(a.length).fill(NaN), k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!isn(v)) { out[i] = prev; continue; }
    prev = isn(prev) ? v * k + prev * (1 - k) : v;
    out[i] = prev;
  }
  return out;
}
/* 와일더 평활(RMA): 첫 n개 평균으로 시작 */
export function rma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, cnt = 0, prev = NaN;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!isn(v)) continue;
    if (!isn(prev)) { s += v; cnt++; if (cnt === n) { prev = s / n; out[i] = prev; } continue; }
    prev = (prev * (n - 1) + v) / n; out[i] = prev;
  }
  return out;
}
export function trueRange(cs) {
  return cs.map((c, i) => (i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close))));
}
export function atr(cs, n) { return rma(trueRange(cs), n); }
export function highest(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) { if (a[j] > m) m = a[j]; } out[i] = m; }
  return out;
}
export function lowest(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) { if (a[j] < m) m = a[j]; } out[i] = m; }
  return out;
}
export function stdev(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j];
    const m = s / n; let q = 0; for (let j = i - n + 1; j <= i; j++) q += (a[j] - m) ** 2;
    out[i] = Math.sqrt(q / n);
  }
  return out;
}
/* 최소제곱 직선의 끝점 값(트레이딩뷰 ta.linreg(src, n, 0)) */
export function linreg(a, n) {
  const out = new Array(a.length).fill(NaN);
  const sx = (n * (n - 1)) / 2, sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  for (let i = n - 1; i < a.length; i++) {
    let sy = 0, sxy = 0, ok = true;
    for (let j = 0; j < n; j++) { const v = a[i - n + 1 + j]; if (!isn(v)) { ok = false; break; } sy += v; sxy += j * v; }
    if (!ok) continue;
    const den = n * sxx - sx * sx, slope = (n * sxy - sx * sy) / den, icpt = (sy - slope * sx) / n;
    out[i] = icpt + slope * (n - 1);
  }
  return out;
}
/* RSI (와일더) */
export function rsi(close, n) {
  const up = new Array(close.length).fill(NaN), dn = new Array(close.length).fill(NaN);
  for (let i = 1; i < close.length; i++) { const d = close[i] - close[i - 1]; up[i] = d > 0 ? d : 0; dn[i] = d < 0 ? -d : 0; }
  const U = rma(up, n), D = rma(dn, n);
  return U.map((u, i) => (isn(u) && isn(D[i]) ? (D[i] === 0 ? 100 : 100 - 100 / (1 + u / D[i])) : NaN));
}
/* 윌리엄스 %R: −100 × (최고−종가)/(최고−최저) */
export function williamsR(cs, n) {
  const out = new Array(cs.length).fill(NaN);
  for (let i = n - 1; i < cs.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (cs[j].high > hh) hh = cs[j].high; if (cs[j].low < ll) ll = cs[j].low; }
    out[i] = hh > ll ? (-100 * (hh - cs[i].close)) / (hh - ll) : NaN;
  }
  return out;
}
/* 배열 → 시리즈 데이터. 결측은 빈 점 */
export function toPts(cs, arr, off) {
  const KST = 32400, o = off || 0;
  return cs.map((c, i) => (isn(arr[i]) ? { time: c.time + KST, value: arr[i] + o } : { time: c.time + KST }));
}
