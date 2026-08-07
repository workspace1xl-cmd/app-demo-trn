// Optional catch-all route: matches /platform, /platform/training,
// /platform/admin/employees, etc., all through one shared client component.
// This is what gives every screen a real, addressable, deep-linkable,
// refresh-safe URL instead of the whole app living behind one route with
// client-only view state (browser Back/Forward and page refresh previously
// had no way to know which screen was showing).
import PlatformApp from "../PlatformApp";

export default function Page() {
  return <PlatformApp />;
}
