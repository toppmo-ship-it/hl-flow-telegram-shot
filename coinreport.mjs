/* TM Coin Daily Report — 코인 전용 데일리 리포트 조립 (그리는 일은 rep-render.js 가 함, 색은 COIN_THEME)
   셀 모양·색·진입 감지·표 그리기는 주식 리포트(report.mjs · rep-render.js)와 같은 코드를 가져다 씀 → 한 곳을 고치면 둘 다 바뀜.
   정렬은 주식 리포트와 같음: 전종목 표 = 양W 2→1→0 순, 같은 양W 안에서는 거래대금 큰 순, ★핵심(양W+2·켈상단·4H중심) 줄 강조.
   2장으로 나눠 보냄: ① 시장 국면 · ★핵심 · 전종목 ② TOP 박스들 · 분야별 · 최근 진입 · 급변동 */
import { K } from "./report.mjs";
import { fmtKrw } from "./mcap.mjs";
import { COIN } from "./coinset.mjs";
import { median, FUND_BASE } from "./coincalc.mjs";

const { C, H, cell, dash, nul } = K;
const KRW_MAX = 99999;
/* 코인 리포트의 색 — 주식 리포트(회색·금색)와 한눈에 구분되게 따뜻한 갈색·비트코인 주황 바탕 + 청록 강조 */
export const COIN_THEME = {
  ic: { bg: "#17120b", box: "#241b10", row2: "#2b2113", head: "#3a2a12", line: "#4a3820", txt: "#f1e8da", sub: "#b9a487", title: "#fff3df", mark: "#ffb36b", acc: "#f7931a" },
  feat: "#5eead4", featBg: "#0e2b28", featHead: "#14524b", featRGB: "94,234,212", band: "247,147,26",
  idx: { bg: "#1f1a33", head: "#30285a", line: "#7a6bd0", acc: "#a99bf5", title: "#d6cffc" },
};
const CORE_ROW = "rgba(94,234,212,0.17)", HOT_ROW = "rgba(247,147,26,0.20)";
const eokText = K.eokText;
const sgn = (x, d) => (nul(x) ? "-" : (x > 0 ? "+" : "") + x.toFixed(d == null ? 1 : d));
const mcText = (v) => (v && v.mcKrw ? fmtKrw(v.mcKrw) : "");
const mcCell = (r) => { const t = mcText(r.v); return t ? cell(t, "#e0d6c6") : dash(); };
/* 펀딩(연환산): 하이퍼리퀴드 기본선이 +11% 라서 그 근처는 흐린 글씨, 기본선보다 크게 벗어나야 색을 입힘, hot(기본 ±100%) 넘으면 알약 */
const fundCell = (a, hot) => { if (nul(a)) return cell("-", C.sub); const t = sgn(a, 0) + "%", ex = a - FUND_BASE; if (a >= hot) return cell(t, "#ffd1b8", true, "#7a2c12"); if (a <= -hot) return cell(t, "#bcd7ff", true, "#143e78"); if (Math.abs(ex) < 8) return cell(t, C.sub); return cell(t, ex > 0 ? C.up : C.dn, Math.abs(ex) >= 30); };
const rsiCell = (x) => (nul(x) ? cell("-", C.sub) : x >= 70 ? cell(String(Math.round(x)), C.up, true) : x <= 30 ? cell(String(Math.round(x)), C.dn, true) : cell(String(Math.round(x))));
const hiCell = (x) => (nul(x) ? cell("-", C.sub) : x >= -2 ? cell(sgn(x), C.up, true) : cell(sgn(x), x <= -40 ? C.dn : C.sub));
const wcut = K.wcut;
const nameOf = (r) => wcut(String(r.name).replace(/\(.*?\)/g, "").trim(), 12);

/* 전종목·★핵심 표의 칸 — [이름, 정렬, 머리색, 셀 만들기] */
const COLS = [
  ["가격", "r", H.px, (r) => cell(K.fmtPx(r.v.px), null, true)],
  ["24h", "r", H.px, (r) => K.pct(r.v.chg)],
  ["7일", "r", H.px, (r) => K.pct(r.v.ret7)],
  ["억원", "r", H.px, (r) => cell(eokText(r.v.eok), null, true)],
  ["시총", "r", H.px, mcCell],
  ["미결제", "r", H.ov, (r) => cell(eokText(r.v.oiEok))],
  ["펀딩", "r", H.ov, (r, o) => fundCell(r.v.apr, o.hot)],
  ["이격도", "r", H.ov, (r) => K.cGap(r.v.gap)],
  ["3일격", "r", H.ov, (r) => K.signed(r.v.g3)],
  ["5일격", "r", H.ov, (r) => K.signed(r.v.g5)],
  ["양W", "c", H.tr, (r) => K.cW(r.v.w)],
  ["켈", "c", H.tr, (r) => K.cKel(r.v.kc)],
  ["4H", "c", H.tr, (r) => K.c4H(r.v)],
  ["스퀴즈", "c", H.au, (r) => K.cStage(r.v.sqz)],
  ["RV", "c", H.au, (r) => K.cStage(r.v.rv)],
  ["켈유", "r", H.sp, (r) => (r.v.kelu > 0 ? cell(Math.round(r.v.kelu) + "일", C.mark, true) : dash())],
  ["RSI", "r", H.sp, (r) => rsiCell(r.v.rsi)],
  ["고점", "r", H.sp, (r) => hiCell(r.v.hi90)],
];
const KOR_FNG = { "Extreme Fear": "극단적 공포", Fear: "공포", Neutral: "중립", Greed: "탐욕", "Extreme Greed": "극단적 탐욕" };
const pp = (x) => (nul(x) ? "–" : (x > 0 ? "+" : "") + x.toFixed(1) + "%p");
const pc = (x) => (nul(x) ? "–" : (x > 0 ? "+" : "") + x.toFixed(1) + "%");
const tone = (x) => (nul(x) || x === 0 ? C.txt : x > 0 ? C.up : C.dn);
const tcell = (t, col, b) => cell(t, col || null, !!b);

/* rows = [{ tk, name, cat, mc, v, stable }] (v 없는 것은 제외된 상태) */
export function buildCoinReport({ cfg, rows, meta, mv, fx, now, ent, notes }) {
  const hot = +cfg.fundHot || 100, limit = Math.min(150, Math.max(20, +cfg.rows || 70));
  const o = { hot };
  const by = Object.fromEntries(rows.map((r) => [r.tk, r])), btc = by.BTC;
  const byEok = (a, b) => b.v.eok - a.v.eok;
  const pass = rows.filter((r) => r.v.w >= 0), core = rows.filter((r) => K.isCore(r.v));
  const cols = [["#", "c"], ["종목", "l"], ["이름", "l"], ["분야", "l"]].concat(COLS.map(([h, a, c]) => [h, a, c]));
  const cellsOf = (r) => COLS.map(([, , , fn]) => fn(r, o));
  const big = (r, i, star) => [cell(i + 1, star ? "#5eead4" : C.sub, star), cell((star ? "{S}" : "") + r.tk, star ? "#ffffff" : null, true), cell(nameOf(r), star ? "#ffffff" : null), cell(wcut(r.cat || "", 8), C.sub)].concat(cellsOf(r));
  const coreBg = (list) => list.map((r) => (K.isCore(r.v) ? CORE_ROW : null));
  const hm = K.hm, mdhm = K.mdhm;

  /* ── 요약 칩 ── */
  const kc = rows.filter((r) => r.v.kc === 1).length, hx = rows.filter((r) => r.v.h4u === 1).length, w2 = rows.filter((r) => r.v.w >= 2).length, sq = rows.filter((r) => r.v.sqz >= 3).length;
  const recent30 = new Set((ent || []).filter((e) => now - e.t <= 30 * 60000).map((e) => e.k)).size;
  const vcol = { alt: "#4ade80", alt2: "#a3e635", btc: "#f7931a", btc2: "#fdba74", mix: "#cbd5e1" };
  const chips = [];
  if (mv && mv.verdict) chips.push({ label: "시장", value: mv.verdict.t, color: vcol[mv.verdict.c], bg: "#2a2012" });
  chips.push({ label: "{S}핵심", value: core.length, color: "#5eead4", bg: "#0e2b28" }, { label: "켈 돌파", value: kc, color: "#26d07c" }, { label: "{F}4H 발산", value: hx, color: "#ffab40" },
    { label: "양W +2", value: w2, color: "#7dffb4" }, { label: "스퀴즈 3", value: sq, color: "#ffcf7a" }, { label: "30분 내 진입", value: recent30, color: C.mark });
  if (mv && mv.idx30 != null) chips.push({ label: "알트시즌(30일)", value: mv.idx30, color: "#a99bf5" });
  if (mv && (mv.hotLong || mv.hotShort)) chips.push({ label: "펀딩 과열", value: "롱" + mv.hotLong + " 숏" + mv.hotShort, color: "#ff9f68" });

  /* ── 시장 국면 (비트코인 도미넌스 · 알트시즌 · 시장 열기) ── */
  const g = (mv && mv.g) || {}, d24 = (mv && mv.d24) || {}, d7 = (mv && mv.d7) || {};
  const altMc = rows.filter((r) => r.mc > 0 && r.tk !== "BTC" && r.tk !== "ETH" && !r.stable).reduce((s, r) => s + r.mc, 0);
  const domTxt = (x) => (x > 0 ? "→ BTC 쪽으로 쏠림" : x < 0 ? "→ 알트 쪽으로 이동" : "");
  const mrows = [];
  const mr = (name, now_, a24, a7, why, c24, c7, nm) => mrows.push([cell(name, "#e6e0ff", true), tcell(now_, null, true), tcell(a24, c24), tcell(a7, c7), tcell(why || "", C.sub), ]);
  if (mv && mv.ok) {
    const dU = mv.domU || {};
    mr("BTC 도미넌스", !nul(g.btcD) ? g.btcD.toFixed(1) + "%" : !nul(dU.btc) ? "≈" + dU.btc.toFixed(1) + "%" : "–", pp(d24.btc), pp(d7.btc), nul(d7.btc) ? "" : Math.abs(d7.btc) < 0.3 ? "큰 변화 없음" : domTxt(d7.btc), tone(d24.btc), tone(d7.btc));
    mr("ETH 도미넌스", !nul(g.ethD) ? g.ethD.toFixed(1) + "%" : !nul(dU.eth) ? "≈" + dU.eth.toFixed(1) + "%" : "–", pp(d24.eth), pp(d7.eth), "", tone(d24.eth), tone(d7.eth));
    mr("알트 시총 (BTC·ETH 제외)", fmtKrw(altMc * fx), pc(d24.alt), pc(d7.alt), nul(d7.alt) || nul(mv.btc7) ? "" : (d7.alt > (btc ? btc.v.ret7 : 0) ? "BTC보다 빠르게 증가" : "BTC보다 약함"), tone(d24.alt), tone(d7.alt));
    mr("USDT 도미넌스", nul(g.usdtD) ? "–" : g.usdtD.toFixed(1) + "%", "–", "–", "높을수록 관망·위험회피(참고)");
    mr("BTC  vs  알트 중앙값", "BTC " + pc(mv.btc24), "알트 " + pc(mv.alt24), "BTC " + pc(mv.btc7) + " / 알트 " + pc(mv.alt7), nul(mv.alt7) || nul(mv.btc7) ? "" : mv.alt7 - mv.btc7 >= 2 ? "알트가 더 강함" : mv.alt7 - mv.btc7 <= -2 ? "BTC가 더 강함" : "비슷함", C.txt, tone(nul(mv.alt7) || nul(mv.btc7) ? 0 : mv.alt7 - mv.btc7));
    mr("ETH / BTC", "–", "–", pc(mv.ethbtc7), nul(mv.ethbtc7) ? "" : mv.ethbtc7 >= 2 ? "ETH 강세(알트 선행 신호)" : mv.ethbtc7 <= -2 ? "ETH 약세" : "", C.txt, tone(mv.ethbtc7));
    mr("알트시즌 지수", nul(mv.idx30) ? "–" : "30일 " + mv.idx30, "7일 " + (nul(mv.idx7) ? "–" : mv.idx7), "90일 " + (nul(mv.idx90) ? "–" : mv.idx90), "시총 상위 50개 중 BTC를 이긴 비율 · 75↑ 알트시즌 · 25↓ BTC시즌");
    if (mv.fng) mr("공포·탐욕 지수", String(mv.fng.v), mv.fng.prev == null ? "–" : (mv.fng.v - mv.fng.prev >= 0 ? "+" : "") + (mv.fng.v - mv.fng.prev) + " (전일)", "–", KOR_FNG[mv.fng.cls] || mv.fng.cls, tone(mv.fng.prev == null ? 0 : mv.fng.v - mv.fng.prev));
    mr("총 미결제 (OI)", fmtKrw(mv.oiSum * fx), nul(mv.oi24) ? "–" : pc(mv.oi24), "–", nul(mv.oi4) ? "4시간·24시간 변화는 데이터가 쌓이면 표시" : "4시간 " + pc(mv.oi4), tone(mv.oi24));
    mr("펀딩 (OI 가중, 연환산)", nul(mv.fundW) ? "–" : sgn(mv.fundW, 0) + "%", "–", "–", mv.heat + " · 기본선 +11% · 롱과열 " + mv.hotLong + "종 · 숏과열 " + mv.hotShort + "종");
  }
  const mkt = { index: true, title: "시장 국면 · 비트코인 도미넌스", sub: "BTC 강세장인지 알트 강세장인지 · 변화(%p)는 가격 변화로 되돌려 추정", empty: "— BTC 데이터 준비 중 —",
    cols: [["지표", "l"], ["현재", "r"], ["24h", "r"], ["7일", "r"], ["해석", "l"]], rows: mrows,
    notes: mv && mv.ok ? ["▶ 판정: " + mv.verdict.t + (mv.why.length ? "  ·  근거: " + mv.why.join(" · ") : "  ·  뚜렷한 신호 없음"), "규칙 기반 참고 지표(BTC.D·알트 중앙값·알트시즌지수·ETH/BTC) · 매매 권유 아님"] : [] };

  /* ── 대장 코인 ── */
  const lead = ["BTC", "ETH", "SOL", "XRP", "BNB", "HYPE", "DOGE", "ZEC"].map((t) => by[t]).filter(Boolean);
  const leadCols = [["#", "c"], ["종목", "l"], ["이름", "l"]].concat([0, 1, 2, 4, 5, 6, 10, 11, 12].map((i) => [COLS[i][0], COLS[i][1], COLS[i][2]]));
  const leadSec = { index: true, title: "대장 코인", sub: "시총 상위 · 시장 기준", empty: "— 없음 —", cols: leadCols, rows: lead.map((r, i) => [cell(i + 1, "#b9b0ee"), cell(r.tk, "#e6e0ff", true), cell(nameOf(r), "#e6e0ff")].concat([0, 1, 2, 4, 5, 6, 10, 11, 12].map((c) => COLS[c][3](r, o)))) };

  /* ── ★핵심 · 전종목 ── */
  const coreSec = { feature: true, title: "★ 핵심 · 켈상단 + 4H켈중심", sub: core.length + "종목 중 · 양W +2 + 켈상단 + 4H켈중심", empty: "— 지금 조건 충족 코인 없음 —", cols, rows: core.slice().sort(byEok).slice(0, 8).map((r, i) => big(r, i, true)) };
  const sorted = pass.slice().sort((a, b) => (b.v.w - a.v.w) || byEok(a, b)), shown = sorted.slice(0, limit);
  const allSec = { title: "전종목 " + shown.length + (sorted.length > shown.length ? " / " + sorted.length : ""), sub: "코인 " + rows.length + "종 중 양W 0 이상 · 양W 2→1→0 · 그룹 안 대금순" + (sorted.length > shown.length ? " · 상위 " + limit : "") + " · {F}=4H발산 · 청록 줄=★핵심", cols, rowbg: coreBg(shown), rows: shown.map((r, i) => big(r, i, K.isCore(r.v))), empty: "— 조건 충족 코인 없음 —" };

  /* ── TOP 박스 ── */
  const tail = [["양W", "c"], ["켈", "c"], ["4H", "c"]], tailCells = (r) => [K.cW(r.v.w), K.cKel(r.v.kc), K.c4H(r.v)];
  const top = (title, sub, list, mid, midCells, empty) => ({ half: true, title, sub, empty: empty || "— 해당 없음 —", cols: [["#", "c"], ["종목", "l"], ["이름", "l"]].concat(mid, tail), rowbg: coreBg(list), rows: list.map((r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r))].concat(midCells(r), tailCells(r))) });
  const b7 = btc && !nul(btc.v.ret7) ? btc.v.ret7 : 0;
  const t1 = top("① 거래대금 TOP5", pass.length + "종 중", pass.slice().sort(byEok).slice(0, 5), [["24h", "r"], ["억원", "r"], ["시총", "r"]], (r) => [K.pct(r.v.chg), cell(eokText(r.v.eok), null, true), mcCell(r)]);
  const t2 = top("② 24h 등락률 TOP5", "전체 코인 기준", rows.filter((r) => !nul(r.v.chg)).sort((a, b) => b.v.chg - a.v.chg).slice(0, 5), [["24h", "r"], ["억원", "r"], ["펀딩", "r"]], (r) => [K.pct(r.v.chg), cell(eokText(r.v.eok)), fundCell(r.v.apr, hot)]);
  const t3 = top("③ 7일 강세 TOP5 (BTC 대비)", "BTC 7일 " + pc(btc ? btc.v.ret7 : null), rows.filter((r) => r.tk !== "BTC" && !nul(r.v.ret7) && r.v.eok >= 3).sort((a, b) => (b.v.ret7 - b7) - (a.v.ret7 - b7)).slice(0, 5), [["7일", "r"], ["BTC대비", "r"], ["억원", "r"]], (r) => [K.pct(r.v.ret7), K.rel2(r.v.ret7 - b7), cell(eokText(r.v.eok))]);
  const t4 = top("④ 켈상단 돌파 · 대금 TOP5", pass.filter((r) => r.v.kc === 1).length + "종목 중", pass.filter((r) => r.v.kc === 1).sort(byEok).slice(0, 5), [["24h", "r"], ["억원", "r"], ["시총", "r"]], (r) => [K.pct(r.v.chg), cell(eokText(r.v.eok), null, true), mcCell(r)]);
  const t5 = top("⑤ 켈유 TOP5", "켈상단 위 유지 일수", pass.filter((r) => r.v.kelu > 0).sort((a, b) => (b.v.kelu - a.v.kelu) || byEok(a, b)).slice(0, 5), [["켈유", "r"], ["24h", "r"], ["억원", "r"]], (r) => [cell(Math.round(r.v.kelu) + "일", C.mark, true), K.pct(r.v.chg), cell(eokText(r.v.eok))]);
const fd = rows.filter((r) => r.v.oiEok >= 3 && !nul(r.v.apr));
  const t6 = top("⑥ 펀딩 과열 · 롱 쏠림 TOP5", "연환산 · 기본선(+11%)보다 크게 높은 것", fd.filter((r) => r.v.apr - FUND_BASE >= 15).sort((a, b) => b.v.apr - a.v.apr).slice(0, 5), [["펀딩", "r"], ["미결제", "r"], ["24h", "r"]], (r) => [fundCell(r.v.apr, hot), cell(eokText(r.v.oiEok)), K.pct(r.v.chg)], "— 기본선(연 +11%)보다 크게 높은 코인 없음 —");
  const t7 = top("⑦ 펀딩 과열 · 숏 쏠림 TOP5", "연환산 · 기본선보다 크게 낮은 것", fd.filter((r) => r.v.apr - FUND_BASE <= -15).sort((a, b) => a.v.apr - b.v.apr).slice(0, 5), [["펀딩", "r"], ["미결제", "r"], ["24h", "r"]], (r) => [fundCell(r.v.apr, hot), cell(eokText(r.v.oiEok)), K.pct(r.v.chg)], "— 기본선보다 크게 낮은 코인 없음 —");
  const ready = rows.some((r) => !nul(r.v.oi4h));
  const oiList = rows.filter((r) => !nul(r.v.oi4h) && r.v.oiEok >= 3).sort((a, b) => Math.abs(b.v.oi4h) - Math.abs(a.v.oi4h)).slice(0, 5);
  const qcol = (q) => (/롱 유입|숏 청산/.test(q) ? C.up : /숏 유입|롱 청산/.test(q) ? C.dn : C.sub);
  const t8 = { half: true, title: "⑧ 미결제 급변 TOP5 (4시간)", sub: "돈이 들어오나 나가나", empty: ready ? "— 해당 없음 —" : "— 데이터 수집 중 (4시간 뒤부터) —", cols: [["#", "c"], ["종목", "l"], ["이름", "l"], ["OI", "r"], ["가격", "r"], ["해석", "l"], ["미결제", "r"]], rowbg: [], rows: oiList.map((r, i) => [cell(i + 1, C.sub), cell(r.tk, null, true), cell(nameOf(r)), K.pct(r.v.oi4h), K.pct(r.v.ch4h), cell(r.v.quad || "–", qcol(r.v.quad), !!r.v.quad), cell(eokText(r.v.oiEok))]), notes: [] };
  const t9 = top("⑨ 거래대금 급증 TOP5", "24h가 7일 평균의 몇 배", rows.filter((r) => !nul(r.v.volx) && r.v.eok >= 3).sort((a, b) => b.v.volx - a.v.volx).slice(0, 5), [["배수", "r"], ["억원", "r"], ["24h", "r"]], (r) => [cell("×" + r.v.volx.toFixed(1), r.v.volx >= 3 ? C.ok : C.mark, true), cell(eokText(r.v.eok)), K.pct(r.v.chg)]);
  const t10 = top("⑩ 신규 상장 (최근 30일)", "하이퍼리퀴드 기준", rows.filter((r) => r.v.age < 30).sort((a, b) => a.v.age - b.v.age).slice(0, 5), [["상장", "r"], ["24h", "r"], ["시총", "r"]], (r) => [cell(r.v.age + "일차", C.mark, true), K.pct(r.v.chg), mcCell(r)], "— 최근 30일 신규 상장 없음 —");
  const ch1 = rows.filter((r) => !nul(r.v.ch1h)), m1 = median(ch1.map((r) => r.v.ch1h)) || 0;
  const t11 = top("⑪ 급변동 TOP5 (1시간)", ch1.length ? "시장 중앙값 " + pc(m1) + " 대비" : "", ch1.filter((r) => r.v.eok >= 3).map((r) => ({ r, rel: r.v.ch1h - m1 })).filter((x) => Math.abs(x.rel) >= 0.01).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 5).map((x) => Object.assign({}, x.r, { _rel: x.rel })), [["상대변동", "r"], ["1h", "r"], ["억원", "r"]], (r) => [K.rel2(r._rel), K.pct(r.v.ch1h), cell(eokText(r.v.eok))], ch1.length ? "— 시장 대비 튀는 코인 없음 —" : "— 데이터 수집 중 (1시간 뒤부터) —");

  /* ── 분야별 ── */
  const cats = {}; rows.forEach((r) => { (cats[r.cat || "기타"] = cats[r.cat || "기타"] || []).push(r); });
  const crow = Object.entries(cats).map(([c, l]) => ({ c, n: l.length, a24: median(l.map((r) => r.v.chg)), a7: median(l.map((r) => r.v.ret7)), eok: l.reduce((s, r) => s + r.v.eok, 0), lead: l.slice().sort((a, b) => (b.v.chg || -999) - (a.v.chg || -999))[0], strong: l.filter((r) => r.v.w >= 2).length })).sort((a, b) => (b.a24 == null ? -999 : b.a24) - (a.a24 == null ? -999 : a.a24));
  const catSec = { title: "분야별 흐름 · 어디로 돈이 몰리나", sub: "분야별 중앙값 · 24h 강한 순", empty: "— 없음 —", cols: [["#", "c"], ["분야", "l"], ["종목", "r"], ["24h", "r"], ["7일", "r"], ["억원", "r"], ["양W+2", "r"], ["선두", "l"]],
    rowbg: crow.map((x, i) => (i === 0 && x.a24 > 0 ? HOT_ROW : null)),
    rows: crow.map((x, i) => [cell(i + 1, C.sub), cell(x.c, null, true), cell(x.n), K.pct(x.a24), K.pct(x.a7), cell(eokText(x.eok)), cell(x.strong ? String(x.strong) : "–", x.strong ? C.ok : C.no, !!x.strong), cell(x.lead ? x.lead.tk + " " + sgn(x.lead.v.chg) + "%" : "–", x.lead && x.lead.v.chg > 0 ? C.up : C.dn)]) };

  /* ── 최근 진입 ── */
  const seen = new Set(), le = []; for (const e of ent || []) { if (seen.has(e.k)) continue; seen.add(e.k); le.push(e); if (le.length >= 5) break; }
  const recent = { half: true, title: "⑫ 최근 진입 5", sub: "무엇에 진입했나", empty: "— 아직 진입 기록 없음 —", notes: le.length ? ["변화 읽는 법: 왼쪽 = 이전 값, 오른쪽 = 지금 값 · 청록 줄 = 지금 ★핵심"] : [],
    cols: [["#", "c"], ["시각", "l"], ["종목", "l"], ["이름", "l"], ["진입", "c"], ["24h", "r"], ["양W", "c"], ["켈", "c"], ["4H", "c"]] };
  recent.rowbg = le.map((e) => (by[e.k] && K.isCore(by[e.k].v) ? CORE_ROW : null));
  recent.rows = le.map((e, i) => { const r = by[e.k]; return [cell(i + 1, C.sub), cell(K.short(e.t), C.sub), cell(e.k, null, true), cell(r ? nameOf(r) : e.k), K.entryCell(e.kinds), r ? K.pct(r.v.chg) : cell("-", C.sub), r ? K.cW(r.v.w) : cell("-", C.sub), r ? K.cKel(r.v.kc) : dash(), r ? K.c4H(r.v) : dash()]; });

  const fxs = Math.round(fx).toLocaleString("en-US");
  const base = (title, sub2) => ({ title, sub: mdhm(now) + " · 코인 " + rows.length + "종 · 1$=" + fxs + "원 환산 · 억원=한화 · 24h=최근 24시간 · 시총=한화(코인게코) · 펀딩=연환산 · {o}=충족 · {F}=4H 켈트너 상단 위(발산)", sub2 });
  const foot = "데이터: 하이퍼리퀴드 코인(무기한 선물) · 일봉=한국 09:00 기준 · 지표 정의는 주식 데일리 리포트(TM Matrix Screener v48.9)와 동일 · 3일격·5일격=일봉 3·5일 이동평균 이격(%) · kPEPE 등 k=1000개 단위" + (notes ? " · " + notes : "");
  const part1 = { header: base("TM Coin Daily Report · " + hm(now)), sections: [{ kind: "chips", chips }, mkt, leadSec, coreSec, allSec], foot, theme: COIN_THEME,
    caption: "🪙 TM Coin Daily Report · " + hm(now) + " · " + rows.length + "종 · " + (mv && mv.verdict ? mv.verdict.t + " · " : "") + "★핵심 " + core.length + (le.length ? " · 최근 진입 " + le[0].k : "") + "  (1/2)" };
  const part2 = { header: Object.assign(base("TM Coin Daily Report · 계속 (2/2)"), { sub2: undefined }), sections: [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, recent, catSec], foot, theme: COIN_THEME, caption: "🪙 TM Coin Daily Report · " + hm(now) + "  (2/2) TOP · 분야별 · 진입" };
  return { parts: [part1, part2], meta: { n: rows.length, pass: pass.length, core: core.length, shown: shown.length } };
}
