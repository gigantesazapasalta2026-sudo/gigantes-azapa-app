const sb=supabase.createClient(GIGANTES_SUPABASE_URL,GIGANTES_SUPABASE_PUBLISHABLE_KEY,{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}});
(async()=>{
 const {data:{session}}=await sb.auth.getSession();
 if(!session){location.href='login.html?next=guia-responsables.html';return}
 const [{data:p},{data:pp},{data:dp}]=await Promise.all([
  sb.from('profiles').select('role,active').eq('user_id',session.user.id).maybeSingle(),
  sb.from('user_permissions').select('active').eq('user_id',session.user.id).eq('permission_code','protection.reports.manage').maybeSingle(),
  sb.from('user_permissions').select('active').eq('user_id',session.user.id).eq('permission_code','discipline.manage').maybeSingle()
 ]);
 if(!p?.active){document.body.innerHTML='<main class="main wrap"><div class="card">Tu cuenta no está activa.</div></main>';return}
 const canProtection=p.role==='superadmin'||pp?.active===true;
 const canDiscipline=p.role==='superadmin'||dp?.active===true;
 roleState.textContent=canProtection&&canDiscipline?'Tu cuenta puede revisar ambas guías.':canProtection?'Tu acceso corresponde a Protección / DS22.':canDiscipline?'Tu acceso corresponde a Comisión de Disciplina.':'Tu cuenta todavía no tiene un rol operativo asignado.';
 function show(role){
   const ri=role==='ri';riGuide.classList.toggle('hide',!ri);discGuide.classList.toggle('hide',ri);
   riTab.className='btn '+(ri?'':'sec');discTab.className='btn '+(ri?'sec':'');
 }
 riTab.onclick=()=>show('ri');discTab.onclick=()=>show('disc');
 if(canProtection)show('ri'); else if(canDiscipline)show('disc'); else {riGuide.classList.add('hide');discGuide.classList.add('hide')}
})();