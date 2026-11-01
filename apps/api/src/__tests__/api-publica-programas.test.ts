/**
 * La API pública para Seguimiento (SaaS-RRHH, fase 21): listar los programas de la organización con
 * sus cursos, e invitar con programas además de cursos.
 *
 * Seguimiento elige las "sendas" de ingreso de una empresa entre sus programas, y al contratar a
 * alguien lo invita con esas sendas. Antes la API pública no listaba los programas, y la invitación
 * descartaba `programIds` sin avisar (zod saca las claves que no conoce): la persona quedaba invitada
 * sin sus sendas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProgramsByOrg = vi.fn();
const getCoursesByProgram = vi.fn();
const importAudienceMembers = vi.fn(async () => ({ imported: 1 }));

vi.mock('@cio/db/queries/program', () => ({
  getProgramsByOrg: (...a: unknown[]) => getProgramsByOrg(...a),
  getCoursesByProgram: (...a: unknown[]) => getCoursesByProgram(...a)
}));
vi.mock('@api/services/organization/audience', () => ({
  importAudienceMembers: (...a: unknown[]) => importAudienceMembers(...(a as [])),
  assignAudienceToCourses: vi.fn(),
  updatePendingAudienceMemberEmail: vi.fn()
}));
vi.mock('@api/services/organization', () => ({
  getOrgAudience: vi.fn(),
  getOrgAudienceMember: vi.fn(),
  removeAudienceMember: vi.fn()
}));

const { listProgramsService } = await import('@api/services/v1/program');
const { createAudienceService } = await import('@api/services/v1/audience');
const { ZPublicApiCreateAudience } = await import('@cio/utils/validation/public-api');

const ORG = '11111111-1111-4111-8111-111111111111';
const INGRESO = '22222222-2222-4222-8222-222222222222';
const CAJA = '33333333-3333-4333-8333-333333333333';
const CURSO = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listar los programas', () => {
  it('los activos de la organización, cada uno con sus cursos', async () => {
    getProgramsByOrg.mockResolvedValue([
      { id: INGRESO, name: 'Inducción general', status: 'ACTIVE' },
      { id: CAJA, name: 'Operación de caja', status: 'ACTIVE' },
      { id: 'viejo', name: 'Archivado', status: 'ARCHIVED' }
    ]);
    getCoursesByProgram.mockImplementation(async (programId: string) =>
      programId === INGRESO ? [{ course: { id: CURSO, title: 'Bienvenida a la empresa' } }] : []
    );

    expect(await listProgramsService(ORG)).toEqual([
      { id: INGRESO, title: 'Inducción general', courses: [{ id: CURSO, title: 'Bienvenida a la empresa' }] },
      { id: CAJA, title: 'Operación de caja', courses: [] }
    ]);
    expect(getProgramsByOrg).toHaveBeenCalledWith(ORG);
    // El archivado no se pide
    expect(getCoursesByProgram).not.toHaveBeenCalledWith('viejo');
  });
});

describe('invitar con programas', () => {
  it('el contrato acepta programIds y la invitación los lleva', async () => {
    const pedido = ZPublicApiCreateAudience.parse({ email: 'ana@invalid.local', programIds: [INGRESO], courseIds: [CURSO] });
    expect(pedido.programIds).toEqual([INGRESO]);

    await createAudienceService(ORG, 'actor', pedido);
    expect(importAudienceMembers).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ recipientCsv: 'ana@invalid.local', courseIds: [CURSO], programIds: [INGRESO] }),
      'actor'
    );
  });

  it('un programa que no es un uuid no pasa', () => {
    expect(ZPublicApiCreateAudience.safeParse({ email: 'ana@invalid.local', programIds: ['no-es-uuid'] }).success).toBe(false);
  });
});
