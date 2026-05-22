/**
 * Library page bootstrap. Phase 1 only confirms the bundle loads in a tab and
 * leaves placeholders for the tree/list/detail views to be filled in Phase 6.
 * @depends platform/logger.
 * @dependents library-page/index.html.
 */
import { BrowserLogger } from "../platform/logger";

const log = new BrowserLogger("library");
void log.info("library page mounted");
