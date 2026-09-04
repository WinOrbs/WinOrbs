/**
 * Utilidades para imágenes de skins.
 *
 * Google Drive no permite enlazar imágenes directamente con su URL de compartir
 * y sus thumbnails TAMPOCO envían cabeceras CORS (Access-Control-Allow-Origin),
 * lo que impide dibujarlas en <canvas> con crossOrigin='anonymous' y hacer
 * fetch() de ellas.
 *
 * Estrategia: se extrae el ID del archivo, se construye la URL de thumbnail
 * oficial (drive.google.com/thumbnail?id=..&sz=..) y se enruta por el proxy
 * wsrv.nl, que reenvía la imagen con ACAO: *. Así funcionan <img>, canvas y
 * fetch en producción sin tocar la imagen original.
 */

/** Extrae el ID de archivo de Google Drive desde cualquier formato de enlace. */
export function extractGoogleDriveId(input: string): string | null {
  const url = input.trim();
  // Patrón clásico: https://drive.google.com/file/d/<ID>/view...
  const fileMatch = url.match(/\/file\/d\/([-\w]{20,})/);
  if (fileMatch) return fileMatch[1];
  // Patrón con parámetro id: open?id=.. , uc?id=.. , folderview?usp=sharing&id=..
  const idParam = url.match(/[?&]id=([-\w]{20,})/);
  if (idParam) return idParam[1];
  // URL de CDN de Google (lh3 / drive.usercontent)
  const cdnMatch = url.match(/\/d\/([-\w]{20,})/);
  if (cdnMatch) return cdnMatch[1];
  // URL de thumbnail de Drive ya generada
  const thumbMatch = url.match(/thumbnail\?id=([-\w]{20,})/);
  if (thumbMatch) return thumbMatch[1];
  // URL sin parámetro (lh3.googleusercontent.com/d/<ID>=s1000)
  const lh3Match = url.match(/\/d\/([-\w]{20,})=/);
  if (lh3Match) return lh3Match[1];
  // Texto plano: parece un ID solitario (28-33 caracteres)
  if (/^[-\w]{28,33}$/.test(url)) return url;
  return null;
}

/** ¿Apunta a un archivo/imagen alojado en Google Drive? */
function isGoogleDrive(input: string): boolean {
  return (
    input.includes('drive.google.com') ||
    input.includes('drive.usercontent.google.com') ||
    input.includes('lh3.googleusercontent.com') ||
    input.includes('usercontent.google.com') ||
    /(^|\/)d\/[-\w]{20,}(=|\/|$)/.test(input) ||
    /^[-\w]{28,33}$/.test(input)
  );
}

/**
 * Proxy de imágenes con CORS abierto. Google Drive NO envía cabeceras
 * Access-Control-Allow-Origin en sus thumbnails, lo que rompe:
 *  - el dibujado en canvas (img.crossOrigin='anonymous' falla)
 *  - cualquier fetch() de la imagen
 * wsrv.nl (images.weserv.nl) reenvía la imagen incluyendo ACAO: *.
 */
function proxyUrl(url: string): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&output=webp&q=85`;
}

/**
 * Normaliza cualquier URL de imagen (incluyendo enlaces compartidos de Google
 * Drive) a una URL directa y cargable por el navegador Y por el canvas.
 */
export function normalizeImageUrl(input: string | null | undefined): string {
  if (!input) return '';
  const url = input.trim();
  if (!url) return '';

  // URLs de Drive (thumbnail o enlace compartido): enrutar por proxy CORS
  if (isGoogleDrive(url)) {
    const id = extractGoogleDriveId(url);
    if (id) {
      const thumbnail = `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
      return proxyUrl(thumbnail);
    }
    return proxyUrl(url);
  }

  // Cualquier otra URL directa (Imgur, Cloudinary, Firebase Storage, etc.)
  return url;
}