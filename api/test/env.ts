// Conexões do Postgres de teste. Sobrescreva com variáveis de ambiente se necessário.
const host = process.env.TEST_PG_HOST ?? "127.0.0.1:5432";
export const OWNER_PASSWORD = process.env.TEST_PG_OWNER_PASSWORD ?? "owner_pw";
export const OWNER_ADMIN_URL = `postgres://mc_owner:${OWNER_PASSWORD}@${host}/postgres`;
export const OWNER_URL = `postgres://mc_owner:${OWNER_PASSWORD}@${host}/mindcare_test`;
export const APP_URL_DB = `postgres://mc_app:app_pw@${host}/mindcare_test`;
