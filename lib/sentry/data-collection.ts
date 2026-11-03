import type * as Sentry from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]>;

/**
 * Sentry SDK v11 collects query strings, cookies and database query data by
 * default. This site handles contributors' names, emails and claim tokens, so
 * both the server and the browser init use this explicit, restrictive set.
 */
export const DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  urlQueryParams: false,
  databaseQueryData: false,
  httpBodies: [],
  httpHeaders: false,
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
};
