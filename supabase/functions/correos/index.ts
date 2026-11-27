// Edge Function "correos": envía la cola de correos (tabla public.correos) en la instalación con Supabase.
//
// La llama pg_cron cada minuto (privado.despachar_correos, con pg_net) cuando hay correos pendientes, con la
// cabecera x-correo-secret. No se llama desde el navegador.
//
// Despliegue:  supabase functions deploy correos --no-verify-jwt
// Secretos:    CORREO_SECRET (el mismo valor va en plataforma.correo_secret), CORREO_REMITENTE (correo que envía)
//   y una de estas dos formas de envío:
//   - SMTP: SMTP_HOST, SMTP_USER, SMTP_PASS y SMTP_PORT (465). Supabase bloquea los puertos 25 y 587 en las
//     Edge Functions: sirve un servidor con TLS directo en el 465, como Gmail (smtp.gmail.com, contraseña de aplicación).
//   - Resend (resend.com): RESEND_API_KEY. El dominio del remitente debe estar verificado en Resend.
import nodemailer from "npm:nodemailer@10.2.1";

const env = (k: string) => Deno.env.get(k) ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Correo = { id: string; para: string; nombre: string; asunto: string; texto: string; intentos: number; ed_nombre: string; ed_email: string };

async function rpc(nombre: string, args: Record<string, unknown>) {
  const clave = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: clave, Authorization: `Bearer ${clave}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : await r.json();
}

const pie = (ed: { nombre: string; email: string }) =>
  `\n\n—\n${ed.nombre}${ed.email ? ` · ${ed.email}` : ""}\nEste correo lo envió Mi Edificio en nombre de la administración. Queda registro de la fecha de envío.`;

// Errores de la cuenta o de la conexión: no son culpa del correo, se reintenta sin contar el intento
const DE_CUENTA = ["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED"];

function remitente(x: Correo) {
  const desde = env("CORREO_REMITENTE").toLowerCase();
  return { desde, nombre: x.ed_nombre || "Mi Edificio", responder: x.ed_email && x.ed_email.toLowerCase() !== desde ? x.ed_email : undefined };
}

async function porResend(x: Correo) {
  const r = remitente(x);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("RESEND_API_KEY")}` },
    body: JSON.stringify({
      from: `${r.nombre.replace(/[<>"]/g, "")} <${r.desde}>`, to: [x.nombre ? `${x.nombre.replace(/[<>"]/g, "")} <${x.para}>` : x.para],
      reply_to: r.responder, subject: x.asunto, text: x.texto + pie({ nombre: x.ed_nombre, email: x.ed_email }),
      headers: { "Auto-Submitted": "auto-generated" },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j?.message || `Resend respondió ${res.status}`) as Error & { code?: string };
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) e.code = "ECONNECTION";
    throw e;
  }
  return String(j?.id || "");
}

let transporte: ReturnType<typeof nodemailer.createTransport> | null = null;
const sinTls = env("SMTP_TLS") === "no" && ["localhost", "127.0.0.1", "::1"].includes(env("SMTP_HOST"));
async function porSmtp(x: Correo) {
  const puerto = Number(env("SMTP_PORT") || 465);
  transporte ??= nodemailer.createTransport({
    // siempre cifrado; "SMTP_TLS=no" solo se acepta hacia un servidor local (pruebas)
    host: env("SMTP_HOST"), port: puerto, secure: puerto === 465, requireTLS: puerto !== 465 && !sinTls, ignoreTLS: sinTls, tls: { minVersion: "TLSv1.2" },
    auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined,
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000,
  });
  const r = remitente(x);
  const info = await transporte.sendMail({
    from: { name: r.nombre, address: r.desde }, to: x.nombre ? { name: x.nombre, address: x.para } : x.para, replyTo: r.responder,
    subject: x.asunto, text: x.texto + pie({ nombre: x.ed_nombre, email: x.ed_email }), headers: { "Auto-Submitted": "auto-generated" },
  });
  return String(info.messageId || "");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const secreto = env("CORREO_SECRET");
  if (!secreto || req.headers.get("x-correo-secret") !== secreto) return json({ error: "No autorizado" }, 401);
  if (!env("CORREO_REMITENTE") || !(env("RESEND_API_KEY") || env("SMTP_HOST"))) return json({ error: "Falta configurar el envío (CORREO_REMITENTE y SMTP_HOST o RESEND_API_KEY)" }, 500);
  const enviar = env("RESEND_API_KEY") ? porResend : porSmtp;

  const lote: Correo[] = await rpc("correos_reclamar", { p_secreto: secreto, p_n: 20 });
  let enviados = 0, fallidos = 0;
  for (let k = 0; k < lote.length; k++) {
    const x = lote[k];
    try {
      const id = await enviar(x);
      await rpc("correos_resultado", { p_secreto: secreto, p_id: x.id, p_ok: true, p_mensaje_id: id });
      enviados++;
    } catch (e) {
      const err = e as Error & { code?: string };
      const msg = String(err.message || err).slice(0, 500);
      if (DE_CUENTA.includes(err.code ?? "")) {
        transporte = null;
        for (const y of lote.slice(k)) await rpc("correos_resultado", { p_secreto: secreto, p_id: y.id, p_ok: false, p_error: msg, p_cuenta: true });
        console.error("correos:", msg);
        return json({ enviados, fallidos, error: msg }, 502);
      }
      await rpc("correos_resultado", { p_secreto: secreto, p_id: x.id, p_ok: false, p_error: msg });
      fallidos++;
    }
  }
  return json({ enviados, fallidos });
});
