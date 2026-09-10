/** IMP-08-07-04 / ADR-11: typed property edits with source ranges, never a whole-head rewrite. */
import {isAlias,isMap,isSeq,isScalar,stringify} from 'yaml';
import {parseDocument} from './core/document.mjs';
import {requireThat} from './core/errors.mjs';
const protectedFields=new Set(['id','generated','resource','extraction','source_id']);
const safeKey=k=>typeof k==='string'&&k.length>0&&!['__proto__','prototype','constructor'].includes(k)&&!/[\x00-\x1f]/.test(k);
function validValue(value,depth=0){
 requireThat(depth<=32,'property','The property is nested too deeply.');
 if(value===null||typeof value==='boolean'||typeof value==='string')return;
 if(typeof value==='number'){requireThat(Number.isFinite(value),'property','Supply a finite number.');return;}
 if(Array.isArray(value)){value.forEach(v=>validValue(v,depth+1));return;}
 requireThat(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'property','Unsupported property value.');
 for(const [key,v]of Object.entries(value)){requireThat(safeKey(key),'property','Invalid property name.');validValue(v,depth+1);}
}
function safeNode(node){
 requireThat(!isAlias(node)&&!node?.anchor&&!node?.tag,'property','Anchors, aliases or custom tags require source editing.');
 if(isMap(node))for(const pair of node.items){requireThat(isScalar(pair.key)&&typeof pair.key.value==='string','property','Complex YAML keys require source editing.');safeNode(pair.key);safeNode(pair.value);}
 if(isSeq(node))node.items.forEach(safeNode);
}
function child(node,key){
 requireThat(isMap(node)&&safeKey(key)||isSeq(node)&&Number.isInteger(key)&&key>=0&&key<node.items.length,'property','The property path no longer exists.');
 requireThat(node.has(key),'property','The property path no longer exists.');return node.get(key,true);
}
function locate(root,path){let node=root;for(const part of path)node=child(node,part);return node;}
function replaceNode(parsed,node,next){
 requireThat(node?.range,'property','This YAML value needs source editing.');
 const [start,end]=node.range,raw=parsed.raw,old=raw.slice(start,end),newline=raw.includes('\r\n')?'\r\n':'\n';
 const prefix=raw.slice(raw.lastIndexOf('\n',start-1)+1,start),indent=/^ *(?:- )+$/.test(prefix)?prefix.length:/^ */.exec(prefix)[0].length;
 // Keep the original trailing comment in the untouched range after end.
 next.comment=null;next.commentBefore=null;
 if(isScalar(next)&&typeof next.value==='string'&&(next.value.includes('\n')||['BLOCK_LITERAL','BLOCK_FOLDED'].includes(next.type)))next.type='QUOTE_DOUBLE';
 let written=stringify(next,{lineWidth:0}).replace(/\n$/,'');
 written=written.split('\n').map((line,i)=>i?' '.repeat(indent)+line:line).join(newline);
 if(/\n$/.test(old))written+=newline;
 return parsed.prefix+raw.slice(0,start)+written+raw.slice(end)+parsed.suffix+(parsed.metadataPrefix??'')+parsed.body;
}
export function patchPropertyDetails(source,key,operations){
 requireThat(safeKey(key)&&!protectedFields.has(key),'property','This property is protected.');
 requireThat(Array.isArray(operations)&&operations.length<=1000,'property','Invalid property operations.');
 let result=source;
 for(const op of operations){
  const p=parseDocument(result),root=p.yaml?.get(key,true);requireThat(root,'property','The property is missing.');safeNode(root);
  requireThat(Array.isArray(op.path)&&op.path.length<=32,'property','Invalid property path.');
  const target=locate(root,op.path);let changed,node=target;
  if(op.op==='set'){
   requireThat(op.path.length>0,'property','Keep the outer property type.');validValue(op.value);
   if(isScalar(target)&&Object.is(target.value,op.value))continue;
   changed=isScalar(target)&&!(op.value&&typeof op.value==='object')?target.clone():p.yaml.createNode(op.value);
   if((isMap(changed)||isSeq(changed))&&!isMap(target)&&!isSeq(target))changed.flow=true;
   if(isScalar(changed)){changed.value=op.value;if(typeof op.value!=='string')changed.type=undefined;}
  }else if(op.op==='add'){
   validValue(op.value);requireThat(isMap(target)||isSeq(target),'property','Add entries to an object or list.');changed=target.clone();
   if(isMap(target)){requireThat(safeKey(op.key)&&!target.has(op.key),'property','Choose a new, valid property name.');changed.set(op.key,p.yaml.createNode(op.value));}
   else changed.add(p.yaml.createNode(op.value));
  }else if(op.op==='remove'){
   requireThat(op.path.length>0,'property','Keep the outer property.');node=locate(root,op.path.slice(0,-1));changed=node.clone();changed.delete(op.path.at(-1));
  }else requireThat(false,'property','Unknown property operation.');
  result=replaceNode(p,node,changed);parseDocument(result);
 }
 return result;
}
