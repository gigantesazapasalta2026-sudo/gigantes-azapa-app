/* Private PDF preview and original DOCX download. No document contents or credentials in this file. */
(()=>{
'use strict';
if(window.GIGANTES_INVENTORY_DOCUMENTS)return;
window.GIGANTES_INVENTORY_DOCUMENTS=true;
const BUCKET='inventory-documents-private';
const WORD='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ARCHIVE='18a86cc09f4c59b554a9fbed408542367151efedff8d421a76d9451fa47d702e';
const NAMES=['60_Caja_Fisica_Evento_Caja_Tickets_Gigantes','61_Caja_Cocina_Parrilla_Gigantes','62_Caja_Electrica_Audio_Gigantes','63_Caja_Deportiva_Gigantes','64_Caja_Seguridad_Primeros_Auxilios_Gigantes','65_Caja_Comunicaciones_Sponsors_Gigantes'];
const STAFF=['superadmin','board','treasury','coach','commission'];
const ADMIN=['superadmin','board'];
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const button=(label,action,code)=>{const e=text('button',label,'btn secondary');e.type='button';e.dataset.inventoryAction=action;if(code)e.dataset.boxCode=code;return e;};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
const codes=NAMES.map((_,i)=>'BOX'+String(i+1).padStart(2,'0'));
let importing=false,pdfUrl=null,dialog=null,message='';
function boxData(){return typeof db!=='undefined'&&Array.isArray(db.inventoryBoxes)?db.inventoryBoxes:[];}
function ready(b){const d=b?.document_snapshot;return d?.bucket===BUCKET&&d.pdf_path&&d.word_path;}
function setMessage(value){message=value;document.querySelectorAll('.inventory-doc-status').forEach(e=>e.textContent=value);}
function decorate(){
 const app=document.getElementById('app');if(!app)return;
 const panel=[...app.querySelectorAll('.panel')].find(p=>p.querySelector('h2')?.textContent.includes('Cajas operativas'));
 if(!panel)return;
 for(const row of panel.querySelectorAll('.row')){
  const code=row.querySelector(':scope > b')?.textContent.trim();if(!codes.includes(code)||row.dataset.inventoryDocuments)continue;
  row.dataset.inventoryDocuments='1';row.classList.add('inventory-box-row');
  const old=row.querySelector(':scope > small');if(old)old.remove();
  const actions=document.createElement('div');actions.className='inventory-document-actions';
  const b=boxData().find(x=>x.code===code),available=ready(b);
  const view=button('Ver documento (PDF)','view',code),download=button('Descargar documento (Word)','download',code);
  view.className='btn primary';view.disabled=download.disabled=!available;
  actions.append(view,download);
  if(!available)actions.append(text('span','Pendiente de carga inicial','inventory-pending'));
  row.append(actions);
 }
 if(!panel.querySelector('.inventory-doc-toolbar')){
  const bar=document.createElement('div');bar.className='inventory-doc-toolbar';
  bar.append(text('p','PDF para consultar y Word original para descargar. Acceso con la sesi\u00f3n del Control Center.'));
  if(ADMIN.includes(window.GIGANTES_PROFILE?.role)){
   const count=boxData().filter(ready).length;
   bar.append(text('p',count+' de 6 cajas con ambos archivos disponibles.'));
   if(count<6){const upload=button('Cargar PDF y Word (ZIP)','import');upload.disabled=importing;bar.append(upload);bar.append(text('p','Carga \u00fanica: selecciona el ZIP Inventario_Cajas_PDF_Word_2026-10-02.zip entregado en el chat, sin descomprimirlo.'));}
  }
  const status=text('p',message,'inventory-doc-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');bar.append(status);
  panel.insertBefore(bar,panel.querySelector('.row'));
 }
}
async function authorized(admin=false){
 const sb=window.GIGANTES_DB;if(!sb)throw new Error('La sesi\u00f3n a\u00fan no est\u00e1 lista. Vuelve a entrar al Control Center.');
 const u=await sb.auth.getUser();if(u.error||!u.data?.user)throw new Error('Tu sesi\u00f3n expir\u00f3. Vuelve a iniciar sesi\u00f3n en la app.');
 const p=await sb.from('profiles').select('role,active').eq('user_id',u.data.user.id).maybeSingle();
 if(p.error||!p.data?.active||!(admin?ADMIN:STAFF).includes(p.data.role))throw new Error('Tu cuenta no tiene permiso para esta acci\u00f3n.');
 return {sb,user:u.data.user};
}
function filePath(code,kind,snapshot){
 const name=NAMES[codes.indexOf(code)];if(!name||snapshot?.bucket!==BUCKET)throw new Error('Documento no disponible.');
 const expected=code+'/'+name+'.'+(kind==='view'?'pdf':'docx');
 if(snapshot[kind==='view'?'pdf_path':'word_path']!==expected)throw new Error('La referencia del documento debe ser revisada por administraci\u00f3n.');
 return expected;
}
function closePdf(){if(dialog?.open)dialog.close();dialog?.querySelector('iframe')?.remove();if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}}
function showPdf(blob,name){
 closePdf();
 if(!dialog){dialog=document.createElement('dialog');dialog.className='inventory-pdf-dialog';dialog.setAttribute('aria-labelledby','inventoryPdfTitle');document.body.append(dialog);dialog.addEventListener('close',closePdf);}
 dialog.replaceChildren();const head=document.createElement('div');head.className='inventory-pdf-head';
 head.append(text('strong',name));head.firstChild.id='inventoryPdfTitle';const close=button('Cerrar','close');head.append(close);dialog.append(head);
 pdfUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
 const fallback=document.createElement('a');fallback.href=pdfUrl;fallback.target='_blank';fallback.rel='noopener';fallback.textContent='Abrir PDF en otra pesta\u00f1a';fallback.className='inventory-pdf-fallback';dialog.append(fallback);
 const frame=document.createElement('iframe');frame.title='Documento PDF: '+name;frame.src=pdfUrl+'#view=FitH';frame.referrerPolicy='no-referrer';dialog.append(frame);dialog.showModal();
}
async function openFile(code,kind,trigger){
 const original=trigger.textContent;trigger.disabled=true;trigger.textContent='Abriendo...';
 try{
  const {sb}=await authorized();const r=await sb.from('inventory_boxes').select('code,name,document_snapshot').eq('code',code).maybeSingle();
  if(r.error||!r.data)throw new Error('No fue posible consultar la caja.');
  const path=filePath(code,kind,r.data.document_snapshot);const f=await sb.storage.from(BUCKET).download(path);
  if(f.error||!f.data)throw new Error('No se pudo obtener el archivo privado. Revisa tu conexi\u00f3n o vuelve a iniciar sesi\u00f3n.');
  if(kind==='view')showPdf(f.data,r.data.name);
  else{const url=URL.createObjectURL(new Blob([f.data],{type:WORD}));const a=document.createElement('a');a.href=url;a.download=path.split('/').pop();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  setMessage(kind==='view'?'PDF abierto dentro de la app.':'Descarga del documento Word iniciada.');
 }catch(e){setMessage(e.message||'No fue posible abrir el documento.');}
 finally{trigger.disabled=false;trigger.textContent=original;}
}
function unpackStoredZip(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let at=0;
 const expected=new Set(NAMES.flatMap((n,i)=>[codes[i]+'/'+n+'.pdf',codes[i]+'/'+n+'.docx']));
 while(at+30<=bytes.length&&v.getUint32(at,true)===0x04034b50){
  const flags=v.getUint16(at+6,true),method=v.getUint16(at+8,true),size=v.getUint32(at+18,true),nl=v.getUint16(at+26,true),el=v.getUint16(at+28,true),start=at+30+nl+el;
  const name=new TextDecoder().decode(bytes.slice(at+30,at+30+nl));
  if(flags&9||method!==0||size>2097152||start+size>bytes.length||!expected.has(name)||files.has(name))throw new Error('ZIP no compatible. Usa el paquete original entregado en el chat.');
  files.set(name,bytes.slice(start,start+size));at=start+size;
 }
 if(files.size!==12)throw new Error('El paquete debe contener los seis PDF y los seis Word.');
 return files;
}
async function importZip(file){
 if(!file||importing)return;importing=true;document.querySelectorAll('[data-inventory-action="import"]').forEach(b=>b.disabled=true);
 try{
  setMessage('Verificando el paquete y tu sesi\u00f3n...');
  const {sb,user}=await authorized(true);
  if(file.size!==656660)throw new Error('Selecciona el ZIP original entregado en el chat, sin modificarlo.');
  const bytes=new Uint8Array(await file.arrayBuffer());if(await sha(bytes)!==ARCHIVE)throw new Error('El paquete no coincide con la versi\u00f3n verificada.');
  const files=unpackStoredZip(bytes);
  for(let i=0;i<6;i++){
   const code=codes[i],name=NAMES[i];setMessage('Cargando '+code+' ('+(i+1)+' de 6)...');
   const r=await sb.from('inventory_boxes').select('code,source_url,document_snapshot').eq('code',code).maybeSingle();if(r.error||!r.data)throw new Error('No se pudo consultar '+code+'.');
   const prev=r.data.document_snapshot;if(prev&&prev.archive_sha256!==ARCHIVE)throw new Error(code+' tiene otros documentos. No se reemplazaron.');
   const list=await sb.storage.from(BUCKET).list(code,{limit:100});if(list.error)throw new Error('No se pudo acceder al almacenamiento privado.');
   for(const ext of ['pdf','docx']){
    const path=code+'/'+name+'.'+ext,content=files.get(path),mime=ext==='pdf'?'application/pdf':WORD;
    if(!(list.data||[]).some(x=>x.name===name+'.'+ext)){
     const up=await sb.storage.from(BUCKET).upload(path,new Blob([content],{type:mime}),{contentType:mime,cacheControl:'0',upsert:false});
     if(up.error)throw new Error('No se pudo cargar '+path+'. Puedes reintentar con el mismo ZIP.');
    }
    const check=await sb.storage.from(BUCKET).download(path);
    if(check.error||!check.data||await sha(await check.data.arrayBuffer())!==await sha(content))throw new Error('Fall\u00f3 la verificaci\u00f3n de '+path+'.');
   }
   if(!prev){const snapshot={schema_version:2,bucket:BUCKET,pdf_path:code+'/'+name+'.pdf',word_path:code+'/'+name+'.docx',title:name+'.docx',original_url:r.data.source_url,imported_at:new Date().toISOString(),imported_by:user.id,archive_sha256:ARCHIVE};
    const save=await sb.from('inventory_boxes').update({document_snapshot:snapshot,updated_at:new Date().toISOString()}).eq('code',code).is('document_snapshot',null).select('code');
    if(save.error||save.data?.length!==1)throw new Error('Los archivos de '+code+' se cargaron, pero falta enlazarlos. Puedes reintentar con el mismo ZIP.');
   }
  }
  setMessage('Listo: seis PDF y seis Word verificados. Ya puedes ver y descargar los documentos.');
 }catch(e){setMessage(e.message||'No se pudo completar la carga.');}
 finally{importing=false;try{if(typeof loadLiveData==='function')await loadLiveData();if(typeof render==='function')render();}catch(_){decorate();}document.querySelectorAll('[data-inventory-action="import"]').forEach(b=>b.disabled=false);}
}
function start(){
 const style=document.createElement('style');style.textContent='.inventory-box-row{grid-template-columns:minmax(0,1fr) auto 70px!important}.inventory-document-actions{grid-column:1/-1;display:flex!important;gap:8px;align-items:center;flex-wrap:wrap}.inventory-document-actions .btn{padding:10px 12px;font-size:12px;white-space:normal}.inventory-document-actions button:disabled{opacity:.5;cursor:not-allowed}.inventory-pending{font-size:11px;color:#667085}.inventory-doc-toolbar{padding:12px;margin:12px 0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px}.inventory-doc-toolbar p{font-size:12px;line-height:1.5;margin:6px 0}.inventory-doc-status{font-weight:700}.inventory-pdf-dialog{width:min(1100px,96vw);max-width:96vw;height:92vh;max-height:92vh;border:0;border-radius:14px;padding:0;background:#fff}.inventory-pdf-dialog::backdrop{background:#101828b3}.inventory-pdf-dialog[open]{display:flex;flex-direction:column}.inventory-pdf-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px}.inventory-pdf-fallback{padding:0 14px 12px;font-size:12px;color:#9a3412}.inventory-pdf-dialog iframe{border:0;width:100%;flex:1;min-height:0}@media(max-width:760px){.inventory-box-row{grid-template-columns:minmax(0,1fr) auto!important}.inventory-document-actions>.btn{flex:1 1 160px}.inventory-pdf-dialog{width:98vw;max-width:98vw;height:94vh;max-height:94vh}}';document.head.append(style);
 document.addEventListener('click',e=>{const b=e.target.closest('button[data-inventory-action]');if(!b)return;const action=b.dataset.inventoryAction;
  if(action==='close'){closePdf();return;}
  if(action==='import'){const input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';input.onchange=()=>importZip(input.files?.[0]);input.click();return;}
  openFile(b.dataset.boxCode,action,b);
 });
 const old=window.render;if(typeof old==='function')window.render=function(...args){const result=old.apply(this,args);decorate();return result;};
 window.addEventListener('pagehide',closePdf);decorate();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
