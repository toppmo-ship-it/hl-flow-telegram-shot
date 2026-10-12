/* 코인 종목 카드 — 설정 정규화(norm)와 보낼 코인 고르기(pick)를 한 곳에 둠.
   설정 사이트(shot-config.html)는 <script> 로, 코인 작업·챗봇(runner)은 require 로 같은 파일을 씀 → 화면 미리보기와 실제 발송이 항상 같음.
   rows(코인 목록 스냅샷 tg_coin_list)의 한 줄: { t:티커, n:한글이름, c:분야, m:시총(억원), e:24h 거래대금(억원), h:24h 등락률(%), w:7일 등락률(%), s:1=스테이블·금토큰 } */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoinCards = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var EVERY = [30, 60, 120, 240, 1440], MAXS = [5, 10, 15, 20, 30], NS = [3, 5, 10, 15, 20, 30], MINE = [0, 1, 3, 10, 30, 100], MCTOP = [0, 50, 100, 150];
  var IVS = ["auto", "1h", "2h", "4h", "8h", "1d"], DAYS = [0, 5, 10, 15, 20, 30, 60, 90, 120];   /* 0·auto = 주식 카드 설정 따라가기 */
  var BYS = ["eok", "mc", "chg", "ret7"], THEMES = ["fuchsia", "lime", "same"];
  var BY_LABEL = { eok: "거래대금", mc: "시가총액", chg: "등락률 24시간", ret7: "등락률 7일" };
  var BY_KEY = { eok: "e", mc: "m", chg: "h", ret7: "w" };   /* 기준 → 스냅샷 필드 */
  var MAJORS = ["BTC", "ETH", "SOL", "XRP", "BNB", "HYPE"];   /* 설정 사이트의 '대장주급 코인'과 같은 묶음 */
  var CATS = ["대장", "L1", "L2·확장", "디파이", "파생·DEX", "스테이킹", "밈", "AI", "프라이버시", "인프라", "게임·NFT", "RWA·스테이블", "BTC계열", "플랫폼", "기타"];

  function pk(a, v, d) { v = +v; return a.indexOf(v) >= 0 ? v : d; }
  function oneOf(a, v, d) { return a.indexOf(v) >= 0 ? v : d; }
  function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  function tickers(a) {   /* 영문·숫자 2~10자만, 중복 제거, 최대 30개 */
    var out = [], seen = {};
    (Array.isArray(a) ? a : []).forEach(function (t) { t = String(t || "").trim().toUpperCase(); if (/^K?[A-Z0-9]{2,10}$/.test(t) && !seen[t] && out.length < 30) { seen[t] = 1; out.push(t); } });
    return out;
  }

  /* 설정 정규화 — 모르는 값은 기본값으로. 반드시 이 함수를 거쳐서 저장·사용 */
  function norm(raw) {
    var r = obj(raw), a = obj(r.auto), f = obj(r.filter), ch = obj(r.chart);
    var cats = (Array.isArray(f.cats) ? f.cats : []).filter(function (c, i, s) { return CATS.indexOf(c) >= 0 && s.indexOf(c) === i; });
    return {
      on: r.on === true,   /* 기본은 꺼짐 — 켜야 보냄 */
      every: pk(EVERY, r.every, 60), max: pk(MAXS, r.max, 10),
      auto: { on: a.on !== false, by: oneOf(BYS, a.by, "eok"), dir: a.dir === "asc" ? "asc" : "desc", n: pk(NS, a.n, 5) },
      filter: { minEok: pk(MINE, f.minEok, 0), mcTop: pk(MCTOP, f.mcTop, 0), noMajors: f.noMajors === true, cats: cats },
      picks: tickers(r.picks),
      chart: { iv: oneOf(IVS, ch.iv, "auto"), days: pk(DAYS, ch.days, 0), theme: oneOf(THEMES, ch.theme, "fuchsia") }
    };
  }

  function val(row, by) { var v = row[BY_KEY[by]]; return typeof v === "number" && isFinite(v) ? v : null; }
  /* 정렬: by 기준 큰 순(desc)·작은 순(asc). 값이 없는 코인은 어느 방향이든 맨 뒤, 같으면 시총 큰 순 */
  function sortRows(rows, by, dir) {
    var s = dir === "asc" ? 1 : -1;
    return rows.slice().sort(function (x, y) {
      var a = val(x, by), b = val(y, by);
      if (a == null && b == null) return (y.m || 0) - (x.m || 0);
      if (a == null) return 1; if (b == null) return -1;
      return (a - b) * s || (y.m || 0) - (x.m || 0);
    });
  }
  /* 필터 통과 여부 */
  function passes(row, f, rankOf) {
    if (f.minEok && !(row.e >= f.minEok)) return false;
    if (f.mcTop && !(rankOf[row.t] && rankOf[row.t] <= f.mcTop)) return false;
    if (f.noMajors && MAJORS.indexOf(row.t) >= 0) return false;
    if (f.cats && f.cats.length && f.cats.indexOf(row.c || "기타") < 0) return false;
    return true;
  }
  /* 이번에 보낼 코인: 직접 고른 것(순서대로) 먼저 + 자동 상위(필터 통과분) → 최대 max 장. 반환 [{t, src:"pick"|"auto", row}] */
  function pick(rows, cfg) {
    var c = norm(cfg), all = Array.isArray(rows) ? rows : [], byT = {}, rankOf = {};
    all.forEach(function (r) { byT[r.t] = r; });
    all.slice().sort(function (x, y) { return (y.m || 0) - (x.m || 0); }).forEach(function (r, i) { rankOf[r.t] = i + 1; });   /* 시총 순위 */
    var out = [], seen = {};
    c.picks.forEach(function (t) { if (!seen[t] && out.length < c.max) { seen[t] = 1; out.push({ t: t, src: "pick", row: byT[t] || null }); } });
    if (c.auto.on) {
      var pool = all.filter(function (r) { return !r.s && passes(r, c.filter, rankOf); });
      sortRows(pool, c.auto.by, c.auto.dir).filter(function (r) { return val(r, c.auto.by) != null; }).slice(0, c.auto.n).forEach(function (r) {
        if (!seen[r.t] && out.length < c.max) { seen[r.t] = 1; out.push({ t: r.t, src: "auto", row: r }); }
      });
    }
    return out;
  }
  return { EVERY: EVERY, MAXS: MAXS, NS: NS, MINE: MINE, MCTOP: MCTOP, IVS: IVS, DAYS: DAYS, BYS: BYS, THEMES: THEMES, BY_LABEL: BY_LABEL, MAJORS: MAJORS, CATS: CATS, norm: norm, sortRows: sortRows, pick: pick, val: val };
});
