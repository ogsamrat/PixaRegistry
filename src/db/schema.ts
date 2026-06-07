// =============================================================================
// Drizzle (SQLite) schema.
//
// JSON-shaped fields use Drizzle's json mode (stored as TEXT, auto (de)serialized).
// Booleans use integer mode (0/1). Timestamps are ISO strings in TEXT columns.
//
// `CREATE_TABLES_SQL` mirrors these definitions so the DB can be initialized with
// zero migration tooling (see db/client.ts). Keep the two in sync.
// =============================================================================

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import type {
  AdapterType,
  Diagnostic,
  JsonSchema,
  PaymentScheme,
  ServiceStatus,
  TrustScores,
  WalletCompatibility,
} from '../types.js';

export const services = sqliteTable('services', {
  serviceId: text('service_id').primaryKey(),
  resourceUrl: text('resource_url').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  method: text('method').notNull().default('GET'),
  inputSchema: text('input_schema', { mode: 'json' }).$type<JsonSchema>(),
  outputSchema: text('output_schema', { mode: 'json' }).$type<JsonSchema>(),
  exampleRequest: text('example_request', { mode: 'json' }).$type<unknown>(),
  exampleResponse: text('example_response', { mode: 'json' }).$type<unknown>(),

  paymentScheme: text('payment_scheme').$type<PaymentScheme>().notNull().default('unknown'),
  paymentNetworks: text('payment_networks', { mode: 'json' }).$type<string[]>().notNull().default([]),
  priceAtomic: text('price_atomic'),
  priceDisplay: text('price_display'),
  token: text('token'),
  payTo: text('pay_to'),
  facilitator: text('facilitator'),
  adapterType: text('adapter_type').$type<AdapterType>().notNull().default('unknown'),

  supportsTestnet: integer('supports_testnet', { mode: 'boolean' }).notNull().default(false),
  supportsMainnet: integer('supports_mainnet', { mode: 'boolean' }).notNull().default(false),
  walletCompatibility: text('wallet_compatibility')
    .$type<WalletCompatibility>()
    .notNull()
    .default('unsupported'),

  status: text('status').$type<ServiceStatus>().notNull().default('pending'),
  submittedBy: text('submitted_by'),

  lastUnpaidCheckAt: text('last_unpaid_check_at'),
  lastPaidCheckAt: text('last_paid_check_at'),
  lastSemanticCheckAt: text('last_semantic_check_at'),
  lastSemanticCheckResult: text('last_semantic_check_result'),

  scores: text('scores', { mode: 'json' }).$type<TrustScores>().notNull(),

  ratingAverage: real('rating_average'),
  ratingCount: integer('rating_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  qualityNotes: text('quality_notes'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const probeRuns = sqliteTable('probe_runs', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  diagnostics: text('diagnostics', { mode: 'json' }).$type<Diagnostic[]>().notNull().default([]),
  detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
});

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  author: text('author'),
  createdAt: text('created_at').notNull(),
});

export type ServiceRow = typeof services.$inferSelect;
export type ServiceInsert = typeof services.$inferInsert;
export type ProbeRunRow = typeof probeRuns.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;

// Idempotent DDL — mirrors the tables above.
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS services (
  service_id TEXT PRIMARY KEY,
  resource_url TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  method TEXT NOT NULL DEFAULT 'GET',
  input_schema TEXT,
  output_schema TEXT,
  example_request TEXT,
  example_response TEXT,
  payment_scheme TEXT NOT NULL DEFAULT 'unknown',
  payment_networks TEXT NOT NULL DEFAULT '[]',
  price_atomic TEXT,
  price_display TEXT,
  token TEXT,
  pay_to TEXT,
  facilitator TEXT,
  adapter_type TEXT NOT NULL DEFAULT 'unknown',
  supports_testnet INTEGER NOT NULL DEFAULT 0,
  supports_mainnet INTEGER NOT NULL DEFAULT 0,
  wallet_compatibility TEXT NOT NULL DEFAULT 'unsupported',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by TEXT,
  last_unpaid_check_at TEXT,
  last_paid_check_at TEXT,
  last_semantic_check_at TEXT,
  last_semantic_check_result TEXT,
  scores TEXT NOT NULL,
  rating_average REAL,
  rating_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  quality_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_updated ON services(updated_at);

CREATE TABLE IF NOT EXISTS probe_runs (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER,
  diagnostics TEXT NOT NULL DEFAULT '[]',
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_probe_runs_service ON probe_runs(service_id, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  author TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_service ON reviews(service_id);
`;
