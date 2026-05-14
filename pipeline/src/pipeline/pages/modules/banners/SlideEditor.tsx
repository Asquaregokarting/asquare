import { useEffect, useState } from "react";
import type { CarouselSlide } from "../../../api/carousel-config-firestore";

interface SlideEditorProps {
  slide: CarouselSlide;
  onSave: (slide: CarouselSlide) => void;
  onCancel: () => void;
  onChange?: (slide: CarouselSlide) => void;
  saving: boolean;
}

const inputClass =
  "w-full rounded-xl border border-border/40 bg-surface px-3 py-2.5 text-sm text-text transition-all placeholder:text-muted/60 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/10";
const labelClass = "block text-xs font-semibold uppercase tracking-wider text-muted mb-1";

const SlideEditor = ({ slide, onSave, onCancel, onChange, saving }: SlideEditorProps) => {
  const [form, setForm] = useState<CarouselSlide>({ ...slide });

  const patch = (key: keyof CarouselSlide, value: string | number | boolean) =>
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      onChange?.(updated);
      return updated;
    });

  useEffect(() => { onChange?.(form); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Content Section */}
      <div className="rounded-2xl border border-border/30 bg-panel/40 p-5 space-y-4">
        <h3 className="text-sm font-bold text-text uppercase tracking-wide">Content</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Title</label>
            <input className={inputClass} value={form.title} onChange={(e) => patch("title", e.target.value)} placeholder="e.g. High-Speed Adventure Awaits" required />
          </div>
          <div>
            <label className={labelClass}>Badge Text</label>
            <input className={inputClass} value={form.badgeText} onChange={(e) => patch("badgeText", e.target.value)} placeholder="e.g. Go Karting" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Subtitle / Description</label>
          <textarea className={`${inputClass} min-h-[80px] resize-y`} value={form.subtitle} onChange={(e) => patch("subtitle", e.target.value)} placeholder="Description text for the slide" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Highlight Text</label>
            <input className={inputClass} value={form.highlightText} onChange={(e) => patch("highlightText", e.target.value)} placeholder="e.g. ₹10,000 or Srikakulam" />
          </div>
          <div>
            <label className={labelClass}>Image URL</label>
            <input className={inputClass} value={form.imageUrl} onChange={(e) => patch("imageUrl", e.target.value)} placeholder="/gokart.webp" />
          </div>
        </div>
      </div>

      {/* Colors Section */}
      <div className="rounded-2xl border border-border/30 bg-panel/40 p-5 space-y-4">
        <h3 className="text-sm font-bold text-text uppercase tracking-wide">Colors</h3>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Background</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.backgroundColor} onChange={(e) => patch("backgroundColor", e.target.value)} className="h-10 w-10 cursor-pointer rounded-lg border border-border/40" />
              <input className={inputClass} value={form.backgroundColor} onChange={(e) => patch("backgroundColor", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Accent</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.accentColor} onChange={(e) => patch("accentColor", e.target.value)} className="h-10 w-10 cursor-pointer rounded-lg border border-border/40" />
              <input className={inputClass} value={form.accentColor} onChange={(e) => patch("accentColor", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Highlight</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.highlightColor} onChange={(e) => patch("highlightColor", e.target.value)} className="h-10 w-10 cursor-pointer rounded-lg border border-border/40" />
              <input className={inputClass} value={form.highlightColor} onChange={(e) => patch("highlightColor", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Buttons Section */}
      <div className="rounded-2xl border border-border/30 bg-panel/40 p-5 space-y-4">
        <h3 className="text-sm font-bold text-text uppercase tracking-wide">Buttons</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Primary Button Text</label>
            <input className={inputClass} value={form.buttonText} onChange={(e) => patch("buttonText", e.target.value)} placeholder="e.g. Explore Activities" />
          </div>
          <div>
            <label className={labelClass}>Primary Button Link</label>
            <input className={inputClass} value={form.buttonLink} onChange={(e) => patch("buttonLink", e.target.value)} placeholder="e.g. /activities" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Secondary Button Text</label>
            <input className={inputClass} value={form.secondaryButtonText} onChange={(e) => patch("secondaryButtonText", e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className={labelClass}>Secondary Button Link</label>
            <input className={inputClass} value={form.secondaryButtonLink} onChange={(e) => patch("secondaryButtonLink", e.target.value)} placeholder="Optional" />
          </div>
        </div>
      </div>

      {/* Active Toggle */}
      <div className="rounded-2xl border border-border/30 bg-panel/40 p-5">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => patch("isActive", e.target.checked)}
            className="h-5 w-5 rounded border-border/40 text-accent focus:ring-accent/20"
          />
          <span className="text-sm font-semibold text-text">Slide is active and visible to customers</span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !form.title.trim()}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-panel transition-all hover:translate-y-[-1px] hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Slide"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border/40 px-6 py-2.5 text-sm font-semibold text-muted transition-all hover:text-text hover:border-border"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default SlideEditor;
