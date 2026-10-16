/* 설정 사이트 종목 카드 선택에 쓰는 주식 종목 그룹(분야) — [분야 이름, [[티커, 표시 이름], …]] 목록.
   설정 사이트(shot-config.html)와 실행기(shot.mjs)가 같은 파일을 읽음 → 분야 필터·"이 분야 전부 추가"가 서버와 화면에서 똑같이 동작 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CardGroups = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return [
    ["📊 지수", [["10Y","미국10년물금리"],["SP500","S&P500"],["XYZ100","나스닥100"],["JP225","닛케이225"],["KR200","코스피200"]]],
    ["🏛 빅테크", [["META","META"],["MSFT","MSFT"],["SOFTBANK","소프트뱅크"],["AAPL","AAPL"],["NFLX","NFLX"],["AMZN","AMZN"],["GOOGL","GOOGL"]]],
    ["🚀 AI칩 대장 (GPU·CPU·설계)", [["NVDA","NVDA"],["ARM","ARM"],["AMD","AMD"],["INTC","INTC"]]],
    ["🧠 메모리 대장주", [["MU","MU"],["SMSN","삼성전자"],["SKHY","하이닉스ADR"],["SNDK","SNDK"],["SKHYNIX","SK하이닉스"]]],
    ["🧲 코인관련주", [["HOOD","HOOD"],["STRC","STRC"],["IREN","IREN"],["COIN","COIN"],["CRCL","CRCL"],["PURRDAT","PURRDAT"],["MSTR","MSTR"],["KSTR","KSTR"],["BMNR","BMNR"]]],
    ["📦 ETF·레버리지", [["XLE","XLE"],["NCLD","NCLD"],["MAGS","MAGS"],["TLT","TLT"],["EWJ","EWJ"],["EWZ","EWZ"],["SMH","SMH"],["EWT","EWT"],["DRAM","DRAM"],["EWY","EWY"],["URNM","URNM"],["XBI","XBI"],["SOXL","SOXL"],["KORU","KORU"]]],
    ["💾 메모리 중소·해외", [["WDC","WDC"],["CXMT","CXMT"],["KIOXIA","키오시아"],["GIGADEV","GIGADEV"]]],
    ["🛢 원자재", [["BRENTOIL","브렌트유"],["CL","WTI원유"],["NATGAS","천연가스"],["GOLD","금"],["COPPER","구리"],["PALLADIUM","팔라듐"],["SILVER","은"],["PLATINUM","백금"]]],
    ["🔗 네트워크칩·ASIC", [["QCOM","QCOM"],["MRVL","MRVL"],["CBRS","CBRS"],["AVGO","AVGO"]]],
    ["🏭 파운드리·장비", [["TSM","TSM"],["ASML","ASML"],["AMAT","AMAT"]]],
    ["🔦 광통신·네트워크", [["NOK","NOK"],["LITE","LITE"],["LYTE","LYTE"],["AAOI","AAOI"]]],
    ["🤖 AI SW·클라우드·보안", [["CRWD","CRWD"],["PLTR","PLTR"],["NOW","NOW"],["ZM","ZM"],["IBM","IBM"],["NET","NET"],["CRWV","CRWV"],["DELL","DELL"],["ORCL","ORCL"],["NBIS","NBIS"],["BB","BB"]]],
    ["🇨🇳 중국 AI·로봇", [["BOT","BOT"],["UNITREE","UNITREE"],["MINIMAX","MINIMAX"],["ZHIPU","ZHIPU"]]],
    ["🚗 전기차·우주·전력", [["TSLA","TSLA"],["RIVN","RIVN"],["RKLB","RKLB"],["BE","BE"],["GEV","GEV"],["SPCX","SPCX"],["USAR","USAR"]]],
    ["💊 바이오·헬스", [["MRNA","MRNA"],["LLY","LLY"],["HIMS","HIMS"]]],
    ["🛒 소비·기타", [["GME","GME"],["SHEIN","SHEIN"],["BIRD","BIRD"],["COST","COST"],["EBAY","EBAY"],["BX","BX"],["RDDT","RDDT"],["HYUNDAI","현대차"],["DKNG","DKNG"],["QNT","QNT"],["BABA","BABA"],["SHAZ","SHAZ"],["SNXX","SNXX"]]]
  ];
});
