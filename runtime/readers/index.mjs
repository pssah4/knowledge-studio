/** Complete source extraction with explicit coverage. No filesystem, process or network access. */
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {openArchive} from './archive.mjs';
import {requireThat} from '../core/errors.mjs';

const textTypes=new Set(['md','markdown','txt','csv','tsv','json','yaml','yml','xml','log']);
const decoder=()=>new TextDecoder('utf-8',{fatal:true});
const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const local=tag=>tag.split(':').pop();
function parseXml(bytes){
  const text=decoder().decode(bytes);
  requireThat(!/<!\s*(DOCTYPE|ENTITY)/i.test(text),'xml','DTD and entity declarations are not accepted.');
  requireThat(XMLValidator.validate(text)===true,'xml','Malformed source XML.');
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,removeNSPrefix:false,parseTagValue:false,parseAttributeValue:false,trimValues:false});
  function nodes(values,inherited={}){return values.map(value=>{
    const tag=Object.keys(value).find(k=>k!==':@'),raw=Object.fromEntries(Object.entries(value[':@']??{}).map(([k,v])=>[k.replace(/^@_/,''),v])),namespaces={...inherited};
    for(const [key,uri]of Object.entries(raw))if(key.startsWith('xmlns:'))namespaces[key.slice(6)]=uri;
    const attrs={};for(const [key,v]of Object.entries(raw)){
      if(key==='xmlns'||key.startsWith('xmlns:'))continue;
      const prefix=key.includes(':')?key.split(':')[0]:null;
      // OOXML has both numeric `id` and namespaced relationship `r:id` on
      // a slide. Stripping their prefixes loses one depending on XML order.
      const relationship=prefix&&(prefix==='r'||/\/relationships$/.test(namespaces[prefix]??''));
      attrs[relationship?'r:'+local(key):local(key)]=v;
    }
    return {tag:local(tag),attrs,children:Array.isArray(value[tag])?nodes(value[tag],namespaces):[],text:tag==='#text'?String(value[tag]):''};
  });}
  return {tag:'root',attrs:{},children:nodes(parser.parse(text)),text:''};
}
function descendants(node,tag){const out=[];if(node.tag===tag)out.push(node);for(const child of node.children)out.push(...descendants(child,tag));return out;}
function words(node){if(node.tag==='#text')return node.text;if(node.tag==='tab')return '\t';if(['br','cr'].includes(node.tag))return '\n';return node.children.map(words).join('');}
const child=(node,tag)=>node.children.find(n=>n.tag===tag);
const plain=node=>descendants(node,'t').map(words).join('');
function table(rows){if(!rows.length)return '';const width=Math.max(...rows.map(r=>r.length)),escape=v=>String(v??'').replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
  const lines=rows.map(row=>'| '+Array.from({length:width},(_,i)=>escape(row[i])).join(' | ')+' |');lines.splice(1,0,'| '+Array(width).fill('---').join(' | ')+' |');return lines.join('\n');}
function resolvePart(part,target){
  requireThat(!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)&&!/[\\\x00]/.test(target),'xml','Invalid package relationship.');
  const out=part.split('/').slice(0,-1);for(const p of target.split('/')){if(p==='..'){requireThat(out.length,'xml','Relationship leaves the document.');out.pop();}else if(p&&p!=='.')out.push(p);}return out.join('/');
}
function rels(files,part){
  const pieces=part.split('/'),name=pieces.pop(),rel=[...pieces,'_rels',name+'.rels'].join('/');
  if(!files[rel])return new Map();
  return new Map(descendants(parseXml(files[rel]),'Relationship').map(r=>[r.attrs.Id,{...r.attrs,path:r.attrs.TargetMode==='External'?null:resolvePart(part,r.attrs.Target)}]));
}
function metadata(files,original){
  const out={created_at:original?.created_at??null,created_at_basis:original?.created_at_basis??'unknown',modified_at:original?.modified_at??null};
  if(files['docProps/core.xml']){
    const doc=parseXml(files['docProps/core.xml']),created=stamp(words(descendants(doc,'created')[0]??{children:[]})),modified=stamp(words(descendants(doc,'modified')[0]??{children:[]}));
    if(created){out.created_at=created;out.created_at_basis='document_metadata';}if(modified)out.modified_at=modified;
  }
  return out;
}
function office(files,ext,original){
  const gaps=[],parts=[];
  for(const name of Object.keys(files)){
    if(/\/(media|embeddings)\//.test(name))gaps.push({code:'visual_content',part:name,message:'Read this embedded object and supply its complete relevant content.'});
    if(/vbaProject|activeX/i.test(name))gaps.push({code:'active_content',part:name,message:'Active content is preserved in the original and is never executed.'});
  }
  if(ext==='docx'){
    requireThat(files['word/document.xml'],'format','DOCX has no document body.');
    const relationships=rels(files,'word/document.xml');
    const inline=node=>{
      if(node.tag==='footnoteReference')return '[^footnote-'+node.attrs.id+']';
      if(node.tag==='endnoteReference')return '[^endnote-'+node.attrs.id+']';
      if(node.tag==='delText')return '[Deleted: '+words(node)+']';
      if(node.tag==='hyperlink'){const content=node.children.map(inline).join(''),ref=relationships.get(node.attrs['r:id']??node.attrs.id);return ref?.TargetMode==='External'?'['+content+']('+ref.Target+')':content;}
      if(node.tag==='#text'||['tab','br','cr'].includes(node.tag))return words(node);
      return node.children.map(inline).join('');
    };
    const render=node=>{
      if(node.tag==='p')return inline(node)+'\n\n';
      if(node.tag==='tbl')return table(node.children.filter(c=>c.tag==='tr').map(row=>row.children.filter(c=>c.tag==='tc').map(cell=>cell.children.map(render).join('').trim())))+'\n\n';
      return node.children.map(render).join('');
    };
    const document=parseXml(files['word/document.xml']);parts.push(render(document).trim());
    for(const name of Object.keys(files).filter(n=>/^word\/(footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(n)).sort()){
      const extra=parseXml(files[name]),kind=/word\/(footnotes|endnotes)\.xml$/.exec(name)?.[1]?.slice(0,-1);
      if(kind){for(const note of descendants(extra,kind))if(Number(note.attrs.id)>=0)parts.push('[^'+kind+'-'+note.attrs.id+']: '+render(note).trim().replace(/\n/g,'\n    '));}
      else parts.push('## '+name+'\n\n'+render(extra).trim());
    }
    for(const node of [...descendants(document,'oMath'),...descendants(document,'altChunk')])gaps.push({code:'special_content',part:node.tag,message:'Read the mathematical or embedded document content.'});
    if(descendants(document,'numPr').length)gaps.push({code:'list_numbering',part:'word/document.xml',message:'Verify generated list numbers and their hierarchy against the original.'});
  } else if(['pptx','potx'].includes(ext)){
    requireThat(files['ppt/presentation.xml'],'format','PPTX has no presentation.');
    const pres=parseXml(files['ppt/presentation.xml']),relations=rels(files,'ppt/presentation.xml');
    // Section extensions also contain sldId nodes, but those are numeric
    // references back to the main list, not additional slide relationships.
    const slides=child(child(pres,'presentation')??pres,'sldIdLst')?.children.filter(n=>n.tag==='sldId')??[];
    requireThat(slides.length,'format','Presentation has no ordered slides.');
    for(const [index,slide] of slides.entries()){
      const target=relations.get(slide.attrs['r:id']??slide.attrs.id)?.path;requireThat(target&&files[target],'format','Presentation slide relationship is missing.');
      const doc=parseXml(files[target]);
      const paragraphs=descendants(doc,'p').map(n=>words(n)).filter(Boolean);
      parts.push('## Slide '+(index+1)+'\n\n'+paragraphs.join('\n\n'));
      for(const ref of rels(files,target).values())if(ref.path&&/notesSlide$/.test(ref.Type??'')){
        requireThat(files[ref.path],'format','Speaker notes are missing.');parts.push('### Speaker notes\n\n'+descendants(parseXml(files[ref.path]),'p').map(words).join('\n\n'));
      }
      if(descendants(doc,'chart').length)gaps.push({code:'visual_content',part:target,message:'Read the chart and its underlying data.'});
      if(descendants(doc,'cxnSp').length||descendants(doc,'grpSp').length||descendants(doc,'spPr').some(s=>child(s,'solidFill')||child(s,'gradFill')))
        gaps.push({code:'visual_structure',part:target,message:'Read spatial grouping, connectors and color meaning on this slide; paragraph text alone does not preserve this structure.'});
    }
  } else {
    requireThat(files['xl/workbook.xml'],'format','XLSX has no workbook.');
    const book=parseXml(files['xl/workbook.xml']),relations=rels(files,'xl/workbook.xml');
    if(files['xl/styles.xml']){const styles=parseXml(files['xl/styles.xml']);for(const format of descendants(styles,'numFmt'))parts.push('Number format '+format.attrs.numFmtId+': '+format.attrs.formatCode);}
    const date1904=descendants(book,'workbookPr')[0]?.attrs.date1904;if(date1904)parts.push('Workbook date system: '+(['1','true'].includes(date1904)?'1904':'1900'));
    const strings=files['xl/sharedStrings.xml']?descendants(parseXml(files['xl/sharedStrings.xml']),'si').map(plain):[];
    for(const sheet of descendants(book,'sheet')){
      const target=relations.get(sheet.attrs['r:id']??sheet.attrs.id)?.path;requireThat(target&&files[target],'format','Worksheet relationship is missing.');
      const doc=parseXml(files[target]),rows=[['Cell','Content','Formula']];
      for(const cell of descendants(doc,'c')){
        const value=words(child(cell,'v')??{children:[]}),formula=words(child(cell,'f')??{children:[]});let content;
        if(cell.attrs.t==='s'){content=strings[Number(value)];requireThat(content!==undefined,'format','Shared string reference is missing.');}
        else if(cell.attrs.t==='inlineStr')content=plain(cell);
        else if(cell.attrs.t==='b')content=value==='1'?'TRUE':'FALSE';
        else content=value;
        // Preserve explicit cell coordinates, blanks, formula text and cached
        // values. Never infer a new value by executing a workbook formula.
        rows.push([cell.attrs.r??'',content,formula]);
        if(child(cell,'f')?.attrs.t==='shared'&&!gaps.some(g=>g.code==='shared_formula'&&g.part===target))gaps.push({code:'shared_formula',part:target,message:'Verify the shared formulas in this sheet, starting with '+cell.attrs.r+'.'});
        if(cell.attrs.s!==undefined&&cell.attrs.t!=='s'&&cell.attrs.t!=='inlineStr'&&!gaps.some(g=>g.code==='formatted_cell'&&g.part===target))gaps.push({code:'formatted_cell',part:target,message:'Verify displayed numeric/date values in this sheet; raw cell values are preserved.'});
      }
      parts.push('## '+sheet.attrs.name+(sheet.attrs.state?' ('+sheet.attrs.state+')':'')+'\n\n'+table(rows));
      for(const merged of descendants(doc,'mergeCell'))parts.push('Merged cells: '+merged.attrs.ref);
      if(descendants(doc,'drawing').length)gaps.push({code:'visual_content',part:target,message:'Read the sheet drawing or chart.'});
    }
    for(const name of Object.keys(files).filter(n=>/^xl\/(comments|threadedComments\/).+\.xml$/.test(n)))parts.push('## '+name+'\n\n'+plain(parseXml(files[name])));
  }
  return {text:parts.join('\n\n'),metadata:metadata(files,original),gaps};
}

export async function extractSource({bytes,name,metadata:original={},readPDF=null}){
  const metadata={created_at:original.created_at??null,created_at_basis:original.created_at_basis??'unknown',modified_at:original.modified_at??null};
  try{
    requireThat(bytes instanceof Uint8Array&&bytes.length<=128*1024*1024,'size','Select a source within the 128 MiB reading limit.');
    const ext=String(name).split('.').pop().toLowerCase();let result;
    if(textTypes.has(ext))result={text:decoder().decode(bytes),metadata,gaps:[]};
    else if(['docx','xlsx','pptx','potx'].includes(ext))result=office(openArchive(bytes),ext,metadata);
    else if(['png','jpg','jpeg','gif','webp','avif'].includes(ext))return {text:'',complete:false,metadata,gaps:[{code:'visual_content',part:name,message:'Read the full image through host vision: complete transcription, visual description, separate interpretation and explicit unreadable regions. Never infer completion from a filename.'}]};
    else if(ext==='pdf'&&readPDF)result=await readPDF(bytes,metadata);
    else return {text:'',complete:false,metadata,gaps:[{code:ext==='pdf'?'parser_missing':'unsupported_format',message:'A complete host reading is required for this format.'}]};
    if(!result.text.trim())result.gaps.push({code:'empty_content',message:'No readable source content.'});
    if(result.text.includes('\uFFFD'))result.gaps.push({code:'replacement_characters',message:'The extraction contains undecodable characters.'});
    return {...result,complete:result.gaps.length===0};
  }catch(error){return {text:'',complete:false,metadata,gaps:[{code:error.code??'reading_failed',message:error.message}]};}
}
