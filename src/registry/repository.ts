// =============================================================================
// Repository — all reads/writes for services, probe runs, and reviews.
// Drizzle's json/boolean column modes mean rows come back already deserialized,
// so mapping to domain types is mostly a 1:1 pass-through.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { probeRuns, reviews, services, type ProbeRunRow } from '../db/schema.js';
import type {
  ProbeResult,
  ProbeRun,
  Review,
  ServiceRecord,
  ServiceStatus,
  TrustScores,
} from '../types.js';

function rowToProbeRun(row: ProbeRunRow): ProbeRun {
  return {
    id: row.id,
    serviceId: row.serviceId,
    kind: row.kind as ProbeRun['kind'],
    ok: row.ok,
    statusCode: row.statusCode ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    diagnostics: row.diagnostics ?? [],
    detail: row.detail ?? undefined,
    at: row.createdAt,
  };
}

// ── services ─────────────────────────────────────────────────────────────────

/**
 * Insert or update a service by its deterministic id.
 *
 * On re-submission we update the builder-declared metadata but PRESERVE the
 * registry-owned verification state (status, scores, check timestamps, review
 * aggregates) — re-listing an endpoint must not silently wipe its trust history.
 */
export function upsertService(record: ServiceRecord): ServiceRecord {
  const db = getDb();
  const existing = getService(record.serviceId);
  const toWrite: ServiceRecord = existing
    ? {
        ...record,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        status: existing.status,
        scores: existing.scores,
        ratingAverage: existing.ratingAverage,
        ratingCount: existing.ratingCount,
        reviewCount: existing.reviewCount,
        lastUnpaidCheckAt: existing.lastUnpaidCheckAt,
        lastPaidCheckAt: existing.lastPaidCheckAt,
        lastSemanticCheckAt: existing.lastSemanticCheckAt,
        lastSemanticCheckResult: existing.lastSemanticCheckResult,
        qualityNotes: existing.qualityNotes,
      }
    : record;

  const { serviceId, createdAt, ...mutable } = toWrite;
  void serviceId;
  void createdAt;
  db.insert(services)
    .values(toWrite)
    .onConflictDoUpdate({ target: services.serviceId, set: mutable })
    .run();
  return toWrite;
}

export function getService(serviceId: string): ServiceRecord | undefined {
  const db = getDb();
  const row = db.select().from(services).where(eq(services.serviceId, serviceId)).get();
  return row ?? undefined;
}

export function listServices(): ServiceRecord[] {
  const db = getDb();
  return db.select().from(services).orderBy(desc(services.updatedAt)).all();
}

export function deleteService(serviceId: string): void {
  const db = getDb();
  db.delete(services).where(eq(services.serviceId, serviceId)).run();
  db.delete(probeRuns).where(eq(probeRuns.serviceId, serviceId)).run();
  db.delete(reviews).where(eq(reviews.serviceId, serviceId)).run();
}

/** Apply a verification update: new scores, status, and check timestamps. */
export function updateServiceVerification(
  serviceId: string,
  patch: {
    scores?: TrustScores;
    status?: ServiceStatus;
    lastUnpaidCheckAt?: string | null;
    lastPaidCheckAt?: string | null;
    lastSemanticCheckAt?: string | null;
    lastSemanticCheckResult?: string | null;
    qualityNotes?: string | null;
  },
): void {
  const db = getDb();
  db.update(services)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(services.serviceId, serviceId))
    .run();
}

/** Apply payment metadata discovered from a live 402 challenge (blanks only). */
export function updateServicePayment(serviceId: string, patch: Partial<ServiceRecord>): void {
  const db = getDb();
  db.update(services)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(services.serviceId, serviceId))
    .run();
}

// ── probe runs ───────────────────────────────────────────────────────────────

export function recordProbeRun(serviceId: string, result: ProbeResult): ProbeRun {
  const db = getDb();
  const run: ProbeRun = { id: randomUUID(), serviceId, ...result };
  db.insert(probeRuns)
    .values({
      id: run.id,
      serviceId: run.serviceId,
      kind: run.kind,
      ok: run.ok,
      statusCode: run.statusCode ?? null,
      latencyMs: run.latencyMs ?? null,
      diagnostics: run.diagnostics,
      detail: run.detail ?? null,
      createdAt: run.at,
    })
    .run();
  return run;
}

export function getProbeRuns(serviceId: string, limit = 50): ProbeRun[] {
  const db = getDb();
  const rows = db
    .select()
    .from(probeRuns)
    .where(eq(probeRuns.serviceId, serviceId))
    .orderBy(desc(probeRuns.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToProbeRun);
}

// ── reviews ──────────────────────────────────────────────────────────────────

export function getReviews(serviceId: string): Review[] {
  const db = getDb();
  const rows = db
    .select()
    .from(reviews)
    .where(eq(reviews.serviceId, serviceId))
    .orderBy(desc(reviews.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    serviceId: r.serviceId,
    rating: r.rating,
    comment: r.comment ?? null,
    author: r.author ?? null,
    createdAt: r.createdAt,
  }));
}

/** Add a review and refresh the service's rating aggregates. */
export function addReview(input: {
  serviceId: string;
  rating: number;
  comment?: string | null;
  author?: string | null;
}): Review {
  const db = getDb();
  const review: Review = {
    id: randomUUID(),
    serviceId: input.serviceId,
    rating: Math.max(1, Math.min(5, Math.round(input.rating))),
    comment: input.comment ?? null,
    author: input.author ?? null,
    createdAt: new Date().toISOString(),
  };
  db.insert(reviews).values(review).run();

  const all = getReviews(input.serviceId);
  const count = all.length;
  const avg = count ? all.reduce((s, r) => s + r.rating, 0) / count : null;
  db.update(services)
    .set({ ratingAverage: avg, ratingCount: count, reviewCount: count, updatedAt: new Date().toISOString() })
    .where(eq(services.serviceId, input.serviceId))
    .run();

  return review;
}

// ── convenience ──────────────────────────────────────────────────────────────

export function listServicesByStatus(status: ServiceStatus): ServiceRecord[] {
  const db = getDb();
  return db.select().from(services).where(eq(services.status, status)).all();
}

export function countServices(): number {
  return listServices().length;
}

// re-export for callers that want both a service and its filtered probes
export function getServiceWithHistory(serviceId: string):
  | { service: ServiceRecord; probeRuns: ProbeRun[]; reviews: Review[] }
  | undefined {
  const service = getService(serviceId);
  if (!service) return undefined;
  return { service, probeRuns: getProbeRuns(serviceId), reviews: getReviews(serviceId) };
}
