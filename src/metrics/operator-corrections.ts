// Operator-corrections metrics (Plan 05). Surfaces how much manual
// triage has been layered on top of the automated pipeline. Growth in
// these signals usually means AI output needs tuning; zero growth
// over time means either the output is great OR operator is idle.

import { readAliasesFile } from "../graph/aliases-schema.js";
import type { Metric, MetricSection } from "./types.js";

export const operatorCorrectionsSection: MetricSection = {
  section: "operator-corrections",
  compute(dataDir: string): Metric[] {
    let aliases;
    try {
      aliases = readAliasesFile(dataDir);
    } catch {
      aliases = null;
    }
    const claimTruthOverrides = aliases?.claimTruthOverrides?.length ?? 0;
    const claimDeletions = aliases?.claimDeletions?.length ?? 0;
    const claimFieldOverrides = aliases?.claimFieldOverrides?.length ?? 0;
    const contradictionDismissals = aliases?.contradictionDismissals?.length ?? 0;
    const customContradictions = aliases?.customContradictions?.length ?? 0;
    const displayOverrides = aliases?.display?.length ?? 0;
    const notSamePairs = aliases?.notSame?.length ?? 0;
    const dismissedClusters = aliases?.dismissed?.length ?? 0;
    const deletedRelations = aliases?.deletedRelations?.length ?? 0;

    return [
      { section: "operator-corrections", name: "corrections.claimTruthOverrides",
        value: claimTruthOverrides, unit: "count",
        description: "operator-pinned directTruth values for individual claims",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.claimDeletions",
        value: claimDeletions, unit: "count",
        description: "claims the operator has dropped from the corpus view",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.claimFieldOverrides",
        value: claimFieldOverrides, unit: "count",
        description: "claims with operator-edited text / kind / stance / rationale",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.contradictionDismissals",
        value: contradictionDismissals, unit: "count",
        description: "operator-dismissed contradictions",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.customContradictions",
        value: customContradictions, unit: "count",
        description: "operator-authored contradictions",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.displayOverrides",
        value: displayOverrides, unit: "count",
        description: "render-only display overrides on entity keys",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.notSamePairs",
        value: notSamePairs, unit: "count",
        description: "asserted-distinct entity pairs (operator cluster review)",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.dismissedClusters",
        value: dismissedClusters, unit: "count",
        description: "operator-dismissed cluster-review proposals",
        source: "data/aliases.json" },
      { section: "operator-corrections", name: "corrections.deletedRelations",
        value: deletedRelations, unit: "count",
        description: "per-video relation suppressions",
        source: "data/aliases.json" },
    ];
  },
};
