const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
const params=new URLSearchParams(location.search),reportId=params.get('id');
let report=null,user=null,partiesRows=[],measureRows=[],eventRows=[],referralRows=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
(async()=>{
 const {data:{session}}=await sb.auth.getSession();if(!session){location.href='login.html?next='+encodeURIComponent('proteccion-caso.html?id='+reportId);return}
 user=session.user;
 const {data:p}=await sb.from('profiles').select('role,active').eq('user_id',user.id).maybeSingle();
 const {data:perm}=await sb.from('user_permissions').select('active').eq('user_id',user.id).eq('permission_code','protection.reports.manage').maybeSingle();
 if(!p?.active||!(p.role==='superadmin'||perm?.active===true)){loading.textContent='Tu cuenta no tiene acceso a este expediente.';return}
 if(!reportId){loading.textContent='No se indicó expediente.';return}
 await refresh();loading.classList.add('hide');app.classList.remove('hide')
})();
async function refresh(){
 const [r,p,m,e,rf]=await Promise.all([
  sb.from('protection_reports').select('*').eq('id',reportId).single(),
  sb.from('protection_report_parties').select('*').eq('report_id',reportId).eq('active',true).order('created_at'),
  sb.from('protection_measures').select('*').eq('report_id',reportId).order('created_at',{ascending:false}),
  sb.from('protection_report_events').select('*').eq('report_id',reportId).order('event_at',{ascending:false}),
  sb.from('protection_discipline_referrals').select('*').eq('report_id',reportId).order('created_at',{ascending:false})
 ]);
 if(r.error){loading.textContent='No se pudo abrir el expediente: '+r.error.message;return}
 report=r.data;partiesRows=p.data||[];measureRows=m.data||[];eventRows=e.data||[];referralRows=rf.data||[];
 if(!report.case_code)await initializeCase();
 render()
}
async function initializeCase(){
 const year=new Date(report.created_at).getFullYear();
 const q=await sb.from('protection_reports').select('case_code').like('case_code','SAFE-'+year+'-%');
 const seq=String((q.data||[]).length+1).padStart(3,'0'),code='SAFE-'+year+'-'+seq;
 const created=new Date(report.created_at),d48=new Date(created.getTime()+48*3600000),d24=new Date(created.getTime()+24*3600000);
 const payload={case_code:code,reporter_contact_due_at:d48.toISOString(),guardian_contact_due_at:report.nna_involved?d24.toISOString():null,last_action_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const u=await sb.from('protection_reports').update(payload).eq('id',reportId).select().single();
 if(!u.error){report=u.data;await addEvent('case_opened','Expediente '+code+' abierto en Protección / DS22.')}
}
function deadlineText(iso,done){
 if(done)return '✓ Cumplido';
 if(!iso)return 'No aplica';
 const ms=new Date(iso)-new Date(),h=Math.ceil(ms/3600000);
 if(ms<0)return 'Vencido '+Math.abs(h)+' h';
 if(h<=6)return 'Quedan '+h+' h';
 return 'Quedan '+h+' h'
}
function nextActionText(){
 if(!report.risk_level||report.risk_level==='unassessed')return 'Evaluar riesgo';
 if(report.nna_involved&&!report.guardian_contacted_at)return 'Contactar responsable NNA';
 if(!report.reporter_contacted_at)return 'Contactar denunciante';
 if(report.crime_assessment==='undetermined')return 'Evaluar posible delito';
 if(report.crime_assessment==='no_apparent_crime'&&!report.respondent_contacted_at)return 'Contactar persona denunciada';
 if(measureRows.some(x=>x.status==='requested'))return 'Resolver medida protectora';
 return 'Seguimiento del caso'
}
function render(){
 caseTitle.textContent=(report.case_code||'Expediente DS22')+' · '+categoryLabel(report.category);
 caseMeta.textContent=new Date(report.created_at).toLocaleString('es-CL')+' · '+statusLabel(report.status);
 risk.value=report.risk_level||'unassessed';nna.value=String(!!report.nna_involved);crime.value=report.crime_assessment||'undetermined';assigned.value=report.assigned_to_name||'';
 const rb=report.risk_level||'unassessed';riskBadge.textContent=rb==='critical'?'🚨 CRÍTICO':rb==='high'?'🔴 ALTO':rb==='medium'?'🟡 MEDIO':rb==='low'?'🟢 BAJO':'SIN EVALUAR';riskBadge.className='badge '+(rb==='critical'?'critical':rb==='high'?'high':rb==='medium'?'medium':rb==='low'?'low':'');
 nextAction.textContent=nextActionText();
 reporterDeadline.textContent=deadlineText(report.reporter_contact_due_at,report.reporter_contacted_at);
 guardianDeadline.textContent=report.nna_involved?deadlineText(report.guardian_contact_due_at,report.guardian_contacted_at):'No aplica';
 respondentDeadline.textContent=report.crime_assessment==='no_apparent_crime'?deadlineText(report.respondent_contact_due_at,report.respondent_contacted_at):'Según evaluación';
 renderParties();renderMeasures();renderTimeline();renderReferral()
}
function categoryLabel(v){return ({convivencia:'Convivencia',maltrato_acoso:'Maltrato o acoso',discriminacion:'Discriminación',seguridad_nna:'Seguridad NNA',privacidad:'Privacidad',otro:'Otra situación'})[v]||v}
function statusLabel(v){return ({new:'Nueva',reviewing:'En revisión',action:'Plan de acción',closed:'Cerrada'})[v]||v}
function roleLabel(v){return ({affected:'Persona afectada',respondent:'Persona denunciada',witness:'Testigo',guardian:'Responsable legal',reporter:'Denunciante',other:'Otra persona'})[v]||v}
function renderParties(){
 parties.innerHTML=partiesRows.length?partiesRows.map(p=>'<div class="party"><b>'+esc(roleLabel(p.party_role))+' · '+esc(p.full_name)+'</b><div class="meta">'+[p.rut_passport,p.club_role,p.team_category,p.email,p.phone].filter(Boolean).map(esc).join(' · ')+'</div>'+(p.notes?'<div class="meta">'+esc(p.notes)+'</div>':'')+'</div>').join(''):'<div class="meta">Aún no se han registrado personas vinculadas.</div>'
}
async function promptParty(role){
 const name=prompt('Nombre completo');if(!name)return;
 const rut=prompt('RUT / documento (opcional)')||null;
 const clubRole=prompt('Rol en el club (entrenador, apoderado, jugador, dirigente, etc.)')||null;
 const team=prompt('Categoría / equipo (opcional)')||null;
 const email=prompt('Correo (opcional)')||null;
 const phone=prompt('Teléfono (opcional)')||null;
 const ins=await sb.from('protection_report_parties').insert({report_id:reportId,party_role:role,full_name:name.trim(),rut_passport:rut,club_role:clubRole,team_category:team,email,phone,created_by:user.id}).select().single();
 if(ins.error)return alert(ins.error.message);
 await addEvent('party_added',roleLabel(role)+' registrada: '+name.trim());await refresh()
}
function renderMeasures(){
 measures.innerHTML=measureRows.length?measureRows.map(m=>'<div class="measure"><b>'+esc(measureLabel(m.measure_type))+'</b> <span class="badge">'+esc(m.status)+'</span><div class="meta">'+esc(m.rationale)+(m.scope?'<br>Alcance: '+esc(m.scope):'')+(m.decision_due_at?'<br>Resolver antes de: '+new Date(m.decision_due_at).toLocaleString('es-CL'):'')+'</div></div>').join(''):'<div class="meta">Sin medidas de protección registradas.</div>'
}
function measureLabel(v){return ({no_contact:'No contacto',activity_separation:'Separación de actividades',role_reassignment:'Cambio de funciones',access_restriction:'Restricción de acceso',schedule_change:'Cambio de horario',precautionary_removal:'Apartamiento preventivo',support_measure:'Medida de apoyo',other:'Otra medida'})[v]||v}
async function promptMeasure(){
 const type=prompt('Tipo: no_contact / activity_separation / role_reassignment / access_restriction / schedule_change / precautionary_removal / support_measure / other','no_contact');if(!type)return;
 const allowed=['no_contact','activity_separation','role_reassignment','access_restriction','schedule_change','precautionary_removal','support_measure','other'];if(!allowed.includes(type))return alert('Tipo no válido.');
 const rationale=prompt('Motivo de la medida');if(!rationale)return;
 const scope=prompt('Alcance concreto (opcional)')||null;
 const due=new Date(Date.now()+48*3600000);
 const ins=await sb.from('protection_measures').insert({report_id:reportId,measure_type:type,rationale:rationale.trim(),scope,requested_by:user.id,decision_due_at:due.toISOString()});
 if(ins.error)return alert(ins.error.message);
 await addEvent('protective_measure_requested','Medida solicitada: '+measureLabel(type));await refresh()
}
function renderTimeline(){
 timeline.innerHTML=eventRows.length?eventRows.map(e=>'<div class="event"><b>'+new Date(e.event_at).toLocaleString('es-CL')+'</b><div class="meta">'+esc(e.summary)+'</div></div>').join(''):'<div class="meta">Sin movimientos registrados.</div>'
}
function renderReferral(){
 const x=referralRows[0];
 disciplineState.innerHTML=x?'<b>'+esc(x.status.toUpperCase())+'</b> · '+esc(x.summary_for_commission)+(x.due_at?'<br>Plazo: '+new Date(x.due_at).toLocaleString('es-CL'):''):'Sin derivación registrada.'
}
async function addEvent(type,summary,metadata={}){
 return sb.from('protection_report_events').insert({report_id:reportId,event_type:type,summary,actor_user_id:user.id,metadata})
}
saveAssessment.onclick=async()=>{
 const oldNna=!!report.nna_involved,newNna=nna.value==='true',crimeVal=crime.value;
 const now=new Date(),payload={risk_level:risk.value,nna_involved:newNna,crime_assessment:crimeVal,assigned_to_name:assigned.value.trim()||null,status:report.status==='new'?'reviewing':report.status,reviewed_by:user.id,reviewed_at:report.reviewed_at||now.toISOString(),last_action_at:now.toISOString(),updated_at:now.toISOString()};
 if(newNna&&!report.guardian_contact_due_at)payload.guardian_contact_due_at=new Date(now.getTime()+24*3600000).toISOString();
 if(crimeVal!=='undetermined'&&report.crime_assessment==='undetermined'){payload.crime_assessed_at=now.toISOString();payload.crime_assessed_by=user.id}
 if(crimeVal==='no_apparent_crime'&&!report.respondent_contact_due_at)payload.respondent_contact_due_at=new Date(now.getTime()+48*3600000).toISOString();
 const u=await sb.from('protection_reports').update(payload).eq('id',reportId);if(u.error)return alert(u.error.message);
 await addEvent('assessment_updated','Evaluación actualizada: riesgo '+risk.value+', NNA '+(newNna?'sí':'no')+', delito '+crimeVal+'.');await refresh()
};
markReporter.onclick=async()=>{const t=new Date().toISOString();await sb.from('protection_reports').update({reporter_contacted_at:t,last_action_at:t,updated_at:t}).eq('id',reportId);await addEvent('reporter_contacted','Contacto con denunciante registrado.');await refresh()};
markGuardian.onclick=async()=>{if(!report.nna_involved)return alert('Este caso no está marcado como NNA.');const t=new Date().toISOString();await sb.from('protection_reports').update({guardian_contacted_at:t,last_action_at:t,updated_at:t}).eq('id',reportId);await addEvent('guardian_contacted','Contacto con responsable legal/cuidador registrado.');await refresh()};
markRespondent.onclick=async()=>{if(report.crime_assessment!=='no_apparent_crime')return alert('Este paso corresponde cuando la evaluación indica que no aparenta delito.');const t=new Date().toISOString();await sb.from('protection_reports').update({respondent_contacted_at:t,last_action_at:t,updated_at:t}).eq('id',reportId);await addEvent('respondent_contacted','Contacto con persona denunciada registrado.');await refresh()};
addAffected.onclick=()=>promptParty('affected');addRespondent.onclick=()=>promptParty('respondent');addWitness.onclick=()=>promptParty('witness');addMeasure.onclick=promptMeasure;
referDiscipline.onclick=async()=>{
 const existing=referralRows.find(x=>!['closed'].includes(x.status));if(existing)return alert('Ya existe una derivación activa.');
 const purpose=prompt('Motivo: protective_measure / disciplinary_review / both / other','both');if(!purpose)return;
 if(!['protective_measure','disciplinary_review','both','other'].includes(purpose))return alert('Motivo no válido.');
 const summary=prompt('Resumen que recibirá la Comisión');if(!summary)return;
 const requested=prompt('Medida o decisión solicitada (opcional)')||null;
 const year=new Date().getFullYear();
 const q=await sb.from('discipline_cases').select('case_code').like('case_code','DISC-'+year+'-%');
 const seq=String((q.data||[]).length+1).padStart(3,'0'),code='DISC-'+year+'-'+seq;
 const dc=await sb.from('discipline_cases').insert({
   protection_report_id:reportId,
   case_code:code,
   title:'Derivación DS22 · '+categoryLabel(report.category),
   category:report.category,
   summary:summary.trim(),
   due_at:(purpose==='protective_measure'||purpose==='both')?new Date(Date.now()+48*3600000).toISOString():null,
   created_by:user.id
 }).select('id,case_code').single();
 if(dc.error)return alert('No se pudo crear el expediente disciplinario: '+dc.error.message);
 const due=(purpose==='protective_measure'||purpose==='both')?new Date(Date.now()+48*3600000):null;
 const rf=await sb.from('protection_discipline_referrals').insert({
   report_id:reportId,
   discipline_case_id:dc.data.id,
   purpose,
   summary_for_commission:summary.trim(),
   requested_measure:requested,
   due_at:due?due.toISOString():null,
   status:'sent',
   sent_at:new Date().toISOString(),
   sent_by:user.id
 }).select().single();
 if(rf.error)return alert('El expediente se creó, pero no se pudo registrar la derivación: '+rf.error.message);
 await sb.from('protection_measures').update({discipline_case_id:dc.data.id,updated_at:new Date().toISOString()}).eq('report_id',reportId).eq('status','requested');
 await sb.from('protection_reports').update({status:'action',discipline_referred_at:new Date().toISOString(),last_action_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',reportId);
 await addEvent('discipline_referral_sent','Derivación enviada a Comisión como '+dc.data.case_code+'.');
 alert('Derivación enviada correctamente: '+dc.data.case_code);
 await refresh()
};