#!/usr/bin/env node
/** Presentation output only. This helper never receives a writable knowledge store. */
import {NodeStore} from './adapters/node.mjs';
import {parseArguments,readRequest,loadBindings} from './node-input.mjs';
import {renderAnswer} from './answer.mjs';
import {requireThat} from './core/errors.mjs';
try{
 const args=parseArguments(process.argv.slice(2));
 if(args['--help'])process.stdout.write(JSON.stringify({usage:'node answer.mjs --root ABSOLUTE_PROJECT --input JSON_OR_STDIN',action:'answer.export',input:{question:'Original question',references:['passage.reference'],blocks:[{type:'paragraph',text:'Supported claim.',refs:[0]},{type:'quote',ref:0}]},output:'One new .llmwiki/answers/<uuid>.html; no knowledge, cache, history or pin writes.',opening:'Call the returned open.tool with open.arguments using the host tool. The absolute file path has no fragment.'})+'\n');
 else{
  requireThat(!args['--read-only'],'read-only','The presentation helper creates an answer file; use wiki.mjs for strictly read-only retrieval.');
  const request=await readRequest(args['--input']),root=new NodeStore(args['--root'],{writable:false}),bindings=await loadBindings(root,{file:args['--bindings'],readOnly:true});
  const answer=await renderAnswer(root,request,{bindings}),relative='.llmwiki/answers/'+root.services.uuid()+'.html';
  // The only writable store is held here, after all input and evidence validation.
  const output=new NodeStore(root.root);await output.write(relative,answer.html,{expected:null,mode:0o600});
  const output_path=await root.location(relative);
  process.stdout.write(JSON.stringify({ok:true,result:{output_path,bytes:new TextEncoder().encode(answer.html).length,references:answer.references,open:{tool:'open_on_host',arguments:{path:output_path}}}})+'\n');
 }
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:{code:error.code??'request',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;}
