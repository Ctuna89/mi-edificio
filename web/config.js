// Configuración de conexión a Supabase.
// Supabase → Project Settings → API → copia "Project URL" y "anon public".
// La clave anon es pública por diseño: la seguridad la dan las políticas RLS del schema.sql.
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_ANON_KEY",
  // Opcional: clave pública VAPID para notificaciones push (ver README, "Notificaciones push").
  // Vacía = notificaciones desactivadas.
  VAPID_PUBLIC_KEY: "",
};
