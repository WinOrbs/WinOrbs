interface MatchToken {
  sessionId: string;
  roomId: string;
  roomCode: string;
  playerId: string;
  startTime: number;
  nonce: string;
  checksum: string;
}

interface MatchTelemetry {
  score: number;
  kills: number;
}

interface MatchRequest {
  token: MatchToken;
  telemetry: MatchTelemetry;
  currentPlayers?: number;
}

interface AntiCheatResponse {
  valid: boolean;
  verifiedScore?: number;
  reason?: string;
}

function json(data: AntiCheatResponse, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function checksum(token: MatchToken): string {
  const payload = `${token.sessionId}:${token.roomId}:${token.playerId}:${token.startTime}:${token.nonce}:NEON_SALT_2026`;
  let hash = 0;
  for (let index = 0; index < payload.length; index++) {
    hash = ((hash << 5) - hash) + payload.charCodeAt(index);
    hash |= 0;
  }
  return `chk_${Math.abs(hash).toString(16)}`;
}

export async function onRequestPost(context: { request: Request }): Promise<Response> {
  let body: MatchRequest;
  try {
    body = await context.request.json() as MatchRequest;
  } catch {
    return json({ valid: false, reason: 'Solicitud anti-cheat inválida.' }, 400);
  }

  const { token, telemetry, currentPlayers = 15 } = body;
  if (!token || !telemetry || typeof token.startTime !== 'number' ||
      typeof telemetry.score !== 'number' || typeof telemetry.kills !== 'number') {
    return json({ valid: false, reason: 'Datos de partida incompletos.' }, 400);
  }

  if (token.checksum !== checksum(token)) {
    return json({ valid: false, reason: 'Firma criptográfica de partida no válida.' });
  }

  const elapsedSeconds = (Date.now() - token.startTime) / 1000;
  if (elapsedSeconds < 20) {
    return json({ valid: false, reason: `Duración de partida insuficiente (${elapsedSeconds.toFixed(1)}s). Mínimo requerido: 20s.` });
  }

  const maxAllowableScore = Math.floor(elapsedSeconds * 180 + (telemetry.kills * 1500) + 1500);
  if (telemetry.score > maxAllowableScore) {
    return json({ valid: false, reason: `Puntuación física no permitida (${telemetry.score} > ${maxAllowableScore}). Telemetría anómala detectada.` });
  }

  const maxPossibleKills = Math.max(1, Math.floor(currentPlayers)) * 5;
  if (telemetry.kills > maxPossibleKills) {
    return json({ valid: false, reason: `Conteo de bajas irreal (${telemetry.kills}).` });
  }

  return json({ valid: true, verifiedScore: telemetry.score });
}