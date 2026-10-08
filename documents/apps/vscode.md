# VS Code extension

The full LabShelf workspace inside VS Code:

- a folder tree in the activity bar;
- the paper list and detail pane in an editor tab;
- the PDF reader;
- import with OCR;
- AI indexing;
- Drive sync.

## Build and run

```bash
pnpm --filter @labshelf/vscode build   # host → out/extension.js, reader → dist/reader/
pnpm dev:vscode                        # watches both
```

- esbuild bundles the extension host from source, including `@labshelf/*`. Other dependencies (pdf.js, Tesseract, the native canvas) stay external and load from `node_modules`, because they locate their data files and binaries next to themselves. `tsc` only typechecks.

- Open the repository in VS Code and press F5. This launches an Extension Development Host. On first run, use **LabShelf: Configure Library**.
- Drive needs the Desktop OAuth client ([README.md](README.md#google-oauth-clients)). Tokens live in `SecretStorage` under `labshelf.gdrive.tokens`; **LabShelf: Disconnect from Google Drive** clears them.
- The SQLite index (`.research/index.sqlite`) is a cache that can be rebuilt from the library files. Deleting it is always safe.

## Extension host run

Jest mocks `vscode`, and plain Node passes pdf.js's "am I Node?" check, so both hide bugs that appear only in the extension host. The host is an Electron utility process (`process.type === "utility"`), and pdf.js treats it as a browser. Any change to import, OCR, the text layer or pdf.js usage must run in a real host:

1. Create a dummy extension: a `package.json` with `main` and empty `activationEvents`, plus a runner file that exports `run = async () => {…}`. In the runner, `require("vscode")` is real. Require the bundled `out/extension.js` (build first), or bundle the module under test with esbuild.
2. Launch it directly, outside the sandbox. The `code` CLI wrapper detaches, so call the binary:

   ```bash
   env -u ELECTRON_RUN_AS_NODE "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --no-sandbox \
     --user-data-dir=<SHORT path> --extensions-dir=<scratch> --disable-workspace-trust --skip-welcome \
     --skip-release-notes --disable-telemetry --disable-updates \
     --extensionDevelopmentPath=<dummy> --extensionTestsPath=<runner.js> <workspace>
   ```

3. Keep `--user-data-dir` under about 103 characters, because of the IPC socket path limit. The scratchpad path is too long, so symlink it from a short path and delete the symlink after the run.
4. Write runner files with a quoted heredoc (`<<'EOF'`).
5. The runner cannot see contributed views. A "Bad progress location" log line is harness noise.

A cheaper middle ground reproduces pdf.js's environment but not the host lifecycle. Run the script with `ELECTRON_RUN_AS_NODE=1 ".../Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)"`, after setting `process.type = "utility"`.

To test scans, render a real paper's pages to PNG and rebuild an image-only PDF with pdf-lib.

## Webview harness

Webview UI (the reader and the list panel) can only be verified in a real browser:

1. Stub `vscode` through `Module._load`, and bundle and call the HTML builders (the reader shell renderer, the list panel template) to get the real HTML.
2. Map `asWebviewUri` to a local static server that serves the repository and `pdfjs-dist`.
3. Inject a `:root{--vscode-*}` block with the Dark or Light Modern values.
4. Inject an `acquireVsCodeApi` stub under the page's CSP nonce. The stub records `postMessage` calls and answers `ready-for-init` with `init`.
5. Drive the page over CDP:
   - Click at element centres with `Input.dispatchMouseEvent`.
   - Use modifiers Alt=1, Ctrl=2, Meta=4, Shift=8. `boot.isMac` follows the host, so chords need Meta.
   - Assert on the DOM and on the recorded messages.
   - Read the screenshots. To crop one, use `sips -c H W --cropOffset Y X`.

The CDP harness has known blind spots:

- **Text-layer alignment.** Aiming the pointer at a span's own bounding box always hits, even when the text layer is misaligned with the rendered ink. Outline `.textLayer span` in a screenshot, and assert that the canvas, `.textLayer` and `.annotationLayer` boxes are identical.
- **A perfectly still pointer.** No real hand is perfectly still. Simulate tremor by moving 1 px every ~40 ms, or timer-reset bugs stay invisible.
- **Pointer resting on content.** Park the idle pointer on a margin with no page content.
