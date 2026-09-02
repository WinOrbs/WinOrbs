import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  X,
  Bell,
  CheckCheck,
  Trophy,
  CheckCircle,
  AlertOctagon,
  Radio,
  Clock,
  ExternalLink,
} from 'lucide-react';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  onOpenWallet,
}) => {
  const {
    currentUser,
    notifications,
    markNotificationAsRead,
    markAllNotificationsRead,
  } = useApp();

  if (!isOpen) return null;

  const userNotifications = notifications.filter(
    (n) => n.userId === 'all' || (currentUser && n.userId === currentUser.id)
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
      />

      {/* Slide-over Drawer */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-[#080a1c] border-l-2 border-cyan-500/30 text-slate-100 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-orbitron font-bold text-sm text-white">Notificaciones Push</h3>
                <span className="text-[10px] text-slate-400 font-mono-tech">
                  Alertas en tiempo real de pagos y torneos
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={markAllNotificationsRead}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1"
                title="Marcar todas como leídas"
              >
                <CheckCheck className="w-4 h-4 text-cyan-400" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {userNotifications.length === 0 ? (
              <div className="text-center py-16 text-slate-500 font-mono-tech text-xs">
                No tienes notificaciones pendientes.
              </div>
            ) : (
              userNotifications.map((notif) => {
                const getIcon = () => {
                  switch (notif.type) {
                    case 'tx_approved':
                      return <CheckCircle className="w-4 h-4 text-emerald-400" />;
                    case 'pot_win':
                      return <Trophy className="w-4 h-4 text-yellow-400" />;
                    case 'tx_rejected':
                      return <AlertOctagon className="w-4 h-4 text-rose-400" />;
                    case 'broadcast':
                      return <Radio className="w-4 h-4 text-purple-400" />;
                    default:
                      return <Bell className="w-4 h-4 text-cyan-400" />;
                  }
                };

                return (
                  <div
                    key={notif.id}
                    onClick={() => markNotificationAsRead(notif.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      notif.read
                        ? 'bg-slate-900/40 border-slate-800/80 opacity-75'
                        : 'bg-slate-900/90 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-slate-800 shrink-0 mt-0.5">
                        {getIcon()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-orbitron font-bold text-xs text-white truncate">
                            {notif.title}
                          </h4>
                          {!notif.read && (
                            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-ping" />
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          {notif.message}
                        </p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-400 font-mono-tech">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {notif.timestamp}
                          </span>
                          {notif.type === 'tx_approved' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenWallet();
                                onClose();
                              }}
                              className="text-cyan-400 font-bold hover:underline flex items-center gap-0.5"
                            >
                              Ver Bóveda <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
