import type { FastifyInstance } from 'fastify';
import { BudgetLedger } from '../../providers/budget-ledger.js';
import type { AegisConfig } from '../../config/config.js';
import { AegisError } from '../../engine/errors.js';
import type { Principal } from '../../types/domain.js';
import { principalFrom } from '../auth.js';

type Db = import('better-sqlite3').Database;

/** Account-wide spend is financial metadata of the whole deployment: platform administrators only (S0038 finding 8). */
function administrator(principal: Principal): void {
  if (principal.isAdmin !== true) throw new AegisError('E_FORBIDDEN_ROLE');
}

export function registerBudgetRoute(app: FastifyInstance, db: Db, config: AegisConfig): void {
  app.get('/api/budget', async (request) => {
    administrator(principalFrom(request));
    const ledger = new BudgetLedger(db, {
      accountMicro: config.budget.accountMicro,
      dayMicro: config.budget.dayMicro,
      taskMicro: config.budget.taskMicro,
      providerAccountMicro: { google: config.budget.googleMicro, reapi: config.budget.reapiMicro },
    });
    return {
      limits: {
        accountMicro: config.budget.accountMicro,
        dayMicro: config.budget.dayMicro,
        taskMicro: config.budget.taskMicro,
      },
      committedMicro: ledger.totals().committedMicro,
      modelsEnabled: config.modelsEnabled,
      providerMode: config.providerMode,
    };
  });
}
