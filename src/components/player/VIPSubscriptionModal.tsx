import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  X,
  Check,
  Crown,
} from 'lucide-react';

interface VIPSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VIPSubscriptionModal: React.FC<VIPSubscriptionModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, subscribeVIP, vipPlans } = useApp();

  if (!isOpen) return null;

  const plans = vipPlans;

  const handleSubscribe = (tier: 'vip_bronze' | 'vip_neon' | 'vip_titan', price: number) => {
    const success = subscribeVIP(tier, price);
    if (success) {
      alert(`¡Felicidades! Tu membresía ${tier.toUpperCase()} ha sido activada.`);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#090b1e] border-2 border-yellow-500/40 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(234,179,8,0.25)] text-slate-100 my-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center max-w-lg mx-auto mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-yellow-500 to-amber-300 mx-auto flex items-center justify-center text-slate-950 mb-3 shadow-[0_0_20px_rgba(234,179,8,0.5)]">
            <Crown className="w-6 h-6" />
          </div>
          <span className="text-xs font-orbitron font-bold text-yellow-400 uppercase tracking-widest">
            Membresías Premium & Beneficios
          </span>
          <h2 className="text-2xl sm:text-3xl font-orbitron font-black text-white mt-1">
            Pase de Batalla VIP Neón
          </h2>
          <p className="text-xs text-slate-400 font-mono-tech mt-1">
            Desbloquea 0% de comisión en retiros bancarios, skins legendarias y auras exclusivas
          </p>
        </div>

        {/* 3 Tier Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => {
            const isCurrent = currentUser?.vipTier === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative rounded-3xl p-6 flex flex-col justify-between border transition-all ${
                  plan.popular
                    ? 'bg-gradient-to-b from-[#111944] via-[#0d1338] to-[#0a0e28] border-2 border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.35)] md:-translate-y-2'
                    : 'bg-[#0a0d24]/90 border border-slate-800 hover:border-slate-700'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-0.5 rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 text-slate-950 font-orbitron font-black text-[10px] uppercase shadow-[0_0_12px_rgba(6,182,212,0.6)]">
                    Más Popular
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-orbitron font-bold text-base text-white">
                      {plan.name}
                    </h3>
                  </div>

                  <div className="my-4 flex items-baseline gap-1">
                    <span className="font-orbitron font-black text-2xl sm:text-3xl text-white">
                      ${plan.priceUSD}
                    </span>
                    <span className="text-xs text-slate-400 font-mono-tech">USD {plan.period}</span>
                  </div>

                  <div className="space-y-2.5 pt-3 border-t border-slate-800/80 text-xs">
                    {plan.perks.map((perk, i) => (
                      <div key={i} className="flex items-start gap-2 text-slate-300">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{perk}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-4">
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-3 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-300 font-orbitron font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                    >
                      <Check className="w-4 h-4" />
                      <span>PLAN ACTIVO</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(plan.id as any, plan.priceUSD)}
                      className={`w-full py-3 rounded-2xl font-orbitron font-black text-xs tracking-wider transition-all shadow-lg ${
                        plan.popular
                          ? 'bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 shadow-[0_0_25px_rgba(6,182,212,0.45)]'
                          : 'bg-[#12173d] hover:bg-[#181f50] border border-cyan-500/30 text-white'
                      }`}
                    >
                      SUSCRIBIRSE POR ${plan.priceUSD}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
