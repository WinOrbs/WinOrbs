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

assert.ok(server.includes("server.listen(PORT, '0.0.0.0'"), 'Render server must bind publicly');
assert.ok(server.includes("const PORT = Number(process.env.PORT) || 3000"), 'server must honor Render PORT');
assert.ok(packageJson.scripts.build.includes("fs.copyFileSync('sw.js','dist/sw.js')"), 'Cloudflare Pages build must publish the Monetag service worker');
assert.ok(server.includes("app.get('/sw.js', (req, res) => res.sendFile(__dirname + '/sw.js'))"), 'Express static hosting must expose the root service worker');

console.log('OK deploy config: Render backend, Cloudflare service worker, frontend-only CORS helper, script ordering, and Render port binding.');
