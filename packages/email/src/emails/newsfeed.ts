import * as z from 'zod';

import { defineEmail } from '../send';

export const newsfeedPostEmail = defineEmail({
  id: 'newsfeedPost',
  schema: z.object({
    courseTitle: z.string().min(1),
    teacherName: z.string().min(1),
    content: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1)
  }),
  blocks: {
    subject: 'Nueva publicación en tu curso',
    heading: '',
    // `{content}` es lo que escribió el docente. Va como texto: antes se metía
    // crudo en un `<div>` y una publicación con `<` adentro salía rota.
    body: '{teacherName} hizo una publicación en un curso que estás haciendo: {courseTitle}.\n\n{content}',
    ctaLabel: 'Ver publicación',
    ctaUrl: '{postLink}',
    footer: ''
  }
});

export const newsfeedCommentEmail = defineEmail({
  id: 'newsfeedComment',
  schema: z.object({
    courseTitle: z.string().min(1),
    comment: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1)
  }),
  blocks: {
    subject: 'Nuevo comentario en tu publicación',
    heading: '',
    body: 'Un alumno comentó en tu publicación.\n\n{comment}',
    ctaLabel: 'Ver comentario',
    ctaUrl: '{postLink}',
    footer: ''
  }
});
