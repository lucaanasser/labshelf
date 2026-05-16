# 🧪 Testes do LabShelf - Guia Completo

Este diretório contém toda a suite de testes para validar a funcionalidade do LabShelf, incluindo testes completos de extração de metadados de PDFs científicos.

## 📂 Estrutura de Diretórios

```
__tests__/
├── core/                              # Testes da camada core
│   └── eventBus.test.ts              # Event bus functionality
├── db/                                # Testes de database
│   └── database.test.ts              # SQLite database operations
├── storage/                           # Testes de file system
│   └── fileSystemService.test.ts     # File I/O operations
├── pdf/                               # Testes de PDF parsing
│   ├── pdfImportParser.test.ts              # Unit tests with VS Code
│   └── pdfImportParser.integration.test.ts  # Integration tests
├── bibtex/                            # Testes de BibTeX
│   └── bibtexService.test.ts         # BibTeX parsing & formatting
├── commands/                          # Testes de commands
│   └── registerCommands.test.ts      # Command registration
├── fixtures/                          # Dados compartilhados entre testes
│   ├── README.md                      # Guia de fixtures
│   └── mockPapers.ts                  # Mock paper data
├── setup.ts                           # Setup global dos testes
└── README.md                          # Este arquivo
```

## 🚀 Quick Start

### Instalação Inicial
```bash
cd /home/luca/labshelf

# Instalar dependências (incluindo Jest)
npm install

# Compilar TypeScript
npm run compile

# Rodar todos os testes
npm test
```

### Rodar Testes Específicos
```bash
# Apenas testes de PDF
npm run test:pdf

# Apenas testes de database
npm run test:db

# Apenas testes de core
npm run test:core

# Com cobertura
npm run test:coverage

# Com watch mode (rerun ao salvar)
npm run test:watch
```

## 🎯 Testes de PDF - Caso de Uso Principal

### O que é testado?
O parser de PDF (`PdfImportParser`) extrai metadados científicos completos de artigos PDF:

**Entrada:** `seascapes.pdf`
```
Arquivo: From fitness landscapes to seascapes: non-equilibrium dynamics 
         of selection and adaptation
Autores: Ville Mustonen, Michael Lässig
Ano: 2009
DOI: 10.1016/j.tig.2009.01.002
```

**Saída Esperada:**
```json
{
  "title": "From fitness landscapes to seascapes: non-equilibrium dynamics of selection and adaptation",
  "authors": ["Ville Mustonen", "Michael Lässig"],
  "year": 2009,
  "citeKey": "mustonen2009fitness"
}
```

### Testes de PDF Disponíveis

| Teste | Objetivo | Timeout |
|-------|----------|---------|
| `should parse a valid scientific paper PDF` | Validar parsing completo | 30s |
| `should extract DOI from scientific paper` | Detectar DOI e buscar CrossRef | 30s |
| `should extract authors from PDF metadata` | Parser array de autores | 30s |
| `should extract year from PDF` | Validar extração de ano | 30s |
| `should extract title from PDF` | Parser título normalizado | 30s |
| `should generate valid cite key` | Validar formato de chave | 30s |
| `should normalize titles` | Remover espaços extras | 30s |
| `should resolve metadata from CrossRef API` | Buscar online se DOI encontrado | 30s |
| `should maintain consistency on multiple parses` | Mesmo resultado em 2 parses | 60s |

### Executar Testes de PDF
```bash
# Apenas testes de PDF com saída detalhada
npm run test:pdf -- --verbose

# Com coverage de PDF
npm test -- __tests__/pdf --coverage

# Teste específico
npm test -- __tests__/pdf -t "should extract authors"
```

## 📊 Relatórios de Cobertura

```bash
# Gerar relatório de cobertura completo
npm run test:coverage

# Relatório gerado em: coverage/
# Abrir em browser: coverage/lcov-report/index.html
```

### Requisitos de Cobertura
- Mínimo 50% em todas as camadas
- **80%+** em caminhos críticos:
  - Database (DB layer)
  - File I/O (Storage layer)
  - BibTeX parsing (BibTeX layer)
  - PDF parsing (PDF layer)

## 🔧 Configuração do Jest

**jest.config.js** define:
```javascript
{
  preset: 'ts-jest',                    // Use TypeScript
  testEnvironment: 'node',              // Node environment
  testTimeout: 60000,                   // 60 segundos (para PDF)
  roots: ['<rootDir>/__tests__'],       // Procurar testes aqui
  collectCoverageFrom: ['src/**/*.ts'],  // Medir coverage
  moduleNameMapper: {
    'vscode': '<rootDir>/__mocks__/vscode.js'  // Mock do VS Code
  }
}
```

## 📝 Escrevendo Novos Testes

### Template Básico

```typescript
import { MyService } from '../../src/path/myService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  afterEach(() => {
    // Cleanup
  });

  describe('feature name', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test data';

      // Act
      const result = service.doSomething(input);

      // Assert
      expect(result).toBe('expected output');
    });
  });
});
```

### Usando Fixtures
```typescript
import { mockPapers } from '../fixtures/mockPapers';

it('should process valid paper', () => {
  const paper = mockPapers.validPaper();
  // Use paper in test
});
```

### Testes Async
```typescript
it('should fetch paper from database', async () => {
  const result = await db.getPaper('key2023');
  expect(result).toBeDefined();
}, 5000); // 5 segundo timeout
```

## 🐛 Troubleshooting

### Problema: "Cannot find module 'vscode'"
**Solução:** Mocks do VS Code já estão configurados. Rodar:
```bash
npm install
npm run compile
npm test
```

### Problema: "Timeout - Async callback was not invoked"
**Solução:** Aumentar timeout ou verificar se teste está esperando Promise:
```typescript
it('test name', async () => {
  // Use async/await
  const result = await someAsyncFunction();
}, 30000); // Aumentar timeout
```

### Problema: "Module not found" durante compile
**Solução:** 
```bash
npm install  # Reinstalar dependências
npm run compile  # Recompilar
```

### Problema: Tests passam localmente mas falham no CI
**Solução:** Verificar:
1. Node.js version (`node -v`)
2. Dependências (`npm list`)
3. Ambiente (Windows vs Linux)

## 📚 Documentação de Specs

Cada teste deve estar alinhado com o spec correspondente em `specs/`:
- `pdf.spec.yaml` - Testes de PDF parsing
- `database.spec.yaml` - Testes de database
- `core-library.spec.yaml` - Testes de core
- etc.

## ✅ Pre-commit Checklist

Antes de fazer commit:
```bash
# 1. Compilar
npm run compile

# 2. Rodar todos os testes
npm test

# 3. Verificar linting
npm run lint

# 4. Se tudo passar:
git add .
git commit -m "feat: add new feature with tests"
```

## 🔄 CI/CD Integration

Testes rodam automaticamente em:
- ✅ Pull requests
- ✅ Commits para main
- ✅ Pre-release builds

Failing tests **bloqueiam** merges.

## 📞 Suporte

- **Documenta de testes:** `/home/luca/labshelf/TESTE_PDF_RELATORIO.md`
- **Guia de fixtures:** `__tests__/fixtures/README.md`
- **Setup global:** `__tests__/setup.ts`

## 🎓 Boas Práticas

1. ✅ Um teste = Um comportamento
2. ✅ Nomes descritivos ("should extract authors", não "test1")
3. ✅ Dados de teste em fixtures, não hardcoded
4. ✅ Mocks para dependências externas
5. ✅ Async/await para operações assíncronas
6. ✅ Cleanup em afterEach
7. ✅ Test timeouts apropriados
8. ✅ Comentários para testes complexos

## 📊 Exemplos de Saída

### Teste Passando
```
 PASS  __tests__/pdf/pdfImportParser.test.ts
  PdfImportParser
    PDF parsing with real scientific paper
      ✓ should parse a valid scientific paper PDF (245ms)
      ✓ should extract DOI from scientific paper (567ms)
      ✓ should extract authors from PDF metadata (134ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        2.345s
```

### Coverage Report
```
Statements   : 78.5% ( 345/440 )
Branches     : 65.3% ( 112/172 )
Functions    : 82.1% ( 64/78 )
Lines        : 79.2% ( 325/410 )
```

---

**Última atualização:** May 12, 2026
**Versão do Jest:** 29.7.0
**Versão do TypeScript:** 5.8.2
