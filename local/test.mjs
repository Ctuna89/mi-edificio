// Pruebas del servidor local: lo levanta con una carpeta de datos temporal y lo usa por HTTP,
// igual que el navegador.   Uso: npm test   (dentro de local/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-edificio-'));
const PUERTO = 8900 + Math.floor(Math.random() * 90), B = `http://localhost:${PUERTO}`;
let proc;
const levantar = () => new Promise((ok, mal) => {
  proc = spawn(process.execPath, [path.join(AQUI, 'server.mjs')], { env: { ...process.env, MI_EDIFICIO_DATOS: DATOS, PUERTO: String(PUERTO) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = ''; const ver = d => { salida += d; if (salida.includes('está funcionando')) ok(); };
  proc.stdout.on('data', ver); proc.stderr.on('data', ver); proc.on('exit', c => mal(new Error('el servidor terminó (' + c + '): ' + salida.slice(-500))));
});
const bajar = () => new Promise(ok => { proc.removeAllListeners('exit'); proc.on('exit', ok); proc.kill('SIGTERM'); });
before(levantar); after(async () => { await bajar(); fs.rmSync(DATOS, { recursive: true, force: true }); });

// Un "navegador": guarda su cookie de sesión
function persona() {
  let cookie = '';
  const pedir = async (ruta, cuerpo, extra = {}) => {
    const r = await fetch(B + ruta, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...extra.headers }, body: extra.crudo ?? JSON.stringify(cuerpo ?? {}) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const j = await r.json().catch(() => null); return { estado: r.status, data: j?.data ?? null, error: j?.error ?? null };
  };
  return {
    pedir, get cookie() { return cookie; },
    db: q => pedir('/api/db', { f: [], ...q }), rpc: (n, a) => pedir('/api/rpc/' + n, a),
    registro: (email, clave = 'clave-segura-1') => pedir('/api/auth/registro', { email, clave }),
    entrar: (email, clave = 'clave-segura-1') => pedir('/api/auth/entrar', { email, clave }),
    subir: (ruta, texto) => pedir('/api/archivos/subir?ruta=' + encodeURIComponent(ruta), null, { crudo: texto, headers: { 'content-type': 'image/jpeg', 'x-mi-edificio': '1' } }),
  };
}
const ana = persona(), rita = persona(), intruso = persona();
let eid, ritaId;

test('sin sesión no se puede consultar nada', async () => {
  assert.equal((await intruso.db({ t: 'usuarios', op: 'select' })).estado, 401);
  assert.equal((await intruso.rpc('buscar_edificio')).estado, 401);
});

test('la app se sirve adaptada al modo local', async () => {
  const html = await (await fetch(B + '/')).text();
  assert.ok(html.includes('local-cliente.js') && !html.includes('cdn.jsdelivr.net'), 'no depende de internet para cargar');
  assert.ok((await (await fetch(B + '/config.js')).text()).includes('"LOCAL":true'));
  assert.equal((await fetch(B + '/..%2fserver.mjs')).status, 404);
  assert.equal((await fetch(B + '/%2e%2e/local/datos/config.json')).status, 404);
});

test('registro, creación del edificio y un solo edificio por instalación', async () => {
  assert.equal((await ana.registro('ana@test.cl', 'corta')).estado, 400);
  const r = await ana.registro('ana@test.cl'); assert.equal(r.estado, 200); assert.ok(r.data.user.id);
  assert.match((await intruso.registro('ana@test.cl')).error, /already registered/);
  assert.equal((await ana.rpc('puede_crear_edificio')).data, true);
  eid = (await ana.rpc('crear_edificio', { p_edificio: 'Torre Local', p_nombre: 'Ana Admin' })).data; assert.match(eid, /^[0-9a-f-]{36}$/);
  const yo = await ana.db({ t: 'usuarios', op: 'select' }); assert.equal(yo.data[0].rol, 'admin'); assert.equal(yo.data[0].estado, 'activo');
  assert.match((await ana.rpc('crear_edificio', { p_edificio: 'Otra', p_nombre: 'Ana' })).error, /ya pertenece|ya tiene/);
});

test('una cuenta nueva pide acceso y no ve nada hasta que la aprueban', async () => {
  ritaId = (await rita.registro('rita@test.cl')).data.user.id;
  assert.equal((await rita.rpc('buscar_edificio')).data[0].nombre, 'Torre Local');
  assert.equal((await rita.rpc('puede_crear_edificio')).data, false);
  assert.equal((await rita.db({ t: 'usuarios', op: 'insert', p: { id: ritaId, edificio_id: eid, nombre: 'Rita', depto: '101', rol: 'admin', estado: 'activo' } })).estado, 200);
  const yo = (await rita.db({ t: 'usuarios', op: 'select' })).data; assert.equal(yo.length, 1); assert.equal(yo[0].rol, 'residente'); assert.equal(yo[0].estado, 'pendiente');
  assert.deepEqual((await rita.db({ t: 'unidades', op: 'select' })).data, []);
  assert.equal((await ana.db({ t: 'usuarios', op: 'update', p: { estado: 'activo' }, f: [['id', 'eq', ritaId]] })).estado, 200);
});

test('consultas con tipos, upsert, filtros y permisos por rol', async () => {
  assert.equal((await ana.db({ t: 'unidades', op: 'upsert', p: [{ edificio_id: eid, depto: '101', alicuota: 60, prop: 'Rita' }, { edificio_id: eid, depto: '102', alicuota: 39.5 }] })).estado, 200);
  assert.equal((await ana.db({ t: 'unidades', op: 'upsert', p: { edificio_id: eid, depto: '102', alicuota: 40 } })).estado, 200);
  const un = (await ana.db({ t: 'unidades', op: 'select', ord: { k: 'depto', asc: true } })).data; assert.deepEqual(un.map(u => [u.depto, u.alicuota]), [['101', 60], ['102', 40]]);
  const g = await ana.db({ t: 'gastos', op: 'upsert', p: { edificio_id: eid, periodo: '2026-11', vence: '2026-12-05', items: [{ categoria: 'Agua', monto: 1000 }], total: 1000, publicado: true } }); assert.equal(g.estado, 200, g.error);
  assert.equal((await ana.rpc('recalcular_prorrateo', { p_periodo: '2026-11' })).estado, 200);
  const mio = (await rita.db({ t: 'gasto_unidades', op: 'select' })).data; assert.equal(mio.length, 1); assert.equal(mio[0].monto, 600);
  assert.match((await rita.db({ t: 'pagos', op: 'insert', p: { depto: '101', periodo: '2026-11', monto: 100 } })).error, /row-level security/);
  const pago = await ana.db({ t: 'pagos', op: 'insert', p: { depto: '101', periodo: '2026-11', monto: 600, fecha: '2026-11-20' }, ret: true }); assert.equal(pago.data[0].monto, 600);
  assert.equal((await rita.db({ t: 'gasto_unidades', op: 'select', f: [['depto', 'eq', '101']], one: true })).data.pagado, true);
  assert.deepEqual((await ana.db({ t: 'gasto_unidades', op: 'select', f: [['depto', 'in', ['102', '999']], ['pagado', 'eq', false]] })).data.map(x => x.depto), ['102']);
  assert.equal((await ana.db({ t: 'pagos', op: 'select', f: [['convenio_id', 'is', null], ['fecha', 'gte', '2026-11-01']] })).data.length, 1);
  const conv = await ana.rpc('crear_convenio', { p_depto: '102', p_periodos: ['2026-11'], p_cuotas: 2, p_primera: '2026-12-10', p_nota: '' }); assert.equal(conv.estado, 200, conv.error);
  assert.equal((await ana.db({ t: 'convenio_cuotas', op: 'select' })).data.length, 2);
});

test('nombres de tabla, columna o función inventados se rechazan', async () => {
  assert.equal((await ana.db({ t: 'usuarios; drop table usuarios', op: 'select' })).estado, 400);
  assert.equal((await ana.db({ t: 'plataforma', op: 'select' })).data.length, 0);          // existe, pero RLS no deja leerla
  assert.equal((await ana.db({ t: 'usuarios', op: 'select', f: [['id" = id or "id', 'eq', 'x']] })).estado, 400);
  assert.equal((await ana.db({ t: 'usuarios', op: 'update', p: { 'nombre" = \'x\' --': 1 }, f: [['id', 'eq', ritaId]] })).estado, 400);
  assert.equal((await ana.db({ t: 'usuarios', op: 'delete' })).estado, 400);                  // sin filtro
  assert.equal((await ana.rpc('pg_sleep', { seconds: 1 })).estado, 400);
  assert.equal((await ana.rpc('usuarios_antes_insert')).estado, 400);
  assert.equal((await ana.db({ t: 'usuarios', op: 'select' })).data.length, 2);
});

test('archivos: se suben a la carpeta del edificio y solo los abre quien puede verlos', async () => {
  const ruta = `${eid}/encomiendas/2026-11-22/abc.jpg`;
  assert.equal((await rita.subir('otra-carpeta/x.jpg', 'x')).estado, 400);
  assert.equal((await ana.subir(`${eid}/../../config.json`, 'x')).estado, 400);
  assert.equal((await ana.subir(ruta, 'contenido-de-la-foto')).estado, 200);
  assert.equal((await ana.db({ t: 'encomiendas', op: 'insert', p: { depto: '102', descripcion: 'Caja', foto: ruta } })).estado, 200);
  assert.equal((await rita.pedir('/api/archivos/firmar', { rutas: [ruta] })).data[0].signedUrl, null, 'la 101 no ve la foto de una encomienda de la 102');
  const url = (await ana.pedir('/api/archivos/firmar', { rutas: [ruta] })).data[0].signedUrl; assert.ok(url);
  const r = await fetch(B + url); assert.equal(r.status, 200); assert.equal(await r.text(), 'contenido-de-la-foto'); assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(B + url.replace(/s=.{6}/, 's=AAAAAA'))).status, 404, 'firma alterada');
  assert.equal((await fetch(B + url.replace(/e=\d+/, 'e=1'))).status, 404, 'enlace vencido');
  assert.equal((await rita.pedir('/api/archivos/borrar', { rutas: [ruta] })).data.length, 0);
  assert.equal((await ana.pedir('/api/archivos/borrar', { rutas: [ruta] })).data.length, 1);
  assert.equal((await fetch(B + url)).status, 404);
});

test('peticiones de otro sitio y avisos de cambios', async () => {
  const r = await fetch(B + '/api/db', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ana.cookie, origin: 'https://sitio-malo.example' }, body: JSON.stringify({ t: 'usuarios', op: 'select', f: [] }) });
  assert.equal(r.status, 403);
  assert.equal((await fetch(B + '/api/eventos')).status, 401);
  const ctl = new AbortController(); const ev = await fetch(B + '/api/eventos', { headers: { cookie: rita.cookie }, signal: ctl.signal }); const lector = ev.body.getReader();
  await lector.read();   // ": conectado"
  const llego = lector.read().then(x => new TextDecoder().decode(x.value));
  await ana.db({ t: 'comunicados', op: 'insert', p: { titulo: 'Corte de agua', cuerpo: 'Mañana de 9 a 12' } });
  assert.match(await llego, /data: cambio/); ctl.abort();
});

test('respaldo cifrado en una carpeta, con aviso si no es de nube, y restauración en un equipo nuevo', async () => {
  const nube = fs.mkdtempSync(path.join(os.tmpdir(), 'me-nube-')), simple = path.join(nube, 'Documentos', 'Respaldo'), deNube = path.join(nube, 'OneDrive', 'Respaldo Mi Edificio');
  assert.equal((await rita.pedir('/api/respaldo/estado')).estado, 403, 'solo administración');
  assert.equal((await ana.pedir('/api/respaldo/ahora')).estado, 400, 'sin configurar no respalda');
  assert.equal((await ana.pedir('/api/respaldo/configurar', { carpeta: 'relativa', clave: 'clave-del-respaldo' })).estado, 400);
  assert.equal((await ana.pedir('/api/respaldo/configurar', { carpeta: simple })).estado, 400, 'exige contraseña');
  assert.equal((await ana.pedir('/api/respaldo/configurar', { carpeta: path.join(DATOS, 'x'), clave: 'clave-del-respaldo' })).estado, 400, 'no dentro de los datos');
  let e = (await ana.pedir('/api/respaldo/configurar', { carpeta: simple, clave: 'clave-del-respaldo' })).data;
  assert.equal(e.configurado, true); assert.equal(e.pareceNube, false, 'una carpeta cualquiera se marca como "no parece de nube"');
  e = (await ana.pedir('/api/respaldo/configurar', { carpeta: deNube })).data; assert.equal(e.pareceNube, true, 'una carpeta dentro de OneDrive sí');
  const ruta = `${eid}/documentos/2026-11-22/acta.pdf`; await ana.subir(ruta, 'TEXTO-SECRETO-DEL-ACTA');
  e = (await ana.pedir('/api/respaldo/ahora')).data; assert.equal(e.ultimo.ok, true, e.ultimo.error); assert.equal(e.ultimo.archivos, 1);
  const base = fs.readdirSync(path.join(deNube, 'base')); assert.equal(base.length, 1);
  const enc = fs.readFileSync(path.join(deNube, 'archivos', ...ruta.split('/')) + '.enc');
  assert.ok(!enc.includes('TEXTO-SECRETO') && !fs.readFileSync(path.join(deNube, 'base', base[0])).includes('Torre Local'), 'lo que va a la nube está cifrado');
  await ana.pedir('/api/archivos/borrar', { rutas: [ruta] }); await ana.subir(ruta.replace('acta', 'acta2'), 'OTRO');
  e = (await ana.pedir('/api/respaldo/ahora')).data; assert.deepEqual(fs.readdirSync(path.join(deNube, 'archivos', eid, 'documentos', '2026-11-22')), ['acta2.pdf.enc'], 'la copia sigue a los archivos: agrega y quita');
  // restaurar en un "computador nuevo": otra carpeta de datos, solo con la carpeta de nube y la contraseña
  const nuevo = fs.mkdtempSync(path.join(os.tmpdir(), 'me-nuevo-')), puerto2 = PUERTO + 100;
  const correr = (clave) => new Promise(ok => { const p = spawn(process.execPath, [path.join(AQUI, 'server.mjs'), '--restaurar-nube', deNube], { env: { ...process.env, MI_EDIFICIO_DATOS: nuevo, PUERTO: String(puerto2), MI_EDIFICIO_CLAVE_RESPALDO: clave } }); let s = ''; const v = d => { s += d; if (s.includes('está funcionando')) ok({ p, s }); }; p.stdout.on('data', v); p.stderr.on('data', v); p.on('exit', () => ok({ p: null, s })); });
  const mal = await correr('clave-equivocada'); assert.equal(mal.p, null); assert.match(mal.s, /contraseña del respaldo no es correcta/);
  const bien = await correr('clave-del-respaldo'); assert.ok(bien.p, bien.s.slice(-300));
  const r = await fetch(`http://localhost:${puerto2}/api/auth/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@test.cl', clave: 'clave-segura-1' }) });
  assert.equal(r.status, 200, 'la cuenta existe en el equipo restaurado');
  assert.equal(fs.readFileSync(path.join(nuevo, 'archivos', eid, 'documentos', '2026-11-22', 'acta2.pdf'), 'utf8'), 'OTRO', 'y sus archivos también');
  await new Promise(ok => { bien.p.on('exit', ok); bien.p.kill('SIGTERM'); });
  fs.rmSync(nube, { recursive: true, force: true }); fs.rmSync(nuevo, { recursive: true, force: true });
});

test('contraseñas: la restablece la administración, y los datos persisten tras reiniciar', async () => {
  assert.equal((await rita.pedir('/api/auth/restablecer', { uid: ritaId, clave: 'otra-clave-99' })).estado, 403);
  assert.equal((await ana.pedir('/api/auth/restablecer', { uid: ritaId, clave: 'nueva-clave-22' })).estado, 200);
  assert.equal((await rita.db({ t: 'usuarios', op: 'select' })).estado, 401, 'las sesiones anteriores se cierran');
  assert.equal((await rita.entrar('rita@test.cl', 'clave-segura-1')).estado, 400);
  assert.equal((await rita.entrar('rita@test.cl', 'nueva-clave-22')).estado, 200);
  await bajar(); await levantar();
  assert.equal((await rita.db({ t: 'gasto_unidades', op: 'select' })).data[0].monto, 600, 'sesión y datos siguen ahí');
  assert.equal((await ana.db({ t: 'comunicados', op: 'select' })).data[0].titulo, 'Corte de agua');
});
