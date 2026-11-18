import http from 'node:http';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {localDB} from './local-db.mjs';
import {api} from '../server/shop.mjs';
await mkdir('.local/photo',{recursive:true});
await mkdir('.local/proof',{recursive:true});
const key=process.env.ADMIN_KEY||randomBytes(24).toString('hex');
const env={...process.env,DB:localDB('.local/shop.db'),ADMIN_KEY:key,BUCKET:{async put(k,v,o){await writeFile('.local/'+k,v);await writeFile('.local/'+k+'.type',o.httpMetadata.contentType)},async get(k){return {body:await readFile('.local/'+k),httpMetadata:{contentType:await readFile('.local/'+k+'.type','utf8')}}},async delete(k){await Promise.all([unlink('.local/'+k),unlink('.local/'+k+'.type')])}}};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png'};
const args=process.argv,port=Number(process.env.PORT||args[args.indexOf('--port')+1])||3000;
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://'+req.headers.host);
 if(url.pathname.startsWith('/api/')){const chunks=[];let count=0;for await(const c of req){count+=c.length;if(count>3200000){res.writeHead(413);res.end();return}chunks.push(c)}const r=await api(new Request(url,{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return}
 const filename=path.resolve('public','.'+(url.pathname==='/'?'/index.html':url.pathname==='/admin'?'/admin.html':url.pathname));if(!filename.startsWith(path.resolve('public')+path.sep))throw Error();const bytes=await readFile(filename);res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');res.end(bytes)
 }catch{res.writeHead(404);res.end('No encontrado')}}).listen(port,process.env.HOST||(process.env.SITES_MANAGED_LINUX_CONTAINER?'0.0.0.0':'127.0.0.1'),()=>{console.log('Closet Urbano · http://localhost:'+port);if(!process.env.SITES_MANAGED_LINUX_CONTAINER)console.log('Clave local del panel /admin: '+key)});
