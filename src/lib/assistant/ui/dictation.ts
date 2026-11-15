/**
 * Dictation in the assistant's composer (AST-2): which plain-words message an error of the browser's
 * speech recognition gets. Pure, so `npm test` checks it.
 */

/** `service`: the browser's speech service never answered (no audio, no result), see DICTATION_TIMEOUTS. */
export type DictationError = "mic" | "language" | "network" | "silence" | "service" | "other";

/**
 * Some browsers start recognition and then never answer (no audio event, no result, no end): the button
 * stayed on "Listening…" for ever. These limits end it with a reason instead.
 *   noAudioMs  no audio from the mic this long after start → the service did not start
 *   noResultMs audio, but no word at all this long → stop and say why
 *   maxMs      one dictation never runs longer than this
 *   stopGraceMs after Stop, wait this long for the last words, then abort
 */
export const DICTATION_TIMEOUTS = { noAudioMs: 6000, noResultMs: 12000, maxMs: 45000, stopGraceMs: 2000 } as const;

type ResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;

/** Splits the browser's results from `from` on into the final text and the words still being heard. */
export function collectResults(results: ResultList, from: number): { final: string; interim: string } {
  let final = "";
  let interim = "";
  for (let i = Math.max(0, from); i < results.length; i++) {
    const text = results[i]?.[0]?.transcript ?? "";
    if (results[i].isFinal) final += text;
    else interim += text;
  }
  return { final: final.replace(/\s+/g, " ").trim(), interim: interim.replace(/\s+/g, " ").trim() };
}

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
