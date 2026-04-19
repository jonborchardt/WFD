// Types local to the date-normalize stage. The per-video derived-dates
// file is written to data/date-normalize/<videoId>.json. It is a sidecar
// to data/entities/<videoId>.json — the entities file is never edited in
// place; the graph adapter merges this sidecar at graph-build time.

import type { EntityMention } from "../entities/types.js";

export interface PersistedDerivedDates {
  schemaVersion: 1;
  transcriptId: string;
  generatedAt: string; // ISO 8601
  sourceEntitiesGeneratedAt: string | null;
  mentions: EntityMention[]; // all carry derivedFrom pointing at a date_time mention id
}
