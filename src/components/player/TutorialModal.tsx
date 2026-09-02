import React, { useState } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  CircleDot,
  AlertTriangle,
  Trophy,
  Wallet,
  CheckCircle,
  Play,
} from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<number>(0);

  if (!isOpen) return null;

  const slides = [
    {
      stepNumber: '01',
      title: 'Recolecta Orbes y Aumenta tu Masa',
      tag: 'Mecánica Principal .IO',
      icon: <CircleDot className="w-10 h-10 text-cyan-400" />,
      color: 'border-cyan-500/40 text-cyan-400',
      description:
        'Desplázate con el mouse en PC o el joystick virtual en tu teléfono para absorber orbes de neón brillantes. Cada orbe aumenta tu masa, tamaño y puntuación.',
      highlight:
        '¡Al ser más grande, puedes absorber a jugadores rivales menores y ganar el 60% de su puntuación acumulada!',
      visual: (
        <div className="w-full h-36 rounded-2xl bg-[#060817] border border-cyan-500/30 flex items-center justify-center gap-4 relative overflow-hidden">
          <div className="w-14 h-14 rounded-full bg-cyan-500 shadow-[0_0_20px_#06b6d4] flex items-center justify-center text-xs font-orbitron font-black text-black">
            TÚ
          </div>
          <div className="w-4 h-4 rounded-full bg-rose-500 shadow-[0_0_10px_#f43f5e]" />
          <div className="w-6 h-6 rounded-full bg-yellow-400 shadow-[0_0_12px_#eab308]" />
          <div className="w-3 h-3 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
        </div>
      ),
    },
    {
      stepNumber: '02',
      title: '¡Cuidado con las Paredes y el Encogimiento a los 60s!',
      tag: 'Supervivencia & Duelo Final',
      icon: <AlertTriangle className="w-10 h-10 text-rose-400" />,
      color: 'border-rose-500/40 text-rose-400',
      description:
        'Si tocas la barrera láser exterior de la pared, tu personaje morirá instantáneamente y deberás esperar una penalización de 2 segundos para revivir.',
      highlight:
        'Las partidas duran 3 minutos exactos. Al llegar a los 60 segundos restantes, la zona comienza a encogerse rápidamente forzando el enfrentamiento definitivo en el centro.',
      visual: (
        <div className="w-full h-36 rounded-2xl bg-[#060817] border border-rose-500/40 flex items-center justify-center relative overflow-hidden">
          <div className="w-32 h-32 rounded-full border-4 border-dashed border-rose-500 animate-spin flex items-center justify-center shadow-[0_0_25px_rgba(244,63,94,0.5)]">
            <span className="text-[11px] font-orbitron font-bold text-rose-400">ZONA 60s</span>
          </div>
        </div>
      ),
    },
    {
      stepNumber: '03',
      title: 'Pote de Premios: 80% al Ganador y 20% Mantenimiento',
      tag: 'Economía & Recompensas Reales',
      icon: <Trophy className="w-10 h-10 text-yellow-400" />,
      color: 'border-yellow-500/40 text-yellow-400',
      description:
        'Todas las entradas de los jugadores a la sala se suman en un gran pote de recolección en tiempo real.',
      highlight:
        'El jugador que termine en 1er lugar al acabarse los 3 minutos se lleva el 80% del pote directamente a su saldo. El 20% restante se destina al mantenimiento de la plataforma y servidores.',
      visual: (
        <div className="w-full h-36 rounded-2xl bg-[#060817] border border-yellow-500/30 p-4 flex flex-col justify-center gap-2">
          <div className="flex justify-between text-xs font-orbitron font-bold">
            <span className="text-yellow-400">🏆 Ganador: 80% del Pote</span>
            <span className="text-cyan-400">⚙️ Dev: 20% Mantenimiento</span>
          </div>
          <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden flex">
            <div className="bg-yellow-400 h-full w-[80%]" />
            <div className="bg-cyan-500 h-full w-[20%]" />
          </div>
        </div>
      ),
    },
    {
      stepNumber: '04',
      title: 'Recargas Inmediatas por Pago Móvil, USDT y Retiros',
      tag: 'Finanzas Transparentes',
      icon: <Wallet className="w-10 h-10 text-emerald-400" />,
      color: 'border-emerald-500/40 text-emerald-400',
      description:
        'Recarga tu cuenta al instante usando Pago Móvil (Venezuela con tasa en tiempo real), USDT en Binance/TRC20 o transferencia bancaria.',
      highlight:
        'Envía tu comprobante de pago; el Administrador validará la operación para acreditar tus fondos automáticamente. Puedes retirar tus ganancias a cualquier hora con encriptación de extremo a extremo.',
      visual: (
        <div className="w-full h-36 rounded-2xl bg-[#060817] border border-emerald-500/30 p-3 flex items-center justify-around">
          <div className="text-center">
            <span className="text-2xl">🇻🇪</span>
            <p className="text-[10px] font-mono-tech text-slate-300 mt-1">Pago Móvil</p>
          </div>
          <div className="text-center">
            <span className="text-2xl">🪙</span>
            <p className="text-[10px] font-mono-tech text-slate-300 mt-1">USDT Cripto</p>
          </div>
          <div className="text-center">
            <span className="text-2xl">🏦</span>
            <p className="text-[10px] font-mono-tech text-slate-300 mt-1">Bancos Int.</p>
          </div>
        </div>
      ),
    },
  ];

  const currentSlide = slides[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-[#090c22] border-2 border-cyan-500/50 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.3)] text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Slide Step Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 font-orbitron font-bold text-xs">
            PASO {currentSlide.stepNumber} / 04
          </span>
          <span className="text-xs font-mono-tech text-slate-400 uppercase">
            {currentSlide.tag}
          </span>
        </div>

        <h3 className="font-orbitron font-extrabold text-xl sm:text-2xl text-white mb-2">
          {currentSlide.title}
        </h3>

        {/* Visual Showcase Graphic */}
        <div className="my-4">{currentSlide.visual}</div>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-3">
          {currentSlide.description}
        </p>

        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs text-cyan-300 font-semibold mb-6 flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>{currentSlide.highlight}</span>
        </div>

        {/* Bottom Navigation */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`w-3 h-3 rounded-full transition-all ${
                  step === i ? 'w-8 bg-cyan-400 shadow-[0_0_10px_#06b6d4]' : 'bg-slate-700'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron font-bold text-xs flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>
            )}

            {step < slides.length - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-bold text-xs flex items-center gap-1 shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              >
                <span>Siguiente</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-orbitron font-extrabold text-xs flex items-center gap-1 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>¡LISTO PARA JUGAR!</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
