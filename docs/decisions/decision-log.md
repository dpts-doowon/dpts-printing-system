# Registro de decisões

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.11 · **Data:** 2026-10-22
> **Fontes:** diretrizes de engenharia do projeto; `confirmed-requirements.md`; `printing-state-machine.md`
> **Regra central:** nenhuma resposta da Doowon é assumida. Ao receber uma resposta, registrar quem respondeu, a data e a fonte, e atualizar o status.

## Convenção de status

| Status | Significado |
|---|---|
| CONFIRMED | Acordado explicitamente pela Doowon (registrar fonte e data) |
| OPEN | Sem decisão; precisa de resposta da Doowon |
| BLOCKER | Trava uma fase até ser respondida |
| RECOMMENDED | Recomendação técnica, ainda não aprovada pela Doowon |
| DECIDIDO-INTERNO | Decisão de engenharia que não depende da Doowon (registrar em ADR) |
| RESOLVED | Decisão de escopo ou de produto tomada pela Clavia (aprovada em 2026-10-07). Não é aceite da Doowon; quando indicado, ainda precisa ser comunicada ou validada com a Doowon |
| NOT APPLICABLE / CLOSED | A decisão não se aplica ao escopo da V1 por causa de um fato confirmado; fica registrada para referência |

## 1. Decisões que dependem da Doowon

| ID | Decisão | Status | Dono | Bloqueia | Perguntas |
|---|---|---|---|---|---|
| D-001 | Repositório GitHub na organização da Doowon desde o dia 1? | OPEN — relato de 2026-10-22: desenvolvimento local; o código será entregue à Doowon na implantação (repositório do projeto ou outro meio a combinar) | Doowon | Fase 2 (há fallback aprovável) | A1–A7 |
| D-002 | Conta e região AWS | OPEN — relato de 2026-10-22: a Doowon ainda não tem conta AWS; hospedagem temporária até haver conta e migração depois (a confirmar com a Doowon) | Doowon | Fechar e implantar a arquitetura AWS (não bloqueia o desenvolvimento local) | B1, B2, B5–B7, B12, B14 |
| D-003 | Topologia de acesso (pública, privada, VPN), DNS, TLS, WAF | OPEN — relato de 2026-10-22: acesso pela Internet; domínio doowonbrasil.net, aplicação em doowonbrasil.net/etiquetas (quem roteia o subcaminho no domínio, TLS e proteções a definir) | Doowon | Fechar e implantar a arquitetura AWS (não bloqueia o desenvolvimento local) | B3, B4, B8, B9 |
| D-004 | Serviços aprovados de computação e banco | OPEN — relato de 2026-10-22: sem restrições a serviços de computação e banco | Doowon | Fechar e implantar a arquitetura AWS (não bloqueia o desenvolvimento local) | B4 |
| D-005 | Autenticação local vs SSO/AD/Entra. O escopo contratado prevê autenticação por usuário e senha com perfis; SSO/AD depende de aditivo | OPEN — **baseline contratado: autenticação local por usuário e senha**. Não bloqueia o desenvolvimento local. Se a Doowon exigir SSO/AD/Entra ID, registrar impacto técnico e de escopo (change control) antes de substituir o baseline — relato de 2026-10-22: usuário e senha, cadastrados pelo administrador (baseline confirmado) | Doowon | Slice de autenticação (Fase 4) | C1–C4 |
| D-006 | SO, versão e política de instalação nas estações | OPEN — relato de 2026-10-22: a Clavia instalará o Print Agent nas máquinas; sistema operacional: Windows (versão ainda a informar, relato de 2026-10-22) | Doowon | Instalação do agente | D1, D2, D7, D10, D14, C9 |
| D-007 | Impressora: fabricante, modelo, DPI, protocolo, conexão | **BLOCKER** — modelo informado em 2026-10-21: Elgin L42 Pro Full (USB, Ethernet, serial; ZPL/EPL/PPLA/PPLB). Validação física prevista para 2026-10-23; dpi, mídia e ribbon a confirmar | Doowon | Fase 5 (integração) e layout | E1–E8, E10, E11 |
| D-008 | Significado de 1.300–1.500 etiquetas e pico por minuto | **BLOCKER** — resposta parcial (relato de 2026-10-22): "1.300 a 1/500 por dia", texto a confirmar (provável 1.300–1.500 por dia); pico por minuto e unidade de contagem em aberto | Doowon | Validação de capacidade | H1–H4, E9 |
| D-009 | Conteúdo, formato e consumidor do QR | OPEN — resposta parcial (relato de 2026-10-22): as etiquetas serão lidas pela Hyundai, que disponibilizou o executável de leitura do QR; o formato do leitor foi levantado e implementado de forma PROVISÓRIA (E-024); falta a Doowon confirmar flag, hora e Trace Number | Doowon | Layout da etiqueta | G1–G3, E12 |
| D-010 | Campos visíveis na etiqueta 30 x 20 mm | OPEN | Doowon | Layout da etiqueta | G4–G6, G10 |
| D-011 | Reimpressão com o mesmo ID lógico | RECOMMENDED | Doowon/Clavia | Modelo de dados | G10 |
| D-012 | Impressão sem rede (offline) | RECOMMENDED: não; falhar fechado; relato de 2026-10-22: se a rede principal cair, o posto passa para outra rede (a detalhar). Não está registrado se a Doowon aceitou a recomendação "não imprimir sem conexão" | Doowon | Arquitetura de impressão | H5, H6 |
| D-013 | Fuso horário | OPEN — relato de 2026-10-22: horário de Brasília (informado para o logout forçado; assumido para o sistema, a confirmar para turnos e datas) | Doowon | Turnos e datas | F9 |
| D-014 | Backup: RPO, RTO, retenção, disponibilidade | OPEN — resposta parcial (relato de 2026-10-22): perda máxima de dados (RPO) de até 60 minutos; RTO, retenção, disponibilidade, frequência do teste de restauração e responsável em aberto | Doowon | Antes de produção | B11, H7–H9 |
| D-015 | Retenção de logs e auditoria; destino dos logs | OPEN | Doowon | Observabilidade | B10, C8 |
| D-016 | Nome do produto na aplicação | OPEN | Doowon/Clavia | UI | I6 |
| D-017 | Relatórios e exportações obrigatórios. Relato de 2026-10-22: relatório básico com exportação para Excel; implementado em caráter provisório (E-020 atualizada); consulta e histórico permanecem | OPEN — resposta (relato de 2026-10-22): relatório básico com opção de exportar para Excel; colunas e filtros a validar | Doowon | Aceite | G11 |
| D-018 | Vínculo posto → Print Agent → impressora: Posto 01 → Print Agent 01 → Impressora 01; Posto 02 → Print Agent 02 → Impressora 02. Impressora dedicada ao posto, não compartilhada; configuração técnica; o operador nunca a seleciona (E-017, E-021, E-006) | **RESOLVED (2026-10-07)** — informação repassada pela Clavia em 07/10/2026, aguardando identificação da fonte Doowon para evidência formal | Doowon | Modelo de dados e roteamento | D8 (fechada) |
| D-019 | Quem autoriza reimpressão e quais os motivos | OPEN — resposta parcial (relato de 2026-10-22): o próprio operador reimprime a etiqueta com problema, individualmente (ex.: de 1 a 10, só a 10); motivos aceitos em aberto | Doowon | Reimpressão; perfis | G8, G9 |
| D-020 | Arquitetura de impressão (agente local vs alternativa) | RECOMMENDED: agente local | Doowon + Clavia | Fase 5 | C10, D3, D5, D6 |
| D-021 | Método de login do operador no chão | OPEN — relato de 2026-10-22: usuário e senha | Doowon | UI de login | C11 |
| D-022 | Padrões ou restrições de stack da Doowon | OPEN — relato de 2026-10-22: a Doowon não tem padrão; a Clavia pode propor a stack (ADR-0001) | Doowon | Fase 2 | B15, B17, C6 |
| D-023 | Retenção do histórico de etiquetas e política LGPD | OPEN — resposta a esclarecer (relato de 2026-10-22): sobrescrever a base a cada 6 meses, sem manter histórico | Doowon | Banco e auditoria | C7, G5, G7 |
| D-024 | Regra de validação da descrição, dono e política de mudança dos dados mestres (inclui inativação em vez de exclusão com histórico — E-014) | OPEN | Doowon | Dados mestres | F1–F8 |
| D-025 | Definição dos turnos, incluindo virada noturna | OPEN | Doowon | Turnos | F5 |
| D-026 | Datas de kickoff e liberação de dependências; responsáveis | OPEN | Doowon | Cronograma | I1–I3, I5, B16 |
| D-035 | **Production Readiness Gates A, B e C.** GATE A: **Ready to Develop Locally** (restrições arquiteturais obrigatórias conhecidas; sem exigir AWS provisionada). GATE B: integração física com impressora representativa. GATE C (go-live): "Nenhum go-live poderá ocorrer sem homologação física da impressora selecionada, mídia real e ribbon quando aplicável, utilizando os dois postos em condições representativas de produção." Critérios e signatários de cada gate (`printing-reliability.md` §10) | OPEN (estrutura dos gates: proposta; critérios e duração: `TBD — PENDING DOOWON DECISION`) | Doowon + Clavia | Início do desenvolvimento, integração física, go-live | D-001, D-007, D-008 |
| D-036 | Versionamento do schema do QR Code (campo de versão, compatibilidade, convivência de versões, consumidores) | OPEN | Doowon | Layout/QR; leitores | J1–J3 (D-009) |
| D-037 | Política de concorrência e fila **entre postos**. Cada posto tem impressora dedicada, sem compartilhamento: não há concorrência entre postos pela mesma impressora. Permanece só a proteção no mesmo posto (E-005): PRINT_JOB ativo bloqueia o novo comando antes da criação. Fila fora da V1 | **NOT APPLICABLE / CLOSED (V1)** | — | — | J4–J6 (fechadas) |
| D-038 | Política de sessão e troca de operador no chão de fábrica (identificação, inatividade, PC compartilhado, troca com PRINT_JOB em andamento, virada de turno) | OPEN — resposta parcial (relato de 2026-10-22): logout forçado às 15h30 e às 00h30 (horário de Brasília), com novo login obrigatório | Doowon | Autenticação do operador; atribuição | J7–J10 (D-005, D-021, D-025) |
| D-039 | Conceito "Lote de produção" (exibido no protótipo): se existe, origem, formato e quem informa. Não é o PRINT_JOB. **Exclusão provisória aprovada em 2026-10-07 (E-019):** fora da etiqueta e dos fluxos confirmados até a Doowon confirmar | OPEN | Doowon | Layout da etiqueta; dados mestres | J16–J17 (D-010) |
| D-041 | **Premissas de partida do desenvolvimento local (2026-10-20):** repositório privado temporário com histórico completo, a transferir ao repositório da Doowon; stack inicial (TypeScript, React/Next.js, Node.js 22/NestJS, PostgreSQL, GitHub Actions; ADR-0001); autenticação local; 2 postos com impressora dedicada; vínculo posto → máquina fixo 1:1 como premissa. Comunicadas à Doowon, que deve se posicionar caso seja contra | PREMISSA DE PARTIDA (não é aceite da Doowon; objeção da Doowon exige revisão e análise de impacto) | Doowon + Clavia | Desenvolvimento local | D-001, D-022, D-040 |
| D-040 | Vínculo posto → máquina: cada posto atende uma máquina fixa ou o operador escolhe entre várias máquinas no mesmo posto? (a impressora já é dedicada: D-018). **Recomendação da Clavia (RECOMMENDED; não aceita pela Doowon):** vínculo fixo 1:1 — Posto 01 → Máquina 01; Posto 02 → Máquina 02. Se a Doowon confirmar, o dropdown de máquina sai da interface do operador | OPEN — CONFIRMED (relato de 2026-10-22; fonte Doowon a identificar): vínculo 1:1, os dois postos podem rodar ao mesmo tempo com os mesmos Part Numbers, e operador e administrador de um posto podem entrar no outro | Doowon | Seleção de máquina (REQ-002); dados mestres | D9 (pergunta 10 da pré-leitura) |

## 2. Decisões técnicas: agente, entrega e operação

Todas abaixo estão **OPEN ou RECOMMENDED**: cada recomendação depende de confirmação, de ADR e, quando indicado, de informação da Doowon.

| ID | Decisão | Status | Depende de | Perguntas |
|---|---|---|---|---|
| D-027 | Autenticação entre Print Agent e backend | RECOMMENDED (ADR pendente) — sem resposta (2026-10-22: a Doowon não soube responder); seguimos com a recomendação até haver requisitos de PKI | D-006, D-020; requisitos de PKI da Doowon | C12, C13 |
| D-028 | Distribuição e atualização controlada do Print Agent (inclui rollback, compatibilidade e janela — E-011, E-012, E-015) | OPEN | D-006, C10, D11 | D3, D11, D14 |
| D-029 | Assinatura do executável | OPEN | D-006, D-028 | D4, D12 |
| D-030 | Sincronização de relógio | RECOMMENDED (ADR pendente) | D-013 | D13, G6 |
| D-031 | Estratégia para PRINT_JOB parcialmente impresso; **resolução de UNKNOWN_OUTCOME por ADMIN** (OPERATOR visualiza e solicita ação) | RECOMMENDED (a validar com a Doowon); bloqueio da impressora e disponibilidade de ADMIN por turno OPEN; relato de 2026-10-22: "tem que estar na mão do operador" e há um administrador para os 3 turnos (impacto na resolução de UNKNOWN_OUTCOME por ADMIN a confirmar) | D-007, D-019, D-038 | H10, G12, D15, E13, J11–J12 |
| D-032 | Política de rollback | RECOMMENDED (ADR pendente) | D-004, B13 | B13, B20, I4 |
| D-033 | SBOM e gestão de dependências | RECOMMENDED; exigência da Doowon OPEN | D-022 | B18, A6, C5 |
| D-034 | Restore test de backup | RECOMMENDED; frequência e dono OPEN | D-014 | B19, H9 |

### D-027 Autenticação Print Agent ↔ backend

**Problema:** o agente roda em PC de chão de fábrica. Uma credencial vazada ou compartilhada permitiria que alguém reivindique PRINT_ATTEMPTs de outros postos ou injete resultados falsos de impressão.

**Direção recomendada (a confirmar em ADR; não assume SO nem PKI da Doowon):**
- Uma identidade por estação, única e revogável. Nunca compartilhada entre estações.
- Cadastro inicial em duas etapas: um administrador gera um token de inscrição de uso único e curta validade; o agente o troca por uma credencial própria da estação.
- Credencial preferencialmente por certificado de cliente (mTLS) ou token assinado de curta duração, guardada no cofre protegido do SO (depende de D-006).
- O servidor associa a credencial a `station_id` e `printer_id`; o agente só consegue reivindicar jobs da própria estação.
- Chamadas que alteram estado (claim, SENDING, resultado) são autenticadas e protegidas contra repetição.
- Rotação e revogação com efeito rápido (meta em `acceptance-criteria.md`, SEC-08).
- Os segredos nunca vão para o repositório nem para o instalador.
- O agente não guarda credenciais de usuário.

**Opções a avaliar:** mTLS com autoridade certificadora da Doowon; mTLS com autoridade da Clavia; token assinado com chave por estação; credenciais de cliente OAuth2. A escolha depende de C12 e C13.

### D-028 Distribuição e atualização do Print Agent

**Problema:** o agente precisa ser instalado e atualizado em estações sob política da Doowon, sem interromper impressão em andamento.

**Opções:** instalação manual por técnico (Clavia ou Doowon); ferramenta corporativa de distribuição (Intune, SCCM, GPO); atualização automática puxada do backend com verificação de assinatura.

**Regras recomendadas (independentes da opção):**
- O agente informa sua versão ao backend em todo contato.
- O backend define a versão mínima aceita.
- Nenhuma atualização com PRINT_JOB ativo (PRINT_ATTEMPT em CLAIMED, SENDING ou UNKNOWN_OUTCOME pendente); aguardar o término.
- Atualizações assinadas e verificadas antes de instalar.
- Procedimento de reversão para a versão anterior, testado nas duas estações.
- Janela de atualização combinada com a Doowon.

### D-029 Assinatura do executável

**Problema:** políticas de EDR, antivírus ou listas de aplicações permitidas podem exigir binário assinado.

**Opções:** certificado de assinatura de código da Doowon; certificado da Clavia; autoridade interna da Doowon com allowlisting.

**Regras recomendadas:** a assinatura acontece no CI com chave protegida (sem chave em laptop de desenvolvedor); a assinatura é verificada na instalação e na atualização; a cadeia de custódia da chave é documentada.

### D-030 Sincronização de relógio

**Problema:** data/hora aparece na etiqueta, define turno e ordena eventos. PCs com relógio errado produzem registros incorretos.

**Direção recomendada:** o servidor é a fonte autoritativa de tempo para eventos de negócio (criação do PRINT_JOB, snapshot, turno). O relógio do agente é informativo: o agente informa o desvio em relação ao servidor em cada contato. Desvio acima do limite de aviso gera alerta; acima do limite de bloqueio, o agente não reivindica novos jobs. NTP nas estações é requisito (confirmar D13). Valores iniciais propostos em `printing-reliability.md`.

**Em aberto:** qual hora vale na etiqueta (hora do pedido ou da impressão) — G6/D-010.

### D-031 Estratégia para PRINT_JOB parcialmente impresso

**Problema:** em um PRINT_JOB de 8 ou 32 etiquetas, uma falha no meio deixa parte das etiquetas físicas impressas e parte não. Exemplo modelado: 17 confirmadas, 1 `UNKNOWN_OUTCOME`, 12 não enviadas (`printing-state-machine.md` §10.1).

**Direção recomendada (detalhes em `printing-state-machine.md`):**
- Um pedido gera 1 PRINT_JOB e N LABELs independentes; cada LABEL tem `label_id`, snapshot e tentativas próprios; o estado do PRINT_JOB é derivado.
- Uma etiqueta é enviada por vez, na ordem do PRINT_JOB.
- Falha ou resultado desconhecido em uma etiqueta **retém** as etiquetas restantes; nada é enviado automaticamente.
- O operador vê quais etiquetas foram confirmadas, falharam, estão desconhecidas e quais não foram enviadas.
- Opções (do ADMIN): continuar restantes, cancelar restantes, resolver as desconhecidas por conferência física. O operador visualiza e solicita ação.
- Etiquetas em UNKNOWN_OUTCOME nunca recebem nova tentativa automática (INV-5).

**Recomendação inicial (aprovada pela Clavia em 2026-10-06, a validar com a Doowon):** `ADMIN` resolve `UNKNOWN_OUTCOME`. `OPERATOR` visualiza o estado e **solicita ação** (evento auditado `RESOLUTION_REQUESTED`), mas não resolve; a autorização é aplicada na API. Não cria terceiro perfil.

**Em aberto (Doowon):** aceita ADMIN como único resolvedor? Há ADMIN disponível em todos os turnos? A impressora fica bloqueada até a resolução (recomendado)? Qual a alternativa aprovada se não houver ADMIN no turno?

### D-032 Política de rollback

**Direção recomendada:**
- Cada release é uma versão marcada e reimplantável.
- Migrações compatíveis com a versão anterior (expandir e depois contrair), para que reverter o aplicativo não exija reverter o banco.
- Migração destrutiva só com backup verificado e plano aprovado, nunca no mesmo passo de uma implantação.
- Smoke tests após qualquer implantação e após qualquer rollback.
- Rollback do agente é procedimento próprio (D-028).
- Autorizador do rollback e janela: definir com a Doowon (B20).

### D-033 SBOM e dependências

**Direção recomendada:**
- SBOM (formato padrão aberto, a combinar) gerado no CI por release, para aplicação e agente, e arquivado.
- Lockfiles obrigatórios; varredura de vulnerabilidades em cada PR.
- Política de licenças: permissivas por padrão; GPL/AGPL ou comerciais só com revisão e aprovação.
- Avaliação de cada dependência nova (manutenção, vulnerabilidades, proveniência, licença).
- Entrega do SBOM à Doowon se exigido (B18).

### D-034 Restore test de backup

**Direção recomendada:** antes do go-live, restaurar um backup em ambiente isolado, medir o tempo e a perda de dados reais contra RPO/RTO, validar integridade (contagens, integridade referencial, hashes de snapshot) e registrar a evidência. Repetir com frequência a definir após go-live. Dono, frequência e meta dependem de D-014, B19 e H9.

## 3. Decisões de engenharia internas (não dependem da Doowon)

| ID | Decisão | Status | Onde está detalhada |
|---|---|---|---|
| E-001 | Todo pedido de impressão carrega chave de idempotência; o servidor garante unicidade e compara a assinatura do pedido | DECIDIDO-INTERNO | `printing-state-machine.md` §6 |
| E-002 | O evento de impressão preserva um snapshot imutável, gravado por valor, dos dados usados para gerar a etiqueta | DECIDIDO-INTERNO | `printing-state-machine.md` §4 |
| E-003 | Nenhum retry automático de impressão quando o resultado físico é desconhecido (UNKNOWN_OUTCOME) | DECIDIDO-INTERNO (aprovado 2026-10-06) | `printing-state-machine.md` §2.2 (INV-5), §9 |
| E-004 | O agente só envia bytes à impressora depois de o servidor confirmar a transição para SENDING (reconhecimento antes do primeiro byte) | DECIDIDO-INTERNO (revisitar se D-012 mudar) | `printing-state-machine.md` §5 |
| E-005 | No máximo um PRINT_JOB ativo (não terminal) por impressora, que é a do posto; novo comando é bloqueado com "Impressora em uso", sem criar PRINT_JOB | DECIDIDO-INTERNO — **regra da V1** (D-037 fechada em 2026-10-07); rejeitar, sem fila | `printing-state-machine.md` §6 |
| E-006 | O roteamento para impressora é derivado no servidor a partir da estação autenticada, nunca de dado enviado pelo navegador | DECIDIDO-INTERNO | `printing-state-machine.md` §7 |
| E-007 | **Modelo oficial `PRINT_JOB → LABEL → PRINT_ATTEMPT`.** Um PRINT_JOB `ORIGINAL` de quantidade N gera exatamente N LABELs, cada uma com `label_id` imutável; PRINT_JOB e LABEL nunca são o mesmo objeto | DECIDIDO-INTERNO (aprovado 2026-10-06) | `printing-state-machine.md` §2 |
| E-008 | Modelo de etiqueta versionado (`template_id`, `template_version` imutável); snapshot grava a versão | DECIDIDO-INTERNO | `printing-state-machine.md` §4.4 |
| E-009 | `payload_hash` do payload canônico gravado em LABEL e PRINT_ATTEMPT (integridade e reprodução) | DECIDIDO-INTERNO | `printing-state-machine.md` §4.6 |
| E-010 | `correlation_id` ponta a ponta (navegador, API, PRINT_JOB, LABEL, PRINT_ATTEMPT, agente, auditoria, logs) | DECIDIDO-INTERNO | `printing-state-machine.md` §4.7 |
| E-011 | Heartbeat autenticado com `agent_version` e `protocol_version` por estação | DECIDIDO-INTERNO (parâmetros: `PROPOSED — PENDING DOOWON VALIDATION`) | `printing-state-machine.md` §8.1 |
| E-012 | Compatibilidade Agent ↔ Backend: faixa de versão suportada; agente fora da faixa não reivindica | DECIDIDO-INTERNO | `printing-state-machine.md` §8.2 |
| E-013 | Auditoria, snapshots, tentativas e despachos append-only; correção por novo evento | DECIDIDO-INTERNO | `printing-state-machine.md` §4.8 |
| E-014 | Dados mestres com histórico são inativados, nunca excluídos | DECIDIDO-INTERNO (política de retenção: D-023) | `printing-state-machine.md` §4.9 |
| E-015 | Atualização do agente nunca com PRINT_JOB ativo; versão anterior preservada; rollback ensaiado (mecanismo: D-028) | DECIDIDO-INTERNO | `printing-state-machine.md` §8.3 |
| E-016 | **Quantidade fixa na V1:** somente 4, 8 e 32 (alterado em 2026-11-06 a pedido da Doowon, relato, fonte a identificar: a mídia imprime 4 etiquetas por linha e assim nenhuma etiqueta é desperdiçada; antes: 1, 10 e 30); sem campo de quantidade livre na interface ou na API | RESOLVED (2026-10-07; atualizado em 2026-11-06) | `confirmed-requirements.md` REQ-005 |
| E-017 | **Impressora dedicada ao posto:** o operador vê o status, mas nunca escolhe a impressora (reforça E-006) | RESOLVED (2026-10-07); D-018 RESOLVED | REQ-036 |
| E-018 | **Sem fila na V1:** impressora do posto ocupada bloqueia o novo comando antes de criar PRINT_JOB e mostra mensagem clara (reforça E-005); o bloqueio de um posto não afeta o outro | RESOLVED (2026-10-07) | REQ-037; `printing-state-machine.md` §6.4 |
| E-019 | **Campos da etiqueta limitados a REQ-011:** descrição da peça (2 letras + 3 números), Part Number, operador, turno, data de produção, QR Code e identificador único. "Lote de produção" e outros campos só com confirmação da Doowon | RESOLVED (2026-10-07); D-039 e D-010 seguem abertas | REQ-011 |
| E-020 | **Relatórios:** relatório básico do histórico com exportação para Excel (.xlsx), conforme relato de 2026-10-22; colunas e filtros PROVISÓRIOS até a Doowon validar D-017/REQ-020. Consulta, pesquisa e histórico permanecem | ATUALIZADA (2026-10-22); D-017 segue aberta para validação das colunas | REQ-020, REQ-030 |
| E-021 | **Um Print Agent por posto:** Print Agent 01 só enxerga as tentativas do Posto 01 e imprime na Impressora 01; Print Agent 02, as do Posto 02 e a Impressora 02 (reforça E-006 e D-027) | RESOLVED (2026-10-07) | REQ-036; `printing-state-machine.md` §7 e §8 |
| E-022 | **Configuração de impressora é técnica:** na V1 não há CRUD de impressora para o ADMIN; o ADMIN visualiza o status; vínculos e parâmetros são definidos na implantação pela Clavia/Doowon TI, com registro da mudança | RESOLVED (2026-10-07) | REQ-036, REQ-017 |
| E-023 | **Visibilidade do status da impressora:** o OPERATOR vê apenas a impressora vinculada ao próprio posto; o ADMIN vê as duas; aplicado no servidor | RESOLVED (2026-10-07) | REQ-036 |
| E-024 | **QR no padrão H/KMC e etiqueta nova (relato de 2026-11-06, fonte Doowon a identificar):** QR no quadro `[)>` RS `06` GS … GS RS EOT (regras conferidas no leitor da Hyundai). Supplier Code global (AQ2A, cadastro do admin); Part Number sem hífen; Sequence Code = ALC; EO Number opcional por peça; data AAMMDD; 4M = código de 4 caracteres do operador; flag = código do turno; Trace Number sequencial automático a partir de 1; Área do Fornecedor opcional (Configurações). Impressa na etiqueta: ALC em destaque, Part Number, data (AAMMDD) e hora; operador e turno deixam de ser impressos. PROVISÓRIO até a Doowon confirmar: flag do leitor só aceita A ou @ (conflito com A/B/C), posição da hora no QR, escopo e formato do Trace Number | PROVISÓRIO (v0.11.0-local); D-009/D-036 parcialmente respondidas | `confirmed-requirements.md` REQ-011 |

## 4. Decisões confirmadas pela Doowon

A linha abaixo foi repassada pela Clavia em 07/10/2026; ainda não há respondente nem documento da Doowon identificados e a decisão não é atribuída a nenhuma pessoa. As demais linhas virão da ata da Technical Discovery.

| ID | Decisão | Respondido por | Data | Fonte |
|---|---|---|---|---|
| D-018 | Exatamente 2 postos na implantação inicial; cada posto tem uma impressora dedicada, não compartilhada (Posto 01 → Agente 01 → Impressora 01; Posto 02 → Agente 02 → Impressora 02) | [fonte Doowon a identificar] | 07/10/2026 | Informação repassada pela Clavia em 07/10/2026, aguardando identificação da fonte Doowon para evidência formal |
| D-040 | Vínculo Posto → Máquina fixo 1:1. As duas máquinas podem rodar ao mesmo tempo, inclusive com os mesmos Part Numbers. O operador e o administrador de um posto podem fazer login no outro posto, e vice-versa | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-018 (reforço) | O operador do Posto 1 não pode imprimir, por este sistema, na impressora do Posto 2 (e vice-versa). O mesmo administrador atende os dois postos | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-014 (parcial) | Perda máxima de dados (RPO) aceita: até 60 minutos. RTO, retenção, disponibilidade, frequência do teste de restauração e responsável seguem em aberto | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-017 | Relatório básico, com opção de exportar para Excel | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-019 / D-031 (parcial) | A reimpressão fica na mão do operador, que pode reimprimir apenas a etiqueta com problema (ex.: de 1 a 10, só a 10). Há um administrador para os 3 turnos. Motivos aceitos e quem resolve UNKNOWN_OUTCOME seguem em aberto | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-038 (parcial) | O sistema deve forçar o logout às 15h30 e às 00h30, exigindo novo login | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-009 (parcial) | As etiquetas serão lidas pela Hyundai, que disponibilizou um executável que lê o QR Code. O formato exigido por esse leitor ainda deve ser obtido | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-023 (a esclarecer) | A cada 6 meses, sobrescrever a base de dados, sem necessidade de manter histórico. Falta definir o alcance (tudo ou só etiquetas e tentativas), se é rolante ou total e a relação com auditoria e rastreabilidade | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-012 (parcial) | Se a rede principal cair, o posto passa para outra rede. Falta confirmar a recomendação de não imprimir sem conexão e detalhar a segunda rede | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-008 (parcial) | Volume informado como "1.300 a 1/500 por dia" (texto a confirmar). Pico por minuto e unidade de contagem em aberto | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-001 | Sem repositório da Doowon no início: desenvolvimento local; o código será entregue na implantação, pelo repositório do projeto ou outro meio a combinar | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-022 | Não há padrão de tecnologia da Doowon; a Clavia pode propor | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-002 | A Doowon ainda não possui conta AWS; hospedagem temporária até a conta existir, com migração depois | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-003 | Acesso pela Internet, no domínio doowonbrasil.net, com a aplicação em doowonbrasil.net/etiquetas | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-004 | Sem restrições a serviços de computação e banco de dados | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-005 / D-021 | Autenticação por usuário e senha cadastrados pelo administrador (operador e administrador) | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-006 | A Clavia instalará o Print Agent nas máquinas, que usam Windows (versão a informar) | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-038 (reforço) / D-013 | Logout forçado às 15h30 e às 00h30, no horário de Brasília | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |
| D-027 | Sem resposta da Doowon | [fonte Doowon a identificar] | 2026-10-22 (relato) | Repassado pela Clavia; sem documento da Doowon |

## 5. Como atualizar

1. Ao receber uma resposta, mudar o status e preencher a seção 4.
2. Para decisões que afetam arquitetura, criar ADR em `docs/adr/` (pasta a criar na Fase 2) e referenciar o ID aqui.
3. Mudança de escopo segue o procedimento de controle de mudanças acordado entre as partes.


## 6. Limiares numéricos

Valores numéricos citados nestas decisões ou nos documentos relacionados são `PROPOSED — PENDING DOOWON VALIDATION` até aceite por escrito e não são compromissos contratuais.
