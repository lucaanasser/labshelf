# Plan: Biblioteca Central Fora do Workspace

## TL;DR

Implementar um modo de biblioteca central configurável no primeiro uso, persistido globalmente, para que o LabShelf funcione com ou sem pasta aberta no VS Code. Todos os papers passam a ser importados para um diretório único escolhido pelo usuário (ex.: `~/Research/LabShelfLibrary`) em vez de depender do workspace atual.

## Objetivo

- Permitir uso da extensão sem workspace aberto.
- Centralizar armazenamento de dados/papers em um diretório único configurado pelo usuário.
- Manter o fluxo atual de importação (PDF único, lote, drag and drop), alterando apenas a origem dos caminhos.
- Preservar fallback, logs estruturados e eventos já existentes.

## Estado Atual (Baseline)

1. A extensão exige `workspaceFolder` para ativar: [src/extension.ts](src/extension.ts#L23) e [src/extension.ts](src/extension.ts#L26).
2. Os caminhos de dados dependem da raiz do workspace via `WorkspacePaths`: [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts#L8).
3. Importação de paper grava em `papers/<id>` dentro do workspace: [src/core/paperService.ts](src/core/paperService.ts#L29).
4. Índice SQLite usa `.research/index.sqlite` na pasta do workspace: [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts#L24).
5. UI e comandos já estão desacoplados do caminho físico e consomem `PaperService`, o que facilita a mudança: [src/commands/registerCommands.ts](src/commands/registerCommands.ts#L18), [src/ui/listWebviewPanel.ts](src/ui/listWebviewPanel.ts#L11), [src/ui/collectionsTreeDataProvider.ts](src/ui/collectionsTreeDataProvider.ts#L20).

## Resultado Esperado da Feature

1. No primeiro comando que exige biblioteca, se não houver diretório configurado, abrir wizard.
2. Wizard:
- Selecionar pasta base (`showOpenDialog`).
- Informar nome da biblioteca (`showInputBox`).
- Criar diretório final e subpastas necessárias (`.research`, `papers`, `.research/logs`).
3. Persistir configuração de forma global (não vinculada ao workspace).
4. Reusar esse diretório em qualquer janela VS Code (com ou sem pasta aberta).
5. Se o caminho estiver inválido/inacessível, orientar reconfiguração sem crash.

## Arquitetura Proposta

### 1) Nova camada de configuração da biblioteca

- Adicionar módulo dedicado para resolver e persistir o caminho da biblioteca central.
- Responsabilidades:
1. Ler configuração persistida.
2. Executar setup inicial quando necessário.
3. Validar existência/permissão mínima do diretório.
4. Expor URI raiz para os serviços.

Sugestão de arquivo novo:
- `src/storage/libraryLocation.ts` (resolver + setup + validação)

### 2) Evolução de `WorkspacePaths` para caminho de biblioteca

- Opção A (preferida): substituir por `LibraryPaths` com assinatura baseada em `vscode.Uri` raiz.
- Opção B: manter `WorkspacePaths` e remover dependência de `WorkspaceFolder`, aceitando URI raiz arbitrária.

Impacto direto:
- [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts)
- [src/core/paperService.ts](src/core/paperService.ts#L20)
- [src/core/logger.ts](src/core/logger.ts)
- [src/extension.ts](src/extension.ts#L22)

### 3) Ativação sem workspace obrigatório

- Remover early return por ausência de workspace.
- Durante `activate`, resolver biblioteca central:
1. Se configurada e válida, inicializar normalmente.
2. Se ausente, inicializar estado mínimo e disparar setup no primeiro comando de escrita (ou setup imediato com confirmação).

Impacto direto:
- [src/extension.ts](src/extension.ts)

### 4) Guard de biblioteca para comandos mutáveis

- Comandos como `labshelf.addPaper` devem garantir biblioteca configurada antes de importar.
- Leitura (`openPaper`, `searchLibrary`) também deve checar disponibilidade do índice.

Impacto direto:
- [src/commands/registerCommands.ts](src/commands/registerCommands.ts)

### 5) Persistência da configuração

Decisão de armazenamento (escolher 1):
1. `context.globalState` (recomendado para controle total da extensão).
2. `labshelf.libraryRoot` em `settings.json` de escopo usuário.

Critérios:
- Funcionar sem workspace.
- Permitir update explícito por comando de reconfiguração.
- Facilitar testes e migração.

## Arquivos e Funções Relacionadas (Mapeamento Completo)

### Entrada e composição de serviços

- [src/extension.ts](src/extension.ts)
1. `activate(context)`
: hoje exige workspace; deve passar a resolver biblioteca central.
2. `initializeDatabase(indexPath, fileSystemService)`
: continuará igual, mas `indexPath` virá da biblioteca central.

### Caminhos e armazenamento

- [src/storage/workspacePaths.ts](src/storage/workspacePaths.ts)
1. `researchRoot()`
2. `papersRoot()`
3. `logsRoot()`
4. `indexPath()`
5. `appLogPath()`
: todos devem deixar de depender de `WorkspaceFolder`.

- [src/storage/fileSystemService.ts](src/storage/fileSystemService.ts)
1. `ensureDirectory(uri)`
2. `writeText(uri, content)`
3. `readText(uri)`
: já suporta URI arbitrária; sem mudança estrutural esperada.

### Núcleo de importação

- [src/core/paperService.ts](src/core/paperService.ts)
1. `addPaperFromUri(sourceUri)` usa `paths.papersRoot()`.
2. `addPapersFromUris(uris)` e expansão recursiva continuam válidas.
3. `deletePaper(paperId, deleteFiles)` mantém remoção física na biblioteca central.
4. `regenerateBibTeX()` mantém geração no diretório de cada paper.

### Banco e logging

- [src/db/sqliteResearchDatabase.ts](src/db/sqliteResearchDatabase.ts)
1. `initialize()` garante criação do diretório do banco.
2. `upsertPaper`, `listPapers`, `deletePaper`, `appendLog` sem mudança funcional.

- [src/core/logger.ts](src/core/logger.ts)
: escreve logs em `app.log`; precisa receber caminhos da nova raiz central.

### UI e comandos

- [src/commands/registerCommands.ts](src/commands/registerCommands.ts)
1. `registerCommands(...)`
: incluir guard/setup de biblioteca antes de operações dependentes de storage/db.

- [src/ui/collectionsTreeDataProvider.ts](src/ui/collectionsTreeDataProvider.ts)
: fluxo permanece, mas deve mostrar erro amigável se biblioteca indisponível.

- [src/ui/listWebviewPanel.ts](src/ui/listWebviewPanel.ts)
: ações (`addPaper`, `dropPapers`, `openPdf`) passam a depender do mesmo guard.

### Especificações impactadas

- [documents/specs/core-library.spec.yaml](documents/specs/core-library.spec.yaml)
- [documents/specs/sidebar.spec.yaml](documents/specs/sidebar.spec.yaml)
- [documents/specs/commands.spec.yaml](documents/specs/commands.spec.yaml)
- [documents/specs/database.spec.yaml](documents/specs/database.spec.yaml)

Atualizações mínimas em spec:
1. `architecture.inputs` sem obrigatoriedade de workspace.
2. `errors.expected_failures` com caminho central inválido/não configurado.
3. `ui` incluindo fluxo de setup inicial e comando de reconfiguração.
4. `tests` cobrindo operação sem workspace.

### Testes existentes relacionados

- [__tests__/core/paperService.test.ts](__tests__/core/paperService.test.ts)
- [__tests__/commands/registerCommands.test.ts](__tests__/commands/registerCommands.test.ts)
- [__tests__/storage/fileSystemService.test.ts](__tests__/storage/fileSystemService.test.ts)
- [__tests__/db/database.test.ts](__tests__/db/database.test.ts)

Observação importante:
- Há sinais de descompasso entre testes antigos e APIs atuais (ex.: assinatura de `registerCommands`, `FileSystemService`, `SqliteResearchDatabase`). A entrega deve incluir alinhamento incremental desses testes para evitar falsa cobertura.

## Diretórios Envolvidos

Código-fonte:
- [src/core](src/core)
- [src/storage](src/storage)
- [src/db](src/db)
- [src/commands](src/commands)
- [src/ui](src/ui)

Especificações:
- [documents/specs](documents/specs)

Testes:
- [__tests__/core](__tests__/core)
- [__tests__/commands](__tests__/commands)
- [__tests__/storage](__tests__/storage)
- [__tests__/db](__tests__/db)

Planejamento:
- [documents/plans](documents/plans)

## Plano de Implementação (Fases)

1. Fase 1 - Infra de caminho central
- Criar resolver de biblioteca central + persistência global.
- Adaptar classe de paths para receber raiz arbitrária.
- Garantir criação de estrutura base.

2. Fase 2 - Ativação e wiring
- Remover dependência de workspace no `activate`.
- Inicializar DB/logger/services com paths centrais.

3. Fase 3 - UX de configuração
- Implementar wizard no primeiro uso.
- Adicionar comando `labshelf.configureLibrary` para reconfigurar.

4. Fase 4 - Robustez e erros
- Mensagens claras para biblioteca ausente/inválida.
- Logs estruturados para setup, fallback e falhas de acesso.

5. Fase 5 - Specs e testes
- Atualizar specs impactados no mesmo PR.
- Criar/ajustar testes unitários e integração para modo sem workspace.

## Fluxo Funcional Proposto

1. Usuário executa `labshelf.addPaper` sem biblioteca configurada.
2. Extensão abre wizard (pasta base + nome da biblioteca).
3. Extensão cria diretório final e subestrutura.
4. Caminho é persistido globalmente.
5. Importação segue normalmente para `papers/<id>/paper.pdf` na biblioteca central.
6. Em qualquer janela futura, a extensão reaproveita a mesma biblioteca.

## Contratos de Erro (Propostos)

1. Biblioteca não configurada
- Mensagem: orientar setup.
- Ação: abrir wizard ou cancelar sem mutar estado.

2. Caminho não existe mais
- Mensagem: biblioteca indisponível; oferecer reconfiguração.
- Log: `WARN` com caminho salvo e contexto.

3. Sem permissão de escrita
- Mensagem: falha de acesso ao diretório.
- Log: `ERROR` com stack/contexto.

4. Falha no SQLite
- Comportamento atual de fallback in-memory pode ser mantido, mas deve ser explícito ao usuário que o modo não persistente está ativo.

## Checklist de Aceite

1. Extensão ativa sem workspace aberto.
2. Primeiro add dispara setup quando necessário.
3. Biblioteca central é persistida entre sessões.
4. Importação funciona em qualquer pasta/projeto aberto.
5. Drag and drop da sidebar continua funcional.
6. `openPaperPdf` e `openPaperFolder` funcionam com caminhos centrais.
7. Specs atualizados na mesma mudança.
8. Testes atualizados e `npm test` passando.

## Fora de Escopo (Nesta Entrega)

1. Múltiplas bibliotecas simultâneas com switcher completo.
2. Sincronização em nuvem.
3. Migração automática de bibliotecas antigas por workspace (pode virar comando separado depois).

## Riscos e Mitigações

1. Risco: quebra de fluxos que assumem workspace.
- Mitigação: encapsular resolução de path em uma única camada e usar guard central.

2. Risco: regressão em testes legados já desalinhados.
- Mitigação: estabilizar testes por camada começando por `core` e `commands`.

3. Risco: usuário configurar pasta inválida.
- Mitigação: validação imediata + comando de reconfiguração + mensagens acionáveis.
