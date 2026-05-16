# Sync Flow

Esta pagina descreve em linguagem natural como o sistema de sincronizacao do LabShelf funciona, desde a autenticacao ate a resolucao de conflitos.

## Mapeamento local para o Drive

O Google Drive expoe dois namespaces distintos para aplicativos. O LabShelf usa os dois.

O namespace **library** e uma pasta comum criada na raiz do Drive do usuario e e visivel no Google Drive da web. Ela contem os arquivos de papers: cada subpasta corresponde a um paper e carrega o `paper.pdf`, o `metadata.yaml` e o `bib.bib`. O usuario pode navegar por essa pasta normalmente.

O namespace **appdata** usa o endpoint `appDataFolder` do Drive, que cria uma area oculta e privada, invisivel na interface do Drive. O LabShelf armazena ali o manifest de sync e os arquivos `data.json` de anotacoes e temas. Esses arquivos nao fazem sentido fora do contexto da extensao e nao devem aparecer para o usuario.

O banco SQLite local e o arquivo de estado em `.research/sync/<providerId>.state.json` nunca sobem para o Drive. O SQLite e um cache reconstruivel; o estado de sync e especifico da maquina local.

## Fluxo de autenticacao OAuth PKCE

O Google Drive exige OAuth 2.0. O LabShelf usa o fluxo PKCE com servidor loopback, que nao precisa de um segredo de cliente armazenado na extensao.

1. O usuario executa o comando `labshelf.sync.connect`.
2. O `GoogleDriveAuth` gera um code verifier aleatorio e calcula o code challenge correspondente (SHA-256, base64url).
3. A extensao abre um servidor HTTP local em uma porta efemera, por exemplo `http://localhost:52341`.
4. O navegador do usuario e aberto com a URL de autorizacao do Google, incluindo o `redirect_uri` apontando para o servidor local e o `code_challenge`.
5. O usuario faz login no Google e aprova as permissoes solicitadas.
6. O Google redireciona o navegador para o servidor local com o codigo de autorizacao na query string.
7. O servidor local captura o codigo, fecha a conexao e encerra o listener.
8. O `GoogleDriveAuth` troca o codigo pelo par de tokens (access token + refresh token) usando o code verifier original.
9. Os tokens sao armazenados via `vscode.ExtensionContext.secrets`, que os mantém cifrados no keychain do sistema operacional.
10. O status bar e atualizado para refletir o estado conectado.

Se o usuario fechar o navegador ou cancelar antes de autorizar, o servidor local expira sem receber codigo e a extensao exibe uma mensagem informando que a autenticacao foi cancelada.

## Fluxo de sync bidirecional

Quando um sync e disparado, o `SyncController` chama o `SyncEngine`, que executa as seguintes etapas em ordem.

**Carrega o manifest.** O `SyncManifest` le o arquivo `.research/sync/<providerId>.state.json`. Esse arquivo registra o estado de cada arquivo na ultima sync bem-sucedida: caminho relativo, hash do conteudo e timestamp. Se o arquivo nao existir, o manifest e tratado como vazio e o sync continua normalmente. Se o JSON estiver corrompido, o mesmo fallback e aplicado e um aviso e registrado no log.

**Escaneia o estado local.** O engine percorre a pasta `papers/` e os arquivos `data.json` em `.research/papers/`, calculando o hash de cada arquivo encontrado.

**Escaneia o estado remoto.** O engine chama `RemoteProvider.listFiles()`, que retorna a lista de arquivos com seus hashes e metadados.

**Calcula o diff.** Para cada arquivo presente em qualquer um dos tres conjuntos (manifest, local, remoto), o engine determina a acao correta. Veja a proxima secao para o detalhe das 8 acoes.

**Aplica as acoes.** O engine executa os uploads, downloads, deletes e renomeacoes necessarios chamando os metodos do `RemoteProvider` e do sistema de arquivos local.

**Salva o manifest atualizado.** Apos aplicar todas as acoes sem erro fatal, o `SyncManifest` grava o novo estado no disco.

## Diff de tres vias

O diff compara tres fontes para cada arquivo: o manifest (estado anterior acordado), o estado local atual e o estado remoto atual. As oito acoes possiveis sao as seguintes.

**local-new**: o arquivo existe local mas nao estava no manifest nem existe remoto. Conclusao: foi adicionado localmente. Acao: upload para o Drive.

**remote-new**: o arquivo existe remoto mas nao estava no manifest nem existe local. Conclusao: foi adicionado em outro dispositivo. Acao: download para o disco local.

**local-modified**: o hash local difere do manifest, mas o hash remoto coincide com o manifest. Conclusao: foi editado localmente desde o ultimo sync. Acao: upload, sobrescrevendo o arquivo remoto.

**remote-modified**: o hash remoto difere do manifest, mas o hash local coincide com o manifest. Conclusao: foi editado em outro dispositivo. Acao: download, sobrescrevendo o arquivo local.

**local-deleted**: o arquivo estava no manifest mas nao existe mais local, e o remoto coincide com o manifest. Conclusao: foi deletado localmente. Acao: delete no Drive.

**remote-deleted**: o arquivo estava no manifest mas nao existe mais remoto, e o local coincide com o manifest. Conclusao: foi deletado em outro dispositivo. Acao: delete local.

**conflict**: tanto o hash local quanto o hash remoto diferem do manifest. Conclusao: o arquivo foi modificado nos dois lados desde o ultimo sync. Acao: keep-both. O arquivo remoto e renomeado com o sufixo `(conflito <data>)` antes de o arquivo local ser enviado. O usuario fica com ambas as versoes e pode resolver manualmente.

**unchanged**: hashes local e remoto coincidem com o manifest. Nenhuma acao necessaria.

## Auto-sync

O sync pode ser disparado de tres formas.

**Eventos de biblioteca.** O `SyncController` escuta os eventos `paper:added`, `paper:deleted`, `paper:updated`, `annotation:created`, `annotation:updated` e `annotation:deleted` emitidos pelo `EventBus`. Cada evento reinicia um debounce de 30 segundos. Isso evita disparar um sync para cada arquivo em uma importacao em lote: o sync so ocorre 30 segundos apos o ultimo evento da rajada.

**Polling periodico.** Ao inicializar, o `SyncController` configura um `setInterval` com o valor de `labshelf.sync.autoSyncIntervalMinutes`. O intervalo padrao e definido na configuracao da extensao. O intervalo so e ativado quando ha uma sessao autenticada.

**Comando manual.** O usuario pode executar `labshelf.sync.now` a qualquer momento via paleta de comandos ou clicando no status bar item.

## Como adicionar um novo provider

A interface `RemoteProvider` define o contrato que qualquer backend de sync deve implementar. Para adicionar um provider novo, como GitHub ou Dropbox, siga estes passos.

**Implemente a interface.** Crie uma classe que implemente `RemoteProvider`. Os metodos obrigatorios sao `listFiles()`, `uploadFile()`, `downloadFile()` e `deleteFile()`. O metodo `listFiles()` deve retornar a lista de arquivos com hash e metadados suficientes para o `SyncEngine` calcular o diff. O metodo `uploadFile()` deve aceitar o conteudo em bytes e o caminho relativo no namespace remoto.

**Implemente a autenticacao.** Crie uma classe de auth equivalente ao `GoogleDriveAuth`. Ela deve armazenar tokens via `vscode.ExtensionContext.secrets` para que os tokens sobrevivam a reinicializacoes do VSCode sem expor segredos no codigo.

**Registre no SyncController.** O `SyncController` instancia o provider ativo. Adicione uma condicao que selecione o novo provider com base na configuracao do usuario, por exemplo um novo valor na setting `labshelf.sync.provider`.

**Escreva os testes.** Mocke o novo provider da mesma forma que o `GoogleDriveProvider` e validado: substitua `fetch` por um mock que retorna respostas controladas e verifique que as 8 acoes do diff produzem o comportamento correto.
