const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
let tasks=[],members=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
(async()=>{
 const {data:{session}}=await sb.auth.getSession();if(!session){location.href='login.html?next=activacion-ds22.html';return}
 const {data:p}=await sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle();
 if(!p?.active||!['superadmin','board'].includes(p.role)){document.body.innerHTML='<main class="main wrap"><div class="card">Acceso sólo para Directiva / Superadmin.</div></main>';return}
 const [t,m]=await Promise.all([
   sb.from('tasks').select('code,title,status,progress,notes').or('code.like.DS22-%,code.like.DISC-%').order('code'),
   sb.from('discipline_commission_members').select('*').order('position')
 ]);
 tasks=t.data||[];members=m.data||[];render()
})();
function task(code){return tasks.find(x=>x.code===code)}
function ok(code){return task(code)?.status==='done'}
function stateRow(label,good,detail){return '<div style="margin:8px 0"><span class="badge '+(good?'ok':'bad')+'">'+(good?'LISTO':'PENDIENTE')+'</span> <b>'+esc(label)+'</b><div class="meta">'+esc(detail||'')+'</div></div>'}
function render(){
 const riReady=['DS22-05','DS22-06','DS22-07','DS22-08','DS22-10','DS22-12'].every(ok);
 const discReady=['DISC-01','DISC-02'].every(ok)&&members.filter(x=>x.status==='active').length===3;
 status.innerHTML='<b>'+(riReady&&discReady?'Listo para preparar activación final.':'Todavía no corresponde enviar accesos.')+'</b><br>'+(riReady&&discReady?'Verifica usuarios, correos y permisos exclusivos antes del envío.':'Esta pantalla ya deja los correos preparados, pero no debe enviarlos hasta que desaparezcan los pendientes.');
 riState.innerHTML=
  stateRow('Acta/respaldo ratificación',ok('DS22-10'),task('DS22-10')?.notes)+
  stateRow('Antecedentes habilitantes',ok('DS22-05'),task('DS22-05')?.notes)+
  stateRow('Registro / presentación IND',ok('DS22-06'),task('DS22-06')?.notes)+
  stateRow('Publicación de nombres/contactos',ok('DS22-07'),task('DS22-07')?.notes)+
  stateRow('Difusión del protocolo',ok('DS22-08'),task('DS22-08')?.notes)+
  stateRow('Reglamento Interno V1.1',ok('DS22-12'),task('DS22-12')?.notes);
 discState.innerHTML=
  stateRow('Tres integrantes acreditados',ok('DISC-01')&&members.filter(x=>x.status==='active').length===3,task('DISC-01')?.notes)+
  stateRow('Reglamento especial aprobado',ok('DISC-02'),task('DISC-02')?.notes);
 riMail.value='Asunto: Acceso a Protección / DS22 · Gigantes de Azapa\n\nHola [NOMBRE],\n\nTu cuenta ha sido habilitada para trabajar como Responsable Institucional de Protección / DS22 en la aplicación de Gigantes de Azapa.\n\nTu acceso es exclusivo al módulo Protección / DS22 y al Asistente de Casos. No tendrás acceso a Tesorería, Registro Maestro, viajes ni otros módulos administrativos.\n\nPrimer ingreso:\n1. Ingresa a https://gigantesdeazapa.cl/gestion/login.html\n2. Activa o recupera tu clave con el correo autorizado.\n3. Entra a Protección / DS22.\n4. Revisa la guía “Qué hacer cuando llega una denuncia” y el Asistente de Casos.\n5. Para expedientes confidenciales se solicitará volver a validar tu contraseña.\n\nDentro de cada caso tendrás plazos, personas involucradas, medidas de protección, documentos automáticos, derivaciones, comprobantes y bitácora.\n\nImportante: utiliza únicamente la aplicación y los canales institucionales para antecedentes sensibles.\n\nGigantes de Azapa';
 discMail.value='Asunto: Acceso Comisión de Disciplina · Gigantes de Azapa\n\nHola [NOMBRE],\n\nTu cuenta ha sido habilitada como integrante de la Comisión de Disciplina de Gigantes de Azapa.\n\nTu acceso es exclusivo al módulo Comisión de Disciplina y al Asistente de Casos.\n\nPrimer ingreso:\n1. Ingresa a https://gigantesdeazapa.cl/gestion/login.html\n2. Activa o recupera tu clave con el correo autorizado.\n3. Entra a Comisión de Disciplina.\n4. Revisa la guía de trabajo y los documentos institucionales.\n\nLa aplicación permite recibir derivaciones DS22, revisar impedimentos, citar, registrar descargos, resolver medidas protectoras, emitir resoluciones, notificar, controlar apelaciones y preparar versiones públicas anonimizadas.\n\nImportante: los expedientes son reservados y sólo deben tratarse dentro de los canales institucionales autorizados.\n\nGigantes de Azapa';
}
async function copyText(id){const el=document.getElementById(id);try{await navigator.clipboard.writeText(el.value);alert('Texto copiado.')}catch(e){el.select();document.execCommand('copy');alert('Texto copiado.')}}
