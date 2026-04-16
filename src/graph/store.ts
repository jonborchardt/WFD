// Graph store.
//
// Storage choice: relational-shaped JSON file keyed by id. sqlite would give
// us transactions and better concurrency, but the corpus size is small and
// zero-dependency startup matters more right now. The schema is explicit and
// versioned so a future migration to sqlite is a drop-in swap behind the
// GraphStore class interface.
//
// Invariant: every relationship insert fails if evidence is missing or does
// not reference a known transcript id. This mirrors the constructor-level
// check in src/nlp/relationships.ts.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  Entity,
  Relationship,
  RelationshipType,
  isValidRelationship,
} from "../shared/types.js";

interface GraphFile {
  version: number;
  entities: Record<string, Entity>;
  relationships: Record<string, Relationship>;
  // Set of known transcript ids (corresponds to catalog rows).
  transcripts: Record<string, true>;
}

export const GRAPH_SCHEMA_VERSION = 1;

const migrations: Array<(g: GraphFile) => GraphFile> = [
  (g) => ({
    version: 1,
    entities: g.entities ?? {},
    relationships: g.relationships ?? {},
    transcripts: g.transcripts ?? {},
  }),
];

function migrate(raw: unknown): GraphFile {
  const r = (raw ?? {}) as Partial<GraphFile>;
  let g: GraphFile = {
    version: Number(r.version ?? 0),
    entities: r.entities ?? {},
    relationships: r.relationships ?? {},
    transcripts: r.transcripts ?? {},
  };
  while (g.version < GRAPH_SCHEMA_VERSION) {
    g = migrations[g.version](g);
  }
  return g;
}

export class GraphStore {
  private data: GraphFile;

  constructor(private path: string) {
    this.data = existsSync(path)
      ? migrate(JSON.parse(readFileSync(path, "utf8")))
      : {
          version: GRAPH_SCHEMA_VERSION,
          entities: {},
          relationships: {},
          transcripts: {},
        };
  }

  static defaultPath(): string {
    return join(process.cwd(), "data", "graph", "graph.json");
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.path);
  }

  registerTranscript(transcriptId: string): void {
    if (!this.data.transcripts[transcriptId]) {
      this.data.transcripts[transcriptId] = true;
      this.persist();
    }
  }

  upsertEntity(entity: Entity): Entity {
    const existing = this.data.entities[entity.id];
    if (existing) {
      const mergedAliases = [
        ...new Set([...existing.aliases, ...entity.aliases]),
      ];
      existing.aliases = mergedAliases;
      existing.mentions = [...existing.mentions, ...entity.mentions];
      this.persist();
      return existing;
    }
    this.data.entities[entity.id] = entity;
    this.persist();
    return entity;
  }

  upsertRelationship(rel: Relationship): Relationship {
    if (!isValidRelationship(rel)) {
      throw new Error("graph: relationship failed shape validation");
    }
    if (!this.data.transcripts[rel.evidence.transcriptId]) {
      throw new Error(
        `graph: relationship evidence points at unknown transcript ${rel.evidence.transcriptId}`,
      );
    }
    const existing = this.data.relationships[rel.id];
    if (existing) {
      // Promote provenance if NLP already had it and AI just found it too.
      const mergedProv =
        existing.provenance !== rel.provenance ? "both" : existing.provenance;
      const merged: Relationship = {
        ...existing,
        confidence: Math.max(existing.confidence, rel.confidence),
        provenance: mergedProv,
      };
      this.data.relationships[rel.id] = merged;
      this.persist();
      return merged;
    }
    this.data.relationships[rel.id] = rel;
    this.persist();
    return rel;
  }

  getEntity(id: string): Entity | undefined {
    return this.data.entities[id];
  }

  getRelationship(id: string): Relationship | undefined {
    return this.data.relationships[id];
  }

  entities(): Entity[] {
    return Object.values(this.data.entities);
  }

  relationships(): Relationship[] {
    return Object.values(this.data.relationships);
  }

  byEntity(entityId: string): Relationship[] {
    return this.relationships().filter(
      (r) => r.subjectId === entityId || r.objectId === entityId,
    );
  }

  byPredicate(predicate: RelationshipType): Relationship[] {
    return this.relationships().filter((r) => r.predicate === predicate);
  }

  bySourceTranscript(transcriptId: string): Relationship[] {
    return this.relationships().filter(
      (r) => r.evidence.transcriptId === transcriptId,
    );
  }

  updateRelationship(id: string, patch: Partial<Relationship>): Relationship {
    const r = this.data.relationships[id];
    if (!r) throw new Error(`graph: no relationship ${id}`);
    const next = { ...r, ...patch };
    this.data.relationships[id] = next;
    this.persist();
    return next;
  }

  version(): number {
    return this.data.version;
  }
}
