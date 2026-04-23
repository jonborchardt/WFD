export const fmtDate = (d?: string): string => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  return t.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export const truncate = (s: string | undefined, n: number): string => {
  if (!s) return "";
  const clean = String(s).replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "..." : clean;
};

export const descriptionPreview = (s: string | undefined, n: number): string => {
  if (!s) return "";
  const nl = s.indexOf("\n");
  const rest = nl >= 0 ? s.slice(nl + 1) : s;
  return truncate(rest, n);
};

export const fmtTimestamp = (s: number): string => {
  const n = Math.floor(s);
  return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
};
