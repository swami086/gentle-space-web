const SMUGGLE =
  /[\u200B-\u200D\uFEFF\u2060\u180E]|[\u{E0000}-\u{E007F}]|\p{Cf}/gu;

export function stripSmuggle(input: string): string {
  return input.replace(SMUGGLE, "");
}
