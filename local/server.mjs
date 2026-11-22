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
import { spawn } from 'node:child_process';
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

// --- Respaldo cifrado: formato y restauración ------------------------------------------
// Archivo = "MEB1" + sal(16) + iv(12) + AES-256-GCM(contenido) + etiqueta(16). La llave sale de la
// contraseña del respaldo (scrypt), así que para restaurar basta la carpeta y esa contraseña.
const MAGIA = Buffer.from('MEB1');
const derivar = (clave, sal) => crypto.scryptSync(clave, sal, 32);
function sellar(llave, sal, buf) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', llave, iv); const x = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([MAGIA, sal, iv, x, c.getAuthTag()]); }
const llaves = new Map();
function abrirSellado(clave, buf) {
  if (buf.length < 48 || !buf.subarray(0, 4).equals(MAGIA)) throw new Error('No es un respaldo de Mi Edificio');
  const sal = buf.subarray(4, 20), k = sal.toString('hex'); if (!llaves.has(k)) llaves.set(k, derivar(clave, sal));
  const d = crypto.createDecipheriv('aes-256-gcm', llaves.get(k), buf.subarray(20, 32)); d.setAuthTag(buf.subarray(buf.length - 16));
  try { return Buffer.concat([d.update(buf.subarray(32, buf.length - 16)), d.final()]); } catch { throw new Error('La contraseña del respaldo no es correcta, o el archivo está dañado'); }
}
const recorrer = (dir, rel = '') => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? recorrer(path.join(dir, e.name), rel + e.name + '/') : [rel + e.name]);

const iNube = process.argv.indexOf('--restaurar-nube');
if (iNube > 0) {
  const carpeta = path.resolve(process.argv[iNube + 1] || '');
  if (fs.readdirSync(DIR.db).length) { console.error(`Para restaurar, la carpeta ${DIR.db} debe estar vacía (muévela primero).`); process.exit(1); }
  const bases = recorrer(path.join(carpeta, 'base')).filter(x => x.endsWith('.meb')).sort();
  if (!bases.length) { console.error(`No hay respaldos en ${path.join(carpeta, 'base')}`); process.exit(1); }
  let clave = process.env.MI_EDIFICIO_CLAVE_RESPALDO;
  if (!clave) { const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout }); clave = await rl.question('Contraseña del respaldo: '); rl.close(); }
  try {
    const j = JSON.parse(abrirSellado(clave, fs.readFileSync(path.join(carpeta, 'base', bases.at(-1)))).toString('utf8'));
    opcionesDb.loadDataDir = new Blob([Buffer.from(j.db, 'base64')]);
    fs.writeFileSync(path.join(DATOS, 'config.json'), JSON.stringify(j.config, null, 2), { mode: 0o600 });
    const arch = recorrer(path.join(carpeta, 'archivos')).filter(x => x.endsWith('.enc'));
    for (const a of arch) { const dest = path.join(DIR.archivos, ...a.slice(0, -4).split('/')); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, abrirSellado(clave, fs.readFileSync(path.join(carpeta, 'archivos', a)))); }
    log(`Restaurado el respaldo ${bases.at(-1)} con ${arch.length} archivos. Vuelve a configurar el respaldo en Administración → Edificio.`);
  } catch (e) { console.error('No se pudo restaurar:', e.message); process.exit(1); }
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
const guardarCfg = () => fs.writeFileSync(rutaCfg, JSON.stringify(CFG, null, 2), { mode: 0o600 });
guardarCfg();
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
// --- Respaldo completo y cifrado en una carpeta sincronizada con la nube ---------------------
// La app de OneDrive, Google Drive u otra, instalada en este computador, sube lo que dejamos ahí.
//   <carpeta>/base/mi-edificio-AAAA-MM-DD.meb   base de datos + claves de la instalación (últimos 14 días)
//   <carpeta>/archivos/…​.enc                    cada foto o documento, una sola vez (espejo de datos/archivos)
const RE_NUBE = /onedrive|google\s?drive|googledrive|my drive|mi unidad|dropbox|icloud|clouddocs|cloudstorage|nextcloud|pcloud|megasync|box sync|sync\.com/i;
const pareceNube = p => RE_NUBE.test(p || '');
function carpetasDeNube() {
  const h = os.homedir(), c = new Set();
  ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].forEach(v => process.env[v] && c.add(process.env[v]));
  ['OneDrive', 'Dropbox', 'Google Drive', 'GoogleDrive', 'iCloudDrive', 'Nextcloud', path.join('Library', 'Mobile Documents', 'com~apple~CloudDocs')].forEach(n => c.add(path.join(h, n)));
  try { fs.readdirSync(path.join(h, 'Library', 'CloudStorage')).forEach(n => c.add(path.join(h, 'Library', 'CloudStorage', n))); } catch {}
  if (process.platform === 'win32') for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') ['My Drive', 'Mi unidad'].forEach(n => c.add(`${l}:\\${n}`));
  return [...c].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }).map(d => path.join(d, 'Respaldo Mi Edificio'));
}
// Hora (del reloj de este computador) en que corren el respaldo y las tareas diarias. Por defecto, 03:00.
const horaDiaria = () => Number.isInteger(CFG.respaldo?.hora) ? CFG.respaldo.hora : 3;
const estadoRespaldo = () => { const r = CFG.respaldo || {}; return { configurado: !!(r.carpeta && r.llave), carpeta: r.carpeta || '', pareceNube: pareceNube(r.carpeta), hora: horaDiaria(), ultimo: r.ultimo || null, sugerencias: carpetasDeNube() }; };
function configurarRespaldo({ carpeta, clave, hora }) {
  if (hora !== undefined && hora !== null && hora !== '' && !(Number.isInteger(Number(hora)) && Number(hora) >= 0 && Number(hora) <= 23)) throw new Fallo('La hora del respaldo debe estar entre 0 y 23');
  carpeta = String(carpeta || '').trim();
  if (!carpeta || !path.isAbsolute(carpeta)) throw new Fallo('Escribe la ruta completa de la carpeta, por ejemplo C:\\Users\\Conserjeria\\OneDrive\\Respaldo Mi Edificio');
  carpeta = path.resolve(carpeta);
  if ((carpeta + path.sep).startsWith(DATOS + path.sep)) throw new Fallo('Elige una carpeta fuera de los datos de Mi Edificio');
  try { fs.mkdirSync(carpeta, { recursive: true }); fs.writeFileSync(path.join(carpeta, '.prueba'), 'ok'); fs.rmSync(path.join(carpeta, '.prueba')); } catch (e) { throw new Fallo('No se puede escribir en esa carpeta: ' + e.message); }
  const r = CFG.respaldo || {};
  if (clave) { if (typeof clave !== 'string' || clave.length < 8) throw new Fallo('La contraseña del respaldo debe tener al menos 8 caracteres'); const sal = crypto.randomBytes(16); r.sal = sal.toString('hex'); r.llave = derivar(clave, sal).toString('hex'); }
  else if (!r.llave) throw new Fallo('Define una contraseña para el respaldo');
  if (r.carpeta !== carpeta || clave) delete r.ultimo;
  r.carpeta = carpeta; if (hora !== undefined && hora !== null && hora !== '') r.hora = Number(hora); CFG.respaldo = r; guardarCfg();
}
let respaldandoNube = false;
async function respaldarNube() {
  const r = CFG.respaldo; if (!r?.carpeta || !r.llave || respaldandoNube) return null; respaldandoNube = true;
  try {
    const llave = Buffer.from(r.llave, 'hex'), sal = Buffer.from(r.sal, 'hex'), base = path.join(r.carpeta, 'base'), arch = path.join(r.carpeta, 'archivos'), marca = path.join(r.carpeta, '.clave');
    const escribir = (f, buf) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); };
    // si cambió la contraseña, lo anterior ya no se podría abrir con la nueva: se rehace
    const huella = sha(r.llave).slice(0, 16);
    if (fs.existsSync(marca) && fs.readFileSync(marca, 'utf8') !== huella) { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(arch, { recursive: true, force: true }); }
    escribir(marca, huella);
    escribir(path.join(r.carpeta, 'LEEME.txt'), 'Respaldo cifrado de Mi Edificio. No modifiques estos archivos.\nPara restaurar en un computador nuevo: instala Mi Edificio y ejecuta\n  iniciar --restaurar-nube "<esta carpeta>"\nTe pedirá la contraseña del respaldo. Sin esa contraseña no se puede recuperar.\n');
    const dump = Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer());
    escribir(path.join(base, `mi-edificio-${new Date().toISOString().slice(0, 10)}.meb`), sellar(llave, sal, Buffer.from(JSON.stringify({ v: 1, fecha: new Date().toISOString(), config: { secreto: CFG.secreto, vapid: CFG.vapid }, db: dump.toString('base64') }))));
    recorrer(base).filter(x => x.endsWith('.meb')).sort().slice(0, -14).forEach(x => fs.rmSync(path.join(base, x), { force: true }));
    const locales = recorrer(DIR.archivos), enNube = new Set(recorrer(arch)); let nuevos = 0;
    for (const a of locales) if (!enNube.has(a + '.enc')) { escribir(path.join(arch, ...(a + '.enc').split('/')), sellar(llave, sal, fs.readFileSync(path.join(DIR.archivos, ...a.split('/'))))); nuevos++; }
    const vivos = new Set(locales.map(a => a + '.enc')); for (const a of enNube) if (a.endsWith('.enc') && !vivos.has(a)) fs.rmSync(path.join(arch, ...a.split('/')), { force: true });
    r.ultimo = { fecha: new Date().toISOString(), ok: true, archivos: locales.length, nuevos };
  } catch (e) { r.ultimo = { fecha: new Date().toISOString(), ok: false, error: e.message }; log('respaldo en la nube:', e.message); }
  finally { respaldandoNube = false; guardarCfg(); }
  return r.ultimo;
}

// --- Acceso desde internet: túnel de Cloudflare ------------------------------------------------
// El servidor maneja el programa cloudflared, que publica este computador en una dirección HTTPS
// sin abrir puertos. Dos modos:
//   prueba → dirección temporal *.trycloudflare.com, sin cuenta (cambia en cada arranque)
//   fijo   → túnel creado en la cuenta Cloudflare del edificio, con su dominio (se conecta con un token)
const buscarCloudflared = () => [process.env.MI_EDIFICIO_CLOUDFLARED, path.join(RAIZ, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'), path.join(DATOS, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')].find(f => f && fs.existsSync(f)) || 'cloudflared';
const tunel = { proc: null, estado: 'apagado', direccion: '', error: '', reintento: null, espera: 15000 };
const estadoTunel = () => { const t = CFG.tunel || {}; return { modo: t.modo || 'apagado', estado: tunel.estado, direccion: tunel.estado === 'conectado' ? tunel.direccion : '', direccionFija: t.direccion || '', tieneToken: !!t.token, error: tunel.error, puerto: PUERTO }; };
function detenerTunel() { clearTimeout(tunel.reintento); tunel.reintento = null; const p = tunel.proc; tunel.proc = null; if (p) { p.removeAllListeners('exit'); try { p.kill(); } catch {} } tunel.estado = 'apagado'; tunel.direccion = ''; tunel.error = ''; }
function iniciarTunel() {
  detenerTunel(); const t = CFG.tunel || {}; if (!t.modo || t.modo === 'apagado') return;
  tunel.estado = 'iniciando';
  const args = t.modo === 'prueba' ? ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PUERTO}`] : ['tunnel', '--no-autoupdate', 'run'];
  let p;
  try { p = spawn(buscarCloudflared(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(t.modo === 'fijo' ? { TUNNEL_TOKEN: t.token } : {}) } }); }   // el token va por variable de entorno, no en la línea de comandos
  catch (e) { tunel.estado = 'error'; tunel.error = e.message; return; }
  tunel.proc = p; let ultimoError = '';
  const leer = d => { for (const l of String(d).split(/\r?\n/)) {
    const u = l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (u && t.modo === 'prueba') tunel.direccion = u[0];
    if (/Registered tunnel connection/.test(l)) { tunel.estado = 'conectado'; tunel.error = ''; tunel.espera = 15000; if (t.modo === 'fijo') tunel.direccion = t.direccion || ''; log('Acceso desde internet conectado:', tunel.direccion || '(dirección definida en Cloudflare)'); }
    else if (/ ERR /.test(l) && !/Failed to fetch features|ICMP/.test(l)) ultimoError = l.replace(/^\S+ ERR\s+/, '').replace(/\s+event=\d+$/, '').slice(0, 300);
  } };
  p.stdout.on('data', leer); p.stderr.on('data', leer);
  p.on('error', e => { if (tunel.proc !== p) return; tunel.proc = null; tunel.estado = e.code === 'ENOENT' ? 'sin-programa' : 'error'; tunel.error = e.code === 'ENOENT' ? '' : e.message; });
  p.on('exit', () => { if (tunel.proc !== p) return; tunel.proc = null; tunel.estado = 'error'; tunel.direccion = '';
    tunel.error = /Unauthorized|Invalid tunnel secret|token/i.test(ultimoError) ? 'Cloudflare rechazó el token. Copia de nuevo el token del túnel.'
      : /no such host|lookup |dial tcp|network is unreachable|timeout/i.test(ultimoError) ? 'Este computador no logró comunicarse con Cloudflare. Revisa su conexión a internet.'
      : (ultimoError || 'El programa del túnel se cerró.');
    tunel.reintento = setTimeout(iniciarTunel, tunel.espera); tunel.reintento.unref(); tunel.espera = Math.min(tunel.espera * 2, 300000); });   // se reintenta solo: 15 s, 30 s… hasta cada 5 min
}
function configurarTunel({ modo, token, direccion }) {
  if (!['apagado', 'prueba', 'fijo'].includes(modo)) throw new Fallo('Modo no válido');
  const t = CFG.tunel || {};
  if (modo === 'fijo') {
    // la gente suele pegar el comando completo que muestra Cloudflare: se toma solo el token
    const tk = (String(token || '').match(/eyJ[A-Za-z0-9_\-=+\/]{40,}/) || [])[0]; if (tk) t.token = tk;
    if (!t.token) throw new Fallo('Pega el token del túnel (o el comando completo que muestra Cloudflare)');
    direccion = String(direccion || '').trim().replace(/\/+$/, ''); if (direccion && !/^https?:\/\//i.test(direccion)) direccion = 'https://' + direccion;
    let u; try { u = new URL(direccion); } catch { throw new Fallo('Escribe la dirección pública que definiste en Cloudflare, por ejemplo https://app.miedificio.cl'); }
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) throw new Fallo('La dirección pública debe ser https://tu-dominio');
    t.direccion = u.origin;
  }
  t.modo = modo; CFG.tunel = t; guardarCfg(); tunel.espera = 15000; iniciarTunel();
}

// Cada 5 minutos: plazos de estacionamiento. Una vez al día, a la hora elegida: plazos de conservación
// y respaldos. Mientras se respalda, la base de datos no atiende otras consultas.
const diaLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function tareas() {
  try {
    const r = await db.query(`select privado.revisar_estacionamientos() as n`); if (r.rows[0].n > 0) difundir();
    await db.query(`delete from auth.sesiones where expira < now()`);
    const hoy = new Date(); const dia = diaLocal(hoy);
    if (dia !== CFG.diarioHecho && hoy.getHours() >= horaDiaria()) {
      CFG.diarioHecho = dia; guardarCfg();   // se anota antes: si algo falla no se reintenta cada 5 minutos
      await db.query(`select privado.depurar()`);
      const pend = await db.query(`delete from public.archivos_por_borrar returning path`);
      for (const x of pend.rows) { if (rutaValida(x.path)) { fs.rmSync(enDisco(x.path), { force: true }); await db.query(`delete from storage.objects where name = $1`, [x.path]); } }
      log('Respaldo diario:', await respaldar());
      const n = await respaldarNube(); if (n) log('Respaldo en la carpeta de nube:', n.ok ? `listo (${n.archivos} archivos)` : 'FALLÓ: ' + n.error);
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
  if (ruta.startsWith('/api/tunel/')) {   // solo administración
    const adm = await como(uid, tx => tx.query(`select public.es_admin() as ok`)); if (!adm.rows[0]?.ok) throw new Fallo('Solo la administración puede gestionar el acceso desde internet', 403);
    if (ruta === '/api/tunel/configurar') configurarTunel(cuerpo);
    else if (ruta !== '/api/tunel/estado') throw new Fallo('No encontrado', 404);
    return responder(res, 200, { data: estadoTunel() });
  }
  if (ruta.startsWith('/api/respaldo/')) {   // solo administración
    const adm = await como(uid, tx => tx.query(`select public.es_admin() as ok`)); if (!adm.rows[0]?.ok) throw new Fallo('Solo la administración puede gestionar el respaldo', 403);
    if (ruta === '/api/respaldo/configurar') configurarRespaldo(cuerpo);
    else if (ruta === '/api/respaldo/ahora') { if (!estadoRespaldo().configurado) throw new Fallo('Primero configura la carpeta y la contraseña del respaldo'); await respaldarNube(); }
    else if (ruta !== '/api/respaldo/estado') throw new Fallo('No encontrado', 404);
    return responder(res, 200, { data: estadoRespaldo() });
  }
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
  console.log(`  Para que entren desde fuera: Administración → Edificio → Acceso desde internet.`);
  iniciarTunel();
});
// Al detenerlo deja un respaldo fresco de la base de datos
let cerrando = false;
const cerrar = async () => { if (cerrando) return; cerrando = true; detenerTunel(); servidor.close(); oyentes.forEach(r => r.end()); try { log('Respaldo al cerrar:', await respaldar()); await respaldarNube(); } catch (e) { log('respaldo:', e.message); } try { await db.close(); } catch {} fs.rmSync(path.join(DATOS, 'servidor.pid'), { force: true }); process.exit(0); };
process.on('SIGINT', cerrar); process.on('SIGTERM', cerrar);
// En Windows no llegan esas señales: "lanzar.mjs detener" deja un archivo "detener" en la carpeta de datos
const bandera = path.join(DATOS, 'detener'); fs.rmSync(bandera, { force: true });
fs.writeFileSync(path.join(DATOS, 'servidor.pid'), String(process.pid));   // lo borra al terminar de cerrarse
setInterval(() => { if (fs.existsSync(bandera)) { fs.rmSync(bandera, { force: true }); log('Detención solicitada.'); cerrar(); } }, 1500).unref();
