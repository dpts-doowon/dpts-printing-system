# Pauta — Technical Discovery Doowon x Clavia

> **Classificação:** SAFE_FOR_DOOWON
> **Status:** Rascunho v0.3 · **Data do documento:** 2026-10-06
> **Fontes:** escopo confirmado do projeto e diretrizes de engenharia
> **Convenção de status:** CONFIRMED · OPEN · RECOMMENDED · BLOCKER · DECIDIDO-INTERNO. Nada neste documento assume respostas da Doowon.

## 1. Objetivo

Fechar, em uma reunião de 90 minutos, as informações que destravam a fundação do projeto e classificar cada resposta como CONFIRMED, OPEN ou BLOCKER, com dono e prazo. O resultado alimenta `docs/decisions/decision-log.md`, os ADRs e o plano de implementação.

**Resultado esperado:** nenhuma dependência crítica de arquitetura ou segurança desconhecida para iniciar a fundação do código (Fase 2) e a infraestrutura de homologação (Fase 3).

## 2. Logística

| Item | Definição |
|---|---|
| Data / hora | [DATA] às [HORA] (a definir) |
| Duração | 90 minutos (versão reduzida de 60 minutos na seção 5) |
| Formato | [Videoconferência / presencial] |
| Pré-leitura | `docs/discovery/customer-preread.md`, enviada até 48 horas antes |
| Ata | Registro ao vivo por Clavia, enviado à Doowon para validação |

**Participantes necessários (por papel):**

| Papel | Por quê |
|---|---|
| TI / infraestrutura AWS | Conta, região, rede, serviços aprovados, IAM, DNS/TLS |
| Segurança da informação | Autenticação/SSO, requisitos de varredura, SIEM, política para software em estações |
| Rede / suporte de estações | Proxy, firewall, instalação e atualização de software, EDR, sincronização de relógio |
| Responsável de produção / qualidade | Fluxo do operador, etiqueta, QR, reimpressão, volume, turnos |
| Responsável pela impressora (compras/engenharia) | Modelo, documentação, unidade de teste, prazo de decisão |
| Equipe de entrega | Condução, registro, classificação das respostas |

## 3. Regras de condução

1. Cada resposta é classificada ao vivo: **CONFIRMED** (decisão clara), **OPEN** (precisa de dono e data) ou **BLOCKER** (trava uma fase).
2. Sem resposta na reunião: registrar o nome de quem responderá e o prazo.
3. Escopo, prazo ou solução que dependam de decisão da Doowon só são considerados confirmados após registro por escrito.
4. Pedidos fora do escopo confirmado seguem o procedimento de mudança acordado, fora da reunião.

## 4. Pauta (90 minutos)

| Horário | Tema | Objetivo | Itens de referência | Decisões |
|---|---|---|---|---|
| 0–5 | Abertura | Objetivos, papéis, forma de classificar respostas, datas de kickoff e liberação de dependências | I1–I5 | D-026 |
| 5–15 | Fluxo, escopo e vínculo posto–máquina | Alinhar o fluxo do operador, os 2 postos (cada um com impressora dedicada, a evidenciar), os botões 4/8/32 e a recomendação de vínculo fixo 1:1 entre posto e máquina | G (fluxo), D9 | D-040, D-038 |
| 15–30 | Impressora | Modelo, DPI, linguagem/SDK, conexão, documentação, unidade de teste, prazo de decisão | E1–E13 | D-007 |
| 30–45 | GitHub e AWS | Repositório, conta, região, topologia, serviços aprovados, IAM, DNS/TLS, logs, processo de mudança, padrões de tecnologia | A1–A7, B1–B20 | D-001 a D-004, D-022 |
| 45–60 | Segurança e identidade | SSO vs autenticação local, MFA, política de senha/sessão, login do operador, varreduras/pentest, SBOM e licenças, retenção/LGPD | C1–C13, B18 | D-005, D-021, D-023, D-033 |
| 60–72 | Estações, rede e Print Agent | SO, direitos, proxy/firewall, instalação e atualização do agente, assinatura do executável, credenciais do agente, relógio, reinício/desligamento dos PCs | D1–D15, C12 | D-006, D-020, D-027 a D-030 |
| 72–80 | Volume, continuidade e falhas | Significado de 1.300–1.500, pico por minuto, comportamento sem rede/AWS, PRINT_JOB parcial, backup/restauração, rollback | H1–H10, B19, B20 | D-008, D-012, D-014, D-031, D-032, D-034 |
| 80–88 | Etiqueta, QR, reimpressão e dados mestres | Campos visíveis, payload do QR, quem autoriza reimpressão e motivos, amostra de dados, turnos, fuso | G1–G12, F1–F9 | D-009 a D-011, D-036, D-013, D-017, D-019, D-024, D-025 |
| 88–90 | Fechamento | Recapitular pendências, donos e datas | I | — |

## 5. Versão reduzida (60 minutos)

Cobrir na reunião: abertura, impressora, GitHub/AWS, segurança e identidade (incluindo SSO), instalação do agente e rede, volume e comportamento sem rede. Resolver por e-mail: dados mestres, turnos, etiqueta/QR, relatórios, backup/restore, SBOM, rollback.

Se houver tempo para apenas três assuntos: **impressora (D-007), hospedagem na AWS (D-002 a D-004) e autenticação/SSO (D-005)**, porque são os que mais alteram a arquitetura.

## 6. Critérios de saída da Fase 1

- Nenhum BLOCKER de arquitetura ou segurança sem dono e data.
- Repositório definido (Doowon ou fallback temporário aprovado).
- Topologia de acesso e serviços AWS conhecidos, ou prazo para conhecê-los.
- Autenticação (local ou SSO) definida.
- Possibilidade e método de instalar o Print Agent nas estações definidos.
- Modelo da impressora definido ou data de definição firmada.
- Significado do volume 1.300–1.500 esclarecido.

## 7. Saídas após a reunião

| Entregável | Prazo proposto | Dono |
|---|---|---|
| Ata com respostas classificadas | até 1 dia útil | Clavia |
| Atualização do `decision-log.md` | até 1 dia útil | Clavia |
| ADRs das decisões que afetam arquitetura | até 3 dias úteis | Clavia |
| Atualização do registro de pendências e riscos técnicos | até 3 dias úteis | Clavia |
| Pendências abertas enviadas à Doowon com dono/data | até 1 dia útil | Clavia |
| Revisão do plano de implementação | até 3 dias úteis | Clavia |

**ADRs previstas:** repositório e propriedade do código; topologia AWS; autenticação do usuário; arquitetura de impressão e Print Agent; autenticação do agente; distribuição, assinatura e atualização do agente; adaptador da impressora; semântica de reimpressão; política sem rede (offline); PRINT_JOB parcial; fuso, turnos e relógio; payload do QR; stack; rollback; SBOM; restore test.

## 8. Fora da pauta

- Mudanças de escopo (ERP, MES, SSO se não confirmado, PLCs, coletores/scanners, novas máquinas): tratadas fora da reunião pelo procedimento de mudança.
- Qualquer implementação específica de impressora antes de D-007.
