# Práctica SOLO y boletos

La práctica contra bots es gratis. Al pulsar SOLO, el lobby carga la viñeta de
Monetag de la zona `11978865` mientras solicita la entrada a la práctica y espera
a que el script cargue antes de navegar. Si falla o tarda más de cinco segundos,
se permite iniciar la partida. La carga del script no confirma que el anuncio
haya sido mostrado o completado. La viñeta se carga una sola vez por página y
no sustituye al service worker de Monetag.

## Combate de práctica

La práctica conserva su formato SOLO FFA con cinco bots: no añade oleadas,
jefes ni modo cooperativo. Durante la partida los bots priorizan supervivencia,
botiquines, orbes y extracción; sus personalidades varían la agresividad y la
distancia de combate. Se desplazan por rutas que consideran muros y obstáculos,
recalculan si un objetivo cambia o dejan de avanzar y solo disparan cuando tienen
la línea de tiro despejada. En combate anticipan el movimiento observado del
objetivo, alternan entre pistola y Lanza-Orbes cuando disponen de ella y usan
recursos, bombas, dash y recargas según el peligro. Los bots mantienen el respawn
existente del modo.

La mejora no modifica el formato de la partida, las reglas de victoria, la
economía ni la acreditación de boletos/progreso SOLO.

El servidor acredita una victoria SOLO solo cuando el resultado final de la
partida identifica a un ganador con UID verificado. Los invitados pueden jugar,
pero no acumulan victorias ni boletos. La cuenta recibe un boleto acumulable
cada 10 victorias; las victorias sobrantes avanzan la barra hacia el siguiente.
El contador y los boletos se escriben en el perfil `usuarios/{uid}` mediante
transacciones del servidor y cada partida se acredita una sola vez.

Si la cuenta tiene boletos, el servidor consume uno automáticamente al entrar
en una sala pública FFA cuya entrada coincide con el nivel FFA más económico
configurado actualmente. No sirve para salas TEAM, privadas ni niveles de mayor
precio. La entrada promocional cuenta en el pozo de la partida; no descuenta
saldo. Si el ingreso falla antes de ocupar la plaza, se devuelve el boleto.
