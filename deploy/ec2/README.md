# Implantação barata em um servidor (AWS EC2)

> **Status: pacote preparado, ainda não implantado.** Serve para homologação. Produção exige a composição segura
> (primeiro administrador, token por posto, retenção; D-014/D-015/D-027) e um banco gerenciado ou com backup testado.

Um único servidor roda quatro contêineres: **db** (PostgreSQL 16, sem porta aberta), **api**, **web** e **proxy**
(Caddy, que encaminha `/api` para a API e o resto para o site e faz HTTPS automático se houver domínio).

## Custo (ordem de grandeza, Ohio, sob demanda; confira a calculadora da AWS)

| Item                                 | Aproximado                            |
| ------------------------------------ | ------------------------------------- |
| EC2 `t4g.small` (2 vCPU, 2 GB), 24x7 | ~US$ 12 a 14 por mês                  |
| Disco EBS gp3 de 20 GB               | ~US$ 1,6 por mês                      |
| IP fixo (Elastic IP) em uso          | ~US$ 3,6 por mês (cobrado desde 2024) |
| Backups no S3 (poucos MB)            | centavos                              |
| **Total**                            | **~US$ 17 a 20 por mês**              |

Sem NAT Gateway, sem balanceador, sem RDS. Dentro dos créditos iniciais da AWS, o custo real nos primeiros meses é zero.

## 1. Criar o servidor (console da AWS, região us-east-2)

1. **EC2 → Launch instance.** Nome `dpts-homolog`. AMI **Ubuntu Server 24.04 LTS (arm64)**. Tipo **t4g.small**.
2. **Par de chaves:** crie um novo (`.pem`) e guarde. Alternativa sem chave: acesso pelo Session Manager (função IAM `AmazonSSMManagedInstanceCore`).
3. **Rede / grupo de segurança** (o mais importante para a segurança):
   - **SSH (22):** só do seu IP (`My IP`). Nunca `0.0.0.0/0`.
   - **HTTP (80)** e **HTTPS (443):** só dos IPs da fábrica e do seu (a Doowon informa o IP de saída da rede deles). Sem restrição só com a aprovação da Doowon.
4. **Armazenamento:** 20 GB gp3, **criptografado**.
5. Depois de criar: **Elastic IP → Allocate → Associate** na instância (IP fixo para o domínio e os agentes).
6. **Orçamento:** Billing → Budgets → alerta mensal de US$ 10 (e-mail para a Doowon e para você).

## 2. Preparar o servidor (uma vez)

```bash
ssh -i dpts.pem ubuntu@IP_FIXO
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git awscli
sudo usermod -aG docker ubuntu && exit        # saia e entre de novo
```

## 3. Subir o sistema

```bash
ssh -i dpts.pem ubuntu@IP_FIXO
git clone https://github.com/BrunoBarbarini/doowon-traceability.git dpts   # repositório privado: use um token de leitura (deploy key)
cd dpts && git checkout v0.11.0
cd deploy/ec2
cp .env.example .env && chmod 600 .env && nano .env     # preencha (gere os segredos com openssl rand -hex 24)
docker compose up -d --build
docker compose ps
```

Teste: abra `http://IP_FIXO` (ou o domínio) e entre como `admin` com `SEED_ADMIN_PASSWORD`.
Com domínio: aponte o DNS (registro A) para o IP fixo, ponha `SITE_ADDRESS=etiquetas.seudominio.com` e
`PUBLIC_URL=https://etiquetas.seudominio.com` no `.env` e rode `docker compose up -d`. A porta 80 precisa estar
aberta para o Let's Encrypt emitir o certificado.

## 4. Print Agent no Windows de cada posto

Use `API_URL=<PUBLIC_URL>/api` e o `AGENT_TOKEN_ST1` (posto 1) ou `AGENT_TOKEN_ST2` (posto 2) do `.env`.

## 5. Backup

O servidor precisa de permissão no bucket: crie um bucket S3 privado e uma função IAM da instância com `s3:PutObject`
só nesse bucket. Depois:

```bash
# instalar o AWS CLI (arm64) e agendar (Ubuntu 26.04, rodando como root via /etc/cron.d):
sudo apt-get install -y awscli cron   # ou o instalador oficial v2
printf 'AWS_DEFAULT_REGION=us-east-2\nPATH=/usr/local/bin:/usr/bin:/bin\n15 6 * * * root /opt/dpts/app/deploy/ec2/backup.sh </dev/null >>/var/log/dpts-backup.log 2>&1\n' | sudo tee /etc/cron.d/dpts-backup
# 06:15 UTC = 03:15 em Brasília. Confira no dia seguinte: tail /var/log/dpts-backup.log
```

Ao testar `backup.sh` à mão no terminal, use `</dev/null` (o `docker compose exec` pode travar esperando a entrada).

**Teste a restauração antes de confiar no backup:** `gunzip -c backups/ARQUIVO.sql.gz | docker compose exec -T db psql -U app -d traceability`
em uma instância de teste. Um backup nunca restaurado não é um backup.

## 6. Atualizar para uma nova versão

```bash
cd ~/dpts/deploy/ec2 && ./update.sh v0.12.0
```

Faz backup, troca a versão, reconstrói e reinicia. As migrações do banco rodam sozinhas quando a API sobe.

## Limites conhecidos

- O servidor é um ponto único de falha: se ele cair, para de imprimir até ser religado. Aceitável em homologação.
- A API atual é a composição de **desenvolvimento** (cria usuários e dados de partida a partir do `.env`); por isso não use dados reais ainda.
- Os grupos de segurança são a principal barreira; mantenha as portas restritas.
