import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export {};
