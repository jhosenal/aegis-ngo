// The owner's two spend limits, changed from the Admin Desk (owner decision 2026-10-18: "I am the admin, I can change it when I want").
// Only the monthly budget and the per-action auto-approve limit can be changed here, each with a written reason; every change is kept in the budget file's `changes` list.
// Nothing else moves: not the ledger, not the funding balances (those are facts from the billing console), not the price book. Guard rails: the monthly budget stays
// between 1.00 and 50.00 USD (the console caps recorded by the owner are 50.00 USD a month, and the engine limit is meant to be the tighter one), and the per-action limit
// stays between 0.01 USD and the monthly budget.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { AegisError } from '../engine/errors.js';
import { DEFAULT_BUDGET, loadBudget, type Budget } from './engine.js';

export const MIN_MONTHLY_USD = 1;
export const MAX_MONTHLY_USD = 50;
export const MIN_AUTO_APPROVE_USD = 0.01;
const MONEY = /^\d{1,3}(\.\d{1,2})?$/;

export interface SpendLimitChange { monthlyBudgetUsd?: unknown; autoApproveUsd?: unknown; reason?: unknown }
export interface BudgetChangeEntry { at: string; by: string; field: 'monthlyBudgetUsd' | 'autoApproveUsd'; from: string; to: string; reason: string }

const asMoney = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!MONEY.test(text)) throw new AegisError('E_VALIDATION', `${label} must be an amount in USD with at most 2 decimals, for example 10.00.`);
  return Number(text).toFixed(2);
};

/** Validates the change, writes the budget file (whole file, through a temporary file) and returns the new budget. Throws E_VALIDATION with a plain message when a rule is broken. */
export function applySpendLimitChange(change: SpendLimitChange, by: string, atIso: string, file: string = DEFAULT_BUDGET): Budget {
  let budget: Budget;
  try { budget = loadBudget(file); } catch { throw new AegisError('E_VALIDATION', 'The budget file is not on this server (the hosted image does not carry the cost records). Change it where the cost engine runs.'); }
  const reason = typeof change.reason === 'string' ? change.reason.trim() : '';
  if (reason.length < 5 || reason.length > 200) throw new AegisError('E_VALIDATION', 'Give a reason of 5 to 200 characters.');
  const monthly = asMoney(change.monthlyBudgetUsd, 'The monthly budget') ?? Number(budget.monthlyBudgetUsd).toFixed(2);
  const auto = asMoney(change.autoApproveUsd, 'The per-action limit') ?? Number(budget.autoApproveUsd).toFixed(2);
  if (Number(monthly) < MIN_MONTHLY_USD || Number(monthly) > MAX_MONTHLY_USD) throw new AegisError('E_VALIDATION', `The monthly budget must be between ${MIN_MONTHLY_USD.toFixed(2)} and ${MAX_MONTHLY_USD.toFixed(2)} USD (the console caps are ${MAX_MONTHLY_USD.toFixed(2)} USD a month).`);
  if (Number(auto) < MIN_AUTO_APPROVE_USD || Number(auto) > Number(monthly)) throw new AegisError('E_VALIDATION', `The per-action limit must be between ${MIN_AUTO_APPROVE_USD.toFixed(2)} USD and the monthly budget (${monthly} USD).`);
  const entries: BudgetChangeEntry[] = [];
  if (Number(monthly) !== Number(budget.monthlyBudgetUsd)) entries.push({ at: atIso, by, field: 'monthlyBudgetUsd', from: budget.monthlyBudgetUsd, to: monthly, reason });
  if (Number(auto) !== Number(budget.autoApproveUsd)) entries.push({ at: atIso, by, field: 'autoApproveUsd', from: budget.autoApproveUsd, to: auto, reason });
  if (entries.length === 0) throw new AegisError('E_VALIDATION', 'Nothing changed: those are the current limits.');
  const next: Budget = { ...budget, monthlyBudgetUsd: monthly, autoApproveUsd: auto, changes: [...(budget.changes ?? []), ...entries].slice(-50) };
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;   // keep the file's own key order and every other field exactly as it was
  const out = { ...raw, monthlyBudgetUsd: next.monthlyBudgetUsd, autoApproveUsd: next.autoApproveUsd, changes: next.changes };
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
  return next;
}
