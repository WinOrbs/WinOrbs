import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  LogOut,
  AlertTriangle,
  ShieldAlert,
  X,
  Flame,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import { soundFx } from '../../services/soundSynth';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isGameActive?: boolean;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isGameActive = false,
}) => {
  const { currentUser, activeRoom } = useApp();

  if (!isOpen || !currentUser) return null;

  const hasActiveSession = isGameActive || !!activeRoom;

  const handleConfirmLogout = () => {
    soundFx.playNotificationPing();
    try {
      onConfirm();
    } finally {
      onClose();
    }
  };

  const handleCancel = () => {
    soundFx.playNotificationPing();
    onClose();
  };

  return (
    <div
      id="logout-confirm-modal-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-[#0b0e24] border-2 border-rose-500/60 rounded-3xl p-6 sm:p-7 shadow-[0_0_50px_rgba(244,63,94,0.35)] text-slate-100 animate-scale-up">
        {/* Close button */}
        <button
          id="logout-modal-close-btn"
          type="button"
          onClick={handleCancel}
          className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warning Icon Badge */}
        <div className="flex justify-center mb-4">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 ${
              hasActiveSession
                ? 'bg-rose-500/20 border-rose-400 text-rose-400 shadow-[0_0_25px_rgba(244,63,94,0.5)] animate-bounce'
                : 'bg-amber-500/20 border-amber-400 text-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.35)]'
            }`}
          >
            {hasActiveSession ? (
              <ShieldAlert className="w-8 h-8" />
            ) : (
              <AlertTriangle className="w-8 h-8" />
            )}
          </div>
        </div>

        {/* Modal Title */}
        <div className="text-center mb-5">
          <h3 className="font-orbitron font-extrabold text-xl text-white tracking-wide">
            {hasActiveSession ? '¡TORNEO EN CURSO!' : '¿Cerrar Sesión?'}
          </h3>
          <p className="text-xs text-slate-400 font-mono-tech mt-1">
            Confirmación de Seguridad Neón .IO
          </p>
        </div>

        {/* User Card */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/80 border border-slate-700/80 mb-4">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-11 h-11 rounded-xl object-cover border border-cyan-400"
          />
          <div className="flex-1 min-w-0">
            <div className="font-orbitron font-bold text-sm text-white truncate">
              {currentUser.name}
            </div>
            <div className="text-[11px] text-slate-400 font-mono-tech truncate">
              {currentUser.email}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-orbitron font-extrabold text-emerald-400 flex items-center gap-1 justify-end">
              <Wallet className="w-3 h-3" />
              <span>${currentUser.balanceUSD.toFixed(2)}</span>
            </div>
            <div className="text-[9px] text-slate-400 font-mono-tech">Saldo Guardado</div>
          </div>
        </div>

        {/* Active Tournament Risk Warning */}
        {hasActiveSession ? (
          <div className="p-4 rounded-2xl bg-rose-950/70 border border-rose-500/60 mb-6 text-rose-200 text-xs leading-relaxed space-y-2 shadow-[0_0_15px_rgba(244,63,94,0.2)]">
            <div className="flex items-center gap-1.5 font-orbitron font-black text-rose-300 text-xs">
              <Flame className="w-4 h-4 text-rose-400" />
              <span>RIESGO DE PÉRDIDA DE TORNEO</span>
            </div>
            <p>
              Estás dentro de una sala de batalla activa:{' '}
              <strong className="text-white">
                {activeRoom?.name || 'Torneo Neón .IO'}
              </strong>
              .
            </p>
            <p className="text-[11px] text-rose-300/90">
              ⚠️ Si te desconectas o cierras sesión ahora, abandonarás la partida, serás descalificado
              del pozo acumulado y perderás tu cuota de inscripción.
            </p>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 mb-6 text-slate-300 text-xs flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0" />
            <p className="text-[11px]">
              Tus datos, saldo, victorias y skins desbloqueadas están sincronizados de forma segura en Firestore.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            id="logout-cancel-btn"
            type="button"
            onClick={handleCancel}
            className="w-full sm:flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-black text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span>CANCELAR Y CONTINUAR</span>
          </button>

          <button
            id="logout-confirm-btn"
            type="button"
            onClick={handleConfirmLogout}
            className="w-full sm:w-auto py-3 px-4 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 hover:border-rose-400 text-rose-300 hover:text-rose-200 font-orbitron font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(244,63,94,0.2)]"
          >
            <LogOut className="w-4 h-4" />
            <span>CERRAR SESIÓN</span>
          </button>
        </div>
      </div>
    </div>
  );
};
