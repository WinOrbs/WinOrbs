# Anuncios recompensados en la práctica con bots

WinOrbs puede solicitar un anuncio recompensado de Google Publisher Tag (GPT)
antes de crear una partida gratuita contra bots. El jugador acepta verlo de forma
explícita; la partida se desbloquea solo cuando GPT notifica la recompensa. Si
no hay inventario o GPT no está disponible, se ofrece continuar gratis. Cerrar
el anuncio antes de recibir la recompensa no inicia la partida.

## Configuración de Google Ad Manager

1. Crea una unidad publicitaria con inventario web recompensado en Google Ad
   Manager y configura la demanda correspondiente.
2. En el servicio Node, establece `GAM_REWARDED_AD_UNIT_PATH` con la ruta de la
   unidad, por ejemplo `/1234567/games/bot_practice`. No es el URL de la página.
3. Reinicia y despliega el backend. Sin una ruta válida el lobby deja el modo
   SOLO disponible y permite iniciar la práctica gratis.
4. Prueba con inventario de desarrollo y verifica el consentimiento, la
   recompensa, el cierre sin recompensa y el caso sin inventario antes de
   activar la unidad de producción.
5. Configura los avisos de privacidad/cookies y la plataforma de gestión de
   consentimiento requerida para los territorios donde se sirve publicidad.
   Aceptar ver un anuncio es una decisión separada; no reemplaza el
   consentimiento de privacidad.

El cliente usa el formato `REWARDED` de GPT y sus eventos
`rewardedSlotReady`, `rewardedSlotGranted` y `rewardedSlotClosed`. Consulta la
[guía oficial de anuncios recompensados para web en Google Ad Manager](https://support.google.com/admanager/answer/9116812)
y la [muestra oficial de GPT](https://developers.google.com/publisher-tag/samples/display-rewarded-ad).

**Límite importante:** Google Ad Manager no ofrece verificación server-side
(SSV) para anuncios recompensados web. Por eso, el evento de recompensa se
valida en el navegador según el flujo oficial, pero un cliente modificado puede
saltarse el anuncio y solicitar una práctica gratuita directamente. No se
acreditan dinero, moneda transferible ni progreso de cuenta por ver anuncios.
