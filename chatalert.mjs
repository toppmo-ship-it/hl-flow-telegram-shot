/* 텔레그램 챗봇 — 알림 (설정 페이지 '텔레그램 알림 설정' 박스 · 채팅 명령 · 사진 아래 🔔 버튼이 모두 같은 값을 읽고 씀)
   저장(Supabase hlgrid_settings):
     tg_alert_cfg    자동 알림 설정(페이지·채팅이 씀)   { on, photo, scope:"stock"|"all", minEok, kinds:{ kel,w2,core,h4u,h4m,vol{mult},surge{pct,mins},entry } }
     tg_bot_alerts   내 종목 알림 목록(페이지·채팅·봇)    { list:[{id,tk,full?,kind:"px"|"pct",dir?,level,base?,at}] }  — 한 번 울리면 사라짐
     tg_alert_state  봇 전용 진행 상태(어디까지 알렸나·쿨다운)
     tg_alert_cmd    페이지의 '테스트 알림 보내기' 요청 {id}
   감시: 가격(내 종목)은 30초마다, 자동 알림(전체 종목)은 3분마다. 알림은 '일봉 차트 사진'(큰 일봉 개수 설정값)과 함께 옴 */
import { pickRow } from "./extras.mjs";
import { fetchMids, changeOver } from "./repcalc.mjs";
import { buildReport, collectRows } from "./report.mjs";
import { parseRequest, parseEvery, norm } from "./chatparse.mjs";
import * as F from "./chatfmt.mjs";

const K_CFG = "tg_alert_cfg", K_LIST = "tg_bot_alerts", K_STATE = "tg_alert_state", K_CMD = "tg_alert_cmd", MAX = 30;
export const KINDS = [
  ["kel", "🟧 켈상단 돌파", "일봉 켈트너 상단 위로 새로 올라옴"],
  ["w2", "💚 양W +2 도달", "양W가 +2(강세)에 새로 도달"],
  ["core", "⭐ ★핵심 진입", "양W+2 · 켈상단 · 4H중심을 모두 새로 충족"],
  ["h4u", "🔥 4H 발산 진입", "4H 켈트너 상단 위로 새로 올라옴"],
  ["h4m", "🕓 4H 중심 진입", "4H 켈트너 중심 위로 새로 올라옴 (자주 떠요)"],
  ["vol", "💰 거래대금 급증", "15분 거래대금이 평소의 N배"],
  ["surge", "🚨 급변동", "시장 대비 N분에 ±N%p 튐"],
  ["entry", "🚪 모든 진입", "양W 변화 등 모든 변화 (아주 많이 떠요)"],
];
const KIND_OF_WORD = { 켈: "kel", 켈상단: "kel", 양w: "w2", 양w2: "w2", 핵심: "core", 발산: "h4u", "4h발산": "h4u", "4h": "h4m", "4h중심": "h4m", "4h진입": "h4m", 대금: "vol", 거래대금: "vol", 급변동: "surge", 급등: "surge", 급변: "surge", 진입: "entry" };
export const VOL_MULT = [3, 5, 10], SURGE_PCT = [2, 3, 5, 10], SURGE_MINS = [5, 15, 30, 60], MIN_EOK = [0, 1, 5, 20, 50];
const snapTo = (arr, v, d) => (arr.includes(+v) ? +v : d);
export function normCfg(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, k = r.kinds || {}, on = (n, d) => (k[n] && k[n].on != null ? !!k[n].on : d);
  return { on: r.on !== false, photo: r.photo !== false, scope: r.scope === "all" ? "all" : "stock", minEok: snapTo(MIN_EOK, r.minEok, 5),
    kinds: { kel: { on: on("kel", true) }, w2: { on: on("w2", true) }, core: { on: on("core", true) }, h4u: { on: on("h4u", false) }, h4m: { on: on("h4m", false) },
      vol: { on: on("vol", false), mult: snapTo(VOL_MULT, k.vol && k.vol.mult, 3) }, surge: { on: on("surge", false), pct: snapTo(SURGE_PCT, k.surge && k.surge.pct, 3), mins: snapTo(SURGE_MINS, k.surge && k.surge.mins, 15) }, entry: { on: on("entry", false) } } };
}
export const VAL = /^([+\-±]?)(\d+(?:[.,]\d+)?)(%|달러|원|usd|\$)?$/i;
/* 말 → { name, kind, dir, level } — 예) ['sk하이닉스','1300'] · ['메타','+3%'] · ['비트코인','±5%'] */
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
  const getCfg = async () => normCfg(await sbGet(K_CFG));
  const getList = async () => { const a = await sbGet(K_LIST); return { list: a && Array.isArray(a.list) ? a.list : [] }; };
  const putList = (A) => W(K_LIST, A), putCfg = (c) => W(K_CFG, c);
  const getState = async () => { const s = await sbGet(K_STATE); return s && typeof s === "object" ? s : {}; };
  const fullOf = async (tk) => { await loadCtx(); let r = pickRow(C.uni, tk, C.info); if (!r) { const q = parseRequest(tk, C.idx, C.info, C.themes); if (q.tickers[0]) { tk = q.tickers[0]; r = pickRow(C.uni, tk, C.info); } } return r ? { full: r.full, tk } : null; };
  const label = (a) => (a.kind === "px" ? F.fmtPx(a.level) + (a.dir === "down" ? " 이하" : " 이상") : (a.dir === "up" ? "+" : a.dir === "down" ? "−" : "±") + a.level + "% 변동");
  const dirNote = (a, px) => (a.kind === "px" ? (a.level >= px ? "up" : "down") : a.dir);

  /* ───── 내 종목 알림: 만들기 ───── */
  async function addOne(tk, spec, A) {
    const f = await fullOf(tk); if (!f) return { err: tk + ": 종목을 못 찾았어요" };
    if (A.list.length >= MAX) return { err: "알림이 가득 찼어요(최대 " + MAX + "개)" };
    const mids = await fetchMids([{ full: f.full }], () => {}), px = +mids[f.full]; if (!(px > 0)) return { err: f.tk + ": 지금 가격을 못 받았어요" };
    const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4), tk: f.tk, full: f.full, kind: spec.kind, level: spec.level, base: px, at: Date.now() };
    a.dir = dirNote({ ...a, dir: spec.dir }, px);
    A.list.push(a); return { a, px };
  }
  async function add(args) {
    const p = parseAlertArgs(args);
    if (!p || !p.name) throw new D.UserErr("예) <code>알림 메타 700</code> (가격) · <code>알림 메타 +3%</code> (지금보다 3% 오르면) · <code>알림 비트 ±5%</code> (오르내림 아무쪽)\n또는 카드 사진 밑 <b>🔔 알림</b> 버튼");
    await loadCtx();
    const q = parseRequest(p.name, C.idx, C.info, C.themes);
    if (!q.tickers.length) throw new D.UserErr("'" + F.esc(p.name) + "' 종목을 못 찾았어요");
    const A = await getList(), done = [];
    for (const tk of q.tickers.slice(0, 5)) { const r = await addOne(tk, p, A); done.push(r.err ? "⚠️ " + F.esc(r.err) : "✅ <b>" + F.esc(r.a.tk) + "</b> " + label(r.a) + " <i>(지금 " + F.fmtPx(r.px) + ")</i>"); }
    await putList(A);
    return say("🔔 <b>알림 등록</b>\n" + done.join("\n") + "\n<i>조건이 맞으면 일봉 차트와 함께 알려드리고, 그 알림은 사라져요 (한 번만)</i>");
  }
  async function list() {
    const A = await getList(), cfg = await getCfg(), L = ["🔔 <b>내 종목 알림</b>  <i>(한 번 울리면 사라져요)</i>", ""];
    if (!A.list.length) L.push("— 없어요 —  예) <code>알림 메타 700</code> · 카드 밑 🔔 버튼");
    A.list.forEach((a, i) => L.push((i + 1) + ". <b>" + F.esc(a.tk) + "</b> " + label(a) + (a.kind === "pct" && a.base ? " <i>(기준 " + F.fmtPx(a.base) + ")</i>" : "") + "  <i>" + F.ago(a.at) + "</i>"));
    L.push("", "🤖 자동 알림(전체 종목): " + (cfg.on ? "<b>켬</b> — " + (KINDS.filter((k) => cfg.kinds[k[0]].on).map((k) => k[1].replace(/^\S+ /, "")).join(" · ") || "켜진 항목 없음") : "<b>끔</b>") + "   <code>알림설정</code>");
    const rows = A.list.slice(0, 20).map((a) => [{ text: "🗑 " + a.tk + " " + (a.kind === "px" ? F.fmtPx(a.level) : a.level + "%"), callback_data: "a:d:" + a.id }]);
    return say(L.join("\n"), rows.length ? { inline_keyboard: rows } : undefined);
  }
  async function del(args) {
    if (!args.length) throw new D.UserErr("예) <code>알림삭제 1</code> · <code>알림삭제 메타</code> · <code>알림삭제 전체</code>");
    const A = await getList(), w = norm(args.join(""));
    let rm = [];
    if (/^(전체|모두|all)$/.test(w)) { rm = A.list.slice(); A.list = []; }
    else if (/^\d+$/.test(w)) { const i = +w - 1; if (A.list[i]) rm = A.list.splice(i, 1); }
    else { await loadCtx(); const q = parseRequest(args.join(" "), C.idx, C.info, C.themes); const set = new Set(q.tickers); A.list = A.list.filter((a) => (set.has(a.tk) ? (rm.push(a), false) : true)); }
    if (!rm.length) return say("지울 알림을 못 찾았어요 — <code>알림목록</code> 으로 번호를 확인해 주세요");
    await putList(A);
    return say("🗑 알림 " + rm.length + "개 삭제: " + F.esc(rm.map((a) => a.tk + " " + (a.kind === "px" ? F.fmtPx(a.level) : a.level + "%")).join(", ")));
  }

  /* ───── 자동 알림 설정 (글 + 버튼 메뉴) ───── */
  function settingsView(cfg) {
    const L = ["🔔 <b>알림 설정</b>  <i>(설정 페이지의 '텔레그램 알림 설정'과 같은 값)</i>", "",
      "🤖 자동 알림 (전체 종목 감시) <b>" + (cfg.on ? "켬" : "끔") + "</b>  ·  📷 일봉 차트 사진 <b>" + (cfg.photo ? "첨부" : "글만") + "</b>"];
    KINDS.forEach(([id, nm]) => { const k = cfg.kinds[id]; L.push((k.on ? "✅ " : "▫️ ") + nm + (k.on && id === "vol" ? "  <i>평소의 " + k.mult + "배</i>" : "") + (k.on && id === "surge" ? "  <i>" + k.mins + "분 ±" + k.pct + "%p</i>" : "")); });
    L.push("", "🎯 대상: <b>" + (cfg.scope === "all" ? "전체(지수·원자재·코인 포함)" : "개별주만") + "</b>  ·  24시간 거래대금 <b>" + (cfg.minEok ? cfg.minEok + "억 이상" : "제한 없음") + "</b>", "<i>버튼을 누르면 바로 바뀌어요 · 같은 종목·같은 알림은 4시간에 한 번만 와요</i>");
    const t = (id, nm, on) => ({ text: (on ? "✅ " : "▫️ ") + nm, callback_data: "a:t:" + id });
    const rows = [[t("master", "자동 알림", cfg.on), t("photo", "📷 사진", cfg.photo)]];
    for (let i = 0; i < KINDS.length; i += 2) rows.push(KINDS.slice(i, i + 2).map(([id, nm]) => t(id, nm.replace(/^\S+ /, ""), cfg.kinds[id].on)));
    if (cfg.kinds.vol.on) rows.push(VOL_MULT.map((m) => ({ text: (cfg.kinds.vol.mult === m ? "● " : "") + "거래대금 ×" + m, callback_data: "a:v:" + m })));
    if (cfg.kinds.surge.on) { rows.push(SURGE_PCT.map((m) => ({ text: (cfg.kinds.surge.pct === m ? "● " : "") + "±" + m + "%p", callback_data: "a:u:" + m }))); rows.push(SURGE_MINS.map((m) => ({ text: (cfg.kinds.surge.mins === m ? "● " : "") + m + "분", callback_data: "a:n:" + m }))); }
    rows.push([{ text: (cfg.scope === "all" ? "🎯 대상: 전체" : "🎯 대상: 개별주만"), callback_data: "a:t:scope" }]);
    rows.push(MIN_EOK.map((m) => ({ text: (cfg.minEok === m ? "● " : "") + (m ? m + "억↑" : "제한없음"), callback_data: "a:e:" + m })));
    rows.push([{ text: "📋 내 종목 알림", callback_data: "a:l" }, { text: "🧪 테스트", callback_data: "a:x" }]);
    return { text: L.join("\n"), markup: { inline_keyboard: rows } };
  }
  async function settings() { const v = settingsView(await getCfg()); return say(v.text, v.markup); }
  async function autoCmd(word, args) {
    const w0 = norm(word || "").replace(/알림$/, ""), id = KIND_OF_WORD[w0];
    if (!id) { if (!(args || []).length) return settings(); const e = parseEvery(args[0]); if (e !== "on" && e !== "off") throw new D.UserErr("<code>자동알림 켜기</code> / <code>자동알림 끄기</code> · 자세히는 <code>알림설정</code>"); const c = await getCfg(); c.on = e === "on"; await putCfg(c); return say("🤖 자동 알림 <b>" + (c.on ? "켬" : "끔") + "</b>"); }
    const c = await getCfg(), k = c.kinds[id], nm = KINDS.find((x) => x[0] === id)[1];
    let touched = false;
    for (const t of args || []) {
      const n = norm(t), e = parseEvery(t); let m;
      if (n === "끄기" || n === "끔" || n === "off") { k.on = false; touched = true; }
      else if (n === "켜기" || n === "켬" || n === "on") { k.on = true; touched = true; }
      else if (id === "vol" && (m = /^(\d+)(배|x)?$/.exec(n))) { k.mult = VOL_MULT.reduce((b, x) => (Math.abs(x - +m[1]) < Math.abs(b - +m[1]) ? x : b)); k.on = true; touched = true; }
      else if (id === "surge" && (m = /^(\d+(?:\.\d+)?)(%p?|퍼)$/.exec(n))) { k.pct = SURGE_PCT.reduce((b, x) => (Math.abs(x - +m[1]) < Math.abs(b - +m[1]) ? x : b)); k.on = true; touched = true; }
      else if (id === "surge" && typeof e === "number" && e >= 5) { k.mins = SURGE_MINS.reduce((b, x) => (Math.abs(x - e) < Math.abs(b - e) ? x : b)); k.on = true; touched = true; }
    }
    if (!touched) return say(nm + " 알림은 지금 <b>" + (k.on ? "켜짐" : "꺼짐") + "</b>\n<code>" + word + " 켜기</code> · <code>" + word + " 끄기</code>" + (id === "vol" ? " · <code>대금알림 5배</code>" : "") + (id === "surge" ? " · <code>급변동알림 3% 30분</code>" : "") + "\n전체 설정: <code>알림설정</code>");
    await putCfg(c);
    return say(nm + " 알림 <b>" + (k.on ? "켬" : "끔") + "</b>" + (k.on && id === "vol" ? " — 평소의 " + k.mult + "배" : "") + (k.on && id === "surge" ? " — " + k.mins + "분에 시장 대비 ±" + k.pct + "%p" : "") + (k.on && !c.on ? "\n⚠️ 자동 알림 전체가 꺼져 있어요 — <code>자동알림 켜기</code>" : ""));
  }

  /* ───── 알림 보내기 (일봉 차트 사진 + 버튼) ───── */
  let photoLeft = 0;
  async function send(tk, text, cfg) {
    const mk = F.cardButtons(tk, "1d");
    if (cfg.photo && photoLeft > 0) { photoLeft--; try { if (await D.chart(tk, text, mk)) return; } catch (e) { log("알림 사진 실패", tk, String((e && e.message) || e).slice(0, 80)); } }
    await say(text, mk);
  }
  async function menu(tk) {   /* 카드·알림 사진 밑 🔔 버튼 → 이 종목 알림 만들기 */
    const f = await fullOf(tk); if (!f) return say("종목을 못 찾았어요");
    const mids = await fetchMids([{ full: f.full }], () => {}), px = +mids[f.full] || 0, r = (v) => (px >= 1000 ? Math.round(v) : px >= 10 ? +v.toFixed(2) : +v.toPrecision(4));
    const pc = (n, s) => ({ text: (s > 0 ? "📈 +" : s < 0 ? "📉 −" : "↔ ±") + n + "%", callback_data: "a:p:" + f.tk + ":" + (s > 0 ? "u" : s < 0 ? "d" : "b") + n });
    const rows = [[pc(3, 1), pc(5, 1), pc(10, 1)], [pc(3, -1), pc(5, -1), pc(10, -1)], [pc(3, 0), pc(5, 0), pc(10, 0)]];
    if (px) rows.push([{ text: "🎯 " + F.fmtPx(r(px * 1.02)) + " (+2%)", callback_data: "a:q:" + f.tk + ":" + r(px * 1.02) }, { text: "🎯 " + F.fmtPx(r(px * 1.05)) + " (+5%)", callback_data: "a:q:" + f.tk + ":" + r(px * 1.05) }], [{ text: "🎯 " + F.fmtPx(r(px * 0.98)) + " (−2%)", callback_data: "a:q:" + f.tk + ":" + r(px * 0.98) }, { text: "🎯 " + F.fmtPx(r(px * 0.95)) + " (−5%)", callback_data: "a:q:" + f.tk + ":" + r(px * 0.95) }]);
    rows.push([{ text: "📋 내 알림", callback_data: "a:l" }, { text: "⚙️ 자동 알림 설정", callback_data: "a:s" }]);
    return say("🔔 <b>" + F.esc(f.tk) + "</b> 알림 만들기" + (px ? "  <i>지금 " + F.fmtPx(px) + "</i>" : "") + "\n📈📉 지금 가격에서 N% 움직이면 · 🎯 그 가격에 닿으면\n<i>다른 가격: <code>알림 " + F.esc(f.tk) + " 700</code> · 한 번 울리면 사라져요</i>", { inline_keyboard: rows });
  }
  /* 버튼 눌림: "a:..." */
  async function callback(d, cb, ack) {
    const p = d.split(":"), t = p[1];
    const redraw = async () => { const v = settingsView(await getCfg()); await D.edit(cb.message && cb.message.message_id, v.text, v.markup); };
    if (t === "m") { await ack(); return menu(p[2]); }
    if (t === "s") { await ack(); return settings(); }
    if (t === "l") { await ack(); return list(); }
    if (t === "x") { await ack("테스트 알림을 보내요"); return testAlert(); }
    if (t === "d") { const A = await getList(), n = A.list.length; A.list = A.list.filter((a) => a.id !== p[2]); await putList(A); await ack(n !== A.list.length ? "삭제했어요" : "이미 없어요"); return list(); }
    if (t === "p" || t === "q") {
      const A = await getList(); let spec;
      if (t === "p") { const m = /^([udb])(\d+)$/.exec(p[3]); spec = { kind: "pct", dir: ({ u: "up", d: "down", b: "both" })[m[1]], level: +m[2] }; } else spec = { kind: "px", level: +p[3] };
      const r = await addOne(p[2], spec, A); if (r.err) { await ack(r.err.slice(0, 60)); return; }
      await putList(A); await ack("알림 등록!");
      return say("✅ <b>" + F.esc(r.a.tk) + "</b> " + label(r.a) + " 알림 등록 <i>(지금 " + F.fmtPx(r.px) + " · 한 번만 · 일봉 차트와 함께 와요)</i>");
    }
    const c = await getCfg();
    if (t === "t") { const id = p[2]; if (id === "master") c.on = !c.on; else if (id === "photo") c.photo = !c.photo; else if (id === "scope") c.scope = c.scope === "all" ? "stock" : "all"; else if (c.kinds[id]) c.kinds[id].on = !c.kinds[id].on; }
    else if (t === "v") c.kinds.vol.mult = snapTo(VOL_MULT, p[2], 3);
    else if (t === "u") c.kinds.surge.pct = snapTo(SURGE_PCT, p[2], 3);
    else if (t === "n") c.kinds.surge.mins = snapTo(SURGE_MINS, p[2], 15);
    else if (t === "e") c.minEok = snapTo(MIN_EOK, p[2], 5);
    await putCfg(normCfg(c)); await ack(); return redraw();
  }
  async function testAlert() {
    const cfg = await getCfg(); await loadCtx();
    const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 20000, only: ["META"], extra: ["META"], bars: C.bars });
    const x = r.rows[0]; photoLeft = 1;
    await send("META", "🧪 <b>테스트 알림</b> — 실제 알림은 이런 모양으로 와요\n" + (x ? F.quoteBlock(x) : "META"), cfg);
  }

  /* ───── 감시: 내 종목 가격·퍼센트 ───── */
  async function tickPrice() {
    const A = await getList(); if (!A.list.length) return;
    let changed = false;
    for (const a of A.list) { if (!a.full) { const f = await fullOf(a.tk); if (f) { a.full = f.full; a.tk = f.tk; changed = true; } } }   /* 설정 페이지에서 만든 알림은 여기서 마무리 */
    const live = A.list.filter((a) => a.full);
    if (!live.length) return;
    const mids = await fetchMids([...new Set(live.map((a) => a.full))].map((full) => ({ full })), () => {});
    const hit = [];
    for (const a of live) {
      const px = +mids[a.full]; if (!(px > 0)) continue;
      if (!a.base) { a.base = px; changed = true; }
      if (!a.dir) { a.dir = dirNote(a, px); changed = true; }
      let ok = false, txt = "";
      if (a.kind === "px") { ok = a.dir === "up" ? px >= a.level : px <= a.level; txt = F.fmtPx(a.level) + (a.dir === "up" ? " 위로 돌파" : " 아래로 이탈"); }
      else { const mv = (px / a.base - 1) * 100; ok = a.dir === "up" ? mv >= a.level : a.dir === "down" ? -mv >= a.level : Math.abs(mv) >= a.level; txt = (mv >= 0 ? "+" : "") + mv.toFixed(2) + "%  (목표 " + label(a) + " · 기준 " + F.fmtPx(a.base) + ")"; }
      if (ok) hit.push({ a, px, txt });
    }
    if (hit.length) { const ids = new Set(hit.map((h) => h.a.id)); A.list = A.list.filter((a) => !ids.has(a.id)); changed = true; }
    if (changed) await putList(A);   /* 먼저 지워서 중복 알림 방지 */
    if (!hit.length) return;
    const cfg = await getCfg(); photoLeft = 4;
    for (const h of hit) await send(h.a.tk, "🔔 <b>" + F.esc(h.a.tk) + "</b> " + h.txt + "\n💰 지금 <b>" + F.fmtPx(h.px) + "</b>  <i>" + F.hm(Date.now()) + "</i>", cfg);
  }

  /* ───── 감시: 자동 알림(전체 종목) ───── */
  async function tickAuto() {
    const cfg = await getCfg(); if (!cfg.on) return;
    const K = cfg.kinds, trans = K.kel.on || K.w2.on || K.core.on || K.h4u.on || K.h4m.on || K.entry.on;
    if (!trans && !K.vol.on && !K.surge.on) return;
    await loadCtx();
    const S = await getState(), now = Date.now(), bot = await cfgGet();
    S.cool = S.cool || {}; Object.keys(S.cool).forEach((k) => { if (now - S.cool[k] > 6 * 3600e3) delete S.cool[k]; });
    const cool = (key, mins) => { if (now - (S.cool[key] || 0) < mins * 60000) return false; S.cool[key] = now; return true; };
    const fires = [];   // { tk, row, title, text }
    let rowsAll = null;
    if (trans) {
      const out = await buildReport({ cfg: { ...bot, repOrder: ["sum"], repOff: [] }, info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 20000, bars: C.bars, stateIO: { read: () => sbGet("tg_rep_state"), write: (s) => W("tg_rep_state", s) } });
      if (!out.skip) {
        const r = await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 8000, bars: C.bars }); rowsAll = r.rows;
        const by = Object.fromEntries(r.rows.map((x) => [x.tk, x]));
        const since = S.last || now; let maxT = since;
        const fresh = out.ent.filter((e) => e.t > since).sort((a, b) => a.t - b.t);
        for (const e of fresh) {
          maxT = Math.max(maxT, e.t);
          const row = by[e.k]; if (!row) continue;
          if (cfg.scope === "stock" && !row.stock) continue;
          if (cfg.minEok && row.v.eok < cfg.minEok) continue;
          const labs = []; const has = (re) => e.kinds.some((x) => re.test(x));
          if (K.kel.on && has(/^켈/) && cool(e.k + "|kel", 240)) labs.push("🟧 켈상단 돌파");
          if (K.w2.on && e.kinds.some((x) => /^양W:[^>]*>2$/.test(x) && !/^양W:2>/.test(x)) && cool(e.k + "|w2", 240)) labs.push("💚 양W +2 도달");
          if (K.core.on && has(/^핵심$/) && cool(e.k + "|core", 240)) labs.push("⭐ ★핵심 진입");
          if (K.h4u.on && has(/^발산/) && cool(e.k + "|h4u", 240)) labs.push("🔥 4H 발산 진입");
          if (K.h4m.on && has(/^4H/) && cool(e.k + "|h4m", 240)) labs.push("🕓 4H 중심 진입");
          if (!labs.length && K.entry.on && cool(e.k + "|entry", 240)) labs.push("🚪 진입");
          if (labs.length) fires.push({ tk: e.k, title: labs.join(" · "), text: F.quoteBlock(row) });
        }
        S.last = Math.max(maxT, since);   /* 처음 켠 순간부터만 알림(과거 기록은 안 보냄) */
      }
    } else if (!S.last) S.last = now;
    if (K.vol.on || K.surge.on) {
      const rows = rowsAll || (await collectRows({ info: C.info, uni: C.uni, fx: C.fx, cacheDir: CACHE, log: () => {}, deadline: Date.now() + 12000, bars: C.bars })).rows;
      const ok = (x) => (cfg.scope === "all" || x.stock) && (!cfg.minEok || x.v.eok >= cfg.minEok);
      if (K.vol.on) {
        S.vol = S.vol || {};
        rows.filter(ok).forEach((x) => {
          const m = (x.e.m || []).filter((b) => b[0] + 900000 <= now); if (m.length < 20) return;
          const nt = (b) => (b[4] || 0) * (b[1] + b[2] + b[3]) / 3, last = m[m.length - 1], prev = m.slice(-33, -1).map(nt).filter((v) => v > 0);
          if (prev.length < 16 || S.vol[x.tk] === last[0]) return;
          const avg = prev.reduce((s, v) => s + v, 0) / prev.length, ratio = nt(last) / Math.max(avg, 1), eok15 = nt(last) * C.fx / 1e8;
          if (ratio >= K.vol.mult && eok15 >= 1 && cool(x.tk + "|vol", 60)) { S.vol[x.tk] = last[0]; const up = last[3] >= (m[m.length - 2] ? m[m.length - 2][3] : last[3]); fires.push({ tk: x.tk, title: "💰 거래대금 급증 ×" + ratio.toFixed(1), text: "15분 거래대금 <b>" + F.eok(eok15) + "억</b> (평소 " + F.eok(avg * C.fx / 1e8) + "억의 " + ratio.toFixed(1) + "배) " + (up ? "🔺" : "🔽") + "\n" + F.quoteBlock(x) }); }
        });
      }
      if (K.surge.on) {
        const list = []; rows.filter((x) => x.v.w >= 0).forEach((x) => { const c = changeOver(x.e, K.surge.mins, now); if (c) list.push({ x, pct: c.pct, usd: c.usd }); });
        const a = list.map((q) => q.pct).sort((p, q) => p - q), med = a.length >= 3 ? a[Math.floor(a.length / 2)] : 0;
        list.map((q) => ({ ...q, rel: q.pct - med })).filter((q) => Math.abs(q.rel) >= K.surge.pct && ok(q.x)).sort((p, q) => Math.abs(q.rel) - Math.abs(p.rel)).slice(0, 5).forEach((q) => { if (cool(q.x.tk + "|surge", 30)) fires.push({ tk: q.x.tk, title: "🚨 급변동 " + (q.rel > 0 ? "+" : "") + q.rel.toFixed(2) + "%p", text: K.surge.mins + "분 · 시장 " + (med >= 0 ? "+" : "") + med.toFixed(2) + "%p 대비 · 유입 " + F.eok(q.usd * C.fx / 1e8) + "억\n" + F.quoteBlock(q.x) }); });
      }
    }
    await W(K_STATE, S);
    if (!fires.length) return;
    photoLeft = 4;
    for (const f of fires.slice(0, 12)) await send(f.tk, "<b>" + f.title + "</b>\n" + f.text, cfg);
    if (fires.length > 12) await say("… 그 밖에 " + (fires.length - 12) + "건 더 있었어요 (<code>알림설정</code> 에서 기준을 높일 수 있어요)");
  }
  async function checkCmd() {   /* 설정 페이지의 '테스트 알림 보내기' */
    const c = await sbGet(K_CMD); if (!c || !c.id) return;
    const S = await getState(); if (S.cmdId === c.id) return;
    S.cmdId = c.id; await W(K_STATE, S); await testAlert();
  }
  let lastAuto = 0;
  async function loop(maxMs, t0) {
    while (Date.now() - t0 < maxMs) {
      try {
        await tickPrice(); await checkCmd();
        if (Date.now() - lastAuto > 3 * 60000) { if (!D.C.busy) { lastAuto = Date.now(); await tickAuto(); } }
      } catch (e) { log("알림 감시 오류", String((e && e.stack) || e).slice(0, 200)); }
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  return { add, list, del, settings, autoCmd, callback, menu, testAlert, loop, tickPrice, tickAuto };
}
