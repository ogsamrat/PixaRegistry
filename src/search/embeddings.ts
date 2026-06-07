// =============================================================================
// Embeddings seam.
//
// The MVP ships lexical/hybrid search (see search.ts). This module is the clean
// interface where real embeddings (OpenAI, a local transformers.js model, or
// Postgres + pgvector) plug in later WITHOUT changing call sites: register an
// Embedder and the search layer can blend vector similarity into ranking.
// =============================================================================

export interface Embedder {
  readonly id: string;
  /** Return one vector per input text. */
  embed(texts: string[]): Promise<number[][]>;
}

let _embedder: Embedder | null = null;

export function registerEmbedder(embedder: Embedder | null): void {
  _embedder = embedder;
}

export function getEmbedder(): Embedder | null {
  return _embedder;
}

export function hasEmbedder(): boolean {
  return _embedder !== null;
}

/** Cosine similarity for future vector ranking. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
