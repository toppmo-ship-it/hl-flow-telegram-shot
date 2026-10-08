/* Supabase hlgrid_settings(키-값) 읽기·쓰기 — 사이트가 브라우저에서 이미 쓰는 공개(anon) 키 사용. shot.mjs 와 챗봇이 함께 씀 */
import zlib from "node:zlib";
export const SBU = "https://atauxczcjtvcrjjlnapm.supabase.co";
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
