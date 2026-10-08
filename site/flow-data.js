/* ═══════════════════════════════════════════════════════════════
   선구안 흐름차트 — 데이터층 (flow-data.js)
   · 하이퍼리퀴드 요청 스로틀(가중치 예산) · 코인맵/거래대금 · 프레임별 캔들 → 등락률/켈트너상단 계산
   · Supabase 공유 스냅샷(hlgrid_settings, gzip) · 일봉 켈트너 공유캐시 · 4시간봉 켈 중심선
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const F=window.FLOW=window.FLOW||{};
const API="https://api.hyperliquid.xyz/info";
const KST=9*3600;                      /* 화면 시각 = UTC초 + 9시간(라이브러리는 UTC로 표시하므로 미리 더해 KST로 보이게 함) */
F.KST=KST;

/* ── 종목 정보: 고정색(TM 스크리너와 동일) / 섹터 / 트레이딩뷰 심볼 ── */
F.COLORS={BTC:"#f7931a",ETH:"#a78bfa",ZEC:"#ffe600",SMSN:"#3b82f6",SKHYNIX:"#ff4d4d",NVDA:"#76d900",TSLA:"#ff5c8a",HYPE:"#2be8c8",MU:"#a5fdab",SNDK:"#bf59cf",META:"#a5f1fd",PLTR:"#e5fda5",AMD:"#fda5eb",INTC:"#80cf59",GME:"#00ff44",HOOD:"#fdc8a5",MSTR:"#6ce5bd",COIN:"#7859cf",SOL:"#b938fa",DRAM:"#cf5998",KIOXIA:"#00aaff",ARM:"#bfcf59",MRVL:"#a5bdfd",QCOM:"#b4f47b",TSM:"#ff4400",SMH:"#7bc4f4",SOXL:"#a46ce5",STRC:"#59cf90",KNTQUSDC:"#59bfcf",PURRDAT:"#ecf47b",CRCL:"#cf5969",XYZ100:"#a5fde5",SP500:"#59cf61",GOOGL:"#7bf4ec",AAPL:"#5c5cff",MRNA:"#e56cdd",CRWD:"#5969cf",NET:"#fda5b1",MAGS:"#f1a5fd",AMAT:"#00ff99",IREN:"#33ff00",RKLB:"#fdf1a5",BB:"#d4a5fd",SNXX:"#e5a46c",PONS:"#b9fa38",XLM:"#f4937b",SUI:"#5cff7c",DOGE:"#a5fdc8",XRP:"#7ce56c",BNB:"#fda5ce",ADA:"#fa38c6",LINK:"#bdfda5",AVAX:"#f47bc4",SKHY:"#cfa859",
"10Y":"#e879f9",KR200:"#ff9f43",JP225:"#ff6b9d",CL:"#c68b4d",BRENTOIL:"#ff2b2b",GOLD:"#ffd54a",SILVER:"#cfd8e3",NATGAS:"#4fc3f7",COPPER:"#f08a5d",PLATINUM:"#b7c3d0",PALLADIUM:"#8fa6c9"};
/* ── 종목 구성 ──
   기본 그룹 = 사용자의 TradingView 관심종목 '🅰️하이퍼 찐탱전종목들'(2026-09-24 기준 17섹션·109종목) 그대로.
   + '기존 알트코인'(예전에 쓰던 종목) + '내가 추가한 종목'(HL 전체 426개 중 검색해서 추가, 설정에 저장·동기화) */
F.WATCH_NAME="🅰️하이퍼 찐탱전종목들";
const WATCH=[
 ["📊 지수","SP500,XYZ100,JP225,KR200,10Y"],
 ["🏛 빅테크","META,MSFT,SOFTBANK,AAPL,NFLX,AMZN,GOOGL"],
 ["🚀 AI칩 대장 (GPU·CPU·설계)","NVDA,ARM,AMD,INTC"],
 ["🧠 메모리 대장주","MU,SMSN,SKHY,SNDK,SKHYNIX"],
 ["🪙 코인","BTC,KNTQ,ETH,HYPE,ZEC"],
 ["🧲 코인관련주","HOOD,STRC,IREN,COIN,CRCL,PURRDAT,MSTR,KSTR,BMNR"],
 ["📦 ETF·레버리지","XLE,NCLD,MAGS,TLT,EWJ,EWZ,SMH,EWT,DRAM,EWY,URNM,XBI,SOXL,KORU"],
 ["💾 메모리 중소·해외","WDC,CXMT,KIOXIA,GIGADEV"],
 ["🛢 원자재","BRENTOIL,CL,NATGAS,GOLD,COPPER,PALLADIUM,SILVER,PLATINUM"],
 ["🔗 네트워크칩·ASIC","QCOM,MRVL,CBRS,AVGO"],
 ["🏭 파운드리·장비","TSM,ASML,AMAT"],
 ["🔦 광통신·네트워크","NOK,LITE,LYTE,AAOI"],
 ["🤖 AI SW·클라우드·보안","CRWD,PLTR,NOW,ZM,IBM,NET,CRWV,DELL,ORCL,NBIS,BB"],
 ["🇨🇳 중국 AI·로봇","BOT,UNITREE,MINIMAX,ZHIPU"],
 ["🚗 전기차·우주·전력","TSLA,RIVN,RKLB,BE,GEV,SPCX,USAR"],
 ["💊 바이오·헬스","MRNA,LLY,HIMS"],
 ["🛒 소비·기타","GME,SHEIN,BIRD,COST,EBAY,BX,RDDT,HYUNDAI,DKNG,QNT,BABA,SHAZ,SNXX"]
];
F.EXTRA_OLD=["SOL","XRP","DOGE","BNB","ADA","LINK","AVAX","SUI","XLM","PONS"];
F.extra=[];                               /* 사용자가 추가한 종목(짧은 이름) — F.ui.extra 와 동기화 */
F.TVSYM={KNTQ:"HYPERLIQUID:KNTQUSDC"};    /* 관심종목에서 접미사가 다른 예외 */
/* 굵기를 종류별로 따로 조절: stock(일반 종목) / index(지수) / commodity(원자재) */
F.INDEX_SET=new Set(["XYZ100","SP500","KR200","JP225","10Y"]);   /* 10Y = 미국 10년물 국채 금리(HL para:10Y) — 굵기·선택은 지수와 같은 취급 */
F.COMMODITY_SET=new Set(["CL","BRENTOIL","GOLD","SILVER","NATGAS","COPPER","PLATINUM","PALLADIUM"]);
F.kindOf=t=>F.INDEX_SET.has(t)?"index":(F.COMMODITY_SET.has(t)?"commodity":"stock");
/* ── 핵심선 2세트: 항상 보이고(조건검색·단독보기와 무관) 형광(네온) 효과로 도드라지는 선 ──
   ndq = 나스닥100(XYZ100) + 코스피200(KR200 — 하이퍼리퀴드에 코스피 종합은 없고 KR200 이 코스피200 선물) / cmd = 원자재 8종 + 미국10년물 금리(상반된 자산이라 한 세트)
   굵기·형광 세기·표시는 세트 단위로 조절(F.ui.key.<id>) */
F.KEY_SETS=[
 {id:"ndq",name:"나스닥·코스피",icon:"◆",items:["XYZ100","KR200"],def:{on:true,w:4.4,glow:8}},
 {id:"cmd",name:"원자재·금리",icon:"◆",items:["BRENTOIL","CL","NATGAS","GOLD","COPPER","PALLADIUM","SILVER","PLATINUM","10Y"],def:{on:true,w:3.4,glow:6}}
];
const KEY_OF={};F.KEY_SETS.forEach(k=>k.items.forEach(t=>{KEY_OF[t]=k;}));
F.keySetOf=t=>KEY_OF[t]||null;
F.isKey=t=>!!KEY_OF[t];
F.kc=id=>{const u=F.ui||(F.ui={}),K=u.key||(u.key={}),k=F.KEY_SETS.find(x=>x.id===id);const o=K[id]=Object.assign({},k.def,K[id]);o.w=Math.max(1.5,Math.min(12,+o.w||k.def.w));o.glow=Math.max(0,Math.min(14,+o.glow>=0?+o.glow:k.def.glow));o.on=o.on!==false;return o;};
F.NAME_KO={"10Y":"미국10년물금리",KR200:"코스피200",JP225:"닛케이225",XYZ100:"나스닥100",SP500:"S&P500",CL:"WTI원유",BRENTOIL:"브렌트유",GOLD:"금",SILVER:"은",NATGAS:"천연가스",COPPER:"구리",PLATINUM:"백금",PALLADIUM:"팔라듐",SMSN:"삼성전자",SKHYNIX:"SK하이닉스",SKHY:"하이닉스ADR",HYUNDAI:"현대차",SOFTBANK:"소프트뱅크",KIOXIA:"키오시아"};
F.PSEUDO=[{id:"__KU",name:"켈트너 상단",color:"#f5c542"},{id:"__MID",name:"켈트너 중심선",color:"#4dd9ff"},{id:"__LOW",name:"켈트너 하단",color:"#f5c542"},{id:"__RS",name:"상대강도(가중평균)",color:"#ffffff"}];
F.ALIAS={SKHYNIX:"SKHX"};
F.COLORS.KNTQ=F.COLORS.KNTQUSDC||"#59bfcf";
/* 새 종목 색: 이름 해시 → 어두운 배경에서 잘 보이는 색 */
const autoColor=t=>{let h=0;for(let i=0;i<t.length;i++)h=(h*131+t.charCodeAt(i))>>>0;const hue=h%360,sat=0.68,lig=0.62;
 const c=(1-Math.abs(2*lig-1))*sat,x=c*(1-Math.abs((hue/60)%2-1)),m=lig-c/2;const [r,g,b]=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
 return "#"+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,"0")).join("");};
/* ── 종목선 색: 서로 최대한 다르게 ──
   후보 색(색상×채도·밝기 8단) 960개를 Lab 색공간에서 "이미 쓴 색과 가장 먼 색"부터 차례로 뽑아(farthest-point) 종목에 배정.
   흰색(상대강도)·금색(켈상단)·하늘색(중심선)·어두운 배경은 미리 점유해 종목선이 그 색과 겹치지 않게 함. 한 번 배정된 색은 유지(종목이 추가돼도 기존 색은 안 바뀜) */
const hex2rgb=h=>{const n=parseInt(h.slice(1),16);return [n>>16&255,n>>8&255,n&255];};
const rgb2lab=([r,g,b])=>{const f=v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};const R=f(r),G=f(g),B=f(b);
 let x=(R*0.4124+G*0.3576+B*0.1805)/0.95047,y=R*0.2126+G*0.7152+B*0.0722,z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
 const q=v=>v>0.008856?Math.cbrt(v):7.787*v+16/116;x=q(x);y=q(y);z=q(z);return [116*y-16,500*(x-y),200*(y-z)];};
const hsl2hex=(h,s,l)=>{const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return "#"+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,"0")).join("");};
const PINNED_COLOR={BRENTOIL:"#ff2b2b"};
const RESERVED_COLOR=["#ffffff","#f5c542","#4dd9ff","#0a0e15","#ff2b2b"];
let palSeq=null,palPos=0;const colorMap={};
function buildPalette(n){
 const cand=[];
 for(let h=0;h<360;h+=3)[[0.95,0.60],[1,0.50],[0.7,0.76],[1,0.68],[0.5,0.62],[1,0.44],[0.45,0.80],[0.85,0.55]].forEach(([s,l])=>{const hx=hsl2hex(h,s,l);cand.push({hx,lab:rgb2lab(hex2rgb(hx))});});
 const dist=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
 const md=cand.map(()=>1e9);
 const upd=lab=>cand.forEach((c,i)=>{const d=dist(c.lab,lab);if(d<md[i])md[i]=d;});
 RESERVED_COLOR.forEach(h=>upd(rgb2lab(hex2rgb(h))));
 const out=[];
 for(let k=0;k<n;k++){let bi=0;for(let i=1;i<cand.length;i++)if(md[i]>md[bi])bi=i;out.push(cand[bi].hx);upd(cand[bi].lab);md[bi]=-1;}
 return out;
}
function colorFor(t){
 if(PINNED_COLOR[t])return PINNED_COLOR[t];
 if(colorMap[t])return colorMap[t];
 if(!palSeq)palSeq=buildPalette(260);
 return (colorMap[t]=palSeq[palPos++%palSeq.length]);
}
const splitEmoji=t=>{const m=/^(\S+)\s+(.*)$/.exec(t);return m?{icon:m[1],name:m[2]}:{icon:"•",name:t};};
F.SHOT=/[?&]shot=1/.test(location.search);   /* 텔레그램 자동 촬영용 화면(서버의 헤드리스 크롬이 엶): 설정 저장·미리받기·부가 수집을 끄고 고정 모양으로 그림 */
F.TICKERS=[];F.SECTORS=[];F.SECTOR_OF={};
F.rebuildTickers=()=>{
 const secs=F.KEY_SETS.map(k=>({name:k.name+" 세트",icon:k.icon,items:k.items.slice(),watch:true,key:k.id}));   /* 핵심선 세트가 맨 위 — 아래 기본 그룹(지수·원자재)에서는 중복 제외됨 */
 WATCH.forEach(([n,items],i)=>{const e=splitEmoji(n);secs.push({name:e.name,icon:e.icon,items:items.split(","),pseudo:i===0,watch:true});});
 secs.push({name:"기존 알트코인",icon:"🌈",items:F.EXTRA_OLD.slice()});
 if(F.extra.length)secs.push({name:"내가 추가한 종목",icon:"➕",items:F.extra.slice(),custom:true});
 const seen=new Set();secs.forEach(sec=>{sec.items=sec.items.filter(t=>t&&!seen.has(t)&&(seen.add(t),true));});
 for(let i=secs.length-1;i>=0;i--)if(!secs[i].items.length&&!secs[i].pseudo)secs.splice(i,1);   /* 원자재 그룹처럼 세트로 옮겨져 빈 그룹은 제거 */
 F.SECTORS=secs;F.TICKERS=[];F.SECTOR_OF={};
 secs.forEach(sec=>sec.items.forEach(t=>{F.TICKERS.push(t);F.SECTOR_OF[t]=sec.name;}));
 F.TICKERS.forEach(t=>{F.COLORS[t]=colorFor(t);});
};
F.rebuildTickers();
F.setExtra=list=>{F.extra=Array.from(new Set(list||[]));F.rebuildTickers();};
/* 트레이딩뷰: 사용자의 관심종목이 쓰는 하이퍼리퀴드 심볼 형식(HIP3XYZ:XXXUSDC.P / HYPERLIQUID:XXXUSDC.P)으로 새 창에서 연다 */
F.TV={"10Y":"TVC:US10Y",SMSN:"KRX:005930",SKHYNIX:"KRX:000660",SKHY:"KRX:000660",KIOXIA:"TSE:285A",XYZ100:"NASDAQ:NDX",SP500:"SP:SPX",KR200:"KRX:KOSPI200",JP225:"TVC:NI225",CL:"NYMEX:CL1!",BRENTOIL:"ICEEUR:BRN1!",GOLD:"COMEX:GC1!",SILVER:"COMEX:SI1!",NATGAS:"NYMEX:NG1!",COPPER:"COMEX:HG1!",PLATINUM:"NYMEX:PL1!",PALLADIUM:"NYMEX:PA1!"};
F.tvSymbol=t=>{
 if(F.TVSYM[t])return F.TVSYM[t];
 const dx=F.dexOf?F.dexOf(t):null;
 if(dx==="xyz")return "HIP3XYZ:"+t+"USDC.P";
 if(dx==="")return "HYPERLIQUID:"+t+"USDC.P";
 return F.TV[t]||t;
};
F.tvUrl=t=>"https://www.tradingview.com/chart/?symbol="+encodeURIComponent(F.tvSymbol(t));
F.openTV=t=>window.open(F.tvUrl(t),"tv_"+t,"popup=yes,noopener,noreferrer,width=1500,height=920");

/* ── 타임프레임 (이름·묶음: DAY / HOUR / MIN) ──
   iv = 캔들 간격. tick=true 는 15M·3M 처럼 캔들만으로는 점이 너무 적은 프레임 — 실시간 틱(2초)을 이어붙여 그림 */
F.FRAME_GROUPS=[{g:"D",label:"DAY"},{g:"H",label:"HOUR"},{g:"M",label:"MIN"}];
F.FRAMES=[
 {k:"240D",g:"D",days:240,iv:"12h",min:720},{k:"120D",g:"D",days:120,iv:"8h",min:480},{k:"60D",g:"D",days:60,iv:"4h",min:240},
 {k:"20D",g:"D",days:20,iv:"1h",min:60},{k:"5D",g:"D",days:5,iv:"15m",min:15},{k:"3D",g:"D",days:3,iv:"5m",min:5},{k:"1D",g:"D",days:1,iv:"3m",min:3},
 {k:"12H",g:"H",days:.5,iv:"3m",min:3},{k:"8H",g:"H",days:1/3,iv:"1m",min:1},{k:"4H",g:"H",days:1/6,iv:"1m",min:1},{k:"2H",g:"H",days:1/12,iv:"1m",min:1},{k:"1H",g:"H",days:1/24,iv:"1m",min:1},
 {k:"30M",g:"M",days:1/48,iv:"1m",min:1},{k:"15M",g:"M",days:1/96,iv:"1m",min:1,tick:true},{k:"3M",g:"M",days:1/480,iv:"1m",min:1,tick:true}
];
/* 예전 이름 → 새 이름(저장된 설정·그린 도형 이전용) */
F.OLD_FRAME={"120일":"120D","60일":"60D","20일":"20D","5일":"5D","3일":"3D","1일":"1D","12시간":"12H","6시간":"8H","3시간":"4H","1시간":"1H","30분":"30M"};
const IVMIN={"1m":1,"3m":3,"5m":5,"15m":15,"30m":30,"1h":60,"2h":120,"4h":240,"8h":480,"12h":720,"1d":1440,"3d":4320,"1w":10080};
/* ── 봉 간격(아랫줄): 기간(위 줄)과 별개로 고름. 20D + 15m = 20일치를 15분봉으로 ── */
F.IVS=[{iv:"3m",label:"3m"},{iv:"5m",label:"5m"},{iv:"15m",label:"15m"},{iv:"30m",label:"30m"},{iv:"1h",label:"1h"},{iv:"2h",label:"2h"},{iv:"4h",label:"4h"},{iv:"8h",label:"8h"},{iv:"1d",label:"1D"},{iv:"3d",label:"3D"},{iv:"1w",label:"1W"}];
F.MAXBARS=2500;   /* 한 종목당 최대 봉 수(하이퍼리퀴드 1회 5000봉 제한 + 화면·전송 무게) */
/* 기간(range) + 봉 간격(sel; auto=기간 기본값) → 실제 프레임 정의. key 는 캐시·공유 저장 키(기간|봉) */
/* 표시 기준: kel(기본) = 각 종목의 '현재 일봉 켈상단'을 0으로 — 기간을 바꿔도 현재 위치가 같음 / start = 예전 방식(기간 시작가 대비) */
F.mode=()=>(F.ui&&F.ui.mode==="start")?"start":"kel";
F.frameOf=(range,sel)=>{
 const b=F.FRAMES.find(x=>x.k===range)||F.FRAMES.find(x=>x.k==="20D");
 const useSel=sel&&sel!=="auto"&&sel!==b.iv&&IVMIN[sel];
 const iv=useSel?sel:b.iv,min=IVMIN[iv];
 return Object.assign({},b,{iv,min,auto:!useSel,key:b.k+"|"+iv+(F.mode()==="kel"?"|k":"|s"),tick:!!b.tick&&iv===b.iv});   /* 모드별로 캐시 키 분리 */
};
/* 이 기간에서 이 봉이 쓸 만한가: 봉이 8개 미만이면 불가, 2500개 초과면 최근 구간만(잘림) */
F.ivStatus=(range,iv)=>{const b=F.FRAMES.find(x=>x.k===range);if(!b)return {ok:false,bars:0,clamped:false};const bars=b.days*1440/IVMIN[iv];return {ok:bars>=8,bars:Math.round(bars),clamped:bars>F.MAXBARS};};

/* ── HL 요청 스로틀 ──
   IP당 분당 가중치 1200(일반 20, allMids 2, candleSnapshot=20+캔들/60). 메인 그리드·다른 창과 한도를 같이 쓰므로 예산은 낮게.
   429가 오면 12초 쿨다운 후 재시도. (실측: 예산 900/600에서도 429 → 이 값 유지) */
let BUDGET=400,log=[],coolUntil=0;
F.setBudget=v=>{BUDGET=v;};
const weight=b=>{
 if(!b)return 20;if(b.type==="allMids")return 2;
 if(b.type==="candleSnapshot"&&b.req){const n=(b.req.endTime-b.req.startTime)/((IVMIN[b.req.interval]||1)*60000);return 20+Math.ceil(Math.max(n,0)/60);}
 return 20;
};
const turn=w=>new Promise(res=>{(function go(){
 const now=Date.now();log=log.filter(x=>now-x[0]<60000);
 const used=log.reduce((s,x)=>s+x[1],0);let wait=0;
 if(now<coolUntil)wait=coolUntil-now;else if(used+w>BUDGET&&log.length)wait=log[0][0]+60000-now+50;
 if(wait>0)setTimeout(go,Math.min(wait,1500));else{log.push([now,w]);res();}
})();});
F.budgetUsed=()=>{const now=Date.now();return log.filter(x=>now-x[0]<60000).reduce((s,x)=>s+x[1],0);};
function hl(body,retry){
 retry=retry||0;
 return turn(weight(body)).then(()=>fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).then(r=>{
  if(r.status===429){coolUntil=Date.now()+12000;console.warn("[흐름] HL 429 → 12초 쿨다운("+(retry+1)+"/3)");F.on429&&F.on429();if(retry<3)return hl(body,retry+1);}
  if(!r.ok)throw new Error("HL "+r.status);return r.json();
 });
}
F.hl=hl;
function pool(tasks,n){
 let i=0;const out=new Array(tasks.length);
 const one=()=>{if(i>=tasks.length)return Promise.resolve();const k=i++;return tasks[k]().then(v=>{out[k]=v;},()=>{out[k]=null;}).then(one);};
 return Promise.all(Array.from({length:n},one)).then(()=>out);
}
F.pool=pool;

/* ── 서버 프록시(/api/flow-fetch) — Vercel IP로 받아서 브라우저(집 IP) 한도를 안 씀 ── */
/* ── 호출 관문(동시 호출 수 자동 조절) ──
   서버 프록시(/api/flow-fetch) 호출을 한꺼번에 쏘면 하이퍼리퀴드 한도(429)에 걸려 서버가 재시도하느라 느려짐(실측: 호출 196회에 429 재시도 1,595회).
   → 동시 호출 수를 4개로 고정(자동 조절 코드는 gateFixed=0일 때만 동작). 핵심은 우선순위: 지금 보는 화면(fg)이 항상 먼저고, 미리받기·보완(bg)은 앞단계 대기가 없을 때만 한도의 절반까지.
   앞단계(fg: 지금 보는 화면)가 항상 먼저, 뒤 작업(bg: 미리받기·보완)은 앞단계 대기가 없을 때만 그리고 동시 호출 한도의 절반까지만 */
const GATE={limit:4,min:1,max:6,run:0,bgRun:0,qf:[],qb:[],streak:0,pause:0,tm:null};
F.gateFixed=4;   /* 동시 호출 4개 고정. 0으로 두면 자동 조절(429가 섞이면 줄고 깨끗하면 늘림)이 켜지지만, 번갈아 실측한 결과 총 시간은 더 빨라지지 않아 꺼 둠 */
function gatePump(){
 clearTimeout(GATE.tm);GATE.tm=null;
 const now=Date.now();
 if(now<GATE.pause){GATE.tm=setTimeout(gatePump,GATE.pause-now+10);return;}
 while(GATE.run<GATE.limit){
  let j=GATE.qf.shift();
  if(!j&&GATE.bgRun<Math.max(1,Math.floor(GATE.limit/2)))j=GATE.qb.shift();
  if(!j)break;
  GATE.run++;if(j.pri==="bg")GATE.bgRun++;
  j.res();
 }
}
function gateAcquire(pri){return new Promise(res=>{(pri==="bg"?GATE.qb:GATE.qf).push({res,pri});gatePump();});}
function gateRelease(pri,t,failed){
 GATE.run--;if(pri==="bg")GATE.bgRun--;
 const r=t?(t.r429||0):0;
 if(F.gateFixed>0){GATE.limit=F.gateFixed;gatePump();return;}
 if(failed||r>0){GATE.limit=Math.max(GATE.min,Math.floor(GATE.limit*0.7));GATE.streak=0;GATE.pause=Math.max(GATE.pause,Date.now()+Math.min(4000,400+r*120));}
 else{GATE.streak++;if(GATE.streak>=5&&GATE.limit<GATE.max){GATE.limit++;GATE.streak=0;}}
 gatePump();
}
F.gateInfo=()=>({limit:GATE.limit,run:GATE.run,waitF:GATE.qf.length,waitB:GATE.qb.length});
async function api(params,pri){
 const p=pri==="bg"?"bg":"fg",gated=!(params&&params.op);
 if(gated)await gateAcquire(p);
 const t0=performance.now();let t=null,failed=true;
 try{
  /* 캔들 요청의 시작·끝 시각을 20초 단위로 맞춰서 같은 순간의 요청이 같은 주소가 되게 함 → 서버 CDN 캐시(20초)가 여러 기기·탭·연속 새로고침을 한 번의 HL 호출로 묶어줌 */
  if(params&&params.coins){params=Object.assign({},params,{start:Math.floor(params.start/20000)*20000,end:Math.ceil(params.end/20000)*20000});}
  const r=await fetch("/api/flow-fetch?"+new URLSearchParams(params));
  if(!r.ok)throw new Error("API "+r.status);
  const j=await r.json();if(!j||!j.ok)throw new Error("API "+((j&&j.error)||"fail"));
  t=j.t;failed=false;return j;
 }finally{
  netRec(failed?null:t,performance.now()-t0,params,failed);
  if(gated)gateRelease(p,t,failed);
 }
}
/* ── 수집 속도 측정 ──
   호출마다 전체 응답 시간(브라우저 기준)·서버 처리 시간·하이퍼리퀴드 평균 응답·429 재시도·서버 지역을 모아서
   (1) 이번 접속 합계 (2) 지역별 누적(브라우저에 저장 — 서버 지역을 옮기기 전후 비교용)을 상태창 상세에 보여줌 */
const NETK="flow_netstat_v1";
let netCur={calls:0,fail:0,ms:0,srv:0,hl:0,hlN:0,r429:0,r5xx:0,slow:0,region:"",t0:Date.now()},netAll={},netSaveT=null;
try{netAll=JSON.parse(localStorage.getItem(NETK)||"{}")||{};}catch(e){netAll={};}
function netRec(t,ms,params,fail){
 if(params&&params.op)return;   /* 코인맵 호출은 제외(캔들 수집만 측정) */
 const reg=(t&&t.region)||netCur.region||"?";
 if(t&&t.region)netCur.region=t.region;
 const a=netAll[reg]||(netAll[reg]={calls:0,fail:0,ms:0,srv:0,hl:0,hlN:0,r429:0,r5xx:0,slow:0,since:Date.now()});
 [netCur,a].forEach(o=>{o.calls++;if(fail){o.fail++;return;}o.ms+=ms;if(t){o.srv+=t.ms||0;o.hl+=(t.hl||0);o.hlN++;o.r429+=t.r429||0;o.r5xx+=t.r5xx||0;}if(ms>5000)o.slow++;});
 clearTimeout(netSaveT);netSaveT=setTimeout(()=>{try{localStorage.setItem(NETK,JSON.stringify(netAll));}catch(e){}},1500);
 F.tk&&F.tk.on&&F.tk.on(null);
}
F.netView=()=>{
 const fmt=o=>{const ok=Math.max(1,o.calls-o.fail),h=Math.max(1,o.hlN);return {calls:o.calls,fail:o.fail,avg:o.ms/ok/1000,srv:o.srv/h/1000,hl:o.hl/h,net:Math.max(0,(o.ms/ok-o.srv/h))/1000,r429:o.r429,r5xx:o.r5xx,slow:o.slow};};
 return {cur:Object.assign(fmt(netCur),{region:netCur.region,sec:(Date.now()-netCur.t0)/1000}),byRegion:Object.keys(netAll).map(k=>Object.assign({region:k},fmt(netAll[k])))};
};
F.netReset=()=>{netAll={};try{localStorage.removeItem(NETK);}catch(e){}};
F.api=api;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
F.sleep=sleep;

/* ── 코인맵(+거래대금 가중치, +덱스 목록) — 로컬 저장본을 즉시(동기) 복원하고, 30분 넘었으면 뒤에서 갱신 ── */
F.coinMap=null;F.dexes=[""];F.ntl={};let mapT=0;
try{const c=JSON.parse(localStorage.getItem("flow_coinmap_v2")||"null");if(c&&c.map){F.coinMap=c.map;F.dexes=c.dexes;F.ntl=c.ntl;mapT=c.t||0;}}catch(e){}
async function buildCoinMap(){
 if(F.coinMap&&Date.now()-mapT<30*60000)return F.coinMap;
 let res=null;
 try{res=await api({op:"map"});}catch(e){console.warn("[흐름] 서버 코인맵 실패 → 직접 조회",e&&e.message||e);}
 if(res){F.coinMap=res.map;F.dexes=res.dexes;F.ntl=res.ntl;}
 else{
  if(F.coinMap)return F.coinMap;   /* 오래됐어도 저장본이 있으면 그걸로 진행 */
  const dexs=await hl({type:"perpDexs"});
  const names=[""];(dexs||[]).forEach(d=>{if(d&&d.name)names.push(d.name);});
  const rs=await pool(names.map(dx=>()=>hl(dx?{type:"metaAndAssetCtxs",dex:dx}:{type:"metaAndAssetCtxs"}).then(r=>({dx,u:(r&&r[0]&&r[0].universe)||[],c:(r&&r[1])||[]}))),3);
  const map={},ntl={};
  rs.forEach(r=>{if(!r)return;r.u.forEach((a,i)=>{const n=a.name;if(!n)return;const short=n.indexOf(":")>=0?n.split(":")[1]:n;
   if(!(short in map)){map[short]={full:n,dex:r.dx};ntl[short]=+((r.c[i]||{}).dayNtlVlm)||0;}});});
  F.coinMap=map;F.dexes=names;F.ntl=ntl;
 }
 mapT=Date.now();
 try{localStorage.setItem("flow_coinmap_v2",JSON.stringify({t:mapT,map:F.coinMap,dexes:F.dexes,ntl:F.ntl}));}catch(e){}
 return F.coinMap;
}
F.ready=buildCoinMap;
F.coinOf=t=>{const m=F.coinMap&&F.coinMap[F.ALIAS[t]||t];return m?m.full:null;};
F.dexOf=t=>{const m=F.coinMap&&F.coinMap[F.ALIAS[t]||t];return m?m.dex:null;};
F.weightOf=t=>Math.max(F.ntl[F.ALIAS[t]||t]||0,1);
/* 원화 환산(억) — frankfurter, 실패하면 1400 */
F.krw=1400;
F.loadKrw=()=>fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW").then(r=>r.json()).then(j=>{if(j&&j.rates&&j.rates.KRW)F.krw=j.rates.KRW;}).catch(()=>{});
F.fmtEok=usd=>{const e=usd*F.krw/1e8;if(!isFinite(e)||e<=0)return"—";if(e>=10000)return(e/10000).toFixed(1)+"조";if(e>=100)return Math.round(e)+"억";return e.toFixed(1)+"억";};

/* ── 캔들 → 종목 시리즈(등락률 %p, 켈트너 상단 %p) ──
   등락률 = 종가/기준가−1 (기준가 = 창 시작이 속한 날의 09:00 KST 직전 종가)
   켈트너 = EMA20 ± Wilder ATR10 × 1.5 (사용자 지표값 20/10/1.5), 창 앞 45봉을 워밍업으로 받음 */
const KL=20,KA=10,KM=1.5,WARM=45;
/* 1일 이상 프레임: 기준 = 창 시작이 속한 날 09:00 KST 직전 종가. 하루 미만(12시간~30분) 프레임은 기준 = 창 시작 직전 종가
   (전일 09:00까지 1분봉을 최대 24시간치 받으면 종목당 가중치가 2배라서 — 선들이 왼쪽 끝에서 0%로 출발하는 비교 차트) */
F.baseLabel=f=>F.mode()==="kel"?"각 종목 현재 일봉 켈상단(0%p=상단선)":(f.days<1?"창 시작":"전일 09:00 종가");
F.windowOf=f=>{
 const end=Date.now(),ivMs=f.min*60000;
 let start=end-f.days*86400000,clamped=false;
 const bars=(end-start)/ivMs;
 if(bars>F.MAXBARS){start=end-F.MAXBARS*ivMs;clamped=true;}   /* 봉이 너무 많으면 최근 구간만 */
 const boundary=f.days<1?start:Math.floor(start/86400000)*86400000;
 return {end,start,boundary,from:Math.min(start,boundary)-WARM*ivMs,clamped,shownDays:(end-start)/86400000};
};
/* ── 일봉 켈트너 밴드 시계열(kel 모드의 기준) ──
   완결된 일봉만으로 EMA20 / Wilder ATR10 → 날짜별 중심선·상단(×1.5). 차트의 각 봉은 '그 봉이 열리기 전에 마감된 마지막 일봉'의 밴드를 씀.
   기준 R = 가장 최근 완결 일봉의 상단 = 메인 팝업(상대강도)의 켈 상단과 같은 값 */
F.dayC={};
function dayBands(t){
 const rec=F.dayC[t];if(!rec||!rec.candles)return null;
 if(rec.bands&&rec.bands.ver===2&&rec.bands.src===rec.candles)return rec.bands.v;
 const cs=rec.candles.map(c=>({t:+c.t,h:+c.h,l:+c.l,c:+c.c})).filter(x=>isFinite(x.t)&&x.c>0).sort((x,y)=>x.t-y.t);
 const now=Date.now(),comp=cs.filter(x=>x.t+86400000<=now);
 let v=null;
 if(comp.length>=Math.max(DK_LEN,DK_ATR)+2){
  const k=2/(DK_LEN+1),B=new Array(comp.length),A=new Array(comp.length).fill(NaN);
  let e=comp[0].c;B[0]=e;for(let i=1;i<comp.length;i++){e=comp[i].c*k+e*(1-k);B[i]=e;}
  let atr=null;const trs=[];
  for(let i=1;i<comp.length;i++){
   trs.push(Math.max(comp[i].h-comp[i].l,Math.abs(comp[i].h-comp[i-1].c),Math.abs(comp[i].l-comp[i-1].c)));
   if(trs.length===DK_ATR)atr=trs.reduce((s,x)=>s+x,0)/DK_ATR;else if(trs.length>DK_ATR)atr=(atr*(DK_ATR-1)+trs[trs.length-1])/DK_ATR;
   if(atr!==null)A[i]=atr;}
  const days=[];for(let i=0;i<comp.length;i++)if(A[i]===A[i])days.push({te:comp[i].t+86400000,u:B[i]+DK_MULT*A[i],m:B[i],d:B[i]-DK_MULT*A[i]});
  if(days.length)v={days,R:days[days.length-1].u};
 }
 rec.bands={ver:2,src:rec.candles,v};return v;
}
function build(candles,w,f,tk){
 if(!candles||candles.length<KA+2)return null;
 const a=candles.map(c=>({t:+c.t,o:+c.o,h:+c.h,l:+c.l,c:+c.c})).filter(x=>isFinite(x.t)&&x.c>0).sort((x,y)=>x.t-y.t);
 if(a.length<KA+2)return null;
 const kel=F.mode()==="kel",bd=kel?dayBands(tk):null;
 if(kel&&!bd)return null;   /* 일봉 켈트너를 못 만드는 종목(상장 30일 미만 등)은 이 모드에선 제외 */
 /* 기준가 = 기준 시각(boundary)까지 완전히 마감된 마지막 봉의 종가. 주봉·3일봉처럼 큰 봉은 기준 시각을 가로지르는 봉의 종가를 쓰면 틀리므로 마감 시각으로 판정 */
 const ivMs=f.min*60000;let base=null;
 for(let i=a.length-1;i>=0;i--){if(a[i].t+ivMs<=w.boundary+1){base=a[i].c;break;}}
 if(base===null)base=(a[0].o>0?a[0].o:a[0].c);
 const k=2/(KL+1);let ema=a[0].c,atr=null;const trs=[];
 /* 기준(bs): kel = 현재 일봉 켈상단 R / start = 기간 시작가. 가격·상단·중심선 모두 같은 기준으로 %p 변환 */
 const bs=bd?bd.R:base;let bj=-1;
 /* o/h/l 도 종가와 같은 기준(bs)으로 %p 변환해 둠 — 캔들·하이킨아시 표시용(추가 요청 없이 바로 그림) */
 const out={t:[],p:[],u:[],m:[],dn:[],o:[],h:[],l:[],base:bs,lb:0};
 for(let i=0;i<a.length;i++){
  if(i>0){ema=a[i].c*k+ema*(1-k);
   const tr=Math.max(a[i].h-a[i].l,Math.abs(a[i].h-a[i-1].c),Math.abs(a[i].l-a[i-1].c));trs.push(tr);
   if(trs.length===KA)atr=trs.reduce((s,v)=>s+v,0)/KA;else if(trs.length>KA)atr=(atr*(KA-1)+tr)/KA;}
  let uV=null,mV=null,dV=null;
  if(bd){while(bj+1<bd.days.length&&bd.days[bj+1].te<=a[i].t)bj++;if(bj>=0){uV=bd.days[bj].u;mV=bd.days[bj].m;dV=bd.days[bj].d;}}
  else if(atr!==null){uV=ema+KM*atr;mV=ema;dV=ema-KM*atr;}
  if(a[i].t>=w.start-f.min*60000&&uV!==null){
   out.t.push(Math.round(a[i].t/1000)+KST);
   out.p.push(+((a[i].c/bs-1)*100).toFixed(3));
   out.o.push(+((a[i].o/bs-1)*100).toFixed(3));
   out.h.push(+((a[i].h/bs-1)*100).toFixed(3));
   out.l.push(+((a[i].l/bs-1)*100).toFixed(3));
   out.u.push(+((uV/bs-1)*100).toFixed(3));
   out.m.push(+((mV/bs-1)*100).toFixed(3));
   out.dn.push(+((dV/bs-1)*100).toFixed(3));
   out.lb=+((mV/bs-1)*100).toFixed(3);
  }
 }
 return out.t.length>2?out:null;
}
F.build=build;
F.fetchTicker=async(t,f,w)=>{
 const coin=F.coinOf(t);if(!coin)return null;
 await F.ensureDay([t]);
 const k=await hl({type:"candleSnapshot",req:{coin,interval:f.iv,startTime:w.from,endTime:w.end}});
 return build(k,w,f,t);
};

/* ── Supabase 공유 스냅샷(hlgrid_settings) — gzip+base64 ── */
const sbOK=()=>typeof SUPABASE_URL==="string";
const SBU="https://atauxczcjtvcrjjlnapm.supabase.co";
/* index.html이 아닌 독립 페이지라 URL/anon키를 직접 가진다(anon 키는 공개용, 보안은 RLS. 기존 앱과 동일 프로젝트) */
const SBK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0YXV4Y3pjanR2Y3JqamxuYXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTMxMzgsImV4cCI6MjA5MjA2OTEzOH0.jyB9SGyjdaHYRw8MpktX8dHtKOgA6rbGTJbdrycnXgA";
const sbH=()=>({apikey:SBK,Authorization:"Bearer "+SBK});
async function gz(str){
 if(typeof CompressionStream==="undefined")return null;
 const buf=await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
 let s="";const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));
 return btoa(s);
}
async function ungz(b64){
 const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
 return await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
F.sbGet=async(key,maxAgeMs)=>{
 try{
  const since=new Date(Date.now()-maxAgeMs).toISOString();
  const r=await fetch(SBU+"/rest/v1/hlgrid_settings?select=value,updated_at&key=eq."+encodeURIComponent(key)+"&updated_at=gte."+encodeURIComponent(since),{headers:sbH()});
  if(!r.ok)throw new Error("SB "+r.status);
  const rows=await r.json();if(!rows.length)return null;
  let v=rows[0].value;if(v&&v.z&&v.d)v=JSON.parse(await ungz(v.d));
  return {v,t:Date.parse(rows[0].updated_at)||Date.now()};
 }catch(e){console.warn("[흐름] 서버 읽기 실패",key,e&&e.message||e);return null;}
};
F.sbSet=async(key,obj)=>{
 try{
  const js=JSON.stringify(obj);const z=await gz(js);
  const value=z?{z:1,d:z}:obj;
  const r=await fetch(SBU+"/rest/v1/hlgrid_settings?on_conflict=key",{method:"POST",headers:Object.assign({"Content-Type":"application/json",Prefer:"resolution=merge-duplicates"},sbH()),body:JSON.stringify({key,value,updated_at:new Date().toISOString()})});
  console.log("[흐름] 서버 저장 "+key+" "+(r.ok?"OK":"실패 "+r.status)+" ("+Math.round(js.length/1024)+"KB→"+Math.round((z?z.length:js.length)/1024)+"KB)");
  return r.ok;
 }catch(e){console.warn("[흐름] 서버 저장 실패",e&&e.message||e);return false;}
};
/* 서버 스냅샷 유효시간: 봉 간격의 1.5배(최소 2분, 최대 90분) */
/* 캐시/스냅샷 신선도: 새 봉은 실시간(allMids)이 이어붙이므로 길게 잡고, 넘으면 뒤에서 조용히 갱신 */
F.staleMs=f=>f.min<=1?10*60000:(f.min<=5?15*60000:(f.min<=15?30*60000:60*60000));
/* 지금 보는 프레임의 갱신 기준: 봉 2개 길이(최소 2분)를 넘으면 새로 받음(저장본 위로 빠진 봉이 생기지 않게). 보고 있지 않은 프레임(미리받기)은 위 staleMs 그대로 */
F.viewStaleMs=f=>Math.min(F.staleMs(f),Math.max(120000,f.min*60000*2));
/* 일봉 데이터 신선도: 마지막 일봉 마감(UTC 00:00 = 한국 09:00) 2분 뒤 이후에 받은 것이면 그날은 그대로 사용 */
F.dayFresh=ts=>{const ds=Math.floor((Date.now()-120000)/864e5)*864e5+120000;return ts>=ds;};
F.dayFreshMs=()=>{const now=Date.now(),ds=Math.floor((now-120000)/864e5)*864e5+120000;return Math.max(60000,now-ds);};
F.ttl=f=>F.staleMs(f);
const packFrame=data=>{const p={},base={},lb={};
 Object.keys(data).forEach(t=>{const d=data[t];base[t]=d.base;lb[t]=d.lb;p[t]=d.t.map((s,i)=>[Math.round((s-KST)/60),d.p[i],d.u[i],d.o[i],d.h[i],d.l[i],d.m?d.m[i]:d.u[i],d.dn?d.dn[i]:(d.m?d.m[i]:d.u[i])]);});
 return {v:6,base,lb,p};};
/* v2(예전 캐시, o/h/l 없음)도 그대로 읽되 캔들 모드에서는 종가로만 채워 평선(도지)으로 표시됨 */
const unpackFrame=v=>{const data={};
 Object.keys(v.p).forEach(t=>{const r=v.p[t];const p=r.map(x=>x[1]);
  data[t]={t:r.map(x=>x[0]*60+KST),p,u:r.map(x=>x[2]),m:r.map(x=>x.length>6?x[6]:x[2]),dn:r.map(x=>x.length>7?x[7]:(x.length>6?x[6]:x[2])),o:r.map((x,i)=>x.length>3?x[3]:p[i]),h:r.map((x,i)=>x.length>3?x[4]:p[i]),l:r.map((x,i)=>x.length>3?x[5]:p[i]),base:v.base[t],lb:v.lb[t]};});return data;};
F.frameKey=f=>"flow_v6_"+f.key;   /* v4: 켈 배수 1.5 + 중심선(m) + 기준 모드(키 끝 |k / |s) — 옛 스냅샷과 섞이지 않게 키 변경 */
F.saveFrame=(f,data)=>F.sbSet(F.frameKey(f),packFrame(data));
F.loadFrameShared=async(f,tickers)=>{
 const s=await F.sbGet(F.frameKey(f),F.ttl(f));if(!s||!s.v||s.v.v!==6)return null;
 const data=unpackFrame(s.v);
 const have=tickers.filter(t=>data[t]).length;
 return have>=Math.max(1,Math.ceil(tickers.length*0.9)-1)?{data,t:s.t}:null;
};

/* ── 일봉 켈트너/켈유/윌리엄스: 메인 그리드가 이미 올려둔 hlgrid_indicators 를 한 번에 읽음(HL 요청 0) ── */
F.daily={};
F.loadDaily=async()=>{
 try{
  const since=new Date(Math.max(Date.now()-26*3600*1000,Date.parse("2026-10-03T01:27:21Z"))).toISOString();   /* 켈 배수 1.5 적용 시각 이전(×1) 행은 무시 */
  const r=await fetch(SBU+"/rest/v1/hlgrid_indicators?select=id,w12,kel_basis,kel_upper,kel_lower,kel_streak_days,updated_at&updated_at=gte."+encodeURIComponent(since)+"&limit=2000",{headers:sbH()});
  if(!r.ok)throw new Error("SB "+r.status);
  const rows=await r.json();const m={};
  rows.forEach(x=>{const id=x.id;const short=id.indexOf(":")>=0?id.split(":")[1]:id;m[id]=x;if(!(short in m))m[short]=x;});
  F.daily=m;console.log("[흐름] 일봉 켈트너 공유캐시 "+rows.length+"건");
 }catch(e){console.warn("[흐름] 일봉 공유캐시 실패",e&&e.message||e);}
};
F.dailyOf=t=>{const c=F.coinOf(t);return F.daily[c]||F.daily[F.ALIAS[t]||t]||null;};

/* ── "정보 없음" 자동 보완 ──
   일봉 켈트너/켈유/W%R(12)는 원래 메인 그리드(index.html)가 화면에 띄운 종목만 계산해서
   Supabase(hlgrid_indicators)에 올려두는 캐시라, 메인 그리드가 안 켜져 있거나 그 종목을 아직
   안 훑었으면 흐름차트엔 "정보 없음"으로 뜸. 흐름차트가 직접 55일 일봉을 받아
   (메인 그리드 computeKeltner·wr(12)와 동일 파라미터: EMA20 ± Wilder ATR10×1.5, 12일 W%R) 계산해서
   채우고, 공유 캐시에도 같이 올려서 다음 로드·다른 기기에서도 바로 쓰게 함.
   ind_v은 일부러 안 찍음 — 메인 그리드가 이걸 "ind_v=2(윌 14/48일 포함)"로 착각해 자기 계산을
   건너뛰지 않게 하기 위함(그 필드는 여기서 안 채움) */
const DK_LEN=20,DK_ATR=10,DK_MULT=1.5;
function computeDailyKel(complete){
 if(complete.length<Math.max(DK_LEN,DK_ATR)+1)return null;
 const k=2/(DK_LEN+1);const basisArr=new Array(complete.length);
 let basis=complete[0][3];basisArr[0]=basis;
 for(let i=1;i<complete.length;i++){basis=complete[i][3]*k+basis*(1-k);basisArr[i]=basis;}
 const trs=[];
 for(let i=1;i<complete.length;i++){const h=complete[i][1],l=complete[i][2],pc=complete[i-1][3];trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}
 if(trs.length<DK_ATR)return null;
 const atrArr=new Array(trs.length);
 let atr=trs.slice(0,DK_ATR).reduce((s,v)=>s+v,0)/DK_ATR;atrArr[DK_ATR-1]=atr;
 for(let i=DK_ATR;i<trs.length;i++){atr=(atr*(DK_ATR-1)+trs[i])/DK_ATR;atrArr[i]=atr;}
 let streak=0;
 for(let i=complete.length-1;i>=1;i--){const a=atrArr[i-1];if(a==null)break;const upperAtI=basisArr[i]+DK_MULT*a;if(complete[i][3]>upperAtI)streak++;else break;}
 const lastAtr=atrArr[atrArr.length-1];
 return {basis,upper:basis+DK_MULT*lastAtr,lower:basis-DK_MULT*lastAtr,streak};
}
function computeW12(complete){
 const seg=complete.slice(-12);
 if(seg.length<10)return null;
 const hh=Math.max(...seg.map(c=>c[1])),ll=Math.min(...seg.map(c=>c[2])),close=seg[seg.length-1][3];
 if(hh===ll)return -50;
 return (hh-close)/(hh-ll)*-100;
}
/* 촬영용: 저장된 일봉(F.dayC)에서 일봉 켈트너·켈유·W%R(12)·3일평균 거래대금을 직접 계산 — 공유캐시/추가 수집 없이 조건검색에 필요한 값을 채움 */
F.shotComputeDaily=()=>{
 Object.keys(F.dayC||{}).forEach(t=>{
  const e=F.dayC[t],coin=F.coinOf(t);if(!e||!e.candles||!coin||e.candles.length<DK_LEN+3)return;
  const done=e.candles.slice(0,-1),complete=done.map(c=>[c.t,c.h,c.l,c.c]);   /* 마지막(오늘, 미완성) 제외 */
  const kel=computeDailyKel(complete),last3=done.slice(-3);
  if(last3.length===3&&last3.every(c=>c.v!=null))F.vol3d[coin]=last3.reduce((s,c)=>s+Math.abs(c.v)*c.c,0)/3;
  if(kel){const rec={w12:computeW12(complete),kel_basis:kel.basis,kel_upper:kel.upper,kel_lower:kel.lower,kel_streak_days:kel.streak},short=coin.indexOf(":")>=0?coin.split(":")[1]:coin;F.daily[coin]=rec;F.daily[short]=rec;}
 });
};
F.rawUnionBoost=(iv,days)=>{RAW_UNION_DAYS[iv]=Math.max(RAW_UNION_DAYS[iv]||0,days);};   /* 촬영: 20D+15m 처럼 기본 구성에 없는 조합도 원본 캔들 캐시·증분 갱신을 쓰게 */
F.fillMissingDaily=async(tickers,isBusy)=>{
 const seen=new Set(),need=[];
 tickers.forEach(t=>{const coin=F.coinOf(t);if(!coin||seen.has(coin))return;const d=F.dailyOf(t);if(!d||d.kel_upper==null){seen.add(coin);need.push({t,coin});}});
 if(!need.length)return;
 const end=Date.now(),start=end-55*86400000,chunks=[];
 for(let i=0;i<need.length;i+=10)chunks.push(need.slice(i,i+10));
 await pool(chunks.map(ch=>async()=>{
  for(;;){const st=isBusy&&isBusy();if(st==="abort")return;if(!st)break;await sleep(1200);}
  try{
   const coins=ch.map(x=>x.coin);
   const j=await F.api({coins:coins.join(","),iv:"1d",start,end},"bg");
   const upserts=[];
   coins.forEach(coin=>{
    const arr=j.d&&j.d[coin];if(!arr||arr.length<2)return;
    const complete=arr.slice(0,-1);   /* 마지막(오늘) 캔들은 미완성이라 제외 */
    const kel=computeDailyKel(complete);if(!kel)return;
    const w12=computeW12(complete);
    const rec={w12,kel_basis:kel.basis,kel_upper:kel.upper,kel_lower:kel.lower,kel_streak_days:kel.streak};
    const short=coin.indexOf(":")>=0?coin.split(":")[1]:coin;
    F.daily[coin]=rec;F.daily[short]=rec;
    upserts.push(Object.assign({id:coin,updated_at:new Date().toISOString()},rec));
   });
   if(upserts.length)fetch(SBU+"/rest/v1/hlgrid_indicators?on_conflict=id",{method:"POST",headers:Object.assign({"Content-Type":"application/json",Prefer:"resolution=merge-duplicates"},sbH()),body:JSON.stringify(upserts)}).catch(()=>{});
  }catch(e){console.warn("[흐름] 일봉 직접계산 실패",e&&e.message||e);}
  F.onDaily&&F.onDaily();
 }),2);
 console.log("[흐름] 일봉 켈트너 직접계산으로 "+need.length+"건 보완");
};

/* ── 3일평균 거래대금(조건검색 "거래대금" 필터용) ──
   24h 거래대금(F.ntl)은 장 초반엔 그날 누적이 적어 낮게 잡히는 문제가 있어, 완결된 최근 3일
   (일봉 거래량×종가)의 평균으로 봄. hlgrid_settings(flow_v2_vol3d)에 공유 저장(TTL 90분),
   없는 종목만 1d 캔들 받아 계산(일봉 켈트너 보완과 같은 요청을 묶지 않는 이유: 켈은 이미 캐시가
   있어도 거래대금은 없을 수 있어서 조건이 다름) */
F.vol3d={};
F.loadVol3d=async(tickers,isBusy)=>{
 const sh=await F.sbGet("flow_v2_vol3d",F.dayFreshMs());
 if(sh&&sh.v&&sh.v.e)Object.assign(F.vol3d,sh.v.e);
 F.onVol3d&&F.onVol3d();
 const seen=new Set(),need=[];
 tickers.forEach(t=>{const coin=F.coinOf(t);if(!coin||seen.has(coin)||F.vol3d[coin]!=null)return;seen.add(coin);need.push(coin);});
 if(!need.length)return;
 const end=Date.now(),start=end-6*86400000,chunks=[];
 for(let i=0;i<need.length;i+=10)chunks.push(need.slice(i,i+10));
 let got=false;
 await pool(chunks.map(coins=>async()=>{
  for(;;){const st=isBusy&&isBusy();if(st==="abort")return;if(!st)break;await sleep(1200);}
  try{
   const j=await F.api({coins:coins.join(","),iv:"1d",start,end},"bg");
   coins.forEach(coin=>{
    const arr=j.d&&j.d[coin];if(!arr||arr.length<2)return;
    const complete=arr.slice(0,-1),last3=complete.slice(-3);   /* 오늘(미완성) 제외, 최근 완결 3일 */
    if(!last3.length)return;
    const avg=last3.reduce((s,c)=>s+Math.abs(c[5]||0)*c[3],0)/last3.length;
    F.vol3d[coin]=avg;got=true;
   });
  }catch(e){}
  F.onVol3d&&F.onVol3d();
 }),2);
 if(got)F.sbSet("flow_v2_vol3d",{v:2,e:F.vol3d});
};
F.vol3dOf=t=>{const c=F.coinOf(t);return c&&F.vol3d[c]!=null?F.vol3d[c]:null;};

/* ── 4시간봉 켈 중심선(EMA20): 종목당 캔들 1회(가중치≈21), 1시간 공유 ── */
F.k4={};
F.loadK4=async(tickers,isBusy)=>{
 const sh=await F.sbGet("flow_v2_k4h",60*60000);
 if(sh&&sh.v&&sh.v.e){Object.assign(F.k4,sh.v.e);F.onK4&&F.onK4();}
 const need=tickers.filter(t=>F.k4[t]==null&&F.coinOf(t)).sort((a,b)=>F.weightOf(b)-F.weightOf(a));
 if(!need.length)return;
 const end=Date.now(),start=end-70*4*3600000,chunks=[];
 for(let i=0;i<need.length;i+=6)chunks.push(need.slice(i,i+6));
 let done=0;
 await pool(chunks.map(ch=>async()=>{
  for(;;){const st=isBusy&&isBusy();if(st==="abort")return;if(!st)break;await sleep(1200);}
  try{
   const coins=ch.map(F.coinOf),j=await api({coins:coins.join(","),iv:"4h",start,end},"bg");
   ch.forEach((t,i)=>{const arr=j.d&&j.d[coins[i]];
    if(arr&&arr.length>21){let e=arr[0][3];const kk=2/21;for(let x=1;x<arr.length;x++)e=arr[x][3]*kk+e*(1-kk);F.k4[t]=+e.toFixed(6);done++;}});
   F.onK4&&F.onK4();
  }catch(e){}
 }),2);
 if(done)F.sbSet("flow_v2_k4h",{v:2,e:F.k4});
};

/* ── 실시간: 덱스별 allMids(가중치 2)로 현재가만 받음 ── */
F.mids=async(tickers)=>{
 const need=new Set();tickers.forEach(t=>{const d=F.dexOf(t);if(d!==null)need.add(d);});
 const mids={};
 await Promise.all([...need].map(dx=>hl(dx?{type:"allMids",dex:dx}:{type:"allMids"}).then(m=>Object.assign(mids,m)).catch(()=>{})));
 return mids;
};

/* ── 빠른 수집: 서버 프록시를 6종목씩 병렬 호출(진행형), 못 받은 것만 1회 재시도 ──
   (봉 간격을 직접 고른 프레임 전용 — 정확히 그 창만 요청. 기본 봉 간격은 아래 fetchFastRaw로 감) */
F.fetchFastExact=async(f,tickers,onData,par,pri)=>{
 const w=F.windowOf(f),data={};
 const list=tickers.filter(t=>F.coinOf(t)).sort((a,b)=>F.weightOf(b)-F.weightOf(a));
 const chunkify=arr=>{const c=[];for(let i=0;i<arr.length;i+=6)c.push(arr.slice(i,i+6));return c;};
 const one=async chunk=>{
  const coins=chunk.map(F.coinOf);
  const j=await api({coins:coins.join(","),iv:f.iv,start:Math.floor(w.from),end:Math.floor(w.end)},pri);
  const bad=[];
  chunk.forEach((t,i)=>{const arr=j.d&&j.d[coins[i]];let r=null;
   if(arr&&arr.length>KA+1)r=build(arr.map(x=>({t:x[0],h:x[1],l:x[2],c:x[3],o:x[4]})),w,f,t);
   if(r)data[t]=r;else bad.push(t);});
  onData&&onData(data);
  return bad;
 };
 let miss=[];
 for(let pass=0;pass<4;pass++){
  const runs=pass===0?chunkify(list):chunkify(miss);miss=[];
  if(!runs.length)break;
  const rs=await pool(runs.map(ch=>()=>one(ch).catch(()=>ch)),par||5);
  rs.forEach(b=>{if(b&&b.length)miss.push(...b);});
  if(!miss.length)break;
  if(pass<3){const ms=[1500,3500,6000][pass];F.tk.w("frame","한도 대기 · 누락 "+miss.length+"개 재시도 "+(pass+1)+"/3",ms);await sleep(ms);}   /* 못 받은 종목만 두 번 더(한도 회복 시간을 두고) */
 }
 return {data,miss,total:list.length};
};

/* ── 봉 간격(iv) 단위 원본 캔들 공유 캐시 ──
   8H·4H·2H·1H·30M·15M·3M은 봉 간격을 기본값 그대로 두면 전부 1분봉이라, 프레임(기간)을 바꿀
   때마다 사실상 같은 1분봉을 매번 새로 받고 있었음(요청 반영: "시간프레임 바꿀 때마다 다시
   받아서 느림"). 이 간격을 쓰는 프레임 중 가장 넓은 기간(예: 1분봉은 8H)만큼 원본 캔들을 한 번
   받아 F.raw[iv]에 두고, 다른 프레임은 그 배열에서 build()만 다시 돌려서(네트워크 요청 없이)
   그림. build()는 원래도 "창보다 앞의 캔들은 워밍업으로 쓰고 창 안쪽만 출력"하는 구조라 그대로
   재사용 가능. 기준가(base)도 프레임별 w(window)를 그대로 넘기므로 프레임마다 정확히 계산됨.
   봉 간격을 사용자가 직접 고르면(auto 아님) 캐시 조합이 늘어나 이득이 적어 기존 방식(fetchFastExact) 유지.
   IndexedDB(raw|<iv>)에도 저장해서 새로고침해도 남아있음(디바운스로 몰아서 씀) */
const RAW_UNION_DAYS={};
F.FRAMES.forEach(b=>{RAW_UNION_DAYS[b.iv]=Math.max(RAW_UNION_DAYS[b.iv]||0,b.days);});
const rawWindowOf=iv=>F.windowOf({days:RAW_UNION_DAYS[iv]||1,min:IVMIN[iv]||1});
F.raw={};   /* iv → { ticker: {t, candles:[{t,h,l,c,o},…]} } */
const rawIdbLoaded={},rawSaveT={};
/* 불러오기를 약속(Promise)으로 공유 — 동시에 두 번 불려도 둘 다 저장본을 다 읽은 뒤에 진행(예전엔 둘째가 '이미 불러왔다'고 보고 빈 상태로 전체를 다시 받음) */
function rawEnsureLoaded(iv){
 return rawIdbLoaded[iv]||(rawIdbLoaded[iv]=(async()=>{
  try{const v=await F.idbGet("raw|"+iv);if(v&&v.data)F.raw[iv]=Object.assign({},v.data,F.raw[iv]);}catch(e){}
 })());
}
function rawSaveDebounced(iv){
 clearTimeout(rawSaveT[iv]);
 rawSaveT[iv]=setTimeout(()=>F.idbSet("raw|"+iv,{data:F.raw[iv]}),1500);
}
/* ── 증분 갱신: 저장된 캔들이 창을 덮고 있으면 마지막 봉 2개 전부터만 받아서 이어붙임 ──
   (전체 구간을 통째로 다시 받던 것 → 새로 생긴 봉만. HL 가중치·응답 크기·대기시간이 봉 수에 비례해 줄어듦)
   겹치는 구간(마지막 2봉)은 새 값으로 덮어씀 — 진행 중이던 봉이 마감값으로 바뀌는 것 반영 */
F.mergeCandles=(old,inc,fromMs)=>{
 const m=new Map();
 (old||[]).forEach(c=>m.set(c.t,c));(inc||[]).forEach(c=>m.set(c.t,c));
 return [...m.values()].filter(c=>c.t>=fromMs).sort((a,b)=>a.t-b.t);
};
/* 이 캔들 묶음이 [from, 지금]을 이어받을 수 있는 상태인가: 시작이 창 시작 근처까지 덮고 마지막 봉이 창 안에 있어야 함 */
F.canIncr=(candles,from,barMs,minBars)=>{
 if(!candles||candles.length<=minBars)return false;
 return candles[0].t<=from+barMs*3&&candles[candles.length-1].t>=from;
};
/* 증분 수집 계획: 증분 가능한 종목은 마지막 봉 시각이 비슷한 것끼리 묶고(시작점 공유), 나머지는 전체 구간 */
F.planChunks=(list,getCandles,from,barMs,minBars)=>{
 const inc=[],full=[];
 list.forEach(t=>{const c=getCandles(t);(F.canIncr(c,from,barMs,minBars)?inc:full).push(t);});
 const last=t=>{const c=getCandles(t);return c[c.length-1].t;};
 inc.sort((a,b)=>last(a)-last(b));
 const out=[];
 for(let i=0;i<inc.length;i+=6){const ch=inc.slice(i,i+6);out.push({tickers:ch,inc:true,start:Math.max(from,last(ch[0])-barMs*2)});}
 for(let i=0;i<full.length;i+=6)out.push({tickers:full.slice(i,i+6),inc:false,start:from});
 return out;
};
F.fetchStat={inc:0,full:0,bars:0};   /* 이번 접속에서 증분/전체 호출 수와 받은 봉 수(진단용) */
F.fetchFastRaw=async(f,tickers,onData,par,pri)=>{
 const iv=f.iv;await rawEnsureLoaded(iv);
 const uw=rawWindowOf(iv),w=F.windowOf(f),ttl=F.forceFresh?0:F.staleMs({min:f.min}),barMs=(IVMIN[iv]||1)*60000;
 const bucket=F.raw[iv]||(F.raw[iv]={});
 const list=tickers.filter(t=>F.coinOf(t)).sort((a,b)=>F.weightOf(b)-F.weightOf(a));
 const data={};
 const fresh=list.filter(t=>bucket[t]&&Date.now()-bucket[t].t<ttl);
 fresh.forEach(t=>{const r=build(bucket[t].candles,w,f,t);if(r)data[t]=r;});
 if(fresh.length)onData&&onData(data);
 const need=list.filter(t=>!(bucket[t]&&Date.now()-bucket[t].t<ttl));
 if(!need.length)return {data,miss:list.filter(t=>!data[t]),total:list.length};
 const getC=t=>bucket[t]&&bucket[t].candles;
 const one=async ch=>{
  const coins=ch.tickers.map(F.coinOf);
  const j=await api({coins:coins.join(","),iv,start:Math.floor(ch.start),end:Math.floor(uw.end)},pri);
  const bad=[];
  ch.tickers.forEach((t,i)=>{const arr=j.d&&j.d[coins[i]];
   if(!arr||!arr.length){bad.push(t);return;}
   const got=arr.map(x=>({t:x[0],h:x[1],l:x[2],c:x[3],o:x[4]}));
   const candles=ch.inc?F.mergeCandles(getC(t),got,uw.from-barMs):got;   /* HL은 시작 시각을 품은 봉(t<from)도 돌려줌 — 전체 수집과 똑같이 그 봉을 남김 */
   if(candles.length<=KA+1){bad.push(t);return;}
   F.fetchStat[ch.inc?"inc":"full"]++;F.fetchStat.bars+=got.length;
   bucket[t]={t:Date.now(),candles};
   const r=build(candles,w,f,t);if(r)data[t]=r;
  });
  onData&&onData(data);
  return bad;
 };
 let miss=[];
 for(let pass=0;pass<4;pass++){
  const runs=F.planChunks(pass===0?need:miss,getC,uw.from,barMs,KA+1);miss=[];
  if(!runs.length)break;
  const rs=await pool(runs.map(ch=>()=>one(ch).catch(()=>ch.tickers)),par||5);
  rs.forEach(b=>{if(b&&b.length)miss.push(...b);});
  if(!miss.length)break;
  if(pass<3){const ms=[1500,3500,6000][pass];F.tk.w("frame","한도 대기 · 누락 "+miss.length+"개 재시도 "+(pass+1)+"/3",ms);await sleep(ms);}
 }
 /* 끝내 못 받은 종목도 저장된 캔들이 있으면 그걸로라도 그림(빈 칸 방지) — 다음 갱신 때 다시 시도 */
 list.forEach(t=>{if(!data[t]&&getC(t)&&getC(t).length>KA+1){const r=build(getC(t),w,f,t);if(r)data[t]=r;}});
 rawSaveDebounced(iv);
 return {data,miss:list.filter(t=>!data[t]),total:list.length};
};
/* 봉 간격을 직접 골라도(예: 20D+4h) 그 봉을 쓰는 기본 프레임(60D 등)의 원본 캔들 캐시가 이 기간을 덮으면 같은 캐시·증분 갱신을 씀 */
F.fetchFast=async(f,tickers,onData,par,pri)=>{await F.ensureDay(tickers,par,pri);const useRaw=f.auto||(RAW_UNION_DAYS[f.iv]&&f.days<=RAW_UNION_DAYS[f.iv]&&!f.tick);return useRaw?F.fetchFastRaw(f,tickers,onData,par,pri):F.fetchFastExact(f,tickers,onData,par,pri);};

/* ── 일봉 캔들(켈트너 기준용) 병렬 수집 ──
   종목당 330일치 1d 1회(6종목씩 서버 프록시 병렬) → F.dayC 메모리 + IndexedDB(raw|day) 공유. 45분 안이면 재사용, 어떤 기간·봉을 보든 같은 데이터를 씀.
   동시에 여러 곳에서 불려도 한 번만 받도록 진행 중인 요청을 공유 */
const DAY_LOOK=330;
let dayLoadP=null,dayP=null,daySaveT=null;
F.ensureDay=async(tickers,par,pri)=>{
 if(F.mode()!=="kel")return;
 if(!dayLoadP)dayLoadP=(async()=>{try{const v=await F.idbGet("raw|day");if(v&&v.data)F.dayC=Object.assign({},v.data,F.dayC);}catch(e){}})();
 await dayLoadP;
 for(let guard=0;guard<4;guard++){
  const need=tickers.filter(t=>F.coinOf(t)&&!(F.dayC[t]&&F.dayFresh(F.dayC[t].t)));
  if(!need.length){const x=F.tk.m.day;if(!x||x.state!=="run")F.tk.d("day","캐시 사용 (오늘 마감된 일봉)");return;}
  if(dayP){await dayP;continue;}
  dayP=fetchDay(need,par||5,pri).catch(()=>{}).finally(()=>{dayP=null;});
  await dayP;return;
 }
};
async function fetchDay(list,par,pri){
 list=list.slice().sort((a,b)=>F.weightOf(b)-F.weightOf(a));
 let dayOk=0;F.tk.b("day",list.length);
 const end=Date.now(),start=end-DAY_LOOK*86400000,DAYMS=86400000;
 const getC=t=>F.dayC[t]&&F.dayC[t].candles;
 let miss=[];
 for(let pass=0;pass<4;pass++){
  const runs=F.planChunks(pass===0?list:miss,getC,start,DAYMS,DK_ATR+3);miss=[];   /* 저장된 일봉이 있으면 마지막 2일 전부터만 받아 이어붙임 */
  if(!runs.length)break;
  const rs=await pool(runs.map(ch=>async()=>{
   try{
    const coins=ch.tickers.map(F.coinOf),j=await api({coins:coins.join(","),iv:"1d",start:Math.floor(ch.start),end:Math.floor(end)},pri),bad=[];
    ch.tickers.forEach((t,i)=>{const arr=j.d&&j.d[coins[i]];
     if(!arr||!arr.length){bad.push(t);return;}
     const got=arr.map(x=>({t:x[0],h:x[1],l:x[2],c:x[3],o:x[4],v:x[5]}));   /* v=거래량: 3일평균 거래대금을 저장된 일봉에서 바로 계산(추가 HL 호출 없음) */
     const candles=ch.inc?F.mergeCandles(getC(t),got,start-DAYMS):got;
     if(candles.length>DK_ATR+3){F.dayC[t]={t:Date.now(),candles};F.fetchStat[ch.inc?"inc":"full"]++;F.fetchStat.bars+=got.length;}else bad.push(t);});
    dayOk+=ch.tickers.length-bad.length;F.tk.p("day",dayOk);
    return bad;
   }catch(e){return ch.tickers;}
  }),par);
  rs.forEach(b=>{if(b&&b.length)miss.push(...b);});
  if(!miss.length)break;
  if(pass<3){const ms=[1500,3500,6000][pass];F.tk.w("day","한도 대기 · 누락 "+miss.length+"개 재시도 "+(pass+1)+"/3",ms);await sleep(ms);}
 }
 F.tk.d("day",dayOk<list.length?"누락 "+(list.length-dayOk)+"개":"");
 clearTimeout(daySaveT);daySaveT=setTimeout(()=>F.idbSet("raw|day",{data:Object.fromEntries(Object.entries(F.dayC).map(([k,r])=>[k,{t:r.t,candles:r.candles}]))}),1500);
}

/* ── 저장: 메모리(최근 16개 프레임 — 기본 프레임 15개를 전부 동시에 기억할 수 있게) + IndexedDB(전부)
   — 프레임을 바꿀 때 즉시 표시. 예전엔 3개만 남겨서 4번째 전환부터 IndexedDB를 다시 타야 했음
   (요청 반영: "시간프레임 바꿀 때마다 로딩이 오래 걸림") */
F.mem={};const memOrder=[];
F.memSet=(k,v)=>{F.mem[k]=v;const i=memOrder.indexOf(k);if(i>=0)memOrder.splice(i,1);memOrder.push(k);while(memOrder.length>16)delete F.mem[memOrder.shift()];};
let dbP=null;
const idb=()=>dbP||(dbP=new Promise((res,rej)=>{try{const r=indexedDB.open("flowcache",1);r.onupgradeneeded=()=>r.result.createObjectStore("frames");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}catch(e){rej(e);}}));
/* 프레임 캐시(계산된 켈상단 포함)는 키에 km15_ 접두 — 옛 배수(×1) 캐시 무효화. raw 캔들은 배수와 무관해 그대로 재사용 */
const ik=k=>(String(k).startsWith("raw|")?k:"kc_"+k);
F.idbGet=async k=>{k=ik(k);try{const db=await idb();return await new Promise(res=>{const q=db.transaction("frames").objectStore("frames").get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null);});}catch(e){return null;}};
F.idbSet=async(k,v)=>{k=ik(k);try{const db=await idb();await new Promise(res=>{const tx=db.transaction("frames","readwrite");tx.objectStore("frames").put(v,k);tx.oncomplete=res;tx.onerror=res;tx.onabort=res;});}catch(e){}};

/* ── 실시간: WebSocket allMids(덱스별 구독) → 0.8초마다 묶어서 전달, 끊기면 자동 재연결 ── */
F.wsState="idle";
F.startWS=onMids=>{
 let ws=null,retry=0,pingT=null,dirty=false;const mids={};
 const open=()=>{
  try{ws=new WebSocket("wss://api.hyperliquid.xyz/ws");}catch(e){F.wsState="off";setTimeout(open,5000);return;}
  ws.onopen=()=>{retry=0;F.wsState="on";
   (F.dexes&&F.dexes.length?F.dexes:[""]).forEach(dx=>ws.send(JSON.stringify({method:"subscribe",subscription:dx?{type:"allMids",dex:dx}:{type:"allMids"}})));
   clearInterval(pingT);pingT=setInterval(()=>{try{ws.send(JSON.stringify({method:"ping"}));}catch(e){}},40000);};
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.channel==="allMids"&&m.data&&m.data.mids){Object.assign(mids,m.data.mids);dirty=true;}}catch(x){}};
  ws.onclose=()=>{clearInterval(pingT);F.wsState="off";setTimeout(open,Math.min(15000,1000*Math.pow(2,retry++)));};
  ws.onerror=()=>{try{ws.close();}catch(e){}};
 };
 open();
 setInterval(()=>{if(dirty){dirty=false;F.recordTicks(mids);if(!document.hidden)onMids(mids);}},800);
 F.wsReopen=()=>{if(!ws||ws.readyState>1){try{ws&&ws.close();}catch(e){}retry=0;open();}};
};

/* ── 틱 버퍼: 15M·3M 프레임을 열자마자 최근 틱이 보이도록, 실시간 수신 중에는 프레임과 무관하게 계속 쌓아 둠 ── */
F.tickBuf={};
F.recordTicks=mids=>{
 const now=Math.floor(Date.now()/1000)+KST;
 F.TICKERS.forEach(t=>{const coin=F.coinOf(t);if(!coin)return;const px=+mids[coin];if(!(px>0))return;
  const b=F.tickBuf[coin]||(F.tickBuf[coin]=[]);const last=b[b.length-1];
  if(last&&now-last[0]<2)return;
  b.push([now,px]);if(b.length>600)b.splice(0,b.length-600);});
};

/* ── 로딩 상태 기록 창구(F.tk) ──
   로딩 지점마다 시작(b)/진행(p)/대기 안내(w)/끝(d)/실패(f)를 알리면, 상단 상태창(flow-ui.js)이 읽어서 그림.
   fg = 화면이 뜨기까지의 앞단계, bg = 화면이 뜬 뒤 뒤에서 이어지는 일. 이벤트는 id 와 함께 on(id)로 전달 */
const TKDEF={settings:["설정 불러오기","fg"],map:["코인맵 연결","fg"],cache:["저장본 확인","fg"],shared:["서버 공유본 확인","fg"],day:["일봉 켈트너 수집","fg"],frame:["차트 데이터 수집","fg"],
 daily:["일봉 켈 공유캐시","bg"],fill:["켈 정보 보완","bg"],k4:["4시간 중심선","bg"],vol:["3일 거래대금","bg"],pre:["다른 프레임 미리받기","bg"],live:["실시간 연결","bg"]};
const TKORDER=Object.keys(TKDEF),tkS={m:{},t0:Date.now(),on:null};
function TKT(id){return tkS.m[id]||(tkS.m[id]={id,label:TKDEF[id][0],bg:TKDEF[id][1]==="bg",state:"idle",n:0,total:0,t0:0,t1:0,note:"",wait:0,s:[]});}
const tkFire=id=>{if(tkS.on)tkS.on(id);};
F.tk={
 order:TKORDER,label:id=>(TKDEF[id]?TKDEF[id][0]:id),
 get m(){return tkS.m;},get t0(){return tkS.t0;},
 set on(fn){tkS.on=fn;},
 session(){tkS.t0=Date.now();TKORDER.forEach(id=>{const x=tkS.m[id];if(x&&id!=="settings"&&!(x.bg&&x.state==="run"))delete tkS.m[id];});tkFire(null);},
 b(id,total,note){const x=TKT(id),t=Date.now();x.state="run";x.n=0;x.total=total||0;x.t0=t;x.t1=0;x.note=note||"";x.wait=0;x.s=[[t,0]];tkFire(id);},
 p(id,n,total){const x=TKT(id),t=Date.now();if(x.state!=="run"){x.state="run";if(!x.t0)x.t0=t;}x.n=n;if(total!=null)x.total=total;x.s.push([t,n]);while(x.s.length>2&&t-x.s[0][0]>6000)x.s.shift();x.wait=0;tkFire(id);},
 w(id,text,ms){const x=TKT(id);x.note=text;x.wait=Date.now()+ms;tkFire(id);},
 d(id,note){const x=TKT(id),t=Date.now();x.state="done";if(x.total&&!note)x.n=x.total;x.t1=t;if(!x.t0)x.t0=t;x.note=note||"";x.wait=0;tkFire(id);},
 f(id,msg){const x=TKT(id);x.state="fail";x.t1=Date.now();x.note=msg||"실패";tkFire(id);}
};
/* 뒤에서 도는 보완 작업은 내부 진행 지점이 따로 없어서, 0.35초마다 '이미 채워진 종목 수'를 세어 진행도로 알림 */
async function tkTrack(id,tickers,cover,run,isBusy){
 const list=tickers.filter(t=>F.coinOf(t)),total=list.length;
 const upd=()=>F.tk.p(id,list.filter(cover).length,total);
 F.tk.b(id,total);upd();
 const ib=()=>{const s=isBusy&&isBusy();const x=TKT(id);if(s&&s!=="abort"){if(x.note!=="차트 수집이 끝나길 대기"){x.note="차트 수집이 끝나길 대기";tkFire(id);}}else if(x.note==="차트 수집이 끝나길 대기"){x.note="";}return s;};
 const tm=setInterval(upd,350);
 try{await run(ib);}catch(e){clearInterval(tm);F.tk.f(id,String((e&&e.message)||e));return;}
 clearInterval(tm);upd();F.tk.d(id);
}
{
 const o={daily:F.loadDaily,fill:F.fillMissingDaily,k4:F.loadK4,vol:F.loadVol3d};
 F.loadDaily=async()=>{F.tk.b("daily");try{await o.daily();F.tk.d("daily",Object.keys(F.daily).length?"":"없음");}catch(e){F.tk.f("daily");}};
 F.fillMissingDaily=(tickers,ib)=>tkTrack("fill",tickers,t=>{const d=F.dailyOf(t);return !!(d&&d.kel_upper!=null);},b=>o.fill(tickers,b),ib);
 F.loadK4=(tickers,ib)=>tkTrack("k4",tickers,t=>F.k4[t]!=null,b=>o.k4(tickers,b),ib);
 F.loadVol3d=(tickers,ib)=>tkTrack("vol",tickers,t=>F.vol3dOf(t)!=null,b=>o.vol(tickers,b),ib);
}

/* 캔들로 만든 프레임 데이터 뒤에 틱을 이어붙임(틱 프레임 전용) */
F.seedTicks=(data,f)=>{
 if(!f.tick)return data;
 Object.keys(data).forEach(t=>{const d=data[t],coin=F.coinOf(t),b=coin&&F.tickBuf[coin];if(!b||!d.t.length)return;
  const lastT=d.t[d.t.length-1],lastU=d.u[d.u.length-1],lastM=d.m?d.m[d.m.length-1]:lastU,lastD=d.dn?d.dn[d.dn.length-1]:lastM;
  b.forEach(([ts,px])=>{if(ts>lastT+1){const pct=+((px/d.base-1)*100).toFixed(3);d.t.push(ts);d.p.push(pct);d.u.push(lastU);if(d.m)d.m.push(lastM);if(d.dn)d.dn.push(lastD);d.o.push(pct);d.h.push(pct);d.l.push(pct);}});});
 return data;
};
})();
