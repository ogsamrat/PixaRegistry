// =============================================================================
// Domain validators — category-specific correctness checks.
//
// These are OPTIONAL and only exist for categories where "good output" has a
// recognizable minimum shape. They never claim semantic excellence (that's the
// reviews / optional LLM layer); they only check category expectations are met.
// =============================================================================

export interface DomainValidation {
  ok: boolean;
  score: number; // 0..1
  notes: string;
}

type Validator = (body: unknown) => DomainValidation;

function asObj(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Does the object (deeply, shallowly) contain any of these keys (case-insensitive)? */
function hasAnyKey(obj: Record<string, unknown>, keys: string[]): boolean {
  const lower = new Set(Object.keys(obj).map((k) => k.toLowerCase()));
  return keys.some((k) => lower.has(k.toLowerCase()));
}

function score(parts: boolean[]): number {
  if (parts.length === 0) return 0;
  return parts.filter(Boolean).length / parts.length;
}

const weather: Validator = (body) => {
  const o = asObj(body);
  if (!o) return { ok: false, score: 0, notes: 'response is not a JSON object' };
  const parts = [
    hasAnyKey(o, ['temperature', 'temp', 'temp_c', 'tempC', 'main']),
    hasAnyKey(o, ['condition', 'weather', 'conditions', 'description']),
    hasAnyKey(o, ['location', 'city', 'place', 'coord', 'name']),
  ];
  const s = score(parts);
  return { ok: s >= 0.6, score: s, notes: `weather fields present: ${Math.round(s * 100)}%` };
};

const image: Validator = (body) => {
  const o = asObj(body);
  if (!o) {
    // a raw string URL or base64 also counts
    if (typeof body === 'string' && /^data:image\/|^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)/i.test(body))
      return { ok: true, score: 1, notes: 'image URL / data URI' };
    return { ok: false, score: 0, notes: 'no image url/bytes found' };
  }
  const parts = [
    hasAnyKey(o, ['url', 'imageUrl', 'image_url', 'image', 'b64_json', 'b64', 'data']),
  ];
  const s = score(parts);
  return { ok: s >= 1, score: s, notes: s ? 'image reference present' : 'no image reference' };
};

const otp: Validator = (body) => {
  const o = asObj(body);
  if (!o) return { ok: false, score: 0, notes: 'response is not a JSON object' };
  const parts = [
    hasAnyKey(o, ['otp', 'code', 'pin', 'token']),
    hasAnyKey(o, ['delivered', 'status', 'channel', 'to', 'phone', 'email', 'expires', 'expiresAt', 'ttl']),
  ];
  const s = score(parts);
  return { ok: parts[0] === true, score: s, notes: `otp fields present: ${Math.round(s * 100)}%` };
};

const company: Validator = (body) => {
  const o = asObj(body);
  if (!o) return { ok: false, score: 0, notes: 'response is not a JSON object' };
  const parts = [
    hasAnyKey(o, ['name', 'companyName', 'legalName', 'company']),
    hasAnyKey(o, ['domain', 'website', 'url', 'industry', 'sector', 'companyId', 'duns', 'ticker']),
  ];
  const s = score(parts);
  return { ok: parts[0] === true, score: s, notes: `company fields present: ${Math.round(s * 100)}%` };
};

const VALIDATORS: Record<string, Validator> = {
  weather: weather,
  image: image,
  'image-generation': image,
  otp: otp,
  company: company,
  'company-lookup': company,
};

const ALIASES: Record<string, string> = {
  forecast: 'weather',
  images: 'image',
  imagegen: 'image-generation',
  '2fa': 'otp',
  verification: 'otp',
  companies: 'company',
  'company lookup': 'company-lookup',
  enrichment: 'company-lookup',
};

export function hasDomainValidator(category: string | null | undefined): boolean {
  return !!getValidatorKey(category);
}

function getValidatorKey(category: string | null | undefined): string | null {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  if (VALIDATORS[c]) return c;
  if (ALIASES[c] && VALIDATORS[ALIASES[c]]) return ALIASES[c];
  return null;
}

/** Run the category validator for a fetched response body, if one exists. */
export function runDomainValidation(category: string | null | undefined, body: unknown): DomainValidation | null {
  const key = getValidatorKey(category);
  if (!key) return null;
  return VALIDATORS[key](body);
}

export function listValidatedCategories(): string[] {
  return Object.keys(VALIDATORS);
}
