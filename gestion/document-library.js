/* Private document library. Original contents stay in role-protected storage. */
(()=>{
'use strict';
if(window.GIGANTES_DOCUMENT_LIBRARY)return;
window.GIGANTES_DOCUMENT_LIBRARY=true;
const BASE=new URL('./',document.currentScript.src);
const BUCKET='control-documents-private', BOX_BUCKET='inventory-documents-private';
const WORD='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const STAFF=['superadmin','board','treasury','coach','commission'], ADMIN=['superadmin','board'];
const PACKAGE_SHA='47cbd153e81e1a9edc1d7431a6fbc1b2da9cb13471b9c95986a223c9ad40790d';
const PACKAGE_NAME='Biblioteca_Control_Center_PDF_Originales_2026-10-03.zip';
const isLibrary=location.pathname===new URL('biblioteca.html',BASE).pathname;
let client,profile,uid,records=[],bySource=new Map(),loaded=false,importing=false,notice='',viewer=null,loadPromise=null,generation=0;
const objectURLs=new Set();
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action,key)=>{const b=node('button',text,'cc-doc-btn');b.type='button';b.dataset.ccAction=action;if(key)b.dataset.ccKey=key;return b;};
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
const validId=id=>/^[A-Za-z0-9_-]{8,150}$/.test(id||'');
function sourceId(value){try{const u=new URL(value,location.href);if(!['drive.google.com','docs.google.com'].includes(u.hostname))return null;const m=u.pathname.match(/^\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/);const id=m?.[1]||(u.pathname==='/uc'?u.searchParams.get('id'):null);return validId(id)?id:null;}catch(_){return null;}}
function getClient(){
 if(client)return client;
 if(window.GIGANTES_DB)client=window.GIGANTES_DB;
 else if(typeof sb!=='undefined'&&sb?.auth)client=sb;
 else{if(!window.supabase||!window.GIGANTES_SUPABASE_URL)throw new Error('No se pudo cargar la conexi\u00f3n. Actualiza la p\u00e1gina.');client=supabase.createClient(window.GIGANTES_SUPABASE_URL,window.GIGANTES_SUPABASE_PUBLISHABLE_KEY);}
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(uid&&session?.user?.id&&uid!==session.user.id)){generation++;setTimeout(clearPrivate,0);}});
 return client;
}
function closeViewer(){const d=viewer;viewer=null;if(!d)return;for(const u of d._urls||[]){URL.revokeObjectURL(u);objectURLs.delete(u);}if(d.open)d.close();d.remove();}
function clearPrivate(){closeViewer();records=[];bySource.clear();loaded=false;profile=null;uid=null;document.querySelectorAll('[data-cc-action="view"],[data-cc-action="download"]').forEach(b=>b.disabled=true);if(isLibrary){document.getElementById('ccDocList').replaceChildren();document.getElementById('ccDocSummary').textContent='Sin sesi\u00f3n autorizada';document.getElementById('ccDocUpload').hidden=true;}setNotice('La sesi\u00f3n cambi\u00f3. Vuelve a iniciar sesi\u00f3n con tu propia cuenta.');}
async function authorize(admin=false){
 const c=getClient(),token=generation,u=await c.auth.getUser();
 if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Vuelve a entrar.');
 if(u.error||!u.data?.user){const e=new Error('Inicia sesi\u00f3n en el Control Center.');e.login=true;throw e;}
 const p=await c.from('profiles').select('role,active').eq('user_id',u.data.user.id).maybeSingle();
 if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Vuelve a entrar.');
 if(p.error||!p.data?.active||!(admin?ADMIN:STAFF).includes(p.data.role))throw new Error('Tu cuenta no tiene permiso para esta acci\u00f3n.');
 if(uid&&uid!==u.data.user.id){generation++;clearPrivate();throw new Error('La sesi\u00f3n cambi\u00f3. Actualiza la p\u00e1gina.');}
 uid=u.data.user.id;profile=p.data;return c;
}
function setNotice(value){notice=value;let ns=document.querySelectorAll('.cc-doc-notice');if(!ns.length&&value){const n=node('p',null,'cc-doc-notice cc-doc-toast');n.setAttribute('role','status');n.setAttribute('aria-live','polite');document.body.append(n);ns=[n];}ns.forEach(n=>n.textContent=value);}
const mapDoc=r=>({...r,key:'doc:'+r.id,kind:'doc',ready:!!r.imported_at});
function mapBox(r){const d=r.document_snapshot;return {id:r.code,key:'box:'+r.code,kind:'box',title:r.name,category:'Inventario / Cajas',source_url:r.source_url,source_status:'reference',original_ext:'docx',original_name:d?.title||r.code+'.docx',snapshot:d,ready:d?.bucket===BOX_BUCKET&&!!d?.pdf_path&&!!d?.word_path};}
async function load(){
 if(loadPromise)return loadPromise;
 loadPromise=(async()=>{const c=await authorize(),token=generation;
  const [d,b]=await Promise.all([c.from('control_document_catalog').select('*').order('category').order('title'),c.from('inventory_boxes').select('code,name,source_url,document_snapshot').order('code')]);
  if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Actualiza la p\u00e1gina.');
  if(d.error||b.error)throw new Error('No fue posible consultar la biblioteca. Revisa tu conexi\u00f3n.');
  records=[...(d.data||[]).map(mapDoc),...(b.data||[]).map(mapBox)];bySource=new Map();
  for(const r of records){const id=sourceId(r.source_url)||sourceId(r.snapshot?.original_url);if(id)bySource.set(id,r);}
  loaded=true;if(isLibrary)renderLibrary(true);enhanceLinks();return records;
 })().finally(()=>{loadPromise=null;});return loadPromise;
}
function statusText(r){return ({available:'Documento disponible',needs_refresh:'Requiere renovaci\u00f3n',reference:'Documento de referencia',draft:'Borrador',pending:'Pendiente de validaci\u00f3n',missing:'Falta documento',archived:'Hist\u00f3rico'})[r.source_status]||r.source_status||'Por revisar';}
function actions(r){const w=node('span',null,'cc-doc-actions');const v=button('Ver documento (PDF)','view',r.key),d=button(r.original_ext==='docx'?'Descargar original (Word)':'Descargar original (PDF)','download',r.key);v.classList.add('cc-doc-primary');v.disabled=d.disabled=!r.ready;w.append(v,d);if(r.kind==='doc'&&r.ready){w.append(button('Historial de versiones','history',r.key));if(!r.deleted_at&&(r.editor_roles||[]).includes(profile?.role)){w.append(button('Editar ficha','editmeta',r.key));const u=button('Subir nueva versión','updateversion',r.key);u.classList.add('cc-doc-update');w.append(u);}if((r.delete_roles||[]).includes(profile?.role)){const t=button(r.deleted_at?'Restaurar documento':'Mover a papelera',r.deleted_at?'restore':'trash',r.key);t.classList.add(r.deleted_at?'cc-doc-restore':'cc-doc-trash');w.append(t);}}if(!r.ready)w.append(node('span','Pendiente de carga inicial','cc-doc-pending'));return w;}
function enhanceLinks(){
 if(!loaded)return;
 for(const a of document.querySelectorAll('a[href]')){if(a.closest('.cc-doc-viewer')||a.dataset.ccSeen)continue;const id=sourceId(a.href);if(!id)continue;a.dataset.ccSeen='1';const r=bySource.get(id);if(!r)continue;
  const parent=a.closest('.doc-actions,.doc-card,small')||a.parentElement;
  if(parent&&[...parent.querySelectorAll('[data-cc-source]')].some(n=>n.dataset.ccSource===id)){a.remove();continue;}
  const w=actions(r);w.dataset.ccSource=id;a.replaceWith(w);
 }
}
function addNavigation(){if(isLibrary||document.querySelector('.cc-library-entry'))return;const a=node('a','Biblioteca del club','cc-library-entry');a.href=new URL('biblioteca.html',BASE).href;const nav=document.querySelector('aside .nav');if(nav)nav.prepend(a);else document.querySelector('.top .in,.top .topin,header')?.append(a);}
function renderLibrary(reset=false){
 const category=document.getElementById('ccDocCategory'),list=document.getElementById('ccDocList');if(!list)return;
 if(reset){const prior=category.value;category.replaceChildren(new Option('Todas las \u00e1reas',''));[...new Set(records.map(r=>r.category))].sort((a,b)=>a.localeCompare(b,'es')).forEach(c=>category.add(new Option(c,c)));category.value=[...category.options].some(o=>o.value===prior)?prior:'';}
 const q=normalize(document.getElementById('ccDocSearch').value),state=document.getElementById('ccDocState').value;
 const filtered=records.filter(r=>{const stateOk=state==='active'?!r.deleted_at:state==='ready'?(!r.deleted_at&&r.ready):state==='pending'?(!r.deleted_at&&!r.ready):state==='trash'?!!r.deleted_at:true;return (!category.value||r.category===category.value)&&(!q||normalize([r.title,r.original_name,r.category,r.source_code].join(' ')).includes(q))&&stateOk;});
 const activeDocs=records.filter(r=>r.kind!=='doc'||!r.deleted_at),trashDocs=records.filter(r=>r.kind==='doc'&&r.deleted_at);document.getElementById('ccDocSummary').textContent=activeDocs.filter(r=>r.ready).length+' de '+activeDocs.length+' documentos activos disponibles'+(trashDocs.length?' · '+trashDocs.length+' en papelera':'');
 document.getElementById('ccDocCount').textContent=filtered.length+' resultados';document.getElementById('ccDocUpload').hidden=!ADMIN.includes(profile?.role);document.getElementById('ccDocUpload').disabled=importing;list.replaceChildren();
 for(const r of filtered){const card=node('article',null,'cc-doc-card');card.append(node('div',r.category,'cc-doc-category'),node('h2',r.title));const tags=node('div',null,'cc-doc-tags');if(r.deleted_at)tags.append(node('span','Papelera','cc-tag-trash'));else tags.append(node('span',r.ready?'Cargado en la app':'Pendiente de carga',r.ready?'cc-tag-ready':'cc-tag-pending'));tags.append(node('span',statusText(r),r.source_status==='needs_refresh'?'cc-tag-pending':'cc-tag-neutral'));card.append(tags,node('p',r.original_name,'cc-doc-filename'));if(r.kind==='doc')card.append(node('p','Versión actual: v'+(Number(r.current_version)||1),'cc-doc-version'));if(r.deleted_at)card.append(node('p','En papelera desde: '+new Date(r.deleted_at).toLocaleString('es-CL'),'cc-doc-deleted'));else if(r.imported_at)card.append(node('p','Copia incorporada: '+new Date(r.imported_at).toLocaleDateString('es-CL'),'cc-doc-date'));card.append(actions(r));list.append(card);}
 if(!filtered.length)list.append(node('p','No hay documentos que coincidan con tu b\u00fasqueda y tus permisos.','cc-doc-empty'));setNotice(notice);
}
function viewerShell(title){closeViewer();const d=node('dialog',null,'cc-doc-viewer');viewer=d;d._urls=[];d.setAttribute('aria-labelledby','ccViewerTitle');const head=node('div',null,'cc-viewer-head'),h=node('strong',title);h.id='ccViewerTitle';head.append(h,button('Cerrar','close'));d.append(head,node('p','Cargando documento privado...','cc-viewer-message'));document.body.append(d);d.addEventListener('close',()=>{if(viewer===d)closeViewer();});d.addEventListener('click',e=>{if(e.target===d&&e.offsetX<0)closeViewer();});d.showModal();return d;}
function filePath(r,action){
 if(r.kind==='doc'){if(!validId(r.id)||!['pdf','docx'].includes(r.original_ext))throw new Error('Referencia no v\u00e1lida.');const v=Math.max(1,Number(r.current_version)||1);return {bucket:BUCKET,path:r.id+'/v'+v+'/'+(action==='download'&&r.original_ext==='docx'?'original.docx':'document.pdf')};}
 const s=r.snapshot,path=action==='view'?s?.pdf_path:s?.word_path;
 if(s?.bucket!==BOX_BUCKET||!/^BOX0[1-6]$/.test(r.id)||!path?.startsWith(r.id+'/')||!new RegExp('^BOX0[1-6]/[A-Za-z0-9_-]+\\.'+(action==='view'?'pdf':'docx')+'$').test(path))throw new Error('Referencia de inventario no v\u00e1lida.');return {bucket:BOX_BUCKET,path};
}
async function fresh(key){const c=await authorize(),[kind,id]=key.split(':');let r;
 if(kind==='doc'){const q=await c.from('control_document_catalog').select('*').eq('id',id).maybeSingle();if(q.error||!q.data)throw new Error('Documento no disponible para tu cuenta.');r=mapDoc(q.data);}
 else if(kind==='box'){const q=await c.from('inventory_boxes').select('code,name,source_url,document_snapshot').eq('code',id).maybeSingle();if(q.error||!q.data)throw new Error('Caja no disponible para tu cuenta.');r=mapBox(q.data);}else throw new Error('Referencia desconocida.');
 if(!r.ready)throw new Error('Falta incorporar los archivos de este documento.');return r;}
async function openDocument(key,action,trigger){
 if(!['view','download'].includes(action))return;const label=trigger.textContent,token=generation;trigger.disabled=true;trigger.textContent=action==='view'?'Abriendo PDF...':'Preparando descarga...';const d=action==='view'?viewerShell(records.find(r=>r.key===key)?.title||'Documento'):null;
 try{const r=await fresh(key),f=filePath(r,action),res=await getClient().storage.from(f.bucket).download(f.path);if(token!==generation)return;if(res.error||!res.data)throw new Error('No fue posible obtener el archivo. Revisa tu conexi\u00f3n y tus permisos.');const pdf=action==='view'||r.original_ext==='pdf',blob=new Blob([res.data],{type:pdf?'application/pdf':WORD});if(pdf&&new TextDecoder().decode(await blob.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('El archivo recibido no es un PDF v\u00e1lido.');if(token!==generation)return;
  if(action==='view'){if(viewer!==d)return;d.querySelector('.cc-viewer-message').remove();const url=URL.createObjectURL(blob);objectURLs.add(url);d._urls.push(url);const alt=node('a','Abrir PDF en otra pesta\u00f1a','cc-viewer-alternate');alt.href=url;alt.target='_blank';alt.rel='noopener';d.append(alt);const frame=document.createElement('iframe');frame.title='PDF: '+r.title;frame.src=url+'#view=FitH';frame.referrerPolicy='no-referrer';d.append(frame);}
  else{const url=URL.createObjectURL(blob);objectURLs.add(url);const a=node('a');a.href=url;a.download=r.original_name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);objectURLs.delete(url);},60000);setNotice('Descarga iniciada: '+r.original_name);}
 }catch(e){setNotice(e.message);if(viewer===d&&d)d.querySelector('.cc-viewer-message').textContent=e.message;}finally{trigger.disabled=token!==generation;trigger.textContent=label;}
}

async function showHistory(key,trigger){
 const label=trigger.textContent;trigger.disabled=true;trigger.textContent='Cargando historial...';
 try{
  const r=await fresh(key);if(r.kind!=='doc')throw new Error('Este registro no usa historial de versiones.');
  const q=await getClient().from('control_document_versions').select('version_no,pdf_path,original_path,original_name,original_ext,created_at,note,created_by').eq('document_id',r.id).order('version_no',{ascending:false});
  if(q.error)throw new Error('No fue posible consultar el historial.');
  const d=viewerShell('Historial · '+r.title),msg=d.querySelector('.cc-viewer-message');msg.textContent='';
  const summary=node('p',(q.data?.length||0)+' versiones registradas · vigente v'+(Number(r.current_version)||1),'cc-history-summary');msg.append(summary);
  const list=node('div',null,'cc-history-list');
  for(const ver of q.data||[]){
   const item=node('article',null,'cc-history-item');
   const top=node('div',null,'cc-history-top');
   const title=node('strong','Versión v'+ver.version_no+(Number(ver.version_no)===Number(r.current_version)?' · ACTUAL':''));top.append(title);
   if(Number(ver.version_no)===Number(r.current_version))top.append(node('span','Vigente','cc-history-current'));
   item.append(top,node('span',new Date(ver.created_at).toLocaleString('es-CL'),'cc-history-date'),node('span',ver.original_name,'cc-history-file'));
   if(ver.note)item.append(node('p',ver.note,'cc-history-note'));
   const acts=node('div',null,'cc-history-actions');
   const view=button('Ver PDF','versionview');view.dataset.docId=r.id;view.dataset.version=String(ver.version_no);view.dataset.path=ver.pdf_path;view.dataset.filename=ver.original_name;view.dataset.ext=ver.original_ext;
   const down=button(ver.original_ext==='docx'?'Descargar Word':'Descargar PDF','versiondownload');down.dataset.docId=r.id;down.dataset.version=String(ver.version_no);down.dataset.path=ver.original_path;down.dataset.filename=ver.original_name;down.dataset.ext=ver.original_ext;
   acts.append(view,down);item.append(acts);list.append(item);
  }
  if(!q.data?.length)list.append(node('p','No hay versiones registradas.','cc-doc-empty'));
  msg.append(list);
 }catch(e){setNotice(e.message||'No fue posible consultar el historial.');}
 finally{trigger.disabled=false;trigger.textContent=label;}
}
async function openVersionFile(trigger,action){
 const docId=trigger.dataset.docId,version=Number(trigger.dataset.version),path=trigger.dataset.path,filename=trigger.dataset.filename,extension=trigger.dataset.ext;
 if(!validId(docId)||!Number.isInteger(version)||version<1||!['pdf','docx'].includes(extension))return setNotice('Referencia de versión no válida.');
 const expected=docId+'/v'+version+'/'+(action==='versionview'?'document.pdf':(extension==='docx'?'original.docx':'document.pdf'));
 if(path!==expected)return setNotice('Ruta de versión no válida.');
 const label=trigger.textContent;trigger.disabled=true;trigger.textContent=action==='versionview'?'Abriendo...':'Preparando...';
 const d=action==='versionview'?viewerShell('Versión v'+version+' · '+filename):null;
 try{
  const q=await getClient().from('control_document_versions').select('version_no,pdf_path,original_path,original_name,original_ext').eq('document_id',docId).eq('version_no',version).maybeSingle();
  if(q.error||!q.data)throw new Error('Esta versión no está disponible para tu cuenta.');
  const serverPath=action==='versionview'?q.data.pdf_path:q.data.original_path;
  if(serverPath!==expected)throw new Error('La referencia guardada de esta versión no coincide.');
  const res=await getClient().storage.from(BUCKET).download(serverPath);
  if(res.error||!res.data)throw new Error('No fue posible obtener esta versión.');
  const isPdf=action==='versionview'||q.data.original_ext==='pdf',blob=new Blob([res.data],{type:isPdf?'application/pdf':WORD});
  if(isPdf&&new TextDecoder().decode(await blob.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('El archivo recibido no es un PDF válido.');
  if(action==='versionview'){
   if(viewer!==d)return;
   d.querySelector('.cc-viewer-message').remove();
   const url=URL.createObjectURL(blob);objectURLs.add(url);d._urls.push(url);
   const meta=node('div','Versión histórica v'+version+' · solo lectura','cc-viewer-version-meta');d.append(meta);
   const alt=node('a','Abrir PDF en otra pestaña','cc-viewer-alternate');alt.href=url;alt.target='_blank';alt.rel='noopener';d.append(alt);
   const frame=document.createElement('iframe');frame.title='Versión v'+version+': '+q.data.original_name;frame.src=url+'#view=FitH';frame.referrerPolicy='no-referrer';d.append(frame);
  }else{
   const url=URL.createObjectURL(blob);objectURLs.add(url);const a=node('a');a.href=url;a.download=q.data.original_name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);objectURLs.delete(url);},60000);setNotice('Descarga iniciada: v'+version+' · '+q.data.original_name);
  }
 }catch(e){setNotice(e.message||'No fue posible abrir esta versión.');if(d&&viewer===d)d.querySelector('.cc-viewer-message').textContent=e.message;}
 finally{trigger.disabled=false;trigger.textContent=label;}
}

function unzipStored(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),map=new Map();let p=0;while(p+30<=bytes.length&&v.getUint32(p,true)===0x04034b50){const flags=v.getUint16(p+6,true),method=v.getUint16(p+8,true),size=v.getUint32(p+18,true),raw=v.getUint32(p+22,true),nl=v.getUint16(p+26,true),extra=v.getUint16(p+28,true),start=p+30+nl+extra;if(flags&9||method!==0||raw!==size||size>33554432||start+size>bytes.length)throw new Error('ZIP no compatible. Usa el paquete original sin volver a comprimirlo.');const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+30,p+30+nl));if((name!=='manifest.json'&&!/^[A-Za-z0-9_-]{8,150}\/v1\/(document\.pdf|original\.docx)$/.test(name))||map.has(name))throw new Error('Ruta no v\u00e1lida en el paquete.');map.set(name,bytes.subarray(start,start+size));p=start+size;}if(!map.has('manifest.json')||map.size>200)throw new Error('Paquete documental incompleto.');return map;}
async function importPackage(file){
 if(!file||importing)return;importing=true;document.getElementById('ccDocUpload').disabled=true;let count=0,skipped=0;
 try{setNotice('Comprobando el paquete y tus permisos...');const c=await authorize(true),token=generation;if(file.size>125829120)throw new Error('El paquete supera el tama\u00f1o admitido.');const bytes=new Uint8Array(await file.arrayBuffer());if(await hash(bytes)!==PACKAGE_SHA)throw new Error('Selecciona '+PACKAGE_NAME+' sin descomprimir ni modificar.');const files=unzipStored(bytes),m=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));if(m.schema_version!==1||!Array.isArray(m.documents)||!Array.isArray(m.files))throw new Error('Manifiesto incompatible.');await load();const allowed=new Map(records.filter(r=>r.kind==='doc').map(r=>[r.id,r]));
  for(const src of m.documents){if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Vuelve a entrar y reintenta.');const r=allowed.get(src.id);if(!r){skipped++;continue;}if(r.original_ext!==src.original_ext||r.original_name!==src.original_name)throw new Error('La versi\u00f3n de '+r.title+' no coincide con el cat\u00e1logo.');if(r.ready){count++;continue;}setNotice('Cargando '+(count+1)+' de '+m.documents.length+': '+r.title);const folder=r.id+'/v1',existing=await c.storage.from(BUCKET).list(folder,{limit:10});if(existing.error)throw new Error('No se pudo consultar el almacenamiento privado.');
   for(const name of (r.original_ext==='docx'?['document.pdf','original.docx']:['document.pdf'])){const path=folder+'/'+name,entry=m.files.find(f=>f.path===path),content=files.get(path);if(!entry||!content||content.length!==entry.size||await hash(content)!==entry.sha256)throw new Error('Fall\u00f3 la verificaci\u00f3n de '+r.title);if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Vuelve a entrar.');
    if(!(existing.data||[]).some(o=>o.name===name)){const mime=name.endsWith('.pdf')?'application/pdf':WORD;const up=await c.storage.from(BUCKET).upload(path,new Blob([content],{type:mime}),{contentType:mime,cacheControl:'0',upsert:false});if(up.error&&String(up.error.statusCode)!=='409')throw new Error('No se pudo cargar '+r.title+'. Puedes reintentar con el mismo ZIP.');}
    const check=await c.storage.from(BUCKET).download(path);if(check.error||!check.data||await hash(await check.data.arrayBuffer())!==entry.sha256)throw new Error('No coincide la copia guardada de '+r.title+'. No se reemplaz\u00f3 ning\u00fan archivo.');
   }
   if(token!==generation)throw new Error('La sesi\u00f3n cambi\u00f3. Vuelve a entrar.');const save=await c.from('control_document_catalog').update({imported_at:new Date().toISOString()}).eq('id',r.id).is('imported_at',null).select('id');if(save.error)throw new Error('Falta vincular '+r.title+'. Puedes reintentar con el mismo ZIP.');if(save.data?.length!==1){const check=await c.from('control_document_catalog').select('imported_at').eq('id',r.id).maybeSingle();if(check.error||!check.data?.imported_at)throw new Error('No se pudo confirmar la carga de '+r.title);}
   count++;
  }
  setNotice('Carga completada: '+count+' documentos disponibles.'+(skipped?' '+skipped+' omitidos por los permisos de tu cuenta.':''));
 }catch(e){setNotice(e.message||'No fue posible completar la carga.');}finally{importing=false;try{await load();}catch(_){}document.getElementById('ccDocUpload').disabled=false;setNotice(notice);}
}
async function boot(){
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('document-library.css?v=20261003-1',BASE).href;document.head.append(css);addNavigation();
 document.addEventListener('click',e=>{const b=e.target.closest('button[data-cc-action]');if(b){const a=b.dataset.ccAction;if(a==='close')closeViewer();else if(a==='refresh'){setNotice('Actualizando...');load().then(()=>setNotice('Biblioteca actualizada.')).catch(x=>setNotice(x.message));}else if(a==='import'){const i=document.getElementById('ccDocZip');i.value='';i.click();}else if(a==='history')showHistory(b.dataset.ccKey,b);else if(a==='versionview'||a==='versiondownload')openVersionFile(b,a);else openDocument(b.dataset.ccKey,a,b);return;}const a=e.target.closest('a[href]'),id=a&&sourceId(a.href);if(id&&!bySource.has(id)){e.preventDefault();const d=viewerShell('Documento no incorporado');d.querySelector('.cc-viewer-message').textContent='Este archivo a\u00fan no est\u00e1 incorporado al visor interno o tu cuenta no tiene permiso. Solicita la revisi\u00f3n al administrador.';}});
 if(isLibrary){document.getElementById('ccDocZip').addEventListener('change',e=>importPackage(e.target.files?.[0]));for(const id of ['ccDocSearch','ccDocCategory','ccDocState'])document.getElementById(id).addEventListener(id==='ccDocSearch'?'input':'change',()=>renderLibrary());}
 let scheduled=false;new MutationObserver(ms=>{if(!loaded||scheduled||!ms.some(m=>[...m.addedNodes].some(n=>n.nodeType===1)))return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhanceLinks();});}).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('pagehide',()=>{closeViewer();for(const u of objectURLs)URL.revokeObjectURL(u);objectURLs.clear();});window.addEventListener('pageshow',e=>{if(e.persisted)load().catch(x=>setNotice(x.message));});window.addEventListener('beforeunload',e=>{if(importing){e.preventDefault();e.returnValue='';}});
 try{await load();}catch(e){if(isLibrary&&e.login){location.replace('login.html?next=biblioteca.html');return;}setNotice(e.message);if(isLibrary)document.getElementById('ccDocSummary').textContent='Biblioteca no disponible';}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
