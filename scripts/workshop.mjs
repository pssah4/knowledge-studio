/** The workshop catalog is the only source of skill identities, access modes and
 * host delivery matrix. Runtime behavior remains in runtime/, not in profiles. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const ensure=(value,message)=>{if(!value)throw Error('Workshop: '+message);};
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const slug=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export function validateWorkshop(workshop){
 ensure(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(workshop.version),'invalid version');
 for(const key of ['skills','profiles'])ensure(Array.isArray(workshop[key])&&workshop[key].length,'empty '+key);
 const names=new Set(),ids=new Set(),sections=new Set();
 for(const skill of workshop.skills){
  ensure(slug(skill.name)&&!names.has(skill.name),'invalid or duplicate skill identity');names.add(skill.name);
  ensure(['read-only','read-write'].includes(skill.access),'invalid access mode: '+skill.name);
  ensure(skill.references===undefined||Array.isArray(skill.references)&&new Set(skill.references).size===skill.references.length&&skill.references.every(r=>/^[a-z][a-z0-9-]*\.md$/.test(r)&&!['runtime.md','operations.md'].includes(r)),'invalid reference resources: '+skill.name);
  const ui=skill.interface;
  ensure(ui&&nonempty(ui.display_name)&&typeof ui.short_description==='string'&&ui.short_description.length>=25&&ui.short_description.length<=64,'invalid interface: '+skill.name);
  ensure(nonempty(ui.default_prompt)&&ui.default_prompt.includes('$'+skill.name),'default prompt must name its skill');
 }
 for(const profile of workshop.profiles){
  ensure(slug(profile.id)&&!ids.has(profile.id),'invalid or duplicate profile identity');ids.add(profile.id);
  ensure(nonempty(profile.section)&&!sections.has(profile.section),'invalid or duplicate host section');sections.add(profile.section);
  ensure(['node','vault'].includes(profile.engine),'unknown runtime: '+profile.engine);
  ensure(profile.engine==='vault'?profile.layout==='vault':['claude','skill','openai'].includes(profile.layout),'layout does not match runtime: '+profile.id);
  ensure(nonempty(profile.requirements),'missing host prerequisites: '+profile.id);
 }
 return workshop;
}

export async function loadWorkshop({privateProfiles=false}={}){
 const [pkg,cat,hosts]=await Promise.all(['package.json','skills/catalog.json',privateProfiles?'platforms/internal/profiles.json':'platforms/profiles.json'].map(async p=>JSON.parse(await fs.readFile(new URL(p,root),'utf8'))));
 ensure(cat.format==='llmwiki-skills/1'&&hosts.version===1,'unsupported catalog format');
 const workshop=validateWorkshop({version:pkg.version,skills:cat.skills,profiles:hosts.profiles});
 const sha256=createHash('sha256').update(JSON.stringify(workshop)).digest('hex');
 return {...workshop,provenance:{catalog:'skills/catalog.json',profiles:privateProfiles?'platforms/internal/profiles.json':'platforms/profiles.json',sha256}};
}

export function expectedPackages(workshop){
 return workshop.profiles.flatMap(profile=>workshop.skills.map(skill=>({profile:profile.id,skill:skill.name,file:profile.id+'/'+skill.name+'.skill'})));
}

export function validateReleaseMatrix(workshop,release){
 ensure(release.version===workshop.version,'release version differs from workshop');
 if(workshop.provenance)ensure(release.workshop?.sha256===workshop.provenance.sha256,'release catalog differs from workshop');
 const expected=expectedPackages(workshop),actual=release.packages;
 ensure(Array.isArray(actual)&&actual.length===expected.length,'incomplete or duplicate package matrix');
 const key=p=>JSON.stringify([p.profile,p.skill,p.file]);
 const keys=new Set(actual.map(key));
 ensure(keys.size===actual.length&&expected.every(p=>keys.has(key(p))),'release package matrix differs from catalog');
}

export function distributionReadme(workshop,release){
 validateReleaseMatrix(workshop,release);
 const cell=value=>value.replaceAll('|','&#124;').replaceAll('\n',' ');
 const headings=['Plattform',...workshop.skills.map(s=>s.name),'Voraussetzungen'];
 const lines=[`# LLM-Wiki ${workshop.version} · Plattformpakete`,'',
 'Installiere beide Skills für dieselbe Plattform und Version. Hinweise findest du in der [Projektanleitung](../../README.md).','',
 '| '+headings.map(cell).join(' | ')+' |','| '+headings.map(()=> '---').join(' | ')+' |'];
 for(const profile of workshop.profiles){
  const links=workshop.skills.map(skill=>{const p=release.packages.find(p=>p.profile===profile.id&&p.skill===skill.name);return '['+skill.name+'.skill]('+p.file+')';});
  lines.push('| '+[cell(profile.section),...links,cell(profile.requirements)].join(' | ')+' |');
 }
 lines.push('','Je Plattform beide Skills importieren und alte Fassungen ersetzen. Codex verwendet die entpackten Skill-Ordner; das zusätzliche ZIP ist das gemeinsame Claude-Code-Plugin.',
  '', 'Die Pakete bringen ihre JavaScript-Bibliotheken und den Editor mit. Es wird keine Software auf Nutzergeräten nachinstalliert. Hostrechte und verfügbare Ausführung müssen im Zielhost geprüft werden.',
  '', '[Dateien und SHA-256](release-'+workshop.version+'.json)','');
 return lines.join('\n');
}
