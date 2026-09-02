import React, { useState, useEffect } from 'react';
import { TournamentRoom } from '../../types';
import {
  X,
  Sparkles,
  Trophy,
  Globe,
  Send,
  Crown,
  Shield,
} from 'lucide-react';

const ALPHANUM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 6): string {
  let code = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    code += ALPHANUM_CHARS[array[i] % ALPHANUM_CHARS.length];
  }
  return code;
}

interface AdminRoomModalProps {
  isOpen: boolean;
  roomToEdit: TournamentRoom | null;
  onClose: () => void;
  onSave: (data: {
    id?: string;
    name: string;
    code?: string;
    type: 'public' | 'private';
    entryFeeUSD: number;
    customPotUSD: number;
    maxPlayers: number;
    minPlayersToStart: number;
    durationSeconds: number;
    arenaRadius: number;
    isSpecialEvent: boolean;
    eventDescription?: string;
    sponsorName?: string;
    status?: 'waiting' | 'in_game' | 'finished';
    broadcastNotification?: boolean;
  }) => void;
  exchangeRateVES: number;
}

export const AdminRoomModal: React.FC<AdminRoomModalProps> = ({
  isOpen,
  roomToEdit,
  onClose,
  onSave,
  exchangeRateVES,
}) => {
  const isEditing = !!roomToEdit;

  const [name, setName] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [type, setType] = useState<'public' | 'private'>('public');
  const [entryFeeUSD, setEntryFeeUSD] = useState<number>(1.00);
  const [customPotUSD, setCustomPotUSD] = useState<number>(10.00);
  const [maxPlayers, setMaxPlayers] = useState<number>(15);
  const [minPlayersToStart, setMinPlayersToStart] = useState<number>(4);
  const [durationSeconds, setDurationSeconds] = useState<number>(180);
  const [arenaRadius, setArenaRadius] = useState<number>(1800);
  const [isSpecialEvent, setIsSpecialEvent] = useState<boolean>(false);
  const [eventDescription, setEventDescription] = useState<string>('');
  const [sponsorName, setSponsorName] = useState<string>('');
  const [status, setStatus] = useState<'waiting' | 'in_game' | 'finished'>('waiting');
  const [broadcastNotification, setBroadcastNotification] = useState<boolean>(true);

  // Initialize or reset form values
  useEffect(() => {
    if (roomToEdit) {
      setName(roomToEdit.name);
      setCode(roomToEdit.code);
      setType(roomToEdit.type);
      setEntryFeeUSD(roomToEdit.entryFeeUSD);
      setCustomPotUSD(roomToEdit.potUSD);
      setMaxPlayers(roomToEdit.maxPlayers);
      setMinPlayersToStart(roomToEdit.minPlayersToStart || 4);
      setDurationSeconds(roomToEdit.durationSeconds || 180);
      setArenaRadius(roomToEdit.arenaRadius || 1800);
      setIsSpecialEvent(!!roomToEdit.isSpecialEvent);
      setEventDescription(roomToEdit.eventDescription || '');
      setSponsorName(roomToEdit.sponsorName || '');
      setStatus(roomToEdit.status);
      setBroadcastNotification(false);
    } else {
      // Default new room
      setName('');
      setCode(generateRoomCode(6));
      setType('public');
      setEntryFeeUSD(1.00);
      setCustomPotUSD(10.00);
      setMaxPlayers(15);
      setMinPlayersToStart(4);
      setDurationSeconds(180);
      setArenaRadius(1800);
      setIsSpecialEvent(false);
      setEventDescription('');
      setSponsorName('');
      setStatus('waiting');
      setBroadcastNotification(true);
    }
  }, [roomToEdit, isOpen]);

  // Quick preset loader
  const applyPreset = (presetType: 'free_event' | 'duel_quick' | 'pro_tourney' | 'master_event') => {
    if (presetType === 'free_event') {
      setName('🎉 Mega Torneo Comunitario ($0 Entrada)');
      setCode(`EVT-${generateRoomCode(5)}`);
      setType('public');
      setEntryFeeUSD(0.00);
      setCustomPotUSD(50.00);
      setMaxPlayers(20);
      setMinPlayersToStart(4);
      setDurationSeconds(240);
      setIsSpecialEvent(true);
      setSponsorName('WinOrbs Esports & Binance Pay');
      setEventDescription('¡Evento especial con pozo patrocinado de $50 USD! Entrada libre para todos los gladiadores.');
      setBroadcastNotification(true);
    } else if (presetType === 'duel_quick') {
      setName('⚡ Duelo Relámpago ($0.50)');
      setCode(`DUEL-${generateRoomCode(4)}`);
      setType('public');
      setEntryFeeUSD(0.50);
      setCustomPotUSD(5.00);
      setMaxPlayers(10);
      setMinPlayersToStart(4);
      setDurationSeconds(120);
      setIsSpecialEvent(false);
      setEventDescription('');
      setSponsorName('');
    } else if (presetType === 'pro_tourney') {
      setName('💎 Copa Diamante ($2.50)');
      setCode(`PRO-${generateRoomCode(4)}`);
      setType('public');
      setEntryFeeUSD(2.50);
      setCustomPotUSD(25.00);
      setMaxPlayers(15);
      setMinPlayersToStart(4);
      setDurationSeconds(180);
      setIsSpecialEvent(false);
      setEventDescription('');
      setSponsorName('');
    } else if (presetType === 'master_event') {
      setName('🔥 Gran Clásico Venezuela ($5.00)');
      setCode(`MASTER-${generateRoomCode(5)}`);
      setType('public');
      setEntryFeeUSD(5.00);
      setCustomPotUSD(75.00);
      setMaxPlayers(15);
      setMinPlayersToStart(4);
      setDurationSeconds(300);
      setIsSpecialEvent(true);
      setSponsorName('Liga Nacional Neón VZ');
      setEventDescription('Torneo de alta competitividad con pozo estelar y trofeo virtual.');
      setBroadcastNotification(true);
    }
  };

  if (!isOpen) return null;

  const winner80Percent = customPotUSD * 0.8;
  const entryFeeVES = entryFeeUSD * exchangeRateVES;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Por favor ingresa un nombre para la sala.');
      return;
    }
    if (entryFeeUSD < 0) {
      alert('La entrada no puede ser negativa.');
      return;
    }
    if (customPotUSD < 0) {
      alert('El pote no puede ser negativo.');
      return;
    }
    if (maxPlayers < 2 || maxPlayers > 50) {
      alert('La capacidad máxima debe estar entre 2 y 50 jugadores.');
      return;
    }
    if (arenaRadius < 500) {
      alert('El radio de la arena debe ser al menos 500px.');
      return;
    }

    onSave({
      id: roomToEdit?.id,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      type,
      entryFeeUSD,
      customPotUSD,
      maxPlayers,
      minPlayersToStart,
      durationSeconds,
      arenaRadius,
      isSpecialEvent,
      eventDescription: isSpecialEvent ? eventDescription.trim() : undefined,
      sponsorName: isSpecialEvent ? sponsorName.trim() : undefined,
      status,
      broadcastNotification,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#090d26] border-2 border-purple-500/60 rounded-3xl p-5 sm:p-7 text-slate-100 shadow-[0_0_50px_rgba(168,85,247,0.35)] my-8">
        {/* Close Button */}
        <button
          onClick={onClose}
          type="button"
          className="absolute top-5 right-5 p-2 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-fuchsia-500 flex items-center justify-center text-white shadow-[0_0_15px_rgba(168,85,247,0.5)] shrink-0">
            {isSpecialEvent ? <Sparkles className="w-6 h-6" /> : <Trophy className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="font-orbitron font-extrabold text-lg sm:text-xl text-white">
              {isEditing ? `✏️ Editar Sala de Juego` : `➕ Crear Nueva Sala / Evento Especial`}
            </h3>
            <p className="text-xs text-slate-400 font-mono-tech">
              {isEditing
                ? `Modificando parámetros de "${roomToEdit.name}"`
                : `Configura salas públicas, privadas o eventos con pozo garantizado`}
            </p>
          </div>
        </div>

        {/* Presets Quick Bar (Only for new rooms) */}
        {!isEditing && (
          <div className="mb-5 p-3 rounded-2xl bg-slate-950/80 border border-purple-500/30 space-y-2">
            <span className="text-[11px] font-orbitron font-bold text-purple-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
              Plantillas Rápidas Pre-configuradas:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <button
                type="button"
                onClick={() => applyPreset('free_event')}
                className="p-2 rounded-xl bg-purple-950/60 hover:bg-purple-900 border border-purple-500/40 text-purple-200 font-mono-tech font-bold text-left hover:border-yellow-400 transition-all text-[11px]"
              >
                🎉 Evento $0 ($50 Pote)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('duel_quick')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 font-mono-tech font-bold text-left hover:border-cyan-400 transition-all text-[11px]"
              >
                ⚡ Duelo $0.50 (2 min)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('pro_tourney')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-blue-300 font-mono-tech font-bold text-left hover:border-blue-400 transition-all text-[11px]"
              >
                💎 Pro $2.50 ($25 Pote)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('master_event')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 font-mono-tech font-bold text-left hover:border-amber-400 transition-all text-[11px]"
              >
                🔥 Master $5.00 ($75 Pote)
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-sans">
          {/* Room Category Toggle: Standard vs Event */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setIsSpecialEvent(false)}
              className={`py-2.5 rounded-xl font-orbitron font-bold flex items-center justify-center gap-2 transition-all ${
                !isSpecialEvent
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>Sala Estándar</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSpecialEvent(true)}
              className={`py-2.5 rounded-xl font-orbitron font-bold flex items-center justify-center gap-2 transition-all ${
                isSpecialEvent
                  ? 'bg-gradient-to-r from-yellow-500 to-amber-600 text-slate-950 shadow-[0_0_12px_rgba(234,179,8,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crown className="w-4 h-4" />
              <span>🎉 Evento Especial Oficial</span>
            </button>
          </div>

          {/* Row 1: Name & Code */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Nombre de la Sala / Torneo *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej. 🏆 Copa Neón de Caracas"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-xs focus:border-purple-400 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Código de Acceso
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CCS-100"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-cyan-300 font-orbitron font-bold text-xs focus:border-purple-400 focus:outline-none uppercase"
              />
            </div>
          </div>

          {/* Row 2: Type & Entry Fee */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Tipo de Acceso
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'public' | 'private')}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-xs focus:border-purple-400 focus:outline-none"
              >
                <option value="public">🌐 Pública (Lobby Abierto)</option>
                <option value="private">🔒 Privada (Requiere Código)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Entrada por Jugador ($ USD)
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                value={entryFeeUSD}
                onChange={(e) => setEntryFeeUSD(parseFloat(e.target.value) || 0)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-emerald-400 font-orbitron font-bold text-xs focus:border-purple-400 focus:outline-none"
              />
              <span className="text-[10px] text-cyan-300 font-mono-tech mt-0.5 block">
                ≈ Bs. {entryFeeVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Pote Inicial / Total ($ USD)
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={customPotUSD}
                onChange={(e) => setCustomPotUSD(parseFloat(e.target.value) || 0)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-yellow-400 font-orbitron font-bold text-xs focus:border-purple-400 focus:outline-none"
              />
              <span className="text-[10px] text-amber-300 font-mono-tech mt-0.5 block">
                80% Ganador: ${winner80Percent.toFixed(2)} USD
              </span>
            </div>
          </div>

          {/* Row 3: Player Capacity & Duration */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Capacidad Máx.
              </label>
              <input
                type="number"
                min="4"
                max="30"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(parseInt(e.target.value) || 15)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-purple-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Mínimo Inicio
              </label>
              <input
                type="number"
                min="2"
                max="10"
                value={minPlayersToStart}
                onChange={(e) => setMinPlayersToStart(parseInt(e.target.value) || 4)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-purple-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Duración
              </label>
              <select
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 180)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-purple-400 focus:outline-none"
              >
                <option value={120}>2 Minutos (120s)</option>
                <option value={180}>3 Minutos (180s)</option>
                <option value={240}>4 Minutos (240s)</option>
                <option value={300}>5 Minutos (300s)</option>
                <option value={600}>10 Minutos (600s)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Radio Arena (px)
              </label>
              <select
                value={arenaRadius}
                onChange={(e) => setArenaRadius(parseInt(e.target.value) || 1800)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron text-xs focus:border-purple-400 focus:outline-none"
              >
                <option value={1400}>Compacta (1400px)</option>
                <option value={1800}>Estándar (1800px)</option>
                <option value={2200}>Gigante (2200px)</option>
                <option value={2600}>Coliseo (2600px)</option>
              </select>
            </div>
          </div>

          {/* Special Event Custom Details (If Enabled) */}
          {isSpecialEvent && (
            <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-amber-300 font-orbitron font-bold text-xs">
                <Crown className="w-4 h-4 text-yellow-400" />
                <span>Detalles del Evento Especial Patrocinado</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Nombre del Patrocinador / Sponsor
                </label>
                <input
                  type="text"
                  value={sponsorName}
                  onChange={(e) => setSponsorName(e.target.value)}
                  placeholder="ej. Binance Pay / Pago Móvil Venezuela / WinOrbs League"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-amber-500/40 text-amber-200 font-orbitron text-xs focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Descripción / Reglas / Promoción del Evento
                </label>
                <textarea
                  rows={2}
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  placeholder="ej. ¡Torneo oficial de fin de semana con pozo garantizado! El 80% va directo al ganador."
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-amber-500/40 text-white text-xs focus:border-amber-400 focus:outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Edit Mode: Status selector */}
          {isEditing && (
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-orbitron font-bold text-white text-xs block">Estado de la Partida:</span>
                <span className="text-[10px] text-slate-400 font-mono-tech">Control manual del ciclo de juego</span>
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 border border-purple-500/40 text-purple-300 font-orbitron font-bold text-xs focus:outline-none"
              >
                <option value="waiting">⏳ Esperando Jugadores</option>
                <option value="in_game">⚔️ En Combate Activo</option>
                <option value="finished">🏁 Finalizada</option>
              </select>
            </div>
          )}

          {/* Broadcast Notification Checkbox */}
          {!isEditing && (
            <label className="flex items-center gap-2 p-3 rounded-2xl bg-purple-950/30 border border-purple-500/30 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcastNotification}
                onChange={(e) => setBroadcastNotification(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 bg-slate-900 border-slate-700"
              />
              <div className="text-xs">
                <span className="font-orbitron font-bold text-purple-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-fuchsia-400" />
                  Emitir Notificación Push Automática
                </span>
                <span className="text-[11px] text-slate-400 block font-mono-tech">
                  Envía una alerta instantánea al feed y teléfonos de todos los jugadores registrados.
                </span>
              </div>
            </label>
          )}

          {/* Bottom Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron font-bold text-xs transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 via-fuchsia-500 to-indigo-600 hover:brightness-110 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.5)] transition-all flex items-center gap-2 cursor-pointer"
            >
              {isEditing ? (
                <>
                  <Shield className="w-4 h-4" />
                  <span>GUARDAR CAMBIOS</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>CREAR SALA / EVENTO AHORA</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
