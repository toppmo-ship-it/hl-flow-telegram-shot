/* 5프레임 추세 정렬 → 사진 리포트 명세(spec). 그리기는 하이퍼 리포트와 같은 rep-render.js(window.drawReport)를 씀.
   표 열 순서는 큰 프레임 → 작은 프레임(일 · 4H · 2H · 1H · 30M). 빨강 ▲ = 상승, 파랑 ▼ = 하락(하이퍼 리포트와 같은 색 규칙). */
import { TREND_TFS } from "./trendrep.mjs";

const UP = "#ff6363", DN = "#5496ff", MUTE = "#5f636e", GOLD = "#f5c542", ACC = "#8ab4f8";
const WDK = ["일", "월", "화", "수", "목", "금", "토"], p2 = (n) => String(n).padStart(2, "0");
const C = (t, o) => Object.assign({ t: String(t) }, o || {});
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const eokCell = (e) => C(e >= 10000 ? (e / 10000).toFixed(1) + "조" : e >= 100 ? fmt(e) : e.toFixed(1));
const frameCell = (f) => (f.d > 0 ? C("▲", { c: UP, b: true, bg: "rgba(255,99,99,0.18)" }) : f.d < 0 ? C("▼", { c: DN, b: true, bg: "rgba(84,150,255,0.18)" }) : C("?", { c: MUTE }));
const chgCell = (r) => { if (!r.px || !r.prev) return C("-", { c: MUTE }); const p = (r.px / r.prev - 1) * 100; return C((p >= 0 ? "+" : "") + p.toFixed(2) + "%", { c: p >= 0 ? UP : DN }); };
const FR_COLS = TREND_TFS.map((t) => [t.ko, "c", ACC]);
const cntCell = (x, dir) => (dir > 0 ? C("▲" + x.ups + "/5", { c: UP, b: true }) : C("▼" + x.downs + "/5", { c: DN, b: true }));

export function buildTrendSpec({ data, info, fx, res }) {
  const { items, secInfo, pl, pb, nw, lost, prev, cnt, now, stale } = data;
  const kmap = info.koFull || info.ko || {}, koOf = (r) => { const k = kmap[r.short] || kmap[Object.keys(info.alias).find((a) => info.alias[a] === r.short)] || ""; return k && k !== r.short ? k : ""; };
  const secBy = Object.fromEntries(secInfo.map((s) => [s.name, s]));
  const d0 = new Date(now + 9 * 3600e3), hm = p2(d0.getUTCHours()) + ":" + p2(d0.getUTCMinutes()), md = (d0.getUTCMonth() + 1) + "/" + d0.getUTCDate() + "(" + WDK[d0.getUTCDay()] + ")";
  const sections = [];

  sections.push({ kind: "chips", chips: [
    { label: "▲ 전부 일치", value: cnt.aUp, color: UP }, { label: "▲ 4/5", value: cnt.bUp, color: UP },
    { label: "▼ 4/5", value: cnt.bDn, color: DN }, { label: "▼ 전부 일치", value: cnt.aDn, color: DN },
    { label: "혼조", value: cnt.mixed, color: "#b0b6c2" }, { label: "상승 속 눌림", value: pl.length, color: "#f2a65a" }, { label: "하락 속 반등", value: pb.length, color: "#7bd0c8" },
  ] });

  /* ① 섹터 방향 — 프레임 평균이 높은(상승) 섹터부터 낮은(하락) 섹터 순 */
  const secRows = secInfo.filter((s) => s.kn >= 1).sort((a, b) => b.avg - a.avg || b.eok - a.eok).slice(0, 16);
  if (secRows.length) {
    const leader = (name) => items.filter((x) => x.sec === name && x.known >= 4).sort((a, b) => b.eok - a.eok)[0];
    sections.push({
      title: "① 섹터 방향", sub: "섹터 안 종목들의 상승 프레임 평균 · 70%↑가 같은 쪽이면 합의 · 대장 = 섹터 거래대금 1위",
      cols: [["#", "c"], ["섹터", "l"], ["방향", "c"], ["평균", "c"], ["▲", "c"], ["▼", "c"], ["종목", "c"], ["억원", "r"], ["대장", "l"]],
      rows: secRows.map((s, i) => {
        const side = s.avg >= 2.5 ? 1 : -1, ld = leader(s.name);
        const dirCell = s.cons > 0 ? C("▲ 합의", { c: UP, b: true, bg: "rgba(255,99,99,0.18)" }) : s.cons < 0 ? C("▼ 합의", { c: DN, b: true, bg: "rgba(84,150,255,0.18)" }) : Math.abs(s.bias) >= 0.4 ? C(side > 0 ? "▲ 우세" : "▼ 우세", { c: side > 0 ? UP : DN }) : C("혼조", { c: MUTE });
        return [C(i + 1, { c: MUTE }), C(s.name, { b: true }), dirCell, C(s.avg.toFixed(1) + "/5", { c: side > 0 ? UP : DN, b: true }), C(s.up, { c: UP }), C(s.dn, { c: DN }), C(s.kn), eokCell(s.eok),
          ld ? C(ld.r.short + (ld.ups >= 3 ? " ▲" + ld.ups : " ▼" + ld.downs), { c: ld.ups >= 3 ? UP : DN }) : C("-", { c: MUTE })];
      }),
    });
  }

  /* ② 정렬 티어 — 섹터별(섹터 거래대금 합 순)로 묶고, 섹터 안은 거래대금 순. 첫 줄(대장)은 ★ + 옅은 띠 */
  const tierSec = (dir, lvl, title, sub, cap, extra) => {
    const arr = items.filter((x) => x.tier && x.tier.dir === dir && x.tier.lvl === lvl);
    if (!arr.length) return;
    const gs = {}; arr.forEach((x) => { (gs[x.sec] = gs[x.sec] || []).push(x); });
    const groups = Object.entries(gs).map(([name, a]) => ({ name, a: a.sort((p, q) => q.eok - p.eok), eok: a.reduce((s, x) => s + x.eok, 0) })).sort((p, q) => q.eok - p.eok);
    const rows = [], rowbg = []; let shown = 0;
    for (const g of groups) {
      const si = secBy[g.name];
      for (let i = 0; i < g.a.length; i++) {
        if (shown >= cap) break;
        const x = g.a[i], lead = i === 0, tag = si && si.cons ? (si.cons === dir ? (dir > 0 ? " ▲합의" : " ▼합의") : " ⚠역행") : "";
        rows.push([C(shown + 1, { c: MUTE }), C((lead && g.a.length >= 2 ? "{S}" : "") + x.r.short, { b: true, c: lead && g.a.length >= 2 ? GOLD : undefined }), C(koOf(x.r), { c: "#c9ced8" }),
          C(i === 0 ? g.name + tag : "", { c: si && si.cons === dir ? (dir > 0 ? UP : DN) : si && si.cons ? "#f2a65a" : "#b0b6c2", b: i === 0 }),
          chgCell(x.r), eokCell(x.eok), ...x.fr.map(frameCell), cntCell(x, dir)]);
        rowbg.push(lead && g.a.length >= 2 ? "rgba(138,180,248,0.10)" : null);
        shown++;
      }
    }
    sections.push(Object.assign({
      title, sub: sub + (shown < arr.length ? " · 상위 " + shown + "/" + arr.length + "종목" : " · " + arr.length + "종목"),
      cols: [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"], ["등락", "r"], ["억원", "r"], ...FR_COLS, ["일치", "c"]], rows, rowbg,
    }, extra || {}));
  };
  tierSec(1, "A", "② ▲ 상승 전부 일치", "다섯 프레임 모두 상승 · 섹터별 → 거래대금 순", 15, { feature: true });
  tierSec(1, "B", "③ ▲ 상승 4/5", "한 프레임만 반대(▼) · 어느 프레임이 어긋났는지 열에서 확인", 20);
  tierSec(-1, "B", "④ ▼ 하락 4/5", "한 프레임만 반대(▲)", 20);
  tierSec(-1, "A", "⑤ ▼ 하락 전부 일치", "다섯 프레임 모두 하락 · 섹터별 → 거래대금 순", 15, { index: true });

  /* ⑥ 눌림·반등(좌) / ⑦ 지난 리포트 대비(우) */
  const pullRows = (arr) => arr.map((x, i) => [C(i + 1, { c: MUTE }), C(x.r.short, { b: true }), C(x.sec, { c: "#c9ced8" }), eokCell(x.eok), ...x.fr.map(frameCell)]);
  const pullCols = [["#", "c"], ["종목", "l"], ["섹터", "l"], ["억원", "r"], ...FR_COLS];
  if (pl.length) sections.push({ half: true, title: "⑥ 상승 속 눌림", sub: "일·4H ▲ / 1H·30M ▼ → 롱 대기", cols: pullCols, rows: pullRows(pl) });
  if (pb.length) sections.push({ half: true, title: "⑦ 하락 속 반등", sub: "일·4H ▼ / 1H·30M ▲ → 숏 대기", cols: pullCols, rows: pullRows(pb) });
  const chgRows = [];
  nw.slice(0, 6).forEach((x) => chgRows.push([C("🆕".length ? "NEW" : "", { c: GOLD, b: true }), C(x.r.short, { b: true }), C(x.tier.dir > 0 ? "▲" + x.ups + "/5" : "▼" + x.downs + "/5", { c: x.tier.dir > 0 ? UP : DN, b: true }), ...x.fr.map(frameCell)]));
  lost.slice(0, 6).forEach((x) => { const p = prev[x.r.short]; chgRows.push([C("풀림", { c: "#f2a65a", b: true }), C(x.r.short, { b: true }), C(p && p.s > 0 ? "▲→혼조" : "▼→혼조", { c: "#b0b6c2" }), ...x.fr.map(frameCell)]); });
  if (chgRows.length) sections.push({ half: true, title: "⑧ 지난 리포트 대비", sub: "강한 정렬(4/5↑)에 새로 들어옴 · 풀림", cols: [["구분", "c"], ["종목", "l"], ["변화", "c"], ...FR_COLS], rows: chgRows });

  return {
    header: { title: "TM Trend Report · " + hm, sub: md + " " + hm + " KST · 거래대금 상위 " + items.length + "종목 · 1$=" + fmt(fx) + "원 환산 · 억원=한화 · 등락=전일대비", sub2: "프레임 큰→작은: 일 · 4H · 2H · 1H · 30M  |  ▲ = 마지막 확정 신호가 저점(상승)  ▼ = 고점(하락)  ? = 데이터 부족  |  일치 = 같은 방향 프레임 수" },
    sections,
    foot: "방향 = PivotScope(작은 피벗) 마지막 확정 신호(확률 0.7↑·12봉 내 깨진 신호 제외) · 마감봉 기준 · 방향 현황판이며 진입 신호가 아님" + (stale ? " · 일부 프레임 갱신 지연(" + stale + ")" : ""),
    caption: "🧭 5프레임 추세 정렬 · " + md + " " + hm + " KST\n▲전부 " + cnt.aUp + " · ▲4/5 " + cnt.bUp + " ┃ ▼4/5 " + cnt.bDn + " · ▼전부 " + cnt.aDn + " ┃ 혼조 " + cnt.mixed,
  };
}
