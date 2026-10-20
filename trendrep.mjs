/* 5프레임 추세 정렬 리포트 — 계산부 (사진은 trendspec.mjs 가 그리고, 발송·주기는 trendjob.mjs 가 맡음)
   프레임: 일봉 · 4H · 2H · 1H · 30M. 프레임별 방향 = 트레이딩뷰 PivotScope.pine 과 같은 규칙의 '마지막 화살표'(큰 화살표 + 작은 예비 화살표,
   12봉 내 깨진 ✕ 가짜 제외). 저점 화살표 = 상승(▲) / 고점 화살표 = 하락(▼). 횡보 없음. 마감된 봉만 사용.
   추가 정보: 화살표 나이(봉·시간) · 방향 전환(마지막 화살표가 그 앞 화살표와 반대 = 추세가 바뀜) · 갱신 지연(stale) 표시 · 눌림/반등 단계 · 매크로 요약 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { hl, pool, coinLabel, pickRow } from "./extras.mjs";
import { FIXED_INDEX } from "./repnames.mjs";

const PV = createRequire(import.meta.url)("./pivotdetector.cjs");
export const TREND_TFS = [
  { k: "1d", ms: 864e5, n: 220, ko: "일" },
  { k: "4h", ms: 4 * 3600e3, n: 300, ko: "4H" },
  { k: "2h", ms: 2 * 3600e3, n: 360, ko: "2H" },
  { k: "1h", ms: 3600e3, n: 500, ko: "1H" },
  { k: "30m", ms: 1800e3, n: 600, ko: "30M" },
];
const MIN_BARS = 80;        /* 이보다 마감봉이 적으면 그 프레임은 '미정' */
const FRESH_BARS = 3;       /* 방향이 바뀐 화살표가 이 봉 수 이내면 '방금 전환' */
export const TREND_PRE = 0.5;   /* 예비(작은 속 빈) 화살표 표시 기준 — 트레이딩뷰 PivotScope.pine 의 gPre */

/* ── 캔들 저장본(.cache/trendbars.json): 마감봉만 쓰므로 '지금 봉 구간 안에서 한 번 받았으면' 다시 안 받음 ── */
function loadStore(file) { try { return { d: JSON.parse(fs.readFileSync(file, "utf8")), dirty: false }; } catch (e) { return { d: {}, dirty: false }; } }
function saveStore(file, st) { if (!st.dirty) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(st.d)); st.dirty = false; } catch (e) {} }
async function getBars(row, tf, st, log, canFetch) {
  const key = row.full + "|" + tf.k, e = st.d[key], t0 = Date.now(), cur = Math.floor(t0 / tf.ms) * tf.ms;
  if (e && e.at >= cur + 30000) return { rows: e.r, stale: false };   /* 봉이 막 마감한 뒤 30초는 거래소 집계가 끝나길 기다림 */
  if (!canFetch()) return { rows: e ? e.r : null, stale: true };
  const have = e && e.r.length >= tf.n * 0.8, from = have ? e.r[Math.max(0, e.r.length - 4)][0] : t0 - tf.n * tf.ms;
  const got = await hl({ type: "candleSnapshot", req: { coin: row.full, interval: tf.k, startTime: from, endTime: t0 } }, log);
  if (!got || !got.length) return { rows: e ? e.r : null, stale: true };
  const m = new Map((have ? e.r : []).map((x) => [x[0], x]));
  got.forEach((c) => m.set(c.t, [c.t, +c.o, +c.h, +c.l, +c.c, +c.v]));
  const rows = [...m.values()].sort((a, b) => a[0] - b[0]).slice(-tf.n);
  st.d[key] = { at: t0, r: rows }; st.dirty = true;
  return { rows, stale: false };
}

/* ── 프레임 하나의 방향 ──
   확률컷은 트레이딩뷰와 같게 1시간봉 이상 0.50/0.70/0.85, 30분 이하 0.55/0.75/0.90(자동), 예비 기준 0.5, 새 신호 간격 5봉(큰/예비는 간격 따로), 12봉 안에 다시 깨지면 ✕ 가짜.
   반환: d(+1 상승 / -1 하락 / 0 미정) · big(큰 화살표) · p · ago(피벗 후 마감봉 수) · ageMs(피벗봉이 끝난 뒤 흐른 시간) · flip(그 앞 화살표와 방향이 반대) · fresh(flip 이면서 ago ≤ 3) */
export function trendOf(rows, tf, now) {
  if (!rows) return { d: 0 };
  const closed = rows.filter((r) => r[0] + tf.ms <= now);
  if (closed.length < MIN_BARS) return { d: 0 };
  const cs = closed.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
  const htf = tf.ms >= 3600e3, t1 = htf ? 0.5 : 0.55, t2 = htf ? 0.7 : 0.75, t3 = htf ? 0.85 : 0.9;
  let pv; try { pv = PV.analyze(cs, { model: PV.models.small, t1, t2, t3, pre: TREND_PRE, cooldown: 5, invBars: 12 }); } catch (e) { return { d: 0 }; }
  const live = pv.signals.filter((g) => !g.dead).sort((a, b) => a.pi - b.pi || a.t - b.t);
  if (!live.length) return { d: 0 };
  const best = live[live.length - 1], before = live.length > 1 ? live[live.length - 2] : null;
  const ago = cs.length - 1 - best.pi, flip = !!before && before.side !== best.side;
  return { d: best.side === "bot" ? 1 : -1, big: best.p >= t2, p: best.p, ago, ageMs: Math.max(0, now - (cs[best.pi].time + tf.ms)), flip, fresh: flip && ago <= FRESH_BARS };
}

/* ── 서식 도우미 ── */
const fmt = (n) => Math.round(n).toLocaleString("en-US");
export const eokTxt = (e) => (e >= 10000 ? (e / 10000).toFixed(1) + "조" : fmt(e) + "억");
export const ageKo = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? Math.max(1, m) + "분" : m < 48 * 60 ? Math.round(m / 60) + "시간" : Math.round(m / 1440) + "일"; };
const mk = (d) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");
const secShort = (s) => String(s || "기타").replace(/\s*\(.*?\)/g, "").trim() || "기타";

/* 눌림/반등 단계(정밀): 큰 프레임(일·4H)이 한쪽으로 같고, 작은 프레임(1H·30M)이 반대로 눌려 있다가 복귀하는 순서
   0 = 눌림 중(1H·30M 모두 반대) · 1 = 30M 복귀(30M 이 방금 큰 방향으로 전환, 1H 는 아직 반대) · 2 = 1H 복귀(1H 도 방금 전환 → 진입 후보) */
export function pullbackOf(x) {
  const [dd, d4, , d1, d30] = x.fr;
  const dir = dd.d !== 0 && dd.d === d4.d ? dd.d : 0;
  if (!dir) return null;
  if (d1.d === -dir && d30.d === -dir) return { dir, stage: 0 };
  if (d30.d === dir && d30.fresh && d1.d === -dir) return { dir, stage: 1 };
  if (d1.d === dir && d1.fresh && d30.d === dir) return { dir, stage: 2 };
  return null;
}

/* ── 데이터 만들기 ── */
export async function buildTrendData({ uni, info, fx, log, cacheDir, topN, minEok, budgetMs, prev, onProgress }) {
  const now = Date.now(), T0 = now, file = path.join(cacheDir, "trendbars.json"), st = loadStore(file);
  const canFetch = () => Date.now() - T0 < (budgetMs || 240000);
  const seen = new Set(), pick = [];
  for (const r of uni) {
    if (seen.has(r.short)) continue; seen.add(r.short);
    if ((r.dayNtl * fx) / 1e8 < (minEok == null ? 10 : minEok)) continue;   /* 거래대금 너무 적은 종목은 정렬이 좋아도 뺌 */
    pick.push(r); if (pick.length >= (topN || 50)) break;
  }
  /* 지수·원자재 고정 13종(하이퍼 리포트의 지수·원자재 박스와 같은 목록)은 거래대금이 작아도 항상 계산 */
  const fixedRows = FIXED_INDEX.map((t) => pickRow(uni, t, info)).filter((r) => r && r.full && r.dex !== "코인");
  const topSet = new Set(pick.map((r) => r.full)), calc = pick.concat(fixedRows.filter((r) => !topSet.has(r.full)));
  let stale = 0, nofetch = 0, done = 0, staleFrames = 0;
  const all = [];
  await pool(calc, 3, async (r) => {
    const fr = [];
    for (let ti = 0; ti < TREND_TFS.length; ti++) {
      const tf = TREND_TFS[ti], b = await getBars(r, tf, st, log, canFetch);
      if (b.stale) staleFrames++;
      if (!b.rows) nofetch++;
      const t = trendOf(b.rows, tf, now); t.stale = !!b.stale;
      t.hot = !!t.fresh && (t.big || ti <= 2);   /* 의미 있는 전환 = 큰 화살표이거나 큰 프레임(일·4H·2H). 1H·30M 의 작은(예비) 전환은 너무 잦아서 제외 */
      fr.push(t);
    }
    const ups = fr.filter((x) => x.d > 0).length, downs = fr.filter((x) => x.d < 0).length;
    all.push({ r, fr, ups, downs, known: ups + downs, eok: (r.dayNtl * fx) / 1e8, inTop: topSet.has(r.full) });
    done++; if (onProgress) { try { onProgress({ done, total: calc.length, staleFrames }); } catch (e) {} }
  });
  stale = staleFrames;
  saveStore(file, st);
  const secOf = (r) => secShort(info.sectorOf[r.short] || info.sectorOf[Object.keys(info.alias).find((k) => info.alias[k] === r.short)] || "기타");
  all.forEach((x) => { x.sec = secOf(x.r); });
  const items = all.filter((x) => x.inTop);
  const fixedItems = fixedRows.map((r) => all.find((x) => x.r.full === r.full)).filter(Boolean);

  /* 티어: A = 한 프레임도 반대가 없음(미정 제외 4개 이상) / B = 딱 한 프레임만 반대 */
  const tierOf = (x) => {
    if (x.known < 4) return null;
    if (x.downs === 0) return { dir: 1, lvl: "A" };
    if (x.ups === 0) return { dir: -1, lvl: "A" };
    if (x.downs === 1 && x.ups >= 3) return { dir: 1, lvl: "B" };
    if (x.ups === 1 && x.downs >= 3) return { dir: -1, lvl: "B" };
    return null;
  };
  all.forEach((x) => { x.tier = tierOf(x); x.pb = pullbackOf(x); });
  const cnt = (dir, lvl) => items.filter((x) => x.tier && x.tier.dir === dir && x.tier.lvl === lvl).length;
  const short = items.filter((x) => x.known < 4).length, mixed = items.length - short - items.filter((x) => x.tier).length;

  /* 섹터 방향: 섹터 종목 중 70%↑가 같은 쪽(프레임 과반)이면 '합의' */
  const bySec = {};
  items.forEach((x) => { (bySec[x.sec] = bySec[x.sec] || []).push(x); });
  const secInfo = Object.entries(bySec).map(([name, arr]) => {
    const kn = arr.filter((x) => x.known >= 4), up = kn.filter((x) => x.ups > x.downs).length, dn = kn.length - up;
    const avg = kn.length ? kn.reduce((s, x) => s + x.ups, 0) / kn.length : 2.5, share = kn.length ? Math.max(up, dn) / kn.length : 0;
    return { name, n: arr.length, kn: kn.length, up, dn, avg, eok: arr.reduce((s, x) => s + x.eok, 0), cons: kn.length >= 2 && share >= 0.7 ? (up > dn ? 1 : -1) : 0, bias: avg - 2.5 };
  });

  /* 방금 전환한(hot) 프레임이 있는 종목(큰 프레임 우선) */
  const flips = all.filter((x) => x.fr.some((f) => f.hot)).map((x) => ({ x, w: x.fr.reduce((s, f, i) => s + (f.hot ? (5 - i) * (f.big ? 2 : 1) : 0), 0) }))
    .sort((a, b) => b.w - a.w || b.x.eok - a.x.eok).map((o) => o.x);

  /* 지난 리포트 대비: 강한 정렬(한쪽 4개↑)에 새로 들어옴 / 풀림 */
  const strong = (x) => (x.tier ? x.tier.dir : 0), state = {};
  items.forEach((x) => { state[x.r.short] = { s: strong(x), u: x.ups }; });
  const nw = [], lost = [], prevMap = prev || {};
  if (prev && Object.keys(prev).length) items.forEach((x) => { const p = prev[x.r.short], s = strong(x); if (!p) return; if (s !== 0 && p.s !== s) nw.push(x); else if (s === 0 && p.s !== 0) lost.push(x); });

  /* 눌림(롱 대기) · 반등(숏 대기): 단계 높은 순 → 거래대금 순 */
  const pbList = (dir) => all.filter((x) => x.pb && x.pb.dir === dir && (x.inTop || x.pb.stage >= 1)).sort((a, b) => b.pb.stage - a.pb.stage || b.eok - a.eok);
  return {
    items, fixedItems, secInfo, flips, nw, lost, prev: prevMap, state, pl: pbList(1), pb: pbList(-1),
    cnt: { aUp: cnt(1, "A"), bUp: cnt(1, "B"), bDn: cnt(-1, "B"), aDn: cnt(-1, "A"), mixed, short }, now, fx, stale,
    staleRatio: calc.length ? staleFrames / (calc.length * TREND_TFS.length) : 0, total: calc.length,
    stats: { n: all.length, stale, nofetch, ms: Date.now() - T0 },
  };
}

/* ── 글(사진을 못 그렸을 때의 대체) ── */
export function trendText(data, info) {
  const { items, secInfo, cnt, now, fx, stale } = data, L = [];
  const WDK = ["일", "월", "화", "수", "목", "금", "토"], p2 = (n) => String(n).padStart(2, "0"), d0 = new Date(now + 9 * 3600e3);
  L.push("🧭 5프레임 추세 정렬 · " + (d0.getUTCMonth() + 1) + "/" + d0.getUTCDate() + "(" + WDK[d0.getUTCDay()] + ") " + p2(d0.getUTCHours()) + ":" + p2(d0.getUTCMinutes()) + " KST");
  L.push("프레임 일·4H·2H·1H·30M  ▲=마지막 화살표가 저점(상승)  ▼=고점(하락)");
  L.push("📊 상위 " + items.length + "종목 — ▲전부 " + cnt.aUp + " · ▲4/5 " + cnt.bUp + " ┃ ▼4/5 " + cnt.bDn + " · ▼전부 " + cnt.aDn + " ┃ 혼조 " + cnt.mixed);
  const fl = (x) => x.fr.map((f) => mk(f.d)).join("");
  const blk = (dir, lvl, title) => {
    const arr = items.filter((x) => x.tier && x.tier.dir === dir && x.tier.lvl === lvl).sort((a, b) => b.eok - a.eok);
    if (!arr.length) return; L.push(""); L.push(title + " · " + arr.length + "종목");
    arr.slice(0, 12).forEach((x) => L.push("  " + fl(x) + " " + coinLabel(x.r, info) + " · " + x.sec + " · " + eokTxt(x.eok)));
  };
  blk(1, "A", "🔺 상승 전부 일치"); blk(1, "B", "🔺 상승 4/5"); blk(-1, "B", "🔽 하락 4/5"); blk(-1, "A", "🔽 하락 전부 일치");
  const up = secInfo.filter((s) => s.kn >= 2 && s.bias > 0.5).sort((a, b) => b.bias - a.bias).slice(0, 3), dn = secInfo.filter((s) => s.kn >= 2 && s.bias < -0.5).sort((a, b) => a.bias - b.bias).slice(0, 3);
  if (up.length || dn.length) { L.push(""); L.push("🧭 섹터 방향"); up.concat(dn).forEach((s) => L.push((s.bias > 0 ? "🔺 " : "🔽 ") + s.name + " · 평균 " + s.avg.toFixed(1) + "/5 · " + s.kn + "종목 · " + eokTxt(s.eok))); }
  L.push(""); L.push("※ 마감봉 기준 · 거래대금=24h 원화(환율 " + Math.round(fx) + ") · 방향 현황판" + (stale ? " · 일부 프레임 갱신 지연(" + stale + ")" : ""));
  return L.join("\n");
}
