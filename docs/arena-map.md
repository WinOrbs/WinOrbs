# Arena map and destructible cover

The arena is 7,000 × 7,000 world units. Use **M** to toggle the centered,
translucent full-map overlay; on touch devices, tap the compact map to open it
or its close button to dismiss it. It marks the safe zone, next zone, shops,
bank, airdrops, cover, explosive barrels, and player positions. The compact map
stays in the corner when the overlay is closed.

Cars, motorcycles, rocks, and walls use larger world-space hitboxes so their
collision footprint better matches their art. Four five-barrel clusters are
generated per arena away from the bank and speed pads. Destroying a barrel
starts a delayed chain reaction through nearby explosive objects.
The player who triggers an explosive chain sees its combo grow on screen. Each
round also draws a different objective from a small set: build an explosive
combo, earn eliminations, or secure points at the bank. Objective progress is
match-only and cosmetic; it does not award paid currency or gameplay upgrades.
Final standings show every player's best chain, and team matches also highlight
the best chain reached by each team. These records are display-only and do not
change the leaderboard, prize pool, or payouts.

## Global trophy room

Explosion combos and multi-kills are achievements, not secondary-mission tasks.
The trophy room keeps one persistent global record holder for each category:
10 consecutive player eliminations without dying, at least 3 player
eliminations in 10 seconds, and at least 5 destructible objects in one
explosion chain. A record changes only when a higher value is achieved; ties
keep the existing holder. Records are credited to verified accounts in official
matches with at least two human players. Practice matches and bot eliminations
do not count.

## Secondary missions

Each destroyed wall or destructible obstacle has a 10% chance to drop a mission
pickup at its location. Only the player who destroyed the cover can collect
that pickup. The collected mission randomly selects 10 distinct tasks from the
mission pool; tasks progress simultaneously. Each completed task adds 70
unsecured match points to the player who completed it (700 points across all
ten tasks). Players must reach the bank to secure those points; death can put
unsecured points at risk. A player can abandon an unfinished mission or start
another after completing it.

In team mode the checklist is shared by the team, while each 70-point task
reward goes to the teammate whose action completes it. Missions are server
tracked and use the regular match score, so in paid rooms banked mission points
affect standings and prizes under the same rules as other banked points.
