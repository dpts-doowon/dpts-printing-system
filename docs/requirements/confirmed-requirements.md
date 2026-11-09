# Requisitos confirmados

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.8 · **Data:** 2026-10-07
> **Fontes:** diretrizes de engenharia do projeto (escopo confirmado).
> **Limite desta lista:** os requisitos abaixo são os registrados como confirmados no escopo do projeto. Itens marcados com **†** devem ser conferidos contra o documento contratual e os protótipos aprovados antes de serem tratados como contratuais; esta lista não altera nenhum requisito contratual.

## 1. Requisitos funcionais confirmados

### 1.1 Fluxo do operador

| ID | Requisito | Fonte |
|---|---|---|
| REQ-001 | O operador deve se autenticar obrigatoriamente. | Escopo confirmado |
| REQ-002 | O operador seleciona a máquina/posto de produção. Se a Doowon confirmar vínculo fixo 1:1 entre posto e máquina (recomendação da Clavia, D-040), a máquina do posto é exibida e o dropdown de máquina é removido da interface do operador. | Escopo confirmado |
| REQ-003 | O operador seleciona a peça/modelo em produção. | Escopo confirmado |
| REQ-004 | O operador confirma visualmente os dados selecionados antes de imprimir; o turno atual é exibido como informação somente leitura. | Escopo confirmado |
| REQ-005 | A tela de impressão oferece botões grandes `Imprimir 4 etiquetas`, `Imprimir 8 etiquetas` e `Imprimir 32 etiquetas`, sem digitação de quantidade. Na V1 as únicas quantidades são 4, 8 e 32 (ajuste pedido pela Doowon em 2026-11-06, relato; antes eram 1, 10 e 30; a mídia imprime 4 etiquetas por linha); não há campo de quantidade livre na interface nem na API. | Escopo confirmado; reafirmado em 2026-10-07; quantidades alteradas em 2026-11-06 (relato, fonte Doowon a identificar) |
| REQ-006 | O operador recebe status claro de impressão e pode confirmar a saída das etiquetas. | Escopo confirmado |
| REQ-007 | O operador pode solicitar reimpressão controlada, informando motivo. | Escopo confirmado |
| REQ-008 | A navegação do operador é mínima, para continuar a produção com poucos passos. | Escopo confirmado |
| REQ-009 | A etiqueta é impressa por impressora térmica industrial. A impressão não depende de diálogo manual do navegador. † | Escopo confirmado |
| REQ-036 | **Posto → Print Agent → impressora dedicada:** Posto 01 → Print Agent 01 → Impressora 01; Posto 02 → Print Agent 02 → Impressora 02. A impressora é uma configuração técnica do posto, definida na implantação pela Clavia/Doowon TI (sem CRUD para o ADMIN). O operador nunca seleciona a impressora: a interface mostra apenas o status da impressora do **próprio posto**. O ADMIN pode visualizar o status das duas impressoras. O destino é derivado no servidor (E-006) e a visibilidade é aplicada no servidor (E-023). | D-018 RESOLVED em 2026-10-07: informação repassada pela Clavia em 07/10/2026, aguardando identificação da fonte Doowon para evidência formal |
| REQ-037 | **Proteção contra comando concorrente no mesmo posto:** enquanto existir PRINT_JOB ativo para a impressora do posto, um novo comando é bloqueado antes de criar PRINT_JOB, LABEL ou PRINT_ATTEMPT, com a mensagem "Impressora em uso". Não há fila. O bloqueio de um posto não afeta o outro. | Decisão da Clavia em 2026-10-07 (E-005); D-037 fechada para a V1 |

### 1.2 Etiqueta e rastreabilidade

| ID | Requisito | Fonte |
|---|---|---|
| REQ-010 | A etiqueta física tem 30 mm x 20 mm. | Escopo confirmado |
| REQ-011 | Informações conhecidas da etiqueta: descrição da peça (2 letras + 3 números, em destaque), Part Number, operador logado, turno, data/hora de produção, QR Code e identificador único de rastreabilidade. Nenhum outro campo (inclusive "Lote de produção", D-039) entra na etiqueta sem confirmação da Doowon. | Escopo confirmado; reafirmado em 2026-10-07; quantidades alteradas em 2026-11-06 (relato, fonte Doowon a identificar) |
| REQ-012 | Cada etiqueta lógica (LABEL) criada para produção recebe um identificador único e imutável. Um pedido de 30 etiquetas gera **1 PRINT_JOB** (o pedido do operador) e **30 LABELs independentes**, cada uma com seu próprio `label_id`. PRINT_JOB e LABEL são entidades distintas (`printing-state-machine.md` §2). | Escopo confirmado |
| REQ-013 | O sistema registra dados de rastreabilidade e histórico de impressão. | Escopo confirmado |
| REQ-014 | Reimpressões são controladas e auditadas, exigem motivo, ator e data/hora, e preservam o histórico anterior. | Escopo confirmado |
| REQ-015 | Para uma etiqueta individual o histórico identifica ao menos: ID, peça/modelo, Part Number, operador, máquina/posto, turno, data/hora, PRINT_JOB de origem, tentativas de impressão e reimpressões com motivo. | Escopo confirmado |

### 1.3 Perfis e administração

| ID | Requisito | Fonte |
|---|---|---|
| REQ-016 | Existem os perfis `ADMIN` e `OPERATOR`. A autorização é aplicada no servidor/API, nunca apenas pela interface. | Escopo confirmado |
| REQ-017 | O administrador gerencia máquinas, operadores, peças/modelos e turnos. Impressoras **não** têm CRUD para o ADMIN na V1 (E-022): vínculos e parâmetros são definidos na implantação pela Clavia/Doowon TI, e o ADMIN visualiza o status das duas impressoras. | Escopo confirmado |
| REQ-018 | O administrador consulta registros (as reimpressões ficam como aba ou filtro do Histórico, sem módulo independente), rastreabilidade, histórico de reimpressões e informações de auditoria. | Escopo confirmado |
| REQ-019 | O operador não tem acesso administrativo (CRUD). | Escopo confirmado |
| REQ-020 | Relatório básico do histórico com opção de exportar para Excel (relato de 2026-10-22; colunas e filtros PROVISÓRIOS até a Doowon validar D-017). Consulta, pesquisa e histórico permanecem (REQ-018, REQ-030). | Atualizado em 2026-10-22 (relato do cliente) |

### 1.4 Implantação e hardware

| ID | Requisito | Fonte |
|---|---|---|
| REQ-021 | Implantação inicial: 2 postos de produção, 2 máquinas, 2 PCs, 2 monitores e 2 impressoras industriais. **Cada posto tem uma impressora dedicada; as impressoras não são compartilhadas entre os postos.** | Escopo confirmado; vínculo posto–impressora: informação repassada pela Clavia em 07/10/2026, aguardando identificação da fonte Doowon para evidência formal (D-018) |
| REQ-022 | Aplicação e banco de dados hospedados no ambiente AWS da Doowon. | Escopo confirmado |
| REQ-023 | A arquitetura permite expansão futura para mais máquinas, operadores e peças. | Escopo confirmado |
| REQ-024 | Hardware (PCs, monitores, impressoras, cabos, energia/rede, etiquetas, ribbon e outros consumíveis) é fornecido, garantido e mantido pela Doowon. | Escopo confirmado |
| REQ-025 | A interface de usuário e a comunicação com o cliente usam português do Brasil. | Escopo confirmado |

### 1.5 Interface

| ID | Requisito | Fonte |
|---|---|---|
| REQ-026 | A UI do operador é voltada a público de chão de fábrica com baixa alfabetização digital: alvos grandes, alto contraste, poucas escolhas por tela, mensagens em linguagem simples, status da impressora explícito, prevenção de duplo clique. | Escopo confirmado |

### 1.6 Itens adicionais do documento contratual

| ID | Requisito | Fonte |
|---|---|---|
| REQ-030 | **Pesquisa** de etiquetas e histórico por ID, peça, Part Number, operador, máquina e período. | Documento contratual |
| REQ-031 | **Validação de disponibilidade da impressora** antes do comando de impressão, conforme a capacidade técnica do modelo e da conexão. | Documento contratual |
| REQ-032 | Logs de aplicação e histórico de eventos de impressão para suporte e auditoria. | Documento contratual |
| REQ-033 | Backup e retenção de banco conforme política acordada e recursos do ambiente AWS. | Documento contratual |
| REQ-034 | Treinamento e documentação. | Documento contratual |
| REQ-035 | Testes integrados, homologação em conjunto com a equipe indicada pela Doowon e entrada em produção. | Documento contratual |

## 2. Itens confirmados com detalhe em aberto

| Item | O que está confirmado | O que está em aberto | Decisão |
|---|---|---|---|
| Campos da etiqueta | Lista de informações conhecidas (REQ-011) | Quais ficam visíveis e quais só no QR. "Lote de produção" está excluído até a Doowon confirmar se o conceito existe e qual é a fonte (D-039) | D-010, D-039 |
| QR Code | Existe QR na etiqueta | Conteúdo, formato e consumidor | D-009 |
| Reimpressão | Controlada, com motivo e auditoria | Quem autoriza; motivos; mesmo ID ou novo; etiqueta distinguível | D-019, D-011 |
| Perfis | `ADMIN` e `OPERATOR` | Se a Doowon exigir supervisor/qualidade: novo requisito (mudança) | D-019 |
| Autenticação | Autenticação obrigatória por usuário e senha, com perfis (baseline contratado) | SSO/AD/Entra só se a Doowon exigir: registrar impacto técnico e de escopo (change control) antes de substituir o baseline; método de login no chão | D-005, D-021 |
| Hospedagem | AWS da Doowon | Conta, região, topologia, serviços | D-002 a D-004 |
| Impressora | Industrial, térmica, fornecida pela Doowon | Fabricante, modelo, DPI, protocolo, conexão | D-007 |
| Vínculo posto–impressora | Cada posto tem impressora dedicada, não compartilhada (REQ-036); fonte Doowon a identificar | Evidência formal | D-018 (RESOLVED) |
| Vínculo posto–máquina | Existem 2 postos e 2 máquinas | Se cada posto atende uma máquina fixa ou se o operador escolhe entre máquinas no mesmo posto. **Recomendação da Clavia:** vínculo fixo 1:1 (Posto 01 → Máquina 01; Posto 02 → Máquina 02), com remoção do dropdown de máquina | D-040 |
| Volume | Existe uma indicação de 1.300 a 1.500 etiquetas por demanda | Interpretação e pico | D-008 |
| Relatórios | Consulta, pesquisa e histórico (REQ-018, REQ-030). Geração/exportação fora da expectativa confirmada da V1 | Se a Doowon os quer, quais e em que formato (D-017) | D-017 |
| Nome do produto | — | "INDUSTRACK" era placeholder; nome final em aberto | D-016 |

## 2.1 Proposto, ainda não confirmado

| ID | Requisito proposto | Estado |
|---|---|---|
| REQ-027 | **Production Readiness Gates (D-035):** GATE A (Ready to Develop Locally), GATE B (integração física com impressora representativa) e GATE C (go-live): "Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção." | Proposto, a validar pela Doowon; critérios em `printing-reliability.md` §10 |
| REQ-028 | **Resolução de `UNKNOWN_OUTCOME`:** o `ADMIN` resolve; o `OPERATOR` visualiza o estado e solicita ação, sem resolver. Sem retry automático. | Proposto (recomendação inicial), a validar pela Doowon (D-031) |
| REQ-029 | **Modelo de dados:** `PRINT_JOB → LABEL → PRINT_ATTEMPT`; PRINT_JOB `ORIGINAL` de quantidade N gera exatamente N LABELs; modelo de etiqueta e schema do QR versionados; `payload_hash` e `correlation_id` registrados; auditoria append-only; dados mestres com histórico são inativados, não excluídos | Decisões de engenharia (E-007..E-014); impacto no escopo a confirmar |

## 3. Não confirmado como escopo (qualquer pedido segue o procedimento de mudança)

Itens que **não** estão no escopo técnico confirmado, salvo formalização:

- integração com ERP ou MES;
- SSO / Active Directory / Entra ID;
- integração com PLCs;
- coletores e scanners como parte da solução;
- integrações de terceiros;
- novas máquinas, postos físicos ou módulos adicionais;
- quantidade de etiquetas digitada livremente pelo operador (na V1 os botões confirmados são 4, 8 e 32);
- fila de impressão, seleção de impressora pelo operador e compartilhamento de impressora entre postos (fora da V1; qualquer pedido segue o procedimento de mudança);
- CRUD de impressoras para o ADMIN (a configuração de impressora é técnica e feita na implantação);
- campo "Lote de produção" (até confirmação em D-039);
- geração e exportação de relatórios (até validação em D-017);
- impressão sem conexão (offline).

**Procedimento:** descrever o pedido, avaliar impacto técnico, de prazo e de segurança, classificar e obter aprovação por escrito antes de implementar.

## 4. Princípios de engenharia (não são requisitos contratuais)

Estes princípios orientam o projeto e podem se tornar critérios de aceite quando aprovados. Aqui não são tratados como compromisso contratual:

- segurança e proteção de dados antes de velocidade de desenvolvimento;
- correção e rastreabilidade acima de conveniência;
- falha segura (não imprimir quando não for possível registrar);
- auditabilidade das operações relevantes;
- reprodutibilidade de infraestrutura, migrações e releases.

Ordem de prioridade nos conflitos: correção > rastreabilidade > segurança > clareza operacional > velocidade de implementação.

## 5. Rastreabilidade para teste

Cada REQ será referenciado em `acceptance-criteria.md` e `uat-plan.md`. Limiares numéricos nesses documentos são `PROPOSED — PENDING DOOWON VALIDATION`. Um requisito sem teste correspondente é uma lacuna a corrigir antes do UAT.
