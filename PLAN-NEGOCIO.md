# Plan de negocio — Revender ClassroomIO a una consultora de RRHH

> Documento de análisis. Basado en inspección del código del repo (mayo 2026).
> No es asesoramiento legal — para la parte de licencia, confirmá con un abogado.

---

## 1. El modelo que vas a usar

**Cliente:** una consultora de RRHH que capacita empleados de varias empresas.

**Mapeo elegido en ClassroomIO:**

```
Organización  =  "Consultora RRHH"   (una sola, con la marca de la consultora)
  │
  ├─ Program "Empresa Acme"     ← cada empresa cliente = un PROGRAM
  │    ├─ cursos asignados (comunes + a medida)
  │    └─ empleados (program members)
  │
  ├─ Program "Empresa Beta"
  └─ Program "Empresa Gamma"

Catálogo de cursos (a nivel org) → un curso puede ir a varios programs
```

**Por qué Program y no Group ni Organización separada:**
- `Program` agrupa **varios cursos + varios miembros + foro + objetivos** → es el equivalente natural a "una empresa con su material y su gente".
- `Group` en ClassroomIO es más bien la cohorte de UN curso, no una empresa.
- Organizaciones separadas darían aislamiento total pero la consultora perdería el panel único y no querés marca/dominio por empresa.

✅ **Verificado en vivo:** creamos "Empresa Acme" como Program, le asignamos un curso e invitamos un empleado. Backend respondió 201 (OK).

### Limitación a tener en cuenta
Todo vive en una sola organización → **no hay aislamiento fuerte entre empresas**: un admin de la consultora ve a todas. Para tu caso (el cliente es la consultora) está bien. Si en el futuro una empresa exige que sus datos estén aislados de las otras, habría que repensar a "una org por empresa".

---

## 2. ⚠️ LICENCIA — lo más importante antes de vender

**El README dice "MIT" pero el archivo LICENSE real del repo es AGPL v3 (GNU Affero General Public License).** Son cosas muy distintas.

Qué implica AGPL v3 para tu negocio:
- ✅ Podés usarlo, modificarlo y **cobrar** por hospedarlo/dar servicio.
- ⚠️ **PERO:** si ofrecés el sistema por red (SaaS), estás obligado a **publicar tu código fuente** (incluidas tus modificaciones) a los usuarios. Es el "candado" anti-SaaS-cerrado de la AGPL.
- ⚠️ No podés tomar el código, cerrarlo y venderlo como producto propietario sin liberar tus cambios.

**Acción recomendada:** ClassroomIO ofrece una **licencia comercial** (el plan Enterprise menciona *"Need on-prem deployment, SSO, or a commercial license? Contact us"* → cal.com/classroomio/enterprise). Si tu modelo de negocio choca con la AGPL, **conviene hablar con ellos por una licencia comercial** antes de vender. Consultá con un abogado.

---

## 2b. AGPL en profundidad — qué podés y qué no (verificado online, mayo 2026)

Fuentes: repo classroomio (LICENSE = AGPL-3.0), FOSSA AGPL guide, guías de cumplimiento AGPL/SaaS.

**Lo que te PERMITE (✅):**
- Hospedar y COBRAR por el servicio. "AGPL impone cero condiciones sobre usar el código en software vendido comercialmente."
- Modificar el código.
- Branding por organización (logo/colores/landing de cada empresa) = uso normal.

**Lo que te OBLIGA (⚠️):**
1. Publicar tu código MODIFICADO — pero solo a TUS USUARIOS, no al mundo. Un fork público (ya tenés samuop/classroomio público) cumple esto. NO es "publicar a todos", es "accesible a quien usa el servicio".
2. Mantener la licencia AGPL + el copyright original de ClassroomIO. Esto restringe el white-label TOTAL (borrar toda atribución).

**Cuándo SÍ necesitás licencia comercial (= costo a trasladar al cliente):**
- Querés cerrar tu código (no mostrarlo a tus usuarios).
- White-label total (sin rastro de ClassroomIO).
- Features Enterprise: SSO / token-auth / no-tracking (LICENSE_KEY).

**Para el caso del usuario (fork público + deja "Powered by" + cobra por servicio): NO necesita licencia comercial. Cumple AGPL tal cual.** Contacto comercial si hiciera falta: cal.com/classroomio/enterprise (sin precios públicos).

**Riesgo de incumplir:** reclamo legal de los autores, pérdida del derecho de uso. AGPL es muy estricta (Google prohíbe AGPL internamente). NO es asesoramiento legal — confirmar con abogado antes de escalar.

## 3. Qué es gratis vs qué requiere licencia paga (en self-hosting)

Verificado en `apps/api/src/middlewares/license.ts` + `packages/utils/src/license/constants.ts`:

**Solo 3 features requieren `LICENSE_KEY` en self-hosted** (devuelven 403 sin licencia):
| Feature | Para qué sirve |
|---------|----------------|
| `SSO` | Login único corporativo (SAML, etc.) |
| `token-auth` | Autenticación por token |
| `no-tracking` | Desactivar el tracking/telemetría |

**TODO lo demás es libre en self-hosting** (no chequea licencia): cursos ilimitados, programs, alumnos, compliance, certificados, foro, analytics, IA, etc. El código tiene "planes" (Free / Early Adopters / Enterprise) pero **esos límites aplican a la versión SaaS de classroomio.com**, no cuando lo hospedás vos (`requireLicense` se saltea si `PUBLIC_IS_SELFHOSTED` no es la nube oficial).

➡️ Para tu caso (consultora RRHH) **probablemente no necesites licencia técnica**, salvo que tus empresas exijan SSO corporativo.

---

## 4. Qué necesitás para producción (vs lo que tenés en local)

| Componente | En local (ahora) | En producción (para vender) |
|------------|------------------|------------------------------|
| Servidor | tu PC | VPS/cloud que corra 24/7 (ej. Render, Hetzner, DigitalOcean) |
| Postgres + Redis | Docker en tu PC | Servicio gestionado (Render/Neon/Railway) o contenedores en el server |
| API + Dashboard | node local | mismo, detrás de un dominio con HTTPS |
| Almacenamiento (imágenes/videos) | ❌ no configurado (por eso falló la foto de perfil) | **MinIO** (self-host) o **Cloudflare R2** — obligatorio para subir archivos |
| Dominio | localhost | dominio tuyo + DNS |
| Multi-dominio/subdominios | no aplica | `tenant-router` (Cloudflare Worker) o un proxy nginx, solo si das dominios por org |
| Emails (invitaciones, reset) | ❌ no enviados (sin SMTP) | servidor SMTP o Zoho ZeptoMail |
| RAM | justa (~10GB, va lento) | el server debe tener holgura; el build necesita ≥4GB de heap |

---

## 5. Bugs/cosas detectadas que vas a tener que mantener

Como proveedor, sos responsable de la calidad. Encontramos:
1. **`window` en SSR** (`visit-org-site-btn.svelte`): rompe (500) al abrir una org con dominio propio. Ver [[bug-visit-org-site-btn-ssr]].
2. **CSP vs dev server**: el modo dev se cuelga por la CSP; lo resolvimos para local. En producción no aparece.
3. **README desactualizado**: dice MIT pero la licencia es AGPL; dice que hay `db-init` en el compose y no existe.

Moraleja: el proyecto es potente pero **vas a invertir tiempo en mantenerlo y arreglar bugs** para tus clientes.

---

## 5b. Marca / White-label

**Decisión del usuario:** dejar el "Powered by ClassroomIO" (no le molesta). Esto evita tocar código y cualquier roce con la AGPL.

Lo que SÍ se personaliza sin problema:
- **Por organización (UI):** logo, colores/tema, landing page. → es lo que ven los empleados de cada empresa.
- **App-wide (env vars):** `PUBLIC_APP_TITLE`, `PUBLIC_APP_DESCRIPTION`, `PUBLIC_OG_IMAGE_URL`.

Detalles técnicos del branding (verificado en `apps/dashboard/src/lib/features/ui/powered-by.svelte`):
- El chip flotante "Powered by ClassroomIO" aparece SOLO en `$isFreePlan` (planes pagos no lo muestran).
- La atribución del sidebar (`variant='sidebar'`) aparece siempre.
- Quitarlo del todo = editar el componente (~70 líneas) → posible técnicamente pero entra en tema licencia comercial AGPL; el usuario eligió NO hacerlo.

## 5c. Cambios de código pendientes de compilar (build + en algunos casos db push)

Editados en el working tree, NO aplicados al build que corre. Recompilar el dashboard al final para verlos todos juntos.

- [ ] **Español por defecto** (translations.ts, +layout.ts, store/user.ts, schema.ts profile). El de schema YA está en la DB (reset). Falta build para el dashboard.
- [ ] **Logo sin "Free" ni link** (app-logo.svelte).
- [ ] **Sitio público deshabilitado** (+page.server.ts): la raíz redirige a /home (logueado) o /login. Ya no muestra landing pública.
- [x] Bloquear catálogo `/courses` del org-site → redirige a login/home ((org-site)/courses/+page.server.ts).
- [x] Sacar Google y link de registro del login (auth-ui.svelte: const DISABLE_GOOGLE_AUTH=true, SHOW_SIGNUP_LINK=false).
- [x] Traducir textos hardcodeados del login ("Sign in to continue" → login.sign_in_to_continue; "Or continue With" → login.or_continue_with). Agregadas a es.json/en.json.
- [x] /home ya no muestra landing al usuario logueado: shouldRedirectOnAuth.ts ahora incluye '/home' → admin va a /org/{slug}, student al LMS.
- [x] Botón "Ver sitio / Academia Abierta" (visit-org-site-btn.svelte) oculto en todos lados con {#if false}. Bonus: elimina el bug SSR window-is-not-defined [[bug-visit-org-site-btn-ssr]].
- [x] Logo "ClassroomIO" del sidebar → texto plano (sin link, sin badge Free, sin apariencia de botón) en app-logo.svelte.
- [x] Página de error (+error.svelte) traducida al español + sacado botón "Try Free Tools".
- [x] Fix crash "Cannot use resolve() with non-absolute path #/settings/landingpage/edit": guard en landingpage.svelte cuando $currentOrgPath no empieza con '/'.
- [x] Ocultos del menú Configuración (org-navigation.ts): Landing Page, Billing, Domains, SSO, Token Auth. Quedan: Perfil, Organización, AI Credits, AI Tutor, Customize LMS, Teams, Auth.
- [x] BLOQUEO REAL por URL (no solo menú) de esas rutas: +layout.server.ts con redirect(307) en settings/{landingpage,billing,domains,auth/sso,auth/token-auth}. /settings/auth se mantiene accesible. (El layout.server cubre subrutas, ej. landingpage/edit.)

**Base ya reseteada:** 1 admin (samuelocta215@gmail.com, org "Tensor Tech", slug tensor-tech, locale es). Backup pre-reset en C:/Users/samu/classroomio-backup-pre-reset.sql. Script reutilizable: packages/db/src/scripts/create-admin.ts.

## 5d. Configuración de consumo de IA (cómo controlar costos)

Sistema de presupuesto de TOKENS por organización (apps/api/src/services/agent/usage.ts).

**Allowance mensual por plan** (default si la org no tiene aiTokenAllowance custom):
- BASIC 500.000, EARLY_ADOPTER 3.000.000, ENTERPRISE 15.000.000 tokens/mes.
- Al agotarse → agente devuelve TOKEN_LIMIT_REACHED (402).

**Multiplicador de costo por modelo** (clave para el gasto):
- Gemini 3.1 Flash Lite = 1x (default, el más barato) ← usar este
- Gemini 2.5 Flash / Claude Haiku = 1.5x
- GPT-5.4 Mini / Kimi = 4x
- Claude Sonnet 4.6 = 11x (el más caro)

**Allowance CUSTOM por org**: campo `aiTokenAllowance` en organization_plan.payload (jsonb). Permite dar a cada empresa cliente su propio presupuesto y cobrarlo. Ej. seteado para Tensor Tech = 1.000.000.

**Topes globales del agente** (apps/api/.env): AGENT_MAX_FETCHES_PER_CONVERSATION=10, AGENT_MAX_FETCHES_PER_ORG_PER_DAY=200.

**IMPORTANTE para costos:** la API key (GOOGLE_API_KEY etc.) la paga el operador (vos) al proveedor por uso real. El allowance interno de ClassroomIO es el límite que protege tu factura — cuando una org se queda sin allowance, el agente se corta. Self-hosted NO saltea esto: el presupuesto aplica igual y es tu herramienta de control de costos.

**Estado actual:** IA DESACTIVADA (keys vacías en .env). Límites pre-configurados para arrancar protegido cuando se active.

**Botón "Comprar credits" QUITADO** (ai-credits.svelte): usaba el Polar checkout de ClassroomIO (no configurado, daba error, precios ajenos). Se mantienen las estadísticas de uso (UsageSummaryCards, UsageChart, TeamLeaderboard) para monitorear consumo. El presupuesto se gestiona por aiTokenAllowance, no por compra de packs. El operador sube/baja allowance y cobra a la consultora por afuera.

**Herramienta del operador para asignar límite de IA por org** (ClassroomIO NO trae UI para esto): script `packages/db/src/scripts/set-allowance.ts`.
- `pnpm --filter @cio/db set-allowance --list` → ver todas las orgs y su allowance.
- `pnpm --filter @cio/db set-allowance --org <slug> --tokens <N>` → fijar límite (0 = cortar IA).
- Crea/actualiza organization_plan.payload.aiTokenAllowance. Efecto inmediato, sin reiniciar.
- Pendiente (acordado): página de operador VISUAL para hacer esto desde el dashboard (solo dueño). Por ahora se usa el script.
- También existe `pnpm --filter @cio/db create-admin` para crear admins/orgs.

## 6. Próximos pasos sugeridos (en orden)

1. **Decisión de licencia** — confirmar si tu modelo entra en AGPL o necesitás licencia comercial (hablar con classroomio + abogado).
2. **Validar el flujo completo en local** — crear 2-3 programs (empresas), cursos comunes y a medida, invitar empleados, y entrar como empleado para ver su experiencia.
3. **Levantar MinIO en local** — para probar subida de imágenes/videos/certificados (la foto de perfil falló por esto).
4. **Probar SMTP** — configurar un SMTP de prueba para que las invitaciones lleguen de verdad.
5. **Definir infraestructura de producción** — elegir dónde hospedar y armar el despliegue.
6. **Piloto con la consultora** — una empresa real, pocos empleados, medir.
