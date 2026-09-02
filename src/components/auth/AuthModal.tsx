import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  X,
  Mail,
  Lock,
  User,
  Smartphone,
  CreditCard,
  ShieldCheck,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  AlertCircle,
  Loader2,
  Database,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTutorial: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onOpenTutorial,
}) => {
  const { registerWithEmail, loginWithEmail, sendPasswordReset } = useApp();

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot_password'>('signin');
  
  // Sign In Form State
  const [signInEmail, setSignInEmail] = useState<string>('');
  const [signInPassword, setSignInPassword] = useState<string>('');

  // Sign Up Form State
  const [signUpName, setSignUpName] = useState<string>('');
  const [signUpEmail, setSignUpEmail] = useState<string>('');
  const [signUpPassword, setSignUpPassword] = useState<string>('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState<string>('');
  const [signUpPhone, setSignUpPhone] = useState<string>('');
  const [signUpIdCard, setSignUpIdCard] = useState<string>('');

  // Forgot Password State
  const [resetEmail, setResetEmail] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInEmail.trim() || !signInPassword) {
      setStatusMsg({ type: 'error', text: 'Por favor ingresa tu correo y contraseña.' });
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      await loginWithEmail(signInEmail.trim(), signInPassword);
      setStatusMsg({
        type: 'success',
        text: '¡Sesión iniciada con éxito! Bienvenido a la arena.',
      });
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      let msg = err?.message || 'Error al iniciar sesión.';
      if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
        msg = 'Correo o contraseña incorrectos.';
      } else if (err?.code === 'auth/user-not-found') {
        msg = 'No existe una cuenta registrada con este correo.';
      }
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signUpPassword !== signUpConfirmPassword) {
      setStatusMsg({ type: 'error', text: 'Las contraseñas no coinciden.' });
      return;
    }
    if (signUpPassword.length < 6) {
      setStatusMsg({ type: 'error', text: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    setLoading(true);
    setStatusMsg(null);
    try {
      await registerWithEmail(
        signUpEmail.trim(),
        signUpPassword,
        signUpName.trim(),
        signUpPhone.trim(),
        signUpIdCard.trim()
      );
      setStatusMsg({
        type: 'success',
        text: '¡Cuenta creada y registrada en Cloud Firestore exitosamente!',
      });
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      let msg = err?.message || 'Error al registrar la cuenta.';
      if (err?.code === 'auth/email-already-in-use') {
        msg = 'Este correo electrónico ya está registrado. Por favor inicia sesión.';
      } else if (err?.code === 'auth/weak-password') {
        msg = 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
      }
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      setStatusMsg({ type: 'error', text: 'Por favor ingresa tu correo electrónico.' });
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      await sendPasswordReset(resetEmail.trim());
      setStatusMsg({
        type: 'success',
        text: 'Enlace de restablecimiento enviado a tu correo. Revisa tu bandeja de entrada.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Error al enviar enlace de recuperación.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-md bg-[#090b20] border-2 border-cyan-500/50 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.3)] text-slate-100 my-8">
        <button
          id="auth-modal-close-btn"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 mx-auto flex items-center justify-center text-cyan-400 mb-3 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="font-orbitron font-extrabold text-xl text-white">
            {mode === 'signin' && 'Acceso a WinOrbs'}
            {mode === 'signup' && 'Registro de Gladiador'}
            {mode === 'forgot_password' && 'Recuperar Contraseña'}
          </h3>
          <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
            {mode === 'signin' && 'Inicia sesión con tu cuenta segura'}
            {mode === 'signup' && 'Tus datos se almacenan en tiempo real en Cloud Firestore'}
            {mode === 'forgot_password' && 'Ingresa tu correo para restablecer tu clave'}
          </p>
        </div>

        {/* Mode Switcher Tabs */}
        {mode !== 'forgot_password' && (
          <div className="flex bg-slate-900/90 p-1 rounded-2xl border border-slate-800 mb-5">
            <button
              id="auth-tab-signin"
              type="button"
              onClick={() => {
                setMode('signin');
                setStatusMsg(null);
              }}
              className={`flex-1 py-2.5 rounded-xl font-orbitron font-bold text-xs transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              INICIAR SESIÓN
            </button>
            <button
              id="auth-tab-signup"
              type="button"
              onClick={() => {
                setMode('signup');
                setStatusMsg(null);
              }}
              className={`flex-1 py-2.5 rounded-xl font-orbitron font-bold text-xs transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CREAR CUENTA
            </button>
          </div>
        )}

        {/* In-Modal Status Notification */}
        {statusMsg && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-mono-tech mb-4 animate-fade-in flex items-center gap-2.5 ${
              statusMsg.type === 'success'
                ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/70 border border-rose-500/50 text-rose-300'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* TAB 1: SIGN IN */}
        {mode === 'signin' && (
          <form onSubmit={handleSignInSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Correo Electrónico</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  placeholder="tunombre@ejemplo.com"
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-slate-300">Contraseña</label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot_password');
                    setStatusMsg(null);
                  }}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  ¿Olvidaste tu clave?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <button
              id="signin-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 font-orbitron font-black text-xs tracking-wider shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all mt-3 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}</span>
            </button>
          </form>
        )}

        {/* TAB 2: SIGN UP */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUpSubmit} className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Nombre Completo / Apodo</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Tu Nombre o Nickname"
                  value={signUpName}
                  onChange={(e) => setSignUpName(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1">Correo Electrónico</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  placeholder="tunombre@ejemplo.com"
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Contraseña</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Confirmar Contraseña</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    placeholder="Repite tu contraseña"
                    value={signUpConfirmPassword}
                    onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Teléfono (Pago Móvil)</label>
                <div className="relative">
                  <Smartphone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="0414-1234567"
                    value={signUpPhone}
                    onChange={(e) => setSignUpPhone(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono-tech focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Cédula / DNI</label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="V-12345678"
                    value={signUpIdCard}
                    onChange={(e) => setSignUpIdCard(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono-tech focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-center gap-2 text-[11px] text-cyan-300 font-mono-tech">
              <Database className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Tu cuenta se registrará directamente en Cloud Firestore</span>
            </div>

            <button
              id="signup-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:brightness-110 text-slate-950 font-orbitron font-black text-xs tracking-wider shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all mt-2 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'CREANDO CUENTA...' : 'COMPLETAR REGISTRO'}</span>
            </button>
          </form>
        )}

        {/* TAB 3: FORGOT PASSWORD */}
        {mode === 'forgot_password' && (
          <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Ingresa el correo registrado con tu cuenta:
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  placeholder="tunombre@ejemplo.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  required
                />
              </div>
            </div>

            <button
              id="forgot-password-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:brightness-110 text-slate-950 font-orbitron font-bold text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'ENVIANDO...' : 'ENVIAR ENLACE DE RECUPERACIÓN'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setStatusMsg(null);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              ← Volver al inicio de sesión
            </button>
          </form>
        )}

        {/* Quick Tutorial Footer Link */}
        <div className="mt-5 pt-3 border-t border-slate-800">
          <button
            onClick={() => {
              onClose();
              onOpenTutorial();
            }}
            className="w-full p-2.5 rounded-2xl bg-cyan-950/30 hover:bg-cyan-950/50 border border-cyan-500/25 flex items-center justify-between text-xs text-cyan-300 transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold">Ver Reglas del Torneo y Tutorial</span>
            </div>
            <ArrowRight className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    </div>
  );
};
