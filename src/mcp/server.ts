// =============================================================================
// MCP server (stdio) — the agent-native delivery surface.
//
// Exposes the registry as MCP tools so a Claude-like agent can discover, inspect,
// test, and submit machine-payable APIs directly. Runs in-process against the
// same SQLite DB used by the HTTP API and CLI.
//
// IMPORTANT: stdout is the MCP transport — never console.log here. Logs go to
// stderr via console.error.
// =============================================================================

import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { listNetworks } from '../config/networks.js';
import {
  getServiceDetail,
  reverify,
  submitService,
} from '../registry/service.js';
import { search } from '../search/search.js';

function jsonContent(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorContent(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const filterShape = {
  network: z.string().optional().describe('Network slug or CAIP-2 id, e.g. "algorand-testnet", "base"'),
  family: z.enum(['algorand', 'evm', 'solana', 'stellar', 'other']).optional(),
  scheme: z.enum(['exact', 'upto', 'unknown']).optional(),
  testnet: z.boolean().optional(),
  mainnet: z.boolean().optional(),
  category: z.string().optional(),
  walletCompatibility: z
    .enum(['directly-payable', 'hub-payable', 'cdp-only', 'algorand-native', 'unsupported'])
    .optional(),
  minTrust: z.enum(['verified', 'community', 'experimental', 'flaky', 'unverified', 'broken']).optional(),
  includeBroken: z.boolean().optional(),
};

export function buildServer(): McpServer {
  getDb(); // ensure tables exist

  const server = new McpServer({ name: 'pixa-registry', version: '0.1.0' });

  server.registerTool(
    'search_registry',
    {
      title: 'Search the PIXA registry',
      description:
        'Find machine-payable APIs by meaning + structured filters. Returns ranked, agent-ready result cards (endpoint, method, price, networks, wallet compatibility, trust). Use this first to discover services.',
      inputSchema: {
        q: z.string().optional().describe('Natural-language query, e.g. "real-time product hunt upvotes"'),
        limit: z.number().int().min(1).max(50).optional(),
        ...filterShape,
      },
    },
    async (args) => {
      const { q, limit, ...filters } = args;
      const results = search({ q, limit, filters });
      return jsonContent({ query: q ?? null, count: results.length, results });
    },
  );

  server.registerTool(
    'inspect_service',
    {
      title: 'Inspect a service',
      description:
        'Get full detail for one listing: declared metadata, request/response schemas, examples, trust scores, recent probe history, and reviews.',
      inputSchema: { serviceId: z.string().describe('The service id from a search result card') },
    },
    async ({ serviceId }) => {
      const detail = getServiceDetail(serviceId);
      if (!detail) return errorContent(`No service found with id "${serviceId}".`);
      return jsonContent(detail);
    },
  );

  server.registerTool(
    'test_service',
    {
      title: 'Verify a service live',
      description:
        'Run a live verification pass (reachability, 402/payment-gating, declared-schema consistency, optional paid probe) and return the updated trust report and diagnostics.',
      inputSchema: {
        serviceId: z.string(),
        paid: z.boolean().optional().describe('Attempt a real paid probe (requires a configured buyer; otherwise skipped).'),
      },
    },
    async ({ serviceId, paid }) => {
      const summary = await reverify(serviceId, { paid: paid ?? false });
      if (!summary) return errorContent(`No service found with id "${serviceId}".`);
      return jsonContent({ serviceId, status: summary.status, scores: summary.scores, warnings: summary.warnings, probes: summary.probes });
    },
  );

  server.registerTool(
    'list_supported_networks',
    {
      title: 'List supported networks',
      description: 'List the chains/payment rails PIXA understands, including wallet/hub/CDP payability flags.',
      inputSchema: {},
    },
    async () => jsonContent({ networks: listNetworks() }),
  );

  server.registerTool(
    'submit_service',
    {
      title: 'Submit a service',
      description:
        'List a new machine-payable API. Validates, normalizes, stores, and immediately verifies it. Returns the stored record and verification report.',
      inputSchema: {
        resourceUrl: z.string().url(),
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
        inputSchema: z.record(z.unknown()).optional().describe('JSON Schema of the request body'),
        outputSchema: z.record(z.unknown()).optional().describe('JSON Schema of the response'),
        exampleRequest: z.unknown().optional(),
        exampleResponse: z.unknown().optional(),
        paymentScheme: z.enum(['exact', 'upto', 'unknown']).optional(),
        paymentNetworks: z.array(z.string()).optional(),
        priceAtomic: z.string().optional(),
        priceDisplay: z.string().optional(),
        token: z.string().optional(),
        payTo: z.string().optional(),
        facilitator: z.string().url().optional(),
        verify: z.boolean().optional(),
      },
    },
    async (args) => {
      const { verify, ...submission } = args;
      try {
        const result = await submitService(submission, { verify: verify !== false });
        return jsonContent({
          created: result.created,
          service: result.service,
          verification: result.verification
            ? { status: result.verification.status, scores: result.verification.scores, warnings: result.verification.warnings }
            : null,
        });
      } catch (err) {
        return errorContent(`Submission failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  return server;
}

export async function startMcp(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[pixa-registry] MCP server ready on stdio.');
}

// Auto-start only when run directly (so buildServer/startMcp stay importable
// without hijacking stdio).
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  startMcp().catch((err) => {
    console.error('[pixa-registry] MCP server failed:', err);
    process.exit(1);
  });
}
