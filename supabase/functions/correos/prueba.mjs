// Prueba de la Edge Function "correos" con Deno, contra un PostgREST y un SMTP de mentira.
// Uso: node supabase/functions/correos/prueba.mjs "$(which deno)" .   (desde la raíz del repo; requiere Deno 2)
import http from 'node:http'; import net from 'node:net'; import { spawn } from 'node:child_process'; import path from 'node:path';
const [DENO, REPO] = process.argv.slice(2);
const ok = (c, m) => { if (!c) { console.error('FALLÓ: ' + m); process.exit(1); } console.log('  ✓ ' + m); };
const dormir = ms => new Promise(r => setTimeout(r, ms));

// "Base de datos": dos correos pendientes
const cola = [
  { id: 'a', para: 'rita@correo.cl', nombre: 'Rita', asunto: 'Citación a asamblea nº 1', texto: 'Estimado/a Rita:\n\nSe cita…', intentos: 0, ed_nombre: 'Torre Los Olmos', ed_email: 'admin@torre.cl', estado: 'pendiente' },
  { id: 'b', para: 'malo@correo.cl', nombre: '', asunto: 'Aviso', texto: 'Hola', intentos: 0, ed_nombre: 'Torre Los Olmos', ed_email: '', estado: 'pendiente' },
];
const llamadas = [];
const rest = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  const a = JSON.parse(b || '{}'); llamadas.push({ url: req.url, a, auth: req.headers.authorization });
  if (a.p_secreto !== 'secreto') { res.writeHead(400); return res.end('{"message":"No autorizado"}'); }
  if (req.url.endsWith('/correos_reclamar')) { const l = cola.filter(x => x.estado === 'pendiente'); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(l)); }
  if (req.url.endsWith('/correos_resultado')) { const x = cola.find(y => y.id === a.p_id); x.estado = a.p_ok ? 'enviado' : (a.p_cuenta ? 'pendiente' : 'error'); x.error = a.p_error; res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end(); }); }).listen(0);

const recibidos = []; let rechazarClave = false;
const smtp = net.createServer(c => { let datos = false, buf = '', msg = { para: [] }; c.write('220 prueba ESMTP\r\n');
  c.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
    if (datos) { if (l === '.') { datos = false; recibidos.push(msg); msg = { para: [] }; c.write('250 OK\r\n'); } else msg.cuerpo = (msg.cuerpo || '') + l + '\n'; continue; }
    const v = l.slice(0, 4).toUpperCase();
    if (v === 'EHLO') c.write('250-prueba\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
    else if (v === 'AUTH') c.write(rechazarClave ? '535 5.7.8 credenciales malas\r\n' : '235 OK\r\n');
    else if (v === 'RCPT') { const p = l.match(/<(.*)>/)[1]; if (p.startsWith('malo@')) c.write('550 no existe\r\n'); else { msg.para.push(p); c.write('250 OK\r\n'); } }
    else if (v === 'DATA') { datos = true; c.write('354 ok\r\n'); } else if (v === 'QUIT') c.end('221 chao\r\n'); else c.write('250 OK\r\n'); } }); }).listen(0);

const PUERTO = 8950;
const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--allow-sys', '--node-modules-dir=none', path.join(REPO, 'supabase/functions/correos/index.ts')], {
  env: { ...process.env, PORT: String(PUERTO), DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PUERTO}`, SUPABASE_URL: `http://127.0.0.1:${rest.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio',
    CORREO_SECRET: 'secreto', CORREO_REMITENTE: 'Envios@Torre.cl', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_TLS: 'no' }, stdio: ['ignore', 'pipe', 'pipe'] });
let salida = ''; fn.stdout.on('data', d => salida += d); fn.stderr.on('data', d => salida += d);
const URL_FN = `http://127.0.0.1:${PUERTO}/`;
for (let i = 0; i < 300; i++) { try { await fetch(URL_FN); break; } catch { await dormir(200); } }
try {
  ok((await fetch(URL_FN, { method: 'POST' })).status === 401, 'sin el secreto no hace nada');
  const r = await fetch(URL_FN, { method: 'POST', headers: { 'x-correo-secret': 'secreto' } }); const j = await r.json();
  ok(r.status === 200 && j.enviados === 1 && j.fallidos === 1, 'envía el lote: ' + JSON.stringify(j));
  ok(cola[0].estado === 'enviado' && cola[1].estado === 'error' && /550/.test(cola[1].error), 'informa a la base cada resultado');
  ok(llamadas.every(x => x.auth === 'Bearer clave-servicio'), 'usa la clave de servicio');
  const m = recibidos[0]; ok(m && m.para[0] === 'rita@correo.cl', 'el correo llega al destinatario');
  ok(/From: Torre Los Olmos <envios@torre.cl>/.test(m.cuerpo) && /Reply-To: admin@torre.cl/.test(m.cuerpo), 'sale a nombre del edificio y las respuestas van a su correo');
  cola[0].estado = 'pendiente'; rechazarClave = true;
  const r2 = await fetch(URL_FN, { method: 'POST', headers: { 'x-correo-secret': 'secreto' } });
  ok(r2.status === 502 && cola[0].estado === 'pendiente' && llamadas.at(-1).a.p_cuenta === true, 'si la cuenta falla, el correo sigue pendiente sin contar el intento');
} catch (e) { console.error(e, salida); process.exit(1); }
finally { fn.kill(); rest.close(); smtp.close(); }
console.log('OK: Edge Function correos');
process.exit(0);
