# Critérios de aceite mensuráveis

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.7 · **Data:** 2026-10-07
> **Fontes:** `confirmed-requirements.md`; `printing-state-machine.md`; `printing-reliability.md`; diretrizes de engenharia do projeto
> **Importante:** nenhum limiar numérico deste documento foi acordado com a Doowon. Todos são `PROPOSED — PENDING DOOWON VALIDATION` e **não constituem compromisso contratual** até validação por escrito. Os que dependem de decisões em aberto estão marcados `TBD — PENDING DOOWON DECISION` e não têm valor definido.

## Como ler

| Coluna | Significado |
|---|---|
| ID | Identificador estável, referenciado no `uat-plan.md` |
| Critério / Medida | O que é medido e como |
| Limiar | Valor-alvo. Ver coluna *Estado do limiar* |
| Estado do limiar | `PROPOSED — PENDING DOOWON VALIDATION` = valor proposto, ainda não acordado; `TBD — PENDING DOOWON DECISION` = valor depende de decisão da Doowon |
| Verificação | Como se comprova (automatizada, UAT, auditoria, documento) |
| Req. / Decisão | Requisito ou decisão relacionada |

Um critério só é considerado atendido com **evidência arquivada** (relatório de teste, captura, log, ata).

---

## 1. Segurança

| ID | Critério / Medida | Limiar | Verificação | Req. / Decisão | Estado do limiar |
|---|---|---|---|---|---|
| SEC-01 | Segredos no histórico do Git (varredura do histórico completo) | 0 achados na release | Varredura automatizada em CI | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-02 | Vulnerabilidades em dependências (varredura em CI) | 0 críticas e 0 altas não tratadas; médias triadas em até 30 dias | CI + registro de exceções | D-033 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-03 | Endpoints administrativos acessados por `OPERATOR` ou sem autenticação | 100% dos endpoints do inventário retornam 403/401; inventário completo | Teste automatizado sobre o inventário de rotas | REQ-016, REQ-019 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-04 | Acesso indevido a recursos de outra entidade (IDOR/BOLA) em etiqueta, PRINT_JOB e histórico | 0 sucessos nos casos testados | Testes de segurança automatizados e manuais | REQ-016 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-05 | Proteção contra força bruta no login | Bloqueio ou atraso progressivo após 5 falhas em 15 minutos | Teste automatizado | D-005 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-06 | Expiração de sessão | Conforme política da Doowon. Valor a definir (D-005) | Teste automatizado do valor configurado | D-005 | TBD — PENDING DOOWON DECISION |
| SEC-07 | Transporte | Apenas TLS 1.2 ou superior; sem porta HTTP sem redirecionamento | Varredura de configuração | D-003 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-08 | Identidade do agente | 100% das chamadas do agente sem credencial válida rejeitadas; agente da estação A não reivindica jobs da estação B (0 sucessos); credencial revogada rejeitada em até 60 s | Testes de integração e segurança | D-027 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-09 | Dados sensíveis em logs | 0 senhas, tokens, segredos ou cabeçalhos de autenticação em amostra de logs de teste | Varredura automatizada + amostra manual | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-10 | Integridade do instalador do agente | Assinatura válida verificada no CI e na instalação, **se exigida** (valor a definir; D-029) | Verificação de assinatura | D-029 | TBD — PENDING DOOWON DECISION |
| SEC-11 | SBOM por release | 100% das releases (aplicação e agente) com SBOM arquivado | CI | D-033 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-12 | Banco acessível pela internet | Conexão externa ao banco falha em 100% dos testes | Teste de rede | D-003 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-13 | Imutabilidade de snapshot, attempts e auditoria | O papel de banco da aplicação não consegue atualizar nem apagar essas tabelas (0 sucessos) | Teste de permissões | E-002 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-14 | Cabeçalhos de segurança e CORS | Cabeçalhos presentes e CORS restrito à lista permitida | Varredura de configuração | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-15 | Análise estática de código | 0 achados de severidade alta abertos | CI (SAST) | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-16 | Rotação de credencial do agente | Concluída sem perder jobs e sem parar a produção | Teste de rotação em HML | D-027 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-17 | Resolução de `UNKNOWN_OUTCOME` restrita a ADMIN | `OPERATOR` tenta resolver pela API e pela interface: 0 sucessos; solicitação de ação (`RESOLUTION_REQUESTED`) é registrada e notifica o ADMIN | Teste de autorização automatizado e UAT | D-031 | PROPOSED — PENDING DOOWON VALIDATION |
| SEC-18 | Auditoria append-only (E-013) | 0 caminhos de `UPDATE`/`DELETE` em auditoria, snapshots, tentativas e despachos pelo papel da aplicação; correção = novo evento | Teste de permissões e revisão de código | E-013, SEC-13 | PROPOSED — PENDING DOOWON VALIDATION |

## 2. Performance

Os limiares abaixo valem para as **duas estações** operando ao mesmo tempo, em HML com dados representativos. Os que dependem do volume ou da impressora estão marcados.

| ID | Critério / Medida | Limiar | Verificação | Req. / Decisão | Estado do limiar |
|---|---|---|---|---|---|
| PERF-01 | Latência de leitura (telas e consultas paginadas) | p95 ≤ 500 ms; p99 ≤ 1 s | Teste de carga | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-02 | Aceite do pedido de impressão (do envio ao retorno do `print_job_id`) para 1, 10 e 30 etiquetas | p95 ≤ 1 s | Teste de carga | REQ-005 | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-03 | Tempo entre o PRINT_JOB aceito e a primeira tentativa reivindicada | p95 ≤ 3 s | Teste de integração | D-020 | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-04 | Sobrecarga de software por etiqueta (da reivindicação ao envio), excluindo a impressão física | p95 ≤ 200 ms | Teste com simulador e impressora real | D-007 | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-05 | Tempo total de um PRINT_JOB de 30 etiquetas | Valor a definir (depende da velocidade da impressora, D-007, e do pico, D-008) | Teste na impressora real | D-007, D-008 | TBD — PENDING DOOWON DECISION |
| PERF-06 | Dois postos simultâneos | 0 PRINT_ATTEMPTs roteados para a impressora do outro posto; degradação de throughput ≤ 10% frente a um posto | Teste de carga com os dois postos | E-006, E-021, D-018 | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-07 | Busca de histórico com 1 milhão de etiquetas sintéticas | p95 ≤ 1 s com paginação | Teste de carga com dados sintéticos | REQ-015 | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-08 | Carga sustentada na interpretação de volume confirmada | Valor a definir (D-008): 0 etiquetas perdidas ou duplicadas durante a duração definida | Teste de carga | D-008 | TBD — PENDING DOOWON DECISION |
| PERF-09 | Listas sem paginação | 0 endpoints sem limite de itens | Revisão de rotas | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-10 | Consultas por requisição nas telas principais | Número constante de consultas (sem N+1); máximo proposto de 10 por requisição | Teste automatizado | Diretrizes de engenharia | PROPOSED — PENDING DOOWON VALIDATION |
| PERF-11 | Carregamento da tela do operador na estação | p75 ≤ 2 s; depende do hardware (D-006) | Medição na estação | REQ-026 | PROPOSED — PENDING DOOWON VALIDATION |

## 3. Rastreabilidade

| ID | Critério / Medida | Limiar | Verificação | Req. / Decisão | Estado do limiar |
|---|---|---|---|---|---|
| TRC-01 | Unicidade do identificador de etiqueta | 0 colisões em 10.000 etiquetas geradas; restrição de unicidade no banco | Teste automatizado | REQ-012 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-02 | PRINT_JOB de 30 | Exatamente 1 PRINT_JOB e 30 `label_id` independentes e distintos e 30 conteúdos de QR distintos (se o QR contém o ID) | Teste automatizado e UAT | REQ-012, D-009 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-12 | PRINT_JOB × LABEL | Pedido de 30 etiquetas gera exatamente 1 PRINT_JOB e 30 LABELs com `label_id` independentes; cada LABEL tem snapshot próprio | Teste automatizado e UAT | REQ-012, REQ-027 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-13 | `payload_hash`, `template_version`, `qr_schema_version` | 100% das LABELs e tentativas têm os três valores; reimpressão gera `payload_hash` igual ao original quando o conteúdo é o mesmo | Teste automatizado | E-008, E-009, D-036 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-14 | `correlation_id` ponta a ponta | 100% das tentativas de uma amostra de teste têm o mesmo `correlation_id` na API, no agente, na auditoria e nos logs | Teste de integração e inspeção de logs | E-010 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-15 | Inativação de dado mestre com histórico | 0 exclusões físicas de registro com histórico; registro inativado não aparece em nova seleção e permanece legível no histórico | Teste automatizado e UAT | E-014 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-03 | Integridade do snapshot | 100% das etiquetas com snapshot completo (campos obrigatórios não nulos) | Restrições do banco + teste | E-002 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-04 | Imutabilidade após mudança de dados mestres | Alterar descrição/PN da peça, nome do operador, código da máquina ou turno: 0 mudanças no snapshot histórico; reimpressão gera `snapshot_hash` idêntico ao original | Teste automatizado e UAT | E-002, D-024 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-05 | Auditoria das transições | 100% das transições da máquina de estados geram evento de auditoria com ator, estação e horário | Teste que enumera as transições | REQ-014 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-06 | Consulta por `label_id` | Retorna PRINT_JOB, tentativas, reimpressões e motivos completos; p95 ≤ 1 s | Teste de integração e UAT | REQ-015 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-07 | Reimpressão | Sem motivo: rejeitada em 100% dos testes; com motivo: mesmo `label_id`, novo PRINT_JOB `REPRINT` com nova tentativa (`attempt_no` seguinte); registros originais inalterados (comparação de hash) | Teste automatizado e UAT | REQ-014, D-011 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-08 | Reconciliação | Para cada PRINT_JOB, soma de etiquetas por estado = quantidade solicitada; divergência = 0 | Rotina de reconciliação | printing-reliability §7 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-09 | Leitura física do QR | 100% das etiquetas de uma amostra de 100 consecutivas por impressora decodificam o conteúdo esperado na primeira leitura | Teste físico com leitor da Doowon | D-009, D-007 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-10 | Tempo e turno | Registros em UTC; exibição no fuso confirmado; atribuição correta de turno nos limites (um segundo antes e depois da virada, incluindo turno noturno) | Teste automatizado | D-013, D-025 | PROPOSED — PENDING DOOWON VALIDATION |
| TRC-11 | Exclusão ou alteração de histórico pela aplicação | 0 caminhos que apaguem ou alterem histórico de etiquetas | Revisão de permissões e teste | E-002 | PROPOSED — PENDING DOOWON VALIDATION |

## 4. Recuperação de falhas

| ID | Critério / Medida | Limiar | Verificação | Req. / Decisão | Estado do limiar |
|---|---|---|---|---|---|
| REC-01 | Clique duplo | 0 PRINT_JOBs duplicados em 1.000 envios duplicados com a mesma chave; segundo pedido com outra chave para a mesma impressora bloqueado com "Impressora em uso" em 100%, sem criar PRINT_JOB | Teste automatizado e UAT | E-001, E-005 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-02 | Reenvio idempotente | 100 repetições do mesmo pedido: 1 PRINT_JOB, 0 etiquetas novas | Teste automatizado | E-001 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-03 | Agente encerrado durante `SENDING` | 100% de 50 execuções: PRINT_ATTEMPT em `UNKNOWN_OUTCOME` em até 60 s após a perda; 0 reenvios automáticos | Teste de injeção de falha | E-003 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-04 | Agente encerrado em `CLAIMED` antes do `ack` | 100%: PRINT_ATTEMPT volta a `QUEUED`; 0 saídas físicas | Teste de injeção de falha | E-004 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-05 | Matriz de rede (cenários da seção 12 do state-machine) | 100% dos cenários terminam no estado esperado | Teste de integração e UAT | D-012 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-06 | Impressora offline | 0 jobs marcados `PRINTED_CONFIRMED`; aviso ao operador em até 5 s após a detecção | UAT com impressora real | REQ-006 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-07 | PRINT_JOB parcial (falha no início, meio e fim de PRINT_JOBs de 10 e 30 etiquetas) | Etiquetas anteriores confirmadas; a atual `FAILED` ou `UNKNOWN_OUTCOME`; posteriores retidas; opções do operador funcionam; auditoria completa | UAT e teste automatizado | D-031 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-15 | Caso 17/1/12 | Em PRINT_JOB de 30: 17 `PRINTED_CONFIRMED`, 1 `UNKNOWN_OUTCOME`, 12 não enviadas (`QUEUED` com `hold_reason=JOB_HELD`); soma = 30; PRINT_JOB em `REQUIRES_REVIEW` | Teste automatizado (F24) e UAT | D-031, E-003 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-16 | INV-5 | 0 tentativas criadas ou executadas automaticamente para LABEL cuja última tentativa é `UNKNOWN_OUTCOME`, incl. após reinício, expiração de lease e reentrega | Teste automatizado e inspeção de código | E-003, INV-5 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-17 | Heartbeat e versão do agente | O servidor registra versão e último heartbeat de 100% das estações; ausência de heartbeat gera alerta e impede nova reivindicação | Teste automatizado | E-011 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-18 | Compatibilidade Agent ↔ Backend | Agente fora da faixa de versão suportada: 0 reivindicações aceitas; versão atual e anterior aceitas | Teste de compatibilidade no CI | E-012 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-19 | Atualização e rollback controlados do agente | Atualização adiada com job ativo ou `UNKNOWN_OUTCOME` aberto; rollback bem-sucedido nas duas estações sem perda de PRINT_JOB | Ensaio com evidência | E-015, D-028 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-20 | Concorrência no mesmo posto (regra da V1) | 0 PRINT_JOBs ativos concorrentes para a impressora de um posto; em 100% dos comandos concorrentes no mesmo posto (simultâneos ou sequenciais, inclusive com chaves de idempotência diferentes) a resposta é "Impressora em uso", com 0 PRINT_JOBs, LABELs ou PRINT_ATTEMPTs criados; evento de rejeição registrado; o bloqueio de um posto não afeta o outro | Teste automatizado e UAT | E-005, E-018, D-018 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-21 | Sessão e troca de operador | PRINT_JOB e LABELs registram o operador autenticado no pedido; troca de operador não altera atribuição de PRINT_JOBs existentes | Teste automatizado e UAT | D-038 | TBD — PENDING DOOWON DECISION |
| REC-08 | Reinício da estação | Agente retoma o contato em até 60 s após iniciar o serviço; 0 duplicidades; estados corretos conforme o journal | Teste na estação real | D-028 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-09 | Restauração de backup | Restauração concluída; RTO medido ≤ alvo e perda de dados medida ≤ RPO. Valor a definir (D-014); verificação de integridade (contagens, integridade referencial, hashes de snapshot) = 100% | Restore test com evidência | D-034 | TBD — PENDING DOOWON DECISION |
| REC-10 | Rollback do aplicativo | Reversão para a versão anterior em até 15 minutos e smoke tests aprovados; migração compatível verificada em HML | Ensaio em HML | D-032 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-11 | Rollback do agente | Reinstalação da versão anterior nas duas estações, sem perder jobs | Ensaio em HML | D-028 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-12 | Desvio de relógio | Acima do limite de aviso: alerta; acima do bloqueio: 0 novas reivindicações | Teste com relógio alterado | D-030 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-13 | `UNKNOWN_OUTCOME` | 0 transições automáticas para `PRINTED_CONFIRMED` ou para novo envio; saída apenas por conferência humana auditada | Teste automatizado | E-003 | PROPOSED — PENDING DOOWON VALIDATION |
| REC-14 | Reaper idempotente | Execuções repetidas e simultâneas não alteram estados já resolvidos | Teste automatizado | printing-state-machine §13 | PROPOSED — PENDING DOOWON VALIDATION |

## 5. Funcional (amostra mapeada aos requisitos)

| ID | Critério | Limiar | Req. | Estado do limiar |
|---|---|---|---|---|
| FUN-01 | Login do operador, seleção de peça e seleção ou exibição da máquina (conforme D-040), e visualização de PN, descrição, operador e turno antes de imprimir | 100% dos casos do UAT passam | REQ-001 a REQ-004 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-02 | Botões 1, 10 e 30 geram exatamente essas quantidades; a interface não tem campo de quantidade livre; nenhuma outra quantidade é aceita pela API | 100% | REQ-005, E-016 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-03 | Operador não acessa nenhuma função administrativa | 0 acessos | REQ-019 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-04 | Admin gerencia máquinas, operadores, peças, turnos e consulta histórico e auditoria | 100% dos casos do UAT passam | REQ-017, REQ-018 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-05 | Entradas inválidas são rejeitadas no servidor com mensagem compreensível | 100% dos casos de validação | REQ-026 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-06 | Mensagens de erro ao operador sem termos técnicos | Revisão linguística aprovada | REQ-026 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-07 | Alvos de toque e contraste | Alvos de ação principal ≥ 48 px e contraste mínimo WCAG AA nas telas do operador | REQ-026 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-09 | A interface do operador não permite escolher a impressora; mostra o status da impressora vinculada ao posto; o servidor ignora/rejeita destino informado pelo cliente | 100% dos casos do UAT; 0 caminhos que aceitem impressora vinda do navegador | REQ-036, E-017, E-021, D-018 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-10 | A etiqueta contém exatamente os campos de REQ-011 (descrição 2L+3N, Part Number, operador, turno, data de produção, QR Code, identificador único) e nenhum campo adicional não confirmado | 100% das etiquetas da amostra do UAT | REQ-011, E-019 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-11 | Visibilidade do status de impressora: o OPERATOR vê só a impressora do próprio posto; o ADMIN vê as duas; o servidor não retorna dados da outra impressora ao OPERATOR | 100% dos casos do UAT; 0 respostas da API com dados de outro posto para o OPERATOR | REQ-036, E-023 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-12 | O ADMIN não tem criação, edição nem exclusão de impressora na interface ou na API; só visualização de status | 0 endpoints e 0 telas de CRUD de impressora | REQ-017, REQ-036, E-022 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-13 | A interface em português mostra nomes amigáveis das ações de auditoria; internamente os nomes técnicos são normalizados | 100% das ações exibidas ao ADMIN com nome amigável; 0 identificadores técnicos na interface | REQ-018 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-14 | Versão e status técnico do Print Agent aparecem apenas para o ADMIN/área técnica | 0 exibições ao OPERATOR (interface e API) | E-011, E-023 | PROPOSED — PENDING DOOWON VALIDATION |
| FUN-08 | Pesquisa por ID, peça, Part Number, operador, máquina e período | 100% dos casos de pesquisa do UAT retornam o conjunto esperado, paginado | REQ-030 | PROPOSED — PENDING DOOWON VALIDATION |

## 6. Gates A, B e C e go-live

GL-A e GL-B são pré-requisitos de fases (desenvolvimento local e integração física). GL-00 é pré-requisito de go-live.

Todos os itens abaixo são condições binárias (sim/não, com evidência). O go-live não ocorre enquanto algum item aplicável estiver "não"; **GL-00 é obrigatório e não admite exceção**.

| ID | Condição | Evidência |
|---|---|---|
| **GL-A** | **GATE A — Ready to Develop Locally** (`PROPOSED — PENDING DOOWON VALIDATION`): condições em `printing-reliability.md` §10 | Registro de aprovação |
| **GL-B** | **GATE B — integração física com impressora representativa** (`PROPOSED — PENDING DOOWON VALIDATION`); não substitui GL-00 | Relatório do GATE B |
| **GL-00** | **GATE C — Production Readiness (PRG-01):** Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção. (Ribbon "quando aplicável": em impressora térmica direta registra-se por escrito a não aplicabilidade.) Condições em `printing-reliability.md` §10; decisão D-035. | Relatório de homologação física assinado |
| GL-01 | Todas as decisões BLOCKER fechadas e registradas (D-007, D-008 e as demais) | `decision-log.md` |
| GL-02 | Versão de produção marcada e aprovada pela Doowon; formalização do aceite | Registro de aceite |
| GL-03 | CI verde na release; 0 defeitos S1/S2 abertos; S3 abertos acordados por escrito | Relatório do CI e do UAT |
| GL-04 | SEC-01 a SEC-16 aplicáveis atendidos ou com exceção aprovada por escrito | Relatório de segurança |
| GL-05 | Teste de 1, 10 e 30 etiquetas (1 PRINT_JOB cada, com N LABELs) aprovado nas duas estações com impressora real | Evidências do UAT |
| GL-06 | Leitura física do QR conforme TRC-09 | Evidência fotográfica e registro |
| GL-07 | Teste de carga com volume confirmado concluído (PERF-08) | Relatório de carga |
| GL-08 | Duas estações simultâneas sem roteamento cruzado (PERF-06) | Relatório do UAT |
| GL-09 | Testes de recuperação REC-01 a REC-14 aplicáveis aprovados | Relatório do UAT |
| GL-10 | Restore test concluído com evidência (REC-09) | Relatório do restore test |
| GL-11 | Rollback do aplicativo e do agente ensaiados (REC-10, REC-11) | Relatório do ensaio |
| GL-12 | Backup configurado e política de retenção acordada (D-014, D-015, D-023) | Configuração e ata |
| GL-13 | Monitoramento e alertas ativos e testados (printing-reliability §6) | Teste de alerta |
| GL-14 | Runbooks entregues e revisados (printing-reliability §8) | Documentos |
| GL-15 | Versão do agente conhecida em cada estação; assinatura válida, se exigida | Inventário |
| GL-16 | Contas de administrador e operadores de produção criadas e revisadas; segredos de produção separados e fora do Git | Checklist |
| GL-17 | Banco de produção isolado e não exposto | SEC-12 |
| GL-18 | Contatos de acompanhamento e janela de implantação definidos | Ata |
| GL-19 | Smoke tests de produção definidos e executados após a implantação | Registro |
| GL-20 | SBOM da release arquivado | SEC-11 |
| GL-21 | Treinamento e documentação entregues e registrados (REQ-034) | Registro de treinamento e documentos |

## 7. Classificação de defeitos (para o UAT)

| Severidade | Definição | Exemplo |
|---|---|---|
| S1 | Etiqueta errada, duplicada ou falsa confirmação; falha de segurança; perda de dados | Duas etiquetas físicas para um mesmo `label_id` sem reimpressão |
| S2 | Função principal inutilizável sem contorno | Não consegue imprimir 30 |
| S3 | Função afetada com contorno aceitável | Filtro de histórico falha em um campo |
| S4 | Cosmético ou melhoria | Texto com erro de digitação |

**Regra:** qualquer S1 bloqueia o go-live. S2 bloqueia, salvo aprovação escrita da Doowon.
