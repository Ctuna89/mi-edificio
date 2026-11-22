// =====================================================================
//  Mi Edificio — servidor local
//  Un solo programa que sirve la app (carpeta web/), guarda la base de datos en una carpeta
//  (Postgres embebido, PGlite) y hace lo que en la nube hace Supabase: cuentas, permisos,
//  archivos, avisos de cambios, tareas programadas, notificaciones push y respaldos.
//
//  La seguridad sigue en supabase/schema.sql: cada petición se ejecuta con el rol
//  "authenticated" y el usuario de la sesión, así que rigen las mismas políticas RLS.
//
//  Uso:  npm install && npm start          (dentro de local/)
//  Variables: PUERTO (8080) · MI_EDIFICIO_DATOS (local/datos) · MI_EDIFICIO_CONTACTO (mailto:…)
// =====================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const WEB = path.join(RAIZ, 'web');
const DATOS = path.resolve(process.env.MI_EDIFICIO_DATOS || path.join(AQUI, 'datos'));
const PUERTO = Number(process.env.PUERTO || process.env.PORT || 8080);
const DIR = { db: path.join(DATOS, 'db'), archivos: path.join(DATOS, 'archivos'), respaldos: path.join(DATOS, 'respaldos') };
const SESION_DIAS = 30, MAX_JSON = 2 * 1024 * 1024, MAX_ARCHIVO = 15 * 1024 * 1024;
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

// ---------------------------------------------------------------------
// Arranque: carpetas, configuración local, base de datos y esquema
// ---------------------------------------------------------------------
for (const d of Object.values(DIR)) fs.mkdirSync(d, { recursive: true });

const restaurar = process.argv.includes('--restaurar') ? process.argv[process.argv.indexOf('--restaurar') + 1] : null;
let opcionesDb = { extensions: { pgcrypto } };
if (restaurar) {
  if (fs.readdirSync(DIR.db).length) { console.error(`Para restaurar, la carpeta ${DIR.db} debe estar vacía (muévela primero).`); process.exit(1); }
  opcionesDb.loadDataDir = new Blob([fs.readFileSync(restaurar)]);
  log('Restaurando la base de datos desde', restaurar);
}
const db = await PGlite.create({ dataDir: DIR.db, ...opcionesDb });
await db.exec(fs.readFileSync(path.join(AQUI, 'base.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase', 'schema.sql'), 'utf8'));
await db.exec(`update public.plataforma set push_url = 'local' where coalesce(push_url, '') = ''`);

// Secreto para firmar enlaces a archivos y claves VAPID de las notificaciones: se crean una vez
const rutaCfg = path.join(DATOS, 'config.json');
let CFG = fs.existsSync(rutaCfg) ? JSON.parse(fs.readFileSync(rutaCfg, 'utf8')) : {};
let webpush = null;
try { webpush = (await import('web-push')).default; } catch { log('web-push no está instalado: sin notificaciones push'); }
if (!CFG.secreto) CFG.secreto = crypto.randomBytes(32).toString('hex');
if (!CFG.vapid && webpush) CFG.vapid = webpush.generateVAPIDKeys();
fs.writeFileSync(rutaCfg, JSON.stringify(CFG, null, 2), { mode: 0o600 });
if (webpush && CFG.vapid) webpush.setVapidDetails(process.env.MI_EDIFICIO_CONTACTO || 'mailto:admin@example.com', CFG.vapid.publicKey, CFG.vapid.privateKey);

// Catálogo: tablas, claves primarias y funciones que la app puede usar (las de "public")
const ident = s => { if (typeof s !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(s)) throw new Fallo('Nombre no válido'); return '"' + s + '"'; };
const TABLAS = new Map(), FUNCIONES = new Map();
{
  const t = await db.query(`select c.relname t, coalesce((select array_agg(a.attname order by k.ord) from pg_index i
      join unnest(i.indkey) with ordinality k(attnum, ord) on true join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = c.oid and i.indisprimary), '{}') pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
  t.rows.forEach(r => TABLAS.set(r.t, { pk: r.pk }));
  const f = await db.query(`select p.proname n, p.proretset s, p.provolatile v, format_type(p.prorettype, null) r,
      coalesce(p.proargnames, '{}') nombres, array(select format_type(x, null) from unnest(p.proargtypes) x) tipos
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype`);
  f.rows.forEach(r => FUNCIONES.set(r.n, { set: r.s, volatil: r.v === 'v', ret: r.r, args: r.tipos.map((tipo, i) => ({ nombre: r.nombres[i], tipo })) }));
}

class Fallo extends Error { constructor(m, estado = 400) { super(m); this.estado = estado; } }
// Ejecuta fn dentro de una transacción con los permisos del usuario (o del sistema si uid es null)
const como = (uid, fn) => db.transaction(async tx => {
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
  if (uid) await tx.exec('set local role authenticated');
  return fn(tx);
});

// ---------------------------------------------------------------------
// Cuentas y sesiones
// ---------------------------------------------------------------------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cifrar = clave => { const sal = crypto.randomBytes(16); return sal.toString('hex') + ':' + crypto.scryptSync(clave, sal, 64).toString('hex'); };
const coincide = (clave, guardada) => { const [sal, h] = String(guardada).split(':'); if (!sal || !h) return false; const x = crypto.scryptSync(clave, Buffer.from(sal, 'hex'), 64); const y = Buffer.from(h, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const validarClave = c => { if (typeof c !== 'string' || c.length < 8 || c.length > 200) throw new Fallo('Password should be at least 8 characters'); };
const galleta = req => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(x => x[0] === 'me_sesion')?.[1] || '';
const esHttps = req => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const ponerGalleta = (req, res, token, seg) => res.setHeader('Set-Cookie', `me_sesion=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seg}${esHttps(req) ? '; Secure' : ''}`);
async function sesionDe(req) {
  const tk = galleta(req); if (!tk) return null;
  const r = await db.query(`select u.id, u.email from auth.sesiones s join auth.users u on u.id = s.user_id where s.token_hash = $1 and s.expira > now()`, [sha(tk)]);
  return r.rows[0] ? { user: { id: r.rows[0].id, email: r.rows[0].email } } : null;
}
async function abrirSesion(req, res, user) {
  const tk = crypto.randomBytes(32).toString('base64url');
  await db.query(`insert into auth.sesiones (token_hash, user_id, expira) values ($1, $2, now() + make_interval(days => $3))`, [sha(tk), user.id, SESION_DIAS]);
  ponerGalleta(req, res, tk, SESION_DIAS * 86400);
  return { user: { id: user.id, email: user.email } };
}
// Freno a los intentos de adivinar contraseñas: 8 fallos seguidos → 5 minutos de espera
const intentos = new Map();
const ipDe = req => (req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '');
function frenar(clave) { const x = intentos.get(clave); if (x && x.n >= 8 && x.hasta > Date.now()) throw new Fallo('Demasiados intentos. Espera unos minutos.', 429); }
function anotar(clave, ok) { if (ok) return intentos.delete(clave); const x = intentos.get(clave) || { n: 0 }; x.n++; x.hasta = Date.now() + 5 * 60000; intentos.set(clave, x); }
setInterval(() => { const a = Date.now(); for (const [k, v] of intentos) if (v.hasta < a) intentos.delete(k); }, 600000).unref();

const AUTH = {
  async registro(req, res, { email, clave }) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new Fallo('El correo no es válido');
    validarClave(clave); frenar('r|' + ipDe(req)); anotar('r|' + ipDe(req), false);   // también limita la creación masiva de cuentas
    const ya = await db.query(`select 1 from auth.users where email = $1`, [email]);
    if (ya.rows.length) throw new Fallo('User already registered');
    const r = await db.query(`insert into auth.users (email, clave) values ($1, $2) returning id, email`, [email, cifrar(clave)]);
    return abrirSesion(req, res, r.rows[0]);
  },
  async entrar(req, res, { email, clave }) {
    email = String(email || '').trim().toLowerCase(); const k = email + '|' + ipDe(req); frenar(k);
    const r = await db.query(`select id, email, clave from auth.users where email = $1`, [email]);
    const ok = !!r.rows[0] && coincide(String(clave || ''), r.rows[0].clave); anotar(k, ok);
    if (!ok) throw new Fallo('Invalid login credentials');
    return abrirSesion(req, res, r.rows[0]);
  },
  async salir(req, res) { const tk = galleta(req); if (tk) await db.query(`delete from auth.sesiones where token_hash = $1`, [sha(tk)]); ponerGalleta(req, res, '', 0); return null; },
  async clave(req, res, { clave }, ses) {
    if (!ses) throw new Fallo('Debes iniciar sesión', 401); validarClave(clave);
    await db.query(`update auth.users set clave = $1 where id = $2`, [cifrar(clave), ses.user.id]);
    await db.query(`delete from auth.sesiones where user_id = $1 and token_hash <> $2`, [ses.user.id, sha(galleta(req))]);
    return null;
  },
  // Sin correo no hay enlace de recuperación: la administración fija una contraseña nueva
  async restablecer(req, res, { uid, clave }, ses) {
    if (!ses) throw new Fallo('Debes iniciar sesión', 401); validarClave(clave);
    const ok = await como(ses.user.id, tx => tx.query(`select public.es_admin() and exists (select 1 from public.usuarios where id = $1 and edificio_id = public.mi_edificio()) as ok`, [uid]));
    if (!ok.rows[0]?.ok) throw new Fallo('Solo la administración puede restablecer contraseñas', 403);
    await db.query(`update auth.users set clave = $1 where id = $2`, [cifrar(clave), uid]);
    await db.query(`delete from auth.sesiones where user_id = $1`, [uid]);
    return null;
  },
};

// ---------------------------------------------------------------------
// Consultas de la app → SQL. Los valores viajan como JSON y Postgres los convierte al tipo
// de cada columna (jsonb_populate_record), igual que hace la API de Supabase.
// ---------------------------------------------------------------------
async function consultar(uid, q) {
  if (!TABLAS.has(q.t)) throw new Fallo('Tabla no válida');
  const T = 'public.' + ident(q.t), P = [], p = v => { P.push(JSON.stringify(v)); return '$' + P.length + '::jsonb'; };
  const filas = Array.isArray(q.p) ? q.p : q.p ? [q.p] : [];
  const cols = filas.length ? Object.keys(filas[0]) : [];
  const filtros = (q.f || []).map(([k, op, v]) => {
    const c = ident(k), tip = x => `(jsonb_populate_record(null::${T}, ${p({ [k]: x })})).${c}`;
    if (op === 'is' || (op === 'eq' && v === null)) return v === null ? `${c} is null` : `${c} is ${v === true ? 'true' : v === false ? 'false' : 'null'}`;
    if (op === 'eq') return `${c} = ${tip(v)}`;
    if (op === 'gte') return `${c} >= ${tip(v)}`;
    if (op === 'in') return `${c} in (select x.${c} from jsonb_populate_recordset(null::${T}, ${p((v || []).map(x => ({ [k]: x })))}) x)`;
    throw new Fallo('Filtro no válido');
  });
  const donde = filtros.length ? ' where ' + filtros.join(' and ') : '';
  const dev = q.ret ? ' returning to_jsonb(t) as r' : '';
  let sql;
  if (q.op === 'select') {
    sql = `select coalesce(jsonb_agg(to_jsonb(x)), '[]') as r from (select * from ${T}${donde}${q.ord ? ` order by ${ident(q.ord.k)} ${q.ord.asc ? 'asc' : 'desc'}` : ''}${q.lim ? ' limit ' + Math.max(1, Math.min(10000, Number(q.lim) | 0)) : ''}) x`;
  } else if (q.op === 'insert' || q.op === 'upsert') {
    if (!cols.length) throw new Fallo('Sin datos');
    const lista = cols.map(ident).join(', ');
    sql = `insert into ${T} as t (${lista}) select ${lista} from jsonb_populate_recordset(null::${T}, ${p(filas)})`;
    if (q.op === 'upsert') { const pk = TABLAS.get(q.t).pk; const resto = cols.filter(c => !pk.includes(c)); sql += ` on conflict (${pk.map(ident).join(', ')}) do ${resto.length ? 'update set ' + resto.map(c => `${ident(c)} = excluded.${ident(c)}`).join(', ') : 'nothing'}`; }
    sql += dev;
  } else if (q.op === 'update') {
    if (!cols.length || !filtros.length) throw new Fallo('Una actualización necesita datos y al menos un filtro');
    const j = p(filas[0]); sql = `update ${T} as t set ${cols.map(c => `${ident(c)} = (jsonb_populate_record(null::${T}, ${j})).${ident(c)}`).join(', ')}${donde}${dev}`;
  } else if (q.op === 'delete') {
    if (!filtros.length) throw new Fallo('Un borrado necesita al menos un filtro');
    sql = `delete from ${T} as t${donde}${dev}`;
  } else throw new Fallo('Operación no válida');
  const r = await como(uid, tx => tx.query(sql, P));
  if (q.op === 'select') { const filasR = r.rows[0].r; return q.one ? (filasR[0] ?? null) : filasR; }
  return q.ret ? r.rows.map(x => x.r) : null;
}

async function llamar(uid, nombre, args) {
  const f = FUNCIONES.get(nombre); if (!f) throw new Fallo('Función no válida');
  const dados = f.args.filter(a => a.nombre && Object.hasOwn(args || {}, a.nombre));
  const expr = dados.map(a => `${ident(a.nombre)} => ${a.tipo.endsWith('[]')
    ? `(select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(($1::jsonb) -> '${a.nombre}') x)::${a.tipo}`
    : `(($1::jsonb) ->> '${a.nombre}')::${a.tipo}`}`).join(', ');
  const fn = `public.${ident(nombre)}(${expr})`, P = dados.length ? [JSON.stringify(args)] : [];
  const sql = f.set ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]') as r from ${fn} r` : f.ret === 'void' ? `select ${fn}` : `select to_jsonb(${fn}) as r`;
  const r = await como(uid, tx => tx.query(sql, P));
  return { dato: f.ret === 'void' ? null : (r.rows[0]?.r ?? null), cambia: f.volatil };
}

// ---------------------------------------------------------------------
// Archivos: en disco, con las políticas de storage.objects de schema.sql
// ---------------------------------------------------------------------
const rutaValida = r => typeof r === 'string' && r.length <= 300 && /^[A-Za-z0-9_\-][A-Za-z0-9_\-./]*$/.test(r) && !r.includes('..') && !r.includes('//');
const enDisco = r => path.join(DIR.archivos, ...r.split('/'));
const firma = (r, exp) => crypto.createHmac('sha256', CFG.secreto).update(r + '|' + exp).digest('base64url');
const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

async function subir(uid, ruta, cuerpo) {
  if (!rutaValida(ruta)) throw new Fallo('Ruta no válida');
  await como(uid, async tx => {
    await tx.query(`insert into storage.objects (bucket_id, name) values ('fotos', $1)`, [ruta]);   // RLS decide si puede
    fs.mkdirSync(path.dirname(enDisco(ruta)), { recursive: true }); fs.writeFileSync(enDisco(ruta), cuerpo);
  });
  return { path: ruta };
}
async function firmar(uid, rutas, seg) {
  rutas = (Array.isArray(rutas) ? rutas : []).filter(rutaValida).slice(0, 500); seg = Math.max(60, Math.min(86400, Number(seg) || 3600));
  const r = await como(uid, tx => tx.query(`select name from storage.objects where bucket_id = 'fotos' and name = any($1::text[])`, [rutas]));
  const visibles = new Set(r.rows.map(x => x.name)), exp = Math.floor(Date.now() / 1000) + seg;
  return rutas.map(x => ({ path: x, signedUrl: visibles.has(x) ? `/api/archivos/f/${x.split('/').map(encodeURIComponent).join('/')}?e=${exp}&s=${firma(x, exp)}` : null }));
}
async function borrar(uid, rutas) {
  rutas = (Array.isArray(rutas) ? rutas : []).filter(rutaValida);
  const r = await como(uid, tx => tx.query(`delete from storage.objects where bucket_id = 'fotos' and name = any($1::text[]) returning name`, [rutas]));
  r.rows.forEach(x => fs.rmSync(enDisco(x.name), { force: true }));
  return r.rows.map(x => ({ name: x.name }));
}
function servirArchivo(req, res, url) {
  const ruta = decodeURIComponent(url.pathname.slice('/api/archivos/f/'.length)), exp = Number(url.searchParams.get('e')), s = url.searchParams.get('s') || '';
  const esperada = firma(ruta, exp);
  if (!rutaValida(ruta) || !(exp > Date.now() / 1000) || s.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperada)) || !fs.existsSync(enDisco(ruta))) { res.writeHead(404); return res.end(); }
  const tipo = TIPOS[ruta.split('.').pop().toLowerCase()];
  // Nunca se ejecuta lo subido: tipos conocidos en línea, el resto como descarga, y todo en "sandbox"
  res.writeHead(200, { 'Content-Type': tipo || 'application/octet-stream', 'Content-Disposition': tipo ? 'inline' : 'attachment', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600' });
  fs.createReadStream(enDisco(ruta)).pipe(res);
}

// ---------------------------------------------------------------------
// Avisos de cambios (SSE), notificaciones push y tareas programadas
// ---------------------------------------------------------------------
const oyentes = new Set();
let difT = null;
const difundir = () => { clearTimeout(difT); difT = setTimeout(() => oyentes.forEach(r => r.write('data: cambio\n\n')), 80); };
setInterval(() => oyentes.forEach(r => r.write(': vivo\n\n')), 25000).unref();

const SERVICIOS_PUSH = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
let despachando = false;
async function despacharPush() {
  if (despachando) return; despachando = true;
  try {
    const cola = await db.query(`delete from net.cola returning body`);
    for (const { body } of cola.rows) {
      if (!webpush || !Array.isArray(body?.uids) || !body.uids.length) continue;
      const subs = await db.query(`select id, endpoint, p256dh, auth from public.push_subs where uid = any($1::uuid[])`, [body.uids]);
      const carga = JSON.stringify({ titulo: body.titulo, cuerpo: body.cuerpo, url: body.url });
      await Promise.all(subs.rows.map(async s => {
        let host = ''; try { const u = new URL(s.endpoint); host = u.protocol === 'https:' ? u.hostname : ''; } catch {}
        if (!SERVICIOS_PUSH.some(r => r.test(host))) return db.query(`delete from public.push_subs where id = $1`, [s.id]);
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 86400 }); }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await db.query(`delete from public.push_subs where id = $1`, [s.id]); else log('push:', e.statusCode || e.message); }
      }));
    }
  } catch (e) { log('push:', e.message); } finally { despachando = false; }
}
const trasCambio = () => { difundir(); despacharPush(); };

async function respaldar() {
  const f = await db.dumpDataDir('gzip');
  const nombre = `mi-edificio-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  fs.writeFileSync(path.join(DIR.respaldos, nombre), Buffer.from(await f.arrayBuffer()));
  const viejos = fs.readdirSync(DIR.respaldos).filter(x => /^mi-edificio-\d{4}-\d\d-\d\d\.tar\.gz$/.test(x)).sort().slice(0, -14);
  viejos.forEach(x => fs.rmSync(path.join(DIR.respaldos, x), { force: true }));
  return nombre;
}
// Cada 5 minutos: plazos de estacionamiento. Una vez al día: plazos de conservación y respaldo.
let diaHecho = '';
async function tareas() {
  try {
    const r = await db.query(`select privado.revisar_estacionamientos() as n`); if (r.rows[0].n > 0) difundir();
    await db.query(`delete from auth.sesiones where expira < now()`);
    const hoy = new Date(); const dia = hoy.toISOString().slice(0, 10);
    if (dia !== diaHecho && hoy.getHours() >= 3) {
      diaHecho = dia;
      await db.query(`select privado.depurar()`);
      const pend = await db.query(`delete from public.archivos_por_borrar returning path`);
      for (const x of pend.rows) { if (rutaValida(x.path)) { fs.rmSync(enDisco(x.path), { force: true }); await db.query(`delete from storage.objects where name = $1`, [x.path]); } }
      log('Respaldo diario:', await respaldar());
    }
    await despacharPush();
  } catch (e) { log('tareas:', e.message); }
}
setInterval(tareas, 5 * 60000).unref(); setTimeout(tareas, 15000).unref();

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEG = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
// index.html para modo local: cliente propio en vez de supabase-js por CDN, y conexiones solo al propio servidor
const indice = () => fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/, '<script src="local-cliente.js"></script>')
  .replace("script-src 'self' https://cdn.jsdelivr.net", "script-src 'self'")
  .replace("connect-src 'self' https://*.supabase.co wss://*.supabase.co", "connect-src 'self'");
const configJs = () => `// Generado por el servidor local\nwindow.APP_CONFIG = ${JSON.stringify({ LOCAL: true, VAPID_PUBLIC_KEY: (webpush && CFG.vapid?.publicKey) || '' })};\n`;

function leerCuerpo(req, max) {
  return new Promise((ok, mal) => { const trozos = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { mal(new Fallo('Demasiado grande', 413)); req.destroy(); } else trozos.push(c); });
    req.on('end', () => ok(Buffer.concat(trozos))); req.on('error', mal); });
}
const responder = (res, estado, cuerpo) => { res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEG }); res.end(JSON.stringify(cuerpo)); };
// Las peticiones que cambian algo deben venir de la propia app (mismo origen)
function mismoOrigen(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}

async function api(req, res, url) {
  const ruta = url.pathname;
  if (req.method === 'GET' && ruta === '/api/auth/sesion') return responder(res, 200, { data: await sesionDe(req) });
  if (req.method === 'GET' && ruta.startsWith('/api/archivos/f/')) return servirArchivo(req, res, url);
  if (req.method === 'GET' && ruta === '/api/eventos') {
    if (!await sesionDe(req)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...SEG }); res.write(': conectado\n\n');
    oyentes.add(res); req.on('close', () => oyentes.delete(res)); return;
  }
  if (req.method !== 'POST') throw new Fallo('No encontrado', 404);
  if (!mismoOrigen(req)) throw new Fallo('Origen no permitido', 403);

  if (ruta === '/api/archivos/subir') {
    if (req.headers['x-mi-edificio'] !== '1') throw new Fallo('Petición no válida', 403);
    const ses = await sesionDe(req); if (!ses) throw new Fallo('Debes iniciar sesión', 401);
    const dato = await subir(ses.user.id, url.searchParams.get('ruta'), await leerCuerpo(req, MAX_ARCHIVO));
    return responder(res, 200, { data: dato });
  }
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Fallo('Petición no válida', 415);
  let cuerpo; try { cuerpo = JSON.parse((await leerCuerpo(req, MAX_JSON)).toString('utf8') || '{}'); } catch (e) { if (e instanceof Fallo) throw e; throw new Fallo('JSON no válido'); }

  if (ruta.startsWith('/api/auth/')) {
    const accion = AUTH[ruta.slice('/api/auth/'.length)]; if (!accion || ruta.endsWith('/sesion')) throw new Fallo('No encontrado', 404);
    return responder(res, 200, { data: await accion(req, res, cuerpo, await sesionDe(req)) });
  }
  const ses = await sesionDe(req); if (!ses) throw new Fallo('Debes iniciar sesión', 401);
  const uid = ses.user.id;
  if (ruta === '/api/db') { const dato = await consultar(uid, cuerpo); if (cuerpo.op !== 'select') trasCambio(); return responder(res, 200, { data: dato }); }
  if (ruta.startsWith('/api/rpc/')) { const r = await llamar(uid, decodeURIComponent(ruta.slice('/api/rpc/'.length)), cuerpo); if (r.cambia) trasCambio(); return responder(res, 200, { data: r.dato }); }
  if (ruta === '/api/archivos/firmar') return responder(res, 200, { data: await firmar(uid, cuerpo.rutas, cuerpo.seg) });
  if (ruta === '/api/archivos/borrar') return responder(res, 200, { data: await borrar(uid, cuerpo.rutas) });
  throw new Fallo('No encontrado', 404);
}

function estatico(req, res, url) {
  let ruta = decodeURIComponent(url.pathname); if (ruta === '/') ruta = '/index.html';
  const cab = { 'Cache-Control': 'no-cache', ...SEG };
  if (ruta === '/index.html') { res.writeHead(200, { 'Content-Type': MIME['.html'], ...cab }); return res.end(indice()); }
  if (ruta === '/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], ...cab }); return res.end(configJs()); }
  if (ruta === '/local-cliente.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], ...cab }); return res.end(fs.readFileSync(path.join(AQUI, 'cliente.js'))); }
  const f = path.join(WEB, ruta);
  if (!f.startsWith(WEB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, cab); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', ...cab }); fs.createReadStream(f).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') estatico(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    if (res.headersSent) return res.end();
    const estado = e instanceof Fallo ? e.estado : 400;   // los rechazos de la base de datos (permisos, validaciones) son errores de la petición
    if (!(e instanceof Fallo) && !e.message) log('error:', e);
    responder(res, estado, { error: e.message || 'Error interno' });
  }
});
servidor.listen(PUERTO, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  log(`Mi Edificio está funcionando.`);
  console.log(`  En este computador:   http://localhost:${PUERTO}`);
  ips.forEach(ip => console.log(`  En la red del edificio: http://${ip}:${PUERTO}`));
  console.log(`  Datos y respaldos en:  ${DATOS}`);
  console.log(`  Para que entren desde fuera con HTTPS, ver "Acceso desde internet" en el README.`);
});
// Al detenerlo deja un respaldo fresco de la base de datos
let cerrando = false;
const cerrar = async () => { if (cerrando) return; cerrando = true; servidor.close(); oyentes.forEach(r => r.end()); try { log('Respaldo al cerrar:', await respaldar()); } catch (e) { log('respaldo:', e.message); } try { await db.close(); } catch {} process.exit(0); };
process.on('SIGINT', cerrar); process.on('SIGTERM', cerrar);
