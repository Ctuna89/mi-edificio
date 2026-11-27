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
const urlSegura = u => /^https:\/\//i.test(String(u||'').trim()) ? String(u).trim() : '';   // solo enlaces https (nunca javascript:, data:…)
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
async function uploadFile(file, folder='docs'){ const ext=(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,''); const path=`${dirEdif()}${folder}/${todayStr()}/${rndSeguro()}.${ext}`;
  const tipo=/^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(file.type)?file.type:'application/octet-stream';   // nada que el navegador pueda ejecutar
  await q(sb.storage.from('fotos').upload(path, file, {contentType:tipo})); return path; }
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
  const [contacto,consentimientos,solicitudes_datos]=await Promise.all([de('contactos','uid',S.uid), de('consentimientos','uid',S.uid), de('solicitudes_datos','uid',S.uid)]);
  const [reservas,incidencias,mensajes,visitas,encomiendas,gastos_comunes,votos]=await Promise.all([de('reservas','uid',S.uid), de('incidencias','uid',S.uid), de('mensajes','uid',S.uid), de('visitas','uid',S.uid), dep?de('encomiendas','depto',dep):[], dep?de('gasto_unidades','depto',dep):[], dep?de('votos','depto',dep):[]]);
  descargar(new Blob([JSON.stringify({generado:now(), edificio:S.cfg?.nombre||'', correo:S.session?.user?.email||'', perfil:{...S.me, telefono:contacto[0]?.telefono||''}, consentimientos, solicitudes_datos, reservas, incidencias, mensajes, visitas, encomiendas, gastos_comunes, votos},null,2)],{type:'application/json'}), 'mis-datos.json');
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
  {id:'asambleas', ic:'🏛️', t:'Asambleas', d:'Citación, poderes, quórum y votaciones', roles:['residente','propietario','comite','admin']},
  {id:'registro', ic:'📇', t:'Registro', d:'Copropietarios, arrendatarios y ocupantes', roles:['residente','propietario','comite','admin']},
  {id:'seguros', ic:'🛡️', t:'Seguros', d:'Pólizas del edificio y de cada unidad', roles:['propietario','comite','admin']},
  {id:'multas', ic:'⚖️', t:'Multas', d:'Casos de infracción: cargos, descargos y resolución', roles:['residente','propietario','conserje','comite','admin']},
  {id:'emergencia', ic:'🚨', t:'Emergencias', d:'Plan, teléfonos, responsables y simulacros', roles:['residente','propietario','conserje','comite','admin']},
  {id:'proveedores', ic:'🤝', t:'Proveedores', d:'Contratos, certificaciones y vencimientos', roles:['comite','admin']},
  {id:'ingresos', ic:'🧰', t:'Ingresos', d:'Proveedores y técnicos que entran al edificio', roles:['conserje','comite','admin']},
  {id:'novedades', ic:'📓', t:'Novedades', d:'Libro de novedades y turnos de conserjería', roles:['conserje','comite','admin']},
  {id:'fichas', ic:'🏘️', t:'Unidades', d:'Vehículos, mascotas, bodegas y estacionamientos', roles:['conserje','comite','admin']},
  {id:'documentos', ic:'📁', t:'Documentos', d:'Reglamento, actas, balances', roles:['residente','propietario','conserje','comite','admin']},
  {id:'rondas', ic:'📍', t:'Rondas', d:'Checkpoints NFC y bitácora', roles:['conserje','comite','admin']},
  {id:'mantencion', ic:'🔧', t:'Mantención', d:'Órdenes de trabajo y activos', roles:['comite','admin','mantencion']},
  {id:'admin', ic:'⚙️', t:'Administración', d:'Edificio, usuarios, espacios', roles:['admin']},
  {id:'perfil', ic:'👤', t:'Mi cuenta', d:'Datos y cerrar sesión', roles:Object.keys(ROLES)},
];
// Módulos activables por edificio (adaptado de CactusOne): la administración apaga los que no usa, o los deja
// solo para el personal mientras los prueba. Los básicos siempre están.
const MOD_BASICOS=['inicio','perfil','admin','gastos','finanzas'];
const modEstado=id=>MOD_BASICOS.includes(id)?'on':((S.cfg?.modulos||{})[id]||'on');
const modAbierto=(id,r=role())=>{ const e=modEstado(id); return e==='on'||(e==='personal'&&['conserje','comite','admin','mantencion'].includes(r)); };
const puedeVer=(m,r=role())=>m.roles.includes(r)&&modAbierto(m.id,r);
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
  // Nunca dentro de un marco de otro sitio (clickjacking); el servidor local además envía X-Frame-Options: DENY
  if(window.top!==window.self){ document.body.innerHTML='<p style="padding:20px;font-family:sans-serif">Abre Mi Edificio directamente, no dentro de otra página.</p>'; return; }
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
  : mode==='registro'?`<h3>Crear cuenta</h3><p class="small muted">Luego de crear la cuenta completarás tus datos y la administración aprobará tu acceso.</p><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required autocomplete="username"></label><label class="f"><span>Contraseña (mínimo 12 caracteres)</span><input type="password" name="pass" required minlength="12" autocomplete="new-password"></label><p class="small muted">Usa una frase fácil de recordar para ti y difícil de adivinar, por ejemplo tres o cuatro palabras.</p><button class="btn full">Crear cuenta</button></form><div class="links"><a href="#" data-m="login">Ya tengo cuenta</a></div>`
  : CFG.LOCAL?`<h3>Recuperar contraseña</h3><p>Pide a la administración del edificio que restablezca tu contraseña: lo hace desde Administración → Usuarios y te entrega una nueva, que podrás cambiar en Mi cuenta.</p><div class="links"><a href="#" data-m="login">Volver</a></div>`
  : `<h3>Recuperar contraseña</h3><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required></label><button class="btn full">Enviar enlace</button></form><div class="links"><a href="#" data-m="login">Volver</a></div>`}</div></div>`);
  $$('[data-m]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); viewAuth(a.dataset.m);}));
  $('#fAuth')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Un momento…'); $('#authErr').innerHTML=''; try{
    if(mode==='login'){ const r=await q(sb.auth.signInWithPassword({email:d.email.trim(), password:d.pass})); if(r?.mfa){ pedirCodigo(c=>q(sb.local.dosPasos.verificar(r.mfa.desafio,c)), ()=>viewAuth()); return; } }
    else if(mode==='registro'){ const r=await q(sb.auth.signUp({email:d.email.trim(), password:d.pass, options:{emailRedirectTo:location.origin+location.pathname}})); if(!r.session){ viewAuth('login','Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.'); return; } }
    else { await q(sb.auth.resetPasswordForEmail(d.email.trim(),{redirectTo:location.origin+location.pathname+'#perfil'})); viewAuth('login','Si el correo existe, recibirás un enlace para cambiar la contraseña.'); return; }
  }catch(err){ $('#authErr').innerHTML=`<div class="err">${esc(traducirAuth(errMsg(err)))}</div>`; busy(b,false); } });
}
// Confirmar la identidad antes de un cambio delicado (lo pide el servidor local). Devuelve true si se confirmó.
window.miEdificioReconfirmar = conCodigo => new Promise(res => {
  // ventana propia: no cierra la que estaba abierta (por ejemplo, el asistente de configuración)
  const m=document.createElement('div'); m.className='modal'; m.style.zIndex='1000'; document.body.appendChild(m);
  m.innerHTML=`<div class="box"><h3>Confirma tu identidad</h3><p class="small muted">Por seguridad, este cambio pide tu contraseña${conCodigo?' y el código de tu app de autenticación':''}, aunque ya hayas iniciado sesión.</p><div id="rcErr"></div>
    <form id="fRc"><label class="f"><span>Tu contraseña actual</span><input type="password" name="clave" required autocomplete="current-password"></label>${conCodigo?'<label class="f"><span>Código de 6 dígitos</span><input type="text" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>':''}
    <div class="row wrap"><button type="button" class="btn sec" id="rcNo">Cancelar</button><button class="btn grow">Confirmar</button></div></form></div>`;
  $('[name=clave]',m).focus();
  let listo=false; const fin=v=>{ if(listo) return; listo=true; m.remove(); res(v); };
  $('#rcNo',m).addEventListener('click',()=>fin(false));
  m.addEventListener('click',e=>{ if(e.target===m) fin(false); });
  $('#fRc',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button.grow',m); busy(b,true);
    try{ await q(sb.local.confirmar(d.clave, d.codigo||'')); fin(true); }catch(err){ $('#rcErr',m).innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; busy(b,false); } }); });

// Segundo paso: código de la app de autenticación (o un código de respaldo)
function pedirCodigo(verificar, cancelar){
  render(`<div class="auth"><div class="center" style="margin-bottom:16px"><div class="logo-prev" style="margin:0 auto 10px">🔐</div><h1 style="margin:0">Verificación en dos pasos</h1></div>
  <div class="card"><div id="authErr"></div><p>Escribe el código de 6 dígitos que muestra tu app de autenticación (Google Authenticator, Microsoft Authenticator u otra).</p>
  <form id="fCod"><label class="f"><span>Código</span><input type="text" name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="11" required autofocus style="font-size:24px;letter-spacing:4px;text-align:center"></label><button class="btn full">Verificar</button></form>
  <p class="small muted">Si no tienes el teléfono, usa uno de tus códigos de respaldo (por ejemplo, 3F9A2-C81D0).</p><div class="links"><a href="#" id="codNo">Cancelar</a></div></div></div>`);
  $('#codNo').addEventListener('click',e=>{ e.preventDefault(); cancelar(); });
  $('#fCod').addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button',e.target); busy(b,true,'Verificando…'); $('#authErr').innerHTML='';
    try{ const r=await verificar(formData(e.target).c.trim()); if(r?.aviso) setTimeout(()=>toast(r.aviso),1500); }catch(err){ $('#authErr').innerHTML=`<div class="err">${esc(/incorrecto|invalid/i.test(errMsg(err))?'Código incorrecto. Prueba con el código nuevo que muestra la app.':errMsg(err))}</div>`; busy(b,false); e.target.reset(); } }); }
// En Supabase la sesión existe tras la contraseña (nivel aal1): si la cuenta tiene un factor, se pide antes de cargar la app
async function faltaSegundoPaso(){ if(CFG.LOCAL||!sb.auth.mfa) return false; try{ const {data}=await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return !!data&&data.nextLevel==='aal2'&&data.currentLevel!=='aal2'; }catch(e){ return false; } }
async function verificarSupabase(codigo){ const f=await q(sb.auth.mfa.listFactors()); const fac=(f?.totp||[]).find(x=>x.status==='verified'); if(!fac) throw new Error('No hay una app de autenticación registrada');
  await q(sb.auth.mfa.challengeAndVerify({factorId:fac.id, code:codigo})); teardown(); start(); }
function traducirAuth(m){ if(/invalid login/i.test(m)) return 'Correo o contraseña incorrectos.'; if(/email not confirmed/i.test(m)) return 'Debes confirmar tu correo antes de entrar.'; if(/already registered/i.test(m)) return 'Ese correo ya tiene cuenta.'; if(/password/i.test(m)&&/short|least|weak/i.test(m)) return 'La contraseña es muy corta: usa al menos 12 caracteres.'; return m; }

async function start(){
  if(await faltaSegundoPaso()){ pedirCodigo(verificarSupabase, ()=>sb.auth.signOut()); return; }
  render(`<div class="loading"><div class="spin"></div>Cargando…</div>`);
  // catálogos globales (RLS limita lo que cada rol ve)
  S.cfgW=watch('edificios', ()=>q(T('edificios').select('*').maybeSingle()), d=>{ const k=cfgKey(); S.cfg=d; S.cfgLoaded=true; applyColor(); if(S.ready && cfgKey()!==k && !$('.modal')) routeNow(); else if(S.ready) updateBrand(); gate(); }, {global:true});
  S.usersW=watch({table:'usuarios'}, ()=>q(T('usuarios').select('*')), rows=>{ S.users={}; rows.forEach(u=>S.users[u.id]=u); const me=S.users[S.uid]||null; const k=meKey(); S.me=me; S.meLoaded=true; if((me?.edificio_id||null)!==(S.cfg?.id||null)) S.cfgW?.reload(); if(S.ready && meKey()!==k && !$('.modal')) routeNow(); else if(S.ready) refreshView(); gate(); }, {global:true, silent:true});
  S.misUnidades=[];
  watch({table:'usuario_unidades'}, ()=>q(T('usuario_unidades').select('*').eq('uid',S.uid)).catch(()=>[]), rows=>{ const k=S.misUnidades.map(x=>x.depto).join(); S.misUnidades=rows.sort((a,b)=>porNum(a.depto,b.depto)); if(S.ready&&k!==S.misUnidades.map(x=>x.depto).join()&&!$('.modal')) routeNow(); }, {global:true, silent:true});
  S.unidadesW=watch('unidades', ()=>q(T('unidades').select('*')), rows=>{ S.unidades={}; rows.forEach(u=>S.unidades[u.depto]=u); refreshView(); }, {global:true, silent:true});
  watch('empresas', ()=>q(T('empresas').select('*')), rows=>{ S.empresas={}; rows.forEach(u=>S.empresas[u.id]=u); refreshView(); }, {global:true, silent:true});
  watch('activos', ()=>q(T('activos').select('*')), rows=>{ S.activos={}; rows.forEach(u=>S.activos[u.id]=u); refreshView(); }, {global:true, silent:true});
  watch('estacionamientos', ()=>q(T('estacionamientos').select('*')), rows=>{ S.estac={}; rows.forEach(u=>S.estac[u.id]=u); refreshView(); }, {global:true, silent:true});
}
// Selector de unidad para quien tiene varias (depto, estacionamiento, bodega…)
const selUnidad=id=>(S.misUnidades||[]).length>1&&['residente','propietario'].includes(S.me?.rol)?`<select id="${id}" aria-label="Unidad" style="width:auto;padding:6px 8px;font-size:12px">${S.misUnidades.map(x=>`<option value="${esc(x.depto)}" ${x.depto===S.me.depto?'selected':''}>Depto ${esc(x.depto)}${x.rol==='propietario'?'':' (residente)'}</option>`).join('')}</select>`:'';
async function cambiarUnidad(d){ try{ await q(sb.rpc('cambiar_unidad',{p_depto:d})); S.usersW?.reload(); toast('Unidad '+d); }catch(err){ toast(errMsg(err)); } }
function meKey(){ const m=S.me||{}; return [m.edificio_id,m.rol,m.estado,m.nombre,m.depto,m.empresa_id].join('|'); }
function cfgKey(){ const c=S.cfg||{}; return [c.id,c.nombre,c.direccion,c.logo,c.color,JSON.stringify(c.espacios||[]),JSON.stringify(c.medidores||[]),JSON.stringify(c.modulos||{})].join('|'); }
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
  const mod=MODULES.find(m=>m.id===v && puedeVer(m));
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
  const r=role(); const mods=MODULES.filter(m=>puedeVer(m,r));
  const side = mods.map(m=>`<a href="#${m.id}" class="${currentView===m.id?'on':''}"><span class="ic">${m.ic}</span>${m.t}</a>`).join('');
  const bot = (BOTTOM[r]||['inicio']).map(id=>{const m=MODULES.find(x=>x.id===id&&puedeVer(x,r)); return m?`<a href="#${m.id}" class="${currentView===m.id?'on':''}"><span class="ic">${m.ic}</span>${m.t.split(' ')[0]}</a>`:'';}).join('');
  const sel=id=>`<select id="${id}" style="width:auto;padding:6px 8px;font-size:12px">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${role()===k?'selected':''}>${v}</option>`).join('')}</select>`;
  render(`
  <nav class="side"><div class="brand"><div class="logo">${logoHtml()}</div><div><b>${esc(S.cfg?.nombre||'')}</b><small>${esc(S.cfg?.direccion||'')}</small></div></div>${side}<div class="sp"></div>${realRole()==='admin'?`<div style="padding:10px"><label class="f"><span>Ver como (vista de prueba)</span>${sel('verComo')}</label></div>`:''}<div style="padding:10px;font-size:12px;color:var(--mu)">${esc(S.me.nombre)}${S.me.depto&&!selUnidad('x')?' · '+esc(S.me.depto):''}<br><span class="pill mu">${ROLES[r]}</span>${selUnidad('selUni')?'<div style="margin-top:6px">'+selUnidad('selUni')+'</div>':''}</div></nav>
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
    <header class="top"><div class="logo">${logoHtml()}</div><div class="t"><b>${esc(S.cfg?.nombre||'')}</b><small>${esc(S.me.nombre)} · ${ROLES[r]}</small></div>${realRole()==='admin'?sel('verComoTop'):''}${selUnidad('selUniTop')}</header>
    <main id="main"></main>
    <nav class="bottom">${bot}</nav>
  </div>`);
  const onVer = e=>{ lsSet('verComo', e.target.value===S.me.rol?null:e.target.value); location.hash='#inicio'; routeNow(); };
  $('#verComo')?.addEventListener('change',onVer); $('#verComoTop')?.addEventListener('change',onVer);
  ['#selUni','#selUniTop'].forEach(k=>$(k)?.addEventListener('change',e=>cambiarUnidad(e.target.value)));
}
function setMain(html){ $('#main').innerHTML=html; }
document.addEventListener('click',e=>{ const b=e.target.closest?.('[data-uni]'); if(b&&b.dataset.uni!==S.me?.depto) cambiarUnidad(b.dataset.uni); });

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

const TIPO_COND={electrodependiente:'Persona electrodependiente', oxigeno:'Uso de oxígeno medicinal', movilidad_reducida:'Movilidad reducida', adulto_mayor_solo:'Adulto mayor que vive solo', otra:'Otra'};
// Registro reservado de condiciones especiales, para emergencias: conserjería y administración, con motivo registrado
function formCondicionesEmergencia(){ const m=modal(`<h3>Unidades con condiciones especiales</h3><form id="fEm"><label class="f"><span>Motivo de la consulta</span><input type="text" name="m" required placeholder="Ej: corte de luz general, evacuación, incendio"></label><p class="small muted">Es un registro reservado (datos de salud): la consulta queda registrada con tu nombre, la hora y el motivo.</p><button class="btn full">Ver unidades</button></form><div id="emRes" style="margin-top:10px"></div>`);
  $('#fEm',m).addEventListener('submit', async e=>{ e.preventDefault(); try{ const r=await q(sb.rpc('ver_condiciones',{p_motivo:$('[name=m]',m).value.trim()})); $('#emRes',m).innerHTML=r.length?`<div class="list">${r.map(x=>`<div class="item static"><div class="hd"><b>Depto ${esc(x.depto)}</b><span class="pill ${['electrodependiente','oxigeno'].includes(x.tipo)?'er':'wa'}">${esc(TIPO_COND[x.tipo]||x.tipo)}</span></div>${x.detalle?`<div class="meta">${esc(x.detalle)}</div>`:''}</div>`).join('')}</div>`:'<div class="empty">No hay condiciones registradas</div>'; }catch(err){ toast(errMsg(err)); } }); }
document.addEventListener('click',e=>{ if(e.target.closest?.('#bEmerg')) formCondicionesEmergencia(); });
const TIPO_SOLICITUD={acceso:'Acceso: saber qué datos tienen', rectificacion:'Rectificación: corregir un dato', supresion:'Supresión: borrar un dato', oposicion:'Oposición a un uso', portabilidad:'Portabilidad: recibir mis datos', bloqueo:'Bloqueo temporal'};
const EST_SOLICITUD={recibida:['Recibida','wa'], en_curso:['En curso','in'], respondida:['Respondida','ok'], rechazada:['Rechazada','mu']};
// Conserjería, comité y administración consultan los teléfonos de una unidad indicando el motivo (queda registrado)
function formTelefonos(depto=''){
  const m=modal(`<h3>Teléfono de una unidad</h3><form id="fTel"><label class="f"><span>Unidad</span><input type="text" name="depto" list="dlTel" value="${esc(depto)}" required><datalist id="dlTel">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>
    <label class="f"><span>Motivo de la consulta</span><input type="text" name="motivo" required placeholder="Ej: encomienda refrigerada, filtración, emergencia"></label><p class="small muted">Los teléfonos son datos personales: la consulta queda registrada con tu nombre, la hora y el motivo.</p><button class="btn full">Ver teléfonos</button></form><div id="telRes" style="margin-top:10px"></div>`);
  $('#fTel',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ const r=await q(sb.rpc('ver_telefonos',{p_depto:d.depto.trim(), p_motivo:d.motivo.trim()}));
    $('#telRes',m).innerHTML=r.length?`<div class="list">${r.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.nombre)}</b>${x.telefono?`<a class="btn sec sm" href="tel:${esc(x.telefono.replace(/[^+\d]/g,''))}">📞 ${esc(x.telefono)}</a>`:'<span class="muted small">Sin teléfono registrado</span>'}</div></div>`).join('')}</div>`:'<div class="empty">No hay residentes activos en esa unidad</div>'; }catch(err){ toast(errMsg(err)); } }); }
document.addEventListener('click',e=>{ const b=e.target.closest?.('#bTelE,#bTelV'); if(b) formTelefonos(); });
// Verificación en dos pasos: voluntaria. Local: TOTP propio con códigos de respaldo. Supabase: factores TOTP de Supabase Auth.
const QR_2FA=uri=>{ const qr=window.qrcode(0,'M'); qr.addData(uri); qr.make(); return qr.createSvgTag({cellSize:5, margin:2}); };
function mostrarCodigos(cods){ const txt=`Códigos de respaldo de Mi Edificio (${S.session?.user?.email||''})\nCada uno sirve una sola vez.\n\n`+cods.join('\n');
  const m=modal(`<h3>Guarda tus códigos de respaldo</h3><p>Si pierdes el teléfono, entra con uno de estos códigos. <b>Cada uno sirve una sola vez</b> y no se vuelven a mostrar: guárdalos impresos o en un lugar seguro, no en el mismo teléfono.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:ui-monospace,monospace;font-size:18px;margin:12px 0">${cods.map(c=>`<div class="card" style="padding:8px;text-align:center;margin:0">${esc(c)}</div>`).join('')}</div>
    <div class="row wrap"><button class="btn sec" id="cdDes">Descargar</button><button class="btn sec" id="cdCop">Copiar</button><button class="btn grow" data-close>Ya los guardé</button></div>`);
  $('#cdDes',m).addEventListener('click',()=>descargar(new Blob([txt],{type:'text/plain'}),'mi-edificio-codigos-de-respaldo.txt'));
  $('#cdCop',m).addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText(txt); toast('Copiados'); }catch(e){ toast('No se pudo copiar'); } }); }
async function tarjetaDosPasos(){ const el=$('#p2fa'); if(!el) return;
  const intro='<p class="small muted">Además de la contraseña, pide un código que cambia cada 30 segundos en una app de tu teléfono (Google Authenticator, Microsoft Authenticator, 1Password u otra). Así, aunque alguien sepa tu contraseña, no puede entrar. Es voluntaria y muy recomendable para la administración y el comité.</p>';
  if(CFG.LOCAL){ let e; try{ e=await q(sb.local.dosPasos.estado()); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!$('#p2fa')) return;
    el.innerHTML=e.activo?`<div class="info">✓ Activada. Te quedan ${e.quedan} ${e.quedan===1?'código':'códigos'} de respaldo.</div>${e.quedan<=3?'<div class="note">Te quedan pocos códigos de respaldo: genera nuevos.</div>':''}<div class="row wrap"><button class="btn sec sm" id="d2Cod">Nuevos códigos de respaldo</button><button class="btn sec sm" id="d2Off">Desactivar</button></div>`
      :intro+'<button class="btn" id="d2On">Activar</button>';
    $('#d2On',el)?.addEventListener('click', async()=>{ let r; try{ r=await q(sb.local.dosPasos.iniciar()); }catch(err){ toast(errMsg(err)); return; }
      const m=modal(`<h3>Activar la verificación en dos pasos</h3><ol class="small" style="padding-left:18px"><li>Abre tu app de autenticación y agrega una cuenta escaneando este código.</li><li>Escribe el código de 6 dígitos que aparece.</li></ol>
        <div class="center" style="background:#fff;border-radius:12px;padding:8px;width:fit-content;margin:8px auto">${QR_2FA(r.uri)}</div><p class="small muted center">¿No puedes escanear? Escribe esta clave en la app: <code style="word-break:break-all">${esc(r.secreto.replace(/(.{4})/g,'$1 ').trim())}</code></p>
        <form id="f2On"><label class="f"><span>Código de 6 dígitos</span><input type="text" name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="font-size:22px;letter-spacing:4px;text-align:center"></label><button class="btn full">Activar</button></form>`);
      $('#f2On',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const b=$('button',ev.target); busy(b,true); try{ const x=await q(sb.local.dosPasos.activar(formData(ev.target).c.trim())); closeModal(); toast('Verificación en dos pasos activada'); mostrarCodigos(x.codigos); tarjetaDosPasos(); }catch(err){ toast(errMsg(err)); busy(b,false); } }); });
    $('#d2Cod',el)?.addEventListener('click', async()=>{ const c=await askText('Para generar códigos nuevos, escribe el código de 6 dígitos de tu app (los anteriores dejan de servir)'); if(!c) return; try{ const x=await q(sb.local.dosPasos.codigos(c.trim())); mostrarCodigos(x.codigos); tarjetaDosPasos(); }catch(err){ toast(errMsg(err)); } });
    $('#d2Off',el)?.addEventListener('click', async()=>{ if(!await confirmBox('¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo por la contraseña.')) return;
      try{ await q(sb.local.dosPasos.desactivar()); toast('Verificación en dos pasos desactivada'); tarjetaDosPasos(); }catch(err){ toast(errMsg(err)); } });
    return; }
  // Supabase
  if(!sb.auth.mfa){ el.innerHTML='<p class="small muted">No disponible en esta instalación.</p>'; return; }
  let fs=[]; try{ const {data}=await sb.auth.mfa.listFactors(); fs=(data?.totp||[]).filter(f=>f.status==='verified'); }catch(e){} if(!$('#p2fa')) return;
  el.innerHTML=fs.length?`<div class="info">✓ Activada (${fs.length} ${fs.length===1?'dispositivo':'dispositivos'}).</div><p class="small muted">En esta instalación no hay códigos de respaldo: registra un segundo dispositivo por si pierdes el teléfono.</p><div class="row wrap"><button class="btn sec sm" id="d2On">Agregar otro dispositivo</button><button class="btn sec sm" id="d2Off">Desactivar</button></div>`:intro+'<button class="btn" id="d2On">Activar</button>';
  $('#d2On',el)?.addEventListener('click', async()=>{ let en; try{ en=await q(sb.auth.mfa.enroll({factorType:'totp', friendlyName:'Teléfono '+new Date().toISOString().slice(0,16)})); }catch(err){ toast(errMsg(err)); return; }
    const m=modal(`<h3>Activar la verificación en dos pasos</h3><p class="small">Escanea el código con tu app de autenticación y escribe el código de 6 dígitos.</p><div class="center" style="background:#fff;border-radius:12px;padding:8px;width:fit-content;margin:8px auto"><img src="${esc(en.totp.qr_code)}" alt="Código QR" style="width:200px;height:200px"></div><p class="small muted center">Clave: <code style="word-break:break-all">${esc(en.totp.secret)}</code></p>
      <form id="f2On"><label class="f"><span>Código de 6 dígitos</span><input type="text" name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label><button class="btn full">Activar</button></form>`);
    $('#f2On',m).addEventListener('submit', async ev=>{ ev.preventDefault(); try{ await q(sb.auth.mfa.challengeAndVerify({factorId:en.id, code:formData(ev.target).c.trim()})); closeModal(); toast('Verificación en dos pasos activada'); tarjetaDosPasos(); }catch(err){ toast(errMsg(err)); } }); });
  $('#d2Off',el)?.addEventListener('click', async()=>{ if(!await confirmBox('¿Desactivar la verificación en dos pasos en todos tus dispositivos?')) return; try{ for(const f of fs) await q(sb.auth.mfa.unenroll({factorId:f.id})); toast('Desactivada'); tarjetaDosPasos(); }catch(err){ toast(errMsg(err)); } }); }

VIEWS.perfil = function(){
  setMain(`<h1>Mi cuenta</h1><div class="card"><form id="fP"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(S.me.nombre)}" required></label><label class="f"><span>Teléfono</span><input type="tel" name="telefono" id="pTel" placeholder="Cargando…"></label><div class="small muted" style="margin-bottom:10px">Tu teléfono lo ve la administración. Conserjería y el comité pueden consultarlo indicando un motivo, y cada consulta queda registrada.<br>Depto: <b>${esc(S.me.depto||'—')}</b> · Rol: <b>${ROLES[S.me.rol]}</b> · ${esc(S.session?.user?.email||'')}<br>Para cambiar depto o rol, contacta a la administración.</div><button class="btn">Guardar</button></form></div>
  ${['residente','propietario'].includes(S.me.rol)&&S.me.depto?`<div class="card"><h3>Mi unidad · depto ${esc(S.me.depto)}</h3><p class="small muted">Vehículos y mascotas de tu unidad: los ven la conserjería, el comité y la administración, por ejemplo para identificar un auto mal estacionado o una mascota perdida.</p><div id="pFicha"><div class="empty">Cargando…</div></div></div>`:''}
  <div class="card"><h3>Verificación en dos pasos</h3><div id="p2fa" class="small muted">Cargando…</div></div>
  <div class="card"><h3>Sesiones</h3><p class="small muted">Si dejaste la app abierta en otro teléfono o computador, o lo perdiste, cierra la sesión en todos los demás. En este dispositivo sigues conectado.</p><button class="btn sec" id="bCerrarOtras">Cerrar sesión en los demás dispositivos</button></div>
  <div class="card"><h3>Contraseña</h3><form id="fPw"><label class="f"><span>Nueva contraseña</span><input type="password" name="pw" minlength="12" required autocomplete="new-password" placeholder="Mínimo 12 caracteres"></label><button class="btn sec">Cambiar contraseña</button></form></div>
  <div class="card"><h3>Tus datos personales</h3><details><summary>Aviso de privacidad</summary><p class="small" style="white-space:pre-wrap">${esc(avisoPriv(S.cfg))}</p></details>
  <div class="row wrap" style="margin-top:10px"><button class="btn sec" id="bDatos">Descargar mis datos</button><button class="btn sec" id="bBaja">Eliminar mi cuenta</button></div>
  ${['residente','propietario'].includes(S.me.rol)&&S.me.depto?`<h2>Condiciones especiales de tu unidad</h2><p class="small muted">Si en tu unidad vive alguien electrodependiente, que usa oxígeno medicinal, con movilidad reducida o un adulto mayor que vive solo, regístralo: sirve para ayudar en una emergencia y, por ley, impide que se suspenda la luz por deudas. Es un registro reservado: lo ve la administración, y conserjería solo con un motivo que queda registrado.</p>
  <div id="pCond" class="list"></div><button class="btn sec sm" id="bCond" style="margin-top:6px">+ Declarar una condición</button>`:''}
  <h2>Lo que aceptaste</h2><div id="pCons" class="list"><div class="empty">Cargando…</div></div>
  <h2>Ejercer tus derechos</h2><p class="small muted">Según la Ley 21.719 puedes pedir acceso, rectificación, supresión, oposición, portabilidad o bloqueo de tus datos. La administración debe responder en 30 días corridos.</p>
  <form id="fSd" class="row wrap" style="align-items:flex-end"><label class="f" style="margin:0"><span>Qué pides</span><select name="tipo">${Object.entries(TIPO_SOLICITUD).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label class="f grow" style="margin:0"><span>Detalle</span><input type="text" name="detalle" placeholder="Qué datos y qué necesitas" required></label><button class="btn sec">Enviar solicitud</button></form>
  <div id="pSol" class="list" style="margin-top:10px"></div></div>
  <div class="card"><h3>Notificaciones</h3><div id="pushBody" class="small muted">Comprobando…</div></div>
  <button class="btn dan" id="out">Cerrar sesión</button>`);
  pushCard();
  q(T('contactos').select('telefono').eq('uid',S.uid)).then(r=>{ const i=$('#pTel'); if(i){ i.value=r[0]?.telefono||''; i.placeholder=''; } }).catch(()=>{ const i=$('#pTel'); if(i) i.placeholder=''; });
  watch(['consentimientos','solicitudes_datos'], async()=>{ const [c,sd]=await Promise.all([q(T('consentimientos').select('*').eq('uid',S.uid).order('otorgado_at',{ascending:false})).catch(()=>[]), q(T('solicitudes_datos').select('*').eq('uid',S.uid).order('ts',{ascending:false})).catch(()=>[])]); return {c,sd}; },
    ({c,sd})=>{ const a=$('#pCons'), b=$('#pSol'); if(!a) return;
      a.innerHTML=c.map(x=>`<div class="item static"><div class="hd"><b>${x.tipo==='privacidad'?'Aviso de privacidad':esc(x.tipo)}</b><span class="pill ${x.revocado_at?'mu':'ok'}">${x.revocado_at?'Revocado':'Vigente'}</span></div><div class="meta">Aceptado el ${fmtDate(x.otorgado_at)}${x.revocado_at?' · revocado el '+fmtDate(x.revocado_at):''}${x.tipo!=='privacidad'&&!x.revocado_at?` · <button class="btn sec sm" data-revocar="${x.id}">Revocar</button>`:''}</div><details><summary class="small">Texto aceptado</summary><p class="small" style="white-space:pre-wrap">${esc(x.texto)}</p></details></div>`).join('')||'<div class="empty">Aún no hay registros</div>';
      b.innerHTML=sd.map(x=>`<div class="item static"><div class="hd"><b>${esc(TIPO_SOLICITUD[x.tipo]||x.tipo)}</b>${pillOf(EST_SOLICITUD,x.estado)}</div><div class="meta">${fmtDate(x.ts)} · ${esc(x.detalle)}${['recibida','en_curso'].includes(x.estado)?' · respuesta antes del '+fmtDay(x.vence):''}</div>${x.respuesta?`<p class="small" style="white-space:pre-wrap;margin:6px 0 0"><b>Respuesta:</b> ${esc(x.respuesta)}</p>`:''}</div>`).join(''); }, {silent:true});
  if($('#pFicha')) fichaUnidad($('#pFicha'), S.me.depto, {edita:true});
  tarjetaDosPasos();
  $('#bCerrarOtras')?.addEventListener('click', async()=>{ if(!await confirmBox('¿Cerrar tu sesión en todos los demás dispositivos?')) return;
    try{ if(CFG.LOCAL){ const r=await q(sb.local.cerrarOtras()); toast(r.cerradas?`Se ${r.cerradas===1?'cerró 1 sesión':'cerraron '+r.cerradas+' sesiones'}`:'No había otras sesiones abiertas'); } else { await q(sb.auth.signOut({scope:'others'})); toast('Se cerraron las demás sesiones'); } }catch(err){ toast(errMsg(err)); } });
  if($('#pCond')){ const cargarCond=async()=>{ const r=await q(T('condiciones_especiales').select('*').order('ts',{ascending:false})).catch(()=>[]); const el=$('#pCond'); if(!el) return;
      el.innerHTML=r.map(x=>`<div class="item static"><div class="hd"><b>${esc(TIPO_COND[x.tipo]||x.tipo)}</b>${x.hasta?'<span class="pill mu">Terminada</span>':`<button class="btn sec sm" data-fincond="${x.id}">Ya no aplica</button>`}</div><div class="meta">Desde ${fmtDay(x.desde)}${x.hasta?' hasta '+fmtDay(x.hasta):''}${x.detalle?' · '+esc(x.detalle):''}</div></div>`).join('')||'<div class="empty">Sin condiciones registradas</div>'; };
    cargarCond();
    $('#pCond').addEventListener('click', async e=>{ const b=e.target.closest('[data-fincond]'); if(!b) return; try{ await q(sb.rpc('terminar_condicion',{p_id:b.dataset.fincond})); toast('Condición terminada'); cargarCond(); }catch(err){ toast(errMsg(err)); } });
    $('#bCond').addEventListener('click',()=>{ const texto=`Autorizo a la administración de ${S.cfg?.nombre||'el edificio'} a registrar esta condición de mi unidad (${myDepto()}), que puede incluir datos de salud, para resguardos en emergencias y frente a cortes de luz. La ve la administración; conserjería solo en emergencias o con un motivo que queda registrado. Puedo revocarla cuando quiera.`;
      const m=modal(`<h3>Declarar una condición especial</h3><form id="fCe"><label class="f"><span>Condición</span><select name="tipo">${Object.entries(TIPO_COND).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label class="f"><span>Detalle (opcional; obligatorio si es "otra")</span><input type="text" name="detalle" placeholder="Ej: ventilador mecánico nocturno"></label>
        <div class="note small" style="white-space:pre-wrap">${esc(texto)}</div><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="ok" required> Doy mi consentimiento expreso</label><button class="btn full">Registrar</button></form>`);
      $('#fCe',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(sb.rpc('declarar_condicion',{p_tipo:d.tipo, p_detalle:d.detalle.trim(), p_texto_consentimiento:texto})); closeModal(); toast('Condición registrada'); cargarCond(); }catch(err){ toast('Error: '+errMsg(err)); } }); }); }
  $('#pCons').addEventListener('click', async e=>{ const b=e.target.closest('[data-revocar]'); if(!b) return; if(!await confirmBox('¿Revocar este consentimiento?')) return; try{ await q(sb.rpc('revocar_consentimiento',{p_id:b.dataset.revocar})); toast('Consentimiento revocado'); }catch(err){ toast(errMsg(err)); } });
  $('#fSd').addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('solicitudes_datos').insert({tipo:d.tipo, detalle:d.detalle.trim(), uid:S.uid})); e.target.reset(); toast('Solicitud enviada: la administración tiene 30 días para responder'); }catch(err){ toast(errMsg(err)); } });
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
    watch(['comunicados','comunicado_lecturas','gastos','gasto_unidades','pagos','convenios','encomiendas','conversaciones','encuestas','votos','reservas','infracciones','unidad_documentos','suspensiones','registro_confirmaciones','asambleas'], async()=>{
      const [D,enc,msj,encs,votos,res,infs,udocs,sps,regs,asms,cimp,clec]=await Promise.all([finDatos((S.misUnidades||[]).length>1?null:dep).catch(()=>null), cuenta(q(T('encomiendas').select('id').eq('depto',dep).eq('entregado',false))), cuenta(q(T('conversaciones').select('id').eq('depto',dep).eq('no_leido_residente',true))),
        q(T('encuestas').select('id,cierra,solo_propietarios').eq('estado','abierta')).catch(()=>[]), q(T('votos').select('encuesta_id').eq('depto',dep)).catch(()=>[]),
        q(T('reservas').select('*').eq('depto',dep).gte('fecha',hoy).order('fecha',{ascending:true})).catch(()=>[]), q(T('infracciones').select('id,estado,descargos_hasta,descargos_at')).catch(()=>[]),
        r==='propietario'?q(T('unidad_documentos').select('*').order('ts',{ascending:false})).catch(()=>[]):[], q(T('suspensiones').select('*')).catch(()=>[]), r==='propietario'?q(sb.rpc('registro_estado')).catch(()=>[]):[], modAbierto('asambleas')?q(T('asambleas').select('*')).catch(()=>[]):[],
        q(T('comunicados').select('id,titulo,importante').eq('importante',true)).catch(()=>[]), q(T('comunicado_lecturas').select('comunicado_id,confirmado')).catch(()=>[])]);
      return {D,enc,msj,encs,votos,res,infs,udocs,sps,regs,asms,cimp,clec}; },
    ({D,enc,msj,encs,votos,res,infs,udocs,sps,regs,asms,cimp,clec})=>{
      const spA=(sps||[]).find(x=>['avisada','solicitada','suspendida','por_reponer'].includes(x.estado));
      const ultPol=(udocs||[]).filter(x=>x.tipo==='poliza_incendio')[0], polAviso=ultPol&&(ultPol.estado==='rechazado'||(ultPol.estado==='aceptado'&&ultPol.vence&&diasA(ultPol.vence)<=30)); const el=$('#homeEstado'); if(!el) return;
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
      const regPend=r==='propietario'&&modAbierto('registro')&&regs&&regs[0]&&!regs[0].confirmado;
      const asmP=(asms||[]).filter(x=>['citada','en_curso'].includes(x.estado)).sort((x,y)=>x.fecha<y.fecha?-1:1)[0];
      const sinConf=(cimp||[]).filter(c=>!(clec||[]).some(x=>x.comunicado_id===c.id&&x.confirmado));
      const items=[...sinConf.map(c=>fila('📣','Comunicado importante: '+c.titulo,'#comunicados','er','Léelo y confirma la lectura')), asmP?fila('🏛️',asmP.estado==='en_curso'?'Asamblea en curso: registra tu asistencia':'Asamblea '+TIPO_ASM[asmP.tipo].toLowerCase(),'#asambleas--'+asmP.id,asmP.estado==='en_curso'?'er':'in',fechaHora(asmP.fecha)+(asmP.estado==='citada'?'. Si no puedes ir, da un poder.':'')):'', regPend?fila('📇','Confirma el registro de tu unidad','#registro','wa','Revisa los datos de copropietarios, arrendatarios y ocupantes (una vez al año)'):'', spA?fila('⚡',spA.estado==='por_reponer'?'Se repondrá tu suministro eléctrico':spA.estado==='avisada'?'Aviso previo de suspensión de luz':'Suministro eléctrico suspendido','#gastos','er',spA.estado==='por_reponer'?'A más tardar el '+fmtDay(spA.reponer_antes):spA.estado==='avisada'?`Por ${spA.cuotas} cuotas impagas, desde el ${fmtDay(spA.fecha_prevista)}. Regulariza con un pago o un convenio.`:'Regulariza con un pago o un convenio para reponerlo.'):'', polAviso?fila('🛡️',ultPol.estado==='rechazado'?'Tu póliza de incendio fue rechazada':'Tu póliza de incendio vence pronto','#seguros',ultPol.estado==='rechazado'?'er':'wa',ultPol.estado==='rechazado'?(ultPol.motivo||''):'Vence el '+fmtDay(ultPol.vence)+'. Sube la renovación.'):'', cargosInf.length?fila(cargosInf.length,cargosInf.length===1?'Notificación de cargos':'Notificaciones de cargos','#multas','er','Puedes presentar descargos hasta el '+fmtDay(cargosInf[0].descargos_hasta)):'', conv?fila(conv,'Convenio de pago por revisar','#gastos','wa','La administración te propuso un convenio'):'', enc?fila(enc,enc===1?'Encomienda por retirar':'Encomiendas por retirar','#encomiendas','in','En conserjería'):'',
        msj?fila(msj,msj===1?'Mensaje sin leer':'Mensajes sin leer','#mensajes','in'):'', porVotar?fila(porVotar,porVotar===1?'Votación abierta':'Votaciones abiertas','#encuestas','wa','Tu unidad aún no vota'):'',
        prox?fila('📅',`Reserva: ${prox.espacio_nombre}`,'#reservas','mu',`${fmtDay(prox.fecha)} de ${pad(prox.h_ini)}:00 a ${pad(prox.h_fin)}:00${prox.estado==='pendiente'?' · por aprobar':''}`):''].filter(Boolean);
      const otras=(S.misUnidades||[]).length>1?`<div class="card"><h3>Tus unidades</h3><div class="list">${S.misUnidades.map(x=>{ const zz=D?.U[x.depto]; const t=(zz?.deuda||0)+(zz?.interes||0);
          return `<div class="item" data-uni="${esc(x.depto)}"><div class="hd"><b>Depto ${esc(x.depto)}${x.depto===dep?' · la que estás viendo':''}</b>${t>0?`<span class="pill ${zz?.vencido>0?'er':'wa'}">${clp(t)} por pagar</span>`:'<span class="pill ok">Al día</span>'}</div><div class="meta">${x.rol==='propietario'?'Propietario':'Residente'}${x.depto!==dep?' · toca para verla':''}</div></div>`; }).join('')}</div></div>`:'';
      el.innerHTML=cobro+otras+`<h2>Pendiente</h2><div class="list">${items.join('')||nada}</div>`; }, {silent:true});
    return;
  }
  const canal=Object.keys(canalRol).find(c=>canalRol[c]===r);
  const tablas=['facturas','proveedor_ingresos','novedades','turnos','contratos','emergencia_simulacros','asambleas','registro_personas','suspensiones','suspension_votos','polizas','unidad_documentos','solicitudes_datos','usuarios','reservas','incidencias','conversaciones','estacionamiento_usos','gastos','gasto_unidades','pagos','convenios','lecturas','encomiendas','visitas','ot','infracciones','infraccion_votos'];
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
    if(r==='admin'){ const sd=(await q(T('solicitudes_datos').select('vence,estado')).catch(()=>[])).filter(x=>['recibida','en_curso'].includes(x.estado)).sort((a,b)=>a.vence<b.vence?-1:1);
      add(sd.length,sd.length===1?'Solicitud sobre datos personales':'Solicitudes sobre datos personales','#admin--datos','er',sd.length?'La primera vence el '+fmtDay(sd[0].vence)+' (Ley 21.719)':''); }
    add(resv,'Reservas por aprobar','#reservas','wa');
    add(msj,'Mensajes sin leer','#mensajes','in');
    add(enc,'Encomiendas por entregar','#encomiendas','in');
    add(vis,'Visitas anunciadas para hoy','#visitas','in');
    const excAdm=est.filter(u=>u.aviso_admin_at).length, excRes=est.filter(u=>u.alerta_residente_at&&!u.aviso_admin_at).length;
    add(excAdm,'Estacionamientos de visita excedidos','#estacionamientos','er','Superaron el tiempo máximo');
    if(r==='conserje') add(excRes,'Visitas cerca del tiempo máximo','#estacionamientos','wa','Ya se avisó al residente');
    add(inc,'Incidencias abiertas','#incidencias','wa');
    if(['admin','comite'].includes(r)){ const [falt,pols,udocs]=await Promise.all([q(sb.rpc('polizas_faltantes')).catch(()=>[]), q(T('polizas').select('tipo,desde,hasta')).catch(()=>[]), r==='admin'?q(T('unidad_documentos').select('estado')).catch(()=>[]):[]]);
      (falt||[]).forEach(t=>add('!',`Sin póliza vigente: ${TIPO_POLIZA[t]||t}`,'#seguros','er',t==='incendio'?'Obligatoria por ley (Ley 21.442, art. 43)':''));
      const porVencer=[...new Set(pols.map(p=>p.tipo))].map(t=>pols.filter(p=>p.tipo===t&&p.desde<=hoy).sort((a,b)=>a.desde<b.desde?1:-1)[0]).filter(p=>p&&p.hasta>=hoy&&diasA(p.hasta)<=60);
      porVencer.forEach(p=>add(diasA(p.hasta)+' d',`Póliza de ${(TIPO_POLIZA[p.tipo]||p.tipo).split(' (')[0].toLowerCase()} por vencer`,'#seguros',diasA(p.hasta)<=15?'er':'wa','Vence el '+fmtDay(p.hasta)));
      add(udocs.filter(x=>x.estado==='en_revision').length,'Documentos de unidades por revisar','#seguros--unidades','wa','Pólizas y certificados subidos por propietarios'); }
    if(['conserje','admin','comite'].includes(r)&&modAbierto('ingresos')){ const pi=await q(T('proveedor_ingresos').select('estado,programado').in('estado',['programado','dentro'])).catch(()=>[]);
      if(r==='conserje') add(pi.filter(x=>x.estado==='dentro').length,'Proveedores dentro del edificio','#ingresos','in','Registra su salida al irse');
      add(pi.filter(x=>x.estado==='programado'&&x.programado===hoy).length,'Proveedores que vienen hoy','#ingresos','in'); }
    if(r==='conserje'&&modAbierto('novedades')){ const tu=await q(T('turnos').select('uid,fin').is('fin',null)).catch(()=>[]); if(!tu.some(t=>t.uid===S.uid)) add('📓','Inicia tu turno','#novedades','wa','Lee lo que dejó pendiente el turno anterior'); }
    if(['admin','comite'].includes(r)&&modAbierto('novedades')){ const ayer=new Date(Date.now()-864e5).toISOString(); add(await cuenta(q(T('novedades').select('id').eq('importante',true).gte('ts',ayer))),'Novedades importantes en las últimas 24 horas','#novedades','wa'); }
    if(r==='admin'){ const fv=(await q(T('facturas').select('total,vence').eq('estado','por_pagar')).catch(()=>[])).filter(f=>f.vence&&f.vence<hoy);
      add(fv.length, fv.length===1?'Factura de proveedor vencida':'Facturas de proveedores vencidas','#finanzas--facturas','er',clp(fv.reduce((a,f)=>a+Number(f.total),0))); }
    if(['admin','comite'].includes(r)&&modAbierto('proveedores')){ const ct=(await q(T('contratos').select('titulo,hasta,aviso_dias,terminado')).catch(()=>[])).filter(c=>!c.terminado&&c.hasta);
      ct.filter(c=>c.hasta<hoy).forEach(c=>add('📄',`${c.titulo}: vencido`,'#proveedores','er','Venció el '+fmtDay(c.hasta)));
      ct.filter(c=>c.hasta>=hoy&&diasA(c.hasta)<=Math.max(c.aviso_dias,7)).forEach(c=>add(diasA(c.hasta)+' d',`${c.titulo} por vencer`,'#proveedores',diasA(c.hasta)<=7?'er':'wa','Vence el '+fmtDay(c.hasta))); }
    if(r==='admin'&&modAbierto('emergencia')){ const E=S.cfg?.emergencia||{}; const ult=(await q(T('emergencia_simulacros').select('fecha').order('fecha',{ascending:false}).limit(1)).catch(()=>[]))[0];
      if(!E.documento) add('🚨','Falta subir el plan de emergencia','#emergencia','wa','Lo exige la Ley de Copropiedad');
      if(!ult||diasA(ult.fecha)<-365) add('🚨',ult?'Más de un año sin simulacro':'Sin simulacros registrados','#emergencia','wa','Conviene hacer al menos uno al año'); }
    if(['admin','comite'].includes(r)&&modAbierto('asambleas')){ const as=await q(T('asambleas').select('*')).catch(()=>[]);
      as.filter(x=>x.estado==='cerrada'&&!x.acta_firmada_at).forEach(x=>add('🏛️',`Acta de la asamblea nº ${x.folio} sin firmar`,'#asambleas--'+x.id,x.acta_hasta<hoy?'er':'wa','Plazo: '+fmtDay(x.acta_hasta)));
      as.filter(x=>x.estado==='borrador').forEach(x=>add('🏛️',`Asamblea nº ${x.folio} sin citar`,'#asambleas--'+x.id,'wa','Citar entre '+Number(S.cfg?.asambleas?.cita_min??5)+' y '+Number(S.cfg?.asambleas?.cita_max??15)+' días antes')); }
    if(r==='admin'&&modAbierto('registro')){ const rp=await q(T('registro_personas').select('estado,baja_solicitada,hasta')).catch(()=>[]); add(rp.filter(p=>p.estado==='pendiente'||(p.baja_solicitada&&!p.hasta)).length,'Cambios en el registro de copropietarios','#registro','wa','Informados por propietarios'); }
    if(['admin','comite'].includes(r)){ const sps=await q(T('suspensiones').select('*')).catch(()=>[]), svs=r==='comite'?await q(T('suspension_votos').select('*')).catch(()=>[]):[];
      if(r==='comite') add(sps.filter(x=>x.estado==='en_comite'&&!svs.some(v=>v.suspension_id===x.id&&v.ronda===x.ronda&&v.uid===S.uid)).length,'Suspensiones de luz por aprobar','#finanzas--suspension','er','Cada unidad necesita la aprobación del comité');
      else { sps.filter(x=>x.estado==='por_reponer').forEach(x=>add('⚡',`Reponer la luz del depto ${x.depto}`,'#finanzas--suspension','er','A más tardar el '+fmtDay(x.reponer_antes)+' (art. 36)'));
        add(sps.filter(x=>x.estado==='avisada'&&x.fecha_prevista<=hoy).length,'Suspensiones con el aviso cumplido','#finanzas--suspension','wa','Revisa si regularizaron antes de solicitar el corte');
        add(sps.filter(x=>x.estado==='aprobada').length,'Suspensiones aprobadas sin aviso previo','#finanzas--suspension','wa'); } }
    if(['admin','comite'].includes(r)){ const cs=await q(T('infracciones').select('id,estado,decidir_antes,descargos_hasta,descargos_at,ronda')).catch(()=>[]), vs=r==='comite'?await q(T('infraccion_votos').select('infraccion_id,ronda,uid')).catch(()=>[]):[];
      if(r==='admin'){ add(cs.filter(c=>c.estado==='abierto').length,'Casos de multa por decidir','#multas','wa','Formular cargos o archivar');
        add(cs.filter(c=>c.estado==='cargos'&&(c.descargos_at||c.descargos_hasta<hoy)).length,'Casos de multa listos para resolver','#multas','wa','Llegaron los descargos o venció el plazo'); }
      else add(cs.filter(c=>c.estado==='en_comite'&&!vs.some(v=>v.infraccion_id===c.id&&v.ronda===c.ronda&&v.uid===S.uid)).length,'Multas por aprobar','#multas','er','El comité debe aprobarlas antes de cobrarlas'); }
    if(['admin','comite'].includes(r)){ const D=await finDatos().catch(()=>null); if(D){ const mor=Object.values(D.U).filter(z=>z.vencido>0); add(mor.length, mor.length===1?'Unidad con deuda vencida':'Unidades con deuda vencida','#finanzas','er',clp(mor.reduce((a,z)=>a+z.vencido,0))+' vencido'); } }
    if(r==='admin'){ const b=borr.filter(g=>!g.publicado).map(g=>g.periodo).sort(); add(b.length, b.length===1?'Período de gastos comunes en borrador':'Períodos de gastos comunes en borrador','#gastos','wa',b.map(fmtMonth).join(', ')); }
    if(['admin','conserje'].includes(r)){ const pub=new Set(borr.filter(g=>g.publicado).map(g=>g.periodo)); let per=monthStr(); if(r==='admin'){ const b=borr.filter(g=>!g.publicado).map(g=>g.periodo).sort(); if(b.length) per=b[0]; }
      if(!pub.has(per)) (await lecturasFaltan(per)).forEach(x=>add(`${x.n}/${nU()}`,`Lecturas de ${x.md.nombre.toLowerCase()}`,'#lecturas','wa',`${fmtMonth(per)}: faltan ${nU()-x.n} ${nU()-x.n===1?'unidad':'unidades'}`)); }
    return L; },
  L=>{ const el=$('#homeEstado'); if(!el) return; el.innerHTML=`<h2>Requiere tu atención</h2><div class="list">${L.join('')||nada}</div>${['conserje','admin'].includes(r)?'<div class="row acc"><button class="btn sec" id="bEmerg">🚨 Unidades con condiciones especiales (emergencias)</button></div>':''}`; }, {silent:true});
}
VIEWS.inicio = function(){
  const r=role(); const mods=MODULES.filter(m=>puedeVer(m,r) && !['inicio','perfil'].includes(m.id));
  const setupPend = realRole()==='admin' && S.cfg && !S.cfg.configurado_at;
  setMain(`<h1>Hola, ${esc(S.me.nombre.split(' ')[0])}</h1>
  ${setupPend?`<div class="note">Falta terminar la configuración inicial del edificio. <a href="#" id="bWizHome">Continuar con el asistente</a></div>`:''}
  ${PUSH_KEY&&pushOk()&&Notification.permission==='default'?`<div class="info">🔔 <a href="#perfil">Activa las notificaciones</a> para enterarte de encomiendas, mensajes y aprobaciones.</div>`:''}
  ${S.session?.user?.clave_corta?'<div class="note">🔑 Tu contraseña tiene menos de 12 caracteres. Por seguridad, <a href="#perfil">cámbiala en Mi cuenta</a> por una más larga.</div>':''}
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

// SEGUROS (adaptado del módulo E4 de CactusOne): pólizas del edificio con avisos de vencimiento y siniestros,
// y documentos que acredita cada unidad (póliza propia, certificado de dominio), revisados por la administración.
const TIPO_POLIZA={incendio:'Incendio (colectivo, obligatorio)', responsabilidad_civil:'Responsabilidad civil', accidentes_personal:'Accidentes del personal', robo:'Robo', equipos:'Equipos', otro:'Otra'};
const TIPO_DOC={poliza_incendio:'Póliza de incendio y sismo', certificado_dominio:'Certificado de dominio', otro:'Otro documento'};
const EST_DOC={en_revision:['En revisión','wa'], aceptado:['Aceptado','ok'], rechazado:['Rechazado','er']};
const EST_SIN={abierto:['Abierto','wa'], en_liquidacion:['En liquidación','in'], pagado:['Pagado','ok'], rechazado:['Rechazado','er'], cerrado:['Cerrado','mu']};
const diasA=f=>Math.round((new Date(f+'T12:00:00')-new Date(todayStr()+'T12:00:00'))/86400000);
const pillVence=f=>{ const d=diasA(f); return d<0?`<span class="pill er">Vencida hace ${-d} ${-d===1?'día':'días'}</span>`:d<=60?`<span class="pill ${d<=15?'er':'wa'}">Vence en ${d} ${d===1?'día':'días'}</span>`:'<span class="pill ok">Vigente</span>'; };
// ---------- Ingresos de proveedores en portería ----------
const EST_ING={programado:['Programado','in'], dentro:['Dentro','wa'], salio:['Salió','ok'], no_llego:['No llegó','mu']};
VIEWS.ingresos = function(){
  const r=role(), progr=['comite','admin'].includes(r); let xs=[], pv=[], dias=30, qq='';
  setMain(`<h1>Ingresos de proveedores</h1><p class="small muted">Técnicos, proveedores y empresas que entran al edificio: quién, de qué empresa, a qué y a dónde, con la hora de entrada y de salida.${progr?' Puedes programar una visita para que conserjería la espere.':''}</p>
    <div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bIng">Registrar ingreso</button>${progr?'<button class="btn sec" id="bProg">Programar visita</button>':''}</div><div id="ingBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['proveedor_ingresos','proveedores'], async()=>{ const desde=new Date(Date.now()-dias*864e5).toISOString(); const [a1,a2,b]=await Promise.all([q(T('proveedor_ingresos').select('*').in('estado',['programado','dentro'])), q(T('proveedor_ingresos').select('*').gte('ts',desde).order('ts',{ascending:false}).limit(1000)), q(T('proveedores').select('id,nombre,rubro,telefono,activo').order('nombre'))]);
      const a=[...a1, ...a2.filter(x=>!a1.some(y=>y.id===x.id))]; return {a,b}; },
    ({a,b})=>{ xs=a; pv=b.filter(p=>p.activo); if(!$('.modal')) draw(); });
  const listo=()=>w.reload(), hoy=todayStr();
  const fila=x=>`<div class="item static"><div class="hd"><b>${esc(x.empresa)}${x.nombre?' · '+esc(x.nombre):''}</b><span class="row" style="gap:4px">${pillOf(EST_ING,x.estado)}<span class="muted small">${x.estado==='programado'?fmtDay(x.programado):x.ingreso_at?fmtDate(x.ingreso_at):''}</span></span></div>
    <div class="meta">${esc(x.motivo||'')}${x.destino?' · '+esc(x.destino):''}${x.depto?' · depto '+esc(x.depto):''}${x.rut?' · '+esc(x.rut):''}${x.patente?' · 🚗 '+esc(x.patente):''}${x.salida_at?' · salió '+horaDe(x.salida_at):''}${x.nota?' · '+esc(x.nota):''}</div>
    ${x.estado==='dentro'?`<div class="row acc"><button class="btn sm" data-isal="${x.id}">Registrar salida</button></div>`:x.estado==='programado'?`<div class="row acc"><button class="btn sm" data-ille="${x.id}">Llegó</button><button class="btn sec sm" data-ino="${x.id}">No llegó</button></div>`:''}</div>`;
  const draw=()=>{ const el=$('#ingBody'); if(!el) return; const den=xs.filter(x=>x.estado==='dentro'), pro=xs.filter(x=>x.estado==='programado').sort((a,b)=>a.programado<b.programado?-1:1), his=xs.filter(x=>['salio','no_llego'].includes(x.estado)).filter(x=>!qq||sinTildes([x.empresa,x.nombre,x.rut,x.patente,x.motivo,x.destino,x.depto].join(' ')).includes(sinTildes(qq)));
    el.innerHTML=`<h2>Dentro del edificio (${den.length})</h2><div class="list">${den.map(fila).join('')||'<div class="empty">Nadie dentro</div>'}</div>
      <h2>Programados</h2><div class="list">${pro.map(x=>(x.programado<hoy?fila(x).replace('pill in','pill er'):fila(x))).join('')||'<div class="empty">Sin visitas programadas</div>'}</div>
      <div class="row wrap" style="margin-top:16px"><h2 class="grow" style="margin:0">Últimos ${dias} días</h2><input type="search" id="ingQ" placeholder="Buscar empresa, persona, RUT, patente…" value="${esc(qq)}" style="max-width:280px"><button class="btn sec sm" id="ingXls">Excel</button></div>
      <div class="list" style="margin-top:8px">${his.map(fila).join('')||'<div class="empty">Sin registros</div>'}</div>`;
    $('#ingQ').addEventListener('input',e=>{ qq=e.target.value; const pos=e.target.selectionStart; draw(); const i=$('#ingQ'); i.focus(); i.setSelectionRange(pos,pos); }); };
  const form=(x={}, prog=false)=>{ const m=modal(`<h3>${prog?'Programar visita':x.id?'Registrar llegada':'Registrar ingreso'}</h3><form id="fIng">
      <div class="row"><label class="f grow"><span>Proveedor</span><select name="proveedor_id"><option value="">Otro (escribir la empresa)</option>${pv.map(p=>`<option value="${p.id}" ${x.proveedor_id===p.id?'selected':''}>${esc(p.nombre)}${p.rubro?' · '+esc(p.rubro):''}</option>`).join('')}</select></label><label class="f grow" id="ingEmp"><span>Empresa</span><input type="text" name="empresa" value="${esc(x.proveedor_id?'':x.empresa||'')}"></label></div>
      ${prog?`<label class="f"><span>Día</span><input type="date" name="programado" min="${hoy}" value="${hoy}" required></label>`:`<div class="row"><label class="f grow"><span>Nombre de quien viene</span><input type="text" name="nombre" value="${esc(x.nombre||'')}" required></label><label class="f"><span>RUT</span><input type="text" name="rut" value="${esc(x.rut||'')}" style="width:140px"></label><label class="f"><span>Patente</span><input type="text" name="patente" value="${esc(x.patente||'')}" style="width:110px;text-transform:uppercase"></label></div>`}
      <label class="f"><span>Motivo</span><input type="text" name="motivo" value="${esc(x.motivo||'')}" required placeholder="Ej: mantención de ascensores, reparación de filtración"></label>
      <div class="row"><label class="f grow"><span>Destino</span><input type="text" name="destino" value="${esc(x.destino||'')}" placeholder="Ej: sala de bombas, azotea"></label><label class="f"><span>Unidad (si va a un depto)</span><input type="text" name="depto" value="${esc(x.depto||'')}" list="dlIng" style="width:110px"><datalist id="dlIng">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label></div>
      <button class="btn full">${prog?'Programar':'Registrar ingreso'}</button></form>`);
    const vis=()=>{ $('#ingEmp',m).style.display=$('[name=proveedor_id]',m).value?'none':''; }; $('[name=proveedor_id]',m).addEventListener('change',vis); vis();
    $('#fIng',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button.full',m); busy(b,true);
      const o={proveedor_id:d.proveedor_id||null, empresa:d.proveedor_id?'':d.empresa.trim(), motivo:d.motivo.trim(), destino:d.destino.trim(), depto:d.depto.trim()||null};
      if(prog){ o.programado=d.programado; o.estado='programado'; } else { Object.assign(o,{nombre:d.nombre.trim(), rut:d.rut.trim(), patente:d.patente.trim(), estado:'dentro'}); }
      try{ await q(x.id?T('proveedor_ingresos').update(o).eq('id',x.id):T('proveedor_ingresos').insert(o)); closeModal(); toast(prog?'Visita programada':'Ingreso registrado'); listo(); }catch(err){ toast(errMsg(err)); busy(b,false); } }); };
  $('#bIng').addEventListener('click',()=>form());
  $('#bProg')?.addEventListener('click',()=>form({},true));
  $('#ingBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-isal]')){ try{ await q(T('proveedor_ingresos').update({estado:'salio'}).eq('id',b.dataset.isal)); toast('Salida registrada'); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-ille]')) form(xs.find(x=>x.id===b.dataset.ille));
    else if(b=t('[data-ino]')){ try{ await q(T('proveedor_ingresos').update({estado:'no_llego'}).eq('id',b.dataset.ino)); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(t('#ingXls')){ const B=v=>({v,b:true}); descargar(new Blob([window.MiniXlsx.build([{name:'Ingresos', widths:[18,18,24,22,14,10,30,20,8,10], rows:[[B(S.cfg?.nombre||'')],[B('Ingresos de proveedores')],[],[B('Entrada'),B('Salida'),B('Empresa'),B('Persona'),B('RUT'),B('Patente'),B('Motivo'),B('Destino'),B('Unidad'),B('Estado')], ...xs.filter(x=>x.estado!=='programado').map(x=>[x.ingreso_at?fmtDate(x.ingreso_at):'', x.salida_at?fmtDate(x.salida_at):'', x.empresa, x.nombre||'', x.rut||'', x.patente||'', x.motivo||'', x.destino||'', x.depto||'', EST_ING[x.estado][0]])]}])],{type:window.MiniXlsx.MIME}), 'ingresos-proveedores.xlsx'); } });
};

// ---------- Libro de novedades y turnos ----------
const CAT_NOV={novedad:['Novedad','mu'], seguridad:['Seguridad','er'], mantencion:['Mantención','wa'], aseo:['Aseo','in'], visita:['Visitas','in'], reclamo:['Reclamo','wa'], instruccion:['Instrucción','ok'], otro:['Otro','mu']};
async function resumenTurno(){ const hoy=todayStr(); const [enc,vis,est,inc,prv]=await Promise.all([
  q(T('encomiendas').select('id').eq('entregado',false)).catch(()=>[]), q(T('visitas').select('id').eq('estado','ingreso')).catch(()=>[]),
  q(T('estacionamiento_usos').select('id').is('fin',null)).catch(()=>[]), q(T('incidencias').select('id').eq('estado','abierta')).catch(()=>[]), q(T('proveedor_ingresos').select('id').eq('estado','dentro')).catch(()=>[])]);
  return {encomiendas:enc.length, visitas_dentro:vis.length, estacionamientos:est.length, incidencias:inc.length, proveedores_dentro:prv.length, fecha:hoy}; }
const txtResumen=r=>[r.encomiendas?`${r.encomiendas} encomiendas por entregar`:'', r.visitas_dentro?`${r.visitas_dentro} visitas dentro`:'', r.estacionamientos?`${r.estacionamientos} estacionamientos de visita ocupados`:'', r.incidencias?`${r.incidencias} incidencias abiertas`:'', r.proveedores_dentro?`${r.proveedores_dentro} proveedores dentro del edificio`:''].filter(Boolean).join(' · ');
VIEWS.novedades = function(){
  const r=role(), turnea=['conserje','admin'].includes(r); let ns=[], ts=[], filtro={q:'', cat:'', imp:false, dias:7};
  setMain(`<h1>Libro de novedades</h1><div id="nvTurno"></div>
    <div class="card"><form id="fNv"><label class="f"><span>Anotar una novedad</span><textarea name="texto" rows="3" required placeholder="Qué pasó, dónde, a qué hora, quiénes participaron y qué se hizo"></textarea></label>
      <div class="row wrap"><label class="f"><span>Tipo</span><select name="categoria" style="width:auto">${Object.entries(CAT_NOV).filter(([k])=>k!=='instruccion'||r!=='conserje').map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('')}</select></label><label class="f"><span>Unidad (si aplica)</span><input type="text" name="depto" list="dlNv" style="width:110px"><datalist id="dlNv">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f grow"><span>Foto</span><input type="file" name="foto" accept="image/*" capture="environment"></label></div>
      <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="importante"> Importante (se destaca para el turno siguiente y la administración)</label>
      <p class="small muted">Lo anotado no se puede editar ni borrar: para corregir, agrega otra anotación.</p><button class="btn">Anotar</button></form></div>
    <div class="row wrap" style="margin:8px 0"><input type="search" id="nvQ" placeholder="Buscar en el libro" class="grow"><select id="nvCat" style="width:auto"><option value="">Todos los tipos</option>${Object.entries(CAT_NOV).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('')}</select><select id="nvDias" style="width:auto"><option value="1">Hoy</option><option value="7" selected>7 días</option><option value="31">31 días</option><option value="365">Un año</option></select><label class="sw"><input type="checkbox" id="nvImp"> Solo importantes</label><button class="btn sec sm" id="nvXls">Excel</button></div>
    <div id="nvLista"><div class="empty">Cargando…</div></div>`);
  const w=watch(['novedades','turnos'], async()=>{ const desde=new Date(Date.now()-filtro.dias*864e5); desde.setHours(0,0,0,0);
      const [a,b]=await Promise.all([q(T('novedades').select('*').gte('ts',desde.toISOString()).order('ts',{ascending:false}).limit(2000)), q(T('turnos').select('*').order('inicio',{ascending:false}).limit(200))]); return {a,b}; },
    ({a,b})=>{ ns=a; ts=b; turno(); lista(); });
  const turno=()=>{ const el=$('#nvTurno'); if(!el||!turnea) return; const mio=ts.find(t=>t.uid===S.uid&&!t.fin), ult=ts.find(t=>t.fin);
    el.innerHTML=mio?`<div class="info row wrap"><span class="grow">En turno desde las ${horaDe(mio.inicio)}${mio.inicio.slice(0,10)!==new Date().toISOString().slice(0,10)?' del '+fmtDay(mio.inicio.slice(0,10)):''}. Lo que anotes queda en tu turno.</span><button class="btn sm" id="nvEnt">Entregar turno</button></div>`
      :`<div class="card" style="border-color:var(--wa)"><h3>Inicia tu turno</h3>${ult?`<p class="small muted">Último turno: ${esc(userName(ult.uid))}, entregado el ${fmtDate(ult.fin)}${ult.recibe_uid?' · recibido por '+esc(userName(ult.recibe_uid)):''}.</p>${ult.entrega?`<div class="note" style="white-space:pre-wrap"><b>Dejó pendiente:</b> ${esc(ult.entrega)}</div>`:''}${txtResumen(ult.resumen||{})?`<p class="small">${esc(txtResumen(ult.resumen))}</p>`:''}${ns.filter(n=>n.turno_id===ult.id&&n.importante).map(n=>`<div class="small">⚠️ ${horaDe(n.ts)} · ${esc(n.texto)}</div>`).join('')}`:'<p class="small muted">No hay turnos anteriores.</p>'}
        <button class="btn" id="nvIni" style="margin-top:8px">${ult&&!ult.recibe_uid?'Recibo el turno e inicio':'Iniciar turno'}</button></div>`; };
  const pasa=n=>(!filtro.cat||n.categoria===filtro.cat)&&(!filtro.imp||n.importante)&&(!filtro.q||sinTildes(n.texto+' '+(n.depto||'')+' '+userName(n.uid)).includes(sinTildes(filtro.q)));
  const lista=()=>{ const el=$('#nvLista'); if(!el) return; const vis=ns.filter(pasa); const ev=[...vis.map(n=>({ts:n.ts, n})), ...(filtro.q||filtro.cat||filtro.imp?[]:ts.flatMap(t=>[{ts:t.inicio, ini:t}, ...(t.fin?[{ts:t.fin, fin:t}]:[])]))].filter(x=>x.ts>=new Date(Date.now()-filtro.dias*864e5).toISOString().slice(0,10)).sort((a,b)=>a.ts<b.ts?1:-1);
    let dia=''; el.innerHTML=ev.map(x=>{ const d=x.ts.slice(0,10); const cab=d!==dia?`<h2 style="margin-top:16px">${fmtDay(new Date(x.ts).toISOString().slice(0,10))}</h2>`:''; dia=d;
      if(x.ini) return cab+`<div class="small muted" style="padding:6px 2px">▶ ${horaDe(x.ts)} · inicia turno ${esc(userName(x.ini.uid))}</div>`;
      if(x.fin) return cab+`<div class="small muted" style="padding:6px 2px">■ ${horaDe(x.ts)} · entrega turno ${esc(userName(x.fin.uid))}${x.fin.entrega?': '+esc(x.fin.entrega):''}${txtResumen(x.fin.resumen||{})?' · '+esc(txtResumen(x.fin.resumen)):''}</div>`;
      const n=x.n; return cab+`<div class="item static" ${n.importante?'style="border-color:var(--er)"':''}><div class="hd"><b>${horaDe(n.ts)} · ${esc(userName(n.uid))}</b><span class="row" style="gap:4px">${n.importante?'<span class="pill er">Importante</span>':''}${pillOf(CAT_NOV,n.categoria)}</span></div><div style="white-space:pre-wrap">${n.depto?`<b>Depto ${esc(n.depto)}:</b> `:''}${esc(n.texto)}</div>${n.foto?`<div class="photos"><img data-f="${esc(n.foto)}" data-img="${esc(n.foto)}"></div>`:''}</div>`; }).join('')||'<div class="empty">Sin anotaciones en este período</div>'; };
  $('#fNv').addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target), b=$('button',e.target); busy(b,true);
    try{ const f=$('[name=foto]',e.target).files[0]; const foto=f?await uploadImage(f,'novedades'):''; const dep=d.depto.trim(); if(dep&&!S.unidades[dep]) throw new Error('Esa unidad no existe');
      await q(T('novedades').insert({texto:d.texto.trim(), categoria:d.categoria, depto:dep||null, importante:!!d.importante, foto})); e.target.reset(); toast('Anotado'); w.reload(); }catch(err){ toast(errMsg(err)); } busy(b,false); });
  $('#nvQ').addEventListener('input',e=>{ filtro.q=e.target.value.trim(); lista(); });
  $('#nvCat').addEventListener('change',e=>{ filtro.cat=e.target.value; lista(); });
  $('#nvImp').addEventListener('change',e=>{ filtro.imp=e.target.checked; lista(); });
  $('#nvDias').addEventListener('change',e=>{ filtro.dias=Number(e.target.value); w.reload(); });
  $('#nvXls').addEventListener('click',()=>{ const B=v=>({v,b:true}); descargar(new Blob([window.MiniXlsx.build([{name:'Novedades', widths:[18,22,14,10,70,12], rows:[[B(S.cfg?.nombre||'')],[B('Libro de novedades')],[],[B('Fecha'),B('Quién'),B('Tipo'),B('Unidad'),B('Novedad'),B('Importante')], ...ns.filter(pasa).map(n=>[fmtDate(n.ts), userName(n.uid), CAT_NOV[n.categoria][0], n.depto||'', n.texto, n.importante?'sí':''])]}])],{type:window.MiniXlsx.MIME}), 'libro-novedades.xlsx'); });
  $('#nvTurno').addEventListener('click', async e=>{
    if(e.target.closest('#nvIni')){ try{ await q(sb.rpc('iniciar_turno')); toast('Turno iniciado'); w.reload(); }catch(err){ toast(errMsg(err)); } }
    else if(e.target.closest('#nvEnt')){ const res=await resumenTurno(); const mio=ts.find(t=>t.uid===S.uid&&!t.fin); const imp=ns.filter(n=>n.turno_id===mio?.id&&n.importante);
      const m=modal(`<h3>Entregar turno</h3><p class="small">${esc(txtResumen(res)||'Sin pendientes registrados en la app.')}</p>${imp.length?`<div class="note">${imp.map(n=>`⚠️ ${horaDe(n.ts)} · ${esc(n.texto)}`).join('<br>')}</div>`:''}<form id="fEnt"><label class="f"><span>Qué queda pendiente para el turno siguiente</span><textarea name="t" rows="4" placeholder="Ej: técnico del portón viene a las 10:00; llave de la sala de eventos la tiene el 304"></textarea></label><button class="btn full">Entregar turno</button></form>`);
      $('#fEnt',m).addEventListener('submit', async ev=>{ ev.preventDefault(); try{ await q(sb.rpc('entregar_turno',{p_entrega:formData(ev.target).t, p_resumen:res})); closeModal(); toast('Turno entregado'); w.reload(); }catch(err){ toast(errMsg(err)); } }); } });
};

// ---------- Fichas de la unidad: vehículos, mascotas, bodegas y estacionamientos ----------
const ESPECIES={perro:'🐶 Perro', gato:'🐱 Gato', otro:'🐾 Otra'};
async function fichaUnidad(el, depto, {edita=false, espacios=false}={}){ let vs=[], ms=[], es=[];
  try{ [vs,ms,es]=await Promise.all([q(T('unidad_vehiculos').select('*').eq('depto',depto).order('ts')), q(T('unidad_mascotas').select('*').eq('depto',depto).order('ts')), q(T('unidad_espacios').select('*').eq('depto',depto).order('tipo').order('numero'))]); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; }
  const quitar=(t,id)=>edita?`<button class="btn sec sm" data-fq="${t}:${id}" aria-label="Quitar">✕</button>`:'';
  el.innerHTML=`<h3 style="margin-top:4px">🚗 Vehículos</h3><div class="list">${vs.map(v=>`<div class="item static"><div class="hd"><b>${esc(v.patente)}</b>${quitar('unidad_vehiculos',v.id)}</div><div class="meta">${esc([v.tipo!=='auto'?v.tipo:'',v.marca,v.modelo,v.color].filter(Boolean).join(' · '))}${v.notas?' · '+esc(v.notas):''}</div></div>`).join('')||'<div class="small muted">Sin vehículos registrados.</div>'}</div>${edita?'<button class="btn sec sm" data-fadd="v" style="margin-top:6px">+ Vehículo</button>':''}
    <h3>🐾 Mascotas</h3><div class="list">${ms.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.nombre)}</b>${quitar('unidad_mascotas',x.id)}</div><div class="meta">${esc(ESPECIES[x.especie]||x.especie)}${x.raza?' · '+esc(x.raza):''}${x.color?' · '+esc(x.color):''}${x.chip?' · chip '+esc(x.chip):''}${x.notas?' · '+esc(x.notas):''}</div>${x.foto?`<div class="photos"><img data-f="${esc(x.foto)}" data-img="${esc(x.foto)}"></div>`:''}</div>`).join('')||'<div class="small muted">Sin mascotas registradas.</div>'}</div>${edita?'<button class="btn sec sm" data-fadd="m" style="margin-top:6px">+ Mascota</button>':''}
    <h3>📦 Bodegas y estacionamientos</h3><div class="list">${es.map(x=>`<div class="item static"><div class="hd"><b>${x.tipo==='bodega'?'Bodega':'Estacionamiento'} ${esc(x.numero)}</b>${espacios?`<button class="btn sec sm" data-fq="unidad_espacios:${x.id}" aria-label="Quitar">✕</button>`:''}</div>${x.notas?`<div class="meta">${esc(x.notas)}</div>`:''}</div>`).join('')||'<div class="small muted">Sin bodegas ni estacionamientos asignados.</div>'}</div>${espacios?'<button class="btn sec sm" data-fadd="e" style="margin-top:6px">+ Bodega o estacionamiento</button>':(edita?'<p class="small muted">Las bodegas y estacionamientos los asigna la administración.</p>':'')}`;
  const otra=()=>fichaUnidad(el, depto, {edita, espacios});
  el.onclick=async e=>{ const b=e.target.closest('[data-fq],[data-fadd]'); if(!b) return; e.preventDefault();
    if(b.dataset.fq){ const [t,id]=b.dataset.fq.split(':'); if(!await confirmBox('¿Quitar de la ficha de la unidad?')) return; try{ await q(T(t).delete().eq('id',id)); otra(); }catch(err){ toast('Error: '+errMsg(err)); } return; }
    const k=b.dataset.fadd; const F={v:`<h3>Vehículo</h3><form id="fFi"><div class="row"><label class="f grow"><span>Patente</span><input type="text" name="patente" required style="text-transform:uppercase" placeholder="ABCD12"></label><label class="f"><span>Tipo</span><select name="tipo"><option value="auto">Auto</option><option value="moto">Moto</option><option value="bicicleta">Bicicleta</option><option value="otro">Otro</option></select></label></div><div class="row"><label class="f grow"><span>Marca</span><input type="text" name="marca"></label><label class="f grow"><span>Modelo</span><input type="text" name="modelo"></label><label class="f grow"><span>Color</span><input type="text" name="color"></label></div><button class="btn full">Agregar</button></form>`,
      m:`<h3>Mascota</h3><form id="fFi"><div class="row"><label class="f grow"><span>Nombre</span><input type="text" name="nombre" required></label><label class="f"><span>Especie</span><select name="especie">${Object.entries(ESPECIES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div><div class="row"><label class="f grow"><span>Raza</span><input type="text" name="raza"></label><label class="f grow"><span>Color</span><input type="text" name="color"></label><label class="f grow"><span>N° de microchip</span><input type="text" name="chip"></label></div><label class="f"><span>Foto (ayuda a reconocerla si se pierde)</span><input type="file" name="foto" accept="image/*"></label><label class="f"><span>Notas</span><input type="text" name="notas" placeholder="Ej: no sociabiliza con otros perros"></label><button class="btn full">Agregar</button></form>`,
      e:`<h3>Bodega o estacionamiento</h3><form id="fFi"><div class="row"><label class="f"><span>Tipo</span><select name="tipo"><option value="bodega">Bodega</option><option value="estacionamiento">Estacionamiento</option></select></label><label class="f grow"><span>Número</span><input type="text" name="numero" required></label></div><label class="f"><span>Notas</span><input type="text" name="notas" placeholder="Ej: subterráneo -2"></label><button class="btn full">Asignar</button></form>`}[k];
    const m=modal(F); $('#fFi',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const bt=$('button.full',m); busy(bt,true);
      try{ if(k==='v') await q(T('unidad_vehiculos').insert({depto, patente:d.patente, tipo:d.tipo, marca:d.marca.trim(), modelo:d.modelo.trim(), color:d.color.trim()}));
        else if(k==='m'){ const f=$('[name=foto]',m).files[0]; await q(T('unidad_mascotas').insert({depto, nombre:d.nombre.trim(), especie:d.especie, raza:d.raza.trim(), color:d.color.trim(), chip:d.chip.trim(), notas:d.notas.trim(), foto:f?await uploadImage(f,'mascotas'):''})); }
        else await q(T('unidad_espacios').insert({depto, tipo:d.tipo, numero:d.numero.trim(), notas:d.notas.trim()}));
        closeModal(); toast('Agregado'); otra(); }catch(err){ toast(errMsg(err).includes('unique')||errMsg(err).includes('duplicate')?'Ese número ya está asignado a otra unidad':errMsg(err)); busy(bt,false); } }); }; }
VIEWS.fichas = function(){
  const adm=isAdmin(); let vs=[], ms=[], es=[];
  setMain(`<h1>Unidades</h1><p class="small muted">Busca por unidad, propietario, patente, mascota, bodega o estacionamiento. Los vehículos y mascotas los registra cada unidad en Mi cuenta${adm?'; tú también puedes hacerlo desde la ficha':''}.</p><input type="search" id="fiQ" placeholder="Ej: 304, ABCD12, Toby, bodega 12" style="margin-bottom:10px"><div id="fiLista" class="list"><div class="empty">Cargando…</div></div>`);
  const w=watch(['unidad_vehiculos','unidad_mascotas','unidad_espacios','unidades'], async()=>{ const [a,b,c]=await Promise.all([q(T('unidad_vehiculos').select('*')), q(T('unidad_mascotas').select('*')), q(T('unidad_espacios').select('*'))]); return {a,b,c}; }, ({a,b,c})=>{ vs=a; ms=b; es=c; pinta(); });
  const pinta=()=>{ const el=$('#fiLista'); if(!el) return; const qq=sinTildes($('#fiQ').value), qp=qq.replace(/[^a-z0-9]/g,'');
    const us=Object.keys(S.unidades).sort(porNum).map(d=>({d, prop:S.unidades[d]?.prop||'', v:vs.filter(x=>x.depto===d), m:ms.filter(x=>x.depto===d), e:es.filter(x=>x.depto===d)}));
    const hit=u=>!qq||sinTildes(u.d)===qq||sinTildes(u.d).startsWith(qq)||sinTildes(u.prop).includes(qq)||(qp.length>=3&&u.v.some(x=>sinTildes(x.patente).includes(qp)))||u.m.some(x=>sinTildes(x.nombre).includes(qq))||u.e.some(x=>sinTildes((x.tipo==='bodega'?'bodega ':'estacionamiento ')+x.numero).includes(qq)||sinTildes(x.numero)===qq);
    const lista=us.filter(hit);
    el.innerHTML=lista.slice(0,200).map(u=>`<div class="item" data-fi="${esc(u.d)}"><div class="hd"><b>Depto ${esc(u.d)}</b><span class="muted small">${esc(u.prop)}</span></div><div class="meta">${[...u.v.map(x=>'🚗 '+esc(x.patente)), ...u.m.map(x=>(x.especie==='gato'?'🐱 ':x.especie==='perro'?'🐶 ':'🐾 ')+esc(x.nombre)), ...u.e.map(x=>(x.tipo==='bodega'?'📦 Bodega ':'🅿️ Est. ')+esc(x.numero))].join(' · ')||'Sin datos'}</div></div>`).join('')||'<div class="empty">Sin resultados</div>'; };
  $('#fiQ').addEventListener('input',pinta);
  $('#fiLista').addEventListener('click',e=>{ const it=e.target.closest('[data-fi]'); if(!it) return; const d=it.dataset.fi;
    const resid=Object.values(S.users).filter(u=>u.depto===d&&u.estado==='activo'&&['residente','propietario'].includes(u.rol));
    const m=modal(`<h3>Depto ${esc(d)}</h3><p class="small muted">${S.unidades[d]?.prop?'Propietario: '+esc(S.unidades[d].prop)+' · ':''}${resid.length?'En la app: '+resid.map(u=>esc(u.nombre)+' ('+ROLES[u.rol].toLowerCase()+')').join(', '):'Nadie de la unidad usa la app'}</p><div id="fiFicha"><div class="empty">Cargando…</div></div><div class="center" style="margin-top:10px"><button class="btn sec" data-close>Cerrar</button></div>`);
    fichaUnidad($('#fiFicha',m), d, {edita:adm, espacios:adm}).then(()=>w.reload()); });
};

// ---------- Plan de emergencia ----------
const TEL_EMERG=[{n:'Bomberos',t:'132'},{n:'Ambulancia (SAMU)',t:'131'},{n:'Carabineros',t:'133'},{n:'PDI',t:'134'}];
const telLink=t=>`<a href="tel:${esc(String(t).replace(/[^0-9+]/g,''))}">${esc(t)}</a>`;
VIEWS.emergencia = function(){
  const r=role(), edita=['comite','admin'].includes(r), adm=isAdmin(), staff=['conserje','comite','admin'].includes(r);
  let rs=[], sm=[], pv=[];
  setMain(`<h1>Emergencias</h1><div id="emBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['emergencia_responsables','emergencia_simulacros','proveedores','edificios'], async()=>{ const [a,b,c]=await Promise.all([q(T('emergencia_responsables').select('*').order('orden').order('zona')), q(T('emergencia_simulacros').select('*').order('fecha',{ascending:false})), staff?q(T('proveedores').select('nombre,rubro,telefono,activo').eq('activo',true).order('nombre')).catch(()=>[]):[]]); return {a,b,c}; },
    ({a,b,c})=>{ rs=a; sm=b; pv=c.filter(p=>p.telefono); if(!$('.modal')) draw(); });
  const listo=()=>w.reload();
  const draw=()=>{ const el=$('#emBody'); if(!el) return; const E=S.cfg?.emergencia||{}, tels=[...TEL_EMERG,...(E.telefonos||[])], ult=sm[0], viejo=!ult||diasA(ult.fecha)<-365;
    el.innerHTML=`<div class="card" style="border-color:var(--er)"><h3>En una emergencia</h3><div class="grid2">${tels.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.n)}</b><span style="font-size:18px">${telLink(x.t)}</span></div></div>`).join('')}</div>
      ${E.punto?`<p style="margin-top:12px"><b>Punto de encuentro:</b> ${esc(E.punto)}</p>`:''}${E.instrucciones?`<div style="white-space:pre-wrap;margin-top:8px">${esc(E.instrucciones)}</div>`:''}
      <div class="row wrap acc" style="margin-top:12px">${E.documento?`<a class="btn sec" data-f="${esc(E.documento)}" target="_blank" rel="noopener">Plan de emergencia completo</a>`:''}${staff?'<button class="btn sec" id="emImp">Imprimir para conserjería</button>':''}${adm?'<button class="btn sec" id="emEd">Editar plan</button>':''}</div>
      ${adm&&!E.documento?'<div class="note" style="margin-top:10px">Sube el plan de emergencia y evacuación del edificio (la Ley de Copropiedad lo exige), para que todos lo tengan a mano.</div>':''}${E.actualizado?`<p class="small muted">Plan actualizado el ${fmtDay(E.actualizado)}.</p>`:''}</div>
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">Responsables</h3>${edita?'<button class="btn sec sm" id="emRes">Agregar</button>':''}</div>
      ${rs.length?`<div style="overflow:auto"><table><thead><tr><th>Zona</th><th>Función</th><th>Nombre</th><th>Teléfono</th>${edita?'<th></th>':''}</tr></thead><tbody>${rs.map(x=>`<tr><td>${esc(x.zona||'Todo el edificio')}</td><td>${esc(x.funcion)}</td><td>${esc(x.nombre)}${x.depto?' · depto '+esc(x.depto):''}</td><td>${x.telefono?telLink(x.telefono):'—'}</td>${edita?`<td><button class="btn sec sm" data-erd="${x.id}" aria-label="Quitar">✕</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<p class="small muted">Aún no hay responsables definidos: jefe de emergencia, líderes por piso, primeros auxilios, uso de extintores.</p>'}</div>
    ${pv.length?`<div class="card"><h3>Proveedores</h3><div class="grid2">${pv.map(p=>`<div class="item static"><div class="hd"><b>${esc(p.nombre)}</b>${telLink(p.telefono)}</div><div class="meta">${esc(p.rubro||'')}</div></div>`).join('')}</div></div>`:''}
    <div class="card"><h3>Personas que necesitan ayuda para evacuar</h3>${['conserje','admin'].includes(r)?'<p class="small muted">Unidades con personas con movilidad reducida, electrodependientes, con oxígeno o adultos mayores que viven solos, declaradas con su consentimiento. Es un registro reservado: la consulta queda registrada.</p><button class="btn" id="bEmerg">🚨 Ver unidades con condiciones especiales</button>':'<p class="small muted">Si en tu unidad vive alguien que necesitaría ayuda para evacuar (movilidad reducida, oxígeno, electrodependencia, adulto mayor solo), puedes declararlo en <a href="#perfil">Mi cuenta → Condiciones especiales</a>. Es reservado: solo lo consultan la conserjería y la administración en una emergencia.</p>'}</div>
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">Simulacros</h3>${edita?'<button class="btn sec sm" id="emSim">Registrar simulacro</button>':''}</div>
      ${viejo&&edita?`<div class="note" style="margin-top:8px">${ult?'El último simulacro fue hace más de un año.':'No hay simulacros registrados.'} Conviene hacer al menos uno al año.</div>`:''}
      <div class="list">${sm.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.tipo)}</b><span class="muted small">${fmtDay(x.fecha)}</span></div><div class="meta">${x.participantes?x.participantes+' participantes':''}${x.duracion_min?' · evacuación en '+x.duracion_min+' min':''}${x.observaciones?' · '+esc(x.observaciones):''}</div></div>`).join('')||'<div class="empty">Sin simulacros</div>'}</div></div>`; };
  $('#emBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(t('#emEd')) editarPlanEmergencia();
    else if(t('#emImp')) imprimirPlanEmergencia(rs, pv);
    else if(t('#emRes')){ const m=modal(`<h3>Responsable</h3><form id="fEr"><div class="row"><label class="f grow"><span>Función</span><input type="text" name="funcion" list="dlEr" required><datalist id="dlEr">${['Jefe de emergencia','Subjefe de emergencia','Líder de piso','Primeros auxilios','Uso de extintores','Corte de gas y electricidad','Apoyo a personas con movilidad reducida'].map(x=>`<option value="${x}">`).join('')}</datalist></label><label class="f grow"><span>Zona (vacío = todo el edificio)</span><input type="text" name="zona" placeholder="Ej: Piso 3, Torre B"></label></div>
        <div class="row"><label class="f grow"><span>Nombre</span><input type="text" name="nombre" required></label><label class="f"><span>Depto</span><input type="text" name="depto" style="width:100px"></label></div><label class="f"><span>Teléfono</span><input type="tel" name="telefono"></label><p class="small muted">El teléfono lo ve toda la comunidad: agrégalo solo si la persona lo autoriza.</p><button class="btn full">Agregar</button></form>`);
      $('#fEr',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(T('emergencia_responsables').insert({funcion:d.funcion.trim(), zona:d.zona.trim(), nombre:d.nombre.trim(), depto:d.depto.trim(), telefono:d.telefono.trim(), orden:/jefe/i.test(d.funcion)?0:1})); closeModal(); toast('Responsable agregado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); }
    else if(b=t('[data-erd]')){ if(!await confirmBox('¿Quitar a esta persona de los responsables?')) return; try{ await q(T('emergencia_responsables').delete().eq('id',b.dataset.erd)); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }
    else if(t('#emSim')){ const m=modal(`<h3>Simulacro</h3><form id="fSm"><div class="row"><label class="f grow"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}" max="${todayStr()}" required></label><label class="f grow"><span>Tipo</span><input type="text" name="tipo" value="Evacuación por incendio" list="dlSm"><datalist id="dlSm"><option value="Evacuación por incendio"><option value="Sismo"><option value="Fuga de gas"></datalist></label></div>
        <div class="row"><label class="f grow"><span>Participantes</span><input type="number" name="participantes" min="0"></label><label class="f grow"><span>Minutos en evacuar</span><input type="number" name="duracion" min="0"></label></div><label class="f"><span>Observaciones</span><textarea name="obs" placeholder="Qué funcionó, qué mejorar"></textarea></label><button class="btn full">Registrar</button></form>`);
      $('#fSm',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(T('emergencia_simulacros').insert({fecha:d.fecha, tipo:d.tipo.trim()||'Evacuación', participantes:d.participantes?Number(d.participantes):null, duracion_min:d.duracion?Number(d.duracion):null, observaciones:d.obs.trim()})); closeModal(); toast('Simulacro registrado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); } });
};
function editarPlanEmergencia(){ const E=S.cfg?.emergencia||{};
  const m=modal(`<h3>Plan de emergencia</h3><form id="fPe"><label class="f"><span>Punto de encuentro</span><input type="text" name="punto" value="${esc(E.punto||'')}" placeholder="Ej: plaza frente al acceso principal"></label>
    <label class="f"><span>Instrucciones breves</span><textarea name="instrucciones" rows="5" placeholder="Ej: no use ascensores; baje por la escalera norte; si hay humo, avance agachado…">${esc(E.instrucciones||'')}</textarea></label>
    <label class="f"><span>Otros teléfonos (uno por línea: nombre: número)</span><textarea name="tels" rows="3" placeholder="Conserjería: +56 2 2345 6789&#10;Gas (emergencias): 600 …">${esc((E.telefonos||[]).map(x=>x.n+': '+x.t).join('\n'))}</textarea></label>
    <label class="f"><span>Documento del plan (PDF) ${E.documento?'· ya cargado; elige otro para reemplazarlo':''}</span><input type="file" name="doc" accept="application/pdf,image/*"></label>
    <p class="small muted">Bomberos (132), SAMU (131), Carabineros (133) y PDI (134) se muestran siempre.</p><button class="btn full">Guardar</button></form>`);
  $('#fPe',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const b=$('button.full',m); busy(b,true);
    try{ const f=$('[name=doc]',m).files[0]; const documento=f?await uploadFile(f,'emergencia'):(E.documento||'');
      const telefonos=d.tels.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const i=l.lastIndexOf(':'); return i>0?{n:l.slice(0,i).trim(), t:l.slice(i+1).trim()}:{n:'Teléfono', t:l}; });
      const emergencia={...E, punto:d.punto.trim(), instrucciones:d.instrucciones.trim(), telefonos, documento, actualizado:todayStr()};
      await q(T('edificios').update({emergencia}).eq('id',S.cfg.id)); S.cfg.emergencia=emergencia; closeModal(); toast('Plan guardado'); routeNow(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); }
async function imprimirPlanEmergencia(rs, pv){ const E=S.cfg?.emergencia||{}, cab=await cabeceraImpresion();
  imprimir('plan-emergencia', `${cab}<h1>Plan de emergencia · resumen</h1><p class="sub">Para tener a la vista en conserjería${E.actualizado?' · actualizado el '+fmtDay(E.actualizado):''}</p>
    <h2>Teléfonos</h2><table><tbody>${[...TEL_EMERG,...(E.telefonos||[])].map(x=>`<tr><td>${esc(x.n)}</td><td><b>${esc(x.t)}</b></td></tr>`).join('')}${pv.map(p=>`<tr><td>${esc(p.nombre)}${p.rubro?' ('+esc(p.rubro)+')':''}</td><td>${esc(p.telefono)}</td></tr>`).join('')}</tbody></table>
    ${E.punto?`<h2>Punto de encuentro</h2><p>${esc(E.punto)}</p>`:''}${E.instrucciones?`<h2>Instrucciones</h2><div class="pie">${esc(E.instrucciones)}</div>`:''}
    <h2>Responsables</h2>${rs.length?`<table><thead><tr><th>Zona</th><th>Función</th><th>Nombre</th><th>Teléfono</th></tr></thead><tbody>${rs.map(x=>`<tr><td>${esc(x.zona||'Todo el edificio')}</td><td>${esc(x.funcion)}</td><td>${esc(x.nombre)}${x.depto?' · '+esc(x.depto):''}</td><td>${esc(x.telefono||'')}</td></tr>`).join('')}</tbody></table>`:'<p>Sin responsables definidos.</p>'}
    <p class="small">Las unidades con personas que necesitan ayuda para evacuar se consultan en la app (Emergencias), con registro de la consulta.</p>`); }

// ---------- Proveedores, contratos y certificaciones ----------
const TIPO_CONTRATO={contrato:'Contrato', certificacion:'Certificación', mantencion:'Mantención', garantia:'Garantía', permiso:'Permiso', otro:'Otro'};
const PERIODO_C={mensual:'mensual', anual:'anual', unico:'pago único'};
const TITULOS_C=['Certificación de ascensores','Mantención de ascensores','Inspección de instalaciones de gas','Mantención y recarga de extintores','Mantención de bombas de agua','Limpieza de estanques de agua','Revisión de red húmeda y red seca','Mantención de grupo electrógeno','Mantención de calderas','Mantención de portones automáticos','Control de plagas','Aseo','Seguridad y conserjería externa','Jardinería'];
const pillContrato=c=>c.terminado?'<span class="pill mu">Terminado</span>':!c.hasta?'<span class="pill ok">Sin vencimiento</span>':pillVence(c.hasta);
VIEWS.proveedores = function(param){
  const adm=isAdmin(); const TABS={vencimientos:'Vencimientos', proveedores:'Proveedores'}; let tab=TABS[param]?param:'vencimientos', pv=[], cs=[];
  setMain(`<h1>Proveedores</h1><div class="tabs" id="pvTabs">${Object.entries(TABS).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="pvBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['proveedores','contratos'], async()=>{ const [a,b]=await Promise.all([q(T('proveedores').select('*').order('nombre')), q(T('contratos').select('*').order('hasta',{ascending:true}))]); return {a,b}; }, ({a,b})=>{ pv=a; cs=b; if(!$('.modal')) draw(); });
  const listo=()=>w.reload(), nom=id=>pv.find(p=>p.id===id)?.nombre||'';
  const fila=c=>`<div class="item" data-ct="${c.id}"><div class="hd"><b>${esc(c.titulo)}</b>${pillContrato(c)}</div><div class="meta">${esc(TIPO_CONTRATO[c.tipo])}${c.proveedor_id?' · '+esc(nom(c.proveedor_id)):''}${c.hasta?' · vence '+fmtDay(c.hasta):''}${Number(c.monto)?' · '+clp(c.monto)+' '+PERIODO_C[c.periodicidad]:''}</div></div>`;
  const draw=()=>{ const el=$('#pvBody'); if(!el) return;
    if(tab==='vencimientos'){ const vig=cs.filter(c=>!c.terminado), ven=vig.filter(c=>c.hasta&&c.hasta<todayStr()), pronto=vig.filter(c=>c.hasta&&c.hasta>=todayStr()&&diasA(c.hasta)<=Math.max(c.aviso_dias,7));
      const mensual=vig.reduce((a,c)=>a+(c.periodicidad==='mensual'?Number(c.monto)||0:c.periodicidad==='anual'?(Number(c.monto)||0)/12:0),0);
      el.innerHTML=`<div class="kpi"><div class="k"><b>${vig.length}</b><span>Vigentes</span></div><div class="k"><b style="color:${ven.length?'var(--er)':'inherit'}">${ven.length}</b><span>Vencidos</span></div><div class="k"><b>${pronto.length}</b><span>Por vencer</span></div><div class="k"><b>${clp(mensual)}</b><span>Costo mensual comprometido</span></div></div>
        ${adm?'<div class="row" style="margin:12px 0"><button class="btn" id="bCt">Nuevo contrato o certificación</button></div>':''}
        <p class="small muted">Contratos de servicio, certificaciones (ascensores, gas…), mantenciones periódicas, garantías y permisos, ordenados por vencimiento. La administración y el comité reciben un aviso antes de cada vencimiento.</p>
        <div class="list">${vig.sort((a,b)=>(a.hasta||'9999')<(b.hasta||'9999')?-1:1).map(fila).join('')||'<div class="empty">Sin contratos vigentes</div>'}</div>
        ${cs.some(c=>c.terminado)?`<details style="margin-top:12px"><summary>Terminados (${cs.filter(c=>c.terminado).length})</summary><div class="list">${cs.filter(c=>c.terminado).map(fila).join('')}</div></details>`:''}`; }
    else el.innerHTML=`${adm?'<div class="row" style="margin-bottom:12px"><button class="btn" id="bPv">Nuevo proveedor</button></div>':''}<div class="list">${pv.map(p=>{ const n=cs.filter(c=>c.proveedor_id===p.id&&!c.terminado).length; return `<div class="item" data-pv="${p.id}"><div class="hd"><b>${esc(p.nombre)}</b>${p.activo?'':'<span class="pill mu">Inactivo</span>'}</div><div class="meta">${esc(p.rubro||'')}${p.telefono?' · '+esc(p.telefono):''}${p.correo?' · '+esc(p.correo):''}${n?` · ${n} ${n===1?'contrato vigente':'contratos vigentes'}`:''}</div></div>`; }).join('')||'<div class="empty">Sin proveedores</div>'}</div>`; };
  const formPv=(p={})=>{ const m=modal(`<h3>${p.id?'Proveedor':'Nuevo proveedor'}</h3><form id="fPv"><div class="row"><label class="f grow"><span>Nombre o razón social</span><input type="text" name="nombre" value="${esc(p.nombre||'')}" required ${adm?'':'disabled'}></label><label class="f"><span>RUT</span><input type="text" name="rut" value="${esc(p.rut||'')}" style="width:140px" ${adm?'':'disabled'}></label></div>
      <div class="row"><label class="f grow"><span>Rubro</span><input type="text" name="rubro" value="${esc(p.rubro||'')}" placeholder="Ascensores, gas, aseo…" ${adm?'':'disabled'}></label><label class="f grow"><span>Contacto</span><input type="text" name="contacto" value="${esc(p.contacto||'')}" ${adm?'':'disabled'}></label></div>
      <div class="row"><label class="f grow"><span>Teléfono (lo ve también la conserjería)</span><input type="tel" name="telefono" value="${esc(p.telefono||'')}" ${adm?'':'disabled'}></label><label class="f grow"><span>Correo</span><input type="email" name="correo" value="${esc(p.correo||'')}" ${adm?'':'disabled'}></label></div>
      <label class="f"><span>Notas</span><textarea name="notas" ${adm?'':'disabled'}>${esc(p.notas||'')}</textarea></label>${p.id&&adm?`<label class="sw" style="margin-bottom:10px"><input type="checkbox" name="activo" ${p.activo?'checked':''}> Activo</label>`:''}
      ${p.id?`<h3>Contratos</h3><div class="list">${cs.filter(c=>c.proveedor_id===p.id).map(fila).join('')||'<div class="empty">Sin contratos</div>'}</div>`:''}
      ${adm?`<div class="row wrap" style="margin-top:10px">${p.id?'<button type="button" class="btn sec" id="pvCt">Agregar contrato</button>':''}<button class="btn grow">Guardar</button></div>`:''}</form>`);
    $('#pvCt',m)?.addEventListener('click',()=>formCt({proveedor_id:p.id}));
    m.addEventListener('click',e=>{ const it=e.target.closest('[data-ct]'); if(it) formCt(cs.find(c=>c.id===it.dataset.ct)); });
    $('#fPv',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const o={nombre:d.nombre.trim(), rut:d.rut.trim(), rubro:d.rubro.trim(), contacto:d.contacto.trim(), telefono:d.telefono.trim(), correo:d.correo.trim(), notas:d.notas.trim()}; if(p.id) o.activo=!!d.activo;
      try{ await q(p.id?T('proveedores').update(o).eq('id',p.id):T('proveedores').insert(o)); closeModal(); toast('Proveedor guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  const formCt=(c={})=>{ const dis=adm?'':'disabled';
    const m=modal(`<h3>${c.id?esc(c.titulo):'Nuevo contrato o certificación'}</h3>${c.id?`<div class="row wrap" style="gap:6px;margin-bottom:8px">${pillContrato(c)}${c.archivo?`<a class="btn sec sm" data-f="${esc(c.archivo)}" target="_blank" rel="noopener">Ver documento</a>`:''}</div>`:''}<form id="fCt">
      <div class="row"><label class="f grow"><span>Tipo</span><select name="tipo" ${dis}>${Object.entries(TIPO_CONTRATO).map(([k,v])=>`<option value="${k}" ${c.tipo===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="f grow"><span>Proveedor</span><select name="proveedor_id" ${dis}><option value="">(ninguno)</option>${pv.map(p=>`<option value="${p.id}" ${c.proveedor_id===p.id?'selected':''}>${esc(p.nombre)}</option>`).join('')}</select></label></div>
      <label class="f"><span>Título</span><input type="text" name="titulo" value="${esc(c.titulo||'')}" list="dlCt" required ${dis}><datalist id="dlCt">${TITULOS_C.map(x=>`<option value="${x}">`).join('')}</datalist></label>
      <div class="row"><label class="f grow"><span>Desde</span><input type="date" name="desde" value="${c.desde||''}" ${dis}></label><label class="f grow"><span>Vence</span><input type="date" name="hasta" value="${c.hasta||''}" ${dis}></label><label class="f"><span>Avisar (días antes)</span><input type="number" name="aviso" min="0" max="365" value="${c.aviso_dias??30}" style="width:110px" ${dis}></label></div>
      <div class="row"><label class="f grow"><span>Monto</span><input type="text" inputmode="numeric" data-clp name="monto" value="${c.monto!=null?Math.round(c.monto):''}" ${dis}></label><label class="f grow"><span>Periodicidad</span><select name="periodicidad" ${dis}>${Object.entries(PERIODO_C).map(([k,v])=>`<option value="${k}" ${c.periodicidad===k?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label></div>
      ${adm?`<label class="f"><span>Documento (contrato o certificado) ${c.archivo?'· ya cargado; elige otro para reemplazarlo':''}</span><input type="file" name="archivo" accept="application/pdf,image/*"></label>`:''}
      <label class="f"><span>Notas</span><textarea name="notas" ${dis}>${esc(c.notas||'')}</textarea></label>${c.id&&adm?`<label class="sw" style="margin-bottom:10px"><input type="checkbox" name="terminado" ${c.terminado?'checked':''}> Terminado (ya no se avisa)</label>`:''}
      ${adm?`<div class="row wrap">${c.id&&!c.terminado&&c.hasta?'<button type="button" class="btn sec" id="ctRen">Renovar</button>':''}<button class="btn grow">Guardar</button></div>`:''}</form>`);
    const guardar=async(d, extra={})=>{ const f=$('[name=archivo]',m)?.files[0]; const archivo=f?await uploadFile(f,'proveedores'):(extra.archivo??c.archivo??'');
      const o={tipo:d.tipo, proveedor_id:d.proveedor_id||null, titulo:d.titulo.trim(), desde:d.desde||null, hasta:d.hasta||null, aviso_dias:Number(d.aviso)||0, monto:d.monto?Number(d.monto):null, periodicidad:d.periodicidad, notas:d.notas.trim(), archivo, ...extra};
      if(c.id&&!extra.nuevo){ o.terminado=!!d.terminado; if(o.hasta!==c.hasta) o.avisos=[]; await q(T('contratos').update(o).eq('id',c.id)); } else { delete o.nuevo; await q(T('contratos').insert(o)); } };
    $('#fCt',m)?.addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button.grow',m); busy(b,true); try{ await guardar(formData(e.target)); closeModal(); toast('Guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
    $('#ctRen',m)?.addEventListener('click', async()=>{ const d=formData($('#fCt',m)); const ini=new Date(c.hasta+'T12:00:00'); ini.setDate(ini.getDate()+1); const fin=new Date(ini); fin.setFullYear(fin.getFullYear()+1); fin.setDate(fin.getDate()-1);
      if(!await confirmBox(`Se marcará este período como terminado y se creará uno nuevo del ${fmtDay(ini.toISOString().slice(0,10))} al ${fmtDay(fin.toISOString().slice(0,10))}. Sube el nuevo documento si lo tienes. ¿Renovar?`)) return;
      try{ await q(T('contratos').update({terminado:true}).eq('id',c.id)); await guardar({...d, desde:ini.toISOString().slice(0,10), hasta:fin.toISOString().slice(0,10)}, {nuevo:true, archivo:''}); closeModal(); toast('Renovado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); };
  $('#pvTabs').addEventListener('click',e=>{ const b=e.target.closest('[data-t]'); if(!b) return; tab=b.dataset.t; $$('#pvTabs button').forEach(x=>x.classList.toggle('on',x===b)); history.replaceState(null,'','#proveedores--'+tab); draw(); });
  $('#pvBody').addEventListener('click',e=>{ const t=x=>e.target.closest(x); let b;
    if(t('#bCt')) formCt({}); else if(t('#bPv')) formPv({}); else if(b=t('[data-ct]')) formCt(cs.find(c=>c.id===b.dataset.ct)); else if(b=t('[data-pv]')) formPv(pv.find(p=>p.id===b.dataset.pv)); });
};

VIEWS.seguros = function(param){
  const r=role(), adm=isAdmin(), prop=r==='propietario';
  if(prop) return segurosUnidad();
  const TABS={polizas:'Pólizas del edificio', unidades:'Unidades', ...(adm?{ajustes:'Ajustes'}:{})};
  let tab=TABS[param]?param:'polizas', pols=[], sins=[], docs=[], falt=[];
  setMain(`<h1>Seguros</h1><div class="tabs" id="sgTabs">${Object.entries(TABS).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="sgBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['polizas','siniestros','unidad_documentos','edificios'], async()=>{ const [a,b,c,d]=await Promise.all([q(T('polizas').select('*').order('desde',{ascending:false})), q(T('siniestros').select('*').order('fecha',{ascending:false})), q(T('unidad_documentos').select('*').order('ts',{ascending:false})), q(sb.rpc('polizas_faltantes')).catch(()=>[])]); return {a,b,c,d}; },
    ({a,b,c,d})=>{ pols=a; sins=b; docs=c; falt=d||[]; if(!$('.modal')) draw(); });
  const listo=()=>w.reload(), hoy=todayStr();
  const vigente=t=>pols.filter(p=>p.tipo===t&&p.desde<=hoy).sort((x,y)=>x.desde<y.desde?1:-1)[0];
  const draw=()=>{ const el=$('#sgBody'); if(!el) return;
    if(tab==='polizas'){ const tipos=[...new Set([...(S.cfg?.seguros_obligatorios||['incendio']), ...pols.map(p=>p.tipo)])];
      el.innerHTML=`${falt.length?`<div class="err" style="margin-bottom:10px">Sin póliza vigente: <b>${falt.map(t=>esc(TIPO_POLIZA[t]||t)).join(', ')}</b>. ${falt.includes('incendio')?'El seguro colectivo contra incendio es obligatorio (Ley 21.442, art. 43). ':''}${adm?'Regístrala con "+ Póliza".':''}</div>`:''}
        ${adm?'<div style="margin-bottom:10px"><button class="btn" id="bPol">+ Póliza</button></div>':''}
        <div class="list">${tipos.map(t=>{ const p=vigente(t), ant=pols.filter(x=>x.tipo===t&&x!==p), ns=p?sins.filter(x=>x.poliza_id===p.id):[];
          return p?`<div class="item" data-pol="${p.id}"><div class="hd"><b>${esc(TIPO_POLIZA[t]||t)}</b>${pillVence(p.hasta)}</div><div class="meta">${esc(p.aseguradora)} · nº ${esc(p.numero)}${p.corredor?' · corredor '+esc(p.corredor):''} · ${fmtDay(p.desde)} al ${fmtDay(p.hasta)}${p.monto_asegurado?' · asegurado '+numCL(p.monto_asegurado,2)+' '+p.moneda:''}${p.prima?' · prima '+numCL(p.prima,2)+' '+p.prima_moneda:''}${t==='incendio'?(p.cubre_unidades?' · cubre también las unidades':' · solo bienes comunes: cada unidad acredita su póliza'):''}${ns.length?' · '+ns.length+(ns.length===1?' siniestro':' siniestros'):''}${ant.length?' · '+ant.length+' anterior(es)':''}</div></div>`
            :`<div class="item static"><div class="hd"><b>${esc(TIPO_POLIZA[t]||t)}</b><span class="pill er">Sin póliza vigente</span></div></div>`; }).join('')}</div>
        <p class="small muted">Se avisa a la administración y al comité a los 60, 30 y 15 días del vencimiento y cada día de la última semana.</p>`; }
    else if(tab==='unidades'){ const inc=vigente('incendio'), us=Object.keys(S.unidades).sort(porNum), ultimo=(d,t)=>docs.filter(x=>x.depto===d&&x.tipo===t).sort((a,b)=>a.ts<b.ts?1:-1)[0];
      const okInc=us.filter(d=>{ const x=docs.find(y=>y.depto===d&&y.tipo==='poliza_incendio'&&y.estado==='aceptado'&&(!y.vence||y.vence>=hoy)); return !!x; }).length, rev=docs.filter(x=>x.estado==='en_revision');
      el.innerHTML=`${inc?.cubre_unidades?'<div class="info" style="margin-bottom:10px">La póliza colectiva de incendio cubre también las unidades: acreditar una póliza propia es opcional.</div>':''}
        <div class="kpi"><div class="k"><b>${us.length?Math.round(okInc/us.length*100):0}%</b><span>Unidades con póliza de incendio vigente acreditada (${okInc} de ${us.length})</span></div><div class="k"><b>${rev.length}</b><span>Documentos por revisar</span></div></div>
        ${rev.length?`<h2>Por revisar</h2><div class="list">${rev.map(x=>`<div class="item static"><div class="hd"><b>Depto ${esc(x.depto)} · ${esc(TIPO_DOC[x.tipo])}</b><a class="btn sec sm" data-f="${esc(x.archivo)}" target="_blank" rel="noopener">Ver archivo</a></div><div class="meta">${fmtDate(x.ts)} · ${esc(userName(x.subido_por))}${x.vence?' · vence '+fmtDay(x.vence):''}${x.descripcion?' · '+esc(x.descripcion):''}</div>${adm?`<div class="row acc"><button class="btn ok sm" data-acep="${x.id}">Aceptar</button><button class="btn sec sm" data-rech="${x.id}">Rechazar</button></div>`:''}</div>`).join('')}</div>`:''}
        <h2>Por unidad</h2><div class="card" style="overflow:auto"><table><thead><tr><th>Unidad</th><th>Propietario</th><th>Póliza de incendio</th><th>Certificado de dominio</th></tr></thead><tbody>${us.map(d=>{ const p=ultimo(d,'poliza_incendio'), c=ultimo(d,'certificado_dominio'), cel=x=>x?`${pillOf(EST_DOC,x.estado)}${x.vence&&x.estado==='aceptado'?' '+pillVence(x.vence):''} <a href="#" data-f="${esc(x.archivo)}" target="_blank" rel="noopener" class="small">ver</a>`:'<span class="muted small">—</span>';
          return `<tr><td><b>${esc(d)}</b></td><td class="small">${esc(S.unidades[d]?.prop||'')}</td><td>${cel(p)}</td><td>${cel(c)}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="small muted">Los propietarios suben sus documentos desde Seguros en su cuenta. Se les avisa 30 días antes de que venza su póliza.</p>`; }
    else { const ob=S.cfg?.seguros_obligatorios||['incendio'];
      el.innerHTML=`<div class="card"><h3>Pólizas que el edificio debe mantener vigentes</h3><form id="fOb">${Object.entries(TIPO_POLIZA).map(([k,v])=>`<label class="sw"><input type="checkbox" name="${k}" ${ob.includes(k)?'checked':''} ${k==='incendio'?'disabled':''}> ${esc(v)}</label>`).join('')}<button class="btn sec sm" style="margin-top:10px">Guardar</button></form><p class="small muted">Si falta una póliza vigente de estos tipos, aparece una alerta roja en el inicio de administración y comité. La de incendio es obligatoria por ley.</p></div>`; }
    firmarPendientes?.(); };
  const formPoliza=(p={})=>{ const m=modal(`<h3>${p.id?'Editar':'Nueva'} póliza</h3><form id="fPo"><label class="f"><span>Tipo</span><select name="tipo" ${p.id?'disabled':''}>${Object.entries(TIPO_POLIZA).map(([k,v])=>`<option value="${k}" ${p.tipo===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label>
      <div class="row"><label class="f grow"><span>Aseguradora</span><input type="text" name="aseguradora" value="${esc(p.aseguradora||'')}" required></label><label class="f grow"><span>Número de póliza</span><input type="text" name="numero" value="${esc(p.numero||'')}" required></label></div>
      <div class="row"><label class="f grow"><span>Corredor</span><input type="text" name="corredor" value="${esc(p.corredor||'')}"></label><label class="f grow"><span>Deducible</span><input type="text" name="deducible" value="${esc(p.deducible||'')}"></label></div>
      <label class="f"><span>Coberturas</span><input type="text" name="cobertura" value="${esc(p.cobertura||'')}" placeholder="Incendio, sismo, daños por agua…"></label>
      <div class="row"><label class="f grow"><span>Monto asegurado</span><input type="text" inputmode="decimal" data-dec name="monto_asegurado" value="${p.monto_asegurado!=null?aDec(p.monto_asegurado):''}"></label><label class="f"><span>&nbsp;</span><select name="moneda">${['UF','CLP'].map(x=>`<option ${p.moneda===x?'selected':''}>${x}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f grow"><span>Prima</span><input type="text" inputmode="decimal" data-dec name="prima" value="${p.prima!=null?aDec(p.prima):''}"></label><label class="f"><span>&nbsp;</span><select name="prima_moneda">${['UF','CLP'].map(x=>`<option ${p.prima_moneda===x?'selected':''}>${x}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f grow"><span>Vigente desde</span><input type="date" name="desde" value="${esc(p.desde||'')}" required></label><label class="f grow"><span>Hasta</span><input type="date" name="hasta" value="${esc(p.hasta||'')}" required></label></div>
      <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="cubre_unidades" ${p.cubre_unidades?'checked':''}> La póliza de incendio cubre también las unidades (si no, cada unidad acredita la suya)</label>
      <label class="f"><span>PDF de la póliza ${p.archivo?'(ya cargado; elige otro para reemplazarlo)':''}</span><input type="file" name="archivo" accept="application/pdf,image/*"></label><button class="btn full">Guardar</button></form>`);
    $('#fPo',m).addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button.full',e.target); busy(b,true); const d=formData(e.target);
      try{ const f=$('[name=archivo]',m).files[0]; const archivo=f?await uploadFile(f,'seguros'):(p.archivo||'');
        const o={aseguradora:d.aseguradora.trim(), numero:d.numero.trim(), corredor:d.corredor.trim(), deducible:d.deducible.trim(), cobertura:d.cobertura.trim(), monto_asegurado:d.monto_asegurado?Number(d.monto_asegurado):null, moneda:d.moneda, prima:d.prima?Number(d.prima):null, prima_moneda:d.prima_moneda, desde:d.desde, hasta:d.hasta, cubre_unidades:!!d.cubre_unidades, archivo};
        await q(p.id?T('polizas').update(o).eq('id',p.id):T('polizas').insert({...o, tipo:d.tipo})); closeModal(); toast('Póliza guardada'); listo(); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); };
  const detallePoliza=p=>{ const ns=sins.filter(x=>x.poliza_id===p.id), ant=pols.filter(x=>x.tipo===p.tipo&&x.id!==p.id);
    const m=modal(`<h3>${esc(TIPO_POLIZA[p.tipo])}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillVence(p.hasta)}${p.archivo?`<a class="btn sec sm" data-f="${esc(p.archivo)}" target="_blank" rel="noopener">Ver PDF</a>`:''}</div>
      <p class="small">${esc(p.aseguradora)} · nº ${esc(p.numero)} · ${fmtDay(p.desde)} al ${fmtDay(p.hasta)}${p.cobertura?'<br>Coberturas: '+esc(p.cobertura):''}${p.deducible?'<br>Deducible: '+esc(p.deducible):''}</p>
      <h2>Siniestros</h2><div class="list">${ns.map(x=>`<div class="item static"><div class="hd"><b>${fmtDay(x.fecha)} · ${esc(x.descripcion)}</b>${pillOf(EST_SIN,x.estado)}</div><div class="meta">${x.monto_reclamado?'reclamado '+clp(x.monto_reclamado):''}${x.monto_pagado?' · pagado '+clp(x.monto_pagado):''}</div>${adm?`<div class="row acc"><select data-est-sin="${x.id}" style="width:auto">${Object.entries(EST_SIN).map(([k,v])=>`<option value="${k}" ${x.estado===k?'selected':''}>${v[0]}</option>`).join('')}</select><button class="btn sec sm" data-pag-sin="${x.id}">Monto pagado</button></div>`:''}</div>`).join('')||'<div class="empty">Sin siniestros</div>'}</div>
      ${ant.length?`<h2>Pólizas anteriores</h2><div class="list">${ant.map(x=>`<div class="item static"><div class="meta">${esc(x.aseguradora)} · nº ${esc(x.numero)} · ${fmtDay(x.desde)} al ${fmtDay(x.hasta)}${x.archivo?` · <a href="#" data-f="${esc(x.archivo)}" target="_blank" rel="noopener">PDF</a>`:''}</div></div>`).join('')}</div>`:''}
      <div class="row wrap" style="justify-content:flex-end;gap:6px;margin-top:12px">${adm?'<button class="btn sec" id="pdSin">Registrar siniestro</button><button class="btn sec" id="pdEd">Editar</button><button class="btn" id="pdRen">Registrar renovación</button>':''}<button class="btn sec" data-close>Cerrar</button></div>`);
    firmarPendientes?.();
    $('#pdEd',m)?.addEventListener('click',()=>formPoliza(p));
    $('#pdRen',m)?.addEventListener('click',()=>formPoliza({tipo:p.tipo, aseguradora:p.aseguradora, corredor:p.corredor, cobertura:p.cobertura, moneda:p.moneda, prima_moneda:p.prima_moneda, cubre_unidades:p.cubre_unidades, desde:p.hasta}));
    $('#pdSin',m)?.addEventListener('click',()=>{ const m2=modal(`<h3>Registrar siniestro</h3><form id="fSi"><label class="f"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}" required></label><label class="f"><span>Qué pasó</span><textarea name="descripcion" required></textarea></label><label class="f"><span>Monto reclamado (opcional)</span><input type="text" inputmode="numeric" data-clp name="monto"></label><button class="btn full">Guardar</button></form>`);
      $('#fSi',m2).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('siniestros').insert({poliza_id:p.id, fecha:d.fecha, descripcion:d.descripcion.trim(), monto_reclamado:d.monto?Number(d.monto):null})); closeModal(); toast('Siniestro registrado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); });
    m.addEventListener('change', async e=>{ const x=e.target.closest('[data-est-sin]'); if(!x) return; try{ await q(T('siniestros').update({estado:x.value}).eq('id',x.dataset.estSin)); toast('Siniestro actualizado'); listo(); }catch(err){ toast(errMsg(err)); } });
    m.addEventListener('click', async e=>{ const x=e.target.closest('[data-pag-sin]'); if(!x) return; const v=await askText('Monto pagado por la aseguradora'); if(v===null) return; try{ await q(T('siniestros').update({monto_pagado:leerMonto(v)}).eq('id',x.dataset.pagSin)); toast('Monto guardado'); listo(); }catch(err){ toast(errMsg(err)); } }); };
  $('#sgTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#sgTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  $('#sgBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(t('#bPol')) formPoliza();
    else if(b=t('[data-pol]')) detallePoliza(pols.find(x=>x.id===b.dataset.pol));
    else if(b=t('[data-acep]')){ try{ await q(T('unidad_documentos').update({estado:'aceptado'}).eq('id',b.dataset.acep)); toast('Documento aceptado'); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-rech]')){ const mo=await askText('Motivo del rechazo (lo recibe el propietario)'); if(!mo) return; try{ await q(T('unidad_documentos').update({estado:'rechazado', motivo:mo.trim()}).eq('id',b.dataset.rech)); toast('Documento rechazado'); listo(); }catch(err){ toast(errMsg(err)); } } });
  $('#sgBody').addEventListener('submit', async e=>{ e.preventDefault(); if(e.target.id!=='fOb') return; const d=formData(e.target); const arr=['incendio', ...Object.keys(TIPO_POLIZA).filter(k=>k!=='incendio'&&d[k])];
    try{ await q(T('edificios').update({seguros_obligatorios:arr}).eq('id',S.cfg.id)); S.cfg.seguros_obligatorios=arr; toast('Guardado'); listo(); }catch(err){ toast(errMsg(err)); } });
};
function segurosUnidad(){
  const dep=myDepto();
  setMain(`<h1>Seguros</h1><div class="card"><h3>Documentos de tu unidad (Depto ${esc(dep)})</h3><p class="small muted">Sube la póliza de incendio y sismo de tu unidad, el certificado de dominio u otros que pida la administración. La administración los revisa y te avisaremos 30 días antes de que venza tu póliza.</p>
    <form id="fUd"><div class="row"><label class="f grow"><span>Documento</span><select name="tipo">${Object.entries(TIPO_DOC).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label class="f grow"><span>Vigente hasta</span><input type="date" name="vence"></label></div>
    <label class="f"><span>Detalle (opcional)</span><input type="text" name="descripcion" placeholder="Aseguradora y número de póliza"></label><label class="f"><span>Archivo (PDF o foto)</span><input type="file" name="archivo" accept="application/pdf,image/*" required></label><button class="btn">Subir documento</button></form></div>
    <div id="udList" class="list"></div>`);
  watch('unidad_documentos', ()=>q(T('unidad_documentos').select('*').order('ts',{ascending:false})), rows=>{ const el=$('#udList'); if(!el) return;
    el.innerHTML=rows.map(x=>`<div class="item static"><div class="hd"><b>${esc(TIPO_DOC[x.tipo])}</b><span class="row" style="gap:4px">${pillOf(EST_DOC,x.estado)}${x.vence&&x.estado==='aceptado'?pillVence(x.vence):''}</span></div><div class="meta">Subido ${fmtDate(x.ts)}${x.vence?' · vence '+fmtDay(x.vence):''}${x.descripcion?' · '+esc(x.descripcion):''}${x.motivo?' · <b>'+esc(x.motivo)+'</b>':''} · <a href="#" data-f="${esc(x.archivo)}" target="_blank" rel="noopener">ver</a></div></div>`).join('')||'<div class="empty">Aún no has subido documentos</div>'; firmarPendientes?.(); });
  $('#fUd').addEventListener('submit', async e=>{ e.preventDefault(); const b=$('button',e.target); busy(b,true); const d=formData(e.target);
    try{ const archivo=await uploadFile($('[name=archivo]',e.target).files[0],'seguros'); await q(T('unidad_documentos').insert({depto:dep, tipo:d.tipo, vence:d.vence||null, descripcion:d.descripcion.trim(), archivo})); e.target.reset(); toast('Documento enviado: la administración lo revisará'); }catch(err){ toast('Error: '+errMsg(err)); } busy(b,false); });
}

// SUSPENSIÓN DE LUZ por morosidad (adaptado del módulo E3 de CactusOne). La app detecta y prepara, nunca corta
// sola; la base de datos exige cada resguardo: 3+ cuotas de gasto común (sin multas ni intereses), nunca a
// unidades con electrodependientes, aprobación del comité, aviso previo de 5 días corridos y reposición al día
// hábil siguiente del pago o convenio. Solo electricidad: el agua nunca se corta.
const EST_SUSP={en_comite:['En el comité','wa'], aprobada:['Aprobada','in'], rechazada:['Rechazada por el comité','mu'], avisada:['Aviso previo enviado','wa'], solicitada:['Suspensión solicitada','er'], suspendida:['Suspendida','er'], por_reponer:['Por reponer','er'], repuesta:['Repuesta','ok'], cancelada:['Cancelada','mu']};
async function imprimirSuspension(tipo, sp){ const cab=await cabeceraImpresion(), c=S.cfg||{}, f=d=>d?fmtDay(String(d).slice(0,10)):'—';
  const firma=`<p style="margin-top:40px">______________________________<br>Administración · ${esc(c.nombre||'')}</p>`;
  if(tipo==='aviso') imprimir('aviso-suspension-'+sp.depto, `${cab}<h1>Aviso previo de suspensión del suministro eléctrico</h1><p class="sub">${f(sp.avisada_at)} · Unidad ${esc(sp.depto)} · A: propietario(s) y ocupantes</p>
    <p>La unidad registra <b>${sp.cuotas} cuotas de gasto común impagas</b>, por un total de <b>${clp(sp.deuda)}</b>. Con el acuerdo del comité de administración, y conforme al artículo 20 nº 9 de la Ley 21.442, se informa que a partir del <b>${f(sp.fecha_prevista)}</b> se podrá suspender o solicitar la suspensión del suministro eléctrico de la unidad.</p>
    <p>Para evitarlo, regularice antes de esa fecha pagando la deuda o firmando un convenio de pago con la administración. Si la suspensión se produce, el servicio se repondrá a más tardar el día hábil siguiente al pago o convenio.</p>
    <p>Si en la unidad vive una persona electrodependiente o que usa oxígeno medicinal, infórmelo de inmediato a la administración: en ese caso la ley prohíbe la suspensión. El suministro de agua no se suspende.</p>${c.datos_bancarios?`<h2>Datos para transferir</h2><div class="pie">${esc(c.datos_bancarios)}</div>`:''}${firma}<p class="sub" style="margin-top:30px">Recibí copia: ____________________ Fecha: __________</p>`);
  else if(tipo==='carta') imprimir('solicitud-suspension-'+sp.depto, `${cab}<h1>Solicitud de suspensión del suministro eléctrico</h1><p class="sub">${f(new Date().toISOString())}</p>
    <p>Señores empresa distribuidora de electricidad:</p><p>En representación de la comunidad ${esc(c.nombre||'')}${c.direccion?', '+esc(c.direccion):''}${c.comuna?', '+esc(c.comuna):''}, y conforme al artículo 20 nº 9 de la Ley 21.442 de Copropiedad Inmobiliaria, solicitamos suspender el suministro eléctrico de la unidad <b>${esc(sp.depto)}</b>, que registra ${sp.cuotas} cuotas de gasto común impagas (${clp(sp.deuda)}).</p>
    <p>La medida cuenta con el acuerdo del comité de administración y la unidad fue avisada el ${f(sp.avisada_at)}, con fecha prevista el ${f(sp.fecha_prevista)}. Según los registros de la administración, en la unidad no vive una persona electrodependiente. Una vez regularizada la deuda, solicitaremos la reposición del servicio.</p>${firma}`);
  else imprimir('reposicion-'+sp.depto, `${cab}<h1>Orden de reposición del suministro eléctrico</h1><p class="sub">${f(new Date().toISOString())} · Unidad ${esc(sp.depto)}</p>
    <p>La unidad <b>${esc(sp.depto)}</b> regularizó su deuda (${esc(sp.regularizacion||'')}). Corresponde reponer el suministro eléctrico <b>a más tardar el ${f(sp.reponer_antes)}</b> (artículo 36).</p>${firma}`); }
async function panelSuspension(el, listo, sigue=()=>true){
  const adm=isAdmin(), cfg=S.cfg?.suspension||{}, umbral=Number(cfg.umbral??3), dias=Number(cfg.dias_aviso??5), hoy=todayStr();
  let mor=[], sps=[], vs=[];
  try{ [mor,sps,vs]=await Promise.all([q(sb.rpc('unidades_morosas')), q(T('suspensiones').select('*').order('ts',{ascending:false})), q(T('suspension_votos').select('*'))]); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; }
  if(!el.isConnected||!sigue()) return;
  const accion=x=>x.estado==='por_reponer'?`reponer antes del ${fmtDay(x.reponer_antes)}${x.reponer_antes<hoy?' (atrasado)':''}`:x.estado==='avisada'?(x.fecha_prevista<=hoy?'ya se puede solicitar':'desde el '+fmtDay(x.fecha_prevista)):x.estado==='en_comite'?`${vs.filter(v=>v.suspension_id===x.id&&v.ronda===x.ronda&&v.aprueba).length} de ${Number(cfg.aprobaciones_comite??1)} aprobaciones`:x.motivo_cierre||'';
  el.innerHTML=`<div class="info" style="margin-bottom:10px">La app prepara cada paso pero nunca corta sola. Solo procede con <b>${umbral} o más cuotas de gasto común impagas</b> (multas, intereses y períodos en convenio no cuentan), <b>nunca</b> en unidades con una persona electrodependiente o con oxígeno medicinal, con <b>aprobación del comité</b>, <b>aviso previo de ${dias} días corridos</b>, y con reposición a más tardar el <b>día hábil siguiente</b> al pago o convenio. Solo electricidad: el agua nunca se corta.</div>
    <h2>Unidades con cuotas impagas</h2><div class="card" style="overflow:auto"><table><thead><tr><th>Unidad</th><th>Propietario</th><th class="num">Cuotas</th><th class="num">Deuda de gasto común</th><th>Situación</th><th></th></tr></thead><tbody>${mor.map(u=>`<tr><td><b>${esc(u.depto)}</b></td><td class="small">${esc(S.unidades[u.depto]?.prop||'')}</td><td class="num" style="color:${u.cuotas>=umbral?'var(--er)':'inherit'}">${u.cuotas}</td><td class="num">${clp(u.deuda)}</td>
      <td>${u.protegida?'<span class="pill in">Protegida: no se puede suspender</span>':u.proceso?pillOf(EST_SUSP,u.estado):u.cuotas>=umbral?'<span class="pill wa">Procede</span>':'<span class="muted small">No alcanza el umbral</span>'}</td>
      <td>${adm&&!u.protegida&&!u.proceso&&u.cuotas>=umbral?`<button class="btn sec sm" data-prop="${esc(u.depto)}">Proponer suspensión</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">Ninguna unidad tiene cuotas impagas</td></tr>'}</tbody></table></div>
    <h2>Procesos</h2><div class="list">${sps.map(x=>`<div class="item" data-susp="${x.id}"><div class="hd"><b>Nº ${x.folio} · Depto ${esc(x.depto)} · ${x.cuotas} cuotas · ${clp(x.deuda)}</b>${pillOf(EST_SUSP,x.estado)}</div><div class="meta">${fmtDate(x.ts)}${accion(x)?' · '+esc(accion(x)):''}</div></div>`).join('')||'<div class="empty">Sin procesos</div>'}</div>
    ${adm?`<div class="card" style="margin-top:12px"><h3>Ajustes</h3><form id="fSus"><div class="row wrap"><label class="f grow"><span>Cuotas impagas para proceder (mínimo 3)</span><input type="text" inputmode="numeric" name="umbral" value="${umbral}"></label><label class="f grow"><span>Aprobaciones del comité</span><input type="text" inputmode="numeric" name="aprobaciones_comite" value="${Number(cfg.aprobaciones_comite??1)}"></label><label class="f grow"><span>Días corridos de aviso previo (mínimo 5)</span><input type="text" inputmode="numeric" name="dias_aviso" value="${dias}"></label></div>
      <label class="f"><span>Períodos que no cuentan (estado de catástrofe), uno por línea como AAAA-MM</span><textarea name="excl" style="min-height:60px">${esc((cfg.periodos_excluidos||[]).join('\n'))}</textarea></label><button class="btn sec sm">Guardar</button></form></div>`:''}`;
  el.onclick=async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-prop]')){ if(!await confirmBox(`¿Proponer la suspensión de luz del depto ${b.dataset.prop}? ${Number(cfg.aprobaciones_comite??1)>0?'Pasará al comité para su aprobación.':''}`)) return; try{ await q(sb.rpc('proponer_suspension',{p_depto:b.dataset.prop})); toast('Suspensión propuesta'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }
    else if(b=t('[data-susp]')) detalleSuspension(sps.find(x=>x.id===b.dataset.susp), vs, listo); };
  el.onsubmit=async e=>{ if(e.target.id!=='fSus') return; e.preventDefault(); const d=formData(e.target); const o={umbral:Math.max(3,parseInt(d.umbral)||3), aprobaciones_comite:Math.max(0,parseInt(d.aprobaciones_comite)||0), dias_aviso:Math.max(5,parseInt(d.dias_aviso)||5), periodos_excluidos:[...new Set(d.excl.split(/\s+/).filter(x=>/^\d{4}-\d{2}$/.test(x)))]};
    try{ await q(T('edificios').update({suspension:o}).eq('id',S.cfg.id)); S.cfg.suspension=o; toast('Ajustes guardados'); listo(); }catch(err){ toast(errMsg(err)); } };
}
async function detalleSuspension(sp, vs, listo){
  const adm=isAdmin(), hoy=todayStr(), dias=Number(S.cfg?.suspension?.dias_aviso??5); let ev=[]; try{ ev=await q(T('suspension_eventos').select('*').eq('suspension_id',sp.id).order('ts')); }catch(e){}
  const yaVote=vs.some(v=>v.suspension_id===sp.id&&v.ronda===sp.ronda&&v.uid===S.uid), acc=[];
  if(sp.estado==='en_comite'&&role()==='comite'&&!yaVote) acc.push('<button class="btn ok" data-a="si">Aprobar</button>','<button class="btn dan" data-a="no">Rechazar</button>');
  if(adm&&sp.estado==='aprobada') acc.push('<button class="btn" data-a="avisar">Enviar aviso previo</button>');
  if(sp.avisada_at) acc.push('<button class="btn sec" data-a="pAviso">Aviso previo (PDF)</button>');
  if(adm&&sp.estado==='avisada') acc.push(sp.fecha_prevista<=hoy?'<button class="btn dan" data-a="solicitar">Solicitar la suspensión</button>':`<span class="small muted">Se podrá solicitar desde el ${fmtDay(sp.fecha_prevista)}.</span>`);
  if(adm&&sp.estado==='solicitada') acc.push('<button class="btn sec" data-a="pCarta">Carta a la empresa eléctrica (PDF)</button>','<button class="btn dan" data-a="confirmar">Confirmar que se suspendió</button>');
  if(adm&&['en_comite','aprobada','avisada','solicitada','suspendida'].includes(sp.estado)) acc.push('<button class="btn ok" data-a="pago">Regularizó: pago</button>','<button class="btn ok" data-a="convenio">Regularizó: convenio</button>');
  if(adm&&sp.estado==='por_reponer') acc.push('<button class="btn sec" data-a="pRepo">Orden de reposición (PDF)</button>','<button class="btn ok" data-a="repuesto">Confirmar reposición</button>');
  if(adm&&['en_comite','aprobada','avisada','solicitada'].includes(sp.estado)) acc.push('<button class="btn sec" data-a="cancelar">Cancelar</button>');
  const m=modal(`<h3>Suspensión nº ${sp.folio} · Depto ${esc(sp.depto)}</h3><div class="row wrap" style="gap:6px;margin-bottom:8px">${pillOf(EST_SUSP,sp.estado)}<span class="small muted">${sp.cuotas} cuotas impagas · ${clp(sp.deuda)}${sp.fecha_prevista?' · fecha prevista '+fmtDay(sp.fecha_prevista):''}${sp.reponer_antes?' · reponer antes del '+fmtDay(sp.reponer_antes):''}</span></div>
    <h2>Historial</h2><div class="timeline">${ev.map(x=>`<div><b>${esc(x.tipo.charAt(0).toUpperCase()+x.tipo.slice(1))}</b> <span class="muted">· ${esc(x.uid?userName(x.uid):'Sistema')} · ${fmtDate(x.ts)}</span>${x.texto?'<br>'+esc(x.texto):''}</div>`).join('')}</div>
    <div class="row wrap" style="justify-content:flex-end;gap:6px;margin-top:12px">${acc.join('')}<button class="btn sec" data-close>Cerrar</button></div>`);
  m.addEventListener('click', async e=>{ const b=e.target.closest('[data-a]'); if(!b) return; const a=b.dataset.a;
    const rpc=async(fn,args,ok)=>{ try{ await q(sb.rpc(fn,args)); closeModal(); toast(ok); listo(); }catch(err){ toast('Error: '+errMsg(err)); } };
    if(a==='si') rpc('votar_suspension',{p_id:sp.id, p_aprueba:true},'Aprobaste la suspensión');
    else if(a==='no'){ const t=await askText('¿Por qué rechazas la suspensión?'); if(t) rpc('votar_suspension',{p_id:sp.id, p_aprueba:false, p_comentario:t},'Rechazaste la suspensión'); }
    else if(a==='avisar'){ const min=new Date(); min.setDate(min.getDate()+dias); const mn=min.toISOString().slice(0,10); const m2=modal(`<h3>Aviso previo · Depto ${esc(sp.depto)}</h3><form id="fAv"><label class="f"><span>Fecha prevista de la suspensión (al menos ${dias} días corridos desde hoy)</span><input type="date" name="f" min="${mn}" value="${mn}" required></label><p class="small muted">Se avisa a la unidad en la app. Imprime el aviso para entregarlo también por escrito.</p><button class="btn full">Enviar aviso</button></form>`);
      $('#fAv',m2).addEventListener('submit', async ev2=>{ ev2.preventDefault(); try{ await q(sb.rpc('avisar_suspension',{p_id:sp.id, p_fecha:$('[name=f]',m2).value})); closeModal(); toast('Aviso previo enviado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); }
    else if(a==='solicitar'){ if(await confirmBox('Se volverá a comprobar que la deuda sigue y que la unidad no está protegida. ¿Solicitar la suspensión?')) rpc('solicitar_suspension',{p_id:sp.id},'Suspensión solicitada: imprime la carta'); }
    else if(a==='confirmar') rpc('confirmar_suspension',{p_id:sp.id, p_fecha:todayStr()},'Suspensión registrada');
    else if(a==='pago'||a==='convenio') rpc('regularizar_suspension',{p_id:sp.id, p_tipo:a},sp.estado==='suspendida'?'Hay que reponer el suministro a más tardar el día hábil siguiente':'Proceso cerrado: regularizó');
    else if(a==='repuesto') rpc('confirmar_reposicion',{p_id:sp.id, p_fecha:todayStr()},'Reposición registrada');
    else if(a==='cancelar'){ const t=await askText('Motivo de la cancelación'); if(t) rpc('cancelar_suspension',{p_id:sp.id, p_motivo:t},'Proceso cancelado'); }
    else if(a==='pAviso') imprimirSuspension('aviso',sp); else if(a==='pCarta') imprimirSuspension('carta',sp); else if(a==='pRepo') imprimirSuspension('reposicion',sp); });
}

// REGISTRO DE COPROPIETARIOS, ARRENDATARIOS Y OCUPANTES (Ley 21.442 y Decreto 7; adaptado de CactusOne).
// La administración lo mantiene; los propietarios informan cambios (quedan pendientes) y lo confirman cada año.
const REL_REG={copropietario:'Copropietario', arrendatario:'Arrendatario', ocupante:'Ocupante'};
function formPersonaRegistro(depto, listo, adm){
  const m=modal(`<h3>${adm?'Agregar al registro':'Informar una persona'} · Depto ${esc(depto)}</h3><form id="fRp"><label class="f"><span>Relación con la unidad</span><select name="relacion">${Object.entries(REL_REG).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="f"><span>Nombre completo</span><input type="text" name="nombre" required></label>
    <div class="row"><label class="f grow"><span>RUT</span><input type="text" name="rut" placeholder="12.345.678-5"></label><label class="sw" data-k="menor" style="align-self:center"><input type="checkbox" name="menor"> Menor de edad (sin RUT)</label></div>
    <div class="row"><label class="f grow"><span>Correo (para citaciones y notificaciones)</span><input type="email" name="correo"></label><label class="f grow"><span>Domicilio</span><input type="text" name="domicilio"></label></div>
    <label class="sw"><input type="checkbox" name="permanente" checked> Ocupante permanente (30 días o más)</label>
    <label class="f" data-k="arr"><span>Arriendo vigente hasta</span><input type="date" name="arriendo_hasta"></label>
    <div data-k="pj"><label class="sw"><input type="checkbox" name="persona_juridica"> Es una persona jurídica (empresa)</label><label class="f"><span>Representante legal</span><input type="text" name="representante"></label></div>
    <p class="small muted">${adm?'Queda vigente de inmediato.':'La administración lo revisa antes de incorporarlo al registro.'} El RUT se valida y no se guarda copia de la cédula.</p><button class="btn full">${adm?'Agregar':'Informar'}</button></form>`);
  const vis=()=>{ const r=$('[name=relacion]',m).value; $('[data-k=arr]',m).style.display=r==='arrendatario'?'':'none'; $('[data-k=pj]',m).style.display=r==='copropietario'?'':'none'; $('[data-k=menor]',m).style.display=r==='ocupante'?'':'none'; };
  $('[name=relacion]',m).addEventListener('change',vis); vis();
  $('#fRp',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const o={depto, relacion:d.relacion, nombre:d.nombre.trim(), rut:d.menor?null:(d.rut.trim()||null), menor:d.relacion==='ocupante'&&!!d.menor, correo:d.correo.trim(), domicilio:d.domicilio.trim(), permanente:!!d.permanente, arriendo_hasta:d.relacion==='arrendatario'?(d.arriendo_hasta||null):null, persona_juridica:d.relacion==='copropietario'&&!!d.persona_juridica, representante:d.representante.trim()};
    try{ await q(T('registro_personas').insert(o)); closeModal(); toast(adm?'Agregado al registro':'Informado: la administración lo revisará'); listo?.(); }catch(err){ toast('Error: '+errMsg(err)); } }); }
const filaRegistro=(p,acc='')=>`<div class="item static"><div class="hd"><b>${esc(p.nombre)}${p.persona_juridica?' (representada por '+esc(p.representante)+')':''}</b><span class="row" style="gap:4px">${p.estado==='pendiente'?'<span class="pill wa">Por revisar</span>':p.estado==='rechazado'?'<span class="pill mu">Rechazado</span>':p.hasta?'<span class="pill mu">Terminado</span>':p.baja_solicitada?'<span class="pill wa">Baja informada</span>':''}<span class="pill in">${REL_REG[p.relacion]}</span></span></div>
  <div class="meta">${p.menor?'Menor de edad':p.rut?'RUT '+esc(p.rut):'Sin RUT'}${p.correo?' · '+esc(p.correo):''}${p.domicilio?' · '+esc(p.domicilio):''} · ${p.permanente?'permanente':'transitorio'}${p.arriendo_hasta?' · arriendo hasta '+fmtDay(p.arriendo_hasta):''} · desde ${fmtDay(p.desde)}${p.hasta?' hasta '+fmtDay(p.hasta):''}${p.motivo?' · '+esc(p.motivo):''}</div>${acc?`<div class="row acc">${acc}</div>`:''}</div>`;
VIEWS.registro = function(){
  const r=role(), adm=isAdmin(), staff=['comite','admin'].includes(r);
  if(!staff) return registroUnidad();
  let est=[], ps=[];
  setMain(`<h1>Registro de copropietarios</h1><p class="small muted">Registro de Copropietarios, Arrendatarios y demás Ocupantes que exige la Ley 21.442 (Decreto 7, arts. 5 a 7). Es reservado: lo ven la administración y el comité, y cada unidad lo suyo. El correo registrado es el domicilio para citaciones y notificaciones.</p>
    ${adm?'<div class="row wrap" style="margin-bottom:10px;gap:6px"><button class="btn" id="bReq">Requerir actualización anual</button><button class="btn sec" id="bRegX">Excel</button></div>':'<div style="margin-bottom:10px"><button class="btn sec" id="bRegX">Excel</button></div>'}<div id="rgBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['registro_personas','registro_confirmaciones','unidades'], async()=>{ const [a,b]=await Promise.all([q(sb.rpc('registro_estado')), q(T('registro_personas').select('*').order('ts'))]); return {a,b}; }, ({a,b})=>{ est=a; ps=b; if(!$('.modal')) draw(); });
  const listo=()=>w.reload();
  const draw=()=>{ const el=$('#rgBody'); if(!el) return; const conf=est.filter(x=>x.confirmado).length, falt=est.filter(x=>x.faltantes.length).length, pend=ps.filter(p=>p.estado==='pendiente'||(p.baja_solicitada&&!p.hasta));
    const vig=(d,rel)=>ps.filter(p=>p.depto===d&&p.relacion===rel&&p.estado==='vigente'&&!p.hasta);
    el.innerHTML=`<div class="kpi"><div class="k"><b>${conf} de ${est.length}</b><span>Unidades que confirmaron en ${new Date().getFullYear()}</span></div><div class="k"><b style="color:${falt?'var(--er)':'inherit'}">${falt}</b><span>Unidades con datos faltantes</span></div><div class="k"><b>${pend.length}</b><span>Cambios por revisar</span></div></div>
      ${S.cfg?.registro?.requerido?`<p class="small muted">Último requerimiento anual: ${fmtDay(S.cfg.registro.requerido)}.</p>`:''}
      ${pend.length?`<h2>Por revisar</h2><div class="list">${pend.map(p=>filaRegistro({...p, nombre:'Depto '+p.depto+' · '+p.nombre}, adm?(p.estado==='pendiente'?`<button class="btn ok sm" data-ap="${p.id}">Incorporar</button><button class="btn sec sm" data-re="${p.id}">Rechazar</button>`:`<button class="btn sm" data-baja="${p.id}">Aplicar la baja</button>`):'')).join('')}</div>`:''}
      <h2>Unidades</h2><div class="card" style="overflow:auto"><table><thead><tr><th>Unidad</th><th>Copropietarios</th><th>Arrendatarios y ocupantes</th><th>Confirmado</th><th>Revisar</th></tr></thead><tbody>${est.map(x=>`<tr data-ud="${esc(x.depto)}" style="cursor:pointer"><td><b>${esc(x.depto)}</b></td><td class="small">${vig(x.depto,'copropietario').map(p=>esc(p.nombre)).join(', ')||'—'}</td><td class="small">${vig(x.depto,'arrendatario').length+vig(x.depto,'ocupante').length||'—'}${S.unidades[x.depto]?.arrendatario_representa===false?' · <span class="muted">arrendatario no representa</span>':''}</td><td>${x.confirmado?'<span class="pill ok">✓</span>':'<span class="pill mu">No</span>'}</td><td>${x.faltantes.map(f=>`<span class="pill er">${esc(f)}</span>`).join(' ')}${x.pendientes?` <span class="pill wa">${x.pendientes} por revisar</span>`:''}</td></tr>`).join('')}</tbody></table></div>`; };
  const unidad=d=>{ const lst=ps.filter(p=>p.depto===d).sort((a,b)=>(a.hasta?1:0)-(b.hasta?1:0)||a.relacion.localeCompare(b.relacion));
    const m=modal(`<h3>Registro · Depto ${esc(d)}</h3><p class="small muted">${S.unidades[d]?.arrendatario_representa===false?'El copropietario declaró que el arrendatario u ocupante <b>no</b> lo representa en asambleas.':'Si el copropietario no asiste ni da poder, lo representa el arrendatario u ocupante (Ley 21.442, art. 5).'}</p>
      <div class="list">${lst.map(p=>filaRegistro(p, adm&&p.estado==='vigente'&&!p.hasta?`<button class="btn sec sm" data-fin="${p.id}">Terminar relación</button>`:'')).join('')||'<div class="empty">Sin personas registradas</div>'}</div>
      <div class="row wrap" style="justify-content:flex-end;gap:6px;margin-top:12px">${adm?'<button class="btn" id="rgAdd">+ Agregar persona</button>':''}<button class="btn sec" data-close>Cerrar</button></div>`);
    $('#rgAdd',m)?.addEventListener('click',()=>formPersonaRegistro(d, listo, true));
    m.addEventListener('click', async e=>{ const b=e.target.closest('[data-fin]'); if(!b) return; if(!await confirmBox('Se registra hoy como fecha de término (venta, fin del arriendo o mudanza). El historial queda. ¿Continuar?')) return; try{ await q(T('registro_personas').update({hasta:todayStr()}).eq('id',b.dataset.fin)); closeModal(); toast('Relación terminada'); listo(); }catch(err){ toast(errMsg(err)); } }); };
  $('#bReq')?.addEventListener('click', async()=>{ if(!await confirmBox('Se pedirá a todos los propietarios revisar y confirmar los datos de su unidad (requerimiento anual del Decreto 7). ¿Enviar?')) return; try{ const n=await q(sb.rpc('requerir_registro')); toast(`Requerimiento enviado a ${n} propietario(s)`); }catch(err){ toast(errMsg(err)); } });
  $('#bRegX').addEventListener('click', async()=>{ try{ await q(sb.rpc('registrar_exportacion',{p_que:'Registro de copropietarios (Excel)'})); }catch(err){ toast(errMsg(err)); return; } const B=v=>({v,b:true});
    descargar(new Blob([window.MiniXlsx.build([{name:'Registro', widths:[10,16,30,14,28,34,12,14,14,14], rows:[[B(S.cfg?.nombre||'')],[B('Registro de copropietarios, arrendatarios y ocupantes')],[],[B('Unidad'),B('Relación'),B('Nombre'),B('RUT'),B('Correo'),B('Domicilio'),B('Permanencia'),B('Arriendo hasta'),B('Desde'),B('Hasta')],
      ...ps.filter(p=>p.estado==='vigente').sort((a,b)=>porNum(a.depto,b.depto)).map(p=>[p.depto, REL_REG[p.relacion], p.nombre+(p.persona_juridica?' (rep. '+p.representante+')':''), p.menor?'menor de edad':(p.rut||''), p.correo||'', p.domicilio||'', p.permanente?'permanente':'transitorio', p.arriendo_hasta||'', p.desde, p.hasta||''])]}])],{type:window.MiniXlsx.MIME}), 'registro-copropietarios.xlsx'); });
  $('#rgBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-ap]')){ try{ await q(T('registro_personas').update({estado:'vigente'}).eq('id',b.dataset.ap)); toast('Incorporado al registro'); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-re]')){ const mo=await askText('Motivo del rechazo (lo ve la unidad)'); if(!mo) return; try{ await q(T('registro_personas').update({estado:'rechazado', motivo:mo.trim()}).eq('id',b.dataset.re)); toast('Rechazado'); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-baja]')){ try{ await q(T('registro_personas').update({hasta:todayStr()}).eq('id',b.dataset.baja)); toast('Baja aplicada'); listo(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-ud]')) unidad(b.dataset.ud); });
};
function registroUnidad(){
  const dep=myDepto(), prop=role()==='propietario';
  setMain(`<h1>Registro de tu unidad</h1><p class="small muted">Depto ${esc(dep)}. La Ley de Copropiedad exige un registro de copropietarios, arrendatarios y ocupantes. ${prop?'Como propietario, informas los cambios dentro de 60 días y confirmas los datos una vez al año.':'Si algo no está al día, avísale al propietario o a la administración.'}</p><div id="ruBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['registro_personas','registro_confirmaciones','unidades'], async()=>{ const [a,b]=await Promise.all([q(T('registro_personas').select('*').order('ts')), q(sb.rpc('registro_estado'))]); return {a,b}; }, ({a,b})=>{ const el=$('#ruBody'); if(!el) return; const st=b[0]||{faltantes:[],confirmado:false}, repr=S.unidades[dep]?.arrendatario_representa!==false;
    el.innerHTML=`${st.faltantes.length?`<div class="note">${st.faltantes.map(esc).join(' · ')}</div>`:''}<div class="list">${a.filter(p=>!p.hasta&&p.estado!=='rechazado').map(p=>filaRegistro(p, prop&&p.estado==='vigente'&&!p.baja_solicitada?`<button class="btn sec sm" data-pbaja="${p.id}">Ya no vive / ya no es dueño</button>`:'')).join('')||'<div class="empty">Tu unidad aún no tiene personas registradas</div>'}</div>
      ${a.some(p=>p.estado==='rechazado')?`<p class="small muted">Rechazados por la administración: ${a.filter(p=>p.estado==='rechazado').map(p=>esc(p.nombre)+' ('+esc(p.motivo||'')+')').join(', ')}</p>`:''}
      ${prop?`<div class="row wrap" style="margin-top:10px;gap:6px"><button class="btn sec" id="ruAdd">+ Informar una persona</button></div>
      <div class="card" style="margin-top:12px"><h3>Confirmación anual</h3><p class="small">${st.confirmado?`<span class="pill ok">Confirmado en ${new Date().getFullYear()}</span>`:'Aún no confirmas este año.'}</p><form id="fRc"><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="repr" ${repr?'checked':''}> Si no asisto a una asamblea ni doy poder, me puede representar el arrendatario u ocupante de la unidad (así lo dice la ley salvo que lo excluyas; en materias de mayoría reforzada siempre necesita un poder)</label><button class="btn">Confirmo que los datos de mi unidad están al día</button></form></div>`:''}`; });
  const listo=()=>w.reload();
  $('#ruBody').addEventListener('click', async e=>{ if(e.target.id==='ruAdd') return formPersonaRegistro(dep, listo, false); const b=e.target.closest('[data-pbaja]'); if(!b) return; if(!await confirmBox('Se informará a la administración para que registre el término. ¿Continuar?')) return; try{ await q(T('registro_personas').update({hasta:todayStr()}).eq('id',b.dataset.pbaja)); toast('Baja informada a la administración'); listo(); }catch(err){ toast(errMsg(err)); } });
  $('#ruBody').addEventListener('submit', async e=>{ e.preventDefault(); if(e.target.id!=='fRc') return; try{ await q(sb.rpc('confirmar_registro',{p_arrendatario_representa:$('[name=repr]',e.target).checked})); toast('Registro confirmado. ¡Gracias!'); listo(); }catch(err){ toast(errMsg(err)); } });
}

// ASAMBLEAS (Ley 21.442; adaptado del módulo F4 de CactusOne). Las reglas (plazos de citación, poderes,
// representación, quórum, hábiles, mayorías) las aplica la base de datos; esta pantalla las muestra.
const TIPO_ASM={ordinaria:'Ordinaria', extraordinaria_absoluta:'Extraordinaria de mayoría absoluta', extraordinaria_reforzada:'Extraordinaria de mayoría reforzada'};
const REGLA_ASM={ordinaria:'Se constituye con el 33 % de los derechos y acuerda por mayoría de los derechos presentes.', extraordinaria_absoluta:'Se constituye y acuerda con más del 50 % de los derechos del edificio.', extraordinaria_reforzada:'Se constituye y acuerda con el 66 % de los derechos del edificio. El arrendatario necesita un poder.'};
const MOD_ASM={presencial:'Presencial', telematica:'Telemática', mixta:'Mixta'};
const EST_ASM={borrador:['Borrador','mu'], citada:['Citada','in'], en_curso:['En curso','er'], cerrada:['Terminada','ok'], cancelada:['Cancelada','mu']};
const REGLA_MOC={asistentes:'mayoría de los derechos presentes', absoluta:'más del 50 % de los derechos', reforzada:'66 % de los derechos'};
const fechaHora=t=>new Date(t).toLocaleString('es-CL',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
async function imprimirAsamblea(tipo, a, extra){ const cab=await cabeceraImpresion(), c=S.cfg||{};
  if(tipo==='citacion') imprimir('citacion-asamblea-'+a.folio, `${cab}<h1>Citación a asamblea ${esc(TIPO_ASM[a.tipo].toLowerCase())} nº ${a.folio}</h1><p class="sub">${esc(c.nombre||'')} · citada el ${fmtDay(todayStr())}</p>
    <p>Se cita a los copropietarios a asamblea <b>${esc(TIPO_ASM[a.tipo].toLowerCase())}</b>, ${esc(MOD_ASM[a.modalidad].toLowerCase())}, el <b>${esc(fechaHora(a.fecha))}</b>${a.lugar?', en '+esc(a.lugar):''}${a.enlace?'. Enlace: '+esc(a.enlace):''}.</p>
    <h2>Tabla</h2><p style="white-space:pre-wrap">${esc(a.tabla)}</p><h2>Quórum</h2><p>${esc(REGLA_ASM[a.tipo])} Los derechos de cada unidad corresponden a su alícuota. Votan las unidades sin cuotas de gasto común impagas.</p>
    <h2>Representación</h2><p>Si no puede asistir, puede otorgar un poder simple a otra persona (en la app o por escrito). Si el copropietario no asiste ni otorga poder, lo representa el arrendatario u ocupante de la unidad, salvo que el copropietario lo haya excluido${a.tipo==='extraordinaria_reforzada'?' (en esta asamblea, por tratarse de materias de mayoría reforzada, el arrendatario necesita un poder)':''}.</p><p style="margin-top:40px">______________________________<br>Administración · ${esc(c.nombre||'')}</p>`);
  else imprimir('poder-asamblea-'+a.folio, `${cab}<h1>Poder simple</h1><p class="sub">Asamblea ${esc(TIPO_ASM[a.tipo].toLowerCase())} nº ${a.folio} · ${esc(fechaHora(a.fecha))}</p>
    <p>Yo, <b>${esc(S.me.nombre)}</b>, copropietario de la unidad <b>${esc(myDepto())}</b> de ${esc(c.nombre||'')}, otorgo poder a <b>${esc(extra.nombre)}</b>${extra.rut?', RUT '+esc(extra.rut):''}, para que me represente con voz y voto en la asamblea indicada.</p><p>Otorgado en la app el ${fmtDate(extra.ts)}.</p><p style="margin-top:50px">______________________________<br>${esc(S.me.nombre)}</p>`); }
VIEWS.asambleas = function(param){
  if(param) return asambleaDetalle(param);
  const mesa=['comite','admin'].includes(role());
  setMain(`<h1>Asambleas</h1>${mesa?'<div style="margin-bottom:10px"><button class="btn" id="bAsm">+ Nueva asamblea</button></div>':''}<div id="asList" class="list"><div class="empty">Cargando…</div></div>
    <p class="small muted">Para consultas sin asamblea (por ejemplo, elegir un color), usa Encuestas.</p>`);
  watch('asambleas', ()=>q(T('asambleas').select('*').order('fecha',{ascending:false})), rows=>{ const el=$('#asList'); if(!el) return;
    el.innerHTML=rows.map(a=>`<a class="item" href="#asambleas--${a.id}" style="display:block;text-decoration:none;color:inherit"><div class="hd"><b>Nº ${a.folio} · ${esc(TIPO_ASM[a.tipo])}</b>${pillOf(EST_ASM,a.estado)}</div><div class="meta">${esc(fechaHora(a.fecha))} · ${esc(MOD_ASM[a.modalidad])}${a.lugar?' · '+esc(a.lugar):''}${a.estado==='cerrada'&&!a.acta_firmada_at?' · acta sin firmar (plazo '+fmtDay(a.acta_hasta)+')':''}</div></a>`).join('')||'<div class="empty">Sin asambleas</div>'; });
  $('#bAsm')?.addEventListener('click',()=>{ const d0=new Date(); d0.setDate(d0.getDate()+8); d0.setHours(19,0,0,0); const v=new Date(d0.getTime()-d0.getTimezoneOffset()*60000).toISOString().slice(0,16);
    const m=modal(`<h3>Nueva asamblea</h3><form id="fAs"><label class="f"><span>Tipo</span><select name="tipo">${Object.entries(TIPO_ASM).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><p class="small muted" id="asRegla"></p>
      <div class="row"><label class="f grow"><span>Fecha y hora</span><input type="datetime-local" name="fecha" value="${v}" required></label><label class="f grow"><span>Modalidad</span><select name="modalidad">${Object.entries(MOD_ASM).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f grow"><span>Lugar</span><input type="text" name="lugar" placeholder="Sala de eventos"></label><label class="f grow"><span>Enlace (telemática o mixta)</span><input type="url" name="enlace" placeholder="https://…"></label></div>
      <label class="f"><span>Tabla (temas a tratar)</span><textarea name="tabla" required placeholder="1. Cuenta de la administración&#10;2. Presupuesto anual"></textarea></label>
      <p class="small muted">Se crea en borrador. La citación debe enviarse entre ${Number(S.cfg?.asambleas?.cita_min??5)} y ${Number(S.cfg?.asambleas?.cita_max??15)} días antes.</p><button class="btn full">Crear</button></form>`);
    const rg=()=>$('#asRegla',m).textContent=REGLA_ASM[$('[name=tipo]',m).value]; $('[name=tipo]',m).addEventListener('change',rg); rg();
    $('#fAs',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ const id=await q(sb.rpc('crear_asamblea',{p_tipo:d.tipo, p_modalidad:d.modalidad, p_fecha:new Date(d.fecha).toISOString(), p_tabla:d.tabla, p_lugar:d.lugar, p_enlace:d.enlace})); closeModal(); location.hash='#asambleas--'+id; }catch(err){ toast('Error: '+errMsg(err)); } }); });
};
function asambleaDetalle(id){
  const r=role(), mesa=['comite','admin'].includes(r), dep=myDepto();
  setMain(`<p><a href="#asambleas">‹ Asambleas</a></p><div id="asBody"><div class="empty">Cargando…</div></div>`);
  let a=null, asis=[], mocs=[], votos=[], pods=[], quo=null;
  const w=watch(['asambleas','asamblea_asistencia','asamblea_mociones','asamblea_votos','asamblea_poderes'], async()=>{ const [x,b,c,d,e,f]=await Promise.all([q(T('asambleas').select('*').eq('id',id)), q(T('asamblea_asistencia').select('*').eq('asamblea_id',id)), q(T('asamblea_mociones').select('*').eq('asamblea_id',id).order('orden')), q(T('asamblea_votos').select('*')), q(T('asamblea_poderes').select('*').eq('asamblea_id',id)), q(sb.rpc('quorum_asamblea',{p_id:id})).catch(()=>[])]); return {x,b,c,d,e,f}; },
    ({x,b,c,d,e,f})=>{ a=x[0]; asis=b; mocs=c; votos=d.filter(v=>c.some(m=>m.id===v.mocion_id)); pods=e; quo=f[0]; if(!$('.modal')&&!document.activeElement?.closest?.('#asActa')) draw(); });
  const listo=()=>w.reload();
  const rpc=async(fn,args,ok)=>{ try{ const res=await q(sb.rpc(fn,args)); toast(ok); listo(); return res; }catch(err){ toast('Error: '+errMsg(err)); } };
  const draw=()=>{ const el=$('#asBody'); if(!el) return; if(!a){ el.innerHTML='<div class="empty">No encontrada</div>'; return; }
    const us=Object.keys(S.unidades).sort(porNum), pres=d=>asis.find(x=>x.depto===d), miPoder=pods.find(p=>p.depto===dep&&!p.revocado_at&&p.otorgado_por===S.uid), comoApoderado=pods.filter(p=>p.apoderado_uid===S.uid&&!p.revocado_at);
    const misUnidades=[...(dep&&['residente','propietario'].includes(r)?[dep]:[]), ...comoApoderado.map(p=>p.depto)];
    const acciones=mesa?{borrador:['<button class="btn" data-a="citar">Citar</button>','<button class="btn sec" data-a="pdfCit">Citación (PDF)</button>','<button class="btn sec" data-a="cancelar">Cancelar</button>'], citada:['<button class="btn" data-a="iniciar">Iniciar asamblea</button>','<button class="btn sec" data-a="pdfCit">Citación (PDF)</button>','<button class="btn sec" data-a="cancelar">Cancelar</button>'], en_curso:['<button class="btn dan" data-a="terminar">Terminar asamblea</button>']}[a.estado]||[]:[];
    const barra=quo?`<div class="card"><div class="row" style="justify-content:space-between"><b>Quórum: ${numCL(quo.presentes,2)} % de los derechos presentes</b>${quo.constituida?'<span class="pill ok">Constituida</span>':'<span class="pill wa">Sin quórum</span>'}</div><div class="bar" style="margin-top:6px"><i style="width:${Math.min(100,quo.presentes)}%;background:${quo.constituida?'var(--ok)':'var(--wa)'}"></i></div><div class="small muted" style="margin-top:4px">Se requiere ${a.tipo==='extraordinaria_absoluta'?'más del 50':numCL(quo.requerido,0)} % · ${quo.unidades} de ${us.length} unidades</div></div>`:'';
    el.innerHTML=`<div class="card"><div class="hd row" style="justify-content:space-between"><h1 style="margin:0">Asamblea nº ${a.folio}</h1>${pillOf(EST_ASM,a.estado)}</div>
      <p><b>${esc(TIPO_ASM[a.tipo])}</b> · ${esc(MOD_ASM[a.modalidad])} · ${esc(fechaHora(a.fecha))}${a.lugar?' · '+esc(a.lugar):''}${a.enlace?` · <a href="${esc(urlSegura(a.enlace))}" target="_blank" rel="noopener">enlace</a>`:''}</p>
      <p class="small muted">${esc(REGLA_ASM[a.tipo])}${a.motivo_cancelacion?' · Cancelada: '+esc(a.motivo_cancelacion):''}</p><h2>Tabla</h2><p style="white-space:pre-wrap">${esc(a.tabla)}</p>
      ${acciones.length?`<div class="row wrap" style="gap:6px">${acciones.join('')}</div>`:''}</div>
      ${['borrador','citada'].includes(a.estado)?`<h2>Poderes</h2>${r==='propietario'?(miPoder?`<div class="item static"><div class="hd"><b>Diste poder a ${esc(miPoder.nombre)}</b><span class="row" style="gap:6px"><button class="btn sec sm" data-a="pdfPod">Poder (PDF)</button><button class="btn sec sm" data-a="revocar">Revocar</button></span></div><div class="meta">${miPoder.rut?'RUT '+esc(miPoder.rut)+' · ':''}${fmtDate(miPoder.ts)}. Puedes revocarlo hasta que empiece la asamblea.</div></div>`:'<p class="small muted">Si no puedes asistir, designa a alguien que te represente con voz y voto.</p><button class="btn sec" data-a="poder">Dar un poder</button>'):''}
        ${mesa?`<div class="list" style="margin-top:8px">${pods.filter(p=>!p.revocado_at).map(p=>`<div class="item static"><div class="meta">Depto ${esc(p.depto)} → ${esc(p.nombre)}${p.rut?' ('+esc(p.rut)+')':''}${p.apoderado_uid?' · tiene cuenta en la app':''}</div></div>`).join('')||'<div class="empty">Sin poderes</div>'}</div>`:''}`:''}
      ${['en_curso','cerrada'].includes(a.estado)?`<h2>Asistencia</h2>${barra}
        ${a.estado==='en_curso'&&misUnidades.some(d=>!pres(d))?`<div class="row wrap acc">${misUnidades.filter(d=>!pres(d)).map(d=>`<button class="btn" data-asis="${esc(d)}">Registrar mi asistencia (depto ${esc(d)})</button>`).join('')}</div>`:''}
        <div class="card" style="overflow:auto"><table><thead><tr><th>Unidad</th><th class="num">Derechos</th><th>Asiste</th><th></th></tr></thead><tbody>${us.map(d=>{ const x=pres(d); return `<tr><td><b>${esc(d)}</b></td><td class="num">${numCL(S.unidades[d]?.alicuota,4)} %</td><td class="small">${x?`${esc(x.quien)} · ${x.via==='telematica'?'telemática':'presencial'}${x.habil?'':' · <span class="pill wa">no vota: cuotas impagas</span>'}`:'<span class="muted">—</span>'}</td><td>${mesa&&a.estado==='en_curso'&&!x?`<select data-cal="${esc(d)}" style="width:auto"><option value="propietario">Copropietario</option>${pods.some(p=>p.depto===d&&!p.revocado_at)?'<option value="apoderado">Apoderado</option>':''}${a.tipo!=='extraordinaria_reforzada'?'<option value="arrendatario">Arrendatario u ocupante</option>':''}</select> <button class="btn sec sm" data-pres="${esc(d)}">Presente</button>`:''}${mesa&&a.estado==='cerrada'&&!x&&modAbierto('multas')?`<button class="btn sec sm" data-inas="${esc(d)}">Caso por inasistencia</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>
        <h2>Votaciones</h2>${mesa&&a.estado==='en_curso'?'<div style="margin-bottom:8px"><button class="btn sec" data-a="mocion">+ Moción</button></div>':''}
        <div class="list">${mocs.map(m=>{ const vs=votos.filter(v=>v.mocion_id===m.id), suma=o=>vs.filter(v=>v.opcion===o).reduce((s2,v)=>s2+Number(v.peso),0), puedo=misUnidades.filter(d=>pres(d)&&!vs.some(v=>v.depto===d));
          return `<div class="item static"><div class="hd"><b>${m.orden}. ${esc(m.titulo)}</b>${m.estado==='cerrada'?`<span class="pill ${m.resultado==='aprobada'?'ok':'er'}">${m.resultado==='aprobada'?'Aprobada':'Rechazada'}</span>`:m.estado==='abierta'?'<span class="pill er">Votando</span>':'<span class="pill mu">Pendiente</span>'}</div>
            <div class="meta">Se aprueba con ${REGLA_MOC[m.regla]}${m.descripcion?' · '+esc(m.descripcion):''}</div>
            ${vs.length||m.estado==='cerrada'?`<div class="small" style="margin-top:6px">Sí ${numCL(suma('si'),2)} % (${vs.filter(v=>v.opcion==='si').map(v=>esc(v.depto)).join(', ')||'—'}) · No ${numCL(suma('no'),2)} % (${vs.filter(v=>v.opcion==='no').map(v=>esc(v.depto)).join(', ')||'—'}) · Abstención ${numCL(suma('abstencion'),2)} %${m.base?` · base ${numCL(m.base,2)} %`:''}</div>`:''}
            <div class="row acc">${m.estado==='abierta'?puedo.map(d=>`<span class="small">Depto ${esc(d)}:</span><button class="btn ok sm" data-voto="si" data-m="${m.id}" data-d="${esc(d)}">Sí</button><button class="btn dan sm" data-voto="no" data-m="${m.id}" data-d="${esc(d)}">No</button><button class="btn sec sm" data-voto="abstencion" data-m="${m.id}" data-d="${esc(d)}">Me abstengo</button>`).join(''):''}
              ${mesa&&m.estado==='pendiente'&&a.estado==='en_curso'?`<button class="btn sm" data-abrir="${m.id}">Abrir votación</button>`:''}${mesa&&m.estado==='abierta'?`<button class="btn sec sm" data-presen="${m.id}">Voto presencial</button><button class="btn sm" data-cerrar="${m.id}">Cerrar votación</button>`:''}</div></div>`; }).join('')||'<div class="empty">Sin votaciones</div>'}</div>`:''}
      ${a.estado==='cerrada'?`<h2>Acta</h2>${a.acta_firmada_at?`<div class="card"><p class="small muted">Firmada el ${fmtDate(a.acta_firmada_at)}</p><p style="white-space:pre-wrap">${esc(a.acta||'')}</p></div>`:mesa?`<form id="asActa"><textarea name="acta" style="min-height:160px" placeholder="Acta de la asamblea: asistentes, acuerdos, votaciones…">${esc(a.acta||'')}</textarea><p class="small ${a.acta_hasta<todayStr()?'':'muted'}" style="${a.acta_hasta<todayStr()?'color:var(--er)':''}">Debe firmarse a más tardar el ${fmtDay(a.acta_hasta)}.</p><div class="row wrap" style="gap:6px"><button class="btn sec" name="g">Guardar borrador</button><button class="btn" name="f">Guardar y marcar como firmada</button></div></form>`:'<p class="small muted">El acta aún no está firmada.</p>'}`:''}`; };
  $('#asBody').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b; if(!a) return;
    if(b=t('[data-a]')){ const k=b.dataset.a;
      if(k==='citar'){ if(await confirmBox('Se avisará a copropietarios y residentes. ¿Enviar la citación?')) rpc('citar_asamblea',{p_id:id},'Citación enviada'); }
      else if(k==='pdfCit') imprimirAsamblea('citacion',a);
      else if(k==='cancelar'){ const mo=await askText('Motivo de la cancelación'); if(mo) rpc('cancelar_asamblea',{p_id:id, p_motivo:mo},'Asamblea cancelada'); }
      else if(k==='iniciar') rpc('iniciar_asamblea',{p_id:id},'Asamblea iniciada');
      else if(k==='terminar'){ if(await confirmBox('¿Terminar la asamblea? Después solo se puede escribir el acta.')) rpc('terminar_asamblea',{p_id:id},'Asamblea terminada'); }
      else if(k==='revocar'){ const p=pods.find(x=>x.depto===dep&&!x.revocado_at&&x.otorgado_por===S.uid); if(p) rpc('revocar_poder',{p_id:p.id},'Poder revocado'); }
      else if(k==='pdfPod'){ const p=pods.find(x=>x.depto===dep&&!x.revocado_at&&x.otorgado_por===S.uid); if(p) imprimirAsamblea('poder',a,p); }
      else if(k==='poder'){ const usuarios=Object.values(S.users).filter(u=>u.estado==='activo'&&u.id!==S.uid&&u.nombre!=='Cuenta eliminada').sort((x,y)=>x.nombre.localeCompare(y.nombre));
        const m=modal(`<h3>Dar un poder</h3><form id="fPd"><label class="f"><span>Si tiene cuenta en la app (podrá registrarse y votar por tu unidad)</span><select name="uid"><option value="">— Otra persona —</option>${usuarios.map(u=>`<option value="${u.id}">${esc(userName(u.id))}</option>`).join('')}</select></label>
          <label class="f"><span>Nombre del apoderado</span><input type="text" name="nombre"></label><div class="row"><label class="f grow"><span>RUT</span><input type="text" name="rut"></label><label class="f grow"><span>Correo</span><input type="email" name="correo"></label></div>
          <p class="small muted">El poder es solo para esta asamblea y puedes revocarlo hasta que empiece. Si el apoderado no tiene cuenta, debe presentarse ante la mesa con el poder impreso.</p><button class="btn full">Dar poder</button></form>`);
        $('#fPd',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('otorgar_poder',{p_asamblea:id, p_nombre:d.nombre.trim(), p_rut:d.rut.trim()||null, p_correo:d.correo.trim(), p_apoderado:d.uid||null})); closeModal(); toast('Poder otorgado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); }
      else if(k==='mocion'){ const m=modal(`<h3>Nueva moción</h3><form id="fMo"><label class="f"><span>Qué se vota</span><input type="text" name="t" required></label><label class="f"><span>Detalle (opcional)</span><textarea name="d"></textarea></label><label class="f"><span>Mayoría</span><select name="r"><option value="">La del tipo de asamblea</option>${Object.entries(REGLA_MOC).map(([k2,v])=>`<option value="${k2}">${esc(v)}</option>`).join('')}</select></label><button class="btn full">Agregar</button></form>`);
        $('#fMo',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('agregar_mocion',{p_asamblea:id, p_titulo:d.t, p_descripcion:d.d, p_regla:d.r||null})); closeModal(); toast('Moción agregada'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); } }
    else if(b=t('[data-asis]')) rpc('registrar_asistencia',{p_asamblea:id, p_depto:b.dataset.asis},'Asistencia registrada');
    else if(b=t('[data-pres]')){ const cal=$(`[data-cal="${CSS.escape(b.dataset.pres)}"]`).value; rpc('registrar_asistencia',{p_asamblea:id, p_depto:b.dataset.pres, p_calidad:cal, p_via:'presencial'},'Asistencia registrada'); }
    else if(b=t('[data-voto]')) rpc('votar_mocion',{p_mocion:b.dataset.m, p_depto:b.dataset.d, p_opcion:b.dataset.voto},'Voto registrado');
    else if(b=t('[data-abrir]')) rpc('abrir_mocion',{p_id:b.dataset.abrir},'Votación abierta');
    else if(b=t('[data-cerrar]')){ const res=await rpc('cerrar_mocion',{p_id:b.dataset.cerrar},'Votación cerrada'); if(res) toast('Resultado: '+res); }
    else if(b=t('[data-presen]')){ const mid=b.dataset.presen, ya=votos.filter(v=>v.mocion_id===mid).map(v=>v.depto), ds=asis.filter(x=>!ya.includes(x.depto)).map(x=>x.depto).sort(porNum);
      if(!ds.length){ toast('Todas las unidades presentes ya votaron'); return; }
      const m=modal(`<h3>Voto presencial</h3><form id="fVp"><label class="f"><span>Unidad presente</span><select name="d">${ds.map(d=>`<option>${esc(d)}</option>`).join('')}</select></label><label class="f"><span>Voto</span><select name="o"><option value="si">Sí</option><option value="no">No</option><option value="abstencion">Abstención</option></select></label><button class="btn full">Registrar</button></form>`);
      $('#fVp',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('votar_mocion',{p_mocion:mid, p_depto:d.d, p_opcion:d.o})); closeModal(); toast('Voto registrado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } }); }
    else if(b=t('[data-inas]')) formCaso({depto:b.dataset.inas, descripcion:`La unidad no asistió ni se hizo representar en la asamblea ${TIPO_ASM[a.tipo].toLowerCase()} nº ${a.folio} del ${fmtDay(String(a.fecha).slice(0,10))}.`}); });
  $('#asBody').addEventListener('submit', async e=>{ if(e.target.id!=='asActa') return; e.preventDefault(); const firmada=e.submitter?.name==='f'; if(firmada&&!await confirmBox('Una vez firmada, el acta no se puede modificar. ¿Continuar?')) return;
    try{ await q(sb.rpc('guardar_acta',{p_id:id, p_acta:$('[name=acta]',e.target).value, p_firmada:firmada})); toast(firmada?'Acta firmada':'Borrador guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } });
}

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
const filaPago=(p,conDepto)=>`<div class="item static"><div class="hd"><b>${conDepto?'Depto '+esc(p.depto)+' · ':''}${clp(p.monto)}</b><span class="row" style="gap:4px">${p.anulado?'<span class="pill er">Anulado</span>':''}<span class="muted small">${fmtDay(p.fecha)}</span></span></div><div class="meta">${p.periodo?(p.concepto==='interes'?'Interés por mora ':'Gastos comunes ')+esc(fmtMonth(p.periodo)):'Convenio de pago'} · ${esc(MEDIOS[p.medio]||p.medio)}${p.referencia?' · comprobante '+esc(p.referencia):''}${p.nota?' · '+esc(p.nota):''}${p.anulado&&p.anulado_motivo?' · anulado: '+esc(p.anulado_motivo):''}</div>${!p.anulado&&p.medio!=='condonacion'?`<div class="row acc"><button class="btn sec sm" data-comp="${p.id}">Comprobante</button>${conDepto&&isAdmin()?`<button class="btn sec sm" data-anular="${p.id}">Anular pago</button>`:''}</div>`:''}</div>`;
const folioPago=id=>String(id).replace(/-/g,'').slice(0,8).toUpperCase();
async function imprimirComprobante(id){ let p; try{ p=await q(T('pagos').select('*').eq('id',id).maybeSingle()); }catch(err){ toast('Error: '+errMsg(err)); return; }
  const cab=await cabeceraImpresion(), c=S.cfg||{};
  imprimir('comprobante-'+folioPago(p.id), `${cab}<h1>Comprobante de pago nº ${folioPago(p.id)}</h1><p class="sub">Unidad ${esc(p.depto)} · registrado el ${fmtDate(p.ts)}</p>
    <table><tbody><tr><th>Monto</th><td><b>${clp(p.monto)}</b></td></tr><tr><th>Fecha del pago</th><td>${fmtDay(p.fecha)}</td></tr><tr><th>Medio</th><td>${esc(MEDIOS[p.medio]||p.medio)}</td></tr>${p.referencia?`<tr><th>Referencia</th><td>${esc(p.referencia)}</td></tr>`:''}
    <tr><th>Aplicado a</th><td>${p.convenio_id?'Convenio de pago':(p.concepto==='interes'?'Interés por mora de ':'Gasto común de ')+esc(fmtMonth(p.periodo))}</td></tr>${p.nota?`<tr><th>Nota</th><td>${esc(p.nota)}</td></tr>`:''}</tbody></table>
    <p class="small" style="margin-top:16px">La administración de ${esc(c.nombre||'la comunidad')} deja constancia de haber recibido este pago.</p><p style="margin-top:40px">______________________________<br>Administración · ${esc(c.nombre||'')}</p>`); }
document.addEventListener('click',e=>{ const b=e.target.closest?.('[data-comp]'); if(b){ e.preventDefault(); e.stopPropagation(); imprimirComprobante(b.dataset.comp); } }, true);

// Certificados de deuda o de no deuda
async function imprimirCertificado(x){ const cab=await cabeceraImpresion(), c=S.cfg||{}, d=x.detalle||{}, deuda=Number(x.deuda)>0, per=d.periodos||[], cv=(d.convenios||[]).filter(k=>k.estado==='vigente');
  const prop=S.unidades[x.depto]?.prop;
  imprimir('certificado-'+x.folio+'-'+x.depto, `${cab}<h1>${deuda?'Certificado de deuda':'Certificado de no deuda'} nº ${x.folio}</h1><p class="sub">${fmtDay(x.fecha)} · Unidad ${esc(x.depto)}</p>
    <p>La administración de la comunidad <b>${esc(c.nombre||'')}</b>${c.direccion?', '+esc(c.direccion):''}${c.comuna?', '+esc(c.comuna):''}, certifica que al ${fmtDay(x.fecha)} la unidad <b>${esc(x.depto)}</b>${prop?' (propietario/a: '+esc(prop)+')':''} ${deuda?`registra una deuda total de <b>${clp(x.deuda)}</b> por gastos comunes${Number(d.interes)>0?' e intereses por mora':''}, según el siguiente detalle:`:'<b>no registra deuda</b> de gastos comunes.'}</p>
    ${per.length?`<table><thead><tr><th>Período</th><th>Vence</th><th class="num">Saldo</th><th class="num">Interés</th><th></th></tr></thead><tbody>${per.map(r=>`<tr><td>${esc(fmtMonth(r.periodo))}</td><td>${r.vence?fmtDay(r.vence):'—'}</td><td class="num">${clp(r.saldo)}</td><td class="num">${Number(r.interes)?clp(r.interes):'—'}</td><td>${r.convenio?'En convenio de pago':''}</td></tr>`).join('')}<tr><th colspan="2">Total</th><th class="num">${clp(d.deuda)}</th><th class="num">${Number(d.interes)?clp(d.interes):'—'}</th><th></th></tr></tbody></table>`:''}
    ${cv.length?`<p>${cv.length===1?'Tiene un convenio de pago vigente':'Tiene '+cv.length+' convenios de pago vigentes'}, con un saldo de ${clp(cv.reduce((a,k)=>a+Number(k.saldo),0))}${cv.some(k=>Number(k.atraso)>0)?' y cuotas atrasadas por '+clp(cv.reduce((a,k)=>a+Number(k.atraso),0)):', al día'}.</p>`:''}
    ${x.motivo?`<p>Se extiende a solicitud del interesado, para ${esc(x.motivo)}.</p>`:''}
    <p class="small muted">Considera los gastos comunes publicados hasta la fecha de emisión y los pagos registrados por la administración. No incluye cobros de períodos aún no publicados ni cargos posteriores.</p>
    <p style="margin-top:40px">______________________________<br>Administración · ${esc(c.nombre||'')}</p>`); }
async function panelCertificados(el, sigue=()=>true){ const adm=isAdmin(); let cs=[]; try{ cs=await q(T('certificados').select('*').order('folio',{ascending:false}).limit(500)); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!sigue()) return;
  el.innerHTML=`<p class="small muted">Certificado de deuda o de no deuda de una unidad, con folio correlativo. Se pide al vender, arrendar o hipotecar. Refleja el estado de cuenta al momento de emitirlo.</p>${adm?'<div class="row" style="margin-bottom:10px"><button class="btn" id="bCert">Emitir certificado</button></div>':''}
    <div class="list">${cs.map(x=>`<div class="item" data-cert="${x.id}"><div class="hd"><b>Nº ${x.folio} · Depto ${esc(x.depto)}</b>${Number(x.deuda)>0?`<span class="pill er">Deuda ${clp(x.deuda)}</span>`:'<span class="pill ok">Sin deuda</span>'}</div><div class="meta">${fmtDay(x.fecha)}${x.motivo?' · '+esc(x.motivo):''}${x.emitido_por?' · '+esc(userName(x.emitido_por)):''}</div></div>`).join('')||'<div class="empty">Aún no se han emitido certificados</div>'}</div>`;
  el.onclick=async e=>{ const it=e.target.closest('[data-cert]'); if(it){ imprimirCertificado(cs.find(x=>x.id===it.dataset.cert)); return; }
    if(!e.target.closest('#bCert')) return;
    const m=modal(`<h3>Emitir certificado</h3><form id="fCe"><label class="f"><span>Unidad</span><input type="text" name="depto" list="dlCe" required><datalist id="dlCe">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>
      <label class="f"><span>Para qué se pide (opcional)</span><input type="text" name="motivo" placeholder="Ej: compraventa de la unidad"></label><p class="small muted">Si la unidad no tiene deuda, sale como certificado de no deuda.</p><button class="btn full">Emitir e imprimir</button></form>`);
    $('#fCe',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const b=$('button.full',m); busy(b,true);
      try{ const id=await q(sb.rpc('emitir_certificado',{p_depto:d.depto.trim(), p_motivo:d.motivo.trim()})); const x=await q(T('certificados').select('*').eq('id',id).maybeSingle()); closeModal(); toast('Certificado nº '+x.folio+' emitido'); imprimirCertificado(x); panelCertificados(el, sigue); }catch(err){ toast(errMsg(err)); busy(b,false); } }); }; }

// Estado de cuenta de la unidad, bajo los gastos comunes del residente
function cuentaResidente(){
  let D=null; const w=watch(['gasto_unidades','pagos','convenios','convenio_cuotas'], ()=>finDatos(myDepto()), d=>{ D=d; const el=$('#gCuenta'); if(!el) return; const z=D.U[myDepto()]||{deuda:0,vencido:0,convenio:0,interes:0,rows:[],convs:[]}; const pend=z.rows.filter(r=>r.saldo>0||r.int>0);
    el.innerHTML=`<h2>Estado de cuenta · Depto ${esc(myDepto())}</h2><div class="kpi"><div class="k"><b>${clp(z.deuda)}</b><span>Saldo por pagar</span></div><div class="k"><b style="color:${z.vencido?'var(--er)':'inherit'}">${clp(z.vencido)}</b><span>Vencido</span></div><div class="k"><b>${clp(z.convenio)}</b><span>En convenio</span></div>${z.interes?`<div class="k"><b style="color:var(--er)">${clp(z.interes)}</b><span>Intereses por mora</span></div>`:''}</div>
    ${txtMora()?`<p class="small muted" style="margin-top:8px">${esc(txtMora())}</p>`:''}
    ${z.convs.some(c=>c.estado==='propuesto')?'<div class="note" style="margin-top:12px">La administración te propuso un convenio de pago. Revísalo y acéptalo o recházalo.</div>':''}
    ${pend.length?`<div class="card" style="margin-top:12px"><table><thead><tr><th>Período</th><th>Vence</th><th class="num">Monto</th><th class="num">Saldo</th>${z.interes?'<th class="num">Interés</th>':''}<th></th></tr></thead><tbody>${pend.map(r=>`<tr><td>${esc(fmtMonth(r.periodo))}</td><td>${r.vence?fmtDay(r.vence):'—'}</td><td class="num">${clp(r.monto)}</td><td class="num">${clp(r.saldo)}</td>${z.interes?`<td class="num">${r.int?clp(r.int):'—'}</td>`:''}<td>${!r.saldo?'<span class="pill wa">Interés pendiente</span>':r.enConvenio?'<span class="pill in">En convenio</span>':r.vence&&r.vence<todayStr()?'<span class="pill er">Vencido</span>':'<span class="pill wa">Pendiente</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="small muted" style="margin-top:10px">Tu unidad está al día.</p>'}
    ${z.convs.length?`<h2>Convenios de pago</h2><div class="list">${z.convs.map(c=>`<div class="item" data-cv="${c.id}"><div class="hd"><b>${clp(c.monto_total)} en ${c.cuotas} ${c.cuotas===1?'cuota':'cuotas'}</b>${pillConv(c)}</div><div class="meta">Abonado ${clp(c.abonado)} · saldo ${clp(c.saldo)}${c.estado==='vigente'&&c.prox?' · próxima cuota '+clp(Number(c.prox.monto)-Number(c.prox.pagado_monto))+' vence '+fmtDay(c.prox.vence):''}</div></div>`).join('')}</div>`:''}
    <h2>Pagos registrados</h2><div class="list">${D.pagos.slice(0,24).map(p=>filaPago(p,false)).join('')||'<div class="empty">Aún no hay pagos registrados</div>'}</div><p class="small muted">Los pagos los registra la administración al recibirlos. Si falta alguno, escríbele por Mensajes con el comprobante.</p><div id="gCert"></div>`;
    q(T('certificados').select('*').eq('depto',myDepto()).order('folio',{ascending:false}).limit(20)).then(cs=>{ const c=$('#gCert'); if(!c||!cs.length) return; c.innerHTML=`<h2>Certificados de deuda</h2><div class="list">${cs.map(x=>`<div class="item" data-cert="${x.id}"><div class="hd"><b>Nº ${x.folio} · ${fmtDay(x.fecha)}</b>${Number(x.deuda)>0?`<span class="pill er">Deuda ${clp(x.deuda)}</span>`:'<span class="pill ok">Sin deuda</span>'}</div><div class="meta">${esc(x.motivo||'')}</div></div>`).join('')}</div>`; c.onclick=e=>{ const it=e.target.closest('[data-cert]'); if(it) imprimirCertificado(cs.find(x=>x.id===it.dataset.cert)); }; }).catch(()=>{}); }, {silent:true});
  $('#gCuenta').addEventListener('click',e=>{ const it=e.target.closest('[data-cv]'); if(it&&D?.C[it.dataset.cv]) detalleConvenio(D.C[it.dataset.cv], w.reload); });
}
// ---------- Cartola bancaria ----------
const CAT_CAJA=['Remuneraciones','Agua','Electricidad','Gas','Mantención','Aseo','Seguros','Honorarios','Reparaciones','Multas','Arriendo de espacios','Intereses','Comisiones bancarias','Saldo a favor','Saldo inicial'];
const sinTildes=t=>String(t??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
// Fecha de una celda: número de serie de Excel, dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd
function fechaCelda(v){ if(v==null||v==='') return null;
  if(typeof v==='number'){ if(v<20000||v>80000) return null; const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000); return d.toISOString().slice(0,10); }
  const t=String(v).trim(); let m=t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if(m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m=t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/); if(m){ const y=m[3].length===2?'20'+m[3]:m[3]; if(+m[2]>12) return null; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return null; }
// Monto de una celda: 1.234.567 · $ 1.234 · -15.000 · 1234567,00 · (15.000)
function montoCelda(v){ if(v==null||v==='') return 0; if(typeof v==='number') return v;
  let t=String(v).replace(/\s|\$|CLP/gi,''); const neg=/^\(.*\)$/.test(t)||/^-/.test(t)||/-$/.test(t); t=t.replace(/[()\-+]/g,'');
  if(/,\d{1,2}$/.test(t)) t=t.replace(/\./g,'').replace(',','.'); else if(/^\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,''); else t=t.replace(/,/g,'');
  const n=Number(t); return isFinite(n)?(neg?-n:n):NaN; }
async function leerCartola(file, texto){
  if(file&&file.size>20*1024*1024) throw new Error('El archivo es demasiado grande (máximo 20 MB)');
  if(file&&/\.xlsx$/i.test(file.name)) return window.MiniXlsx.read(await file.arrayBuffer());
  if(file&&/\.xls$/i.test(file.name)) throw new Error('Los .xls antiguos no se pueden leer: ábrelo en Excel y guárdalo como .xlsx o CSV, o copia las filas y pégalas aquí.');
  const t=file?await file.text():texto||''; const lin=t.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  const sep=lin.some(l=>l.includes('\t'))?'\t':(lin.slice(0,10).join('').split(';').length>lin.slice(0,10).join('').split(',').length?';':',');
  return lin.map(l=>{ const out=[]; let c='', q=false; for(let i=0;i<l.length;i++){ const ch=l[i]; if(ch==='"'){ if(q&&l[i+1]==='"'){ c+='"'; i++; } else q=!q; } else if(ch===sep&&!q){ out.push(c); c=''; } else c+=ch; } out.push(c); return out.map(x=>x.trim()); }); }
// Columnas: busca la fila de títulos (Fecha + Abono/Monto/Depósito)
function detectarCartola(filas){
  const es=(h,...k)=>k.some(x=>sinTildes(h).includes(x));
  for(let i=0;i<Math.min(filas.length,40);i++){ const f=filas[i].map(x=>x==null?'':String(x));
    const fecha=f.findIndex(h=>es(h,'fecha')); if(fecha<0) continue;
    const abono=f.findIndex(h=>es(h,'abono','deposito','credito','ingreso'));
    const cargo=f.findIndex(h=>es(h,'cargo','giro','debito','egreso'));
    const monto=f.findIndex(h=>sinTildes(h)==='monto'||es(h,'importe','monto ($)','monto $'));
    if(abono<0&&monto<0) continue;
    return {cab:i, cols:{fecha, glosa:f.findIndex(h=>es(h,'descripcion','glosa','detalle','concepto','movimiento')), doc:f.findIndex(h=>es(h,'documento','n° doc','nro','operacion','referencia')), cargo, abono, monto:abono>=0?-1:monto}}; }
  return {cab:-1, cols:{fecha:0, glosa:1, doc:-1, cargo:-1, abono:-1, monto:2}}; }
function movsCartola(filas, cab, c){ const out=[], vistos={}; let malas=0;
  filas.slice(cab+1).forEach(f=>{ const fecha=fechaCelda(f[c.fecha]); let monto=c.monto>=0?montoCelda(f[c.monto]):montoCelda(f[c.abono])-Math.abs(montoCelda(f[c.cargo])||0);
    if(c.monto<0&&!(montoCelda(f[c.abono])>0)) monto=-Math.abs(montoCelda(f[c.cargo])||0);
    if(!fecha||!monto||!isFinite(monto)){ if(f.some(x=>x!=null&&x!=='')) malas++; return; }
    const glosa=c.glosa>=0?String(f[c.glosa]??'').trim():'', doc=c.doc>=0?String(f[c.doc]??'').trim():'';
    const k=[fecha,Math.round(monto),sinTildes(glosa),doc].join('|'); vistos[k]=(vistos[k]??-1)+1;
    out.push({fecha, monto:Math.round(monto), glosa, documento:doc, n:vistos[k]}); });
  return {movs:out, malas}; }
function importarCartola(listo){
  const m=modal(`<h3>Importar cartola</h3><p class="small muted">Descarga la cartola desde el sitio de tu banco como Excel (.xlsx) o CSV, o abre el archivo y copia las filas. Volver a importar la misma cartola no duplica movimientos.</p>
    <form id="fCa1"><label class="f"><span>Archivo</span><input type="file" name="archivo" accept=".xlsx,.xls,.csv,.txt"></label><label class="f"><span>…o pega aquí las filas copiadas desde Excel (con la fila de títulos)</span><textarea name="texto" rows="4"></textarea></label><button class="btn full">Leer</button></form><div id="caPaso2"></div>`);
  $('#fCa1',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const f=$('[name=archivo]',m).files[0], t=$('[name=texto]',m).value; if(!f&&!t.trim()){ toast('Elige un archivo o pega las filas'); return; }
    let filas; try{ filas=(await leerCartola(f,t)).filter(r=>r&&r.length); }catch(err){ toast(errMsg(err)); return; } if(!filas.length){ toast('No se encontraron filas'); return; }
    if(filas.length>20000){ toast('La cartola tiene demasiadas filas (máximo 20.000): importa un período más corto'); return; }
    const det=detectarCartola(filas), cab=det.cab<0?-1:det.cab, tit=cab>=0?filas[cab]:filas[0].map((_,i)=>'Columna '+(i+1)), n=Math.min(60, filas.reduce((a,r)=>Math.max(a,r.length),0));
    const sel=(k,t,opc)=>`<label class="f"><span>${t}</span><select name="${k}">${opc?'<option value="-1">(no hay)</option>':''}${Array.from({length:n},(_,i)=>`<option value="${i}" ${det.cols[k]===i?'selected':''}>${esc(tit[i]??'Columna '+(i+1))}</option>`).join('')}</select></label>`;
    $('#fCa1',m).style.display='none';
    $('#caPaso2',m).innerHTML=`<form id="fCa2"><div class="grid2">${sel('fecha','Fecha')}${sel('glosa','Descripción',true)}${sel('doc','N° de documento',true)}${sel('abono','Abonos (entradas)',true)}${sel('cargo','Cargos (salidas)',true)}${sel('monto','…o un solo monto con signo',true)}</div><div id="caPrev"></div><div class="row wrap"><button type="button" class="btn sec" id="caAtras">Volver</button><button class="btn grow">Importar</button></div></form>`;
    const f2=$('#fCa2',m); let res;
    const prev=()=>{ const c={}; ['fecha','glosa','doc','abono','cargo','monto'].forEach(k=>c[k]=Number(f2.elements[k].value)); if(c.abono>=0) c.monto=-1; res=movsCartola(filas, cab, c);
      const ab=res.movs.filter(x=>x.monto>0);
      $('#caPrev',m).innerHTML=`<div class="info">${res.movs.length} movimientos: ${ab.length} abonos por ${clp(ab.reduce((a,x)=>a+x.monto,0))} y ${res.movs.length-ab.length} cargos${res.malas?` · ${res.malas} filas sin fecha o monto se omiten (títulos, totales, saldos)`:''}.</div>
        <div style="overflow:auto;max-height:220px"><table><thead><tr><th>Fecha</th><th>Descripción</th><th class="num">Monto</th></tr></thead><tbody>${res.movs.slice(0,8).map(x=>`<tr><td>${fmtDay(x.fecha)}</td><td>${esc(x.glosa)}</td><td class="num" style="color:${x.monto>0?'var(--ok)':'var(--er)'}">${clp(x.monto)}</td></tr>`).join('')}</tbody></table></div>`; };
    f2.addEventListener('change',prev); prev();
    $('#caAtras',m).addEventListener('click',()=>{ $('#caPaso2',m).innerHTML=''; $('#fCa1',m).style.display=''; });
    f2.addEventListener('submit', async ev2=>{ ev2.preventDefault(); if(!res.movs.length){ toast('No hay movimientos para importar'); return; } const b=$('button.grow',f2); busy(b,true);
      try{ const r=await q(sb.rpc('importar_cartola',{p_filas:res.movs})); closeModal(); toast(r.nuevas?`${r.nuevas} movimientos nuevos${r.repetidas?` · ${r.repetidas} ya estaban`:''}`:'Todos los movimientos ya estaban importados'); listo(); }catch(err){ toast(errMsg(err)); busy(b,false); } }); }); }
const EST_BANCO={pendiente:['Por conciliar','wa'], conciliado:['Pago registrado','ok'], caja:['En el flujo de caja','in'], ignorado:['Ignorado','mu']};
async function panelBanco(el, listo, sigue=()=>true){ const adm=isAdmin(); let ms=[], fps=[]; try{ [ms,fps]=await Promise.all([q(T('banco_movimientos').select('*').order('fecha',{ascending:false}).limit(3000)), q(T('facturas').select('*').eq('estado','por_pagar')).catch(()=>[])]); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!sigue()) return;
  const filtro=el.dataset.f||'pendiente', pend=ms.filter(x=>x.estado==='pendiente'), sug=pend.filter(x=>x.monto>0&&x.sugerido), vis=filtro==='todos'?ms:ms.filter(x=>filtro==='pendiente'?x.estado==='pendiente':x.estado!=='pendiente');
  el.innerHTML=`<p class="small muted">Importa la cartola del banco y concilia cada abono con la unidad que pagó: la app sugiere la unidad por el RUT del registro de copropietarios, la unidad mencionada en la transferencia, el nombre o el monto, y recuerda a cada pagador. Al confirmar se registran los pagos (primero los cobros más antiguos) y se envía un comprobante. Los cargos se pasan al flujo de caja como egresos.</p>
    ${adm?`<div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bCart">Importar cartola</button>${sug.length?`<button class="btn sec" id="bSug">Confirmar ${sug.length===1?'la sugerencia':'las '+sug.length+' sugerencias'}</button>`:''}</div>`:''}
    <div class="tabs" style="margin-bottom:8px">${[['pendiente',`Por conciliar (${pend.length})`],['hechos','Procesados'],['todos','Todos']].map(([k,v])=>`<button data-bf="${k}" class="${k===filtro?'on':''}">${v}</button>`).join('')}</div>
    <div class="list">${vis.slice(0,300).map(x=>{ const ab=x.monto>0;
      return `<div class="item static"><div class="hd"><b style="color:${ab?'var(--ok)':'var(--er)'}">${ab?'+':'−'}${clp(Math.abs(x.monto))}</b><span class="row" style="gap:4px">${pillOf(EST_BANCO,x.estado)}<span class="muted small">${fmtDay(x.fecha)}</span></span></div>
        <div class="meta">${esc(x.glosa||'(sin descripción)')}${x.documento?' · doc. '+esc(x.documento):''}</div>
        ${x.estado==='pendiente'&&ab&&x.sugerido?`<div class="small" style="margin-top:4px">Sugerencia: <b>Depto ${esc(x.sugerido)}</b> · ${esc(x.motivo||'')}</div>`:''}
        ${x.estado==='conciliado'?`<div class="small muted" style="margin-top:4px">Depto ${esc(x.depto)} · ${x.pagos.length} ${x.pagos.length===1?'pago':'pagos'}${Number(x.sobrante)?' · saldo a favor '+clp(x.sobrante):''}</div>`:''}
        ${x.nota&&x.estado!=='pendiente'?`<div class="small muted">${esc(x.nota)}</div>`:''}
        ${adm?`<div class="row acc">${x.estado==='pendiente'?(ab?`${x.sugerido?`<button class="btn sm" data-bok="${x.id}" data-d="${esc(x.sugerido)}">Confirmar ${esc(x.sugerido)}</button>`:''}<button class="btn sec sm" data-botra="${x.id}">${x.sugerido?'Otra unidad':'Asignar a una unidad'}</button><button class="btn sec sm" data-bcaja="${x.id}">Otro ingreso</button>`:`<button class="btn sm" data-bcaja="${x.id}">Registrar egreso</button>`)+`<button class="btn sec sm" data-bign="${x.id}">Ignorar</button>`:`<button class="btn sec sm" data-bdes="${x.id}">Deshacer</button>`}</div>`:''}</div>`; }).join('')||`<div class="empty">${filtro==='pendiente'?'No hay movimientos por conciliar':'Sin movimientos'}</div>`}</div>`;
  const conc=async(id,d)=>{ const r=await q(sb.rpc('conciliar_movimiento',{p_id:id, p_depto:d})); return r; };
  el.onclick=async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-bf]')){ el.dataset.f=b.dataset.bf; panelBanco(el, listo, sigue); }
    else if(t('#bCart')) importarCartola(()=>panelBanco(el, listo, sigue));
    else if(t('#bSug')){ if(!await confirmBox(`Se registrarán los pagos de ${sug.length} ${sug.length===1?'abono':'abonos'} en las unidades sugeridas y se enviarán los comprobantes. ¿Continuar?`)) return; let n=0;
      for(const x of sug){ try{ await conc(x.id,x.sugerido); n++; }catch(err){ toast(`Depto ${x.sugerido}: ${errMsg(err)}`); } } toast(`${n} ${n===1?'abono conciliado':'abonos conciliados'}`); listo(); panelBanco(el, listo, sigue); }
    else if(b=t('[data-bok]')){ try{ const r=await conc(b.dataset.bok,b.dataset.d); toast(Number(r.sobrante)?`Pago registrado · saldo a favor ${clp(r.sobrante)}`:'Pago registrado'); listo(); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-botra]')){ const x=ms.find(y=>y.id===b.dataset.botra); const m=modal(`<h3>Asignar a una unidad</h3><p class="small muted">${fmtDay(x.fecha)} · ${clp(x.monto)} · ${esc(x.glosa)}</p><form id="fBo"><label class="f"><span>Unidad</span><input type="text" name="depto" list="dlBo" required><datalist id="dlBo">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><p class="small muted">La app recordará a este pagador para las próximas cartolas.</p><button class="btn full">Registrar pago</button></form>`);
      $('#fBo',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target).depto.trim(); try{ await conc(x.id,d); closeModal(); toast('Pago registrado'); listo(); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }); }
    else if(b=t('[data-bcaja]')){ const x=ms.find(y=>y.id===b.dataset.bcaja); const m=modal(`<h3>${x.monto>0?'Otro ingreso':'Egreso'}</h3><p class="small muted">${fmtDay(x.fecha)} · ${clp(Math.abs(x.monto))} · ${esc(x.glosa)}</p>${x.monto<0&&fps.some(f=>Number(f.total)===-Number(x.monto))?`<div class="info">¿Es el pago de una factura? ${fps.filter(f=>Number(f.total)===-Number(x.monto)).map(f=>`<button type="button" class="btn sm" data-bfac="${f.id}" style="margin:4px 4px 0 0">${esc(f.emisor)} · nº ${f.folio}</button>`).join('')}<div class="small muted">Se registra un solo egreso y la factura queda pagada. Usa la categoría de abajo.</div></div>`:''}<form id="fBc"><label class="f"><span>Categoría</span><input type="text" name="cat" list="dlBc" required><datalist id="dlBc">${CAT_CAJA.map(c=>`<option value="${c}">`).join('')}</datalist></label><label class="f"><span>Detalle (vacío = la glosa del banco)</span><input type="text" name="nota" placeholder="Proveedor, N° de factura…"></label><button class="btn full">Pasar al flujo de caja</button></form>`);
      m.addEventListener('click', async ev=>{ const fb=ev.target.closest('[data-bfac]'); if(!fb) return; const f=fps.find(y=>y.id===fb.dataset.bfac); const cat=$('[name=cat]',m).value.trim()||f.categoria; if(!cat){ toast('Indica la categoría'); return; }
        try{ await q(sb.rpc('pagar_factura',{p_id:f.id, p_fecha:null, p_categoria:cat, p_banco:x.id})); closeModal(); toast('Factura pagada'); listo(); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } });
      $('#fBc',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('clasificar_movimiento',{p_id:x.id, p_caja:true, p_categoria:d.cat.trim(), p_nota:d.nota.trim()})); closeModal(); toast('Registrado en el flujo de caja'); listo(); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }); }
    else if(b=t('[data-bign]')){ const nota=await askText('¿Por qué se ignora? (por ejemplo, traspaso entre cuentas propias)'); if(nota===null) return; try{ await q(sb.rpc('clasificar_movimiento',{p_id:b.dataset.bign, p_caja:false, p_categoria:'', p_nota:nota})); toast('Movimiento ignorado'); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-bdes]')){ if(!await confirmBox('Se anularán los pagos (o el movimiento de caja) que se registraron con este movimiento, y quedará por conciliar. ¿Deshacer?')) return; try{ await q(sb.rpc('deshacer_movimiento',{p_id:b.dataset.bdes, p_motivo:'Conciliación bancaria deshecha'})); toast('Deshecho'); listo(); panelBanco(el, listo, sigue); }catch(err){ toast(errMsg(err)); } } }; }

// ---------- Facturas de proveedores ----------
const TIPO_DTE={33:'Factura', 34:'Factura exenta', 46:'Factura de compra', 56:'Nota de débito', 61:'Nota de crédito', 0:'Documento'};
const EST_FAC={por_pagar:['Por pagar','wa'], pagada:['Pagada','ok'], anulada:['Anulada','mu']};
// Documentos tributarios electrónicos del SII (XML de un DTE o de un EnvioDTE con varios). Sin dependencias.
async function leerXmlDte(file){ if(file.size>10*1024*1024) throw new Error(file.name+': el archivo es demasiado grande'); const buf=new Uint8Array(await file.arrayBuffer()); const cab=new TextDecoder('latin1').decode(buf.slice(0,200));
  const enc=(cab.match(/encoding=["']([\w-]+)["']/i)||[])[1]||'utf-8'; let txt; try{ txt=new TextDecoder(enc.toLowerCase()).decode(buf); }catch(e){ txt=new TextDecoder('utf-8').decode(buf); }
  const ent=t=>t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,d)=>String.fromCharCode(+d)).trim();
  const tag=(x,n)=>{ const m=x.match(new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`)); return m?ent(m[1]):''; };
  const bloques=[...txt.matchAll(/<(?:\w+:)?Documento\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Documento>/g)].map(m=>m[1]);
  if(!bloques.length) throw new Error(file.name+': no es un XML de factura electrónica del SII');
  return bloques.map(d=>{ const enc2=tag(d,'Encabezado'), em=tag(enc2,'Emisor'), tot=tag(enc2,'Totales'), id=tag(enc2,'IdDoc'), rec=tag(enc2,'Receptor');
    return {tipo_dte:Number(tag(id,'TipoDTE'))||0, folio:Number(tag(id,'Folio'))||0, fecha:tag(id,'FchEmis'), vence:tag(id,'FchVenc')||null, rut_emisor:tag(em,'RUTEmisor'), emisor:tag(em,'RznSoc')||tag(em,'RznSocEmisor'), giro:tag(em,'GiroEmis')||tag(em,'GiroEmisor'),
      receptor:tag(rec,'RznSocRecep'), rut_receptor:tag(rec,'RUTRecep'), neto:Number(tag(tot,'MntNeto'))||0, exento:Number(tag(tot,'MntExe'))||0, iva:Number(tag(tot,'IVA'))||0, total:Number(tag(tot,'MntTotal'))||0,
      detalle:[...d.matchAll(/<(?:\w+:)?Detalle\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Detalle>/g)].map(m=>({item:tag(m[1],'NmbItem'), monto:Number(tag(m[1],'MontoItem'))||0})).slice(0,50)}; }); }
async function panelFacturas(el, listo, sigue=()=>true){ const adm=isAdmin(); let fs=[], pv=[];
  try{ [fs,pv]=await Promise.all([q(T('facturas').select('*').order('fecha',{ascending:false}).limit(2000)), q(T('proveedores').select('id,nombre,rut,rubro').order('nombre'))]); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!sigue()) return;
  const filtro=el.dataset.f||'por_pagar', hoy=todayStr(), pp=fs.filter(f=>f.estado==='por_pagar'), ven=pp.filter(f=>f.vence&&f.vence<hoy), vis=filtro==='todas'?fs:fs.filter(f=>f.estado===filtro);
  const catDe=rut=>fs.find(f=>f.rut_emisor===rut&&f.categoria)?.categoria||pv.find(p=>(p.rut||'').replace(/[^0-9kK]/g,'').toUpperCase()===String(rut).replace(/[^0-9kK]/g,'').toUpperCase())?.rubro||'';
  el.innerHTML=`<p class="small muted">Facturas y boletas de proveedores. Sube el XML que llega del SII (o del correo del proveedor) y la app lee emisor, folio, fecha y montos; también se registran a mano. Al pagarlas pasan al flujo de caja como egreso, y en la cartola un cargo se puede marcar como el pago de una factura.</p>
    <div class="kpi"><div class="k"><b>${clp(pp.reduce((a,f)=>a+Number(f.total),0))}</b><span>Por pagar (${pp.length})</span></div><div class="k"><b style="color:${ven.length?'var(--er)':'inherit'}">${clp(ven.reduce((a,f)=>a+Number(f.total),0))}</b><span>Vencidas (${ven.length})</span></div></div>
    ${adm?'<div class="row wrap" style="margin:12px 0"><label class="btn" style="cursor:pointer">Subir facturas (XML)<input type="file" id="facXml" accept=".xml,text/xml,application/xml" multiple hidden></label><button class="btn sec" id="facMano">Registrar a mano</button></div>':''}
    <div class="tabs" style="margin-bottom:8px">${[['por_pagar',`Por pagar (${pp.length})`],['pagada','Pagadas'],['anulada','Anuladas'],['todas','Todas']].map(([k,v])=>`<button data-ff="${k}" class="${k===filtro?'on':''}">${v}</button>`).join('')}</div>
    <div class="list">${vis.map(f=>`<div class="item static"><div class="hd"><b>${esc(f.emisor||f.rut_emisor)} · ${esc(TIPO_DTE[f.tipo_dte]||'Documento')} nº ${f.folio}</b><span class="row" style="gap:4px">${pillOf(EST_FAC,f.estado)}<b>${clp(f.total)}</b></span></div>
      <div class="meta">${fmtDay(f.fecha)}${f.vence?` · vence ${fmtDay(f.vence)}${f.estado==='por_pagar'&&f.vence<hoy?' <span class="pill er">vencida</span>':''}`:''}${f.categoria?' · '+esc(f.categoria):''}${f.pagada_fecha?' · pagada el '+fmtDay(f.pagada_fecha):''}${Number(f.iva)?` · neto ${clp(f.neto)} + IVA ${clp(f.iva)}`:''}${f.nota?' · '+esc(f.nota):''}</div>
      <div class="row acc">${f.archivo?`<a class="btn sec sm" data-f="${esc(f.archivo)}" target="_blank" rel="noopener">Ver documento</a>`:''}${(f.detalle||[]).length?`<button class="btn sec sm" data-fdet="${f.id}">Detalle</button>`:''}${adm&&f.estado==='por_pagar'?`<button class="btn sm" data-fpag="${f.id}">Registrar pago</button><button class="btn sec sm" data-fanu="${f.id}">Anular</button>`:''}</div></div>`).join('')||'<div class="empty">Sin facturas</div>'}</div>`;
  const guardar=async(docs, archivo)=>{ let n=0, rep=0; for(const d of docs){ try{
      let pid=pv.find(p=>(p.rut||'').replace(/[^0-9kK]/g,'').toUpperCase()===d.rut_emisor.replace(/[^0-9kK]/g,'').toUpperCase())?.id||null;
      if(!pid&&d.crear){ const r=await q(T('proveedores').insert({nombre:d.emisor, rut:d.rut_emisor, rubro:d.giro||d.categoria||''}).select()); pid=r[0]?.id||null; pv.push({id:pid, nombre:d.emisor, rut:d.rut_emisor}); }
      await q(T('facturas').insert({proveedor_id:pid, tipo_dte:d.tipo_dte, folio:d.folio, rut_emisor:d.rut_emisor, emisor:d.emisor, fecha:d.fecha, vence:d.vence||null, neto:d.neto, exento:d.exento, iva:d.iva, total:d.total, detalle:d.detalle||[], categoria:d.categoria||'', archivo:archivo||'', nota:d.nota||''})); n++; }
    catch(err){ if(/duplicate|unique/i.test(errMsg(err))) rep++; else { toast(`${d.emisor} nº ${d.folio}: ${errMsg(err)}`); } } } return {n, rep}; };
  el.onclick=async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-ff]')){ el.dataset.f=b.dataset.ff; panelFacturas(el, listo, sigue); }
    else if(b=t('[data-fdet]')){ const f=fs.find(x=>x.id===b.dataset.fdet); modal(`<h3>${esc(f.emisor)} · nº ${f.folio}</h3><table><tbody>${f.detalle.map(x=>`<tr><td>${esc(x.item)}</td><td class="num">${clp(x.monto)}</td></tr>`).join('')}<tr><th>Total</th><th class="num">${clp(f.total)}</th></tr></tbody></table><div class="center" style="margin-top:10px"><button class="btn sec" data-close>Cerrar</button></div>`); }
    else if(b=t('[data-fanu]')){ const mot=await askText('Motivo de la anulación (por ejemplo, la anuló el proveedor con una nota de crédito)'); if(!mot) return; try{ await q(T('facturas').update({estado:'anulada', nota:mot}).eq('id',b.dataset.fanu)); toast('Factura anulada'); panelFacturas(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-fpag]')){ const f=fs.find(x=>x.id===b.dataset.fpag); const m=modal(`<h3>Pagar ${esc(TIPO_DTE[f.tipo_dte]||'documento').toLowerCase()} nº ${f.folio}</h3><p class="small muted">${esc(f.emisor)} · ${clp(f.total)}. Se registra como egreso en el flujo de caja. Si pagaste por transferencia, también puedes marcarlo desde la cartola (Finanzas → Banco) cuando la importes.</p><form id="fFp"><div class="row"><label class="f grow"><span>Fecha del pago</span><input type="date" name="fecha" value="${hoy}" required></label><label class="f grow"><span>Categoría</span><input type="text" name="cat" list="dlFp" value="${esc(f.categoria||catDe(f.rut_emisor))}" required><datalist id="dlFp">${CAT_CAJA.map(c=>`<option value="${c}">`).join('')}</datalist></label></div><button class="btn full">Registrar pago</button></form>`);
      $('#fFp',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); try{ await q(sb.rpc('pagar_factura',{p_id:f.id, p_fecha:d.fecha, p_categoria:d.cat.trim()})); closeModal(); toast('Pago registrado'); listo(); panelFacturas(el, listo, sigue); }catch(err){ toast(errMsg(err)); } }); }
    else if(t('#facMano')){ const m=modal(`<h3>Registrar factura o boleta</h3><form id="fFm"><div class="row"><label class="f grow"><span>Proveedor</span><select name="prov"><option value="">Otro</option>${pv.map(p=>`<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label><label class="f"><span>Tipo</span><select name="tipo">${[[33,'Factura'],[34,'Factura exenta'],[0,'Boleta u otro']].map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <div class="row"><label class="f grow"><span>Emisor</span><input type="text" name="emisor"></label><label class="f"><span>RUT del emisor</span><input type="text" name="rut" required style="width:140px"></label><label class="f"><span>N°</span><input type="number" name="folio" min="1" required style="width:110px"></label></div>
        <div class="row"><label class="f grow"><span>Fecha</span><input type="date" name="fecha" value="${hoy}" required></label><label class="f grow"><span>Vence</span><input type="date" name="vence"></label><label class="f grow"><span>Total</span><input type="text" inputmode="numeric" data-clp name="total" required></label></div>
        <div class="row"><label class="f grow"><span>Categoría</span><input type="text" name="cat" list="dlFm"><datalist id="dlFm">${CAT_CAJA.map(c=>`<option value="${c}">`).join('')}</datalist></label><label class="f grow"><span>Documento (PDF o foto)</span><input type="file" name="doc" accept="application/pdf,image/*"></label></div><button class="btn full">Registrar</button></form>`);
      const pr=$('[name=prov]',m); pr.addEventListener('change',()=>{ const p=pv.find(x=>x.id===pr.value); if(p){ $('[name=emisor]',m).value=p.nombre; $('[name=rut]',m).value=p.rut||''; if(!$('[name=cat]',m).value) $('[name=cat]',m).value=p.rubro||''; } });
      $('#fFm',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const bt=$('button.full',m); busy(bt,true);
        try{ const f=$('[name=doc]',m).files[0]; const archivo=f?await uploadFile(f,'facturas'):''; const tipo=Number(d.tipo);
          const r=await guardar([{tipo_dte:tipo, folio:Number(d.folio), rut_emisor:d.rut.trim(), emisor:d.emisor.trim(), fecha:d.fecha, vence:d.vence||null, neto:tipo===33?Math.round(Number(d.total)/1.19):0, exento:tipo===33?0:Number(d.total), iva:tipo===33?Number(d.total)-Math.round(Number(d.total)/1.19):0, total:Number(d.total), categoria:d.cat.trim()}], archivo);
          if(r.rep) toast('Esa factura ya estaba registrada'); else if(r.n){ closeModal(); toast('Factura registrada'); panelFacturas(el, listo, sigue); } busy(bt,false); }catch(err){ toast(errMsg(err)); busy(bt,false); } }); } };
  $('#facXml',el)?.addEventListener('change', async e=>{ const files=[...e.target.files]; if(!files.length) return; let docs=[]; const errs=[];
    for(const f of files){ try{ (await leerXmlDte(f)).forEach(d=>docs.push({...d, file:f})); }catch(err){ errs.push(errMsg(err)); } }
    e.target.value=''; if(errs.length) toast(errs[0]);
    const nc=docs.filter(d=>d.tipo_dte===61); docs=docs.filter(d=>d.tipo_dte!==61&&d.folio&&d.total);
    if(!docs.length){ if(nc.length) toast('Las notas de crédito no se importan: anula la factura o registra un ajuste'); return; }
    const ya=d=>fs.some(f=>f.rut_emisor.replace(/[^0-9kK]/g,'').toUpperCase()===d.rut_emisor.replace(/[^0-9kK]/g,'').toUpperCase()&&Number(f.folio)===Number(d.folio)&&Number(f.tipo_dte)===Number(d.tipo_dte));
    const conocido=d=>pv.some(p=>(p.rut||'').replace(/[^0-9kK]/g,'').toUpperCase()===d.rut_emisor.replace(/[^0-9kK]/g,'').toUpperCase());
    const m=modal(`<h3>Facturas leídas (${docs.length})</h3>${nc.length?`<div class="note">${nc.length} ${nc.length===1?'nota de crédito no se importa':'notas de crédito no se importan'}: anula la factura que corrigen o registra un ajuste.</div>`:''}
      <div style="overflow:auto"><table><thead><tr><th></th><th>Emisor</th><th>Documento</th><th class="num">Total</th><th>Categoría</th></tr></thead><tbody>${docs.map((d,i)=>`<tr><td><input type="checkbox" data-fi="${i}" ${ya(d)?'disabled':'checked'}></td><td>${esc(d.emisor)}<br><span class="small muted">${esc(d.rut_emisor)}${conocido(d)?'':' · proveedor nuevo'}</span>${d.receptor?`<br><span class="small muted">a nombre de ${esc(d.receptor)}</span>`:''}</td><td>${esc(TIPO_DTE[d.tipo_dte]||'Documento')} nº ${d.folio}<br><span class="small muted">${fmtDay(d.fecha)}${ya(d)?' · <b>ya registrada</b>':''}</span></td><td class="num">${clp(d.total)}</td><td><input type="text" data-fc="${i}" list="dlFx" value="${esc(catDe(d.rut_emisor))}" style="width:150px"></td></tr>`).join('')}</tbody></table></div><datalist id="dlFx">${CAT_CAJA.map(c=>`<option value="${c}">`).join('')}</datalist>
      <label class="sw" style="margin:10px 0"><input type="checkbox" id="fxCrear" checked> Agregar a Proveedores los emisores nuevos</label><p class="small muted">Revisa que estén a nombre de la comunidad. Las ya registradas se omiten.</p><button class="btn full" id="fxOk">Registrar las marcadas</button>`);
    $('#fxOk',m).addEventListener('click', async()=>{ const sel=docs.map((d,i)=>({...d, categoria:$(`[data-fc="${i}"]`,m).value.trim(), crear:$('#fxCrear',m).checked, ok:$(`[data-fi="${i}"]`,m).checked})).filter(d=>d.ok); if(!sel.length){ toast('No hay facturas marcadas'); return; }
      const b=$('#fxOk',m); busy(b,true); let n=0, rep=0;
      for(const f of [...new Set(sel.map(d=>d.file))]){ let archivo=''; try{ archivo=await uploadFile(f,'facturas'); }catch(err){} const r=await guardar(sel.filter(d=>d.file===f), archivo); n+=r.n; rep+=r.rep; }
      closeModal(); toast(`${n} ${n===1?'factura registrada':'facturas registradas'}${rep?` · ${rep} ya estaban`:''}`); panelFacturas(el, listo, sigue); }); }); }

// ---------- Presupuesto anual ----------
const MESES_C=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
// Gasto real por categoría y mes: los ítems de los períodos publicados de ese año
function realPorCategoria(gastos, anio){ const R={}; gastos.filter(g=>g.publicado&&g.periodo.startsWith(anio+'-')).forEach(g=>{ const i=Number(g.periodo.slice(5,7))-1; (g.items||[]).forEach(it=>{ const k=(it.categoria||'Otros').trim(); (R[k]=R[k]||Array(12).fill(0))[i]+=Number(it.monto)||0; }); }); return R; }
async function panelPresupuesto(el, D, sigue=()=>true){ const adm=isAdmin(); const anio=Number(el.dataset.anio)||new Date().getFullYear(); let ps=[];
  try{ ps=await q(T('presupuestos').select('*').eq('anio',anio).order('categoria')); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!sigue()) return;
  const R=realPorCategoria(D.gastos, anio), P={}; ps.forEach(p=>P[p.categoria]=p.montos.map(Number));
  const pubs=D.gastos.filter(g=>g.publicado&&g.periodo.startsWith(anio+'-')).map(g=>Number(g.periodo.slice(5,7)));
  const cats=[...new Set([...Object.keys(P),...Object.keys(R)])].sort((a,b)=>(P[b]?1:0)-(P[a]?1:0)||a.localeCompare(b));
  const sum=a=>(a||[]).reduce((x,y)=>x+y,0), enPub=a=>(a||[]).reduce((x,y,i)=>x+(pubs.includes(i+1)?y:0),0);   // solo los meses ya publicados
  const fila=k=>{ const pa=sum(P[k]), pf=enPub(P[k]), rf=enPub(R[k]), d=rf-pf, pct=pf?Math.round(d/pf*100):null; return {k, pa, pf, rf, d, pct}; };
  const fs=cats.map(fila), T_=fs.reduce((a,f)=>({pa:a.pa+f.pa, pf:a.pf+f.pf, rf:a.rf+f.rf}),{pa:0,pf:0,rf:0});
  const dif=(d,pct)=>`<span style="color:${d>0?'var(--er)':d<0?'var(--ok)':'inherit'}">${d>0?'+':d<0?'−':''}${clp(Math.abs(d))}${pct!=null?` (${d>0?'+':pct<0?'−':''}${Math.abs(pct)} %)`:''}</span>`;
  el.innerHTML=`<div class="row wrap" style="margin-bottom:10px"><button class="btn sec sm" data-pa="${anio-1}">← ${anio-1}</button><b style="font-size:18px">${anio}</b><button class="btn sec sm" data-pa="${anio+1}">${anio+1} →</button><span class="grow"></span>${adm?'<button class="btn" id="bPre">Editar presupuesto</button>':''}</div>
    ${!ps.length?`<div class="note">No hay presupuesto para ${anio}.${adm?' Créalo con "Editar presupuesto"; puedes partir de lo gastado el año anterior.':''}</div>`:''}
    <div class="kpi"><div class="k"><b>${clp(T_.pa)}</b><span>Presupuesto ${anio}</span></div><div class="k"><b>${clp(T_.rf)}</b><span>Gastado en ${anio}</span></div><div class="k"><b>${dif(T_.rf-T_.pf, T_.pf?Math.round((T_.rf-T_.pf)/T_.pf*100):null)}</b><span>Diferencia con lo presupuestado para esos meses</span></div></div>
    <div class="card" style="overflow:auto;margin-top:12px"><table><thead><tr><th>Categoría</th><th class="num">Presupuesto anual</th><th class="num">Presupuesto a la fecha</th><th class="num">Real a la fecha</th><th class="num">Diferencia</th></tr></thead><tbody>${fs.map(f=>`<tr><td>${esc(f.k)}${!P[f.k]?' <span class="pill wa">sin presupuesto</span>':''}</td><td class="num">${clp(f.pa)}</td><td class="num">${clp(f.pf)}</td><td class="num">${clp(f.rf)}</td><td class="num">${dif(f.d,f.pct)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sin datos</td></tr>'}</tbody></table></div>
    <p class="small muted">"Real" son los ítems de los gastos comunes publicados de ${anio}, por categoría; "a la fecha" compara solo los meses ya publicados${pubs.length?` (${pubs.sort((a,b)=>a-b).map(i=>MESES_C[i-1].toLowerCase()).join(', ')})`:''}. Para comparar bien, usa los mismos nombres de categoría en el presupuesto y en los gastos comunes.</p>`;
  el.onclick=e=>{ const b=e.target.closest('[data-pa]'); if(b){ el.dataset.anio=b.dataset.pa; panelPresupuesto(el, D, sigue); return; } if(e.target.closest('#bPre')) editarPresupuesto(anio, ps, D, ()=>panelPresupuesto(el, D, sigue)); }; }
function editarPresupuesto(anio, ps, D, listo){
  const filas=ps.map(p=>({categoria:p.categoria, montos:p.montos.map(Number)}));
  const m=modal(`<h3>Presupuesto ${anio}</h3><p class="small muted">Un monto por mes para cada categoría. Si es igual todo el año, escríbelo en "Mensual". Abre el detalle para meses distintos (por ejemplo, calefacción en invierno).</p><div id="peFilas"></div>
    <div class="row wrap" style="margin:8px 0"><button type="button" class="btn sec sm" id="peAdd">Agregar categoría</button><button type="button" class="btn sec sm" id="peAnt">Partir de lo gastado en ${anio-1}</button></div><button class="btn full" id="peOk">Guardar presupuesto</button>`);
  const pinta=()=>{ $('#peFilas',m).innerHTML=filas.map((f,i)=>{ const igual=f.montos.every(x=>x===f.montos[0]);
    return `<div class="card" style="padding:10px;margin-bottom:8px"><div class="row wrap"><label class="f grow"><span>Categoría</span><input type="text" data-pc="${i}" value="${esc(f.categoria)}" list="dlPe"></label><label class="f"><span>Mensual</span><input type="text" inputmode="numeric" data-clp data-pm="${i}" value="${igual?Math.round(f.montos[0]):''}" placeholder="${igual?'':'varía'}" style="width:130px"></label><button type="button" class="btn sec sm" data-pdel="${i}" aria-label="Quitar">✕</button></div>
      <details><summary class="small">Detalle por mes · total ${clp(f.montos.reduce((a,b)=>a+b,0))}</summary><div class="grid2" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">${f.montos.map((x,j)=>`<label class="f"><span>${MESES_C[j]}</span><input type="text" inputmode="numeric" data-clp data-pmm="${i}:${j}" value="${Math.round(x)}"></label>`).join('')}</div></details></div>`; }).join('')+`<datalist id="dlPe">${[...new Set([...CAT_CAJA,...Object.keys(realPorCategoria(D.gastos, anio-1))])].map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`; };
  const num=v=>Number(String(v).replace(/[^0-9]/g,''))||0;
  m.addEventListener('change',e=>{ const t=e.target; if(t.dataset.pc!=null) filas[+t.dataset.pc].categoria=t.value.trim();
    else if(t.dataset.pm!=null){ if(t.value.trim()==='') return; filas[+t.dataset.pm].montos=Array(12).fill(num(t.value)); pinta(); }
    else if(t.dataset.pmm){ const [i,j]=t.dataset.pmm.split(':').map(Number); filas[i].montos[j]=num(t.value); pinta(); } });
  m.addEventListener('click',e=>{ const b=e.target.closest('[data-pdel]'); if(b){ filas.splice(+b.dataset.pdel,1); pinta(); } });
  $('#peAdd',m).addEventListener('click',()=>{ filas.push({categoria:'', montos:Array(12).fill(0)}); pinta(); });
  $('#peAnt',m).addEventListener('click',()=>{ const R=realPorCategoria(D.gastos, anio-1); if(!Object.keys(R).length){ toast(`No hay gastos publicados de ${anio-1}`); return; }
    Object.entries(R).forEach(([k,v])=>{ const f=filas.find(x=>x.categoria===k); const prom=Math.round(v.reduce((a,b)=>a+b,0)/Math.max(1,v.filter(x=>x).length)); if(f) f.montos=Array(12).fill(prom); else filas.push({categoria:k, montos:Array(12).fill(prom)}); }); pinta(); toast('Se cargó el promedio mensual de '+(anio-1)); });
  $('#peOk',m).addEventListener('click', async()=>{ const ok=filas.filter(f=>f.categoria); if(new Set(ok.map(f=>f.categoria)).size!==ok.length){ toast('Hay categorías repetidas'); return; }
    try{ const quitar=ps.filter(p=>!ok.some(f=>f.categoria===p.categoria)).map(p=>p.categoria);
      if(quitar.length) await q(T('presupuestos').delete().eq('anio',anio).in('categoria',quitar));
      if(ok.length) await q(T('presupuestos').upsert(ok.map(f=>({anio, categoria:f.categoria, montos:f.montos, actualizado:new Date().toISOString()}))));
      closeModal(); toast('Presupuesto guardado'); listo(); }catch(err){ toast('Error: '+errMsg(err)); } });
  pinta(); }

// ---------- Rendición de cuentas mensual ----------
async function panelRendicion(el, X, sigue=()=>true){ const {D, movs, fondos, fmov}=X; const mes=el.dataset.mes||monthStr(); const [y,mm]=mes.split('-').map(Number);
  const ini=mes+'-01', fin=new Date(y,mm,0).toISOString().slice(0,10), enMes=f=>f>=ini&&f<=fin;
  let banco=[], pre=[]; try{ [banco,pre]=await Promise.all([q(T('banco_movimientos').select('estado,monto,fecha').lte('fecha',fin)).catch(()=>[]), q(T('presupuestos').select('*').eq('anio',y)).catch(()=>[])]); }catch(e){}
  if(!sigue()) return;
  const g=D.G[mes], items=g?.publicado?(g.items||[]):[], emitido=Object.values(D.U).flatMap(z=>z.rows).filter(r=>r.periodo===mes).reduce((a,r)=>a+Number(r.monto),0);
  const pagosMes=D.pagos.filter(p=>enCaja(p)&&enMes(p.fecha)), gcMes=pagosMes.reduce((a,p)=>a+Number(p.monto),0);
  const recPer=D.pagos.filter(p=>enCaja(p)&&p.periodo===mes&&p.concepto!=='interes').reduce((a,p)=>a+Number(p.monto),0);
  const porCat=t=>{ const o={}; movs.filter(x=>x.tipo===t&&enMes(x.fecha)).forEach(x=>o[x.categoria||'Otros']=(o[x.categoria||'Otros']||0)+Number(x.monto)); return o; };
  const ing=porCat('ingreso'), egr=porCat('egreso');
  const saldoAl=f=>D.pagos.filter(p=>enCaja(p)&&p.fecha<=f).reduce((a,p)=>a+Number(p.monto),0)+movs.filter(x=>x.fecha<=f).reduce((a,x)=>a+(x.tipo==='egreso'?-1:1)*Number(x.monto),0);
  const prevFin=new Date(y,mm-1,0).toISOString().slice(0,10), sIni=saldoAl(prevFin), sFin=saldoAl(fin);
  const fondoEn=(f,hasta)=>Number(f.saldo_inicial)+fmov.filter(v=>v.fondo_id===f.id&&v.fecha<=hasta).reduce((a,v)=>a+(v.tipo==='uso'?-1:1)*Number(v.monto),0);
  const fondoMes=(f,t)=>fmov.filter(v=>v.fondo_id===f.id&&v.tipo===t&&enMes(v.fecha)).reduce((a,v)=>a+Number(v.monto),0);
  const us=Object.values(D.U), morosos=us.filter(z=>z.vencido>0).sort((a,b)=>b.vencido-a.vencido);
  const R=realPorCategoria(D.gastos, y), P={}; pre.forEach(p=>P[p.categoria]=p.montos.map(Number)); const catsP=[...new Set([...Object.keys(P),...Object.keys(R)])].sort();
  const bp=banco.filter(b=>b.estado==='pendiente');
  const cuerpo=`<h2>1. Gastos comunes de ${esc(fmtMonth(mes))}</h2>${items.length?`<table><thead><tr><th>Ítem</th><th class="num">Monto</th></tr></thead><tbody>${items.map(it=>`<tr><td>${esc(it.categoria||'')}${it.descripcion?' · '+esc(it.descripcion):''}</td><td class="num">${clp(it.monto)}</td></tr>`).join('')}<tr><th>Total</th><th class="num">${clp(g.total)}</th></tr></tbody></table>
      <p>Emitido a las unidades: <b>${clp(emitido)}</b> · recaudado de este período a la fecha: <b>${clp(recPer)}</b> (${emitido?Math.round(recPer/emitido*100):0} %).</p>`:'<p class="muted">El período no está publicado.</p>'}
    <h2>2. Ingresos y egresos del mes</h2><table><tbody><tr><td>Saldo de caja al inicio del mes</td><td class="num">${clp(sIni)}</td></tr><tr><td>Pagos de gastos comunes recibidos (${pagosMes.length})</td><td class="num">${clp(gcMes)}</td></tr>${Object.entries(ing).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>Otro ingreso: ${esc(k)}</td><td class="num">${clp(v)}</td></tr>`).join('')}
      ${Object.entries(egr).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>Egreso: ${esc(k)}</td><td class="num">−${clp(v)}</td></tr>`).join('')}<tr><th>Saldo de caja al cierre</th><th class="num">${clp(sFin)}</th></tr></tbody></table>
    <h2>3. Fondos</h2>${fondos.length?`<table><thead><tr><th>Fondo</th><th class="num">Saldo inicial</th><th class="num">Aportes</th><th class="num">Usos</th><th class="num">Saldo al cierre</th></tr></thead><tbody>${fondos.map(f=>`<tr><td>${esc(f.nombre)}</td><td class="num">${clp(fondoEn(f,prevFin))}</td><td class="num">${clp(fondoMes(f,'aporte'))}</td><td class="num">${clp(fondoMes(f,'uso'))}</td><td class="num">${clp(fondoEn(f,fin))}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Sin fondos.</p>'}
    <h2>4. Morosidad (hoy)</h2><p>Por cobrar ${clp(us.reduce((a,z)=>a+z.deuda,0))} · vencido ${clp(us.reduce((a,z)=>a+z.vencido,0))} · en convenio ${clp(us.reduce((a,z)=>a+z.convenio,0))} · ${morosos.length} ${morosos.length===1?'unidad morosa':'unidades morosas'}.</p>
      ${morosos.length?`<table><thead><tr><th>Unidad</th><th class="num">Vencido</th><th class="num">Deuda total</th></tr></thead><tbody>${morosos.map(z=>`<tr><td>${esc(z.depto)}</td><td class="num">${clp(z.vencido)}</td><td class="num">${clp(z.deuda)}</td></tr>`).join('')}</tbody></table>`:''}
    <h2>5. Presupuesto ${y}</h2>${catsP.length?`<table><thead><tr><th>Categoría</th><th class="num">Presupuesto del mes</th><th class="num">Real del mes</th><th class="num">Presupuesto a la fecha</th><th class="num">Real a la fecha</th></tr></thead><tbody>${catsP.map(k=>{ const p=P[k]||Array(12).fill(0), r=R[k]||Array(12).fill(0); const s=a=>a.slice(0,mm).reduce((x,z)=>x+z,0); return `<tr><td>${esc(k)}</td><td class="num">${clp(p[mm-1])}</td><td class="num">${clp(r[mm-1])}</td><td class="num">${clp(s(p))}</td><td class="num">${clp(s(r))}</td></tr>`; }).join('')}</tbody></table>`:'<p class="muted">Sin presupuesto.</p>'}
    <h2>6. Conciliación bancaria</h2><p>${banco.length?(bp.length?`${bp.length} movimientos de la cartola hasta el ${fmtDay(fin)} están sin conciliar, por ${clp(bp.reduce((a,b)=>a+Number(b.monto),0))} neto.`:'Todos los movimientos importados de la cartola están conciliados.'):'No se ha importado la cartola bancaria.'}</p>`;
  el.innerHTML=`<div class="row wrap" style="margin-bottom:10px"><label class="f" style="margin:0"><span>Mes</span><select id="rnMes" style="width:auto">${opcionesMes(mes,{atras:24,adelante:0})}</select></label><span class="grow"></span><button class="btn" id="bRnImp">Imprimir</button></div>
    <p class="small muted">Resumen mensual para rendir cuenta a la comunidad y al comité: gastos del período, ingresos y egresos, fondos, morosidad, presupuesto y conciliación bancaria. Adjunta las boletas y facturas del mes.</p><div class="card rendicion">${cuerpo}</div>`;
  $('#rnMes',el).addEventListener('change',e=>{ el.dataset.mes=e.target.value; panelRendicion(el, X, sigue); });
  $('#bRnImp',el).addEventListener('click', async()=>{ const c=S.cfg||{}; imprimir('rendicion-'+mes, `${await cabeceraImpresion()}<h1>Rendición de cuentas · ${esc(fmtMonth(mes))}</h1><p class="sub">Emitida el ${fmtDay(todayStr())}</p>${cuerpo}<p style="margin-top:40px">______________________________ &nbsp; &nbsp; ______________________________<br>Administración · ${esc(c.nombre||'')} &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Comité de administración</p>`); }); }

VIEWS.finanzas = function(param){
  const adm=isAdmin(); const TABS={estado:'Estado',pagos:'Pagos',convenios:'Convenios',cargos:'Cargos',fondos:'Fondos',caja:'Flujo de caja',facturas:'Facturas',banco:'Banco',presupuesto:'Presupuesto',rendicion:'Rendición',suspension:'Suspensión de luz',certificados:'Certificados'};
  let tab=TABS[param]?param:'estado', D=null, movs=[], anio=new Date().getFullYear(), cargos=[], fondos=[], fmov=[], saldos=[], verAnul=false;
  setMain(`<h1>Finanzas</h1><div class="tabs" id="fTabs">${Object.entries(TABS).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="fBody"><div class="empty">Cargando…</div></div>`);
  const w=watch(['gastos','gasto_unidades','pagos','convenios','convenio_cuotas','caja_movimientos','cargos','fondos','fondo_movimientos','suspensiones','suspension_votos','suspension_eventos','condiciones_especiales'], async()=>{ const [d,mv,cg,fo,fm,sd]=await Promise.all([finDatos(), q(T('caja_movimientos').select('*').order('fecha',{ascending:false}).limit(5000)), q(T('cargos').select('*').order('ts',{ascending:false}).limit(2000)), q(T('fondos').select('*').order('creado')), q(T('fondo_movimientos').select('*').order('fecha',{ascending:false}).limit(2000)), q(sb.rpc('saldos_fondos')).catch(()=>[])]); return {d,mv,cg,fo,fm,sd}; },
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
    else if(tab==='suspension'){ panelSuspension(el, listo, ()=>tab==='suspension'); }
    else if(tab==='certificados'){ panelCertificados(el, ()=>tab==='certificados'); }
    else if(tab==='banco'){ panelBanco(el, listo, ()=>tab==='banco'); }
    else if(tab==='facturas'){ panelFacturas(el, listo, ()=>tab==='facturas'); }
    else if(tab==='presupuesto'){ panelPresupuesto(el, D, ()=>tab==='presupuesto'); }
    else if(tab==='rendicion'){ panelRendicion(el, {D, movs, fondos, fmov}, ()=>tab==='rendicion'); }
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
    $('#espInfo').innerHTML=`Capacidad ${esc(e.capacidad||'-')} · ${esc(e.desde)}–${esc(e.hasta)} · máx ${esc(e.maxHoras)} h · hasta ${esc(e.anticipacionDias)} días de anticipación · ${e.aprobacion?'requiere aprobación':'confirmación inmediata'}${e.costo?' · costo '+clp(e.costo)+' (se suma a tu gasto común)':''}`;
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
  const puede=['comite','admin'].includes(role()), resid=['residente','propietario'].includes(role());
  setMain(`<h1>Comunicados</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewC">+ Nuevo comunicado</button></div>':''}<div id="cList" class="list"></div>`);
  $('#bNewC')?.addEventListener('click',()=>formComunicado());
  let docs=[], lec=[], marcados=new Set();
  const nUnid=()=>Object.keys(S.unidades).length;
  watch(['comunicados','comunicado_lecturas'], async()=>{ const [a,b]=await Promise.all([q(T('comunicados').select('*').order('ts',{ascending:false}).limit(100)), q(T('comunicado_lecturas').select('*')).catch(()=>[])]); return {a,b}; }, ({a,b})=>{ docs=a; lec=b; const el=$('#cList'); if(!el) return;
    el.innerHTML=docs.map(c=>{ const ls=lec.filter(x=>x.comunicado_id===c.id), mio=ls.find(x=>x.uid===S.uid), deps=new Set(ls.filter(x=>x.depto&&(!c.importante||x.confirmado)).map(x=>x.depto));
      return `<div class="item static" ${c.importante&&resid&&!mio?.confirmado?'style="border-color:var(--er)"':''}><div class="hd"><b>${esc(c.titulo)}</b><span class="row" style="gap:4px">${c.importante?'<span class="pill er">Importante</span>':''}<span class="muted small">${fmtDate(c.ts)}</span></span></div><div style="margin-top:6px;white-space:pre-wrap">${esc(c.cuerpo)}</div>
        <div class="meta">${esc(ROLES[c.rol]||'')} · ${esc(userName(c.uid))}${c.adjunto?` · <a data-f="${esc(c.adjunto)}" target="_blank">Adjunto</a>`:''}${c.por_correo?' · enviado por correo':''}${puede?` · <a href="#" data-ed="${c.id}">Editar</a> · <a href="#" data-del="${c.id}">Eliminar</a>`:''}</div>
        ${puede?`<div class="row acc"><button class="btn sec sm" data-lec="${c.id}">${c.importante?'Confirmado':'Leído'} por ${deps.size} de ${nUnid()} unidades</button></div>`:''}
        ${resid&&c.importante?(mio?.confirmado?`<div class="small muted" style="margin-top:6px">✓ Confirmaste la lectura el ${fmtDate(mio.ts)}</div>`:`<div class="row acc"><button class="btn sm" data-ok="${c.id}">Lo leí</button></div>`):''}</div>`; }).join('')||'<div class="empty">Sin comunicados</div>';
    // quien abre la lista deja registrada la lectura (una vez por comunicado)
    const nuevos=docs.filter(c=>!marcados.has(c.id)&&!lec.some(x=>x.comunicado_id===c.id&&x.uid===S.uid)).map(c=>c.id); nuevos.forEach(id=>marcados.add(id));
    if(nuevos.length&&role()!=='mantencion') sb.rpc('marcar_leidos',{p_ids:nuevos}).then(()=>{},()=>{}); });
  $('#cList').addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    if(b=t('[data-ed]')){ e.preventDefault(); formComunicado(docs.find(x=>x.id===b.dataset.ed)); }
    else if(b=t('[data-del]')){ e.preventDefault(); if(await confirmBox('¿Eliminar comunicado?')) await q(T('comunicados').delete().eq('id',b.dataset.del)); }
    else if(b=t('[data-ok]')){ try{ await q(sb.rpc('marcar_leidos',{p_ids:[b.dataset.ok], p_confirmar:true})); toast('Lectura confirmada'); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-lec]')){ const c=docs.find(x=>x.id===b.dataset.lec), ls=await q(T('comunicado_lecturas').select('*').eq('comunicado_id',c.id)).catch(()=>lec.filter(x=>x.comunicado_id===c.id)); const ok=new Set(ls.filter(x=>x.depto&&(!c.importante||x.confirmado)).map(x=>x.depto));
      const faltan=Object.keys(S.unidades).sort(porNum).filter(d=>!ok.has(d)), quien=ls.filter(x=>x.depto).sort((a,b)=>porNum(a.depto,b.depto));
      modal(`<h3>${esc(c.titulo)}</h3><p class="small muted">${c.importante?'Unidades que confirmaron la lectura (alguien de la unidad marcó "Lo leí").':'Unidades donde alguien abrió el comunicado en la app.'} ${c.por_correo?'También se envió por correo; el correo no registra lectura.':''}</p>
        <h3>${c.importante?'Sin confirmar':'Sin leer'} (${faltan.length})</h3><p>${faltan.map(d=>`<span class="pill mu" style="margin:2px">${esc(d)}</span>`).join('')||'Ninguna'}</p>
        <h3>Lecturas (${quien.length})</h3><div class="list">${quien.map(x=>`<div class="item static"><div class="hd"><b>Depto ${esc(x.depto)} · ${esc(S.users[x.uid]?.nombre||'')}</b><span class="muted small">${fmtDate(x.ts)}</span></div>${c.importante?`<div class="meta">${x.confirmado?'Confirmó':'Lo abrió sin confirmar'}</div>`:''}</div>`).join('')||'<div class="empty">Nadie aún</div>'}</div><div class="center" style="margin-top:10px"><button class="btn sec" data-close>Cerrar</button></div>`); } });
};
function formComunicado(c={}){
  const m=modal(`<h3>${c.id?'Editar':'Nuevo'} comunicado</h3><form id="fC"><label class="f"><span>Título</span><input type="text" name="titulo" value="${esc(c.titulo||'')}" required></label><label class="f"><span>Mensaje</span><textarea name="cuerpo" required style="min-height:140px">${esc(c.cuerpo||'')}</textarea></label><label class="f"><span>Adjunto (PDF o imagen, opcional)</span><input type="file" name="adj" accept="application/pdf,image/*"></label>
  <label class="sw" style="margin-bottom:8px"><input type="checkbox" name="por_correo" ${c.por_correo?'checked disabled':''}> Enviar también por correo a toda la comunidad${c.por_correo?' (ya se envió)':''}</label>
  <label class="sw" style="margin-bottom:12px"><input type="checkbox" name="importante" ${c.importante?'checked':''}> Importante: pedir a cada unidad que confirme la lectura</label><button class="btn full">Publicar</button></form>`);
  $('#fC',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ let adjunto=c.adjunto||''; const f=$('[name=adj]',m).files[0]; if(f) adjunto=await uploadFile(f,'comunicados'); const ext={importante:!!d.importante, por_correo:!!c.por_correo||!!d.por_correo}; if(c.id) await q(T('comunicados').update({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, editado:now(), ...ext}).eq('id',c.id)); else await q(T('comunicados').insert({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, uid:S.uid, rol:realRole(), ...ext})); closeModal(); toast('Publicado'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
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
  setMain(`<h1>Encomiendas</h1>${!resid?`<div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bNewE">+ Registrar encomienda</button><button class="btn sec" id="bTelE">📞 Teléfono de una unidad</button></div>`:''}<div class="tabs" id="eTabs"><button data-t="pend" class="on">Por retirar</button><button data-t="ent">Entregadas</button></div><div id="eList" class="list"></div>`);
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
  setMain(`<h1>Visitas</h1><div class="row wrap" style="margin-bottom:10px"><button class="btn" id="bNewV">+ ${resid?'Anunciar visita':'Registrar visita'}</button>${resid?'':`<button class="btn sec" id="bScan">📷 Escanear QR</button><button class="btn sec" id="bTelV">📞 Teléfono de una unidad</button><input type="text" id="vCode" placeholder="o código de la visita" style="width:190px" autocapitalize="characters" autocomplete="off"><button class="btn sec" id="bVCode">Buscar</button>`}</div>${resid?'<div id="vEst"></div>':''}${resid?'<p class="small muted">Al anunciar una visita obtienes un QR para enviarle. En conserjería lo escanean y queda registrado su ingreso.</p>':''}<div class="tabs" id="vTabs"><button data-t="hoy" class="on">Hoy</button><button data-t="prox">Próximas</button><button data-t="hist">Historial</button></div><div id="vList" class="list"></div>`);
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
  const drawActs=()=>{ const g=$('#actGrid'); if(g) g.innerHTML=activos().map(a=>`<div class="tile" data-act="${a.id}" style="cursor:pointer"><span class="ic">${esc(a.icono||'📍')}</span><b>${esc(a.nombre)}</b><small>${esc(a.ubicacion||'')}</small></div>`).join('')||'<div class="muted">Sin activos. Créalos en Administración → Activos.</div>'; };
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
    ${e.hayNueva?`<div class="info">Hay una versión nueva: <b>${esc(e.ultima.version)}</b>. <a href="${esc(urlSegura(e.ultima.pagina))}" target="_blank" rel="noopener">Ver qué cambia</a></div>
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
      :'<div class="note">Hoy la app solo funciona en este computador. Por seguridad no se atiende por la red del edificio sin cifrar: para que residentes y conserjes entren desde sus teléfonos o desde otro computador (también dentro del edificio), y para usar la cámara y las notificaciones, activa esta dirección segura (HTTPS).</div>';
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
  const tabs={edificio:'Edificio',usuarios:'Usuarios',unidades:'Unidades',espacios:'Espacios',estacionamientos:'Estacionamientos',activos:'Activos',empresas:'Empresas',plantillas:'Plantillas',datos:'Datos personales'};
  let tab = tabs[param]? param : (tabs[S._adminTab]? S._adminTab : 'edificio');
  setMain(`<h1>Administración</h1><div class="tabs" id="aTabs">${Object.entries(tabs).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="aBody"></div>`);
  $('#aTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#aTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; S._adminTab=tab; draw(); });
  const draw=()=>{ const old=$('#aBody'); if(!old) return; const el=old.cloneNode(false); old.replaceWith(el); ADMIN[tab](el); }; draw();
  REFRESH.admin=()=>{ if(!['edificio','plantillas'].includes(tab)) draw(); };
};
const ADMIN={};
// ---------- Seguridad de la instalación local ----------
async function tarjetaSeguridad(){ const el=$('#segBody'); if(!el) return; let s; try{ s=await q(sb.local.seguridad()); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!$('#segBody')) return;
  const fila=(ok,t,d)=>`<div class="item static"><div class="hd"><b>${ok===true?'✅':ok===false?'⚠️':'❔'} ${t}</b></div><div class="meta">${d}</div></div>`;
  el.innerHTML=`<div class="list">
    ${fila(s.https,'Acceso seguro (HTTPS)', s.https?'Desde otros equipos se entra solo por la dirección segura. La red local sin cifrar está bloqueada.':'Sin él, la app solo se puede usar en este computador. Actívalo en "Acceso desde internet", más abajo.')}
    ${fila(s.admins2===s.admins&&s.admins>0,'Verificación en dos pasos de la administración',`${s.admins2} de ${s.admins} ${s.admins===1?'cuenta':'cuentas'} de administración${s.comite?` y ${s.comite2} de ${s.comite} del comité`:''} la tienen activa. Cada persona la activa en Mi cuenta.`)}
    ${fila(s.respaldo&&s.respaldoOk,'Respaldo cifrado en la nube', s.respaldo?(s.respaldoOk?'Configurado y funcionando.':'Configurado, pero el último respaldo no terminó bien. Revísalo más abajo.'):'Sin respaldo, si este computador falla o lo roban se pierde todo. Configúralo más abajo.')}
    ${fila(s.llave==='dpapi'?true:s.llave==='archivo'?(s.sistema==='win32'?null:true):false,'Claves de la configuración cifradas', s.llave==='dpapi'?'La contraseña del correo, el token del túnel y las demás claves están cifradas con una llave protegida por tu cuenta de Windows.':s.llave==='archivo'?'Las claves están cifradas con una llave guardada fuera de la carpeta de datos'+(s.sistema==='win32'?', pero Windows no permitió protegerla con la cuenta de usuario (DPAPI).':'.'):'No se pudo leer la llave: '+esc(s.llaveError||'')+'. Vuelve a configurar el correo, el túnel y el respaldo.')}
    ${fila(s.disco==='cifrado'?true:s.disco==='sin cifrar'?false:null,'Disco cifrado', s.disco==='cifrado'?'El disco donde están los datos está cifrado (BitLocker): si se llevan el computador o el disco, no pueden leerlos.':`${s.disco==='sin cifrar'?'El disco donde están los datos no está cifrado.':'No se pudo comprobar si el disco está cifrado.'} Si se llevan el computador o sacan el disco, podrían leer la base de datos, las fotos y los documentos.`)}
  </div>
  <details style="margin-top:10px"><summary><b>Cómo proteger este computador</b></summary><ol class="small" style="padding-left:18px;line-height:1.5">
    <li><b>Cifra el disco.</b> Windows 10/11 Pro: Configuración → Privacidad y seguridad → Cifrado de dispositivo, o busca "Administrar BitLocker" → Activar BitLocker en la unidad C:. Windows Home: Configuración → Privacidad y seguridad → <i>Cifrado de dispositivo</i> (si aparece). Guarda la clave de recuperación fuera del computador.</li>
    <li><b>Usa una cuenta de Windows solo para Mi Edificio</b>, con contraseña, y no la uses para navegar ni instalar programas. Si conserjería usa el mismo computador, que tenga su propia cuenta de Windows sin permisos de administrador.</li>
    <li><b>Bloqueo de pantalla</b> automático a los pocos minutos (Windows + L al alejarse).</li>
    <li><b>Mantén Windows actualizado</b> y el antivirus (Microsoft Defender) activo.</li>
    <li><b>No compartas</b> la carpeta de datos ni la copies a pendrives; para eso está el respaldo cifrado.</li></ol></details>`; }

// ---------- Correo saliente ----------
const EST_COR={pendiente:['Pendiente','wa'], enviado:['Enviado','ok'], error:['Con error','er'], descartado:['Descartado','mu']};
const SMTP_AYUDA={
  gmail:'En la cuenta de Google del edificio activa la verificación en 2 pasos y crea una <b>contraseña de aplicación</b> (Cuenta de Google → Seguridad → Contraseñas de aplicaciones). Pega aquí esa contraseña de 16 letras, no la contraseña normal. Gmail gratuito permite unos 500 correos al día.',
  outlook:'Usa una cuenta de Outlook o Microsoft 365 del edificio. Si tiene verificación en 2 pasos, crea una <b>contraseña de aplicación</b> en account.microsoft.com → Seguridad. Algunas cuentas de Microsoft 365 de empresa tienen el envío por SMTP desactivado: lo activa quien administra esa cuenta.',
  otro:'Usa los datos SMTP que entrega el proveedor del correo del edificio (por ejemplo, el hosting del dominio). Normalmente: puerto 587 con STARTTLS, o 465 con TLS.'};
async function tarjetaCorreo(){ const el=$('#corBody'); if(!el) return;
  const {data:cola}=await T('correos').select('*').order('ts',{ascending:false}).limit(200);
  const lista=cola||[]; const n=k=>lista.filter(x=>x.estado===k).length;
  const tabla=lista.length?`<details style="margin-top:12px"${n('error')?' open':''}><summary><b>Últimos correos</b> · ${n('enviado')} enviados${n('pendiente')?` · ${n('pendiente')} pendientes`:''}${n('error')?` · <span class="pill er">${n('error')} con error</span>`:''}</summary><div style="overflow:auto"><table><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Estado</th><th></th></tr></thead><tbody>${lista.slice(0,100).map(x=>`<tr><td>${fmtDate(x.enviado_at||x.ts)}</td><td>${esc(x.nombre||'')}<br><span class="small muted">${esc(x.para)}</span></td><td>${esc(x.asunto)}${x.error?`<br><span class="small" style="color:var(--er)">${esc(x.error)}</span>`:''}</td><td>${pillOf(EST_COR,x.estado)}</td><td style="white-space:nowrap">${['error','pendiente'].includes(x.estado)?`<button type="button" class="btn sec sm" data-re="${x.id}">Reintentar</button> <button type="button" class="btn sec sm" data-des="${x.id}">Descartar</button>`:''} <button type="button" class="btn sec sm" data-ver="${x.id}">Ver</button></td></tr>`).join('')}</tbody></table></div></details>`:'<p class="small muted">Aún no se ha enviado ningún correo.</p>';
  const av=S.cfg?.correo_avisos||{};
  const avisos=`<form id="fCorAv" class="card" style="margin:10px 0;background:var(--bg2,transparent)"><b>Avisos de cobro</b>
    <label class="sw" style="margin:8px 0"><input type="checkbox" name="cobro" ${av.cobro!==false?'checked':''}> Al publicar el gasto común, enviar a cada unidad su monto, vencimiento y saldo anterior</label>
    <label class="sw" style="margin-bottom:8px"><input type="checkbox" name="comprobante" ${av.comprobante!==false?'checked':''}> Enviar un comprobante por cada pago registrado</label>
    <div class="row wrap"><label class="f"><span>Recordatorio antes del vencimiento</span><select name="recordatorio" style="width:auto">${[[0,'No enviar'],[1,'1 día antes'],[2,'2 días antes'],[3,'3 días antes'],[5,'5 días antes'],[7,'7 días antes']].map(([k,v])=>`<option value="${k}" ${Number(av.recordatorio??3)===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <label class="f"><span>Aviso de atraso</span><select name="atraso" style="width:auto">${[[0,'No enviar'],[1,'1 día después'],[5,'5 días después'],[10,'10 días después'],[15,'15 días después'],[30,'30 días después']].map(([k,v])=>`<option value="${k}" ${Number(av.atraso??5)===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <p class="small muted">El recordatorio y el aviso de atraso se envían una vez por período, solo a las unidades con saldo y fuera de un convenio de pago.</p><button class="btn sec sm">Guardar avisos</button></form>`;
  const que='<p class="small muted">La app envía sola por correo los avisos de cobro y las notificaciones formales: cargos y resoluciones de multas, aviso previo y reposición de la suspensión de luz, citaciones a asamblea, el requerimiento anual del Registro de copropietarios y las respuestas a solicitudes sobre datos personales. Se envían al correo del Registro de copropietarios de cada unidad y a las cuentas de la app de esa unidad, y queda constancia de cada envío.</p>';
  if(!CFG.LOCAL){ el.innerHTML=que+'<div class="note">En la versión en la nube (Supabase) los correos se envían con la función <code>enviar-correos</code>, que se instala aparte (ver README). Mientras no esté instalada, quedan en esta lista para abrirlos y enviarlos a mano.</div>'+avisos+tabla; correoEventos(el, lista); return; }
  let e; try{ e=await q(sb.local.correo.estado()); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; return; } if(!$('#corBody')) return;
  const est=!e.disponible?'<div class="err">Falta un componente para enviar correos en esta instalación. Actualiza Mi Edificio.</div>'
    :!e.configurado?'<div class="note">Aún no hay una cuenta de correo conectada: las notificaciones quedan pendientes hasta que la configures.</div>'
    :e.error?`<div class="err">El último envío falló: ${esc(e.error)}</div>`
    :!e.activo?'<div class="note">El envío está pausado. Los correos quedan pendientes.</div>'
    :`<div class="info">Enviando desde <b>${esc(e.remitente)}</b>.${e.ultimo?` Último envío: ${fmtDate(e.ultimo)}.`:''} Las respuestas llegan ${S.cfg?.email&&S.cfg.email.toLowerCase()!==e.remitente?`a ${esc(S.cfg.email)} (el correo del edificio)`:'a esa misma cuenta'}.</div>`;
  el.innerHTML=que+est+`<form id="fCor" style="margin-top:10px"><label class="f"><span>Proveedor</span><select name="proveedor" style="width:auto">${[['gmail','Gmail'],['outlook','Outlook / Microsoft 365'],['otro','Otro (correo del dominio del edificio)']].map(([k,v])=>`<option value="${k}" ${e.proveedor===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <p class="small muted" id="corAyuda"></p>
    <div id="corOtro" class="row wrap"><label class="f grow"><span>Servidor SMTP</span><input type="text" name="host" value="${esc(e.host)}" placeholder="mail.miedificio.cl" autocomplete="off" spellcheck="false"></label><label class="f"><span>Puerto</span><input type="number" name="puerto" value="${e.puerto||587}" min="1" max="65535" style="width:100px"></label><label class="f"><span>Seguridad</span><select name="seguridad" style="width:auto">${[['starttls','STARTTLS'],['tls','TLS'],['ninguna','Ninguna (solo un servidor en este mismo computador)']].map(([k,v])=>`<option value="${k}" ${e.seguridad===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
    <div class="row wrap"><label class="f grow"><span>Correo que envía</span><input type="email" name="remitente" value="${esc(e.remitente)}" placeholder="administracion@gmail.com" required autocomplete="off"></label><label class="f grow" id="corUsu"><span>Usuario (vacío = el mismo correo)</span><input type="text" name="usuario" value="${esc(e.usuario&&e.usuario!==e.remitente?e.usuario:'')}" autocomplete="off" spellcheck="false"></label></div>
    <label class="f"><span>${e.tieneClave?'Contraseña (vacío = mantener la guardada)':'Contraseña de aplicación'}</span><input type="password" name="clave" autocomplete="new-password"></label>
    ${e.configurado?`<label class="sw" style="margin-bottom:12px"><input type="checkbox" name="activo" ${e.activo?'checked':''}> Enviar los correos automáticamente</label>`:''}
    <p class="small muted">La contraseña queda guardada solo en este computador y no se vuelve a mostrar. Conviene usar una cuenta creada para el edificio, no una personal.</p>
    <div class="row wrap"><button class="btn">Guardar</button>${e.configurado?'<button type="button" class="btn sec" id="bCorProbar">Enviar correo de prueba</button>':''}${e.configurado&&n('pendiente')?'<button type="button" class="btn sec" id="bCorYa">Enviar pendientes ahora</button>':''}</div></form>`+avisos+tabla;
  const f=$('#fCor',el), prov=$('[name=proveedor]',f);
  const ver=()=>{ $('#corAyuda',f).innerHTML=SMTP_AYUDA[prov.value]; $('#corOtro',f).style.display=prov.value==='otro'?'':'none'; $('#corUsu',f).style.display=prov.value==='otro'?'':'none'; }; prov.addEventListener('change',ver); ver();
  f.addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(f); const b=$('button',f); busy(b,true);
    try{ await q(sb.local.correo.configurar({proveedor:d.proveedor, host:d.host, puerto:Number(d.puerto), seguridad:d.seguridad, remitente:d.remitente, usuario:d.proveedor==='otro'&&d.usuario?d.usuario:d.remitente, clave:d.clave, activo:e.configurado?!!d.activo:true})); toast('Correo configurado'); tarjetaCorreo(); }catch(err){ toast(errMsg(err)); busy(b,false); } });
  $('#bCorProbar',el)?.addEventListener('click', async()=>{ const para=await askText('Enviar un correo de prueba a', S.session?.user?.email||''); if(!para) return; const b=$('#bCorProbar',el); busy(b,true,'Enviando…'); try{ const r=await q(sb.local.correo.probar(para.trim())); toast('Correo de prueba enviado a '+r.enviado); }catch(err){ toast(errMsg(err)); } tarjetaCorreo(); });
  $('#bCorYa',el)?.addEventListener('click', async()=>{ busy($('#bCorYa',el),true,'Enviando…'); try{ await q(sb.local.correo.enviar()); }catch(err){ toast(errMsg(err)); } tarjetaCorreo(); });
  correoEventos(el, lista); }
function correoEventos(el, lista){
  $('#fCorAv',el)?.addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const correo_avisos={cobro:!!d.cobro, comprobante:!!d.comprobante, recordatorio:Number(d.recordatorio)||0, atraso:Number(d.atraso)||0};
    try{ await q(T('edificios').update({correo_avisos}).eq('id',S.cfg.id)); S.cfg.correo_avisos=correo_avisos; toast('Avisos guardados'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $$('[data-re]',el).forEach(b=>b.addEventListener('click', async()=>{ try{ await q(sb.rpc('reintentar_correo',{p_id:b.dataset.re})); if(CFG.LOCAL) await q(sb.local.correo.enviar()).catch(()=>{}); toast('Se reintentará el envío'); }catch(err){ toast(errMsg(err)); } tarjetaCorreo(); }));
  $$('[data-des]',el).forEach(b=>b.addEventListener('click', async()=>{ if(!await confirmBox('Este correo no se enviará. ¿Descartarlo?')) return; try{ await q(sb.rpc('reintentar_correo',{p_id:b.dataset.des, p_descartar:true})); }catch(err){ toast(errMsg(err)); } tarjetaCorreo(); }));
  $$('[data-ver]',el).forEach(b=>b.addEventListener('click',()=>{ const x=lista.find(y=>y.id===b.dataset.ver); if(!x) return;
    modal(`<h3>${esc(x.asunto)}</h3><p class="small muted">Para ${esc(x.nombre?x.nombre+' <'+x.para+'>':x.para)} · ${x.enviado_at?'enviado el '+fmtDate(x.enviado_at):EST_COR[x.estado][0]}</p><div style="white-space:pre-wrap;border:1px solid var(--bd);border-radius:8px;padding:12px">${esc(x.texto)}</div>`); })); }

const RETENCION=[['visitas','Visitas','Nombre, RUT y patente de quienes visitan'],['registros','Rondas y bitácora','Registros y fotos de las rondas'],['encomiendas','Encomiendas entregadas','Desde la fecha de entrega'],['mensajes','Mensajes','Conversaciones con conserjería, comité y administración'],['reservas','Reservas','Desde la fecha reservada'],['incidencias','Incidencias cerradas','Con sus fotos e historial'],['estacionamientos','Uso de estacionamientos','Patentes y horarios, desde que se libera'],['novedades','Libro de novedades','Anotaciones de conserjería y turnos'],['correos','Correos enviados','Constancia de cada notificación enviada (lo que tenga error o esté pendiente no se borra)']];
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
  <div class="card"><h3>Módulos</h3><p class="small muted">Apaga los que tu edificio no usa para que el menú quede más simple, o déjalos "solo personal" mientras los prueban conserjería, comité y administración. Apagar un módulo no borra sus datos. Inicio, Gastos comunes, Finanzas, Administración y Mi cuenta siempre están.</p>
    <form id="fMod"><div style="overflow:auto"><table><tbody>${MODULES.filter(m=>!MOD_BASICOS.includes(m.id)).map(m=>`<tr><td>${m.ic} <b>${esc(m.t)}</b><br><span class="small muted">${esc(m.d||'')}</span></td><td style="width:200px"><select name="${m.id}">${[['on','Activo'],['personal','Solo personal (piloto)'],['off','Apagado']].map(([k,v])=>`<option value="${k}" ${modEstado(m.id)===k?'selected':''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div><button class="btn sec sm" style="margin-top:8px">Guardar módulos</button></form></div>
  ${CFG.LOCAL?'<div class="card"><h3>Seguridad</h3><div id="segBody" class="small muted">Revisando…</div></div>':''}
  ${CFG.LOCAL?'<div class="card"><h3>Versión y actualizaciones</h3><div id="verBody" class="small muted">Consultando…</div></div>':''}
  ${CFG.LOCAL?'<div class="card"><h3>Acceso desde internet</h3><div id="tunBody" class="small muted">Consultando…</div></div>':''}
  <div class="card"><h3>Correo</h3><div id="corBody" class="small muted">Cargando…</div></div>
  ${CFG.LOCAL?'<div class="card"><h3>Respaldo en la nube</h3><div id="respBody" class="small muted">Cargando…</div></div>':''}
  <div class="card"><h3>Conservación de datos</h3><p class="small muted">Define por cuántos meses se guarda cada tipo de dato. Lo que supere el plazo se borra en forma definitiva, cada día. Vacío = se conserva indefinidamente.</p>
  <form id="fRet"><div class="grid2">${RETENCION.map(([k,t,d])=>`<label class="f"><span>${t}</span><input type="number" name="${k}" min="1" max="240" placeholder="Indefinido" value="${Number(c.retencion?.[k])||''}"><span style="font-weight:400;margin-top:4px">${d}</span></label>`).join('')}</div>
  <div class="row wrap"><button class="btn">Guardar plazos</button><button type="button" class="btn sec" id="bDep">Aplicar ahora</button></div></form></div>
  <div class="card"><h3>Invitar a la comunidad</h3><p class="small muted">Comparte este enlace con residentes, conserjes y empresas. Al crear su cuenta quedarán asociados a este edificio y pendientes de tu aprobación en Usuarios.</p><div class="row wrap"><input type="text" id="invUrl" class="grow" readonly value="${esc(location.origin+location.pathname)}"><button type="button" class="btn sec" id="bInv">Copiar enlace</button></div></div>`;
  $('#bInv',el).addEventListener('click', async()=>{ const i=$('#invUrl',el); try{ await navigator.clipboard.writeText(i.value); toast('Enlace copiado'); }catch(e){ i.select(); toast('Copia el enlace seleccionado'); } });
  $('#fRet',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const retencion={}; RETENCION.forEach(([k])=>{ const n=Math.floor(Number(d[k])); if(n>0) retencion[k]=n; }); try{ await q(T('edificios').update({retencion}).eq('id',S.cfg.id)); toast('Plazos guardados'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bDep',el).addEventListener('click', async e=>{ if(!await confirmBox('Se borrarán en forma definitiva los datos que superen los plazos guardados. ¿Continuar?')) return; try{ const r=await q(sb.rpc('depurar_ahora'))||{}; const n=Object.values(r).reduce((a,b)=>a+Number(b),0); toast(n?(n===1?'Se borró 1 registro':`Se borraron ${n} registros`):'No había datos fuera de plazo'); limpiarArchivos(); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bWiz',el).addEventListener('click',()=>asistente());
  tarjetaCorreo();
  if(CFG.LOCAL) tarjetaSeguridad();
  if(CFG.LOCAL){ tarjetaVersion(); tarjetaRespaldo(); tunelUI($('#tunBody',el), ()=>{ const i=$('#invUrl',el); if(i) i.value=S.dirPublica||location.origin+location.pathname; }); }
  let newLogo=null;
  $('#bLogo',el).addEventListener('click',()=>$('#logoIn',el).click());
  $('#logoIn',el).addEventListener('change', async e=>{ const f=e.target.files[0]; if(!f) return; try{ toast('Subiendo logo…'); newLogo=await uploadImage(f,'logo'); $('#logoPrev',el).innerHTML=`<img data-f="${esc(newLogo)}">`; toast('Logo listo, guarda los cambios'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bLogoDel',el)?.addEventListener('click',()=>{ newLogo=''; $('#logoPrev',el).innerHTML='🏢'; });
  $('#fMod',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=new FormData(e.target), o={}; d.forEach((v,k)=>{ if(v!=='on') o[k]=v; }); try{ await q(T('edificios').update({modulos:o}).eq('id',S.cfg.id)); S.cfg.modulos=o; toast('Módulos guardados'); routeNow(); }catch(err){ toast(errMsg(err)); } });
  $('#fEd',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('edificios').update({nombre:d.nombre.trim(), direccion:d.direccion.trim(), comuna:d.comuna.trim(), telefono:d.telefono.trim(), email:d.email.trim(), datos_bancarios:d.datos_bancarios.trim(), privacidad:d.privacidad.trim(), visita_patente:!!d.visita_patente, mora_tasa:Math.max(0,Number(d.mora_tasa)||0), mora_desde:d.mora_desde||null, color:d.color, ...(newLogo!==null?{logo:newLogo}:{}), actualizado:now()}).eq('id',S.cfg.id)); toast('Guardado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
// Ley 21.719: solicitudes de derechos (30 días corridos) y bitácora de auditoría (solo la administración)
const ACCION_AUD={crear:'creó', cambiar:'cambió', borrar:'borró', consultar:'consultó'};
const TABLA_AUD={asambleas:'asambleas', asamblea_poderes:'poderes', registro_personas:'registro de copropietarios', registro_confirmaciones:'confirmaciones del registro', condiciones_especiales:'condiciones especiales', suspensiones:'suspensiones de luz', contactos:'teléfonos', usuarios:'usuarios', pagos:'pagos', cargos:'cargos', gastos:'gastos comunes', convenios:'convenios', caja_movimientos:'caja', fondos:'fondos', fondo_movimientos:'movimientos de fondos', lecturas:'lecturas', unidades:'unidades', edificios:'configuración', multas_catalogo:'catálogo de multas', indicadores:'UTM/UF', consentimientos:'consentimientos', solicitudes_datos:'solicitudes de datos', estacionamientos:'estacionamientos'};
ADMIN.datos = function(el){
  let sols=[], aud=[], filtro='';
  el.innerHTML=`<div class="card"><h3>Solicitudes sobre datos personales</h3><p class="small muted">Acceso, rectificación, supresión, oposición, portabilidad o bloqueo (Ley 21.719). Hay que responder dentro de 30 días corridos.</p><div id="dSol" class="list"></div></div>
    <div class="card"><div class="row wrap" style="justify-content:space-between"><h3 style="margin:0">Registro reservado de condiciones especiales</h3><button class="btn sec sm" id="dCondN">+ Registrar con consentimiento en papel</button></div><p class="small muted">Electrodependencia, oxígeno medicinal, movilidad reducida… Lo declaran los residentes con consentimiento expreso desde Mi cuenta. Las unidades con electrodependencia u oxígeno no pueden quedar sin luz por deudas.</p><div id="dCond" class="list"></div></div>
    <div class="card"><div class="row wrap" style="justify-content:space-between"><h3 style="margin:0">Bitácora de auditoría</h3><span class="row" style="gap:6px"><select id="dFil" style="width:auto"><option value="">Todo</option><option value="consultar">Consultas de teléfonos</option>${Object.entries(TABLA_AUD).filter(([k])=>k!=='contactos').map(([k,v])=>`<option value="t:${k}">${esc(v)}</option>`).join('')}</select><button class="btn sec sm" id="dXls">Excel</button></span></div>
    <p class="small muted">Quién creó, cambió, borró o consultó cada dato personal o de dinero. No se puede modificar. Su plazo de conservación se fija en Edificio → Conservación de datos ("auditoria").</p><div id="dAud" style="overflow:auto"></div></div>`;
  const val=v=>{ const t=typeof v==='string'?v:JSON.stringify(v); return S.users[t]?userName(t):String(t??'').slice(0,40); };
  const cambios=x=>{ if(x.accion==='consultar') return esc(x.registro||'')+(x.motivo?' · motivo: '+esc(x.motivo):''); if(!x.antes&&!x.despues) return esc(x.motivo||'');
    if(x.accion!=='cambiar'){ const f=x.despues||x.antes||{}; const r=['depto','periodo','tipo','nombre','conducta','categoria','descripcion','detalle','monto','estado'].filter(k=>f[k]!=null&&f[k]!=='').slice(0,4).map(k=>`${k}: ${esc(String(f[k]).slice(0,50))}`).join(' · '); return r||esc(val(x.registro||'')); } const ks=Object.keys(x.despues||{}).filter(k=>!['ts','actualizado'].includes(k)&&JSON.stringify(x.antes?.[k])!==JSON.stringify(x.despues?.[k]));
    return ks.slice(0,4).map(k=>`${esc(k)}: ${esc(val(x.antes?.[k]))} → ${esc(val(x.despues?.[k]))}`).join('<br>')||'—'; };
  const draw=()=>{ const hoy=todayStr();
    $('#dSol',el).innerHTML=sols.map(x=>{ const dias=Math.round((new Date(x.vence)-new Date(hoy))/86400000), ab=['recibida','en_curso'].includes(x.estado);
      return `<div class="item static"><div class="hd"><b>${esc(userName(x.uid))} · ${esc(TIPO_SOLICITUD[x.tipo]||x.tipo)}</b>${pillOf(EST_SOLICITUD,x.estado)}</div><div class="meta">${fmtDate(x.ts)} · ${esc(x.detalle)}${ab?` · <b style="color:${dias<5?'var(--er)':'inherit'}">vence el ${fmtDay(x.vence)} (${dias<0?'vencida':dias+' días'})</b>`:''}</div>${x.respuesta?`<p class="small" style="white-space:pre-wrap;margin:6px 0 0">${esc(x.respuesta)}</p>`:''}${ab?`<div class="row acc">${x.estado==='recibida'?`<button class="btn sec sm" data-curso="${x.id}">En curso</button>`:''}<button class="btn sm" data-resp="${x.id}">Responder</button><button class="btn sec sm" data-rech="${x.id}">Rechazar</button></div>`:''}</div>`; }).join('')||'<div class="empty">Sin solicitudes</div>';
    const d=aud.filter(x=>!filtro||(filtro==='consultar'?x.accion==='consultar':x.tabla===filtro.slice(2)));
    $('#dAud',el).innerHTML=`<table><thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>${d.slice(0,300).map(x=>`<tr><td class="small" style="white-space:nowrap">${fmtDate(x.ts)}</td><td class="small">${esc(x.uid?userName(x.uid):'Sistema')}</td><td class="small">${ACCION_AUD[x.accion]||x.accion} ${esc(TABLA_AUD[x.tabla]||x.tabla)}</td><td class="small">${cambios(x)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sin registros</td></tr>'}</tbody></table>${d.length>300?'<p class="small muted">Se muestran los 300 más recientes; el Excel trae todos los cargados.</p>':''}`; };
  let conds=[];
  watch(['solicitudes_datos','auditoria','condiciones_especiales'], async()=>{ const [a,b,c]=await Promise.all([q(T('solicitudes_datos').select('*').order('ts',{ascending:false})), q(T('auditoria').select('*').order('ts',{ascending:false}).limit(3000)), q(T('condiciones_especiales').select('*').order('depto'))]); return {a,b,c}; }, ({a,b,c})=>{ sols=a; aud=b; conds=c;
    $('#dCond',el).innerHTML=conds.filter(x=>!x.hasta).map(x=>`<div class="item static"><div class="hd"><b>Depto ${esc(x.depto)} · ${esc(TIPO_COND[x.tipo]||x.tipo)}</b><button class="btn sec sm" data-fincond="${x.id}">Terminar</button></div><div class="meta">Desde ${fmtDay(x.desde)}${x.detalle?' · '+esc(x.detalle):''} · ${x.consentimiento_papel?'consentimiento en papel: '+esc(x.consentimiento_papel):'declarada por la unidad en la app'}</div></div>`).join('')||'<div class="empty">Sin condiciones registradas</div>'; draw(); });
  $('#dCondN',el).addEventListener('click',()=>{ const m=modal(`<h3>Registrar condición especial</h3><form id="fCa2"><label class="f"><span>Unidad</span><input type="text" name="depto" list="dlCe" required><datalist id="dlCe">${Object.keys(S.unidades).sort(porNum).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f"><span>Condición</span><select name="tipo">${Object.entries(TIPO_COND).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label class="f"><span>Detalle</span><input type="text" name="detalle"></label><label class="f"><span>Cómo consta el consentimiento</span><input type="text" name="cons" required placeholder="Ej: formulario firmado por la titular el 26-11-2026, archivado en administración"></label><button class="btn full">Registrar</button></form>`);
    $('#fCa2',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(sb.rpc('registrar_condicion',{p_depto:d.depto.trim(), p_tipo:d.tipo, p_detalle:d.detalle.trim(), p_consentimiento:d.cons.trim()})); closeModal(); toast('Condición registrada'); }catch(err){ toast('Error: '+errMsg(err)); } }); });
  $('#dCond',el).addEventListener('click', async e=>{ const b=e.target.closest('[data-fincond]'); if(!b) return; if(!await confirmBox('¿Terminar esta condición?')) return; try{ await q(sb.rpc('terminar_condicion',{p_id:b.dataset.fincond})); toast('Condición terminada'); }catch(err){ toast(errMsg(err)); } });
  $('#dFil',el).addEventListener('change',e=>{ filtro=e.target.value; draw(); });
  $('#dXls',el).addEventListener('click',()=>{ const B=v=>({v,b:true}); descargar(new Blob([window.MiniXlsx.build([{name:'Bitácora', widths:[18,22,12,22,30,60], rows:[[B('Fecha'),B('Quién'),B('Acción'),B('Tabla'),B('Registro'),B('Motivo o cambios')], ...aud.map(x=>[fmtDate(x.ts), x.uid?userName(x.uid):'Sistema', x.accion, TABLA_AUD[x.tabla]||x.tabla, x.registro||'', x.motivo||(x.accion==='cambiar'?cambios(x).replace(/<br>/g,' | ').replace(/&[a-z]+;/g,''):'')])]}])],{type:window.MiniXlsx.MIME}), 'bitacora-auditoria.xlsx'); });
  el.addEventListener('click', async e=>{ const t=x=>e.target.closest(x); let b;
    const upd=async(id,o,ok)=>{ try{ await q(T('solicitudes_datos').update(o).eq('id',id)); toast(ok); }catch(err){ toast('Error: '+errMsg(err)); } };
    if(b=t('[data-curso]')) upd(b.dataset.curso,{estado:'en_curso'},'Marcada en curso');
    else if(b=t('[data-resp]')){ const r=await askText('Respuesta (la recibe la persona en Mi cuenta)'); if(r) upd(b.dataset.resp,{estado:'respondida', respuesta:r.trim()},'Solicitud respondida'); }
    else if(b=t('[data-rech]')){ const r=await askText('Motivo del rechazo (debe ser fundado)'); if(r) upd(b.dataset.rech,{estado:'rechazada', respuesta:r.trim()},'Solicitud rechazada'); } });
};
ADMIN.usuarios = function(el){
  el.addEventListener('click', async e=>{ const a=e.target.closest('[data-cses]'); if(!a) return; e.preventDefault(); const u=S.users[a.dataset.cses];
    if(!await confirmBox(`¿Cerrar todas las sesiones de ${u?.nombre||'esta cuenta'}? Tendrá que volver a entrar con su contraseña.`)) return;
    try{ const r=await q(sb.local.cerrarDe(a.dataset.cses)); toast(r.cerradas?`Se ${r.cerradas===1?'cerró 1 sesión':'cerraron '+r.cerradas+' sesiones'}`:'No tenía sesiones abiertas'); }catch(err){ toast(errMsg(err)); } });
  if(CFG.LOCAL) q(sb.local.dosPasos.lista()).then(ids=>(ids||[]).forEach(id=>{ const c=$(`[data-otras="${id}"]`,el)?.closest('tr')?.querySelector('td b'); if(c&&!c.dataset.dp){ c.dataset.dp=1; c.insertAdjacentHTML('afterend',` <span class="pill ok" title="Verificación en dos pasos activa">🔐 2 pasos</span>${id!==S.uid?` <a href="#" class="small" data-q2="${id}">quitar</a>`:''}`); } })).catch(()=>{});
  el.addEventListener('click', async e=>{ const a=e.target.closest('[data-q2]'); if(!a) return; e.preventDefault(); const u=S.users[a.dataset.q2];
    if(!await confirmBox(`¿Quitar la verificación en dos pasos a ${u?.nombre||'esta cuenta'}? Úsalo solo si perdió el teléfono y sus códigos de respaldo, y confirma antes que es la persona. Se cierran sus sesiones y queda en la bitácora.`)) return;
    try{ await q(sb.local.dosPasos.quitar(a.dataset.q2)); toast('Verificación en dos pasos quitada'); a.previousElementSibling?.remove(); a.remove(); }catch(err){ toast(errMsg(err)); } });
  const otras=()=>q(T('usuario_unidades').select('*')).then(r=>{ const by={}; r.forEach(x=>(by[x.uid]=by[x.uid]||[]).push(x)); $$('[data-otras]',el).forEach(c=>{ const u=S.users[c.dataset.otras]; const ot=(by[c.dataset.otras]||[]).filter(x=>x.depto!==u?.depto).sort((a,b)=>porNum(a.depto,b.depto));
    c.innerHTML=ot.map(x=>`<span class="pill mu" style="margin:2px">${esc(x.depto)}${x.rol==='residente'?' (res.)':''} <a href="#" data-uq="${esc(x.uid)}|${esc(x.depto)}" aria-label="Quitar">✕</a></span>`).join('')+(['residente','propietario'].includes(u?.rol)?` <a href="#" data-ua="${esc(c.dataset.otras)}" class="small">+ unidad</a>`:''); }); }).catch(()=>{});
  setTimeout(otras);
  el.addEventListener('click', async e=>{ const a=e.target.closest('[data-ua]'), x=e.target.closest('[data-uq]'); if(!a&&!x) return; e.preventDefault();
    if(x){ const [uid,dep]=x.dataset.uq.split('|'); if(!await confirmBox(`¿Quitar la unidad ${dep} a ${S.users[uid]?.nombre||''}?`)) return; try{ await q(T('usuario_unidades').delete().eq('uid',uid).eq('depto',dep)); otras(); }catch(err){ toast(errMsg(err)); } return; }
    const u=S.users[a.dataset.ua]; const m=modal(`<h3>Otra unidad para ${esc(u.nombre)}</h3><p class="small muted">Por ejemplo, un segundo depto, un estacionamiento o una bodega que sean unidades con su propia alícuota. La persona verá todas sus unidades y elegirá cuál está usando.</p><form id="fUa"><div class="row"><label class="f grow"><span>Unidad</span><input type="text" name="depto" list="dlu" required></label><label class="f"><span>Rol en esa unidad</span><select name="rol"><option value="propietario">Propietario</option><option value="residente">Residente o arrendatario</option></select></label></div><button class="btn full">Agregar</button></form>`);
    $('#fUa',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); if(!S.unidades[d.depto.trim()]){ toast('Esa unidad no existe'); return; } try{ await q(T('usuario_unidades').insert({uid:u.id, depto:d.depto.trim(), rol:d.rol})); closeModal(); toast('Unidad agregada'); otras(); }catch(err){ toast(errMsg(err).includes('duplicate')||errMsg(err).includes('unique')?'Ya tiene esa unidad':errMsg(err)); } }); });
  q(T('contactos').select('uid,telefono')).then(r=>r.forEach(c=>{ const x=$(`[data-tel="${c.uid}"]`,el); if(x) x.textContent=c.telefono; })).catch(()=>{});
  const us=Object.values(S.users); const pend=us.filter(u=>u.estado==='pendiente'); const act=us.filter(u=>u.estado!=='pendiente');
  const row=u=>`<tr><td><b>${esc(u.nombre)}</b><br><span class="muted small" data-tel="${u.id}"></span><span class="muted small">${u.id===S.uid?' · (tú)':''}</span></td><td><input type="text" value="${esc(u.depto||'')}" data-dep="${u.id}" style="width:90px;padding:5px 7px" list="dlu"><div class="small" data-otras="${u.id}"></div></td><td><select data-rol="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}>${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.rol===k?'selected':''}>${v}</option>`).join('')}</select>${u.rol==='mantencion'?`<br><select data-emp="${u.id}" style="width:auto;padding:5px 7px;margin-top:4px"><option value="">— empresa —</option>${Object.values(S.empresas).map(e=>`<option value="${e.id}" ${u.empresa_id===e.id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select>`:''}</td><td><select data-est="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}><option value="activo" ${u.estado==='activo'?'selected':''}>Activo</option><option value="pendiente" ${u.estado==='pendiente'?'selected':''}>Pendiente</option><option value="bloqueado" ${u.estado==='bloqueado'?'selected':''}>Bloqueado</option></select>${CFG.LOCAL&&u.id!==S.uid?`<br><a href="#" class="small" data-clave="${u.id}">Nueva contraseña</a> · <a href="#" class="small" data-cses="${u.id}">Cerrar sesiones</a>`:''}</td></tr>`;
  el.innerHTML=`<datalist id="dlu">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist>${pend.length?`<div class="card"><h3>Solicitudes pendientes (${pend.length})</h3><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${pend.map(row).join('')}</tbody></table></div>`:''}
  <div class="card"><h3>Usuarios (${act.length})</h3><div style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${act.map(row).join('')||'<tr><td colspan="4" class="muted">Sin usuarios</td></tr>'}</tbody></table></div><p class="small muted">Los usuarios se registran solos desde la pantalla de inicio de sesión ("Crear cuenta") y aparecen aquí como pendientes. Asigna depto y rol, y actívalos.</p></div>`;
  el.addEventListener('click', async e=>{ const a=e.target.closest('[data-clave]'); if(!a) return; e.preventDefault(); const u=S.users[a.dataset.clave]; const clave=await askText('Nueva contraseña para '+(u?.nombre||'el usuario')+' (mínimo 12 caracteres; pídele que la cambie al entrar)'); if(clave===null) return;
    if(clave.length<12){ toast('La contraseña debe tener al menos 12 caracteres'); return; } try{ await q(sb.local.restablecer(a.dataset.clave, clave)); toast('Contraseña restablecida. Entrégasela a la persona.'); }catch(err){ toast('Error: '+errMsg(err)); } });
  el.addEventListener('change', async e=>{ const t=e.target; const id=t.dataset.rol||t.dataset.est||t.dataset.dep||t.dataset.emp; if(!id) return; const up={}; if(t.dataset.rol) up.rol=t.value; if(t.dataset.est) up.estado=t.value; if(t.dataset.dep) up.depto=t.value.trim(); if(t.dataset.emp) up.empresa_id=t.value||null; try{ await q(T('usuarios').update(up).eq('id',id)); toast('Usuario actualizado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
// ---------- Plantillas de documentos ----------
const TIPO_PLA={cobranza:'Cobranza', aviso:'Aviso', citacion:'Citación', acta:'Acta', otro:'Otro'};
const VARS_PLA=[['depto','Unidad'],['nombre','Propietario'],['fecha','Fecha de hoy'],['deuda','Deuda total'],['vencido','Deuda vencida'],['detalle_deuda','Detalle de la deuda por período'],['edificio','Nombre del edificio'],['direccion','Dirección'],['datos_bancarios','Datos para transferir'],['correo_edificio','Correo del edificio']];
const PLANTILLAS_EJEMPLO=[
  {nombre:'Carta de cobranza', tipo:'cobranza', asunto:'Deuda de gastos comunes · unidad {{depto}}', cuerpo:'Por medio de la presente le informamos que, al {{fecha}}, la unidad {{depto}} registra una deuda de {{deuda}} por gastos comunes, de la cual {{vencido}} está vencida:\n\n{{detalle_deuda}}\n\nLe pedimos regularizarla dentro de los próximos 10 días. Si tiene dificultades para pagar, converse con la administración un convenio de pago.\n\nDatos para transferir:\n{{datos_bancarios}}\n\nSi ya pagó, le pedimos enviarnos el comprobante para registrarlo.'},
  {nombre:'Segunda carta de cobranza', tipo:'cobranza', asunto:'Segundo aviso de deuda · unidad {{depto}}', cuerpo:'A pesar de nuestro aviso anterior, al {{fecha}} la unidad {{depto}} mantiene una deuda vencida de {{vencido}} (deuda total {{deuda}}):\n\n{{detalle_deuda}}\n\nLe recordamos que la deuda puede generar intereses por mora según el reglamento de copropiedad y que, con tres o más cuotas impagas, la Ley 21.442 permite al comité de administración solicitar la suspensión del suministro eléctrico, con aviso previo. Le pedimos pagar o acordar un convenio de pago a la brevedad.\n\nDatos para transferir:\n{{datos_bancarios}}'},
  {nombre:'Aviso de trabajos o corte de servicio', tipo:'aviso', asunto:'Aviso: [trabajo o corte] el [fecha]', cuerpo:'Informamos que el [día] entre las [hora] y las [hora] se realizará [descripción del trabajo], por lo que habrá corte de [agua / luz / gas / ascensor] en [sector].\n\nLes pedimos tomar las precauciones necesarias. Ante cualquier consulta, escriban a la administración ({{correo_edificio}}).'},
  {nombre:'Bienvenida a nuevos residentes', tipo:'aviso', asunto:'Bienvenidos a {{edificio}}', cuerpo:'Les damos la bienvenida a {{edificio}}.\n\nEn la app Mi Edificio pueden revisar su gasto común, reservar espacios comunes, anunciar visitas, recibir avisos de encomiendas y escribir a conserjería y a la administración. El reglamento de copropiedad está en Documentos.\n\nLes pedimos registrar en Mi cuenta sus vehículos y mascotas, y confirmar los datos del Registro de copropietarios.'},
  {nombre:'Citación a asamblea', tipo:'citacion', asunto:'Citación a asamblea [ordinaria / extraordinaria]', cuerpo:'Se cita a los copropietarios de {{edificio}} a asamblea [ordinaria / extraordinaria], que se realizará el [día] a las [hora] en [lugar o enlace].\n\nTabla:\n1. [tema]\n2. [tema]\n\nSi no puede asistir, puede otorgar un poder simple a otra persona. Las asambleas también se gestionan en la app (módulo Asambleas).'},
  {nombre:'Acta de reunión del comité', tipo:'acta', por_unidad:false, asunto:'Acta de reunión del comité de administración', cuerpo:'En {{direccion}}, el [fecha], siendo las [hora], se reúne el comité de administración de {{edificio}} con la asistencia de [nombres].\n\n1. Temas tratados\n[...]\n\n2. Acuerdos\n[...]\n\n3. Tareas y responsables\n[...]\n\nSe levanta la sesión a las [hora].\n\n\n______________________          ______________________\n[Nombre]                                  [Nombre]'}];
const fechaLarga=f=>{ const d=new Date(f+'T12:00:00'); return d.getDate()+' de '+d.toLocaleDateString('es-CL',{month:'long'})+' de '+d.getFullYear(); };
function rellenar(txt, v){ return String(txt||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(m,k)=>v[k]!=null&&v[k]!==''?String(v[k]):m); }
function varsUnidad(D, depto){ const c=S.cfg||{}, z=D?.U?.[depto]||{deuda:0, vencido:0, interes:0, rows:[]};
  const det=(z.rows||[]).filter(r=>r.saldo>0||r.int>0).map(r=>`- ${fmtMonth(r.periodo)}: ${clp(r.saldo)}${r.int?` (más ${clp(r.int)} de interés)`:''}${r.enConvenio?' (en convenio)':''}`).join('\n');
  return {depto, nombre:S.unidades[depto]?.prop||'propietario/a', fecha:fechaLarga(todayStr()), deuda:clp((z.deuda||0)+(z.interes||0)), vencido:clp(z.vencido||0), detalle_deuda:det||'(sin deuda)', edificio:c.nombre||'', direccion:[c.direccion,c.comuna].filter(Boolean).join(', '), datos_bancarios:c.datos_bancarios||'(pídelos a la administración)', correo_edificio:c.email||''}; }
ADMIN.plantillas = async function(el){
  let ps=[]; const cargar=async()=>{ ps=await q(T('plantillas').select('*').order('nombre')); pinta(); };
  const pinta=()=>{ el.innerHTML=`<div class="card"><div class="row wrap"><h3 class="grow" style="margin:0">Plantillas de documentos</h3><button class="btn sec sm" id="plNueva">Nueva plantilla</button>${ps.length?'':'<button class="btn sm" id="plEj">Cargar ejemplos</button>'}</div>
      <p class="small muted">Cartas de cobranza, avisos, citaciones y actas con variables que se completan solas para cada unidad: ${VARS_PLA.map(([k,t])=>`<code title="${t}">{{${k}}}</code>`).join(' ')}. Lo que está entre corchetes [así] se completa a mano antes de usarla. Las cartas se imprimen (una página por unidad) o se envían por correo; las de cobranza y las citaciones salen como notificación formal.</p>
      <div class="list">${ps.map(p=>`<div class="item static"><div class="hd"><b>${esc(p.nombre)}</b><span class="pill mu">${TIPO_PLA[p.tipo]}${p.por_unidad?'':' · documento único'}</span></div><div class="meta">${esc(p.asunto)}</div><div class="row acc"><button class="btn sm" data-pusar="${p.id}">Usar</button><button class="btn sec sm" data-ped="${p.id}">Editar</button><button class="btn sec sm" data-pdup="${p.id}">Duplicar</button><button class="btn sec sm" data-pdel="${p.id}">Eliminar</button></div></div>`).join('')||'<div class="empty">Aún no hay plantillas. Carga los ejemplos y ajústalos a tu edificio.</div>'}</div></div>`; };
  const editar=(p={})=>{ const m=modal(`<h3>${p.id?'Editar plantilla':'Nueva plantilla'}</h3><form id="fPl"><div class="row"><label class="f grow"><span>Nombre</span><input type="text" name="nombre" value="${esc(p.nombre||'')}" required></label><label class="f"><span>Tipo</span><select name="tipo">${Object.entries(TIPO_PLA).map(([k,v])=>`<option value="${k}" ${p.tipo===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
      <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="por_unidad" ${p.por_unidad!==false?'checked':''}> Una por unidad (desmarca para un documento único, como un acta)</label>
      <label class="f"><span>Asunto o título</span><input type="text" name="asunto" value="${esc(p.asunto||'')}" required></label><label class="f"><span>Texto</span><textarea name="cuerpo" rows="12" required>${esc(p.cuerpo||'')}</textarea></label>
      <p class="small muted">Variables: ${VARS_PLA.map(([k,t])=>`<code>{{${k}}}</code> ${t.toLowerCase()}`).join(' · ')}</p><button class="btn full">Guardar</button></form>`);
    $('#fPl',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const o={nombre:d.nombre.trim(), tipo:d.tipo, por_unidad:!!d.por_unidad, asunto:d.asunto.trim(), cuerpo:d.cuerpo, actualizado:new Date().toISOString()};
      try{ await q(p.id?T('plantillas').update(o).eq('id',p.id):T('plantillas').insert(o)); closeModal(); toast('Plantilla guardada'); cargar(); }catch(err){ toast(errMsg(err).includes('unique')||errMsg(err).includes('duplicate')?'Ya hay una plantilla con ese nombre':errMsg(err)); } }); };
  const usar=async p=>{ let D=null; try{ D=await finDatos(); }catch(e){}
    const us=Object.keys(S.unidades).sort(porNum), morosas=us.filter(d=>(D?.U?.[d]?.vencido||0)>0);
    const m=modal(`<h3>${esc(p.nombre)}</h3>${p.por_unidad?`<label class="f"><span>Para</span><select id="plA"><option value="una">Una unidad</option><option value="morosas">Unidades con deuda vencida (${morosas.length})</option><option value="todas">Todas las unidades (${us.length})</option><option value="elegir">Elegir unidades</option></select></label>
        <div id="plUna"><label class="f"><span>Unidad</span><input type="text" id="plDep" list="dlPl" value="${esc(morosas[0]||us[0]||'')}"><datalist id="dlPl">${us.map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label></div>
        <div id="plElegir" style="display:none;max-height:160px;overflow:auto">${us.map(d=>`<label class="small" style="display:inline-block;margin:2px 8px 2px 0"><input type="checkbox" value="${esc(d)}"> ${esc(d)}</label>`).join('')}</div>`:''}
      <label class="f"><span>Asunto</span><input type="text" id="plAs" value="${esc(p.asunto)}"></label><label class="f"><span>Texto (puedes ajustarlo para este envío)</span><textarea id="plTx" rows="9">${esc(p.cuerpo)}</textarea></label>
      <div class="small muted" id="plN"></div><h3>Vista previa</h3><div id="plPrev" class="card" style="white-space:pre-wrap;max-height:240px;overflow:auto"></div>
      <div class="row wrap"><button class="btn" id="plImp">Imprimir</button>${p.por_unidad?'<button class="btn sec" id="plMail">Enviar por correo</button>':''}</div>`);
    const deps=()=>{ if(!p.por_unidad) return []; const a=$('#plA',m).value; return a==='una'?[$('#plDep',m).value.trim()].filter(d=>S.unidades[d]):a==='morosas'?morosas:a==='todas'?us:$$('#plElegir input:checked',m).map(x=>x.value); };
    const doc=d=>{ const v=d?varsUnidad(D,d):varsUnidad(D,''); return {depto:d, asunto:rellenar($('#plAs',m).value,v), texto:rellenar($('#plTx',m).value,v)}; };
    const prev=()=>{ if(p.por_unidad){ $('#plUna',m).style.display=$('#plA',m).value==='una'?'':'none'; $('#plElegir',m).style.display=$('#plA',m).value==='elegir'?'':'none'; }
      const ds=deps(); $('#plN',m).textContent=p.por_unidad?(ds.length?`${ds.length} ${ds.length===1?'unidad':'unidades'}`:'Elige al menos una unidad'):''; const x=doc(p.por_unidad?ds[0]:'');
      $('#plPrev',m).innerHTML=(p.por_unidad&&!ds.length)?'<span class="muted">Sin unidades</span>':`<b>${esc(x.asunto)}</b>\n\n${esc(x.texto)}`; };
    m.addEventListener('input',prev); m.addEventListener('change',prev); prev();
    $('#plImp',m).addEventListener('click', async()=>{ const ds=p.por_unidad?deps():['']; if(!ds.length){ toast('Elige al menos una unidad'); return; } const cab=await cabeceraImpresion(), c=S.cfg||{};
      imprimir(p.nombre, ds.map((d,i)=>{ const x=doc(d); return `<div style="${i<ds.length-1?'break-after:page;':''}">${cab}<p class="sub">${esc(fechaLarga(todayStr()))}${d?` · Señor(a) ${esc(S.unidades[d]?.prop||'propietario/a')} · Unidad ${esc(d)}`:''}</p><h1>${esc(x.asunto)}</h1><div class="pie" style="font-size:12.5px">${esc(x.texto)}</div>${p.tipo==='acta'?'':`<p style="margin-top:40px">______________________________<br>Administración · ${esc(c.nombre||'')}</p>`}</div>`; }).join('')); });
    $('#plMail',m)?.addEventListener('click', async()=>{ const ds=deps(); if(!ds.length){ toast('Elige al menos una unidad'); return; }
      if(!await confirmBox(`Se enviará por correo a ${ds.length} ${ds.length===1?'unidad':'unidades'} (al correo del Registro de copropietarios y a las cuentas de cada unidad)${['cobranza','citacion'].includes(p.tipo)?', como notificación formal':''}. ¿Enviar?`)) return;
      try{ const n=await q(sb.rpc('enviar_documento',{p_plantilla:p.id, p_envios:ds.map(doc)})); closeModal(); toast(n?`${n} ${n===1?'correo en cola':'correos en cola'}`:'Ninguna de esas unidades tiene correo registrado'); }catch(err){ toast(errMsg(err)); } }); };
  el.onclick=async e=>{ const t=x=>e.target.closest(x); let b;
    if(t('#plNueva')) editar();
    else if(t('#plEj')){ try{ await q(T('plantillas').insert(PLANTILLAS_EJEMPLO.map(p=>({por_unidad:true, ...p})))); toast('Ejemplos cargados: revísalos antes de usarlos'); cargar(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-ped]')) editar(ps.find(p=>p.id===b.dataset.ped));
    else if(b=t('[data-pdup]')){ const p=ps.find(x=>x.id===b.dataset.pdup); editar({...p, id:null, nombre:p.nombre+' (copia)'}); }
    else if(b=t('[data-pdel]')){ if(!await confirmBox('¿Eliminar esta plantilla?')) return; try{ await q(T('plantillas').delete().eq('id',b.dataset.pdel)); cargar(); }catch(err){ toast(errMsg(err)); } }
    else if(b=t('[data-pusar]')) usar(ps.find(p=>p.id===b.dataset.pusar)); };
  el.innerHTML='<div class="empty">Cargando…</div>'; try{ await cargar(); }catch(err){ el.innerHTML=`<div class="err">${esc(errMsg(err))}</div>`; }
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
  el.innerHTML=`<div class="card"><h3>Áreas comunes reservables</h3><div class="list">${esp.map((e,i)=>`<div class="item static"><div class="hd"><b>${esc(e.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${i}">Editar</button><button class="btn sec sm" data-del="${i}">✕</button></span></div><div class="meta">Capacidad ${esc(e.capacidad)} · ${esc(e.desde)}–${esc(e.hasta)} · máx ${esc(e.maxHoras)} h · ${esc(e.anticipacionDias)} días anticipación · ${e.aprobacion?'requiere aprobación':'automática'}${e.costo?' · '+clp(e.costo):''}${e.bloqueos?.length?'<br>No disponible: '+e.bloqueos.map(b=>esc(txtBloqueo(b))).join(' · '):''}</div></div>`).join('')||'<div class="muted">Sin espacios</div>'}</div><div class="row" style="margin-top:10px;gap:6px"><button class="btn" id="bAdd">+ Agregar espacio</button>${esp.length?'':'<button class="btn sec" id="bDef">Cargar ejemplos (quincho, salón, gimnasio, sala de juegos)</button>'}</div></div>`;
  const save=arr=>q(T('edificios').update({espacios:arr}).eq('id',S.cfg.id));
  const form=(e={}, idx=-1)=>{ const m=modal(`<h3>${idx>=0?'Editar':'Nuevo'} espacio</h3><form id="fE"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(e.nombre||'')}" required></label><div class="row"><label class="f grow"><span>Capacidad</span><input type="number" name="capacidad" value="${esc(e.capacidad||10)}"></label><label class="f grow"><span>Costo (CLP)</span><input type="text" inputmode="numeric" data-clp name="costo" value="${esc(e.costo||0)}"></label></div><div class="row"><label class="f grow"><span>Abre</span><input type="time" name="desde" value="${esc(e.hasta==='24:00'?'00:00':e.desde||'09:00')}" required></label><label class="f grow"><span>Cierra</span><input type="time" name="hasta" value="${esc(e.hasta==='24:00'?'23:59':e.hasta||'22:00')}" required></label></div><label class="sw" style="margin-bottom:10px"><input type="checkbox" name="todo_dia" ${e.hasta==='24:00'?'checked':''}> Abierto las 24 horas</label><div class="row"><label class="f grow"><span>Máx. horas por reserva</span><input type="number" name="maxHoras" value="${esc(e.maxHoras||2)}" min="1"></label><label class="f grow"><span>Anticipación máx. (días)</span><input type="number" name="anticipacionDias" value="${esc(e.anticipacionDias||30)}" min="1"></label></div><label class="sw"><input type="checkbox" name="aprobacion" ${e.aprobacion?'checked':''}> Requiere aprobación del comité/administración</label>
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
  el.innerHTML=`<div class="card"><h3>Activos y checkpoints</h3><p class="small muted">Cada activo puede tener un tag NFC (graba en el tag un texto con el código) y requisitos de ronda: p. ej. checkpoint cada 1 h, foto del nivel de combustible cada 24 h.</p><div class="list">${acts.map(a=>`<div class="item static"><div class="hd"><b>${esc(a.icono||'📍')} ${esc(a.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${a.id}">Editar</button><button class="btn sec sm" data-del="${a.id}">✕</button></span></div><div class="meta">${esc(a.ubicacion||'')} · tag: <code>${esc(a.nfc_tag||'—')}</code> · ${(a.requisitos||[]).map(r=>esc((r.descripcion||TIPOS[r.tipo])+' c/'+r.frecuenciaHoras+'h')).join(', ')||'sin requisitos'}${a.plan_dias?' · preventiva cada '+a.plan_dias+' d ('+esc(S.empresas[a.empresa_id]?.nombre||'sin empresa')+')':''}</div></div>`).join('')||'<div class="muted">Sin activos</div>'}</div><button class="btn" id="bAdd" style="margin-top:10px">+ Agregar activo</button></div>`;
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
