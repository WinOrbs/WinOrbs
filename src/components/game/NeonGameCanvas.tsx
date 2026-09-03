import React, { useRef, useEffect, useState, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  GamePlayerEntity,
  OrbEntity,
  ParticleEntity,
  TournamentRoom,
  MatchSessionToken,
} from '../../types';
import { useApp } from '../../context/AppContext';
import { soundFx } from '../../services/soundSynth';
import { generateMatchSessionToken } from '../../services/firebase';
import { GameControlsMobile } from './GameControlsMobile';
import {
  Trophy,
  Volume2,
  VolumeX,
  Eye,
  ArrowLeft,
  Skull,
  Timer,
  AlertTriangle,
  Settings,
} from 'lucide-react';

interface NeonGameCanvasProps {
  room: TournamentRoom;
  onExit: () => void;
}

const ORB_COLORS = [
  { color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.9)', value: 10 },
  { color: '#f43f5e', glow: 'rgba(244, 63, 94, 0.9)', value: 20 },
  { color: '#eab308', glow: 'rgba(234, 179, 8, 0.9)', value: 35 },
  { color: '#a855f7', glow: 'rgba(168, 85, 247, 0.9)', value: 50 },
  { color: '#22c55e', glow: 'rgba(34, 197, 94, 0.9)', value: 15 },
  { color: '#38bdf8', glow: 'rgba(56, 189, 248, 1)', value: 100 }, // Mega Orb
];

const BOT_NAMES = [
  'Andres', 'Manuel', 'Jesus', 'Juan', 'Kate', 'Maria', 'Luis', 'Ana', 
  'Carlos', 'Sofia', 'Diego', 'Valeria', 'Jorge', 'Camila', 'Miguel', 
  'Isabella', 'David', 'Lucia', 'Daniel', 'Gabriela', 'Sebastian', 
  'Paula', 'Alejandro', 'Carolina', 'Fernando', 'Natalia', 'Ricardo',
  'Daniela', 'Javier', 'Mariana', 'Eduardo', 'Fernanda', 'Andresito', 
  'Marcos', 'Juliana', 'Pablo', 'Camilo', 'Adriana', 'Nicolas', 'Catalina', 
  'Santiago', 'Valentina', 'Emiliano', 'Antonella', 'Matias', 'Renata', 'Thiago', 
  'Mia', 'Lautaro', 'Alma', 'Bruno', 'Amelia', 'Gael', 'Elena', 'Ian', 'Aitana', 
  'Thierry', 'Luna', 'Maximiliano', 'Ariana', 'Leandro', 'Isis', 'Dante', 'Alondra', 
  'Bastian', 'Noa',
];

export const NeonGameCanvas: React.FC<NeonGameCanvasProps> = ({ room, onExit }) => {
  const {
    currentUser,
    visualMode,
    setVisualMode,
    soundEnabled,
    setSoundEnabled,
    exchangeRates,
    finishMatchPot,
  } = useApp();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Match State
  const [timeLeft, setTimeLeft] = useState<number>(room?.durationSeconds || 180);
  const timeLeftRef = useRef<number>(room?.durationSeconds || 180);
  const [matchEnded, setMatchEnded] = useState<boolean>(false);
  const matchEndedRef = useRef<boolean>(false);
  const [winnerInfo, setWinnerInfo] = useState<{ id: string; name: string; score: number; kills: number } | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState<boolean>(false);
  const [mobileControlSize, setMobileControlSize] = useState<number>(() => {
    const saved = localStorage.getItem('winorbs_mobile_control_size');
    const parsed = saved ? Number(saved) : 112;
    return Number.isFinite(parsed) ? Math.max(96, Math.min(180, parsed)) : 112;
  });
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [, setIsShrinking] = useState<boolean>(false);

  // Keep refs in sync for render loop
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    matchEndedRef.current = matchEnded;
  }, [matchEnded]);

  // Entities state refs for high FPS loop
  const playersRef = useRef<GamePlayerEntity[]>([]);
  const orbsRef = useRef<OrbEntity[]>([]);
  const particlesRef = useRef<ParticleEntity[]>([]);
  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const arenaRadiusRef = useRef<number>(room?.arenaRadius || 1800);
  const initialRadiusRef = useRef<number>(room?.arenaRadius || 1800);
  const minRadiusRef = useRef<number>(550);

  // Controls input refs
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickVectorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isBoostPressedRef = useRef<boolean>(false);
  const userKillsRef = useRef<number>(0);
  const userScoreRef = useRef<number>(0);
  const killFeedRef = useRef<{ text: string; time: number }[]>([]);

  // Anti-Cheat Match Session Token ref
  const matchSessionTokenRef = useRef<MatchSessionToken | null>(null);

  // Sound alert triggered flag for 60s
  const sirenTriggeredRef = useRef<boolean>(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Initialize Players, Bots, and Orbs
  useEffect(() => {
    const initialPlayers: GamePlayerEntity[] = [];

    // User Player
    const userPlayer: GamePlayerEntity = {
      id: currentUser?.id || 'user_player',
      name: currentUser?.name || 'CyberWarrior',
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
      vx: 0,
      vy: 0,
      radius: 30,
      mass: 50,
      score: 50,
      color: currentUser?.equippedSkin === 'skin_plasma_pink' ? '#f43f5e' :
             currentUser?.equippedSkin === 'skin_electric_lime' ? '#22c55e' :
             currentUser?.equippedSkin === 'skin_gold_titan' ? '#eab308' :
             currentUser?.equippedSkin === 'skin_void_darkness' ? '#8b5cf6' : '#06b6d4',
      glowColor: currentUser?.equippedSkin === 'skin_plasma_pink' ? 'rgba(244,63,94,0.9)' :
                 currentUser?.equippedSkin === 'skin_electric_lime' ? 'rgba(34,197,94,0.9)' :
                 currentUser?.equippedSkin === 'skin_gold_titan' ? 'rgba(234,179,8,1)' :
                 currentUser?.equippedSkin === 'skin_void_darkness' ? 'rgba(139,92,246,0.9)' : 'rgba(6,182,212,0.9)',
      secondaryColor: '#ffffff',
      trailColor: currentUser?.equippedTrail === 'trail_solar_flare' ? '#f97316' : '#06b6d4',
      crown: currentUser?.equippedCrown || (currentUser?.vipTier === 'vip_titan' ? 'crown_cyber_emperor' : undefined),
      isAlive: true,
      kills: 0,
      isUser: true,
      isBot: false,
      speed: 4.8,
      boostActive: false,
      angle: 0,
      trailHistory: [],
    };
    initialPlayers.push(userPlayer);

    // Bot Opponents matching exact room current players count
    const totalRoomPlayers = room?.currentPlayers || (room?.registeredPlayers ? room.registeredPlayers.length : 4);
    const botCount = Math.max(totalRoomPlayers - 1, 3);
    for (let i = 0; i < botCount; i++) {
      const botColorObj = ORB_COLORS[i % ORB_COLORS.length];
      const botAngle = (i / botCount) * Math.PI * 2;
      const botDist = 350 + Math.random() * 550;

      initialPlayers.push({
        id: `bot_${i}`,
        name: BOT_NAMES[i % BOT_NAMES.length],
        x: Math.cos(botAngle) * botDist,
        y: Math.sin(botAngle) * botDist,
        vx: 0,
        vy: 0,
        radius: 28 + Math.floor(Math.random() * 8),
        mass: 40 + Math.floor(Math.random() * 40),
        score: 40 + Math.floor(Math.random() * 40),
        color: botColorObj.color,
        glowColor: botColorObj.glow,
        trailColor: botColorObj.color,
        crown: i === 0 ? 'crown_cyber_emperor' : undefined,
        isAlive: true,
        kills: 0,
        isUser: false,
        isBot: true,
        speed: 4.2 + Math.random() * 0.6,
        boostActive: false,
        angle: Math.random() * Math.PI * 2,
        trailHistory: [],
      });
    }

    playersRef.current = initialPlayers;

    // Generate Initial 350 Orbs
    const initialOrbs: OrbEntity[] = [];
    for (let i = 0; i < 350; i++) {
      const colorTemplate = ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)];
      const orbAngle = Math.random() * Math.PI * 2;
      const orbDist = Math.sqrt(Math.random()) * (arenaRadiusRef.current - 60);

      initialOrbs.push({
        id: i,
        x: Math.cos(orbAngle) * orbDist,
        y: Math.sin(orbAngle) * orbDist,
        radius: colorTemplate.value >= 50 ? 9 : 5 + Math.random() * 2,
        value: colorTemplate.value,
        color: colorTemplate.color,
        glowColor: colorTemplate.glow,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
    orbsRef.current = initialOrbs;
    if (currentUser && room) {
      matchSessionTokenRef.current = generateMatchSessionToken(room, currentUser);
    }
  }, [currentUser, room]);

  // Finish match callback
  const handleMatchFinished = useCallback(() => {
    setMatchEnded(true);

    // Find highest score player
    const sorted = [...playersRef.current].sort((a, b) => b.score - a.score);
    const topWinner = sorted[0];

    if (topWinner) {
      setWinnerInfo({
        id: topWinner.id,
        name: topWinner.name,
        score: topWinner.score,
        kills: topWinner.kills,
      });

      // Distribute 80% pot in Context with Anti-Cheat session token verification
      if (room?.id) {
        void finishMatchPot(
          room.id,
          topWinner.id,
          topWinner.name,
          {
            score: userScoreRef.current,
            kills: userKillsRef.current,
          },
          matchSessionTokenRef.current
        );
      }

      if (topWinner.isUser) {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#06b6d4', '#f43f5e', '#eab308', '#a855f7'],
        });
      }
    }
  }, [finishMatchPot, room]);

  // Match Countdown Timer Interval (Pure decrement)
  useEffect(() => {
    if (matchEnded) return;

    const timerInterval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [matchEnded]);

  // Handle side-effects cleanly in response to timeLeft changes
  useEffect(() => {
    if (timeLeft <= 60 && timeLeft > 0 && !sirenTriggeredRef.current) {
      sirenTriggeredRef.current = true;
      setIsShrinking(true);
      soundFx.playShrinkAlert();
      killFeedRef.current.unshift({
        text: '⚠️ ¡ALERTA! Reducción de Zona Neón iniciada. ¡Cuidado con el perímetro!',
        time: Date.now(),
      });
    }

    if (timeLeft === 0 && !matchEnded) {
      handleMatchFinished();
    }
  }, [timeLeft, matchEnded, handleMatchFinished]);

  // Spawn death particles
  const spawnExplosionParticles = (x: number, y: number, color: string, count: number = 35) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 7;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
        color,
        alpha: 1,
        life: 0,
        maxLife: 25 + Math.random() * 25,
      });
    }
  };

  // Main High-Performance Game Animation Loop
  useEffect(() => {
    let animFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      if (!containerRef.current || !canvas) return;
      canvas.width = containerRef.current.clientWidth;
      canvas.height = containerRef.current.clientHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Setup input listeners for PC Keyboard & Mouse
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: e.clientX - rect.left - canvas.width / 2,
        y: e.clientY - rect.top - canvas.height / 2,
      };
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isBoostPressedRef.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isBoostPressedRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // ==========================================
    // RENDER LOOP
    // ==========================================
    const render = () => {
      // 1. Arena Radius Shrink calculation (at <= 60s remaining)
      const curTime = timeLeftRef.current;
      const isOver = matchEndedRef.current;
      if (curTime <= 60 && !isOver) {
        const shrinkProgress = (60 - curTime) / 60; // 0 to 1
        const targetRadius = initialRadiusRef.current - shrinkProgress * (initialRadiusRef.current - minRadiusRef.current);
        arenaRadiusRef.current = Math.max(minRadiusRef.current, targetRadius);
      }

      const currentRadius = arenaRadiusRef.current;

      // 2. Update User Player
      const user = playersRef.current.find((p) => p.isUser);
      if (user && user.isAlive) {
        let dirX = 0;
        let dirY = 0;

        if (joystickVectorRef.current.x !== 0 || joystickVectorRef.current.y !== 0) {
          dirX = joystickVectorRef.current.x;
          dirY = joystickVectorRef.current.y;
        } else {
          const dist = Math.hypot(mousePosRef.current.x, mousePosRef.current.y);
          if (dist > 10) {
            dirX = mousePosRef.current.x / dist;
            dirY = mousePosRef.current.y / dist;
          }
        }

        user.boostActive = isBoostPressedRef.current && user.mass > 25;
        const currentSpeed = user.boostActive ? user.speed * 1.85 : user.speed;

        if (user.boostActive) {
          user.mass -= 0.08;
          user.score = Math.max(20, Math.floor(user.mass));
          user.radius = 22 + Math.sqrt(user.mass) * 1.6;
          if (Math.random() < 0.3) {
            soundFx.playBoost();
          }
        }

        // Fluid inertia damping
        const targetVx = dirX * currentSpeed;
        const targetVy = dirY * currentSpeed;
        user.vx += (targetVx - user.vx) * 0.28;
        user.vy += (targetVy - user.vy) * 0.28;
        user.x += user.vx;
        user.y += user.vy;
        user.angle = Math.atan2(user.vy, user.vx);

        // Record Trail History
        if (user.trailHistory.length > 20) user.trailHistory.shift();
        user.trailHistory.push({ x: user.x, y: user.y, alpha: 1 });

        // Wall Barrier Collision Check
        const distFromCenter = Math.hypot(user.x, user.y);
        if (distFromCenter + user.radius >= currentRadius) {
          // CRASH WALL -> DEATH & RESPAWN PENALTY
          user.isAlive = false;
          user.respawnTimer = 120; // 2 seconds at 60fps
          spawnExplosionParticles(user.x, user.y, user.color, 40);
          soundFx.playDeathWall();
          killFeedRef.current.unshift({
            text: `💥 ¡${user.name} se estrelló contra la barrera láser de la pared!`,
            time: Date.now(),
          });
        }

        // Camera Follows User smoothly
        cameraRef.current.x += (user.x - cameraRef.current.x) * 0.1;
        cameraRef.current.y += (user.y - cameraRef.current.y) * 0.1;
        // Dynamic zoom based on player radius
        const targetZoom = Math.max(0.6, 1 - (user.radius - 30) / 400);
        cameraRef.current.zoom += (targetZoom - cameraRef.current.zoom) * 0.05;

        userScoreRef.current = Math.floor(user.score);
        userKillsRef.current = user.kills;
      } else if (user && !user.isAlive) {
        // Respawn countdown
        if (user.respawnTimer && user.respawnTimer > 0) {
          user.respawnTimer -= 1;
          if (user.respawnTimer <= 0) {
            // Respawn user in safe inner area
            const spawnAngle = Math.random() * Math.PI * 2;
            const spawnDist = Math.random() * (currentRadius * 0.4);
            user.x = Math.cos(spawnAngle) * spawnDist;
            user.y = Math.sin(spawnAngle) * spawnDist;
            user.mass = 45;
            user.score = 45;
            user.radius = 28;
            user.isAlive = true;
            user.trailHistory = [];
            spawnExplosionParticles(user.x, user.y, '#06b6d4', 25);
          }
        }
      }

      // 3. Update Bots AI
      playersRef.current.forEach((bot) => {
        if (!bot.isBot) return;

        if (bot.isAlive) {
          // Bot logic: find nearest orb or smaller player
          let targetX = 0;
          let targetY = 0;
          let closestDist = 99999;

          // Stay away from wall
          const distToCenter = Math.hypot(bot.x, bot.y);
          if (distToCenter > currentRadius - 150) {
            targetX = -bot.x;
            targetY = -bot.y;
          } else {
            // Pick a nearby orb
            for (let i = 0; i < Math.min(30, orbsRef.current.length); i++) {
              const o = orbsRef.current[i];
              const d = Math.hypot(o.x - bot.x, o.y - bot.y);
              if (d < closestDist) {
                closestDist = d;
                targetX = o.x - bot.x;
                targetY = o.y - bot.y;
              }
            }
          }

          const targetAngle = Math.atan2(targetY, targetX);
          bot.angle += (targetAngle - bot.angle) * 0.08;
          bot.vx = Math.cos(bot.angle) * bot.speed;
          bot.vy = Math.sin(bot.angle) * bot.speed;
          bot.x += bot.vx;
          bot.y += bot.vy;

          if (bot.trailHistory.length > 15) bot.trailHistory.shift();
          bot.trailHistory.push({ x: bot.x, y: bot.y, alpha: 0.8 });

          // Wall check for Bot
          if (distToCenter + bot.radius >= currentRadius) {
            bot.isAlive = false;
            bot.respawnTimer = 100;
            spawnExplosionParticles(bot.x, bot.y, bot.color, 25);
          }
        } else if (bot.respawnTimer && bot.respawnTimer > 0) {
          bot.respawnTimer -= 1;
          if (bot.respawnTimer <= 0) {
            const botAngle = Math.random() * Math.PI * 2;
            const botDist = Math.random() * (currentRadius * 0.45);
            bot.x = Math.cos(botAngle) * botDist;
            bot.y = Math.sin(botAngle) * botDist;
            bot.mass = 35 + Math.random() * 20;
            bot.score = Math.floor(bot.mass);
            bot.radius = 24 + Math.sqrt(bot.mass) * 1.5;
            bot.isAlive = true;
          }
        }
      });

      // 4. Orb Collisions & Replenishment
      const activePlayers = playersRef.current.filter((p) => p.isAlive);
      orbsRef.current.forEach((orb) => {
        activePlayers.forEach((player) => {
          const dist = Math.hypot(orb.x - player.x, orb.y - player.y);
          if (dist < player.radius + orb.radius) {
            // Eat orb!
            player.mass += orb.value * 0.2;
            player.score += orb.value;
            player.radius = 22 + Math.sqrt(player.mass) * 1.6;

            if (player.isUser) {
              soundFx.playOrbPickup(orb.value > 30 ? 4 : 1);
            }

            // Respawn orb in random valid arena position
            const orbAngle = Math.random() * Math.PI * 2;
            const orbDist = Math.sqrt(Math.random()) * (currentRadius - 50);
            orb.x = Math.cos(orbAngle) * orbDist;
            orb.y = Math.sin(orbAngle) * orbDist;
          }
        });
      });

      // 5. Player vs Player Combat Collisions
      for (let i = 0; i < activePlayers.length; i++) {
        for (let j = i + 1; j < activePlayers.length; j++) {
          const p1 = activePlayers[i];
          const p2 = activePlayers[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);

          if (dist < Math.max(p1.radius, p2.radius)) {
            // Check if one is significantly larger (>12%)
            if (p1.mass > p2.mass * 1.12) {
              // p1 eats p2
              p2.isAlive = false;
              p2.respawnTimer = 150;
              p1.mass += p2.mass * 0.45;
              p1.score += Math.floor(p2.score * 0.6);
              p1.kills += 1;
              p1.radius = 22 + Math.sqrt(p1.mass) * 1.6;
              spawnExplosionParticles(p2.x, p2.y, p2.color, 45);

              if (p1.isUser) {
                soundFx.playPlayerKill();
                killFeedRef.current.unshift({
                  text: `👑 ¡Eliminaste a ${p2.name}! (+${Math.floor(p2.score * 0.6)} pts)`,
                  time: Date.now(),
                });
              } else {
                killFeedRef.current.unshift({
                  text: `⚡ ${p1.name} devoró a ${p2.name}`,
                  time: Date.now(),
                });
              }
            } else if (p2.mass > p1.mass * 1.12) {
              // p2 eats p1
              p1.isAlive = false;
              p1.respawnTimer = 150;
              p2.mass += p1.mass * 0.45;
              p2.score += Math.floor(p1.score * 0.6);
              p2.kills += 1;
              p2.radius = 22 + Math.sqrt(p2.mass) * 1.6;
              spawnExplosionParticles(p1.x, p1.y, p1.color, 45);

              if (p1.isUser) {
                soundFx.playDeathWall();
                killFeedRef.current.unshift({
                  text: `💀 Fuiste eliminado por ${p2.name}`,
                  time: Date.now(),
                });
              }
            }
          }
        }
      }

      // 6. DRAWING CANVAS (Isometric 2.5D vs Minimalist 2D)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Save context for camera transformation
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
      ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

      // ==========================================
      // VISUAL MODE: ISOMETRIC 2.5D OR MINIMALIST
      // ==========================================
      const isIso = visualMode === 'isometric';

      // Draw Grid Background
      const gridSize = isIso ? 80 : 60;
      const startGridX = Math.floor((cameraRef.current.x - canvas.width / cameraRef.current.zoom) / gridSize) * gridSize;
      const endGridX = Math.ceil((cameraRef.current.x + canvas.width / cameraRef.current.zoom) / gridSize) * gridSize;
      const startGridY = Math.floor((cameraRef.current.y - canvas.height / cameraRef.current.zoom) / gridSize) * gridSize;
      const endGridY = Math.ceil((cameraRef.current.y + canvas.height / cameraRef.current.zoom) / gridSize) * gridSize;

      ctx.strokeStyle = isIso ? 'rgba(6, 182, 212, 0.08)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startGridX; x <= endGridX; x += gridSize) {
        ctx.moveTo(x, startGridY);
        ctx.lineTo(x, endGridY);
      }
      for (let y = startGridY; y <= endGridY; y += gridSize) {
        ctx.moveTo(startGridX, y);
        ctx.lineTo(endGridX, y);
      }
      ctx.stroke();

      // Draw Perimeter Arena Border (The Neon Wall)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);

      if (timeLeft <= 60) {
        // Red Danger Zone pulsing border
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008);
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.7 + pulse * 0.3})`;
        ctx.lineWidth = isIso ? 12 : 6;
        if (isIso) {
          ctx.shadowColor = '#f43f5e';
          ctx.shadowBlur = 30;
        }
      } else {
        // Cyan / Electric Blue boundary
        ctx.strokeStyle = isIso ? '#06b6d4' : '#38bdf8';
        ctx.lineWidth = isIso ? 8 : 4;
        if (isIso) {
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 20;
        }
      }
      ctx.stroke();
      ctx.restore();

      // Outer Death Fog (beyond the wall)
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius + 800, 0, Math.PI * 2);
      ctx.arc(0, 0, currentRadius, 0, Math.PI * 2, true);
      ctx.fillStyle = timeLeft <= 60 ? 'rgba(244, 63, 94, 0.25)' : 'rgba(2, 6, 23, 0.85)';
      ctx.fill();
      ctx.restore();

      // Draw Orbs
      orbsRef.current.forEach((orb) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;

        if (isIso) {
          // 3D glow & highlight
          ctx.shadowColor = orb.glowColor;
          ctx.shadowBlur = 10;
          ctx.fill();

          // Shiny core reflection
          ctx.beginPath();
          ctx.arc(orb.x - orb.radius * 0.3, orb.y - orb.radius * 0.3, orb.radius * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.fill();
        } else {
          // Clean flat vector
          ctx.fill();
        }
        ctx.restore();
      });

      // Draw Trails
      playersRef.current.forEach((p) => {
        if (!p.isAlive || p.trailHistory.length < 2) return;
        ctx.save();
        for (let i = 1; i < p.trailHistory.length; i++) {
          const pt1 = p.trailHistory[i - 1];
          const pt2 = p.trailHistory[i];
          const alpha = (i / p.trailHistory.length) * 0.6;
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.strokeStyle = p.trailColor || p.color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = (p.radius * 0.5) * (i / p.trailHistory.length);
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        ctx.restore();
      });

      // Draw Players
      playersRef.current.forEach((p) => {
        if (!p.isAlive) return;

        ctx.save();
        ctx.translate(p.x, p.y);

        if (isIso) {
          // Isometric 2.5D: Deep Shadow
          ctx.beginPath();
          ctx.ellipse(0, p.radius * 0.35, p.radius * 1.1, p.radius * 0.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fill();

          // Volumetric outer glow aura
          ctx.shadowColor = p.glowColor;
          ctx.shadowBlur = p.boostActive ? 35 : 22;

          // Main body cylinder base
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(-p.radius * 0.3, -p.radius * 0.3, 0, 0, 0, p.radius);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.3, p.color);
          grad.addColorStop(1, '#050814');
          ctx.fillStyle = grad;
          ctx.fill();

          // Neon Border Ring
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.boostActive ? 5 : 3;
          ctx.stroke();

          // Direction Pointer Arrow/Nose
          ctx.rotate(p.angle);
          ctx.beginPath();
          ctx.moveTo(p.radius + 8, 0);
          ctx.lineTo(p.radius - 6, -8);
          ctx.lineTo(p.radius - 6, 8);
          ctx.closePath();
          ctx.fillStyle = p.boostActive ? '#facc15' : '#ffffff';
          ctx.fill();
          ctx.rotate(-p.angle);
        } else {
          // Minimalist Mode: Clean Flat 2D
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Direction line
          ctx.rotate(p.angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(p.radius + 4, 0);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.rotate(-p.angle);
        }

        // Draw Crown on top
        if (p.crown) {
          ctx.fillStyle = '#eab308';
          ctx.shadowColor = '#eab308';
          ctx.shadowBlur = 10;
          ctx.font = `${Math.max(16, p.radius * 0.6)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('👑', 0, -p.radius - 8);
        }

        // Player Name & Mass Label
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(12, Math.min(16, p.radius * 0.45))}px 'Orbitron', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name, 0, p.radius + 16);

        ctx.fillStyle = '#94a3b8';
        ctx.font = `10px 'Share Tech Mono', monospace`;
        ctx.fillText(`${Math.floor(p.score)} pts`, 0, p.radius + 28);

        ctx.restore();
      });

      // Draw Particles
      particlesRef.current.forEach((pt, index) => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life += 1;
        pt.alpha = 1 - pt.life / pt.maxLife;

        if (pt.life >= pt.maxLife) {
          particlesRef.current.splice(index, 1);
          return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = Math.max(0, pt.alpha);
        if (isIso) {
          ctx.shadowColor = pt.color;
          ctx.shadowBlur = 8;
        }
        ctx.fill();
        ctx.restore();
      });

      ctx.restore(); // Restore camera transformation

      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [visualMode]);

  // Top In-Game Leaderboard list
  const currentLeaderboard = [...playersRef.current]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const user = playersRef.current.find((p) => p.isUser);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[100dvh] min-h-[100svh] bg-[#070913] overflow-hidden select-none font-sans"
    >
      {/* HTML5 Game Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full cursor-crosshair" />

      {/* TOP HUD BAR */}
      <div className="absolute top-0 left-0 right-0 p-2 sm:p-4 pointer-events-none z-10 flex justify-between items-start gap-2">
        {/* Left: Exit & Pot Info */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          <button
            id="game-exit-btn"
            type="button"
            onClick={() => setShowForfeitConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-300 backdrop-blur-md transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
            <span>Abandonar</span>
          </button>

          {/* Live Pot Box */}
          <div className="p-2 sm:p-3 rounded-xl bg-slate-900/85 border border-cyan-500/30 backdrop-blur-md shadow-lg flex flex-col gap-1 w-[min(210px,42vw)]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono-tech uppercase">Pote Acumulado:</span>
              <span className="font-orbitron font-bold text-yellow-400 text-sm">
                ${room.potUSD.toFixed(2)}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex">
              <div className="bg-gradient-to-r from-yellow-400 to-amber-500 h-full w-[80%]" title="80% al Ganador" />
              <div className="bg-cyan-500 h-full w-[20%]" title="20% Mantenimiento" />
            </div>
            <div className="hidden sm:flex justify-between text-[10px] text-slate-400 font-mono-tech pt-0.5 gap-2">
              <span className="text-amber-300 truncate">🏆 80% Ganador: ${(room.potUSD * (exchangeRates.winnerPotPercent / 100)).toFixed(2)}</span>
              <span className="text-cyan-300 truncate">⚙️ 20%: ${(room.potUSD * (exchangeRates.platformPotPercent / 100)).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Center: 3-Minute Match Countdown Timer */}
        <div className="flex flex-col items-center">
          <div
            className={`flex items-center gap-2 px-5 py-2 rounded-2xl border backdrop-blur-md transition-all ${
              timeLeft <= 60
                ? 'bg-rose-950/80 border-rose-500 text-rose-300 shadow-[0_0_25px_rgba(244,63,94,0.5)] animate-pulse'
                : 'bg-slate-900/85 border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
            }`}
          >
            <Timer className={`w-5 h-5 ${timeLeft <= 60 ? 'text-rose-400' : 'text-cyan-400'}`} />
            <span className="font-orbitron font-extrabold text-xl tracking-wider">
              {formatSeconds(timeLeft)}
            </span>
          </div>

          {timeLeft <= 60 && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] font-orbitron font-bold text-rose-400 bg-rose-950/70 px-3 py-0.5 rounded-full border border-rose-500/40">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
              <span>¡REDUCCIÓN DE ZONA ACTIVA!</span>
            </div>
          )}
        </div>

        {/* Right: Controls (Render Mode & Sound) & Match Leaderboard */}
        <div className="flex flex-col items-end gap-2 pointer-events-auto min-w-0">
          <div className="flex items-center gap-2">
            {isMobile && (
              <button
                id="game-mobile-settings-btn"
                type="button"
                onClick={() => setShowMobileSettings((visible) => !visible)}
                className="sm:hidden p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-cyan-300 backdrop-blur-md"
                title="Configurar controles táctiles"
                aria-label="Configurar controles táctiles"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              id="game-visual-toggle"
              onClick={() => setVisualMode(visualMode === 'isometric' ? 'minimalist' : 'isometric')}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 backdrop-blur-md transition-colors"
              title="Cambiar Motor Gráfico"
            >
              <Eye className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">
                {visualMode === 'isometric' ? '💎 Isométrica 2.5D' : '⚡ Minimalista'}
              </span>
            </button>

            <button
              id="game-sound-toggle"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 backdrop-blur-md"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>
          </div>

          {isMobile && showMobileSettings && (
            <div className="sm:hidden absolute top-12 right-0 z-30 w-[min(220px,70vw)] p-3 rounded-xl bg-slate-900/95 border border-cyan-500/40 shadow-xl backdrop-blur-md">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="game-mobile-control-size" className="text-[10px] font-orbitron font-bold text-slate-200">
                  Tamaño del control
                </label>
                <span className="text-[10px] font-mono-tech text-cyan-300">{mobileControlSize}px</span>
              </div>
              <input
                id="game-mobile-control-size"
                type="range"
                min="96"
                max="180"
                step="4"
                value={mobileControlSize}
                onChange={(event) => {
                  const size = Number(event.target.value);
                  setMobileControlSize(size);
                  localStorage.setItem('winorbs_mobile_control_size', String(size));
                }}
                className="mt-2 w-full accent-cyan-400"
              />
            </div>
          )}

          {/* Room Live Top 5 Leaderboard */}
          <div className="hidden sm:block p-3 rounded-xl bg-slate-900/85 border border-slate-800 backdrop-blur-md w-[170px] max-w-[35vw]">
            <div className="flex items-center gap-1.5 text-xs font-orbitron font-bold text-slate-300 pb-1.5 border-b border-slate-800 mb-1.5">
              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
              <span>TABLA EN VIVO</span>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              {currentLeaderboard.map((player, idx) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between font-mono-tech ${
                    player.isUser ? 'text-cyan-400 font-bold bg-cyan-950/40 px-1 rounded' : 'text-slate-400'
                  }`}
                >
                  <span className="truncate max-w-[100px]">
                    #{idx + 1} {player.name}
                  </span>
                  <span>{Math.floor(player.score)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Kill Feed Notification ticker */}
      <div className="absolute top-28 left-4 pointer-events-none z-10 flex flex-col gap-1 max-w-sm">
        {killFeedRef.current.slice(0, 3).map((kf, i) => (
          <div
            key={i}
            className="text-xs bg-slate-900/75 border border-slate-700/60 px-2.5 py-1 rounded-md text-slate-200 backdrop-blur-sm animate-fade-in"
          >
            {kf.text}
          </div>
        ))}
      </div>

      {/* Player Respawn / Death Message */}
      {user && !user.isAlive && !matchEnded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-30 pointer-events-none">
          <div className="text-center p-6 rounded-2xl bg-slate-900/90 border-2 border-rose-500/80 shadow-[0_0_30px_rgba(244,63,94,0.5)]">
            <Skull className="w-12 h-12 text-rose-500 mx-auto mb-2 animate-bounce" />
            <h2 className="text-xl font-orbitron font-extrabold text-white">¡HAS SIDO ELIMINADO!</h2>
            <p className="text-xs text-rose-300 mt-1">
              Respawn en curso... ¡Evita tocar las paredes exteriores!
            </p>
          </div>
        </div>
      )}

      {/* Mobile Touch Virtual Joystick & Turbo Boost button */}
      {isMobile && (
        <GameControlsMobile
          controlSize={mobileControlSize}
          onMove={(dx, dy) => {
            joystickVectorRef.current = { x: dx, y: dy };
          }}
          onBoost={(active) => {
            isBoostPressedRef.current = active;
          }}
        />
      )}

      {/* Desktop Helper hint */}
      {!isMobile && (
        <div className="absolute bottom-4 left-6 pointer-events-none z-10 text-[11px] font-mono-tech text-slate-400 bg-slate-900/70 px-3 py-1.5 rounded-lg border border-slate-800 backdrop-blur-sm">
          <span>🎮 Mouse: Dirección | 🚀 Espacio: Turbo Boost | ⚠️ Paredes: Muerte Instantánea</span>
        </div>
      )}

      {/* MATCH OVER OVERLAY (Victory / 80% Pot Distribution Screen) */}
      {matchEnded && winnerInfo && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0b0f24] border-2 border-cyan-500/60 rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.4)] text-center animate-fade-in relative overflow-hidden">
            {/* Header glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_20px_#06b6d4]" />

            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-yellow-500 to-amber-300 mx-auto flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(234,179,8,0.6)]">
              <Trophy className="w-8 h-8 text-black" />
            </div>

            <span className="text-xs font-orbitron font-bold tracking-widest text-cyan-400 uppercase">
              Partida Finalizada (3 Min)
            </span>
            <h2 className="text-2xl font-orbitron font-extrabold text-white mt-1">
              {winnerInfo.id === currentUser?.id ? '🎉 ¡ERES EL CAMPEÓN!' : `👑 Ganador: ${winnerInfo.name}`}
            </h2>

            {/* Pot Breakdown Box */}
            <div className="my-6 p-4 rounded-2xl bg-slate-900/90 border border-yellow-500/40 text-left flex flex-col gap-2.5">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <span className="text-xs text-slate-400">Pote Total Recolectado:</span>
                <span className="font-orbitron font-bold text-white">${room.potUSD.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-400" /> Premio al Ganador (80%):
                </span>
                <span className="font-orbitron font-extrabold text-amber-400 text-base">
                  +${(room.potUSD * (exchangeRates.winnerPotPercent / 100)).toFixed(2)} USD
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-400">
                <span>Mantenimiento y Servidores (20%):</span>
                <span>${(room.potUSD * (exchangeRates.platformPotPercent / 100)).toFixed(2)} USD</span>
              </div>
            </div>

            {/* User Personal Stats */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 uppercase font-mono-tech">Tu Puntuación</span>
                <p className="font-orbitron font-bold text-cyan-400 text-lg">{userScoreRef.current}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[11px] text-slate-400 uppercase font-mono-tech">Bajas Realizadas</span>
                <p className="font-orbitron font-bold text-rose-400 text-lg">{userKillsRef.current} Kills</p>
              </div>
            </div>

            <button
              id="game-finish-return-btn"
              onClick={onExit}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-bold tracking-wider text-sm transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)]"
            >
              VOLVER AL LOBBY & RECLAMAR
            </button>
          </div>
        </div>
      )}

      {/* Forfeit / Leave Match Confirmation Modal */}
      {showForfeitConfirm && (
        <div
          id="forfeit-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in pointer-events-auto"
        >
          <div className="relative w-full max-w-md bg-[#0c0e27] border-2 border-rose-500/70 rounded-3xl p-6 sm:p-7 shadow-[0_0_50px_rgba(244,63,94,0.4)] text-slate-100">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-rose-400 text-rose-400 flex items-center justify-center shadow-[0_0_25px_rgba(244,63,94,0.5)] animate-bounce">
                <AlertTriangle className="w-8 h-8" />
              </div>
            </div>

            <h3 className="font-orbitron font-extrabold text-xl text-center text-white mb-2">
              ¿Abandonar Torneo?
            </h3>

            <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 space-y-2 mb-6">
              <p>
                Estás en medio de la partida en{' '}
                <strong className="text-white">{room.name}</strong>.
              </p>
              <p className="text-[11px] text-rose-300">
                ⚠️ Si abandonas ahora, serás descalificado del pozo de{' '}
                <strong className="text-amber-400">${room.potUSD.toFixed(2)} USD</strong> y tu cuota
                de entrada de <strong className="text-cyan-300">${room.entryFeeUSD.toFixed(2)} USD</strong> no será devuelta.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                id="forfeit-cancel-btn"
                type="button"
                onClick={() => setShowForfeitConfirm(false)}
                className="w-full sm:flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-black text-xs shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
              >
                SEGUIR LUCHANDO
              </button>
              <button
                id="forfeit-confirm-btn"
                type="button"
                onClick={() => {
                  setShowForfeitConfirm(false);
                  onExit();
                }}
                className="w-full sm:w-auto py-3 px-4 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 hover:border-rose-400 text-rose-300 font-orbitron font-bold text-xs transition-all cursor-pointer"
              >
                ABANDONAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
