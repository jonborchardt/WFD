import { useCallback, useState } from "react";
import type { Selection } from "./duck";

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
  setGroup: (type: string, groupIdx: number, ids: Set<string>) => void;
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

  const setGroup = useCallback(
    (type: string, groupIdx: number, ids: Set<string>) => {
      setState((s) => {
        const i = findType(s, type);
        if (i < 0) return s;
        const groups = cloneGroups(s[i].groups);
        while (groups.length <= groupIdx) groups.push(new Set<string>());
        groups[groupIdx] = new Set(ids);
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
    },
    [],
  );

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

  return { selection: state, ensureType, toggle, setGroup, clearGroup, removeGroup, clearAll };
}
