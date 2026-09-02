import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PaymentMethodType, Transaction } from '../../types';
import {
  X,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Copy,
  Check,
  Upload,
  ShieldCheck,
  Lock,
  DollarSign,
  Building,
  Smartphone,
  Coins,
  UserCheck,
} from 'lucide-react';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'deposit' | 'withdraw' | 'history';
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'deposit',
}) => {
  const {
    currentUser,
    exchangeRates,
    transactions,
    requestDeposit,
    requestWithdrawal,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'history'>(initialTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Deposit Form State
  const [depositMethod, setDepositMethod] = useState<PaymentMethodType>('pago_movil');
  const [depositAmountUSD, setDepositAmountUSD] = useState<number>(20);
  const [depositRefNumber, setDepositRefNumber] = useState<string>('');
  const [depositOriginBank, setDepositOriginBank] = useState<string>('0105 - Banco Mercantil');
  const [depositSenderId, setDepositSenderId] = useState<string>(currentUser?.idCard || '');
  const [depositReceiptFileName, setDepositReceiptFileName] = useState<string>('');
  const [depositSubmitting, setDepositSubmitting] = useState<boolean>(false);
  const [depositSuccessMsg, setDepositSuccessMsg] = useState<string | null>(null);

  // Crypto state
  const [selectedCryptoNetwork] = useState<string>('USDT (Tron TRC-20)');
  const [cryptoTxHash, setCryptoTxHash] = useState<string>('');

  // Withdrawal Form State (Player's Personal Payout Information)
  const [withdrawMethod, setWithdrawMethod] = useState<PaymentMethodType>('pago_movil');
  const [withdrawAmountUSD, setWithdrawAmountUSD] = useState<number>(20);
  
  // Specific player withdrawal fields
  const [playerWithdrawBank, setPlayerWithdrawBank] = useState<string>(
    currentUser?.pagoMovilBank || '0102 - Banco de Venezuela'
  );
  const [playerWithdrawPhone, setPlayerWithdrawPhone] = useState<string>(
    currentUser?.phone || ''
  );
  const [playerWithdrawIdCard, setPlayerWithdrawIdCard] = useState<string>(
    currentUser?.idCard || ''
  );
  const [playerWithdrawUsdt, setPlayerWithdrawUsdt] = useState<string>(
    currentUser?.usdtWallet && !currentUser.usdtWallet.startsWith('TMPtq') ? currentUser.usdtWallet : ''
  );
  const [playerWithdrawIntl, setPlayerWithdrawIntl] = useState<string>('');
  const [withdrawAccountHolder, setWithdrawAccountHolder] = useState<string>(
    currentUser?.name || ''
  );
  const [withdrawSecurityPin, setWithdrawSecurityPin] = useState<string>('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState<boolean>(false);
  const [withdrawSuccessMsg, setWithdrawSuccessMsg] = useState<string | null>(null);

  // Receipt Modal State
  const [selectedVoucherTx, setSelectedVoucherTx] = useState<Transaction | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleAutoFillPlayerProfile = () => {
    if (!currentUser) return;
    if (withdrawMethod === 'pago_movil') {
      if (currentUser.pagoMovilBank) setPlayerWithdrawBank(currentUser.pagoMovilBank);
      if (currentUser.phone) setPlayerWithdrawPhone(currentUser.phone);
      if (currentUser.idCard) setPlayerWithdrawIdCard(currentUser.idCard);
      if (currentUser.name) setWithdrawAccountHolder(currentUser.name);
    } else if (withdrawMethod === 'usdt_trc20') {
      if (currentUser.usdtWallet) setPlayerWithdrawUsdt(currentUser.usdtWallet);
      if (currentUser.name) setWithdrawAccountHolder(currentUser.name);
    }
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (depositAmountUSD <= 0) {
      alert('Ingresa un monto válido mayor a 0');
      return;
    }
    if (!depositRefNumber.trim()) {
      alert('Por favor ingresa el número de referencia del comprobante');
      return;
    }

    setDepositSubmitting(true);
    try {
      await requestDeposit({
        amountUSD: depositAmountUSD,
        method: depositMethod,
        referenceNumber: depositRefNumber,
        receiptUrl: depositReceiptFileName ? `https://storage.neonclash.io/receipts/${depositRefNumber}.png` : undefined,
        details: {
          originBank: depositOriginBank,
          senderIdCard: depositSenderId,
          ...(depositMethod.startsWith('usdt')
            ? { cryptoNetwork: selectedCryptoNetwork, cryptoTxHash: cryptoTxHash }
            : {}),
        },
      });

      setDepositSuccessMsg(
        `¡Comprobante enviado exitosamente! El Administrador verificará la referencia (${depositRefNumber}) para acreditar $${depositAmountUSD.toFixed(2)} USD automáticamente.`
      );
      setDepositRefNumber('');
      setDepositReceiptFileName('');
      setCryptoTxHash('');
    } catch (err: unknown) {
      alert((err as Error).message || 'Error enviando comprobante');
    } finally {
      setDepositSubmitting(false);
    }
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (withdrawAmountUSD <= 0 || withdrawAmountUSD > currentUser.balanceUSD) {
      alert('Monto a retirar excede tu balance disponible');
      return;
    }
    if (!withdrawSecurityPin || withdrawSecurityPin.length < 4) {
      alert('Ingresa tu PIN de seguridad encriptado de 4 dígitos');
      return;
    }

    // Build destination string based on player's chosen method
    let destinationFormatted = '';
    if (withdrawMethod === 'pago_movil') {
      if (!playerWithdrawPhone.trim() || !playerWithdrawIdCard.trim() || !withdrawAccountHolder.trim()) {
        alert('Por favor completa todos los datos de tu Pago Móvil (Teléfono, Cédula y Titular)');
        return;
      }
      destinationFormatted = `${playerWithdrawPhone} / ${playerWithdrawBank} / ${playerWithdrawIdCard}`;
    } else if (withdrawMethod === 'usdt_trc20') {
      if (!playerWithdrawUsdt.trim()) {
        alert('Por favor ingresa tu dirección de billetera USDT (Tron TRC-20)');
        return;
      }
      destinationFormatted = `${playerWithdrawUsdt} (Red Tron TRC-20)`;
    } else {
      if (!playerWithdrawIntl.trim()) {
        alert('Por favor ingresa los datos de tu cuenta o correo Zelle');
        return;
      }
      destinationFormatted = playerWithdrawIntl;
    }

    setWithdrawSubmitting(true);
    try {
      await requestWithdrawal({
        amountUSD: withdrawAmountUSD,
        method: withdrawMethod,
        destinationAddressOrBank: destinationFormatted,
        accountHolder: withdrawAccountHolder,
        securityPin: withdrawSecurityPin,
      });

      setWithdrawSuccessMsg(
        `¡Solicitud de retiro registrada con éxito! Los fondos de $${withdrawAmountUSD.toFixed(2)} USD serán transferidos a tu cuenta (${destinationFormatted}) tras la validación de seguridad.`
      );
      setWithdrawSecurityPin('');
    } catch (err: unknown) {
      alert((err as Error).message || 'Error procesando retiro');
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  // Filter user transactions
  const userTransactions = transactions.filter(
    (t) => currentUser && (t.userId === currentUser.id || t.userName === currentUser.name)
  );

  const filteredTxs = userTransactions.filter((t) => {
    if (filterType === 'all') return true;
    return t.type === filterType;
   });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#090c20] border-2 border-cyan-500/40 rounded-3xl shadow-[0_0_50px_rgba(6,182,212,0.3)] my-8 overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="p-5 sm:p-6 border-b border-cyan-500/20 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-orbitron font-extrabold text-lg text-white">Bóveda & Finanzas</h3>
              <p className="text-xs text-slate-400 font-mono-tech">
                Recargas en tiempo real, retiros y comprobantes
              </p>
            </div>
          </div>
          <button
            id="wallet-modal-close-btn"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Balance Bar & Exchange Rate Banner */}
        <div className="px-6 py-3 bg-gradient-to-r from-cyan-950/40 via-blue-950/40 to-purple-950/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Saldo Disponible:</span>
            <span className="font-orbitron font-bold text-cyan-300 text-sm">
              ${currentUser?.balanceUSD.toFixed(2)} USD
            </span>
            <span className="text-slate-400 font-mono-tech">
              (Bs. {((currentUser?.balanceUSD || 0) * exchangeRates.vesUsdRate).toLocaleString('es-VE', { maximumFractionDigits: 2 })} VES)
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-cyan-500/30 text-cyan-400 font-mono-tech text-[11px]">
            <span>🇻🇪 Tasa USD/VES:</span>
            <span className="font-bold font-orbitron">{exchangeRates.vesUsdRate.toFixed(2)} Bs</span>
          </div>
        </div>

        {/* Tabs: Recargar, Retirar, Historial */}
        <div className="flex border-b border-slate-800 bg-[#070917]">
          <button
            id="wallet-tab-deposit"
            onClick={() => {
              setActiveTab('deposit');
              setDepositSuccessMsg(null);
            }}
            className={`flex-1 py-3 font-orbitron text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'deposit'
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Recargar Fondos</span>
          </button>
          <button
            id="wallet-tab-withdraw"
            onClick={() => {
              setActiveTab('withdraw');
              setWithdrawSuccessMsg(null);
            }}
            className={`flex-1 py-3 font-orbitron text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'withdraw'
                ? 'text-rose-400 border-b-2 border-rose-400 bg-rose-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Retirar Ganancias</span>
          </button>
          <button
            id="wallet-tab-history"
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 font-orbitron text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'history'
                ? 'text-yellow-400 border-b-2 border-yellow-400 bg-yellow-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historial de Movimientos</span>
          </button>
        </div>

        {/* TAB 1: RECARGAR FONDOS (DEPOSITS) */}
        {activeTab === 'deposit' && (
          <div className="p-6 space-y-5 max-h-[68vh] overflow-y-auto">
            {depositSuccessMsg && (
              <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 text-xs flex items-start gap-2.5 animate-fade-in">
                <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white mb-0.5">¡Solicitud Registrada!</p>
                  <p>{depositSuccessMsg}</p>
                </div>
              </div>
            )}

            {/* Method Selector */}
            <div>
              <label className="block text-xs font-orbitron font-bold text-slate-300 mb-2">
                Selecciona Método de Pago
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDepositMethod('pago_movil')}
                  className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                    depositMethod === 'pago_movil'
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Smartphone className="w-5 h-5" />
                  <span className="text-xs font-bold">🇻🇪 Pago Móvil</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDepositMethod('usdt_trc20')}
                  className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                    depositMethod === 'usdt_trc20'
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Coins className="w-5 h-5" />
                  <span className="text-xs font-bold">🪙 Cripto USDT</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDepositMethod('international_wire')}
                  className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                    depositMethod === 'international_wire'
                      ? 'bg-purple-500/20 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Building className="w-5 h-5" />
                  <span className="text-xs font-bold">🌐 Banco Int. / Zelle</span>
                </button>
              </div>
            </div>

            {/* Method Instructions Box */}
            {depositMethod === 'pago_movil' && (
              <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-cyan-500/20">
                  <div>
                    <span className="text-xs font-orbitron font-bold text-cyan-300 block">
                      Datos Oficiales de Recepción (Plataforma)
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono-tech">
                      Transfiere a cualquiera de estas cuentas oficiales
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-tech font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/30">
                    1 USD = {exchangeRates.vesUsdRate.toFixed(2)} Bs
                  </span>
                </div>

                <div className="space-y-2">
                  {exchangeRates.pagoMovilAccounts.map((acc, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-xs hover:border-cyan-500/40 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-white">{acc.bankName}</p>
                          {idx === 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[9px] font-mono-tech font-bold">
                              PRINCIPAL
                            </span>
                          )}
                        </div>
                        <p className="text-slate-300 font-mono-tech text-[11px] mt-0.5">
                          Tel: <strong className="text-cyan-300">{acc.phone}</strong> | Cédula: <strong className="text-cyan-300">{acc.idCard}</strong>
                        </p>
                        <p className="text-slate-400 text-[10px]">Titular: {acc.holderName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(`${acc.phone} ${acc.idCard} ${acc.bankCode}`, `pm_${idx}`)}
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-mono-tech text-[10px] font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                        title="Copiar datos de pago móvil"
                      >
                        {copiedKey === `pm_${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === `pm_${idx}` ? 'Copiado' : 'Copiar'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {depositMethod === 'usdt_trc20' && (
              <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-emerald-500/20">
                  <div>
                    <span className="text-xs font-orbitron font-bold text-emerald-300 block">
                      Billetera Oficial de Recepción Binance USDT
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono-tech">
                      Red Tron (TRC-20) sin comisión interna Binance
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-yellow-950 text-yellow-300 border border-yellow-500/40 text-[10px] font-mono-tech font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                    BINANCE VERIFICADO
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-600 p-2 shrink-0 flex items-center justify-center text-slate-950 font-black text-[10px] shadow-md">
                      BINANCE
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-mono-tech">Dirección Oficial USDT (Tron TRC-20):</p>
                      <p className="text-xs font-mono-tech font-bold text-emerald-300 truncate select-all my-0.5">
                        {exchangeRates.usdtWallets[0]?.address || 'TMPtqWe3Rtgv8PvoGKoBeLREzYg6hK8K3E'}
                      </p>
                      <p className="text-[10px] text-slate-400">Titular Plataforma: Edgar López</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(exchangeRates.usdtWallets[0]?.address || 'TMPtqWe3Rtgv8PvoGKoBeLREzYg6hK8K3E', 'usdt_addr')}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-mono-tech text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer w-full sm:w-auto justify-center"
                  >
                    {copiedKey === 'usdt_addr' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedKey === 'usdt_addr' ? '¡Dirección Copiada!' : 'Copiar Dirección'}</span>
                  </button>
                </div>
              </div>
            )}

            {depositMethod === 'international_wire' && (
              <div className="p-4 rounded-2xl bg-purple-950/30 border border-purple-500/30 space-y-2 text-xs">
                <p className="font-orbitron font-bold text-purple-300">
                  Transferencia Internacional / Zelle Directo
                </p>
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                  <p><span className="text-slate-400">Beneficiario:</span> {exchangeRates.internationalBank.beneficiary}</p>
                  <p><span className="text-slate-400">Banco:</span> {exchangeRates.internationalBank.bankName}</p>
                  <p><span className="text-slate-400">Zelle / Swift:</span> <span className="font-mono-tech text-purple-300 font-bold">{exchangeRates.internationalBank.routingOrSwift}</span></p>
                </div>
              </div>
            )}

            {/* Deposit Submission Form */}
            <form onSubmit={handleDepositSubmit} className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Monto a Recargar (USD)
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={depositAmountUSD}
                      onChange={(e) => setDepositAmountUSD(Math.max(1, parseFloat(e.target.value) || 0))}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-cyan-400 focus:outline-none"
                      required
                    />
                  </div>
                  {depositMethod === 'pago_movil' && (
                    <span className="text-[11px] text-cyan-400 font-mono-tech mt-1 block">
                      = Bs. {(depositAmountUSD * exchangeRates.vesUsdRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })} VES a transferir
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Número de Referencia del Pago
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 00984129 o Hash TXID"
                    value={depositRefNumber}
                    onChange={(e) => setDepositRefNumber(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-sm focus:border-cyan-400 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {depositMethod === 'pago_movil' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Banco Emisor (Tu Banco)
                    </label>
                    <select
                      value={depositOriginBank}
                      onChange={(e) => setDepositOriginBank(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="Banco Mercantil">Banco Mercantil (0105)</option>
                      <option value="Banesco">Banesco (0134)</option>
                      <option value="Banco de Venezuela">Banco de Venezuela (0102)</option>
                      <option value="BBVA Provincial">BBVA Provincial (0108)</option>
                      <option value="Bancaribe">Bancaribe (0114)</option>
                      <option value="BNC Banco Nacional de Crédito">BNC (0191)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Cédula del Titular Pagador
                    </label>
                    <input
                      type="text"
                      placeholder="V-28190334"
                      value={depositSenderId}
                      onChange={(e) => setDepositSenderId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-xs focus:border-cyan-400 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Upload Comprobante Screenshot */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Comprobante o Captura de Pago (Requerido para Validación)
                </label>
                <div className="relative border-2 border-dashed border-slate-700 hover:border-cyan-500/60 rounded-2xl p-4 text-center cursor-pointer bg-slate-900/40 transition-colors">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setDepositReceiptFileName(e.target.files[0].name);
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center gap-1.5 text-xs text-slate-400">
                    <Upload className="w-6 h-6 text-cyan-400" />
                    <span className="font-semibold text-slate-200">
                      {depositReceiptFileName || 'Arrastra tu captura aquí o haz clic para seleccionar'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono-tech">
                      JPG, PNG o PDF (Comprobante electrónico)
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                id="deposit-submit-btn"
                disabled={depositSubmitting}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-extrabold text-sm tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-5 h-5" />
                <span>{depositSubmitting ? 'ENVIANDO A VALIDACIÓN...' : 'CONFIRMAR Y ENVIAR COMPROBANTE'}</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: RETIRAR GANANCIAS (WITHDRAWALS) */}
        {activeTab === 'withdraw' && (
          <div className="p-6 space-y-5 max-h-[68vh] overflow-y-auto">
            {withdrawSuccessMsg && (
              <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 text-xs flex items-start gap-2.5 animate-fade-in">
                <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-white mb-0.5">¡Retiro en Trámite!</p>
                  <p>{withdrawSuccessMsg}</p>
                </div>
              </div>
            )}

            {/* Security Guarantee Badge */}
            <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 flex items-center gap-3 text-xs">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-slate-300 text-[11px]">
                <p className="font-bold text-white">Encriptación de Extremo a Extremo & Seguridad PIN</p>
                <p className="text-slate-400">
                  Tus retiros están protegidos contra accesos no autorizados mediante autenticación cifrada.
                </p>
              </div>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="space-y-4">
              {/* Select Withdrawal Destination Method */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-orbitron font-bold text-slate-300">
                    Método para Recibir Fondos
                  </label>
                  {currentUser && (
                    <button
                      type="button"
                      onClick={handleAutoFillPlayerProfile}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono-tech flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Cargar datos de mi perfil</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setWithdrawMethod('pago_movil')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      withdrawMethod === 'pago_movil'
                        ? 'bg-rose-500/20 border-rose-400 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Smartphone className="w-5 h-5" />
                    <span className="text-xs font-bold">🇻🇪 Pago Móvil</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWithdrawMethod('usdt_trc20')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      withdrawMethod === 'usdt_trc20'
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Coins className="w-5 h-5" />
                    <span className="text-xs font-bold">🪙 USDT TRC20</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWithdrawMethod('international_wire')}
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      withdrawMethod === 'international_wire'
                        ? 'bg-purple-500/20 border-purple-400 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Building className="w-5 h-5" />
                    <span className="text-xs font-bold">🌐 Cuenta Bancaria</span>
                  </button>
                </div>
              </div>

              {/* Amount USD & Dynamic Fee Calculation */}
              {(() => {
                const isUsdtWithdraw = withdrawMethod === 'usdt_trc20' || withdrawMethod === 'usdt_bep20';
                const feeUSD = isUsdtWithdraw
                  ? (exchangeRates.usdtWithdrawalFeeUSD ?? 1.00)
                  : (withdrawAmountUSD * (exchangeRates.withdrawalFeePercent / 100));
                const netUSD = Math.max(0, withdrawAmountUSD - feeUSD);
                const netVES = netUSD * exchangeRates.vesUsdRate;
                const userBalance = currentUser?.balanceUSD || 0;

                return (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-300">
                          Monto a Retirar (Total a debitar de tu saldo)
                        </label>
                        <span className="text-[11px] font-mono-tech text-slate-400">
                          Disponible: <strong className="text-cyan-300">${userBalance.toFixed(2)} USD</strong>
                        </span>
                      </div>
                      <div className="relative">
                        <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          type="number"
                          min={isUsdtWithdraw ? 2 : 5}
                          max={userBalance}
                          step="1"
                          value={withdrawAmountUSD}
                          onChange={(e) => setWithdrawAmountUSD(parseFloat(e.target.value) || 0)}
                          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-rose-400 focus:outline-none"
                          required
                        />
                      </div>
                    </div>

                    {/* Quick Amount Suggestion Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] font-mono-tech text-slate-400 mr-1">Sugeridos:</span>
                      {isUsdtWithdraw ? (
                        <>
                          {[
                            { debit: 6, net: 5 },
                            { debit: 11, net: 10 },
                            { debit: 21, net: 20 },
                            { debit: 51, net: 50 },
                          ].map((item) => (
                            <button
                              key={item.debit}
                              type="button"
                              onClick={() => setWithdrawAmountUSD(item.debit)}
                              disabled={userBalance < item.debit}
                              className={`px-2 py-1 rounded-lg text-[10px] font-mono-tech font-bold transition-all cursor-pointer ${
                                withdrawAmountUSD === item.debit
                                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                                  : userBalance >= item.debit
                                  ? 'bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-950 text-slate-600 border border-slate-800 cursor-not-allowed opacity-50'
                              }`}
                              title={`Debita $${item.debit} y recibes $${item.net} USDT`}
                            >
                              Recibir ${item.net} USDT (Debita ${item.debit})
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          {[10, 20, 50, 100].map((amt) => (
                            <button
                              key={amt}
                              type="button"
                              onClick={() => setWithdrawAmountUSD(amt)}
                              disabled={userBalance < amt}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono-tech font-bold transition-all cursor-pointer ${
                                withdrawAmountUSD === amt
                                  ? 'bg-rose-500 text-white'
                                  : userBalance >= amt
                                  ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700'
                                  : 'bg-slate-950 text-slate-600 border border-slate-800 cursor-not-allowed opacity-50'
                              }`}
                            >
                              ${amt} USD
                            </button>
                          ))}
                        </>
                      )}
                      {userBalance > (isUsdtWithdraw ? 1 : 0) && (
                        <button
                          type="button"
                          onClick={() => setWithdrawAmountUSD(Math.floor(userBalance))}
                          className="px-2 py-1 rounded-lg text-[10px] font-mono-tech font-bold bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 cursor-pointer"
                        >
                          Todo (${Math.floor(userBalance)})
                        </button>
                      )}
                    </div>

                    {/* Live Calculation Breakdown Box */}
                    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-mono-tech">Monto solicitado (a debitar):</span>
                        <span className="font-orbitron font-bold text-white">${withdrawAmountUSD.toFixed(2)} USD</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-amber-400 font-mono-tech flex items-center gap-1">
                          <span>
                            {isUsdtWithdraw
                              ? 'Comisión fija de Red Tron (TRC-20):'
                              : `Comisión Plataforma (${exchangeRates.withdrawalFeePercent}%):`}
                          </span>
                        </span>
                        <span className="font-mono-tech font-bold text-rose-400">
                          -${feeUSD.toFixed(2)} USD
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                        <span className="text-xs font-orbitron font-bold text-emerald-300">
                          {isUsdtWithdraw ? 'Total Neto a Recibir en tu Billetera:' : 'Neto a Transferir a tu Cuenta:'}
                        </span>
                        <div className="text-right">
                          <span className="font-orbitron font-extrabold text-sm text-emerald-400 block">
                            ${netUSD.toFixed(2)} {isUsdtWithdraw ? 'USDT' : 'USD'}
                          </span>
                          {!isUsdtWithdraw && (
                            <span className="text-[10px] text-slate-400 font-mono-tech">
                              ≈ {netVES.toFixed(2)} Bs
                            </span>
                          )}
                        </div>
                      </div>

                      {isUsdtWithdraw && (
                        <div className="mt-2 p-2 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[10px] text-amber-200/90 font-mono-tech leading-relaxed">
                          💡 <strong>Regla de Comisión USDT:</strong> Los retiros en cripto tienen una tarifa de red fija de <strong>$1.00 USDT</strong>. Por ejemplo, para recibir <strong>$10.00 USDT netos</strong> debes tener y solicitar <strong>$11.00 USD</strong>; si solicitas <strong>$10.00 USD</strong> recibirás <strong>$9.00 USDT</strong>.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Player Payout Specific Fields */}
              {withdrawMethod === 'pago_movil' && (
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-rose-500/30 space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-xs font-orbitron font-bold text-rose-300">
                    <Smartphone className="w-4 h-4" />
                    <span>Datos de Pago Móvil del Jugador (Receptor)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Banco Receptor del Jugador
                      </label>
                      <select
                        value={playerWithdrawBank}
                        onChange={(e) => setPlayerWithdrawBank(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:border-rose-400 focus:outline-none"
                      >
                        <option value="0102 - Banco de Venezuela">0102 - Banco de Venezuela</option>
                        <option value="0105 - Banco Mercantil">0105 - Banco Mercantil</option>
                        <option value="0134 - Banesco">0134 - Banesco</option>
                        <option value="0108 - Banco Provincial (BBVA)">0108 - Banco Provincial (BBVA)</option>
                        <option value="0172 - Bancamiga">0172 - Bancamiga</option>
                        <option value="0191 - Banco Nacional de Crédito (BNC)">0191 - Banco Nacional de Crédito (BNC)</option>
                        <option value="0114 - Bancaribe">0114 - Bancaribe</option>
                        <option value="0115 - Banco Exterior">0115 - Banco Exterior</option>
                        <option value="0175 - Banco Bicentenario">0175 - Banco Bicentenario</option>
                        <option value="Otro Banco">Otro Banco Nacional</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Teléfono Pago Móvil del Jugador
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: 0412-1234567"
                        value={playerWithdrawPhone}
                        onChange={(e) => setPlayerWithdrawPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-tech text-xs focus:border-rose-400 focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Cédula / DNI del Jugador (Titular)
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: V-28123456"
                        value={playerWithdrawIdCard}
                        onChange={(e) => setPlayerWithdrawIdCard(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-tech text-xs focus:border-rose-400 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Nombre y Apellido del Titular
                      </label>
                      <input
                        type="text"
                        placeholder="Nombre completo del titular"
                        value={withdrawAccountHolder}
                        onChange={(e) => setWithdrawAccountHolder(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:border-rose-400 focus:outline-none"
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {withdrawMethod === 'usdt_trc20' && (
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/30 space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-xs font-orbitron font-bold text-emerald-300">
                    <Coins className="w-4 h-4" />
                    <span>Billetera USDT Tron (TRC-20) del Jugador</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Dirección de tu Billetera Personal USDT (Red Tron TRC-20)
                    </label>
                    <input
                      type="text"
                      placeholder="Pega tu dirección (Ej: TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)"
                      value={playerWithdrawUsdt}
                      onChange={(e) => setPlayerWithdrawUsdt(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-tech text-xs focus:border-emerald-400 focus:outline-none"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      ⚠️ Asegúrate de que sea una dirección válida de la red TRON (TRC-20). No se admiten transferencias a contratos no compatibles.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Nombre o Alias del Titular de la Billetera
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Carlos Jugador (Binance / TrustWallet)"
                      value={withdrawAccountHolder}
                      onChange={(e) => setWithdrawAccountHolder(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:border-emerald-400 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              )}

              {withdrawMethod === 'international_wire' && (
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-purple-500/30 space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-xs font-orbitron font-bold text-purple-300">
                    <Building className="w-4 h-4" />
                    <span>Datos Bancarios Internacionales / Zelle del Jugador</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Correo Zelle, IBAN o Número de Cuenta del Jugador
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: zelle@jugador.com o Banco X / Cuenta #..."
                      value={playerWithdrawIntl}
                      onChange={(e) => setPlayerWithdrawIntl(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-tech text-xs focus:border-purple-400 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Nombre Completo del Beneficiario
                    </label>
                    <input
                      type="text"
                      placeholder="Nombre tal como aparece en tu banco/Zelle"
                      value={withdrawAccountHolder}
                      onChange={(e) => setWithdrawAccountHolder(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:border-purple-400 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Security PIN Confirmation */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  PIN de Seguridad Encriptado (4 dígitos)
                </label>
                <div className="relative">
                  <input
                    type="password"
                    maxLength={4}
                    placeholder="••••"
                    value={withdrawSecurityPin}
                    onChange={(e) => setWithdrawSecurityPin(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono-tech text-center tracking-widest text-sm focus:border-rose-400 focus:outline-none"
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-400 text-center mt-1">
                  Ingresa tu PIN de seguridad (por defecto: 1234) para autorizar la transacción
                </p>
              </div>

              <button
                type="submit"
                id="withdraw-submit-btn"
                disabled={withdrawSubmitting || (currentUser?.balanceUSD || 0) < withdrawAmountUSD}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-400 hover:to-pink-500 disabled:opacity-50 text-white font-orbitron font-extrabold text-sm tracking-wider shadow-[0_0_20px_rgba(244,63,94,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{withdrawSubmitting ? 'PROCESANDO RETIRO...' : 'SOLICITAR RETIRO SEGURO'}</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: HISTORIAL DE MOVIMIENTOS */}
        {activeTab === 'history' && (
          <div className="p-6 space-y-4 max-h-[68vh] overflow-y-auto">
            {/* Filter pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              {[
                { key: 'all', label: 'Todos' },
                { key: 'deposit', label: 'Depósitos' },
                { key: 'withdrawal', label: 'Retiros' },
                { key: 'pot_win', label: 'Premios Pote (80%)' },
                { key: 'cosmetic_buy', label: 'Skins & Tienda' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterType(f.key)}
                  className={`px-3 py-1.5 rounded-xl font-orbitron font-bold whitespace-nowrap transition-all ${
                    filterType === f.key
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredTxs.length === 0 ? (
              <div className="text-center py-12 text-slate-500 font-mono-tech text-xs">
                No hay movimientos registrados en esta categoría.
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredTxs.map((tx) => {
                  const isPos = tx.type === 'deposit' || tx.type === 'pot_win';
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setSelectedVoucherTx(tx)}
                      className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 cursor-pointer flex items-center justify-between gap-3 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            tx.type === 'deposit'
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : tx.type === 'pot_win'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : tx.type === 'withdrawal'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-purple-500/20 text-purple-400'
                          }`}
                        >
                          {tx.type === 'deposit' ? (
                            <ArrowDownLeft className="w-4 h-4" />
                          ) : tx.type === 'pot_win' ? (
                            <DollarSign className="w-4 h-4" />
                          ) : tx.type === 'withdrawal' ? (
                            <ArrowUpRight className="w-4 h-4" />
                          ) : (
                            <Coins className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-orbitron font-bold text-xs text-white">
                              {tx.type === 'deposit'
                                ? 'Recarga de Saldo'
                                : tx.type === 'pot_win'
                                ? '🏆 Premio 80% Pote'
                                : tx.type === 'withdrawal'
                                ? 'Retiro de Ganancias'
                                : 'Compra de Cosmético'}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-mono-tech font-bold ${
                                tx.status === 'approved'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                                  : tx.status === 'pending'
                                  ? 'bg-amber-950 text-amber-400 border border-amber-500/40 animate-pulse'
                                  : 'bg-rose-950 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {tx.status === 'approved' ? 'Aprobado' : tx.status === 'pending' ? 'En Revisión' : 'Rechazado'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono-tech mt-0.5">
                            Ref: {tx.referenceNumber} • {new Date(tx.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className={`font-orbitron font-extrabold text-sm ${isPos ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {isPos ? '+' : '-'}${tx.amountUSD.toFixed(2)} USD
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono-tech">
                          ≈ Bs. {tx.amountVES.toLocaleString('es-VE', { maximumFractionDigits: 1 })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Voucher Detail Modal Overlay */}
        {selectedVoucherTx && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-20 p-6 flex flex-col justify-center animate-fade-in">
            <div className="bg-[#0b0e22] border-2 border-cyan-500/60 rounded-3xl p-6 shadow-2xl relative">
              <button
                onClick={() => setSelectedVoucherTx(null)}
                className="absolute top-4 right-4 p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="text-center pb-4 border-b border-slate-800">
                <span className="text-[10px] font-orbitron font-bold text-cyan-400 uppercase tracking-widest">
                  Comprobante Electrónico Oficial
                </span>
                <h4 className="font-orbitron font-extrabold text-xl text-white mt-1">
                  ${selectedVoucherTx.amountUSD.toFixed(2)} USD
                </h4>
                <p className="text-xs text-slate-400 font-mono-tech">
                  ≈ Bs. {selectedVoucherTx.amountVES.toLocaleString('es-VE', { maximumFractionDigits: 2 })} VES
                </p>
              </div>

              <div className="py-4 space-y-2.5 text-xs text-slate-300 font-mono-tech">
                <div className="flex justify-between">
                  <span className="text-slate-500">ID Transacción:</span>
                  <span className="text-white font-bold">{selectedVoucherTx.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Referencia Bancaria:</span>
                  <span className="text-cyan-400 font-bold">{selectedVoucherTx.referenceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Método de Pago:</span>
                  <span className="capitalize">{selectedVoucherTx.method.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estado de Operación:</span>
                  <span className="text-emerald-400 font-bold uppercase">{selectedVoucherTx.status}</span>
                </div>
                {selectedVoucherTx.adminNotes && (
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 mt-2">
                    <span className="text-[10px] text-slate-500 block mb-1">Notas de Verificación Admin:</span>
                    <p className="text-xs text-slate-300">{selectedVoucherTx.adminNotes}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedVoucherTx(null)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-orbitron text-xs font-bold transition-all mt-2"
              >
                CERRAR COMPROBANTE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
