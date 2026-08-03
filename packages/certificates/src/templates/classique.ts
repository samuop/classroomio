import { BRAND_STYLES, escapeHtml, getYear, renderBrands, type TemplateRenderer } from './shared';
import { resolveLabels } from '../constants';

export const renderClassique: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });

  const body = `
    <div class="cert t-classique">
      <div class="corner tl"></div>
      <div class="corner tr"></div>
      <div class="corner bl"></div>
      <div class="corner br"></div>
      <div class="main">
        <div class="top-tag">${brands.html}</div>
        <div class="ornament">&#10086;</div>
        <div class="title">${escapeHtml(data.courseName)}</div>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
        ${labels.presented ? `<div class="presented">&mdash; ${escapeHtml(labels.presented)} &mdash;</div>` : ''}
        <div class="recipient">${escapeHtml(data.recipientName)}</div>
        <div class="description">${escapeHtml(description)}</div>
      </div>
      <div class="footer">
        <div class="sig">
          <div class="name">${escapeHtml(signatoryOne.name)}</div>
          <div class="label">${escapeHtml(signatoryOne.role)}</div>
        </div>
        <div class="seal">
          <div class="star">&#9733;</div>
          <div class="yr">${getYear(data.date)}</div>
          <div class="lbl">${escapeHtml(data.certificateId)}</div>
        </div>
        <div class="sig">
          <div class="name">${escapeHtml(signatoryTwo.name)}</div>
          <div class="label">${escapeHtml(signatoryTwo.role)}</div>
        </div>
      </div>
    </div>
  `;

  const styles = `
    ${BRAND_STYLES}
    /*
      Roomy: the marks sit inside the main block, which is flex:1 and centred,
      so a taller header takes space from the padding around the title rather
      than pushing anything off the canvas.
    */
    .t-classique .brand-logo { max-height: 52px; }
    .t-classique .brands { margin-bottom: 6px; }
    /*
      Flex column with the footer in normal flow. It used to be positioned
      absolutely 90px from the bottom while the text above it flowed from the
      top, so a course title long enough to wrap onto a second line pushed the
      description down until it ran under the seal. Nothing reserved the space.
      Now the two are siblings and cannot overlap at any content length.
    */
    .t-classique {
      background: #faf6ec;
      color: #2a1810;
      padding: 55px 55px 70px;
      font-family: 'Cormorant Garamond', serif;
      display: flex;
      flex-direction: column;
    }
    .t-classique .main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding-top: 34px;
    }
    .t-classique::before {
      content: '';
      position: absolute;
      inset: 30px;
      border: 2px double ${accent};
      pointer-events: none;
    }
    .t-classique::after {
      content: '';
      position: absolute;
      inset: 42px;
      border: 1px solid ${accent};
      pointer-events: none;
    }
    .t-classique .corner {
      position: absolute;
      width: 80px;
      height: 80px;
      border: 1px solid ${accent};
      pointer-events: none;
    }
    .t-classique .corner.tl { top: 55px; left: 55px; border-right: none; border-bottom: none; }
    .t-classique .corner.tr { top: 55px; right: 55px; border-left: none; border-bottom: none; }
    .t-classique .corner.bl { bottom: 55px; left: 55px; border-right: none; border-top: none; }
    .t-classique .corner.br { bottom: 55px; right: 55px; border-left: none; border-top: none; }
    .t-classique .ornament {
      font-family: 'Cinzel', serif;
      text-align: center;
      font-size: 24px;
      color: ${accent};
      margin: 8px 0;
      letter-spacing: 0.5em;
    }
    .t-classique .top-tag {
      text-align: center;
      font-family: 'Cinzel', serif;
      font-size: 13px;
      letter-spacing: 0.6em;
      color: ${accent};
      text-transform: uppercase;
    }
    /*
      Fluid size with a floor and a ceiling: a short title still reads as the
      hero, and a long one shrinks instead of pushing everything below it off the
      fixed 780px canvas. Capped at three lines — past that the certificate is
      no longer a certificate.
    */
    .t-classique .title {
      text-align: center;
      font-family: 'Bodoni Moda', serif;
      font-size: clamp(38px, 7.2vw, 78px);
      font-weight: 400;
      font-style: italic;
      margin: 8px 0 4px;
      color: #2a1810;
      line-height: 1.06;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-classique .subtitle {
      text-align: center;
      font-family: 'Cinzel', serif;
      font-size: 14px;
      letter-spacing: 0.45em;
      color: ${accent};
      margin-bottom: 36px;
      text-transform: uppercase;
    }
    .t-classique .presented {
      text-align: center;
      font-style: italic;
      font-size: 18px;
      color: #5a3a25;
      margin-bottom: 8px;
    }
    .t-classique .recipient {
      text-align: center;
      font-family: 'Bodoni Moda', serif;
      font-size: clamp(36px, 5.8vw, 64px);
      font-weight: 400;
      margin: 6px 120px 12px;
      border-bottom: 2px solid ${accent};
      padding-bottom: 14px;
      line-height: 1.05;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Four lines, then ellipsis: the description is a caption here, not the body. */
    .t-classique .description {
      text-align: center;
      font-size: 18px;
      font-style: italic;
      color: #3a2515;
      margin: 20px 110px 0;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-classique .footer {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: end;
      gap: 40px;
      flex: none;
    }
    .t-classique .sig {
      text-align: center;
      border-top: 1px solid ${accent};
      padding-top: 6px;
    }
    .t-classique .sig .name {
      font-family: 'Bodoni Moda', serif;
      font-size: 20px;
      font-style: italic;
    }
    .t-classique .sig .label {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      letter-spacing: 0.3em;
      color: ${accent};
      text-transform: uppercase;
      margin-top: 2px;
    }
    .t-classique .seal {
      width: 120px;
      height: 120px;
      border: 2px solid ${accent};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      color: ${accent};
      background: radial-gradient(circle, #faf6ec 60%, ${accent}1a);
      position: relative;
    }
    .t-classique .seal::before {
      content: '';
      position: absolute;
      inset: 6px;
      border: 1px dashed ${accent};
      border-radius: 50%;
    }
    .t-classique .seal .star { font-size: 20px; }
    .t-classique .seal .yr {
      font-family: 'Cinzel', serif;
      font-size: 18px;
      font-weight: 600;
      margin-top: 2px;
    }
    .t-classique .seal .lbl {
      font-family: 'Cinzel', serif;
      font-size: 8px;
      letter-spacing: 0.2em;
      margin-top: 2px;
    }
  `;

  return { body, styles };
};
