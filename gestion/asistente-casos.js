const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
const params=new URLSearchParams(location.search),reportId=params.get('report');
let articles=[],channels=[],report=null,canProtection=false,canDiscipline=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9ñ ]+/g,' ').replace(/\s+/g,' ').trim();
const words=s=>norm(s).split(' ').filter(x=>x.length>2);
(async()=>{
 const {data:{session}}=await sb.auth.getSession();
 if(!session){location.href='login.html?next='+encodeURIComponent('asistente-casos.html'+location.search);return}
 const [{data:p},{data:pp},{data:dp}]=await Promise.all([
  sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle(),
  sb.from('user_permissions').select('active').eq('user_id',session.user.id).eq('permission_code','protection.reports.manage').maybeSingle(),
  sb.from('user_permissions').select('active').eq('user_id',session.user.id).eq('permission_code','discipline.manage').maybeSingle()
 ]);
 if(!p?.active){document.body.innerHTML='<main class="main wrap"><div class="card">Tu cuenta no está activa.</div></main>';return}
 canProtection=p.role==='superadmin'||pp?.active===true;
 canDiscipline=p.role==='superadmin'||dp?.active===true;
 if(!canProtection&&!canDiscipline){document.body.innerHTML='<main class="main wrap"><div class="card">Tu cuenta no tiene acceso al Asistente de Casos.</div></main>';return}
 const [a,ch,r]=await Promise.all([
  sb.from('case_guidance_articles').select('*').eq('active',true).order('sort_order'),
  sb.from('protection_dispatch_channels').select('code,institution,purpose,channel_type,official_url,email,notes').order('institution'),
  reportId&&canProtection?sb.from('protection_reports').select('id,case_code,category,status,risk_level,nna_involved,crime_assessment,assigned_to_name').eq('id',reportId).maybeSingle():Promise.resolve({data:null})
 ]);
 articles=(a.data||[]).filter(x=>x.module==='both'||(x.module==='protection'&&canProtection)||(x.module==='discipline'&&canDiscipline));
 channels=ch.data||[];report=r.data||null;
 if(report){caseContext.style.display='block';caseContext.innerHTML='<b>Trabajando sobre '+esc(report.case_code||'expediente DS22')+'</b><br>'+esc(report.category)+' · riesgo '+esc(report.risk_level)+' · '+(report.nna_involved?'NNA involucrado · ':'')+esc(report.crime_assessment)}
 bind();
 if(params.get('q')){question.value=params.get('q');searchGuidance()}
})();
function bind(){
 document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{question.value=(question.value?question.value+' ':'')+b.textContent;searchGuidance()});
 searchBtn.onclick=searchGuidance;clearBtn.onclick=()=>{question.value='';results.innerHTML='<div class="empty">Escribe una situación para comenzar.</div>'};
 question.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')searchGuidance()});
 if(window.wizardBtn)wizardBtn.onclick=startWizard;
 if(window.freeBtn)freeBtn.onclick=()=>{wizard.style.display='none';freeAsk.style.display='grid';question.focus()}
}
let wizardState={risk:null,nna:null,respondent:null,crime:null};
function startWizard(){wizardState={risk:null,nna:null,respondent:null,crime:null};freeAsk.style.display='none';wizard.style.display='block';renderWizardStep(0)}
function wizButtons(options,next){
 return '<div class="actions">'+options.map(o=>'<button class="btn sec" data-v="'+esc(o.v)+'">'+esc(o.t)+'</button>').join('')+'</div>'
}
function renderWizardStep(step){
 const screens=[
  {q:'¿Hay alguien en riesgo ahora mismo?',opts:[{v:'yes',t:'Sí'},{v:'no',t:'No'},{v:'unknown',t:'No estoy seguro'}],key:'risk'},
  {q:'¿Hay un niño, niña o adolescente involucrado?',opts:[{v:'yes',t:'Sí'},{v:'no',t:'No'}],key:'nna'},
  {q:'¿Quién es la persona denunciada?',opts:[{v:'trainer',t:'Entrenador / staff'},{v:'player',t:'Jugador/a'},{v:'parent',t:'Apoderado / familiar'},{v:'leader',t:'Dirigente / voluntario'},{v:'other',t:'Otro'}],key:'respondent'},
  {q:'¿Los hechos podrían constituir delito?',opts:[{v:'yes',t:'Sí / podría ser'},{v:'no',t:'No aparenta delito'},{v:'unknown',t:'No lo sé'}],key:'crime'}
 ];
 if(step>=screens.length){finishWizard();return}
 const s=screens[step];
 wizard.innerHTML='<div class="casebox"><b>Paso '+(step+1)+' de '+screens.length+'</b><br>'+esc(s.q)+'</div>'+wizButtons(s.opts,step+1)+'<div class="actions" style="margin-top:10px"><button id="wizCancel" class="btn sec">Cancelar</button></div>';
 wizard.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{wizardState[s.key]=b.dataset.v;renderWizardStep(step+1)});
 wizCancel.onclick=()=>{wizard.style.display='none';freeAsk.style.display='grid'}
}
function finishWizard(){
 const parts=[];
 if(wizardState.risk==='yes')parts.push('Hay riesgo inmediato y debemos proteger a la persona ahora.');
 else if(wizardState.risk==='unknown')parts.push('No sabemos si existe riesgo inmediato.');
 if(wizardState.nna==='yes')parts.push('Hay un NNA involucrado.');
 if(wizardState.respondent==='trainer')parts.push('La persona denunciada es entrenador o integrante del staff.');
 if(wizardState.respondent==='player')parts.push('La persona denunciada es jugador.');
 if(wizardState.respondent==='parent')parts.push('La persona denunciada es apoderado o familiar.');
 if(wizardState.respondent==='leader')parts.push('La persona denunciada es dirigente o voluntario.');
 if(wizardState.crime==='yes')parts.push('Los hechos podrían constituir delito.');
 else if(wizardState.crime==='no')parts.push('Los hechos no aparentan delito.');
 else parts.push('No sabemos si los hechos podrían constituir delito.');
 question.value=parts.join(' ');
 wizard.innerHTML='<div class="notice"><b>Ruta preparada.</b><br>'+esc(question.value)+'</div><div class="actions"><button id="wizSearch" class="btn">Ver qué hacer ahora</button><button id="wizRestart" class="btn sec">Volver a empezar</button><button id="wizEdit" class="btn sec">Editar como texto</button></div>';
 wizSearch.onclick=searchGuidance;wizRestart.onclick=startWizard;wizEdit.onclick=()=>{wizard.style.display='none';freeAsk.style.display='grid';question.focus()};
 searchGuidance()
}
function scoreArticle(a,q){
 const nq=norm(q),qw=words(q);
 let score=0;
 const title=norm(a.title),short=norm(a.short_answer),guide=norm(a.guidance),who=norm(a.who_is_responsible),legal=norm(a.legal_basis);
 for(const k0 of (a.keywords||[])){const k=norm(k0);if(!k)continue;if(nq.includes(k))score+=k.includes(' ')?8:5;else if(qw.some(w=>k.includes(w)||w.includes(k)))score+=2}
 for(const w of qw){if(title.includes(w))score+=3;if(short.includes(w))score+=2;if(guide.includes(w))score+=1;if(who.includes(w))score+=1;if(legal.includes(w))score+=1}
 if(report){
   if(report.nna_involved&&(a.code==='NNA_INVOLVED'||(a.keywords||[]).some(k=>norm(k)==='nna')))score+=8;
   if(report.crime_assessment==='possible_crime'&&a.code==='POSSIBLE_CRIME')score+=10;
   if(report.crime_assessment==='no_apparent_crime'&&a.code==='NO_APPARENT_CRIME')score+=10;
   if(['critical','high'].includes(report.risk_level)&&(a.risk_tags||[]).includes(report.risk_level))score+=4;
 }
 return score
}
function searchGuidance(){
 const q=question.value.trim();if(q.length<3){results.innerHTML='<div class="empty">Describe un poco más la situación.</div>';return}
 const ranked=articles.map(a=>({a,s:scoreArticle(a,q)})).filter(x=>x.s>0).sort((x,y)=>y.s-x.s||x.a.sort_order-y.a.sort_order).slice(0,6);
 if(!ranked.length){results.innerHTML='<div class="notice"><b>No encontré una regla suficientemente relacionada.</b><br>No improvises una respuesta. Revisa el expediente y escala al Responsable Institucional o a la Comisión según corresponda.</div>';return}
 results.innerHTML=ranked.map((x,i)=>renderArticle(x.a,i)).join('')
}
function renderArticle(a,i){
 const steps=Array.isArray(a.steps)?a.steps:[];
 const ch=channels.find(x=>x.code===a.dispatch_channel_code);
 const sources=Array.isArray(a.source_refs)?a.source_refs:[];
 let actions='';
 if(reportId&&canProtection)actions+='<a class="btn" href="proteccion-caso.html?id='+encodeURIComponent(reportId)+(a.related_doc_type?'&doc='+encodeURIComponent(a.related_doc_type):'')+'">📂 '+(a.related_doc_type?'Aplicar en expediente':'Abrir expediente')+'</a>';
 if(a.module==='discipline'||a.module==='both')actions+='<a class="btn sec" href="disciplina.html">⚖️ Abrir Disciplina</a>';
 if(ch?.official_url)actions+='<a class="btn sec" target="_blank" rel="noopener" href="'+esc(ch.official_url)+'">🌐 '+esc(ch.institution)+'</a>';
 for(const s of sources){if(s.url)actions+='<a class="btn sec" target="_blank" rel="noopener" href="'+esc(s.url)+'">📚 '+esc(s.label||'Fuente')+'</a>'}
 return '<article class="result">'+
  '<div class="meta">Orientación '+(i+1)+' · '+esc(a.module==='both'?'Protección + Disciplina':a.module==='protection'?'Protección / DS22':'Disciplina')+'</div>'+
  '<h2>'+esc(a.title)+'</h2><div class="answer">'+esc(a.short_answer)+'</div>'+
  '<p class="meta" style="font-size:12px;color:#374151">'+esc(a.guidance)+'</p>'+
  '<div class="casebox"><b>👤 Quién está a cargo</b><br>'+esc(a.who_is_responsible)+(a.deadline_text?'<br><br><b>⏱ Plazo</b><br>'+esc(a.deadline_text):'')+(a.legal_basis?'<br><br><b>⚖️ Fundamento</b><br>'+esc(a.legal_basis):'')+'</div>'+
  (steps.length?'<ul class="steps">'+steps.map((s,j)=>'<li><span class="num">'+esc(s.n||j+1)+'</span><span>'+esc(s.t||s.text||'')+'</span></li>').join('')+'</ul>':'')+
  '<div class="actions">'+actions+'</div></article>'
}