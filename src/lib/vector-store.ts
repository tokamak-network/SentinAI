/**
 * Vector Store
 * Semantic search for incident history and RCA context.
 *
 * Production: Upstash Vector (REST API, Redis-compatible)
 * Fallback: In-memory cosine similarity (no external deps)
 *
 * Env: VECTOR_DB_URL, VECTOR_DB_TOKEN
 */

import { createLogger } from '@/lib/logger'

const logger = createLogger('vector-store')

export interface VectorDocument {
  id: string
  text: string
  embedding?: number[]  // pre-computed embedding (optional)
  metadata: {
    type: 'incident' | 'rca' | 'anomaly' | 'resolution'
    instanceId?: string
    timestamp: string
    severity?: string
    [key: string]: unknown
  }
}

export interface SearchResult {
  id: string
  score: number  // 0-1 cosine similarity
  text: string
  metadata: VectorDocument['metadata']
}

export interface VectorStore {
  /** Upsert a document (creates embedding if not provided) */
  upsert(doc: VectorDocument): Promise<void>
  /** Semantic search by query text */
  search(query: string, topK?: number): Promise<SearchResult[]>
  /** Delete a document by ID */
  delete(id: string): Promise<void>
  /** Get total document count */
  count(): Promise<number>
}

// ---------------------------------------------------------------------------
// Bag-of-words helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
}

function buildVocab(docs: Iterable<{ text: string }>): string[] {
  const set = new Set<string>()
  for (const doc of docs) {
    for (const token of tokenize(doc.text)) {
      set.add(token)
    }
  }
  return Array.from(set)
}

function textToVector(text: string, vocab: string[]): number[] {
  const tokens = tokenize(text)
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const vec = vocab.map(w => counts.get(w) ?? 0)
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  return norm > 0 ? vec.map(v => v / norm) : vec
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0)
  const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
  const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
  return normA > 0 && normB > 0 ? dot / (normA * normB) : 0
}

// ---------------------------------------------------------------------------
// InMemoryVectorStore
// ---------------------------------------------------------------------------

type StoredDocument = VectorDocument & { embedding: number[] }

// globalThis singleton key
const SINGLETON_KEY = '__sentinai_vector_store'

class InMemoryVectorStore implements VectorStore {
  private docs: Map<string, StoredDocument>

  constructor(docs: Map<string, StoredDocument>) {
    this.docs = docs
  }

  private getVocab(): string[] {
    return buildVocab(this.docs.values())
  }

  async upsert(doc: VectorDocument): Promise<void> {
    // Rebuild vocab including this new document
    const allDocs = Array.from(this.docs.values())
    allDocs.push({ ...doc, embedding: [] })
    const vocab = buildVocab(allDocs)

    // Re-embed existing documents with updated vocab
    for (const [id, stored] of this.docs.entries()) {
      this.docs.set(id, { ...stored, embedding: textToVector(stored.text, vocab) })
    }

    const embedding = doc.embedding ?? textToVector(doc.text, vocab)
    this.docs.set(doc.id, { ...doc, embedding })
    logger.debug(`[InMemoryVectorStore] upserted id=${doc.id}, total=${this.docs.size}`)
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    if (this.docs.size === 0) return []

    const vocab = this.getVocab()
    const queryVec = textToVector(query, vocab)

    const results: SearchResult[] = []
    for (const stored of this.docs.values()) {
      // Align embedding length with current vocab
      const docVec = stored.embedding.length === vocab.length
        ? stored.embedding
        : textToVector(stored.text, vocab)

      const score = cosineSimilarity(queryVec, docVec)
      results.push({ id: stored.id, score, text: stored.text, metadata: stored.metadata })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async delete(id: string): Promise<void> {
    this.docs.delete(id)
    logger.debug(`[InMemoryVectorStore] deleted id=${id}`)
  }

  async count(): Promise<number> {
    return this.docs.size
  }
}

function getInMemoryStore(): InMemoryVectorStore {
  const g = globalThis as Record<string, unknown>
  if (!g[SINGLETON_KEY]) {
    g[SINGLETON_KEY] = {
      _store: new InMemoryVectorStore(new Map()),
      _docs: new Map<string, StoredDocument>(),
    }
  }
  const singleton = g[SINGLETON_KEY] as { _store: InMemoryVectorStore; _docs: Map<string, StoredDocument> }
  return singleton._store
}

// ---------------------------------------------------------------------------
// UpstashVectorStore
// ---------------------------------------------------------------------------

interface UpstashUpsertPayload {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
  data?: string
}

interface UpstashQueryPayload {
  vector: number[]
  topK: number
  includeMetadata: boolean
  includeData: boolean
}

interface UpstashQueryResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
  data?: string
}

class UpstashVectorStore implements VectorStore {
  private readonly url: string
  private readonly token: string

  // Local vocab for embedding generation (no external embedding model)
  private localVocab: string[] = []

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '')
    this.token = token
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
  }

  private buildEmbedding(text: string): number[] {
    return textToVector(text, this.localVocab)
  }

  private updateLocalVocab(text: string): void {
    const tokens = tokenize(text)
    const vocabSet = new Set(this.localVocab)
    for (const t of tokens) vocabSet.add(t)
    this.localVocab = Array.from(vocabSet)
  }

  async upsert(doc: VectorDocument): Promise<void> {
    this.updateLocalVocab(doc.text)
    const vector = doc.embedding ?? this.buildEmbedding(doc.text)

    const payload: UpstashUpsertPayload = {
      id: doc.id,
      vector,
      metadata: doc.metadata as Record<string, unknown>,
      data: doc.text,
    }

    try {
      const res = await fetch(`${this.url}/upsert`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        logger.warn(`[UpstashVectorStore] upsert failed: ${res.status} ${body}`)
      } else {
        logger.debug(`[UpstashVectorStore] upserted id=${doc.id}`)
      }
    } catch (err) {
      logger.error('[UpstashVectorStore] upsert error:', err)
    }
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    this.updateLocalVocab(query)
    const vector = this.buildEmbedding(query)

    const payload: UpstashQueryPayload = {
      vector,
      topK,
      includeMetadata: true,
      includeData: true,
    }

    try {
      const res = await fetch(`${this.url}/query`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        logger.warn(`[UpstashVectorStore] search failed: ${res.status} ${body}`)
        return []
      }

      const json = (await res.json()) as { result?: UpstashQueryResult[] }
      const raw = json.result ?? []

      return raw.map((r) => ({
        id: String(r.id),
        score: r.score ?? 0,
        text: r.data ?? '',
        metadata: (r.metadata ?? {}) as VectorDocument['metadata'],
      }))
    } catch (err) {
      logger.error('[UpstashVectorStore] search error:', err)
      return []
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.url}/delete`, {
        method: 'DELETE',
        headers: this.headers(),
        body: JSON.stringify({ ids: [id] }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        logger.warn(`[UpstashVectorStore] delete failed: ${res.status} ${body}`)
      } else {
        logger.debug(`[UpstashVectorStore] deleted id=${id}`)
      }
    } catch (err) {
      logger.error('[UpstashVectorStore] delete error:', err)
    }
  }

  async count(): Promise<number> {
    try {
      const res = await fetch(`${this.url}/info`, {
        method: 'GET',
        headers: this.headers(),
      })
      if (!res.ok) return 0
      const json = (await res.json()) as { vectorCount?: number }
      return json.vectorCount ?? 0
    } catch {
      return 0
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getVectorStore(): VectorStore {
  const url = process.env.VECTOR_DB_URL
  const token = process.env.VECTOR_DB_TOKEN ?? ''

  if (url) {
    return new UpstashVectorStore(url, token)
  }

  return getInMemoryStore()
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export async function upsertEmbedding(
  id: string,
  text: string,
  metadata: VectorDocument['metadata'],
): Promise<void> {
  await getVectorStore().upsert({ id, text, metadata })
}

export async function semanticSearch(query: string, topK = 5): Promise<SearchResult[]> {
  return getVectorStore().search(query, topK)
}
