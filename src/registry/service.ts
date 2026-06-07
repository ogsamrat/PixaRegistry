// =============================================================================
// Service facade — the single high-level API used by every surface (HTTP, MCP,
// CLI). Keeps submit/verify/inspect logic in one place so the surfaces stay thin.
// =============================================================================

import type { ProbeRun, Review, ServiceRecord, ServiceSubmission } from '../types.js';
import { normalizeSubmission } from './normalize.js';
import { parseSubmission } from './validation.js';
import {
  addReview,
  deleteService,
  getProbeRuns,
  getReviews,
  getService,
  getServiceWithHistory,
  listServices,
  upsertService,
} from './repository.js';
import { verifyService, type VerifySummary } from '../verify/runner.js';

export interface SubmitResult {
  service: ServiceRecord;
  created: boolean;
  verification?: VerifySummary;
}

/** Validate -> normalize -> upsert -> (optionally) verify. */
export async function submitService(
  input: ServiceSubmission | unknown,
  opts: { verify?: boolean; paid?: boolean } = {},
): Promise<SubmitResult> {
  const submission = parseSubmission(input);
  const record = normalizeSubmission(submission);
  const existed = !!getService(record.serviceId);
  const saved = upsertService(record);

  let verification: VerifySummary | undefined;
  if (opts.verify !== false) {
    verification = await verifyService(saved.serviceId, { paid: opts.paid });
  }
  const service = getService(saved.serviceId) ?? saved;
  return { service, created: !existed, verification };
}

export interface ServiceDetail {
  service: ServiceRecord;
  probeRuns: ProbeRun[];
  reviews: Review[];
}

export function getServiceDetail(serviceId: string): ServiceDetail | undefined {
  return getServiceWithHistory(serviceId);
}

export function reverify(serviceId: string, opts: { paid?: boolean } = {}): Promise<VerifySummary | undefined> {
  return verifyService(serviceId, { paid: opts.paid });
}

export function addServiceReview(input: {
  serviceId: string;
  rating: number;
  comment?: string | null;
  author?: string | null;
}): Review | undefined {
  if (!getService(input.serviceId)) return undefined;
  return addReview(input);
}

export function removeService(serviceId: string): boolean {
  if (!getService(serviceId)) return false;
  deleteService(serviceId);
  return true;
}

export { listServices, getService, getProbeRuns, getReviews };
