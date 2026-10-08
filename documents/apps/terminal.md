# Terminal app (`labshelf`)

A keyboard-driven explorer and a scriptable CLI over the local library. It works with or without VS Code, and it syncs with Drive on its own. Its layout uses yazi's columns and keys with Zotero's pane model: folders | papers | preview ([product.md](../product.md)). Press `?` in the app for every binding; the help is generated from the keymap.

## Build and run

```bash
pnpm --filter @labshelf/terminal build      # → packages/terminal/dist/labshelf.mjs (+ thumbnailWorker.mjs)
ln -s "$PWD/packages/terminal/dist/labshelf.mjs" /opt/homebrew/bin/labshelf
labshelf doctor                             # checks library, config, Drive and the image protocol
```

- The app finds the library through `--library`, then `LABSHELF_LIBRARY`, then the shared config ([library-format.md](../contracts/library-format.md#shared-configuration)). `labshelf init <path>` writes the shared config.
- Drive: `labshelf auth login`, or `:login` in the explorer.
- Thumbnails need kitty, Ghostty, iTerm2 or WezTerm. In the VS Code terminal, set `terminal.integrated.enableImages` and `LABSHELF_IMAGES=iterm`. Inside tmux, images are off unless forced.
- Thumbnails are faster with `brew install poppler` (pdftoppm). Without it, pdf.js renders them through `@napi-rs/canvas`.
- PDFs open in the system viewer, or in `LABSHELF_PDF_VIEWER` or `terminal.pdfViewer` from the config.

## Verification

Always rebuild first (`node build/build.mjs`). A stale bundle silently shows the old UI.

Isolate every run from your real setup. Put this in a wrapper script, because zsh does not word-split `$VAR` commands:

```bash
cp -R ~/Documents/LabShelfLibrary <scratch>/lib
XDG_CONFIG_HOME=<scratch>/config XDG_CACHE_HOME=<scratch>/cache LABSHELF_TOKEN_STORE=file \
  node packages/terminal/dist/labshelf.mjs -L <scratch>/lib "$@"
```

There are two ways to check the app:

- **Text frames.** `--dump-frame 120x30 --keys "h j l <tab> <enter> <C-d>"` renders one frame as plain text through the real app and input decoder. No TTY is needed. Use this to check layout and key handling.
- **Real pty.** Use a small Python `pty.fork()` harness (run Python with `-I`) that sets the window size with `TIOCSWINSZ`, writes keys with delays and captures the bytes. Check:
  - alternate screen in and out: `\x1b[?1049h` / `\x1b[?1049l`;
  - cursor restored: `\x1b[?25h`;
  - with `LABSHELF_IMAGES=iterm`, the `\x1b]1337;File=` image escapes.

To check the interplay with VS Code:

1. Mark a status in the terminal and confirm that `metadata.yaml` changed only in `status`. With VS Code open on the same copy, its list updates within a second.
2. Start a long sync with `S`, then run Sync Now in VS Code. VS Code must report that the terminal is syncing and do nothing else.
