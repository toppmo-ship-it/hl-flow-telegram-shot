/* 코인 리포트·코인 알림 설정(tg_coin_cfg) — 코인 작업(coinjob.mjs)·챗봇·설정 페이지가 같은 모양을 씀(설정 페이지는 이 선택지를 그대로 따라감) */
export const EVERY = [30, 60, 120, 240, 1440], TOPS = [50, 100, 150, 300], ROWS = [30, 50, 70, 100], HOTS = [50, 100, 200, 300];
export const VOLM = [3, 5, 10], SURP = [2, 3, 5, 10], SURM = [30, 60], OIP = [5, 10, 20], MINE = [0, 1, 3, 10], FUNDA = [50, 100, 200, 300];
const pick = (a, v, d) => (a.includes(+v) ? +v : d);
export function normCoinCfg(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, a = r.alerts && typeof r.alerts === "object" ? r.alerts : {}, k = (n) => (a[n] && typeof a[n] === "object" ? a[n] : {}), on = (n, d) => (k(n).on != null ? !!k(n).on : d);
  return {
    on: r.on !== false, every: pick(EVERY, r.every, 30), top: pick(TOPS, r.top, 100), rows: pick(ROWS, r.rows, 70), fundHot: pick(HOTS, r.fundHot, 100),
    alerts: { on: a.on !== false, photo: a.photo !== false, minEok: pick(MINE, a.minEok, 3),
      kel: { on: on("kel", true) }, w2: { on: on("w2", true) }, core: { on: on("core", true) }, h4u: { on: on("h4u", false) }, h4m: { on: on("h4m", false) },
      vol: { on: on("vol", false), mult: pick(VOLM, k("vol").mult, 3) }, surge: { on: on("surge", false), pct: pick(SURP, k("surge").pct, 3), mins: pick(SURM, k("surge").mins, 30) },
      fund: { on: on("fund", false), apr: pick(FUNDA, k("fund").apr, 100) }, oi: { on: on("oi", false), pct: pick(OIP, k("oi").pct, 10) }, entry: { on: on("entry", false) } },
  };
}
export const COIN_KINDS = [
  ["kel", "🟧 켈상단 돌파", "일봉 켈트너 상단 위로 새로 올라옴"], ["w2", "💚 양W +2 도달", "양W가 +2(강세)에 새로 도달"], ["core", "⭐ ★핵심 진입", "양W+2 · 켈상단 · 4H중심 모두 충족"],
  ["h4u", "🔥 4H 발산 진입", "4H 켈트너 상단 위 · 코인은 자주 떠요"], ["h4m", "🕓 4H 중심 진입", "4H 켈트너 중심 위 · 아주 자주 떠요"], ["vol", "💰 거래대금 급증", "24h 거래대금이 7일 평균의 N배"],
  ["surge", "🚨 급변동", "시장 중앙값 대비 N분에 ±N%p"], ["fund", "💸 펀딩 과열", "연환산 펀딩이 ±N% 이상"], ["oi", "📊 미결제 급변", "4시간 미결제가 ±N% 이상 (가격 방향으로 해석)"], ["entry", "🚪 모든 진입", "양W 변화 등 모든 변화 · 아주 많이 떠요"],
];
