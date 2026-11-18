/* Renderiza exclusivamente la portada real (página 1) del PDF V8 ya publicado.
   No edita el PDF ni cambia el lector de ser-gigante.html. */
(() => {
  'use strict';
  const canvas = document.getElementById('serGiganteCoverCanvas');
  const status = document.getElementById('serGiganteCoverStatus');
  if (!canvas || !status) return;
  const pdfjsUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const workerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  let started = false;
  const loadPdfJs = () => new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = pdfjsUrl;
    script.async = true;
    script.onload = () => window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error('PDF.js no está disponible'));
    script.onerror = () => reject(new Error('No se cargó el visor de portada'));
    document.head.append(script);
  });
  async function run() {
    if (started) return;
    started = true;
    try {
      const pdfjs = await loadPdfJs();
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const chunks = await Promise.all(Array.from({length:21}, async (_, i) => {
        const url = 'documentos/revista/v8/parte-' + String(i + 1).padStart(2, '0') + '.b64';
        const response = await fetch(url, {cache:'force-cache'});
        if (!response.ok) throw new Error('Fragmento de portada inaccesible: ' + (i + 1));
        return response.text();
      }));
      const binary = atob(chunks.join('').trim());
      if (!binary.startsWith('%PDF-')) throw new Error('PDF V8 inválido');
      const bytes = new Uint8Array(binary.length);
      for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
      const doc = await pdfjs.getDocument({data:bytes}).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({scale:1});
      const scale = Math.min(1.6, 1000 / viewport.width);
      const view = page.getViewport({scale});
      canvas.width = Math.round(view.width);
      canvas.height = Math.round(view.height);
      const context = canvas.getContext('2d', {alpha:false});
      if (!context) throw new Error('No se pudo dibujar la portada');
      await page.render({canvasContext:context, viewport:view}).promise;
      canvas.hidden = false;
      status.hidden = true;
      canvas.setAttribute('title','Portada original de SER GIGANTE V8, página 1 de 16');
    } catch (error) {
      status.textContent = 'SER GIGANTE · Revista V8\\nPulsa aquí para leer las 16 páginas';
      status.style.whiteSpace = 'pre-line';
      console.warn('Portada SER GIGANTE: ', error);
    }
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(x => x.isIntersecting)) {observer.disconnect(); run();}
    }, {rootMargin:'360px'});
    observer.observe(canvas.parentElement);
  } else run();
})();
