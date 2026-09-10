/** Reads the existing Markdown type register. Ontology content is never executable. */
import {parseDocument} from './document.mjs';
import {requireThat, WikiError} from './errors.mjs';

const GENUS_KEYS=['Label','Question','Order','Classes','Required from stable','Sections','Edges out','Related required','Stale interval','Origin'];
const EDGE_KEYS=['Domain','Range','Transitive','Definition','Example'];
const identifier=/^[a-z][a-z0-9_-]*$/;
const bars=value=>value===''?[]:value.split('|').map(s=>s.trim());

export function readRegister(text) {
  const parsed=parseDocument(text);
  requireThat(parsed.head.register_version===1 && Object.keys(parsed.head).length===1,'ontology','Unknown or missing register version.');
  const sections=new Set(), genera=new Map(), edges=new Map();let section=null, entry=null;
  for(const [index,raw] of parsed.body.split(/\r?\n/).entries()){
    const line=raw.trim(),heading=/^(#+)\s+(.+)$/.exec(line);
    if(heading){
      const [,level,title]=heading;entry=null;
      if(level.length===1){section=null;continue;}
      if(level.length===2){
        requireThat(['Genera','Edges'].includes(title)&&!sections.has(title),'ontology','Unknown or duplicate ontology section.',{line:index+1});
        sections.add(title);section=title;continue;
      }
      requireThat(level.length===3&&section&&identifier.test(title),'ontology','Invalid ontology entry.',{line:index+1});
      const rows=section==='Genera'?genera:edges;
      requireThat(!rows.has(title),'ontology','Duplicate ontology entry.',{type:title});
      entry={name:title,line:index+1,fields:Object.create(null)};rows.set(title,entry);continue;
    }
    if(!entry||!line)continue;
    const match=/^-\s+([^:]+):\s?(.*)$/.exec(line);
    requireThat(match,'ontology','Unexpected text in an ontology entry.',{line:index+1});
    const [,key,value]=match;
    requireThat((section==='Genera'?GENUS_KEYS:EDGE_KEYS).includes(key)&&!Object.hasOwn(entry.fields,key),
      'ontology','Unknown or duplicate ontology field.',{field:key,line:index+1});
    entry.fields[key]=value.trim();
  }
  requireThat(sections.size===2&&genera.size>0&&edges.size>0,'ontology','Register must define genera and edges.');
  const orders=new Set();
  for(const genus of genera.values()){
    const f=genus.fields;
    requireThat(GENUS_KEYS.every(k=>Object.hasOwn(f,k)),'ontology','Genus is missing required fields.',{type:genus.name});
    requireThat(['core','inherited'].includes(f.Origin),'ontology','Unknown genus origin.');
    requireThat(f.Origin==='inherited'||Boolean(f.Label&&f.Question),'ontology','Core genus needs a label and question.');
    requireThat(/^[1-9]\d*$/.test(f.Order)&&!orders.has(Number(f.Order)),'ontology','Genus order must be positive and unique.');
    orders.add(Number(f.Order));
    requireThat(['true','false'].includes(f['Related required']),'ontology','Related required must be true or false.');
    requireThat(f['Stale interval']==='null'||/^[1-9]\d*$/.test(f['Stale interval']),'ontology','Invalid stale interval.');
    for(const key of ['Classes','Required from stable','Edges out']){
      const items=bars(f[key]);requireThat(items.every(v=>identifier.test(v))&&new Set(items).size===items.length,'ontology','Invalid ontology value list.',{field:key});
    }
    requireThat(bars(f['Sections']).every(Boolean),'ontology','Empty required section.');
    Object.assign(genus,{label:f.Label,question:f.Question,order:Number(f.Order),classes:bars(f.Classes),required:bars(f['Required from stable']),
      sections:bars(f.Sections),edgesOut:bars(f['Edges out']),relatedRequired:f['Related required']==='true',staleInterval:f['Stale interval']==='null'?null:Number(f['Stale interval'])});
    requireThat(genus.edgesOut.every(k=>edges.has(k)),'ontology','Genus names an unregistered edge.',{type:genus.name});
  }
  for(const edge of edges.values()){
    const f=edge.fields;
    requireThat(f.Domain&&f.Range,'ontology','Edge needs domain and range.');
    if(Object.hasOwn(f,'Transitive'))requireThat(['true','false'].includes(f.Transitive),'ontology','Transitive must be true or false.');
    for(const [key,tokens] of [['Domain',['any']],['Range',['any','same']]]){
      const values=bars(f[key]);
      requireThat(values.length===1&&tokens.includes(values[0]) || values.length>0&&values.every(v=>genera.has(v))&&new Set(values).size===values.length,
        'ontology','Unknown genus in edge '+key.toLowerCase()+'.',{edge:edge.name});
    }
    Object.assign(edge,{domain:bars(f.Domain),range:bars(f.Range),transitive:f.Transitive==='true',definition:f.Definition??'',example:f.Example??''});
  }
  return {version:1,genera,edges};
}

export function edgeAllowed(register,type,source,target){
  const edge=register.edges.get(type),genus=register.genera.get(source);
  if(!edge||!genus||!register.genera.has(target))throw new WikiError('ontology','Unknown or unregistered relationship or document type.',{type,source,target});
  return genus.edgesOut.includes(type)&&(edge.domain.includes('any')||edge.domain.includes(source))
    &&(edge.range.includes('any')||edge.range.includes('same')&&source===target||edge.range.includes(target));
}
