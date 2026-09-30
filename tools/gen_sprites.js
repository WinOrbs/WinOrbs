'use strict';

// ============================================================================
//  gen_sprites.js — Generador de sprites pixel-art de WinOrbs.
//
//  Sin dependencias: los PNG se codifican a mano (firma + IHDR + IDAT zlib +
//  IEND, con CRC32 propio), solo Node puro.
//
//  Uso:      node gen_sprites.js
//  Salida:   public/assets/game/*.png
//
//  Es 100% determinista: re-ejecutarlo regenera exactamente los mismos
//  archivos. Para sustituir un sprite por uno propio basta con guardar tu
//  PNG con el mismo nombre en public/assets/game/ (el juego lo usa solo y,
//  si falta o falla, el dibujo procedural original actúa de fallback).
// ============================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'game');

/* ===================== 1. Codificador PNG mínimo ===================== */

let CRC_TAB = null;
function crc32(buf) {
    if (!CRC_TAB) {
        CRC_TAB = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            CRC_TAB[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TAB[(crc ^ buf[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
}

function chunkPNG(tipo, datos) {
    const cab = Buffer.alloc(8);
    cab.writeUInt32BE(datos.length, 0);
    cab.write(tipo, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, 'ascii'), datos])), 0);
    return Buffer.concat([cab, datos, crc]);
}

function codificarPNG(cv) {
    const { w, h, data } = cv;
    const firma = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;  // bits por canal
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; // compresión deflate
    ihdr[11] = 0; // filtro adaptativo
    ihdr[12] = 0; // sin entrelazado
    const bruto = Buffer.alloc((w * 4 + 1) * h);
    let o = 0;
    for (let y = 0; y < h; y++) {
        bruto[o++] = 0; // filtro 0 (ninguno) en cada línea
        for (let x = 0; x < w * 4; x++) bruto[o++] = data[y * w * 4 + x];
    }
    const idat = zlib.deflateSync(bruto, { level: 9 });
    return Buffer.concat([firma, chunkPNG('IHDR', ihdr), chunkPNG('IDAT', idat), chunkPNG('IEND', Buffer.alloc(0))]);
}

/* ===================== 2. Paleta (identidad del juego) ===================== */

const P = {
    cielo: '#38bdf8', cieloOsc: '#0284c7', cieloClaro: '#7dd3fc',
    amar: '#facc15', amarClaro: '#fde68a', amarOsc: '#b45309', amarOsc2: '#d97706',
    verde: '#22c55e', verdeOsc: '#15803d', verdeClaro: '#86efac',
    rojo: '#ef4444', rojoOsc: '#991b1b', rojoClaro: '#fca5a5',
    purp: '#a855f7', purpOsc: '#7e22ce', purpClaro: '#d8b4fe',
    naranja: '#f97316',
    s950: '#020617', s900: '#0f172a', s800: '#1e293b', s700: '#334155', s600: '#475569', s400: '#94a3b8', s300: '#cbd5e1'
};

/* ===================== 3. Mini lienzo RGBA (pixel art) ===================== */

function lienzo(w, h) { return { w, h, data: new Uint8Array(w * h * 4) }; }

function rgba(col) {
    // '#rgb', '#rrggbb' o '#rrggbbaa' → [r, g, b, a]
    let h = col.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 6) h += 'ff';
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
}

function px(cv, x, y, col) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
    const [r, g, b, a] = rgba(col);
    const i = (y * cv.w + x) * 4;
    if (a >= 255) { cv.data[i] = r; cv.data[i + 1] = g; cv.data[i + 2] = b; cv.data[i + 3] = 255; return; }
    // mezcla "encima de" para los brillos translúcidos
    const da = cv.data[i + 3] / 255, sa = a / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    cv.data[i]     = Math.round((r * sa + cv.data[i]     * da * (1 - sa)) / oa);
    cv.data[i + 1] = Math.round((g * sa + cv.data[i + 1] * da * (1 - sa)) / oa);
    cv.data[i + 2] = Math.round((b * sa + cv.data[i + 2] * da * (1 - sa)) / oa);
    cv.data[i + 3] = Math.round(oa * 255);
}

function rect(cv, x, y, w, h, col) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(cv, i, j, col);
}

function disco(cv, cx, cy, r, col, cb) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= r * r && (!cb || cb(x, y, dx, dy))) px(cv, x, y, col);
        }
}

function elipse(cv, cx, cy, rx, ry, col, cb) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
            const nx = (x - cx) / rx, ny = (y - cy) / ry;
            if (nx * nx + ny * ny <= 1 && (!cb || cb(x, y, x - cx, y - cy))) px(cv, x, y, col);
        }
}

function linea(cv, x0, y0, x1, y1, col, grosor = 1) {
    const pasos = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    const g = Math.floor((grosor - 1) / 2);
    for (let i = 0; i <= pasos; i++) {
        const t = i / pasos;
        const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
        for (let dy = -g; dy <= grosor - 1 - g; dy++)
            for (let dx = -g; dx <= grosor - 1 - g; dx++) px(cv, x + dx, y + dy, col);
    }
}

function sombraInferior(cv, cx, cy, r, col, umbral = 2) {
    // oscurece la mitad inferior-derecha de un disco ya pintado (solo píxeles opacos)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) continue;
            const i = (y * cv.w + x) * 4;
            if (cv.data[i + 3] < 255) continue;
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > r * r) continue;
            if (dx + dy > umbral) px(cv, x, y, col);
        }
}

function contorno(cv, col, umbral = 250) {
    // trazo exterior de 1 px alrededor de las siluetas casi opacas
    const copia = Uint8Array.from(cv.data);
    const opaco = (x, y) => x >= 0 && y >= 0 && x < cv.w && y < cv.h && copia[(y * cv.w + x) * 4 + 3] >= umbral;
    for (let y = 0; y < cv.h; y++)
        for (let x = 0; x < cv.w; x++) {
            if (opaco(x, y)) continue;
            if (opaco(x - 1, y) || opaco(x + 1, y) || opaco(x, y - 1) || opaco(x, y + 1)) px(cv, x, y, col);
        }
}

function borrarPx(cv, x, y) {
    if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
    const i = (y * cv.w + x) * 4;
    cv.data[i] = cv.data[i + 1] = cv.data[i + 2] = cv.data[i + 3] = 0;
}

function borrar(cv, x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) borrarPx(cv, i, j);
}

/* ===================== 4. Sprites ===================== */

// Fondo del mapa: tesela 150×150 con la rejilla incluida (misma separación
// que la rejilla original, líneas #1e293b) más un moteado sutil.
function spFondo(cv) {
    rect(cv, 0, 0, 150, 150, '#0b1120');
    for (let n = 0; n < 70; n++) {
        const x = (n * 37 + ((n * n) % 23) * 7) % 150;
        const y = (n * 71 + ((n * n * n) % 29) * 3) % 150;
        px(cv, x, y, n % 4 === 0 ? '#1a2745' : '#121a2e');
        if (n % 9 === 0) px(cv, x + 1, y, '#121a2e');
    }
    // rejilla: borde derecho e inferior de la tesela
    for (let i = 0; i < 150; i++) { px(cv, 149, i, '#1e293b'); px(cv, i, 149, '#1e293b'); }
    rect(cv, 147, 147, 3, 3, '#22304e');
}

// Orbe de energía (amarillo, con halo y brillo especular)
function spOrbe(cv) {
    disco(cv, 12, 12, 11, '#facc151c');
    disco(cv, 12, 12, 9, '#facc1555');
    disco(cv, 12, 12, 7, P.amar);
    sombraInferior(cv, 12, 12, 7, P.amarOsc2, 2);
    disco(cv, 10, 10, 2.6, P.amarClaro);
    px(cv, 9, 9, '#fffbeb');
    contorno(cv, '#92400e');
}

// Kit de salud (caja verde con cruz blanca y asa)
function spKit(cv) {
    rect(cv, 12, 4, 8, 5, P.verdeOsc);   // asa
    borrar(cv, 14, 5, 4, 3);             // hueco del asa
    rect(cv, 5, 8, 22, 20, P.verdeOsc);
    rect(cv, 6, 9, 20, 18, P.verde);
    rect(cv, 6, 9, 20, 2, P.verdeClaro);
    rect(cv, 14, 11, 4, 14, '#f0fdf4');  // cruz vertical
    rect(cv, 9, 16, 14, 4, '#f0fdf4');   // cruz horizontal
    px(cv, 17, 24, '#bbf7d0'); px(cv, 22, 19, '#bbf7d0');
    contorno(cv, '#14532d');
}

// Bala (plomito amarillo apuntando a la derecha; se rota al dibujar)
function spBala(cv) {
    elipse(cv, 10, 10, 7.5, 4.5, P.amar);
    elipse(cv, 10, 10, 7.5, 4.5, P.amarOsc2, (x, y, dx, dy) => dy >= 1);
    elipse(cv, 13.5, 10, 3, 2.6, P.amarClaro);
    rect(cv, 10, 9, 3, 2, '#fffbeb');
    px(cv, 1, 10, '#fde68a44'); px(cv, 2, 10, '#fde68a66');
    px(cv, 2, 9, '#fde68a33'); px(cv, 2, 11, '#fde68a33');
    contorno(cv, P.amarOsc);
}

// Proyectil de orbe (esfera púrpura con halo)
function spBalaOrbe(cv) {
    disco(cv, 14, 14, 13, '#a855f71f');
    disco(cv, 14, 14, 10, '#a855f755');
    disco(cv, 14, 14, 7.5, P.purp);
    sombraInferior(cv, 14, 14, 7.5, P.purpOsc, 2);
    disco(cv, 12, 12, 3, P.purpClaro);
    px(cv, 11, 11, '#f5f3ff');
    contorno(cv, '#581c87');
}

// Bomba (esfera roja con mecha y chispa)
function spBomba(cv) {
    // chispa
    px(cv, 21, 2, '#fff7ed');
    px(cv, 20, 2, P.amarClaro); px(cv, 22, 2, P.amarClaro);
    px(cv, 21, 1, P.amarClaro); px(cv, 21, 3, P.amarClaro);
    px(cv, 20, 1, P.amar); px(cv, 22, 1, P.amar);
    px(cv, 20, 3, P.amar); px(cv, 22, 3, P.amar);
    // mecha
    linea(cv, 20, 4, 17, 6, P.s400, 1);
    // cuerpo
    disco(cv, 16, 18, 10, P.rojo);
    sombraInferior(cv, 16, 18, 10, P.rojoOsc, 3);
    disco(cv, 12.5, 14.5, 3, P.rojoClaro);
    px(cv, 12, 14, '#fee2e2');
    // boquilla metálica
    rect(cv, 14, 6, 5, 4, P.s600);
    rect(cv, 14, 6, 5, 1, P.s400);
    contorno(cv, '#7f1d1d');
}

// Explosión: tira de 4 frames (64×64 cada uno), de fogonazo a humo
function spExplosion(cv) {
    for (let f = 0; f < 4; f++) frameExplosion(cv, f * 64 + 32, 32, f);
}

function frameExplosion(cv, cx, cy, f) {
    const radios = [10, 16, 22, 24];
    const r = radios[f];
    // borde irregular determinista (sin azar: cada re-ejecución da lo mismo)
    const rug = (ang) => 1 + (Math.abs(Math.sin(ang * (3 + f) + f * 7)) - 0.5) * 0.22;
    for (let y = -32; y <= 32; y++) {
        for (let x = -32; x <= 32; x++) {
            const d = Math.hypot(x, y);
            const rr = r * rug(Math.atan2(y, x));
            if (f === 3) {
                // frame final: anillo de humo
                if (d > rr * 0.4 && d <= rr) {
                    const t = (d - rr * 0.4) / (rr * 0.6);
                    px(cv, cx + x, cy + y, t < 0.3 ? '#f97316e0' : t < 0.65 ? '#c2410cb8' : '#7c2d1290');
                }
                continue;
            }
            if (d > rr) continue;
            const t = d / rr;
            let col;
            if (f === 0) col = t < 0.45 ? '#ffffff' : t < 0.8 ? '#fef9c3' : '#fde047';
            else if (f === 1) col = t < 0.3 ? '#fffbeb' : t < 0.55 ? '#fde68a' : t < 0.8 ? '#facc15' : '#f97316';
            else col = t < 0.25 ? '#fff7ed' : t < 0.5 ? '#fde68a' : t < 0.75 ? '#f59e0b' : '#dc2626';
            px(cv, cx + x, cy + y, col);
        }
    }
    // brasas salpicadas en las fases avanzadas
    if (f >= 2) {
        for (let n = 0; n < 10; n++) {
            const ang = (n * 2.399) % (Math.PI * 2);
            const dist = Math.min(30, r * (1.1 + ((n * 37 + f * 13) % 10) / 22));
            px(cv, Math.round(cx + Math.cos(ang) * dist), Math.round(cy + Math.sin(ang) * dist), n % 2 ? '#fbbf24' : '#f97316');
        }
    }
}

// Airdrop: caja de suministros con travesaños, hebillas y emblema de orbe
function spAirdrop(cv) {
    rect(cv, 10, 24, 76, 60, P.amar);
    rect(cv, 10, 24, 76, 8, P.amarClaro);      // cara superior
    rect(cv, 10, 76, 76, 8, P.amarOsc2);       // sombra inferior
    // travesaños metálicos
    rect(cv, 24, 24, 10, 60, P.amarOsc);
    rect(cv, 25, 24, 2, 60, P.amarOsc2);
    rect(cv, 62, 24, 10, 60, P.amarOsc);
    rect(cv, 63, 24, 2, 60, P.amarOsc2);
    // juntas de paneles (fuera de los travesaños)
    [10, 18, 42, 50, 58, 74, 82].forEach(x => { px(cv, x, 56, P.amarOsc2); px(cv, x, 57, P.amarOsc2); });
    // hebillas
    rect(cv, 26, 36, 6, 8, '#78350f');
    rect(cv, 64, 36, 6, 8, '#78350f');
    // remaches
    [[14, 28], [81, 28], [14, 80], [81, 80]].forEach(([x, y]) => {
        px(cv, x, y, '#fef3c7'); px(cv, x + 1, y, '#fef3c7');
        px(cv, x, y + 1, '#fef3c7'); px(cv, x + 1, y + 1, P.amarOsc);
    });
    // emblema: orbe del botín
    disco(cv, 48, 52, 10, '#fffbeb');
    disco(cv, 48, 52, 7, P.amar);
    sombraInferior(cv, 48, 52, 7, P.amarOsc2, 1);
    disco(cv, 45, 49, 2, '#fffbeb');
    contorno(cv, '#78350f');
}

// Obstáculo: bloque rocoso con chaflanes, facetas y grietas
function spObstaculo(cv) {
    rect(cv, 8, 8, 80, 80, '#334155');
    // chaflanes de las 4 esquinas
    for (let y = 8; y < 88; y++)
        for (let x = 8; x < 88; x++) {
            const s1 = (x - 8) + (y - 8), s2 = (87 - x) + (y - 8);
            const s3 = (x - 8) + (87 - y), s4 = (87 - x) + (87 - y);
            if (s1 < 14 || s2 < 14 || s3 < 14 || s4 < 14) borrarPx(cv, x, y);
        }
    // facetas: luz arriba-izquierda, sombra abajo-derecha
    for (let y = 8; y < 88; y++)
        for (let x = 8; x < 88; x++) {
            const i = (y * cv.w + x) * 4;
            if (cv.data[i + 3] < 255) continue;
            const s = (x - 8) + (y - 8);
            if (s < 30) px(cv, x, y, P.s600);
            else if (s > 110) px(cv, x, y, P.s800);
        }
    // grietas
    linea(cv, 34, 12, 42, 40, P.s900, 2);
    linea(cv, 42, 40, 32, 64, P.s900, 2);
    linea(cv, 40, 78, 48, 60, P.s900, 2);
    linea(cv, 62, 14, 56, 44, P.s900, 1);
    linea(cv, 56, 44, 68, 70, P.s900, 1);
    // piedrecitas
    px(cv, 26, 72, P.s600); px(cv, 27, 72, P.s600);
    px(cv, 70, 26, P.s600); px(cv, 71, 26, P.s600);
    contorno(cv, P.s950);
}

// Muro destructible: paneles metálicos con tornillos
function spMuro(cv) {
    rect(cv, 6, 10, 84, 76, '#4b5a6d');
    rect(cv, 6, 34, 84, 2, P.s700);            // juntas de los tablones
    rect(cv, 6, 58, 84, 2, P.s700);
    rect(cv, 6, 10, 84, 2, P.s400);            // brillo superior
    rect(cv, 6, 84, 84, 2, P.s700);            // sombra inferior
    rect(cv, 6, 10, 2, 76, P.s700);            // bordes laterales
    rect(cv, 88, 10, 2, 76, P.s700);
    // tornillos
    [22, 46, 70].forEach(y => {
        px(cv, 12, y, P.s300); px(cv, 13, y, P.s300);
        px(cv, 12, y + 1, P.s300); px(cv, 13, y + 1, P.s300);
        px(cv, 82, y, P.s300); px(cv, 83, y, P.s300);
        px(cv, 82, y + 1, P.s300); px(cv, 83, y + 1, P.s300);
    });
    contorno(cv, P.s800);
}

// Speed pad: base oscura con borde amarillo y chevrones (la animación la pone el juego)
function spTurbo(cv) {
    rect(cv, 4, 3, 88, 30, P.amar);            // borde exterior
    rect(cv, 7, 6, 82, 24, '#131f36');         // pista interior
    // esquinas redondeadas
    [[4, 3], [5, 3], [4, 4], [91, 3], [90, 3], [91, 4],
     [4, 32], [5, 32], [4, 31], [91, 32], [90, 32], [91, 31]].forEach(([x, y]) => borrarPx(cv, x, y));
    borrarPx(cv, 7, 6); borrarPx(cv, 88, 6); borrarPx(cv, 7, 29); borrarPx(cv, 88, 29);
    // chevrones con sombra cálida
    for (let i = 0; i < 3; i++) {
        const cx = 20 + i * 26;
        linea(cv, cx - 4, 11, cx + 4, 19, P.amarOsc2, 3);
        linea(cv, cx - 4, 27, cx + 4, 19, P.amarOsc2, 3);
        linea(cv, cx - 5, 10, cx + 3, 18, P.amarClaro, 3);
        linea(cv, cx - 5, 26, cx + 3, 18, P.amarClaro, 3);
    }
}

// Tienda: caseta con toldo a rayas, moneda-señal, ventanas y puerta
function spTienda(cv) {
    // moneda-señal colgando sobre el toldo
    disco(cv, 48, 19, 6, P.amarClaro);
    disco(cv, 48, 19, 4.5, P.amar);
    sombraInferior(cv, 48, 19, 4.5, P.amarOsc2, 1);
    px(cv, 46, 17, '#fffbeb');
    // toldo a rayas
    for (let i = 0; i < 9; i++) rect(cv, 12 + i * 8, 26, 8, 14, i % 2 ? '#e0f2fe' : P.cielo);
    rect(cv, 12, 38, 72, 2, P.cieloOsc);
    // cuerpo
    rect(cv, 18, 40, 60, 44, '#0c4a6e');
    // ventanas
    rect(cv, 24, 48, 14, 12, P.cieloClaro);
    rect(cv, 58, 48, 14, 12, P.cieloClaro);
    rect(cv, 24, 48, 14, 2, '#bae6fd');
    rect(cv, 58, 48, 14, 2, '#bae6fd');
    // puerta con tirador
    rect(cv, 41, 58, 14, 26, '#075985');
    rect(cv, 47, 70, 2, 3, P.amarClaro);
    contorno(cv, '#082f49');
}

// Banco: bóveda verde con rueda giratoria y pies
function spBanco(cv) {
    rect(cv, 14, 12, 68, 70, '#14532d');       // marco
    rect(cv, 18, 16, 60, 62, '#052e16');       // interior
    disco(cv, 48, 47, 26, '#14532d');          // aro exterior de la puerta
    disco(cv, 48, 47, 23, P.verde);            // puerta
    sombraInferior(cv, 48, 47, 23, P.verdeOsc, 8);
    // radios de la rueda
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        linea(cv, 48 + Math.cos(a) * 7, 47 + Math.sin(a) * 7, 48 + Math.cos(a) * 19, 47 + Math.sin(a) * 19, '#065f46', 3);
    }
    disco(cv, 48, 47, 6, '#4ade80');           // eje central
    rect(cv, 44, 45, 8, 4, '#052e16');         // manilla
    px(cv, 46, 45, '#bbf7d0');
    // pies
    rect(cv, 20, 82, 12, 6, '#052e16');
    rect(cv, 64, 82, 12, 6, '#052e16');
    contorno(cv, '#052e16');
}

// Lanza-Orbes (botín de airdrop): cañón morado con el orbe cargado en la boca
function spOrbGun(cv) {
    // aleta superior de mira
    rect(cv, 6, 12, 3, 3, P.purp);
    // cuerpo / culata
    rect(cv, 4, 15, 15, 8, P.purpOsc);
    rect(cv, 4, 15, 15, 2, P.purp);          // brillo superior
    rect(cv, 4, 21, 15, 2, '#5b21b6');       // sombra inferior
    // franja de energía (cargador)
    rect(cv, 7, 18, 3, 3, P.purpClaro);
    px(cv, 8, 19, '#f5f3ff');
    // cañón
    rect(cv, 19, 16, 5, 6, '#5b21b6');
    rect(cv, 19, 16, 5, 2, P.purp);
    rect(cv, 23, 15, 2, 8, '#3b0764');       // anillo de la boca
    // empuñadura y guardamonte
    rect(cv, 8, 23, 5, 7, '#3b0764');
    rect(cv, 9, 24, 3, 5, P.purpOsc);
    linea(cv, 14, 22, 17, 26, '#3b0764', 2);
    // orbe cargado en la boca (halo + núcleo brillante)
    disco(cv, 27, 19, 4.5, '#d8b4fe66');
    disco(cv, 27, 19, 3, P.purpClaro);
    disco(cv, 27, 19, 1.6, '#f5f3ff');
    px(cv, 26, 18, '#ffffff');
    contorno(cv, '#3b0764');
}

// Coche (cobertura destructible): visto desde arriba y en horizontal. Al
// destruirse explota (radio 150, 45 de daño) y suelta 2 orbes ×10.
function spCoche(cv) {
    // neumáticos (asoman por los cuatro costados)
    [[13, 5], [60, 5], [13, 37], [60, 37]].forEach(([x, y]) => rect(cv, x, y, 12, 6, '#0b1120'));
    // carrocería
    rect(cv, 4, 7, 71, 34, P.rojo);
    rect(cv, 4, 7, 71, 4, P.rojoClaro);        // brillo superior
    rect(cv, 4, 37, 71, 4, P.rojoOsc);         // sombra inferior
    // cristales (parabrisas delantero y luneta)
    rect(cv, 20, 11, 12, 26, P.cieloClaro);
    rect(cv, 48, 11, 12, 26, '#7dd3fc');
    // techo
    rect(cv, 34, 10, 12, 28, '#b91c1c');
    rect(cv, 34, 10, 12, 3, '#dc2626');
    // faros y pilotos
    rect(cv, 73, 11, 3, 7, P.amarClaro);
    rect(cv, 73, 30, 3, 7, P.amarClaro);
    rect(cv, 3, 11, 3, 7, P.rojoClaro);
    rect(cv, 3, 30, 3, 7, P.rojoClaro);
    contorno(cv, '#450a0a');
}

// Moto (frágil): al reventarla regala un turbo ×1.9 (~2 s) a quien la destruye.
function spMoto(cv) {
    // ruedas
    rect(cv, 6, 6, 7, 16, '#0b1120');
    rect(cv, 34, 6, 7, 16, '#0b1120');
    px(cv, 9, 13, P.s400); px(cv, 37, 13, P.s400);
    // chasis
    rect(cv, 12, 9, 25, 10, P.purpOsc);
    rect(cv, 12, 9, 25, 3, P.purp);
    // depósito (brillante) y asiento
    rect(cv, 18, 10, 12, 8, P.purpClaro);
    rect(cv, 30, 11, 8, 6, '#0f172a');
    // manillar
    rect(cv, 39, 8, 5, 12, P.s700);
    rect(cv, 40, 7, 3, 2, P.s300);
    // tubo de escape
    rect(cv, 14, 19, 10, 3, P.s400);
    contorno(cv, '#2e1065');
}

// Barril explosivo: rojo con franjas de peligro. Reacción en cadena con los
// explosivos (barriles y vehículos) que tenga cerca.
function spBarril(cv) {
    rect(cv, 6, 2, 20, 28, P.rojo);
    rect(cv, 6, 2, 20, 3, P.rojoClaro);        // tapa
    rect(cv, 6, 27, 20, 3, P.rojoOsc);         // base
    // aros metálicos
    rect(cv, 6, 9, 20, 2, P.s600);
    rect(cv, 6, 21, 20, 2, P.s600);
    // franja de peligro con marcas inclinadas
    rect(cv, 8, 14, 16, 5, P.amar);
    rect(cv, 8, 14, 16, 1, P.amarClaro);
    px(cv, 11, 16, P.s900); px(cv, 13, 17, P.s900);
    px(cv, 17, 16, P.s900); px(cv, 19, 17, P.s900);
    px(cv, 22, 16, P.s900); px(cv, 24, 17, P.s900);
    // brillo lateral
    rect(cv, 8, 3, 2, 26, P.rojoClaro);
    contorno(cv, '#450a0a');
}


/* ===================== 4b. Iconos pixel-art del HUD (16x16) ===================== */
// Cada icono es una "cadena de pixeles": cada caracter mapea a un color;
// '.' = transparente. Cero dependencias, mismo encoder PNG de arriba.
function spIconoMapa(filas, mapa) {
    return function (cv) {
        filas.forEach((fila, y) => {
            for (let x = 0; x < fila.length && x < cv.w; x++) {
                const col = mapa[fila[x]];
                if (col) px(cv, x, y, col);
            }
        });
    };
}

const ICONOS = [
    ['ui-heart.png', [
        '................',
        '..XXXX....XXXX..',
        '.XXXXXXXXXXXXXX.',
        '.XHXXXXXXXXXXXX.',
        '.XHXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '..XXXXXXXXXXXX..',
        '...XXXXXXXXXX...',
        '....XXXXXXXX....',
        '.....XXXXXX.....',
        '......XXXX......',
        '.......XX.......',
        '................',
        '................',
        '................',
        '................'],
        { X: '#ef4444', H: '#fca5a5' }],
    ['ui-shield.png', [
        '................',
        '..XXXXXXXXXXXX..',
        '..XXXXXXXXXXXX..',
        '..XXHXXXXXXXXX..',
        '..XXHXXXXXXXXX..',
        '...XXXXXXXXXX...',
        '...XXXXXXXXXX...',
        '....XXXXXXXX....',
        '....XXXXXXXX....',
        '.....XXXXXX.....',
        '.....XXXXXX.....',
        '......XXXX......',
        '.......XX.......',
        '................',
        '................',
        '................'],
        { X: '#38bdf8', H: '#bae6fd' }],
    ['ui-gem.png', [
        '................',
        '....XXXXXXXX....',
        '..XXXHXXXXXDDX..',
        '.XXXHHXXXXXDDDX.',
        '.XXXXXXXXXXXXXX.',
        '..XXXXXXXXXXXX..',
        '...XXXXXXXXXX...',
        '....XXXXXXXX....',
        '.....XXXXXX.....',
        '......XXXX......',
        '.......XX.......',
        '................',
        '................',
        '................',
        '................',
        '................'],
        { X: '#a855f7', H: '#d8b4fe', D: '#6b21a8' }],
    ['ui-ammo.png', [
        '................',
        '.....XXXXXX.....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXHHXXXX....',
        '....XXXXXXXX....',
        '...DXXXXXXXXD...',
        '....DDDDDDDD....',
        '................',
        '................',
        '................'],
        { X: '#facc15', H: '#fef08a', D: '#b45309' }],
    ['ui-gun.png', [
        '................',
        '................',
        '................',
        '................',
        '..XXXXXXXXX.....',
        '..XXXXXXXXXXXXXX',
        '..XXXXXX..XXX...',
        '...XXXXX..XXX...',
        '...XXXXX..XX....',
        '...XXXX.........',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................'],
        { X: '#94a3b8' }],
    ['ui-bomb.png', [
        '............YY..',
        '...........Y....',
        '.........FF.....',
        '....XXXXXF......',
        '...XXXXXXX......',
        '..XXXXXXXXXXX...',
        '..XXHXXXXXXXD...',
        '..XXXXXXXXXXX...',
        '..XXXXXXXXXXX...',
        '..XXXXXXXXXXX...',
        '...XXXXXXXXX....',
        '.....XXXXX......',
        '................',
        '................',
        '................',
        '................'],
        { X: '#334155', H: '#94a3b8', D: '#0f172a', F: '#94a3b8', Y: '#facc15' }],
    ['ui-clock.png', [
        '................',
        '.XXXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '.XX..........XX.',
        '.XX....D.....XX.',
        '.XX....D.....XX.',
        '.XX....D.....XX.',
        '.XX....DDDXXX...',
        '.XX..........XX.',
        '.XX..........XX.',
        '.XXXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '................',
        '................',
        '................',
        '................'],
        { X: '#38bdf8', D: '#fef08a' }],
    ['ui-skull.png', [
        '................',
        '....XXXXXXXX....',
        '..XXXXXXXXXXXX..',
        '..XXXXXXXXXXXX..',
        '..XXDDXXXXDDXX..',
        '..XXDDXXXXDDXX..',
        '..XXDDXXXXDDXX..',
        '..XXXXXXXXXXXX..',
        '...XXXXXXXXXX...',
        '...XDXXDXXDX....',
        '....XDXXDX......',
        '................',
        '................',
        '................',
        '................',
        '................'],
        { X: '#e2e8f0', D: '#0f172a' }],
    ['ui-trophy.png', [
        '................',
        '.XXXXXXXXXXXXXX.',
        '.XHXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '..XXXXXXXXXXXX..',
        '...XXXXXXXXXX...',
        '....XXXXXXXX....',
        '......XXXX......',
        '......XXXX......',
        '.....XXXXXX.....',
        '...XXXXXXXXXX...',
        '..XXXXXXXXXXXX..',
        '................',
        '................',
        '................',
        '................'],
        { X: '#facc15', H: '#fef08a' }],
    ['ui-bolt.png', [
        '................',
        '..........XXX...',
        '.........XXX....',
        '........XXXX....',
        '.......XXXXX....',
        '......XXXXXX....',
        '.....XXXXXX.....',
        '....XXXXXXXX....',
        '...XXXXXX.......',
        '....XXXXXXX.....',
        '.....XXXXX......',
        '......XXXX......',
        '.......XXX......',
        '........XX......',
        '................',
        '................'],
        { X: '#fde047' }],
    ['ui-coin.png', [
        '................',
        '....XXXXXXXX....',
        '..XXHHXXXXDDXX..',
        '.XXHHXXXXXXDDXX.',
        '.XXHXXXXXXXXDXX.',
        '.XXXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '.XXXXXXXXXXXXXX.',
        '..XXXXXXXXXXXX..',
        '....XXXXXXXX....',
        '................',
        '................',
        '................',
        '................',
        '................'],
        { X: '#facc15', H: '#fef08a', D: '#b45309' }]
].map(([nombre, filas, mapa]) => [nombre, 16, 16, spIconoMapa(filas, mapa)]);

/* ===================== 5. Generación y verificación ===================== */
const SPRITES = [
    ['bg-tile.png', 150, 150, spFondo],
    ['orb-energy.png', 24, 24, spOrbe],
    ['health-kit.png', 32, 32, spKit],
    ['bullet.png', 20, 20, spBala],
    ['bullet-orb.png', 28, 28, spBalaOrbe],
    ['bomb.png', 32, 32, spBomba],
    ['explosion.png', 256, 64, spExplosion],
    ['airdrop.png', 96, 96, spAirdrop],
    ['obstacle.png', 96, 96, spObstaculo],
    ['wall.png', 96, 96, spMuro],
    ['speed-pad.png', 96, 36, spTurbo],
    ['shop.png', 96, 96, spTienda],
    ['bank.png', 96, 96, spBanco],
    ['orb-gun.png', 32, 32, spOrbGun],
    ['car.png', 80, 48, spCoche],
    ['moto.png', 48, 28, spMoto],
    ['barrel.png', 32, 32, spBarril]
].concat(ICONOS);

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Generando ${SPRITES.length} sprites en public/assets/game/ ...\n`);
    for (const [nombre, w, h, fn] of SPRITES) {
        const cv = lienzo(w, h);
        fn(cv);
        const png = codificarPNG(cv);
        fs.writeFileSync(path.join(OUT_DIR, nombre), png);
        console.log(`  ✓ ${nombre.padEnd(16)} ${String(w).padStart(3)}×${String(h).padStart(3)}  ${(png.length / 1024).toFixed(1)} KB`);
    }
    // verificación: relee cada PNG y comprueba firma + cabecera IHDR
    let mal = 0;
    for (const [nombre, w, h] of SPRITES) {
        const buf = fs.readFileSync(path.join(OUT_DIR, nombre));
        const firmaOk = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        if (!firmaOk || buf.readUInt32BE(16) !== w || buf.readUInt32BE(20) !== h) {
            console.error(`  ✗ ${nombre}: ¡cabecera PNG inválida!`);
            mal++;
        }
    }
    console.log(mal === 0
        ? '\nVerificación de cabeceras PNG: OK'
        : `\n¡Atención! ${mal} PNG con problemas.`);
    console.log('\nPara reemplazar un sprite: guarda tu PNG con el mismo nombre en public/assets/game/.');
}

main();