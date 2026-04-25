import { useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import cloud from "d3-cloud";
import { isVisibleType } from "../lib/entity-visibility";
import type { VideoNlp } from "../types";

const MAX_WORDS = 80;
// Layout is recomputed at the container's actual width; height tracks
// width via this aspect ratio so the cloud keeps its general shape.
const ASPECT = 295 / 530;
const FONT_MIN = 10;
const FONT_MAX = 30;
const MAX_LABEL_CHARS = 32;
const MIN_W = 240;
const MAX_HEIGHT = 400;
const RELAYOUT_THRESHOLD_PX = 16;
// Below this width we skip 90° rotation — sideways labels are awkward
// to read on a phone-narrow column.
const NO_ROTATE_BELOW = 420;

interface CloudInput {
  id: string;
  text: string;
  count: number;
  type: string;
}

interface PlacedWord {
  id: string;
  text: string;
  type: string;
  size: number;
  x: number;
  y: number;
  rotate: number;
}

function buildData(nlp: VideoNlp): CloudInput[] {
  const rows: CloudInput[] = [];
  for (const e of nlp.entities) {
    if (!isVisibleType(e.type)) continue;
    if (!e.mentions || e.mentions.length === 0) continue;
    if (!e.canonical) continue;
    const text = e.canonical.length > MAX_LABEL_CHARS
      ? e.canonical.slice(0, MAX_LABEL_CHARS - 1) + "\u2026"
      : e.canonical;
    rows.push({ id: e.id, text, count: e.mentions.length, type: e.type });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, MAX_WORDS);
}

interface Props {
  nlp: VideoNlp | null;
}

export function EntityWordCloud({ nlp }: Props) {
  const theme = useTheme();
  const nav = useNavigate();
  const data = useMemo(() => (nlp ? buildData(nlp) : []), [nlp]);
  const [placed, setPlaced] = useState<PlacedWord[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Each layout run gets a fresh seq; late `end` callbacks compare against
  // the current seq and bail if a newer run has started.
  const layoutSeq = useRef(0);

  // Track the container width with a ResizeObserver — feed the measured
  // width straight into d3-cloud so the layout actually uses the available
  // room rather than scaling a fixed-size SVG.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame = 0;
    const measure = (rawW: number) => {
      const w = Math.max(MIN_W, Math.floor(rawW));
      const next = { w, h: Math.round(w * ASPECT) };
      setSize((prev) => {
        if (prev && Math.abs(prev.w - next.w) < RELAYOUT_THRESHOLD_PX) return prev;
        return next;
      });
    };
    measure(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure(w));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!size || data.length === 0) {
      setPlaced([]);
      return;
    }
    const seq = ++layoutSeq.current;
    const max = data[0].count;
    const min = data[data.length - 1].count;
    const sizeFor = (count: number) => {
      if (max === min) return Math.round((FONT_MIN + FONT_MAX) / 2);
      // Square-root scaling — closer to area-proportional, easier to read
      // than linear when the top word dominates by 10x+.
      const t = (Math.sqrt(count) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
      return Math.round(FONT_MIN + t * (FONT_MAX - FONT_MIN));
    };

    // d3-cloud's stock `Word` interface is `{ text?, size?, x?, y?, rotate? }`.
    // We look up our extra fields (id, type) by text via a Map; if two
    // entities truncate to the same display string, the higher-count one
    // (first, since `data` is desc-sorted) wins and the duplicate is
    // dropped from the layout to keep keys unique.
    const byText = new Map<string, CloudInput>();
    for (const d of data) {
      if (!byText.has(d.text)) byText.set(d.text, d);
    }
    const layoutInput = Array.from(byText.values()).map((d) => ({
      text: d.text,
      size: sizeFor(d.count),
    }));

    const allowRotate = size.w >= NO_ROTATE_BELOW;
    const layout = cloud()
      .size([size.w, size.h])
      .words(layoutInput)
      .padding(1)
      .rotate((_w, i) => (allowRotate && i % 2 !== 0 ? 90 : 0))
      .font("sans-serif")
      .fontSize((d) => d.size ?? FONT_MIN)
      .spiral("rectangular")
      .random(() => 0.5) // stable layout across renders for the same data
      .on("end", (words) => {
        if (seq !== layoutSeq.current) return;
        const next: PlacedWord[] = [];
        for (const w of words) {
          if (typeof w.x !== "number" || typeof w.y !== "number") continue;
          const src = byText.get(w.text ?? "");
          if (!src) continue;
          next.push({
            id: src.id,
            text: src.text,
            type: src.type,
            size: w.size ?? FONT_MIN,
            x: w.x,
            y: w.y,
            rotate: w.rotate ?? 0,
          });
        }
        setPlaced(next);
      });
    layout.start();

    return () => {
      // Invalidate any in-flight callback and stop the layout's setInterval.
      layoutSeq.current++;
      layout.stop();
    };
  }, [data, size]);

  // Tight bounding box of every placed word, in d3-cloud's centered
  // coordinate space. Approximates each word's footprint from its font
  // size, character count, and rotation — d3-cloud doesn't expose the
  // measured glyph extent directly. We feed this bbox into the SVG's
  // viewBox so the cloud crops out d3-cloud's unused canvas margin and
  // scales the words up to fill the container.
  const bbox = useMemo(() => {
    if (placed.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of placed) {
      const wd = w.text.length * w.size * 0.55;
      const ht = w.size * 1.05;
      const vertical = (((w.rotate % 180) + 180) % 180) !== 0;
      const halfX = vertical ? ht / 2 : wd / 2;
      const halfY = vertical ? wd / 2 : ht / 2;
      if (w.x - halfX < minX) minX = w.x - halfX;
      if (w.x + halfX > maxX) maxX = w.x + halfX;
      if (w.y - halfY < minY) minY = w.y - halfY;
      if (w.y + halfY > maxY) maxY = w.y + halfY;
    }
    const pad = 2;
    return {
      x: minX - pad,
      y: minY - pad,
      w: (maxX - minX) + 2 * pad,
      h: (maxY - minY) + 2 * pad,
    };
  }, [placed]);

  const palette = theme.palette as unknown as { entity?: Record<string, string> };
  const entityColor = (type: string): string =>
    palette.entity?.[type] ?? theme.palette.text.primary;

  if (!nlp || data.length === 0) return null;

  // Cap rendered height at MAX_HEIGHT. When the natural height (container
  // width × bbox aspect) would exceed the cap, scale width down to keep
  // the cloud visually proportional and centre it in the container.
  let svgW = 0;
  let svgH = 0;
  if (size && bbox && bbox.w > 0 && bbox.h > 0) {
    const naturalH = size.w * (bbox.h / bbox.w);
    if (naturalH > MAX_HEIGHT) {
      svgH = MAX_HEIGHT;
      svgW = Math.round(MAX_HEIGHT * (bbox.w / bbox.h));
    } else {
      svgW = size.w;
      svgH = Math.round(naturalH);
    }
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        width: "100%",
        bgcolor: "action.hover",
        borderRadius: 1,
        py: { xs: 0.75, sm: 1 },
        px: { xs: 0.5, sm: 1 },
        boxSizing: "border-box",
        overflow: "hidden",
        // Avoid the browser's double-tap-to-zoom on word taps
        touchAction: "manipulation",
      }}
    >
      {size && bbox && svgW > 0 && (
        <svg
          role="img"
          aria-label={`Word cloud of ${data.length} entities sized by mention count`}
          width={svgW}
          height={svgH}
          viewBox={`${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}
        >
          {placed.map((w) => (
            <text
              key={w.id}
              textAnchor="middle"
              transform={`translate(${w.x},${w.y}) rotate(${w.rotate})`}
              style={{
                fontFamily: "sans-serif",
                fontWeight: 500,
                fontSize: `${w.size}px`,
                fill: entityColor(w.type),
                cursor: "pointer",
                // Hit-test against the glyph bbox rather than glyph outlines
                // so small words are still easy to tap on a touchscreen.
                pointerEvents: "bounding-box",
              }}
              onClick={() => nav("/entity/" + encodeURIComponent(w.id))}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  nav("/entity/" + encodeURIComponent(w.id));
                }
              }}
              tabIndex={0}
              role="link"
              aria-label={`${w.text} entity`}
            >
              {w.text}
            </text>
          ))}
        </svg>
      )}
    </Box>
  );
}
