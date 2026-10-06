'use strict';

const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'public', 'game.html');
const assetDir = path.join(__dirname, '..', 'public', 'assets', 'game');
const game = fs.readFileSync(gamePath, 'utf8');
const references = new Set(
    [...game.matchAll(/assets\/game\/([a-z-]+\.svg)/g)].map((match) => match[1])
);

for (const medal of ['gold', 'silver', 'bronze']) references.add(`podium-${medal}.svg`);

const failures = [];
if (references.size !== 30) failures.push(`Se esperaban 30 recursos SVG referenciados, hay ${references.size}`);
if (/assets\/game\/[a-z-]+\.png/.test(game)) failures.push('Quedan referencias a sprites raster del juego');

for (const name of references) {
    const file = path.join(assetDir, name);
    if (!fs.existsSync(file)) {
        failures.push(`Falta el recurso ${name}`);
        continue;
    }

    const svg = fs.readFileSync(file, 'utf8');
    const root = svg.match(/^<svg\b[^>]*>/);
    if (!root || !root[0].includes('viewBox=')) {
        failures.push(`${name} no tiene una raíz SVG con viewBox`);
        continue;
    }

    if (!name.startsWith('podium-')) {
        const dimensions = root[0].match(/width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/);
        const scale = name === 'bg-tile.svg' ? 1 : 4;
        if (!dimensions ||
            Number(dimensions[1]) !== Number(dimensions[3]) * scale ||
            Number(dimensions[2]) !== Number(dimensions[4]) * scale) {
            failures.push(`${name} no conserva el tamaño lógico y la resolución esperada`);
        }
    }
}

if (!/explosion: \{ src: 'assets\/game\/explosion\.svg', frameW: 256, frameH: 256, frames: 4 \}/.test(game)) {
    failures.push('La tira de explosión no usa el recorte correspondiente al SVG 4x');
}

const generator = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gen_sprites_vector.js'), 'utf8');
if (!/radialGradient id="shine" cx="\.28" cy="\.24" r="\.85"/.test(generator)) {
    failures.push('El brillo radial debe usar coordenadas relativas al sprite, no valores fijos fuera del viewBox');
}

if (failures.length) {
    console.error(failures.map((failure) => `FAIL - ${failure}`).join('\n'));
    process.exitCode = 1;
} else {
    console.log(`OK - ${references.size} sprites vectoriales existen, mantienen resolución y no hay referencias PNG en el HUD.`);
}
