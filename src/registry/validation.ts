// =============================================================================
// Submission validation (zod). Shared by the HTTP API, MCP tools, and CLI so a
// listing is validated identically no matter how it enters the registry.
// =============================================================================

import { z } from 'zod';
import type { ServiceSubmission } from '../types.js';

const httpUrl = (label: string, max = 2048) =>
  z
    .string()
    .max(max)
    .url(`${label} must be a valid URL`)
    .refine(
      (u) => {
        try {
          return ['http:', 'https:'].includes(new URL(u).protocol);
        } catch {
          return false;
        }
      },
      `${label} must use http(s)`,
    );

export const submissionSchema = z.object({
  resourceUrl: httpUrl('resourceUrl'),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  exampleRequest: z.unknown().optional(),
  exampleResponse: z.unknown().optional(),
  paymentScheme: z.enum(['exact', 'upto', 'unknown']).optional(),
  paymentNetworks: z.array(z.string().max(120)).max(20).optional(),
  priceAtomic: z.string().max(40).optional(),
  priceDisplay: z.string().max(80).optional(),
  token: z.string().max(120).optional(),
  payTo: z.string().max(200).optional(),
  facilitator: httpUrl('facilitator', 300).optional(),
  adapterType: z
    .enum([
      'x402-algorand',
      'x402-evm',
      'x402-cdp',
      'x402-solana',
      'x402-stellar',
      'x402-generic',
      'unknown',
    ])
    .optional(),
  submittedBy: z.string().max(200).optional(),
});

export type ParsedSubmission = z.infer<typeof submissionSchema>;

/** Validate and return a typed submission (throws ZodError on invalid input). */
export function parseSubmission(input: unknown): ServiceSubmission {
  return submissionSchema.parse(input) as ServiceSubmission;
}

/** Safe variant — returns either data or a flat list of error messages. */
export function safeParseSubmission(
  input: unknown,
): { ok: true; data: ServiceSubmission } | { ok: false; errors: string[] } {
  const r = submissionSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data as ServiceSubmission };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}
