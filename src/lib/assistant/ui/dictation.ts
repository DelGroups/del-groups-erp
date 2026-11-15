/**
 * Dictation in the assistant's composer (AST-2): which plain-words message an error of the browser's
 * speech recognition gets. Pure, so `npm test` checks it.
 */

export type DictationError = "mic" | "language" | "network" | "silence" | "other";

/** `code` is SpeechRecognitionErrorEvent.error; null means "say nothing" (the user stopped it). */
export function dictationErrorKind(code: string | null | undefined): DictationError | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
    case "audio-capture":
      return "mic";
    case "language-not-supported":
      return "language";
    case "network":
      return "network";
    case "no-speech":
      return "silence";
    default:
      return "other";
  }
}

export function dictationErrorKey(kind: DictationError): string {
  return `assistant.dictationErrors.${kind}`;
}

/** The recognition language for the ERP's language. */
export const DICTATION_LANG: Readonly<Record<string, string>> = { az: "az-AZ", en: "en-US", ru: "ru-RU" };
