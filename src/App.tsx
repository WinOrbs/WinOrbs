import React, { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { PlayerNavbar } from './components/player/PlayerNavbar';
import { LobbyView } from './components/player/LobbyView';
import { CosmeticsShop } from './components/player/CosmeticsShop';
import { NeonGameCanvas } from './components/game/NeonGameCanvas';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { WalletModal } from './components/player/WalletModal';
import { VIPSubscriptionModal } from './components/player/VIPSubscriptionModal';
import { TutorialModal } from './components/player/TutorialModal';
import { NotificationsDrawer } from './components/player/NotificationsDrawer';
import { AuthModal } from './components/auth/AuthModal';
import { LogoutConfirmModal } from './components/auth/LogoutConfirmModal';
import { ProfileModal } from './components/player/ProfileModal';
import { AdminSecurityModal } from './components/admin/AdminSecurityModal';
import { TournamentRoom } from './types';
import { isLocalAuthFallback } from './services/firebase';

const MainAppContent: React.FC = () => {
  const { currentRole, activeRoom, leaveRoom, isAdminUnlocked, isAuthorizedAdmin, joinRoom } = useApp();

  // Navigation views: 'lobby' | 'game' | 'shop'
  const [currentView, setCurrentView] = useState<'lobby' | 'game' | 'shop'>('lobby');

  // Auto-route: if a Firestore snapshot reports that the user's registered
  // room just transitioned to in_game (refresh, "close preview" button,
  // background tab coming back to life), jump straight to the game view.
  // This is independent of the lobby waiting-room modal so closing the
  // preview no longer strands the user on the lobby while a match runs.
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'in_game') return;
    if (currentView === 'game') return;
    setCurrentView('game');
  }, [activeRoom?.id, activeRoom?.status, currentView]);

  // If the match ended while the user was elsewhere, fall back to lobby.
  // (activeRoom becomes null once leaveRoom runs or the room is recycled.)
  useEffect(() => {
    if (currentView === 'game' && !activeRoom) {
      setCurrentView('lobby');
    }
  }, [activeRoom, currentView]);

  // Modals state
  const [showWalletModal, setShowWalletModal] = useState<boolean>(false);
  const [walletInitialTab, setWalletInitialTab] = useState<'deposit' | 'withdraw' | 'history'>('deposit');
  const [showVipModal, setShowVipModal] = useState<boolean>(false);
  const [showTutorialModal, setShowTutorialModal] = useState<boolean>(false);
  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [showAdminSecurityModal, setShowAdminSecurityModal] = useState<boolean>(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState<boolean>(false);

  const { logout } = useApp();

  // If in Admin Mode, render the isolated Admin Super-Dashboard ONLY if unlocked and authorized.
  // NOTE: computed here but returned AFTER every hook call below — returning early
  // before a hook would violate the Rules of Hooks and crash React into a black
  // screen the moment the admin PIN unlocks the role switch.
  const showAdminDashboard = currentRole === 'admin' && isAdminUnlocked && isAuthorizedAdmin;

  const handleConfirmLogout = () => {
    if (currentView === 'game') {
      leaveRoom();
      setCurrentView('lobby');
    }
    logout();
  };

  const handleStartGame = useCallback((room: TournamentRoom) => {
    // joinRoom is now idempotent: rejoins are free (no double entry fee) and it
    // blocks rooms that already launched. It also keeps activeRoom in sync.
    const joined = joinRoom(room.id);
    if (!joined) return;
    setCurrentView('game');
  }, [joinRoom]);

  const handleExitGame = () => {
    leaveRoom();
    setCurrentView('lobby');
  };

  const handleOpenWalletWithTab = (tab: 'deposit' | 'withdraw' | 'history') => {
    setWalletInitialTab(tab);
    setShowWalletModal(true);
  };

  if (showAdminDashboard) {
    return <AdminDashboard />;
  }

  return (
    <div className="min-h-screen bg-[#05050a] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black relative overflow-x-hidden">
      {/* Vibrant Ambient Glow Layers */}
      <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-fuchsia-600/10 blur-[130px] pointer-events-none z-0" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-600/10 blur-[130px] pointer-events-none z-0" />
      <div className="fixed top-[40%] right-[10%] w-[400px] h-[400px] rounded-full bg-purple-600/10 blur-[140px] pointer-events-none z-0" />

      {/* Player Navigation Header (hidden when in active full-screen match for immersion) */}
      {currentView !== 'game' && (
        <>
          {isLocalAuthFallback && (
            <div className="bg-amber-500/10 border-b border-amber-500/40 text-amber-200 text-xs font-mono-tech text-center py-2 px-4">
              ⚠️ Modo de reserva local activo: Firebase no está configurado. Los datos se guardan localmente y no están protegidos por servidor. Configura tu API key de Firebase para producción.
            </div>
          )}
          <PlayerNavbar
            currentView={currentView}
            onNavigate={(view) => setCurrentView(view)}
            onOpenWallet={() => handleOpenWalletWithTab('deposit')}
            onOpenVIP={() => setShowVipModal(true)}
            onOpenTutorial={() => setShowTutorialModal(true)}
            onOpenNotifications={() => setShowNotificationsDrawer(true)}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenProfile={() => setShowProfileModal(true)}
            onOpenAdminSecurity={() => setShowAdminSecurityModal(true)}
            onRequestLogout={() => setShowLogoutConfirmModal(true)}
          />
        </>
      )}

      {/* Main View Area */}
      <main className="flex-1 flex flex-col relative z-10">
        {currentView === 'lobby' && (
          <LobbyView
            onStartGame={handleStartGame}
            onOpenWallet={() => handleOpenWalletWithTab('deposit')}
            onOpenTutorial={() => setShowTutorialModal(true)}
            onOpenAdminSecurity={() => setShowAdminSecurityModal(true)}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenVIP={() => setShowVipModal(true)}
            onOpenShop={() => setCurrentView('shop')}
          />
        )}

        {currentView === 'shop' && <CosmeticsShop />}

        {currentView === 'game' && activeRoom && (
          <NeonGameCanvas
            room={activeRoom}
            onExit={handleExitGame}
          />
        )}
      </main>

      {/* Footer (hidden during active gameplay) */}
      {currentView !== 'game' && (
        <footer className="mt-auto py-6 border-t border-slate-900/80 bg-[#070712]/90 backdrop-blur-md text-center text-xs text-slate-400 font-mono-tech relative z-10">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
              <span className="text-slate-300 break-words">Servidores WinOrbs Operativos • Tasa Pago Móvil y Binance USDT Conectados</span>
            </div>
            <div className="flex items-center gap-4 text-[11px]">
              <span className="text-yellow-400 font-bold">80% Ganador / 20% Mantenimiento</span>
              <span className="text-slate-600">•</span>
              <button
                onClick={() => setShowTutorialModal(true)}
                className="text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
              >
                Reglas del Juego
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Global Modals & Drawers */}
      <WalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        initialTab={walletInitialTab}
      />

      <VIPSubscriptionModal
        isOpen={showVipModal}
        onClose={() => setShowVipModal(false)}
      />

      <TutorialModal
        isOpen={showTutorialModal}
        onClose={() => setShowTutorialModal(false)}
      />

      <NotificationsDrawer
        isOpen={showNotificationsDrawer}
        onClose={() => setShowNotificationsDrawer(false)}
        onOpenWallet={() => handleOpenWalletWithTab('history')}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onOpenTutorial={() => setShowTutorialModal(true)}
      />

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onRequestLogout={() => {
          setShowProfileModal(false);
          setShowLogoutConfirmModal(true);
        }}
      />

      <LogoutConfirmModal
        isOpen={showLogoutConfirmModal}
        onClose={() => setShowLogoutConfirmModal(false)}
        onConfirm={handleConfirmLogout}
        isGameActive={currentView === 'game'}
      />

      <AdminSecurityModal
        isOpen={showAdminSecurityModal}
        onClose={() => setShowAdminSecurityModal(false)}
        onSuccess={() => {
          setShowAdminSecurityModal(false);
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}
