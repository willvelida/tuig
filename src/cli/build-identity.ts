// Development builds are deliberately unpinnable. build-binary replaces this via Bun.define.
export const BUILD_IDENTITY: {
  commit: string | null;
  tree: string | null;
  dirty: boolean;
  tag?: string;
} =
  typeof TUIG_BUILD_IDENTITY === 'undefined'
    ? { commit: null, tree: null, dirty: true }
    : TUIG_BUILD_IDENTITY;
declare const TUIG_BUILD_IDENTITY: { commit: string; tree: string; dirty: boolean; tag?: string };
