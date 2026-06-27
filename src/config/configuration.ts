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

const parseInt10 = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFloatSafe = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const configuration = () => ({
  port: parseInt10(process.env.PORT, 8000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  frontendUrls: parseFrontendUrls(process.env.FRONTEND_URL),
  cookie: {
    sameSite: parseSameSite(process.env.COOKIE_SAMESITE),
    secure: parseBool(process.env.COOKIE_SECURE, isProduction),
    // Optional explicit cookie domain for cross-subdomain auth
    // (e.g. api.simplexlabs.org issuing cookies for .simplexlabs.org).
    domain: process.env.COOKIE_DOMAIN?.trim() || undefined,
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
    /** Meta app secret — used for X-Hub-Signature-256 verification on webhooks. */
    appSecret: process.env.META_APP_SECRET ?? '',
    apiVersion: process.env.META_API_VERSION ?? 'v19.0',
  },
  dialog: {
    sandboxApiKey: process.env.DIALOG_SANDBOX_API_KEY ?? '',
    sandboxBaseUrl:
      process.env.DIALOG_SANDBOX_BASE_URL ?? 'https://waba-sandbox.360dialog.io',
    sandboxNumber: process.env.DIALOG_SANDBOX_NUMBER ?? '+551146733492',
    /** When true, inbound sandbox messages get an echo reply and skip the agent pipeline. */
    sandboxEchoEnabled: parseBool(process.env.DIALOG_SANDBOX_ECHO_ENABLED, false),
    /**
     * When true, unmatched WhatsApp `phone_number_id` values route to the
     * platform-owner sandbox channel (externalId `sandbox`).
     */
    sandboxInboundFallback: parseBool(
      process.env.DIALOG_SANDBOX_INBOUND_FALLBACK,
      true,
    ),
    /** CompanyChannel.externalId used for 360dialog sandbox webhook routing. */
    sandboxExternalId: process.env.DIALOG_SANDBOX_EXTERNAL_ID ?? 'sandbox',
    /**
     * 360dialog sandbox webhooks often omit Meta's `X-Hub-Signature-256`.
     * Set to `true` for sandbox; keep `false` in production Meta Cloud setups.
     */
    webhookSkipSignature: parseBool(
      process.env.DIALOG_WEBHOOK_SKIP_SIGNATURE,
      false,
    ),
  },
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  },
  agents: {
    /** OpenAI API key. Required at startup. */
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    /** Default OpenAI model for pipeline steps. Overridable per-prompt. */
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiBaseUrl:
      process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    /** Per-step HTTP timeout for OpenAI calls. */
    openaiTimeoutMs: parseInt10(process.env.OPENAI_TIMEOUT_MS, 30_000),
    /** How many recent conversation messages the retriever reads. */
    retrieverMessageWindow: parseInt10(process.env.RETRIEVER_WINDOW, 12),
    /** Global default temperature fallback when a prompt has none. */
    defaultTemperature: parseFloatSafe(process.env.AGENT_DEFAULT_TEMPERATURE, 0.3),
    /**
     * When true, inbound WhatsApp messages trigger the agent pipeline even
     * when NODE_ENV !== production. Required for Twilio sandbox testing.
     */
    runPipelineInDev: parseBool(process.env.AGENT_PIPELINE_IN_DEV, false),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    /**
     * Default outbound WhatsApp sender, e.g. `whatsapp:+14155238886`.
     * Used when no per-company CompanyChannel row exists.
     */
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '',
    /**
     * Public API base URL used for Twilio webhook signature validation,
     * e.g. `https://api.simplexlabs.org`. Must NOT include a trailing slash.
     */
    webhookBaseUrl: (process.env.TWILIO_WEBHOOK_BASE_URL ?? '').replace(
      /\/$/,
      '',
    ),
    /** Local/ngrok only — never enable in production. */
    webhookSkipSignature: parseBool(
      process.env.TWILIO_WEBHOOK_SKIP_SIGNATURE,
      false,
    ),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    /** Where Stripe redirects the customer after a successful checkout. */
    successUrl:
      process.env.STRIPE_SUCCESS_URL ??
      'http://localhost:3000/payments/success',
    /** Where Stripe redirects the customer if they cancel checkout. */
    cancelUrl:
      process.env.STRIPE_CANCEL_URL ??
      'http://localhost:3000/payments/cancelled',
    /** Three-letter ISO default for new payments when the caller omits currency. */
    defaultCurrency: (process.env.STRIPE_DEFAULT_CURRENCY ?? 'USD').toUpperCase(),
  },
  email: {
    /**
     * `resend` — Resend HTTP API (recommended).
     * `smtp` — generic SMTP via nodemailer (e.g. Resend SMTP relay).
     * `none` — in-app + WhatsApp only; email fallback disabled.
     */
    provider: (process.env.EMAIL_PROVIDER ?? 'none').toLowerCase() as
      | 'resend'
      | 'smtp'
      | 'none',
    from: process.env.EMAIL_FROM ?? '',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    smtp: {
      host: process.env.EMAIL_SMTP_HOST ?? '',
      port: parseInt10(process.env.EMAIL_SMTP_PORT, 587),
      secure: parseBool(process.env.EMAIL_SMTP_SECURE, false),
      user: process.env.EMAIL_SMTP_USER ?? '',
      password: process.env.EMAIL_SMTP_PASSWORD ?? '',
    },
  },
  notifications: {
    /**
     * Cron expression for the inactivity-close job. Defaults to every
     * 15 minutes; each company's `inactivityCloseHours` setting is the
     * actual threshold applied per-row.
     */
    inactivityCron: process.env.NOTIFICATIONS_INACTIVITY_CRON ?? '*/15 * * * *',
    inactivityJobEnabled: parseBool(
      process.env.NOTIFICATIONS_INACTIVITY_ENABLED,
      true,
    ),
    /**
     * Max conversations auto-closed per job run (safety brake in case a
     * migration/backfill leaves a huge backlog stale).
     */
    inactivityBatchLimit: parseInt10(
      process.env.NOTIFICATIONS_INACTIVITY_BATCH_LIMIT,
      200,
    ),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
export type CookieConfig = AppConfig['cookie'];
export type MetaConfig = AppConfig['meta'];
export type DialogConfig = AppConfig['dialog'];
export type SecurityConfig = AppConfig['security'];
export type AgentsConfig = AppConfig['agents'];
export type TwilioConfig = AppConfig['twilio'];
export type EmailConfig = AppConfig['email'];
export type NotificationsConfig = AppConfig['notifications'];

/**
 * Fail-fast validator invoked from bootstrap. Any missing critical value
 * aborts startup with a single clear message listing all offenders.
 */
export function assertRequiredConfig(cfg: AppConfig): void {
  const missing: string[] = [];
  if (!cfg.agents.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!cfg.agents.openaiModel) missing.push('OPENAI_MODEL');
  if (!cfg.meta.appSecret) missing.push('META_APP_SECRET');
  if (!cfg.meta.webhookVerifyToken) missing.push('META_WEBHOOK_VERIFY_TOKEN');
  if (!cfg.security.encryptionKey) missing.push('ENCRYPTION_KEY');
  // Stripe is REQUIRED as of Phase 5 — the payments module refuses to
  // construct without a secret key. We also insist on a webhook secret
  // so signature verification cannot be silently disabled, and on
  // success/cancel URLs because Stripe rejects checkout sessions
  // without them.
  if (!cfg.stripe.secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!cfg.stripe.webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!cfg.stripe.successUrl) missing.push('STRIPE_SUCCESS_URL');
  if (!cfg.stripe.cancelUrl) missing.push('STRIPE_CANCEL_URL');
  // Email fallback is OPTIONAL. In-app and WhatsApp channels are always
  // available. But if the operator picks a provider, required credentials
  // MUST be set — otherwise we'd silently drop email fallback.
  if (cfg.email.provider === 'resend') {
    if (!cfg.email.from) missing.push('EMAIL_FROM');
    if (!cfg.email.resendApiKey) missing.push('RESEND_API_KEY');
  }
  if (cfg.email.provider === 'smtp') {
    if (!cfg.email.from) missing.push('EMAIL_FROM');
    if (!cfg.email.smtp.host) missing.push('EMAIL_SMTP_HOST');
    if (!cfg.email.smtp.user) missing.push('EMAIL_SMTP_USER');
    if (!cfg.email.smtp.password) missing.push('EMAIL_SMTP_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `Refusing to start. Set these in .env (local) or your host's secret manager.`,
    );
  }
}
