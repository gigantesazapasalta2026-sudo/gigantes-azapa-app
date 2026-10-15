/* Gigantes Control Center - exportacion Excel (libro XLSX real).
 * Solo exporta datos obtenidos mediante la sesion y RLS existentes.
 * Dependencia fijada a SheetJS CE 0.20.3, CDN oficial; no usa service_role.
 */
(function(){
  'use strict';
  const LIBRARY='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  let loader=null;
  function ensureLibrary(){
    if(window.XLSX)return Promise.resolve(window.XLSX);
    if(!loader){
      loader=new Promise((resolve,reject)=>{
        const tag=document.createElement('script');
        tag.src=LIBRARY;tag.async=true;tag.referrerPolicy='no-referrer';
        tag.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('La biblioteca Excel no se inicializo.'));
        tag.onerror=()=>reject(new Error('No se pudo cargar el motor Excel. Revisa la conexion.'));
        document.head.appendChild(tag);
      }).catch(e=>{loader=null;throw e});
    }
    return loader;
  }
  function cell(value){
    if(value===null||value===undefined)return '';
    if(typeof value==='number')return Number.isFinite(value)?value:'';
    if(typeof value==='boolean')return value?'Sí':'No';
    const s=String(value);
    // Evitar que contenido no confiable se interprete como formula en aplicaciones de hojas.
    return /^[\t\r\n ]*[=+@\-]/.test(s)?"'"+s:s;
  }
  function safeName(name){
    return String(name||'Reporte').replace(/[\\/*?:\[\]]/g,' ').slice(0,31);
  }
  async function exportBook(filename,sheets){
    if(!Array.isArray(sheets)||!sheets.length)throw Error('No hay hojas para exportar.');
    const XLSX=await ensureLibrary(),book=XLSX.utils.book_new();
    sheets.forEach((s,i)=>{
      const data=(s.rows||[]).map(row=>(Array.isArray(row)?row:[]).map(cell));
      const ws=XLSX.utils.aoa_to_sheet(data.length?data:[['Sin registros']]);
      const cols=(data[0]||[]).map((_,j)=>({wch:Math.min(54,Math.max(12,...data.slice(0,120).map(r=>String(r[j]??'').length+2)))}));
      ws['!cols']=cols;
      XLSX.utils.book_append_sheet(book,ws,safeName(s.name||'Hoja '+(i+1)));
    });
    const output=String(filename||'Gigantes_Reporte.xlsx').replace(/[^A-Za-z0-9_.-]/g,'_');
    XLSX.writeFile(book,/\.xlsx$/i.test(output)?output:output+'.xlsx',{bookType:'xlsx',compression:true});
  }
  function metadata(title,scope){
    return {name:'Informacion',rows:[['Club Deportivo Gigantes de Azapa'],['Reporte',title],['Ambito',scope],['Generado',new Date().toLocaleString('es-CL')],['Nota','Documento exportado para revision; no acredita conciliacion bancaria.']]};
  }
  window.GigantesExcel={exportBook,metadata};
})();
