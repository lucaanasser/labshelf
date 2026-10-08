/**
 * VS Code entry of the reader bundle (dist/reader/reader.js): reads the boot block the extension host wrote into the
 * HTML shell and starts the shared reader over the VS Code webview messaging API.
 *
 * @depends webview/reader.ts, webview/ui/hostBridge.ts, webview/ui/pdfLoader.ts, webview/ui/dom.ts, shared/protocol.ts (types only)
 * @dependents vscode build/reader.mjs (bundle entry)
 */
import "./styles/reader.css";
import type { ReaderBootParams } from "../shared/protocol.js";
import { startReader } from "./reader.js";
import { byId } from "./ui/dom.js";
import { createVsCodeTransport } from "./ui/hostBridge.js";
import { PerfMarks } from "./ui/pdfLoader.js";

const perf = new PerfMarks();
const boot = JSON.parse(byId("labshelf-boot").textContent ?? "{}") as ReaderBootParams;
startReader({ boot, transport: createVsCodeTransport(), perf }).catch(() => { /* already shown in #error-msg */ });
