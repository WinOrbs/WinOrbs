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
