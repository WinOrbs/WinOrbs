// ─────────────────────────────────────────────────────────────
// Configuración de Firebase compartida (login, perfil, wallet).
// Es pública por diseño: la seguridad real la dan las Firestore Rules
// (ver firestore.rules en la raíz del proyecto).
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
    apiKey: "AIzaSyCjw8xJek1GRRjHuw7x60DQQUawiBHhhWk",
    authDomain: "winorbs20.firebaseapp.com",
    databaseURL: "https://winorbs20-default-rtdb.firebaseio.com",
    projectId: "winorbs20",
    // storageBucket se deja porque forma parte de la config estándar del
    // proyecto, pero YA NO SE USA: subir a Firebase Storage exige el plan Blaze
    // (de pago). Las imágenes (skins y comprobantes) van a Cloudinary
    // → ver public/js/media-config.js
    storageBucket: "winorbs20.firebasestorage.app",
    messagingSenderId: "462725673786",
    appId: "1:462725673786:web:5a105a0cf3bc64fe555603",
    measurementId: "G-PNKMEL53P9"
};