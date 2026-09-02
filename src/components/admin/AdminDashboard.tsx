import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Transaction } from '../../types';
import { LogoutConfirmModal } from '../auth/LogoutConfirmModal';
import { AdminRoomsManager } from './AdminRoomsManager';
import {
  Shield,
  CheckCircle,
  XCircle,
  TrendingUp,
  Eye,
  Smartphone,
  Coins,
  Send,
  AlertTriangle,
  Check,
  ChevronRight,
  LogOut,
  Lock,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const {
    switchRole,
    exchangeRates,
    updateExchangeRates,
    transactions,
    approveTransaction,
    rejectTransaction,
    rooms,
    adminCreateRoom,
    adminUpdateRoom,
    adminDeleteRoom,
    startMatchNow,
    platformRevenueUSD,
    sendPushBroadcast,
    logout,
    lockAdmin,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'deposits' | 'withdrawals' | 'rates' | 'rooms' | 'broadcast'
  >('deposits');
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);

  // Rates edit state
  const [vesRateInput, setVesRateInput] = useState<number>(exchangeRates.vesUsdRate);
  const [usdtFeeInput, setUsdtFeeInput] = useState<number>(exchangeRates.usdtWithdrawalFeeUSD ?? 1.00);
  const [withdrawalFeeInput, setWithdrawalFeeInput] = useState<number>(exchangeRates.withdrawalFeePercent);
  const [winnerPotPercentInput, setWinnerPotPercentInput] = useState<number>(exchangeRates.winnerPotPercent);
  const [platformPotPercentInput, setPlatformPotPercentInput] = useState<number>(exchangeRates.platformPotPercent);
  const [ratesSaved, setRatesSaved] = useState<boolean>(false);

  // Broadcast composer state
  const [broadcastTitle, setBroadcastTitle] = useState<string>('⚡ ¡Torneo Relámpago Activado!');
  const [broadcastMsg, setBroadcastMsg] = useState<string>(
    'Nuevo pote de $100 USD disponible en salas públicas. ¡El 80% va directo al ganador de cada ronda!'
  );
  const [broadcastSent, setBroadcastSent] = useState<boolean>(false);
  const [showBroadcastConfirm, setShowBroadcastConfirm] = useState<boolean>(false);

  // Transaction Inspection Modal
  const [inspectTx, setInspectTx] = useState<Transaction | null>(null);
  const [adminNotes, setAdminNotes] = useState<string>('');

  // Transaction Confirmation Modal state
  const [confirmTx, setConfirmTx] = useState<Transaction | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [confirmInput, setConfirmInput] = useState<string>('');

  // Pending queues
  const pendingDeposits = transactions.filter((t: Transaction) => t.type === 'deposit' && t.status === 'pending');
  const pendingWithdrawals = transactions.filter((t: Transaction) => t.type === 'withdrawal' && t.status === 'pending');

  const totalDepositsUSD = transactions
    .filter((t: Transaction) => t.type === 'deposit' && t.status === 'approved')
    .reduce((sum, t: Transaction) => sum + t.amountUSD, 0);

  const totalWithdrawalsUSD = transactions
    .filter((t: Transaction) => t.type === 'withdrawal' && t.status === 'approved')
    .reduce((sum, t: Transaction) => sum + t.amountUSD, 0);

  const handleSaveRates = (e: React.FormEvent) => {
    e.preventDefault();
    updateExchangeRates({
      vesUsdRate: vesRateInput,
      usdtWithdrawalFeeUSD: usdtFeeInput,
      withdrawalFeePercent: withdrawalFeeInput,
      winnerPotPercent: winnerPotPercentInput,
      platformPotPercent: platformPotPercentInput,
    });
    setRatesSaved(true);
    setTimeout(() => setRatesSaved(false), 2500);
  };

  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle || !broadcastMsg) return;
    setShowBroadcastConfirm(true);
  };

  const confirmSendBroadcast = () => {
    sendPushBroadcast(broadcastTitle, broadcastMsg, 'all');
    setBroadcastSent(true);
    setShowBroadcastConfirm(false);
    setTimeout(() => setBroadcastSent(false), 3000);
  };

  const getDefaultNote = (tx: Transaction, action: 'approve' | 'reject'): string => {
    if (action === 'approve') {
      const isUsdt = tx.method === 'usdt_trc20' || tx.method === 'usdt_bep20';
      if (tx.type === 'withdrawal') {
        return isUsdt ? `USDT transferido a billetera ${tx.receiptDetails?.targetBank}` : 'Pago Móvil transferido exitosamente.';
      }
      return 'Aprobado y acreditado automáticamente.';
    } else {
      if (tx.type === 'withdrawal') {
        return 'Datos bancarios/billetera erróneos o cuenta bloqueada.';
      }
      return 'Referencia no encontrada o comprobante ilegible.';
    }
  };

  const handleConfirmAction = () => {
    if (!confirmTx || !confirmAction || confirmInput !== 'CONFIRMAR') return;
    const note = getDefaultNote(confirmTx, confirmAction);
    if (confirmAction === 'approve') {
      approveTransaction(confirmTx.id, note);
    } else {
      rejectTransaction(confirmTx.id, note);
    }
    setConfirmTx(null);
    setConfirmAction(null);
    setConfirmInput('');
  };

  return (
    <div className="min-h-screen bg-[#050714] text-slate-100 font-sans selection:bg-purple-500 selection:text-white">
      {/* Admin Top Command Header */}
      <header className="sticky top-0 z-30 bg-[#07091b]/95 border-b-2 border-purple-500/40 backdrop-blur-xl shadow-[0_4px_30px_rgba(168,85,247,0.15)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/50 flex items-center justify-center text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)]">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-orbitron font-black text-base sm:text-lg text-white">
                  NEON<span className="text-purple-400">ADMIN</span>
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-500/40 text-purple-300 font-mono-tech text-[10px] uppercase font-bold">
                  Acceso Total Super-Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono-tech hidden sm:block">
                Validación de Pagos, Control de Tasas y Supervisión de Torneos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Platform Revenue counter */}
            <div className="hidden md:flex flex-col text-right px-3 py-1.5 rounded-xl bg-slate-900/90 border border-purple-500/30">
              <span className="text-[10px] text-slate-400 font-mono-tech">Ganancia Plataforma (20% Potes & Fees):</span>
              <span className="font-orbitron font-extrabold text-sm text-emerald-400">
                ${platformRevenueUSD.toFixed(2)} USD
              </span>
            </div>

            {/* Lock Admin Security */}
            <button
              id="admin-lock-btn"
              onClick={() => {
                if (window.confirm('¿Deseas bloquear el panel de administración? Necesitarás tu PIN maestro para volver a entrar.')) {
                  lockAdmin();
                }
              }}
              className="px-3.5 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400 text-purple-200 font-orbitron font-bold text-xs shadow-[0_0_12px_rgba(168,85,247,0.25)] transition-all flex items-center gap-1.5 cursor-pointer"
              title="Bloquear Panel y Requerir PIN"
            >
              <Lock className="w-4 h-4 text-purple-300" />
              <span className="hidden sm:inline">BLOQUEAR</span>
            </button>

            {/* Switch back to Player View */}
            <button
              id="admin-switch-player-btn"
              onClick={() => switchRole('player')}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400 text-cyan-300 font-orbitron font-bold text-xs shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>VISTA JUGADOR</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Admin Logout */}
            <button
              id="admin-logout-btn"
              type="button"
              onClick={() => setShowLogoutModal(true)}
              className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 hover:border-rose-400 text-rose-300 font-orbitron font-bold text-xs shadow-[0_0_12px_rgba(244,63,94,0.15)] transition-all flex items-center gap-1.5 cursor-pointer"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4 text-rose-400" />
              <span className="hidden sm:inline">SALIR</span>
            </button>
          </div>
        </div>

        {/* Admin Navigation Sub-Bar with Dropdown & Pills */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 border-t border-slate-800 text-xs">
          {/* Mobile Select Dropdown */}
          <div className="md:hidden">
            <label htmlFor="admin-mobile-tab-select" className="sr-only">Seleccionar Módulo Admin</label>
            <select
              id="admin-mobile-tab-select"
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-purple-500/40 text-purple-200 font-orbitron font-bold text-xs focus:outline-none focus:border-purple-400"
            >
              <option value="overview">📊 Resumen & Métricas</option>
              <option value="deposits">📋 Validar Recargas ({pendingDeposits.length})</option>
              <option value="withdrawals">💸 Retiros ({pendingWithdrawals.length})</option>
              <option value="rates">💱 Tasas & Comisiones</option>
              <option value="rooms">🕹️ Salas & Eventos ({rooms.length})</option>
              <option value="broadcast">📢 Notificaciones Push</option>
            </select>
          </div>

          {/* Desktop/Tablet Horizontal Pills */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto">
            {[
              { id: 'overview', label: '📊 Resumen & Métricas' },
              {
                id: 'deposits',
                label: `📋 Validar Recargas (${pendingDeposits.length})`,
                badge: pendingDeposits.length,
              },
              {
                id: 'withdrawals',
                label: `💸 Retiros (${pendingWithdrawals.length})`,
                badge: pendingWithdrawals.length,
              },
              { id: 'rates', label: '💱 Tasas & Comisiones' },
              { id: 'rooms', label: `🕹️ Salas & Eventos (${rooms.length})` },
              { id: 'broadcast', label: '📢 Notificaciones Push' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl font-orbitron text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badge ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Admin Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW METRICS */}
        {/* ========================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-3xl bg-slate-900/80 border border-purple-500/30">
                <span className="text-xs font-mono-tech text-slate-400 uppercase">
                  Tesorería Plataforma (20%)
                </span>
                <p className="font-orbitron font-extrabold text-2xl text-purple-300 mt-1">
                  ${platformRevenueUSD.toFixed(2)} USD
                </p>
                <span className="text-[11px] text-emerald-400 font-mono-tech flex items-center gap-1 mt-1">
                  <TrendingUp className="w-3.5 h-3.5" /> +20% de cada partida & suscripciones
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-slate-900/80 border border-cyan-500/30">
                <span className="text-xs font-mono-tech text-slate-400 uppercase">
                  Depósitos Validados (Total)
                </span>
                <p className="font-orbitron font-extrabold text-2xl text-cyan-400 mt-1">
                  ${totalDepositsUSD.toFixed(2)} USD
                </p>
                <span className="text-[11px] text-slate-400 font-mono-tech mt-1 block">
                  ≈ Bs. {(totalDepositsUSD * exchangeRates.vesUsdRate).toLocaleString('es-VE')} VES
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-slate-900/80 border border-rose-500/30">
                <span className="text-xs font-mono-tech text-slate-400 uppercase">
                  Retiros Pagados
                </span>
                <p className="font-orbitron font-extrabold text-2xl text-rose-400 mt-1">
                  ${totalWithdrawalsUSD.toFixed(2)} USD
                </p>
                <span className="text-[11px] text-slate-400 font-mono-tech mt-1 block">
                  {transactions.filter((t: Transaction) => t.type === 'withdrawal' && t.status === 'approved').length} operaciones liquidadas
                </span>
              </div>

              <div className="p-5 rounded-3xl bg-slate-900/80 border border-yellow-500/30">
                <span className="text-xs font-mono-tech text-slate-400 uppercase">
                  Salas & Torneos Activos
                </span>
                <p className="font-orbitron font-extrabold text-2xl text-yellow-400 mt-1">
                  {rooms.length} Salas
                </p>
                <span className="text-[11px] text-amber-300 font-mono-tech mt-1 block">
                   Pote acumulado: ${rooms.reduce((s, r) => s + r.potUSD, 0).toFixed(2)} USD
                </span>
              </div>
            </div>

            {/* Quick Action Alert Banner */}
            {pendingDeposits.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-950/60 border border-amber-500/60 text-amber-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 animate-bounce" />
                  <span className="text-xs font-bold font-orbitron">
                    Tienes {pendingDeposits.length} comprobante(s) de recarga en cola pendiente de verificación.
                  </span>
                </div>
                <button
                  onClick={() => setActiveTab('deposits')}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-orbitron font-bold text-xs"
                >
                  VALIDAR AHORA
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: VALIDATE DEPOSITS QUEUE */}
        {/* ========================================================================= */}
        {activeTab === 'deposits' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div>
                <h2 className="font-orbitron font-extrabold text-lg text-white">
                  Validador de Recargas (Pago Móvil & USDT)
                </h2>
                <p className="text-xs text-slate-400 font-mono-tech">
                  Revisa los comprobantes bancarios y acredita fondos con 1 clic
                </p>
              </div>
              <span className="text-xs font-mono-tech text-purple-300 px-3 py-1 rounded-xl bg-purple-950 border border-purple-500/40">
                {pendingDeposits.length} Pendientes
              </span>
            </div>

            {pendingDeposits.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 border border-slate-800 rounded-3xl text-slate-500 font-mono-tech text-xs">
                ✅ No hay depósitos pendientes. Todos los comprobantes han sido validados.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingDeposits.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-4 sm:p-5 rounded-3xl bg-slate-900/80 border-2 border-cyan-500/40 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                          tx.method === 'pago_movil'
                            ? 'bg-cyan-950 border-cyan-500/50 text-cyan-400'
                            : 'bg-emerald-950 border-emerald-500/50 text-emerald-400'
                        }`}
                      >
                        {tx.method === 'pago_movil' ? <Smartphone className="w-6 h-6" /> : <Coins className="w-6 h-6" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-orbitron font-bold text-base text-white">
                            {tx.userName}
                          </h3>
                          <span className="text-[10px] font-mono-tech text-slate-400">
                            ({tx.userPhone})
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 font-mono-tech">
                          <span>Ref: <strong className="text-cyan-400">{tx.referenceNumber}</strong></span>
                          <span>•</span>
                          <span>Banco Emisor: <strong>{tx.receiptDetails?.originBank || 'Banesco/BDV'}</strong></span>
                          <span>•</span>
                          <span>C.I: <strong>{tx.receiptDetails?.senderIdCard || 'V-28190334'}</strong></span>
                          <span>•</span>
                          <span>Fecha: {new Date(tx.createdAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Amount & 1-Click Action Buttons */}
                    <div className="flex items-center justify-between lg:justify-end gap-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-800">
                      <div className="text-left lg:text-right">
                        <p className="font-orbitron font-black text-lg text-emerald-400">
                          +${tx.amountUSD.toFixed(2)} USD
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono-tech">
                          (Bs. {tx.amountVES.toLocaleString('es-VE')} VES)
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setInspectTx(tx);
                            setAdminNotes('Comprobante verificado correctamente en BDV/Banesco.');
                          }}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron text-xs flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspeccionar</span>
                        </button>

                        <button
                          id={`approve-btn-${tx.id}`}
                          onClick={() => { setConfirmTx(tx); setConfirmAction('approve'); setConfirmInput(''); }}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron font-bold text-xs shadow-[0_0_15px_rgba(16,185,129,0.4)] flex items-center gap-1"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>APROBAR</span>
                        </button>

                        <button
                          id={`reject-btn-${tx.id}`}
                          onClick={() => { setConfirmTx(tx); setConfirmAction('reject'); setConfirmInput(''); }}
                          className="p-2 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-400"
                          title="Rechazar Operación"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: WITHDRAWAL MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === 'withdrawals' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="font-orbitron font-extrabold text-lg text-white">
                Cola de Retiros de Ganancias
              </h2>
              <span className="text-xs font-mono-tech text-rose-300">
                {pendingWithdrawals.length} Solicitudes de Desembolso
              </span>
            </div>

            {pendingWithdrawals.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 border border-slate-800 rounded-3xl text-slate-500 font-mono-tech text-xs">
                No hay retiros pendientes de liquidación.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingWithdrawals.map((tx) => {
                  const isUsdt = tx.method === 'usdt_trc20' || tx.method === 'usdt_bep20';
                  const feeUSD = isUsdt
                    ? (exchangeRates.usdtWithdrawalFeeUSD ?? 1.00)
                    : (tx.amountUSD * (exchangeRates.withdrawalFeePercent / 100));
                  const netUSD = Math.max(0, tx.amountUSD - feeUSD);

                  return (
                    <div
                      key={tx.id}
                      className="p-4 sm:p-5 rounded-3xl bg-slate-900/80 border-2 border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-orbitron font-bold text-white">{tx.userName}</span>
                          <span className="text-xs text-slate-400 font-mono-tech">({tx.userPhone})</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono-tech font-bold ${
                            isUsdt ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' : 'bg-rose-950 text-rose-300 border border-rose-500/30'
                          }`}>
                            {isUsdt ? '🪙 USDT TRC-20' : '🇻🇪 PAGO MÓVIL'}
                          </span>
                        </div>
                        <p className="text-xs font-mono-tech text-slate-300 mt-1">
                          Destino Jugador: <strong className="text-rose-400">{tx.receiptDetails?.targetBank}</strong>
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono-tech mt-1">
                          <span>Ref: {tx.referenceNumber}</span>
                          <span>•</span>
                          <span>Monto Bruto: ${tx.amountUSD.toFixed(2)} USD</span>
                          <span>•</span>
                          <span className="text-amber-300">Fee: -${feeUSD.toFixed(2)} USD</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[10px] text-emerald-400 font-mono-tech font-bold block">
                            NETO A ENVIAR:
                          </span>
                          <span className="font-orbitron font-extrabold text-lg text-emerald-400">
                            ${netUSD.toFixed(2)} {isUsdt ? 'USDT' : 'USD'}
                          </span>
                          {!isUsdt && (
                            <span className="text-[10px] text-slate-400 font-mono-tech block">
                              Bs. {tx.amountVES.toLocaleString('es-VE')}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => { setConfirmTx(tx); setConfirmAction('approve'); setConfirmInput(''); }}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-orbitron font-bold text-xs shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer"
                        >
                          LIQUIDAR RETIRO
                        </button>

                        <button
                          onClick={() => { setConfirmTx(tx); setConfirmAction('reject'); setConfirmInput(''); }}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 cursor-pointer"
                          title="Rechazar y reembolsar"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: EXCHANGE RATES & FEES CONTROL */}
        {/* ========================================================================= */}
        {activeTab === 'rates' && (
          <div className="max-w-2xl bg-[#080b20] border-2 border-purple-500/40 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div>
              <h2 className="font-orbitron font-extrabold text-xl text-white">
                Control de Tasas & Precios del Dólar
              </h2>
              <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
                Ajusta en tiempo real la tasa VES/USD para Pago Móvil, comisiones de retiros y reparto del bote
              </p>
            </div>

            {ratesSaved && (
              <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>¡Tasas y comisiones actualizadas exitosamente en toda la plataforma!</span>
              </div>
            )}

            <form onSubmit={handleSaveRates} className="space-y-4">
              <div>
                <label className="block text-xs font-orbitron font-bold text-slate-300 mb-1">
                  🇻🇪 Tasa de Cambio Dólar / Pago Móvil (Bs. por 1 USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-slate-400 font-mono-tech text-xs">Bs.</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={vesRateInput}
                    onChange={(e) => setVesRateInput(parseFloat(e.target.value) || 0)}
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-base focus:border-purple-400 focus:outline-none"
                    required
                  />
                </div>
                <span className="text-[11px] text-slate-500 font-mono-tech mt-1 block">
                  Esta tasa calcula automáticamente el monto en Bolívares para las recargas y retiros en Venezuela.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Reparto al Ganador del Torneo (%)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="95"
                    value={winnerPotPercentInput}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 80;
                      setWinnerPotPercentInput(val);
                      setPlatformPotPercentInput(100 - val);
                    }}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-purple-400 focus:outline-none"
                  />
                  <span className="text-[11px] text-amber-300 font-mono-tech mt-1 block">
                    Por defecto: 80% Ganador
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Comisión Plataforma / Servidores (%)
                  </label>
                  <input
                    type="number"
                    disabled
                    value={platformPotPercentInput}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-cyan-300 font-orbitron font-bold text-sm"
                  />
                  <span className="text-[11px] text-cyan-400 font-mono-tech mt-1 block">
                    Por defecto: 20% Mantenimiento
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    🪙 Comisión Fija Retiros USDT (Red Tron TRC-20) ($ USD)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="10"
                    value={usdtFeeInput}
                    onChange={(e) => setUsdtFeeInput(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-emerald-400 font-orbitron font-bold text-sm focus:border-purple-400 focus:outline-none"
                  />
                  <span className="text-[11px] text-emerald-300 font-mono-tech mt-1 block">
                    Por defecto: $1.00 USD fijo por retiro
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    🇻🇪 Comisión Retiros Pago Móvil / Bancos (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="15"
                    value={withdrawalFeeInput}
                    onChange={(e) => setWithdrawalFeeInput(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-purple-400 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-400 font-mono-tech mt-1 block">
                    Por defecto: 3% sobre el monto
                  </span>
                </div>
              </div>

              <button
                type="submit"
                id="admin-save-rates-btn"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all"
              >
                GUARDAR Y APLICAR CAMBIOS EN TIEMPO REAL
              </button>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: ROOMS & EVENTS MANAGEMENT */}
        {/* ========================================================================= */}
        {activeTab === 'rooms' && (
          <div className="space-y-4">
            <AdminRoomsManager
              rooms={rooms}
              exchangeRates={exchangeRates}
              onCreateRoom={adminCreateRoom}
              onUpdateRoom={adminUpdateRoom}
              onDeleteRoom={adminDeleteRoom}
              onStartMatch={startMatchNow}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: PUSH NOTIFICATIONS BROADCAST */}
        {/* ========================================================================= */}
        {activeTab === 'broadcast' && (
          <div className="max-w-2xl bg-[#080b20] border-2 border-purple-500/40 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
            <div>
              <h2 className="font-orbitron font-extrabold text-xl text-white">
                Emisor de Notificaciones Push Masivas
              </h2>
              <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
                Envía alertas y campañas de retención instantáneas a los navegadores y teléfonos de todos los jugadores
              </p>
            </div>

            {broadcastSent && (
              <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>¡Notificación push emitida y despachada a todos los jugadores activos!</span>
              </div>
            )}

            <form onSubmit={handleSendBroadcast} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Título de la Notificación
                </label>
                <input
                  type="text"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-purple-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mensaje / Cuerpo de la Notificación
                </label>
                <textarea
                  rows={3}
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-purple-400 focus:outline-none resize-none"
                  required
                />
              </div>

              <button
                type="submit"
                id="admin-send-broadcast-btn"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-600 hover:from-purple-400 hover:to-fuchsia-500 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>EMITIR NOTIFICACIÓN PUSH A TODOS</span>
              </button>
            </form>
          </div>
        )}

        {/* Broadcast Confirmation Modal */}
        {showBroadcastConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="relative w-full max-w-lg bg-[#090d24] border-2 border-purple-500/60 rounded-3xl p-6 sm:p-8 text-slate-100 shadow-2xl">
              <h3 className="font-orbitron font-extrabold text-lg text-white mb-1">
                Confirmar Notificación Push
              </h3>
              <p className="text-xs text-slate-400 font-mono-tech mb-4">
                Revisa el contenido antes de emitirla a todos los jugadores
              </p>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs font-mono-tech mb-4">
                <div>
                  <span className="text-slate-400 block mb-0.5">Título:</span>
                  <span className="text-white font-bold">{broadcastTitle}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Mensaje:</span>
                  <span className="text-slate-200">{broadcastMsg}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowBroadcastConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-orbitron text-xs font-bold"
                >
                  CANCELAR
                </button>
                <button
                  onClick={confirmSendBroadcast}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-600 hover:from-purple-400 hover:to-fuchsia-500 text-white font-orbitron font-extrabold text-xs shadow-[0_0_15px_rgba(168,85,247,0.4)]"
                >
                  CONFIRMAR Y EMITIR
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Inspect Voucher Overlay Modal */}
      {inspectTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg bg-[#090d24] border-2 border-cyan-500/60 rounded-3xl p-6 sm:p-8 text-slate-100 shadow-2xl">
            <h3 className="font-orbitron font-extrabold text-lg text-white mb-1">
              Inspección de Comprobante de Pago
            </h3>
            <p className="text-xs text-slate-400 font-mono-tech mb-4">
              Verifica los datos bancarios antes de autorizar la acreditación
            </p>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-xs font-mono-tech mb-4">
              <div className="flex justify-between">
                <span className="text-slate-400">Usuario:</span>
                <span className="text-white font-bold">{inspectTx.userName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Teléfono:</span>
                <span className="text-cyan-400">{inspectTx.userPhone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Monto USD:</span>
                <span className="text-emerald-400 font-bold font-orbitron">${inspectTx.amountUSD.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Monto en Bolívares:</span>
                <span className="text-cyan-300 font-bold">Bs. {inspectTx.amountVES.toLocaleString('es-VE')} VES</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Número de Referencia:</span>
                <span className="text-white font-bold text-sm bg-slate-800 px-2 py-0.5 rounded">{inspectTx.referenceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Banco Emisor:</span>
                <span>{inspectTx.receiptDetails?.originBank || 'Banco Mercantil'}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Notas del Administrador
              </label>
              <input
                type="text"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setInspectTx(null)}
                className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-orbitron text-xs font-bold"
              >
                CERRAR
              </button>
              <button
                onClick={() => { setConfirmTx(inspectTx); setConfirmAction('approve'); setConfirmInput(''); setInspectTx(null); }}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-orbitron font-extrabold text-xs shadow-[0_0_15px_rgba(16,185,129,0.4)]"
              >
                APROBAR Y ACREDITAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Action Confirmation Modal */}
      {confirmTx && confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg bg-[#090d24] border-2 border-amber-500/60 rounded-3xl p-6 sm:p-8 text-slate-100 shadow-2xl">
            <h3 className="font-orbitron font-extrabold text-lg text-white mb-1">
              {confirmAction === 'approve' ? 'Confirmar Aprobación' : 'Confirmar Rechazo'}
            </h3>
            <p className="text-xs text-slate-400 font-mono-tech mb-4">
              Revisa los detalles de la transacción antes de continuar
            </p>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-xs font-mono-tech mb-4">
              <div className="flex justify-between">
                <span className="text-slate-400">Usuario:</span>
                <span className="text-white font-bold">{confirmTx.userName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tipo:</span>
                <span className={confirmTx.type === 'deposit' ? 'text-cyan-400' : 'text-rose-400'}>
                  {confirmTx.type === 'deposit' ? 'Depósito' : 'Retiro'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Monto:</span>
                <span className="text-emerald-400 font-bold font-orbitron">${confirmTx.amountUSD.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Referencia:</span>
                <span className="text-white font-bold text-sm bg-slate-800 px-2 py-0.5 rounded">{confirmTx.referenceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Acción:</span>
                <span className={confirmAction === 'approve' ? 'text-emerald-400' : 'text-rose-400 font-bold'}>
                  {confirmAction === 'approve' ? 'APROBAR' : 'RECHAZAR'}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Escribe "CONFIRMAR" para {confirmAction === 'approve' ? 'aprobar' : 'rechazar'} esta transacción
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                placeholder="Escribe CONFIRMAR aquí..."
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => { setConfirmTx(null); setConfirmAction(null); setConfirmInput(''); }}
                className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-orbitron text-xs font-bold hover:bg-slate-700"
              >
                CANCELAR
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={confirmInput !== 'CONFIRMAR'}
                className="flex-1 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-orbitron font-extrabold text-xs shadow-[0_0_15px_rgba(245,158,11,0.4)] disabled:shadow-none transition-all"
              >
                CONFIRMAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={logout}
      />
    </div>
  );
};
