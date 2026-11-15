# Aniversário da Thabata — confirmação de presença

Convite responsivo em HTML/CSS/JavaScript, API Node.js 24 e persistência PostgreSQL no Neon. SQLite continua disponível para desenvolvimento local quando `DATABASE_URL` está vazia. Não há build do front-end. O repositório contém o aplicativo na subpasta `thabata-rsvp/`; `render.yaml` fica na raiz.

## Executar localmente

1. Instale Node.js 24 e abra o terminal na pasta `thabata-rsvp`, onde está `package.json`.
2. Execute `npm ci`.
3. Copie `.env.example` para `.env`: no PowerShell, `Copy-Item .env.example .env`.
4. Edite `.env` no computador e defina `ADMIN_PASSWORD` com pelo menos 12 caracteres. Deixe `DATABASE_URL=` vazia para usar SQLite. Nunca cole senhas ou conexões em mensagens.
5. Execute `npm start`. No PowerShell com restrição a scripts, use `npm.cmd ci`, `npm.cmd start` e `npm.cmd test`.

Convite: <http://localhost:3000>. Painel: <http://localhost:3000/admin>. Mantenha o terminal aberto; Ctrl+C encerra o servidor. A fonte Fredoka é local e a licença está em `public/fonts/OFL.txt`.

Se a porta estiver ocupada, encerre a instância anterior no terminal com Ctrl+C ou altere somente `PORT=3001` no `.env`. Nesse caso, abra <http://localhost:3001> e <http://localhost:3001/admin>. A inicialização informa um código técnico e uma orientação específica, sem exibir senhas ou conexões.

O SQLite local fica em `data/rsvp.sqlite`, salvo se `DATA_DIR` for definido. O servidor em `NODE_ENV=production` recusa iniciar sem `DATABASE_URL`, para impedir gravações no disco temporário da hospedagem.

## Confirmação familiar e painel

O responsável informa nome, telefone com DDD e consentimento. Ele já conta como uma pessoa de 10 anos ou mais. É possível adicionar até 20 acompanhantes com nome e faixa etária: 0–4, 5–9 ou 10+. O grupo inteiro é salvo em uma única operação. Reenvios do mesmo telefone recebem conflito e não substituem a família existente. Para corrigir um grupo, a organização pode excluí-lo no painel após confirmação e solicitar novo cadastro.

O painel protegido em `/admin` mostra grupos, todos os acompanhantes, contagem por faixa etária e total de responsáveis mais acompanhantes. Inclui busca, atualização, exclusão do grupo completo com confirmação e CSV da lista completa. Reiniciar o servidor encerra sessões administrativas, preservando os convidados no banco. Os cookies são HttpOnly/SameSite; em produção também exigem HTTPS com Secure.

O layout rosa e amarelo, o botão “Eu vou”, as informações do evento e a tabela de preços permanecem no convite. Revise os detalhes do aniversário antes de tornar o repositório ou o site públicos.

## Criar o PostgreSQL gratuito no Neon

1. Acesse o [Neon Console](https://console.neon.tech/) e escolha o plano **Free**.
2. Crie um projeto PostgreSQL e selecione uma região próxima da escolhida no Render. Guarde a identificação do projeto, da branch e do banco para revisar o destino de eventual migração. O fluxo oficial está em [Manage projects](https://neon.com/docs/manage/projects).
3. Abra **Connect**, selecione banco/branch/role e habilite **Connection pooling**. Copie a conexão diretamente para `DATABASE_URL` no Render ou no `.env` local. Preserve os parâmetros TLS fornecidos pelo Neon. Não coloque a conexão em código, README, comandos compartilhados ou chat. Veja [Connection pooling](https://neon.com/docs/connect/connection-pooling).

As tabelas são criadas ou ampliadas automaticamente ao iniciar, sem apagar os registros existentes. Use um banco exclusivo para este projeto. Para testes, use outro banco/branch sem dados pessoais.

O Neon Free tem cotas de armazenamento, computação e transferência e suspende computação ociosa. Consulte os valores atuais no [plano Free do Neon](https://neon.com/docs/introduction/plans); não ative um plano pago para este procedimento.

## Publicar pelo GitHub e Render

Nenhum push ou publicação é feito automaticamente por este trabalho. Após revisar os arquivos:

1. Revise o conteúdo público e `git status`. Confirme que `.env`, `data/`, bancos, backups e `node_modules/` não aparecem entre os arquivos a enviar. O `.gitignore` não remove arquivos que já tenham sido versionados; revise também o histórico caso reutilize um repositório público. Prefira repositório privado para os detalhes do evento.
2. Faça o commit e o push para seu repositório GitHub quando decidir publicar. Preserve a estrutura com `render.yaml` na raiz e o aplicativo em `thabata-rsvp/`.
3. No Render, conecte o GitHub e escolha **New → Blueprint**, selecione o repositório e o `render.yaml`. Confira que será criado somente um **Web Service Free**, sem disco ou banco Render.
4. Preencha `DATABASE_URL` com a conexão Neon e `ADMIN_PASSWORD` com uma senha privada de pelo menos 12 caracteres **diretamente no Render**. As variáveis estão declaradas com `sync: false` para não conter segredos no YAML. Em serviços existentes, adicione/atualize esses valores em **Environment**; o prompt do Blueprint só ocorre na criação.
5. Confira a configuração abaixo e inicie o primeiro deploy. Compartilhe a URL HTTPS do serviço depois de validar o convite e `/admin`.

| Campo | Valor |
|---|---|
| Runtime / plano | Node / Free |
| Root Directory | `thabata-rsvp` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY_HOPS` | `1`, somente atrás do proxy Render |
| `DATABASE_URL` | Preencher no Render com a conexão Neon |
| `ADMIN_PASSWORD` | Preencher no Render; mínimo de 12 caracteres |

O processo escuta em `0.0.0.0` e usa `PORT` fornecida pela hospedagem. Não fixe a porta no Render. A origem pública usa `RENDER_EXTERNAL_URL` automaticamente; para domínio próprio, defina `APP_ORIGIN` como a origem HTTPS exata, sem caminho. A checagem de origem e a limitação por IP consideram somente a configuração explícita do proxy; não aumente o número de saltos arbitrariamente. O health check não expõe convidados, credenciais ou conexão.

O YAML usa `autoDeployTrigger: off`: futuras atualizações exigem **Manual Deploy → Deploy latest commit** após o push revisado. Os campos são descritos na [referência oficial de Blueprints](https://render.com/docs/blueprint-spec), e a escolha de Node está em [Node.js version](https://render.com/docs/node-version).

O Render Free suspende o serviço após 15 minutos sem tráfego; a próxima visita pode levar cerca de um minuto para abrir. O disco local é descartável. Há cotas mensais e limites de banda/build; acompanhe o uso e não habilite recursos pagos. Consulte [Deploy for Free](https://render.com/docs/free). PostgreSQL no Neon mantém os registros quando o serviço Render reinicia.

## Atualizar sem perder confirmações

Mantenha o mesmo projeto/banco/branch Neon e a mesma `DATABASE_URL`. Faça backup antes de alterar esquema ou dados. Revise o commit, execute os testes localmente, faça push e use deploy manual no Render. Não apague tabelas, não recrie o banco, não restaure um banco vazio sobre o atual e não troque a conexão por engano. A inicialização aplica apenas alterações aditivas necessárias. No modo SQLite local, preserve `.env` e `data/` ao atualizar o código.

Para backup local consistente, pare o servidor, copie a pasta `data` inteira e reinicie; preserve também arquivos WAL caso existam. Para PostgreSQL, use backup/exportação do Neon ou `pg_dump` com credenciais configuradas localmente. Guarde backups fora do Git e restrinja o acesso. Depois do evento, remova dados pessoais e cópias que não forem mais necessários.

## Migrar confirmações existentes do SQLite

Não execute a migração real antes de revisar a origem e o destino com a responsável pelo projeto. O banco original é aberto somente para leitura e nunca substituído. Faça backup consistente e interrompa novas confirmações no sistema antigo durante a migração, para não deixar registros para trás.

1. No `.env` local, configure `MIGRATION_SQLITE_PATH` com o caminho absoluto do SQLite revisado e `DATABASE_URL` com o banco Neon de destino revisado. Não altere os arquivos do banco original.
2. Dentro de `thabata-rsvp`, execute `npm run migrate`. Este é o modo de simulação: valida os registros e informa apenas contagens/conflitos, sem importar dados pessoais. Revise projeto/branch/banco no Neon Console e o caminho de origem localmente, sem compartilhar segredos.
3. Depois da revisão e da autorização para migrar, execute `npm run migrate -- --apply --reviewed`.
4. Confira as contagens no painel e guarde o backup original. A importação é transacional: conflito de telefone com conteúdo diferente interrompe a operação inteira, sem sobrescrever famílias. Executar novamente preserva os grupos idênticos já importados e insere somente os ausentes.

## Testar

Execute `npm test` na pasta do aplicativo. Os testes SQLite criam bancos temporários automaticamente, sem carregar o `.env` ou usar o banco local real. A suíte cobre formulário e JSON, validação, duplicidade, persistência, autenticação, proteção das rotas, dashboard, CSV e exclusão. Os testes de interface usam DOM simulado (jsdom); eles não validam renderização, teclado virtual ou comportamento de um navegador real. A verificação visual em largura de celular continua pendente.

O teste PostgreSQL fica **ignorado por padrão**. Para habilitá-lo, configure `RSVP_TEST_DATABASE_URL` privadamente no ambiente do terminal, apontando somente para um servidor PostgreSQL local descartável e exclusivo para testes, e execute `npm test` novamente. Não use o banco de convidados nem a conexão Neon real. O teste não lê `DATABASE_URL`: cria um schema com nome aleatório, usa apenas dados fictícios e remove o próprio schema ao terminar. No PowerShell, defina a variável pela interface local do ambiente/terminal, sem compartilhar seu valor no chat ou em arquivos versionados.

PostgreSQL local foi exercitado durante esta preparação. A conexão TLS, as permissões e o comportamento no Neon remoto e atrás do proxy Render ainda precisam ser validados depois da configuração da hospedagem. Resultados e limites da investigação estão em [VERIFICACOES.md](VERIFICACOES.md).

Para conferir manualmente, teste responsável sozinho, com um e com três acompanhantes das três faixas; remova um do meio, alterne Sim/Não/Sim, provoque uma falha e confira que os campos permanecem preenchidos. Depois confirme os totais, a busca e o CSV no painel. Use somente nomes e telefones fictícios e um banco de teste.

## Arquivos principais

- `public/index.html`, `style.css`, `app.js`: convite e formulário.
- `public/admin.html`, `admin.js`: painel e CSV.
- `backend/server.js`: API, autenticação, origem e limite de tentativas.
- `backend/database.js`: persistência SQLite/PostgreSQL.
- `backend/migrate.js`: migração manual e simulação.
- `backend/*test.js`: verificações automatizadas.
- `../render.yaml`: Web Service Free com a subpasta correta.

| Método | Rota | Acesso |
|---|---|---|
| GET | `/healthz` | Público, estado mínimo |
| POST | `/api/rsvp` | Público; JSON `name`, `phone`, `consent`, `companions` |
| POST | `/api/login` | JSON `password` |
| POST | `/api/logout` | Encerra sessão |
| GET | `/api/admin/guests` | Administrador |
| DELETE | `/api/admin/guests/:id` | Administrador; exclui o grupo inteiro |
