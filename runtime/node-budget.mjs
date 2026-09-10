/** Node request deadline. Reads may time out; writes retain the adapter's CAS protocol.
 * The supervisor terminates pending native reads after the worker returns its envelope.
 */
import {requireThat,WikiError} from './core/errors.mjs';
export function integer(value,fallback,min,max,name){value??=fallback;requireThat(Number.isInteger(value)&&value>=min&&value<=max,'runtime_budget',`${name} must be an integer from ${min} to ${max}.`);return value;}
export function nodeBudget(request={}){
 const budget=integer(request.budget_ms,20000,100,20000,'budget_ms'),readTimeout=Math.min(integer(request.read_timeout_ms,15000,25,15000,'read_timeout_ms'),Math.max(25,budget-250));
 const deadline=Date.now()+budget,stores=new Map();let failure=null,observer=null,mutated=false;
 function check(details={}){if(failure)throw failure;if(Date.now()>=deadline)throw failure=new WikiError('runtime_budget','This call reached its time budget; the operation is incomplete.',details);}
 async function read(operation,details){
  check(details);let timer;const remaining=deadline-Date.now(),callLimit=remaining<=readTimeout;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>{failure??=new WikiError(callLimit?'runtime_budget':'runtime_read_timeout',callLimit?'This call reached its time budget; the operation is incomplete.':'A filesystem read did not finish in time. This operation is incomplete.',details);reject(failure);},Math.max(1,Math.min(readTimeout,remaining)));})]);}
  finally{clearTimeout(timer);}
 }
 function wrap(store){
  const key=store.root+'|'+store.writable;if(stores.has(key))return stores.get(key);
  const proxy=new Proxy(store,{get(target,key){
   if(['read','list','fingerprint'].includes(key))return async(...args)=>{
    const details={operation:key,path:args[0]??'',store:target.root};
    const result=await read(async()=>{
     let before=observer&&key==='read'?await target.fingerprint(args[0]):undefined;check(details);
     let value;try{value=await target[key](...args);}catch(error){if(observer&&key==='list'&&error.code==='ENOENT')await observer({kind:'list',store:target,path:args[0]??'',options:args[1]??{},value:null});throw error;}
     if(observer&&key==='read'){
      check(details);let after=await target.fingerprint(args[0]);
      if(JSON.stringify(before)!==JSON.stringify(after)){
       // Cloud hydration can change metadata. Read again and require a stable
       // version; never accept the first bytes just because the path is unchanged.
       check(details);before=after;value=await target.read(...args);check(details);after=await target.fingerprint(args[0]);
      }
      requireThat(JSON.stringify(before)===JSON.stringify(after),'sync_changed','A file changed while being read.',details);
      await observer({kind:'file',store:target,path:args[0],value:after});
     }else if(observer&&key==='list')await observer({kind:'list',store:target,path:args[0]??'',options:args[1]??{},value});
     return value;
    },details);check(details);return result;
   };
   if(key==='substore')return async(...args)=>wrap(await read(()=>target.substore(...args),{operation:key,path:args[0],store:target.root}));
   if(['write','archive','mkdir'].includes(key))return async(...args)=>{
    check({operation:key,path:args[0],store:target.root});mutated=true;
    // Never race a mutation: it either finishes its CAS/readback or the parent reports an interrupted write.
    const value=await target[key](...args);
    if(observer)await observer({kind:key,store:target,args,value});
    return value;
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});stores.set(key,proxy);return proxy;
 }
 return {wrap,read,check,get failure(){return failure;},get mutated(){return mutated;},get remaining(){return Math.max(0,deadline-Date.now());},budget,readTimeout,observe(fn){observer=fn;}};
}
