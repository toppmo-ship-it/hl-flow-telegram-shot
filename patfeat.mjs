/* 패턴 이벤트 특징 계산 — 연구(research/backtest.mjs)와 실시간 스캔(extras.mjs)이 똑같이 쓰는 단일 정의
   · 미래 정보 금지: 모든 값은 '그 패턴이 확정(또는 현재)된 봉'까지의 데이터로만 계산
   · 롱(상승 신호)은 '지지', 숏(하락 신호)은 '저항' 기준으로 대칭 계산 */

export const DAY = 86400;
const isWk = (t) => { const g = new Date(t * 1000).getUTCDay(); return g === 0 || g === 6; };
export const isWeekend = isWk;

/* 지지·저항대: 피벗(좌우 5봉) 고·저점을 0.7% 안에서 묶고 터치 2회 이상인 가격대. 패턴 시작 전(미래 제외) 최근 ~400봉만 사용 */
export function priorLevels(cs, endIdx, look) {
  const k = 5, lo = Math.max(k, endIdx - (look || 400)), hi = endIdx - k, piv = [];
  for (let i = lo; i < hi; i++) {
    let h = true, l = true;
    for (let j = 1; j <= k; j++) { if (cs[i].high <= cs[i - j].high || cs[i].high < cs[i + j].high) h = false; if (cs[i].low >= cs[i - j].low || cs[i].low > cs[i + j].low) l = false; }
    if (h) piv.push(cs[i].high); if (l) piv.push(cs[i].low);
  }
  const cl = [];
  piv.sort((a, b) => a - b).forEach((p) => { const c = cl.find((x) => Math.abs(x.p - p) / x.p < 0.007); if (c) { c.p = (c.p * c.n + p) / (c.n + 1); c.n++; } else cl.push({ p, n: 1 }); });
  return cl.filter((c) => c.n >= 2);
}

/* 거래량 급증: 확정 봉 거래대금 ÷ 직전 20봉 평균(같은 종류 봉끼리 — 평일 봉은 평일 봉끼리, 주말 봉은 주말 봉끼리) */
export function volBurst(cs, j) {
  const wk = isWk(cs[j].time), pool = [];
  for (let i = j - 1; i >= 0 && pool.length < 20 && j - i < 400; i--) if (isWk(cs[i].time) === wk) pool.push(cs[i].volume);
  if (pool.length < 10) return null;
  const avg = pool.reduce((s, x) => s + x, 0) / pool.length;
  return avg > 0 ? cs[j].volume / avg : null;
}

/* 패턴 하나의 지지·저항 중복도.
   dir>0(롱): 패턴 구간의 최저점(방어선)  /  dir<0(숏): 최고점(방어선)
   · srN   : 그 가격 ±tol 안에 있는 '과거 지지·저항대'의 터치 합(2 이상이면 중복 지지)
   · vwapC : 방어선이 앵커드 VWAP ±tol 안이고, 그 봉 종가가 VWAP 방향(롱=위, 숏=아래)을 지켰는가
   · keltC : 방어선이 일봉 켈트너 중심선/하단선(롱) 또는 중심선/상단선(숏) ±tol 안인가
   · conf  : srC + vwapC + keltC (0~3) */
export function confluence(cs, p, dir, pq, zoner, tolPct) {
  const tol = (tolPct || 0.5) / 100, a = Math.max(0, p.start), b = Math.min(cs.length - 1, p.end);
  let ki = a;
  for (let i = a; i <= b; i++) { if (dir > 0 ? cs[i].low < cs[ki].low : cs[i].high > cs[ki].high) ki = i; }
  const K = dir > 0 ? cs[ki].low : cs[ki].high;
  const lv = priorLevels(cs, Math.max(12, a), 400).filter((c) => Math.abs(c.p / K - 1) <= tol);
  const srN = lv.reduce((s, c) => s + c.n, 0), srC = lv.length > 0;
  let vwapC = false, vgap = null;
  const f = pq && pq.at(ki);
  if (f && f.avwap) { vgap = (K / f.avwap - 1) * 100; vwapC = Math.abs(K / f.avwap - 1) <= tol && (dir > 0 ? cs[ki].close >= f.avwap : cs[ki].close <= f.avwap); }
  let keltC = false, keltAt = null;
  const z = zoner ? zoner(cs[ki].time, K) : null;
  if (z) {
    const cands = dir > 0 ? [["중심선", z.mid], ["하단선", z.lo]] : [["중심선", z.mid], ["상단선", z.up]];
    const hit = cands.find(([, v]) => v && Math.abs(K / v - 1) <= tol * 1.2);
    if (hit) { keltC = true; keltAt = hit[0]; }
  }
  return { ki, K, srN, srC, vwapC, vgap, keltC, keltAt, conf: (srC ? 1 : 0) + (vwapC ? 1 : 0) + (keltC ? 1 : 0) };
}

/* 이벤트 하나의 판정용 요약 — 연구 이벤트와 실시간 스캔이 같은 필드를 씀 */
export function sessOf(t) { const h = new Date(t * 1000).getUTCHours(); return h >= 13 && h <= 20 ? "US" : "OFF"; }
