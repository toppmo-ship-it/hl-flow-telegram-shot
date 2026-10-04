/* ═══════════════════════════════════════════════════════════════
   차트 패턴 인식 엔진 (카드 card.html · 실시간 chart.html 공용, Node 에서도 테스트 가능)
   · 쌍바닥/쌍천장 · 헤드앤숄더/역헤드앤숄더 · 컵위드핸들 · 상승/하락 깃발
   · 상승/하락/대칭 삼각형 · 박스권 · 상승/하락 쐐기 · 상승/하락 채널
   · 방식: ATR 지그재그(2단계 민감도) → 기하 규칙 → 상태(형성 중/확정/성공/실패) → 과거 통계
   · 성공 = 돌파 후 '목표(패턴 높이만큼)'의 60%에 도달, 실패 = 돌파 후 높이의 60% 되돌림(무효화)이 먼저 옴
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
"use strict";
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function atrArr(cs, p) {
  p = p || 14; const n = cs.length, out = new Array(n).fill(0); let a = 0;
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? cs[i].high - cs[i].low : Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - cs[i - 1].close), Math.abs(cs[i].low - cs[i - 1].close));
    a = i < p ? (a * i + tr) / (i + 1) : (a * (p - 1) + tr) / p; out[i] = a;
  }
  return out;
}

/* ATR 지그재그: 반대로 th 이상 움직여야 직전 고점/저점을 확정(c = 확정된 봉) */
function zigzag(cs, atr, k, minPct) {
  const piv = []; let trend = 0, hI = 0, hP = cs[0].high, lI = 0, lP = cs[0].low;
  for (let i = 1; i < cs.length; i++) {
    const th = Math.max(atr[i] * k, cs[i].close * minPct);
    if (trend === 0) {
      if (cs[i].high > hP) { hP = cs[i].high; hI = i; } if (cs[i].low < lP) { lP = cs[i].low; lI = i; }
      if (hP - lP >= th) { if (hI > lI) { piv.push({ i: lI, price: lP, type: "L", c: i }); trend = 1; hP = cs[i].high; hI = i; } else { piv.push({ i: hI, price: hP, type: "H", c: i }); trend = -1; lP = cs[i].low; lI = i; } }
    } else if (trend === 1) {
      if (cs[i].high > hP) { hP = cs[i].high; hI = i; }
      else if (hP - cs[i].low >= th) { piv.push({ i: hI, price: hP, type: "H", c: i }); trend = -1; lP = cs[i].low; lI = i; }
    } else {
      if (cs[i].low < lP) { lP = cs[i].low; lI = i; }
      else if (cs[i].high - lP >= th) { piv.push({ i: lI, price: lP, type: "L", c: i }); trend = 1; hP = cs[i].high; hI = i; }
    }
  }
  /* 아직 확정 전인 마지막 꼭짓점(진행 중 다리의 현재 극값)도 넣어서, 방금 만들어지는 패턴을 놓치지 않게 함 */
  if (trend === 1 && hI > (piv.length ? piv[piv.length - 1].i : -1)) piv.push({ i: hI, price: hP, type: "H", c: cs.length - 1, prov: true });
  else if (trend === -1 && lI > (piv.length ? piv[piv.length - 1].i : -1)) piv.push({ i: lI, price: lP, type: "L", c: cs.length - 1, prov: true });
  return piv;
}

function lsq(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; sxy += xs[k] * ys[k]; }
  const d = n * sxx - sx * sx; const m = d === 0 ? 0 : (n * sxy - sx * sy) / d, b = (sy - m * sx) / n;
  return { m, b };
}
function quadR2(xs, ys) {   /* 이차곡선 적합: 계수 a(>0 이면 U자)와 R² */
  const n = xs.length; if (n < 6) return { a: 0, r2: 0 };
  const x0 = xs[0], sc = xs[n - 1] - x0 || 1, X = xs.map((x) => (x - x0) / sc);
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let k = 0; k < n; k++) { const x = X[k], y = ys[k]; s1 += x; s2 += x * x; s3 += x * x * x; s4 += x * x * x * x; t0 += y; t1 += x * y; t2 += x * x * y; }
  const M = [[n, s1, s2, t0], [s1, s2, s3, t1], [s2, s3, s4, t2]];
  for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return { a: 0, r2: 0 };
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; } }
  const c0 = M[0][3] / M[0][0], c1 = M[1][3] / M[1][1], c2 = M[2][3] / M[2][2], my = t0 / n; let ssr = 0, sst = 0;
  for (let k = 0; k < n; k++) { const f = c0 + c1 * X[k] + c2 * X[k] * X[k]; ssr += (ys[k] - f) * (ys[k] - f); sst += (ys[k] - my) * (ys[k] - my); }
  return { a: c2, r2: sst > 0 ? 1 - ssr / sst : 0 };
}

/* 종류별 메타: 이름, 방향(+1 상승 신호 / -1 하락 신호 / 0 돌파 방향 따라), 가중치, 설명 */
const META = {
  doubleBottom: { name: "쌍바닥", dir: 1, w: 1.2, fam: "rev" },
  doubleTop: { name: "쌍천장", dir: -1, w: 1.2, fam: "rev" },
  headShoulders: { name: "헤드앤숄더", dir: -1, w: 1.35, fam: "rev" },
  invHeadShoulders: { name: "역헤드앤숄더", dir: 1, w: 1.35, fam: "rev" },
  cupHandle: { name: "컵위드핸들", dir: 1, w: 1.25, fam: "rev" },
  bullFlag: { name: "상승깃발", dir: 1, w: 1.1, fam: "cont" },
  bearFlag: { name: "하락깃발", dir: -1, w: 1.1, fam: "cont" },
  ascTriangle: { name: "상승삼각형", dir: 1, w: 1.0, fam: "tri" },
  descTriangle: { name: "하락삼각형", dir: -1, w: 1.0, fam: "tri" },
  symTriangle: { name: "대칭삼각형", dir: 0, w: 1.0, fam: "tri" },
  box: { name: "박스권", dir: 0, w: 0.9, fam: "tri" },
  risingWedge: { name: "상승쐐기", dir: -1, w: 1.0, fam: "tri" },
  fallingWedge: { name: "하락쐐기", dir: 1, w: 1.0, fam: "tri" },
  upChannel: { name: "상승채널", dir: 0, w: 0.6, fam: "tri", info: true },
  downChannel: { name: "하락채널", dir: 0, w: 0.6, fam: "tri", info: true },
};
const DESC = {
  doubleBottom: { forming: "저점을 두 번 지지 · 넥라인을 넘으면 상승 전환", confirmed: "넥라인 돌파 확정 · 상승 목표 진행", success: "넥라인 돌파 뒤 목표 도달", fail: "돌파 뒤 다시 밀려 무효" },
  doubleTop: { forming: "고점을 두 번 막힘 · 넥라인을 깨면 하락 전환", confirmed: "넥라인 이탈 확정 · 하락 목표 진행", success: "넥라인 이탈 뒤 목표 도달", fail: "이탈 뒤 다시 올라 무효" },
  headShoulders: { forming: "머리가 가장 높은 3봉우리 · 넥라인 이탈 시 하락", confirmed: "넥라인 이탈 확정 · 하락 목표 진행", success: "넥라인 이탈 뒤 목표 도달", fail: "이탈 뒤 되돌려 무효" },
  invHeadShoulders: { forming: "머리가 가장 낮은 3저점 · 넥라인 돌파 시 상승", confirmed: "넥라인 돌파 확정 · 상승 목표 진행", success: "넥라인 돌파 뒤 목표 도달", fail: "돌파 뒤 밀려 무효" },
  cupHandle: { forming: "둥근 컵 뒤 얕은 눌림(손잡이) · 고점 돌파 시 상승", confirmed: "손잡이 고점 돌파 확정 · 상승 목표 진행", success: "돌파 뒤 목표 도달", fail: "돌파 뒤 밀려 무효" },
  bullFlag: { forming: "급등 뒤 좁은 눌림(깃발) · 상단 돌파 시 상승 재개", confirmed: "깃발 상단 돌파 확정 · 깃대만큼 목표", success: "돌파 뒤 목표 도달", fail: "돌파 뒤 밀려 무효" },
  bearFlag: { forming: "급락 뒤 좁은 반등(깃발) · 하단 이탈 시 하락 재개", confirmed: "깃발 하단 이탈 확정 · 깃대만큼 목표", success: "이탈 뒤 목표 도달", fail: "이탈 뒤 되돌려 무효" },
  ascTriangle: { forming: "저항 수평 · 저점 상승 · 돌파 시 상승 신호", confirmed: "상단 돌파 확정", success: "돌파 뒤 목표 도달", fail: "돌파 뒤 밀려 무효" },
  descTriangle: { forming: "지지 수평 · 고점 하락 · 이탈 시 하락 신호", confirmed: "하단 이탈 확정", success: "이탈 뒤 목표 도달", fail: "이탈 뒤 되돌려 무효" },
  symTriangle: { forming: "고점은 낮아지고 저점은 높아지며 수렴 · 돌파 방향 따라감", confirmed: "수렴 끝 이탈 확정", success: "돌파 뒤 목표 도달", fail: "돌파 뒤 되돌려 무효" },
  box: { forming: "고점·저점이 수평으로 반복 · 박스를 벗어나는 쪽으로 이동", confirmed: "박스 이탈 확정", success: "이탈 뒤 목표 도달", fail: "이탈 뒤 되돌려 무효" },
  risingWedge: { forming: "상승폭이 줄며 좁아지는 쐐기 · 하단 이탈 시 하락 신호", confirmed: "하단 이탈 확정", success: "이탈 뒤 목표 도달", fail: "이탈 뒤 되돌려 무효" },
  fallingWedge: { forming: "하락폭이 줄며 좁아지는 쐐기 · 상단 돌파 시 상승 신호", confirmed: "상단 돌파 확정", success: "돌파 뒤 목표 도달", fail: "돌파 뒤 밀려 무효" },
  upChannel: { forming: "평행하게 오르는 추세 채널 · 하단 지지 매수 / 상단 저항 주의" },
  downChannel: { forming: "평행하게 내리는 추세 채널 · 상단 저항 / 하단 이탈 주의" },
};

/* 돌파 확인 → 결과 판정. level: 돌파 기준선(함수 or 숫자), dirHint: +1/-1/0(양방향) */
function resolve(cs, atr, pat, lines) {
  const n = cs.length, end = pat.end, H = pat.height, width = Math.max(10, pat.end - pat.start);
  const W = Math.max(12, Math.min(60, Math.round(width * 0.8)));
  const U = lines.up, L = lines.lo;   /* 돌파 기준선 (i → 가격) */
  let confirmI = -1, dir = 0;
  for (let j = end + 1; j < n && j <= end + W; j++) {
    const a = atr[j] * 0.1;
    const upB = U && cs[j].close > U(j) + a, loB = L && cs[j].close < L(j) - a;
    if (upB && (pat.dir >= 0)) { confirmI = j; dir = 1; break; }
    if (loB && (pat.dir <= 0)) { confirmI = j; dir = -1; break; }
    if (pat.dir > 0 && loB) { pat.state = "expired"; return pat; }   /* 기대 반대로 먼저 깨짐: 무산 */
    if (pat.dir < 0 && upB) { pat.state = "expired"; return pat; }
  }
  if (confirmI < 0) { pat.state = end + W >= n - 1 ? "forming" : "expired"; return pat; }
  pat.confirmI = confirmI; pat.dirReal = dir;
  const entry = cs[confirmI].close, tgt = entry + dir * H * 0.6, stop = entry - dir * H * 0.6;
  pat.entry = entry; pat.target = entry + dir * H; pat.targetPct = dir * H / entry * 100;
  const hz = Math.min(n - 1, confirmI + Math.max(30, Math.min(150, width * 2)));
  let res = null;
  for (let j = confirmI + 1; j <= hz; j++) {
    if (dir > 0 ? cs[j].high >= tgt : cs[j].low <= tgt) { res = "success"; pat.resI = j; break; }
    if (dir > 0 ? cs[j].close <= stop : cs[j].close >= stop) { res = "fail"; pat.resI = j; break; }
  }
  if (res) pat.state = res; else pat.state = hz >= n - 1 ? "confirmed" : "flat";   /* flat: 기간 내 어느 쪽도 아님(통계 제외) */
  return pat;
}

function detect(cs, opt) {
  opt = opt || {}; const n = cs.length;
  if (n < 60) return { pats: [], stats: {}, span: 0 };
  const atr = atrArr(cs, 14), all = [];
  const tolP = (i) => Math.max(0.0035, atr[i] / cs[i].close * 0.9);
  const push = (type, o) => { o.type = type; const m = META[type]; o.name = m.name; o.dir = o.dirOverride != null ? o.dirOverride : m.dir; o.w = m.w; all.push(o); };

  for (const [k, minPct] of [[2.3, 0.004], [4.2, 0.008]]) {
    const P = zigzag(cs, atr, k, minPct), np = P.length;
    /* ── 쌍바닥 / 쌍천장 ── */
    for (let t = 0; t + 2 < np; t++) {
      const a = P[t], b = P[t + 1], c = P[t + 2], A = atr[c.c];
      if (a.type === "L") {   /* L H L */
        const lo = Math.min(a.price, c.price), diff = Math.abs(a.price - c.price) / lo;
        if (diff <= Math.max(0.03, A * 0.9 / lo) && b.price - lo >= Math.max(2.5 * A, lo * 0.03) && c.i - a.i >= 8 && c.i - a.i <= 220 && (c.i - b.i) >= 3 && (b.i - a.i) >= 3) {
          const h = b.price - (a.price + c.price) / 2;
          push("doubleBottom", { start: a.i, end: c.c, pts: [[a.i, a.price], [b.i, b.price], [c.i, c.price]], neck: [[a.i, b.price], [c.c, b.price]], height: h, q: 1 - diff / 0.04, _lines: { up: () => b.price, lo: null } });
        }
      } else {
        const hi = Math.max(a.price, c.price), diff = Math.abs(a.price - c.price) / hi;
        if (diff <= Math.max(0.03, A * 0.9 / hi) && hi - b.price >= Math.max(2.5 * A, hi * 0.03) && c.i - a.i >= 8 && c.i - a.i <= 220 && (c.i - b.i) >= 3 && (b.i - a.i) >= 3) {
          const h = (a.price + c.price) / 2 - b.price;
          push("doubleTop", { start: a.i, end: c.c, pts: [[a.i, a.price], [b.i, b.price], [c.i, c.price]], neck: [[a.i, b.price], [c.c, b.price]], height: h, q: 1 - diff / 0.04, _lines: { up: null, lo: () => b.price } });
        }
      }
    }
    /* ── 헤드앤숄더 / 역 ── */
    for (let t = 0; t + 4 < np; t++) {
      const [ls, n1, hd, n2, rs] = [P[t], P[t + 1], P[t + 2], P[t + 3], P[t + 4]], A = atr[rs.c];
      const nl = (j) => n1.price + (n2.price - n1.price) * (j - n1.i) / Math.max(1, n2.i - n1.i);
      const symm = (hd.i - ls.i) / Math.max(1, rs.i - hd.i);
      if (ls.type === "H") {
        const sh = (ls.price + rs.price) / 2;
        if (hd.price > ls.price * 1.012 && hd.price > rs.price * 1.012 && Math.abs(ls.price - rs.price) / sh <= 0.06 && Math.abs(n1.price - n2.price) / sh <= 0.06 && hd.price - nl(hd.i) >= Math.max(3 * A, hd.price * 0.025) && symm > 0.4 && symm < 2.5 && rs.i - ls.i <= 300) {
          push("headShoulders", { start: ls.i, end: rs.c, pts: [[ls.i, ls.price], [n1.i, n1.price], [hd.i, hd.price], [n2.i, n2.price], [rs.i, rs.price]], neck: [[n1.i, n1.price], [rs.c, nl(rs.c)]], height: hd.price - nl(hd.i), q: 1, _lines: { up: null, lo: nl } });
        }
      } else {
        const sh = (ls.price + rs.price) / 2;
        if (hd.price < ls.price * 0.988 && hd.price < rs.price * 0.988 && Math.abs(ls.price - rs.price) / sh <= 0.06 && Math.abs(n1.price - n2.price) / sh <= 0.06 && nl(hd.i) - hd.price >= Math.max(3 * A, hd.price * 0.025) && symm > 0.4 && symm < 2.5 && rs.i - ls.i <= 300) {
          push("invHeadShoulders", { start: ls.i, end: rs.c, pts: [[ls.i, ls.price], [n1.i, n1.price], [hd.i, hd.price], [n2.i, n2.price], [rs.i, rs.price]], neck: [[n1.i, n1.price], [rs.c, nl(rs.c)]], height: nl(hd.i) - hd.price, q: 1, _lines: { up: nl, lo: null } });
        }
      }
    }
    /* ── 컵위드핸들 (H L H L) ── */
    for (let t = 0; t + 3 < np; t++) {
      const [r1, bt, r2, hl] = [P[t], P[t + 1], P[t + 2], P[t + 3]];
      if (r1.type !== "H" || r2.type !== "H") continue;
      const rim = Math.max(r1.price, r2.price), depth = rim - bt.price, A = atr[hl.c], w = r2.i - r1.i;
      if (w < 20 || w > 400 || Math.abs(r1.price - r2.price) / rim > 0.04 || depth < Math.max(4 * A, rim * 0.03) || depth > rim * 0.6) continue;
      const pos = (bt.i - r1.i) / w; if (pos < 0.25 || pos > 0.75) continue;
      const xs = [], ys = []; for (let j = r1.i; j <= r2.i; j++) { xs.push(j); ys.push(cs[j].close); }
      const q = quadR2(xs, ys); if (q.a <= 0 || q.r2 < 0.55) continue;
      const pull = r2.price - hl.price; if (pull < 0.08 * depth || pull > 0.5 * depth || hl.price < bt.price + 0.5 * depth || hl.i - r2.i > w * 0.5 || hl.i - r2.i < 3) continue;
      push("cupHandle", { start: r1.i, end: hl.c, pts: [[r1.i, r1.price], [bt.i, bt.price], [r2.i, r2.price], [hl.i, hl.price]], neck: [[r1.i, rim], [hl.c, rim]], height: depth, q: q.r2, cup: [r1.i, r2.i], _lines: { up: () => rim, lo: null } });
    }
    /* ── 깃발 (급등·급락 뒤 좁은 되돌림) ── */
    for (let t = 0; t + 1 < np; t++) {
      const p0 = P[t], p1 = P[t + 1], A = atr[p1.c], pole = Math.abs(p1.price - p0.price), bars = p1.i - p0.i;
      if (bars > 28 || bars < 3 || pole < Math.max(6 * A, p1.price * 0.04)) continue;
      const bull = p1.type === "H";
      let e = Math.min(n - 1, p1.i + 32), cut = e;
      for (let j = p1.i + 1; j <= e; j++) { if (bull ? cs[j].low < p0.price + 0.5 * pole : cs[j].high > p0.price - 0.5 * pole) { cut = j - 1; break; } if (bull ? cs[j].close > p1.price : cs[j].close < p1.price) { cut = j - 1; break; } cut = j; }
      const dur = cut - p1.i; if (dur < 5) continue;
      const xs = [], hs = [], ls = []; let fh = -Infinity, fl = Infinity;
      for (let j = p1.i + 1; j <= cut; j++) { xs.push(j); hs.push(cs[j].high); ls.push(cs[j].low); fh = Math.max(fh, cs[j].high); fl = Math.min(fl, cs[j].low); }
      if (fh - fl > 0.55 * pole) continue;
      const fu = lsq(xs, hs), fL = lsq(xs, ls), mid = ((fu.m + fL.m) / 2) * dur;
      if (bull ? mid > 0.12 * pole : mid < -0.12 * pole) continue;
      const up = (j) => fu.m * j + fu.b + (fh - (fu.m * xs[hs.indexOf(Math.max(...hs))] + fu.b)) * 0, lo = (j) => fL.m * j + fL.b;
      const up2 = (j) => fu.m * j + fu.b, lo2 = (j) => fL.m * j + fL.b;
      /* 상·하단선은 가장 바깥 꼬리를 감싸도록 평행 이동 */
      let su = 0, sl = 0; xs.forEach((x, k) => { su = Math.max(su, hs[k] - up2(x)); sl = Math.max(sl, lo2(x) - ls[k]); });
      const U = (j) => up2(j) + su, Lw = (j) => lo2(j) - sl; void up; void lo;
      push(bull ? "bullFlag" : "bearFlag", { start: p0.i, end: cut, pts: [[p0.i, p0.price], [p1.i, p1.price]], lines: [[[p1.i, U(p1.i)], [cut, U(cut)]], [[p1.i, Lw(p1.i)], [cut, Lw(cut)]]], pole: [[p0.i, p0.price], [p1.i, p1.price]], height: pole, q: 1, _lines: bull ? { up: U, lo: null } : { up: null, lo: Lw }, flagStart: p1.i });
    }
    /* ── 삼각형·박스·쐐기·채널 (추세선 두 개) ── */
    for (let s = 0; s + 4 < np; s++) for (let e = s + 4; e < Math.min(np, s + 10); e++) {
      const seg = P.slice(s, e + 1), Hs = seg.filter((p) => p.type === "H"), Ls = seg.filter((p) => p.type === "L");
      if (Hs.length < 2 || Ls.length < 2 || Hs.length + Ls.length < 5) continue;
      const i0 = seg[0].i, i1 = seg[seg.length - 1].i, width = i1 - i0; if (width < 15 || width > 260) continue;
      const A = mean(atr.slice(i0, i1 + 1));
      const fu = lsq(Hs.map((p) => p.i), Hs.map((p) => p.price)), fL = lsq(Ls.map((p) => p.i), Ls.map((p) => p.price));
      const resU = Math.max(...Hs.map((p) => Math.abs(p.price - (fu.m * p.i + fu.b)))), resL = Math.max(...Ls.map((p) => Math.abs(p.price - (fL.m * p.i + fL.b))));
      if (resU > 0.8 * A || resL > 0.8 * A) continue;
      const U = (j) => fu.m * j + fu.b, Lw = (j) => fL.m * j + fL.b, h0 = U(i0) - Lw(i0), h1 = U(i1) - Lw(i1);
      if (h0 <= 0 || h1 <= 0 || h0 < 2.5 * A) continue;
      /* 종가가 선 바깥으로 자주 나가면 제외 */
      let out = 0; for (let j = i0; j <= i1; j++) if (cs[j].close > U(j) + 0.5 * A || cs[j].close < Lw(j) - 0.5 * A) out++; if (out > (width + 1) * 0.06) continue;
      const dU = U(i1) - U(i0), dL = Lw(i1) - Lw(i0), ft = 0.18 * h0, conv = h1 <= 0.7 * h0, par = h1 / h0 >= 0.8 && h1 / h0 <= 1.25;
      let type = null;
      if (Math.abs(dU) <= ft && Math.abs(dL) <= ft && par) type = "box";
      else if (Math.abs(dU) <= ft && dL > ft && conv) type = "ascTriangle";
      else if (Math.abs(dL) <= ft && dU < -ft && conv) type = "descTriangle";
      else if (dU < -ft && dL > ft && conv) type = "symTriangle";
      else if (dU > ft && dL > ft && conv && dL > dU) type = "risingWedge";
      else if (dU < -ft && dL < -ft && conv && dU < dL) type = "fallingWedge";
      else if (dU > ft && dL > ft && par) type = "upChannel";
      else if (dU < -ft && dL < -ft && par) type = "downChannel";
      if (!type) continue;
      push(type, { start: i0, end: i1, pts: seg.map((p) => [p.i, p.price]), lines: [[[i0, U(i0)], [i1, U(i1)]], [[i0, Lw(i0)], [i1, Lw(i1)]]], height: h0, q: Math.min(1.5, (Hs.length + Ls.length) / 5) * (1 - Math.max(resU, resL) / (0.8 * A) * 0.4), _lines: { up: U, lo: Lw }, ext: true });
    }
  }

  /* 손절 기준선(진행 중인 패턴용) */
  all.forEach((p) => {
    const q = p.pts;
    if (p.type === "doubleBottom") p.stop = Math.min(q[0][1], q[2][1]);
    else if (p.type === "doubleTop") p.stop = Math.max(q[0][1], q[2][1]);
    else if (p.type === "invHeadShoulders") p.stop = q[2][1];
    else if (p.type === "headShoulders") p.stop = q[2][1];
    else if (p.type === "cupHandle") p.stop = q[3][1];
  });
  /* 상태 판정 */
  all.forEach((p) => {
    if (META[p.type].info) { p.state = p.end >= n - 1 - Math.max(8, (p.end - p.start) * 0.4) ? "forming" : "expired"; return; }
    resolve(cs, atr, p, p._lines);
    if (p.state === "confirmed" || p.state === "success" || p.state === "fail" || p.state === "flat") {
      p.dirFinal = p.dirReal;
    }
  });
  let pats = all.filter((p) => p.state && p.state !== "expired");
  /* 겹치는 패턴 정리: 같은 시간대에서 점수 높은 것만 */
  pats.forEach((p) => { p.score = p.w * (0.6 + 0.6 * Math.max(0, Math.min(1.2, p.q || 1))) + (p.state === "success" || p.state === "fail" || p.state === "confirmed" ? 0.25 : 0) + (p.state === "forming" && p.end >= n - 60 ? 0.6 : 0) + (p.end - p.start) / 4000; });
  pats.sort((a, b) => b.score - a.score);
  const keep = [];
  pats.forEach((p) => {
    const sp = Math.max(1, p.confirmI > 0 ? p.confirmI - p.start : p.end - p.start);
    const bad = keep.some((q) => { const ov = Math.min(p.end, q.end) - Math.max(p.start, q.start); if (ov <= 0) return false; const shorter = Math.min(p.end - p.start, q.end - q.start) || 1; return (p.type === q.type ? ov / shorter > 0.3 : ov / shorter > 0.4); });
    void sp; if (!bad) keep.push(p);
  });
  pats = keep.sort((a, b) => a.start - b.start);
  /* 통계: 확정된 것 중 성공/실패 */
  const stats = {};
  pats.forEach((p) => { if (p.state === "success" || p.state === "fail") { const s = stats[p.type] || (stats[p.type] = { name: p.name, s: 0, f: 0 }); if (p.state === "success") s.s++; else s.f++; } });
  const span = (cs[n - 1].time - cs[0].time) / 86400;
  return { pats, stats, span: Math.round(span) };
}

const api = { detect, zigzag, atrArr, META, DESC };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Patterns = api;
})(typeof window !== "undefined" ? window : globalThis);
