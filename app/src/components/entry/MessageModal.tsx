// ============================================================================
// After-show message modal — shows the generated text, auto-copies on open,
// has a manual Copy button as backup (some browsers block auto-copy without
// a recent user gesture; the button gives the user one).
// ============================================================================

import { useEffect, useRef, useState } from "react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface Props {
  open: boolean;
  text: string;
  onClose: () => void;
}

export function MessageModal({ open, text, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  // Auto-copy on open. Clears the copied indicator each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {/* silent — user can still hit the button */},
        );
      }
    } catch {
      /* silent */
    }
  }, [open, text]);

  function manualCopy() {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.select();
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {
            try { document.execCommand("copy"); setCopied(true); } catch {/* */}
          },
        );
      } else {
        try { document.execCommand("copy"); setCopied(true); } catch {/* */}
      }
    } catch { /* */ }
  }

  return (
    <Modal open={open} onClose={onClose} title="After-show message">
      <div className="space-y-3">
        <textarea
          ref={taRef}
          readOnly
          value={text}
          className="w-full h-72 font-mono text-sm whitespace-pre p-3 border border-line rounded-md bg-paper"
        />
        <div className="flex items-center gap-3">
          <Button onClick={manualCopy}>Copy to clipboard</Button>
          {copied ? (
            <span className="text-sm text-ink-muted">Copied ✓</span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
