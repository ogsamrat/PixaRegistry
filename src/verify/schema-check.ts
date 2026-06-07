// =============================================================================
// Schema checks — does the API behave consistently with its declared interface?
//
// We deliberately implement a *minimal* JSON-Schema subset (type, required,
// properties) rather than pulling a full validator: the registry only needs a
// structural confidence signal, and being honest about that scope avoids
// overclaiming (see the spec's "honest positioning").
// =============================================================================

import type { Diagnostic, JsonSchema, ProbeResult, ServiceRecord } from '../types.js';

export interface SchemaMatch {
  ok: boolean;
  score: number; // 0..1
  issues: string[];
}

function jsTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Minimal structural check of a value against a JSON-Schema-ish object. */
export function matchesSchema(value: unknown, schema: JsonSchema | null | undefined): SchemaMatch {
  if (!schema || typeof schema !== 'object') {
    return { ok: true, score: 0, issues: ['no schema declared'] };
  }
  const issues: string[] = [];
  const expectedType = typeof schema.type === 'string' ? (schema.type as string) : undefined;

  if (expectedType) {
    const actual = jsTypeOf(value);
    const typeOk = expectedType === 'integer' ? actual === 'number' : actual === expectedType;
    if (!typeOk) {
      issues.push(`expected type ${expectedType}, got ${actual}`);
      return { ok: false, score: 0, issues };
    }
  }

  let checks = 0;
  let passed = 0;

  if (expectedType === 'object' || (value && typeof value === 'object' && !Array.isArray(value))) {
    const obj = (value ?? {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      checks++;
      if (obj[key] !== undefined) passed++;
      else issues.push(`missing required field "${key}"`);
    }
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      if (obj[key] === undefined) continue;
      const pType = typeof propSchema?.type === 'string' ? (propSchema.type as string) : undefined;
      if (!pType) continue;
      checks++;
      const actual = jsTypeOf(obj[key]);
      const ok = pType === 'integer' ? actual === 'number' : actual === pType;
      if (ok) passed++;
      else issues.push(`field "${key}" expected ${pType}, got ${actual}`);
    }
  }

  const score = checks === 0 ? (expectedType ? 1 : 0.5) : passed / checks;
  return { ok: issues.length === 0, score, issues };
}

/** Is a value a plausible JSON-Schema object? (object with type/properties) */
function looksLikeSchema(s: unknown): boolean {
  return !!s && typeof s === 'object' && !Array.isArray(s) && ('type' in s || 'properties' in s);
}

/**
 * Validate the *declared* metadata for structural completeness and internal
 * consistency (example matches its own declared output schema).
 */
export function validateDeclaredSchemas(service: ServiceRecord): ProbeResult {
  const diagnostics: Diagnostic[] = [];
  let completeness = 0;
  const parts = 3; // output schema, example response, input schema (POST-ish)

  // 1) output schema declared & valid
  if (service.outputSchema) {
    if (looksLikeSchema(service.outputSchema)) completeness += 1;
    else diagnostics.push({ code: 'schema_invalid', severity: 'warning', message: 'outputSchema is not a recognizable JSON Schema.' });
  } else {
    diagnostics.push({ code: 'schema_invalid', severity: 'info', message: 'No outputSchema declared — agents must guess the response shape.' });
  }

  // 2) example response present & matches declared output schema
  if (service.exampleResponse != null) {
    completeness += 1;
    if (service.outputSchema) {
      const m = matchesSchema(service.exampleResponse, service.outputSchema);
      if (!m.ok)
        diagnostics.push({ code: 'example_mismatch', severity: 'warning', message: `Example response does not match declared schema: ${m.issues.join('; ')}.` });
    }
  } else {
    diagnostics.push({ code: 'schema_invalid', severity: 'info', message: 'No exampleResponse declared.' });
  }

  // 3) input schema for body methods
  const needsInput = ['POST', 'PUT', 'PATCH'].includes(service.method);
  if (!needsInput) {
    completeness += 1; // not applicable counts as complete
  } else if (service.inputSchema && looksLikeSchema(service.inputSchema)) {
    completeness += 1;
  } else {
    diagnostics.push({ code: 'schema_invalid', severity: 'info', message: `${service.method} endpoint has no inputSchema — agents won't know the request body.` });
  }

  const score = completeness / parts;
  const ok = !diagnostics.some((d) => d.severity === 'warning');
  if (ok && diagnostics.length === 0) diagnostics.push({ code: 'ok', severity: 'info', message: 'Declared schemas are complete and self-consistent.' });

  return { kind: 'schema', ok, diagnostics, detail: { score, completeness, of: parts }, at: new Date().toISOString() };
}
