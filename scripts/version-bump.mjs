/** Keep npm, plugin metadata and the installation README on one version. */
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),check=process.argv.includes('--check');
const read=async name=>JSON.parse(await fs.readFile(new URL(name,root),'utf8'));
const pkg=await read('package.json'),lock=await read('package-lock.json'),plugin=await read('.claude-plugin/plugin.json');
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))throw Error('Invalid package version');
const readme=await fs.readFile(new URL('README.md',root),'utf8');
if(check){
 if(lock.version!==pkg.version||lock.packages[''].version!==pkg.version||plugin.version!==pkg.version||!readme.startsWith('# Knowledge Studio · '+pkg.version+'\n'))throw Error('Version sources differ');
}else{
 plugin.version=pkg.version;
 await fs.writeFile(new URL('.claude-plugin/plugin.json',root),JSON.stringify(plugin,null,2)+'\n');
 await fs.writeFile(new URL('README.md',root),readme.replace(/^# .*? · [^\n]+/,'# Knowledge Studio · '+pkg.version).replace(/dist\/public\/release-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\.json/g,'dist/public/release-'+pkg.version+'.json'));
}
console.log('Version '+pkg.version+(check?' consistent':' synchronized'));
