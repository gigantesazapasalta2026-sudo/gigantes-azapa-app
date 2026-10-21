# Copa FUFY — mesa de control digital

Contrato de implementación, 21 de octubre de 2026. Extiende el portal de clubes y conserva el cierre global de nóminas y las excepciones exclusivas del Control Center.

## API de la aplicación

Edge Function `fufy-match-desk`, POST JSON, respuestas sin caché. Los turnos usan `X-Fufy-Desk-Token`; la administración usa el JWT de Supabase en Authorization. La clave no se guarda en el navegador. Solo el token del turno se conserva en sessionStorage y se elimina al cerrar el turno. Ningún secreto va en URL ni repositorio.

- `{action:"login",password,operator_name}` → snapshot más `session_token`. Nombre declarado de 3–80 caracteres; clave compartida de la mesa. Sesión de hasta 12 horas.
- `{action:"snapshot"}` → snapshot del turno activo.
- `{action:"logout"}` → `{ok:true}`; revoca el token.
- `{action:"command",request_id,match_id,expected_updated_at,command,event?,event_id?,reason?}` → snapshot. `request_id` UUID nuevo por acción; conservarlo para reintentar exactamente la misma acción después de una respuesta de red incierta. El servidor deduplica. Un 409 exige actualizar antes de una acción nueva.
- `{action:"admin_info"}` con JWT → `{project,access:{configured,active,expires_at,updated_at},sessions:[{id,operator_name,started_at,expires_at,ended_at}],audit:[...]}`. Solo superadmin/board o editor/manager del proyecto FUFY.
- `{action:"admin_rotate"}` con JWT → mismo resultado más `password` generado en el servidor y mostrado una sola vez. Renueva la clave y cierra los turnos existentes. Requiere confirmación concreta en la interfaz porque interrumpe los turnos activos.

Snapshot: `{project:{id,name,event_date},session:{id,operator_name,started_at,expires_at},teams:[{id,name}],matches:[...],players:[{id,team_id,full_name,jersey_number,review_status}],events:[...],audit:[{id,match_id,event_id,action,operator_name,reason,created_at}],server_time}`. No incluye documento, nacimiento, salud, firmas, teléfonos ni credenciales. Los nombres deportivos y dorsales sí se publican al registrar eventos.

Comandos: `start`, `resume`, `finish`, `suspend`, `reopen`, `add_event`, `void_event`.

- `start`: partido programado, sin marcador previo distinto de cero. Activa el acta digital e inicia el partido. Classic dura 20 minutos corridos sin entretiempo, conforme a las bases. La interfaz confirma que el primer inicio cierra las nóminas de todo el torneo. No importa ni sobrescribe marcadores manuales existentes.
- `resume`: suspensión → en juego. `finish`: acta en fase playing → finalizada (reanudar primero si está suspendida). Confirmación con el marcador visible.
- `suspend`: pausa un partido en juego, mantiene el marcador. `reopen`: finalizada → en juego, requiere motivo de al menos 10 caracteres. `suspend` requiere motivo de al menos 5 caracteres.
- `add_event`: solo acta digital en juego (admite cargar un hecho pendiente durante una pausa). `event:{team_id,player_id,kind,period,match_minute}`. Periodo fijo 1 (no se muestra selector); minuto opcional de 0 a 120 para permitir adicionales, sin simular un reloj oficial. Jugador obligatorio salvo try penal. El jugador debe pertenecer a la nómina activa del equipo; no se aceptan jugadores retirados o rechazados. Los pendientes de revisión se muestran como tales y no se consideran habilitados automáticamente.
- `void_event`: acta digital en juego; anula un evento existente, motivo de al menos 5 caracteres, recalcula el resultado. El evento y su anulación siguen en el historial. Para corregir un acta final debe reabrirse con motivo y volver a finalizar.

Tipos y valores: `try` 5 puntos y 1 try; `conversion` 2; `penalty` 3; `drop_goal` 3; `penalty_try` 7 y 1 try (sin goleador individual); `yellow_card` y `red_card` 0. La referencia de puntaje es World Rugby, ley 8. La clasificación conserva el motor y los criterios existentes de la Copa; solo incorpora actas finalizadas.

## Datos y RPC de servidor

Todas las tablas nuevas tienen RLS. Tablas privadas de servicio en public con permisos revocados a PUBLIC/anon/authenticated y política restrictiva false: `fufy_desk_access`, `fufy_desk_sessions`, `fufy_desk_login_limits`, `fufy_desk_commands`, `fufy_desk_audit`.

`fufy_desk_access`: project_id PK, password_hash bcrypt, active, credential_version, expires_at, updated_at. `fufy_desk_sessions`: id UUID, project_id, token_hash SHA256 único, operator_name, credential_version, started_at, expires_at, ended_at. `fufy_desk_login_limits`: project_id + ip_hash, attempt_count, window_started_at; máximo 20 intentos por 15 minutos. Una respuesta de credenciales inválidas se devuelve como dato, sin RAISE que revierta el contador.

RPC SECURITY INVOKER, EXECUTE solamente service_role, search_path vacío:

- `fufy_desk_login(p_project_id uuid,p_password text,p_operator_name text,p_token_hash text,p_ip_hash text)` → `{ok,session_id?,error?,status?}`. Compara bcrypt; valida acceso activo y no vencido; crea sesión con expiración mínima entre 12h y la de acceso.
- `fufy_desk_session(p_token_hash text)` → objeto de sesión (incluye project_id) o error PT401. Cada RPC de escritura vuelve a verificar token, versión y vencimiento dentro de la transacción.
- `fufy_desk_logout(p_token_hash text)` → `{ok:true}`. Revoca solo ese turno.
- `fufy_desk_rotate_access(p_project_id uuid,p_actor_id uuid,p_password text)` → `{ok:true}`. Valida el rol por `private.fufy_require_roster_admin`, bcrypt, vigencia hasta 14 días después de event_date (al menos un día desde ahora), aumenta versión y revoca sesiones previas. Guarda auditoría; no devuelve hash.
- `fufy_desk_command(p_token_hash text,p_request_id uuid,p_match_id uuid,p_expected_updated_at timestamptz,p_command text,p_payload jsonb default '{}')` → `{ok:true,match_id,event_id?,replayed?:true}`. p_payload es `{event?,event_id?,reason?}`.

Comando: bloquea la fila del partido, verifica proyecto y turno, deduplica request_id con mismo turno y huella de la solicitud, compara updated_at, valida transición y jugador, escribe evento, recalcula sumas y actualiza marcador/tries/tarjetas desde eventos vigentes, guarda auditoría y comando, todo atómico. Revalida la deduplicación tras tomar el lock para cubrir solicitudes simultáneas. El actor viene de la sesión, nunca del cliente. Un token de mesa no permite cambiar nóminas, subir archivos ni efectuar excepciones.

`fufy_matches` añade `desk_enabled boolean default false`, `desk_phase text default 'not_started'` (not_started/playing/finished/suspended). updated_at se renueva por trigger. Una vez desk_enabled, un trigger impide cambiar marcador, tries, tarjetas, estado, fases y equipos desde el editor antiguo; solo el contexto transaccional privado de la RPC de mesa permite estos cambios. El contexto se restaura antes de retornar. La edición de otros datos de fixture sigue disponible.

`fufy_match_events` contiene SOLO: id,project_id,match_id,team_id,player_id nullable,player_name nullable,jersey_number nullable,kind,points,period,match_minute nullable,created_at,voided_at nullable. No contiene operador, razón, notas privadas ni documentación. SELECT público solo cuando projects.public_visible=true; todas las escrituras son del servicio. Publicación `supabase_realtime` incluye fufy_matches y fufy_match_events (comprobar existencia antes de añadir). No publicar tablas de turnos, nóminas ni auditoría.

Historial privado: `fufy_desk_audit` incluye id,project_id,session_id nullable,actor_user_id nullable,match_id nullable,event_id nullable,operator_name,action,reason,created_at. Guarda ingreso/salida de turno, rotación de clave, transiciones, anotaciones y anulaciones. Evitar texto ingresado por personas en tablas deportivas públicas.

## Clientes

`fufy-mesa.html/js/css`: ingreso clave + nombre; selección de partido, dos equipos, acciones grandes para registro desde celular, jugador de nómina, minuto, marcadores, feed de eventos, corrección, confirmaciones de inicio y fin. Mostrar turno vigente y botón terminar/cambiar turno. En otra sección, acceso administrativo existente y gestión de clave/historial. Manejar 401/403/409/423 y pérdida de conexión sin presentar una operación no confirmada como guardada. No cola offline ni resultados ficticios. Snapshot periódico 5 s cuando visible; evitar re-render que borre formulario abierto.

`fufy.html` + `fufy-live.js/css`: fixture con marcadores en juego/pausados/finalizados, tabla oficial con finales, goleadores por puntos individuales y eventos por jugador. Realtime en ambas tablas con filtro de proyecto, refresh agrupado y sondeo de respaldo cada 5 segundos. Indicar última sincronización y estado desconectado. Mostrar anulaciones identificadas; excluirlas de sumas y rankings. Conservar todas las secciones existentes de la página.

## Verificación

Pruebas SQL dentro de transacción y ROLLBACK: secreto/tabla/RPC inaccesibles a anon y authenticated; clave errónea y rate limit; token expirado/revocado; rol admin falso; evento de otro club/partido y jugador retirado/rechazado; valor de puntos controlado servidor; doble request idempotente; request reutilizado distinto rechazado; CAS stale rechazado; transición inválida; anular recalcula, reabrir requiere motivo; edición antigua de marcador bloqueada; la primera partida conserva cierre global; salida/rotación revoca; contexto transaccional restaurado. No dejar resultados ni jugadores de prueba reales.
