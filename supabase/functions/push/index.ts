// Edge Function "push": envía notificaciones Web Push.
//
// La llaman los triggers de schema.sql (privado.push) mediante pg_net, con el cuerpo
//   { edificio_id, uids: [uuid], titulo, cuerpo, url }
// y la cabecera x-push-secret. No se llama desde el navegador.
//
// Despliegue:  supabase functions deploy push --no-verify-jwt
// Secretos:    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), PUSH_SECRET
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Solo se envía a servicios de push conocidos (el endpoint lo aporta el navegador del usuario)
const SERVICIOS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];
const endpointValido = (e: string) => {
  try {
    const u = new URL(e);
    return u.protocol === "https:" && SERVICIOS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const secreto = env("PUSH_SECRET");
  if (!secreto || req.headers.get("x-push-secret") !== secreto) return json({ error: "No autorizado" }, 401);
  if (!env("VAPID_PUBLIC_KEY") || !env("VAPID_PRIVATE_KEY")) return json({ error: "Faltan las claves VAPID" }, 500);

  const { edificio_id, uids, titulo, cuerpo, url } = await req.json().catch(() => ({}));
  if (!edificio_id || !Array.isArray(uids) || uids.length === 0) return json({ enviadas: 0 });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: subs, error } = await db.from("push_subs").select("id, endpoint, p256dh, auth")
    .eq("edificio_id", edificio_id).in("uid", uids);
  if (error) return json({ error: error.message }, 500);

  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  const payload = JSON.stringify({ titulo, cuerpo, url });
  const caducadas: string[] = [];
  let enviadas = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    if (!endpointValido(s.endpoint)) { caducadas.push(s.id); return; }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      enviadas++;
    } catch (e) {
      // 404/410: el navegador canceló la suscripción
      const codigo = (e as { statusCode?: number }).statusCode;
      if (codigo === 404 || codigo === 410) caducadas.push(s.id);
      else console.error("push", codigo, (e as Error).message);
    }
  }));
  if (caducadas.length) await db.from("push_subs").delete().in("id", caducadas);
  return json({ enviadas, eliminadas: caducadas.length });
});
