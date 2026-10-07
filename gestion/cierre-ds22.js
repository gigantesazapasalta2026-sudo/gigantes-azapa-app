const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
let tasks=[],reqs=[],vals=[],docTemplates=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
(async()=>{
 const {data:{session}}=await sb.auth.getSession();if(!session){location.href='login.html?next=cierre-ds22.html';return}
 const {data:p}=await sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle();
 if(!p?.active||!['superadmin','board'].includes(p.role)){document.body.innerHTML='<main class="main wrap"><div class="card">Acceso sólo para Directiva / Superadmin.</div></main>';return}
 await loadData();
})();
async function loadData(){
 const [{data:t,error:te},{data:r,error:re},{data:v,error:ve},{data:dt,error:dte}]=await Promise.all([
  sb.from('tasks').select('id,code,title,priority,status,progress,owner_name,due_date,notes').or('code.like.DS22-%,code.like.DISC-%').order('code'),
  sb.from('control_item_requirements').select('id,entity_id,code,title,detail,requirement_type,required,sensitive,source,sort_order').eq('entity_type','task').order('sort_order'),
  sb.from('control_requirement_values').select('requirement_id,value_text,file_path,file_name,completed_at'),
  sb.from('control_document_templates').select('*').eq('active',true)
 ]);
 if(te||re||ve||dte){document.getElementById('pendingUploads').innerHTML='<div class="notice">No se pudieron cargar los antecedentes pendientes.</div>';return}
 tasks=t||[];reqs=(r||[]).filter(x=>tasks.some(t=>t.id===x.entity_id));vals=(v||[]).filter(x=>reqs.some(r=>r.id===x.requirement_id));docTemplates=dt||[];render()
}
function reqValue(id){return vals.find(v=>v.requirement_id===id)||null}
function reqDone(r){const v=reqValue(r.id);return r.requirement_type==='file'&&!!v?.file_path}
function taskForReq(r){return tasks.find(t=>t.id===r.entity_id)}
function requirementByCode(taskId,code){return reqs.find(r=>r.entity_id===taskId&&r.code===code)||null}
function docTemplate(code){return docTemplates.find(x=>x.requirement_code===code)||null}
function parseDraftData(r){
 const v=reqValue(r.id);if(!v?.value_text)return {};
 try{return JSON.parse(v.value_text)||{}}catch(e){return {}}
}
function closeDocAssistant(){document.getElementById('docModal')?.classList.remove('open')}
function fieldHtml(field,value){
 const id='doc_field_'+field.name,label=esc(field.label||field.name),req=field.required?' *':'';
 if(field.type==='textarea')return '<div class="wide"><label>'+label+req+'</label><textarea id="'+id+'" data-field="'+esc(field.name)+'" data-required="'+(field.required?'1':'0')+'">'+esc(value??field.default??'')+'</textarea></div>';
 return '<div><label>'+label+req+'</label><input id="'+id+'" type="'+esc(field.type||'text')+'" data-field="'+esc(field.name)+'" data-required="'+(field.required?'1':'0')+'" value="'+esc(value??field.default??'')+'"></div>'
}
function assistantButtons(r,t,done){
 if(!t)return '<button class="btn sec" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 '+(done?'Reemplazar':'Cargar archivo')+'</button>';
 let html='';
 if(t.mode==='internal_pdf')html+='<button class="btn" onclick="openDocumentAssistant(\''+r.id+'\')">✨ Crear formato</button>';
 if(t.mode==='official_external'&&(Array.isArray(t.fields)&&t.fields.length))html+='<button class="btn" onclick="openDocumentAssistant(\''+r.id+'\')">🧭 Preparar datos</button>';
 if((t.mode==='official_external'||t.mode==='existing_public')&&t.source_url)html+='<a class="btn sec" target="_blank" rel="noopener" href="'+esc(t.source_url)+'">🌐 '+(t.mode==='existing_public'?'Abrir documento':'Abrir fuente oficial')+'</a>';
 if(t.mode==='evidence_only')html+='<button class="btn sec" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 '+(done?'Reemplazar evidencia':'Cargar evidencia')+'</button>';
 if(t.mode!=='evidence_only')html+='<button class="btn sec" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 '+(done?'Reemplazar final':'Subir documento final')+'</button>';
 return html
}
async function saveDocumentDraftData(r,data){
 const current=reqValue(r.id)||{};
 const payload={requirement_id:r.id,value_text:JSON.stringify(data),updated_at:new Date().toISOString()};
 if(current.file_path){payload.file_path=current.file_path;payload.file_name=current.file_name;payload.completed_at=current.completed_at}
 const {error}=await sb.from('control_requirement_values').upsert(payload,{onConflict:'requirement_id'});
 if(error)throw error
}
function collectDocumentFields(t){
 const data={};
 for(const field of (t.fields||[])){
  const el=document.getElementById('doc_field_'+field.name),v=(el?.value||'').trim();
  if(field.required&&!v){alert('Completa: '+field.label);el?.focus();return null}
  data[field.name]=v
 }
 return data
}
async function openDocumentAssistant(reqId){
 const r=reqs.find(x=>x.id===reqId),t=r&&docTemplate(r.code);if(!r||!t)return;
 const saved=parseDraftData(r),fields=(t.fields||[]).map(f=>fieldHtml(f,saved[f.name])).join('');
 const source=t.source_url?'<a class="btn sec" target="_blank" rel="noopener" href="'+esc(t.source_url)+'">🌐 Abrir fuente oficial</a>':'';
 docModalBody.innerHTML='<h2>'+esc(t.title)+'</h2><div class="notice">'+esc(t.helper_text||'Completa los datos y genera el documento.')+'</div>'+
  (fields?'<div class="formGrid" style="margin-top:10px">'+fields+'</div>':'')+
  '<div class="actions" style="margin-top:12px">'+
  (fields?'<button class="btn sec" onclick="saveDocumentAssistantData(\''+reqId+'\')">💾 Guardar datos</button>':'')+
  (t.output_name?'<button class="btn" onclick="generateDocumentAssistantPdf(\''+reqId+'\')">⬇ Generar PDF preeditado</button>':'')+
  source+
  '<button class="btn sec" onclick="closeDocAssistant()">Cerrar</button></div>';
 document.getElementById('docModal').classList.add('open')
}
async function saveDocumentAssistantData(reqId){
 const r=reqs.find(x=>x.id===reqId),t=r&&docTemplate(r.code);if(!r||!t)return;
 const data=collectDocumentFields(t);if(!data)return;
 try{await saveDocumentDraftData(r,data);alert('Datos guardados. Puedes volver y seguir completando después.')}catch(e){alert('No se pudo guardar: '+e.message)}
}
function pdfParagraphsFor(t,d){
 const today=new Date().toLocaleDateString('es-CL');
 const common=['Club Deportivo Social y Cultural Gigantes de Azapa','Documento generado desde Control Center · '+today];
 if(t.template_key==='ri_ratification_minutes')return common.concat([
  'BORRADOR · ACTA DE RATIFICACIÓN DE RESPONSABLES INSTITUCIONALES DS22',
  'En '+d.place+', con fecha '+d.date+', se celebra la instancia correspondiente del Club, presidida por '+d.chair+' y actuando como Secretaría '+d.secretary+'.',
  'Se deja constancia del quórum/asistencia informado: '+d.quorum+'.',
  'Responsable Institucional Titular: '+d.titular+'. Responsable Institucional Suplente: '+d.suplente+'.',
  'ACUERDO: '+d.agreement,
  'La presente versión se genera como borrador para revisión, firmas y archivo del respaldo definitivo. No sustituye el acta firmada.'
 ]);
 if(t.template_key==='discipline_election_minutes')return common.concat([
  'BORRADOR · ACTA DE INTEGRACIÓN DE LA COMISIÓN DE DISCIPLINA',
  'En '+d.place+', con fecha '+d.date+', se reúne la instancia institucional correspondiente, presidida por '+d.chair+' y actuando como Secretaría '+d.secretary+'.',
  'Se registra la integración propuesta/acordada de la Comisión: 1) '+d.member1+'; 2) '+d.member2+'; 3) '+d.member3+(d.alternate?'; suplente si corresponde: '+d.alternate:'')+'.',
  'ACUERDO / FORMA DE INTEGRACIÓN: '+d.agreement,
  'La integración definitiva deberá quedar respaldada conforme a los Estatutos vigentes y al acta firmada.'
 ]);
 if(t.template_key==='discipline_roster')return common.concat([
  'NÓMINA INSTITUCIONAL · COMISIÓN DE DISCIPLINA',
  'Integrante 1: '+d.member1+(d.email1?' · '+d.email1:''),
  'Integrante 2: '+d.member2+(d.email2?' · '+d.email2:''),
  'Integrante 3: '+d.member3+(d.email3?' · '+d.email3:''),
  d.alternate?'Suplente, si corresponde: '+d.alternate:'',
  'Documento preparado para control interno. Su vigencia depende del respaldo institucional de integración.'
 ]);
 if(t.template_key==='discipline_approval_minutes')return common.concat([
  'BORRADOR · ACTA DE APROBACIÓN DEL REGLAMENTO ESPECIAL DE LA COMISIÓN DE DISCIPLINA',
  'En '+d.place+', con fecha '+d.date+', se reúne la instancia correspondiente, presidida por '+d.chair+' y actuando como Secretaría '+d.secretary+'.',
  'Se revisa el proyecto de Reglamento especial de la Comisión de Disciplina.',
  'ACUERDO: '+d.decision,
  'Se deja constancia de que la versión definitiva y el acta firmada deberán incorporarse al archivo institucional.'
 ]);
 if(t.template_key==='discipline_regulation')return common.concat([
  'BORRADOR · REGLAMENTO ESPECIAL DE LA COMISIÓN DE DISCIPLINA · Versión '+d.version+' · '+d.date,
  '1. Objeto. Organizar el funcionamiento de la Comisión prevista en los Estatutos, sin reemplazarlos ni alterar la normativa superior aplicable.',
  '2. Principios. Reserva, imparcialidad, debido proceso, proporcionalidad, no revictimización y trazabilidad.',
  '3. Integración e impedimentos. Los integrantes actuarán conforme a los Estatutos y deberán abstenerse cuando exista conflicto de interés o impedimento.',
  '4. Inicio. Cada asunto tendrá expediente, código y registro cronológico. Puede provenir de Protección/DS22 u otra vía estatutariamente admisible.',
  '5. Competencia. Antes de continuar se revisará competencia, impedimentos y necesidad de medidas protectoras.',
  '6. Citación y descargos. La persona denunciada será informada del procedimiento y tendrá oportunidad efectiva de entregar descargos y antecedentes.',
  '7. Sesión y deliberación. Se registrarán asistentes, antecedentes, abstenciones, descargos y acuerdos. La deliberación será reservada.',
  '8. Medidas de protección. Se distinguirán expresamente de las sanciones y no implicarán determinación anticipada de responsabilidad.',
  '9. Resolución. Toda decisión será fundada, identificará antecedentes, norma aplicable, proporcionalidad y medida o sanción cuando corresponda.',
  '10. Notificación. Se registrará persona notificada, fecha, medio y comprobante.',
  '11. Apelación. Se controlarán los plazos y la remisión al órgano estatutario correspondiente.',
  '12. Protección de NNA y datos sensibles. Se restringirá el acceso y se evitará toda identificación innecesaria.',
  '13. Publicación. Toda versión pública será anonimizada y revisada antes de publicarse.',
  '14. Relación con autoridades. El procedimiento interno no sustituye las competencias de Fiscalía, PDI, Carabineros o tribunales.',
  '15. Archivo y cierre. El expediente se cerrará sólo cuando estén documentadas resolución, notificación, recursos, cumplimiento y antecedentes relevantes.',
  '16. Vigencia. Este Reglamento sólo entra en vigencia después de su aprobación por la instancia estatutaria correspondiente.'
 ]);
 if(t.template_key==='version_control_v11')return common.concat([
  'CONTROL DE VERSIÓN · REGLAMENTO INTERNO V1.1',
  'Fecha: '+d.date+'. Órgano/persona que aprueba o toma conocimiento: '+d.approver+'.',
  'Secretaría / responsable de registro: '+d.secretary+'.',
  'Cambio principal: actualización de los antecedentes de Responsables Institucionales DS22 y eliminación de campos que estaban pendientes en la V1.0.',
  d.notes?'Observaciones: '+d.notes:'',
  'Esta hoja debe conservarse junto a la versión V1.1 y al respaldo institucional que corresponda.'
 ]);
 if(t.template_key==='regulation_v11')return common.concat([
  'BORRADOR · REGLAMENTO INTERNO, DE CONVIVENCIA, PARTICIPACIÓN Y PROTECCIÓN · VERSIÓN 1.1',
  'Fecha de vigencia propuesta: '+d.effective_date+'.',
  'Esta V1.1 mantiene el contenido de la Versión 1.0 aprobada el 6 de octubre de 2026, salvo las actualizaciones expresamente indicadas a continuación.',
  'ACTUALIZACIÓN DEL ARTÍCULO 17 · RESPONSABLES INSTITUCIONALES',
  'Responsable Institucional Titular: '+d.titular+'. Contacto institucional: '+d.titular_contact+'.',
  'Responsable Institucional Suplente: '+d.suplente+'. Contacto institucional: '+d.suplente_contact+'.',
  'Fecha de ratificación: '+d.ratification_date+'. Referencia de acta/respaldo: '+d.acta_ref+'.',
  'Se eliminan de la V1.0 las leyendas “pendiente de designación / completar en Control Center” relativas a estos campos.',
  'Los demás artículos y disposiciones de la V1.0 continúan vigentes sin modificación, salvo acuerdo institucional posterior debidamente registrado.',
  'CONTROL DE CAMBIO: V1.0 aprobada por Directiva el 6 de octubre de 2026 → V1.1 incorpora Responsables Institucionales y sus medios de contacto.',
  'BORRADOR: requiere revisión y respaldo institucional antes de publicarse como versión vigente.'
 ]);
 if(t.template_key==='ri_form_prep')return common.concat([
  'FICHA DE PREPARACIÓN · INSCRIPCIÓN RESPONSABLES INSTITUCIONALES IND',
  'Organización · RUT: '+d.organization_id,
  'RI Titular: '+d.titular+' · Contacto: '+d.titular_contact,
  'RI Suplente: '+d.suplente+' · Contacto: '+d.suplente_contact,
  'Acta/acuerdo de ratificación: '+d.acta_ref,
  'Esta ficha NO reemplaza el formulario oficial del IND. Su objetivo es reunir los datos antes de completar/presentar el documento oficial.'
 ]);
 if(t.template_key==='rrfp_prep')return common.concat([
  'FICHA DE PREPARACIÓN · RRFP / ANEXO N°1',
  'Razón social: '+d.legal_name+' · RUT: '+d.organization_id,
  'Representante legal: '+d.legal_rep,
  'Tesorero/a: '+d.treasurer,
  'Secretario/a: '+d.secretary,
  'Checklist: formulario oficial vigente; certificado de vigencia; directorio vigente; balance/F22 según corresponda; antecedentes de directorio; certificado Registro Central Ley 19.862; acreditación DS22/RI.',
  'Esta ficha NO reemplaza el formulario oficial RRFP ni sus anexos.'
 ]);
 return common.concat([t.title,'Datos ingresados:',...Object.entries(d).map(([k,v])=>k+': '+v)])
}
function downloadPdfFromParagraphs(title,paragraphs,fileName){
 const {jsPDF}=window.jspdf,d=new jsPDF();d.setFontSize(14);d.text('Gigantes de Azapa',16,17);d.setFontSize(12);d.text(d.splitTextToSize(title,178),16,28);let y=43;d.setFontSize(9);
 for(const p0 of paragraphs){const p=String(p0||'').trim();if(!p)continue;const lines=d.splitTextToSize(p,178);if(y+lines.length*5.2>280){d.addPage();y=18}d.text(lines,16,y);y+=lines.length*5.2+4}
 d.save(fileName||'Documento_Control_Center.pdf')
}
async function generateDocumentAssistantPdf(reqId){
 const r=reqs.find(x=>x.id===reqId),t=r&&docTemplate(r.code);if(!r||!t)return;
 const data=collectDocumentFields(t);if(!data)return;
 try{await saveDocumentDraftData(r,data);downloadPdfFromParagraphs(t.title,pdfParagraphsFor(t,data),t.output_name||('Documento_'+r.code+'.pdf'))}catch(e){alert('No se pudo generar: '+e.message)}
}
function ds22V11Action(t){
 if(t.code!=='DS22-12')return '';
 const r=requirementByCode(t.id,'REG_INT_V11');if(!r)return '';
 const done=reqDone(r);
 return done
  ? '<button class="btn sec" onclick="openPendingFile(\''+r.id+'\')">👁 Ver Reglamento V1.1</button><button class="btn sec" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 Reemplazar PDF</button>'
  : '<button class="btn" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 Subir Reglamento V1.1 PDF</button>';
}
function pendingFileRequirements(){return reqs.filter(r=>r.requirement_type==='file'&&r.required!==false&&!reqDone(r))}
function scrollPending(){document.getElementById('pendingUploadsCard')?.scrollIntoView({behavior:'smooth',block:'start'})}
function fileInputId(id){return 'pending_file_'+String(id).replaceAll('-','_')}
function pickPendingFile(id){document.getElementById(fileInputId(id))?.click()}
function updatePendingName(id){
 const input=document.getElementById(fileInputId(id)),label=document.getElementById('pending_name_'+id);
 if(label)label.textContent=input?.files?.[0]?.name||'Ningún archivo seleccionado'
}
async function uploadPendingFile(id){
 const r=reqs.find(x=>x.id===id),input=document.getElementById(fileInputId(id)),file=input?.files?.[0];
 if(!r||!file)return alert('Selecciona un archivo.');
 if(file.size>15*1024*1024)return alert('El archivo supera 15 MB. Reduce su tamaño antes de subirlo.');
 const button=document.getElementById('pending_btn_'+id);if(button){button.disabled=true;button.textContent='Subiendo…'}
 const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=id+'/'+Date.now()+'-'+safe;
 const {error:upErr}=await sb.storage.from('control-evidence-private').upload(path,file,{upsert:false,contentType:file.type||undefined});
 if(upErr){if(button){button.disabled=false;button.textContent='⬆ Subir archivo'};return alert('No se pudo subir: '+upErr.message)}
 const {data:{user}}=await sb.auth.getUser();
 const {error:saveErr}=await sb.from('control_requirement_values').upsert({requirement_id:id,file_path:path,file_name:file.name,completed_by:user?.id||null,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'requirement_id'});
 if(saveErr){if(button){button.disabled=false;button.textContent='⬆ Subir archivo'};return alert('El archivo subió pero no se pudo registrar: '+saveErr.message)}
 await sb.rpc('refresh_control_item',{et:'task',eid:r.entity_id});
 await loadData();
 alert('Archivo cargado correctamente.')
}
async function openPendingFile(id){
 const v=reqValue(id);if(!v?.file_path)return;
 const {data,error}=await sb.storage.from('control-evidence-private').createSignedUrl(v.file_path,600);
 if(error||!data?.signedUrl)return alert(error?.message||'No se pudo abrir el archivo.');
 window.open(data.signedUrl,'_blank')
}
function renderPendingUploads(){
 const allFileReqs=reqs.filter(r=>r.requirement_type==='file'&&r.required!==false),pending=pendingFileRequirements();
 pendingUploadCount.textContent=pending.length?'('+pending.length+')':'';
 pendingUploadBtn.style.display=allFileReqs.length?'inline-flex':'none';
 if(!allFileReqs.length){pendingUploads.innerHTML='<div class="meta">No hay requisitos de archivo definidos.</div>';return}
 pendingUploads.innerHTML=allFileReqs.map(r=>{
  const task=taskForReq(r),v=reqValue(r.id),done=!!v?.file_path,t=docTemplate(r.code);
  const helper=t?.helper_text||r.detail||'';
  const hidden='<input class="fileInput" id="'+fileInputId(r.id)+'" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" onchange="updatePendingName(\''+r.id+'\')">';
  const chosen='<span class="fileName" id="pending_name_'+r.id+'">'+(done?'':'Ningún archivo seleccionado')+'</span>';
  const upload='<button class="btn" id="pending_btn_'+r.id+'" onclick="uploadPendingFile(\''+r.id+'\')">⬆ '+(done?'Subir reemplazo':'Subir archivo')+'</button>';
  return '<div class="uploadItem '+(r.sensitive?'sensitive':'')+'"><div class="uploadTop"><div><b>'+esc(task?.code||'')+' · '+esc(r.title)+'</b><div class="meta">'+esc(helper)+(r.sensitive?'<br>🔒 Documento sensible · almacenamiento privado':'')+'</div></div><span class="badge '+(done?'done':'progress')+'">'+(done?'CARGADO':'PENDIENTE')+'</span></div>'+
   (done?'<div class="fileName">📄 '+esc(v.file_name||'Archivo cargado')+(v.completed_at?' · '+new Date(v.completed_at).toLocaleString('es-CL'):'')+'</div>':'')+
   hidden+'<div class="reqActions">'+(done?'<button class="btn sec" onclick="openPendingFile(\''+r.id+'\')">👁 Ver archivo</button>':'')+assistantButtons(r,t,done)+chosen+upload+'</div></div>'
 }).join('')
}
function statusClass(s){return s==='done'?'done':s==='blocked'?'blocked':'progress'}
function statusLabel(s){return s==='done'?'COMPLETADA':s==='blocked'?'BLOQUEADA':s==='waiting'?'PENDIENTE':'EN PROCESO'}function taskStatusOptions(current){
 const opts=[
  ['waiting','PENDIENTE'],['in_progress','EN PROCESO'],['blocked','BLOQUEADA'],['done','COMPLETADA']
 ];
 return opts.map(([v,l])=>'<option value="'+v+'" '+(v===current?'selected':'')+'>'+l+'</option>').join('')
}
function editId(prefix,id){return prefix+'_'+String(id).replaceAll('-','_')}
async function saveTaskManagement(id){
 const t=tasks.find(x=>x.id===id);if(!t)return;
 const owner=document.getElementById(editId('owner',id)).value.trim()||null;
 const due=document.getElementById(editId('due',id)).value||null;
 const status=document.getElementById(editId('status',id)).value;
 const notes=document.getElementById(editId('notes',id)).value.trim()||null;
 const payload={owner_name:owner,due_date:due,status,notes,updated_at:new Date().toISOString()};
 const {error}=await sb.from('tasks').update(payload).eq('id',id);
 if(error)return alert('No se pudo guardar: '+error.message);
 const state=document.getElementById(editId('saved',id));if(state)state.textContent='✓ Guardado';
 await loadData()
}

function renderTask(t){
 const rs=reqs.filter(x=>x.entity_id===t.id);
 const manage='<div class="taskEdit"><div><label>Persona a cargo</label><input id="'+editId('owner',t.id)+'" value="'+esc(t.owner_name||'')+'" placeholder="Ej.: Patricia Acuña / Secretaría / Nicole"></div><div><label>Fecha objetivo</label><input id="'+editId('due',t.id)+'" type="date" value="'+esc(t.due_date||'')+'"></div><div><label>Estado</label><select id="'+editId('status',t.id)+'">'+taskStatusOptions(t.status)+'</select></div><div class="wide"><label>Notas / gestión / información que falta</label><textarea id="'+editId('notes',t.id)+'" placeholder="Escribe aquí avances, acuerdos, a quién se pidió el documento, teléfono/correo si corresponde, próxima gestión, etc.">'+esc(t.notes||'')+'</textarea></div><div class="wide actions"><button class="btn" onclick="saveTaskManagement(\''+t.id+'\')">💾 Guardar avance</button><span class="saveState" id="'+editId('saved',t.id)+'"></span></div></div>';
 return '<div class="task"><div class="row"><div><b>'+esc(t.code)+' · '+esc(t.title)+'</b><div class="meta">'+(t.owner_name?'Responsable: '+esc(t.owner_name):'Sin responsable')+(t.due_date?' · Fecha objetivo: '+new Date(t.due_date+'T12:00:00').toLocaleDateString('es-CL'):'')+'</div></div><span class="badge '+statusClass(t.status)+'">'+statusLabel(t.status)+' · '+Number(t.progress||0)+'%</span></div>'+manage+
 (rs.length?rs.map(r=>{const v=reqValue(r.id),done=r.requirement_type==='file'&&!!v?.file_path,tpl=docTemplate(r.code);return '<div class="req"><div class="reqHead"><div><b>'+esc(r.required?'REQUERIDO · ':'')+esc(r.title)+'</b><div class="meta">'+esc(tpl?.helper_text||r.detail||'')+(r.sensitive?' · 🔒 Documento sensible':'')+'</div></div>'+(r.requirement_type==='file'?'<span class="badge '+(done?'done':'progress')+'">'+(done?'CARGADO':'PENDIENTE')+'</span>':'')+'</div>'+(r.requirement_type==='file'?'<div class="reqActions">'+(done?'<button class="btn sec" onclick="openPendingFile(\''+r.id+'\')">👁 Ver</button>':'')+assistantButtons(r,tpl,done)+'</div>':'')+'</div>'}).join(''):'')+
 '<div class="actions">'+(t.code==='DS22-10'?'<a class="btn sec" href="proteccion.html">Subir respaldo de ratificación</a>':'')+(t.code==='DISC-01'?'<a class="btn sec" href="disciplina.html">Registrar integrantes</a>':'')+(t.code==='DISC-02'?'<a class="btn sec" href="disciplina.html">Abrir reglamento / documentos</a>':'')+(t.code==='DS22-08'?'<a class="btn sec" href="../ds22-comunidad.html">Ver / compartir guía DS22</a>':'')+'</div></div>'
}
function render(){
 const d=tasks.filter(t=>t.code.startsWith('DS22-')),x=tasks.filter(t=>t.code.startsWith('DISC-'));
 ds22.innerHTML=d.map(renderTask).join('');disc.innerHTML=x.map(renderTask).join('');renderPendingUploads();
 const done=tasks.filter(t=>t.status==='done').length,progress=tasks.filter(t=>['in_progress','waiting'].includes(t.status)).length,blocked=tasks.filter(t=>t.status==='blocked').length;
 kDone.textContent=done;kProgress.textContent=progress;kBlocked.textContent=blocked;
 const activationBlockers=tasks.filter(t=>['DS22-05','DS22-06','DS22-07','DS22-08','DS22-10','DS22-11','DS22-12','DISC-01','DISC-02','DISC-03'].includes(t.code)&&t.status!=='done');
 kReady.textContent=activationBlockers.length?'NO':'SÍ';
 kReady.style.color=activationBlockers.length?'#991b1b':'#166534';
 const priority=['DS22-10','DISC-01','DISC-02','DS22-05','DS22-06','DS22-07','DS22-08','DS22-12','DS22-11','DISC-03'];
 const n=priority.map(code=>tasks.find(t=>t.code===code&&t.status!=='done')).find(Boolean);
 next.innerHTML=n?'<b>'+esc(n.code)+' · '+esc(n.title)+'</b><div class="meta">'+esc(n.notes||'')+'</div><div class="actions">'+(n.code==='DISC-01'||n.code==='DISC-02'?'<a class="btn" href="disciplina.html">Resolver ahora</a>':'<a class="btn" href="proteccion.html">Ir a Protección / DS22</a>')+'</div>':'<div class="notice"><b>Todo listo para activación institucional.</b> Verifica usuarios y permisos antes de enviar accesos.</div>'
}