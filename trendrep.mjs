/* 5프레임 추세 정렬 리포트 (임시 형식 — 사용자가 보고 다듬는 중)
   프레임: 일봉 · 4H · 2H · 1H · 30M. 프레임별 방향 = PivotScope(작은 피벗, 확정 0.7↑, 12봉 내 깨진 가짜 제외)의 '마지막 확정 신호'
   저점 신호 = 상승(▲) / 고점 신호 = 하락(▼). 횡보 없음. 마감된 봉만 사용 → 새 봉이 마감될 때만 방향이 바뀜(그래서 캐시가 잘 먹음).
   구성: 시장 요약 → 섹터 방향 → 상승 정렬 티어(5/5, 4/5) → 하락 정렬 티어(4/5, 5/5) → 눌림·반등 → 지난 리포트 대비.
   각 티어 안은 섹터별로 묶고, 섹터 안은 24h 거래대금(원화) 순. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { hl, pool, coinLabel } from "./extras.mjs";

const PV = createRequire(import.meta.url)("./pivotdetector.cjs");
const KST_MS = 9 * 3600e3, WDK = ["일", "월", "화", "수", "목", "금", "토"], p2 = (n) => String(n).padStart(2, "0");
export const TREND_TFS = [
  { k: "1d", ms: 864e5, n: 220, ko: "일" },
  { k: "4h", ms: 4 * 3600e3, n: 300, ko: "4H" },
  { k: "2h", ms: 2 * 3600e3, n: 360, ko: "2H" },
  { k: "1h", ms: 3600e3, n: 500, ko: "1H" },
  { k: "30m", ms: 1800e3, n: 600, ko: "30M" },
];
const MIN_BARS = 80;   /* 이보다 마감봉이 적으면 그 프레임은 '미정' */

/* ── 캔들 저장본(.cache/trendbars.json): 마감봉만 쓰므로 '지금 봉 구간 안에서 한 번 받았으면' 다시 안 받음 ── */
function loadStore(file) { try { return { d: JSON.parse(fs.readFileSync(file, "utf8")), dirty: false }; } catch (e) { return { d: {}, dirty: false }; } }
function saveStore(file, st) { if (!st.dirty) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(st.d)); st.dirty = false; } catch (e) {} }
async function getBars(row, tf, st, log, canFetch) {
  const key = row.full + "|" + tf.k, e = st.d[key], t0 = Date.now(), cur = Math.floor(t0 / tf.ms) * tf.ms;
  if (e && e.at >= cur + 15000) return { rows: e.r, stale: false };
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

/* ── 프레임 하나의 방향: +1 상승 / -1 하락 / 0 미정 ── */
export function trendOf(rows, tf, now) {
  if (!rows) return { d: 0 };
  const closed = rows.filter((r) => r[0] + tf.ms <= now);
  if (closed.length < MIN_BARS) return { d: 0 };
  const cs = closed.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
  let pv; try { pv = PV.analyze(cs, { model: PV.models.small, t1: 0.5, t2: 0.7, t3: 0.85, cooldown: 5, invBars: 12 }); } catch (e) { return { d: 0 }; }
  let best = null;
  for (const g of pv.signals) { if (g.p < 0.7 || g.dead) continue; if (!best || g.pi > best.pi || (g.pi === best.pi && g.t > best.t)) best = g; }
  if (!best) return { d: 0 };
  return { d: best.side === "bot" ? 1 : -1, ago: cs.length - 1 - best.pi };
}

/* ── 서식 ── */
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const eokTxt = (e) => (e >= 10000 ? (e / 10000).toFixed(1) + "조" : fmt(e) + "억");
const mk = (d) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");
const secShort = (s) => String(s || "기타").replace(/\s*\(.*?\)/g, "").trim() || "기타";

export async function buildTrendReport({ uni, info, fx, log, cacheDir, topN, minEok, budgetMs, prev }) {
  const now = Date.now(), T0 = now, file = path.join(cacheDir, "trendbars.json"), st = loadStore(file);
  const canFetch = () => Date.now() - T0 < (budgetMs || 240000);
  const seen = new Set(), pick = [];
  for (const r of uni) {
    if (seen.has(r.short)) continue; seen.add(r.short);
    if ((r.dayNtl * fx) / 1e8 < (minEok == null ? 10 : minEok)) continue;   /* 거래대금 너무 적은 종목은 정렬이 좋아도 뺌 */
    pick.push(r); if (pick.length >= (topN || 50)) break;
  }
  let stale = 0, nofetch = 0;
  const items = [];
  await pool(pick, 3, async (r) => {
    const fr = [];
    for (const tf of TREND_TFS) {
      const b = await getBars(r, tf, st, log, canFetch);
      if (b.stale) stale++;
      if (!b.rows) nofetch++;
      fr.push(trendOf(b.rows, tf, now));
    }
    const ups = fr.filter((x) => x.d > 0).length, downs = fr.filter((x) => x.d < 0).length;
    items.push({ r, fr, ups, downs, known: ups + downs, eok: (r.dayNtl * fx) / 1e8 });
  });
  saveStore(file, st);
  const secOf = (r) => secShort(info.sectorOf[r.short] || info.sectorOf[Object.keys(info.alias).find((k) => info.alias[k] === r.short)] || "기타");
  items.forEach((x) => { x.sec = secOf(x.r); });

  /* 티어: A = 한 프레임도 반대가 없음(미정 제외 4개 이상) / B = 딱 한 프레임만 반대 */
  const tierOf = (x) => {
    if (x.known < 4) return null;
    if (x.downs === 0) return { dir: 1, lvl: "A" };
    if (x.ups === 0) return { dir: -1, lvl: "A" };
    if (x.downs === 1 && x.ups >= 3) return { dir: 1, lvl: "B" };
    if (x.ups === 1 && x.downs >= 3) return { dir: -1, lvl: "B" };
    return null;
  };
  items.forEach((x) => { x.tier = tierOf(x); });
  const cnt = (dir, lvl) => items.filter((x) => x.tier && x.tier.dir === dir && x.tier.lvl === lvl).length;
  const short = items.filter((x) => x.known < 4).length, mixed = items.length - short - items.filter((x) => x.tier).length;

  /* 섹터 방향: 섹터 종목 중 70%↑가 같은 쪽(프레임 과반)이면 '합의' */
  const bySec = {};
  items.forEach((x) => { (bySec[x.sec] = bySec[x.sec] || []).push(x); });
  const secInfo = Object.entries(bySec).map(([name, arr]) => {
    const kn = arr.filter((x) => x.known >= 4), up = kn.filter((x) => x.ups > x.downs).length, dn = kn.length - up;
    const avg = kn.length ? kn.reduce((s, x) => s + x.ups, 0) / kn.length : 2.5;
    const share = kn.length ? Math.max(up, dn) / kn.length : 0;
    return { name, n: arr.length, kn: kn.length, up, dn, avg, eok: arr.reduce((s, x) => s + x.eok, 0), cons: kn.length >= 2 && share >= 0.7 ? (up > dn ? 1 : -1) : 0, bias: avg - 2.5 };
  });
  const secOfName = Object.fromEntries(secInfo.map((s) => [s.name, s]));

  const L = [];
  const d0 = new Date(now + KST_MS), stamp = (d0.getUTCMonth() + 1) + "/" + d0.getUTCDate() + "(" + WDK[d0.getUTCDay()] + ") " + p2(d0.getUTCHours()) + ":" + p2(d0.getUTCMinutes());
  L.push("🧭 5프레임 추세 정렬 · " + stamp + " KST");
  L.push("프레임 일·4H·2H·1H·30M  ▲=직전 확정 신호가 저점(상승)  ▼=고점(하락)");
  L.push("📊 거래대금 상위 " + items.length + "종목 — ▲전부 " + cnt(1, "A") + " · ▲4/5 " + cnt(1, "B") + " ┃ ▼4/5 " + cnt(-1, "B") + " · ▼전부 " + cnt(-1, "A") + " ┃ 혼조 " + mixed + (short ? " · 데이터부족 " + short : ""));

  /* 섹터 방향 */
  const upSec = secInfo.filter((s) => s.kn >= 2 && s.bias > 0.5).sort((a, b) => b.bias - a.bias).slice(0, 3);
  const dnSec = secInfo.filter((s) => s.kn >= 2 && s.bias < -0.5).sort((a, b) => a.bias - b.bias).slice(0, 3);
  const secLine = (s) => (s.bias > 0 ? "🔺" : "🔽") + " " + s.name + (s.cons ? " [합의 " + (s.cons > 0 ? "▲" : "▼") + "]" : "") + " · 평균 " + (s.bias > 0 ? s.avg.toFixed(1) + "/5 상승" : (5 - s.avg).toFixed(1) + "/5 하락") + " · " + s.kn + "종목 · " + eokTxt(s.eok);
  if (upSec.length || dnSec.length) { L.push(""); L.push("🧭 섹터 방향 (프레임 평균)"); upSec.forEach((s) => L.push(secLine(s))); dnSec.forEach((s) => L.push(secLine(s))); }

  /* 티어 블록: 섹터별(섹터 거래대금 합 순) → 섹터 안 거래대금 순. 상승 쪽은 위, 하락 쪽은 아래 */
  const CAP = 10;
  const tierBlock = (dir, lvl) => {
    const arr = items.filter((x) => x.tier && x.tier.dir === dir && x.tier.lvl === lvl);
    if (!arr.length) return;
    const gs = {}; arr.forEach((x) => { (gs[x.sec] = gs[x.sec] || []).push(x); });
    const groups = Object.entries(gs).map(([name, a]) => ({ name, a: a.sort((p, q) => q.eok - p.eok), eok: a.reduce((s, x) => s + x.eok, 0) })).sort((p, q) => q.eok - p.eok);
    L.push("");
    L.push((dir > 0 ? "🔺 상승 " : "🔽 하락 ") + (lvl === "A" ? "전부 일치" : "4/5 일치") + " · " + arr.length + "종목 · " + eokTxt(arr.reduce((s, x) => s + x.eok, 0)));
    let shown = 0;
    for (const g of groups) {
      if (shown >= CAP) break;
      const si = secOfName[g.name];
      L.push("▸ " + g.name + (si && si.cons ? (si.cons === dir ? " [섹터 합의 " + mk(dir) + "]" : " [⚠ 섹터는 " + mk(si.cons) + " — 역행]") : "") + " · " + eokTxt(g.eok));
      for (let i = 0; i < g.a.length && shown < CAP; i++) {
        const x = g.a[i], dis = x.fr.map((f, k) => (f.d !== 0 && f.d !== dir ? TREND_TFS[k].ko + mk(f.d) : f.d === 0 ? TREND_TFS[k].ko + "?" : "")).filter(Boolean).join(" ");
        L.push("  " + (i === 0 && g.a.length >= 2 ? "👑 " : "• ") + coinLabel(x.r, info) + " · " + eokTxt(x.eok) + (dis ? " · " + dis : ""));
        shown++;
      }
    }
    if (shown < arr.length) L.push("  … 외 " + (arr.length - shown) + "종목");
  };
  tierBlock(1, "A"); tierBlock(1, "B"); tierBlock(-1, "B"); tierBlock(-1, "A");

  /* 눌림·반등: 큰 프레임(일·4H) 방향 ≠ 작은 프레임(1H·30M) 방향 */
  const pull = (dir) => items.filter((x) => x.fr[0].d === dir && x.fr[1].d === dir && x.fr[3].d === -dir && x.fr[4].d === -dir).sort((a, b) => b.eok - a.eok).slice(0, 5);
  const pl = pull(1), pb = pull(-1), fl = (x) => x.fr.map((f) => mk(f.d)).join("");
  if (pl.length || pb.length) {
    L.push("");
    if (pl.length) { L.push("🪃 상승 속 눌림 (일·4H ▲ / 1H·30M ▼) — 롱 대기"); pl.forEach((x) => L.push("  • " + coinLabel(x.r, info) + " · " + x.sec + " · " + eokTxt(x.eok) + " · " + fl(x))); }
    if (pb.length) { L.push("🪃 하락 속 반등 (일·4H ▼ / 1H·30M ▲) — 숏 대기"); pb.forEach((x) => L.push("  • " + coinLabel(x.r, info) + " · " + x.sec + " · " + eokTxt(x.eok) + " · " + fl(x))); }
  }

  /* 지난 리포트 대비: 강한 정렬(한쪽 4개↑)에 새로 들어옴 / 풀림 */
  const strong = (x) => (x.tier ? x.tier.dir : 0), state = {};
  items.forEach((x) => { state[x.r.short] = { s: strong(x), u: x.ups }; });
  const nw = [], lost = [], prevMap = prev || {};
  if (prev && Object.keys(prev).length) {
    items.forEach((x) => { const p = prev[x.r.short], s = strong(x); if (!p) return; if (s !== 0 && p.s !== s) nw.push(x); else if (s === 0 && p.s !== 0) lost.push(x); });
    if (nw.length || lost.length) {
      L.push(""); L.push("🔄 지난 리포트 대비");
      nw.slice(0, 5).forEach((x) => L.push("  🆕 " + coinLabel(x.r, info) + " " + (x.tier.dir > 0 ? "▲" + x.ups : "▼" + x.downs) + "/5 " + fl(x)));
      lost.slice(0, 5).forEach((x) => L.push("  ⚠ 정렬 풀림 " + coinLabel(x.r, info) + " " + fl(x)));
    }
  }

  L.push("");
  L.push("※ 마감봉 기준 · 거래대금=24h 원화(환율 " + Math.round(fx) + ") · 가격 보증 아님, 방향 현황판" + (stale ? " · 일부 프레임 갱신 지연(" + stale + ")" : ""));
  const data = { items, secInfo, pl, pb, nw, lost, prev: prevMap, cnt: { aUp: cnt(1, "A"), bUp: cnt(1, "B"), bDn: cnt(-1, "B"), aDn: cnt(-1, "A"), mixed, short }, now, fx, stale };
  return { text: L.join("\n"), state, data, stats: { n: items.length, stale, nofetch, ms: Date.now() - T0 } };
}
