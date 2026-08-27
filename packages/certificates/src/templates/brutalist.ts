import {
  BRAND_BAND_STYLES,
  BRAND_STYLES,
  renderSignatureImage,
  escapeHtml,
  placeBrands,
  renderBrands,
  type TemplateRenderer
} from './shared';
import { resolveLabels } from '../constants';

export const renderBrutalist: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const idDigits = data.certificateId.match(/\d+/)?.[0] ?? '00';
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });
  const slots = placeBrands(brands, design, 'top');

  const body = `
    <div class="cert t-brutalist">
      <div class="grid-bg"></div>
      <div class="header">
        <div>${slots.top}</div>
        <div class="blk">${escapeHtml(data.certificateId)}</div>
      </div>
      <div class="title-block">
        <div class="num">&#8470;<span>${escapeHtml(idDigits)}</span></div>
      </div>
      <div class="meta-row">
        <div>
          <div class="k">${escapeHtml(labels.issued)}</div>
          <div class="v">${escapeHtml(data.date)}</div>
        </div>
        <div>
          <div class="k">${escapeHtml(labels.award)}</div>
          <div class="v">${escapeHtml(data.courseName)}</div>
        </div>
        <div>
          <div class="k">${escapeHtml(labels.distinction)}</div>
          <div class="v">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="recipient-block">
        <div class="lbl">${escapeHtml(labels.awardedTo)}</div>
        <div class="recipient">${escapeHtml(data.recipientName)}</div>
        <div class="description">${escapeHtml(description)}</div>
      </div>
      ${labels.seal ? `<div class="stamp">${escapeHtml(labels.seal)}</div>` : ''}
      <div class="footer">
        <div>
          ${renderSignatureImage(signatoryOne, 'light')}
          <div class="lbl">${escapeHtml(signatoryOne.role)}</div>
          <div class="name">${escapeHtml(signatoryOne.name)}</div>
        </div>
        <div>
          ${renderSignatureImage(signatoryTwo, 'light')}
          <div class="lbl">${escapeHtml(signatoryTwo.role)}</div>
          <div class="name">${escapeHtml(signatoryTwo.name)}</div>
        </div>
      </div>
      <div class="brand-band">${slots.bottom}</div>
    </div>
  `;

  const styles = `
    ${BRAND_STYLES}
    ${BRAND_BAND_STYLES}
    /*
      Capped, because this is the one layout where a taller header costs
      something: the blocks below it sit in normal flow while the signature bar
      is pinned to the bottom edge, so whatever the header takes comes out of
      the gap in front of that bar.
    */
    .t-brutalist .brand-logo { max-height: 52px; }
    .t-brutalist {
      background: #f0ede4;
      color: #000;
      font-family: 'Archivo Black', sans-serif;
      padding: 0;
    }
    .t-brutalist .grid-bg {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .t-brutalist .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 40px 50px 0;
      position: relative;
      z-index: 2;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .t-brutalist .header .blk {
      background: ${accent};
      color: #fff;
      padding: 6px 10px;
    }
    .t-brutalist .title-block {
      padding: 40px 50px 0;
      position: relative;
      z-index: 2;
    }
    .t-brutalist .num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 120px;
      font-weight: 700;
      line-height: 0.85;
      color: ${accent};
      letter-spacing: -0.04em;
    }
    .t-brutalist .num span { color: #000; }
    .t-brutalist .meta-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      border-top: 4px solid ${accent};
      border-bottom: 2px solid #000;
      margin: 30px 50px 0;
      position: relative;
      z-index: 2;
    }
    .t-brutalist .meta-row > div {
      padding: 14px 18px;
      border-right: 2px solid #000;
      font-family: 'JetBrains Mono', monospace;
    }
    .t-brutalist .meta-row > div:last-child { border-right: none; }
    .t-brutalist .meta-row .k {
      font-size: 9px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 4px;
    }
    .t-brutalist .meta-row .v {
      font-size: 18px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    /*
      The right padding is the stamp's territory. The stamp is pinned to the
      middle of the right edge, and the name beside it is 88px type across the
      full width, so the two collided on any name longer than about fourteen
      characters — measured, in the plain layout, before any of this had a logo
      in it.
    */
    .t-brutalist .recipient-block {
      padding: 40px 265px 40px 50px;
      position: relative;
      z-index: 2;
    }
    .t-brutalist .recipient-block .lbl {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.22em;
      color: ${accent};
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    /*
      Two lines, and a size that gives way before the block does. Unbounded, a
      long name pushed the description under the signature bar and off the page.
    */
    .t-brutalist .recipient {
      font-size: clamp(42px, 6.6vw, 88px);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 0.95;
      letter-spacing: -0.03em;
      text-transform: uppercase;
      border-left: 6px solid ${accent};
      padding-left: 18px;
      margin-left: -24px;
    }
    .t-brutalist .description {
      font-family: 'JetBrains Mono', monospace;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 14px;
      font-weight: 400;
      line-height: 1.5;
      margin-top: 20px;
      text-transform: none;
      max-width: 780px;
      color: #333;
      letter-spacing: 0.02em;
    }
    .t-brutalist .footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-top: 2px solid #000;
      background: #fff;
    }
    .t-brutalist .footer > div {
      padding: 18px 50px;
      font-family: 'JetBrains Mono', monospace;
    }
    .t-brutalist .footer > div:first-child { border-right: 2px solid #000; }
    .t-brutalist .footer .lbl {
      font-size: 9px;
      letter-spacing: 0.22em;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .t-brutalist .footer .name {
      font-family: 'Archivo Black', sans-serif;
      font-size: 22px;
      text-transform: uppercase;
      letter-spacing: -0.01em;
    }
    .t-brutalist .stamp {
      position: absolute;
      top: 50%;
      right: 50px;
      transform: translateY(-50%) rotate(-12deg);
      border: 3px solid ${accent};
      color: ${accent};
      padding: 10px 20px;
      font-family: 'Archivo Black', sans-serif;
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      z-index: 3;
      background: rgba(255, 255, 255, 0.6);
    }
  `;

  return { body, styles };
};
