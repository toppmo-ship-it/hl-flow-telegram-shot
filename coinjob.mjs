/* 코인 전용 작업 — 5시간 40분씩 이어달리는 별도 GitHub 작업(coin.yml). 주식 리포트(5분 사슬)·챗봇과 서버·호출 한도가 따로라 서로 느려지지 않음.
   10분마다: 전 코인 시세 → 캔들 이어받기 → 지표 → 진입 감지 → 코인 알림 / 설정한 주기(기본 30분)마다: TM Coin Daily Report 2장 전송
   설정: Supabase tg_coin_cfg (설정 페이지·챗봇이 씀) · 수동 요청: tg_coin_cmd (챗봇 '코인리포트' · 설정 페이지 '지금 보내기')
   환경변수: TG_BOT_TOKEN, TG_CHAT_ID, HL_BUDGET(기본 900), BOT_MAX_MIN(기본 335), BOT_DRY=1(전송·저장 안 함 — 사진은 out_coin/) */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSiteInfo, usdKrw } from "./extras.mjs";
import { sbGet, sbPut } from "./sb.mjs";
import { createKit, resKeyOf } from "./kit.mjs";
import { loadStore, saveStore, restoreSnaps, saveSnaps, backupSnaps } from "./coindata.mjs";
import { gather } from "./coinpipe.mjs";
import { buildCoinReport } from "./coinreport.mjs";
import { normCoinCfg } from "./coincfg.mjs";
import { median } from "./coincalc.mjs";
import { fmtKrw } from "./mcap.mjs";
import * as F from "./chatfmt.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url)), SITE = path.join(ROOT, "site"), CACHE = process.env.COIN_CACHE || path.join(ROOT, ".cache");
const DRY = /^(1|true)$/i.test(process.env.BOT_DRY || ""), MAX_MS = (+process.env.BOT_MAX_MIN || 335) * 60000, T0 = Date.now(), TICK = 10 * 60000;
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
const TOKEN = clean(process.env.TG_BOT_TOKEN).replace(/^bot/i, ""), CHAT = clean(process.env.TG_CHAT_ID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const W = async (k, v) => (DRY ? (log("[dry] 저장 생략", k), true) : sbPut(k, v));
const ctx = { info: null, uni: [], fx: 1350 };
const kit = createKit({ dry: DRY, token: TOKEN, chat: CHAT, root: ROOT, site: SITE, cache: CACHE, log, getCtx: async () => ctx, busy: () => {}, outDir: path.join(ROOT, "out_coin") });
const { say, photo } = kit;

/* ── 코인 한 줄 요약(알림 글) ── */
const sg = (x, d) => (x == null || !isFinite(x) ? "–" : (x > 0 ? "+" : "") + x.toFixed(d == null ? 2 : d));
const coinLine = (r) => {
  const v = r.v;
  return "🪙 <b>" + F.esc(r.tk) + "</b> · " + F.esc(r.name) + "  <i>(" + F.esc(r.cat) + ")</i>\n💰 " + F.fmtPx(v.px) + "  24h " + sg(v.chg) + "%  7일 " + sg(v.ret7, 1) + "%  · 대금 " + F.eok(v.eok) + "억" + (v.mcKrw ? " · 시총 " + fmtKrw(v.mcKrw) : "") +
    "\n양W " + (v.w > 0 ? "+" : "") + v.w + " · 켈 " + (v.kc === 1 ? "✅" + (v.kelu > 0 ? " " + Math.round(v.kelu) + "일" : "") : "▫️") + " · 4H중심 " + (v.h4m === 1 ? "✅" : "▫️") + " · 발산 " + (v.h4u === 1 ? "✅" : "▫️") + " · 펀딩 연 " + sg(v.apr, 0) + "% · 미결제 " + F.eok(v.oiEok) + "억";
};

/* ── 코인 알림: 전 코인 감시(진입 감지는 주식과 같은 규칙, 그 밖에 거래대금·급변동·펀딩·미결제) ── */
async function doAlerts(g, cfg, shotCfg) {
  const A = cfg.alerts; if (!A.on) return 0;
  const now = g.now, SA = (await sbGet("tg_coin_alert_state")) || {}; SA.cool = SA.cool || {};
  Object.keys(SA.cool).forEach((k) => { if (now - SA.cool[k] > 9 * 3600e3) delete SA.cool[k]; });
  const cool = (key, min) => { if (now - (SA.cool[key] || 0) < min * 60000) return false; SA.cool[key] = now; return true; };
  const by = Object.fromEntries(g.rows.map((r) => [r.tk, r])), ok = (r) => r && (!A.minEok || r.v.eok >= A.minEok), fires = [];
  for (const e of g.fresh) {
    const r = by[e.k]; if (!ok(r)) continue;
    const labs = [], has = (re) => e.kinds.some((x) => re.test(x));
    if (A.kel.on && has(/^켈/) && cool(e.k + "|kel", 240)) labs.push("🟧 켈상단 돌파");
    if (A.w2.on && e.kinds.some((x) => /^양W:[^>]*>2$/.test(x) && !/^양W:2>/.test(x)) && cool(e.k + "|w2", 240)) labs.push("💚 양W +2 도달");
    if (A.core.on && has(/^핵심$/) && cool(e.k + "|core", 240)) labs.push("⭐ ★핵심 진입");
    if (A.h4u.on && has(/^발산/) && cool(e.k + "|h4u", 240)) labs.push("🔥 4H 발산 진입");
    if (A.h4m.on && has(/^4H/) && cool(e.k + "|h4m", 240)) labs.push("🕓 4H 중심 진입");
    if (!labs.length && A.entry.on && cool(e.k + "|entry", 240)) labs.push("🚪 진입");
    if (labs.length) fires.push({ r, title: labs.join(" · ") });
  }
  if (A.vol.on) g.rows.filter((r) => ok(r) && r.v.volx != null && r.v.volx >= A.vol.mult && r.v.eok >= 3).forEach((r) => { if (cool(r.tk + "|vol", 360)) fires.push({ r, title: "💰 거래대금 급증 ×" + r.v.volx.toFixed(1) + " (7일 평균 대비)" }); });
  if (A.surge.on) {
    const key = A.surge.mins <= 30 ? "ch30" : "ch1h", have = g.rows.filter((r) => r.v[key] != null), m = median(have.map((r) => r.v[key])) || 0;
    have.map((r) => ({ r, rel: r.v[key] - m })).filter((x) => ok(x.r) && Math.abs(x.rel) >= A.surge.pct && x.r.v.eok >= 3).sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 6).forEach((x) => { if (cool(x.r.tk + "|surge", 60)) fires.push({ r: x.r, title: "🚨 급변동 " + sg(x.rel) + "%p (" + A.surge.mins + "분 · 시장 " + sg(m) + "% 대비)" }); });
  }
  if (A.fund.on) g.rows.filter((r) => ok(r) && r.v.oiEok >= 3 && Math.abs(r.v.apr) >= A.fund.apr).forEach((r) => { if (cool(r.tk + "|fund", 480)) fires.push({ r, title: "💸 펀딩 과열 연 " + sg(r.v.apr, 0) + "% (" + (r.v.apr > 0 ? "롱 쏠림" : "숏 쏠림") + ")" }); });
  if (A.oi.on) g.rows.filter((r) => ok(r) && r.v.oi4h != null && r.v.oiEok >= 3 && Math.abs(r.v.oi4h) >= A.oi.pct).forEach((r) => { if (cool(r.tk + "|oi", 240)) fires.push({ r, title: "📊 미결제 4시간 " + sg(r.v.oi4h, 1) + "%" + (r.v.quad ? " · " + r.v.quad : "") }); });
  await W("tg_coin_alert_state", SA);
  /* 같은 코인에 여러 알림이 겹치면 한 통으로 묶음 */
  const merged = new Map(); fires.forEach((x) => { const m = merged.get(x.r.tk); if (m) m.title += "\n" + x.title; else merged.set(x.r.tk, { r: x.r, title: x.title }); });
  fires.length = 0; merged.forEach((x) => fires.push(x));
  if (!fires.length) return 0;
  const days = [30, 60, 90, 120, 150].includes(+shotCfg.cardDailyDays) ? +shotCfg.cardDailyDays : 120, res = resKeyOf(shotCfg);
  let photos = 6;
  for (const f of fires.slice(0, 14)) {
    const text = "🪙 <b>" + f.title + "</b>\n" + coinLine(f.r), mk = F.cardButtons(f.r.tk, "1d");
    let sent = false;
    if (A.photo && photos > 0) { photos--; try { const c = await kit.makeCard(f.r.tk, "1d", days, shotCfg, res, { full: f.r.tk, short: f.r.tk, dex: "코인" }); if (c) { await photo(c.png, text, mk, true); sent = true; } } catch (e) { log("코인 알림 사진 실패", f.r.tk, String((e && e.message) || e).slice(0, 80)); } }
    if (!sent) await say(text, mk);
    await sleep(DRY ? 0 : 1100);
  }
  if (fires.length > 14) await say("… 그 밖에 코인 알림 " + (fires.length - 14) + "건 더 있었어요 (설정 페이지에서 기준을 높일 수 있어요)");
  return fires.length;
}

/* ── 리포트 보내기(2장) ── */
async function sendReport(g, cfg, shotCfg) {
  const rep = buildCoinReport({ cfg, rows: g.rows, meta: g.meta, mv: g.mv, fx: ctx.fx, now: g.now, ent: g.ent });
  const res = resKeyOf(shotCfg);
  for (let i = 0; i < rep.parts.length; i++) {
    const p = rep.parts[i], png = await kit.drawReportPng(p, res);
    log("코인 리포트 PNG", (i + 1) + "/" + rep.parts.length, Math.round(png.length / 1024) + "KB");
    const mid = await photo(png, p.caption, null, false, "coin_part" + (i + 1));
    if (shotCfg.doc !== false && !DRY) { try { await kit.document(png, "coin_report_" + (i + 1) + ".png", mid); } catch (e) {} }
    await sleep(DRY ? 0 : 1200);
  }
  return rep.meta;
}

/* ── 메인 ── */
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (!DRY && (!TOKEN || !CHAT)) { log("TG_BOT_TOKEN / TG_CHAT_ID 가 없어 종료"); return; }
  ctx.info = loadSiteInfo(SITE); ctx.fx = await usdKrw(() => {});
  const S = loadStore(CACHE), snaps = await restoreSnaps(CACHE);
  let st = (() => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, "coin_state.json"), "utf8")); } catch (e) { return null; } })();
  const stateIO = { read: () => sbGet("tg_coin_state"), write: (s) => W("tg_coin_state", s) };
  let last = (await sbGet("tg_coin_last")) || {}, lastTick = 0, lastBackup = Date.now(), lastFx = Date.now(), lastManualTry = 0, told = null;
  log("코인 작업 시작", DRY ? "(시험 모드)" : "", "저장된 캔들", Object.keys(S.c).length + "종목", "스냅샷", snaps.length);
  while (Date.now() - T0 < MAX_MS) {
    const now = Date.now();
    try {
      const cfg = normCoinCfg(process.env.COIN_CFG_JSON ? JSON.parse(process.env.COIN_CFG_JSON) : await sbGet("tg_coin_cfg")), cmd = DRY ? null : await sbGet("tg_coin_cmd");   /* COIN_CFG_JSON: 시험용 설정 덮어쓰기 */
      const manual = !!(cmd && cmd.id && cmd.id !== last.cmd);   /* 아직 처리 안 한 '지금 보내기' 요청 */
      if ((manual && now - lastManualTry >= 60000) || now - lastTick >= TICK) {
        lastTick = now; if (manual) lastManualTry = now;
        if (now - lastFx > 3600e3) { ctx.fx = await usdKrw(() => {}); lastFx = now; }
        const shotCfg = (await sbGet("tg_shot_cfg")) || {};
        const g = await gather({ cfg, cacheDir: CACHE, log, deadline: now + 150000, noWrite: DRY, S, snaps, st, fx: ctx.fx, stateIO });
        if (g.skip) log("건너뜀:", g.skip);
        else {
          st = g.st; saveStore(CACHE, S); saveSnaps(CACHE, snaps); try { fs.writeFileSync(path.join(CACHE, "coin_state.json"), JSON.stringify(st)); } catch (e) {}
          if (Date.now() - lastBackup > 3600e3) { await backupSnaps(snaps, DRY); lastBackup = Date.now(); }
          log("틱", "코인", g.listN, "계산", g.rows.length, "커버", g.cover.toFixed(2), "받기", JSON.stringify(g.bars), "새 진입", g.fresh.length, g.mv && g.mv.verdict ? g.mv.verdict.t : "");
          if (g.cover >= 0.8) {
            const n = await doAlerts(g, cfg, shotCfg).catch((e) => { log("코인 알림 오류", String((e && e.message) || e).slice(0, 120)); return 0; });
            if (n) log("코인 알림", n + "건");
            const mute = await sbGet("tg_bot_mute"), muted = mute && +mute.until > Date.now();
            const due = cfg.on && !muted && (!last.rep || Date.now() - last.rep >= cfg.every * 60000 - 90000);
            if (manual || due) {
              const meta = await sendReport(g, cfg, shotCfg);
              log("코인 리포트 전송", JSON.stringify(meta), manual ? "(수동 요청)" : "");
              last = Object.assign({}, last, { rep: Date.now(), at: Date.now() }); if (manual) last.cmd = cmd.id;
              await W("tg_coin_last", last);
            }
          } else if (manual && told !== cmd.id) { told = cmd.id; await say("⏳ 코인 데이터를 모으는 중이에요 (" + g.rows.length + "/" + g.listN + "종 준비). 준비되는 대로 바로 보내드려요"); }   /* 요청은 그대로 두고 1분마다 다시 확인 */
        }
      }
    } catch (e) { log("틱 오류:", String((e && e.stack) || e).slice(0, 300)); }
    await sleep(DRY ? 1000 : 20000);
    if (DRY && process.env.COIN_ONCE) break;
  }
  log("실행 시간 끝 — 종료(다음 실행이 이어받음)");
  try { saveStore(CACHE, S); saveSnaps(CACHE, snaps); await backupSnaps(snaps, DRY); await kit.close(); } catch (e) {}
  process.exit(0);
}
main().catch((e) => { console.error("코인 작업 오류:", e && e.stack || e); process.exit(1); });
