/** Executable setup shapes and partial-answer validation shared by every host. */
import {WikiError} from './core/errors.mjs';
const text={type:'string'},flag={type:'boolean'},texts={type:'array',items:text};
const location={type:['string','null'],description:'Project-relative directory, or null with an existing device binding. Never an absolute OS path.'};
const object=properties=>({type:'object',additionalProperties:false,properties});
const wiki=object({id:text,label:text,path:location,workPath:location,work:text,workReaders:texts,scope:{type:'string',enum:['full','contributions','participation']},comments:flag,participation:object({field:text}),purpose:text,audience:texts,writable:flag,shared:flag,icon:text,default_source:{type:['string','null']}});
const source=object({id:text,label:text,path:location,wikis:texts,writable:flag,icon:text});
const schema=object({id:text,label:text,author:text,readers:texts,editor:{type:'string',enum:['builtin','obsidian','both']},language:{type:'string',enum:['de','en']},wikis:{type:'array',items:wiki},sources:{type:'array',items:source}});
export function setupContract(expected=null){return {
 format:'llmwiki-setup-contract/1',answers_schema:schema,
 rules:['Drafts may contain partial answers. Only configure initializes the wiki.',
  'purpose and audience belong to each wikis entry, not the top level.',
  'readers at the top level declares who can read the project folder. Ask explicitly; missing means unknown, not private.',
  'For every external working folder, collect workReaders. A missing answer prevents automatic authorship attribution.',
  'scope defaults to full. contributions reuses an existing work ID and does not subscribe to the target wiki. The target bundle identity and readers are read and pinned during configure; no document is released by setup.',
  'wiki_folders/source_folders/work_folder are not request fields. Use wikis/sources and wikis[].workPath.',
  'Top-level answers merge; a supplied wikis or sources array replaces that entire array. Preserve previously collected entries.',
  'Draft expected is inspect.draft_sha256 or the previous draft result.sha256. Configure expected is inspect.sha256, null only for an unconfigured project.',
  'Example values are placeholders. Substitute actual user answers; never treat them as consent.'],
 requests:{draft:{action:'setup.draft',answers:{author:'<author>',editor:'both'},expected},
 configure:{action:'configure',id:'wissen',label:'<project name>',author:'<author>',readers:['<author>'],editor:'both',wikis:[{id:'wiki',label:'<wiki name>',path:'Wiki',purpose:'<user purpose>',audience:['<reader>']}],sources:[{id:'quellen',label:'<source name>',path:'Quellen',wikis:['wiki']}]}}
};}
export function validateSetupAnswers(answers){
 const fail=(field,message,expected)=>{throw new WikiError('setup',message,{field,expected,next_request:{action:'inspect'},setup_contract:setupContract()});};
 const walk=(value,s,field)=>{
  const type=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(![s.type].flat().includes(type))fail(field,'Invalid setup value at '+field+'.',s.type);
  if(s.enum&&!s.enum.includes(value))fail(field,'Unsupported setup value at '+field+'.',s.enum);
  if(type==='object')for(const [key,item] of Object.entries(value)){
   if(!Object.hasOwn(s.properties,key))fail(field+'.'+key,'Unknown setup field '+field+'.'+key+'. Use the published setup contract.',Object.keys(s.properties));
   walk(item,s.properties[key],field+'.'+key);
  }
  if(type==='array')value.forEach((item,i)=>walk(item,s.items,field+'['+i+']'));
  if(s===location&&typeof value==='string'&&(/^[\/\\]|^[a-z]:/i.test(value)||value.split(/[\/\\]/).includes('..')))fail(field,'Use a project-relative path or null with a device binding.',location.description);
 };
 walk(answers,schema,'answers');
}
