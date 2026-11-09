# Doowon Print Agent

Programa local que roda no PC de cada posto, recebe do servidor as etiquetas a imprimir e as envia à
impressora do posto. Faz apenas **conexões de saída (HTTPS)**: nenhuma porta de entrada é aberta.

> **Versão de desenvolvimento.** Usa uma impressora **simulada**. O adaptador da impressora real será
> incluído quando o modelo for definido (D-007). Formato de instalação, assinatura digital e política do PC
> também dependem de definição da Doowon (perguntas 8 e 9 do documento de pendências).

## Requisitos

- Node.js 22 ou superior no PC do posto (provisório; pode ser substituído por executável único após a definição do sistema operacional).
- Conexão HTTPS de saída até o servidor da solução.
- Um agente por posto, com token próprio (fornecido pela equipe do projeto).

## Conteúdo

| Arquivo                                        | Para quê                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `doowon-print-agent.mjs`                       | O agente (arquivo único, sem dependências)                    |
| `agent.config.example.json`                    | Modelo de configuração                                        |
| `windows/install.ps1`, `windows/uninstall.ps1` | Instalação como tarefa agendada no Windows                    |
| `linux/doowon-print-agent.service`             | Modelo de serviço systemd                                     |
| `SHA256SUMS`                                   | Somas de verificação para conferir a integridade dos arquivos |

## Configuração

Copie `agent.config.example.json` para `agent.config.json` e preencha:

| Campo                               | Descrição                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `agentId`, `stationId`, `printerId` | Identificação do agente, do posto e da impressora                                     |
| `apiUrl`                            | Endereço HTTPS do servidor (HTTP só é aceito para `localhost`)                        |
| `agentTokenFile`                    | Arquivo com o token do agente (recomendado). Também aceita a variável `AGENT_TOKEN`   |
| `journalPath`                       | Journal durável de impressão. **Não apague** com impressão em andamento               |
| `logPath`                           | Arquivo de log (opcional); o log também sai na saída padrão                           |
| `pollMs`, `requestTimeoutMs`        | Intervalo entre ciclos (200 a 60000 ms) e prazo de cada requisição (1000 a 120000 ms) |

Variáveis de ambiente (`AGENT_ID`, `STATION_ID`, `PRINTER_ID`, `API_URL`, `AGENT_TOKEN`, `JOURNAL_PATH`,
`LOG_PATH`, `POLL_MS`, `REQUEST_TIMEOUT_MS`) têm prioridade sobre o arquivo.

## Uso

```
node doowon-print-agent.mjs --config agent.config.json --check   # valida a configuração e sai
node doowon-print-agent.mjs --config agent.config.json           # executa
```

Códigos de saída: `0` normal, `2` configuração inválida, `3` já existe outro agente usando o mesmo journal.

## Impressora Elgin L42 Pro Full (ZPL por Ethernet) — a validar fisicamente

Modelo informado pelo projeto: Elgin L42 Pro Full (USB, Ethernet, serial; aceita EPL, ZPL, PPLA e PPLB). O agente usa **ZPL pela rede, porta 9100** (`printerAdapter: "zpl-tcp"`). Veja `agent.config.zpl.example.json`.

Teste de bancada (sem servidor; imprime uma etiqueta de exemplo e mostra a resposta bruta da impressora):

```
node doowon-print-agent.mjs --config agent.config.json --printer-test
```

Antes: configure um IP fixo na impressora (menu da impressora ou utilitário do fabricante), confirme que o PC alcança `IP:9100` e que a etiqueta de 30 x 20 mm está calibrada (sensor de intervalo ou marca). Envie-nos a saída completa do teste: ela mostra se a impressora responde ao comando de status (`~HS`), o ZPL gerado e o resultado.

Como a confirmação funciona: o ZPL não devolve "etiqueta impressa". O agente confirma quando o buffer da impressora esvazia, sem erro, em duas leituras seguidas de status. Antes de enviar, se a impressora estiver sem papel, sem ribbon, com o cabeçote aberto, em pausa ou ocupada, nada é enviado. Depois de enviar, qualquer dúvida (queda, erro, prazo) vira "resultado desconhecido", sem reenvio automático. Se a impressora não responder ao status, o agente **recusa imprimir** (`printerConfirmWithoutStatus: true` permite confirmar só pelo envio, com evidência mais fraca; use só se necessário). O layout e o tamanho do QR são provisórios e devem ser conferidos com o leitor real.

## Comportamento importante

- **Instância única:** um segundo agente sobre o mesmo journal é recusado, para nunca imprimir a mesma etiqueta duas vezes.
- **Queda de rede ou do servidor:** o agente espera e tenta de novo, com intervalo crescente (até 30 s). Nada é impresso sem confirmação do servidor.
- **Reinício do PC ou queda de energia:** ao iniciar, o agente lê o journal e só reenvia o que comprovadamente não saiu. Se houver dúvida se a etiqueta foi impressa, o resultado é reportado como **desconhecido** e um administrador decide; o agente nunca reimprime por conta própria.
- **Encerramento:** `Ctrl+C` ou parada do serviço termina o ciclo em curso antes de sair. Mesmo um encerramento abrupto é seguro, pois o journal é gravado a cada passo.
- **Token:** nunca aparece nos logs.

## Instalação no Windows (provisório)

1. Instale o Node.js 22 (LTS).
2. Abra o PowerShell **como Administrador**, na pasta `windows` deste pacote, e execute `.\install.ps1`.
3. Edite `C:\DoowonPrintAgent\agent.config.json`, grave o token em `C:\DoowonPrintAgent\agent.token` e execute `.\install.ps1` de novo.
4. O agente passa a iniciar com o Windows e reinicia sozinho após falha. Logs em `C:\DoowonPrintAgent\logs`.

Para remover: `.\uninstall.ps1` (mantém journal, logs e configuração).

## Verificação de integridade

Na pasta do pacote: `sha256sum -c SHA256SUMS` (Linux) ou `Get-FileHash` (Windows) e compare com `SHA256SUMS`.
