# Club Deportivo Gigantes de Azapa

Repositorio oficial de la plataforma **Mi Gigantes**.

**Producción:** https://www.gigantesdeazapa.cl  
**Backend:** Supabase `euuzsojkinbwcvtpwoau`  
**Repositorio:** `rogerlazo-astor/gigantes-azapa-app`

## Arquitectura

- Sitio público + PWA: GitHub Pages / dominio propio.
- Datos privados: Supabase con RLS.
- Acceso: Supabase Auth, perfiles y roles.
- Mi Gigantes: jugadores, apoderados, Chile Rugby, documentos, cuotas, comprobantes y seguro.
- Operación: eventos, asistencia, comunicaciones, proyectos/giras, tesorería, calidad de datos y notificaciones.
- Automatizaciones: generación diaria de alertas y actualización horaria de métricas públicas.

## Dominio de producción

Dominio canónico: `www.gigantesdeazapa.cl`.

DNS esperado para GitHub Pages:

- `www` → CNAME → `rogerlazo-astor.github.io`
- `@` → A → `185.199.108.153`
- `@` → A → `185.199.109.153`
- `@` → A → `185.199.110.153`
- `@` → A → `185.199.111.153`

No usar registros wildcard `*`.

En GitHub Pages:
1. Custom domain: `www.gigantesdeazapa.cl`
2. Esperar validación DNS/certificado.
3. Activar **Enforce HTTPS**.

## Supabase Auth antes de abrir el piloto

En Authentication → URL Configuration:

- Site URL: `https://www.gigantesdeazapa.cl`
- Redirect URL: `https://www.gigantesdeazapa.cl/**`
- Mantener temporalmente fallback de pruebas: `https://rogerlazo-astor.github.io/gigantes-azapa-app/**`

En Authentication → Security:
- Activar **Leaked Password Protection**.

## Seguridad

- Nunca agregar `service_role`, secret keys, tokens, contraseñas o códigos de recuperación al repositorio.
- La publishable key del navegador sólo se usa con tablas protegidas por RLS.
- Datos de menores, salud, RUT, contactos, documentos, seguros y pagos permanecen en Supabase privado.
- Las rutas privadas no se cachean en el Service Worker.

## Estado funcional

Implementado:
- Registro/membresías multideporte.
- Familias y apoderados.
- Chile Rugby / FERUCHI.
- Documentos y checklist.
- Cuotas y comprobantes.
- Lesiones/seguro.
- Proyectos y giras.
- Eventos, RSVP, asistencia, series recurrentes y lista de espera.
- Comunicaciones segmentadas con confirmación de lectura.
- Roles y accesos.
- Notificaciones automáticas en cola.
- PWA instalable.
- Métricas públicas agregadas sin datos personales.

Pendiente de proveedor externo:
- Envío transaccional automático de correos desde la cola.
- Pago online integrado si el club decide habilitar Webpay/u otro proveedor.
