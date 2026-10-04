# Platform progression

Daily mission completion is evaluated from the server-locked match result. XP,
level, daily counters, unlocked visual rewards, and the public leaderboard
nickname are stored in `progresion/{uid}` using a Firestore transaction.

Each account also gets a private `progresion/{uid}/partidas/{sha256(gameId)}`
claim document. The transaction creates this marker with the progression update
so replaying a match result cannot award XP twice. Abandoned matches do not
advance daily missions. Daily counters roll over at 00:00 UTC.

The progression curve starts at 150 XP for level 2 and increases the next-level
cost by 5 XP per level. Level is capped at 100; total XP continues accumulating
for global ranking. Each 10-level milestone unlocks one configurable visual
reward (`aura` or `skin`). Administrators configure its name, colors, type, and
optional HTTPS image in `configuracion/progresion`. Reward selection is stored
by the server and checked against unlocked rewards before the appearance is
sent to other players. The legacy `unlockedAuras` and `equippedAura` fields are
read during migration; new state uses `unlockedRewards` and `equippedReward`.

The lobby reads only the authenticated player's progression document. Global
ranking and reward changes go through authenticated Socket.IO events; the
ranking response contains public nicknames, levels, XP, and positions only.
Reward images are sent only as part of the validated equipped appearance and
are size-limited before inclusion in real-time game state.
