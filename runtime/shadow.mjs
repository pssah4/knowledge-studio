/** FEAT-03-06: lossless structural evidence, independent of storage and host.
 * Selectors address original Markdown: UTF-16 offsets, UTF-8 bytes and Unicode
 * scalar offsets are deliberately separate. Blocks are not semantic claims.
 */
import {parseDocument} from './core/document.mjs';
import {requireThat} from './core/errors.mjs';

export const SHADOW_FORMAT='llmwiki-shadow/1';
export const PARSER_VERSION='markdown-structure/2';
const hashKey=(services,...parts)=>services.hash(JSON.stringify(parts));

export async function parseShadow(source,services,{maxBytes=8*1024*1024}={}){
 requireThat(typeof source==='string','shadow_source','Supply Markdown text.');
 const bytes=new TextEncoder().encode(source);
 requireThat(bytes.length<=maxBytes,'shadow_limit','This document exceeds the structural indexing budget.');
 const parsed=parseDocument(source),revision=await services.hash(bytes),lines=[];
 let offset=parsed.offset;
 for(const raw of parsed.body.match(/[^\n]*\n|[^\n]+$/g)??[]){const original=raw.replace(/\r?\n$/,''),text=offset===0?original.replace(/^\uFEFF/,''):original;lines.push({text,start:offset,end:offset+original.length});offset+=raw.length;}
 // One linear pass maps source positions. Never normalize the original bytes.
 const byteAt=new Uint32Array(source.length+1),unicodeAt=new Uint32Array(source.length+1),lineAt=new Uint32Array(source.length+1);
 let b=0,u=0,line=1;
 for(let i=0;i<source.length;){const cp=source.codePointAt(i),width=cp>0xffff?2:1;byteAt[i]=b;unicodeAt[i]=u;lineAt[i]=line;
  if(width===2){byteAt[i+1]=b;unicodeAt[i+1]=u;lineAt[i+1]=line;}
  b+=cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4;u++;if(cp===10)line++;i+=width;
 }
 byteAt[source.length]=b;unicodeAt[source.length]=u;lineAt[source.length]=line;
 const blocks=[],headings=[];
 const atx=text=>/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(text);
 const fence=text=>/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
 const list=text=>/^\s*(?:[-+*]|\d+[.)])[ \t]+/.test(text);
 const tableRule=text=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(text);
 const special=i=>!lines[i]?.text.trim()||atx(lines[i].text)||fence(lines[i].text)||/^\s*<!--/.test(lines[i].text)||list(lines[i].text);
 for(let i=0;i<lines.length;){
  if(!lines[i].text.trim()){i++;continue;}
  if(/^\s*<!--/.test(lines[i].text)){while(i<lines.length&&!lines[i++].text.includes('-->')){}continue;}
  const first=i,h=atx(lines[i].text),f=fence(lines[i].text),setext=lines[i+1]&&/^ {0,3}(=+|-+)\s*$/.exec(lines[i+1].text);
  let kind='paragraph';
  if(h||setext){kind='heading';const depth=h?h[1].length:setext[1][0]==='='?1:2;headings.length=depth-1;headings[depth-1]=h?h[2]:lines[i].text.trim();i+=h?1:2;}
  else if(f){kind='code';i++;while(i<lines.length){const end=fence(lines[i++].text);if(end&&end[1][0]===f[1][0]&&end[1].length>=f[1].length&&!end[2].trim())break;}}
  else if(tableRule(lines[i+1]?.text??'')){kind='table';i+=2;while(i<lines.length&&lines[i].text.trim()&&lines[i].text.includes('|'))i++;}
  else if(list(lines[i].text)){kind='list';i++;while(i<lines.length&&lines[i].text.trim()&&!atx(lines[i].text)&&!fence(lines[i].text))i++;}
  else{if(/^\s*(?:!\[[^\]]*\]\([^\n]*\)|!\[\[[^\n]+\]\])\s*$/.test(lines[i].text))kind='image';i++;while(i<lines.length&&!special(i)&&!/^ {0,3}(=+|-+)\s*$/.test(lines[i].text)&&!tableRule(lines[i+1]?.text??''))i++;}
  const start=lines[first].start,end=lines[i-1].end,quote=source.slice(start,end);
  blocks.push({kind,start,end,byte_start:byteAt[start],byte_end:byteAt[end],unicode_start:unicodeAt[start],unicode_end:unicodeAt[end],line_start:lineAt[start],line_end:lineAt[end],quote,headings:headings.filter(Boolean),text_hash:await hashKey(services,kind,quote),occurrence:await hashKey(services,PARSER_VERSION,revision,start,end)});
 }
 for(let i=0;i<blocks.length;i++){blocks[i].previous=blocks[i-1]?.occurrence??null;blocks[i].next=blocks[i+1]?.occurrence??null;}
 return {format:SHADOW_FORMAT,parser:PARSER_VERSION,revision,bytes:bytes.length,source,blocks};
}

/** Only unique, byte-identical structural blocks continue automatically.
 * Other mappings are provenance candidates, never substitute quote targets.
 */
export async function matchBlocks(previous,blocks,services){
 const old=new Map(),fresh=new Map();
 for(const [items,map] of [[previous,old],[blocks,fresh]])for(const item of items){const found=map.get(item.text_hash)??[];found.push(item);map.set(item.text_hash,found);}
 const result=[];
 for(const block of blocks){const candidates=old.get(block.text_hash)??[],unique=candidates.length===1&&fresh.get(block.text_hash).length===1;
  result.push({...block,id:unique?candidates[0].id:services.uuid(),mapping:unique?'unchanged':candidates.length?'ambiguous':'new',predecessors:candidates.map(b=>b.id)});
 }
 // Only two unchanged, order-preserving neighbors support a candidate hint.
 // This uses metadata available after cache loss; no old fulltext or fuzzy diff.
 const oldIndex=new Map(previous.map((p,i)=>[p.id,i]));let left=null;
 for(let right=0;right<result.length;right++)if(result[right].mapping==='unchanged'){
  if(left!==null){const a=oldIndex.get(result[left].id),b=oldIndex.get(result[right].id),fresh=result.slice(left+1,right),old=previous.slice(a+1,b);
   if(b>a&&fresh.length>0&&fresh.length<=32&&old.length>0&&old.length<=32&&fresh.every(x=>x.mapping==='new'))for(const block of fresh){const candidates=old.filter(p=>p.kind===block.kind&&!result.some(r=>r.id===p.id));if(candidates.length){block.mapping='candidate';block.predecessors=candidates.map(p=>p.id);block.candidate_basis='unchanged_neighbors';}}
  }left=right;
 }
 for(const block of result)if(previous.length&&block.mapping==='new')block.mapping='unresolved';
 return result;
}

export function makeLocator(wiki,document,revision,block,range={}){
 requireThat(revision.source.slice(block.start,block.end)===block.quote,'shadow_selector','The quote does not match its original selector.');
 const start=range.start??block.start,end=range.end??block.end,source=revision.source;
 const boundary=i=>!(i>0&&i<source.length&&/[\uD800-\uDBFF]/.test(source[i-1])&&/[\uDC00-\uDFFF]/.test(source[i]));
 requireThat(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=block.start&&end<=block.end&&end>start&&boundary(start)&&boundary(end),'shadow_selector','Select a nonempty original range within this block.');
 const partial=start!==block.start||end!==block.end,quote=source.slice(start,end),before=source.slice(0,start),through=source.slice(0,end);
 return {format:SHADOW_FORMAT,wiki,document,revision:revision.revision,parser:revision.parser,block:block.id,occurrence:block.occurrence,quote,
  start,end,byte_start:partial?new TextEncoder().encode(before).length:block.byte_start,byte_end:partial?new TextEncoder().encode(through).length:block.byte_end,unicode_start:partial?[...before].length:block.unicode_start,unicode_end:partial?[...through].length:block.unicode_end,
  line_start:partial?before.split('\n').length:block.line_start,line_end:partial?through.split('\n').length:block.line_end,headings:block.headings,prefix:source.slice(Math.max(0,start-80),start),suffix:source.slice(end,end+80),...(partial?{partial:true,block_start:block.start,block_end:block.end}:{})};
}

/** This pure resolver is also used in the editor; callers enforce scope/access. */
export function resolveLocator(locator,current){
 requireThat(locator?.format===SHADOW_FORMAT&&typeof locator.quote==='string'&&Number.isInteger(locator.start)&&Number.isInteger(locator.end)&&locator.end>locator.start,'shadow_selector','Invalid quote selector.');
 if(!current)return {state:'unavailable',quote:locator.quote,current:null};
 if(current.revision===locator.revision){requireThat(current.source.slice(locator.start,locator.end)===locator.quote,'shadow_selector','The quote does not match its original selector.');return {state:'current',quote:locator.quote,current:{start:locator.start,end:locator.end,id:locator.block}};}
 const successors=current.blocks.filter(b=>b.id===locator.block).map(b=>{if(!locator.partial)return b;const start=b.start+locator.start-locator.block_start,end=start+locator.quote.length;return Number.isInteger(start)&&start>=b.start&&end<=b.end&&current.source.slice(start,end)===locator.quote?{...b,start,end,quote:locator.quote}:null;}).filter(Boolean),candidates=current.blocks.filter(b=>b.predecessors?.includes(locator.block));
 return {state:'historical',quote:locator.quote,current:successors.length===1?successors[0]:null,successor_state:successors.length===1?'unchanged':candidates.length?'ambiguous':'missing',candidates:candidates.map(b=>({id:b.id,start:b.start,end:b.end,mapping:b.mapping,basis:b.candidate_basis??null}))};
}
