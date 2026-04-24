// Faceted contradictions browser — same rail idiom as ClaimsPage.
// All facet + filter logic lives in `FacetedPairsPage`; this file is
// just the data fetch + reload-on-mutation wiring.

import { useEffect, useState } from "react";
import { PageLoading } from "../components/PageLoading";
import { FacetedPairsPage } from "../components/facets/FacetedPairsPage";
import {
  invalidateClaimsBundle, loadClaimsBundle, type ClaimsBundle,
} from "../components/facets/claims-duck";
import type { SortOption } from "../components/facets/SortFacet";
import { invalidateClaimsCaches } from "../lib/data";
import { beginLoad } from "../lib/loading";

const SORT_OPTIONS: SortOption[] = [
  { value: "shared-desc", label: "most shared entities" },
  { value: "similarity-desc", label: "highest text similarity",
    hint: "strongest word overlap first (across-episode only)" },
  { value: "kind", label: "group by kind" },
];

export function ContradictionsPage() {
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const end = beginLoad();
    loadClaimsBundle().then(setBundle).finally(end);
  }, [reloadTick]);

  if (!bundle) {
    return <PageLoading
      label="loading contradictions…"
      hint="fetching contradictions and claim index"
    />;
  }

  return (
    <FacetedPairsPage
      title="Contradictions"
      description="Pairs of claims that don't agree — sometimes in the same episode, sometimes across different episodes, and sometimes because one claim quietly assumes something another claim says isn't true. Each row links to the transcript for both sides."
      rows={bundle.contradictions}
      bundle={bundle}
      facets={{
        kind: true, reason: true, sharedEntities: true,
        similarity: true, publishDate: true,
        entities: true, videos: true,
      }}
      sortOptions={SORT_OPTIONS}
      defaultSort="shared-desc"
      onMutated={() => {
        invalidateClaimsCaches();
        invalidateClaimsBundle();
        setReloadTick((t) => t + 1);
      }}
    />
  );
}
