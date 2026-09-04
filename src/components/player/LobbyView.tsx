import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TournamentRoom } from '../../types';
import { subscribeToPresence, subscribeToMatchPlayers } from '../../services/firebase';
import {
  Play,
  Plus,
  Trophy,
  Users,
  Shield,
  HelpCircle,
  Lock,
  Globe,
  Radio,
} from 'lucide-react';

interface LobbyViewProps {
  onStartGame: (room: TournamentRoom) => void;
  onOpenWallet: () => void;
  onOpenTutorial: () => void;
  onOpenAdminSecurity?: () => void;
  onOpenAuth?: () => void;
  onOpenVIP?: () => void;
  onOpenShop?: () => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  onStartGame,
  onOpenWallet,
  onOpenTutorial,
  onOpenAdminSecurity,
  onOpenAuth,
}) => {
  const {
    currentUser,
    rooms,
    createTournamentRoom,
    joinRoom,
    leaveRoom,
    leaderboard,
    exchangeRates,
    switchRole,
    isAdminUnlocked,
    isAuthorizedAdmin,
    gameConfig,
  } = useApp();

  const [activeFilter, setActiveFilter] = useState<'all' | 'public' | 'private' | 'events'>('all');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [waitingRoomModal, setWaitingRoomModal] = useState<TournamentRoom | null>(null);
  const [privateCodeInput, setPrivateCodeInput] = useState<string>('');
  const [selectedPrivateRoomId, setSelectedPrivateRoomId] = useState<string | null>(null);
  // Launch-cycle guard: each match launch may auto-start the game only once.
  const autoLaunchedRef = useRef<Set<string>>(new Set());

  // Live online players (presence engine, Realtime DB)
  const [onlinePlayersCount, setOnlinePlayersCount] = useState<number>(0);
  useEffect(() => {
    const unsubscribe = subscribeToPresence(
      (entries) => {
        const now = Date.now();
        const online = Object.values(entries || {}).filter(
          (entry) => entry?.state && entry.state !== 'offline' && now - (entry.lastSeen || 0) < 90000
        ).length;
        // The locally connected user is always online: floor the counter at 1
        // so a stalled/failed presence sync never shows a false "0 en línea".
        setOnlinePlayersCount(currentUser ? Math.max(online, 1) : online);
      },
      (error) => console.warn('Presence sync:', error.message)
    );
    return unsubscribe;
  }, [currentUser?.id]);

  // Create Room form state (restricted $0.20 to $5.00 for standard games)
  const [roomName, setRoomName] = useState<string>('⚡ Torneo Relámpago Neón');
  const [roomType, setRoomType] = useState<'public' | 'private'>('public');
  const [entryFeeUSD, setEntryFeeUSD] = useState<number>(0.50);
  const [maxPlayers, setMaxPlayers] = useState<number>(8);

  const handleAdminAccess = () => {
    if (isAuthorizedAdmin && isAdminUnlocked) {
      switchRole('admin');
    } else if (onOpenAdminSecurity) {
      onOpenAdminSecurity();
    } else if (onOpenAuth) {
      onOpenAuth();
    }
  };

  const handleCreateRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      if (onOpenAuth) {
        onOpenAuth();
      } else {
        alert('Inicia sesión para crear una sala');
      }
      return;
    }
    if (entryFeeUSD < gameConfig.minEntryFeeUSD) {
      alert(`El monto mínimo de entrada para salas estándar es $${gameConfig.minEntryFeeUSD.toFixed(2)} USD.`);
      return;
    }
    if (entryFeeUSD > gameConfig.maxEntryFeeUSD) {
      alert(`El monto máximo de entrada para salas estándar es $${gameConfig.maxEntryFeeUSD.toFixed(2)} USD. Montos mayores son reservados para eventos especiales habilitados por el Administrador.`);
      return;
    }
    if (currentUser.balanceUSD < entryFeeUSD) {
      if (window.confirm(`Saldo insuficiente ($${currentUser.balanceUSD.toFixed(2)} USD). Requiere $${entryFeeUSD.toFixed(2)} USD. ¿Deseas recargar saldo por Pago Móvil o Binance ahora?`)) {
        onOpenWallet();
      }
      return;
    }

    try {
      const newRoom = createTournamentRoom({
        name: roomName,
        type: roomType,
        entryFeeUSD,
        maxPlayers,
      });
      setShowCreateModal(false);
      setWaitingRoomModal(newRoom);
    } catch (err: unknown) {
      alert((err as Error).message || 'Error creando sala');
    }
  };

  const handleJoinClick = (room?: TournamentRoom) => {
    if (!room) return;
    if (!currentUser) {
      if (onOpenAuth) {
        onOpenAuth();
      } else {
        alert('Inicia sesión para entrar al torneo');
      }
      return;
    }

    if (room.type === 'private') {
      setSelectedPrivateRoomId(room.id);
      return;
    }

    if (currentUser.balanceUSD < room.entryFeeUSD) {
      if (window.confirm(`Saldo insuficiente ($${currentUser.balanceUSD.toFixed(2)} USD). Requiere $${room.entryFeeUSD.toFixed(2)} USD. ¿Deseas recargar saldo con Pago Móvil o Binance ahora?`)) {
        onOpenWallet();
      }
      return;
    }

    const joined = joinRoom(room.id);
    if (joined) {
      // joinRoom returns the freshly-updated room (with the new player slot),
      // so the waiting-room modal opens with the correct registeredPlayers /
      // currentPlayers / potUSD instead of the pre-update snapshot.
      setWaitingRoomModal(joined);
    }
  };

  const handleJoinPrivateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPrivateRoomId) return;

    const joined = joinRoom(selectedPrivateRoomId, privateCodeInput.trim().toUpperCase());
    if (joined) {
      setWaitingRoomModal(joined);
      setSelectedPrivateRoomId(null);
      setPrivateCodeInput('');
    } else {
      alert('Código de sala privada no válido.');
    }
  };

  const filteredRooms = rooms.filter((r) => {
    if (activeFilter === 'public') return r.type === 'public';
    if (activeFilter === 'private') return r.type === 'private';
    if (activeFilter === 'events') return !!r.isSpecialEvent;
    return true;
  });

  // Current active waiting room - always read the latest room state from the
  // rooms array so the player list / pot / status update in real-time as
  // other clients join or leave.
  const currentModalRoom = waitingRoomModal
    ? rooms.find((r) => r.id === waitingRoomModal.id) || waitingRoomModal
    : null;

  // Real-time sync: refresh waiting room modal when rooms array changes
  // (keeps the player list and pot USD live without manual refresh)
  useEffect(() => {
    if (!waitingRoomModal) return;
    const live = rooms.find((r) => r.id === waitingRoomModal.id);
    if (live && live !== waitingRoomModal) {
      setWaitingRoomModal(live);
    }
  }, [rooms, waitingRoomModal]);

  // Live match-players subscription for the waiting room: shows real-time
  // player count and names as others join (even before the room updates)
  useEffect(() => {
    if (!waitingRoomModal || !currentUser) return;
    const FRESH_WINDOW = 30000; // 30s window for waiting room
    const unsubscribe = subscribeToMatchPlayers(
      waitingRoomModal.id,
      (players) => {
        const now = Date.now();
        const fresh = players.filter((p) => now - (p.updatedAt || 0) < FRESH_WINDOW);
        // If real-time players differ from room.registeredPlayers, the room
        // subscription will catch up shortly. This is a preview layer.
        if (fresh.length > (currentModalRoom?.currentPlayers || 0)) {
          // Update the modal's player count for immediate feedback
          setWaitingRoomModal((prev) =>
            prev ? { ...prev, currentPlayers: fresh.length } : prev
          );
        }
      },
      () => undefined // Silent fail for preview layer
    );
    return unsubscribe;
  }, [waitingRoomModal, currentUser, currentModalRoom?.currentPlayers]);

  useEffect(() => {
    if (!currentUser || !waitingRoomModal) return;
    const activePlayerRoom = rooms.find((room) =>
      room.id === waitingRoomModal.id &&
      room.status === 'in_game' &&
      room.registeredPlayers?.some((player) => player.id === currentUser.id)
    );
    if (!activePlayerRoom) return;

    // Only auto-launch while the shared match clock is actually live (never
    // resurrect stale matches) and only once per launch cycle.
    const startedTs = activePlayerRoom.matchStartedAt
      ? new Date(activePlayerRoom.matchStartedAt).getTime()
      : 0;
    const remaining = startedTs
      ? activePlayerRoom.durationSeconds - (Date.now() - startedTs) / 1000
      : activePlayerRoom.durationSeconds;
    if (remaining <= 0) return;

    const launchKey = `${activePlayerRoom.id}:${activePlayerRoom.matchStartedAt}`;
    if (autoLaunchedRef.current.has(launchKey)) return;
    autoLaunchedRef.current.add(launchKey);

    // Note: App.tsx already auto-routes to the game view whenever
    // activeRoom.status flips to in_game, so even closing the modal here
    // no longer strands the user. We still close the modal for UX.
    setWaitingRoomModal(null);
    onStartGame(activePlayerRoom);
  }, [currentUser, onStartGame, rooms, waitingRoomModal]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Admin Access Quick Banner */}
      <div className="rounded-2xl p-3.5 bg-gradient-to-r from-purple-950/90 via-indigo-950/90 to-purple-900/90 border border-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.25)] flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-400/60 flex items-center justify-center text-purple-300 shrink-0 shadow-[0_0_10px_rgba(168,85,247,0.4)]">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-orbitron font-bold text-white flex items-center gap-2">
              <span>ACCESO A ADMINISTRADOR DEL SISTEMA</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 text-[10px] font-mono-tech border border-purple-400/40">SUPERVISOR</span>
            </p>
            <p className="text-[11px] text-purple-200/80 font-sans">
              Supervisa depósitos de Pago Móvil, aprueba retiros, ajusta la tasa VES/USD y crea torneos especiales.
            </p>
          </div>
        </div>
        <button
          id="hero-switch-admin-btn"
          type="button"
          onClick={handleAdminAccess}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_15px_rgba(168,85,247,0.5)] transition-all shrink-0 cursor-pointer flex items-center gap-2"
        >
          <Shield className="w-4 h-4" />
          <span>ENTRAR AL PANEL ADMIN</span>
        </button>
      </div>

      {/* Hero Tournament Matchmaking Card */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-[#0c0f2a] via-[#101438] to-[#1a0f35] border-2 border-cyan-500/40 shadow-[0_0_40px_rgba(6,182,212,0.25)] overflow-hidden">
        {/* Neon laser accent lines */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-fuchsia-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-950/80 border border-cyan-400/50 text-cyan-300 text-xs font-orbitron font-bold shadow-[0_0_12px_rgba(6,182,212,0.3)]">
                <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="break-words">SALA DE ESPERA • LANZAMIENTOS CADA 5 MINUTOS (MÍNIMO 4 JUGADORES)</span>
              </div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 text-xs font-orbitron font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
                <span className="break-words">{onlinePlayersCount} EN LÍNEA AHORA</span>
              </div>
            </div>
            <h1 className="text-2xl sm:text-4xl font-orbitron font-black text-white leading-tight">
              Domina la Arena Neón y Conquista el <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-orange-400">80% del Pote</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-sans leading-relaxed">
              Las salas esperan a {gameConfig.defaultMinPlayersToStart} gladiadores y lanzan cada {Math.round(gameConfig.launchWindowSeconds / 60)} minutos. La entrada se deduce al inscribirte y va directo al pote no reembolsable. Entradas de ${gameConfig.minEntryFeeUSD.toFixed(2)} hasta ${gameConfig.maxEntryFeeUSD.toFixed(2)} USD.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <button
              id="lobby-create-room-btn"
              onClick={() => setShowCreateModal(true)}
              className="flex-1 sm:flex-none px-7 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 font-orbitron font-black text-xs sm:text-sm tracking-wider shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              <span>CREAR SALA ($0.20 - $5.00)</span>
            </button>

            <button
              id="lobby-tutorial-btn"
              onClick={onOpenTutorial}
              className="flex-1 sm:flex-none px-5 py-3.5 rounded-2xl bg-[#0f1430]/90 hover:bg-[#161c42] border border-cyan-500/30 text-slate-200 font-orbitron font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(0,0,0,0.4)] cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-amber-400" />
              <span>GUÍA TUTORIAL</span>
            </button>

          </div>
        </div>

        {/* Quick Stakes Cards ($0.20 to $5.00) Dynamic Pot Example */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          {[
            { label: 'Micro Torneo ($0.20)', entry: '$0.20/jugador', example: '6 jug. = $1.20 | 10 jug. = $2.00', color: 'border-emerald-500/40 text-emerald-400' },
            { label: 'Copa Caracas ($0.50)', entry: '$0.50/jugador', example: '8 jug. = $4.00 | 15 jug. = $7.50', color: 'border-cyan-500/40 text-cyan-400' },
            { label: 'Gladiadores ($1.00)', entry: '$1.00/jugador', example: '10 jug. = $10.00 | 15 jug. = $15.00', color: 'border-fuchsia-500/40 text-fuchsia-400' },
            { label: 'Master Clash ($5.00)', entry: '$5.00/jugador', example: '5 jug. = $25.00 | 12 jug. = $60.00', color: 'border-yellow-500/40 text-yellow-400' },
          ].map((stake, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-2xl bg-[#080b20]/80 border border-slate-800 hover:border-slate-700 flex flex-col justify-between transition-all"
            >
              <div>
                <span className="text-[10px] text-slate-400 font-mono-tech block">{stake.label}</span>
                <span className="text-xs font-bold font-orbitron text-white">Entrada {stake.entry}</span>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-slate-800/50">
                <span className="text-[9px] text-slate-400 font-mono-tech block">Pote Dinámico (N° Jugadores × Entrada):</span>
                <span className={`text-[11px] font-bold font-orbitron ${stake.color}`}>{stake.example}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid: Active Rooms & Global Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Rooms Tournament Hub */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-orbitron font-extrabold text-lg text-white">
                Salas de Torneo y Matchmaking
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-xs font-mono-tech shadow-[0_0_8px_rgba(6,182,212,0.25)]">
                {rooms.length} Salas
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-[#090d24]/90 border border-slate-800 rounded-2xl overflow-x-auto">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-orbitron font-bold transition-all whitespace-nowrap ${
                  activeFilter === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setActiveFilter('public')}
                className={`px-3 py-1.5 rounded-xl text-xs font-orbitron font-bold transition-all whitespace-nowrap ${
                  activeFilter === 'public'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Públicas
              </button>
              <button
                onClick={() => setActiveFilter('private')}
                className={`px-3 py-1.5 rounded-xl text-xs font-orbitron font-bold transition-all whitespace-nowrap ${
                  activeFilter === 'private'
                    ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/50 shadow-[0_0_10px_rgba(217,70,239,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Privadas
              </button>
              <button
                onClick={() => setActiveFilter('events')}
                className={`px-3 py-1.5 rounded-xl text-xs font-orbitron font-bold transition-all whitespace-nowrap flex items-center gap-1 ${
                  activeFilter === 'events'
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/60 shadow-[0_0_10px_rgba(234,179,8,0.3)]'
                    : 'text-amber-400/80 hover:text-yellow-300'
                }`}
              >
                <span>🎉 Eventos</span>
              </button>
            </div>
          </div>

          {/* Rooms List */}
          <div className="space-y-3">
            {filteredRooms.map((room) => {
              const winnerReward = room.potUSD * (exchangeRates.winnerPotPercent / 100);
              const countdownSec = room.nextLaunchSeconds ?? 300;
              const mins = Math.floor(countdownSec / 60);
              const secs = countdownSec % 60;
              const formattedCountdown = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              const isEvent = !!room.isSpecialEvent;

              return (
                <div
                  key={room.id}
                  className={`p-4 sm:p-5 rounded-3xl border transition-all shadow-lg flex flex-col justify-between gap-4 group ${
                    isEvent
                      ? 'bg-gradient-to-br from-[#0c102e] to-[#1e1708] border-yellow-500/60 shadow-[0_0_25px_rgba(234,179,8,0.15)] hover:border-yellow-400'
                      : 'bg-[#0a0e28]/85 border-slate-800/90 hover:border-cyan-500/50'
                  }`}
                >
                  {/* Event Ribbon (if Special Event) */}
                  {isEvent && (
                    <div className="p-2 rounded-xl bg-gradient-to-r from-yellow-500/20 via-amber-500/20 to-yellow-600/20 border border-yellow-500/40 flex items-center justify-between text-xs">
                      <span className="font-orbitron font-bold text-yellow-300 flex items-center gap-1.5 text-[11px]">
                        <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                        🎉 TORNEO OFICIAL / EVENTO ESPECIAL
                      </span>
                      {room.sponsorName && (
                        <span className="px-2 py-0.5 rounded-full bg-yellow-400 text-slate-950 font-mono-tech font-bold text-[10px]">
                          {room.sponsorName}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                          isEvent
                            ? 'bg-amber-950/60 border-yellow-500/60 text-yellow-400 shadow-[0_0_18px_rgba(234,179,8,0.35)]'
                            : room.type === 'private'
                            ? 'bg-purple-950/60 border-purple-500/50 text-purple-300 shadow-[0_0_18px_rgba(168,85,247,0.35)]'
                            : 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300 shadow-[0_0_18px_rgba(6,182,212,0.35)]'
                        }`}
                      >
                        {isEvent ? <Trophy className="w-5 h-5" /> : room.type === 'private' ? <Lock className="w-5 h-5" /> : <Globe className="w-5 h-5" />}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className={`font-orbitron font-bold text-sm sm:text-base text-white transition-colors ${
                            isEvent ? 'group-hover:text-yellow-300' : 'group-hover:text-cyan-300'
                          }`}>
                            {room.name}
                          </h3>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-mono-tech font-bold uppercase ${
                              room.status === 'in_game'
                                ? 'bg-rose-950/80 text-rose-300 border border-rose-500/50 animate-pulse shadow-[0_0_8px_#f43f5e]'
                                : room.cancelled && room.status === 'finished'
                                ? 'bg-slate-800 text-slate-400 border border-slate-600/60'
                                : 'bg-amber-950/80 text-amber-300 border border-amber-500/50'
                            }`}
                          >
                            {room.status === 'in_game'
                              ? 'En Combate'
                              : room.cancelled && room.status === 'finished'
                              ? '✖️ Cancelada • Reembolso'
                              : '⏳ Esperando'}
                          </span>
                          {room.status === 'waiting' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 font-mono-tech font-bold">
                              ⏱️ Lanzamiento: {formattedCountdown}
                            </span>
                          )}
                        </div>

                        {room.eventDescription && (
                          <p className="text-xs text-amber-200/90 font-sans mt-1">
                            📢 {room.eventDescription}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400 font-mono-tech">
                          <span className="flex items-center gap-1 text-emerald-400 font-bold">
                            <Users className="w-3.5 h-3.5 text-emerald-400" />
                            {room.currentPlayers}/{room.maxPlayers} Inscritos (Min 4)
                          </span>
                          <span>•</span>
                          <span>Código: <strong className="text-white font-orbitron">{room.code}</strong></span>
                          <span>•</span>
                          <span>Host: {room.hostName}</span>
                        </div>
                      </div>
                    </div>

                    {/* Pot & Join Button */}
                    <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-slate-400 font-mono-tech block">
                          Pote Acumulado:
                        </span>
                        <p className="font-orbitron font-black text-base sm:text-lg text-yellow-400 shadow-[0_0_12px_rgba(234,179,8,0.2)]">
                          ${room.potUSD.toFixed(2)} USD
                        </p>
                        <span className="text-[10px] text-amber-300 font-mono-tech block font-semibold">
                          🏆 80% Ganador: ${winnerReward.toFixed(2)}
                        </span>
                      </div>

                      <button
                        onClick={() => handleJoinClick(room)}
                        className={`px-5 py-3 rounded-2xl text-slate-950 font-orbitron font-extrabold text-xs tracking-wider transition-all flex items-center gap-1.5 cursor-pointer hover:brightness-110 ${
                          isEvent
                            ? 'bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.5)]'
                            : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-slate-950" />
                        <span>{room.entryFeeUSD === 0 ? 'ENTRAR GRATIS' : `INSCRIBIRSE ($${room.entryFeeUSD.toFixed(2)})`}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Dynamic Global Leaderboard */}
        <div className="lg:col-span-1 bg-[#090c24]/90 border-2 border-yellow-500/40 rounded-3xl p-5 sm:p-6 shadow-[0_0_30px_rgba(234,179,8,0.2)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-yellow-500 to-amber-300 p-[1px] shadow-[0_0_12px_rgba(234,179,8,0.4)]">
                  <div className="w-full h-full bg-[#080816] rounded-[15px] flex items-center justify-center text-yellow-400">
                    <Trophy className="w-4 h-4" />
                  </div>
                </div>
                <div>
                  <h3 className="font-orbitron font-extrabold text-sm text-white">Top Jugadores</h3>
                  <p className="text-[10px] text-slate-400 font-mono-tech">Ranking Global & Ganancias</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {leaderboard.map((user) => (
                <div
                  key={user.id}
                  className="p-3 rounded-2xl bg-[#0c102a]/80 border border-slate-800 hover:border-amber-500/40 flex items-center justify-between gap-2 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-6 h-6 rounded-full font-orbitron font-extrabold text-xs flex items-center justify-center ${
                        user.rank === 1
                          ? 'bg-yellow-400 text-black shadow-[0_0_10px_#eab308]'
                          : user.rank === 2
                          ? 'bg-slate-300 text-black'
                          : user.rank === 3
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {user.rank}
                    </span>
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-8 h-8 rounded-xl object-cover border border-cyan-500/40"
                    />
                    <div className="min-w-0">
                      <p className="font-orbitron font-bold text-xs text-white truncate max-w-[100px]">
                        {user.name}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono-tech">
                        {user.wins} victorias
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-orbitron font-black text-xs text-yellow-400 block">
                      ${user.totalEarningsUSD.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono-tech">USD Ganados</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <p className="text-[11px] text-slate-400 font-mono-tech mb-2">
              ¿Listo para el próximo torneo?
            </p>
            <button
              onClick={() => handleJoinClick(rooms[0])}
              className="w-full py-3 rounded-2xl bg-[#10163a] hover:bg-[#161f52] border border-cyan-400/40 text-cyan-300 font-orbitron font-bold text-xs transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] cursor-pointer"
            >
              INSCRIBIRSE AL TORNEO FLASH ($0.20)
            </button>
          </div>
        </div>
      </div>

      {/* MATCHMAKING WAITING ROOM MODAL */}
      {currentModalRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-lg animate-fade-in">
          <div className="relative w-full max-w-xl bg-gradient-to-b from-[#0e1438] to-[#070a1e] border-2 border-cyan-400/70 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.4)] text-slate-100 space-y-6">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-400/50 text-cyan-300 text-[11px] font-orbitron font-bold mb-2">
                  <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span>SALA DE ESPERA • LANZAMIENTO CADA 5 MINUTOS</span>
                </div>
                <h3 className="font-orbitron font-black text-xl text-white">
                  {currentModalRoom.name}
                </h3>
                <p className="text-xs text-slate-400 font-mono-tech">
                  Código de Sala: <strong className="text-cyan-300">{currentModalRoom.code}</strong> • Host: {currentModalRoom.hostName}
                </p>
              </div>

              {/* 5-Min Countdown Display */}
              <div className="text-center p-3 rounded-2xl bg-[#090d24] border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <span className="text-[10px] text-slate-400 font-mono-tech block">Próxima Partida</span>
                <span className="font-orbitron font-black text-xl text-cyan-300">
                  {Math.floor((currentModalRoom.nextLaunchSeconds ?? 300) / 60)
                    .toString()
                    .padStart(2, '0')}
                  :
                  {((currentModalRoom.nextLaunchSeconds ?? 300) % 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Pot Breakdown & Non-refundable Rule */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-[#080c22] border border-slate-800">
              <div>
                <span className="text-[10px] text-slate-400 font-mono-tech block">Entrada por Jugador:</span>
                <span className="font-orbitron font-black text-sm text-cyan-300">
                  ${currentModalRoom.entryFeeUSD.toFixed(2)} USD
                </span>
                <span className="text-[9px] text-slate-400 font-mono-tech block mt-0.5">
                  ({(currentModalRoom.registeredPlayers || []).length} jugadores × ${currentModalRoom.entryFeeUSD.toFixed(2)})
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-mono-tech block">Pote Recaudado Total:</span>
                <span className="font-orbitron font-black text-sm text-yellow-400">
                  ${currentModalRoom.potUSD.toFixed(2)} USD
                </span>
                <span className="text-[9px] text-slate-400 font-mono-tech block mt-0.5">
                  Bs. {(currentModalRoom.potUSD * exchangeRates.vesUsdRate).toLocaleString('es-VE', { maximumFractionDigits: 1 })}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-[10px] text-slate-400 font-mono-tech block">Premio Ganador (80%):</span>
                <span className="font-orbitron font-black text-sm text-emerald-400">
                  ${(currentModalRoom.potUSD * (exchangeRates.winnerPotPercent / 100)).toFixed(2)} USD
                </span>
                <span className="text-[9px] text-cyan-400 font-mono-tech block mt-0.5">Retiro inmediato Pago Móvil</span>
              </div>
            </div>

            {/* Registered Players (Dynamic Quorum) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-orbitron font-bold text-xs text-slate-200 flex items-center gap-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span>
                    Gladiadores en la Sala ({(currentModalRoom.registeredPlayers || []).length || currentModalRoom.currentPlayers}/{currentModalRoom.maxPlayers} Capacidad)
                  </span>
                </h4>
                <span className={`text-[11px] font-mono-tech font-bold ${(currentModalRoom.registeredPlayers || []).length >= (currentModalRoom.minPlayersToStart || 4) ? 'text-emerald-400' : 'text-amber-400'}`}>
                  ✓ {(currentModalRoom.registeredPlayers || []).length >= (currentModalRoom.minPlayersToStart || 4)
                    ? `¡Quórum de ${(currentModalRoom.registeredPlayers || []).length} Gladiadores Listo!`
                    : `Esperando mínimo ${currentModalRoom.minPlayersToStart || 4} jugadores`}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-48 overflow-y-auto pr-1">
                {(() => {
                  // Build the definitive list of players to display:
                  // 1. Use registeredPlayers from Firestore if available
                  // 2. Always include the current user if they are in this room
                  // 3. Never show fake placeholder players
                  const registered = currentModalRoom.registeredPlayers || [];
                  const displayPlayers = registered.length > 0
                    ? registered
                    : currentUser
                      ? [{ id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar, ready: true, isUser: true }]
                      : [];

                  if (displayPlayers.length === 0) {
                    return (
                      <div className="col-span-full text-center py-4 text-slate-400 text-xs font-mono-tech">
                        Esperando gladiadores...
                      </div>
                    );
                  }

                  return displayPlayers.map((player) => (
                    <div
                      key={player.id}
                      className={`p-2.5 rounded-2xl border flex flex-col items-center text-center transition-all ${
                        player.isUser || player.id === currentUser?.id
                          ? 'bg-cyan-950/60 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                          : 'bg-[#0a0e28] border-slate-800'
                      }`}
                    >
                      <div className="relative mb-1.5">
                        <img
                          src={player.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.name)}`}
                          alt={player.name}
                          className="w-9 h-9 rounded-xl object-cover border border-cyan-400/60"
                        />
                        <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border border-slate-900 flex items-center justify-center text-[8px] text-slate-950 font-black">
                          ✓
                        </span>
                      </div>
                      <span className="font-orbitron font-bold text-[11px] text-white truncate max-w-full">
                        {player.name}
                      </span>
                      <span className="text-[9px] text-emerald-400 font-mono-tech">LISTO</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Synchronized Launch Status */}
            <div className="pt-2 flex flex-col items-center gap-3">
              <p className="text-center text-xs text-cyan-300 font-mono-tech">
                El combate comenzará automáticamente cuando termine el contador y se alcance el mínimo de jugadores.
              </p>
              <button
                type="button"
                id="leave-room-btn"
                onClick={() => {
                  if (currentModalRoom) leaveRoom(currentModalRoom.id);
                  setWaitingRoomModal(null);
                }}
                className="w-full px-5 py-3.5 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 hover:brightness-110 text-white font-orbitron font-bold text-xs tracking-wider transition-all shadow-[0_0_20px_rgba(244,63,94,0.35)] cursor-pointer"
              >
                SALIR DE LA SALA (REEMBOLSO AUTOMÁTICO)
              </button>
              <button
                type="button"
                onClick={() => setWaitingRoomModal(null)}
                className="w-full px-5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron font-bold text-[11px] transition-all cursor-pointer"
              >
                MANTENERME EN LA SALA Y CERRAR VISTA PREVIA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ROOM MODAL ($0.20 - $5.00) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-[#090c24] border-2 border-cyan-500/50 rounded-3xl p-6 shadow-[0_0_40px_rgba(6,182,212,0.3)] text-slate-100">
            <h3 className="font-orbitron font-extrabold text-lg text-white mb-1">
              Crear Sala de Torneo
            </h3>
            <p className="text-xs text-slate-400 font-mono-tech mb-4">
              Configura tu sala (Rango permitido: ${gameConfig.minEntryFeeUSD.toFixed(2)} - ${gameConfig.maxEntryFeeUSD.toFixed(2)} USD)
            </p>

            <form onSubmit={handleCreateRoomSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nombre de la Sala
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tipo de Sala
                  </label>
                  <select
                    value={roomType}
                    onChange={(e) => setRoomType(e.target.value as any)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="public">Pública (Matchmaking)</option>
                    <option value="private">Privada con Código</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Precio Entrada (USD)
                  </label>
                  <input
                    type="number"
                    min={gameConfig.minEntryFeeUSD}
                    max={gameConfig.maxEntryFeeUSD}
                    step="0.10"
                    value={entryFeeUSD}
                    onChange={(e) => setEntryFeeUSD(Math.max(0.20, parseFloat(e.target.value) || 0.20))}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-cyan-400 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* Quick Fee Presets ($0.20 - $5.00) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Montos Rápidos Permitidos:
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0.20, 0.50, 1.00, 2.00, 5.00].map((fee) => (
                    <button
                      key={fee}
                      type="button"
                      onClick={() => setEntryFeeUSD(fee)}
                      className={`py-1.5 rounded-lg text-xs font-orbitron font-bold border transition-all cursor-pointer ${
                        entryFeeUSD === fee
                          ? 'bg-cyan-500 text-black border-cyan-400 font-extrabold shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                          : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-400/50'
                      }`}
                    >
                      ${fee.toFixed(2)}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 font-mono-tech mt-1">
                  * Montos mayores son configurables exclusivamente por el Administrador para eventos especiales.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Capacidad Máxima de Jugadores en Sala
                </label>
                <select
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-cyan-400 focus:outline-none font-mono-tech"
                >
                  <option value={4}>4 Jugadores (Pote Base 4 jug: ${(entryFeeUSD * 4).toFixed(2)})</option>
                  <option value={6}>6 Jugadores (Pote Máx: ${(entryFeeUSD * 6).toFixed(2)})</option>
                  <option value={8}>8 Jugadores (Pote Máx: ${(entryFeeUSD * 8).toFixed(2)})</option>
                  <option value={10}>10 Jugadores (Pote Máx: ${(entryFeeUSD * 10).toFixed(2)})</option>
                  <option value={12}>12 Jugadores (Pote Máx: ${(entryFeeUSD * 12).toFixed(2)})</option>
                  <option value={15}>15 Jugadores (Pote Máx: ${(entryFeeUSD * 15).toFixed(2)})</option>
                </select>
                <p className="text-[10px] text-cyan-400 font-mono-tech mt-1">
                  💡 <strong>Regla del Pote Dinámico:</strong> El pote crece con cada jugador que entra (Ej: Si entran 10 jugadores a ${entryFeeUSD.toFixed(2)}, el pote será ${(entryFeeUSD * 10).toFixed(2)} USD).
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono-tech space-y-1">
                <div className="flex justify-between">
                  <span>🏆 Premio al Ganador (80%):</span>
                  <span className="text-yellow-400 font-bold">
                    80% del Total Recaudado (${(entryFeeUSD * 4 * 0.8).toFixed(2)} con 4 jug. hasta ${(entryFeeUSD * maxPlayers * 0.8).toFixed(2)} con {maxPlayers} jug.)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>⚙️ Plataforma / Mantenimiento:</span>
                  <span className="text-cyan-400">20% del Pote Final</span>
                </div>
                <div className="text-[10px] text-rose-400 pt-1">
                  * La entrada se descuenta de tu saldo al crear/entrar y no se devuelve a menos que ganes el torneo.
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron text-xs font-bold cursor-pointer"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 font-orbitron font-extrabold text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer"
                >
                  CREAR Y ESPERAR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRIVATE CODE PROMPT MODAL */}
      {selectedPrivateRoomId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-sm bg-[#090c24] border-2 border-purple-500/50 rounded-3xl p-6 shadow-2xl text-slate-100 text-center">
            <Lock className="w-10 h-10 text-purple-400 mx-auto mb-2" />
            <h3 className="font-orbitron font-extrabold text-base text-white">
              Sala Privada Protegida
            </h3>
            <p className="text-xs text-slate-400 font-mono-tech mt-0.5 mb-4">
              Ingresa el código de invitación provisto por tus amigos
            </p>

            <form onSubmit={handleJoinPrivateSubmit} className="space-y-4">
              <input
                type="text"
                placeholder="Ej: FLASH-20 o CCS-50"
                value={privateCodeInput}
                onChange={(e) => setPrivateCodeInput(e.target.value)}
                className="w-full py-3 rounded-2xl bg-slate-900 border-2 border-purple-500/60 text-center font-orbitron font-extrabold text-lg tracking-widest text-purple-300 focus:outline-none"
                required
              />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedPrivateRoomId(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-orbitron text-xs font-bold cursor-pointer"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-orbitron font-extrabold text-xs shadow-[0_0_15px_rgba(168,85,247,0.4)] cursor-pointer"
                >
                  INGRESAR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
