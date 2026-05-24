/**
 * Barrel re-export for the AI service facade and its factory.
 *
 * @depends aiService.ts, aiServiceFactory.ts
 * @dependents extension.ts
 */
export { AiService } from "./aiService.js";
export type { AiServiceDependencies, AiServiceStatus } from "./aiService.js";
export { createAiService } from "./aiServiceFactory.js";
export type { AiServiceFactoryDependencies } from "./aiServiceFactory.js";
