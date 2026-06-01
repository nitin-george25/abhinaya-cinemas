// Route page: /settings/tax — Tax slabs and Rep Batta tiers.

import { TaxSection } from "../Settings";

export default function SettingsTaxPage() {
  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-tight">
          Tax &amp; Rep Batta
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          GST, eTax slabs, TMC, Cess, and Rep Batta tiers. Engine math reads
          from these values directly.
        </p>
      </div>
      <TaxSection />
    </div>
  );
}
