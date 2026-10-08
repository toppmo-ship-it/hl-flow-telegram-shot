/* 하이퍼 리포트용 종목 한글 이름 · 섹터 사전 (탬퍼몽키 스크리너의 사전을 그대로 옮김)
   값 형식: '이름 · 섹터' — 앞이 이름, 뒤가 섹터. 사전에 없으면 사이트(site/flow-data.js)의 이름·섹터로 보충 */
export const KO = {
  // 반도체·메모리
  NVDA: "엔비디아 · AI반도체", AMD: "AMD · CPU/GPU", INTC: "인텔 · 반도체", MU: "마이크론 · 메모리반도체",
  SNDK: "샌디스크 · 낸드메모리", WDC: "웨스턴디지털 · 저장장치", SKHX: "SK하이닉스 · 메모리반도체(본주)",
  SKHY: "SK하이닉스 ADR · 메모리반도체(나스닥)", SMSN: "삼성전자 · 메모리반도체", SAMSUNG: "삼성전자 · 메모리반도체",
  TSM: "TSMC · 파운드리", ASML: "ASML · 노광장비", AMAT: "어플라이드머티리얼즈 · 반도체장비", AVGO: "브로드컴 · AI네트워크칩",
  QCOM: "퀄컴 · 모바일칩", ARM: "ARM · 칩설계", MRVL: "마벨 · 데이터센터칩", CXMT: "창신메모리(CXMT) · 中 D램",
  IBIDEN: "이비덴 · 반도체기판(日)", SMCI: "슈퍼마이크로 · AI서버", LRCX: "램리서치 · 반도체장비", KLAC: "KLA · 반도체검사장비",
  TXN: "텍사스인스트루먼트 · 아날로그칩", ON: "온세미 · 전력반도체", ANET: "아리스타 · 데이터센터네트워크",
  // 광통신·AI인프라
  AAOI: "어플라이드옵토 · 광트랜시버", LITE: "루멘텀 · 광통신부품", COHR: "코히런트 · 광통신", CRWV: "코어위브 · AI클라우드",
  NBIS: "네비우스 · AI클라우드", IREN: "아이렌 · AI데이터센터/채굴", CBRS: "세레브라스 · AI칩(상장전)", DELL: "델 · AI서버",
  ORCL: "오라클 · 클라우드DB", BE: "블룸에너지 · 연료전지(데이터센터전력)", GEV: "GE버노바 · 전력장비",
  VST: "비스트라 · 전력", CEG: "컨스텔레이션 · 원전전력", OKLO: "오클로 · 소형원전", SMR: "뉴스케일 · 소형원전",
  // 빅테크·소프트웨어
  AAPL: "애플 · 빅테크", MSFT: "마이크로소프트 · 빅테크", GOOGL: "알파벳(구글) · 빅테크", GOOG: "알파벳(구글) · 빅테크",
  AMZN: "아마존 · 빅테크", META: "메타 · 빅테크", TSLA: "테슬라 · 전기차/로봇", NFLX: "넷플릭스 · 스트리밍",
  PLTR: "팔란티어 · AI소프트웨어", CRWD: "크라우드스트라이크 · 보안", NET: "클라우드플레어 · 네트워크보안",
  NOW: "서비스나우 · 기업SW", IBM: "IBM · IT서비스/양자", ZM: "줌 · 화상회의", RDDT: "레딧 · 소셜",
  ADBE: "어도비 · 소프트웨어", CRM: "세일즈포스 · 기업SW", SNOW: "스노우플레이크 · 데이터", PANW: "팔로알토 · 보안",
  APP: "앱러빈 · 광고테크", SHOP: "쇼피파이 · 이커머스", UBER: "우버 · 모빌리티", EBAY: "이베이 · 이커머스",
  // 크립토 관련주
  MSTR: "스트래티지 · 비트코인보유", STRC: "스트래티지 우선주(STRC) · 비트코인", COIN: "코인베이스 · 거래소",
  HOOD: "로빈후드 · 증권/크립토", CRCL: "서클 · 스테이블코인(USDC)", BMNR: "비트마인 · 이더리움보유",
  PURRDAT: "하이퍼리퀴드 스트래티지스 · HYPE보유", GLXY: "갤럭시디지털 · 크립토금융", MARA: "마라 · 비트코인채굴",
  RIOT: "라이엇 · 비트코인채굴", CLSK: "클린스파크 · 비트코인채굴", CIFR: "사이퍼 · 채굴/AI", SBET: "샤프링크 · 이더리움보유",
  BLSH: "불리시 · 크립토거래소", GEMI: "제미니 · 크립토거래소", FIGR: "피겨 · 블록체인대출", XYZ: "블록(구 스퀘어) · 결제",
  BOT: "로보스트래티지 · 로봇/크립토", H100: "H100그룹 · 비트코인보유(스웨덴)",
  // 소비·헬스·금융·기타
  COST: "코스트코 · 유통", NKE: "나이키 · 스포츠의류", LLY: "일라이릴리 · 비만치료제", MRNA: "모더나 · 백신",
  HIMS: "힘스앤허스 · 원격의료", DKNG: "드래프트킹스 · 스포츠베팅", GME: "게임스톱 · 밈주식", BB: "블랙베리 · 보안SW",
  BX: "블랙스톤 · 사모펀드", NOK: "노키아 · 통신장비", RIVN: "리비안 · 전기차", RKLB: "로켓랩 · 우주발사체",
  SPCX: "스페이스X · 우주(상장전)", QNT: "퀀티뉴엄 · 양자컴퓨터(상장전)", USAR: "USA레어어스 · 희토류",
  BIRD: "올버즈 · 신발", BABA: "알리바바 · 中 이커머스", HYUNDAI: "현대차 · 자동차", SOFTBANK: "소프트뱅크 · AI투자(日)",
  MINIMAX: "미니맥스 · 中 AI", ZHIPU: "즈푸AI · 中 AI", UNITREE: "유니트리 · 中 휴머노이드", SHAZ: "샤론AI · AI인프라",
  CVX: "셰브론 · 석유메이저", XOM: "엑슨모빌 · 석유메이저", JPM: "JP모건 · 은행", GS: "골드만삭스 · 투자은행",
  V: "비자 · 결제", MA: "마스터카드 · 결제", WMT: "월마트 · 유통", DIS: "디즈니 · 미디어", BA: "보잉 · 항공",
  // 지수
  SP500: "S&P500 · 美 지수", XYZ100: "나스닥100(XYZ100) · 美 기술지수", NIFTY: "니프티50 · 인도 지수",
  IBOV: "보베스파 · 브라질 지수", JP225: "닛케이225 · 일본 지수", KR200: "코스피200 · 한국 지수", VIX: "VIX · 공포지수",
  // ETF
  SMH: "반도체 ETF(SMH)", SOXL: "반도체 3배 ETF(SOXL)", EWY: "한국 ETF(EWY)", KORU: "한국 3배 ETF(KORU)",
  EWJ: "일본 ETF(EWJ)", EWT: "대만 ETF(EWT)", EWZ: "브라질 ETF(EWZ)", XLE: "에너지 ETF(XLE)", URNM: "우라늄광산 ETF(URNM)",
  TLT: "美 장기국채 ETF(TLT)", MAGS: "매그니피센트7 ETF(MAGS)", DRAM: "메모리반도체 ETF(DRAM)",
  // 원자재
  GOLD: "금 · 원자재", SILVER: "은 · 원자재", PLATINUM: "백금 · 원자재", PALLADIUM: "팔라듐 · 원자재",
  COPPER: "구리 · 원자재", ALUMINIUM: "알루미늄 · 원자재", CL: "WTI 원유 · 원자재", BRENTOIL: "브렌트유 · 원자재",
  NATGAS: "천연가스(美) · 원자재", TTF: "천연가스(유럽 TTF) · 원자재", URANIUM: "우라늄 · 원자재",
  WHEAT: "밀 · 곡물", CORN: "옥수수 · 곡물",
  // 환율
  EUR: "유로/달러 · 환율", JPY: "달러/엔 · 환율", GBP: "파운드/달러 · 환율", KRW: "달러/원 · 환율", DXY: "달러인덱스 · 환율",
  // 코인
  BTC: "비트코인", ETH: "이더리움", SOL: "솔라나", HYPE: "하이퍼리퀴드", XRP: "리플", DOGE: "도지코인", BNB: "바이낸스코인",
  ADA: "카르다노", AVAX: "아발란체", LINK: "체인링크", SUI: "수이", TRX: "트론", LTC: "라이트코인", BCH: "비트코인캐시",
  DOT: "폴카닷", TON: "톤코인", NEAR: "니어", APT: "앱토스", ARB: "아비트럼", OP: "옵티미즘", AAVE: "에이브", UNI: "유니스왑",
  ENA: "에테나", ONDO: "온도", PEPE: "페페", KPEPE: "페페", WIF: "도그위프햇", TAO: "비텐서", FET: "페치AI", RENDER: "렌더",
  ZEC: "지캐시", XMR: "모네로", PUMP: "펌프펀", FARTCOIN: "파트코인", TRUMP: "트럼프코인", WLD: "월드코인", SEI: "세이",
  INJ: "인젝티브", TIA: "셀레스티아", JUP: "주피터", PENGU: "펏지펭귄", VIRTUAL: "버추얼", ASTER: "아스터", XPL: "플라즈마",
};

/* 개별주가 아닌 것(지수·원자재·ETF·환율·곡물) — 전종목 표에서는 빼고 '지수·원자재' 박스로 */
export const FIXED_INDEX = ["XYZ100", "SP500", "CL", "BRENTOIL"];   /* 지수·원자재 박스 맨 위 고정 순서 */
const NON_STOCK = new Set([...FIXED_INDEX, "GOLD", "SILVER", "PLATINUM", "PALLADIUM", "COPPER", "ALUMINIUM", "NATGAS", "TTF", "URANIUM",
  "WHEAT", "CORN", "KR200", "JP225", "NIFTY", "IBOV", "VIX", "DXY", "EUR", "JPY", "GBP", "KRW"]);
const NON_KEYWORDS = ["지수", "원자재", "ETF", "환율", "곡물"];
/* ETF지만 전종목(개별주) 표에서 같이 보고 싶은 티커 */
const STOCK_LIKE = new Set(["DRAM", "SMH", "SOXL", "EWY", "KORU", "MAGS", "EWJ", "EWT", "EWZ"]);

export function splitKo(ticker, siteKo, siteSector) {
  const e = KO[String(ticker).toUpperCase()];
  let name, sec = "";
  if (e) { const p = e.split(" · "); name = p[0]; sec = p.length > 1 ? p[1].replace(/\(.*?\)/g, "").trim() : ""; }
  else name = (siteKo && siteKo !== ticker) ? siteKo : ticker;
  if (!sec && siteSector) sec = siteSector;   /* 사전에 섹터가 없으면 사이트 섹터로 보충 */
  return { name, sec, full: e || "" };
}
export function isStock(ticker) {
  const k = String(ticker).toUpperCase();
  if (STOCK_LIKE.has(k)) return true;
  if (NON_STOCK.has(k)) return false;
  const d = KO[k] || "";
  return !NON_KEYWORDS.some((w) => d.includes(w));
}
