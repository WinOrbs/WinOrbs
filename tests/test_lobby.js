// test_lobby.js — Prueba REAL de los filtros/categorías del lobby (public/index.html)
//
// Ejecuta el script inline del lobby sobre el DOM real de la página y lo
// conduce por el evento 'roomsList' y por sus controles (chips por precio,
// "solo con cupo" y orden). No necesita servidor ni navegador: incluye un shim
// DOM mínimo (no hay jsdom disponible en el entorno).
//
//   node test_lobby.js
//
// Verifica: chips por precio con conteos, agrupado ascendente (privadas al
// final), filtrado, exclusión de salas llenas/iniciadas, orden dentro del
// grupo, estados vacíos, auto-recuperación de "Todas" y robustez ante listas
// vacías/nulas.

// Shim DOM mínimo para EJECUTAR de verdad el script del lobby de index.html
// (no hay jsdom/puppeteer disponibles). Soporta solo lo que usa la página:
// parseo de HTML, getElementById, createElement, innerHTML, textContent,
// classList, dataset, style, appendChild, querySelector(All), closest,
// addEventListener y burbujeo de eventos.
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

class ClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(String(this.el.attrs.class || '').split(/\s+/).filter(Boolean)); }
  _put(s) { this.el.attrs.class = Array.from(s).join(' '); }
  contains(c) { return this._set().has(c); }
  add(...cs) { const s = this._set(); cs.forEach((c) => s.add(c)); this._put(s); }
  remove(...cs) { const s = this._set(); cs.forEach((c) => s.delete(c)); this._put(s); }
  toggle(c, f) { const on = f === undefined ? !this.contains(c) : !!f; on ? this.add(c) : this.remove(c); return on; }
}

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = {};
    this.classList = new ClassList(this);
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get hidden() { return Object.prototype.hasOwnProperty.call(this.attrs, 'hidden'); }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get dataset() {
    const out = {};
    for (const k of Object.keys(this.attrs)) {
      if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = this.attrs[k];
    }
    return out;
  }
  get innerHTML() { return serializar(this.children); }
  set innerHTML(html) {
    const nodos = parseHTML(String(html));
    enlazar(nodos, this);
    this.children = nodos;
  }
  get textContent() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(''); }
  set textContent(v) { this.children = [{ nodeType: 3, text: String(v), parent: this }]; }
  appendChild(el) { el.parent = this; this.children.push(el); return el; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { return buscar(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (coincide(n, sel)) return n; n = n.parent; } return null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
}

class Document {
  constructor(node) {
    this.node = node;
    this.body = node;
    this.documentElement = node;
    this._byId = new Map();
    indexar(node, this._byId);
  }
  getElementById(id) { return this._byId.get(id) || null; }
  createElement(tag) { return new Element(tag); }
  querySelector(sel) { return buscar(this.node, sel)[0] || null; }
  querySelectorAll(sel) { return buscar(this.node, sel); }
}

function coincide(el, sel) {
  const partes = String(sel).trim().split(/\s+/);
  const ultima = partes[partes.length - 1];
  if (!coincideSimple(el, ultima)) return false;
  let padre = el.parent;
  for (let i = partes.length - 2; i >= 0; i--) {
    let encontrado = false;
    while (padre && padre.nodeType === 1) {
      if (coincideSimple(padre, partes[i])) { encontrado = true; padre = padre.parent; break; }
      padre = padre.parent;
    }
    if (!encontrado) return false;
  }
  return true;
}

function coincideSimple(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const tag = sel.match(/^([a-zA-Z0-9-]+)/);
  if (tag && el.tagName !== tag[1].toUpperCase()) return false;
  for (const i of sel.match(/#[a-zA-Z0-9_-]+/g) || []) if (el.attrs.id !== i.slice(1)) return false;
  for (const c of sel.match(/\.[a-zA-Z0-9_-]+/g) || []) if (!el.classList.contains(c.slice(1))) return false;
  return true;
}

function buscar(raiz, sel) {
  const out = [];
  const walk = (n) => {
    (n.children || []).forEach((c) => {
      if (c.nodeType !== 1) return;
      if (coincide(c, sel)) out.push(c);
      walk(c);
    });
  };
  walk(raiz);
  return out;
}

function indexar(nodo, mapa) {
  if (nodo.attrs && nodo.attrs.id) mapa.set(nodo.attrs.id, nodo);
  (nodo.children || []).forEach((c) => indexar(c, mapa));
}

function enlazar(nodos, padre) {
  nodos.forEach((n) => { n.parent = padre; if (n.children) enlazar(n.children, n); });
}

function parseAttrs(texto) {
  const attrs = {};
  const re = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(texto || ''))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return attrs;
}

function parseHTML(html) {
  const raiz = new Element('root');
  const pila = [raiz];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=<>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [full, cierra, abre, attrsStr, autocierra, texto] = m;
    const actual = pila[pila.length - 1];
    if (full.startsWith('<!--')) continue;
    if (cierra) { if (pila.length > 1) pila.pop(); continue; }
    if (abre) {
      const el = new Element(abre);
      el.attrs = parseAttrs(attrsStr);
      actual.children.push(el);
      if (!autocierra && !VOID.has(abre.toLowerCase())) pila.push(el);
      continue;
    }
    if (texto && texto.trim() !== '') actual.children.push({ nodeType: 3, text: texto, parent: actual });
  }
  return raiz.children;
}

function serializar(nodos) {
  return (nodos || []).map((n) => {
    if (n.nodeType === 3) return n.text;
    const attrs = Object.keys(n.attrs).map((k) => ` ${k}="${n.attrs[k]}"`).join('');
    const t = n.tagName.toLowerCase();
    return `<${t}${attrs}>${serializar(n.children)}</${t}>`;
  }).join('');
}

// Dispara un evento con burbujeo hasta la raíz (como el navegador).
function despachar(el, tipo, init) {
  const ev = Object.assign({ type: tipo, target: el }, init || {});
  let n = el;
  while (n) {
    const fns = n.listeners && n.listeners[tipo];
    if (fns) fns.slice().forEach((fn) => fn(ev));
    n = n.parent;
  }
  return ev;
}

module.exports = { Element, Document, parseHTML, despachar };
// Prueba REAL del lobby de index.html: ejecuta el script inline de la página
// sobre el DOM real (parseado del propio HTML) y lo conduce por el evento
// 'roomsList' y por los controles (chips / cupo / orden).
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Script inline (sin src ni type=module) que contiene el lobby
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const elegido = scripts.find(([, attrs, code]) => !/\bsrc=/.test(attrs) && !/type=/.test(attrs) && code.includes('renderLobby'));
if (!elegido) throw new Error('No se encontró el script del lobby');
const code = elegido[2];

// ── DOM real de la página ──
const raiz = { nodeType: 1, attrs: {}, children: parseHTML(html), listeners: {} };
const document = new Document(raiz);

// ── Stubs de navegador ──
const handlers = {};
const socket = {
  on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return socket; },
  emit() { return socket; },
  trigger(t, d) { (handlers[t] || []).forEach((fn) => fn(d)); }
};
const store = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const window_ = { SERVIDOR_URL: undefined, location: { href: '' }, skinSeleccionada: null };
window_.window = window_;
const resultados = [];
const log = (msg, ok) => { resultados.push(ok); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${msg}`); };

new Function('window', 'document', 'io', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'location', 'navigator', code)(
  window_, document, () => socket, store(), store(), () => { }, () => true, window_.location, { userAgent: 'test' }
);
console.log('script del lobby ejecutado; handlers socket:', Object.keys(handlers).join(', '));

// ── Datos de prueba: los tiers reales del servidor + casos límite ──
function payload({ llenarTier05 = false } = {}) {
  const salas = [];
  [['p05', 0.50], ['p1', 1], ['p3', 3], ['p5', 5]].forEach(([pre, precio]) => {
    for (let i = 1; i <= 5; i++) {
      salas.push({
        id: `${pre}_${i}`, nombre: `Rápida $${precio.toFixed(2)} · #${i}`,
        maxJugadores: 10, jugadoresConectados: i - 1, precioEntrada: precio,
        pozoActual: +(precio * (i - 1)).toFixed(2), esPrivada: false, iniciada: false
      });
    }
  });
  salas.find((s) => s.id === 'p1_5').jugadoresConectados = 10;   // sala LLENA
  salas.find((s) => s.id === 'p3_2').iniciada = true;            // sala INICIADA
  salas.push({ id: 'vip_1', nombre: 'VIP Privada', maxJugadores: 4, jugadoresConectados: 1, precioEntrada: 2, pozoActual: 2, esPrivada: true, iniciada: false });
  if (llenarTier05) salas.forEach((s) => { if (s.id.startsWith('p05')) s.jugadoresConectados = s.maxJugadores; });
  return salas;
}

// ── Lectores del DOM renderizado ──
const contenedor = document.getElementById('lista-salas');
const chipsBox = document.getElementById('filtros-chips');
const contador = document.getElementById('salas-count');
const barra = document.getElementById('filtros-salas');
const checkCupo = document.getElementById('filtro-cupo');
const selectOrden = document.getElementById('orden-salas');
const limpiar = (s) => String(s).replace(/\s+/g, ' ').trim();

const chips = () => chipsBox.children.map((c) => {
  const n = c.querySelector('.chip-cat-n').textContent;
  const txt = limpiar(c.textContent);
  return { cat: c.dataset.cat, txt, n, label: txt.slice(0, txt.length - n.length).trim(), activa: c.classList.contains('activa') };
});
const grupos = () => contenedor.children.filter((c) => c.classList.contains('grupo-salas')).map((g) => ({
  titulo: limpiar(g.querySelector('.grupo-titulo').textContent),
  meta: limpiar(g.querySelector('.grupo-meta').textContent),
  salas: g.querySelector('.grupo-grid').children.map((t) => t.querySelector('.btn-unirse').dataset.sala)
}));
const vacio = () => contenedor.children.find((c) => c.classList.contains('lobby-vacio')) || null;
const clickChip = (cat) => despachar(chipsBox.children.find((c) => c.dataset.cat === cat), 'click');
const setCupo = (v) => { checkCupo.checked = v; despachar(checkCupo, 'change'); };
const setOrden = (v) => { selectOrden.value = v; despachar(selectOrden, 'change'); };

module.exports = { payload, chips, grupos, vacio, clickChip, setCupo, setOrden, contenedor, contador, barra, checkCupo, selectOrden, limpiar, socket, log, resultados, document };
// Aserciones del lobby (usa el harness que ejecuta el script real de index.html)

// 1) Carga inicial: 20 salas de tier + 1 privada
socket.trigger('roomsList', payload());
let ch = chips();
log('chips generados con conteos: ' + ch.map((c) => `${c.label}(${c.n})`).join(' | '),
  ch.length === 6
  && ch.map((c) => c.label).join('|') === 'Todas|$0.50|$1.00|$3.00|$5.00|🔒 Privadas'
  && ch.map((c) => c.n).join('|') === '21|5|5|5|5|1');
log('"Todas" activa por defecto: ' + (ch[0].activa ? 'sí' : 'no'), ch[0].activa === true && ch.filter((c) => c.activa).length === 1);
log('contador sin filtros: "' + limpiar(contador.textContent) + '"', limpiar(contador.textContent) === '21 salas');

let g = grupos();
log('grupos por precio en orden ascendente (privadas al final): ' + g.map((x) => x.titulo).join(' > '),
  g.length === 5 && g[0].titulo === '$0.50' && g[1].titulo === '$1.00' && g[2].titulo === '$3.00'
  && g[3].titulo === '$5.00' && g[4].titulo === '🔒 Privadas');
log('se pintan las 21 salas repartidas en los grupos: ' + g.reduce((a, x) => a + x.salas.length, 0),
  g.reduce((a, x) => a + x.salas.length, 0) === 21 && contenedorVacio(g));

function contenedorVacio(gs) { return gs.every((x) => x.salas.length > 0); }
log('cabecera de grupo con totales y cupos libres: "' + g[0].meta + '"',
  /^5 salas · 40 cupos libres$/.test(g[0].meta));

// 2) Filtrar por precio con un chip
clickChip('precio:1.00');
g = grupos(); ch = chips();
log('chip $1.00 filtra a un solo grupo de 5 salas: ' + g.length + ' grupo(s)',
  g.length === 1 && g[0].titulo === '$1.00' && g[0].salas.length === 5);
log('contador con filtro: "' + limpiar(contador.textContent) + '"', limpiar(contador.textContent) === '5 de 21 salas');
log('chip marcado como activo (aria-pressed): ' + ch.find((c) => c.cat === 'precio:1.00').activa,
  ch.find((c) => c.cat === 'precio:1.00').activa === true && ch.find((c) => c.cat === 'todas').activa === false);

// 3) "Solo con cupo" oculta la sala llena y la iniciada
clickChip('todas');
setCupo(true);
const ids = grupos().reduce((a, x) => a.concat(x.salas), []);
log('"solo con cupo" excluye la llena (p1_5) y la iniciada (p3_2): ' + ids.length + ' salas',
  ids.length === 19 && !ids.includes('p1_5') && !ids.includes('p3_2'));
log('contador con cupo: "' + limpiar(contador.textContent) + '"', limpiar(contador.textContent) === '19 de 21 salas');

// 4) Orden dentro del grupo
setOrden('cupo-desc');
const g05 = grupos()[0];
log('orden "cupo: más libres" pone p05_1 (10 libres) primero: ' + g05.salas[0], g05.salas[0] === 'p05_1');
setOrden('precio-desc');
log('cambiar de orden no rompe el agrupado: ' + grupos().length + ' grupos', grupos().length === 5);
setOrden('precio-asc');
setCupo(false);

// 5) Estado vacío por filtros + botón "Ver todas las salas"
// (categoría $0.50 + "solo con cupo" con ese tier lleno = 0 resultados)
clickChip('precio:0.50');
setCupo(true);
socket.trigger('roomsList', payload({ llenarTier05: true }));
g = grupos();
log('filtro sin resultados -> estado vacío del lobby: ' + (vacio() ? limpiar(vacio().textContent).slice(0, 46) : 'NO HAY'),
  g.length === 0 && !!vacio() && /Sin salas con estos filtros/.test(vacio().textContent));
const btn = vacio().querySelector('#btn-quitar-filtros');
log('el estado vacío ofrece botón para quitar filtros', !!btn);
despachar(btn, 'click');
log('botón "Ver todas las salas" restaura el lobby: ' + grupos().length + ' grupos y contador "' + limpiar(contador.textContent) + '"',
  grupos().length === 5 && limpiar(contador.textContent) === '21 salas' && checkCupo.checked === false);

// 6) Si desaparece la categoría activa, se vuelve a "Todas" (no queda vacío)
clickChip('precio:5.00');
const soloBaratas = payload().filter((s) => Number(s.precioEntrada) <= 1);
socket.trigger('roomsList', soloBaratas);
ch = chips();
log('categoría desaparecida -> se vuelve a "Todas": ' + ch.map((c) => c.txt).join(' | '),
  ch[0].activa === true && !ch.some((c) => c.cat === 'precio:5.00'));

// 7) Lobby sin salas
socket.trigger('roomsList', []);
log('sin salas -> estado vacío informativo y barra de filtros oculta: "' + limpiar(vacio().textContent).slice(0, 40) + '"',
  !!vacio() && /No hay salas activas/.test(vacio().textContent) && limpiar(contador.textContent) === '0 salas' && barra.style.display === 'none');
socket.trigger('roomsList', null);
log('roomsList nulo no rompe el render (defensivo)', !!vacio() && contador.textContent === '0 salas');
socket.trigger('roomsList', payload());
log('la barra de filtros vuelve al haber salas', barra.style.display === '' && grupos().length === 5);

console.log(`\n=== RESUMEN ===\nTotal: ${resultados.length} | Pasaron: ${resultados.filter(Boolean).length} | Fallaron: ${resultados.filter((r) => !r).length}`);
process.exit(resultados.every(Boolean) ? 0 : 1);