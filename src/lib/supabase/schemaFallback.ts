export function isSchemaColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return /column|schema cache/i.test(message);
}

export function isAmbiguousEmbedError(message: string | undefined): boolean {
  if (!message) return false;
  return /more than one relationship|could not embed|PGRST20/i.test(message);
}

export function isRetryableSelectError(message: string | undefined): boolean {
  return isSchemaColumnError(message) || isAmbiguousEmbedError(message);
}
