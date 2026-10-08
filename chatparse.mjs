/* 텔레그램 방 글 → 명령/종목 해석 (순수 함수 — 네트워크 없음, 로컬에서 바로 시험 가능)
   1) parseCommand : 도움말·리포트·지금·섹터·시세·지표·설정 변경 같은 '명령어'
   2) parseRequest : 명령어가 아니면 종목/섹터 이름 + 봉·기간 → 차트 요청
   종목: 한글 이름 · 티커 · 줄임말(삼전·마소…) · 이름 일부 / 섹터: 사이트 섹터 이름(부분 일치) */
import { KO } from "./repnames.mjs";

/* 비교용 정규화: 대소문자·공백·기호·이모지 제거 */
export const norm = (s) => String(s || "").toLowerCase().replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/[\s·()\-_.,/\\'"“”‘’!?~:：]/g, "");
export const secName = (s) => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "").trim();   /* '🧠 메모리 대장주' → '메모리 대장주' */

/* 자주 쓰는 줄임말·별명 → 티커(여러 개면 모두) */
const ALIAS = {
  하이닉스: ["SKHYNIX", "SKHY"], sk하이닉스: ["SKHYNIX"], 에스케이하이닉스: ["SKHYNIX"], 삼성: ["SMSN"], 삼전: ["SMSN"], 삼성전자: ["SMSN"], 엔비: ["NVDA"], 엔비디아: ["NVDA"], 마소: ["MSFT"], 마이크로소프트: ["MSFT"],
  구글: ["GOOGL"], 알파벳: ["GOOGL"], 아마존: ["AMZN"], 메타: ["META"], 페북: ["META"], 애플: ["AAPL"], 테슬라: ["TSLA"], 테슬: ["TSLA"], 넷플: ["NFLX"], 넷플릭스: ["NFLX"], 팔란: ["PLTR"], 팔란티어: ["PLTR"], 마이크론: ["MU"], 인텔: ["INTC"], 브로드컴: ["AVGO"], 퀄컴: ["QCOM"], 코인베이스: ["COIN"], 스트래티지: ["MSTR"], 마이크로스트래티지: ["MSTR"],
  나스닥: ["XYZ100"], 나스닥100: ["XYZ100"], 에스앤피: ["SP500"], sp: ["SP500"], snp: ["SP500"], "s&p": ["SP500"], "s&p500": ["SP500"], 코스피: ["KR200"], 코스피200: ["KR200"], 닛케이: ["JP225"], 일본: ["JP225"],
  금: ["GOLD"], 골드: ["GOLD"], 은: ["SILVER"], 실버: ["SILVER"], 구리: ["COPPER"], 원유: ["CL"], wti: ["CL"], 브렌트: ["BRENTOIL"], 브렌트유: ["BRENTOIL"], 천연가스: ["NATGAS"], 백금: ["PLATINUM"], 팔라듐: ["PALLADIUM"],
  금리: ["10Y"], 국채: ["10Y"], 국채금리: ["10Y"], "10년물": ["10Y"], 미국채: ["10Y"],
  비트: ["BTC"], 비트코인: ["BTC"], 이더: ["ETH"], 이더리움: ["ETH"], 솔라나: ["SOL"], 리플: ["XRP"], 도지: ["DOGE"], 도지코인: ["DOGE"], 하이퍼리퀴드: ["HYPE"], 하이퍼: ["HYPE"],
};
/* 섹터 별명: 말 → 섹터 이름에 들어 있어야 하는 조각들 (하나라도 들어 있는 섹터를 모두 묶음) */
const SECTOR_ALIAS = {
  반도체: ["AI칩", "메모리", "네트워크칩", "파운드리"], 메모리: ["메모리"], 칩: ["AI칩", "네트워크칩"], gpu: ["AI칩"], 크립토: ["코인"], 암호화폐: ["코인"], 가상화폐: ["코인"], 코인주: ["코인관련주"],
  빅테크: ["빅테크"], 원자재: ["원자재"], 에너지: ["원자재"], 우주: ["전기차"], 전기차: ["전기차"], 전력: ["전기차"], 로봇: ["중국 AI"], 중국: ["중국 AI"], 바이오: ["바이오"], 헬스: ["바이오"], 소비: ["소비"],
  ai: ["AI칩", "AI SW"], 소프트웨어: ["AI SW"], sw: ["AI SW"], 클라우드: ["AI SW"], 보안: ["AI SW"], 광통신: ["광통신"], 네트워크: ["광통신", "네트워크칩"], 파운드리: ["파운드리"], 장비: ["파운드리"], etf: ["ETF"], 레버리지: ["ETF"], 지수: ["지수"],
};
const IV = { "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h", "8h": "8h", "1d": "1d" };
export const IV_KO = { "15m": "15분", "30m": "30분", "1h": "1시간", "2h": "2시간", "4h": "4시간", "8h": "8시간", "1d": "일봉" };
const FILLER = new Set(["보여줘", "보여줘요", "보여주세요", "보여줄래", "줘", "줘요", "좀", "차트", "chart", "사진", "알려줘", "해줘", "보자", "그림", "의", "랑", "하고", "그리고", "and", "and"].map(norm));
export const SEND_EVERY = [[0, "매번(5분)"], [10, "10분"], [15, "15분"], [30, "30분"], [60, "1시간"], [240, "4시간"], [1440, "하루 1번"]];

/* ───────── 주기·시간 낱말 해석 ───────── */
/* '15분' '1시간' '4시간' '하루' '매번' → 분(0 = 매번) / 끄기 → "off" / 켜기 → "on" / 못 알아들으면 undefined */
export function parseEvery(s) {
  const n = norm(s); let m;
  if (/^(끄기|끔|off|중지|안보냄|그만|정지)$/.test(n)) return "off";
  if (/^(켜기|켬|on|시작|재개)$/.test(n)) return "on";
  if (/^(매번|5분|5m|항상|기본)$/.test(n)) return 0;
  if (/^(하루|하루1번|매일|일1회|1일|24시간)$/.test(n)) return 1440;
  if ((m = /^(\d+)(분|m|min)$/.exec(n))) return +m[1];
  if ((m = /^(\d+)(시간|h|hr)$/.exec(n))) return +m[1] * 60;
  return undefined;
}
/* 허용 칸(0·10·15·30·60·240·1440)에 가장 가까운 값으로 */
export function snapEvery(min) { return SEND_EVERY.reduce((b, x) => (Math.abs(x[0] - min) < Math.abs(b[0] - min) ? x : b))[0]; }
export const everyKo = (m) => (SEND_EVERY.find((x) => x[0] === m) || [m, m + "분"])[1];

/* ───────── 명령어 판별 ─────────
   반환 { cmd, arg } 또는 null.  arg 는 명령어 뒤에 붙은 글(공백 구분 낱말 배열) */
const CMDS = [
  ["help", /^(도움말|도움|help|start|사용법|명령어|메뉴|\?)$/],
  ["sectors", /^(섹터|섹터목록|섹터들|테마|테마목록|테마들|sectors?|themes?)$/],
  ["report", /^(리포트|레포트|report|데일리|데일리리포트)$/],
  ["now", /^(지금|지금보내기|지금전부|전부|전체|now|all)$/],
  ["flow", /^(흐름|흐름차트|가격흐름|flow)$/],
  ["cards", /^(카드|카드전체|카드보내기|cards?)$/],
  ["rank", /^(순위|순위글|rank)$/],
  ["pattern", /^(패턴|패턴리포트|패턴셋업|패턴셋업리포트|셋업|pattern)$/],
  ["status", /^(상태|status|현황)$/],
  ["config", /^(설정|설정보기|설정확인|config|settings?)$/],
  ["mute", /^(조용히|조용|mute|쉿|알림끄기)$/],
  ["unmute", /^(재개|해제|조용해제|unmute|조용히해제|알림켜기)$/],
  ["quote", /^(시세|가격|현재가|quote|px)$/],
  ["indic", /^(지표|분석|indic|info)$/],
  ["listCore", /^(핵심|core)$/],
  ["listHx", /^(발산|4h발산|hx)$/],
  ["listKelu", /^(켈유|켈상단|kelu)$/],
  ["listVol", /^(거래대금|대금|거래량|vol)$/],
  ["listChg", /^(등락|등락률|상승률|급등주|chg)$/],
  ["surge", /^(급등|급변동|급변|surge)$/],
  ["entries", /^(진입|최근진입|entries)$/],
  ["macro", /^(매크로|시황|macro)$/],
  ["fx", /^(환율|fx|달러)$/],
  ["funding", /^(펀딩|펀비|funding)$/],
  ["fundRank", /^(펀딩순위|펀비순위|fundrank)$/],
  ["oiRank", /^(oi순위|미결제순위|미결제|oi|oirank)$/],
  ["resSet", /^(해상도|res|resolution)$/],
  ["miniSet", /^(미니|미니차트|일봉차트|mini)$/],
  ["ivSet", /^(기본봉|봉기본|defaultiv)$/],
  ["dailySet", /^(일봉기간|일봉기본|일봉개수|일봉봉수|일봉수)$/],
  ["daysSet", /^(기본기간|기간기본|defaultdays)$/],
  ["cardAdd", /^(카드추가|카드더하기|cardadd)$/],
  ["cardDel", /^(카드삭제|카드빼기|카드제거|carddel)$/],
  ["cardList", /^(카드목록|카드리스트|cardlist)$/],
  ["cardClear", /^(카드초기화|카드비우기|cardclear)$/],
  ["docSet", /^(원본|원본파일|문서|doc)$/],
  ["rowsSet", /^(리포트줄|줄수|rows)$/],
  ["surgeSet", /^(급변구간|급변동구간|surgeset)$/],
  ["themeAdd", /^(테마추가|테마만들기|테마저장|themeadd)$/],
  ["themeDel", /^(테마삭제|테마제거|themedel)$/],
];
const INTERVAL_OWNERS = { report: "report", flow: "flow", cards: "cards", rank: "rank", pattern: "pattern" };
export function parseCommand(text) {
  let t = String(text || "").trim().replace(/^\/+/, "").replace(/@\w+/g, " ").replace(/[\p{Extended_Pictographic}️‍]/gu, " ").trim();
  if (!t) return null;
  const words = t.split(/[\s,，、]+/).filter(Boolean);
  const w1 = norm(words[0]), rest = words.slice(1);
  /* 두 낱말을 붙인 명령(카드 추가 / oi 순위 / 펀딩 순위 …) */
  if (rest.length) {
    const joined = norm(words[0] + words[1]);
    for (const [cmd, re] of CMDS) if (/^(카드추가|카드삭제|카드목록|카드초기화|펀딩순위|oi순위|테마추가|테마삭제|리포트줄|급변구간|기본봉|기본기간|일봉기간|일봉기본)$/.test(joined) && re.test(joined)) return { cmd, arg: words.slice(2) };
  }
  for (const [cmd, re] of CMDS) {
    if (!re.test(w1)) continue;
    if (INTERVAL_OWNERS[cmd] && rest.length) {
      /* '리포트 30분' '카드 끄기' = 주기 변경. 그 밖의 뒤따르는 글('카드 메타')은 아래 종목 해석으로 넘김 */
      const ev = parseEvery(rest[0]);
      if (ev !== undefined && rest.length === 1) return { cmd: "every", target: INTERVAL_OWNERS[cmd], value: ev };
      return null;
    }
    if (cmd === "now" && rest.length) return null;
    if (["help", "status", "config", "sectors"].includes(cmd) || rest.length === 0 || ["quote", "indic", "surge", "funding", "mute", "resSet", "miniSet", "ivSet", "daysSet", "dailySet", "docSet", "rowsSet", "surgeSet", "themeAdd", "themeDel", "cardAdd", "cardDel"].includes(cmd)) return { cmd, arg: rest };
    return null;   /* 예) '핵심 종목들' 처럼 뒤에 낱말이 붙은 건 일반 요청으로 */
  }
  return null;
}

/* ───────── 종목 색인 ─────────
   { ticker → { names:Set(정규화된 이름들), sector } } — info(사이트 관심종목·한글 이름), uniShorts(HL 전체 티커) */
export function buildIndex(info, uniShorts, extraTickers) {
  const idx = new Map();
  const add = (t, name) => { if (!t) return; const e = idx.get(t) || { names: new Set(), sector: "" }; if (name) e.names.add(norm(name)); idx.set(t, e); };
  (info.watch || []).forEach(([sec, items]) => items.split(",").forEach((t) => { if (!t) return; add(t); idx.get(t).sector = secName(sec); }));
  Object.entries(info.koFull || info.ko || {}).forEach(([t, nm]) => { if (idx.has(t)) add(t, nm); });
  Object.entries(KO).forEach(([t, d]) => { const tk = Object.keys(info.alias || {}).find((k) => info.alias[k] === t) || t; if (idx.has(tk)) { const nm = d.split(" · ")[0]; add(tk, nm.replace(/\(.*?\)/g, "")); add(tk, nm); } });
  (uniShorts || []).forEach((t) => { if (!idx.has(t)) add(t); });   /* 관심종목에 없어도 하이퍼리퀴드에 있으면 티커로 */
  (extraTickers || []).forEach((t) => { if (!idx.has(t)) add(t); });
  return idx;
}

/* 한 낱말 → 종목 후보 { list:[티커…], how:"별명|티커|이름|앞글자|포함" , strong:bool }  (strong = 확실한 일치) */
export function resolveToken(tok, idx, strongOnly) {
  const n = norm(tok);
  if (!n) return { list: [] };
  if (ALIAS[n]) { const l = ALIAS[n].filter((t) => idx.has(t)); if (l.length) return { list: l, how: "별명", strong: true }; }
  const up = [...idx.keys()].find((t) => norm(t) === n);   /* 티커(대소문자 무시) */
  if (up) return { list: [up], how: "티커", strong: true };
  const exact = [], pre = [], sub = [];
  idx.forEach((e, t) => { let best = 0; e.names.forEach((nm) => { if (nm === n) best = Math.max(best, 3); else if (nm.startsWith(n) && n.length >= 2) best = Math.max(best, 2); else if (n.length >= 3 && nm.includes(n)) best = Math.max(best, 1); }); if (best === 3) exact.push(t); else if (best === 2) pre.push(t); else if (best === 1) sub.push(t); });
  if (exact.length) return { list: exact.slice(0, 3), how: "이름", strong: true };
  if (strongOnly) return { list: [] };
  if (pre.length) return { list: pre.slice(0, 3), how: "앞글자", ambiguous: pre.length > 1 };
  if (sub.length) return { list: sub.slice(0, 3), how: "포함", ambiguous: sub.length > 1 };
  return { list: [] };
}

/* 섹터 이름(정확 > 앞부분 > 포함 순) → 같은 등급에 든 섹터들 (예: '메모리' → 메모리 대장주 + 메모리 중소·해외).  반환 [{name, tickers}] 또는 null */
export function resolveSectors(text, info, custom) {
  const q = norm(text); if (q.length < 2) return null;
  const all = (info.watch || []).map(([sec, items]) => ({ name: secName(sec), tickers: items.split(",").filter(Boolean), n: norm(secName(sec)) }));
  Object.entries(custom || {}).forEach(([nm, tickers]) => all.push({ name: nm, tickers, n: norm(nm), mine: true }));
  const exact = all.filter((s) => s.n === q);
  if (exact.length) return exact;
  /* 괄호 앞부분(예: 'AI칩 대장 (GPU·CPU·설계)' → 'ai칩대장') 도 이름으로 인정 */
  const core = (s) => norm(s.name.replace(/\(.*?\)/g, ""));
  const ex2 = all.filter((s) => core(s) === q);
  if (ex2.length) return ex2;
  const pre = all.filter((s) => s.n.startsWith(q) || core(s).startsWith(q));
  if (pre.length) return pre;
  const al = SECTOR_ALIAS[q];
  if (al) { const l = all.filter((s) => al.some((a) => s.name.toLowerCase().includes(a.toLowerCase()))); if (l.length) return l; }
  if (q.length >= 3) { const inc = all.filter((s) => s.n.includes(q)); if (inc.length) return inc; }
  return null;
}

/* 글 전체 해석: 반환 { tickers:[], iv, days, notes:[], misses:[], sectors:[이름…], asCards, asTable } */
export function parseRequest(text, idx, info, custom) {
  const out = { tickers: [], iv: null, days: null, notes: [], misses: [], sectors: [], asCards: false, asTable: false };
  let t = String(text || "").trim().replace(/^\/+/, "").replace(/@\w+/g, " ").replace(/[\p{Extended_Pictographic}️‍]/gu, " ");
  const left = [];
  t.split(/[\s,，、]+/).filter(Boolean).forEach((w) => {
    const x = w.toLowerCase();
    let m;
    if (/^(일봉|1d|d)$/.test(x)) { out.iv = "1d"; return; }
    if (/^(카드|cards?)$/.test(x)) { out.asCards = true; return; }
    if (/^(표|테이블|목록|table)$/.test(x)) { out.asTable = true; return; }
    if ((m = /^(\d+)(m|분|분봉)$/.exec(x))) { const v = m[1] + "m"; if (IV[v]) out.iv = v; else out.notes.push(m[1] + "분봉은 없어요(15분·30분만)"); return; }
    if ((m = /^(\d+)(h|시간|시간봉)$/.exec(x))) { const v = m[1] + "h"; if (IV[v]) out.iv = v; else out.notes.push(m[1] + "시간봉은 없어요(1·2·4·8시간)"); return; }
    if ((m = /^(\d+)(d|일)$/.exec(x))) { out.days = Math.min(150, Math.max(3, +m[1])); return; }
    if ((m = /^(\d+)(주|w)$/.exec(x))) { out.days = Math.min(150, Math.max(3, +m[1] * 7)); return; }
    if (FILLER.has(norm(w))) return;
    left.push(w);
  });
  const used = new Set(), seenT = new Set(), seenS = new Set();
  const take = (list) => list.forEach((tk) => { if (!seenT.has(tk)) { seenT.add(tk); out.tickers.push(tk); } });
  const takeSec = (secs) => secs.forEach((s) => { if (!seenS.has(s.name)) { seenS.add(s.name); out.sectors.push(s.name); take(s.tickers); } });
  for (let i = 0; i < left.length; i++) {
    if (used.has(i)) continue;
    let done = false;
    /* 1단계: 긴 묶음부터 '확실한' 종목(별명·티커·정확한 이름) 또는 섹터 — 섹터가 어설픈 종목 부분일치보다 우선 */
    for (let len = Math.min(4, left.length - i); len >= 1 && !done; len--) {
      const phrase = left.slice(i, i + len).join("");
      const r = resolveToken(phrase, idx, true);
      if (r.list.length) { take(r.list); for (let k = 0; k < len; k++) used.add(i + k); done = true; continue; }
      const secs = resolveSectors(phrase, info, custom);
      if (secs && (len > 1 || norm(phrase).length >= 2)) { takeSec(secs); for (let k = 0; k < len; k++) used.add(i + k); done = true; }
    }
    /* 2단계: 어설픈 일치(앞글자·포함) */
    if (!done) {
      const r = resolveToken(left[i], idx, false);
      if (r.list.length) { take(r.list); used.add(i); if (r.ambiguous) out.notes.push("'" + left[i] + "'는 비슷한 종목이 여럿이라 " + r.list.join("·") + " 를 보냈어요"); }
      else { out.misses.push(left[i]); used.add(i); }
    }
  }
  return out;
}

/* 하이퍼리퀴드에서 봉 개수가 모자라 못 보여주는 조합 안내용 */
export const MAX_CARDS = 8, MAX_TABLE = 40;
