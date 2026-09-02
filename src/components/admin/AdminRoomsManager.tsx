import React, { useState } from 'react';
import { TournamentRoom, ExchangeConfig } from '../../types';
import { AdminRoomModal } from './AdminRoomModal';
import {
  Plus,
  Edit,
  Trash2,
  Trophy,
  Users,
  Play,
  RotateCcw,
  Search,
  Crown,
  AlertTriangle,
  Check,
} from 'lucide-react';

interface AdminRoomsManagerProps {
  rooms: TournamentRoom[];
  exchangeRates: ExchangeConfig;
  onCreateRoom: (data: any) => void;
  onUpdateRoom: (roomId: string, updates: Partial<TournamentRoom>) => void;
  onDeleteRoom: (roomId: string) => void;
  onStartMatch: (roomId: string) => void;
}

export const AdminRoomsManager: React.FC<AdminRoomsManagerProps> = ({
  rooms,
  exchangeRates,
  onCreateRoom,
  onUpdateRoom,
  onDeleteRoom,
  onStartMatch,
}) => {
  const [filter, setFilter] = useState<'all' | 'public' | 'private' | 'events'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRoom, setEditingRoom] = useState<TournamentRoom | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<TournamentRoom | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 3000);
  };

  const handleOpenCreate = () => {
    setEditingRoom(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (room: TournamentRoom) => {
    setEditingRoom(room);
    setIsModalOpen(true);
  };

  const handleSaveModal = (data: any) => {
    if (data.id) {
      // Update existing room
      onUpdateRoom(data.id, {
        name: data.name,
        code: data.code,
        type: data.type,
        entryFeeUSD: data.entryFeeUSD,
        potUSD: data.customPotUSD,
        maxPlayers: data.maxPlayers,
        minPlayersToStart: data.minPlayersToStart,
        durationSeconds: data.durationSeconds,
        arenaRadius: data.arenaRadius,
        isSpecialEvent: data.isSpecialEvent,
        eventDescription: data.eventDescription,
        sponsorName: data.sponsorName,
        status: data.status,
      });
      showToast(`¡Sala "${data.name}" actualizada con éxito!`);
    } else {
      // Create new room
      onCreateRoom(data);
      showToast(
        data.isSpecialEvent
          ? `🎉 ¡Evento Especial "${data.name}" creado y notificado a la comunidad!`
          : `✅ ¡Sala "${data.name}" creada exitosamente!`
      );
    }
  };

  const handleConfirmDelete = () => {
    if (!roomToDelete) return;
    const deletedName = roomToDelete.name;
    onDeleteRoom(roomToDelete.id);
    setRoomToDelete(null);
    showToast(`🗑️ Sala "${deletedName}" eliminada permanentemente.`);
  };

  const handleForceShrink = (room: TournamentRoom) => {
    onUpdateRoom(room.id, {
      currentArenaRadius: Math.max(600, (room.currentArenaRadius || 1800) - 400),
    });
    showToast(`⚡ Señal de reducción forzada enviada a ${room.name}`);
  };

  const handleResetRoom = (room: TournamentRoom) => {
    onUpdateRoom(room.id, {
      status: 'waiting',
      timeRemainingSeconds: room.durationSeconds || 180,
      nextLaunchSeconds: 300,
      currentArenaRadius: room.arenaRadius || 1800,
    });
    showToast(`🔄 Sala ${room.name} reiniciada en modo espera.`);
  };

  // Metrics
  const totalRooms = rooms.length;
  const publicRooms = rooms.filter((r) => r.type === 'public').length;
  const privateRooms = rooms.filter((r) => r.type === 'private').length;
  const specialEvents = rooms.filter((r) => r.isSpecialEvent).length;
  const totalPotUSD = rooms.reduce((sum, r) => sum + r.potUSD, 0);

  // Filtered rooms
  const filteredRooms = rooms.filter((r) => {
    // Category filter
    if (filter === 'public' && r.type !== 'public') return false;
    if (filter === 'private' && r.type !== 'private') return false;
    if (filter === 'events' && !r.isSpecialEvent) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = r.name.toLowerCase().includes(q);
      const matchCode = r.code.toLowerCase().includes(q);
      const matchHost = r.hostName.toLowerCase().includes(q);
      const matchSponsor = r.sponsorName?.toLowerCase().includes(q) || false;
      return matchName || matchCode || matchHost || matchSponsor;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-950/90 border-2 border-emerald-500/80 text-emerald-200 font-orbitron text-xs flex items-center justify-between gap-3 shadow-[0_0_20px_rgba(16,185,129,0.4)] animate-fade-in">
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-emerald-400" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button
            onClick={() => setActionSuccessMsg(null)}
            className="text-emerald-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header & Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
          <span className="text-[10px] text-slate-400 font-mono-tech block uppercase">Total Salas</span>
          <p className="font-orbitron font-extrabold text-xl text-white">{totalRooms}</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-cyan-500/30">
          <span className="text-[10px] text-cyan-300 font-mono-tech block uppercase">🌐 Públicas</span>
          <p className="font-orbitron font-extrabold text-xl text-cyan-400">{publicRooms}</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-purple-500/30">
          <span className="text-[10px] text-purple-300 font-mono-tech block uppercase">🔒 Privadas</span>
          <p className="font-orbitron font-extrabold text-xl text-purple-400">{privateRooms}</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-amber-500/30">
          <span className="text-[10px] text-amber-300 font-mono-tech block uppercase">🎉 Eventos Oficiales</span>
          <p className="font-orbitron font-extrabold text-xl text-amber-400">{specialEvents}</p>
        </div>
        <div className="col-span-2 sm:col-span-1 p-4 rounded-2xl bg-slate-900/80 border border-yellow-500/30">
          <span className="text-[10px] text-yellow-300 font-mono-tech block uppercase">💰 Pote en Juego</span>
          <p className="font-orbitron font-extrabold text-xl text-yellow-400">${totalPotUSD.toFixed(2)}</p>
        </div>
      </div>

      {/* Main Action Bar: Create Button + Search + Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-3xl bg-slate-900/90 border border-purple-500/40 shadow-lg">
        {/* Left: Create Room Button */}
        <button
          onClick={handleOpenCreate}
          id="admin-create-room-btn"
          type="button"
          className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-purple-500 via-fuchsia-500 to-indigo-600 hover:brightness-110 text-white font-orbitron font-extrabold text-xs tracking-wider shadow-[0_0_20px_rgba(168,85,247,0.5)] transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>➕ CREAR NUEVA SALA / EVENTO ESPECIAL</span>
        </button>

        {/* Right: Search & Filters */}
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
          {/* Search Box */}
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar sala o código..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono-tech focus:border-purple-400 focus:outline-none"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 w-full sm:w-auto overflow-x-auto text-xs">
            {[
              { id: 'all', label: `Todas (${totalRooms})` },
              { id: 'public', label: `Públicas (${publicRooms})` },
              { id: 'private', label: `Privadas (${privateRooms})` },
              { id: 'events', label: `Eventos (${specialEvents})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as any)}
                className={`px-3 py-2 rounded-xl font-orbitron text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  filter === tab.id
                    ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rooms Grid */}
      {filteredRooms.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-slate-900/50 border border-slate-800 space-y-3">
          <Trophy className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="font-orbitron font-bold text-slate-400 text-sm">
            No se encontraron salas con los filtros aplicados.
          </p>
          <button
            onClick={handleOpenCreate}
            className="px-5 py-2 rounded-xl bg-purple-600 text-white font-orbitron font-bold text-xs hover:bg-purple-500"
          >
            Crear Primera Sala Ahora
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredRooms.map((room) => {
            const winnerReward = room.potUSD * 0.8;
            const devFee = room.potUSD * 0.2;
            const isEvent = !!room.isSpecialEvent;

            return (
              <div
                key={room.id}
                className={`p-5 rounded-3xl bg-[#0a0e28]/90 border transition-all shadow-xl space-y-4 relative overflow-hidden group ${
                  isEvent
                    ? 'border-yellow-500/60 shadow-[0_0_25px_rgba(234,179,8,0.2)] bg-gradient-to-br from-[#0f1230] to-[#1a1408]'
                    : 'border-slate-800 hover:border-purple-500/50'
                }`}
              >
                {/* Event Top Ribbon */}
                {isEvent && (
                  <div className="p-2 rounded-xl bg-gradient-to-r from-yellow-500/20 via-amber-500/20 to-yellow-600/20 border border-yellow-500/40 flex items-center justify-between text-xs">
                    <span className="font-orbitron font-extrabold text-yellow-300 flex items-center gap-1.5 text-[11px]">
                      <Crown className="w-3.5 h-3.5 text-yellow-400" />
                      🎉 TORNEO DE EVENTO ESPECIAL OFICIAL
                    </span>
                    {room.sponsorName && (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-400 text-slate-950 font-mono-tech font-bold text-[10px]">
                        {room.sponsorName}
                      </span>
                    )}
                  </div>
                )}

                {/* Card Header: Name, Badges & Code */}
                <div className="flex justify-between items-start gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-orbitron font-bold text-white text-base group-hover:text-purple-300 transition-colors">
                        {room.name}
                      </h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-mono-tech text-[10px] font-bold uppercase ${
                          room.type === 'private'
                            ? 'bg-purple-950 text-purple-300 border border-purple-500/40'
                            : 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
                        }`}
                      >
                        {room.type === 'private' ? '🔒 Privada' : '🌐 Pública'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono-tech text-[10px] font-bold uppercase ${
                          room.status === 'in_game'
                            ? 'bg-rose-950 text-rose-300 border border-rose-500/50 animate-pulse'
                            : room.status === 'finished'
                            ? 'bg-slate-800 text-slate-400 border border-slate-700'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {room.status === 'in_game'
                          ? '⚔️ En Combate'
                          : room.status === 'finished'
                          ? '🏁 Finalizada'
                          : '⏳ Esperando'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 font-mono-tech">
                      Código: <strong className="text-cyan-300 font-orbitron">{room.code}</strong> • Host:{' '}
                      <span className="text-slate-200">{room.hostName}</span>
                    </p>
                  </div>

                  {/* Player Slot Badge */}
                  <div className="px-3 py-1.5 rounded-2xl bg-slate-950 border border-slate-800 text-right shrink-0">
                    <span className="text-[10px] text-slate-400 font-mono-tech block">Capacidad</span>
                    <span className="font-orbitron font-bold text-cyan-400 text-xs flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {room.currentPlayers}/{room.maxPlayers}
                    </span>
                  </div>
                </div>

                {/* Event Description (If Present) */}
                {room.eventDescription && (
                  <p className="text-xs text-amber-200/90 font-sans p-2.5 rounded-xl bg-slate-950/60 border border-amber-500/30">
                    📢 {room.eventDescription}
                  </p>
                )}

                {/* Economics Box: Entry Fee, Pot, Winner, Dev */}
                <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-tech">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Entrada:</span>
                    <span className="font-orbitron font-bold text-emerald-400">
                      {room.entryFeeUSD === 0 ? 'GRATIS ($0)' : `$${room.entryFeeUSD.toFixed(2)} USD`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Pote Total:</span>
                    <span className="font-orbitron font-bold text-yellow-400">${room.potUSD.toFixed(2)} USD</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">80% Ganador:</span>
                    <span className="font-orbitron font-bold text-amber-300">${winnerReward.toFixed(2)} USD</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">20% Mantenimiento:</span>
                    <span className="font-orbitron font-bold text-cyan-400">${devFee.toFixed(2)} USD</span>
                  </div>
                </div>

                {/* Bottom Action Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  {/* Left: Edit & Delete Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(room)}
                      className="px-3.5 py-2 rounded-xl bg-purple-950 hover:bg-purple-900 border border-purple-500/50 text-purple-200 font-orbitron text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.3)]"
                    >
                      <Edit className="w-3.5 h-3.5 text-purple-300" />
                      <span>EDITAR SALA</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRoomToDelete(room)}
                      className="px-3 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-300 font-orbitron text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>ELIMINAR</span>
                    </button>
                  </div>

                  {/* Right: Operational Match Controls */}
                  <div className="flex items-center gap-2">
                    {room.status === 'waiting' && (
                      <button
                        type="button"
                        onClick={() => onStartMatch(room.id)}
                        className="px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:brightness-110 text-slate-950 font-orbitron text-xs font-extrabold flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.3)] cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-slate-950" />
                        <span>INICIAR COMBATE</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleForceShrink(room)}
                      className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono-tech font-bold"
                      title="Forzar reducción de arena"
                    >
                      ⚡ Encoger
                    </button>

                    <button
                      type="button"
                      onClick={() => handleResetRoom(room)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                      title="Reiniciar Sala"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create & Edit Room */}
      <AdminRoomModal
        isOpen={isModalOpen}
        roomToEdit={editingRoom}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveModal}
        exchangeRateVES={exchangeRates.vesUsdRate}
      />

      {/* Modal: Delete Confirmation */}
      {roomToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-[#090d26] border-2 border-rose-500/80 rounded-3xl p-6 text-slate-100 shadow-[0_0_50px_rgba(244,63,94,0.4)] space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-950 border border-rose-500/60 flex items-center justify-center text-rose-400 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="font-orbitron font-extrabold text-lg text-white">
                ¿Eliminar Sala Definitivamente?
              </h3>
              <p className="text-xs text-slate-400 font-mono-tech">
                Esta acción removerá la sala <strong className="text-white">"{roomToDelete.name}"</strong> (Código:{' '}
                <span className="text-rose-400">{roomToDelete.code}</span>) del lobby de todos los jugadores.
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono-tech space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Pote en riesgo:</span>
                <span className="text-yellow-400 font-bold">${roomToDelete.potUSD.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Jugadores inscritos:</span>
                <span className="text-cyan-400 font-bold">{roomToDelete.currentPlayers} jugadores</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-orbitron font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:brightness-110 text-white font-orbitron font-extrabold text-xs shadow-[0_0_15px_rgba(244,63,94,0.5)] cursor-pointer"
              >
                SÍ, ELIMINAR SALA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
