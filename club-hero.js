/* Hero fotografico rotativo · Gigantes de Azapa */
(()=>{
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  if(page==='index.html'||page==='') return;
  const ARCHIVE='https://raw.githubusercontent.com/gigantesazapasalta2026-sudo/gigantes-media-archive/main/';
  const photos=[
    'app-2026/comunidad-familias-arica.jpg',
    'app-2026/entrenamiento-m10-m12-m14.jpg',
    'app-2026/m10-equipo.jpg',
    'app-2026/m14-equipo.jpg',
    'app-2026/entrenamiento-playa.jpg',
    'app-2026/compartiendo-otros-equipos.jpg',
    'app-2026/dia-del-nino.jpg',
    'app-2026/classic-arica.jpg',
    'app-2026/hero-classic-abrazados.jpg',
    'Ni%C3%B1os%20reunidos.jpg',
    'Rugby%20estadio.jpg',
    '3er%20tiempo.jpg'
  ].map(p=>ARCHIVE+p);

  function hashPath(){
    const s=location.pathname+location.search;
    let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return h;
  }
  function init(){
    const hero=document.querySelector('.hero');
    if(!hero||hero.dataset.gigantesHero==='1') return;
    hero.dataset.gigantesHero='1';
    hero.classList.add('gigantes-photo-hero');

    const a=document.createElement('div');
    const b=document.createElement('div');
    const shade=document.createElement('div');
    a.className='gigantes-hero-bg is-active';
    b.className='gigantes-hero-bg';
    shade.className='gigantes-hero-shade';
    hero.prepend(shade); hero.prepend(b); hero.prepend(a);

    const seed=hashPath()%photos.length;
    let idx=seed;
    let front=a, back=b;
    front.style.backgroundImage='url("'+photos[idx]+'")';

    const preload=(u)=>{const im=new Image();im.src=u};
    preload(photos[(idx+1)%photos.length]);

    if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setInterval(()=>{
      idx=(idx+1)%photos.length;
      back.style.backgroundImage='url("'+photos[idx]+'")';
      back.classList.add('is-active');
      front.classList.remove('is-active');
      const old=front; front=back; back=old;
      preload(photos[(idx+1)%photos.length]);
    },6000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();