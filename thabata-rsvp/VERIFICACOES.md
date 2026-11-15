# Verificações da preparação — 15/11/2026

## Investigação do erro informado

Antes das alterações, `node --test backend/test.js` passou: a API original aceitou e releu um grupo com dois acompanhantes. Os testes adicionais do formulário original passaram em 9 de 10 casos; o caso que falhou foi a tentativa de dois eventos de envio enquanto a primeira requisição ainda estava em andamento. Esse resultado demonstra a ausência de bloqueio reentrante no JavaScript, mas **não comprova a causa do erro original relatado ao adicionar acompanhantes**.

Nos arquivos recebidos, o seletor do botão já usava `[type=submit]`, a API já aceitava acompanhantes e a gravação do grupo já ocorria em um único registro SQLite. Não foi reproduzida falha específica de cadastro com vários acompanhantes nesse estado do projeto. A correção reforça o envio único, a validação, as mensagens e a recuperação em falhas, preservando os dados preenchidos.

## Verificações executadas

- Testes automatizados de API e SQLite em bancos temporários isolados.
- Testes de formulário e painel em jsdom, com cenários de acompanhantes, alternância Sim/Não, remoção intermediária, falhas, totais e CSV.
- Testes PostgreSQL em servidor local descartável, com schema de teste aleatório, dados fictícios, persistência e migração idempotente/transacional.
- Inspeção do banco original somente com contagens agregadas: 2 grupos e 0 acompanhantes. O banco original foi preservado e nenhuma migração real foi realizada.
- `git check-ignore` confirmou proteção para `.env`, SQLite e dependências.
- Verificação local dos campos críticos de `render.yaml` e ausência de disco/banco Render. Não equivale à validação do Blueprint pela API Render.

Execução da preparação inicial: **40 testes passaram, 0 falharam, 0 foram omitidos**, com `npm.cmd test` e `RSVP_TEST_DATABASE_URL` apontando para o PostgreSQL 18 local descartável. Inclui o HTML/JavaScript entregue enviando três acompanhantes pela API HTTP e a leitura integral no SQLite e no PostgreSQL. Inclui falha controlada de inicialização por porta ocupada, cookie Secure e simulação de origem/IP atrás do proxy.

Na investigação posterior da inicialização local, a porta 3000 estava ocupada por outro Node servindo o convite, sem a rota `/healthz`. Foi alterada apenas `PORT` do `.env` para `3001`; as demais variáveis foram preservadas. A aplicação iniciou nessa porta e `/healthz` retornou 200 com `ok: true`; o servidor de verificação foi encerrado em seguida. Foram acrescentados diagnósticos seguros de inicialização em `backend/startup-errors.js` e quatro testes. A suíte padrão executada depois passou com **35 testes, 0 falhas e 2 testes PostgreSQL omitidos**; o PostgreSQL temporário da preparação já estava encerrado e não foi reiniciado nesta correção.

`npm test` sem `RSVP_TEST_DATABASE_URL` omite os testes PostgreSQL deliberadamente; os resultados com PostgreSQL exigem a execução explícita com o ambiente descartável configurado. `npm.cmd ci --offline` instalou as 42 dependências a partir do lockfile e do cache; a auditoria exibiu 0 vulnerabilidades. `git diff --check` passou.

## Limites e pendências

- O acesso de navegador estava indisponível; a alternativa de controle do Chrome foi interrompida pela ferramenta porque não conseguiu confirmar a URL da janela com segurança. Não foi possível verificar o convite em largura de celular nem o envio em Chrome real. Os testes jsdom não substituem essa verificação.
- Nenhuma conexão com Neon remoto foi usada e nenhum deploy Render foi realizado. TLS, conexão Neon, origem pública e IP real no proxy Render precisam de teste após a configuração.
- O erro original específico de envio com acompanhantes continua sem reprodução nos arquivos recebidos. Se reaparecer, registrar somente status HTTP, identificador técnico e código do erro, sem nomes, telefones, senha ou conexão nos logs.
- Antes de importar os grupos locais, revisar a origem e o projeto/branch/banco Neon de destino com a responsável. A ferramenta abre o SQLite somente para leitura, simula por padrão e exige `--apply --reviewed` para gravar.

## Próximo passo de hospedagem

Revisar o código e os detalhes do evento, criar um projeto **Free** no Neon e, quando decidir publicar, fazer commit/push para GitHub. Criar o Blueprint Render com `render.yaml` da raiz e preencher `DATABASE_URL` e `ADMIN_PASSWORD` diretamente no Render. Validar `/healthz`, o convite no celular e o painel `/admin` usando dados fictícios antes de compartilhar a URL. O procedimento detalhado está no [README](README.md).

## Arquivos alterados ou criados

- Raiz: `.gitignore`, `.node-version`, `render.yaml`.
- Aplicativo: `.env.example`, `.gitignore`, `.node-version`, `package.json`, `package-lock.json`, `README.md`, `VERIFICACOES.md`.
- Back-end: `backend/server.js`, `backend/database.js`, `backend/migrate.js`.
- Formulário: `public/app.js`. HTML, CSS, fontes, informações do evento, preços e código do painel foram preservados.
- Testes: `backend/test.js`, `backend/database.test.js`, `backend/postgres.test.js`, `tests/form.test.js`, `tests/admin.test.js`.
