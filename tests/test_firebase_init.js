// Test: valida el bloque de inicialización de Firebase (server.js) en sandbox
// (patrón test_skins.js): todas las rutas de la clave de servicio + modo degradado.
// Ejecutar desde la raíz del proyecto:  node tests/test_firebase_init.js
const fs = require('fs');
const vm = require('vm');
const os = require('os');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ini = server.indexOf('let firebaseAdmin = null;');
const fin = server.indexOf('// Límites de seguridad');
if (ini < 0 || fin < 0) throw new Error('bloque no encontrado');
const bloque = server.slice(ini, fin);

const lineas = [];
function log(s) { lineas.push(s); }

// stub de firebase-admin que registra llamadas
function hacerStub() {
    const llamadas = { initializeApp: [], cert: [], appDefault: 0 };
    return {
        llamadas,
        initializeApp: (cfg) => { llamadas.initializeApp.push(cfg); },
        credential: {
            cert: (sa) => { llamadas.cert.push(sa); return { tipo: 'cert' }; },
            applicationDefault: () => { llamadas.appDefault++; return { tipo: 'appDefault' }; }
        },
        firestore: () => 'DB_STUB'
    };
}

function correr(env, dirname, extraFs) {
    const stub = hacerStub();
    const sandbox = {
        require: (m) => {
            if (m === 'firebase-admin') return stub;
            if (m === 'fs') return { ...fs, ...extraFs };
            return require(m);
        },
        process: { env },
        console: { log: (s) => log('LOG ' + s), warn: (s) => log('WARN ' + s) },
        __dirname: dirname,
        Buffer
    };
    vm.createContext(sandbox);
    // Las declaraciones let del script no se exponen en el contexto: las copiamos a globalThis dentro del mismo scope
    vm.runInContext(bloque + ';globalThis.__ECO=FIREBASE_ECONOMY;globalThis.__DB=FIREBASE_DB;', sandbox, { filename: 'server.js#init' });
    return { stub, eco: sandbox.__ECO, db: sandbox.__DB };
}

const saValido = {
    type: 'service_account', project_id: 'proyecto-test',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    client_email: 'algo@proyecto-test.iam.gserviceaccount.com'
};

const fallos = [];
function check(nombre, cond) { log((cond ? 'OK   ' : 'FAIL ') + nombre); if (!cond) fallos.push(nombre); }

(async () => {
    // 1) Archivo local en __dirname (caso local clásico)
    const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wotest-'));
    fs.writeFileSync(path.join(dirTmp, 'serviceAccountKey.json'), JSON.stringify(saValido));
    delete process.env.__X;
    let r = correr({}, dirTmp);
    check('archivo local en __dirname → economía ON', r.eco === true && r.db === 'DB_STUB');
    check('archivo local → initializeApp con cert', r.stub.llamadas.cert.length === 1 && r.stub.llamadas.cert[0].project_id === 'proyecto-test');

    // 2) Env apuntando a una ruta (Render style: FIREBASE_SERVICE_ACCOUNT=/etc/secrets/...)
    r = correr({ FIREBASE_SERVICE_ACCOUNT: path.join(dirTmp, 'serviceAccountKey.json') }, path.join(os.tmpdir(), 'noexiste'));
    check('FIREBASE_SERVICE_ACCOUNT=ruta → economía ON', r.eco === true);

    // 3) Env con JSON inline
    r = correr({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(saValido) }, path.join(os.tmpdir(), 'noexiste'));
    check('FIREBASE_SERVICE_ACCOUNT=JSON inline → economía ON', r.eco === true);

    // 3b) Env con JSON inline envuelto en comillas (como a veces lo guarda el panel)
    r = correr({ FIREBASE_SERVICE_ACCOUNT: '"' + JSON.stringify(saValido) + '"' }, path.join(os.tmpdir(), 'noexiste'));
    check('FIREBASE_SERVICE_ACCOUNT=JSON con comillas → economía ON', r.eco === true);

    // 4) Env Base64
    r = correr({ FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(saValido)).toString('base64') }, path.join(os.tmpdir(), 'noexiste'));
    check('FIREBASE_SERVICE_ACCOUNT_B64 → economía ON', r.eco === true);

    // 5) GOOGLE_APPLICATION_CREDENTIALS tiene prioridad
    r = correr({ GOOGLE_APPLICATION_CREDENTIALS: '/x.json' }, dirTmp);
    check('GOOGLE_APPLICATION_CREDENTIALS → appDefault + ON', r.eco === true && r.stub.llamadas.appDefault === 1 && r.stub.llamadas.cert.length === 0);

    // 6) Sin nada → degradado, sin crash
    r = correr({}, path.join(os.tmpdir(), 'noexiste'));
    check('sin clave → modo DEGRADADO (FIREBASE_ECONOMY=false)', r.eco === false && r.db === null);

    // 7) /etc/secrets simulado (inyectando un fs con existsSync/readdirSync falsos)
    r = correr({}, dirTmp, {
        existsSync: (p) => p === '/etc/secrets',
        readdirSync: (p) => { if (p === '/etc/secrets') return ['otra.json', 'serviceaccountkey.json']; throw new Error('no'); },
        readFileSync: (p) => { if (p === '/etc/secrets/serviceaccountkey.json') return JSON.stringify(saValido); throw new Error('no'); }
    });
    check('fallback /etc/secrets (nombre en minúsculas) → economía ON', r.eco === true);
    check('fallback /etc/secrets → cert con project_id', r.stub.llamadas.cert[0] && r.stub.llamadas.cert[0].project_id === 'proyecto-test');

    // 8) JSON corrupto en /etc/secrets exacto → no explota
    r = correr({}, dirTmp, {
        existsSync: (p) => p === '/etc/secrets/serviceAccountKey.json' || p === '/etc/secrets',
        readFileSync: (p) => { if (p === '/etc/secrets/serviceAccountKey.json') return '{ roto'; throw new Error('no'); }
    });
    check('JSON corrupto en /etc/secrets → degradado sin crash', r.eco === false);

    fs.rmSync(dirTmp, { recursive: true, force: true });
    const salida = lineas.join('\n') + '\n\nFALLOS=' + fallos.length + (fallos.length ? ' → ' + fallos.join(' | ') : '');
    console.log(salida);
    if (fallos.length) process.exit(1);
})().catch(e => {
    console.error('ERROR TEST:', e);
    process.exit(1);
});