import type { WorkflowDef } from '../types/domain.js';

export const WORKFLOW_DEFS: readonly WorkflowDef[] = [
  {
    workflowId: 'AEG.W.RESOURCE-ASSESSMENT',
    version: '1.0.0',
    allowedRoles: ['coordinator', 'analyst'],
    stepIds: ['resolve', 'validate', 'compute', 'commit'],
    retryClass: 'replayable',
    timeoutMs: 5000,
  },
];
