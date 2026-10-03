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
 if(!profile?.active||!ADMIN.includes(profile.role))return;
 const add=$('#ccAddDocument');if(add)add.hidden=false;
 const roles=$('#ccAddRoles');if(roles&&!roles.children.length){
   for(const [value,label] of READ_ROLES){const l=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.name='ccReadRole';c.value=value;if(value==='superadmin'){c.checked=true;c.disabled=true;}l.append(c,document.createTextNode(' '+label));roles.append(l);}
 }
 const cats=[...new Set([...document.querySelectorAll('#ccDocCategory option')].map(o=>o.value).filter(Boolean))];
 const dl=$('#ccAddCategoryList');if(dl){dl.replaceChildren();for(const c of cats)dl.append(new Option(c,c));}
 applyDefaults();
 $('#ccAddOriginal')?.addEventListener('change',setWordFields);
 $('#ccAddCategory')?.addEventListener('change',applyDefaults);
 $('#ccAddOpen')?.addEventListener('click',()=>{$('#ccAddPanel').hidden=false;$('#ccAddTitle').focus();});
 $('#ccAddCancel')?.addEventListener('click',()=>{$('#ccAddPanel').hidden=true;$('#ccAddForm').reset();setWordFields();applyDefaults();msg('');});
 $('#ccAddForm')?.addEventListener('submit',submit);
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,300),{once:true});else setTimeout(init,300);
})();