export interface LexiconEntry {
  termId: string;
  namespace: 'AEG.T';
  preferredLabel: string;
  definition: string;
  aliases: string[];
  typeOrUnit: string;
  domain: string;
  provenance: string;
  version: string;
  owner: string;
  lifecycle: 'candidate' | 'active' | 'deprecated';
  projectDefined: boolean;
}

export const LEXICON: readonly LexiconEntry[] = [
  {
    termId: 'AEG.T.DEMAND_UNITS', namespace: 'AEG.T', preferredLabel: 'Demand units',
    definition: 'A nonnegative count of units requested for an identified resource.', aliases: ['demand', 'need'],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.AVAILABLE_UNITS', namespace: 'AEG.T', preferredLabel: 'Available units',
    definition: 'A nonnegative count of units recorded as available before reserve is deducted.', aliases: ['available', 'stock'],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.RESERVE_UNITS', namespace: 'AEG.T', preferredLabel: 'Reserve units',
    definition: 'A nonnegative count of available units held back from use.', aliases: ['reserve', 'stock'],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.USABLE_UNITS', namespace: 'AEG.T', preferredLabel: 'Usable units',
    definition: 'Available units after reserve units are deducted.', aliases: [],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.SHORTFALL_UNITS', namespace: 'AEG.T', preferredLabel: 'Shortfall units',
    definition: 'The amount by which demand exceeds usable units, or zero otherwise.', aliases: ['gap', 'shortfall'],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.SURPLUS_UNITS', namespace: 'AEG.T', preferredLabel: 'Surplus units',
    definition: 'The amount by which usable units exceed demand, or zero otherwise.', aliases: ['surplus'],
    typeOrUnit: 'integer units', domain: 'resource', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.INCIDENT', namespace: 'AEG.T', preferredLabel: 'Incident',
    definition: 'A recorded event or condition that may require a humanitarian response.', aliases: [],
    typeOrUnit: 'record', domain: 'incident', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.EVIDENCE', namespace: 'AEG.T', preferredLabel: 'Evidence',
    definition: 'A sourced record retained to support or qualify an assessment.', aliases: [],
    typeOrUnit: 'record', domain: 'evidence', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
  {
    termId: 'AEG.T.AS_OF', namespace: 'AEG.T', preferredLabel: 'As of',
    definition: 'The time basis at which related values are stated.', aliases: [],
    typeOrUnit: 'ISO-8601 UTC timestamp', domain: 'time', provenance: 'AEG-CON-001', version: '1.0.0', owner: 'Owner', lifecycle: 'active', projectDefined: true,
  },
];

export type TermResolution =
  | { kind: 'exact'; entry: LexiconEntry }
  | { kind: 'ambiguous'; candidates: LexiconEntry[] }
  | { kind: 'none' };

export function resolveTerm(text: string): TermResolution {
  const normalized = text.trim().toLocaleLowerCase('en-US');
  const candidates = LEXICON.filter((entry) => [entry.preferredLabel, entry.termId, ...entry.aliases]
    .some((term) => term.toLocaleLowerCase('en-US') === normalized));
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'exact', entry: candidates[0]! };
  return { kind: 'ambiguous', candidates };
}
