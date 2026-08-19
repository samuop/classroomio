import * as z from 'zod';

import { ZSiteName } from '../organization/site-name';

export const ZCreateWorkspace = z.object({
  name: z
    .string()
    .min(5)
    .refine((val) => !/^[-]|[-]$/.test(val), {
      message: 'Workspace name cannot start or end with a hyphen'
    }),
  siteName: ZSiteName
});

export type TCreateWorkspace = z.infer<typeof ZCreateWorkspace>;

export const ZWorkspaceIdParam = z.object({
  workspaceId: z.uuid()
});

export type TWorkspaceIdParam = z.infer<typeof ZWorkspaceIdParam>;
