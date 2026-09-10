#!/usr/bin/env node
/** Presentation output only. This helper never receives a writable knowledge store. */
import {NodeStore} from './adapters/node.mjs';
import {parseArguments,readRequest,loadBindings} from './node-input.mjs';
import {renderAnswer} from './answer.mjs';
import {nodeBudget} from './node-budget.mjs';
import {runtimeWorker,sendRuntimeResult,superviseRuntime} from './node-process.mjs';
let scope=null;
function respond(value,code=0){if(runtimeWorker())sendRuntimeResult(value,code);else process.stdout.write(JSON.stringify(value)+'\n',()=>process.exit(code));}
import {requireThat} from './core/errors.mjs';
try{
 const args=parseArguments(process.argv.slice(2));
 if(args['--help'])process.stdout.write(JSON.stringify({usage:'node answer.mjs --root ABSOLUTE_PROJECT --input JSON_OR_STDIN',action:'answer.export',input:{action:'answer.export',question:'Original question',references:['passage.reference'],blocks:[{type:'paragraph',text:'Supported claim.',refs:[0]},{type:'quote',ref:0}]},blocks:[{type:'heading',text:'Short heading'},{type:'paragraph',text:'Supported claim.',refs:[0]},{type:'list',ordered:false,items:[{text:'Supported item.',refs:[0]}]},{type:'table',columns:['Aspect','Finding'],rows:[{cells:['Aspect','Finding'],refs:[0]}]},{type:'quote',ref:0},{type:'note',text:'A limitation, never an uncited factual claim.'}],limits:{input_bytes:2097152,references:128,blocks:512,text_chars:32768,title_heading_column_chars:200,question_note_chars:4000,items_rows:256,columns:12},references:'Zero-based indexes into the unchanged passage.reference tokens; every paragraph/item/row needs refs. Plain text fields; quotes come from the verified source. Optional title.',output:'One new .llmwiki/answers/<uuid>.html; no knowledge, cache, history or pin writes.',opening:'Call the returned open.tool with open.arguments using the host tool. The absolute file path has no fragment.'})+'\n');
 else if(!runtimeWorker()){const outcome=await superviseRuntime(args);respond(outcome.value,outcome.code);}
 else{
  requireThat(!args['--read-only'],'read-only','The presentation helper creates an answer file; use wiki.mjs for strictly read-only retrieval.');
  const request=await readRequest(args['--input']);scope=nodeBudget();
  const root=scope.wrap(new NodeStore(args['--root'],{writable:false})),rawBindings=await scope.read(()=>loadBindings(root,{file:args['--bindings'],readOnly:true}),{operation:'bindings'}),bindings=Object.fromEntries(Object.entries(rawBindings).map(([id,store])=>[id,scope.wrap(store)]));
  const answer=await renderAnswer(root,request,{bindings}),relative='.llmwiki/answers/'+root.services.uuid()+'.html';
  // The only writable store is held here, after all input and evidence validation.
  scope.check();const output=scope.wrap(new NodeStore(root.root));await output.write(relative,answer.html,{expected:null,mode:0o600});
  const output_path=await root.location(relative);
  respond({ok:true,result:{output_path,bytes:new TextEncoder().encode(answer.html).length,references:answer.references,open:{tool:'open_on_host',arguments:{path:output_path}}}});
 }
}catch(error){error=scope?.failure??error;respond({ok:false,error:{code:error.code??'request',message:error.message,details:{...error.details,...(scope?.failure?{complete:false,partial_changes_possible:scope.mutated}:{})}}},1);}
