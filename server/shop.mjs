import {seed} from './seed.mjs';
const initialized=new WeakSet();
const json=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'no-store'}});
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status})};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const field=(v,max=180)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('Revisa los campos del formulario.');return v.trim()};
const num=(v,max)=>{if(!Number.isSafeInteger(v)||v<0||v>max)fail('Cantidad inválida.');return v};
export async function cleanup(db){
 const t=Date.now(); const q=(s,...v)=>db.prepare(s).bind(...v);
 await db.batch([q("UPDATE orders SET status='vencido' WHERE status='pendiente' AND expires<=?",t),q('DELETE FROM holds WHERE expires<=?',t),
 q("INSERT OR IGNORE INTO holds(product,owner,expires) SELECT q.product,'ig:'||q.handle,? + q.minutes*60000 FROM queue q JOIN products p ON p.id=q.product WHERE p.sold=0 AND q.id=(SELECT MIN(id) FROM queue WHERE product=q.product)",t),
 q("INSERT INTO audit(action,detail,created) SELECT 'reserva asignada',h.product||' '||h.owner,? FROM holds h JOIN queue q ON h.product=q.product AND h.owner='ig:'||q.handle",t),
 q("DELETE FROM queue WHERE EXISTS(SELECT 1 FROM holds WHERE product=queue.product AND owner='ig:'||queue.handle)")]);
}
export async function api(req,env){
 try{
 const db=env.DB,u=new URL(req.url),p=u.pathname,now=Date.now(),post=req.method==='POST';
 if(!initialized.has(db)){if(env.LIVE_CATALOG!=='true')await seed(db);initialized.add(db)}
 const q=(s,...v)=>db.prepare(s).bind(...v), rows=async(s,...v)=>(await q(s,...v).all()).results;
 const audit=(a,d)=>q('INSERT INTO audit(action,detail,created) VALUES(?,?,?)',a,d,now);
 const admin=p.startsWith('/api/admin');
 let master=false;
 if(admin){const key=req.headers.get('authorization')?.replace(/^Bearer /,'')||''; const ownerEmail=env.SITES_OWNER_EMAIL?.trim().toLowerCase();
 const hostedOwner=u.hostname.endsWith('.chatgpt.site') && ownerEmail && req.headers.get('oai-authenticated-user-id') && req.headers.get('oai-authenticated-user-email')?.toLowerCase()===ownerEmail;
 master=Boolean(hostedOwner||(env.ADMIN_KEY&&key===env.ADMIN_KEY));
 if(!master&&(!key||!await q('SELECT id FROM staff WHERE digest=?',await hash(key)).first()))fail('Acceso de tienda requerido.',401)}
 if(post && req.headers.get('origin') && req.headers.get('origin')!==u.origin)fail('Origen inválido.',403);
 await cleanup(db);
 if(p.startsWith('/api/claim/')&&!post){const h=await q("SELECT product,expires FROM holds WHERE token=? AND owner LIKE 'ig:%' AND expires>?",p.split('/').pop(),now).first();if(!h)fail('Este enlace de apartado venció.',404);return json(h)}
 if(p==='/api/wompi'&&post){
 if(!env.WOMPI_SECRET||!env.WOMPI_APP_ID)fail('Integración inactiva.',503);
 const sig=req.headers.get('wompi_hash')||'';if(!/^[0-9a-f]{64}$/i.test(sig))fail('Firma inválida.',403);
 const body=await req.arrayBuffer(),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WOMPI_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g),s=>parseInt(s,16)),body))fail('Firma inválida.',403);
 const event=JSON.parse(new TextDecoder().decode(body));
 if(event.Aplicativo?.Id!==env.WOMPI_APP_ID||event.EsProductiva!==(env.WOMPI_LIVE==='true')||event.ResultadoTransaccion!=='ExitosaAprobada')fail('Evento ajeno al comercio o ambiente.',400);
 const id=field(event.EnlacePago?.IdentificadorEnlaceComercio,64),tx=field(event.IdTransaccion,100),amount=Math.round(Number(event.Monto)*100);
 const prior=await q('SELECT tx FROM wompi_events WHERE tx=?',tx).first();if(prior)return json({ok:true});
 if(!Number.isSafeInteger(amount)||amount<=0)fail('Monto inválido.');
 await db.batch([q('INSERT OR IGNORE INTO wompi_events VALUES(?,?,?,?)',tx,id,amount,now),
 q("UPDATE orders SET status='pagado' WHERE id=? AND total=? AND status='pendiente' AND expires>? AND EXISTS(SELECT 1 FROM payment_links WHERE order_id=?)",id,amount,now,id),
 q("UPDATE products SET sold=1 WHERE id IN(SELECT product FROM holds WHERE owner=?) AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pagado')",id,id),
 q("DELETE FROM holds WHERE owner=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pagado')",id,id),q('DELETE FROM queue WHERE product IN(SELECT id FROM products WHERE sold=1)'),
 audit('Wompi: conciliar importe y estado',id+' / '+tx+' / '+amount)]);return json({ok:true})}
 if(p==='/api/admin/payment-link'&&post){if(!env.WOMPI_SECRET||!env.WOMPI_APP_ID)fail('Configura el comercio Wompi antes de asociar enlaces.');const b=await req.json(),url=new URL(field(b.url,500));if(url.protocol!=='https:'||!(url.hostname==='wompi.sv'||url.hostname.endsWith('.wompi.sv')))fail('Usa un enlace oficial de Wompi SV.');await q('INSERT OR REPLACE INTO payment_links VALUES(?,?)',field(b.id,64),url.href).run();return json({ok:true})}
 if(p==='/api/admin/photo'&&post){
 const ct=req.headers.get('content-type');if(!['image/jpeg','image/png','image/webp'].includes(ct))fail('Usa JPEG, PNG o WebP.');
 const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>3145728||bytes.length<12)fail('La foto debe pesar hasta 3 MB.');
 const k='photo/'+crypto.randomUUID();await env.BUCKET.put(k,bytes,{httpMetadata:{contentType:ct}});return json({image:'/api/'+k})}
 if(p.startsWith('/api/photo/')&&!post){if(!/^\/api\/photo\/[a-f0-9-]{36}$/.test(p))fail('Foto inválida.',404);const f=await env.BUCKET.get(p.slice(5));if(!f)fail('Foto ausente.',404);return new Response(f.body,{headers:{'Content-Type':f.httpMetadata.contentType,'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'}})}
 if(p==='/api/catalog'){return json({products:await rows("SELECT p.*,CASE WHEN sold=1 THEN 'Vendido' WHEN h.product IS NOT NULL THEN 'Reservado' WHEN d.starts>? THEN 'Próximamente' ELSE 'Disponible' END status FROM products p JOIN drops d ON p.drop_id=d.id LEFT JOIN holds h ON h.product=p.id ORDER BY p.id",now),drops:await rows('SELECT * FROM drops ORDER BY starts'),fee:Number((await q("SELECT value FROM settings WHERE id='fee'").first())?.value??350),transfer:(await q("SELECT value FROM settings WHERE id='transfer'").first())?.value||'',demo:env.LIVE_CATALOG!=='true'})}
 if(p==='/api/admin/orders'&&!post){
 const term=(u.searchParams.get('q')||'').trim().toLowerCase(),state=u.searchParams.get('status')||'';
 const filter=" WHERE (?='' OR status=?) AND (instr(lower(id),?)>0 OR instr(lower(name),?)>0 OR instr(lower(contact),?)>0)";
 const args=[state,state,term,term,term],limit=25;
 const count=(await q('SELECT COUNT(*) AS n FROM orders'+filter,...args).first()).n;
 const pages=Math.max(1,Math.ceil(count/limit)),page=Math.min(pages,Math.max(1,parseInt(u.searchParams.get('page'),10)||1));
 const orders=await rows('SELECT id,name,contact,delivery,address,total,fee,status,expires,created,receipt IS NOT NULL AS receipt FROM orders'+filter+' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?',...args,limit,(page-1)*limit);
 return json({orders,count,page,pages})}
 if(p==='/api/admin'&&!post)return json({orderCount:(await q('SELECT COUNT(*) n FROM orders').first()).n,holds:await rows('SELECT * FROM holds'),queue:await rows('SELECT * FROM queue ORDER BY id'),audit:await rows('SELECT * FROM audit ORDER BY id DESC LIMIT 60'),staff:master?await rows('SELECT id FROM staff'):[],master,revenue:(await q("SELECT COALESCE(SUM(total),0) amount FROM orders WHERE status IN ('pagado','entregado')").first()).amount});
 const match=p.match(/^\/api\/orders\/([a-f0-9-]{36})(\/receipt)?$/);
 if(match){
 const o=await q('SELECT * FROM orders WHERE id=?',match[1]).first();if(!o)fail('Pedido no encontrado.',404);
 if(!post&&!match[2])return json({paymentUrl:(await q('SELECT url FROM payment_links WHERE order_id=?',o.id).first())?.url,status:o.status,total:o.total,fee:o.fee,expires:o.expires,receipt:!!o.receipt,items:await rows('SELECT p.name,i.amount FROM items i JOIN products p ON i.product=p.id WHERE order_id=?',o.id)});
 if(post&&match[2]){
 if(o.status!=='pendiente'||o.expires<=now)fail('El pedido ya no admite comprobantes.',409);
 const ct=req.headers.get('content-type');if(!['image/jpeg','image/png'].includes(ct))fail('Usa una imagen JPG o PNG.');
 if(+req.headers.get('content-length')>3145728)fail('Máximo 3 MB.');const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>3145728||!(ct==='image/png'?bytes[0]===137&&bytes[1]===80:bytes[0]===255&&bytes[1]===216))fail('Imagen inválida o mayor que 3 MB.');
 const key='proof/'+crypto.randomUUID();await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:ct}});
 await db.batch([q("UPDATE orders SET receipt=?,status='en revisión' WHERE id=? AND status='pendiente' AND expires>?",key,o.id,Date.now()),q("UPDATE holds SET expires=? WHERE owner=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND receipt=?)",8640000000000000,o.id,o.id,key)]);
 if(!(await q('SELECT id FROM orders WHERE receipt=?',key).first())){await env.BUCKET.delete(key);fail('El pedido cambió. Actualiza la consulta.',409)}return json({ok:true})}}
 if(p.startsWith('/api/admin/proof/')&&!post){const o=await q('SELECT receipt FROM orders WHERE id=?',p.split('/').pop()).first();if(!o?.receipt)fail('Sin comprobante.',404);const f=await env.BUCKET.get(o.receipt);if(!f)fail('Archivo ausente.',404);return new Response(f.body,{headers:{'Content-Type':f.httpMetadata.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
 if(!post)fail('Ruta desconocida.',404);
 const b=await req.json();if(!b||typeof b!=='object')fail('Formulario inválido.');
 if(p==='/api/orders'){
 const ids=[...new Set(Array.isArray(b.products)?b.products:[])];if(!ids.length||ids.length>30)fail('Revisa tu selección.');
 const rk=field(b.key,64);if(!/^[a-f0-9-]{36}$/.test(rk))fail('Clave de pedido inválida.');
 const existing=await q('SELECT id FROM orders WHERE request_key=?',rk).first();if(existing)return json(existing);
 const name=field(b.name),contact=field(b.contact,100);if(!/^[+\d\s()-]{8,20}$/.test(contact)&&!/^\S+@\S+\.\S+$/.test(contact))fail('Escribe un teléfono o correo válido.');
 const delivery=b.delivery;if(!['Retiro','Envío'].includes(delivery))fail('Elige la entrega.');const address=delivery==='Envío'?field(b.address,400):'';
 const fee=delivery==='Envío'?Number((await q("SELECT value FROM settings WHERE id='fee'").first())?.value??350):0;
 const id=crypto.randomUUID(),exp=now+1800000;
 const statements=[q("INSERT INTO orders(id,request_key,name,contact,delivery,address,total,fee,status,expires,created) VALUES(?,?,?,?,?,?,?,?,'pendiente',?,?)",id,rk,name,contact,delivery,address,fee,fee,exp,now)];
 if(b.claim){const hold=await q("SELECT product FROM holds WHERE token=? AND owner LIKE 'ig:%' AND expires>?",b.claim,now).first();if(!hold||!ids.includes(hold.product))fail('El apartado ya venció.',409);statements.push(q("DELETE FROM holds WHERE token=? AND product=? AND owner LIKE 'ig:%' AND expires>?",b.claim,hold.product,now))}
 for(const pid of ids){statements.push(q("INSERT INTO holds(product,owner,expires) VALUES((SELECT p.id FROM products p JOIN drops d ON d.id=p.drop_id WHERE p.id=? AND p.sold=0 AND d.starts<=?),?,?)",pid,now,id,exp),q('INSERT INTO items SELECT ?,id,price FROM products WHERE id=?',id,pid))}
 statements.push(q('UPDATE orders SET total=fee+(SELECT sum(amount) FROM items WHERE order_id=?) WHERE id=?',id,id),audit('pedido creado',id));
 try{await db.batch(statements)}catch(e){const same=await q('SELECT id FROM orders WHERE request_key=?',rk).first();if(same)return json(same);if(/constraint/i.test(e.message))fail('Una pieza ya no está disponible. Revisa tu bolsa.',409);throw e}return json({id},201)}
 if(p==='/api/admin/settings'){await db.batch([q("INSERT OR REPLACE INTO settings VALUES('fee',?)",num(b.fee,100000)),q("INSERT OR REPLACE INTO settings VALUES('transfer',?)",String(b.transfer||'').slice(0,500))]);return json({ok:true})}
 if(p==='/api/admin/drop'){if(b.createOnly && await q('SELECT id FROM drops WHERE id=?',b.id).first())fail('Este código de drop ya existe.',409);const saved=await q('INSERT INTO drops VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,starts=excluded.starts WHERE ?=0',field(b.id,30),field(b.title),num(b.starts,8640000000000000),b.createOnly?1:0).run();if((saved.meta?.changes??saved.changes)===0)fail('El código ya está en uso.',409);return json({ok:true})}
 if(p==='/api/admin/product'){const id=field(b.id,30);if(b.createOnly && await q('SELECT id FROM products WHERE id=?',id).first())fail('Este código de prenda ya existe.',409);if(!await q('SELECT id FROM drops WHERE id=?',field(b.drop_id,30)).first())fail('Selecciona un drop existente.');const image=field(b.image,120);if(!/^\/(img\/[\w.-]+|api\/photo\/[a-f0-9-]{36})$/.test(image))fail('Indica una foto de la carpeta img.');const saved=await q('INSERT INTO products(id,name,category,size,price,measures,condition,image,drop_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,size=excluded.size,price=excluded.price,measures=excluded.measures,condition=excluded.condition,image=excluded.image,drop_id=excluded.drop_id WHERE ?=0',id,field(b.name),field(b.category),field(b.size),num(b.price,10000000),field(b.measures),field(b.condition),image,field(b.drop_id,30),b.createOnly?1:0).run();if((saved.meta?.changes??saved.changes)===0)fail('El código ya está en uso.',409);return json({ok:true})}
 if(p==='/api/admin/staff'){if(!master)fail('Solo titular.',403);const id=field(b.id,50);if(b.remove)await q('DELETE FROM staff WHERE id=?',id).run();else{const key=crypto.randomUUID();await q('INSERT OR REPLACE INTO staff VALUES(?,?)',id,await hash(key)).run();return json({key})}return json({ok:true})}
 if(p==='/api/admin/reserve'){const pid=field(b.product,30),handle=field(b.handle,35).replace(/^@/,'').toLowerCase();if(!/^[a-z0-9._]{1,30}$/.test(handle))fail('Usuario de Instagram inválido.');const minutes=num(b.minutes,1440);if(!minutes)fail('Indica minutos.');const ok=await q('SELECT p.id FROM products p JOIN drops d ON d.id=p.drop_id WHERE p.id=? AND p.sold=0 AND d.starts<=?',pid,now).first();if(!ok)fail('Pieza fuera de venta.');await db.batch([q('INSERT OR IGNORE INTO queue(product,handle,minutes) VALUES(?,?,?)',pid,handle,minutes),audit('MÍO registrado',pid+' @'+handle)]);await cleanup(db);return json({ok:true})}
 if(p==='/api/admin/hold'){const pid=field(b.product),owner=field(b.owner);if(!owner.startsWith('ig:'))fail('Gestiona este apartado desde pedidos.');if(b.sell)await db.batch([q('UPDATE products SET sold=1 WHERE id=? AND EXISTS(SELECT 1 FROM holds WHERE product=? AND owner=? AND expires>?)',pid,pid,owner,now),q('DELETE FROM queue WHERE product=? AND EXISTS(SELECT 1 FROM products WHERE id=? AND sold=1)',pid,pid),q('DELETE FROM holds WHERE product=? AND owner=?',pid,owner),audit('cierre manual',pid+' '+owner)]);else await db.batch([q('DELETE FROM holds WHERE product=? AND owner=?',pid,owner),audit('liberación manual',pid+' '+owner)]);await cleanup(db);return json({ok:true})}
 if(p==='/api/admin/order'){const id=field(b.id),next=b.status;
 if(next==='pagado')await db.batch([q("UPDATE orders SET status='pagado' WHERE id=? AND status IN ('en revisión','pendiente') AND (status='en revisión' OR expires>?)",id,now),q("UPDATE products SET sold=1 WHERE id IN(SELECT product FROM holds WHERE owner=?) AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pagado')",id,id),q('DELETE FROM queue WHERE product IN(SELECT id FROM products WHERE sold=1)'),q("DELETE FROM holds WHERE owner=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pagado')",id,id),audit('revisión de pago',id)]);
 else if(next==='cancelado')await db.batch([q("UPDATE orders SET status='cancelado' WHERE id=? AND status IN ('pendiente','en revisión')",id),q("DELETE FROM holds WHERE owner=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelado')",id,id),audit('cancelación',id)]);
 else if(next==='entregado')await q("UPDATE orders SET status='entregado' WHERE id=? AND status='pagado'",id).run();else fail('Estado inválido.');
 if((await q('SELECT status FROM orders WHERE id=?',id).first())?.status!==next)fail('El pedido cambió de estado.',409);return json({ok:true})}
 fail('Ruta desconocida.',404);
 }catch(e){return json({error:e.status?e.message:'No se pudo procesar la operación.'},e.status||500)}
}
