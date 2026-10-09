'use client';
import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// Vite's URL import hosts the PDF worker on this origin.
// oxlint-disable-next-line import/default
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
export default function FinancePdfPreview({ blob, onReady }: { blob: Blob; onReady: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  useEffect(() => { ready.current = onReady; }, [onReady]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const task = blob.arrayBuffer().then(buffer => getDocument({ data: new Uint8Array(buffer) }));
    const renders: { cancel: () => void }[] = [];
    void (async () => {
      const loading = await task, document = await loading.promise;
      for (let n = 1; n <= document.numPages && active; n++) {
        const page = await document.getPage(n), viewport = page.getViewport({ scale: 1.4 });
        const canvas = window.document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.setAttribute('aria-label', `PDF 第 ${n} 页`);
        canvas.setAttribute('role', 'img');
        const render = page.render({ canvas, viewport });
        renders.push(render);
        await render.promise;
        if (active) holder.current?.appendChild(canvas);
      }
      if (active) ready.current();
    })().catch(e => { if (active) { setError('预览加载失败：' + (e as Error).message); ready.current(); } });
    const element = holder.current;
    return () => { active = false; renders.forEach(r => r.cancel()); void task.then(t => t.destroy()).catch(() => {}); element?.replaceChildren(); };
  }, [blob]);
  return <><div ref={holder} className="f-pdf-pages" />{error && <p role="alert">{error}，可用“打开PDF”查看。</p>}</>;
}
