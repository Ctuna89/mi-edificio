/* =====================================================================
   Cliente del modo local. Ofrece a web/app.js la misma interfaz que usa de supabase-js
   (consultas, funciones, sesión, archivos y avisos de cambios), pero hablando con
   local/server.mjs en el mismo origen. La sesión va en una cookie HttpOnly.
   ===================================================================== */
(function(){
'use strict';
async function api(ruta, cuerpo){
  let r, j=null;
  try{ r=await fetch(ruta,{method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(cuerpo||{}), credentials:'same-origin'}); }
  catch(e){ return {data:null, error:{message:'No se pudo conectar con el servidor del edificio'}}; }
  try{ j=await r.json(); }catch(e){}
  if(!r.ok) return {data:null, error:{message:(j&&j.error)||('Error '+r.status)}};
  return {data:j?j.data:null, error:null};
}

function consulta(t){
  const st={t, op:'select', f:[], ord:null, lim:null, one:false, p:null, ret:false};
  const b={
    select(){ if(st.op!=='select') st.ret=true; return b; },
    insert(p){ st.op='insert'; st.p=p; return b; }, upsert(p){ st.op='upsert'; st.p=p; return b; },
    update(p){ st.op='update'; st.p=p; return b; }, delete(){ st.op='delete'; return b; },
    eq(k,v){ st.f.push([k,'eq',v]); return b; }, gte(k,v){ st.f.push([k,'gte',v]); return b; }, gt(k,v){ st.f.push([k,'gt',v]); return b; },
    lt(k,v){ st.f.push([k,'lt',v]); return b; }, lte(k,v){ st.f.push([k,'lte',v]); return b; }, neq(k,v){ st.f.push([k,'neq',v]); return b; },
    is(k,v){ st.f.push([k,'is',v]); return b; }, in(k,v){ st.f.push([k,'in',v]); return b; },
    order(k,o){ st.ord={k, asc:!o||o.ascending!==false}; return b; }, limit(n){ st.lim=n; return b; }, maybeSingle(){ st.one=true; return b; },
    then(ok,mal){ return api('/api/db',st).then(ok,mal); },
  };
  return b;
}

function createClient(){
  let sesion, oyentes=[];
  const cargar=()=>fetch('/api/auth/sesion',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.data||null).catch(()=>null);
  const avisar=ev=>oyentes.forEach(f=>{ try{ f(ev,sesion); }catch(e){ console.error(e); } });
  const entrar=async(ruta,cred)=>{ const r=await api(ruta,{email:cred.email, clave:cred.password}); if(r.error) return r; sesion=r.data; avisar('SIGNED_IN'); return {data:{session:sesion, user:sesion.user}, error:null}; };

  // Cambios en vivo: el servidor avisa "algo cambió" y cada vista vuelve a consultar lo suyo
  let es=null; const canales=new Set();
  const conectar=()=>{ if(es||!canales.size) return; es=new EventSource('/api/eventos'); es.onmessage=()=>canales.forEach(c=>c._f.forEach(f=>{ try{ f(); }catch(e){ console.error(e); } })); };
  const cortar=()=>{ if(es&&!canales.size){ es.close(); es=null; } };

  return {
    from:consulta,
    rpc:(nombre,args)=>api('/api/rpc/'+encodeURIComponent(nombre), args||{}),
    channel(){ const c={_f:[], on(_ev,_spec,f){ c._f.push(f); return c; }, subscribe(){ canales.add(c); conectar(); return c; }}; return c; },
    removeChannel(c){ canales.delete(c); cortar(); },
    auth:{
      async getSession(){ if(sesion===undefined) sesion=await cargar(); return {data:{session:sesion}}; },
      onAuthStateChange(f){ oyentes.push(f); return {data:{subscription:{unsubscribe(){ oyentes=oyentes.filter(x=>x!==f); }}}}; },
      signInWithPassword:c=>entrar('/api/auth/entrar',c),
      signUp:c=>entrar('/api/auth/registro',c),
      async signOut(){ await api('/api/auth/salir'); sesion=null; avisar('SIGNED_OUT'); return {error:null}; },
      updateUser:d=>api('/api/auth/clave',{clave:d.password}),
      resetPasswordForEmail:async()=>({data:null, error:{message:'En esta instalación la contraseña la restablece la administración del edificio.'}}),
    },
    storage:{ from:()=>({
      async upload(ruta, blob, o){ let r,j=null; try{ r=await fetch('/api/archivos/subir?ruta='+encodeURIComponent(ruta),{method:'POST', headers:{'content-type':(o&&o.contentType)||blob.type||'application/octet-stream','x-mi-edificio':'1'}, body:blob, credentials:'same-origin'}); j=await r.json(); }catch(e){ return {data:null, error:{message:'No se pudo subir el archivo'}}; }
        return r.ok?{data:{path:ruta}, error:null}:{data:null, error:{message:(j&&j.error)||'No se pudo subir el archivo'}}; },
      createSignedUrls:(rutas,seg)=>api('/api/archivos/firmar',{rutas, seg}),
      remove:rutas=>api('/api/archivos/borrar',{rutas}),
    }) },
    // Solo modo local: lo que no existe en Supabase
    local:{ restablecer:(uid,clave)=>api('/api/auth/restablecer',{uid, clave}),
      // respaldo cifrado en una carpeta sincronizada con la nube (OneDrive, Google Drive…)
      // versión instalada, versiones nuevas y actualización con un clic
      sistema:{ estado:()=>api('/api/sistema/estado'), buscar:()=>api('/api/sistema/buscar'), actualizar:()=>api('/api/sistema/actualizar') },
      // acceso desde internet mediante un túnel de Cloudflare que maneja el servidor
      tunel:{ estado:()=>api('/api/tunel/estado'), configurar:d=>api('/api/tunel/configurar',d) },
      correo:{ estado:()=>api('/api/correo/estado'), configurar:d=>api('/api/correo/configurar',d), probar:para=>api('/api/correo/probar',{para}), enviar:()=>api('/api/correo/enviar') },
  respaldo:{ estado:()=>api('/api/respaldo/estado'), configurar:d=>api('/api/respaldo/configurar',d), ahora:()=>api('/api/respaldo/ahora') } },
  };
}
window.supabase={createClient};
})();
