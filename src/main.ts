import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { assertRequiredConfig, configuration } from './config/configuration';
import { RealtimeIoAdapter } from './modules/realtime/realtime.adapter';

async function bootstrap(): Promise<void> {
  assertRequiredConfig(configuration());

  // rawBody: true lets us read `req.rawBody` on the Meta webhook guard so we
  // can verify X-Hub-Signature-256 against the exact bytes Meta signed. Must
  // happen at factory level — Nest otherwise discards the buffer after parse.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Phase 8 — hard body-size caps applied at Nest's own body parsers so
  // raw-body preservation (required for webhook signatures) still works.
  // 4 MB is comfortably above any realistic JSON request; webhook routes
  // never ship anything close to this. Requests beyond the cap get a
  // 413 Payload Too Large before reaching a controller.
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '4mb' });

  app.use(helmet());
  app.use(cookieParser());

  const allowedOrigins = config.get<string[]>('frontendUrls') ?? [];
  const corsOrigin: CustomOrigin = (origin, callback) => {
    // Allow same-origin/non-browser requests (curl, server-to-server) where Origin is absent.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  };
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Frontend sends per-request correlation ids for traceability; allow it
    // explicitly so browser preflight succeeds on auth and all API routes.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, allowedOrigins));

  const isProduction = config.get<string>('nodeEnv') === 'production';
  const enableSwagger = !isProduction || config.get<boolean>('enableSwagger');

  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SimplexLabs API')
      .setDescription('SimplexLabs platform backend API')
      .setVersion('1.0')
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
    logger.log('Swagger UI: GET /api/v1/docs');
  } else {
    logger.log(
      'Swagger UI disabled in production. Set ENABLE_SWAGGER=true to enable, or use GET /api/v1/health to verify the server.',
    );
  }

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  logger.log(`Server running on port ${port}`);
}

void bootstrap();
