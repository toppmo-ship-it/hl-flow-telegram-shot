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
const IVN = { "30m": "30분", "1h": "1시간", "2h": "2시간", "4h": "4시간", "8h": "8시간", "1d": "일봉" }, IVMS = { "30m": 18e5, "1h": 36e5, "2h": 72e5, "4h": 144e5, "8h": 288e5, "1d": 864e5 };

/* ───── 텔레그램 전송: 리포트 방(TG_CHAT_ID2, 비면 기본 방 TG_CHAT_ID) — 폰 푸시와 같은 알림을 글로도 보냄 ───── */
const TG_TOKEN = clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, ""), TG_ROOM = clean(process.env.TG_CHAT_ID2) || clean(process.env.TG_CHAT_ID);
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
    const tg = [`📡 <b>다이버전스 완성</b>`, `<b>${esc(nameOf(coin))}</b> <code>${esc(String(coin).split(":").pop())}</code> · ${IVN[iv] || iv}봉`, `${d.dir > 0 ? "🟢 상승" : "🔴 하락"} ${d.hidden ? "히든 " : ""}다이버전스 (${d.dir > 0 ? "저점 상승" : "고점 하락"})`, `RSI ${Math.round(d.rsiA)} → ${Math.round(d.rsiB)}`, `🕐 ${kst(Date.now())}`].join("\n");
    if (S.alPhone === false || a.phone === false) { log("폰 알림 꺼짐 — 텔레그램만(다이버전스)", coin, iv); tgSend(tg); continue; }
    notify({ title: `📡 ${nameOf(coin)} ${IVN[iv] || iv} ${d.dir > 0 ? "상승" : "하락"} ${d.hidden ? "히든 " : ""}다이버전스 완성`, body: `PivotScope ${IVN[iv] || iv}봉 ${d.dir > 0 ? "저점 상승" : "고점 하락"} (RSI ${Math.round(d.rsiA)}→${Math.round(d.rsiB)}) · ${kst(Date.now())}`, tag: `pv${a.id}${iv}${d.dir}${d.t}`, coin, iv, kind: "sig", tg });
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
const SIG_COINS = (process.env.CSA_SIG_COINS || "xyz:SKHX,xyz:SMSN,xyz:XYZ100").split(",").filter(Boolean), SIG_IVL = (process.env.CSA_SIG_IVS || "30m,1h,2h").split(",").filter((i) => IVMS[i]);
const SIG_API = "https://hl-chartscan.vercel.app/api/signals", sigBD = {};
function sigTg(c, iv, s) {   /* s = [봉시각(초), 방향(1=저점·-1=고점), 확정, 확률%, 깨짐, 반대전환, 진입가, …, 등급(11)] */
  const top = s[1] < 0, n = Math.min(3, s[11] > 0 ? s[11] : 1);
  return tgSend([`📡 <b>${top ? "고점" : "저점"} 신호</b> · ${IVN[iv] || iv}봉`, `<b>${esc(nameOf(c))}</b> <code>${esc(String(c).split(":").pop())}</code>`, `${top ? "🔴 하락전환 전 (고점)" : "🟢 상승전환 전 (저점)"} · 노란 화살표 ${n}개(확정)`, `확률 ${s[3]}%${s[6] > 0 ? " · 신호 봉 종가 " + fmtPx(s[6]) : ""}`, `🕐 ${kst(Date.now())}`].join("\n"));
}
async function sigCheck(iv) {
  let j = null;
  for (let a = 0; a < 3 && !j; a++) {
    try { const r = await fetch(`${SIG_API}?v=5&iv=${iv}&coins=${encodeURIComponent(SIG_COINS.join(","))}&krw=1400`, { signal: AbortSignal.timeout(30000) }); if (r.ok) { const x = await r.json(); if (x && x.ok) j = x; } } catch (e) { /* 재시도 */ }
    if (!j) await sleep(1500 * (a + 1));
  }
  if (!j) { log("신호 못 받음", iv); return; }
  const seen = SRV.sig.seen, dur = IVMS[iv] / 1000, now = Date.now() / 1000;
  for (const c of SIG_COINS) {
    const x = j.r && j.r[c]; if (!x) continue; const first = !SRV.sig.init[iv + "|" + c] && !FORCE;
    for (const s of x.s || []) {
      const k = iv + "|" + c + "|" + s[0]; if (!FORCE && seen.includes(k)) continue;
      seen.push(k); dirty = true;
      if (first || !s[2] || s[4]) continue;   /* 기준선 기록·예비(흰)·깨진 신호는 알리지 않음 */
      if (!FORCE && now - (s[0] + dur) > Math.max(2 * dur, 3600)) continue;   /* 서버가 오래 꺼져 있다 뒤늦게 발견한 옛 신호는 알리지 않음 */
      log("신호", c, iv, s[1] > 0 ? "저점" : "고점"); sigTg(c, iv, s);
    }
    SRV.sig.init[iv + "|" + c] = 1; dirty = true;
  }
  if (seen.length > 400) seen.splice(0, seen.length - 400);
}
function sigTick() {
  const now = Date.now();
  for (const iv of SIG_IVL) {
    const ms = IVMS[iv], nb = Math.floor(now / ms) * ms, st = sigBD[iv] || (sigBD[iv] = { b: nb, s: 3 });
    if (st.b !== nb) { st.b = nb; st.s = 0; }
    if (st.s < 3 && now - nb >= [8000, 35000, 100000][st.s]) { st.s++; sigCheck(iv).catch((e) => log("신호 확인 오류:", e.message)); }
  }
}

/* ───── 실행 ───── */
async function main() {
  if (!DRY && !VAPID_PRIV) { log("VAPID_PRIVATE_KEY 가 없어 종료"); return; }
  if (VAPID_PRIV) webpush.setVapidDetails("https://hl-chartscan.vercel.app", VAPID_PUB, VAPID_PRIV);
  log("폰 알림 서버 시작", DRY ? "(DRY)" : "", "최대", MAXMIN, "분");
  await loadSrv(); await loadSubs(); await refreshState(); connect();
  let lastCmd = ((await sbGet(K_CMD)) || {}).id || "";   /* 시작 때 이미 있던 시험 요청은 무시 */
  setInterval(async () => { await loadSubs(); const c = await sbGet(K_CMD); if (c && c.id && c.id !== lastCmd) { lastCmd = c.id; log("시험 알림 요청", c.id); notify({ title: "🔔 시험 알림", body: "폰 알림이 정상으로 오고 있어요 · " + kst(Date.now()), tag: "test", kind: "px", test: true, tg: `🔔 <b>시험 알림</b>\n텔레그램 알림이 정상으로 오고 있어요\n🕐 ${kst(Date.now())}` }); } }, 5000);
  if (SIG_COINS.length && SIG_IVL.length && process.env.CSA_SIG !== "0") { log("고점·저점 신호 텔레그램:", SIG_COINS.join(","), SIG_IVL.join(",")); for (const iv of SIG_IVL) await sigCheck(iv).catch((e) => log("신호 기준선 오류:", e.message)); setInterval(sigTick, 1000); }   /* 시작 때 한 번: 처음이면 기준선만, 재시작이면 그 사이 놓친 최근 신호만 알림 */
  setInterval(refreshState, 5000); setInterval(boundaryTick, 500); setInterval(() => saveSrv(false), 3000); setInterval(() => saveSrv(true), 30000);   /* 30초마다 '살아 있음' 기록 */
  setInterval(() => { if (ws && wsOpen && Date.now() - lastMsg > 30000) { log("호가 소식이 끊겨 재연결"); try { ws.close(); } catch (e) { /* 무시 */ } } }, 10000);
  setInterval(() => { if (ws && wsOpen) { try { ws.send(JSON.stringify({ method: "ping" })); } catch (e) { /* 무시 */ } } }, 15000);
  setInterval(() => log(`상태: 가격알림 ${S.alerts.filter((a) => a.on).length}개(종목 ${wantCoins().size}) · 다이버전스 ${S.pvAlerts.filter((a) => a.on).length}개 · 호가 ${wsOpen ? "연결" : "끊김"} · 보낸 알림(최근 1분) ${sent.length}`), 300000);
  const end = T0 + MAXMIN * 60000; while (Date.now() < end) await sleep(1000);
  await saveSrv(true); log("정해진 시간이 끝나 종료(다음 실행이 이어받음)"); process.exit(0);
}
main();
