/* ═══════════════════════════════════════════════════════════════
   선구안 흐름차트 — 차트 엔진 (flow-chart.js)
   · lightweight-charts v5(트레이딩뷰 라이브러리): 관성 드래그·휠줌·축드래그·크로스헤어
   · 상단 메인(종목선 + 굵은 켈트너상단/상대강도) / 하단 '이격 확대뷰'(전체 높이의 1/3, 자체 스케일)
   · 오버레이 캔버스: 세션선(KR 09:00 / US 개장) · 주말 음영 · 24시간 전 기준선 · 알약 라벨 · 골든/데드 라벨 · 그리기 도구
   ═══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const F=window.FLOW,LW=window.LightweightCharts,KST=F.KST;
F.num=v=>typeof v==="number"&&isFinite(v);   /* undefined===undefined 이 참이라 v===v 로 NaN 검사하면 안 됨 */
const FONT='"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Nanum Gothic",system-ui,sans-serif';   /* Nanum Gothic = 서버(리눅스) 캡처용 한글 글꼴 */

/* ── 지표 설정 기본값: 상단 EMA · 하단 이격뷰 · 하단 윌리엄스 %R (톱니바퀴 팝업에서 수정, F.ui.ind 로 저장·동기화) ──
   style: 0 실선 / 1 점선 / 2 파선 / 3 긴파선.  w=0 이면 메인 '켈상단·상대강도' 굵기를 따름 */
F.defaultInd=()=>({
 ma:{src:"rs",early:true,lines:[   /* EMA 기준선(src): rs=상대강도 / ku=켈상단. early=봉이 모자라도 첫 값부터 계산(끄면 기간이 다 찬 봉부터) */
  {len:5,color:"#ff4d5d",w:1.6,style:0,on:true,core:null},
  {len:10,color:"#4da3ff",w:1.6,style:0,on:true,core:null},
  {len:20,color:"#ffb020",w:1.8,style:0,on:true,core:null},
  {len:60,color:"#3ddc84",w:2,style:0,on:true,core:null},
  {len:120,color:"#ffb347",w:3,style:0,on:true,core:null,a:0.72},   /* 장기선(120·240·480): 주황 · 두껍게 · 살짝 연하게(a=진하기) → 단기선과 구분 */
  {len:240,color:"#ff9f43",w:4.6,style:0,on:true,core:null,a:0.72},
  {len:480,color:"#ff8a1f",w:6.4,style:0,on:true,core:null,a:0.72}
 ]},
 fx:{shade:{on:true,color:"#f5c542",a:0.14},   /* 켈 상단선~하단선 사이 음영(선·종목선보다 뒤) */
  led:{ku:{fx:"off",color:"#ffd84d",speed:5,power:6},low:{fx:"off",color:"#ffd84d",speed:5,power:6},rs:{fx:"off",color:"#7fe9ff",speed:5,power:6}}},   /* LED 효과: off/glow(네온)/flow(흐르는 불빛)/pulse(맥동) */
 dots:{on:true,size:2,stocks:false},   /* 선이 꺾이는 봉마다 작은 동그라미(반지름 px). stocks=종목선에도 */
 gap:{ku:{color:"#f5c542",w:0,style:0,on:true},rs:{color:"#ffffff",w:0,style:0,on:true},hist:{up:"#31d67b",dn:"#ff5a6e",a:0.55,h:0.28}},
 wr:{zones:true,smooth:6,curve:true,obColor2:"#ff5a6e",osColor2:"#b07cff",ob:-20,   /* obColor2/osColor2 = 두 선이 모두 과매수/과매도일 때(강한 구간) 진한 음영색 */
   os:-80,mid:false,   /* smooth=%R 결과를 EMA 로 다듬는 기간(1=끔) · curve=곡선으로 이어붙이기 */obColor:"#5be49b",osColor:"#6cb6ff",zoneA:0.16,   /* 과매수(−20 위)=연한 그린 / 과매도(−80 아래)=연한 블루 */
  lines:[
   {src:"rs",len:14,color:"#ffffff",w:2,style:0,on:true},
   {src:"rs",len:48,color:"#ff8a1f",w:3.8,style:0,on:true},   /* 48 = 주황 · 단기(14)보다 두껍게 */
  ]}
});
/* 저장돼 있던 옛 설정에 항목이 빠져 있어도 기본값으로 채움(배열은 통째로 저장되므로 길이·필드 보정) */
F.normInd=()=>{
 const d=F.defaultInd(),I=F.ui.ind||(F.ui.ind=d);
 const fix=(arr,def)=>{const out=[];def.forEach((x,i)=>out.push(Object.assign({},x,(arr&&arr[i])||{})));return out;};
 I.ma=Object.assign({},d.ma,I.ma||{});I.ma.lines=fix(I.ma.lines,d.ma.lines);
 if(I.ma.lv!==2){[4,5,6].forEach(i=>{Object.assign(I.ma.lines[i],d.ma.lines[i]);});I.ma.lv=2;}   /* 1회 이전: 장기선(120·240·480)을 새 기본(주황·굵게·연하게)으로 */
 I.ma.lines.forEach(l=>{l.a=(+l.a>0&&+l.a<=1)?+l.a:1;});
 if(I.ma.lo!==1){F.ui.show.ma=false;F.ui.show.maLow=true;I.ma.lo=1;}   /* 1회 이전: 차트(위) EMA 끄고 하단 이격뷰 EMA 켬 */
 I.dots=Object.assign({},d.dots,I.dots||{});I.dots.size=Math.max(0.5,Math.min(8,+I.dots.size||2));
 I.fx=Object.assign({},d.fx,I.fx||{});I.fx.shade=Object.assign({},d.fx.shade,I.fx.shade||{});I.fx.led=Object.assign({},d.fx.led,I.fx.led||{});["ku","low","rs"].forEach(k=>{I.fx.led[k]=Object.assign({},d.fx.led[k],I.fx.led[k]||{});});
 I.gap=Object.assign({},d.gap,I.gap||{});["ku","rs","hist"].forEach(k=>{I.gap[k]=Object.assign({},d.gap[k],I.gap[k]||{});});
 I.wr=Object.assign({},d.wr,I.wr||{});I.wr.lines=fix(I.wr.lines,d.wr.lines);
 if(!(I.wr.sv>=2)){I.wr.smooth=d.wr.smooth;I.wr.curve=true;}
 if(I.wr.sv!==3){I.wr.lines[0]=Object.assign({},d.wr.lines[0]);I.wr.lines[1]=Object.assign({},d.wr.lines[1]);I.wr.sv=3;}   /* 1회 이전: 14=흰 얇게 / 48=주황 굵게 */   /* 1회 이전: 3분봉처럼 짧은 봉에서도 부드럽게 보이도록 평활 6 */
 I.ma.lines.forEach(l=>{l.len=Math.max(1,Math.min(2000,Math.round(+l.len||1)));});
 I.wr.lines.forEach(l=>{l.len=Math.max(2,Math.min(500,Math.round(+l.len||14)));if(l.src!=="ku")l.src="rs";});I.wr.smooth=Math.max(1,Math.min(30,Math.round(+I.wr.smooth||1)));
};
/* ── 사용자 설정 기본값(저장은 flow-ui.js가 담당) ── */
F.defaultUI=()=>({
 font:5,                       /* 글씨 크기 1~10 (기본 5 = 중간, 3이 기존 크기) */
 frame:"20D",iv:"auto",   /* frame=기간(240D…3M), iv=봉 간격(auto=기간 기본) */
mode:"kel",                   /* 표시 기준: kel=각 종목 현재 일봉 켈상단 대비(기본) / start=기간 시작가 대비(예전 방식) */
 candleMode:"line",            /* 종목선 표시 방식: line=종가선(기존) / candle=일반 봉캔들 / heikin=하이킨아시(파랑 계열) */
 w:{stock:1.6,index:3.6,commodity:3.2,line:4.6},   /* 종류별 굵기: 일반종목/지수/원자재/켈상단·상대강도 */
 ind:F.defaultInd(),
 show:{ku:true,mid:true,low:true,clip:true,rs:true,stocks:true,sessions:true,pills:true,cross:true,crossBottom:true,gap:true,weekend:true,h24:true,ma:false,maLow:true,wr:true},   /* ma=차트(위) EMA 기본 끔 · maLow=하단 이격뷰 EMA 기본 켬 */
 weight:"ntl",                 /* 상대강도 가중: ntl=거래대금 / eq=균등 */
 checks:{},fs:{},solo:null,draw:{},collapsed:{},tool:"cursor",updated:0,
 scale:{},                     /* 프레임별로 고정한 상하 스케일 { "20D|1h": { main:[하한,상한], gap:[..], wr:[..] } } */
 sideW:0,sideSplit:0.34,extra:[]      /* 오른쪽 패널 폭(px, 0=기본)·조건검색/종목 높이 비율·사용자가 추가한 종목 */
});
F.ui=F.defaultUI();
F.scale=()=>1+(F.ui.font-3)*0.1;

const S=F.S={data:{},grid:[],gidx:new Map(),P:{},U:{},M:{},DN:{},O:{},H:{},L:{},series:{},seriesMode:{},haOpen:{},barFresh:{},hover:null,crosses:[],crossesM:[],rsA:[],kuA:[],mA:[],dA:[],maA:[],wrA:[],fitted:false};
let chart=null,stage=null,chartEl=null,ov=null,ctx=null,PILL_W=250;
let rsS=null,kuS=null,mS=null,lowS=null,anchS=null,rs2=null,ku2=null,histS=null,mk1=null,mk2=null,refS=null;
let maS=[],maC=[],maL=[],wrS=[],wrAnchor=null,wrPL=[];   /* maL = 하단 이격뷰(상대강도) 위에 겹치는 EMA 5·10·20·60·120 */   /* 상단 EMA 본선·심선 / 하단 W%R 선들·기준(축 고정) 시리즈·−20/−80 기준선 */
/* 축 눈금 표기: 패널마다 달라서(메인·이격뷰=%p, W%R=−20 형식) 차트 전체 포매터 대신 시리즈별 포매터를 씀 */
const PF_P={type:"custom",minMove:0.01,formatter:p=>(p>=0?"+":"")+p.toFixed(2)+"%p"};
const PF_W={type:"custom",minMove:0.1,formatter:p=>Math.abs(p-Math.round(p))<0.05?String(Math.round(p)):p.toFixed(1)};
const pad=n=>String(n).padStart(2,"0");
const WD=["일","월","화","수","목","금","토"];
F.fmtT=(s,full,sec)=>{const d=new Date(s*1000);return (full===false?"":(d.getUTCMonth()+1)+"/"+d.getUTCDate()+"("+WD[d.getUTCDay()]+") ")+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+(sec?":"+pad(d.getUTCSeconds()):"");};
F.fmtP=(v,d)=>(v>=0?"+":"")+v.toFixed(d==null?2:d)+"%p";
F.fmtDur=sec=>{sec=Math.abs(sec);const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);return (d?d+"일 ":"")+(h?h+"시간 ":"")+(m||(!d&&!h)?m+"분":"");};
const rgba=(hex,a)=>{const h=hex.replace("#","");const n=parseInt(h.length===3?h.split("").map(c=>c+c).join(""):h,16);return "rgba("+(n>>16&255)+","+(n>>8&255)+","+(n&255)+","+a+")";};
let _fk="",_fo=null;
const frameObj=()=>{const k=F.ui.frame+"|"+F.ui.iv+"|"+F.mode();if(k!==_fk||!_fo){_fk=k;_fo=F.frameOf(F.ui.frame,F.ui.iv);}return _fo;};
F.frameObj=frameObj;

/* ── 종목 선 스타일: 종류(일반/지수/원자재)별 굵기, 호버·단독선택 시 강조/흐림 ── */
function styleOf(t){
 const kind=F.kindOf(t),base=F.ui.w[kind]||1.6,c=F.COLORS[t]||"#8899aa";
 const solo=F.ui.solo,hov=S.hover;
 let a=kind==="stock"?0.72:0.95,w=base;
 if(solo&&solo===t){w=base+1.6;a=1;}
 else if(hov&&hov===t){w=base+1.4;a=1;}
 else if(hov||solo){a=kind==="stock"?0.13:0.3;}
 const D=F.ui.ind&&F.ui.ind.dots,dots=!!(D&&D.on&&D.stocks&&S.dotsOK!==false);
 return {color:rgba(c,a),lineWidth:Math.max(1,Math.round(w*10)/10),pointMarkersVisible:dots,pointMarkersRadius:dots?(+D.size||2):2};
}
/* 선 위 점(마커): 봉 간격이 너무 좁으면(점끼리 겹침) 자동으로 숨김 — S.dotsOK 는 보이는 범위에서 계산 */
const DOT=()=>{const D=F.ui.ind.dots;return {pointMarkersVisible:!!(D.on&&S.dotsOK!==false),pointMarkersRadius:+D.size||2};};
const restyleNow=()=>{
 if((F.ui.candleMode||"line")==="line")
  Object.keys(S.series).forEach(t=>{const st=styleOf(t),key=st.color+"|"+st.lineWidth+"|"+st.pointMarkersVisible+"|"+st.pointMarkersRadius,sr=S.series[t];if(sr.__k!==key){sr.__k=key;sr.applyOptions(st);}});
 else{const col=CANDLE_COL[F.ui.candleMode]||CANDLE_COL.candle;
  Object.keys(S.series).forEach(t=>{const dim=!!(S.hover&&S.hover!==t),key=dim?"d":"n",sr=S.series[t];if(sr.__k!==key){sr.__k=key;const a=dim?0.1:1;
   sr.applyOptions({upColor:rgba(col.up,a),downColor:rgba(col.dn,a),borderUpColor:rgba(col.up,a),borderDownColor:rgba(col.dn,a),wickUpColor:rgba(col.up,a),wickDownColor:rgba(col.dn,a)});}});}
 const lw=F.ui.w.line,G=F.ui.ind.gap;
 const dt=DOT();
 rsS&&rsS.applyOptions(Object.assign({lineWidth:lw,visible:F.ui.show.rs},dt));
 kuS&&kuS.applyOptions(Object.assign({lineWidth:lw,visible:F.ui.show.ku},dt));
 mS&&mS.applyOptions(Object.assign({lineWidth:(F.ui.w.mid>0?F.ui.w.mid:lw),visible:F.ui.show.mid!==false},dt));
 lowS&&lowS.applyOptions(Object.assign({lineWidth:lw,visible:F.ui.show.low!==false},dt));
 /* 하단 이격뷰 선은 자기 설정(색·굵기·모양)을 따름 — 굵기 0 이면 메인 굵기와 동일 */
 rs2&&rs2.applyOptions({color:G.rs.color,lineWidth:G.rs.w>0?G.rs.w:lw,lineStyle:G.rs.style,visible:!!(F.ui.show.rs&&G.rs.on),pointMarkersVisible:dt.pointMarkersVisible,pointMarkersRadius:dt.pointMarkersRadius});
 ku2&&ku2.applyOptions({color:G.ku.color,lineWidth:G.ku.w>0?G.ku.w:lw,lineStyle:G.ku.style,visible:!!(F.ui.show.ku&&G.ku.on),pointMarkersVisible:dt.pointMarkersVisible,pointMarkersRadius:dt.pointMarkersRadius});
 if(histS)histS.applyOptions({visible:!!(F.ui.show.gap&&F.ui.show.rs&&F.ui.show.ku)});
 indStyle();
 fxSchedule();
 F.redraw();
};
let rsQ=false;
F.restyle=()=>{if(rsQ)return;rsQ=true;Promise.resolve().then(()=>{rsQ=false;restyleNow();});};   /* 한 번의 클릭에서 여러 번 불려도 1회만 */
F.restyleNow=restyleNow;
F.setHover=t=>{if(S.hover===t)return;S.hover=t;F.restyle();};

/* ── 음영 + LED 효과: 차트 시리즈 프리미티브 ──
   · 음영(켈 상단선~하단선 사이)은 맨 뒤 레이어('bottom') → 종목선·EMA·굵은 선이 전부 위에 보임
   · LED 효과(네온 글로우 / 흐르는 LED / 맥동)는 선 위 레이어('top')에 선 모양을 따라 덧그림
   · 움직이는 효과(흐름·맥동)가 켜져 있을 때만 20fps로 다시 그림 → 꺼두면 부하 0 */
let fxReq=null,fxTimer=null;
const mixW=(hex,k)=>{const h=hex.replace("#","");const n=parseInt(h.length===3?h.split("").map(c=>c+c).join(""):h,16);const m=v=>Math.round(v+(255-v)*k);return "rgb("+m(n>>16&255)+","+m(n>>8&255)+","+m(n&255)+")";};
function fxSample(){
 if(!chart||!kuS||!S.grid.length)return null;
 const ts=chart.timeScale(),lr=ts.getVisibleLogicalRange();if(!lr)return null;
 const G=S.grid,i0=Math.max(0,Math.floor(lr.from)-1),i1=Math.min(G.length-1,Math.ceil(lr.to)+1);if(i1<i0)return null;
 const step=Math.max(1,Math.ceil((i1-i0)/(F.SHOT?220:1200)));   /* 서버 캡처: 글로우(굵은 둥근 선 여러 겹)는 점이 많을수록 칠하는 비용이 폭증 → 220점으로 */
 const col=(ser,arr)=>{const out=[];for(let i=i0;i<=i1;i+=step){const v=arr[i],x=F.num(v)?ts.timeToCoordinate(G[i]):null,y=F.num(v)?ser.priceToCoordinate(v):null;out.push(x==null||y==null?null:{x,y});}return out;};
 return {ku:col(kuS,S.kuA),low:col(lowS,S.dA),rs:col(rsS,S.rsA)};
}
function fxPath(c,pts){c.beginPath();let pen=false;pts.forEach(p=>{if(!p){pen=false;return;}if(!pen){c.moveTo(p.x,p.y);pen=true;}else c.lineTo(p.x,p.y);});}
function fxBand(scope){
 const I=F.ui.ind.fx;if(!I||!I.shade.on||!F.ui.show.ku||F.ui.show.low===false)return;
 const d=fxSample();if(!d)return;const c=scope.context;c.fillStyle=rgba(I.shade.color,I.shade.a);
 let run=[];const flush=()=>{if(run.length<2){run=[];return;}c.beginPath();run.forEach((p,i)=>i?c.lineTo(p.x,p.u):c.moveTo(p.x,p.u));for(let i=run.length-1;i>=0;i--)c.lineTo(run[i].x,run[i].d);c.closePath();c.fill();run=[];};
 for(let i=0;i<d.ku.length;i++){const u=d.ku[i],l=d.low[i];if(u&&l)run.push({x:u.x,u:u.y,d:l.y});else flush();}
 flush();
}
function fxLed(scope){
 const I=F.ui.ind.fx;if(!I)return;
 if(!["ku","low","rs"].some(k=>I.led[k].fx!=="off"))return;
 const d=fxSample();if(!d)return;
 const c=scope.context,T=performance.now()/1000,pr=window.devicePixelRatio||1,lw=F.ui.w.line;
 ["ku","low","rs"].forEach(k=>{
  const o=I.led[k];if(!o||o.fx==="off"||F.ui.show[k]===false)return;
  const pts=d[k],sp=+o.speed||5,pw=+o.power||6,col=o.color||"#ffd84d",lite=mixW(col,0.6);
  c.save();c.lineCap="round";c.lineJoin=F.SHOT?"bevel":"round";
  const k1=o.fx==="pulse"?0.5+0.5*Math.sin(T*sp*0.9):1;   /* 맥동: 밝기·번짐이 숨쉬듯 */
  const stroke=(color,w,blur,a)=>{if(F.SHOT)blur=0;c.shadowColor=col;c.shadowBlur=blur*pr;c.globalAlpha=a;c.strokeStyle=color;c.lineWidth=w;fxPath(c,pts);c.stroke();};
  if(F.SHOT){   /* 서버 캡처: 블러 연산은 느려서 굵기가 다른 반투명 선을 겹쳐 같은 번짐 효과를 냄 */
   stroke(col,lw*5.2+pw,0,0.07);stroke(col,lw*3.6+pw*.6,0,0.1);stroke(col,lw*2.4,0,0.16);stroke(col,lw*1.6,0,0.3);
  }else{
  stroke(col,lw*3.4+pw,pw*2.6*(0.4+0.6*k1),0.16+0.1*k1);   /* 바깥 번짐 */
  stroke(col,lw*1.8,pw*1.3*(0.4+0.6*k1),0.34+0.2*k1);      /* 안쪽 번짐 */
  }
  stroke(lite,Math.max(1,lw*0.4),0,0.5+0.35*k1);            /* 가운데 밝은 심(LED 튜브 느낌) */
  if(o.fx==="flow"){   /* 선을 따라 왼쪽→오른쪽으로 흘러가는 밝은 불빛 덩어리 */
   const L=14+lw*3;c.setLineDash([L,L*3.4]);c.lineDashOffset=-T*sp*26;
   stroke(lite,lw*1.2,pw*2.2,0.95);c.setLineDash([]);
  }
  c.restore();
 });
}
const fxPrim={
 attached(p){fxReq=p.requestUpdate;},detached(){fxReq=null;},updateAllViews(){},
 paneViews(){return [
  {zOrder:()=>"bottom",renderer:()=>({draw:t=>t.useMediaCoordinateSpace(sc=>fxBand(sc))})},
  {zOrder:()=>"top",renderer:()=>({draw:t=>t.useMediaCoordinateSpace(sc=>fxLed(sc))})}
 ];}
};
/* 움직이는 효과가 하나라도 켜져 있으면 20fps로 갱신 요청, 아니면 타이머 정지 */
function fxSchedule(){
 const I=F.ui.ind&&F.ui.ind.fx,on=!!(I&&["ku","low","rs"].some(k=>I.led[k].fx==="flow"||I.led[k].fx==="pulse"));
 if(on&&!fxTimer)fxTimer=setInterval(()=>{if(!document.hidden&&fxReq)fxReq();},50);
 else if(!on&&fxTimer){clearInterval(fxTimer);fxTimer=null;}
 fxReq&&fxReq();
}
F.fxRefresh=fxSchedule;

/* ── 차트 생성 ── */
F.initChart=(stageEl,chartDiv,canvas,pillW)=>{
 stage=stageEl;chartEl=chartDiv;ov=canvas;ctx=ov.getContext("2d");PILL_W=pillW||250;
 const sc=F.scale();
 chart=LW.createChart(chartEl,{
  autoSize:true,
  layout:{background:{type:"solid",color:"#0a0e15"},textColor:"#8c9bb2",fontFamily:FONT,fontSize:Math.round(12*sc),
   panes:{separatorColor:"#3a5688",separatorHoverColor:"#6f9bff",enableResize:true},attributionLogo:true},
  grid:{vertLines:{color:"#111823"},horzLines:{color:"#111823"}},
  crosshair:{mode:0,vertLine:{color:"#5f7194",width:1,style:2,labelBackgroundColor:"#22324f"},horzLine:{color:"#5f7194",width:1,style:2,labelBackgroundColor:"#22324f"}},
  leftPriceScale:{visible:false},
  rightPriceScale:{visible:true,borderColor:"#1c2536",scaleMargins:{top:0.08,bottom:0.08}},   /* 가격축은 오른쪽(트레이딩뷰처럼): 축을 위아래로 끌면 확대·축소 */
  timeScale:{borderColor:"#1c2536",timeVisible:true,secondsVisible:false,rightOffset:4,minBarSpacing:0.03,
   tickMarkFormatter:(t,type)=>{const d=new Date(t*1000);return type<=2?(d.getUTCMonth()+1)+"/"+d.getUTCDate()+"("+WD[d.getUTCDay()]+")":pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+(frameObj().tick?":"+pad(d.getUTCSeconds()):"");}},
  handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},   /* 터치: false면 가격축 세로 드래그가 페이지 스크롤로 넘어가 스케일이 안 됨 */
  handleScale:{axisPressedMouseMove:{time:true,price:true},mouseWheel:true,pinch:true},
  kineticScroll:{mouse:true,touch:true},
  localization:{timeFormatter:t=>F.fmtT(t,true,frameObj().tick)}   /* 가격 표기는 시리즈별 priceFormat(PF_P / PF_W) */
 });
 F.normInd();
 const ts=chart.timeScale();
 ts.subscribeVisibleLogicalRangeChange(()=>{F.redraw();
  try{const lr=ts.getVisibleLogicalRange(),pw=Math.max(1,chartEl.clientWidth-plotRW()),sp=lr?pw/Math.max(1,lr.to-lr.from):99,D=F.ui.ind.dots,ok=sp>=(+D.size||2)*2+1.5;   /* 봉 사이 간격이 점 지름+여유보다 좁으면 숨김 */
   if(ok!==S.dotsOK){S.dotsOK=ok;F.restyle();}}catch(e){}
 });
 chart.subscribeCrosshairMove(p=>{F.onCrosshair&&F.onCrosshair(p);});
 /* 상대강도 · 켈상단(메인) — 굵게, 종목선 위에 그려지도록 마지막에 추가 */
 const base={priceScaleId:"right",lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,priceFormat:PF_P};
 F.ensureBasketSeries=()=>{};
 kuS=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#f5c542",lineWidth:F.ui.w.line}),0);
 kuS.attachPrimitive(fxPrim);   /* 음영(맨 뒤) + LED 효과(선 위) */
 mS=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#4dd9ff",lineWidth:F.ui.w.line}),0);   /* 켈 중심선(EMA20) 가중평균 */
 lowS=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#f5c542",lineWidth:F.ui.w.line}),0);   /* 켈 하단선(EMA20−1.5ATR) 가중평균 — 상단선과 같은 노랑 */
 anchS=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"rgba(0,0,0,0)",lineWidth:1,autoscaleInfoProvider:()=>S.clipRange?{priceRange:S.clipRange}:null}),0);   /* 눈금 범위 전용(안 보임) — 극단값 종목이 눈금을 눌러버리는 걸 방지 */
 rsS=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#ffffff",lineWidth:F.ui.w.line}),0);
 refS=rsS;
 rsS.createPriceLine({price:0,color:"#3b4a63",lineWidth:1,lineStyle:2,axisLabelVisible:false,title:""});
 /* 하단 이격 확대뷰 — 두 선을 자체 스케일로, 아래에 이격(상대강도−켈상단) 막대 */
 try{
  histS=chart.addSeries(LW.HistogramSeries,{priceScaleId:"gapscale",lastValueVisible:false,priceLineVisible:false,priceFormat:{type:"custom",formatter:v=>(v>=0?"+":"")+v.toFixed(3),minMove:0.001}},1);
  chart.priceScale("gapscale",1).applyOptions({scaleMargins:{top:0.72,bottom:0},visible:false});
 }catch(e){console.warn("[흐름] 이격 막대 생성 실패",e);histS=null;}
 ku2=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#f5c542",lineWidth:F.ui.w.line}),1);
 rs2=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:"#ffffff",lineWidth:F.ui.w.line}),1);
 mk1=LW.createSeriesMarkers(rsS,[]);mk2=LW.createSeriesMarkers(rs2,[]);
 /* 상단 EMA: 7개 본선 + 이중선용 심선(안쪽 가는 선). 상대강도/켈상단 선 바로 아래에 깔림 */
 F.ui.ind.ma.lines.forEach((l,i)=>{
  maS[i]=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:l.color,lineWidth:l.w,visible:false}),0);
  maC[i]=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:l.core||"#ffffff",lineWidth:1,visible:false}),0);
  if(i<5)maL[i]=chart.addSeries(LW.LineSeries,Object.assign({},base,{color:l.color,lineWidth:1.1,visible:false}),1);   /* 하단 이격뷰: 상대강도와 같은 가격축 → 스케일이 맞음 */
 });
 topOrder();
 ensureWr();   /* 하단 윌리엄스 %R 패널(3번째) */
 window.addEventListener("resize",()=>F.redraw());
 /* 창 크기가 바뀌면(작은 창→최대화 등) 사용자가 직접 이동·줌하기 전까지는 자동으로 전체 맞춤 */
 S.userMoved=false;
 ["pointerdown","wheel","touchstart"].forEach(ev=>chartEl.addEventListener(ev,()=>{S.userMoved=true;},{passive:true}));
 /* 가격축을 끌었다 놓거나·축을 더블클릭하면 결과를 읽어 저장(수동이면 고정, 자동으로 돌아왔으면 저장 해제) */
 const syncSoon=()=>setTimeout(scaleSync,60);
 window.addEventListener("pointerup",syncSoon);chartEl.addEventListener("dblclick",syncSoon);
 /* 하단 지표 숨기기/보이기: 빈 곳 더블클릭(PC) · 더블탭(폰·탭) */
 chartEl.addEventListener("dblclick",e=>focusDbl(e.clientX,e.clientY));
 {let tap=null;
  chartEl.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"||!e.isPrimary)return;S.tapDown={x:e.clientX,y:e.clientY,t:Date.now()};},{passive:true});
  chartEl.addEventListener("pointerup",e=>{if(e.pointerType==="mouse"||!S.tapDown)return;const d=S.tapDown;S.tapDown=null;
   if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>10||Date.now()-d.t>350)return;   /* 끌거나 길게 누른 건 탭이 아님 */
   if(tap&&Date.now()-tap.t<350&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<30){tap=null;focusDbl(e.clientX,e.clientY);}
   else tap={x:e.clientX,y:e.clientY,t:Date.now()};},{passive:true});}
 let rz=null;
 new ResizeObserver(()=>{clearTimeout(rz);rz=setTimeout(()=>{if(!S.userMoved)fitAll();F.redraw();},120);}).observe(chartEl);
 startLoop();
 /* 오른쪽 종목명(알약)에 마우스를 올리면 그 종목 선만 선명하게, 나머지는 흐리게 — 알약은 캔버스에 그려져 있어서 위치를 기록해 두고 직접 판정 */
 S.pillHover=null;
 stage.addEventListener("mousemove",e=>{
  if(!F.ui.show.pills||!S.pills||F.ui.tool!=="cursor")return;
  const r=stage.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let hit=null;
  for(const p of S.pills){if(x>=p.x-5&&x<=p.x+p.w+5&&y>=p.y-2&&y<=p.y+p.h+2){hit=p.t;break;}}
  if(hit!==S.pillHover){S.pillHover=hit;F.setHover(hit);stage.style.cursor=hit?"pointer":"";F.redraw();}
 });
 stage.addEventListener("mouseleave",()=>{if(S.pillHover){S.pillHover=null;F.setHover(null);stage.style.cursor="";F.redraw();}});
 restyleNow();
 return chart;
};
F.chart=()=>chart;
/* 전체 맞춤: 격자 전체가 현재 폭에 딱 들어오게 논리 범위를 직접 지정(오른쪽에 2봉 여백) */
/* 티커·등락률·거래대금 라벨 열이 차트 안 오른쪽에 앉으므로, 선 끝과 라벨 사이에 이만큼(px) 여백을 둠 */
const PILL_GAP=26;
const pillCol=()=>Math.round(Math.min(232*F.scale(),Math.max(0,(chartEl?chartEl.clientWidth:0)-plotRW())*0.5));
const pillsOn=()=>!!(F.ui.show.pills&&chartEl&&(chartEl.clientWidth-plotRW())>=560);
function rightMargin(){return pillsOn()?pillCol()+PILL_GAP:0;}
function fitAll(){if(!chart||S.grid.length<3)return;
 try{const m=rightMargin(),pw=Math.max(200,chartEl.clientWidth-plotRW()),frac=Math.min(0.6,m/pw),base=S.grid.length+2,N=base/(1-frac);
  chart.timeScale().applyOptions({rightOffsetPixels:m,rightOffset:4});
  chart.timeScale().setVisibleLogicalRange({from:-1,to:-1+N});}catch(e){}}
F.fitAll=fitAll;

/* ── 시간축 좌표 변환(격자 인덱스 기반, 격자 밖은 봉 간격으로 외삽) ── */
const barSec=()=>{const f=frameObj();return f.tick?2:f.min*60;};
function plotLeft(){return 0;}   /* 가격축이 오른쪽이라 플롯은 왼쪽 끝부터 */
function plotRW(){try{return chart.priceScale("right").width();}catch(e){return 0;}}
function logicalOf(s){
 const G=S.grid,n=G.length;if(n<2)return null;
 if(s<=G[0])return (s-G[0])/barSec();
 if(s>=G[n-1])return n-1+(s-G[n-1])/barSec();
 let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(G[m]<=s)lo=m;else hi=m;}
 return lo+(s-G[lo])/(G[hi]-G[lo]);
}
function timeOfLogical(l){
 const G=S.grid,n=G.length;if(n<2||l==null)return null;
 if(l<=0)return G[0]+l*barSec();if(l>=n-1)return G[n-1]+(l-(n-1))*barSec();
 const i=Math.floor(l);return G[i]+(l-i)*(G[i+1]-G[i]);
}
const xOf=s=>{const l=logicalOf(s);if(l==null)return null;const x=chart.timeScale().logicalToCoordinate(l);return x==null?null:x+plotLeft();};
F.dbg={ind:()=>({maS,maC,wrS,wrAnchor}),xOf:s=>xOf(s),logicalOf:s=>logicalOf(s),usOpen:d=>usOpenShifted(d)};
const timeOfX=x=>timeOfLogical(chart.timeScale().coordinateToLogical(x-plotLeft()));
function panes(){const o=panes0();if(S.focus)for(let i=1;i<o.length;i++)o[i]=null;return o;}   /* 하단 지표 숨김 중: 다른 패널은 '없는 것'으로 취급(⚙·소제목·구분선·라벨이 안 그려짐) */
function panes0(){
 const sr=stage.getBoundingClientRect(),ps=chart.panes(),out=[];
 for(let i=0;i<ps.length;i++){const el=ps[i].getHTMLElement();   /* 패널을 막 만들거나 지운 직후 한 프레임은 DOM이 없을 수 있음 */
  if(!el){out.push({top:0,h:0,bottom:0});continue;}
  const r=el.getBoundingClientRect();out.push({top:r.top-sr.top,h:r.height,bottom:r.bottom-sr.top});}
 return out;
}
F.paneGeom=panes;

/* ── 하단 지표 숨기기(트레이딩뷰처럼): 빈 곳 더블클릭 → 캔들·종목선이 있는 메인 패널만 전체 높이로 / 다시 더블클릭 → 원래대로 ──
   패널을 지우지 않고 높이 비율만 극단으로 바꿈(최소 높이 규칙을 피해 2px로 접힘) → 데이터·설정·스케일은 그대로 유지 */
function setFocus(on){
 if(!chart)return;on=!!on;if(on===!!S.focus)return;
 const ps=chart.panes();
 try{
  if(on){
   if(ps.length<2)return;
   S.focusSave=ps.map(p=>p.getStretchFactor());
   S.focus=true;
   ps.forEach((p,i)=>p.setStretchFactor(i?1e-6:1e6));
   chart.applyOptions({layout:{panes:{enableResize:false}}});   /* 접힌 상태에서 구분선을 잘못 끌지 않게 */
  }else{
   S.focus=false;
   const sv=S.focusSave||[];S.focusSave=null;
   ps.forEach((p,i)=>p.setStretchFactor(sv[i]>0?sv[i]:(i?1:(ps.length>=3?3:2))));
   chart.applyOptions({layout:{panes:{enableResize:true}}});
  }
 }catch(e){S.focus=false;console.warn("[흐름] 하단지표 숨기기 실패",e);}
 F.redraw();setTimeout(()=>{F.redraw();try{scaleSync();}catch(e){}},80);
}
F.setFocus=setFocus;F.toggleFocus=()=>setFocus(!S.focus);
/* 더블클릭/더블탭이 '빈 곳'인지: 가격축·시간축·구분선·종목 알약·그리기 도구 중이면 제외 */
let focusLock=0;
function focusDbl(cx,cy){
 if(!chart||!chartEl||!stage||F.ui.tool!=="cursor"||S.pillHover)return;
 const now=Date.now();if(now-focusLock<450)return;   /* 같은 동작이 dblclick+더블탭으로 두 번 잡혀도 한 번만 */
 const cr=chartEl.getBoundingClientRect();
 if(cx<cr.left||cx>cr.right||cy<cr.top||cy>cr.bottom)return;
 if(cx>cr.right-plotRW())return;   /* 오른쪽 가격축 = 스케일 자동복귀 더블클릭이라 제외 */
 const sy=cy-stage.getBoundingClientRect().top,pg=panes().filter(Boolean);
 if(!pg.length||sy>pg[pg.length-1].bottom)return;   /* 아래 시간축 */
 for(let i=1;i<pg.length;i++)if(Math.abs(sy-pg[i].top)<9||Math.abs(sy-pg[i-1].bottom)<9)return;   /* 패널 구분선(높이 조절 손잡이) */
 focusLock=now;setFocus(!S.focus);
}

/* ── 데이터 반영 ── */
function buildGrid(){
 const set=new Set();Object.keys(S.data).forEach(t=>S.data[t].t.forEach(x=>set.add(x)));
 S.grid=[...set].sort((a,b)=>a-b);S.gidx=new Map(S.grid.map((v,i)=>[v,i]));
}
function align(){
 const G=S.grid,n=G.length;S.P={};S.U={};S.M={};S.DN={};S.O={};S.H={};S.L={};
 Object.keys(S.data).forEach(t=>{
  const d=S.data[t],P=new Array(n).fill(NaN),U=new Array(n).fill(NaN),M=new Array(n).fill(NaN),DN=new Array(n).fill(NaN),O=new Array(n).fill(NaN),H=new Array(n).fill(NaN),L=new Array(n).fill(NaN);
  let j=0,lp=NaN,lu=NaN,lm=NaN,ld=NaN,lo=NaN,lh=NaN,ll=NaN;
  for(let i=0;i<n;i++){
   while(j<d.t.length&&d.t[j]<=G[i]){lp=d.p[j];lu=d.u[j];lm=d.m?d.m[j]:lu;ld=d.dn?d.dn[j]:lm;lo=d.o?d.o[j]:lp;lh=d.h?d.h[j]:lp;ll=d.l?d.l[j]:lp;j++;}
   if(j>0){P[i]=lp;U[i]=lu;M[i]=lm;DN[i]=ld;O[i]=lo;H[i]=lh;L[i]=ll;}
  }
  S.P[t]=P;S.U[t]=U;S.M[t]=M;S.DN[t]=DN;S.O[t]=O;S.H[t]=H;S.L[t]=L;
 });
}
function tickerPoints(t){
 const P=S.P[t],G=S.grid,o=[],st=1;   /* 화질: 15분봉 디테일을 그대로 그림(솎기 없음). 서버 부담의 주범이던 글로우는 별도로 가볍게 처리함 */
 for(let i=0;i<G.length;i++){if(P[i]===P[i]&&(st===1||i%st===0||i===G.length-1))o.push({time:G[i],value:P[i]});}
 return o;
}
/* ── 캔들 / 하이킨아시 표시 ── 종가선과 같은 데이터(o/h/l/c는 이미 받아둔 캔들에서 %p로 변환됨)를 다르게 그릴 뿐, 추가 요청 없음 */
const CANDLE_COL={candle:{up:"#ff4d5d",dn:"#4fc3ff"},heikin:{up:"#ff4d5d",dn:"#2f6fed"}};   /* 일반=상승빨강/하락하늘색, 하이킨아시=상승빨강/하락파랑 */
function candleRaw(t){const O=S.O[t],H=S.H[t],L=S.L[t],C=S.P[t],G=S.grid,o=[];if(!O)return o;for(let i=0;i<G.length;i++){if(C[i]===C[i])o.push({time:G[i],o:O[i],h:H[i],l:L[i],c:C[i]});}return o;}
function candlePoints(t){return candleRaw(t).map(r=>({time:r.time,open:r.o,high:r.h,low:r.l,close:r.c}));}
function haFrom(raw){const out=[];let po=null,pc=null;
 raw.forEach(r=>{const hc=(r.o+r.h+r.l+r.c)/4,ho=po==null?(r.o+r.c)/2:(po+pc)/2,hh=Math.max(r.h,ho,hc),hl=Math.min(r.l,ho,hc);
  out.push({time:r.time,open:ho,high:hh,low:hl,close:hc});po=ho;pc=hc;});
 return out;
}
function haPoints(t){const raw=candleRaw(t),out=haFrom(raw);if(out.length)S.haOpen[t]=out[out.length-1].open;return out;}
function seriesDataFor(t){const mode=F.ui.candleMode||"line";return mode==="line"?tickerPoints(t):mode==="candle"?candlePoints(t):haPoints(t);}
function addSeriesFor(t,mode){
 if(mode==="line")return chart.addSeries(LW.LineSeries,Object.assign({priceScaleId:"right",lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,priceFormat:PF_P,autoscaleInfoProvider:b=>F.ui.show.clip===false?b():null},styleOf(t)),0);
 const col=CANDLE_COL[mode];
 return chart.addSeries(LW.CandlestickSeries,{priceScaleId:"right",lastValueVisible:false,priceLineVisible:false,priceFormat:PF_P,autoscaleInfoProvider:b=>F.ui.show.clip===false?b():null,upColor:col.up,downColor:col.dn,borderUpColor:col.up,borderDownColor:col.dn,wickUpColor:col.up,wickDownColor:col.dn},0);
}
function ensureSeries(t){
 const mode=F.ui.candleMode||"line";
 if(S.series[t]&&S.seriesMode[t]===mode)return S.series[t];
 if(S.series[t]){try{chart.removeSeries(S.series[t]);}catch(e){}delete S.series[t];}
 S.series[t]=addSeriesFor(t,mode);S.seriesMode[t]=mode;
 topOrder();
 return S.series[t];
}
F.setData=data=>{
 S.data=data;buildGrid();align();S.haOpen={};S.barFresh={};
 F.TICKERS.forEach(t=>{
  if(!S.data[t]){if(S.series[t])S.series[t].setData([]);return;}
  S.barFresh[t]=true;   /* 마지막 봉은 이미 실제 캔들(o/h/l)로 채워져 있음 — 첫 실시간 틱이 이를 평선으로 덮어쓰지 않게 */
  ensureSeries(t).setData(seriesDataFor(t));
 });
 Object.keys(S.series).forEach(t=>{if(!S.data[t]){S.series[t].setData([]);}});
 refreshNow();
 applyScale();
 if(!S.fitted&&S.grid.length>2){S.fitted=true;fitAll();setTimeout(()=>{if(!S.userMoved)fitAll();},250);}
};
/* 표시 방식 전환(선/캔들/하이킨아시) — 이미 받아둔 데이터를 다르게 그리기만 하므로 즉시 반영(재수집 없음) */
F.setCandleMode=mode=>{
 if(F.ui.candleMode===mode)return;
 F.ui.candleMode=mode;
 F.TICKERS.forEach(t=>{if(S.data[t])ensureSeries(t).setData(seriesDataFor(t));});
 restyleNow();refreshNow();   /* 새로 만든 시리즈는 기본 visible=true라 체크 해제·조건검색으로 숨긴 종목도 다시 보이므로 반드시 재적용 */
 F.saveUI&&F.saveUI();
};

const refreshNow=()=>{
 Object.keys(S.series).forEach(t=>{const s=S.series[t];const on=F.ui.show.stocks&&!!F.isVisible(t);if(s.__v!==on){s.__v=on;s.applyOptions({visible:on});}});
 basket();F.redraw();F.onBasket&&F.onBasket();
};
let rvQ=false;
F.refreshVisibility=()=>{if(rvQ)return;rvQ=true;Promise.resolve().then(()=>{rvQ=false;refreshNow();});};   /* 클릭 연타·필터 여러 개 변경도 1회로 묶음 */
F.refreshVisibilityNow=refreshNow;
/* 프레임 전환: 화면을 비우지 않고 새 데이터를 바로 얹기 위해 '전체 맞춤' 상태만 초기화 */
F.beginFrame=()=>{S.fitted=false;S.userMoved=false;};

/* ── 상대강도(거래대금 가중평균 등락률) · 켈트너 상단(가중평균) · 골든/데드 ── */
function basket(){
 const G=S.grid,n=G.length;if(!n||!rsS)return;
 const vis=F.TICKERS.filter(t=>S.P[t]&&F.isVisible(t));
 const w=vis.map(t=>F.ui.weight==="eq"?1:F.weightOf(t));
 const rs=new Array(n),ku=new Array(n),mm=new Array(n),dd=new Array(n);
 for(let i=0;i<n;i++){
  let sw=0,sp=0,su=0,sm=0,sd=0;
  for(let j=0;j<vis.length;j++){const p=S.P[vis[j]][i];if(p===p){sw+=w[j];sp+=w[j]*p;su+=w[j]*S.U[vis[j]][i];sm+=w[j]*S.M[vis[j]][i];sd+=w[j]*S.DN[vis[j]][i];}}
  rs[i]=sw?sp/sw:NaN;ku[i]=sw?su/sw:NaN;mm[i]=sw?sm/sw:NaN;dd[i]=sw?sd/sw:NaN;
 }
 S.rsA=rs;S.kuA=ku;S.mA=mm;S.dA=dd;
 const pts=a=>G.map((g,i)=>a[i]===a[i]?{time:g,value:a[i]}:{time:g});
 rsS.setData(pts(rs));kuS.setData(pts(ku));mS.setData(pts(mm));lowS.setData(pts(dd));updateClip(vis);rs2.setData(pts(rs));ku2.setData(pts(ku));
 indData();
 crosses();
}
/* 눈금 범위: 보이는 종목 값의 1.5~98.5 백분위(+켈상단·중심선·상대강도 전체) — 극단값 종목 몇 개 때문에 나머지가 납작해지지 않게. 칩 '스케일: 이상치 제외'로 끄면 전체 범위 */
function updateClip(vis){
 if(!anchS)return;const G=S.grid,n=G.length;
 if(S.userClipOff===undefined)S.userClipOff=false;
 if(F.ui.show.clip===false||!n){S.clipRange=null;anchS.setData([]);return;}
 const vals=[];vis.forEach(t=>{const P=S.P[t];for(let i=0;i<n;i++){const v=P[i];if(v===v)vals.push(v);}});
 if(vals.length<20){S.clipRange=null;anchS.setData([]);return;}
 vals.sort((a,b)=>a-b);const q=p=>vals[Math.min(vals.length-1,Math.max(0,Math.floor(p*(vals.length-1))))];
 let lo=q(0.015),hi=q(0.985);
 /* 켈상단·중심선·하단선·상대강도 선은 종목 수에 비해 값이 적어 백분위에 묻히므로, 이 선들의 전체 범위는 항상 눈금 안에 포함 */
 [S.rsA,S.kuA,S.mA,S.dA].forEach(a=>{if(a)for(let i=0;i<a.length;i++){const v=a[i];if(v===v){if(v<lo)lo=v;if(v>hi)hi=v;}}});const pad=Math.max(0.3,(hi-lo)*0.08);lo-=pad;hi+=pad;
 S.clipRange={minValue:lo,maxValue:hi};
 anchS.setData([{time:G[0],value:lo},{time:G[n-1],value:hi}]);
}
const ptsOf=a=>S.grid.map((g,i)=>F.num(a[i])?{time:g,value:a[i]}:{time:g});
const upd=(s,tm,v)=>{if(s)s.update(F.num(v)?{time:tm,value:v}:{time:tm});};
const histColor=d=>{const H=F.ui.ind.gap.hist;return rgba(d>=0?H.up:H.dn,H.a);};
/* ── 지표 계산 ──
   EMA: 첫 len개는 단순평균(TradingView 시드와 동일), 그 뒤부터 지수평균. early=true 면 len개가 차기 전에도 '지금까지의 평균'으로 이어 그림 */
function emaArr(a,len,early){
 const n=a.length,out=new Array(n).fill(NaN),k=2/(len+1);let cnt=0,sum=0,prev=NaN;
 for(let i=0;i<n;i++){const v=a[i];if(!F.num(v))continue;
  if(!F.num(prev)||cnt<len){
   if(cnt<len){cnt++;sum+=v;if(cnt===len){prev=sum/len;out[i]=prev;}else if(early)out[i]=sum/cnt;continue;}
  }
  prev=v*k+prev*(1-k);out[i]=prev;}
 return out;
}
/* 윌리엄스 %R = −100 × (구간 최고 − 현재) ÷ (구간 최고 − 구간 최저). 여기서 '가격'은 상대강도선·켈상단선 자체(가중평균 %p)라 고가/저가도 이 선의 값을 씀 */
function wrAt(a,len,i){
 if(i<len-1)return NaN;let hh=-Infinity,ll=Infinity;
 for(let j=i-len+1;j<=i;j++){const v=a[j];if(!F.num(v))return NaN;if(v>hh)hh=v;if(v<ll)ll=v;}
 return hh>ll?-100*(hh-a[i])/(hh-ll):NaN;
}
/* %R 은 14봉 같은 짧은 구간에선 0/−100 에 붙었다 떨어지며 톱니처럼 꺾임 → 결과를 EMA(smooth)로 다듬고 선도 곡선으로 이어붙임 */
const wrSm=()=>Math.max(1,Math.min(30,Math.round(+((F.ui.ind&&F.ui.ind.wr)||{}).smooth||1)));
function wrArr(a,len){const out=new Array(a.length);for(let i=0;i<a.length;i++)out[i]=wrAt(a,len,i);const sm=wrSm();return sm>1?emaArr(out,sm,true):out;}
const srcArr=s=>s==="ku"?S.kuA:S.rsA;
/* 상단 EMA · 하단 W%R · 이격 막대 데이터를 현재 상대강도/켈상단 배열로 다시 계산해 올림 */
function indData(){
 if(!chart||!S.grid.length)return;
 const I=F.ui.ind;
 S.maA=I.ma.lines.map(l=>emaArr(srcArr(I.ma.src),l.len,I.ma.early!==false));
 I.ma.lines.forEach((l,i)=>{const d=ptsOf(S.maA[i]);maS[i].setData(d);maC[i].setData(l.core?d:[]);if(maL[i])maL[i].setData(d);});
 S.wrA=I.wr.lines.map(l=>wrArr(srcArr(l.src),l.len));
 if(wrS.length){I.wr.lines.forEach((l,i)=>wrS[i].setData(ptsOf(S.wrA[i])));
  const G=S.grid;if(G.length>1)wrAnchor.setData([{time:G[0],value:0},{time:G[G.length-1],value:-100}]);}
 if(histS)histS.setData(S.grid.map((g,i)=>{const d=S.rsA[i]-S.kuA[i];return d===d?{time:g,value:+d.toFixed(4),color:histColor(d)}:{time:g};}));
}
/* 실시간 마지막 봉만 갱신 */
function liveInd(li,tm){
 const I=F.ui.ind;
 const fit=a=>{while(a.length<=li)a.push(NaN);return a;};
 I.ma.lines.forEach((l,i)=>{const a=emaArr(srcArr(I.ma.src),l.len,I.ma.early!==false);S.maA[i]=a;const v=a[li];upd(maS[i],tm,v);if(maL[i])upd(maL[i],tm,v);if(l.core)upd(maC[i],tm,v);});
 I.wr.lines.forEach((l,i)=>{const a=fit(S.wrA[i]||(S.wrA[i]=[]));let v=wrAt(srcArr(l.src),l.len,li);const sm=wrSm(),pv=a[li-1];if(sm>1&&F.num(v)&&F.num(pv)){const k=2/(sm+1);v=v*k+pv*(1-k);}a[li]=v;if(wrS[i])upd(wrS[i],tm,v);});
}
/* 윌리엄스 %R 패널: 켜면 3번째 패널과 시리즈를 만들고, 끄면 시리즈를 지워 패널째 없앰(빈 패널이 안 남게) */
function ensureWr(){
 const want=F.ui.show.wr!==false,I=F.ui.ind.wr,lw=F.ui.w.line;
 if(!!wrAnchor===want)return;   /* 이미 원하는 상태면 손대지 않음(패널 높이를 사용자가 끌어 바꾼 걸 유지) */
 if(want){
  const o={priceScaleId:"right",lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,priceFormat:PF_W};
  wrAnchor=chart.addSeries(LW.LineSeries,Object.assign({},o,{color:"rgba(0,0,0,0)",lineWidth:1,autoscaleInfoProvider:()=>({priceRange:{minValue:-100,maxValue:0}})}),2);
  wrS=I.lines.map(l=>chart.addSeries(LW.LineSeries,Object.assign({},o,{color:l.color,lineWidth:l.w||lw,lineStyle:l.style}),2));
  wrPL=[];
  chart.priceScale("right",2).applyOptions({autoScale:true,scaleMargins:{top:0.1,bottom:0.1}});
  if(S.grid.length){indData();applyScale();}
 }else{
  wrS.forEach(s=>{try{chart.removeSeries(s);}catch(e){}});
  try{chart.removeSeries(wrAnchor);}catch(e){}
  wrS=[];wrAnchor=null;wrPL=[];S.wrA=[];
  if(chart.panes().length>2){try{chart.removePane(2);}catch(e){}}
 }
 if(S.focus){S.focus=false;S.focusSave=null;try{chart.applyOptions({layout:{panes:{enableResize:true}}});}catch(e){}}   /* 지표 패널을 늘리거나 줄이면 숨김 상태를 풀고 새 구성으로 */
 const ps=chart.panes();ps[0].setStretchFactor((ps.length>=3?3:2)*(F.SHOT?Math.max(1,(+F.ui.vz||100)/100):1));   /* 촬영 세로 확대: 메인 차트 높이를 N배로(범위는 그대로라 선이 전부 보임) */if(ps[1])ps[1].setStretchFactor(1);if(ps[2])ps[2].setStretchFactor(1);
}
/* 보이는 순서: 종목선 < EMA < 켈상단·상대강도 */
function topOrder(){
 try{maS.forEach((s,i)=>{s.setSeriesOrder(9e5+i*2);maC[i].setSeriesOrder(9e5+i*2+1);});lowS&&lowS.setSeriesOrder(1e6-1);mS&&mS.setSeriesOrder(1e6);kuS.setSeriesOrder(1e6+1);rsS.setSeriesOrder(1e6+2);if(ku2)ku2.setSeriesOrder(1e6+3);if(rs2)rs2.setSeriesOrder(1e6+4);}catch(e){}   /* 하단 이격뷰에서도 상대강도·켈상단이 EMA 위에 */
}
/* 설정(색·굵기·모양·표시)만 반영 — 데이터 재계산 없음 */
function indStyle(){
 if(!chart||!maS.length)return;
 ensureWr();
 const I=F.ui.ind,showMa=F.ui.show.ma!==false;
 try{const hh=Math.min(0.7,Math.max(0.1,+I.gap.hist.h||0.28));chart.priceScale("gapscale",1).applyOptions({scaleMargins:{top:1-hh,bottom:0}});}catch(e){}   /* 이격 막대가 차지하는 높이 */
 I.ma.lines.forEach((l,i)=>{
  const al=(+l.a>0&&+l.a<1)?+l.a:1,mc=al<1?rgba(l.color,al):l.color;   /* 진하기(a)<1 이면 연하게 */
  maS[i].applyOptions(Object.assign({color:mc,lineWidth:l.w,lineStyle:l.style,visible:!!(showMa&&l.on)},DOT()));
  maC[i].applyOptions({color:l.core||"#ffffff",lineWidth:Math.max(1,Math.round(l.w*0.36*10)/10),lineStyle:l.style,visible:!!(showMa&&l.on&&l.core)});
  if(maL[i])maL[i].applyOptions({color:mc,lineWidth:i===4?2.1:1.1,lineStyle:0,pointMarkersVisible:false,visible:!!(F.ui.show.maLow&&l.on)});   /* 얇게(상대강도가 잘 보이게) · 120만 조금 두껍게 · 색은 차트 EMA 와 동일 */
 });
 if(wrAnchor){
  const W=I.wr,lw=F.ui.w.line;
  W.lines.forEach((l,i)=>wrS[i]&&wrS[i].applyOptions(Object.assign({color:l.color,lineWidth:l.w||lw,lineStyle:l.style,lineType:W.curve===false?0:(LW.LineType?LW.LineType.Curved:2),visible:!!l.on},DOT())));
  wrPL.forEach(p=>{try{wrAnchor.removePriceLine(p);}catch(e){}});wrPL=[];
  const pl=(price,color,style)=>wrPL.push(wrAnchor.createPriceLine({price,color,lineWidth:1,lineStyle:style,axisLabelVisible:true,title:""}));
  pl(+W.ob,rgba(W.obColor,.9),2);pl(+W.os,rgba(W.osColor,.9),2);
  if(W.mid)pl((+W.ob+ +W.os)/2,"rgba(140,155,178,.7)",1);
 }
}
/* 설정 팝업에서 값이 바뀔 때마다 호출: 패널 유무 → 스타일 → 데이터 순으로 반영 */
F.applyInd=()=>{
 if(!chart)return;
 F.normInd();
 ensureWr();indStyle();indData();
 restyleNow();F.redraw();F.onBasket&&F.onBasket();
};
/* 골든 = 상대강도가 켈상단을 아래→위로 교차 / 데드 = 위→아래. 잔물결 방지용 히스테리시스(이격 절댓값 분위수 기반) */
function scanCrosses(rs,ku){
 const G=S.grid,n=G.length,d=[];
 for(let i=0;i<n;i++){const v=rs[i]-ku[i];d.push(v===v?v:NaN);}
 const abs=d.filter(v=>v===v).map(Math.abs).sort((a,b)=>a-b);
 /* 확정 기준(eps)=이격 절댓값의 분위수, 신호 간 최소 간격(minGap)으로 잔물결 제거.
    하나도 안 잡히는 프레임(예: 3시간·1분봉)은 기준을 단계적으로 낮춰 다시 시도 */
 const minGap=Math.max(3,Math.round(n/90));
 const scan=q=>{
  const eps=abs.length?Math.min(0.6,Math.max(0.003,abs[Math.floor(abs.length*q)])):0.01;
  const res=[];let state=0,zi=-1;
  const okGap=z=>zi>=0&&(!res.length||z-res[res.length-1].i>=minGap);
  for(let i=1;i<n;i++){
   if(d[i]!==d[i]||d[i-1]!==d[i-1])continue;
   if((d[i-1]<=0&&d[i]>0)||(d[i-1]>=0&&d[i]<0))zi=i;                 /* 실제 교차가 일어난 봉 */
   if(d[i]>eps&&state!==1){if(state===0)state=1;else if(okGap(zi)){res.push({i:zi,type:"golden"});state=1;}}
   else if(d[i]<-eps&&state!==-1){if(state===0)state=-1;else if(okGap(zi)){res.push({i:zi,type:"dead"});state=-1;}}
  }
  return res;
 };
 let out=[];
 for(const q of [0.5,0.3,0.12,0]){out=scan(q);if(out.length)break;}
 return out.map(c=>({i:c.i,time:G[c.i],type:c.type,rs:rs[c.i],ku:ku[c.i]}));
}
/* 켈상단 교차(기존)와 켈 중심선 교차를 각각 계산 */
function crosses(){
 S.crosses=scanCrosses(S.rsA,S.kuA);S.crossesM=scanCrosses(S.rsA,S.mA||[]);
 mk1.setMarkers([]);mk2.setMarkers([]);   /* 화살표·라벨은 오버레이에서 상·하단 패널 모두 직접 그림 */
}

/* ── 실시간: 마지막 봉을 현재가(allMids)로 갱신 ── */
F.live=mids=>{
 const f=frameObj(),bar=f.min*60,G=S.grid;if(!G.length)return 0;
 const nowU=Math.floor(Date.now()/1000),nowS=nowU+KST,last=G[G.length-1];
 /* 새 봉 시작 시각 = 마지막 실제 봉의 시작에서 봉 길이의 배수만큼 전진(3일봉·주봉처럼 시작 기준이 특이한 봉도 맞음) */
 const bucket=f.tick?nowS:Math.max(last,last+Math.floor((nowS-last)/bar)*bar);
 let n=0,newBar=false;
 if(f.tick?bucket-last>=2:bucket>last){
  newBar=true;
  G.push(bucket);S.gidx.set(bucket,G.length-1);
  Object.keys(S.P).forEach(t=>{const lc=S.P[t][S.P[t].length-1];
   S.P[t].push(lc);S.U[t].push(S.U[t][S.U[t].length-1]);S.M[t].push(S.M[t][S.M[t].length-1]);S.DN[t].push(S.DN[t][S.DN[t].length-1]);
   S.O[t].push(lc);S.H[t].push(lc);S.L[t].push(lc);S.barFresh[t]=false;});
  S.rsA.push(S.rsA[S.rsA.length-1]);S.kuA.push(S.kuA[S.kuA.length-1]);S.mA.push(S.mA[S.mA.length-1]);S.dA.push(S.dA[S.dA.length-1]);
 }
 const li=G.length-1,tm=G[li],mode=F.ui.candleMode||"line";
 /* 새 봉이 시작됐으면, 방금 마감된 봉의 확정 OHLC로 하이킨아시 시가(다음 봉의 시가)를 한 번만 갱신해 둠(모드와 무관하게 유지) */
 if(newBar)Object.keys(S.haOpen).forEach(t=>{const i=li-1,pO=S.O[t][i];if(pO===pO)S.haOpen[t]=(S.haOpen[t]+(pO+S.H[t][i]+S.L[t][i]+S.P[t][i])/4)/2;});
 Object.keys(S.data).forEach(t=>{
  const coin=F.coinOf(t),px=coin!=null?+mids[coin]:NaN;if(!(px>0))return;
  const pct=+((px/S.data[t].base-1)*100).toFixed(3);
  if(!S.barFresh[t]){S.O[t][li]=pct;S.H[t][li]=pct;S.L[t][li]=pct;S.barFresh[t]=true;}
  else{if(pct>S.H[t][li])S.H[t][li]=pct;if(pct<S.L[t][li])S.L[t][li]=pct;}
  S.P[t][li]=pct;n++;
  const s=S.series[t];if(!s)return;
  if(mode==="line")s.update({time:tm,value:pct});
  else if(mode==="candle")s.update({time:tm,open:S.O[t][li],high:S.H[t][li],low:S.L[t][li],close:pct});
  else{
   const ho=S.haOpen[t]!=null?S.haOpen[t]:pct,hc=(S.O[t][li]+S.H[t][li]+S.L[t][li]+pct)/4;
   s.update({time:tm,open:ho,high:Math.max(S.H[t][li],ho,hc),low:Math.min(S.L[t][li],ho,hc),close:hc});
  }
 });
 /* 바스켓 마지막 점만 다시 계산 */
 const vis=F.TICKERS.filter(t=>S.P[t]&&F.isVisible(t));let sw=0,sp=0,su=0,sm=0,sd=0;
 vis.forEach(t=>{const p=S.P[t][li];if(p===p){const w=F.ui.weight==="eq"?1:F.weightOf(t);sw+=w;sp+=w*p;su+=w*S.U[t][li];sm+=w*S.M[t][li];sd+=w*S.DN[t][li];}});
 if(sw){const rs=sp/sw,ku=su/sw,mc=sm/sw,dc=sd/sw;S.rsA[li]=rs;S.kuA[li]=ku;S.mA[li]=mc;S.dA[li]=dc;
  rsS.update({time:tm,value:rs});kuS.update({time:tm,value:ku});mS.update(F.num(mc)?{time:tm,value:mc}:{time:tm});lowS.update(F.num(dc)?{time:tm,value:dc}:{time:tm});rs2.update({time:tm,value:rs});ku2.update({time:tm,value:ku});
  if(histS)histS.update({time:tm,value:+(rs-ku).toFixed(4),color:histColor(rs-ku)});
  liveInd(li,tm);
  crosses();}
 F.redraw();F.onBasket&&F.onBasket();
 return n;
};
F.lastValue=t=>{const P=S.P[t];if(!P)return NaN;for(let i=P.length-1;i>=0;i--)if(P[i]===P[i])return P[i];return NaN;};
const autoAll=()=>{chart.panes().forEach((p,i)=>{try{chart.priceScale("right",i).applyOptions({autoScale:true});}catch(e){}});};
/* ── 상하 스케일 고정 · 자동저장 ──
   오른쪽 가격축을 위아래로 끌면(또는 패널 안을 끌어 옮기면) 그 패널은 수동 스케일이 되고, 그 범위를 '이 타임프레임'의 설정으로 자동 저장.
   프레임(기간|봉)마다 %p 범위가 달라서 프레임별로 따로 저장하고, 저장된 게 없는 프레임은 자동 스케일. 축 더블클릭 / '고정' 버튼 = 자동으로 복귀 */
const PN=["main","gap","wr"];
const sApi=i=>chart.priceScale("right",i);
const isManual=i=>{try{return !sApi(i).options().autoScale;}catch(e){return false;}};
function scaleSync(){
 if(!chart||!S.grid.length)return;
 const key=frameObj().key;if(S.scaleFrame!==key)return;   /* 이 프레임 데이터가 아직 안 올라왔으면(옛 프레임 화면) 저장·삭제하지 않음 */
 const all=F.ui.scale||(F.ui.scale={}),cur=all[key]||(all[key]={});let changed=false;
 chart.panes().forEach((p,i)=>{const n=PN[i];if(!n)return;
  if(isManual(i)){const r=sApi(i).getVisibleRange();if(!r)return;
   const v=[+r.from.toFixed(4),+r.to.toFixed(4)],o=cur[n];
   if(!o||Math.abs(o[0]-v[0])>1e-6||Math.abs(o[1]-v[1])>1e-6){cur[n]=v;changed=true;}}
  else if(cur[n]){delete cur[n];changed=true;}});
 if(!Object.keys(cur).length)delete all[key];
 if(changed){F.saveUI&&F.saveUI();}
 F.redraw();
}
/* 프레임/데이터가 바뀔 때: 저장된 범위가 있으면 그대로 복원, 없으면 자동 스케일로 */
/* 촬영: 세로 확대(vz 100~300%) — 자동 눈금 범위를 1/k 로 줄여 종목선이 k배 벌어지게 함. 중심은 보이는 종목 값들의 중앙값(밀집 구간),
   원래 범위 밖으로는 나가지 않게 맞춤. 범위 밖으로 나간 선은 차트 가장자리에서 잘림 */
function vzRange(){
 const k=(+F.ui.vz||100)/100,R=S.clipRange;if(!(k>1)||!R)return null;
 const vals=[];F.TICKERS.forEach(t=>{const P=S.P[t];if(!P||!F.isVisible(t))return;for(let i=0;i<P.length;i++){const v=P[i];if(v===v)vals.push(v);}});
 if(vals.length<20)return null;vals.sort((a,b)=>a-b);
 const c=vals[vals.length>>1],half=(R.maxValue-R.minValue)/2/k;let from=c-half,to=c+half;
 if(from<R.minValue){to+=R.minValue-from;from=R.minValue;}
 if(to>R.maxValue){from-=to-R.maxValue;to=R.maxValue;}
 return [from,to];
}
function applyScale(){
 if(!chart||!S.grid.length)return;
 S.scaleFrame=frameObj().key;
 const cur=Object.assign({},(F.ui.scale||{})[S.scaleFrame]||{});

 chart.panes().forEach((p,i)=>{const n=PN[i];if(!n)return;
  try{const r=cur[n],a=sApi(i);
   if(r){a.setAutoScale(false);a.setVisibleRange({from:r[0],to:r[1]});}
   else if(isManual(i))a.setAutoScale(true);}catch(e){}});
 F.redraw();
}
/* ⚙ 옆 '자동/고정' 버튼: 지금 보이는 범위를 그대로 고정하거나, 고정을 풀고 자동 스케일로 */
F.toggleLock=i=>{
 if(!chart||!chart.panes()[i])return;
 const a=sApi(i);
 if(isManual(i))a.setAutoScale(true);
 else{const r=a.getVisibleRange();if(r){a.setAutoScale(false);a.setVisibleRange({from:r.from,to:r.to});}}
 scaleSync();
};
F.resetView=()=>{S.fitted=false;S.userMoved=false;if(S.grid.length>2){fitAll();autoAll();scaleSync();}};
F.fit=()=>{S.userMoved=false;fitAll();autoAll();scaleSync();};
F.clearData=()=>{S.userMoved=false;S.data={};S.grid=[];S.P={};S.U={};S.M={};S.DN={};S.O={};S.H={};S.L={};S.haOpen={};S.barFresh={};S.crosses=[];S.crossesM=[];S.rsA=[];S.kuA=[];S.mA=[];S.dA=[];S.maA=[];S.wrA=[];S.fitted=false;
 Object.keys(S.series).forEach(t=>S.series[t].setData([]));[rsS,kuS,mS,lowS,anchS,rs2,ku2,wrAnchor].concat(maS,maC,wrS).forEach(s=>s&&s.setData([]));if(histS)histS.setData([]);mk1&&mk1.setMarkers([]);mk2&&mk2.setMarkers([]);F.redraw();};
F.applyFont=()=>{if(!chart)return;chart.applyOptions({layout:{fontSize:Math.round(12*F.scale())}});F.redraw();};

/* ═════════════ 오버레이 ═════════════ */
let dirty=true,lastSig="";
F.redraw=()=>{dirty=true;};
function startLoop(){
 const tick=()=>{
  if(!document.hidden&&chart){
   let sig="";
   try{const lr=chart.timeScale().getVisibleLogicalRange();
    sig=[lr&&lr.from.toFixed(2),lr&&lr.to.toFixed(2),refS.priceToCoordinate(0),refS.priceToCoordinate(10),rs2.priceToCoordinate(rs2?S.rsA[S.rsA.length-1]||0:0),stage.clientWidth,stage.clientHeight,plotRW(),panes().map(p=>p?Math.round(p.top)+":"+Math.round(p.h):"x").join(",")+(S.focus?"F":""),wrAnchor?wrAnchor.priceToCoordinate(-50):0].join("|");}catch(e){}
   if(dirty||sig!==lastSig){lastSig=sig;dirty=false;try{draw();}catch(e){window.__drawErr=e&&e.stack||String(e);if(!F.__warned){F.__warned=1;console.error("[흐름] 오버레이 그리기 오류",e);}}}
  }
  requestAnimationFrame(tick);
 };
 requestAnimationFrame(tick);
}
/* 세션 시각(KST 표시 기준 shifted 초): KR 09:00 = UTC 00:00, US 개장 09:30 ET(서머타임 자동 반영) */
const usCache=new Map();let nyFmt=null;   /* 날짜별 결과·서식 객체 캐시(드래그 중 매 프레임 재생성하면 끊김) */
function usOpenShifted(dayStartUtc){
 if(usCache.has(dayStartUtc))return usCache.get(dayStartUtc);
 let v;
 try{if(!nyFmt)nyFmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",timeZoneName:"shortOffset"});
  const off=nyFmt.formatToParts(new Date((dayStartUtc+13*3600)*1000)).find(p=>p.type==="timeZoneName").value;
  const m=/GMT([+-]\d+)/.exec(off);const h=m?-parseInt(m[1],10):4;
  v=dayStartUtc+(9.5+h)*3600+KST;
 }catch(e){v=dayStartUtc+13.5*3600+KST;}
 usCache.set(dayStartUtc,v);return v;
}
function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function chip(c,text,x,y,o){
 const sc=F.scale(),fs=(o.fs||11)*sc;c.font=(o.bold?"700 ":"600 ")+fs+"px "+FONT;
 const w=c.measureText(text).width+10*sc,h=fs+8*sc;
 const bx=o.center?x-w/2:x,by=o.mid?y-h/2:y;
 roundRect(c,bx,by,w,h,h/2.6);c.fillStyle=o.bg||"rgba(10,14,21,.92)";c.fill();
 if(o.bd){c.lineWidth=1.2;c.strokeStyle=o.bd;c.stroke();}
 c.fillStyle=o.fg||"#dfe6f1";c.textBaseline="middle";c.textAlign="left";c.fillText(text,bx+5*sc,by+h/2+.5);
 return {x:bx,y:by,w,h};
}
/* 상단 차트 / 하단 지표 / 지표 사이 구분: 굵은 띠 + 밝은 경계선 + 가운데 손잡이 점 + 패널마다 다른 은은한 바탕색과 왼쪽 색띠 */
const PANE_TONE=[null,{tint:"rgba(77,163,255,.055)",bar:"#4da3ff"},{tint:"rgba(176,124,255,.06)",bar:"#b07cff"}];
function drawSeparators(pg,W){
 for(let i=1;i<pg.length;i++){const p=pg[i],pv=pg[i-1];if(!p||!pv||p.h<20)continue;
  const T=PANE_TONE[i];
  if(T){ctx.fillStyle=T.tint;ctx.fillRect(0,p.top,W,p.h);ctx.fillStyle=T.bar;ctx.fillRect(0,p.top+4,3,Math.max(0,p.h-8));}
  const y=Math.round((pv.bottom+p.top)/2),bh=8;
  const g=ctx.createLinearGradient(0,y-bh/2,0,y+bh/2);g.addColorStop(0,"#0e1626");g.addColorStop(.5,"#050810");g.addColorStop(1,"#0e1626");
  ctx.fillStyle=g;ctx.fillRect(0,y-bh/2,W,bh);
  ctx.fillStyle="#46659c";ctx.fillRect(0,y-bh/2,W,1);ctx.fillRect(0,y+bh/2-1,W,1);   /* 위·아래 밝은 경계선 */
  const cx=W/2;ctx.fillStyle="#7d97c4";for(let k=-1;k<=1;k++){ctx.beginPath();ctx.arc(cx+k*9,y,1.6,0,6.283);ctx.fill();}   /* 끌어서 높이 조절 가능 표시 */
 }
}
function draw(){
 S.pills=[];
 if(!ctx||!stage)return;
 const dpr=window.devicePixelRatio||1,W=stage.clientWidth,H=stage.clientHeight;
 if(ov.width!==Math.round(W*dpr)||ov.height!==Math.round(H*dpr)){ov.width=Math.round(W*dpr);ov.height=Math.round(H*dpr);ov.style.width=W+"px";ov.style.height=H+"px";}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
 const sc=F.scale(),pg=panes(),p0=pg[0],p1=pg[1],p2=pg[2],pl=plotLeft(),cw=chartEl.clientWidth,plotR=cw-plotRW()-2;
 placeGears(pg,plotR);
 ensureBands(pg);
 {const m=rightMargin();if(m!==S.lastM){S.lastM=m;if(!S.userMoved)fitAll();else try{chart.timeScale().applyOptions({rightOffsetPixels:m});}catch(e){}}}   /* 글씨 크기·알약 켜고 끔·창 폭이 바뀌면 오른쪽 여백도 맞춤 */
 drawSeparators(pg,W);
 if(!S.grid.length)return;
 const vr=chart.timeScale().getVisibleLogicalRange();if(!vr||!p0)return;
 const tL=timeOfLogical(vr.from),tR=timeOfLogical(vr.to);if(tL==null||tR==null)return;
 const yTop=p0.top,yBot1=(p2||p1||p0).bottom;
 ctx.save();ctx.beginPath();ctx.rect(pl,yTop,plotR-pl,yBot1-yTop);ctx.clip();
 /* 각 패널 위쪽 버튼 띠는 배경색으로 비워 둠 — 눈금 밖으로 나간 극단값 선이 ⚙·자동 버튼 밑을 지나가며 어지럽히지 않게 */
 const bandPx=((gearEls&&gearEls.ma&&gearEls.ma.offsetHeight)||34)+10;
 ctx.fillStyle="#0a0e15";[p0,p1,p2].forEach(p=>{if(p&&p.h>70)ctx.fillRect(pl,p.top,plotR-pl,Math.min(bandPx,p.h*0.42));});
 /* 윌리엄스 %R 과매수(−20 위)·과매도(−80 아래) 음영: 위=연한 그린 / 아래=연한 블루, 패널 끝까지 */
 const WR=F.ui.ind.wr;
 if(p2&&wrAnchor&&WR.zones){
  const yo=wrAnchor.priceToCoordinate(+WR.ob),ys=wrAnchor.priceToCoordinate(+WR.os);
  if(yo!=null){ctx.fillStyle=rgba(WR.obColor,WR.zoneA*0.5);ctx.fillRect(pl,p2.top,plotR-pl,Math.max(0,Math.min(p2.h,yo)));}   /* 구간 바탕은 은은하게 — 선이 실제로 들어간 부분은 아래 drawWrFills 가 진하게 */
  if(ys!=null){const y=Math.max(0,Math.min(p2.h,ys));ctx.fillStyle=rgba(WR.osColor,WR.zoneA*0.5);ctx.fillRect(pl,p2.top+y,plotR-pl,p2.h-y);}
  drawWrFills(p2,WR,yo,ys);
 }
 /* 주말 음영: 토 05:00 ~ 월 09:00 (KST) */
 if(F.ui.show.weekend){
  const d0=Math.floor(tL/86400)-1,d1=Math.floor(tR/86400)+1;
  for(let d=d0;d<=d1;d++){const wd=(d+4)%7;   /* shifted 시각은 KST 시계 → 요일 계산: 1970-01-01=목(4) */
   if(wd===6){const a=xOf(d*86400+5*3600),b=xOf((d+2)*86400+9*3600);if(a!=null&&b!=null){ctx.fillStyle="rgba(120,140,190,.07)";ctx.fillRect(a,yTop,b-a,yBot1-yTop);}}}
 }
 /* 세션 세로선 */
 if(F.ui.show.sessions){
  const d0=Math.floor((tL-KST)/86400)-1,d1=Math.floor((tR-KST)/86400)+1;
  for(let d=d0;d<=d1;d++){
   const day=d*86400;
   const kr=day+KST,us=usOpenShifted(day);
   [[kr,"KR 09:00","#ff6b6b"],[us,"US "+F.fmtT(us,false),"#c9d4e6"]].forEach(([s,label,col])=>{
    const x=xOf(s);if(x==null||x<pl||x>plotR)return;
    ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.strokeStyle=rgba(col,.55);
    ctx.beginPath();ctx.moveTo(x+.5,yTop);ctx.lineTo(x+.5,yBot1);ctx.stroke();ctx.setLineDash([]);
    if(pixelsPerBar()*86400/barSec()>110)chip(ctx,label,x,yTop+6,{center:true,fs:10.5,bd:rgba(col,.75),fg:col});
   });
  }
 }
 /* 24시간 전 기준선 */
 if(F.ui.show.h24){
  const s=S.grid[S.grid.length-1]-86400,x=xOf(s);
  if(x!=null&&x>pl&&x<plotR){ctx.lineWidth=2;ctx.strokeStyle="rgba(63,209,255,.85)";ctx.beginPath();ctx.moveTo(x+.5,yTop);ctx.lineTo(x+.5,yBot1);ctx.stroke();
   chip(ctx,"24시간 전 ▶",x,p0.bottom-22*sc,{center:true,fs:11,bd:"#3fd1ff",fg:"#7fe3ff",bold:true});}
 }
 /* 골든/데드 라벨 (메인 패널 상대강도선 위치) */
 if((F.ui.show.cross||F.ui.show.crossBottom)&&S.crosses.length){
  const lastXs=[-1e9,-1e9];
  S.crosses.forEach(c=>{
   const x=xOf(c.time);if(x==null||x<pl||x>plotR)return;
   const gold=c.type==="golden",col=gold?"#31d67b":"#ff5a6e";
   [[rsS,p0,c.rs],[rs2,p1,c.rs]].forEach(([ser,pn,val],k)=>{
    if(!pn||!(k?F.ui.show.crossBottom:F.ui.show.cross))return;const y=ser.priceToCoordinate(val);if(y==null)return;const yy=pn.top+y;
    if(yy<pn.top-4||yy>pn.bottom+4)return;
    /* 화살표(크기: 메인 9, 하단 8) */
    const s=(k?8:9)*sc,dy=gold?s+3:-(s+3);
    ctx.fillStyle=col;ctx.strokeStyle="rgba(8,11,17,.85)";ctx.lineWidth=1.5;ctx.beginPath();
    ctx.moveTo(x,yy+dy);ctx.lineTo(x-s,yy+dy+(gold?s*1.5:-s*1.5));ctx.lineTo(x+s,yy+dy+(gold?s*1.5:-s*1.5));ctx.closePath();ctx.stroke();ctx.fill();
    /* 날짜·시각 라벨: 하단 패널은 종목 알약(11.5)과 비슷한 크기, 패널 안으로 눌러 넣음 */
    if(Math.abs(x-lastXs[k])>(k?150:158)*sc){lastXs[k]=x;
     const txt=(gold?"▲ ":"▼ ")+F.fmtT(c.time),off=(k?30:38)*sc;
     const ly=Math.max(pn.top+14*sc,Math.min(pn.bottom-14*sc,yy+(gold?off:-off)));
     chip(ctx,txt,x,ly,{center:true,mid:true,fs:k?11.5:12.5,bold:true,bg:rgba(gold?"#0f3a25":"#4a1520",.93),bd:col,fg:gold?"#7dffb0":"#ff8c9a"});}
   });
  });
 }
 /* 켈 중심선 골든/데드(속 빈 삼각형 + 하늘색 테두리 '중심' 라벨): 시장(상대강도)이 중심선을 아래→위(골든) / 위→아래(데드)로 넘은 곳 */
 if(F.ui.show.cross&&F.ui.show.mid!==false&&S.crossesM&&S.crossesM.length){
  let lastX=-1e9;
  S.crossesM.forEach(c=>{
   const x=xOf(c.time);if(x==null||x<pl||x>plotR)return;
   const gold=c.type==="golden",col=gold?"#31d67b":"#ff5a6e",y=rsS.priceToCoordinate(c.rs);if(y==null)return;const yy=p0.top+y;
   if(yy<p0.top-4||yy>p0.bottom+4)return;
   const s2=7*sc,dy=gold?s2+3:-(s2+3);
   ctx.strokeStyle=col;ctx.lineWidth=2.2;ctx.beginPath();
   ctx.moveTo(x,yy+dy);ctx.lineTo(x-s2,yy+dy+(gold?s2*1.5:-s2*1.5));ctx.lineTo(x+s2,yy+dy+(gold?s2*1.5:-s2*1.5));ctx.closePath();ctx.stroke();
   if(Math.abs(x-lastX)>150*sc){lastX=x;
    const off=64*sc,ly=Math.max(p0.top+14*sc,Math.min(p0.bottom-14*sc,yy+(gold?off:-off)));
    chip(ctx,"중심 "+(gold?"▲ ":"▼ ")+F.fmtT(c.time),x,ly,{center:true,mid:true,fs:11,bold:true,bg:"rgba(8,40,52,.93)",bd:"#4dd9ff",fg:gold?"#7dffb0":"#ff8c9a"});}
  });
 }
 ctx.restore();
 drawShapes(p0,pl,plotR);
 if(pillsOn()){drawPills(p0,plotR);if(p2&&wrAnchor)drawWrPills(p2,plotR);}   /* 라벨은 차트 안 오른쪽(선 끝과 간격을 둠). 폰처럼 좁으면 생략 */
 /* 소제목: 하단 패널 */
 const narrow=plotR-pl<560;   /* 폰처럼 좁으면 제목을 줄여 ⚙ 버튼과 안 겹치게 */
 if(S.focus)chip(ctx,narrow?"하단 지표 숨김 · 더블클릭=복원":"하단 지표 숨김 중 · 빈 곳을 더블클릭하면 다시 보여요",pl+8,p0.bottom-26*sc,{fs:10.5,fg:"#8fa3c4",bg:"rgba(10,14,21,.78)",bd:"rgba(79,110,168,.6)"});
 if(p1){chip(ctx,narrow?"이격 확대뷰":"이격 확대뷰 · 상대강도 × 켈상단 (자체 스케일)",pl+8,p1.top+6,{fs:11,fg:"#aab6ca",bg:"rgba(10,14,21,.8)"});}
 if(p2&&wrAnchor){
  const on=WR.lines.filter(l=>l.on),lens=[...new Set(on.map(l=>l.len))].sort((a,b)=>a-b),srcs=[...new Set(on.map(l=>l.src))].map(s=>s==="ku"?"켈상단":"상대강도");
  const cap=chip(ctx,"윌리엄스 %R "+(lens.length?lens.join(" / "):"—")+(narrow?"":" · "+(srcs.length?srcs.join(" · "):"선 없음")+" 기준"),pl+8,p2.top+6,{fs:11,fg:"#aab6ca",bg:"rgba(10,14,21,.8)"});
  if(WR.zones){
   const yo=wrAnchor.priceToCoordinate(+WR.ob),ys=wrAnchor.priceToCoordinate(+WR.os),th=(11+8)*sc;
   if(yo!=null&&yo>cap.h+10*sc)chip(ctx,"과매수 구간 · "+WR.ob+" 위",pl+8,p2.top+Math.min(p2.h,yo)-th-4,{fs:10.5,fg:rgba(WR.obColor,1),bg:"rgba(10,14,21,.7)",bd:rgba(WR.obColor,.6)});
   if(ys!=null&&ys<p2.h-th-8)chip(ctx,"과매도 구간 · "+WR.os+" 아래",pl+8,p2.top+Math.max(0,ys)+4,{fs:10.5,fg:rgba(WR.osColor,1),bg:"rgba(10,14,21,.7)",bd:rgba(WR.osColor,.6)});
  }
 }
}
/* 과매수(−20 위)·과매도(−80 아래)로 %R 선이 실제로 넘어간 구간만 선과 기준선 사이를 과매수=그린 / 과매도=블루로 진하게 칠함(넘어가는 지점은 선형 보간) */
function drawWrFills(p2,WR,yo,ys){drawWrFills0(p2,WR,yo,ys);drawWrStrong(p2,WR,yo,ys);}
/* 두 %R 선(14·48)이 "모두" 과매수(−20 위)이거나 "모두" 과매도(−80 아래)인 구간 = 강한 구간 → 기준선 바깥 띠 전체를 다른 색·더 진하게 */
function drawWrStrong(p2,WR,yo,ys){
 const act=[];WR.lines.forEach((l,k)=>{if(l.on&&S.wrA[k]&&wrS[k])act.push(k);});if(act.length<2)return;
 const vr=chart.timeScale().getVisibleLogicalRange();if(!vr||!S.grid.length)return;
 const G=S.grid,i0=Math.max(0,Math.floor(vr.from)-1),i1=Math.min(G.length-1,Math.ceil(vr.to)+1),half=Math.max(1,pixelsPerBar()/2),al=Math.min(0.75,(+WR.zoneA||0.16)*3.4);
 const run=(above,yl,col)=>{if(yl==null)return;ctx.fillStyle=col;const y0=above?p2.top:p2.top+Math.max(0,Math.min(p2.h,yl)),h=above?Math.max(0,Math.min(p2.h,yl)):p2.h-Math.max(0,Math.min(p2.h,yl));let st=-1;
  const flush=en=>{if(st<0)return;const a=xOf(G[st]),b=xOf(G[en]);if(a!=null&&b!=null)ctx.fillRect(a-half,y0,b-a+half*2,h);st=-1;};
  for(let i=i0;i<=i1;i++){const ok=act.every(k=>{const v=S.wrA[k][i];return F.num(v)&&(above?v>+WR.ob:v<+WR.os);});if(ok){if(st<0)st=i;}else flush(i-1);}
  flush(i1);};
 run(true,yo,rgba(WR.obColor2||"#ff5a6e",al));run(false,ys,rgba(WR.osColor2||"#b07cff",al));
}
function drawWrFills0(p2,WR,yo,ys){
 const vr=chart.timeScale().getVisibleLogicalRange();if(!vr||!S.grid.length)return;
 const G=S.grid,i0=Math.max(0,Math.floor(vr.from)-1),i1=Math.min(G.length-1,Math.ceil(vr.to)+1),al=Math.min(0.6,(+WR.zoneA||0.16)*2.6);
 WR.lines.forEach((l,k)=>{const a=S.wrA[k],ser=wrS[k];if(!l.on||!a||!ser)return;
  const part=(lvl,yl,above,col)=>{if(yl==null)return;ctx.fillStyle=col;
   let pts=[],pv=NaN,px=0;
   const flush=()=>{if(pts.length>1){ctx.beginPath();ctx.moveTo(pts[0].x,p2.top+yl);pts.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(pts[pts.length-1].x,p2.top+yl);ctx.closePath();ctx.fill();}pts=[];};
   for(let i=i0;i<=i1;i++){const v=a[i],x0=F.num(v)?xOf(G[i]):null,yv=F.num(v)?ser.priceToCoordinate(v):null;
    if(x0==null||yv==null){flush();pv=NaN;continue;}
    const inn=above?v>lvl:v<lvl,pin=F.num(pv)&&(above?pv>lvl:pv<lvl);
    if(inn){if(!pin&&F.num(pv)){const t=(lvl-pv)/(v-pv);pts.push({x:px+t*(x0-px),y:p2.top+yl});}pts.push({x:x0,y:p2.top+yv});}
    else if(pin){const t=(lvl-pv)/(v-pv);pts.push({x:px+t*(x0-px),y:p2.top+yl});flush();}
    pv=v;px=x0;}
   flush();};
  part(+WR.ob,yo,true,rgba(WR.obColor,al));part(+WR.os,ys,false,rgba(WR.osColor,al));
 });
}
/* 오른쪽 알약: 윌리엄스 %R 각 선의 현재값(겹치면 밀어냄) */
function drawWrPills(p2,plotR){
 const sc=F.scale(),h=22*sc,gap=3,its=[];
 F.ui.ind.wr.lines.forEach((l,i)=>{if(!l.on||!wrS[i])return;const a=S.wrA[i];if(!a)return;
  let v=NaN;for(let j=a.length-1;j>=0;j--)if(F.num(a[j])){v=a[j];break;}
  if(!F.num(v))return;const y=wrS[i].priceToCoordinate(v);if(y==null)return;
  its.push({y:p2.top+y,col:l.color,label:(l.src==="ku"?"켈상단 ":"상대강도 ")+l.len+"  "+v.toFixed(1)});});
 its.sort((a,b)=>a.y-b.y);
 for(let i=0;i<its.length;i++){const py=i?its[i-1].py:-1e9;its[i].py=Math.max(its[i].y,py+h+gap);}
 const lim=p2.top+p2.h-h/2-2;for(let i=its.length-1;i>=0;i--){const nx=i<its.length-1?its[i+1].py-h-gap:lim;its[i].py=Math.min(its[i].py,nx);}
 const colW=pillCol(),x0=plotR-colW,xe=lastX(p2.top);
 its.forEach(p=>{ctx.lineWidth=1;ctx.strokeStyle=rgba(p.col,.5);ctx.beginPath();ctx.moveTo(Math.min(xe,x0-8),p.y);ctx.lineTo(x0-2,p.py);ctx.stroke();
  ctx.fillStyle=p.col;ctx.beginPath();ctx.arc(Math.min(xe,x0-8),p.y,2.4,0,6.283);ctx.fill();
  chip(ctx,p.label,x0,p.py,{mid:true,fs:11.5,bold:true,bg:rgba(p.col,.92),fg:"#0a0e15"});});
}
/* 패널별 톱니바퀴 버튼(⚙) 위치: 각 패널 오른쪽 위 모서리 */
let gearEls=null,lockEls=null;
function placeGears(pg,plotR){
 if(!gearEls){gearEls={fx:document.getElementById("gearFx"),ma:document.getElementById("gearMa"),gap:document.getElementById("gearGap"),wr:document.getElementById("gearWr")};
  lockEls={ma:document.getElementById("lockMain"),gap:document.getElementById("lockGap"),wr:document.getElementById("lockWr")};}
 [["ma",pg[0],0],["gap",pg[1],1],["wr",pg[2],2]].forEach(([k,p,i])=>{
  const el=gearEls[k],lk=lockEls[k];if(!el)return;
  if(!p){el.style.display="none";if(lk)lk.style.display="none";return;}
  el.style.display="flex";const gx=Math.max(0,plotR-(pillsOn()?pillCol()+10:0)-el.offsetWidth-6),top=(p.top+6)+"px";   /* 라벨 열이 차트 안 오른쪽에 있으니 버튼은 그 왼쪽에 */
  if(k==="ma"&&gearEls.fx&&lk){const fx=gearEls.fx;fx.style.display="flex";fx.style.top=top;fx.style.left=Math.max(0,gx-lk.offsetWidth-fx.offsetWidth-12)+"px";}   /* 음영·LED 설정은 '자동/고정' 버튼 왼쪽 */
  el.style.left=gx+"px";el.style.top=top;
  if(lk){lk.style.display="flex";
   const man=isManual(i),txt=man?"🔒 고정":"🔓 자동";   /* 상하 스케일: 수동(고정·자동저장) / 자동 */
   if(lk.__t!==txt){lk.__t=txt;lk.textContent=txt;lk.classList.toggle("on",man);
    lk.title=man?"상하 스케일이 고정돼 있어요(자동저장). 누르면 자동 스케일로 복귀 — 가격축 더블클릭도 같아요":"자동 스케일입니다. 누르면 지금 상하 범위로 고정(자동저장) — 오른쪽 가격축을 위아래로 끌어도 고정돼요";}
   lk.style.left=Math.max(0,gx-lk.offsetWidth-6)+"px";lk.style.top=top;}
 });
}
/* 각 패널 위쪽에 버튼(⚙·자동/고정)·소제목이 앉을 빈 띠를 만든다 — 가격축 위쪽 여백(scaleMargins.top)을 버튼 높이 기준으로 맞춤 */
const BAND={};
function ensureBands(pg){
 if(!gearEls||!gearEls.ma)return;
 const band=(gearEls.ma.offsetHeight||34)+10,BM=[0.08,0.1,0.1];
 pg.forEach((p,i)=>{if(!p||p.h<70)return;
  const top=Math.round(Math.min(0.42,band/p.h)*200)/200;
  if(BAND[i]===top)return;BAND[i]=top;
  try{chart.priceScale("right",i).applyOptions({scaleMargins:{top,bottom:BM[i]!=null?BM[i]:0.1}});}catch(e){}});
}
function pixelsPerBar(){try{return chart.timeScale().options().barSpacing||6;}catch(e){return 6;}}

/* ── 종목이 자기 켈트너 밴드 어디에 있나(마지막 봉 기준): 1=상단 위(돌파) / 2=중심선~상단 / 3=중심선 아래 ── */
function zoneOf(t){
 const P=S.P[t],U=S.U[t],M=S.M[t],N=S.DN[t];if(!P)return 0;
 for(let i=P.length-1;i>=0;i--){if(P[i]===P[i]&&U[i]===U[i]){const m=M&&M[i]===M[i]?M[i]:U[i],d=N&&N[i]===N[i]?N[i]:m;return P[i]>U[i]?1:(P[i]>m?2:(P[i]>d?3:4));}}
 return 0;
}
F.zoneOf=zoneOf;
const ZONE_COL={1:"#31d67b",2:"#ffc233",3:"#ff8a3d",4:"#ff3b6b"},ZONE_TXT={1:"상단 위",2:"중심~상단",3:"중심 아래"};
/* ── 오른쪽 알약 라벨(종목·등락·거래대금) — 겹치지 않게 밀어내고, 너무 많으면 변동 큰 순으로 ──
   · 켈상단선 · 켈 중심선 · 상대강도는 가로로 꽉 찬 굵은 띠(구분선)로 그려서 종목 알약과 확실히 구분
   · 종목 알약 왼쪽 색띠 = 그 종목 자신의 밴드 위치(초록=상단 위 / 노랑=중심~상단 / 빨강=중심 아래) */
/* 마지막 봉의 가로 위치(선 끝) — 라벨과 이어 주는 가는 선의 시작점 */
function lastX(){const G=S.grid;if(!G.length)return 0;const x=xOf(G[G.length-1]);return x==null?0:x;}
function drawPills(p0,plotR){
 const sc=F.scale(),h=22*sc,gap=3,items=[];
 const cnt={1:0,2:0,3:0,4:0};
 F.TICKERS.forEach(t=>{if(!S.series[t]||!F.isVisible(t)||!F.ui.show.stocks)return;const v=F.lastValue(t);if(!(v===v))return;
  const z=zoneOf(t);if(z)cnt[z]++;
  const y=S.series[t].priceToCoordinate(v);if(y==null||y<-20||y>p0.h+20)return;
  if(F.SHOT&&(+F.ui.vz||100)>100&&(y<34*sc||y>p0.h-10*sc))return;   /* 세로 확대로 범위 밖에 나간 종목은 가장자리에 걸친 라벨을 아예 숨김 */
  items.push({t,v,z,y:p0.top+y,col:F.COLORS[t]||"#9aa",label:(F.NAME_KO[t]||t)+" "+F.fmtP(v)+" · "+F.fmtEok(F.ntl[F.ALIAS[t]||t]||0),kind:F.kindOf(t)});});
 const lastRS=S.rsA[S.rsA.length-1],lastKU=S.kuA[S.kuA.length-1],lastM=S.mA?S.mA[S.mA.length-1]:NaN,lastD=S.dA?S.dA[S.dA.length-1]:NaN;
 const spec=[];
 if(F.ui.show.ku&&F.num(lastKU)){const y=kuS.priceToCoordinate(lastKU);if(y!=null)spec.push({t:"__KU",v:lastKU,y:p0.top+y,col:"#f5c542",label:"켈상단선 "+F.fmtP(lastKU)+" ▲"+cnt[1],spec:1});}
 if(F.ui.show.mid!==false&&F.num(lastM)){const y=mS.priceToCoordinate(lastM);if(y!=null)spec.push({t:"__MID",v:lastM,y:p0.top+y,col:"#4dd9ff",label:"중심선 "+F.fmtP(lastM)+" ◆"+cnt[2]+" ▽"+cnt[3],spec:1});}
 if(F.ui.show.low!==false&&F.num(lastD)){const y=lowS.priceToCoordinate(lastD);if(y!=null)spec.push({t:"__LOW",v:lastD,y:p0.top+y,col:"#f5c542",label:"하단선 "+F.fmtP(lastD)+" ▼"+cnt[4],spec:1});}
 if(F.ui.show.rs&&F.num(lastRS)){const y=rsS.priceToCoordinate(lastRS);if(y!=null)spec.push({t:"__RS",v:lastRS,y:p0.top+y,col:"#ffffff",label:"상대강도 "+F.fmtP(lastRS),spec:1});}
 const maxN=Math.max(4,Math.floor((p0.h-8)/(h+gap)));
 if(F.mode()==="kel")items.sort((a,b)=>F.weightOf(b.t)-F.weightOf(a.t));else items.sort((a,b)=>Math.abs(b.v)-Math.abs(a.v));
 const keep=items.slice(0,Math.max(0,maxN-spec.length));
 const all=keep.concat(spec).sort((a,b)=>a.y-b.y);
 /* 위→아래로 겹침 해소 후, 아래에서 다시 위로 눌러 경계 안에 넣음 */
 for(let i=0;i<all.length;i++){const py=i?all[i-1].py:-1e9;all[i].py=Math.max(all[i].y,py+h+gap);}
 const lim=p0.top+p0.h-h/2-2;for(let i=all.length-1;i>=0;i--){const nx=i<all.length-1?all[i+1].py-h-gap:lim;all[i].py=Math.min(all[i].py,nx);}
 const colW=pillCol(),x0=plotR-colW,xe=Math.min(lastX(),x0-8);
 all.forEach(p=>{
  ctx.lineWidth=1;ctx.strokeStyle=rgba(p.col,.5);ctx.beginPath();ctx.moveTo(xe,p.y);ctx.lineTo(x0-2,p.py);ctx.stroke();
  ctx.fillStyle=p.col;ctx.beginPath();ctx.arc(xe,p.y,2.4,0,6.283);ctx.fill();   /* 선 끝 점 */
  if(p.spec){
   /* 구분 띠: 알약 열 전체 폭 + 위아래 굵은 선 */
   const bw=Math.max(60,colW-4),by=p.py-h/2-1,bh=h+2;
   ctx.fillStyle=rgba(p.col,.97);roundRect(ctx,x0,by,bw,bh,bh/4);ctx.fill();
   ctx.lineWidth=2;ctx.strokeStyle="rgba(255,255,255,.85)";ctx.beginPath();ctx.moveTo(x0,by);ctx.lineTo(x0+bw,by);ctx.moveTo(x0,by+bh);ctx.lineTo(x0+bw,by+bh);ctx.stroke();
   const fs=12.5*sc;ctx.font="800 "+fs+"px "+FONT;ctx.fillStyle="#0a0e15";ctx.textBaseline="middle";ctx.textAlign="left";
   let txt="━ "+p.label;while(txt.length>6&&ctx.measureText(txt).width>bw-8*sc)txt=txt.slice(0,-1);
   ctx.fillText(txt,x0+6*sc,p.py+.5);
   return;}
  const big=p.kind!=="stock";
  const hv=S.hover===p.t,dimmed=!!S.hover&&!hv;
  let lab=p.label;{const fs0=(big?12.5:11.5)*sc;ctx.font="700 "+fs0+"px "+FONT;while(lab.length>6&&ctx.measureText(lab).width>colW-22*sc)lab=lab.slice(0,-1);}   /* 열 폭을 넘으면 뒤를 자름 */
  const r=chip(ctx,lab,x0+5*sc,p.py,{mid:true,fs:(big?12.5:11.5)+(hv?1:0),bold:true,bg:rgba(p.col,hv?1:(dimmed?.4:.88)),fg:"#0a0e15",bd:hv?"#ffffff":(big?"rgba(255,255,255,.55)":null)});
  S.pills.push({t:p.t,x:r.x,y:r.y,w:r.w,h:r.h});
  if(p.z){ctx.fillStyle=ZONE_COL[p.z];roundRect(ctx,x0,r.y,4*sc,r.h,2*sc);ctx.fill();}   /* 왼쪽 색띠 = 자기 밴드 위치 */
 });
}

/* ═════════════ 그리기 도구: 선 · 사각형 · 원 (등락률 실측 표시) ═════════════ */
let drawing=null;
const shapes=()=>F.ui.draw[F.ui.frame]||(F.ui.draw[F.ui.frame]=[]);
const pt2xy=p=>{const x=xOf(p.t),pn=panes()[0],y=refS.priceToCoordinate(p.v);return x==null||y==null?null:{x,y:pn.top+y};};
function xy2pt(x,y){const pn=panes()[0];const t=timeOfX(x),v=refS.coordinateToPrice(y-pn.top);return t==null||v==null?null:{t,v};}
function shapeLabel(a,b){
 const dv=b.v-a.v,real=((100+b.v)/(100+a.v)-1)*100;
 return F.fmtP(dv)+"  (실제 "+(real>=0?"+":"")+real.toFixed(2)+"%)  ·  "+F.fmtDur(b.t-a.t);
}
function drawShapes(p0,pl,plotR){
 const list=shapes().concat(drawing?[drawing]:[]);if(!list.length)return;
 ctx.save();ctx.beginPath();ctx.rect(pl,p0.top,plotR-pl,p0.h);ctx.clip();
 list.forEach(s=>{
  const A=pt2xy(s.a),B=pt2xy(s.b);if(!A||!B)return;
  const up=s.b.v>=s.a.v,col=up?"#31d67b":"#ff5a6e";
  ctx.lineWidth=2;ctx.strokeStyle=col;ctx.fillStyle=rgba(col,.14);
  if(s.type==="rect"){ctx.beginPath();ctx.rect(Math.min(A.x,B.x),Math.min(A.y,B.y),Math.abs(B.x-A.x),Math.abs(B.y-A.y));ctx.fill();ctx.stroke();}
  else if(s.type==="ellipse"){ctx.beginPath();ctx.ellipse((A.x+B.x)/2,(A.y+B.y)/2,Math.abs(B.x-A.x)/2||1,Math.abs(B.y-A.y)/2||1,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
  else{ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
   [A,B].forEach(q=>{ctx.fillStyle="#0a0e15";ctx.beginPath();ctx.arc(q.x,q.y,4,0,7);ctx.fill();ctx.stroke();});}
  const lx=(A.x+B.x)/2,ly=Math.min(A.y,B.y)-16*F.scale();
  chip(ctx,shapeLabel(s.a,s.b),lx,Math.max(p0.top+14,ly),{center:true,mid:true,fs:12,bold:true,bg:rgba(up?"#0f3a25":"#4a1520",.94),bd:col,fg:up?"#7dffb0":"#ff8c9a"});
 });
 ctx.restore();
}
function hitShape(x,y){
 const l=shapes();
 for(let i=l.length-1;i>=0;i--){const s=l[i],A=pt2xy(s.a),B=pt2xy(s.b);if(!A||!B)continue;
  if(s.type==="line"){const dx=B.x-A.x,dy=B.y-A.y,L=dx*dx+dy*dy||1;let u=((x-A.x)*dx+(y-A.y)*dy)/L;u=Math.max(0,Math.min(1,u));if(Math.hypot(x-(A.x+u*dx),y-(A.y+u*dy))<9)return i;}
  else if(x>=Math.min(A.x,B.x)-4&&x<=Math.max(A.x,B.x)+4&&y>=Math.min(A.y,B.y)-4&&y<=Math.max(A.y,B.y)+4)return i;}
 return -1;
}
F.setTool=t=>{F.ui.tool=t;if(!ov)return;ov.style.pointerEvents=t==="cursor"?"none":"auto";ov.style.cursor=t==="erase"?"not-allowed":"crosshair";drawing=null;F.redraw();F.onTool&&F.onTool(t);};
F.clearShapes=()=>{F.ui.draw[F.ui.frame]=[];F.saveUI&&F.saveUI();F.redraw();};
F.undoShape=()=>{shapes().pop();F.saveUI&&F.saveUI();F.redraw();};
F.bindDrawing=()=>{
 const pos=e=>{const r=ov.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 ov.addEventListener("pointerdown",e=>{
  if(F.ui.tool==="cursor")return;const {x,y}=pos(e);
  if(F.ui.tool==="erase"){const i=hitShape(x,y);if(i>=0){shapes().splice(i,1);F.saveUI&&F.saveUI();F.redraw();}return;}
  const p=xy2pt(x,y);if(!p)return;ov.setPointerCapture(e.pointerId);
  drawing={type:F.ui.tool,a:p,b:p};F.redraw();
 });
 ov.addEventListener("pointermove",e=>{if(!drawing)return;const {x,y}=pos(e);const p=xy2pt(x,y);if(p){drawing.b=p;F.redraw();}});
 ov.style.touchAction="none";                       /* 폰에서 그리자마자 드래그가 멈추던 원인: 브라우저가 제스처를 가져가 pointercancel 발생 */
 ov.addEventListener("touchstart",e=>{if(F.ui.tool!=="cursor")e.preventDefault();},{passive:false});
 ov.addEventListener("touchmove",e=>{if(F.ui.tool!=="cursor")e.preventDefault();},{passive:false});
 ov.addEventListener("pointercancel",e=>{if(!drawing)return;const s=drawing;drawing=null;const A=pt2xy(s.a),B=pt2xy(s.b);if(A&&B&&Math.hypot(A.x-B.x,A.y-B.y)>6){shapes().push(s);F.saveUI&&F.saveUI();}F.redraw();});
 ov.addEventListener("pointerup",e=>{
  if(!drawing)return;const s=drawing;drawing=null;
  const A=pt2xy(s.a),B=pt2xy(s.b);
  if(A&&B&&Math.hypot(A.x-B.x,A.y-B.y)>6){shapes().push(s);F.saveUI&&F.saveUI();}
  F.redraw();
 });
 window.addEventListener("keydown",e=>{
  if(e.key==="Escape"){drawing=null;F.setTool("cursor");}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){F.undoShape();e.preventDefault();}
 });
};
})();
