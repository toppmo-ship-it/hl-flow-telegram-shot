/* 하이퍼 리포트 표 그리기 (헤드리스 크롬 안에서 실행) — window.drawReport(spec) → PNG dataURL
   탬퍼몽키 스크리너의 표 그리기를 옮겨 온 것. 이모지·기호는 서버 글꼴에 의존하지 않도록 벡터 아이콘 토큰으로 그림:
     {F} 불꽃(4H 발산) · {o} 동그라미(충족) · {d} 마름모(종배) · {S} 별(핵심) · {>} 화살표
   spec = { header:{title,sub}, sections:[…], foot, scale, maxW }
   섹션 = { kind:'table'|'chips', title, sub, notes[], feature, index, half, cols:[[이름,정렬,헤더색]], rows:[[셀…]], rowbg:[…], empty }
   셀 = { t, c(글자색), b(굵게), bg(알약 배경), sz(글자 배율) } */
(function () {
  const FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR","NanumGothic","Nanum Gothic",sans-serif';
  const font = (px, b) => (b ? "bold " : "") + px + "px " + FONT;
  const IC = { bg: "#17181c", box: "#24262c", row2: "#292b32", head: "#32353e", line: "#3c3f48", txt: "#e6e8ec", sub: "#969ba5",
    title: "#ffffff", mark: "#e8a0b0", up: "#ff6363", dn: "#5496ff", ok: "#3ddc84", no: "#5f636e", acc: "#8ab4f8" };
  const GOLD = "#f5c542", GOLDBG = "#3a3218", GOLDHEAD = "#5a4a1a";
  const TOK = /(\{[FodS>]\})/;

  /* ── 토큰이 섞인 글자의 폭 재기·그리기 ── */
  const tokW = (k, px) => ({ F: px * 0.86, o: px * 0.62, d: px * 0.66, S: px * 0.9, ">": px * 0.86 }[k]);
  const meas = (g, t, px, b) => {
    g.font = font(px, b); let w = 0;
    String(t).split(TOK).forEach((p) => { if (!p) return; const m = /^\{(.)\}$/.exec(p); w += m && tokW(m[1], px) ? tokW(m[1], px) : g.measureText(p).width; });
    return w;
  };
  function flame(g, cx, cy, s) {
    const h = s * 1.02, w = s * 0.74, yt = cy - h / 2, yb = cy + h / 2;
    g.save();
    const gr = g.createLinearGradient(0, yt, 0, yb); gr.addColorStop(0, "#ffd84a"); gr.addColorStop(0.5, "#ff9a22"); gr.addColorStop(1, "#ff4d1f");
    g.fillStyle = gr; g.beginPath(); g.moveTo(cx + w * 0.04, yt);
    g.bezierCurveTo(cx + w * 0.10, yt + h * 0.20, cx + w * 0.55, yt + h * 0.36, cx + w * 0.50, yt + h * 0.66);
    g.bezierCurveTo(cx + w * 0.46, yt + h * 0.90, cx + w * 0.22, yb, cx, yb);
    g.bezierCurveTo(cx - w * 0.22, yb, cx - w * 0.52, yt + h * 0.90, cx - w * 0.50, yt + h * 0.64);
    g.bezierCurveTo(cx - w * 0.48, yt + h * 0.44, cx - w * 0.22, yt + h * 0.40, cx - w * 0.14, yt + h * 0.22);
    g.bezierCurveTo(cx - w * 0.04, yt + h * 0.34, cx - w * 0.02, yt + h * 0.12, cx + w * 0.04, yt);
    g.closePath(); g.fill();
    const g2 = g.createLinearGradient(0, yt + h * 0.45, 0, yb); g2.addColorStop(0, "#fff0a0"); g2.addColorStop(1, "#ffb43a");
    g.fillStyle = g2; g.beginPath(); g.moveTo(cx, yt + h * 0.52);
    g.bezierCurveTo(cx + w * 0.30, yt + h * 0.64, cx + w * 0.30, yt + h * 0.9, cx, yb - h * 0.04);
    g.bezierCurveTo(cx - w * 0.30, yt + h * 0.9, cx - w * 0.30, yt + h * 0.64, cx, yt + h * 0.52); g.closePath(); g.fill();
    g.restore();
  }
  function icon(g, k, x, cy, px, fill) {   /* x = 아이콘 칸의 왼쪽 */
    const w = tokW(k, px), cx = x + w / 2;
    if (k === "F") flame(g, cx, cy, px * 1.18);
    else if (k === "o") { g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, px * 0.26, 0, Math.PI * 2); g.fill(); }
    else if (k === "d") { const r = px * 0.3; g.fillStyle = fill; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill(); }
    else if (k === "S") { const R = px * 0.4, r2 = R * 0.42; g.fillStyle = fill; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r2 : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + px * 0.02); } g.closePath(); g.fill(); }
    else if (k === ">") { g.strokeStyle = fill; g.lineWidth = Math.max(1.6, px * 0.09); g.lineCap = "round"; g.lineJoin = "round"; const a = px * 0.3; g.beginPath(); g.moveTo(cx - a, cy); g.lineTo(cx + a, cy); g.moveTo(cx + a * 0.25, cy - a * 0.62); g.lineTo(cx + a, cy); g.lineTo(cx + a * 0.25, cy + a * 0.62); g.stroke(); }
  }
  function text(g, t, x, cy, px, b, fill) {   /* 왼쪽 기준으로 그리고 끝 x 를 돌려줌 */
    g.font = font(px, b); g.fillStyle = fill; g.textBaseline = "middle";
    String(t).split(TOK).forEach((p) => {
      if (!p) return; const m = /^\{(.)\}$/.exec(p);
      if (m && tokW(m[1], px)) { icon(g, m[1], x, cy, px, fill); x += tokW(m[1], px); }
      else { g.font = font(px, b); g.fillStyle = fill; g.fillText(p, x, cy); x += g.measureText(p).width; }
    });
    return x;
  }
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fillRR = (g, x, y, w, h, r, c) => { g.fillStyle = c; rr(g, x, y, w, h, r); g.fill(); };

  window.drawReport = function (spec) {
    const F = 24, FH = 23, ROW = 38, HEAD = 32, PAD = 10, GAPX = 16, GAPY = 18, TITLE = 40, NOTE = 28, M = 16, SUMH = 54;
    const mc = document.createElement("canvas").getContext("2d");
    const W = (t, px, b) => meas(mc, t, px, b);
    const secs = spec.sections.filter(Boolean);
    const tab = secs.filter((s) => s.kind !== "chips");
    /* 자연 열 폭: 머리글·셀 중 가장 긴 것 + 여백. 나란한(half) 박스는 같은 이름의 열을 같은 폭으로 */
    const natural = (s) => (s.cols || []).map(([hn], i) => Math.max(W(hn, FH, true), ...(s.rows || []).map((r) => W(r[i].t, F * (r[i].sz || 1), r[i].b))) + PAD * 2);
    const common = {};
    tab.filter((s) => s.half && s.cols).forEach((s) => natural(s).forEach((w, i) => { const k = s.cols[i][0]; common[k] = Math.max(common[k] || 0, w); }));
    tab.forEach((s) => { s._nat = s.cols ? (s.half ? s.cols.map(([k]) => common[k]) : natural(s)) : []; });
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const titleW = (s) => W(s.title, 26, true) + (s.sub ? W(s.sub, 18) + 40 : 30) + (s.feature ? 70 : 0);
    const halfNeed = Math.max(0, ...tab.filter((s) => s.half).map((s) => Math.max(sum(s._nat) + 8, titleW(s), 300)));
    const fullNeed = Math.max(0, ...tab.filter((s) => !s.half).map((s) => Math.max(sum(s._nat) + 8, titleW(s), 400)));
    const inner = Math.ceil(Math.max(fullNeed, halfNeed * 2 + GAPX, 900));
    const halfW = (inner - GAPX) / 2;
    tab.forEach((s) => {
      s._w = s.half ? halfW : inner;
      if (!s.cols) return;
      const wd = s._nat.slice(), extra = s._w - 8 - sum(wd), tgt = s.cols.map((c, i) => i).filter((i) => s.cols[i][0] !== "#");
      if (extra > 0) tgt.forEach((i) => { wd[i] += extra / tgt.length; });
      s._wd = wd;
    });
    /* 줄 구성: 반폭 박스는 두 개씩 묶고, 짝이 없으면 전체 폭으로 */
    const lines = [];
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i];
      if (s.kind === "chips") { lines.push([s]); continue; }
      if (s.half) { let j = i + 1; while (j < secs.length && !(secs[j].half && secs[j].kind !== "chips")) j++; if (j < secs.length) { const n = secs[j]; secs.splice(j, 1); lines.push([s, n]); } else { s.half = false; s._w = inner; if (s.cols) { const wd = natural(s), ex = inner - 8 - sum(wd), t2 = s.cols.map((c, k) => k).filter((k) => s.cols[k][0] !== "#"); if (ex > 0) t2.forEach((k) => { wd[k] += ex / t2.length; }); s._wd = wd; } lines.push([s]); } }
      else lines.push([s]);
    }
    const rowsN = (s) => Math.max(1, (s.rows || []).length);
    const boxH = (s, rn) => TITLE + HEAD + ROW * rn + 4 + NOTE * (s.notes || []).length;
    lines.forEach((ln) => { if (ln[0].kind === "chips") { ln._h = SUMH; return; } const rn = Math.max(...ln.map(rowsN)); ln.forEach((s) => { s._rn = rn; }); ln._h = Math.max(...ln.map((s) => boxH(s, rn))); });
    const Wl = inner + M * 2, headH = spec.header ? 72 : 0, footH = spec.foot ? 40 : 0;
    const H = M + headH + lines.reduce((a, ln) => a + ln._h + GAPY, 0) - GAPY + footH + M;
    /* 출력 배율: 목표 가로 픽셀(maxW)에 맞추되 세로 한계(가로+세로 ≤ 9800)를 넘지 않게 */
    let scale = spec.scale || (spec.outW ? spec.outW / Wl : 1);
    if ((Wl + H) * scale > 9800) scale = 9800 / (Wl + H);
    const cv = document.createElement("canvas"); cv.width = Math.round(Wl * scale); cv.height = Math.round(H * scale);
    const g = cv.getContext("2d"); g.scale(scale, scale); g.textBaseline = "middle"; g.imageSmoothingQuality = "high";
    g.fillStyle = IC.bg; g.fillRect(0, 0, Wl, H);
    let y = M;
    if (spec.header) {
      /* 위쪽 가는 금빛 띠 + 제목 */
      const bg = g.createLinearGradient(M, 0, Wl - M, 0); bg.addColorStop(0, "rgba(245,197,66,0.9)"); bg.addColorStop(0.5, "rgba(245,197,66,0.25)"); bg.addColorStop(1, "rgba(245,197,66,0)");
      g.fillStyle = bg; g.fillRect(M, y + 2, Wl - M * 2, 3);
      const x1 = text(g, spec.header.title, M, y + 30, 32, true, IC.title);
      g.font = font(18, false); if (spec.header.sub) { const subW = Wl - M * 2 - (x1 - M) - 24; let px = 18; while (px > 13 && W(spec.header.sub, px) > subW) px--; text(g, spec.header.sub, x1 + 18, y + 33, px, false, IC.sub); }
      if (spec.header.sub2) text(g, spec.header.sub2, M, y + 60, 17, false, "#7d848f");
      y += headH;
    }
    lines.forEach((ln) => {
      if (ln[0].kind === "chips") {
        let x = M; const s = ln[0];
        s.chips.forEach((c) => {
          const lab = c.label, val = String(c.value), wl = W(lab, 19, false), wv = W(val, 24, true), w = wl + wv + 38;
          if (x + w > Wl - M) return;
          fillRR(g, x, y + 4, w, 42, 21, c.bg || "#262a33");
          g.strokeStyle = c.color || "#4a5060"; g.lineWidth = 1.6; rr(g, x + 0.8, y + 4.8, w - 1.6, 40.4, 20); g.stroke();
          text(g, lab, x + 16, y + 26, 19, false, "#aab2c0"); text(g, val, x + 22 + wl, y + 26, 24, true, c.color || "#fff");
          x += w + 12;
        });
        y += ln._h + GAPY; return;
      }
      let x = M;
      ln.forEach((s) => {
        const feat = !!s.feature, idx = !!s.index, x0 = x; let yy = y;
        if (feat) { fillRR(g, x0, yy + 5, 64, 28, 6, GOLD); text(g, "{S}핵심", x0 + 6, yy + 20, 18, true, "#1a1a1a"); }
        else { g.fillStyle = idx ? "#7fa8e8" : IC.mark; g.fillRect(x0, yy + 11, 16, 16); }
        const tx = x0 + (feat ? 74 : 24);
        const tEnd = text(g, s.title, tx, yy + 20, 26, true, feat ? GOLD : idx ? "#bcd3f7" : IC.title);
        if (s.sub) { let px = 18; const room = x0 + s._w - tEnd - 18; while (px > 12 && W(s.sub, px) > room) px--; text(g, s.sub, tEnd + 10, yy + 22, px, false, IC.sub); }
        yy += TITLE;
        const bh = HEAD + ROW * s._rn + 4;
        fillRR(g, x0, yy, s._w, bh, 9, feat ? GOLDBG : idx ? "#1b2331" : IC.box);
        if (s.cols) { const hc = feat ? GOLDHEAD : idx ? "#25324a" : IC.head; fillRR(g, x0, yy, s._w, HEAD, 9, hc); g.fillStyle = hc; g.fillRect(x0, yy + HEAD - 9, s._w, 9); }
        g.fillStyle = feat ? GOLD : idx ? "#7fa8e8" : IC.acc; g.fillRect(x0, yy, 4, bh);
        const rows = s.rows || [];
        for (let ri = 0; ri < s._rn; ri++) {
          const ry = yy + HEAD + ri * ROW, sp = s.rowbg && s.rowbg[ri];
          if (sp) { g.fillStyle = sp; g.fillRect(x0 + 5, ry, s._w - 5, ROW); g.fillStyle = String(sp).replace(/[\d.]+\)\s*$/, "0.9)"); g.fillRect(x0 + 5, ry, 3, ROW); }
          else if (ri % 2) { g.fillStyle = feat ? "rgba(245,197,66,0.07)" : IC.row2; g.fillRect(x0 + 5, ry, s._w - 5, ROW); }
          if (ri) { g.fillStyle = feat ? "rgba(245,197,66,0.18)" : IC.line; g.fillRect(x0 + 5, ry, s._w - 5, 1); }
        }
        if (s.cols && rows.length) {
          let cx = x0 + 6;
          s.cols.forEach(([hn, al, hcol], i) => {
            if (i) { g.fillStyle = feat ? "rgba(245,197,66,0.18)" : IC.line; g.fillRect(cx, yy + 5, 1, bh - 10); }
            const put = (t, ty, px, b, fill) => { const w = W(t, px, b), pxl = al === "l" ? cx + PAD : al === "r" ? cx + s._wd[i] - PAD - w : cx + (s._wd[i] - w) / 2; text(g, t, pxl, ty, px, b, fill); };
            put(hn, yy + HEAD / 2 + 1, FH, true, hcol || (feat ? GOLD : IC.sub));
            rows.forEach((r, ri) => {
              const c = r[i], cy = yy + HEAD + ri * ROW + ROW / 2 + 1, px = F * (c.sz || 1);
              if (c.bg) { const bw = Math.max(W(c.t, px, c.b) + 18, 34), bx = al === "l" ? cx + PAD - 6 : al === "r" ? cx + s._wd[i] - PAD - bw + 6 : cx + (s._wd[i] - bw) / 2; fillRR(g, bx, cy - 13, bw, 26, 7, c.bg); }
              put(c.t, cy, px, c.b, c.c || IC.txt);
            });
            cx += s._wd[i];
          });
        } else {
          if (s.cols) { let cx = x0 + 6; s.cols.forEach(([hn, al, hcol], i) => { const w = W(hn, FH, true), pxl = al === "l" ? cx + PAD : al === "r" ? cx + s._wd[i] - PAD - w : cx + (s._wd[i] - w) / 2; text(g, hn, pxl, yy + HEAD / 2 + 1, FH, true, hcol || (feat ? GOLD : IC.sub)); cx += s._wd[i]; }); }
          text(g, s.empty || "— 해당 없음 —", x0 + 16, yy + HEAD + ROW / 2, F, false, IC.sub);
        }
        if (feat) { g.strokeStyle = GOLD; g.lineWidth = 2; rr(g, x0 + 1, yy + 1, s._w - 2, bh - 2, 9); g.stroke(); }
        if (idx) { g.strokeStyle = "#4f6ea8"; g.lineWidth = 2; rr(g, x0 + 1, yy + 1, s._w - 2, bh - 2, 9); g.stroke(); }
        yy += bh;
        (s.notes || []).forEach((n) => { text(g, n, x0 + 6, yy + NOTE / 2 + 3, 18, false, IC.sub); yy += NOTE; });
        x += s._w + GAPX;
      });
      y += ln._h + GAPY;
    });
    if (spec.foot) { const fy = H - M - footH / 2 + 4; g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(M, fy - 20, Wl - M * 2, 1); let px = 17; while (px > 12 && W(spec.foot, px) > Wl - M * 2) px--; text(g, spec.foot, M, fy + 2, px, false, "#7d848f"); }
    return { url: cv.toDataURL("image/png"), w: cv.width, h: cv.height, scale };
  };
})();
