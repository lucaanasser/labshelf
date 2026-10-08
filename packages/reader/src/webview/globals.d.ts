/**
 * Ambient declarations for the reader webview bundle (esbuild turns CSS imports into dist/reader/reader.css).
 *
 * @depends none
 * @dependents none (ambient module declaration picked up via tsconfig `include`; not explicitly imported)
 */
declare module "*.css";
