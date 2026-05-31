import { IconSpinner } from "../icons";

export function BootingScreen({ label = "Connecting…" }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white">
      <div className="flex items-center gap-3 text-white/70">
        <IconSpinner className="w-5 h-5 text-amber-400" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
