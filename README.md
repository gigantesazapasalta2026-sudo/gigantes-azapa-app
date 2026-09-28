# Club Deportivo Gigantes de Azapa

Plataforma central **Mi Gigantes**.

## Estado actual

Este repositorio es el **staging temporal de desarrollo** mientras consolidamos la aplicación bajo la cuenta institucional del club.

- Staging actual: `rogerlazo-astor/gigantes-azapa-app`
- Cuenta institucional destino: `gigantesazapasalta2026-sudo`
- Repositorio institucional definitivo pendiente de crear: `gigantes-azapa-app`
- Dominio oficial reservado: `www.gigantesdeazapa.cl`
- El dominio permanece desconectado hasta la auditoría y corte final.
- Backend: Supabase `euuzsojkinbwcvtpwoau`

## Arquitectura

- Sitio público + PWA: GitHub Pages.
- Datos privados: Supabase con RLS.
- Acceso: Supabase Auth, perfiles y roles.
- Mi Gigantes: jugadores, apoderados, Chile Rugby, documentos, cuotas, comprobantes y seguro.
- Operación: eventos, asistencia, comunicaciones, proyectos/giras, tesorería, calidad de datos y notificaciones.
- Automatizaciones: alertas diarias y métricas públicas agregadas.
- Biblioteca temporal de medios: repositorio histórico institucional `gigantes-salta-2026-app`.

## Módulos implementados

- Membresías multideporte.
- Familias y apoderados.
- Chile Rugby / FERUCHI.
- Documentos y checklist.
- Cuotas y comprobantes.
- Lesiones y seguro.
- Proyectos y giras.
- Eventos, RSVP, asistencia, recurrencia y lista de espera.
- Comunicaciones segmentadas con confirmación de lectura.
- Roles y accesos.
- Notificaciones automáticas en cola.
- PWA instalable.
- Métricas públicas sin datos personales.
- Panel piloto y calidad de datos.

## Seguridad

- Nunca agregar `service_role`, secret keys, tokens, contraseñas o códigos de recuperación.
- La publishable key del navegador sólo se usa con tablas protegidas por RLS.
- Datos de menores, salud, RUT, contactos, documentos, seguros y pagos permanecen en Supabase privado.
- Las rutas privadas no se cachean en el Service Worker.
- Todas las tablas públicas tienen RLS activo.
- Funciones privilegiadas viven en esquema `private`.

## Antes de producción

1. Crear el repositorio institucional `gigantes-azapa-app`.
2. Migrar y verificar el staging actual.
3. Probar Directiva y familias.
4. Activar Leaked Password Protection en Supabase Auth.
5. Configurar SMTP institucional para emails automáticos.
6. Auditoría final móvil, seguridad y navegación.
7. Conectar `www.gigantesdeazapa.cl`.
8. Configurar Site URL / Redirect URLs de Supabase para el dominio final.
9. Activar HTTPS y abrir producción.

## Respaldo

La rama `backup-pre-institutional-migration-2026-09-28` conserva el estado previo a la migración institucional.
