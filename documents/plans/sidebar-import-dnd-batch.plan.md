# Plan: Reintroduzir importação, drag and drop e lote na UI Zotero-style

TL;DR - Reintroduzir a capacidade de adicionar artigos no novo layout sem abandonar o padrão visual Zotero-style já adotado: a sidebar continua sendo a árvore de coleções e a lista continua em aba dedicada, mas ambas voltam a oferecer entrada clara para importação. O plano cobre importação manual de PDFs e pastas, drag and drop em qualquer ponto da sidebar, e processamento em lote com cada PDF tratado individualmente.

## Objectives

- Reexpor uma ação clara de adicionar artigos na UI nova.
- Permitir seleção manual de um PDF ou de uma pasta local.
- Aceitar drag and drop de PDFs e pastas em qualquer área da sidebar.
- Processar pastas como lote, expandindo para PDFs e importando cada arquivo separadamente.
- Manter o padrão visual e a arquitetura atual da extensão.

## Plan

1. Definir o contrato de UX e comandos para importação.
   - A ação de adicionar deve aparecer em pelo menos dois pontos: toolbar da sidebar e toolbar da lista.
   - Ambos os pontos devem disparar o mesmo fluxo base de importação.
   - O picker manual deve aceitar tanto arquivos PDF quanto pastas.
   - A pasta selecionada no picker deve ser tratada como um lote de PDFs.

2. Reaproveitar o fluxo atual de importação unitária como núcleo.
   - `PaperService.addPaperFromUri` continua sendo a unidade principal de processamento. Note que preciso gerar todos os metadados possiveis a partir do PDF, mas o processo de ingestão, persistência e eventos é o mesmo para um PDF único ou para cada PDF em um lote.
   - 
   - Parsing, persistência, escrita de artefatos e emissão de eventos devem permanecer centralizados.
   - A nova lógica de lote deve ser construída em cima dessa unidade, não paralela a ela.

3. Criar um adaptador de lote no back-end.
   - O adaptador deve aceitar uma lista de `Uri`s e também uma pasta local.
   - Quando receber uma pasta, deve expandi-la para os PDFs contidos nela.
   - A expansão deve ser recursiva, com filtro rígido por `.pdf`.
   - Cada PDF deve ser processado individualmente.
   - Falhas de um item não podem interromper os demais.
   - O retorno do lote deve distinguir sucesso total, sucesso parcial, falha parcial e entradas inválidas.

4. Definir drag and drop como entrada global na sidebar.
   - O drop de PDFs e pastas deve funcionar em qualquer área da sidebar, não em uma zona específica.
   - A sidebar deve capturar os eventos de drag over e drop no container inteiro.
   - Deve haver feedback visual discreto quando a sidebar estiver em estado de drop ativo.
   - O payload enviado para a extensão deve permitir distinguir arquivo, pasta e múltiplos itens.

5. Implementar o fluxo de front-end sem quebrar o padrão visual.
   - A lista e a sidebar devem usar a mesma linguagem visual do redesign existente.
   - A implementação não deve reintroduzir a antiga webview inteira da sidebar como superfície principal.
   - Se o layout atual não comportar bem a seleção de pasta, usar comando, toolbar ou menu contextual, não um painel paralelo com visual inconsistente.
   - A interação de drop deve ser simples, clara e previsível.

6. Implementar o fluxo de back-end para drag and drop.
   - Validar as URIs recebidas.
   - Converter caminhos quando necessário.
   - Ignorar entradas não-PDF com logging estruturado.
   - Lidar com arquivos e pastas locais.
   - Encaminhar cada PDF para a mesma rotina de importação.
   - Após cada item importado, emitir eventos para manter sidebar e lista sincronizadas.

7. Atualizar comandos, contributions e wiring da extensão.
   - Registrar comandos para importação manual de arquivo, importação manual de pasta, importação por drop e refresh.
   - Garantir que o fluxo de ativação continue coerente com a arquitetura atual.
   - Não reintroduzir o caminho antigo inteiro de webview da sidebar.
   - Preservar o modelo atual de TreeView para coleções e WebviewPanel para a lista.

8. Atualizar specs para refletir o comportamento novo.
   - O spec da sidebar deve descrever a entrada manual, o drop em qualquer área e o feedback visual de arraste.
   - O spec da lista deve descrever o mesmo contrato de importação e atualização de estado.
   - Se necessário, criar um spec novo para isolar as regras de ingestão/importação.
   - Os specs devem cobrir falhas parciais, arquivos inválidos e lote por pasta.

9. Cobrir os caminhos críticos com testes automatizados.
   - Testar importação de um PDF.
   - Testar seleção manual de uma pasta com múltiplos PDFs.
   - Testar drop de PDF em qualquer área da sidebar.
   - Testar drop de pasta.
   - Testar rejeição de não-PDF.
   - Testar lote parcial com um item falhando.
   - Testar atualização da UI quando eventos de `PaperService` são emitidos.

10. Validar manualmente o fluxo final.
   - Abrir o Extension Development Host.
   - Confirmar que o botão de adicionar voltou.
   - Confirmar que o picker aceita PDF e pasta.
   - Confirmar que o drop funciona fora de uma zona fixa.
   - Confirmar que uma pasta com vários PDFs gera múltiplos itens, cada um processado como artigo independente.

## Relevant files

- `/home/luca/labshelf/src/` — raiz do código-fonte da extensão, útil para navegação rápida entre `core`, `commands`, `pdf`, `storage` e `ui`
- `/home/luca/labshelf/src/core/` — camada de domínio e eventos; concentra `paperService`, `eventBus`, `logger` e tipos compartilhados
- `/home/luca/labshelf/src/commands/` — comandos da extensão e pontos de entrada da UI para importação e abertura de interfaces
- `/home/luca/labshelf/src/pdf/` — parsing e normalização dos PDFs antes da persistência
- `/home/luca/labshelf/src/ui/` — TreeView, WebviewPanel e HTML/CSS/JS da experiência Zotero-style
- `/home/luca/labshelf/src/storage/` — utilitários de caminho, workspace e filesystem usados pelo fluxo de ingestão
- `/home/luca/labshelf/documents/specs/` — specs funcionais que precisam refletir o contrato da UI e da importação
- `/home/luca/labshelf/__tests__/core/` — testes do fluxo central de dados e eventos
- `/home/luca/labshelf/__tests__/commands/` — testes dos comandos expostos para a UI
- `/home/luca/labshelf/__tests__/ui/` — testes dos providers e do painel visual

- `/home/luca/labshelf/src/core/paperService.ts` — núcleo do processamento unitário e ponto para batch ingestion e eventos por item
- `/home/luca/labshelf/src/pdf/pdfImportParser.ts` — parsing de metadados por PDF, usado em cada item individual
- `/home/luca/labshelf/src/commands/registerCommands.ts` — comandos de importação manual e integração com a UI
- `/home/luca/labshelf/src/ui/listWebviewPanel.ts` — local provável para restaurar ação de adicionar, receber drop e atualizar estado visual
- `/home/luca/labshelf/src/ui/collectionsTreeDataProvider.ts` — local provável para expor ações de importação na sidebar sem quebrar o padrão visual
- `/home/luca/labshelf/src/ui/sidebarWebviewProvider.ts` e `/home/luca/labshelf/src/ui/sidebarHtml.ts` — referência do contrato antigo de add, drop e mensagens
- `/home/luca/labshelf/src/extension.ts` — wiring entre providers, comandos, serviços e eventos
- `/home/luca/labshelf/documents/ui-redesign.md` — referência do layout e do comportamento que deve permanecer consistente
- `/home/luca/labshelf/documents/specs/sidebar.spec.yaml` e `/home/luca/labshelf/documents/specs/list-panel.spec.yaml` — specs a atualizar para refletir importação, drop e lote
- `/home/luca/labshelf/__tests__/ui/` e `/home/luca/labshelf/__tests__/core/` — testes de UI e de núcleo para cobrir importação simples, lote e erros

## Relevant symbols

- `PaperService.addPaperFromUri(sourceUri)` — unidade base de ingestão de um artigo a partir de um PDF único
- `PaperService.listPapers()` — fonte da lista usada pela UI para renderizar o acervo atual
- `PaperService.updatePaperStatus(paperId, status)` — atualização de estado que deve continuar disparando refresh na UI
- `PdfImportParser.parse(sourceUri)` — extração de metadados a partir do PDF de origem
- `registerCommands(context, paperService, logger)` — registro dos comandos usados por toolbar, menu e webview
- `SidebarWebviewProvider.handleMessage(message)` — contrato antigo de mensagens, útil como referência para drop e add
- `SidebarWebviewProvider.handleAddFromUri(rawUris)` — referência do fluxo antigo de ingestão via URI
- `SidebarWebviewProvider.parseFileUri(raw)` — conversão de payload textual para `vscode.Uri`
- `ListWebviewPanel` — classe/ponto de entrada para criar e atualizar o painel da lista
- `CollectionsTreeDataProvider` — provider da árvore de coleções e local provável para expor ações de importação na sidebar
- `ExtensionEventBus.emit(eventName, payload)` — mecanismo de eventos usado para sinalizar adições e atualizações de papers
- `WorkspacePaths.papersRoot()` — diretório base onde os PDFs importados são persistidos
- `FileSystemService.ensureDirectory(targetFolder)` — criação segura de diretórios durante a ingestão
- `BibTeXService.writePaperArtifacts(targetFolder, paper, sourcePath)` — geração de artefatos bibliográficos após a importação

## Verification

1. Rodar testes focados do slice alterado antes do suite completo, priorizando core e UI que cubram importação e eventos.
2. Executar `npm run compile` para garantir que os novos contratos de comando, provider, payload e eventos continuam válidos.
3. Validar no Extension Development Host o caminho manual de PDF único, pasta com vários PDFs e drop em qualquer área da sidebar.
4. Confirmar que os specs e os testes descrevem os mesmos casos, incluindo falhas parciais, entradas inválidas e atualização por evento.

## Decisions

- A entrada principal deve voltar sem recuperar a antiga sidebar inteira; a UI nova permanece sendo sidebar de coleções e aba de lista.
- O lote deve ser processado por arquivo, com falha isolada por item e sem interromper o restante da pasta.
- O drag and drop deve aceitar arquivos e pastas em qualquer parte da sidebar, mas a unidade real de processamento sempre será o PDF individual.
- Não incluir deduplicação avançada, organização automática por coleção ou sync externo nesta entrega, a menos que isso se torne necessário para a importação funcionar.

## Further Considerations

1. O seletor manual pode aceitar apenas PDF e pasta de uma vez, ou separar em ações distintas; a recomendação é aceitar ambos no mesmo fluxo para reduzir atrito.
2. A expansão de pasta deve ser recursiva com filtro rígido para `.pdf`, porque isso atende o caso de lotes grandes sem exigir configuração extra.
3. Se o design atual ficar apertado, o melhor fallback é um menu de adição com opções claras para arquivo, pasta e arrastar e soltar, mantendo um contrato de back-end único.