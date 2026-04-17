import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Container, Typography } from "@mui/material";
import { CATALOG_COLUMNS } from "../components/catalog-columns";
import { CatalogTableView } from "../components/CatalogTableView";
import { fetchCatalog, fetchEntityIndex, fetchEntityVideos } from "../lib/data";
import { filterRows, augmentWithEntityMatches, sortByPublishDesc, paginate } from "../lib/query";
import type { VideoRow, EntityIndexEntry, EntityVideosIndex } from "../types";

// Home columns: catalog minus status, plus length/views default on
const HOME_COLUMNS = CATALOG_COLUMNS
  .filter((c) => c.key !== "status")
  .map((c) => ["lengthSeconds", "viewCount"].includes(c.key) ? { ...c, default: true } : c);

export function CatalogPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [allRows, setAllRows] = useState<VideoRow[]>([]);
  const [entityIndex, setEntityIndex] = useState<EntityIndexEntry[]>([]);
  const [entityVideos, setEntityVideos] = useState<EntityVideosIndex>({});
  const [text, setText] = useState(() => searchParams.get("search") || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    Promise.all([fetchCatalog(), fetchEntityIndex(), fetchEntityVideos()]).then(([cat, ei, ev]) => {
      setAllRows(cat.filter((r) => r.status === "fetched"));
      setEntityIndex(ei);
      setEntityVideos(ev);
    });
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get("search") || "";
    if (current === text) return;
    if (text) url.searchParams.set("search", text);
    else url.searchParams.delete("search");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [text]);

  useEffect(() => { setPage(1); }, [text]);

  const data = useMemo(() => {
    let matched = filterRows(allRows, { text });
    matched = augmentWithEntityMatches([...matched], allRows, { text }, entityIndex, entityVideos);
    matched = sortByPublishDesc(matched);
    return paginate(matched, { page, pageSize });
  }, [allRows, entityIndex, entityVideos, text, page, pageSize]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom>All Videos</Typography>
      <CatalogTableView
        columns={HOME_COLUMNS}
        rows={data.rows}
        total={data.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        text={text}
        onTextChange={setText}
        onRowClick={(r) => nav("/video/" + r.videoId)}
        onSuggestionNavigate={nav}
      />
    </Container>
  );
}
