// ── Test de la intro de carga (public/game.html) ──
// Ejecutar desde la raíz del proyecto:  node test_intro.js
// Valida: estructura del overlay (#intro-overlay + barra + %), los hitos del
// arranque enganchados, las redes de seguridad temporales y la sintaxis de
// TODOS los bloques inline de game.html (cobertura que no da test_skins.js).
// Sigue el patrón de test_skins.js: fs + vm, sin depender de node_modules.
const fs = require('fs');
const vm = require('vm');

let fallos = 0;
function check(nombre, cond) {
    if (cond) { console.log('OK   ' + nombre); }
    else { fallos++; console.log('FAIL ' + nombre); }
}

const html = fs.readFileSync('public/game.html', 'utf8');

// ── 1. Marcadores estructurales del overlay ──
const marcadores = [
    'id="intro-overlay"',
    'id="intro-canvas"',
    'id="intro-fill"',
    'id="intro-pct"',
    'id="intro-paso"',
    '#intro-overlay {',
    '#intro-overlay.oculto',
    'window.__intro'
];
for (const clave of marcadores) {
    check('game.html contiene "' + clave + '"', html.includes(clave));
}

// ── 2. Hitos del arranque enganchados (y sus pesos suman 100) ──
check('hito sprites: precarga de PNG avisa al asentarse', html.includes('spriteAsentado') && html.includes("sumar('sprites')"));
check('hito conexion: socket connect', /socket\.on\('connect'[\s\S]{0,120}sumar\('conexion'\)/.test(html));
check('hito identidad: sondeo de __identidadLista', html.includes('window.__identidadLista === true'));
check('hito join: joinedSuccess', /socket\.on\('joinedSuccess'[\s\S]{0,200}sumar\('join'\)/.test(html));
check('hito estado: primer gameState', /socket\.on\('gameState'[\s\S]{0,600}sumar\('estado'\)/.test(html));
check('los 5 pesos suman 100', /PESOS = \{ sprites: 45, conexion: 15, identidad: 15, join: 15, estado: 10 \}/.test(html));

// ── 3. Redes de seguridad y ciclo de vida ──
check('tiempo minimo en pantalla (MIN_MS)', /const MIN_MS = \d+/.test(html));
check('tiempo maximo de seguridad (MAX_MS)', /const MAX_MS = \d+/.test(html));
check('cancela la animacion al terminar', html.includes('cancelAnimationFrame(frameId)'));
check('pausa la animacion con la pestana oculta', html.includes('document.hidden'));
check('disconnect oculta la intro (no tapa el aviso)', /socket\.on\('disconnect'[\s\S]{0,700}__intro/.test(html));
check('la intro no bloquea el input al ocultarse', html.includes('pointer-events: none'));

// ── 4. La mini-arena tiene orbe, puntos y dianas ──
check('orbe con la skin equipada (gradiente de respaldo)', html.includes("sessionStorage.getItem('mi_skin')") && html.includes('createRadialGradient'));
check('orbe pinta la foto de la skin si la tiene', html.includes('skinLista') && html.includes('drawImage(skinImg'));
check('come puntos y dispara a dianas', html.includes('puntosComidos') && html.includes('dianasRotas') && html.includes('disparar()'));
check('particulas con tope (no crecen sin control)', /MAX_CHISPAS = \d+/.test(html));

// ── 5. Sintaxis de TODOS los bloques inline de game.html ──
// (el primer script es type="module": se le quitan los import, igual que en test_skins.js)
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, malos = 0;
while ((m = re.exec(html)) !== null) {
    const etiqueta = m[0].slice(0, m[0].indexOf('>') + 1);
    if (/src\s*=/.test(etiqueta)) continue;
    i++;
    const src = m[1].replace(/^\s*import\s[^;]+;/gms, '').replace(/^\s*export\s[^;]+;/gms, '');
    try { new vm.Script(src, { filename: `game.html#script${i}` }); }
    catch (e) { malos++; console.log('FAIL game.html #script' + i + ': ' + e.message); }
}
check('game.html: ' + i + ' bloques inline con sintaxis válida', malos === 0 && i >= 3);

console.log(fallos ? ('\n' + fallos + ' test(s) FALLARON') : '\nTodos los tests pasaron');
process.exit(fallos ? 1 : 0);
