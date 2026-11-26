/* =====================================================================
   Mi Edificio — frontend (vanilla JS) sobre Supabase
   Auth (email/clave) · Postgres con RLS · Storage (bucket "fotos") · Realtime
   Una instalación = un edificio. RLS decide qué ve y qué puede hacer cada rol.
   ===================================================================== */
(function(){
'use strict';

// ---------- utilidades ----------
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rnd = ()=> Math.random().toString(36).slice(2,10);
const rndSeguro = ()=> Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join('');
const now = ()=> new Date().toISOString();
const clp = n => '$'+Math.round(Number(n)||0).toLocaleString('es-CL');
const pad = n => String(n).padStart(2,'0');
const todayStr = ()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const monthStr = ()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1);};
const fmtDate = iso => { if(!iso) return ''; const d=new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short'})+' '+pad(d.getHours())+':'+pad(d.getMinutes()); };
const fmtDay = ymd => { if(!ymd) return ''; const [y,m,d]=String(ymd).slice(0,10).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('es-CL',{weekday:'short',day:'2-digit',month:'short'}); };
const fmtMonth = ym => { if(!ym) return ''; const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('es-CL',{month:'long',year:'numeric'}); };
const seg = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9_\-]/g,'_').slice(0,60)||'x';
const sortBy = (arr,f,desc)=>arr.slice().sort((a,b)=>{const x=f(a),y=f(b);return (x<y?-1:x>y?1:0)*(desc?-1:1);});
const durTxt = ms => { const m=Math.max(0,Math.floor(ms/60000)); return m<60? m+' min' : Math.floor(m/60)+' h'+(m%60?' '+(m%60)+' min':''); };
const horaDe = iso => { const d=new Date(iso); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const errMsg = e => (e&&(e.message||e.error_description||e.msg))||String(e);

let toastT; function toast(m){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=m; clearTimeout(toastT); toastT=setTimeout(()=>t.remove(),3000); }
function modal(html){ closeModal(); const m=document.createElement('div'); m.className='modal'; m.innerHTML='<div class="box">'+html+'</div>'; m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('[data-close]')) closeModal(); }); document.body.appendChild(m); return m; }
function closeModal(){ $$('.modal').forEach(m=>m.remove()); }
function confirmBox(msg){ return new Promise(res=>{ const m=modal(`<h3>Confirmar</h3><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn sec" data-x="no">Cancelar</button><button class="btn dan" data-x="si">Confirmar</button></div>`); m.addEventListener('click',e=>{ const x=e.target.closest('[data-x]'); if(!x) return; closeModal(); res(x.dataset.x==='si'); }); }); }
function askText(label, def=''){ return new Promise(res=>{ const m=modal(`<h3>${esc(label)}</h3><form id="fAsk"><textarea name="t">${esc(def)}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn sec" id="no">Cancelar</button><button class="btn">Aceptar</button></div></form>`); $('#no',m).addEventListener('click',()=>{closeModal();res(null);}); $('#fAsk',m).addEventListener('submit',e=>{e.preventDefault(); const v=$('[name=t]',m).value.trim(); closeModal(); res(v);}); }); }
function formData(form){ const o={}; new FormData(form).forEach((v,k)=>{ o[k]=v; }); $$('input[type=checkbox]',form).forEach(c=>{ o[c.name]=c.checked; });
  // los campos de montos y decimales se escriben a la chilena; aquí se devuelven como número en texto
  $$('input[data-clp][name]',form).forEach(i=>{ o[i.name]=i.value.trim()===''?'':String(leerMonto(i.value)); });
  $$('input[data-dec][name]',form).forEach(i=>{ o[i.name]=i.value.trim()===''?'':String(leerDec(i.value)); }); return o; }
// Números a la chilena. Montos: enteros con punto de miles ("1.250.000"). Decimales: coma ("12,5"), aunque
// también se acepta el punto ("12.5"). Los campos se marcan con data-clp o data-dec y se formatean solos.
const leerMonto=v=>{ const t=String(v??'').replace(/[^\d-]/g,''); return t===''||t==='-'?0:Number(t); };
const leerDec=v=>{ let t=String(v??'').replace(/[\s$%]/g,''); if(t.includes(',')) t=t.replace(/\./g,'').replace(',','.'); else if((t.match(/\./g)||[]).length>1) t=t.replace(/\./g,''); const n=Number(t); return isNaN(n)?0:n; };
const aMonto=n=>Math.round(Number(n)||0).toLocaleString('es-CL');
const aDec=n=>String(Number(n)||0).replace('.',',');
function formatearMonto(el){ const neg=el.dataset.clp==='neg'&&el.value.trim().startsWith('-'), dig=el.value.replace(/\D/g,''); const pos=el.selectionStart??el.value.length;
  const antes=el.value.slice(0,pos).replace(/\D/g,'').length; const nuevo=(neg?'-':'')+(dig?Number(dig).toLocaleString('es-CL'):'');
  if(nuevo===el.value) return; el.value=nuevo; if(document.activeElement!==el) return; let k=0, c=neg?1:0; while(c<nuevo.length&&k<antes){ if(/\d/.test(nuevo[c])) k++; c++; } try{ el.setSelectionRange(c,c); }catch(e){} }
document.addEventListener('input',e=>{ if(e.target.matches?.('input[data-clp]')) formatearMonto(e.target); });
new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType!==1) return; (n.matches('input[data-clp]')?[n]:[...n.querySelectorAll('input[data-clp]')]).forEach(i=>{ if(i.value&&/^-?\d+(\.\d{1,2})?$/.test(i.value)) i.value=(i.value.startsWith('-')?'-':'')+Math.round(Math.abs(Number(i.value))).toLocaleString('es-CL'); }); }))).observe(document.documentElement,{childList:true,subtree:true});
// Selector de período ('YYYY-MM') con los meses escritos en español, de `atras` meses antes a `adelante` después de hoy
function opcionesMes(sel,{min='',atras=24,adelante=12}={}){ const out=[]; const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-atras);
  for(let k=0;k<=atras+adelante;k++){ const p=d.getFullYear()+'-'+pad(d.getMonth()+1); if(!min||p>=min) out.push(p); d.setMonth(d.getMonth()+1); }
  if(sel&&!out.includes(sel)) out.push(sel); out.sort();
  return out.map(p=>{ const t=fmtMonth(p); return `<option value="${p}" ${p===sel?'selected':''}>${esc(t.charAt(0).toUpperCase()+t.slice(1))}</option>`; }).join(''); }
function busy(btn,on,txt){ if(!btn) return; btn.disabled=on; if(on){ btn.dataset.t=btn.textContent; btn.textContent=txt||'Guardando…'; } else if(btn.dataset.t){ btn.textContent=btn.dataset.t; } }

function descargar(blob, nombre){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
// Imprime (o guarda como PDF) solo el HTML indicado: ver reglas @media print en index.html
function imprimir(titulo, html){ $('#printArea')?.remove(); const d=document.createElement('div'); d.id='printArea'; d.innerHTML=html; document.body.appendChild(d); const prev=document.title; document.title=titulo; document.body.classList.add('printing');
  const fin=()=>{ document.body.classList.remove('printing'); document.title=prev; d.remove(); window.removeEventListener('afterprint',fin); }; window.addEventListener('afterprint',fin);
  const imgs=$$('img',d); Promise.all(imgs.map(i=>i.complete?null:new Promise(r=>{ i.onload=i.onerror=r; setTimeout(r,2500); }))).then(()=>window.print()); }

// ---------- Supabase ----------
const CFG = window.APP_CONFIG||{};
// Dos formas de instalar: servidor local (local/server.mjs, CFG.LOCAL) o un proyecto Supabase.
// En ambas la app usa la misma interfaz: en local la provee local/cliente.js.
if(!CFG.LOCAL && (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('TU-PROYECTO'))){ document.getElementById('app').innerHTML='<div class="auth"><div class="card"><h3>Falta configurar Supabase</h3><p>Edita <code>config.js</code> con la URL y la anon key de tu proyecto (Project Settings → API).</p></div></div>'; return; }
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
async function q(p){ const {data,error}=await p; if(error) throw error; return data; }
const T = t => sb.from(t);
// El bucket es privado: los archivos se abren con URLs firmadas que duran 1 hora y que Supabase
// solo entrega a quien puede leer el archivo. En las plantillas se escribe
//   <img data-f="ruta">  o  <a data-f="ruta">
// y firmarPendientes() completa src/href en cuanto el elemento aparece en la página.
const FIRMA_SEG=3600, URLS=new Map();
async function firmar(paths){
  const falta=[...new Set(paths)].filter(p=>p && !(URLS.get(p)?.hasta>Date.now()));
  if(falta.length){ const {data,error}=await sb.storage.from('fotos').createSignedUrls(falta, FIRMA_SEG); if(error) console.warn('firmar',error);
    (data||[]).forEach(d=>{ if(d.signedUrl) URLS.set(d.path, {url:d.signedUrl, hasta:Date.now()+(FIRMA_SEG-600)*1000}); }); }
  return paths.map(p=>URLS.get(p)?.url||'');
}
const urlFirmada = async path => path ? (await firmar([path]))[0] : '';
let firmaT=null;
async function firmarPendientes(){
  const els=$$('[data-f]:not([data-fok])'); if(!els.length) return; els.forEach(e=>e.setAttribute('data-fok','1'));
  const urls=await firmar(els.map(e=>e.dataset.f)).catch(()=>[]);
  els.forEach((e,i)=>{ const u=urls[i]; if(u) e.setAttribute(e.tagName==='A'?'href':'src', u); else if(e.tagName==='IMG') e.style.visibility='hidden'; });
}
new MutationObserver(()=>{ clearTimeout(firmaT); firmaT=setTimeout(firmarPendientes,0); }).observe(document.body,{childList:true,subtree:true});
// antes de que venzan, se vuelven a firmar las URLs de lo que sigue en pantalla
setInterval(()=>{ URLS.clear(); $$('[data-fok]').forEach(e=>e.removeAttribute('data-fok')); firmarPendientes(); }, (FIRMA_SEG-900)*1000);

// Suscripción: carga inicial + refetch al recibir cambios realtime en las tablas indicadas
let chanN=0;
function watch(tables, fetcher, cb, opts={}){
  let alive=true, timer=null;
  const load=async()=>{ try{ const d=await fetcher(); if(alive) cb(d); }catch(e){ console.warn('watch',e); if(alive&&!opts.silent) toast('No se pudo cargar: '+errMsg(e)); } };
  load();
  const ch=sb.channel('w'+(++chanN)+'_'+rnd());
  (Array.isArray(tables)?tables:[tables]).forEach(t=>{ const spec={event:'*',schema:'public',table:typeof t==='string'?t:t.table}; if(t.filter) spec.filter=t.filter; ch.on('postgres_changes',spec,()=>{ clearTimeout(timer); timer=setTimeout(load,250); }); });
  ch.subscribe();
  const un=()=>{ alive=false; clearTimeout(timer); sb.removeChannel(ch); };
  (opts.global?S.globalSubs:S.viewSubs).push(un);
  return {reload:load, un};
}

// Fotos: comprimir y subir al bucket "fotos", bajo la carpeta del edificio (lo exige la política de storage)
const dirEdif = ()=> (S.me?.edificio_id||'sin-edificio')+'/';
async function uploadImage(file, folder='img'){
  const blob = await new Promise((res,rej)=>{ const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ const max=1280; let w=img.width,h=img.height; if(w>max||h>max){ if(w>h){h=Math.round(h*max/w);w=max;} else {w=Math.round(w*max/h);h=max;} } const c=document.createElement('canvas'); c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); c.toBlob(b=>{URL.revokeObjectURL(url); b?res(b):rej(new Error('No se pudo procesar la imagen'));},'image/jpeg',0.82); };
    img.onerror=()=>rej(new Error('El archivo no es una imagen válida')); img.src=url; });
  const path=`${dirEdif()}${folder}/${todayStr()}/${rndSeguro()}.jpg`;
  await q(sb.storage.from('fotos').upload(path, blob, {contentType:'image/jpeg'}));
  return path;
}
async function uploadFile(file, folder='docs'){ const ext=(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,''); const path=`${dirEdif()}${folder}/${todayStr()}/${rndSeguro()}.${ext}`; await q(sb.storage.from('fotos').upload(path, file, {contentType:file.type||undefined})); return path; }
async function subirFotos(input, folder){ const ids=[]; for(const f of Array.from(input?.files||[])){ try{ ids.push(await uploadImage(f, folder)); }catch(e){ toast('Foto no subida: '+errMsg(e)); } } return ids; }
const fotoInput=(name='fotos')=>`<label class="f"><span>Fotos (puedes tomar varias)</span><input type="file" name="${name}" accept="image/*" capture="environment" multiple></label>`;
function viewImg(path){ modal(`<img data-f="${esc(path)}" style="width:100%;border-radius:10px"><div class="center" style="margin-top:10px"><button class="btn sec" data-close>Cerrar</button></div>`); }

// ---------- estado ----------
const S = { session:null, uid:null, cfg:null, me:null, users:{}, unidades:{}, empresas:{}, activos:{}, estac:{}, viewSubs:[], globalSubs:[], ready:false };
const ROLES = { residente:'Residente', propietario:'Propietario', conserje:'Conserjería', comite:'Comité', admin:'Administración', mantencion:'Empresa de mantención' };
const CANALES = { conserjeria:'Conserjería', comite:'Comité', administracion:'Administración' };
const canalRol = { conserjeria:'conserje', comite:'comite', administracion:'admin' };
const EST_INC = { abierta:['Abierta','er'], en_curso:['En curso','wa'], resuelta:['Resuelta','in'], cerrada:['Cerrada','ok'] };
const EST_RES = { pendiente:['Pendiente','wa'], aprobada:['Aprobada','ok'], rechazada:['Rechazada','er'], cancelada:['Cancelada','mu'] };
const EST_OT = { asignada:['Asignada','wa'], aceptada:['Aceptada','in'], agendada:['Agendada','in'], en_terreno:['En terreno','in'], cierre_tecnico:['Cierre técnico','wa'], aprobada:['Aprobada','ok'], rechazada:['Rechazada','er'] };
const PRIO = { baja:['Baja','mu'], media:['Media','in'], alta:['Alta','wa'], urgente:['Urgente','er'] };
const TIPOS={checkpoint:'Checkpoint',lectura:'Lectura',foto:'Foto',incidencia:'Observación'};

// Aviso de privacidad del edificio (texto propio en Administración → Edificio, o este por defecto)
const avisoPriv = e => (e?.privacidad||'').trim() || `${e?.nombre||'La comunidad'} usa esta aplicación para administrar el edificio. Se registran tu nombre, teléfono, correo y unidad, y lo que ingreses al usarla: reservas, incidencias, mensajes, visitas que anuncies, encomiendas, votos y el estado de pago de los gastos comunes de tu unidad. Esos datos los ven la administración, el comité y la conserjería según su función, y no se usan para otros fines ni se entregan a terceros. Puedes descargar tus datos o eliminar tu cuenta en "Mi cuenta", y pedir que se corrijan escribiendo a la administración${e?.email?' ('+e.email+')':''}.`;
async function descargarMisDatos(){
  const dep=myDepto(); const de=(t,k,v)=>q(T(t).select('*').eq(k,v)).catch(()=>[]);
  const [reservas,incidencias,mensajes,visitas,encomiendas,gastos_comunes,votos]=await Promise.all([de('reservas','uid',S.uid), de('incidencias','uid',S.uid), de('mensajes','uid',S.uid), de('visitas','uid',S.uid), dep?de('encomiendas','depto',dep):[], dep?de('gasto_unidades','depto',dep):[], dep?de('votos','depto',dep):[]]);
  descargar(new Blob([JSON.stringify({generado:now(), edificio:S.cfg?.nombre||'', correo:S.session?.user?.email||'', perfil:S.me, reservas, incidencias, mensajes, visitas, encomiendas, gastos_comunes, votos},null,2)],{type:'application/json'}), 'mis-datos.json');
}

function lsGet(k){ try{ return localStorage.getItem('edif_'+k); }catch(e){ return null; } }
function lsSet(k,v){ try{ v==null?localStorage.removeItem('edif_'+k):localStorage.setItem('edif_'+k,v); }catch(e){} }
function realRole(){ return S.me?.rol||null; }
function role(){ if(!S.me) return null; if(S.me.rol==='admin'){ const v=lsGet('verComo'); if(v && ROLES[v]) return v; } return S.me.rol; }
function isStaff(){ return ['conserje','comite','admin'].includes(role()); }
function isAdmin(){ return role()==='admin'; }
function myDepto(){ return S.me?.depto||''; }
function userName(id){ const u=S.users[id]; return u? u.nombre + (u.depto? ' · '+u.depto:'') : (id===S.uid? (S.me?.nombre||'Yo') : 'Usuario'); }
function pillOf(map,k){ const v=map[k]||[k,'mu']; return `<span class="pill ${v[1]}">${esc(v[0])}</span>`; }

const MODULES = [
  {id:'inicio', ic:'🏠', t:'Inicio', roles:Object.keys(ROLES)},
  {id:'gastos', ic:'💳', t:'Gastos comunes', d:'Consulta y desglose', roles:['residente','propietario','comite','admin']},
  {id:'finanzas', ic:'💰', t:'Finanzas', d:'Pagos, morosidad, convenios y caja', roles:['comite','admin']},
  {id:'reservas', ic:'📅', t:'Reservas', d:'Áreas comunes', roles:['residente','propietario','conserje','comite','admin']},
  {id:'incidencias', ic:'🛠️', t:'Incidencias', d:'Reportar problemas', roles:['residente','propietario','conserje','comite','admin']},
  {id:'mensajes', ic:'💬', t:'Mensajes', d:'Conserjería, comité, administración', roles:['residente','propietario','conserje','comite','admin']},
  {id:'comunicados', ic:'📣', t:'Comunicados', d:'Avisos de la comunidad', roles:['residente','propietario','conserje','comite','admin','mantencion']},
  {id:'encuestas', ic:'🗳️', t:'Encuestas', d:'Votaciones de la comunidad', roles:['residente','propietario','comite','admin']},
  {id:'encomiendas', ic:'📦', t:'Encomiendas', d:'Paquetes recibidos', roles:['residente','propietario','conserje','admin']},
  {id:'visitas', ic:'🚪', t:'Visitas', d:'Anunciar y registrar', roles:['residente','propietario','conserje','admin']},
  {id:'estacionamientos', ic:'🅿️', t:'Estacionamientos', d:'Visitas: ocupación y tiempos', roles:['conserje','comite','admin']},
  {id:'lecturas', ic:'🔢', t:'Lecturas', d:'Medidores de agua caliente, calefacción…', roles:['conserje','comite','admin']},
  {id:'multas', ic:'⚖️', t:'Multas', d:'Casos de infracción: cargos, descargos y resolución', roles:['residente','propietario','conserje','comite','admin']},
  {id:'documentos', ic:'📁', t:'Documentos', d:'Reglamento, actas, balances', roles:['residente','propietario','conserje','comite','admin']},
  {id:'rondas', ic:'📍', t:'Rondas', d:'Checkpoints NFC y bitácora', roles:['conserje','comite','admin']},
  {id:'mantencion', ic:'🔧', t:'Mantención', d:'Órdenes de trabajo y activos', roles:['comite','admin','mantencion']},
  {id:'admin', ic:'⚙️', t:'Administración', d:'Edificio, usuarios, espacios', roles:['admin']},
  {id:'perfil', ic:'👤', t:'Mi cuenta', d:'Datos y cerrar sesión', roles:Object.keys(ROLES)},
];
const BOTTOM = { residente:['inicio','gastos','reservas','incidencias','mensajes'], propietario:['inicio','gastos','reservas','incidencias','mensajes'], conserje:['inicio','rondas','incidencias','encomiendas','mensajes'], comite:['inicio','gastos','incidencias','mensajes','mantencion'], admin:['inicio','incidencias','mensajes','mantencion','admin'], mantencion:['inicio','mantencion','comunicados','perfil'] };

// ---------- notificaciones push ----------
// El navegador se suscribe con la clave pública VAPID y la suscripción se guarda en push_subs.
// Los avisos los envía la Edge Function "push", llamada por triggers de la base de datos.
const PUSH_KEY = CFG.VAPID_PUBLIC_KEY||'';
const pushOk = ()=> 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64u = s=>{ const r=atob((s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(r,c=>c.charCodeAt(0)); };
async function pushSub(){ if(!pushOk()) return null; const reg=await navigator.serviceWorker.getRegistration(); return reg? reg.pushManager.getSubscription() : null; }
async function pushGuardar(sub){ const j=sub.toJSON(); await q(sb.rpc('guardar_push',{p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_ua:navigator.userAgent})); }
async function pushActivar(){ if(await Notification.requestPermission()!=='granted') throw new Error('Debes permitir las notificaciones en el navegador.'); const reg=await navigator.serviceWorker.ready; await pushGuardar(await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64u(PUSH_KEY)})); }
async function pushDesactivar(){ const sub=await pushSub(); if(!sub) return; await T('push_subs').delete().eq('endpoint',sub.endpoint); await sub.unsubscribe(); }
// Si este navegador ya estaba suscrito, lo deja asociado a quien inició sesión
async function pushSync(){ try{ if(!PUSH_KEY || S.me?.estado!=='activo') return; const sub=await pushSub(); if(sub) await pushGuardar(sub); }catch(e){ console.warn('push',e); } }
async function pushCard(){
  if(!$('#pushBody')) return;
  if(!PUSH_KEY){ $('#pushBody').textContent='Esta instalación aún no tiene configuradas las notificaciones push.'; return; }
  if(!pushOk()){ $('#pushBody').textContent='Este navegador no admite notificaciones push. En iPhone y iPad, primero agrega la app a la pantalla de inicio (Compartir → Agregar a inicio).'; return; }
  let sub=null; try{ sub=await pushSub(); }catch(e){}
  const el=$('#pushBody'); if(!el) return;
  el.innerHTML=`<p style="margin:0 0 10px">Recibe un aviso en este dispositivo cuando llegue una encomienda, te escriban o haya algo por aprobar.</p>${Notification.permission==='denied'?'<div class="err">Las notificaciones están bloqueadas para este sitio. Permítelas en la configuración del navegador.</div>':''}<button class="btn ${sub?'sec':''}" id="bPush">${sub?'Desactivar en este dispositivo':'Activar notificaciones'}</button>`;
  $('#bPush').addEventListener('click', async e=>{ busy(e.target,true,'Un momento…'); try{ if(sub) await pushDesactivar(); else await pushActivar(); toast(sub?'Notificaciones desactivadas':'Notificaciones activadas'); }catch(err){ toast(errMsg(err)); } pushCard(); });
}

// ---------- arranque / auth ----------
function render(html){ applyColor(); $('#app').innerHTML=html; }
const applyColor=()=>{ const c=S.cfg?.color; if(c){ document.documentElement.style.setProperty('--p',c); document.documentElement.style.setProperty('--p2',c+'22'); } };

async function boot(){
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('sw',e)); navigator.serviceWorker.addEventListener('message',e=>{ if(e.data?.ir) location.hash=e.data.ir; }); }
  const {data:{session}} = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev,sess)=>{ const was=S.uid; S.session=sess; S.uid=sess?.user?.id||null; if(was!==S.uid){ teardown(); S.uid? start() : viewAuth(); } });
  S.session=session; S.uid=session?.user?.id||null;
  S.uid? start() : viewAuth();
}
async function salir(){ try{ await pushDesactivar(); }catch(e){} lsSet('verComo',null); return sb.auth.signOut(); }
function teardown(){ URLS.clear(); clearViewSubs(); S.globalSubs.forEach(u=>{try{u();}catch(e){}}); S.globalSubs=[]; S.ready=false; S.cfgLoaded=false; S.meLoaded=false; S.cfg=null; S.me=null; S.users={}; S.unidades={}; S.empresas={}; S.activos={}; S.estac={}; }
function clearViewSubs(){ S.viewSubs.forEach(u=>{ try{u();}catch(e){} }); S.viewSubs=[]; }

function viewAuth(mode='login', msg=''){
  render(`<div class="auth"><div class="center" style="margin-bottom:16px"><div class="logo-prev" style="margin:0 auto 10px">🏢</div><h1 style="margin:0">Mi Edificio</h1></div>
  <div class="card">${msg?`<div class="info">${esc(msg)}</div>`:''}<div id="authErr"></div>
  ${mode==='login'?`<h3>Iniciar sesión</h3><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required autocomplete="username"></label><label class="f"><span>Contraseña</span><input type="password" name="pass" required autocomplete="current-password"></label><button class="btn full">Entrar</button></form><div class="links"><a href="#" data-m="registro">Crear cuenta</a><a href="#" data-m="reset">Olvidé mi contraseña</a></div>`
  : mode==='registro'?`<h3>Crear cuenta</h3><p class="small muted">Luego de crear la cuenta completarás tus datos y la administración aprobará tu acceso.</p><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required autocomplete="username"></label><label class="f"><span>Contraseña (mín. 8)</span><input type="password" name="pass" required minlength="8" autocomplete="new-password"></label><button class="btn full">Crear cuenta</button></form><div class="links"><a href="#" data-m="login">Ya tengo cuenta</a></div>`
  : CFG.LOCAL?`<h3>Recuperar contraseña</h3><p>Pide a la administración del edificio que restablezca tu contraseña: lo hace desde Administración → Usuarios y te entrega una nueva, que podrás cambiar en Mi cuenta.</p><div class="links"><a href="#" data-m="login">Volver</a></div>`
  : `<h3>Recuperar contraseña</h3><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required></label><button class="btn full">Enviar enlace</button></form><div class="links"><a href="#" data-m="login">Volver</a></div>`}</div></div>`);
  $$('[data-m]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); viewAuth(a.dataset.m);}));
  $('#fAuth')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Un momento…'); $('#authErr').innerHTML=''; try{
    if(mode==='login'){ await q(sb.auth.signInWithPassword({email:d.email.trim(), password:d.pass})); }
    else if(mode==='registro'){ const r=await q(sb.auth.signUp({email:d.email.trim(), password:d.pass, options:{emailRedirectTo:location.origin+location.pathname}})); if(!r.session){ viewAuth('login','Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.'); return; } }
    else { await q(sb.auth.resetPasswordForEmail(d.email.trim(),{redirectTo:location.origin+location.pathname+'#perfil'})); viewAuth('login','Si el correo existe, recibirás un enlace para cambiar la contraseña.'); return; }
  }catch(err){ $('#authErr').innerHTML=`<div class="err">${esc(traducirAuth(errMsg(err)))}</div>`; busy(b,false); } });
}
function traducirAuth(m){ if(/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.'; if(/email not confirmed/i.test(m)) return 'Debes confirmar tu correo antes de entrar.'; if(/already registered/i.test(m)) return 'Ese correo ya tiene cuenta.'; if(/password/i.test(m)&&/short|least/i.test(m)) return 'La contraseña es muy corta.'; return m; }

async function start(){
  render(`<div class="loading"><div class="spin"></div>Cargando…</div>`);
  // catálogos globales (RLS limita lo que cada rol ve)
  S.cfgW=watch('edificios', ()=>q(T('edificios').select('*').maybeSingle()), d=>{ const k=cfgKey(); S.cfg=d; S.cfgLoaded=true; applyColor(); if(S.ready && cfgKey()!==k && !$('.modal')) routeNow(); else if(S.ready) updateBrand(); gate(); }, {global:true});
  S.usersW=watch({table:'usuarios'}, ()=>q(T('usuarios').select('*')), rows=>{ S.users={}; rows.forEach(u=>S.users[u.id]=u); const me=S.users[S.uid]||null; const k=meKey(); S.me=me; S.meLoaded=true; if((me?.edificio_id||null)!==(S.cfg?.id||null)) S.cfgW?.reload(); if(S.ready && meKey()!==k && !$('.modal')) routeNow(); else if(S.ready) refreshView(); gate(); }, {global:true, silent:true});
  S.unidadesW=watch('unidades', ()=>q(T('unidades').select('*')), rows=>{ S.unidades={}; rows.forEach(u=>S.unidades[u.depto]=u); refreshView(); }, {global:true, silent:true});
  watch('empresas', ()=>q(T('empresas').select('*')), rows=>{ S.empresas={}; rows.forEach(u=>S.empresas[u.id]=u); refreshView(); }, {global:true, silent:true});
  watch('activos', ()=>q(T('activos').select('*')), rows=>{ S.activos={}; rows.forEach(u=>S.activos[u.id]=u); refreshView(); }, {global:true, silent:true});
  watch('estacionamientos', ()=>q(T('estacionamientos').select('*')), rows=>{ S.estac={}; rows.forEach(u=>S.estac[u.id]=u); refreshView(); }, {global:true, silent:true});
}
function meKey(){ const m=S.me||{}; return [m.edificio_id,m.rol,m.estado,m.nombre,m.depto,m.empresa_id].join('|'); }
function cfgKey(){ const c=S.cfg||{}; return [c.id,c.nombre,c.direccion,c.logo,c.color,JSON.stringify(c.espacios||[]),JSON.stringify(c.medidores||[])].join('|'); }
function gate(){ if(S.ready) return; if(!S.cfgLoaded || !S.meLoaded) return; S.ready=true; routeNow(); pushSync(); limpiarArchivos(); }
// Borra del bucket los archivos de filas eliminadas por plazo de conservación (solo administración)
async function limpiarArchivos(){ try{ if(realRole()!=='admin' || S.me.estado!=='activo') return; const rows=await q(T('archivos_por_borrar').select('id,path').limit(500)); if(!rows.length) return; await sb.storage.from('fotos').remove(rows.map(r=>r.path)); await q(T('archivos_por_borrar').delete().in('id',rows.map(r=>r.id))); }catch(e){ console.warn('limpiarArchivos',e); } }

// ---------- router ----------
let currentView='inicio', currentParam=null; const REFRESH={};
window.addEventListener('hashchange', ()=>{ if(S.ready) routeNow(); });
function routeNow(){
  if(!S.ready) return;
  clearViewSubs();
  if(!S.me) return viewCrearPerfil();
  if(S.me.estado!=='activo') return render(shellLess(`<div class="card"><h3>${S.me.estado==='pendiente'?'Solicitud enviada':'Acceso bloqueado'}</h3><p>Hola ${esc(S.me.nombre)}. ${S.me.estado==='pendiente'?`Tu acceso para ${esc(S.me.depto||'el edificio')} está <b>pendiente de aprobación</b> por la administración.`:'Tu cuenta fue bloqueada por la administración.'}</p><button class="btn sec" id="out">Cerrar sesión</button></div>`), $('#out').addEventListener('click',()=>salir()));
  const h=(location.hash||'#inicio').replace('#',''); const [v,p]=h.split('--');
  const mod=MODULES.find(m=>m.id===v && m.roles.includes(role()));
  currentView = mod? v : 'inicio'; currentParam=p||null;
  renderShell();
  VIEWS[currentView](currentParam);
}
// Redibuja la vista actual cuando cambian los catálogos, pero nunca mientras alguien escribe en
// ella o hay una ventana abierta (se perdería lo que está a medio llenar): se reintenta después.
let editT=0, refreshT=null;
document.addEventListener('input',e=>{ if($('#main')?.contains(e.target)) editT=Date.now(); },true);
document.addEventListener('submit',()=>{ editT=0; },true);
document.addEventListener('change',e=>{ if(!e.target.closest?.('form')) editT=0; },true);   // campos que guardan al cambiar
function refreshView(){
  if(!S.ready || typeof REFRESH[currentView]!=='function') return;
  const ae=document.activeElement; const escribiendo=($('#main')?.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) || Date.now()-editT<15000;
  clearTimeout(refreshT);
  if($('.modal') || escribiendo){ refreshT=setTimeout(refreshView,2000); return; }
  REFRESH[currentView]();
}
function shellLess(inner){ return `<div style="max-width:560px;margin:40px auto;padding:14px"><div class="center" style="margin-bottom:16px"><div class="logo-prev" style="margin:0 auto 10px">${S.cfg?.logo?`<img data-f="${esc(S.cfg.logo)}">`:'🏢'}</div><h1 style="margin:0">${esc(S.cfg?.nombre||'Mi Edificio')}</h1></div>${inner}</div>`; }
function logoHtml(){ return S.cfg?.logo? `<img data-f="${esc(S.cfg.logo)}" alt="">` : esc((S.cfg?.nombre||'E').trim()[0]||'E').toUpperCase(); }
function updateBrand(){ $$('.brand b, header.top .t b').forEach(b=>b.textContent=S.cfg?.nombre||''); $$('.brand small').forEach(s=>s.textContent=S.cfg?.direccion||''); $$('.brand .logo, header.top .logo').forEach(l=>l.innerHTML=logoHtml()); }
function renderShell(){
  const r=role(); const mods=MODULES.filter(m=>m.roles.includes(r));
  const side = mods.map(m=>`<a href="#${m.id}" class="${currentView===m.id?'on':''}"><span class="ic">${m.ic}</span>${m.t}</a>`).join('');
  const bot = (BOTTOM[r]||['inicio']).map(id=>{const m=MODULES.find(x=>x.id===id); return m?`<a href="#${m.id}" class="${currentView===m.id?'on':''}"><span class="ic">${m.ic}</span>${m.t.split(' ')[0]}</a>`:'';}).join('');
  const sel=id=>`<select id="${id}" style="width:auto;padding:6px 8px;font-size:12px">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${role()===k?'selected':''}>${v}</option>`).join('')}</select>`;
  render(`
  <nav class="side"><div class="brand"><div class="logo">${logoHtml()}</div><div><b>${esc(S.cfg?.nombre||'')}</b><small>${esc(S.cfg?.direccion||'')}</small></div></div>${side}<div class="sp"></div>${realRole()==='admin'?`<div style="padding:10px"><label class="f"><span>Ver como (vista de prueba)</span>${sel('verComo')}</label></div>`:''}<div style="padding:10px;font-size:12px;color:var(--mu)">${esc(S.me.nombre)}${S.me.depto?' · '+esc(S.me.depto):''}<br><span class="pill mu">${ROLES[r]}</span></div></nav>
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
    <header class="top"><div class="logo">${logoHtml()}</div><div class="t"><b>${esc(S.cfg?.nombre||'')}</b><small>${esc(S.me.nombre)} · ${ROLES[r]}</small></div>${realRole()==='admin'?sel('verComoTop'):''}</header>
    <main id="main"></main>
    <nav class="bottom">${bot}</nav>
  </div>`);
  const onVer = e=>{ lsSet('verComo', e.target.value===S.me.rol?null:e.target.value); location.hash='#inicio'; routeNow(); };
  $('#verComo')?.addEventListener('change',onVer); $('#verComoTop')?.addEventListener('change',onVer);
}
function setMain(html){ $('#main').innerHTML=html; }

// Cuenta sin perfil: si la instalación ya tiene edificio, pedir acceso; si no, crearlo y
// quedar como su administrador.
async function viewCrearPerfil(){
  render(shellLess(`<div class="loading"><div class="spin"></div>Un momento…</div>`));
  let edif=null, aviso='';
  try{ edif=(await q(sb.rpc('buscar_edificio')))[0]||null; }catch(e){ aviso='No se pudo consultar el edificio: '+errMsg(e); }
  if(S.me) return;
  const err=m=>{ $('#pErr').innerHTML=m?`<div class="err">${esc(m)}</div>`:''; };
  const listo=()=>S.usersW?.reload();
  const pie=`<div class="links" style="margin-top:10px"><a href="#" id="out">Cerrar sesión</a></div>`;
  render(shellLess(edif?`<div class="card"><h3>Únete a ${esc(edif.nombre)}</h3><p class="small muted">La administración del edificio aprobará tu acceso.</p><div id="pErr"></div>
    <form id="fAcc"><label class="f"><span>Nombre completo</span><input type="text" name="nombre" required></label>
    <label class="f"><span>Departamento / unidad</span><input type="text" name="depto" placeholder="Ej: 1204 (vacío si eres conserje o empresa)"></label>
    <label class="f"><span>Teléfono</span><input type="tel" name="telefono"></label>
    <label class="f"><span>Soy</span><select name="rol"><option value="residente">Residente (arrendatario)</option><option value="propietario">Propietario</option><option value="conserje">Conserje</option><option value="mantencion">Empresa de mantención</option></select></label>
    <details style="margin-bottom:10px"><summary>Aviso de privacidad</summary><p class="small" style="white-space:pre-wrap">${esc(avisoPriv(edif))}</p></details>
    <label class="sw" style="margin-bottom:12px"><input type="checkbox" name="acepto" required> Leí el aviso de privacidad</label>
    <button class="btn full">Enviar solicitud</button></form>${pie}</div>`
  :`<div class="card"><h3>Configura tu edificio</h3><p class="small muted">Eres la primera persona en entrar: crea el edificio y quedarás como su administrador. Después podrás invitar a tu comunidad.</p><div id="pErr"></div>
    <form id="fNew"><label class="f"><span>Nombre del edificio o condominio</span><input type="text" name="edificio" required></label><label class="f"><span>Tu nombre completo</span><input type="text" name="nombre" required></label><label class="f"><span>Teléfono</span><input type="tel" name="telefono"></label><button class="btn full">Crear edificio</button></form>${pie}</div>`));
  err(aviso);
  $('#out').addEventListener('click',e=>{e.preventDefault(); salir();});
  $('#fAcc')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ await q(T('usuarios').insert({id:S.uid, edificio_id:edif.id, nombre:d.nombre.trim(), depto:d.depto.trim(), telefono:d.telefono.trim(), rol:d.rol})); listo(); }catch(ex){ err(errMsg(ex)); busy(b,false); } });
  $('#fNew')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Creando…'); try{ await q(sb.rpc('crear_edificio',{p_edificio:d.edificio.trim(), p_nombre:d.nombre.trim(), p_telefono:d.telefono.trim()})); listo(); }catch(ex){ err(errMsg(ex)); busy(b,false); } });
}

// ---------- VISTAS ----------
const VIEWS = {};

VIEWS.perfil = function(){
  setMain(`<h1>Mi cuenta</h1><div class="card"><form id="fP"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(S.me.nombre)}" required></label><label class="f"><span>Teléfono</span><input type="tel" name="telefono" value="${esc(S.me.telefono||'')}"></label><div class="small muted" style="margin-bottom:10px">Depto: <b>${esc(S.me.depto||'—')}</b> · Rol: <b>${ROLES[S.me.rol]}</b> · ${esc(S.session?.user?.email||'')}<br>Para cambiar depto o rol, contacta a la administración.</div><button class="btn">Guardar</button></form></div>
  <div class="card"><h3>Contraseña</h3><form id="fPw"><label class="f"><span>Nueva contraseña</span><input type="password" name="pw" minlength="8" required autocomplete="new-password"></label><button class="btn sec">Cambiar contraseña</button></form></div>
  <div class="card"><h3>Tus datos personales</h3><details><summary>Aviso de privacidad</summary><p class="small" style="white-space:pre-wrap">${esc(avisoPriv(S.cfg))}</p></details>
  <div class="row wrap" style="margin-top:10px"><button class="btn sec" id="bDatos">Descargar mis datos</button><button class="btn sec" id="bBaja">Eliminar mi cuenta</button></div></div>
  <div class="card"><h3>Notificaciones</h3><div id="pushBody" class="small muted">Comprobando…</div></div>
  <button class="btn dan" id="out">Cerrar sesión</button>`);
  pushCard();
  $('#bDatos').addEventListener('click', async e=>{ busy(e.target,true,'Preparando…'); try{ await descargarMisDatos(); }catch(err){ toast(errMsg(err)); } busy(e.target,false); });
  $('#bBaja').addEventListener('click', async()=>{ if(!await confirmBox('Se borrarán tu nombre, teléfono y unidad, y perderás el acceso. Lo que hayas escrito (mensajes, incidencias) quedará sin tu nombre. Esta acción no se puede deshacer. ¿Eliminar tu cuenta?')) return; try{ await q(sb.rpc('eliminar_mi_cuenta')); toast('Cuenta eliminada'); await salir(); }catch(err){ toast(errMsg(err)); } });
  $('#fP').addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('usuarios').update({nombre:d.nombre.trim(), telefono:d.telefono.trim()}).eq('id',S.uid)); toast('Guardado'); }catch(err){ toast(errMsg(err)); } });
  $('#fPw').addEventListener('submit', async e=>{ e.preventDefault(); try{ await q(sb.auth.updateUser({password:$('[name=pw]',e.target).value})); toast('Contraseña actualizada'); e.target.reset(); }catch(err){ toast(errMsg(err)); } });
  $('#out').addEventListener('click',()=>salir());
};

// INICIO
// Lo primero que ve cada rol al entrar: residentes, su gasto común y lo que tienen pendiente;
// el personal, lo que requiere su atención (con enlace directo). Cada consulta falla por separado sin romper el resto.
function inicioEstado(r){
  const fila=(n,t,href,tono='er',det='')=>`<a class="item atn" href="${href}"><span class="pill ${tono}">${n}</span><span class="grow"><b>${esc(t)}</b>${det?`<br><span class="small muted">${esc(det)}</span>`:''}</span><span class="muted" aria-hidden="true">›</span></a>`;
  const nada='<div class="item static atn"><span class="pill ok">✓</span><span class="grow">No hay nada pendiente.</span></div>';
  const cuenta=x=>x.then(a=>a.length).catch(()=>0);
  const hoy=todayStr(), dep=myDepto(), mds=medidores(), nU=()=>Object.keys(S.unidades).length;
  const lecturasFaltan=async per=>{ if(!mds.length) return []; const l=await q(T('lecturas').select('medidor,depto').eq('periodo',per)).catch(()=>[]); return mds.map(md=>({md, n:l.filter(x=>x.medidor===md.id&&S.unidades[x.depto]).length})).filter(x=>x.n<nU()); };
  if(['residente','propietario'].includes(r)){
    if(!dep) return;
    watch(['gastos','gasto_unidades','pagos','convenios','encomiendas','conversaciones','encuestas','votos','reservas','infracciones'], async()=>{
      const [D,enc,msj,encs,votos,res,infs]=await Promise.all([finDatos(dep).catch(()=>null), cuenta(q(T('encomiendas').select('id').eq('depto',dep).eq('entregado',false))), cuenta(q(T('conversaciones').select('id').eq('depto',dep).eq('no_leido_residente',true))),
        q(T('encuestas').select('id,cierra,solo_propietarios').eq('estado','abierta')).catch(()=>[]), q(T('votos').select('encuesta_id').eq('depto',dep)).catch(()=>[]),
        q(T('reservas').select('*').eq('depto',dep).gte('fecha',hoy).order('fecha',{ascending:true})).catch(()=>[]), q(T('infracciones').select('id,estado,descargos_hasta,descargos_at')).catch(()=>[])]);
      return {D,enc,msj,encs,votos,res,infs}; },
    ({D,enc,msj,encs,votos,res,infs})=>{ const el=$('#homeEstado'); if(!el) return;
      const z=D?.U[dep], pubs=(D?.gastos||[]).filter(g=>g.publicado).sort((a,b)=>a.periodo<b.periodo?1:-1), g=pubs[0], mio=g&&z?.rows.find(x=>x.periodo===g.periodo);
      const ya=new Set(votos.map(v=>v.encuesta_id)), porVotar=encs.filter(x=>(!x.cierra||x.cierra>=hoy)&&!ya.has(x.id)&&(!x.solo_propietarios||r==='propietario')).length;
      const conv=(z?.convs||[]).filter(c=>c.estado==='propuesto').length, cargosInf=(infs||[]).filter(c=>c.estado==='cargos'&&c.descargos_hasta>=hoy&&!c.descargos_at), prox=res.filter(x=>['pendiente','aprobada'].includes(x.estado))[0];
      const total=(z?.deuda||0)+(z?.interes||0), otros=mio?total-(mio.saldo||0):total;
      const cobro=g&&mio?`<div class="card resumen"><div class="row" style="align-items:flex-start"><div class="grow"><div class="small muted">Gasto común de ${esc(fmtMonth(g.periodo))} · Depto ${esc(dep)}</div>
          <div class="monto">${clp(mio.monto)}</div><div class="small">${mio.pagado?'Pagado. ¡Gracias!':g.vence?(g.vence<hoy?`<b style="color:var(--er)">Venció el ${esc(fmtDay(g.vence))}</b>`:`Vence el ${esc(fmtDay(g.vence))}`):''}${!mio.pagado&&Number(mio.pagado_monto)>0?` · abonado ${clp(mio.pagado_monto)}`:''}</div></div>
          ${estadoCobro(mio)}</div>
          ${otros>0?`<div class="note" style="margin:10px 0 0">Además tienes ${clp(otros)} pendientes de meses anteriores${z?.interes?' e intereses por mora':''}. Total por pagar: <b>${clp(total)}</b>.</div>`:''}
          <div class="row wrap" style="margin-top:12px;gap:8px"><a class="btn" href="#gastos">Ver desglose</a>${S.cfg?.datos_bancarios&&!mio.pagado?'<a class="btn sec" href="#gastos">Datos para transferir</a>':''}</div></div>`
        :`<div class="card resumen"><div class="small muted">Gastos comunes · Depto ${esc(dep)}</div><div style="margin-top:6px">${total>0?`Tienes ${clp(total)} por pagar. <a href="#gastos">Ver detalle</a>`:'Aún no hay un período de gastos comunes publicado.'}</div></div>`;
      const items=[cargosInf.length?fila(cargosInf.length,cargosInf.length===1?'Notificación de cargos':'Notificaciones de cargos','#multas','er','Puedes presentar descargos hasta el '+fmtDay(cargosInf[0].descargos_hasta)):'', conv?fila(conv,'Convenio de pago por revisar','#gastos','wa','La administración te propuso un convenio'):'', enc?fila(enc,enc===1?'Encomienda por retirar':'Encomiendas por retirar','#encomiendas','in','En conserjería'):'',
        msj?fila(msj,msj===1?'Mensaje sin leer':'Mensajes sin leer','#mensajes','in'):'', porVotar?fila(porVotar,porVotar===1?'Votación abierta':'Votaciones abiertas','#encuestas','wa','Tu unidad aún no vota'):'',
        prox?fila('📅',`Reserva: ${prox.espacio_nombre}`,'#reservas','mu',`${fmtDay(prox.fecha)} de ${pad(prox.h_ini)}:00 a ${pad(prox.h_fin)}:00${prox.estado==='pendiente'?' · por aprobar':''}`):''].filter(Boolean);
      el.innerHTML=cobro+`<h2>Pendiente</h2><div class="list">${items.join('')||nada}</div>`; }, {silent:true});
    return;
  }
  const canal=Object.keys(canalRol).find(c=>canalRol[c]===r);
  const tablas=['usuarios','reservas','incidencias','conversaciones','estacionamiento_usos','gastos','gasto_unidades','pagos','convenios','lecturas','encomiendas','visitas','ot','infracciones','infraccion_votos'];
  watch(tablas, async()=>{ const L=[], add=(n,...a)=>{ if(typeof n==='string'||n>0) L.push(fila(n,...a)); };
    if(r==='mantencion'){ if(S.me.empresa_id) add(await cuenta(q(T('ot').select('id').eq('empresa_id',S.me.empresa_id).eq('estado','asignada'))),'Órdenes de trabajo asignadas','#mantencion','wa'); return L; }
    const [usu,resv,inc,msj,est,borr,enc,vis]=await Promise.all([
      r==='admin'?cuenta(q(T('usuarios').select('id').eq('estado','pendiente'))):0,
      r!=='conserje'?cuenta(q(T('reservas').select('id').eq('estado','pendiente'))):0,
      cuenta(q(T('incidencias').select('id').eq('estado','abierta'))),
      canal?cuenta(q(T('conversaciones').select('id').eq('canal',canal).eq('no_leido_staff',true))):0,
      q(T('estacionamiento_usos').select('id,alerta_residente_at,aviso_admin_at').is('fin',null)).catch(()=>[]),
      r==='admin'?q(T('gastos').select('periodo,publicado')).catch(()=>[]):[],
      r==='conserje'?cuenta(q(T('encomiendas').select('id').eq('entregado',false))):0,
      r==='conserje'?cuenta(q(T('visitas').select('id').eq('fecha',hoy).eq('estado','anunciada'))):0]);
    add(usu,'Solicitudes de acceso','#admin--usuarios','er','Personas esperando que apruebes su cuenta');
    add(resv,'Reservas por aprobar','#reservas','wa');
    add(msj,'Mensajes sin leer','#mensajes','in');
    add(enc,'Encomiendas por entregar','#encomiendas','in');
    add(vis,'Visitas anunciadas para hoy','#visitas','in');
    const excAdm=est.filter(u=>u.aviso_admin_at).length, excRes=est.filter(u=>u.alerta_residente_at&&!u.aviso_admin_at).length;
    add(excAdm,'Estacionamientos de visita excedidos','#estacionamientos','er','Superaron el tiempo máximo');
    if(r==='conserje') add(excRes,'Visitas cerca del tiempo máximo','#estacionamientos','wa','Ya se avisó al residente');
    add(inc,'Incidencias abiertas','#incidencias','wa');
    if(['admin','comite'].includes(r)){ const cs=await q(T('infracciones').select('id,estado,decidir_antes,descargos_hasta,descargos_at,ronda')).catch(()=>[]), vs=r==='comite'?await q(T('infraccion_votos').select('infraccion_id,ronda,uid')).catch(()=>[]):[];
      if(r==='admin'){ add(cs.filter(c=>c.estado==='abierto').length,'Casos de multa por decidir','#multas','wa','Formular cargos o archivar');
        add(cs.filter(c=>c.estado==='cargos'&&(c.descargos_at||c.descargos_hasta<hoy)).length,'Casos de multa listos para resolver','#multas','wa','Llegaron los descargos o venció el plazo'); }
      else add(cs.filter(c=>c.estado==='en_comite'&&!vs.some(v=>v.infraccion_id===c.id&&v.ronda===c.ronda&&v.uid===S.uid)).length,'Multas por aprobar','#multas','er','El comité debe aprobarlas antes de cobrarlas'); }
    if(['admin','comite'].includes(r)){ const D=await finDatos().catch(()=>null); if(D){ const mor=Object.values(D.U).filter(z=>z.vencido>0); add(mor.length, mor.length===1?'Unidad con deuda vencida':'Unidades con deuda vencida','#finanzas','er',clp(mor.reduce((a,z)=>a+z.vencido,0))+' vencido'); } }
    if(r==='admin'){ const b=borr.filter(g=>!g.publicado).map(g=>g.periodo).sort(); add(b.length, b.length===1?'Período de gastos comunes en borrador':'Períodos de gastos comunes en borrador','#gastos','wa',b.map(fmtMonth).join(', ')); }
    if(['admin','conserje'].includes(r)){ const pub=new Set(borr.filter(g=>g.publicado).map(g=>g.periodo)); let per=monthStr(); if(r==='admin'){ const b=borr.filter(g=>!g.publicado).map(g=>g.periodo).sort(); if(b.length) per=b[0]; }
      if(!pub.has(per)) (await lecturasFaltan(per)).forEach(x=>add(`${x.n}/${nU()}`,`Lecturas de ${x.md.nombre.toLowerCase()}`,'#lecturas','wa',`${fmtMonth(per)}: faltan ${nU()-x.n} ${nU()-x.n===1?'unidad':'unidades'}`)); }
    return L; },
  L=>{ const el=$('#homeEstado'); if(!el) return; el.innerHTML=`<h2>Requiere tu atención</h2><div class="list">${L.join('')||nada}</div>`; }, {silent:true});
}
VIEWS.inicio = function(){
  const r=role(); const mods=MODULES.filter(m=>m.roles.includes(r) && !['inicio','perfil'].includes(m.id));
  const setupPend = realRole()==='admin' && S.cfg && !S.cfg.configurado_at;
  setMain(`<h1>Hola, ${esc(S.me.nombre.split(' ')[0])}</h1>
  ${setupPend?`<div class="note">Falta terminar la configuración inicial del edificio. <a href="#" id="bWizHome">Continuar con el asistente</a></div>`:''}
  ${PUSH_KEY&&pushOk()&&Notification.permission==='default'?`<div class="info">🔔 <a href="#perfil">Activa las notificaciones</a> para enterarte de encomiendas, mensajes y aprobaciones.</div>`:''}
  <div id="homeVer"></div><div id="homeTun"></div><div id="homeResp"></div>
  <div id="homeEstado"></div>
  <h2>Accesos</h2><div class="grid accesos">${mods.map(m=>`<a class="tile" href="#${m.id}" data-tile="${m.id}"><span class="ic">${m.ic}</span><b>${m.t}</b></a>`).join('')}</div>
  <h2>Últimos comunicados</h2><div id="homeCom" class="list"><div class="empty">Cargando…</div></div>`);
  $('#bWizHome')?.addEventListener('click',e=>{ e.preventDefault(); asistente(); });
  if(CFG.LOCAL && realRole()==='admin') sb.local.sistema.estado().then(({data:e})=>{ const el=$('#homeVer'); if(el&&e&&e.hayNueva) el.innerHTML=`<div class="info">Hay una versión nueva de Mi Edificio (${esc(e.ultima.version)}). <a href="#admin">Ver y actualizar</a>.</div>`; });
  if(CFG.LOCAL && realRole()==='admin') sb.local.tunel.estado().then(({data:e})=>{ const el=$('#homeTun'); if(!el||!e) return; S.dirPublica=e.estado==='conectado'&&e.direccion?e.direccion+'/':'';
    el.innerHTML=e.modo==='apagado'?'<div class="note">La app solo se puede usar dentro del edificio. <a href="#admin">Activa el acceso desde internet</a>.</div>':e.estado==='error'||e.estado==='sin-programa'?'<div class="err">El acceso desde internet no está funcionando. <a href="#admin">Revisar</a>.</div>':''; });
  if(CFG.LOCAL && realRole()==='admin') sb.local.respaldo.estado().then(({data:e})=>{ const el=$('#homeResp'); if(!el||!e) return; const viejo=e.ultimo&&Date.now()-new Date(e.ultimo.fecha)>3*86400000;
    el.innerHTML=!e.configurado?'<div class="note">Los respaldos solo quedan en este computador. <a href="#admin">Configura el respaldo en la nube</a>.</div>':e.ultimo&&!e.ultimo.ok?'<div class="err">El último respaldo en la nube falló. <a href="#admin">Revisar</a>.</div>':viejo?'<div class="note">No hay un respaldo en la nube desde hace más de 3 días. <a href="#admin">Revisar</a>.</div>':''; });
  if(setupPend && !S._wiz){ S._wiz=true; asistente(); }   // una vez por sesión
  inicioEstado(r);
  watch('comunicados', ()=>q(T('comunicados').select('*').order('ts',{ascending:false}).limit(3)), rows=>{ const el=$('#homeCom'); if(!el) return; el.innerHTML = rows.length? rows.map(c=>`<div class="item static"><div class="hd"><b>${esc(c.titulo)}</b><span class="muted small">${fmtDate(c.ts)}</span></div><div class="small" style="margin-top:4px">${esc(c.cuerpo).slice(0,160)}${c.cuerpo.length>160?'…':''}</div></div>`).join('') : '<div class="empty">Sin comunicados aún</div>'; });
  const badge=(id,n)=>{ const t=$(`[data-tile="${id}"]`); if(!t) return; let b=$('.badge',t); if(n>0){ if(!b){b=document.createElement('span');b.className='badge';t.appendChild(b);} b.textContent=n; } else b?.remove(); };
  const count=(table,build,id)=>watch(table, ()=>build().then(r=>r.length), n=>badge(id,n), {silent:true});
  if(['residente','propietario'].includes(r)){
    count('encomiendas', ()=>q(T('encomiendas').select('id').eq('depto',myDepto()).eq('entregado',false)), 'encomiendas');
    count('conversaciones', ()=>q(T('conversaciones').select('id').eq('depto',myDepto()).eq('no_leido_residente',true)), 'mensajes');
    count('convenios', ()=>q(T('convenios').select('id').eq('depto',myDepto()).eq('estado','propuesto')), 'gastos');
    count(['encuestas','votos'], async()=>{ const [e,v]=await Promise.all([q(T('encuestas').select('id,cierra,solo_propietarios').eq('estado','abierta')), q(T('votos').select('encuesta_id').eq('depto',myDepto()))]); const ya=new Set(v.map(x=>x.encuesta_id)); return e.filter(x=>(!x.cierra||x.cierra>=todayStr())&&!ya.has(x.id)&&(!x.solo_propietarios||r==='propietario')); }, 'encuestas');
  } else if(isStaff()){
    const canal = Object.keys(canalRol).find(c=>canalRol[c]===r);
    if(canal) count('conversaciones', ()=>q(T('conversaciones').select('id').eq('canal',canal).eq('no_leido_staff',true)), 'mensajes');
    count('incidencias', ()=>q(T('incidencias').select('id').eq('estado','abierta')), 'incidencias');
    if(r!=='conserje') count('reservas', ()=>q(T('reservas').select('id').eq('estado','pendiente')), 'reservas');
    count('estacionamiento_usos', ()=>q(T('estacionamiento_usos').select('id,aviso_admin_at').is('fin',null)).then(x=>x.filter(u=>u.aviso_admin_at)), 'estacionamientos');
    if(r==='admin') count('usuarios', ()=>q(T('usuarios').select('id').eq('estado','pendiente')), 'admin');
  } else if(r==='mantencion' && S.me.empresa_id){
    count('ot', ()=>q(T('ot').select('id').eq('empresa_id',S.me.empresa_id).eq('estado','asignada')), 'mantencion');
  }
};

// GASTOS COMUNES
// GASTOS COMUNES. Cada ítem dice cómo se reparte (items[].prorrateo, ver recalcular_prorrateo en schema.sql)
// y puede ir a un fondo (items[].fondo). El cobro de cada unidad y su desglose los calcula la base de datos
// (gasto_unidades.monto y .detalle), incluidos los cargos individuales (multas, arriendos, otros).
const medidores=()=>S.cfg?.medidores||[];
const MEDIDORES_EJ=[{id:'acs',nombre:'Agua caliente',unidad:'m³'},{id:'agua',nombre:'Agua fría',unidad:'m³'},{id:'cal',nombre:'Calefacción',unidad:'kWh'},{id:'gas',nombre:'Gas',unidad:'m³'}];
const TIPO_CARGO={multa:'Multa', arriendo:'Arriendo de espacio común', otro:'Otro cargo'};
const numCL=(n,d=1)=>Number(n||0).toLocaleString('es-CL',{maximumFractionDigits:d});
const porNum=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
const txtReparto=it=>{ const p=it.prorrateo||'alicuota';
  if(p==='iguales') return 'partes iguales';
  if(p==='unidades') return 'solo '+((it.deptos||[]).length===1?'unidad ':'unidades ')+(it.deptos||[]).join(', ');
  if(p==='consumo'){ const md=medidores().find(x=>x.id===it.medidor); return 'según consumo de '+(md?md.nombre.toLowerCase():'?')+(Number(it.fijo)>0?` (${numCL(it.fijo)} % fijo por alícuota)`:''); }
  return 'por alícuota'; };
// Líneas del cobro de una unidad: ítems del período (con su parte y consumo) y cargos individuales
function desgloseUnidad(g, gu){
  const items=g.items||[], det=Array.isArray(gu?.detalle)?gu.detalle:[], md=it=>medidores().find(x=>x.id===it.medidor);
  const conDet=det.some(d=>d.i!=null);
  const lineas=items.map((it,i)=>{ const d=det.find(x=>x.i===i); return {t:it.categoria, d:it.descripcion||'', total:Number(it.monto)||0, parte:conDet?(d?Number(d.monto):0):Math.round((Number(it.monto)||0)*Number(gu?.alicuota||0)/100), consumo:d&&d.consumo!=null?Number(d.consumo):null, unidad:md(it)?.unidad||'', reparto:txtReparto(it)}; }).filter(l=>!conDet||l.parte>0||l.consumo!=null);
  det.filter(d=>d.c).forEach(d=>lineas.push({t:TIPO_CARGO[d.tipo]||'Cargo', d:d.descripcion||'', total:null, parte:Number(d.monto), cargo:true}));
  return lineas; }
VIEWS.gastos = function(){
  const staff = ['comite','admin'].includes(role());
  setMain(`<h1>Gastos comunes</h1>${isAdmin()?`<div class="row" style="margin-bottom:12px"><button class="btn" id="bNuevoG">+ Nuevo período</button></div>`:''}<div id="gList"></div><div id="gCuenta"></div><div id="gFondos"></div>`);
  if(!staff && myDepto()) cuentaResidente();
  $('#bNuevoG')?.addEventListener('click',()=>formGasto());
  let aviso=null; $('#gList').addEventListener('click',e=>{ const x=e.target.closest('[data-x]'); if(x&&aviso?.mio) exportGasto(x.dataset.x, aviso.g, null, aviso.mio); });
  if(!staff) watch(['fondos','fondo_movimientos'], async()=>{ const [f,sd]=await Promise.all([q(T('fondos').select('*').eq('activo',true)), q(sb.rpc('saldos_fondos')).catch(()=>[])]); return {f,sd}; }, ({f,sd})=>{ const el=$('#gFondos'); if(!el) return;
    el.innerHTML=f.length?`<h2>Fondos del edificio</h2><div class="kpi">${f.map(x=>`<div class="k"><b>${clp(sd.find(y=>y.fondo_id===x.id)?.saldo||0)}</b><span>${esc(x.nombre)}</span></div>`).join('')}</div>`:''; }, {silent:true});
  watch(['gastos','gasto_unidades'], async()=>{ const g=await q(T('gastos').select('*').order('periodo',{ascending:false}).limit(24)); const gu=await q(T('gasto_unidades').select('*')); return {g,gu}; }, ({g,gu})=>{
    const el=$('#gList'); if(!el) return;
    const pr={}; gu.forEach(x=>{ (pr[x.periodo]=pr[x.periodo]||{})[x.depto]=x; });
    if(!g.length){ el.innerHTML='<div class="empty">Aún no hay períodos publicados.</div>'; return; }
    if(staff){
      el.innerHTML = g.map(x=>{ const p=Object.values(pr[x.periodo]||{}); return `<div class="item" data-g="${x.periodo}"><div class="hd"><b>${esc(fmtMonth(x.periodo))}</b><span class="pill ${x.publicado?'ok':'wa'}">${x.publicado?'Publicado':'Borrador'}</span></div><div class="meta">Total ${clp(x.total)} · ${(x.items||[]).length} ítems · ${p.filter(u=>u.pagado).length}/${p.length} unidades pagadas</div></div>`; }).join('');
      $$('#gList [data-g]').forEach(it=>it.addEventListener('click',()=>detalleGastoAdmin(g.find(x=>x.periodo===it.dataset.g), pr[it.dataset.g]||{})));
    } else {
      const dep=myDepto(); const vis=g.filter(x=>x.publicado); if(!vis.length){ el.innerHTML='<div class="empty">Aún no hay períodos publicados.</div>'; return; }
      const cur=vis[0]; const mio=pr[cur.periodo]?.[dep]; aviso={g:cur, mio}; const ls=mio?desgloseUnidad(cur,mio):[];
      el.innerHTML = `<div class="card"><div class="row"><div class="grow"><span class="muted small">${esc(fmtMonth(cur.periodo))} · Depto ${esc(dep)}</span><div style="font-size:28px;font-weight:700">${mio?clp(mio.monto):'—'}</div></div>${mio?`<span class="pill ${mio.pagado?'ok':'wa'}">${mio.pagado?'Pagado':'Pendiente'}</span>`:''}</div>
      ${mio?`<div class="small muted" style="margin:6px 0 10px">Alícuota ${Number(mio.alicuota)}% · Vence ${cur.vence?fmtDay(cur.vence):'—'}</div>`:'<div class="small muted">Tu unidad no está en el prorrateo de este período. Consulta a administración.</div>'}
      ${S.cfg?.datos_bancarios?`<details><summary>Datos para transferir</summary><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(S.cfg.datos_bancarios)}</pre></details>`:''}
      ${mio?`<div class="row" style="margin-top:10px;gap:6px"><button class="btn sec sm" data-x="pdf">Descargar PDF</button><button class="btn sec sm" data-x="xls">Descargar Excel</button></div>`:''}</div>
      <h2>Desglose del período</h2><div class="card" style="overflow:auto"><table><thead><tr><th>Ítem</th><th class="num">Total edificio</th><th class="num">Tu parte</th></tr></thead><tbody>
      ${mio?ls.map(l=>`<tr><td>${esc(l.t)}${l.cargo?' <span class="pill wa">Solo tu unidad</span>':''}<br><span class="muted small">${esc(l.d)}${l.d&&l.reparto?' · ':''}${l.reparto?'Se reparte '+esc(l.reparto):''}${l.consumo!=null?` · <b>tu consumo: ${numCL(l.consumo,3)} ${esc(l.unidad)}</b>`:''}</span></td><td class="num">${l.total==null?'—':clp(l.total)}</td><td class="num">${clp(l.parte)}</td></tr>`).join('')
        :(cur.items||[]).map(it=>`<tr><td>${esc(it.categoria)}</td><td class="num">${clp(it.monto)}</td><td class="num">—</td></tr>`).join('')}
      <tr><th>Total</th><th class="num">${clp(cur.total)}</th><th class="num">${mio?clp(mio.monto):'—'}</th></tr></tbody></table></div>
      <h2>Historial</h2><div class="list">${vis.slice(1).map(x=>{const m=pr[x.periodo]?.[dep]; return `<div class="item static"><div class="hd"><b>${esc(fmtMonth(x.periodo))}</b>${m?`<span class="pill ${m.pagado?'ok':'wa'}">${m.pagado?'Pagado':'Pendiente'}</span>`:''}</div><div class="meta">${m?clp(m.monto):'—'} · total edificio ${clp(x.total)}</div></div>`;}).join('')||'<div class="empty">Sin períodos anteriores</div>'}</div>`;
    }
  });
};
async function formGasto(g){
  g = g || {periodo:monthStr(), vence:'', items:[{categoria:'Remuneraciones',monto:0},{categoria:'Agua',monto:0},{categoria:'Electricidad áreas comunes',monto:0},{categoria:'Mantención ascensores',monto:0},{categoria:'Aseo',monto:0}], publicado:false};
  let fondos=[]; try{ fondos=await q(T('fondos').select('*').eq('activo',true)); }catch(e){}
  if(!g.actualizado) fondos.filter(f=>Number(f.pct)>0||f.reserva).forEach(f=>{ if(!g.items.some(it=>it.fondo===f.id)) g.items.push({categoria:f.nombre, monto:0, fondo:f.id}); });
  const suma=Object.values(S.unidades).reduce((a,u)=>a+(Number(u.alicuota)||0),0), mds=medidores();
  const m=modal(`<h3>${g.actualizado?'Editar':'Nuevo'} período</h3><form id="fG">
  <div class="row"><label class="f grow"><span>Período</span><select name="periodo" required ${g.actualizado?'disabled':''}>${opcionesMes(g.periodo)}</select></label><label class="f grow"><span>Vencimiento</span><input type="date" name="vence" value="${esc(g.vence||'')}"></label></div>
  <div id="items"></div><div class="row wrap" style="gap:6px"><button type="button" class="btn sec sm" id="addIt">+ Ítem</button>${fondos.some(f=>Number(f.pct)>0)?'<button type="button" class="btn sec sm" id="calcF">Calcular aportes a fondos</button>':''}</div>
  <div class="row" style="margin-top:12px;justify-content:space-between"><b>Total: <span id="gTot">$0</span></b><label class="sw"><input type="checkbox" name="publicado" ${g.publicado?'checked':''}> Publicado</label></div>
  <div id="gAvisos" class="small" style="margin-top:6px"></div>
  <p class="small muted">Alícuotas en Administración → Unidades: ${Object.keys(S.unidades).length} unidades, suma ${suma.toFixed(2)}%.${mds.length?'':' Para repartir según consumo (agua caliente, calefacción…), configura los medidores en Lecturas.'} ${fondos.length?'':'Los fondos (reserva, mantención…) se crean en Finanzas → Fondos.'}</p>
  <div class="row" style="justify-content:flex-end;margin-top:8px">${g.actualizado?'<button type="button" class="btn dan sm" id="delG">Eliminar</button>':''}<button class="btn">Guardar</button></div></form>`);
  const items=$('#items',m);
  const rowIt=(it={})=>{ const d=document.createElement('div'); d.className='itm card'; d.style.cssText='padding:8px;margin-bottom:6px';
    const modo=it.prorrateo==='consumo'?'consumo:'+it.medidor:(it.prorrateo||'alicuota');
    d.innerHTML=`<div class="row"><input type="text" name="cat" placeholder="Categoría" value="${esc(it.categoria||'')}" required style="flex:2"><input type="text" name="des" placeholder="Detalle" value="${esc(it.descripcion||'')}" style="flex:2"><input type="text" inputmode="numeric" data-clp name="mon" placeholder="$" value="${it.monto||''}" style="flex:1;min-width:110px;text-align:right"><button type="button" class="btn sec sm" data-rm>✕</button></div>
    <div class="row wrap" style="gap:6px;margin-top:6px;align-items:center"><span class="small muted">Se reparte</span><select name="rep" style="width:auto">${[['alicuota','por alícuota'],['iguales','en partes iguales'],...mds.map(x=>['consumo:'+x.id,'según consumo de '+x.nombre.toLowerCase()]),['unidades','solo a algunas unidades']].map(([v,t])=>`<option value="${esc(v)}" ${v===modo?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <label class="small" data-k="fijo">con <input type="text" inputmode="decimal" data-dec name="fijo" value="${aDec(it.fijo)}" style="width:64px;text-align:right"> % fijo por alícuota</label>
      <input type="text" name="deptos" data-k="deptos" placeholder="Unidades, ej: 101, 204" value="${esc((it.deptos||[]).join(', '))}" style="width:180px">
      ${fondos.length?`<select name="fondo" style="width:auto"><option value="">No va a un fondo</option>${fondos.map(f=>`<option value="${f.id}" ${it.fondo===f.id?'selected':''}>Va al ${esc(f.nombre.toLowerCase().startsWith('fondo')?f.nombre:'fondo '+f.nombre)}</option>`).join('')}</select>`:''}</div>`;
    items.appendChild(d); vis(d); };
  const vis=d=>{ const v=$('[name=rep]',d).value; $('[data-k=fijo]',d).style.display=v.startsWith('consumo:')?'':'none'; $('[data-k=deptos]',d).style.display=v==='unidades'?'':'none'; };
  (g.items||[]).forEach(rowIt); $('#addIt',m).addEventListener('click',()=>rowIt());
  const leer=()=>$$('#items .itm',m).map(r=>{ const v=$('[name=rep]',r).value, o={categoria:$('[name=cat]',r).value.trim(), descripcion:$('[name=des]',r).value.trim(), monto:leerMonto($('[name=mon]',r).value)};
    if(v.startsWith('consumo:')){ o.prorrateo='consumo'; o.medidor=v.slice(8); const f=Math.min(100,Math.max(0,leerDec($('[name=fijo]',r).value))); if(f) o.fijo=f; }
    else if(v==='unidades'){ o.prorrateo='unidades'; o.deptos=[...new Set($('[name=deptos]',r).value.split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean))]; }
    else if(v==='iguales') o.prorrateo='iguales';
    const f=$('[name=fondo]',r)?.value; if(f) o.fondo=f; return o; });
  let lecs={}, cargosP=[];
  const avisos=()=>{ const its=leer(), out=[], nU=Object.keys(S.unidades).length;
    its.filter(it=>it.prorrateo==='consumo').forEach(it=>{ const md=mds.find(x=>x.id===it.medidor), n=lecs[it.medidor]||0; out.push(n>=nU?`<span class="pill ok">✓</span> ${esc(md?.nombre)}: lecturas de las ${nU} unidades.`:`<span class="pill ${n?'wa':'er'}">${n} de ${nU}</span> ${esc(md?.nombre)}: ${n?'las unidades sin lectura pagarán solo la parte fija.':'sin lecturas, no se puede publicar.'} <a href="#lecturas">Ingresar lecturas</a>`); });
    its.filter(it=>it.prorrateo==='unidades').forEach(it=>{ const malas=it.deptos.filter(d=>!S.unidades[d]); if(!it.deptos.length||malas.length) out.push(`<span class="pill er">Revisar</span> "${esc(it.categoria)}": ${it.deptos.length?'no existen las unidades '+esc(malas.join(', ')):'indica las unidades'}.`); });
    if(cargosP.length) out.push(`<span class="pill in">+ ${clp(cargosP.reduce((a,c)=>a+Number(c.monto),0))}</span> Además se cobran ${cargosP.length} ${cargosP.length===1?'cargo individual':'cargos individuales'} (multas, arriendos…) a sus unidades.`);
    $('#gAvisos',m).innerHTML=out.map(x=>`<div style="margin-bottom:4px">${x}</div>`).join(''); };
  const cargar=async()=>{ const p=$('[name=periodo]',m).value; try{ const [l,c]=await Promise.all([q(T('lecturas').select('medidor,depto').eq('periodo',p)), q(T('cargos').select('monto').eq('periodo',p).eq('estado','vigente'))]); lecs={}; l.forEach(x=>{ if(S.unidades[x.depto]) lecs[x.medidor]=(lecs[x.medidor]||0)+1; }); cargosP=c; }catch(e){ lecs={}; cargosP=[]; } avisos(); };
  const recalc=()=>{ let t=0; $$('input[name=mon]',m).forEach(i=>t+=leerMonto(i.value)); $('#gTot',m).textContent=clp(t); };
  m.addEventListener('input',()=>{ recalc(); avisos(); }); m.addEventListener('change',e=>{ const r=e.target.closest('.itm'); if(r) vis(r); if(e.target.name==='periodo') cargar(); else avisos(); });
  m.addEventListener('click',e=>{ if(e.target.closest('[data-rm]')){ e.target.closest('.itm').remove(); recalc(); avisos(); } }); recalc(); cargar();
  $('#calcF',m)?.addEventListener('click',()=>{ const base=leer().filter(it=>!it.fondo).reduce((a,it)=>a+it.monto,0);
    fondos.filter(f=>Number(f.pct)>0).forEach(f=>{ let r=$$('#items .itm',m).find(x=>$('[name=fondo]',x)?.value===f.id); if(!r){ rowIt({categoria:f.nombre, fondo:f.id}); r=$$('#items .itm',m).pop(); } $('[name=mon]',r).value=aMonto(base*Number(f.pct)/100); if(!$('[name=des]',r).value) $('[name=des]',r).value=numCL(f.pct,2)+' % de los gastos del período'; });
    recalc(); toast('Aportes calculados sobre '+clp(base)); });
  $('#delG',m)?.addEventListener('click', async()=>{ if(await confirmBox('¿Eliminar este período?')){ await q(T('gastos').delete().eq('periodo',g.periodo)); closeModal(); toast('Eliminado'); } });
  $('#fG',m).addEventListener('submit', async e=>{ e.preventDefault(); const rows=leer(); const total=rows.reduce((a,b)=>a+b.monto,0); const periodo=$('[name=periodo]',m).value; const vence=$('[name=vence]',m).value||null; const publicado=$('[name=publicado]',m).checked; const b=$('#fG > .row:last-child .btn:not(.dan)',m);
    busy(b,true);
    try{ await q(T('gastos').upsert({edificio_id:S.me.edificio_id, periodo, vence, items:rows, total, publicado:false, actualizado:now()})); await q(sb.rpc('recalcular_prorrateo',{p_periodo:periodo}));
      if(publicado){ try{ await q(T('gastos').update({publicado:true}).eq('periodo',periodo)); await q(sb.rpc('recalcular_prorrateo',{p_periodo:periodo})); }
        catch(err){ await q(T('gastos').update({publicado:false}).eq('periodo',periodo)).catch(()=>{}); throw new Error(errMsg(err)+' (el período quedó guardado como borrador)'); } }
      closeModal(); toast(publicado?'Período publicado':'Período guardado'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
function detalleGastoAdmin(g, pr){
  const us=Object.values(pr).sort((a,b)=>porNum(a.depto,b.depto)), items=g.items||[], cons=items.map((it,i)=>({it,i})).filter(x=>x.it.prorrateo==='consumo');
  const cargoDe=p=>(p.detalle||[]).filter(d=>d.c).reduce((a,d)=>a+Number(d.monto),0), hayCargos=us.some(p=>cargoDe(p)>0), consDe=(p,i)=>(p.detalle||[]).find(d=>d.i===i)?.consumo;
  const m=modal(`<h3>${esc(fmtMonth(g.periodo))}</h3><div class="row wrap" style="margin-bottom:10px"><span class="pill ${g.publicado?'ok':'wa'}">${g.publicado?'Publicado':'Borrador'}</span><b>${clp(g.total)}</b><span class="grow"></span><button class="btn sec sm" id="xPdf">PDF</button><button class="btn sec sm" id="xXls">Excel</button>${isAdmin()?`<button class="btn sec sm" id="edG">Editar</button><button class="btn sec sm" id="recG">Recalcular prorrateo</button>`:''}</div>
  <table><thead><tr><th>Ítem</th><th>Se reparte</th><th class="num">Monto</th></tr></thead><tbody>${items.map(it=>`<tr><td>${esc(it.categoria)} <span class="muted small">${esc(it.descripcion||'')}</span>${it.fondo?' <span class="pill in">Fondo</span>':''}</td><td class="small">${esc(txtReparto(it))}</td><td class="num">${clp(it.monto)}</td></tr>`).join('')}</tbody></table>
  <h2>Prorrateo por unidad</h2><div style="overflow:auto"><table><thead><tr><th>Unidad</th><th class="num">Alíc.</th>${cons.map(x=>`<th class="num">${esc(medidores().find(y=>y.id===x.it.medidor)?.nombre||x.it.categoria)}</th>`).join('')}${hayCargos?'<th class="num">Cargos</th>':''}<th class="num">Monto</th><th>Pago</th></tr></thead><tbody>${us.map(p=>`<tr><td>${esc(p.depto)}</td><td class="num">${Number(p.alicuota)}%</td>${cons.map(x=>{ const c=consDe(p,x.i); return `<td class="num">${c==null?'—':numCL(c,3)+' '+esc(medidores().find(y=>y.id===x.it.medidor)?.unidad||'')}</td>`; }).join('')}${hayCargos?`<td class="num">${cargoDe(p)?clp(cargoDe(p)):'—'}</td>`:''}<td class="num">${clp(p.monto)}</td><td>${estadoCobro(p)}${isAdmin()&&!p.pagado&&!p.convenio_id?` <button class="btn sec sm" data-pago="${esc(p.depto)}">Registrar pago</button>`:''}</td></tr>`).join('')||`<tr><td colspan="${4+cons.length+(hayCargos?1:0)}" class="muted">Sin unidades. Agrega unidades con alícuota en Administración.</td></tr>`}</tbody></table></div>`);
  $('#xPdf',m).addEventListener('click',()=>{ closeModal(); exportGasto('pdf',g,pr); });
  $('#xXls',m).addEventListener('click',()=>exportGasto('xls',g,pr));
  $('#edG',m)?.addEventListener('click',()=>formGasto(g));
  $('#recG',m)?.addEventListener('click', async()=>{ try{ await q(sb.rpc('recalcular_prorrateo',{p_periodo:g.periodo})); toast('Prorrateo recalculado'); closeModal(); }catch(err){ toast(errMsg(err)); } });
  m.addEventListener('click',e=>{ const b=e.target.closest('[data-pago]'); if(b) formPago({depto:b.dataset.pago, periodo:g.periodo}); });
}

// Exportar un período a Excel (.xlsx) o PDF (diálogo de impresión → "Guardar como PDF").
// Con `mio` (fila de gasto_unidades del residente) genera su aviso de cobro; sin él, el informe completo.
async function exportGasto(tipo, g, pr, mio){
  const c=S.cfg||{}; const items=g.items||[]; const mes=fmtMonth(g.periodo);
  const dmy=d=>d?String(d).slice(8,10)+'-'+String(d).slice(5,7)+'-'+String(d).slice(0,4):'—';
  const us=Object.values(pr||{}).sort((a,b)=>porNum(a.depto,b.depto));
  const ls=mio?desgloseUnidad(g,mio):[];
  const archivo='gastos-comunes-'+g.periodo+(mio?'-depto-'+seg(mio.depto):'');
  const parteDe=(u,i)=>{ const d=(u.detalle||[]).find(x=>x.i===i); return d?Number(d.monto):((u.detalle||[]).some(x=>x.i!=null)?0:Math.round(Number(items[i].monto)*Number(u.alicuota)/100)); };
  const cargoDe=u=>(u.detalle||[]).filter(d=>d.c).reduce((a,d)=>a+Number(d.monto),0);
  if(tipo==='xls'){
    const B=v=>({v,b:true}); let hojas;
    if(mio) hojas=[{name:'Aviso de cobro', widths:[34,40,16,16,14], rows:[[B(c.nombre||'')],[B('Gastos comunes '+mes)],[],['Unidad',String(mio.depto)],['Alícuota %',Number(mio.alicuota)],['Vencimiento',dmy(g.vence)],['Estado',mio.pagado?'Pagado':'Pendiente'],[],
      [B('Ítem'),B('Detalle'),B('Total edificio'),B('Tu parte'),B('Tu consumo')], ...ls.map(l=>[l.t,[l.d,l.reparto?'se reparte '+l.reparto:''].filter(Boolean).join(' · '),l.total==null?'':l.total,l.parte,l.consumo==null?'':l.consumo+' '+l.unidad]), [B('Total'),'',B(Number(g.total)),B(Number(mio.monto)),'']]}];
    else hojas=[{name:'Resumen', widths:[34,34,30,16], rows:[[B(c.nombre||'')],[B('Gastos comunes '+mes)],[],['Vencimiento',dmy(g.vence)],['Estado',g.publicado?'Publicado':'Borrador'],['Unidades pagadas',us.filter(u=>u.pagado).length+' de '+us.length],[],
        [B('Ítem'),B('Detalle'),B('Se reparte'),B('Monto')], ...items.map(it=>[it.categoria,it.descripcion||'',txtReparto(it),Number(it.monto)||0]), [B('Total'),'','',B(Number(g.total))]]},
      {name:'Prorrateo', widths:[12,26,12,...items.map(()=>16),14,16,12], rows:[[B('Unidad'),B('Propietario'),B('Alícuota %'),...items.map(it=>B(it.categoria)),B('Cargos'),B('Total'),B('Estado')],
        ...us.map(u=>[String(u.depto),S.unidades[u.depto]?.prop||'',Number(u.alicuota),...items.map((it,i)=>parteDe(u,i)),cargoDe(u),Number(u.monto),u.pagado?'Pagado':'Pendiente']),
        [B('Total'),'',B(us.reduce((a,u)=>a+Number(u.alicuota),0)),...items.map((it,i)=>B(us.reduce((a,u)=>a+parteDe(u,i),0))),B(us.reduce((a,u)=>a+cargoDe(u),0)),B(us.reduce((a,u)=>a+Number(u.monto),0)),'']]}];
    descargar(new Blob([window.MiniXlsx.build(hojas)],{type:window.MiniXlsx.MIME}), archivo+'.xlsx'); return;
  }
  const logo=await urlFirmada(c.logo).catch(()=>'');
  const cab=`<div class="ph">${logo?`<img src="${esc(logo)}" alt="">`:''}<div><b>${esc(c.nombre||'')}</b><br>${esc([c.direccion,c.comuna].filter(Boolean).join(', '))}</div></div>`;
  const banco=c.datos_bancarios?`<h2>Datos para transferir</h2><div class="pie">${esc(c.datos_bancarios)}</div>`:'';
  imprimir(archivo, mio?
    `${cab}<h1>Aviso de cobro · Gastos comunes ${esc(mes)}</h1><p class="sub">Depto ${esc(mio.depto)} · Alícuota ${Number(mio.alicuota)}% · Vence ${dmy(g.vence)} · ${mio.pagado?'Pagado':'Pendiente de pago'}</p>
    <table><thead><tr><th>Ítem</th><th class="num">Total edificio</th><th class="num">Tu parte</th></tr></thead><tbody>${ls.map(l=>`<tr><td>${esc(l.t)}${l.d?' <span class="muted">'+esc(l.d)+'</span>':''}${l.consumo!=null?` <span class="muted">· tu consumo ${numCL(l.consumo,3)} ${esc(l.unidad)}</span>`:''}</td><td class="num">${l.total==null?'—':clp(l.total)}</td><td class="num">${clp(l.parte)}</td></tr>`).join('')}
    <tr class="tot"><td>Total a pagar</td><td class="num">${clp(g.total)}</td><td class="num">${clp(mio.monto)}</td></tr></tbody></table>${banco}`
  : `${cab}<h1>Gastos comunes ${esc(mes)}</h1><p class="sub">Total ${clp(g.total)} · Vence ${dmy(g.vence)} · ${g.publicado?'Publicado':'Borrador'} · ${us.filter(u=>u.pagado).length} de ${us.length} unidades pagadas</p>
    <table><thead><tr><th>Ítem</th><th>Detalle</th><th>Se reparte</th><th class="num">Monto</th></tr></thead><tbody>${items.map(it=>`<tr><td>${esc(it.categoria)}</td><td>${esc(it.descripcion||'')}</td><td>${esc(txtReparto(it))}</td><td class="num">${clp(it.monto)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td></td><td class="num">${clp(g.total)}</td></tr></tbody></table>
    <h2>Prorrateo por unidad</h2><table><thead><tr><th>Unidad</th><th>Propietario</th><th class="num">Alícuota</th><th class="num">Cargos</th><th class="num">Monto</th><th>Estado</th></tr></thead><tbody>${us.map(u=>`<tr><td>${esc(u.depto)}</td><td>${esc(S.unidades[u.depto]?.prop||'')}</td><td class="num">${Number(u.alicuota)}%</td><td class="num">${cargoDe(u)?clp(cargoDe(u)):'—'}</td><td class="num">${clp(u.monto)}</td><td>${u.pagado?'Pagado '+dmy(u.pagado_at):'Pendiente'}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td></td><td class="num">${us.reduce((a,u)=>a+Number(u.alicuota),0).toFixed(2)}%</td><td class="num">${clp(us.reduce((a,u)=>a+cargoDe(u),0))}</td><td class="num">${clp(us.reduce((a,u)=>a+Number(u.monto),0))}</td><td></td></tr></tbody></table>${banco}`);
}

// MULTAS con debido proceso (adaptado del módulo E2 de CactusOne). Cada caso: apertura con evidencia →
// cargos (conducta del catálogo) → descargos dentro del plazo → resolución fundada → aprobación del comité
// (si así se configura) → cargo en el gasto común. Las reglas las aplica la base de datos.
const EST_INF={abierto:['Por decidir','wa'], cargos:['Cargos notificados','in'], en_comite:['En el comité','wa'], resuelto:['Multa aplicada','er'], absuelto:['Absuelto','ok'], archivado:['Archivado','mu'], derivado_jpl:['Derivado al JPL','mu']};
const ORIGEN_INF={administracion:'Administración', comite:'Comité', conserjeria:'Conserjería', estacionamiento:'Estacionamiento de visita', reclamo:'Reclamo'};
const EV_INF={apertura:'Apertura', evidencia:'Evidencia', cargos:'Notificación de cargos', descargos:'Descargos', resolucion:'Resolución', voto:'Voto del comité', cobro:'Cobro', derivacion:'Derivación', restitucion:'Restitución', archivo:'Archivo'};
const enCurso=c=>['abierto','cargos','en_comite'].includes(c.estado);
const montoUnidad=(m,u)=>`${numCL(m,2)} ${u}`;
async function cabeceraImpresion(){ const c=S.cfg||{}; const logo=await urlFirmada(c.logo).catch(()=>''); return `<div class="ph">${logo?`<img src="${esc(logo)}" alt="">`:''}<div><b>${esc(c.nombre||'')}</b><br>${esc([c.direccion,c.comuna].filter(Boolean).join(', '))}</div></div>`; }
async function imprimirCaso(tipo, c, cat){ const cab=await cabeceraImpresion(), fecha=d=>d?fmtDay(String(d).slice(0,10)):'—';
  if(tipo==='cargos') imprimir('notificacion-cargos-'+c.folio, `${cab}<h1>Notificación de cargos · Caso nº ${c.folio}</h1><p class="sub">Fecha: ${fecha(c.cargos_at)} · Unidad: ${esc(c.depto)} · A: propietario(s) y ocupantes de la unidad</p>
    <h2>Conducta</h2><p>${esc(cat?.conducta||'')}${cat?.articulo?` (artículo ${esc(cat.articulo)} del reglamento de copropiedad)`:''}. Multa posible: ${cat?montoUnidad(cat.monto,cat.unidad):'—'}${cat?.por_evento?' por evento':''}${cat?.permanente?', que se repite cada mes hasta restituir':''}.</p>
    <h2>Cargos</h2><p style="white-space:pre-wrap">${esc(c.cargos_texto||'')}</p>
    <h2>Descargos</h2><p>Puede presentar sus descargos por escrito, con los antecedentes que estime, <b>hasta el ${fecha(c.descargos_hasta)}</b>, en la app (módulo Multas) o entregándolos a la administración.</p>
    <p style="margin-top:40px">______________________________<br>Administración · ${esc(S.cfg?.nombre||'')}</p><p class="sub" style="margin-top:30px">Recibí copia: ____________________ Fecha: __________</p>`);
  else imprimir('resolucion-caso-'+c.folio, `${cab}<h1>Resolución · Caso nº ${c.folio}</h1><p class="sub">Fecha: ${fecha(c.resuelto_at)} · Unidad: ${esc(c.depto||'—')}</p>
    <h2>Conducta imputada</h2><p>${esc(cat?.conducta||'')}${cat?.articulo?` (artículo ${esc(cat.articulo)})`:''}</p>
    <h2>Descargos</h2><p style="white-space:pre-wrap">${c.descargos_texto?esc(c.descargos_texto):'No se presentaron descargos dentro del plazo.'}</p>
    <h2>Fundamentos</h2><p style="white-space:pre-wrap">${esc(c.resolucion_texto||'')}</p>
    <h2>Resuelve</h2><p>${c.estado==='absuelto'?'Absolver a la unidad, sin multa.':c.multa_monto?`Aplicar una multa de <b>${montoUnidad(c.multa_monto,c.multa_unidad)}</b>${c.multa_clp?` (${clp(c.multa_clp)})`:''}${c.reincidencia?', por reincidencia dentro de 6 meses':''}, que se cobra con los gastos comunes${c.restituir_antes?`, y restituir a más tardar el ${fecha(c.restituir_antes)}; mientras no se restituya, la multa se repite cada mes`:''}.`:'—'}</p>
    <p style="margin-top:40px">______________________________<br>Administración · ${esc(S.cfg?.nombre||'')}</p>`); }
function formCaso(pre={}, listo){
  const m=modal(`<h3>Nuevo caso de infracción</h3><form id="fCa"><label class="f"><span>Unidad (si se sabe)</span><input type="text" name="depto" list="dlCa" value="${esc(pre.depto||'')}"><datalist id="dlCa">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>
    <label class="f"><span>Qué se constató</span><textarea name="descripcion" required placeholder="Qué pasó, cuándo y dónde. Solo hechos.">${esc(pre.descripcion||'')}</textarea></label>
    <label class="f"><span>Fotos de evidencia (opcional)</span><input type="file" name="fotos" accept="image/*" multiple></label>
    <p class="small muted">Abrir un caso no es multar: la administración decide si formula cargos, la unidad puede presentar descargos y solo después se resuelve.</p><button class="btn full">Abrir caso</button></form>`);
  $('#fCa',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button.full',e.target); busy(b,true);
    try{ const fotos=await subirFotos($('[name=fotos]',m),'multas'); const d=formData(e.target);
      const id=await q(sb.rpc('abrir_infraccion',{p_descripcion:d.descripcion.trim(), p_depto:d.depto.trim()||null, p_evidencias:fotos, p_origen:pre.origen||null})); closeModal(); toast('Caso abierto'); listo?.(id); }
    catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
VIEWS.multas = function(param){
  const r=role(), adm=isAdmin(), resid=['residente','propietario'].includes(r), puedeAbrir=['admin','comite','conserje'].includes(r);
  const TABS=resid?{curso:'Mis casos'}:{curso:'En curso', cerrados:'Cerrados', ...(adm||r==='comite'?{catalogo:'Catálogo y ajustes'}:{})};
  let tab=TABS[param]?param:'curso', casos=[], cat=[], ind=[], votos=[];
  setMain(`<h1>Multas</h1>${puedeAbrir?'<div style="margin-bottom:10px"><button class="btn" id="bCaso">+ Nuevo caso</button></div>':''}<div class="tabs" id="mTabs">${Object.entries(TABS).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="mBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['infracciones','infraccion_eventos','infraccion_votos','multas_catalogo','indicadores','edificios'], async()=>{ const [c,k,i,v]=await Promise.all([q(T('infracciones').select('*').order('folio',{ascending:false}).limit(1000)), q(T('multas_catalogo').select('*').order('conducta')), q(T('indicadores').select('*').order('desde',{ascending:false})), q(T('infraccion_votos').select('*')).catch(()=>[])]); return {c,k,i,v}; },
    ({c,k,i,v})=>{ casos=c; cat=k; ind=i; votos=v; if(!$('.modal')) draw(); });
  const listo=()=>w.reload(), catDe=c=>cat.find(x=>x.id===c.catalogo_id), hoy=todayStr();
  const plazo=c=>c.estado==='abierto'?`decidir antes del ${fmtDay(c.decidir_antes)}${c.decidir_antes<hoy?' (vencido)':''}`:c.estado==='cargos'?(c.descargos_at?'descargos recibidos: listo para resolver':`descargos hasta el ${fmtDay(c.descargos_hasta)}${c.descargos_hasta<hoy?' (vencido: listo para resolver)':''}`):c.estado==='en_comite'?`${votos.filter(x=>x.infraccion_id===c.id&&x.ronda===c.ronda&&x.aprueba).length} de ${Number(S.cfg?.multas?.aprobaciones_comite??1)} aprobaciones`:c.multa_monto&&c.estado==='resuelto'?`${montoUnidad(c.multa_monto,c.multa_unidad)} · ${clp(c.multa_clp)}${c.restituir_antes&&!c.restituido_el?' · se repite cada mes hasta restituir':''}`:'';
  const fila=c=>`<div class="item" data-caso="${c.id}"><div class="hd"><b>Nº ${c.folio}${c.depto?' · Depto '+esc(c.depto):''} · ${esc(catDe(c)?.conducta||c.descripcion.slice(0,70))}</b>${pillOf(EST_INF,c.estado)}</div><div class="meta">${esc(ORIGEN_INF[c.origen]||c.origen)} · ${fmtDate(c.ts)}${plazo(c)?' · '+esc(plazo(c)):''}</div></div>`;
  const draw=()=>{ const el=$('#mBody'); if(!el) return;
    if(tab==='catalogo'){ dibujarCatalogo(el); return; }
    const d=casos.filter(c=>tab==='curso'?(resid?true:enCurso(c)):!enCurso(c));
    el.innerHTML=`${resid?'<p class="small muted">Aquí aparecen los casos de tu unidad cuando la administración formula cargos. Tienes un plazo para presentar descargos antes de que se resuelva.</p>':''}<div class="list">${d.map(fila).join('')||`<div class="empty">${tab==='curso'?'No hay casos en curso':'Sin casos cerrados'}</div>`}</div>
      ${tab==='curso'&&!resid?'<p class="small muted">Plazos en días hábiles (sin fines de semana ni feriados). Solo se aplican multas del catálogo; nada se multa sin cargos, plazo de descargos y resolución fundada.</p>':''}`; };
  const dibujarCatalogo=el=>{ const cfg=S.cfg?.multas||{}, ult=c=>ind.find(x=>x.codigo===c);
    el.innerHTML=`<div class="card"><h3>Procedimiento</h3><form id="fMcfg"><div class="row wrap"><label class="f grow"><span>Plazo para decidir si se formulan cargos (días hábiles)</span><input type="text" inputmode="numeric" name="plazo_decision" value="${Number(cfg.plazo_decision??5)}" ${adm?'':'disabled'}></label><label class="f grow"><span>Plazo de descargos (días hábiles)</span><input type="text" inputmode="numeric" name="plazo_descargos" value="${Number(cfg.plazo_descargos??5)}" ${adm?'':'disabled'}></label></div>
      <div class="row wrap"><label class="f grow"><span>Aprobaciones del comité para aplicar una multa (0 = no se requieren)</span><input type="text" inputmode="numeric" name="aprobaciones_comite" value="${Number(cfg.aprobaciones_comite??1)}" ${adm?'':'disabled'}></label><label class="f grow"><span>Lo cobrado por multas</span><select name="destino" ${adm?'':'disabled'}><option value="fondo_reserva" ${(cfg.destino||'fondo_reserva')==='fondo_reserva'?'selected':''}>Va al fondo de reserva</option><option value="gasto" ${cfg.destino==='gasto'?'selected':''}>Queda en la caja del gasto común</option></select></label></div>
      ${adm?'<button class="btn sec sm">Guardar</button>':''}</form><p class="small muted">Los valores por defecto (5 días hábiles, multas al fondo de reserva) vienen del reglamento de Los Cactus; ajústalos al reglamento de tu edificio.</p></div>
      <div class="card"><h3>UTM y UF</h3><div class="kpi"><div class="k"><b>${ult('UTM')?clp(ult('UTM').valor):'—'}</b><span>UTM${ult('UTM')?' desde '+fmtDay(ult('UTM').desde):' · falta'}</span></div><div class="k"><b>${ult('UF')?clp(ult('UF').valor):'—'}</b><span>UF${ult('UF')?' desde '+fmtDay(ult('UF').desde):' · falta'}</span></div></div>
      ${adm?`<form id="fInd" class="row wrap" style="margin-top:10px;align-items:flex-end"><label class="f" style="margin:0"><span>Indicador</span><select name="codigo"><option>UTM</option><option>UF</option></select></label><label class="f" style="margin:0"><span>Valor en pesos</span><input type="text" inputmode="numeric" data-clp name="valor" required style="width:130px"></label><label class="f" style="margin:0"><span>Desde</span><input type="date" name="desde" value="${todayStr()}" required></label><button class="btn sec sm">Agregar</button></form><p class="small muted">La multa se convierte a pesos con el valor vigente el día que se aplica. Actualízalos según el SII (UTM) y el Banco Central (UF).</p>`:''}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Catálogo de conductas</h3>${adm?'<button class="btn sec sm" id="bConducta">+ Conducta</button>':''}</div>
      ${!cat.length&&adm?'<div class="info" style="margin-top:10px">El catálogo está vacío. <button class="btn sec sm" id="bCatEj">Cargar catálogo de ejemplo</button><br><span class="small">Es el de Los Cactus (borrador de su reglamento, octubre 2026): revisa conductas, artículos y montos con el reglamento de tu edificio antes de usarlo.</span></div>':''}
      <div class="list" style="margin-top:10px">${cat.filter(x=>!x.retirado).map(x=>`<div class="item ${adm?'':'static'}" ${adm?`data-conducta="${x.id}"`:''}><div class="hd"><b>${esc(x.conducta)}</b><span class="pill ${x.jpl?'mu':'in'}">${x.jpl?'Juzgado de Policía Local':montoUnidad(x.monto,x.unidad)}</span></div><div class="meta">Art. ${esc(x.articulo||'—')}${x.categoria?' · '+x.categoria:''}${x.por_evento?' · por evento':''}${x.permanente?' · permanente (se repite cada mes)':''}${x.evidencia?' · evidencia mínima: '+esc(x.evidencia):''}${x.nota?' · '+esc(x.nota):''}</div></div>`).join('')||'<div class="empty">Sin conductas</div>'}</div></div>
      ${adm?`<div class="card"><h3>Feriados</h3><p class="small muted">Para calcular los días hábiles. Uno por línea, con formato AAAA-MM-DD.</p><form id="fFer"><textarea name="f" style="min-height:120px">${esc((S.cfg?.feriados||[]).join('\n'))}</textarea><button class="btn sec sm" style="margin-top:6px">Guardar feriados</button></form></div>`:''}`; };
  const formConducta=(x={})=>{ const m=modal(`<h3>${x.id?'Editar':'Nueva'} conducta</h3><form id="fCo"><label class="f"><span>Conducta</span><input type="text" name="conducta" value="${esc(x.conducta||'')}" required></label>
      <div class="row"><label class="f grow"><span>Artículo del reglamento</span><input type="text" name="articulo" value="${esc(x.articulo||'')}"></label><label class="f grow"><span>Categoría (opcional)</span><select name="categoria"><option value="">—</option>${['leve','grave','gravisima'].map(k=>`<option value="${k}" ${x.categoria===k?'selected':''}>${k==='gravisima'?'gravísima':k}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f grow"><span>Monto</span><input type="text" inputmode="decimal" data-dec name="monto" value="${x.monto!=null?aDec(x.monto):''}"></label><label class="f grow"><span>Unidad</span><select name="unidad">${['UTM','UF'].map(u=>`<option ${x.unidad===u?'selected':''}>${u}</option>`).join('')}</select></label></div>
      <label class="sw"><input type="checkbox" name="por_evento" ${x.por_evento?'checked':''}> Por cada evento</label><label class="sw"><input type="checkbox" name="permanente" ${x.permanente?'checked':''}> Permanente: se repite cada mes hasta restituir</label><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="jpl" ${x.jpl?'checked':''}> La conoce el Juzgado de Policía Local (no la multa el comité)</label>
      <label class="f"><span>Evidencia mínima (opcional)</span><input type="text" name="evidencia" value="${esc(x.evidencia||'')}" placeholder="Ej: denuncia de 2 unidades"></label><label class="f"><span>Nota (opcional)</span><input type="text" name="nota" value="${esc(x.nota||'')}"></label>
      <label class="f"><span>Borrador de la notificación de cargos</span><textarea name="plantilla" placeholder="Se le notifican cargos por… [hechos]…">${esc(x.plantilla||'')}</textarea></label>
      <div class="row" style="justify-content:flex-end;gap:6px">${x.id?'<button type="button" class="btn dan sm" id="bRet">Retirar del catálogo</button>':''}<button class="btn">Guardar</button></div></form>`);
    $('#bRet',m)?.addEventListener('click', async()=>{ try{ await q(T('multas_catalogo').update({retirado:todayStr()}).eq('id',x.id)); closeModal(); toast('Conducta retirada'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } });
    $('#fCo',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const o={conducta:d.conducta.trim(), articulo:d.articulo.trim(), categoria:d.categoria||null, monto:d.jpl?null:(Number(d.monto)||null), unidad:d.unidad, por_evento:!!d.por_evento, permanente:!!d.permanente, jpl:!!d.jpl, evidencia:d.evidencia.trim()||null, nota:d.nota.trim()||null, plantilla:d.plantilla.trim()};
      try{ await q(x.id?T('multas_catalogo').update(o).eq('id',x.id):T('multas_catalogo').insert(o)); closeModal(); toast('Conducta guardada'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  const detalle=async id=>{ const c=casos.find(x=>x.id===id); if(!c) return; const k=catDe(c);
    let ev=[]; try{ ev=await q(T('infraccion_eventos').select('*').eq('infraccion_id',id).order('ts')); }catch(e){}
    const mio=resid&&c.depto===myDepto(), vence=c.descargos_hasta&&c.descargos_hasta<hoy, puedeResolver=c.estado==='cargos'&&(c.descargos_at||vence), vs=votos.filter(x=>x.infraccion_id===c.id&&x.ronda===c.ronda), yaVote=vs.some(x=>x.uid===S.uid);
    const fotos=a=>(a||[]).length?`<div class="photos">${a.map(f=>`<img data-f="${esc(f)}" data-img="${esc(f)}">`).join('')}</div>`:'';
    const acc=[];
    if(adm&&c.estado==='abierto') acc.push('<button class="btn" data-a="cargos">Formular cargos</button>','<button class="btn sec" data-a="archivar">Archivar</button>','<button class="btn sec" data-a="jpl">Derivar al JPL</button>');
    if(enCurso(c)&&c.estado!=='en_comite'&&(['admin','comite'].includes(r)||(r==='conserje'&&c.creado_por===S.uid))) acc.push('<button class="btn sec" data-a="evidencia">Agregar evidencia</button>');
    if(c.estado==='cargos'&&mio&&!vence) acc.push('<button class="btn" data-a="descargos">Presentar descargos</button>');
    if(c.estado==='cargos'&&adm){ acc.push('<button class="btn sec" data-a="descargos">Registrar descargos escritos</button>'); acc.push(puedeResolver?'<button class="btn" data-a="resolver">Resolver</button>':`<span class="small muted">Podrás resolver cuando lleguen los descargos o venza el plazo (${fmtDay(c.descargos_hasta)}).</span>`); }
    if(c.estado==='en_comite'&&r==='comite'&&!yaVote) acc.push('<button class="btn ok" data-a="aprobar">Aprobar multa</button>','<button class="btn dan" data-a="rechazar">Rechazar</button>');
    if(adm&&c.estado==='resuelto'&&c.restituir_antes&&!c.restituido_el) acc.push('<button class="btn sec" data-a="restituido">Marcar restituido</button>');
    if(c.cargos_at) acc.push('<button class="btn sec" data-a="pdfCargos">Notificación de cargos (PDF)</button>');
    if(['resuelto','absuelto'].includes(c.estado)) acc.push('<button class="btn sec" data-a="pdfRes">Resolución (PDF)</button>');
    const m=modal(`<h3>Caso nº ${c.folio}${c.depto?' · Depto '+esc(c.depto):''}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillOf(EST_INF,c.estado)}<span class="small muted">${esc(ORIGEN_INF[c.origen]||'')} · ${fmtDate(c.ts)}${plazo(c)?' · '+esc(plazo(c)):''}</span></div>
      <h2 style="margin-top:6px">Hechos</h2><p style="white-space:pre-wrap">${esc(c.descripcion)}</p>${fotos(c.evidencias)}
      ${c.cargos_texto?`<h2>Cargos</h2><p class="small"><b>${esc(k?.conducta||'')}</b>${k?.articulo?' · Art. '+esc(k.articulo):''} · multa posible ${k?montoUnidad(k.monto,k.unidad):'—'}</p><p style="white-space:pre-wrap">${esc(c.cargos_texto)}</p>`:''}
      ${c.descargos_texto?`<h2>Descargos</h2><p style="white-space:pre-wrap">${esc(c.descargos_texto)}</p>${fotos(c.descargos_fotos)}`:''}
      ${c.resolucion_texto?`<h2>${c.estado==='archivado'?'Motivo del archivo':c.estado==='derivado_jpl'?'Derivación':'Resolución'}</h2><p style="white-space:pre-wrap">${esc(c.resolucion_texto)}</p>${c.multa_monto?`<p class="small"><b>Multa: ${montoUnidad(c.multa_monto,c.multa_unidad)}${c.multa_clp?' · '+clp(c.multa_clp):''}</b>${c.reincidencia?' · reincidencia':''}${c.restituir_antes?' · restituir antes del '+fmtDay(c.restituir_antes)+(c.restituido_el?' · restituido el '+fmtDay(c.restituido_el):''):''}</p>`:''}`:''}
      ${vs.length?`<p class="small muted">Comité: ${vs.map(x=>esc(userName(x.uid))+(x.aprueba?' aprueba':' rechaza'+(x.comentario?' ('+esc(x.comentario)+')':''))).join(' · ')}</p>`:''}
      <h2>Expediente</h2><div class="timeline">${ev.map(x=>`<div><b>${esc(EV_INF[x.tipo]||x.tipo)}</b> <span class="muted">· ${esc(userName(x.uid))} · ${fmtDate(x.ts)}</span>${x.texto&&!['apertura','cargos','descargos'].includes(x.tipo)?`<br>${esc(x.texto)}`:''}</div>`).join('')}</div>
      <div class="row wrap" style="justify-content:flex-end;margin-top:12px;gap:6px">${acc.join('')}<button class="btn sec" data-close>Cerrar</button></div>`);
    m.addEventListener('click', async e=>{ const img=e.target.closest('[data-img]'); if(img){ viewImg(img.dataset.img); return; } const b=e.target.closest('[data-a]'); if(!b) return; const a=b.dataset.a;
      const rpc=async(fn,args,ok)=>{ try{ await q(sb.rpc(fn,args)); closeModal(); toast(ok); listo(); }catch(err){ toast('Error: '+errMsg(err)); } };
      if(a==='cargos') formCargosCaso(c);
      else if(a==='resolver') formResolver(c);
      else if(a==='pdfCargos') imprimirCaso('cargos',c,k); else if(a==='pdfRes') imprimirCaso('resolucion',c,k);
      else if(a==='archivar'){ const t=await askText('Motivo para archivar (no se formulan cargos)'); if(t) rpc('archivar_infraccion',{p_id:c.id, p_motivo:t},'Caso archivado'); }
      else if(a==='jpl'){ const t=await askText('Nota de la derivación al Juzgado de Policía Local','Corresponde al Juzgado de Policía Local (art. 27 de la Ley 21.442).'); if(t) rpc('derivar_jpl',{p_id:c.id, p_nota:t},'Caso derivado'); }
      else if(a==='aprobar') rpc('votar_multa',{p_id:c.id, p_aprueba:true},'Aprobaste la multa');
      else if(a==='rechazar'){ const t=await askText('¿Por qué rechazas la multa?'); if(t) rpc('votar_multa',{p_id:c.id, p_aprueba:false, p_comentario:t},'Rechazaste la multa'); }
      else if(a==='restituido') rpc('marcar_restituido',{p_id:c.id, p_fecha:todayStr()},'Marcado como restituido');
      else if(a==='descargos'||a==='evidencia'){ const ds=a==='descargos'; const m2=modal(`<h3>${ds?(adm?'Registrar descargos presentados por escrito':'Presentar descargos'):'Agregar evidencia'}</h3><form id="fDs"><label class="f"><span>${ds?'Descargos':'Nota'}</span><textarea name="t" ${ds?'required':''}></textarea></label><label class="f"><span>Fotos o documentos escaneados (opcional)</span><input type="file" name="fotos" accept="image/*" multiple></label>${ds&&!adm?`<p class="small muted">Plazo hasta el ${fmtDay(c.descargos_hasta)}. La administración los considerará antes de resolver.</p>`:''}<button class="btn full">Enviar</button></form>`);
        $('#fDs',m2).addEventListener('submit', async ev=>{ ev.preventDefault(); const bb=$('button.full',ev.target); busy(bb,true); try{ const fotos=await subirFotos($('[name=fotos]',m2),'multas'); const t=$('[name=t]',m2).value.trim();
          await q(ds?sb.rpc('presentar_descargos',{p_id:c.id, p_texto:t, p_fotos:fotos}):sb.rpc('agregar_evidencia',{p_id:c.id, p_nota:t, p_fotos:fotos})); closeModal(); toast(ds?'Descargos registrados':'Evidencia agregada'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(bb,false); } }); } }); };
  const formCargosCaso=c=>{ const act=cat.filter(x=>!x.retirado&&!x.jpl); if(!act.length){ toast('Primero carga el catálogo de conductas (pestaña Catálogo y ajustes)'); return; }
    const m=modal(`<h3>Formular cargos · caso nº ${c.folio}</h3><form id="fFc"><label class="f"><span>Conducta del catálogo</span><select name="cat">${act.map(x=>`<option value="${x.id}">${esc(x.conducta)} · ${montoUnidad(x.monto,x.unidad)}</option>`).join('')}</select></label>
      <label class="f"><span>Unidad</span><input type="text" name="depto" list="dlFc" value="${esc(c.depto||'')}" required><datalist id="dlFc">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>
      <div id="fcProp" class="info"></div><label class="sw" id="fcEv" style="margin-bottom:10px"><input type="checkbox" name="ev"> <span></span></label>
      <label class="f"><span>Notificación de cargos (la recibe la unidad)</span><textarea name="t" style="min-height:160px" required></textarea></label>
      <p class="small muted">Al formular cargos se avisa a la unidad y empieza a correr el plazo de descargos (${Number(S.cfg?.multas?.plazo_descargos??5)} días hábiles). Imprime la notificación para entregarla a quien no use la app.</p><button class="btn full">Formular cargos</button></form>`);
    const sel=$('[name=cat]',m), tx=$('[name=t]',m); let tocado=false; tx.addEventListener('input',()=>tocado=true);
    const act2=async()=>{ const k=cat.find(x=>x.id===sel.value); if(!tocado) tx.value=(k.plantilla||'').replace(/\[Describa aquí los hechos[^\]]*\]/, c.descripcion);
      $('#fcEv',m).style.display=k.evidencia?'':'none'; $('#fcEv span',m).textContent='Se cumple la evidencia mínima: '+(k.evidencia||''); $('#fcEv input',m).checked=false;
      try{ const p=(await q(sb.rpc('propuesta_multa',{p_id:c.id, p_catalogo:k.id})))[0]; $('#fcProp',m).innerHTML=`Multa posible: <b>${montoUnidad(k.monto,k.unidad)}</b>${p?.clp?' ≈ '+clp(p.clp)+' hoy':' (falta el valor de la '+esc(k.unidad)+')'}${p?.reincidencia?`<br><b>${esc(p.motivo)}</b>: ${montoUnidad(p.monto,p.unidad)}`:''}`; }catch(err){ $('#fcProp',m).textContent=errMsg(err); } };
    sel.addEventListener('change',act2); act2();
    $('#fFc',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button.full',e.target); busy(b,true); try{ await q(sb.rpc('formular_cargos',{p_id:c.id, p_catalogo:sel.value, p_depto:$('[name=depto]',m).value.trim(), p_texto:tx.value.trim(), p_evidencia_ok:$('#fcEv input',m).checked})); closeModal(); toast('Cargos formulados y notificados'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); };
  const formResolver=async c=>{ const k=catDe(c); let p=null; try{ p=(await q(sb.rpc('propuesta_multa',{p_id:c.id, p_catalogo:c.catalogo_id})))[0]; }catch(e){}
    const m=modal(`<h3>Resolver · caso nº ${c.folio}</h3><form id="fRs"><label class="sw"><input type="radio" name="s" value="1" checked> Sancionar: ${montoUnidad(k.monto,k.unidad)}${p?.clp?' ≈ '+clp(p.clp):''}</label><label class="sw" style="margin-bottom:10px"><input type="radio" name="s" value="0"> Absolver, sin multa</label>
      ${p?.reincidencia?`<label class="sw" style="margin-bottom:10px"><input type="checkbox" name="rep" checked> ${esc(p.motivo)}: ${montoUnidad(p.monto,p.unidad)}</label>`:''}
      ${k?.permanente?`<label class="f"><span>Plazo para restituir (mientras no se restituya, la multa se repite cada mes)</span><input type="date" name="rest" min="${todayStr()}"></label>`:''}
      <label class="f"><span>Fundamentos: antecedentes considerados, incluidos los descargos</span><textarea name="t" required style="min-height:140px"></textarea></label>
      <p class="small muted">${Number(S.cfg?.multas?.aprobaciones_comite??1)>0?`Una sanción necesita ${Number(S.cfg?.multas?.aprobaciones_comite??1)} aprobación(es) del comité antes de cobrarse.`:'La sanción se cobra de inmediato en el próximo gasto común abierto.'}</p><button class="btn full">Resolver</button></form>`);
    $('#fRs',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button.full',e.target); busy(b,true); const sanc=$('[name=s]:checked',m).value==='1';
      try{ await q(sb.rpc('resolver_infraccion',{p_id:c.id, p_sancion:sanc, p_texto:$('[name=t]',m).value.trim(), p_reincidencia:!!$('[name=rep]',m)?.checked, p_restituir:$('[name=rest]',m)?.value||null})); closeModal(); toast(sanc?'Resolución registrada':'Caso absuelto'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); };
  $('#bCaso')?.addEventListener('click',()=>formCaso({},()=>listo()));
  $('#mTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#mTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  $('#mBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-caso]')) detalle(b.dataset.caso);
    else if(b=t('[data-conducta]')) formConducta(cat.find(x=>x.id===b.dataset.conducta));
    else if(t('#bConducta')) formConducta();
    else if(t('#bCatEj')){ try{ const n=await q(sb.rpc('cargar_catalogo_ejemplo')); toast(n+' conductas cargadas: revísalas con tu reglamento'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } } });
  $('#mBody').addEventListener('submit', async e=>{ e.preventDefault(); const f=e.target, d=formData(f);
    try{
      if(f.id==='fMcfg'){ const o={plazo_decision:Math.max(1,parseInt(d.plazo_decision)||5), plazo_descargos:Math.max(1,parseInt(d.plazo_descargos)||5), aprobaciones_comite:Math.max(0,parseInt(d.aprobaciones_comite)||0), destino:d.destino}; await q(T('edificios').update({multas:o}).eq('id',S.cfg.id)); S.cfg.multas=o; toast('Procedimiento guardado'); }
      else if(f.id==='fInd'){ await q(T('indicadores').upsert({codigo:d.codigo, desde:d.desde, valor:Number(d.valor)})); toast(d.codigo+' guardada'); f.reset(); }
      else if(f.id==='fFer'){ const arr=[...new Set(d.f.split(/\s+/).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort(); await q(T('edificios').update({feriados:arr}).eq('id',S.cfg.id)); S.cfg.feriados=arr; toast(arr.length+' feriados guardados'); }
      listo(); }catch(err){ toast('Error: '+errMsg(err)); } });
};

// LECTURAS de medidores individuales. Conserjería y administración las ingresan; el comité las ve.
VIEWS.lecturas = function(){
  const puede=['conserje','admin'].includes(role()); let per=monthStr(), med='', filas=[], prev={}, pub=false;
  setMain(`<h1>Lecturas de medidores</h1><div id="lcCfg"></div><div class="card" id="lcSel"></div><div id="lcBody"></div>`);
  const cfg=()=>{ const mds=medidores(); $('#lcCfg').innerHTML=isAdmin()?`<div class="row" style="margin-bottom:10px"><button class="btn sec sm" id="bMed">${mds.length?'Configurar medidores':'+ Configurar medidores'}</button></div>`:'';
    if(!mds.length){ $('#lcSel').innerHTML=`<div class="empty">${isAdmin()?'Primero define qué medidores individuales hay en el edificio (agua caliente, calefacción, gas…).':'La administración aún no configura los medidores.'}</div>`; $('#lcBody').innerHTML=''; return false; }
    if(!mds.some(x=>x.id===med)) med=mds[0].id;
    $('#lcSel').innerHTML=`<div class="row wrap"><label class="f grow" style="margin:0"><span>Período de gastos comunes</span><select id="lcPer">${opcionesMes(per)}</select></label><label class="f grow" style="margin:0"><span>Medidor</span><select id="lcMed">${mds.map(x=>`<option value="${esc(x.id)}" ${x.id===med?'selected':''}>${esc(x.nombre)} (${esc(x.unidad)})</option>`).join('')}</select></label></div>`; return true; };
  // Consumo de una fila: diferencia con el mes anterior o, si se cambió el medidor, la suma de los dos tramos
  const consumoDe=x=>x.cambio?{c:(x.fr-x.ant)+(x.act-x.ini), malo:x.fr<x.ant?'la última lectura del medidor retirado es menor que la del mes anterior':x.act<x.ini?'la lectura actual es menor que la inicial del medidor nuevo':''}
    :{c:x.act-x.ant, malo:x.act<x.ant?'la lectura actual es menor que la del mes anterior (¿se cambió el medidor?)':''};
  const leerFila=tr=>{ const d=tr.dataset.d, cb=$(`#lcTab tr[data-cd="${CSS.escape(d)}"]`), v=n=>$(`[name=${n}]`,tr)?.value.trim()??'';
    return {d, ant:prev[d]!==undefined?prev[d]:leerDec(v('ant')), hayAct:v('act')!=='', act:leerDec(v('act')), cambio:!!cb, fr:cb?leerDec($('[name=fr]',cb).value):0, hayFr:cb?$('[name=fr]',cb).value.trim()!=='':false, ini:cb?leerDec($('[name=ini]',cb).value):0}; };
  const filaCambio=(d,r={},ant=0)=>`<tr class="lcCb" data-cd="${esc(d)}"><td colspan="6" style="background:var(--p2)"><div class="row wrap" style="gap:10px;align-items:flex-end">
      <b class="small" style="align-self:center">Cambio de medidor</b>
      <label class="f" style="margin:0"><span>Última lectura del medidor retirado</span><input type="text" inputmode="decimal" data-dec name="fr" value="${r.final_retirado!=null?aDec(r.final_retirado):''}" placeholder="≥ ${esc(numCL(ant,3))}" style="width:150px;text-align:right"></label>
      <label class="f" style="margin:0"><span>Lectura inicial del medidor nuevo</span><input type="text" inputmode="decimal" data-dec name="ini" value="${aDec(r.inicial_nuevo||0)}" style="width:150px;text-align:right"></label>
      <button type="button" class="btn sec sm" data-sincambio="${esc(d)}">Quitar cambio</button></div>
      <div class="small muted" style="margin-top:6px">Consumo = (retirado − mes anterior) + (actual − inicial del nuevo). El mes siguiente parte de la lectura del medidor nuevo.</div></td></tr>`;
  const draw=()=>{ const el=$('#lcBody'); if(!el) return; const md=medidores().find(x=>x.id===med); if(!md) return;
    const us=Object.keys(S.unidades).sort(porNum), R={}; filas.forEach(f=>R[f.depto]=f);
    const cons=us.map(d=>R[d]?Number(R[d].consumo):null).filter(x=>x!=null).sort((a,b)=>a-b), med50=cons.length?cons[Math.floor(cons.length/2)]:0, tot=cons.reduce((a,b)=>a+b,0);
    const ed=puede&&!pub, primera=us.some(d=>prev[d]===undefined&&!R[d]);
    el.innerHTML=`<div class="kpi"><div class="k"><b>${filas.length} de ${us.length}</b><span>Unidades con lectura</span></div><div class="k"><b>${numCL(tot,3)} ${esc(md.unidad)}</b><span>Consumo total</span></div><div class="k"><b>${numCL(med50,3)} ${esc(md.unidad)}</b><span>Consumo típico (mediana)</span></div></div>
    ${pub?`<div class="note" style="margin-top:10px">El período ${esc(fmtMonth(per))} ya está publicado: sus lecturas no se pueden cambiar. Para corregir, la administración debe despublicarlo.</div>`:''}
    <div class="card" style="overflow:auto;margin-top:12px"><table id="lcTab"><thead><tr><th>Unidad</th><th>Propietario</th><th class="num">Mes anterior</th><th class="num">Lectura actual</th><th class="num">Consumo</th><th></th></tr></thead><tbody>${us.map(d=>{ const r=R[d], tiene=prev[d]!==undefined, ant=tiene?prev[d]:(r?Number(r.anterior):0), c=r?Number(r.consumo):null;
      const alerta=(r?.cambio?`<span class="pill in" title="Retirado: ${esc(numCL(r.final_retirado,3))} · nuevo desde ${esc(numCL(r.inicial_nuevo,3))}">Medidor cambiado</span> `:'')+(c!=null&&med50>0&&c>3*med50?'<span class="pill wa">Alto</span>':c===0?'<span class="pill mu">Sin consumo</span>':'');
      const celAnt=tiene||!ed?numCL(ant,3):`<input type="text" inputmode="decimal" data-dec name="ant" value="${aDec(ant)}" title="Primera lectura de esta unidad: el número que marcaba el medidor el mes anterior" style="width:110px;text-align:right">`;
      return `<tr data-d="${esc(d)}"><td><b>${esc(d)}</b></td><td class="small">${esc(S.unidades[d]?.prop||'')}</td><td class="num">${celAnt}${!tiene&&ed?'<div class="small muted">primera lectura</div>':''}</td><td class="num">${ed?`<input type="text" inputmode="decimal" data-dec name="act" value="${r?aDec(r.actual):''}" placeholder="—" style="width:110px;text-align:right">`:(r?numCL(r.actual,3):'—')}</td><td class="num" data-c>${c==null?'—':numCL(c,3)}</td>
        <td style="white-space:nowrap">${alerta}${ed&&!r?.cambio?` <button type="button" class="btn sec sm" data-concambio="${esc(d)}">Cambio de medidor</button>`:''}</td></tr>${ed&&r?.cambio?filaCambio(d,r,ant):''}`; }).join('')}</tbody></table></div>
    ${ed?`<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn" id="lcGuardar">Guardar lecturas</button><button class="btn sec" id="lcPegar">Pegar desde Excel</button></div><p class="small muted">Cada mes se anota el número que marca el medidor; el consumo es la diferencia con el mes anterior y nunca puede ser negativo. "Mes anterior" sale solo de la lectura del período previo${primera?'; solo la primera lectura de una unidad se ingresa a mano':''}. Si se cambió el medidor de una unidad, usa "Cambio de medidor" e indica la última lectura del retirado y la inicial del nuevo. Las unidades sin lectura pagan solo la parte fija del ítem.</p>`:''}`; };
  const recalcFila=d=>{ const tr=$(`#lcTab tr[data-d="${CSS.escape(d)}"]`); if(!tr) return; const x=leerFila(tr), cel=$('[data-c]',tr);
    if(!x.hayAct||(x.cambio&&!x.hayFr)){ cel.textContent='—'; cel.style.color=''; cel.title=''; return; }
    const {c,malo}=consumoDe(x); cel.textContent=numCL(c,3); cel.style.color=malo?'var(--er)':''; cel.title=malo; };

  const cargar=async()=>{ if(!cfg()) return; const [f,p,g]=await Promise.all([q(T('lecturas').select('*').eq('periodo',per).eq('medidor',med)), q(T('lecturas').select('depto,periodo,actual').eq('medidor',med).lt('periodo',per).order('periodo',{ascending:true})), q(T('gastos').select('publicado').eq('periodo',per)).catch(()=>[])]);
    filas=f; prev={}; p.forEach(x=>prev[x.depto]=Number(x.actual)); pub=!!g[0]?.publicado; draw(); };
  const w=watch(['lecturas','gastos','edificios'], async()=>true, ()=>{ if(!$('.modal')&&!document.activeElement?.closest?.('#lcTab')) cargar(); }, {silent:true});
  $('#lcSel').addEventListener('change',e=>{ if(e.target.id==='lcPer') per=e.target.value||monthStr(); if(e.target.id==='lcMed') med=e.target.value; cargar(); });
  $('#lcBody').addEventListener('input',e=>{ const tr=e.target.closest('tr[data-d],tr[data-cd]'); if(tr) recalcFila(tr.dataset.d||tr.dataset.cd); });
  $('#lcBody').addEventListener('click', async e=>{
    const cc=e.target.closest('[data-concambio]'), sc=e.target.closest('[data-sincambio]');
    if(cc){ const d=cc.dataset.concambio, tr=cc.closest('tr'); cc.remove(); tr.insertAdjacentHTML('afterend', filaCambio(d,{},prev[d]??leerDec($('[name=ant]',tr)?.value))); $(`#lcTab tr[data-cd="${CSS.escape(d)}"] [name=fr]`)?.focus(); recalcFila(d); return; }
    if(sc){ const d=sc.dataset.sincambio; sc.closest('tr').remove(); const tr=$(`#lcTab tr[data-d="${CSS.escape(d)}"]`); tr?.lastElementChild.insertAdjacentHTML('beforeend',` <button type="button" class="btn sec sm" data-concambio="${esc(d)}">Cambio de medidor</button>`); recalcFila(d); return; }
    if(e.target.id==='lcGuardar'){ const b=e.target, xs=$$('#lcTab tr[data-d]').map(leerFila).filter(x=>x.hayAct);
      const sinFr=xs.filter(x=>x.cambio&&!x.hayFr); if(sinFr.length){ toast('Falta la última lectura del medidor retirado en: '+sinFr.map(x=>x.d).join(', ')); return; }
      const malas=xs.filter(x=>consumoDe(x).malo); if(malas.length){ toast('Consumo negativo en '+malas.map(x=>x.d).join(', ')+': '+consumoDe(malas[0]).malo); return; }
      const rows=xs.map(x=>({periodo:per, medidor:med, depto:x.d, anterior:x.ant, actual:x.act, cambio:x.cambio, final_retirado:x.cambio?x.fr:null, inicial_nuevo:x.cambio?x.ini:0}));
      if(!rows.length){ toast('No hay lecturas para guardar'); return; } busy(b,true);
      try{ await q(T('lecturas').upsert(rows)); toast(rows.length+' lecturas guardadas'); await cargar(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }
    if(e.target.id==='lcPegar'){ const t=await askText('Pega dos columnas: unidad y lectura actual (una unidad por línea, separadas por tabulación, punto y coma o espacio)'); if(!t) return; let n=0, no=[];
      t.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{ const [d,v]=l.split(/[\t;]+|\s+/); const tr=$(`#lcTab tr[data-d="${CSS.escape(String(d||'').trim())}"]`), x=leerDec(v); if(tr&&v!==undefined&&/\d/.test(v)){ $('[name=act]',tr).value=aDec(x); tr.querySelector('[name=act]').dispatchEvent(new Event('input',{bubbles:true})); n++; } else no.push(d); });
      toast(`${n} lecturas cargadas${no.length?' · no reconocidas: '+no.slice(0,5).join(', '):''}. Revisa y guarda.`); } });
  $('#lcCfg').addEventListener('click', e=>{ if(e.target.id==='bMed') formMedidores(()=>cargar()); });
  cargar();
};
function formMedidores(listo){
  const ya=medidores(); const m=modal(`<h3>Medidores individuales</h3><p class="small muted">Los tipos de medidor que tiene cada unidad. Con sus lecturas se reparten los ítems del gasto común "según consumo".</p><form id="fMd"><div id="mdL"></div><button type="button" class="btn sec sm" id="mdAdd">+ Medidor</button>
    <div class="small muted" style="margin:10px 0 4px">Agregar rápido:</div><div class="row wrap" style="gap:6px">${MEDIDORES_EJ.map(x=>`<button type="button" class="btn sec sm" data-ej="${x.id}">${esc(x.nombre)}</button>`).join('')}</div>
    <button class="btn full" style="margin-top:12px">Guardar</button></form>`);
  const fila=(x={})=>{ const d=document.createElement('div'); d.className='row md'; d.style.marginBottom='6px'; d.dataset.id=x.id||''; d.innerHTML=`<input type="text" name="n" placeholder="Nombre, ej: Agua caliente" value="${esc(x.nombre||'')}" style="flex:2" required><input type="text" name="u" placeholder="Unidad, ej: m³" value="${esc(x.unidad||'')}" style="flex:1" required><button type="button" class="btn sec sm" data-q>✕</button>`; $('#mdL',m).appendChild(d); };
  ya.forEach(fila); $('#mdAdd',m).addEventListener('click',()=>fila());
  m.addEventListener('click',e=>{ const q1=e.target.closest('[data-q]'), ej=e.target.closest('[data-ej]'); if(q1) q1.closest('.md').remove(); if(ej){ const x=MEDIDORES_EJ.find(y=>y.id===ej.dataset.ej); if(!$$('.md',m).some(r=>r.dataset.id===x.id)) fila(x); } });
  $('#fMd',m).addEventListener('submit', async e=>{ e.preventDefault(); const usados=new Set(); const arr=$$('.md',m).map(r=>{ let id=r.dataset.id||seg($('[name=n]',r).value).toLowerCase(); while(usados.has(id)) id+='_2'; usados.add(id); return {id, nombre:$('[name=n]',r).value.trim(), unidad:$('[name=u]',r).value.trim()}; }).filter(x=>x.nombre);
    try{ await q(T('edificios').update({medidores:arr}).eq('id',S.cfg.id)); S.cfg.medidores=arr; closeModal(); toast('Medidores guardados'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); } });
}


// FINANZAS: pagos registrados por la administración, convenios de pago, estado económico y caja.
// Los montos pagados, los estados y las cuotas los calcula la base de datos (privado.recalc_unidad).
const MEDIOS={transferencia:'Transferencia', efectivo:'Efectivo', cheque:'Cheque', otro:'Otro', condonacion:'Condonación (no es un ingreso)'};
const enCaja=p=>!p.anulado&&p.medio!=='condonacion';   // una condonación de intereses queda registrada, pero no es plata recibida
const txtMora=()=>Number(S.cfg?.mora_tasa)>0?`Los cobros vencidos generan un interés por mora de ${Number(S.cfg.mora_tasa).toLocaleString('es-CL')}% mensual, calculado por día sobre el saldo impago.`:'';
const EST_CONV={propuesto:['Por aceptar','wa'], vigente:['Vigente','in'], cumplido:['Cumplido','ok'], anulado:['Anulado','mu']};
const porDepto=(a,b)=>a.depto.localeCompare(b.depto,undefined,{numeric:true});
const estadoCobro=p=>p.pagado?'<span class="pill ok">Pagado</span>':p.convenio_id?'<span class="pill in">En convenio</span>':Number(p.pagado_monto)>0?`<span class="pill wa">Abonado ${clp(p.pagado_monto)}</span>`:'<span class="pill wa">Pendiente</span>';
const pillConv=c=>c.estado==='vigente'&&c.atraso>0?'<span class="pill er">Atrasado</span>':pillOf(EST_CONV,c.estado);
// Arma el estado por unidad: deuda total, vencida y en convenio. `depto` limita la consulta a una unidad.
async function finDatos(depto){
  const de=t=>{ const x=T(t).select('*'); return q(depto?x.eq('depto',depto):x); };
  const [gastos,gu,pagos,convs,cuotas,ints]=await Promise.all([q(T('gastos').select('*')), de('gasto_unidades'), de('pagos'), de('convenios'), de('convenio_cuotas'), q(sb.rpc('intereses_mora')).catch(()=>[])]);
  const I={}; ints.forEach(x=>I[x.depto+'|'+x.periodo]=Math.max(0,Number(x.interes)-Number(x.pagado)));
  const hoy=todayStr(), G={}, C={}, U={}; gastos.forEach(g=>G[g.periodo]=g);
  convs.forEach(c=>C[c.id]={...c, lista:[]}); cuotas.forEach(k=>C[k.convenio_id]?.lista.push(k));
  Object.values(C).forEach(c=>{ c.lista.sort((a,b)=>a.n-b.n); const falta=k=>Number(k.monto)-Number(k.pagado_monto);
    c.abonado=c.lista.reduce((a,k)=>a+Number(k.pagado_monto),0); c.saldo=Number(c.monto_total)-c.abonado; c.prox=c.lista.find(k=>falta(k)>0);
    c.atraso=c.estado==='vigente'?c.lista.filter(k=>k.vence<hoy&&falta(k)>0).reduce((a,k)=>a+falta(k),0):0; });
  const u=d=>U[d]=U[d]||{depto:d, deuda:0, vencido:0, convenio:0, interes:0, rows:[], convs:[]};
  gu.forEach(x=>{ const g=G[x.periodo]; if(!g||!g.publicado) return; const c=C[x.convenio_id]; const enConvenio=!!c&&['propuesto','vigente'].includes(c.estado);
    const saldo=x.pagado?0:Math.max(0,Number(x.monto)-Number(x.pagado_monto||0)); const z=u(x.depto), int=I[x.depto+'|'+x.periodo]||0; z.rows.push({...x, saldo, int, vence:g.vence, enConvenio}); z.deuda+=saldo; z.interes+=int;
    if(enConvenio&&c.estado==='vigente') z.convenio+=saldo; else if(saldo>0&&g.vence&&g.vence<hoy) z.vencido+=saldo; });
  Object.values(C).forEach(c=>{ const z=u(c.depto); z.convs.push(c); z.vencido+=c.atraso; });
  Object.values(U).forEach(z=>{ z.rows.sort((a,b)=>a.periodo<b.periodo?-1:1); z.convs.sort((a,b)=>a.ts<b.ts?1:-1); });
  return {gastos, pagos:sortBy(pagos,p=>p.fecha+p.ts,true), G, C, U};
}
async function formPago(pre={}){
  let D; try{ D=await finDatos(); }catch(err){ toast('Error: '+errMsg(err)); return; }
  const us=Object.values(D.U).filter(z=>z.deuda>0||z.interes>0).sort(porDepto);
  if(!us.length){ toast('No hay unidades con deuda'); return; }
  const destinos=d=>{ const z=D.U[d]; if(!z) return []; return [...z.rows.filter(r=>r.saldo>0&&!r.enConvenio).map(r=>({v:'p:'+r.periodo, t:`Gastos comunes ${fmtMonth(r.periodo)} · saldo ${clp(r.saldo)}`, m:r.saldo})),
    ...z.rows.filter(r=>r.int>0).map(r=>({v:'i:'+r.periodo, t:`Interés por mora ${fmtMonth(r.periodo)} · ${clp(r.int)}`, m:r.int})),
    ...z.convs.filter(c=>c.estado==='vigente'&&c.saldo>0).map(c=>({v:'c:'+c.id, t:`Convenio de pago · saldo ${clp(c.saldo)}${c.prox?' · cuota '+c.prox.n+' vence '+fmtDay(c.prox.vence):''}`, m:c.prox?Number(c.prox.monto)-Number(c.prox.pagado_monto):c.saldo, max:c.saldo}))]; };
  const m=modal(`<h3>Registrar pago</h3><form id="fPg"><label class="f"><span>Unidad</span><select name="depto" required>${us.map(z=>`<option value="${esc(z.depto)}" ${pre.depto===z.depto?'selected':''}>Depto ${esc(z.depto)} · debe ${clp(z.deuda+z.interes)}</option>`).join('')}</select></label>
  <label class="f"><span>Se aplica a</span><select name="dest" required></select></label>
  <div class="row"><label class="f grow"><span>Monto recibido</span><input type="text" inputmode="numeric" data-clp name="monto" required></label><label class="f grow"><span>Fecha del pago</span><input type="date" name="fecha" value="${todayStr()}" max="${todayStr()}" required></label></div>
  <div class="row"><label class="f grow"><span>Medio</span><select name="medio">${Object.entries(MEDIOS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="f grow"><span>N° de comprobante</span><input type="text" name="referencia" placeholder="Opcional"></label></div>
  <label class="f"><span>Nota</span><input type="text" name="nota" placeholder="Opcional"></label><p class="small muted" id="pgAyuda"></p><button class="btn full">Registrar pago</button></form>`);
  const sD=$('[name=depto]',m), sX=$('[name=dest]',m), iM=$('[name=monto]',m); let ds=[];
  const monto=()=>{ const x=ds.find(d=>d.v===sX.value); if(!x) return; iM.value=aMonto(x.m); $('#pgAyuda',m).textContent='Puede ser un abono parcial. Máximo '+clp(x.max||x.m)+'.'+(x.v[0]==='i'?' Para perdonar el interés, elige el medio «Condonación»: queda registrado y no entra al flujo de caja.':''); };
  const dest=()=>{ ds=destinos(sD.value); sX.innerHTML=ds.map(d=>`<option value="${esc(d.v)}">${esc(d.t)}</option>`).join('')||'<option value="">— Esta unidad no tiene cobros que admitan pago —</option>';
    const p=pre.convenio?'c:'+pre.convenio:pre.periodo?'p:'+pre.periodo:''; if(sD.value===pre.depto&&ds.some(d=>d.v===p)) sX.value=p; monto(); };
  sD.addEventListener('change',dest); sX.addEventListener('change',monto); dest();
  $('#fPg',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); if(!d.dest) return; const [k,id]=[d.dest[0], d.dest.slice(2)]; if(d.medio==='condonacion'&&k!=='i'){ toast('Solo se pueden condonar intereses por mora'); return; } busy(b,true);
    try{ await q(T('pagos').insert({depto:d.depto, periodo:k==='c'?null:id, convenio_id:k==='c'?id:null, concepto:k==='i'?'interes':'gasto', monto:Number(d.monto), fecha:d.fecha, medio:d.medio, referencia:d.referencia.trim(), nota:d.nota.trim()})); closeModal(); toast('Pago registrado'); pre.listo?.(); }
    catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
async function formConvenio(depto, listo){
  let D; try{ D=await finDatos(depto); }catch(err){ toast('Error: '+errMsg(err)); return; }
  const rows=(D.U[depto]?.rows||[]).filter(r=>r.saldo>0&&!r.enConvenio); if(!rows.length){ toast('Esa unidad no tiene cobros pendientes fuera de convenio'); return; }
  const hoy=todayStr(); const p1=new Date(); p1.setDate(p1.getDate()+30);
  const m=modal(`<h3>Convenio de pago · Depto ${esc(depto)}</h3><p class="small muted">Acuerdo para saldar cobros atrasados en cuotas mensuales. Queda propuesto hasta que la unidad lo acepte en la app o registres su aceptación.</p><form id="fCv">
  <div class="small" style="font-weight:600;margin-bottom:6px">Cobros incluidos</div>${rows.map(r=>`<label class="sw" style="margin-bottom:6px"><input type="checkbox" name="per" value="${esc(r.periodo)}" data-s="${r.saldo}" ${r.vence&&r.vence<hoy?'checked':''}> ${esc(fmtMonth(r.periodo))} · ${clp(r.saldo)}${r.vence&&r.vence<hoy?' <span class="pill er">vencido</span>':''}</label>`).join('')}
  <div class="row" style="margin-top:10px"><label class="f grow"><span>Número de cuotas</span><input type="number" name="cuotas" min="1" max="60" value="3" required></label><label class="f grow"><span>Vence la primera cuota</span><input type="date" name="primera" value="${p1.toISOString().slice(0,10)}" min="${hoy}" required></label></div>
  <label class="f"><span>Condiciones (opcional)</span><textarea name="nota" placeholder="Ej: no incluye el gasto común del mes en curso, que debe pagarse en su fecha."></textarea></label>
  <div class="info" id="cvRes"></div><button class="btn full">Proponer convenio</button></form>`);
  const sel=()=>$$('[name=per]:checked',m); const calc=()=>{ const t=sel().reduce((a,c)=>a+Number(c.dataset.s),0), n=Math.max(1,Math.floor(Number($('[name=cuotas]',m).value))||1); $('#cvRes',m).textContent=t?`Total ${clp(t)} en ${n} ${n===1?'cuota':'cuotas mensuales'} de ${clp(Math.floor(t/n))}.`:'Elige al menos un cobro.'; };
  m.addEventListener('input',calc); calc();
  $('#fCv',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const per=sel().map(c=>c.value); if(!per.length){ toast('Elige al menos un cobro'); return; } const b=$('button',e.target); busy(b,true);
    try{ await q(sb.rpc('crear_convenio',{p_depto:depto, p_periodos:per, p_cuotas:Math.floor(Number(d.cuotas)), p_primera:d.primera, p_nota:d.nota.trim()})); closeModal(); toast('Convenio propuesto'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
function detalleConvenio(c, listo){
  const adm=isAdmin(), mio=['residente','propietario'].includes(role())&&c.depto===myDepto(), hoy=todayStr();
  const m=modal(`<h3>Convenio de pago · Depto ${esc(c.depto)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillConv(c)}<b>${clp(c.monto_total)}</b><span class="muted small">abonado ${clp(c.abonado)} · saldo ${clp(c.saldo)}</span></div>
  <div class="small muted">Incluye: ${c.periodos.map(p=>esc(fmtMonth(p))).join(', ')} · propuesto ${fmtDate(c.ts)}${c.aceptado_at?' · aceptado '+fmtDate(c.aceptado_at)+' por '+esc(userName(c.aceptado_por)):''}${c.anulado_at?' · anulado '+fmtDate(c.anulado_at)+(c.anulado_motivo?': '+esc(c.anulado_motivo):''):''}</div>
  ${c.nota?`<p style="white-space:pre-wrap">${esc(c.nota)}</p>`:''}
  <table style="margin-top:8px"><thead><tr><th>Cuota</th><th>Vence</th><th class="num">Monto</th><th class="num">Pagado</th><th></th></tr></thead><tbody>${c.lista.map(k=>{ const ok=Number(k.pagado_monto)>=Number(k.monto); return `<tr><td>${k.n} de ${c.cuotas}</td><td>${fmtDay(k.vence)}</td><td class="num">${clp(k.monto)}</td><td class="num">${clp(k.pagado_monto)}</td><td>${ok?'<span class="pill ok">Pagada</span>':c.estado==='vigente'&&k.vence<hoy?'<span class="pill er">Atrasada</span>':'<span class="pill mu">Pendiente</span>'}</td></tr>`; }).join('')}</tbody></table>
  ${c.estado==='propuesto'&&mio?'<div class="info" style="margin-top:10px">Al aceptar, tu unidad se compromete a pagar estas cuotas en sus fechas, además de los gastos comunes de cada mes.</div>':''}
  <div class="row wrap" style="justify-content:flex-end;margin-top:12px">${c.estado==='propuesto'&&(adm||mio)?`<button class="btn ok" id="cvOk">${mio?'Aceptar convenio':'Registrar aceptación'}</button>`:''}${c.estado==='vigente'&&adm?'<button class="btn" id="cvPago">Registrar pago</button>':''}${(['propuesto','vigente'].includes(c.estado)&&adm)||(c.estado==='propuesto'&&mio)?`<button class="btn dan" id="cvNo">${mio?'Rechazar':'Anular'}</button>`:''}<button class="btn sec" data-close>Cerrar</button></div>`);
  $('#cvOk',m)?.addEventListener('click', async()=>{ try{ await q(sb.rpc('aceptar_convenio',{p_id:c.id})); closeModal(); toast('Convenio aceptado'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#cvPago',m)?.addEventListener('click',()=>formPago({depto:c.depto, convenio:c.id, listo}));
  $('#cvNo',m)?.addEventListener('click', async()=>{ const mot=await askText(mio?'¿Por qué rechazas el convenio? (opcional)':'Motivo de la anulación'); if(mot===null) return; try{ await q(sb.rpc('anular_convenio',{p_id:c.id, p_motivo:mot})); toast(mio?'Convenio rechazado':'Convenio anulado'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); } });
}
// Cargo individual (multa, arriendo, otro) a una unidad, en el primer período no publicado salvo que se elija otro
async function formCargo(pre={}, listo){
  let gs=[]; try{ gs=await q(T('gastos').select('periodo,publicado')); }catch(e){}
  const pub=new Set(gs.filter(x=>x.publicado).map(x=>x.periodo)); let p=monthStr(); for(let k=0;k<36&&pub.has(p);k++){ const [y,mm]=p.split('-').map(Number); const d=new Date(y,mm,1); p=d.getFullYear()+'-'+pad(d.getMonth()+1); }
  const m=modal(`<h3>Nuevo cargo</h3><form id="fCg"><div class="row"><label class="f grow"><span>Unidad</span><input type="text" name="depto" list="dlCg" value="${esc(pre.depto||'')}" required><datalist id="dlCg">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f grow"><span>Tipo</span><select name="tipo">${Object.entries(TIPO_CARGO).filter(([k])=>k!=='multa').map(([k,v])=>`<option value="${k}" ${pre.tipo===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <label class="f"><span>Detalle</span><input type="text" name="descripcion" value="${esc(pre.descripcion||'')}" placeholder="Ej: ruidos molestos 12-11, art. 15 del reglamento" required></label>
    <div class="row"><label class="f grow"><span>Monto</span><input type="text" inputmode="numeric" data-clp name="monto" value="${pre.monto||''}" required></label><label class="f grow"><span>Se cobra en el gasto común de</span><select name="periodo" required>${opcionesMes(p,{min:p,atras:0,adelante:24})}</select></label></div>
    <p class="small muted">Se suma al cobro de la unidad en ese período. Solo se pueden usar períodos aún no publicados. Las multas no se cargan aquí: se aplican desde un caso en <a href="#multas">Multas</a>, con cargos, descargos y resolución.</p><button class="btn full">Registrar cargo</button></form>`);
  $('#fCg',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); if(!S.unidades[d.depto.trim()]){ toast('Esa unidad no existe'); return; } const b=$('button.full',e.target); busy(b,true);
    try{ await q(T('cargos').insert({depto:d.depto.trim(), tipo:d.tipo, descripcion:d.descripcion.trim(), monto:Number(d.monto), periodo:d.periodo})); closeModal(); toast('Cargo registrado'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
const filaPago=(p,conDepto)=>`<div class="item static"><div class="hd"><b>${conDepto?'Depto '+esc(p.depto)+' · ':''}${clp(p.monto)}</b><span class="row" style="gap:4px">${p.anulado?'<span class="pill er">Anulado</span>':''}<span class="muted small">${fmtDay(p.fecha)}</span></span></div><div class="meta">${p.periodo?(p.concepto==='interes'?'Interés por mora ':'Gastos comunes ')+esc(fmtMonth(p.periodo)):'Convenio de pago'} · ${esc(MEDIOS[p.medio]||p.medio)}${p.referencia?' · comprobante '+esc(p.referencia):''}${p.nota?' · '+esc(p.nota):''}${p.anulado&&p.anulado_motivo?' · anulado: '+esc(p.anulado_motivo):''}</div>${conDepto&&isAdmin()&&!p.anulado?`<div class="row acc"><button class="btn sec sm" data-anular="${p.id}">Anular pago</button></div>`:''}</div>`;
// Estado de cuenta de la unidad, bajo los gastos comunes del residente
function cuentaResidente(){
  let D=null; const w=watch(['gasto_unidades','pagos','convenios','convenio_cuotas'], ()=>finDatos(myDepto()), d=>{ D=d; const el=$('#gCuenta'); if(!el) return; const z=D.U[myDepto()]||{deuda:0,vencido:0,convenio:0,interes:0,rows:[],convs:[]}; const pend=z.rows.filter(r=>r.saldo>0||r.int>0);
    el.innerHTML=`<h2>Estado de cuenta · Depto ${esc(myDepto())}</h2><div class="kpi"><div class="k"><b>${clp(z.deuda)}</b><span>Saldo por pagar</span></div><div class="k"><b style="color:${z.vencido?'var(--er)':'inherit'}">${clp(z.vencido)}</b><span>Vencido</span></div><div class="k"><b>${clp(z.convenio)}</b><span>En convenio</span></div>${z.interes?`<div class="k"><b style="color:var(--er)">${clp(z.interes)}</b><span>Intereses por mora</span></div>`:''}</div>
    ${txtMora()?`<p class="small muted" style="margin-top:8px">${esc(txtMora())}</p>`:''}
    ${z.convs.some(c=>c.estado==='propuesto')?'<div class="note" style="margin-top:12px">La administración te propuso un convenio de pago. Revísalo y acéptalo o recházalo.</div>':''}
    ${pend.length?`<div class="card" style="margin-top:12px"><table><thead><tr><th>Período</th><th>Vence</th><th class="num">Monto</th><th class="num">Saldo</th>${z.interes?'<th class="num">Interés</th>':''}<th></th></tr></thead><tbody>${pend.map(r=>`<tr><td>${esc(fmtMonth(r.periodo))}</td><td>${r.vence?fmtDay(r.vence):'—'}</td><td class="num">${clp(r.monto)}</td><td class="num">${clp(r.saldo)}</td>${z.interes?`<td class="num">${r.int?clp(r.int):'—'}</td>`:''}<td>${!r.saldo?'<span class="pill wa">Interés pendiente</span>':r.enConvenio?'<span class="pill in">En convenio</span>':r.vence&&r.vence<todayStr()?'<span class="pill er">Vencido</span>':'<span class="pill wa">Pendiente</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="small muted" style="margin-top:10px">Tu unidad está al día.</p>'}
    ${z.convs.length?`<h2>Convenios de pago</h2><div class="list">${z.convs.map(c=>`<div class="item" data-cv="${c.id}"><div class="hd"><b>${clp(c.monto_total)} en ${c.cuotas} ${c.cuotas===1?'cuota':'cuotas'}</b>${pillConv(c)}</div><div class="meta">Abonado ${clp(c.abonado)} · saldo ${clp(c.saldo)}${c.estado==='vigente'&&c.prox?' · próxima cuota '+clp(Number(c.prox.monto)-Number(c.prox.pagado_monto))+' vence '+fmtDay(c.prox.vence):''}</div></div>`).join('')}</div>`:''}
    <h2>Pagos registrados</h2><div class="list">${D.pagos.slice(0,24).map(p=>filaPago(p,false)).join('')||'<div class="empty">Aún no hay pagos registrados</div>'}</div><p class="small muted">Los pagos los registra la administración al recibirlos. Si falta alguno, escríbele por Mensajes con el comprobante.</p>`; }, {silent:true});
  $('#gCuenta').addEventListener('click',e=>{ const it=e.target.closest('[data-cv]'); if(it&&D?.C[it.dataset.cv]) detalleConvenio(D.C[it.dataset.cv], w.reload); });
}
VIEWS.finanzas = function(param){
  const adm=isAdmin(); const TABS={estado:'Estado',pagos:'Pagos',convenios:'Convenios',cargos:'Cargos',fondos:'Fondos',caja:'Flujo de caja'};
  let tab=TABS[param]?param:'estado', D=null, movs=[], anio=new Date().getFullYear(), cargos=[], fondos=[], fmov=[], saldos=[], verAnul=false;
  setMain(`<h1>Finanzas</h1><div class="tabs" id="fTabs">${Object.entries(TABS).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="fBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['gastos','gasto_unidades','pagos','convenios','convenio_cuotas','caja_movimientos','cargos','fondos','fondo_movimientos'], async()=>{ const [d,mv,cg,fo,fm,sd]=await Promise.all([finDatos(), q(T('caja_movimientos').select('*').order('fecha',{ascending:false}).limit(5000)), q(T('cargos').select('*').order('ts',{ascending:false}).limit(2000)), q(T('fondos').select('*').order('creado')), q(T('fondo_movimientos').select('*').order('fecha',{ascending:false}).limit(2000)), q(sb.rpc('saldos_fondos')).catch(()=>[])]); return {d,mv,cg,fo,fm,sd}; },
    ({d,mv,cg,fo,fm,sd})=>{ D=d; movs=mv; cargos=cg; fondos=fo; fmov=fm; saldos=sd; if(!$('.modal')) draw(); });
  const listo=()=>w.reload();
  // Flujo de caja: ingresos por gastos comunes (pagos vigentes) + otros movimientos, por mes
  const caja=()=>{ const M={}; const mes=k=>M[k]=M[k]||{gc:0, otros:0, egresos:0}; D.pagos.filter(p=>enCaja(p)).forEach(p=>mes(p.fecha.slice(0,7)).gc+=Number(p.monto)); movs.forEach(x=>{ mes(x.fecha.slice(0,7))[x.tipo==='egreso'?'egresos':'otros']+=Number(x.monto); });
    let acum=0; const out={}; Object.keys(M).sort().forEach(k=>{ const x=M[k]; x.neto=x.gc+x.otros-x.egresos; acum+=x.neto; x.acum=acum; out[k]=x; }); return out; };
  const filasAnio=()=>{ const M=caja(); let previo=0; Object.keys(M).forEach(k=>{ if(k<anio+'-01') previo=M[k].acum; }); let ac=previo;
    return {previo, filas:Array.from({length:12},(_,i)=>{ const k=anio+'-'+pad(i+1), x=M[k]||{gc:0,otros:0,egresos:0,neto:0}; ac+=x.neto; return {k, ...x, acum:ac}; })}; };
  const draw=()=>{ const el=$('#fBody'); if(!el||!D) return; const us=Object.values(D.U).sort(porDepto);
    if(tab==='estado'){ const deu=us.filter(z=>z.deuda>0||z.interes>0).sort((a,b)=>b.vencido-a.vencido||b.deuda-a.deuda); const mes=monthStr(); const tot=k=>us.reduce((a,z)=>a+z[k],0);
      el.innerHTML=`<div class="kpi"><div class="k"><b>${clp(tot('deuda'))}</b><span>Por cobrar</span></div><div class="k"><b style="color:${tot('vencido')?'var(--er)':'inherit'}">${clp(tot('vencido'))}</b><span>Vencido</span></div><div class="k"><b>${clp(tot('convenio'))}</b><span>En convenio</span></div>${tot('interes')?`<div class="k"><b>${clp(tot('interes'))}</b><span>Intereses por mora</span></div>`:''}<div class="k"><b>${us.filter(z=>z.vencido>0).length}</b><span>Unidades morosas</span></div><div class="k"><b>${clp(D.pagos.filter(p=>enCaja(p)&&p.fecha.slice(0,7)===mes).reduce((a,p)=>a+Number(p.monto),0))}</b><span>Recaudado en ${esc(fmtMonth(mes))}</span></div></div>
      <h2>Unidades con deuda</h2><div class="card" style="overflow:auto"><table><thead><tr><th>Unidad</th><th>Propietario</th><th class="num">Deuda</th><th class="num">Vencido</th><th class="num">Interés</th><th class="num">Cobros</th><th>Convenio</th><th></th></tr></thead><tbody>${deu.map(z=>{ const c=z.convs.find(x=>['propuesto','vigente'].includes(x.estado)); return `<tr><td><b>${esc(z.depto)}</b></td><td>${esc(S.unidades[z.depto]?.prop||'')}</td><td class="num">${clp(z.deuda)}</td><td class="num" style="color:${z.vencido?'var(--er)':'inherit'}">${clp(z.vencido)}</td><td class="num">${z.interes?clp(z.interes):'—'}</td><td class="num">${z.rows.filter(r=>r.saldo>0).length}</td><td>${c?`<a href="#" data-cv="${c.id}">${pillConv(c)}</a>`:'—'}</td><td style="white-space:nowrap">${adm?`<button class="btn sec sm" data-pago="${esc(z.depto)}">Pago</button> ${z.rows.some(r=>r.saldo>0&&!r.enConvenio)?`<button class="btn sec sm" data-conv="${esc(z.depto)}">Convenio</button>`:''}`:''}</td></tr>`; }).join('')||'<tr><td colspan="8" class="muted">Ninguna unidad tiene deuda 🎉</td></tr>'}</tbody></table></div>
      <p class="small muted">"Vencido" suma los cobros pasados de su fecha que no están en un convenio vigente, más las cuotas de convenio atrasadas. Solo cuentan los períodos publicados. ${Number(S.cfg?.mora_tasa)>0?esc(txtMora())+' El interés se muestra aparte de la deuda; se paga o se condona desde "Pago". Mientras un cobro está en convenio, deja de sumar.':'No se cobra interés por mora: la tasa se define en Administración → Edificio.'}</p>`; }
    else if(tab==='cargos'){ const cs=cargos.filter(c=>verAnul||c.estado==='vigente');
      el.innerHTML=`<div class="row wrap" style="margin-bottom:10px">${adm?'<button class="btn" id="bCargo">+ Nuevo cargo</button>':''}<label class="sw small"><input type="checkbox" id="cgAnul" ${verAnul?'checked':''}> Mostrar anulados</label></div>
      <div class="kpi"><div class="k"><b>${clp(cargos.filter(c=>c.estado==='vigente'&&c.tipo==='multa').reduce((a,c)=>a+Number(c.monto),0))}</b><span>Multas vigentes</span></div><div class="k"><b>${clp(cargos.filter(c=>c.estado==='vigente'&&c.tipo==='arriendo').reduce((a,c)=>a+Number(c.monto),0))}</b><span>Arriendos</span></div><div class="k"><b>${clp(cargos.filter(c=>c.estado==='anulado'||Number(c.monto)<Number(c.monto_original)).reduce((a,c)=>a+Number(c.monto_original)-(c.estado==='anulado'?0:Number(c.monto)),0))}</b><span>Condonado o rebajado</span></div></div>
      <div class="list" style="margin-top:12px">${cs.map(c=>`<div class="item static"><div class="hd"><b>Depto ${esc(c.depto)} · ${esc(TIPO_CARGO[c.tipo])} · ${clp(c.estado==='anulado'?c.monto_original:c.monto)}</b><span class="row" style="gap:4px">${c.estado==='anulado'?'<span class="pill mu">Anulado</span>':Number(c.monto)<Number(c.monto_original)?'<span class="pill wa">Rebajado</span>':''}<span class="muted small">${esc(fmtMonth(c.periodo))}</span></span></div>
        <div class="meta">${esc(c.descripcion||'')}${c.descripcion?' · ':''}se cobra en el gasto común de ${esc(fmtMonth(c.periodo))}${Number(c.monto)<Number(c.monto_original)&&c.estado!=='anulado'?' · rebajado desde '+clp(c.monto_original):''}${c.motivo?' · motivo: '+esc(c.motivo):''}</div>${adm&&c.estado==='vigente'?`<div class="row acc"><button class="btn sec sm" data-rebajar="${c.id}">Rebajar</button><button class="btn sec sm" data-anularc="${c.id}">Anular</button></div>`:''}</div>`).join('')||'<div class="empty">Sin cargos</div>'}</div>
      <p class="small muted">Multas (aplicadas desde un caso en Multas), arriendo de espacios comunes y otros cobros a una unidad. Se suman a su gasto común del período indicado. El arriendo de un espacio con costo se carga solo al aprobarse la reserva, y se anula si se cancela. Un cargo no se borra: se rebaja o se anula (condonación) con un motivo, y queda el registro.</p>`; }
    else if(tab==='fondos'){ const sd=id=>saldos.find(x=>x.fondo_id===id)||{aportes:0,usos:0,ajustes:0,saldo:0};
      el.innerHTML=`${adm?'<div style="margin-bottom:10px"><button class="btn" id="bFondo">+ Nuevo fondo</button></div>':''}
      ${!fondos.some(f=>f.reserva)?`<div class="note" style="margin-bottom:10px">No hay un fondo común de reserva. La Ley de Copropiedad Inmobiliaria exige formarlo con un recargo sobre los gastos comunes; el porcentaje lo fija el reglamento dentro del mínimo legal.${adm?' Créalo con "+ Nuevo fondo" y márcalo como fondo de reserva.':''}</div>`:''}
      <div class="list">${fondos.map(f=>{ const x=sd(f.id); return `<div class="item" data-fondo="${f.id}"><div class="hd"><b>${esc(f.nombre)}</b><span class="row" style="gap:4px">${f.reserva?'<span class="pill in">Reserva legal</span>':''}${f.activo?'':'<span class="pill mu">Inactivo</span>'}<b>${clp(x.saldo)}</b></span></div><div class="meta">Saldo inicial ${clp(f.saldo_inicial)} · aportes ${clp(x.aportes)} · usos ${clp(x.usos)}${Number(x.ajustes)?' · ajustes '+clp(x.ajustes):''}${Number(f.pct)>0?' · aporte sugerido '+numCL(f.pct,2)+' %':''}</div></div>`; }).join('')||'<div class="empty">Sin fondos</div>'}</div>
      <p class="small muted">Los fondos se provisionan con ítems del gasto común marcados "Va al fondo…": al publicar el período, el aporte se anota solo. Al usar un fondo se registra en qué y, si se quiere, también el egreso en el flujo de caja.</p>`; }
    else if(tab==='pagos'){ el.innerHTML=`${adm?'<div style="margin-bottom:10px"><button class="btn" id="bPago">+ Registrar pago</button></div>':''}<div class="list">${D.pagos.slice(0,400).map(p=>filaPago(p,true)).join('')||'<div class="empty">Aún no hay pagos registrados</div>'}</div>`; }
    else if(tab==='convenios'){ const cs=Object.values(D.C).sort((a,b)=>a.ts<b.ts?1:-1); el.innerHTML=`<p class="small muted">Para proponer un convenio, usa el botón "Convenio" de la unidad en la pestaña Estado.</p><div class="list">${cs.map(c=>`<div class="item" data-cv="${c.id}"><div class="hd"><b>Depto ${esc(c.depto)} · ${clp(c.monto_total)} en ${c.cuotas} ${c.cuotas===1?'cuota':'cuotas'}</b>${pillConv(c)}</div><div class="meta">${c.lista.filter(k=>Number(k.pagado_monto)>=Number(k.monto)).length} de ${c.cuotas} cuotas pagadas · saldo ${clp(c.saldo)}${c.atraso?' · atrasado '+clp(c.atraso):''} · ${fmtDate(c.ts)}</div></div>`).join('')||'<div class="empty">Sin convenios</div>'}</div>`; }
    else { const {previo,filas}=filasAnio(); const anios=[...new Set([new Date().getFullYear(), ...D.pagos.map(p=>+p.fecha.slice(0,4)), ...movs.map(x=>+x.fecha.slice(0,4))])].sort((a,b)=>b-a); const s=k=>filas.reduce((a,f)=>a+f[k],0);
      el.innerHTML=`<div class="row wrap" style="margin-bottom:10px"><select id="fAnio" style="width:auto">${anios.map(a=>`<option ${a===anio?'selected':''}>${a}</option>`).join('')}</select>${adm?'<button class="btn" id="bMov">+ Ingreso o egreso</button>':''}<button class="btn sec" id="bCajaX">Excel</button></div>
      <div class="card" style="overflow:auto"><table><thead><tr><th>Mes</th><th class="num">Gastos comunes</th><th class="num">Otros ingresos</th><th class="num">Egresos</th><th class="num">Flujo neto</th><th class="num">Saldo acumulado</th></tr></thead><tbody>
      ${previo?`<tr><td class="muted" colspan="5">Saldo al inicio de ${anio}</td><td class="num">${clp(previo)}</td></tr>`:''}${filas.map(f=>`<tr data-mes="${f.k}" style="cursor:pointer"><td>${esc(fmtMonth(f.k))}</td><td class="num">${clp(f.gc)}</td><td class="num">${clp(f.otros)}</td><td class="num">${clp(f.egresos)}</td><td class="num" style="color:${f.neto<0?'var(--er)':'inherit'}">${clp(f.neto)}</td><td class="num">${clp(f.acum)}</td></tr>`).join('')}
      <tr><th>Total ${anio}</th><th class="num">${clp(s('gc'))}</th><th class="num">${clp(s('otros'))}</th><th class="num">${clp(s('egresos'))}</th><th class="num">${clp(s('neto'))}</th><th class="num">${clp(filas[11].acum)}</th></tr></tbody></table></div>
      <p class="small muted">Los ingresos por gastos comunes (incluidos los intereses por mora pagados) salen de los pagos registrados, en el mes en que se recibieron. Los egresos y otros ingresos se anotan con "+ Ingreso o egreso". Toca un mes para ver su detalle.</p>`; } };
  const mesDetalle=k=>{ const ps=D.pagos.filter(p=>enCaja(p)&&p.fecha.slice(0,7)===k), ms=movs.filter(x=>x.fecha.slice(0,7)===k);
    const m=modal(`<h3>${esc(fmtMonth(k))}</h3><h2 style="margin-top:0">Ingresos y egresos anotados</h2><div class="list">${ms.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.categoria)}</b><b style="color:${x.tipo==='egreso'?'var(--er)':'var(--ok)'}">${x.tipo==='egreso'?'−':'+'}${clp(x.monto)}</b></div><div class="meta">${fmtDay(x.fecha)}${x.descripcion?' · '+esc(x.descripcion):''}</div>${adm?`<div class="row acc"><button class="btn sec sm" data-delmov="${x.id}">Eliminar</button></div>`:''}</div>`).join('')||'<div class="empty">Sin movimientos anotados</div>'}</div>
    <h2>Pagos de gastos comunes (${clp(ps.reduce((a,p)=>a+Number(p.monto),0))})</h2><div class="list">${ps.map(p=>filaPago(p,false).replace('<b>','<b>Depto '+esc(p.depto)+' · ')).join('')||'<div class="empty">Sin pagos</div>'}</div><div class="center" style="margin-top:12px"><button class="btn sec" data-close>Cerrar</button></div>`);
    m.addEventListener('click', async e=>{ const d=e.target.closest('[data-delmov]'); if(!d) return; e.preventDefault(); try{ await q(T('caja_movimientos').delete().eq('id',d.dataset.delmov)); closeModal(); toast('Movimiento eliminado'); listo(); }catch(err){ toast(errMsg(err)); } }); };
  const formMov=()=>{ const m=modal(`<h3>Ingreso o egreso</h3><form id="fMv"><div class="row"><label class="f grow"><span>Tipo</span><select name="tipo"><option value="egreso">Egreso</option><option value="ingreso">Otro ingreso</option></select></label><label class="f grow"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}" required></label></div>
    <label class="f"><span>Categoría</span><input type="text" name="categoria" list="dlCat" required><datalist id="dlCat">${['Remuneraciones','Agua','Electricidad','Gas','Mantención','Aseo','Seguros','Honorarios','Reparaciones','Multas','Arriendo de espacios','Intereses','Saldo inicial'].map(x=>`<option value="${x}">`).join('')}</datalist></label>
    <label class="f"><span>Detalle</span><input type="text" name="descripcion" placeholder="Proveedor, N° de factura…"></label><label class="f"><span>Monto</span><input type="text" inputmode="numeric" data-clp name="monto" required></label><p class="small muted">Los pagos de gastos comunes no se anotan aquí: se registran en Pagos y entran solos al flujo.</p><button class="btn full">Guardar</button></form>`);
    $('#fMv',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ await q(T('caja_movimientos').insert({tipo:d.tipo, fecha:d.fecha, categoria:d.categoria.trim(), descripcion:d.descripcion.trim(), monto:Number(d.monto), registrado_por:S.uid})); closeModal(); toast('Movimiento guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); };
  $('#fTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#fTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  $('#fBody').addEventListener('change',e=>{ if(e.target.id==='fAnio'){ anio=Number(e.target.value); draw(); } if(e.target.id==='cgAnul'){ verAnul=e.target.checked; draw(); } });
  const formFondo=(f={})=>{ const m=modal(`<h3>${f.id?'Editar':'Nuevo'} fondo</h3><form id="fFo"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(f.nombre||'')}" placeholder="Ej: Fondo de reserva, Fondo de mantención" required></label>
    <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="reserva" ${f.reserva?'checked':''}> Es el fondo común de reserva que exige la ley</label>
    <div class="row"><label class="f grow"><span>Aporte sugerido (% de los gastos del período)</span><input type="text" inputmode="decimal" data-dec name="pct" value="${aDec(f.pct)}"></label><label class="f grow"><span>Saldo al empezar a usar la app</span><input type="text" inputmode="numeric" data-clp name="saldo_inicial" value="${Number(f.saldo_inicial)||0}" ${f.id?'disabled':''}></label></div>
    <label class="f"><span>Descripción (opcional)</span><input type="text" name="descripcion" value="${esc(f.descripcion||'')}"></label>${f.id?`<label class="sw" style="margin-bottom:10px"><input type="checkbox" name="activo" ${f.activo?'checked':''}> Activo</label>`:''}
    <p class="small muted">Con un aporte sugerido, al crear un período se agrega el ítem del fondo y el botón "Calcular aportes a fondos" calcula su monto. El reglamento de copropiedad fija el porcentaje; confírmalo.</p><button class="btn full">Guardar</button></form>`);
    $('#fFo',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const o={nombre:d.nombre.trim(), reserva:!!d.reserva, pct:Number(d.pct)||0, descripcion:d.descripcion.trim()}; if(f.id) o.activo=!!d.activo; else o.saldo_inicial=Number(d.saldo_inicial)||0;
      try{ await q(f.id?T('fondos').update(o).eq('id',f.id):T('fondos').insert(o)); closeModal(); toast('Fondo guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  const detalleFondo=(f,x={},ms=[])=>{ const TM={aporte:'Aporte',uso:'Uso',ajuste:'Ajuste'};
    const m=modal(`<h3>${esc(f.nombre)}</h3><div class="kpi"><div class="k"><b>${clp(x.saldo)}</b><span>Saldo</span></div><div class="k"><b>${clp(x.aportes)}</b><span>Aportes</span></div><div class="k"><b>${clp(x.usos)}</b><span>Usos</span></div></div>
    ${adm?`<div class="row wrap" style="gap:6px;margin:12px 0"><button class="btn" id="foUso">Registrar uso</button><button class="btn sec" id="foAj">Ajuste</button><button class="btn sec" id="foEd">Editar</button></div>`:''}
    <div class="list">${ms.map(v=>`<div class="item static"><div class="hd"><b>${TM[v.tipo]} · ${v.tipo==='uso'?'−':''}${clp(v.monto)}</b><span class="muted small">${fmtDay(v.fecha)}</span></div><div class="meta">${esc(v.descripcion||'')}${v.caja_id?' · también en el flujo de caja':''}</div>${adm&&!v.periodo?`<div class="row acc"><button class="btn sec sm" data-delfm="${v.id}">Eliminar</button></div>`:''}</div>`).join('')||'<div class="empty">Sin movimientos</div>'}<div class="item static"><div class="meta">Saldo inicial ${clp(f.saldo_inicial)}</div></div></div>
    <div class="center" style="margin-top:12px"><button class="btn sec" data-close>Cerrar</button></div>`);
    $('#foEd',m)?.addEventListener('click',()=>formFondo(f));
    $('#foUso',m)?.addEventListener('click',()=>{ const m2=modal(`<h3>Usar ${esc(f.nombre)}</h3><p class="small muted">Saldo disponible ${clp(x.saldo)}.</p><form id="fUs"><label class="f"><span>En qué se usó</span><input type="text" name="d" required placeholder="Ej: reparación bomba de agua, factura 1234"></label><div class="row"><label class="f grow"><span>Monto</span><input type="text" inputmode="numeric" data-clp name="m" required></label><label class="f grow"><span>Fecha</span><input type="date" name="f" value="${todayStr()}" required></label></div><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="e" checked> Registrar también el egreso en el flujo de caja</label><button class="btn full">Registrar uso</button></form>`);
      $('#fUs',m2).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('usar_fondo',{p_fondo:f.id, p_monto:Number(d.m), p_fecha:d.f, p_descripcion:d.d.trim(), p_egreso:!!d.e})); closeModal(); toast('Uso registrado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); });
    $('#foAj',m)?.addEventListener('click',()=>{ const m2=modal(`<h3>Ajuste de ${esc(f.nombre)}</h3><p class="small muted">Para cuadrar el saldo con la cuenta del banco (intereses ganados, diferencias). Positivo suma, negativo resta. No pasa por el flujo de caja.</p><form id="fAj"><label class="f"><span>Motivo</span><input type="text" name="d" required></label><div class="row"><label class="f grow"><span>Monto</span><input type="text" inputmode="numeric" data-clp="neg" name="m" required></label><label class="f grow"><span>Fecha</span><input type="date" name="f" value="${todayStr()}" required></label></div><button class="btn full">Guardar ajuste</button></form>`);
      $('#fAj',m2).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(T('fondo_movimientos').insert({fondo_id:f.id, tipo:'ajuste', monto:Number(d.m), fecha:d.f, descripcion:d.d.trim()})); closeModal(); toast('Ajuste guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); });
    m.addEventListener('click', async ev=>{ const d=ev.target.closest('[data-delfm]'); if(!d) return; ev.preventDefault(); if(!await confirmBox('¿Eliminar este movimiento? Si generó un egreso en el flujo de caja, elimínalo también allí.')) return; try{ await q(T('fondo_movimientos').delete().eq('id',d.dataset.delfm)); toast('Movimiento eliminado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  $('#fBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-cv]')){ e.preventDefault(); detalleConvenio(D.C[b.dataset.cv], listo); }
    else if(b=t('[data-pago]')) formPago({depto:b.dataset.pago, listo});
    else if(b=t('[data-conv]')) formConvenio(b.dataset.conv, listo);
    else if(t('#bPago')) formPago({listo});
    else if(t('#bMov')) formMov();
    else if(t('#bCargo')) formCargo({}, listo);
    else if(t('#bFondo')) formFondo();
    else if(b=t('[data-fondo]')) detalleFondo(fondos.find(f=>f.id===b.dataset.fondo), saldos.find(x=>x.fondo_id===b.dataset.fondo), fmov.filter(x=>x.fondo_id===b.dataset.fondo));
    else if(b=t('[data-rebajar]')){ e.preventDefault(); const c=cargos.find(x=>x.id===b.dataset.rebajar); const v=await askText('Nuevo monto (hoy '+clp(c.monto)+')', String(Math.round(c.monto))); if(v===null) return; const n=Number(String(v).replace(/[^0-9]/g,'')); if(!(n>=0&&n<Number(c.monto))){ toast('El nuevo monto debe ser menor que el actual'); return; } const mot=await askText('Motivo de la rebaja'); if(!mot) return; try{ await q(T('cargos').update({monto:n, motivo:mot.trim()}).eq('id',c.id)); toast('Cargo rebajado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }
    else if(b=t('[data-anularc]')){ e.preventDefault(); const mot=await askText('Motivo de la anulación (condonación)'); if(!mot) return; try{ await q(T('cargos').update({estado:'anulado', motivo:mot.trim()}).eq('id',b.dataset.anularc)); toast('Cargo anulado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }
    else if(b=t('[data-anular]')){ e.preventDefault(); const mot=await askText('Motivo de la anulación'); if(mot===null) return; try{ await q(T('pagos').update({anulado:true, anulado_motivo:mot}).eq('id',b.dataset.anular)); toast('Pago anulado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }
    else if(t('#bCajaX')){ const {previo,filas}=filasAnio(); const B=v=>({v,b:true}); descargar(new Blob([window.MiniXlsx.build([{name:'Flujo '+anio, widths:[20,18,16,14,14,18], rows:[[B(S.cfg?.nombre||'')],[B('Flujo de caja '+anio)],[],[B('Mes'),B('Gastos comunes'),B('Otros ingresos'),B('Egresos'),B('Flujo neto'),B('Saldo acumulado')],['Saldo inicial','','','','',previo], ...filas.map(f=>[fmtMonth(f.k),f.gc,f.otros,f.egresos,f.neto,f.acum]), [B('Total'),B(filas.reduce((a,f)=>a+f.gc,0)),B(filas.reduce((a,f)=>a+f.otros,0)),B(filas.reduce((a,f)=>a+f.egresos,0)),B(filas.reduce((a,f)=>a+f.neto,0)),B(filas[11].acum)]]},
      {name:'Movimientos', widths:[12,10,22,34,14], rows:[[B('Fecha'),B('Tipo'),B('Categoría'),B('Detalle'),B('Monto')], ...movs.filter(x=>x.fecha.startsWith(anio+'-')).map(x=>[x.fecha,x.tipo,x.categoria,x.descripcion||'',Number(x.monto)]), ...D.pagos.filter(p=>enCaja(p)&&p.fecha.startsWith(anio+'-')).map(p=>[p.fecha,'ingreso',p.concepto==='interes'?'Intereses por mora':'Gastos comunes','Depto '+p.depto+(p.periodo?' · '+p.periodo:' · convenio'),Number(p.monto)])]}])],{type:window.MiniXlsx.MIME}), 'flujo-de-caja-'+anio+'.xlsx'); }
    else if(b=t('[data-mes]')) mesDetalle(b.dataset.mes); });
};

// RESERVAS
// Bloqueos recurrentes de un espacio (aseo, mantención): [{dias:[0-6, 0 = domingo], desde, hasta, motivo}], en horas enteras
const DIAS_SEM=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'], DIAS_ORD=[1,2,3,4,5,6,0];
const txtBloqueo=b=>`${DIAS_ORD.filter(d=>(b.dias||[]).includes(d)).map(d=>DIAS_SEM[d]).join(', ')} ${pad(b.desde)}:00–${pad(b.hasta)}:00${b.motivo?' ('+b.motivo+')':''}`;
const bloqueosDia=(e,dia)=>{ const dow=new Date(dia+'T12:00:00').getDay(), out={}; (e.bloqueos||[]).filter(b=>(b.dias||[]).includes(dow)).forEach(b=>{ for(let h=Number(b.desde);h<Number(b.hasta);h++) out[h]=b.motivo||'No disponible'; }); return out; };
VIEWS.reservas = function(){
  const r=role(); const resid=['residente','propietario'].includes(r); const aprobador=['comite','admin'].includes(r);
  const esp=S.cfg?.espacios||[];
  setMain(`<h1>Reservas</h1>
  <div class="card"><div class="row wrap"><label class="f grow" style="margin:0"><span>Espacio</span><select id="selEsp">${esp.map(e=>`<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('')}</select></label><label class="f grow" style="margin:0"><span>Fecha</span><input type="date" id="selDia" value="${todayStr()}" min="${todayStr()}"></label></div>
  <div id="espInfo" class="small muted" style="margin:8px 0"></div><div id="slots" class="slots"></div>
  ${resid?`<div class="row" style="margin-top:10px"><input type="text" id="resNota" placeholder="Motivo / nota (opcional)" class="grow"><button class="btn" id="bRes" disabled>Reservar</button></div>`:''}</div>
  <div class="tabs" id="rTabs">${resid?'<button data-t="mias" class="on">Mis reservas</button>':''}${aprobador?'<button data-t="pend" class="'+(resid?'':'on')+'">Pendientes</button>':''}<button data-t="prox" class="${resid||aprobador?'':'on'}">Próximas</button></div><div id="rList" class="list"></div>`);
  let allRes=[], selected=new Set();
  const curEsp=()=>esp.find(e=>e.id===$('#selEsp').value)||esp[0];
  const hours=e=>{ const out=[]; for(let h=parseInt(e.desde),hf=parseInt(e.hasta);h<hf;h++) out.push(h); return out; };
  function drawSlots(){ const e=curEsp(); if(!e){ $('#slots').innerHTML='<div class="muted">No hay espacios configurados.</div>'; return; } const dia=$('#selDia').value; const maxDay=new Date(); maxDay.setDate(maxDay.getDate()+(Number(e.anticipacionDias)||30));
    $('#espInfo').innerHTML=`Capacidad ${e.capacidad||'-'} · ${e.desde}–${e.hasta} · máx ${e.maxHoras} h · hasta ${e.anticipacionDias} días de anticipación · ${e.aprobacion?'requiere aprobación':'confirmación inmediata'}${e.costo?' · costo '+clp(e.costo)+' (se suma a tu gasto común)':''}`;
    const busyH={}; allRes.filter(d=>d.espacio_id===e.id && d.fecha===dia && ['pendiente','aprobada'].includes(d.estado)).forEach(d=>{ for(let h=d.h_ini;h<d.h_fin;h++) busyH[h]=d; });
    const blq=bloqueosDia(e,dia); if(e.bloqueos?.length) $('#espInfo').innerHTML+=`<br>No disponible: ${e.bloqueos.map(b=>esc(txtBloqueo(b))).join(' · ')}`;
    $('#slots').innerHTML = hours(e).map(h=>{ const b=busyH[h], k=blq[h]; return `<button data-h="${h}" class="${b||k?'busy':''}${selected.has(h)?' sel':''}" ${b||k?'disabled':''}>${pad(h)}:00${b?`<br><small>${esc(b.depto)}</small>`:k?`<br><small>${esc(k)}</small>`:''}</button>`; }).join('');
    const tooFar = new Date(dia) > maxDay; if($('#bRes')) $('#bRes').disabled = !selected.size || tooFar; if(tooFar) $('#espInfo').innerHTML+=' <span class="pill er">Fecha fuera del plazo permitido</span>'; }
  $('#slots').addEventListener('click',e=>{ const b=e.target.closest('button[data-h]'); if(!b||b.disabled||!resid) return; const h=Number(b.dataset.h); const ex=curEsp(); if(selected.has(h)) selected.delete(h); else { selected.add(h); const arr=[...selected].sort((a,b)=>a-b); if(arr.length>Number(ex.maxHoras)||arr[arr.length-1]-arr[0]+1!==arr.length){ selected=new Set([h]); toast(`Máximo ${ex.maxHoras} h consecutivas`); } } drawSlots(); });
  $('#selEsp').addEventListener('change',()=>{selected.clear();drawSlots();}); $('#selDia').addEventListener('change',()=>{selected.clear();drawSlots();});
  $('#bRes')?.addEventListener('click', async()=>{ const e=curEsp(); const arr=[...selected].sort((a,b)=>a-b); if(!arr.length) return; const dia=$('#selDia').value;
    if(allRes.some(d=>d.espacio_id===e.id&&d.fecha===dia&&d.depto===myDepto()&&['pendiente','aprobada'].includes(d.estado))){ toast('Ya tienes una reserva de este espacio ese día'); return; }
    try{ await q(T('reservas').insert({espacio_id:e.id, espacio_nombre:e.nombre, fecha:dia, h_ini:arr[0], h_fin:arr[arr.length-1]+1, depto:myDepto(), uid:S.uid, nota:$('#resNota').value.trim(), estado:e.aprobacion?'pendiente':'aprobada'})); selected.clear(); $('#resNota').value=''; toast(e.aprobacion?'Solicitud enviada, pendiente de aprobación':'Reserva confirmada'); }catch(err){ toast('Error: '+errMsg(err)); } });
  let tab=$('#rTabs .on')?.dataset.t||'prox';
  $('#rTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#rTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; drawList(); });
  function drawList(){ const hoy=todayStr(); let docs=allRes; if(tab==='mias') docs=docs.filter(d=>d.depto===myDepto()); else if(tab==='pend') docs=docs.filter(d=>d.estado==='pendiente'); else docs=docs.filter(d=>d.fecha>=hoy&&!['cancelada','rechazada'].includes(d.estado));
    docs=sortBy(docs,d=>d.fecha+pad(d.h_ini),tab==='mias');
    $('#rList').innerHTML = docs.map(d=>`<div class="item static"><div class="hd"><b>${esc(d.espacio_nombre)} · ${fmtDay(d.fecha)} ${pad(d.h_ini)}:00–${pad(d.h_fin)}:00</b>${pillOf(EST_RES,d.estado)}</div><div class="meta">Depto ${esc(d.depto)}${d.nota?' · '+esc(d.nota):''}${d.motivo_rechazo?' · Rechazo: '+esc(d.motivo_rechazo):''}</div>
      <div class="row" style="margin-top:8px;gap:6px">${aprobador&&d.estado==='pendiente'?`<button class="btn ok sm" data-ap="${d.id}">Aprobar</button><button class="btn dan sm" data-re="${d.id}">Rechazar</button>`:''}${(d.uid===S.uid||isAdmin())&&['pendiente','aprobada'].includes(d.estado)&&d.fecha>=hoy?`<button class="btn sec sm" data-ca="${d.id}">Cancelar</button>`:''}</div></div>`).join('')||'<div class="empty">Nada por aquí</div>'; }
  $('#rList').addEventListener('click', async e=>{ const ap=e.target.closest('[data-ap]'), re=e.target.closest('[data-re]'), ca=e.target.closest('[data-ca]'); try{
    if(ap) await q(T('reservas').update({estado:'aprobada', aprobado_por:S.uid}).eq('id',ap.dataset.ap));
    if(re){ const mot=await askText('Motivo del rechazo'); if(mot===null) return; await q(T('reservas').update({estado:'rechazada', motivo_rechazo:mot, aprobado_por:S.uid}).eq('id',re.dataset.re)); }
    if(ca && await confirmBox('¿Cancelar la reserva?')) await q(T('reservas').update({estado:'cancelada'}).eq('id',ca.dataset.ca));
  }catch(err){ toast('Error: '+errMsg(err)); } });
  const desde=new Date(); desde.setDate(desde.getDate()-60);
  watch('reservas', ()=>q(T('reservas').select('*').gte('fecha',desde.toISOString().slice(0,10))), rows=>{ allRes=rows; drawSlots(); drawList(); });
  drawSlots();
};

// INCIDENCIAS
VIEWS.incidencias = function(param){
  const r=role(); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Incidencias</h1><div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bNewInc">+ Reportar incidencia</button><span class="grow"></span><select id="fEst" style="width:auto"><option value="">Todas</option><option value="activas" selected>Activas</option>${Object.entries(EST_INC).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('')}</select></div><div id="iList" class="list"></div>`);
  $('#bNewInc').addEventListener('click',()=>formIncidencia());
  let docs=[]; const draw=()=>{ const el=$('#iList'); if(!el) return; const f=$('#fEst').value; let d=docs; if(resid) d=d.filter(x=>x.depto===myDepto()); if(f==='activas') d=d.filter(x=>['abierta','en_curso'].includes(x.estado)); else if(f) d=d.filter(x=>x.estado===f);
    el.innerHTML = d.map(x=>`<div class="item" data-i="${x.id}"><div class="hd"><b>${esc(x.titulo)}</b><span class="row" style="gap:4px">${pillOf(PRIO,x.prioridad)}${pillOf(EST_INC,x.estado)}</span></div><div class="meta">${esc(x.ubicacion||'')} · ${resid?'':'Depto '+esc(x.depto)+' · '}${fmtDate(x.ts)}${x.asignado_a?' · '+esc(userName(x.asignado_a)):''}${x.fotos?.length?' · 📷 '+x.fotos.length:''}</div></div>`).join('')||'<div class="empty">Sin incidencias</div>'; };
  $('#fEst').addEventListener('change',draw);
  $('#iList').addEventListener('click',e=>{ const it=e.target.closest('[data-i]'); if(it){ const d=docs.find(x=>x.id===it.dataset.i); if(d) detalleIncidencia(d); } });
  watch('incidencias', ()=>q(T('incidencias').select('*').order('ts',{ascending:false}).limit(500)), rows=>{ docs=rows; draw(); if(param){ const d=docs.find(x=>x.id===param); if(d){ detalleIncidencia(d); param=null; } } });
  REFRESH.incidencias=draw;
};
function formIncidencia(){
  const m=modal(`<h3>Reportar incidencia</h3><form id="fI"><label class="f"><span>Título</span><input type="text" name="titulo" required placeholder="Ej: Luz quemada pasillo piso 12"></label>
  <label class="f"><span>Ubicación</span><input type="text" name="ubicacion" placeholder="Piso, área, equipo"></label>
  <label class="f"><span>Descripción</span><textarea name="descripcion" required></textarea></label>
  <label class="f"><span>Prioridad</span><select name="prioridad">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${k==='media'?'selected':''}>${v[0]}</option>`).join('')}</select></label>
  ${fotoInput()}<button class="btn full" id="sI">Enviar</button></form>`);
  $('#fI',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('#sI',m); busy(b,true,'Subiendo…'); const d=formData(e.target); try{ const fotos=await subirFotos($('[name=fotos]',m),'incidencias');
    await q(T('incidencias').insert({titulo:d.titulo.trim(), ubicacion:d.ubicacion.trim(), descripcion:d.descripcion.trim(), prioridad:d.prioridad, fotos, depto:myDepto(), uid:S.uid, estado:'abierta', historial:[{ts:now(), uid:S.uid, accion:'Reportada'}]})); closeModal(); toast('Incidencia enviada'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
function detalleIncidencia(x){
  const staff=isStaff(); const conserjes=Object.values(S.users).filter(u=>u.rol==='conserje'&&u.estado==='activo');
  const m=modal(`<h3>${esc(x.titulo)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillOf(EST_INC,x.estado)}${pillOf(PRIO,x.prioridad)}<span class="muted small">Depto ${esc(x.depto)} · ${fmtDate(x.ts)}</span></div>
  <p>${esc(x.descripcion)}</p><div class="small muted">📍 ${esc(x.ubicacion||'Sin ubicación')}${x.asignado_a?' · Asignada a '+esc(userName(x.asignado_a)):''}${x.ot_id&&role()!=='residente'&&role()!=='propietario'?' · <a href="#mantencion--'+esc(x.ot_id)+'">Ver OT</a>':''}</div>
  <div class="photos">${(x.fotos||[]).map(f=>`<img data-f="${esc(f)}" data-img="${esc(f)}">`).join('')}</div>
  ${staff?`<h2>Gestión</h2><div class="row wrap" style="gap:6px">
    ${x.estado==='abierta'?`<button class="btn sm" data-st="en_curso">Tomar / En curso</button>`:''}
    ${x.estado==='en_curso'?`<button class="btn ok sm" data-st="resuelta">Marcar resuelta</button>`:''}
    ${x.estado!=='cerrada'&&x.estado!=='abierta'?`<button class="btn sec sm" data-st="abierta">Reabrir</button>`:''}
    ${x.estado==='resuelta'&&isAdmin()?`<button class="btn sec sm" data-st="cerrada">Cerrar</button>`:''}
    ${isAdmin()&&!x.ot_id?`<button class="btn sec sm" id="crearOT">Crear OT a empresa</button>`:''}
  </div>
  ${conserjes.length?`<label class="f" style="margin-top:10px"><span>Asignar a</span><select id="asig"><option value="">— Sin asignar —</option>${conserjes.map(u=>`<option value="${u.id}" ${x.asignado_a===u.id?'selected':''}>${esc(u.nombre)}</option>`).join('')}</select></label>`:''}
  <label class="f"><span>Agregar nota (y fotos)</span><textarea id="nota" placeholder="Comentario para el historial"></textarea><input type="file" id="notaFotos" accept="image/*" capture="environment" multiple style="margin-top:6px"></label><button class="btn sec sm" id="addNota">Agregar nota</button>`
  : (x.estado==='resuelta'&&x.uid===S.uid?`<div class="info" style="margin-top:10px">¿Quedó resuelto? <button class="btn ok sm" data-st="cerrada">Sí, cerrar</button> <button class="btn sec sm" data-st="abierta">No, reabrir</button></div>`:'')}
  <h2>Historial</h2><div class="timeline">${(x.historial||[]).slice().reverse().map(h=>`<div><b>${esc(h.accion)}</b> <span class="muted">· ${esc(userName(h.uid))} · ${fmtDate(h.ts)}</span>${h.nota?'<br>'+esc(h.nota):''}${h.fotos?.length?'<div class="photos">'+h.fotos.map(f=>`<img data-f="${esc(f)}" data-img="${esc(f)}">`).join('')+'</div>':''}</div>`).join('')}</div>`);
  const upd=p=>q(T('incidencias').update(p).eq('id',x.id));
  const hist=(accion,extra={})=>[...(x.historial||[]),{ts:now(),uid:S.uid,accion,...extra}];
  m.addEventListener('click', async e=>{ const st=e.target.closest('[data-st]'); const img=e.target.closest('[data-img]'); if(img){ viewImg(img.dataset.img); return; }
    try{ if(st){ const n=st.dataset.st; await upd({estado:n, historial:hist('Estado → '+EST_INC[n][0]), asignado_a: n==='en_curso'&&!x.asignado_a&&role()==='conserje'? S.uid : (x.asignado_a||null)}); closeModal(); toast('Actualizada'); } }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#asig',m)?.addEventListener('change', async e=>{ try{ await upd({asignado_a:e.target.value||null, historial:hist(e.target.value?'Asignada a '+userName(e.target.value):'Sin asignar')}); toast('Asignación guardada'); }catch(err){ toast(errMsg(err)); } });
  $('#addNota',m)?.addEventListener('click', async()=>{ const n=$('#nota',m).value.trim(); const fotos=await subirFotos($('#notaFotos',m),'incidencias'); if(!n&&!fotos.length) return; try{ await upd({historial:hist('Nota',{nota:n,fotos})}); closeModal(); toast('Nota agregada'); }catch(err){ toast(errMsg(err)); } });
  $('#crearOT',m)?.addEventListener('click',()=>formOT({incidencia_id:x.id, titulo:x.titulo, descripcion:x.descripcion+(x.ubicacion?'\nUbicación: '+x.ubicacion:''), fotos_antes:x.fotos||[]}));
}

// MENSAJES
VIEWS.mensajes = function(){
  const r=role(); const resid=['residente','propietario'].includes(r);
  let chatUn=null;
  if(resid){
    setMain(`<h1>Mensajes</h1><div class="tabs" id="cTabs">${Object.entries(CANALES).map(([k,v],i)=>`<button data-c="${k}" class="${i===0?'on':''}">${v}</button>`).join('')}</div><div id="chat"></div>`);
    $('#cTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#cTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); openChat(b.dataset.c, myDepto()); });
    openChat('conserjeria', myDepto());
  } else {
    const misCanales = r==='admin'? Object.keys(CANALES) : Object.keys(canalRol).filter(c=>canalRol[c]===r);
    setMain(`<h1>Mensajes</h1><div class="tabs" id="cTabs">${misCanales.map((k,i)=>`<button data-c="${k}" class="${i===0?'on':''}">${CANALES[k]}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:10px"><select id="deptoSel" class="grow"><option value="">— Elegir depto para escribir —</option>${Object.keys(S.unidades).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></div>
    <div id="convs" class="list"></div><div id="chat"></div>`);
    let canal=misCanales[0], convUn=null;
    const loadConvs=()=>{ if(convUn) convUn.un(); convUn=watch('conversaciones', ()=>q(T('conversaciones').select('*').eq('canal',canal).order('ultimo_ts',{ascending:false}).limit(200)), rows=>{ const el=$('#convs'); if(!el) return; el.innerHTML=rows.map(c=>`<div class="item" data-d="${esc(c.depto)}"><div class="hd"><b>Depto ${esc(c.depto)}${c.no_leido_staff?'<span class="unread"></span>':''}</b><span class="muted small">${fmtDate(c.ultimo_ts)}</span></div><div class="meta">${esc(c.ultimo||'')}</div></div>`).join('')||'<div class="empty">Sin conversaciones en este canal</div>'; }); };
    $('#cTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#cTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); canal=b.dataset.c; $('#chat').innerHTML=''; if(chatUn){chatUn.un();chatUn=null;} loadConvs(); });
    $('#convs').addEventListener('click',e=>{ const it=e.target.closest('[data-d]'); if(it) openChat(canal,it.dataset.d); });
    $('#deptoSel').addEventListener('change',e=>{ if(e.target.value) openChat(canal,e.target.value); });
    loadConvs();
  }
  function openChat(canal, depto){
    if(!depto){ $('#chat').innerHTML='<div class="empty">Tu usuario no tiene departamento asignado.</div>'; return; }
    const cid=seg(canal)+'_'+seg(depto);
    $('#chat').innerHTML=`<div class="card"><div class="row" style="margin-bottom:6px"><b>${CANALES[canal]} ↔ Depto ${esc(depto)}</b></div><div class="chat" id="msgs"><div class="empty">Cargando…</div></div>
    <form id="fMsg" class="row" style="margin-top:8px"><input type="text" name="t" class="grow" placeholder="Escribe un mensaje…" autocomplete="off" required><button class="btn">Enviar</button></form></div>`;
    if(chatUn) chatUn.un();
    chatUn=watch({table:'mensajes', filter:'conv_id=eq.'+cid}, ()=>q(T('mensajes').select('*').eq('conv_id',cid).order('ts',{ascending:true}).limit(300)), rows=>{ const box=$('#msgs'); if(!box) return; box.innerHTML=rows.map(mm=>{ const me=mm.uid===S.uid; return `<div class="msg ${me?'me':''}">${esc(mm.texto)}<small>${esc(me?'Tú':(['residente','propietario'].includes(mm.rol)?'Depto '+depto:ROLES[mm.rol]))} · ${fmtDate(mm.ts)}</small></div>`;}).join('')||'<div class="empty">Inicia la conversación</div>'; box.scrollTop=box.scrollHeight;
      // marcar leído
      const field=resid?'no_leido_residente':'no_leido_staff'; T('conversaciones').update({[field]:false}).eq('id',cid).eq(field,true).then(()=>{}); });
    $('#fMsg').addEventListener('submit', async e=>{ e.preventDefault(); const inp=$('[name=t]',e.target); const t=inp.value.trim(); if(!t) return; inp.value=''; try{
      await q(T('conversaciones').upsert({edificio_id:S.me.edificio_id, id:cid, canal, depto, ultimo:t.slice(0,80), ultimo_ts:now(), ultimo_uid:S.uid, no_leido_staff: resid, no_leido_residente: !resid}));
      await q(T('mensajes').insert({conv_id:cid, texto:t, uid:S.uid, rol:role()}));
    }catch(err){ toast('Error: '+errMsg(err)); } });
  }
};

// COMUNICADOS
VIEWS.comunicados = function(){
  const puede=['comite','admin'].includes(role());
  setMain(`<h1>Comunicados</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewC">+ Nuevo comunicado</button></div>':''}<div id="cList" class="list"></div>`);
  $('#bNewC')?.addEventListener('click',()=>formComunicado());
  let docs=[]; watch('comunicados', ()=>q(T('comunicados').select('*').order('ts',{ascending:false}).limit(100)), rows=>{ docs=rows; const el=$('#cList'); if(!el) return; el.innerHTML=docs.map(c=>`<div class="item static"><div class="hd"><b>${esc(c.titulo)}</b><span class="muted small">${fmtDate(c.ts)}</span></div><div style="margin-top:6px;white-space:pre-wrap">${esc(c.cuerpo)}</div><div class="meta">${esc(ROLES[c.rol]||'')} · ${esc(userName(c.uid))}${c.adjunto?` · <a data-f="${esc(c.adjunto)}" target="_blank">Adjunto</a>`:''}${puede?` · <a href="#" data-ed="${c.id}">Editar</a> · <a href="#" data-del="${c.id}">Eliminar</a>`:''}</div></div>`).join('')||'<div class="empty">Sin comunicados</div>'; });
  $('#cList').addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed){ e.preventDefault(); formComunicado(docs.find(x=>x.id===ed.dataset.ed)); } if(del){ e.preventDefault(); if(await confirmBox('¿Eliminar comunicado?')) await q(T('comunicados').delete().eq('id',del.dataset.del)); } });
};
function formComunicado(c={}){
  const m=modal(`<h3>${c.id?'Editar':'Nuevo'} comunicado</h3><form id="fC"><label class="f"><span>Título</span><input type="text" name="titulo" value="${esc(c.titulo||'')}" required></label><label class="f"><span>Mensaje</span><textarea name="cuerpo" required style="min-height:140px">${esc(c.cuerpo||'')}</textarea></label><label class="f"><span>Adjunto (PDF o imagen, opcional)</span><input type="file" name="adj" accept="application/pdf,image/*"></label><button class="btn full">Publicar</button></form>`);
  $('#fC',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ let adjunto=c.adjunto||''; const f=$('[name=adj]',m).files[0]; if(f) adjunto=await uploadFile(f,'comunicados'); if(c.id) await q(T('comunicados').update({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, editado:now()}).eq('id',c.id)); else await q(T('comunicados').insert({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, uid:S.uid, rol:realRole()})); closeModal(); toast('Publicado'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}

// ENCUESTAS. Sondeo: un voto por unidad, solo totales. Asamblea: el voto pesa según la alícuota y es nominal.
// Los totales vienen de resultados_encuestas() y los votos por unidad de votos_asamblea().
VIEWS.encuestas = function(){
  const r=role(); const puede=['comite','admin'].includes(r); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Encuestas</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewEn">+ Nueva encuesta</button></div>':''}<div id="enList" class="list"><div class="empty">Cargando…</div></div>`);
  $('#bNewEn')?.addEventListener('click',()=>formEncuesta());
  let docs=[], mios={}, res={}, nom={};
  const abierta=e=>e.estado==='abierta'&&(!e.cierra||e.cierra>=todayStr());
  const numDep=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
  const draw=()=>{ const el=$('#enList'); if(!el) return; const nUn=Object.keys(S.unidades).length, alEd=Object.values(S.unidades).reduce((a,u)=>a+Number(u.alicuota||0),0);
    el.innerHTML=docs.map(e=>{ const ab=abierta(e), ops=e.opciones||[], rs=res[e.id]||[], mio=mios[e.id], asm=e.tipo==='asamblea', vn=nom[e.id]||[];
      const habil=resid&&ab&&(!e.solo_propietarios||r==='propietario'); const verRes=puede||!ab||!!mio;
      const tot=rs.reduce((a,x)=>a+x.n,0), totAl=rs.reduce((a,x)=>a+Number(x.alicuota),0), base=asm?(alEd||totAl):tot, p1=v=>(Math.round(v*10)/10).toLocaleString('es-CL');
      const barra=(o,i)=>{ const x=rs.find(y=>y.opcion===i)||{n:0,alicuota:0}; const pct=base?(asm?Number(x.alicuota):x.n)/base*100:0; const us=vn.filter(v=>v.opcion===i).map(v=>v.depto).sort(numDep);
        return `<div style="margin-bottom:8px"><div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(o)}</span><span class="muted">${asm?`${p1(pct)}% de los derechos · ${x.n} ${x.n===1?'unidad':'unidades'}`:`${x.n} ${x.n===1?'voto':'votos'} · ${Math.round(pct)}%${totAl?' · alícuota '+Number(x.alicuota).toFixed(2)+'%':''}`}</span></div><div class="bar"><i style="width:${Math.min(100,pct)}%;background:var(--p)"></i></div>${asm&&us.length?`<div class="small muted" style="margin-top:3px">Unidades: ${us.map(esc).join(', ')}</div>`:''}</div>`; };
      return `<div class="item static" data-en="${e.id}"><div class="hd"><b>${esc(e.titulo)}</b><span class="row" style="gap:4px">${asm?'<span class="pill in">Asamblea</span>':''}<span class="pill ${ab?'ok':'mu'}">${ab?'Abierta':'Cerrada'}</span></span></div>
      ${e.descripcion?`<div style="margin-top:6px;white-space:pre-wrap">${esc(e.descripcion)}</div>`:''}
      <div class="meta">${e.cierra?(ab?'Cierra el ':'Cerró el ')+fmtDay(e.cierra)+' · ':''}${e.solo_propietarios?'Solo propietarios · ':''}${asm?'El voto pesa según la alícuota de la unidad y es nominal':'Un voto por unidad'}${verRes?` · ${tot} de ${nUn} unidades han votado${asm&&alEd?` (${p1(totAl/alEd*100)}% de los derechos)`:''}`:''}</div>
      ${asm&&!alEd?'<div class="note" style="margin-top:8px">Las unidades no tienen alícuota cargada (Administración → Unidades): sin ella no se puede ponderar esta votación.</div>':''}
      ${habil?(myDepto()?`<form style="margin-top:10px">${ops.map((o,i)=>`<label class="sw" style="margin-bottom:6px"><input type="radio" name="op" value="${i}" ${mio&&mio.opcion===i?'checked':''} required> ${esc(o)}</label>`).join('')}${asm?'<div class="small muted" style="margin-bottom:6px">En una votación de asamblea el voto no es secreto: la comunidad verá qué votó tu unidad.</div>':''}<div class="row" style="margin-top:4px"><button class="btn sm">${mio?'Cambiar voto':'Votar'}</button>${mio?`<span class="small muted">Tu unidad votó el ${fmtDate(mio.ts)}</span>`:''}</div></form>`:'<div class="note" style="margin-top:10px">Tu usuario no tiene departamento asignado.</div>')
        :(resid&&mio?`<div class="small muted" style="margin-top:8px">Tu unidad votó: <b>${esc(ops[mio.opcion]||'')}</b></div>`:(resid&&ab?'<div class="small muted" style="margin-top:8px">Esta votación es solo para propietarios.</div>':''))}
      ${verRes?`<div style="margin-top:12px">${ops.map(barra).join('')}</div>`
        :(habil?'<div class="small muted" style="margin-top:8px">Verás los resultados cuando tu unidad vote o al cerrar la encuesta.</div>':'')}
      ${puede?`<div class="row" style="margin-top:8px;gap:6px"><button class="btn sec sm" data-est="${e.estado==='abierta'?'cerrada':'abierta'}">${e.estado==='abierta'?'Cerrar votación':'Reabrir'}</button>${asm?'<button class="btn sec sm" data-acta>Detalle (Excel)</button>':''}<button class="btn sec sm" data-del>Eliminar</button></div>`:''}</div>`; }).join('')||'<div class="empty">Sin encuestas</div>'; };
  const w=watch(['encuestas','votos'], async()=>{ const [e,v,rs,vn]=await Promise.all([q(T('encuestas').select('*').order('ts',{ascending:false}).limit(100)), q(T('votos').select('*')), q(sb.rpc('resultados_encuestas')), q(sb.rpc('votos_asamblea')).catch(()=>[])]); return {e,v,rs,vn}; },
    ({e,v,rs,vn})=>{ docs=e; mios={}; v.filter(x=>x.depto===myDepto()).forEach(x=>mios[x.encuesta_id]=x); res={}; rs.forEach(x=>(res[x.encuesta_id]=res[x.encuesta_id]||[]).push(x)); nom={}; vn.forEach(x=>(nom[x.encuesta_id]=nom[x.encuesta_id]||[]).push(x)); draw(); });
  $('#enList').addEventListener('submit', async ev=>{ ev.preventDefault(); const id=ev.target.closest('[data-en]').dataset.en; const op=new FormData(ev.target).get('op'); if(op==null) return;
    try{ await q(T('votos').upsert({edificio_id:S.me.edificio_id, encuesta_id:id, depto:myDepto(), opcion:Number(op), uid:S.uid, ts:now()})); toast('Voto registrado'); w.reload(); }catch(err){ toast('No se pudo registrar el voto: '+errMsg(err)); } });
  $('#enList').addEventListener('click', async ev=>{ const est=ev.target.closest('[data-est]'), del=ev.target.closest('[data-del]'), acta=ev.target.closest('[data-acta]'); if(!est&&!del&&!acta) return; const id=ev.target.closest('[data-en]').dataset.en;
    if(acta){ const e=docs.find(x=>x.id===id), vn=(nom[id]||[]).slice().sort((a,b)=>numDep(a.depto,b.depto)), B=v=>({v,b:true}), ya=new Set(vn.map(v=>v.depto));
      const falt=Object.values(S.unidades).filter(u=>!ya.has(u.depto)).sort((a,b)=>numDep(a.depto,b.depto));
      descargar(new Blob([window.MiniXlsx.build([{name:'Votación', widths:[12,30,12,24,20], rows:[[B(S.cfg?.nombre||'')],[B(e.titulo)],[e.descripcion||''],[],[B('Unidad'),B('Propietario'),B('Alícuota'),B('Voto'),B('Fecha')],
        ...vn.map(v=>[String(v.depto),S.unidades[v.depto]?.prop||'',Number(v.alicuota),(e.opciones||[])[v.opcion]||'',fmtDate(v.ts)]), ...falt.map(u=>[String(u.depto),u.prop||'',Number(u.alicuota),'(no votó)','']),
        [],[B('Resumen')], ...(e.opciones||[]).map((o,i)=>{ const x=vn.filter(v=>v.opcion===i); return [o,'',x.reduce((a,v)=>a+Number(v.alicuota),0),x.length+' unidades','']; })]}])],{type:window.MiniXlsx.MIME}), 'votacion-'+seg(e.titulo).toLowerCase()+'.xlsx'); return; }
    try{ if(est) await q(T('encuestas').update({estado:est.dataset.est}).eq('id',id)); else if(await confirmBox('¿Eliminar la encuesta y sus votos?')) await q(T('encuestas').delete().eq('id',id)); w.reload(); }catch(err){ toast('Error: '+errMsg(err)); } });
};
function formEncuesta(){
  const m=modal(`<h3>Nueva encuesta</h3><form id="fEn"><label class="f"><span>Pregunta</span><input type="text" name="titulo" required placeholder="Ej: ¿Aprobamos pintar la fachada?"></label>
  <label class="f"><span>Tipo de votación</span><select name="tipo"><option value="sondeo">Sondeo de opinión: un voto por unidad, solo se ven los totales</option><option value="asamblea">Materia de asamblea: el voto pesa según la alícuota y se ve qué votó cada unidad</option></select></label>
  <label class="f"><span>Detalle (opcional)</span><textarea name="descripcion"></textarea></label>
  <label class="f"><span>Opciones (una por línea)</span><textarea name="opciones" required>${['Sí','No','Me abstengo'].join('\n')}</textarea></label>
  <label class="f"><span>Último día para votar (opcional)</span><input type="date" name="cierra" min="${todayStr()}"></label>
  <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="solo_propietarios"> Solo votan propietarios</label>
  <p class="small muted" id="enAyuda"></p>
  <button class="btn full">Publicar encuesta</button></form>`);
  const AY={sondeo:'Cada unidad emite un voto y puede cambiarlo mientras la encuesta esté abierta. Nadie ve el voto de otra unidad, solo los totales.', asamblea:'Cada unidad vota con el peso de su alícuota y puede cambiar su voto mientras esté abierta. El voto no es secreto: la comunidad ve qué unidades apoyan cada opción, y el comité puede descargar el detalle. Revisa antes que las alícuotas estén cargadas en Administración → Unidades.'};
  const ayuda=()=>{ const t=$('[name=tipo]',m).value; $('#enAyuda',m).textContent=AY[t]+' El tipo y las opciones no se pueden cambiar después de publicar.'; }; ayuda();
  $('[name=tipo]',m).addEventListener('change',()=>{ $('[name=solo_propietarios]',m).checked=$('[name=tipo]',m).value==='asamblea'; ayuda(); });
  $('#fEn',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target);
    const opciones=[...new Set(d.opciones.split('\n').map(x=>x.trim()).filter(Boolean))]; if(opciones.length<2){ toast('Escribe al menos dos opciones'); return; }
    busy(b,true); try{ await q(T('encuestas').insert({titulo:d.titulo.trim(), tipo:d.tipo==='asamblea'?'asamblea':'sondeo', descripcion:d.descripcion.trim(), opciones, cierra:d.cierra||null, solo_propietarios:!!d.solo_propietarios, uid:S.uid})); closeModal(); toast('Encuesta publicada'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}

// ENCOMIENDAS
VIEWS.encomiendas = function(){
  const r=role(); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Encomiendas</h1>${!resid?`<div style="margin-bottom:10px"><button class="btn" id="bNewE">+ Registrar encomienda</button></div>`:''}<div class="tabs" id="eTabs"><button data-t="pend" class="on">Por retirar</button><button data-t="ent">Entregadas</button></div><div id="eList" class="list"></div>`);
  $('#bNewE')?.addEventListener('click',()=>{ const m=modal(`<h3>Registrar encomienda</h3><form id="fE"><label class="f"><span>Departamento</span><input type="text" name="depto" list="dl" required><datalist id="dl">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f"><span>Descripción</span><input type="text" name="desc" placeholder="Caja mediana, sobre, etc." required></label><label class="f"><span>Empresa / remitente</span><input type="text" name="courier" placeholder="Chilexpress, Mercado Libre…"></label><label class="f"><span>Foto (opcional)</span><input type="file" name="foto" accept="image/*" capture="environment"></label><button class="btn full">Registrar</button></form>`);
    $('#fE',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ const f=$('[name=foto]',m).files[0]; const foto=f?await uploadImage(f,'encomiendas'):''; await q(T('encomiendas').insert({depto:d.depto.trim(), descripcion:d.desc.trim(), courier:d.courier.trim(), foto, recibido_por:S.uid, entregado:false})); closeModal(); toast('Encomienda registrada'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); });
  let tab='pend', docs=[]; $('#eTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#eTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  const draw=()=>{ const el=$('#eList'); if(!el) return; let d=docs; if(resid) d=d.filter(x=>x.depto===myDepto()); d=d.filter(x=>tab==='pend'?!x.entregado:x.entregado); el.innerHTML=d.map(x=>`<div class="item static"><div class="hd"><b>${resid?'':'Depto '+esc(x.depto)+' · '}${esc(x.descripcion)}</b><span class="pill ${x.entregado?'ok':'wa'}">${x.entregado?'Entregada':'Por retirar'}</span></div><div class="meta">${esc(x.courier||'')} · recibida ${fmtDate(x.ts)}${x.entregado?' · entregada '+fmtDate(x.entregado_at)+(x.retirado_por?' a '+esc(x.retirado_por):''):''}</div>${x.foto?`<div class="photos"><img data-f="${esc(x.foto)}" data-img="${esc(x.foto)}"></div>`:''}${!resid&&!x.entregado?`<div style="margin-top:8px"><button class="btn ok sm" data-ent="${x.id}">Marcar entregada</button></div>`:''}</div>`).join('')||'<div class="empty">Nada por aquí</div>'; };
  $('#eList').addEventListener('click', async e=>{ const img=e.target.closest('[data-img]'); if(img) return viewImg(img.dataset.img); const b=e.target.closest('[data-ent]'); if(b){ const quien=await askText('¿Quién retira? (nombre, opcional)'); if(quien===null) return; try{ await q(T('encomiendas').update({entregado:true, entregado_at:now(), entregado_por:S.uid, retirado_por:quien}).eq('id',b.dataset.ent)); toast('Entregada'); }catch(err){ toast(errMsg(err)); } } });
  watch('encomiendas', ()=>q(T('encomiendas').select('*').order('ts',{ascending:false}).limit(500)), rows=>{ docs=rows; draw(); });
};

// VISITAS
VIEWS.visitas = function(){
  const r=role(); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Visitas</h1><div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bNewV">+ ${resid?'Anunciar visita':'Registrar visita'}</button>${resid?'':`<button class="btn sec" id="bScan">📷 Escanear QR</button><input type="text" id="vCode" placeholder="o código de la visita" style="width:190px" autocapitalize="characters" autocomplete="off"><button class="btn sec" id="bVCode">Buscar</button>`}</div>${resid?'<div id="vEst"></div>':''}${resid?'<p class="small muted">Al anunciar una visita obtienes un QR para enviarle. En conserjería lo escanean y queda registrado su ingreso.</p>':''}<div class="tabs" id="vTabs"><button data-t="hoy" class="on">Hoy</button><button data-t="prox">Próximas</button><button data-t="hist">Historial</button></div><div id="vList" class="list"></div>`);
  $('#bNewV').addEventListener('click',()=>{ const m=modal(`<h3>${resid?'Anunciar visita':'Registrar visita'}</h3><form id="fV">${resid?'':`<label class="f"><span>Departamento</span><input type="text" name="depto" list="dl" required><datalist id="dl">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>`}<label class="f"><span>Nombre del visitante</span><input type="text" name="nombre" required></label><div class="row"><label class="f grow"><span>RUT / documento</span><input type="text" name="rut"></label><label class="f grow"><span id="lPat">Patente (opcional)</span><input type="text" name="patente" autocapitalize="characters" autocomplete="off"></label></div><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="estacionamiento"> Necesita estacionamiento de visitas</label><div class="row"><label class="f grow"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}" required></label><label class="f grow"><span>Hora aprox.</span><input type="time" name="hora"></label></div><label class="f"><span>Nota</span><input type="text" name="nota" placeholder="Ej: delivery, técnico, familiar"></label><button class="btn full">Guardar</button></form>`);
    const pat=()=>{ const ob=!!S.cfg?.visita_patente && $('[name=estacionamiento]',m).checked; $('[name=patente]',m).required=ob; $('#lPat',m).textContent=ob?'Patente (obligatoria para estacionar)':'Patente (opcional)'; }; $('[name=estacionamiento]',m).addEventListener('change',pat); pat();
    $('#fV',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ const rows=await q(T('visitas').insert({depto:resid?myDepto():d.depto.trim(), nombre:d.nombre.trim(), rut:d.rut.trim(), patente:d.patente.trim().toUpperCase(), estacionamiento:!!d.estacionamiento, fecha:d.fecha, hora:d.hora, nota:d.nota.trim(), estado:resid?'anunciada':'ingreso', ingreso_at:resid?null:now(), uid:S.uid}).select()); closeModal(); toast('Guardado'); if(resid&&rows[0]?.codigo) qrVisita(rows[0]); }catch(err){ toast('Error: '+errMsg(err)); } }); });
  let tab='hoy', docs=[]; $('#vTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#vTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  const EV={anunciada:['Anunciada','in'],ingreso:['En el edificio','ok'],salida:['Salió','mu'],no_llego:['No llegó','mu']};
  const draw=()=>{ const el=$('#vList'); if(!el) return; const hoy=todayStr(); let d=docs; if(resid) d=d.filter(x=>x.depto===myDepto()); if(tab==='hoy') d=d.filter(x=>x.fecha===hoy); else if(tab==='prox') d=d.filter(x=>x.fecha>hoy); else d=d.filter(x=>x.fecha<hoy); d=sortBy(d,x=>x.fecha+(x.hora||''),tab==='hist');
    el.innerHTML=d.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.nombre)}${resid?'':' → Depto '+esc(x.depto)}</b>${pillOf(EV,x.estado)}</div><div class="meta">${fmtDay(x.fecha)} ${esc(x.hora||'')}${x.rut?' · '+esc(x.rut):''}${x.estacionamiento?' · 🅿️ Estacionamiento':''}${x.patente?' · '+esc(x.patente):''}${x.nota?' · '+esc(x.nota):''}${x.ingreso_at?' · ingreso '+fmtDate(x.ingreso_at):''}${x.salida_at?' · salida '+fmtDate(x.salida_at):''}</div>
    ${!resid?`<div class="row" style="margin-top:8px;gap:6px">${x.estado==='anunciada'?`<button class="btn ok sm" data-in="${x.id}">Registrar ingreso</button>`:''}${x.estado==='ingreso'?`<button class="btn sec sm" data-out="${x.id}">Registrar salida</button>`:''}</div>`:(x.estado==='anunciada'?`<div class="row" style="margin-top:8px;gap:6px">${x.codigo?`<button class="btn sm" data-qr="${x.id}">Ver QR</button>`:''}<button class="btn sec sm" data-del="${x.id}">Cancelar</button></div>`:'')}</div>`).join('')||'<div class="empty">Sin visitas</div>'; };
  // Conserjería: abrir la ficha de una visita desde el QR escaneado o el código escrito
  const fichaVisita=v=>{ const m=modal(`<h3>${esc(v.nombre)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillOf(EV,v.estado)}<b>Depto ${esc(v.depto)}</b>${v.estacionamiento?`<span class="pill in">🅿️ Estacionamiento${v.patente?' · '+esc(v.patente):''}</span>`:''}</div>
    ${v.fecha!==todayStr()?`<div class="note">Esta visita está anunciada para el ${esc(fmtDay(v.fecha))}, no para hoy.</div>`:''}
    <div class="small muted">${fmtDay(v.fecha)} ${esc(v.hora||'')}${v.rut?' · '+esc(v.rut):''}${v.patente?' · '+esc(v.patente):''}${v.nota?' · '+esc(v.nota):''}${v.ingreso_at?' · ingreso '+fmtDate(v.ingreso_at):''}${v.salida_at?' · salida '+fmtDate(v.salida_at):''}</div>
    <div class="row" style="margin-top:14px;justify-content:flex-end">${v.estado==='anunciada'?'<button class="btn ok" id="fvIn">Registrar ingreso</button>':v.estado==='ingreso'?'<button class="btn" id="fvOut">Registrar salida</button>':''}<button class="btn sec" data-close>Cerrar</button></div>`);
    const act=async p=>{ try{ await q(T('visitas').update(p).eq('id',v.id)); closeModal(); toast(p.estado==='ingreso'?'Ingreso registrado':'Salida registrada'); if(p.estado==='ingreso'&&v.estacionamiento&&Object.keys(S.estac).length) location.hash='#estacionamientos--'+v.id; }catch(err){ toast('Error: '+errMsg(err)); } };
    $('#fvIn',m)?.addEventListener('click',()=>act({estado:'ingreso', ingreso_at:now()})); $('#fvOut',m)?.addEventListener('click',()=>act({estado:'salida', salida_at:now()})); };
  const abrirCodigo=async txt=>{ const cod=codigoQR(txt); try{ const v=cod&&await q(T('visitas').select('*').eq('codigo',cod).maybeSingle()); if(v) fichaVisita(v); else toast('No hay una visita con ese código'); }catch(err){ toast('Error: '+errMsg(err)); } };
  $('#bVCode')?.addEventListener('click',()=>abrirCodigo($('#vCode').value));
  $('#vCode')?.addEventListener('keydown',e=>{ if(e.key==='Enter') abrirCodigo(e.target.value); });
  $('#bScan')?.addEventListener('click', async()=>{ try{ const txt=await escanearQR(); if(txt) abrirCodigo(txt); }catch(err){ toast(err.name==='NotAllowedError'?'Debes permitir el uso de la cámara.':errMsg(err)); } });
  $('#vList').addEventListener('click', async e=>{ const i=e.target.closest('[data-in]'), o=e.target.closest('[data-out]'), d=e.target.closest('[data-del]'), k=e.target.closest('[data-qr]'); if(k){ const v=docs.find(x=>x.id===k.dataset.qr); if(v) qrVisita(v); return; } try{ if(i) await q(T('visitas').update({estado:'ingreso', ingreso_at:now()}).eq('id',i.dataset.in)); if(o) await q(T('visitas').update({estado:'salida', salida_at:now()}).eq('id',o.dataset.out)); if(d&&await confirmBox('¿Cancelar la visita anunciada?')) await q(T('visitas').delete().eq('id',d.dataset.del)); }catch(err){ toast('Error: '+errMsg(err)); } });
  watch('visitas', ()=>q(T('visitas').select('*').order('fecha',{ascending:false}).limit(600)), rows=>{ docs=rows; draw(); });
  if(resid&&myDepto()) watch('estacionamiento_usos', ()=>q(T('estacionamiento_usos').select('*').eq('depto',myDepto()).is('fin',null)), us=>{ const el=$('#vEst'); if(!el) return; const lim=Number(S.cfg?.est_aviso_min)||0;
    el.innerHTML=us.map(u=>`<div class="${u.aviso_admin_at?'err':u.alerta_residente_at?'note':'info'}">🅿️ Tu visita ocupa el estacionamiento <b>${esc(u.est_nombre)}</b>${u.patente?' ('+esc(u.patente)+')':''} desde las ${horaDe(u.inicio)}: lleva ${durTxt(Date.now()-new Date(u.inicio))}.${lim?' Tiempo máximo: '+durTxt(lim*60000)+'.':''}${u.aviso_admin_at?' Se informó a la administración por exceder el tiempo.':''}</div>`).join(''); }, {silent:true});
};

// QR de acceso de visitas. El QR solo lleva un código aleatorio (ningún dato personal);
// quien lo lee necesita sesión de conserjería para ver a qué visita corresponde.
const QR_PRE='MIEDIFICIO-VISITA:';
const codigoQR=txt=>(String(txt||'').trim().toUpperCase().match(/([0-9A-F]{8})$/)||[])[1]||'';
function qrCanvas(texto, titulo, lineas){
  const qr=window.qrcode(0,'M'); qr.addData(texto); qr.make();
  const n=qr.getModuleCount(), px=10, mar=4*px, W=n*px+2*mar, top=48, H=top+W+lineas.length*24+10;
  const c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,W,H); g.fillStyle='#000';
  for(let r=0;r<n;r++) for(let k=0;k<n;k++) if(qr.isDark(r,k)) g.fillRect(mar+k*px, top+mar+r*px, px, px);
  g.textAlign='center'; g.fillStyle='#141a26'; g.font='600 19px system-ui,sans-serif'; g.fillText(titulo, W/2, 36, W-24);
  g.font='15px system-ui,sans-serif'; lineas.forEach((l,i)=>g.fillText(l, W/2, top+W+8+i*24, W-24));
  return c;
}
function qrVisita(v){
  const c=qrCanvas(QR_PRE+v.codigo, S.cfg?.nombre||'Mi Edificio', ['Visita: '+v.nombre, fmtDay(v.fecha)+(v.hora?' '+v.hora:'')+' · Depto '+v.depto, 'Código '+v.codigo]);
  const m=modal(`<h3>QR de acceso</h3><p class="small muted">Envía esta imagen a tu visita. En conserjería la escanean para registrar su ingreso; si no se puede leer, sirve el código.</p><div class="center" id="qrBox"></div><div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="qrShare">Compartir</button><button class="btn sec" data-close>Cerrar</button></div>`);
  c.id='qrImg'; c.style.cssText='max-width:100%;height:auto;border:1px solid var(--bd);border-radius:10px'; $('#qrBox',m).appendChild(c);
  $('#qrShare',m).addEventListener('click',()=>c.toBlob(async b=>{ const f=new File([b],'visita-'+v.codigo+'.png',{type:'image/png'});
    try{ if(navigator.canShare?.({files:[f]})){ await navigator.share({files:[f], title:'Acceso de visita'}); return; } }catch(e){ if(e.name==='AbortError') return; }
    descargar(b, f.name); },'image/png'));
}
function cargarScript(src){ return new Promise((res,rej)=>{ if($(`script[src="${src}"]`)) return res(); const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('No se pudo cargar el lector de QR')); document.head.appendChild(s); }); }
// Abre la cámara y devuelve el texto del primer QR leído (null si se cancela).
// Usa el lector del navegador si existe; si no (iPhone, Firefox), la librería jsQR.
async function escanearQR(){
  if(!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara. Escribe el código.');
  let det=null; try{ if('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) det=new window.BarcodeDetector({formats:['qr_code']}); }catch(e){}
  if(!det) await cargarScript('vendor/jsQR.js');
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false});
  return new Promise(res=>{
    const m=modal(`<h3>Escanear QR</h3><video id="qrVid" playsinline muted style="width:100%;border-radius:10px;background:#000"></video><p class="small muted center">Apunta la cámara al QR de la visita.</p><div class="center"><button class="btn sec" data-close>Cancelar</button></div>`);
    const v=$('#qrVid',m); v.srcObject=stream; v.play().catch(()=>{}); const cv=document.createElement('canvas'); let fin=false;
    const cerrar=val=>{ if(fin) return; fin=true; stream.getTracks().forEach(t=>t.stop()); if(document.body.contains(m)) closeModal(); res(val); };
    const tick=async()=>{ if(fin) return; if(!document.body.contains(m)) return cerrar(null);
      try{ if(v.readyState>=2 && v.videoWidth){ let txt='';
        if(det){ txt=(await det.detect(v))[0]?.rawValue||''; }
        else { cv.width=v.videoWidth; cv.height=v.videoHeight; const g=cv.getContext('2d',{willReadFrequently:true}); g.drawImage(v,0,0); const d=g.getImageData(0,0,cv.width,cv.height); txt=window.jsQR(d.data,d.width,d.height)?.data||''; }
        if(txt) return cerrar(txt); } }catch(e){}
      setTimeout(tick,200); };
    tick();
  });
}

// ESTACIONAMIENTOS DE VISITA
// Conserjería marca ocupado/libre; la base de datos pone las horas y envía los avisos por tiempo.
const estOrden = ()=>Object.values(S.estac).sort((a,b)=>(a.orden-b.orden)||a.nombre.localeCompare(b.nombre,undefined,{numeric:true}));
VIEWS.estacionamientos = function(param){
  const r=role(); const opera=['conserje','admin'].includes(r);
  const lim=()=>({a:Number(S.cfg?.est_alerta_min)||0, m:Number(S.cfg?.est_aviso_min)||0});
  setMain(`<h1>Estacionamientos de visita</h1><div id="esPend"></div>
  <div class="tabs" id="esTabs"><button data-t="ahora" class="on">Ahora</button><button data-t="exc">Excedidos</button><button data-t="hist">Historial</button></div><div id="esBody"></div>`);
  let usos=[], visHoy=[], tab='ahora', pend=null;
  const minDe=u=>(new Date(u.fin||Date.now())-new Date(u.inicio))/60000;
  const nivel=u=>{ const {a,m}=lim(), x=minDe(u); return m&&x>=m?'er':a&&x>=a?'wa':''; };
  const filaUso=u=>`<div class="item ${u.fin?'static':''}" ${u.fin?'':`data-u="${u.id}"`}><div class="hd"><b>${esc(u.est_nombre||'—')} · Depto ${esc(u.depto)}${u.patente?' · '+esc(u.patente):''}</b><span class="row" style="gap:4px">${u.aviso_admin_at?'<span class="pill er">Excedido</span>':''}<span class="pill ${u.fin?'mu':'in'}">${u.fin?'Liberado':'Ocupado'}</span></span></div><div class="meta">${fmtDate(u.inicio)}${u.fin?' → '+fmtDate(u.fin):''} · ${durTxt(minDe(u)*60000)}${u.aviso_admin_at&&lim().m?' · excede el máximo de '+durTxt(lim().m*60000):''}${u.nota?' · '+esc(u.nota):''}</div>${tab==='exc'&&['admin','comite','conserje'].includes(role())?`<div class="row acc"><button class="btn sec sm" data-multa="${u.id}">Abrir caso de multa</button></div>`:''}</div>`;
  const draw=()=>{ const el=$('#esBody'); if(!el) return; const sp=estOrden(); const ab={}; usos.filter(u=>!u.fin).forEach(u=>ab[u.estacionamiento_id]=u); const {a,m}=lim();
    $('#esPend').innerHTML=pend?`<div class="info">Elige un estacionamiento libre para <b>${esc(pend.nombre)}</b> · Depto ${esc(pend.depto)}${pend.patente?' · '+esc(pend.patente):''}. <a href="#" id="esNoPend">Cancelar</a></div>`:'';
    if(tab==='ahora'){
      el.innerHTML=!sp.length?`<div class="empty">No hay estacionamientos de visita definidos.${isAdmin()?' Créalos en <a href="#admin--estacionamientos">Administración → Estacionamientos</a>.':''}</div>`
      :`<p class="small muted">${Object.keys(ab).length} de ${sp.length} ocupados${a?' · aviso al residente a los '+durTxt(a*60000):''}${m?' · informe a administración a los '+durTxt(m*60000):''}</p>
      <div class="grid">${sp.map(e=>{ const u=ab[e.id]; return `<div class="tile est ${u?'oc '+nivel(u):''}" data-e="${e.id}"><div class="row" style="justify-content:space-between;gap:6px"><b style="font-size:17px">${esc(e.nombre)}</b>${e.reservado?`<span class="pill in">${esc(e.reservado)}</span>`:''}</div>${u?`<span>Depto ${esc(u.depto)}${u.patente?' · '+esc(u.patente):''}</span><small>${durTxt(minDe(u)*60000)} · desde las ${horaDe(u.inicio)}</small>`:'<small>Libre</small>'}</div>`; }).join('')}</div>`;
    } else { const d=usos.filter(u=>tab==='exc'?u.aviso_admin_at:true); el.innerHTML=(tab==='exc'?'<p class="small muted">Usos que superaron el tiempo máximo y fueron informados a administración y comité.</p>':'')+`<div class="list">${d.map(filaUso).join('')||'<div class="empty">Nada por aquí</div>'}</div>`; } };
  const ocupar=e=>{ const cand=visHoy.filter(v=>v.estacionamiento&&['anunciada','ingreso'].includes(v.estado)&&!usos.some(u=>!u.fin&&u.visita_id===v.id));
    const m=modal(`<h3>Ocupar ${esc(e.nombre)}</h3>${e.reservado?`<div class="note">Reservado: ${esc(e.reservado)}</div>`:''}<form id="fOc">
    ${cand.length?`<label class="f"><span>Visita anunciada para hoy (opcional)</span><select name="visita_id"><option value="">— Sin anuncio —</option>${cand.map(v=>`<option value="${v.id}" ${pend?.id===v.id?'selected':''}>${esc(v.nombre)} · Depto ${esc(v.depto)}${v.patente?' · '+esc(v.patente):''}</option>`).join('')}</select></label>`:''}
    <div class="row"><label class="f grow"><span>Departamento que visita</span><input type="text" name="depto" list="dlEs" required><datalist id="dlEs">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f grow"><span>Patente${S.cfg?.visita_patente?'':' (opcional)'}</span><input type="text" name="patente" autocapitalize="characters" autocomplete="off" ${S.cfg?.visita_patente?'required':''}></label></div>
    <label class="f"><span>Nota</span><input type="text" name="nota" placeholder="Opcional"></label><button class="btn full">Marcar ocupado</button></form>`);
    const sel=$('[name=visita_id]',m); const fill=()=>{ const v=cand.find(x=>x.id===sel?.value)||(sel?null:pend); if(v){ $('[name=depto]',m).value=v.depto; $('[name=patente]',m).value=v.patente||''; } }; sel?.addEventListener('change',fill); fill();
    $('#fOc',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const b=$('button',ev.target); busy(b,true); try{ await q(T('estacionamiento_usos').insert({estacionamiento_id:e.id, depto:d.depto.trim(), patente:d.patente.trim().toUpperCase(), visita_id:d.visita_id||null, nota:d.nota.trim()})); pend=null; closeModal(); toast(e.nombre+' ocupado'); w.reload(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); };
  const ficha=u=>{ const {a,m:mx}=lim(); const m=modal(`<h3>${esc(u.est_nombre)} · Depto ${esc(u.depto)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${u.patente?`<span class="pill mu">${esc(u.patente)}</span>`:''}<span class="pill ${nivel(u)||'in'}">${durTxt(minDe(u)*60000)}</span></div>
    <div class="small muted">Ocupado desde las ${horaDe(u.inicio)} (${fmtDate(u.inicio)}) · registró ${esc(userName(u.registrado_por))}${u.nota?' · '+esc(u.nota):''}</div>
    <div class="timeline" style="margin-top:12px">${a?`<div><b>Aviso al residente</b> <span class="muted">· ${u.alerta_residente_at?'enviado '+fmtDate(u.alerta_residente_at):'a los '+durTxt(a*60000)}</span></div>`:''}${mx?`<div><b>Informe a administración y comité</b> <span class="muted">· ${u.aviso_admin_at?'enviado '+fmtDate(u.aviso_admin_at):'a los '+durTxt(mx*60000)}</span></div>`:''}</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px">${opera?'<button class="btn ok" id="esLib">Liberar</button>':''}<button class="btn sec" data-close>Cerrar</button></div>`);
    $('#esLib',m)?.addEventListener('click', async()=>{ try{ await q(T('estacionamiento_usos').update({fin:now()}).eq('id',u.id)); closeModal(); toast(u.est_nombre+' liberado'); w.reload(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  $('#esTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#esTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  $('#esPend').addEventListener('click',e=>{ if(e.target.id==='esNoPend'){ e.preventDefault(); pend=null; draw(); } });
  $('#esBody').addEventListener('click',e=>{ const mu=e.target.closest('[data-multa]'); if(mu){ e.preventDefault(); const u=usos.find(x=>x.id===mu.dataset.multa); formCaso({depto:u.depto, origen:'estacionamiento', descripcion:`Estacionamiento de visita ${u.est_nombre}${u.patente?' (patente '+u.patente+')':''} ocupado desde ${fmtDate(u.inicio)} durante ${durTxt(minDe(u)*60000)}; el máximo es ${durTxt(lim().m*60000)}. Registró ${userName(u.registrado_por)}.`}); return; }
    const t=e.target.closest('[data-e]'), it=e.target.closest('[data-u]');
    if(it){ const u=usos.find(x=>x.id===it.dataset.u); if(u) ficha(u); return; } if(!t) return;
    const u=usos.find(x=>!x.fin&&x.estacionamiento_id===t.dataset.e); if(u) ficha(u); else if(opera) ocupar(S.estac[t.dataset.e]); });
  const d0=new Date(); d0.setDate(d0.getDate()-90);
  const w=watch('estacionamiento_usos', ()=>q(T('estacionamiento_usos').select('*').gte('inicio',d0.toISOString()).order('inicio',{ascending:false}).limit(1000)), rows=>{ usos=rows; if(!$('.modal')) draw(); });
  if(opera) watch('visitas', ()=>q(T('visitas').select('*').eq('fecha',todayStr())), rows=>{ visHoy=rows; if(param){ pend=rows.find(v=>v.id===param)||null; param=null; if(pend) draw(); } }, {silent:true});
  // el tiempo corre: redibujar cada 30 s y, como respaldo de la tarea programada, pedir la revisión de plazos
  const rev=()=>{ if(lim().a||lim().m) sb.rpc('revisar_estacionamientos').then(()=>{},()=>{}); };
  const iv=setInterval(()=>{ if(tab==='ahora'&&!$('.modal')) draw(); },30000), iv2=setInterval(rev,60000); rev();
  S.viewSubs.push(()=>{ clearInterval(iv); clearInterval(iv2); });
  REFRESH.estacionamientos=draw; draw();
};

// DOCUMENTOS
VIEWS.documentos = function(){
  const puede=['comite','admin'].includes(role()); const CATS=['Reglamento','Actas','Balances','Contratos','Certificados','Otros'];
  setMain(`<h1>Documentos</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewD">+ Subir documento</button></div>':''}<div id="dList"></div>`);
  $('#bNewD')?.addEventListener('click',()=>{ const m=modal(`<h3>Subir documento</h3><form id="fD"><label class="f"><span>Nombre</span><input type="text" name="nombre" required></label><label class="f"><span>Categoría</span><select name="cat">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></label><label class="f"><span>Archivo (PDF, imagen, texto)</span><input type="file" name="f" required accept="application/pdf,image/*,.txt,.csv,.md,.xlsx,.docx"></label><button class="btn full">Subir</button></form>`);
    $('#fD',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Subiendo…'); try{ const f=$('[name=f]',m).files[0]; const path=await uploadFile(f,'documentos'); await q(T('documentos').insert({nombre:d.nombre.trim(), cat:d.cat, path, tipo:f.type, uid:S.uid})); closeModal(); toast('Documento subido'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); });
  watch('documentos', ()=>q(T('documentos').select('*').order('ts',{ascending:false}).limit(300)), docs=>{ const el=$('#dList'); if(!el) return; const byCat={}; docs.forEach(d=>(byCat[d.cat]=byCat[d.cat]||[]).push(d));
    el.innerHTML = docs.length? Object.entries(byCat).map(([c,arr])=>`<h2>${esc(c)}</h2><div class="list">${arr.map(d=>`<div class="item static"><div class="hd"><b><a data-f="${esc(d.path)}" target="_blank">${esc(d.nombre)}</a></b><span class="muted small">${fmtDate(d.ts)}</span></div>${puede?`<div class="meta"><a href="#" data-del="${d.id}" data-p="${esc(d.path)}">Eliminar</a></div>`:''}</div>`).join('')}</div>`).join('') : '<div class="empty">Sin documentos</div>'; });
  $('#dList').addEventListener('click', async e=>{ const d=e.target.closest('[data-del]'); if(!d) return; e.preventDefault(); if(await confirmBox('¿Eliminar el documento?')){ try{ await q(T('documentos').delete().eq('id',d.dataset.del)); await sb.storage.from('fotos').remove([d.dataset.p]); }catch(err){ toast(errMsg(err)); } } });
};

// RONDAS NFC / BITÁCORA
VIEWS.rondas = function(){
  const r=role(); const conserje=r==='conserje'||r==='admin';
  const activos=()=>Object.values(S.activos);
  setMain(`<h1>Rondas y bitácora</h1>
  ${conserje?`<div class="card"><h3>Registrar</h3><div class="row wrap" style="gap:8px"><button class="btn" id="bNFC">📡 Escanear tag NFC</button><input type="text" id="codeIn" placeholder="o código del tag" style="width:160px"><button class="btn sec" id="bCode">Buscar</button></div><div id="nfcMsg" class="small muted" style="margin-top:6px">${('NDEFReader' in window)?'NFC disponible en este dispositivo.':'Este navegador no soporta Web NFC (solo Chrome en Android). Usa el código del tag o elige el activo de la lista.'}</div>
  <h3 style="margin-top:14px">Activos</h3><div class="grid" id="actGrid"></div></div>`:''}
  <div class="card"><div class="row"><h3 class="grow" style="margin:0">Cumplimiento del día</h3><input type="date" id="repDia" value="${todayStr()}" style="width:auto"></div><div id="rep" style="margin-top:10px"></div></div>
  <h2>Bitácora</h2><div id="bit" class="list"></div>`);
  let regs=[];
  const drawActs=()=>{ const g=$('#actGrid'); if(g) g.innerHTML=activos().map(a=>`<div class="tile" data-act="${a.id}" style="cursor:pointer"><span class="ic">${a.icono||'📍'}</span><b>${esc(a.nombre)}</b><small>${esc(a.ubicacion||'')}</small></div>`).join('')||'<div class="muted">Sin activos. Créalos en Administración → Activos.</div>'; };
  const porDia=()=>{ const d=$('#repDia')?.value; return regs.filter(x=>x.ts.slice(0,10)===d); };
  function drawRep(){ const el=$('#rep'); if(!el) return; const d=$('#repDia').value; const rs=porDia(); const acts=activos();
    const rows=acts.map(a=>{ const req=a.requisitos||[]; const mine=rs.filter(x=>x.activo_id===a.id); if(!req.length) return `<tr><td>${esc(a.nombre)}</td><td colspan="3" class="muted">Sin requisitos definidos · ${mine.length} registros</td></tr>`;
      return req.map((qq,i)=>{ const hrs=Number(qq.frecuenciaHoras)||24; const esHoy=d===todayStr(); const horas= esHoy? (new Date().getHours()+1) : 24; const esperado=Math.max(1,Math.floor(horas/hrs)); const hechos=mine.filter(x=>x.tipo===qq.tipo); const buckets=new Set(hechos.map(x=>Math.floor(new Date(x.ts).getHours()/hrs))); const ok=Math.min(buckets.size,esperado); const pct=Math.round(ok/esperado*100);
        return `<tr>${i===0?`<td rowspan="${req.length}">${esc(a.nombre)}</td>`:''}<td>${esc(qq.descripcion||TIPOS[qq.tipo])}<br><span class="muted small">cada ${hrs} h</span></td><td class="num">${ok}/${esperado}</td><td style="min-width:90px"><div class="bar"><i style="width:${pct}%;background:${pct>=100?'var(--ok)':pct>=50?'var(--wa)':'var(--er)'}"></i></div></td></tr>`; }).join(''); }).join('');
    el.innerHTML = acts.length? `<table><thead><tr><th>Activo</th><th>Requisito</th><th class="num">Hecho</th><th>Cumpl.</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="muted">Sin activos.</div>'; }
  function drawBit(){ const el=$('#bit'); if(!el) return; const rs=sortBy(porDia(),x=>x.ts,true); el.innerHTML=rs.map(x=>{const a=S.activos[x.activo_id]; return `<div class="item static"><div class="hd"><b>${esc(a?.nombre||'Activo eliminado')} · ${esc(TIPOS[x.tipo]||x.tipo)}</b><span class="muted small">${fmtDate(x.ts)}</span></div><div class="meta">${esc(userName(x.uid))}${x.valor?' · valor: <b>'+esc(x.valor)+'</b>':''}${x.nota?' · '+esc(x.nota):''}${x.via_nfc?' · 📡 NFC':''}</div>${x.foto?`<div class="photos"><img data-f="${esc(x.foto)}" data-img="${esc(x.foto)}"></div>`:''}</div>`;}).join('')||'<div class="empty">Sin registros ese día</div>'; }
  const all=()=>{ drawActs(); drawRep(); drawBit(); };
  $('#repDia').addEventListener('change',()=>{drawRep();drawBit();});
  $('#bit').addEventListener('click',e=>{ const img=e.target.closest('[data-img]'); if(img) viewImg(img.dataset.img); });
  $('#actGrid')?.addEventListener('click',e=>{ const t=e.target.closest('[data-act]'); if(t) registrarActivo(t.dataset.act,false); });
  $('#bCode')?.addEventListener('click',()=>{ const c=$('#codeIn').value.trim(); const a=activos().find(x=>(x.nfc_tag||'').toLowerCase()===c.toLowerCase()); if(a) registrarActivo(a.id,true); else toast('No hay activo con ese código'); });
  $('#bNFC')?.addEventListener('click', async()=>{ if(!('NDEFReader' in window)){ toast('NFC no disponible aquí'); return; } try{ const nd=new NDEFReader(); await nd.scan(); $('#nfcMsg').textContent='Acerca el teléfono al tag…'; nd.onreading=ev=>{ let code=ev.serialNumber||''; for(const rec of ev.message.records){ try{ if(rec.recordType==='text') code=new TextDecoder(rec.encoding||'utf-8').decode(rec.data); else if(rec.recordType==='url') code=new TextDecoder().decode(rec.data); }catch(e){} } const a=activos().find(x=>x.nfc_tag&&(code.toLowerCase().includes(x.nfc_tag.toLowerCase())||x.nfc_tag.toLowerCase()===(ev.serialNumber||'').toLowerCase())); $('#nfcMsg').textContent='Tag leído: '+code; if(a) registrarActivo(a.id,true); else toast('Tag no asociado a ningún activo: '+code); }; }catch(e){ $('#nfcMsg').textContent='No se pudo iniciar NFC: '+errMsg(e); } });
  const d0=new Date(); d0.setDate(d0.getDate()-45);
  watch('registros', ()=>q(T('registros').select('*').gte('ts',d0.toISOString()).order('ts',{ascending:false}).limit(3000)), rows=>{ regs=rows; all(); });
  REFRESH.rondas=all; all();
};
function registrarActivo(id, viaNFC){
  const a=S.activos[id]; if(!a) return; const req=a.requisitos||[];
  const tipos=req.map(x=>x.tipo).concat(Object.keys(TIPOS)).filter((v,i,arr)=>arr.indexOf(v)===i);
  const m=modal(`<h3>${esc(a.nombre)}</h3><div class="small muted" style="margin-bottom:10px">${esc(a.ubicacion||'')}${viaNFC?' · 📡 leído por NFC':''}</div><form id="fR">
  <label class="f"><span>Tipo de registro</span><select name="tipo" id="rTipo">${tipos.map(t=>{const rq=req.find(x=>x.tipo===t); return `<option value="${t}">${TIPOS[t]}${rq?' · '+esc(rq.descripcion||''):''}</option>`;}).join('')}</select></label>
  <label class="f" id="lVal" style="display:none"><span>Valor leído (ej: nivel estanque, kWh, °C)</span><input type="text" name="valor"></label>
  <label class="f"><span>Nota</span><input type="text" name="nota" placeholder="Opcional"></label>
  <label class="f"><span>Foto</span><input type="file" name="foto" accept="image/*" capture="environment"></label>
  <button class="btn full" id="sR">Registrar</button></form>`);
  const upd=()=>{ $('#lVal',m).style.display=$('#rTipo',m).value==='lectura'?'block':'none'; }; $('#rTipo',m).addEventListener('change',upd); upd();
  $('#fR',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('#sR',m); busy(b,true); const d=formData(e.target); try{ const f=$('[name=foto]',m).files[0]; const rq=req.find(x=>x.tipo===d.tipo); if(rq?.fotoObligatoria&&!f){ toast('Este registro requiere foto'); busy(b,false); return; } const foto=f?await uploadImage(f,'rondas'):''; await q(T('registros').insert({activo_id:id, tipo:d.tipo, valor:d.valor||'', nota:d.nota.trim(), foto, uid:S.uid, via_nfc:!!viaNFC})); closeModal(); toast('Registrado'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}

// MANTENCIÓN / OT
VIEWS.mantencion = function(param){
  const r=role(); const emp=r==='mantencion';
  setMain(`<h1>Mantención</h1>${isAdmin()?'<div style="margin-bottom:10px"><button class="btn" id="bNewOT">+ Nueva orden de trabajo</button></div>':''}
  ${emp&&!S.me.empresa_id?'<div class="note">Tu usuario no está vinculado a una empresa. Pide a la administración que lo asigne.</div>':''}
  <div class="tabs" id="oTabs"><button data-t="act" class="on">Activas</button><button data-t="cerr">Cerradas</button>${!emp?'<button data-t="plan">Plan preventivo</button>':''}</div><div id="oList" class="list"></div>`);
  $('#bNewOT')?.addEventListener('click',()=>formOT({}));
  let tab='act', docs=[]; $('#oTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#oTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  const draw=()=>{ const el=$('#oList'); if(!el) return; if(tab==='plan') return drawPlan(el); const d=docs.filter(x=>tab==='act'?!['aprobada','rechazada'].includes(x.estado):['aprobada','rechazada'].includes(x.estado));
    el.innerHTML=d.map(x=>`<div class="item" data-o="${x.id}"><div class="hd"><b>${esc(x.titulo)}</b>${pillOf(EST_OT,x.estado)}</div><div class="meta">${esc(S.empresas[x.empresa_id]?.nombre||'Sin empresa')}${x.activo_id?' · '+esc(S.activos[x.activo_id]?.nombre||''):''}${x.fecha_agendada?' · agendada '+fmtDay(x.fecha_agendada):''} · creada ${fmtDate(x.ts)}${Number(x.costo)?' · '+clp(x.costo):''}</div></div>`).join('')||'<div class="empty">Sin órdenes</div>'; };
  function drawPlan(el){ const acts=Object.values(S.activos); const hoy=new Date();
    el.innerHTML=`<div class="card"><table><thead><tr><th>Activo</th><th>Empresa</th><th>Frecuencia</th><th>Última</th><th>Próxima</th><th></th></tr></thead><tbody>${acts.map(a=>{ const f=Number(a.plan_dias)||0; const ult=a.ultima_mantencion||''; let prox='',late=false; if(f&&ult){ const p=new Date(ult+'T00:00:00'); p.setDate(p.getDate()+f); prox=p.toISOString().slice(0,10); late=p<hoy; } return `<tr><td>${esc(a.nombre)}</td><td>${esc(S.empresas[a.empresa_id]?.nombre||'—')}</td><td>${f?'cada '+f+' días':'—'}</td><td>${ult?fmtDay(ult):'—'}</td><td>${prox?`<span class="pill ${late?'er':'ok'}">${fmtDay(prox)}</span>`:'—'}</td><td>${isAdmin()&&f?`<button class="btn sec sm" data-gen="${a.id}">Generar OT</button>`:''}</td></tr>`; }).join('')||'<tr><td colspan="6" class="muted">Sin activos</td></tr>'}</tbody></table><p class="small muted">Define frecuencia y empresa en Administración → Activos. La "última" se actualiza al aprobar una OT preventiva.</p></div>`; }
  $('#oList').addEventListener('click',e=>{ const g=e.target.closest('[data-gen]'); if(g){ const a=S.activos[g.dataset.gen]; return formOT({activo_id:g.dataset.gen, empresa_id:a.empresa_id||'', titulo:'Mantención preventiva: '+a.nombre, descripcion:'Mantención preventiva programada (cada '+a.plan_dias+' días).', preventiva:true}); } const it=e.target.closest('[data-o]'); if(it){ const d=docs.find(x=>x.id===it.dataset.o); if(d) detalleOT(d); } });
  watch('ot', ()=>q(T('ot').select('*').order('ts',{ascending:false}).limit(500)), rows=>{ docs=rows; draw(); if(param){ const d=docs.find(x=>x.id===param); if(d){ detalleOT(d); param=null; } } });
  REFRESH.mantencion=draw;
};
function formOT(pre){
  const emps=Object.values(S.empresas); const acts=Object.values(S.activos);
  const m=modal(`<h3>Nueva orden de trabajo</h3><form id="fO"><label class="f"><span>Título</span><input type="text" name="titulo" value="${esc(pre.titulo||'')}" required></label><label class="f"><span>Descripción</span><textarea name="descripcion" required>${esc(pre.descripcion||'')}</textarea></label>
  <label class="f"><span>Empresa</span><select name="empresa_id" required><option value="">— Elegir —</option>${emps.map(e=>`<option value="${e.id}" ${pre.empresa_id===e.id?'selected':''}>${esc(e.nombre)} (${esc(e.rubro||'')})</option>`).join('')}</select>${emps.length?'':'<span class="small muted">No hay empresas. Créalas en Administración → Empresas.</span>'}</label>
  <label class="f"><span>Activo relacionado</span><select name="activo_id"><option value="">— Ninguno —</option>${acts.map(a=>`<option value="${a.id}" ${pre.activo_id===a.id?'selected':''}>${esc(a.nombre)}</option>`).join('')}</select></label>
  <div class="row"><label class="f grow"><span>Prioridad</span><select name="prioridad">${Object.entries(PRIO).map(([k,v])=>`<option value="${k}" ${k==='media'?'selected':''}>${v[0]}</option>`).join('')}</select></label><label class="f grow"><span>Fecha límite</span><input type="date" name="limite"></label></div>
  <button class="btn full">Crear y asignar</button></form>`);
  $('#fO',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button.full',e.target); busy(b,true); try{ const emp=S.empresas[d.empresa_id]?.nombre||''; const rows=await q(T('ot').insert({titulo:d.titulo.trim(), descripcion:d.descripcion.trim(), empresa_id:d.empresa_id, activo_id:d.activo_id||null, prioridad:d.prioridad, limite:d.limite||null, incidencia_id:pre.incidencia_id||null, preventiva:!!pre.preventiva, fotos_antes:pre.fotos_antes||[], estado:'asignada', uid:S.uid, historial:[{ts:now(),uid:S.uid,accion:'Creada y asignada a '+emp}]}).select());
    const ot=rows[0];
    if(pre.incidencia_id){ const inc=await q(T('incidencias').select('*').eq('id',pre.incidencia_id).maybeSingle()); if(inc) await q(T('incidencias').update({ot_id:ot.id, estado:inc.estado==='abierta'?'en_curso':inc.estado, historial:[...(inc.historial||[]),{ts:now(),uid:S.uid,accion:'OT creada para '+emp}]}).eq('id',inc.id)); }
    closeModal(); toast('OT creada'); location.hash='#mantencion--'+ot.id; }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}
function detalleOT(o){
  const r=role(); const emp=r==='mantencion'&&S.me.empresa_id===o.empresa_id; const adm=isAdmin();
  const upd=p=>q(T('ot').update(p).eq('id',o.id));
  const hist=(accion,extra={})=>[...(o.historial||[]),{ts:now(),uid:S.uid,accion,...extra}];
  const m=modal(`<h3>${esc(o.titulo)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillOf(EST_OT,o.estado)}${pillOf(PRIO,o.prioridad)}${o.preventiva?'<span class="pill mu">Preventiva</span>':''}</div>
  <p style="white-space:pre-wrap">${esc(o.descripcion)}</p>
  <div class="small muted">🏢 ${esc(S.empresas[o.empresa_id]?.nombre||'—')}${o.activo_id?' · 🔩 '+esc(S.activos[o.activo_id]?.nombre||''):''}${o.limite?' · límite '+fmtDay(o.limite):''}${o.fecha_agendada?' · agendada '+fmtDay(o.fecha_agendada)+' '+esc(o.hora_agendada||''):''}${o.incidencia_id&&!emp?` · <a href="#incidencias--${esc(o.incidencia_id)}">Ver incidencia</a>`:''}</div>
  ${o.fotos_antes?.length?`<div class="small" style="margin-top:8px"><b>Antes</b></div><div class="photos">${o.fotos_antes.map(f=>`<img data-f="${esc(f)}" data-img="${esc(f)}">`).join('')}</div>`:''}
  ${o.fotos_despues?.length?`<div class="small" style="margin-top:8px"><b>Después</b></div><div class="photos">${o.fotos_despues.map(f=>`<img data-f="${esc(f)}" data-img="${esc(f)}">`).join('')}</div>`:''}
  ${o.informe?`<div class="card" style="margin-top:10px"><b>Informe técnico</b><div style="white-space:pre-wrap">${esc(o.informe)}</div>${Number(o.costo)?`<div class="small muted">Costo informado: ${clp(o.costo)}</div>`:''}${o.factura?`<a data-f="${esc(o.factura)}" target="_blank">Ver documento adjunto</a>`:''}</div>`:''}
  ${emp?`<h2>Acciones de la empresa</h2><div class="row wrap" style="gap:6px">
    ${o.estado==='asignada'?`<button class="btn ok sm" data-a="aceptar">Aceptar</button><button class="btn dan sm" data-a="rechazar">Rechazar</button>`:''}
    ${['aceptada','agendada'].includes(o.estado)?`<button class="btn sec sm" data-a="agendar">Agendar visita</button><button class="btn sm" data-a="llegada">Registrar llegada</button>`:''}
    ${o.estado==='en_terreno'?`<button class="btn ok sm" data-a="cerrar">Cierre técnico</button>`:''}
  </div>`:''}
  ${adm?`<h2>Acciones de administración</h2><div class="row wrap" style="gap:6px">
    ${o.estado==='cierre_tecnico'?`<button class="btn ok sm" data-a="aprobar">Aprobar y cerrar</button><button class="btn dan sm" data-a="devolver">Devolver a terreno</button>`:''}
    ${o.estado!=='aprobada'?`<button class="btn sec sm" data-a="reasignar">${o.estado==='rechazada'?'Asignar a otra empresa':'Reasignar empresa'}</button>`:''}
  </div>`:''}
  <h2>Historial</h2><div class="timeline">${(o.historial||[]).slice().reverse().map(h=>`<div><b>${esc(h.accion)}</b> <span class="muted">· ${esc(userName(h.uid))} · ${fmtDate(h.ts)}</span>${h.nota?'<br>'+esc(h.nota):''}</div>`).join('')}</div>`);
  m.addEventListener('click', async e=>{ const img=e.target.closest('[data-img]'); if(img) return viewImg(img.dataset.img); const b=e.target.closest('[data-a]'); if(!b) return; const a=b.dataset.a; try{
    if(a==='aceptar'){ await upd({estado:'aceptada', historial:hist('Aceptada por la empresa')}); }
    if(a==='rechazar'){ const n=await askText('Motivo del rechazo'); if(n===null) return; await upd({estado:'rechazada', historial:hist('Rechazada por la empresa',{nota:n})}); }
    if(a==='agendar'){ const mm=modal(`<h3>Agendar visita</h3><form id="fAg"><div class="row"><label class="f grow"><span>Fecha</span><input type="date" name="f" required min="${todayStr()}"></label><label class="f grow"><span>Hora</span><input type="time" name="h"></label></div><button class="btn full">Agendar</button></form>`); $('#fAg',mm).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await upd({estado:'agendada', fecha_agendada:d.f, hora_agendada:d.h, historial:hist('Visita agendada '+d.f+' '+d.h)}); closeModal(); toast('Agendada'); }catch(err){ toast(errMsg(err)); } }); return; }
    if(a==='llegada'){ await upd({estado:'en_terreno', llegada:now(), historial:hist('Técnico en terreno')}); }
    if(a==='cerrar'){ const mm=modal(`<h3>Cierre técnico</h3><form id="fCi"><label class="f"><span>Informe de trabajos realizados</span><textarea name="inf" required style="min-height:120px"></textarea></label><label class="f"><span>Costo (CLP, opcional)</span><input type="text" inputmode="numeric" data-clp name="costo"></label><label class="f"><span>Fotos después</span><input type="file" name="fotos" accept="image/*" capture="environment" multiple></label><label class="f"><span>Cotización / factura (PDF, opcional)</span><input type="file" name="doc" accept="application/pdf,image/*"></label><button class="btn full" id="sCi">Enviar cierre</button></form>`); $('#fCi',mm).addEventListener('submit', async ev=>{ ev.preventDefault(); busy($('#sCi',mm),true,'Subiendo…'); const d=formData(ev.target); try{ const fotos=await subirFotos($('[name=fotos]',mm),'ot'); const df=$('[name=doc]',mm).files[0]; const factura=df?await uploadFile(df,'ot'):''; await upd({estado:'cierre_tecnico', salida:now(), informe:d.inf.trim(), costo:Number(d.costo)||0, fotos_despues:[...(o.fotos_despues||[]),...fotos], factura:factura||o.factura||'', historial:hist('Cierre técnico enviado')}); closeModal(); toast('Cierre enviado a administración'); }catch(err){ toast(errMsg(err)); busy($('#sCi',mm),false); } }); return; }
    if(a==='aprobar'){ await upd({estado:'aprobada', aprobado_at:now(), historial:hist('Aprobada por administración')}); if(o.incidencia_id){ const inc=await q(T('incidencias').select('*').eq('id',o.incidencia_id).maybeSingle()); if(inc) await q(T('incidencias').update({estado:'resuelta', historial:[...(inc.historial||[]),{ts:now(),uid:S.uid,accion:'OT aprobada → resuelta'}]}).eq('id',inc.id)); } if(o.preventiva&&o.activo_id) await q(T('activos').update({ultima_mantencion:todayStr()}).eq('id',o.activo_id)); }
    if(a==='devolver'){ const n=await askText('Qué falta / observaciones'); if(n===null) return; await upd({estado:'en_terreno', historial:hist('Devuelta a terreno',{nota:n})}); }
    if(a==='reasignar'){ const emps=Object.values(S.empresas); const mm=modal(`<h3>Reasignar</h3><form id="fRe"><select name="e" required>${emps.map(e=>`<option value="${e.id}" ${e.id===o.empresa_id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select><button class="btn full" style="margin-top:10px">Reasignar</button></form>`); $('#fRe',mm).addEventListener('submit', async ev=>{ ev.preventDefault(); const eid=$('[name=e]',mm).value; try{ await upd({empresa_id:eid, estado:'asignada', historial:hist('Reasignada a '+(S.empresas[eid]?.nombre||''))}); closeModal(); toast('Reasignada'); }catch(err){ toast(errMsg(err)); } }); return; }
    closeModal(); toast('Actualizada');
  }catch(err){ toast('Error: '+errMsg(err)); } });
}

// VERSIÓN Y ACTUALIZACIONES (solo instalación local)
async function tarjetaVersion(){ const el=$('#verBody'); if(!el) return; let e; try{ e=await q(sb.local.sistema.estado()); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!$('#verBody')) return;
  el.innerHTML=`<p style="margin:0 0 8px">Versión instalada: <b>${esc(e.version)}</b>${e.hayNueva?'':' · es la más reciente'}${e.revisado?` <span class="muted">(revisado ${fmtDate(e.revisado)})</span>`:''}</p>
    ${e.hayNueva?`<div class="info">Hay una versión nueva: <b>${esc(e.ultima.version)}</b>. <a href="${esc(e.ultima.pagina)}" target="_blank" rel="noopener">Ver qué cambia</a></div>
      ${e.autoinstalable?'<p>Al actualizar, la app deja de responder unos minutos. Antes de tocar nada se guarda una copia de los datos, y si la actualización falla los datos quedan como estaban.</p><button class="btn" id="bActualizar">Actualizar ahora</button>':'<p>Para actualizar, descarga la versión nueva desde ese enlace e instálala encima (en Windows), o reemplaza los archivos y reinicia el servidor (en Mac o Linux). Tus datos se conservan, y antes de aplicar cambios se guarda una copia.</p>'}`:''}
    ${e.error?`<div class="note">${esc(e.error)}</div>`:''}
    <div class="row wrap" style="margin-top:8px"><button class="btn sec sm" id="bBuscarVer">Buscar actualizaciones</button></div>
    ${e.historial.length?`<details style="margin-top:10px"><summary>Historial de versiones</summary><div class="small muted" style="margin-top:6px">${e.historial.slice().reverse().map(x=>`${fmtDate(x.fecha)} · ${x.de?esc(x.de)+' → ':'instalación de la '}${esc(x.a)}`).join('<br>')}</div></details>`:''}`;
  $('#bBuscarVer').addEventListener('click', async ev=>{ busy(ev.target,true,'Buscando…'); try{ await q(sb.local.sistema.buscar()); }catch(err){ toast(errMsg(err)); } tarjetaVersion(); });
  $('#bActualizar')?.addEventListener('click', async ev=>{ if(!await confirmBox(`Se instalará la versión ${e.ultima.version}. La app dejará de responder unos minutos para todos. ¿Actualizar ahora?`)) return;
    busy($('#bActualizar'),true,'Descargando…'); try{ await q(sb.local.sistema.actualizar()); }catch(err){ toast(errMsg(err)); tarjetaVersion(); return; }
    modal(`<h3>Actualizando Mi Edificio</h3><div class="loading"><div class="spin"></div><span id="actMsg">Instalando la versión ${esc(e.ultima.version)}. No cierres esta página: se recargará sola.</span></div>`);
    const t0=Date.now(); const ver=async()=>{ let j=null; try{ j=await (await fetch('/api/auth/sesion',{cache:'no-store'})).json(); }catch(x){}
      if(j&&j.mantencion){ $('#actMsg').textContent='La actualización no se pudo aplicar. Los datos no cambiaron. Abre Mi Edificio en el computador del edificio para ver qué hacer.'; return; }
      if(j&&Date.now()-t0>20000){ try{ const s=await q(sb.local.sistema.estado()); if(s.version!==e.version){ location.reload(); return; } }catch(x){} }
      if(Date.now()-t0>15*60000){ $('#actMsg').textContent='Está tardando más de lo esperado. Revisa el computador del edificio.'; return; } setTimeout(ver,4000); }; setTimeout(ver,8000); }); }

// ACCESO DESDE INTERNET (solo instalación local)
// El servidor maneja un túnel de Cloudflare hacia una dirección fija con el dominio del edificio.
// Se usa en Administración y en el asistente.
function tunelUI(el, alCambiar){
  let sondeo=null;
  const dibujar=e=>{ if(!document.body.contains(el)) return; S.dirPublica=e.estado==='conectado'&&e.direccion?e.direccion+'/':'';
    const estado=e.estado==='conectado'?`<div class="info">La app está publicada en <b>${esc(e.direccion)}</b> <button type="button" class="btn sec sm" data-copiar="${esc(e.direccion)}">Copiar</button></div>`
      :e.estado==='iniciando'?'<div class="info">Conectando con Cloudflare…</div>'
      :e.estado==='sin-programa'?'<div class="err">Falta el programa <code>cloudflared</code> en este computador. En Windows viene con el instalador de Mi Edificio; en Mac o Linux instálalo desde developers.cloudflare.com y vuelve a intentarlo.</div>'
      :e.estado==='error'?`<div class="err">No se pudo conectar: ${esc(e.error||'error desconocido')} Se reintenta automáticamente.</div>`
      :'<div class="note">Hoy la app solo funciona en este computador y en la red del edificio. Para que residentes y conserjes entren desde sus teléfonos, y para usar la cámara y las notificaciones, necesita una dirección de internet.</div>';
    el.innerHTML=`${estado}
      <p class="small muted">Se usa un túnel de Cloudflare con el dominio del edificio, por ejemplo <code>app.miedificio.cl</code>. Los datos siguen en este computador; el túnel solo los transporta. Se configura una vez:</p>
      <ol class="small" style="padding-left:20px;line-height:1.7"><li>Crea una cuenta gratuita en <b>cloudflare.com</b> y agrega tu dominio (comprarlo cuesta unos US$10 al año).</li><li>En el panel, entra a <b>Zero Trust → Networks → Tunnels</b> y crea un túnel de tipo <b>Cloudflared</b>.</li><li>Cloudflare muestra un comando con un token largo que empieza con <code>eyJ</code>. Cópialo y pégalo abajo; no hace falta ejecutarlo.</li><li>En <b>Public Hostname</b> elige la dirección y, como servicio, <code>http://localhost:${e.puerto}</code>.</li></ol>
      <label class="f"><span>Token del túnel${e.tieneToken?' (ya guardado; vacío = mantener)':''}</span><input type="password" name="tk" autocomplete="off" placeholder="eyJ…  o el comando completo"></label>
      <label class="f"><span>Dirección que elegiste en Cloudflare</span><input type="text" name="dir" value="${esc(e.direccionFija)}" placeholder="https://app.miedificio.cl" autocomplete="off" spellcheck="false"></label>
      <div class="row wrap"><button type="button" class="btn" data-tun="fijo">${e.modo==='fijo'?'Volver a conectar':'Conectar'}</button>${e.modo==='fijo'?'<button type="button" class="btn sec" data-tun="apagado">Desactivar el acceso desde internet</button>':''}</div>`;
    alCambiar?.(e); clearTimeout(sondeo); if(e.estado==='iniciando') sondeo=setTimeout(cargar,2000); };
  const cargar=()=>q(sb.local.tunel.estado()).then(dibujar,err=>{ if(document.body.contains(el)) el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; });
  if(!el._tun){ el._tun=true; el.addEventListener('click', async ev=>{ const c=ev.target.closest('[data-copiar]'), b=ev.target.closest('[data-tun]');
    if(c){ try{ await navigator.clipboard.writeText(c.dataset.copiar); toast('Dirección copiada'); }catch(e){ toast(c.dataset.copiar); } return; } if(!b) return;
    const modo=b.dataset.tun; if(modo==='apagado' && !await confirmBox('Nadie podrá entrar desde fuera del edificio hasta que lo vuelvas a activar. ¿Desactivar?')) return;
    busy(b,true,'Un momento…'); try{ dibujar(await q(sb.local.tunel.configurar({modo, token:$('[name=tk]',el)?.value||'', direccion:$('[name=dir]',el)?.value||''}))); }catch(err){ toast(errMsg(err)); busy(b,false); } }); }
  cargar();
}

// RESPALDO EN LA NUBE (solo instalación local)
// El servidor deja cada día una copia cifrada en una carpeta del computador; si esa carpeta es de
// OneDrive, Google Drive u otra nube, su app la sube sola. Se usa en Administración y en el asistente.
const RE_NUBE=/onedrive|google\s?drive|googledrive|my drive|mi unidad|dropbox|icloud|clouddocs|cloudstorage|nextcloud|pcloud|megasync|box sync|sync\.com/i;
const AVISO_NO_NUBE='Esta carpeta no parece estar dentro de OneDrive, Google Drive u otra nube. Si no se sincroniza, el respaldo quedará solo en este computador y se perderá junto con él.';
function respaldoCampos(e){ return `<p class="small muted">Instala en este computador la app de OneDrive, Google Drive u otra nube e inicia sesión en ella. Después elige una carpeta de esa nube: cada día Mi Edificio dejará ahí una copia cifrada de todo (base de datos, fotos y documentos) y la nube la subirá sola.</p>
  ${e.sugerencias.length?`<div class="small" style="margin-bottom:10px">Carpetas de nube encontradas en este computador:<br>${e.sugerencias.map(s=>`<a href="#" data-sug="${esc(s)}">${esc(s)}</a>`).join('<br>')}</div>`:'<div class="info">No se encontró una carpeta de OneDrive, Google Drive, Dropbox ni iCloud en este computador. Instala una de esas apps, o escribe la ruta a mano.</div>'}
  <label class="f"><span>Carpeta del respaldo (ruta completa en el computador del edificio)</span><input type="text" name="carpeta" value="${esc(e.carpeta)}" placeholder="C:\\Users\\Conserjeria\\OneDrive\\Respaldo Mi Edificio" autocomplete="off" spellcheck="false"></label><div id="rAviso"></div>
  <div class="row"><label class="f grow"><span>${e.configurado?'Nueva contraseña (vacío = mantener)':'Contraseña del respaldo'}</span><input type="password" name="clave" minlength="8" autocomplete="new-password"></label><label class="f grow"><span>Repítela</span><input type="password" name="clave2" autocomplete="new-password"></label></div>
  <p class="small muted">Anota esta contraseña fuera del computador. Sin ella el respaldo no se puede recuperar, y nadie puede restablecerla.</p>
  <label class="f"><span>Hora del respaldo diario</span><select name="hora" style="width:auto">${Array.from({length:24},(_,h)=>`<option value="${h}" ${h===(e.hora??3)?'selected':''}>${pad(h)}:00</option>`).join('')}</select></label>
  <p class="small muted">Mientras se hace el respaldo, la app puede dejar de responder por unos minutos. Elige una hora en que casi nadie la use, idealmente de madrugada. Es la hora del reloj de este computador, que debe estar encendido a esa hora.</p>`; }
function respaldoEventos(raiz){ const inp=$('[name=carpeta]',raiz); const av=()=>{ $('#rAviso',raiz).innerHTML=inp.value.trim()&&!RE_NUBE.test(inp.value)?`<div class="note">${AVISO_NO_NUBE}</div>`:''; };
  inp.addEventListener('input',av); raiz.addEventListener('click',e=>{ const s=e.target.closest('[data-sug]'); if(s){ e.preventDefault(); inp.value=s.dataset.sug; av(); } }); av(); }
async function respaldoGuardar(d, e){ if(d.clave!==d.clave2) throw new Error('Las dos contraseñas no coinciden.'); if(!d.clave&&!e.configurado) throw new Error('Define una contraseña para el respaldo.'); return q(sb.local.respaldo.configurar({carpeta:d.carpeta.trim(), clave:d.clave, hora:Number(d.hora)})); }
const respaldoEstado=e=>!e.configurado?'<div class="note">Hoy los respaldos solo quedan en este computador. Si falla, se pierde todo.</div>'
  :(e.pareceNube?'':`<div class="note">${AVISO_NO_NUBE}</div>`)+(!e.ultimo?`<div class="info">Carpeta configurada. El primer respaldo se hará a las ${pad(e.hora??3)}:00, o ahora con "Respaldar ahora".</div>`:e.ultimo.ok?`<div class="info">Último respaldo: ${fmtDate(e.ultimo.fecha)} · ${e.ultimo.archivos} ${e.ultimo.archivos===1?'archivo':'archivos'}, cifrado. Se repite cada día a las ${pad(e.hora??3)}:00.</div>`:`<div class="err">El último respaldo (${fmtDate(e.ultimo.fecha)}) falló: ${esc(e.ultimo.error)}</div>`);
async function tarjetaRespaldo(){ const el=$('#respBody'); if(!el) return; let e; try{ e=await q(sb.local.respaldo.estado()); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!$('#respBody')) return;
  el.innerHTML=`${respaldoEstado(e)}<form id="fResp">${respaldoCampos(e)}<div class="row wrap"><button class="btn">Guardar</button>${e.configurado?'<button type="button" class="btn sec" id="bRespYa">Respaldar ahora</button>':''}</div></form>`; respaldoEventos(el);
  $('#fResp',el).addEventListener('submit', async ev=>{ ev.preventDefault(); const b=$('button',ev.target); busy(b,true); try{ await respaldoGuardar(formData(ev.target), e); toast('Respaldo configurado'); tarjetaRespaldo(); }catch(err){ toast(errMsg(err)); busy(b,false); } });
  $('#bRespYa',el)?.addEventListener('click', async ev=>{ if(!await confirmBox('Mientras se hace el respaldo, la app puede dejar de responder por unos minutos para todos. ¿Respaldar ahora?')) return; busy($('#bRespYa'),true,'Respaldando…'); try{ const r=await q(sb.local.respaldo.ahora()); toast(r.ultimo?.ok?'Respaldo listo':'El respaldo falló'); }catch(err){ toast(errMsg(err)); } tarjetaRespaldo(); }); }

// ASISTENTE DE CONFIGURACIÓN INICIAL
// Ventana por pasos para dejar operativo un edificio nuevo. Cada paso guarda al avanzar, así
// que se puede abandonar y retomar; al terminar se marca edificios.configurado_at.
const ESPACIOS_EJ=[
  {id:'quincho', nombre:'Quincho', capacidad:15, desde:'10:00', hasta:'23:00', maxHoras:5, anticipacionDias:30, aprobacion:true, costo:0},
  {id:'salon', nombre:'Salón de eventos', capacidad:40, desde:'10:00', hasta:'23:00', maxHoras:6, anticipacionDias:60, aprobacion:true, costo:0},
  {id:'gym', nombre:'Gimnasio', capacidad:4, desde:'06:00', hasta:'23:00', maxHoras:1, anticipacionDias:3, aprobacion:false, costo:0},
  {id:'juegos', nombre:'Sala de juegos', capacidad:8, desde:'10:00', hasta:'22:00', maxHoras:2, anticipacionDias:7, aprobacion:false, costo:0}];
const leerUnidades = txt => txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const [d,a,p]=l.split(/[;\t]/.test(l)?/[;\t]/:','); return d&&d.trim()?{edificio_id:S.me.edificio_id, depto:d.trim(), alicuota:Number(String(a||'0').trim().replace(',','.'))||0, prop:(p||'').trim()}:null; }).filter(Boolean);   // con ; o tabulador, la coma es decimal (39,5)
function asistente(i=0){
  const c=S.cfg||{}; const upd=p=>q(T('edificios').update({...p, actualizado:now()}).eq('id',c.id));
  const inv=S.dirPublica||location.origin+location.pathname;   // con acceso desde internet, se invita con esa dirección
  const nUn=Object.keys(S.unidades).length, suma=Object.values(S.unidades).reduce((a,u)=>a+(Number(u.alicuota)||0),0), nEst=Object.keys(S.estac).length;
  const PASOS=[
    {t:'Tu edificio', d:'Estos datos aparecen en la app y en los documentos que se exportan.',
      h:()=>`<label class="f"><span>Nombre del edificio o condominio</span><input type="text" name="nombre" value="${esc(c.nombre||'')}" required></label>
        <div class="row"><label class="f grow"><span>Dirección</span><input type="text" name="direccion" value="${esc(c.direccion||'')}"></label><label class="f grow"><span>Comuna / ciudad</span><input type="text" name="comuna" value="${esc(c.comuna||'')}"></label></div>
        <div class="row"><label class="f grow"><span>Teléfono conserjería</span><input type="tel" name="telefono" value="${esc(c.telefono||'')}"></label><label class="f grow"><span>Email administración</span><input type="email" name="email" value="${esc(c.email||'')}"></label></div>
        <div class="row"><label class="f grow"><span>Logo (opcional)</span><input type="file" name="logo" accept="image/*"></label><label class="f"><span>Color principal</span><input type="color" name="color" value="${esc(c.color||'#1e5eff')}" style="width:60px;height:38px;padding:2px;border:1px solid var(--bd);border-radius:8px"></label></div>`,
      g:async(d,m)=>{ const f=$('[name=logo]',m).files[0]; const logo=f?await uploadImage(f,'logo'):null; await upd({nombre:d.nombre.trim(), direccion:d.direccion.trim(), comuna:d.comuna.trim(), telefono:d.telefono.trim(), email:d.email.trim(), color:d.color, ...(logo?{logo}:{})}); }},
    {t:'Unidades y alícuotas', d:'La alícuota (%) de cada departamento define su parte del gasto común. Pega una unidad por línea: depto;alícuota;propietario.',
      h:()=>`<div class="${nUn&&Math.abs(suma-100)>=0.05?'note':'info'}">${nUn?`Ya hay ${nUn} unidades cargadas; sus alícuotas suman ${suma.toFixed(2)}%${Math.abs(suma-100)<0.05?'.':' (deben sumar 100%).'}`:'Aún no hay unidades cargadas.'}</div>
        <label class="f"><span>Agregar o corregir unidades</span><textarea name="bulk" style="min-height:150px" placeholder="101;1.25;Juan Pérez&#10;102;1.30;&#10;103;1.25;María Soto"></textarea></label><p class="small muted">Puedes dejarlo en blanco y cargarlas después en Administración → Unidades.</p>`,
      g:async d=>{ const rows=leerUnidades(d.bulk); if(rows.length){ await q(T('unidades').upsert(rows)); await S.unidadesW?.reload(); } }},
    {t:'Gastos comunes', d:'Los residentes verán estos datos junto a su cobro para transferir. El pago se marca a mano en Gastos comunes.',
      h:()=>`<label class="f"><span>Datos bancarios</span><textarea name="datos_bancarios" style="min-height:120px" placeholder="Banco, tipo y número de cuenta, RUT, nombre, correo para el comprobante">${esc(c.datos_bancarios||'')}</textarea></label>`,
      g:d=>upd({datos_bancarios:d.datos_bancarios.trim()})},
    {t:'Espacios comunes', d:'Áreas que los residentes podrán reservar. Horarios y reglas se ajustan después en Administración → Espacios.',
      h:()=>{ const ya=(c.espacios||[]); const falt=ESPACIOS_EJ.filter(e=>!ya.some(x=>x.id===e.id)); return `${ya.length?`<div class="info">Ya configurados: ${ya.map(e=>esc(e.nombre)).join(', ')}.</div>`:''}${falt.map(e=>`<label class="sw" style="margin-bottom:10px"><input type="checkbox" name="esp_${e.id}"> <span><b>${e.nombre}</b> <span class="muted small">· ${e.desde}–${e.hasta} · máx ${e.maxHoras} h · ${e.aprobacion?'requiere aprobación':'confirmación inmediata'}</span></span></label>`).join('')||'<p class="small muted">Ya están todos los espacios de ejemplo.</p>'}`; },
      g:async d=>{ const add=ESPACIOS_EJ.filter(e=>d['esp_'+e.id]); if(add.length) await upd({espacios:[...(c.espacios||[]), ...add]}); }},
    {t:'Visitas y estacionamientos', d:'Conserjería controla los estacionamientos de visita desde un tablero. Si no hay, deja la cantidad en 0.',
      h:()=>`${nEst?`<div class="info">Ya hay ${nEst} estacionamientos de visita.</div>`:''}<label class="f"><span>${nEst?'Estacionamientos de visita a agregar':'¿Cuántos estacionamientos de visita hay?'}</span><input type="number" name="n" min="0" max="50" value="0"></label>
        <div class="row"><label class="f grow"><span>Avisar al residente a los (minutos)</span><input type="number" name="a" min="1" max="10080" placeholder="Sin aviso" value="${Number(c.est_alerta_min)||''}"></label><label class="f grow"><span>Informar a administración y comité a los (minutos)</span><input type="number" name="m" min="1" max="10080" placeholder="Sin aviso" value="${Number(c.est_aviso_min)||''}"></label></div>
        <label class="sw"><input type="checkbox" name="visita_patente" ${c.visita_patente?'checked':''}> Exigir la patente a las visitas que necesitan estacionamiento</label><p class="small muted">Los reservados (discapacidad, carga) se marcan después en Administración → Estacionamientos.</p>`,
      g:async d=>{ const a=Math.floor(Number(d.a))||0, m=Math.floor(Number(d.m))||0, n=Math.min(50,Math.max(0,Math.floor(Number(d.n))||0)); if(a&&m&&m<=a) throw new Error('El informe a administración debe ser posterior al aviso al residente.');
        await upd({est_alerta_min:a, est_aviso_min:m, visita_patente:!!d.visita_patente});
        if(n){ const sp=estOrden(); const us=sp.map(x=>/^V\d+$/.test(x.nombre)?Number(x.nombre.slice(1)):0); const k=Math.max(0,...us), ord=sp.reduce((x,y)=>Math.max(x,y.orden||0),0); await q(T('estacionamientos').insert(Array.from({length:n},(_,j)=>({nombre:'V'+(k+j+1), orden:ord+j+1, reservado:''})))); } }},
    {t:'Datos personales', d:'Define cuánto tiempo se guarda cada tipo de dato (en meses; vacío = indefinido) y, si quieres, tu propio aviso de privacidad.',
      h:()=>`<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">${RETENCION.map(([k,t])=>`<label class="f"><span>${t}</span><input type="number" name="ret_${k}" min="1" max="240" placeholder="Indefinido" value="${Number(c.retencion?.[k])||''}"></label>`).join('')}</div>
        <label class="f"><span>Aviso de privacidad (vacío = texto por defecto)</span><textarea name="privacidad" placeholder="Quién es responsable de los datos, para qué se usan, por cuánto tiempo se guardan y cómo ejercer los derechos de acceso, rectificación y eliminación.">${esc(c.privacidad||'')}</textarea></label>`,
      g:d=>{ const retencion={}; RETENCION.forEach(([k])=>{ const x=Math.floor(Number(d['ret_'+k])); if(x>0) retencion[k]=x; }); return upd({retencion, privacidad:d.privacidad.trim()}); }},
    ...(CFG.LOCAL?[{t:'Acceso desde internet', d:'Para que tu comunidad entre desde sus teléfonos, la app necesita una dirección de internet. Requiere un dominio y una cuenta gratuita en Cloudflare; si aún no los tienes, sigue y complétalo después en Administración → Edificio.',
      h:()=>'<div id="wTun" class="small muted">Consultando…</div>', ini:m=>tunelUI($('#wTun',m)), g:()=>{}}]:[]),
    ...(CFG.LOCAL?[{t:'Respaldo en la nube', d:'Todo lo de tu edificio vive en este computador. Para no perderlo si falla, deja una copia en una nube. Puedes saltar este paso y hacerlo después en Administración → Edificio.',
      h:()=>'<div id="wResp" class="small muted">Buscando carpetas de nube en este computador…</div>',
      ini:async m=>{ try{ const e=await q(sb.local.respaldo.estado()); m._resp=e; const el=$('#wResp',m); if(!el) return; el.className=''; el.innerHTML=(e.configurado?respaldoEstado(e):'')+respaldoCampos(e); respaldoEventos(el); }catch(err){ const el=$('#wResp',m); if(el) el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; } },
      g:async(d,m)=>{ if(!d.carpeta||!d.carpeta.trim()) return; await respaldoGuardar(d, m._resp||{}); sb.local.respaldo.ahora().then(()=>{},()=>{}); }}]:[]),
    {t:'Invita a tu comunidad', d:'Comparte este enlace con residentes, conserjes y empresas. Al crear su cuenta quedarán pendientes hasta que los apruebes.',
      h:()=>`<div class="row wrap"><input type="text" id="wInv" class="grow" readonly value="${esc(inv)}"><button type="button" class="btn sec" id="wCopiar">Copiar enlace</button></div><div style="height:14px"></div>
        <div class="small"><b>Lo que sigue</b><ol style="margin:6px 0 0;padding-left:20px;line-height:1.7"><li>Aprueba a quienes se registren en Administración → Usuarios, asignándoles depto y rol.</li><li>Publica el primer período en Gastos comunes.</li><li>Activa tus notificaciones en Mi cuenta.</li></ol></div>`,
      g:()=>upd({configurado_at:now()})},
  ];
  const n=PASOS.length, p=PASOS[i], ult=i===n-1;
  const m=modal(`<div class="small muted">Configuración inicial · paso ${i+1} de ${n}</div><div class="bar" style="margin:6px 0 14px"><i style="width:${Math.round((i+1)/n*100)}%;background:var(--p)"></i></div>
    <h3>${p.t}</h3><p class="small muted" style="margin-top:-6px">${p.d}</p><form id="fW">${p.h()}<div id="wErr" style="margin-top:10px"></div>
    <div class="row" style="margin-top:6px">${i?'<button type="button" class="btn sec" id="wAtras">Atrás</button>':''}<span class="grow"></span>${ult?'':'<button type="button" class="btn sec" id="wLuego">Seguir después</button>'}<button class="btn" id="wSig">${ult?'Terminar':'Guardar y seguir'}</button></div></form>`);
  p.ini?.(m);
  $('#wAtras',m)?.addEventListener('click',()=>asistente(i-1));
  $('#wLuego',m)?.addEventListener('click',()=>{ closeModal(); routeNow(); });
  $('#wCopiar',m)?.addEventListener('click', async()=>{ const x=$('#wInv',m); try{ await navigator.clipboard.writeText(x.value); toast('Enlace copiado'); }catch(e){ x.select(); toast('Copia el enlace seleccionado'); } });
  $('#fW',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('#wSig',m); busy(b,true); $('#wErr',m).innerHTML='';
    try{ await p.g(formData(e.target), m); await S.cfgW?.reload(); if(ult){ closeModal(); toast('Edificio configurado'); routeNow(); } else asistente(i+1); }
    catch(err){ $('#wErr',m).innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; busy(b,false); } });
}

// ADMINISTRACIÓN
VIEWS.admin = function(param){
  const tabs={edificio:'Edificio',usuarios:'Usuarios',unidades:'Unidades',espacios:'Espacios',estacionamientos:'Estacionamientos',activos:'Activos',empresas:'Empresas'};
  let tab = tabs[param]? param : (tabs[S._adminTab]? S._adminTab : 'edificio');
  setMain(`<h1>Administración</h1><div class="tabs" id="aTabs">${Object.entries(tabs).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="aBody"></div>`);
  $('#aTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#aTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; S._adminTab=tab; draw(); });
  const draw=()=>{ const old=$('#aBody'); if(!old) return; const el=old.cloneNode(false); old.replaceWith(el); ADMIN[tab](el); }; draw();
  REFRESH.admin=()=>{ if(tab!=='edificio') draw(); };
};
const ADMIN={};
const RETENCION=[['visitas','Visitas','Nombre, RUT y patente de quienes visitan'],['registros','Rondas y bitácora','Registros y fotos de las rondas'],['encomiendas','Encomiendas entregadas','Desde la fecha de entrega'],['mensajes','Mensajes','Conversaciones con conserjería, comité y administración'],['reservas','Reservas','Desde la fecha reservada'],['incidencias','Incidencias cerradas','Con sus fotos e historial'],['estacionamientos','Uso de estacionamientos','Patentes y horarios, desde que se libera']];
ADMIN.edificio = function(el){
  const c=S.cfg||{};
  el.innerHTML=`<div class="card"><div class="row" style="margin-bottom:8px"><h3 class="grow" style="margin:0">Datos del edificio</h3><button type="button" class="btn sec sm" id="bWiz">Asistente de configuración</button></div><form id="fEd"><div class="row" style="align-items:flex-start"><div><div class="logo-prev" id="logoPrev">${c.logo?`<img data-f="${esc(c.logo)}">`:'🏢'}</div><input type="file" id="logoIn" accept="image/*" style="display:none"><div class="row" style="margin-top:6px;gap:4px"><button type="button" class="btn sec sm" id="bLogo">Cambiar logo</button>${c.logo?'<button type="button" class="btn sec sm" id="bLogoDel">Quitar</button>':''}</div></div><div class="grow"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(c.nombre||'')}" required></label><label class="f"><span>Dirección</span><input type="text" name="direccion" value="${esc(c.direccion||'')}"></label></div></div>
  <div class="row"><label class="f grow"><span>Comuna / ciudad</span><input type="text" name="comuna" value="${esc(c.comuna||'')}"></label><label class="f grow"><span>Teléfono conserjería</span><input type="tel" name="telefono" value="${esc(c.telefono||'')}"></label></div>
  <label class="f"><span>Email administración</span><input type="email" name="email" value="${esc(c.email||'')}"></label>
  <label class="f"><span>Datos bancarios para transferir gastos comunes (visibles a residentes)</span><textarea name="datos_bancarios" placeholder="Banco, tipo de cuenta, número, RUT, correo">${esc(c.datos_bancarios||'')}</textarea></label>
  <div class="row"><label class="f grow"><span>Interés por mora en gastos comunes (% mensual; 0 = no se cobra)</span><input type="text" inputmode="decimal" data-dec name="mora_tasa" value="${aDec(c.mora_tasa)}"></label><label class="f grow"><span>Contar la mora desde (vacío = desde cada vencimiento)</span><input type="date" name="mora_desde" value="${esc(c.mora_desde||'')}"></label></div>
  <p class="small muted" style="margin:-4px 0 12px">Interés simple, calculado por día sobre el saldo impago de cada cobro vencido. La tasa la fija el reglamento de copropiedad dentro del máximo legal: confírmala antes de activarla. Al cambiarla se recalculan las deudas pendientes; los cobros ya pagados no cambian.</p>
  <label class="sw" style="margin-bottom:12px"><input type="checkbox" name="visita_patente" ${c.visita_patente?'checked':''}> Exigir la patente a las visitas que necesitan estacionamiento (por ejemplo, si el acceso usa lectura de patentes, LPR)</label>
  <label class="f"><span>Aviso de privacidad (se muestra al registrarse y en Mi cuenta; vacío = texto por defecto)</span><textarea name="privacidad" placeholder="Quién es responsable de los datos, para qué se usan, por cuánto tiempo se guardan y cómo ejercer los derechos de acceso, rectificación y eliminación.">${esc(c.privacidad||'')}</textarea></label>
  <label class="f"><span>Color principal</span><input type="color" name="color" value="${esc(c.color||'#1e5eff')}" style="width:60px;height:36px;padding:2px;border:1px solid var(--bd);border-radius:8px"></label>
  <button class="btn">Guardar cambios</button></form></div>
  ${CFG.LOCAL?'<div class="card"><h3>Versión y actualizaciones</h3><div id="verBody" class="small muted">Consultando…</div></div>':''}
  ${CFG.LOCAL?'<div class="card"><h3>Acceso desde internet</h3><div id="tunBody" class="small muted">Consultando…</div></div>':''}
  ${CFG.LOCAL?'<div class="card"><h3>Respaldo en la nube</h3><div id="respBody" class="small muted">Cargando…</div></div>':''}
  <div class="card"><h3>Conservación de datos</h3><p class="small muted">Define por cuántos meses se guarda cada tipo de dato. Lo que supere el plazo se borra en forma definitiva, cada día. Vacío = se conserva indefinidamente.</p>
  <form id="fRet"><div class="grid2">${RETENCION.map(([k,t,d])=>`<label class="f"><span>${t}</span><input type="number" name="${k}" min="1" max="240" placeholder="Indefinido" value="${Number(c.retencion?.[k])||''}"><span style="font-weight:400;margin-top:4px">${d}</span></label>`).join('')}</div>
  <div class="row wrap"><button class="btn">Guardar plazos</button><button type="button" class="btn sec" id="bDep">Aplicar ahora</button></div></form></div>
  <div class="card"><h3>Invitar a la comunidad</h3><p class="small muted">Comparte este enlace con residentes, conserjes y empresas. Al crear su cuenta quedarán asociados a este edificio y pendientes de tu aprobación en Usuarios.</p><div class="row wrap"><input type="text" id="invUrl" class="grow" readonly value="${esc(location.origin+location.pathname)}"><button type="button" class="btn sec" id="bInv">Copiar enlace</button></div></div>`;
  $('#bInv',el).addEventListener('click', async()=>{ const i=$('#invUrl',el); try{ await navigator.clipboard.writeText(i.value); toast('Enlace copiado'); }catch(e){ i.select(); toast('Copia el enlace seleccionado'); } });
  $('#fRet',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const retencion={}; RETENCION.forEach(([k])=>{ const n=Math.floor(Number(d[k])); if(n>0) retencion[k]=n; }); try{ await q(T('edificios').update({retencion}).eq('id',S.cfg.id)); toast('Plazos guardados'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bDep',el).addEventListener('click', async e=>{ if(!await confirmBox('Se borrarán en forma definitiva los datos que superen los plazos guardados. ¿Continuar?')) return; try{ const r=await q(sb.rpc('depurar_ahora'))||{}; const n=Object.values(r).reduce((a,b)=>a+Number(b),0); toast(n?(n===1?'Se borró 1 registro':`Se borraron ${n} registros`):'No había datos fuera de plazo'); limpiarArchivos(); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bWiz',el).addEventListener('click',()=>asistente());
  if(CFG.LOCAL){ tarjetaVersion(); tarjetaRespaldo(); tunelUI($('#tunBody',el), ()=>{ const i=$('#invUrl',el); if(i) i.value=S.dirPublica||location.origin+location.pathname; }); }
  let newLogo=null;
  $('#bLogo',el).addEventListener('click',()=>$('#logoIn',el).click());
  $('#logoIn',el).addEventListener('change', async e=>{ const f=e.target.files[0]; if(!f) return; try{ toast('Subiendo logo…'); newLogo=await uploadImage(f,'logo'); $('#logoPrev',el).innerHTML=`<img data-f="${esc(newLogo)}">`; toast('Logo listo, guarda los cambios'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bLogoDel',el)?.addEventListener('click',()=>{ newLogo=''; $('#logoPrev',el).innerHTML='🏢'; });
  $('#fEd',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('edificios').update({nombre:d.nombre.trim(), direccion:d.direccion.trim(), comuna:d.comuna.trim(), telefono:d.telefono.trim(), email:d.email.trim(), datos_bancarios:d.datos_bancarios.trim(), privacidad:d.privacidad.trim(), visita_patente:!!d.visita_patente, mora_tasa:Math.max(0,Number(d.mora_tasa)||0), mora_desde:d.mora_desde||null, color:d.color, ...(newLogo!==null?{logo:newLogo}:{}), actualizado:now()}).eq('id',S.cfg.id)); toast('Guardado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
ADMIN.usuarios = function(el){
  const us=Object.values(S.users); const pend=us.filter(u=>u.estado==='pendiente'); const act=us.filter(u=>u.estado!=='pendiente');
  const row=u=>`<tr><td><b>${esc(u.nombre)}</b><br><span class="muted small">${esc(u.telefono||'')}${u.id===S.uid?' · (tú)':''}</span></td><td><input type="text" value="${esc(u.depto||'')}" data-dep="${u.id}" style="width:90px;padding:5px 7px" list="dlu"></td><td><select data-rol="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}>${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.rol===k?'selected':''}>${v}</option>`).join('')}</select>${u.rol==='mantencion'?`<br><select data-emp="${u.id}" style="width:auto;padding:5px 7px;margin-top:4px"><option value="">— empresa —</option>${Object.values(S.empresas).map(e=>`<option value="${e.id}" ${u.empresa_id===e.id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select>`:''}</td><td><select data-est="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}><option value="activo" ${u.estado==='activo'?'selected':''}>Activo</option><option value="pendiente" ${u.estado==='pendiente'?'selected':''}>Pendiente</option><option value="bloqueado" ${u.estado==='bloqueado'?'selected':''}>Bloqueado</option></select>${CFG.LOCAL&&u.id!==S.uid?`<br><a href="#" class="small" data-clave="${u.id}">Nueva contraseña</a>`:''}</td></tr>`;
  el.innerHTML=`<datalist id="dlu">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist>${pend.length?`<div class="card"><h3>Solicitudes pendientes (${pend.length})</h3><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${pend.map(row).join('')}</tbody></table></div>`:''}
  <div class="card"><h3>Usuarios (${act.length})</h3><div style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${act.map(row).join('')||'<tr><td colspan="4" class="muted">Sin usuarios</td></tr>'}</tbody></table></div><p class="small muted">Los usuarios se registran solos desde la pantalla de inicio de sesión ("Crear cuenta") y aparecen aquí como pendientes. Asigna depto y rol, y actívalos.</p></div>`;
  el.addEventListener('click', async e=>{ const a=e.target.closest('[data-clave]'); if(!a) return; e.preventDefault(); const u=S.users[a.dataset.clave]; const clave=await askText('Nueva contraseña para '+(u?.nombre||'el usuario')+' (mínimo 8 caracteres)'); if(clave===null) return;
    if(clave.length<8){ toast('La contraseña debe tener al menos 8 caracteres'); return; } try{ await q(sb.local.restablecer(a.dataset.clave, clave)); toast('Contraseña restablecida. Entrégasela a la persona.'); }catch(err){ toast('Error: '+errMsg(err)); } });
  el.addEventListener('change', async e=>{ const t=e.target; const id=t.dataset.rol||t.dataset.est||t.dataset.dep||t.dataset.emp; if(!id) return; const up={}; if(t.dataset.rol) up.rol=t.value; if(t.dataset.est) up.estado=t.value; if(t.dataset.dep) up.depto=t.value.trim(); if(t.dataset.emp) up.empresa_id=t.value||null; try{ await q(T('usuarios').update(up).eq('id',id)); toast('Usuario actualizado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
ADMIN.unidades = function(el){
  const us=Object.values(S.unidades).sort((a,b)=>a.depto.localeCompare(b.depto,undefined,{numeric:true})); const suma=us.reduce((a,u)=>a+(Number(u.alicuota)||0),0);
  el.innerHTML=`<div class="card"><h3>Unidades y alícuotas</h3><p class="small muted">La alícuota (%) de cada unidad define su parte del gasto común. Suma actual: <b style="color:${Math.abs(suma-100)<0.05?'var(--ok)':'var(--er)'}">${suma.toFixed(2)}%</b> (debe ser 100%).</p>
  <form id="fU" class="row wrap" style="margin-bottom:12px"><input type="text" name="depto" placeholder="Depto (ej: 1204)" required style="width:130px"><input type="text" inputmode="decimal" data-dec name="alicuota" placeholder="Alícuota %" required style="width:120px"><input type="text" name="prop" placeholder="Propietario (opcional)" class="grow"><button class="btn">Agregar</button></form>
  <details><summary>Carga masiva (pegar: depto;alícuota;propietario por línea)</summary><textarea id="bulk" placeholder="101;1.25;Juan Pérez&#10;102;1.30;"></textarea><button class="btn sec sm" id="bBulk" style="margin-top:6px">Cargar</button></details>
  <div style="overflow:auto;margin-top:10px"><table><thead><tr><th>Unidad</th><th class="num">Alícuota</th><th>Propietario</th><th></th></tr></thead><tbody>${us.map(u=>`<tr><td>${esc(u.depto)}</td><td class="num"><input type="text" inputmode="decimal" value="${aDec(u.alicuota)}" data-al="${esc(u.depto)}" style="width:100px;padding:4px 6px;text-align:right"></td><td><input type="text" value="${esc(u.prop||'')}" data-pr="${esc(u.depto)}" style="padding:4px 6px"></td><td><button class="btn sec sm" data-del="${esc(u.depto)}">✕</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sin unidades</td></tr>'}</tbody></table></div></div>`;
  $('#fU',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('unidades').upsert({edificio_id:S.me.edificio_id, depto:d.depto.trim(), alicuota:Number(d.alicuota), prop:d.prop.trim()})); e.target.reset(); toast('Unidad agregada'); }catch(err){ toast(errMsg(err)); } });
  $('#bBulk',el).addEventListener('click', async()=>{ const rows=leerUnidades($('#bulk',el).value); if(!rows.length) return; try{ await q(T('unidades').upsert(rows)); toast(rows.length+' unidades cargadas'); }catch(err){ toast(errMsg(err)); } });
  el.addEventListener('change', async e=>{ const t=e.target; try{ if(t.dataset.al) await q(T('unidades').update({alicuota:leerDec(t.value)}).eq('depto',t.dataset.al)); if(t.dataset.pr) await q(T('unidades').update({prop:t.value.trim()}).eq('depto',t.dataset.pr)); }catch(err){ toast(errMsg(err)); } });
  el.addEventListener('click', async e=>{ const b=e.target.closest('[data-del]'); if(b&&await confirmBox('¿Eliminar unidad '+b.dataset.del+'?')) await q(T('unidades').delete().eq('depto',b.dataset.del)); });
};
ADMIN.espacios = function(el){
  const esp=S.cfg?.espacios||[];
  el.innerHTML=`<div class="card"><h3>Áreas comunes reservables</h3><div class="list">${esp.map((e,i)=>`<div class="item static"><div class="hd"><b>${esc(e.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${i}">Editar</button><button class="btn sec sm" data-del="${i}">✕</button></span></div><div class="meta">Capacidad ${e.capacidad} · ${e.desde}–${e.hasta} · máx ${e.maxHoras} h · ${e.anticipacionDias} días anticipación · ${e.aprobacion?'requiere aprobación':'automática'}${e.costo?' · '+clp(e.costo):''}${e.bloqueos?.length?'<br>No disponible: '+e.bloqueos.map(b=>esc(txtBloqueo(b))).join(' · '):''}</div></div>`).join('')||'<div class="muted">Sin espacios</div>'}</div><div class="row" style="margin-top:10px;gap:6px"><button class="btn" id="bAdd">+ Agregar espacio</button>${esp.length?'':'<button class="btn sec" id="bDef">Cargar ejemplos (quincho, salón, gimnasio, sala de juegos)</button>'}</div></div>`;
  const save=arr=>q(T('edificios').update({espacios:arr}).eq('id',S.cfg.id));
  const form=(e={}, idx=-1)=>{ const m=modal(`<h3>${idx>=0?'Editar':'Nuevo'} espacio</h3><form id="fE"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(e.nombre||'')}" required></label><div class="row"><label class="f grow"><span>Capacidad</span><input type="number" name="capacidad" value="${e.capacidad||10}"></label><label class="f grow"><span>Costo (CLP)</span><input type="text" inputmode="numeric" data-clp name="costo" value="${e.costo||0}"></label></div><div class="row"><label class="f grow"><span>Abre</span><input type="time" name="desde" value="${e.hasta==='24:00'?'00:00':e.desde||'09:00'}" required></label><label class="f grow"><span>Cierra</span><input type="time" name="hasta" value="${e.hasta==='24:00'?'23:59':e.hasta||'22:00'}" required></label></div><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="todo_dia" ${e.hasta==='24:00'?'checked':''}> Abierto las 24 horas</label><div class="row"><label class="f grow"><span>Máx. horas por reserva</span><input type="number" name="maxHoras" value="${e.maxHoras||2}" min="1"></label><label class="f grow"><span>Anticipación máx. (días)</span><input type="number" name="anticipacionDias" value="${e.anticipacionDias||30}" min="1"></label></div><label class="sw"><input type="checkbox" name="aprobacion" ${e.aprobacion?'checked':''}> Requiere aprobación del comité/administración</label>
      <div class="small" style="font-weight:600;margin:14px 0 4px">Horarios bloqueados cada semana</div><p class="small muted" style="margin:0 0 6px">Para aseo o mantención: en esas horas nadie puede reservar. Ej: lunes a viernes de 11 a 12.</p><div id="blqList"></div><button type="button" class="btn sec sm" id="bBlq">+ Agregar bloqueo</button>
      <button class="btn full" style="margin-top:12px">Guardar</button></form>`);
    const filaBlq=(b={dias:[1,2,3,4,5],desde:11,hasta:12,motivo:'Aseo'})=>{ const d=document.createElement('div'); d.className='card blq'; d.style.cssText='padding:8px;margin-bottom:6px';
      d.innerHTML=`<div class="row wrap" style="gap:8px">${DIAS_ORD.map(x=>`<label class="small" style="white-space:nowrap"><input type="checkbox" data-dia="${x}" ${(b.dias||[]).includes(x)?'checked':''}> ${DIAS_SEM[x]}</label>`).join('')}</div><div class="row" style="gap:6px;margin-top:6px"><label class="small">De <input type="number" data-k="desde" min="0" max="23" value="${Number(b.desde)}" style="width:62px"> h</label><label class="small">a <input type="number" data-k="hasta" min="1" max="24" value="${Number(b.hasta)}" style="width:62px"> h</label><input type="text" data-k="motivo" value="${esc(b.motivo||'')}" placeholder="Motivo" class="grow"><button type="button" class="btn sec sm" data-quitar>✕</button></div>`;
      $('#blqList',m).appendChild(d); };
    const dia24=()=>{ const on=$('[name=todo_dia]',m).checked; ['desde','hasta'].forEach(k=>$('[name='+k+']',m).disabled=on); }; $('[name=todo_dia]',m).addEventListener('change',dia24); dia24();
    (e.bloqueos||[]).forEach(filaBlq); $('#bBlq',m).addEventListener('click',()=>filaBlq());
    $('#blqList',m).addEventListener('click',ev=>{ const x=ev.target.closest('[data-quitar]'); if(x) x.closest('.blq').remove(); });
    $('#fE',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const obj={id:e.id||seg(d.nombre).toLowerCase()+'_'+rnd().slice(-4), nombre:d.nombre.trim(), capacidad:Number(d.capacidad), costo:Number(d.costo)||0, desde:d.todo_dia?'00:00':d.desde, hasta:d.todo_dia?'24:00':d.hasta, maxHoras:Number(d.maxHoras)||1, anticipacionDias:Number(d.anticipacionDias)||30, aprobacion:!!d.aprobacion,
        bloqueos:$$('.blq',m).map(x=>({dias:$$('[data-dia]:checked',x).map(c=>Number(c.dataset.dia)), desde:Math.floor(Number($('[data-k=desde]',x).value)), hasta:Math.floor(Number($('[data-k=hasta]',x).value)), motivo:$('[data-k=motivo]',x).value.trim()})).filter(b=>b.dias.length&&b.hasta>b.desde)}; const arr=esp.slice(); if(idx>=0) arr[idx]=obj; else arr.push(obj); closeModal(); try{ await save(arr); toast('Guardado'); }catch(err){ toast(errMsg(err)); } }); };
  $('#bAdd',el).addEventListener('click',()=>form());
  $('#bDef',el)?.addEventListener('click', async()=>{ await save([
    {id:'quincho', nombre:'Quincho', capacidad:15, desde:'10:00', hasta:'23:00', maxHoras:5, anticipacionDias:30, aprobacion:true, costo:0},
    {id:'salon', nombre:'Salón de eventos', capacidad:40, desde:'10:00', hasta:'23:00', maxHoras:6, anticipacionDias:60, aprobacion:true, costo:0},
    {id:'gym', nombre:'Gimnasio', capacidad:4, desde:'06:00', hasta:'23:00', maxHoras:1, anticipacionDias:3, aprobacion:false, costo:0},
    {id:'juegos', nombre:'Sala de juegos', capacidad:8, desde:'10:00', hasta:'22:00', maxHoras:2, anticipacionDias:7, aprobacion:false, costo:0}]); });
  el.addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed) form(esp[+ed.dataset.ed],+ed.dataset.ed); if(del&&await confirmBox('¿Eliminar espacio?')){ const arr=esp.slice(); arr.splice(+del.dataset.del,1); await save(arr); } });
};
ADMIN.estacionamientos = function(el){
  const c=S.cfg||{}; const sp=estOrden();
  el.innerHTML=`<div class="card"><h3>Tiempos y avisos</h3><p class="small muted">Cuando un auto de visita supera el primer tiempo se avisa al residente; al superar el segundo se informa a administración y comité (por ejemplo, para cursar una multa según el reglamento) y el uso queda en "Excedidos". Vacío = sin aviso.</p>
  <form id="fET"><div class="grid2"><label class="f"><span>Avisar al residente a los (minutos)</span><input type="number" name="a" min="1" max="10080" placeholder="Sin aviso" value="${Number(c.est_alerta_min)||''}"></label><label class="f"><span>Informar a administración y comité a los (minutos)</span><input type="number" name="m" min="1" max="10080" placeholder="Sin aviso" value="${Number(c.est_aviso_min)||''}"></label></div><button class="btn">Guardar tiempos</button></form></div>
  <div class="card"><h3>Estacionamientos de visita (${sp.length})</h3><p class="small muted">Indica en "Reservado para" los que tienen uso especial; conserjería lo verá al asignarlos.</p>
  <form id="fEN" class="row wrap" style="margin-bottom:12px"><span class="small">Agregar</span><input type="number" name="n" min="1" max="50" value="1" required style="width:80px"><span class="small">con prefijo</span><input type="text" name="pre" value="V" maxlength="6" style="width:80px"><button class="btn">Agregar</button></form>
  <datalist id="dlRes"><option value="Discapacidad"><option value="Embarazadas"><option value="Carga y descarga"><option value="Proveedores"></datalist>
  <div style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Reservado para</th><th></th></tr></thead><tbody>${sp.map(e=>`<tr><td><input type="text" value="${esc(e.nombre)}" data-en="${e.id}" style="width:110px;padding:5px 7px"></td><td><input type="text" value="${esc(e.reservado||'')}" data-er="${e.id}" list="dlRes" placeholder="Uso general" style="padding:5px 7px"></td><td><button class="btn sec sm" data-del="${e.id}">✕</button></td></tr>`).join('')||'<tr><td colspan="3" class="muted">Aún no hay estacionamientos de visita</td></tr>'}</tbody></table></div></div>`;
  $('#fET',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const a=Math.floor(Number(d.a))||0, m=Math.floor(Number(d.m))||0; if(a&&m&&m<=a){ toast('El informe a administración debe ser posterior al aviso al residente'); return; } try{ await q(T('edificios').update({est_alerta_min:a, est_aviso_min:m}).eq('id',S.cfg.id)); toast('Tiempos guardados'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#fEN',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const pre=d.pre.trim(); const n=Math.min(50,Math.max(1,Math.floor(Number(d.n))||1));
    const usados=sp.map(x=>x.nombre.startsWith(pre)?parseInt(x.nombre.slice(pre.length),10):NaN).filter(x=>!isNaN(x)); let k=usados.length?Math.max(...usados):0; const ord=sp.reduce((a,x)=>Math.max(a,x.orden||0),0);
    try{ await q(T('estacionamientos').insert(Array.from({length:n},(_, i)=>({nombre:pre+(k+i+1), orden:ord+i+1, reservado:''})))); toast(n===1?'Estacionamiento agregado':n+' estacionamientos agregados'); }catch(err){ toast('Error: '+errMsg(err)); } });
  el.addEventListener('change', async e=>{ const t=e.target; try{ if(t.dataset.en){ if(!t.value.trim()) return; await q(T('estacionamientos').update({nombre:t.value.trim()}).eq('id',t.dataset.en)); } if(t.dataset.er) await q(T('estacionamientos').update({reservado:t.value.trim()}).eq('id',t.dataset.er)); }catch(err){ toast(errMsg(err)); } });
  el.addEventListener('click', async e=>{ const b=e.target.closest('[data-del]'); if(b&&await confirmBox('¿Eliminar el estacionamiento '+(S.estac[b.dataset.del]?.nombre||'')+'? Su historial de uso se conserva.')){ try{ await q(T('estacionamientos').delete().eq('id',b.dataset.del)); }catch(err){ toast(errMsg(err)); } } });
};
ADMIN.activos = function(el){
  const acts=Object.values(S.activos);
  el.innerHTML=`<div class="card"><h3>Activos y checkpoints</h3><p class="small muted">Cada activo puede tener un tag NFC (graba en el tag un texto con el código) y requisitos de ronda: p. ej. checkpoint cada 1 h, foto del nivel de combustible cada 24 h.</p><div class="list">${acts.map(a=>`<div class="item static"><div class="hd"><b>${a.icono||'📍'} ${esc(a.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${a.id}">Editar</button><button class="btn sec sm" data-del="${a.id}">✕</button></span></div><div class="meta">${esc(a.ubicacion||'')} · tag: <code>${esc(a.nfc_tag||'—')}</code> · ${(a.requisitos||[]).map(r=>esc((r.descripcion||TIPOS[r.tipo])+' c/'+r.frecuenciaHoras+'h')).join(', ')||'sin requisitos'}${a.plan_dias?' · preventiva cada '+a.plan_dias+' d ('+esc(S.empresas[a.empresa_id]?.nombre||'sin empresa')+')':''}</div></div>`).join('')||'<div class="muted">Sin activos</div>'}</div><button class="btn" id="bAdd" style="margin-top:10px">+ Agregar activo</button></div>`;
  const reqRow=r=>`<div class="row" style="margin-bottom:6px;flex-wrap:wrap"><select name="rt" style="width:130px">${Object.entries(TIPOS).map(([k,v])=>`<option value="${k}" ${r.tipo===k?'selected':''}>${v}</option>`).join('')}</select><input type="number" name="rf" value="${r.frecuenciaHoras||24}" min="1" title="Cada N horas" style="width:70px"><input type="text" name="rd" value="${esc(r.descripcion||'')}" placeholder="Descripción" class="grow" style="min-width:120px"><label class="sw" title="Foto obligatoria"><input type="checkbox" name="rp" ${r.fotoObligatoria?'checked':''}>📷</label><button type="button" class="btn sec sm" data-rm>✕</button></div>`;
  const form=(a={})=>{ const reqs=a.requisitos||[{tipo:'checkpoint',frecuenciaHoras:1,descripcion:'Ronda'}];
    const m=modal(`<h3>${a.id?'Editar':'Nuevo'} activo</h3><form id="fA"><div class="row"><label class="f" style="width:70px"><span>Ícono</span><input type="text" name="icono" value="${esc(a.icono||'📍')}"></label><label class="f grow"><span>Nombre</span><input type="text" name="nombre" value="${esc(a.nombre||'')}" required></label></div><label class="f"><span>Ubicación</span><input type="text" name="ubicacion" value="${esc(a.ubicacion||'')}"></label><label class="f"><span>Código del tag NFC</span><input type="text" name="nfc_tag" value="${esc(a.nfc_tag||'')}" placeholder="Ej: CHK-P12 o el serial del tag"></label>
    <div class="small" style="font-weight:600;margin:6px 0">Requisitos de ronda</div><div id="reqs">${reqs.map(reqRow).join('')}</div><button type="button" class="btn sec sm" id="addReq">+ Requisito</button>
    <div class="small" style="font-weight:600;margin:12px 0 6px">Mantención preventiva</div><div class="row"><label class="f grow"><span>Cada (días, 0 = sin plan)</span><input type="number" name="plan_dias" value="${a.plan_dias||0}" min="0"></label><label class="f grow"><span>Empresa responsable</span><select name="empresa_id"><option value="">—</option>${Object.values(S.empresas).map(e=>`<option value="${e.id}" ${a.empresa_id===e.id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select></label></div><label class="f"><span>Última mantención</span><input type="date" name="ultima_mantencion" value="${esc(a.ultima_mantencion||'')}"></label>
    <button class="btn full">Guardar</button></form>`);
    $('#addReq',m).addEventListener('click',()=>$('#reqs',m).insertAdjacentHTML('beforeend',reqRow({})));
    m.addEventListener('click',e=>{ if(e.target.closest('[data-rm]')) e.target.closest('.row').remove(); });
    $('#fA',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const requisitos=$$('#reqs .row',m).map(r=>({tipo:$('[name=rt]',r).value, frecuenciaHoras:Number($('[name=rf]',r).value)||24, descripcion:$('[name=rd]',r).value.trim(), fotoObligatoria:$('[name=rp]',r).checked})); const body={icono:d.icono, nombre:d.nombre.trim(), ubicacion:d.ubicacion.trim(), nfc_tag:d.nfc_tag.trim(), requisitos, plan_dias:Number(d.plan_dias)||0, empresa_id:d.empresa_id||null, ultima_mantencion:d.ultima_mantencion||null}; try{ if(a.id) await q(T('activos').update(body).eq('id',a.id)); else await q(T('activos').insert(body)); closeModal(); toast('Activo guardado'); }catch(err){ toast(errMsg(err)); } }); };
  $('#bAdd',el).addEventListener('click',()=>form());
  el.addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed) form(S.activos[ed.dataset.ed]); if(del&&await confirmBox('¿Eliminar activo? Sus registros históricos se conservan.')) await q(T('activos').delete().eq('id',del.dataset.del)); });
};
ADMIN.empresas = function(el){
  const emps=Object.values(S.empresas);
  el.innerHTML=`<div class="card"><h3>Empresas de mantención</h3><div class="list">${emps.map(e=>`<div class="item static"><div class="hd"><b>${esc(e.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${e.id}">Editar</button><button class="btn sec sm" data-del="${e.id}">✕</button></span></div><div class="meta">${esc(e.rubro||'')} · ${esc(e.contacto||'')} · ${esc(e.telefono||'')} · ${esc(e.email||'')} · usuarios: ${Object.values(S.users).filter(u=>u.empresa_id===e.id).map(u=>esc(u.nombre)).join(', ')||'ninguno'}</div></div>`).join('')||'<div class="muted">Sin empresas</div>'}</div><button class="btn" id="bAdd" style="margin-top:10px">+ Agregar empresa</button><p class="small muted" style="margin-top:10px">Para que un técnico opere en la app: que cree su cuenta eligiendo "Empresa de mantención"; luego en Usuarios actívalo y vincúlalo a la empresa.</p></div>`;
  const form=(e={})=>{ const m=modal(`<h3>${e.id?'Editar':'Nueva'} empresa</h3><form id="fEm"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(e.nombre||'')}" required></label><label class="f"><span>Rubro</span><input type="text" name="rubro" value="${esc(e.rubro||'')}" placeholder="Ascensores, eléctrica, sanitaria, climatización…"></label><label class="f"><span>Contacto</span><input type="text" name="contacto" value="${esc(e.contacto||'')}"></label><div class="row"><label class="f grow"><span>Teléfono</span><input type="tel" name="telefono" value="${esc(e.telefono||'')}"></label><label class="f grow"><span>Email</span><input type="email" name="email" value="${esc(e.email||'')}"></label></div><button class="btn full">Guardar</button></form>`);
    $('#fEm',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const body={nombre:d.nombre.trim(), rubro:d.rubro.trim(), contacto:d.contacto.trim(), telefono:d.telefono.trim(), email:d.email.trim()}; try{ if(e.id) await q(T('empresas').update(body).eq('id',e.id)); else await q(T('empresas').insert(body)); closeModal(); toast('Empresa guardada'); }catch(err){ toast(errMsg(err)); } }); };
  $('#bAdd',el).addEventListener('click',()=>form());
  el.addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed) form(S.empresas[ed.dataset.ed]); if(del&&await confirmBox('¿Eliminar empresa?')){ try{ await q(T('empresas').delete().eq('id',del.dataset.del)); }catch(err){ toast('No se puede eliminar: tiene OT o activos asociados'); } } });
};

boot().catch(e=>{ console.error(e); render(`<div class="loading">Error al iniciar: ${esc(errMsg(e))}</div>`); });
})();
