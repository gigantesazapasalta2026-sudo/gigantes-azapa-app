import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// This endpoint authenticates scoped club/admin capabilities or organizational JWTs.
// The service key is read only at runtime and is never returned or logged.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const method=(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const readOnly=method==='GET'||method==='HEAD';
    let response:Response;
    try { response=await fetch(input,init); }
    catch(error) { if(!readOnly)throw error; return await fetch(input,init); }
    if(readOnly&&[502,503,504].includes(response.status)){
      await response.body?.cancel();
      return await fetch(input,init);
    }
    return response;
  } },
});
const BUCKET = 'fufy-clubs-private';
const EVENT_DATE = '2026-10-24';
const ACTIVE_TEAMS = ['organizer', 'confirmed', 'roster_pending'];
const DOC_FIELDS = 'id,team_id,player_id,kind,file_name,mime_type,size_bytes,is_current,created_at,removed_at';
const PLAYER_FIELDS = 'id,team_id,full_name,document_type,document_number,birth_date,nationality,jersey_number,emergency_contact,emergency_phone,federation_status,coverage_type,insurance_provider,insurance_valid_until,signature_declared,notes,review_status,review_note,reviewed_at,removed_at,created_at,updated_at';
const DOC_KINDS = ['signed_roster','manager_declaration','player_declaration','insurance','federation','identity','other'];
const MAX_FILE = 5 * 1024 * 1024;
const VERSION = '20261021-6';
class PortalError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = Record<string, any>;

function fail(status: number, message: string): never { throw new PortalError(status, message); }
function str(value: unknown, max: number, label: string, min = 0): string {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') fail(400, `Revisa ${label}.`);
  const text = (value as string).trim();
  if (text.length < min || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail(400, `Revisa ${label}.`);
  return text;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(400, 'El registro seleccionado no es válido.');
  return value as string;
}
function choice(value: unknown, values: string[], label: string): string {
  if (!values.includes(value as string)) fail(400, `Revisa ${label}.`);
  return value as string;
}
function date(value: unknown, label: string, required = false): string | null {
  if (!value && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `Revisa ${label}.`);
  const parsed = new Date((value as string) + 'T12:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) fail(400, `Revisa ${label}.`);
  return value as string;
}
function checked<T>(result: { data: T; error: any }): T {
  if (result.error) {
    if (/^PT(400|401|403|409|423)$/.test(result.error.code || '')) fail(Number(result.error.code.slice(2)),result.error.message);
    if (result.error.code === '23505') fail(409, 'Ese documento de identidad ya está en la nómina del club.');
    if (result.error.code === '23514' && /nómina cambió/.test(result.error.message || '')) fail(409, result.error.message);
    if (result.error.code === '23514' && /nómina|jugador|club/.test(result.error.message || '')) fail(400, result.error.message);
    // Do not return SQL details, paths, tokens, or third-party error payloads.
    console.error('fufy-portal database operation failed', { code: result.error.code || 'unknown' });
    fail(500, 'No se pudo guardar o consultar la información. Recarga y vuelve a intentar.');
  }
  return result.data;
}
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function accessKey(value: string, kind: 'club' | 'admin'): string | null {
  if(value.length>160)return null;
  if(kind==='club'&&/^[a-f0-9]{64}$/i.test(value.trim()))return value.trim().toLowerCase();
  const compact=value.replace(/[\s-]/g,'').toUpperCase();
  const prefix=kind==='club'?'FUFY':'ADMIN',length=kind==='club'?16:20;
  if(!compact.startsWith(prefix))return null;
  const secret=compact.slice(prefix.length);
  if(secret.length!==length||!new RegExp('^['+KEY_ALPHABET+']+$').test(secret))return null;
  return prefix+'-'+secret.match(/.{4}/g)!.join('-');
}
function randomClubKey(): string {
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>KEY_ALPHABET[x&31]).join('');
  return 'FUFY-'+secret.match(/.{4}/g)!.join('-');
}
const now = () => new Date().toISOString();
function versionMatches(expected: unknown, actual: string) {
  if (typeof expected !== 'string' || expected !== actual) fail(409, 'La nómina cambió en otra sesión. Recarga y revisa la versión actual antes de guardar.');
}
function cors(origin: string | null): Record<string,string> {
  const allowed = !origin || ['https://gigantesdeazapa.cl','https://www.gigantesdeazapa.cl','https://gigantesazapasalta2026-sudo.github.io'].includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) fail(403,'Origen de solicitud no autorizado.');
  return {
    'Access-Control-Allow-Origin': origin || 'https://gigantesdeazapa.cl',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-fufy-token,x-fufy-admin-key,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Vary':'Origin','Cache-Control':'no-store, max-age=0','Pragma':'no-cache',
    'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',
    'X-Fufy-Portal-Version': VERSION,
  };
}
async function readBody(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length') || 0) > max) fail(413,'El archivo o formulario es demasiado grande.');
  if (!req.body) fail(400,'No se recibió el formulario.');
  const reader=req.body!.getReader(), parts: Uint8Array[]=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value!.byteLength;
      if(size>max){await reader.cancel();fail(413,'El archivo o formulario es demasiado grande.');}
      parts.push(value!);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return bytes;
}
async function project(): Promise<Row> {
  const item=checked(await db.from('projects').select('id,name,event_date').eq('code','FUFY2026').single());
  if(!item)fail(503,'La Copa no está disponible en este momento.');
  const rosterState=checked(await db.rpc('fufy_close_started_rosters',{p_project_id:item.id}));
  return {...item,roster_state:rosterState};
}
async function team(teamId: string, projectId: string): Promise<Row> {
  const item=checked(await db.from('project_teams').select('id,name,city,country,status,project_id,active').eq('id',teamId).eq('project_id',projectId).eq('active',true).in('status',ACTIVE_TEAMS).maybeSingle());
  if(!item)fail(403,'Este acceso no está habilitado. Contacta a la organización.');
  return item;
}
async function clubAuth(req: Request): Promise<string> {
  const token=accessKey(req.headers.get('x-fufy-token') || '','club');
  if(!token)fail(401,'La clave o el enlace no es válido. Revisa el acceso que te entregó la organización.');
  const column=/^[a-f0-9]{64}$/.test(token)?'token_hash':'access_key_hash';
  const invite=checked(await db.from('fufy_club_invites').select('team_id,active,expires_at,revoked_at').eq(column,await hash(token)).maybeSingle());
  if(!invite?.active || invite.revoked_at || (invite.expires_at!==null && new Date(invite.expires_at).getTime()<=Date.now()))fail(401,'La clave o el enlace no está habilitado. Revisa el acceso que te entregó la organización.');
  return invite.team_id;
}
async function adminAuth(req: Request, projectId: string): Promise<string> {
  if(req.headers.has('x-fufy-admin-key')){
    const key=accessKey(req.headers.get('x-fufy-admin-key') || '','admin');
    if(!key)fail(401,'La clave de superadministrador no es válida.');
    const uid=checked(await db.rpc('fufy_club_admin_key_actor',{p_project_id:projectId,p_key_hash:await hash(key)}));
    if(typeof uid!=='string')fail(401,'La clave de superadministrador no está habilitada.');
    return uid;
  }
  const auth=req.headers.get('authorization') || '';
  if(!/^Bearer\s+\S+$/i.test(auth))fail(401,'Ingresa al Control Center con tu cuenta autorizada.');
  const {data,error}=await db.auth.getUser(auth.replace(/^Bearer\s+/i,''));
  if(error || !data.user)fail(401,'Tu sesión venció. Vuelve a ingresar al Control Center.');
  const uid=data.user.id;
  const profile=checked(await db.from('profiles').select('role,active').eq('user_id',uid).maybeSingle());
  if(!profile?.active)fail(403,'Tu cuenta no está autorizada para gestionar las nóminas.');
  if(['superadmin','board'].includes(profile.role))return uid;
  const access=checked(await db.from('project_user_access').select('access_role').eq('user_id',uid).eq('project_id',projectId).maybeSingle());
  if(!access || !['editor','manager'].includes(access.access_role))fail(403,'Se requiere permiso de edición o dirección de Copa FUFY.');
  return uid;
}
function publicTeam(t: Row) { return {id:t.id,name:t.name,city:t.city,country:t.country}; }
async function audit(teamId: string, action: string, uid: string | null, detail: Row = {}) {
  checked(await db.from('fufy_club_audit').insert({team_id:teamId,action,actor_user_id:uid,detail}));
}
async function snapshot(t: Row, p: Row, admin = false): Promise<Row> {
  const dossier=checked(await db.from('fufy_club_submissions').select(`*,fufy_club_players(${PLAYER_FIELDS}),fufy_club_documents(${DOC_FIELDS})`).eq('team_id',t.id).single());
  const players=(dossier.fufy_club_players || []).filter((x:Row)=>!x.removed_at).sort((a:Row,b:Row)=>a.full_name.localeCompare(b.full_name,'es'));
  const documents=(dossier.fufy_club_documents || []).filter((x:Row)=>!x.removed_at).sort((a:Row,b:Row)=>b.created_at.localeCompare(a.created_at));
  delete dossier.fufy_club_players; delete dossier.fufy_club_documents; delete dossier.reviewed_by;
  const effectiveTeam={...t,city:dossier.club_city||t.city,country:dossier.club_country||t.country};
  const firstMatch=p.roster_state?.first_match_at || null;
  const started=!!p.roster_state?.tournament_started || !!(firstMatch&&new Date(firstMatch).getTime()<=Date.now());
  const readOnly=!!dossier.locked_at || started;
  const missing: string[]=[], warnings: string[]=[];
  if(!effectiveTeam.city)missing.push('Ciudad del club.');
  if(!effectiveTeam.country)missing.push('País del club.');
  const required:{[key:string]:string}={delegate_name:'Nombre del delegado',delegate_email:'Correo del delegado',delegate_phone:'Teléfono del delegado',manager_name:'Nombre del mánager',manager_phone:'Teléfono del mánager',captain_name:'Capitán',first_aid_name:'Responsable de primeros auxilios'};
  for(const [key,label] of Object.entries(required))if(!dossier[key])missing.push(label+'.');
  if(!dossier.accepted_bases)missing.push('Aceptar la lectura de las bases.');
  if(!dossier.confirmed_accuracy)missing.push('Confirmar la veracidad de los datos.');
  if(!dossier.privacy_consent)missing.push('Confirmar la autorización para entregar estos antecedentes a la organización.');
  if(!players.length)missing.push('Agregar los jugadores de la nómina.');
  const observedPlayers=players.filter((j:Row)=>j.review_status==='observed');
  if(observedPlayers.length)missing.push(`${observedPlayers.length} jugador(es) tienen observaciones de la organización pendientes de resolver.`);
  const current=documents.filter((d:Row)=>d.is_current);
  const signed=current.some((d:Row)=>d.kind==='signed_roster' && !d.player_id);
  if(!signed){
    if(!current.some((d:Row)=>d.kind==='manager_declaration'))missing.push('Adjuntar la nómina consolidada firmada o la declaración firmada del mánager.');
    const unsigned=players.filter((j:Row)=>!current.some((d:Row)=>d.kind==='player_declaration'&&d.player_id===j.id));
    if(unsigned.length)missing.push(`${unsigned.length} jugador(es) sin respaldo actual de firma y conocimiento de riesgos; pueden incluirse en la nómina consolidada firmada.`);
  }
  const noCoverage=players.filter((j:Row)=>j.coverage_type==='pending');
  if(noCoverage.length)missing.push(`${noCoverage.length} jugador(es) deben declarar previsión, seguro u otros medios de atención médica.`);
  const youth=players.filter((j:Row)=>2026-Number(j.birth_date.slice(0,4))<40);
  if(youth.length)warnings.push(`${youth.length} jugador(es) no cumplen 40 años durante 2026. El Comité debe resolver la excepción de edad según las bases y su adenda ratificada.`);
  if(players.length>0&&players.length<15)warnings.push('Hay menos de 15 jugadores en la nómina. La organización debe revisar la disponibilidad para rugby XV.');
  const noInsuranceProof=players.filter((j:Row)=>j.coverage_type==='insurance'&&!current.some((d:Row)=>d.kind==='insurance'&&(!d.player_id||d.player_id===j.id)));
  if(noInsuranceProof.length)warnings.push(`${noInsuranceProof.length} seguro(s) declarado(s) sin certificado adjunto. No se ha verificado su vigencia.`);
  if(players.some((j:Row)=>j.coverage_type==='insurance'&&j.insurance_valid_until&&j.insurance_valid_until<EVENT_DATE))warnings.push('Hay un seguro declarado con vencimiento anterior al torneo. Revisar cobertura para el 24 de octubre.');
  if(players.some((j:Row)=>j.federation_status==='pending'))warnings.push('Hay trámites de Chile Rugby pendientes; el portal no verifica automáticamente el registro federativo.');
  if(admin && players.length){
    const others=checked(await db.from('fufy_club_players').select('document_type,document_number,nationality,team_id').neq('team_id',t.id).is('removed_at',null)) || [];
    const identity=(j:Row)=>[j.document_type,(j.document_number||'').replace(/[^a-z0-9]/gi,'').toUpperCase(),j.document_type==='RUT'?'CL':(j.nationality||'').trim().toLowerCase()].join('|');
    const keys=new Set(others.map(identity));
    if(players.some((j:Row)=>keys.has(identity(j))))missing.push('Hay una identificación repetida en la nómina de otro club. Resolver el registro antes de revisar el expediente como completo.');
  }
  if(dossier.status==='approved' && missing.length)warnings.push('El expediente requiere una nueva revisión porque tiene pendientes.');
  const changes=admin?(checked(await db.from('fufy_club_roster_changes').select('id,action,player_id,player_name,is_exception,reason,organization_authorizer,approval_reference,club_approvals,created_at').eq('team_id',t.id).order('created_at',{ascending:false}).limit(50))||[]):undefined;
  return {team:publicTeam(effectiveTeam),submission:dossier,players,documents,checks:{missing,warnings,complete:missing.length===0},event:{name:p.name,date:p.event_date},access:{read_only:readOnly,exception_required:readOnly,first_match_at:firstMatch,tournament_started:started,reason:readOnly?(started?'Las nóminas se cerraron al comenzar el primer partido del campeonato. Las excepciones se registran únicamente desde Control Center, con acuerdo de la organización y autorización de todos los clubes.':'La organización cerró esta nómina. Una excepción se registra únicamente desde Control Center, con autorización de la organización y todos los clubes.'):''},...(admin?{roster_changes:changes}:{})};
}
function editable(s: Row) { if(s.access.read_only)fail(423,'La nómina está cerrada. Solicita una corrección al Comité Organizador.'); }
function submissionData(value: unknown): Row {
  if(!value || typeof value!=='object' || Array.isArray(value))fail(400,'Revisa los datos de la delegación.');
  const v=value as Row, out:Row={};
  out.club_city=str(v.club_city,120,'la ciudad del club');
  out.club_country=str(v.club_country,80,'el país del club');
  for(const key of ['delegate_name','manager_name','captain_name','first_aid_name'])out[key]=str(v[key],160,key);
  for(const key of ['delegate_phone','manager_phone','first_aid_phone'])out[key]=str(v[key],50,key);
  out.delegate_email=str(v.delegate_email,254,'el correo del delegado').toLowerCase();
  if(out.delegate_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.delegate_email))fail(400,'Revisa el correo del delegado.');
  out.club_notes=str(v.club_notes,2500,'las observaciones');
  for(const key of ['accepted_bases','confirmed_accuracy','privacy_consent'])out[key]=v[key]===true;
  return out;
}
function playerData(value: unknown, t: Row): Row {
  if(!value || typeof value!=='object' || Array.isArray(value))fail(400,'Revisa la ficha del jugador.');
  const v=value as Row;
  const birth=date(v.birth_date,'la fecha de nacimiento',true)!;
  if(birth<'1900-01-01'||birth>EVENT_DATE)fail(400,'Revisa la fecha de nacimiento.');
  const number=str(v.document_number,40,'el documento de identidad',3);
  if(number.replace(/[^a-z0-9]/gi,'').length<3)fail(400,'Revisa el documento de identidad.');
  let jersey=null;
  if(v.jersey_number!==undefined&&v.jersey_number!==null&&v.jersey_number!==''){
    jersey=Number(v.jersey_number);
    if(!Number.isInteger(jersey)||jersey<0||jersey>999)fail(400,'Revisa el número de camiseta.');
  }
  return {full_name:str(v.full_name,160,'el nombre completo',3),document_type:choice(v.document_type,['RUT','DNI','Pasaporte','Otro'],'el tipo de documento'),document_number:number,birth_date:birth,nationality:str(v.nationality||t.country,80,'el país'),jersey_number:jersey,
    emergency_contact:str(v.emergency_contact,160,'el contacto de emergencia'),emergency_phone:str(v.emergency_phone,50,'el teléfono de emergencia'),federation_status:choice(v.federation_status||'pending',['pending','declared','not_applicable'],'el estado de Chile Rugby'),coverage_type:choice(v.coverage_type||'pending',['pending','insurance','prevision','other'],'los medios de atención médica'),insurance_provider:str(v.insurance_provider,160,'el seguro o previsión'),insurance_valid_until:date(v.insurance_valid_until,'la vigencia del seguro'),signature_declared:v.signature_declared===true,notes:str(v.notes,1500,'las observaciones del jugador'),review_status:'pending',review_note:'',reviewed_at:null,reviewed_by:null};
}
async function download(t: Row, documentId: string): Promise<Row> {
  const document=checked(await db.from('fufy_club_documents').select('id,storage_path').eq('id',documentId).eq('team_id',t.id).is('removed_at',null).maybeSingle());
  if(!document)fail(404,'El documento no está disponible.');
  const signed=checked(await db.storage.from(BUCKET).createSignedUrl(document.storage_path,120));
  if(!signed?.signedUrl)fail(500,'No se pudo abrir el documento. Vuelve a intentar.');
  return {url:signed.signedUrl,expires_in:120};
}

Deno.serve(async(req: Request)=>{
  let headers:Record<string,string>={};
  try{
    headers=cors(req.headers.get('origin'));
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')fail(405,'Usa el formulario del portal.');
    const p=await project();
    // Verify credentials BEFORE reading a potentially large file body.
    const hasClub=req.headers.has('x-fufy-token'),hasAdminKey=req.headers.has('x-fufy-admin-key'),hasJwt=req.headers.has('authorization');
    if(Number(hasClub)+Number(hasAdminKey)+Number(hasJwt)>1)fail(400,'Usa un solo tipo de acceso.');
    const hasAdmin=hasAdminKey||hasJwt;
    const clubId=hasClub?await clubAuth(req):null;
    const uid=hasAdmin?await adminAuth(req,p.id):null;
    const contentType=req.headers.get('content-type') || '';
    const multipart=contentType.startsWith('multipart/form-data');
    if(multipart&&!clubId)fail(401,'Abre primero el enlace privado de tu club.');
    const bytes=await readBody(req,multipart?MAX_FILE+65536:65536);
    let body:Row,form:FormData|null=null;
    if(multipart){form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':contentType}}).formData();body={action:form.get('action')};}
    else{
      if(!contentType.startsWith('application/json'))fail(400,'Formato de solicitud no válido.');
      try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'No se pudo leer el formulario.');}
      if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Formato de solicitud no válido.');
    }
    const action=str(body.action,40,'la acción',1);
    let result:Row;
    if(action==='public_info'){
      const teams=checked(await db.from('project_teams').select('id,name,city,country').eq('project_id',p.id).eq('active',true).in('status',ACTIVE_TEAMS).order('sort_order'));
      result={event:{name:p.name,date:p.event_date},teams};
    }else if(action.startsWith('admin_')){
      if(!uid)fail(401,'Ingresa al Control Center con tu clave de superadministrador o tu cuenta autorizada.');
      if(action==='admin_lock_all'){
        const closed=checked(await db.rpc('fufy_admin_close_rosters',{p_project_id:p.id,p_actor_id:uid}));
        result={ok:true,closed_count:closed};
      }else if(action==='admin_list'){
        const teams=checked(await db.from('project_teams').select('id,name,city,country,status').eq('project_id',p.id).eq('active',true).in('status',ACTIVE_TEAMS).order('sort_order')) || [];
        const ids=teams.map((t:Row)=>t.id);
        const [subResult,playerResult,docResult,inviteResult]=await Promise.all([
          db.from('fufy_club_submissions').select('team_id,status,updated_at,submitted_at,reviewed_at,review_note,locked_at,unlock_until').in('team_id',ids),
          db.from('fufy_club_players').select('team_id').in('team_id',ids).is('removed_at',null),
          db.from('fufy_club_documents').select('team_id').in('team_id',ids).is('removed_at',null),
          db.from('fufy_club_invites').select('team_id,active,expires_at,created_at').in('team_id',ids)
        ]);
        const subs=checked(subResult)||[],players=checked(playerResult)||[],docs=checked(docResult)||[],invites=checked(inviteResult)||[];
        result={teams:teams.map((t:Row)=>({...t,submission:subs.find((s:Row)=>s.team_id===t.id)||null,player_count:players.filter((j:Row)=>j.team_id===t.id).length,document_count:docs.filter((d:Row)=>d.team_id===t.id).length,invitation:invites.find((i:Row)=>i.team_id===t.id)||null})),can_manage:true,admin_access:{mode:hasAdminKey?'key':'account',label:hasAdminKey?'Superadministrador · Copa FUFY':'Organización · Copa FUFY'},event:{name:p.name,date:p.event_date,first_match_at:p.roster_state?.first_match_at||null}};
      }else{
        const t=await team(uuid(body.team_id),p.id);
        if(action==='admin_invite'){
          const token=randomToken(),key=randomClubKey(),created=now();
          checked(await db.from('fufy_club_invites').upsert({team_id:t.id,token_hash:await hash(token),access_key_hash:await hash(key),active:true,created_at:created,expires_at:null,created_by:uid,revoked_at:null},{onConflict:'team_id'}));
          await audit(t.id,'invite_rotated',uid);
          result={url:'https://gigantesdeazapa.cl/fufy-clubes.html#acceso='+token,token,access_key:key,expires_at:null,team_name:t.name};
        }else if(action==='admin_revoke'){
          checked(await db.from('fufy_club_invites').update({active:false,revoked_at:now()}).eq('team_id',t.id));
          await audit(t.id,'invite_revoked',uid);result={ok:true};
        }else if(action==='admin_document')result=await download(t,uuid(body.document_id));
        else{
          const s=await snapshot(t,p,true);
          if(action==='admin_open')result=s;
          else if(action==='admin_save_player'||action==='admin_delete_player'){
            const removing=action==='admin_delete_player';
            const player=removing?{id:uuid(body.player_id)}:{...playerData(body.player,t),...(body.player?.id?{id:uuid(body.player.id)}:{})};
            const existing=player.id?s.players.find((j:Row)=>j.id===player.id):null;
            if(player.id&&!existing)fail(404,'El jugador no está disponible en la nómina de este club.');
            if(existing)versionMatches(body.expected_updated_at,existing.updated_at);
            checked(await db.rpc('fufy_admin_roster_change',{
              p_team_id:t.id,p_actor_id:uid,p_action:removing?'delete':'save',p_player:player,
              p_expected_updated_at:existing?existing.updated_at:null,p_exception:body.exception??null
            }));
            result=await snapshot(t,p,true);
          }
          else if(action==='admin_review'){
            versionMatches(body.expected_updated_at,s.submission.updated_at);
            const status=choice(body.status,['observed','approved'],'el estado de revisión');
            const note=str(body.review_note,2500,'la observación');
            if(!['submitted','observed'].includes(s.submission.status))fail(409,'El club debe enviar la versión actual de su nómina antes de revisarla.');
            if(status==='approved'&&s.checks.missing.length)fail(400,'El expediente todavía tiene antecedentes pendientes. Registra observaciones para que el club los complete.');
            if((status==='observed'||s.checks.warnings.length)&&note.length<5)fail(400,'Escribe el resultado de la revisión y las observaciones o decisiones del Comité.');
            const saved=checked(await db.from('fufy_club_submissions').update({status,review_note:note,reviewed_by:uid,reviewed_at:now()}).eq('team_id',t.id).eq('updated_at',s.submission.updated_at).select('team_id').maybeSingle());
            if(!saved)fail(409,'La nómina cambió. Recarga antes de revisarla.');
            await audit(t.id,'dossier_'+status,uid);
            result=await snapshot(t,p,true);
          }else if(action==='admin_review_player'){
            const id=uuid(body.player_id),player=s.players.find((j:Row)=>j.id===id);
            if(!player)fail(404,'El jugador no está disponible.');
            versionMatches(body.expected_updated_at,player.updated_at);
            const status=choice(body.review_status,['pending','observed','reviewed'],'la revisión del jugador');
            const note=str(body.review_note,1500,'la observación');
            if(status==='observed'&&note.length<5)fail(400,'Indica qué debe corregirse.');
            const saved=checked(await db.from('fufy_club_players').update({review_status:status,review_note:note,reviewed_by:uid,reviewed_at:now()}).eq('id',id).eq('team_id',t.id).eq('updated_at',player.updated_at).is('removed_at',null).select('id').maybeSingle());
            if(!saved)fail(409,'La ficha cambió. Recarga antes de revisarla.');
            await audit(t.id,'player_reviewed',uid,{player_id:id,status});result=await snapshot(t,p,true);
          }else if(action==='admin_lock'){
            checked(await db.from('fufy_club_submissions').update({locked_at:now(),unlock_until:null,unlock_reason:null}).eq('team_id',t.id));
            await audit(t.id,'roster_locked',uid);result=await snapshot(t,p,true);
          }else if(action==='admin_unlock'){
            fail(400,'La edición de las delegaciones permanece cerrada. Registra cada incorporación o corrección desde Control Center con la autorización de la organización y todos los clubes.');
          }else fail(400,'La acción no está disponible.');
        }
      }
    }else{
      if(!clubId)fail(401,'Abre el enlace privado de tu club para ingresar la nómina.');
      const t=await team(clubId,p.id);
      // Client-supplied team_id is never used to establish club ownership.
      const s=await snapshot(t,p);
      if(action==='open')result=s;
      else if(action==='get_document')result=await download(t,uuid(body.document_id));
      else{
        editable(s);
        if(action==='save_submission'){
          versionMatches(body.expected_updated_at,s.submission.updated_at);
          const data=submissionData(body.data);
          const saved=checked(await db.from('fufy_club_submissions').update({...data,status:'draft',reviewed_at:null,reviewed_by:null}).eq('team_id',t.id).eq('updated_at',s.submission.updated_at).select('team_id').maybeSingle());
          if(!saved)fail(409,'La nómina cambió. Recarga antes de guardar.');
          await audit(t.id,'delegation_saved',null);
        }else if(action==='save_player'){
          const data=playerData(body.player,t);
          if(body.player?.id){
            const id=uuid(body.player.id),old=s.players.find((j:Row)=>j.id===id);
            if(!old)fail(404,'El jugador no está disponible.');
            versionMatches(body.expected_updated_at,old.updated_at);
            const saved=checked(await db.from('fufy_club_players').update(data).eq('id',id).eq('team_id',t.id).eq('updated_at',old.updated_at).is('removed_at',null).select('id').maybeSingle());
            if(!saved)fail(409,'La ficha cambió. Recarga antes de guardar.');
            await audit(t.id,'player_updated',null,{player_id:id});
          }else{
            if(s.players.length>=25)fail(400,'La nómina admite hasta 25 jugadores.');
            const saved=checked(await db.from('fufy_club_players').insert({...data,team_id:t.id}).select('id').single());
            if(!saved)fail(500,'No se pudo guardar el jugador. Recarga antes de volver a intentar.');
            await audit(t.id,'player_added',null,{player_id:saved.id});
          }
        }else if(action==='delete_player'){
          const id=uuid(body.player_id),old=s.players.find((j:Row)=>j.id===id);
          if(!old)fail(404,'El jugador no está disponible.');
          versionMatches(body.expected_updated_at,old.updated_at);
          const removed=checked(await db.from('fufy_club_players').update({removed_at:now()}).eq('id',id).eq('team_id',t.id).eq('updated_at',old.updated_at).is('removed_at',null).select('id').maybeSingle());
          if(!removed)fail(409,'La ficha cambió. Recarga antes de retirar al jugador.');
          await audit(t.id,'player_removed',null,{player_id:id});
        }else if(action==='submit'){
          versionMatches(body.expected_updated_at,s.submission.updated_at);
          if(!s.players.length||!s.submission.delegate_name||!s.submission.delegate_email||!s.submission.delegate_phone)fail(400,'Agrega jugadores y el nombre, correo y teléfono del delegado antes de enviar.');
          if(!s.submission.privacy_consent)fail(400,'Confirma tu autorización para entregar estos antecedentes a la organización.');
          const saved=checked(await db.from('fufy_club_submissions').update({status:'submitted',submitted_at:now(),reviewed_at:null,reviewed_by:null}).eq('team_id',t.id).eq('updated_at',s.submission.updated_at).select('team_id').maybeSingle());
          if(!saved)fail(409,'La nómina cambió. Recarga antes de enviar.');
          await audit(t.id,'dossier_submitted',null,{pending_count:s.checks.missing.length});
        }else if(action==='upload_document'){
          if(!form)fail(400,'No se recibió el archivo.');
          versionMatches(form!.get('expected_updated_at'),s.submission.updated_at);
          const kind=choice(form!.get('kind'),DOC_KINDS,'el tipo de documento');
          const playerId=form!.get('player_id')?uuid(form!.get('player_id')):null;
          if(playerId&&!s.players.some((j:Row)=>j.id===playerId))fail(404,'El jugador no está disponible.');
          if(kind==='player_declaration'&&!playerId)fail(400,'Selecciona el jugador al que corresponde la declaración.');
          if(['signed_roster','manager_declaration'].includes(kind)&&playerId)fail(400,'La nómina y la declaración del mánager corresponden al equipo completo.');
          if(s.documents.length>=200)fail(400,'Se alcanzó el límite de archivos del equipo. Retira versiones que ya no correspondan.');
          const file=form!.get('file');
          if(!(file instanceof File)||!file.size||file.size>MAX_FILE)fail(400,'Selecciona un PDF, JPG o PNG de hasta 5 MB.');
          const data=new Uint8Array(await file.arrayBuffer());
          const mime=data[0]===0x25&&data[1]===0x50&&data[2]===0x44&&data[3]===0x46&&data[4]===0x2d?'application/pdf':data[0]===0xff&&data[1]===0xd8&&data[2]===0xff?'image/jpeg':data.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':null;
          if(!mime||file.type!==mime)fail(400,'El contenido del archivo no corresponde a un PDF, JPG o PNG válido.');
          const ext=mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg';
          const filename=str(file.name.replace(/[\/\\]/g,'_'),180,'el nombre del archivo',1);
          if(!new RegExp('\\.'+(ext==='jpg'?'jpe?g':ext)+'$','i').test(filename))fail(400,'La extensión del archivo no coincide con su contenido.');
          const path=t.id+'/'+crypto.randomUUID()+'.'+ext;
          checked(await db.storage.from(BUCKET).upload(path,data,{contentType:mime,upsert:false}));
          const inserted=await db.from('fufy_club_documents').insert({team_id:t.id,player_id:playerId,kind,storage_path:path,file_name:filename,mime_type:mime,size_bytes:file.size,source_updated_at:s.submission.updated_at}).select('id').single();
          if(inserted.error){await db.storage.from(BUCKET).remove([path]);checked(inserted);}
          await audit(t.id,'document_uploaded',null,{document_id:inserted.data!.id,kind});
        }else if(action==='delete_document'){
          const id=uuid(body.document_id);
          if(!s.documents.some((d:Row)=>d.id===id))fail(404,'El documento no está disponible.');
          const stored=checked(await db.from('fufy_club_documents').select('storage_path').eq('id',id).eq('team_id',t.id).is('removed_at',null).maybeSingle());
          if(!stored)fail(404,'El documento no está disponible.');
          checked(await db.from('fufy_club_documents').update({removed_at:now(),is_current:false}).eq('id',id).eq('team_id',t.id).is('removed_at',null));
          const cleanup=await db.storage.from(BUCKET).remove([stored.storage_path]);
          if(cleanup.error)console.error('fufy-portal attachment cleanup pending',{code:'storage_remove_failed'});
          await audit(t.id,'document_removed',null,{document_id:id});
        }else fail(400,'La acción no está disponible.');
        result=await snapshot(t,p);
      }
    }
    return new Response(JSON.stringify(result),{headers,status:200});
  }catch(error){
    const known=error instanceof PortalError;
    if(!known)console.error('fufy-portal unexpected failure',{type:(error as Error)?.name || 'unknown'});
    return new Response(JSON.stringify({error:known?error.message:'No se pudo completar la operación. Recarga para comprobar el estado y vuelve a intentar.'}),{status:known?error.status:500,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
  }
});
