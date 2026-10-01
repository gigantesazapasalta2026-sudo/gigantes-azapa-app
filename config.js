/* Gigantes de Azapa · backend privado.
   La publishable key es apta para navegador porque las tablas privadas usan RLS.
   NUNCA agregar service_role/secret keys a este repositorio publico. */
window.GIGANTES_SUPABASE_URL = "https://euuzsojkinbwcvtpwoau.supabase.co";
window.GIGANTES_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Mv2-Dmoh24cSI_CYFFgA5w_cB26bEGP";
// Add benefits links without replacing existing screens or authentication logic.
(()=>{const own=document.currentScript;if(!own?.src)return;const s=document.createElement('script');s.src=new URL('beneficios-access.js?v=1',own.src).href;s.defer=true;document.head.appendChild(s);})();
