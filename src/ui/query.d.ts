import type { CatalogRow as CR } from "../catalog/catalog.js";
import type { EntityIndexEntry as EIE, EntityVideosIndex } from "../nlp/persist.js";

export type CatalogRow = CR;
export type EntityIndexEntry = EIE;

export interface ListQuery {
  channel?: string;
  status?: string;
  notStatus?: string;
  text?: string;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  total: number;
  page: number;
  pageSize: number;
  rows: CatalogRow[];
}

export function matchesBase(row: CatalogRow, q: ListQuery): boolean;
export function matchesText(row: CatalogRow, needleLower: string): boolean;
export function filterRows(rows: CatalogRow[], q: ListQuery): CatalogRow[];
export function augmentWithEntityMatches(
  into: CatalogRow[],
  allRows: CatalogRow[],
  q: ListQuery,
  entityIndex: EntityIndexEntry[],
  entityVideos: EntityVideosIndex,
): CatalogRow[];
export function sortByPublishAsc(rows: CatalogRow[]): CatalogRow[];
export function paginate(rows: CatalogRow[], q: ListQuery): ListResult;
export function searchEntityIndex(
  index: EntityIndexEntry[],
  opts: { q?: string; type?: string; limit?: number },
): EntityIndexEntry[];
