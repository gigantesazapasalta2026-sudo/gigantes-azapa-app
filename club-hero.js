/* Hero fotografico rotativo · Gigantes de Azapa
   Fotografias reales del archivo multimedia del club. */
(()=>{
  if(location.pathname.toLowerCase().includes('/gestion/')) return;
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  if(page==='index.html'||page==='') return;
  const ARCHIVE='https://raw.githubusercontent.com/gigantesazapasalta2026-sudo/gigantes-media-archive/main/';
  const common=[
    'app-2026/comunidad-familias-arica.jpg',
    'app-2026/entrenamiento-m10-m12-m14.jpg',
    'app-2026/m10-equipo.jpg',
    'app-2026/m14-equipo.jpg',
    'app-2026/entrenamiento-playa.jpg',
    'app-2026/compartiendo-otros-equipos.jpg',
    'app-2026/dia-del-nino.jpg',
    'app-2026/classic-arica.jpg',
    'app-2026/hero-classic-abrazados.jpg'
  ];
  const specific={
    'inscripcion.html':['app-2026/comunidad-familias-arica.jpg','app-2026/m10-equipo.jpg','app-2026/entrenamiento-m10-m12-m14.jpg','app-2026/dia-del-nino.jpg'],
    'equipo.html':['app-2026/m10-equipo.jpg','app-2026/m14-equipo.jpg','app-2026/classic-arica.jpg','app-2026/comunidad-familias-arica.jpg'],
    'galeria_club.html':['app-2026/comunidad-familias-arica.jpg','app-2026/entrenamiento-playa.jpg','app-2026/compartiendo-otros-equipos.jpg','app-2026/dia-del-nino.jpg'],
    'formacion.html':['app-2026/entrenamiento-m10-m12-m14.jpg','Entrenadores.jpg','app-2026/m12-m14-indumentaria.jpg','app-2026/entrenamiento-playa.jpg'],
    'fufy.html':['app-2026/m10-equipo.jpg','app-2026/m14-equipo.jpg','app-2026/classic-gira-playa-fufy.jpg','app-2026/comunidad-familias-arica.jpg'],
    'recaudacion.html':['app-2026/comunidad-familias-arica.jpg','app-2026/dia-del-nino.jpg','app-2026/entrenamiento-playa.jpg','app-2026/compartiendo-otros-equipos.jpg'],
    'proyecto.html':['app-2026/classic-gira-playa-fufy.jpg','app-2026/compartiendo-otros-equipos.jpg','app-2026/comunidad-familias-arica.jpg','app-2026/entrenamiento-m10-m12-m14.jpg'],
    'proyectos.html':['app-2026/classic-gira-playa-fufy.jpg','app-2026/compartiendo-otros-equipos.jpg','app-2026/comunidad-familias-arica.jpg','app-2026/entrenamiento-m10-m12-m14.jpg'],
    'proteccion.html':['app-2026/comunidad-familias-arica.jpg','app-2026/m10-equipo.jpg','app-2026/dia-del-nino.jpg','app-2026/entrenamiento-m10-m12-m14.jpg']
  };
  const photos=(specific[page]||common).map(p=>ARCHIVE+encodeURI(p));

  function init(){
    const hero=document.querySelector('.hero');
    if(!hero||hero.dataset.gigantesHero==='1') return;
    hero.dataset.gigantesHero='1';
    hero.classList.add('gigantes-photo-hero');

    const a=document.createElement('div'),b=document.createElement('div'),shade=document.createElement('div');
    a.className='gigantes-hero-bg is-active';b.className='gigantes-hero-bg';shade.className='gigantes-hero-shade';
    hero.prepend(shade);hero.prepend(b);hero.prepend(a);

    let idx=0,front=a,back=b,timer=null;
    front.style.backgroundImage='url("'+photos[0]+'")';
    const preload=u=>{const im=new Image();im.src=u};preload(photos[1%photos.length]);

    if(photos.length<2||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const next=()=>{
      idx=(idx+1)%photos.length;
      back.style.backgroundImage='url("'+photos[idx]+'")';
      back.classList.add('is-active');front.classList.remove('is-active');
      const old=front;front=back;back=old;
      preload(photos[(idx+1)%photos.length]);
    };
    const play=()=>{if(!timer)timer=setInterval(next,5600)};
    const pause=()=>{if(timer){clearInterval(timer);timer=null}};
    document.addEventListener('visibilitychange',()=>document.hidden?pause():play());
    play();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();