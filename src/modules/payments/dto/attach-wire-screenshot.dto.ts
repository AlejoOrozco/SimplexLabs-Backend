import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

/**
 * Minimal Phase 5 upload hook — the backend does not ingest bytes here.
 * The frontend uploads the screenshot to storage (e.g. Supabase Storage)
 * and POSTs the resulting URL so the payment moves AWAITING_SCREENSHOT
 * → PENDING_REVIEW atomically with an event log entry.
 */
export class AttachWireScreenshotDto {
  @ApiProperty({
    description:
      'Publicly-retrievable URL (or signed URL) for the wire screenshot.',
  })
  @IsString()
  @IsUrl({ require_protocol: true })
  screenshotUrl!: string;
}
