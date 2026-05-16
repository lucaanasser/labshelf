# PDF Viewer: Problemas Encontrados e Soluções Aplicadas

Data: 2026-05-13  
Escopo: Fases 1, 2 e 3 (viewer básico, anotações e temas)

## 1. Resumo Executivo

Durante a análise do PDF Viewer foram identificados dois problemas principais:

1. Lentidão perceptível na abertura de PDFs.
2. Tema não aplicado corretamente ao conteúdo da página do PDF.

As correções implementadas resolveram a causa raiz de ambos os problemas sem quebrar testes existentes.

## 2. Problemas Identificados

### 2.1 Abertura lenta do PDF

Sintoma observado:
- O viewer demorava para mostrar o PDF ao abrir um paper.

Causas técnicas:
- O fluxo de inicialização aguardava etapas extras antes de entregar o primeiro paint.
- A estrutura do painel fazia trabalho desnecessário em cenários de troca de tema.
- Existia reconstrução completa do HTML do webview em operações onde bastava atualização incremental.

Impacto:
- Tempo de abertura maior que o esperado para uso interativo.
- Sensação de lentidão em comparação com leitores como Zotero e vscode-pdfviewer.

### 2.2 Tema não aplicado no conteúdo do PDF

Sintoma observado:
- Toolbar e container mudavam de tema, mas a página do PDF permanecia visualmente igual.

Causa raiz:
- O conteúdo do PDF é renderizado em canvas (pixels).
- Troca de variáveis CSS do container não altera os pixels já rasterizados do canvas.
- O handler de applyTheme atualizava estado, porém não aplicava transformação visual efetiva ao canvas.

Impacto:
- Funcionalidade de temas parecia quebrada para o usuário final.
- Diferença clara entre comportamento esperado e comportamento real.

## 3. Soluções Implementadas

### 3.1 Tema aplicado de forma real no conteúdo do PDF

O que foi feito:
- Definidas variáveis de filtro visual por tema para o canvas.
- Aplicação de filtro do canvas na folha de estilos do webview.
- Ajuste do script para aplicar tema efetivo imediatamente ao receber mensagem de applyTheme.
- Envio separado de preferência de tema e tema efetivo para suportar modo auto com sincronização correta.

Resultado:
- Light, Dark, Sepia e High Contrast passam a afetar o conteúdo visível da página.
- Troca de tema fica instantânea, sem necessidade de recarregar o viewer inteiro.

### 3.2 Remoção de rerender completo na troca de tema

O que foi feito:
- Substituída estratégia de reconstruir webview.html por atualização via postMessage.
- No modo auto, mudança de tema do VS Code agora envia apenas atualização de tema efetivo.

Resultado:
- Menos custo de processamento.
- Menos perda de estado e menos trabalho redundante.
- Melhor responsividade ao alternar tema.

### 3.3 Otimização da abertura inicial

O que foi feito:
- Inicialização passou a priorizar first paint do viewer.
- Carregamento de anotações movido para etapa assíncrona após render inicial.

Resultado:
- PDF aparece antes na tela.
- Sidebar e overlays são atualizados em seguida sem bloquear a abertura inicial.

## 4. Evidências de Validação

Validações executadas:
- Compilação TypeScript sem erros.
- Testes focados do PDF viewer com aprovação total.

Comandos validados:
- npm run compile
- npm test -- pdf-viewer

Status:
- Todas as suítes de teste relacionadas ao viewer passaram.

## 5. Comparação com Leitores de Referência

Foi analisado o comportamento do ecossistema vscode-pdfviewer (baseado no viewer completo do PDF.js).

Pontos de arquitetura relevantes observados:
- Estratégia incremental de renderização.
- Fila de renderização com prioridade de páginas visíveis.
- Cache e reaproveitamento de estado para evitar trabalho redundante.
- Suporte de pageColors no pipeline de renderização do PDF.js.

Conclusão:
- O ganho de desempenho desses leitores vem principalmente de arquitetura incremental e cache, não apenas de CSS.
- As correções aplicadas nesta iteração alinham a base do LabShelf com esse caminho.

## 6. Riscos e Limitações Atuais

1. O uso de filtros de canvas resolve rapidamente a experiência visual, mas não substitui totalmente pageColors nativo do PDF.js em todos os casos.
2. Ainda há espaço para acelerar PDFs muito grandes com virtualização mais agressiva.
3. A renderização permanece de página única por vez no fluxo atual.

## 7. Próximas Melhorias Recomendadas

### 7.1 Performance
- Implementar cache de página por escala.
- Pré-render da próxima página e da anterior.
- Virtualização para documentos longos.
- Debounce adicional para eventos de zoom/navegação intensiva.

### 7.2 Theming
- Evoluir de filtro visual para estratégia baseada em pageColors quando aplicável.
- Expandir testes visuais para contraste e legibilidade por tema.

### 7.3 Observabilidade
- Adicionar métricas de tempo de abertura (ms até first paint).
- Log estruturado para operações de render e troca de tema.

## 8. Conclusão

Os problemas principais reportados (lentidão de abertura e tema não aplicado) foram rastreados até causas arquiteturais e de rendering no canvas.

As correções entregues:
- Eliminam rerender desnecessário na troca de tema.
- Aplicam tema de forma visível ao conteúdo do PDF.
- Reduzem tempo percebido na abertura ao priorizar first paint.

Com isso, o viewer fica funcionalmente consistente com a proposta das fases 1 a 3 e mais próximo da experiência esperada em leitores de referência.