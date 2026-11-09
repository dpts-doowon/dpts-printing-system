# Infraestrutura (AWS) — esqueleto de HOMOLOGAÇÃO

> **Status: esqueleto. Nada foi implantado.** Conta, região, forma de acesso e serviços aprovados dependem de
> D-002 a D-004 (Doowon). Por isso nenhum desses valores tem padrão: sem eles, a síntese falha com a lista do que falta.
> Não há ambiente de produção aqui: a composição de produção (cadastro seguro do agente, D-027, criação do primeiro
> administrador, retenção e backup, D-014/D-015) é uma fatia futura.

IaC em **AWS CDK (TypeScript)**, no mesmo monorepo. Se a Doowon padronizar outra ferramenta (ex.: Terraform), este
desenho serve de referência para a tradução.

## O que é criado

| Camada          | Recurso                                                                                                                  | Observação                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Rede            | VPC em 2 zonas: sub-redes públicas, de aplicação (saída por NAT) e de dados (isoladas)                                   | Flow Logs de tráfego recusado                                                                                                       |
| Entrada         | ALB (interno por padrão), HTTPS com certificado ACM, HTTP redireciona para HTTPS                                         | Acesso **somente** das faixas em `allowedCidrs`; roteamento por nome (`apiHost`, `webHost`); logs de acesso em bucket criptografado |
| Aplicação       | ECS Fargate: serviço `api` (porta 3001) e `web` (porta 3000), sub-redes privadas, sem IP público                         | Reversão automática em falha de implantação; sem acesso interativo ao contêiner                                                     |
| Banco           | RDS PostgreSQL 16, criptografado (KMS), sub-rede isolada, TLS obrigatório, proteção contra exclusão, snapshot ao remover | Só aceita conexão dos serviços                                                                                                      |
| Segredos        | Secrets Manager (criptografado): credenciais do banco, senhas e tokens iniciais                                          | Entram nos contêineres como segredos, nunca como variável em claro                                                                  |
| Imagens         | ECR por serviço: tags imutáveis, varredura ao enviar, mantém as 20 mais recentes                                         |                                                                                                                                     |
| Observabilidade | CloudWatch Logs com retenção, alarmes (5xx, instância não saudável, CPU e espaço do banco) para um tópico SNS            | `alarmEmail` opcional                                                                                                               |

## Parâmetros

Passados como contexto do CDK (`-c chave=valor`).

| Parâmetro                                              | Obrigatório | Padrão                   | Depende de                                                               |
| ------------------------------------------------------ | ----------- | ------------------------ | ------------------------------------------------------------------------ |
| `account`, `region`                                    | sim         | —                        | D-002, D-003                                                             |
| `allowedCidrs`                                         | sim         | —                        | D-004 (redes ou VPN que acessam; `0.0.0.0/0` só com `exposure=internet`) |
| `certificateArn`, `apiHost`, `webHost`                 | sim         | —                        | Domínio e DNS (D-003/D-004)                                              |
| `exposure`                                             | não         | `internal`               | D-004 (`internal` ou `internet`)                                         |
| `imageTag`                                             | não         | `homolog`                | Tag fixa; `latest` é recusada                                            |
| `dbInstanceClass`, `dbAllocatedStorageGb`, `dbMultiAz` | não         | `t4g.small`, 20, `false` | Provisório: dimensionar com o volume (pergunta 15)                       |
| `dbBackupDays`                                         | não         | 7                        | Provisório (D-014/D-015)                                                 |
| `logRetentionDays`                                     | não         | 30                       | Provisório (D-014)                                                       |
| `natGateways`                                          | não         | 1                        | Disponibilidade x custo                                                  |
| `apiDesiredCount`, `webDesiredCount`                   | não         | 1                        |                                                                          |
| `alarmEmail`                                           | não         | —                        |                                                                          |

## Validar sem credenciais (nada é criado na AWS)

```
pnpm -F @doowon/infra build
pnpm -F @doowon/infra test            # asserções sobre o template
pnpm -F @doowon/infra synth:offline -c account=123456789012 -c region=sa-east-1 \
  -c allowedCidrs=10.20.0.0/16 -c certificateArn=arn:aws:acm:sa-east-1:123456789012:certificate/ID \
  -c apiHost=api.exemplo.local -c webHost=app.exemplo.local
```

O `synth:offline` informa as zonas de disponibilidade como contexto, no lugar da consulta que o CDK faria à conta.
Os testes verificam, entre outros pontos: banco privado, criptografado e só acessível pelos serviços; nenhuma entrada
aberta para `0.0.0.0/0`; HTTP redirecionando para HTTPS; nenhum segredo em variável de ambiente em claro; serviços sem IP
público; retenção de logs e alarmes.

## Implantação (quando as decisões estiverem fechadas — passos manuais, nenhum automático)

1. Com credenciais da conta aprovada: `cdk bootstrap` (uma vez) e `cdk deploy` com os `-c` acima. Revise o diff (`cdk diff`) antes.
2. As imagens ainda não existem no ECR: construa e envie `api` e `web` (veja os `Dockerfile` em `apps/api` e `apps/web`).
   A imagem `web` grava o endereço da API na compilação: `--build-arg NEXT_PUBLIC_API_URL=https://<apiHost>`.
3. Aponte `apiHost` e `webHost` para o ALB (saída `AlbDnsName`).
4. Recupere as senhas iniciais (saídas `*SecretArn`) e **troque-as** no primeiro acesso.
5. Os PCs dos postos precisam alcançar `apiHost` por HTTPS: com `exposure=internal`, isso exige VPN ou conexão dedicada (D-004).

## Fora do escopo deste esqueleto (a decidir)

WAF e proteção contra abuso (se a exposição for pela internet); SSO/Active Directory (pergunta 5); envio de logs a um SIEM
(pergunta 7); replicação entre regiões e AWS Backup; pipeline de implantação contínua e aprovação de mudanças (D-003);
dimensionamento definitivo e política de escala.
