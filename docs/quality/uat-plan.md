# Plano de UAT (testes de aceite com o usuário)

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.3 · **Data:** 2026-10-06
> **Fontes:** diretrizes de engenharia do projeto; `acceptance-criteria.md`; `printing-state-machine.md`; `printing-reliability.md`
> **Natureza:** plano a ser acordado com a Doowon. Limiares numéricos referenciados vêm de `acceptance-criteria.md` e são `PROPOSED — PENDING DOOWON VALIDATION` (ou `TBD — PENDING DOOWON DECISION`); não são compromissos até validação por escrito. Casos que dependem de decisões em aberto estão marcados **[BLOQUEADO por D-xxx]** e não podem ser executados antes dela.

## 1. Objetivo

Comprovar, com evidência, que a solução atende aos requisitos confirmados (`confirmed-requirements.md`) e aos critérios de `acceptance-criteria.md`, em ambiente de homologação com impressora real, antes da entrada em produção.

## 2. Escopo

**Dentro:** administração (máquinas, operadores, peças, turnos), fluxo do operador, impressão de 4/8/32, rastreabilidade, reimpressão, comportamento em falhas, operação simultânea de duas estações, segurança funcional, implantação.

**Fora:** integrações não confirmadas (ERP, MES, SSO se não confirmado, PLCs, scanners como parte da solução), operação sem rede, hardware.

## 3. Ambiente e pré-requisitos (entrada)

| Pré-requisito | Dependência |
|---|---|
| Ambiente de homologação separado da produção, com banco próprio | D-002, D-004 |
| Duas estações com o agente instalado, versão registrada | D-006, D-020, D-028 |
| GATE A (Ready to Develop Locally) e GATE B aprovados (ver `printing-reliability.md` §10) | D-035 |
| Duas impressoras reais, mídia 30 x 20 mm real e ribbon quando aplicável | **D-007** |
| Leitor de QR para validação | E12 / D-009 |
| Dados mestres de amostra carregados (máquinas, peças, operadores, turnos) | D-024, D-025 |
| Contas de teste de `ADMIN` e `OPERATOR` | D-005 |
| Layout de etiqueta aprovado | D-009, D-010 |
| Validação de que o ADMIN resolve `UNKNOWN_OUTCOME` (OPERATOR visualiza e solicita) e definição de quem autoriza reimpressão | D-019, D-031 |
| Política de sessão/troca de operador | D-038 |
| Fuso horário e turnos confirmados | D-013, D-025 |
| Critérios de aceite aprovados pela Doowon | Este plano |
| Release candidate congelada, CI verde | Equipe de entrega |

**Critério de entrada:** todos os pré-requisitos acima atendidos ou com exceção aprovada por escrito.

## 4. Papéis

| Papel | Responsabilidade |
|---|---|
| Responsável de negócio da Doowon | Acompanha e valida os casos operacionais; assina o aceite |
| Responsável técnico da Doowon | Valida rede, estações, segurança, implantação |
| Operadores representativos | Executam o fluxo do operador sem apoio |
| Equipe de entrega | Conduz, registra evidências, corrige defeitos |

## 5. Casos de teste

Cada caso tem resultado: **Passou / Falhou / Bloqueado**, com evidência.

### 5.1 Administrador

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-ADM-01 | Admin entra | Acesso concedido; menu administrativo | REQ-016 |
| UAT-ADM-02 | Criar, editar e desativar máquina | Registros e auditoria corretos | REQ-017, TRC-05 |
| UAT-ADM-03 | Criar e desativar operador | Operador desativado não consegue entrar | REQ-017, SEC-03 |
| UAT-ADM-04 | Criar e editar peça/modelo com descrição e Part Number | Validação do formato (2 letras + 3 números, conforme regra aprovada) | REQ-017, D-024 |
| UAT-ADM-05 | Configurar turnos, incluindo virada noturna | Atribuição correta nos limites | TRC-10 |
| UAT-ADM-06 | Entradas inválidas em todos os formulários | Rejeitadas com mensagem clara | FUN-05 |
| UAT-ADM-07 | Consultar histórico e auditoria | Dados completos e paginados | REQ-018, PERF-07 |
| UAT-ADM-08 | Relatório básico do histórico exportado para Excel | Arquivo .xlsx com os mesmos filtros da tela, abre no Excel e confere com o histórico; colunas PROVISÓRIAS | REQ-020 **[colunas a validar: D-017]** |
| UAT-ADM-09 | Inativar máquina, operador e peça com histórico | Inativação (sem exclusão); histórico legível; indisponível para novas seleções | TRC-15, E-014 |
| UAT-ADM-10 | O ADMIN consulta o status das duas impressoras e tenta criar, editar ou excluir impressora (UI e API) | Vê as duas; nenhuma operação de CRUD disponível | REQ-017, FUN-12 |
| UAT-ADM-11 | O ADMIN consulta versão e status técnico do Print Agent de cada posto e vê nomes amigáveis nas ações de auditoria | Dados corretos; nomes amigáveis em português | FUN-13, FUN-14, E-011 |

### 5.2 Operador

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-OP-01 | Operador entra | Vê identidade e turno | REQ-001, FUN-01 |
| UAT-OP-02 | Selecionar máquina (se D-040 mantiver a escolha) ou verificar que a máquina do posto é exibida sem dropdown (se D-040 confirmar 1:1) | Apenas máquinas permitidas para o posto; sem dropdown no caso 1:1 | REQ-002 **[depende de D-040]** |
| UAT-OP-03 | Selecionar peça | Mostra descrição e PN | REQ-003, REQ-004 |
| UAT-OP-04 | Conferir resumo antes de imprimir | Operador, máquina, peça, PN, turno, impressora vinculada (somente leitura) e quantidade visíveis | REQ-004, REQ-036 |
| UAT-OP-05 | Imprimir 1 | 1 etiqueta, 1 `label_id`, status confirmado | REQ-005, TRC-01 **[BLOQUEADO por D-007]** |
| UAT-OP-06 | Imprimir 10 | 10 etiquetas, 10 `label_id` distintos | REQ-005, TRC-02 **[BLOQUEADO por D-007]** |
| UAT-OP-07 | Imprimir 32 | 32 etiquetas (8 linhas de 4), 32 `label_id` distintos | REQ-005, TRC-02 **[BLOQUEADO por D-007]** |
| UAT-OP-08 | Operador tenta abrir tela de administração | Acesso negado | REQ-019, SEC-03 |
| UAT-OP-09 | Confirmar saída das etiquetas | Estado registrado com evidência | REQ-006 |
| UAT-OP-10 | Sessão expira | Mensagem simples; reentrada sem perda indevida | SEC-06 |
| UAT-OP-12 | Verificar que não existe campo de quantidade livre nem seletor de impressora na tela do operador | Somente botões 4, 8 e 32; impressora exibida sem possibilidade de escolha | REQ-005, REQ-036, FUN-02, FUN-09 |
| UAT-OP-13 | O OPERATOR do Posto 01 consulta o status de impressora, inclusive tentando acessar a do Posto 02 | Vê só a Impressora 01; o acesso à Impressora 02 é negado ou omitido | REQ-036, FUN-11 |
| UAT-OP-14 | O OPERATOR procura versão ou status técnico do Print Agent | Não é exibido | FUN-14 |
| UAT-OP-11 | Operador sem treinamento completa o fluxo | Conclui sem ajuda; observações de usabilidade registradas | REQ-026, FUN-07 |

### 5.3 Rastreabilidade

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-TRC-01 | Buscar etiqueta por `label_id` | Mostra peça, PN, operador, máquina, estação, turno, data/hora, PRINT_JOB, tentativas, reimpressões | REQ-015, TRC-06 |
| UAT-TRC-02 | Alterar descrição e PN da peça, nome do operador e código da máquina; consultar etiquetas antigas | Histórico antigo inalterado | TRC-04 |
| UAT-TRC-03 | Ler o QR físico | Conteúdo corresponde ao esperado | TRC-09 **[BLOQUEADO por D-007, D-009]** |
| UAT-TRC-04 | Comparar quantidade do PRINT_JOB com os estados das LABELs | Soma igual à quantidade solicitada | TRC-08 |
| UAT-TRC-05 | Tentar alterar ou apagar histórico | Impossível | TRC-11, SEC-13 |
| UAT-TRC-06 | Impressão em virada de turno | Turno correto | TRC-10 |
| UAT-TRC-07 | Conferir `template_version`, `qr_schema_version`, `payload_hash` e `correlation_id` de uma etiqueta e da sua reimpressão | Valores presentes; `payload_hash` igual quando o conteúdo é igual; mesmo `correlation_id` em API, agente e auditoria | TRC-13, TRC-14 |
| UAT-TRC-09 | Conferir os campos impressos de uma etiqueta física | Exatamente os campos de REQ-011; nenhum campo adicional | REQ-011, FUN-10 |
| UAT-TRC-08 | Pesquisar por ID, peça, Part Number, operador, máquina e período | Resultados corretos e paginados | REQ-030, FUN-08 |

### 5.4 Reimpressão

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-RPR-01 | Reimpressão sem motivo | Rejeitada | TRC-07 |
| UAT-RPR-02 | Reimpressão com motivo | Mesmo `label_id` (se D-011 aprovado); novo PRINT_JOB `REPRINT` com novo PRINT_ATTEMPT; histórico original intacto | REQ-014, TRC-07 **[depende de D-011, D-019]** |
| UAT-RPR-03 | Reimpressão por usuário sem permissão | Bloqueada | D-019 |
| UAT-RPR-04 | Reimpressão após mudança de dados mestres | Conteúdo do snapshot original | TRC-04 |
| UAT-RPR-05 | Reimpressão de etiqueta com `UNKNOWN_OUTCOME` aberto | Rejeitada até resolver | printing-state-machine §11 |

### 5.5 Clique duplo, idempotência e PRINT_JOB

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-IDM-01 | Clique duplo rápido em "Imprimir 10" | 1 PRINT_JOB e 10 LABELs | REC-01 |
| UAT-IDM-02 | Atualizar a página durante a impressão | Retoma o PRINT_JOB ativo; sem novo pedido | REC-01 |
| UAT-IDM-03 | Segundo pedido (outra chave) na mesma impressora com PRINT_JOB ativo | Bloqueado com "Impressora em uso"; 0 PRINT_JOB/LABEL/PRINT_ATTEMPT novos; rejeição registrada | REC-01, REC-20, E-005 |
| UAT-IDM-04 | Repetir a mesma requisição (ferramenta de teste) | Mesmo `print_job_id`; 0 etiquetas novas | REC-02 |
| UAT-IDM-05 | Quantidade fora de 4/8/32 via API | Rejeitada | FUN-02 |

### 5.6 Falhas de impressão e PRINT_JOB parcial

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-FAIL-01 | Impressora desligada antes do pedido | Aviso; nenhum `PRINTED_CONFIRMED` | REC-06 **[BLOQUEADO por D-007]** |
| UAT-FAIL-02 | Retirar a mídia no meio de um PRINT_JOB de 30 etiquetas | Etiquetas anteriores confirmadas; atual conforme evidência; restantes retidas | REC-07 **[BLOQUEADO por D-007]** |
| UAT-FAIL-03 | Retirar o ribbon (quando aplicável) | Comportamento conforme capacidades | REC-07 **[BLOQUEADO por D-007]** |
| UAT-FAIL-04 | Desconectar USB/rede da impressora durante o envio | `UNKNOWN_OUTCOME`; sem reenvio automático | REC-03, REC-13 **[BLOQUEADO por D-007]** |
| UAT-FAIL-05 | **ADMIN** resolve `UNKNOWN_OUTCOME` como "saiu" e como "não saiu" | Estados corretos; auditoria; nova tentativa apenas após "não saiu" | printing-state-machine §9 |
| UAT-FAIL-09 | **OPERATOR** vê `UNKNOWN_OUTCOME`, solicita ação e tenta resolver (interface e API) | Resolução negada (0 sucessos); `RESOLUTION_REQUESTED` auditado; ADMIN notificado | SEC-17, D-031 |
| UAT-FAIL-06 | PRINT_JOB de 10 e de 30 etiquetas com falha no início, meio e fim | Opções continuar/cancelar/conferir funcionam | REC-07, D-031 |
| UAT-FAIL-08 | **Caso 17/1/12:** PRINT_JOB de 30; forçar falha de comunicação na etiqueta 18 após 17 confirmadas | 1 PRINT_JOB `REQUIRES_REVIEW`; 30 `label_id`; L01–L17 `PRINTED_CONFIRMED`; L18 `UNKNOWN_OUTCOME`; L19–L30 retidas (`JOB_HELD`); 17+1+12=30; nenhuma tentativa criada automaticamente para L18; as 4 combinações de resolução (saiu/não saiu × continuar/cancelar) produzem os estados do `printing-state-machine` §10.1 | REC-15, REC-16, F24 **[BLOQUEADO por D-007]** |
| UAT-FAIL-07 | Impressora sem confirmação de saída | Confirmação do operador exigida; tempo esgotado → `UNKNOWN_OUTCOME` | printing-reliability §4 |

### 5.7 Agente, rede e reinício

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-AGT-01 | Encerrar o agente em `CLAIMED` antes do `ack` | PRINT_ATTEMPT volta a `QUEUED`; 0 saída | REC-04 |
| UAT-AGT-02 | Encerrar o agente durante o envio | `UNKNOWN_OUTCOME` em até 60 s | REC-03 |
| UAT-AGT-03 | Cortar a rede da estação em cada fase (antes do pedido, `QUEUED`, `CLAIMED`, após `ack`) | Estado conforme matriz | REC-05 |
| UAT-AGT-04 | Reiniciar o PC durante um PRINT_JOB | Estado conforme journal; sem duplicidade | REC-08 |
| UAT-AGT-05 | Reiniciar a impressora durante um PRINT_JOB | Tentativas em voo `UNKNOWN_OUTCOME`; procedimento de conferência | printing-reliability F20 |
| UAT-AGT-06 | Revogar a credencial do agente | Rejeição em até 60 s; reinscrição funciona | SEC-08, SEC-16 |
| UAT-AGT-07 | Agente da estação A tenta reivindicar PRINT_ATTEMPT da B | Rejeitado | SEC-08, PERF-06 |
| UAT-AGT-08 | Alterar o relógio da estação | Alertas e bloqueio conforme limites | REC-12 |
| UAT-AGT-09 | Atualizar o agente com e sem PRINT_JOB ativo | Adiado se houver PRINT_JOB ativo; sem perda | D-028 |
| UAT-AGT-11 | Observar heartbeat e versão do agente nas duas estações; parar o agente | Versão e último heartbeat visíveis; alerta e bloqueio de reivindicação | REC-17, E-011 |
| UAT-AGT-12 | Agente com versão fora da faixa suportada tenta reivindicar | Recusado; nada enviado à impressora; alerta | REC-18, E-012 |
| UAT-AGT-10 | Reverter o agente para a versão anterior | Funciona nas duas estações | REC-11 |

### 5.7.1 Sessão e troca de operador

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-SES-01 | Trocar de operador no mesmo PC entre dois pedidos | Cada PRINT_JOB e LABEL registra o operador autenticado no pedido | REC-21 **[BLOQUEADO por D-038]** |
| UAT-SES-02 | Trocar de operador com PRINT_JOB em andamento | Conforme política decidida; atribuição do PRINT_JOB existente inalterada | REC-21 **[BLOQUEADO por D-038]** |
| UAT-SES-03 | Inatividade até expirar a sessão | Sessão bloqueada conforme política; mensagem simples | D-038 **[BLOQUEADO por D-038]** |

### 5.8 Concorrência e capacidade

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-CON-01 | Os dois postos imprimem 30 ao mesmo tempo | A Impressora 01 recebe só PRINT_ATTEMPTs do Posto 01 e a Impressora 02 só os do Posto 02 | PERF-06 |
| UAT-CON-02 | Carga sustentada na interpretação de volume confirmada | 0 perdidas, 0 duplicadas | PERF-08 **[BLOQUEADO por D-008]** |
| UAT-CON-04 | Segundo comando no mesmo posto com PRINT_JOB ativo (duplo clique com chaves diferentes e pedidos simultâneos) | "Impressora em uso"; 0 criações de PRINT_JOB, LABEL e PRINT_ATTEMPT; evento de rejeição registrado | REC-20 |
| UAT-CON-05 | Posto 01 com PRINT_JOB ativo enquanto o Posto 02 imprime | O Posto 02 imprime normalmente; o bloqueio do Posto 01 não o afeta | REC-20, PERF-06 |
| UAT-CON-03 | Medir tempo de um PRINT_JOB de 30 etiquetas | Registro para comparar com o alvo acordado | PERF-05 **[BLOQUEADO por D-007, D-008]** |

### 5.9 Segurança funcional

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-SEC-01 | Operador chama APIs administrativas | 403 em todas | SEC-03 |
| UAT-SEC-02 | Usuário desativado tenta entrar | Rejeitado | UAT-ADM-03 |
| UAT-SEC-03 | Tentar acessar etiqueta/PRINT_JOB por ID de outro contexto | Negado | SEC-04 |
| UAT-SEC-04 | Tentativas excessivas de login | Limitação ativa | SEC-05 |
| UAT-SEC-05 | Buscar logs por segredos | 0 achados | SEC-09 |
| UAT-SEC-06 | Verificar TLS e cabeçalhos | Conforme critérios | SEC-07, SEC-14 |
| UAT-SEC-07 | Conectar ao banco fora da rede permitida | Falha | SEC-12 |

### 5.10 Implantação e continuidade

| ID | Passos resumidos | Resultado esperado | Req. / Critério |
|---|---|---|---|
| UAT-GL-01 | Restore test de backup em ambiente isolado | Evidência de RTO/RPO e integridade | REC-09 **[BLOQUEADO por D-014]** |
| UAT-GL-02 | Ensaio de rollback do aplicativo | Dentro da meta, com smoke tests | REC-10 |
| UAT-GL-03 | Smoke test de produção (definição) | Checklist acordado | GL-19 |
| UAT-GL-04 | Teste de alertas | Alertas disparam e chegam ao destino | GL-13 |

## 6. Matriz física da impressora (após D-007) — insumo do Production Readiness Gate

Para cada impressora e mídia 30 x 20 mm, registrar:

| Teste | Observação |
|---|---|
| 4, 8 e 32 etiquetas | Contagem, alinhamento, corte/destacamento |
| Texto menor legível | Menor fonte legível na etiqueta |
| QR em amostra de 100 | Leitura 100% (TRC-09) |
| Volume sustentado | Conforme D-008 |
| Parar, reiniciar, offline, sem mídia, sem ribbon, erro | Conforme UAT-FAIL |
| Desconexão USB/rede | UAT-FAIL-04 |
| Duas impressoras em paralelo | UAT-CON-01 |
| GATE B: impressora representativa, 1 posto, subconjunto da matriz | Pré-requisito da integração física (GL-B); não substitui o GATE C |
| GATE C: dois postos simultâneos, impressora selecionada, mídia real e ribbon quando aplicável, condições representativas de produção | **Obrigatório para o go-live (GL-00 / PRG-01, D-035)**; se a impressora não usa ribbon, registrar por escrito |

> **GATE C — Production Readiness Gate:** Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção. Detalhes e GATES A/B em `printing-reliability.md` §10.

## 7. Evidências

Para cada caso, arquivar: data/hora, executor, versão da aplicação e do agente, resultado, evidência (captura, foto da etiqueta, trecho de log com `correlation_id`), defeitos abertos.

Modelo de registro:

| Caso | Data | Executor | Versão app/agente | Resultado | Evidência | Defeito |
|---|---|---|---|---|---|---|
| UAT-OP-05 | | | | | | |

## 8. Defeitos e correções

- Severidades S1 a S4 conforme `acceptance-criteria.md` §7.
- Somente defeitos dentro do escopo são corrigidos antes do go-live. Pedidos novos seguem o procedimento de mudança.
- Após cada correção, repetir o caso original e os casos relacionados (regressão).
- Uma nova release candidate invalida os resultados dos casos afetados.

## 9. Critérios de saída

- 100% dos casos aplicáveis executados.
- 0 defeitos S1 e 0 defeitos S2 abertos (S2 apenas com aprovação escrita).
- Casos bloqueados resolvidos ou removidos do escopo por decisão escrita.
- **GL-00 (GATE C — Production Readiness Gate) atendido, sem exceção.**
- GL-A e GL-B atendidos nas fases correspondentes.
- Critérios GL-01 a GL-21 atendidos.

## 10. Aceite

Registro do aceite :

| Item | Preenchimento |
|---|---|
| Versão aceita | [VERSÃO] |
| Data | [DATA] |
| Responsável de negócio (Doowon) | [NOME / ASSINATURA] |
| Responsável técnico (Doowon) | [NOME / ASSINATURA] |
| Responsável pela entrega | [NOME / ASSINATURA] |
| Exceções aprovadas | [LISTA, se houver] |
| Itens pendentes acordados | [LISTA, se houver] |

## 11. Cronograma sugerido

Datas dependem de D-026; não definidas aqui.

| Etapa | Observação |
|---|---|
| Aprovar plano e critérios | Antes de iniciar |
| Carga de dados de homologação | Após D-024/D-025 |
| Execução (admin, operador, rastreabilidade) | Sem impressora real onde possível (simulador) |
| Execução com impressora real | Após D-007 |
| Falhas e recuperação | Após impressora e agente |
| Carga | Após D-008 |
| Correções e regressão | Conforme defeitos |
| Revisão de prontidão e aceite | Última etapa |
