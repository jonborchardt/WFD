import { Chip } from "@mui/material";
import { suggestIssueUrl } from "../lib/issues";

interface Props {
  area: string;
  videoId?: string;
  label?: string;
  extra?: string;
}

export function SuggestChip({ area, videoId, label, extra }: Props) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label || "suggest\u2026"}
      component="a"
      href={suggestIssueUrl(area, { videoId, extra })}
      target="_blank"
      rel="noopener"
      clickable
      sx={{ fontStyle: "italic", borderStyle: "dashed" }}
    />
  );
}
