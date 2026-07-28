// Ambient declaration for Vite's `?url` asset-import suffix, scoped to the
// exact specifier src/renderer/tabState.ts dynamically imports (the pdf.js
// worker file) — NOT a general wildcard.
//
// tsconfig.renderer.json already resolves this via Vite's own `vite/client`
// types (see its "types" array), but tabState.ts's lifecycle seam
// (docs/AUDIT_BUILD1.md coverage gap #1) is deliberately unit-testable from
// plain Node (test/tabState.test.ts), which pulls tabState.ts into
// tsconfig.json's program too — no DOM lib, no `vite/client`. This file
// lives outside src/renderer specifically so tsconfig.json's `"src"` include
// glob picks it up (tsconfig.json excludes src/renderer itself) while
// tsconfig.renderer.json's narrower `"src/renderer"`-only include does not,
// avoiding a duplicate-declaration clash with vite/client's own wildcard
// `declare module '*?url'` there.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string;
  export default src;
}
