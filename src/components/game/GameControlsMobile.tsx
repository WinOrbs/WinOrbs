import React, { useRef, useState } from 'react';
import { Zap } from 'lucide-react';

interface GameControlsMobileProps {
  onMove: (dx: number, dy: number) => void;
  onBoost: (active: boolean) => void;
}

export const GameControlsMobile: React.FC<GameControlsMobileProps> = ({ onMove, onBoost }) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const touchActiveRef = useRef(false);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [touchId, setTouchId] = useState<number | null>(null);
  const [isBoosting, setIsBoosting] = useState(false);

  const maxRadius = 45;

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touchId !== null) return;
    setIsDragging(true);
    setTouchId(touch.identifier);
    touchActiveRef.current = true;
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!joystickRef.current) return;
    let touch: React.Touch | undefined;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touch = e.changedTouches[i];
        break;
      }
    }
    if (!touch) {
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchId) {
          touch = e.touches[i];
          break;
        }
      }
    }
    if (!touch) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      setKnobPos({ x: 0, y: 0 });
      onMove(0, 0);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);
    const posX = Math.cos(angle) * clampedDist;
    const posY = Math.sin(angle) * clampedDist;

    setKnobPos({ x: posX, y: posY });
    onMove(posX / maxRadius, posY / maxRadius);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    let ended = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        ended = true;
        break;
      }
    }
    if (!ended) return;
    setIsDragging(false);
    setTouchId(null);
    touchActiveRef.current = false;
    setKnobPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const handleBoostStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (touchActiveRef.current) return;
    e.preventDefault();
    setIsBoosting(true);
    onBoost(true);
  };

  const handleBoostEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (touchActiveRef.current) return;
    e.preventDefault();
    setIsBoosting(false);
    onBoost(false);
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-20 flex justify-between items-end p-6 select-none">
      <div
        id="mobile-joystick"
        ref={joystickRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ touchAction: 'none' }}
        className={`pointer-events-auto relative w-28 h-28 rounded-full border-2 border-cyan-500/40 bg-slate-900/60 backdrop-blur-md flex items-center justify-center transition-opacity ${
          isDragging ? 'opacity-100 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]' : 'opacity-70'
        }`}
      >
        <div
          className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-400 shadow-[0_0_15px_#06b6d4] flex items-center justify-center transition-transform"
          style={{
            transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
          }}
        >
          <div className="w-4 h-4 rounded-full bg-white/80" />
        </div>
      </div>

      <button
        id="mobile-boost-btn"
        onTouchStart={handleBoostStart}
        onTouchEnd={handleBoostEnd}
        onMouseDown={handleBoostStart}
        onMouseUp={handleBoostEnd}
        style={{ touchAction: 'none' }}
        className={`pointer-events-auto w-20 h-20 rounded-full flex flex-col items-center justify-center font-orbitron font-bold text-xs tracking-wider transition-all duration-100 ${
          isBoosting
            ? 'bg-rose-500 scale-95 shadow-[0_0_25px_#f43f5e] text-white border-2 border-white'
            : 'bg-rose-600/80 hover:bg-rose-500 border-2 border-rose-400/80 shadow-[0_0_15px_rgba(244,63,94,0.5)] text-rose-100'
        }`}
      >
        <Zap className={`w-6 h-6 mb-0.5 ${isBoosting ? 'animate-bounce text-yellow-300' : 'text-rose-200'}`} />
        <span>TURBO</span>
      </button>
    </div>
  );
};