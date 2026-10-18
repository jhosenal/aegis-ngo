import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOverview, type Overview } from '../../src/overview/contract.js';
import { answerAssist } from '../../ui/src/overview/lib/assist.js';

const overview = parseOverview(JSON.parse(readFileSync(new URL('../../content/overview/stub-haze-incident.json', import.meta.url), 'utf8')));

describe('overview deterministic Assist templates', () => {
  it('summarizes the supplied data and lists critical/high shortfalls in order', () => {
    const answer = answerAssist('summarize', overview);
    expect(answer.title).toBe('Haze Incident Summary');
    expect(answer.paragraphs[0]).toContain('Air quality in Synthetic Region A is in the unhealthy range (PM2.5 156), affecting approximately 12,480 people across 8 communities.');
    expect(answer.paragraphs[0]).toContain('children (0-12), older adults (60+) and people with respiratory conditions');
    expect(answer.items).toEqual([
      'Close the shortfall of 7,000 N95 masks (critical).',
      'Close the shortfall of 150 Air purifiers (high).',
      'Close the shortfall of 3,000 Respiratory medicine (high).',
    ]);
  });

  it('builds a report with all five requested sections and the review line', () => {
    const answer = answerAssist('draft-report', overview);
    expect(answer.paragraphs).toHaveLength(6);
    for (const heading of ['Situation', 'Air quality', 'People at risk', 'Resource shortfall', 'Updates']) expect(answer.paragraphs.join('\n')).toContain(heading);
    expect(answer.paragraphs.at(-1)).toBe('Draft built from the data on this page. Review before sending.');
    expect(answerAssist('generate-report', overview)).toEqual(answer);
  });

  it('answers people and resources from their rows', () => {
    expect(answerAssist('people-at-risk', overview).items).toEqual([
      'Children (0-12): 4,320 (35%).', 'Older adults (60+): 2,180 (18%).',
      'People with respiratory conditions: 1,960 (16%).', 'General population: 4,020 (32%).',
    ]);
    expect(answerAssist('resources', overview).items).toEqual([
      'N95 masks: requested 10,000, available 3,000, shortfall 7,000 (critical).',
      'Air purifiers: requested 200, available 50, shortfall 150 (high).',
      'Respiratory medicine: requested 5,000, available 2,000, shortfall 3,000 (high).',
    ]);
  });

  it('covers key risk factors and communication draft with the synthetic ending', () => {
    const risk = answerAssist('risk-factors', overview);
    expect(risk.paragraphs.join(' ')).toContain('Highest community AQI: 182 in Community 1.');
    expect(risk.paragraphs.join(' ')).toContain('Children (0-12) (35%)');
    const communication = answerAssist('communication', overview);
    expect(communication.paragraphs).toHaveLength(3);
    expect(communication.paragraphs.at(-1)).toBe('This is a synthetic demonstration message.');
  });

  it('matches free text without guessing beyond the data', () => {
    expect(answerAssist('How many masks?', overview).items?.[0]).toContain('N95 masks');
    expect(answerAssist('Please summarize this', overview).title).toBe('Haze Incident Summary');
    expect(answerAssist('Tell me the risk', overview).title).toBe('Key risk factors');
    expect(answerAssist('Anything else?', overview).paragraphs[0]).toBe('I can only answer from the data on this page. Try one of the actions above.');
  });

  it('renders nullable counts as Unknown rather than zero in every answer', () => {
    const nullData = structuredClone(overview) as Overview;
    nullData.kpis.airQuality.value = null;
    nullData.kpis.peopleAtRisk.total = null;
    nullData.kpis.peopleAtRisk.communities = null;
    nullData.groups[0]!.count = null;
    nullData.groups[0]!.sharePercent = null;
    nullData.shortfall[0]!.requested = null;
    nullData.shortfall[0]!.available = null;
    nullData.shortfall[0]!.shortfall = null;
    nullData.map.areas.forEach((area) => { area.aqi = null; });
    expect(answerAssist('summarize', nullData).paragraphs[0]).toContain('(PM2.5 Unknown), affecting approximately Unknown people across Unknown communities.');
    expect(answerAssist('people-at-risk', nullData).items?.[0]).toBe('Children (0-12): Unknown (share unknown).');
    const draftPeople = answerAssist('draft-report', nullData).paragraphs.find((paragraph) => paragraph.startsWith('People at risk\n'));
    expect(draftPeople).toContain('Children (0-12): Unknown (share unknown).');
    expect(answerAssist('resources', nullData).items?.[0]).toContain('requested Unknown, available Unknown, shortfall Unknown');
    expect(answerAssist('risk-factors', nullData).paragraphs[1]).toBe('Highest community AQI: Unknown.');
  });
});
