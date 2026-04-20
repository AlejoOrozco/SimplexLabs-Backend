export const configuration = () => ({
  port: parseInt(process.env.PORT ?? '8000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** When true, serves OpenAPI UI even if NODE_ENV is production (set on Railway if you need /docs). */
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:8000',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  meta: {
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
  },
});
