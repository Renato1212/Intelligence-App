/**
 * The "Edge Capture" bookmarklet v4 — runs inside the logged-in platform
 * page (Trader One or any web journal) and captures trade data every way
 * it can, continuously, for the whole recording session:
 *
 *  1. NETWORK — wraps fetch AND XMLHttpRequest AND WebSocket. Every JSON-
 *     shaped response the page downloads, and every text frame streamed
 *     over a WebSocket opened after recording starts, is recorded. (Trading
 *     platforms stream positions/orders/fills over WebSocket, and load a
 *     trade's individual fills on demand when you open it — so the recorder
 *     must catch on-interaction traffic, not just the initial page load.)
 *  2. DOM tables — native <table> and ARIA role=table/grid React grids,
 *     including same-origin iframes.
 *  3. Div-grids — a header-row heuristic for custom grids built from divs.
 *
 * (2) and (3) re-scan on an 800ms timer and MERGE newly-seen rows into an
 * accumulator, so virtualized/expandable views are captured as you scroll
 * or open trades. The gold badge shows live counts so a stuck capture is
 * obvious. It NEVER clicks anything itself — on a live trading platform,
 * only the trader touches the controls.
 *
 * Everything runs in the user's own browser session — no credentials or
 * data are sent anywhere.
 */
const SRC = `(function(){try{
if(window.__edgeCap){window.__edgeCap.finish();return;}
var SEP=String.fromCharCode(1);
function txt(el){return ((el&&el.innerText)||'').replace(/\\s+/g,' ').trim();}
var state={reqs:[],ws:[],acc:{},scans:0,hooked:0,loose:[],looseSeen:{},frames:[]};
function looksJson(s){if(!s)return false;var t=s.replace(/^\\uFEFF/,'').trimStart();return t.charAt(0)==='{'||t.charAt(0)==='[';}
function pushReq(u,s){try{if(looksJson(s)&&s.length<4000000&&state.reqs.length<400)state.reqs.push({url:String(u||''),body:s});}catch(e){}}
function pushWs(u,d){try{if(typeof d==='string'&&d.length<2000000&&state.ws.length<2000)state.ws.push({url:String(u||''),body:d});}catch(e){}}
var OFETCH=window.fetch;
// Hook the network APIs of a JS realm. Trading apps like Trader One run the
// whole UI inside same-origin iframes, so the WebSocket that streams fills
// and the XHR/fetch that load a trade's executions live in the IFRAME's
// realm — patching only the top window (which we used to do) captured
// nothing. We patch every reachable realm and re-run for late/added frames.
function hookRealm(win){try{
if(!win||win.__ecHooked)return;win.__ecHooked=true;state.hooked++;
try{var OF=win.fetch;if(OF){win.fetch=function(){var a=arguments;var u=(typeof a[0]==='string')?a[0]:((a[0]&&a[0].url)||'');var p=OF.apply(this,a);
try{p.then(function(r){try{r.clone().text().then(function(s){pushReq(u,s);}).catch(function(){});}catch(e){}}).catch(function(){});}catch(e){}return p;};}}catch(e){}
try{var XP=win.XMLHttpRequest&&win.XMLHttpRequest.prototype;if(XP&&!XP.__ecHooked){XP.__ecHooked=true;var OO=XP.open,OS=XP.send;
XP.open=function(m,u){try{this.__ec=String(u||'');}catch(e){}return OO.apply(this,arguments);};
XP.send=function(){var x=this;try{x.addEventListener('load',function(){try{var s=(x.responseType===''||x.responseType==='text')?x.responseText:(x.responseType==='json'?JSON.stringify(x.response):'');pushReq(x.__ec,s);}catch(e){}});}catch(e){}return OS.apply(this,arguments);};}}catch(e){}
try{var OWS=win.WebSocket;if(OWS){var NWS=function(url,protos){var ws=(arguments.length>1)?new OWS(url,protos):new OWS(url);
try{ws.addEventListener('message',function(ev){try{pushWs(url,ev.data);}catch(e){}});}catch(e){}return ws;};
try{NWS.prototype=OWS.prototype;NWS.CONNECTING=OWS.CONNECTING;NWS.OPEN=OWS.OPEN;NWS.CLOSING=OWS.CLOSING;NWS.CLOSED=OWS.CLOSED;}catch(e){}
try{win.WebSocket=NWS;}catch(e){}}}catch(e){}
try{var OES=win.EventSource;if(OES){var NES=function(url,cfg){var es=(arguments.length>1)?new OES(url,cfg):new OES(url);
try{es.addEventListener('message',function(ev){try{pushWs(url,ev.data);}catch(e){}});}catch(e){}return es;};
try{NES.prototype=OES.prototype;}catch(e){}try{win.EventSource=NES;}catch(e){}}}catch(e){}
}catch(e){}}
function hookFrames(){try{var ifr=document.querySelectorAll('iframe');for(var i=0;i<ifr.length;i++){try{hookRealm(ifr[i].contentWindow);}catch(e){}}}catch(e){}}
hookRealm(window);hookFrames();
function docsList(){var out=[document],cross=0,ifr=document.querySelectorAll('iframe');
for(var i=0;i<ifr.length;i++){try{var d=ifr[i].contentDocument;if(d&&d.body)out.push(d);else cross++;}catch(e){cross++;}}
return{docs:out,cross:cross};}
function mergeTable(headers,rows,rowImages){
if(!headers||!headers.length||!rows||!rows.length)return;
var sig=headers.join('|').toLowerCase();
var entry=state.acc[sig];
if(!entry){entry={headers:headers,order:[],rowMap:{},imgMap:{}};state.acc[sig]=entry;}
var imgByRow={};
for(var i=0;i<(rowImages||[]).length;i++){var ri=rowImages[i].row;if(!imgByRow[ri])imgByRow[ri]=[];imgByRow[ri].push(rowImages[i].src);}
for(var r=0;r<rows.length;r++){
var key=rows[r].join(SEP);
if(!(key in entry.rowMap)){if(entry.order.length<8000){entry.rowMap[key]=rows[r];entry.order.push(key);}}
if(imgByRow[r]){if(!entry.imgMap[key])entry.imgMap[key]=[];
for(var ii=0;ii<imgByRow[r].length;ii++){var src=imgByRow[r][ii];if(entry.imgMap[key].indexOf(src)<0)entry.imgMap[key].push(src);}}}}
var HW=/date|day|time|open|close|entry|exit|qty|quantity|size|side|direction|symbol|inst|market|contract|ticker|p&l|pnl|profit|net|gross|result|outcome|amount|tag|category|note|description|comment|risk|account|duration|strategy|setup|win|loss|video|link|fill|order|price|avg|status/i;
function scanDoc(doc,merge){
var tables=doc.querySelectorAll('table');
for(var i=0;i<tables.length;i++){var t=tables[i];var hr=(t.tHead&&t.tHead.rows[0])||t.rows[0];if(!hr)continue;
var h=[];for(var j=0;j<hr.cells.length;j++)h.push(txt(hr.cells[j]));
var rows=[],imgs=[];var body=(t.tBodies.length&&t.tBodies[0].rows.length)?t.tBodies[0].rows:t.rows;
for(var r=0;r<body.length;r++){var row=body[r];if(row===hr)continue;var cs=[];
for(var c=0;c<row.cells.length;c++)cs.push(txt(row.cells[c]));var ri=rows.length;rows.push(cs);
var ims=row.querySelectorAll('img');for(var k=0;k<ims.length;k++)if(ims[k].src)imgs.push({row:ri,src:ims[k].src});}
if(h.length>1&&rows.length)merge(h,rows,imgs);}
var grids=doc.querySelectorAll('[role=table],[role=grid],[role=treegrid]');
for(var g=0;g<grids.length;g++){if(grids[g].querySelector('table'))continue;
var rws=grids[g].querySelectorAll('[role=row]');if(rws.length<2)continue;
var cellsOf=function(rw){var cs=rw.querySelectorAll('[role=columnheader],[role=gridcell],[role=cell]');var o=[];for(var x=0;x<cs.length;x++)o.push(txt(cs[x]));return o;};
var h2=cellsOf(rws[0]);var rows2=[],imgs2=[];
for(var r2=1;r2<rws.length;r2++){var ri2=rows2.length;rows2.push(cellsOf(rws[r2]));
var ims2=rws[r2].querySelectorAll('img');for(var k2=0;k2<ims2.length;k2++)if(ims2[k2].src)imgs2.push({row:ri2,src:ims2[k2].src});}
if(h2.length>1&&rows2.length)merge(h2,rows2,imgs2);}
var cand=doc.querySelectorAll('div,span,li,p');var byParent=[];
for(var q=0;q<cand.length&&q<20000;q++){var e=cand[q];if(e.children.length)continue;var tv=txt(e);
if(tv&&tv.length<26&&HW.test(tv)){var pp=e.parentElement;if(!pp)continue;
var f=null;for(var b2=0;b2<byParent.length;b2++)if(byParent[b2].p===pp){f=byParent[b2];break;}
if(!f){f={p:pp,n:0};byParent.push(f);}f.n++;}}
for(var w=0;w<byParent.length;w++){if(byParent[w].n<3)continue;var head=byParent[w].p;var cont=head.parentElement;if(!cont)continue;
var hs=[];for(var hc=0;hc<head.children.length;hc++)hs.push(txt(head.children[hc]));
if(hs.length<3)continue;var rows3=[],imgs3=[];
for(var rc=0;rc<cont.children.length;rc++){var ch=cont.children[rc];if(ch===head)continue;
if(ch.children.length<2)continue;var cs3=[];for(var cc=0;cc<ch.children.length;cc++)cs3.push(txt(ch.children[cc]));
if(!cs3.some(function(x){return x;}))continue;var ri3=rows3.length;rows3.push(cs3);
var ims3=ch.querySelectorAll('img');for(var k3=0;k3<ims3.length;k3++)if(ims3[k3].src)imgs3.push({row:ri3,src:ims3[k3].src});}
if(rows3.length)merge(hs,rows3,imgs3);}}
// Loose scan — capture EVERY repeated multi-cell row structure, regardless of
// header keywords, as long as it contains price-like numbers. This grabs a
// fills/executions panel even when its layout doesn't match the table
// heuristics above (custom divs, no header row). The app filters real fills
// out of these by shape; non-fill rows are harmless.
function priceish(s){return /\\d{2,7}([.,]\\d{1,4})?/.test(s);}
function scanLoose(doc){
var all=doc.querySelectorAll('div,ul,ol,tbody,section');
for(var i=0;i<all.length&&i<15000;i++){var cont=all[i];var kids=cont.children;if(!kids||kids.length<3)continue;
var rowEls=[];for(var k=0;k<kids.length;k++){var ch=kids[k];if(ch.children&&ch.children.length>=2)rowEls.push(ch);}
if(rowEls.length<3)continue;var rows=[],withPrice=0;
for(var r=0;r<rowEls.length&&r<500;r++){var cells=[];var cc=rowEls[r].children;
for(var c=0;c<cc.length;c++){var tv=txt(cc[c]);if(tv&&tv.length<=44)cells.push(tv);}
if(cells.length<3)continue;if(priceish(cells.join(' ')))withPrice++;rows.push(cells);}
if(rows.length<3||withPrice<2)continue;
for(var rr=0;rr<rows.length;rr++){var key=rows[rr].join(SEP);if(!state.looseSeen[key]&&state.loose.length<4000){state.looseSeen[key]=1;state.loose.push(rows[rr]);}}}}
function totalRows(){var n=0;for(var k in state.acc)n+=state.acc[k].order.length;return n;}
function updateBadge(){var el=document.getElementById('__edgecapbadge');if(!el)return;
el.innerHTML='&#9210; <b>Edge Capture recording</b><br>'+totalRows()+' table row(s) · '+state.reqs.length+' API · '+state.ws.length+' stream · '+state.loose.length+' loose<br>Open your trade log AND click into individual trades so their fills show, then <u>click here to finish</u>.';}
function runScan(){hookFrames();var d=docsList();for(var i=0;i<d.docs.length;i++){try{scanDoc(d.docs[i],mergeTable);}catch(e){}try{scanLoose(d.docs[i]);}catch(e){}}state.lastCross=d.cross;state.scans++;updateBadge();}
var timer=setInterval(runScan,800);
runScan();
function finish(){var w=window.__edgeCap;if(w&&w.done)return;if(w)w.done=true;
clearInterval(timer);
runScan();
try{var fd=docsList();for(var fi=0;fi<fd.docs.length&&state.frames.length<6;fi++){try{var fdoc=fd.docs[fi];
var ftxt=(fdoc.body?fdoc.body.innerText:'').replace(/\\s+/g,' ').slice(0,120000);
state.frames.push({url:(fdoc.location&&fdoc.location.href)||(fi===0?location.href:'frame'+fi),text:ftxt});}catch(e){}}}catch(e){}
var tbls=[];
for(var sig in state.acc){var entry=state.acc[sig];var rows=[],rowImages=[];
for(var i=0;i<entry.order.length;i++){var key=entry.order[i];rows.push(entry.rowMap[key]);
var imgs=entry.imgMap[key];if(imgs)for(var j=0;j<imgs.length;j++)rowImages.push({row:i,src:imgs[j]});}
tbls.push({headers:entry.headers,rows:rows,rowImages:rowImages});}
var accRows=0;for(var ti0=0;ti0<tbls.length;ti0++)accRows+=tbls[ti0].rows.length;
var diag={tables:document.querySelectorAll('table').length,ariaGrids:document.querySelectorAll('[role=table],[role=grid]').length,
iframes:document.querySelectorAll('iframe').length,crossOriginFrames:state.lastCross||0,canvases:document.querySelectorAll('canvas').length,
flutter:!!(window._flutter||window.flutterCanvasKit),react:!!document.querySelector('[data-reactroot],#root,#app'),
jsonResponses:state.reqs.length,wsFrames:state.ws.length,realmsHooked:state.hooked,looseRows:state.loose.length,framesCaptured:state.frames.length,scans:state.scans,accumulatedTables:tbls.length,accumulatedRows:accRows,
textSample:(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1500)};
var payload={source:'edge-capture',version:6,url:location.href,title:document.title,capturedAt:new Date().toISOString(),
tables:tbls,requests:state.reqs,ws:state.ws,loose:state.loose,frames:state.frames,diagnostics:diag};
var el=document.getElementById('__edgecapbadge');if(el)el.remove();
var doDl=function(){var s=JSON.stringify(payload);
try{var b=new Blob([s],{type:'application/json'});var a=document.createElement('a');
a.href=URL.createObjectURL(b);a.download='edge-capture-'+new Date().toISOString().slice(0,10)+'.json';
document.body.appendChild(a);a.click();a.remove();}catch(e){}
try{var cp=navigator.clipboard.writeText(s);if(cp&&cp.catch)cp.catch(function(){});}catch(e){}
alert('Edge Capture finished: '+accRows+' table row(s), '+state.reqs.length+' API response(s), '+state.ws.length+' stream message(s). File downloaded (and copied to clipboard) - import it in Edge Intelligence. To get per-fill detail you must OPEN individual trades while recording so their fills load.');
window.__edgeCap=null;};
var pend=0,cnt=0,fin2=false,MAX=60;var done2=function(){if(fin2)return;fin2=true;doDl();};
for(var ti=0;ti<tbls.length;ti++){var rims=tbls[ti].rowImages||[];
for(var ii=0;ii<rims.length;ii++){(function(rec){if(cnt>=MAX)return;cnt++;pend++;
(OFETCH||window.fetch)(rec.src).then(function(r){return r.blob();}).then(function(bl){return new Promise(function(res){var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.readAsDataURL(bl);});}).then(function(du){rec.dataUrl=du;}).catch(function(){}).then(function(){pend--;if(pend<=0)done2();});})(rims[ii]);}}
if(pend<=0)done2();}
window.__edgeCap={finish:finish,done:false};
var bg=document.createElement('div');bg.id='__edgecapbadge';
bg.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#c9a227;color:#141210;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:9px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.45);max-width:300px';
bg.onclick=finish;
if(document.body)document.body.appendChild(bg);
updateBadge();
}catch(e){alert('Edge Capture error: '+e.message);}})();`;

export function bookmarkletHref(): string {
  return `javascript:${encodeURIComponent(SRC)}`;
}

export function bookmarkletCode(): string {
  return `javascript:${SRC}`;
}
