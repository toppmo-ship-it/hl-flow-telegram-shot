/* 차트스캐너(브트) 폰 알림 서버 — 가격 알림 + PivotScope 다이버전스 알람을 폰·PC 알림창(웹 푸시)으로 바로 보냄.
   · 알림 설정은 브라우저(PC·폰)가 이미 Supabase hlgrid_settings 'chartscan_state_v1' 의 state.alerts / state.pvAlerts 로 동기화해 둔 것을 그대로 읽음(새 설정 없음)
   · 가격: 알림이 걸린 종목만 하이퍼리퀴드 호가(bbo) 웹소켓을 구독 → 중간가가 알림 가격을 가로지르는 순간(보통 0.2초 안) 보냄. 판정은 브라우저(alertcore.js)와 같음
   · 다이버전스: 시간대 봉이 닫힌 직후(+1.2·4.5·12초)와 1분마다, 최신 봉까지 새로 받아 브라우저(divscan.js)와 같은 판독으로 '완성'을 찾아 처음 보는 것만 보냄
   · 쓰는 곳: Supabase 'cs_alert_srv_state'(이미 보낸 기록·살아 있음 표시) — 사용자 설정은 절대 쓰지 않음
   · 받는 기기: 각 기기가 알림 센터의 「이 기기에서 알림 받기」를 눌러 Supabase 'cs_push_subs' 에 올린 푸시 구독 전체(만료된 구독은 자동으로 지움)
   · 끄기: 앱 설정 state.alPhone=false(알림 센터의 「서버가 기기로 보내기」 스위치) 또는 알림별 phone=false
   · 시험: 알림 센터 「시험 알림 보내기」 → 'cs_push_cmd' 를 5초 안에 읽어 모든 기기로 보냄
   · 텔레그램: 같은 알림을 리포트 방(TG_CHAT_ID2, 비면 TG_CHAT_ID)에 글로도 보냄. 폰 푸시 스위치(alPhone/phone)와 무관, 비밀값이 없으면 조용히 건너뜀
   환경변수: VAPID_PRIVATE_KEY(푸시 서명 비밀키 — GitHub 비밀값), TG_BOT_TOKEN·TG_CHAT_ID·TG_CHAT_ID2(텔레그램 — GitHub 비밀값), CSA_MAX_MIN(실행 분, 기본 335), CSA_DRY=1(전송·저장 안 함 — 화면에만), CSA_STATE_FILE=파일(시험: 서버 설정 대신 읽음), CSA_FORCE_DIV=1(시험: 기준선 없이 바로 알림) */
import fs from "node:fs";
import * as webpush from "web-push";
import { sbGet, sbPut, sbUpdate, SBU, SBK } from "./sb.mjs";
import { PV } from "./cs/pivotscope.js";
import { detectShapes } from "./cs/shapes.js";

const clean = (s) => String(s || "").replace(/[\s​﻿]/g, "");
const DRY = process.env.CSA_DRY === "1", MAXMIN = +process.env.CSA_MAX_MIN || 335, FORCE = process.env.CSA_FORCE_DIV === "1";
const VAPID_PUB = "BOIomRV1r3EB7LSnaczKtbCi1nmr2ho8sAvydTx3QHOk_pRF9lhfuZKem1KyDsD8MoBgjQlzIM-Jg4g8dtxzokQ", VAPID_PRIV = clean(process.env.VAPID_PRIVATE_KEY);
const K_STATE = "chartscan_state_v1", K_SRV = "cs_alert_srv_state", K_SUBS = "cs_push_subs", K_CMD = "cs_push_cmd";
const T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let KO = {}; try { KO = JSON.parse(fs.readFileSync(new URL("./site/names-ko.json", import.meta.url), "utf8")); } catch (e) { /* 이름 없으면 티커로 */ }
const nameOf = (coin) => { const tk = String(coin).split(":").pop(); return KO[tk] || tk; };
const fmtPx = (v) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6));
const kst = (t) => { const d = new Date(t + 9 * 36e5), p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
const ivL = (iv) => { const n = IVN[iv] || iv; return n.endsWith("봉") ? n : n + "봉"; };   /* 라벨 끝 '봉'은 한 번만 (일봉봉 방지) */
const IVN = { "30m": "30분", "1h": "1시간", "2h": "2시간", "4h": "4시간", "8h": "8시간", "1d": "일봉", "3d": "3일", "1w": "주봉", "1M": "월봉" }, IVMS = { "30m": 18e5, "1h": 36e5, "2h": 72e5, "4h": 144e5, "8h": 288e5, "1d": 864e5, "3d": 2592e5, "1w": 6048e5, "1M": 2592e6 };

/* ───── 텔레그램 전송: 리포트 방(TG_CHAT_ID2, 비면 기본 방 TG_CHAT_ID) — 폰 푸시와 같은 알림을 글로도 보냄 ───── */
const TG_TOKEN = clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, ""), TG_ROOM = clean(process.env.TG_ALERT_CHAT_ID) || clean(process.env.TG_CHAT_ID2) || clean(process.env.TG_CHAT_ID);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const tgSentAt = [], TGSTAT = { ok: 0, fail: 0, last: "", err: "", room: TG_ROOM ? "…" + TG_ROOM.slice(-4) : "", tok: !!TG_TOKEN };   /* TGSTAT: 로그 없이도 결과를 볼 수 있게 cs_alert_srv_state 에 같이 저장 */
const tgNote = (ok, err) => { ok ? TGSTAT.ok++ : TGSTAT.fail++; TGSTAT.last = new Date().toISOString(); TGSTAT.err = ok ? "" : String(err || "").slice(0, 160); dirty = true; };
async function tgSend(text) {
  if (DRY) { log("[DRY 텔레그램]\n" + text.replace(/<[^>]+>/g, "")); return true; }
  if (!TG_TOKEN || !TG_ROOM) { log("텔레그램 비밀값 없음 — 건너뜀 (토큰", !!TG_TOKEN, "방", !!TG_ROOM + ")"); tgNote(false, "비밀값 없음 토큰=" + !!TG_TOKEN + " 방=" + !!TG_ROOM); return false; }
  const now = Date.now(); while (tgSentAt.length && now - tgSentAt[0] > 60000) tgSentAt.shift();
  if (tgSentAt.length >= 15) { log("텔레그램 분당 상한 — 보내지 않음"); tgNote(false, "분당 상한"); return false; }   /* 방당 분당 20건 제한보다 낮게 */
  tgSentAt.push(now);
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TG_ROOM, text, parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(15000) });
      if (r.ok) { log("텔레그램 보냄"); tgNote(true); return true; }
      const j = await r.json().catch(() => ({})); log("텔레그램 실패:", r.status, j.description || ""); tgNote(false, r.status + " " + (j.description || ""));
      if (r.status === 429) await sleep(((j.parameters && j.parameters.retry_after) || 3) * 1000); else return false;
    } catch (e) { log("텔레그램 오류:", e.message); tgNote(false, e.message); await sleep(500); }
  }
  return false;
}

/* ───── 푸시 전송 (분당 30건 상한 — 오류로 폭주해도 알림창이 도배되지 않게) ───── */
let SUBS = [], subsStamp = ""; const sent = []; let muted = 0;
async function loadSubs() {
  try {
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=updated_at&key=eq." + K_SUBS, { headers: { apikey: SBK, Authorization: "Bearer " + SBK }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return; const u = ((await r.json())[0] || {}).updated_at; if (!u || u === subsStamp) return;
    const v = await sbGet(K_SUBS); SUBS = v && Array.isArray(v.list) ? v.list.filter((x) => x && x.endpoint && x.keys) : []; subsStamp = u; log("푸시 받을 기기", SUBS.length + "대", SUBS.map((x) => x.ua).join(", "));
  } catch (e) { /* 다음에 */ }
}
async function notify(p) {   /* p = {title, body, tag, coin, iv, kind, test, tg(텔레그램 글)} */
  if (p.tg) tgSend(p.tg);   /* 폰 푸시와 따로 — 폰 기기가 없거나 상한에 걸려도 텔레그램은 감 */
  const now = Date.now(); while (sent.length && now - sent[0] > 60000) sent.shift();
  if (sent.length >= 30) { muted++; log("분당 상한 — 보내지 않음:", p.title); return false; }
  sent.push(now);
  if (DRY) { log("[DRY 푸시]", p.title, "|", p.body, "→", SUBS.length + "대"); return true; }
  if (!SUBS.length) { log("받을 기기가 없어 보내지 못함:", p.title); return false; }
  const payload = JSON.stringify({ ...p, t: now }); let okN = 0; const dead = [];
  await Promise.all(SUBS.map(async (sub) => {
    for (let a = 0; a < 2; a++) {
      try { await webpush.sendNotification(sub, payload, { TTL: 120, urgency: "high", topic: p.tag ? String(p.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined : undefined }); okN++; return; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { dead.push(sub.endpoint); return; } if (a === 1) log("푸시 실패:", e.statusCode || e.message, (sub.ua || "")); else await sleep(500); }
    }
  }));
  if (dead.length) { try { await sbUpdate(K_SUBS, (v) => { v.list = (v.list || []).filter((x) => !dead.includes(x.endpoint)); return dead.length; }, "알림서버"); subsStamp = ""; log("만료된 기기 구독 삭제", dead.length); } catch (e) { log("구독 정리 실패:", e.message); } }
  log("푸시 보냄", okN + "/" + SUBS.length, p.title); return okN > 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───── 설정·기록 ───── */
let S = { alerts: [], pvAlerts: [], alPhone: true }, stamp = "", SRV = { seen: {}, fired: {}, sig: { seen: [], init: {} } }, dirty = false;
async function loadSrv() { const v = await sbGet(K_SRV); if (v && typeof v === "object") SRV = { seen: v.seen || {}, fired: v.fired || {}, sig: { seen: (v.sig && v.sig.seen) || [], init: (v.sig && v.sig.init) || {} } }; }
async function saveSrv(force) { if (DRY || !(dirty || force)) return; dirty = false; await sbPut(K_SRV, { hb: Date.now(), t0: T0, seen: SRV.seen, fired: SRV.fired, sig: SRV.sig, subs: SUBS.length, tg: TGSTAT, v: 2 }); }
async function refreshState() {
  try {
    if (process.env.CSA_STATE_FILE) { const st = JSON.parse(fs.readFileSync(process.env.CSA_STATE_FILE, "utf8")); S = { alerts: st.alerts || [], pvAlerts: st.pvAlerts || [], alPhone: st.alPhone !== false }; return afterState(); }
    const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=updated_at&key=eq." + K_STATE, { headers: { apikey: SBK, Authorization: "Bearer " + SBK }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return; const rows = await r.json(); const u = rows[0] && rows[0].updated_at; if (!u || u === stamp) return;   /* 바뀐 게 없으면 큰 값은 받지 않음 */
    const v = await sbGet(K_STATE); const st = v && (v.state || v); if (!st) return;
    stamp = u; S = { alerts: Array.isArray(st.alerts) ? st.alerts : [], pvAlerts: Array.isArray(st.pvAlerts) ? st.pvAlerts : [], alPhone: st.alPhone !== false };
    afterState();
  } catch (e) { log("설정 읽기 실패(다음에 다시):", e.message); }
}
function afterState() {
  const ids = new Set(S.alerts.map((a) => a.id));
  for (const a of S.alerts) { if (!a.on) delete SRV.fired[a.id]; else if (SRV.fired[a.id] != null && SRV.fired[a.id] !== a.px) delete SRV.fired[a.id]; }   /* 다시 켜거나 가격을 바꾸면 한 번짜리 알림도 다시 무장 */
  for (const id of Object.keys(SRV.fired)) if (!ids.has(id)) delete SRV.fired[id];
  const pids = new Set(S.pvAlerts.map((a) => a.id)); for (const id of Object.keys(SRV.seen)) if (!pids.has(id)) { delete SRV.seen[id]; dirty = true; }
  syncSubs();
  for (const a of S.pvAlerts) if (a.on && !SRV.seen[a.id] && !seeding.has(a.id)) seed(a);
  const T = sigTargets(); for (const iv of Object.keys(T)) if (Object.keys(T[iv]).some((c) => !SRV.sig.init[iv + "|" + c + "|w2"])) sigCheck(iv).catch((e) => log("신호 기준선 오류:", e.message));   /* 방금 건 알람: 바로 기준선을 잡아 다음 봉 마감 신호부터 옴 */
}

/* ───── 가격: 호가 웹소켓 ───── */
let ws = null, wsOpen = false, lastMsg = 0, retry = 0; const subbed = new Set(), prev = new Map(), cool = new Map();
const wantCoins = () => new Set(S.alerts.filter((a) => a.on && a.coin && a.px > 0).map((a) => a.coin));
const sub = (m, c) => { try { ws.send(JSON.stringify({ method: m, subscription: { type: "bbo", coin: c } })); } catch (e) { /* 재연결 때 다시 */ } };
function syncSubs() {
  const want = wantCoins(); if (!ws || !wsOpen) return;
  for (const c of want) if (!subbed.has(c)) { subbed.add(c); sub("subscribe", c); }
  for (const c of [...subbed]) if (!want.has(c)) { subbed.delete(c); sub("unsubscribe", c); }
}
function connect() {
  ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
  ws.onopen = () => { wsOpen = true; retry = 0; lastMsg = Date.now(); subbed.clear(); log("호가 연결됨"); syncSubs(); };
  ws.onmessage = (e) => {
    lastMsg = Date.now(); let m; try { m = JSON.parse(e.data); } catch (er) { return; }
    if (m.channel !== "bbo" || !m.data) return; const d = m.data, b = +(d.bbo && d.bbo[0] && d.bbo[0].px), s = +(d.bbo && d.bbo[1] && d.bbo[1].px);
    if (b > 0 && s > 0) onMid(d.coin, (b + s) / 2);
  };
  ws.onclose = () => { wsOpen = false; ws = null; retry++; setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(retry, 5))); };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* 무시 */ } };
}
function onMid(coin, cur) {
  const now = Date.now();
  for (const a of S.alerts) {
    if (!a.on || a.coin !== coin || !(a.px > 0)) continue;
    const p = prev.get(a.id); prev.set(a.id, cur); if (p == null) continue;
    if (((p < a.px && cur >= a.px) || (p > a.px && cur <= a.px)) && now - (cool.get(a.id) || 0) > 8000 && SRV.fired[a.id] == null) {   /* 브라우저와 같음: 가로지른 순간 · 8초 안의 떨림은 한 번 */
      cool.set(a.id, now); if (a.rep === false) { SRV.fired[a.id] = a.px; dirty = true; }
      log("가격 도달", coin, a.px, "현재", cur);
      const tg = [`🔔 <b>가격 알림</b>`, `<b>${esc(nameOf(coin))}</b> <code>${esc(String(coin).split(":").pop())}</code>`, `${p < a.px ? "▲ 상향 돌파" : "▼ 하향 이탈"}  목표 <b>${fmtPx(a.px)}</b>`, `현재가 ${fmtPx(cur)}`, ...(a.srcName ? [`출처 ${esc(a.srcName)}`] : []), ...(a.rep === false ? ["1회 알림 — 자동으로 꺼짐"] : []), `🕐 ${kst(now)}`].join("\n");
      if (S.alPhone === false || a.phone === false) { log("서버 폰 푸시 꺼짐 — 텔레그램만:", coin, a.px); tgSend(tg); continue; }   /* 텔레그램은 폰 푸시 스위치와 무관하게 보냄 */
      notify({ title: `🔔 ${nameOf(coin)} ${fmtPx(a.px)} 도달`, body: `현재 ${fmtPx(cur)}${a.srcName ? " · " + a.srcName : ""}${a.rep === false ? " · 1회 알림(꺼짐)" : ""} · ${kst(now)}`, tag: "px" + a.id, coin, kind: "px", tg });
    }
  }
}

/* ───── 다이버전스: 브라우저 divscan.js 의 scanOne 과 같은 판독 ───── */
const HL = "https://api.hyperliquid.xyz/info";
async function candles(coin, iv, n) {
  const ms = IVMS[iv], end = Date.now() + ms;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: iv, startTime: Math.max(0, end - (n + 2) * ms), endTime: end } }), signal: AbortSignal.timeout(20000) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) return j.map((k) => ({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v })); }
    } catch (e) { /* 재시도 */ }
    await sleep(500 * (a + 1));
  }
  throw new Error("캔들 못 받음 " + coin + " " + iv);
}
async function scanDivs(coin, iv) {
  const days = 30, ms = IVMS[iv], need = Math.ceil((days * 864e5) / ms) + 120, take = Math.max(400, need + 300);
  let cs = await candles(coin, iv, take + 20); if (cs.length < 80) return [];
  cs = cs.slice(-Math.max(400, Math.min(cs.length, need + 300)));
  const pv = PV.analyze(cs, { model: PV.models.small, t1: 0.5, t2: 0.7, t3: 0.85, cooldown: 5, invBars: 12 });
  const sh = detectShapes(cs, pv.signals, { sens: "mid", recent: cs.length, histWin: cs.length }), n = cs.length, out = [];
  ((sh && sh.divs) || []).forEach((d) => { const b = d.b, bar = cs[b.i]; if (bar) out.push({ iv, dir: d.dir, hidden: !!d.hidden, forming: d.state === "forming", t: bar.time, ageBars: n - 1 - b.i, rsiA: d.ra, rsiB: d.rb }); });
  return out;
}
const keyOf = (a, iv, d) => `${a.id}|${iv}|${d.dir}|${d.t}`;
const seeding = new Set();
async function seed(a) {   /* 처음 보는 알람: 지금 있는 완성된 다이버전스는 '이미 본 것'으로만 기록(과거 신호가 한꺼번에 오지 않게) */
  seeding.add(a.id); const seen = [];
  for (const iv of a.ivs || []) { if (!IVMS[iv]) continue; try { (await scanDivs(a.coin, iv)).filter((d) => !d.forming).forEach((d) => seen.push(keyOf(a, iv, d))); } catch (e) { log("기준선 실패:", e.message); } }
  if (!FORCE) { SRV.seen[a.id] = seen.slice(-200); dirty = true; } else SRV.seen[a.id] = []; seeding.delete(a.id); log("다이버전스 기준선", a.coin, a.ivs, seen.length + "개");
}
async function check(coin, iv) {
  const as = S.pvAlerts.filter((a) => a.on && a.coin === coin && (a.ivs || []).includes(iv) && SRV.seen[a.id]); if (!as.length) return;
  let divs; try { divs = await scanDivs(coin, iv); } catch (e) { log(e.message); return; }
  for (const a of as) for (const d of divs) {
    if (d.forming || d.ageBars > (FORCE ? 1e9 : 6)) continue; if ((a.dir === "up" && d.dir < 0) || (a.dir === "dn" && d.dir > 0)) continue;
    const k = keyOf(a, iv, d), seen = SRV.seen[a.id]; if (!seen || seen.includes(k)) continue;
    seen.push(k); if (seen.length > 200) seen.shift(); dirty = true;
    log("다이버전스 완성", coin, iv, d.dir > 0 ? "상승" : "하락");
    const tg = [`📡 <b>다이버전스 완성</b>`, `<b>${esc(nameOf(coin))}</b> <code>${esc(String(coin).split(":").pop())}</code> · ${ivL(iv)}`, `${d.dir > 0 ? "🟢 상승" : "🔴 하락"} ${d.hidden ? "히든 " : ""}다이버전스 (${d.dir > 0 ? "저점 상승" : "고점 하락"})`, `RSI ${Math.round(d.rsiA)} → ${Math.round(d.rsiB)}`, `🕐 ${kst(Date.now())}`].join("\n");
    if (S.alPhone === false || a.phone === false) { log("폰 알림 꺼짐 — 텔레그램만(다이버전스)", coin, iv); tgSend(tg); continue; }
    notify({ title: `📡 ${nameOf(coin)} ${IVN[iv] || iv} ${d.dir > 0 ? "상승" : "하락"} ${d.hidden ? "히든 " : ""}다이버전스 완성`, body: `PivotScope ${ivL(iv)} ${d.dir > 0 ? "저점 상승" : "고점 하락"} (RSI ${Math.round(d.rsiA)}→${Math.round(d.rsiB)}) · ${kst(Date.now())}`, tag: `pv${a.id}${iv}${d.dir}${d.t}`, coin, iv, kind: "sig", tg });
  }
}
const BD = {}, LASTSCAN = {};
function boundaryTick() {
  const now = Date.now(), done = new Set();
  for (const a of S.pvAlerts) {
    if (!a.on || !SRV.seen[a.id]) continue;
    for (const iv of a.ivs || []) {
      const ms = IVMS[iv], key = a.coin + "|" + iv; if (!ms || done.has(key)) continue; done.add(key);
      const nb = Math.floor(now / ms) * ms, st = BD[key] || (BD[key] = { b: nb, s: 3 });
      if (st.b !== nb) { st.b = nb; st.s = 0; }
      if (st.s < 3 && now - nb >= [1200, 4500, 12000][st.s]) { st.s++; LASTSCAN[key] = now; check(a.coin, iv); }
      else if (now - (LASTSCAN[key] || 0) > 60000) { LASTSCAN[key] = now; check(a.coin, iv); }   /* 안전망: 1분마다 */
    }
  }
}

/* ───── 고점·저점 신호(PivotScope 노란 화살표) → 텔레그램만. 브라우저 신호 알림(sigfeed.js)과 같은 계산을 사이트 /api/signals 로 받아 서버가 대신 확인 → PC 가 꺼져 있어도 옴
   · 대상 종목·시간대는 아래 기본값(환경변수 CSA_SIG_COINS·CSA_SIG_IVS 로 바꿈, CSA_SIG=0 이면 끔). 봉이 닫힌 직후(+8·35·100초)에만 시간대당 한 번 호출 → 호출 수 아주 적음
   · 확정(노란) 신호만, 깨진 신호·예비(흰) 신호는 제외(브라우저 분·시간봉 규칙과 같음). 처음 보는 종목은 지금 있는 신호를 '본 것'으로만 기록(과거 신호가 한꺼번에 오지 않게) ───── */
/* (11/12) 대상 = 차트플랫폼에서 건 지표 알람(pvAlerts)의 종목·시간대·방향 그대로. 여기에 기본 4종목(하이닉스·삼성전자·나스닥100·KORU) × 30분·1·2·4시간을 항상 더해서 봄(환경변수 CSA_SIG_COINS·CSA_SIG_IVS 로 바꿈) */
const SIG_COINS = (process.env.CSA_SIG_COINS || "xyz:XYZ100,xyz:CL,xyz:SKHX,xyz:SMSN,xyz:MU,xyz:AAPL,xyz:KORU,xyz:SOXL").split(",").filter(Boolean), SIG_IVL = (process.env.CSA_SIG_IVS || "30m,1h,2h,4h,1d,3d,1w").split(",").filter((i) => IVMS[i]);
function sigTargets() {   /* { 시간대: { 종목: 방향("both"|"up"|"dn") } } */
  const T = {}, add = (iv, c, d) => { if (!IVMS[iv] || !c) return; const m = T[iv] || (T[iv] = {}); m[c] = m[c] && m[c] !== d ? "both" : d; };
  if (process.env.CSA_SIG === "0") return T;
  for (const a of S.pvAlerts) if (a.on) for (const iv of a.ivs || []) add(iv, a.coin, a.dir === "up" || a.dir === "dn" ? a.dir : "both");
  for (const iv of SIG_IVL) for (const c of SIG_COINS) add(iv, c, "both");
  return T;
}
const sigBusy = new Set();
const SIG_API = "https://hl-chartscan.vercel.app/api/signals", sigBD = {};
/* w = [확정된 봉 시각(초), 방향(1 ▲·-1 ▼), 종류(0 흰 속 빈·1 노란·2 형광 확인), 노란 개수, 확률%, 형광: 진입1/청산0, 형광: 롱1/숏-1] — 차트의 세 가지 화살표와 같은 색으로 알림 */
/* 캔들 패턴 확률분석 사이트(candle-prob)가 '이 종목·이 시간대 차트'에서 보여 주는 다음 봉 시가 갭 확률과 같은 값을 계산해 종목명 옆에 붙임.
   사이트(pred.js)와 같은 규칙: 하이퍼 실시간 캔들 → feat.js 특징 → 30분~4시간 = 분·시간봉 모델(gap_it) · 일·주·월봉 = 일봉 모델(gap_kr/gap_gl, 시장 폭·전일 나스닥 반영, 주봉=일봉 7개 묶음)
   · 종목 그룹은 짝 본주의 그룹(없으면 미국 대형주) · 내 메모 보정(adjust)까지 · 큰 흐름 지표 추세(tr)도 사이트 모듈(flowcalc.js)을 그대로 받아 같은 기본 설정으로 계산 */
const CPU = "https://candle-prob.vercel.app";
let CPL = null;
async function cpLoad() {
  if (CPL && Date.now() - CPL.t < 36e5) return CPL;
  const [fs, os, path, url] = await Promise.all(["node:fs", "node:os", "node:path", "node:url"].map((m) => import(m)));
  const dir = path.join(os.tmpdir(), "cpmod_" + Math.floor(Date.now() / 36e5)); fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "ind"), { recursive: true });
  for (const f of ["feat.js", "gb.js", "ind/flowcalc.js", "ind/shapes.js", "ind/bulkowski.js", "ind/math.js"]) { const q = path.join(dir, f); if (!fs.existsSync(q)) { const r = await fetch(`${CPU}/js/${f}`, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(f + " " + r.status); fs.writeFileSync(q, await r.text()); } }
  const J = async (u) => { const r = await fetch(`${CPU}/data/${u}?_=${Math.floor(Date.now() / 36e5)}`, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
  const flow = await import(url.pathToFileURL(path.join(dir, "ind/flowcalc.js")).href);
  const [feat, gb, m3, gap, m2, ctx] = await Promise.all([import(url.pathToFileURL(path.join(dir, "feat.js")).href), import(url.pathToFileURL(path.join(dir, "gb.js")).href), J("model3.json"), J("gap.json"), J("model.json"), J("ctx.json")]);
  const Q = { day: ctx.qqq.day, F: ctx.qqq.F }, B = { gl: new Map(ctx.br.gl), kr: new Map(ctx.br.kr) };
  return (CPL = { t: Date.now(), feat, gb, flow: flow.flowCalc, M: { it: m3.models.gap_it, kr: m2.models.gap_kr, gl: m2.models.gap_gl }, gap, Q, B });
}
let NOTES = { t: 0, a: [] };
async function cpNotes() {   /* 내 메모(서버 저장본) — 사이트가 확률 보정에 쓰는 것과 같은 행 */
  if (Date.now() - NOTES.t < 6e5) return NOTES.a; NOTES.t = Date.now();
  try { const r = await fetch(SBU + "/rest/v1/hlgrid_settings?select=value&key=like.candle_note_v1_*&limit=5000", { headers: { apikey: SBK, Authorization: "Bearer " + SBK }, signal: AbortSignal.timeout(15000) }); if (r.ok) NOTES.a = (await r.json()).map((x) => x.value).filter(Boolean); } catch (e) { /* 이전 값 유지 */ }
  return NOTES.a;
}
function memoAdj(notes, f) {   /* notes.js adjust·scoreStats 와 같은 계산 */
  let n = 0, hit = 0; for (const nt of notes) { if (nt.archived || nt.res == null || nt.touched === false || !Math.sign(nt.dir || 0)) continue; n++; hit += nt.res; }
  const rr = (hit + 2.5) / (n + 5), mult = n < 5 ? 1 : Math.max(0, Math.min(1.5, 0.5 + (rr - 0.5) * 5)); let sum = 0, cnt = 0;
  for (const nt of notes) { if (nt.archived || !nt.f || nt.f.cls !== f.cls || !(nt.dir || nt.hint) || nt.touched === false) continue; const g = nt.f, sim0 = (2 + (g.vcls === f.vcls) + (g.pos === f.pos) + (g.db === f.db) + (g.tr === f.tr) + (g.intra === f.intra ? 0.5 : 0)) / 6.5, sim = sim0 * (g.rg && f.rg && g.rg !== f.rg ? 0.5 : 1); if (sim < 0.5) continue;
    const dir = Math.sign(nt.dir || nt.hint), pw = (nt.pw100 != null ? nt.pw100 : (nt.power || 3) * 20) / 100; sum += dir * pw * 0.12 * sim * (nt.res === 1 ? 1.3 : nt.res === 0 ? 0.4 : 1); cnt++; }
  return { d: Math.tanh(sum / 0.5) * 0.5 * mult, n: cnt };
}
function usFor(s, i, Q) {   /* pred.js usFor(live) — 한국 종목: 그 봉 다음에 끝난 미국장(QQQ) 값 */
  const last = Q.day.length - 1, Dn = i + 1 < s.day.length ? s.day[i + 1] : (Q.day[last] > s.day[i] ? s.day[i] + 1 : Infinity); let lo = 0, hi = last, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (Q.day[m] < Dn) { r = m; lo = m + 1; } else hi = m - 1; }
  if (r < 0 || (Dn !== Infinity && Dn - Q.day[r] > 5)) return null; if (Dn === Infinity && Q.day[r] < s.day[i]) return s.day[i] - Q.day[r] <= 4 ? Q.F[r] : null; return Q.F[r];
}
function aggBars(bars, k, baseMs, off) {   /* data.js aggregate 와 같음(주봉 = 일봉 7개, 월요일 시작) */
  const span = k * baseMs, out = []; let cur = null;
  for (const b of bars) { const t0 = Math.floor((b[0] - off) / span) * span + off; if (!cur || cur[0] !== t0) { cur = [t0, b[1], b[2], b[3], b[4], b[5]]; out.push(cur); } else { if (b[2] > cur[2]) cur[2] = b[2]; if (b[3] < cur[3]) cur[3] = b[3]; cur[4] = b[4]; cur[5] += b[5]; } }
  return out;
}
/* 다음 봉 시가가 이 봉 종가보다 위일 확률(0~1) — 사이트 예측 패널 기본값(가장 최근 봉)과 같은 값. 실패하면 null */
export async function gapUp(c, iv) {
  const L = await cpLoad(), t = String(c).split(":").pop(), it = L.gap.items[(L.gap.alias && L.gap.alias[t]) || t], g = (it && it.g) || "us";
  const intra = !["1d", "3d", "1w", "1M"].includes(iv), now = Date.now();
  const raw = (cs) => cs.map((k) => [k.time * 1000, k.open, k.high, k.low, k.close, k.volume]);
  const bars = iv === "1w" ? aggBars(raw(await candles(c, "1d", 1500)), 7, 864e5, 4 * 864e5) : raw(await candles(c, iv, iv === "1M" ? 120 : 1500));
  const i = bars.length - 1; if (i < 5) return null;   /* 사이트 화면이 기본으로 보여 주는 봉 = 가장 최근 봉(만들어지는 중인 봉 포함)과 같게 */
  const F = L.feat.compute(bars), f = F[i], s = { day: bars.map((b) => Math.floor(b[0] / 864e5)) }; if (!f) return null;
  let M, x;
  if (intra) { M = L.M.it; x = [...L.gb.vec(f, null, g, null), Math.log(IVMS[iv] / 6e4)]; }
  else { M = g === "kr" ? L.M.kr : L.M.gl; let br = L.gb.brOf(L.B, g, s.day[i]); for (let d = 1; d <= 5 && !br; d++) br = L.gb.brOf(L.B, g, s.day[i] - d); x = L.gb.vec(f, g === "kr" ? usFor(s, i, L.Q) : null, g, br); }
  const lg = (p) => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(q / (1 - q)); };
  let p = L.gb.sigmoid(M.cal.a + M.cal.b * lg(L.gb.gbPredict(M, x)));
  let tr = 0; try { const R = bars.length >= 40 && L.flow(bars.map((b) => ({ time: b[0] / 1000, open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] })), { sens: "mid", legs: 6, showPat: true, showWave: true, showSr: true, showProj: true }); tr = Math.sign((R && R.trend) || 0); } catch (e) { /* 0 */ }   /* 사이트 pred.js 의 A.flowTrend = 큰 흐름 패턴 지표(기본 설정)의 추세 */
  const adj = memoAdj(await cpNotes(), { cls: f.cls, vcls: f.vcls, pos: f.pos, db: f.db, tr, intra, rg: g === "kr" ? "kr" : "gl" }); if (adj.n) p = L.gb.sigmoid(lg(p) + adj.d);
  return p;
}
/* 이름·티커 줄(HTML). 텔레그램은 글자색 지정이 없어: '갭상승/갭하락' 글자는 링크(하늘색), 티커 앞 점은 상승 🔴·하락 🔵 */
async function whoLine(c, iv) {
  let p = null; try { p = await gapUp(c, iv); } catch (e) { log("갭 확률 실패", c, iv, e.message); }
  const up = p >= 0.5, dot = p == null ? "" : up ? "🔴" : "🔵";
  const gap = p == null ? "" : ` [<a href="https://candle-prob.vercel.app">갭${up ? "상승" : "하락"}</a>확률${Math.round((up ? p : 1 - p) * 100)}%]`;
  return `<b>${esc(nameOf(c))}</b> ${dot}<code>${esc(String(c).split(":").pop())}</code>${gap}`;
}
async function sigTg(c, iv, w, manual) {
  const [, d, ty, n, p, en, side] = w, up = d > 0, who = [await whoLine(c, iv)];
  const a = up ? "▲" : "▼";   /* 머리줄: 동그라미 다음에 방향 화살표, 이름은 '지표' */
  const head = ty === 1 ? `🟡${a} <b>노란 지표 ${n}개 (확정)</b> · ${ivL(iv)}` : ty === 0 ? `⚪${a} <b>흰 속 빈 지표 (예비)</b> · ${ivL(iv)}` : `🟢${a} <b>형광 확인 지표</b> · ${ivL(iv)}`;
  const ar = up ? "🟢▲" : "🔴▼";   /* 내용 줄 맨 앞 화살표: 위▲=매수 방향·아래▼=매도 방향 (청산도 방향대로: 숏 청산=▲) */
  const what = ty === 2 ? `${ar} ${side > 0 ? "롱(매수)" : "숏(매도)"} ${en ? "진입" : "청산"} 확정` : `${ar} ${up ? "저점 · 상승전환 전" : "고점 · 하락전환 전"}${p ? " · 확률 " + p + "%" : ""}`;
  return tgSend([...who, head, what, "", `🕐 ${kst(Date.now())}${manual ? " · 신호 봉 " + kst(w[0] * 1000) : ""}`].join("\n"));   /* 1줄 이름·티커 / 2줄 머리 / 3줄 내용 / 빈 줄 / 시각 */
}
/* 채팅방 명령("한시간"·"하이닉스" 등) → 지금 그 시간대의 대표종목 최신 신호를 바로 보냄. 새 신호 여부와 상관없이 종목마다 가장 최근 신호 1개(없으면 없다고) */
async function sigNow(ivs, coins) {
  for (const iv of ivs) for (let i = 0; i < coins.length; i += 6) {
    const cs = coins.slice(i, i + 6); let j = null;
    for (let a = 0; a < 3 && !j; a++) { try { const r = await fetch(`${SIG_API}?v=5&iv=${iv}&coins=${encodeURIComponent(cs.join(","))}&krw=1400&_=${Date.now()}`, { signal: AbortSignal.timeout(30000) }); if (r.ok) { const x = await r.json(); if (x && x.ok) j = x; } } catch (e) { /* 재시도 */ } if (!j) await sleep(1500 * (a + 1)); }
    for (const c of cs) {
      const w = j && j.r && j.r[c] && Array.isArray(j.r[c].w) ? j.r[c].w.slice().sort((p, q) => p[0] - q[0]).pop() : null;
      if (w) await sigTg(c, iv, w, true);
      else await tgSend([await whoLine(c, iv), `⚪ ${ivL(iv)} · ${j ? "최근 신호 없음" : "신호를 못 받았어요"}`, "", `🕐 ${kst(Date.now())}`].join("\n"));
    }
  }
}
async function sigCheck(iv) {
  if (sigBusy.has(iv)) return; sigBusy.add(iv);
  try { const m = sigTargets()[iv] || {}, cs = Object.keys(m); for (let i = 0; i < cs.length; i += 6) await sigBatch(iv, cs.slice(i, i + 6), m); } finally { sigBusy.delete(iv); }   /* 사이트가 한 번에 6종목까지만 받음 */
}
async function sigBatch(iv, coins, dirs) {
  let j = null;
  for (let a = 0; a < 3 && !j; a++) {
    try { const r = await fetch(`${SIG_API}?v=5&iv=${iv}&coins=${encodeURIComponent(coins.join(","))}&krw=1400&_=${Math.floor(Date.now() / 1000)}`, { signal: AbortSignal.timeout(30000) }); if (r.ok) { const x = await r.json(); if (x && x.ok) j = x; } } catch (e) { /* 재시도 */ }
    if (!j) await sleep(1500 * (a + 1));
  }
  if (!j) { log("신호 못 받음", iv); return; }
  const seen = SRV.sig.seen, dur = IVMS[iv] / 1000, now = Date.now() / 1000;
  for (const c of coins) {
    const x = j.r && j.r[c]; if (!x || !Array.isArray(x.w)) continue; const ik = iv + "|" + c + "|w2", first = !SRV.sig.init[ik] && !FORCE;   /* |w = 세 종류 화살표 방식(예전 노란 전용 기록과 분리) */
    for (const w of x.w) {
      const k = iv + "|" + c + "|" + [w[0], w[1], w[2], w[5], w[6]].join(",");   /* 확률·개수는 뒤 봉이 닫히면 조금씩 바뀌어서 키에서 뺌(안 빼면 같은 신호가 또 옴) */ if (!FORCE && seen.includes(k)) continue;
      seen.push(k); dirty = true;
      if (first || (dirs[c] === "up" && w[1] < 0) || (dirs[c] === "dn" && w[1] > 0)) continue;   /* 알람에서 고른 방향(상승만=▲·하락만=▼)만 · 기준선 기록은 알리지 않음 (깨진 신호는 서버가 이미 뺌) */
      if (!FORCE && now - (w[0] + dur) > Math.max(2 * dur, 3600)) continue;   /* 서버가 오래 꺼져 있다 뒤늦게 발견한 옛 신호는 알리지 않음 */
      log("신호", c, iv, ["흰", "노란", "형광"][w[2]], w[1] > 0 ? "▲" : "▼"); sigTg(c, iv, w);
    }
    SRV.sig.init[ik] = 1; dirty = true;
  }
  if (seen.length > 800) seen.splice(0, seen.length - 800);
}
function sigTick() {
  const now = Date.now();
  for (const iv of Object.keys(sigTargets())) {
    const ms = IVMS[iv], nb = Math.floor(now / ms) * ms, st = sigBD[iv] || (sigBD[iv] = { b: nb, s: 3 });
    if (st.b !== nb) { st.b = nb; st.s = 0; }
    /* (11/12) 사이트가 응답을 '봉 마감 +20초'까지 보관하고 그 뒤 5분은 옛 응답을 먼저 돌려줘서 신호가 100초쯤 늦었음 → 주소 끝에 매번 다른 값(_=)을 붙여 항상 새로 계산시키고 +3·12·45초에 확인. 하루 약 250회라 비용 영향 거의 없음 */
    if (st.s < 3 && now - nb >= [3000, 12000, 45000][st.s]) { st.s++; sigCheck(iv).catch((e) => log("신호 확인 오류:", e.message)); }
  }
}

/* ───── 실행 ───── */
async function main() {
  if (!DRY && !VAPID_PRIV) { log("VAPID_PRIVATE_KEY 가 없어 종료"); return; }
  if (VAPID_PRIV) webpush.setVapidDetails("https://hl-chartscan.vercel.app", VAPID_PUB, VAPID_PRIV);
  log("폰 알림 서버 시작", DRY ? "(DRY)" : "", "최대", MAXMIN, "분");
  await loadSrv(); await loadSubs(); await refreshState(); connect();
  let lastCmd = ((await sbGet(K_CMD)) || {}).id || "";   /* 시작 때 이미 있던 시험 요청은 무시 */
  let lastSig = ((await sbGet("cs_alert_sig_cmd")) || {}).id || "";   /* 채팅방 명령(챗봇이 씀) */
  setInterval(async () => { const c = await sbGet("cs_alert_sig_cmd"); if (c && c.id && c.id !== lastSig) { lastSig = c.id; const ivs = (c.ivs || []).filter((i) => IVMS[i]), cs = (c.coins && c.coins.length ? c.coins : SIG_COINS); log("채팅 신호 요청", ivs, cs.length + "종목"); sigNow(ivs, cs).catch((e) => log("채팅 신호 오류:", e.message)); } }, 2000);
  setInterval(async () => { await loadSubs(); const c = await sbGet(K_CMD); if (c && c.id && c.id !== lastCmd) { lastCmd = c.id; log("시험 알림 요청", c.id); notify({ title: "🔔 시험 알림", body: "폰 알림이 정상으로 오고 있어요 · " + kst(Date.now()), tag: "test", kind: "px", test: true, tg: `🔔 <b>시험 알림</b>\n텔레그램 알림이 정상으로 오고 있어요\n🕐 ${kst(Date.now())}` }); } }, 5000);
  { const T = sigTargets(); log("고점·저점 신호 텔레그램 대상:", JSON.stringify(T)); for (const iv of Object.keys(T)) await sigCheck(iv).catch((e) => log("신호 기준선 오류:", e.message)); setInterval(sigTick, 1000); }   /* 시작 때 한 번: 처음이면 기준선만, 재시작이면 그 사이 놓친 최근 신호만 알림 */
  setInterval(refreshState, 5000); setInterval(boundaryTick, 500); setInterval(() => saveSrv(false), 3000); setInterval(() => saveSrv(true), 30000);   /* 30초마다 '살아 있음' 기록 */
  setInterval(() => { if (ws && wsOpen && Date.now() - lastMsg > 30000) { log("호가 소식이 끊겨 재연결"); try { ws.close(); } catch (e) { /* 무시 */ } } }, 10000);
  setInterval(() => { if (ws && wsOpen) { try { ws.send(JSON.stringify({ method: "ping" })); } catch (e) { /* 무시 */ } } }, 15000);
  setInterval(() => log(`상태: 가격알림 ${S.alerts.filter((a) => a.on).length}개(종목 ${wantCoins().size}) · 다이버전스 ${S.pvAlerts.filter((a) => a.on).length}개 · 호가 ${wsOpen ? "연결" : "끊김"} · 보낸 알림(최근 1분) ${sent.length}`), 300000);
  const end = T0 + MAXMIN * 60000; while (Date.now() < end) await sleep(1000);
  await saveSrv(true); log("정해진 시간이 끝나 종료(다음 실행이 이어받음)"); process.exit(0);
}
main();
