# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **Security → Report a vulnerability** en GitHub (reporte privado). Incluye qué rol necesitas para reproducirla y qué datos quedan expuestos o alterados. Prueba solo contra tu propia instalación, nunca contra la de una comunidad real.

## Modelo de seguridad

- La clave `anon` de Supabase es pública por diseño. Todo control de acceso está en las políticas RLS y triggers de `supabase/schema.sql`; el frontend solo decide qué mostrar.
- Cada fila pertenece a un edificio y toda política exige que coincida con el edificio del usuario activo.
- Las reglas de negocio sensibles no dependen del navegador: quién aprueba reservas y órdenes de trabajo, el rol con que se firma un mensaje, el estado inicial de reservas e incidencias.
- El frontend escapa todo dato antes de insertarlo en el HTML y aplica una política CSP sin scripts en línea. `supabase-js` se carga con versión fija y verificación de integridad (SRI).
- La clave `service_role`, la clave privada VAPID y `PUSH_SECRET` nunca van en el repositorio ni en `web/config.js`.

## Limitaciones conocidas

- **Los archivos son públicos por URL.** El bucket `fotos` es de lectura pública: quien conozca la URL de una foto o documento puede abrirlo sin iniciar sesión. Las rutas son aleatorias (128 bits) y el bucket no se puede listar, pero una URL compartida o filtrada sigue funcionando. No subas ahí documentos que requieran confidencialidad estricta.
- **El historial de incidencias y órdenes lo escribe el navegador** de quien tiene permiso de edición; no es un registro de auditoría inalterable.
- **Comité y conserjería ven nombre, unidad y teléfono de todos los usuarios** del edificio.

## Lista de verificación para quien opera una instalación

En el panel de Supabase:

1. *Authentication → Providers → Email*: **Confirm email** activado en producción.
2. *Authentication → Policies / Passwords*: largo mínimo de contraseña 8 o más y protección contra contraseñas filtradas, si tu plan la incluye.
3. *Authentication → Attack Protection*: CAPTCHA en registro e inicio de sesión; revisa los límites de frecuencia.
4. *Authentication → URL Configuration*: solo la URL real de la app en *Site URL* y *Redirect URLs*.
5. Activa MFA en tu cuenta de Supabase y en la del hosting; limita quién tiene acceso al proyecto.
6. Mantén `plataforma.creacion_abierta = false` salvo mientras das de alta un edificio.
7. Revisa periódicamente *Database → Backups* y prueba una restauración.
8. Tras actualizar el código, vuelve a ejecutar `supabase/schema.sql`: las políticas y triggers se recrean.
