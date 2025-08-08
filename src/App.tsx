import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";

type SortBy = "name" | "createdAt" | "modifiedAt" | "size";

type ScreenshotItem = {
  path: string;
  file_name: string;
  created_at?: string | null;
  modified_at?: string | null;
  size_bytes?: number | null;
};

type UndoEntry = {
  original_path: string;
  trashed_path: string;
};

// Layout constants - must match CSS values
const CARD_MIN_WIDTH = 220; // matches .gallery grid-template-columns minmax value
const CARD_GAP = 16; // matches .gallery gap value

function App() {
  const [items, setItems] = useState<ScreenshotItem[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("modifiedAt");
  const [descending, setDescending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastTrashed, setLastTrashed] = useState<UndoEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectIndexRef = useRef<number | null>(null);
  const pendingDeleteRef = useRef<boolean>(false);
  const pendingSelectPathRef = useRef<string | null>(null);
  const displayName = (it: ScreenshotItem) => (it.file_name && it.file_name.length ? it.file_name : it.path.split("/").pop() || it.path);
  const formatSize = (n?: number | null) => (n ? (n > 1024 * 1024 ? (n / (1024 * 1024)).toFixed(1) + " MB" : Math.round(n / 1024) + " KB") : "");
  const formatDate = (s?: string | null) => (s ? s.replace("T", " ").replace("Z", "") : "");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = (await invoke("list_screenshots", {
        options: { sortBy, descending },
      })) as ScreenshotItem[];
      setItems(result);
    } finally {
      setBusy(false);
    }
  }, [sortBy, descending]);

  useEffect(() => {
    load();
  }, [load]);

  // initialize/restore active selection when items load
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (pendingSelectPathRef.current) {
      const idx = items.findIndex((it) => it.path === pendingSelectPathRef.current);
      if (idx >= 0) {
        setActiveIndex(idx);
        pendingSelectPathRef.current = null;
        pendingSelectIndexRef.current = null;
        return;
      }
      pendingSelectPathRef.current = null;
    }
    if (pendingSelectIndexRef.current != null) {
      const idx = Math.max(0, Math.min(items.length - 1, pendingSelectIndexRef.current));
      setActiveIndex(idx);
      pendingSelectIndexRef.current = null;
      return;
    }
    // clamp active index if out of bounds after a delete
    if (activeIndex >= items.length) {
      const idx = items.length - 1;
      setActiveIndex(idx);
      return;
    }
    // do not auto-select first item; wait for click or arrow key
  }, [items, activeIndex]);


  const onDelete = useCallback(async () => {
    if (activeIndex < 0 || activeIndex >= items.length) return;
    setBusy(true);
    try {
      // compute next target using current active index
      const uiPaths = items.map((it) => it.path);
      const nextPath = uiPaths[activeIndex + 1];
      const prevPath = activeIndex - 1 >= 0 ? uiPaths[activeIndex - 1] : undefined;
      pendingSelectPathRef.current = nextPath ?? prevPath ?? null;
      const res = (await invoke("delete_to_trash", { paths: [uiPaths[activeIndex]] })) as { trashed: UndoEntry[] };
      setLastTrashed(res.trashed);
      await load();
    } finally {
      setBusy(false);
    }
  }, [items, activeIndex, load]);

  const onUndo = useCallback(async () => {
    if (!lastTrashed.length) return;
    setBusy(true);
    try {
      // after undo, focus the first restored item's original path
      const focusPath = lastTrashed[0]?.original_path;
      await invoke("undo_last_delete", { count: lastTrashed.length });
      setLastTrashed([]);
      if (focusPath) {
        pendingSelectPathRef.current = focusPath;
      }
      await load();
      setNotice(null);
    } catch (e: any) {
      setNotice(
        "Undo requires Full Disk Access to restore from Trash. Grant it in System Settings → Privacy & Security → Full Disk Access, or click Reveal to open the trashed file and restore manually."
      );
    } finally {
      setBusy(false);
    }
  }, [lastTrashed, load]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!lightboxOpen && (e.key === "Backspace" || e.key === "Delete" || e.key.toLowerCase() === "x")) {
      e.preventDefault();
      if (busy) {
        // queue deletion to run after current operation finishes
        pendingDeleteRef.current = true;
      } else {
        onDelete();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      onUndo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      load();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setLightboxOpen(false);
    } else if (lightboxOpen) {
      // When lightbox is open, only space/enter should work to close it
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setLightboxOpen(false);
      }
    } else if (!busy && (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter"].includes(e.key) || ["w", "a", "s", "d"].includes(e.key.toLowerCase()))) {
      if (items.length === 0) return;
      const navKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "a", "s", "d"];
      if (activeIndex < 0 && (navKeys.includes(e.key) || navKeys.includes(e.key.toLowerCase()))) {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      const ensureActive = (idx: number) => Math.max(0, Math.min(items.length - 1, idx));
      const getCols = () => {
        const el = galleryRef.current;
        if (!el) return 1;
        const width = el.clientWidth || 1;
        return Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
      };
      let next = activeIndex >= 0 ? activeIndex : 0;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowRight" || key === "d") next = ensureActive(next + 1);
      else if (e.key === "ArrowLeft" || key === "a") next = ensureActive(next - 1);
      else if (e.key === "ArrowDown" || key === "s") next = ensureActive(next + getCols());
      else if (e.key === "ArrowUp" || key === "w") next = ensureActive(next - getCols());

      if (navKeys.includes(e.key) || navKeys.includes(key)) {
        e.preventDefault();
        setActiveIndex(next);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0) {
          setLightboxOpen(!lightboxOpen);
        }
      }
    }
  }, [busy, items, activeIndex, lightboxOpen, load, onDelete, onUndo]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // run queued delete once not busy anymore
  useEffect(() => {
    if (!busy && pendingDeleteRef.current) {
      pendingDeleteRef.current = false;
      if (activeIndex >= 0) onDelete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Keep active card in view
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = galleryRef.current?.querySelector<HTMLElement>(`[data-index='${activeIndex}']`);
    el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [activeIndex]);

  return (
    <main className="container" style={{ maxWidth: 1200 }}>
      {notice && (
        <div role="alert" style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 9999,
          maxWidth: 520,
          background: "#fff",
          color: "#1a1a1a",
          border: "1px solid #eee",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          padding: "12px 12px",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontWeight: 700 }}>Undo failed</span>
          <span style={{ opacity: 0.9, flex: 1 }}>{notice}</span>
          {lastTrashed[0]?.trashed_path && (
            <button onClick={() => revealItemInDir(lastTrashed[0]!.trashed_path)}>Reveal</button>
          )}
          <button onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <div style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "white", padding: "16px 20px", marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Screenshot Manager</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ opacity: 0.9, fontSize: 14, color: "rgba(255, 255, 255, 0.9)" }}>Sort by</span>
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                aria-label="Sort screenshots by"
                style={{ 
                  padding: "8px 12px", 
                  borderRadius: "12px", 
                  border: "2px solid rgba(255, 255, 255, 0.4)", 
                  fontSize: 14, 
                  background: "rgba(255, 255, 255, 0.15)", 
                  backgroundColor: "rgba(255, 255, 255, 0.15)",
                  color: "white", 
                  backdropFilter: "blur(10px)", 
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23ffffff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, 
                  backgroundPosition: "right 10px center", 
                  backgroundRepeat: "no-repeat", 
                  backgroundSize: "16px", 
                  paddingRight: "36px", 
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  outline: "none"
                }}>
                <option value="modifiedAt">Modified</option>
                <option value="createdAt">Created</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: "rgba(255, 255, 255, 0.15)", padding: "8px 12px", borderRadius: "12px", border: "2px solid rgba(255, 255, 255, 0.4)", backdropFilter: "blur(10px)" }} title="Sort order">
              <div style={{ position: "relative", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <input 
                  type="checkbox" 
                  checked={descending} 
                  onChange={(e) => setDescending(e.target.checked)}
                  aria-label="Sort in descending order (newest first)"
                  style={{ 
                    width: "16px", 
                    height: "16px", 
                    margin: 0,
                    padding: 0,
                    background: "transparent", 
                    backgroundColor: "transparent", 
                    border: "2px solid rgba(255, 255, 255, 0.6)", 
                    borderRadius: "3px", 
                    appearance: "none", 
                    WebkitAppearance: "none",
                    cursor: "pointer",
                    position: "relative"
                  }} 
                />
                {descending && (
                  <div style={{ 
                    position: "absolute", 
                    top: "3px", 
                    left: "5px", 
                    width: "4px", 
                    height: "7px", 
                    border: "solid white", 
                    borderWidth: "0 2px 2px 0", 
                    transform: "rotate(45deg)",
                    pointerEvents: "none"
                  }} />
                )}
              </div>
              <span style={{ fontSize: 14, color: "rgba(255, 255, 255, 0.95)", fontWeight: 500 }}>Newest first</span>
            </label>
          </div>
        </div>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, fontSize: 13, color: "rgba(255, 255, 255, 0.9)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>↑↓←→ or WASD</kbd>
            <span>Navigate</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>Space or Enter</kbd>
            <span>Preview</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>X, Del, or ⌫</kbd>
            <span>Delete</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>Cmd+Z</kbd>
            <span>Undo</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>Cmd+R</kbd>
            <span>Refresh</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <kbd style={{ background: "rgba(255, 255, 255, 0.2)", color: "white", padding: "3px 7px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", border: "1px solid rgba(255, 255, 255, 0.3)" }}>ESC</kbd>
            <span>Close preview</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ marginTop: 16, padding: 32, borderRadius: 16, background: "white", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 18 }}>No screenshots found</div>
          <div style={{ opacity: 0.7 }}>Make sure your macOS screenshot save location has screenshots, or add some.</div>
        </div>
      ) : (
        <div className="gallery" style={{ marginTop: 16 }} ref={galleryRef}>
          {items.map((it, idx) => {
            const selectedItem = idx === activeIndex;
            return (
              <div
                key={it.path}
                className={`card ${selectedItem ? "selected" : ""}`}
                onClick={(e) => {
                  setActiveIndex(idx);
                  if (e.detail === 2) {
                    setLightboxOpen(true);
                  }
                }}
                title={it.path}
                data-index={idx}
              >
                <img
                  className="thumb"
                  src={convertFileSrc(it.path)}
                  alt={displayName(it)}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                />
                <div className="meta">
                  <div className="name" title={displayName(it)}>{displayName(it)}</div>
                  <div className="sub">{formatDate(it.modified_at)} • {formatSize(it.size_bytes as number | undefined)}</div>
                </div>
                <div className="tick" aria-hidden>{selectedItem ? "✓" : ""}</div>
              </div>
            );
          })}
        </div>
      )}


      {lightboxOpen && activeIndex >= 0 && activeIndex < items.length && (
        <div
          className="lightbox-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.9)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            cursor: "pointer",
          }}
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={convertFileSrc(items[activeIndex].path)}
            alt={displayName(items[activeIndex])}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              cursor: "default",
            }}
            onClick={(e) => e.stopPropagation()}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              setLightboxOpen(false);
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              background: "rgba(255, 255, 255, 0.2)",
              borderRadius: 20,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 18,
              color: "white",
            }}
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
