// Cross-video agreements — SAME-CLAIM verdicts from the contradiction
// verification pass, surfaced as corroboration. Read-only for now.

import { useEffect, useState } from "react";
import { PageLoading } from "../components/PageLoading";
import { FacetedPairsPage } from "../components/facets/FacetedPairsPage";
import { loadClaimsBundle, type ClaimsBundle } from "../components/facets/claims-duck";
import { fetchConsonance } from "../lib/data";
import type { ConsonanceFile } from "../types";

const SORT_OPTIONS = [
  { value: "similarity-desc", label: "highest text similarity", hint: "strongest corroboration first" },
  { value: "shared-desc", label: "most shared entities" },
];

const DESCRIPTION = "Claim pairs the AI verification pass identified as asserting the same thesis across two different videos — where the host returns to an idea across episodes.";

export function ConsonancePage() {
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
  const [file, setFile] = useState<ConsonanceFile | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    Promise.all([loadClaimsBundle(), fetchConsonance()]).then(([b, f]) => {
      if (alive) { setBundle(b); setFile(f); }
    });
    return () => { alive = false; };
  }, []);

  if (bundle === null || file === undefined) return <PageLoading />;

  return (
    <FacetedPairsPage
      title="Cross-video agreements"
      description={DESCRIPTION}
      rows={file?.agreements ?? []}
      bundle={bundle}
      facets={{ reason: true, sharedEntities: true, similarity: true,
                publishDate: true, entities: true, videos: true }}
      sortOptions={SORT_OPTIONS}
      defaultSort="similarity-desc"
      emptyMessage="no cross-video agreements yet — run the contradiction verification pass"
    />
  );
}
