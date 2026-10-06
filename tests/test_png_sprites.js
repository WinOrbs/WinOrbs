'use strict'; // Check that existing game image assets fit the renderer contract.

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

function dimensionsOf(image) {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (image.length >= 24 && image.subarray(0, 8).equals(pngSignature)) {
        return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
    }

    if (image.length >= 4 && image[0] === 0xff && image[1] === 0xd8) {
        let offset = 2;
        while (offset < image.length) {
            if (image[offset] !== 0xff) {
                offset++;
                continue;
            }
            while (image[offset] === 0xff) offset++;
            const marker = image[offset++];
            if (marker === 0xd9 || marker === 0xda) break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (offset + 2 > image.length) break;

            const segmentLength = image.readUInt16BE(offset);
            const isStartOfFrame = [
                0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
                0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
            ].includes(marker);
            if (isStartOfFrame && segmentLength >= 7 && offset + 7 <= image.length) {
                return { height: image.readUInt16BE(offset + 3), width: image.readUInt16BE(offset + 5) };
            }
            if (segmentLength < 2) break;
            offset += segmentLength;
        }
    }

    return null;
}

for (const name of references) {
    const file = path.join(assetDir, name);
    if (!fs.existsSync(file)) {
        failures.push(`Falta el recurso ${name}`);
        continue;
    }

    const dimensions = dimensionsOf(fs.readFileSync(file));
    if (!dimensions || !dimensions.width || !dimensions.height) {
        failures.push(`${name} no contiene una imagen PNG/JPEG válida con dimensiones`);
    }
}

if (!/explosion: \{ src: 'assets\/game\/explosion\.png', frameW: 64, frameH: 64, frames: 4 \}/.test(game)) {
    failures.push('La tira de explosión no usa los cuatro cuadros de 64x64 del PNG existente');
}

if (!/const escala = Math\.min\(w \/ img\.naturalWidth, maxAlto \/ img\.naturalHeight\)/.test(game)) {
    failures.push('Los sprites del canvas no conservan su proporción al ajustarse a su caja');
}

if (!/\.podium-sprite\s*\{[^}]*object-fit:\s*contain/s.test(game)) {
    failures.push('Las medallas del podio se deforman al ajustar su tamaño');
}

if (!/podium-\$\{medal\}\.png/.test(game)) {
    failures.push('El podio no construye la ruta PNG de la medalla');
}

if (failures.length) {
    console.error(failures.map((failure) => `FAIL - ${failure}`).join('\n'));
    process.exitCode = 1;
} else {
    console.log(`OK - ${references.size} recursos existentes tienen dimensiones válidas y el render conserva proporciones.`);
}
