# Auditoría — qué queda registrado y cómo consultarlo

## TL;DR

- Dos tablas: **`audit_event`** (qué hizo una persona) y **`audit_incident`**
  (qué salió mal). Ninguna tiene claves foráneas, a propósito.
- **Un solo middleware** en `apps/api/src/middlewares/audit-request.ts`, montado
  una vez sobre `*` en `app.ts`. Ninguna ruta se instrumenta a mano.
- La regla: **todo lo que falla, todo lo que tarda de más y toda escritura se
  registran solos.** Las lecturas son lista blanca, en
  `apps/api/src/utils/audit-map.ts` — el único archivo que hay que tocar para
  sumar acciones.
- El navegador reporta lo que el servidor no puede ver (pantallas rotas,
  requests que nunca llegaron, la espera real) contra `POST /audit/incident`.
- **No hay pantalla.** Se consulta por SQL con la skill `/auditoria`.
- La auditoría **nunca rompe el flujo**: cada camino traga sus propios errores.

## Por qué existe

Un administrador estaba revisando el avance de los alumnos, la pantalla se rompió
y no se pudo volver a reproducir. No quedó rastro en ningún lado: la API había
respondido 200 y quedó tan contenta, el navegador se comió el error, y Sentry
está apagado en esta instalación (`instrument.ts` y `hooks.client.ts` sólo lo
inicializan con `SENTRY_DSN` **y** `PUBLIC_IS_SELFHOSTED !== 'true'`).

La única forma de cubrir eso es no tener que anticipar qué se va a romper.

## Las dos tablas

Definidas en `packages/db/src/schema.ts`, al final del archivo.

| Tabla | Qué guarda |
| --- | --- |
| `audit_event` | Una acción: cualquier escritura, o una lectura declarada en el mapa. Trae `action`, `entity`/`entity_id`, `user_label`, `user_role`, `org_role`, `org_id`, `session_id`, `ip`, `device`, `browser`, `user_agent`, `method`, `route`, `status`, `duration_ms`. |
| `audit_incident` | Algo que salió mal o tardó de más. `kind`: `BACKEND_ERROR`, `FRONTEND_ERROR`, `REQUEST_FAILED`, `SLOW_REQUEST`. `source`: `BACKEND` o `FRONTEND`. Trae `message`, `stack`, `code`, y los mismos datos de identidad y cliente. |

### Por qué no tienen claves foráneas

Una FK con `ON DELETE CASCADE` borraría el registro justo cuando más importa: al
eliminar una organización o dar de baja a un usuario se perdería la historia de
lo que esa persona hizo. Por eso el usuario y la organización se guardan
desnormalizados (`user_label` es un snapshot del email al momento del hecho), y
la fila sobrevive al borrado del registro que la originó. Eso *es* un registro de
auditoría.

El `session_id` es el de Better Auth (tabla `session`), tampoco con FK: esa tabla
se purga al cerrar sesión o al vencer, y el id sirve igual para agrupar todo lo
que hizo una misma sesión.

## Cómo se llenan

### Backend — un solo middleware

`apps/api/src/middlewares/audit-request.ts`, montado en `app.ts` **después** del
middleware de sesión y de `rateLimiter`, sobre `*`.

No registra al entrar sino **después de `await next()`**. Para ese momento ya
corrieron `authMiddleware`, `orgMemberMiddleware` y compañía, así que un único
montaje global sabe quién fue, sobre qué empresa, con qué status salió y cuánto
tardó — sin tocar ninguna ruta.

La escritura va **sin `await`**: la respuesta del usuario ya está armada y nada
de esto puede demorarla.

De dónde sale el detalle de un fallo:

- `c.error` — el error que se escapó hasta `app.onError`.
- `c.get('auditError')` — el que un handler ya atendió con `handleError()`.
  `handleError` lo deja ahí justamente para esto (`apps/api/src/utils/errors.ts`).

El **stack sólo se guarda para 5xx**: en un 403 esperable no aporta y ocupa.

### Frontend — tres enganches

`apps/dashboard/src/lib/utils/services/audit/report-incident.ts` es el
reportador. Se engancha desde tres lados, y cada uno cubre errores que los otros
dos no ven:

| Dónde | Qué atrapa |
| --- | --- |
| `hooks.client.ts` → `installBrowserErrorReporting()` | Código suelto (`window.error`) y promesas rechazadas sin `catch`. |
| `hooks.client.ts` / `hooks.server.ts` → `handleError` | Errores de `load` y de navegación, en el navegador y en SSR. |
| `routes/(app)/+layout.svelte` → `<svelte:boundary>` | Un componente **ya montado** que explota al redibujarse. `handleError` de SvelteKit NO ve esto. |

Además, `ApiClient.makeRequest` (`lib/utils/services/api/index.ts`) mide cada
llamada. Reporta **sólo lo que el servidor no puede ver por su cuenta**:

- `status 0` — el request nunca llegó (sin conexión, DNS, Nginx caído).
- `status 408` — el navegador se cansó de esperar.
- `5xx` — se rompió del otro lado, y saber **en qué pantalla** estaba la persona
  agrega algo que la API no sabe.
- Más de 3s de espera medida desde el navegador, con la red adentro.

Los 4xx **no** se reportan desde el navegador: la API ya los registró con más
contexto y duplicarlos sólo ensucia la tabla.

## Trampas conocidas

**El tope de reportes usa una ventana rodante, y no es un detalle de estilo.**
`report-incident.ts` también corre en el servidor de SvelteKit, que vive semanas:
un contador que sólo sube dejaría de reportar para siempre después de veinte
errores, y ese silencio se confundiría con que no pasa nada. Cada 5 minutos se
empieza de cero.

**La IP no es prueba de nada.** Sale de `cf-connecting-ip` → primera entrada de
`x-forwarded-for` → `x-real-ip` (ver `apps/api/src/utils/client-info.ts`).
Cualquiera que llegue al origen sin pasar por Cloudflare puede inventarlos. Y el
NAT del proveedor hace que personas distintas compartan IP: sirve para saber
desde dónde trabaja la gente, no para armar una teoría de suplantación.

**Una ráfaga de 401 en muchas rutas, en el mismo minuto y desde la misma IP, no
es una intrusión**: es una sesión que se murió y el dashboard disparando todas
sus consultas de golpe.

**Los requests con streaming mienten en `duration_ms`.** El middleware mide hasta
que `next()` resuelve; en `/agent/chat` eso es cuando el stream *arranca*, no
cuando termina.

**El `/proxy` se recorta.** El navegador llama a `${origin}/proxy/organization/…`
pero la fila dice `/organization/…`, igual que la del servidor, así que las dos
se pueden cruzar por `route`.

## Qué NO se registra (y por qué)

Antes de decir "no pasó", hay que chequear si simplemente no se audita:

- **Listados exitosos, cambios de página y refrescos.** Deliberado: taparían lo
  que se busca. Las lecturas son lista blanca (`audit-map.ts`).
- **El cuerpo de los requests.** Nunca. Sin esa regla, un cambio de credenciales
  dejaría la clave escrita en la propia tabla de auditoría. Sólo se guarda lo que
  el mapa declara campo por campo.
- **La misma lectura repetida dentro de 5 minutos.** Hay una ventana
  anti-repetición: abrir el seguimiento tres veces deja un registro. No aplica a
  escrituras, ni a fallos, ni a lentitud.
- **El ingreso.** `/api/auth/*` está excluido: un intento fallido no debe dejar
  rastro que invite a adivinar qué mails existen. El ingreso exitoso ya queda en
  `session` y en `analytics_login_events`.
- **`/session`.** Un 401 ahí es la respuesta normal a "no estoy logueado".
- **Escrituras que fallaron, como evento.** No cambiaron nada: quedan como
  incidencia. Registrarlas como acción diría que ocurrió algo que no ocurrió.
- **Lo anterior a este deploy.** No hay historia hacia atrás.
- **Ubicación geográfica.** La IP se guarda; país y ciudad no se derivan.

## Retención

Una purga diaria borra lo anterior a `AUDIT_RETENTION_DAYS` (365 por defecto).
Vive en el proceso de la API (`apps/api/src/utils/audit-purge.ts`), no en BullMQ:
es una sentencia `DELETE` por día y no necesita cola, reintentos ni Redis
levantado. La API corre en `fork` con una instancia
(`infra/ecosystem.config.cjs`), así que no hay dos procesos compitiendo.

Guardar IPs y actividad de personas identificadas de forma indefinida es difícil
de justificar bajo la Ley 25.326, y una tabla que sólo crece termina haciendo
lentas sus propias consultas.

## Perillas

Van en el `.env` de la API (o en el workflow de deploy). Todas opcionales.

| Variable | Default | Qué hace |
| --- | --- | --- |
| `AUDIT_SLOW_REQUEST_MS` | `2000` | A partir de cuántos ms un request se registra como `SLOW_REQUEST`. |
| `AUDIT_RETENTION_DAYS` | `365` | Días que se conserva el registro. |
| `AUDIT_PURGE_DISABLED` | — | `1` apaga la purga diaria. |

## Cómo llegan las tablas a producción

**No hace falta escribir una migración.** El deploy corre
`pnpm --filter @cio/db db:setup` (ver `infra/deploy-remote.sh`), que termina en
`drizzle-kit push`: diffea `schema.ts` contra la base viva y aplica la
diferencia. Crear dos tablas es aditivo, así que push lo hace sin pedir
confirmación — verificado corriéndolo contra el Postgres local, que las creó con
sus 20 columnas, sus índices y **cero claves foráneas**.

⚠️ **La carpeta `packages/db/src/migrations/` es un artefacto muerto.** No la use
nadie: la base no tiene tabla `__drizzle_migrations`, ningún script corre
`drizzle-kit migrate`, y `drizzle-kit generate` ni siquiera termina — pide
resolver conflictos de columnas a mano porque su snapshot quedó desfasado del
schema hace rato. El mecanismo real es push, y sólo push.

## La suite de tests

137 tests. Los unitarios corren sin nada levantado; los de integración necesitan
Postgres y quedan afuera de la corrida normal, para que `pnpm test` pase en una
máquina sin Docker.

```bash
pnpm --filter @cio/api test                      # 719 (incluye 92 de auditoría)
pnpm --filter @cio/api test:db                   # 22 contra Postgres
pnpm --filter @cio/dashboard exec jest src/lib/utils/services/audit   # 23
```

| Archivo | Qué fija |
| --- | --- |
| `apps/api/src/__tests__/audit-map.test.ts` | El matcher segmento a segmento, la lista blanca, las exclusiones, y que `metadata` no deje salir el querystring entero. Incluye chequeos de consistencia del propio mapa. |
| `apps/api/src/__tests__/audit-client-info.test.ts` | La cascada de IP para ESTE despliegue y el parseo de User-Agent (Edge no es Chrome, Chrome no es Safari). |
| `apps/api/src/__tests__/audit-service.test.ts` | El saneo de uuid, los recortes, la ventana anti-repetición, y que **nunca tire**. |
| `apps/api/src/__tests__/audit-middleware.test.ts` | La regla de decisión completa contra una app Hono real, que lee al usuario después de `next()`, y que un fallo del registro no toque la respuesta. |
| `apps/api/src/__tests__/audit-incident-route.test.ts` | 204 siempre, y que el navegador no pueda fabricar un `BACKEND_ERROR`. |
| `apps/api/src/__tests__/audit-purge.test.ts` | Que no arranque dos veces, que se apague por variable de entorno, y que un rechazo no tumbe el proceso. |
| `apps/dashboard/.../audit/__tests__/report-incident.test.ts` | El dedupe, la ventana rodante, que no se reporte a sí mismo, y la regla de qué fallo vale la pena reportar. |
| `apps/api/src/__tests__/audit-queries.int.test.ts` | **Contra Postgres.** El `IS NULL` de la ventana anti-repetición, que no haya FKs, que un uuid inválido devuelva `false`, y el borrado por fecha. |
| `apps/api/src/__tests__/audit-end-to-end.int.test.ts` | **Contra Postgres.** De un request HTTP a la fila, sin un solo mock: middleware real, servicio real, base real. |

### Cómo correr los de integración

```bash
docker compose -f docker/docker-compose.yaml up -d postgres
pnpm --filter @cio/db db:setup        # drizzle-kit push
pnpm --filter @cio/api test:db
```

El `DATABASE_URL` sale de `apps/api/.env`, que `@cio/db` carga solo con dotenv.
Los tests limpian lo suyo con una marca por corrida (`int-<id>@test.local`) en
vez de vaciar las tablas: la base de desarrollo es compartida. El test de purga
usa fechas de 1999 justamente para que el corte no pueda alcanzar datos reales.

### Lo que la suite NO cubre

- **El `<svelte:boundary>`** del layout autenticado. El proyecto no tiene
  `jest-environment-jsdom`, así que no hay dónde montar el componente.
- **La instrumentación dentro de `ApiClient`** (que la llamada se mida y se
  reporte). La *decisión* sí está probada, extraída como
  `shouldReportFailedRequest`; lo que falta es el cableado.
- **El dashboard corriendo de verdad.** El reportador está probado con un `fetch`
  falso; que el navegador llegue al endpoint por `/proxy` se ve en el deploy.

### Verificado contra los servidores en dev (2026-08-25)

Con la API en 3002 y el dashboard en 5173, contra el Postgres de Docker:

| Qué se probó | Resultado |
| --- | --- |
| `POST /audit/incident` con User-Agent e IP | fila `FRONTEND_ERROR` con `Windows/Chrome`, la IP pública real (acá va `203.0.113.10`, ver abajo) y `metadata.screen` |
| `GET /organization` sin sesión | fila `REQUEST_FAILED` con `401`, método, ruta y `duration_ms` |

**Nunca pegar una IP real acá ni en los tests.** Este repositorio es público, y
verificar contra un servidor deja a mano la dirección de quien probó. Los
ejemplos usan `203.0.113.0/24` (TEST-NET-3, RFC 5737), un rango reservado para
documentación que no le pertenece a nadie. Lo mismo vale para nombres de
empresas clientes en fixtures: se leen como datos de negocio.

**El `tsc` del dashboard NO atrapa nombres indefinidos en este archivo.**
Comprobado a propósito: reintroduciendo un `export { x } from './y'` que deja a
`x` fuera del ámbito del módulo —lo que rompía TODA página SSR con 500—
`tsc --noEmit -p tsconfig.json` reporta **cero** errores. Los cuatro `TS5062`
del tsconfig heredado (patrones de path con dos `*`) están ahí desde antes. La
conclusión práctica: en el dashboard, "compila" no prueba nada; hay que levantar
el servidor y pedir una página.

### Tres cosas que encontró la suite al escribirla

Vale anotarlas porque son el argumento de por qué existe:

1. `stopAuditPurge()` frenaba el intervalo pero **no cancelaba la primera purga
   pendiente**: después de "frenar", todavía podía dispararse una hasta cinco
   minutos después, y un stop → start dejaba dos encoladas.
2. El `.then()` de la purga **no tenía `.catch()`**: dependía de que
   `purgeAudit` tragara sus errores para siempre. Si alguna vez dejara de
   hacerlo, el rechazo salía por el callback de un `setInterval`, donde no lo
   atrapa nadie.
3. Con la primera entrada de `x-forwarded-for` vacía, la cascada baja a
   `x-real-ip` en vez de tomar la segunda entrada. Es lo correcto —tomarla
   devolvería la IP de Cloudflare presentándola como la de la persona— pero no
   era evidente y ahora está escrito.

Y contra la base real quedó confirmado lo que ningún mock podía decir: el
`IS NULL` de la ventana anti-repetición funciona, el jsonb vuelve como objeto,
un evento de una empresa inexistente entra igual (la decisión de no poner FKs), y
un uuid inválido devuelve `false` en vez de tirar.

## Cómo consultarlo

No hay pantalla: fue una decisión explícita. Se consulta por SQL contra
producción con la skill **`/auditoria`**, que tiene el catálogo de consultas y la
regla de la hora argentina.
