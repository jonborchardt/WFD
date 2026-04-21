import { useEffect, useState } from "react";
import { Box, Link as MuiLink, Typography } from "@mui/material";

export interface TocSection {
  id: string;
  label: string;
  count?: number | null;
}

interface Props {
  sections: TocSection[];
  // Optional vertical offset from the top of the viewport — useful when
  // the app has a sticky header.
  topOffset?: number;
}

// Right-rail table of contents for a long page. Sticky; highlights the
// current section as the user scrolls; clicks jump to the anchor.
export function PageToc({ sections, topOffset = 80 }: Props) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: `-${topOffset}px 0px -60% 0px`, threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections, topOffset]);

  if (sections.length === 0) return null;

  return (
    <Box
      component="nav"
      aria-label="page sections"
      sx={{
        // Sticky is applied here and also works because the component's
        // parent is expected to be a flex item with alignSelf: flex-start
        // so the flex row doesn't stretch it to the column's full height.
        position: "sticky",
        top: topOffset,
        maxHeight: `calc(100vh - ${topOffset + 16}px)`,
        overflow: "auto",
        pl: 2,
        borderLeft: "1px solid",
        borderColor: "divider",
        minWidth: 180,
      }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        on this page
      </Typography>
      {sections.map((s) => (
        <Box key={s.id} sx={{ py: 0.25 }}>
          <MuiLink
            href={`#${s.id}`}
            underline="hover"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(s.id);
              if (!el) return;
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              // Update the URL hash without triggering a scroll jump.
              history.replaceState(null, "", `#${s.id}`);
            }}
            sx={{
              display: "block",
              fontSize: "0.85rem",
              color: active === s.id ? "text.primary" : "text.secondary",
              fontWeight: active === s.id ? 600 : 400,
              borderLeft: active === s.id ? "2px solid" : "2px solid transparent",
              borderColor: active === s.id ? "primary.main" : "transparent",
              pl: 1,
              ml: -1,
            }}
          >
            {s.label}
            {typeof s.count === "number" && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                ({s.count})
              </Typography>
            )}
          </MuiLink>
        </Box>
      ))}
    </Box>
  );
}
