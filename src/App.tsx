import React, { useState } from 'react';
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
  const { currentRole, activeRoom, leaveRoom, rooms, isAdminUnlocked, isAuthorizedAdmin, joinRoom } = useApp();

  // Navigation views: 'lobby' | 'game' | 'shop'
  const [currentView, setCurrentView] = useState<'lobby' | 'game' | 'shop'>('lobby');

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

  const handleConfirmLogout = () => {
    if (currentView === 'game') {
      leaveRoom();
      setCurrentView('lobby');
    }
    logout();
  };

  // If in Admin Mode, render the isolated Admin Super-Dashboard ONLY if unlocked and authorized
  if (currentRole === 'admin' && isAdminUnlocked && isAuthorizedAdmin) {
    return <AdminDashboard />;
  }

  const handleStartGame = (room: TournamentRoom) => {
    joinRoom(room.id);
    setCurrentView('game');
  };

  const handleExitGame = () => {
    leaveRoom();
    setCurrentView('lobby');
  };

  const handleOpenWalletWithTab = (tab: 'deposit' | 'withdraw' | 'history') => {
    setWalletInitialTab(tab);
    setShowWalletModal(true);
  };

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

        {currentView === 'game' && (activeRoom || rooms[0]) && (
          <NeonGameCanvas
            room={activeRoom || rooms[0]}
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
