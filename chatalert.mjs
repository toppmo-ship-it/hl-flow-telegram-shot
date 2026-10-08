/* 텔레그램 챗봇 — 알림 기능 (가격 알림 · 퍼센트 알림 · 진입 알림 · 급변동 알림)
   저장: Supabase tg_bot_alerts = { list:[{id,tk,full,kind:"px"|"pct",dir:"up"|"down"|"both",level,base,at}], entry:{on,kinds:"core"|"all",last}, surge:{on,pct,mins,last:{티커:시각}} }
   감시: chatbot.mjs 가 켜져 있는 동안 계속(가격은 30초마다, 진입·급변동은 5분마다) — 5분 사슬과 별개라 더 빠름 */
import { pickRow, hl } from "./extras.mjs";
import { fetchMids, changeOver } from "./repcalc.mjs";
import { buildReport, collectRows } from "./report.mjs";
import { parseRequest, parseEvery, norm } from "./chatparse.mjs";
import * as F from "./chatfmt.mjs";

const KEY = "tg_bot_alerts", MAX = 30;
export const VAL = /^([+\-±]?)(\d+(?:[.,]\d+)?)(%|달러|원|usd|\$)?$/i;

/* 말 → { name(종목 글), kind, dir, level } — 예) ['sk하이닉스','1300'] · ['메타','+3%'] · ['비트코인','±5%'] */
export function parseAlertArgs(args) {
  let vi = -1;
  for (let i = args.length - 1; i >= 0; i--) if (VAL.test(String(args[i]).replace(/,/g, ""))) { vi = i; break; }
  if (vi < 0) return null;
  const m = VAL.exec(String(args[vi]).replace(/,/g, "")), sign = m[1], num = parseFloat(m[2].replace(",", "."));
  const name = args.filter((_, i) => i !== vi).join(" ");
  if (m[3] === "%") return { name, kind: "pct", dir: sign === "+" ? "up" : sign === "-" ? "down" : "both", level: num };
  if (!(num > 0)) return null;
  return { name, kind: "px", level: num };
}

export function makeAlerts(D) {
  const { C, say, W, sbGet, loadCtx, log, CACHE, cfgGet } = D;
  const get = async () => { const a = await sbGet(KEY); return a && typeof a === "object" ? { list: a.list || [], entry: a.entry || { on: false, kinds: "core", last: 0 }, surge: a.surge || { on: false, pct: 3, mins: 15, last: {} } } : { list: [], entry: { on: false, kinds: "core", last: 0 }, surge: { on: false, pct: 3, mins: 15, last: {} } }; };
  const put = (a) => W(KEY, a);
  const fullOf = (tk) => { const r = pickRow(C.uni, tk, C.info); return r ? r.full : null; };
  const midOf = async (full) => { const m = await fetchMids([{ full }], () => {}); return +m[full] || null; };
  const label = (a) => (a.kind === "px" ? F.fmtPx(a.level) + (a.dir === "up" ? " 이상" : " 이하") : (a.dir === "up" ? "+" : a.dir === "down" ? "−" : "±") + a.level + "% 변동");

  async function add(args) {
    const p = parseAlertArgs(args);
    if (!p || !p.name) throw new D.UserErr("예) <code>알림 메타 700</code> (가격) · <code>알림 메타 +3%</code> (지금보다 3% 오르면) · <code>알림 비트 ±5%</code> (오르내림 아무쪽)");
    await loadCtx();
    const q = parseRequest(p.name, C.idx, C.info, C.themes);
    if (!q.tickers.length) throw new D.UserErr("'" + F.esc(p.name) + "' 종목을 못 찾았어요");
    const ts = q.tickers.slice(0, 5), A = await get(), done = [];
    for (const tk of ts) {
      if (A.list.length >= MAX) { done.push(tk + ": 알림이 가득 찼어요(최대 " + MAX + "개)"); continue; }
      const full = fullOf(tk); if (!full) { done.push(tk + ": 시세 없음"); continue; }
      const px = await midOf(full); if (!px) { done.push(tk + ": 지금 가격을 못 받았어요"); continue; }
      const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4), tk, full, kind: p.kind, level: p.level, base: px, at: Date.now() };
      a.dir = p.kind === "px" ? (p.level >= px ? "up" : "down") : p.dir;
      A.list.push(a);
      done.push("✅ <b>" + F.esc(tk) + "</b> " + label(a) + " <i>(지금 " + F.fmtPx(px) + ")</i>");
    }
    await put(A);
    return say("🔔 <b>알림 등록</b>\n" + done.join("\n") + "\n<i>조건이 맞으면 바로 알려드리고 그 알림은 사라져요 · <code>알림목록</code></i>");
  }
  async function list() {
    const A = await get(), L = ["🔔 <b>알림 목록</b>", ""];
    if (!A.list.length) L.push("— 가격·변동 알림이 없어요 —  예) <code>알림 메타 700</code>");
    A.list.forEach((a, i) => L.push((i + 1) + ". <b>" + F.esc(a.tk) + "</b> " + label(a) + (a.kind === "pct" ? " <i>(기준 " + F.fmtPx(a.base) + ")</i>" : "") + "  <i>" + F.ago(a.at) + " 등록</i>"));
    L.push("", "🚪 진입 알림: " + (A.entry.on ? "<b>켬</b> (" + (A.entry.kinds === "all" ? "모든 진입" : "★핵심·4H발산") + ")" : "끔") + "   <code>진입알림 켜기</code>");
    L.push("🚨 급변동 알림: " + (A.surge.on ? "<b>켬</b> (" + A.surge.mins + "분에 시장 대비 ±" + A.surge.pct + "%p)" : "끔") + "   <code>급변동알림 켜기</code>");
    return say(L.join("\n") + "\n\n<i>삭제: <code>알림삭제 1</code> · <code>알림삭제 메타</code> · <code>알림삭제 전체</code></i>");
  }
  async function del(args) {
    if (!args.length) throw new D.UserErr("예) <code>알림삭제 1</code> · <code>알림삭제 메타</code> · <code>알림삭제 전체</code>");
    const A = await get(), w = norm(args.join(""));
    let rm = [];
    if (/^(전체|모두|all)$/.test(w)) { rm = A.list.slice(); A.list = []; }
    else if (/^\d+$/.test(w)) { const i = +w - 1; if (A.list[i]) { rm = A.list.splice(i, 1); } }
    else { await loadCtx(); const q = parseRequest(args.join(" "), C.idx, C.info, C.themes); const set = new Set(q.tickers); A.list = A.list.filter((a) => (set.has(a.tk) ? (rm.push(a), false) : true)); }
    if (!rm.length) return say("지울 알림을 못 찾았어요 — <code>알림목록</code> 으로 번호를 확인해 주세요");
    await put(A);
    return say("🗑 알림 " + rm.length + "개 삭제: " + F.esc(rm.map((a) => a.tk + " " + (a.kind === "px" ? F.fmtPx(a.level) : a.level + "%")).join(", ")));
  }
  async function entrySet(args) {
    const A = await get(), w = norm((args || []).join(""));
    if (!w) return say("🚪 진입 알림은 지금 <b>" + (A.entry.on ? "켜짐" : "꺼짐") + "</b>\n<code>진입알림 켜기</code> · <code>진입알림 끄기</code> · <code>진입알림 전체</code> (모든 진입까지)");
    if (/^(끄기|끔|off)$/.test(w)) A.entry.on = false;
    else if (/^(전체|모두|all)$/.test(w)) { A.entry.on = true; A.entry.kinds = "all"; A.entry.last = Date.now(); }
    else if (/^(켜기|켬|on|핵심)$/.test(w)) { A.entry.on = true; A.entry.kinds = "core"; A.entry.last = Date.now(); }
    else throw new D.UserErr("<code>진입알림 켜기</code> · <code>끄기</code> · <code>전체</code>");
    await put(A);
    return say(A.entry.on ? "🚪 진입 알림 <b>켬</b> — " + (A.entry.kinds === "all" ? "모든 진입(양W 변화·켈·4H·발산·핵심)" : "★핵심 · 4H발산 진입") + "이 생기면 5분 안에 알려드려요" : "🚪 진입 알림 <b>끔</b>");
  }
  async function surgeSet(args) {
    const A = await get(); let on = null;
    for (const t of args || []) {
      const n = norm(t), e = parseEvery(t); let m;
      if (/^(끄기|끔|off)$/.test(n)) on = false; else if (/^(켜기|켬|on)$/.test(n)) on = true;
      else if ((m = /^(\d+(?:\.\d+)?)(%p?|퍼)$/.exec(n))) { A.surge.pct = Math.min(20, Math.max(0.5, +m[1])); on = on == null ? true : on; }
      else if (typeof e === "number" && e >= 5) { A.surge.mins = [5, 15, 30, 60].reduce((b, x) => (Math.abs(x - e) < Math.abs(b - e) ? x : b)); on = on == null ? true : on; }
    }
    if (on == null && (args || []).length) throw new D.UserErr("<code>급변동알림 켜기</code> · <code>급변동알림 끄기</code> · <code>급변동알림 3%</code> · <code>급변동알림 30분</code>");
    if (on != null) { A.surge.on = on; if (on) A.surge.last = {}; }
    await put(A);
    return say("🚨 급변동 알림 <b>" + (A.surge.on ? "켬" : "끔") + "</b>" + (A.surge.on ? " — " + A.surge.mins + "분 동안 시장 중앙값 대비 ±" + A.surge.pct + "%p 이상 튄 종목을 알려드려요(같은 종목은 30분에 한 번)" : "") + (!(args || []).length ? "\n<code>급변동알림 켜기</code> · <code>급변동알림 3%</code> · <code>급변동알림 30분</code>" : ""));
  }

  /* ── 감시 ── */
  let lastSlow = 0;
  async function tickPrice() {
    const A = await get(); if (!A.list.length) return;
    const coins = [...new Set(A.list.map((a) => a.full))].map((full) => ({ full })), mids = await fetchMids(coins, () => {});
    const hit = [], keep = [];
    for (const a of A.list) {
      const px = +mids[a.full]; if (!(px > 0)) { keep.push(a); continue; }
      let ok = false, txt = "";
      if (a.kind === "px") { ok = a.dir === "up" ? px >= a.level : px <= a.level; txt = F.fmtPx(a.level) + (a.dir === "up" ? " 위로 돌파" : " 아래로 이탈"); }
      else { const mv = (px / a.base - 1) * 100; ok = a.dir === "up" ? mv >= a.level : a.dir === "down" ? -mv >= a.level : Math.abs(mv) >= a.level; txt = (mv >= 0 ? "+" : "") + mv.toFixed(2) + "% (목표 " + label(a) + ", 기준 " + F.fmtPx(a.base) + ")"; }
      if (ok) hit.push({ a, px, txt }); else keep.push(a);
    }
    if (!hit.length) return;
    A.list = keep; await put(A);   /* 먼저 지워서 중복 알림 방지 */
    for (const h of hit) await say("🔔 <b>" + F.esc(h.a.tk) + "</b> " + h.txt + "\n💰 지금 <b>" + F.fmtPx(h.px) + "</b>  <i>" + F.hm(Date.now()) + "</i>\n<i>차트: <code>" + F.esc(h.a.tk) + "</code></i>");
  }
  async function tickSlow() {
    const A = await get(); if (!A.entry.on && !A.surge.on) return;
    await loadCtx();
    const cfg = await cfgGet();
    if (A.entry.on) {
      const out = await buildReport({ cfg: { ...cfg, repOrder: ["sum"], repOff: [] }, info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 20000, bars: C.bars, stateIO: { read: () => sbGet("tg_rep_state"), write: (s) => W("tg_rep_state", s) } });
      if (!out.skip) {
        const fresh = out.ent.filter((e) => e.t > (A.entry.last || 0) && (A.entry.kinds === "all" || e.kinds.some((k) => k === "핵심" || k.startsWith("발산"))));
        if (fresh.length) {
          const by = Object.fromEntries(((C.snap && C.snap.rows) || []).map((r) => [r.tk, r]));
          await say("🚪 <b>새 진입</b>\n" + fresh.slice(0, 8).map((e) => F.entryLine(e, by)).join("\n") + (fresh.length > 8 ? "\n… 외 " + (fresh.length - 8) + "개" : ""));
        }
        A.entry.last = Date.now(); await put(A);
      }
    }
    if (A.surge.on) {
      const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 15000, bars: C.bars }), now = Date.now(), list = [];
      r.rows.filter((x) => x.v.w >= 0).forEach((x) => { const c = changeOver(x.e, A.surge.mins, now); if (c) list.push({ x, pct: c.pct, usd: c.usd }); });
      const a = list.map((q) => q.pct).sort((p, q) => p - q), med = a.length >= 3 ? a[Math.floor(a.length / 2)] : 0;
      const hot = list.map((q) => ({ ...q, rel: q.pct - med })).filter((q) => Math.abs(q.rel) >= A.surge.pct && now - ((A.surge.last || {})[q.x.tk] || 0) > 30 * 60000).sort((p, q) => Math.abs(q.rel) - Math.abs(p.rel)).slice(0, 5);
      if (hot.length) {
        A.surge.last = A.surge.last || {}; hot.forEach((q) => { A.surge.last[q.x.tk] = now; });
        await say("🚨 <b>급변동</b>  <i>" + A.surge.mins + "분 · 시장 " + (med >= 0 ? "+" : "") + med.toFixed(2) + "%p 대비</i>\n" + hot.map((q) => (q.rel > 0 ? "🔺+" : "🔽") + q.rel.toFixed(2) + "%p  <b>" + F.esc(q.x.tk) + "</b>" + (q.x.name && q.x.name !== q.x.tk ? " · " + F.esc(q.x.name) : "") + "  유입 " + F.eok(q.usd * C.fx / 1e8) + "억").join("\n"));
        await put(A);
      }
    }
  }
  async function loop(maxMs, t0) {
    while (Date.now() - t0 < maxMs) {
      try {
        await tickPrice();
        if (Date.now() - lastSlow > 5 * 60000) { lastSlow = Date.now(); if (!D.C.busy) await tickSlow(); else lastSlow = Date.now() - 4 * 60000; }
      } catch (e) { log("알림 감시 오류", String((e && e.message) || e).slice(0, 120)); }
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  return { add, list, del, entrySet, surgeSet, loop, tickPrice, tickSlow };
}
