/**
 * Utilidades para imágenes de skins.
 *
 * Google Drive no permite enlazar imágenes directamente con su URL de compartir.
 * Esta utilidad extrae el ID del archivo y lo convierte a una URL de THUMBNAIL
 * (drive.google.com/thumbnail?id=..&sz=..), que es el endpoint oficial que
 * devuelve SIEMPRE una imagen real (funciona en <img> sin cookies ni redirecciones).
 * El antiguo "uc?export=view" devuelve una página HTML o 403 en muchos archivos.
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
 * Normaliza cualquier URL de imagen (incluyendo enlaces compartidos de Google
 * Drive) a una URL directa y cargable por el navegador.
 */
export function normalizeImageUrl(input: string | null | undefined): string {
  if (!input) return '';
  const url = input.trim();
  if (!url) return '';

  // Ya es una URL de thumbnail de Drive: conservarla tal cual
  if (url.includes('thumbnail?id=')) return url;

  if (isGoogleDrive(url)) {
    const id = extractGoogleDriveId(url);
    if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
  }

  // Cualquier otra URL directa (Imgur, Cloudinary, Firebase Storage, etc.)
  return url;
}