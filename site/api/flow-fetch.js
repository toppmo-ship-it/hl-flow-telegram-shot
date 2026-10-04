/* 흐름차트 데이터 프록시 (요청 반영: 타임프레임을 바꿔도 딜레이 없이 차트가 뜨게)
   왜 필요한가: 하이퍼리퀴드는 IP당 분당 가중치 1200(REST·WebSocket 공통, 실측 429). 60종목 한 프레임 = 약 1700이라
   브라우저(=메인 그리드와 같은 집 IP)에서 직접 받으면 프레임마다 몇 분이 걸렸음.
   → Vercel 서버 IP로 받아서(한도가 별개) 여러 함수 호출을 병렬로 돌리면 한 프레임이 1~2초.
   ?op=map                                 → 코인맵(짧은이름→전체이름/덱스) + 24h 거래대금(가중치용)
   ?coins=BTC,xyz:NVDA&iv=1h&start=ms&end=ms → 코인별 캔들 [[t,h,l,c,o,v],…] (계산은 클라이언트가 그대로 함, v=거래량)
   429/5xx 는 함수 안에서 짧게 재시도하고, 끝내 못 받은 코인은 miss 로 알려줘서 클라이언트가 다시 요청 */
const HL = "https://api.hyperliquid.xyz/info";
const IV = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* st = 이 요청 안에서의 측정값(하이퍼리퀴드 호출 수·합계 시간·429/5xx 횟수) — 응답의 t 필드로 돌려줘서 화면에서 병목(지연 vs 한도)을 보게 함 */
async function hl(body, st) {
  for (let a = 0; a < 6; a++) {   /* 429는 짧게 연타하지 않고 간격을 점점 벌려 6번까지(최대 약 12초) — 끝내 못 받은 코인은 miss 로 알려 화면이 속도를 낮춘 뒤 다시 요청 */
    const t0 = Date.now();
    try {
      const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const dt = Date.now() - t0;
      if (r.ok) { if (st) { st.n++; st.sum += dt; if (dt > st.max) st.max = dt; } return await r.json(); }
      if (st) { if (r.status === 429) st.r429++; else if (r.status >= 500) st.r5xx++; }
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) { if (st) st.err++; /* 네트워크 오류 → 재시도 */ }
    await sleep([500, 1000, 2000, 3500, 5000, 5000][a] + Math.random() * 300);
  }
  return null;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  const st = { n: 0, sum: 0, max: 0, r429: 0, r5xx: 0, err: 0 }, T0 = Date.now();
  const tm = () => ({ ms: Date.now() - T0, n: st.n, hl: st.n ? Math.round(st.sum / st.n) : 0, hlMax: st.max, r429: st.r429, r5xx: st.r5xx, err: st.err, region: process.env.VERCEL_REGION || "" });
  try {
    if (q.op === "map") {
      const dexs = await hl({ type: "perpDexs" }, st);
      const names = [""];
      (dexs || []).forEach((d) => { if (d && d.name) names.push(d.name); });
      const rs = await pool(names, 6, (dx) => hl(dx ? { type: "metaAndAssetCtxs", dex: dx } : { type: "metaAndAssetCtxs" }, st).then((r) => ({ dx, u: (r && r[0] && r[0].universe) || [], c: (r && r[1]) || [] })));
      const map = {}, ntl = {};
      rs.forEach((r) => {
        if (!r) return;
        r.u.forEach((a, i) => {
          const n = a.name; if (!n) return;
          const short = n.indexOf(":") >= 0 ? n.split(":")[1] : n;
          if (!(short in map)) { map[short] = { full: n, dex: r.dx }; ntl[short] = +((r.c[i] || {}).dayNtlVlm) || 0; }
        });
      });
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");   /* 코인맵·거래대금은 5분 공유 */
      return res.status(200).json({ ok: true, map, dexes: names, ntl, t: tm() });
    }
    const coins = String(q.coins || "").split(",").filter((c) => /^[A-Za-z0-9:_.\-]{1,24}$/.test(c)).slice(0, 14);
    const iv = String(q.iv || "1h");
    const start = Math.floor(+q.start), end = Math.floor(+q.end);
    if (!coins.length || !IV.has(iv) || !(start > 0) || !(end > start)) return res.status(400).json({ ok: false, error: "bad params" });
    const d = {}, miss = [];
    await pool(coins, 3, async (coin) => {   /* 하이퍼리퀴드 응답이 수십 ms라 동시 7개가 필요 없음 — 한 요청 안에서도 3개씩만 */
      const k = await hl({ type: "candleSnapshot", req: { coin, interval: iv, startTime: start, endTime: end } }, st);
      if (Array.isArray(k) && k.length) d[coin] = k.map((c) => [+c.t, +c.h, +c.l, +c.c, +c.o, +c.v]);
      else miss.push(coin);
    });
    const t = tm();
    res.setHeader("Server-Timing", "total;dur=" + t.ms + ", hl;dur=" + t.hl);
    /* 전부 받았을 때만 CDN에 20초 보관(같은 시각 요청이 한 번의 HL 호출로 묶임). 일부 누락이면 캐시하지 않아 다음 요청이 바로 재시도 */
    if (!miss.length) res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({ ok: true, d, miss, t });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
