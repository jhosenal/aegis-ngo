import { formatCount, type Overview } from '../../../../src/overview/contract.js';

export interface AssistAnswer {
  title?: string;
  paragraphs: string[];
  items?: string[];
}

const bandName = (data: Overview): string => data.kpis.airQuality.band.toLowerCase().replaceAll('_', ' ');
const number = (value: number | null): string => formatCount(value);
const groupLine = (group: Overview['groups'][number]): string => `${group.label}: ${number(group.count)} (${group.sharePercent === null ? 'share unknown' : `${number(group.sharePercent)}%`}).`;
function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? 'Unknown';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function summary(data: Overview): AssistAnswer {
  const groups = data.groups.slice(0, 3).map((group) => group.label.toLowerCase());
  const items = data.shortfall.filter((row) => row.priority === 'CRITICAL' || row.priority === 'HIGH')
    .map((row) => `Close the shortfall of ${number(row.shortfall)} ${row.item} (${row.priority.toLowerCase()}).`);
  return {
    title: 'Haze Incident Summary',
    paragraphs: [`Air quality in ${data.incident.region} is in the ${bandName(data)} range (${data.kpis.airQuality.pollutant} ${number(data.kpis.airQuality.value)}), affecting approximately ${number(data.kpis.peopleAtRisk.total)} people across ${number(data.kpis.peopleAtRisk.communities)} communities. Vulnerable groups include ${joinLabels(groups)}.`],
    items: items.length > 0 ? items : data.shortfall.length === 0 ? ['No shortfall rows in this data.'] : [],
  };
}

function report(data: Overview): AssistAnswer {
  return {
    title: 'Draft situation report',
    paragraphs: [
      `Situation\n${data.incident.title} (${data.incident.id}) is ${data.incident.status.toLowerCase()} in ${data.incident.region}. ${data.incident.situation.note}`,
      `Air quality\n${data.kpis.airQuality.pollutant}: ${number(data.kpis.airQuality.value)} ${data.kpis.airQuality.scale}; band ${bandName(data)}.`,
      `People at risk\nApproximately ${number(data.kpis.peopleAtRisk.total)} people across ${number(data.kpis.peopleAtRisk.communities)} communities. ${data.groups.map(groupLine).join(' ')}`,
      `Resource shortfall\n${data.shortfall.map((row) => `${row.item}: ${number(row.shortfall)} short (${row.priority.toLowerCase()}).`).join(' ') || (data.shortfall.length === 0 ? 'No shortfall rows in this data.' : 'Unknown.')}`,
      `Updates\n${data.updates.map((update) => update.text).join(' ') || (data.updates.length === 0 ? 'No updates in this data.' : 'Unknown.')}`,
      'Draft built from the data on this page. Review before sending.',
    ],
  };
}

export function answerAssist(actionIdOrText: string, overview: Overview): AssistAnswer {
  const normalized = actionIdOrText.toLowerCase().trim();
  if (normalized === 'summarize' || /summary|summari[sz]e/.test(normalized)) return summary(overview);
  if (normalized === 'draft-report' || normalized === 'generate-report' || /report/.test(normalized)) return report(overview);
  if (normalized === 'people-at-risk' || /people/.test(normalized)) return { title: 'People at risk', paragraphs: [], items: overview.groups.map(groupLine) };
  if (normalized === 'resources' || /resources|masks/.test(normalized)) return { title: 'Resource shortfall', paragraphs: overview.shortfall.length === 0 ? ['No shortfall rows in this data.'] : [], items: overview.shortfall.length === 0 ? undefined : overview.shortfall.map((row) => `${row.item}: requested ${number(row.requested)}, available ${number(row.available)}, shortfall ${number(row.shortfall)} (${row.priority.toLowerCase()}).`) };
  if (normalized === 'risk-factors' || /risk/.test(normalized)) {
    const highest = overview.map.areas.filter((area) => area.aqi !== null).sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1))[0];
    const groups = [...overview.groups].filter((group) => group.sharePercent !== null).sort((a, b) => (b.sharePercent ?? -1) - (a.sharePercent ?? -1)).slice(0, 2);
    return { title: 'Key risk factors', paragraphs: [`Air quality is in the ${bandName(overview)} range.`, `Highest community AQI: ${highest ? `${number(highest.aqi)} in ${highest.name}` : 'Unknown'}.`, `Largest population shares: ${groups.map((group) => `${group.label} (${number(group.sharePercent)}%)`).join(' and ') || 'Unknown'}.`] };
  }
  if (normalized === 'communication') return {
    title: 'Communication draft',
    paragraphs: [
      `Air quality in ${overview.incident.region} is in the ${bandName(overview)} range (${overview.kpis.airQuality.pollutant} ${number(overview.kpis.airQuality.value)}).`,
      `Approximately ${number(overview.kpis.peopleAtRisk.total)} people across ${number(overview.kpis.peopleAtRisk.communities)} communities may be affected; resource needs include ${overview.shortfall.map((row) => row.item.toLowerCase()).join(', ') || 'Unknown'}.`,
      'This is a synthetic demonstration message.',
    ],
  };
  return { paragraphs: ['I can only answer from the data on this page. Try one of the actions above.'] };
}
