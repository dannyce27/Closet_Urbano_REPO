const $ = selector => document.querySelector(selector);
const screen = $('#screen');
const modal = $('#modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('es-SV', {style:'currency', currency:'USD'}).format(cents / 100);
const date = time => new Intl.DateTimeFormat('es-SV', {timeZone:'America/El_Salvador', dateStyle:'medium', timeStyle:'short'}).format(time);
const localDateInput = time => new Date(time - 6 * 3600000).toISOString().slice(0,16);
const states = ['pendiente', 'en revisión', 'pagado', 'entregado', 'cancelado', 'vencido'];
const tabs = {overview:'Resumen', orders:'Pedidos', drops:'Drops y prendas', holds:'Reservas MÍO', settings:'Ajustes'};
const shapes = {
 overview:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
 orders:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h6"/>',
 drops:'<path d="m3 7 9-4 9 4-9 4zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
 holds:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>',
 settings:'<path d="M3 7h7m5 0h6M3 17h11m5 0h2"/><circle cx="12" cy="7" r="2.3"/><circle cx="16" cy="17" r="2.3"/>',
 pieces:'<path d="m3 6 5-3a5 5 0 0 0 8 0l5 3-2 6-3-1v10H8V11l-3 1z"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">'+shapes[name]+'</svg>';
const btn = (action,label,id='',style='secondary') => `<button type="button" class="${style}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const empty = label => `<p class="empty">${esc(label)}</p>`;
const selected = (a,b) => a === b ? ' selected' : '';
const badge = state => {
 const tone = {'Activo':'green','Disponible':'green','pagado':'green','entregado':'green','Próximamente':'orange','pendiente':'orange','Reservado':'orange','en revisión':'blue','cancelado':'red','vencido':'red'}[state] || '';
 return `<span class="badge ${tone}">${esc(state)}</span>`;
};
const field = (name,label,value='',type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" required ${extra}></label>`;
const select = (name,label,options,value='') => `<label>${label}<select name="${name}" required>${options.map(([id,title])=>`<option value="${esc(id)}"${selected(id,value)}>${esc(title)}</option>`).join('')}</select></label>`;
const form = (task,fields,submit) => `<form data-task="${task}">${fields}<div class="formerror" role="alert"></div><button class="primary">${submit}</button></form>`;
let key='', current='overview', activeDrop='', query='', status='', page=1, admin, catalog, result, refreshSeq=0, orderSeq=0, messageTimer, searchTimer;

async function api(path,body,raw=false){
 const headers={}; if(key)headers.Authorization='Bearer '+key;
 if(body)headers['Content-Type']=raw?body.type:'application/json';
 const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers,body:body?(raw?body:JSON.stringify(body)):undefined});
 const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.error || 'No se pudo completar la operación.'),{status:response.status});
 return value;
}
function message(text){$('#feedback').textContent=text;clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('#feedback').textContent='',7000)}
function dialog(type,title,html){$('#modal-type').textContent=type;$('#modal-body').innerHTML='<h2 id="modal-title">'+esc(title)+'</h2>'+html;if(!modal.open)modal.showModal();modal.scrollTop=0}
$('#close').onclick=()=>modal.close();
function heading(title,actions=''){return `<div class="heading"><h2>${esc(title)}</h2><div class="actions">${actions}</div></div>`}
function title(title,actions=''){return `<div class="heading"><h1>${esc(title)}<span>.</span></h1><div class="actions">${actions}</div></div>`}
function productsOf(id){return catalog.products.filter(p=>p.drop_id===id)}
function dropStatus(d){return d.starts>Date.now()?'Próximamente':'Activo'}
function dropCard(d){
 const pieces=productsOf(d.id), first=pieces[0];
 return `<button class="dropcard" data-action="drop" data-id="${esc(d.id)}">${first?`<img src="${esc(first.image)}" alt="">`:'<span class="dropthumb"></span>'}<span class="dropcopy">${badge(dropStatus(d))}<strong>${esc(d.title)}</strong><small>Drop ${esc(d.id)} · ${pieces.length} prendas</small><small>${d.starts?date(d.starts)+' SV':'Venta abierta'}</small></span></button>`;
}
function orderTable(orders){
 if(!orders.length)return empty(query||status?'No hay pedidos que coincidan con esta búsqueda.':'Todavía no hay pedidos. Cuando un cliente confirme su compra, aparecerá aquí con su código de seguimiento.');
 return `<table><thead><tr><th>Pedido / código privado</th><th>Cliente</th><th>Estado</th><th>Total</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr><td><code>${esc(o.id)}</code><br><small class="muted">${date(o.created)} SV</small></td><td>${esc(o.name)}</td><td>${badge(o.status)}</td><td>${money(o.total)}</td><td>${btn('order','Abrir',o.id,'textbtn')}</td></tr>`).join('')}</tbody></table>`;
}
async function loadOrders(){
 const seq=++orderSeq;const r=await api('admin/orders?'+new URLSearchParams({q:query,status,page}));
 if(seq!==orderSeq||current!=='orders')return;
 result=r;page=r.page;$('#orderlist').innerHTML=orderTable(r.orders);
 $('#count').textContent=r.count+' '+(r.count===1?'pedido':'pedidos');
 $('#pager').innerHTML=`<span>Página ${r.page} de ${r.pages}</span><div class="actions"><button class="secondary" data-action="prev" ${r.page===1?'disabled':''}>Anterior</button><button class="secondary" data-action="next" ${r.page===r.pages?'disabled':''}>Siguiente</button></div>`;
}
function ordersPage(){
 return title('Pedidos',btn('refresh','Actualizar'))+`<div class="filters"><input id="search" type="search" aria-label="Buscar pedido" placeholder="Buscar por código, cliente o contacto" value="${esc(query)}"><select id="state" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${states.map(s=>`<option${selected(s,status)}>${s}</option>`).join('')}</select></div><p id="count" class="muted"></p><div class="tablebox" id="orderlist" aria-live="polite">${empty('Cargando pedidos…')}</div><div class="pager" id="pager"></div>`;
}
function overview(){
 const active=catalog.drops.filter(d=>dropStatus(d)==='Activo').length;
 return `<div class="banner"><p class="kicker">CLOSET URBANO / OPERACIONES</p><h1>Control de tienda<span>.</span></h1><p>Pedidos, prendas y lanzamientos.</p></div><div class="metrics">${[[admin.orderCount,'Pedidos','orders'],[active,'Drops activos','drops'],[catalog.products.length,'Prendas en catálogo','pieces']].map(([v,n,ic])=>`<div class="stat"><small>${n}</small>${icon(ic)}<b>${String(v).padStart(2,'0')}</b></div>`).join('')}</div>`+
 heading('Drops de la tienda',btn('nav','Ver todos →','drops','textbtn'))+
 (catalog.drops.length?'<div class="dropgrid">'+catalog.drops.slice(-2).reverse().map(dropCard).join('')+'</div>':empty('Crea tu primer drop para cargar prendas.'))+
 heading('Pedidos recientes',btn('nav','Ir a pedidos →','orders','textbtn'))+'<div id="recent" class="tablebox"></div>';
}
function dropsPage(){
 const d=catalog.drops.find(v=>v.id===activeDrop);
 if(!d)return title('Drops y prendas',btn('new-drop','+ Crear drop','','primary'))+'<div class="dropgrid">'+catalog.drops.map(dropCard).join('')+'</div>'+(catalog.drops.length?'':empty('Aún no hay drops.'));
 const pieces=productsOf(d.id);
 return `<div class="back">${btn('all-drops','← Todos los drops','','textbtn')}</div>`+title(d.title,btn('edit-drop','Editar fecha y nombre',d.id)+btn('new-product','+ Subir prenda',d.id,'primary'))+
 `<div class="box split"><div>${badge(dropStatus(d))} <small class="muted">Drop ${esc(d.id)}</small><p class="subtle">${d.starts?'Lanzamiento · '+date(d.starts)+' SV':'Disponible para comprar'}</p></div><b>${pieces.length} prendas</b></div>`+
 heading('Prendas de este drop')+(pieces.length?`<div class="productgrid">${pieces.map(p=>`<button class="piece" data-action="edit-product" data-id="${esc(p.id)}"><img src="${esc(p.image)}" alt=""><b>${esc(p.name)}</b><small>${esc(p.id)} · Talla ${esc(p.size)} · ${money(p.price)}</small><small>${badge(p.status)}</small></button>`).join('')}</div>`:empty('Este drop está listo para recibir su primera prenda.'));
}
function dropEditor(d){
 const starts=d?.starts??Date.now()+86400000;
 dialog('PROGRAMACIÓN',d?'Editar drop':'Crear drop',form('drop',field('id','Código del drop',d?.id||'','text',d?'readonly':'maxlength="30"')+field('title','Nombre del drop',d?.title||'','text','maxlength="180"')+select('mode','Apertura',[['scheduled','Programar lanzamiento'],['now','Disponible ahora']],starts?'scheduled':'now')+`<label id="date-field" ${starts?'':'hidden'}>Fecha y hora de El Salvador<input name="starts" type="datetime-local" value="${localDateInput(starts||Date.now())}" ${starts?'required':''}></label><small class="muted">Las prendas de un drop futuro muestran «Próximamente» hasta su hora de lanzamiento.</small>`,d?'Guardar cambios':'Crear drop'));
 modal.querySelector('form').dataset.creating=String(!d);
}
function productEditor(d,p){
 dialog('INVENTARIO / '+d.title,p?'Editar prenda':'Subir prenda a '+d.title,form('product',
 select('drop_id','Drop de la prenda',catalog.drops.map(d=>[d.id,d.title+' · '+d.id]),d.id)+
 `<label>Fotografía · JPG, PNG o WebP, hasta 3 MB<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" ${p?'':'required'}></label><img id="photo-preview" class="preview-img" ${p?'src="'+esc(p.image)+'"':'hidden'} alt="Vista previa de la prenda">`+
 field('name','Nombre de la prenda',p?.name)+
 `<div class="formgrid">${field('id','Código único',p?.id,'text',p?'readonly':'maxlength="30"')}${field('price','Precio (USD)',p?(p.price/100).toFixed(2):'','number','min="0.01" max="100000" step="0.01"')}${field('category','Categoría',p?.category)}${field('size','Talla',p?.size)}</div>`+
 field('condition','Condición',p?.condition)+field('measures','Medidas',p?.measures),p?'Guardar cambios':'Guardar prenda'));
 const f=modal.querySelector('form');f.dataset.image=p?.image||'';f.dataset.creating=String(!p);
}
function holdsPage(){
 const list=(rows,fn)=>rows.length?rows.map(x=>'<div class="listrow">'+fn(x)+'</div>').join(''):empty('Sin registros.');
 return title('Reservas MÍO',btn('reserve','+ Registrar MÍO','','primary'))+heading('Apartados activos')+'<div class="box">'+list(admin.holds,h=>`<b>${esc(h.product)}</b> · ${esc(h.owner)}<small>${h.expires>1e15?'En revisión':date(h.expires)+' SV'}</small>${h.owner.startsWith('ig:')?'<div class="actions">'+btn('claim','Enlace de checkout',h.token)+btn('release','Liberar',h.product)+btn('sell','Marcar vendida',h.product)+'</div>':''}`)+'</div>'+heading('Lista de espera')+'<div class="box">'+list(admin.queue,x=>esc(x.product)+' · @'+esc(x.handle))+'</div>';
}
function settingsPage(){
 return title('Ajustes')+'<div class="box split"><span>Total cobrado en pedidos pagados y entregados</span><b>'+money(admin.revenue)+'</b></div>'+heading('Entregas y transferencias')+'<div class="box">'+form('settings',field('fee','Tarifa de envío (USD)',(catalog.fee/100).toFixed(2),'number','min="0" step="0.01" max="1000"')+`<label>Instrucciones para transferencia<textarea name="transfer" maxlength="500">${esc(catalog.transfer)}</textarea></label>`,'Guardar ajustes')+'</div>'+
 (admin.master?heading('Equipo',btn('staff','+ Generar clave'))+'<div class="box">'+(admin.staff.map(s=>`<div class="listrow split">${esc(s.id)}${btn('revoke','Revocar',s.id)}</div>`).join('')||empty('Aún no hay colaboradores con clave.'))+'</div>':'')+
 heading('Actividad reciente')+'<div class="box">'+(admin.audit.map(a=>`<div class="listrow"><small>${date(a.created)} SV</small>${esc(a.action)} · ${esc(a.detail)}</div>`).join('')||empty('Sin actividad registrada.'))+'</div>';
}
async function refresh(){
 const seq=++refreshSeq;
 const [a,c]=await Promise.all([api('admin'),api('catalog')]);if(seq!==refreshSeq)return;
 admin=a;catalog=c;$('#access').hidden=true;
 $('#nav').innerHTML=Object.entries(tabs).map(([id,n])=>btn('nav',icon(id)+n,id,id===current?'active':'nav-button')).join('');
 $('#location').textContent=tabs[current];
 if(key)$('#nav').insertAdjacentHTML('beforeend',btn('logout','Cerrar sesión','','nav-button'));
 screen.innerHTML='<section>'+({overview,orders:ordersPage,drops:dropsPage,holds:holdsPage,settings:settingsPage}[current])()+'</section>';
 if(current==='orders')await loadOrders();
 if(current==='overview'){const r=await api('admin/orders?page=1');if(seq===refreshSeq&&$('#recent')){result=r;$('#recent').innerHTML=orderTable(r.orders.slice(0,3))}}
}
async function orderDetail(id){
 const o=result?.orders.find(o=>o.id===id);if(!o)return;
 const detail=await api('orders/'+encodeURIComponent(id));
 const state=detail.status;
 const commands=['pendiente','en revisión'].includes(state)?btn('pagado','Confirmar pago',id,'primary')+btn('cancelado','Cancelar pedido',id,'danger'):state==='pagado'?btn('entregado','Marcar entregado',id,'primary'):'';
 dialog('PEDIDOS','Detalle del pedido',`${badge(state)}<div class="listrow"><small>Código privado de seguimiento</small><code>${esc(id)}</code><div class="actions">${btn('copy','Copiar código',id,'textbtn')}${btn('tracking','Copiar enlace',id,'textbtn')}</div></div><div class="listrow"><b>${esc(o.name)}</b><small>${esc(o.contact)} · ${date(o.created)} SV</small></div><div class="listrow">${esc(o.delivery)} · ${money(detail.fee)}<small>${esc(o.address)}</small></div>${detail.items.map(p=>`<div class="listrow split"><span>${esc(p.name)}</span><b>${money(p.amount)}</b></div>`).join('')}<div class="listrow split"><b>Total</b><strong>${money(detail.total)}</strong></div><div class="actions">${detail.receipt?btn('proof','Descargar comprobante',id):''}${state==='pendiente'?btn('wompi','Asociar enlace Wompi',id):''}${commands}</div><div class="formerror" role="status"></div>`);
}
let previewUrl;
modal.addEventListener('close',()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}});
document.addEventListener('change',e=>{
 if(e.target.name==='mode'){const on=e.target.value==='scheduled';$('#date-field').hidden=!on;$('#date-field input').required=on}
 if(e.target.name==='photo'){const file=e.target.files[0];if(!file)return;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$('#photo-preview').src=previewUrl;$('#photo-preview').hidden=false;e.target.closest('form').dataset.uploaded=''}
 if(e.target.id==='state'){status=e.target.value;page=1;loadOrders().catch(e=>message(e.message))}
});
document.addEventListener('input',e=>{if(e.target.id==='search'){query=e.target.value;page=1;orderSeq++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadOrders().catch(e=>message(e.message)),180)}});
function setError(e){const node=modal.open?modal.querySelector('.formerror'):null;if(node)node.textContent=e.message;else message(e.message)}
async function copy(text){try{await navigator.clipboard.writeText(text);if(modal.open){const f=modal.querySelector('.formerror');if(f)f.textContent='Copiado.'}else message('Copiado.')}catch{dialog('COPIAR','Copiar texto','<input aria-label="Texto para copiar" readonly value="'+esc(text)+'">');modal.querySelector('input').select()}}
document.addEventListener('click',async e=>{
 const target=e.target.closest('[data-action]');if(!target)return;const {action,id}=target.dataset;
 try{
 switch(action){
 case 'nav':clearTimeout(searchTimer);current=id;activeDrop='';break;
 case 'refresh':break;
 case 'logout':key='';location.reload();return;
 case 'prev':page--;await loadOrders();return;
 case 'next':page++;await loadOrders();return;
 case 'all-drops':activeDrop='';break;
 case 'drop':current='drops';activeDrop=id;break;
 case 'new-drop':dropEditor();return;
 case 'edit-drop':dropEditor(catalog.drops.find(x=>x.id===id));return;
 case 'new-product':productEditor(catalog.drops.find(x=>x.id===id));return;
 case 'edit-product':{const p=catalog.products.find(x=>x.id===id);productEditor(catalog.drops.find(d=>d.id===p.drop_id),p);return}
 case 'order':await orderDetail(id);return;
 case 'copy':await copy(id);return;
 case 'tracking':await copy(location.origin+'/#pedido='+id);return;
 case 'claim':await copy(location.origin+'/#apartado='+id);return;
 case 'reserve':dialog('RESERVAS','Registrar MÍO',form('reserve',select('product','Prenda',catalog.products.filter(p=>['Disponible','Reservado'].includes(p.status)).map(p=>[p.id,p.name+' · '+p.id]))+field('handle','Usuario en Instagram')+field('minutes','Duración en minutos',30,'number','min="1" max="1440"'),'Registrar reserva'));return;
 case 'staff':dialog('EQUIPO','Generar clave',form('staff',field('id','Identificador del colaborador'),'Generar o renovar clave'));return;
 case 'wompi':dialog('COBROS','Asociar enlace Wompi',form('payment-link',field('id','Pedido',id,'text','readonly')+field('url','URL oficial de Wompi','','url'),'Guardar enlace'));return;
 case 'proof':{const r=await fetch('/api/admin/proof/'+id,{headers:key?{Authorization:'Bearer '+key}:{}});if(!r.ok)throw Error('No se pudo descargar el comprobante.');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='comprobante-'+id+(r.headers.get('content-type')==='image/png'?'.png':'.jpg');a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);return}
 case 'pagado':case 'entregado':case 'cancelado':
 if(!confirm('¿Cambiar el pedido '+id+' a '+action+'?'))return;await api('admin/order',{id,status:action});modal.close();message('Pedido actualizado.');break;
 case 'release':case 'sell':{const h=admin.holds.find(h=>h.product===id);if(!h||!confirm('¿Actualizar el apartado de '+id+'?'))return;await api('admin/hold',{product:id,owner:h.owner,sell:action==='sell'});message('Reserva actualizada.');break}
 case 'revoke':if(!confirm('¿Revocar la clave de '+id+'?'))return;await api('admin/staff',{id,remove:true});break;
 default:return;
 }
 await refresh();
 }catch(e){setError(e)}
});
document.addEventListener('submit',async e=>{
 const f=e.target;if(f.id==='login')return;e.preventDefault();const task=f.dataset.task;if(!task)return;
 const submit=f.querySelector('button[type=submit],button.primary');submit.disabled=true;const error=f.querySelector('.formerror');error.textContent='';
 const body=Object.fromEntries(new FormData(f));
 try{
 if(task==='product'){
 const file=body.photo;delete body.photo;body.createOnly=f.dataset.creating==='true';
 body.image=f.dataset.uploaded||f.dataset.image;
 if(file?.size&&!f.dataset.uploaded){if(file.size>3145728)throw Error('La foto supera los 3 MB.');const j=await api('admin/photo',file,true);body.image=j.image;f.dataset.uploaded=j.image}
 body.price=Math.round(Number(body.price)*100);
 }
 if(task==='drop'){body.createOnly=f.dataset.creating==='true';body.starts=body.mode==='now'?0:Date.parse(body.starts+':00-06:00');delete body.mode}
 if(task==='reserve')body.minutes=Number(body.minutes);
 if(task==='settings')body.fee=Math.round(Number(body.fee)*100);
 const response=await api('admin/'+task,body);
 if(task==='drop'||task==='product'){current='drops';activeDrop=task==='drop'?body.id:body.drop_id}
 if(modal.open)modal.close();await refresh();
 if(response.key){dialog('EQUIPO','Clave del colaborador','<p>Guarda esta clave para el colaborador.</p><input readonly aria-label="Clave del colaborador" value="'+esc(response.key)+'">')}
 else message(task==='product'?'Prenda guardada en el drop.':task==='drop'?'Drop guardado.':'Cambios guardados.');
 }catch(e){error.textContent=e.message}finally{submit.disabled=false}
});
$('#login').onsubmit=async e=>{e.preventDefault();key=e.target.key.value;try{await refresh();e.target.reset()}catch(e){key='';message(e.message)}};
refresh().catch(e=>{if(e.status!==401)message(e.message)});
