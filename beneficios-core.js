// Shared display helpers. No credentials or private finance data are stored here.
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value,base=document.baseURI){try{if(!value)return '';const u=new URL(value,base);return u.protocol==='https:' || (u.origin===location.origin && u.protocol==='http:') ? u.href : '';}catch{return '';}}
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateLabel = value => value ? new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value.slice(0,10)+'T12:00:00')) : 'Sin fecha de término publicada';
export const money = value => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(value));
export function client(){if(!window.supabase || !window.GIGANTES_SUPABASE_URL)throw new Error('No se pudo conectar con la aplicación. Recarga la página.');const options=window.GIGANTES_AUTH_STORAGE?{auth:{storage:window.GIGANTES_AUTH_STORAGE,persistSession:true,autoRefreshToken:true}}:undefined;return window.supabase.createClient(window.GIGANTES_SUPABASE_URL,window.GIGANTES_SUPABASE_PUBLISHABLE_KEY,options);}
export function result(el,message,error=false){el.textContent=message;el.className='result '+(error?'error':'success');}
