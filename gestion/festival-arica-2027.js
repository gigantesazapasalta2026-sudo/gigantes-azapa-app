/* Festival de Rugby y Turismo Arica 2027 - Control Center.
 * Data source: existing RLS-protected Supabase tables. No player personal data in this module.
 */
(() => {
  'use strict';
  const PID = 'a91fccb5-868a-482c-b590-bea4cf4a265c';
  const CODES = ['SUBV_MUNI_2027','FNDR8_2027','DONACIONES_IND','FONDEPORTE_2027','FONDEPORTE_AD','FNDR_MERITO_2026'];
  const staffRoles = ['superadmin','board','coach','commission','treasury'];
  const sb = supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{
    auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}
  });
  const $ = id => document.getElementById(id);
  const E = val => String(val ?? '').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const money = val => '$'+Number(val||0).toLocaleString('es-CL',{maximumFractionDigits:0});
  const day = val => {
    if(!val)return 'Sin fecha';
    const n = new Date(String(val).slice(0,10)+'T12:00:00');
    return isNaN(n.getTime()) ? String(val) : n.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'});
  };
  const field = (id,container) => container.querySelector('[data-'+id+']');
  const state = {role:null,teams:[],requests:[],tasks:[],milestones:[],responsibilities:[],checklist:[],budget:[],funding:[],errors:{}};
  let canManage = false;
  const teamStates = [['organizer','Organizador'],['reserve','Por invitar'],['invited','Invitado'],['interested','Interesado'],['roster_pending','Nómina pendiente'],['confirmed','Confirmado'],['declined','Declinó'],['withdrawn','Retirado']];
  const requestStates = [['draft','Borrador'],['sent','Enviada'],['acknowledged','Recibida'],['pending','En seguimiento'],['confirmed','Confirmada'],['redirected','Derivada'],['declined','Rechazada'],['closed','Cerrada']];
  const taskStates = [['waiting','Pendiente'],['in_progress','En curso'],['blocked','Bloqueada'],['done','Completada']];
  const opt = (states,selected) => states.map(pair=>'<option value="'+E(pair[0])+'"'+(pair[0]===selected?' selected':'')+'>'+E(pair[1])+'</option>').join('');
  const err = (key) => state.errors[key] ? '<div class="error">No fue posible acceder a esta información. Revisa permisos del módulo y vuelve a cargar.</div>' : '';

  async function init(){
    try {
      const sessionResult = await sb.auth.getSession();
      const session = sessionResult.data && sessionResult.data.session;
      if(!session){ location.href='login.html?next=festival-arica-2027.html'; return; }
      const profile = await sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle();
      if(profile.error || !profile.data || !profile.data.active || !staffRoles.includes(profile.data.role)){
        $('authStatus').className='error';
        $('authStatus').textContent='El módulo requiere un perfil activo del Control Center con permisos de gestión.';
        return;
      }
      state.role=profile.data.role;
      canManage=['superadmin','board'].includes(state.role);
      $('dashboard').hidden=false;
      $('authStatus').hidden=true;
      $('taskSearch').addEventListener('input',renderTasks);
      $('taskFilter').addEventListener('change',renderTasks);
      $('dashboard').addEventListener('click',handleClick);
      $('dashboard').addEventListener('change',handleChange);
      await loadAll();
    } catch(e){
      $('authStatus').className='error';
      $('authStatus').textContent='No se pudo inicializar el módulo. '+String(e.message||e);
    }
  }
  async function loadAll(){
    const specs = {
      teams:sb.from('project_teams').select('id,name,city,status,participant_count,notes,sort_order').eq('project_id',PID).order('sort_order'),
      requests:sb.from('project_external_requests').select('id,area,organization,subject,status,notes,sent_at,next_action_date').eq('project_id',PID).order('created_at'),
      tasks:sb.from('tasks').select('id,code,title,owner_name,priority,due_date,status,progress,notes').eq('project_id',PID).eq('active',true).order('due_date'),
      milestones:sb.from('project_milestones').select('id,title,due_date,status,progress,owner_name,notes').eq('project_id',PID).order('due_date'),
      responsibilities:sb.from('project_responsibilities').select('id,code,area,title,responsible_name,description,sort_order').eq('project_id',PID).eq('active',true).order('sort_order'),
      budget:sb.from('project_budget_items').select('id,code,area,title,quantity,unit,unit_price,in_scope,status,notes,provider,sort_order').eq('project_id',PID).eq('active',true).order('sort_order'),
      funding:sb.from('funding_opportunities').select('code,name,institution,status,window_text,official_url').in('code',CODES).eq('active',true)
    };
    const keys=Object.keys(specs);
    const responses=await Promise.all(keys.map(key=>specs[key]));
    responses.forEach((r,i)=>{
      const key=keys[i];state.errors[key]=r.error?r.error.message:null;
      state[key]=r.error?[]:(r.data||[]);
    });
    const checkResult = await sb.from('responsibility_checklist_items').select('id,responsibility_id,code,title,detail,status,evidence_required,evidence_note,evidence_url,sort_order')
      .in('responsibility_id',state.responsibilities.length?state.responsibilities.map(x=>x.id):['00000000-0000-0000-0000-000000000000'])
      .order('sort_order');
    state.errors.checklist=checkResult.error?checkResult.error.message:null;
    state.checklist=checkResult.error?[]:(checkResult.data||[]);
    renderAll();
  }
  function renderAll(){
    const checkDone=state.checklist.filter(x=>x.status==='done').length;
    const taskDone=state.tasks.filter(x=>x.status==='done').length;
    const confirmed=state.teams.filter(x=>x.status==='confirmed').length;
    const opened=state.requests.filter(x=>!['draft'].includes(x.status)).length;
    const total=state.budget.filter(x=>x.in_scope && Number(x.unit_price)>0).reduce((sum,x)=>sum+Number(x.quantity||0)*Number(x.unit_price),0);
    $('kpiTasks').textContent=taskDone+' / '+state.tasks.length;
    $('kpiCheck').textContent=checkDone+' / '+state.checklist.length;
    $('kpiTeams').textContent=String(confirmed);
    $('kpiRequests').textContent=opened+' / '+state.requests.length;
    $('kpiBudget').textContent=money(total);
    $('budgetTotal').textContent=money(total);
    renderTeams();renderRequests();renderTasks();renderChecklist();renderBudget();renderMilestones();renderFunding();
  }
  function renderTeams(){
    $('teamList').innerHTML=err('teams')+(state.teams.map(t=>{
      const organizer=t.status==='organizer';
      return '<article class="item"><h3>'+E(t.name)+' '+(organizer?'<span class="badge green">Anfitrión</span>':'')+'</h3>'+
        '<p>'+E(t.city||'Ciudad por confirmar')+' · '+E(t.notes||'')+'</p>'+
        '<div class="tools"><label>Estado <select data-team-status="'+E(t.id)+'" '+(!canManage||organizer?'disabled':'')+'>'+opt(teamStates,t.status)+'</select></label>'+
        '<label>Participantes <input type="number" min="0" step="1" data-team-count="'+E(t.id)+'" placeholder="Por definir" value="'+(t.participant_count===null?'':Number(t.participant_count))+'" '+(!canManage?'disabled':'')+'></label>'+
        '<button class="btn light" type="button" data-save-team="'+E(t.id)+'" '+(!canManage?'disabled':'')+'>Guardar</button></div></article>';
    }).join('')||'<div class="item muted">No hay equipos registrados.</div>');
  }
  function renderRequests(){
    $('requestList').innerHTML=err('requests')+(state.requests.map(r=>{
      return '<article class="item"><h3>'+E(r.organization)+'</h3><p><b>'+E(r.area)+':</b> '+E(r.subject)+'</p>'+
      '<div class="tools"><label>Estado <select data-request-status="'+E(r.id)+'" '+(!canManage?'disabled':'')+'>'+opt(requestStates,r.status)+'</select></label></div>'+
      '<div class="tools"><label style="flex:1">Notas, seguimiento o n.º de ingreso <input data-request-note="'+E(r.id)+'" type="text" value="'+E(r.notes||'')+'" '+(!canManage?'disabled':'')+'></label>'+
      '<button class="btn light" type="button" data-save-request="'+E(r.id)+'" '+(!canManage?'disabled':'')+'>Guardar</button></div>'+
      (r.sent_at?'<p class="muted">Envío registrado: '+day(r.sent_at)+'</p>':'')+'</article>';
    }).join('')||'<div class="item muted">No hay gestiones registradas.</div>');
  }
  function renderTasks(){
    const search=$('taskSearch').value.trim().toLowerCase();
    const filter=$('taskFilter').value;
    const visible=state.tasks.filter(t=>(filter==='all'||(filter==='done'?t.status==='done':t.status!=='done'))&&
      (!search||(String(t.title+' '+t.owner_name+' '+t.code).toLowerCase().includes(search))));
    $('taskList').innerHTML=err('tasks')+(visible.map(t=>
      '<article class="item"><h3>'+E(t.title)+'</h3><p>'+E(t.code||'')+' · '+E(t.owner_name||'Por designar')+' · '+day(t.due_date)+
      ' · '+E(t.priority||'')+'</p><p>'+E(t.notes||'')+'</p><div class="tools"><label>Avance <select data-task-status="'+E(t.id)+'">'+opt(taskStates,t.status)+'</select></label>'+
      '<span class="badge '+(t.status==='done'?'green':t.status==='blocked'?'gray':'')+'">'+E(t.status==='done'?'100%':String(t.progress||0)+'%')+'</span></div></article>'
    ).join('')||'<div class="item muted">No hay tareas en este filtro.</div>');
  }
  function renderChecklist(){
    $('checkGroups').innerHTML=err('checklist')+(state.responsibilities.map(r=>{
      const items=state.checklist.filter(c=>c.responsibility_id===r.id);
      const done=items.filter(c=>c.status==='done').length;
      return '<details class="group"><summary>'+E(r.title)+'<span>'+done+' / '+items.length+' completados</span></summary><div class="content">'+
        '<div class="tools" style="margin-bottom:10px"><label style="flex:1">Responsable <input type="text" data-responsible-name="'+E(r.id)+'" value="'+E(r.responsible_name||'POR DESIGNAR')+'" '+(!canManage?'disabled':'')+'></label>'+
        '<button class="btn light" data-save-responsible="'+E(r.id)+'" type="button" '+(!canManage?'disabled':'')+'>Asignar</button></div>'+
        items.map(i=>'<div class="check-row"><input type="checkbox" data-check="'+E(i.id)+'" '+(i.status==='done'?'checked':'')+'>'+
          '<label style="flex:1"><b>'+E(i.title)+'</b><small>'+E(i.evidence_note||'Pendiente de evidencia o constancia')+'</small></label></div>').join('')+
        '</div></details>';
    }).join('')||'<div class="card muted">No hay responsables registrados.</div>');
  }
  function renderBudget(){
    $('budgetList').innerHTML=err('budget')+(state.budget.map(b=>{
      const amount=Number(b.unit_price)>0 ? money(Number(b.quantity||0)*Number(b.unit_price)):'Sin cotizar';
      return '<article class="budget-item"><div><h3>'+E(b.code)+' · '+E(b.title)+'</h3><p>'+E(b.area)+' · '+E(b.status)+' · '+amount+'</p>'+
        '<p>'+E(b.notes||'')+'</p></div><div class="budget-form">'+
        '<label><span>Cantidad</span><input type="number" min="0" step="0.01" data-budget-qty="'+E(b.id)+'" value="'+Number(b.quantity||1)+'" '+(!canManage?'disabled':'')+'></label>'+
        '<label><span>Precio $</span><input type="number" min="0" step="1" data-budget-price="'+E(b.id)+'" value="'+(Number(b.unit_price)>0?Number(b.unit_price):'')+'" placeholder="Por cotizar" '+(!canManage?'disabled':'')+'></label>'+
        '<label><input type="checkbox" data-budget-scope="'+E(b.id)+'" '+(b.in_scope?'checked':'')+' '+(!canManage?'disabled':'')+'> Incluir</label>'+
        '<button class="btn light" type="button" data-save-budget="'+E(b.id)+'" '+(!canManage?'disabled':'')+'>Guardar</button></div></article>';
    }).join('')||'<div class="muted">No hay partidas registradas.</div>');
  }
  function renderMilestones(){
    $('milestoneList').innerHTML=err('milestones')+(state.milestones.map(x=>
      '<div class="item"><h3>'+E(x.title)+'</h3><p>'+day(x.due_date)+' · '+E(x.status)+' · '+Number(x.progress||0)+'%</p><p>'+E(x.notes||'')+'</p></div>'
    ).join('')||'<div class="item muted">No hay hitos registrados.</div>');
  }
  function renderFunding(){
    const arr=state.funding.slice().sort((a,b)=>CODES.indexOf(a.code)-CODES.indexOf(b.code));
    $('fundingList').innerHTML=err('funding')+(arr.map(x=>{
      const url=/^https:\/\//.test(String(x.official_url||''))?x.official_url:null;
      return '<article class="item"><h3>'+E(x.name)+'</h3><p>'+E(x.institution||'')+'</p>'+
       '<p>'+E(x.window_text||'Verificar convocatoria.')+'</p><div class="tools"><span class="badge gray">Estado referencial: '+E(x.status||'verificar')+'</span>'+
       (url?'<a href="'+E(url)+'" target="_blank" rel="noopener">Sitio oficial ↗</a>':'')+'</div></article>';
    }).join('')||'<div class="item muted">Consultar subvención municipal, GORE, IND, donaciones deportivas y auspiciadores privados. No se ha adjudicado financiamiento.</div>');
  }
  async function save(table,id,payload,el){
    if(el)el.disabled=true;
    try{
      const r=await sb.from(table).update(payload).eq('id',id).select('id');
      if(r.error)throw r.error;
      if(!(r.data||[]).length)throw new Error('No se pudo guardar. Comprueba tus permisos.');
      await loadAll();
    }catch(e){
      alert('No se pudo guardar el cambio: '+String(e.message||e));
      if(el)el.disabled=false;
    }
  }
  async function handleClick(e){
    const btn=e.target.closest('button');
    if(!btn)return;
    const el=btn.closest('.item,.group,.budget-item');
    if(btn.hasAttribute('data-save-team')){
      if(!canManage)return;
      const id=btn.getAttribute('data-save-team');
      const old=state.teams.find(x=>x.id===id);
      const newStatus=el.querySelector('[data-team-status]').value;
      const countText=el.querySelector('[data-team-count]').value.trim();
      const count=countText===''?null:Number(countText);
      if(!Number.isInteger(count) && count!==null || count!==null && count<0){alert('Indica una cantidad válida o deja el campo vacío.');return;}
      if(newStatus==='confirmed'&&old.status!=='confirmed'&&!confirm('¿Tienes confirmación escrita de este club?'))return;
      if(newStatus==='invited'&&old.status!=='invited'&&!confirm('¿La invitación ya fue enviada realmente?'))return;
      await save('project_teams',id,{status:newStatus,participant_count:count},btn);
    }
    if(btn.hasAttribute('data-save-request')){
      if(!canManage)return;
      const id=btn.getAttribute('data-save-request');
      const old=state.requests.find(x=>x.id===id);
      const newStatus=el.querySelector('[data-request-status]').value;
      const note=el.querySelector('[data-request-note]').value.trim();
      const payload={status:newStatus,notes:note};
      if(newStatus==='sent'&&old.status!=='sent'){
        if(!confirm('¿La solicitud ya se envió realmente? Guarda respaldo de envío.'))return;
        payload.sent_at=new Date().toISOString();
      }
      await save('project_external_requests',id,payload,btn);
    }
    if(btn.hasAttribute('data-save-responsible')){
      if(!canManage)return;
      const id=btn.getAttribute('data-save-responsible');
      const name=el.querySelector('[data-responsible-name]').value.trim();
      if(!name){alert('El responsable no puede quedar vacío.');return;}
      await save('project_responsibilities',id,{responsible_name:name},btn);
    }
    if(btn.hasAttribute('data-save-budget')){
      if(!canManage)return;
      const id=btn.getAttribute('data-save-budget');
      const b=state.budget.find(x=>x.id===id);
      const qty=Number(el.querySelector('[data-budget-qty]').value);
      const price=Number(el.querySelector('[data-budget-price]').value||0);
      const inScope=el.querySelector('[data-budget-scope]').checked;
      if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(price)||price<0){alert('Cantidad y precio deben ser válidos.');return;}
      if(inScope&&price<=0){alert('Registra un valor cotizado mayor que cero antes de incluir la partida.');return;}
      if(inScope&&!confirm('¿El valor proviene de una cotización real? Debes conservar su respaldo.'))return;
      await save('project_budget_items',id,{quantity:qty,unit_price:price,in_scope:inScope,status:price>0?'Cotizado':'Pendiente',notes:price>0?'Monto ingresado por usuario; respaldar cotización en Drive.':b.notes},btn);
    }
  }
  async function handleChange(e){
    const el=e.target;
    if(el.hasAttribute('data-task-status')){
      const id=el.getAttribute('data-task-status');
      const status=el.value,progress=status==='done'?100:status==='in_progress'?40:0;
      await save('tasks',id,{status,progress},el);
    }
    if(el.hasAttribute('data-check')){
      const id=el.getAttribute('data-check');
      const current=state.checklist.find(x=>x.id===id);
      const checked=el.checked;
      const payload={status:checked?'done':'pending'};
      if(checked&&current.evidence_required&&!current.evidence_note&&!current.evidence_url){
        const note=prompt('Este punto exige respaldo. Escribe una referencia concreta del documento, correo o comprobante que acredita su cumplimiento:');
        if(!note||!note.trim()){el.checked=false;return;}
        payload.evidence_note=note.trim();
      }
      await save('responsibility_checklist_items',id,payload,el);
    }
  }
  init();
})();