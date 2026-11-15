// Every diagnostic below is fixed text. Never include an exception message,
// connection string, password, path or other environment value in startup logs.
const diagnostics = Object.freeze({
  CONFIG_ADMIN_PASSWORD: 'Defina ADMIN_PASSWORD com pelo menos 12 caracteres no .env local ou nas variáveis do Render.',
  CONFIG_PROXY: 'TRUST_PROXY_HOPS deve ser 0 para acesso direto ou 1 atrás do proxy do Render.',
  CONFIG_ORIGIN: 'APP_ORIGIN deve ser uma origem válida, sem usuário, senha ou caminho; em produção, use HTTPS.',
  CONFIG_ORIGIN_MISSING: 'Em produção, configure APP_ORIGIN ou use RENDER_EXTERNAL_URL fornecida pelo Render.',
  CONFIG_DATABASE_URL_REQUIRED: 'DATABASE_URL é obrigatória em produção. Preencha a conexão do Neon diretamente no Render.',
  CONFIG_DATABASE_URL_INVALID: 'DATABASE_URL deve ser uma conexão PostgreSQL válida. Confira o valor no .env ou no Render sem compartilhá-lo.',
  CONFIG_PORT: 'PORT deve ser um número inteiro entre 0 e 65535.',
  SQLITE_BUSY: 'O SQLite está ocupado por outra conexão. Encerre a outra instância deste projeto e tente novamente. Preserve os arquivos do banco.',
  SQLITE_LOCKED: 'O SQLite está bloqueado por outra conexão. Encerre a outra instância deste projeto e tente novamente. Preserve os arquivos do banco.',
  SQLITE_READONLY: 'O SQLite não permite gravação. Confira a permissão de escrita da pasta DATA_DIR; preserve os arquivos existentes.',
  SQLITE_OPEN_FAILED: 'Não foi possível abrir o SQLite. Confira a existência e a permissão de escrita da pasta DATA_DIR.',
  PORT_IN_USE: 'A porta configurada já está em uso. Encerre o servidor anterior no terminal com Ctrl+C ou defina PORT=3001 no .env e tente novamente.',
  PERMISSION_DENIED: 'O sistema negou acesso à porta ou à pasta de dados. Confira PORT e a permissão de escrita de DATA_DIR.',
  DATABASE_AUTH: 'O PostgreSQL recusou a autenticação. Confira DATABASE_URL diretamente no .env ou no Render.',
  DATABASE_UNAVAILABLE: 'Não foi possível alcançar o PostgreSQL. Confira a conexão de rede, a disponibilidade do banco e DATABASE_URL.',
  DATABASE_TLS: 'Não foi possível validar a conexão segura com o PostgreSQL. Confira a conexão fornecida pelo Neon; mantenha a validação de certificados.',
  STARTUP_UNKNOWN: 'Não foi possível iniciar. Confira a configuração e a disponibilidade do banco. Nenhum segredo foi registrado.',
});

// Only used for the application's existing fixed validation errors. Matching a
// whole known message is safe; unknown messages are never copied into output.
const configMessages = new Map([
  ['ADMIN_PASSWORD deve ter pelo menos 12 caracteres.', 'CONFIG_ADMIN_PASSWORD'],
  ['TRUST_PROXY_HOPS deve ser 0 ou 1.', 'CONFIG_PROXY'],
  ['APP_ORIGIN deve ser a origem pública HTTPS, sem caminho.', 'CONFIG_ORIGIN'],
  ['Configure APP_ORIGIN ou RENDER_EXTERNAL_URL.', 'CONFIG_ORIGIN_MISSING'],
  ['DATABASE_URL é obrigatória em produção.', 'CONFIG_DATABASE_URL_REQUIRED'],
  ['DATABASE_URL inválida.', 'CONFIG_DATABASE_URL_INVALID'],
  ['DATABASE_URL deve apontar para PostgreSQL.', 'CONFIG_DATABASE_URL_INVALID'],
  ['PORT inválida.', 'CONFIG_PORT'],
]);

export function startupError(code) {
  const safeCode = Object.hasOwn(diagnostics, code) ? code : 'STARTUP_UNKNOWN';
  return Object.assign(new Error(diagnostics[safeCode]), { code: safeCode });
}

export function startupDiagnostic(error) {
  let code = 'STARTUP_UNKNOWN';
  if (Object.hasOwn(diagnostics, error?.code)) code = error.code;
  else if (configMessages.has(error?.message)) code = configMessages.get(error.message);
  else if (error?.code === 'SQLITE_BUSY') code = 'SQLITE_BUSY';
  else if (error?.code === 'SQLITE_LOCKED') code = 'SQLITE_LOCKED';
  else if (error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode)) {
    // Extended SQLite result codes retain the primary code in their low byte.
    code = ({ 5: 'SQLITE_BUSY', 6: 'SQLITE_LOCKED', 8: 'SQLITE_READONLY', 14: 'SQLITE_OPEN_FAILED' })[error.errcode & 255] || 'STARTUP_UNKNOWN';
  } else if (error?.code === 'EADDRINUSE') code = 'PORT_IN_USE';
  else if (['EACCES', 'EPERM'].includes(error?.code)) code = 'PERMISSION_DENIED';
  else if (['28P01', '28000'].includes(error?.code)) code = 'DATABASE_AUTH';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'].includes(error?.code)) code = 'DATABASE_UNAVAILABLE';
  else if (['CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error?.code)) code = 'DATABASE_TLS';
  return { code, message: diagnostics[code] };
}
