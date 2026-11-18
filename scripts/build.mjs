import {mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai/drizzle/meta',{recursive:true});await cp('.openai','dist/.openai',{recursive:true});
const files={};for(const path of await readdir('public',{recursive:true,withFileTypes:true})){if(!path.isFile())continue;const full=(path.parentPath+'/'+path.name).replaceAll('\\','/'),key=full.slice(full.indexOf('public/')+6);files[key]=(await readFile(full)).toString('base64')}
const seed=await readFile('server/seed.mjs','utf8'),api=(await readFile('server/shop.mjs','utf8')).replace("import {seed} from './seed.mjs';",'');
await writeFile('dist/server/index.js',seed+'\n'+api+'\nconst files='+JSON.stringify(files)+';\n'+await readFile('server/worker-tail.txt','utf8'));
const sql=await readFile('migrations/0001_shop.sql','utf8');await writeFile('dist/.openai/drizzle/0001_shop.sql',sql.trim().split(';\n').join(';\n--> statement-breakpoint\n'));
await writeFile('dist/.openai/drizzle/meta/_journal.json',JSON.stringify({version:'7',dialect:'sqlite',entries:[{idx:0,version:'6',when:1794873600000,tag:'0001_shop',breakpoints:true}]}));
