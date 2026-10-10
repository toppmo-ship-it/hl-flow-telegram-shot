/* 코인 데이터 파이프라인 한 바퀴: 전 코인 시세 → 시총 순 상위 N → 캔들 이어받기 → 지표 계산 → 진입 감지 → 시장 국면
   코인 작업(coinjob.mjs)과 시험(test-coin.mjs)이 똑같이 씀 */
import fs from "node:fs";
import path from "node:path";
import { K } from "./report.mjs";
import { COIN } from "./coinset.mjs";
import { fetchCtx, getMeta, loadStore, saveStore, ensureBars, trackLive, loadSnaps, saveSnaps, pushSnap } from "./coindata.mjs";
import { calcRow, marketView } from "./coincalc.mjs";

const STABLE = new Set(["PAXG"]);   /* 알트시즌 지수·알트 시총에서 빼는 코인(금 토큰 등) */

/* S = 캔들 저장소(메모리에 계속 들고 있음), snaps = 스냅샷, st = 진입 상태 {flags, log, t} — 호출하는 쪽이 들고 있다가 계속 넘김 */
export async function gather({ cfg, cacheDir, log, deadline, noWrite, S, snaps, st, fx, stateIO, only }) {
  const now = Date.now();
  const ctx = await fetchCtx(log);
  if (!ctx || ctx.length < 20) return { skip: "하이퍼리퀴드 코인 시세를 못 받았어요" };
  const meta = await getMeta(ctx, { log, noWrite });
  const top = Math.min(300, Math.max(20, +cfg.top || 100));
  /* 시총 순으로 상위 N종(시총을 못 찾은 코인은 거래대금 순으로 뒤에) */
  const mcOf = (n) => (meta.m && meta.m[n] ? meta.m[n].mc : 0);
  let list = ctx.slice().sort((a, b) => (mcOf(b.name) - mcOf(a.name)) || (b.day - a.day));
  if (only) list = list.filter((c) => only.includes(c.name));
  list = list.slice(0, top);
  const names = list.map((c) => c.name);
  const b = await ensureBars(S, names, { deadline, log, par: 4 });
  pushSnap(snaps, ctx, now);
  const rows = [];
  list.forEach((c) => {
    const e = S.c[c.name]; if (!e) return;
    trackLive(e, c.px, now);
    const v = calcRow(e, c, now, fx, snaps, mcOf(c.name));
    if (!v) return;
    const info = COIN[c.name] || {}, cg = meta.m && meta.m[c.name];
    rows.push({ tk: c.name, name: info.ko || (cg && cg.cg) || c.name, cat: info.cat || "기타", mc: mcOf(c.name) || 0, v, stable: STABLE.has(c.name), rank: cg ? cg.rank : 0 });
  });
  const cover = rows.length / Math.max(1, list.length);
  /* 진입 감지(주식 리포트와 같은 규칙) */
  let S2 = Object.assign({ flags: {}, log: [], t: 0 }, st || {});
  if (stateIO) { try { const rs = await stateIO.read(); if (rs && rs.t && rs.t >= (S2.t || 0)) S2 = Object.assign(S2, rs); } catch (e) {} }
  const cur = {}; rows.forEach((r) => { cur[r.tk] = K.flagsOf(r.v); });
  const baseline = Object.keys(S2.flags).length >= 15;
  const fresh = [];
  if (baseline && cover >= 0.8) K.transitions(S2.flags, cur).forEach((x) => { const e = { k: x.k, t: now, kinds: x.kinds }; S2.log.unshift(e); fresh.push(e); });
  S2.log = S2.log.slice(0, 80);
  if (cover >= 0.8) { S2.flags = cur; S2.t = now; }
  if (stateIO && cover >= 0.8) { try { await stateIO.write(S2); } catch (e) {} }
  const mv = marketView(rows, meta, snaps, now, +cfg.fundHot || 100);
  return { now, ctx, meta, rows, cover, bars: b, ent: S2.log, fresh, mv, st: S2, listN: list.length };
}
