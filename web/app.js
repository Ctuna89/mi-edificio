/* =====================================================================
   Mi Edificio — frontend (vanilla JS) sobre Supabase
   Auth (email/clave) · Postgres con RLS · Storage (bucket "fotos") · Realtime
   Varios edificios por instalación: RLS limita cada consulta al edificio del usuario.
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
const errMsg = e => (e&&(e.message||e.error_description||e.msg))||String(e);

let toastT; function toast(m){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=m; clearTimeout(toastT); toastT=setTimeout(()=>t.remove(),3000); }
function modal(html){ closeModal(); const m=document.createElement('div'); m.className='modal'; m.innerHTML='<div class="box">'+html+'</div>'; m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('[data-close]')) closeModal(); }); document.body.appendChild(m); return m; }
function closeModal(){ $$('.modal').forEach(m=>m.remove()); }
function confirmBox(msg){ return new Promise(res=>{ const m=modal(`<h3>Confirmar</h3><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn sec" data-x="no">Cancelar</button><button class="btn dan" data-x="si">Confirmar</button></div>`); m.addEventListener('click',e=>{ const x=e.target.closest('[data-x]'); if(!x) return; closeModal(); res(x.dataset.x==='si'); }); }); }
function askText(label, def=''){ return new Promise(res=>{ const m=modal(`<h3>${esc(label)}</h3><form id="fAsk"><textarea name="t">${esc(def)}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn sec" id="no">Cancelar</button><button class="btn">Aceptar</button></div></form>`); $('#no',m).addEventListener('click',()=>{closeModal();res(null);}); $('#fAsk',m).addEventListener('submit',e=>{e.preventDefault(); const v=$('[name=t]',m).value.trim(); closeModal(); res(v);}); }); }
function formData(form){ const o={}; new FormData(form).forEach((v,k)=>{ o[k]=v; }); $$('input[type=checkbox]',form).forEach(c=>{ o[c.name]=c.checked; }); return o; }
function busy(btn,on,txt){ if(!btn) return; btn.disabled=on; if(on){ btn.dataset.t=btn.textContent; btn.textContent=txt||'Guardando…'; } else if(btn.dataset.t){ btn.textContent=btn.dataset.t; } }

function descargar(blob, nombre){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
// Imprime (o guarda como PDF) solo el HTML indicado: ver reglas @media print en index.html
function imprimir(titulo, html){ $('#printArea')?.remove(); const d=document.createElement('div'); d.id='printArea'; d.innerHTML=html; document.body.appendChild(d); const prev=document.title; document.title=titulo; document.body.classList.add('printing');
  const fin=()=>{ document.body.classList.remove('printing'); document.title=prev; d.remove(); window.removeEventListener('afterprint',fin); }; window.addEventListener('afterprint',fin);
  const imgs=$$('img',d); Promise.all(imgs.map(i=>i.complete?null:new Promise(r=>{ i.onload=i.onerror=r; setTimeout(r,2500); }))).then(()=>window.print()); }

// ---------- Supabase ----------
const CFG = window.APP_CONFIG||{};
if(!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('TU-PROYECTO')){ document.getElementById('app').innerHTML='<div class="auth"><div class="card"><h3>Falta configurar Supabase</h3><p>Edita <code>config.js</code> con la URL y la anon key de tu proyecto (Project Settings → API).</p></div></div>'; return; }
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
async function q(p){ const {data,error}=await p; if(error) throw error; return data; }
const T = t => sb.from(t);
// Devuelve la URL ya escapada para usarla dentro de atributos HTML (src/href)
const fotoUrl = path => path ? esc(sb.storage.from('fotos').getPublicUrl(path).data.publicUrl) : '';

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
function viewImg(path){ modal(`<img src="${fotoUrl(path)}" style="width:100%;border-radius:10px"><div class="center" style="margin-top:10px"><button class="btn sec" data-close>Cerrar</button></div>`); }

// ---------- estado ----------
const S = { session:null, uid:null, cfg:null, me:null, users:{}, unidades:{}, empresas:{}, activos:{}, viewSubs:[], globalSubs:[], ready:false };
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
  {id:'reservas', ic:'📅', t:'Reservas', d:'Áreas comunes', roles:['residente','propietario','conserje','comite','admin']},
  {id:'incidencias', ic:'🛠️', t:'Incidencias', d:'Reportar problemas', roles:['residente','propietario','conserje','comite','admin']},
  {id:'mensajes', ic:'💬', t:'Mensajes', d:'Conserjería, comité, administración', roles:['residente','propietario','conserje','comite','admin']},
  {id:'comunicados', ic:'📣', t:'Comunicados', d:'Avisos de la comunidad', roles:['residente','propietario','conserje','comite','admin','mantencion']},
  {id:'encuestas', ic:'🗳️', t:'Encuestas', d:'Votaciones de la comunidad', roles:['residente','propietario','comite','admin']},
  {id:'encomiendas', ic:'📦', t:'Encomiendas', d:'Paquetes recibidos', roles:['residente','propietario','conserje','admin']},
  {id:'visitas', ic:'🚪', t:'Visitas', d:'Anunciar y registrar', roles:['residente','propietario','conserje','admin']},
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
  const cod=new URLSearchParams(location.search).get('e'); if(cod){ lsSet('codigo',cod.trim().toUpperCase()); history.replaceState(null,'',location.pathname+location.hash); }
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(e=>console.warn('sw',e)); navigator.serviceWorker.addEventListener('message',e=>{ if(e.data?.ir) location.hash=e.data.ir; }); }
  const {data:{session}} = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev,sess)=>{ const was=S.uid; S.session=sess; S.uid=sess?.user?.id||null; if(was!==S.uid){ teardown(); S.uid? start() : viewAuth(); } });
  S.session=session; S.uid=session?.user?.id||null;
  S.uid? start() : viewAuth();
}
async function salir(){ try{ await pushDesactivar(); }catch(e){} lsSet('verComo',null); return sb.auth.signOut(); }
function teardown(){ clearViewSubs(); S.globalSubs.forEach(u=>{try{u();}catch(e){}}); S.globalSubs=[]; S.ready=false; S.cfgLoaded=false; S.meLoaded=false; S.cfg=null; S.me=null; S.users={}; S.unidades={}; S.empresas={}; S.activos={}; }
function clearViewSubs(){ S.viewSubs.forEach(u=>{ try{u();}catch(e){} }); S.viewSubs=[]; }

function viewAuth(mode='login', msg=''){
  render(`<div class="auth"><div class="center" style="margin-bottom:16px"><div class="logo-prev" style="margin:0 auto 10px">🏢</div><h1 style="margin:0">Mi Edificio</h1></div>
  <div class="card">${msg?`<div class="info">${esc(msg)}</div>`:''}<div id="authErr"></div>
  ${mode==='login'?`<h3>Iniciar sesión</h3><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required autocomplete="username"></label><label class="f"><span>Contraseña</span><input type="password" name="pass" required autocomplete="current-password"></label><button class="btn full">Entrar</button></form><div class="links"><a href="#" data-m="registro">Crear cuenta</a><a href="#" data-m="reset">Olvidé mi contraseña</a></div>`
  : mode==='registro'?`<h3>Crear cuenta</h3><p class="small muted">Luego de crear la cuenta completarás tus datos y la administración aprobará tu acceso.</p><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required autocomplete="username"></label><label class="f"><span>Contraseña (mín. 8)</span><input type="password" name="pass" required minlength="8" autocomplete="new-password"></label><button class="btn full">Crear cuenta</button></form><div class="links"><a href="#" data-m="login">Ya tengo cuenta</a></div>`
  : `<h3>Recuperar contraseña</h3><form id="fAuth"><label class="f"><span>Correo</span><input type="email" name="email" required></label><button class="btn full">Enviar enlace</button></form><div class="links"><a href="#" data-m="login">Volver</a></div>`}</div></div>`);
  $$('[data-m]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); viewAuth(a.dataset.m);}));
  $('#fAuth').addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Un momento…'); $('#authErr').innerHTML=''; try{
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
  watch('unidades', ()=>q(T('unidades').select('*')), rows=>{ S.unidades={}; rows.forEach(u=>S.unidades[u.depto]=u); refreshView(); }, {global:true, silent:true});
  watch('empresas', ()=>q(T('empresas').select('*')), rows=>{ S.empresas={}; rows.forEach(u=>S.empresas[u.id]=u); refreshView(); }, {global:true, silent:true});
  watch('activos', ()=>q(T('activos').select('*')), rows=>{ S.activos={}; rows.forEach(u=>S.activos[u.id]=u); refreshView(); }, {global:true, silent:true});
}
function meKey(){ const m=S.me||{}; return [m.edificio_id,m.rol,m.estado,m.nombre,m.depto,m.empresa_id].join('|'); }
function cfgKey(){ const c=S.cfg||{}; return [c.id,c.nombre,c.direccion,c.logo,c.color,JSON.stringify(c.espacios||[])].join('|'); }
function gate(){ if(S.ready) return; if(!S.cfgLoaded || !S.meLoaded) return; S.ready=true; routeNow(); pushSync(); }

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
function refreshView(){ if(S.ready && typeof REFRESH[currentView]==='function' && !$('.modal')) REFRESH[currentView](); }
function shellLess(inner){ return `<div style="max-width:560px;margin:40px auto;padding:14px"><div class="center" style="margin-bottom:16px"><div class="logo-prev" style="margin:0 auto 10px">${S.cfg?.logo?`<img src="${fotoUrl(S.cfg.logo)}">`:'🏢'}</div><h1 style="margin:0">${esc(S.cfg?.nombre||'Mi Edificio')}</h1></div>${inner}</div>`; }
function logoHtml(){ return S.cfg?.logo? `<img src="${fotoUrl(S.cfg.logo)}" alt="">` : esc((S.cfg?.nombre||'E').trim()[0]||'E').toUpperCase(); }
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

// Cuenta sin perfil: unirse a un edificio (por enlace/código de invitación, o directo si la
// instalación tiene uno solo) o crear uno nuevo y quedar como su administrador.
async function viewCrearPerfil(){
  render(shellLess(`<div class="loading"><div class="spin"></div>Buscando tu edificio…</div>`));
  let edif=null, puede=false, aviso='';
  const buscar=async cod=>(await q(sb.rpc('buscar_edificio',{p_codigo:cod||null})))[0]||null;
  try{ const cod=lsGet('codigo'); [edif,puede]=await Promise.all([buscar(cod), q(sb.rpc('puede_crear_edificio'))]);
    if(cod&&!edif){ aviso='El código de invitación no corresponde a ningún edificio.'; lsSet('codigo',null); edif=await buscar(null); }
  }catch(e){ aviso='No se pudo consultar el edificio: '+errMsg(e); }
  if(S.me) return;
  const err=m=>{ $('#pErr').innerHTML=m?`<div class="err">${esc(m)}</div>`:''; };
  const listo=()=>{ lsSet('codigo',null); S.usersW?.reload(); };
  const draw=()=>{
    const pie=`<div class="links" style="margin-top:10px"><a href="#" id="out">Cerrar sesión</a>${edif?'<a href="#" id="otro">Mi edificio es otro</a>':''}</div>`;
    render(shellLess(edif?`<div class="card"><h3>Únete a ${esc(edif.nombre)}</h3><p class="small muted">La administración del edificio aprobará tu acceso.</p><div id="pErr"></div>
      <form id="fAcc"><label class="f"><span>Nombre completo</span><input type="text" name="nombre" required></label>
      <label class="f"><span>Departamento / unidad</span><input type="text" name="depto" placeholder="Ej: 1204 (vacío si eres conserje o empresa)"></label>
      <label class="f"><span>Teléfono</span><input type="tel" name="telefono"></label>
      <label class="f"><span>Soy</span><select name="rol"><option value="residente">Residente (arrendatario)</option><option value="propietario">Propietario</option><option value="conserje">Conserje</option><option value="mantencion">Empresa de mantención</option></select></label>
      <details style="margin-bottom:10px"><summary>Aviso de privacidad</summary><p class="small" style="white-space:pre-wrap">${esc(avisoPriv(edif))}</p></details>
      <label class="sw" style="margin-bottom:12px"><input type="checkbox" name="acepto" required> Leí el aviso de privacidad</label>
      <button class="btn full">Enviar solicitud</button></form>${pie}</div>`
    :`<div id="pErr"></div><div class="card"><h3>Unirme a mi edificio</h3><p class="small muted">Pide a la administración de tu edificio el enlace o el código de invitación.</p><form id="fCod" class="row"><input type="text" name="codigo" class="grow" placeholder="Código de invitación" required autocapitalize="characters" autocomplete="off"><button class="btn">Buscar</button></form></div>
      ${puede?`<div class="card"><h3>Crear un edificio nuevo</h3><p class="small muted">Quedarás como administrador y podrás invitar a tu comunidad.</p><form id="fNew"><label class="f"><span>Nombre del edificio o condominio</span><input type="text" name="edificio" required></label><label class="f"><span>Tu nombre completo</span><input type="text" name="nombre" required></label><label class="f"><span>Teléfono</span><input type="tel" name="telefono"></label><button class="btn full">Crear edificio</button></form></div>`:''}${pie}`));
    err(aviso); aviso='';
    $('#out').addEventListener('click',e=>{e.preventDefault(); salir();});
    $('#otro')?.addEventListener('click',e=>{e.preventDefault(); lsSet('codigo',null); edif=null; draw();});
    $('#fAcc')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ await q(T('usuarios').insert({id:S.uid, edificio_id:edif.id, nombre:d.nombre.trim(), depto:d.depto.trim(), telefono:d.telefono.trim(), rol:d.rol})); listo(); }catch(ex){ err(errMsg(ex)); busy(b,false); } });
    $('#fCod')?.addEventListener('submit', async e=>{ e.preventDefault(); const cod=formData(e.target).codigo.trim().toUpperCase(); const b=$('button',e.target); busy(b,true,'Buscando…'); try{ const x=await buscar(cod); if(x){ edif=x; lsSet('codigo',cod); draw(); } else { err('No existe un edificio con ese código.'); busy(b,false); } }catch(ex){ err(errMsg(ex)); busy(b,false); } });
    $('#fNew')?.addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Creando…'); try{ await q(sb.rpc('crear_edificio',{p_edificio:d.edificio.trim(), p_nombre:d.nombre.trim(), p_telefono:d.telefono.trim()})); listo(); }catch(ex){ err(errMsg(ex)); busy(b,false); } });
  };
  draw();
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
VIEWS.inicio = function(){
  const r=role(); const mods=MODULES.filter(m=>m.roles.includes(r) && !['inicio','perfil'].includes(m.id));
  const setupPend = isAdmin() && (!S.cfg || S.cfg.nombre==='Mi Edificio');
  setMain(`<h1>Hola, ${esc(S.me.nombre.split(' ')[0])}</h1>
  ${setupPend?`<div class="note">Configura el nombre, logo y dirección del edificio en <a href="#admin">Administración</a>.</div>`:''}
  ${PUSH_KEY&&pushOk()&&Notification.permission==='default'?`<div class="info">🔔 <a href="#perfil">Activa las notificaciones</a> para enterarte de encomiendas, mensajes y aprobaciones.</div>`:''}
  <div class="grid">${mods.map(m=>`<a class="tile" href="#${m.id}" data-tile="${m.id}"><span class="ic">${m.ic}</span><b>${m.t}</b><small>${m.d||''}</small></a>`).join('')}</div>
  <h2>Últimos comunicados</h2><div id="homeCom" class="list"><div class="empty">Cargando…</div></div>`);
  watch('comunicados', ()=>q(T('comunicados').select('*').order('ts',{ascending:false}).limit(3)), rows=>{ const el=$('#homeCom'); if(!el) return; el.innerHTML = rows.length? rows.map(c=>`<div class="item static"><div class="hd"><b>${esc(c.titulo)}</b><span class="muted small">${fmtDate(c.ts)}</span></div><div class="small" style="margin-top:4px">${esc(c.cuerpo).slice(0,160)}${c.cuerpo.length>160?'…':''}</div></div>`).join('') : '<div class="empty">Sin comunicados aún</div>'; });
  const badge=(id,n)=>{ const t=$(`[data-tile="${id}"]`); if(!t) return; let b=$('.badge',t); if(n>0){ if(!b){b=document.createElement('span');b.className='badge';t.appendChild(b);} b.textContent=n; } else b?.remove(); };
  const count=(table,build,id)=>watch(table, ()=>build().then(r=>r.length), n=>badge(id,n), {silent:true});
  if(['residente','propietario'].includes(r)){
    count('encomiendas', ()=>q(T('encomiendas').select('id').eq('depto',myDepto()).eq('entregado',false)), 'encomiendas');
    count('conversaciones', ()=>q(T('conversaciones').select('id').eq('depto',myDepto()).eq('no_leido_residente',true)), 'mensajes');
    count(['encuestas','votos'], async()=>{ const [e,v]=await Promise.all([q(T('encuestas').select('id,cierra,solo_propietarios').eq('estado','abierta')), q(T('votos').select('encuesta_id').eq('depto',myDepto()))]); const ya=new Set(v.map(x=>x.encuesta_id)); return e.filter(x=>(!x.cierra||x.cierra>=todayStr())&&!ya.has(x.id)&&(!x.solo_propietarios||r==='propietario')); }, 'encuestas');
  } else if(isStaff()){
    const canal = Object.keys(canalRol).find(c=>canalRol[c]===r);
    if(canal) count('conversaciones', ()=>q(T('conversaciones').select('id').eq('canal',canal).eq('no_leido_staff',true)), 'mensajes');
    count('incidencias', ()=>q(T('incidencias').select('id').eq('estado','abierta')), 'incidencias');
    if(r!=='conserje') count('reservas', ()=>q(T('reservas').select('id').eq('estado','pendiente')), 'reservas');
    if(r==='admin') count('usuarios', ()=>q(T('usuarios').select('id').eq('estado','pendiente')), 'admin');
  } else if(r==='mantencion' && S.me.empresa_id){
    count('ot', ()=>q(T('ot').select('id').eq('empresa_id',S.me.empresa_id).eq('estado','asignada')), 'mantencion');
  }
};

// GASTOS COMUNES
VIEWS.gastos = function(){
  const staff = ['comite','admin'].includes(role());
  setMain(`<h1>Gastos comunes</h1>${isAdmin()?`<div class="row" style="margin-bottom:12px"><button class="btn" id="bNuevoG">+ Nuevo período</button></div>`:''}<div id="gList"></div>`);
  $('#bNuevoG')?.addEventListener('click',()=>formGasto());
  let aviso=null; $('#gList').addEventListener('click',e=>{ const x=e.target.closest('[data-x]'); if(x&&aviso?.mio) exportGasto(x.dataset.x, aviso.g, null, aviso.mio); });
  watch(['gastos','gasto_unidades'], async()=>{ const g=await q(T('gastos').select('*').order('periodo',{ascending:false}).limit(24)); const gu=await q(T('gasto_unidades').select('*')); return {g,gu}; }, ({g,gu})=>{
    const el=$('#gList'); if(!el) return;
    const pr={}; gu.forEach(x=>{ (pr[x.periodo]=pr[x.periodo]||{})[x.depto]=x; });
    if(!g.length){ el.innerHTML='<div class="empty">Aún no hay períodos publicados.</div>'; return; }
    if(staff){
      el.innerHTML = g.map(x=>{ const p=Object.values(pr[x.periodo]||{}); return `<div class="item" data-g="${x.periodo}"><div class="hd"><b>${esc(fmtMonth(x.periodo))}</b><span class="pill ${x.publicado?'ok':'wa'}">${x.publicado?'Publicado':'Borrador'}</span></div><div class="meta">Total ${clp(x.total)} · ${(x.items||[]).length} ítems · ${p.filter(u=>u.pagado).length}/${p.length} unidades pagadas</div></div>`; }).join('');
      $$('#gList [data-g]').forEach(it=>it.addEventListener('click',()=>detalleGastoAdmin(g.find(x=>x.periodo===it.dataset.g), pr[it.dataset.g]||{})));
    } else {
      const dep=myDepto(); const vis=g.filter(x=>x.publicado); if(!vis.length){ el.innerHTML='<div class="empty">Aún no hay períodos publicados.</div>'; return; }
      const cur=vis[0]; const mio=pr[cur.periodo]?.[dep]; aviso={g:cur, mio};
      el.innerHTML = `<div class="card"><div class="row"><div class="grow"><span class="muted small">${esc(fmtMonth(cur.periodo))} · Depto ${esc(dep)}</span><div style="font-size:28px;font-weight:700">${mio?clp(mio.monto):'—'}</div></div>${mio?`<span class="pill ${mio.pagado?'ok':'wa'}">${mio.pagado?'Pagado':'Pendiente'}</span>`:''}</div>
      ${mio?`<div class="small muted" style="margin:6px 0 10px">Alícuota ${Number(mio.alicuota)}% · Vence ${cur.vence?fmtDay(cur.vence):'—'}</div>`:'<div class="small muted">Tu unidad no está en el prorrateo de este período. Consulta a administración.</div>'}
      ${S.cfg?.datos_bancarios?`<details><summary>Datos para transferir</summary><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(S.cfg.datos_bancarios)}</pre></details>`:''}
      ${mio?`<div class="row" style="margin-top:10px;gap:6px"><button class="btn sec sm" data-x="pdf">Descargar PDF</button><button class="btn sec sm" data-x="xls">Descargar Excel</button></div>`:''}</div>
      <h2>Desglose del período</h2><div class="card"><table><thead><tr><th>Ítem</th><th class="num">Total edificio</th><th class="num">Tu parte</th></tr></thead><tbody>
      ${(cur.items||[]).map(it=>`<tr><td>${esc(it.categoria)}<br><span class="muted small">${esc(it.descripcion||'')}</span></td><td class="num">${clp(it.monto)}</td><td class="num">${mio?clp(it.monto*Number(mio.alicuota)/100):'—'}</td></tr>`).join('')}
      <tr><th>Total</th><th class="num">${clp(cur.total)}</th><th class="num">${mio?clp(mio.monto):'—'}</th></tr></tbody></table></div>
      <h2>Historial</h2><div class="list">${vis.slice(1).map(x=>{const m=pr[x.periodo]?.[dep]; return `<div class="item static"><div class="hd"><b>${esc(fmtMonth(x.periodo))}</b>${m?`<span class="pill ${m.pagado?'ok':'wa'}">${m.pagado?'Pagado':'Pendiente'}</span>`:''}</div><div class="meta">${m?clp(m.monto):'—'} · total edificio ${clp(x.total)}</div></div>`;}).join('')||'<div class="empty">Sin períodos anteriores</div>'}</div>`;
    }
  });
};
function formGasto(g){
  g = g || {periodo:monthStr(), vence:'', items:[{categoria:'Remuneraciones',monto:0},{categoria:'Agua',monto:0},{categoria:'Electricidad áreas comunes',monto:0},{categoria:'Mantención ascensores',monto:0},{categoria:'Aseo',monto:0},{categoria:'Fondo de reserva',monto:0}], publicado:false};
  const suma=Object.values(S.unidades).reduce((a,u)=>a+(Number(u.alicuota)||0),0);
  const m=modal(`<h3>${g.actualizado?'Editar':'Nuevo'} período</h3><form id="fG">
  <div class="row"><label class="f grow"><span>Período</span><input type="month" name="periodo" value="${esc(g.periodo)}" required ${g.actualizado?'readonly':''}></label><label class="f grow"><span>Vencimiento</span><input type="date" name="vence" value="${esc(g.vence||'')}"></label></div>
  <div id="items"></div><button type="button" class="btn sec sm" id="addIt">+ Ítem</button>
  <div class="row" style="margin-top:12px;justify-content:space-between"><b>Total: <span id="gTot">$0</span></b><label class="sw"><input type="checkbox" name="publicado" ${g.publicado?'checked':''}> Publicado</label></div>
  <p class="small muted">Prorrateo según alícuotas (Administración → Unidades). Unidades: ${Object.keys(S.unidades).length}, suma: ${suma.toFixed(2)}%</p>
  <div class="row" style="justify-content:flex-end;margin-top:8px">${g.actualizado?'<button type="button" class="btn dan sm" id="delG">Eliminar</button>':''}<button class="btn">Guardar</button></div></form>`);
  const items=$('#items',m); const rowIt=(it={})=>{ const d=document.createElement('div'); d.className='row'; d.style.marginBottom='6px'; d.innerHTML=`<input type="text" name="cat" placeholder="Categoría" value="${esc(it.categoria||'')}" required style="flex:2"><input type="text" name="des" placeholder="Detalle" value="${esc(it.descripcion||'')}" style="flex:2"><input type="number" name="mon" placeholder="$" value="${it.monto||''}" min="0" style="flex:1;min-width:90px"><button type="button" class="btn sec sm" data-rm>✕</button>`; items.appendChild(d); };
  (g.items||[]).forEach(rowIt); $('#addIt',m).addEventListener('click',()=>rowIt());
  const recalc=()=>{ let t=0; $$('input[name=mon]',m).forEach(i=>t+=Number(i.value)||0); $('#gTot',m).textContent=clp(t); };
  m.addEventListener('input',recalc); m.addEventListener('click',e=>{ if(e.target.closest('[data-rm]')){ e.target.closest('.row').remove(); recalc(); } }); recalc();
  $('#delG',m)?.addEventListener('click', async()=>{ if(await confirmBox('¿Eliminar este período?')){ await q(T('gastos').delete().eq('periodo',g.periodo)); closeModal(); toast('Eliminado'); } });
  $('#fG',m).addEventListener('submit', async e=>{ e.preventDefault(); const rows=$$('#items .row',m).map(r=>({categoria:$('[name=cat]',r).value.trim(), descripcion:$('[name=des]',r).value.trim(), monto:Number($('[name=mon]',r).value)||0})); const total=rows.reduce((a,b)=>a+b.monto,0); const periodo=$('[name=periodo]',m).value; const vence=$('[name=vence]',m).value||null; const publicado=$('[name=publicado]',m).checked;
    try{ await q(T('gastos').upsert({edificio_id:S.me.edificio_id, periodo, vence, items:rows, total, publicado, actualizado:now()})); await q(sb.rpc('recalcular_prorrateo',{p_periodo:periodo})); closeModal(); toast('Período guardado'); }catch(err){ toast('Error: '+errMsg(err)); } });
}
function detalleGastoAdmin(g, pr){
  const m=modal(`<h3>${esc(fmtMonth(g.periodo))}</h3><div class="row wrap" style="margin-bottom:10px"><span class="pill ${g.publicado?'ok':'wa'}">${g.publicado?'Publicado':'Borrador'}</span><b>${clp(g.total)}</b><span class="grow"></span><button class="btn sec sm" id="xPdf">PDF</button><button class="btn sec sm" id="xXls">Excel</button>${isAdmin()?`<button class="btn sec sm" id="edG">Editar</button><button class="btn sec sm" id="recG">Recalcular prorrateo</button>`:''}</div>
  <table><thead><tr><th>Ítem</th><th class="num">Monto</th></tr></thead><tbody>${(g.items||[]).map(it=>`<tr><td>${esc(it.categoria)} <span class="muted small">${esc(it.descripcion||'')}</span></td><td class="num">${clp(it.monto)}</td></tr>`).join('')}</tbody></table>
  <h2>Prorrateo por unidad</h2><table><thead><tr><th>Unidad</th><th class="num">Alíc.</th><th class="num">Monto</th><th>Pago</th></tr></thead><tbody>${Object.values(pr).sort((a,b)=>a.depto.localeCompare(b.depto,undefined,{numeric:true})).map(p=>`<tr><td>${esc(p.depto)}</td><td class="num">${Number(p.alicuota)}%</td><td class="num">${clp(p.monto)}</td><td>${isAdmin()?`<label class="sw"><input type="checkbox" data-pag="${esc(p.depto)}" ${p.pagado?'checked':''}> <span>${p.pagado?'Pagado':'Pendiente'}</span></label>`:`<span class="pill ${p.pagado?'ok':'wa'}">${p.pagado?'Pagado':'Pendiente'}</span>`}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sin unidades. Agrega unidades con alícuota en Administración.</td></tr>'}</tbody></table>`);
  $('#xPdf',m).addEventListener('click',()=>{ closeModal(); exportGasto('pdf',g,pr); });
  $('#xXls',m).addEventListener('click',()=>exportGasto('xls',g,pr));
  $('#edG',m)?.addEventListener('click',()=>formGasto(g));
  $('#recG',m)?.addEventListener('click', async()=>{ try{ await q(sb.rpc('recalcular_prorrateo',{p_periodo:g.periodo})); toast('Prorrateo recalculado'); closeModal(); }catch(err){ toast(errMsg(err)); } });
  m.addEventListener('change', async e=>{ const c=e.target.closest('[data-pag]'); if(!c) return; try{ await q(T('gasto_unidades').update({pagado:c.checked, pagado_at:c.checked?now():null}).eq('periodo',g.periodo).eq('depto',c.dataset.pag)); c.nextElementSibling.textContent=c.checked?'Pagado':'Pendiente'; }catch(err){ toast(errMsg(err)); } });
}

// Exportar un período a Excel (.xlsx) o PDF (diálogo de impresión → "Guardar como PDF").
// Con `mio` (fila de gasto_unidades del residente) genera su aviso de cobro; sin él, el informe completo.
function exportGasto(tipo, g, pr, mio){
  const c=S.cfg||{}; const items=g.items||[]; const mes=fmtMonth(g.periodo);
  const dmy=d=>d?String(d).slice(8,10)+'-'+String(d).slice(5,7)+'-'+String(d).slice(0,4):'—';
  const us=Object.values(pr||{}).sort((a,b)=>a.depto.localeCompare(b.depto,undefined,{numeric:true}));
  const parte=it=>Math.round(Number(it.monto)*Number(mio.alicuota)/100);
  const archivo='gastos-comunes-'+g.periodo+(mio?'-depto-'+seg(mio.depto):'');
  if(tipo==='xls'){
    const B=v=>({v,b:true}); let hojas;
    if(mio) hojas=[{name:'Aviso de cobro', widths:[34,34,16,16], rows:[[B(c.nombre||'')],[B('Gastos comunes '+mes)],[],['Unidad',String(mio.depto)],['Alícuota %',Number(mio.alicuota)],['Vencimiento',dmy(g.vence)],['Estado',mio.pagado?'Pagado':'Pendiente'],[],
      [B('Ítem'),B('Detalle'),B('Total edificio'),B('Tu parte')], ...items.map(it=>[it.categoria,it.descripcion||'',Number(it.monto)||0,parte(it)]), [B('Total'),'',B(Number(g.total)),B(Number(mio.monto))]]}];
    else hojas=[{name:'Resumen', widths:[34,34,16], rows:[[B(c.nombre||'')],[B('Gastos comunes '+mes)],[],['Vencimiento',dmy(g.vence)],['Estado',g.publicado?'Publicado':'Borrador'],['Unidades pagadas',us.filter(u=>u.pagado).length+' de '+us.length],[],
        [B('Ítem'),B('Detalle'),B('Monto')], ...items.map(it=>[it.categoria,it.descripcion||'',Number(it.monto)||0]), [B('Total'),'',B(Number(g.total))]]},
      {name:'Prorrateo', widths:[12,30,12,16,12,16], rows:[[B('Unidad'),B('Propietario'),B('Alícuota %'),B('Monto'),B('Estado'),B('Fecha de pago')],
        ...us.map(u=>[String(u.depto),S.unidades[u.depto]?.prop||'',Number(u.alicuota),Number(u.monto),u.pagado?'Pagado':'Pendiente',u.pagado_at?dmy(u.pagado_at):'']),
        [B('Total'),'',B(us.reduce((a,u)=>a+Number(u.alicuota),0)),B(us.reduce((a,u)=>a+Number(u.monto),0))]]}];
    descargar(new Blob([window.MiniXlsx.build(hojas)],{type:window.MiniXlsx.MIME}), archivo+'.xlsx'); return;
  }
  const cab=`<div class="ph">${c.logo?`<img src="${fotoUrl(c.logo)}" alt="">`:''}<div><b>${esc(c.nombre||'')}</b><br>${esc([c.direccion,c.comuna].filter(Boolean).join(', '))}</div></div>`;
  const banco=c.datos_bancarios?`<h2>Datos para transferir</h2><div class="pie">${esc(c.datos_bancarios)}</div>`:'';
  imprimir(archivo, mio?
    `${cab}<h1>Aviso de cobro · Gastos comunes ${esc(mes)}</h1><p class="sub">Depto ${esc(mio.depto)} · Alícuota ${Number(mio.alicuota)}% · Vence ${dmy(g.vence)} · ${mio.pagado?'Pagado':'Pendiente de pago'}</p>
    <table><thead><tr><th>Ítem</th><th class="num">Total edificio</th><th class="num">Tu parte</th></tr></thead><tbody>${items.map(it=>`<tr><td>${esc(it.categoria)}${it.descripcion?' <span class="muted">'+esc(it.descripcion)+'</span>':''}</td><td class="num">${clp(it.monto)}</td><td class="num">${clp(parte(it))}</td></tr>`).join('')}
    <tr class="tot"><td>Total a pagar</td><td class="num">${clp(g.total)}</td><td class="num">${clp(mio.monto)}</td></tr></tbody></table>${banco}`
  : `${cab}<h1>Gastos comunes ${esc(mes)}</h1><p class="sub">Total ${clp(g.total)} · Vence ${dmy(g.vence)} · ${g.publicado?'Publicado':'Borrador'} · ${us.filter(u=>u.pagado).length} de ${us.length} unidades pagadas</p>
    <table><thead><tr><th>Ítem</th><th>Detalle</th><th class="num">Monto</th></tr></thead><tbody>${items.map(it=>`<tr><td>${esc(it.categoria)}</td><td>${esc(it.descripcion||'')}</td><td class="num">${clp(it.monto)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td class="num">${clp(g.total)}</td></tr></tbody></table>
    <h2>Prorrateo por unidad</h2><table><thead><tr><th>Unidad</th><th>Propietario</th><th class="num">Alícuota</th><th class="num">Monto</th><th>Estado</th></tr></thead><tbody>${us.map(u=>`<tr><td>${esc(u.depto)}</td><td>${esc(S.unidades[u.depto]?.prop||'')}</td><td class="num">${Number(u.alicuota)}%</td><td class="num">${clp(u.monto)}</td><td>${u.pagado?'Pagado '+dmy(u.pagado_at):'Pendiente'}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td></td><td class="num">${us.reduce((a,u)=>a+Number(u.alicuota),0).toFixed(2)}%</td><td class="num">${clp(us.reduce((a,u)=>a+Number(u.monto),0))}</td><td></td></tr></tbody></table>${banco}`);
}

// RESERVAS
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
    $('#espInfo').innerHTML=`Capacidad ${e.capacidad||'-'} · ${e.desde}–${e.hasta} · máx ${e.maxHoras} h · hasta ${e.anticipacionDias} días de anticipación · ${e.aprobacion?'requiere aprobación':'confirmación inmediata'}${e.costo?' · costo '+clp(e.costo):''}`;
    const busyH={}; allRes.filter(d=>d.espacio_id===e.id && d.fecha===dia && ['pendiente','aprobada'].includes(d.estado)).forEach(d=>{ for(let h=d.h_ini;h<d.h_fin;h++) busyH[h]=d; });
    $('#slots').innerHTML = hours(e).map(h=>{ const b=busyH[h]; return `<button data-h="${h}" class="${b?'busy':''}${selected.has(h)?' sel':''}" ${b?'disabled':''}>${pad(h)}:00${b?`<br><small>${esc(b.depto)}</small>`:''}</button>`; }).join('');
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
  <div class="photos">${(x.fotos||[]).map(f=>`<img src="${fotoUrl(f)}" data-img="${esc(f)}">`).join('')}</div>
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
  <h2>Historial</h2><div class="timeline">${(x.historial||[]).slice().reverse().map(h=>`<div><b>${esc(h.accion)}</b> <span class="muted">· ${esc(userName(h.uid))} · ${fmtDate(h.ts)}</span>${h.nota?'<br>'+esc(h.nota):''}${h.fotos?.length?'<div class="photos">'+h.fotos.map(f=>`<img src="${fotoUrl(f)}" data-img="${esc(f)}">`).join('')+'</div>':''}</div>`).join('')}</div>`);
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
  let docs=[]; watch('comunicados', ()=>q(T('comunicados').select('*').order('ts',{ascending:false}).limit(100)), rows=>{ docs=rows; const el=$('#cList'); if(!el) return; el.innerHTML=docs.map(c=>`<div class="item static"><div class="hd"><b>${esc(c.titulo)}</b><span class="muted small">${fmtDate(c.ts)}</span></div><div style="margin-top:6px;white-space:pre-wrap">${esc(c.cuerpo)}</div><div class="meta">${esc(ROLES[c.rol]||'')} · ${esc(userName(c.uid))}${c.adjunto?` · <a href="${fotoUrl(c.adjunto)}" target="_blank">Adjunto</a>`:''}${puede?` · <a href="#" data-ed="${c.id}">Editar</a> · <a href="#" data-del="${c.id}">Eliminar</a>`:''}</div></div>`).join('')||'<div class="empty">Sin comunicados</div>'; });
  $('#cList').addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed){ e.preventDefault(); formComunicado(docs.find(x=>x.id===ed.dataset.ed)); } if(del){ e.preventDefault(); if(await confirmBox('¿Eliminar comunicado?')) await q(T('comunicados').delete().eq('id',del.dataset.del)); } });
};
function formComunicado(c={}){
  const m=modal(`<h3>${c.id?'Editar':'Nuevo'} comunicado</h3><form id="fC"><label class="f"><span>Título</span><input type="text" name="titulo" value="${esc(c.titulo||'')}" required></label><label class="f"><span>Mensaje</span><textarea name="cuerpo" required style="min-height:140px">${esc(c.cuerpo||'')}</textarea></label><label class="f"><span>Adjunto (PDF o imagen, opcional)</span><input type="file" name="adj" accept="application/pdf,image/*"></label><button class="btn full">Publicar</button></form>`);
  $('#fC',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ let adjunto=c.adjunto||''; const f=$('[name=adj]',m).files[0]; if(f) adjunto=await uploadFile(f,'comunicados'); if(c.id) await q(T('comunicados').update({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, editado:now()}).eq('id',c.id)); else await q(T('comunicados').insert({titulo:d.titulo.trim(), cuerpo:d.cuerpo.trim(), adjunto, uid:S.uid, rol:realRole()})); closeModal(); toast('Publicado'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}

// ENCUESTAS (un voto por unidad; los totales vienen de la función resultados_encuestas)
VIEWS.encuestas = function(){
  const r=role(); const puede=['comite','admin'].includes(r); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Encuestas</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewEn">+ Nueva encuesta</button></div>':''}<div id="enList" class="list"><div class="empty">Cargando…</div></div>`);
  $('#bNewEn')?.addEventListener('click',()=>formEncuesta());
  let docs=[], mios={}, res={};
  const abierta=e=>e.estado==='abierta'&&(!e.cierra||e.cierra>=todayStr());
  const draw=()=>{ const el=$('#enList'); if(!el) return; const nUn=Object.keys(S.unidades).length;
    el.innerHTML=docs.map(e=>{ const ab=abierta(e), ops=e.opciones||[], rs=res[e.id]||[], mio=mios[e.id];
      const habil=resid&&ab&&(!e.solo_propietarios||r==='propietario'); const verRes=puede||!ab||!!mio;
      const tot=rs.reduce((a,x)=>a+x.n,0), totAl=rs.reduce((a,x)=>a+Number(x.alicuota),0);
      return `<div class="item static" data-en="${e.id}"><div class="hd"><b>${esc(e.titulo)}</b><span class="pill ${ab?'ok':'mu'}">${ab?'Abierta':'Cerrada'}</span></div>
      ${e.descripcion?`<div style="margin-top:6px;white-space:pre-wrap">${esc(e.descripcion)}</div>`:''}
      <div class="meta">${e.cierra?(ab?'Cierra el ':'Cerró el ')+fmtDay(e.cierra)+' · ':''}${e.solo_propietarios?'Solo propietarios · ':''}Un voto por unidad${verRes?` · ${tot} de ${nUn} unidades han votado`:''}</div>
      ${habil?(myDepto()?`<form style="margin-top:10px">${ops.map((o,i)=>`<label class="sw" style="margin-bottom:6px"><input type="radio" name="op" value="${i}" ${mio&&mio.opcion===i?'checked':''} required> ${esc(o)}</label>`).join('')}<div class="row" style="margin-top:4px"><button class="btn sm">${mio?'Cambiar voto':'Votar'}</button>${mio?`<span class="small muted">Tu unidad votó el ${fmtDate(mio.ts)}</span>`:''}</div></form>`:'<div class="note" style="margin-top:10px">Tu usuario no tiene departamento asignado.</div>')
        :(resid&&mio?`<div class="small muted" style="margin-top:8px">Tu unidad votó: <b>${esc(ops[mio.opcion]||'')}</b></div>`:(resid&&ab?'<div class="small muted" style="margin-top:8px">Esta votación es solo para propietarios.</div>':''))}
      ${verRes?`<div style="margin-top:12px">${ops.map((o,i)=>{ const x=rs.find(y=>y.opcion===i)||{n:0,alicuota:0}; const pct=tot?Math.round(x.n/tot*100):0; return `<div style="margin-bottom:8px"><div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(o)}</span><span class="muted">${x.n} ${x.n===1?'voto':'votos'} · ${pct}%${totAl?' · alícuota '+Number(x.alicuota).toFixed(2)+'%':''}</span></div><div class="bar"><i style="width:${pct}%;background:var(--p)"></i></div></div>`; }).join('')}</div>`
        :(habil?'<div class="small muted" style="margin-top:8px">Verás los resultados cuando tu unidad vote o al cerrar la encuesta.</div>':'')}
      ${puede?`<div class="row" style="margin-top:8px;gap:6px"><button class="btn sec sm" data-est="${e.estado==='abierta'?'cerrada':'abierta'}">${e.estado==='abierta'?'Cerrar votación':'Reabrir'}</button><button class="btn sec sm" data-del>Eliminar</button></div>`:''}</div>`; }).join('')||'<div class="empty">Sin encuestas</div>'; };
  const w=watch(['encuestas','votos'], async()=>{ const [e,v,rs]=await Promise.all([q(T('encuestas').select('*').order('ts',{ascending:false}).limit(100)), q(T('votos').select('*')), q(sb.rpc('resultados_encuestas'))]); return {e,v,rs}; },
    ({e,v,rs})=>{ docs=e; mios={}; v.filter(x=>x.depto===myDepto()).forEach(x=>mios[x.encuesta_id]=x); res={}; rs.forEach(x=>(res[x.encuesta_id]=res[x.encuesta_id]||[]).push(x)); draw(); });
  $('#enList').addEventListener('submit', async ev=>{ ev.preventDefault(); const id=ev.target.closest('[data-en]').dataset.en; const op=new FormData(ev.target).get('op'); if(op==null) return;
    try{ await q(T('votos').upsert({edificio_id:S.me.edificio_id, encuesta_id:id, depto:myDepto(), opcion:Number(op), uid:S.uid, ts:now()})); toast('Voto registrado'); w.reload(); }catch(err){ toast('No se pudo registrar el voto: '+errMsg(err)); } });
  $('#enList').addEventListener('click', async ev=>{ const est=ev.target.closest('[data-est]'), del=ev.target.closest('[data-del]'); if(!est&&!del) return; const id=ev.target.closest('[data-en]').dataset.en;
    try{ if(est) await q(T('encuestas').update({estado:est.dataset.est}).eq('id',id)); else if(await confirmBox('¿Eliminar la encuesta y sus votos?')) await q(T('encuestas').delete().eq('id',id)); w.reload(); }catch(err){ toast('Error: '+errMsg(err)); } });
};
function formEncuesta(){
  const m=modal(`<h3>Nueva encuesta</h3><form id="fEn"><label class="f"><span>Pregunta</span><input type="text" name="titulo" required placeholder="Ej: ¿Aprobamos pintar la fachada?"></label>
  <label class="f"><span>Detalle (opcional)</span><textarea name="descripcion"></textarea></label>
  <label class="f"><span>Opciones (una por línea)</span><textarea name="opciones" required>${['Sí','No','Me abstengo'].join('\n')}</textarea></label>
  <label class="f"><span>Último día para votar (opcional)</span><input type="date" name="cierra" min="${todayStr()}"></label>
  <label class="sw" style="margin-bottom:10px"><input type="checkbox" name="solo_propietarios"> Solo votan propietarios</label>
  <p class="small muted">Cada unidad emite un voto y puede cambiarlo mientras la encuesta esté abierta. Nadie ve el voto de otra unidad, solo los totales. Las opciones no se pueden editar después de publicar.</p>
  <button class="btn full">Publicar encuesta</button></form>`);
  $('#fEn',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target);
    const opciones=[...new Set(d.opciones.split('\n').map(x=>x.trim()).filter(Boolean))]; if(opciones.length<2){ toast('Escribe al menos dos opciones'); return; }
    busy(b,true); try{ await q(T('encuestas').insert({titulo:d.titulo.trim(), descripcion:d.descripcion.trim(), opciones, cierra:d.cierra||null, solo_propietarios:!!d.solo_propietarios, uid:S.uid})); closeModal(); toast('Encuesta publicada'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } });
}

// ENCOMIENDAS
VIEWS.encomiendas = function(){
  const r=role(); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Encomiendas</h1>${!resid?`<div style="margin-bottom:10px"><button class="btn" id="bNewE">+ Registrar encomienda</button></div>`:''}<div class="tabs" id="eTabs"><button data-t="pend" class="on">Por retirar</button><button data-t="ent">Entregadas</button></div><div id="eList" class="list"></div>`);
  $('#bNewE')?.addEventListener('click',()=>{ const m=modal(`<h3>Registrar encomienda</h3><form id="fE"><label class="f"><span>Departamento</span><input type="text" name="depto" list="dl" required><datalist id="dl">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label><label class="f"><span>Descripción</span><input type="text" name="desc" placeholder="Caja mediana, sobre, etc." required></label><label class="f"><span>Empresa / remitente</span><input type="text" name="courier" placeholder="Chilexpress, Mercado Libre…"></label><label class="f"><span>Foto (opcional)</span><input type="file" name="foto" accept="image/*" capture="environment"></label><button class="btn full">Registrar</button></form>`);
    $('#fE',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true); try{ const f=$('[name=foto]',m).files[0]; const foto=f?await uploadImage(f,'encomiendas'):''; await q(T('encomiendas').insert({depto:d.depto.trim(), descripcion:d.desc.trim(), courier:d.courier.trim(), foto, recibido_por:S.uid, entregado:false})); closeModal(); toast('Encomienda registrada'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); });
  let tab='pend', docs=[]; $('#eTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#eTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  const draw=()=>{ const el=$('#eList'); if(!el) return; let d=docs; if(resid) d=d.filter(x=>x.depto===myDepto()); d=d.filter(x=>tab==='pend'?!x.entregado:x.entregado); el.innerHTML=d.map(x=>`<div class="item static"><div class="hd"><b>${resid?'':'Depto '+esc(x.depto)+' · '}${esc(x.descripcion)}</b><span class="pill ${x.entregado?'ok':'wa'}">${x.entregado?'Entregada':'Por retirar'}</span></div><div class="meta">${esc(x.courier||'')} · recibida ${fmtDate(x.ts)}${x.entregado?' · entregada '+fmtDate(x.entregado_at)+(x.retirado_por?' a '+esc(x.retirado_por):''):''}</div>${x.foto?`<div class="photos"><img src="${fotoUrl(x.foto)}" data-img="${esc(x.foto)}"></div>`:''}${!resid&&!x.entregado?`<div style="margin-top:8px"><button class="btn ok sm" data-ent="${x.id}">Marcar entregada</button></div>`:''}</div>`).join('')||'<div class="empty">Nada por aquí</div>'; };
  $('#eList').addEventListener('click', async e=>{ const img=e.target.closest('[data-img]'); if(img) return viewImg(img.dataset.img); const b=e.target.closest('[data-ent]'); if(b){ const quien=await askText('¿Quién retira? (nombre, opcional)'); if(quien===null) return; try{ await q(T('encomiendas').update({entregado:true, entregado_at:now(), entregado_por:S.uid, retirado_por:quien}).eq('id',b.dataset.ent)); toast('Entregada'); }catch(err){ toast(errMsg(err)); } } });
  watch('encomiendas', ()=>q(T('encomiendas').select('*').order('ts',{ascending:false}).limit(500)), rows=>{ docs=rows; draw(); });
};

// VISITAS
VIEWS.visitas = function(){
  const r=role(); const resid=['residente','propietario'].includes(r);
  setMain(`<h1>Visitas</h1><div style="margin-bottom:10px"><button class="btn" id="bNewV">+ ${resid?'Anunciar visita':'Registrar visita'}</button></div><div class="tabs" id="vTabs"><button data-t="hoy" class="on">Hoy</button><button data-t="prox">Próximas</button><button data-t="hist">Historial</button></div><div id="vList" class="list"></div>`);
  $('#bNewV').addEventListener('click',()=>{ const m=modal(`<h3>${resid?'Anunciar visita':'Registrar visita'}</h3><form id="fV">${resid?'':`<label class="f"><span>Departamento</span><input type="text" name="depto" list="dl" required><datalist id="dl">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist></label>`}<label class="f"><span>Nombre del visitante</span><input type="text" name="nombre" required></label><div class="row"><label class="f grow"><span>RUT / documento</span><input type="text" name="rut"></label><label class="f grow"><span>Patente (opcional)</span><input type="text" name="patente"></label></div><div class="row"><label class="f grow"><span>Fecha</span><input type="date" name="fecha" value="${todayStr()}" required></label><label class="f grow"><span>Hora aprox.</span><input type="time" name="hora"></label></div><label class="f"><span>Nota</span><input type="text" name="nota" placeholder="Ej: delivery, técnico, familiar"></label><button class="btn full">Guardar</button></form>`);
    $('#fV',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('visitas').insert({depto:resid?myDepto():d.depto.trim(), nombre:d.nombre.trim(), rut:d.rut.trim(), patente:d.patente.trim().toUpperCase(), fecha:d.fecha, hora:d.hora, nota:d.nota.trim(), estado:resid?'anunciada':'ingreso', ingreso_at:resid?null:now(), uid:S.uid})); closeModal(); toast('Guardado'); }catch(err){ toast('Error: '+errMsg(err)); } }); });
  let tab='hoy', docs=[]; $('#vTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#vTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; draw(); });
  const EV={anunciada:['Anunciada','in'],ingreso:['En el edificio','ok'],salida:['Salió','mu'],no_llego:['No llegó','mu']};
  const draw=()=>{ const el=$('#vList'); if(!el) return; const hoy=todayStr(); let d=docs; if(resid) d=d.filter(x=>x.depto===myDepto()); if(tab==='hoy') d=d.filter(x=>x.fecha===hoy); else if(tab==='prox') d=d.filter(x=>x.fecha>hoy); else d=d.filter(x=>x.fecha<hoy); d=sortBy(d,x=>x.fecha+(x.hora||''),tab==='hist');
    el.innerHTML=d.map(x=>`<div class="item static"><div class="hd"><b>${esc(x.nombre)}${resid?'':' → Depto '+esc(x.depto)}</b>${pillOf(EV,x.estado)}</div><div class="meta">${fmtDay(x.fecha)} ${esc(x.hora||'')}${x.rut?' · '+esc(x.rut):''}${x.patente?' · '+esc(x.patente):''}${x.nota?' · '+esc(x.nota):''}${x.ingreso_at?' · ingreso '+fmtDate(x.ingreso_at):''}${x.salida_at?' · salida '+fmtDate(x.salida_at):''}</div>
    ${!resid?`<div class="row" style="margin-top:8px;gap:6px">${x.estado==='anunciada'?`<button class="btn ok sm" data-in="${x.id}">Registrar ingreso</button>`:''}${x.estado==='ingreso'?`<button class="btn sec sm" data-out="${x.id}">Registrar salida</button>`:''}</div>`:(x.estado==='anunciada'?`<div style="margin-top:8px"><button class="btn sec sm" data-del="${x.id}">Cancelar</button></div>`:'')}</div>`).join('')||'<div class="empty">Sin visitas</div>'; };
  $('#vList').addEventListener('click', async e=>{ const i=e.target.closest('[data-in]'), o=e.target.closest('[data-out]'), d=e.target.closest('[data-del]'); try{ if(i) await q(T('visitas').update({estado:'ingreso', ingreso_at:now()}).eq('id',i.dataset.in)); if(o) await q(T('visitas').update({estado:'salida', salida_at:now()}).eq('id',o.dataset.out)); if(d&&await confirmBox('¿Cancelar la visita anunciada?')) await q(T('visitas').delete().eq('id',d.dataset.del)); }catch(err){ toast('Error: '+errMsg(err)); } });
  watch('visitas', ()=>q(T('visitas').select('*').order('fecha',{ascending:false}).limit(600)), rows=>{ docs=rows; draw(); });
};

// DOCUMENTOS
VIEWS.documentos = function(){
  const puede=['comite','admin'].includes(role()); const CATS=['Reglamento','Actas','Balances','Contratos','Certificados','Otros'];
  setMain(`<h1>Documentos</h1>${puede?'<div style="margin-bottom:10px"><button class="btn" id="bNewD">+ Subir documento</button></div>':''}<div id="dList"></div>`);
  $('#bNewD')?.addEventListener('click',()=>{ const m=modal(`<h3>Subir documento</h3><form id="fD"><label class="f"><span>Nombre</span><input type="text" name="nombre" required></label><label class="f"><span>Categoría</span><select name="cat">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></label><label class="f"><span>Archivo (PDF, imagen, texto)</span><input type="file" name="f" required accept="application/pdf,image/*,.txt,.csv,.md,.xlsx,.docx"></label><button class="btn full">Subir</button></form>`);
    $('#fD',m).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); const b=$('button',e.target); busy(b,true,'Subiendo…'); try{ const f=$('[name=f]',m).files[0]; const path=await uploadFile(f,'documentos'); await q(T('documentos').insert({nombre:d.nombre.trim(), cat:d.cat, path, tipo:f.type, uid:S.uid})); closeModal(); toast('Documento subido'); }catch(err){ toast('Error: '+errMsg(err)); busy(b,false); } }); });
  watch('documentos', ()=>q(T('documentos').select('*').order('ts',{ascending:false}).limit(300)), docs=>{ const el=$('#dList'); if(!el) return; const byCat={}; docs.forEach(d=>(byCat[d.cat]=byCat[d.cat]||[]).push(d));
    el.innerHTML = docs.length? Object.entries(byCat).map(([c,arr])=>`<h2>${esc(c)}</h2><div class="list">${arr.map(d=>`<div class="item static"><div class="hd"><b><a href="${fotoUrl(d.path)}" target="_blank">${esc(d.nombre)}</a></b><span class="muted small">${fmtDate(d.ts)}</span></div>${puede?`<div class="meta"><a href="#" data-del="${d.id}" data-p="${esc(d.path)}">Eliminar</a></div>`:''}</div>`).join('')}</div>`).join('') : '<div class="empty">Sin documentos</div>'; });
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
  function drawBit(){ const el=$('#bit'); if(!el) return; const rs=sortBy(porDia(),x=>x.ts,true); el.innerHTML=rs.map(x=>{const a=S.activos[x.activo_id]; return `<div class="item static"><div class="hd"><b>${esc(a?.nombre||'Activo eliminado')} · ${esc(TIPOS[x.tipo]||x.tipo)}</b><span class="muted small">${fmtDate(x.ts)}</span></div><div class="meta">${esc(userName(x.uid))}${x.valor?' · valor: <b>'+esc(x.valor)+'</b>':''}${x.nota?' · '+esc(x.nota):''}${x.via_nfc?' · 📡 NFC':''}</div>${x.foto?`<div class="photos"><img src="${fotoUrl(x.foto)}" data-img="${esc(x.foto)}"></div>`:''}</div>`;}).join('')||'<div class="empty">Sin registros ese día</div>'; }
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
  ${o.fotos_antes?.length?`<div class="small" style="margin-top:8px"><b>Antes</b></div><div class="photos">${o.fotos_antes.map(f=>`<img src="${fotoUrl(f)}" data-img="${esc(f)}">`).join('')}</div>`:''}
  ${o.fotos_despues?.length?`<div class="small" style="margin-top:8px"><b>Después</b></div><div class="photos">${o.fotos_despues.map(f=>`<img src="${fotoUrl(f)}" data-img="${esc(f)}">`).join('')}</div>`:''}
  ${o.informe?`<div class="card" style="margin-top:10px"><b>Informe técnico</b><div style="white-space:pre-wrap">${esc(o.informe)}</div>${Number(o.costo)?`<div class="small muted">Costo informado: ${clp(o.costo)}</div>`:''}${o.factura?`<a href="${fotoUrl(o.factura)}" target="_blank">Ver documento adjunto</a>`:''}</div>`:''}
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
    if(a==='cerrar'){ const mm=modal(`<h3>Cierre técnico</h3><form id="fCi"><label class="f"><span>Informe de trabajos realizados</span><textarea name="inf" required style="min-height:120px"></textarea></label><label class="f"><span>Costo (CLP, opcional)</span><input type="number" name="costo" min="0"></label><label class="f"><span>Fotos después</span><input type="file" name="fotos" accept="image/*" capture="environment" multiple></label><label class="f"><span>Cotización / factura (PDF, opcional)</span><input type="file" name="doc" accept="application/pdf,image/*"></label><button class="btn full" id="sCi">Enviar cierre</button></form>`); $('#fCi',mm).addEventListener('submit', async ev=>{ ev.preventDefault(); busy($('#sCi',mm),true,'Subiendo…'); const d=formData(ev.target); try{ const fotos=await subirFotos($('[name=fotos]',mm),'ot'); const df=$('[name=doc]',mm).files[0]; const factura=df?await uploadFile(df,'ot'):''; await upd({estado:'cierre_tecnico', salida:now(), informe:d.inf.trim(), costo:Number(d.costo)||0, fotos_despues:[...(o.fotos_despues||[]),...fotos], factura:factura||o.factura||'', historial:hist('Cierre técnico enviado')}); closeModal(); toast('Cierre enviado a administración'); }catch(err){ toast(errMsg(err)); busy($('#sCi',mm),false); } }); return; }
    if(a==='aprobar'){ await upd({estado:'aprobada', aprobado_at:now(), historial:hist('Aprobada por administración')}); if(o.incidencia_id){ const inc=await q(T('incidencias').select('*').eq('id',o.incidencia_id).maybeSingle()); if(inc) await q(T('incidencias').update({estado:'resuelta', historial:[...(inc.historial||[]),{ts:now(),uid:S.uid,accion:'OT aprobada → resuelta'}]}).eq('id',inc.id)); } if(o.preventiva&&o.activo_id) await q(T('activos').update({ultima_mantencion:todayStr()}).eq('id',o.activo_id)); }
    if(a==='devolver'){ const n=await askText('Qué falta / observaciones'); if(n===null) return; await upd({estado:'en_terreno', historial:hist('Devuelta a terreno',{nota:n})}); }
    if(a==='reasignar'){ const emps=Object.values(S.empresas); const mm=modal(`<h3>Reasignar</h3><form id="fRe"><select name="e" required>${emps.map(e=>`<option value="${e.id}" ${e.id===o.empresa_id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select><button class="btn full" style="margin-top:10px">Reasignar</button></form>`); $('#fRe',mm).addEventListener('submit', async ev=>{ ev.preventDefault(); const eid=$('[name=e]',mm).value; try{ await upd({empresa_id:eid, estado:'asignada', historial:hist('Reasignada a '+(S.empresas[eid]?.nombre||''))}); closeModal(); toast('Reasignada'); }catch(err){ toast(errMsg(err)); } }); return; }
    closeModal(); toast('Actualizada');
  }catch(err){ toast('Error: '+errMsg(err)); } });
}

// ADMINISTRACIÓN
VIEWS.admin = function(param){
  const tabs={edificio:'Edificio',usuarios:'Usuarios',unidades:'Unidades',espacios:'Espacios',activos:'Activos',empresas:'Empresas'};
  let tab = tabs[param]? param : (tabs[S._adminTab]? S._adminTab : 'edificio');
  setMain(`<h1>Administración</h1><div class="tabs" id="aTabs">${Object.entries(tabs).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div><div id="aBody"></div>`);
  $('#aTabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; $$('#aTabs button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); tab=b.dataset.t; S._adminTab=tab; draw(); });
  const draw=()=>{ const old=$('#aBody'); if(!old) return; const el=old.cloneNode(false); old.replaceWith(el); ADMIN[tab](el); }; draw();
  REFRESH.admin=()=>{ if(tab!=='edificio') draw(); };
};
const ADMIN={};
ADMIN.edificio = function(el){
  const c=S.cfg||{};
  el.innerHTML=`<div class="card"><h3>Datos del edificio</h3><form id="fEd"><div class="row" style="align-items:flex-start"><div><div class="logo-prev" id="logoPrev">${c.logo?`<img src="${fotoUrl(c.logo)}">`:'🏢'}</div><input type="file" id="logoIn" accept="image/*" style="display:none"><div class="row" style="margin-top:6px;gap:4px"><button type="button" class="btn sec sm" id="bLogo">Cambiar logo</button>${c.logo?'<button type="button" class="btn sec sm" id="bLogoDel">Quitar</button>':''}</div></div><div class="grow"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(c.nombre||'')}" required></label><label class="f"><span>Dirección</span><input type="text" name="direccion" value="${esc(c.direccion||'')}"></label></div></div>
  <div class="row"><label class="f grow"><span>Comuna / ciudad</span><input type="text" name="comuna" value="${esc(c.comuna||'')}"></label><label class="f grow"><span>Teléfono conserjería</span><input type="tel" name="telefono" value="${esc(c.telefono||'')}"></label></div>
  <label class="f"><span>Email administración</span><input type="email" name="email" value="${esc(c.email||'')}"></label>
  <label class="f"><span>Datos bancarios para transferir gastos comunes (visibles a residentes)</span><textarea name="datos_bancarios" placeholder="Banco, tipo de cuenta, número, RUT, correo">${esc(c.datos_bancarios||'')}</textarea></label>
  <label class="f"><span>Aviso de privacidad (se muestra al registrarse y en Mi cuenta; vacío = texto por defecto)</span><textarea name="privacidad" placeholder="Quién es responsable de los datos, para qué se usan, por cuánto tiempo se guardan y cómo ejercer los derechos de acceso, rectificación y eliminación.">${esc(c.privacidad||'')}</textarea></label>
  <label class="f"><span>Color principal</span><input type="color" name="color" value="${esc(c.color||'#1e5eff')}" style="width:60px;height:36px;padding:2px;border:1px solid var(--bd);border-radius:8px"></label>
  <button class="btn">Guardar cambios</button></form></div>
  <div class="card"><h3>Invitar a la comunidad</h3><p class="small muted">Comparte este enlace con residentes, conserjes y empresas. Al crear su cuenta quedarán asociados a este edificio y pendientes de tu aprobación en Usuarios.</p><div class="row wrap"><input type="text" id="invUrl" class="grow" readonly value="${esc(location.origin+location.pathname+'?e='+(c.codigo||''))}"><button type="button" class="btn sec" id="bInv">Copiar enlace</button></div><p class="small muted" style="margin:8px 0 0">Código de invitación: <code>${esc(c.codigo||'')}</code></p></div>`;
  $('#bInv',el).addEventListener('click', async()=>{ const i=$('#invUrl',el); try{ await navigator.clipboard.writeText(i.value); toast('Enlace copiado'); }catch(e){ i.select(); toast('Copia el enlace seleccionado'); } });
  let newLogo=null;
  $('#bLogo',el).addEventListener('click',()=>$('#logoIn',el).click());
  $('#logoIn',el).addEventListener('change', async e=>{ const f=e.target.files[0]; if(!f) return; try{ toast('Subiendo logo…'); newLogo=await uploadImage(f,'logo'); $('#logoPrev',el).innerHTML=`<img src="${fotoUrl(newLogo)}">`; toast('Logo listo, guarda los cambios'); }catch(err){ toast('Error: '+errMsg(err)); } });
  $('#bLogoDel',el)?.addEventListener('click',()=>{ newLogo=''; $('#logoPrev',el).innerHTML='🏢'; });
  $('#fEd',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('edificios').update({nombre:d.nombre.trim(), direccion:d.direccion.trim(), comuna:d.comuna.trim(), telefono:d.telefono.trim(), email:d.email.trim(), datos_bancarios:d.datos_bancarios.trim(), privacidad:d.privacidad.trim(), color:d.color, ...(newLogo!==null?{logo:newLogo}:{}), actualizado:now()}).eq('id',S.cfg.id)); toast('Guardado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
ADMIN.usuarios = function(el){
  const us=Object.values(S.users); const pend=us.filter(u=>u.estado==='pendiente'); const act=us.filter(u=>u.estado!=='pendiente');
  const row=u=>`<tr><td><b>${esc(u.nombre)}</b><br><span class="muted small">${esc(u.telefono||'')}${u.id===S.uid?' · (tú)':''}</span></td><td><input type="text" value="${esc(u.depto||'')}" data-dep="${u.id}" style="width:90px;padding:5px 7px" list="dlu"></td><td><select data-rol="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}>${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.rol===k?'selected':''}>${v}</option>`).join('')}</select>${u.rol==='mantencion'?`<br><select data-emp="${u.id}" style="width:auto;padding:5px 7px;margin-top:4px"><option value="">— empresa —</option>${Object.values(S.empresas).map(e=>`<option value="${e.id}" ${u.empresa_id===e.id?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select>`:''}</td><td><select data-est="${u.id}" style="width:auto;padding:5px 7px" ${u.id===S.uid?'disabled':''}><option value="activo" ${u.estado==='activo'?'selected':''}>Activo</option><option value="pendiente" ${u.estado==='pendiente'?'selected':''}>Pendiente</option><option value="bloqueado" ${u.estado==='bloqueado'?'selected':''}>Bloqueado</option></select></td></tr>`;
  el.innerHTML=`<datalist id="dlu">${Object.keys(S.unidades).map(d=>`<option value="${esc(d)}">`).join('')}</datalist>${pend.length?`<div class="card"><h3>Solicitudes pendientes (${pend.length})</h3><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${pend.map(row).join('')}</tbody></table></div>`:''}
  <div class="card"><h3>Usuarios (${act.length})</h3><div style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Depto</th><th>Rol</th><th>Estado</th></tr></thead><tbody>${act.map(row).join('')||'<tr><td colspan="4" class="muted">Sin usuarios</td></tr>'}</tbody></table></div><p class="small muted">Los usuarios se registran solos desde la pantalla de inicio de sesión ("Crear cuenta") y aparecen aquí como pendientes. Asigna depto y rol, y actívalos.</p></div>`;
  el.addEventListener('change', async e=>{ const t=e.target; const id=t.dataset.rol||t.dataset.est||t.dataset.dep||t.dataset.emp; if(!id) return; const up={}; if(t.dataset.rol) up.rol=t.value; if(t.dataset.est) up.estado=t.value; if(t.dataset.dep) up.depto=t.value.trim(); if(t.dataset.emp) up.empresa_id=t.value||null; try{ await q(T('usuarios').update(up).eq('id',id)); toast('Usuario actualizado'); }catch(err){ toast('Error: '+errMsg(err)); } });
};
ADMIN.unidades = function(el){
  const us=Object.values(S.unidades).sort((a,b)=>a.depto.localeCompare(b.depto,undefined,{numeric:true})); const suma=us.reduce((a,u)=>a+(Number(u.alicuota)||0),0);
  el.innerHTML=`<div class="card"><h3>Unidades y alícuotas</h3><p class="small muted">La alícuota (%) de cada unidad define su parte del gasto común. Suma actual: <b style="color:${Math.abs(suma-100)<0.05?'var(--ok)':'var(--er)'}">${suma.toFixed(2)}%</b> (debe ser 100%).</p>
  <form id="fU" class="row wrap" style="margin-bottom:12px"><input type="text" name="depto" placeholder="Depto (ej: 1204)" required style="width:130px"><input type="number" name="alicuota" placeholder="Alícuota %" step="0.0001" min="0" required style="width:120px"><input type="text" name="prop" placeholder="Propietario (opcional)" class="grow"><button class="btn">Agregar</button></form>
  <details><summary>Carga masiva (pegar: depto;alícuota;propietario por línea)</summary><textarea id="bulk" placeholder="101;1.25;Juan Pérez&#10;102;1.30;"></textarea><button class="btn sec sm" id="bBulk" style="margin-top:6px">Cargar</button></details>
  <div style="overflow:auto;margin-top:10px"><table><thead><tr><th>Unidad</th><th class="num">Alícuota</th><th>Propietario</th><th></th></tr></thead><tbody>${us.map(u=>`<tr><td>${esc(u.depto)}</td><td class="num"><input type="number" value="${Number(u.alicuota)}" step="0.0001" data-al="${esc(u.depto)}" style="width:100px;padding:4px 6px;text-align:right"></td><td><input type="text" value="${esc(u.prop||'')}" data-pr="${esc(u.depto)}" style="padding:4px 6px"></td><td><button class="btn sec sm" data-del="${esc(u.depto)}">✕</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sin unidades</td></tr>'}</tbody></table></div></div>`;
  $('#fU',el).addEventListener('submit', async e=>{ e.preventDefault(); const d=formData(e.target); try{ await q(T('unidades').upsert({edificio_id:S.me.edificio_id, depto:d.depto.trim(), alicuota:Number(d.alicuota), prop:d.prop.trim()})); e.target.reset(); toast('Unidad agregada'); }catch(err){ toast(errMsg(err)); } });
  $('#bBulk',el).addEventListener('click', async()=>{ const lines=$('#bulk',el).value.split('\n').map(l=>l.trim()).filter(Boolean); const rows=lines.map(l=>{ const [d,a,p]=l.split(/[;,\t]/); return d?{edificio_id:S.me.edificio_id, depto:d.trim(), alicuota:Number(String(a||'0').replace(',','.'))||0, prop:(p||'').trim()}:null; }).filter(Boolean); if(!rows.length) return; try{ await q(T('unidades').upsert(rows)); toast(rows.length+' unidades cargadas'); }catch(err){ toast(errMsg(err)); } });
  el.addEventListener('change', async e=>{ const t=e.target; try{ if(t.dataset.al) await q(T('unidades').update({alicuota:Number(t.value)||0}).eq('depto',t.dataset.al)); if(t.dataset.pr) await q(T('unidades').update({prop:t.value.trim()}).eq('depto',t.dataset.pr)); }catch(err){ toast(errMsg(err)); } });
  el.addEventListener('click', async e=>{ const b=e.target.closest('[data-del]'); if(b&&await confirmBox('¿Eliminar unidad '+b.dataset.del+'?')) await q(T('unidades').delete().eq('depto',b.dataset.del)); });
};
ADMIN.espacios = function(el){
  const esp=S.cfg?.espacios||[];
  el.innerHTML=`<div class="card"><h3>Áreas comunes reservables</h3><div class="list">${esp.map((e,i)=>`<div class="item static"><div class="hd"><b>${esc(e.nombre)}</b><span class="row" style="gap:4px"><button class="btn sec sm" data-ed="${i}">Editar</button><button class="btn sec sm" data-del="${i}">✕</button></span></div><div class="meta">Capacidad ${e.capacidad} · ${e.desde}–${e.hasta} · máx ${e.maxHoras} h · ${e.anticipacionDias} días anticipación · ${e.aprobacion?'requiere aprobación':'automática'}${e.costo?' · '+clp(e.costo):''}</div></div>`).join('')||'<div class="muted">Sin espacios</div>'}</div><div class="row" style="margin-top:10px;gap:6px"><button class="btn" id="bAdd">+ Agregar espacio</button>${esp.length?'':'<button class="btn sec" id="bDef">Cargar ejemplos (quincho, salón, gimnasio, sala de juegos)</button>'}</div></div>`;
  const save=arr=>q(T('edificios').update({espacios:arr}).eq('id',S.cfg.id));
  const form=(e={}, idx=-1)=>{ const m=modal(`<h3>${idx>=0?'Editar':'Nuevo'} espacio</h3><form id="fE"><label class="f"><span>Nombre</span><input type="text" name="nombre" value="${esc(e.nombre||'')}" required></label><div class="row"><label class="f grow"><span>Capacidad</span><input type="number" name="capacidad" value="${e.capacidad||10}"></label><label class="f grow"><span>Costo (CLP)</span><input type="number" name="costo" value="${e.costo||0}"></label></div><div class="row"><label class="f grow"><span>Desde</span><input type="time" name="desde" value="${e.desde||'09:00'}" required></label><label class="f grow"><span>Hasta</span><input type="time" name="hasta" value="${e.hasta||'22:00'}" required></label></div><div class="row"><label class="f grow"><span>Máx. horas por reserva</span><input type="number" name="maxHoras" value="${e.maxHoras||2}" min="1"></label><label class="f grow"><span>Anticipación máx. (días)</span><input type="number" name="anticipacionDias" value="${e.anticipacionDias||30}" min="1"></label></div><label class="sw"><input type="checkbox" name="aprobacion" ${e.aprobacion?'checked':''}> Requiere aprobación del comité/administración</label><button class="btn full" style="margin-top:12px">Guardar</button></form>`);
    $('#fE',m).addEventListener('submit', async ev=>{ ev.preventDefault(); const d=formData(ev.target); const obj={id:e.id||seg(d.nombre).toLowerCase()+'_'+rnd().slice(-4), nombre:d.nombre.trim(), capacidad:Number(d.capacidad), costo:Number(d.costo)||0, desde:d.desde, hasta:d.hasta, maxHoras:Number(d.maxHoras)||1, anticipacionDias:Number(d.anticipacionDias)||30, aprobacion:!!d.aprobacion}; const arr=esp.slice(); if(idx>=0) arr[idx]=obj; else arr.push(obj); closeModal(); try{ await save(arr); toast('Guardado'); }catch(err){ toast(errMsg(err)); } }); };
  $('#bAdd',el).addEventListener('click',()=>form());
  $('#bDef',el)?.addEventListener('click', async()=>{ await save([
    {id:'quincho', nombre:'Quincho', capacidad:15, desde:'10:00', hasta:'23:00', maxHoras:5, anticipacionDias:30, aprobacion:true, costo:0},
    {id:'salon', nombre:'Salón de eventos', capacidad:40, desde:'10:00', hasta:'23:00', maxHoras:6, anticipacionDias:60, aprobacion:true, costo:0},
    {id:'gym', nombre:'Gimnasio', capacidad:4, desde:'06:00', hasta:'23:00', maxHoras:1, anticipacionDias:3, aprobacion:false, costo:0},
    {id:'juegos', nombre:'Sala de juegos', capacidad:8, desde:'10:00', hasta:'22:00', maxHoras:2, anticipacionDias:7, aprobacion:false, costo:0}]); });
  el.addEventListener('click', async e=>{ const ed=e.target.closest('[data-ed]'), del=e.target.closest('[data-del]'); if(ed) form(esp[+ed.dataset.ed],+ed.dataset.ed); if(del&&await confirmBox('¿Eliminar espacio?')){ const arr=esp.slice(); arr.splice(+del.dataset.del,1); await save(arr); } });
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
