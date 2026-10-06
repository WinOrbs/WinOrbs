'use strict'; // Check raster assets produced from the vector sources.

const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'public', 'game.html');
const assetDir = path.join(__dirname, '..', 'public', 'assets', 'game');
const game = fs.readFileSync(gamePath, 'utf8');
const references = new Set(
    [...game.matchAll(/assets\/game\/([a-z-]+\.png)/g)].map((match) => match[1])
);
for (const medal of ['gold', 'silver', 'bronze']) references.add(`podium-${medal}.png`);

const failures = [];
if (references.size !== 30) failures.push(`Se esperaban 30 recursos PNG referenciados, hay ${references.size}`);
if (/assets\/game\/[a-z-]+\.svg/.test(game)) failures.push('Quedan referencias SVG activas en el juego');

for (const name of references) {
    const file = path.join(assetDir, name);
    if (!fs.existsSync(file)) {
        failures.push(`Falta el recurso ${name}`);
        continue;
    }

    const png = fs.readFileSync(file);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (png.length < 24 || !png.subarray(0, 8).equals(signature)) {
        failures.push(`${name} no contiene una cabecera PNG válida`);
        continue;
    }

    if (!name.startsWith('podium-')) {
        const svgPath = path.join(assetDir, name.replace(/\.png$/, '.svg'));
        if (!fs.existsSync(svgPath)) {
            failures.push(`Falta la fuente vectorial de ${name}`);
            continue;
        }
        const svg = fs.readFileSync(svgPath, 'utf8');
        const dimensions = svg.match(/^<svg\b[^>]*width="(\d+)" height="(\d+)"/);
        if (!dimensions ||
            png.readUInt32BE(16) !== Number(dimensions[1]) ||
            png.readUInt32BE(20) !== Number(dimensions[2])) {
            failures.push(`${name} no conserva la resolución de su fuente SVG`);
        }
    }
}

if (!/explosion: \{ src: 'assets\/game\/explosion\.png', frameW: 256, frameH: 256, frames: 4 \}/.test(game)) {
    failures.push('La tira de explosión no usa el recorte correspondiente al PNG 4x');
}

if (!/podium-\$\{medal\}\.png/.test(game)) {
    failures.push('El podio no construye la ruta PNG de la medalla');
}

if (failures.length) {
    console.error(failures.map((failure) => `FAIL - ${failure}`).join('\n'));
    process.exitCode = 1;
} else {
    console.log(`OK - ${references.size} sprites PNG existen, tienen cabeceras válidas y no hay referencias SVG activas.`);
}
