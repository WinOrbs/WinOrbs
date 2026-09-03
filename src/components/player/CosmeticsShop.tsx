import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CosmeticItem } from '../../types';
import {
  Sparkles,
  ShoppingBag,
  Check,
  Crown,
  Zap,
} from 'lucide-react';

// Fallback shown when the admin empties the cosmetics catalog
const EMPTY_CATALOG_ITEM: CosmeticItem = {
  id: 'catalog_empty',
  name: 'Catálogo en mantenimiento',
  type: 'skin',
  priceUSD: 0,
  rarity: 'common',
  description: 'El administrador está actualizando la tienda. Vuelve en unos minutos.',
  color: '#06b6d4',
  secondaryColor: '#3b82f6',
  glowColor: 'rgba(6, 182, 212, 0.8)',
  pattern: 'pulse',
};

export const CosmeticsShop: React.FC = () => {
  const {
    currentUser,
    skins,
    buyCosmetic,
    equipCosmetic,
  } = useApp();

  const [activeCategory, setActiveCategory] = useState<'all' | 'skin' | 'trail' | 'crown'>('all');
  const [previewItem, setPreviewItem] = useState<CosmeticItem>(skins[0] ?? EMPTY_CATALOG_ITEM);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Live 3D-like Neon Avatar Preview Animation
  useEffect(() => {
    let animId: number;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let angle = 0;
    const renderPreview = () => {
      angle += 0.025;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2 + 10;
      const radius = 45;

      // Isometric Shadow
      ctx.beginPath();
      ctx.ellipse(cx, cy + radius * 0.8, radius * 1.2, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();

      // Outer glow
      ctx.save();
      ctx.shadowColor = previewItem.glowColor || '#06b6d4';
      ctx.shadowBlur = 30 + Math.sin(angle * 2) * 10;

      // Main Core
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(cx - 15, cy - 15, 0, cx, cy, radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, previewItem.color);
      grad.addColorStop(1, '#050714');
      ctx.fillStyle = grad;
      ctx.fill();

      // Neon Rim
      ctx.strokeStyle = previewItem.color;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();

      // Floating Crown if applicable
      if (previewItem.type === 'crown' || currentUser?.equippedCrown) {
        ctx.save();
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#eab308';
        ctx.shadowBlur = 15;
        const crownY = cy - radius - 15 + Math.sin(angle * 3) * 4;
        ctx.fillText('👑', cx, crownY);
        ctx.restore();
      }

      // Orbiting Neon Particles
      for (let i = 0; i < 3; i++) {
        const pAngle = angle + (i * Math.PI * 2) / 3;
        const px = cx + Math.cos(pAngle) * (radius + 20);
        const py = cy + Math.sin(pAngle) * (radius * 0.6 + 10);

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = previewItem.secondaryColor || previewItem.color;
        ctx.shadowColor = previewItem.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      }

      animId = requestAnimationFrame(renderPreview);
    };

    animId = requestAnimationFrame(renderPreview);
    return () => cancelAnimationFrame(animId);
  }, [previewItem, currentUser]);

  const filteredItems = skins.filter((item) => {
    if (activeCategory === 'all') return true;
    return item.type === activeCategory;
  });

  const isOwned = (id: string) => currentUser?.ownedCosmetics.includes(id);
  const isEquipped = (item: CosmeticItem) => {
    if (!currentUser) return false;
    if (item.type === 'skin') return currentUser.equippedSkin === item.id;
    if (item.type === 'trail') return currentUser.equippedTrail === item.id;
    if (item.type === 'crown') return currentUser.equippedCrown === item.id;
    return false;
  };

  const getRarityBadge = (rarity: string) => {
    switch (rarity) {
      case 'legendary':
        return 'bg-amber-950/80 text-amber-300 border-amber-500/50';
      case 'epic':
        return 'bg-purple-950/80 text-purple-300 border-purple-500/50';
      case 'rare':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-orbitron font-bold text-fuchsia-400 uppercase tracking-wider">
            Mercado Cibernético
          </span>
          <h1 className="text-2xl sm:text-3xl font-orbitron font-black text-white">
            Tienda de Cosméticos Neón
          </h1>
          <p className="text-xs text-slate-400 font-mono-tech mt-0.5">
            Skins exclusivas, estelas de fotones y coronas holográficas para tu avatar
          </p>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[#090d26]/90 border border-slate-800 rounded-2xl overflow-x-auto">
          {[
            { key: 'all', label: 'Todos' },
            { key: 'skin', label: 'Skins' },
            { key: 'trail', label: 'Estelas' },
            { key: 'crown', label: 'Coronas' },
          ].map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key as any)}
              className={`px-4 py-2 rounded-xl font-orbitron text-xs font-bold transition-all ${
                activeCategory === cat.key
                  ? 'bg-gradient-to-r from-fuchsia-500/25 to-pink-500/25 text-fuchsia-300 border border-fuchsia-400/60 shadow-[0_0_15px_rgba(217,70,239,0.35)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Interactive 3D Avatar Preview Showcase */}
        <div className="lg:col-span-1 bg-gradient-to-b from-[#0e112d] via-[#120f32] to-[#0a0c20] border-2 border-fuchsia-500/40 rounded-3xl p-6 flex flex-col items-center text-center shadow-[0_0_35px_rgba(217,70,239,0.2)] relative overflow-hidden">
          <span className="text-xs font-orbitron font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400 mb-2">
            VISTA PREVIA EN VIVO
          </span>

          <div className="w-full h-56 flex items-center justify-center relative">
            <canvas ref={previewCanvasRef} width={260} height={220} className="w-full h-full" />
          </div>

          <div className="w-full mt-2 pt-4 border-t border-slate-800/80 text-left">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] uppercase font-bold font-mono-tech px-2.5 py-0.5 rounded-full border shadow-sm ${getRarityBadge(previewItem.rarity)}`}>
                {previewItem.rarity}
              </span>
              <span className="font-orbitron font-black text-sm text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-300 to-pink-400">
                {previewItem.priceUSD === 0 ? 'GRATIS' : `$${previewItem.priceUSD.toFixed(2)} USD`}
              </span>
            </div>

            <h3 className="font-orbitron font-black text-lg text-white mt-1.5">
              {previewItem.name}
            </h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {previewItem.description}
            </p>

            <div className="mt-5">
              {isEquipped(previewItem) ? (
                <button
                  disabled
                  className="w-full py-3 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-300 font-orbitron font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                >
                  <Check className="w-4 h-4" />
                  <span>EQUIPADO ACTUALMENTE</span>
                </button>
              ) : isOwned(previewItem.id) ? (
                <button
                  id="equip-cosmetic-btn"
                  onClick={() => equipCosmetic(previewItem.type as any, previewItem.id)}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 hover:brightness-110 text-slate-950 font-orbitron font-black text-xs shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all"
                >
                  EQUIPAR EN EL JUEGO
                </button>
              ) : (
                <button
                  id="buy-cosmetic-btn"
                  onClick={() => buyCosmetic(previewItem)}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-pink-500 to-rose-500 hover:brightness-110 text-white font-orbitron font-black text-xs shadow-[0_0_25px_rgba(217,70,239,0.45)] transition-all flex items-center justify-center gap-2"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>COMPRAR POR ${previewItem.priceUSD.toFixed(2)} USD</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Cosmetics Grid Catalog */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredItems.map((item) => {
            const owned = isOwned(item.id);
            const equipped = isEquipped(item);
            const isSelected = previewItem.id === item.id;

            return (
              <div
                key={item.id}
                onClick={() => setPreviewItem(item)}
                className={`p-4 rounded-3xl transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-2 border-fuchsia-400 shadow-[0_0_25px_rgba(217,70,239,0.35)] bg-gradient-to-b from-[#131135] to-[#0c0f24]'
                    : 'bg-[#0a0d24]/85 border border-slate-800 hover:border-slate-700 hover:bg-[#0e1233]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[10px] font-mono-tech uppercase font-bold px-2.5 py-0.5 rounded-full border ${getRarityBadge(item.rarity)}`}>
                      {item.rarity}
                    </span>
                    <span className="font-orbitron font-extrabold text-xs text-fuchsia-300">
                      {item.priceUSD === 0 ? 'Gratis' : `$${item.priceUSD.toFixed(2)} USD`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border border-white/30"
                      style={{
                        backgroundColor: item.color,
                        boxShadow: `0 0 20px ${item.glowColor}`,
                      }}
                    >
                      {item.type === 'crown' ? (
                        <Crown className="w-6 h-6 text-black" />
                      ) : item.type === 'trail' ? (
                        <Zap className="w-6 h-6 text-black" />
                      ) : (
                        <Sparkles className="w-6 h-6 text-black" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-orbitron font-bold text-sm text-white">
                        {item.name}
                      </h4>
                      <p className="text-[11px] text-slate-300 line-clamp-2 mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech text-slate-400">
                    {owned ? (equipped ? '⚡ En uso' : 'Adquirido') : 'Disponible'}
                  </span>
                  {equipped ? (
                    <span className="text-[11px] font-orbitron font-bold text-emerald-400 flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.4)]">
                      <Check className="w-3.5 h-3.5" /> Equipado
                    </span>
                  ) : owned ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        equipCosmetic(item.type as any, item.id);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-300 text-xs font-orbitron font-bold shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                    >
                      Equipar
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        buyCosmetic(item);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white text-xs font-orbitron font-bold shadow-[0_0_15px_rgba(217,70,239,0.4)]"
                    >
                      Comprar
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
