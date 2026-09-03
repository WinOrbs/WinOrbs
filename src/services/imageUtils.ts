/**
 * Utilidades para imágenes de skins.
 *
 * Google Drive no permite enlazar imágenes directamente con su URL de compartir.
 * Esta utilidad extrae el ID del archivo y lo convierte a una URL directa que
 * el navegador puede cargar (drive.google.com/uc?export=view) sin bloquearse.
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
  // Texto plano: parece un ID solitario (28-33 caracteres)
  if (/^[-\w]{28,33}$/.test(url)) return url;
  return null;
}

/** Normaliza cualquier URL de imagen (incluyendo enlaces compartidos de Google Drive) a una URL directa cargable. */
export function normalizeImageUrl(input: string | null | undefined): string {
  if (!input) return '';
  const url = input.trim();
  if (!url) return '';

  if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
    const id = extractGoogleDriveId(url);
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }

  // Ya es directa (lh3.googleusercontent.com / uc?export=view / cualquier otra URL)
  return url;
}