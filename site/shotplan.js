/* 텔레그램 차트 사진 「무엇을 어떤 순서로 보낼지」 계획 — 브트 설정창(미리보기)과 러너(csjob.mjs)가 같은 파일을 씀 → 미리 본 순서 그대로 도착
   cfg(cs_shot_cfg): { max, src:"scan"|"auto"|"pick", picks[], exclude[], sort, auto:{by,dir,n}, filter:{minEok,mcTop,cats[]}, tail[] }
   ctx: { rows: tg_stock_list 의 rows(없으면 null), scan: [{t,coin,chg}](조건검색 통과 종목), inv: 인버스 검색 여부 }
   반환: [{ t(티커), coin(조건검색 종목만), src:"scan"|"auto"|"pick"|"tail" }] — 보내는 순서(위 = 먼저 도착, 맨 아래 = 마지막 도착)
   순서 규칙 = 옛 텔레그램 설정 사이트와 같음: 종목 카드 자동정렬(cardpick.autoOrder: 지수 → 원자재 → 10년물 → 분야별(분야 거래대금 큰 순, 분야 안 거래대금 큰 순))을
   옛 사이트가 '거꾸로' 보내던 것처럼 뒤집어서 → 텔레그램은 아래가 최신이라 맨 마지막에 지수·원자재·금리가 오고, 그 앞쪽에 반도체·소프트웨어 등 큰 분야가 큰 종목 순으로 쌓임 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = { make: factory };
  else root.ShotPlan = { make: factory, plan: root.CardPick ? factory(root.CardPick).plan : null };
})(typeof self !== "undefined" ? self : this, function (CP) {
  "use strict";
  var TAIL_DEFAULT = ["XYZ100", "SP500", "BRENTOIL", "10Y"];   /* 나스닥100 · S&P500 · 브렌트유 · 미국10년물 */
  function arr(a) { return Array.isArray(a) ? a : []; }
  function plan(cfg, ctx) {
    cfg = cfg || {}; ctx = ctx || {};
    var rows = ctx.rows && ctx.rows.length ? ctx.rows : null, src = cfg.src === "pick" || cfg.src === "auto" ? cfg.src : "scan";
    var max = CP.MAXS.indexOf(+cfg.max) >= 0 ? +cfg.max : 10, sortOn = cfg.sort !== false, have = {}, items = [];
    var add = function (it) { if (!it.t || have[it.t]) return; have[it.t] = 1; items.push(it); };
    if (src === "scan") {
      arr(ctx.scan).slice().sort(function (a, b) { return ctx.inv ? a.chg - b.chg : b.chg - a.chg; }).slice(0, max).forEach(function (r) { add({ t: r.t, coin: r.coin, src: "scan" }); });   /* 상승(인버스면 하락)이 큰 순으로 max 개 */
    } else {
      var K = CP.norm({ on: true, max: max, picks: src === "pick" ? arr(cfg.picks) : [], exclude: arr(cfg.exclude), sort: false,
        auto: { on: src === "auto", by: cfg.auto && cfg.auto.by, dir: cfg.auto && cfg.auto.dir, n: cfg.auto && cfg.auto.n }, filter: cfg.filter || {} }, "stock");
      CP.pick(rows || [], K, "stock").forEach(function (x) { add({ t: x.t, src: x.src }); });
    }
    if (src !== "pick") (cfg.tail == null ? TAIL_DEFAULT : arr(cfg.tail)).forEach(function (t) { add({ t: CP.canon(t), src: "tail" }); });   /* 시장 지표(지수·원자재·금리) 덧붙임 */
    if (!sortOn) return items;   /* 내가 정한 순서 그대로 */
    if (!rows) {   /* 목록 스냅샷이 없으면: 뽑힌 종목은 먼저 뽑힌(중요한) 것이 마지막에 오게 뒤집고, 시장 지표는 맨 끝에 10년물 → 원자재 → 지수 순 */
      var COMM = ["BRENTOIL", "CL", "NATGAS", "GOLD", "COPPER", "PALLADIUM", "SILVER", "PLATINUM"], rk = function (t) { return t === "10Y" ? 0 : COMM.indexOf(t) >= 0 ? 1 : 2; };
      return items.filter(function (x) { return x.src !== "tail"; }).reverse().concat(items.filter(function (x) { return x.src === "tail"; }).sort(function (a, b) { return rk(a.t) - rk(b.t); }));
    }
    var byT = {}; rows.forEach(function (r) { byT[r.t] = r; });
    var wrap = items.map(function (it) { return { t: it.t, row: byT[it.t] || null, it: it }; });
    return CP.autoOrder(wrap, rows, "stock").reverse().map(function (w) { return w.it; });
  }
  return { plan: plan, TAIL_DEFAULT: TAIL_DEFAULT };
});
