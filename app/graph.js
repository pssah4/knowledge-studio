/* Wiki graph: saved Markdown is the source of truth (ADR-02/21/22).
   build reads the same relationship carriers as maintain/index.py; mount is a
   disposable offline SVG view. No document content becomes HTML or script. */
(function(global){
"use strict";
function targets(text){
  const found=[];
  // Ignore inline examples and comments just as the knowledge index does.
  text=text.replace(/\x3c!--[^]*?-->/g,"").replace(/(`+)[^]*?\1/g,"");
  const re=/\[\[([^\]]+)\]\]|\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g;
  for(const m of text.matchAll(re))found.push((m[1]||m[2]).split("|")[0].split("#")[0]);
  return found;
}
function resolve(from,written,paths,names){
  let target=written.trim();
  if(!target||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)||/[\\\x00]/.test(target))return {outside:true};
  try{target=decodeURIComponent(target);}catch(_){return {outside:true};}
  if(/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)||/[\\\x00]/.test(target))return {outside:true};
  const relative=target.startsWith('./')||target.startsWith('../');
  if(relative){
    const parts=from.split('/').slice(0,-1);
    for(const part of target.split('/')){if(part==='..'){if(!parts.length)return {outside:true};parts.pop();}else if(part&&part!=='.')parts.push(part);}
    target=parts.join('/');
  }
  const path=target.endsWith('.md')?target:target+'.md';
  if(paths.has(path))return {path};
  if(relative||target.includes('/'))return {};
  const matches=names.get(target.replace(/\.md$/,''))||[];
  return matches.length===1?{path:matches[0]}:{};
}
function read(document){
  const text=document.text||'',head=global.parseHead(text);
  const label=head.fields.title&&head.fields.title.value;
  const node={path:document.path,label:typeof label==='string'&&label?label:document.path.split('/').pop().replace(/\.md$/,'' )};
  const edges=[];
  const related=global.headEntries(text,'related');
  for(const value of related)if(typeof value==='string')edges.push({written:targets(value)[0]||value,type:'',reason:'',origin:'head'});
  let body=text.slice(head.offset).replace(/^ {0,3}\x3c!--\s*derived\b[^>]*-->\s*$[^]*?^ {0,3}\x3c!--\s*\/derived\s*-->\s*$/gm,'');
  if(head.fields.resource)body=body.replace(/\x3c!-- llmwiki:source:start -->[^]*?\x3c!-- llmwiki:source:end -->/g,'');
  let fence=null,comment=false;const mentions=[];
  for(let line of body.split(/\r?\n/)){
    const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;continue;}
    if(fence)continue;
    // Comments may span lines; do not derive links from their payload.
    let visible='';
    while(line){if(comment){const end=line.indexOf('-->');if(end<0){line='';break;}line=line.slice(end+3);comment=false;}else{const start=line.indexOf('\x3c!--');if(start<0){visible+=line;break;}visible+=line.slice(0,start);line=line.slice(start+4);comment=true;}}
    line=visible;
    const cells=line.trim().startsWith('|')?line.trim().split(/(?<!\\)\|/).slice(1).map(c=>c.trim().replace(/\\\|/g,'|')):[];
    if(cells.length>=4&&/^(out|in)$/i.test(cells[0])){
      if(cells[0].toLowerCase()==='out')edges.push({written:targets(cells[2])[0]||cells[2],type:cells[1],reason:cells[3],origin:'table'});
      continue;
    }
    mentions.push(line);
  }
  for(const written of targets(mentions.join('\n')))edges.push({written,type:'',reason:'',origin:'text'});
  return {node,edges};
}
function build(documents){
  const pages=documents.filter(d=>d.path.endsWith('.md')&&!d.path.split('/').some(p=>p.startsWith('.')||p.startsWith('~$')||p==='notices'||p==='vermerke')).map(read).sort((a,b)=>a.node.path.localeCompare(b.node.path));
  const paths=new Set(pages.map(p=>p.node.path)),names=new Map(),edges=[],seen=new Set();let unresolved=0;
  for(const path of paths){const name=path.split('/').pop().slice(0,-3);if(!names.has(name))names.set(name,[]);names.get(name).push(path);}
  for(const page of pages){
    const resolved=page.edges.map(e=>({...e,...resolve(page.node.path,e.written,paths,names)}));
    const typed=new Set(resolved.filter(e=>e.origin==='table').map(e=>e.path||e.written));
    for(const edge of resolved){
      if(edge.origin==='head'&&typed.has(edge.path||edge.written))continue;
      if(!edge.path){if(!edge.outside)unresolved++;continue;}
      const key=JSON.stringify([page.node.path,edge.path,edge.type,edge.reason]);if(seen.has(key))continue;seen.add(key);
      edges.push({source:page.node.path,target:edge.path,type:edge.type,reason:edge.reason});
    }
  }
  return {nodes:pages.map(p=>p.node),edges,unresolved};
}
function key(wiki,path){return JSON.stringify([wiki,path]);}
function buildMulti(documents,wikis){
  const known=new Map(wikis.map(w=>[w.id,w])),scopes=new Map(),byId=new Map(),byProjectPath=new Map(),globalNames=new Map();
  for(const w of wikis)scopes.set(w.id,{paths:new Set(),names:new Map()});
  const pages=documents.filter(d=>known.has(d.wiki)&&d.path.endsWith('.md')&&!d.path.split('/').some(p=>p.startsWith('.')||p.startsWith('~$')||p==='notices'||p==='vermerke')).map(d=>{
    const page=read(d),w=known.get(d.wiki),filePath=d.path;
    page.node={...page.node,path:key(w.id,filePath),filePath,wiki:w.id,wikiLabel:w.label};return page;
  }).sort((a,b)=>a.node.path.localeCompare(b.node.path));
  function normalized(parts){const out=[];for(const p of parts){if(p==='..'){if(!out.length)return null;out.pop();}else if(p&&p!=='.')out.push(p);}return out.join('/');}
  for(const page of pages){
    const n=page.node,scope=scopes.get(n.wiki);scope.paths.add(n.filePath);byId.set(n.path,n);
    const name=n.filePath.split('/').pop().slice(0,-3);if(!globalNames.has(name))globalNames.set(name,[]);globalNames.get(name).push(n.path);if(!scope.names.has(name))scope.names.set(name,[]);scope.names.get(name).push(n.filePath);
    const w=known.get(n.wiki);if(w.path!==null&&w.path!==undefined){const p=normalized((w.path+'/'+n.filePath).split('/'));if(!byProjectPath.has(p))byProjectPath.set(p,[]);byProjectPath.get(p).push(n.path);}
  }
  function target(n,written){
    let text;try{text=decodeURIComponent(written.trim());}catch(_){return {outside:true};}
    if(!text||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(text)||/[\\\x00]/.test(text))return {outside:true};
    const scope=scopes.get(n.wiki),local=resolve(n.filePath,written,scope.paths,scope.names);
    if(local.path)return {path:key(n.wiki,local.path)};
    const relative=text.startsWith('./')||text.startsWith('../');
    if(relative){
      const w=known.get(n.wiki);if(w.path===null||w.path===undefined)return local;
      const p=normalized([...w.path.split('/'),...n.filePath.split('/').slice(0,-1),...text.split('/')]);
      if(p===null)return {outside:true};const matches=byProjectPath.get(p.endsWith('.md')?p:p+'.md')||[];
      return matches.length===1?{path:matches[0]}:{};
    }
    // An ambiguous local name must not accidentally select another wiki.
    if(!text.includes('/')&&(scope.names.get(text.replace(/\.md$/,''))||[]).length>1)return {};
    if(text.includes('/')){
      const split=text.indexOf('/'),prefix=text.slice(0,split),rest=text.slice(split+1);
      const exact=known.get(prefix),matches=exact?[exact]:wikis.filter(w=>w.label===prefix||w.path===prefix);
      if(matches.length===1){const other=scopes.get(matches[0].id),found=resolve('',rest,other.paths,other.names);return found.path?{path:key(matches[0].id,found.path)}:{};}
      if(matches.length>1)return {};
      const p=normalized(text.split('/')),projectMatches=byProjectPath.get(p&&p.endsWith('.md')?p:p+'.md')||[];
      return projectMatches.length===1?{path:projectMatches[0]}:{};
    }
    const matches=globalNames.get(text.replace(/\.md$/,''))||[];
    return matches.length===1?{path:matches[0]}:{};
  }
  const edges=[],seen=new Set();let unresolved=0;
  for(const page of pages){
    const resolved=page.edges.map(e=>({...e,...target(page.node,e.written)}));
    const typed=new Set(resolved.filter(e=>e.origin==='table').map(e=>e.path||e.written));
    for(const e of resolved){
      if(e.origin==='head'&&typed.has(e.path||e.written))continue;
      if(!e.path){if(!e.outside)unresolved++;continue;}
      const signature=JSON.stringify([page.node.path,e.path,e.type,e.reason]);if(seen.has(signature))continue;seen.add(signature);
      edges.push({source:page.node.path,target:e.path,type:e.type,reason:e.reason,crossWiki:page.node.wiki!==byId.get(e.path).wiki});
    }
  }
  return {nodes:pages.map(p=>p.node),edges,unresolved};
}

function mount(root,model,options){
  const doc=global.document,NS=['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
  function svg(tag,attrs={}){const n=doc.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,value);return n;}
  root.replaceChildren();
  const surface=svg('svg',{'class':'ws-graph-svg',viewBox:'0 0 1000 700',tabindex:'0',role:'group','aria-label':String(options.label)});
  global.I18n.setAttribute(surface,'aria-label',options.label);
  const world=svg('g',{'class':'ws-graph-world'});surface.append(world);
  const tooltip=doc.createElement('div');tooltip.className='ws-graph-tooltip';tooltip.role='tooltip';tooltip.hidden=true;
  root.append(surface,tooltip);
  let view={x:0,y:0,k:1},drag=null,pinned=false,tooltips=options.tooltips;
  const wikiIds=Array.from(new Set(model.nodes.map(n=>n.wiki).filter(Boolean))).sort(),multi=wikiIds.length>1;
  const totals=new Map(wikiIds.map(id=>[id,model.nodes.filter(n=>n.wiki===id).length]));
  const radius=Math.max(120,...[...totals.values()].map(n=>Math.sqrt(n)*42)),spacing=radius*2+300,columns=Math.max(1,Math.ceil(Math.sqrt(wikiIds.length)));
  const centers=new Map(wikiIds.map((id,i)=>[id,{x:500+(i%columns)*spacing,y:350+Math.floor(i/columns)*spacing}]));
  let stored=null;try{stored=JSON.parse(global.localStorage.getItem(options.layoutKey)||'null');}catch(_){}
  const counts=new Map();
  const nodes=model.nodes.map(n=>{const center=centers.get(n.wiki)||{x:500,y:350},index=counts.get(n.wiki)||0;counts.set(n.wiki,index+1);const prior=stored?.positions?.[n.path],valid=prior&&Number.isFinite(prior.x)&&Number.isFinite(prior.y);return {...n,x:valid?prior.x:center.x+Math.cos(index*2.399963)*Math.sqrt(index+1)*42,y:valid?prior.y:center.y+Math.sin(index*2.399963)*Math.sqrt(index+1)*42};});
  let saveTimer=null;
  function persist(){if(!options.layoutKey)return;try{global.localStorage.setItem(options.layoutKey,JSON.stringify({view,positions:Object.fromEntries(nodes.map(n=>[n.path,{x:n.x,y:n.y}]))}));}catch(_){} }
  function saveSoon(){global.clearTimeout(saveTimer);saveTimer=global.setTimeout(persist,250);}
  const groups=wikiIds.map(id=>{const members=nodes.filter(n=>n.wiki===id),label=svg('text',{'class':'ws-graph-wiki-label','data-wiki':id});label.textContent=members[0].wikiLabel+' · '+members.length;world.append(label);return {members,label};});
  const byPath=new Map(nodes.map(n=>[n.path,n]));
  const edges=model.edges.map(e=>({...e,a:byPath.get(e.source),b:byPath.get(e.target)}));
  const neighbors=new Map(nodes.map(n=>[n.path,new Set()]));for(const e of edges){neighbors.get(e.source).add(e.target);neighbors.get(e.target).add(e.source);}
  function highlight(path){
    const local=new Set(path?[path,...(neighbors.get(path)||[])]:[]);
    surface.classList.toggle('focus-local',Boolean(path));
    for(const node of nodes)node.element.classList.toggle('local',local.has(node.path));
    for(const edge of edges)edge.line.parentNode.classList.toggle('local',Boolean(path)&&(edge.source===path||edge.target===path));
  }
  function showTip(edge,event){
    if(!tooltips)return;
    tooltip.textContent=(multi?edge.a.wikiLabel+' / ':'')+edge.a.label+' > '+(multi?edge.b.wikiLabel+' / ':'')+edge.b.label+'\n'+(edge.type||String(options.linkLabel))+(edge.reason?'\n'+edge.reason:'');
    tooltip.hidden=false;
    const box=root.getBoundingClientRect();
    tooltip.style.left=Math.max(8,Math.min((event.clientX||box.left+20)-box.left+12,box.width-300))+'px';
    tooltip.style.top=Math.max(8,Math.min((event.clientY||box.top+20)-box.top+12,box.height-tooltip.offsetHeight-8))+'px';
  }
  for(const edge of edges){
    const group=svg('g',{'class':'ws-graph-edge'+(edge.crossWiki?' ws-graph-cross-wiki':''),'data-source':edge.source,'data-target':edge.target,tabindex:'0',role:'img','aria-label':edge.a.label+' > '+edge.b.label});
    edge.line=svg('path',{'class':'ws-graph-line',});
    edge.hit=svg('path',{'class':'ws-graph-hit'});group.append(edge.line,edge.hit);world.append(group);
    group.addEventListener('pointerenter',e=>{if(!pinned)showTip(edge,e);});group.addEventListener('pointermove',e=>{if(!pinned)showTip(edge,e);});group.addEventListener('pointerleave',()=>{if(!pinned)tooltip.hidden=true;});
    group.addEventListener('focus',()=>{if(!pinned)showTip(edge,{});});group.addEventListener('blur',()=>{if(!pinned)tooltip.hidden=true;});
    const pin=event=>{event.stopPropagation();showTip(edge,event);pinned=true;tooltip.classList.add('pinned');};group.addEventListener('pointerdown',event=>event.stopPropagation());group.addEventListener('click',pin);group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pin(event);}});
  }
  surface.addEventListener('keydown',event=>{if(event.key==='Escape'){pinned=false;tooltip.classList.remove('pinned');tooltip.hidden=true;}});
  surface.addEventListener('click',event=>{if(event.target===surface){pinned=false;tooltip.classList.remove('pinned');tooltip.hidden=true;}});
  for(const node of nodes){
    node.element=svg('g',{'class':'ws-graph-node'+(options.active===node.path?' active':''),tabindex:'0',role:'button','aria-label':multi?node.wikiLabel+' / '+node.filePath:(node.filePath||node.path),'data-path':node.filePath||node.path,'data-wiki':node.wiki||''});
    const circle=svg('circle',{r:6});const label=svg('text',{x:11,y:4});label.textContent=node.label;
    const title=svg('title');title.textContent=node.label+'\n'+(node.wikiLabel?node.wikiLabel+' / ':'')+(node.filePath||node.path);
    node.element.append(title,circle,label);
    if(multi){const wiki=svg('text',{x:11,y:18,'class':'ws-graph-node-wiki'});wiki.textContent=node.wikiLabel;node.element.append(wiki);}
    world.append(node.element);
    node.element.addEventListener('pointerenter',()=>highlight(node.path));node.element.addEventListener('pointerleave',()=>highlight(null));node.element.addEventListener('focus',()=>highlight(node.path));node.element.addEventListener('blur',()=>highlight(null));
    node.element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();options.open(node.path);}});
    node.element.addEventListener('pointerdown',event=>startDrag(event,node));
  }
  highlight(null);
  // Parallel assertions use separate curves; self-relations remain visible loops.
  const pairs=new Map();for(const e of edges){const key=[e.source,e.target].sort().join('\0');if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(e);}
  for(const group of pairs.values())group.forEach((e,i)=>e.bend=(i-(group.length-1)/2)*30);
  function draw(viewOnly=false){
    world.setAttribute('transform',`translate(${view.x} ${view.y}) scale(${view.k})`);
    surface.classList.toggle('ws-graph-overview',view.k<.65);surface.style.setProperty('--graph-label-size',(12/Math.max(.05,view.k))+'px');
    if(viewOnly)return;
    for(const n of nodes)n.element.setAttribute('transform',`translate(${n.x} ${n.y})`);
    for(const g of groups){g.label.setAttribute('x',Math.min(...g.members.map(n=>n.x)));g.label.setAttribute('y',Math.min(...g.members.map(n=>n.y))-28);}
    for(const e of edges){
      const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,length=Math.hypot(dx,dy)||1;
      // Fix curvature orientation for reverse edges.
      const sign=e.source<e.target?1:-1;
      const d=e.a===e.b?`M ${e.a.x} ${e.a.y} c -45 -55 45 -55 1 0`:`M ${e.a.x} ${e.a.y} Q ${(e.a.x+e.b.x)/2-dy/length*e.bend*sign} ${(e.a.y+e.b.y)/2+dx/length*e.bend*sign} ${e.b.x} ${e.b.y}`;
      e.line.setAttribute('d',d);e.hit.setAttribute('d',d);
    }
  }
  function point(event){const p=surface.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(surface.getScreenCTM().inverse());}
  function startDrag(event,node){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();tooltip.hidden=true;
    const p=point(event);drag={node,start:p,last:p,moved:false};surface.setPointerCapture(event.pointerId);
  }
  surface.addEventListener('pointerdown',e=>startDrag(e,null));
  surface.addEventListener('pointermove',event=>{
    if(!drag)return;const p=point(event),dx=p.x-drag.last.x,dy=p.y-drag.last.y;
    drag.moved=drag.moved||Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>4;
    if(drag.node){drag.node.x+=dx/view.k;drag.node.y+=dy/view.k;drag.node.vx=drag.node.vy=0;}else{view.x+=dx;view.y+=dy;}
    drag.last=p;draw(!drag.node);saveSoon();
  });
  surface.addEventListener('pointerup',event=>{if(!drag)return;const done=drag;drag=null;if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);if(done.node&&!done.moved)options.open(done.node.path);});
  surface.addEventListener('pointercancel',()=>drag=null);
  function zoom(factor,p={x:500,y:350}){const k=Math.max(.15,Math.min(6,view.k*factor)),ratio=k/view.k;view.x=p.x-(p.x-view.x)*ratio;view.y=p.y-(p.y-view.y)*ratio;view.k=k;tooltip.hidden=true;draw(true);saveSoon();}
  surface.addEventListener('wheel',event=>{event.preventDefault();zoom(Math.exp(-event.deltaY*.0015),point(event));},{passive:false});
  surface.addEventListener('keydown',event=>{if(event.target!==surface)return;if(event.key==='+'||event.key==='=')zoom(1.2);else if(event.key==='-')zoom(1/1.2);else if(event.key==='0')fit();else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){view.x+=event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0;view.y+=event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0;draw();}else return;event.preventDefault();});
  function fit(){
    if(!nodes.length)return;
    const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),left=Math.min(...xs)-70,right=Math.max(...xs)+300,top=Math.min(...ys)-70,bottom=Math.max(...ys)+70;
    const k=Math.min(1,900/Math.max(1,right-left),600/Math.max(1,bottom-top));view={x:500-(left+right)/2*k,y:350-(top+bottom)/2*k,k};draw();
  }
  if(stored?.view&&['x','y','k'].every(k=>Number.isFinite(stored.view[k]))&&stored.view.k>0){view=stored.view;draw();}else fit();
  persist();
  return {zoom,fit,setTooltips(value){tooltips=value;pinned=false;tooltip.classList.remove('pinned');tooltip.hidden=true;},destroy(){global.clearTimeout(saveTimer);persist();root.replaceChildren();}};
}
global.WikiGraph={build,buildMulti,key,mount};
})(typeof globalThis==='object'?globalThis:this);
