/**
 * The "Edge Capture" bookmarklet v2 — runs inside the logged-in platform
 * page (Trader One or any web journal) and captures trade data three ways:
 *
 *  1. NETWORK RECORDING — intercepts the JSON responses the page itself
 *     downloads (fetch + XHR). This works even when the app renders to
 *     canvas (e.g. Flutter) and has no readable DOM at all. Click the
 *     bookmarklet once → a gold "recording" badge appears → browse the
 *     trade log so the data loads → click the badge to finish.
 *  2. DOM tables — native <table> and ARIA role=table/grid React grids,
 *     including same-origin iframes.
 *  3. Div-grids — header-row heuristics for custom grids built from divs.
 *
 * The capture file also embeds diagnostics (framework hints, element
 * counts, a text sample) so unsupported layouts can be debugged from the
 * file alone. Everything runs in the user's own browser session — no
 * credentials or data are sent anywhere.
 */
const SRC = `(function(){try{
if(window.__edgeCap){window.__edgeCap.finish();return;}
function txt(el){return ((el&&el.innerText)||'').replace(/\\s+/g,' ').trim();}
var state={reqs:[]};
var OF=window.fetch;
if(OF){window.fetch=function(){var a=arguments;var u=(typeof a[0]==='string')?a[0]:((a[0]&&a[0].url)||'');var p=OF.apply(this,a);
p.then(function(r){try{var ct=(r.headers&&r.headers.get('content-type'))||'';if(ct.indexOf('json')<0)return;
r.clone().text().then(function(s){if(s&&s.length<3000000&&state.reqs.length<80)state.reqs.push({url:String(u),body:s});}).catch(function(){});}catch(e){}}).catch(function(){});
return p;};}
var OO=XMLHttpRequest.prototype.open,OS=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){this.__ec=String(u||'');return OO.apply(this,arguments);};
XMLHttpRequest.prototype.send=function(){var x=this;x.addEventListener('load',function(){try{
var ct=x.getResponseHeader('content-type')||'';if(ct.indexOf('json')<0)return;
var s=(x.responseType===''||x.responseType==='text')?x.responseText:(x.responseType==='json'?JSON.stringify(x.response):'');
if(s&&s.length<3000000&&state.reqs.length<80)state.reqs.push({url:x.__ec||'',body:s});}catch(e){}});
return OS.apply(this,arguments);};
function docsList(){var out=[document],cross=0,ifr=document.querySelectorAll('iframe');
for(var i=0;i<ifr.length;i++){try{var d=ifr[i].contentDocument;if(d&&d.body)out.push(d);else cross++;}catch(e){cross++;}}
return{docs:out,cross:cross};}
function scanDoc(doc,tbls){
var tables=doc.querySelectorAll('table');
for(var i=0;i<tables.length;i++){var t=tables[i];var hr=(t.tHead&&t.tHead.rows[0])||t.rows[0];if(!hr)continue;
var h=[];for(var j=0;j<hr.cells.length;j++)h.push(txt(hr.cells[j]));
var rows=[],imgs=[];var body=(t.tBodies.length&&t.tBodies[0].rows.length)?t.tBodies[0].rows:t.rows;
for(var r=0;r<body.length;r++){var row=body[r];if(row===hr)continue;var cs=[];
for(var c=0;c<row.cells.length;c++)cs.push(txt(row.cells[c]));var ri=rows.length;rows.push(cs);
var ims=row.querySelectorAll('img');for(var k=0;k<ims.length;k++)if(ims[k].src)imgs.push({row:ri,src:ims[k].src});}
if(h.length>1&&rows.length)tbls.push({headers:h,rows:rows,rowImages:imgs});}
var grids=doc.querySelectorAll('[role=table],[role=grid],[role=treegrid]');
for(var g=0;g<grids.length;g++){if(grids[g].querySelector('table'))continue;
var rws=grids[g].querySelectorAll('[role=row]');if(rws.length<2)continue;
var cellsOf=function(rw){var cs=rw.querySelectorAll('[role=columnheader],[role=gridcell],[role=cell]');var o=[];for(var x=0;x<cs.length;x++)o.push(txt(cs[x]));return o;};
var h2=cellsOf(rws[0]);var rows2=[],imgs2=[];
for(var r2=1;r2<rws.length;r2++){var ri2=rows2.length;rows2.push(cellsOf(rws[r2]));
var ims2=rws[r2].querySelectorAll('img');for(var k2=0;k2<ims2.length;k2++)if(ims2[k2].src)imgs2.push({row:ri2,src:ims2[k2].src});}
if(h2.length>1&&rows2.length)tbls.push({headers:h2,rows:rows2,rowImages:imgs2});}
var HW=/^(date|day|time|open|opened|close|closed|entry|exit|qty|quantity|size|side|symbol|inst|instrument|market|contract|p&l|pnl|profit|net p&l|tag|tags|sub ?tag|category|note|notes|description|r|risk|account|duration)$/i;
var cand=doc.querySelectorAll('div,span,li,p');var byParent=[];
for(var q=0;q<cand.length&&q<20000;q++){var e=cand[q];if(e.children.length)continue;var tv=txt(e);
if(tv&&tv.length<22&&HW.test(tv)){var pp=e.parentElement;if(!pp)continue;
var f=null;for(var b2=0;b2<byParent.length;b2++)if(byParent[b2].p===pp){f=byParent[b2];break;}
if(!f){f={p:pp,n:0};byParent.push(f);}f.n++;}}
for(var w=0;w<byParent.length;w++){if(byParent[w].n<4)continue;var head=byParent[w].p;var cont=head.parentElement;if(!cont)continue;
var hs=[];for(var hc=0;hc<head.children.length;hc++)hs.push(txt(head.children[hc]));
if(hs.length<4)continue;var rows3=[],imgs3=[];
for(var rc=0;rc<cont.children.length;rc++){var ch=cont.children[rc];if(ch===head)continue;
if(ch.children.length<2)continue;var cs3=[];for(var cc=0;cc<ch.children.length;cc++)cs3.push(txt(ch.children[cc]));
if(!cs3.some(function(x){return x;}))continue;var ri3=rows3.length;rows3.push(cs3);
var ims3=ch.querySelectorAll('img');for(var k3=0;k3<ims3.length;k3++)if(ims3[k3].src)imgs3.push({row:ri3,src:ims3[k3].src});}
if(rows3.length)tbls.push({headers:hs,rows:rows3,rowImages:imgs3});}}
function finish(){var w=window.__edgeCap;if(w&&w.done)return;if(w)w.done=true;
var d=docsList();var tbls=[];
for(var i=0;i<d.docs.length;i++){try{scanDoc(d.docs[i],tbls);}catch(e){}}
var diag={tables:document.querySelectorAll('table').length,ariaGrids:document.querySelectorAll('[role=table],[role=grid]').length,
iframes:document.querySelectorAll('iframe').length,crossOriginFrames:d.cross,canvases:document.querySelectorAll('canvas').length,
flutter:!!(window._flutter||window.flutterCanvasKit),react:!!document.querySelector('[data-reactroot],#root,#app'),
jsonResponses:state.reqs.length,textSample:(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1500)};
var payload={source:'edge-capture',version:2,url:location.href,title:document.title,capturedAt:new Date().toISOString(),
tables:tbls,requests:state.reqs,diagnostics:diag};
var el=document.getElementById('__edgecapbadge');if(el)el.remove();
var doDl=function(){var s=JSON.stringify(payload);
try{var b=new Blob([s],{type:'application/json'});var a=document.createElement('a');
a.href=URL.createObjectURL(b);a.download='edge-capture-'+new Date().toISOString().slice(0,10)+'.json';
document.body.appendChild(a);a.click();a.remove();}catch(e){}
try{var cp=navigator.clipboard.writeText(s);if(cp&&cp.catch)cp.catch(function(){});}catch(e){}
var n=0;for(var q=0;q<tbls.length;q++)n+=tbls[q].rows.length;
alert('Edge Capture finished: '+n+' table rows + '+state.reqs.length+' JSON responses captured. The file was downloaded (and copied to the clipboard) - import it in Edge Intelligence. If it contains no trades, import it anyway: it includes diagnostics that help tune the extractor.');
window.__edgeCap=null;};
var pend=0,cnt=0,fin2=false,MAX=40;var done2=function(){if(fin2)return;fin2=true;doDl();};
for(var ti=0;ti<tbls.length;ti++){var rims=tbls[ti].rowImages||[];
for(var ii=0;ii<rims.length;ii++){(function(rec){if(cnt>=MAX)return;cnt++;pend++;
(OF||window.fetch)(rec.src).then(function(r){return r.blob();}).then(function(bl){return new Promise(function(res){var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.readAsDataURL(bl);});}).then(function(du){rec.dataUrl=du;}).catch(function(){}).then(function(){pend--;if(pend<=0)done2();});})(rims[ii]);}}
if(pend<=0)done2();}
window.__edgeCap={finish:finish,done:false};
var bg=document.createElement('div');bg.id='__edgecapbadge';
bg.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#c9a227;color:#141210;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:9px;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.45);max-width:290px';
bg.innerHTML='&#9210; <b>Edge Capture recording</b><br>Browse your trade log / journal pages so the data loads, then <u>click here to finish</u>.';
bg.onclick=finish;
if(document.body)document.body.appendChild(bg);
}catch(e){alert('Edge Capture error: '+e.message);}})();`;

export function bookmarkletHref(): string {
  return `javascript:${encodeURIComponent(SRC)}`;
}

export function bookmarkletCode(): string {
  return `javascript:${SRC}`;
}
