// ============================================================================
// check_game_js.js — Validación de sintaxis del JavaScript embebido en
// public/game.html (y otros HTML) SIN navegador: extrae cada <script> inline,
// lo compila con new Function() y reporta errores de sintaxis.
// No ejecuta el código (no hay DOM): solo lo compila.
//
// Uso: node check_game_js.js [ruta.html ...]
// ============================================================================
const fs = require('fs');
const path = require('path');

const archivos = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [path.join(__dirname, 'public', 'game.html'), path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'public', 'admin.html')];

let mal = 0;
for (const archivo of archivos) {
    if (!fs.existsSync(archivo)) { console.log(`  ? ${path.basename(archivo)}: no existe (omitido)`); continue; }
    const html = fs.readFileSync(archivo, 'utf8');
    const bloques = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type\s*=\s*["']?module)[^>]*>([\s\S]*?)<\/script>/gi)];
    bloques.forEach((m, i) => {
        const codigo = m[1];
        if (!codigo.trim()) return;
        try {
            // eslint-disable-next-line no-new-func
            new Function(codigo);
            console.log(`  ✓ ${path.basename(archivo)} <script #${i + 1}> (${codigo.length} chars): sintaxis OK`);
        } catch (e) {
            mal++;
            console.error(`  ✗ ${path.basename(archivo)} <script #${i + 1}>: ${e.message}`);
            const linea = (e.stack.match(/<anonymous>:(\d+)/) || [])[1];
            if (linea) {
                const ctx = codigo.split('\n').slice(Math.max(0, linea - 4), linea + 2).join('\n');
                console.error('---- contexto ----\n' + ctx + '\n------------------');
            }
        }
    });
}
console.log(mal === 0 ? '\nSintaxis de scripts inline: OK' : `\n${mal} bloque(s) con errores de sintaxis`);
process.exit(mal ? 1 : 0);
