#!/usr/bin/env node
/** CLI requests are JSON data, file contents or stdin; never shell-evaluated code. */
import fs from 'node:fs/promises';
import {editorPreflight,startEditor,serveEditor,stopEditor} from './editor-launch.mjs';
import {NodeStore} from './adapters/node.mjs';
import {dispatch,actions,queryActions} from './dispatch.mjs';
import {extract} from './readers/node.mjs';
import {parseArguments,readRequest,loadBindings} from './node-input.mjs';
import {setupContract} from './setup-contract.mjs';
import {monitor} from './node-monitor.mjs';
import {runtimeWorker,sendRuntimeResult,superviseRuntime} from './node-process.mjs';
import {nodeBudget} from './node-budget.mjs';
import {nodeSync} from './node-sync.mjs';
let supervised=runtimeWorker(),responded=false,activeScope=null;
function respond(value,code=0){
 if(responded)return;responded=true;
 const text=JSON.stringify(value)+'\n';
 if(supervised&&runtimeWorker())sendRuntimeResult(value,code);
 else if(supervised)process.stdout.write(text,()=>process.exit(code));
 else {process.stdout.write(text);process.exitCode=code;}
}
try{
 const args=parseArguments(process.argv.slice(2)),readOnly=(typeof __LLMWIKI_READ_ONLY__!=='undefined'&&__LLMWIKI_READ_ONLY__)||!!args['--read-only'];
 let delegated=false,loadedRequest=null;
 if(!args['--help']&&!runtimeWorker()&&args['--input']!=='-'&&!/^[\s\uFEFF]*[\[{]/.test(args['--input'])){supervised=true;const outcome=await superviseRuntime({...args,...(readOnly?{'--read-only':true}:{})});if(outcome.value.run_editor?.action==='editor.serve')loadedRequest=outcome.value.run_editor;else{respond(outcome.value,outcome.code);delegated=true;}}
 if(!delegated){
 const request=args['--help']?null:loadedRequest??await readRequest(args['--input']);
 if(runtimeWorker()&&!readOnly&&request?.action==='editor.serve'){respond({ok:true,run_editor:request});}
 else{
 if(args['--help']||request.action==='help'){const help={usage:'node wiki.mjs --root ABSOLUTE_PROJECT --input \'{"action":"inspect"}\'',input:'JSON object, existing file path, or - for stdin',bindings:'Optional --bindings FILE; otherwise project .llmwiki/device-bindings.json, then legacy .llmwiki/bindings.json',actions:readOnly?queryActions:[...actions,'help','editor.preflight','editor.start','editor.stop','editor.serve'],minimum_node:'22.13.0',python:false,runtime_limits:{budget_ms:20000,read_timeout_ms:15000,worker_timeout_ms:35000,recovery:'Read structured errors; never retry with shell suffixes or temporary redirects.',...(!readOnly?{sync:'Follow every next_request, including derived maintenance and finding delivery. A blocked file has a separate resume_request; retry once only.',source_monitor:{budget_ms:'100–20000',read_timeout_ms:'25–5000',max_files:'1–256',max_items:'1–128',scope:['connection','source','prefix'],triage:{report:'summary'},continuation:'Invoke each returned next_request verbatim; do not replay consumed cursors.'}}:{query:'A read timeout is incomplete retrieval. Preserve the question and retry at most once; never infer no matching knowledge.'})},shadow_contract:{status:{action:'shadow.status'},resolve:{action:'shadow.resolve',id:'<quote-id>'},passage:{action:'shadow.resolve',reference:'<passage.reference>'},...(!readOnly?{refresh:{action:'shadow.refresh'},known_paths:{action:'shadow.refresh',connection:'<connection>',paths:['<existing.md>']},reconciliation:'full_scan:false checks only requested paths; finish maintenance with a full refresh or sync.',rebuild:{action:'shadow.rebuild'},budgets:{cache_bytes:'SQLite only; default 128 MiB',maxBatchBytes:'Transport package only; default 512 KiB, automatic splitting, 4 KiB–8 MiB',maxBytes:'On shadow.pin: retained-quote budget only'},recovery:'Retry refresh after updating both skills. Never delete shared identity packages or move Markdown to bypass limits. Rebuild is for cache recovery, not transport limits.'}:{}),compatibility:'Inline passage links require editor 0.4.23 or newer; partial quotes require both skills and editor 0.4.21 or newer; older whole-block pins remain supported.'},...(!readOnly?{setup_contract:setupContract()}:{} )};if(args['--help'])process.stdout.write(JSON.stringify(help)+'\n');else respond({ok:true,result:help});}
 else {
   const root=new NodeStore(args['--root'],{writable:!readOnly});
   if(readOnly&&!queryActions.includes(request.action))throw Error('The query skill is read-only. Use maintain-llm-wiki for this action.');
   supervised=request.action!=='editor.serve';
   if(supervised&&!runtimeWorker()){
    const outcome=await superviseRuntime({...args,...(readOnly?{'--read-only':true}:{})},request);respond(outcome.value,outcome.code);
   }else{
   const scope=activeScope=nodeBudget(request),guarded=scope.wrap(root);
   const bindings=await scope.read(()=>loadBindings(guarded,{file:args['--bindings'],readOnly}),{operation:'bindings',path:args['--bindings']??'.llmwiki/device-bindings.json'});
   const bound=Object.fromEntries(Object.entries(bindings).map(([id,store])=>[id,scope.wrap(store)]));
   let editorHTML=null;try{if(!['source.monitor','sync'].includes(request.action))editorHTML=await scope.read(()=>fs.readFile(new URL(typeof __EDITOR_HTML__!=='undefined'?__EDITOR_HTML__:'./assets/app.html',import.meta.url),'utf8'),{operation:'editor_asset'});}catch(error){if(error.code!=='ENOENT')throw error;}
   const result=request.action==='source.monitor'?await monitor(root,request,{bindings}):request.action==='sync'?await nodeSync(root,request,{bindings}):request.action==='editor.preflight'?await editorPreflight(guarded,{bindingsFile:args['--bindings']}):request.action==='editor.start'?await startEditor(guarded,{bindingsFile:args['--bindings'],open:request.open===true}):request.action==='editor.serve'?await serveEditor(root,editorHTML,{bindingsFile:args['--bindings']}):request.action==='editor.stop'?await stopEditor(guarded):await dispatch(guarded,request,{bindings:bound,extract,editorHTML});if(!['source.monitor','sync'].includes(request.action))scope.check();if(request.action==='inspect'&&!readOnly)result.runtime.node_actions=['editor.preflight','editor.start','editor.stop','editor.serve'];respond({ok:true,result});
   }
 }
}
}
}catch(error){error=activeScope?.failure??error;respond({ok:false,error:{code:error.code??'request',message:error.message,details:{...error.details,...(activeScope?.failure?{complete:false,partial_changes_possible:activeScope.mutated}:{})}}},1);}
