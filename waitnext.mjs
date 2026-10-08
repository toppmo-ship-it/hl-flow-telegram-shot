/* 사슬의 '다음 실행까지 대기' 단계 — 기준 시각(.cache/anchor.json, 없으면 시계의 5분 경계)에서 5분 격자의 다음 칸까지 기다림.
   기다리는 동안 8초마다 설정 페이지의 '지금 보내기' 요청(tg_shot_cmd)을 확인해서, 새 요청이 있으면 기다리지 않고 바로 끝냄 → 곧바로 다음 실행이 시작돼 설정된 사진이 모두 나감.
   '지금 보내기'를 처리하면 shot.mjs 가 anchor 를 누른 시각으로 바꿔서, 그 시각부터 5분 간격이 새로 시작됨 */
import fs from "node:fs";
const SBU = process.env.SBU_TEST || "https://atauxczcjtvcrjjlnapm.supabase.co";
const SBK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXV4Y3pjanR2Y3JqamxuYXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTMxMzgsImV4cCI6MjA5MjA2OTEzOH0.jyB9SGyjdaHYRw8MpktX8dHtKOgA6rbGTJbdrycnXgA";   /* 사이트가 브라우저에서 이미 쓰는 공개(anon) 키 */
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = read(".cache/state.json", {}), anchor = +(read(".cache/anchor.json", {}).t) || 0, step = 300000;
const now = Date.now();
let next = anchor + Math.ceil((now - anchor) / step) * step;
if (next - now < 20000) next += step;   /* 너무 임박하면 한 칸 뒤 */
console.log("다음 실행 예정 " + new Date(next + 9 * 3600e3).toISOString().slice(11, 19) + " KST (" + Math.round((next - now) / 1000) + "초 뒤) · 기준 " + (anchor ? new Date(anchor + 9 * 3600e3).toISOString().slice(11, 19) + " KST" : "시계 5분 경계"));
while (Date.now() < next) {
  await sleep(Math.min(8000, Math.max(0, next - Date.now())));
  try {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value&key=eq.tg_shot_cmd", { headers: { apikey: SBK, Authorization: "Bearer " + SBK } });
    const j = await r.json(), c = j && j[0] && j[0].value;
    if (c && c.id && c.id !== st.lastCmd) { console.log("📤 '지금 보내기' 요청 감지 → 기다리지 않고 바로 다음 실행 (" + c.id + ")"); break; }
  } catch (e) {}
}
