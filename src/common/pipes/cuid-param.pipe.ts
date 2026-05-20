import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/**
 * Prisma `cuid()` primary keys for models such as OnboardingWizardDraft.
 */
@Injectable()
export class CuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !/^c[a-z0-9]{20,32}$/i.test(value)) {
      throw new BadRequestException('Invalid draft id');
    }
    return value;
  }
}
