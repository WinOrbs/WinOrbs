const fs = require('fs');
const path = require('path');

// Regla canónica: firestore.rules es la fuente versionada de verdad.
// Este utilitario conserva compatibilidad con el comando histórico y evita
// regenerar reglas distintas desde una plantilla obsoleta.
const reglasPath = path.join(__dirname, '..', 'firestore.rules');
if (!fs.existsSync(reglasPath)) {
  throw new Error('firestore.rules no existe');
}
const reglas = fs.readFileSync(reglasPath, 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(reglasPath, reglas, 'utf8');
console.log('RULES_OK');
