const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
let tasks=[],reqs=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
(async()=>{
 const {data:{session}}=await sb.auth.getSession();if(!session){location.href='login.html?next=cierre-ds22.html';return}
 const {data:p}=await sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle();
 if(!p?.active||!['superadmin','board'].includes(p.role)){document.body.innerHTML='<main class="main wrap"><div class="card">Acceso sólo para Directiva / Superadmin.</div></main>';return}
 const [{data:t},{data:r}]=await Promise.all([
  sb.from('tasks').select('id,code,title,priority,status,progress,owner_name,notes').or('code.like.DS22-%,code.like.DISC-%').order('code'),
  sb.from('control_item_requirements').select('entity_id,code,title,detail,required,sensitive,source,sort_order').eq('entity_type','task').order('sort_order')
 ]);
 tasks=t||[];reqs=(r||[]).filter(x=>tasks.some(t=>t.id===x.entity_id));render()
})();
function statusClass(s){return s==='done'?'done':s==='blocked'?'blocked':'progress'}
function statusLabel(s){return s==='done'?'COMPLETADA':s==='blocked'?'BLOQUEADA':s==='waiting'?'PENDIENTE':'EN PROCESO'}
function renderTask(t){
 const rs=reqs.filter(x=>x.entity_id===t.id);
 return '<div class="task"><div class="row"><div><b>'+esc(t.code)+' · '+esc(t.title)+'</b><div class="meta">'+esc(t.owner_name||'Sin responsable')+' · '+esc(t.notes||'')+'</div></div><span class="badge '+statusClass(t.status)+'">'+statusLabel(t.status)+' · '+Number(t.progress||0)+'%</span></div>'+
 (rs.length?rs.map(r=>'<div class="req"><b>'+esc(r.required?'REQUERIDO · ':'')+esc(r.title)+'</b><div class="meta">'+esc(r.detail||'')+(r.sensitive?' · Documento sensible':'')+'</div></div>').join(''):'')+
 '<div class="actions">'+(t.code==='DS22-10'?'<a class="btn sec" href="proteccion.html">Subir respaldo de ratificación</a>':'')+(t.code==='DISC-01'?'<a class="btn sec" href="disciplina.html">Registrar integrantes</a>':'')+(t.code==='DISC-02'?'<a class="btn sec" href="disciplina.html">Abrir reglamento / documentos</a>':'')+(t.code==='DS22-08'?'<a class="btn sec" href="../ds22-comunidad.html">Ver / compartir guía DS22</a>':'')+(t.code==='DS22-12'?'<a class="btn sec" href="../proteccion.html">Revisar versión pública</a>':'')+'</div></div>'
}
function render(){
 const d=tasks.filter(t=>t.code.startsWith('DS22-')),x=tasks.filter(t=>t.code.startsWith('DISC-'));
 ds22.innerHTML=d.map(renderTask).join('');disc.innerHTML=x.map(renderTask).join('');
 const done=tasks.filter(t=>t.status==='done').length,progress=tasks.filter(t=>['in_progress','waiting'].includes(t.status)).length,blocked=tasks.filter(t=>t.status==='blocked').length;
 kDone.textContent=done;kProgress.textContent=progress;kBlocked.textContent=blocked;
 const activationBlockers=tasks.filter(t=>['DS22-05','DS22-06','DS22-07','DS22-08','DS22-10','DS22-11','DS22-12','DISC-01','DISC-02','DISC-03'].includes(t.code)&&t.status!=='done');
 kReady.textContent=activationBlockers.length?'NO':'SÍ';
 kReady.style.color=activationBlockers.length?'#991b1b':'#166534';
 const priority=['DS22-10','DISC-01','DISC-02','DS22-05','DS22-06','DS22-07','DS22-08','DS22-12','DS22-11','DISC-03'];
 const n=priority.map(code=>tasks.find(t=>t.code===code&&t.status!=='done')).find(Boolean);
 next.innerHTML=n?'<b>'+esc(n.code)+' · '+esc(n.title)+'</b><div class="meta">'+esc(n.notes||'')+'</div><div class="actions">'+(n.code==='DISC-01'||n.code==='DISC-02'?'<a class="btn" href="disciplina.html">Resolver ahora</a>':'<a class="btn" href="proteccion.html">Ir a Protección / DS22</a>')+'</div>':'<div class="notice"><b>Todo listo para activación institucional.</b> Verifica usuarios y permisos antes de enviar accesos.</div>'
}