# ADR-0001 — Stack inicial de desenvolvimento

- **Status:** Proposta, adotada como **ponto de partida** para o desenvolvimento local (2026-10-20). Sujeita a objeção da Doowon.
- **Contexto:** O início do desenvolvimento local foi autorizado antes de a Doowon informar eventuais padrões ou restrições de tecnologia (D-022). A stack abaixo é uma premissa de partida, não uma decisão da Doowon.

## Decisão (premissa de partida)

| Camada | Escolha |
|---|---|
| Linguagem | TypeScript de ponta a ponta |
| Frontend | React com Next.js |
| API | Node.js 22 com NestJS |
| Banco de dados | PostgreSQL, com migrações versionadas (ferramenta a registrar em ADR própria) |
| Print Agent | Serviço Node.js/TypeScript; empacotamento e instalação a definir após D-006 (SO e política dos PCs) |
| Repositório | Monorepo pnpm (`apps/` e `packages/`) |
| CI | GitHub Actions (formato, lint, tipos, testes, build) |
| Desenvolvimento local | Docker Compose apenas para um PostgreSQL descartável |
| Infraestrutura como código | Somente após as decisões de AWS (D-002 a D-004); nada definido |

## Consequências

- O desenvolvimento local não depende de AWS nem de impressora (usa simulador).
- Se a Doowon impuser padrão ou restrição diferente (linguagens, frameworks, contêineres, licenças), esta ADR será revista e o impacto em esforço e prazo registrado antes da mudança.
- Autenticação local por usuário e senha (baseline contratado) não é afetada por esta ADR.

## Itens que esta ADR não decide

Modelo de impressora e SDK, empacotamento e assinatura do Print Agent, topologia e serviços AWS, retenção de logs e auditoria.

## Atualização: persistência (2026-10-20)

A persistência PostgreSQL foi implementada em `packages/store-postgres`, atrás da mesma porta `PrintStore` usada em memória:

- Esquema por migrações SQL versionadas (`migrations/`), aplicadas na inicialização com trava de aviso (advisory lock).
- Escritas serializadas por transação com advisory lock, equivalente ao comportamento do store em memória; atualização otimista de tentativas por `version`; chave de idempotência única.
- Auditoria append-only imposta no banco (gatilhos contra UPDATE, DELETE e TRUNCATE).
- Cadastros em tabela de documentos (`master_data`), com inativação em vez de exclusão quando há histórico.

Premissas de partida, como as demais: banco, versão e forma de hospedagem dependem das definições da Doowon (D-002 a D-004), assim como retenção e backup (D-014/D-015).

## Atualização: infraestrutura como código e empacotamento (2026-10-20)

- IaC em AWS CDK (TypeScript) em `infrastructure/`, como esqueleto de homologação: **nada foi implantado**. Conta, região, acesso e serviços dependem de D-002 a D-004; os parâmetros correspondentes não têm padrão.
- Print Agent distribuído como arquivo único (`pnpm -F @doowon/print-agent package`), com scripts de instalação provisórios. O formato final (executável, instalador, assinatura) depende do sistema operacional e das políticas dos PCs.
- Imagens de contêiner (`apps/api/Dockerfile`, `apps/web/Dockerfile`) sob as mesmas premissas.
