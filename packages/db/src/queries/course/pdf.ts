import * as schema from '@db/schema';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { db } from '@db/drizzle';

export type TCoursePdfOption = { label: string; isCorrect: boolean };

export type TCoursePdfQuestion = {
  id: number;
  exerciseId: string;
  title: string;
  order: number | null;
  typename: string | null;
  settings: Record<string, unknown>;
  options: TCoursePdfOption[];
};

export type TCoursePdfMedia = { id?: string; name?: string; link?: string; type?: string };

export type TCoursePdfLesson = {
  id: string;
  sectionId: string | null;
  title: string;
  order: number | null;
  content: string | null;
  documents: TCoursePdfMedia[];
  videos: TCoursePdfMedia[];
  slideUrl: string | null;
};

export type TCoursePdfExercise = {
  id: string;
  sectionId: string | null;
  lessonId: string | null;
  title: string;
  description: string | null;
  order: number | null;
  questions: TCoursePdfQuestion[];
};

export type TCoursePdfData = {
  course: {
    id: string;
    title: string;
    description: string | null;
    metadata: Record<string, unknown>;
    orgName: string | null;
  };
  sections: Array<{ id: string; title: string | null; order: number | null }>;
  lessons: TCoursePdfLesson[];
  exercises: TCoursePdfExercise[];
};

/** Lesson text in Spanish when there is one: it is the language the platform is written in. */
const LOCALE_PREFERENCE = ['es', 'en'];

function pickContent(rows: Array<{ locale: string | null; content: string | null }>): string | null {
  const withText = rows.filter((row) => row.content && row.content.trim() !== '');

  for (const locale of LOCALE_PREFERENCE) {
    const match = withText.find((row) => row.locale === locale);
    if (match) return match.content;
  }

  return withText[0]?.content ?? null;
}

/** Everything a printable copy of the course needs, in one place. */
export async function getCourseForPdf(courseId: string): Promise<TCoursePdfData | null> {
  try {
    const [course] = await db
      .select({
        id: schema.course.id,
        title: schema.course.title,
        description: schema.course.description,
        metadata: schema.course.metadata,
        orgName: schema.organization.name
      })
      .from(schema.course)
      .leftJoin(schema.group, eq(schema.course.groupId, schema.group.id))
      .leftJoin(schema.organization, eq(schema.group.organizationId, schema.organization.id))
      .where(eq(schema.course.id, courseId))
      .limit(1);

    if (!course) {
      return null;
    }

    const sections = await db
      .select({ id: schema.courseSection.id, title: schema.courseSection.title, order: schema.courseSection.order })
      .from(schema.courseSection)
      .where(eq(schema.courseSection.courseId, courseId))
      .orderBy(asc(schema.courseSection.order));

    const lessonRows = await db
      .select({
        id: schema.lesson.id,
        sectionId: schema.lesson.sectionId,
        title: schema.lesson.title,
        order: schema.lesson.order,
        documents: schema.lesson.documents,
        videos: schema.lesson.videos,
        slideUrl: schema.lesson.slideUrl
      })
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, courseId))
      .orderBy(asc(schema.lesson.order));

    const lessonIds = lessonRows.map((lesson) => lesson.id);

    const contentRows =
      lessonIds.length > 0
        ? await db
            .select({
              lessonId: schema.lessonLanguage.lessonId,
              locale: schema.lessonLanguage.locale,
              content: schema.lessonLanguage.content
            })
            .from(schema.lessonLanguage)
            .where(inArray(schema.lessonLanguage.lessonId, lessonIds))
        : [];

    const exerciseRows = await db
      .select({
        id: schema.exercise.id,
        sectionId: schema.exercise.sectionId,
        lessonId: schema.exercise.lessonId,
        title: schema.exercise.title,
        description: schema.exercise.description,
        order: schema.exercise.order
      })
      .from(schema.exercise)
      .where(
        lessonIds.length > 0
          ? or(eq(schema.exercise.courseId, courseId), inArray(schema.exercise.lessonId, lessonIds))
          : eq(schema.exercise.courseId, courseId)
      )
      .orderBy(asc(schema.exercise.order));

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);

    const questionRows =
      exerciseIds.length > 0
        ? await db
            .select({
              id: schema.question.id,
              exerciseId: schema.question.exerciseId,
              title: schema.question.title,
              order: schema.question.order,
              settings: schema.question.settings,
              typename: schema.questionType.typename
            })
            .from(schema.question)
            .leftJoin(schema.questionType, eq(schema.question.questionTypeId, schema.questionType.id))
            .where(inArray(schema.question.exerciseId, exerciseIds))
            .orderBy(asc(schema.question.order), asc(schema.question.id))
        : [];

    const questionIds = questionRows.map((question) => question.id);

    const optionRows =
      questionIds.length > 0
        ? await db
            .select({
              questionId: schema.option.questionId,
              label: schema.option.label,
              isCorrect: schema.option.isCorrect
            })
            .from(schema.option)
            .where(inArray(schema.option.questionId, questionIds))
            .orderBy(asc(schema.option.id))
        : [];

    const questions: TCoursePdfQuestion[] = questionRows.map((question) => ({
      id: question.id,
      exerciseId: question.exerciseId,
      title: question.title,
      order: question.order,
      typename: question.typename,
      settings: (question.settings ?? {}) as Record<string, unknown>,
      options: optionRows
        .filter((option) => option.questionId === question.id)
        .map((option) => ({ label: option.label, isCorrect: option.isCorrect }))
    }));

    return {
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        metadata: (course.metadata ?? {}) as Record<string, unknown>,
        orgName: course.orgName
      },
      sections,
      lessons: lessonRows.map((lesson) => ({
        id: lesson.id,
        sectionId: lesson.sectionId,
        title: lesson.title,
        order: lesson.order,
        content: pickContent(contentRows.filter((row) => row.lessonId === lesson.id)),
        documents: (lesson.documents ?? []) as TCoursePdfMedia[],
        videos: (lesson.videos ?? []) as TCoursePdfMedia[],
        slideUrl: lesson.slideUrl
      })),
      exercises: exerciseRows.map((exercise) => ({
        ...exercise,
        questions: questions.filter((question) => question.exerciseId === exercise.id)
      }))
    };
  } catch (error) {
    console.error('getCourseForPdf error:', error);
    throw new Error(
      `Failed to get course "${courseId}" for PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
