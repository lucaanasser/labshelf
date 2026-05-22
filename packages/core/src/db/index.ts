/**
 * Barrel re-export for platform-agnostic database implementations.
 *
 * @depends inMemoryDatabase.ts
 * @dependents @labshelf/core index, downstream packages
 */
export { InMemoryResearchDatabase } from "./inMemoryDatabase.js";
