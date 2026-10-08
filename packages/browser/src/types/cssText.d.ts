/**
 * Stylesheets imported from TypeScript arrive as text (esbuild "text" loader):
 * the content script injects the kit's tokens.css + base.css into shadow roots.
 * @depends none
 * @dependents content/shadowStyles
 */
declare module "*.css" {
  const text: string;
  export default text;
}
