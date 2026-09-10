/** Reproducible inventory of installed and vendored execution inputs.
 * --online adds npm/OSV advisories; absence or failed lookup is never a clean bill.
 * Vendored WASM is hash-inventoried; its internal crate graph is not inferred.
 */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const online=process.argv.includes('--online');if(process.argv.slice(2).some(a=>a!=='--online'))throw Error('Use --online to query public advisory databases.');
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8')),manifest=JSON.parse(await fs.readFile('vendor/office/manifest.json','utf8')),inputs=[];
for(const [file,expected]of Object.entries({...manifest.inputs,[manifest.output.file]:manifest.output.sha256})){const bytes=await fs.readFile(file);if(hash(bytes)!==expected)throw Error('Vendor input hash changed: '+file);inputs.push({file,sha256:expected,bytes:bytes.length,kind:file.endsWith('.wasm')?'wasm':'source-or-notice'});}
const packages=Object.entries(lock.packages).filter(([p])=>p).map(([p,v])=>({name:p.split('node_modules/').at(-1),version:v.version,integrity:v.integrity??null,origin:'npm-lock',development:Boolean(v.dev)}));
for(const folder of ['ooxml','zrimo']){const pkg=JSON.parse(await fs.readFile('vendor/office/'+folder+'/package.json','utf8'));packages.push({name:pkg.name,version:pkg.version,license:pkg.license,origin:'vendored',declared_dependencies:pkg.dependencies??{},repository:pkg.repository??null});}
const report={format:'llmwiki-dependency-audit/1',checked_at:new Date().toISOString(),lock_sha256:hash(await fs.readFile('package-lock.json')),packages,inputs,coverage:{npm:'Exact package-lock versions',office:'Pinned packages, build-input hashes, notices and parser WASM',wasm_transitives:'Unverified: vendored binaries do not include a complete versioned internal crate SBOM',excluded_office_assets:'Upstream optional PDF.js, MathJax, fonts and image/TIFF assets are not in the embedded Office build',sast:'Not performed by this dependency check',secrets:'Not performed by this dependency check'},advisories:{state:online?'running':'not-run'}};
if(online){
 let npm;try{npm=await exec('npm',['audit','--json','--registry=https://registry.npmjs.org'],{maxBuffer:8*1024*1024,timeout:60000});}catch(error){npm=error;}
 try{const data=JSON.parse(npm.stdout);report.advisories.npm=data.error?{state:'failed',error:data.error}:{state:'executed',metadata:data.metadata,findings:data.vulnerabilities};}catch{report.advisories.npm={state:'failed',error:npm.message??'Audit response unavailable'};}
 try{const vendored=packages.filter(p=>p.origin==='vendored'),response=await fetch('https://api.osv.dev/v1/querybatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries:vendored.map(p=>({package:{name:p.name,ecosystem:'npm'},version:p.version}))}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('OSV HTTP '+response.status);const data=await response.json();if(data.results?.length!==vendored.length)throw Error('Incomplete OSV response');report.advisories.vendored={state:'executed',results:vendored.map((p,i)=>({name:p.name,version:p.version,...data.results[i]}))};}catch(error){report.advisories.vendored={state:'failed',error:error.message};}
 report.advisories.state=[report.advisories.npm,report.advisories.vendored].every(x=>x.state==='executed')?'executed':'incomplete';
}
await fs.mkdir('dist',{recursive:true});await fs.writeFile('dist/dependency-audit.json',JSON.stringify(report,null,2)+'\n');
const vulnerable=Object.keys(report.advisories.npm?.findings??{}).length+(report.advisories.vendored?.results??[]).reduce((n,r)=>n+(r.vulns?.length??0),0);
console.log(JSON.stringify({packages:packages.length,verified_inputs:inputs.length,wasm:inputs.filter(i=>i.kind==='wasm').length,advisories:report.advisories.state,findings:vulnerable,report:'dist/dependency-audit.json'}));if(vulnerable||report.advisories.state==='incomplete')process.exitCode=1;
