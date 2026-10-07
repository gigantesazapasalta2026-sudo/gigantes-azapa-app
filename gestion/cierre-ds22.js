const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
let tasks=[],reqs=[],vals=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
(async()=>{
 const {data:{session}}=await sb.auth.getSession();if(!session){location.href='login.html?next=cierre-ds22.html';return}
 const {data:p}=await sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle();
 if(!p?.active||!['superadmin','board'].includes(p.role)){document.body.innerHTML='<main class="main wrap"><div class="card">Acceso sólo para Directiva / Superadmin.</div></main>';return}
 await loadData();
})();
async function loadData(){
 const [{data:t,error:te},{data:r,error:re},{data:v,error:ve}]=await Promise.all([
  sb.from('tasks').select('id,code,title,priority,status,progress,owner_name,notes').or('code.like.DS22-%,code.like.DISC-%').order('code'),
  sb.from('control_item_requirements').select('id,entity_id,code,title,detail,requirement_type,required,sensitive,source,sort_order').eq('entity_type','task').order('sort_order'),
  sb.from('control_requirement_values').select('requirement_id,file_path,file_name,completed_at')
 ]);
 if(te||re||ve){document.getElementById('pendingUploads').innerHTML='<div class="notice">No se pudieron cargar los antecedentes pendientes.</div>';return}
 tasks=t||[];reqs=(r||[]).filter(x=>tasks.some(t=>t.id===x.entity_id));vals=(v||[]).filter(x=>reqs.some(r=>r.id===x.requirement_id));render()
}
function reqValue(id){return vals.find(v=>v.requirement_id===id)||null}
function reqDone(r){const v=reqValue(r.id);return r.requirement_type==='file'&&!!v?.file_path}
function taskForReq(r){return tasks.find(t=>t.id===r.entity_id)}
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
  const t=taskForReq(r),v=reqValue(r.id),done=!!v?.file_path;
  return '<div class="uploadItem '+(r.sensitive?'sensitive':'')+'"><div class="uploadTop"><div><b>'+esc(t?.code||'')+' · '+esc(r.title)+'</b><div class="meta">'+esc(r.detail||'')+(r.sensitive?'<br>🔒 Documento sensible · almacenamiento privado':'')+'</div></div><span class="badge '+(done?'done':'progress')+'">'+(done?'CARGADO':'PENDIENTE')+'</span></div>'+
   (done?'<div class="fileName">📄 '+esc(v.file_name||'Archivo cargado')+(v.completed_at?' · '+new Date(v.completed_at).toLocaleString('es-CL'):'')+'</div><div class="reqActions"><button class="btn sec" onclick="openPendingFile(\''+r.id+'\')">Ver archivo</button><button class="btn sec" onclick="pickPendingFile(\''+r.id+'\')">Reemplazar</button><input class="fileInput" id="'+fileInputId(r.id)+'" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" onchange="updatePendingName(\''+r.id+'\')"><span class="fileName" id="pending_name_'+r.id+'"></span><button class="btn" id="pending_btn_'+r.id+'" onclick="uploadPendingFile(\''+r.id+'\')">⬆ Subir reemplazo</button></div>':
   '<input class="fileInput" id="'+fileInputId(r.id)+'" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" onchange="updatePendingName(\''+r.id+'\')"><div class="reqActions"><button class="btn sec" onclick="pickPendingFile(\''+r.id+'\')">📎 Seleccionar archivo</button><span class="fileName" id="pending_name_'+r.id+'">Ningún archivo seleccionado</span><button class="btn" id="pending_btn_'+r.id+'" onclick="uploadPendingFile(\''+r.id+'\')">⬆ Subir archivo</button></div>')+
  '</div>'
 }).join('')
}
function statusClass(s){return s==='done'?'done':s==='blocked'?'blocked':'progress'}
function statusLabel(s){return s==='done'?'COMPLETADA':s==='blocked'?'BLOQUEADA':s==='waiting'?'PENDIENTE':'EN PROCESO'}
function renderTask(t){
 const rs=reqs.filter(x=>x.entity_id===t.id);
 return '<div class="task"><div class="row"><div><b>'+esc(t.code)+' · '+esc(t.title)+'</b><div class="meta">'+esc(t.owner_name||'Sin responsable')+' · '+esc(t.notes||'')+'</div></div><span class="badge '+statusClass(t.status)+'">'+statusLabel(t.status)+' · '+Number(t.progress||0)+'%</span></div>'+
 (rs.length?rs.map(r=>{const v=reqValue(r.id),done=r.requirement_type==='file'&&!!v?.file_path;return '<div class="req"><div class="reqHead"><div><b>'+esc(r.required?'REQUERIDO · ':'')+esc(r.title)+'</b><div class="meta">'+esc(r.detail||'')+(r.sensitive?' · 🔒 Documento sensible':'')+'</div></div>'+(r.requirement_type==='file'?'<span class="badge '+(done?'done':'progress')+'">'+(done?'CARGADO':'PENDIENTE')+'</span>':'')+'</div>'+(r.requirement_type==='file'?'<div class="reqActions">'+(done?'<button class="btn sec" onclick="openPendingFile(\''+r.id+'\')">Ver</button>':'')+'<button class="btn sec" onclick="scrollPending();setTimeout(()=>pickPendingFile(\''+r.id+'\'),250)">📎 '+(done?'Reemplazar':'Cargar archivo')+'</button></div>':'')+'</div>'}).join(''):'')+
 '<div class="actions">'+(t.code==='DS22-10'?'<a class="btn sec" href="proteccion.html">Subir respaldo de ratificación</a>':'')+(t.code==='DISC-01'?'<a class="btn sec" href="disciplina.html">Registrar integrantes</a>':'')+(t.code==='DISC-02'?'<a class="btn sec" href="disciplina.html">Abrir reglamento / documentos</a>':'')+(t.code==='DS22-08'?'<a class="btn sec" href="../ds22-comunidad.html">Ver / compartir guía DS22</a>':'')+(t.code==='DS22-12'?'<a class="btn sec" href="../proteccion.html">Revisar versión pública</a>':'')+'</div></div>'
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