import {esc,safeUrl,today,dateLabel,client,result} from './beneficios-core.js';
const $=id=>document.getElementById(id);let sb;
function validNow(p){return p.active && p.starts_on<=today() && (!p.ends_on||p.ends_on>=today());}
function partnerCard(p){
 const logos=[p.logo_url,p.secondary_logo_url].map((src,i)=>{const u=safeUrl(src);return u?`<img src="${esc(u)}" alt="${esc(i?'Marca asociada a '+p.name:p.name)}" loading="lazy">`:'';}).join('');
 const website=safeUrl(p.website),phone=String(p.whatsapp||'').replace(/\D/g,'');
 return `<article class="partner"><div class="partner-top"><span class="tag">${esc(p.featured?'Empresa destacada':p.category)}</span><span class="small muted">${esc(p.category)}</span></div><div class="partner-body"><div class="logos">${logos||'<strong>'+esc(p.name)+'</strong>'}</div><div>${p.discount_percent!==null?`<div class="discount">${esc(p.discount_percent)}%</div>`:''}<h3>${esc(p.benefit_title)}</h3><strong>${esc(p.name)}</strong><p class="muted">${esc(p.description)}</p><span class="tag gray">Jugadores al día · Hinchas vigentes</span><details><summary>Condiciones del convenio</summary><p class="pre-wrap">${esc(p.conditions)}</p><p class="small muted">Desde ${esc(dateLabel(p.starts_on))} · ${esc(dateLabel(p.ends_on))}</p>${p.address?'<p class="small">'+esc(p.address)+'</p>':''}<p class="small">El programa está en preparación. Consulta al establecimiento antes de contratar; esta ficha no reemplaza una credencial validada.</p></details><div class="actions">${phone.length>=8&&phone.length<=15?`<a class="btn primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/${phone}?text=${encodeURIComponent('Hola, quisiera consultar el convenio Beneficios Gigantes de Azapa.')}" >Consultar por WhatsApp</a>`:''}${website?`<a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(website)}">Sitio de la empresa</a>`:''}<a class="btn" href="#credencial">Mi credencial</a></div></div></div></article>`;
}
async function loadCatalog(){
 $('retry-catalog').hidden=true;
 try{
  const [pr,mr]=await Promise.all([sb.from('benefit_partners').select('*').eq('active',true).order('featured',{ascending:false}).order('name'),sb.from('benefit_promotions').select('*').eq('active',true).order('ends_on')]);
  if(pr.error)throw pr.error;
  const partners=(pr.data||[]).filter(validNow),names=new Map(partners.map(p=>[p.id,p.name]));
  $('partner-count').textContent=partners.length+' convenio'+(partners.length===1?'':'s')+' publicado'+(partners.length===1?'':'s');
  $('catalog').innerHTML=partners.length?partners.map(partnerCard).join(''):'<div class="empty">Todavía no hay convenios vigentes publicados.</div>';
  if(mr.error){$('promotions').innerHTML='<div class="empty">No pudimos cargar las promociones. Vuelve a intentarlo.</div>';$('retry-catalog').hidden=false;return;}
  const promos=(mr.data||[]).filter(p=>validNow(p)&&names.has(p.partner_id));
  $('promotions').innerHTML=promos.length?promos.map(p=>`<article class="card"><span class="tag">${p.audience==='public'?'Público general':'Exclusivo para miembros'}</span><h3>${esc(p.title)}</h3><strong class="small">${esc(names.get(p.partner_id))}</strong><p class="pre-wrap">${esc(p.description)}</p><p class="small muted">${esc(dateLabel(p.starts_on))} — ${esc(dateLabel(p.ends_on))}</p></article>`).join(''):'<div class="empty">No hay promociones temporales publicadas. Los beneficios del programa se muestran arriba.</div>';
 }catch(e){$('catalog').innerHTML='<div class="empty">No pudimos consultar los convenios. Revisa tu conexión y vuelve a intentarlo.</div>';$('partner-count').textContent='Consulta no disponible';$('promotions').innerHTML='<div class="empty">Publicaciones no disponibles.</div>';$('retry-catalog').hidden=false;}
}
function wireForm(id,isSupporter){const form=$(id);form.addEventListener('submit',async event=>{
 event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form),button=form.querySelector('button[type=submit]'),out=form.querySelector('.result');if(data.get('website_check'))return;if(button.disabled)return;
 const name=String(data.get('contact_name')||'').trim(),email=String(data.get('email')||'').trim(),phone=String(data.get('phone')||'').trim();
 if(name.length<2 || phone.replace(/\D/g,'').length<7){result(out,'Revisa el nombre y el teléfono de contacto.',true);return;}
 const message=isSupporter?'Solicitud de incorporación Hincha Gigante ($2.000 CLP/mes). Mayor de edad. Consentimiento de contacto aceptado, versión 2026-10-v1. Sin cobro ni activación automática.':`Beneficio propuesto: ${String(data.get('benefit')||'').trim()}\nApoyo a conversar: ${data.get('mode')}\n${String(data.get('message')||'').trim()}\nConsentimiento de contacto aceptado, versión 2026-10-v1. Propuesta por revisar, no constituye convenio ni cobro.`;
 const payload={organization:isSupporter?'Hincha Gigante':String(data.get('organization')||'').trim(),contact_name:name,email,phone,interest:isSupporter?'hincha_gigante':'beneficios_empresa',project_code:'BENEFICIOS',message,status:'new'};
 if(payload.organization.length<2){result(out,'Revisa el nombre de la empresa.',true);return;}
 button.disabled=true;result(out,'Enviando solicitud…');
 try{const r=await sb.from('sponsor_inquiries').insert(payload);if(r.error)throw r.error;form.reset();result(out,isSupporter?'Solicitud recibida por la directiva. Tu incorporación queda pendiente de revisión; no se ha cobrado ni activado una membresía.':'Propuesta recibida por la directiva. El beneficio y el aporte quedan pendientes de acuerdo.');}
 catch(e){result(out,'No se pudo registrar la solicitud. Tus datos siguen en el formulario. Revisa la conexión antes de volver a enviarla.',true);}finally{button.disabled=false;}
 });}
try{sb=client();wireForm('hincha-form',true);wireForm('company-form',false);$('retry-catalog').onclick=loadCatalog;loadCatalog();}catch(e){result($('catalog'),e.message,true);document.querySelectorAll('button[type=submit]').forEach(b=>b.disabled=true);}
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
