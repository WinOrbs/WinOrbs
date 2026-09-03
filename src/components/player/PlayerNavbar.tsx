import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Wallet,
  Bell,
  Volume2,
  VolumeX,
  Shield,
  HelpCircle,
  Sparkles,
  ShoppingBag,
  Trophy,
  LogOut,
  ChevronDown,
  Lock,
  Menu,
  User,
  Gamepad2,
  ExternalLink,
} from 'lucide-react';

interface PlayerNavbarProps {
  currentView?: 'lobby' | 'game' | 'shop';
  onNavigate?: (view: 'lobby' | 'game' | 'shop') => void;
  onOpenWallet: (tab?: 'deposit' | 'withdraw' | 'history') => void;
  onOpenShop?: () => void;
  onOpenVIP: () => void;
  onOpenNotifications: () => void;
  onOpenTutorial: () => void;
  onOpenAuth: () => void;
  onOpenProfile?: () => void;
  onOpenAdminSecurity?: () => void;
  onRequestLogout?: () => void;
  activeTab?: 'lobby' | 'shop' | 'leaderboard';
  setActiveTab?: (tab: 'lobby' | 'shop' | 'leaderboard') => void;
}

export const PlayerNavbar: React.FC<PlayerNavbarProps> = ({
  currentView = 'lobby',
  onNavigate,
  onOpenWallet,
  onOpenShop,
  onOpenVIP,
  onOpenNotifications,
  onOpenTutorial,
  onOpenAuth,
  onOpenProfile,
  onOpenAdminSecurity,
  onRequestLogout,
  activeTab,
  setActiveTab,
}) => {
  const {
    currentUser,
    switchRole,
    isAdminUnlocked,
    isAuthorizedAdmin,
    soundEnabled,
    setSoundEnabled,
    exchangeRates,
    unreadNotificationsCount,
    logout,
  } = useApp();

  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentTab = activeTab || (currentView === 'shop' ? 'shop' : 'lobby');

  // Close dropdown menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleTabClick = (tab: 'lobby' | 'shop' | 'leaderboard') => {
    setIsMenuOpen(false);
    if (setActiveTab) {
      setActiveTab(tab);
    }
    if (onNavigate) {
      if (tab === 'shop') {
        onNavigate('shop');
      } else {
        onNavigate('lobby');
      }
    } else if (tab === 'shop' && onOpenShop) {
      onOpenShop();
    }
  };

  const handleAdminAccess = () => {
    setIsMenuOpen(false);
    if (isAuthorizedAdmin && isAdminUnlocked) {
      switchRole('admin');
    } else if (onOpenAdminSecurity) {
      onOpenAdminSecurity();
    } else if (onOpenAuth) {
      onOpenAuth();
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#070712]/95 border-b border-cyan-500/25 backdrop-blur-xl shadow-[0_4px_30px_rgba(0,0,0,0.7)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            onClick={() => handleTabClick('lobby')}
            className="cursor-pointer flex items-center gap-2 sm:gap-2.5 group"
          >
            <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-cyan-400 via-fuchsia-500 to-amber-400 p-[2px] shadow-[0_0_20px_rgba(6,182,212,0.6)] group-hover:shadow-[0_0_30px_rgba(217,70,239,0.8)] transition-all">
              <div className="w-full h-full bg-[#080816] rounded-[12px] sm:rounded-[14px] flex items-center justify-center">
                <span className="font-orbitron font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 text-xs sm:text-lg">
                  .IO
                </span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="font-orbitron font-extrabold text-xs sm:text-base tracking-wider text-white">
                  Win<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400">Orbs</span>
                </span>
                <span className="hidden sm:inline-block text-[10px] font-mono-tech px-1.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-400/40 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                  v2.5
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono-tech hidden sm:block">
                Torneo Multijugador & Premios 80/20
              </p>
            </div>
          </div>
        </div>

        {/* Right Controls: Balance + Notifications + Dropdown Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Balance Widget (Quick Access) */}
          {currentUser && (
            <button
              id="user-balance-badge"
              type="button"
              onClick={() => onOpenWallet('deposit')}
              className="cursor-pointer group flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-2xl bg-gradient-to-r from-slate-900/90 to-[#0b102c]/90 hover:from-slate-800 hover:to-[#101740] border border-cyan-500/40 hover:border-cyan-400 transition-all shadow-[0_0_18px_rgba(6,182,212,0.2)] text-left"
              title="Tu Saldo • Clic para Recargar o Retirar"
            >
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-300 group-hover:scale-110 transition-transform">
                <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <span className="font-orbitron font-extrabold text-xs sm:text-sm text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-emerald-300">
                    ${currentUser.balanceUSD.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono-tech">USD</span>
                </div>
                <div className="text-[9px] text-slate-400 font-mono-tech leading-none hidden xs:block">
                  ≈ Bs. {(currentUser.balanceUSD * exchangeRates.vesUsdRate).toLocaleString('es-VE', { maximumFractionDigits: 1 })}
                </div>
              </div>
            </button>
          )}

          {/* Notifications Bell with unread counter */}
          <button
            id="nav-notifications-btn"
            type="button"
            onClick={onOpenNotifications}
            className="relative p-2 sm:p-2.5 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 transition-colors cursor-pointer"
            title="Notificaciones Push"
          >
            <Bell className="w-4 h-4 text-cyan-400" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 border-2 border-[#080a18] text-white text-[9px] sm:text-[10px] font-bold flex items-center justify-center animate-pulse shadow-[0_0_8px_#f43f5e]">
                {unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* If NOT logged in: Quick Login Button */}
          {!currentUser && (
            <button
              id="nav-login-btn"
              type="button"
              onClick={onOpenAuth}
              className="px-3 sm:px-4 py-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 text-slate-950 font-orbitron font-black text-xs shadow-[0_0_20px_rgba(6,182,212,0.5)] hover:shadow-[0_0_30px_rgba(217,70,239,0.7)] transition-all cursor-pointer"
            >
              INGRESAR
            </button>
          )}

          {/* MAIN DROPDOWN MENU TRIGGER (All Buttons Consolidated Here) */}
          <div className="relative" ref={menuRef}>
            <button
              id="nav-main-menu-trigger-btn"
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all cursor-pointer ${
                isMenuOpen
                  ? 'bg-gradient-to-r from-cyan-500/25 to-fuchsia-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                  : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700/80 text-slate-200 shadow-[0_0_12px_rgba(0,0,0,0.3)]'
              }`}
              title="Abrir Menú de Opciones y Navegación"
            >
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <img
                      src={currentUser.avatar}
                      alt={currentUser.name}
                      className="w-6 h-6 sm:w-7 sm:h-7 rounded-xl object-cover border border-cyan-400/70 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-slate-950" />
                  </div>
                  <span className="hidden sm:inline font-orbitron font-bold text-xs text-white max-w-[80px] truncate">
                    {currentUser.name}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Menu className="w-4 h-4 text-cyan-400" />
                  <span className="font-orbitron font-bold text-xs hidden sm:inline text-white">MENÚ</span>
                </div>
              )}
              <ChevronDown
                className={`w-4 h-4 text-cyan-400 transition-transform duration-200 ${
                  isMenuOpen ? 'rotate-180 text-cyan-300' : ''
                }`}
              />
            </button>

            {/* DESPLEGABLE / DROPDOWN MENU LIST */}
            {isMenuOpen && (
              <div
                id="nav-dropdown-menu-list"
                className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-3xl bg-[#090c24]/98 border-2 border-cyan-500/40 shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_30px_rgba(6,182,212,0.25)] backdrop-blur-2xl p-3 text-slate-200 z-50 animate-fade-in divide-y divide-slate-800/80"
              >
                {/* User Header in Dropdown (if logged in) */}
                {currentUser ? (
                  <div className="pb-3 px-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={currentUser.avatar}
                        alt={currentUser.name}
                        className="w-10 h-10 rounded-2xl object-cover border border-cyan-400"
                      />
                      <div className="min-w-0">
                        <div className="font-orbitron font-bold text-xs text-white truncate">
                          {currentUser.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono-tech truncate">
                          {currentUser.email}
                        </div>
                        <div className="text-[10px] text-emerald-400 font-mono-tech">
                          ● Firestore Sincronizado
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        if (onOpenProfile) onOpenProfile();
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 transition-colors"
                      title="Editar Perfil"
                    >
                      <User className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="pb-3 px-2 flex items-center justify-between">
                    <div>
                      <span className="font-orbitron font-bold text-xs text-white">Modo Invitado</span>
                      <p className="text-[10px] text-slate-400">Inicia sesión para competir por dinero real</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenAuth();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-cyan-500 text-slate-950 font-orbitron font-bold text-[11px]"
                    >
                      Entrar
                    </button>
                  </div>
                )}

                {/* Section 1: Navigation Views */}
                <div className="py-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-orbitron font-bold tracking-wider text-slate-400 uppercase">
                    Navegación del Juego
                  </div>

                  <button
                    id="dropdown-tab-lobby"
                    type="button"
                    onClick={() => handleTabClick('lobby')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold transition-all cursor-pointer ${
                      currentTab === 'lobby'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                        : 'hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Gamepad2 className="w-4 h-4 text-cyan-400" />
                      <span>Salas & Torneos</span>
                    </div>
                    {currentTab === 'lobby' && (
                      <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                    )}
                  </button>

                  <button
                    id="dropdown-tab-shop"
                    type="button"
                    onClick={() => handleTabClick('shop')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold transition-all cursor-pointer ${
                      currentTab === 'shop'
                        ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 shadow-[0_0_12px_rgba(217,70,239,0.2)]'
                        : 'hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ShoppingBag className="w-4 h-4 text-fuchsia-400" />
                      <span>Tienda de Skins</span>
                    </div>
                    {currentTab === 'shop' && (
                      <span className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_#e879f9]" />
                    )}
                  </button>

                  <button
                    id="dropdown-tab-leaderboard"
                    type="button"
                    onClick={() => handleTabClick('leaderboard')}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold transition-all cursor-pointer ${
                      currentTab === 'leaderboard'
                        ? 'bg-amber-500/20 text-yellow-300 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                        : 'hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Trophy className="w-4 h-4 text-amber-400" />
                      <span>Ranking Global</span>
                    </div>
                    {currentTab === 'leaderboard' && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                    )}
                  </button>
                </div>

                {/* Section 2: Finances & VIP */}
                <div className="py-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-orbitron font-bold tracking-wider text-slate-400 uppercase">
                    Finanzas & Beneficios
                  </div>

                  <button
                    id="dropdown-wallet-btn"
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenWallet('deposit');
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold hover:bg-slate-800/80 text-slate-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                      <span>Billetera (Recargar / Retirar)</span>
                    </div>
                    <span className="text-[10px] font-mono-tech text-emerald-400">
                      {currentUser ? `$${currentUser.balanceUSD.toFixed(2)}` : 'Bs. / USDT'}
                    </span>
                  </button>

                  <button
                    id="dropdown-vip-btn"
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenVIP();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold hover:bg-slate-800/80 text-yellow-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-yellow-400" />
                      <span>Pases VIP Neón</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                      {currentUser?.vipTier === 'vip_titan'
                        ? 'TITÁN'
                        : currentUser?.vipTier === 'vip_neon'
                        ? 'NEÓN'
                        : 'EXPLORAR'}
                    </span>
                  </button>
                </div>

                {/* Section 3: Audio & Tutorial */}
                <div className="py-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-orbitron font-bold tracking-wider text-slate-400 uppercase">
                    Ajustes & Ayuda
                  </div>

                  <button
                    id="dropdown-sound-toggle-btn"
                    type="button"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold hover:bg-slate-800/80 text-slate-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      {soundEnabled ? (
                        <Volume2 className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <VolumeX className="w-4 h-4 text-slate-500" />
                      )}
                      <span>Sonido / Sintetizador</span>
                    </div>
                    <span
                      className={`text-[10px] font-mono-tech px-2 py-0.5 rounded ${
                        soundEnabled
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {soundEnabled ? 'ACTIVO' : 'MUDO'}
                    </span>
                  </button>

                  <button
                    id="dropdown-tutorial-btn"
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenTutorial();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold hover:bg-slate-800/80 text-slate-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <HelpCircle className="w-4 h-4 text-amber-400" />
                      <span>Guía & Tutorial de Batalla</span>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                  </button>
                </div>

                {/* Section 4: Admin & Profile & Logout */}
                <div className="pt-2 space-y-1">
                  {/* Admin Access Option */}
                  <button
                    id="dropdown-admin-panel-btn"
                    type="button"
                    onClick={handleAdminAccess}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-200 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      {isAdminUnlocked && isAuthorizedAdmin ? (
                        <Shield className="w-4 h-4 text-purple-300" />
                      ) : (
                        <Lock className="w-4 h-4 text-purple-400" />
                      )}
                      <span>Panel de Administrador</span>
                    </div>
                    <span className="text-[10px] font-mono-tech text-purple-300">
                      {isAdminUnlocked && isAuthorizedAdmin ? 'SUPERVISOR' : 'PIN'}
                    </span>
                  </button>

                  {/* Profile & Logout if user exists */}
                  {currentUser ? (
                    <>
                      <button
                        id="dropdown-profile-btn"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (onOpenProfile) onOpenProfile();
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold hover:bg-slate-800/80 text-cyan-300 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <User className="w-4 h-4 text-cyan-400" />
                          <span>Datos de Perfil & Banco</span>
                        </div>
                      </button>

                      <button
                        id="dropdown-logout-btn"
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (onRequestLogout) {
                            onRequestLogout();
                          } else {
                            logout();
                          }
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-orbitron font-bold bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <LogOut className="w-4 h-4 text-rose-400" />
                          <span>Cerrar Sesión</span>
                        </div>
                      </button>
                    </>
                  ) : (
                    <button
                      id="dropdown-auth-btn"
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenAuth();
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-orbitron font-bold bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 transition-all cursor-pointer"
                    >
                      <span>INICIAR SESIÓN / REGISTRO</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

