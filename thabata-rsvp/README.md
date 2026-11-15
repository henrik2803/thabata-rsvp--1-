# Aniversário da Thabata — confirmação de presença

Front-end responsivo HTML/CSS/JavaScript, back-end Node.js e banco SQLite persistente. Sem dependências externas, sem npm install e sem build.

## Executar

1. Instale Node.js 24 ou superior.
2. Extraia o ZIP inteiro. Abra um terminal dentro da pasta `thabata-rsvp`, onde está `package.json`.
3. Copie `.env.example` para `.env`. Git Bash: `cp .env.example .env`. PowerShell: `Copy-Item .env.example .env`.
4. Edite `.env` e preencha `ADMIN_PASSWORD` com uma senha privada de pelo menos 12 caracteres. Não existe senha padrão.
5. Execute `npm start`.

Convite: http://localhost:3000

Dashboard: http://localhost:3000/admin — entre com a senha do `.env`.

Mantenha o terminal aberto. Ctrl+C encerra o servidor. O aviso experimental do SQLite em algumas versões do Node é esperado.

## Funcionalidades

- Convite rosa e amarelo: Thabata, 23/11 às 19h, Restaurante 11 Estrelas, Quinta Lebrão, rodízio R$ 49,90.
- Nome, telefone com DDD e consentimento de uso para organizar o evento.
- Um registro por telefone: reenvios são bloqueados com uma orientação para entrar em contato com a organização.
- Painel com contagem, busca, atualização automática a cada 15 segundos, exclusão com confirmação e exportação CSV para Excel. A exportação contém a lista completa.
- Login com cookie HttpOnly/SameSite, sessão de 8 horas, validação no servidor, consultas parametrizadas e limites de tentativas. Reiniciar o servidor encerra sessões, preservando convidados.
- Convidados reais são gravados no servidor. Nenhum dado de demonstração acompanha o ZIP.

## Persistência e backup

O banco é criado automaticamente em `data/rsvp.sqlite`. Para backup simples consistente, pare o servidor, copie a pasta `data` inteira e reinicie. Não publique `.env` ou `data` em repositórios. Após o evento, remova dados pessoais desnecessários, inclusive de backups.

## Colocar na internet

O pacote está pronto para executar, mas não está publicado. `localhost` só abre no próprio computador e não serve como link para os convidados.

Use servidor com Node 24+, HTTPS e disco persistente. Configure o comando `npm start`, `ADMIN_PASSWORD`, `NODE_ENV=production`, a `PORT` exigida pelo provedor e `DATA_DIR` apontando para o volume persistente (por exemplo `/data/thabata`). Em produção o cookie exige HTTPS.

Compartilhe a URL pública raiz; o painel fica em `/admin`. Front-end e API são servidos juntos. Use uma única instância; hospedagem somente estática ou com disco temporário não serve para este back-end. Limites usam o IP da conexão: atrás de proxy, visitantes podem compartilhar o limite (20 envios/15 minutos); ajuste `rate` em `backend/server.js` à infraestrutura antes de compartilhar. Não há recuperação por e-mail: para trocar senha, altere a variável e reinicie.

## Arquivos

- `public/index.html`, `style.css`, `app.js`: convite e formulário.
- `public/admin.html`, `admin.js`: painel.
- `backend/server.js`: API, autenticação e SQLite.
- `backend/test.js`: teste integrado com banco temporário isolado.

Para mudar informações, edite `public/index.html` e os textos correspondentes em `public/admin.html` e `public/app.js`.

## Teste

Execute `npm test`. Verifica cadastro, validação, consentimento, duplicidades, login, painel protegido, exclusão, logout e bloqueio de origem externa. Não usa o banco real.

## API

| Método | Rota | Acesso |
|---|---|---|
| POST | /api/rsvp | Público; JSON name, phone, consent |
| POST | /api/login | JSON password |
| POST | /api/logout | Encerra sessão |
| GET | /api/admin/guests | Administrador |
| DELETE | /api/admin/guests/:id | Administrador |

## Atualizar uma instalação existente

Pare o servidor. Copie `public` e `backend/server.js` deste ZIP sobre os arquivos correspondentes do projeto anterior. Preserve seu `.env` e sua pasta `data` para manter senha e confirmações. Execute `npm start` novamente e atualize o navegador com Ctrl+F5. A fonte Fredoka é local e sua licença está em `public/fonts/OFL.txt`.

## Confirmação por família
O responsável informa nome e telefone e adiciona até 20 acompanhantes, com nome e faixa etária. O responsável conta como uma pessoa de 10 anos ou mais. O painel mostra grupos, acompanhantes e totais; o CSV inclui os integrantes. Um telefone já cadastrado não pode sobrescrever um grupo: solicite à organização a exclusão da confirmação antiga e envie novamente. A atualização do banco é automática e preserva confirmações anteriores, consideradas grupos de uma pessoa.
