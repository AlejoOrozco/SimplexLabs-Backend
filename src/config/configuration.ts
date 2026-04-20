type CookieSameSite = 'lax' | 'strict' | 'none';

const isProduction = process.env.NODE_ENV === 'production';

const parseSameSite = (raw: string | undefined): CookieSameSite => {
  const value = raw?.toLowerCase();
  if (value === 'none' || value === 'lax' || value === 'strict') return value;
  return isProduction ? 'none' : 'lax';
};

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true';
};

const parseFrontendUrls = (raw: string | undefined): string[] => {
  const defaultValue = 'http://localhost:3000';
  return (raw ?? defaultValue)
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
};

export const configuration = () => ({
  port: parseInt(process.env.PORT ?? '8000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** When true, serves OpenAPI UI even if NODE_ENV is production (set on Railway if you need /docs). */
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  /**
   * Allowed frontend origins for CORS. Comma-separated list supported so we can
   * allow both localhost (dev) and a Vercel URL (prod/preview) without code changes.
   */
  frontendUrls: parseFrontendUrls(process.env.FRONTEND_URL),
  cookie: {
    /**
     * Must be 'none' when the frontend and backend live on different sites
     * (e.g. vercel.app -> railway.app). 'none' also requires secure=true.
     */
    sameSite: parseSameSite(process.env.COOKIE_SAMESITE),
    secure: parseBool(process.env.COOKIE_SECURE, isProduction),
  },
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

export type AppConfig = ReturnType<typeof configuration>;
export type CookieConfig = AppConfig['cookie'];
