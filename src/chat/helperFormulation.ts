// The chat helper's behaviour as a versioned formulation (AEG.CHAT.HELPER, SOP AEG-SOP-006): scope, polite refusal, rules and map rules live in
// content/chat/helper.formulation.json, not in code, so they can be tuned against the stress set and reviewed. The system prompt is built from it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const Formulation = z.object({
  id: z.literal('AEG.CHAT.HELPER'), version: z.string().regex(/^\d+\.\d+\.\d+$/), sop: z.literal('AEG-SOP-006'), status: z.string().min(5),
  persona: z.string().min(20), inScope: z.array(z.string().min(10)).min(3), outOfScope: z.string().min(20), refusal: z.string().min(40).max(500),
  rules: z.array(z.string().min(10)).min(5), mapRules: z.array(z.string().min(10)).min(3), nearbyRules: z.array(z.string().min(10)).min(3), aboutAegis: z.array(z.string().min(10)).min(5), format: z.string().min(40),
}).strict();
export type HelperFormulation = z.infer<typeof Formulation>;

export const HELPER_FORMULATION_FILE = fileURLToPath(new URL('../../content/chat/helper.formulation.json', import.meta.url));
let cached: HelperFormulation | null = null;
export function loadHelperFormulation(file: string = HELPER_FORMULATION_FILE): HelperFormulation {
  if (file === HELPER_FORMULATION_FILE && cached) return cached;
  const parsed = Formulation.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (file === HELPER_FORMULATION_FILE) cached = parsed;
  return parsed;
}

/** The system prompt the model receives. `toolsJson` is the JSON list of the read-only tools this user may call. */
export function buildHelperSystemPrompt(f: HelperFormulation, toolsJson: string): string {
  const list = (items: readonly string[]): string => items.map((x) => `- ${x}`).join('\n');
  return [
    f.persona,
    `You may help with:\n${list(f.inScope)}`,
    `You may NOT help with: ${f.outOfScope} For those, set scope to "out".`,
    `Facts about AEGIS (answer questions about AEGIS from these only):\n${list(f.aboutAegis)}`,
    `Rules:\n${list(f.rules)}`,
    `Map control:\n${list(f.mapRules)}`,
    `Finding help nearby:\n${list(f.nearbyRules)}`,
    f.format,
    `Tools: ${toolsJson}`,
  ].join('\n\n');
}
