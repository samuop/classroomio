import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  return {
    courseId: params.id ?? ''
  };
};