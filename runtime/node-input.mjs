/** Node-only input boundary. Requests are JSON data; no temporary file or shell
 * evaluation is needed. Existing local folder mappings remain usable. */
import path from 'node:path';
import {NodeStore} from './adapters/node.mjs';
import {requireThat,WikiError} from './core/errors.mjs';

const MAX_REQUEST=32*1024*1024;
const flags=new Set(['--root','--input','--bindings','--read-only','--help']);
export function parseArguments(args){
 const parsed={};
 for(let i=0;i<args.length;i++){
  const flag=args[i];requireThat(flags.has(flag),'arguments','Unknown option: '+flag+'. Use --help for supported options.');
  requireThat(!Object.hasOwn(parsed,flag),'arguments','Duplicate option: '+flag);
  if(flag==='--read-only'||flag==='--help')parsed[flag]=true;
  else {const value=args[++i];requireThat(typeof value==='string'&&value.length>0&&!value.startsWith('--'),'arguments','Missing value for '+flag);parsed[flag]=value;}
 }
 if(!parsed['--help'])requireThat(parsed['--root']&&parsed['--input'],'arguments','Use --root ABSOLUTE_PROJECT --input JSON (or a request file, or - for stdin).');
 return parsed;
}
async function fileText(file,maxBytes){
 const absolute=path.resolve(file),store=new NodeStore(path.dirname(absolute),{writable:false,maxBytes});
 const value=await store.read(path.basename(absolute));
 requireThat(value,'ENOENT','Input file does not exist.',{path:absolute});return value.text;
}
function json(text,code,message){try{return JSON.parse(text);}catch{throw new WikiError(code,message);}}
export async function readRequest(input,stdin=process.stdin){
 let text;
 if(input==='-'){
  const chunks=[];let size=0;
  for await(const chunk of stdin){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;requireThat(size<=MAX_REQUEST,'input_size','Request exceeds 32 MiB.');chunks.push(bytes);}
  text=Buffer.concat(chunks).toString('utf8');
 }else if(/^[\s\uFEFF]*[\[{]/.test(input))text=input;
 else text=await fileText(input,MAX_REQUEST);
 requireThat(Buffer.byteLength(text,'utf8')<=MAX_REQUEST,'input_size','Request exceeds 32 MiB.');
 const request=json(text.replace(/^\uFEFF/,''),'input_json','Supply valid JSON using --input JSON, --input - or an existing request file inside the granted project.');
 requireThat(request&&typeof request==='object'&&!Array.isArray(request)&&typeof request.action==='string'&&request.action.trim(),'input_json','A JSON object with a nonempty action is required.');
 return request;
}
export async function loadBindings(root,{file=null,readOnly=false}={}){
 let text;
 if(file)text=await fileText(file,1024*1024);
 else {
  const found=await root.read('.llmwiki/device-bindings.json')??await root.read('.llmwiki/bindings.json');
  if(!found)return {};text=found.text;
 }
 const value=json(text,'bindings','Device bindings must contain valid JSON.');
 requireThat(value&&typeof value==='object'&&!Array.isArray(value),'bindings','Device bindings must be an object.');
 if(Object.hasOwn(value,'format'))requireThat(value.format==='llmwiki-device-bindings/1','bindings','Unknown device binding format.');
 const folders=Object.hasOwn(value,'format')?value.folders:value;
 requireThat(folders&&typeof folders==='object'&&!Array.isArray(folders),'bindings','Device bindings must map folder IDs to absolute host paths.');
 const bindings={};
 for(const [id,location]of Object.entries(folders)){
  requireThat(id&&!['__proto__','constructor','prototype'].includes(id)&&typeof location==='string'&&path.isAbsolute(location),'bindings','Each device binding needs a folder ID and an absolute host path.',{folder:id});
  bindings[id]=new NodeStore(location,{writable:!readOnly});
 }
 return bindings;
}
