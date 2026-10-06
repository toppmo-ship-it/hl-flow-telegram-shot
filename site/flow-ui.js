/* ═══════════════════════════════════════════════════════════════
   선구안 흐름차트 — UI (flow-ui.js)
   · 설정 자동저장(브라우저 + Supabase 동기화 → 어느 기기에서든 마지막 설정 그대로)
   · 조건검색(7개 그룹, 기본 전부 체크, 해제하면 해당 종목 선이 사라짐) · 종목목록 · 트레이딩뷰 호버팝업
   · 차트총집합 표 · 크로스헤어 툴팁 · 로딩/실시간 루프 · 글씨 10단계 · 선 굵기
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const F=window.FLOW,S=F.S;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const name=t=>F.NAME_KO[t]||t;
const price=t=>{const d=S.data[t],p=F.lastValue(t);return d&&p===p?d.base*(1+p/100):NaN;};

/* ═════════════ 설정 저장/복원 ═════════════ */
const SHOT=F.SHOT,TEST=/[?&]test=/.test(location.search)||SHOT,LSK=TEST?"flow_ui_test":"flow_ui_v2",SBKEY=TEST?"flow_ui_test":"flow_ui_v2";   /* ?test=1 은 개발 검증용 별도 저장 키(사용자 설정 보호) */
function merge(dst,src){Object.keys(src||{}).forEach(k=>{const v=src[k];if(v&&typeof v==="object"&&!Array.isArray(v)&&dst[k]&&typeof dst[k]==="object")merge(dst[k],v);else dst[k]=v;});return dst;}
let saveT=null;
F.saveUI=()=>{
 if(SHOT)return;   /* 촬영 화면은 설정을 어디에도 저장하지 않음(사용자 설정 보호) */
 F.ui.updated=Date.now();
 try{localStorage.setItem(LSK,JSON.stringify(F.ui));}catch(e){}
 clearTimeout(saveT);saveT=setTimeout(()=>F.sbSet(SBKEY,F.ui),1500);
 setSaved("저장 중…");
};
function setSaved(txt){const el=$("saved");if(el)el.textContent=txt;if(txt==="저장 중…"){clearTimeout(setSaved.t);setSaved.t=setTimeout(()=>setSaved("자동저장됨 · "+new Date().toLocaleTimeString("ko-KR",{hour12:false})),1700);}}
async function loadSettings(){
 if(SHOT){F.setExtra([]);return;}
 try{const l=JSON.parse(localStorage.getItem(LSK)||"null");if(l)merge(F.ui,l);}catch(e){}
 /* 서버(다른 기기에서 마지막으로 바꾼 설정)가 더 최신이면 그걸 채택 — 서버 응답이 늦으면 1.2초만 기다림 */
 const srv=F.sbGet(SBKEY,3e11).then(s=>s&&s.v&&s.v.updated>(F.ui.updated||0)?s.v:null).catch(()=>null);
 const s=await Promise.race([srv,new Promise(r=>setTimeout(()=>r(null),1200))]);
 if(s){merge(F.ui,s);try{localStorage.setItem(LSK,JSON.stringify(F.ui));}catch(e){}console.log("[흐름] 서버 저장 설정 적용(다른 기기에서 변경됨)");}
 F.ui.font=Math.min(10,Math.max(1,Math.round(F.ui.font||5)));
 /* 예전 프레임 이름(120일 등) → 새 이름(120D 등), 그린 도형 키도 함께 이전 */
 if(F.OLD_FRAME[F.ui.frame])F.ui.frame=F.OLD_FRAME[F.ui.frame];
 if(!F.FRAMES.some(f=>f.k===F.ui.frame))F.ui.frame="20D";
 if(F.ui.iv!=="auto"&&!F.IVS.some(x=>x.iv===F.ui.iv))F.ui.iv="auto";
 if(F.ui.iv!=="auto"&&!F.ivStatus(F.ui.frame,F.ui.iv).ok)F.ui.iv="auto";
 Object.keys(F.ui.draw||{}).forEach(k=>{if(F.OLD_FRAME[k]){F.ui.draw[F.OLD_FRAME[k]]=F.ui.draw[k];delete F.ui.draw[k];}});
 if(F.ui.sideSplit===0.42)F.ui.sideSplit=0.34;   /* 예전 기본값이면 새 기본값(조건검색 박스를 더 작게)으로 */
 F.setExtra(F.ui.extra||[]);
 F.normInd&&F.normInd();   /* 저장된 옛 설정에 새 기본값(1회 이전) 반영 */
}

/* ═════════════ 조건검색(패싯) ═════════════ */
const FACETS=[
 {id:"vol",title:"3일평균 거래대금",opts:[["v4","1000억+"],["v3","300~1000억"],["v2","100~300억"],["v1","30~100억"],["v0","30억 미만"],["na","정보 없음"]],
  st:t=>{if(!S.data[t])return null;const v=F.vol3dOf(t);if(v==null)return "na";return v>=7e6?"v4":(v>=2e6?"v3":(v>=7e5?"v2":(v>=2e5?"v1":"v0")));}},
 {id:"dkel",title:"일봉 켈트너 (공유캐시)",opts:[["above","상단 돌파"],["mid","중심선~상단"],["below","중심선 아래"],["na","정보 없음"]],
  st:t=>{if(!S.data[t])return null;const d=F.dailyOf(t);if(!d||d.kel_upper==null)return "na";const p=price(t);if(!(p===p))return "na";return p>d.kel_upper?"above":(p>d.kel_basis?"mid":"below");}},
 {id:"cross",title:"골든 / 데드 (가격 × 켈상단, 최근 24봉)",opts:[["golden","골든크로스"],["dead","데드크로스"],["none","없음"]],
  st:t=>{const P=S.P[t],U=S.U[t];if(!P)return null;let n=0;for(let i=P.length-1;i>0&&n<24;i--){if(P[i]!==P[i]||P[i-1]!==P[i-1])continue;n++;const a=P[i]-U[i],b=P[i-1]-U[i-1];if(a>0&&b<=0)return "golden";if(a<0&&b>=0)return "dead";}return "none";}},
 {id:"k4",title:"4시간봉 켈 중심선",opts:[["above","중심선 위 (돌파)"],["below","중심선 아래"],["wait","계산 중"]],
  st:t=>{const e=F.k4[t];if(e==null)return S.data[t]?"wait":null;const p=price(t);return p===p?(p>e?"above":"below"):"wait";}},
 {id:"streak",title:"켈유 (상단 연속 유지일)",opts:[["s3","3일 이상"],["s1","1~2일"],["s0","없음"],["na","정보 없음"]],
  st:t=>{if(!S.data[t])return null;const d=F.dailyOf(t);if(!d||d.kel_streak_days==null)return "na";return d.kel_streak_days>=3?"s3":(d.kel_streak_days>=1?"s1":"s0");}},
 {id:"chg",title:"기간 등락률",opts:[["c5","+5%p 이상"],["c0","0 ~ +5%p"],["cm","−5 ~ 0%p"],["cn","−5%p 이하"]],
  st:t=>{const p=F.lastValue(t);if(!(p===p))return null;return p>=5?"c5":(p>=0?"c0":(p>-5?"cm":"cn"));}},
 {id:"wr",title:"윌리엄스 %R (12)",opts:[["ob","과매수 (−20 위)"],["mid","중립"],["os","과매도 (−80 아래)"],["na","정보 없음"]],
  st:t=>{if(!S.data[t])return null;const d=F.dailyOf(t);if(!d||d.w12==null)return "na";return d.w12>-20?"ob":(d.w12<-80?"os":"mid");}}
];
let vis=new Set();
F.isVisible=t=>vis.has(t);
/* 체크했는데 안 보일 때 이유를 알려줌(데이터 로딩/체크 해제/단독 보기/조건검색으로 제외) */
function hideReason(t){
 if(!S.data[t])return F.coinOf(t)?{k:"load",text:"데이터 받는 중"}:{k:"none",text:"하이퍼리퀴드에 없는 종목"};
 if(F.ui.checks[t]===false)return {k:"off",text:"체크 해제됨"};
 if(F.ui.solo&&F.ui.solo!==t)return {k:"solo",text:"단독 보기 중 ("+name(F.ui.solo)+")"};
 if(F.kindOf(t)==="stock")for(const g of FACETS){const st=g.st(t),f=F.ui.fs[g.id];
  if(st!=null&&f&&f[st]===false){const lab=(g.opts.find(o=>o[0]===st)||[])[1]||st;return {k:"filter",text:"조건검색 제외 · "+g.title+" ▸ "+lab};}}
 return null;
}
F.recalcVis=()=>{
 const nv=new Set();
 F.TICKERS.forEach(t=>{
  if(!S.data[t]||F.ui.checks[t]===false)return;
  if(F.ui.solo&&F.ui.solo!==t)return;
  if(F.kindOf(t)==="stock"){for(const g of FACETS){const st=g.st(t),f=F.ui.fs[g.id];if(st!=null&&f&&f[st]===false)return;}}   /* 조건검색은 종목만: 지수·원자재(코스피·닛케이·금·원유 등)는 조건과 무관하게 체크하면 보임 */
  nv.add(t);
 });
 const ch=nv.size!==vis.size||[...nv].some(t=>!vis.has(t));vis=nv;return ch;
};
function renderFilters(){
 const box=$("filters");box.innerHTML="";
 FACETS.forEach((g,gi)=>{
  const fg=document.createElement("div");fg.className="fg"+(F.ui.collapsed["f_"+g.id]===false?"":" open");
  fg.innerHTML='<div class="fgh"><span class="no">'+(gi+1)+'</span><b>'+esc(g.title)+'</b><span class="ar">▾</span></div><div class="fgb"></div>';
  fg.querySelector(".fgh").onclick=()=>{fg.classList.toggle("open");F.ui.collapsed["f_"+g.id]=!fg.classList.contains("open")?false:true;F.saveUI();};
  const body=fg.querySelector(".fgb");
  g.opts.forEach(([k,label])=>{
   const row=document.createElement("label");row.className="fo";
   const cb=document.createElement("input");cb.type="checkbox";cb.checked=!(F.ui.fs[g.id]&&F.ui.fs[g.id][k]===false);cb.dataset.g=g.id;cb.dataset.k=k;
   cb.onchange=()=>{const f=F.ui.fs[g.id]||(F.ui.fs[g.id]={});if(cb.checked)delete f[k];else f[k]=false;applyFilters();F.saveUI();};
   const sp=document.createElement("span");sp.textContent=label;const em=document.createElement("em");em.dataset.c=g.id+"|"+k;
   row.appendChild(cb);row.appendChild(sp);row.appendChild(em);body.appendChild(row);
  });
  box.appendChild(fg);
 });
 updateFacetCounts();
}
function updateFacetCounts(){
 const cnt={};FACETS.forEach(g=>{g.opts.forEach(([k])=>cnt[g.id+"|"+k]=0);});
 F.TICKERS.forEach(t=>{if(!S.data[t]||F.ui.checks[t]===false||F.kindOf(t)!=="stock")return;FACETS.forEach(g=>{const st=g.st(t);if(st!=null)cnt[g.id+"|"+st]++;});});
 document.querySelectorAll("#filters em").forEach(em=>{em.textContent=cnt[em.dataset.c]!=null?cnt[em.dataset.c]:"";});
}
function applyFilters(){F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();}
function setAllFacets(on){
 F.ui.fs={};if(!on)FACETS.forEach(g=>{F.ui.fs[g.id]={};g.opts.forEach(([k])=>{F.ui.fs[g.id][k]=false;});});
 document.querySelectorAll("#filters input").forEach(cb=>{cb.checked=on;});
 applyFilters();F.saveUI();
}

/* ═════════════ 종목 목록 ═════════════ */
function renderList(){
 const box=$("list");box.innerHTML="";
 F.SECTORS.forEach(sec=>{
  const h=document.createElement("div");h.className="sh";
  const cb=document.createElement("input");cb.type="checkbox";cb.dataset.sec=sec.name;
  cb.onclick=e=>e.stopPropagation();
  cb.onchange=()=>{sec.items.forEach(t=>{F.ui.checks[t]=cb.checked?undefined:false;if(cb.checked)delete F.ui.checks[t];if(cb.checked)ensureTicker(t);});applyFilters();F.saveUI();};
  h.appendChild(cb);
  const b=document.createElement("b");b.textContent=sec.icon+" "+sec.name;h.appendChild(b);
  const sm=document.createElement("small");sm.dataset.secn=sec.name;h.appendChild(sm);
  h.onclick=()=>{const c=F.ui.collapsed["s_"+sec.name];F.ui.collapsed["s_"+sec.name]=!c;updateList();F.saveUI();};
  box.appendChild(h);
  const wrap=document.createElement("div");wrap.dataset.wrap=sec.name;
  sec.items.forEach(t=>wrap.appendChild(tkRow(t)));
  if(sec.pseudo)F.PSEUDO.forEach(p=>wrap.appendChild(pseudoRow(p)));
  box.appendChild(wrap);
 });
}
function tkRow(t){
 const r=document.createElement("div");r.className="tk";r.dataset.t=t;
 const cb=document.createElement("input");cb.type="checkbox";cb.onclick=e=>e.stopPropagation();
 cb.onchange=()=>{if(cb.checked){delete F.ui.checks[t];ensureTicker(t);}else F.ui.checks[t]=false;applyFilters();F.saveUI();};
 const dot=document.createElement("span");dot.className="dot";dot.style.background=F.COLORS[t]||"#888";
 const nm=document.createElement("span");nm.className="nm";nm.innerHTML=esc(name(t))+(F.NAME_KO[t]?"<small>"+esc(t)+"</small>":"");
 const pc=document.createElement("span");pc.className="pc";pc.dataset.pc=t;
 r.appendChild(cb);r.appendChild(dot);r.appendChild(nm);r.appendChild(pc);
 const sb=document.createElement("button");sb.className="sb";sb.textContent="◎";sb.title="이 종목만 보기 (다시 누르면 전체)";
 sb.onclick=e=>{e.stopPropagation();F.ui.solo=F.ui.solo===t?null:t;F.recalcVis();F.refreshVisibility();F.restyle();updateList();F.saveUI();};
 r.insertBefore(sb,pc);
 r.onclick=()=>cb.click();   /* 행 아무 데나 클릭 = 체크 토글(예전엔 단독 보기라 다른 종목이 전부 사라져 오류처럼 보였음) */
 r.onmouseenter=()=>{F.setHover(t);showPop(t,r);};
 r.onmouseleave=()=>{F.setHover(null);hidePopSoon();};
 return r;
}
function pseudoRow(p){
 const key=p.id==="__KU"?"ku":(p.id==="__MID"?"mid":(p.id==="__LOW"?"low":"rs"));
 const r=document.createElement("div");r.className="tk line";r.dataset.p=p.id;
 const cb=document.createElement("input");cb.type="checkbox";cb.checked=F.ui.show[key];
 cb.onchange=()=>{F.ui.show[key]=cb.checked;syncChips();F.restyle();F.refreshVisibility();F.saveUI();};
 const dot=document.createElement("span");dot.className="dot";dot.style.background=p.color;dot.style.boxShadow="0 0 8px "+p.color;
 const nm=document.createElement("span");nm.className="nm";nm.innerHTML=esc(p.name)+"<small>굵은 선</small>";
 const pc=document.createElement("span");pc.className="pc";pc.dataset.pp=p.id;
 r.appendChild(cb);r.appendChild(dot);r.appendChild(nm);r.appendChild(pc);
 r.onclick=e=>{if(e.target===cb)return;cb.checked=!cb.checked;cb.onchange();};
 return r;
}
function updateHideNotices(){
 /* 체크됐는데 조건검색 때문에 안 보이는 종목 수 안내 + 한 번에 해제 */
 const hid=F.TICKERS.filter(t=>F.ui.checks[t]!==false&&S.data[t]&&!vis.has(t)&&(hideReason(t)||{}).k==="filter");
 const strip=$("hideStrip");
 if(hid.length){strip.style.display="flex";strip.innerHTML='<span>체크했지만 <b>조건검색으로 숨겨진 종목 '+hid.length+'개</b> (행의 <b>조건</b> 표시 참고)</span><button id="hsOn">조건 전체 켬</button>';$("hsOn").onclick=()=>setAllFacets(true);}
 else strip.style.display="none";
 const sb=$("soloBar");
 if(F.ui.solo){sb.style.display="flex";sb.innerHTML='<span>◎ '+esc(name(F.ui.solo))+' 만 표시 중 — 다른 종목은 숨김</span><button id="soloOff">전체 보기</button>';$("soloOff").onclick=()=>{F.ui.solo=null;F.recalcVis();F.refreshVisibility();F.restyle();updateList();F.saveUI();};}
 else sb.style.display="none";
}
function updateList(){
 F.SECTORS.forEach(sec=>{
  const rows=sec.items,on=rows.filter(t=>F.ui.checks[t]!==false).length;
  const cb=document.querySelector('#list input[data-sec="'+sec.name+'"]');
  if(cb){cb.checked=on===rows.length;cb.indeterminate=on>0&&on<rows.length;}
  const sm=document.querySelector('[data-secn="'+sec.name+'"]');if(sm)sm.textContent=rows.filter(t=>vis.has(t)).length+"/"+rows.length;
  const wrap=document.querySelector('[data-wrap="'+sec.name+'"]');if(wrap)wrap.style.display=F.ui.collapsed["s_"+sec.name]?"none":"";
 });
 document.querySelectorAll("#list .tk[data-t]").forEach(r=>{
  const t=r.dataset.t,v=F.lastValue(t),cb=r.querySelector("input");
  cb.checked=F.ui.checks[t]!==false;
  r.classList.toggle("off",!vis.has(t));r.classList.toggle("solo",F.ui.solo===t);
  let why=r.querySelector(".why");const hr=vis.has(t)?null:(F.ui.checks[t]!==false?hideReason(t):null);
  if(hr){if(!why){why=document.createElement("span");why.className="why";r.querySelector(".nm").appendChild(why);}
   why.className="why "+(hr.k==="solo"?"solo":(hr.k==="load"?"load":""));why.textContent=hr.k==="filter"?"조건":(hr.k==="solo"?"단독":(hr.k==="load"?"대기":"없음"));why.title=hr.text;}
  else if(why)why.remove();
  const pc=r.querySelector(".pc");
  if(v===v){pc.textContent=F.fmtP(v);pc.className="pc "+(v>=0?"up":"dn");}else{pc.textContent=S.data[t]?"—":(F.coinOf(t)?"…":"없음");pc.className="pc";pc.style.color="var(--mute)";}
 });
 const ku=S.kuA[S.kuA.length-1],rs=S.rsA[S.rsA.length-1],mdl=S.mA[S.mA.length-1],lwl=S.dA[S.dA.length-1];
 document.querySelectorAll("#list [data-pp]").forEach(el=>{const v=el.dataset.pp==="__KU"?ku:(el.dataset.pp==="__MID"?mdl:(el.dataset.pp==="__LOW"?lwl:rs));el.textContent=F.num(v)?F.fmtP(v):"—";el.className="pc "+(F.num(v)&&v>=0?"up":"dn");});
 $("listInfo").textContent="보임 "+vis.size+" / 데이터 "+Object.keys(S.data).length;
 updateHideNotices();
}

/* ═════════════ 트레이딩뷰 호버 팝업 (오른쪽, 벗어나면 즉시 사라짐) ═════════════ */
let popT=null,popFor=null;
function showPop(t,row){
 clearTimeout(popT);popFor=t;
 const pop=$("tvPop"),v=F.lastValue(t),d=S.data[t],k4=FACETS.find(g=>g.id==="k4").st(t),dd=FACETS.find(g=>g.id==="dkel").st(t);
 const L={above:"상단 돌파",mid:"중심선~상단",below:"중심선 아래",wait:"계산 중",na:"—"};
 pop.innerHTML='<div class="hd"><i style="background:'+(F.COLORS[t]||"#888")+'"></i><b>'+esc(name(t))+'</b><small>'+esc(F.NAME_KO[t]?t:F.SECTOR_OF[t]||"")+'</small></div>'
  +'<div class="big2 '+(v>=0?"up":"dn")+'">'+(v===v?F.fmtP(v):"—")+'</div>'
  +'<div class="kv"><span>24h 거래대금</span><b>'+F.fmtEok(F.ntl[F.ALIAS[t]||t]||0)+'</b></div>'
  +'<div class="kv"><span>4시간 중심선</span><b>'+(L[k4]||"—")+'</b></div>'
  +'<div class="kv"><span>일봉 켈트너</span><b>'+(L[dd]||"—")+'</b></div>'
  +'<div class="act"><button class="tv">TradingView ↗</button><button class="sl">'+(F.ui.solo===t?"전체 보기":"이 종목만")+'</button></div>';
 pop.querySelector(".tv").onclick=()=>F.openTV(t);
 pop.querySelector(".sl").onclick=()=>{F.ui.solo=F.ui.solo===t?null:t;F.recalcVis();F.refreshVisibility();F.restyle();updateList();F.saveUI();showPop(t,row);};
 pop.style.display="block";
 const sr=$("side").getBoundingClientRect(),rr=row.getBoundingClientRect(),ph=pop.offsetHeight,pw=pop.offsetWidth;
 pop.style.left=Math.max(8,sr.left-pw-10)+"px";
 pop.style.top=Math.max(8,Math.min(innerHeight-ph-8,rr.top+rr.height/2-ph/2))+"px";
}
function hidePopSoon(){clearTimeout(popT);popT=setTimeout(()=>{$("tvPop").style.display="none";popFor=null;},140);}

/* ═════════════ 크로스헤어 툴팁 ═════════════ */
F.onCrosshair=p=>{
 const tip=$("tip");
 if(!p||p.time==null||!p.point||p.point.x<0){tip.style.display="none";return;}
 const i=S.gidx.get(p.time);if(i==null){tip.style.display="none";return;}
 const rows=[];
 F.TICKERS.forEach(t=>{if(!vis.has(t))return;const v=S.P[t]&&S.P[t][i];if(v===v&&v!=null)rows.push([t,v]);});
 rows.sort((a,b)=>b[1]-a[1]);
 const rs=S.rsA[i],ku=S.kuA[i],md=S.mA[i],lw=S.dA[i];
 let h='<div class="h">'+F.fmtT(p.time)+'</div>';
 if(F.ui.show.ku&&F.num(ku))h+='<div class="r"><i style="background:#f5c542"></i>켈트너 상단<span>'+F.fmtP(ku)+'</span></div>';
 if(F.ui.show.low!==false&&F.num(lw))h+='<div class="r"><i style="background:#f5c542"></i>켈트너 하단<span>'+F.fmtP(lw)+'</span></div>';
 if(F.ui.show.mid!==false&&F.num(md))h+='<div class="r"><i style="background:#4dd9ff"></i>켈트너 중심선<span>'+F.fmtP(md)+'</span></div>';
 if(F.ui.show.rs&&F.num(rs))h+='<div class="r"><i style="background:#fff"></i>상대강도<span>'+F.fmtP(rs)+'</span></div>';
 if(F.num(rs)&&F.num(ku))h+='<div class="r" style="color:var(--dim)">이격<span style="color:'+(rs>=ku?"var(--up)":"var(--dn)")+'">'+F.fmtP(rs-ku,3)+'</span></div>';
 /* 지표 값: 윌리엄스 %R 선들 · EMA 선들(켜져 있는 것만) */
 const I=F.ui.ind;
 if(F.ui.show.wr!==false)I.wr.lines.forEach((l,k)=>{const v=S.wrA[k]&&S.wrA[k][i];if(l.on&&F.num(v))h+='<div class="r"><i style="background:'+l.color+'"></i>W%R '+(l.src==="ku"?"켈상단":"상대강도")+' '+l.len+'<span>'+v.toFixed(1)+'</span></div>';});
 if(F.ui.show.ma!==false)I.ma.lines.forEach((l,k)=>{const v=S.maA[k]&&S.maA[k][i];if(l.on&&F.num(v))h+='<div class="r"><i style="background:'+(l.core?"linear-gradient(90deg,"+l.color+","+l.core+")":l.color)+'"></i>EMA '+l.len+'<span>'+F.fmtP(v)+'</span></div>';});
 const top=rows.slice(0,7),bot=rows.length>12?rows.slice(-3):[];
 const row=([t,v])=>'<div class="r"><i style="background:'+(F.COLORS[t]||"#888")+'"></i>'+esc(name(t))+'<span class="'+(v>=0?"up":"dn")+'">'+F.fmtP(v)+'</span></div>';
 if(rows.length)h+='<div style="height:.3rem"></div>'+top.map(row).join("")+(bot.length?'<div class="r" style="color:var(--mute)">⋮</div>'+bot.map(row).join(""):"");
 tip.innerHTML=h;tip.style.display="block";
 const st=$("stage"),cw=$("chart").clientWidth,tw=tip.offsetWidth,th=tip.offsetHeight;
 let x=p.point.x+plotLeftPx()+18,y=p.point.y+14;
 if(x+tw>cw-6)x=p.point.x+plotLeftPx()-tw-18;
 y=Math.max(6,Math.min(st.clientHeight-th-6,y));
 tip.style.left=x+"px";tip.style.top=y+"px";
};
function plotLeftPx(){return 0;}

/* ═════════════ 데이터 로딩 / 실시간 ═════════════
   원칙: ① 화면은 항상 즉시(메모리→IndexedDB→서버 스냅샷 순) ② 오래됐으면 뒤에서 조용히 갱신해 교체
         ③ 종목 체크와 무관하게 전 종목을 받아 둬서(클릭은 표시만 바꿈) 종목·조건 클릭이 딜레이 없음
         ④ 다른 프레임도 미리 받아 IndexedDB에 저장 → 타임프레임 전환도 즉시 */
let lastForce=0,forcing=false;
let loadTok=0,loading=false,cur={},dataSrc="",dataT=0,lastLive=0,prefetching=false,pq=null;
const progress=(n,tot,txt)=>{const el=$("loading");if(n>=tot||S.grid.length>0){el.style.display="none";return;}   /* 상단 상태창이 주 표시 — 가운데 막대는 차트가 완전히 비어 있을 때만 */
 el.style.display="block";$("loadTxt").textContent=txt||("데이터 수집 "+n+"/"+tot);$("loadBar").style.width=(tot?Math.round(n/tot*100):0)+"%";};
const ago=t=>{const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<90?s+"초 전":Math.round(s/60)+"분 전";};
function pushData(){F.setData(cur);if(!window.__tfirst&&S.grid.length)window.__tfirst=Math.round(performance.now());window.__tlast=Math.round(performance.now());F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();updateInfo();if(SHOT)shotHead();}
function queuePush(){if(pq)return;pq=setTimeout(()=>{pq=null;pushData();},70);}   /* 진행형 수집 중 잦은 갱신을 묶음 */
const allTickers=()=>F.TICKERS.filter(t=>F.coinOf(t));
const enough=(n,tot)=>tot>0&&n>=Math.max(1,Math.ceil(tot*0.9)-1);
/* 직전에 보이던 데이터와 새 데이터 비교: 새로 생긴 봉 수, 값이 바뀐 종목 수, 최대 변동(차트 값 %p) — 갱신이 얼마나 달랐는지 상태창에 표시 */
function diffFrames(a,b){
 let nT=0,newBars=0,changed=0,maxD=0,maxN="";const added=Object.keys(b).filter(k=>!a[k]).length,removed=Object.keys(a).filter(k=>!b[k]).length;
 Object.keys(b).forEach(k=>{const x=a[k],y=b[k];if(!x||!y||!x.t||!y.t||!x.t.length||!y.t.length)return;nT++;
  const lt=x.t[x.t.length-1];let nb=0;for(let i=y.t.length-1;i>=0&&y.t[i]>lt;i--)nb++;newBars+=nb;
  const pa=x.p[x.p.length-1],pb=y.p[y.p.length-1];
  if(F.num(pa)&&F.num(pb)){const d=Math.abs(pb-pa);if(d>1e-9||nb>0)changed++;if(d>maxD){maxD=d;maxN=k;}}});
 return {at:Date.now(),tickers:nT,newBars,changed,maxD,maxN,added,removed};
}
let lastDiff=null;
F.lastDiff=()=>lastDiff;
const diffText=()=>{const d=lastDiff;if(!d)return "";
 return "직전 대비 · 새 봉 +"+d.newBars+" · 값 변경 "+d.changed+"/"+d.tickers+"종목"+(d.maxN?" · 최대 변동 "+d.maxN+" "+d.maxD.toFixed(2)+"%p":"")+(d.added||d.removed?" · 종목 +"+d.added+"/-"+d.removed:"");};
function commit(data,src,t){if(cur&&Object.keys(cur).length){lastDiff=diffFrames(cur,data);console.log("[흐름] "+diffText()+" · 증분 "+F.fetchStat.inc+"건/전체 "+F.fetchStat.full+"건 · 받은 봉 "+F.fetchStat.bars);}
 F.seedTicks(data,F.frameObj());cur=data;dataSrc=src;dataT=t||Date.now();const rec={data,t:t||Date.now()};F.memSet(F.frameObj().key,rec);pushData();return rec;}

async function loadFrame(force){
 const tok=++loadTok,f=F.frameObj(),key=f.key;
 F.beginFrame();
 F.tk.session();F.tk.b("cache");
 /* 1) 즉시 표시 */
 let hit=F.mem[key]||null;   /* 강제 새로고침도 화면을 비우지 않고 저장본을 보여둔 채 뒤에서 증분 갱신 */
 F.forceFresh=!!force||SHOT;   /* 촬영은 매 실행 증분 갱신(새 봉만 받아 이어붙임) */       /* 강제면 캔들 저장본 신선도 검사를 건너뛰고 새 봉만 받아 이어붙임(증분이라 가벼움) */
 if(!hit&&!force){hit=await F.idbGet(key);if(tok!==loadTok)return;if(hit)F.memSet(key,hit);}
 if(hit){F.seedTicks(hit.data,f);cur=hit.data;dataSrc="저장된 데이터 · "+ago(hit.t);dataT=hit.t;pushData();progress(1,1);loading=false;}
 else{F.clearData();cur={};F.recalcVis();updateList();updateInfo();loading=true;progress(0,1,"불러오는 중…");}
 F.tk.d("cache",hit?"저장본 "+ago(hit.t):"저장본 없음");
 F.ready().catch(()=>{});   /* 코인맵은 로컬 저장본이 이미 있어서 기다릴 필요 없음(없으면 아래에서 기다림) */
 if(!F.coinMap){F.tk.b("map");try{await F.ready();F.tk.d("map");}catch(e){F.tk.f("map","연결 실패");progress(1,1);$("foot").textContent="하이퍼리퀴드 연결 실패: "+(e&&e.message||e);loading=false;return;}if(tok!==loadTok)return;}
 let tickers=allTickers();
 if(SHOT){   /* 촬영: 일봉 저장본을 먼저 맞추고(하루 1회 증분) → 거래대금·코인 필터로 받을 종목을 줄임 → 그 종목만 캔들 갱신 */
  await F.ensureDay(tickers,6).catch(()=>{});if(tok!==loadTok)return;
  F.shotComputeDaily();tickers=shotPick(tickers);shotTot=tickers.length;shotSet=new Set(tickers);
 }else if(F.mode()==="kel")F.ensureDay(tickers,6).catch(()=>{});   /* 일봉(켈트너 기준)은 스냅샷 확인과 동시에 병렬로 미리 받기 — 이후 수집이 같은 요청을 공유 */
 const stale=!hit||force||Date.now()-hit.t>F.viewStaleMs(f);   /* 지금 보는 프레임은 빠진 봉이 안 생기게 더 자주 갱신 */
 if(!stale){F.tk.d("shared","생략 (저장본이 최신)");F.tk.d("frame","생략 (저장본이 최신)");afterLoad(tok);return;}
 /* 2) 서버 공유 스냅샷(다른 기기·이전 접속이 받아 둔 것) */
 if(!force){
  F.tk.b("shared");const sh=SHOT?null:await F.loadFrameShared(f,tickers);   /* 촬영은 남이 저장한 스냅샷이 아니라 내 원본 캔들 저장본으로 그림 */if(tok!==loadTok)return;F.tk.d("shared",sh?"공유본 있음 · "+ago(sh.t):"공유본 없음");
  if(sh&&(!hit||sh.t>hit.t+30000)){const rec=commit(sh.data,"서버 공유캐시 · "+ago(sh.t),sh.t);F.idbSet(key,rec);loading=false;progress(1,1);F.tk.d("frame","서버 공유본 사용");afterLoad(tok);return;}
  if(hit){afterLoad(tok);}   /* 공유본이 더 새롭지 않으면 캐시 그대로 두고 아래에서 조용히 갱신 */
 }
 /* 3) 서버 프록시로 병렬 수집(집 IP 한도 미사용). 절반 미만이면 못 받은 것만 서버로 한 번 더 — 느린 브라우저 직접 수집은 그다음 */
 let res=null;
 const onData=data=>{if(tok!==loadTok)return;if(!hit&&!SHOT){cur=Object.assign({},res&&res.data||{},data);queuePush();}   /* 촬영(서버 느린 CPU)은 중간 갱신 없이 완성 후 한 번만 그림 */progress(Object.keys(data).length,tickers.length);F.tk.p("frame",Object.keys(data).length,tickers.length);};
 F.tk.b("frame",tickers.length,hit?"백그라운드 갱신":"");
 try{res=await F.fetchFast(f,tickers,onData,5);}catch(e){console.warn("[흐름] 서버 수집 실패",e&&e.message||e);}
 if(tok!==loadTok)return;
 if(!res||Object.keys(res.data).length<Math.ceil(tickers.length*0.5)){
  await F.sleep(1500);if(tok!==loadTok)return;
  try{const have=(res&&res.data)||{},r2=await F.fetchFast(f,tickers.filter(t=>!have[t]),null,4);
   res={data:Object.assign({},have,r2.data),miss:r2.miss,total:tickers.length};}catch(e){}
  if(tok!==loadTok)return;
 }
 if(res&&Object.keys(res.data).length>=Math.ceil(tickers.length*0.5)){
  const rec=commit(res.data,"실시간 수집 · "+new Date().toLocaleTimeString("ko-KR",{hour12:false}));F.tk.d("frame",Object.keys(res.data).length+"/"+tickers.length+" 수신");
  F.idbSet(key,rec);loading=false;progress(1,1);
  if(!SHOT&&enough(Object.keys(res.data).length,res.total||tickers.length))F.saveFrame(f,res.data);   /* 90% 이상일 때만 공유 저장 */
  afterLoad(tok);return;
 }
 /* 4) 마지막 수단: 브라우저 직접 수집(느림, 속도제한 스로틀) */
 F.tk.b("frame",tickers.length,"직접 수집(느림)");
 await loadDirect(tok,f,tickers,hit);
}
async function loadDirect(tok,f,tickers,hit){
 const w=F.windowOf(f),order=tickers.slice().sort((a,b)=>F.weightOf(b)-F.weightOf(a));
 let done=0;const data={};if(!hit)cur=data;
 await F.pool(order.map(t=>async()=>{
  if(tok!==loadTok)return;
  try{const r=await F.fetchTicker(t,f,w);if(r)data[t]=r;}catch(e){}
  done++;progress(done,order.length);F.tk.p("frame",done,order.length);if(!hit&&(done%5===0||Object.keys(data).length===1))queuePush();
 }),3);
 if(tok!==loadTok)return;
 loading=false;progress(1,1);
 if(Object.keys(data).length){const rec=commit(data,"직접 수집 · "+new Date().toLocaleTimeString("ko-KR",{hour12:false}));F.idbSet(f.key,rec);if(enough(Object.keys(data).length,order.length))F.saveFrame(f,data);}
 F.tk.d("frame","직접 수집 완료");
 afterLoad(tok);
}
function afterLoad(tok){
 if(SHOT){fillMissing();if(!shotWs&&!/[?&]nolive=1/.test(location.search)){shotWs=true;F.startWS(onMids);}return;}   /* 실시간 가격은 그린 뒤에 시작 */   /* 촬영: 조건검색용 부가 수집(일봉 켈 공유·4h 중심선·3일 거래대금)·미리받기 없음 → HL 호출 최소 */
 F.loadDaily().then(()=>{
  if(tok!==loadTok)return;
  F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();
  F.onDaily=()=>{if(tok===loadTok){F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();}};
  F.fillMissingDaily(allTickers(),()=>tok!==loadTok?"abort":loading).catch(()=>{});
 });
 F.onK4=()=>{if(tok===loadTok){if(F.recalcVis())F.refreshVisibility();updateFacetCounts();updateList();}};
 F.loadK4(allTickers(),()=>tok!==loadTok?"abort":loading).catch(()=>{});
 F.onVol3d=()=>{if(tok===loadTok){F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();}};
 F.loadVol3d(allTickers(),()=>tok!==loadTok?"abort":loading).catch(()=>{});
 fillMissing();
 if(!TEST||/[?&]prefetch=1/.test(location.search))setTimeout(prefetchOthers,1200);   /* 검증(?test=1) 중에는 미리받기 끔 — 로컬 IP 한도 보호 */
}
/* 다른 프레임 미리 받기(현재 프레임과 가까운 순) → 전환 시 IndexedDB에서 즉시 */
async function prefetchOthers(){
 if(prefetching)return;prefetching=true;
 try{
  const idx=k=>F.FRAMES.findIndex(f=>f.k===k);
  /* 자주 보는 3분~30분 프레임(3M·15M·30M)을 맨 앞에서 먼저, 나머지는 지금 프레임과 가까운 순 — 세 프레임은 같은 1분봉 원본을 공유해서 첫 하나만 받으면 나머지는 즉시 */
  const PRI=["30M","15M","3M"],pr=k=>{const i=PRI.indexOf(k);return i<0?99:i;};
  const order0=F.FRAMES.slice().sort((a,b)=>pr(a.k)-pr(b.k)||Math.abs(idx(a.k)-idx(F.ui.frame))-Math.abs(idx(b.k)-idx(F.ui.frame))).map(r=>F.frameOf(r.k,"auto"));
  const cur0=F.frameObj().key,near=order0.filter(f=>!PRI.includes(f.k)&&f.k!==F.ui.frame).slice(0,2).map(f=>f.k),order=order0.filter(f=>PRI.includes(f.k)||near.includes(f.k));   /* 미리받기는 3~30분 + 지금 프레임과 가까운 2개만 — 나머지는 눌렀을 때 받음 */
  let pd=0;F.tk.b("pre",order.length);
  for(const f of order){{const x=F.tk.m.pre;if(x)x.note=f.k+" 받는 중";}F.tk.p("pre",++pd,order.length);
   if(f.key===F.frameObj().key)continue;
   while(loading||document.hidden)await F.sleep(1500);
   const c=F.mem[f.key]||await F.idbGet(f.key);
   if(c&&Date.now()-c.t<F.staleMs(f))continue;
   const tickers=allTickers();
   const sh=await F.loadFrameShared(f,tickers);
   if(sh){F.idbSet(f.key,{data:sh.data,t:sh.t});continue;}
   const res=await F.fetchFast(f,tickers,null,2,"bg").catch(()=>null);
   if(res&&Object.keys(res.data).length>=Math.ceil(tickers.length*0.5)){F.idbSet(f.key,{data:res.data,t:Date.now()});if(enough(Object.keys(res.data).length,res.total))F.saveFrame(f,res.data);}
   await F.sleep(500);
  }
 }catch(e){}
 F.tk.d("pre");prefetching=false;
}
/* 등록된 종목 중 아직 데이터가 없는 것(사용자가 새로 추가·관심종목이 늘어남)을 서버 프록시로 한꺼번에 보충 */
let filling=false;
const missTries={};
async function fillMissing(){
 if(filling||loading)return;
 const f=F.frameObj(),miss=(SHOT&&shotSet?allTickers().filter(t=>shotSet.has(t)):allTickers()).filter(t=>{if(cur[t]||S.data[t])return false;const k=f.key+"|"+t;if((missTries[k]||0)>=3)return false;missTries[k]=(missTries[k]||0)+1;return true;});
 if(!miss.length)return;
 filling=true;const tok=loadTok;
 try{
  const res=await F.fetchFast(f,miss,null,3);
  if(tok===loadTok&&res&&Object.keys(res.data).length){
   F.seedTicks(res.data,f);Object.assign(cur,res.data);pushData();
   const rec=F.mem[f.key]||{data:cur,t:Date.now()};rec.data=cur;F.memSet(f.key,rec);F.idbSet(f.key,rec);
  }
 }catch(e){}
 filling=false;
}
/* 데이터가 빠진 종목(코인맵 갱신 등)을 개별 보충 — 평소엔 전 종목을 이미 받아 둬서 거의 안 탐 */
const pending=new Set();
async function ensureTicker(t){
 if(S.data[t]||cur[t]||pending.has(t)||!F.coinOf(t)||loading)return;
 pending.add(t);const tok=loadTok;
 try{const f=F.frameObj(),r=await F.fetchFast(f,[t],null,1);if(r&&r.data[t]&&tok===loadTok){cur[t]=r.data[t];pushData();}}catch(e){}
 pending.delete(t);
}
/* 실시간: WebSocket 이 0.8초마다 최신가를 넘겨줌 → 마지막 봉 갱신(가벼운 것만 매번, 무거운 갱신은 간격을 둠) */
let tCheck=0,tList=0;
function onMids(mids){
 if(SHOT&&window.__shotFreeze)return;   /* 촬영: 준비되면 실시간 갱신을 멈춰 캡처 중 다시 그리지 않게 */
 if(loading||!S.grid.length)return;
 const n=F.live(mids);lastLive=Date.now();
 const now=Date.now();
 if(now-tCheck>3000){tCheck=now;if(F.recalcVis())F.refreshVisibility();}
 if(now-tList>1500){tList=now;updateList();updateInfo();}
 {const lx=F.tk.m.live;if(lx&&lx.state!=="done")F.tk.d("live","연결됨");}
 $("liveDot").className="on";$("liveTxt").textContent="실시간 "+n+"종목 · "+new Date().toLocaleTimeString("ko-KR",{hour12:false});
}
async function liveFallback(){   /* WebSocket 이 20초 넘게 조용하면 REST 로 대신 받음 */
 if(loading||!S.grid.length||Date.now()-lastLive<20000)return;
 try{const mids=await F.mids(Object.keys(S.data));onMids(mids);}catch(e){$("liveDot").className="";$("liveTxt").textContent="실시간 지연";}
}
/* 폰/백그라운드에서 돌아오면 새로고침 없이 이어감: 연결 복구 → 비었으면 다시 로드, 오래됐으면 갱신 */
let resumeT=0;
function resume(){
 if(document.hidden)return;
 const now=Date.now();if(now-resumeT<1500)return;resumeT=now;
 F.wsReopen&&F.wsReopen();
 if(!S.grid.length&&!loading){loadFrame(false);return;}
 const rec=F.mem[F.frameObj().key];
 if(rec&&now-rec.t>F.staleMs(F.frameObj())&&!loading)loadFrame(false);
 else if(Date.now()-lastLive>5000)liveFallback();
}
F.on429=()=>{$("foot").innerHTML='<b style="color:var(--dn)">하이퍼리퀴드 속도제한(429)</b> — 잠시 대기 후 자동 재시도합니다';};

/* ═════════════ 상단/도구/범례 ═════════════ */
function buildFrames(){
 const nav=$("frames");nav.innerHTML="";
 F.FRAME_GROUPS.forEach(g=>{
  const box=document.createElement("div");box.className="fgrp";
  const cap=document.createElement("small");cap.textContent=g.label;box.appendChild(cap);
  F.FRAMES.filter(f=>f.g===g.g).forEach(f=>{
   const b=document.createElement("button");b.className="fbtn"+(F.ui.frame===f.k?" on":"");b.textContent=f.k;b.dataset.k=f.k;
   b.title=f.k+" 기간 · 기본 "+f.iv+"봉"+(f.tick?" + 실시간 틱":"");
   b.onclick=()=>{if(F.ui.frame===f.k)return;F.ui.frame=f.k;if(F.ui.iv!=="auto"&&!F.ivStatus(f.k,F.ui.iv).ok)F.ui.iv="auto";nav.querySelectorAll(".fbtn").forEach(x=>x.classList.toggle("on",x.dataset.k===f.k));refreshIvBar();F.saveUI();loadFrame(false);};
   box.appendChild(b);
  });
  nav.appendChild(box);
 });
}
/* ── 아랫줄: 봉 간격(CANDLE). AUTO=기간 기본값. 20D + 15m 처럼 위 기간을 이 간격의 봉으로 그림 ── */
function buildIvBar(){
 const bar=$("ivbar");bar.innerHTML="";
 const box=document.createElement("div");box.className="fgrp ivgrp";
 const cap=document.createElement("small");cap.textContent="CANDLE";box.appendChild(cap);
 const mk=(iv,label,title)=>{const b=document.createElement("button");b.className="fbtn ibtn";b.dataset.iv=iv;b.textContent=label;b.title=title||"";
  b.onclick=()=>{if(b.disabled)return;if(F.ui.iv===iv)return;F.ui.iv=iv;refreshIvBar();F.saveUI();loadFrame(false);};box.appendChild(b);};
 mk("auto","AUTO","기간에 맞는 기본 봉 간격");
 F.IVS.forEach(x=>mk(x.iv,x.label,x.label+" 봉"));
 bar.appendChild(box);
 const info=document.createElement("div");info.id="ivinfo";bar.appendChild(info);
 refreshIvBar();
}
function refreshIvBar(){
 const fr=F.FRAMES.find(f=>f.k===F.ui.frame)||F.FRAMES[3];
 document.querySelectorAll("#ivbar .ibtn").forEach(b=>{
  const iv=b.dataset.iv;
  if(iv==="auto"){b.classList.toggle("on",F.ui.iv==="auto");b.disabled=false;b.title="기본: "+fr.iv+"봉";return;}
  const st=F.ivStatus(fr.k,iv);
  b.disabled=!st.ok;b.classList.toggle("on",F.ui.iv===iv||(F.ui.iv==="auto"&&fr.iv===iv&&false));
  b.classList.toggle("dflt",F.ui.iv==="auto"&&fr.iv===iv);   /* AUTO일 때 실제로 쓰이는 봉 표시 */
  b.classList.toggle("clamp",st.clamped);
  b.title=iv+" 봉 · "+(st.ok?(st.clamped?"⚠ "+F.MAXBARS+"봉까지만 — 최근 구간만 표시":st.bars+"개 봉"):"이 기간엔 봉이 너무 적어 선택 불가");
 });
 const f=F.frameOf(F.ui.frame,F.ui.iv),st=F.ivStatus(f.k,f.iv);
 const info=$("ivinfo");if(info)info.textContent=f.k+" 기간 · "+f.iv+" 봉"+(f.auto?" (자동)":"")+" · "+(st.clamped?"최대 "+F.MAXBARS+"봉 → 최근 "+(F.windowOf(f).shownDays<1?Math.round(F.windowOf(f).shownDays*24*10)/10+"시간":Math.round(F.windowOf(f).shownDays*10)/10+"일")+"만":st.bars+"개 봉");
}

const TOOLS=[["cursor","✥","이동·확대 (기본)"],["line","／","선 — 등락률 실측"],["rect","▭","사각형 음영 — 등락률"],["ellipse","◯","원 음영 — 등락률"],["erase","⌫","지우개 (도형 클릭)"]];
function buildTools(){
 const box=$("tools");box.innerHTML="";
 TOOLS.forEach(([k,ic,tt])=>{const b=document.createElement("button");b.className="tbtn"+(F.ui.tool===k?" on":"");b.textContent=ic;b.title=tt;b.dataset.k=k;b.onclick=()=>{F.setTool(k);F.saveUI();};box.appendChild(b);});
 const sp=document.createElement("div");sp.className="tsep";box.appendChild(sp);
 [["↶","되돌리기 (Ctrl+Z)",()=>F.undoShape()],["🗑","도형 전체 삭제",()=>{if(confirm("이 타임프레임의 그려둔 도형을 모두 지울까요?"))F.clearShapes();}],["⤢","전체 보기 (자동 맞춤)",()=>F.fit()]].forEach(([ic,tt,fn])=>{const b=document.createElement("button");b.className="tbtn";b.textContent=ic;b.title=tt;b.onclick=fn;box.appendChild(b);});
 F.onTool=k=>{box.querySelectorAll(".tbtn[data-k]").forEach(b=>b.classList.toggle("on",b.dataset.k===k));};
}
const CHIPS=[
 /* 상단선·중심선·하단선·상대강도 토글은 차트 위 버튼 줄(#chartTools)에 있어서 범례에서는 뺌 */
 ["stocks","종목선",null],["clip","스케일: 이상치 제외",null],["ma","차트 EMA","#ffb020",true],["maLow","하단 EMA","#ffb020",true],["wr","윌리엄스 %R","#9ad0ff",true],["cross","메인 골든/데드",null],["crossBottom","하단 골든/데드",null],["gap","이격 막대",null],
 ["sessions","세션선 KR·US",null],["pills","오른쪽 알약",null],["weekend","주말 음영",null],["h24","24시간 전 선",null]
];
function buildLegend(){
 const box=$("legend");box.innerHTML="";
 CHIPS.forEach(([k,label,c,thick])=>{const el=document.createElement("button");el.className="chip"+(thick?" thick":"");el.dataset.k=k;
  el.innerHTML='<span class="sw" style="--c:'+(c||"#7f95bd")+'"></span>'+esc(label);
  el.onclick=()=>{F.ui.show[k]=!F.ui.show[k];syncChips();F.restyle();F.refreshVisibility();F.saveUI();};box.appendChild(el);});
 const w=document.createElement("button");w.className="chip on";w.id="chipW";w.onclick=()=>{F.ui.weight=F.ui.weight==="ntl"?"eq":"ntl";syncChips();F.refreshVisibility();F.saveUI();};box.appendChild(w);
 const info=document.createElement("div");info.className="info";info.id="linfo";box.appendChild(info);
 syncChips();
}
function syncChips(){
 document.querySelectorAll("#legend .chip[data-k]").forEach(el=>el.classList.toggle("on",!!F.ui.show[el.dataset.k]));
 const w=$("chipW");if(w){w.textContent="가중: "+(F.ui.weight==="ntl"?"거래대금":"균등");}
 document.querySelectorAll('#list .tk.line input').forEach(cb=>{const dp=cb.closest(".tk").dataset.p,k=dp==="__KU"?"ku":(dp==="__MID"?"mid":(dp==="__LOW"?"low":"rs"));cb.checked=F.ui.show[k]!==false&&!!F.ui.show[k];});
 const tk=$("toggleKu"),tr=$("toggleRs"),tm=$("toggleMid"),tl=$("toggleLow");if(tk)tk.classList.toggle("on",!!F.ui.show.ku);if(tr)tr.classList.toggle("on",!!F.ui.show.rs);if(tm)tm.classList.toggle("on",F.ui.show.mid!==false);if(tl)tl.classList.toggle("on",F.ui.show.low!==false);
}
function updateInfo(){
 const f=F.frameObj();
 $("linfo").textContent="기준 "+F.baseLabel(f)+" 대비 · "+f.k+" 기간 · "+f.iv+"봉 · 보임 "+vis.size+"종목";
 const c=S.crosses[S.crosses.length-1];
 $("foot").innerHTML='<span>데이터 <b>'+esc(dataSrc||"—")+'</b></span><span>요청 예산 <b>'+F.budgetUsed()+'/400</b>/분</span>'
  +(c?'<span>최근 <b class="'+(c.type==="golden"?"cg":"cd")+'">'+(c.type==="golden"?"▲ 골든":"▼ 데드")+'</b> '+F.fmtT(c.time)+'</span>':'')
  +'<span id="saved" style="margin-left:auto">'+esc(($("saved")&&$("saved").textContent)||"자동저장")+'</span>';
}
function applyFont(){
 document.documentElement.style.setProperty("--s",F.scale());
 $("fLvl").textContent=F.ui.font;
 $("chart").style.right=innerWidth<=1100?"0px":Math.round(208*F.scale())+"px";
 F.applyFont();
}
function buildWidths(){
 const p=$("wPop");
 if(!(F.ui.w.mid>0))F.ui.w.mid=F.ui.w.line;   /* 켈 중심선 굵기: 처음엔 켈상단·하단선과 같게 */
 const rows=[["stock","종목선",1,8,"#9db2d6"],["index","지수선",1,10,"#a5fde5"],["commodity","원자재선",1,10,"#ffd54a"],["line","켈상단·하단·상대강도",1.5,12,"#f5c542"],["mid","켈 중심선",1.5,12,"#4dd9ff"]];
 p.innerHTML="<h4>선 굵기 <span style='font-weight:500;color:var(--mute);font-size:.7rem'>각각 따로 조절 · 자동저장</span></h4>"+rows.map(([k,l,mn,mx,c])=>'<div class="row"><span>'+l+'</span><input type="range" data-k="'+k+'" min="'+mn+'" max="'+mx+'" step="0.2" value="'+F.ui.w[k]+'"><b id="wv_'+k+'">'+(+F.ui.w[k]).toFixed(1)+'</b></div><div class="prev" id="wp_'+k+'" style="background:'+c+';height:'+F.ui.w[k]+'px"></div>').join("");
 p.querySelectorAll("input").forEach(inp=>inp.oninput=()=>{const k=inp.dataset.k,v=+inp.value;F.ui.w[k]=v;$("wv_"+k).textContent=v.toFixed(1);$("wp_"+k).style.height=v+"px";F.restyle();F.saveUI();});
}
/* ── 종목선 표시 방식(선/캔들/하이킨아시) 버튼 라벨 — 데이터는 그대로, 그리는 방식만 즉시 전환 ── */
const STYLE_LABEL={line:"표시: 선",candle:"표시: 캔들",heikin:"표시: 하이킨아시"};
/* 표시 기준 버튼: 켈상단(기본) ↔ 기간시작(예전 방식) — 모드별로 캐시가 따로라 전환해도 즉시 표시 */
function refreshModeBtn(){const b=$("btnMode");if(!b)return;const k=F.mode()==="kel";b.textContent=k?"기준: 켈상단":"기준: 기간시작";b.classList.toggle("acc",k);}
function refreshStyleBtn(){const b=$("btnStyle");if(!b)return;const m=F.ui.candleMode||"line";b.textContent=STYLE_LABEL[m];b.classList.toggle("acc",m!=="line");}

/* ═════════════ 차트총집합 표 ═════════════ */
let sortKey="chg",sortDir=-1;
const TAG={above:["g","상단 돌파"],mid:["y","중심~상단"],below:["r","중심 아래"],wait:["n","계산 중"],na:["n","—"],golden:["g","골든"],dead:["r","데드"],none:["n","없음"],s3:["g","3일+"],s1:["y","1~2일"],s0:["n","0"],ob:["r","과매수"],os:["g","과매도"],mid2:["n","중립"]};
const tag=(k,alt)=>{const t=TAG[k]||["n","—"];return '<span class="tag '+t[0]+'">'+(alt||t[1])+'</span>';};
function rowsData(){
 const gDkel=FACETS.find(g=>g.id==="dkel"),gCross=FACETS.find(g=>g.id==="cross"),gK4=FACETS.find(g=>g.id==="k4");
 return F.TICKERS.map(t=>{const d=F.dailyOf(t),v=F.lastValue(t);
  return {t,sec:F.SECTOR_OF[t],chg:v,ntl:F.ntl[F.ALIAS[t]||t]||0,dk:gDkel.st(t),cross:gCross.st(t),k4:gK4.st(t),streak:d&&d.kel_streak_days!=null?d.kel_streak_days:null,w:d&&d.w12!=null?d.w12:null,vis:vis.has(t),has:!!S.data[t]};});
}
function openTable(){
 const m=$("tableModal");m.classList.add("on");renderTable();
 m.onclick=e=>{if(e.target===m)closeTable();};
}
function closeTable(){$("tableModal").classList.remove("on");}
function renderTable(){
 const rows=rowsData();
 const val=r=>sortKey==="chg"?(r.chg===r.chg?r.chg:-1e9):sortKey==="ntl"?r.ntl:sortKey==="streak"?(r.streak==null?-1:r.streak):sortKey==="w"?(r.w==null?-1e9:r.w):sortKey==="t"?r.t:(r[sortKey]||"");
 rows.sort((a,b)=>{const x=val(a),y=val(b);return (x<y?-1:x>y?1:0)*sortDir;});
 const rs=S.rsA[S.rsA.length-1],ku=S.kuA[S.kuA.length-1],c=S.crosses[S.crosses.length-1];
 const th=(k,l,left)=>'<th data-k="'+k+'" class="'+(left?"l":"")+'">'+l+(sortKey===k?(sortDir<0?" ▼":" ▲"):"")+'</th>';
 $("tbox").innerHTML='<div id="thead"><h2>📊 차트총집합</h2><div class="sum"><span>기준 <b>'+esc(F.ui.frame)+' · '+F.frameObj().iv+'봉</b></span><span>상대강도 <b>'+(F.num(rs)?F.fmtP(rs):"—")+'</b></span><span>켈상단 <b>'+(F.num(ku)?F.fmtP(ku):"—")+'</b></span><span>이격 <b>'+(F.num(rs)&&F.num(ku)?F.fmtP(rs-ku,3):"—")+'</b></span>'
  +(c?'<span>최근 <b class="'+(c.type==="golden"?"cg":"cd")+'">'+(c.type==="golden"?"▲ 골든":"▼ 데드")+'</b> '+F.fmtT(c.time)+'</span>':'')+'<span>보임 <b>'+vis.size+'</b>/'+F.TICKERS.length+'</span></div><div class="grow" style="flex:1"></div><button class="pill" id="tClose">✕ 닫기</button></div>'
  +'<div id="tscroll"><table><thead><tr>'+th("t","종목",1)+th("sec","섹터",1)+th("chg","등락(%p)")+th("ntl","24h 대금")+th("dk","일봉 켈")+th("cross","골든/데드")+th("k4","4h 중심선")+th("streak","켈유")+th("w","W%R(12)")+'<th>TV</th></tr></thead><tbody>'
  +rows.map(r=>'<tr class="'+(r.vis?"":"hid")+'" data-t="'+r.t+'"><td><span class="dot" style="background:'+(F.COLORS[r.t]||"#888")+'"></span><b>'+esc(name(r.t))+'</b>'+(F.NAME_KO[r.t]?' <small style="color:var(--mute)">'+r.t+'</small>':'')+'</td><td class="l" style="color:var(--dim)">'+esc(r.sec)+'</td>'
   +'<td class="'+(r.chg>=0?"up":"dn")+'"><b>'+(r.chg===r.chg?F.fmtP(r.chg):(r.has?"—":"데이터 없음"))+'</b></td><td>'+F.fmtEok(r.ntl)+'</td><td>'+(r.dk?tag(r.dk):"—")+'</td><td>'+(r.cross?tag(r.cross):"—")+'</td><td>'+(r.k4?tag(r.k4):"—")+'</td>'
   +'<td>'+(r.streak==null?"—":r.streak+"일")+'</td><td>'+(r.w==null?"—":r.w.toFixed(0))+'</td><td><button class="tvb" data-tv="'+r.t+'">TV ↗</button></td></tr>').join("")+'</tbody></table></div>';
 $("tClose").onclick=closeTable;
 $("tbox").querySelectorAll("th[data-k]").forEach(h=>h.onclick=()=>{const k=h.dataset.k;if(sortKey===k)sortDir*=-1;else{sortKey=k;sortDir=k==="t"||k==="sec"?1:-1;}renderTable();});
 $("tbox").querySelectorAll("button.tvb").forEach(b=>b.onclick=e=>{e.stopPropagation();F.openTV(b.dataset.tv);});
 $("tbox").querySelectorAll("tbody tr").forEach(tr=>tr.onclick=()=>{F.ui.solo=F.ui.solo===tr.dataset.t?null:tr.dataset.t;F.recalcVis();F.refreshVisibility();F.restyle();updateList();F.saveUI();renderTable();});
}


/* ═════════════ 사이드 패널: 폭·조건검색/종목 높이 비율을 손으로 조절(자동저장·동기화) ═════════════ */
function applySideVars(){
 const side=$("side");
 if(F.ui.sideW>0)side.style.setProperty("--sidew",F.ui.sideW+"px");else side.style.removeProperty("--sidew");
 side.style.setProperty("--filth",Math.round(Math.min(0.9,Math.max(0.05,F.ui.sideSplit||0.42))*1000)/10+"%");
}
function bindSideResize(){
 const drag=(el,onMove)=>{
  el.addEventListener("pointerdown",e=>{
   e.preventDefault();el.setPointerCapture(e.pointerId);el.classList.add("on");
   const move=ev=>{onMove(ev);F.redraw();};
   const up=()=>{el.classList.remove("on");el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",up);F.saveUI();};
   el.addEventListener("pointermove",move);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
  });
 };
 drag($("sideResize"),ev=>{F.ui.sideW=Math.max(240,Math.min(Math.round(innerWidth*0.6),Math.round(innerWidth-ev.clientX)));applySideVars();});
 drag($("sideSplit"),ev=>{const sr=$("side").getBoundingClientRect(),ft=$("filters").getBoundingClientRect().top;F.ui.sideSplit=Math.min(0.9,Math.max(0.05,(ev.clientY-ft)/sr.height));applySideVars();});
 $("sideResize").addEventListener("dblclick",()=>{F.ui.sideW=0;applySideVars();F.saveUI();});
 $("sideSplit").addEventListener("dblclick",()=>{F.ui.sideSplit=0.34;applySideVars();F.saveUI();});
}

/* ═════════════ 종목 관리: HL 전체 종목 검색·추가, 내 트레이딩뷰 관심종목 켜기/끄기 ═════════════ */
let pickTab="watch",pickQ="";
function inRegistry(t){return F.TICKERS.includes(t);}
function onChart(t){return inRegistry(t)&&F.ui.checks[t]!==false;}
function togglePick(t){
 const isExtra=F.extra.includes(t),staticReg=inRegistry(t)&&!isExtra;
 if(staticReg){if(F.ui.checks[t]===false)delete F.ui.checks[t];else F.ui.checks[t]=false;}
 else if(isExtra){F.ui.extra=F.ui.extra.filter(x=>x!==t);delete F.ui.checks[t];}
 else{F.ui.extra=(F.ui.extra||[]).concat([t]);delete F.ui.checks[t];}
 afterPickChange();
}
function afterPickChange(){
 if(F.ui.sideSplit===0.42)F.ui.sideSplit=0.34;   /* 예전 기본값이면 새 기본값(조건검색 박스를 더 작게)으로 */
 F.setExtra(F.ui.extra||[]);renderList();F.recalcVis();F.refreshVisibility();updateFacetCounts();updateList();F.saveUI();fillMissing();renderPick(true);
}
function openPick(){$("pickModal").classList.add("on");renderPick();const m=$("pickModal");m.onclick=e=>{if(e.target===m)closePick();};}
function closePick(){$("pickModal").classList.remove("on");}
function renderPick(keepScroll){
 const box=$("pbox"),map=F.coinMap||{},q=pickQ.trim().toUpperCase();
 const sc=keepScroll&&$("pscroll")?$("pscroll").scrollTop:0;
 const dexTag=t=>{const m=map[F.ALIAS[t]||t];return m?(m.dex===""?"HL":m.dex):"—";};
 const item=t=>'<div class="pitem'+(onChart(t)?" on":"")+'" data-t="'+esc(t)+'"><input type="checkbox" '+(onChart(t)?"checked":"")+' tabindex="-1"><span class="dot" style="background:'+(F.COLORS[t]||"#8899aa")+'"></span><b>'+esc(F.NAME_KO[t]||t)+'</b><small>'+dexTag(t)+(F.ntl[F.ALIAS[t]||t]?" · "+F.fmtEok(F.ntl[F.ALIAS[t]||t]):"")+'</small></div>';
 let body="",shown=0;
 if(pickTab==="watch"){
  F.SECTORS.filter(sec=>sec.watch||sec.name==="기존 알트코인").forEach(sec=>{
   const items=sec.items.filter(t=>!q||t.includes(q)||(F.NAME_KO[t]||"").toUpperCase().includes(q));if(!items.length)return;
   shown+=items.length;
   body+='<div class="psec"><span>'+esc(sec.icon)+" "+esc(sec.name)+' <small style="color:var(--mute)">('+items.filter(onChart).length+"/"+items.length+')</small></span><button class="mbtn" data-sec="'+esc(sec.name)+'">이 그룹 전체 켬/끔</button></div><div class="pgrid">'+items.map(item).join("")+"</div>";
  });
 }else{
  let list=Object.keys(map);
  if(pickTab==="added")list=F.extra.slice();
  list=list.filter(t=>!q||t.toUpperCase().includes(q)||(F.NAME_KO[t]||"").toUpperCase().includes(q));
  list.sort((a,b)=>(F.ntl[b]||0)-(F.ntl[a]||0));shown=list.length;
  body='<div class="pgrid">'+list.slice(0,600).map(item).join("")+"</div>"+(list.length>600?'<div style="padding:.8rem;color:var(--mute);font-size:.78rem">검색어를 입력하면 더 좁혀집니다 (상위 600개만 표시)</div>':"");
 }
 const total=Object.keys(map).length;
 box.innerHTML='<div id="phead"><h2>＋ 종목 관리</h2><input id="psearch" placeholder="종목 검색 (예: NVDA, BTC, 금)" value="'+esc(pickQ)+'" autocomplete="off"><button class="pill" id="pClose">✕ 닫기</button></div>'
  +'<div id="ptabs"><button class="ptab'+(pickTab==="watch"?" on":"")+'" data-tab="watch">🅰️ 내 관심종목 (TradingView)</button><button class="ptab'+(pickTab==="all"?" on":"")+'" data-tab="all">HL 전체 종목 ('+total+')</button><button class="ptab'+(pickTab==="added"?" on":"")+'" data-tab="added">추가한 종목 ('+F.extra.length+')</button>'
  +'<button class="mbtn" id="pAllOn">보이는 종목 전체 켬</button><button class="mbtn" id="pAllOff">보이는 종목 전체 끔</button><span id="pinfo">차트에 올린 종목 '+F.TICKERS.filter(onChart).length+' · 표시 '+shown+'</span></div>'
  +'<div id="pscroll">'+(body||'<div style="padding:2rem;color:var(--mute)">'+(total?"결과가 없습니다":"종목 정보를 불러오는 중…")+"</div>")+"</div>";
 $("pscroll").scrollTop=sc;
 const inp=$("psearch");if(!keepScroll)setTimeout(()=>inp.focus(),30);
 inp.oninput=()=>{pickQ=inp.value;const pos=inp.selectionStart;renderPick(false);const i2=$("psearch");i2.focus();i2.setSelectionRange(pos,pos);};
 $("pClose").onclick=closePick;
 box.querySelectorAll(".ptab").forEach(b=>b.onclick=()=>{pickTab=b.dataset.tab;renderPick();});
 box.querySelectorAll(".pitem").forEach(el=>el.onclick=()=>togglePick(el.dataset.t));
 box.querySelectorAll(".psec .mbtn").forEach(b=>b.onclick=()=>{const sec=F.SECTORS.find(x=>x.name===b.dataset.sec);if(!sec)return;const on=sec.items.filter(onChart).length===sec.items.length;sec.items.forEach(t=>{if(on)F.ui.checks[t]=false;else delete F.ui.checks[t];});afterPickChange();});
 const visibleList=()=>[...box.querySelectorAll(".pitem")].map(x=>x.dataset.t);
 const bulk=on=>{
  const ts=visibleList();
  if(on&&pickTab==="all"&&ts.length>150&&!confirm(ts.length+"개 종목을 한꺼번에 차트에 올립니다. 데이터가 많아 처음엔 조금 걸릴 수 있어요. 계속할까요?"))return;
  ts.forEach(t=>{
   const isExtra=F.extra.includes(t),reg=inRegistry(t);
   if(on){if(reg){delete F.ui.checks[t];}else{F.ui.extra=(F.ui.extra||[]).concat([t]);}}
   else{if(isExtra){F.ui.extra=F.ui.extra.filter(x=>x!==t);delete F.ui.checks[t];}else if(reg)F.ui.checks[t]=false;}
  });
  F.ui.extra=Array.from(new Set(F.ui.extra||[]));afterPickChange();
 };
 $("pAllOn").onclick=()=>bulk(true);$("pAllOff").onclick=()=>bulk(false);
}

/* ═════════════ 지표 설정 팝업(⚙): 상단 EMA / 하단 이격뷰 / 하단 윌리엄스 %R ═════════════
   모든 입력칸은 data-p="경로"(F.ui.ind 기준, '@'로 시작하면 F.ui 기준) + data-t="형식"으로 묶어 한 곳(위임)에서 처리.
   값이 바뀌면 즉시 차트에 반영하고 자동저장(기기 간 동기화). 기간·기준선처럼 계산이 바뀌는 항목만 데이터를 다시 계산. */
const STY=[[0,"실선"],[1,"점선"],[2,"파선"],[3,"긴파선"]];
const SRC=[["rs","상대강도"],["ku","켈트너 상단"]];
const pathObj=p=>p[0]==="@"?[F.ui,p.slice(1)]:[F.ui.ind,p];
function getPath(p){const [o,q]=pathObj(p);return q.split(".").reduce((a,k)=>a==null?a:a[k],o);}
function setPath(p,v){const [o,q]=pathObj(p),ks=q.split(".");let a=o;for(let i=0;i<ks.length-1;i++)a=a[ks[i]];a[ks[ks.length-1]]=v;}
const iNum=(p,min,max,step,ph)=>{const v=getPath(p);return '<input type="number" data-p="'+p+'" data-t="n" min="'+min+'" max="'+max+'" step="'+step+'" value="'+(v==null||(ph&&+v===0)?"":v)+'"'+(ph?' placeholder="'+ph+'"':"")+'>';};
const iCol=(p,c)=>'<input type="color" data-p="'+p+'" data-t="c" value="'+(/^#[0-9a-f]{6}$/i.test(c)?c:"#ffffff")+'">';
const iChk=(p,lab)=>'<label><input type="checkbox" data-p="'+p+'" data-t="b"'+(getPath(p)!==false&&getPath(p)?" checked":"")+'>'+(lab||"")+'</label>';
const iSty=p=>'<select data-p="'+p+'" data-t="i">'+STY.map(([k,l])=>'<option value="'+k+'"'+(+getPath(p)===k?" selected":"")+'>'+l+'</option>').join("")+'</select>';
const iSel=(p,opts)=>'<select data-p="'+p+'" data-t="s">'+opts.map(([k,l])=>'<option value="'+k+'"'+(getPath(p)===k?" selected":"")+'>'+l+'</option>').join("")+'</select>';
const iRange=(p,min,max,step)=>'<input type="range" data-p="'+p+'" data-t="n" min="'+min+'" max="'+max+'" step="'+step+'" value="'+getPath(p)+'">';
const lineRow=(nm,base,extra)=>'<div class="ir">'+iChk(base+".on")+'<span class="nm">'+nm+'</span>'+(extra||"")+iCol(base+".color",getPath(base+".color"))+'<label>굵기'+iNum(base+".w",0.5,14,0.2,base.indexOf("gap.")===0?"자동":"")+'</label>'+iSty(base+".style")+'</div>';
const IND={
 fx:{title:"⚙ 음영 · LED · 점 · 상단 차트",gear:"gearFx",place:"bottom",w:"38rem",body:()=>{
  const FXO=[["off","끔"],["glow","네온 글로우"],["flow","흐르는 LED"],["pulse","맥동(숨쉬기)"]];
  let h='<div class="isec">음영 — 켈 상단선과 하단선 사이 (선·종목선보다 뒤에 깔림)</div>';
  h+='<div class="ir">'+iChk("fx.shade.on","음영 켜기")+'<span class="nm"></span><label>색'+iCol("fx.shade.color",getPath("fx.shade.color"))+'</label><label>진하기'+iRange("fx.shade.a",0.02,0.6,0.02)+'</label></div>';
  h+='<div class="isec">선 위 점 — 꺾이는 봉마다 작은 동그라미 (봉이 너무 촘촘하면 자동으로 숨김)</div>';
  h+='<div class="ir">'+iChk("dots.on","점 표시")+'<span class="nm"></span><label>점 크기'+iRange("dots.size",0.5,6,0.5)+'</label>'+iChk("dots.stocks","종목선에도 표시")+'</div>';
  h+='<div class="isec">LED 효과 — 선마다 다르게 (움직이는 효과는 켠 동안만 부하가 생겨요)</div>';
  [["ku","켈 상단선"],["low","켈 하단선"],["rs","상대강도선"]].forEach(([k,nm])=>{const b="fx.led."+k;
   h+='<div class="ir"><span class="nm">'+nm+'</span>'+iSel(b+".fx",FXO)+'<label>빛 색'+iCol(b+".color",getPath(b+".color"))+'</label><label>속도'+iRange(b+".speed",1,10,1)+'</label><label>세기'+iRange(b+".power",1,14,1)+'</label></div>';});
  h+='<div class="note"><b>네온 글로우</b> = 선 둘레가 은은히 빛남 · <b>흐르는 LED</b> = 밝은 불빛이 선을 따라 흘러감 · <b>맥동</b> = 빛이 숨쉬듯 커졌다 작아짐. 속도는 흐름·맥동에만 적용돼요.</div>';
  return h;}},
 ma:{title:"⚙ EMA 이동평균 · 상단 차트",gear:"gearMa",place:"bottom",w:"43rem",body:()=>{
  const I=F.ui.ind.ma,nb=S.grid.length;
  let h='<div class="isec">기준선 — 어떤 선의 이동평균을 그릴지</div><div class="ir"><span class="nm">계산 대상</span>'+iSel("ma.src",SRC)+iChk("ma.early","봉이 모자라도 첫 값부터 계산(근사)")+'</div>';
  h+='<div class="isec">EMA 7개 — 기간 · 색 · 굵기 · 모양</div>';
  I.lines.forEach((l,i)=>{const b="ma.lines."+i;
   h+='<div class="ir">'+iChk(b+".on")+'<span class="nm">EMA<small>'+l.len+'</small></span><label>기간'+iNum(b+".len",1,2000,1)+'</label>'+iCol(b+".color",l.color)+'<label>굵기'+iNum(b+".w",0.5,14,0.2)+'</label>'+iSty(b+".style")+'<label title="낮출수록 연해져요(장기선을 단기선과 구분)">진하기'+iRange(b+".a",0.2,1,0.05)+'</label>'
    +'<label title="굵은 선 가운데에 가는 선을 한 겹 더 그립니다">이중선<input type="checkbox" data-p="'+b+'.core" data-t="core" data-i="'+i+'"'+(l.core?" checked":"")+'></label>'+iCol(b+".core",l.core||"#ffffff")+'</div>';});
  h+='<div class="note">현재 프레임 <b>'+nb+'봉</b>. EMA 기간이 봉 수보다 길면 값이 충분히 쌓이기 전이라 <b>근사값</b>입니다(TradingView는 그 구간을 비워 둠). 정확한 값만 보려면 위의 「첫 값부터 계산」을 끄세요. 상단 차트의 선 굵기·색은 여기서, 캔들 표시는 상단 「표시」 버튼에서 바꿉니다.</div>';
  return h;}},
 gap:{title:"⚙ 이격 확대뷰 · 하단 지표",gear:"gearGap",place:"top",w:"35rem",body:()=>{
  let h='<div class="isec">선 — 상대강도 × 켈트너 상단 (굵기를 비우면 메인과 동일)</div>';
  h+=lineRow("상대강도","gap.rs")+lineRow("켈트너 상단","gap.ku");
  h+='<div class="isec">이격 막대 (상대강도 − 켈상단)</div><div class="ir">'+iChk("@show.gap","막대 표시")+'<span class="nm"></span><label>상대강도가 위'+iCol("gap.hist.up",getPath("gap.hist.up"))+'</label><label>아래'+iCol("gap.hist.dn",getPath("gap.hist.dn"))+'</label><label>진하기'+iRange("gap.hist.a",0.1,1,0.05)+'</label><label>막대 높이'+iRange("gap.hist.h",0.1,0.7,0.02)+'</label></div>';
  h+='<div class="isec">표시</div><div class="ir">'+iChk("@show.crossBottom","하단 골든/데드 표시(화살표·날짜)")+iChk("@show.maLow","하단 EMA(상대강도 기준 5·10·20·60·120)")+'</div>';
  h+='<div class="note">이 패널은 두 선의 벌어짐을 확대해서 보여주는 자체 스케일 화면입니다. 골든 = 상대강도가 켈상단을 아래→위로 교차.</div>';
  return h;}},
 wr:{title:"⚙ 윌리엄스 %R · 하단 지표",gear:"gearWr",place:"top",w:"43rem",body:()=>{
  const W=F.ui.ind.wr;
  let h='<div class="isec">패널</div><div class="ir">'+iChk("@show.wr","이 패널 보이기")+'</div>';
  h+='<div class="isec">%R 선 — 어느 선에 몇 기간을 적용할지</div>';
  W.lines.forEach((l,i)=>{const b="wr.lines."+i;
   h+='<div class="ir">'+iChk(b+".on")+'<span class="nm">%R<small>'+l.len+'</small></span>'+iSel(b+".src",SRC)+'<label>기간'+iNum(b+".len",2,500,1)+'</label>'+iCol(b+".color",l.color)+'<label>굵기'+iNum(b+".w",0.5,14,0.2)+'</label>'+iSty(b+".style")+'</div>';});
  h+='<div class="isec">부드럽게 이어붙이기</div><div class="ir"><span class="nm">선 다듬기</span><label>평활 기간(1=끔)'+iNum("wr.smooth",1,30,1)+'</label>'+iChk("wr.curve","곡선으로 이어붙이기")+'</div>';
  h+='<div class="isec">과매수 · 과매도 구간</div>';
  h+='<div class="ir">'+iChk("wr.zones","음영 표시")+'<span class="nm"></span><label>과매수 기준'+iNum("wr.ob",-99,0,1)+'</label><label>과매도 기준'+iNum("wr.os",-100,-1,1)+'</label>'+iChk("wr.mid","중간선")+'</div>';
  h+='<div class="ir"><span class="nm">음영 색</span><label>과매수(위)'+iCol("wr.obColor",W.obColor)+'</label><label>과매도(아래)'+iCol("wr.osColor",W.osColor)+'</label><label>진하기'+iRange("wr.zoneA",0.04,0.5,0.02)+'</label></div>';
  h+='<div class="ir"><span class="nm">강한 구간(두 선 모두)</span><label>과매수'+iCol("wr.obColor2",W.obColor2||"#ff5a6e")+'</label><label>과매도'+iCol("wr.osColor2",W.osColor2||"#b07cff")+'</label></div>';
  h+='<div class="note">%R = −100 × (최근 N봉 최고 − 현재) ÷ (최고 − 최저). 여기서는 <b>종목 가격이 아니라 상대강도선·켈상단선 자체</b>(가중평균 %p)에 적용합니다. −20 위 = 과매수, −80 아래 = 과매도(둘 다 위 칸에서 바꿀 수 있어요).</div>';
  return h;}}
};
const DATA_P=/(\.len$|\.src$|\.early$|\.core$|hist\.|@show\.wr$|wr\.smooth$)/;
let indKind=null,indPos=null,aQ=false,aFull=false;
function applyIndQ(full){
 F.saveUI();aFull=aFull||full;if(aQ)return;aQ=true;
 Promise.resolve().then(()=>{aQ=false;const f=aFull;aFull=false;if(f)F.applyInd();else{F.normInd();F.restyleNow();}updateInfo();});
}
function renderInd(){
 const K=IND[indKind],pop=$("indPop");if(!K)return;pop.style.width=K.w;
 pop.innerHTML='<div class="ph" id="indHd"><h4>'+K.title+' <small>변경 즉시 반영 · 자동저장</small></h4><button id="indReset" title="이 지표 설정을 처음 값으로">기본값</button><button id="indClose">✕ 닫기</button></div><div class="pb">'+K.body()+'</div>';
 $("indClose").onclick=closeInd;
 $("indReset").onclick=()=>{
  const d=F.defaultInd(),k=indKind;
  F.ui.ind[k]=d[k];if(k==="wr")F.ui.show.wr=true;if(k==="gap"){F.ui.show.gap=true;F.ui.show.crossBottom=true;}
  syncChips();renderInd();applyIndQ(true);
 };
 bindIndDrag($("indHd"));
}
function placeInd(){
 const K=IND[indKind],pop=$("indPop");if(indPos){pop.style.left=indPos.x+"px";pop.style.top=indPos.y+"px";return;}
 const sr=$("stage").getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight;
 pop.style.left=Math.max(8,Math.round(sr.left+(sr.width-w)/2))+"px";
 pop.style.top=Math.max(8,Math.round(K.place==="bottom"?sr.bottom-h-10:sr.top+10))+"px";
}
function openInd(kind){
 indKind=kind;renderInd();$("indPop").classList.add("on");placeInd();
 Object.keys(IND).forEach(k=>{const g=$(IND[k].gear);if(g)g.classList.toggle("on",k===kind);});
}
function closeInd(){indKind=null;$("indPop").classList.remove("on");Object.keys(IND).forEach(k=>{const g=$(IND[k].gear);if(g)g.classList.remove("on");});}
function bindIndDrag(hd){
 hd.addEventListener("pointerdown",e=>{
  if(e.target.closest("button"))return;
  const pop=$("indPop"),r=pop.getBoundingClientRect(),dx=e.clientX-r.left,dy=e.clientY-r.top;hd.setPointerCapture(e.pointerId);
  const mv=ev=>{const x=Math.max(0,Math.min(innerWidth-80,ev.clientX-dx)),y=Math.max(0,Math.min(innerHeight-40,ev.clientY-dy));indPos={x,y};pop.style.left=x+"px";pop.style.top=y+"px";};
  const up=()=>{hd.removeEventListener("pointermove",mv);hd.removeEventListener("pointerup",up);hd.removeEventListener("pointercancel",up);};
  hd.addEventListener("pointermove",mv);hd.addEventListener("pointerup",up);hd.addEventListener("pointercancel",up);
 });
}
const coreMem={};
function onIndInput(e){
 const el=e.target,p=el.dataset&&el.dataset.p,t=el.dataset&&el.dataset.t;if(!p||!t)return;
 let v;
 if(t==="b")v=el.checked;
 else if(t==="c")v=el.value;
 else if(t==="i")v=+el.value;
 else if(t==="s")v=el.value;
 else if(t==="n"){if(el.value===""){if(el.placeholder)v=0;else return;}else{v=parseFloat(el.value);if(!isFinite(v))return;const mn=el.min!==""?+el.min:-1e9,mx=el.max!==""?+el.max:1e9;v=Math.min(mx,Math.max(mn,v));if(/\.(len|ob|os)$/.test(p))v=Math.round(v);}}
 else if(t==="core"){const i=+el.dataset.i,cur=F.ui.ind.ma.lines[i].core;if(el.checked)v=coreMem[i]||"#ffffff";else{if(cur)coreMem[i]=cur;v=null;}}
 else return;
 if(t==="c"&&/\.core$/.test(p)){const i=+p.split(".")[2];const cb=$("indPop").querySelector('input[data-t="core"][data-i="'+i+'"]');if(cb)cb.checked=true;coreMem[i]=v;}
 setPath(p,v);
 if(p==="@show.ma"||p==="@show.maLow"||p==="@show.wr"||p==="@show.gap"||p==="@show.crossBottom")syncChips();
 /* 기간 칸을 바꾸면 행 제목(EMA 20 등)도 바로 갱신 */
 if(/\.len$/.test(p)){const nm=el.closest(".ir").querySelector(".nm small");if(nm)nm.textContent=v;}
 applyIndQ(DATA_P.test(p));
}
document.addEventListener("input",e=>{if(e.target.closest&&e.target.closest("#indPop"))onIndInput(e);});   /* 체크·선택·색·숫자·슬라이더 모두 input 이벤트로 옴 */

/* ═════════════ 상단 로딩 상태창 ═════════════
   F.tk(flow-data.js)가 알려주는 단계별 시작/진행/대기/끝/실패를 최대 2줄로 보여줌.
   1줄 = 지금 하는 일 · 진행(n/N) · 약 몇 초 남음 / 2줄 = 경과 · 뒤에서 도는 일 · 데이터 출처
   아주 짧게 지나가는 단계도 0.12초씩은 보이도록 '후다닥' 표시 대기열을 둠(최대 8개, 넘치면 오래된 것부터 버림 → 과부하 없음) */
const secs=ms=>ms<1000?"1초 미만":(ms<10000?(ms/1000).toFixed(1)+"초":(ms<60000?Math.round(ms/1000)+"초":Math.floor(ms/60000)+"분 "+Math.round(ms%60000/1000)+"초"));
function tkEta(x){
 if(x.state!=="run"||!(x.total>0)||x.n>=x.total||x.s.length<2)return null;
 const a=x.s[0],b=x.s[x.s.length-1],dt=(b[0]-a[0])/1000,dn=b[1]-a[1];
 if(dt<0.4||dn<=0)return null;
 return (x.total-x.n)/(dn/dt)*1000;
}
function tkLine(x){
 const now=Date.now();
 let h=x.label;
 if(x.total>0&&x.state!=="done")h+=" "+x.n+"/"+x.total;
 if(x.note)h+=" · "+x.note;
 if(x.wait>now)h+=" · "+Math.max(1,Math.ceil((x.wait-now)/1000))+"초 후 재시도";
 const e=tkEta(x);if(e!=null&&!(x.wait>now))h+=e<1000?" · 곧 완료":" · 약 "+secs(e)+" 남음";
 return h;
}
const LD_IC={run:"⏳",done:"✓",fail:"!",wait:"…",idle:"○"};
let ldTimer=null,ldFlash=[],ldShownAt=0,ldSeen={};
function ldNotify(id){
 if(id){const x=F.tk.m[id];if(x){const k=x.state+"|"+x.t0;if(ldSeen[id]!==k){ldSeen[id]=k;   /* 새로 시작했거나 상태가 바뀐 때만 '후다닥' 대기열에 넣음(진행 틱은 제외) */
   const txt=(x.state==="done"?"✓ ":x.state==="fail"?"! ":"")+tkLine(x);
   ldFlash.push(txt);if(ldFlash.length>8)ldFlash.shift();}}}
 if(!ldTimer)ldTimer=setTimeout(ldRender,ldFlash.length?0:100);
}
function ldRender(){
 ldTimer=null;
 const m=F.tk.m,ids=F.tk.order,now=Date.now(),box=$("ldBox");if(!box)return;
 const live=ids.filter(id=>m[id]&&(m[id].state==="run")),fg=live.filter(id=>!m[id].bg),bg=live.filter(id=>m[id].bg);
 const fails=ids.filter(id=>m[id]&&m[id].state==="fail"&&!m[id].bg);
 const prim=fg[0]||bg[0];
 let cls="",l1="",l2="",frac=null;
 if(prim){
  cls="run";const x=m[prim];l1=tkLine(x);frac=x.total>0?Math.min(1,x.n/x.total):null;
  const others=bg.filter(id=>id!==prim).map(id=>{const y=m[id];return y.label+(y.total>0?" "+y.n+"/"+y.total:"");});
  const more=fg.slice(1).map(id=>m[id].label);
  l2="경과 "+secs(now-F.tk.t0)+(more.length?" · 다음: "+more.join(", "):"")+(others.length?" · 뒤에서: "+others.join(" · "):"");
 }else if(fails.length){
  cls="fail";l1="실패: "+fails.map(id=>m[id].label).join(", ")+" — 눌러서 상세";l2="새로고침 또는 상세창의 '다시 시도'";
 }else{
  cls="done";const t1=Math.max(0,...ids.map(id=>m[id]&&m[id].t1||0)),t0=F.tk.t0;
  const dt=new Date(t1||now),p2=n=>String(n).padStart(2,"0");
  l1="최신 데이터 · "+p2(dt.getHours())+":"+p2(dt.getMinutes())+":"+p2(dt.getSeconds())+" 기준";
  l2="출처 "+(dataSrc||"—")+(t1>t0?" · 총 "+secs(t1-t0):"")+(lastDiff?" · "+diffText():"");
 }
 /* 오래된 저장본 경고: 지금 보는 프레임의 데이터가 갱신 기준(봉 2개 길이)보다 오래됐으면 주황색으로 알림 — 오래된 값을 실시간으로 착각하지 않게 */
 let warn=false;
 {const age=dataT?now-dataT:0;
  if(dataT&&age>F.viewStaleMs(F.frameObj())&&Object.keys(S.data).length){
   warn=true;const at=age<3600000?Math.max(1,Math.round(age/60000))+"분":(age/3600000).toFixed(1)+"시간";
   l1="⚠ 저장본 "+at+" 전 · "+(prim?"갱신 중 — "+tkLine(m[prim]):"최신 아님");
   if(cls!=="run"&&cls!=="fail")cls="warn";
  }}
 /* 후다닥: 대기열에 쌓인 짧은 단계들을 0.12초 간격으로 1줄에 차례로 보여줌 */
 let delay=0;
 if(ldFlash.length&&now-ldShownAt>=120){l1=ldFlash.shift();ldShownAt=now;if(cls==="done")cls="run";delay=ldFlash.length?125:0;}
 else if(ldFlash.length)delay=Math.max(20,120-(now-ldShownAt));
 box.className=cls+(warn&&cls==="run"?" warn":"")+(frac==null&&cls==="run"?" ind":"");
 $("ldIc").textContent=cls==="done"?"✓":(cls==="fail"||cls==="warn")?"!":"";
 $("ldL1").textContent=l1;$("ldL2").textContent=l2;
 $("ldBar").style.width=frac==null?"":Math.round(frac*100)+"%";
 if($("ldPop").classList.contains("on"))ldPop();
 if(delay)ldTimer=setTimeout(ldRender,delay);
}
function ldPop(){
 const m=F.tk.m,now=Date.now(),pop=$("ldPop");
 const row=id=>{const x=m[id];if(!x)return '<div class="r s-idle"><i>○</i><b>'+esc(F.tk.label?F.tk.label(id):id)+'</b><span>대기</span></div>';
  const el=x.state==="run"||x.state==="idle"?now-(x.t0||now):(x.t1||now)-(x.t0||now);
  const right=(x.state==="done"?"완료":x.state==="fail"?"실패":x.total>0?x.n+"/"+x.total:"진행 중")+" · "+secs(el);
  const sub=[x.note,x.wait>now?Math.max(1,Math.ceil((x.wait-now)/1000))+"초 후 재시도":"",tkEta(x)!=null?"약 "+secs(tkEta(x))+" 남음":""].filter(Boolean).join(" · ");
  return '<div class="r s-'+x.state+'"><i>'+(LD_IC[x.state]||"○")+'</i><b>'+esc(x.label)+'</b><span>'+right+'</span>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>';};
 const fgIds=F.tk.order.filter(id=>!(m[id]&&m[id].bg)&&!["daily","fill","k4","vol","pre","live"].includes(id)),bgIds=["daily","fill","k4","vol","pre","live"];
 const anyFail=F.tk.order.some(id=>m[id]&&m[id].state==="fail");
 const nv=F.netView(),n1=nv.cur,f2=x=>(+x).toFixed(2);
 const netLine=(label,o)=>'<div class="r s-idle" style="grid-template-columns:1fr"><b style="color:var(--dim)">'+esc(label)+'</b><small style="grid-column:1;margin:0">호출 '+o.calls+'회'+(o.fail?' (실패 '+o.fail+')':'')+' · 평균 응답 <b>'+f2(o.avg)+'초</b> = 서버 처리 '+f2(o.srv)+'초 + 이동 '+f2(o.net)+'초 · 하이퍼리퀴드 평균 '+Math.round(o.hl)+'ms · 429 재시도 '+o.r429+'회'+(o.r5xx?' · 5xx '+o.r5xx+'회':'')+(o.slow?' · 5초 넘음 '+o.slow+'회':'')+'</small></div>';
 const gi=F.gateInfo(),gateHtml='<div style="font-size:.66rem;color:var(--mute);margin:.1rem 0 .2rem">동시 호출 한도 <b style="color:#8fc6ff">'+gi.limit+'</b>(고정 · 지금 보는 화면이 먼저, 미리받기는 뒤에서) · 진행 '+gi.run+' · 대기 '+(gi.waitF+gi.waitB)+'</div>';
 const netHtml='<h5 style="margin-top:.5rem">수집 속도 측정'+(n1.region?' — 서버 지역 <b style="color:#8fc6ff">'+esc(n1.region)+'</b>':'')+'</h5>'+gateHtml+(n1.calls?netLine('이번 접속',n1):'<div style="font-size:.68rem;color:var(--mute)">아직 수집 호출이 없어요</div>')+nv.byRegion.map(o=>netLine('누적 · '+o.region,o)).join('');
 pop.innerHTML='<h5>앞단계 — 화면이 뜰 때까지</h5>'+fgIds.map(row).join("")+'<h5 style="margin-top:.5rem">뒤에서 — 화면이 뜬 뒤 이어지는 일</h5>'+bgIds.map(row).join("")+netHtml+'<div style="margin-top:.4rem;font-size:.66rem;color:var(--mute)">경과 '+secs(now-F.tk.t0)+' · 데이터 출처 '+esc(dataSrc||"—")+'</div>'+(anyFail?'<button id="ldRetry">다시 시도</button>':"");
 {const r=pop.getBoundingClientRect();pop.style.left="0px";const over=pop.getBoundingClientRect().right-(innerWidth-8);if(over>0)pop.style.left=(-over)+"px";}   /* 화면 오른쪽 밖으로 잘리지 않게 */
 const rb=$("ldRetry");if(rb)rb.onclick=()=>{$("ldPop").classList.remove("on");loadFrame(true);};
}
F.tk.on=ldNotify;
setInterval(()=>{if(document.hidden)return;const m=F.tk.m;if(F.tk.order.some(id=>m[id]&&m[id].state==="run"))ldRender();},500);   /* 경과·남은 시간 숫자 갱신 */

/* ═════════════ 촬영 화면(?shot=1): 텔레그램 자동 발송용 ═════════════
   서버의 헤드리스 크롬이 이 주소를 열어 캡처함. 조작 UI는 숨기고, 음영·LED 글로우·점·라벨이 켜진 고정 모양으로 그림.
   설정은 저장하지 않음(F.saveUI 무력화)·다른 프레임 미리받기 없음. 준비 상태는 window.__shotInfo() 로 알려줌 */
function applyShot(){
 document.body.classList.add("shot");
 const q=new URLSearchParams(location.search);
 Object.assign(F.ui,{frame:q.get("frame")||"20D",iv:q.get("iv")||"4h",mode:"kel",candleMode:"line",font:+q.get("font")||6,sideHide:true,solo:null,checks:{},tool:"cursor"});
 F.ui.w.line=+q.get("lw")||4.2;
 Object.assign(F.ui.show,{ku:true,mid:true,low:true,rs:true,stocks:true,pills:true,cross:true,crossBottom:true,gap:true,wr:true,sessions:true,weekend:true,h24:true,ma:q.get("ma")==="1",maLow:q.get("malow")!=="0",clip:false});   /* EMA(장기선 주황·굵게 / 단기선 가늘게)도 같이 그림 — 끄려면 주소에 &ma=0 */   /* clip:false = '이상치 제외' 끔 → 모든 선이 눈금 안에(잘리지 않음) */
 const I=F.ui.ind;
 I.ma.lo=1;   /* 촬영은 쿼리가 정함: 차트 EMA 기본 끔(&ma=1 로 켬) · 하단 EMA 기본 켬(&malow=0 으로 끔) */
 I.fx.shade={on:true,color:"#f5c542",a:0.17};
 I.fx.led.ku={fx:"glow",color:"#ffd84d",speed:5,power:8};I.fx.led.low={fx:"glow",color:"#ffd84d",speed:5,power:8};I.fx.led.rs={fx:"glow",color:"#7fe9ff",speed:5,power:9};
 I.dots={on:true,size:2.2,stocks:false};
 const f=F.frameOf(F.ui.frame,F.ui.iv);
 F.ui.vz=Math.min(300,Math.max(100,+q.get("vz")||100));   /* 세로 확대 % (100=기본) */
 /* 종목선 굵기 1~5 (3 = 예전 기본 굵기 1.6, 기본값은 2) */
 const lv=(k,d)=>Math.min(5,Math.max(1,Math.round(+q.get(k)||d)));
 F.ui.w.stock=[0.8,1.1,1.6,2.2,3.0][lv("sw",2)-1];           /* 종목선 */
 F.ui.w.index=[1.4,2.2,3.6,4.6,5.6][lv("swi",3)-1];          /* 지수선 (3 = 예전 기본 3.6) */
 F.ui.w.commodity=[1.2,2.0,3.2,4.2,5.2][lv("swc",3)-1];      /* 원자재선 (3 = 예전 기본 3.2) */
 /* 지수·원자재는 섹터 박스와 별도로 하나씩 선택(없으면 기본: 지수=나스닥100·코스피200·S&P500, 원자재=브렌트유) */
 const setQ=(k,def)=>{const v=q.get(k);return new Set(v==null?def:v.split(",").filter(Boolean));};
 shotIdx=setQ("idx",["XYZ100","KR200","SP500"]);shotCmd=setQ("cmd",["BRENTOIL"]);
 F.rawUnionBoost(f.iv,f.days);
 /* 조건검색 고정값: vol=허용 거래대금 구간(v4=1000억+, v3=300~1000억…), kel=허용 일봉 켈 위치(above=상단 돌파, mid=중심선~상단, below=중심선 아래), coins=1 이면 코인 포함 */
 const list=k=>{const v=q.get(k);return v==null?null:v.split(",").filter(Boolean);};
 const vols=list("vol"),kels=list("kel");
 shotLead=q.get("lead")==="1";shotAlt=q.get("alt")==="1";   /* 대장주급 코인 / 알트코인 보이기 */
 const secQ=q.get("sec");shotSec=secQ?new Set(secQ.split(",").filter(Boolean)):null;   /* 보일 섹터 이름(없으면 전체) */
 F.ui.fs={};
 if(vols)F.ui.fs.vol=Object.fromEntries(["v4","v3","v2","v1","v0","na"].filter(k=>!vols.includes(k)).map(k=>[k,false]));
 if(kels)F.ui.fs.dkel=Object.fromEntries(["above","mid","below","na"].filter(k=>!kels.includes(k)).map(k=>[k,false]));
 const VK={v4:"1000억↑",v3:"300억↑",v2:"100억↑",v1:"30억↑",v0:"전체"},KK={above:"상단 돌파",mid:"중심~상단",below:"중심 아래"},ORD=["v0","v1","v2","v3","v4"];
 const lowest=vols?ORD.find(k=>vols.includes(k)):null;
 shotFilterTxt="거래대금 "+(vols?(lowest?VK[lowest]:"전체"):"전체")+" · 켈 "+(kels?kels.filter(k=>KK[k]).map(k=>KK[k]).join("+"):"전체")+" · "+(shotLead||shotAlt?"코인 "+[shotLead?"대장":"",shotAlt?"알트":""].filter(Boolean).join("+"):"코인 제외")+(shotSec?" · 섹터 "+shotSec.size+"개":"")+" · 지수 "+shotIdx.size+" · 원자재 "+shotCmd.size+(F.ui.vz>100?" · 차트 높이 "+F.ui.vz+"%":"");
 shotMeta={frame:F.ui.frame,iv:f.iv};
 const h=document.createElement("div");h.id="shotHead";document.getElementById("app").prepend(h);
 window.__shotInfo=()=>({n:Object.keys(cur).length,tot:shotTot||allTickers().length,dayTot:allTickers().length,loading,grid:S.grid.length,day:Object.keys(F.dayC||{}).length,live:lastLive,ws:F.wsState,fetch:F.fetchStat});
}
let shotIdx=new Set(),shotCmd=new Set(),shotWs=false,shotSet=null,shotMeta=null,shotTot=0,shotLead=false,shotAlt=false,shotSec=null,shotFilterTxt="";
const COIN_LEADERS=new Set(["BTC","ETH","SOL","XRP","BNB","HYPE"]);   /* 대장주급 코인(나머지 코인은 알트코인) */
/* 촬영: 받을 종목 고르기 — 코인 제외(옵션), 종목(stock)은 3일평균 거래대금 구간 필터(지수·원자재는 조건과 무관하게 유지) */
function shotPick(list){
 const f=F.ui.fs.vol;
 return list.filter(t=>{
  const kd=F.kindOf(t);
  if(kd==="index")return shotIdx.has(t);       /* 지수·원자재는 하나씩 고른 것만(섹터·조건검색과 무관) */
  if(kd==="commodity")return shotCmd.has(t);
  if(shotSec&&!shotSec.has(F.SECTOR_OF[t]))return false;   /* 선택한 섹터만 */
  if(F.dexOf(t)===""&&!(COIN_LEADERS.has(t)?shotLead:shotAlt))return false;   /* 코인: 대장주급/알트 보이기 버튼(켜진 코인도 아래 거래대금 필터는 똑같이 적용) */
  if(F.kindOf(t)==="stock"&&f){const v=F.vol3dOf(t),c=v==null?"na":(v>=7e6?"v4":(v>=2e6?"v3":(v>=7e5?"v2":(v>=2e5?"v1":"v0"))));if(f[c]===false)return false;}
  return true;
 });
}
const IVKO={"1m":"1분","3m":"3분","5m":"5분","15m":"15분","30m":"30분","1h":"1시간","2h":"2시간","4h":"4시간","8h":"8시간","12h":"12시간","1d":"일","3d":"3일","1w":"주"};
function shotHead(){
 const el=$("shotHead");if(!el||!shotMeta)return;
 const rs=S.rsA&&S.rsA.length?S.rsA[S.rsA.length-1]:NaN,ku=S.kuA&&S.kuA.length?S.kuA[S.kuA.length-1]:NaN;
 const d=new Date(Date.now()+9*3600e3),p2=n=>String(n).padStart(2,"0"),WDK=["일","월","화","수","목","금","토"];
 const when=(d.getUTCMonth()+1)+"/"+d.getUTCDate()+"("+WDK[d.getUTCDay()]+") "+p2(d.getUTCHours())+":"+p2(d.getUTCMinutes());
 const cls=v=>F.num(v)?(v>=0?"up":"dn"):"";
 el.innerHTML='<div class="sh-l"><i class="sh-dot"></i><b>선구안</b><span>흐름차트</span></div>'
  +'<div class="sh-c"><em>'+shotMeta.frame+'</em> 기간 · <em>'+(IVKO[shotMeta.iv]||shotMeta.iv)+'봉</em> · 켈상단 기준<small>'+shotFilterTxt+' · 표시 '+F.TICKERS.filter(t=>F.isVisible(t)).length+'종목</small></div>'
  +'<div class="sh-r"><span class="'+cls(rs)+'">상대강도 <b>'+(F.num(rs)?F.fmtP(rs):"—")+'</b></span><span class="k">켈상단 <b>'+(F.num(ku)?F.fmtP(ku):"—")+'</b></span><span class="t">'+when+' KST</span></div>';
}
/* ═════════════ 시작 ═════════════ */
async function init(){
 F.tk.b("settings");F.tk.b("live");
 await loadSettings();F.tk.d("settings");
 $("ldMain").onclick=e=>{e.stopPropagation();const p=$("ldPop");p.classList.toggle("on");if(p.classList.contains("on"))ldPop();};
 document.addEventListener("click",e=>{const p=$("ldPop");if(p.classList.contains("on")&&!p.contains(e.target))p.classList.remove("on");});
 buildFrames();buildIvBar();buildTools();buildLegend();buildWidths();renderFilters();renderList();
 if(SHOT)applyShot();
 F.initChart($("stage"),$("chart"),$("ov"),Math.round(208*F.scale()));
 F.bindDrawing();F.setTool("cursor");   /* 도구 선택은 저장하지 않고 항상 이동(커서)로 시작 — 선 도구가 켜진 채 열리면 차트 드래그가 막힘 */
 applyFont();
 $("fMinus").onclick=()=>{F.ui.font=Math.max(1,F.ui.font-1);applyFont();F.saveUI();};
 $("fPlus").onclick=()=>{F.ui.font=Math.min(10,F.ui.font+1);applyFont();F.saveUI();};
 $("btnW").onclick=e=>{e.stopPropagation();const p=$("wPop");p.style.display=p.style.display==="block"?"none":"block";};
 refreshStyleBtn();refreshModeBtn();
 $("btnMode").onclick=()=>{F.ui.mode=F.mode()==="kel"?"start":"kel";refreshModeBtn();F.saveUI();loadFrame(false);};
 $("btnStyle").onclick=()=>{const order=["line","candle","heikin"];const next=order[(order.indexOf(F.ui.candleMode||"line")+1)%order.length];F.setCandleMode(next);refreshStyleBtn();};
 document.addEventListener("click",e=>{const p=$("wPop");if(p.style.display==="block"&&!p.contains(e.target))p.style.display="none";});
 $("btnAll").onclick=openTable;
 $("btnPick").onclick=openPick;
 ["Main","Gap","Wr"].forEach((n,i)=>{$("lock"+n).onclick=e=>{e.stopPropagation();F.toggleLock(i);};});
 Object.keys(IND).forEach(k=>{$(IND[k].gear).onclick=e=>{e.stopPropagation();if(indKind===k)closeInd();else openInd(k);};});
 applySideVars();bindSideResize();
 $("btnSide").onclick=()=>{F.ui.sideHide=!F.ui.sideHide;document.body.classList.toggle("side-hide",!!F.ui.sideHide);F.saveUI();};
 document.body.classList.toggle("side-hide",!!F.ui.sideHide);
 $("sideBtn").onclick=()=>document.body.classList.add("side-open");$("sideClose").onclick=()=>document.body.classList.remove("side-open");
 window.addEventListener("resize",()=>{$("chart").style.right=innerWidth<=1100?"0px":Math.round(208*F.scale())+"px";});
 $("btnTV").onclick=()=>F.openTV(F.ui.solo||popFor||"BTC");
 /* 새로고침 연타 방지: 수집 중이면 무시, 마지막 강제 갱신 후 15초 안이면 남은 시간 안내 */
 $("btnRefresh").onclick=()=>{
  const now=Date.now(),wait=15000-(now-lastForce);
  if(forcing){$("foot").textContent="갱신 중이에요 — 끝나면 다시 눌러주세요";return;}
  if(wait>0){$("foot").textContent="방금 갱신했어요 · "+Math.ceil(wait/1000)+"초 뒤에 다시 갱신할 수 있어요 ("+(diffText()||"변화 없음")+")";return;}
  lastForce=now;forcing=true;loadFrame(true).finally(()=>{forcing=false;F.forceFresh=false;});
 };
 /* 전체화면: 브라우저 풀스크린 API (문서 전체) — 지원 안 하는 브라우저(아이폰 사파리 등)는 버튼을 숨김 */
 const fsEl=()=>document.fullscreenElement||document.webkitFullscreenElement||null;
 const fsTarget=$("chartWrap");   /* 사이트 전체가 아니라 차트 영역(도구·범례·버튼 줄·차트·알약)만 전체화면 */
 const canFs=!!(fsTarget.requestFullscreen||fsTarget.webkitRequestFullscreen);
 const fsRefresh=()=>{const b=$("btnFs");if(!b)return;const on=!!fsEl();b.textContent=on?"⛶ 전체화면 끝내기":"⛶ 차트 전체화면";b.classList.toggle("acc",on);document.body.classList.toggle("is-fs",on);window.dispatchEvent(new Event("resize"));};
 const fsToggle=()=>{try{if(fsEl()){(document.exitFullscreen||document.webkitExitFullscreen).call(document);}else{const d=fsTarget;const p=(d.requestFullscreen||d.webkitRequestFullscreen).call(d,{navigationUI:"hide"});if(p&&p.catch)p.catch(()=>{});}}catch(e){}};
 if(canFs){$("btnFs").onclick=fsToggle;document.addEventListener("fullscreenchange",fsRefresh);document.addEventListener("webkitfullscreenchange",fsRefresh);}else $("btnFs").style.display="none";
 const toggleShow=k=>{F.ui.show[k]=!F.ui.show[k];syncChips();F.restyle();F.refreshVisibility();F.saveUI();};
 $("toggleKu").onclick=()=>toggleShow("ku");$("toggleLow").onclick=()=>{F.ui.show.low=F.ui.show.low===false;syncChips();F.restyle();F.refreshVisibility();F.saveUI();};
 $("toggleMid").onclick=()=>{F.ui.show.mid=F.ui.show.mid===false;syncChips();F.restyle();F.refreshVisibility();F.saveUI();};$("toggleRs").onclick=()=>toggleShow("rs");
 document.addEventListener("keydown",e=>{if((e.key==="f"||e.key==="F")&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||"")&&canFs)fsToggle();});
 $("fAll").onclick=()=>setAllFacets(true);$("fNone").onclick=()=>setAllFacets(false);
 $("tAll").onclick=()=>{F.ui.checks={};F.ui.solo=null;renderList();allTickers().forEach(ensureTicker);applyFilters();F.saveUI();};
 $("tNone").onclick=()=>{F.TICKERS.forEach(t=>{F.ui.checks[t]=false;});applyFilters();F.saveUI();};
 $("tvPop").onmouseenter=()=>clearTimeout(popT);$("tvPop").onmouseleave=hidePopSoon;
 document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeTable();closePick();closeInd();}});
 document.addEventListener("visibilitychange",resume);window.addEventListener("pageshow",resume);window.addEventListener("focus",resume);window.addEventListener("online",resume);
 updateList();updateInfo();
 loadFrame(false);
 if(!SHOT)F.startWS(onMids);
 setInterval(()=>{if(!document.hidden&&!loading)fillMissing();},45000);   /* 받지 못한 종목 자동 재시도 */
 setInterval(()=>{updateInfo();liveFallback();if(!S.grid.length&&!loading&&!document.hidden)loadFrame(false);},5000);   /* 워치독: 화면이 비어 있으면 다시 시도 */
 window.__flow=F;   /* 원격 점검용 */
}
init().catch(e=>{console.error("[흐름] 초기화 실패",e);document.body.insertAdjacentHTML("beforeend",'<pre style="position:fixed;left:10px;bottom:10px;color:#ff8c9a;background:#120a0c;padding:10px;border-radius:8px;z-index:99">초기화 실패: '+esc(e&&e.stack||e)+'</pre>');});
})();
