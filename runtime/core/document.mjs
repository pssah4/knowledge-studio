/** Markdown/frontmatter contract (ADR-11/26). Changes retain every untouched source byte. */
import {parseDocument as parseYaml, stringify, isMap} from 'yaml';
import {requireThat, WikiError} from './errors.mjs';
const technicalKeys=['resource','generated','sources','extraction','source_id'];
const presentationKeys=['resource','source_created_at','source_modified_at','generated_at'];
function metadataComment(data){return '\n<!-- llmwiki:metadata '+JSON.stringify(data).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+' -->\n';}

export function parseDocument(source) {
  requireThat(typeof source === 'string', 'document', 'Markdown must be text.');
  const match = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(source);
  if (!match || match.index !== 0) {
    requireThat(!/^\uFEFF?---[ \t]*\r?\n/.test(source), 'frontmatter', 'Frontmatter is not closed.');
    return {head:{}, body:source, source, yaml:null, prefix:'', raw:'', suffix:'', offset:0};
  }
  const yaml = parseYaml(match[2], {keepSourceTokens:true, uniqueKeys:true, version:'1.2'});
  if (yaml.errors.length) throw new WikiError('frontmatter', 'YAML: '+yaml.errors.map(e => e.message).join('; '));
  requireThat(!yaml.contents || isMap(yaml.contents), 'frontmatter', 'Frontmatter must be a mapping.');
  let head;
  try { head = yaml.toJS({maxAliasCount:50}) ?? {}; }
  catch (error) { throw new WikiError('frontmatter', 'YAML: '+error.message); }
  const visibleHead=structuredClone(head),tail=source.slice(match[0].length),meta=/^\s*<!-- llmwiki:metadata ([^\n]+) -->\r?\n/.exec(tail);
  let metadata=null;if(meta){try{metadata=JSON.parse(meta[1]);}catch{throw new WikiError('metadata','Invalid embedded metadata. Restore it before editing.');}requireThat(metadata?.format==='llmwiki-metadata/1'&&metadata.fields&&typeof metadata.fields==='object'&&!Array.isArray(metadata.fields),'metadata','Invalid embedded metadata format.');for(const key of technicalKeys)if(Object.hasOwn(metadata.fields,key))head[key]=metadata.fields[key];}
  const metadataPrefix=meta?.[0]??'',offset=match[0].length+metadataPrefix.length;
  return {head,visibleHead,metadata,metadataPrefix,body:source.slice(offset),source,yaml,
    prefix:match[1], raw:match[2], suffix:match[3], offset};
}

export function patchHead(source, updates) {
  const parsed=parseDocument(source);
  if(parsed.metadata){
    const fields={...parsed.metadata.fields},visible={};for(const [key,value]of Object.entries(updates)){if(technicalKeys.includes(key))fields[key]=value;else visible[key]=value;}
    const withFields=parsed.prefix+parsed.raw+parsed.suffix+metadataComment({...parsed.metadata,fields})+parsed.body;
    return projectMetadata(patchVisibleHead(withFields,visible),parsed.metadata.visible);
  }
  return patchVisibleHead(source,updates);
}
function patchVisibleHead(source, updates) {
  requireThat(updates && typeof updates === 'object' && !Array.isArray(updates), 'head', 'Head changes must be a mapping.');
  const parsed = parseDocument(source);
  if (!parsed.yaml) return '---\n'+stringify(updates, {lineWidth:0})+'---\n'+source;
  const replacements = [], additions = [];
  const items = parsed.yaml.contents?.items ?? [];
  for (const [key,value] of Object.entries(updates)) {
    requireThat(!Object.hasOwn(Object.prototype,key)&&key!=='prototype', 'head', 'Reserved head field.');
    const i = items.findIndex(pair => pair.key?.value === key);
    const written = stringify({[key]:value}, {lineWidth:0});
    if (i < 0) { additions.push(written); continue; }
    const pair = items[i];
    requireThat(!pair.value?.anchor, 'head', 'An anchored field needs an explicit document edit.');
    const start = pair.key.range[0];
    // Range includes only the changed pair; leading comments of the next pair
    // remain owned by that pair. Scalar comments are deliberately kept below.
    let end = pair.value?.range?.[2] ?? pair.key.range[2];
    if (!pair.value) { const eol = parsed.raw.indexOf('\n', end); end = eol < 0 ? parsed.raw.length : eol + 1; }
    const comment = pair.value?.comment;
    const replacement = comment ? written.trimEnd()+' #'+comment+'\n' : written;
    replacements.push({start,end,text:replacement});
  }
  let raw = parsed.raw;
  for (const edit of replacements.sort((a,b) => b.start-a.start)) raw = raw.slice(0,edit.start)+edit.text+raw.slice(edit.end);
  if (additions.length) raw = raw.replace(/\s*$/, '\n')+additions.join('');
  const result = parsed.prefix+raw+parsed.suffix+(parsed.metadataPrefix??'')+parsed.body;
  parseDocument(result);
  return result;
}

export function newDocument(head, body) {
  return '---\n'+stringify(head, {lineWidth:0})+'---\n\n'+body;
}

/** Portable presentation: technical provenance stays in the file, outside YAML properties. */
export function projectMetadata(source,visible){
 const p=parseDocument(source);if(!p.yaml)return source;
 const fields={...p.metadata?.fields};for(const key of technicalKeys)if(Object.hasOwn(p.head,key))fields[key]=p.head[key];
 if(!Object.keys(fields).length)return source;
 visible=(visible??p.metadata?.visible??['resource']).filter(k=>presentationKeys.includes(k));
 const projection={resource:!Object.hasOwn(fields,'resource')?undefined:Array.isArray(fields.resource)?fields.resource:typeof fields.resource==='object'&&fields.resource!==null?(fields.resource.link?[fields.resource.link]:[]):Array.isArray(fields.resource)?fields.resource:fields.resource?[fields.resource]:[],source_created_at:fields.resource?.created_at,source_modified_at:fields.resource?.modified_at,generated_at:fields.generated?.at};
 // Remove the old block before modifying visible YAML, then append exactly one block.
 let text=p.prefix+p.raw+p.suffix+p.body;
 text=removeHeadFields(text,[...technicalKeys,...presentationKeys]);
 text=patchVisibleHead(text,Object.fromEntries(visible.filter(k=>projection[k]!==undefined).map(k=>[k,projection[k]])));
 const next=parseDocument(text);return next.prefix+next.raw+next.suffix+metadataComment({format:'llmwiki-metadata/1',fields,visible})+next.body;
}

/** Transform authored text only; fenced examples and mirrored source contents are immutable. */
export function mapAuthored(text,transform){
 const protectedParts=/<!-- llmwiki:source:start -->[\s\S]*?<!-- llmwiki:source:end -->|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm;
 let result='',at=0;for(const m of text.matchAll(protectedParts)){result+=transform(text.slice(at,m.index))+m[0];at=m.index+m[0].length;}return result+transform(text.slice(at));
}
export function stripNavigation(text,{members=true,legacy=false}={}){return mapAuthored(text,part=>{
 part=part.replace(/<!-- llmwiki:provenance:start -->[\s\S]*?<!-- llmwiki:provenance:end -->\n?/g,'');
 part=part.replace(/<!-- vault-operator:incoming-links -->[\s\S]*?<!-- \/vault-operator:incoming-links -->\n?/g,'');
 if(members)part=part.replace(/<!-- llmwiki:members:start -->[\s\S]*?<!-- llmwiki:members:end -->\n?/g,'');
 if(legacy)part=part.replace(/<!-- derived incoming -->[\s\S]*?<!-- \/derived -->\n?/g,'');return part;
});}
export function statementText(source) {
  source=stripNavigation(source);
  const kept=[],hidden=[];let fence=null,inside=false;
  for(const original of source.match(/[^\n]*\n|[^\n]+$/g)??[]){
    let line=original;const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
    if(inside){hidden.push(line);if(!fence&&/^ {0,3}<!--\s*\/derived\s*-->\s*$/.test(line)){inside=false;hidden.length=0;if(kept.length&&!kept.at(-1).trim())kept.pop();}continue;}
    if(!fence&&!marker&&/^ {0,3}<!--\s*derived\b[^>]*-->\s*$/.test(line)){inside=true;hidden.push(line);continue;}
    if(!fence&&!marker)line=line.replace(/ \^[a-zA-Z0-9-]+(?=\r?\n?$)/,'');
    if(!fence&&/^\|\s*in\s*\|/.test(line))continue;
    kept.push(line);
  }
  return kept.concat(hidden).join('');
}

export function mirroredContent(body){const start='<!-- llmwiki:source:start -->',end='<!-- llmwiki:source:end -->',a=body.indexOf(start),b=body.indexOf(end);if(a<0||b<a)return null;return body.slice(a+start.length,b).replace(/^\n## Source content\n\n/,'').replace(/\n$/,'');}

export function sectionText(body,names){const lines=body.split(/\r?\n/),out=[];let inside=false;for(const line of lines){const heading=/^##[ \t]+(.+?)\s*$/.exec(line);if(heading){if(inside)break;inside=names.includes(heading[1]);continue;}if(inside)out.push(line);}return out.join('\n').trim();}

export function bodyLinks(body) {
  const visible = body.replace(/<!--[^]*?-->/g, '').replace(/^ {0,3}(`{3,}|~{3,})[^]*?^ {0,3}\1[^\n]*(?:\n|$)/gm, '')
    .replace(/(`+)[^]*?\1/g, '');
  return [...visible.matchAll(/\[\[([^\]]+)\]\]|\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)]
    .map(m => ({written:(m[1] ?? m[2]).split('|')[0], offset:m.index, embedded:visible[m.index-1]==='!'}));
}

export function relationRows(body) {
  const lines = body.replace(/<!--[^]*?-->/g, '').split(/\r?\n/), rows=[];
  let fence=null;
  for (let i=0;i<lines.length;i++) {
    const line=lines[i], marker=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) { if (!fence) fence=marker[1]; else if (marker[1][0]===fence[0] && marker[1].length>=fence.length) fence=null; continue; }
    if (fence || !line.trimStart().startsWith('|')) continue;
    const cells=line.trim().split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim().replace(/\\\|/g,'|'));
    if (!['out','in'].includes(cells[0])) continue;
    rows.push({direction:cells[0], type:cells[1] ?? '', written:bodyLinks(cells[2] ?? '')[0]?.written ?? cells[2] ?? '',
      reason:cells[3] ?? '', line:i+1, valid:cells.length===4});
  }
  return rows;
}

export function listValue(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Explicit metadata migration; untouched YAML pairs and body bytes are retained. */
export function removeHeadFields(source,keys){
 const p=parseDocument(source);if(!p.yaml)return source;const edits=[];
 for(const pair of p.yaml.contents?.items??[])if(keys.includes(pair.key?.value)){const start=pair.key.range[0],end=pair.value?.range?.[2]??pair.key.range[2];edits.push({start,end});}
 let raw=p.raw;for(const e of edits.sort((a,b)=>b.start-a.start))raw=raw.slice(0,e.start)+raw.slice(e.end);
 const metadata=p.metadata?{...p.metadata,fields:Object.fromEntries(Object.entries(p.metadata.fields).filter(([key])=>!keys.includes(key)))}:null;
 const result=p.prefix+raw+p.suffix+(metadata?metadataComment(metadata):'')+p.body;parseDocument(result);return result;
}
