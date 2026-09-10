/** IMP-08-07-04: recursive property form; edits stay in this dialog until Apply. */
(function(global){
'use strict';
const t=key=>String(global.I18n.message(key));
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const typeOf=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const defaults={string:()=>'',number:()=>0,boolean:()=>false,null:()=>null,object:()=>({}),array:()=>[]};
const names={string:'Text',number:'Number',boolean:'Checkbox',null:'Empty value',object:'Object',array:'List'};
function button(text,run){const b=el('button','',t(text));b.type='button';b.addEventListener('click',run);return b;}
function open({key,source,modal,onApply}){
 const d=modal(t('Property details')+' · '+key);d.dialog.classList.add('ws-property-dialog');
 const tree=el('form','ws-property-tree'),error=el('p','ws-property-error');error.setAttribute('role','alert');
 const hint=el('p','ws-muted',t('Changes are applied to your draft. Save the note to write the file.'));d.content.append(hint,tree,error);tree.addEventListener('submit',e=>e.preventDefault());
 let draft=source;const expanded=new Set(['[]']);
 function applyOperation(op,redraw=false){try{draft=global.WikiCore.patchPropertyDetails(draft,key,[op]);error.textContent='';if(redraw)render();return true;}catch(e){error.textContent=global.I18n.fromError(e);return false;}}
 function pathName(path){return key+path.map(p=>typeof p==='number'?'['+p+']':'.'+p).join('');}
 function typePicker(){const select=el('select');for(const [value,label]of Object.entries(names))select.append(new Option(t(label),value));return select;}
 function node(value,path,parent){
  const kind=typeOf(value),label=pathName(path),row=el('div','ws-property-node');row.dataset.propertyPath=JSON.stringify(path);parent.append(row);
  const line=el('div','ws-property-line');row.append(line);
  const title=el('label','ws-property-node-label',path.length?String(path.at(-1)):key);line.append(title);
  if(kind==='object'||kind==='array'){
   const details=el('details','ws-property-children'),summary=el('summary','',t(names[kind])+' · '+Object.keys(value).length);summary.setAttribute('aria-label',label);details.append(summary);line.append(details);
   const children=el('div','ws-property-child-list');details.append(children);let populated=false;
   function populate(){if(populated)return;populated=true;for(const [part,child]of Object.entries(value))node(child,[...path,kind==='array'?Number(part):part],children);
    const add=el('div','ws-property-add');const name=kind==='object'?el('input'):null;if(name){name.placeholder=t('Field name');name.setAttribute('aria-label',t('Field name')+' '+label);add.append(name);}const chooser=typePicker();chooser.setAttribute('aria-label',t('New value type')+' '+label);add.append(chooser);
    add.append(button(kind==='object'?'Add field':'Add entry',()=>{if(!tree.reportValidity())return;expanded.add(JSON.stringify(path));applyOperation({op:'add',path,...(name?{key:name.value.trim()}:{}),value:defaults[chooser.value]()},true);}));children.append(add);
   }
   details.open=path.length<2||expanded.has(JSON.stringify(path));if(details.open)populate();details.addEventListener('toggle',()=>{if(details.open){expanded.add(JSON.stringify(path));populate();}else expanded.delete(JSON.stringify(path));});
  }else if(kind==='null')line.append(el('span','ws-muted',t('Empty value')));
  else{
   const input=el(kind==='string'?'textarea':'input');input.setAttribute('aria-label',label);title.append(input);
   if(kind==='string'){input.rows=value.includes('\n')?3:1;input.value=value;}
   else{input.type=kind==='boolean'?'checkbox':'number';if(kind==='boolean')input.checked=value;else{input.step='any';input.required=true;input.value=String(value);}}
   input.addEventListener('change',()=>{if(!input.reportValidity())return;const next=kind==='boolean'?input.checked:kind==='number'?Number(input.value):input.value;applyOperation({op:'set',path,value:next});});
  }
  if(path.length){
   const actions=el('div','ws-property-node-actions'),type=typePicker();type.value=kind;type.setAttribute('aria-label',t('Property type')+' '+label);
   const replace=button('Replace value',()=>{if(!tree.reportValidity())return;applyOperation({op:'set',path,value:defaults[type.value]()},true);});replace.hidden=true;
   type.addEventListener('change',()=>{replace.hidden=type.value===kind;});actions.append(type,replace,button('Remove entry',()=>{if(!tree.reportValidity())return;applyOperation({op:'remove',path},true);}));row.append(actions);
  }
 }
 function render(){tree.replaceChildren();node(global.WikiCore.parseDocument(draft).head[key],[],tree);}
 d.foot.append(button('Cancel',()=>d.dialog.close()),button('Apply',()=>{if(!tree.reportValidity()||error.textContent)return;try{onApply(draft);d.dialog.close();}catch(e){error.textContent=global.I18n.fromError(e);}}));render();
 const first=tree.querySelector('input,textarea');first?.focus();return d;
}
global.PropertyDetails={open};
})(globalThis);
