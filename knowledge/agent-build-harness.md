# El harness de construcción de cursos

Cómo el agente pasa de "fuentes subidas" a "curso construido", por qué fallaba, y
qué lo sostiene ahora. Escrito el 2026-08-02, después de reescribir los andamios.

## El objetivo

El instructor sube fuentes (PDFs, páginas web). El agente propone un plan. El
instructor lo acepta, lo modifica o lo descarta. Una vez aceptado, el agente
construye el curso completo —contenido y diagramas— sin supervisión paso a paso.

Del lado del alumno un RAG simple alcanza. Del lado del instructor **no**: para
decidir un temario, o para escribir la lección 9 sin repetir la 3, hace falta el
material **completo y simultáneo**. RAG contesta "qué pasaje menciona X", que es
otra pregunta. Por eso el diseño se apoya en contexto cacheado, no en recuperación.

Y eso, sin un marco que lo sostenga, se cae.

## Los cuatro fallos que tenía, y qué los causaba

### 1. Duplicaba secciones y lecciones

**No era el modelo perdiéndose. Era el servidor ordenándole duplicar.**

`buildPlanProgressAnchor` comparaba el plan contra el curso vivo **por título
normalizado**. El modelo mejora títulos mientras construye —crea
`"1.1 Introducción al muestreo"` para un ítem del plan llamado `"Introducción"`—
así que la lección existía pero el ancla la reportaba `⬜ missing`. Y el ancla usa
el énfasis más fuerte de todo el prompt:

> *"Trust THIS, not your memory of what you did (…) create the missing items (…)
> without pausing to ask the teacher."*

El modelo obedecía. Y `create_section` / `create_lesson` / `create_exercise`
insertaban sin ningún chequeo de existencia.

**Fix:** el registro de plan ([plan-registry.ts](../packages/db/src/queries/agent/plan-registry.ts)).
Cada ítem del plan recibe una clave corta y estable (`s1`, `s1.2`) y guarda el
`entityId` de la fila que se construyó a partir de él. La reconciliación pregunta
"¿existe todavía la fila `<uuid>`?" en vez de "¿hay alguna fila con este título?".

Y los `create_*` reciben ese `planKey` y se vuelven **idempotentes**: un segundo
create sobre una clave ya vinculada devuelve la fila existente (`reused: true`).
Aunque el ancla se equivoque, el duplicado ya no puede ocurrir.

La reconciliación además **conserva las claves al re-planificar**, que es lo que
hace el plan editable: pedir una sección extra a mitad de la construcción ya no
deja huérfano lo construido.

### 2. El progreso era autoinforme

El checklist de la UI se pintaba con la salida de `update_course_todo_list` — el
modelo hablando de sí mismo. El prompt exigía una llamada de burocracia después de
**cada** ítem construido; con `MAX_STEPS_PER_ROUND = 40`, eso es un tercio de la
ronda narrando en vez de construyendo.

El modelo dejó de pagar ese costo. Resultado: **1/32 en pantalla con 10 lecciones
ya escritas en la base**. No se perdió; priorizó bien.

**Fix:** la herramienta se retiró. El progreso viaja en
`messageMetadata.planProgress`, reconciliado en el servidor después de que las
escrituras de la ronda aterrizaron. El checklist muestra eso.

> Regla general que salió de acá: **si un número puede divergir de la realidad, va
> a divergir.** El modelo no debe reportar su propio estado cuando el servidor
> puede medirlo.

### 3. Había que apretar "Continuar" a mano

Un curso necesita más llamadas que las que entran en una ronda. El instructor
terminaba apretando "Continuar" una y otra vez para un plan que ya había aprobado.

**Fix:** el dashboard continúa solo, con tres frenos:
- tope de rondas automáticas;
- **detección de estancamiento**: si una ronda entera no completa ningún ítem
  nuevo, corta y devuelve el control;
- Stop (o cualquier error) lo desactiva.

Sólo se dispara con progreso medido por el servidor, nunca con la afirmación del
modelo de que le falta trabajo.

### 4. Las fuentes no llegaban completas, y la caché no cacheaba

Dos problemas separados en el mismo lugar.

**Completitud:** `loadDocumentsContext` daba texto completo **sólo** al documento
adjunto al mensaje actual; el resto degradaba a resumen. Un instructor con tres
PDFs planificaba con uno. Y `fetch_documentation_url` devolvía la página como
resultado de herramienta dentro del transcript — que en modo build se descarta
entero, así que **la página desaparecía justo cuando se construía el curso**.

**Caché:** `contextMessageText` concatenaba en **un solo mensaje** lo estable (el
texto de las fuentes) y lo volátil (estructura del curso, plan progress), y ese
mensaje entero llevaba `cache_control`. Una caché de prompt es un match de
prefijo: cada sección que el agente creaba cambiaba el bloque e invalidaba las
fuentes con él. El paquete se **reescribía a 1.25x en cada turno** en vez de
leerse a 0.1x. Exactamente lo contrario de para qué está la caché.

**Fix:** [source-pack.ts](../apps/api/src/services/agent/source-pack.ts) arma
**todas** las fuentes del curso en un bloque, ordenado por fecha de creación para
que sea estable byte a byte. Y ese bloque viaja como **mensaje propio**, tageado,
**antes** del contexto volátil:

| Mensaje | Contenido | `cache_control` |
|---|---|---|
| A | paquete de fuentes | sí |
| B | estructura + plan progress | no |

Las URLs además se persisten como documentos
(`POST /agent/documents/url`), así que entran al paquete y sobreviven al build.

## Lo que NO es un subagente

`isBuildSubagent` en [agent.ts](../apps/api/src/routes/agent/agent.ts) es sólo un
nombre. No hay delegación ni coordinación entre agentes: es el mismo modelo, el
mismo loop, y lo único que hace es **descartar el transcript y quedarse con el
último turno del usuario**.

Es buena decisión de costo, pero implica que **toda la continuidad entre rondas
descansa en las anclas de contexto**. Por eso el punto 1 era tan grave: la única
ancla que era verdad del servidor comparaba strings.

Si alguna vez se agregan subagentes de verdad, este documento hay que reescribirlo.

## Multimedia: sólo SVG, a propósito

El HTML permitido en lecciones no incluye `<img>`, `<iframe>` ni video. Lo único
raster es el banner del landing (Unsplash). Decisión tomada el 2026-08-02:
**no ampliar el HTML permitido**, y en cambio hacer que los diagramas salgan bien.

`validateSvgDiagram` en
[lesson-content.ts](../apps/api/src/services/agent/lesson-content.ts) detecta lo
que el prompt pide pero nadie verificaba: `font-size` por debajo de 12, y etiquetas
apiladas en la misma columna que se van a superponer.

Es **advertencia, no reparación**. La geometría sí se repara sola
(`repairSvgGeometry`); el layout no, porque mover una etiqueta requiere saber qué
dice el diagrama. Las advertencias vuelven en el resultado de la herramienta y el
modelo corrige su propio trabajo.

## Pensamiento extendido (thinking)

Activado el 2026-08-02, **por fase** y controlado por env:

| Fase | Variable | Default | Por qué |
|---|---|---|---|
| plan | `AGENT_THINKING_BUDGET_PLAN` | 4096 | Puro criterio, pocos pasos |
| build | `AGENT_THINKING_BUDGET_BUILD` | 2048 | Ejecuta un plan ya acordado, hasta 40 pasos |

Poner cualquiera en `0` lo apaga sin deploy.

Dos cosas que hubo que atar:

- **La poda tuvo que cambiar.** `pruneMessages` conserva el `reasoning` por defecto
  (`reasoning: 'none'`), así que una ronda de 40 pasos terminaría arrastrando 40
  bloques de pensamiento y anulando la dieta de contexto. Ahora usa
  `reasoning: 'before-last-message'`, que además es lo que el protocolo de
  tool-use de Anthropic exige: el pensamiento que precede al `tool_use` que se
  está continuando tiene que sobrevivir.
- **`maxOutputTokens` (16384) tiene que ser mayor que el presupuesto**, porque el
  pensamiento se factura como salida y sale del mismo techo.

### Lo que NO es thinking

Antes de esto, lo que el profesor veía como "los pensamientos del modelo" era otra
cosa: **texto plano entre llamadas a herramientas** ("Now let me verify the final
state of the course…"), a veces en inglés en medio de una conversación en español.
Verificado contra el historial: 147 partes `text` y **cero** `reasoning`.

La UI ahora las pliega bajo "Razonamiento (N pasos)". El criterio es **posicional,
no de palabras clave**: lo escrito antes de la última llamada a herramienta es
narración; lo de después es la respuesta. Las herramientas que dibujan su propia
tarjeta (plan, formularios) quedan excluidas de ese límite, si no un "Armé este
plan para tu curso:" se ocultaría arriba de su propia tarjeta.

## Gotchas para la próxima vez

- **`interface` no satisface un index signature.** Las columnas `jsonb` de Drizzle
  están tipadas `Record<string, unknown>`, y sólo un *type alias* es asignable a
  eso. Un `interface` falla la compilación con un error de sobrecarga ilegible.
- **Vitest no seguía el patrón `./queries/*`** del exports map de `@cio/db`.
  Cualquier suite que importara `@cio/db/queries/...` transitivamente no llegaba a
  colectar; `ai-credits-usage.test.ts` estaba roja sólo por eso. Arreglado con un
  alias a `packages/db/dist` en `vitest.config.ts`.
- **`getLesson` y `getExercise` lanzan** si no encuentran, no devuelven `null`.
- **Al agregar campos a un `create_*`, hacerlos opcionales y sin restricciones.**
  MiniMax ya falló cinco veces seguidas contra un `z.discriminatedUnion`; una clave
  desconocida debe degradar a un create normal, nunca a un error de entrada.
- **Rebuildear los paquetes** (`@cio/db`, `@cio/ai-assistant`, `@cio/utils`) antes
  de typecheckear la API: importa desde `dist`, no desde las fuentes.

## Pendiente de verificar en producción

Nada de esto se probó todavía contra un curso real. La prueba que importa:

1. Subir un PDF **y** una URL, pedir un curso, aceptar el plan.
2. Verificar en la base que secciones y lecciones coinciden **1:1** con el plan
   (cero duplicados).
3. Que el checklist llega a 100% **sin apretar Continuar**.
4. Que el log `[agent.chat] source pack: N source(s), ~T tokens` muestra todas las
   fuentes, y que `cacheReadTokens > 0` en la segunda ronda — si sale 0, la
   separación estable/volátil no está funcionando.
5. Contra-prueba: con el curso a medio construir, pedir una sección extra y
   confirmar que la agrega **sin recrear nada**.
6. Con thinking activado: que el log diga
   `[agent.chat] extended thinking enabled phase=… budget=…`, que aparezcan
   `reasoning_tokens` no nulos en `ai_token_usage`, y —lo importante— que
   `cache_read_tokens` **no se derrumbe**. Anthropic invalida el prefijo cacheado
   cuando cambia el presupuesto de pensamiento; como lo fijamos por fase debería
   coincidir con el corte plan→build que ya existía, pero hay que confirmarlo.
   Si los tool calls se vuelven poco confiables, `AGENT_THINKING_BUDGET_BUILD=0`
   revierte sólo la fase de construcción.
