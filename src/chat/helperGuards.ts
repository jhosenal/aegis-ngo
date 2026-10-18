// Cheap, deterministic checks that run BEFORE the model (AEG-SOP-006). A request that tries to rewrite or reveal the assistant's rules gets the standard polite refusal at once:
// no model call is made (so no cost), nothing can be coaxed out of the model, and the provider's own content filter (which answers HTTP 400 to such prompts) is never hit.
const PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|these)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines|polic(?:y|ies))\b/i,
  /\b(reveal|show|print|repeat|display|leak|tell me)\b[^.\n]{0,25}\byour\b[^.\n]{0,12}\b(system\s+)?(prompt|instructions?|rules|guidelines|configuration)\b/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+are\s+now\b[^.\n]{0,60}\b(ai|assistant|bot|dan|unrestricted|unfiltered|free)\b/i,
  /\b(DAN|jailbreak|developer\s+mode|do\s+anything\s+now)\b/,
  /\b(pretend|act)\b[^.\n]{0,20}\b(you\s+(are|have)|to\s+be|as)\b[^.\n]{0,30}\b(no|without)\s+(rules|restrictions|filters|limits)\b/i,
];
export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}
