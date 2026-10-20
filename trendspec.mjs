/* 5프레임 추세 정렬 → 사진 리포트 명세(spec). 그리기는 하이퍼 리포트와 같은 rep-render.js(window.drawReport)를 씀.
   표 열 순서는 큰 프레임 → 작은 프레임(일 · 4H · 2H · 1H · 30M). 빨강 ▲ = 상승, 파랑 ▼ = 하락(하이퍼 리포트와 같은 색 규칙).
   색 테마는 주식 리포트(회색·금색)·코인 리포트(갈색·주황)와 겹치지 않게 '심야 네이비 + 코랄/전기블루'로 따로 둠. */
import { TREND_TFS, eokTxt, ageKo } from "./trendrep.mjs";

const UP = "#ff5d73", DN = "#4da3ff", UP2 = "#ffa0ac", DN2 = "#9ccaff", MUTE = "#6c7a99", GOLD = "#ffd166", OK = "#3ddc97", WARN = "#ffb84d", TXT2 = "#c3cde6";
export const TREND_THEME = {
  ic: { bg: "#0a101f", box: "#101a31", row2: "#14213c", head: "#1b2c52", line: "#263a63", txt: "#eaf0ff", sub: "#8da0c8", title: "#ffffff", mark: "#4da3ff", up: UP, dn: DN, ok: OK, no: "#5a6a8c", acc: "#7cc4ff" },
  feat: "#ff7a8c", featBg: "#2a1220", featHead: "#5a1d33", featRGB: "255,122,140", band: "77,163,255",
  idx: { bg: "#0f2140", head: "#17366b", line: "#3f86e8", acc: "#7cc0ff", title: "#cfe6ff" },
};
const WDK = ["일", "월", "화", "수", "목", "금", "토"], p2 = (n) => String(n).padStart(2, "0");
const C = (t, o) => Object.assign({ t: String(t) }, o || {});
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const eokCell = (e) => C(e >= 10000 ? (e / 10000).toFixed(1) + "조" : e >= 100 ? fmt(e) : e.toFixed(1));
const mk = (d) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");

/* 프레임 칸: 큰 화살표(확정) = 굵고 진한 알약 / 작은 화살표(예비) = 가늘고 옅은 알약 / 방금 전환 = 앞에 ◆ / 갱신 지연 = 회색 */
function frameCell(f) {
  if (!f || f.d === 0) return C("?", { c: MUTE });
  const up = f.d > 0, g = mk(f.d);
  if (f.stale) return C(g, { c: MUTE, sz: 0.85 });
  const t = (f.hot ? "{d}" : "") + g;
  if (up) return f.big ? C(t, { c: UP, b: true, bg: "rgba(255,93,115,0.30)" }) : C(t, { c: UP2, sz: 0.85, bg: "rgba(255,93,115,0.09)" });
  return f.big ? C(t, { c: DN, b: true, bg: "rgba(77,163,255,0.30)" }) : C(t, { c: DN2, sz: 0.85, bg: "rgba(77,163,255,0.09)" });
}
const chgCell = (r) => { if (!r.px || !r.prev) return C("-", { c: MUTE }); const p = (r.px / r.prev - 1) * 100; return C((p >= 0 ? "+" : "") + p.toFixed(2) + "%", { c: p >= 0 ? UP : DN }); };
const FR_COLS = TREND_TFS.map((t) => [t.ko, "c", "#8ab8ff"]);
const cntCell = (x, dir) => (dir > 0 ? C("▲" + x.ups + "/5", { c: UP, b: true }) : C("▼" + x.downs + "/5", { c: DN, b: true }));
/* '최근 전환' 칸: 방향이 바뀐 지 얼마 안 된 프레임들을 큰 프레임부터 */
const recentTxt = (x) => x.fr.map((f, i) => (f.hot ? TREND_TFS[i].ko + mk(f.d) + " " + ageKo(f.ageMs) + "전" : "")).filter(Boolean).join(" · ");
const stateOf = (x) => { const u = x.ups, d = x.downs; return u === 5 ? ["강한 상승", UP] : d === 5 ? ["강한 하락", DN] : u >= 4 ? ["상승 우세", UP] : d >= 4 ? ["하락 우세", DN] : u > d ? ["약한 상승", UP2] : d > u ? ["약한 하락", DN2] : ["혼조", "#b0b9d0"]; };

export function buildTrendSpec({ data, info, fx }) {
  const { items, fixedItems, secInfo, flips, nw, lost, prev, cnt, now, stale } = data;
  const kmap = info.koFull || info.ko || {}, koOf = (r) => { const k = kmap[r.short] || kmap[Object.keys(info.alias).find((a) => info.alias[a] === r.short)] || ""; return k && k !== r.short ? k : ""; };
  const secBy = Object.fromEntries(secInfo.map((s) => [s.name, s]));
  const d0 = new Date(now + 9 * 3600e3), hm = p2(d0.getUTCHours()) + ":" + p2(d0.getUTCMinutes()), md = (d0.getUTCMonth() + 1) + "/" + d0.getUTCDate() + "(" + WDK[d0.getUTCDay()] + ")";
  const sections = [];
  const nPull = data.pl.filter((x) => x.pb.stage >= 1).length + data.pb.filter((x) => x.pb.stage >= 1).length;

  const chips = [
    { label: "▲ 전부 일치", value: cnt.aUp, color: UP }, { label: "▲ 4/5", value: cnt.bUp, color: UP }, { label: "▼ 4/5", value: cnt.bDn, color: DN }, { label: "▼ 전부 일치", value: cnt.aDn, color: DN },
    { label: "혼조", value: cnt.mixed, color: "#b0b9d0" }, { label: "방금 전환", value: flips.length, color: GOLD }, { label: "복귀 진행", value: nPull, color: OK },
  ];
  if (stale) chips.push({ label: "갱신 지연", value: stale, color: WARN });
  sections.push({ kind: "chips", chips });

  /* ─ 시장 방향 요약: 나스닥 · 코스피 · 유가 · 미국10년물 금리 (요즘 매크로의 핵심) ─ */
  const fx0 = (t) => fixedItems.find((x) => x.r.short === t);
  const score = (arr) => { const v = arr.filter(Boolean).filter((x) => x.known >= 3); return v.length ? v.reduce((s, x) => s + (x.ups - x.downs), 0) / v.length : 0; };
  const dirOf = (sc) => (sc >= 1 ? 1 : sc <= -1 ? -1 : 0);
  const eq = dirOf(score([fx0("XYZ100"), fx0("KR200")])), oil = dirOf(score([fx0("CL"), fx0("BRENTOIL")])), rate = dirOf(score([fx0("10Y")]));
  const dirTxt = (d) => (d > 0 ? "▲ 우세" : d < 0 ? "▼ 우세" : "혼조"), dirCol = (d) => (d > 0 ? UP : d < 0 ? DN : "#b0b9d0");
  const mood = !eq || !rate ? ["혼조 · 관망", "#b0b9d0"] : eq > 0 && rate < 0 ? ["위험선호 (주식↑ 금리↓)", UP] : eq > 0 && rate > 0 ? ["강세장 · 금리 동반 상승", UP2] : eq < 0 && rate > 0 ? ["금리 부담 (위험회피)", DN] : ["성장 우려 · 안전선호", DN2];
  sections.push({ kind: "chips", chips: [
    { label: "주식 (나스닥·코스피)", value: dirTxt(eq), color: dirCol(eq) }, { label: "유가 (WTI·브렌트)", value: dirTxt(oil), color: dirCol(oil) },
    { label: "금리 (美10년물)", value: dirTxt(rate), color: dirCol(rate) }, { label: "시장 성향", value: mood[0], color: mood[1] },
  ] });
  const MAIN = ["XYZ100", "KR200", "CL", "10Y"], mainItems = MAIN.map(fx0).filter(Boolean);
  const idxRow = (x, i) => { const st = stateOf(x), side = x.ups >= x.downs ? 1 : -1;
    return [C(i + 1, { c: MUTE }), C(x.r.short, { b: true }), C(koOf(x.r), { c: TXT2 }), chgCell(x.r), eokCell(x.eok), ...x.fr.map(frameCell), C(side > 0 ? "▲" + x.ups + "/" + x.known : "▼" + x.downs + "/" + x.known, { c: side > 0 ? UP : DN, b: true }), C(st[0], { c: st[1], b: true }), C(recentTxt(x), { c: GOLD })]; };
  const idxCols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["등락", "r"], ["억원", "r"], ...FR_COLS, ["일치", "c"], ["상태", "c"], ["최근 전환", "l"]];
  if (mainItems.length) sections.push({ index: true, title: "◈ 시장 방향", sub: "나스닥100 · 코스피200 · WTI · 美10년물 · 큰 칸=확정(큰 화살표) 옅은 칸=예비(작은 화살표) ◆=방금 전환", cols: idxCols, rows: mainItems.map(idxRow) });
  const rest = fixedItems.filter((x) => !MAIN.includes(x.r.short));
  if (rest.length) sections.push({ title: "◇ 그 밖의 지수 · 원자재", sub: rest.length + "종 · 거래대금과 관계없이 항상 표시", cols: idxCols, rows: rest.map(idxRow) });

  /* ─ ① 섹터 방향 ─ */
  const secRows = secInfo.filter((s) => s.kn >= 1).sort((a, b) => b.avg - a.avg || b.eok - a.eok).slice(0, 16);
  if (secRows.length) {
    const leader = (name) => items.filter((x) => x.sec === name && x.known >= 4).sort((a, b) => b.eok - a.eok)[0];
    sections.push({
      title: "① 섹터 방향", sub: "섹터 안 종목들의 상승 프레임 평균 · 70%↑가 같은 쪽이면 합의 · 대장 = 섹터 거래대금 1위",
      cols: [["#", "c"], ["섹터", "l"], ["방향", "c"], ["평균", "c"], ["▲", "c"], ["▼", "c"], ["종목", "c"], ["억원", "r"], ["대장", "l"]],
      rows: secRows.map((s, i) => {
        const side = s.avg >= 2.5 ? 1 : -1, ld = leader(s.name);
        const dirCell = s.cons > 0 ? C("▲ 합의", { c: UP, b: true, bg: "rgba(255,93,115,0.20)" }) : s.cons < 0 ? C("▼ 합의", { c: DN, b: true, bg: "rgba(77,163,255,0.20)" }) : Math.abs(s.bias) >= 0.4 ? C(side > 0 ? "▲ 우세" : "▼ 우세", { c: side > 0 ? UP2 : DN2 }) : C("혼조", { c: MUTE });
        return [C(i + 1, { c: MUTE }), C(s.name, { b: true }), dirCell, C(s.avg.toFixed(1) + "/5", { c: side > 0 ? UP : DN, b: true }), C(s.up, { c: UP }), C(s.dn, { c: DN }), C(s.kn), eokCell(s.eok),
          ld ? C(ld.r.short + (ld.ups >= 3 ? " ▲" + ld.ups : " ▼" + ld.downs), { c: ld.ups >= 3 ? UP : DN }) : C("-", { c: MUTE })];
      }),
    });
  }

  /* ─ ②~⑤ 정렬 티어 — 섹터별(섹터 거래대금 합 순)로 묶고, 섹터 안은 거래대금 순. 섹터 안 1위(2종목 이상일 때)는 ★ + 옅은 띠 ─ */
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
        const x = g.a[i], lead = i === 0 && g.a.length >= 2, tag = si && si.cons ? (si.cons === dir ? (dir > 0 ? " ▲합의" : " ▼합의") : " ⚠역행") : "";
        rows.push([C(shown + 1, { c: MUTE }), C((lead ? "{S}" : "") + x.r.short, { b: true, c: lead ? GOLD : undefined }), C(koOf(x.r), { c: TXT2 }),
          C(i === 0 ? g.name + tag : "", { c: si && si.cons === dir ? (dir > 0 ? UP : DN) : si && si.cons ? WARN : "#b0b9d0", b: i === 0 }),
          chgCell(x.r), eokCell(x.eok), ...x.fr.map(frameCell), cntCell(x, dir), C(recentTxt(x), { c: GOLD })]);
        rowbg.push(lead ? "rgba(124,196,255,0.10)" : null);
        shown++;
      }
    }
    sections.push(Object.assign({
      title, sub: sub + (shown < arr.length ? " · 상위 " + shown + "/" + arr.length + "종목" : " · " + arr.length + "종목"),
      cols: [["#", "c"], ["종목", "l"], ["이름", "l"], ["섹터", "l"], ["등락", "r"], ["억원", "r"], ...FR_COLS, ["일치", "c"], ["최근 전환", "l"]], rows, rowbg,
    }, extra || {}));
  };
  tierSec(1, "A", "② ▲ 상승 전부 일치", "다섯 프레임 모두 상승 · 섹터별 → 거래대금 순", 15, { feature: true });
  tierSec(1, "B", "③ ▲ 상승 4/5", "한 프레임만 반대(▼) · 어긋난 프레임은 칸에서 확인", 20);
  tierSec(-1, "B", "④ ▼ 하락 4/5", "한 프레임만 반대(▲)", 20);
  tierSec(-1, "A", "⑤ ▼ 하락 전부 일치", "다섯 프레임 모두 하락 · 섹터별 → 거래대금 순", 15, { index: true });

  /* ─ ⑥ 방금 전환: 최근 3봉 안에 방향이 바뀐 프레임이 있는 종목(큰 프레임 우선) ─ */
  const flipTxt = (x) => x.fr.map((f, i) => (f.hot ? TREND_TFS[i].ko + " " + mk(-f.d) + "→" + mk(f.d) + " (" + f.ago + "봉 · " + ageKo(f.ageMs) + " 전" + (f.big ? "" : " · 예비") + ")" : "")).filter(Boolean).join("   ");
  if (flips.length) sections.push({
    title: "⑥ 방금 전환", sub: "마지막 화살표가 그 앞 화살표와 반대로 바뀐 지 3봉 이내(큰 화살표 또는 일·4H·2H) · 프레임별 전환 종목수 " + TREND_TFS.map((t, i) => t.ko + " " + flips.filter((x) => x.fr[i].hot).length).join(" · ") + " · 상위 " + Math.min(14, flips.length) + "/" + flips.length,
    cols: [["#", "c"], ["종목", "l"], ["이름", "l"], ["억원", "r"], ...FR_COLS, ["전환 내용", "l"]],
    rows: flips.slice(0, 14).map((x, i) => [C(i + 1, { c: MUTE }), C(x.r.short, { b: true }), C(koOf(x.r), { c: TXT2 }), eokCell(x.eok), ...x.fr.map(frameCell), C(flipTxt(x), { c: GOLD })]),
  });

  /* ─ ⑦⑧ 눌림 · 반등 단계표: 큰 프레임(일·4H) 방향은 같고 작은 프레임(1H·30M)이 반대로 눌렸다가 돌아오는 순서 ─ */
  const stageCell = (x) => {
    const { dir, stage } = x.pb, L = dir > 0
      ? [["눌림 중", MUTE, null], ["30M 복귀", WARN, "rgba(255,184,77,0.16)"], ["1H 복귀 ✓", OK, "rgba(61,220,151,0.20)"]]
      : [["반등 중", MUTE, null], ["30M 재하락", WARN, "rgba(255,184,77,0.16)"], ["1H 재하락 ✓", OK, "rgba(61,220,151,0.20)"]];
    return C(L[stage][0], { c: L[stage][1], b: stage > 0, bg: L[stage][2] || undefined });
  };
  const pbRows = (arr) => arr.slice(0, 8).map((x, i) => [C(i + 1, { c: MUTE }), C(x.r.short, { b: true }), C(koOf(x.r), { c: TXT2 }), stageCell(x), ...x.fr.map(frameCell),
    C(x.pb.stage === 2 ? "1H " + ageKo(x.fr[3].ageMs) + " 전" + (x.fr[3].big ? "" : " · 예비") : x.pb.stage === 1 ? "30M " + ageKo(x.fr[4].ageMs) + " 전" + (x.fr[4].big ? "" : " · 예비") : "", { c: GOLD }), eokCell(x.eok), C(x.sec, { c: TXT2 })]);
  const pbCols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["단계", "c"], ...FR_COLS, ["복귀 신호", "l"], ["억원", "r"], ["섹터", "l"]];
  if (data.pl.length) sections.push({ title: "⑦ 상승 속 눌림 → 롱 대기", sub: "일·4H ▲ 유지 · 1H·30M이 눌린 뒤 30M → 1H 순서로 ▲ 복귀하면 진입 후보 · 단계 높은 순", cols: pbCols, rows: pbRows(data.pl) });
  if (data.pb.length) sections.push({ title: "⑧ 하락 속 반등 → 숏 대기", sub: "일·4H ▼ 유지 · 1H·30M이 반등한 뒤 30M → 1H 순서로 ▼ 복귀하면 진입 후보 · 단계 높은 순", cols: pbCols, rows: pbRows(data.pb) });

  /* ─ ⑨ 정렬 변화(지난 리포트 대비) ─ */
  const chgRows = [];
  nw.slice(0, 6).forEach((x) => chgRows.push([C("NEW", { c: GOLD, b: true }), C(x.r.short, { b: true }), C(x.tier.dir > 0 ? "▲" + x.ups + "/5" : "▼" + x.downs + "/5", { c: x.tier.dir > 0 ? UP : DN, b: true }), ...x.fr.map(frameCell)]));
  lost.slice(0, 6).forEach((x) => { const p = prev[x.r.short]; chgRows.push([C("풀림", { c: WARN, b: true }), C(x.r.short, { b: true }), C(p && p.s > 0 ? "▲→혼조" : "▼→혼조", { c: "#b0b9d0" }), ...x.fr.map(frameCell)]); });
  if (chgRows.length) sections.push({ title: "⑨ 정렬 변화", sub: "지난 리포트 대비 강한 정렬(4/5↑)에 새로 들어옴 · 풀림", cols: [["구분", "c"], ["종목", "l"], ["변화", "c"], ...FR_COLS], rows: chgRows });

  return {
    theme: TREND_THEME,
    header: { title: "TM Trend Report · " + hm, sub: md + " " + hm + " KST · 거래대금 상위 " + items.length + "종목 + 지수·원자재 · 1$=" + fmt(fx) + "원 환산 · 억원=한화 · 등락=전일대비",
      sub2: "프레임 큰→작은: 일 · 4H · 2H · 1H · 30M  |  ▲ = 마지막 화살표가 저점(상승)  ▼ = 고점(하락)  ·  진한 칸 = 큰(확정) 화살표 · 옅은 칸 = 작은(예비)  ◆ = 방금 전환  ? = 데이터 부족  |  일치 = 같은 방향 프레임 수" },
    sections,
    foot: "방향 = 트레이딩뷰 PivotScope(작은 피벗)의 마지막 화살표(큰·작은 모두, ✕ 가짜 제외) · 마감봉 기준 · 방향 현황판이며 진입 신호가 아님" + (stale ? " · 회색 칸은 갱신 지연(" + stale + ")" : ""),
    caption: "🧭 5프레임 추세 정렬 · " + md + " " + hm + " KST\n시장 성향: " + mood[0] + "\n▲전부 " + cnt.aUp + " · ▲4/5 " + cnt.bUp + " ┃ ▼4/5 " + cnt.bDn + " · ▼전부 " + cnt.aDn + " ┃ 혼조 " + cnt.mixed + " ┃ 방금 전환 " + flips.length,
  };
}
