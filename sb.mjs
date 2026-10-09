/* Supabase hlgrid_settings(키-값) 읽기·쓰기 — 사이트가 브라우저에서 이미 쓰는 공개(anon) 키 사용. shot.mjs 와 챗봇이 함께 씀 */
import zlib from "node:zlib";
export const SBU = process.env.SBU_TEST || "https://atauxczcjtvcrjjlnapm.supabase.co";   /* SBU_TEST: 시험용 가짜 서버 */
export const SBK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXV4Y3pjanR2Y3JqamxuYXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTMxMzgsImV4cCI6MjA5MjA2OTEzOH0.jyB9SGyjdaHYRw8MpktX8dHtKOgA6rbGTJbdrycnXgA";
const H = () => ({ apikey: SBK, Authorization: "Bearer " + SBK });
export async function sbGet(key) {
  try {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value,updated_at&key=eq." + encodeURIComponent(key), { headers: H(), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    const v = rows[0].value;
    return v && v.z && v.d ? JSON.parse(zlib.gunzipSync(Buffer.from(v.d, "base64")).toString("utf8")) : v;
  } catch (e) { return null; }
}
export async function sbPut(key, value) {
  try {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?on_conflict=key", { method: "POST", headers: { ...H(), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(15000) });
    return r.ok;
  } catch (e) { return false; }
}

/* 읽고-고치고-쓰기를 '읽은 뒤 서버 기록이 안 바뀌었을 때만' 쓰도록(compare-and-swap) — 설정 페이지·다른 기기와 동시에 바꿔도 서로 덮어쓰지 않음.
   fn(복사본) 이 값을 고치고 아무 값(note)이나 돌려줌. 서버에 있던 모르는 칸은 그대로 보존. 변경 내용은 <key>_hist 에 최근 40건 기록 */
export async function sbUpdate(key, fn, by) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value,updated_at&key=eq." + encodeURIComponent(key), { headers: H(), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("설정 읽기 실패 " + r.status);
    const row = (await r.json())[0], before = row && row.value ? row.value : {}, next = JSON.parse(JSON.stringify(before)), note = fn(next);
    next._by = by || "봇"; next._at = Date.now();
    let ok = false;
    if (row && row.updated_at) {
      const p = await fetch(SBU + "/rest/v1/hlgrid_settings?key=eq." + encodeURIComponent(key) + "&updated_at=eq." + encodeURIComponent(row.updated_at), { method: "PATCH", headers: { ...H(), "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ value: next, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(15000) });
      if (!p.ok) throw new Error("설정 저장 실패 " + p.status);
      ok = (await p.json()).length > 0;
    } else ok = await sbPut(key, next);
    if (!ok) { await new Promise((x) => setTimeout(x, 150 + Math.random() * 300)); continue; }
    try {   // 변경 기록
      const ch = {}; Object.keys(next).forEach((k) => { if (k !== "_by" && k !== "_at" && JSON.stringify(next[k]) !== JSON.stringify(before[k])) ch[k] = { from: before[k], to: next[k] }; });
      if (Object.keys(ch).length) { const h = await sbGet(key + "_hist"), list = h && Array.isArray(h.list) ? h.list : []; list.unshift({ t: Date.now(), by: by || "봇", ch: JSON.stringify(ch).length < 1500 ? ch : Object.keys(ch) }); await sbPut(key + "_hist", { list: list.slice(0, 40) }); }
    } catch (e) {}
    return { value: next, note };
  }
  throw new Error("다른 곳에서 동시에 저장 중이라 반영하지 못했어요 — 다시 시도해 주세요");
}
