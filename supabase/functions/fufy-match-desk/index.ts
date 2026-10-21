import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// Shared desk passwords and shift capabilities are authenticated inside this
// endpoint. The service key is runtime-only; no secret or credential is logged.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const readOnly = method === 'GET' || method === 'HEAD';
    let response: Response;
    try { response = await fetch(input, init); }
    catch (error) { if (!readOnly) throw error; return await fetch(input, init); }
    if (readOnly && [502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      return await fetch(input, init);
    }
    return response;
  } },
});

const VERSION = '20261021-1';
const ACTIVE_TEAMS = ['organizer', 'confirmed', 'roster_pending'];
const MATCH_FIELDS = 'id,project_id,match_no,round_no,starts_at,home_team_id,away_team_id,status,home_score,away_score,home_tries,away_tries,home_yellow,away_yellow,home_red,away_red,desk_enabled,desk_phase,updated_at';
const EVENT_FIELDS = 'id,project_id,match_id,team_id,player_id,player_name,jersey_number,kind,points,period,match_minute,created_at,voided_at';
const AUDIT_FIELDS = 'id,match_id,event_id,action,operator_name,reason,created_at';
const KINDS = ['try', 'conversion', 'penalty', 'drop_goal', 'penalty_try', 'yellow_card', 'red_card'];
const COMMANDS = ['start', 'resume', 'finish', 'suspend', 'reopen', 'add_event', 'void_event'];
type Row = Record<string, any>;
class DeskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new DeskError(status, message); }
function str(value: unknown, max: number, label: string, min = 0): string {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') fail(400, `Revisa ${label}.`);
  const text = (value as string).trim();
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) fail(400, `Revisa ${label}.`);
  return text;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(400, 'El registro seleccionado no es válido.');
  return value as string;
}
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Revisa los datos de la solicitud.');
  return value as Row;
}
function checked<T>(result: { data: T; error: any }): T {
  if (result.error) {
    if (/^PT(400|401|403|404|409|423|429)$/.test(result.error.code || '')) fail(Number(result.error.code.slice(2)), result.error.message);
    if (result.error.code === '23505') fail(409, 'La acción ya fue registrada o cambió el partido. Actualiza antes de continuar.');
    console.error('fufy-desk database operation failed', { code: result.error.code || 'unknown' });
    fail(503, 'No se pudo confirmar la operación. Actualiza la mesa y revisa el historial antes de volver a registrar.');
  }
  return result.data;
}
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, '0')).join('');
function newPassword() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(10))).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `FUFY-${hex.match(/.{4}/g)!.join('-')}`;
}
function tokenHash(req: Request): Promise<string> {
  const token = req.headers.get('x-fufy-desk-token') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Ingresa con la clave de la mesa para abrir tu turno.');
  return hash(token);
}
function cors(origin: string | null): Record<string, string> {
  const allowed = !origin || ['https://gigantesdeazapa.cl', 'https://www.gigantesdeazapa.cl', 'https://gigantesazapasalta2026-sudo.github.io'].includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) fail(403, 'Origen de solicitud no autorizado.');
  return {
    'Access-Control-Allow-Origin': origin || 'https://gigantesdeazapa.cl',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-fufy-desk-token,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Expose-Headers': 'X-Fufy-Desk-Version',
    'Vary': 'Origin', 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache',
    'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    'X-Fufy-Desk-Version': VERSION,
  };
}
async function readBody(req: Request): Promise<Row> {
  const max = 16 * 1024;
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'Envía la solicitud en formato JSON.');
  if (Number(req.headers.get('content-length') || 0) > max) fail(413, 'El formulario es demasiado grande.');
  if (!req.body) fail(400, 'No se recibió el formulario.');
  const reader = req.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); fail(413, 'El formulario es demasiado grande.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail(400, 'El formulario no tiene un formato válido.'); }
  return object(parsed);
}
async function project(): Promise<Row> {
  const p = checked(await db.from('projects').select('id,name,event_date').eq('code', 'FUFY2026').maybeSingle());
  if (!p) fail(503, 'La Copa no está disponible en este momento.');
  return p;
}
async function adminAuth(req: Request, projectId: string): Promise<string> {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) fail(401, 'Ingresa al Control Center con tu cuenta autorizada.');
  const { data, error } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (error || !data.user) fail(401, 'Tu sesión venció. Vuelve a ingresar al Control Center.');
  const uid = data.user.id;
  const profile = checked(await db.from('profiles').select('role,active').eq('user_id', uid).maybeSingle());
  if (!profile?.active) fail(403, 'Tu cuenta no está autorizada para administrar la mesa.');
  if (['superadmin', 'board'].includes(profile.role)) return uid;
  const access = checked(await db.from('project_user_access').select('access_role').eq('user_id', uid).eq('project_id', projectId).maybeSingle());
  if (!access || !['editor', 'manager'].includes(access.access_role)) fail(403, 'Se requiere permiso de edición o dirección de Copa FUFY.');
  return uid;
}
async function deskSession(credentialHash: string, projectId: string): Promise<Row> {
  const session = checked(await db.rpc('fufy_desk_session', { p_token_hash: credentialHash }));
  if (!session || session.project_id !== projectId) fail(401, 'El turno venció o fue cerrado. Ingresa nuevamente con la clave vigente.');
  return session;
}
async function eventsFor(projectId: string): Promise<Row[]> {
  const all: Row[] = [];
  for (let start = 0; start < 10000; start += 1000) {
    const rows = checked(await db.from('fufy_match_events').select(EVENT_FIELDS).eq('project_id', projectId).order('created_at').order('id').range(start, start + 999)) || [];
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
  fail(503, 'El historial requiere una revisión de la organización antes de continuar.');
}
async function snapshot(p: Row, session: Row): Promise<Row> {
  const teams = checked(await db.from('project_teams').select('id,name').eq('project_id', p.id).eq('active', true).in('status', ACTIVE_TEAMS).order('sort_order')) || [];
  const [matchResult, playerResult, events, auditResult] = await Promise.all([
    db.from('fufy_matches').select(MATCH_FIELDS).eq('project_id', p.id).order('match_no'),
    teams.length ? db.from('fufy_club_players').select('id,team_id,full_name,jersey_number,review_status').in('team_id', teams.map(t => t.id)).is('removed_at', null).order('full_name') : Promise.resolve({ data: [], error: null }),
    eventsFor(p.id),
    db.from('fufy_desk_audit').select(AUDIT_FIELDS).eq('project_id', p.id).order('created_at', { ascending: false }).limit(100),
  ]);
  return {
    project: p,
    session: { id: session.id, operator_name: session.operator_name, started_at: session.started_at, expires_at: session.expires_at },
    teams, matches: checked(matchResult) || [], players: checked(playerResult) || [], events,
    audit: checked(auditResult) || [], server_time: new Date().toISOString(),
  };
}
async function adminInfo(p: Row): Promise<Row> {
  const [accessResult, sessionsResult, auditResult] = await Promise.all([
    db.from('fufy_desk_access').select('active,expires_at,updated_at').eq('project_id', p.id).maybeSingle(),
    db.from('fufy_desk_sessions').select('id,operator_name,started_at,expires_at,ended_at').eq('project_id', p.id).order('started_at', { ascending: false }).limit(50),
    db.from('fufy_desk_audit').select(AUDIT_FIELDS).eq('project_id', p.id).order('created_at', { ascending: false }).limit(200),
  ]);
  const access = checked(accessResult);
  return { project: p, access: { configured: !!access, active: !!access?.active, expires_at: access?.expires_at || null, updated_at: access?.updated_at || null }, sessions: checked(sessionsResult) || [], audit: checked(auditResult) || [] };
}
function commandData(body: Row): { command: string; requestId: string; matchId: string; expected: string; payload: Row } {
  const command = str(body.command, 30, 'la acción', 1);
  if (!COMMANDS.includes(command)) fail(400, 'La acción de mesa no es válida.');
  const requestId = uuid(body.request_id), matchId = uuid(body.match_id);
  const expected = str(body.expected_updated_at, 64, 'la versión del partido', 10);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(expected) || Number.isNaN(new Date(expected).getTime())) fail(400, 'Actualiza el partido antes de registrar la acción.');
  const payload: Row = {};
  if (['suspend', 'reopen', 'void_event'].includes(command)) payload.reason = str(body.reason, 1200, 'el motivo', command === 'reopen' ? 10 : 5);
  if (command === 'void_event') payload.event_id = uuid(body.event_id);
  if (command === 'add_event') {
    const input = object(body.event), kind = str(input.kind, 24, 'el tipo de evento', 1);
    if (!KINDS.includes(kind)) fail(400, 'El tipo de anotación no es válido.');
    if (input.period !== undefined && input.period !== 1) fail(400, 'Classic se juega en un tiempo corrido, sin entretiempo.');
    const minute = input.match_minute === '' || input.match_minute === null || input.match_minute === undefined ? null : input.match_minute;
    if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute > 120)) fail(400, 'Revisa el minuto del partido.');
    payload.event = { team_id: uuid(input.team_id), player_id: kind === 'penalty_try' ? null : uuid(input.player_id), kind, period: 1, match_minute: minute };
    if (kind === 'penalty_try' && input.player_id) fail(400, 'El try penal se atribuye al equipo, sin goleador individual.');
  }
  return { command, requestId, matchId, expected, payload };
}

Deno.serve(async (req: Request) => {
  let headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  try {
    headers = cors(req.headers.get('origin'));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') fail(405, 'Usa el formulario de la mesa de control.');
    const body = await readBody(req), action = str(body.action, 30, 'la acción', 1);
    const p = await project();
    let result: Row;
    if (action === 'login') {
      const password = str(body.password, 72, 'la clave', 1), operator = str(body.operator_name, 80, 'tu nombre', 3);
      const sessionToken = randomToken(), credentialHash = await hash(sessionToken);
      const rawIp = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').at(-1) || 'unknown').trim().slice(0, 120);
      const login = checked(await db.rpc('fufy_desk_login', { p_project_id: p.id, p_password: password, p_operator_name: operator, p_token_hash: credentialHash, p_ip_hash: await hash(`fufy-desk:${p.id}:${rawIp}`) }));
      if (!login?.ok) fail(login?.status === 429 ? 429 : 401, login?.status === 429 ? 'Demasiados intentos. Espera 15 minutos antes de volver a ingresar.' : 'La clave no es válida o el acceso venció. Solicita la clave vigente a la organización.');
      const session = await deskSession(credentialHash, p.id);
      result = { ...await snapshot(p, session), session_token: sessionToken };
    } else if (action === 'admin_info' || action === 'admin_rotate') {
      const uid = await adminAuth(req, p.id);
      if (action === 'admin_rotate') {
        const password = newPassword();
        checked(await db.rpc('fufy_desk_rotate_access', { p_project_id: p.id, p_actor_id: uid, p_password: password }));
        result = { ...await adminInfo(p), password };
      } else result = await adminInfo(p);
    } else if (action === 'logout') {
      result = checked(await db.rpc('fufy_desk_logout', { p_token_hash: await tokenHash(req) }));
    } else if (action === 'snapshot' || action === 'command') {
      const credentialHash = await tokenHash(req);
      let session = await deskSession(credentialHash, p.id);
      if (action === 'command') {
        const command = commandData(body);
        checked(await db.rpc('fufy_desk_command', { p_token_hash: credentialHash, p_request_id: command.requestId, p_match_id: command.matchId, p_expected_updated_at: command.expected, p_command: command.command, p_payload: command.payload }));
        session = await deskSession(credentialHash, p.id);
      }
      result = await snapshot(p, session);
    } else fail(400, 'La acción solicitada no está disponible.');
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    const known = error instanceof DeskError;
    if (!known) console.error('fufy-desk request failed', { type: error instanceof Error ? error.name : 'unknown' });
    return new Response(JSON.stringify({ error: known ? error.message : 'No se pudo confirmar la operación. Revisa la conexión y el historial antes de repetirla.' }), { status: known ? error.status : 503, headers });
  }
});
