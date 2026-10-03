(()=>{
'use strict';
if(window.GIGANTES_DRIVE_STATUS)return;
window.GIGANTES_DRIVE_STATUS=true;
let sb;
const $=s=>document.querySelector(s);
async function init(){
 if(!window.supabase||!window.GIGANTES_SUPABASE_URL)return;
 sb=window.GIGANTES_DB||supabase.createClient(window.GIGANTES_SUPABASE_URL,window.GIGANTES_SUPABASE_PUBLISHABLE_KEY);
 const user=await sb.auth.getUser();if(!user.data?.user)return;
 const p=await sb.from('profiles').select('role,active').eq('user_id',user.data.user.id).maybeSingle();
 if(p.error||!p.data?.active||!['superadmin','board'].includes(p.data.role))return;
 const box=$('#ccDriveStatus');if(!box)return;box.hidden=false;const syncBtn=$('#ccDriveSync');if(syncBtn){syncBtn.hidden=p.data.role!=='superadmin';syncBtn.onclick=()=>syncNow(syncBtn);}
 const [all,root,linked]=await Promise.all([
   sb.from('control_drive_index').select('drive_file_id,item_type,last_seen_at,sync_state',{count:'exact',head:false}).limit(500),
   sb.from('control_drive_index').select('drive_file_id,name,item_type,modified_time,sync_state').eq('parent_drive_id','1XwekH7R24heoHYT082Z6tNIQpjJyk0l0').order('name'),
   sb.from('control_drive_index').select('drive_file_id',{count:'exact',head:true}).not('linked_document_id','is',null)
 ]);
 if(all.error||root.error){box.querySelector('.cc-drive-copy').textContent='No fue posible consultar el índice de Drive.';return;}
 const rows=all.data||[],folders=rows.filter(x=>x.item_type==='folder').length,files=rows.filter(x=>x.item_type==='file').length;
 const last=rows.map(x=>x.last_seen_at).filter(Boolean).sort().at(-1);
 box.querySelector('.cc-drive-copy').textContent='Índice seguro de CARPETA MAESTRA';
 box.querySelector('.cc-drive-metrics').replaceChildren(
   metric(rows.length,'Elementos indexados'),
   metric(folders,'Carpetas'),
   metric(files,'Archivos'),
   metric(linked.count||0,'Enlazados a Biblioteca')
 );
 const list=box.querySelector('.cc-drive-areas');list.replaceChildren();
 for(const r of root.data||[]){const li=document.createElement('li');li.textContent=r.name;list.append(li);}
 box.querySelector('.cc-drive-last').textContent=last?'Última actualización del índice: '+new Date(last).toLocaleString('es-CL'):'Índice sin fecha de actualización';
}
async function syncNow(button){
 const label=button.textContent;button.disabled=true;button.textContent='Sincronizando...';
 const status=$('#ccDriveSyncStatus');if(status)status.textContent='Conectando con Drive...';
 try{
  const result=await sb.functions.invoke('sync-control-drive',{body:{}});
  if(result.error)throw new Error(result.error.message||'No se pudo iniciar la sincronización.');
  if(result.data?.configured===false){
   const missing=(result.data.missing_secrets||[]).join(', ');
   throw new Error('Faltan credenciales privadas de Google Drive: '+missing);
  }
  if(!result.data?.ok)throw new Error(result.data?.error||'La sincronización no terminó correctamente.');
  if(status)status.textContent='Sincronización completada: '+result.data.indexed_items+' elementos · '+result.data.linked_documents+' enlazados · '+result.data.missing_items+' ausentes.';
  setTimeout(()=>location.reload(),900);
 }catch(e){if(status)status.textContent=e.message||'No fue posible sincronizar Drive.';}
 finally{button.disabled=false;button.textContent=label;}
}
function metric(value,label){const n=document.createElement('div');n.className='cc-drive-metric';const strong=document.createElement('strong');strong.textContent=String(value);const span=document.createElement('span');span.textContent=label;n.append(strong,span);return n;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,400),{once:true});else setTimeout(init,400);
})();