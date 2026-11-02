# Ideas para WabZomb

Lo que hay, lo que quedó en la lista y por qué. Primera versión: 2 de noviembre de 2026.

## Lo que hay

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Motor | El de WabCS: movimiento con predicción, tiros con compensación de lag, 20 Hz, Durable Objects | Heredado; typecheck y navegador |
| Zombis | Aparecen por ventanas (arrancan tablas) o del piso, A* con puertas bloqueadas, caminan/trotan/corren, manotazo con aviso | 5 tests + navegador (entran, pegan, te tiran) |
| Rondas | Cantidad y vida por ronda, aparición cada vez más seguida, intermedio, fin de partida con la ronda alcanzada | Tests + navegador (3 rondas con un apuntador automático) |
| Puntos | Por tiro, baja, cabeza, cuchillo, granada, tabla reparada (tope por ronda) | Tests |
| Puertas y zonas | Seis zonas, seis puertas, dos caminos al laboratorio; los spawners se activan por zona | Tests + navegador (compré la puerta del depósito) |
| Armas | 23 armas con descripción para el modelo, 8 en la pared, 20 en la caja; Pack-a-Punch con nombre y stats nuevos | Tests + capturas |
| Caja | Gira, ofrece, espera 10 s, el osito la muda | Test |
| Bebidas | Seis, con la luz como requisito (menos Quick Revive), tope de cuatro, se pierden al caer | Tests |
| Caídos | Revivir sosteniendo E, desangrado, Quick Revive solo, fin de partida | Tests |
| Power-ups | Max Ammo, Insta-Kill, Double Points, Nuke, Carpenter, Fire Sale | Revisado; sin test propio |
| Easter egg | Tres radios escondidas; las tres prendidas hacen sonar una canción generada | Revisado; sin test propio |
| Gráficos | Mapa de noche con luna y estrellas, lámparas que cambian al prender la luz, tiza en las paredes, máquinas, tablas, zombis de cajas con ojos que brillan | Capturas |
| Sonido | Generado por código: tiros por clase, gruñidos, tablas, máquinas, rondas, la canción | **No lo escuché**: el navegador de prueba no tiene salida |

## Lo que falta, en orden

1. **Probarlo con gente.** Todo lo de arriba se probó solo y con un apuntador automático. Hace
   falta jugarlo de verdad: si los zombis son muy lentos o muy rápidos, si los precios cierran, si
   las rondas altas se ponen imposibles. Los números viven en `constants.ts`.
2. **El easter egg grande.** Las radios son el gancho. La idea es una cadena: la canción abre una
   trampa, la trampa pide la luz y el Pack-a-Punch, y al final hay algo (un arma que no sale de
   la caja, o terminar la partida con un final). Se puede construir con lo que hay: puertas que no
   se compran sino que se abren por evento, interacciones nuevas en `findInteraction`.
3. **Rondas de perros.** Cada 5 o 6 rondas una de perros rápidos y débiles que aparecen con un
   rayo. El tipo de zombi ya existe (`type`); harían falta otro modelo y otra velocidad.
4. **Más armas de verdad.** Thundergun, Monkey Bomb, ballestas. El Monkey Bomb es fácil: una
   granada que atrae (`target` de los zombis apuntando a ella).
5. **Un segundo mapa.** Con el formato (zonas, puertas, ventanas, spawners) es rápido; lo que
   lleva tiempo es que sea divertido para correr en círculos.
6. **Bots compañeros**, para jugar "solo" pero con alguien que te levante. El servidor ya tiene
   todo para mover un jugador sin conexión (WabCS lo hacía).
7. **Teléfono.** Igual que en WabCS: no es prioridad.

## Dudas abiertas

- **24 zombis a 20 Hz.** Cada uno recalcula el camino cada segundo (repartido). En el Durable
  Object entra sin problema; si algún día se quieren más, bajar la cadencia del A* o hacerlo
  por grupos.
- **Puntos de las escopetas.** Cada tiro paga 10 por zombi tocado, no por perdigón. Si alguien
  siente que la escopeta "no paga", es acá.
- **Las tablas no bloquean los tiros** (`thin`): se les dispara a los zombis a través de la
  ventana, como en el original. Los zombis tampoco pueden entrar hasta que no queda ninguna.
