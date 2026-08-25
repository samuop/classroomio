/**
 * Quién puede reescribir el texto de un correo, y quién sólo puede leerlo.
 *
 * La regla tiene dos mitades que se confunden fácil:
 *
 *   - **El texto es de la consultora.** La alumna de una empresa cliente recibe
 *     un correo firmado con el nombre de la consultora y salido de su dominio,
 *     así que el texto también es de la consultora. Los clientes lo heredan.
 *   - **El interruptor es de cada empresa.** Heredar el texto no es lo mismo que
 *     heredar la decisión de mandarlo: una empresa cliente puede apagar un aviso
 *     sin tocarle nada a nadie.
 *
 * La primera mitad tenía un agujero. `orgAdminMiddleware` prueba que quien pide
 * sea admin **de la empresa del encabezado**, y el servicio después escribía en
 * la raíz —porque ahí es donde vive el texto—. El admin de una empresa cliente
 * le reescribía los correos a su consultora y a todas sus hermanas, firmados con
 * el nombre de la consultora. Ninguna de las dos capas estaba mal por separado:
 * el agujero estaba en la junta, que es donde nadie mira.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRootOrganization = vi.fn();
const getOrgEmailTemplate = vi.fn();
const getOrgEmailTemplates = vi.fn();
const upsertOrgEmailTemplate = vi.fn();
const deleteOrgEmailTemplate = vi.fn();
const getOrgNotificationSettings = vi.fn();
const getOrganizationById = vi.fn();
const updateOrganization = vi.fn();

vi.mock('@cio/db/queries/organization', () => ({
  getRootOrganization: (...a: unknown[]) => getRootOrganization(...(a as [])),
  getOrgEmailTemplate: (...a: unknown[]) => getOrgEmailTemplate(...(a as [])),
  getOrgEmailTemplates: (...a: unknown[]) => getOrgEmailTemplates(...(a as [])),
  upsertOrgEmailTemplate: (...a: unknown[]) => upsertOrgEmailTemplate(...(a as [])),
  deleteOrgEmailTemplate: (...a: unknown[]) => deleteOrgEmailTemplate(...(a as [])),
  getOrgNotificationSettings: (...a: unknown[]) => getOrgNotificationSettings(...(a as [])),
  getOrganizationById: (...a: unknown[]) => getOrganizationById(...(a as [])),
  updateOrganization: (...a: unknown[]) => updateOrganization(...(a as []))
}));

const { listEmailTemplatesService, resetEmailTemplateService, resolveEmailOverride, updateEmailTemplateService } =
  await import('@api/services/organization/email-template');

const CONSULTORA = 'org-consultora';
const CLIENTE = 'org-cliente';

/** Un correo que existe de verdad en el registro, con interruptor propio. */
const CORREO = 'studentCourseCompletion';
/** Otro que existe pero NO se puede apagar: sin él nadie entra al curso. */
const CORREO_SIN_INTERRUPTOR = 'studentCourseInvite';

const FILA_VACIA = {
  emailId: CORREO,
  subject: null,
  heading: null,
  body: null,
  ctaLabel: null,
  ctaUrl: null,
  footer: null,
  updatedAt: new Date()
};

/** La empresa que pide ES la raíz: la consultora se ve a sí misma. */
function comoConsultora() {
  getRootOrganization.mockImplementation(async (orgId: string) =>
    orgId === CONSULTORA ? { id: CONSULTORA, name: 'Consultora Ejemplo' } : null
  );
}

/** La empresa que pide cuelga de la consultora. */
function comoCliente() {
  getRootOrganization.mockResolvedValue({ id: CONSULTORA, name: 'Consultora Ejemplo' });
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrgEmailTemplates.mockResolvedValue([]);
  getOrgEmailTemplate.mockResolvedValue(null);
  getOrgNotificationSettings.mockResolvedValue(null);
  getOrganizationById.mockResolvedValue({ id: CLIENTE });
  updateOrganization.mockResolvedValue(undefined);
});

describe('el corte entre una empresa cliente y su consultora', () => {
  it('la consultora guarda su propio texto', async () => {
    comoConsultora();

    await updateEmailTemplateService(CONSULTORA, CORREO, { blocks: { body: 'Texto nuevo' } }, 'perfil-1');

    expect(upsertOrgEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: CONSULTORA, emailId: CORREO, body: 'Texto nuevo' })
    );
  });

  it('una empresa cliente NO puede reescribir el texto de su consultora', async () => {
    comoCliente();

    await expect(
      updateEmailTemplateService(CLIENTE, CORREO, { blocks: { body: 'Mandá tus datos acá' } }, 'perfil-2')
    ).rejects.toMatchObject({ code: 'NOT_PRIMARY_WORKSPACE', statusCode: 403 });

    // Que tire no alcanza: lo que importa es que no haya escrito nada.
    expect(upsertOrgEmailTemplate).not.toHaveBeenCalled();
    expect(deleteOrgEmailTemplate).not.toHaveBeenCalled();
  });

  it('una empresa cliente tampoco puede restaurar el original de la consultora', async () => {
    comoCliente();

    await expect(resetEmailTemplateService(CLIENTE, CORREO)).rejects.toMatchObject({
      code: 'NOT_PRIMARY_WORKSPACE',
      statusCode: 403
    });

    expect(deleteOrgEmailTemplate).not.toHaveBeenCalled();
  });

  it('un pedido mixto que no puede tocar el texto tampoco toca el interruptor', async () => {
    // Aplicar la mitad que sí se puede dejaría la pantalla mostrando un estado
    // que nadie pidió, y encima con un error arriba.
    comoCliente();

    await expect(
      updateEmailTemplateService(CLIENTE, CORREO, { enabled: false, blocks: { body: 'x' } })
    ).rejects.toMatchObject({ code: 'NOT_PRIMARY_WORKSPACE' });

    expect(updateOrganization).not.toHaveBeenCalled();
  });
});

describe('lo que una empresa cliente SÍ puede hacer', () => {
  it('lee el texto de su consultora, y la pantalla sabe que no lo puede editar', async () => {
    comoCliente();
    getOrgEmailTemplates.mockResolvedValue([{ ...FILA_VACIA, subject: 'Asunto de la consultora' }]);

    const payload = await listEmailTemplatesService(CLIENTE);

    expect(payload.canEditText).toBe(false);
    expect(payload.textOwner).toEqual({ id: CONSULTORA, name: 'Consultora Ejemplo' });
    // Lee de la raíz, no de sí misma.
    expect(getOrgEmailTemplates).toHaveBeenCalledWith(CONSULTORA);
    expect(payload.templates.find((t) => t.id === CORREO)?.values.subject).toBe('Asunto de la consultora');
  });

  it('apaga un correo, y el apagado es SUYO, no de la consultora', async () => {
    // Es la otra mitad de la regla: hereda el texto, no la decisión de mandarlo.
    comoCliente();

    await updateEmailTemplateService(CLIENTE, CORREO, { enabled: false });

    expect(updateOrganization).toHaveBeenCalledWith(CLIENTE, expect.anything());
    expect(updateOrganization).not.toHaveBeenCalledWith(CONSULTORA, expect.anything());
  });

  it('un correo sin interruptor no se puede apagar', async () => {
    comoConsultora();

    await expect(
      updateEmailTemplateService(CONSULTORA, CORREO_SIN_INTERRUPTOR, { enabled: false })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(updateOrganization).not.toHaveBeenCalled();
  });
});

describe('la cascada de bloques', () => {
  it('guardar un bloque no borra los otros', async () => {
    comoConsultora();
    getOrgEmailTemplate.mockResolvedValue({ ...FILA_VACIA, subject: 'Asunto propio', body: 'Cuerpo propio' });

    await updateEmailTemplateService(CONSULTORA, CORREO, { blocks: { body: 'Cuerpo nuevo' } });

    expect(upsertOrgEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Asunto propio', body: 'Cuerpo nuevo' })
    );
  });

  it('vaciar todos los bloques restaura el original, no guarda seis vacíos', async () => {
    comoConsultora();
    getOrgEmailTemplate.mockResolvedValue({ ...FILA_VACIA, body: 'Cuerpo propio' });

    await updateEmailTemplateService(CONSULTORA, CORREO, {
      blocks: { subject: null, heading: null, body: null, ctaLabel: null, ctaUrl: null, footer: null }
    });

    expect(deleteOrgEmailTemplate).toHaveBeenCalledWith(CONSULTORA, CORREO);
    expect(upsertOrgEmailTemplate).not.toHaveBeenCalled();
  });

  it('un botón sin texto se guarda vacío: sacar el botón es una elección', () => {
    // Si el vacío se tratara como "usá el original", cada guardado devolvería el
    // botón y sacarlo sería imposible.
    comoConsultora();

    return updateEmailTemplateService(CONSULTORA, CORREO, { blocks: { ctaLabel: '   ' } }).then(() => {
      expect(upsertOrgEmailTemplate).toHaveBeenCalledWith(expect.objectContaining({ ctaLabel: '' }));
    });
  });

  it('un asunto en blanco vuelve al original, que no es lo mismo', async () => {
    comoConsultora();
    getOrgEmailTemplate.mockResolvedValue({ ...FILA_VACIA, subject: 'Algo', body: 'Cuerpo' });

    await updateEmailTemplateService(CONSULTORA, CORREO, { blocks: { subject: '  ' } });

    expect(upsertOrgEmailTemplate).toHaveBeenCalledWith(expect.objectContaining({ subject: null }));
  });
});

describe('lo que se manda de verdad', () => {
  it('una empresa cliente manda el texto de su consultora', async () => {
    comoCliente();
    getOrgEmailTemplate.mockResolvedValue({ ...FILA_VACIA, body: 'Escrito por la consultora' });

    const resultado = await resolveEmailOverride(CLIENTE, CORREO, {
      orgName: 'Empresa Cliente',
      courseName: 'Seguridad',
      studentName: 'Ana',
      certificateUrl: 'https://ejemplo.test/cert'
    });

    expect(getOrgEmailTemplate).toHaveBeenCalledWith(CONSULTORA, CORREO);
    expect(resultado?.content).toContain('Escrito por la consultora');
  });

  it('sin nada reescrito devuelve null y sigue el camino de siempre', async () => {
    comoConsultora();
    getOrgEmailTemplate.mockResolvedValue(null);

    await expect(resolveEmailOverride(CONSULTORA, CORREO, {})).resolves.toBeNull();
  });

  it('el HTML guardado por la versión anterior se descarta, no se muestra escapado', async () => {
    // La versión previa guardaba el documento entero. Mostrarlo tal cual sería
    // escupir `<!doctype html>` adentro de un párrafo del correo.
    comoConsultora();
    const html = '<!doctype html><html><body><p>Hola</p></body></html>';
    getOrgEmailTemplates.mockResolvedValue([{ ...FILA_VACIA, body: html }]);

    const payload = await listEmailTemplatesService(CONSULTORA);
    const correo = payload.templates.find((t) => t.id === CORREO)!;

    expect(correo.overrides.body).toBeNull();
    expect(correo.isCustomized).toBe(false);
    expect(correo.values.body).toBe(correo.defaults.body);
  });

  it('un texto con un signo menor NO se confunde con HTML viejo', async () => {
    // Descartar en silencio lo que alguien escribió es peor que el problema que
    // el descarte resuelve, así que la señal tiene que ser del documento entero.
    comoConsultora();
    getOrgEmailTemplates.mockResolvedValue([{ ...FILA_VACIA, body: 'Si el descuento es <b>ajo del 10%, avisanos.' }]);

    const payload = await listEmailTemplatesService(CONSULTORA);

    expect(payload.templates.find((t) => t.id === CORREO)?.values.body).toContain('<b>ajo');
  });
});
