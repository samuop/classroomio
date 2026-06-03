import * as z from 'zod';

export const ZStudentOverviewParam = z.object({
  profileId: z.string().min(1)
});
export type TStudentOverviewParam = z.infer<typeof ZStudentOverviewParam>;
