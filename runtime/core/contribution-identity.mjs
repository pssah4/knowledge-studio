/** Callers supply validated, receipted journal events; display fields prove nothing. */
export function replicaIdentity(events,{handovers=[],rekeys=[]}={}){
 const roots=events.filter(event=>event.kind==='contribution_root');if(!roots.length)return null;
 const traces=rekeys.filter(item=>validateRekey(item.trace,item.events)).map(item=>item.trace),canonical=source=>{const value={...source};for(const role of ['owner','target']){const seen=new Set();while(true){if(seen.has(value[role]))return null;seen.add(value[role]);const next=traces.filter(t=>t.role===role&&t.from===value[role]);if(!next.length)break;if(new Set(next.map(t=>t.to)).size!==1)return null;value[role]=next[0].to;}}return value;};
 const first=canonical(roots[0].source);
 if(!first||roots.some(root=>{const value=canonical(root.source);return !value||['owner','document','target'].some(key=>typeof value[key]!=='string'||!value[key]||value[key]!==first[key]);}))return {conflict:true,roots};
 const accepted=handovers.filter(record=>validateHandover(record,events));
 if(accepted.length&&new Set(accepted.map(record=>record.to)).size===1){
  const byId=new Map(roots.map(root=>[root.id,root])),covered=new Set(),queue=accepted.map(record=>record.root);
  while(queue.length){const id=queue.pop();if(covered.has(id))continue;covered.add(id);queue.push(...(byId.get(id)?.predecessors??[]));}
  if(roots.every(root=>covered.has(root.id)))return null;
 }
 return {owner:first.owner,document:first.document,target:first.target,roots};
}

/** Both the immutable act and its receipted acceptance must name the same transfer. */
export function validateHandover(record,events){
 if(record?.format!=='llmwiki-contribution-handover/1'||record.accepted!==true||!['id','document','from','to','target','root','by','decision_event'].every(key=>typeof record[key]==='string'&&record[key].length>0)||typeof record.at!=='string'||!Number.isFinite(Date.parse(record.at)))return false;
 const root=events.find(e=>e.kind==='contribution_root'&&e.id===record.root),decision=events.find(e=>e.id===record.decision_event);
 if(!root||root.source?.owner!==record.from||root.source?.document!==record.document||root.source?.target!==record.target||!decision||decision.kind!=='accept'||decision.parent!==root.id||decision.author!==record.by||decision.source?.kind!=='contribution_handover'||decision.source?.accepted!==true)return false;
 return ['document','from','to','target','root'].every(key=>decision.source[key]===record[key]);
}

/** A rekey changes an address only together with its exact receipted decision. */
export function validateRekey(trace,events){
 const eventID=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value),identifier=value=>typeof value==='string'&&value.length>0&&value.length<200&&!/[\/\\:\x00-\x20]/.test(value);
 if(trace?.format!=='llmwiki-contribution-rekey/1'||trace.confirmed!==true||!eventID(trace.id)||!['owner','target'].includes(trace.role)||!identifier(trace.from)||!identifier(trace.to)||!Array.isArray(trace.readers)||!trace.readers.length||!eventID(trace.decision_event))return false;
 const decision=events.find(e=>e.id===trace.decision_event),source=decision?.source;
 return Boolean(decision&&decision.kind==='change'&&decision.author===trace.by&&decision.base===decision.text&&source?.kind==='contribution_rekey'&&source.confirmed===true&&['id','role','from','to'].every(key=>source[key]===trace[key])&&JSON.stringify(source.readers)===JSON.stringify(trace.readers));
}
