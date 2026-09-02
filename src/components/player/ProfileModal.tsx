import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  X,
  User,
  Mail,
  Smartphone,
  CreditCard,
  Building2,
  Wallet,
  ShieldCheck,
  CheckCircle2,
  Cloud,
  Database,
  Save,
  Copy,
  Check,
  LogOut,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestLogout?: () => void;
}

const VENEZUELAN_BANKS = [
  { code: '0102', name: '0102 - Banco de Venezuela' },
  { code: '0134', name: '0134 - Banesco Banco Universal' },
  { code: '0108', name: '0108 - Banco Provincial (BBVA)' },
  { code: '0105', name: '0105 - Banco Mercantil' },
  { code: '0114', name: '0114 - Bancaribe' },
  { code: '0115', name: '0115 - Banco Exterior' },
  { code: '0163', name: '0163 - Banco del Tesoro' },
  { code: '0172', name: '0172 - Bancamiga Banco Microfinanciero' },
  { code: '0175', name: '0175 - Banco Bicentenario' },
  { code: '0191', name: '0191 - Banco Nacional de Crédito (BNC)' },
];

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, onRequestLogout }) => {
  const { currentUser, updateProfileData, logout } = useApp();

  const [name, setName] = useState<string>(currentUser?.name || '');
  const [email, setEmail] = useState<string>(currentUser?.email || '');
  const [phone, setPhone] = useState<string>(currentUser?.phone || '');
  const [idCard, setIdCard] = useState<string>(currentUser?.idCard || '');
  const [pagoMovilBank, setPagoMovilBank] = useState<string>(
    currentUser?.pagoMovilBank || '0102 - Banco de Venezuela'
  );
  const [usdtWallet, setUsdtWallet] = useState<string>(
    currentUser?.usdtWallet || ''
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [copiedWallet, setCopiedWallet] = useState<boolean>(false);

  if (!isOpen || !currentUser) return null;

  const handleCopyWallet = () => {
    navigator.clipboard.writeText(usdtWallet);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2500);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      await updateProfileData({
        name: name.trim(),
        phone: phone.trim(),
        idCard: idCard.trim(),
        pagoMovilBank,
        usdtWallet: usdtWallet.trim(),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      alert('Error guardando en Firestore: ' + (err?.message || 'Error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-[#090b22] border-2 border-cyan-500/60 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.35)] text-slate-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-start gap-4 border-b border-slate-800 pb-5 mb-6">
          <div className="relative">
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-16 h-16 rounded-2xl object-cover border-2 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]"
            />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-[10px] text-slate-950 font-bold">
              ✓
            </span>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-orbitron font-extrabold text-xl text-white">
                Perfil de Gladiador
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono-tech flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                <Database className="w-3 h-3 text-emerald-400" />
                <span>FIRESTORE CONECTADO</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono-tech mt-1">
              ID Firestore: <strong className="text-cyan-300">users/{currentUser.id}</strong>
            </p>
            <p className="text-[11px] text-slate-400">
              Datos personales para la recepción de pagos de premios por Pago Móvil y Binance.
            </p>
          </div>
        </div>

        {/* Firestore Account Card */}
        <div className="rounded-2xl p-4 bg-gradient-to-r from-cyan-950/60 to-blue-950/60 border border-cyan-500/40 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-300 shadow-md shrink-0">
              <ShieldCheck className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <span className="text-[10px] text-cyan-300 font-mono-tech font-bold uppercase block">
                Cuenta Oficial Registrada
              </span>
              <span className="text-sm font-bold text-white font-orbitron">
                {currentUser.email || 'Sin correo asociado'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-900/40 border border-cyan-500/30 text-[11px] font-mono-tech text-cyan-300">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>Colección: users</span>
          </div>
        </div>

        {/* Success Alert */}
        {saveSuccess && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-950/90 border border-emerald-400 text-emerald-200 text-xs font-mono-tech flex items-center gap-3 animate-fade-in shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold font-orbitron">¡Datos Sincronizados con Éxito en Firebase Firestore!</p>
              <p className="text-[11px] text-emerald-300/80">
                Tu perfil y datos de cobro de Pago Móvil han quedado guardados en la colección de Firestore.
              </p>
            </div>
          </div>
        )}

        {/* Profile Details Form */}
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Nombre Completo / Titular</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Erick López"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-sans focus:border-cyan-400 focus:outline-none"
                required
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-cyan-400" />
                <span>Correo Electrónico</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-sans focus:border-cyan-400 focus:outline-none"
                required
              />
            </div>

            {/* ID Card (Cédula de Identidad) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                <span>Cédula de Identidad / DNI</span>
              </label>
              <input
                type="text"
                value={idCard}
                onChange={(e) => setIdCard(e.target.value)}
                placeholder="Ej: V-28.451.902"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-xs focus:border-cyan-400 focus:outline-none"
                required
              />
            </div>

            {/* Phone for Pago Móvil */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                <span>Teléfono Receptor de Pago Móvil</span>
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0414-1234567"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-xs focus:border-cyan-400 focus:outline-none"
                required
              />
            </div>

            {/* Bank for Pago Móvil */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Banco Receptor de Pago Móvil</span>
              </label>
              <select
                value={pagoMovilBank}
                onChange={(e) => setPagoMovilBank(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-sans focus:border-cyan-400 focus:outline-none"
              >
                {VENEZUELAN_BANKS.map((b) => (
                  <option key={b.code} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* USDT Wallet */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-yellow-400" />
                  <span>Billetera Binance USDT (Red Tron TRC20)</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-mono-tech flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Tron (TRC20)
                </span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={usdtWallet}
                  onChange={(e) => setUsdtWallet(e.target.value)}
                  placeholder="TMPtqWe3Rtgv8PvoGKoBeLREzYg6hK8K3E"
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-xs focus:border-yellow-400 focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={handleCopyWallet}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-yellow-400 transition-colors cursor-pointer"
                  title="Copiar dirección"
                >
                  {copiedWallet ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Binance Verified TRC-20 Card */}
          <div className="p-3.5 rounded-2xl bg-[#0c102c] border border-yellow-500/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-600 p-2 shrink-0 flex items-center justify-center text-slate-950 font-black text-xs shadow-md">
                BINANCE
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-white font-orbitron">
                    Receptor Binance TRC20 Verificado
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-yellow-950 text-yellow-300 border border-yellow-500/40 text-[9px] font-mono-tech font-bold">
                    USDT
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono-tech truncate max-w-xs sm:max-w-md">
                  {usdtWallet}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyWallet}
              className="px-3 py-1.5 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 font-mono-tech text-[10px] font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
            >
              {copiedWallet ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedWallet ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>

          {/* Sync info banner */}
          <div className="p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-slate-300 text-xs font-mono-tech flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span>Sincronización en tiempo real activa en Firestore</span>
            </div>
            <span className="text-[10px] text-cyan-300 font-bold">
              {currentUser.firestoreSyncedAt
                ? `Último guardado: ${new Date(currentUser.firestoreSyncedAt).toLocaleTimeString()}`
                : 'Listo para guardar'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex flex-col sm:flex-row items-center gap-3">
            <button
              id="profile-logout-btn"
              type="button"
              onClick={() => {
                onClose();
                if (onRequestLogout) {
                  onRequestLogout();
                } else {
                  logout();
                }
              }}
              className="w-full sm:w-auto px-4 py-3.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 hover:border-rose-400 text-rose-300 font-orbitron font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(244,63,94,0.15)]"
              title="Cerrar sesión de esta cuenta"
            >
              <LogOut className="w-4 h-4 text-rose-400" />
              <span>CERRAR SESIÓN</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron font-bold text-xs transition-all cursor-pointer"
            >
              CANCELAR
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="w-full sm:flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 font-orbitron font-black text-xs sm:text-sm tracking-wider shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'GUARDANDO EN FIRESTORE...' : 'GUARDAR DATOS EN FIRESTORE'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
