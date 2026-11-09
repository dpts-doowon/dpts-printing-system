# Confiabilidade da impressão — falhas, parâmetros e procedimentos

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.2 · **Data:** 2026-10-06
> **Natureza:** documento de projeto, sem código. Depende de D-007 (impressora) e D-008 (volume).
> **Limiares numéricos:** todo valor numérico deste documento é **PROPOSED — PENDING DOOWON VALIDATION** (ou **TBD — PENDING DOOWON DECISION** quando ainda sem valor). Nenhum é compromisso contratual.
> **Terminologia:** `PRINT_JOB` = pedido do operador; `LABEL` = etiqueta lógica com ID próprio; `PRINT_ATTEMPT` = tentativa de produzir uma saída física de uma LABEL (unidade da máquina de estados). Ver `printing-state-machine.md`.

## 1. Princípios

1. Nenhum envio à impressora sem registro prévio e reconhecimento do servidor (E-004).
2. Incerteza vira `UNKNOWN_OUTCOME`, nunca "impresso" nem retry automático (E-003).
3. Reportar um resultado pode ser repetido; reenviar à impressora, não.
4. O servidor é a fonte de verdade de estado e de tempo; o agente é executor.
5. Cada falha tem classe, correlação e rastro de auditoria.
6. Operação degradada é falha segura (parar), nunca contornar o registro.
7. **Nenhum go-live sem homologação física** (seção 10).

## 2. Matriz de falhas e resposta esperada

| # | Falha | Detecção | Estado resultante | Resposta | Retry automático? |
|---|---|---|---|---|---|
| F1 | Navegador sem conexão ao enviar pedido | Erro de rede no cliente | Nada criado | Mensagem; permitir repetir com a mesma chave | Cliente pode repetir com a mesma chave |
| F2 | Clique duplo / pedido repetido | Chave repetida | 1 PRINT_JOB | Devolver o PRINT_JOB existente | — |
| F3 | Duas chaves para a mesma impressora | PRINT_JOB ativo existente | Segundo pedido rejeitado | "Já existe impressão em andamento" | Não |
| F4 | Refresh do navegador durante o PRINT_JOB | Reabertura da tela | Inalterado | Recuperar o PRINT_JOB ativo da estação | — |
| F5 | API fora do ar | Erro do cliente/agente | Tentativas `QUEUED` | Operação aguarda | Agente repete a consulta |
| F6 | Agente fora do ar | Heartbeat ausente | Tentativas `QUEUED` | Alerta; interface mostra "estação sem agente" | Não aplicável |
| F7 | Perda de rede após reivindicar, antes do `ack` | Lease expira | `QUEUED` | Nada enviado | Sim (nova reivindicação) |
| F8 | Perda de rede após o `ack` | Lease/heartbeat perdidos | `SENDING` → `UNKNOWN_OUTCOME` se sem resultado | Alerta; conferência humana | **Não** |
| F9 | Falha (crash) do agente no envio | Reinício + journal | `UNKNOWN_OUTCOME` | Conferência humana | **Não** |
| F10 | Reinício do PC no meio de um PRINT_JOB | Journal + reaper | Depende do último passo | Algoritmo da seção 13 do state-machine | Só para passos provadamente sem envio |
| F11 | Impressora offline antes do envio | Status/conexão | `QUEUED` retida | Aviso ao operador | Aguarda disponibilidade |
| F12 | Sem mídia ou sem ribbon | Status da impressora, se existir | `QUEUED` retida; ou `UNKNOWN_OUTCOME` se durante o envio | Aviso; reabastecer; conferir | Não durante o envio |
| F13 | Erro da impressora durante o envio | Resposta/status | `FAILED` se provado; senão `UNKNOWN_OUTCOME` | Conforme prova | Não |
| F14 | Timeout de confirmação | Watchdog | `UNKNOWN_OUTCOME` | Conferência humana | **Não** |
| F15 | Falha ao reportar resultado | Erro de rede | Estado ainda não atualizado no servidor | O agente repete o relatório (idempotente) | Sim, só o relatório |
| F16 | Lease expira com tentativa em `SENDING` | Reaper | `UNKNOWN_OUTCOME` | Alerta | **Não** |
| F17 | Dois agentes tentam a mesma tentativa | Atualização condicional | Apenas um vence | O perdedor não envia | — |
| F18 | Relógio da estação fora do limite | Desvio informado | — | Aviso; acima do limite de bloqueio, o agente não reivindica novas tentativas | — |
| F19 | Credencial do agente revogada | Rejeição na autenticação | Tentativas permanecem `QUEUED` | Alerta; reinscrever a estação | — |
| F20 | Impressora desligada com fila interna | Conferência humana | Tentativas em voo `UNKNOWN_OUTCOME` | Procedimento operacional de limpeza | **Não** |
| F21 | Estação errada reivindica tentativa | Vínculo no servidor | Rejeitado | Auditoria de segurança | — |
| F22 | Atualização do agente durante tentativa ativa | Verificação de tentativas ativas | Atualização adiada | Aguardar término | — |
| F23 | Migração/rollback do aplicativo com PRINT_JOBs ativos | Procedimento de implantação | Preservados | Verificar compatibilidade antes | — |
| F24 | Falha no meio de um PRINT_JOB de 8 ou 32 | Estado das tentativas | Restantes retidas | Operador escolhe continuar, cancelar ou conferir (state-machine §10) | **Não** |

## 3. Parâmetros iniciais

Todos os valores abaixo são **PROPOSED — PENDING DOOWON VALIDATION**: ponto de partida técnico, a calibrar após D-007/D-008 e testes na estação real.

| Parâmetro | Valor | Estado |
|---|---|---|
| Intervalo de consulta do agente | 1 s (ou espera longa de 1–2 s) | PROPOSED — PENDING DOOWON VALIDATION |
| Intervalo de heartbeat (inclui `agent_version` e `protocol_version`, E-011) | 5 s (também durante `SENDING`) | PROPOSED — PENDING DOOWON VALIDATION |
| Validade do lease em `CLAIMED` e `SENDING` | 30 s, renovável por heartbeat | PROPOSED — PENDING DOOWON VALIDATION |
| Intervalo do reaper | 15 s (meta: `UNKNOWN_OUTCOME` em até 60 s após perda do agente) | PROPOSED — PENDING DOOWON VALIDATION |
| Watchdog de resultado | maior entre 60 s e 3 × tempo nominal de uma etiqueta | PROPOSED — PENDING DOOWON VALIDATION |
| Desvio de relógio — aviso | 2 s em relação ao servidor | PROPOSED — PENDING DOOWON VALIDATION |
| Desvio de relógio — bloqueio | 10 s | PROPOSED — PENDING DOOWON VALIDATION |
| Máximo de tentativas em voo por impressora | 1 | PROPOSED — PENDING DOOWON VALIDATION |
| Máximo de reivindicações sem envio por tentativa | 5, então alerta | PROPOSED — PENDING DOOWON VALIDATION |
| Espera entre tentativas de conexão | exponencial, teto de 30 s | PROPOSED — PENDING DOOWON VALIDATION |

## 4. Capacidades da impressora (a preencher após D-007)

O adaptador declara o que a impressora oferece; as regras do state-machine se ajustam sem mudar o domínio.

| Capacidade | Valores possíveis | Efeito no modelo |
|---|---|---|
| Confirmação por etiqueta | Sim / Não | Define se `PRINTER_ACK` existe |
| Contador de etiquetas | Sim / Não | Define se `PRINTER_COUNTER` existe |
| Status (pronta, sem mídia, sem ribbon, erro) | Consulta síncrona / eventos / nenhum | Define a precocidade do aviso e a detecção de F11–F13 |
| Fila interna e limpeza | Controlável / não | Define o procedimento de F20 |
| Conexão | USB / Ethernet / outra | Define como detectar queda e timeouts |
| Linguagem / SDK | A definir | Escolha do adaptador |
| Sem confirmação nenhuma | — | Confirmação por operador; sem `PRINTED_CONFIRMED` automático |

**Regra:** nenhuma capacidade é presumida. Se a impressora não oferecer confirmação, o OPERATOR confirma a saída no fluxo normal e o tempo esgotado vira `UNKNOWN_OUTCOME`; a **resolução** de `UNKNOWN_OUTCOME` é feita por ADMIN (RECOMMENDED, D-031).

## 5. Capacidade e volume (D-008 BLOCKER)

A interpretação de "1.300 a 1.500 etiquetas" não está definida. Antes dos testes de carga:

| Dado necessário | Pergunta |
|---|---|
| Total por turno, dia ou lote | H1 |
| Pico por minuto | H2 |
| Turnos e horas por dia | H3 |
| Atraso máximo aceitável | H4 |

**Cálculo de referência (depois de definidos):** etiquetas por minuto exigidas ≤ velocidade efetiva da impressora (incluindo parada entre etiquetas e a latência do ciclo reivindicar → ack → envio → confirmação). Como as tentativas são sequenciais por impressora, a latência por etiqueta soma à velocidade nominal e precisa ser medida na estação real.

**Teste de carga:** cenário baseado na interpretação confirmada, com duas estações simultâneas, por duração **TBD — PENDING DOOWON DECISION**, sem perda nem duplicação.

## 6. Monitoramento e alertas

**Métricas por estação:** versão do agente, último heartbeat, desvio de relógio, status da impressora, tentativas por estado, tempo médio até reivindicar, tempo médio de envio, tempo até confirmação, PRINT_JOBs com retenção.

| Alerta | Condição | Estado do limiar |
|---|---|---|
| Agente sem heartbeat | Acima de 30 s | PROPOSED — PENDING DOOWON VALIDATION |
| `UNKNOWN_OUTCOME` aberto | Qualquer ocorrência; escala se aberto por mais de 10 minutos | PROPOSED — PENDING DOOWON VALIDATION |
| PRINT_JOB retido | Acima de 5 minutos sem decisão | PROPOSED — PENDING DOOWON VALIDATION |
| Tentativa em `QUEUED` sem reivindicação | Acima de 30 s com agente ativo | PROPOSED — PENDING DOOWON VALIDATION |
| Desvio de relógio | Acima do limite de aviso | PROPOSED — PENDING DOOWON VALIDATION |
| Falhas de autenticação do agente | Mais de 3 em 5 minutos | PROPOSED — PENDING DOOWON VALIDATION |
| Agente com versão fora da faixa suportada (E-012) | Qualquer | Sem limiar numérico |
| `RESOLUTION_REQUESTED` sem ação de ADMIN | Qualquer; escala conforme o alerta de `UNKNOWN_OUTCOME` aberto | PROPOSED — PENDING DOOWON VALIDATION |
| Atualização de agente adiada por PRINT_JOB ativo | Qualquer | Sem limiar numérico |
| Divergência de reconciliação | Qualquer | Sem limiar numérico |

## 7. Reconciliação

Rotina periódica (frequência **TBD — PENDING DOOWON DECISION**; sugestão: diária e antes do fechamento de cada turno) que verifica:

- Para cada PRINT_JOB `ORIGINAL`: número de LABELs = quantidade solicitada = número de tentativas com `attempt_no = 1`.
- Para cada LABEL: ao menos uma tentativa; estados válidos; nenhuma tentativa não terminal esquecida.
- Nenhum `UNKNOWN_OUTCOME` aberto além do prazo definido.
- Nenhuma LABEL com duas tentativas `PRINTED_CONFIRMED` do mesmo `attempt_no`, nem com tentativa criada depois de uma `UNKNOWN_OUTCOME` sem resolução humana (INV-5).
- Hashes de snapshot conferem.

Divergência gera alerta e registro; não corrige dados automaticamente.

## 8. Procedimentos operacionais (runbooks a criar)

| Procedimento | Resumo |
|---|---|
| Resolver `UNKNOWN_OUTCOME` | Conferir a impressora e a saída, marcar "saiu" ou "não saiu", registrar observação |
| PRINT_JOB parcialmente impresso | Decidir continuar, cancelar restantes ou conferir; registrar |
| Impressora sem mídia/ribbon | Reabastecer; conferir se a última etiqueta saiu; retomar |
| Impressora reiniciada | Limpar a fila interna, conferir a tentativa em voo, resolver desconhecidos |
| Estação reiniciada | Aguardar o agente; verificar tentativas; resolver desconhecidos |
| Agente sem conexão | Verificar rede/proxy; reiniciar serviço; reportar |
| Credencial revogada | Reinscrever a estação com novo token de uso único |
| Atualização do agente | Verificar tentativas ativas; aplicar na janela; validar versão; testar |
| Rollback do agente | Reinstalar a versão anterior assinada; validar |

## 9. Testes de confiabilidade (mapeados em `uat-plan.md`)

| Cenário | Verifica |
|---|---|
| Duplo clique e duas chaves | F2, F3 |
| Reenvio da mesma requisição 100 vezes | Idempotência |
| Matar o agente em cada passo do envio | F8, F9, F16 |
| Cortar a rede em cada passo | F7, F8, F15 |
| Reiniciar o PC em cada passo | F10 |
| Desligar a impressora no meio de um PRINT_JOB | F12, F13, F20 |
| PRINT_JOB de 30 com falha no início, meio e fim; caso 17 confirmadas + 1 desconhecida + 12 não enviadas | F24 |
| Duas estações simultâneas | F17, F21 |
| Desvio de relógio induzido | F18 |
| Atualização do agente com e sem tentativa ativa | F22 |

## 10. Production Readiness Gates (A, B e C) — D-035

Três gates **distintos**, cada um com finalidade própria. Um gate anterior **não substitui** o seguinte. Nenhum critério abaixo foi aprovado pela Doowon: todo item é `PROPOSED — PENDING DOOWON VALIDATION` ou `TBD — PENDING DOOWON DECISION`, e os critérios numéricos usam apenas os IDs já definidos em `acceptance-criteria.md` (que têm seus próprios estados de limiar).

| Gate | Finalidade | Quando |
|---|---|---|
| **GATE A** | **Ready to Develop Locally**: autorizar o desenvolvimento local | Antes do primeiro código de produto |
| **GATE B** | Autorizar a **integração física** com uma impressora representativa | Antes de implementar/validar o adaptador de impressora em hardware real |
| **GATE C** | **Production Readiness** com os dois postos finais | Antes de qualquer go-live |

### GATE A — Ready to Develop Locally (PROPOSED — PENDING DOOWON VALIDATION)

Finalidade: autorizar o desenvolvimento **local**. Não é preciso que conta, região ou topologia AWS estejam provisionadas; é preciso conhecer as **restrições arquiteturais obrigatórias da Doowon** em grau suficiente para não construir uma solução incompatível.

Escopo liberado: base do repositório, qualidade (CI), núcleo de domínio, interface, autenticação local por usuário e senha (baseline contratado), simulador de impressora e banco local. **Continuam bloqueados** código específico de impressora (sem D-007), provisionamento e implantação AWS.

| Condição | Referência |
|---|---|
| Restrições arquiteturais obrigatórias da Doowon conhecidas (tecnologia, licenças, contêineres, restrições de rede e segurança que afetem a arquitetura), por Technical Discovery ou resposta escrita; nenhuma restrição conhecida e pendente que torne a solução incompatível | Pré-leitura, perguntas 4, 8 e 9 |
| Repositório definido (Doowon) ou alternativa temporária aprovada por escrito | D-001 |
| Modelo `PRINT_JOB → LABEL → PRINT_ATTEMPT` e invariantes aceitos | `printing-state-machine.md` |
| Requisitos confirmados registrados e rastreados para teste | `confirmed-requirements.md`, matriz de rastreabilidade |
| Aprovação | Registro por escrito (signatários: TBD — PENDING DOOWON DECISION) |

**Não são condições do GATE A:**
- **D-005:** o baseline contratado é autenticação local por usuário e senha. Se a Doowon exigir SSO/AD/Entra ID, registrar o impacto técnico e de escopo (change control) antes de substituir o baseline.
- **D-002 a D-004** (conta, região, topologia e serviços AWS): são necessárias antes de **fechar e implantar** a arquitetura AWS (pré-requisito de implantação, necessário até o GATE C), não para o desenvolvimento local.

### GATE B — integração física com impressora representativa (PROPOSED — PENDING DOOWON VALIDATION)

Finalidade: validar adaptador, renderização 30 × 20 mm, QR e tratamento de status/erros em **hardware real**, antes do go-live. **Não substitui o GATE C.**

| Condição | Detalhe |
|---|---|
| Impressora | O modelo selecionado (D-007) ou, se ainda indisponível, uma impressora **representativa** acordada por escrito (mesma família, DPI e linguagem) |
| Insumos | Documentação técnica; unidade de teste; mídia 30 × 20 mm; ribbon quando aplicável |
| Conteúdo mínimo | 4, 8 e 32 etiquetas; leitura de QR; menor texto legível; subconjunto da matriz física do `uat-plan.md` §6 definido com a Doowon |
| Postos | Um posto é suficiente (os dois são exigidos no GATE C) |
| Evidência | Fotos, leitura de QR e registros arquivados |
| Aprovação | Registro por escrito (signatários: TBD — PENDING DOOWON DECISION) |

### GATE C — Production Readiness com os dois postos finais (PRG-01 / GL-00)

> **Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção.**

Este gate é **bloqueante** e não admite exceção por cronograma. Resultados de simulador, de impressora diferente da selecionada, do GATE B ou de apenas um posto **não substituem** a homologação.

| Condição | Detalhe |
|---|---|
| Impressora | O **modelo selecionado** pela Doowon (D-007), nas duas unidades finais |
| Mídia e ribbon | Mídia **real**, a mesma da produção. Ribbon **quando aplicável**: em impressora térmica direta não há ribbon, e essa não aplicabilidade é registrada por escrito no relatório |
| Postos | **Os dois postos finais**, operando de forma simultânea |
| Condições representativas | Rede, proxy e firewall reais; operadores reais; turno real ou equivalente; volume conforme D-008; dados mestres reais ou representativos |
| Duração | **TBD — PENDING DOOWON DECISION** |
| Conteúdo | Matriz física do `uat-plan.md` §6, incluindo leitura de QR e cenários de falha (inclusive 17/1/12 e resolução por ADMIN) |
| Evidência | Registros, fotos das etiquetas e leitura do QR arquivados |
| Aprovação | Registro assinado pela Doowon e pela Clavia |

Registro: **GL-00** (GATE C) e **GL-A**, **GL-B** em `acceptance-criteria.md`; **D-035** em `decision-log.md`.

## 11. Segurança do canal de impressão

- TLS entre agente e backend; credencial por estação (D-027).
- O backend nunca recebe comandos da impressora do navegador; apenas a intenção validada.
- O agente não executa conteúdo arbitrário vindo do servidor; apenas renderiza modelos aprovados e versionados.
- O agente não expõe porta de rede para entrada (preferência por conexões de saída; a confirmar em D-020).
- Logs do agente não contêm credenciais.
