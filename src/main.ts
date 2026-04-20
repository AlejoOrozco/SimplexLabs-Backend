import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

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
    allowedHeaders: ['Content-Type', 'Authorization'],
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
