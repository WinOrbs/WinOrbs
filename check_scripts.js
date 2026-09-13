// Validador de sintaxis de los <script> embebidos en las páginas del juego.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pages = ['public/index.html', 'public/login.html', 'public/perfil.html', 'public/wallet.html', 'public/admin.html', 'public/game.html'];
let allOk = true;

for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const blocks = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (/src\s*=/.test(m[0])) continue; // scripts externos
        blocks.push(m[1]);
    }
    let pageOk = true;
    blocks.forEach((block, i) => {
        // quitar sentencias import/export completas (incluidas las multilínea)
        let src = block.replace(/^\s*import\s[^;]+;/gms, '').replace(/^\s*export\s[^;]+;/gms, '');
        try {
            new vm.Script(src, { filename: `${page}#script${i + 1}` });
        } catch (e) {
            pageOk = false;
            allOk = false;
            console.log(`FAIL ${page} #script${i + 1}: ${e.message}`);
        }
    });
    console.log(`${pageOk ? 'OK  ' : 'FAIL'} ${page} (${blocks.length} bloques inline)`);
}

process.exit(allOk ? 0 : 1);