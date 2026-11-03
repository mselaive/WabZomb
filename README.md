# WabZomb

Zombis por rondas en primera persona, estilo Call of Duty Zombies, para jugar solo o hasta cuatro
con amigos desde el navegador. Es el hermano de WabCS: mismo motor 3D, misma infra, mismo netcode.
Tiene dos mapas: **La Roca**, una penitenciaría producida con materiales PBR y luz horneada, y **La
Fábrica**, el original, todo generado por código y sin bajar ni un asset.

- **Cliente**: Vite + TypeScript + Three.js → se despliega en Vercel.
- **Servidor**: Cloudflare Worker + Durable Objects (`partyserver`) → una sala = un Durable Object
  con su propio game loop a 20 Hz. Los zombis viven ahí: el servidor decide todo.
- **Simulación compartida**: `packages/shared` corre igual en el cliente y en el servidor. Eso es lo
  que permite la predicción del movimiento y los tiros, y que el servidor sea el único que decide.

## Empezar

Hace falta **Node 22** o más nuevo (lo pide wrangler, el servidor local). Está en `.nvmrc`.

```bash
npm install
npm run dev          # levanta el servidor (:8788) y el cliente (:5174) a la vez
```

Abrí <http://localhost:5174>. **Jugar solo** arma una sala propia que arranca sola. **Crear sala**
te da un código de 6 letras: copiá el link y pasáselo a tus amigos (hasta cuatro en total). Arranca
cuando todos marcan listo.

Los puertos son distintos de los de WabCS (5173 y 8787) para poder tener los dos corriendo.

### Controles

| Tecla | Acción |
|---|---|
| `WASD` | moverse · `Shift` correr (hacia adelante; corriendo no se dispara, y tomando una bebida no se corre) · `Ctrl` / `C` agacharse · `Espacio` saltar |
| Mouse | mirar (el primer click captura el puntero; `Esc` abre la pausa) |
| Click izquierdo | disparar · click derecho: la mira (los que tienen) |
| `R` | recargar · `1` `2` `3` cambiar de arma · `Q` la última arma · `F` mirar el arma |
| `V` (o la rueda) | cuchillo |
| `G` | tirar una granada |
| `E` | comprar lo que tengas adelante, abrir puertas, reparar ventanas (sostener), revivir (sostener) |
| `Tab` | tabla · `Enter` chat · `Esc` pausa |

## Cómo se juega

- Los zombis vienen por **rondas**. Cada ronda trae más (y con más vida: 150 en la primera, +100
  por ronda hasta la 9, después un 10 % más por ronda). Primero caminan; de la ronda 4 en adelante
  cada vez más corren. Hasta 24 vivos a la vez. Uno que se trabe en algún rincón y no se acerque a
  nadie en 40 s vuelve a la cola y sale por otro lado: la ronda nunca se queda colgada.
- Entran por las **ventanas**: arrancan las tablas una por una y pasan. Con `E` sostenida se
  reponen (10 puntos por tabla, hasta 10 por ronda). En las salas del fondo también salen del piso.
- Todo se paga con **puntos**: 10 por tiro que pega, 60 por baja, 100 en la cabeza, 130 con el
  cuchillo, 50 con una granada. Se arranca con 500.
- Dos manotazos te **tiran** (cinco con Juggernog). La vida vuelve sola a los 3,5 s sin que te
  peguen. Caído seguís disparando con la pistola; un compañero te levanta sosteniendo `E` (más
  rápido con Quick Revive); si nadie llega en 45 s, te morís hasta la próxima ronda. Jugando solo,
  Quick Revive te levanta a vos (tres veces por partida): mientras estás en el piso los zombis se
  quedan a distancia, y al levantarte salen empujados y tenés 2,5 s sin que te toquen. Si caen
  todos, se terminó: queda la ronda a la que llegaron.

### El mapa: La Roca

Una penitenciaría en una isla, de noche, con tormenta y niebla. La planta sale de los planos
públicos de Alcatraz (Servicio de Parques de EE. UU.): cuatro bloques de celdas de tres pisos,
Broadway por el medio, Times Square con su reloj, el hospital arriba del comedor, la ciudadela de
piedra abajo. Es un mapa propio: ningún modelo, textura, personaje ni sonido sale de otro juego.

Los zombis salen de las celdas tapiadas: arrancan los tablones desde adentro y entran al pasillo.
Las balas pasan entre los barrotes. Hay tres alturas caminables, todas por escalera.

| Zona | Cómo se llega | Qué hay |
|---|---|---|
| Broadway | se arranca acá | M14, Olympia, Quick Revive en una celda abierta, un lugar de la caja |
| Times Square | reja 750 | MP40, Juggernog, el reloj |
| Control | reja 750 | granadas |
| Galería | reja 1000 (desde Broadway) | el segundo piso, con puentes sobre Broadway |
| Michigan Avenue | reja 1000 (desde Times Square o Control) | AK74u, Mule Kick, un lugar de la caja |
| Calle D | reja 1000 (desde Times Square o Control) | PM63, el aislamiento, la biblioteca, dos lugares de la caja |
| Comedor | puerta 1000 (desde Times Square) | M16, Stakeout, mesas largas, un lugar de la caja |
| Cocina | puerta 1000 (desde el comedor) | Speed Cola |
| Patio de recreo | puerta 1250 (desde el comedor) | a cielo abierto: MP5K, Stamin-Up, gradas, un lugar de la caja |
| Hospital | puerta 1250 (desde la galería) | las salas de internación, un lugar de la caja |
| Azotea | reja 1000 (desde el hospital) | la terraza y el techo de los bloques; una escalera de incendios baja al patio (750) |
| Administración | puerta 1250 (desde Control) | Python, Double Tap, oficina del alcaide, visitas, armería, el banco de trabajo |
| El muelle | portón 1500 (desde el patio o administración) | a cielo abierto: **Pack-a-Punch** al final del espigón, un lugar de la caja |
| La ciudadela | reja 1500 (desde la calle D) | **la luz**, el horno, los calabozos del fuerte viejo |

Hasta prender la luz sólo hay faroles rojos de emergencia y la luna que entra por los tragaluces.

### El otro mapa: La Fábrica

Una fábrica abandonada de noche, ocho zonas y dos caminos para dar la vuelta entera.

| Zona | Cómo se llega | Qué hay |
|---|---|---|
| Oficina | se arranca acá | M14 (500), Olympia (500), Quick Revive, tres ventanas |
| Depósito | puerta 750 | MP40 (1000), granadas (250), Stamin-Up, un lugar de la caja |
| Patio | portón 750 | a cielo abierto: Stakeout (1500), Double Tap, un lugar de la caja |
| Calderas | escombros 1000 (desde el depósito) | **la luz**, Juggernog, M16 (1200), un lugar de la caja |
| Taller | reja 1000 (desde el patio) | AK74u (1200), Speed Cola, un lugar de la caja |
| Laboratorio | puerta 1250 (desde las calderas o el taller) | **Pack-a-Punch**, MP5K (1000), Mule Kick |
| Vestuarios | puerta 1000 (desde el depósito) | Python (1200), lockers, duchas, un lugar de la caja |
| Estacionamiento | portón 1000 (desde el patio) | a cielo abierto: PM63 (1000), autos abandonados, un lugar de la caja |

### Lo que se compra

- **Armas de pared**: la tiza en la pared. La primera vez te la da cargada; si ya la tenés, te vende
  la munición a mitad de precio (4500 si está mejorada).
- **Caja misteriosa** (950): arranca en cualquiera de sus seis lugares (depósito, patio,
  calderas, taller, vestuarios o estacionamiento: nunca en el laboratorio) y da un arma al azar de las 20 que hay,
  incluida la Ray Gun (rara). La deja a la vista 10 s para agarrarla con `E`. A partir de la quinta
  vuelta puede salir el **osito**: te devuelve la plata y la caja se muda. Con **Fire Sale** sale 10.
- **La luz**: la palanca de las calderas. Sin luz no andan las bebidas (salvo Quick Revive) ni el
  Pack-a-Punch.
- **Bebidas** (hasta cuatro; caerse las saca todas):
  Juggernog 2500 (250 de vida) · Speed Cola 3000 (recargás al doble) · Double Tap 2000 (cada bala
  pega el doble) · Quick Revive 1500, o 500 jugando solo · Stamin-Up 2000 (más rápido) ·
  Mule Kick 4000 (una tercera arma).
- **Pack-a-Punch** (5000): entregás el arma, la máquina trabaja 5 s y te la devuelve mejorada, con
  otro nombre, mucho más daño y más balas (la M1911 vuelve como "Mustang & Sally", con balas que
  estallan; la Ray Gun como "Porter's X2 Ray Gun").

### Power-ups

Caen de vez en cuando donde muere un zombi (hasta cuatro por ronda) y duran 30 s en el piso:
**Max Ammo** (reserva y granadas llenas para todos), **Insta-Kill** (30 s de matar de un tiro),
**Double Points** (30 s), **Nuke** (mueren todos los que están, 400 puntos para cada uno),
**Carpenter** (todas las tablas de vuelta, 200 puntos) y **Fire Sale** (la caja a 10 por 30 s).

### Las armas

| Arma | Dónde | Daño | Cargador | Mejorada |
|---|---|---|---|---|
| M1911 | de arranque | 30 | 8 | Mustang & Sally (explosiva) |
| Python · CZ75 | caja | 110 · 35 | 6 · 15 | Cobra · Calamity (automática) |
| Olympia · Stakeout · SPAS-12 | pared 500 · pared 1500 · caja | 25×8 · 30×8 · 22×8 | 2 · 6 · 8 | Hades · Raid · SPAZ-24 |
| M14 · M16 | pared 500 · pared 1200 | 70 · 40 | 8 · 30 | Mnesia · Skullcrusher |
| MP40 · MP5K · AK74u | pared 1000 · 1000 · 1200 | 32 · 30 · 36 | 32 · 30 · 20 | The Afterburner · MP115 Kollider · AK74fu2 |
| PM63 · Spectre | caja | 28 · 30 | 20 · 30 | Tokyo & Rose · Phantom |
| Galil · Commando · FAMAS · AUG · G11 | caja | 48 · 45 · 40 · 45 · 55 | 35 · 30 · 30 · 30 · 48 | Lamentation · Predator · G16-GL35 · AUG-50M3 · G115 Generator |
| RPK · HK21 | caja | 55 · 60 | 100 · 125 | R115 Resonator · H115 Oscillator |
| L96A1 · Dragunov | caja | 400 · 250 | 5 · 10 | L115 Isolator · D115 Disassembler |
| Ray Gun | caja (rara) | 1000 + explosión | 20 | Porter's X2 Ray Gun |
| Thunder Gun | se arma (easter egg) | mata a todos en 9 m adelante | 2 | Zeus Cannon (13 m) |

En la cabeza pega 3 veces (3,5 los fusiles, 5 el L96). Las escopetas pierden mucho con la
distancia; los fusiles casi nada.

### El easter egg

Hay tres radios viejas escondidas en el mapa, y sin corriente no dicen nada. Con la luz
prendida, cada una cuenta una página del diario del ingeniero: qué estaba haciendo la fábrica y
dónde quedaron las piezas. Las tres juntas hacen sonar una canción y abren algo que estaba con
llave. De ahí en adelante hay tres piezas para juntar: una bajo llave, una arriba de algo, y una
que la escupe **el horno** cuando se le dieron suficientes almas (zombis muertos al lado). Con las
tres, en el banco de trabajo se arma la **Thunder Gun**: un soplido
que se lleva a todos los zombis que tenga adelante, 2 tiros por cargador. Mejorada es la **Zeus
Cannon**. Dónde está cada cosa, no lo dice el README.

En La Roca sigue: **la fuga**, una historia propia contada en las grabaciones de un médico de la
prisión: una caja fuerte con la combinación en tiza, las piezas de una lancha, tres llaves de corte
contra reloj, un faro que recién se prende al final, dos minutos de asedio, el alcaide y, si todos
llegan, la salida en lancha. También hay armas especiales: la Blundergat, que se puede templar
en el horno, el reflector de guardia y el hacha de incendios. El paso a paso, con todos los spoilers,
está en [GUIA_EASTER_EGG.md](GUIA_EASTER_EGG.md). Dentro del juego, Tab muestra lo que sigue.

## Cómo está hecho

Lo que importa de la arquitectura está heredado de WabCS y explicado allá: predicción del jugador
local con reconciliación, interpolación de los demás 100 ms en el pasado, compensación de lag para
los tiros (acá se rebobina a los zombis), inputs a 20 Hz, una sala por Durable Object.

Lo nuevo:

- **Zombis en el servidor** (`sim/zombies.ts`): aparecen por los spawners de las zonas abiertas
  donde hay alguien (o vecinas), caminan con la misma física que los jugadores, buscan el camino
  con A* sobre una grilla de medio metro (`sim/nav.ts`) en la que las puertas cerradas están
  bloqueadas, y de cerca van derecho. Afuera caminan a su ventana, arrancan las tablas y pasan.
- **Rondas** (`sim/rounds.ts`): anuncio, zombis que salen de a uno cada vez más seguido, fin de
  ronda cuando cayó el último, caídos, desangrados, fin de partida.
- **Comprar** (`sim/interact.ts`): `findInteraction` decide qué hace `E` según dónde estés y es lo
  mismo que usa el cliente para el cartel. La caja, el Pack-a-Punch y las bebidas tienen su estado.
- **Un solo snapshot** para todos: es cooperativo, nadie tiene nada que esconder. Cada uno recibe
  sus propios campos (munición, puntos, perks) en su tupla.
- **Armas por descripción** (`weapons.ts` → `look`): cada una es un cuerpo, un caño, un cargador,
  una culata y una mira; el cliente arma el modelo de cajas con eso. Mejorada se pinta violeta.

### Cómo se hizo La Roca

- **Pisos** (`map/types.ts`, `sim/nav.ts`, `sim/interact.ts`): las zonas pueden tener un rango de
  altura, las puertas bloquean nodos de la grilla (no columnas enteras) y comprar mira también la
  altura: la máquina de abajo no se usa desde la galería.
- **Colisión y dibujo separados**: `map/roca.ts` tiene las cajas que chocan, más un bloque `art`
  que sólo lee el cliente (luces, modelos, filas de celdas, barandas). El servidor no paga nada.
- **Luz horneada** (`tools/bake.ts`, `map/lightmap.ts`): luz directa con sombras, luna, cielo y dos
  rebotes, en dos imágenes (apagada y prendida). Cliente y herramienta calculan igual dónde va cada
  cara, así que si se cambian las cajas del mapa **hay que volver a hornear**.
- **Lo que no entra en el lightmap** (`render/roca.ts`): las celdas, los barrotes y los modelos son
  instancias, y cada una lleva sus dos colores de luz calculados al cargar.
- **Cámara** (`render/post.ts`): resplandor, grado de color, viñeta y grano. Si anda por debajo de
  40 cuadros durante unos segundos, baja la resolución sola.

Los assets son de [Poly Haven](https://polyhaven.com), con licencia CC0, y se listan en
`apps/client/public/roca/CREDITOS.md`. Para regenerarlos:

```bash
cd tools
npm install
npm run assets      # baja y optimiza texturas y modelos
npm run bake        # hornea la luz (unos diez minutos; con --fast, tres)
```

### Tests

```bash
npm test          # vitest: mapas, zombis, rondas, compras, tiros, cooperativo
npm run typecheck
npm run smoke     # compila el cliente y comprueba que el bundle arranque (playwright)
```

## Desplegar

Igual que WabCS: `npm run deploy:server` con tu cuenta de Cloudflare (`npx wrangler login`), y el
cliente en Vercel con `VITE_SERVER_URL` apuntando al worker. `ALLOWED_ORIGINS` en
`apps/server/wrangler.jsonc` tiene que incluir el dominio del cliente.
