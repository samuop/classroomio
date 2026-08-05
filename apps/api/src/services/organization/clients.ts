import { getClientCompanyRollups, getOwnTokensThisPeriod, type ClientCompanyRollup } from '@cio/db/queries/organization';

export interface ClientCompaniesOverview {
  clients: ClientCompanyRollup[];
  totals: {
    clientCount: number;
    studentCount: number;
    courseCount: number;
    certificatesEarned: number;
    /** Enrolment-weighted, so a client with 200 learners does not count the same as one with 3. */
    averageProgress: number;
    /** The consultancy's own consumption, apart from its clients'. */
    ownTokensThisPeriod: number;
    /** What the account as a whole spent: the consultancy plus every client. */
    accountTokensThisPeriod: number;
  };
}

/** Start of the current calendar month, in ISO form. */
function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * How a consultancy's client companies are doing, side by side.
 *
 * The account total is here because consumption is metered per organization, so
 * a consultancy that bills for its clients cannot read its own cost off any
 * single one of them — the clients' spending is real spending on their account,
 * and it is invisible from inside the consultancy.
 */
export async function getClientCompaniesOverview(parentOrgId: string): Promise<ClientCompaniesOverview> {
  const since = startOfCurrentMonthIso();

  const [clients, ownTokensThisPeriod] = await Promise.all([
    getClientCompanyRollups(parentOrgId, since),
    getOwnTokensThisPeriod(parentOrgId, since)
  ]);

  const studentCount = clients.reduce((total, client) => total + client.studentCount, 0);
  const clientTokens = clients.reduce((total, client) => total + client.tokensThisPeriod, 0);

  // Weighted by learners rather than a mean of means: averaging the client
  // averages would let a client with three learners move the number as much as
  // one with three hundred.
  const weightedProgress = clients.reduce((total, client) => total + client.averageProgress * client.studentCount, 0);

  return {
    clients,
    totals: {
      clientCount: clients.length,
      studentCount,
      courseCount: clients.reduce((total, client) => total + client.courseCount, 0),
      certificatesEarned: clients.reduce((total, client) => total + client.certificatesEarned, 0),
      averageProgress: studentCount > 0 ? Math.round(weightedProgress / studentCount) : 0,
      ownTokensThisPeriod,
      accountTokensThisPeriod: ownTokensThisPeriod + clientTokens
    }
  };
}
