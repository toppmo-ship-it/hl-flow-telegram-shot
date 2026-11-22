/* 알람 방 채팅 명령 해석(순수 함수): "한시간" "일봉" "3일" "주봉" → 그 시간대 대표종목 전부 · "하이닉스" → 그 종목 전 시간대 6개 · "애플 4시간" → 하나만.
   글 전체가 아래 낱말로만 이뤄졌을 때만 알아들음(그 밖의 글은 null → 평소 챗봇이 처리) */
export const SIG_IVS = ["1h", "2h", "4h", "1d", "3d", "1w"];   // 종목만 말했을 때 보내는 시간대(사용자 지정 6개)
const IV_W = { "30m": ["30분봉", "30분", "30m"], "1h": ["한시간봉", "한시간", "1시간봉", "1시간", "1h"], "2h": ["두시간봉", "두시간", "2시간봉", "2시간", "2h"], "4h": ["네시간봉", "네시간", "4시간봉", "4시간", "4h"], "1d": ["일봉", "하루", "1d"], "3d": ["3일봉", "3일", "3d"], "1w": ["주봉", "1w"] };
const COIN_W = { "xyz:XYZ100": ["나스닥100", "나스닥", "nasdaq100", "nq"], "xyz:CL": ["유가", "원유", "wti"], "xyz:SKHX": ["sk하이닉스", "에스케이하이닉스", "하이닉스", "skhx"], "xyz:SMSN": ["삼성전자", "삼성", "smsn"], "xyz:MU": ["마이크론", "mu"], "xyz:AAPL": ["애플", "aapl"], "xyz:KORU": ["koru", "코루"], "xyz:SOXL": ["soxl", "속슬"] };
const WORDS = [];
for (const [k, ws] of Object.entries(IV_W)) for (const w of ws) WORDS.push([w.toLowerCase(), "iv", k]);
for (const [k, ws] of Object.entries(COIN_W)) for (const w of ws) WORDS.push([w.toLowerCase(), "coin", k]);
WORDS.sort((a, b) => b[0].length - a[0].length);

export function parseSig(text) {
  let s = String(text || "").toLowerCase().replace(/[\s,·\/+&]+/g, "").replace(/(알람|알림|신호)$/, ""); if (!s) return null;
  const ivs = [], coins = [];
  while (s) { const w = WORDS.find((x) => s.startsWith(x[0])); if (!w) return null; s = s.slice(w[0].length); const a = w[1] === "iv" ? ivs : coins; if (!a.includes(w[2])) a.push(w[2]); }
  if (!ivs.length && !coins.length) return null;
  return { ivs: ivs.length ? ivs : SIG_IVS, coins };   // coins 비면 대표종목 전부(알림 서버 기본 목록)
}
