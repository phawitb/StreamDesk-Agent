import { useCallback, useEffect, useState } from "react";
import type { Movie, MoviesResponse } from "../types/movie";

interface Category {
  name: string;
  slug: string;
}

interface Props {
  onSelectMovie: (url: string) => void;
}

export function MovieBrowser({ onSelectMovie }: Props) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Fetch categories once
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data: Category[]) => setCategories(data))
      .catch(() => {});
  }, []);

  const fetchMovies = useCallback(async (p: number, cat: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (cat) params.set("category", cat);
      const resp = await fetch(`/api/movies?${params}`);
      const data: MoviesResponse = await resp.json();
      setMovies(data.movies);
      setTotalPages(data.total_pages);
      setPage(data.page);
    } catch (e) {
      console.error("Failed to fetch movies:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovies(1, activeCategory);
  }, [fetchMovies, activeCategory]);

  const handleCategoryClick = (slug: string) => {
    setActiveCategory(slug === activeCategory ? "" : slug);
  };

  const catChipStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 20,
    border: active ? "1px solid #89b4fa" : "1px solid #45475a",
    background: active ? "#89b4fa" : "transparent",
    color: active ? "#1e1e2e" : "#a6adc8",
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontWeight: active ? 600 : 400,
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
    } catch (e) {
      console.error("Sync failed:", e);
    }
    // Sync runs in background on server, re-enable button after a short delay
    setTimeout(() => setSyncing(false), 3000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Category chips */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 16px",
          overflowX: "auto",
          borderBottom: "1px solid #313244",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #45475a",
            background: syncing ? "#45475a" : "#181825",
            color: syncing ? "#6c7086" : "#a6e3a1",
            fontSize: 12,
            cursor: syncing ? "default" : "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {syncing ? "Syncing..." : "Sync DB"}
        </button>
        <button
          style={catChipStyle(activeCategory === "")}
          onClick={() => handleCategoryClick("")}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.slug}
            style={catChipStyle(activeCategory === cat.slug)}
            onClick={() => handleCategoryClick(cat.slug)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Movie grid */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 12,
          alignContent: "start",
        }}
      >
        {loading && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#6c7086", padding: 40 }}>
            Loading...
          </div>
        )}
        {!loading && movies.length === 0 && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#6c7086", padding: 40 }}>
            No movies found
          </div>
        )}
        {!loading &&
          movies.map((movie) => (
            <div
              key={movie.url}
              onClick={() => onSelectMovie(movie.url)}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                overflow: "hidden",
                background: "#313244",
                border: "1px solid #45475a",
                transition: "transform 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.03)";
                e.currentTarget.style.borderColor = "#89b4fa";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.borderColor = "#45475a";
              }}
            >
              {/* Poster */}
              <div
                style={{
                  width: "100%",
                  paddingTop: "140%",
                  position: "relative",
                  background: "#45475a",
                }}
              >
                {movie.poster && (
                  <img
                    src={movie.poster}
                    alt={movie.title}
                    loading="lazy"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                )}
                {/* Badges */}
                <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 4 }}>
                  {movie.quality && (
                    <span
                      style={{
                        background: "#f38ba8",
                        color: "#1e1e2e",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {movie.quality}
                    </span>
                  )}
                  {movie.language && (
                    <span
                      style={{
                        background: "#a6e3a1",
                        color: "#1e1e2e",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {movie.language}
                    </span>
                  )}
                </div>
                {movie.rating && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      background: "#f9e2af",
                      color: "#1e1e2e",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {movie.rating}
                  </span>
                )}
              </div>
              {/* Title */}
              <div
                style={{
                  padding: "8px 8px",
                  fontSize: 12,
                  lineHeight: 1.3,
                  color: "#cdd6f4",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {movie.title}
              </div>
            </div>
          ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderTop: "1px solid #313244",
            background: "#181825",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => fetchMovies(page - 1, activeCategory)}
            disabled={page <= 1 || loading}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #45475a",
              background: page <= 1 ? "#1e1e2e" : "#313244",
              color: page <= 1 ? "#585b70" : "#cdd6f4",
              cursor: page <= 1 ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            {"<"}
          </button>
          <span style={{ fontSize: 13, color: "#a6adc8" }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => fetchMovies(page + 1, activeCategory)}
            disabled={page >= totalPages || loading}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #45475a",
              background: page >= totalPages ? "#1e1e2e" : "#313244",
              color: page >= totalPages ? "#585b70" : "#cdd6f4",
              cursor: page >= totalPages ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            {">"}
          </button>
        </div>
      )}
    </div>
  );
}
