/**
 * Barrel export for the ui/sidebar module, exposing the placeholder providers for the
 * Writing, Reading, Insights, Assist and Agents sections.
 *
 * @depends ui/sidebar/placeholderTreeDataProvider.ts
 * @dependents extension.ts
 */
export {
  WritingTreeDataProvider,
  ReadingTreeDataProvider,
  InsightsTreeDataProvider,
  AssistTreeDataProvider,
  AgentsTreeDataProvider,
} from './placeholderTreeDataProvider.js';
