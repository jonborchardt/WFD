// Local types for the new neural entities pipeline.
//
// Kept self-contained on purpose: this module deliberately does not reuse
// the `Entity` union in src/shared/types.ts because that union is frozen at
// five legacy classes (person/organization/location/time/misc) and the
// whole point of the refactor is a wider, configurable label set.
//
// With src/nlp/ retired, the shared type union now co-exists alongside
// EntityLabel below — a future merge can broaden it to match, but the
// two worlds have coexisted without issue since the neural migration.

// The 14 labels we pass to GLiNER at inference time. Keep in sync with
// config/entity-labels.json — the JSON file is authoritative at runtime,
// this union exists for compile-time narrowing.
export type EntityLabel =
  | "person"
  | "organization"
  | "group_or_movement"
  | "location"
  | "facility"
  | "event"
  | "date_time"
  | "role"
  | "technology"
  | "work_of_media"
  | "law_or_policy"
  | "ideology"
  | "nationality_or_ethnicity"
  | "quantity"
  | "time_of_day"
  | "specific_date_time"
  | "specific_week"
  | "specific_month"
  | "year"
  | "decade";

// Transcript shape we consume. Matches src/nlp/entities.ts Transcript
// structurally so callers can pass either interchangeably during the
// parallel-output phase.
export interface TranscriptCue {
  start: number;
  duration: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  language?: string;
  kind?: "auto" | "manual";
  cues: TranscriptCue[];
}

// A character-offset span inside the flattened transcript text, plus the
// cue-time window that encloses it. Mirrors src/shared/types.ts
// TranscriptSpan so downstream code sees a compatible shape.
export interface EntitySpan {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
}

// One mention produced by GLiNER, after canonicalization.
export interface EntityMention {
  id: string;               // stable within a transcript: "m_0001"
  label: EntityLabel;
  surface: string;          // exact substring of the flattened text
  canonical: string;        // chosen canonical form within this transcript
  span: EntitySpan;
  score: number;            // GLiNER confidence, 0..1
  // Set only for mentions produced by the date-normalize stage. Points
  // at the source date_time mention id (e.g. "m_0012"). GLiNER output
  // never sets this field.
  derivedFrom?: string;
}

// The on-disk format written to data/entities/<videoId>.json.
export interface PersistedEntities {
  schemaVersion: 1;
  transcriptId: string;
  model: string;
  modelVersion: string | null;
  labelsUsed: EntityLabel[];
  corefApplied: boolean;
  generatedAt: string;       // ISO 8601
  mentions: EntityMention[];
}

// What GLiNER (or a test fake) returns per chunk, before canonicalization.
// `start`/`end` are char offsets inside the chunk text, not the full
// transcript — the wrapper rebases them to transcript coordinates.
export interface GlinerRawMention {
  label: string;
  start: number;
  end: number;
  score: number;
  text: string;
}
