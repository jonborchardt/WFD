// Selection state for the facets page.
//
// Shape: Selection = SelectionEntry[], one per entity type in first-touch
// order. Each entry has `groups: Set<entityId>[]` — every group is a facet
// slot rendered in the UI.
//
// Invariants:
//   - A type entry always has ≥1 group (the primary facet).
//   - A new empty group spawns when the previous group gets its first click
//     (that's how the coref facet appears).
//   - Selections are OR within a group, AND across groups of the same type,
//     AND across types. See duck.ts::activeVideoIds.

import { useCallback, useState } from "react";
import type { Selection } from "./duck.js";

function cloneGroups(groups: Set<string>[]): Set<string>[] {
  return groups.map((g) => new Set(g));
}

function findType(state: Selection, type: string): number {
  return state.findIndex((e) => e.type === type);
}

export interface SelectionApi {
  selection: Selection;
  ensureType: (type: string) => void;
  toggle: (type: string, groupIdx: number, entityId: string) => void;
  clearGroup: (type: string, groupIdx: number) => void;
  removeGroup: (type: string, groupIdx: number) => void;
  clearAll: () => void;
}

export function useSelectionState(): SelectionApi {
  const [state, setState] = useState<Selection>([]);

  const ensureType = useCallback((type: string) => {
    setState((s) => {
      if (findType(s, type) >= 0) return s;
      return [...s, { type, groups: [new Set<string>()] }];
    });
  }, []);

  const toggle = useCallback((type: string, groupIdx: number, entityId: string) => {
    setState((s) => {
      const i = findType(s, type);
      if (i < 0) return s;
      const entry = s[i];
      const groups = cloneGroups(entry.groups);
      const g = groups[groupIdx];
      if (!g) return s;
      if (g.has(entityId)) g.delete(entityId);
      else g.add(entityId);
      if (groupIdx === groups.length - 1 && g.size > 0) {
        groups.push(new Set<string>());
      }
      while (
        groups.length > 1 &&
        groups[groups.length - 1].size === 0 &&
        groups[groups.length - 2].size === 0
      ) {
        groups.pop();
      }
      const next = [...s];
      next[i] = { type, groups };
      return next;
    });
  }, []);

  const clearGroup = useCallback((type: string, groupIdx: number) => {
    setState((s) => {
      const i = findType(s, type);
      if (i < 0) return s;
      const groups = cloneGroups(s[i].groups);
      if (!groups[groupIdx]) return s;
      groups[groupIdx] = new Set<string>();
      const next = [...s];
      next[i] = { type, groups };
      return next;
    });
  }, []);

  const removeGroup = useCallback((type: string, groupIdx: number) => {
    setState((s) => {
      const i = findType(s, type);
      if (i < 0) return s;
      const groups = cloneGroups(s[i].groups);
      if (groups.length <= 1) {
        groups[0] = new Set<string>();
      } else {
        groups.splice(groupIdx, 1);
      }
      const next = [...s];
      next[i] = { type, groups };
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setState([]), []);

  return { selection: state, ensureType, toggle, clearGroup, removeGroup, clearAll };
}
