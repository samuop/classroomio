import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const newsfeedPostEmail = defineEmail({
  id: 'newsfeedPost',
  subject: 'Nueva publicación en tu curso',
  schema: z.object({
    courseTitle: z.string().min(1),
    teacherName: z.string().min(1),
    content: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>${fields.teacherName} hizo una publicación en un curso que estás haciendo: ${fields.courseTitle}.</p>
      <div style="font-style: italic; margin-top: 10px;">${fields.content}</div>
      <div>
        <a class="button" href="${fields.postLink}">Ver publicación</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});

export const newsfeedCommentEmail = defineEmail({
  id: 'newsfeedComment',
  subject: 'Nuevo comentario en tu publicación',
  schema: z.object({
    courseTitle: z.string().min(1),
    comment: z.string().min(1),
    postLink: z.url(),
    orgName: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>Un alumno comentó en tu publicación.</p>
      <div style="font-style: italic; margin-top: 10px;">${fields.comment}</div>
      <div>
        <a class="button" href="${fields.postLink}">Ver comentario</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});
