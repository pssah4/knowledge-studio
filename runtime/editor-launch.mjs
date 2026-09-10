/** Node host lifecycle and project restart launcher, ADR-29. Inherits host sandbox. */
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {inspect} from './project.mjs';
import {loadBindings} from './node-input.mjs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createEditorHost} from './editor-host.mjs';
import {requireThat} from './core/errors.mjs';
import {editorDestination} from './citations.mjs';
const localBindingAllowed=typeof __LLMWIKI_ALLOW_LOCAL_BINDING__==='undefined'||__LLMWIKI_ALLOW_LOCAL_BINDING__;
const hostOpenTool=typeof __LLMWIKI_HOST_OPEN_TOOL__!=='undefined'?__LLMWIKI_HOST_OPEN_TOOL__:null;
const profile=typeof __LLMWIKI_PROFILE__!=='undefined'?__LLMWIKI_PROFILE__:'local';
const exec=promisify(execFile),STATE='.llmwiki/editor-server.json';
const version=typeof __LLMWIKI_VERSION__!=='undefined'?__LLMWIKI_VERSION__:'development';
async function picker(){
 try{
  if(process.platform==='darwin')return (await exec('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Zusätzlichen Wiki- oder Quellenordner verbinden")'],{timeout:120000})).stdout.trim();
  if(process.platform==='win32')return (await exec('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; if ($picker.ShowDialog() -eq "OK") { $picker.SelectedPath }'],{timeout:120000})).stdout.trim()||null;
  throw Error('Native folder selection is unavailable on this host. Connect the folder with the agent.');
 }catch(error){if(/User canceled|Benutzer.*abgebrochen|\(-128\)/i.test(error.message))return null;throw error;}
}
async function state(root){try{return JSON.parse((await root.read(STATE))?.text??'null');}catch{return null;}}
async function probe(data,op='catalog'){
 if(!data||!/^http:\/\/127\.0\.0\.1:\d+$/.test(data.origin)||!/^[a-f0-9]{64}$/.test(data.token))return null;
 try{const response=await fetch(data.origin+'/api',{method:'POST',headers:{Origin:data.origin,Authorization:'Bearer '+data.token,'Content-Type':'application/json'},body:JSON.stringify({op}),signal:AbortSignal.timeout(1000)});const body=await response.json();return body.ok?body.result:null;}catch{return null;}
}
async function openURL(url){if(process.platform==='darwin')await exec('/usr/bin/open',[url]);else if(process.platform==='win32')await exec('rundll32.exe',['url.dll,FileProtocolHandler',url]);else await exec('xdg-open',[url]);}
export async function serveEditor(root,html,{bindingsFile=null}={}){
 const capability=await editorPreflight(root,{bindingsFile});if(capability.status!=='available')return capability;
 const old=await state(root);requireThat(!await probe(old),'editor_running','The editor is already running. Use editor.start.');
 let host;const opts={html,token:old?.token,port:old?.port??0,pickFolder:picker,bindingsFile};
 try{host=await createEditorHost(root,opts);}catch(error){if(error.code!=='EADDRINUSE')throw error;host=await createEditorHost(root,{...opts,port:0});}
 const current=await root.read(STATE);await root.write(STATE,JSON.stringify({format:'llmwiki-editor-server/1',version,root:root.root,origin:host.origin,port:Number(new URL(host.origin).port),token:host.token,pid:process.pid})+'\n',{expected:current?.sha256??null,mode:0o600});await fs.chmod(await root.location(STATE),0o600);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>host.close().finally(()=>process.exit(0)));
 return {url:host.url,running:true,transport:'loopback',version};
}
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
async function launcher(root,entry,bindingsFile){
 const request=JSON.stringify({action:'editor.start',open:true}),args=[process.execPath,entry,'--root',root.root,'--input',request,...(bindingsFile?['--bindings',bindingsFile]:[])];
 const windows=process.platform==='win32';
 requireThat(args.every(v=>!/[\r\n]/.test(v)&&(!windows||!/%/.test(v))),'launcher','Paths cannot be safely represented in this platform launcher.');
 const name=windows?'Editor starten.cmd':'Editor starten.command';
 const encoded=Buffer.from(JSON.stringify(args.slice(1))).toString('base64');
 const script="const r=require('node:child_process').spawnSync(process.execPath,JSON.parse(Buffer.from('"+encoded+"','base64').toString()),{stdio:'inherit'});process.exit(r.status??1)";
 const text=windows?'@echo off\r\n"'+process.execPath+'" -e "'+script+'"\r\n':'#!/bin/sh\nexec '+args.map(quote).join(' ')+'\n';
 const previous=await root.read(name);if(previous?.text!==text)await root.write(name,text,{expected:previous?.sha256??null});if(!windows)await fs.chmod(await root.location(name),0o700);return path.join(root.root,name);
}
/** Probe only hosts whose profile permits local binding. */
async function checkBinding(){
 await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve()));
 });
}
const diagnostic=error=>({code:error.code??'editor_host',message:String(error.message).replace(/[a-f0-9]{64}/gi,'[redacted]').slice(0,1000)});
export async function editorPreflight(root,{profile:hostProfile=profile,bindingsFile=null,checkBinding:check=checkBinding}={}){
 const bindings=await loadBindings(root,{file:bindingsFile,readOnly:true}),saved=await inspect(root,{bindings});
 const destination=saved.project?await editorDestination(root,saved.project):{available:false,reason:'project_missing'};
 const standaloneOpen=destination.available&&hostOpenTool&&saved.editor?.entry_path?{tool:hostOpenTool,arguments:{path:saved.editor.entry_path}}:null;
 const folders=saved.locations??[],byID=id=>folders.find(f=>f.id===id);
 const handoff={project_root:root.root,entry_path:saved.editor?.entry_path??null,entry_exists:saved.editor?.exists??false,
  obsidian:(saved.project?.connections??[]).flatMap(c=>c.works.map(id=>({connection:c.id,label:c.label,folder:id,path:byID(id)?.location??null,binding_available:byID(id)?.binding_available??false}))),
  standalone:{status:standaloneOpen?'host_action_required':destination.available?'native_tool_required':'unavailable',open:standaloneOpen,reason:destination.reason??null,browsers:['Chrome','Edge'],browser_verified:false,requires_folder_selection:true,
   steps:[{role:'project',path:root.root},...folders.filter(f=>f.external).map(f=>({role:f.kind,folder:f.id,path:f.location}))],
   instruction:'Open the canonical HTML in Chrome or Edge. Select its project folder first, then grant only the external folders requested by the editor. Stored settings do not grant browser access; Firefox is not a writable File System Access fallback.'}};
 const issues=[...(saved.issues??[]),...folders.filter(f=>!f.binding_available).map(f=>({code:'binding_missing',folder:f.id}))];
 const base={profile:hostProfile,configuration:saved.next==='choose_task'&&!issues.length?'verified':'incomplete',configuration_issues:issues,editor_mode:saved.project?.editor??null,
  running:false,browser_verified:false,setup_complete:false,process_persistence:'unverified',handoff};
 if(base.configuration!=='verified')return {...base,status:'setup_required',reason:{code:'setup',message:'Resume the existing setup and repair its reported missing fields before opening the editor.'}};
 if(base.editor_mode==='obsidian')return {...base,status:'native_editor',next:'Open the configured working-copy path in Obsidian using the host opening tool; verify with the user.'};
 if(!localBindingAllowed)return {...base,status:'unavailable',reason:{code:'local_binding_forbidden',message:'This host profile uses a sandbox with allowLocalBinding:false. It forbids listening on 127.0.0.1; folder sharing does not change that policy.'},next:standaloneOpen?'The server is unavailable; the standalone editor has a separate valid handoff. Invoke handoff.standalone.open.tool with its exact arguments using the host tool, then check its response. A chat link does not perform this action; do not claim the browser opened without verification.':'Use the guided standalone editor or the configured Obsidian working copy. Do not retry the server or widen sandbox permissions.'};
 try{await check();}catch(error){return {...base,status:'unavailable',reason:diagnostic(error),next:'Local binding failed in this execution environment. Continue with the guided standalone editor or configured Obsidian working copy; do not claim setup is complete.'};}
 return {...base,status:'available',next:'Only start if the browser is on this execution host or an actual host preview is available. A successful socket check proves neither browser access nor process persistence.'};
}
async function childDiagnostic(root,offset){
 const text=(await root.read('.llmwiki/editor-server.log'))?.text??'';
 for(const line of text.slice(offset).trim().split('\n').reverse())try{const item=JSON.parse(line);if(item.ok===false&&item.error)return diagnostic(item.error);}catch{}
 return {code:'editor_process_exited',message:'The editor process exited before becoming ready. See .llmwiki/editor-server.log for this attempt.'};
}
export async function startEditor(root,{entry=process.argv[1],bindingsFile=null,open=false,profile:hostProfile=profile,checkBinding:check=checkBinding,openBrowser=openURL}={}){
 const preflight=await editorPreflight(root,{profile:hostProfile,bindingsFile,checkBinding:check});
 if(preflight.status!=='available')return preflight;
 let data=await state(root),running=await probe(data);
 if(running&&data.version!==version){await probe(data,'stop');running=null;await new Promise(resolve=>setTimeout(resolve,150));}
 const file=await launcher(root,path.resolve(entry),bindingsFile);
 if(!running){
  const offset=((await root.read('.llmwiki/editor-server.log'))?.text??'').length;
  const logPath=await root.location('.llmwiki/editor-server.log',{createParent:true}),log=await fs.open(logPath,'a',0o600);
  let child,failure=null,exited=false;
  try{child=spawn(process.execPath,[path.resolve(entry),'--root',root.root,'--input',JSON.stringify({action:'editor.serve'}),...(bindingsFile?['--bindings',bindingsFile]:[])],{detached:true,stdio:['ignore',log.fd,log.fd],windowsHide:true});child.once('error',error=>{failure=error;});child.once('exit',()=>{exited=true;});child.unref();}catch(error){failure=error;}finally{await log.close();}
  for(let i=0;i<40&&!failure&&!exited;i++){await new Promise(resolve=>setTimeout(resolve,200));data=await state(root);if(data?.version===version&&await probe(data)){running=true;break;}}
  if(!running){if(child&&!exited&&!failure)child.kill();return {...preflight,status:'unavailable',reason:failure?diagnostic(failure):exited?await childDiagnostic(root,offset):{code:'editor_start_timeout',message:'The editor did not become ready within eight seconds. Process persistence is not established.'},next:'Do not repeat this failed attempt unchanged. Resolve the reported host capability or use the guided standalone/native editor.'};}
 }
 const url=data.origin+'/#'+data.token;let browser_open={status:'not_requested'};
 if(open)try{await openBrowser(url);browser_open={status:'requested'};}catch(error){browser_open={status:'failed',reason:diagnostic(error)};}
 return {...preflight,status:'running',url,launcher:file,version,running:true,browser_open,scope:'This host machine only; remote/container hosts must expose their own browser preview.',permission:'Confirm the configured folders once in the editor.',next:browser_open.status==='failed'?'Return the personal URL; the browser opener failed.':'Return the personal URL and verify browser access separately. An opening request is not proof that the editor opened.'};
}
export async function stopEditor(root){const data=await state(root);return {stopped:Boolean(await probe(data,'stop'))};}
