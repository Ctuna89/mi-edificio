// Lanzador de Mi Edificio: inicia el servidor en segundo plano, lo abre en el navegador o lo detiene.
// Lo usan los accesos directos que crea el instalador de Windows; sirve en cualquier sistema.
//   node lanzar.mjs iniciar | abrir | detener | estado
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Instalado en Windows, los datos van fuera de la carpeta del programa para que sobrevivan a actualizaciones
const DATOS = path.resolve(process.env.MI_EDIFICIO_DATOS
  || (process.platform === 'win32' && process.env.LOCALAPPDATA && fs.existsSync(path.join(AQUI, '..', 'instalado.txt')) ? path.join(process.env.LOCALAPPDATA, 'MiEdificio', 'datos') : path.join(AQUI, 'datos')));
fs.mkdirSync(DATOS, { recursive: true });
// Puerto: variable PUERTO, o un archivo puerto.txt en la carpeta de datos; por defecto 8080
const PUERTO = (() => { try { const n = Number(fs.readFileSync(path.join(DATOS, 'puerto.txt'), 'utf8').trim()); if (n > 0 && n < 65536) return n; } catch {} return Number(process.env.PUERTO) || 8080; })();
const DIRECCION = `http://localhost:${PUERTO}`;
const BANDERA = path.join(DATOS, 'detener'), REGISTRO = path.join(DATOS, 'servidor.log');

const responde = () => new Promise(ok => {
  const r = http.get(DIRECCION + '/api/auth/sesion', { timeout: 1500 }, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => ok(res.statusCode === 200 && s.includes('"data"'))); });
  r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); });
});
// ¿Sigue vivo el proceso del servidor? (puede haber dejado de atender y estar aún respaldando y cerrando)
const PID = path.join(DATOS, 'servidor.pid');
const vivo = () => { try { process.kill(Number(fs.readFileSync(PID, 'utf8')), 0); return true; } catch { return false; } };
const esperar = async (cond, seg) => { for (let i = 0; i < seg * 2; i++) { if (await cond()) return true; await new Promise(r => setTimeout(r, 500)); } return false; };

async function iniciar() {
  if (await responde()) return true;
  if (vivo()) await esperar(() => !vivo(), 60);   // uno anterior terminando de cerrarse
  fs.rmSync(BANDERA, { force: true });
  try { if (fs.statSync(REGISTRO).size > 5 * 1024 * 1024) fs.renameSync(REGISTRO, REGISTRO + '.anterior'); } catch {}
  const log = fs.openSync(REGISTRO, 'a');
  spawn(process.execPath, [path.join(AQUI, 'server.mjs')], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, MI_EDIFICIO_DATOS: DATOS, PUERTO: String(PUERTO) } }).unref();
  return esperar(responde, 120);
}
async function detener() {
  if (await responde()) fs.writeFileSync(BANDERA, '1');   // el servidor la ve, hace su respaldo y se cierra ordenadamente
  else if (!vivo()) return true;
  return esperar(async () => !vivo() && !(await responde()), 180);   // hasta que el proceso termina: recién ahí se liberan sus archivos
}
function abrirNavegador() {
  const [c, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', DIRECCION]] : process.platform === 'darwin' ? ['open', [DIRECCION]] : ['xdg-open', [DIRECCION]];
  try { spawn(c, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
}

const orden = process.argv[2] || 'abrir';
let ok = true;
if (orden === 'iniciar') ok = await iniciar();
else if (orden === 'abrir') { ok = await iniciar(); if (ok) abrirNavegador(); }
else if (orden === 'detener') ok = await detener();
else if (orden === 'estado') ok = await responde();
else { console.error('Uso: node lanzar.mjs iniciar | abrir | detener | estado'); process.exit(2); }
try { fs.writeFileSync(path.join(DATOS, 'lanzador.txt'), `${new Date().toISOString()} ${orden} ${ok ? 'ok' : 'FALLÓ'} ${DIRECCION}\n`); } catch {}
process.exit(ok ? 0 : 1);
