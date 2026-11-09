# D-PTS | Doowon Part Tracking System

Plataforma de impressão de etiquetas (30 x 20 mm) com rastreabilidade por LABEL, para 2 postos, cada um com uma impressora dedicada.

**Estado:** desenvolvimento local em andamento (ver "Estado da implementação").

Leia primeiro: [`ENGINEERING.md`](ENGINEERING.md) e [`docs/`](docs/). A stack inicial é uma premissa de partida registrada em [`docs/adr/0001-stack-inicial.md`](docs/adr/0001-stack-inicial.md).

## Estrutura

```text
apps/api            API (NestJS)
apps/web            Interface web (Next.js)
apps/print-agent    Print Agent (um por posto)
packages/shared     Código compartilhado
packages/printer-contracts  Contratos servidor <-> Print Agent
infrastructure/     IaC (somente após decisões de AWS)
docs/               Requisitos, decisões, arquitetura, qualidade, ADRs
tests/              Testes de integração e ponta a ponta
```

## Rodar localmente

Requisitos: Node 22 e pnpm 10 (`corepack enable` ativa o pnpm). Docker é opcional (somente para o PostgreSQL local).

```bash
pnpm install
pnpm build
pnpm dev          # API (3001) + Print Agent do posto 1 (simulador) + Web (3000)
```

Abra http://localhost:3000. Usuários de partida (somente desenvolvimento, não são dados da Doowon):

| Perfil        | Usuário     | Senha               |
| ------------- | ----------- | ------------------- |
| Operador      | `operador1` | `operator-pass-123` |
| Administrador | `admin`     | `admin-pass-123`    |

Em outro terminal, `pnpm smoke` valida o fluxo completo (login, agente pronto, impressão de 1 etiqueta confirmada e consulta ao histórico). `Ctrl+C` encerra tudo.

Por padrão os dados ficam em memória. Para persistir em PostgreSQL:

```bash
pnpm dev --docker-db                                              # sobe o PostgreSQL via docker compose
DATABASE_URL=postgres://app:app@localhost:5432/traceability pnpm dev   # ou use um banco existente
```

Os arquivos locais (journal do agente) ficam em `.local/` (ignorado pelo Git).

### Impressora virtual (sem a impressora física)

`pnpm dev --virtual-printer` sobe uma impressora ZPL virtual (porta 9100) e faz o Print Agent imprimir nela em ZPL, exatamente como faria com a Elgin L42 Pro Full por Ethernet. As etiquetas aparecem em http://localhost:9101 (pré-visualização aproximada, com o tamanho real do QR e avisos se algum texto invadir o QR ou sair da etiqueta); os arquivos `.zpl` e `.svg` ficam em `.local/virtual-printer/`. Na própria página é possível simular falhas: sem papel, sem ribbon, cabeçote aberto, pausa, impressora muda, queda de conexão depois do envio e impressão lenta. Também funciona sozinha: `pnpm printer:virtual`. Não substitui o teste com a impressora real.

### Impressora USB instalada no computador (teste de bancada)

Para testar a comunicação física com uma impressora Zebra/ZPL ligada por USB (ex.: ZD220, etiqueta 50 x 35 mm):

```bash
lpstat -p                  # macOS/Linux: mostra o nome da fila; no Windows: Painel de Controle > Impressoras
pnpm dev --printer-queue "NOME_DA_FILA" --label 50x35          # acrescente --direct-thermal se a etiqueta não usa ribbon
```

Esse modo (`printerAdapter: "zpl-spool"`) envia o ZPL pela fila do sistema (`lp -o raw` no macOS/Linux; API RAW do spooler no Windows) e **não lê o status** da impressora: a confirmação é só a entrega ao spooler. Serve para teste, não para produção; a Elgin L42 Pro Full segue por rede (`zpl-tcp`). Em mídia maior que 30 x 20 mm, o desenho é centralizado. Teste isolado: `PRINTER_ADAPTER=zpl-spool PRINTER_NAME="..." LABEL_WIDTH_MM=50 LABEL_HEIGHT_MM=35 AGENT_ID=a STATION_ID=st-1 PRINTER_ID=pr-1 API_URL=http://localhost:3001 AGENT_TOKEN=t node apps/print-agent/dist/main.js --printer-test`.

#### Mídia com 4 etiquetas por linha (22 x 35 mm)

Para o rolo de 4 colunas (etiqueta em pé, 22 mm de largura x 35 mm de altura, 3 mm entre colunas, 3 mm entre linhas, 3 mm de margem esquerda):

```bash
pnpm dev --printer-queue "NOME_DA_FILA" --label 22x35 --columns 4 --column-gap 3 --row-gap 3 --margin-left 1.5 --margin-top 3 --apply-landscape --direct-thermal
```

O agente reserva até 4 etiquetas da fila e as envia em **um único formato ZPL** (uma linha). Imprimir 10 etiquetas usa 3 linhas (4 + 4 + 2). O resultado é compartilhado pela linha: se algo falhar ou ficar incerto, todas as etiquetas da linha ficam como "resultado desconhecido" e o operador confere cada uma pessoalmente. `--apply-landscape`: a etiqueta é impressa em pé (22 x 35 mm), mas colada deitada (35 x 22 mm); o desenho sai girado 90° para ser lido com a etiqueta virada 90° para a esquerda (o QR não gira); `--qr-left` (padrão 4 mm) leva o QR para a esquerda e `--qr-up` (padrão 0) o sobe, ambos no sentido de leitura da etiqueta colada. Ajuste fino do alinhamento (décimos de mm): `--margin-left` desloca a linha para a esquerda/direita e `--margin-top` desce o desenho dentro de cada etiqueta (o conteúdo ocupa cerca de 29,5 mm dos 35 mm). Na primeira impressão real, o desenho saiu cerca de 1,5 mm à direita e cortado no topo; por isso os valores acima. Teste de linha: acrescente `--printer-test` no agente. Para impressão fraca, ajuste a densidade com `PRINTER_DARKNESS`. Medidas conforme relato (2026-10-29); o desenho final da etiqueta ainda será enviado pela Doowon.

### Verificação e testes

```bash
pnpm format:check && pnpm lint && pnpm build && pnpm typecheck && pnpm test
```

Testes contra o PostgreSQL real (dois bancos descartáveis, recriados a cada execução):

```bash
TEST_DATABASE_URL=postgres://app:app@localhost:5432/traceability_test \
TEST_DATABASE_URL_API=postgres://app:app@localhost:5432/traceability_test_api pnpm test
```

### Outros

- Pacote do Print Agent: `pnpm -F @doowon/print-agent package` (saída em `apps/print-agent/release/`).
- Infraestrutura: `pnpm -F @doowon/infra synth:offline` valida o CDK sem credenciais AWS. Nada é implantado.
- Windows: use PowerShell ou Git Bash; `pnpm dev` não depende de shell Unix. macOS e Linux funcionam igualmente.
- Os Dockerfiles de `api`/`web` e a opção `--docker-db` ainda não foram exercitados em um daemon Docker real.

## Branches

`main` (liberado), `develop` (integração), `feature/*`. Sem push direto em `main`; mudanças por Pull Request com CI verde.

## Propriedade e transferência

Este repositório é privado. O histórico Git completo é preservado para ser transferido ao repositório da Doowon quando disponível.

## Estado da implementação (desenvolvimento local)

Implementado e testado (sem AWS e sem impressora real):

- **Domínio** (`packages/domain`): `PRINT_JOB → LABEL → PRINT_ATTEMPT`, máquina de estados, estado derivado do PRINT_JOB, idempotência com assinatura do pedido, bloqueio "Impressora em uso", RETRY e REPRINT, resolução de `UNKNOWN_OUTCOME` somente pelo ADMIN, retenção do restante do PRINT_JOB, reaper, auditoria, hashes canônicos e snapshot por valor.
- **Print Agent** (`apps/print-agent`): reivindicação com lease, `ack` antes do primeiro byte, journal durável com recuperação após reinício, simulador de impressora (sucesso, falha, incerteza, erro).
- **API** (`apps/api`): login local por usuário e senha, perfis OPERATOR e ADMIN aplicados no servidor, endpoints de operador, administrador e agente, dados mestres com inativação, histórico (com filtro de reimpressões), rastreabilidade por etiqueta e auditoria.
- **Sessão:** logout forçado às 15h30 e às 00h30 (fuso provisório de São Paulo, D-013; variável `FORCED_LOGOUT_TIMES` para alterar), além da expiração por inatividade. O mesmo usuário pode entrar em qualquer posto, mas imprime só na impressora do posto onde entrou.
- **Interface** (`apps/web`): identidade visual Doowon (logotipo, azul/vermelho e fonte Inter). Operador em etapas: seleção de máquina e peça, impressão (4, 8 ou 32 etiquetas), conferência da etiqueta com pré-visualização 30 x 20 mm e QR, reimpressão com motivo, **"Continuar de onde parou" e "Reimprimir tudo"** quando a impressão para (falha, papel acabou ou resultado desconhecido; o operador confere a etiqueta física) e "Continuar produção?"; inclui "Dados incorretos? Solicitar ajuste". Administrador com menu lateral: dashboard (indicadores, produção por hora, últimas impressões, solicitações de ajuste, postos e decisões), cadastros com edição e inativação, histórico com filtros e paginação e exportação para Excel (.xlsx, colunas provisórias, D-017), auditoria. Tudo em português.

Provisório, aguardando decisões (não são dados da Doowon): turnos, peças e usuários de partida; fuso horário; conteúdo do QR e layout da etiqueta; vínculo posto-máquina fixo 1:1; política de sessão.

Etiqueta (30 x 20 mm, deitada em célula 22 x 35): impressos o ALC Code em destaque, o Part Number, a data (AAMMDD) e a hora; operador e turno não são impressos. O QR segue o padrão H/KMC da Hyundai (`[)>` RS `06` GS … GS RS EOT; Supplier Code, Part Number sem hífen, ALC, EO Number opcional, data, código 4M do operador, flag do turno e Trace Number sequencial). Supplier Code e Área do Fornecedor ficam em Configurações do admin; EO Number na peça; código de 4 caracteres no operador e de 1 caractere no turno. PROVISÓRIO até a Doowon confirmar flag, hora e Trace Number (E-024, D-009/D-036).

Persistência PostgreSQL (`packages/store-postgres`): impressões, etiquetas, tentativas, auditoria (append-only, bloqueada por gatilhos), agentes e cadastros, com migrações versionadas. A mesma suíte de testes do domínio roda contra o banco real. Sem `DATABASE_URL`, a API continua em memória.

Print Agent empacotável (`pnpm -F @doowon/print-agent package`): arquivo único, configuração validada (arquivo e variáveis), token fora dos logs, trava de instância única, espera crescente sem servidor, prazo por requisição, encerramento ordenado, scripts de instalação provisórios (Windows e Linux) e SHA256SUMS. Detalhes em `apps/print-agent/packaging/README.md`.

Esqueleto de infraestrutura AWS (`infrastructure/`, CDK): rede, ALB, ECS Fargate, RDS PostgreSQL, segredos, imagens e alarmes, validado por testes e síntese offline. **Nada foi implantado** e há Dockerfiles de `api` e `web`; depende de D-002 a D-004. Detalhes em `infrastructure/README.md`.

Ainda não implementado: código específico da impressora, inscrição do agente em duas etapas (PKI), implantação na AWS (apenas o esqueleto existe).

## Publicação em subcaminho (doowonbrasil.net/etiquetas)

A Doowon pediu o sistema em `https://doowonbrasil.net/etiquetas`. A interface suporta subcaminho: na construção, defina `NEXT_PUBLIC_BASE_PATH=/etiquetas` e `NEXT_PUBLIC_API_URL=/etiquetas/api`; ao iniciar, defina `API_INTERNAL_URL` com o endereço da API. A própria interface encaminha `/etiquetas/api/*` para a API, então o domínio da Doowon só precisa encaminhar `/etiquetas` para o servidor da interface. Os Print Agents usam `https://doowonbrasil.net/etiquetas/api` como `apiUrl`. Validado localmente (página, logotipo, fontes, API e login sob `/etiquetas`); não há implantação.

## Execução manual (sem `pnpm dev`)

```bash
SEED_ADMIN_PASSWORD=... SEED_OPERATOR_PASSWORD=... AGENT_TOKEN_ST1=... node apps/api/dist/main.js
AGENT_ID=agent-st-1 STATION_ID=st-1 PRINTER_ID=pr-1 AGENT_TOKEN=... node apps/print-agent/dist/main.js
pnpm -F @doowon/web start   # http://localhost:3000
```

Sem `SEED_*`, a API gera senhas e tokens aleatórios e os mostra no console (somente desenvolvimento). O servidor se recusa a iniciar com `NODE_ENV=production` enquanto usar dados em memória.
