/** Compile the existing browser contracts as static modules; no eval in any host. */
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export async function syncContracts({check=false}={}){
  const outputs=new Map();
  for(const [file,name,exposed] of [['reviews','createReviews','WikiReviews'],['contributions','createContributions','WikiContributions'],['contribution-lifecycle','createContributionLifecycle','WikiContributionLifecycle'],['participation-sync','createParticipationSync','WikiParticipationSync'],['editorsync','createSync','EditorSync'],['project','createProject','ProjectSettings']]){
    const source=await fs.readFile(new URL('app/'+file+'.js',root),'utf8');
    const start=source.indexOf('(function (global)')>=0?source.indexOf('(function (global)'):source.indexOf('(function(global)');
    const body=source.slice(start).replace(/\}\)\((?:globalThis|typeof globalThis === "object" \? globalThis : this)\);\s*$/,'})(environment);');
    if(!body.endsWith('})(environment);'))throw Error('Contract wrapper changed: '+file);
    outputs.set(file+'.mjs','// Generated from app/'+file+'.js by scripts/sync-contracts.mjs.\nexport function '+name+'(environment){\n'+body+'\nreturn environment.'+exposed+';\n}\n');
  }
  const core=await fs.readFile(new URL('app/core.js',root),'utf8');
  outputs.set('matching.mjs','// Generated from app/core.js; shared line comparison.\n'+core.slice(core.indexOf('function placesOf('),core.indexOf('function alignmentOps('))+'\nexport {matchingBlocks};\n');
  await fs.mkdir(new URL('runtime/compat/',root),{recursive:true});
  for(const [file,text]of outputs){const target=new URL('runtime/compat/'+file,root);if(check){if(await fs.readFile(target,'utf8')!==text)throw Error('Stale compiled contract: '+file);}else await fs.writeFile(target,text);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await syncContracts({check:process.argv.includes('--check')});
