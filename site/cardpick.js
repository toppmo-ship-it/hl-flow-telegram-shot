/* 종목 카드 고르기 — 주식 카드·코인 카드가 같이 쓰는 로직 (설정 정규화 · 정렬 · 자동 상위 · 직접 선택 · 제외 · 드래그 순서)
   설정 사이트(shot-config.html)와 실행기(shot.mjs·coinjob.mjs·chatbot.mjs)가 같은 파일을 읽음 → 화면 미리보기와 실제 발송이 항상 같음.
   rows(목록 스냅샷)의 한 줄: { t:티커, n:한글이름, c:분야, m:시총(억원), e:24h 거래대금(억원), h:24h 등락률(%), w:7일 등락률(%·코인만), s:1=스테이블 }
   설정 K 의 모양: { on, every, max, auto:{on,by,dir,n}, filter:{minEok,mcTop,noMajors,cats[]}, picks[], exclude[], chart:{iv,days,theme}(코인만) }
   - picks   = 내가 직접 고른 종목(순서대로, 항상 먼저 보냄)
   - auto    = 조건으로 자동 뽑는 상위 종목(필터 통과분, exclude 는 건너뜀)
   - exclude = 자동 상위에서 내가 뺀 종목(다음에도 자동 선택에서 빠짐) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CardPick = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var EVERY = [30, 60, 120, 240, 1440], MAXS = [5, 10, 15, 20, 30], NS = [3, 5, 10, 15, 20, 30], MINE = [0, 1, 3, 10, 30, 100, 300, 1000], MCTOP = [0, 50, 100, 150];
  var IVS = ["auto", "1h", "2h", "4h", "8h", "1d"], DAYS = [0, 5, 10, 15, 20, 30, 60, 90, 120], THEMES = ["fuchsia", "lime", "same"];
  var BY_LABEL = { eok: "거래대금", mc: "시가총액", chg: "등락률 24시간", ret7: "등락률 7일" };
  var BY_SHORT = { eok: "거래대금", mc: "시총", chg: "24h 등락", ret7: "7일 등락" };
  var BY_KEY = { eok: "e", mc: "m", chg: "h", ret7: "w" };   /* 기준 → 스냅샷 필드 */
  var KINDS = {
    coin: { bys: ["eok", "mc", "chg", "ret7"], autoOn: true, max: 10 },
    stock: { bys: ["eok", "mc", "chg"], autoOn: false, max: 30 }   /* 주식은 자동 상위를 기본 꺼짐 + 최대 30(기존 한도)으로 → 켜기 전엔 지금과 똑같이 동작 */
  };
  var MAJORS = ["BTC", "ETH", "SOL", "XRP", "BNB", "HYPE"];   /* 코인 '대장주급' */
  var COIN_CATS = ["대장", "L1", "L2·확장", "디파이", "파생·DEX", "스테이킹", "밈", "AI", "프라이버시", "인프라", "게임·NFT", "RWA·스테이블", "BTC계열", "플랫폼", "기타"];
  var MAX_PICKS = 30, MAX_EXCL = 200;

  function pk(a, v, d) { v = +v; return a.indexOf(v) >= 0 ? v : d; }
  function oneOf(a, v, d) { return a.indexOf(v) >= 0 ? v : d; }
  function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  function kindOf(k) { return k === "stock" ? "stock" : "coin"; }
  /* 티커 표기: 하이퍼리퀴드 코인은 kPEPE·kBONK 처럼 소문자 k 로 시작하는 이름이 있어서 그건 그대로 두고, 나머지는 대문자로 */
  function canon(t) { t = String(t == null ? "" : t).trim(); return /^k[A-Z0-9]{2,9}$/.test(t) ? t : t.toUpperCase(); }
  function tickers(a, cap) {   /* 영문·숫자 2~10자만, 중복 제거 */
    var out = [], seen = {};
    (Array.isArray(a) ? a : []).forEach(function (t) { t = canon(t); if (/^k?[A-Z0-9]{2,10}$/.test(t) && !seen[t] && out.length < cap) { seen[t] = 1; out.push(t); } });
    return out;
  }
  function strs(a, cap) {   /* 분야 이름(주식은 이모지 포함 자유 문자열) */
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (s) { if (typeof s === "string" && s && s.length <= 40 && out.indexOf(s) < 0 && out.length < cap) out.push(s); });
    return out;
  }

  /* 자동 상위·필터 정규화(주식은 설정 키가 평평해서 따로 부르기도 함) */
  function normAuto(raw, kind) {
    var a = obj(raw), kd = KINDS[kindOf(kind)];
    return { on: a.on != null ? a.on !== false : kd.autoOn, by: oneOf(kd.bys, a.by, "eok"), dir: a.dir === "asc" ? "asc" : "desc", n: pk(NS, a.n, 5) };
  }
  function normFilter(raw, kind) {
    var f = obj(raw), coin = kindOf(kind) === "coin";
    return { minEok: pk(MINE, f.minEok, 0), mcTop: pk(MCTOP, f.mcTop, 0), noMajors: coin && f.noMajors === true,
      cats: coin ? (Array.isArray(f.cats) ? f.cats : []).filter(function (c, i, s) { return COIN_CATS.indexOf(c) >= 0 && s.indexOf(c) === i; }) : strs(f.cats, 30) };
  }
  /* 설정 정규화 — 모르는 값은 기본값으로. 반드시 이 함수를 거쳐서 저장·사용 */
  function norm(raw, kind) {
    var r = obj(raw), ch = obj(r.chart), kd = KINDS[kindOf(kind)];
    return {
      on: r.on === true,   /* 기본은 꺼짐 — 켜야 보냄 */
      every: pk(EVERY, r.every, 60), max: pk(MAXS, r.max, kd.max),
      auto: normAuto(r.auto, kind), filter: normFilter(r.filter, kind),
      picks: tickers(r.picks, MAX_PICKS), exclude: tickers(r.exclude, MAX_EXCL),
      chart: { iv: oneOf(IVS, ch.iv, "auto"), days: pk(DAYS, ch.days, 0), theme: oneOf(THEMES, ch.theme, "fuchsia") }
    };
  }

  /* ── 주식: tg_shot_cfg 의 평평한 키 ⇄ K ── (cards 가 곧 '직접 고른 종목' — 기존 선택·챗봇 명령 그대로)
     on: cardOn 이 없으면 예전 방식(카드 목록이 있으면 켜짐) */
  function stockOn(cfg) { cfg = obj(cfg); return cfg.cardOn != null ? !!cfg.cardOn : tickers(cfg.cards, MAX_PICKS).length > 0; }
  function stockExtras(v) {   /* 설정 페이지 mapRemote 용: 새 키만 정규화해서 돌려줌 */
    v = obj(v);
    return { cardOn: v.cardOn != null ? !!v.cardOn : null, cardMax: pk(MAXS, v.cardMax, KINDS.stock.max), cardAuto: normAuto(v.cardAuto, "stock"), cardFilter: normFilter(v.cardFilter, "stock"), cardExclude: tickers(v.cardExclude, MAX_EXCL) };
  }
  function fromStockCfg(cfg) {
    cfg = obj(cfg);
    var x = stockExtras(cfg);
    return { on: stockOn(cfg), every: 0, max: x.cardMax, auto: x.cardAuto, filter: x.cardFilter, picks: tickers(cfg.cards, MAX_PICKS), exclude: x.cardExclude,
      chart: { iv: "auto", days: 0, theme: "same" } };
  }
  function applyToStockCfg(cfg, K) {   /* K 를 평평한 키로 되돌려 씀 (cfg 를 직접 고침) */
    cfg.cards = K.picks.slice(0, MAX_PICKS); cfg.cardOn = !!K.on; cfg.cardMax = K.max; cfg.cardAuto = K.auto; cfg.cardFilter = K.filter; cfg.cardExclude = K.exclude.slice(0, MAX_EXCL);
    return cfg;
  }

  function val(row, by) { var v = row[BY_KEY[by]]; return typeof v === "number" && isFinite(v) ? v : null; }
  /* 정렬: by 기준 큰 순(desc)·작은 순(asc). 값이 없는 종목은 어느 방향이든 맨 뒤, 같으면 시총 큰 순 */
  function sortRows(rows, by, dir) {
    var s = dir === "asc" ? 1 : -1;
    return rows.slice().sort(function (x, y) {
      var a = val(x, by), b = val(y, by);
      if (a == null && b == null) return (y.m || 0) - (x.m || 0);
      if (a == null) return 1; if (b == null) return -1;
      return (a - b) * s || (y.m || 0) - (x.m || 0);
    });
  }
  function passes(row, f, rankOf) {
    if (f.minEok && !(row.e >= f.minEok)) return false;
    if (f.mcTop && !(rankOf[row.t] && rankOf[row.t] <= f.mcTop)) return false;
    if (f.noMajors && MAJORS.indexOf(row.t) >= 0) return false;
    if (f.cats && f.cats.length && f.cats.indexOf(row.c || "기타") < 0) return false;
    return true;
  }
  /* 이번에 보낼 종목: 직접 고른 것(순서대로) 먼저 + 자동 상위(필터 통과·제외 빼고) → 최대 max 장. 반환 [{t, src:"pick"|"auto", row}]
     ※ 직접 고른 종목은 목록에 없어도·필터에 걸려도 항상 포함(누락 없음). max 를 넘는 직접 선택은 뒤에서 잘리지만 over 로 알려줌 */
  function pick(rows, cfg, kind) {
    var c = norm(cfg, kind), all = Array.isArray(rows) ? rows : [], byT = {}, rankOf = {}, excl = {};
    all.forEach(function (r) { byT[r.t] = r; });
    c.exclude.forEach(function (t) { excl[t] = 1; });
    all.slice().sort(function (x, y) { return (y.m || 0) - (x.m || 0); }).forEach(function (r, i) { rankOf[r.t] = i + 1; });   /* 시총 순위 */
    var out = [], seen = {};
    c.picks.forEach(function (t) { if (!seen[t] && out.length < c.max) { seen[t] = 1; out.push({ t: t, src: "pick", row: byT[t] || null }); } });
    if (c.auto.on) {
      var pool = all.filter(function (r) { return !r.s && !excl[r.t] && passes(r, c.filter, rankOf); });
      var sorted = sortRows(pool, c.auto.by, c.auto.dir).filter(function (r) { return val(r, c.auto.by) != null; }), cnt = 0;   /* 자동 N개 = 내가 고른 것과 겹치지 않는 N개 */
      for (var i = 0; i < sorted.length && cnt < c.auto.n && out.length < c.max; i++) {
        var r = sorted[i];
        if (seen[r.t]) continue;
        seen[r.t] = 1; out.push({ t: r.t, src: "auto", row: r }); cnt++;
      }
    }
    return out;
  }
  /* 직접 고른 것 중 max 를 넘어 못 보내는 종목(칩에 점선으로 알려줌) */
  function overflow(cfg, kind) { var c = norm(cfg, kind); return c.picks.slice(c.max); }

  /* ── 드래그로 순서를 바꿨을 때 설정에 반영 ──
     order = 화면에 보이는 새 순서(티커 배열), moved = 끈 종목. 끈 종목은 '직접 고른 것'으로 고정되고, 맨 앞에서 마지막 고정 종목까지는 순서가 그대로 굳음
     (그 사이에 낀 자동 종목도 같이 굳음). 그 뒤는 계속 자동. max 를 넘어 안 보이던 직접 선택은 뒤에 그대로 보존. 굳은 종목은 제외 목록에서 빠짐 */
  function applyOrder(cfg, order, moved, kind) {
    var c = norm(cfg, kind), pins = {};
    c.picks.forEach(function (t) { pins[t] = 1; });
    if (moved) pins[canon(moved)] = 1;
    var ord = tickers(order, MAX_PICKS * 2), last = -1;
    ord.forEach(function (t, i) { if (pins[t]) last = i; });
    var head = ord.slice(0, last + 1), inHead = {};
    head.forEach(function (t) { inHead[t] = 1; });
    var keep = c.picks.filter(function (t) { return !inHead[t] && ord.indexOf(t) < 0; });   /* 화면에 안 보이던(max 초과) 직접 선택은 보존 */
    c.picks = head.concat(keep).slice(0, MAX_PICKS);
    c.exclude = c.exclude.filter(function (t) { return !inHead[t]; });
    return c;
  }
  /* 칩 ✕: 직접 고른 건 목록에서 빼고, 자동으로 뽑힌 건 제외 목록에 넣음 */
  function removeTicker(cfg, t, src, kind) {
    var c = norm(cfg, kind); t = canon(t);
    if (src === "pick") c.picks = c.picks.filter(function (x) { return x !== t; });
    else if (c.exclude.indexOf(t) < 0) c.exclude = c.exclude.concat([t]).slice(-MAX_EXCL);
    return c;
  }
  /* 목록에서 종목 누르기: 직접 선택에 넣거나 빼기(넣으면 제외 목록에서도 빠짐) */
  function togglePick(cfg, t, kind) {
    var c = norm(cfg, kind); t = canon(t);
    var i = c.picks.indexOf(t);
    if (i >= 0) c.picks.splice(i, 1);
    else if (c.picks.length < MAX_PICKS) { c.picks.push(t); c.exclude = c.exclude.filter(function (x) { return x !== t; }); }
    return c;
  }
  /* 분야 통째로 추가: 이미 있는 건 건너뛰고, 30개 한도까지만. 반환 { cfg, added, skipped } */
  function addMany(cfg, list, kind) {
    var c = norm(cfg, kind), added = 0, skipped = 0, have = {};
    c.picks.forEach(function (t) { have[t] = 1; });
    tickers(list, 500).forEach(function (t) {
      if (have[t]) return;
      if (c.picks.length >= MAX_PICKS) { skipped++; return; }
      have[t] = 1; c.picks.push(t); added++; c.exclude = c.exclude.filter(function (x) { return x !== t; });
    });
    return { cfg: c, added: added, skipped: skipped };
  }
  return { EVERY: EVERY, MAXS: MAXS, NS: NS, MINE: MINE, MCTOP: MCTOP, IVS: IVS, DAYS: DAYS, THEMES: THEMES, KINDS: KINDS, BY_LABEL: BY_LABEL, BY_SHORT: BY_SHORT, MAJORS: MAJORS, COIN_CATS: COIN_CATS, MAX_PICKS: MAX_PICKS,
    canon: canon, norm: norm, normAuto: normAuto, normFilter: normFilter, fromStockCfg: fromStockCfg, applyToStockCfg: applyToStockCfg, stockExtras: stockExtras, stockOn: stockOn,
    sortRows: sortRows, pick: pick, overflow: overflow, applyOrder: applyOrder, removeTicker: removeTicker, togglePick: togglePick, addMany: addMany, val: val };
});
