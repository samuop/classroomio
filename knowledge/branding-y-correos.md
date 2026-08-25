# Marca propia y layout de correos

## TL;DR

- **No queda ni un rastro visible de ClassroomIO** en el dashboard: se borraron
  los assets del isotipo, el cartel de las pantallas sin sesión, el favicon por
  defecto, la imagen al compartir, la marca de agua de los videos y 162 cadenas
  de los diez idiomas.
- Se conservan **dos cosas a propósito**: la atribución del `/legal` (la AGPL-3.0
  lo exige) y el nombre del paquete `@classroomio/mcp` (es una instrucción
  técnica real, no una marca).
- El layout de los correos es ahora **el mismo que el de SaaS-RRHH**, para que
  los dos productos del ecosistema se lean como uno solo.
- La marca y el acento se cambian por entorno: `PUBLIC_BRAND_NAME`,
  `EMAIL_BRAND_NAME`, `EMAIL_ACCENT_COLOR`, `EMAIL_ACCENT_COLOR_2`.

## Lo que se vio en producción

Al romperse una pantalla, el usuario vio un cartel de ClassroomIO. No era un
resto olvidado: `packages/ui/src/custom/simple-logo-nav/simple-logo-nav.svelte`
pintaba el isotipo, el nombre, el eslogan *"Finally, A Course Platform That's
Beautiful & Easy To Use"* y un link a `classroomio.com`, y lo usa `Empty` con
`showLogo`, que es lo que muestran **`+error.svelte`, la 404, el ingreso, el
reseteo de contraseña, la invitación y la página restringida**.

Dicho de otro modo: la pantalla que más se mira, en el peor momento, era
publicidad del proyecto original con un link que se llevaba al usuario afuera.

## Dónde estaba y qué se hizo

| Dónde | Qué mostraba | Ahora |
| --- | --- | --- |
| `simple-logo-nav.svelte` | isotipo + nombre + eslogan + link externo | el nombre de la marca en texto plano |
| `routes/+layout.svelte` | `/logo-32.png` de favicon por defecto | sin `<link rel="icon">` si la org no tiene el suyo |
| `utils/functions/metaTags.ts` | `/logo-512.png` como imagen al compartir | sin imagen; la tarjeta queda con título y descripción |
| `packages/ui/.../muse-player.svelte` | `logo=app.classroomio.com/logo-512.png` | sin parámetro `logo` |
| `settings/pages/domains.svelte` | isotipo ajeno de vista previa del favicon | vacío |
| `static/manifest.json` | tres íconos de ClassroomIO | sin `icons` |
| 10 archivos de idioma | 162 cadenas con "ClassroomIO" | token `[[brand]]`, que resuelve `brandName` |
| `apps/api` (`invite.ts`, `payment-request.ts`) | `orgName \|\| 'ClassroomIO'` en correos | `EMAIL_BRAND_NAME` |
| `packages/email/utils/constants.ts` | remitente por defecto `notify@mail.classroomio.com` | placeholder inválido a propósito (ver abajo) |
| `static/` | 8 archivos de marca | borrados |

Assets borrados: `logo-16/32/192/512.png`, `logo.svg`, `favicon.ico` y los dos
`classroomio-opengraph-image*.png`. Además
`images/classroomio-course-img-template.jpg` pasó a `course-img-template.jpg`
(la foto es de stock; sólo el nombre delataba el origen).

## Lo que se conserva, y por qué

1. **`legal.attribution_body`.** Este despliegue es un fork AGPL-3.0: decir de
   qué proyecto viene no es branding ajeno, es la licencia. Sacarlo sería
   incumplirla. El link al código fuente vive en el pie del perfil.
2. **`@classroomio/mcp`.** Es el nombre real del paquete npm que se registra en
   Claude Code. Reescribirlo dejaría una instrucción que no funciona.
3. **`apps/website`, `apps/course-app`, `apps/embeds`.** Siguen referenciando los
   logos, pero **no se despliegan** — el workflow sólo compila `api`, `dashboard`
   y `jobs-worker`. Si algún día se publican, hay que repasarlos.
4. **`apps/dashboard/main.js`.** Cascarón de Electron de la era Sapper (apunta a
   `__sapper__/export`, que no existe). No se compila ni se corre; su referencia
   al logo borrado es inerte.

## El remitente por defecto de los correos

`EMAIL_FROM` y `EMAIL_REPLY_TO` caían en `notify@mail.classroomio.com` y
`help@classroomio.com` cuando no había `SMTP_SENDER`: sin configurar, cada correo
salía a nombre de otra empresa y las respuestas caían en su bandeja.

Ahora el fallback es `"<marca>" <no-reply@invalid.local>`, **inválido a
propósito**: no hay ninguna dirección propia que adivinar, y es preferible que el
envío falle de forma ruidosa antes que salir firmado por un tercero. En este
despliegue nunca se usa, porque `SMTP_SENDER` está configurado.

Para que ese "falle ruidoso" tenga quién lo escuche, la API avisa **al arrancar**
si `SMTP_SENDER` no está (`isEmailSenderConfigured`). Sin eso el ruido llegaba
recién al primer rebote, del lado del destinatario.

El default de `EMAIL_BRAND_NAME` es la marca de ESTE despliegue, no la de un
cliente: cada empresa firma con su propio nombre y el valor sólo aparece cuando
no hay ninguno. Poner ahí el nombre de un cliente lo hacía remitente por omisión
de todas las demás, y —en un repositorio público— horneaba un dato de negocio en
el código.

## El layout de correo, compartido con SaaS-RRHH

`packages/email/src/templates/default.ts` es ahora el mismo diseño que
`backend/src/lib/emailTemplate.ts` de SaaS-RRHH: tabla de 600px, barra de acento
arriba con esquinas redondeadas, tarjeta blanca, antetítulo con el nombre de la
organización en versalitas, botón con degradado y pie de una línea.

**Sin bloque `<style>`.** El anterior tenía una docena de clases: Gmail lo
descarta al reenviar un correo y Outlook lo respeta a medias, así que el diseño
dependía del cliente de correo de cada destinatario. Ahora todo va en línea, y el
layout se encarga de vestir el HTML suelto que escribe cada correo
(`inlineContentStyles`): las diecisiete definiciones de `emails/` siguen
escribiendo `<p>` y `<a class="button">` sin estilos y no hubo que tocarlas.

Los diez correos que conocen la organización le pasan el nombre como `sender`,
así el destinatario ve **quién** le escribe antes que la plataforma.

**Diferencia con SaaS-RRHH que queda pendiente:** allá se manda además una
versión en texto plano (`multipart/alternative`, mejora la entregabilidad). Acá
el pipeline de envío sólo acepta HTML; sumarlo implica tocar `send.ts` y los dos
transportes.

## Perillas

| Variable | Default | Qué cambia |
| --- | --- | --- |
| `PUBLIC_BRAND_NAME` | `Tensor Tech` | el nombre en la interfaz (sidebar, pantallas sin sesión, títulos) |
| `EMAIL_BRAND_NAME` | `Tensor Tech` | quién firma los correos cuando la organización no tiene nombre |
| `EMAIL_ACCENT_COLOR` | `#7B35AB` | la barra y el botón de los correos |
| `EMAIL_ACCENT_COLOR_2` | `#49206A` | el segundo color del degradado |

El violeta por defecto es el de EGEA, el mismo de SaaS-RRHH: así los dos
productos se ven de la misma familia sin configurar nada.

## Cómo verificarlo

```bash
pnpm --filter @cio/api exec vitest run src/__tests__/email-template.test.ts
curl -s http://localhost:5173/404 | grep -i classroomio    # sin resultados
```

En dev, lo único que aparece con esa palabra son las URLs `/@fs/` de Vite, que
llevan la ruta del repo en disco (`D:/GitRepo/classroomio/...`) y no existen en
un build de producción.
