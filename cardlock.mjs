/* 주식 카드·코인 카드 발송 순서 잠금 — 두 작업이 같은 시각에 카드를 보내면 한 장씩 번갈아 도착하던 문제 방지.
   한쪽이 보내는 동안(until 까지, 장마다 갱신) 다른 쪽은 기다리고, 끝난 뒤에도 GAP 만큼 더 쉬고 보냄 → 항상 한 묶음씩 따로 도착.
   저장: Supabase hlgrid_settings.tg_card_lock = { by:"stock"|"coin", until:ms } (비정상 종료돼도 until 이 지나면 자동 해제) */
const SBU = process.env.SBU_TEST || "https://atauxczcjtvcrjjlnapm.supabase.co";
const SBK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXV4Y3pjanR2Y3JqamxuYXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTMxMzgsImV4cCI6MjA5MjA2OTEzOH0.jyB9SGyjdaHYRw8MpktX8dHtKOgA6rbGTJbdrycnXgA";   /* 사이트가 브라우저에서 이미 쓰는 공개(anon) 키 */
const KEY = "tg_card_lock", GAP = 45000, HOLD = 40000;
const H = { apikey: SBK, Authorization: "Bearer " + SBK };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get() { try { const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value&key=eq." + KEY, { headers: H }); const j = await r.json(); return (j && j[0] && j[0].value) || null; } catch (e) { return null; } }
async function put(v) { try { await fetch(SBU + "/rest/v1/hlgrid_settings?on_conflict=key", { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: KEY, value: v, updated_at: new Date().toISOString() }) }); } catch (e) {} }
const freeFor = (l, me, now) => !l || l.by === me || now >= (+l.until || 0) + GAP;
/* 지금 내가 보내도 되는지(기다리지 않음) */
export async function isFree(me) { return freeFor(await get(), me, Date.now()); }
/* 내 차례가 될 때까지 기다렸다가 잠금을 잡음(최대 maxWaitMs, 넘기면 그냥 진행해서 주기가 멈추지 않게 함) */
export async function acquire(me, log, maxWaitMs = 300000) {
  const t0 = Date.now();
  for (;;) {
    const l = await get(), now = Date.now();
    if (freeFor(l, me, now) || now - t0 >= maxWaitMs) {
      await put({ by: me, until: now + HOLD }); await sleep(1500);
      const c = await get();   /* 동시에 잡은 경우 대비: 다시 읽어 내 것이 아니면 처음부터 */
      if (!c || c.by === me || now - t0 >= maxWaitMs) return;
    }
    if (log) log("카드 잠금 대기 — " + (l && l.by === "coin" ? "코인" : "주식") + " 카드 발송 중/직후 (" + Math.round((now - t0) / 1000) + "초)");
    await sleep(10000);
  }
}
export const renew = (me) => put({ by: me, until: Date.now() + HOLD });
export const release = (me) => put({ by: me, until: Date.now() });
