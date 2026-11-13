/**
 * DOC_DATE_CHANGE (DATE-1): admins change the date of a posted sales or purchase invoice in
 * place ("Tarixi dəyiş"), and see the history in Settings › Date changes. Server-only switch,
 * off unless the env value is "true". The root layout passes it to client screens through
 * DocDateChangeProvider; while off nothing of it is shown.
 */
export function isDocDateChangeEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.DOC_DATE_CHANGE ?? "").trim().toLowerCase() === "true";
}
