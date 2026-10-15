(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
 function toast(msg){const old=document.querySelector('.gx-toast');if(old)old.remove();const d=document.createElement('div');d.className='gx-toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
 function csvCell(v){const s=String(v??'').replace(/"/g,'""');return '"'+s+'"'}
 function downloadCSV(filename,rows){if(!rows||!rows.length){toast('No hay datos para exportar.');return}const keys=Object.keys(rows[0]);const csv=[keys.map(csvCell).join(','),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(','))].join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename||'gigantes.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 const scriptSource=document.currentScript?.src||location.href;
 let excelLoader=null;
 async function downloadExcel(filename,rows){
  if(!rows||!rows.length){toast('No hay datos para exportar.');return}
  if(!window.GigantesExcel){
   if(!excelLoader){
    excelLoader=new Promise((resolve,reject)=>{
      const el=document.createElement('script');el.src=new URL('excel-export.js?v=20261015',scriptSource).href;el.async=true;
      el.onload=resolve;el.onerror=()=>reject(Error('No se pudo cargar el exportador Excel'));
      document.head.appendChild(el)
    }).catch(e=>{excelLoader=null;throw e});
   }
   await excelLoader;
  }
  if(!window.GigantesExcel)throw Error('Exportador Excel no disponible');
  const keys=Object.keys(rows[0]);
  const workbook=[GigantesExcel.metadata(document.title,'Reporte autorizado'),
   {name:'Datos',rows:[keys,...rows.map(r=>keys.map(k=>r[k]))]}];
  await GigantesExcel.exportBook((filename||'Gigantes.xlsx').replace(/\\.csv$/i,'.xlsx'),workbook);
 }
 function printPage(title){let h=document.querySelector('.gx-print-title');if(!h){h=document.createElement('h1');h.className='gx-print-title';document.body.prepend(h)}h.textContent=title||document.title;window.print()}
 function tableRows(table){const heads=[...table.querySelectorAll('thead th')].map(x=>x.innerText.trim());return [...table.querySelectorAll('tbody tr')].map(tr=>{const cells=[...tr.children].map(x=>x.innerText.trim());const o={};cells.forEach((v,i)=>o[heads[i]||('Columna '+(i+1))]=v);return o})}
 function addTools(opts={}){
   const target=opts.target?document.querySelector(opts.target):document.querySelector('main');
   if(!target||target.querySelector(':scope > .gx-page-tools'))return;
   const bar=document.createElement('div');bar.className='gx-page-tools';
   const p=document.createElement('button');p.type='button';p.className='gx-primary';p.textContent='🖨️ Imprimir';p.onclick=()=>printPage(opts.title);bar.appendChild(p);
   if(opts.csvRows||opts.tableSelector){
     const getRows=()=>typeof opts.csvRows==='function'?opts.csvRows():opts.csvRows||(document.querySelector(opts.tableSelector)?tableRows(document.querySelector(opts.tableSelector)):[]);
     const e=document.createElement('button');e.type='button';e.textContent='⬇ CSV';e.onclick=()=>downloadCSV(opts.filename||'gigantes.csv',getRows());bar.appendChild(e);
     const x=document.createElement('button');x.type='button';x.textContent='📊 Exportar Excel (.xlsx)';x.onclick=async()=>{x.disabled=true;try{await downloadExcel(opts.filename||'gigantes.xlsx',getRows())}catch(err){toast('Error al exportar: '+err.message)}finally{x.disabled=false}};bar.appendChild(x)
   }
   target.prepend(bar);
 }
 function guide(opts={}){
   const target=document.querySelector(opts.target||'main');if(!target||target.querySelector('.gx-guide'))return;
   const d=document.createElement('div');d.className='gx-guide';
   d.innerHTML='<strong>'+esc(opts.title||'¿Qué hago aquí?')+'</strong><p>'+esc(opts.text||'Sigue los pasos en orden.')+'</p>'+(opts.steps?.length?'<div class="gx-steps">'+opts.steps.map((s,i)=>'<div class="gx-step"><b>'+(i+1)+'. '+esc(s.title||s)+'</b>'+(s.text?esc(s.text):'')+'</div>').join('')+'</div>':'');
   target.prepend(d);
 }
 function help(opts={}){
   if(document.querySelector('.gx-help-fab'))return;
   const b=document.createElement('button');b.className='gx-help-fab';b.type='button';b.textContent='?';b.title='Ayuda de esta pantalla';
   const p=document.createElement('aside');p.className='gx-help-panel';p.innerHTML='<h3>'+esc(opts.title||'Ayuda rápida')+'</h3><p>'+esc(opts.text||'Usa esta pantalla siguiendo los pasos indicados.')+'</p>'+(opts.steps?.length?'<ol>'+opts.steps.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol>':'');
   b.onclick=()=>p.classList.toggle('open');document.body.append(p,b);
 }
 window.GigantesUX={toast,downloadCSV,downloadExcel,printPage,tableRows,addTools,guide,help};
})();