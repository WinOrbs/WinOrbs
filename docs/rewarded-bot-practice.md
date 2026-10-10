# Práctica SOLO y boletos

La práctica contra bots es gratis. Al pulsar SOLO, el lobby carga la viñeta de
Monetag de la zona `11978865` mientras solicita la entrada a la práctica y espera
a que el script cargue antes de navegar. Si falla o tarda más de cinco segundos,
se permite iniciar la partida. La carga del script no confirma que el anuncio
haya sido mostrado o completado. La viñeta se carga una sola vez por página y
no sustituye al service worker de Monetag.

Los bots de práctica navegan alrededor de muros y obstáculos, buscan botiquines
cuando están heridos y recogen energía para asegurarla en el banco. En combate
anticipan el movimiento del rival al apuntar, cambian de posición para evitar
disparos y priorizan salir de peligros activos y de la zona que se cierra.

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
