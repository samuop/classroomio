<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import { sourceCodeUrl, supportEmail } from '$lib/utils/branding';

  /**
   * El texto de la licencia sale del `LICENSE` del propio repositorio, no de una
   * copia pegada acá ni de una descarga a gnu.org.
   *
   * Por el archivo: es el que gobierna este código. Una copia puede quedar
   * desfasada del original y entonces la pantalla mostraría una licencia
   * distinta de la que rige — que es exactamente el error que esta pantalla
   * existe para no cometer.
   *
   * Por `?raw` y no por `fetch`: se incrusta al compilar. Si dependiera de la
   * red, un corte dejaría la pantalla sin el texto justo cuando alguien lo
   * viene a leer.
   */
  import textoDeLaLicencia from '../../../../../../LICENSE?raw';

  const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
  const UPSTREAM_URL = 'https://github.com/rotimi-best/classroomio';

  /**
   * Se muestra sin el `https://`, pero el enlace sigue apuntando a la dirección
   * completa. Es sólo ruido a la vista: nadie necesita leer el esquema para
   * saber a dónde va, y sin él las dos direcciones entran de un vistazo.
   */
  const acortar = (url: string) => url.replace(/^https?:\/\//, '');
</script>

<svelte:head>
  <title>{$t('legal.title')}</title>
</svelte:head>

<Page.Root class="w-full md:max-w-3xl lg:mx-auto">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('legal.title')}</Page.Title>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      <div class="space-y-6 px-1 py-2 text-sm leading-relaxed">
        <section class="space-y-2">
          <h3 class="text-base font-semibold">{$t('legal.license_heading')}</h3>
          <p class="ui:text-muted-foreground">
            {$t('legal.license_body')}
            <a href={AGPL_URL} target="_blank" rel="noopener" class="ui:text-primary underline underline-offset-2">
              GNU AGPL-3.0
            </a>.
          </p>
        </section>

        {#if supportEmail}
          <section class="space-y-2">
            <h3 class="text-base font-semibold">{$t('legal.contact_heading')}</h3>
            <p class="ui:text-muted-foreground">
              <a href={`mailto:${supportEmail}`} class="ui:text-primary underline underline-offset-2">
                {supportEmail}
              </a>
            </p>
          </section>
        {/if}

        <section class="space-y-2">
          <h3 class="text-base font-semibold">{$t('legal.full_text_heading')}</h3>
          <!--
            El texto va en inglés a propósito: la FSF sólo reconoce el original
            como válido, y las traducciones son de referencia. Traducirlo acá
            sería mostrar algo que no es la licencia.
          -->
          <p class="ui:text-muted-foreground">{$t('legal.full_text_note')}</p>
          <!--
            Sin caja ni scroll propio: el texto corre a lo largo de la página,
            como en gnu.org. `whitespace-pre-wrap` conserva los saltos del
            documento original y ajusta las líneas largas en pantallas angostas,
            que es lo que evita que la página se vaya al costado.
          -->
          <pre class="ui:text-muted-foreground font-mono text-xs whitespace-pre-wrap">{textoDeLaLicencia}</pre>
        </section>

        <!--
          Sólo las direcciones, sin párrafo ni etiquetas: el texto completo de la
          licencia está justo arriba y ya dice qué obliga. Las dos se muestran
          enteras para que se distingan por sí solas: la primera es este
          despliegue, la segunda el proyecto del que sale.
        -->
        <section class="space-y-2">
          <!--
            La misma fuente y el mismo tamaño que el texto de la licencia de
            arriba, y sin viñetas: son dos direcciones, no una enumeración, y el
            punto sólo agregaba un adorno que la licencia de arriba no tiene.
          -->
          <ul class="ui:text-muted-foreground list-none space-y-1 font-mono text-xs">
            <li>
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL from env -->
              <a href={sourceCodeUrl} target="_blank" rel="noopener" class="ui:text-muted-foreground no-underline">
                {acortar(sourceCodeUrl)}
              </a>
            </li>
            <li>
              <a href={UPSTREAM_URL} target="_blank" rel="noopener" class="ui:text-muted-foreground no-underline">
                {acortar(UPSTREAM_URL)}
              </a>
            </li>
          </ul>
        </section>
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
