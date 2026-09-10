/** Registered document requirements and nonblocking review dates (ADR-14/23/26).
 * Shared by write validation and read-only readiness; never rewrites a document.
 */
import {sectionText,relationRows} from './document.mjs';

const present=value=>typeof value==='string'?Boolean(value.trim()):Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:typeof value==='number'?Number.isFinite(value):typeof value==='boolean';
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10)?new Date(value):null;
const strings=value=>Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.trim());
export function noteContract({head,body},register){
 const genus=register?.genera.get(head.type),findings=[];
 const add=(kind,field)=>findings.push({code:'head_contract_'+kind,field});
 if(!genus||!['stable','deprecated'].includes(head.status))return findings;
 for(const key of new Set([...genus.required,'sources','verified','stale_after'])){
  const value=head[key];if(!present(value)){add('required',key);continue;}
  if(['owner','language','class','decided_by'].includes(key)&&typeof value!=='string')add('type',key);
  if(['published','decided_at','stale_after'].includes(key)&&!date(value))add('date',key);
  if(['aliases','sources'].includes(key)&&!strings(value))add('type',key);
  if(key==='verified'&&(!Array.isArray(value)||!value.every(v=>v&&typeof v.by==='string'&&v.by.trim()&&date(v.at))))add('type',key);
 }
 if(head.class!==undefined&&(!genus.classes.includes(head.class)))add('class','class');
 if(genus.relatedRequired&&(!strings(head.related)||!head.related.length)&&!relationRows(body).some(r=>r.direction==='out'&&r.valid&&r.written))add('connection','related');
 for(const section of genus.sections)if(!sectionText(body,[section]).trim())add('section',section);
 return findings;
}
export function reviewAdvisories({head},register,now){
 const time=date(now),postponed=date(head.postponed_until);if(!time||postponed&&postponed>time)return [];
 const findings=[],add=(code,message,extra={})=>findings.push({code,severity:'warning',message,addressee:typeof head.owner==='string'?head.owner:null,urgency:head.urgency??null,...extra});
 const deadline=date(head.stale_after),interval=register?.genera.get(head.type)?.staleInterval;
 if(deadline&&deadline<=time)add('review_due','The recorded review date has been reached.',{date:head.stale_after});
 if(interval&&deadline){
  const dates=[date(head.generated?.at),...(Array.isArray(head.verified)?head.verified.map(v=>date(v?.at)):[])].filter(Boolean);
  if(!dates.length)add('review_interval_unknown','The review interval has no recorded starting date.');
  else{const start=new Date(Math.max(...dates.map(d=>+d))),day=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()+interval);const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(day,last));
   if(deadline>start)add('review_interval_exceeded','The next review date exceeds the registered interval.',{interval_limit:start.toISOString()});
  }
 }
 return findings;
}
