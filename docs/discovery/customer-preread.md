# Pré-leitura — Technical Discovery Doowon x Clavia

> **Classificação:** SAFE_FOR_DOOWON
> **Versão:** 0.5 · **Data do documento:** 2026-10-07
> **Reunião:** [DATA] às [HORA] · **Audiência:** Doowon

Olá, pessoal.

Para iniciarmos o projeto de identificação e rastreabilidade com segurança e dentro do cronograma, reunimos abaixo as **20 perguntas essenciais** que precisamos alinhar. Estamos considerando que a implantação inicial tem **2 postos, cada um com uma impressora dedicada** (sem compartilhamento entre os postos); se algo for diferente, por favor nos avise. Respostas curtas já ajudam. Quando não houver resposta definida, basta indicar **quem decide e até quando**.

Pode responder por e-mail antes da reunião ou trazer as respostas para a conversa. Os detalhes complementares trataremos durante a reunião ou depois dela.

Este material tem como objetivo antecipar os principais pontos da reunião. Não é necessário responder todas as questões previamente; as respostas disponíveis nos ajudarão a tornar a Technical Discovery mais objetiva.

---

## Pessoas e prazos

1. Quem serão o responsável técnico (TI/infraestrutura/segurança) e o responsável de negócio (produção/qualidade) pela homologação, e quais as datas previstas para o kickoff e para a liberação das definições e acessos abaixo?

## Código-fonte e nuvem

2. A Doowon pode criar um repositório GitHub privado na sua organização e conceder acesso à Clavia? Quem cria, em que prazo, e existe padrão de branches, Pull Requests e segurança que devemos seguir?

3. Qual conta e região AWS hospedarão a solução, e qual o processo (e o prazo) para criação de acessos/permissões e aprovação de mudanças?

4. Como a aplicação deve ser acessada (apenas rede interna, VPN ou internet)? Quais serviços de computação e de banco de dados a Doowon aprova, e existe algum padrão ou restrição obrigatória de tecnologia (linguagens, frameworks, contêineres, licenças de software)?

## Segurança e acesso

5. A autenticação por usuário e senha na própria aplicação é aceitável, ou SSO/Active Directory/Entra ID é obrigatório? Há exigência de MFA para administradores e política de senha e de sessão?

6. Como o operador deve se identificar no posto (usuário e senha, PIN, crachá)? O PC do posto é usado por mais de um operador ao longo do dia, após quanto tempo de inatividade a sessão deve bloquear, e o que acontece se o operador trocar durante uma impressão?

7. Quais requisitos de segurança, auditoria e privacidade (LGPD) a Doowon exige: varreduras ou testes de intrusão antes da entrada em produção, tempo de retenção de logs, de auditoria e do histórico de etiquetas, e envio de logs a um SIEM?

## Estações de trabalho e rede

8. Quais são o sistema operacional/versão e as políticas dos dois PCs (domínio, direitos de administrador, antivírus/EDR), e um fornecedor externo pode instalar e atualizar um software local de impressão neles (Print Agent 01 e Print Agent 02)? Se sim, como (ferramenta corporativa ou instalação manual) e há exigência de assinatura digital do software?

9. Os PCs podem fazer conexões HTTPS de saída para a AWS? Existe proxy ou firewall com regras que precisamos conhecer?

10. Nossa recomendação é que cada posto também fique vinculado a uma única máquina, eliminando a escolha manual pelo operador. Essa relação é fixa na operação da Doowon ou um mesmo posto pode atender diferentes máquinas?

## Impressora e etiqueta

11. Qual o fabricante e o modelo exato das impressoras (resolução em DPI, linguagem/SDK, tipo de conexão), as duas unidades serão do mesmo modelo, e qual a data prevista para essa definição?

12. Podemos contar com uma impressora e mídia reais de 30 x 20 mm para os primeiros testes, com as duas unidades finais e os dois postos disponíveis para a homologação, e há um leitor de QR Code para validar a leitura?

13. Quais informações devem ficar visíveis na etiqueta e o que deve estar codificado no QR Code? Algum sistema da Doowon vai ler esse QR e precisa saber a versão do formato?

14. Existe, no processo da Doowon, um "lote de produção" que deva constar na etiqueta ou no histórico? Se sim, de onde vem o valor, quem o informa e em que formato?

## Operação e continuidade

15. O que significa "1.300 a 1.500 etiquetas" (por turno, por dia ou por lote)? Qual o pico por minuto e quantos turnos e horas por dia as máquinas operam?

16. Se a rede ou a AWS ficarem indisponíveis, qual o comportamento operacional esperado: aguardar o retorno da conexão ou é necessário imprimir sem conexão?

17. Quem, na operação, deve decidir o que fazer quando uma etiqueta não puder ser confirmada como impressa (nossa sugestão: o administrador decide e o operador apenas solicita a ação), há um administrador disponível em cada turno, e quem pode autorizar reimpressões (e por quais motivos)?

18. Quais são os requisitos de backup e recuperação (perda máxima aceitável de dados e tempo máximo para restaurar) e quem será responsável por backups e testes de restauração?

## Dados e relatórios

19. Podem nos enviar uma amostra dos dados iniciais (máquinas, peças com descrição e Part Number, operadores e turnos), indicar quem é responsável pela correção desses dados e confirmar o fuso horário e as regras de turno (incluindo virada noturna)?

20. Além da pesquisa e do histórico de etiquetas, a Doowon precisa de relatórios gerados ou de exportação para a operação? Se sim, quais e em que formato?

---

Agradecemos o apoio. Com essas definições conseguimos fechar a arquitetura e evitar retrabalho nas etapas de integração, homologação e implantação.

*Equipe Clavia*
