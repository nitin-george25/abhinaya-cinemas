// ============================================================================
// Legacy /cash/today page.
//
// Today + Closings were merged into the unified `/cash/closings` page (see
// pages/cash/Closings.tsx). This file is kept only because the sandbox
// can't delete it; it re-exports the new page so any straggling import
// keeps working. The route /cash/today now redirects to /cash/closings,
// so this component is never actually mounted.
// ============================================================================

export { default } from "./Closings";
