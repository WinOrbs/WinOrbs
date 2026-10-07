// Orquestador de los tests que necesitan servidor vivo.
// Levanta server.js, corre cada test con TIMEOUT (los de salas de pago se
// quedan colgados esperando un join que el entorno local rechaza) y apaga todo.
// Uso: node tests/run_live.js [puerto]
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.argv[2]) || 3000;

const TESTS = [
    ['test_auth.js', 30],
    ['test_edge.js', 30],
    ['test_multiplayer.js', 25],
    ['test_multiplayer2.js', 40],
    ['test_autostart.js', 60],
    ['test_manual_start.js', 45]
];

const resumen = [];
let srv = null;
let suiteFailed = false;

if (!process.env.ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD must be set explicitly before running live admin/gameplay tests.');
    process.exit(2);
}

function apagar() {
    // OJO: solo se mata el servidor que lanzó ESTE runner. Un taskkill global
    // de node.exe mataría también al propio runner (y a cualquier otro node del
    // equipo), que es lo que pasaba antes.
    if (srv && !srv.killed) { try { srv.kill(); } catch (e) { } }
    srv = null;
}

const esperarArranque = (n) => new Promise(res => {
    const t0 = Date.now();
    const int = setInterval(() => {
        http.get({ host: '127.0.0.1', port: PUERTO, path: '/status' }, r => {
            r.resume();
            if (r.statusCode === 200) { clearInterval(int); res(true); }
        }).on('error', () => {
            if (Date.now() - t0 > n) { clearInterval(int); res(false); }
        });
    }, 400);
});

(async () => {
    apagar();
    await new Promise(r => setTimeout(r, 800));

    srv = spawn(process.execPath, ['server.js'], {
        cwd: RAIZ,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(PUERTO) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let errServ = '';
    srv.stderr.on('data', d => errServ += d);
    srv.stdout.on('data', d => errServ += d);

    if (!await esperarArranque(15000)) {
        console.log('✖ El servidor no arrancó en el puerto ' + PUERTO);
        if (errServ.trim()) console.log('Salida del servidor:\n' + errServ.trim().slice(0, 600));
        apagar();
        process.exit(1);
    }
    console.log('Servidor listo en ' + PUERTO + '\n');

    for (const [nombre, seg] of TESTS) {
        const r = spawnSync(process.execPath, ['tests/' + nombre], {
            cwd: RAIZ, encoding: 'utf8', timeout: seg * 1000
        });
        const out = (r.stdout || '') + (r.stderr || '');
        const pass = (out.match(/\[PASS\]/g) || []).length;
        const fail = (out.match(/\[FAIL\]/g) || []).length;
        const colgado = r.signal === 'SIGTERM' || r.status === null;
        const passed = r.status === 0 && !colgado && fail === 0;
        const total = out.split('\n').find(l => /Total:|RESUMEN/.test(l)) || '';
        resumen.push({ nombre, pass, fail, colgado, passed, total: total.trim().slice(0, 70) });
        if (!passed) suiteFailed = true;
        console.log(nombre.padEnd(24) +
            ' PASS=' + String(pass).padStart(2) +
            '  FAIL=' + String(fail).padStart(2) +
            (colgado ? '  [TIMEOUT/COLGADO]' : '  [exit=' + r.status + ']'));
        if (!passed && out.trim()) console.log(out.trim());
    }

    apagar();
    console.log('\n=== RESUMEN ===');
    resumen.forEach(x => console.log(
        x.nombre.padEnd(24) + ' PASS=' + String(x.pass).padStart(2) +
        ' FAIL=' + String(x.fail).padStart(2) +
        (x.colgado ? ' COLGADO' : '') + '  ' + x.total));
    process.exitCode = suiteFailed ? 1 : 0;
})();

process.on('exit', apagar);
