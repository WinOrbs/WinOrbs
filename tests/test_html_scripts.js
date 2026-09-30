// Test de regresión: todos los HTML de public/ deben tener los <script>
// balanceados y los scripts inline clásicos con sintaxis JS válida.
// Nace de un bug real: el commit del lobby borró el </script> de cierre de
// index.html y el navegador parseó '<script type="module">' como JS
// → "Uncaught SyntaxError: Unexpected token '<'" en (index):1154, dejando sin
// efecto todo el módulo de Firebase del lobby (saldo, apodo, skins).
// Patrón de los demás tests: node test_html_scripts.js
const fs = require('fs');
const path = require('path');
const out = [];
let fallos = 0;
function check(nombre, cond) {
  out.push((cond ? 'OK  - ' : 'FAIL - ') + nombre);
  console.log(out[out.length - 1]);
  if (!cond) fallos++;
}

const dir = path.join(__dirname, '..', 'public');
const archivos = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

// Un <script> dentro de un comentario JS de línea no cuenta (único caso
// conocido: game.html comenta "// ... se resuelve en otro <script>: ...").
function esComentarioJs(linea) { return /^\s*\/\//.test(linea); }

for (const f of archivos) {
  const lineas = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  let abre = 0, cierra = 0;
  for (const l of lineas) {
    if (!esComentarioJs(l)) abre += (l.match(/<script\b/g) || []).length;
    cierra += (l.match(/<\/script>/g) || []).length;
  }
  check(f + ': <script> balanceados (' + abre + '/' + cierra + ')', abre === cierra);

  // ── Extracción de bloques inline clásicos y validación de sintaxis ──
  // new Function(code) SOLO parsea (no ejecuta): detecta errores como
  // "Unexpected token '<'" sin necesitar los globals del navegador.
  let dentro = null, codigo = [];
  const validar = (desde, hasta, code) => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
      check(f + ': script inline (líneas ' + desde + '-' + hasta + ') sintaxis OK', true);
    } catch (e) {
      check(f + ': script inline (líneas ' + desde + '-' + hasta + ') sintaxis OK → ' + e.message, false);
    }
  };
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (dentro === null) {
      if (esComentarioJs(l)) continue;
      const m = /<script\b/g; m.lastIndex = 0;
      let mm;
      while ((mm = m.exec(l)) !== null) {
        const esSrc = /src\s*=/.test(l);
        const esModulo = /type\s*=\s*["']module["']/.test(l);
        const cierraEnMismaLinea = /<\/script>/.test(l.slice(mm.index));
        abre++;
        if (cierraEnMismaLinea) cierra++; // par de una línea (<script src=...></script>)
        else { dentro = esModulo ? 'module' : (esSrc ? 'src' : 'inline'); codigo = []; }
        break; // una etiqueta de apertura por línea en este proyecto
      }
    } else {
      const idx = l.indexOf('</script>');
      if (idx >= 0) {
        const prefijo = idx > 0 ? l.slice(0, idx) : '';
        if (dentro === 'inline') {
          codigo.push(prefijo);
          validar(i - codigo.length + 1, i + 1, codigo.join('\n'));
        }
        dentro = null; codigo = [];
      } else if (dentro === 'inline') {
        codigo.push(l);
      }
    }
  }
  if (dentro !== null) check(f + ': script sin cerrar al final del archivo', false);
}

const resumen = 'RESULTADO: ' + (fallos ? fallos + ' FALLOS' : 'TODO OK (' + archivos.length + ' HTML)');
console.log(resumen);
fs.writeFileSync(path.join(__dirname, '..', '.test_html_scripts_out.log'), out.join('\n') + '\n' + resumen + '\n');
process.exit(fallos ? 1 : 0);