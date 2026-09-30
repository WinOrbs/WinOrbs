// Test de la configuración de pagos & tasa del día:
//  - reglas de Firestore: bloque 'configuracion' idéntico en firestore.rules y
//    en el generador tools/patch_rules.js (se desincronizan = bug silencioso)
//  - admin.html: sección + guardado/lectura en configuracion/pagos
//  - index.html: chip de tasa leyendo el MISMO campo que escribe el admin
// Patrón de la casa: node tests/test_config_tasa.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const out = [];
let fallos = 0;
function check(nombre, cond) {
  out.push((cond ? 'OK  - ' : 'FAIL - ') + nombre);
  console.log(out[out.length - 1]);
  if (!cond) fallos++;
}

// La raíz del proyecto: este script vive en tests/, todo lo demás un nivel arriba.
const raiz = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const reglas = leer('firestore.rules');
const patch = leer('tools/patch_rules.js');
const admin = leer('public/admin.html');
const index = leer('public/index.html');
const wallet = leer('public/wallet.html');

// ── 1) Sincronía de reglas: el bloque configuracion existe y es idéntico ──
function bloqueConfiguracion(texto) {
  const ini = texto.indexOf('match /configuracion/{id}');
  if (ini < 0) return null;
  const fin = texto.indexOf('}', texto.indexOf('allow write', ini));
  return texto.slice(ini, fin + 1).replace(/\s+/g, ' ').trim();
}
const bRules = bloqueConfiguracion(reglas);
const bPatch = bloqueConfiguracion(patch);
check('firestore.rules tiene el bloque match /configuracion/{id}', !!bRules);
check('patch_rules.js tiene el mismo bloque (sincronía)', !!bPatch && bRules === bPatch);
check('configuracion: lectura para cualquier autenticado', /configuracion\/\{id\}[\s\S]{0,120}allow read: if request\.auth != null/.test(reglas));
check('configuracion: escritura SOLO admin', /configuracion\/\{id\}[\s\S]{0,200}allow write: if isAdmin\(\)/.test(reglas));

// ── 2) patch_rules.js regenera un archivo equivalente al publicado ──
const reglasAntes = reglas;
execFileSync(process.execPath, ['tools/patch_rules.js'], { cwd: raiz });
check('node tools/patch_rules.js regenera firestore.rules sin cambios (RULES_OK)', leer('firestore.rules') === reglasAntes);

// ─ 3) Admin: sección, formulario y guardado ──
// Extrae el cuerpo de una función desde su cabecera hasta su cierre real:
// el cierre está a la indentación de la función (8 espacios), NO los objetos
// literales anidados (12 espacios) — si no, corta en el primer '};'.
function cuerpoFuncion(texto, cabecera) {
  const ini = texto.indexOf(cabecera);
  if (ini < 0) return '';
  const cierre = texto.slice(ini).search(/\n {8}\};|\n {8}\}/);
  return cierre < 0 ? texto.slice(ini) : texto.slice(ini, ini + cierre);
}
const fnGuardar = cuerpoFuncion(admin, 'window.guardarConfigPagos = function');
const fnEscuchar = cuerpoFuncion(admin, 'function escucharConfigPagos()');
check('admin: menú y sección "Pagos & Tasa"', admin.includes("switchSection('pagos'") && admin.includes('id="sec-pagos"'));
check('admin: título de sección registrado', admin.includes("'pagos': 'Datos de Pago & Tasa del Dólar'"));
check('admin: guardarConfigPagos expuesto en window (lo llama el botón)', fnGuardar.length > 0);
check('admin: guardarConfigPagos escribe en configuracion/pagos (setDoc)',
  /setDoc\(doc\(db, 'configuracion', 'pagos'\), datos\)/.test(fnGuardar));
check('admin: upsert con setDoc (no addDoc = no duplica documentos)', !/addDoc\(/.test(fnGuardar));
check('admin: listener registrado en iniciarListenersAdmin (escucharConfigPagos)',
  /iniciarListenersAdmin[\s\S]{0,400}escucharConfigPagos\(\);/.test(admin) ||
  /escucharConfigPagos\(\);[\s\S]{0,200}\}\n\n\s*\/\/ ─ CONFIG DE PAGOS/.test(admin));
check('admin: escucharConfigPagos precarga el formulario con onSnapshot', fnEscuchar.length > 0 &&
  /onSnapshot\(doc\(db, 'configuracion', 'pagos'\)/.test(fnEscuchar));
check('admin: precarga NO pisa lo que el admin teclea (solo rellena vacíos)', /el\.value === ''/.test(fnEscuchar));
check('admin: tasa en campo tasaUSD_Bs', admin.includes('tasaUSD_Bs'));
check('admin: datos de pago móvil, transferencia y USDT', admin.includes('pagoMovil') && admin.includes('transferencia') && admin.includes('usdt'));
check('admin: sanitiza entradas (limpiarTexto sin <>&"\')', admin.includes("replace(/[<>&\"']/g, '')"));
check('admin: marca actualizadoPor/actualizadoEn (auditoría)', admin.includes('actualizadoPor') && admin.includes('actualizadoEn'));

// ── 4) Index: chip de tasa leyendo el mismo doc/campo que el admin escribe ──
check('index: chip de tasa en la topbar', index.includes('id="chip-tasa"') && index.includes('Tasa: $1 ='));
check('index: lee configuracion/pagos en vivo', index.includes('onSnapshot(doc(db, "configuracion", "pagos")'));
check('index y admin usan el MISMO campo (tasaUSD_Bs) — anti desincronización', index.includes('tasaUSD_Bs') && admin.includes('tasaUSD_Bs'));
check('index: sin tasa (0) → chip oculto', /\!\(tasa > 0\)[\s\S]{0,80}hidden = true/.test(index));
check('index: formateo es-VE (miles con punto, 2 decimales)', index.includes('toLocaleString("es-VE"'));

// ── 5) Wallet: la tarjeta de destino muestra a DÓNDE pagar según el método ──
// (sin esto el usuario no puede recargar: los datos del admin no llegaban a nadie)
check('wallet: tarjeta oficial de destino en el formulario de depósito',
  wallet.includes('id="dep-destino-card"'));
check('wallet: lee configuracion/pagos en vivo', wallet.includes('onSnapshot(doc(db, "configuracion", "pagos")'));
check('wallet: destino según método (pagoMovil / transferencia / usdt)',
  wallet.includes('cfgPagos.pagoMovil') && wallet.includes('cfgPagos.transferencia') && wallet.includes('cfgPagos.usdt'));
check('wallet: equivalente en Bs con la tasa del día (monto × tasaUSD_Bs)',
  /monto \* tasa/.test(wallet) && wallet.includes('A pagar ≈'));
check('wallet: renderiza con textContent (anti-XSS, datos de Firestore)', /\.textContent = validas/.test(wallet));
check('wallet: el destino se actualiza al cambiar método y monto',
  wallet.includes('renderDestinoPago') && wallet.includes('dep-monto') && wallet.includes('"change"'));

const resumen = 'RESULTADO: ' + (fallos ? fallos + ' FALLOS' : 'TODO OK');
console.log(resumen);
fs.writeFileSync(path.join(raiz, '.test_config_tasa_out.log'), out.join('\n') + '\n' + resumen + '\n');
process.exit(fallos ? 1 : 0);