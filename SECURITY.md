# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **Security → Report a vulnerability** en GitHub (reporte privado). Incluye qué rol necesitas para reproducirla y qué datos quedan expuestos o alterados. Prueba solo contra tu propia instalación, nunca contra la de una comunidad real.

## Modelo de seguridad

- La clave `anon` de Supabase es pública por diseño. Todo control de acceso está en las políticas RLS y triggers de `supabase/schema.sql`; el frontend solo decide qué mostrar.
- Cada fila pertenece a un edificio y toda política exige que coincida con el edificio del usuario activo.
- Las reglas de negocio sensibles no dependen del navegador: quién aprueba reservas y órdenes de trabajo, el rol con que se firma un mensaje, el estado inicial de reservas e incidencias.
- Fotos y documentos están en un bucket privado. La función `puede_ver_archivo()` decide por carpeta y por la fila que referencia al archivo quién puede leerlo; la app solo muestra URLs firmadas.
- El frontend escapa todo dato antes de insertarlo en el HTML y aplica una política CSP sin scripts en línea. `supabase-js` se carga con versión fija y verificación de integridad (SRI).
- La clave `service_role`, la clave privada VAPID y `PUSH_SECRET` nunca van en el repositorio ni en `web/config.js`.

## Limitaciones conocidas

- **Una URL firmada funciona durante 1 hora para quien la tenga.** Los archivos están en un bucket privado y solo quien puede leerlos obtiene la URL, pero si esa persona la comparte, sirve sin sesión hasta que vence.
- **Los Documentos los lee todo residente del edificio** (no las empresas de mantención).
- **El historial de incidencias y órdenes lo escribe el navegador** de quien tiene permiso de edición; no es un registro de auditoría inalterable.
- **Comité y conserjería ven nombre, unidad y teléfono de todos los usuarios** del edificio.

## Lista de verificación para quien opera una instalación

En el panel de Supabase:

1. *Authentication → Providers → Email*: **Confirm email** activado en producción.
2. *Authentication → Policies / Passwords*: largo mínimo de contraseña 8 o más y protección contra contraseñas filtradas, si tu plan la incluye.
3. *Authentication → Attack Protection*: CAPTCHA en registro e inicio de sesión; revisa los límites de frecuencia.
4. *Authentication → URL Configuration*: solo la URL real de la app en *Site URL* y *Redirect URLs*.
5. Activa MFA en tu cuenta de Supabase y en la del hosting; limita quién tiene acceso al proyecto.
6. Activa la extensión `pg_cron` (*Database → Extensions*) para que el borrado por plazo de conservación corra a diario.
7. Mantén `plataforma.creacion_abierta = false` salvo mientras das de alta un edificio.
8. Revisa periódicamente *Database → Backups* y prueba una restauración.
9. Tras actualizar el código, vuelve a ejecutar `supabase/schema.sql`: las políticas y triggers se recrean.
