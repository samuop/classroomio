import { redirect } from '@sveltejs/kit';

// Las dos pantallas de correo —qué se manda y qué dice— se fusionaron en una
// sola. Los enlaces viejos siguen funcionando en vez de dar 404.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings/emails`);
};
