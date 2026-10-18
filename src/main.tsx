import { version as appVersion } from "../package.json";
import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Aperture,
  Home,
  FolderOpen,
  Plus,
  Settings,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Search,
  LayoutGrid,
  Maximize,
  Columns2,
  SlidersHorizontal,
  Download,
  Upload,
  Check,
  CheckCheck,
  X,
  Star,
  Flag,
  ArrowUpRight,
  ArrowLeft,
  Image as ImageIcon,
  MoreHorizontal,
  FolderPlus,
  RefreshCw,
  Undo2,
  RotateCw,
  ZoomIn,
  ZoomOut,
  ShieldCheck,
  Monitor,
  Camera,
  Info,
  Archive,
  CheckCircle2,
  LoaderCircle,
  Sparkles,
  Keyboard,
  Sun,
  Contrast,
  Droplets,
  Thermometer,
  Copy,
  Trash2,
} from "lucide-react";
import type {
  Album,
  Photo,
  Edits,
  Progress,
  Auth,
  CullSettings,
  Queue,
  ExportResult,
  ImportResult,
  ImportPlan,
} from "./types";
import { imageURL, categories, categoryColor, freshEdits } from "./types";
import { Preview } from "./preview";
import { ZoomSurface } from "./zoom-surface";
import { useAIPreferences } from "./ai-preferences";
import { WorkProgress } from "./work-progress";
import { QuickPreview } from "./quick-preview";
import { BatchEditor } from "./batch-editor";
import { AIEditor } from "./ai-editor";
import { Editor } from "./editor";
import exportPresets from "../electron/export-presets.json";
import "./style.css";
const api = window.openshoot;
const genres = [
  "Wedding & engagement",
  "Portraits",
  "Family & newborn",
  "Events",
  "Sports & action",
  "Landscape & travel",
  "Other",
];
type Modal =
  | "quick-preview"
  | "batch-edit"
  | "import"
  | "new"
  | "cull"
  | "export"
  | "settings"
  | "help"
  | "report"
  | "rename"
  | null;
function IconButton({
  title,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={"icon-button " + (active ? "active" : "")}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function App() {
  const [aiPreferences, updateAIPreferences] = useAIPreferences();
  const [albums, setAlbums] = useState<Album[]>([]),
    [album, setAlbum] = useState<Album | null>(null),
    [modal, setModal] = useState<Modal>(null),
    [view, setView] = useState("grid"),
    [tab, setTab] = useState("Cull"),
    [filter, setFilter] = useState("All"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("name"),
    [minRating, setMinRating] = useState(0),
    [activeId, setActiveId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [size, setSize] = useState(230),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [auth, setAuth] = useState<Auth>({
      connected: false,
      enabled: false,
      email: "",
      pending: false,
    }),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [model, setModel] = useState(""),
    [queue, setQueue] = useState<Queue | null>(null),
    [report, setReport] = useState<{
      title: string;
      lines: string[];
      exported?: boolean;
    } | null>(null),
    [dropping, setDropping] = useState(false),
    [zoom, setZoom] = useState(1);
  const [name, setName] = useState(""),
    [genre, setGenre] = useState(genres[0]),
    [engine, setEngine] = useState("local"),
    [settings, setSettings] = useState<CullSettings>({
      mode: "quality",
      target: 100,
      blur: "standard",
      similarity: "standard",
      duplicates: true,
      detectBlur: true,
    }),
    [consent, setConsent] = useState(false),
    [scope, setScope] = useState("selected"),
    [format, setFormat] = useState("original"),
    [maxSize, setMaxSize] = useState("");
  const [exportPreset, setExportPreset] = useState("");
  const [editDraft, setEditDraft] = useState<{
    id: string;
    edits: Edits;
  } | null>(null);
  useEffect(() => {
    setEditDraft(null);
    setZoom(1);
  }, [activeId, tab, album?.id]);
  const [homeFilter, setHomeFilter] = useState("All albums");
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null),
    [importPreset, setImportPreset] = useState(
      () => localStorage.getItem("openshoot-import-preset") || "all",
    ),
    [customTypes, setCustomTypes] = useState<string[]>(() => {
      try {
        return JSON.parse(
          localStorage.getItem("openshoot-import-types") || "[]",
        );
      } catch {
        return [];
      }
    });
  const importTypes = importPlan
    ? Object.keys(importPlan.counts).filter(
        (ext) =>
          importPreset === "all" ||
          (importPreset === "raw" && importPlan.rawExtensions.includes(ext)) ||
          (importPreset === "jpeg" &&
            importPlan.jpegExtensions.includes(ext)) ||
          (importPreset === "custom" && customTypes.includes(ext)),
      )
    : [];
  const importCount = importTypes.reduce(
    (n, ext) => n + (importPlan?.counts[ext] || 0),
    0,
  );
  const showImportPlan = (p: ImportPlan | null) => {
    if (p) {
      setImportPlan(p);
      setModal("import");
    }
  };
  const refresh = useCallback(async () => setAlbums(await api.list()), []);
  useEffect(() => {
    if (!api) {
      setError("OpenShoot needs its desktop runtime. Start with npm run dev.");
      return;
    }
    refresh().catch((e) => setError(e.message));
    api
      .auth()
      .then(setAuth)
      .catch((e) => setError(e.message));
    const p = api.onProgress(setProgress),
      a = api.onAuth((value) => {
        if (value.error) setError(value.error);
        api.auth().then(setAuth);
      });
    return () => {
      p();
      a();
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const run = async <T,>(fn: () => Promise<T>, done?: (value: T) => void) => {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      done?.(result);
      await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const openAlbum = async (a: Album) => {
    await run(
      () => api.get(a.id),
      (value) => {
        setAlbum(value);
        setSelected([]);
        setActiveId(value.photos[0]?.id || "");
        setFilter("All");
        setQuery("");
        setTab("Cull");
        setView("grid");
      },
    );
  };
  const active = album?.photos.find((p) => p.id === activeId) || null;
  const photos = useMemo(() => {
    if (!album) return [];
    return album.photos
      .filter(
        (p) =>
          (filter === "All" ||
            (filter === "Warnings" && !!p.exposure) ||
            p.category === filter) &&
          p.rating >= minRating &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) =>
        sort === "quality"
          ? (b.quality || 0) - (a.quality || 0)
          : sort === "rating"
            ? b.rating - a.rating
            : a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [album, filter, minRating, query, sort]);
  useEffect(() => {
    setSelected([]);
  }, [filter, minRating, query]);
  useEffect(() => {
    if (album && photos.length && !photos.some((p) => p.id === activeId))
      setActiveId(photos[0].id);
  }, [photos, album, activeId]);
  const targets = selected.length ? selected : active ? [active.id] : [];
  const patch = async (p: Partial<Photo>, ids = targets) => {
    if (!album || !ids.length) return;
    await run(() => api.patch(album.id, ids, p), setAlbum);
  };
  const removePhotos = async () => {
    if (!album || !targets.length || busy) return;
    const ids = [...targets],
      next = photos.find((p) => !ids.includes(p.id))?.id || "";
    await run(
      () => api.remove(album.id, ids),
      (a) => {
        setAlbum(a);
        setSelected([]);
        setActiveId(next);
        setEditDraft(null);
        setNotice(
          `${ids.length === 1 ? "Photo" : ids.length + " photos"} removed from album. Originals kept on disk. Use Undo to restore.`,
        );
      },
    );
  };
  const undo = () => {
    if (album)
      run(
        () => api.undo(album.id),
        (a) => {
          setAlbum(a);
          setEditDraft(null);
          setNotice("Photo changes restored");
        },
      );
  };
  const importResult = (result: ImportResult | null) => {
    if (!result) return;
    setAlbum(result.album);
    setActiveId(result.album.photos[0]?.id || "");
    setNotice(
      `${result.added} photos imported${result.cancelled ? " · stopped early" : ""}`,
    );
    if (result.errors.length) {
      setReport({
        title: "Import report",
        lines: result.errors.map((e) => e.file + " — " + e.error),
      });
      setModal("report");
    }
  };
  const importPhotos = (folder = false) => {
    if (album) run(() => api.chooseImport(album.id, folder), showImportPlan);
    else {
      setName("");
      setModal("new");
    }
  };
  const openCull = async () => {
    if (!album || !album.photos.length) return;
    setConsent(false);
    setModal("cull");
    try {
      setQueue(await api.aiStatus(album.id));
    } catch (e) {
      setError(String(e));
    }
  };
  const move = (delta: number) => {
    if (!photos.length) return;
    const i = photos.findIndex((p) => p.id === activeId),
      p = photos[Math.max(0, Math.min(photos.length - 1, i + delta))];
    setActiveId(p.id);
    setSelected([p.id]);
  };
  useEffect(() => {
    if (!api) return;
    return api.onCommand((command) => {
      if (command === "new") {
        setName("");
        setModal("new");
      }
      if (command === "settings") setModal("settings");
      if (command === "import") importPhotos();
      if (command === "importFolder") importPhotos(true);
      if (command === "export" && album) setModal("export");
      if (command === "undo") undo();
      if (["grid", "loupe"].includes(command)) setView(command);
    });
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,select,textarea") ||
        modal ||
        busy
      )
        return;
      if (e.key === "Escape") {
        setSelected([]);
        setZoom(1);
        setView("grid");
      }
      if (!album) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      }
      if (e.key === "g") setView("grid");
      if (e.key === "e" || e.key === " ") {
        e.preventDefault();
        setView((v) => (v === "grid" ? "loupe" : "grid"));
      }
      if (e.key === "s") setView("survey");
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        removePhotos();
      }
      if (/^[0-5]$/.test(e.key)) patch({ rating: Number(e.key) });
      if (e.key.toLowerCase() === "p")
        patch({ category: "Selected", label: "Green", rating: 4 });
      if (e.key.toLowerCase() === "x")
        patch({ category: "Rejected", label: "Red", rating: 1 });
      if (e.key.toLowerCase() === "u")
        patch({ category: "Unrated", label: "", rating: 0 });
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelected(photos.map((p) => p.id));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (modal === "settings" && auth.enabled) loadModels();
  }, [modal, auth.enabled]);
  const loadModels = async () => {
    try {
      const m = await api.models();
      setModels(m);
      setModel((current) =>
        m.some((v) => v.id === current) ? current : m[0]?.id || "",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const choose = (photo: Photo, event: React.MouseEvent) => {
    if (event.shiftKey) {
      const start = photos.findIndex((p) => p.id === activeId),
        end = photos.findIndex((p) => p.id === photo.id);
      setSelected(
        photos
          .slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1)
          .map((p) => p.id),
      );
    } else if (event.metaKey || event.ctrlKey)
      setSelected((s) =>
        s.includes(photo.id)
          ? s.filter((id) => id !== photo.id)
          : [...s, photo.id],
      );
    else setSelected([photo.id]);
    setActiveId(photo.id);
  };
  const count = (category: string) =>
    album?.photos.filter(
      (p) =>
        category === "All" ||
        (category === "Warnings" && p.exposure) ||
        p.category === category,
    ).length || 0;
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => api.filePath(f))
      .filter(Boolean);
    if (!paths.length) return;
    await run(async () => {
      const a = album || (await api.create("Imported photos", genres[0]));
      setAlbum(a);
      return api.planDrop(a.id, paths);
    }, showImportPlan);
  };
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropping(false);
      }}
      onDrop={drop}
    >
      <div className="titlebar">
        <span className="title-brand">OpenShoot</span>
      </div>
      <div className="app-body">
        <nav className="rail">
          <button
            className="brand-mark"
            title="OpenShoot albums"
            onClick={() => {
              setAlbum(null);
              setQuery("");
            }}
          >
            <img src="./openshoot-icon.png" alt="" />
          </button>
          <div className="rail-group">
            <IconButton
              title="Albums"
              active={!album}
              onClick={() => {
                setAlbum(null);
                setQuery("");
              }}
            >
              <Home size={21} />
            </IconButton>
            <IconButton
              title="New album"
              onClick={() => {
                setName("");
                setModal("new");
              }}
            >
              <FolderPlus size={21} />
            </IconButton>
            {album && (
              <IconButton
                title="Review album"
                active
                onClick={() => {
                  setTab("Cull");
                  setView("grid");
                }}
              >
                <LayoutGrid size={21} />
              </IconButton>
            )}
          </div>
          <div className="rail-bottom">
            <IconButton
              title="Keyboard shortcuts & about"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={21} />
            </IconButton>
            <IconButton
              title="Settings"
              active={modal === "settings"}
              onClick={() => setModal("settings")}
            >
              <Settings size={21} />
            </IconButton>
          </div>
        </nav>
        <main>
          {!album ? (
            <>
              <header className="home-header">
                <div>
                  <span className="eyebrow">YOUR WORKSPACE</span>
                  <h1>Albums</h1>
                </div>
                <div className="row">
                  <span className="quiet">
                    <ShieldCheck size={15} /> Originals stay untouched
                  </span>
                  <button
                    className="primary"
                    onClick={() => {
                      setName("");
                      setModal("new");
                    }}
                  >
                    <Plus size={17} /> New album
                  </button>
                </div>
              </header>
              <section className="home-content">
                <div className="hero">
                  <div className="hero-content">
                    <div className="hero-kicker">
                      <span /> LESS SORTING. MORE CREATING.
                    </div>
                    <h2>
                      Find the photographs
                      <br />
                      worth holding on to.
                    </h2>
                    <p>
                      A thoughtful workspace to cull, refine, and deliver your
                      next shoot.
                      <br />
                      Start with your photos. Keep your creative point of view.
                    </p>
                    <button
                      className="hero-button"
                      onClick={() => {
                        setName("");
                        setModal("new");
                      }}
                    >
                      Create an album <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <div className="hero-art" aria-hidden="true">
                    <div className="art-card art-back" />
                    <div className="art-card art-front">
                      <div className="art-sun" />
                      <div className="art-hill" />
                      <div className="art-hill second" />
                      <div className="art-caption">
                        <span>THE QUIET OUTDOORS</span>
                        <span>01 — 16</span>
                      </div>
                    </div>
                    <div className="art-stamp">
                      <CheckCheck size={17} />
                      <span>Make room for your best.</span>
                    </div>
                  </div>
                </div>
                <div className="library-toolbar">
                  <div className="segmented">
                    {["All albums", "Culled", "Imported"].map((v) => (
                      <button
                        key={v}
                        className={homeFilter === v ? "active" : ""}
                        onClick={() => setHomeFilter(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="row">
                    <div className="search">
                      <Search size={15} />
                      <input
                        aria-label="Search albums"
                        placeholder="Search albums"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <span className="muted">{albums.length} albums</span>
                  </div>
                </div>
                {albums.length ? (
                  <div className="album-grid">
                    {albums
                      .filter(
                        (a) =>
                          a.name.toLowerCase().includes(query.toLowerCase()) &&
                          (homeFilter === "All albums" ||
                            (homeFilter === "Culled" &&
                              a.status.toLowerCase().includes("culled")) ||
                            (homeFilter === "Imported" &&
                              a.status === "Imported")),
                      )
                      .map((a) => (
                        <div className="album-card" key={a.id}>
                          <button
                            className="album-cover"
                            onClick={() => openAlbum(a)}
                          >
                            {a.photos.length ? (
                              <img
                                src={imageURL(a.photos[0], true)}
                                alt={a.name}
                              />
                            ) : (
                              <div className="empty-cover">
                                <ImageIcon size={40} />
                              </div>
                            )}
                            <span className="cover-count">
                              <ImageIcon size={12} />
                              {a.count || 0}
                            </span>
                            {a.demo && (
                              <span className="demo-badge">
                                DEMO ILLUSTRATIONS
                              </span>
                            )}
                          </button>
                          <div className="album-meta">
                            <button
                              className="album-title"
                              onClick={() => openAlbum(a)}
                            >
                              {a.name}
                            </button>
                            <button
                              className="icon-button small"
                              title={"Archive " + a.name}
                              onClick={() =>
                                run(
                                  () => api.archive(a.id),
                                  () =>
                                    setNotice(
                                      "Album archived · Restore in Settings",
                                    ),
                                )
                              }
                            >
                              <Archive size={15} />
                            </button>
                            <p>{a.genre}</p>
                            <div className="album-bottom">
                              <span
                                className={
                                  "status " +
                                  (a.status.includes("culled") ||
                                  a.status === "Culled"
                                    ? "green"
                                    : "")
                                }
                              >
                                {a.status === "Imported" ? (
                                  <FolderOpen size={12} />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}{" "}
                                {a.status}
                              </span>
                              <span>
                                {new Date(a.createdAt).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="empty-library">
                    <div className="empty-symbol">
                      <FolderPlus size={27} />
                    </div>
                    <h3>A new story starts here.</h3>
                    <p>
                      Create your first album, or drop a folder of photos into
                      this window.
                    </p>
                    <div className="row">
                      <button
                        onClick={() => {
                          setName("");
                          setModal("new");
                        }}
                      >
                        <Plus size={16} /> Create your first album
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          run(
                            () => api.demo(),
                            (a) => {
                              setAlbum(a);
                              setActiveId(a.photos[0]?.id || "");
                              setSelected([]);
                            },
                          )
                        }
                      >
                        Explore a demo album <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="workflow-strip">
                  <div>
                    <span>01</span>
                    <div>
                      <strong>Bring in your shoot</strong>
                      <p>Import photos or an entire folder</p>
                    </div>
                  </div>
                  <ChevronRight size={15} />
                  <div>
                    <span>02</span>
                    <div>
                      <strong>Find your keepers</strong>
                      <p>Local analysis or ChatGPT assistance</p>
                    </div>
                  </div>
                  <ChevronRight size={15} />
                  <div>
                    <span>03</span>
                    <div>
                      <strong>Make it yours</strong>
                      <p>Refine and export your selections</p>
                    </div>
                  </div>
                </div>
              </section>
              <footer className="home-footer">
                <span>
                  <Monitor size={13} /> Built for the way you see.
                </span>
                <span>OpenShoot / {appVersion}</span>
              </footer>
            </>
          ) : (
            <>
              <header className="album-header">
                <div className="album-heading">
                  <IconButton
                    title="Back to albums"
                    onClick={() => {
                      setAlbum(null);
                      setQuery("");
                    }}
                  >
                    <ArrowLeft size={18} />
                  </IconButton>
                  <div>
                    <button
                      className="album-name-button"
                      onClick={() => {
                        setName(album.name);
                        setModal("rename");
                      }}
                    >
                      {album.name}
                      <ChevronDown size={14} />
                    </button>
                    <p>
                      {album.photos.length} photos <span>·</span> {album.genre}
                    </p>
                  </div>
                </div>
                <div className="workflow-tabs">
                  {["Cull", "Edit"].map((t, i) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTab(t);
                        if (t === "Edit") {
                          setView("loupe");
                          if (!activeId) setActiveId(photos[0]?.id || "");
                        }
                      }}
                      className={tab === t ? "active" : ""}
                    >
                      <span>{i + 1}</span>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <IconButton
                    title="Undo last photo changes"
                    disabled={busy}
                    onClick={undo}
                  >
                    <Undo2 size={17} />
                  </IconButton>
                  <button
                    disabled={busy || !album.photos.length}
                    onClick={() => setModal("quick-preview")}
                  >
                    <Sparkles size={15} />
                    Quick Preview
                  </button>
                  <button
                    disabled={busy || !album.photos.length}
                    onClick={() => setModal("batch-edit")}
                  >
                    <Sparkles size={15} />
                    AI auto edit
                  </button>
                  <button onClick={() => importPhotos()} disabled={busy}>
                    <Plus size={15} /> Import
                  </button>
                  <IconButton
                    title="Import folder"
                    disabled={busy}
                    onClick={() => importPhotos(true)}
                  >
                    <FolderOpen size={17} />
                  </IconButton>
                  <button
                    className="primary"
                    disabled={!album.photos.length || busy}
                    onClick={() => setModal("export")}
                  >
                    <Download size={16} /> Export
                  </button>
                </div>
              </header>
              <div className="workspace">
                <aside className="album-sidebar">
                  <div className="sidebar-title">ALBUM OVERVIEW</div>
                  <button
                    className={
                      "filter-all " + (filter === "All" ? "active" : "")
                    }
                    onClick={() => setFilter("All")}
                  >
                    <ImageIcon size={16} />
                    <span>All photos</span>
                    <b>{count("All")}</b>
                  </button>
                  <div className="sidebar-title space">YOUR SELECTIONS</div>
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={
                        "filter-button " + (filter === c ? "active" : "")
                      }
                      onClick={() => setFilter(c)}
                    >
                      <span
                        className="category-dot"
                        style={{ background: categoryColor[c] }}
                      />
                      <span>{c === "Maybe" ? "Needs review" : c}</span>
                      <b>{count(c)}</b>
                    </button>
                  ))}
                  <div className="sidebar-divider" />
                  <button
                    className={
                      "filter-button " + (filter === "Warnings" ? "active" : "")
                    }
                    onClick={() => setFilter("Warnings")}
                  >
                    <Sun size={15} />
                    <span>Exposure warnings</span>
                    <b>{count("Warnings")}</b>
                  </button>
                  <div className="sidebar-bottom">
                    <div className="cull-engine">
                      <div className="row">
                        <Aperture size={17} />
                        <strong>
                          {album.status.includes("AI")
                            ? "AI assisted"
                            : "A considered first pass"}
                        </strong>
                      </div>
                      <p>
                        {album.status.includes("AI")
                          ? "Recommendations with reasons. You make the final call."
                          : "Find similar frames and soft focus, then make the final call."}
                      </p>
                      <button
                        className="primary full"
                        disabled={busy || !album.photos.length}
                        onClick={openCull}
                      >
                        <Sparkles size={15} />
                        {album.status === "Imported"
                          ? "Start culling"
                          : "Cull again"}
                      </button>
                    </div>
                    <span className="local-note">
                      <ShieldCheck size={12} /> Original files are preserved
                    </span>
                  </div>
                </aside>
                <section className="photo-workspace">
                  <div className="photo-toolbar">
                    <div className="row">
                      <strong>
                        {filter === "Maybe"
                          ? "Needs review"
                          : filter === "All"
                            ? "All photos"
                            : filter}
                      </strong>
                      <span className="pill">{photos.length}</span>
                      <div className="toolbar-divider" />
                      <div className="search compact">
                        <Search size={14} />
                        <input
                          aria-label="Search photos"
                          placeholder="Find a photo"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="row">
                      <select
                        aria-label="Minimum rating"
                        value={minRating}
                        onChange={(e) => setMinRating(Number(e.target.value))}
                      >
                        <option value={0}>All ratings</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}★ and up
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Sort photos"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="name">Filename</option>
                        <option value="quality">Quality score</option>
                        <option value="rating">Star rating</option>
                      </select>
                      <button
                        disabled={busy || !targets.length}
                        onClick={removePhotos}
                        title="Remove from album · original files stay on disk"
                        aria-label={
                          targets.length > 1
                            ? `Remove ${targets.length} photos from album`
                            : "Remove photo from album"
                        }
                      >
                        <Trash2 size={14} />
                        {targets.length > 1
                          ? `Remove ${targets.length}`
                          : "Remove"}
                      </button>
                      <div className="view-switch">
                        <IconButton
                          title="Grid (G)"
                          active={view === "grid"}
                          onClick={() => setView("grid")}
                        >
                          <LayoutGrid size={16} />
                        </IconButton>
                        <IconButton
                          title="Loupe (E)"
                          active={view === "loupe"}
                          onClick={() => setView("loupe")}
                        >
                          <Maximize size={16} />
                        </IconButton>
                        <IconButton
                          title="Survey (S)"
                          active={view === "survey"}
                          onClick={() => setView("survey")}
                        >
                          <Columns2 size={17} />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                  {!album.photos.length ? (
                    <div className="photo-empty">
                      <div className="empty-symbol">
                        <Upload size={30} />
                      </div>
                      <h2>Bring your shoot into focus.</h2>
                      <p>
                        Drop photos here, or choose files or a folder to get
                        started.
                      </p>
                      <div className="row">
                        <button
                          className="primary"
                          onClick={() => importPhotos()}
                        >
                          <Plus size={16} /> Import photos
                        </button>
                        <button onClick={() => importPhotos(true)}>
                          <FolderOpen size={16} /> Import folder
                        </button>
                      </div>
                      <small>
                        JPEG, PNG, TIFF, HEIC & 28 camera RAW extensions
                      </small>
                    </div>
                  ) : !photos.length ? (
                    <div className="photo-empty">
                      <Search size={30} />
                      <h3>No photos in this view</h3>
                      <p>Try another category or clear your filters.</p>
                      <button
                        onClick={() => {
                          setFilter("All");
                          setMinRating(0);
                          setQuery("");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : view === "grid" ? (
                    <div className="photo-grid-scroll">
                      <div
                        className="photo-grid"
                        style={{
                          gridTemplateColumns: `repeat(auto-fill,minmax(${size}px,1fr))`,
                        }}
                      >
                        {photos.map((p, i) => (
                          <PhotoCard
                            key={p.id}
                            photo={p}
                            index={i}
                            active={activeId === p.id}
                            selected={selected.includes(p.id)}
                            onClick={(e) => choose(p, e)}
                            onDoubleClick={() => {
                              setActiveId(p.id);
                              setSelected([p.id]);
                              setView("loupe");
                            }}
                            onRate={(n) => patch({ rating: n }, [p.id])}
                          />
                        ))}
                      </div>
                    </div>
                  ) : view === "survey" ? (
                    <div className="survey-grid">
                      {(selected.length > 1
                        ? photos.filter((p) => selected.includes(p.id))
                        : photos.slice(
                            Math.max(
                              0,
                              photos.findIndex((p) => p.id === activeId),
                            ),
                            Math.max(
                              0,
                              photos.findIndex((p) => p.id === activeId),
                            ) + 4,
                          )
                      )
                        .slice(0, 4)
                        .map((p) => (
                          <div
                            className={
                              "survey-photo " +
                              (activeId === p.id ? "active" : "")
                            }
                            key={p.id}
                            onClick={() => {
                              setActiveId(p.id);
                            }}
                          >
                            <img src={imageURL(p)} alt={p.name} />
                            <div>
                              <span>{p.name}</span>
                              <span
                                style={{ color: categoryColor[p.category] }}
                              >
                                {p.category}
                              </span>
                            </div>
                            <div className="survey-actions">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patch(
                                    {
                                      category: "Selected",
                                      rating: 4,
                                      label: "Green",
                                    },
                                    [p.id],
                                  );
                                }}
                              >
                                <Check size={14} /> Keep
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patch(
                                    {
                                      category: "Rejected",
                                      rating: 1,
                                      label: "Red",
                                    },
                                    [p.id],
                                  );
                                }}
                              >
                                <X size={14} /> Reject
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : active ? (
                    <div className="loupe">
                      <div className="loupe-stage">
                        <ZoomSurface
                          key={active.id}
                          scale={zoom}
                          onScale={setZoom}
                        >
                          <Preview
                            key={active.id}
                            photoId={active.id}
                            originalURL={imageURL(active)}
                            alt={active.name}
                            albumId={album.id}
                            edits={
                              tab === "Edit" && editDraft?.id === active.id
                                ? editDraft.edits
                                : active.edits
                            }
                            onError={setError}
                          />
                        </ZoomSurface>
                        <div className="loupe-overlay">
                          <span>
                            {active.name} · {Math.round(zoom * 100)}% · Pinch to
                            zoom
                          </span>
                          <IconButton
                            title={zoom > 1 ? "Fit image" : "Zoom image"}
                            onClick={() => setZoom(zoom > 1 ? 1 : 2)}
                          >
                            {zoom > 1 ? (
                              <ZoomOut size={17} />
                            ) : (
                              <ZoomIn size={17} />
                            )}
                          </IconButton>
                        </div>
                        <button
                          className="prev-photo"
                          aria-label="Previous photo"
                          onClick={() => move(-1)}
                        >
                          <ChevronLeft size={23} />
                        </button>
                        <button
                          className="next-photo"
                          aria-label="Next photo"
                          onClick={() => move(1)}
                        >
                          <ChevronRight size={23} />
                        </button>
                      </div>
                      <div className="filmstrip">
                        {photos.map((p) => (
                          <button
                            key={p.id}
                            className={p.id === activeId ? "active" : ""}
                            onClick={() => {
                              setActiveId(p.id);
                              setSelected([p.id]);
                            }}
                          >
                            <img src={imageURL(p, true)} alt={p.name} />
                            <span
                              style={{ background: categoryColor[p.category] }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="photo-status">
                    <span>
                      {selected.length
                        ? `${selected.length} selected`
                        : `${photos.length} photos`}{" "}
                      <span className="muted">
                        · {count("Selected")} keepers
                      </span>
                    </span>
                    <div className="row">
                      <span className="muted">
                        {view === "grid" ? "Thumbnail size" : "← → Navigate"}
                      </span>
                      {view === "grid" && (
                        <input
                          aria-label="Thumbnail size"
                          type="range"
                          min="150"
                          max="330"
                          value={size}
                          onChange={(e) => setSize(Number(e.target.value))}
                        />
                      )}
                      <button
                        className="text-button"
                        onClick={() => setModal("help")}
                      >
                        <Keyboard size={14} /> Shortcuts
                      </button>
                    </div>
                  </div>
                </section>
                <aside className="inspector">
                  {active ? (
                    <>
                      <div className="inspector-title">
                        {tab === "Edit" ? (
                          <>
                            <SlidersHorizontal size={15} /> EDIT PHOTO
                          </>
                        ) : (
                          <>
                            <Info size={15} /> PHOTO DETAILS
                          </>
                        )}
                      </div>
                      <div className="inspector-image">
                        <img src={imageURL(active, true)} alt="Active photo" />
                      </div>
                      <div className="inspector-file">
                        <strong title={active.name}>{active.name}</strong>
                        <span>
                          {active.width} × {active.height} <span>·</span>{" "}
                          {(active.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      {tab === "Edit" ? (
                        <>
                          <AIEditor
                            key={"ai-" + active.id}
                            albumId={album.id}
                            photoId={active.id}
                            onPreview={(edits) => {
                              setEditDraft({ id: active.id, edits });
                              setView("loupe");
                            }}
                            onBefore={() => setEditDraft(null)}
                          />
                          <Editor
                            albumId={album.id}
                            onBusy={(value) => {
                              setBusy(value);
                              if (!value) setProgress(null);
                            }}
                            key={active.id}
                            photo={active}
                            edits={
                              editDraft?.id === active.id
                                ? editDraft.edits
                                : active.edits
                            }
                            onChange={(edits) => {
                              setEditDraft({ id: active.id, edits });
                              setView("loupe");
                            }}
                            onSave={async (edits) => {
                              await patch({ edits }, [active.id]);
                              setEditDraft(null);
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <div className="inspector-section">
                            <div className="label">SELECTION</div>
                            <div className="decision">
                              <span
                                className="category-dot"
                                style={{
                                  background: categoryColor[active.category],
                                }}
                              />
                              {active.category === "Maybe"
                                ? "Needs review"
                                : active.category}
                            </div>
                            <div className="rating-stars">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                  key={n}
                                  aria-label={`Rate ${n} stars`}
                                  onClick={() =>
                                    patch({ rating: n }, [active.id])
                                  }
                                >
                                  <Star
                                    size={21}
                                    fill={
                                      n <= active.rating
                                        ? "currentColor"
                                        : "none"
                                    }
                                    className={
                                      n <= active.rating ? "filled" : ""
                                    }
                                  />
                                </button>
                              ))}
                            </div>
                            <div className="decision-buttons">
                              <button
                                className={
                                  active.category === "Selected"
                                    ? "keep active"
                                    : "keep"
                                }
                                onClick={() =>
                                  patch({
                                    category: "Selected",
                                    label: "Green",
                                    rating: 4,
                                  })
                                }
                              >
                                <Check size={16} /> Keep <kbd>P</kbd>
                              </button>
                              <button
                                onClick={() =>
                                  patch({
                                    category: "Rejected",
                                    label: "Red",
                                    rating: 1,
                                  })
                                }
                              >
                                <X size={16} /> Reject <kbd>X</kbd>
                              </button>
                            </div>
                            <select
                              className="full"
                              aria-label="Photo category"
                              value={active.category}
                              onChange={(e) =>
                                patch({
                                  category: e.target.value as Photo["category"],
                                })
                              }
                            >
                              {categories.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                          <div className="inspector-section">
                            <div className="label">
                              {active.ai
                                ? "AI RECOMMENDATION"
                                : "LOCAL MEASUREMENTS"}
                            </div>
                            {active.ai ? (
                              <>
                                <p className="ai-reason">{active.ai.reason}</p>
                                <span className="muted">
                                  {Math.round(active.ai.confidence * 100)}%
                                  model-reported confidence
                                </span>
                                <p className="fine-print">
                                  Confidence is not a calibrated probability.
                                </p>
                              </>
                            ) : (
                              <>
                                <Measure
                                  label="Focus detail"
                                  value={Math.min(
                                    100,
                                    Math.log2(active.analysis.sharpness + 1) *
                                      10,
                                  )}
                                  text={active.analysis.sharpness.toFixed(0)}
                                />
                                <Measure
                                  label="Brightness"
                                  value={
                                    (active.analysis.brightness / 255) * 100
                                  }
                                  text={active.analysis.brightness + "/255"}
                                />
                                <p className="fine-print">
                                  Image statistics support your review.
                                  Intentional softness can score low.
                                </p>
                              </>
                            )}
                            {active.exposure && (
                              <div className="warning">
                                <Sun size={14} />
                                {active.exposure}
                              </div>
                            )}
                            {active.group &&
                              album.photos.filter(
                                (p) => p.group === active.group,
                              ).length > 1 && (
                                <button
                                  className="full"
                                  onClick={() => {
                                    setSelected(
                                      album.photos
                                        .filter((p) => p.group === active.group)
                                        .map((p) => p.id),
                                    );
                                    setFilter("All");
                                    setView("survey");
                                  }}
                                >
                                  <Copy size={14} /> Compare similar photos
                                </button>
                              )}
                          </div>
                          {Object.keys(active.exif).length > 0 && (
                            <div className="inspector-section">
                              <div className="label">CAMERA</div>
                              <p className="camera-model">
                                <Camera size={14} />
                                {active.exif.Model ||
                                  active.exif.Make ||
                                  "Camera metadata"}
                              </p>
                              <div className="exif-grid">
                                {[
                                  "ISO",
                                  "FNumber",
                                  "ExposureTime",
                                  "FocalLength",
                                ].map(
                                  (k) =>
                                    active.exif[k] !== undefined && (
                                      <div key={k}>
                                        <span>
                                          {k === "FNumber"
                                            ? "Aperture"
                                            : k === "ExposureTime"
                                              ? "Shutter"
                                              : k === "FocalLength"
                                                ? "Focal length"
                                                : k}
                                        </span>
                                        <strong>
                                          {k === "FNumber"
                                            ? "ƒ/" + active.exif[k]
                                            : k === "ExposureTime"
                                              ? (Number(active.exif[k]) < 1
                                                  ? "1/" +
                                                    Math.round(
                                                      1 /
                                                        Number(active.exif[k]),
                                                    )
                                                  : active.exif[k]) + "s"
                                              : k === "FocalLength"
                                                ? active.exif[k] + " mm"
                                                : active.exif[k]}
                                        </strong>
                                      </div>
                                    ),
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {active.converted && (
                        <p className="preview-note">
                          RAW / HEIC preview uses macOS decoding. Camera support
                          varies.
                        </p>
                      )}
                      <button
                        className="reveal"
                        onClick={() =>
                          api
                            .reveal(album.id, active.id)
                            .catch((e) => setError(e.message))
                        }
                      >
                        <FolderOpen size={14} /> Show original in Finder{" "}
                        <ArrowUpRight size={13} />
                      </button>
                    </>
                  ) : (
                    <div className="inspector-empty">
                      <ImageIcon size={28} />
                      <p>Select a photo to see its details.</p>
                    </div>
                  )}
                </aside>
              </div>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <Info size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setModal(null);
          }}
        >
          <section
            className={
              "modal " +
              (modal === "cull"
                ? "cull-modal"
                : modal === "quick-preview"
                  ? "batch-modal quick-modal"
                  : modal === "batch-edit"
                    ? "batch-modal"
                    : "")
            }
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                "batch-edit": "AI auto edit",
                "quick-preview": "Quick Preview",
                import: "Import file types",
                new: "Create album",
                rename: "Rename album",
                cull: "Culling preferences",
                export: "Export photos",
                settings: "Settings",
                help: "Keyboard shortcuts",
                report: "Operation report",
              }[modal]
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
              disabled={busy}
            >
              <X size={19} />
            </button>
            {modal === "quick-preview" && album && (
              <QuickPreview
                album={album}
                auth={auth}
                onConnect={() => {
                  api
                    .signIn()
                    .then(setAuth)
                    .catch((e) => setError(e.message));
                }}
                onBusy={(value) => {
                  setBusy(value);
                  if (!value) setProgress(null);
                }}
                onAlbum={(a) => {
                  setAlbum(a);
                  setEditDraft(null);
                  refresh();
                }}
              />
            )}
            {modal === "batch-edit" && album && (
              <BatchEditor
                album={album}
                picked={selected}
                auth={auth}
                onConnect={() => {
                  api
                    .signIn()
                    .then(setAuth)
                    .catch((e) => setError(e.message));
                }}
                onBusy={(value) => {
                  setBusy(value);
                  if (!value) setProgress(null);
                }}
                onAlbum={(a) => {
                  setAlbum(a);
                  setEditDraft(null);
                  refresh();
                }}
              />
            )}
            {modal === "import" && importPlan && album && (
              <>
                <div className="modal-icon">
                  <Upload size={25} />
                </div>
                <h2>Bring in just what you need.</h2>
                <p className="modal-subtitle">
                  {importPlan.source} · {importPlan.total} supported files
                  {importPlan.duplicates
                    ? ` · ${importPlan.duplicates} already imported`
                    : ""}
                </p>
                <div className="import-presets">
                  {[
                    ["all", "All supported"],
                    ["raw", "RAW only"],
                    ["jpeg", "JPEG only"],
                    ["custom", "Custom types"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={importPreset === value ? "active" : ""}
                      onClick={() => {
                        setImportPreset(value);
                        localStorage.setItem("openshoot-import-preset", value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="file-type-list">
                  {Object.entries(importPlan.counts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([ext, count]) => (
                      <label
                        key={ext}
                        className={importTypes.includes(ext) ? "included" : ""}
                      >
                        <input
                          type="checkbox"
                          checked={importTypes.includes(ext)}
                          onChange={() => {
                            const current = importTypes;
                            const next = current.includes(ext)
                              ? current.filter((v) => v !== ext)
                              : [...current, ext];
                            setImportPreset("custom");
                            setCustomTypes(next);
                            localStorage.setItem(
                              "openshoot-import-preset",
                              "custom",
                            );
                            localStorage.setItem(
                              "openshoot-import-types",
                              JSON.stringify(next),
                            );
                          }}
                        />
                        <strong>{ext.slice(1).toUpperCase()}</strong>
                        <span>
                          {importPlan.fileTypes[ext]?.label || "Image"}
                        </span>
                        <b>{count.toLocaleString()}</b>
                      </label>
                    ))}
                </div>
                {!Object.keys(importPlan.counts).length && (
                  <p className="fine-print">
                    No new supported photos were found. Files already in the
                    album are skipped.
                  </p>
                )}
                <div className="import-summary">
                  <ImageIcon size={18} />
                  <span>
                    <strong>{importCount.toLocaleString()}</strong> files will
                    be imported
                  </span>
                  <span>{importPlan.total - importCount} excluded</span>
                </div>
                <div className="info-box">
                  <ShieldCheck size={17} />
                  <span>
                    Only checked file types are imported. RAW previews depend on
                    your camera and macOS decoder; any unreadable files appear
                    in the import report. Originals stay in their current
                    location.
                  </span>
                </div>
                <div className="modal-footer">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="primary"
                    disabled={busy || !importCount}
                    onClick={() => {
                      setModal(null);
                      run(
                        () =>
                          api.import(album.id, importPlan.token, importTypes),
                        importResult,
                      );
                    }}
                  >
                    <Upload size={16} /> Import {importCount.toLocaleString()}{" "}
                    files
                  </button>
                </div>
              </>
            )}
            {(modal === "new" || modal === "rename") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (modal === "rename" && album)
                    run(
                      () => api.rename(album.id, name),
                      (a) => {
                        setAlbum(a);
                        setModal(null);
                      },
                    );
                  else
                    run(
                      () => api.create(name, genre),
                      (a) => {
                        setAlbum(a);
                        setSelected([]);
                        setActiveId("");
                        setModal(null);
                        setFilter("All");
                        setQuery("");
                      },
                    );
                }}
              >
                <div className="modal-icon">
                  <FolderPlus size={25} />
                </div>
                <h2>
                  {modal === "rename"
                    ? "Rename album"
                    : "Every shoot has a story."}
                </h2>
                <p className="modal-subtitle">
                  {modal === "rename"
                    ? "Give this collection a name that feels right."
                    : "Give yours a home. You can import photos in the next step."}
                </p>
                <label className="field">
                  Album name
                  <input
                    autoFocus
                    required
                    placeholder="e.g. A weekend in the mountains"
                    maxLength={150}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {modal === "new" && (
                  <label className="field">
                    Photography genre
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                    >
                      {genres.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="modal-footer">
                  <button type="button" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary"
                    type="submit"
                    disabled={!name.trim() || busy}
                  >
                    {modal === "rename" ? "Save name" : "Create album"}{" "}
                    <ChevronRight size={16} />
                  </button>
                </div>
              </form>
            )}
            {modal === "cull" && album && (
              <>
                <div className="modal-icon">
                  <Sparkles size={25} />
                </div>
                <h2>A first pass. Your final say.</h2>
                <p className="modal-subtitle">
                  Find the keepers in {album.photos.length} photos. Culling
                  replaces existing ratings and categories; you can undo it
                  during this session.
                </p>
                <div className="engine-options">
                  <button
                    className={engine === "local" ? "active" : ""}
                    onClick={() => setEngine("local")}
                  >
                    <Monitor size={20} />
                    <strong>Local culling</strong>
                    <small>Fast, offline image analysis</small>
                  </button>
                  <button
                    className={engine === "chatgpt" ? "active" : ""}
                    onClick={() => {
                      setEngine("chatgpt");
                      if (auth.enabled) loadModels();
                    }}
                  >
                    <Sparkles size={20} />
                    <strong>ChatGPT assisted</strong>
                    <small>Visual review using your plan</small>
                  </button>
                </div>
                {engine === "local" ? (
                  <>
                    <div className="segmented full">
                      {["quality", "target"].map((m) => (
                        <button
                          key={m}
                          className={settings.mode === m ? "active" : ""}
                          onClick={() =>
                            setSettings((s) => ({ ...s, mode: m }))
                          }
                        >
                          {m === "quality"
                            ? "Cull by quality"
                            : "Cull to a target"}
                        </button>
                      ))}
                    </div>
                    {settings.mode === "target" && (
                      <label className="field">
                        Number of selected photos
                        <input
                          type="number"
                          min={1}
                          max={album.photos.length}
                          value={settings.target}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              target: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                    <div className="preference-row">
                      <div>
                        <strong>Group similar photos</strong>
                        <p>Retain the sharper representative in each group.</p>
                      </div>
                      <input
                        aria-label="Group similar photos"
                        type="checkbox"
                        checked={settings.duplicates}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            duplicates: e.target.checked,
                          }))
                        }
                      />
                    </div>
                    <div className="field inline">
                      <label htmlFor="similarity">Similarity threshold</label>
                      <select
                        id="similarity"
                        value={settings.similarity}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            similarity: e.target.value,
                          }))
                        }
                      >
                        <option value="strict">Strict · very similar</option>
                        <option value="standard">Standard</option>
                        <option value="loose">Loose · broader groups</option>
                      </select>
                    </div>
                    <div className="preference-row">
                      <div>
                        <strong>Flag potentially blurry photos</strong>
                        <p>Use focus detail to highlight photos for review.</p>
                      </div>
                      <input
                        aria-label="Detect blur"
                        type="checkbox"
                        checked={settings.detectBlur}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            detectBlur: e.target.checked,
                          }))
                        }
                      />
                    </div>
                    <div className="field inline">
                      <label htmlFor="blur">Blur sensitivity</label>
                      <select
                        id="blur"
                        value={settings.blur}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, blur: e.target.value }))
                        }
                      >
                        <option value="low">Low</option>
                        <option value="standard">Standard</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div className="info-box">
                      <ShieldCheck size={17} />
                      <span>
                        Runs on this computer. Local analysis measures focus,
                        exposure, and visual similarity; it does not detect
                        closed eyes.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    {auth.enabled ? (
                      <>
                        <label className="field">
                          ChatGPT model
                          <select
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                          >
                            <option value="">Choose an available model</option>
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="info-box">
                          <Info size={18} />
                          <span>
                            Previews of all {album.photos.length} photos are
                            sent to OpenAI in groups of six. This uses your
                            ChatGPT plan allowance. Originals stay on your
                            computer.
                          </span>
                        </div>
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          <span>
                            Send these photo previews to OpenAI for culling
                            recommendations.
                          </span>
                        </label>
                        {queue && (
                          <div className="saved-queue">
                            <RefreshCw size={16} />
                            <span>
                              Saved queue: {queue.done} of {queue.total}{" "}
                              assessed using {queue.model}
                            </span>
                            <button
                              className="text-button"
                              onClick={() =>
                                run(
                                  () => api.aiDiscard(album.id),
                                  () => setQueue(null),
                                )
                              }
                            >
                              Discard
                            </button>
                          </div>
                        )}
                        <p className="fine-print">
                          Low-confidence results are sent to Needs review. Your
                          ratings change only when the full queue finishes.
                          Pausing saves completed groups.
                        </p>
                      </>
                    ) : (
                      <div className="connect-card">
                        <Sparkles size={28} />
                        <h3>Connect your ChatGPT account</h3>
                        <p>
                          Authorize OpenShoot to use your ChatGPT plan. Model
                          availability and usage limits depend on your account.
                        </p>
                        <button
                          className="primary"
                          onClick={() => setModal("settings")}
                        >
                          Open connection settings <ArrowUpRight size={16} />
                        </button>
                      </div>
                    )}
                  </>
                )}
                <div className="modal-footer">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      (engine === "chatgpt" &&
                        (!auth.enabled || !model || !consent))
                    }
                    onClick={() => {
                      const id = album.id;
                      setModal(null);
                      run(
                        () =>
                          engine === "local"
                            ? api.cull(id, settings)
                            : api.aiCull(id, model),
                        (a) => {
                          setAlbum(a);
                          setFilter("All");
                          setNotice(
                            `${a.photos.filter((p) => p.category === "Selected").length} keepers found. Ready for your review.`,
                          );
                        },
                      );
                    }}
                  >
                    <Sparkles size={16} />
                    {engine === "chatgpt" && queue
                      ? "Resume AI queue"
                      : engine === "chatgpt"
                        ? "Send previews & start"
                        : "Start culling"}
                  </button>
                </div>
              </>
            )}
            {modal === "export" && album && (
              <>
                <div className="modal-icon">
                  <Download size={25} />
                </div>
                <h2>Ready for what comes next.</h2>
                <p className="modal-subtitle">
                  Export your photos and ratings into a new folder.
                </p>
                <label className="field">
                  Photos to export
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <option value="selected">
                      Selected keepers ({count("Selected")})
                    </option>
                    <option value="rated">
                      Rated 4 stars and up (
                      {album.photos.filter((p) => p.rating >= 4).length})
                    </option>
                    <option value="all">
                      All photos ({album.photos.length})
                    </option>
                  </select>
                </label>
                <label className="field">
                  Export format
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="original">
                      Original files + XMP ratings
                    </option>
                    <option value="jpeg">Edited JPEGs + XMP ratings</option>
                    <option value="xmp">XMP rating sidecars only</option>
                  </select>
                </label>
                {format === "jpeg" && (
                  <label className="field">
                    Output size
                    <select
                      value={exportPreset ? "preset:" + exportPreset : maxSize}
                      onChange={(e) => {
                        if (e.target.value.startsWith("preset:"))
                          setExportPreset(e.target.value.slice(7));
                        else {
                          setExportPreset("");
                          setMaxSize(e.target.value);
                        }
                      }}
                    >
                      <option value="">Full resolution, when decodable</option>
                      <option value="4000">4000 px</option>
                      <option value="2400">2400 px</option>
                      <option value="1600">1600 px</option>
                      {Object.entries(exportPresets).map(([key, p]) => (
                        <option key={key} value={"preset:" + key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <small>
                      Social sizes preserve your saved framing and add borders
                      when needed. Use AI framing first for a crop that fills
                      the canvas.
                    </small>
                  </label>
                )}
                <div className="info-box">
                  <ShieldCheck size={18} />
                  <span>
                    Exports go into a unique OpenShoot folder. XMP stores stars,
                    color labels, and category keywords. OpenShoot edits are
                    rendered into JPEGs and recorded in the manifest.
                  </span>
                </div>
                <div className="modal-footer">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !album.photos.some(
                        (p) =>
                          scope === "all" ||
                          (scope === "selected" && p.category === "Selected") ||
                          (scope === "rated" && p.rating >= 4),
                      )
                    }
                    onClick={() => {
                      setModal(null);
                      run(
                        () =>
                          api.export(album.id, {
                            scope,
                            format,
                            maxSize,
                            preset:
                              format === "jpeg" ? exportPreset : undefined,
                          }),
                        (r) => {
                          if (!r) return;
                          setReport({
                            title: r.cancelled
                              ? "Export stopped"
                              : "Your export is ready",
                            lines: [
                              `${r.written} photos exported`,
                              r.folder,
                              ...r.failures.map(
                                (e) => e.file + " — " + e.error,
                              ),
                            ],
                            exported: true,
                          });
                          setModal("report");
                        },
                      );
                    }}
                  >
                    <FolderOpen size={16} /> Choose destination
                  </button>
                </div>
              </>
            )}
            {modal === "settings" && (
              <>
                <div className="modal-icon">
                  <Settings size={25} />
                </div>
                <h2>Workspace settings</h2>
                <p className="modal-subtitle">
                  Your local library, with optional ChatGPT assistance.
                </p>
                <div className="settings-card">
                  <div className="row">
                    <Sparkles size={20} />
                    <h3>ChatGPT connection</h3>
                    {auth.enabled && (
                      <span className="status green">Connected</span>
                    )}
                  </div>
                  <p>
                    {auth.connected
                      ? auth.email || "ChatGPT account connected"
                      : "Sign in to use your ChatGPT subscription for photo culling, editing, and cropping."}
                  </p>
                  <p className="fine-print">
                    OpenShoot has its own authorization. Photos are sent only
                    when you explicitly start an AI analysis. Tokens are
                    encrypted using the operating system credential store.
                  </p>
                  {auth.connected ? (
                    <div className="row">
                      <button
                        onClick={() =>
                          run(
                            () => api.disconnect(),
                            (a) => {
                              setAuth(a);
                              setModels([]);
                              setModel("");
                            },
                          )
                        }
                      >
                        Disconnect ChatGPT
                      </button>
                      {!auth.enabled && (
                        <button
                          className="primary"
                          onClick={() => run(() => api.signIn(), setAuth)}
                        >
                          Enable plan usage
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      className="chatgpt-button"
                      disabled={auth.pending || busy}
                      onClick={() => run(() => api.signIn(), setAuth)}
                    >
                      {auth.pending ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}{" "}
                      {auth.pending
                        ? "Continue in your browser…"
                        : "Continue with ChatGPT"}{" "}
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                  {auth.connected && !auth.enabled && (
                    <p className="warning">
                      Sign-in succeeded, but ChatGPT plan usage was not granted.
                    </p>
                  )}
                </div>
                <div className="settings-card">
                  <div className="row">
                    <Sparkles size={20} />
                    <h3>AI editing & cropping</h3>
                  </div>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={aiPreferences.sharePreviews}
                      onChange={(e) =>
                        updateAIPreferences({ sharePreviews: e.target.checked })
                      }
                    />
                    Allow photo preview sharing with OpenAI
                  </label>
                  <p className="fine-print">
                    Remembered across photos and restarts. Previews are sent
                    only when you click Suggest adjustments. Turn this off to
                    require permission again. AI culling keeps its separate
                    consent control.
                  </p>
                </div>
                <div className="settings-card">
                  <div className="row">
                    <Archive size={19} />
                    <h3>Archived albums</h3>
                  </div>
                  <p>
                    Archiving hides an album. Original photos and album data are
                    preserved.
                  </p>
                  <button
                    onClick={() =>
                      run(
                        () => api.restore(),
                        () => setNotice("Archived albums restored"),
                      )
                    }
                  >
                    <RefreshCw size={14} /> Restore archived albums
                  </button>
                </div>
                <div className="settings-version">
                  <img src="./openshoot-icon.png" alt="" />
                  <span>
                    OpenShoot {appVersion}{" "}
                    <small>Independent implementation · local first</small>
                  </span>
                </div>
              </>
            )}
            {modal === "help" && (
              <>
                <div className="modal-icon">
                  <Keyboard size={25} />
                </div>
                <h2>A little less clicking.</h2>
                <p className="modal-subtitle">
                  Keyboard shortcuts for a focused review.
                </p>
                <div className="shortcut-list">
                  {[
                    ["Keep photo", "P"],
                    ["Reject photo", "X"],
                    ["Clear selection status", "U"],
                    ["Rate photo", "0 – 5"],
                    ["Previous / next photo", "← / →"],
                    ["Grid / Loupe / Survey", "G / E / S"],
                    ["Toggle grid & loupe", "Space"],
                    ["Undo photo changes", "⌘ Z"],
                    ["Select all visible", "⌘ A"],
                    ["Select a range", "Shift + click"],
                    ["Select multiple", "⌘ + click"],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <div className="info-box">
                  <Info size={17} />
                  <span>
                    OpenShoot helps you select, edit and finish your photos.
                    Camera RAW support depends on your macOS decoder. Local
                    scores and AI recommendations always need photographic
                    judgment.
                  </span>
                </div>
              </>
            )}
            {modal === "report" && report && (
              <>
                <div className="modal-icon">
                  <CheckCircle2 size={25} />
                </div>
                <h2>{report.title}</h2>
                <div className="report-lines">
                  {report.lines.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
                <div className="modal-footer">
                  <button onClick={() => setModal(null)}>Close</button>
                  {report.exported && (
                    <button
                      className="primary"
                      onClick={() =>
                        api.openExport().catch((e) => setError(e.message))
                      }
                    >
                      <FolderOpen size={16} /> Open export folder
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {busy && (
        <div className="busy-backdrop">
          <WorkProgress
            progress={progress}
            quickPreview={modal === "quick-preview"}
            matchingEnabled={
              aiPreferences.matchSet && aiPreferences.quickMode !== "crop"
            }
            onCancel={() => api.cancel()}
            onError={setError}
          />
        </div>
      )}
      {dropping && (
        <div className="drop-overlay">
          <Upload size={46} />
          <h2>Drop your next story here.</h2>
          <p>Photos and folders stay on this computer.</p>
        </div>
      )}
    </div>
  );
}
function PhotoCard({
  photo: p,
  index,
  active,
  selected,
  onClick,
  onDoubleClick,
  onRate,
}: {
  photo: Photo;
  index: number;
  active: boolean;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRate: (n: number) => void;
}) {
  return (
    <article
      className={
        "photo-card " + (active ? "active " : "") + (selected ? "chosen" : "")
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDoubleClick();
      }}
      aria-label={p.name}
    >
      <div className="photo-image">
        <img loading="lazy" src={imageURL(p, true)} alt={p.name} />
        <span className="photo-index">
          {String(index + 1).padStart(2, "0")}
        </span>
        {selected && (
          <span className="selection-check">
            <Check size={12} />
          </span>
        )}
        <span
          className="photo-category"
          style={{
            color: categoryColor[p.category],
            borderColor: categoryColor[p.category] + "55",
          }}
        >
          <span style={{ background: categoryColor[p.category] }} />
          {p.category === "Maybe" ? "Review" : p.category}
        </span>
      </div>
      <div className="photo-card-info">
        <span title={p.name}>{p.name}</span>
        <div className="card-stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              aria-label={`Rate ${p.name} ${n} stars`}
              onClick={(e) => {
                e.stopPropagation();
                onRate(n);
              }}
            >
              <Star
                size={11}
                fill={p.rating >= n ? "currentColor" : "none"}
                className={p.rating >= n ? "filled" : ""}
              />
            </button>
          ))}
        </div>
      </div>
      <div
        className="card-category-line"
        style={{ background: categoryColor[p.category] }}
      />
    </article>
  );
}
function Measure({
  label,
  value,
  text,
}: {
  label: string;
  value: number;
  text: string;
}) {
  return (
    <div className="measure">
      <div>
        <span>{label}</span>
        <strong>{text}</strong>
      </div>
      <div className="measure-track">
        <span style={{ width: Math.max(0, Math.min(100, value)) + "%" }} />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
