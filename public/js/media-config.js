// ─────────────────────────────────────────────────────────────
// Configuración del HOST DE IMÁGENES (Cloudinary, plan gratuito).
//
// ¿Por qué NO Firebase Storage? Subir archivos a Cloud Storage exige el plan
// Blaze (pago) incluso para el bucket por defecto, así que las subidas fallaban
// con "storage/unknown" y la skin se guardaba SIN imagen.
//
// Cloudinary permite subidas directas desde el navegador con un
// "unsigned upload preset": NO se expone el api_secret y el propio preset
// impone (server-side) los formatos permitidos, el tamaño máximo y la carpeta.
//
// ⚠️ OBLIGATORIO configurar antes de usar el panel:
// 1) Crea una cuenta gratis en https://cloudinary.com (sin tarjeta).
// 2) Copia el "Cloud name" del Dashboard → péguelo en cloudName.
// 3) Settings → Upload → Upload presets → Add upload preset:
//      · Signing Mode: Unsigned
//      · Folder: winorbs/skins  (o déjalo vacío: también se manda por request)
//      · Allowed formats: png,jpg,jpeg,gif,webp
//      · Max file size: 5000000  (5 MB)
//    y pon el nombre del preset en "preset".
//
// Igual que js/servidor-config.js: es un script clásico que expone window.*
// ─────────────────────────────────────────────────────────────

window.MEDIA_UPLOAD = {
    proveedor: "cloudinary",
    cloudName: "dvf5o9sq",       // ← pegar aquí el Cloud name (ej: dxxxxxxx)
    preset: "WinOrbs",       // ← pegar aquí el nombre del upload preset
    carpetaSkins: "winorbs/skins",    // carpeta destino de las imágenes de skins
    carpetaComprobantes: "winorbs/comprobantes", // + "/<uid>" por usuario
    maxBytes: 5 * 1024 * 1024         // 5 MB: mismo límite que anuncia el panel
};