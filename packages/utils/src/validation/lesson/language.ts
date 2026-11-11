import * as z from 'zod';

export const ZLessonLanguageGetParam = z.object({
  courseId: z.uuid(),
  lessonId: z.uuid()
});

export type TLessonLanguageGetParam = z.infer<typeof ZLessonLanguageGetParam>;

export const ZLessonLanguageGetByLocaleParam = z.object({
  courseId: z.uuid(),
  lessonId: z.uuid(),
  locale: z.enum(['en', 'hi', 'fr', 'pt', 'de', 'vi', 'ru', 'es', 'pl', 'da'])
});

export type TLessonLanguageGetByLocaleParam = z.infer<typeof ZLessonLanguageGetByLocaleParam>;

export const ZLessonLanguageCreate = z.object({
  locale: z.enum(['en', 'hi', 'fr', 'pt', 'de', 'vi', 'ru', 'es', 'pl', 'da']),
  content: z.string().optional(),
  /**
   * La huella (SHA-256, hex) del texto que el editor tenía cargado cuando se
   * empezó a escribir. Con ella el servidor rechaza un guardado que pisaría lo
   * que otra sesión —o el asistente— guardó mientras tanto. Sin ella, el
   * guardado pisa: es lo que hace quien decide «guardar lo mío igual».
   */
  baseHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional()
});

export type TLessonLanguageCreate = z.infer<typeof ZLessonLanguageCreate>;

export const ZLessonLanguageUpdate = z.object({
  content: z.string().optional()
});

export type TLessonLanguageUpdate = z.infer<typeof ZLessonLanguageUpdate>;
