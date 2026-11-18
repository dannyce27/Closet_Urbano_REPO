import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from './local-db.mjs';
import {api,cleanup} from '../server/shop.mjs';
function fixture(){const env={DB:localDB(':memory:'),ADMIN_KEY:'test-only'};
 async function request(path,body,auth=false){return api(new Request('https://unit.test/api/'+path,{method:body?'POST':'GET',headers:auth?{authorization:'Bearer test-only'}:{},body:body?JSON.stringify(body):undefined}),env)}
 const form=(products)=>({key:crypto.randomUUID(),products,name:'Cliente de prueba',contact:'prueba@example.org',delivery:'Retiro'});
 return {env,request,form}}
test('dos compradores, una pieza; el reintento conserva el pedido',async()=>{const {request,form}=fixture();const a=form(['CU-001']),b=form(['CU-001']);const pair=await Promise.all([request('orders',a),request('orders',b)]);assert.deepEqual(pair.map(x=>x.status).sort(),[201,409]);const index=pair.findIndex(x=>x.status===201);assert.deepEqual(await pair[index].json(),await (await request('orders',[a,b][index])).json())});
test('un carrito rechazado libera todas sus piezas',async()=>{const {request,form}=fixture();assert.equal((await request('orders',form(['CU-002','CU-006']))).status,409);assert.equal((await request('orders',form(['CU-002']))).status,201)});
test('MÍO respeta prioridad, vence y se convierte en pedido por enlace',async()=>{const {request,env,form}=fixture();for(const handle of ['primera','segunda'])assert.equal((await request('admin/reserve',{product:'CU-001',handle,minutes:5},true)).status,200);assert.equal((await request('orders',form(['CU-001']))).status,409);env.DB.prepare('UPDATE holds SET expires=0').run();await cleanup(env.DB);const h=env.DB.prepare('SELECT * FROM holds').first();assert.equal(h.owner,'ig:segunda');assert.equal((await request('orders',{...form(['CU-001']),claim:h.token})).status,201)});
test('la revisión manual bloquea la pieza y requiere acceso de tienda',async()=>{const {request,form,env}=fixture();const {id}=await(await request('orders',form(['CU-003']))).json();env.BUCKET={put:async()=>{}};const proof=await api(new Request('https://unit.test/api/orders/'+id+'/receipt',{method:'POST',headers:{'content-type':'image/png'},body:new Uint8Array([137,80,78,71])}),env);assert.equal(proof.status,200);assert.equal((await(await request('orders/'+id)).json()).status,'en revisión');assert.equal((await request('admin/order',{id,status:'pagado'})).status,401);assert.equal((await request('admin/order',{id,status:'pagado'},true)).status,200);assert.equal((await request('orders',form(['CU-003']))).status,409);assert.equal((await request('admin/order',{id,status:'entregado'},true)).status,200)});
test('drop simultáneo de 40 pedidos y liberación tras vencer',async()=>{const {request,form,env}=fixture();const attempts=await Promise.all(Array.from({length:40},()=>request('orders',form(['CU-004']))));assert.equal(attempts.filter(r=>r.status===201).length,1);assert.equal(attempts.filter(r=>r.status===409).length,39);env.DB.prepare('UPDATE orders SET expires=0').run();env.DB.prepare('UPDATE holds SET expires=0').run();assert.equal((await request('orders',form(['CU-004']))).status,201)});
test('Wompi: rechazo de firma, cobro firmado y reenvío del mismo evento',async()=>{const {request,form,env}=fixture();env.WOMPI_SECRET='prueba';env.WOMPI_APP_ID='app-simulada';const {id}=await(await request('orders',form(['CU-003']))).json();await request('admin/payment-link',{id,url:'https://wompi.sv/test'},true);
 const payload=JSON.stringify({Aplicativo:{Id:env.WOMPI_APP_ID},EsProductiva:false,ResultadoTransaccion:'ExitosaAprobada',Monto:36,EnlacePago:{IdentificadorEnlaceComercio:id},IdTransaccion:'evento-simulado'});const body=new TextEncoder().encode(payload);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WOMPI_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,body)).toString('hex');const hook=s=>api(new Request('https://unit.test/api/wompi',{method:'POST',headers:{wompi_hash:s},body}),env);assert.equal((await hook('incorrecta')).status,403);assert.equal((await hook(sig)).status,200);assert.equal((await hook(sig)).status,200);assert.equal((await(await request('orders/'+id)).json()).status,'pagado');assert.equal(env.DB.prepare('SELECT count(*) n FROM wompi_events').first().n,1)});
test('administración recorre 113 pedidos y localiza el más antiguo por su código',async()=>{
 const {env,request}=fixture();
 const insert=env.DB.prepare("INSERT INTO orders(id,request_key,name,contact,delivery,address,total,fee,status,expires,created) VALUES(?,?,?,'prueba@example.org','Retiro','',3000,0,?,0,?)");
 const ids=Array.from({length:113},(_,i)=>{const id=crypto.randomUUID();insert.bind(id,id,'Cliente '+i,i%2?'entregado':'cancelado',i).run();return id});
 assert.equal((await request('admin/orders')).status,401);
 const found=[];
 for(let page=1;page<=5;page++){const r=await(await request('admin/orders?page='+page,null,true)).json();assert.equal(r.count,113);found.push(...r.orders.map(o=>o.id))}
 assert.deepEqual(found,ids.toReversed());
 const search=await(await request('admin/orders?status=cancelado&q='+ids[0],null,true)).json();assert.equal(search.count,1);assert.equal(search.orders[0].id,ids[0]);
});
test('foto y prenda se asocian al drop futuro; su apertura habilita el pedido',async()=>{
 const {env,request,form}=fixture();const d={id:'TEST',title:'Colección de prueba',starts:Date.now()+86400000};
 assert.equal((await request('admin/drop',{...d,createOnly:true},true)).status,200);
 assert.equal((await request('admin/drop',{...d,createOnly:true},true)).status,409);
 const image=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);let saved;
 env.BUCKET={put:async(k,b)=>{saved=k;assert.deepEqual(b,image)}};
 const photo=await api(new Request('https://unit.test/api/admin/photo',{method:'POST',headers:{Authorization:'Bearer test-only','Content-Type':'image/png'},body:image}),env);
 const p={id:'TEST-01',name:'Chaqueta',price:2800,category:'Chaquetas',size:'L',measures:'60 cm',condition:'Buena',image:(await photo.json()).image,drop_id:d.id,createOnly:true};
 assert.equal(p.image,'/api/'+saved);assert.equal((await request('admin/product',p,true)).status,200);assert.equal((await request('admin/product',p,true)).status,409);
 const catalog=await(await request('catalog')).json();assert.equal(catalog.products.find(x=>x.id===p.id).status,'Próximamente');
 assert.equal((await request('orders',form([p.id]))).status,409);
 await request('admin/drop',{...d,starts:Date.now()-1},true);assert.equal((await request('orders',form([p.id]))).status,201);
});
