// Cross-video agreements — SAME-CLAIM verdicts from the contradiction
// verification pass, surfaced as corroboration. Read-only for now.

import { useEffect, useState } from "react";
import { PageLoading } from "../components/PageLoading";
import { FacetedPairsPage } from "../components/facets/FacetedPairsPage";
import { loadClaimsBundle, type ClaimsBundle } from "../components/facets/claims-duck";
import { fetchConsonance } from "../lib/data";
import type { ConsonanceFile } from "../types";

const SORT_OPTIONS = [
  { value: "similarity-desc", label: "highest text similarity", hint: "strongest match first" },
  { value: "shared-desc", label: "most shared entities" },
];

const DESCRIPTION = "Claims the host makes in one episode and then makes again in another — the same idea, stated twice across different shows. The opposite of the Contradictions page.";

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
      title="Repeat claims"
      description={DESCRIPTION}
      rows={file?.agreements ?? []}
      bundle={bundle}
      facets={{ reason: true, sharedEntities: true, similarity: true,
                publishDate: true, entities: true, videos: true }}
      sortOptions={SORT_OPTIONS}
      defaultSort="similarity-desc"
      emptyMessage="no repeat claims yet — run the contradiction verification pass"
    />
  );
}
