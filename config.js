/* Gigantes de Azapa · backend privado.
   La publishable key es apta para navegador porque las tablas privadas usan RLS.
   NUNCA agregar service_role/secret keys a este repositorio publico. */
window.GIGANTES_SUPABASE_URL = "https://euuzsojkinbwcvtpwoau.supabase.co";
window.GIGANTES_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Mv2-Dmoh24cSI_CYFFgA5w_cB26bEGP";
// Add benefits links without replacing existing screens or authentication logic.
(()=>{const own=document.currentScript;if(!own?.src)return;const s=document.createElement('script');s.src=new URL('beneficios-access.js?v=1',own.src).href;s.defer=true;document.head.appendChild(s);})();
// Private inventory documents: only attach to the Control Center page.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);const folder=new URL('gestion/',own.src);if(location.origin!==center.origin||![center.pathname,folder.pathname].includes(location.pathname))return;const s=document.createElement('script');s.src=new URL('gestion/inventory-documents.js?v=20261002-1',own.src).href;s.defer=true;document.head.appendChild(s);})();
// Add final audit shortcut to Control Center tools without changing the large control file.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);if(location.origin!==center.origin||location.pathname!==center.pathname)return;const add=()=>{const menu=document.querySelector('.more-panel');if(!menu||menu.querySelector('a[href="auditoria-final.html"]'))return;const a=document.createElement('a');a.href='auditoria-final.html';a.textContent='✅ Auditoría final 8/8';const before=menu.querySelector('a[href="comunicaciones.html"]');before?menu.insertBefore(a,before):menu.appendChild(a)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();})();
// Add Formación y Academia shortcut to the Control Center tools.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);if(location.origin!==center.origin||location.pathname!==center.pathname)return;const add=()=>{const menu=document.querySelector('.more-panel');if(!menu||menu.querySelector('a[href="formacion.html"]'))return;const a=document.createElement('a');a.href='formacion.html';a.textContent='🎓 Formación y Academia';const before=menu.querySelector('a[href="proyectos.html"]');before?menu.insertBefore(a,before):menu.appendChild(a)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();})();

// Private document library across authenticated management pages.
(()=>{const own=document.currentScript;if(!own?.src)return;const base=new URL('gestion/',own.src);if(location.origin!==base.origin||!location.pathname.startsWith(base.pathname))return;const page=location.pathname.slice(base.pathname.length);if(['login.html','biblioteca.html','presentacion.html'].includes(page))return;const start=()=>{const s=document.createElement('script');s.src=new URL('document-library.js?v=20261006-1',base).href;document.head.appendChild(s);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();})();

// Resilient browser storage for Supabase Auth: sessionStorage first, mirrored to localStorage.
window.GIGANTES_AUTH_STORAGE={
  getItem(key){try{const s=sessionStorage.getItem(key);if(s!==null)return s}catch{}try{return localStorage.getItem(key)}catch{return null}},
  setItem(key,value){try{sessionStorage.setItem(key,value)}catch{}try{localStorage.setItem(key,value)}catch{}},
  removeItem(key){try{sessionStorage.removeItem(key)}catch{}try{localStorage.removeItem(key)}catch{}}
};

// Add private player-development shortcut to Control Center tools.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);if(location.origin!==center.origin||location.pathname!==center.pathname)return;const add=()=>{const menu=document.querySelector('.more-panel');if(!menu||menu.querySelector('a[href="desarrollo-jugadores.html"]'))return;const a=document.createElement('a');a.href='desarrollo-jugadores.html';a.textContent='🏉 Desarrollo del Jugador';const before=menu.querySelector('a[href="formacion.html"]');before?menu.insertBefore(a,before):menu.appendChild(a)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();})();

// Family and guardian management shortcut.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);if(location.origin!==center.origin||location.pathname!==center.pathname)return;const add=()=>{const menu=document.querySelector('.more-panel');if(!menu||menu.querySelector('a[href="familias.html"]'))return;const a=document.createElement('a');a.href='familias.html';a.textContent='👨‍👩‍👧‍👦 Familias y Apoderados';const before=menu.querySelector('a[href="formacion.html"]');before?menu.insertBefore(a,before):menu.appendChild(a)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();})();

// Member validation shortcut.
(()=>{const own=document.currentScript;if(!own?.src)return;const center=new URL('gestion/index.html',own.src);if(location.origin!==center.origin||location.pathname!==center.pathname)return;const add=()=>{const menu=document.querySelector('.more-panel');if(!menu||menu.querySelector('a[href="validacion.html"]'))return;const a=document.createElement('a');a.href='validacion.html';a.textContent='✅ Centro de Validación';const before=menu.querySelector('a[href="familias.html"]');before?menu.insertBefore(a,before):menu.appendChild(a)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add,{once:true});else add();})();
