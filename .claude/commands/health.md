Run a full project health audit for packages/vscode. Produce a structured report.

Steps:

1. **Compilation** — `cd /home/luca/labshelf && pnpm --filter vscode exec tsc --noEmit`

2. **Large files** — list all .ts files in packages/vscode/src/ with more than 200 lines:
   `find packages/vscode/src -name "*.ts" | xargs wc -l | sort -rn | awk '$1 > 200'`

3. **Missing file headers** — list .ts files without a `@depends` or `@dependents` JSDoc tag:
   `grep -rL "@depends" packages/vscode/src --include="*.ts"`

4. **Missing specs** — for each directory in packages/vscode/src/, check if a corresponding spec exists in documents/specs/

5. **Dead code candidates** — use the legacy-cleaner agent to identify (not delete) suspect files

6. **Stray documentation** — find .md files outside allowed locations:
   `find /home/luca/labshelf -name "*.md" -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/documents/*" -not -path "*/.claude/*" -not -name "README.md"`
   List each stray file with its path.

7. **Portuguese content** — grep for common Portuguese words in comments and specs:
   `grep -rn "\b\(arquivo\|função\|retorna\|depende\|módulo\|serviço\)\b" packages/vscode/src documents/specs --include="*.ts" --include="*.yaml" --include="*.md"`

Produce the report with sections:
## Compilation
## Large Files (needs refactoring)
## Missing Comments
## Missing Specs
## Dead Code Candidates
## Stray Documentation
## Portuguese Content to Translate
