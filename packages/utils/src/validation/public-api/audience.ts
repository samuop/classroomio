import * as z from 'zod';

import { ZAssignAudienceCourses, ZGetAudienceQuery } from '../organization';

export const ZPublicApiAudienceQuery = ZGetAudienceQuery;
export type TPublicApiAudienceQuery = z.infer<typeof ZPublicApiAudienceQuery>;

export const ZPublicApiCreateAudience = z.object({
  email: z.string().email(),
  courseIds: z.array(z.string().uuid()).optional(),
  // Los programas (las "sendas" de Seguimiento): quedan en la invitación y matriculan al aceptarla.
  programIds: z.array(z.string().uuid()).optional(),
  sendEmail: z.boolean().default(true)
});
export type TPublicApiCreateAudience = z.infer<typeof ZPublicApiCreateAudience>;

export const ZPublicApiUpdateAudience = z.object({
  email: z.string().email(),
  sendEmail: z.boolean().default(true)
});
export type TPublicApiUpdateAudience = z.infer<typeof ZPublicApiUpdateAudience>;

// El avance de varias personas (Seguimiento, SaaS-RRHH). Los correos van en el cuerpo y no en la
// dirección, para que no queden en los registros. No se exige que estén bien escritos: uno mal
// escrito no figura, y no frena a los demás.
export const ZPublicApiAudienceProgress = z.object({
  emails: z.array(z.string().trim().min(1).max(320)).min(1).max(200)
});
export type TPublicApiAudienceProgress = z.infer<typeof ZPublicApiAudienceProgress>;

export const ZPublicApiAssignAudienceCourses = ZAssignAudienceCourses;
export type TPublicApiAssignAudienceCourses = z.infer<typeof ZPublicApiAssignAudienceCourses>;

export const ZPublicApiAudienceMemberParam = z.object({
  memberId: z.coerce.number().int().positive()
});
export type TPublicApiAudienceMemberParam = z.infer<typeof ZPublicApiAudienceMemberParam>;
