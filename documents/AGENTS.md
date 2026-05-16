# LabShelf Implementation Rules

Estas regras orientam qualquer alteração neste repositório.

## Arquitetura

- Preserve a separação entre `core`, `db`, `storage`, `pdf`, `bibtex`, `ui` e `commands`.
- Não misture acesso a arquivos, banco de dados e UI no mesmo fluxo quando houver uma camada apropriada para isso.
- Prefira serviços pequenos e explícitos com responsabilidades únicas.
- Qualquer nova funcionalidade deve seguir o fluxo existente de eventos, serviços e UI antes de criar um caminho paralelo.

## Specs obrigatórias

- Toda funcionalidade nova ou mudança relevante deve ter ou atualizar um arquivo em `specs/*.spec.yaml`.
- O nome do spec deve refletir o domínio da feature, por exemplo `sidebar.spec.yaml`, `database.spec.yaml` ou `pdf.spec.yaml`.
- O spec deve descrever, no mínimo:
  - `feature`
  - `architecture`
  - `database`
  - `events`
  - `errors`
  - `ui`
  - `tests`
  - `ai_notes`
- Mantenha os specs consistentes, específicos e verificáveis. Evite descrições vagas.
- Se a implementação mudar o comportamento observado, o spec correspondente deve ser atualizado na mesma alteração.

## Comentários e documentação

- Use comentários apenas para explicar intenção, decisão arquitetural ou uma regra que não seja óbvia no código.
- Prefira comentários de módulo curtos no topo dos arquivos quando forem úteis para resumir responsabilidade e dependências.
- Não adicione comentários linha a linha para narrar código autoexplicativo.
- Se uma regra de negócio ou decisão técnica for importante, documente-a no spec ou no código próximo ao ponto de decisão.

## Ícones e emoji

- É proibido usar emoji na UI, na documentação ou nas mensagens de agente, a não ser que o prompt do usuário peça explicitamente.
- Prefira sempre ícones minimalistas em SVG, de bibliotecas padrão e profissionais quando possível, mantendo consistência visual entre telas e componentes.
- Quando um ícone textual precisar ser substituído, use um conjunto coerente de SVGs inline ou arquivos SVG compartilhados em vez de caracteres Unicode decorativos.

## Logs

- Registre eventos importantes com logging estruturado.
- Erros devem ser logados com contexto suficiente para diagnosticar a causa sem depender de depuração manual.
- Quando houver fallback, degradação ou comportamento alternativo, registre isso explicitamente.
- Evite logs ruidosos em caminhos quentes; prefira logs significativos, consistentes e úteis para diagnóstico.
- Use o logger existente do projeto quando possível, em vez de criar formatos paralelos.

## Testes obrigatórios

Toda funcionalidade nova ou modificação relevante **DEVE** ter testes automatizados que validem a conformidade com a spec correspondente.

### Regras de Testes

- **Cobertura mínima**: 50% de cobertura em todas as camadas, 80%+ em caminhos críticos (database, file I/O, BibTeX parsing)
- **Estrutura**: Testes organizados em `__tests__/<layer>/` espelhando a arquitetura em `src/<layer>/`
- **Escopo**: Cada spec em `specs/*.spec.yaml` deve ter testes cobrindo todos os comportamentos listados na seção `tests`
- **Execução**: `npm test` deve passar localmente antes de qualquer commit
- **Naming**: Arquivos de teste devem ser `<module>.test.ts` ou `<feature>.spec.ts`

### O que testar

1. **Unit Tests**: Cada função pública e classe deve ter pelo menos um teste
2. **Integration Tests**: Interações entre módulos especificados na spec
3. **Error Scenarios**: Todos os erros listados em `errors` na spec devem ser testados
4. **Fixtures**: Usar dados consistentes em `__tests__/fixtures/`

### Rejeição de mudanças

Mudanças serão rejeitadas se:
- Não tiverem testes correspondentes à funcionalidade
- Quebrarem testes existentes
- Reduzirem cobertura sem justificativa documentada
- Não atualizarem testes quando o spec mudar

## Qualidade da implementação

- Antes de finalizar uma mudança, verifique se há testes, validação ou compilação aplicáveis ao trecho alterado.
- Não entregue comportamento novo sem atualizar o spec correspondente.
- Não submeta código sem testes que validem a spec associada.
- Se a mudança introduzir nova responsabilidade, revise também a documentação do repositório quando fizer sentido.
