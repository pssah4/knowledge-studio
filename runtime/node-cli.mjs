#!/usr/bin/env node
/** CLI requests are JSON data, file contents or stdin; never shell-evaluated code. */
import fs from 'node:fs/promises';
import {editorPreflight,startEditor,serveEditor,stopEditor} from './editor-launch.mjs';
import {NodeStore} from './adapters/node.mjs';
import {dispatch,actions,queryActions} from './dispatch.mjs';
import {extract} from './readers/node.mjs';
import {parseArguments,readRequest,loadBindings} from './node-input.mjs';
import {setupContract} from './setup-contract.mjs';
try{
 const args=parseArguments(process.argv.slice(2));
 const request=args['--help']?null:await readRequest(args['--input']),readOnly=(typeof __LLMWIKI_READ_ONLY__!=='undefined'&&__LLMWIKI_READ_ONLY__)||!!args['--read-only'];
 if(args['--help']||request.action==='help'){const help={usage:'node wiki.mjs --root ABSOLUTE_PROJECT --input \'{"action":"inspect"}\'',input:'JSON object, existing file path, or - for stdin',bindings:'Optional --bindings FILE; otherwise project .llmwiki/device-bindings.json, then legacy .llmwiki/bindings.json',actions:readOnly?queryActions:[...actions,'help','editor.preflight','editor.start','editor.stop','editor.serve'],minimum_node:'22.13.0',python:false,shadow_contract:{status:{action:'shadow.status'},resolve:{action:'shadow.resolve',id:'<quote-id>'},passage:{action:'shadow.resolve',reference:'<passage.reference>'},...(!readOnly?{refresh:{action:'shadow.refresh'},known_paths:{action:'shadow.refresh',connection:'<connection>',paths:['<existing.md>']},reconciliation:'full_scan:false checks only requested paths; finish maintenance with a full refresh or sync.',rebuild:{action:'shadow.rebuild'},budgets:{cache_bytes:'SQLite only; default 128 MiB',maxBatchBytes:'Transport package only; default 512 KiB, automatic splitting, 4 KiB–8 MiB',maxBytes:'On shadow.pin: retained-quote budget only'},recovery:'Retry refresh after updating both skills. Never delete shared identity packages or move Markdown to bypass limits. Rebuild is for cache recovery, not transport limits.'}:{}),compatibility:'Inline passage links require editor 0.4.23 or newer; partial quotes require both skills and editor 0.4.21 or newer; older whole-block pins remain supported.'},...(!readOnly?{setup_contract:setupContract()}:{} )};process.stdout.write(JSON.stringify(args['--help']?help:{ok:true,result:help})+'\n');}
 else {
   const root=new NodeStore(args['--root'],{writable:!readOnly});
   if(readOnly&&!['shadow.status','shadow.resolve','inspect','context','source.inventory','source.plan','source.read','read','query','graph','readiness','workflow.status','workflow.list','review.read'].includes(request.action))throw Error('The query skill is read-only. Use maintain-llm-wiki for this action.');
   const bindings=await loadBindings(root,{file:args['--bindings'],readOnly});
   let editorHTML=null;try{editorHTML=await fs.readFile(new URL(typeof __EDITOR_HTML__!=='undefined'?__EDITOR_HTML__:'./assets/app.html',import.meta.url),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
   const result=request.action==='editor.preflight'?await editorPreflight(root,{bindingsFile:args['--bindings']}):request.action==='editor.start'?await startEditor(root,{bindingsFile:args['--bindings'],open:request.open===true}):request.action==='editor.serve'?await serveEditor(root,editorHTML,{bindingsFile:args['--bindings']}):request.action==='editor.stop'?await stopEditor(root):await dispatch(root,request,{bindings,extract,editorHTML});if(request.action==='inspect'&&!readOnly)result.runtime.node_actions=['editor.preflight','editor.start','editor.stop','editor.serve'];process.stdout.write(JSON.stringify({ok:true,result})+'\n');
 }
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:{code:error.code??'request',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;}
