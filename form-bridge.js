// form-bridge.js — Gigantes de Azapa · Club Deportivo · Plataforma Central
const GIGANTES = {
  LOGO: "LOGO GIGANTES.jpeg",
  BASE: new URL("./", window.location.href).href,
  FOTOS: {
    video: "niños llegando a jugar.mov",
    m10m12: "m10m12.jpg",
    m10m12b: "1 m10m12.jpg",
    entrenamiento: "entrenamiento.jpg",
    entrenadores: "Entrenadores.jpg",
    ninos2: "Niños reunidos 2.jpg",
    ninos: "Niños reunidos.jpg",
    m14: "m14.jpg",
    tercer: "3er tiempo.jpg",
    fogata: "fogata formando club.jpg",
    estadio: "Rugby estadio.jpg",
    playa: "rugby playa.jpg"
  },
  PAGINA_FOTO:{
    "inscripcion":"ninos2","documentos_carga":"entrenadores","mi_estado":"m10m12",
    "actividades":"tercer","bingos":"fogata","aportes":"estadio","sponsors":"playa",
    "avance":"estadio","galeria_club":"entrenadores","itinerario":"ninos2",
    "merchandising":"m10m12","directiva":"entrenadores","album_equipo":"m10m12",
    "index":"ninos2","default":"ninos2"
  }
};

function injectTopbar(){
  if(document.getElementById('gb-topbar'))return;
  const css=document.createElement('style');
  css.textContent=`#gb-topbar{position:fixed;top:0;left:0;right:0;z-index:9000;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:rgba(11,15,20,.96);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.15);box-shadow:0 2px 20px rgba(0,0,0,.4);font-family:Arial,sans-serif}#gb-topbar .gb-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;font-weight:900}#gb-topbar .gb-brand img{width:42px;height:42px;border-radius:50%;object-fit:cover;background:#fff;padding:2px;flex-shrink:0}#gb-topbar .gb-brand small{display:block;color:#f36b21;font-size:.62rem;text-transform:uppercase;letter-spacing:.5px}#gb-topbar .gb-brand span{font-size:.88rem}#gb-topbar .gb-btn{width:42px;height:42px;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(255,255,255,.08);color:#fff;font-size:1.4rem;cursor:pointer;flex-shrink:0}#gb-drawer{display:none;position:fixed;top:0;right:0;z-index:9999;width:min(320px,90vw);height:100vh;background:#fff;color:#111;padding:18px;box-shadow:-20px 0 60px rgba(0,0,0,.5);overflow-y:auto;font-family:Arial,sans-serif}#gb-drawer.open{display:block}#gb-drawer .gb-dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}#gb-drawer .gb-x{width:38px;height:38px;border:0;border-radius:8px;background:#111;color:#fff;font-size:1.2rem;cursor:pointer}#gb-drawer a{display:flex;align-items:center;gap:10px;color:#111;text-decoration:none;border-left:4px solid #f36b21;background:#fef3ec;border-radius:0 8px 8px 0;padding:11px 14px;margin:6px 0;font-weight:700;font-size:.88rem}#gb-drawer a:hover{background:#fee4cc}body{padding-top:62px!important}`;
  document.head.appendChild(css);
  const B=GIGANTES.BASE;
  const bar=document.createElement('header');
  bar.id='gb-topbar';
  bar.innerHTML=`<a class="gb-brand" href="${B}index.html"><img src="LOGO GIGANTES.jpeg" alt="Gigantes de Azapa" onerror="this.src='https://placehold.co/42/f36b21/fff?text=G'"><div><small>Gigantes de Azapa</small><span>Club Deportivo · Arica</span></div></a><button class="gb-btn" onclick="document.getElementById('gb-drawer').classList.toggle('open')">☰</button>`;
  document.body.insertBefore(bar,document.body.firstChild);
  const nav=document.createElement('nav');
  nav.id='gb-drawer';
  nav.innerHTML=`<div class="gb-dh"><strong>Menú</strong><button class="gb-x" onclick="document.getElementById('gb-drawer').classList.remove('open')">✕</button></div>
    <a href="${B}index.html">🏠 Portada</a>\n    <a href="${B}proyectos.html">🗂️ Proyectos y giras</a>\n    <a href="${B}inscripcion.html">🏉 Inscribir jugador</a>
    <a href="${B}album_equipo.html">⭐ Álbum del equipo</a>
    <a href="${B}mi_jugador.html">👤 Mi Gigantes</a>
    <a href="${B}lesionado.html">🚑 Jugador lesionado</a>
    <a href="${B}itinerario.html">🗓 Itinerario</a>
    <a href="${B}actividades.html">🤝 Actividades</a>
    <a href="${B}aportes.html">💛 Hacer un aporte</a>
    <a href="${B}merchandising.html">👕 Merchandising</a>
    <a href="${B}bingos.html">🎰 Bingos</a>
    <a href="${B}sponsors.html">🏢 Sponsors</a>
    <a href="${B}avance.html">📊 Avance de meta</a>
    <a href="${B}galeria_club.html">📸 Galería</a>
    <a href="${B}gestion/login.html">🔐 Acceso privado</a>
    `;
  document.body.appendChild(nav);
  document.addEventListener('click',e=>{const d=document.getElementById('gb-drawer');if(d&&!d.contains(e.target)&&!e.target.classList.contains('gb-btn'))d.classList.remove('open');});
}

function injectHeroBg(){
  const hero=document.querySelector('.hero,header.hero,.hero-header');
  if(!hero)return;
  const page=location.pathname.split('/').pop().replace(/\.html?$/,'')||'index';
  const fotoKey=GIGANTES.PAGINA_FOTO[page]||'default';
  const fotoFile=GIGANTES.FOTOS[fotoKey]||GIGANTES.FOTOS.ninos2;

  hero.style.position='relative';
  hero.style.overflow='hidden';
  hero.style.minHeight=hero.style.minHeight||'54vh';

  if(!hero.querySelector('.gb-bg')){
    const bg=document.createElement('div');
    bg.className='gb-bg';
    bg.style.cssText=`position:absolute;inset:0;z-index:0;background-image:url("${encodeURI(fotoFile)}");background-size:cover;background-position:center;`;

    const overlay=document.createElement('div');
    overlay.style.cssText='position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(11,15,20,.35) 0%,rgba(11,15,20,.7) 55%,rgba(11,15,20,.98) 100%)';

    const vid=document.createElement('video');
    vid.autoplay=true;vid.muted=true;vid.loop=true;vid.playsInline=true;
    vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;opacity:.4;';
    vid.innerHTML=`<source src="${encodeURI(GIGANTES.FOTOS.video)}" type="video/mp4">`;

    hero.insertBefore(overlay,hero.firstChild);
    hero.insertBefore(vid,hero.firstChild);
    hero.insertBefore(bg,hero.firstChild);

    Array.from(hero.children).forEach(c=>{
      if(c!==bg&&c!==overlay&&c!==vid){
        if(!c.style.zIndex){
          c.style.position='relative';
          c.style.zIndex='3';
        }
      }
    });
  }
  hero.style.color='#fff';
}

function fixLogos(){
  document.querySelectorAll('img').forEach(img=>{
    const src=img.getAttribute('src')||'';
    if(src.includes('01_APP_SITIO_WEB')||src.includes('logo-gigantes')||src.includes('lh3.google')){
      img.src='LOGO GIGANTES.jpeg';
      img.style.cssText+=';width:42px;height:42px;border-radius:50%;object-fit:cover;background:#fff;padding:2px';
    }
  });
}

async function sendToGigantes(data){
  const url=window.GIGANTES_APPS_SCRIPT_URL;
  if(!url||url.includes('PEGAR'))return{ok:false,configured:false};
  return new Promise(resolve=>{
    const cb='gCb_'+Date.now(),s=document.createElement('script'),u=new URL(url);
    Object.entries(data).forEach(([k,v])=>u.searchParams.set(k,String(v)));
    u.searchParams.set('callback',cb);
    const t=setTimeout(()=>{cleanup();resolve({ok:false,configured:true});},12000);
    function cleanup(){clearTimeout(t);delete window[cb];s.remove();}
    window[cb]=r=>{cleanup();resolve({ok:true,configured:true,...r});};
    s.onerror=()=>{cleanup();resolve({ok:false,configured:true});};
    s.src=u.toString();document.body.appendChild(s);
  });
}

function init(){injectTopbar();injectHeroBg();fixLogos();}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
window.addEventListener('load',fixLogos);
