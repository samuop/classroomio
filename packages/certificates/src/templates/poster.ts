import {
  BRAND_BAND_STYLES,
  BRAND_STYLES,
  renderSignatureImage,
  escapeHtml,
  getYear,
  placeBrands,
  renderBrands,
  type TemplateRenderer
} from './shared';
import { resolveLabels } from '../constants';

export const renderPoster: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });
  const [firstTitleWord, ...restTitleWords] = data.courseName.split(' ');
  const titleEmphasis = restTitleWords.join(' ');

  /*
    The pill is a solid accent lozenge built for a few words of text. A logo
    dropped into it lands on a coloured background — the exact thing a
    transparent SVG was uploaded to avoid — so once there is a logo the pill
    goes and the marks stand on the paper.
  */
  const slots = placeBrands(brands, design, 'top');
  // La pastilla envuelve la ranura QUE SE USE, no un lugar fijo: si las marcas
  // bajan al pie, el envoltorio baja con ellas.
  const enPastilla = (html: string) => (!html || brands.hasLogo ? html : `<span class="pill">${html}</span>`);

  const body = `
    <div class="cert t-poster">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
      <div class="content">
        <div class="top">
          ${enPastilla(slots.top)}
          <span>${escapeHtml(data.certificateId)} / ${escapeHtml(data.date)}</span>
        </div>
        <div class="title">${escapeHtml(firstTitleWord || 'Award')} <em>${escapeHtml(titleEmphasis)}</em></div>
        <div class="of">${escapeHtml(subtitle)}</div>
        <div class="recipient-area">
          <div class="lbl">${escapeHtml(labels.awardedTo)}</div>
          <div class="recipient">${escapeHtml(data.recipientName)}</div>
        </div>
        <div class="description">${escapeHtml(description)}</div>
        <div class="bottom">
          <div>
            ${renderSignatureImage(signatoryOne, 'light')}
            <div class="k">${escapeHtml(signatoryOne.role)}</div>
            <div class="v">${escapeHtml(signatoryOne.name)}</div>
          </div>
          <div>
            ${renderSignatureImage(signatoryTwo, 'light')}
            <div class="k">${escapeHtml(signatoryTwo.role)}</div>
            <div class="v">${escapeHtml(signatoryTwo.name)}</div>
          </div>
          <div>
            <div class="k">${escapeHtml(labels.issued)}</div>
            <div class="v">${escapeHtml(data.date)}</div>
          </div>
        </div>
        <div class="brand-band">${enPastilla(slots.bottom)}</div>
      </div>
      <div class="corner-num">${getYear(data.date)}</div>
    </div>
  `;

  const styles = `
    /*
      MEDIDO: con la descripcion en su peor caso, una firma de 42px levantada
      sobre el renglon se le montaba encima 13px. Poster empuja su pie al fondo
      con margin-top:auto y deja que el contenido crezca hasta tocarlo, asi que
      no hay holgura que reservar: lo que se achica es la firma.
    */
    .t-poster .signature { --signature-cap: 22px; --signature-gap: 0px; }
    ${BRAND_STYLES}
    ${BRAND_BAND_STYLES}
    /*
      Capped low. Nothing here is flex:1 — the bottom row is pushed down with
      \`margin-top: auto\` and everything above it is top-packed at its natural
      height, on top of a 140px title. The slack is the smallest of the five
      templates, so the header only gets what it can have without eating it.
    */
    .t-poster .brand-logo { max-height: 52px; }
    .t-poster .top { align-items: center; }
    .t-poster {
      background: #fef2dc;
      color: #1a1a1a;
      padding: 0;
      font-family: 'Space Grotesk', sans-serif;
      overflow: hidden;
    }
    .t-poster .blob {
      position: absolute;
      width: 550px;
      height: 550px;
      border-radius: 50%;
      filter: blur(2px);
      opacity: 0.95;
    }
    .t-poster .blob-1 {
      background: ${accent};
      top: -180px;
      right: -120px;
    }
    .t-poster .blob-2 {
      background: #1e3a8a;
      bottom: -200px;
      left: -150px;
      width: 480px;
      height: 480px;
    }
    .t-poster .blob-3 {
      background: #fbbf24;
      top: 40%;
      left: 55%;
      width: 200px;
      height: 200px;
    }
    .t-poster .content {
      position: relative;
      z-index: 2;
      height: 100%;
      padding: 50px 55px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /*
      Nothing shrinks, and the clamps below decide the height instead. Measured
      in a real browser: a two-line course title pushed the whole signature row
      past the bottom edge of the page, in the plain layout, before any of this
      had a logo in it.
    */
    .t-poster .content > * { flex-shrink: 0; }
    .t-poster .top {
      display: flex;
      justify-content: space-between;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: 30px;
    }
    .t-poster .top .pill {
      background: ${accent};
      color: #fef2dc;
      padding: 5px 12px;
      border-radius: 100px;
    }
    /*
      Two lines maximum, and a line-height that actually contains its glyphs.
      At 0.85 the descenders of a wrapped title hung into the line beneath it,
      which is where the title used to sit on top of the subtitle.
    */
    .t-poster .title {
      font-family: 'Playfair Display', serif;
      font-size: clamp(58px, 10.4vw, 116px);
      font-weight: 900;
      line-height: 0.95;
      letter-spacing: -0.04em;
      color: #1a1a1a;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-poster .title em {
      font-style: italic;
      font-weight: 400;
      color: ${accent};
    }
    .t-poster .of {
      font-family: 'Playfair Display', serif;
      font-size: 46px;
      font-style: italic;
      font-weight: 400;
      line-height: 1.1;
      margin-top: 2px;
      color: #1a1a1a;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-poster .recipient-area {
      margin-top: 24px;
      background: ${accent};
      color: #fef2dc;
      padding: 24px 30px;
      align-self: flex-start;
      max-width: 75%;
      transform: rotate(-1deg);
      box-shadow: 8px 8px 0 #1a1a1a;
    }
    .t-poster .recipient-area .lbl {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.22em;
      color: #fef2dc;
      opacity: 0.8;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .t-poster .recipient {
      font-family: 'Playfair Display', serif;
      font-size: clamp(30px, 4.9vw, 54px);
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.02em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-poster .description {
      font-size: 15px;
      line-height: 1.55;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 16px;
      max-width: 580px;
      color: #1a1a1a;
      font-weight: 500;
    }
    /*
      The right padding is the corner year's territory: it is 80px of Playfair
      pinned to the bottom-right, directly over where the third column used to
      print the issue date.
    */
    .t-poster .bottom {
      margin-top: auto;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      padding-right: 215px;
      gap: 24px;
      border-top: 2px solid #1a1a1a;
      padding-top: 18px;
      font-family: 'JetBrains Mono', monospace;
    }
    .t-poster .bottom .k {
      font-size: 9px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 3px;
    }
    .t-poster .bottom .v {
      font-family: 'Playfair Display', serif;
      font-size: 22px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .t-poster .corner-num {
      position: absolute;
      bottom: 36px;
      right: 50px;
      font-family: 'Playfair Display', serif;
      font-size: 80px;
      font-weight: 900;
      font-style: italic;
      color: ${accent};
      z-index: 3;
      line-height: 0.8;
    }
  `;

  return { body, styles };
};
