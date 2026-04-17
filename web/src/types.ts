// Types for the static public site.

export interface VideoRow {
  videoId: string;
  title?: string;
  channel?: string;
  channelId?: string;
  description?: string;
  publishDate?: string;
  uploadDate?: string;
  category?: string;
  status?: string;
  sourceUrl?: string;
  transcriptPath?: string;
  thumbnailUrl?: string;
  lengthSeconds?: number;
  viewCount?: number;
  isLiveContent?: boolean;
  errorReason?: string;
  lastError?: string;
  keywords?: string[];
  stages?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface EntityIndexEntry {
  id: string;
  type: string;
  canonical: string;
  videoCount: number;
  mentionCount: number;
}

export interface TranscriptSpan {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
}

export interface EntityVideosIndex {
  [entityId: string]: { videoId: string; mentions: TranscriptSpan[] }[];
}

export interface TranscriptCue {
  start: number;
  end?: number;
  text: string;
}

export interface Transcript {
  id: string;
  cues: TranscriptCue[];
}

// Per-video persisted entities (schemaVersion 1)
export interface PersistedMention {
  id: string;
  label: string;
  surface: string;
  canonical: string;
  span: TranscriptSpan;
  score: number;
}

export interface PersistedEntities {
  schemaVersion: number;
  transcriptId: string;
  model: string;
  mentions: PersistedMention[];
}

// Per-video persisted relations (schemaVersion 1)
export interface PersistedEdge {
  id: string;
  predicate: string;
  subjectMentionId: string;
  objectMentionId: string;
  score: number;
  evidence: TranscriptSpan;
}

export interface PersistedRelations {
  schemaVersion: number;
  transcriptId: string;
  model: string;
  edges: PersistedEdge[];
}

// Graph types
export interface GraphNode {
  id: string;
  type: string;
  canonical: string;
  weight: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  count: number;
}

// Adapted NLP for display
export interface DisplayEntity {
  id: string;
  type: string;
  canonical: string;
  mentions: TranscriptSpan[];
}

export interface DisplayRelationship {
  id: string;
  subjectId: string;
  objectId: string;
  predicate: string;
  confidence: number;
  evidence: TranscriptSpan;
}

export interface VideoNlp {
  entities: DisplayEntity[];
  relationships: DisplayRelationship[];
}

export interface CatalogColumn {
  key: string;
  label: string;
  menuLabel?: string;
  default: boolean;
  headSx?: Record<string, unknown>;
  cellSx?: Record<string, unknown>;
  render: (r: VideoRow) => React.ReactNode;
}
