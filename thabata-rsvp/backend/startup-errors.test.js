import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupError, startupDiagnostic } from './startup-errors.js';

test('diagnósticos de configuração são específicos e não retornam valores do ambiente', () => {
  for (const [message, code] of [
    ['ADMIN_PASSWORD deve ter pelo menos 12 caracteres.', 'CONFIG_ADMIN_PASSWORD'],
    ['TRUST_PROXY_HOPS deve ser 0 ou 1.', 'CONFIG_PROXY'],
    ['APP_ORIGIN deve ser a origem pública HTTPS, sem caminho.', 'CONFIG_ORIGIN'],
    ['Configure APP_ORIGIN ou RENDER_EXTERNAL_URL.', 'CONFIG_ORIGIN_MISSING'],
    ['DATABASE_URL é obrigatória em produção.', 'CONFIG_DATABASE_URL_REQUIRED'],
    ['DATABASE_URL inválida.', 'CONFIG_DATABASE_URL_INVALID'],
    ['DATABASE_URL deve apontar para PostgreSQL.', 'CONFIG_DATABASE_URL_INVALID'],
    ['PORT inválida.', 'CONFIG_PORT'],
  ]) assert.equal(startupDiagnostic(new Error(message)).code, code);
  for (const code of ['CONFIG_ORIGIN', 'CONFIG_DATABASE_URL_INVALID']) {
    assert.equal(startupDiagnostic(startupError(code)).code, code);
  }
});

test('SQLite ocupado/bloqueado usa código numérico primário ou estendido, sem expor a mensagem', () => {
  for (const [errcode, expected] of [[5, 'SQLITE_BUSY'], [517, 'SQLITE_BUSY'], [6, 'SQLITE_LOCKED'], [262, 'SQLITE_LOCKED'], [8, 'SQLITE_READONLY'], [14, 'SQLITE_OPEN_FAILED']]) {
    const error = Object.assign(Error('nome, telefone e caminho privado'), { code: 'ERR_SQLITE_ERROR', errcode });
    const result = startupDiagnostic(error);
    assert.equal(result.code, expected);
    assert.doesNotMatch(JSON.stringify(result), /nome, telefone|caminho privado/);
  }
});

test('porta, permissão e conexão PostgreSQL recebem mensagens fixas', () => {
  for (const [code, expected] of [['EADDRINUSE', 'PORT_IN_USE'], ['EACCES', 'PERMISSION_DENIED'], ['EPERM', 'PERMISSION_DENIED'], ['28P01', 'DATABASE_AUTH'], ['ENOTFOUND', 'DATABASE_UNAVAILABLE'], ['ECONNREFUSED', 'DATABASE_UNAVAILABLE'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'DATABASE_TLS']]) {
    assert.equal(startupDiagnostic({ code, message: 'postgres://usuario:segredo@servidor/banco' }).code, expected);
  }
});

test('erro desconhecido, mensagem, stack, conexão e código arbitrário nunca aparecem no diagnóstico', () => {
  for (const error of [undefined, null, 'segredo', new Error('postgres://usuario:segredo@servidor/banco'), { code: 'segredo', message: 'telefone privado', stack: 'senha privada' }, { code: 'ERR_SQLITE_ERROR', errcode: 1, message: 'dados privados' }]) {
    const diagnostic = startupDiagnostic(error);
    assert.equal(diagnostic.code, 'STARTUP_UNKNOWN');
    assert.doesNotMatch(JSON.stringify(diagnostic), /postgres:\/\/|usuario|servidor|telefone privado|senha privada|dados privados|"code":"segredo"/);
  }
  assert.equal(startupDiagnostic(startupError('codigo-com-segredo')).code, 'STARTUP_UNKNOWN');
});
