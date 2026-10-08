/**
 * VS Code entry of the reader bundle (dist/reader/reader.js): reads the boot block the extension host wrote into the
 * HTML shell and starts the shared reader over the VS Code webview messaging API.
 */
import "@labshelf/core/styles/reader.css";
import type { ReaderBootParams } from "@labshelf/core";
import { PerfMarks, byId, startReader } from "@labshelf/core/dom";
import { createVsCodeTransport } from "./index.js";

const perf = new PerfMarks();
const boot = JSON.parse(byId("labshelf-boot").textContent ?? "{}") as ReaderBootParams;
startReader({ boot, transport: createVsCodeTransport(), perf }).catch(() => { /* already shown in #error-msg */ });
