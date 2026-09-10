import {VaultStore,prepare,resume} from './adapters/vault.mjs';
import {dispatch,queryActions} from './dispatch.mjs';
import {extractSource} from './readers/index.mjs';
import {setupContract} from './setup-contract.mjs';
export async function execute(args,ctx){
 if(Object.hasOwn(args,'project_path'))throw Error('Use root for the vault-relative project folder; project_path is unsupported. Call action: help for the exact contract.');
 const readOnly=typeof __LLMWIKI_READ_ONLY__!=='undefined'&&__LLMWIKI_READ_ONLY__;
 if(args.action==='help'&&readOnly)return {state:'complete',result:{version:typeof __LLMWIKI_VERSION__!=='undefined'?__LLMWIKI_VERSION__:'development',references:[args.skills_root+'/'+args.skill_name+'/references/runtime.md',args.skills_root+'/'+args.skill_name+'/references/operations.md'],requests:{inspect:{action:'inspect',root:args.root??''},query:{action:'query',root:args.root??'',question:'<user question>'}},note:'Read-only retrieval. Missing settings means locate the existing project, never start setup.'}};
 if(args.action==='help'){
  const root=args.root??'',prefix=args.skills_root+'/'+args.skill_name;
  return {state:'complete',result:{version:typeof __LLMWIKI_VERSION__!=='undefined'?__LLMWIKI_VERSION__:'development',references:[prefix+'/references/runtime.md',prefix+'/references/operations.md'],
   setup_contract:setupContract(),note:'Examples are shapes, not user answers. root stays identical for every call. Read both references before writing.',
   requests:{inspect:{action:'inspect',root},draft:{action:'setup.draft',root,answers:{author:'<author>',editor:'both',wikis:[{id:'wiki',label:'<name>',path:'Wiki-LLM'}]},expected:null},
    configure:{action:'configure',root,id:'wissen',label:'<name>',author:'<author>',editor:'both',wikis:[{id:'wiki',label:'<name>',path:'Wiki-LLM',purpose:'<user purpose>',audience:['<reader>']}],sources:[{id:'quellen',label:'Quellen',path:'Quellen-LLM',wikis:['wiki']}]},
    resume:{action:'transaction.resume',root,transaction:'<returned transaction>'}},
   commit:'prepared/pending are not committed; respect retry_after_seconds and resume until complete. Existing setup drafts/settings require their returned sha256 as expected.'}};
 }
 if(readOnly&&!queryActions.includes(args.action))throw Error('The query skill is read-only.');
 const root=new VaultStore(ctx.vault,args.root??'',{writable:!readOnly});
 if(['configure','wiki.initialize'].includes(args.action))root.services={...root.services,registerText:await ctx.vault.read(args.skills_root+'/'+args.skill_name+'/assets/TYPES.md')};
 if(args.action==='transaction.resume')return resume(root,args.transaction);
 let editorHTML=null;
 if(['inspect','configure','settings','editor','detach'].includes(args.action))editorHTML=await ctx.vault.read(args.skills_root+'/'+args.skill_name+'/assets/app.html');
 try{return await prepare(root,store=>dispatch(store,args,{extract:extractSource,editorHTML}));}
 catch(error){if(['action','setup','input'].includes(error.code))error.message+=' Read the request contract with action: help; use action, root, answers/expected and wikis/sources objects, not op, draft or wikiPath.';throw error;}
}
