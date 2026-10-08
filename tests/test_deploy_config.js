'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const frontendConfig = fs.readFileSync(
    path.join(root, 'public/js/servidor-config.js'),
    'utf8'
);
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const defaults = fs.readFileSync(path.join(root, 'apps/server/config/defaults.js'), 'utf8');
const httpServer = fs.readFileSync(path.join(root, 'apps/server/http/index.js'), 'utf8');
const changer = fs.readFileSync(path.join(root, 'tools/cambiar-servidor.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const gameHtml = fs.readFileSync(path.join(root, 'public/game.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(
    frontendConfig,
    /window\.SERVIDOR_URL\s*=\s*"https:\/\/winorbs\.onrender\.com";/,
    'frontend must point Socket.IO at the production Render backend'
);
assert.ok(
    !frontendConfig.includes('winorbs-api.onrender.com'),
    'frontend must not use the inactive Render hostname'
);
assert.ok(
    !server.includes('winorbs-api.onrender.com'),
    'server source must not contain the inactive Render hostname'
);
assert.ok(
    changer.includes("const CORS_BASE = 'https://winorbs.pages.dev';"),
    'deployment helper must keep CORS_ORIGIN on the frontend origin'
);
assert.ok(
    !changer.includes("origenes = [url]"),
    'deployment helper must never turn the backend URL into a CORS origin'
);

for (const [name, html] of [['index.html', indexHtml], ['game.html', gameHtml]]) {
    const configPos = html.indexOf('<script src="/js/servidor-config.js"></script>');
    const socketPos = html.indexOf('io(window.SERVIDOR_URL');
    assert.ok(configPos >= 0, name + ' must load servidor-config.js');
    assert.ok(socketPos > configPos, name + ' must load backend config before creating Socket.IO');
}

assert.ok(server.includes('server.listen(PORT, config.server.host'), 'server must bind using centralized host configuration');
assert.ok(server.includes('const PORT = config.server.port'), 'server must honor validated centralized PORT configuration');
assert.ok(defaults.includes("host: '0.0.0.0'"), 'server default host must remain publicly bindable');
assert.ok(packageJson.scripts.build.includes("fs.copyFileSync('sw.js','dist/sw.js')"), 'Cloudflare Pages build must publish the Monetag service worker');
assert.ok(httpServer.includes("app.get('/sw.js', (req, res) => res.sendFile(rootDir + '/sw.js'))"), 'Express static hosting must expose the root service worker');
assert.ok(indexHtml.includes("script.dataset.zone = '11978865'"), 'SOLO lobby must load the configured Monetag vignette zone');
assert.ok(indexHtml.includes("script.src = 'https://n6wxm.com/vignette.min.js'"), 'SOLO lobby must load the Monetag vignette script');
assert.ok(
    /botonModoSolo\.disabled = true;\s+cargarViñetaMonetagPractica\(\);\s+try \{\s+await entrarPracticaBots\(nick\);/.test(indexHtml),
    'lobby must load Monetag when SOLO is selected, before requesting practice entry'
);
assert.ok(
    !gameHtml.includes('n6wxm.com/vignette.min.js') && !gameHtml.includes('cargarViñetaMonetagPractica'),
    'game page must not request a second Monetag script after entering practice'
);
assert.ok(indexHtml.includes('id="solo-ticket-bar"'), 'lobby must render solo ticket progress');
assert.ok(server.includes('recordSoloVictory({'), 'server must record SOLO wins from its authoritative result');
assert.ok(server.includes('servidorCobrarEntradaConBoleto'), 'paid room entry must route through server-side ticket redemption');
assert.ok(server.includes('soloTicketFfaFee: precioMinimoFfa()'), 'server must provide the authoritative lowest FFA ticket price');

console.log('OK deploy config: Render, Monetag, solo-ticket UI and server entry wiring.');
