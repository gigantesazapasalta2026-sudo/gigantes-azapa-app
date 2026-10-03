(()=>{
'use strict';
const ADMIN=['superadmin','board'];
const READ_ROLES=[
 ['superadmin','Administración general'],
 ['board','Directiva'],
 ['treasury','Tesorería'],
 ['coach','Entrenadores'],
 ['commission','Comisiones']
];
const BUCKET='control-documents-private';
const WORD='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let sb,profile,user,busy=false;
const $=s=>document.querySelector(s);
const esc=s=>String(s||'').trim();
function msg(t,ok=false){const n=$('#ccAddStatus');if(n){n.textContent=t;n.dataset.ok=ok?'1':'0';}}
function ext(name){return String(name||'').toLowerCase().split('.').pop();}
async function pdfOK(file){if(!file||ext(file.name)!=='pdf')return false;const h=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());return h==='%PDF-';}
async function docxOK(file){if(!file||ext(file.name)!=='docx')return false;const b=new Uint8Array(await file.slice(0,4).arrayBuffer());return b[0]===0x50&&b[1]===0x4b;}
function setWordFields(){const f=$('#ccAddOriginal'),wrap=$('#ccAddPdfWrap'),pdf=$('#ccAddPdf');if(!f)return;const isWord=ext(f.files?.[0]?.name)==='docx';wrap.hidden=!isWord;pdf.required=isWord;if(!isWord)pdf.value='';}
function categoryDefaults(category){
 const c=String(category||'').toLowerCase();
 const isTreasury=c.includes('tesorer');
 return {
   allowed:isTreasury?['superadmin','board','treasury']:['superadmin','board','commission'],
   editors:isTreasury?['superadmin','board','treasury']:['superadmin','board']
 };
}
function applyDefaults(){
 const d=categoryDefaults($('#ccAddCategory').value);
 document.querySelectorAll('[name="ccReadRole"]').forEach(x=>x.checked=d.allowed.includes(x.value));
}
async function init(){
 if(!window.supabase||!window.GIGANTES_SUPABASE_URL)return;
 sb=window.GIGANTES_DB||supabase.createClient(window.GIGANTES_SUPABASE_URL,window.GIGANTES_SUPABASE_PUBLISHABLE_KEY);
 const u=await sb.auth.getUser();user=u.data?.user;if(!user)return;
 const p=await sb.from('profiles').select('role,active').eq('user_id',user.id).maybeSingle();profile=p.data;
 if(!profile?.active)return;
 const add=$('#ccAddDocument');if(add)add.hidden=!ADMIN.includes(profile.role);
 const roles=$('#ccAddRoles');if(roles&&!roles.children.length){
   for(const [value,label] of READ_ROLES){const l=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.name='ccReadRole';c.value=value;if(value==='superadmin'){c.checked=true;c.disabled=true;}l.append(c,document.createTextNode(' '+label));roles.append(l);}
 }
 const cats=[...new Set([...document.querySelectorAll('#ccDocCategory option')].map(o=>o.value).filter(Boolean))];
 const dl=$('#ccAddCategoryList');if(dl){dl.replaceChildren();for(const c of cats)dl.append(new Option(c,c));}
 applyDefaults();
 $('#ccAddOriginal')?.addEventListener('change',setWordFields);
 $('#ccAddCategory')?.addEventListener('change',applyDefaults);
 $('#ccAddDocument')?.addEventListener('click',()=>{$('#ccAddPanel').hidden=false;$('#ccAddTitle').focus();});
 $('#ccAddCancel')?.addEventListener('click',()=>{$('#ccAddPanel').hidden=true;$('#ccAddForm').reset();setWordFields();applyDefaults();msg('');});
 $('#ccAddForm')?.addEventListener('submit',submit);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-cc-action]');if(!b)return;if(b.dataset.ccAction==='updateversion'){e.preventDefault();openVersionDialog(b.dataset.ccKey);}else if(b.dataset.ccAction==='editmeta'){e.preventDefault();openMetaDialog(b.dataset.ccKey);}});
}
async function submit(e){
 e.preventDefault();if(busy)return;busy=true;
 const save=$('#ccAddSave');save.disabled=true;
 try{
  const check=await sb.auth.getUser();if(check.error||check.data?.user?.id!==user.id)throw new Error('Tu sesión cambió. Vuelve a iniciar sesión.');
  const title=esc($('#ccAddTitle').value),category=esc($('#ccAddCategory').value),original=$('#ccAddOriginal').files?.[0],pdf=$('#ccAddPdf').files?.[0];
  if(title.length<2||title.length>180)throw new Error('Revisa el nombre del documento.');
  if(category.length<2||category.length>120)throw new Error('Indica un área válida.');
  if(!original)throw new Error('Selecciona el documento original.');
  if(original.size>25*1024*1024)throw new Error('El archivo original supera 25 MB.');
  const originalExt=ext(original.name);
  if(!['pdf','docx'].includes(originalExt))throw new Error('Por ahora se admiten archivos PDF y Word (.docx).');
  if(originalExt==='pdf'&&!(await pdfOK(original)))throw new Error('El archivo seleccionado no es un PDF válido.');
  if(originalExt==='docx'&&!(await docxOK(original)))throw new Error('El archivo seleccionado no es un Word .docx válido.');
  let viewPdf=original;
  if(originalExt==='docx'){
    if(!pdf)throw new Error('Para un Word selecciona también su PDF de lectura.');
    if(pdf.size>25*1024*1024||!(await pdfOK(pdf)))throw new Error('El PDF de lectura no es válido o supera 25 MB.');
    viewPdf=pdf;
  }
  const allowed=['superadmin',...Array.from(document.querySelectorAll('[name="ccReadRole"]:checked')).map(x=>x.value).filter(x=>x!=='superadmin')];
  const d=categoryDefaults(category);
  const id=crypto.randomUUID();
  const now=new Date().toISOString();
  msg('Creando ficha del documento...');
  const row={
    id,title,category,source_code:null,original_name:original.name,original_ext:originalExt,
    source_url:'app://library/'+id,source_status:'available',
    allowed_roles:[...new Set(allowed)],treasury_unit_id:null,imported_at:null,
    editor_roles:d.editors,delete_roles:['superadmin'],current_version:1,updated_at:now,deleted_at:null,deleted_by:null
  };
  const ins=await sb.from('control_document_catalog').insert(row).select('id').single();
  if(ins.error)throw new Error('No se pudo crear la ficha: '+ins.error.message);
  const folder=id+'/v1';
  msg('Subiendo PDF de lectura...');
  const upPdf=await sb.storage.from(BUCKET).upload(folder+'/document.pdf',viewPdf,{contentType:'application/pdf',cacheControl:'0',upsert:false});
  if(upPdf.error)throw new Error('La ficha quedó creada, pero falló la carga del PDF. No vuelvas a crearla; avisa al administrador.');
  let originalPath=folder+'/document.pdf';
  if(originalExt==='docx'){
    msg('Subiendo Word original...');
    originalPath=folder+'/original.docx';
    const upDoc=await sb.storage.from(BUCKET).upload(originalPath,original,{contentType:WORD,cacheControl:'0',upsert:false});
    if(upDoc.error)throw new Error('El PDF quedó cargado, pero falló el Word original. La ficha quedó pendiente.');
  }
  msg('Registrando versión inicial...');
  const ver=await sb.from('control_document_versions').insert({
    document_id:id,version_no:1,pdf_path:folder+'/document.pdf',original_path:originalPath,
    original_name:original.name,original_ext:originalExt,created_by:user.id,note:'Documento agregado desde la Biblioteca del Control Center'
  });
  if(ver.error)throw new Error('Los archivos se cargaron, pero no se pudo registrar la versión.');
  const fin=await sb.from('control_document_catalog').update({imported_at:now,updated_at:now}).eq('id',id).is('imported_at',null).select('id');
  if(fin.error||fin.data?.length!==1)throw new Error('Los archivos quedaron guardados, pero falta activar el documento.');
  msg('Documento agregado correctamente.',true);
  $('#ccAddForm').reset();setWordFields();applyDefaults();
  setTimeout(()=>location.reload(),700);
 }catch(err){msg(err.message||'No fue posible agregar el documento.');}
 finally{busy=false;save.disabled=false;}
}


function closeMetaDialog(){document.getElementById('ccMetaDialog')?.remove();}
function metaDialogShell(doc){
 closeMetaDialog();
 const d=document.createElement('dialog');d.id='ccMetaDialog';d.className='cc-version-dialog';
 d.innerHTML='<form id="ccMetaForm" method="dialog"><div class="cc-version-head"><div><strong>Editar ficha</strong><p></p></div><button type="button" class="cc-doc-btn" id="ccMetaClose">Cerrar</button></div><div class="cc-version-body"><label>Nombre del documento<input id="ccMetaTitle" maxlength="180" required></label><label>Área<input id="ccMetaCategory" maxlength="120" required list="ccMetaCategoryList"><datalist id="ccMetaCategoryList"></datalist></label><label>Estado<select id="ccMetaStatus"><option value="available">Disponible</option><option value="needs_refresh">Requiere renovación</option><option value="reference">Referencia</option><option value="draft">Borrador</option><option value="pending">Pendiente de validación</option><option value="missing">Falta documento</option><option value="archived">Histórico</option></select></label><fieldset id="ccMetaRead"><legend>Puede ver</legend></fieldset><fieldset id="ccMetaEdit"><legend>Puede editar / subir versiones</legend></fieldset><p id="ccMetaStatusText" role="status" aria-live="polite"></p><div class="cc-version-actions"><button type="button" class="cc-doc-btn" id="ccMetaCancel">Cancelar</button><button type="submit" class="cc-doc-btn cc-doc-primary" id="ccMetaSave">Guardar cambios</button></div></div></form>';
 d.querySelector('.cc-version-head p').textContent='v'+doc.current_version+' · el archivo no se modifica';
 d.dataset.documentId=doc.id;
 const title=d.querySelector('#ccMetaTitle'),category=d.querySelector('#ccMetaCategory'),status=d.querySelector('#ccMetaStatus');
 title.value=doc.title||'';category.value=doc.category||'';status.value=doc.source_status||'available';
 const cats=[...new Set([...document.querySelectorAll('#ccDocCategory option')].map(o=>o.value).filter(Boolean).concat([doc.category]).filter(Boolean))];
 const dl=d.querySelector('#ccMetaCategoryList');for(const c of cats)dl.append(new Option(c,c));
 const labels={superadmin:'Administración general',board:'Directiva',treasury:'Tesorería',coach:'Entrenadores',commission:'Comisiones'};
 for(const role of ['superadmin','board','treasury','coach','commission']){
   const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=role;c.name='ccMetaReadRole';c.checked=(doc.allowed_roles||[]).includes(role);if(role==='superadmin'){c.checked=true;c.disabled=true;}l.append(c,document.createTextNode(' '+labels[role]));d.querySelector('#ccMetaRead').append(l);
 }
 for(const role of ['superadmin','board','treasury']){
   const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=role;c.name='ccMetaEditRole';c.checked=(doc.editor_roles||[]).includes(role);if(role==='superadmin'){c.checked=true;c.disabled=true;}l.append(c,document.createTextNode(' '+labels[role]));d.querySelector('#ccMetaEdit').append(l);
 }
 d.querySelector('#ccMetaClose').onclick=closeMetaDialog;d.querySelector('#ccMetaCancel').onclick=closeMetaDialog;
 d.querySelector('#ccMetaForm').addEventListener('submit',saveMeta);
 d.addEventListener('cancel',e=>{e.preventDefault();closeMetaDialog();});
 document.body.append(d);d.showModal();return d;
}
async function openMetaDialog(key){
 try{
  if(!key?.startsWith('doc:'))throw new Error('Documento no válido.');
  const id=key.slice(4),check=await sb.auth.getUser();
  if(check.error||check.data?.user?.id!==user.id)throw new Error('Tu sesión cambió. Vuelve a iniciar sesión.');
  const q=await sb.from('control_document_catalog').select('*').eq('id',id).maybeSingle();
  if(q.error||!q.data||q.data.deleted_at)throw new Error('Documento no disponible.');
  if(!(q.data.editor_roles||[]).includes(profile.role))throw new Error('Tu cuenta no tiene permiso para editar esta ficha.');
  metaDialogShell(q.data);
 }catch(err){alert(err.message||'No fue posible abrir la ficha.');}
}
async function saveMeta(e){
 e.preventDefault();if(busy)return;busy=true;
 const d=document.getElementById('ccMetaDialog'),save=d.querySelector('#ccMetaSave'),statusText=d.querySelector('#ccMetaStatusText');save.disabled=true;
 const say=t=>statusText.textContent=t;
 try{
  const check=await sb.auth.getUser();if(check.error||check.data?.user?.id!==user.id)throw new Error('Tu sesión cambió. Vuelve a iniciar sesión.');
  const id=d.dataset.documentId,title=esc(d.querySelector('#ccMetaTitle').value),category=esc(d.querySelector('#ccMetaCategory').value),source_status=d.querySelector('#ccMetaStatus').value;
  if(title.length<2||title.length>180)throw new Error('Revisa el nombre del documento.');
  if(category.length<2||category.length>120)throw new Error('Indica un área válida.');
  const allowed=['superadmin',...Array.from(d.querySelectorAll('[name="ccMetaReadRole"]:checked')).map(x=>x.value).filter(x=>x!=='superadmin')];
  const editors=['superadmin',...Array.from(d.querySelectorAll('[name="ccMetaEditRole"]:checked')).map(x=>x.value).filter(x=>x!=='superadmin')];
  let treasuryUnit=null;
  if(category==='Tesorería Club'||category==='Tesorería Classic'){
   const code=category==='Tesorería Club'?'GIGANTES':'CLASSIC_ADULTA';
   const t=await sb.from('treasury_units').select('id').eq('code',code).maybeSingle();
   if(t.error||!t.data?.id)throw new Error('No se pudo identificar la unidad de '+category+'.');
   treasuryUnit=t.data.id;
   if(!allowed.includes('treasury'))allowed.push('treasury');
   if(!editors.includes('treasury'))editors.push('treasury');
  }
  const latest=await sb.from('control_document_catalog').select('editor_roles,deleted_at').eq('id',id).maybeSingle();
  if(latest.error||!latest.data||latest.data.deleted_at)throw new Error('Documento no disponible.');
  if(!(latest.data.editor_roles||[]).includes(profile.role))throw new Error('Ya no tienes permiso para editar esta ficha.');
  say('Guardando cambios...');
  const up=await sb.from('control_document_catalog').update({
   title,category,source_status,allowed_roles:[...new Set(allowed)],editor_roles:[...new Set(editors)],treasury_unit_id:treasuryUnit,updated_at:new Date().toISOString()
  }).eq('id',id).select('id,title');
  if(up.error||up.data?.length!==1)throw new Error(up.error?.message||'No se pudieron guardar los cambios.');
  say('Ficha actualizada correctamente.');
  setTimeout(()=>location.reload(),600);
 }catch(err){say(err.message||'No fue posible actualizar la ficha.');}
 finally{busy=false;save.disabled=false;}
}

function closeVersionDialog(){document.getElementById('ccVersionDialog')?.remove();}
function versionDialogShell(doc){
 closeVersionDialog();
 const d=document.createElement('dialog');d.id='ccVersionDialog';d.className='cc-version-dialog';
 d.innerHTML='<form id="ccVersionForm" method="dialog"><div class="cc-version-head"><div><strong></strong><p></p></div><button type="button" class="cc-doc-btn" id="ccVersionClose">Cerrar</button></div><div class="cc-version-body"><label>Documento original<input id="ccVersionOriginal" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required></label><label id="ccVersionPdfWrap" hidden>PDF de lectura<input id="ccVersionPdf" type="file" accept=".pdf,application/pdf"><span>Necesario cuando el original es Word.</span></label><label>Nota de cambios<textarea id="ccVersionNote" maxlength="500" placeholder="Ej.: Se actualizó nómina, fechas y responsables"></textarea></label><p id="ccVersionStatus" role="status" aria-live="polite"></p><div class="cc-version-actions"><button type="button" class="cc-doc-btn" id="ccVersionCancel">Cancelar</button><button type="submit" class="cc-doc-btn cc-doc-primary" id="ccVersionSave">Publicar nueva versión</button></div></div></form>';
 d.querySelector('strong').textContent=doc.title;
 d.querySelector('.cc-version-head p').textContent='Versión actual v'+doc.current_version+' → nueva v'+(Number(doc.current_version)+1);
 d.dataset.documentId=doc.id;d.dataset.expectedVersion=String(doc.current_version);
 document.body.append(d);
 const original=d.querySelector('#ccVersionOriginal'),wrap=d.querySelector('#ccVersionPdfWrap'),pdf=d.querySelector('#ccVersionPdf');
 original.addEventListener('change',()=>{const word=ext(original.files?.[0]?.name)==='docx';wrap.hidden=!word;pdf.required=word;if(!word)pdf.value='';});
 d.querySelector('#ccVersionClose').onclick=closeVersionDialog;
 d.querySelector('#ccVersionCancel').onclick=closeVersionDialog;
 d.querySelector('#ccVersionForm').addEventListener('submit',publishVersion);
 d.addEventListener('cancel',e=>{e.preventDefault();closeVersionDialog();});
 d.showModal();return d;
}
async function openVersionDialog(key){
 try{
  if(!key?.startsWith('doc:'))throw new Error('Documento no válido.');
  const id=key.slice(4),check=await sb.auth.getUser();
  if(check.error||check.data?.user?.id!==user.id)throw new Error('Tu sesión cambió. Vuelve a iniciar sesión.');
  const q=await sb.from('control_document_catalog').select('id,title,current_version,editor_roles,deleted_at').eq('id',id).maybeSingle();
  if(q.error||!q.data||q.data.deleted_at)throw new Error('Documento no disponible.');
  if(!(q.data.editor_roles||[]).includes(profile.role))throw new Error('Tu cuenta no tiene permiso para actualizar este documento.');
  versionDialogShell(q.data);
 }catch(err){alert(err.message||'No fue posible abrir la actualización.');}
}
async function publishVersion(e){
 e.preventDefault();if(busy)return;busy=true;
 const d=document.getElementById('ccVersionDialog'),save=d.querySelector('#ccVersionSave'),status=d.querySelector('#ccVersionStatus');
 save.disabled=true;
 const setStatus=t=>status.textContent=t;
 try{
  const check=await sb.auth.getUser();if(check.error||check.data?.user?.id!==user.id)throw new Error('Tu sesión cambió. Vuelve a iniciar sesión.');
  const id=d.dataset.documentId,expected=Number(d.dataset.expectedVersion),original=d.querySelector('#ccVersionOriginal').files?.[0],pdf=d.querySelector('#ccVersionPdf').files?.[0],note=esc(d.querySelector('#ccVersionNote').value);
  if(!original)throw new Error('Selecciona el documento actualizado.');
  if(original.size>25*1024*1024)throw new Error('El archivo original supera 25 MB.');
  const originalExt=ext(original.name);
  if(!['pdf','docx'].includes(originalExt))throw new Error('Solo se admiten PDF y Word (.docx).');
  if(originalExt==='pdf'&&!(await pdfOK(original)))throw new Error('El archivo seleccionado no es un PDF válido.');
  if(originalExt==='docx'&&!(await docxOK(original)))throw new Error('El archivo seleccionado no es un Word .docx válido.');
  let viewPdf=original;
  if(originalExt==='docx'){
   if(!pdf)throw new Error('Selecciona también el PDF de lectura.');
   if(pdf.size>25*1024*1024||!(await pdfOK(pdf)))throw new Error('El PDF de lectura no es válido o supera 25 MB.');
   viewPdf=pdf;
  }
  const latest=await sb.from('control_document_catalog').select('current_version,editor_roles,deleted_at').eq('id',id).maybeSingle();
  if(latest.error||!latest.data||latest.data.deleted_at)throw new Error('Documento no disponible.');
  if(!(latest.data.editor_roles||[]).includes(profile.role))throw new Error('Ya no tienes permiso para actualizar este documento.');
  if(Number(latest.data.current_version)!==expected)throw new Error('Ya existe una versión más nueva. Recarga la biblioteca antes de continuar.');
  const next=expected+1,folder=id+'/v'+next;
  setStatus('Subiendo PDF de lectura...');
  const upPdf=await sb.storage.from(BUCKET).upload(folder+'/document.pdf',viewPdf,{contentType:'application/pdf',cacheControl:'0',upsert:false});
  if(upPdf.error)throw new Error('No se pudo cargar el PDF de la nueva versión. Recarga y vuelve a intentarlo.');
  if(originalExt==='docx'){
   setStatus('Subiendo Word original...');
   const upDoc=await sb.storage.from(BUCKET).upload(folder+'/original.docx',original,{contentType:WORD,cacheControl:'0',upsert:false});
   if(upDoc.error)throw new Error('El PDF se cargó, pero no se pudo cargar el Word. No se publicó la nueva versión.');
  }
  setStatus('Publicando versión v'+next+'...');
  const rpc=await sb.rpc('publish_control_document_version',{
   p_document_id:id,p_expected_version:expected,p_original_name:original.name,p_original_ext:originalExt,p_note:note||null
  });
  if(rpc.error)throw new Error(rpc.error.message||'No se pudo publicar la nueva versión.');
  setStatus('Versión v'+rpc.data+' publicada correctamente.');
  setTimeout(()=>location.reload(),700);
 }catch(err){setStatus(err.message||'No fue posible publicar la nueva versión.');}
 finally{busy=false;save.disabled=false;}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,300),{once:true});else setTimeout(init,300);
})();