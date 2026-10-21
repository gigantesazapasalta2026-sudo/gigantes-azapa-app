# Portal de clubes Copa FUFY · Contrato de implementación

Estado documentado: 21 de octubre de 2026. Describe la implementación del portal de nóminas Classic del 24 de octubre de 2026. No modifica las bases ni registra una ratificación de la Adenda V1.3.

## 1. Componentes y acceso

| Componente | Archivos o ruta | Función |
| --- | --- | --- |
| Portal de delegaciones | [`fufy-clubes.html`](../fufy-clubes.html), [`fufy-clubes.js`](../fufy-clubes.js), [`fufy-clubes.css`](../fufy-clubes.css) | Guardar delegación, jugadores y documentos; imprimir, exportar y enviar a revisión. |
| Control de organización | [`gestion/fufy-clubes.html`](../gestion/fufy-clubes.html), [`gestion/fufy-clubes.js`](../gestion/fufy-clubes.js) | Gestionar invitaciones, revisar expedientes y autorizar cierres o correcciones. |
| Helper | [`fufy-portal-core.js`](../fufy-portal-core.js) | Transporte, errores, escape HTML, CSV, fechas, etiquetas y enlaces oficiales. |
| API | [`supabase/functions/fufy-club-portal/index.ts`](../supabase/functions/fufy-club-portal/index.ts) | Autenticación, autorización por equipo, validaciones, archivos y auditoría. |
| Persistencia | [`supabase/migrations/20261021202749_fufy_club_portal.sql`](../supabase/migrations/20261021202749_fufy_club_portal.sql) | Tablas privadas, RLS, versiones y controles atómicos. |
| Ubicación y declaración impresa | [`supabase/migrations/20261021203925_fufy_club_location.sql`](../supabase/migrations/20261021203925_fufy_club_location.sql) | Ciudad y país del expediente; cierre e invalidación al cambiar datos impresos de la delegación. |
| Tabla compartida | `fufy-roster-grid.js`, `fufy-roster-grid.css` | 25 filas preparadas, borradores en memoria, guardado por fila y control de versión en ambas interfaces. |
| Cierre global y excepciones | `supabase/migrations/20261021211726_fufy_control_center_rosters.sql` | Sella las nóminas de todos los clubes al comenzar el torneo y exige autorización unánime para cada cambio administrativo posterior. |

La página pública de la Copa enlaza el portal y su ayuda `/fufy-clubes.html#fp-rugby`. La gestión de la Copa y los accesos del Control Center enlazan `/gestion/fufy-clubes.html`.

El proyecto se resuelve por `projects.code = 'FUFY2026'`. Son elegibles los equipos de ese proyecto con `active = true` y estado `organizer`, `confirmed` o `roster_pending`. Los cuatro participantes actuales son Gigantes, Bucaneros Classic, Provincia 7 y Toros Rugby Arequipa; la autorización no depende de una lista de nombres codificada en el frontend. La migración inicial crea un expediente para cada equipo elegible existente.

### Invitación privada del club

Formato: `https://gigantesdeazapa.cl/fufy-clubes.html#acceso=<secreto>`.

El secreto consta de 32 bytes aleatorios representados por 64 caracteres hexadecimales. La base de datos conserva solo su hash SHA-256. Permite gestionar un único equipo sin crear cuenta de socio ni cuenta Supabase al delegado.

El HTML retira `#acceso` del historial antes de cargar otros scripts. El frontend consume y elimina la variable temporal de arranque y conserva el secreto en memoria y, cuando está disponible, en `sessionStorage` bajo `fufy-club-token-v1`. «Cerrar acceso» limpia el acceso y los datos mostrados. Se utiliza `no-referrer`, `noindex, nofollow, noarchive`, y las rutas sensibles del service worker y las solicitudes evitan caché de expedientes.

Existe una invitación por club. Renovarla sustituye su hash e invalida el enlace anterior de inmediato; revocarla desactiva el acceso sin borrar el expediente. El panel confirma estas acciones, muestra el enlace nuevo únicamente en el diálogo de generación, permite copiarlo y limpia el diálogo al cerrarlo. La API no envía correos ni mensajes.

La caducidad está fijada en `2026-11-07T12:00:00Z`: catorce días desde el mediodía UTC del torneo, no desde la generación del enlace. La API rechaza generar enlaces después de esa fecha.

### Autorización de organización

El panel reutiliza la sesión Supabase existente mediante `GIGANTES_AUTH_STORAGE`. Antes de cada solicitud valida al usuario con `auth.getUser()` y obtiene de `auth.getSession()` el `access_token` sin transformarlo. El servidor vuelve a validar el JWT mediante `db.auth.getUser(token)` y exige `profiles.active = true`, junto con una de estas vías:

- `profiles.role` igual a `superadmin` o `board`.
- Una fila de `project_user_access` para el mismo usuario y proyecto con `access_role` igual a `editor` o `manager`.

Una sesión autenticada o un permiso de lectura, tesorería o socio por sí solos no otorgan gestión del portal. El servidor es la autoridad de permisos.

## 2. Transporte

Endpoint: `${GIGANTES_SUPABASE_URL}/functions/v1/fufy-club-portal`.

Se utiliza `POST` con JSON `{action, ...payload}` y cabecera `apikey` publicable. La carga de archivos usa multipart; el cliente no fija manualmente su `Content-Type`, para conservar el separador generado por el navegador.

| Actor | Credencial adicional |
| --- | --- |
| `public_info` | Ninguna. Si se envía una credencial, se valida. |
| Club | `X-Fufy-Token: <secreto>`; el servidor exige 64 caracteres hexadecimales en minúsculas. |
| Acciones `admin_*` | `Authorization: Bearer <Supabase access token>`. |

Enviar ambas credenciales produce `400`. La autenticación ocurre antes de leer el cuerpo de un archivo. El equipo de una solicitud del club se obtiene exclusivamente de la invitación validada; un `team_id` enviado por el cliente no puede cambiar su pertenencia.

Éxito: objeto JSON directo, sin envoltorio `data`. Error: `{error: "mensaje para la persona"}`. Las respuestas llevan `Cache-Control: no-store`; las respuestas normales añaden `Pragma: no-cache` y `X-Fufy-Portal-Version: 20261021-5`.

| HTTP | Significado relevante |
| --- | --- |
| `400` | Formulario, archivo o acción inválidos. También puede reflejar un cierre detectado por el trigger SQL durante una operación. |
| `401` | Invitación inválida, revocada o vencida; sesión ausente o vencida. |
| `403` | Origen, cuenta o equipo sin autorización. |
| `404` | Jugador o documento no disponible dentro del equipo autorizado. |
| `409` | Versión desactualizada, identidad duplicada dentro del club o estado incompatible con la revisión. |
| `413` | Cuerpo de solicitud demasiado grande. |
| `423` | Nómina cerrada en la comprobación inicial de la API. |
| `500` | Error de servicio; no expone SQL, secretos ni rutas privadas. |

Orígenes admitidos: `https://gigantesdeazapa.cl`, `https://www.gigantesdeazapa.cl`, `https://gigantesazapasalta2026-sudo.github.io`, y `http://localhost` / `http://127.0.0.1` con puerto opcional. Una solicitud sin `Origin` sigue requiriendo autorización. CORS no sustituye el control de acceso.

Máximo del cuerpo JSON: 64 KiB. Máximo multipart: 5 MiB más 64 KiB para campos y cabeceras. El helper espera hasta 30 segundos para JSON y 60 para archivos. Ante una respuesta incierta por tiempo de espera indica recargar para comprobar el estado antes de repetir; no reintenta escrituras automáticamente.

En el servidor, el cliente Supabase admite un único reintento de sus solicitudes `GET` o `HEAD` cuando hay error de transporte o respuesta `502`, `503` o `504`. Este reintento no se aplica a escrituras ni a las solicitudes `POST` que el navegador envía al portal; tampoco convierte una respuesta incierta de guardado en éxito.

## 3. Snapshot y campos

Las consultas detalladas y las ediciones devuelven:

```text
Snapshot = {
  team: { id, name, city, country },
  submission,
  players: [...],
  documents: [...],
  checks: { missing: string[], warnings: string[], complete: boolean },
  event: { name, date },
  access: { read_only, exception_required, first_match_at, tournament_started, reason },
  roster_changes: [...] // solo organización; últimos 50 cambios
}
```

`players` excluye retirados y se ordena por nombre. `documents` excluye retirados, incluye versiones desactualizadas y se ordena de más reciente a más antiguo. `checks.complete` solo significa que `missing` está vacío; no certifica salud, cobertura, firmas ni inscripción federativa.

### Expediente

Datos editables: `club_city`, `club_country`, `delegate_name`, `delegate_email`, `delegate_phone`, `manager_name`, `manager_phone`, `captain_name`, `first_aid_name`, `first_aid_phone`, `club_notes`, `accepted_bases`, `confirmed_accuracy`, `privacy_consent`.

Control: `team_id`, `status` (`draft`, `submitted`, `observed`, `approved`), `created_at`, `updated_at`, `submitted_at`, `reviewed_at`, `review_note`, `locked_at`, `unlock_until`, `unlock_reason`. El snapshot no expone `reviewed_by`.

La ciudad (máximo 120 caracteres) y el país (máximo 80) declarados se guardan en el expediente sin cambiar `project_teams`. La migración de ubicación inicia esos campos con los datos maestros existentes. En el snapshot, `team.city` y `team.country` usan la declaración cuando existe y recurren al dato maestro cuando está vacía. Las versiones `updated_at` se reutilizan exactamente como llegan; nunca se reformatean antes de enviarlas como condición de guardado.

### Jugador

Datos editables: `full_name`, `document_type`, `document_number`, `birth_date`, `nationality`, `jersey_number`, `emergency_contact`, `emergency_phone`, `federation_status`, `coverage_type`, `insurance_provider`, `insurance_valid_until`, `signature_declared`, `notes`.

Metadatos expuestos: `id`, `team_id`, `review_status`, `review_note`, `reviewed_at`, `created_at`, `updated_at`, `removed_at`. No se devuelven `reviewed_by` ni `document_key`.

| Campo | Valores y validación del servidor |
| --- | --- |
| `full_name` | 3 a 160 caracteres. |
| `document_type` | `RUT`, `DNI`, `Pasaporte`, `Otro`; no obliga a usar RUT chileno ni valida su dígito verificador. |
| `document_number` | 3 a 40 caracteres, con al menos 3 alfanuméricos al normalizarlo. |
| `birth_date` | Fecha real obligatoria `YYYY-MM-DD`, entre `1900-01-01` y `2026-10-24`. |
| `jersey_number` | Entero de 0 a 999 o `null`. |
| `federation_status` | `pending`, `declared`, `not_applicable`. |
| `coverage_type` | `pending`, `insurance`, `prevision`, `other`. |
| `insurance_valid_until` | Fecha real `YYYY-MM-DD` o `null`. |
| `review_status` | `pending`, `observed`, `reviewed`. |

Para guardar una ficha se exige nombre, tipo y número de identidad y nacimiento válidos. Los demás antecedentes pueden quedar pendientes. Guardar datos de jugador desde el club restablece su revisión a `pending` y limpia su observación individual anterior.

### Documento

Campos expuestos: `id`, `team_id`, `player_id` nullable, `kind`, `file_name`, `mime_type`, `size_bytes`, `is_current`, `created_at`, `removed_at`. No se devuelven `storage_path` ni `source_updated_at`.

| `kind` | Destino y uso |
| --- | --- |
| `signed_roster` | Club completo: nómina y declaraciones firmadas de jugadores y mánager. |
| `manager_declaration` | Club completo: declaración firmada del mánager. |
| `player_declaration` | Requiere `player_id`: declaración firmada del jugador. |
| `insurance` | Club o jugador: respaldo de cobertura. |
| `federation` | Club o jugador: antecedente federativo. |
| `identity` | Club o jugador: antecedente de identidad que decidan aportar. |
| `other` | Club o jugador: otro antecedente. |

El formulario limpia y bloquea la selección de jugador para los dos tipos de club completo; la API también rechaza esos tipos si reciben `player_id`. Permitir un archivo no lo convierte en exigencia de las bases.

## 4. Operaciones del club

| Acción | Carga útil adicional | Resultado y condiciones |
| --- | --- | --- |
| `public_info` | Ninguna; pública. | `{event:{name,date}, teams:[{id,name,city,country}]}` de equipos elegibles; no incluye datos personales. |
| `open` | Ninguna. | `Snapshot` del club autorizado. |
| `save_submission` | `{data:{...campos editables del expediente}, expected_updated_at}` | `Snapshot`. CAS sobre expediente. Guarda borrador y limpia revisión general; conserva `review_note` como referencia. |
| `save_player` | `{player:{id?, ...campos editables}, expected_updated_at?}` | `Snapshot`. Alta sin versión; edición con versión obligatoria del jugador. El servidor asigna el ID del alta. |
| `delete_player` | `{player_id, expected_updated_at}` | `Snapshot`. Retirada lógica con `removed_at` e invalidación de respaldos afectados. |
| `submit` | `{expected_updated_at}` | `Snapshot`. Requiere al menos un jugador, nombre/correo/teléfono del delegado y `privacy_consent = true`; permite pendientes documentales. |
| `upload_document` | Multipart: `action=upload_document`, `kind`, `player_id` si procede, `file`, `expected_updated_at`. | `Snapshot`. La versión es la del expediente al iniciar la carga. |
| `get_document` | `{document_id}` | `{url, expires_in:120}` del archivo de ese equipo. |
| `delete_document` | `{document_id}` | `Snapshot`. Retira el documento y sus bytes según la sección 8. |

Los cambios y el envío requieren edición abierta. Consulta, impresión, CSV y descarga siguen disponibles tras el cierre mientras la invitación sea válida. `save_submission` admite datos incompletos como borrador y valida los informados, por ejemplo el correo. El frontend guarda primero los cambios pendientes de delegación antes de enviar la nómina, utilizando después la nueva versión recibida.

## 5. Operaciones de organización

| Acción | Carga útil adicional | Resultado y condiciones |
| --- | --- | --- |
| `admin_list` | Ninguna. | `{teams:[...], can_manage:true}`: datos del equipo, resumen del expediente, `player_count`, `document_count`, `invitation` o `null`. |
| `admin_open` | `{team_id}` | `Snapshot` con comprobación adicional de identidades repetidas entre clubes. |
| `admin_invite` | `{team_id}` | `{url, token, expires_at, team_name}`. El secreto se devuelve solo al crearlo o renovarlo. |
| `admin_revoke` | `{team_id}` | `{ok:true}`. |
| `admin_document` | `{team_id, document_id}` | `{url, expires_in:120}`. |
| `admin_review` | `{team_id, status:'observed'|'approved', review_note, expected_updated_at}` | `Snapshot`. CAS sobre expediente; solo revisa estados `submitted` u `observed`. |
| `admin_review_player` | `{team_id, player_id, review_status:'pending'|'observed'|'reviewed', review_note, expected_updated_at}` | `Snapshot`. CAS sobre jugador; disponible aunque la edición del club esté cerrada. |
| `admin_lock` | `{team_id}` | `Snapshot`. Cierra la nómina del club. |
| `admin_lock_all` | Ninguna. | `{ok:true,closed_count}`. Cierra todas las nóminas de participantes del campeonato. |
| `admin_save_player` | `{team_id,player,expected_updated_at?,exception?}` | `Snapshot`. Agrega o modifica un jugador. Una edición existente exige CAS; tras el cierre exige la autorización detallada abajo. |
| `admin_delete_player` | `{team_id,player_id,expected_updated_at,exception?}` | `Snapshot`. Retira un jugador con CAS y, tras el cierre, autorización excepcional. |
| `admin_unlock` | Cualquier carga. | Retirado: devuelve `400`. Las delegaciones no se reabren. |

Las filas de `admin_list` contienen `id`, `name`, `city`, `country`, `status`, `submission`, `player_count`, `document_count` e `invitation`. El resumen de expediente incluye `team_id`, `status`, `updated_at`, `submitted_at`, `reviewed_at`, `review_note`, `locked_at`, `unlock_until`. La invitación contiene `team_id`, `active`, `expires_at`, `created_at`; nunca el hash ni el secreto. Los conteos excluyen retirados; el conteo inicial de documentos incluye desactualizados. El panel abre snapshots para calcular documentos actuales y faltantes.

`admin_review` con `approved` exige `checks.missing` vacío. Observar un expediente, o marcarlo revisado cuando hay advertencias, exige nota de al menos 5 caracteres, máximo 2500. La interfaz etiqueta `approved` como «Expediente revisado». `admin_review_player` con `observed` exige nota de al menos 5 caracteres, máximo 1500. El estado individual `pending` no bloquea por sí solo la aprobación general: esta requiere revisión humana de los antecedentes.

La interfaz confirma el cierre y, para cada alta, modificación o retirada posterior, solicita `exception`: `reason` (10–1200 caracteres), `organization_authorizer` (3–160), `organization_agreed:true`, `approval_reference` (5–1000), y `club_approvals` con exactamente todos los clubes participantes actuales. Cada autorización contiene `team_id`, `representative_name` (3–160) y `approved:true`. No se reutilizan nombres ni casillas de otra operación. La organización registra así los acuerdos obtenidos y la referencia de su respaldo; el sistema no envía solicitudes ni mensajes a representantes.

## 6. Versiones y vigencia de respaldos

### Comparación de versión (CAS)

| Operación | Versión exigida |
| --- | --- |
| `save_submission`, `submit`, `admin_review` | `expected_updated_at = snapshot.submission.updated_at`. |
| `save_player` con `player.id`, `delete_player`, `admin_review_player` | `expected_updated_at = player.updated_at` de la ficha editada o revisada. |
| `admin_save_player` con `player.id`, `admin_delete_player` | `expected_updated_at = player.updated_at`; se comprueba también bajo lock en la RPC SQL. |
| `upload_document` | Campo multipart `expected_updated_at = snapshot.submission.updated_at`. |

La API compara la versión recibida y condiciona las actualizaciones de expediente o jugador con `.eq('updated_at', version)`. Una fila que cambió devuelve `409` sin aplicar esa escritura. Los clientes indican actualizar y revisar la versión vigente; no anuncian una aprobación ni sobrescriben silenciosamente.

El trigger del expediente asigna `clock_timestamp()` a cada actualización. Los triggers de jugadores y documentos bloquean la fila padre antes de cambiar la nómina. El límite de 25 jugadores se comprueba dentro de esa sección serializada, evitando excederlo con altas simultáneas.

La carga comprueba la versión dos veces. Primero la API valida el multipart. Tras almacenar los bytes, inserta metadatos con `source_updated_at` igual a la versión comprobada. El trigger `fufy_document_guard` toma `SELECT ... FOR UPDATE` sobre el expediente y compara esa versión atómicamente. Si la nómina cambió durante la carga, rechaza la inserción con `409`. La API intenta retirar el archivo recién cargado si falla la inserción de metadatos. `source_updated_at` es interno y no aparece en snapshots.

Guardar la delegación, modificar datos de jugadores o cambiar documentos desde el club vuelve el expediente a `draft` y limpia `reviewed_at` / `reviewed_by`. Toda revisión individual también cambia la versión padre. Si un expediente aprobado recibe revisión individual `pending` u `observed`, pasa a `observed` y pierde la revisión general. Un cambio exclusivamente de revisión no invalida firmas ni convierte por sí solo todos los expedientes en borrador; esto incluye guardar una ficha sin cambios de datos, pero restableciendo su revisión a `pending`.

### Invalidación de documentos

`is_current` indica correspondencia con la nómina vigente, no autenticidad verificada. Los cambios de composición o identidad conservan los originales como documentos desactualizados, que dejan de satisfacer los controles.

| Cambio | Documentos marcados `is_current = false` |
| --- | --- |
| Alta, retirada o cambio de nombre, tipo/número de documento, nacimiento, país o `removed_at` de un jugador | Nómina consolidada y declaración del mánager; todos los documentos del jugador; seguro o federación del club completo. |
| Cambio de datos impresos de delegación: `manager_name`, `manager_phone`, `club_city`, `club_country`, `delegate_name`, `delegate_phone`, `delegate_email`, `captain_name`, `first_aid_name` o `first_aid_phone` | Nómina consolidada y declaración del mánager. |
| Cambio exclusivamente de revisión administrativa o de contactos del jugador sin modificar su identidad | No invalida por sí solo las firmas; sí cambia versión y estado cuando corresponde. |

Las dos interfaces muestran «Reemplazar por versión actual» para los desactualizados. Siguen siendo consultables hasta su retirada expresa, pero no cuentan como respaldos actuales. Marcar `signature_declared` no sustituye el documento firmado.

## 7. Cierre y excepciones

La edición se cierra si existe `locked_at`, o si cualquier partido no cancelado del mismo campeonato está `in_progress` / `final` o ya alcanzó su `starts_at` guardado en la base de datos. El primer partido cierra los cuatro clubes, incluidos los que juegan más tarde. No depende de que alguien haya iniciado manualmente el marcador.

```text
read_only = cierre_manual || primer_partido_del_campeonato_ya_iniciado
```

El cierre se persiste. Los triggers de partidos capturan tanto el estado anterior como el nuevo al modificar, reprogramar, cancelar o retirar un encuentro; mover después la hora no reabre las nóminas. Los campos antiguos `unlock_until` y `unlock_reason` quedan sin efecto.

Las excepciones se ejecutan únicamente mediante `fufy_admin_roster_change`, disponible al servicio y con validación adicional del actor administrativo. Se bloquea el expediente, se compara la versión, se exige el acuerdo de la organización y exactamente todos los representantes, se aplica una sola alta/cambio/baja y se registra todo en `fufy_club_roster_changes` y la auditoría de manera atómica. El contexto temporal se restaura antes de retornar. No permite cambios de delegación ni documentos desde el club. Los cambios siguen invalidando firmas y respaldos que correspondían a la versión anterior, y dejan el expediente pendiente de revisión.

API y triggers SQL vuelven a comprobar la edición autorizada; una pantalla anterior al cierre no puede eludirlo. Se cierran cambios de delegación, jugadores, documentos y envío. La organización conserva consulta y revisión. La clave de la mesa digital no otorga permisos de modificación de nóminas. Ver `fufy-desk-contract.md` para resultados en vivo, turnos y trazabilidad de anotaciones.

## 8. Archivos y privacidad

Bucket privado: `fufy-clubs-private`, con nombres aleatorios dentro de la carpeta del equipo. PDF, JPEG y PNG, máximo 5 MiB. Se comprueban tamaño, bytes iniciales, MIME y extensión coherentes; no se verifica automáticamente el contenido, la firma o autenticidad. El límite de carga es de 200 documentos no retirados por club, incluidas versiones desactualizadas.

Eliminar un documento marca `removed_at`, fija `is_current = false` y solicita retirar sus bytes de Storage. Si Storage devuelve error, la retirada lógica sigue aplicada y el servidor registra `storage_remove_failed` para atención operativa; no hay un reintento automático de borrado. Se conserva trazabilidad en metadatos y auditoría; deja de aparecer en snapshots y de admitir nuevas descargas del portal. Invalidar por un cambio de nómina conserva el archivo como versión anterior, hasta su retirada expresa.

Las tablas `fufy_club_submissions`, `fufy_club_invites`, `fufy_club_players`, `fufy_club_documents`, `fufy_club_roster_changes` y `fufy_club_audit` tienen RLS, revocación de privilegios para `public`, `anon` y `authenticated`, y políticas restrictivas de denegación. Una política restrictiva del bucket bloquea el acceso directo de clientes aunque haya políticas amplias para otros buckets. Solo la API, tras autenticar y autorizar, utiliza la clave `service_role` del servidor. Los triggers están en `private` y no conceden ejecución a clientes; los dos triggers de captura de inicio son SECURITY DEFINER de alcance mínimo para sellar expedientes cuando un editor autorizado actualiza el fixture. Las RPC administrativas usan SECURITY INVOKER y ejecución exclusiva del servicio.

Cada descarga exige equipo y documento autorizados y genera una URL firmada de 120 segundos. Identidades, teléfonos, correos y antecedentes no aparecen en `public_info`. El control de duplicados entre clubes solo aparece en snapshots administrativos y no expone datos ajenos a las delegaciones.

Se escapan entradas antes de insertarlas en HTML, incluida la impresión. El CSV usa BOM UTF-8, `;`, comillas y neutralización de fórmulas que comiencen por `=`, `+`, `-` o `@`, también tras espacios, o por tabulación/saltos de línea. La exportación e impresión requieren abrir un expediente autorizado.

## 9. Qué comprueba la lista de pendientes

`checks.missing` recoge:

- Ciudad y país efectivos del club cuando faltan tanto en el expediente como en el dato maestro.
- Nombre, correo y teléfono del delegado; nombre y teléfono del mánager; capitán; responsable de primeros auxilios. El teléfono de primeros auxilios es opcional.
- Lectura de bases, veracidad y autorización para entregar los antecedentes.
- Ausencia de jugadores o jugadores con revisión `observed`.
- Falta de nómina consolidada firmada actual, o de declaración actual del mánager más declaración actual de cada jugador.
- Jugadores con cobertura `pending`.
- Solo para organización: identidad coincidente con un jugador no retirado de otro club. Compara tipo, número normalizado y país; para RUT utiliza `CL`. No consulta un registro oficial.

`checks.warnings` señala quienes no cumplen 40 durante 2026, planteles con menos de 15 jugadores, seguros sin respaldo actual, cobertura declarada que vence antes del torneo y trámites federativos pendientes. También avisa si un expediente marcado revisado presenta faltantes.

La nómina consolidada puede satisfacer las firmas aunque no se marque la casilla individual; la casilla sola no satisface el requisito. Organización debe revisar visualmente los documentos. Las alertas de edad no bloquean el guardado ni eligen una de las reglas en conflicto. Aprobar con advertencias requiere registrar la resolución o criterio del Comité. Ningún estado concede habilitación médica, federativa o de seguro.

## 10. Fuentes y decisiones de contenido

Fuentes revisadas:

- [Bases oficiales Copa FUFY 2026 V1.2](https://raw.githubusercontent.com/gigantesazapasalta2026-sudo/gigantes-media-archive/main/copa-fufy/01_BASES_OFICIALES_COPA_FUFY_2026_V1.2.pdf), PDF de nueve páginas, fechado el 14 de septiembre de 2026.
- [Adenda V1.3 de organización](https://docs.google.com/document/d/19UWqBIAwGuURvt4flXwkL3zQSXeT1GfKn6vugr0j93U/edit), «COPA FUFY 2026 - ADENDA V1.3 BASES Y REGLAMENTO - Liga 4 equipos (borrador)». Al revisarla figura como borrador para ratificación.

| Requisito o dato confirmado | Fuente y tratamiento |
| --- | --- |
| Máximo 25 jugadores; mánager, capitán y apoyo de primeros auxilios. | V1.2, p. 2, sección 3. Límite aplicado en API/SQL y responsables en delegación. |
| Nombre, identidad, nacimiento; nómina definitiva antes del inicio y sin incorporaciones tras el primer partido salvo excepción del Comité. | V1.2, p. 3, sección 5. Guardado por etapas y cierre con correcciones justificadas. |
| Club, país, ciudad, mánager y teléfono; datos de jugadores, excepción, firmas y recepción de mesa. | V1.2, pp. 7–8, anexo de nómina. Recogidos en formulario e impresión. |
| Firma de cada participante y conocimiento de riesgos. | V1.2, p. 5, sección 13. Impresión y carga consolidada o declaraciones individuales más mánager. |
| Previsión, seguro u otros medios de atención médica. | V1.2, p. 5, sección 13. Opciones de declaración; no impone universalmente una póliza específica de Chile Rugby. |
| Control médico recomendado. | V1.2, p. 5, sección 13. No se convierte en certificado obligatorio ni se piden diagnósticos. |
| CLP 20.000 por jugador; confirmación preliminar el 25 de septiembre. | V1.2, p. 3, sección 5. El portal no cobra ni concilia pagos y no usa ese plazo preliminar pasado para impedir el acceso. |

Correo del delegado, contacto de emergencia y autorización de entrega de datos apoyan la gestión; no se presentan como transcripción literal de una exigencia del PDF. Las bases no exigen expresamente cargar copia de identidad, comprobante de pago, historia clínica ni inscripción federativa. Los tipos de archivo permiten aportarlos cuando proceda.

### Impresión para firmas

La impresión usa datos guardados: club, ciudad, país, delegado, mánager y teléfono, capitán y primeros auxilios; identidad, nacimiento, edad al torneo y durante 2026, cobertura declarada y firma por jugador. Añade declaración y firma del mánager, lugar/fecha y recepción de mesa con nombre/firma y fecha/hora. Un asterisco identifica a quienes no cumplen 40 durante 2026 para revisión.

El jugador declara lectura de bases, veracidad de identidad y conocimiento de riesgos propios del rugby. El mánager declara verificación de datos y comunicación de bases/riesgos, y se compromete a respetar el criterio de edad ratificado y comunicado por organización. No se añade renuncia de derechos ni exención general de responsabilidad. La impresión prepara un documento para firmar y adjuntar; no certifica automáticamente los antecedentes.

### Diferencia pendiente sobre edades

V1.2, p. 2, sección 4, permite hasta tres jugadores menores de 35 años. La Adenda V1.3 y la app describen hasta tres de 35 a 39 años. La adenda sigue como borrador: la organización debe ratificar y comunicar el criterio antes de aplicarlo a todas las delegaciones.

V1.2 considera +40 a quienes cumplen 40 durante el año calendario 2026. Se muestran años cumplidos al 24/10/2026 y edad que se cumple durante 2026; las alertas usan la segunda. El panel enlaza ambas fuentes y explica la diferencia. No se rechaza automáticamente por edad ni se modifican las reglas actuales de la app. Estas reglas Classic no se extienden al festival infantil.

### Chile Rugby y seguro

- [Registro BD Chile Rugby](https://bd.chile.rugby/registro): registro y acceso al flujo de seguro indicado por la guía oficial.
- [Ingreso de usuarios existentes](https://bd.chile.rugby/users/login).
- [Información oficial BD Chile Rugby](https://chile.rugby/bd-chile-rugby/).

Abrir un enlace no modifica el estado federativo ni declara una póliza vigente. El registro en el portal, la inscripción federativa y la contratación/pago del seguro son trámites distintos. Se admite identificación extranjera y estado federativo `not_applicable` para visitantes. No se prometen precios, coberturas ni verificaciones automáticas ajenas al portal.

## 11. Helper compartido

`window.FufyPortal` expone un objeto congelado:

```text
request(action, payload = {}, auth = { token?, jwt? })
upload(formData, auth = { token? })
esc(value)
downloadCSV(filename, rows)
formatDate(value)
statusLabel(value)
ageOnEvent(date)
constants: { eventDate, basesUrl, rugbyRegister, rugbyLogin, rugbyInfo }
```

`request` y `upload` devuelven JSON directo o lanzan `Error` con `message` y, si hubo respuesta HTTP de error, `status`. Usan `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` y cancelación por tiempo de espera. `formatDate` presenta fechas en español de Chile y zona `America/Santiago`; `ageOnEvent` calcula al 24/10/2026. Los valores CAS nunca pasan por esos formateadores. No se utiliza un framework de frontend.
