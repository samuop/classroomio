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

export const renderMinimal: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });
  const slots = placeBrands(brands, design, 'top');

  const body = `
    <div class="cert t-minimal">
      <span class="accent-bar" aria-hidden="true"></span>
      <div class="top">
        <span>${slots.top}</span>
        <span>${escapeHtml(data.certificateId)} &middot; ${escapeHtml(data.date)}</span>
      </div>
      <div class="body">
        <div class="small">&mdash; ${escapeHtml(subtitle)} &mdash;</div>
        <div class="title">${escapeHtml(data.courseName)}</div>
        <div class="recipient-row">
          <div class="num">${escapeHtml(data.certificateId)}</div>
          <div class="recipient">${escapeHtml(data.recipientName)}</div>
        </div>
        <div class="description">${escapeHtml(description)}</div>
      </div>
      <div class="footer">
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
        <div class="ref">
          <div class="k">${escapeHtml(labels.reference)}</div>
          <div class="v">${escapeHtml(data.certificateId)}</div>
        </div>
      </div>
      <div class="brand-band">${slots.bottom}</div>
    </div>
  `;

  const styles = `
    ${BRAND_STYLES}
    ${BRAND_BAND_STYLES}
    /* The body block is flex:1, so it absorbs whatever the header takes. */
    .t-minimal .brand-logo { max-height: 64px; }
    /*
      The top row is baseline-aligned 10px mono; a logo in it would sit on that
      baseline and hang below the rule. Centring the row keeps the reference
      number opposite it looking deliberate.
    */
    .t-minimal .top { align-items: center; }
    .t-minimal {
      background: #fff;
      color: #0a0a0a;
      padding: 80px 100px;
      font-family: 'Space Grotesk', sans-serif;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .t-minimal .accent-bar {
      position: absolute;
      top: 0;
      left: 0;
      width: 12px;
      height: 100%;
      background: ${accent};
    }
    .t-minimal .top {
      display: flex;
      justify-content: space-between;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      color: #999;
      padding-bottom: 20px;
      border-bottom: 1px solid #0a0a0a;
    }
    .t-minimal .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 30px 0;
    }
    .t-minimal .small {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: ${accent};
      margin-bottom: 22px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      align-self: flex-start;
    }
    .t-minimal .small::before {
      content: '';
      width: 28px;
      height: 2px;
      background: ${accent};
    }
    .t-minimal .small::after {
      content: '';
      width: 28px;
      height: 2px;
      background: ${accent};
    }
    /*
      Bounded, so the signature row below cannot be pushed off the page. At a
      flat 68px with no clamp, a long course name simply kept wrapping and took
      the footer with it.
    */
    .t-minimal .title {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(40px, 6.2vw, 68px);
      font-weight: 300;
      font-style: italic;
      line-height: 1.02;
      margin-bottom: 40px;
      letter-spacing: -0.01em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-minimal .recipient-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 30px;
      align-items: end;
      border-bottom: 2px solid ${accent};
      padding-bottom: 14px;
      margin-bottom: 24px;
    }
    .t-minimal .recipient-row .num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: ${accent};
      padding-bottom: 14px;
      letter-spacing: 0.1em;
    }
    .t-minimal .recipient {
      font-family: 'Cormorant Garamond', serif;
      font-size: 88px;
      font-weight: 400;
      line-height: 0.95;
      letter-spacing: -0.02em;
    }
    .t-minimal .description {
      font-size: 16px;
      line-height: 1.6;
      color: #333;
      max-width: 700px;
      font-weight: 400;
    }
    .t-minimal .footer {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 30px;
      padding-top: 20px;
      border-top: 1px solid #0a0a0a;
      font-family: 'JetBrains Mono', monospace;
    }
    .t-minimal .footer .k {
      font-size: 9px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 4px;
    }
    .t-minimal .footer .v {
      font-family: 'Cormorant Garamond', serif;
      font-size: 20px;
      font-weight: 500;
      line-height: 1.1;
    }
    .t-minimal .footer .ref .k { color: ${accent}; }
    .t-minimal .footer .ref .v { color: ${accent}; }
  `;

  return { body, styles };
};
