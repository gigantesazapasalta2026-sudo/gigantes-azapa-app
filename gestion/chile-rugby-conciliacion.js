'use strict';
const db=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let snapshots=[],members=[],federation=[];
const toDate=x=>{const v=String(x??'').trim();const m=v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:(/^\d{4}-\d{2}-\d{2}/.test(v)?v.slice(0,10):null)};
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const label=x=>x==='confirmed'?'Vinculado':x==='duplicate'?'Posible duplicado':x==='review'?'Inconsistencia':'Sin ficha coincidente';
function setStatus(s){$('status').textContent=s}
function filtered(){const term=norm($('search').value),filter=$('filter').value;return snapshots.filter(x=>{const r=x.source_record||{};return (!term||norm([r.Jugador,r.Categoria,r.Estado,r.Seguro].join(' ')).includes(term))&&(filter==='all'||(filter==='review'&&x.match_status!=='confirmed')||(filter==='confirmed'&&x.match_status==='confirmed')||(filter==='insurance'&&r.Seguro!=='PAGO'))})}
function render(){
 const linked=snapshots.filter(x=>x.match_status==='confirmed'&&x.matched_person_id).length;
 $('total').textContent=snapshots.length;$('linked').textContent=linked;$('review').textContent=snapshots.length-linked;
 $('paid').textContent=snapshots.filter(x=>x.source_record?.Seguro==='PAGO').length;
 const rows=filtered();
 const peopleOpts=members.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.full_name)+' · '+esc(p.birth_date||'fecha no registrada')+'</option>').join('');
 $('rows').innerHTML=rows.length?rows.map(x=>{
 const r=x.source_record||{},linkedPerson=members.find(p=>p.id===x.matched_person_id);
 const linked=!!linkedPerson&&x.match_status==='confirmed';
 return '<tr><td><b>'+esc(r.Jugador||'Sin nombre')+'</b><div class="muted">Registro '+esc(x.source_id)+'</div></td><td>'+esc(r.Categoria||'—')+'</td><td>'+esc(r.Estado||'—')+'</td><td>'+esc(r['Estado del pago']||'—')+'</td><td>'+esc(r.Seguro||'—')+'</td><td>'+ (linked?'<span class="ok">'+esc(linkedPerson.full_name)+'</span>':'<span class="warn">'+esc(label(x.match_status))+'</span><div class="muted">'+esc(r['Motivo de revisión']||'')+'</div>') + '</td><td>'+(linked?'<button data-review="'+esc(x.source_id)+'">Revisar vínculo</button>':'<select data-person="'+esc(x.source_id)+'"><option value="">Seleccionar ficha existente…</option>'+peopleOpts+'</select><button data-link="'+esc(x.source_id)+'">Verificar y vincular</button>')+'</td></tr>';
 }).join(''):'<tr><td colspan="7">Sin registros.</td></tr>';
 document.querySelectorAll('[data-link]').forEach(btn=>btn.onclick=()=>linkRecord(btn.dataset.link));
 document.querySelectorAll('[data-review]').forEach(btn=>btn.onclick=()=>reviewRecord(btn.dataset.review));
}
async function load(){
 const [a,b,c]=await Promise.all([
 db.from('federation_source_snapshots').select('source_id,source_record,match_status,matched_person_id').order('source_id'),
 db.from('people').select('id,full_name,birth_date,category').order('full_name'),
 db.from('federation_status').select('person_id')
 ]);
 for(const v of [a,b,c])if(v.error)throw v.error;
 snapshots=a.data||[];members=b.data||[];federation=c.data||[];render();
 setStatus('Nómina oficial: '+snapshots.length+' filas · '+snapshots.filter(x=>x.match_status==='confirmed').length+' vinculadas · '+snapshots.filter(x=>x.match_status!=='confirmed').length+' pendientes de verificación de identidad. Ningún correo se envía desde esta pantalla.');
}
async function syncFederation(x,personId){
 const r=x.source_record||{};
 const payload={person_id:personId,federation_status:r.Estado||null,payment_status:r['Estado del pago']||null,epc_status:r.EPC||null,insurance_status:r.Seguro||null,insurance_date:toDate(r['Fecha adquisición seguro']),details:'BDChile · listado oficial recibido 03/11/2026 · registro '+x.source_id+' · estado de seguro sin verificación de vigencia',updated_at:new Date().toISOString()};
 const old=await db.from('federation_status').select('details').eq('person_id',personId).maybeSingle();if(old.error)throw old.error;
 if(old.data?.details)payload.details=old.data.details.includes('registro '+x.source_id)?old.data.details:old.data.details+' | '+payload.details;
 const result=await db.from('federation_status').upsert(payload,{onConflict:'person_id'}).select('person_id').maybeSingle();
 if(result.error||!result.data)throw (result.error||new Error('No se confirmó la sincronización federativa.'));
}
async function linkRecord(id){
 const x=snapshots.find(x=>x.source_id===id),selector=document.querySelector('select[data-person="'+id+'"]');
 const p=members.find(p=>p.id===selector?.value);if(!x||!p){alert('Selecciona primero una ficha del Registro Maestro.');return}
 const already=snapshots.find(y=>y.source_id!==x.source_id&&y.match_status==='confirmed'&&y.matched_person_id===p.id);
 if(already){alert('Esta persona ya tiene otro registro BDChile vinculado. Revisa el duplicado con la Federación antes de continuar.');return}
 const r=x.source_record||{};
 const warning='BDChile: '+r.Jugador+'\nNacimiento BDChile: '+(r['Fecha Nac.']||'no consta')+'\n\nRegistro Maestro: '+p.full_name+'\nNacimiento club: '+(p.birth_date||'no consta')+'\n\nConfirma SOLO si cotejaste el documento de identidad y la fecha de nacimiento con el Excel oficial y corresponden inequívocamente a la misma persona. No basta la similitud de nombre.\n\n¿Vincular y actualizar estados de inscripción y seguro (sin acreditar vigencia)?';
 if(!confirm(warning))return;
 try{
  // Primero registramos la decisión, después sincronizamos, con confirmación de lectura.
  const upd=await db.from('federation_source_snapshots').update({match_status:'confirmed',matched_person_id:p.id,updated_at:new Date().toISOString()}).eq('source_id',id).select('source_id').maybeSingle();
  if(upd.error||!upd.data)throw (upd.error||new Error('El vínculo no fue guardado.'));
  await syncFederation(x,p.id);await load();
 }catch(err){setStatus('Vínculo o sincronización incompleta: '+err.message+'; revisa esta ficha antes de continuar.');alert('No se pudo completar: '+err.message)}
}
async function reviewRecord(id){
 const x=snapshots.find(x=>x.source_id===id);if(!x)return;
 if(!confirm('¿Marcar este vínculo como pendiente de revisión? La ficha federativa anterior no se eliminará: deberás revisarla en Validación Chile Rugby.'))return;
 const r=await db.from('federation_source_snapshots').update({match_status:'review',matched_person_id:null,updated_at:new Date().toISOString()}).eq('source_id',id).select('source_id').maybeSingle();
 if(r.error||!r.data){alert(r.error?.message||'No se guardó');return}await load();
}
$('search').addEventListener('input',render);$('filter').addEventListener('change',render);
$('reload').onclick=()=>load().catch(e=>setStatus('Error: '+e.message));
$('export').onclick=()=>{
 const data=[['ID BDChile','Jugador','Categoria','Fichaje','Pago inscripción','Seguro','Vínculo'],...filtered().map(x=>[x.source_id,x.source_record?.Jugador||'',x.source_record?.Categoria||'',x.source_record?.Estado||'',x.source_record?.['Estado del pago']||'',x.source_record?.Seguro||'',x.match_status])];
 const csv=data.map(r=>r.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='BDChile_gigantes_revision.csv';a.click();URL.revokeObjectURL(url);
};
(async()=>{try{
 const auth=await db.auth.getSession();if(auth.error||!auth.data.session){location.href='login.html?next=chile-rugby-conciliacion.html';return}
 const profile=await db.from('profiles').select('role,active').eq('user_id',auth.data.session.user.id).maybeSingle();
 if(profile.error||!profile.data?.active||!['superadmin','board'].includes(profile.data.role)){setStatus('Acceso reservado a Directiva y Superadministración.');return}
 $('app').hidden=false;await load();
 }catch(err){setStatus('Error de carga: '+err.message)}})();