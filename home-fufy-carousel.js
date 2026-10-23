/* Copa FUFY: slider accesible de afiches y comunidad en la portada. */
(()=>{
'use strict';
const ARCH='https://raw.githubusercontent.com/gigantesazapasalta2026-sudo/gigantes-media-archive/main/';
const slides=[
{title:'Copa FUFY 2026 · Invitación',type:'image',src:ARCH+'copa-fufy/FUFY_2026_Vive_la_Copa_Promocion.jpg',href:'fufy.html#invitacion',alt:'Afiche oficial Vive la Copa FUFY 2026'},
{title:'Nuestros Gigantes unidos',type:'photo',src:ARCH+'app-2026/hero-classic-abrazados.jpg',href:'fufy.html#clubes-invitados',alt:'Equipo Classic Gigantes de Azapa abrazado antes de jugar'},
{title:'Gracias a los 19 auspiciadores',type:'image',src:ARCH+'copa-fufy/auspiciadores/flyer-agradecimiento-19-2026.png',href:'auspiciadores-fufy.html',alt:'Flyer oficial de agradecimiento a los 19 auspiciadores de Copa FUFY 2026',kind:'sponsors'},
{title:'Ventas del sábado · Precios',type:'sales',href:'fufy.html#ventas'},
{title:'Programa del sábado',type:'program',href:'fufy.html#itinerario'},
{title:'Afiche institucional Copa FUFY',type:'image',src:ARCH+'copa-fufy/FUFY_2026_Afiche_Oficial.jpg',href:'fufy.html#invitacion',alt:'Afiche institucional oficial Copa FUFY 2026'}
];
const esc=x=>String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const data=[
['🥟 Empanadas','$2.500'],['🌭 Chaparritas','$2.000'],['🥤 Bebidas','$1.500'],['🍩 Roscas','4 por $1.000'],['🍦 Helados','$1.000'],['🍣 Rolls sushi','$2.500']
];
const schedule=[['09:30','Primer partido Classic (2 × 15)'],['10:20','Segundo partido Classic'],['11:20','Festival infantil'],['12:22','Inauguración y homenajes'],['13:05','Rugby Classic · tarde'],['17:40','Premiación y tercer tiempo en Bar República']];
function markup(s,i){
let body='';
if(s.type==='image'||s.type==='photo'){
 body='<img src="'+esc(s.src)+'" alt="'+esc(s.alt)+'" loading="'+(i?'lazy':'eager')+'" decoding="async">';
 if(s.type==='photo')body+='<div class="promoPhotoOverlay"><strong>Una sola familia, una misma pasión</strong><span>El rugby nos reúne dentro y fuera de la cancha.</span></div>';
}else if(s.type==='sales'){
 body='<div class="promoSalesPoster"><div><div class="promoPosterEyebrow">Gigantes de Azapa · Copa FUFY</div><h3>¡Sabores para compartir!</h3><p class="promoPosterSub">Sábado 24 de octubre · Estadio Carlos Dittborn</p></div><div class="promoSalesGrid">'+data.map(x=>'<div class="promoSaleItem"><b>'+esc(x[0])+'</b><span>'+esc(x[1])+'</span></div>').join('')+'</div><div class="promoPosterFoot">Con tu compra apoyas al rugby de Gigantes. ¡Te esperamos!</div></div>';
}else if(s.type==='program'){
 body='<div class="promoProgramPoster"><div class="promoPosterEyebrow">Copa FUFY · Sábado 24 de octubre</div><h3>Programa de la jornada</h3><div class="promoProgramRows">'+schedule.map(x=>'<div class="promoProgramRow"><strong>'+esc(x[0])+'</strong><span>'+esc(x[1])+'</span></div>').join('')+'</div><div class="promoPosterFoot">Consulta el programa oficial y posibles ajustes en la página de Copa FUFY.</div></div>';
}
return '<a class="promoSlide promoSlide--'+(s.type==='image'?(s.kind||'image'):s.type)+(i===0?' is-active':'')+'" href="'+esc(s.href)+'" aria-label="'+esc(s.title)+'" aria-hidden="'+(i===0?'false':'true')+'" tabindex="'+(i===0?'0':'-1')+'" data-promo-slide="'+i+'">'+body+'</a>';
}
function mount(){
const anchor=document.getElementById('weeklyPromoMedia');
if(!anchor||document.getElementById('homeFufyCarousel'))return;
const root=document.createElement('div');root.id='homeFufyCarousel';root.className='promoCarousel';root.setAttribute('role','region');root.setAttribute('aria-roledescription','carrusel');root.setAttribute('aria-label','Afiches y novedades de Copa FUFY 2026');
root.innerHTML='<div class="promoStage" id="promoStage">'+slides.map(markup).join('')+'</div><div class="promoNav"><button class="promoArrow" id="promoPrev" type="button" aria-label="Afiche anterior">‹</button><div class="promoDots">'+slides.map((s,i)=>'<button class="promoDot" type="button" data-promo-to="'+i+'" aria-label="Ver '+esc(s.title)+'" aria-current="'+(i===0?'true':'false')+'"></button>').join('')+'</div><button class="promoArrow" id="promoNext" type="button" aria-label="Afiche siguiente">›</button></div><p class="promoCaption" id="promoCaption">'+esc(slides[0].title)+'</p><div class="promoSrStatus" id="promoStatus" role="status" aria-live="polite"></div>';
anchor.replaceWith(root);
const cards=[...root.querySelectorAll('[data-promo-slide]')],dots=[...root.querySelectorAll('[data-promo-to]')],caption=root.querySelector('#promoCaption'),sr=root.querySelector('#promoStatus');
const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let current=0,interval=null,touchX=null;
function go(n,announce){
 const next=(n+slides.length)%slides.length;if(next===current)return;
 cards[current].classList.remove('is-active');cards[current].setAttribute('aria-hidden','true');cards[current].tabIndex=-1;
 dots[current].setAttribute('aria-current','false');current=next;
 cards[current].classList.add('is-active');cards[current].setAttribute('aria-hidden','false');cards[current].tabIndex=0;
 dots[current].setAttribute('aria-current','true');caption.textContent=slides[current].title;
 if(announce)sr.textContent=slides[current].title;
 const following=slides[(current+1)%slides.length];if(following.src){const im=new Image();im.src=following.src;}
}
const pause=()=>{if(interval){clearInterval(interval);interval=null;}};
const play=()=>{if(!reduced&&!document.hidden&&!interval)interval=setInterval(()=>go(current+1,false),5600);};
const navigate=(n)=>{go(n,true);pause();play();};
root.querySelector('#promoPrev').addEventListener('click',()=>navigate(current-1));
root.querySelector('#promoNext').addEventListener('click',()=>navigate(current+1));
dots.forEach((el,i)=>el.addEventListener('click',()=>navigate(i)));
root.addEventListener('mouseenter',pause);root.addEventListener('mouseleave',play);
root.addEventListener('focusin',pause);root.addEventListener('focusout',()=>{if(!root.contains(document.activeElement))play();});
root.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();navigate(current+(e.key==='ArrowRight'?1:-1));}});
const stage=root.querySelector('#promoStage');
stage.addEventListener('touchstart',e=>{touchX=e.touches.length===1?e.touches[0].clientX:null;pause();},{passive:true});
stage.addEventListener('touchend',e=>{if(touchX!==null&&e.changedTouches.length===1){const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>35)navigate(current+(dx<0?1:-1));}touchX=null;play();},{passive:true});
document.addEventListener('visibilitychange',()=>document.hidden?pause():play());
const io=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))play();else pause();},{threshold:.1}):null;
if(io)io.observe(root);else play();
window.GIGANTES_FUFY_CAROUSEL={go:n=>navigate(n),count:slides.length};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();