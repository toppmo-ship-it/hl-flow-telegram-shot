/* 주식 종목 목록 스냅샷(tg_stock_list) — 설정 사이트의 '종목 카드 고르기'(시총·거래대금·24h 등락 정렬·필터)와
   실행기의 자동 상위 카드 뽑기가 같은 데이터를 씀.
   종목 범위 = 설정 사이트 종목 카드 목록(site/cardgroups.js, 18분야·120종목) · 한 줄 = { t, n, c(분야), m(시총 억원), e(24h 거래대금 억원), h(24h 등락 %), s } */
import fs from "node:fs";
import { pickRow } from "./extras.mjs";

/* 사이트와 같은 파일을 읽음. 실행기 폴더는 ES 모듈이라 require 가 안 되므로 파일을 읽어 module 로 실행 */
const loadUmd = (rel) => { const m = { exports: {} }; new Function("module", "exports", fs.readFileSync(new URL(rel, import.meta.url), "utf8"))(m, m.exports); return m.exports; };
export const CP = loadUmd("./site/cardpick.js");
export const GROUPS = loadUmd("./site/cardgroups.js");

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

/* uni = loadUniverse 결과(거래소별 시세), info = 사이트 정보, fx = 달러→원, mcap = tg_mcap 의 m (티커→{usd,px,y,aum}), coinRows = tg_coin_list.rows(메인 거래소 코인은 uni 에 없어서 여기서 채움) */
export function buildStockRows({ uni, info, fx, mcap, coinRows }) {
  const coinBy = {}; (coinRows || []).forEach((r) => { coinBy[r.t] = r; });
  const rows = [], seen = {};
  GROUPS.forEach(([label, items]) => {
    items.forEach(([t, nm]) => {
      if (seen[t]) return; seen[t] = 1;
      const row = { t, n: nm && nm !== t ? nm : "", c: label, m: null, e: null, h: null, s: 0 };
      const u = pickRow(uni, t, info);
      if (u && u.dayNtl != null) {   /* HIP-3 등 거래소 시세가 있는 종목 */
        row.e = r1(u.dayNtl * fx / 1e8);
        if (u.prev > 0 && u.px > 0) row.h = r2((u.px / u.prev - 1) * 100);
        const alias = (info.alias && info.alias[t]) || t, e = mcap && (mcap[t] || mcap[alias]);
        if (e && e.usd > 0) {   /* 티커가 다른 회사와 겹쳐 가격이 크게 다르면 시총을 안 씀(리포트와 같은 규칙) */
          let ok = true;
          const nonUsd = e.y && /\.(KS|T)$/.test(e.y);
          if (!nonUsd && e.px > 0 && u.px > 0) { const q = u.px / e.px, k = /^k[A-Z]/.test(u.full || "") ? 1000 : 1; if (q / k < 0.5 || q / k > 2) ok = false; }
          if (ok) row.m = Math.round(e.usd * fx / 1e8);
        }
      } else if (coinBy[t]) {   /* 메인 거래소 코인(BTC·ETH 등)은 코인 목록에서 */
        const c = coinBy[t]; row.m = c.m != null ? c.m : null; row.e = c.e != null ? c.e : null; row.h = c.h != null ? c.h : null;
      }
      rows.push(row);
    });
  });
  return rows;
}

/* 이번에 보낼 종목 티커 목록(최대 30): 직접 고른 것 + 자동 상위, 제외 반영. rows 가 없으면 직접 고른 것만 */
export function selectStockCards(cfg0, rows) {
  const K = CP.fromStockCfg(cfg0);
  return CP.pick(Array.isArray(rows) ? rows : [], K, "stock").map((x) => x.t);
}
