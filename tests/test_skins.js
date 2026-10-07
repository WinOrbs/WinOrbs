// ── Test de skins: validarSkinCliente (server.js) + sintaxis inline de tienda.html ──
// Ejecutar desde la raíz del proyecto:  node tests/test_skins.js
// Sigue el patrón de test_lobby.js: vm + stubs, sin depender de node_modules.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let fallos = 0;
function check(nombre, cond) {
    if (cond) { console.log('OK   ' + nombre); }
    else { fallos++; console.log('FAIL ' + nombre); }
}

(async function main() {
    // ── 1. Extraer el bloque de skins de server.js y correrlo en una sandbox ──
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const ini = server.indexOf('function sanitizeNick');
    const fnIni = server.indexOf('async function validarSkinCliente');
    if (ini < 0 || fnIni < 0) throw new Error('No se encontró el bloque de skins en server.js');
    const cierre = server.indexOf('\n}', fnIni); // primer '}' en columna 0 = cierre de la función
    if (cierre < 0) throw new Error('No se encontró el cierre de validarSkinCliente');
    const bloque = server.slice(ini, cierre + 2);

    const sandbox = {
        FIREBASE_ECONOMY: false,
        FIREBASE_DB: null,
        PROGRESSION_RUNTIME: null,
        PROGRESSION_REWARDS: [],
        recompensaVisualEquipada: async () => null
    };
    vm.createContext(sandbox);
    vm.runInContext(bloque, sandbox, { filename: 'server.js#skins' });
    const validar = sandbox.validarSkinCliente;
    if (typeof validar !== 'function') throw new Error('validarSkinCliente no quedó definida en la sandbox');

    // Modo economía DEGRADADO (sin Firestore): básicas por nombre e id bas-*
    const casosDegradado = [
        ['básica por nombre exacto (cielo)',        { nombre: 'cielo' },                          s => s.nombre === 'cielo' && s.c1 === '#38bdf8' && s.c2 === '#0284c7' && s.border === '#bae6fd'],
        ['básica con mayúsculas (Cielo)',           { nombre: 'Cielo' },                          s => s.nombre === 'cielo' && s.c1 === '#38bdf8'],
        ['básica con acento (Neón → neon)',         { nombre: 'Neón' },                           s => s.nombre === 'neon' && s.c1 === '#a855f7' && s.c2 === '#6b21a8'],
        ['básica en MAYÚSCULAS (ESMERALDA)',        { nombre: 'ESMERALDA' },                      s => s.nombre === 'esmeralda' && s.c1 === '#22c55e'],
        ['básica con espacios ( Fuego )',           { nombre: ' Fuego ' },                        s => s.nombre === 'fuego' && s.c1 === '#f97316' && s.border === '#ffedd5'],
        // El id bas-* manda cuando el nombre no casa (objeto viejo de localStorage, etc.)
        ['id bas-cielo sin nombre básico',          { id: 'bas-cielo', nombre: 'X' },             s => s.id === 'bas-cielo' && s.nombre === 'cielo' && s.c1 === '#38bdf8'],
        ['id bas-neon sin nombre básico',           { id: 'bas-neon', nombre: 'X' },              s => s.id === 'bas-neon' && s.c2 === '#6b21a8'],
        ['id bas-esmeralda sin nombre básico',      { id: 'bas-esmeralda', nombre: 'X' },         s => s.id === 'bas-esmeralda' && s.c1 === '#22c55e'],
        ['id bas-fuego sin nombre básico',          { id: 'bas-fuego', nombre: 'X' },             s => s.id === 'bas-fuego' && s.border === '#ffedd5'],
        // Caso real de la Tienda (id + nombre con acento): la rama por nombre la resuelve gratis
        ['id bas-neon + nombre Neón (Tienda)',      { id: 'bas-neon', nombre: 'Neón' },           s => s.nombre === 'neon' && s.c1 === '#a855f7'],
        ['id bas-esmeralda + nombre Esmeralda',     { id: 'bas-esmeralda', nombre: 'Esmeralda' }, s => s.nombre === 'esmeralda' && s.c1 === '#22c55e'],
        ['id de pago sin economía → fallback',      { id: 'skp_falsa', nombre: 'X' },             s => s.nombre === 'cielo' && !s.id],
        ['skin no string → fallback',               'hola',                                       s => s.nombre === 'cielo'],
        ['skin null → fallback',                    null,                                         s => s.nombre === 'cielo'],
        ['id raro pero nombre básico válido',       { id: 'bas-<script>', nombre: 'Neón' },       s => s.nombre === 'neon' && !s.id]
    ];
    for (const [nombre, entrada, ok] of casosDegradado) {
        const res = await validar(entrada, 'uid_test');
        check('[degradado] ' + nombre, !!ok(res));
    }
    // Modo economía ACTIVO con Firestore simulado: skins compradas y de pago
    const skinsDocs = {
        skp_oro: { nombre: 'Orbe Oro', precio: 2.5, c1: '#f59e0b', c2: '#b45309', border: '#fde68a', imagenUrl: 'https://example.com/oro.png', activo: true },
        skp_free: { nombre: 'Promo', precio: 0, c1: '#22d3ee', c2: '#0e7490', border: '#cffafe', activo: true },
        skp_mala_url: { nombre: 'Rara', precio: 1, c1: '#ef4444', c2: '#991b1b', border: '#fecaca', imagenUrl: 'javascript:alert(1)', activo: true }
    };
    const inventarios = { user_compra: ['skp_oro', 'skp_mala_url'], user_pobre: [] };
    sandbox.FIREBASE_ECONOMY = true;
    sandbox.FIREBASE_DB = {
        collection: (col) => ({
            doc: (id) => ({
                get: async () => ({
                    exists: col === 'skins' ? !!skinsDocs[id] : !!inventarios[id],
                    data: () => (col === 'skins' ? skinsDocs[id] : { skins_compradas: inventarios[id] || [] })
                })
            })
        })
    };
    const casosEconomia = [
        ['comprada → se usa con imagen',          'skp_oro', 'user_compra', s => s.id === 'skp_oro' && s.imagenUrl === 'https://example.com/oro.png' && s.nombre === 'Orbe Oro'],
        ['no comprada → fallback azul',           'skp_oro', 'user_pobre',  s => s.nombre === 'cielo' && !s.id],
        ['precio 0 → permitida sin compra',       'skp_free', 'user_pobre', s => s.id === 'skp_free' && s.nombre === 'Promo'],
        ['URL no https → imagen saneada a vacío', 'skp_mala_url', 'user_compra', s => s.id === 'skp_mala_url' && s.imagenUrl === ''],
        ['skin inexistente → fallback',           'skp_nadie', 'user_compra', s => s.nombre === 'cielo']
    ];
    for (const [nombre, skinId, uid, ok] of casosEconomia) {
        const res = await validar({ id: skinId, nombre: 'X' }, uid);
        check('[economía] ' + nombre, !!ok(res));
    }

    // ── 2. Sintaxis de los scripts inline de tienda.html (no está en check_scripts.js) ──
    const htmlTienda = fs.readFileSync(path.join(__dirname, '..', 'public/tienda.html'), 'utf8');
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0, tiendaOk = true;
    while ((m = re.exec(htmlTienda)) !== null) {
        // solo saltar si el src está en la etiqueta de apertura (mismo criterio que check_scripts.js)
        const etiqueta = m[0].slice(0, m[0].indexOf('>') + 1);
        if (/src\s*=/.test(etiqueta)) continue;
        i++;
        const src = m[1].replace(/^\s*import\s[^;]+;/gms, '').replace(/^\s*export\s[^;]+;/gms, '');
        try { new vm.Script(src, { filename: `tienda.html#script${i}` }); }
        catch (e) { tiendaOk = false; fallos++; console.log('FAIL tienda.html #script' + i + ': ' + e.message); }
    }
    check('tienda.html: ' + i + ' bloques inline con sintaxis válida', tiendaOk);

    // ── 3. Marcadores clave del parche en los archivos editados ──
    const marcadores = [
        ['server.js', ['normalize(\'NFD\')', 'bas-(cielo|fuego|neon|esmeralda)']],
        ['public/index.html', ['renderSkinsCompradas', 'aplicarSkinEquipadaDePerfil', 'id="skins-compradas"', 'data-bas="cielo"', 'skin-preview img']],
        ['public/tienda.html', ['skin_equipada', 'Sincronía multi-dispositivo']],
        ['public/perfil.html', ['f-billetera', 'billetera_usdt', 'esTRC20', 'esBEP20']],
        ['public/wallet.html', ['Billetera USDT: ', 'perfil.billetera_usdt', 'Binance (USDT)']],
        ['public/admin.html', ['actualizarPreviewSkin', 'skin-preview-img', 'Ya está disponible para los jugadores', 'subirSkinImg', 'upload_preset', '/js/media-config.js', 'skin-up-fill']],
        ['public/js/media-config.js', ['window.MEDIA_UPLOAD', 'cloudName', 'preset', 'maxBytes']]
    ];
    for (const [archivo, claves] of marcadores) {
        const txt = fs.readFileSync(archivo, 'utf8');
        for (const clave of claves) check(archivo + ' contiene "' + clave + '"', txt.includes(clave));
    }

// ── 4. Subida de imágenes: Cloudinary (Firebase Storage exige plan Blaze) ──
    // Regresión vigilada: si alguien vuelve a enganchar Firebase Storage, la
    // subida del panel falla ("storage/unknown") y la skin queda SIN imagen.
    const mediaCfg = fs.readFileSync(path.join(__dirname, '..', 'public/js/media-config.js'), 'utf8');
    check('media-config.js expone window.MEDIA_UPLOAD', /window\.MEDIA_UPLOAD\s*=/.test(mediaCfg));
    check('media-config.js declara cloudName y preset', /cloudName\s*:/.test(mediaCfg) && /preset\s*:/.test(mediaCfg));
    check('media-config.js limita a 5 MB', /maxBytes\s*:\s*5\s*\*\s*1024\s*\*\s*1024/.test(mediaCfg));

    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public/admin.html'), 'utf8');
    check('admin.html carga /js/media-config.js', adminHtml.includes('/js/media-config.js'));
    check('admin.html sube con unsigned preset a Cloudinary', adminHtml.includes('api.cloudinary.com') && adminHtml.includes('upload_preset'));
    check('admin.html rellena #skin-url con data.secure_url', adminHtml.includes('data.secure_url') && adminHtml.includes('getElementById("skin-url").value'));
    check('admin.html NO usa Firebase Storage', !/firebase-storage|getStorage|uploadBytes|uploadBytesResumable/.test(adminHtml));

    const walletHtml = fs.readFileSync(path.join(__dirname, '..', 'public/wallet.html'), 'utf8');
    check('wallet.html carga /js/media-config.js', walletHtml.includes('/js/media-config.js'));
    check('wallet.html sube comprobantes con unsigned preset', walletHtml.includes('api.cloudinary.com') && walletHtml.includes('upload_preset'));
    check('wallet.html NO usa Firebase Storage', !/firebase-storage|getStorage|uploadBytes|uploadBytesResumable/.test(walletHtml));

    // ── Apuntado en el lienzo: la skin gira hacia el puntero (game.html) ──
    const gameHtml = fs.readFileSync(path.join(__dirname, '..', 'public/game.html'), 'utf8');
    check('game.html rota la skin hacia el puntero/disparo', gameHtml.includes('ctx.rotate(p.angle'));
    check('game.html ya NO dibuja la línea blanca de dirección',
        !gameHtml.includes('ctx.lineTo(p.x + Math.cos(p.angle) * (p.radius + 12)'));
    check('game.html usa el ángulo del stick en táctil', /keys\.angle = isTouchDevice\s*\?\s*touchAngle/.test(gameHtml));

    // El guard de server.js: la URL viaja en gameState a 60 fps a todos los
    // jugadores, así que se descarta si su peso codificado no cabe en el paquete.
    check('server.js acota el peso de imagenUrl en gameState', server.includes('encodeURIComponent(url).length'));

    // Comportamiento real del guard con las URLs que produce el host de imágenes
    // (Cloudinary, ~90 chars): deben entrar; una URL desmesurada, no.
    const sanear = sandbox.sanitizeSkin;
    const urlCloudinary = 'https://res.cloudinary.com/demo123/image/upload/v1712345678/winorbs/skins/orbe_neon.png';
    check('sanitizeSkin conserva la URL de Cloudinary (~89 chars)',
        sanear({ c1: '#38bdf8', imagenUrl: urlCloudinary }).imagenUrl === urlCloudinary);
    check('sanitizeSkin descarta una URL desmesurada (400 chars)',
        sanear({ c1: '#38bdf8', imagenUrl: 'https://example.com/' + 'a'.repeat(400) + '.png' }).imagenUrl === undefined);
    check('sanitizeSkin sigue bloqueando javascript:',
        sanear({ c1: '#38bdf8', imagenUrl: 'javascript:alert(1)' }).imagenUrl === undefined);
    sandbox.PROGRESSION_REWARDS = [{
        id: 'level-aura-10',
        type: 'skin',
        name: 'Skin de prueba',
        color: '#22d3ee',
        c1: '#22d3ee',
        c2: '#0e7490',
        border: '#cffafe',
        imageUrl: urlCloudinary
    }];
    const skinRecompensa = sanear({
        c1: '#38bdf8',
        progressionReward: { id: 'level-aura-10', imageUrl: 'https://evil.example/forged.png' }
    });
    check('sanitizeSkin agrega apariencia de recompensa desde catálogo del servidor',
        skinRecompensa.progressionReward?.type === 'skin' &&
        skinRecompensa.progressionReward?.imageUrl === urlCloudinary);
    check('admin permite cargar imagen de recompensa visual',
        adminHtml.includes('subirImagenRecompensa') &&
        adminHtml.includes("configuracion', 'progresion"));
    check('game.html dibuja skin y aura de recompensa desbloqueada',
        gameHtml.includes('progressionReward') &&
        gameHtml.includes("type === 'skin'"));
    console.log(fallos ? ('\n' + fallos + ' test(s) FALLARON') : '\nTodos los tests pasaron');
    process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
