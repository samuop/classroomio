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

/**
 * An engraved diploma where the PERSON is the hero.
 *
 * Classique is the other engraved layout, and the difference between them is
 * not decoration: it prints the course name as the largest thing on the page
 * and closes with a seal. This one inverts that — the recipient's name is the
 * hero, the course is what they completed, and the foot carries the two marks
 * where a letterhead would put them. A consultancy handing a certificate to
 * someone else's employee is issuing a document about a person, not advertising
 * a course.
 *
 * The seal is gone with it. What a seal carried — the year and the certificate
 * number — moves to a quiet meta line at the very bottom, next to the issue
 * date, which is where a document that has to survive an audit keeps its
 * reference.
 *
 * Layout follows the same rules the other engraved template had to learn the
 * hard way: a flex column whose children never shrink (a shrunk text box does
 * not reflow, it cuts through the middle of a line), variable-length text
 * bounded by line clamps rather than by hope, and a foot that is a sibling of
 * the main block so the two can never overlap at any content length.
 */
export const renderDiploma: TemplateRenderer = ({ design, data }) => {
  const accent = design.accentColor;
  const subtitle = design.subtitle ?? '';
  const description = design.descriptionOverride || data.courseDescription;
  const [signatoryOne, signatoryTwo] = design.signatories;
  const labels = resolveLabels(design.labels);
  const brands = renderBrands({ design, data, labels });
  const slots = placeBrands(brands, design, 'bottom');

  const body = `
    <div class="cert t-diploma">
      <div class="brand-band">${slots.top}</div>
      <div class="main">
        ${subtitle ? `<div class="eyebrow">${escapeHtml(subtitle)}</div>` : ''}
        <div class="ornament"></div>
        ${labels.presented ? `<div class="presented">${escapeHtml(labels.presented)}</div>` : ''}
        <div class="recipient">${escapeHtml(data.recipientName)}</div>
        <div class="name-rule"></div>
        ${labels.completed ? `<div class="completed">${escapeHtml(labels.completed)}</div>` : ''}
        <div class="title">${escapeHtml(data.courseName)}</div>
        ${description ? `<div class="description">${escapeHtml(description)}</div>` : ''}
      </div>
      <div class="foot">
        <div class="marks">${slots.bottom}</div>
        <div class="sigs">
          <div class="sig">
            ${renderSignatureImage(signatoryOne, 'light')}
            <div class="name">${escapeHtml(signatoryOne.name)}</div>
            <div class="role">${escapeHtml(signatoryOne.role)}</div>
          </div>
          <div class="sig">
            ${renderSignatureImage(signatoryTwo, 'light')}
            <div class="name">${escapeHtml(signatoryTwo.name)}</div>
            <div class="role">${escapeHtml(signatoryTwo.role)}</div>
          </div>
        </div>
        <div class="meta">
          <span>${labels.issued ? `${escapeHtml(labels.issued)} &middot; ` : ''}${escapeHtml(data.date)}</span>
          <span>${labels.reference ? `${escapeHtml(labels.reference)} &middot; ` : ''}${escapeHtml(data.certificateId)}</span>
        </div>
      </div>
    </div>
  `;

  const styles = `
    ${BRAND_STYLES}
    ${BRAND_BAND_STYLES}
    /*
      Lower than classique's 76px: there the marks sit in the header with the
      whole page below them to absorb a tall logo, here they share the foot with
      two signatures and the reference line.
    */
    .t-diploma .brand-logo { max-height: 64px; }
    .t-diploma .brand-caption { font-family: 'Cinzel', serif; letter-spacing: 0.24em; }
    .t-diploma .brand-name {
      font-family: 'Cinzel', serif;
      font-size: 15px;
      letter-spacing: 0.12em;
    }
    .t-diploma .brands { gap: 28px; }

    .t-diploma {
      background: #fcfaf4;
      color: #1f1a15;
      padding: 62px 84px 58px;
      font-family: 'Cormorant Garamond', serif;
      display: flex;
      flex-direction: column;
    }
    /* Double rule. The inner one is the same accent at a third of its weight,
       written as an 8-digit hex because a border cannot carry its own opacity. */
    .t-diploma::before {
      content: '';
      position: absolute;
      inset: 26px;
      border: 2px solid ${accent};
      pointer-events: none;
    }
    .t-diploma::after {
      content: '';
      position: absolute;
      inset: 38px;
      border: 1px solid ${accent}59;
      pointer-events: none;
    }

    .t-diploma .main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
    }
    /* Nothing in this column may shrink — see the note above. What bounds the
       height is the line clamps, which cut at a line boundary. */
    .t-diploma .main > * { flex-shrink: 0; }

    .t-diploma .eyebrow {
      font-family: 'Cinzel', serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.42em;
      text-transform: uppercase;
      color: ${accent};
      /* The tracking is applied to the right of each glyph, including the last
         one, which drags a centred line visibly off-centre without this. */
      text-indent: 0.42em;
    }
    .t-diploma .ornament {
      width: 92px;
      height: 1px;
      background: ${accent};
      opacity: 0.65;
      margin: 16px auto 0;
    }

    .t-diploma .presented {
      font-size: 19px;
      font-style: italic;
      color: #5c5348;
      margin-top: 26px;
    }

    /*
      Two lines, not one with an ellipsis. Classique truncates a long recipient,
      which is the right call where the name is one element among several; on a
      diploma the name IS the document, and "María de los Ángeles Fernández
      Etche…" is worse than a second line.
    */
    .t-diploma .recipient {
      font-family: 'Playfair Display', serif;
      font-size: clamp(38px, 5.6vw, 62px);
      font-weight: 400;
      line-height: 1.08;
      margin-top: 10px;
      padding: 0 40px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .t-diploma .name-rule {
      width: 420px;
      max-width: 100%;
      height: 1px;
      background: ${accent};
      margin: 18px auto 0;
    }

    .t-diploma .completed {
      font-size: 17px;
      font-style: italic;
      color: #5c5348;
      margin-top: 24px;
    }

    .t-diploma .title {
      font-family: 'Playfair Display', serif;
      font-size: clamp(24px, 3.1vw, 34px);
      font-weight: 700;
      line-height: 1.18;
      margin-top: 10px;
      padding: 0 60px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* A caption, not the body: two lines and then it stops. */
    .t-diploma .description {
      font-size: 16px;
      font-style: italic;
      color: #6b6155;
      line-height: 1.55;
      margin-top: 14px;
      padding: 0 130px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .t-diploma .foot {
      flex: none;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .t-diploma .marks {
      color: #1f1a15;
      margin-bottom: 26px;
    }

    .t-diploma .sigs {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 120px;
    }
    .t-diploma .sig {
      text-align: center;
      border-top: 1px solid ${accent}99;
      padding-top: 7px;
      min-width: 0;
    }
    .t-diploma .sig .name {
      font-family: 'Playfair Display', serif;
      font-size: 18px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .t-diploma .sig .role {
      font-family: 'Cinzel', serif;
      font-size: 9.5px;
      letter-spacing: 0.26em;
      text-indent: 0.26em;
      text-transform: uppercase;
      color: ${accent};
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .t-diploma .meta {
      width: 100%;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      margin-top: 22px;
      font-family: 'Cinzel', serif;
      font-size: 9.5px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #8a8073;
    }
    .t-diploma .meta span {
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  return { body, styles };
};
