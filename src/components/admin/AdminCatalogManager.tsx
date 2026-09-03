import React, { useState } from 'react';
import { CosmeticItem, VIPPlanConfig, GameConfig } from '../../types';
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Save,
  Palette,
  Crown,
  Gamepad2,
  Check,
} from 'lucide-react';

interface AdminCatalogManagerProps {
  skins: CosmeticItem[];
  vipPlans: VIPPlanConfig[];
  gameConfig: GameConfig;
  onAddCosmetic: (item: CosmeticItem) => void;
  onUpdateCosmetic: (id: string, updates: Partial<CosmeticItem>) => void;
  onDeleteCosmetic: (id: string) => void;
  onUpdateVipPlan: (id: VIPPlanConfig['id'], updates: Partial<VIPPlanConfig>) => void;
  onUpdateGameConfig: (updates: Partial<GameConfig>) => void;
}

interface CosmeticFormState {
  id: string;
  name: string;
  type: CosmeticItem['type'];
  priceUSD: number;
  rarity: CosmeticItem['rarity'];
  description: string;
  color: string;
  secondaryColor: string;
  glowColor: string;
  pattern: CosmeticItem['pattern'];
}

const EMPTY_FORM: CosmeticFormState = {
  id: '',
  name: '',
  type: 'skin',
  priceUSD: 2.5,
  rarity: 'rare',
  description: '',
  color: '#06b6d4',
  secondaryColor: '#a855f7',
  glowColor: 'rgba(6, 182, 212, 0.9)',
  pattern: 'pulse',
};

function hexToGlow(hex: string, alpha = 0.9): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(6, 182, 212, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const AdminCatalogManager: React.FC<AdminCatalogManagerProps> = ({
  skins,
  vipPlans,
  gameConfig,
  onAddCosmetic,
  onUpdateCosmetic,
  onDeleteCosmetic,
  onUpdateVipPlan,
  onUpdateGameConfig,
}) => {
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CosmeticFormState>(EMPTY_FORM);
  const [catalogSaved, setCatalogSaved] = useState<boolean>(false);
  const [gameSaved, setGameSaved] = useState<boolean>(false);

  // Gameplay draft state
  const [duration, setDuration] = useState<number>(gameConfig.defaultDurationSeconds);
  const [minPlayers, setMinPlayers] = useState<number>(gameConfig.defaultMinPlayersToStart);
  const [arenaRadius, setArenaRadius] = useState<number>(gameConfig.defaultArenaRadius);
  const [shrinkSeconds, setShrinkSeconds] = useState<number>(gameConfig.defaultShrinkTriggerSeconds);
  const [botCount, setBotCount] = useState<number>(gameConfig.defaultBotCount);
  const [botDifficulty, setBotDifficulty] = useState<'normal' | 'hard'>(gameConfig.defaultBotDifficulty);
  const [minFee, setMinFee] = useState<number>(gameConfig.minEntryFeeUSD);
  const [maxFee, setMaxFee] = useState<number>(gameConfig.maxEntryFeeUSD);
  const [launchWindow, setLaunchWindow] = useState<number>(gameConfig.launchWindowSeconds);

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-purple-400 focus:outline-none';

  const openCreateForm = () => {
    setForm({ ...EMPTY_FORM, id: `skin_${Date.now().toString(36)}` });
    setEditingId(null);
    setShowForm(true);
    setCatalogSaved(false);
  };

  const openEditForm = (item: CosmeticItem) => {
    setForm({
      id: item.id,
      name: item.name,
      type: item.type,
      priceUSD: item.priceUSD,
      rarity: item.rarity,
      description: item.description,
      color: item.color,
      secondaryColor: item.secondaryColor || '#a855f7',
      glowColor: item.glowColor,
      pattern: item.pattern,
    });
    setEditingId(item.id);
    setShowForm(true);
    setCatalogSaved(false);
  };

  const handleColorChange = (hex: string) => {
    setForm((prev) => ({
      ...prev,
      color: hex,
      glowColor: editingId ? prev.glowColor : hexToGlow(hex),
    }));
  };

  const handleCosmeticSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CosmeticItem = {
      id: form.id,
      name: form.name.trim(),
      type: form.type,
      priceUSD: Math.max(0, form.priceUSD),
      rarity: form.rarity,
      description: form.description.trim(),
      color: form.color,
      secondaryColor: form.secondaryColor,
      glowColor: form.glowColor,
      pattern: form.pattern,
    };
    if (editingId) {
      onUpdateCosmetic(editingId, payload);
    } else {
      onAddCosmetic(payload);
    }
    setShowForm(false);
    setEditingId(null);
    setCatalogSaved(true);
    window.setTimeout(() => setCatalogSaved(false), 4000);
  };

  const handleGameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateGameConfig({
      defaultDurationSeconds: Math.max(30, duration),
      defaultMinPlayersToStart: Math.max(2, minPlayers),
      defaultArenaRadius: Math.max(600, arenaRadius),
      defaultShrinkTriggerSeconds: Math.max(10, shrinkSeconds),
      defaultBotCount: Math.max(0, botCount),
      defaultBotDifficulty: botDifficulty,
      minEntryFeeUSD: Math.max(0, minFee),
      maxEntryFeeUSD: Math.max(0.1, maxFee),
      launchWindowSeconds: Math.max(60, launchWindow),
    });
    setGameSaved(true);
    window.setTimeout(() => setGameSaved(false), 4000);
  };

  return (
    <div className="space-y-6">
{/* SECTION 1: COSMETICS CATALOG */}
      <div className="bg-[#080b20] border-2 border-fuchsia-500/40 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-orbitron font-extrabold text-xl text-white flex items-center gap-2">
              <Palette className="w-5 h-5 text-fuchsia-400" />
              Catálogo de Skins & Cosméticos
            </h2>
            <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
              Agrega, edita precios/colores o elimina skins, estelas y coronas. Se publica al instante en la tienda de todos los jugadores.
            </p>
          </div>
          {!showForm && (
            <button
              type="button"
              id="admin-add-cosmetic-btn"
              onClick={openCreateForm}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 hover:brightness-110 text-white font-orbitron font-bold text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(217,70,239,0.4)] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              NUEVO ARTÍCULO
            </button>
          )}
        </div>

        {catalogSaved && (
          <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>¡Catálogo publicado! La tienda de todos los jugadores ya refleja los cambios.</span>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleCosmeticSubmit} className="p-4 sm:p-5 rounded-2xl bg-slate-950/80 border border-fuchsia-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-orbitron font-bold text-sm text-fuchsia-300">
                {editingId ? 'Editar Artículo' : 'Nuevo Artículo'}
              </h3>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej: Núcleo Cuántico Violeta"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Precio (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceUSD}
                  onChange={(e) => setForm((prev) => ({ ...prev, priceUSD: parseFloat(e.target.value) || 0 }))}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as CosmeticItem['type'] }))}
                  className={inputClass}
                >
                  <option value="skin">Skin (cuerpo)</option>
                  <option value="trail">Estela</option>
                  <option value="crown">Corona</option>
                  <option value="kill_fx">Efecto de eliminación</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Rareza</label>
                <select
                  value={form.rarity}
                  onChange={(e) => setForm((prev) => ({ ...prev, rarity: e.target.value as CosmeticItem['rarity'] }))}
                  className={inputClass}
                >
                  <option value="common">Común</option>
                  <option value="rare">Rara</option>
                  <option value="epic">Épica</option>
                  <option value="legendary">Legendaria</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Color Principal</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className="w-12 h-11 rounded-xl bg-slate-900 border border-slate-700 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Color Secundario</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                    className="w-12 h-11 rounded-xl bg-slate-900 border border-slate-700 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={form.secondaryColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Patrón de Aura</label>
                <select
                  value={form.pattern}
                  onChange={(e) => setForm((prev) => ({ ...prev, pattern: e.target.value as CosmeticItem['pattern'] }))}
                  className={inputClass}
                >
                  <option value="pulse">Pulso</option>
                  <option value="matrix">Matrix</option>
                  <option value="fire">Fuego</option>
                  <option value="lightning">Rayo</option>
                  <option value="galaxy">Galaxia</option>
                  <option value="cyber">Cyber</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Color de Brillo (glow)</label>
                <input
                  type="text"
                  value={form.glowColor}
                  onChange={(e) => setForm((prev) => ({ ...prev, glowColor: e.target.value }))}
                  className={inputClass}
                  placeholder="rgba(168, 85, 247, 0.9)"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Descripción</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:border-purple-400 focus:outline-none resize-none"
                rows={2}
                placeholder="Descripción comercial que verán los jugadores en la tienda"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all"
            >
              {editingId ? 'GUARDAR CAMBIOS' : 'PUBLICAR EN LA TIENDA'}
            </button>
          </form>
        )}
{/* Catalog list */}
        <div className="space-y-2.5">
          {skins.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-2xl bg-[#0c102a]/80 border border-slate-800 hover:border-fuchsia-500/40 transition-all"
            >
              <div
                className="w-11 h-11 rounded-2xl shrink-0 border border-white/30 flex items-center justify-center text-black"
                style={{ backgroundColor: item.color, boxShadow: `0 0 18px ${item.glowColor}` }}
              >
                {item.type === 'crown' ? '👑' : item.type === 'trail' ? '✨' : '⬤'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-orbitron font-bold text-xs text-white truncate max-w-[180px]">{item.name}</p>
                  <span className="text-[9px] uppercase font-mono-tech px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    {item.type}
                  </span>
                  <span className="text-[9px] uppercase font-mono-tech px-1.5 py-0.5 rounded bg-slate-900 text-fuchsia-300 border border-fuchsia-500/40">
                    {item.rarity}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono-tech truncate max-w-[420px]">{item.description}</p>
              </div>
              <span className="font-orbitron font-black text-xs text-fuchsia-300 whitespace-nowrap">
                {item.priceUSD === 0 ? 'GRATIS' : `$${item.priceUSD.toFixed(2)}`}
              </span>
              <button
                type="button"
                onClick={() => openEditForm(item)}
                className="p-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300"
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Eliminar "${item.name}" de la tienda? Los jugadores que ya la poseyeron la conservan.`)) {
                    onDeleteCosmetic(item.id);
                  }
                }}
                className="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/40 text-rose-300"
                title="Eliminar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {skins.length === 0 && (
            <p className="text-xs text-slate-500 font-mono-tech text-center py-4">
              El catálogo está vacío. Agrega el primer artículo.
            </p>
          )}
        </div>
      </div>
{/* SECTION 2: VIP PRICES */}
      <div className="bg-[#080b20] border-2 border-yellow-500/40 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
        <div>
          <h2 className="font-orbitron font-extrabold text-xl text-white flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-400" />
            Precios de Membresías VIP
          </h2>
          <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
            Ajusta el precio mensual de cada plan. Se cobra del saldo del jugador al suscribirse.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {vipPlans.map((plan) => (
            <div key={plan.id} className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-orbitron font-bold text-xs text-white">{plan.name}</p>
                {plan.popular && (
                  <span className="text-[9px] font-mono-tech px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
                    POPULAR
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 font-mono-tech text-xs">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={plan.priceUSD}
                  key={`${plan.id}-${plan.priceUSD}`}
                  onBlur={(e) => {
                    const next = parseFloat(e.target.value);
                    if (!Number.isNaN(next) && next !== plan.priceUSD) {
                      onUpdateVipPlan(plan.id, { priceUSD: next });
                    }
                  }}
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-orbitron font-bold text-sm focus:border-yellow-400 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-500 font-mono-tech">USD {plan.period} • se guarda al salir del campo</p>
            </div>
          ))}
        </div>
      </div>
{/* SECTION 3: GAMEPLAY DEFAULTS */}
      <div className="bg-[#080b20] border-2 border-cyan-500/40 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl">
        <div>
          <h2 className="font-orbitron font-extrabold text-xl text-white flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-cyan-400" />
            Jugabilidad & Precios de Salas Estándar
          </h2>
          <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
            Define los valores por defecto con los que los jugadores crean sus salas: duración, quórum de lanzamiento, arena, bots y rango de entrada permitido.
          </p>
        </div>

        {gameSaved && (
          <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>¡Configuración de jugabilidad aplicada para todas las salas nuevas!</span>
          </div>
        )}

        <form onSubmit={handleGameSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Duración de Partida (segundos)</label>
              <input type="number" min="30" step="10" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 180)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Mínimo de Jugadores para Lanzar</label>
              <input type="number" min="2" max="20" value={minPlayers} onChange={(e) => setMinPlayers(parseInt(e.target.value) || 2)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Ventana de Espera (segundos)</label>
              <input type="number" min="60" step="30" value={launchWindow} onChange={(e) => setLaunchWindow(parseInt(e.target.value) || 300)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Radio de la Arena</label>
              <input type="number" min="600" step="100" value={arenaRadius} onChange={(e) => setArenaRadius(parseInt(e.target.value) || 1800)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Disparo de Zona Neón (segundos restantes)</label>
              <input type="number" min="10" step="5" value={shrinkSeconds} onChange={(e) => setShrinkSeconds(parseInt(e.target.value) || 60)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Bots de Relleno por Sala</label>
              <input type="number" min="0" max="20" value={botCount} onChange={(e) => setBotCount(parseInt(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Dificultad de Bots</label>
              <select value={botDifficulty} onChange={(e) => setBotDifficulty(e.target.value as 'normal' | 'hard')} className={inputClass}>
                <option value="normal">Normal</option>
                <option value="hard">Difícil</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Entrada Mínima (USD)</label>
              <input type="number" min="0" step="0.05" value={minFee} onChange={(e) => setMinFee(parseFloat(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Entrada Máxima (USD)</label>
              <input type="number" min="0.1" step="0.25" value={maxFee} onChange={(e) => setMaxFee(parseFloat(e.target.value) || 5)} className={inputClass} />
            </div>
          </div>

          <button
            type="submit"
            id="admin-save-gameplay-btn"
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            GUARDAR Y APLICAR JUGABILIDAD
          </button>
        </form>
      </div>
    </div>
  );
};