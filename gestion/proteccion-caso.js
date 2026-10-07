const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
const params=new URLSearchParams(location.search),reportId=params.get('id');
let report=null,user=null,partiesRows=[],measureRows=[],eventRows=[],referralRows=[],dispatchChannelRows=[],dispatchRows=[],reportDocRows=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const jsq=s=>String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
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
 const [r,p,m,e,rf,ch,ds,rd]=await Promise.all([
  sb.from('protection_reports').select('*').eq('id',reportId).single(),
  sb.from('protection_report_parties').select('*').eq('report_id',reportId).eq('active',true).order('created_at'),
  sb.from('protection_measures').select('*').eq('report_id',reportId).order('created_at',{ascending:false}),
  sb.from('protection_report_events').select('*').eq('report_id',reportId).order('event_at',{ascending:false}),
  sb.from('protection_discipline_referrals').select('*').eq('report_id',reportId).order('created_at',{ascending:false}),
  sb.from('protection_dispatch_channels').select('*').order('institution'),
  sb.from('protection_report_dispatches').select('*').eq('report_id',reportId).order('prepared_at',{ascending:false}),
  sb.from('protection_report_documents').select('*').eq('report_id',reportId).order('uploaded_at',{ascending:false})
 ]);
 if(r.error){loading.textContent='No se pudo abrir el expediente: '+r.error.message;return}
 report=r.data;partiesRows=p.data||[];measureRows=m.data||[];eventRows=e.data||[];referralRows=rf.data||[];
 dispatchChannelRows=ch.data||[];dispatchRows=ds.data||[];reportDocRows=rd.data||[];
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
 renderParties();renderMeasures();renderTimeline();renderReferral();renderDispatch()
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
function renderDispatch(){
 dispatchChannel.innerHTML='<option value="">Selecciona un canal</option>'+dispatchChannelRows.map(x=>'<option value="'+esc(x.code)+'">'+esc(x.institution)+' · '+esc(x.purpose)+'</option>').join('');
 dispatchDocument.innerHTML='<option value="">Sin documento archivado</option>'+reportDocRows.map(d=>'<option value="'+d.id+'">'+esc(d.doc_name)+' · '+esc(d.original_name||'PDF')+'</option>').join('');
 if(!dispatchSubject.value)dispatchSubject.value='Expediente '+(report.case_code||report.id);
 dispatchList.innerHTML=dispatchRows.length?dispatchRows.map(d=>{
  const ch=dispatchChannelRows.find(x=>x.code===d.channel_code);
  return '<div class="party"><b>'+esc(ch?.institution||d.channel_code)+'</b> <span class="badge">'+esc(d.status)+'</span><div class="meta">'+
   'Preparado: '+new Date(d.prepared_at).toLocaleString('es-CL')+
   (d.channel_opened_at?'<br>Canal abierto: '+new Date(d.channel_opened_at).toLocaleString('es-CL'):'')+
   (d.sent_at?'<br>Marcado enviado: '+new Date(d.sent_at).toLocaleString('es-CL'):'')+
   (d.acknowledged_at?'<br>Acuse: '+new Date(d.acknowledged_at).toLocaleString('es-CL'):'')+
   (d.tracking_ref?'<br>Folio/RUC/Ref.: '+esc(d.tracking_ref):'')+
   (d.receipt_name?'<br>Comprobante: '+esc(d.receipt_name):'')+
   '</div><div class="actions">'+
   (!d.sent_at?'<button class="btn sec" onclick="markDispatchSent(\''+d.id+'\')">Marcar enviado</button>':'')+
   '<button class="btn sec" onclick="registerDispatchReceipt(\''+d.id+'\')">Registrar folio/comprobante</button>'+
   (d.receipt_storage_path?'<button class="btn sec" onclick="openDispatchReceipt(\''+jsq(d.receipt_storage_path)+'\')">Abrir comprobante</button>':'')+
   '<input id="receipt_'+d.id+'" type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp" onchange="uploadDispatchReceipt(\''+d.id+'\',this)">'+
   '</div></div>'
 }).join(''):'<div class="meta">Aún no hay despachos preparados.</div>';
}

async function prepareDispatchRecord(){
 const channel=dispatchChannel.value;if(!channel)return alert('Selecciona un canal.');
 const subject=dispatchSubject.value.trim()||('Expediente '+(report.case_code||report.id));
 const message=dispatchMessage.value.trim()||null;
 const docId=dispatchDocument.value||null;
 const ch=dispatchChannelRows.find(x=>x.code===channel);
 const ins=await sb.from('protection_report_dispatches').insert({
  report_id:reportId,channel_code:channel,status:'prepared',
  recipient_name:ch?.institution||null,subject,message_body:message,
  document_id:docId,sent_by:user.id,updated_at:new Date().toISOString()
 }).select().single();
 if(ins.error)return alert('No se pudo preparar el envío: '+ins.error.message);
 await addEvent('dispatch_prepared','Envío preparado para '+(ch?.institution||channel)+'.');
 await refresh();
 return ins.data;
}

async function openOfficialDispatch(){
 const channel=dispatchChannel.value;if(!channel)return alert('Selecciona un canal.');
 const ch=dispatchChannelRows.find(x=>x.code===channel);if(!ch)return alert('Canal no encontrado.');
 let row=dispatchRows.find(x=>x.channel_code===channel&&x.status==='prepared'&&!x.sent_at);
 if(!row)row=await prepareDispatchRecord();
 if(!row)return;
 if(ch.official_url){
  window.open(ch.official_url,'_blank','noopener');
  const now=new Date().toISOString();
  await sb.from('protection_report_dispatches').update({channel_opened_at:now,updated_at:now}).eq('id',row.id);
  await addEvent('dispatch_channel_opened','Canal oficial abierto: '+ch.institution+'. Esto no acredita envío.');
  await refresh()
 }else if(ch.email){
  location.href='mailto:'+encodeURIComponent(ch.email)+'?subject='+encodeURIComponent(row.subject||'')+'&body='+encodeURIComponent(row.message_body||'');
 }else alert('Este canal no tiene URL ni correo verificado. Revisa las instrucciones del canal.')
}

async function markDispatchSent(id){
 if(!confirm('¿Confirmas que el envío o presentación ya fue realizado? Esto aún no reemplaza el acuse/comprobante.'))return;
 const now=new Date().toISOString();
 const r=await sb.from('protection_report_dispatches').update({status:'sent',sent_at:now,sent_by:user.id,updated_at:now}).eq('id',id);
 if(r.error)return alert(r.error.message);
 await addEvent('dispatch_sent','Despacho marcado como enviado/presentado.');
 await refresh()
}

function registerDispatchReceipt(id){
 const row=dispatchRows.find(x=>x.id===id);
 const ref=prompt('Ingresa RUC, folio, número de ingreso o referencia del comprobante',row?.tracking_ref||'');
 if(ref===null)return;
 document.getElementById('receipt_'+id)?.click();
 window.__dispatchReceiptPending={id,ref:ref.trim()||null};
}

async function uploadDispatchReceipt(id,input){
 const file=input.files?.[0];if(!file)return;
 const ref=(window.__dispatchReceiptPending?.id===id)?window.__dispatchReceiptPending.ref:null;
 const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=reportId+'/dispatch/'+id+'/'+Date.now()+'-'+safe;
 const up=await sb.storage.from('protection-reports-private').upload(path,file,{upsert:false});
 if(up.error)return alert('No se pudo subir el comprobante: '+up.error.message);
 const now=new Date().toISOString();
 const r=await sb.from('protection_report_dispatches').update({
   status:'acknowledged',tracking_ref:ref,receipt_storage_path:path,receipt_name:file.name,
   acknowledged_at:now,updated_at:now
 }).eq('id',id);
 if(r.error)return alert(r.error.message);
 await addEvent('dispatch_acknowledged','Acuse/comprobante registrado'+(ref?' · Ref. '+ref:'')+'.');
 window.__dispatchReceiptPending=null;await refresh()
}

async function openDispatchReceipt(path){
 const r=await sb.storage.from('protection-reports-private').createSignedUrl(path,600);
 if(r.error||!r.data?.signedUrl)return alert(r.error?.message||'No se pudo abrir el comprobante.');
 window.open(r.data.signedUrl,'_blank')
}
function firstParty(role){return partiesRows.find(x=>x.party_role===role)}
function fmtDate(v){return v?new Date(v).toLocaleString('es-CL'):'[PENDIENTE]'}
function partyLine(p){return p?(p.full_name+(p.rut_passport?' · RUT/Doc: '+p.rut_passport:'')+(p.club_role?' · Rol: '+p.club_role:'')+(p.team_category?' · Categoría: '+p.team_category:'')):'[NO REGISTRADO]'}
function buildSmartDocument(type){
 const affected=firstParty('affected'),respondent=firstParty('respondent'),guardian=firstParty('guardian');
 const base='CLUB DEPORTIVO SOCIAL Y CULTURAL GIGANTES DE AZAPA\nExpediente: '+(report.case_code||report.id)+'\nFecha de emisión: '+new Date().toLocaleString('es-CL')+'\n\n';
 const templates={
  reception:base+'ACTA DE RECEPCIÓN DE REPORTE\n\nFecha y hora de recepción: '+fmtDate(report.created_at)+'\nCategoría: '+categoryLabel(report.category)+'\nNivel de riesgo: '+String(report.risk_level||'unassessed').toUpperCase()+'\nNNA involucrado: '+(report.nna_involved?'Sí':'No')+'\nPersona afectada: '+partyLine(affected)+'\n\nRelato recibido:\n'+report.narrative+'\n\nObservaciones de recepción:\n[EDITAR]\n\nResponsable que registra: '+(report.assigned_to_name||'[PENDIENTE]'),
  reporter_contact:base+'REGISTRO DE CONTACTO CON DENUNCIANTE\n\nFecha límite: '+fmtDate(report.reporter_contact_due_at)+'\nFecha de contacto: '+fmtDate(report.reporter_contacted_at)+'\nDenunciante: '+(report.reporter_name||'[ANÓNIMO / NO INFORMADO]')+'\nContacto disponible: '+(report.reporter_contact||'[NO INFORMADO]')+'\n\nResumen del contacto:\n[EDITAR]\n\nInformación o antecedentes adicionales entregados:\n[EDITAR]',
  guardian_contact:base+'REGISTRO DE COMUNICACIÓN A RESPONSABLE DE NNA\n\nNNA involucrado: '+(report.nna_involved?'Sí':'No')+'\nPersona afectada: '+partyLine(affected)+'\nResponsable legal / cuidador: '+partyLine(guardian)+'\nFecha límite: '+fmtDate(report.guardian_contact_due_at)+'\nFecha de contacto: '+fmtDate(report.guardian_contacted_at)+'\n\nInformación comunicada:\n[EDITAR]\n\nMedidas de resguardo informadas:\n[EDITAR]',
  assessment:base+'FICHA DE EVALUACIÓN INICIAL DS22\n\nNivel de riesgo: '+String(report.risk_level||'unassessed').toUpperCase()+'\nRiesgo inmediato informado: '+(report.immediate_risk?'Sí':'No')+'\nNNA involucrado: '+(report.nna_involved?'Sí':'No')+'\nEvaluación sobre posible delito: '+(report.crime_assessment==='possible_crime'?'POSIBLE DELITO':report.crime_assessment==='no_apparent_crime'?'NO APARENTA DELITO':'PENDIENTE')+'\nFecha evaluación: '+fmtDate(report.crime_assessed_at)+'\n\nFundamentos de la evaluación:\n[EDITAR]\n\nAcciones inmediatas definidas:\n[EDITAR]',
  authority_referral:base+'CONSTANCIA DE DENUNCIA / DERIVACIÓN A AUTORIDAD\n\nPersona afectada: '+partyLine(affected)+'\nPersona denunciada: '+partyLine(respondent)+'\nEvaluación: '+(report.crime_assessment==='possible_crime'?'Los antecedentes podrían revestir caracteres de delito.':'[REVISAR]')+'\n\nAutoridad / canal utilizado:\n[EDITAR]\n\nFecha y hora de presentación:\n[EDITAR]\n\nRUC / folio / comprobante:\n[EDITAR]\n\nAntecedentes remitidos:\n[EDITAR]',
  board_report:base+'INFORME RESERVADO AL DIRECTORIO\n\nSe informa, con carácter reservado, la existencia del expediente indicado.\n\nPersona afectada: '+partyLine(affected)+'\nPersona denunciada: '+partyLine(respondent)+'\nRiesgo: '+String(report.risk_level||'unassessed').toUpperCase()+'\nEvaluación inicial: '+String(report.crime_assessment||'undetermined')+'\n\nMedidas adoptadas o solicitadas:\n'+(measureRows.length?measureRows.map(m=>'- '+measureLabel(m.measure_type)+' · '+m.status+' · '+m.rationale).join('\n'):'[SIN MEDIDAS REGISTRADAS]')+'\n\nAcciones pendientes:\n[EDITAR]',
  discipline_referral:base+'OFICIO DE DERIVACIÓN A COMISIÓN DE DISCIPLINA\n\nPor medio del presente, Protección / DS22 remite antecedentes del expediente indicado para conocimiento y actuación de la Comisión de Disciplina, dentro del ámbito de sus competencias.\n\nPersona denunciada: '+partyLine(respondent)+'\nMotivo de derivación:\n'+(referralRows[0]?.summary_for_commission||'[EDITAR]')+'\n\nMedida o decisión solicitada:\n'+(referralRows[0]?.requested_measure||'[EDITAR]')+'\n\nPlazo requerido: '+fmtDate(referralRows[0]?.due_at)+'\n\nAntecedentes remitidos:\n[EDITAR]',
  protective_measure:base+'SOLICITUD DE MEDIDA DE PROTECCIÓN\n\nPersona protegida: '+partyLine(affected)+'\nPersona respecto de la cual se solicita la medida: '+partyLine(respondent)+'\n\nMedidas registradas:\n'+(measureRows.length?measureRows.map(m=>'- '+measureLabel(m.measure_type)+': '+m.rationale+(m.scope?' · Alcance: '+m.scope:'')).join('\n'):'[NO HAY MEDIDA REGISTRADA]')+'\n\nFundamento de necesidad y proporcionalidad:\n[EDITAR]\n\nSe deja constancia de que la medida solicitada es preventiva y no constituye por sí misma una determinación de responsabilidad ni una sanción.',
  respondent_contact:base+'REGISTRO DE CONTACTO CON PERSONA DENUNCIADA\n\nPersona denunciada: '+partyLine(respondent)+'\nFecha límite de contacto: '+fmtDate(report.respondent_contact_due_at)+'\nFecha de contacto: '+fmtDate(report.respondent_contacted_at)+'\n\nInformación comunicada sobre el procedimiento:\n[EDITAR]\n\nVersión / descargos entregados:\n[EDITAR]\n\nDocumentos acompañados:\n[EDITAR]\n\nSe deja constancia de que el tratamiento del caso respeta la reserva y el debido proceso.',
  closure:base+'ACTA DE CIERRE DE EXPEDIENTE DS22\n\nEstado final: '+statusLabel(report.status)+'\nPersona afectada: '+partyLine(affected)+'\nPersona denunciada: '+partyLine(respondent)+'\n\nActuaciones realizadas:\n'+(eventRows.length?eventRows.slice().reverse().map(e=>'- '+new Date(e.event_at).toLocaleString('es-CL')+' · '+e.summary).join('\n'):'[SIN BITÁCORA]')+'\n\nMedidas / derivaciones finalizadas:\n[EDITAR]\n\nMotivo y fundamento del cierre:\n[EDITAR]\n\nPendientes posteriores al cierre, si existen:\n[EDITAR]'
 };
 return templates[type]||base+'DOCUMENTO DS22\n\n[EDITAR]';
}
function smartDocName(type){return ({reception:'Acta_Recepcion',reporter_contact:'Contacto_Denunciante',guardian_contact:'Comunicacion_Responsable_NNA',assessment:'Evaluacion_Inicial',authority_referral:'Constancia_Derivacion_Autoridad',board_report:'Informe_Reservado_Directorio',discipline_referral:'Oficio_Comision_Disciplina',protective_measure:'Solicitud_Medida_Proteccion',respondent_contact:'Contacto_Persona_Denunciada',closure:'Acta_Cierre'})[type]||'Documento_DS22'}
function prepareSmartDocument(){docBody.value=buildSmartDocument(docType.value)}
function smartDocumentPdfBlob(){
 if(!docBody.value.trim())prepareSmartDocument();
 const {jsPDF}=window.jspdf,d=new jsPDF(),lines=d.splitTextToSize(docBody.value,178);
 let y=16;d.setFontSize(10);
 for(const line of lines){if(y>278){d.addPage();y=16}d.text(line,16,y);y+=5.2}
 return d.output('blob')
}
function downloadSmartDocument(){
 const blob=smartDocumentPdfBlob(),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=smartDocName(docType.value)+'_'+(report.case_code||report.id)+'.pdf';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 addEvent('smart_document_generated','Documento generado: '+smartDocName(docType.value));
}
async function archiveSmartDocument(){
 const blob=smartDocumentPdfBlob(),name=smartDocName(docType.value)+'_'+(report.case_code||report.id)+'.pdf',path=reportId+'/generated/'+Date.now()+'-'+name.replace(/[^a-zA-Z0-9._-]/g,'_');
 const up=await sb.storage.from('protection-reports-private').upload(path,blob,{contentType:'application/pdf',upsert:false});
 if(up.error)return alert('No se pudo guardar el PDF: '+up.error.message);
 const ins=await sb.from('protection_report_documents').insert({report_id:reportId,doc_code:docType.value,doc_name:smartDocName(docType.value),storage_path:path,original_name:name,uploaded_by:user.id,notes:'Documento generado desde el expediente DS22'});
 if(ins.error)return alert('El PDF se subió, pero no pudo registrarse: '+ins.error.message);
 await addEvent('smart_document_archived','Documento archivado: '+name);
 alert('Documento guardado dentro del expediente.');
}
async function shareSmartDocument(){
 const blob=smartDocumentPdfBlob(),name=smartDocName(docType.value)+'_'+(report.case_code||report.id)+'.pdf',file=new File([blob],name,{type:'application/pdf'});
 try{
  if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
   await navigator.share({title:name,text:'Documento del expediente '+(report.case_code||''),files:[file]});
   await addEvent('smart_document_shared','Se abrió el menú de compartir: '+name);
  }else{
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   alert('El PDF fue descargado. Tu dispositivo no permite compartir archivos directamente desde esta página.');
  }
 }catch(e){if(e?.name!=='AbortError')alert('No se pudo compartir: '+e.message)}
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
prepareDoc.onclick=prepareSmartDocument;downloadDoc.onclick=downloadSmartDocument;archiveDoc.onclick=archiveSmartDocument;shareDoc.onclick=shareSmartDocument;
prepareDispatch.onclick=prepareDispatchRecord;openOfficialChannel.onclick=openOfficialDispatch;