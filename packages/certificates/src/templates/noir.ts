import {
  BRAND_BAND_STYLES,
  BRAND_STYLES,
  renderSignatureImage,
  escapeHtml,
  getYear,
  placeBrands,
  renderBrands,
  shadeColor,
  type TemplateRenderer
} from './shared';
import { resolveLabels } from '../constants';

export const renderNoir: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const accentDeep = shadeColor(accent, -30);
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });
  const slots = placeBrands(brands, design, 'top');

  const body = `
    <div class="cert t-noir">
      <div class="top">
        <span>${escapeHtml(data.certificateId)}</span>
        <div class="line"></div>
        <span>${slots.top}</span>
        <div class="line"></div>
        <span>${escapeHtml(data.date)}</span>
      </div>
      <div class="main">
        <div class="crest">&#10022; &#10022; &#10022;</div>
        <div class="title">${escapeHtml(data.courseName)}</div>
        <div class="title-line">
          <div class="l"></div>
          <span>${escapeHtml(subtitle)}</span>
          <div class="l"></div>
        </div>
        ${labels.presented ? `<div class="presented">${escapeHtml(labels.presented)}</div>` : ''}
        <div class="recipient">${escapeHtml(data.recipientName)}</div>
        <div class="description">${escapeHtml(description)}</div>
      </div>
      <div class="footer">
        <div class="sig">
          ${renderSignatureImage(signatoryOne, 'dark')}
          <div class="name">${escapeHtml(signatoryOne.name)}</div>
          <div class="label">${escapeHtml(signatoryOne.role)}</div>
        </div>
        <div class="medal">
          <div class="yr">${getYear(data.date)}</div>
          <div class="lbl">&#9733; ${escapeHtml(labels.seal)} &#9733;</div>
        </div>
        <div class="sig">
          ${renderSignatureImage(signatoryTwo, 'dark')}
          <div class="name">${escapeHtml(signatoryTwo.name)}</div>
          <div class="label">${escapeHtml(signatoryTwo.role)}</div>
        </div>
      </div>
      <div class="brand-band">${slots.bottom}</div>
    </div>
  `;

  const styles = `
    ${BRAND_STYLES}
    ${BRAND_BAND_STYLES}
    /* The main block is flex:1, so the header can grow without displacing it. */
    .t-noir .brand-logo { max-height: 68px; }
    /* Con el nombre debajo, el bloque mide casi el doble y la fila de arriba
       empujaba el centro hasta desbordarlo. Medido con measure-layouts. */
    .t-noir .brands.has-names .brand-logo { max-height: 34px; }
    /* El pie de noir ya esta lleno (dos firmas + medalla). La banda de abajo
       le come alto al centro, que esta centrado y se desborda hacia ARRIBA:
       el adorno terminaba sobre la fecha. Tope propio, medido. */
    .t-noir .brand-band .brand-logo { max-height: 24px; }
    .t-noir .brand-band .brands.has-names .brand-logo { max-height: 16px; }
    .t-noir .brand-band .brand-name { font-size: 9px; }
    /*
      The top row is a thin gilt rule with the marks in the middle. Logos are
      light-on-dark here, so the gap has to be wider than elsewhere or the rules
      crowd them.
    */
    .t-noir .top .brands { padding: 0 6px; }
    /* Footer in flow — see the note in classique.ts for the overlap it fixes. */
    .t-noir {
      background: #0e0e0e;
      color: #f5f1e8;
      padding: 55px 80px 70px;
      display: flex;
      flex-direction: column;
      font-family: 'Cormorant Garamond', serif;
      background-image:
        radial-gradient(circle at 30% 20%, ${accent}14, transparent 50%),
        radial-gradient(circle at 70% 80%, ${accent}0c, transparent 50%);
    }
    .t-noir::before {
      content: '';
      position: absolute;
      inset: 30px;
      border: 1px solid ${accent}66;
      pointer-events: none;
    }
    .t-noir::after {
      content: '';
      position: absolute;
      inset: 36px;
      border: 1px solid ${accent}33;
      pointer-events: none;
    }
    .t-noir .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 40px;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      letter-spacing: 0.4em;
      color: ${accent};
      text-transform: uppercase;
    }
    .t-noir .top .line {
      flex: 1;
      height: 1px;
      background: linear-gradient(to right, transparent, ${accent}, transparent);
      margin: 0 20px;
    }
    .t-noir .crest {
      text-align: center;
      margin-top: 10px;
      font-family: 'Cinzel', serif;
      color: ${accent};
      font-size: 32px;
      letter-spacing: 0.3em;
    }
    .t-noir .main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    /*
      Nothing in this column may shrink. A shrunk flex child does not reflow, it
      CUTS through the middle of a line — measured here as the title showing 1.75
      of the 2.17 lines it needed, with the rule below sitting on the remains.
      The line clamps are what bound the height instead, and they cut at a line
      boundary where a cut is legible. Same fix, same reason, as classique.
    */
    .t-noir .main > * { flex-shrink: 0; }
    .t-noir .title {
      text-align: center;
      font-family: 'Playfair Display', serif;
      font-size: clamp(40px, 7.6vw, 84px);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-weight: 400;
      font-style: italic;
      margin: 6px 0 4px;
      color: #f5f1e8;
      line-height: 1;
    }
    .t-noir .title-line {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      margin-bottom: 22px;
    }
    .t-noir .title-line .l {
      width: 80px;
      height: 1px;
      background: ${accent};
    }
    .t-noir .title-line span {
      font-family: 'Cinzel', serif;
      font-size: 13px;
      letter-spacing: 0.5em;
      color: ${accent};
      text-transform: uppercase;
    }
    .t-noir .presented {
      text-align: center;
      font-style: italic;
      font-size: 18px;
      color: #c9b88c;
      margin-bottom: 6px;
    }
    .t-noir .recipient {
      text-align: center;
      font-family: 'Playfair Display', serif;
      font-size: clamp(38px, 6.5vw, 72px);
      font-weight: 400;
      color: ${accent};
      margin: 0 80px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-bottom: 16px;
      border-bottom: 1px solid ${accent}66;
      line-height: 1.05;
    }
    .t-noir .description {
      text-align: center;
      font-style: italic;
      font-size: 19px;
      margin: 16px 110px 0;
      color: #c9b88c;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-noir .footer {
      display: grid;
      flex: none;
      grid-template-columns: 1fr auto 1fr;
      align-items: end;
      gap: 40px;
    }
    .t-noir .sig {
      text-align: center;
      border-top: 1px solid ${accent};
      padding-top: 6px;
    }
    .t-noir .sig .name {
      font-family: 'Playfair Display', serif;
      font-size: 20px;
      font-style: italic;
      color: #f5f1e8;
    }
    .t-noir .sig .label {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      letter-spacing: 0.3em;
      color: ${accent};
      text-transform: uppercase;
      margin-top: 2px;
    }
    .t-noir .medal {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: radial-gradient(circle, ${accent} 0%, ${accentDeep} 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      color: #0e0e0e;
      box-shadow: 0 0 30px ${accent}4d;
      position: relative;
    }
    .t-noir .medal::before {
      content: '';
      position: absolute;
      inset: 6px;
      border: 1px solid #0e0e0e;
      border-radius: 50%;
    }
    .t-noir .medal .yr {
      font-family: 'Cinzel', serif;
      font-size: 20px;
      font-weight: 700;
    }
    .t-noir .medal .lbl {
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 0.2em;
    }
  `;

  return { body, styles };
};
