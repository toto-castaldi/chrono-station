// Ridimensiona/comprime un'immagine scelta dall'operatore prima dell'upload, così il
// payload resta piccolo (~<200 KB) anche da foto del tablet. Disegna su <canvas> e
// riesporta in JPEG; ritorna il base64 (senza prefisso data:) e il mime, pronti per
// PUT /api/exercises/:id/image (vedi doc/06-api.md).

export interface ScaledImage {
  dataBase64: string;
  mime: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('immagine non valida'));
    };
    img.src = url;
  });
}

export async function fileToScaledJpeg(
  file: File,
  maxDim = 800,
  quality = 0.8,
): Promise<ScaledImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas non disponibile');
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const dataBase64 = dataUrl.split(',')[1] ?? '';
  return { dataBase64, mime: 'image/jpeg' };
}
