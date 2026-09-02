export type Role = 'player' | 'admin';

export type VisualMode = 'isometric' | 'minimalist';

export type PaymentMethodType = 'pago_movil' | 'usdt_trc20' | 'usdt_bep20' | 'international_wire';

export type TransactionType = 'deposit' | 'withdrawal' | 'pot_win' | 'entry_fee' | 'cosmetic_buy' | 'vip_subscription';

export type TransactionStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  idCard?: string; // Cédula de Identidad / DNI (ej: V-28.123.456)
  pagoMovilBank?: string; // Banco para retiros (ej: 0102 - Banco de Venezuela)
  usdtWallet?: string; // Dirección de billetera USDT (TRC20 / BEP20)
  avatar: string;
  role: Role;
  balanceUSD: number;
  balanceVES: number;
  vipTier: 'none' | 'vip_bronze' | 'vip_neon' | 'vip_titan';
  vipExpiry?: string;
  stats: {
    matchesPlayed: number;
    matchesWon: number;
    totalEarningsUSD: number;
    totalKills: number;
    highestScore: number;
  };
  equippedSkin: string;
  equippedTrail: string;
  equippedCrown: string;
  ownedCosmetics: string[];
  firestoreSynced?: boolean;
  firestoreSyncedAt?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  type: TransactionType;
  amountUSD: number;
  amountVES: number;
  method: PaymentMethodType;
  status: TransactionStatus;
  referenceNumber: string;
  receiptUrl?: string;
  receiptDetails?: {
    originBank?: string;
    targetBank?: string;
    senderIdCard?: string;
    cryptoNetwork?: string;
    cryptoTxHash?: string;
    swiftCode?: string;
  };
  adminNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppNotification {
  id: string;
  userId: string; // 'all' or specific userId
  title: string;
  message: string;
  type: 'tx_approved' | 'tx_rejected' | 'pot_win' | 'tournament_alert' | 'broadcast' | 'security';
  read: boolean;
  timestamp: string;
  amountUSD?: number;
}

export interface CosmeticItem {
  id: string;
  name: string;
  type: 'skin' | 'trail' | 'crown' | 'kill_fx';
  priceUSD: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  description: string;
  color: string;
  secondaryColor?: string;
  glowColor: string;
  pattern: 'pulse' | 'matrix' | 'fire' | 'lightning' | 'galaxy' | 'cyber';
}

export interface TournamentPlayerSlot {
  id: string;
  name: string;
  avatar: string;
  ready: boolean;
  isUser?: boolean;
}

export interface TournamentRoom {
  id: string;
  name: string;
  code: string;
  type: 'public' | 'private';
  entryFeeUSD: number;
  potUSD: number;
  winnerRewardUSD: number; // 80%
  devFeeUSD: number; // 20%
  maxPlayers: number;
  currentPlayers: number;
  minPlayersToStart: number; // 4 players required
  status: 'waiting' | 'in_game' | 'finished';
  durationSeconds: number; // 180 (3 min)
  timeRemainingSeconds: number;
  nextLaunchSeconds?: number; // 5-minute countdown (300s)
  shrinkTriggerSeconds: number; // 60
  arenaRadius: number;
  currentArenaRadius: number;
  hostId: string;
  hostName: string;
  isSpecialEvent?: boolean;
  eventDescription?: string;
  sponsorName?: string;
  eventPrizeUSD?: number;
  registeredPlayers?: TournamentPlayerSlot[];
  createdAt: string;
}

export interface ExchangeConfig {
  vesUsdRate: number; // e.g. 68.50 Bs por 1 USD
  usdtRate: number; // 1.00 USD
  usdtWithdrawalFeeUSD: number; // $1.00 USD comisión fija por retiro en USDT (Red Tron TRC-20)
  withdrawalFeePercent: number; // 3% comisión para transferencias bancarias
  winnerPotPercent: number; // 80%
  platformPotPercent: number; // 20%
  pagoMovilAccounts: {
    bankName: string;
    bankCode: string;
    phone: string;
    idCard: string;
    holderName: string;
  }[];
  usdtWallets: {
    network: string;
    address: string;
    qrUrl?: string;
  }[];
  internationalBank: {
    bankName: string;
    accountNumber: string;
    routingOrSwift: string;
    beneficiary: string;
  };
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  wins: number;
  totalEarningsUSD: number;
  highestMass: number;
  vipTier: string;
}

// In-Game Physics Entities
export interface GamePlayerEntity {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  score: number;
  color: string;
  glowColor: string;
  secondaryColor?: string;
  trailColor?: string;
  crown?: string;
  pattern?: string;
  isAlive: boolean;
  kills: number;
  isUser: boolean;
  isBot: boolean;
  speed: number;
  boostActive: boolean;
  angle: number;
  trailHistory: { x: number; y: number; alpha: number }[];
  respawnTimer?: number;
}

export interface OrbEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
  value: number;
  color: string;
  glowColor: string;
  pulsePhase: number;
}

export interface ParticleEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

// Anti-Cheat Match Session & Telemetry Security
export interface MatchSessionToken {
  sessionId: string;
  roomId: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  entryFeeUSD: number;
  startTime: number;
  nonce: string;
  checksum: string;
}

export interface MatchTelemetry {
  score: number;
  kills: number;
  durationSeconds: number;
  peakMass: number;
  orbsConsumed: number;
}

export interface MatchValidationResult {
  valid: boolean;
  reason?: string;
  verifiedScore?: number;
}
