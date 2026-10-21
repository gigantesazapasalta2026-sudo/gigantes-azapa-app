/* Shared portal utilities. No personal data or invitation secrets are bundled. */
(()=>{
  'use strict';
  const constants=Object.freeze({
    eventDate:'2026-10-24',
    basesUrl:'https://raw.githubusercontent.com/gigantesazapasalta2026-sudo/gigantes-media-archive/main/copa-fufy/01_BASES_OFICIALES_COPA_FUFY_2026_V1.2.pdf',
    rugbyRegister:'https://bd.chile.rugby/registro',
    rugbyLogin:'https://bd.chile.rugby/users/login',
    rugbyInfo:'https://chile.rugby/bd-chile-rugby/'
  });
  const labels={draft:'Borrador',submitted:'Enviada a revisión',observed:'Con observaciones',approved:'Expediente revisado',pending:'Pendiente',declared:'Declarado por el club',not_applicable:'No corresponde / visitante',reviewed:'Revisado por organización',insurance:'Seguro',prevision:'Previsión de salud',other:'Otros medios de atención',signed_roster:'Nómina y declaraciones firmadas',manager_declaration:'Declaración firmada del mánager',player_declaration:'Declaración firmada del jugador',federation:'Respaldo Chile Rugby',identity:'Documento de identidad',organizer:'Organizador',roster_pending:'Nómina pendiente',confirmed:'Confirmado'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function normalizeAccessKey(value,kind='club'){
    if(typeof value!=='string'||!['club','admin'].includes(kind))return '';
    let candidate=value.trim();
    if(!candidate||candidate.length>1200)return '';
    if(candidate.includes('#')){
      try{
        const url=new URL(candidate,'https://gigantesdeazapa.cl/');
        const fragment=new URLSearchParams(url.hash.slice(1));
        candidate=(fragment.has('acceso')?fragment.get('acceso'):fragment.get('access'))||'';
        candidate=candidate.trim();
      }catch{return ''}
    }
    if(kind==='club'&&/^[a-f0-9]{64}$/i.test(candidate))return candidate.toLowerCase();
    const compact=candidate.replace(/[\s-]+/g,'').toUpperCase();
    const prefix=kind==='admin'?'ADMIN':'FUFY';
    const length=kind==='admin'?20:16;
    if(!compact.startsWith(prefix))return '';
    const secret=compact.slice(prefix.length);
    if(secret.length!==length||!/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(secret))return '';
    return prefix+'-'+secret.match(/.{4}/g).join('-');
  }
  async function send(body,auth={},upload=false){
    const url=window.GIGANTES_SUPABASE_URL;
    const key=window.GIGANTES_SUPABASE_PUBLISHABLE_KEY;
    if(!url||!key)throw new Error('No se pudo cargar la configuración. Recarga esta página.');
    if([auth.token,auth.jwt,auth.adminKey].filter(Boolean).length>1)throw new Error('Usa un solo tipo de acceso en cada solicitud.');
    const headers={apikey:key};
    if(!upload)headers['Content-Type']='application/json';
    if(auth.token){
      const token=normalizeAccessKey(auth.token,'club');
      if(!token)throw new Error('La clave del club no tiene un formato válido. Revisa la clave o el enlace recibido.');
      headers['X-Fufy-Token']=token;
    }
    if(auth.jwt)headers.Authorization='Bearer '+auth.jwt;
    if(auth.adminKey){
      const adminKey=normalizeAccessKey(auth.adminKey,'admin');
      if(!adminKey)throw new Error('La clave de administración no tiene un formato válido. Revisa la clave recibida.');
      headers['X-Fufy-Admin-Key']=adminKey;
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),upload?60000:30000);
    try{
      const response=await fetch(url+'/functions/v1/fufy-club-portal',{method:'POST',headers,body:upload?body:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      let data;try{data=await response.json()}catch{throw new Error('El servicio no entregó una respuesta válida. Vuelve a intentar.')}
      if(!response.ok){const error=new Error(data.error||'No se pudo completar la acción.');error.status=response.status;throw error}
      return data;
    }catch(error){
      if(error.name==='AbortError')throw new Error('La conexión tardó demasiado. Recarga para comprobar si los datos se guardaron antes de volver a intentar.');
      if(error instanceof TypeError)throw new Error('No se pudo conectar. Comprueba tu conexión y vuelve a intentar.');
      throw error;
    }finally{clearTimeout(timer)}
  }
  function downloadCSV(filename,rows){
    const cell=value=>{
      let s=String(value??'');
      if(/^[\s\uFEFF]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
  }
  function ageOnEvent(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
    const [year,month,day]=value.split('-').map(Number);
    return 2026-year-((month>10||(month===10&&day>24))?1:0);
  }
  function formatDate(value){
    if(!value)return '—';
    const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00-03:00':value);
    return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeZone:'America/Santiago'}).format(date);
  }
  window.FufyPortal=Object.freeze({constants,esc,normalizeAccessKey,request:(action,payload={},auth={})=>send({action,...payload},auth),upload:(formData,auth={})=>send(formData,auth,true),downloadCSV,formatDate,ageOnEvent,statusLabel:value=>labels[value]||value||'—'});
})();
