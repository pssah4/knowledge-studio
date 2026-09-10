/** FIX-03-06-01: bounded transport packages, complete identity records.
 * Version 1 remains readable. Version 2 fragments are never standalone revisions.
 */
import {SHADOW_FORMAT} from './shadow.mjs';
import {requireThat} from './core/errors.mjs';
export const IDENTITY_FRAGMENTS='llmwiki-shadow-identities/2';
const bytes=text=>new TextEncoder().encode(text).length;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export async function identityPackages(wiki,records,services,{maxBatchBytes=512*1024}={}){
 requireThat(Number.isSafeInteger(maxBatchBytes)&&maxBatchBytes>=4096&&maxBatchBytes<=8*1024*1024,'shadow_exchange_budget','Choose a transport package budget between 4 KiB and 8 MiB.',{budget:'maxBatchBytes',limit:maxBatchBytes,next:'Use the default; documents are split automatically. Do not remove Markdown or shared identities.'});
 const result=[],serialize=documents=>JSON.stringify({format:SHADOW_FORMAT,kind:'identities',wiki,documents});let group=[],groupBytes=bytes(serialize([]));
 const flush=()=>{if(group.length)result.push(serialize(group));group=[];groupBytes=bytes(serialize([]));};
 for(const document of records){
  const recordText=JSON.stringify(document),recordBytes=bytes(recordText);
  if(bytes(serialize([document]))<=maxBatchBytes){if(group.length>=1000||groupBytes+recordBytes+(group.length?1:0)>maxBatchBytes)flush();groupBytes+=recordBytes+(group.length?1:0);group.push(document);continue;}
  flush();const {blocks,...meta}=document,record=await services.hash(recordText),chunks=[];let chunk=[];
  const encode=(blocks,part,total)=>JSON.stringify({format:IDENTITY_FRAGMENTS,kind:'identities',wiki,fragments:[{record,part,total,blocks_total:document.blocks.length,document:{...meta,blocks}}]});
  // Reserve the largest possible part counters; linear packing, one JSON encode
  // per block, not repeated serialization of a growing document.
  const overhead=bytes(encode([],20000,20000));let size=overhead;
  for(const block of blocks){const n=bytes(JSON.stringify(block));requireThat(overhead+n<=maxBatchBytes,'shadow_exchange_budget','A single block identity exceeds the transport budget.',{wiki,path:document.path,budget:'maxBatchBytes',bytes:overhead+n,limit:maxBatchBytes,next:'Report this identity size; preserve Markdown and shared identities. Rebuild and cache_bytes do not fix transport limits.'});
   if(chunk.length&&size+n+1>maxBatchBytes){chunks.push(chunk);chunk=[];size=overhead;}size+=n+(chunk.length?1:0);chunk.push(block);
  }
  if(chunk.length)chunks.push(chunk);
  requireThat(chunks.length>0,'shadow_exchange_budget','Document metadata exceeds the transport budget.',{wiki,path:document.path,budget:'maxBatchBytes',bytes:recordBytes,limit:maxBatchBytes});
  chunks.forEach((blocks,part)=>result.push(encode(blocks,part,chunks.length)));
 }
 flush();return result;
}

export async function assembleIdentities(packages,services){
 const records=[],groups=new Map(),findings=[];
 for(const data of packages){
  if(data.format===SHADOW_FORMAT){requireThat(Array.isArray(data.documents)&&data.documents.length<=1000,'shadow_history','Invalid identity package.');records.push(...data.documents);continue;}
  requireThat(data.format===IDENTITY_FRAGMENTS&&Array.isArray(data.fragments)&&data.fragments.length>0&&data.fragments.length<=1000,'shadow_history','Unsupported identity package version. Update both skills and the editor; retain all shared files.');
  for(const part of data.fragments){requireThat(hex(part.record)&&Number.isSafeInteger(part.part)&&Number.isSafeInteger(part.total)&&part.total>0&&part.total<=20000&&part.part>=0&&part.part<part.total&&Number.isSafeInteger(part.blocks_total)&&part.blocks_total>0&&part.blocks_total<=20000&&Array.isArray(part.document?.blocks)&&part.document.blocks.length>0&&part.document.blocks.length<=part.blocks_total,'shadow_history','Invalid identity fragment.');
   const {blocks,...meta}=part.document,signature=JSON.stringify([part.total,part.blocks_total,meta]),group=groups.get(part.record)??{signature,parts:new Map(),meta,total:part.total,blocks_total:part.blocks_total};
   requireThat(group.signature===signature,'shadow_history','Conflicting identity fragments. Retain the packages for reconciliation.');const previous=group.parts.get(part.part);requireThat(!previous||JSON.stringify(previous)===JSON.stringify(blocks),'shadow_history','Conflicting duplicate identity fragment.');group.parts.set(part.part,blocks);groups.set(part.record,group);
  }
 }
 for(const [hash,group] of groups){if(group.parts.size!==group.total){findings.push({code:'shadow_exchange_incomplete',page:group.meta.path,revision:group.meta.revision,record:hash,received:group.parts.size,expected:group.total,message:'Identity transfer is incomplete; refresh or finish sync. Preserve every existing package.'});continue;}
  const blocks=[];for(let i=0;i<group.total;i++)blocks.push(...group.parts.get(i));const record={...group.meta,blocks};requireThat(blocks.length===group.blocks_total&&await services.hash(JSON.stringify(record))===hash,'shadow_history','Reassembled identity checksum is invalid.');records.push(record);
 }
 return {records:[...new Map(records.map(r=>[JSON.stringify(r),r])).values()],findings};
}
