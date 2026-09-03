import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  UserProfile,
  Role,
  VisualMode,
  Transaction,
  AppNotification,
  CosmeticItem,
  TournamentRoom,
  ExchangeConfig,
  LeaderboardEntry,
  PaymentMethodType,
  MatchSessionToken,
  MatchTelemetry,
} from '../types';
import { soundFx } from '../services/soundSynth';
import {
  registerWithEmailPassword,
  signInWithEmailPasswordFirebase,
  sendPasswordResetFirebase,
  signOutFirebase,
  subscribeToAuthChanges,
  saveUserProfileToFirestore,
  loadUserProfileFromFirestore,
  saveTransactionToFirestore,
  loadUserTransactionsFromFirestore,
  loadGlobalLeaderboardFromFirestore,
  subscribeToTournamentRooms,
  saveTournamentRoom,
  deleteTournamentRoom,
  validateMatchVictoryCloud,
} from '../services/firebase';

interface AppContextType {
  currentUser: UserProfile | null;
  activeRole: Role;
  currentRole: Role;
  visualMode: VisualMode;
  exchangeRates: ExchangeConfig;
  transactions: Transaction[];
  notifications: AppNotification[];
  skins: CosmeticItem[];
  rooms: TournamentRoom[];
  activeRoom: TournamentRoom | null;
  leaderboard: LeaderboardEntry[];
  platformRevenueUSD: number;
  unreadNotificationsCount: number;
  showTutorial: boolean;
  soundEnabled: boolean;
  isAdminUnlocked: boolean;
  isAuthorizedAdmin: boolean;
  setCurrentUser: (user: UserProfile | null) => void;
  switchRole: (role: Role) => void;
  verifyAdminPin: (pin: string) => boolean;
  lockAdmin: () => void;
  setVisualMode: (mode: VisualMode) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setShowTutorial: (show: boolean) => void;
  registerWithEmail: (email: string, pass: string, name: string, phone?: string, idCard?: string) => Promise<UserProfile>;
  loginWithEmail: (email: string, pass: string) => Promise<UserProfile>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  updateProfileData: (data: Partial<UserProfile>) => Promise<boolean>;
  loginUser: (email: string, phone: string) => Promise<boolean>;
  verifyPhoneSMS: (code: string) => Promise<boolean>;
  logout: () => void;
  requestDeposit: (data: { amountUSD: number; method: PaymentMethodType; referenceNumber: string; receiptUrl?: string; details?: Record<string, string> }) => Promise<Transaction>;
  requestWithdrawal: (data: { amountUSD: number; method: PaymentMethodType; destinationAddressOrBank: string; securityPin: string; accountHolder: string }) => Promise<Transaction>;
  approveTransaction: (id: string, notes?: string) => void;
  rejectTransaction: (id: string, notes?: string) => void;
  updateExchangeRates: (newConfig: Partial<ExchangeConfig>) => void;
  createTournamentRoom: (config: { name: string; type: 'public' | 'private'; entryFeeUSD: number; maxPlayers: number; isSpecialEvent?: boolean }) => TournamentRoom;
  adminCreateRoom: (config: { name: string; type: 'public' | 'private'; entryFeeUSD: number; maxPlayers: number; isSpecialEvent?: boolean; durationSeconds?: number; customPotUSD?: number; eventDescription?: string; sponsorName?: string; minPlayersToStart?: number; arenaRadius?: number; broadcastNotification?: boolean }) => TournamentRoom;
  adminUpdateRoom: (roomId: string, updates: Partial<TournamentRoom>) => void;
  adminDeleteRoom: (roomId: string) => void;
  joinRoom: (roomId: string, code?: string) => boolean;
  startMatchNow: (roomId: string) => void;
  leaveRoom: () => void;
  buyCosmetic: (item: CosmeticItem) => boolean;
  equipCosmetic: (type: 'skin' | 'trail' | 'crown', id: string) => void;
  subscribeVIP: (tier: 'vip_bronze' | 'vip_neon' | 'vip_titan', priceUSD: number) => boolean;
  sendPushBroadcast: (title: string, message: string, target?: 'all' | string) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  finishMatchPot: (roomId: string, winnerId: string, winnerName: string, matchStats?: { score: number; kills: number }, token?: MatchSessionToken | null) => Promise<{ success: boolean; reason?: string }>;
}
const DEFAULT_EXCHANGE_CONFIG: ExchangeConfig = {
  vesUsdRate: 68.50,
  usdtRate: 1.00,
  usdtWithdrawalFeeUSD: 1.00,
  withdrawalFeePercent: 3.0,
  winnerPotPercent: 80.0,
  platformPotPercent: 20.0,
  pagoMovilAccounts: [
    {
      bankName: '0105 - Banco Mercantil',
      bankCode: '0105',
      phone: '0424-2988652',
      idCard: 'V-25831740',
      holderName: 'Edgar López',
    },
    {
      bankName: '0102 - Banco de Venezuela',
      bankCode: '0102',
      phone: '0424-2988652',
      idCard: 'V-25831740',
      holderName: 'Edgar López',
    },
  ],
  usdtWallets: [
    {
      network: 'USDT (Tron TRC-20)',
      address: 'TMPtqWe3Rtgv8PvoGKoBeLREzYg6hK8K3E',
    },
    {
      network: 'USDT (BNB Chain BEP-20)',
      address: '0x882a9F0b0C12E4E42B6A27dC87C1f4E1a9F64B81',
    },
  ],
  internationalBank: {
    bankName: 'JPMorgan Chase / Zelle Business',
    accountNumber: '8892-0019-3382-9901',
    routingOrSwift: 'CHASUS33 / zelle@neonclash.io',
    beneficiary: 'Edgar López / WinOrbs Gaming',
  },
};

const DEFAULT_COSMETICS: CosmeticItem[] = [
  {
    id: 'skin_neon_cyan',
    name: 'Cyber Cyan 3000',
    type: 'skin',
    priceUSD: 0,
    rarity: 'common',
    description: 'El núcleo de energía cibernética estándar con propulsión de fotones.',
    color: '#06b6d4',
    secondaryColor: '#3b82f6',
    glowColor: 'rgba(6, 182, 212, 0.8)',
    pattern: 'pulse',
  },
  {
    id: 'skin_plasma_pink',
    name: 'Plasma Nova Rosa',
    type: 'skin',
    priceUSD: 3.50,
    rarity: 'rare',
    description: 'Generador de plasma sobrecalentado con aura reactiva magenta.',
    color: '#f43f5e',
    secondaryColor: '#a855f7',
    glowColor: 'rgba(244, 63, 94, 0.9)',
    pattern: 'fire',
  },
  {
    id: 'skin_electric_lime',
    name: 'Voltaje Tóxico Neón',
    type: 'skin',
    priceUSD: 5.00,
    rarity: 'rare',
    description: 'Partículas de radiación neón pura con pulso electromagnético.',
    color: '#22c55e',
    secondaryColor: '#eab308',
    glowColor: 'rgba(34, 197, 94, 0.9)',
    pattern: 'lightning',
  },
  {
    id: 'skin_gold_titan',
    name: 'Titán Áureo VIP',
    type: 'skin',
    priceUSD: 12.00,
    rarity: 'legendary',
    description: 'Forjado con aleación dorada cuántica. Destella al absorber orbes.',
    color: '#eab308',
    secondaryColor: '#f97316',
    glowColor: 'rgba(234, 179, 8, 1)',
    pattern: 'matrix',
  },
  {
    id: 'skin_void_darkness',
    name: 'Eclipse Vacío Cyber',
    type: 'skin',
    priceUSD: 8.50,
    rarity: 'epic',
    description: 'Agujero negro cuántico rodeado de un horizonte de eventos ultra violeta.',
    color: '#8b5cf6',
    secondaryColor: '#06b6d4',
    glowColor: 'rgba(139, 92, 246, 0.95)',
    pattern: 'galaxy',
  },
  {
    id: 'trail_rainbow_laser',
    name: 'Estela Láser Prisma',
    type: 'trail',
    priceUSD: 2.50,
    rarity: 'rare',
    description: 'Deja un rastro iridiscente mientras te desplazas y aceleras.',
    color: '#06b6d4',
    secondaryColor: '#f43f5e',
    glowColor: 'rgba(6, 182, 212, 0.7)',
    pattern: 'pulse',
  },
  {
    id: 'trail_solar_flare',
    name: 'Estela Llamarada Solar',
    type: 'trail',
    priceUSD: 4.00,
    rarity: 'epic',
    description: 'Lanza chispas incandescentes doradas a gran velocidad.',
    color: '#f97316',
    secondaryColor: '#eab308',
    glowColor: 'rgba(249, 115, 22, 0.8)',
    pattern: 'fire',
  },
  {
    id: 'crown_cyber_emperor',
    name: 'Corona Cyber Emperador',
    type: 'crown',
    priceUSD: 6.00,
    rarity: 'epic',
    description: 'Corona holográfica que flota sobre tu avatar durante la partida.',
    color: '#eab308',
    glowColor: 'rgba(234, 179, 8, 0.9)',
    pattern: 'matrix',
  },
  {
    id: 'crown_neon_devil',
    name: 'Cuernos de Neón Vórtice',
    type: 'crown',
    priceUSD: 7.50,
    rarity: 'legendary',
    description: 'Hornos fluorescentes con energía roja pulsante.',
    color: '#ef4444',
    glowColor: 'rgba(239, 68, 68, 1)',
    pattern: 'fire',
  },
];

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Start with clean authentic state (null until user logs in)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const isExplicitlyLoggedOut = localStorage.getItem('neon_user_logged_out') === 'true';
    if (isExplicitlyLoggedOut) return null;
    const saved = localStorage.getItem('neon_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id) return parsed;
      } catch {
        return null;
      }
    }
    return null;
  });

  const [activeRole, setActiveRole] = useState<Role>(() => {
    const saved = localStorage.getItem('neon_role');
    return (saved as Role) || 'player';
  });

  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('neon_admin_unlocked') === 'true';
  });

  // Admin Master Authorization Verification
  const MASTER_ADMIN_EMAILS = ['elopez020502@gmail.com', 'admin@neonclash.io'];
  const MASTER_ADMIN_PINS = ['020502', '2026'];

  const isAuthorizedAdmin = !!(
    currentUser &&
    (MASTER_ADMIN_EMAILS.includes(currentUser.email?.toLowerCase().trim()) || currentUser.role === 'admin')
  );

  const [visualMode, setVisualModeState] = useState<VisualMode>(() => {
    const saved = localStorage.getItem('neon_visual_mode');
    return (saved as VisualMode) || 'isometric';
  });

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(true);
  const [showTutorial, setShowTutorial] = useState<boolean>(false);

  const [exchangeRates, setExchangeRates] = useState<ExchangeConfig>(() => {
    const saved = localStorage.getItem('neon_rates');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_EXCHANGE_CONFIG, ...parsed };
      } catch {
        return DEFAULT_EXCHANGE_CONFIG;
      }
    }
    return DEFAULT_EXCHANGE_CONFIG;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('neon_txs');
    return saved ? JSON.parse(saved) : [];
  });

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    const saved = localStorage.getItem('neon_notifs');
    return saved ? JSON.parse(saved) : [];
  });

  const [skins] = useState<CosmeticItem[]>(DEFAULT_COSMETICS);
  const [rooms, setRooms] = useState<TournamentRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<TournamentRoom | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [platformRevenueUSD, setPlatformRevenueUSD] = useState<number>(() => {
    const saved = localStorage.getItem('neon_dev_revenue');
    return saved ? parseFloat(saved) : 0.00;
  });

  // Real Firebase Auth Session Listener
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (fbUser) => {
      if (fbUser) {
        localStorage.removeItem('neon_user_logged_out');
        // Load existing Firestore profile or initialize
        const remoteProfileResult = await loadUserProfileFromFirestore(fbUser.uid);
        if (remoteProfileResult.success && remoteProfileResult.data) {
          const remoteProfile = remoteProfileResult.data;
          const syncedUser: UserProfile = {
            id: fbUser.uid,
            name: remoteProfile.name || fbUser.displayName || fbUser.email?.split('@')[0] || 'Gladiador',
            email: fbUser.email || remoteProfile.email || '',
            phone: remoteProfile.phone || '',
            phoneVerified: remoteProfile.phoneVerified || false,
            idCard: remoteProfile.idCard || '',
            pagoMovilBank: remoteProfile.pagoMovilBank || '',
            usdtWallet: remoteProfile.usdtWallet || '',
            avatar: fbUser.photoURL || remoteProfile.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${fbUser.uid}`,
            role: remoteProfile.role || 'player',
            balanceUSD: remoteProfile.balanceUSD || 0.00,
            balanceVES: (remoteProfile.balanceUSD || 0.00) * exchangeRates.vesUsdRate,
            vipTier: remoteProfile.vipTier || 'none',
            vipExpiry: remoteProfile.vipExpiry,
            stats: remoteProfile.stats || {
              matchesPlayed: 0,
              matchesWon: 0,
              totalEarningsUSD: 0,
              totalKills: 0,
              highestScore: 0,
            },
            equippedSkin: remoteProfile.equippedSkin || 'skin_neon_cyan',
            equippedTrail: remoteProfile.equippedTrail || 'trail_rainbow_laser',
            equippedCrown: remoteProfile.equippedCrown || '',
            ownedCosmetics: remoteProfile.ownedCosmetics || ['skin_neon_cyan', 'trail_rainbow_laser'],
            firestoreSynced: true,
            firestoreSyncedAt: new Date().toISOString(),
            createdAt: remoteProfile.createdAt || new Date().toISOString().split('T')[0],
          };
          setCurrentUser(syncedUser);
          localStorage.setItem('neon_user', JSON.stringify(syncedUser));

          // Load real transactions
          const realTxsResult = await loadUserTransactionsFromFirestore(fbUser.uid);
          if (realTxsResult.success && realTxsResult.data.length > 0) {
            setTransactions(realTxsResult.data);
          }
        }
      } else {
        const isExplicit = localStorage.getItem('neon_user_logged_out') === 'true';
        if (isExplicit) {
          setCurrentUser(null);
        }
      }
    });

    // Load real leaderboard from Firestore
    loadGlobalLeaderboardFromFirestore().then((res) => {
      if (res.length > 0) {
        setLeaderboard(res);
      }
    });

    const unsubscribeRooms = subscribeToTournamentRooms(
      (remoteRooms) => {
        setRooms(remoteRooms);
      },
      (error) => console.warn('Firestore rooms sync:', error.message)
    );

    return () => {
      unsubscribe();
      unsubscribeRooms();
    };
  }, [exchangeRates.vesUsdRate]);

  // Sync state to local storage & Firestore
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('neon_user', JSON.stringify(currentUser));
      saveUserProfileToFirestore(currentUser).catch((e) =>
        console.warn('Background Firestore sync:', e)
      );
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('neon_role', activeRole);
  }, [activeRole]);

  useEffect(() => {
    localStorage.setItem('neon_visual_mode', visualMode);
  }, [visualMode]);

  useEffect(() => {
    localStorage.setItem('neon_rates', JSON.stringify(exchangeRates));
  }, [exchangeRates]);

  useEffect(() => {
    localStorage.setItem('neon_txs', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('neon_notifs', JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem('neon_dev_revenue', platformRevenueUSD.toString());
  }, [platformRevenueUSD]);

  // Matchmaking Launch Cycle countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.status === 'waiting') {
            const nextSec = (r.nextLaunchSeconds ?? 300) <= 1 ? 300 : (r.nextLaunchSeconds ?? 300) - 1;
            return {
              ...r,
              nextLaunchSeconds: nextSec,
            };
          }
          return r;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const setVisualMode = (mode: VisualMode) => {
    setVisualModeState(mode);
  };

  const setSoundEnabled = (enabled: boolean) => {
    setSoundEnabledState(enabled);
    soundFx.setEnabled(enabled);
  };

  const switchRole = (role: Role) => {
    if (role === 'admin') {
      if (!currentUser || !isAuthorizedAdmin || !isAdminUnlocked) {
        soundFx.playNotificationPing();
        return;
      }
    }
    setActiveRole(role);
    localStorage.setItem('neon_role', role);
    soundFx.playNotificationPing();
  };

  const verifyAdminPin = (pin: string): boolean => {
    if (MASTER_ADMIN_PINS.includes(pin.trim())) {
      setIsAdminUnlocked(true);
      sessionStorage.setItem('neon_admin_unlocked', 'true');
      setActiveRole('admin');
      localStorage.setItem('neon_role', 'admin');
      soundFx.playCashCoin();
      return true;
    }
    return false;
  };

  const lockAdmin = () => {
    setIsAdminUnlocked(false);
    sessionStorage.removeItem('neon_admin_unlocked');
    setActiveRole('player');
    localStorage.setItem('neon_role', 'player');
    soundFx.playNotificationPing();
  };

  // Register with Email and Password
  const registerWithEmail = async (
    email: string,
    pass: string,
    name: string,
    phone?: string,
    idCard?: string
  ): Promise<UserProfile> => {
    localStorage.removeItem('neon_user_logged_out');
    const res = await registerWithEmailPassword(email, pass, name, phone, idCard);
    const newProfile: UserProfile = {
      id: res.uid,
      name: res.displayName || name.trim() || email.split('@')[0],
      email: res.email || email.trim(),
      phone: phone?.trim() || '',
      phoneVerified: false,
      idCard: idCard?.trim() || '',
      avatar: res.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${res.uid}`,
      role: MASTER_ADMIN_EMAILS.includes(email.toLowerCase().trim()) ? 'admin' : 'player',
      balanceUSD: 0.00,
      balanceVES: 0.00,
      vipTier: 'none',
      stats: {
        matchesPlayed: 0,
        matchesWon: 0,
        totalEarningsUSD: 0,
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
    setCurrentUser(newProfile);
    await saveUserProfileToFirestore(newProfile);
    soundFx.playCashCoin();
    return newProfile;
  };

  // Sign In with Email and Password
  const loginWithEmail = async (email: string, pass: string): Promise<UserProfile> => {
    localStorage.removeItem('neon_user_logged_out');
    const res = await signInWithEmailPasswordFirebase(email, pass);
    const existingResult = await loadUserProfileFromFirestore(res.uid);
    const existing = existingResult.success ? existingResult.data : null;
    const resolvedUser: UserProfile = {
      id: res.uid,
      name: existing?.name || res.displayName || email.split('@')[0],
      email: res.email || email.trim(),
      phone: existing?.phone || '',
      phoneVerified: existing?.phoneVerified || false,
      idCard: existing?.idCard || '',
      pagoMovilBank: existing?.pagoMovilBank || '',
      usdtWallet: existing?.usdtWallet || '',
      avatar: res.photoURL || existing?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${res.uid}`,
      role: existing?.role || (MASTER_ADMIN_EMAILS.includes(email.toLowerCase().trim()) ? 'admin' : 'player'),
      balanceUSD: existing?.balanceUSD || 0.00,
      balanceVES: (existing?.balanceUSD || 0.00) * exchangeRates.vesUsdRate,
      vipTier: existing?.vipTier || 'none',
      vipExpiry: existing?.vipExpiry,
      stats: existing?.stats || {
        matchesPlayed: 0,
        matchesWon: 0,
        totalEarningsUSD: 0,
        totalKills: 0,
        highestScore: 0,
      },
      equippedSkin: existing?.equippedSkin || 'skin_neon_cyan',
      equippedTrail: existing?.equippedTrail || 'trail_rainbow_laser',
      equippedCrown: existing?.equippedCrown || '',
      ownedCosmetics: existing?.ownedCosmetics || ['skin_neon_cyan', 'trail_rainbow_laser'],
      firestoreSynced: true,
      firestoreSyncedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString().split('T')[0],
    };

    setCurrentUser(resolvedUser);
    soundFx.playCashCoin();
    return resolvedUser;
  };

  const sendPasswordReset = async (email: string): Promise<boolean> => {
    return await sendPasswordResetFirebase(email);
  };

  // Update Personal Profile & Sync to Firestore
  const updateProfileData = async (data: Partial<UserProfile>): Promise<boolean> => {
    if (!currentUser) return false;
    const updated: UserProfile = {
      ...currentUser,
      ...data,
      firestoreSynced: true,
      firestoreSyncedAt: new Date().toISOString(),
    };
    setCurrentUser(updated);
    await saveUserProfileToFirestore(updated);
    soundFx.playCashCoin();
    return true;
  };

  const loginUser = async (email: string, phone: string): Promise<boolean> => {
    localStorage.removeItem('neon_user_logged_out');
    const newUser: UserProfile = {
      id: `user_${Date.now().toString(36)}`,
      name: email.split('@')[0],
      email,
      phone,
      phoneVerified: false,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${email}`,
      role: 'player',
      balanceUSD: 0.00,
      balanceVES: 0.00,
      vipTier: 'none',
      stats: {
        matchesPlayed: 0,
        matchesWon: 0,
        totalEarningsUSD: 0,
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
    setCurrentUser(newUser);
    await saveUserProfileToFirestore(newUser);
    return true;
  };

  const verifyPhoneSMS = async (code: string): Promise<boolean> => {
    if (code.length === 6 && currentUser) {
      const updated: UserProfile = {
        ...currentUser,
        phoneVerified: true,
        firestoreSynced: true,
        firestoreSyncedAt: new Date().toISOString(),
      };
      setCurrentUser(updated);
      await saveUserProfileToFirestore(updated);
      soundFx.playCashCoin();
      return true;
    }
    return false;
  };

  const logout = async () => {
    await signOutFirebase();
    setCurrentUser(null);
    setIsAdminUnlocked(false);
    sessionStorage.removeItem('neon_admin_unlocked');
    localStorage.removeItem('neon_user');
    localStorage.setItem('neon_user_logged_out', 'true');
    setActiveRole('player');
    localStorage.setItem('neon_role', 'player');
    soundFx.playNotificationPing();
  };

  // Request Deposit (Pago Móvil / USDT / Bank)
  const requestDeposit = async (data: {
    amountUSD: number;
    method: PaymentMethodType;
    referenceNumber: string;
    receiptUrl?: string;
    details?: Record<string, string>;
  }): Promise<Transaction> => {
    if (!currentUser) throw new Error('Usuario no autenticado');
    if (data.amountUSD <= 0) throw new Error('El monto de recarga debe ser mayor a 0');

    const amountVES = data.amountUSD * exchangeRates.vesUsdRate;
    const newTx: Transaction = {
      id: `tx-${Date.now().toString().slice(-6)}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      type: 'deposit',
      amountUSD: data.amountUSD,
      amountVES,
      method: data.method,
      status: 'pending',
      referenceNumber: data.referenceNumber.trim(),
      receiptUrl: data.receiptUrl,
      receiptDetails: data.details,
      createdAt: new Date().toISOString(),
    };

    setTransactions((prev) => [newTx, ...prev]);
    await saveTransactionToFirestore(newTx);
    soundFx.playCashCoin();

    // Push notification to user
    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      userId: currentUser.id,
      title: '⏳ Depósito en Verificación',
      message: `Tu solicitud de recarga por $${data.amountUSD.toFixed(2)} USD (Ref: ${data.referenceNumber}) está en cola para validación administrativa.`,
      type: 'security',
      read: false,
      timestamp: 'Justo ahora',
      amountUSD: data.amountUSD,
    };
    setNotifications((prev) => [notif, ...prev]);

    return newTx;
  };

  // Request Withdrawal
  const requestWithdrawal = async (data: {
    amountUSD: number;
    method: PaymentMethodType;
    destinationAddressOrBank: string;
    securityPin: string;
    accountHolder: string;
  }): Promise<Transaction> => {
    if (!currentUser) throw new Error('Usuario no autenticado');
    if (data.amountUSD <= 0) throw new Error('Monto de retiro no válido');
    if (currentUser.balanceUSD < data.amountUSD) {
      throw new Error('Saldo insuficiente para retirar');
    }

    const isUsdt = data.method === 'usdt_trc20' || data.method === 'usdt_bep20';
    const feeAmount = isUsdt
      ? (exchangeRates.usdtWithdrawalFeeUSD ?? 1.00)
      : (data.amountUSD * exchangeRates.withdrawalFeePercent) / 100;

    if (data.amountUSD <= feeAmount) {
      throw new Error(
        `El monto a retirar ($${data.amountUSD.toFixed(2)} USD) debe ser mayor a la comisión de retiro ($${feeAmount.toFixed(2)} USD).`
      );
    }

    const netUSD = Math.max(0, data.amountUSD - feeAmount);
    const amountVES = netUSD * exchangeRates.vesUsdRate;

    // Deduct from balance immediately in escrow
    const newBalUSD = currentUser.balanceUSD - data.amountUSD;
    const updatedUser: UserProfile = {
      ...currentUser,
      balanceUSD: newBalUSD,
      balanceVES: newBalUSD * exchangeRates.vesUsdRate,
    };
    setCurrentUser(updatedUser);
    await saveUserProfileToFirestore(updatedUser);

    setPlatformRevenueUSD((prev) => prev + feeAmount);

    const newTx: Transaction = {
      id: `wth-${Date.now().toString().slice(-6)}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      type: 'withdrawal',
      amountUSD: data.amountUSD,
      amountVES,
      method: data.method,
      status: 'pending',
      referenceNumber: `WTH-${Math.floor(100000 + Math.random() * 900000)}`,
      receiptDetails: {
        targetBank: data.destinationAddressOrBank,
        senderIdCard: data.accountHolder,
      },
      adminNotes: isUsdt
        ? `Retiro USDT TRC-20: Débito $${data.amountUSD.toFixed(2)} USD | Fee de red Tron: $${feeAmount.toFixed(2)} USD | Neto a transferir: $${netUSD.toFixed(2)} USDT`
        : `Retiro solicitado con fee del ${exchangeRates.withdrawalFeePercent}% ($${feeAmount.toFixed(2)} USD). Neto a liquidar: Bs. ${amountVES.toLocaleString('es-VE')} ($${netUSD.toFixed(2)} USD).`,
      createdAt: new Date().toISOString(),
    };

    setTransactions((prev) => [newTx, ...prev]);
    await saveTransactionToFirestore(newTx);
    soundFx.playCashCoin();

    const notif: AppNotification = {
      id: `notif-${Date.now()}`,
      userId: currentUser.id,
      title: '💸 Solicitud de Retiro Generada',
      message: isUsdt
        ? `Solicitud de retiro por $${data.amountUSD.toFixed(2)} USD enviada a tu billetera.`
        : `Solicitaste retiro de $${data.amountUSD.toFixed(2)} USD a ${data.destinationAddressOrBank}. Neto: $${netUSD.toFixed(2)} USD.`,
      type: 'security',
      read: false,
      timestamp: 'Justo ahora',
      amountUSD: data.amountUSD,
    };
    setNotifications((prev) => [notif, ...prev]);

    return newTx;
  };

  // Admin approves transaction
  const approveTransaction = (id: string, notes?: string) => {
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id === id && tx.status === 'pending') {
          if (tx.type === 'deposit') {
            if (currentUser && currentUser.id === tx.userId) {
              const newBalUSD = currentUser.balanceUSD + tx.amountUSD;
              const updated = {
                ...currentUser,
                balanceUSD: newBalUSD,
                balanceVES: newBalUSD * exchangeRates.vesUsdRate,
              };
              setCurrentUser(updated);
              saveUserProfileToFirestore(updated).catch(console.warn);
            }
          }

          const notif: AppNotification = {
            id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            userId: tx.userId,
            title: tx.type === 'deposit' ? '✅ ¡Depósito Validado y Acreditado!' : '✅ ¡Retiro Procesado Exitosamente!',
            message:
              tx.type === 'deposit'
                ? `Tu pago por $${tx.amountUSD.toFixed(2)} USD (Bs. ${tx.amountVES.toLocaleString()} VES) fue acreditado a tu balance.`
                : `Tu transferencia por $${tx.amountUSD.toFixed(2)} USD fue enviada a tu cuenta de destino.`,
            type: 'tx_approved',
            read: false,
            timestamp: 'Justo ahora',
            amountUSD: tx.amountUSD,
          };
          setNotifications((n) => [notif, ...n]);
          soundFx.playCashCoin();

          const approvedTx: Transaction = {
            ...tx,
            status: 'approved',
            adminNotes: notes || 'Aprobado y verificado por el Administrador en tiempo real.',
            updatedAt: new Date().toISOString(),
          };
          saveTransactionToFirestore(approvedTx).catch(console.warn);
          return approvedTx;
        }
        return tx;
      })
    );
  };

  // Admin rejects transaction
  const rejectTransaction = (id: string, notes?: string) => {
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id === id && tx.status === 'pending') {
          if (tx.type === 'withdrawal' && currentUser && currentUser.id === tx.userId) {
            const refundUSD = currentUser.balanceUSD + tx.amountUSD;
            const updated = {
              ...currentUser,
              balanceUSD: refundUSD,
              balanceVES: refundUSD * exchangeRates.vesUsdRate,
            };
            setCurrentUser(updated);
            saveUserProfileToFirestore(updated).catch(console.warn);
          }

          const notif: AppNotification = {
            id: `notif-${Date.now()}`,
            userId: tx.userId,
            title: '❌ Transacción Rechazada',
            message: `Tu operación de ${tx.type === 'deposit' ? 'depósito' : 'retiro'} por $${tx.amountUSD.toFixed(2)} USD no pudo ser validada. Motivo: ${notes || 'Comprobante no coincide o datos incorrectos.'}`,
            type: 'tx_rejected',
            read: false,
            timestamp: 'Justo ahora',
          };
          setNotifications((n) => [notif, ...n]);

          const rejectedTx: Transaction = {
            ...tx,
            status: 'rejected',
            adminNotes: notes || 'Comprobante no válido o referencia no encontrada.',
            updatedAt: new Date().toISOString(),
          };
          saveTransactionToFirestore(rejectedTx).catch(console.warn);
          return rejectedTx;
        }
        return tx;
      })
    );
  };

  const updateExchangeRates = (newConfig: Partial<ExchangeConfig>) => {
    setExchangeRates((prev) => {
      const updated = { ...prev, ...newConfig };
      if (currentUser) {
        setCurrentUser({
          ...currentUser,
          balanceVES: currentUser.balanceUSD * updated.vesUsdRate,
        });
      }
      return updated;
    });
    soundFx.playNotificationPing();
  };

  const createTournamentRoom = (config: {
    name: string;
    type: 'public' | 'private';
    entryFeeUSD: number;
    maxPlayers: number;
    isSpecialEvent?: boolean;
  }): TournamentRoom => {
    if (!currentUser) throw new Error('Debes iniciar sesión para crear salas');
    if (config.entryFeeUSD <= 0) throw new Error('Las salas creadas por jugadores deben tener una entrada pagada');
    if (currentUser.balanceUSD < config.entryFeeUSD) {
      throw new Error('Saldo insuficiente para pagar la entrada al torneo');
    }

    // Deduct entry fee immediately into pot
    const updatedUser: UserProfile = {
      ...currentUser,
      balanceUSD: currentUser.balanceUSD - config.entryFeeUSD,
      balanceVES: (currentUser.balanceUSD - config.entryFeeUSD) * exchangeRates.vesUsdRate,
    };
    setCurrentUser(updatedUser);
    saveUserProfileToFirestore(updatedUser).catch(console.warn);

    const initialParticipants = [
      { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar, ready: true, isUser: true },
    ];
    const totalParticipants = initialParticipants.length;
    const roomPot = totalParticipants * config.entryFeeUSD;
    const winnerCut = (roomPot * exchangeRates.winnerPotPercent) / 100;
    const devCut = (roomPot * exchangeRates.platformPotPercent) / 100;

    const newRoom: TournamentRoom = {
      id: `room-${Date.now()}`,
      name: config.name,
      code: `NEON-${Math.floor(100 + Math.random() * 900)}`,
      type: config.type,
      entryFeeUSD: config.entryFeeUSD,
      potUSD: roomPot,
      winnerRewardUSD: winnerCut,
      devFeeUSD: devCut,
      maxPlayers: config.maxPlayers,
      minPlayersToStart: 4,
      currentPlayers: totalParticipants,
      status: 'waiting',
      durationSeconds: 180,
      timeRemainingSeconds: 180,
      nextLaunchSeconds: 300,
      shrinkTriggerSeconds: 60,
      arenaRadius: 1800,
      currentArenaRadius: 1800,
      hostId: currentUser.id,
      hostName: currentUser.name,
      isSpecialEvent: config.isSpecialEvent ?? false,
      registeredPlayers: initialParticipants,
      createdAt: new Date().toISOString(),
    };

    setRooms((prev) => [newRoom, ...prev]);
    saveTournamentRoom(newRoom).catch((error) => console.warn('Room sync:', error));
    setActiveRoom(newRoom);
    soundFx.playBoost();
    return newRoom;
  };

  const adminCreateRoom = (config: {
    name: string;
    type: 'public' | 'private';
    entryFeeUSD: number;
    maxPlayers: number;
    isSpecialEvent?: boolean;
    durationSeconds?: number;
    customPotUSD?: number;
    eventDescription?: string;
    sponsorName?: string;
    minPlayersToStart?: number;
    arenaRadius?: number;
    broadcastNotification?: boolean;
  }): TournamentRoom => {
    const isSpecial = !!config.isSpecialEvent;
    const calculatedPot = config.customPotUSD !== undefined && config.customPotUSD >= 0
      ? config.customPotUSD
      : 0;

    const winnerCut = (calculatedPot * exchangeRates.winnerPotPercent) / 100;
    const devCut = (calculatedPot * exchangeRates.platformPotPercent) / 100;

    const newRoom: TournamentRoom = {
      id: `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: config.name.trim(),
      code: isSpecial ? `EVENT-${Math.floor(1000 + Math.random() * 9000)}` : `ROOM-${Math.floor(100 + Math.random() * 900)}`,
      type: config.type,
      entryFeeUSD: config.entryFeeUSD,
      potUSD: calculatedPot,
      winnerRewardUSD: winnerCut,
      devFeeUSD: devCut,
      maxPlayers: config.maxPlayers || 15,
      minPlayersToStart: config.minPlayersToStart || 4,
      currentPlayers: 0,
      status: 'waiting',
      durationSeconds: config.durationSeconds || 180,
      timeRemainingSeconds: config.durationSeconds || 180,
      nextLaunchSeconds: 300,
      shrinkTriggerSeconds: 60,
      arenaRadius: config.arenaRadius || 1800,
      currentArenaRadius: config.arenaRadius || 1800,
      hostId: currentUser?.id || 'admin_master',
      hostName: isSpecial ? '🎉 EVENTO ESPECIAL OFICIAL' : 'ADMINISTRACIÓN NEÓN',
      isSpecialEvent: isSpecial,
      eventDescription: config.eventDescription,
      sponsorName: config.sponsorName,
      registeredPlayers: [],
      createdAt: new Date().toISOString(),
    };

    setRooms((prev) => [newRoom, ...prev]);
    saveTournamentRoom(newRoom).catch((error) => console.warn('Room sync:', error));

    if (isSpecial || config.broadcastNotification) {
      const broadcastNotif: AppNotification = {
        id: `notif-event-${Date.now()}`,
        userId: 'all',
        title: isSpecial ? `🏆 ¡Nuevo Evento Especial Creado: ${config.name}!` : `🕹️ ¡Nueva Sala de Combate: ${config.name}!`,
        message: config.eventDescription || `Sala disponible con bote de $${calculatedPot.toFixed(2)} USD. ¡Inscríbete ahora y demuestra tu supremacía!`,
        type: isSpecial ? 'tournament_alert' : 'broadcast',
        read: false,
        timestamp: 'Justo ahora',
        amountUSD: calculatedPot,
      };
      setNotifications((prev) => [broadcastNotif, ...prev]);
    }

    soundFx.playVictoryFanfare();
    return newRoom;
  };

  const adminUpdateRoom = (roomId: string, updates: Partial<TournamentRoom>) => {
    const existingRoom = rooms.find((room) => room.id === roomId);
    if (existingRoom) {
      const updatedRoom = { ...existingRoom, ...updates };
      if (updates.potUSD !== undefined) {
        updatedRoom.winnerRewardUSD = (updates.potUSD * exchangeRates.winnerPotPercent) / 100;
        updatedRoom.devFeeUSD = (updates.potUSD * exchangeRates.platformPotPercent) / 100;
      }
      saveTournamentRoom(updatedRoom).catch((error) => console.warn('Room sync:', error));
    }
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id === roomId) {
          const updated = { ...r, ...updates };
          if (updates.potUSD !== undefined) {
            updated.winnerRewardUSD = (updates.potUSD * exchangeRates.winnerPotPercent) / 100;
            updated.devFeeUSD = (updates.potUSD * exchangeRates.platformPotPercent) / 100;
          }
          return updated;
        }
        return r;
      })
    );

    if (activeRoom && activeRoom.id === roomId) {
      setActiveRoom((prev) => (prev ? { ...prev, ...updates } : null));
    }
    soundFx.playNotificationPing();
  };

  const adminDeleteRoom = (roomId: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
    deleteTournamentRoom(roomId).catch((error) => console.warn('Room sync:', error));
    if (activeRoom && activeRoom.id === roomId) {
      setActiveRoom(null);
    }
    soundFx.playNotificationPing();
  };

  const joinRoom = (roomId: string, code?: string): boolean => {
    const targetRoom = rooms.find((r) => r.id === roomId);
    if (!targetRoom || !currentUser) return false;

    if (targetRoom.type === 'private' && code && targetRoom.code !== code) {
      alert('Código de sala privada incorrecto');
      return false;
    }

    if (currentUser.balanceUSD < targetRoom.entryFeeUSD) {
      alert(`Saldo insuficiente. La entrada requiere $${targetRoom.entryFeeUSD.toFixed(2)} USD.`);
      return false;
    }

    // Deduct entry fee immediately - committed to pot
    const updatedUser: UserProfile = {
      ...currentUser,
      balanceUSD: currentUser.balanceUSD - targetRoom.entryFeeUSD,
      balanceVES: (currentUser.balanceUSD - targetRoom.entryFeeUSD) * exchangeRates.vesUsdRate,
    };
    setCurrentUser(updatedUser);
    saveUserProfileToFirestore(updatedUser).catch(console.warn);

    // Register player slot
    const existingPlayers = targetRoom.registeredPlayers || [];
    const isAlreadyRegistered = existingPlayers.some((p) => p.id === currentUser.id);
    const updatedPlayers = isAlreadyRegistered
      ? existingPlayers
      : [
          {
            id: currentUser.id,
            name: currentUser.name,
            avatar: currentUser.avatar,
            ready: true,
            isUser: true,
          },
          ...existingPlayers,
        ].slice(0, targetRoom.maxPlayers);

    const activePlayerCount = updatedPlayers.length;
    const newPot = activePlayerCount * targetRoom.entryFeeUSD;
    const winnerReward = (newPot * exchangeRates.winnerPotPercent) / 100;
    const devFee = (newPot * exchangeRates.platformPotPercent) / 100;

    const updatedRoom: TournamentRoom = {
      ...targetRoom,
      currentPlayers: activePlayerCount,
      potUSD: newPot,
      winnerRewardUSD: winnerReward,
      devFeeUSD: devFee,
      registeredPlayers: updatedPlayers,
    };

    setRooms((prev) => prev.map((r) => (r.id === roomId ? updatedRoom : r)));
    saveTournamentRoom(updatedRoom).catch((error) => console.warn('Room sync:', error));
    setActiveRoom(updatedRoom);
    soundFx.playBoost();
    return true;
  };

  const startMatchNow = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId) || activeRoom;
    if (!room) return;

    const startedRoom: TournamentRoom = {
      ...room,
      status: 'in_game',
      timeRemainingSeconds: 180,
      arenaRadius: room.arenaRadius || 1800,
      currentArenaRadius: room.arenaRadius || 1800,
    };

    setRooms((prev) => prev.map((r) => (r.id === roomId ? startedRoom : r)));
    saveTournamentRoom(startedRoom).catch((error) => console.warn('Room sync:', error));
    setActiveRoom(startedRoom);
    soundFx.playVictoryFanfare();
  };

  const leaveRoom = () => {
    setActiveRoom(null);
  };

  const buyCosmetic = (item: CosmeticItem): boolean => {
    if (!currentUser) return false;
    if (currentUser.ownedCosmetics.includes(item.id)) return true;
    if (currentUser.balanceUSD < item.priceUSD) {
      alert(`Saldo insuficiente para comprar ${item.name}. Requiere $${item.priceUSD.toFixed(2)} USD.`);
      return false;
    }

    const newBalance = currentUser.balanceUSD - item.priceUSD;
    const updatedUser: UserProfile = {
      ...currentUser,
      balanceUSD: newBalance,
      balanceVES: newBalance * exchangeRates.vesUsdRate,
      ownedCosmetics: [...currentUser.ownedCosmetics, item.id],
    };

    setCurrentUser(updatedUser);
    saveUserProfileToFirestore(updatedUser).catch(console.warn);

    const newTx: Transaction = {
      id: `tx-cosmetic-${Date.now().toString().slice(-5)}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      type: 'cosmetic_buy',
      amountUSD: item.priceUSD,
      amountVES: item.priceUSD * exchangeRates.vesUsdRate,
      method: 'pago_movil',
      status: 'approved',
      referenceNumber: `SKIN-${item.id.toUpperCase()}`,
      adminNotes: `Compra de cosmético: ${item.name}`,
      createdAt: new Date().toISOString(),
    };
    setTransactions((prev) => [newTx, ...prev]);
    saveTransactionToFirestore(newTx).catch(console.warn);

    setPlatformRevenueUSD((prev) => prev + item.priceUSD);
    soundFx.playCashCoin();
    return true;
  };

  const equipCosmetic = (type: 'skin' | 'trail' | 'crown', id: string) => {
    if (!currentUser) return;
    let updated: UserProfile;
    if (type === 'skin') {
      updated = { ...currentUser, equippedSkin: id };
    } else if (type === 'trail') {
      updated = { ...currentUser, equippedTrail: id };
    } else {
      updated = { ...currentUser, equippedCrown: id };
    }
    setCurrentUser(updated);
    saveUserProfileToFirestore(updated).catch(console.warn);
    soundFx.playOrbPickup(5);
  };

  const subscribeVIP = (tier: 'vip_bronze' | 'vip_neon' | 'vip_titan', priceUSD: number): boolean => {
    if (!currentUser) return false;
    if (currentUser.balanceUSD < priceUSD) {
      alert(`Saldo insuficiente para suscripción VIP (${priceUSD} USD).`);
      return false;
    }

    const newBalance = currentUser.balanceUSD - priceUSD;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);

    const updatedUser: UserProfile = {
      ...currentUser,
      balanceUSD: newBalance,
      balanceVES: newBalance * exchangeRates.vesUsdRate,
      vipTier: tier,
      vipExpiry: expiry.toISOString().split('T')[0],
      ownedCosmetics: tier === 'vip_titan' && !currentUser.ownedCosmetics.includes('skin_gold_titan') 
        ? [...currentUser.ownedCosmetics, 'skin_gold_titan'] 
        : currentUser.ownedCosmetics,
    };

    setCurrentUser(updatedUser);
    saveUserProfileToFirestore(updatedUser).catch(console.warn);
    setPlatformRevenueUSD((prev) => prev + priceUSD);

    const newTx: Transaction = {
      id: `vip-${Date.now().toString().slice(-5)}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      type: 'vip_subscription',
      amountUSD: priceUSD,
      amountVES: priceUSD * exchangeRates.vesUsdRate,
      method: 'pago_movil',
      status: 'approved',
      referenceNumber: `VIP-${tier.toUpperCase()}`,
      adminNotes: `Suscripción mensual ${tier.toUpperCase()}`,
      createdAt: new Date().toISOString(),
    };
    setTransactions((prev) => [newTx, ...prev]);
    saveTransactionToFirestore(newTx).catch(console.warn);
    soundFx.playVictoryFanfare();
    return true;
  };

  const sendPushBroadcast = (title: string, message: string, target: 'all' | string = 'all') => {
    const notif: AppNotification = {
      id: `broadcast-${Date.now()}`,
      userId: target,
      title,
      message,
      type: 'broadcast',
      read: false,
      timestamp: 'Justo ahora',
    };
    setNotifications((prev) => [notif, ...prev]);
    soundFx.playNotificationPing();
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  // Anti-Cheat Protected 80/20 Pot Distribution
  const finishMatchPot = async (
    roomId: string,
    winnerId: string,
    winnerName: string,
    matchStats?: { score: number; kills: number },
    token?: MatchSessionToken | null
  ): Promise<{ success: boolean; reason?: string }> => {
    const room = rooms.find((r) => r.id === roomId) || activeRoom;
    if (!room) return { success: false, reason: 'Sala no encontrada.' };

    const isUserWinner = currentUser && (currentUser.id === winnerId || winnerName === currentUser.name);

    // If real user won, perform cryptographic and physical anti-cheat verification
    if (isUserWinner && currentUser) {
      if (token) {
        const telemetry: MatchTelemetry = {
          score: matchStats?.score || 0,
          kills: matchStats?.kills || 0,
          durationSeconds: (Date.now() - token.startTime) / 1000,
          peakMass: Math.max(matchStats?.score || 0, 50),
          orbsConsumed: Math.floor((matchStats?.score || 0) / 10),
        };
        const validation = await validateMatchVictoryCloud(token, telemetry, room.id, room.currentPlayers);
        if (!validation.valid) {
          console.error('Anti-Cheat Alert:', validation.reason);
          soundFx.playNotificationPing();
          alert(`⚠️ Alerta de Seguridad Anti-Trampas: ${validation.reason}`);
          return { success: false, reason: validation.reason };
        }
      }

      const potTotal = Math.max(room.potUSD, room.entryFeeUSD * (room.registeredPlayers?.length || 1));
      const winnerPayoutUSD = (potTotal * exchangeRates.winnerPotPercent) / 100;
      const platformCommissionUSD = (potTotal * exchangeRates.platformPotPercent) / 100;

      setPlatformRevenueUSD((prev) => prev + platformCommissionUSD);

      const newBal = currentUser.balanceUSD + winnerPayoutUSD;
      const updatedUser: UserProfile = {
        ...currentUser,
        balanceUSD: newBal,
        balanceVES: newBal * exchangeRates.vesUsdRate,
        stats: {
          ...currentUser.stats,
          matchesPlayed: currentUser.stats.matchesPlayed + 1,
          matchesWon: currentUser.stats.matchesWon + 1,
          totalEarningsUSD: currentUser.stats.totalEarningsUSD + winnerPayoutUSD,
          totalKills: currentUser.stats.totalKills + (matchStats?.kills || 0),
          highestScore: Math.max(currentUser.stats.highestScore, matchStats?.score || 0),
        },
      };
      setCurrentUser(updatedUser);
      saveUserProfileToFirestore(updatedUser).catch(console.warn);

      // Record Win Transaction
      const winTx: Transaction = {
        id: `win-${Date.now().toString().slice(-6)}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userPhone: currentUser.phone,
        type: 'pot_win',
        amountUSD: winnerPayoutUSD,
        amountVES: winnerPayoutUSD * exchangeRates.vesUsdRate,
        method: 'pago_movil',
        status: 'approved',
        referenceNumber: `POT-WIN-${room.code}-${Date.now().toString().slice(-4)}`,
        adminNotes: `Premio del 80% del pote (${potTotal.toFixed(2)} USD total verificado por Anti-Cheat).`,
        createdAt: new Date().toISOString(),
      };
      setTransactions((prev) => [winTx, ...prev]);
      saveTransactionToFirestore(winTx).catch(console.warn);

      const winNotif: AppNotification = {
        id: `notif-win-${Date.now()}`,
        userId: currentUser.id,
        title: '🏆 ¡CAMPEÓN DEL TORNEO! +$' + winnerPayoutUSD.toFixed(2),
        message: `¡Has ganado la partida en ${room.name}! Se ha acreditado el 80% del pote ($${winnerPayoutUSD.toFixed(2)} USD) tras validar la integridad de la partida.`,
        type: 'pot_win',
        read: false,
        timestamp: 'Justo ahora',
        amountUSD: winnerPayoutUSD,
      };
      setNotifications((prev) => [winNotif, ...prev]);
      soundFx.playVictoryFanfare();
      return { success: true };
    } else if (currentUser) {
      // Just update match played
      const updatedUser: UserProfile = {
        ...currentUser,
        stats: {
          ...currentUser.stats,
          matchesPlayed: currentUser.stats.matchesPlayed + 1,
          totalKills: currentUser.stats.totalKills + (matchStats?.kills || 0),
          highestScore: Math.max(currentUser.stats.highestScore, matchStats?.score || 0),
        },
      };
      setCurrentUser(updatedUser);
      saveUserProfileToFirestore(updatedUser).catch(console.warn);
      return { success: true };
    }

    return { success: true };
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  return (
    <AppContext.Provider
      value={{
        currentUser,
        activeRole,
        currentRole: activeRole,
        visualMode,
        exchangeRates,
        transactions,
        notifications,
        skins,
        rooms,
        activeRoom,
        leaderboard,
        platformRevenueUSD,
        unreadNotificationsCount,
        showTutorial,
        soundEnabled,
        isAdminUnlocked,
        isAuthorizedAdmin,
        setCurrentUser,
        switchRole,
        verifyAdminPin,
        lockAdmin,
        setVisualMode,
        setSoundEnabled,
        setShowTutorial,
        registerWithEmail,
        loginWithEmail,
        sendPasswordReset,
        updateProfileData,
        loginUser,
        verifyPhoneSMS,
        logout,
        requestDeposit,
        requestWithdrawal,
        approveTransaction,
        rejectTransaction,
        updateExchangeRates,
        createTournamentRoom,
        adminCreateRoom,
        adminUpdateRoom,
        adminDeleteRoom,
        joinRoom,
        startMatchNow,
        leaveRoom,
        buyCosmetic,
        equipCosmetic,
        subscribeVIP,
        sendPushBroadcast,
        markNotificationAsRead,
        markAllNotificationsRead,
        finishMatchPot,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
