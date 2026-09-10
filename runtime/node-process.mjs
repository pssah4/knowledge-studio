/** A runtime worker inherits the same executable and sandbox. Only its supervisor
 * owns stdout and the host exit status. Native blocked reads die with the worker;
 * process.exit alone can wait for native filesystem threads during Node teardown.
 */
import {spawn} from 'node:child_process';
const MESSAGE='llmwiki-runtime-result/1';
export const runtimeWorker=()=>process.env.LLMWIKI_RUNTIME_WORKER==='1'&&typeof process.send==='function';
export function sendRuntimeResult(value,code){process.send({type:MESSAGE,value,code});}
export function superviseRuntime(args,request=null){
 return new Promise(resolve=>{
  let settled=false,stderr='',timer,child;
  const finish=(value,code)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   // No detached process or wider grant. Always terminate the worker, even after success.
   if(child&&!child.killed)child.kill('SIGKILL');
   resolve({value,code});
  };
  const details={action:request?.action??'request',complete:false,partial_changes_possible:!args['--read-only']&&!['inspect','query','read','context','graph','source.monitor'].includes(request?.action??'request'),next:'Do not repeat with shell suffixes or temporary redirects. Read current state before retrying an interrupted mutation.'};
  const fail=(code,message,extra={})=>finish({ok:false,error:{code,message,details:{...details,...extra}}},1);
  try{
   child=spawn(process.execPath,[...process.execArgv,process.argv[1],'--root',args['--root'],...(args['--bindings']?['--bindings',args['--bindings']]:[]),...(args['--read-only']?['--read-only']:[]),'--input',request?'-':args['--input']],{
    env:{...process.env,LLMWIKI_RUNTIME_WORKER:'1'},stdio:['pipe','ignore','pipe','ipc']
   });
   timer=setTimeout(()=>fail(request?.action==='source.monitor'?'monitor_timeout':'runtime_timeout','The worker could not return a verified result within 35 seconds. The operation remains incomplete.'),35000);
   child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-4000);});
   child.on('message',message=>{
    if(message?.type===MESSAGE&&typeof message.value?.ok==='boolean'&&[0,1].includes(message.code))finish(message.value,message.code);
   });
   child.on('error',error=>fail('runtime_worker',error.message));
   child.on('exit',(code,signal)=>{if(!settled)fail('runtime_worker','The runtime worker ended before returning a result.',{exit_code:code,signal,stderr});});
   child.stdin.on('error',error=>{if(!settled)fail('runtime_worker',error.message);});
   child.stdin.end(request?JSON.stringify(request):undefined);
  }catch(error){fail('runtime_worker',error.message);}
 });
}
