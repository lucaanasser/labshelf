# LabShelf documentation

This folder holds what the code cannot say by itself. The rules for every change live in [../AGENTS.md](../AGENTS.md).

| Read | When |
|---|---|
| [product.md](product.md) | before any UI or UX work: what LabShelf is and the principles every app follows |
| [architecture.md](architecture.md) | before adding or moving code: packages, where code goes, runtimes, ports, design system |
| [contracts/library-format.md](contracts/library-format.md) | before touching files on disk: library layout, `metadata.yaml`, the sidecar, shared config |
| [contracts/sync.md](contracts/sync.md) | before touching sync, Drive or anything that coordinates apps |
| [contracts/reader-host.md](contracts/reader-host.md) | before touching the PDF reader or a host of it |
| [apps/](apps/README.md) | to build, run or verify an app; OAuth setup |
| [plans/](plans/) | active plans, all written from [plans/TEMPLATE.md](plans/TEMPLATE.md); each one is deleted when it is done. [plans/CALIBRATION.md](plans/CALIBRATION.md) compares past estimates with reality |
| [archive/](archive/README.md) | the rare finished document worth keeping |

What does not belong here:

- file or function listings, constants, and anything else the code already states;
- user manuals (the website and each app's built-in help cover them);
- the history of how something changed (git keeps it).
