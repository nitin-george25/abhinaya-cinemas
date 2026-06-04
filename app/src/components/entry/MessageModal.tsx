// ============================================================================
// After-show message modal — renders a canvas image card (ported from
// the legacy Cloud build's showMsgModal). Owner/manager can:
//   • Enter / edit "Online ₹" for this show (writes back to entry.shows[i])
//   • Save image (PNG download)
//   • Copy image (clipboard, where supported)
//   • Copy text (textual fallback)
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  buildShowText,
  drawShowCard,
  safeName,
  showMessageData,
  type ShowCardData,
} from "../../lib/whatsappMessage";
import type { AppState, ComputedEntry, Entry } from "../../lib/types";

const LOGO_SRC = "/img/logomark-white.png";

interface Props {
  open: boolean;
  state: AppState;
  entry: Entry;
  showIdx: number | null;
  computed: ComputedEntry;
  /** Persist a patched show back to the entry (online value). */
  onPatchShow: (showIdx: number, patch: { online?: number }) => void;
  onClose: () => void;
}

export function MessageModal({
  open, state, entry, showIdx, computed, onPatchShow, onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const [logoReady, setLogoReady] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Load logo once.
  useEffect(() => {
    if (logoRef.current) return;
    const img = new Image();
    img.onload = () => { logoRef.current = img; setLogoReady(true); };
    img.onerror = () => { logoRef.current = null; setLogoReady(true); };
    img.src = LOGO_SRC;
  }, []);

  const data: ShowCardData | null =
    showIdx == null ? null : showMessageData(state, entry, showIdx, computed);

  const redraw = useCallback(() => {
    if (!canvasRef.current || !data) return;
    drawShowCard(canvasRef.current, data, logoRef.current, state.cinema?.name);
  }, [data, state.cinema?.name]);

  useEffect(() => {
    if (!open) return;
    setStatus("");
    redraw();
    // Re-render once fonts are guaranteed ready (Pontiac/Barlow swap can
    // shift glyph metrics).
    if (typeof document !== "undefined" && "fonts" in document) {
      (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready
        .then(() => { if (open) redraw(); })
        .catch(() => {/* */});
    }
  }, [open, redraw, logoReady]);

  if (!open || !data || showIdx == null) {
    return <Modal open={false} onClose={onClose}>{null}</Modal>;
  }

  function imageFilename(): string {
    if (!data) return "show.png";
    return [safeName(data.screen), safeName(data.movie),
      safeName(data.time || data.ordinal), data.date].filter(Boolean).join("_") + ".png";
  }

  function saveImage() {
    const c = canvasRef.current;
    if (!c || !data) return;
    const a = document.createElement("a");
    a.download = imageFilename();
    a.href = c.toDataURL("image/png");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("Image saved ✓");
  }

  /** Native share via navigator.share — mobile-friendly one-tap WhatsApp. */
  function shareImage() {
    const c = canvasRef.current;
    if (!c || !data) return;
    if (!c.toBlob || typeof navigator.share !== "function") {
      setStatus("Share not supported — use Save image");
      return;
    }
    c.toBlob((blob) => {
      if (!blob) { setStatus("Share failed"); return; }
      const file = new File([blob], imageFilename(), { type: "image/png" });
      // Feature-detect file sharing; fall back to text-only if not supported.
      const navAny = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      const shareData: ShareData & { files?: File[] } = {
        files: [file],
        title: `${data.screen} · ${data.movie}`,
        text: `${data.screen} — ${data.movie}`,
      };
      if (navAny.canShare && !navAny.canShare({ files: [file] })) {
        setStatus("Image share not supported — use Save image");
        return;
      }
      navigator.share(shareData)
        .then(() => setStatus("Shared ✓"))
        .catch((err: unknown) => {
          // User cancelled — silently ignore.
          if (err instanceof Error && err.name === "AbortError") return;
          setStatus("Share failed — use Save image");
        });
    });
  }

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  function copyImage() {
    const c = canvasRef.current;
    if (!c) return;
    if (!c.toBlob || !navigator.clipboard || !("ClipboardItem" in window)) {
      setStatus("Copy not supported here — use Save image");
      return;
    }
    c.toBlob((blob) => {
      if (!blob) { setStatus("Copy failed"); return; }
      const CI = (window as Window & { ClipboardItem: typeof ClipboardItem }).ClipboardItem;
      navigator.clipboard.write([new CI({ "image/png": blob })])
        .then(() => setStatus("Image copied ✓"))
        .catch(() => setStatus("Copy not supported here — use Save image"));
    });
  }

  function copyText() {
    if (!data) return;
    const t = buildShowText(data);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t)
        .then(() => setStatus("Text copied ✓"))
        .catch(() => {/* silent */});
    }
  }

  function onOnlineChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (showIdx == null) return;
    const v = e.target.value === "" ? 0 : Number(e.target.value) || 0;
    onPatchShow(showIdx, { online: v });
    // Canvas will redraw automatically when `data` recomputes from new entry.
  }

  const onlineVal = entry.shows?.[showIdx]?.online ?? "";

  return (
    <Modal open={open} onClose={onClose} title="After-show message" maxWidth="max-w-[620px]">
      <div className="space-y-3">
        <div>
          <span className="block text-[11px] uppercase tracking-wider text-ink-muted mb-1">
            Online ₹ (for this show)
          </span>
          <Input
            type="number"
            min={0}
            value={onlineVal}
            onChange={onOnlineChange}
            className="w-44 tabular-nums"
          />
        </div>

        <div className="bg-black/5 rounded-xl p-3 overflow-auto text-center">
          <canvas
            ref={canvasRef}
            className="max-w-full h-auto rounded-lg shadow-md"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canShare ? (
            <Button onClick={shareImage}>Share</Button>
          ) : null}
          <Button variant={canShare ? "secondary" : "primary"} onClick={saveImage}>
            Save image
          </Button>
          <Button variant="secondary" size="sm" onClick={copyImage}>Copy image</Button>
          <Button variant="secondary" size="sm" onClick={copyText}>Copy text</Button>
          {status ? <span className="text-sm text-ink-muted w-full sm:w-auto">{status}</span> : null}
        </div>
      </div>
    </Modal>
  );
}
