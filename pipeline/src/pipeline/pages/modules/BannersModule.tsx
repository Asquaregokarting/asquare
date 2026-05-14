import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";
import { DataTable } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { carouselConfigApi } from "../../api/carousel-config-firestore";
import type { CarouselSlide, CarouselConfig } from "../../api/carousel-config-firestore";
import SlidePreview from "./banners/SlidePreview";

const SlideEditor = lazy(() => import("./banners/SlideEditor"));

export type BannersView = "list" | "edit";

const subnav = [
  { label: "All Slides", to: "/banners/list" },
];

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

const SlideListView = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<CarouselConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CarouselSlide | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [intervalInput, setIntervalInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await carouselConfigApi.getConfig();
      setConfig(cfg);
      setIntervalInput(String(Math.round(cfg.autoRotateInterval / 1000)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load carousel config.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (slide: CarouselSlide) => {
    setToggling(slide.id);
    try {
      await carouselConfigApi.toggleSlide(slide.id, !slide.isActive);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle slide.");
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await carouselConfigApi.deleteSlide(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete slide.");
    } finally {
      setDeleting(false);
    }
  };

  const handleMoveUp = async (slide: CarouselSlide) => {
    if (!config) return;
    const slides = [...config.slides];
    const idx = slides.findIndex((s) => s.id === slide.id);
    if (idx <= 0) return;
    [slides[idx - 1], slides[idx]] = [slides[idx], slides[idx - 1]];
    const ids = slides.map((s) => s.id);
    try {
      await carouselConfigApi.reorderSlides(ids);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder.");
    }
  };

  const handleMoveDown = async (slide: CarouselSlide) => {
    if (!config) return;
    const slides = [...config.slides];
    const idx = slides.findIndex((s) => s.id === slide.id);
    if (idx < 0 || idx >= slides.length - 1) return;
    [slides[idx], slides[idx + 1]] = [slides[idx + 1], slides[idx]];
    const ids = slides.map((s) => s.id);
    try {
      await carouselConfigApi.reorderSlides(ids);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder.");
    }
  };

  const handleIntervalSave = async () => {
    if (!config) return;
    const ms = Math.max(5, Number(intervalInput) || 100) * 1000;
    try {
      await carouselConfigApi.saveConfig({ ...config, autoRotateInterval: ms });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save interval.");
    }
  };

  const slides = config?.slides ?? [];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">Auto-rotate (seconds)</label>
          <input
            type="number"
            min={5}
            value={intervalInput}
            onChange={(e) => setIntervalInput(e.target.value)}
            title="Auto-rotate interval in seconds"
            className="w-20 rounded-lg border border-border/40 bg-surface px-3 py-1.5 text-sm text-text focus:border-accent/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleIntervalSave}
            className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors"
          >
            Update
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate("/banners/edit")}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-panel transition-all hover:translate-y-[-1px] hover:shadow-lg"
        >
          + Add New Slide
        </button>
      </div>

      {/* Slides Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading slides...</div>
      ) : (
        <DataTable
          columns={[
            {
              key: "preview",
              header: "Preview",
              render: (slide) => (
                <div className="w-64">
                  <SlidePreview slide={slide} />
                </div>
              ),
            },
            {
              key: "title",
              header: "Title",
              render: (slide) => (
                <div>
                  <p className="font-semibold text-text">{slide.title || "(untitled)"}</p>
                  <p className="text-xs text-muted mt-0.5">{slide.badgeText}</p>
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (slide) => (
                <StatusBadge tone={slide.isActive ? "success" : "muted"}>{slide.isActive ? "Active" : "Inactive"}</StatusBadge>
              ),
            },
            {
              key: "position",
              header: "Order",
              render: (slide) => (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleMoveUp(slide); }}
                    disabled={slide.position === 0}
                    className="rounded p-1 text-muted hover:text-text hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move up"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <span className="text-sm text-muted w-6 text-center">{slide.position + 1}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleMoveDown(slide); }}
                    disabled={slide.position === slides.length - 1}
                    className="rounded p-1 text-muted hover:text-text hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move down"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </div>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              render: (slide) => (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/banners/edit/${slide.id}`); }}
                    className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-semibold text-muted hover:text-text hover:border-border transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleToggle(slide); }}
                    disabled={toggling === slide.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${slide.isActive ? "bg-warning/10 text-warning hover:bg-warning/20" : "bg-success/10 text-success hover:bg-success/20"}`}
                  >
                    {toggling === slide.id ? "..." : slide.isActive ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(slide); }}
                    className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
          rows={slides}
          rowKey={(slide) => slide.id}
          emptyMessage="No carousel slides configured."
          onRowClick={(slide) => navigate(`/banners/edit/${slide.id}`)}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          open
          title="Delete Slide"
          description={`Are you sure you want to delete "${deleteTarget.title || "this slide"}"? This cannot be undone.`}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Edit View
// ---------------------------------------------------------------------------

const SlideEditView = () => {
  const navigate = useNavigate();
  const { slideId } = useParams<{ slideId: string }>();
  const [slide, setSlide] = useState<CarouselSlide | null>(null);
  const [previewSlide, setPreviewSlide] = useState<CarouselSlide | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSlide = async () => {
      setLoading(true);
      try {
        if (slideId) {
          const config = await carouselConfigApi.getConfig();
          const found = config.slides.find((s) => s.id === slideId);
          setSlide(found ?? null);
          if (!found) setError("Slide not found.");
        } else {
          setSlide(carouselConfigApi.createEmptySlide());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load slide.");
      } finally {
        setLoading(false);
      }
    };
    void loadSlide();
  }, [slideId]);

  const handleSave = async (updated: CarouselSlide) => {
    setSaving(true);
    setError(null);
    try {
      await carouselConfigApi.upsertSlide(updated);
      navigate("/banners/list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save slide.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted">Loading...</div>;
  }

  if (!slide) {
    return <div className="py-12 text-center text-sm text-danger">{error || "Slide not found."}</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr,400px]">
        {/* Editor */}
        <div>
          <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading editor...</div>}>
            <SlideEditor
              slide={slide}
              onSave={handleSave}
              onCancel={() => navigate("/banners/list")}
              onChange={setPreviewSlide}
              saving={saving}
            />
          </Suspense>
        </div>

        {/* Live Preview */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Live Preview</h3>
          <SlidePreview slide={previewSlide ?? slide} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const BannersModule = ({ view = "list" }: { view?: BannersView }) => {
  const title = view === "edit" ? "Edit Slide" : "Banner Carousel";
  const subtitle = view === "edit"
    ? "Configure slide content, colors, and buttons"
    : "Manage the customer-facing carousel on the Activities page";

  return (
    <ModulePageLayout
      moduleTab="Banners"
      title={title}
      subtitle={subtitle}
      breadcrumbs={["Pipeline", "Banners", ...(view === "edit" ? ["Edit"] : [])]}
      subnav={subnav}
    >
      {view === "list" && <SlideListView />}
      {view === "edit" && <SlideEditView />}
    </ModulePageLayout>
  );
};

export default BannersModule;
