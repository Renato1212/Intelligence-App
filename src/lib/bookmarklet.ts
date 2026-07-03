/**
 * The "Edge Capture" bookmarklet — runs inside the logged-in platform page
 * (Trader One or any web journal), reads every visible data table (native
 * <table> and ARIA role="table/grid" React grids) plus row images, and
 * downloads the result as an edge-capture JSON file this app imports.
 *
 * Everything happens in the user's own browser session — no credentials or
 * data are sent anywhere.
 */
const SRC = `(function(){try{
var tbls=[];
function push(h,r,im){if(h.length>1&&r.length)tbls.push({headers:h,rows:r,rowImages:im});}
function txt(el){return (el.innerText||'').replace(/\\s+/g,' ').trim();}
var tables=document.querySelectorAll('table');
for(var i=0;i<tables.length;i++){var t=tables[i];var hr=(t.tHead&&t.tHead.rows[0])||t.rows[0];if(!hr)continue;
var h=[];for(var j=0;j<hr.cells.length;j++)h.push(txt(hr.cells[j]));
var rows=[],imgs=[];var body=(t.tBodies.length&&t.tBodies[0].rows.length)?t.tBodies[0].rows:t.rows;
for(var r=0;r<body.length;r++){var row=body[r];if(row===hr)continue;var cs=[];
for(var c=0;c<row.cells.length;c++)cs.push(txt(row.cells[c]));var ri=rows.length;rows.push(cs);
var ims=row.querySelectorAll('img');for(var k=0;k<ims.length;k++)if(ims[k].src)imgs.push({row:ri,src:ims[k].src});}
push(h,rows,imgs);}
var grids=document.querySelectorAll('[role=table],[role=grid],[role=treegrid]');
for(var g=0;g<grids.length;g++){if(grids[g].querySelector('table'))continue;
var rws=grids[g].querySelectorAll('[role=row]');if(rws.length<2)continue;
function cellsOf(rw){var cs=rw.querySelectorAll('[role=columnheader],[role=gridcell],[role=cell]');var o=[];for(var x=0;x<cs.length;x++)o.push(txt(cs[x]));return o;}
var h2=cellsOf(rws[0]);var rows2=[],imgs2=[];
for(var r2=1;r2<rws.length;r2++){var ri2=rows2.length;rows2.push(cellsOf(rws[r2]));
var ims2=rws[r2].querySelectorAll('img');for(var k2=0;k2<ims2.length;k2++)if(ims2[k2].src)imgs2.push({row:ri2,src:ims2[k2].src});}
push(h2,rows2,imgs2);}
if(!tbls.length){alert('Edge Capture: no data tables found on this page. Open the trade log / journal list view and try again.');return;}
var payload={source:'edge-capture',version:1,url:location.href,title:document.title,capturedAt:new Date().toISOString(),tables:tbls};
var fin=false;
function done(){if(fin)return;fin=true;var s=JSON.stringify(payload);
var b=new Blob([s],{type:'application/json'});var a=document.createElement('a');
a.href=URL.createObjectURL(b);a.download='edge-capture-'+new Date().toISOString().slice(0,10)+'.json';
document.body.appendChild(a);a.click();a.remove();
try{var cp=navigator.clipboard.writeText(s);if(cp&&cp.catch)cp.catch(function(){});}catch(e){}
var n=0;for(var q=0;q<tbls.length;q++)n+=tbls[q].rows.length;
alert('Edge Capture: '+n+' rows from '+tbls.length+' table(s). JSON downloaded (and copied to clipboard) - import it in Edge Intelligence.');}
var pend=0,cnt=0,MAX=40;
for(var ti=0;ti<tbls.length;ti++){var rims=tbls[ti].rowImages;
for(var ii=0;ii<rims.length;ii++){(function(rec){if(cnt>=MAX)return;cnt++;pend++;
fetch(rec.src).then(function(r){return r.blob();}).then(function(bl){return new Promise(function(res){var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.readAsDataURL(bl);});}).then(function(du){rec.dataUrl=du;}).catch(function(){}).then(function(){pend--;if(pend<=0)done();});})(rims[ii]);}}
if(pend<=0)done();
}catch(e){alert('Edge Capture error: '+e.message);}})();`;

export function bookmarkletHref(): string {
  return `javascript:${encodeURIComponent(SRC)}`;
}

export function bookmarkletCode(): string {
  return `javascript:${SRC}`;
}
