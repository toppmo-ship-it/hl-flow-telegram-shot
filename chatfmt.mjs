/* 텔레그램 챗봇 글 꾸미기 (순수 함수 — HTML 모드로 보냄. 사용자가 쓴 글·종목 이름은 반드시 esc() 로 감쌈) */
import { IV_KO, everyKo, secName } from "./chatparse.mjs";

export const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nul = (x) => x == null || Number.isNaN(x);
const KST = 9 * 3600e3, p2 = (n) => String(n).padStart(2, "0");
export const hm = (ms) => { const d = new Date(ms + KST); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); };
export const mdhm = (ms) => { const d = new Date(ms + KST); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + hm(ms); };
export const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 90 ? s + "초 전" : s < 5400 ? Math.round(s / 60) + "분 전" : s < 172800 ? (s / 3600).toFixed(1).replace(/\.0$/, "") + "시간 전" : Math.round(s / 86400) + "일 전"; };
const num = (n) => Math.round(n).toLocaleString("en-US");
export const eok = (e) => (nul(e) ? "-" : Math.abs(e) >= 9.95 ? num(e) : e.toFixed(1));
export const fmtPx = (p) => (nul(p) ? "-" : p >= 10000 ? num(p) : p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toPrecision(3));
const sgn = (x, d) => (nul(x) ? "-" : (x > 0 ? "+" : "") + x.toFixed(d == null ? 2 : d));
const arrow = (x) => (nul(x) || x === 0 ? "▫️" : x > 0 ? "🔺" : "🔽");
const wTxt = (w) => (nul(w) ? "-" : w > 0 ? "+" + w : String(w));
const ok = (b) => (b ? "✅" : "▫️");
const isRate = (tk) => tk === "10Y";
const chgTxt = (r) => (isRate(r.tk) ? (nul(r.v.px) || nul(r.v.prev) ? "-" : sgn((r.v.px - r.v.prev) * 100, 1) + "bp") : sgn(r.v.chg) + "%");
const pxTxt = (r) => (isRate(r.tk) ? (nul(r.v.px) ? "-" : r.v.px.toFixed(3) + "%") : fmtPx(r.v.px));
const nm = (r) => (r.name && r.name !== r.tk ? " · " + esc(r.name.replace(/\(.*?\)/g, "").trim()) : "");

/* 가격·지표 한눈에 (시세 명령) */
export function quoteBlock(r) {
  const v = r.v;
  const flags = ["양W " + wTxt(v.w), "켈 " + (v.kc === 1 ? "✅" + (v.kelu > 0 ? " " + Math.round(v.kelu) + "일" : "") : "▫️"), "4H중심 " + ok(v.h4m === 1), "발산 " + ok(v.h4u === 1), "VWAP " + wTxt(v.vwap)];
  return "📈 <b>" + esc(r.tk) + "</b>" + nm(r) + (r.sec && r.sec !== "-" ? "  <i>(" + esc(r.sec) + ")</i>" : "") + "\n💰 " + pxTxt(r) + "  " + arrow(isRate(r.tk) ? (v.px - v.prev) : v.chg) + " " + chgTxt(r) + (isRate(r.tk) ? "" : "  · 대금 " + eok(v.eok) + "억원") + "\n" + flags.join(" · ");
}
/* 지표 전체 값 (지표 명령) */
export function indicBlock(r) {
  const v = r.v;
  const sq = ["없음", "수축(대기)", "해제 임박", "해제+돌파"][v.sqz] || v.sqz;
  const L = [
    "🔬 <b>" + esc(r.tk) + "</b>" + nm(r) + (r.sec && r.sec !== "-" ? "  <i>(" + esc(r.sec) + ")</i>" : ""),
    "💰 " + pxTxt(r) + "  " + arrow(isRate(r.tk) ? (v.px - v.prev) : v.chg) + " " + chgTxt(r) + (isRate(r.tk) ? "" : "  · 거래대금 " + eok(v.eok) + "억원"),
    "",
    "<b>일봉</b>",
    "• 양W(%R 14/48): <b>" + wTxt(v.w) + "</b>  (−2 약세 ~ +2 강세)",
    "• 켈트너 상단: " + (v.kc === 1 ? "돌파 중 · <b>켈유 " + Math.round(v.kelu) + "일</b>" : "아래") + " · 이격 " + sgn(v.gap, 1) + "%",
    "• 파워(몸통 위치): " + (nul(v.pwr) ? "-" : v.pwr) + " · RV구간 " + v.rv + "/5 · 스퀴즈 " + v.sqz + "(" + sq + ")",
    "• 종배 " + (v.jb === 1 ? "✅" : "▫️") + " · 누적T(6일) " + (nul(v.cumT) ? "-" : v.cumT),
    "",
    "<b>4시간</b>",
    "• 켈트너 중심 " + ok(v.h4m === 1) + " · 상단 위(발산) " + ok(v.h4u === 1) + " · 상단 이격 " + sgn(v.h4g, 1) + "%",
    "",
    "<b>단기(15·30분)</b>",
    "• 3격 " + sgn(v.g3, 1) + "% · 5격 " + sgn(v.g5, 1) + "%  (15분 60·120선 이격)",
    "• 듀얼 선15 " + ok(v.d15s === 1) + " · 듀15 " + ok(v.d15 === 1) + " · 듀30 " + ok(v.d30 === 1),
    "• 당일 VWAP 점수 " + wTxt(v.vwap) + "  (−2 ~ +2)",
  ];
  return L.join("\n");
}
/* 줄 목록 (핵심·발산·켈유·거래대금·등락) */
export function listLines(title, sub, rows, extra) {
  if (!rows.length) return "<b>" + title + "</b>\n— 지금 해당하는 종목이 없어요 —";
  const L = ["<b>" + title + "</b>" + (sub ? "  <i>" + sub + "</i>" : "")];
  rows.forEach((r, i) => L.push((i + 1) + ". <b>" + esc(r.tk) + "</b>" + nm(r) + "  " + (isRate(r.tk) ? "" : arrow(r.v.chg) + sgn(r.v.chg) + "%  ") + eok(r.v.eok) + "억" + (extra ? "  " + extra(r) : "")));
  return L.join("\n");
}
export const tag = (r) => "양W" + wTxt(r.v.w) + (r.v.kc === 1 ? " 켈" : "") + (r.v.h4m === 1 ? " 4H" : "") + (r.v.h4u === 1 ? " 발산" : "");

/* 진입 기록 한 줄 */
export function entryLine(e, byTk) {
  const r = byTk && byTk[e.k];
  const kinds = (e.kinds || []).map((x) => {
    if (x.startsWith("발산")) return "4H 발산 진입";
    if (x.startsWith("양W:")) { const [q, f] = x.slice(3).split(">"); const t = (z) => (z === "?" ? "?" : +z > 0 ? "+" + z : String(z)); return "양W " + t(q) + "→" + t(f); }
    if (x.startsWith("켈")) return "켈상단 돌파";
    if (x.startsWith("4H")) return "4H 켈중심 위";
    return x === "핵심" ? "★핵심" : x;
  }).join(" · ");
  return "<b>" + esc(e.k) + "</b>" + (r ? nm(r) : "") + "  " + esc(kinds) + "  <i>" + mdhm(e.t) + "</i>";
}

/* ───────── 도움말 ───────── */
const CAT = {
  chart: (c) => [
    "📈 <b>차트 보기</b>",
    "종목 이름이나 티커만 쓰면 카드 차트가 와요 (한 번에 최대 8개)",
    "",
    "<code>메타</code>",
    "<code>sk하이닉스 메타 애플</code>",
    "<code>삼전 마소 엔비 구글</code>  ← 줄임말도 OK",
    "",
    "<b>봉·기간을 같이 쓰면 그때만 바뀌어요</b>",
    "안 쓰면 설정값 그대로: <b>" + (IV_KO[c.cardIv || "4h"] || c.cardIv) + "봉 · " + (c.cardDays || 60) + "일</b>",
    "<code>메타 15분</code>   <code>메타 일봉</code>",
    "<code>메타 1시간 30일</code>   <code>메타 일봉 90일</code>",
    "<code>sk하이닉스 일봉</code> → 일봉 " + (c.cardDailyDays || 120) + "개 (설정값)",
    "봉: 15분 · 30분 · 1시간 · 2시간 · 4시간 · 8시간 · 일봉",
    "",
    "카드 밑 버튼(15분·30분·1시간·2시간·4시간·일봉)을 눌러도 바로 바뀌어요",
  ].join("\n"),
  sector: () => [
    "🗂 <b>섹터·테마</b>",
    "섹터 이름을 쓰면 그 종목들을 <b>표 한 장</b>으로 보여줘요",
    "<code>메모리 대장주</code>   <code>광통신</code>   <code>코인관련주</code>",
    "<code>반도체</code>   <code>크립토</code>   <code>우주</code>  ← 별명도 OK",
    "",
    "카드로 받으려면 뒤에 <b>카드</b> (최대 8장)",
    "<code>메모리 대장주 카드</code>",
    "",
    "<code>섹터</code> → 섹터 목록 (버튼으로 바로 열기)",
    "",
    "<b>내 테마 만들기</b>",
    "<code>테마추가 내픽 NVDA 메타 애플</code>",
    "<code>내픽</code> ← 이제 이 이름으로 부르면 돼요",
    "<code>테마삭제 내픽</code>",
  ].join("\n"),
  query: () => [
    "🔎 <b>조회</b> (글로 바로 답해요)",
    "<code>시세 메타 애플</code> — 가격·등락·핵심 지표 한눈에",
    "<code>지표 메타</code> — 지표 전체 값",
    "",
    "<b>조건별 TOP10</b>",
    "<code>핵심</code> ★핵심(양W+2·켈상단·4H중심)",
    "<code>발산</code> 4H 켈트너 발산",
    "<code>켈유</code> 켈상단 유지 일수 순",
    "<code>거래대금</code>  <code>등락</code>",
    "<code>급등 30분</code> 시장 대비 급변동",
    "<code>진입</code> 최근 진입 5",
    "",
    "<code>매크로</code> 지수·원자재·금리",
    "<code>환율</code>",
    "<code>펀딩 BTC</code>  <code>펀딩순위</code>  <code>OI순위</code>",
  ].join("\n"),
  alert: () => [
    "🔔 <b>알림</b> — 조건이 맞으면 <b>일봉 차트 사진</b>과 함께 와요",
    "",
    "<b>① 내 종목 알림</b> (한 번 울리면 사라져요)",
    "<code>알림 메타 700</code> — 그 가격에 닿으면",
    "<code>알림 메타 +3%</code> / <code>-3%</code> / <code>±5%</code> — 지금 가격에서 변하면",
    "카드 사진 밑 <b>🔔 알림</b> 버튼 → 버튼만 눌러서 만들기",
    "<code>알림목록</code>  <code>알림삭제 1</code>  <code>알림삭제 메타</code>  <code>알림삭제 전체</code>",
    "",
    "<b>② 자동 알림</b> (전체 종목 감시 · 3분마다)",
    "켈상단 돌파 · 양W +2 도달 · ★핵심 진입 · 4H 발산/중심 진입 · 거래대금 급증 · 급변동 · 모든 진입",
    "<code>알림설정</code> — 버튼으로 켜고 끄기 (설정 페이지 위쪽 '텔레그램 알림 설정'과 같은 값)",
    "<code>켈알림 끄기</code>  <code>양W알림 켜기</code>  <code>대금알림 5배</code>  <code>급변동알림 3% 30분</code>  <code>자동알림 끄기</code>",
    "<code>알림테스트</code> — 알림이 어떻게 오는지 미리 보기",
  ].join("\n"),
  send: () => [
    "📤 <b>보내기</b> (설정된 사진을 지금 받기)",
    "<code>리포트</code> TM Daily Report",
    "<code>흐름</code> 가격흐름 사진",
    "<code>카드</code> 설정해 둔 종목 카드 전부",
    "<code>순위</code> 순위 글(거래대금·급증)",
    "<code>패턴</code> 패턴 셋업 리포트",
    "<code>지금</code> 위의 모든 사진 + 주기를 지금부터 새로 시작",
    "",
    "<code>상태</code> 마지막 발송·다음 발송",
    "<code>조용히 1시간</code>  주기 발송 잠깐 쉬기",
    "<code>재개</code>",
  ].join("\n"),
  set: () => [
    "⚙️ <b>설정 바꾸기</b> (설정 페이지와 같은 값이에요)",
    "<code>설정</code> — 지금 설정 보기",
    "",
    "<b>보내는 주기</b>  (끄기 · 10분 · 15분 · 30분 · 1시간 · 4시간 · 하루)",
    "<code>리포트 30분</code>   <code>리포트 끄기</code>",
    "<code>카드 1시간</code>   <code>흐름 4시간</code>   <code>순위 하루</code>",
    "<code>패턴 1시간</code>   <code>패턴 끄기</code>   <code>패턴 켜기</code>  (패턴은 매번·1시간·4시간·하루)",
    "",
    "<b>사진 모양</b>",
    "<code>해상도 폴드</code> · <code>펼침</code> · <code>PC</code>",
    "<code>미니 끄기</code> <code>미니 켜기</code> <code>미니 90</code>  (일봉 미니차트)",
    "<code>기본봉 4시간</code>  <code>기본기간 5일</code>  (분·시간봉 차트)",
    "<code>일봉기간 90</code>  (큰 일봉 차트 개수: 30·60·90·120·150, 기본 120 · 설정 페이지와 같은 값)",
    "<code>원본 끄기</code> (원본 PNG 파일)  <code>리포트줄 60</code>  <code>급변구간 30</code>",
    "",
    "<b>자동으로 오는 카드 종목</b>",
    "<code>카드추가 메타 애플</code>   <code>카드삭제 메타</code>",
    "<code>카드목록</code>   <code>카드초기화</code>",
  ].join("\n"),
};
export const helpMain = (c) => [
  "🤖 <b>선구안 봇</b>",
  "종목 이름만 쓰면 차트가 와요. 아래 버튼으로 사용법을 골라보세요 👇",
  "",
  "예)  <code>메타</code>  ·  <code>메타 4시간</code>  ·  <code>메모리 대장주</code>  ·  <code>리포트</code>  ·  <code>핵심</code>",
  "",
  "<i>/ 를 누르면 명령 메뉴가 떠요 · 아래 키보드 버튼으로도 쓸 수 있어요</i>",
].join("\n");
export const helpCat = (k, c) => (CAT[k] ? CAT[k](c || {}) : helpMain(c));
export const helpButtons = () => ({ inline_keyboard: [
  [{ text: "📈 차트 보기", callback_data: "h:chart" }, { text: "🗂 섹터·테마", callback_data: "h:sector" }],
  [{ text: "🔎 조회", callback_data: "h:query" }, { text: "📤 보내기", callback_data: "h:send" }],
  [{ text: "🔔 알림", callback_data: "h:alert" }, { text: "⚙️ 설정 바꾸기", callback_data: "h:set" }],
] });
export const helpBack = () => ({ inline_keyboard: [[{ text: "◀ 처음으로", callback_data: "h:main" }]] });
/* 화면 아래 고정 키보드(한 번 누르면 바로 실행) */
export const replyKeyboard = () => ({ keyboard: [["📋 리포트", "📈 흐름", "🃏 카드"], ["🔥 핵심", "🌐 매크로", "🗂 섹터"], ["📤 지금", "📊 상태", "❓ 도움말"]], resize_keyboard: true, is_persistent: true, input_field_placeholder: "종목 이름을 쓰세요  예) 메타 4시간" });
/* 텔레그램 '/' 메뉴 */
export const MENU = [
  ["help", "도움말 · 명령어 안내"], ["sectors", "섹터·테마 목록"], ["report", "리포트 사진 받기"], ["flow", "가격흐름 사진 받기"], ["cards", "설정한 종목 카드 받기"], ["rank", "순위 글 받기"], ["pattern", "패턴 셋업 리포트 받기"],
  ["now", "설정된 사진 전부 지금 받기"], ["core", "★핵심 종목"], ["hx", "4H 발산 종목"], ["macro", "지수·원자재·금리"], ["entries", "최근 진입"], ["surge", "급변동 TOP"], ["fx", "환율"],
  ["status", "마지막·다음 발송 상태"], ["config", "현재 설정 보기"], ["alerts", "알림 목록·등록"], ["mute", "조용히 (주기 발송 잠깐 쉬기)"], ["unmute", "다시 켜기"],
];

/* 섹터 목록 글 + 버튼 */
export function sectorList(info, custom, alias) {
  const L = ["🗂 <b>섹터·테마 목록</b>", "이름을 그대로 쓰면 표 한 장으로, 뒤에 <b>카드</b>를 붙이면 카드로 와요", ""];
  info.watch.forEach(([name, items]) => { L.push(esc(name) + "  <i>" + items.split(",").filter(Boolean).length + "종목</i>"); });
  const cs = Object.entries(custom || {});
  if (cs.length) { L.push("", "⭐ <b>내 테마</b>"); cs.forEach(([n, t]) => L.push("⭐ " + esc(n) + "  <i>" + t.length + "종목</i>")); }
  L.push("", "<i>별명:</i> 반도체 · 크립토 · 우주 · 로봇 · 클라우드 · 에너지 · 지수 · ETF …", "<i>예)</i> <code>반도체</code>  <code>메모리 대장주 카드</code>");
  return L.join("\n");
}
export function sectorButtons(info, custom) {
  const b = info.watch.map(([name], i) => ({ text: name.replace(/\s*\(.*?\)/g, "").slice(0, 16), callback_data: "s:" + i }));
  Object.keys(custom || {}).forEach((n, i) => b.push({ text: "⭐ " + n.slice(0, 14), callback_data: "u:" + i }));
  const rows = []; for (let i = 0; i < b.length; i += 2) rows.push(b.slice(i, i + 2));
  return { inline_keyboard: rows };
}
/* 카드 밑 '봉 바꾸기' 버튼 */
export const cardButtons = (tk, cur) => { const al = [{ text: "🔔 알림 (가격·변동 / 자동 알림)", callback_data: "a:m:" + tk }]; const b = [["15m", "15분"], ["30m", "30분"], ["1h", "1시간"], ["2h", "2시간"], ["4h", "4시간"], ["1d", "일봉"]].map(([iv, t]) => ({ text: (iv === cur ? "● " : "") + t, callback_data: "z:" + tk + ":" + iv })); return { inline_keyboard: [b.slice(0, 3), b.slice(3), al] }; };

/* ───────── 설정·상태 글 ───────── */
const RESN = { fcover: "폴드 접힘(세로)", fwide: "폴드 펼침(가로)", pcxl: "PC 16:9" };
export function configText(c, mute, themes, prefs) {
  const rankOn = [c.rankWeekly ? "거래대금" : "", c.rankSurge ? "급증" : "", c.rankPattern !== false ? "패턴확률" : ""].filter(Boolean);
  const cards = Array.isArray(c.cards) ? c.cards : [];
  const L = [
    "⚙️ <b>현재 설정</b>  <i>(설정 페이지와 같은 값)</i>",
    "",
    "📋 리포트: " + (c.rep === false ? "<b>끔</b>" : "<b>" + everyKo(c.repEvery != null ? +c.repEvery : 15) + "</b>마다") + " · 줄 " + (c.repRows || 45) + " · 급변구간 " + (c.repSurge || 15) + "분",
    "📈 가격흐름: <b>" + everyKo(c.flowEvery != null ? +c.flowEvery : 0) + "</b>마다 · " + (c.frame || "20D") + " · " + (c.iv || "15m") + "봉",
    "🃏 카드: " + (cards.length ? "<b>" + cards.length + "장</b> (" + esc(cards.slice(0, 8).join(", ")) + (cards.length > 8 ? " …" : "") + ")" : "<b>없음</b>") + " · " + everyKo(c.cardEvery != null ? +c.cardEvery : 0) + "마다",
    "     기본 " + (IV_KO[c.cardIv || "4h"] || c.cardIv) + "봉 · " + (c.cardDays || 60) + "일 · 일봉 미니 " + (c.cardDaily === false ? "끔" : "켬(" + (c.cardDailyBars || 60) + "개)"),
    "     큰 일봉 차트(종목 일봉): " + (c.cardDailyDays || 120) + "개 (미니와 별개)",
    "📑 순위글: " + ((c.rankWeekly || c.rankSurge) ? esc([c.rankWeekly ? "거래대금" : "", c.rankSurge ? "급증" : ""].filter(Boolean).join("+")) + " · " + everyKo(c.rankEvery != null ? +c.rankEvery : 0) + "마다" : "끔"),
    "🧩 패턴 셋업 리포트: " + (c.rankPattern !== false ? "<b>" + everyKo(c.rankPatEvery != null ? +c.rankPatEvery : 60) + "</b>마다" : "<b>끔</b>"),
    "🖼 해상도: " + (RESN[c.res] || RESN.fwide) + " · 원본 파일 " + (c.doc === false ? "끔" : "함께"),
    "🔕 조용히: " + (mute && +mute.until > Date.now() ? "<b>" + mdhm(+mute.until) + " KST 까지</b>" : "아님"),
  ];
  const th = Object.keys(themes || {}); if (th.length) L.push("⭐ 내 테마: " + esc(th.join(", ")));
  return L.join("\n");
}
export function statusText({ last, st, cfg, mute, up, snapAge, bars }) {
  const L = ["📊 <b>상태</b>", ""];
  const row = (label, t, every) => {
    if (!t) return label + ": 기록 없음";
    const nx = every ? t + every * 60000 : null;
    return label + ": " + hm(t) + " (" + ago(t) + ")" + (nx ? " → 다음 약 " + hm(Math.max(nx, Date.now())) : "");
  };
  if (last) {
    L.push(row("📋 리포트", last.rep, cfg.rep === false ? 0 : (cfg.repEvery != null ? +cfg.repEvery : 15)) + (cfg.rep === false ? " (끔)" : ""));
    L.push(row("📈 흐름", last.flow, +cfg.flowEvery || 5));
    L.push(row("🃏 카드", last.cards, +cfg.cardEvery || 5));
    L.push(row("📑 순위", last.rank, +cfg.rankEvery || 0));
    L.push(row("🧩 패턴", last.pat, cfg.rankPattern === false ? 0 : (cfg.rankPatEvery != null ? +cfg.rankPatEvery : 60)) + (cfg.rankPattern === false ? " (끔)" : ""));
  } else L.push("발송 기록이 아직 없어요");
  if (st && st.done) L.push("", "⛓ 사슬 마지막 실행: " + (st.state === "error" ? "❌ 오류" : "✅ 정상") + " · " + hm(st.done) + " (" + ago(st.done) + ") · #" + esc(st.run));
  L.push("🔕 조용히: " + (mute && +mute.until > Date.now() ? "<b>" + mdhm(+mute.until) + " KST 까지</b>" : "아님"));
  L.push("", "🤖 챗봇 켜진 지 " + ago(up).replace(" 전", "") + (bars ? " · 시세 " + bars.ok + "/" + bars.total + "종목 준비" : "") + (snapAge != null ? " · 마지막 계산 " + ago(snapAge) : ""));
  return L.join("\n");
}

/* 환율 */
export const fxText = (usd, extra) => ["💱 <b>환율</b>", "1달러 = <b>" + num(usd) + "원</b>", ...extra].join("\n");
