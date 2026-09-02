import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  X,
  AlertTriangle,
  KeyRound,
  CheckCircle2,
  Mail,
  Loader2,
} from 'lucide-react';

interface AdminSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminSecurityModal: React.FC<AdminSecurityModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const {
    currentUser,
    loginWithEmail,
    verifyAdminPin,
    isAuthorizedAdmin,
  } = useApp();

  const [pin, setPin] = useState<string>('');
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [successAnim, setSuccessAnim] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleAdminEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!adminEmail.trim() || !adminPassword) {
      setErrorMsg('Ingresa el correo y contraseña del administrador.');
      return;
    }
    setLoading(true);
    try {
      await loginWithEmail(adminEmail.trim(), adminPassword);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al autenticar credenciales de administrador.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');

    if (!currentUser) {
      setErrorMsg('Debes iniciar sesión con la cuenta de administrador.');
      return;
    }

    if (!isAuthorizedAdmin) {
      setErrorMsg('Tu cuenta actual no posee privilegios de Super Administrador.');
      return;
    }

    if (pin.trim().length === 0) {
      setErrorMsg('Por favor ingresa el PIN Maestro de Seguridad.');
      return;
    }

    const isValid = verifyAdminPin(pin);
    if (isValid) {
      setSuccessAnim(true);
      setTimeout(() => {
        setSuccessAnim(false);
        setPin('');
        onSuccess();
      }, 700);
    } else {
      setErrorMsg('PIN de Seguridad Incorrecto.');
    }
  };

  const handleDigitClick = (digit: string) => {
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMsg('');
      if (nextPin.length === 6) {
        const isValid = verifyAdminPin(nextPin);
        if (isValid) {
          setSuccessAnim(true);
          setTimeout(() => {
            setSuccessAnim(false);
            setPin('');
            onSuccess();
          }, 700);
        } else {
          setErrorMsg('PIN incorrecto.');
        }
      }
    }
  };

  const handleDeleteDigit = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-lg animate-fade-in">
      <div className="relative w-full max-w-md bg-[#080918] border-2 border-purple-500/60 rounded-3xl p-6 sm:p-8 shadow-[0_0_60px_rgba(168,85,247,0.4)] text-slate-100 overflow-hidden">
        {/* Neon Glow accent */}
        <div className="absolute -top-20 -left-20 w-48 h-48 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-48 h-48 rounded-full bg-pink-600/20 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          id="close-admin-security-modal-btn"
          onClick={() => {
            setPin('');
            setErrorMsg('');
            onClose();
          }}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-900 border border-purple-500/30 text-slate-400 hover:text-white hover:border-purple-400 transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-900 via-indigo-900 to-fuchsia-900 border-2 border-purple-400 mx-auto flex items-center justify-center text-purple-300 mb-3 shadow-[0_0_25px_rgba(168,85,247,0.5)]">
            {successAnim ? (
              <Unlock className="w-7 h-7 text-emerald-400 animate-bounce" />
            ) : (
              <ShieldAlert className="w-7 h-7 text-purple-300" />
            )}
          </div>
          <h3 className="font-orbitron font-extrabold text-xl text-white tracking-wide">
            CONTROL DE SEGURIDAD
          </h3>
          <p className="text-xs text-purple-300/80 font-mono-tech mt-1">
            Módulo Protegido: Panel Super Administrador
          </p>
        </div>

        {/* Case 1: Not Logged In */}
        {!currentUser && (
          <form onSubmit={handleAdminEmailLogin} className="space-y-4">
            <div className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/40 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div className="text-xs text-purple-200">
                <span className="font-bold block">Autenticación Requerida</span>
                Ingresa con la cuenta de Administrador autorizada para desbloquear las herramientas maestras.
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs text-center font-mono-tech animate-shake">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-300 mb-1">Correo de Administrador</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-purple-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">Contraseña</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-purple-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <button
              id="admin-auth-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-fuchsia-600 hover:brightness-110 text-white font-orbitron font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'AUTENTICANDO...' : 'INGRESAR COMO ADMINISTRADOR'}</span>
            </button>
          </form>
        )}

        {/* Case 2: Logged In but Not Authorized */}
        {currentUser && !isAuthorizedAdmin && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-500/50 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-200">
                <span className="font-bold text-rose-300 block mb-1">
                  ⛔ ACCESO DENEGADO (Sin Privilegios)
                </span>
                La cuenta activa (<span className="font-mono font-bold text-white">{currentUser.email}</span>)
                no cuenta con autorización de Super Administrador.
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center">
              Para acceder, inicia sesión con la cuenta de Administrador autorizada.
            </p>
          </div>
        )}

        {/* Case 3: Logged In and Authorized - PIN Verification */}
        {currentUser && isAuthorizedAdmin && (
          <form onSubmit={handlePinSubmit} className="space-y-5">
            {/* Identity Badge */}
            <div className="p-3 rounded-2xl bg-purple-950/40 border border-purple-500/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.name}
                  className="w-8 h-8 rounded-xl border border-purple-400 object-cover"
                />
                <div>
                  <div className="font-orbitron font-bold text-xs text-white">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] font-mono-tech text-purple-300">
                    {currentUser.email}
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono-tech">
                <CheckCircle2 className="w-3 h-3" />
                Autorizado
              </span>
            </div>

            {/* PIN Display */}
            <div className="text-center space-y-2">
              <label className="text-xs font-mono-tech text-slate-300 flex items-center justify-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                Ingresa el PIN Maestro de 6 Dígitos
              </label>

              {/* Masked PIN Bubbles */}
              <div className="flex justify-center items-center gap-2.5 py-2">
                {[0, 1, 2, 3, 4, 5].map((idx) => {
                  const isFilled = pin.length > idx;
                  return (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full transition-all ${
                        isFilled
                          ? 'bg-gradient-to-r from-purple-400 to-pink-400 scale-110 shadow-[0_0_12px_#c084fc]'
                          : 'bg-slate-800 border border-purple-500/40'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Error message */}
            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs text-center font-mono-tech animate-shake">
                {errorMsg}
              </div>
            )}

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2 max-w-[280px] mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleDigitClick(num)}
                  className="py-2.5 rounded-xl bg-slate-900/90 hover:bg-purple-900/40 border border-slate-800 hover:border-purple-500 text-white font-orbitron font-bold text-base transition-all active:scale-95 cursor-pointer"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleDeleteDigit}
                className="py-2.5 rounded-xl bg-slate-900/90 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/50 text-rose-400 font-orbitron font-bold text-xs transition-all active:scale-95 cursor-pointer"
              >
                BORRAR
              </button>
              <button
                type="button"
                onClick={() => handleDigitClick('0')}
                className="py-2.5 rounded-xl bg-slate-900/90 hover:bg-purple-900/40 border border-slate-800 hover:border-purple-500 text-white font-orbitron font-bold text-base transition-all active:scale-95 cursor-pointer"
              >
                0
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-orbitron font-bold text-xs transition-all shadow-[0_0_15px_rgba(168,85,247,0.4)] active:scale-95 cursor-pointer flex items-center justify-center gap-1"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>ENTRAR</span>
              </button>
            </div>
          </form>
        )}

        {/* Security Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono-tech text-slate-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
            Cifrado TLS + Cloud Firestore
          </span>
          <span>Acceso Restringido</span>
        </div>
      </div>
    </div>
  );
};
