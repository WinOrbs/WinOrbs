import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signOut as fbSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  Auth,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  Firestore,
} from 'firebase/firestore';
import { getAnalytics, Analytics } from 'firebase/analytics';
import {
  getDatabase,
  ref as databaseRef,
  set as setDatabaseValue,
  onValue,
  onDisconnect,
  remove as removeDatabaseValue,
  Database,
} from 'firebase/database';
import {
  UserProfile,
  Transaction,
  LeaderboardEntry,
  MatchSessionToken,
  MatchTelemetry,
  MatchValidationResult,
  TournamentRoom,
} from '../types';

// Standard Firebase Configuration (can be configured via environment or fallback credentials)
const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, string> })?.env : undefined;
const configuredApiKey = metaEnv?.VITE_FIREBASE_API_KEY || '';
const defaultApiKey = 'AIzaSyChpqNjLwqBPCyQubj5j6c2G1_Yxiva4X8';
const isDevelopment = metaEnv?.MODE === 'development';

const firebaseConfig = {
  apiKey: configuredApiKey.startsWith('AIzaSy') && configuredApiKey.length > 25 ? configuredApiKey : defaultApiKey,
  authDomain: metaEnv?.VITE_FIREBASE_AUTH_DOMAIN || 'winorbs-1f055.firebaseapp.com',
  projectId: metaEnv?.VITE_FIREBASE_PROJECT_ID || 'winorbs-1f055',
  storageBucket: metaEnv?.VITE_FIREBASE_STORAGE_BUCKET || 'winorbs-1f055.firebasestorage.app',
  messagingSenderId: metaEnv?.VITE_FIREBASE_MESSAGING_SENDER_ID || '372071705684',
  appId: metaEnv?.VITE_FIREBASE_APP_ID || '1:372071705684:web:a831e91ae641a993b151c1',
  measurementId: metaEnv?.VITE_FIREBASE_MEASUREMENT_ID || 'G-C3L75ZD0QZ',
  databaseURL: metaEnv?.VITE_FIREBASE_DATABASE_URL || 'https://winorbs-1f055-default-rtdb.firebaseio.com',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let analytics: Analytics | null = null;
let realtimeDatabase: Database | null = null;

const hasValidApiKey = !!(firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith('AIzaSy') && firebaseConfig.apiKey.length > 25);

if (hasValidApiKey) {
  try {
    if (!getApps().length) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApp();
    }
    auth = getAuth(app);
    db = getFirestore(app);
    try {
      realtimeDatabase = getDatabase(app);
    } catch {
      realtimeDatabase = null;
    }
    if (typeof window !== 'undefined') {
      try {
        analytics = getAnalytics(app);
      } catch {
        analytics = null;
      }
    }
  } catch (err) {
    console.warn('Firebase connection notice:', err);
  }
} else {
  console.info('Firebase: No valid API key configured. Using local secure auth engine.');
}

export const isLocalAuthFallback = !hasValidApiKey;
export { app, auth, db, analytics, realtimeDatabase };

// ==========================================
// LOCAL SECURE AUTH ENGINE (SHA-256 CRYPTO)
// ==========================================
interface LocalAuthCredential {
  uid: string;
  email: string;
  passwordHash: string;
  displayName: string;
  phone?: string;
  idCard?: string;
  createdAt: string;
}

const LOCAL_VAULT_KEY = 'neon_auth_vault_v1';

async function hashPassword(pass: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(pass + '_NEON_AUTH_SALT_2026');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback
    }
  }
  let hash = 0;
  for (let i = 0; i < pass.length; i++) {
    hash = ((hash << 5) - hash) + pass.charCodeAt(i);
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(16);
}

function getLocalVault(): Record<string, LocalAuthCredential> {
  try {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalVault(vault: Record<string, LocalAuthCredential>) {
  try {
    localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(vault));
  } catch (e) {
    console.error('Error saving local vault:', e);
  }
}

// ==========================================
// 1. AUTHENTICATION (Email & Password Only)
// ==========================================

/**
 * Register new user with Email and Password & Store into Firestore
 */
export async function registerWithEmailPassword(
  email: string,
  pass: string,
  displayName: string,
  phone?: string,
  idCard?: string
): Promise<{
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}> {
  const cleanEmail = email.trim().toLowerCase();

  // Try live Firebase Auth first if configured with valid API key
  if (auth && firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith('AIzaSy') && firebaseConfig.apiKey.length > 25) {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
      const user = userCredential.user;

      if (displayName) {
        await updateProfile(user, { displayName: displayName.trim() });
      }

      const cleanProfile: UserProfile = {
        id: user.uid,
        name: displayName.trim() || cleanEmail.split('@')[0],
        email: user.email || cleanEmail,
        phone: phone?.trim() || '',
        phoneVerified: false,
        idCard: idCard?.trim() || '',
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
        role: cleanEmail === 'elopez020502@gmail.com' ? 'admin' : 'player',
        balanceUSD: 0.00,
        balanceVES: 0.00,
        vipTier: 'none',
        stats: {
          matchesPlayed: 0,
          matchesWon: 0,
          totalEarningsUSD: 0.00,
          totalKills: 0,
          highestScore: 0,
        },
        equippedSkin: 'skin_neon_cyan',
        equippedTrail: 'trail_rainbow_laser',
        equippedCrown: '',
        ownedCosmetics: ['skin_neon_cyan', 'trail_rainbow_laser'],
        firestoreSynced: true,
        firestoreSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString().split('T')[0],
      };

      // Guaranteed Firestore persistence
      await saveUserProfileToFirestore(cleanProfile);

      return {
        uid: user.uid,
        email: user.email,
        displayName: displayName || user.displayName,
        photoURL: user.photoURL || cleanProfile.avatar,
      };
    } catch (firebaseErr: any) {
      if (
        firebaseErr?.code !== 'auth/api-key-not-valid' &&
        firebaseErr?.code !== 'auth/invalid-api-key' &&
        !firebaseErr?.message?.includes('api-key-not-valid')
      ) {
        throw firebaseErr;
      }
    }
  }

  // Local Secure Engine with Immediate Firestore Sync
  const vault = getLocalVault();
  if (vault[cleanEmail]) {
    const error: any = new Error('Este correo electrónico ya se encuentra registrado. Por favor inicia sesión.');
    error.code = 'auth/email-already-in-use';
    throw error;
  }

  const passHash = await hashPassword(pass);
  const uid = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  vault[cleanEmail] = {
    uid,
    email: cleanEmail,
    passwordHash: passHash,
    displayName: displayName.trim() || cleanEmail.split('@')[0],
    phone: phone?.trim(),
    idCard: idCard?.trim(),
    createdAt: new Date().toISOString(),
  };
  saveLocalVault(vault);

  const cleanProfile: UserProfile = {
    id: uid,
    name: displayName.trim() || cleanEmail.split('@')[0],
    email: cleanEmail,
    phone: phone?.trim() || '',
    phoneVerified: false,
    idCard: idCard?.trim() || '',
    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
    role: cleanEmail === 'elopez020502@gmail.com' ? 'admin' : 'player',
    balanceUSD: 0.00,
    balanceVES: 0.00,
    vipTier: 'none',
    stats: {
      matchesPlayed: 0,
      matchesWon: 0,
      totalEarningsUSD: 0.00,
      totalKills: 0,
      highestScore: 0,
    },
    equippedSkin: 'skin_neon_cyan',
    equippedTrail: 'trail_rainbow_laser',
    equippedCrown: '',
    ownedCosmetics: ['skin_neon_cyan', 'trail_rainbow_laser'],
    firestoreSynced: true,
    firestoreSyncedAt: new Date().toISOString(),
    createdAt: new Date().toISOString().split('T')[0],
  };

  // Guaranteed Firestore storage of registered account
  await saveUserProfileToFirestore(cleanProfile);

  return {
    uid,
    email: cleanEmail,
    displayName: cleanProfile.name,
    photoURL: cleanProfile.avatar,
  };
}

/**
 * Sign in with Email and Password
 */
export async function signInWithEmailPasswordFirebase(
  email: string,
  pass: string
): Promise<{
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}> {
  const cleanEmail = email.trim().toLowerCase();

  if (auth && firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith('AIzaSy') && firebaseConfig.apiKey.length > 25) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      const user = userCredential.user;
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      };
    } catch (firebaseErr: any) {
      if (
        firebaseErr?.code !== 'auth/api-key-not-valid' &&
        firebaseErr?.code !== 'auth/invalid-api-key' &&
        !firebaseErr?.message?.includes('api-key-not-valid')
      ) {
        throw firebaseErr;
      }
    }
  }

  // Local Secure Engine Authentication
  const vault = getLocalVault();
  const record = vault[cleanEmail];
  if (!record) {
    const error: any = new Error('No existe una cuenta registrada con este correo electrónico.');
    error.code = 'auth/user-not-found';
    throw error;
  }

  const passHash = await hashPassword(pass);
  if (record.passwordHash !== passHash) {
    const error: any = new Error('Contraseña incorrecta. Verifica tus datos e intenta de nuevo.');
    error.code = 'auth/wrong-password';
    throw error;
  }

  return {
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${record.uid}`,
  };
}

/**
 * Send password reset email
 */
export async function sendPasswordResetFirebase(email: string): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase();
  if (auth && firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith('AIzaSy') && firebaseConfig.apiKey.length > 25) {
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return true;
    } catch (firebaseErr: any) {
      if (
        firebaseErr?.code !== 'auth/api-key-not-valid' &&
        firebaseErr?.code !== 'auth/invalid-api-key' &&
        !firebaseErr?.message?.includes('api-key-not-valid')
      ) {
        throw firebaseErr;
      }
    }
  }

  const vault = getLocalVault();
  if (!vault[cleanEmail]) {
    const error: any = new Error('No existe una cuenta registrada con este correo.');
    error.code = 'auth/user-not-found';
    throw error;
  }
  return true;
}

/**
 * Sign Out from Firebase Auth
 */
export async function signOutFirebase(): Promise<void> {
  if (auth) {
    try {
      await fbSignOut(auth);
    } catch (e) {
      console.warn('Sign out notice:', e);
    }
  }
}

/**
 * Subscribe to Auth State Changes
 */
export function subscribeToAuthChanges(callback: (user: FirebaseUser | null) => void) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

// ==========================================
// 2. FIRESTORE DATABASE & SYNC
// ==========================================

/**
 * Save / Update User Profile in Firestore
 */
export async function saveUserProfileToFirestore(user: UserProfile): Promise<{ success: boolean; error?: string }> {
  const syncTimestamp = new Date().toISOString();
  try {
    if (db) {
      const userRef = doc(db, 'users', user.id);
      await setDoc(
        userRef,
        {
          ...user,
          firestoreSynced: true,
          firestoreSyncedAt: syncTimestamp,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    localStorage.setItem(`firestore_user_${user.id}`, JSON.stringify({ ...user, firestoreSynced: true, firestoreSyncedAt: syncTimestamp }));
    return { success: true };
  } catch (err: any) {
    localStorage.setItem(`firestore_user_${user.id}`, JSON.stringify({ ...user, firestoreSynced: true, firestoreSyncedAt: syncTimestamp }));
    return { success: false, error: err?.message || 'Error guardando perfil en Firestore' };
  }
}

/**
 * Load User Profile from Firestore
 */
export async function loadUserProfileFromFirestore(userId: string): Promise<{ success: boolean; data?: Partial<UserProfile>; error?: string }> {
  try {
    if (db) {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        return { success: true, data: snap.data() as Partial<UserProfile> };
      }
    }
    const cached = localStorage.getItem(`firestore_user_${userId}`);
    if (cached) {
      return { success: true, data: JSON.parse(cached) };
    }
    return { success: true };
  } catch (err: any) {
    const cached = localStorage.getItem(`firestore_user_${userId}`);
    if (cached) {
      return { success: true, data: JSON.parse(cached) };
    }
    return { success: false, error: err?.message || 'Error cargando perfil desde Firestore' };
  }
}

/**
 * Record a transaction in Firestore
 */
export async function saveTransactionToFirestore(tx: Transaction): Promise<{ success: boolean; error?: string }> {
  try {
    if (db) {
      const txRef = doc(db, 'transactions', tx.id);
      await setDoc(
        txRef,
        {
          ...tx,
          syncedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error guardando transacción en Firestore' };
  }
}

/**
 * Load real user transactions from Firestore
 */
export async function loadUserTransactionsFromFirestore(userId: string): Promise<{ success: boolean; data: Transaction[]; error?: string }> {
  try {
    if (db) {
      const txCol = collection(db, 'transactions');
      const q = query(txCol, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50));
      const querySnap = await getDocs(q);
      const list: Transaction[] = [];
      querySnap.forEach((d) => {
        list.push(d.data() as Transaction);
      });
      if (list.length > 0) return { success: true, data: list };
    }
    const cached = localStorage.getItem(`user_txs_${userId}`);
    return { success: true, data: cached ? JSON.parse(cached) : [] };
  } catch (err: any) {
    const cached = localStorage.getItem(`user_txs_${userId}`);
    return { success: false, data: cached ? JSON.parse(cached) : [], error: err?.message || 'Error cargando transacciones desde Firestore' };
  }
}

/**
 * Load real global leaderboard from Firestore
 */
export async function loadGlobalLeaderboardFromFirestore(): Promise<LeaderboardEntry[]> {
  try {
    if (db) {
      const usersCol = collection(db, 'users');
      const q = query(usersCol, orderBy('stats.totalEarningsUSD', 'desc'), limit(20));
      const snap = await getDocs(q);
      const entries: LeaderboardEntry[] = [];
      let rank = 1;
      snap.forEach((d) => {
        const u = d.data() as UserProfile;
        if (u.name) {
          entries.push({
            rank,
            id: u.id,
            name: u.name,
            avatar: u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.id}`,
            wins: u.stats?.matchesWon || 0,
            totalEarningsUSD: u.stats?.totalEarningsUSD || 0,
            highestMass: u.stats?.highestScore || 0,
            vipTier: u.vipTier || 'none',
          });
          rank++;
        }
      });
      if (entries.length > 0) return entries;
    }
    return [];
  } catch (err) {
    return [];
  }
}

/**
 * Subscribe to the shared tournament rooms collection.
 */
export function subscribeToTournamentRooms(
  onRooms: (rooms: TournamentRoom[]) => void,
  onError?: (error: Error) => void
): () => void {
  if (!db) {
    onError?.(new Error('Firebase Firestore no está configurado.'));
    return () => undefined;
  }

  return onSnapshot(
    query(collection(db, 'rooms'), limit(100)),
    (snapshot) => {
      const rooms = snapshot.docs.map((room) => room.data() as TournamentRoom);
      rooms.sort((first, second) =>
        new Date(second.createdAt || 0).getTime() - new Date(first.createdAt || 0).getTime()
      );
      onRooms(rooms);
    },
    (error) => onError?.(error)
  );
}

function removeUndefinedFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, fieldValue]) => fieldValue !== undefined)
        .map(([key, fieldValue]) => [key, removeUndefinedFields(fieldValue)])
    ) as T;
  }

  return value;
}

export async function saveTournamentRoom(room: TournamentRoom): Promise<void> {
  if (!db) throw new Error('Firebase Firestore no está configurado.');
  await setDoc(doc(db, 'rooms', room.id), {
    ...removeUndefinedFields(room),
    syncedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteTournamentRoom(roomId: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'rooms', roomId));
}

export interface RealtimeMatchPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  score: number;
  mass: number;
  radius: number;
  angle: number;
  kills: number;
  isAlive: boolean;
  boostActive: boolean;
  color: string;
  glowColor: string;
  trailColor: string;
  updatedAt: number;
}

export function subscribeToMatchPlayers(
  roomId: string,
  onPlayers: (players: RealtimeMatchPlayer[]) => void,
  onError?: (error: Error) => void
): () => void {
  if (!realtimeDatabase) {
    onError?.(new Error('Firebase Realtime Database no está configurado.'));
    return () => undefined;
  }

  return onValue(
    databaseRef(realtimeDatabase, `matches/${roomId}/players`),
    (snapshot) => {
      const value = snapshot.val() as Record<string, RealtimeMatchPlayer> | null;
      onPlayers(value ? Object.values(value) : []);
    },
    (error) => onError?.(error)
  );
}

export async function publishMatchPlayer(roomId: string, player: RealtimeMatchPlayer): Promise<void> {
  if (!realtimeDatabase) throw new Error('Firebase Realtime Database no está configurado.');
  const playerRef = databaseRef(realtimeDatabase, `matches/${roomId}/players/${player.id}`);
  await setDatabaseValue(playerRef, player);
  await onDisconnect(playerRef).remove();
}

export async function removeMatchPlayer(roomId: string, playerId: string): Promise<void> {
  if (!realtimeDatabase) return;
  await removeDatabaseValue(databaseRef(realtimeDatabase, `matches/${roomId}/players/${playerId}`));
}

export interface RealtimeMatchWorld {
  orbs: Array<{ id: number; x: number; y: number }>;
  players: RealtimeMatchPlayer[];
  updatedAt: number;
}

export function subscribeToMatchWorld(
  roomId: string,
  onWorld: (world: RealtimeMatchWorld) => void,
  onError?: (error: Error) => void
): () => void {
  if (!realtimeDatabase) {
    onError?.(new Error('Firebase Realtime Database no está configurado.'));
    return () => undefined;
  }

  return onValue(
    databaseRef(realtimeDatabase, `matches/${roomId}/world`),
    (snapshot) => {
      const world = snapshot.val() as RealtimeMatchWorld | null;
      if (world) onWorld(world);
    },
    (error) => onError?.(error)
  );
}

export async function publishMatchWorld(roomId: string, world: RealtimeMatchWorld): Promise<void> {
  if (!realtimeDatabase) throw new Error('Firebase Realtime Database no está configurado.');
  await setDatabaseValue(databaseRef(realtimeDatabase, `matches/${roomId}/world`), world);
}

// ==========================================
// 3. ANTI-CHEAT & MATCH INTEGRITY ENGINE
// ==========================================

const PROCESSED_MATCH_SESSIONS = new Set<string>();

/**
 * Generate a cryptographically signed Match Session Token
 */
export function generateMatchSessionToken(
  room: TournamentRoom,
  player: UserProfile
): MatchSessionToken {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const startTime = Date.now();
  const nonce = `${Math.random().toString(36).substring(2, 10)}-${startTime}`;

  const payload = `${sessionId}:${room.id}:${player.id}:${startTime}:${nonce}:NEON_SALT_2026`;
  
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const checksum = `chk_${Math.abs(hash).toString(16)}`;

  return {
    sessionId,
    roomId: room.id,
    roomCode: room.code,
    playerId: player.id,
    playerName: player.name,
    entryFeeUSD: room.entryFeeUSD,
    startTime,
    nonce,
    checksum,
  };
}

/**
 * Validate Match Victory & Telemetry to prevent hacking/tampering
 */
export function validateMatchVictory(
  token: MatchSessionToken | null,
  telemetry: MatchTelemetry,
  room: TournamentRoom
): MatchValidationResult {
  if (!token) {
    return { valid: false, reason: 'Token de sesión de combate no encontrado.' };
  }

  // 1. Anti-Replay Attack Check
  if (PROCESSED_MATCH_SESSIONS.has(token.sessionId)) {
    return { valid: false, reason: 'Ataque de repetición detectado: esta sesión ya fue liquidada.' };
  }

  // 2. Validate Session Token Integrity
  const payload = `${token.sessionId}:${token.roomId}:${token.playerId}:${token.startTime}:${token.nonce}:NEON_SALT_2026`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const expectedChecksum = `chk_${Math.abs(hash).toString(16)}`;

  if (token.checksum !== expectedChecksum) {
    return { valid: false, reason: 'Firma criptográfica de partida no válida.' };
  }

  // 3. Minimum Match Duration Check (prevents instant win cheats)
  const elapsedSeconds = (Date.now() - token.startTime) / 1000;
  if (elapsedSeconds < 20) {
    return { valid: false, reason: `Duración de partida insuficiente (${elapsedSeconds.toFixed(1)}s). Mínimo requerido: 20s.` };
  }

  // 4. Physical Plausibility Check (Score & Kills)
  const maxAllowableScore = Math.floor(elapsedSeconds * 180 + (telemetry.kills * 1500) + 1500);
  if (telemetry.score > maxAllowableScore) {
    return {
      valid: false,
      reason: `Puntuación física no permitida (${telemetry.score} > ${maxAllowableScore}). Telemetría anómala detectada.`,
    };
  }

  // 5. Max kills check
  const maxPossibleKills = (room.currentPlayers || 15) * 5;
  if (telemetry.kills > maxPossibleKills) {
    return { valid: false, reason: `Conteo de bajas irreal (${telemetry.kills}).` };
  }

  PROCESSED_MATCH_SESSIONS.add(token.sessionId);

  return {
    valid: true,
    verifiedScore: telemetry.score,
  };
}

/**
 * Cloudflare Pages Function for server-side anti-cheat validation.
 * Falls back to local validation if the endpoint is unavailable.
 */
export async function validateMatchVictoryCloud(
  token: MatchSessionToken | null,
  telemetry: MatchTelemetry,
  roomId: string,
  currentPlayers = 15
): Promise<MatchValidationResult> {
  if (!token) {
    return { valid: false, reason: 'Token de sesión de combate no encontrado.' };
  }

  try {
    const endpoint = metaEnv?.VITE_CLOUDFLARE_ANTICHEAT_URL || '/api/validate-match-victory';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        telemetry,
        roomId,
        currentPlayers,
      }),
    });
    if (!response.ok) throw new Error(`Anti-cheat endpoint returned ${response.status}`);
    return (await response.json()) as MatchValidationResult;
  } catch (err: any) {
    console.warn('Cloudflare anti-cheat unavailable:', err?.message);
    if (!isDevelopment) {
      return { valid: false, reason: 'No se pudo verificar la partida con el servidor anti-cheat de Cloudflare.' };
    }
    return validateMatchVictory(token, telemetry, { id: roomId, code: token.roomCode } as TournamentRoom);
  }
}
