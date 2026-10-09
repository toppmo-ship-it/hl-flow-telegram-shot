/* 일회성 진단: GitHub 실행기(데이터센터 IP)에서 시가총액 출처(야후·코인게코)가 막히지 않는지 확인 → Supabase tg_diag2 에 결과 요약만 기록 */
import { sbPut } from "../sb.mjs";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const out = { at: new Date().toISOString() };
try {
  const r0 = await fetch("https://fc.yahoo.com", { headers: UA, redirect: "manual", signal: AbortSignal.timeout(15000) });
  const ck = (r0.headers.getSetCookie ? r0.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; "); out.cookie = !!ck;
  const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie: ck }, signal: AbortSignal.timeout(15000) }); const crumb = await cr.text(); out.crumb = cr.status + ":" + (crumb.length < 30 ? "ok" : "bad");
  const q = await fetch("https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,NVDA,000660.KS,9984.T,EWZ&crumb=" + encodeURIComponent(crumb), { headers: { ...UA, cookie: ck }, signal: AbortSignal.timeout(15000) }); out.quote = q.status;
  if (q.ok) { const j = await q.json(); out.caps = (j.quoteResponse.result || []).map((x) => x.symbol + ":" + (x.marketCap ? Math.round(x.marketCap / 1e9) + "B" : "-")).join(" "); }
  const ss = await fetch("https://query1.finance.yahoo.com/v10/finance/quoteSummary/EWZ?modules=summaryDetail&crumb=" + encodeURIComponent(crumb), { headers: { ...UA, cookie: ck }, signal: AbortSignal.timeout(15000) }); out.etfSummary = ss.status;
  if (ss.ok) { const j = await ss.json(); const sd = j.quoteSummary.result[0].summaryDetail; out.ewzAssets = sd.totalAssets ? Math.round(sd.totalAssets.raw / 1e6) + "M" : "-"; }
} catch (e) { out.yahooErr = String((e && e.message) || e).slice(0, 100); }
try { const r = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,hyperliquid&per_page=5", { signal: AbortSignal.timeout(15000) }); out.cg = r.status; if (r.ok) out.cgcaps = (await r.json()).map((c) => c.symbol + ":" + Math.round(c.market_cap / 1e9) + "B").join(" "); } catch (e) { out.cgErr = String((e && e.message) || e).slice(0, 80); }
console.log(JSON.stringify(out)); await sbPut("tg_diag2", out);
