/**
 * Putting recipient data into a designed string.
 *
 * The ordering rule here is a security property, not a formatting one:
 * substitution runs on the RAW template and escaping happens afterwards in the
 * renderer. Escaping first and substituting second would drop unescaped user
 * data into HTML, and a student whose name contains markup would be a stored
 * XSS on every certificate the course issues.
 */
import { describe, expect, it } from 'vitest';
import {
  STRESS_BINDING_VALUES,
  buildBindingValues,
  isBindingKey,
  listBindings,
  substituteBindings,
  type CertificateRenderData
} from '@cio/certificates';

const data: CertificateRenderData = {
  recipientName: 'Ana Ruiz',
  courseName: 'Probabilidad y Estadística',
  courseDescription: 'Curso introductorio.',
  orgName: 'Tensor Tech',
  date: '15 de septiembre de 2026',
  certificateId: 'N° 0148'
};

const values = buildBindingValues(data, 'Industrias del Sur');

describe('substituteBindings', () => {
  it('replaces a token with its value', () => {
    expect(substituteBindings('Otorgado a {{recipientName}}', values)).toBe('Otorgado a Ana Ruiz');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(substituteBindings('{{orgName}} — {{orgName}}', values)).toBe('Tensor Tech — Tensor Tech');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteBindings('{{  recipientName  }}', values)).toBe('Ana Ruiz');
  });

  it('leaves an unknown token visible instead of blanking it', () => {
    // A teacher who mistypes should see the typo in the preview, not discover a
    // silent gap on a document that has already been issued.
    expect(substituteBindings('Hola {{recipentName}}', values)).toBe('Hola {{recipentName}}');
  });

  it('leaves text with no tokens untouched', () => {
    expect(substituteBindings('se certifica que', values)).toBe('se certifica que');
  });

  it('does not escape — the renderer owns that, and order matters', () => {
    // If this function escaped, the renderer would double-escape the literal
    // text; if the renderer did not escape, a name like this would be markup.
    // The contract is: substitute raw here, escape once downstream.
    const hostile = buildBindingValues({ ...data, recipientName: '<script>alert(1)</script>' });

    expect(substituteBindings('{{recipientName}}', hostile)).toBe('<script>alert(1)</script>');
  });

  it('carries the client brand, which has no home in the render data yet', () => {
    expect(substituteBindings('{{clientName}}', values)).toBe('Industrias del Sur');
  });

  it('defaults the client brand to empty rather than printing undefined', () => {
    expect(substituteBindings('{{clientName}}', buildBindingValues(data))).toBe('');
  });
});

describe('listBindings', () => {
  it('reports the fields a string actually uses', () => {
    expect(listBindings('{{recipientName}} — {{courseName}}').sort()).toEqual(['courseName', 'recipientName']);
  });

  it('reports each field once', () => {
    expect(listBindings('{{orgName}} {{orgName}}')).toEqual(['orgName']);
  });

  it('ignores unknown tokens', () => {
    expect(listBindings('{{nope}}')).toEqual([]);
  });
});

describe('isBindingKey', () => {
  it('accepts a known field and rejects anything else', () => {
    expect(isBindingKey('recipientName')).toBe(true);
    expect(isBindingKey('__proto__')).toBe(false);
  });
});

describe('STRESS_BINDING_VALUES', () => {
  /**
   * `date` is deliberately absent: a long-form Spanish date is already at its
   * ceiling ("30 de septiembre de 2026"), so there is no worst case to stress —
   * unlike a name or a course title, which have no natural bound.
   */
  const UNBOUNDED_FIELDS = [
    'recipientName',
    'courseName',
    'courseDescription',
    'orgName',
    'clientName',
    'certificateId'
  ] as const;

  it('is longer than realistic data in every field that has no natural bound', () => {
    // The stress preview exists so a teacher designing with their own short
    // name discovers the overflow before a student does.
    for (const key of UNBOUNDED_FIELDS) {
      expect(STRESS_BINDING_VALUES[key].length).toBeGreaterThan(values[key].length);
    }
  });

  it('covers every binding, so the preview never leaves one at its sample value', () => {
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      expect(STRESS_BINDING_VALUES[key].length).toBeGreaterThan(0);
    }
  });

  it('uses a date at the long end of the Spanish format', () => {
    expect(STRESS_BINDING_VALUES.date.length).toBeGreaterThanOrEqual('30 de septiembre de 2026'.length);
  });
});
