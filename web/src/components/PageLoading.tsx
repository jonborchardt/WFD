import { Box, Typography } from "@mui/material";
import { UfoLoader } from "./brand";

interface Props {
  label?: string;
  // Short hint under the spinner. Useful when a fetch is known-large
  // (claims-index, entity-index) so the user understands why the spin
  // persists for a second.
  hint?: string;
}

// Centered spinner + optional label. Used in place of the old
// "loading..." text lines so route transitions show an obvious
// in-flight indicator.
export function PageLoading({ label = "loading…", hint }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        py: 8,
      }}
    >
      <UfoLoader size={56} />
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">{hint}</Typography>
      )}
    </Box>
  );
}
