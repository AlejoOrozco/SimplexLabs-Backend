/**
 * Structural types describing the Meta (WhatsApp / Instagram / Messenger)
 * webhook payload. Unknown fields pass through untouched — we only narrow
 * what we actively consume so future Meta additions are not silently
 * dropped at the type layer.
 *
 * These types mirror Meta's documented Graph API v19+ webhook shape.
 */

export const META_OBJECT = {
  WHATSAPP: 'whatsapp_business_account',
  INSTAGRAM: 'instagram',
  MESSENGER: 'page',
} as const;

export type MetaObject = (typeof META_OBJECT)[keyof typeof META_OBJECT];

export type MetaMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'document'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button';

export type MetaStatusType = 'sent' | 'delivered' | 'read' | 'failed';

export interface MetaContact {
  profile: { name: string };
  wa_id: string;
}

export interface MetaMediaObject {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
}

export interface MetaAudioObject {
  id: string;
  mime_type: string;
  voice?: boolean;
}

export interface MetaDocumentObject {
  id: string;
  filename: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
}

export interface MetaInteractiveReply {
  id: string;
  title: string;
}

export interface MetaInteractiveObject {
  type: string;
  button_reply?: MetaInteractiveReply;
  list_reply?: MetaInteractiveReply;
}

export interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  /**
   * One of `MetaMessageType` under normal operation. Typed as `string`
   * because Meta periodically ships new message types and we never want
   * a webhook to be rejected at the type layer — unknown values are
   * handled at runtime by the processing service.
   */
  type: string;
  text?: { body: string };
  image?: MetaMediaObject;
  audio?: MetaAudioObject;
  document?: MetaDocumentObject;
  video?: MetaMediaObject;
  sticker?: MetaMediaObject;
  interactive?: MetaInteractiveObject;
}

export interface MetaStatus {
  id: string;
  status: MetaStatusType;
  timestamp: string;
  recipient_id: string;
}

export interface MetaChangeValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}

export interface MetaChange {
  value: MetaChangeValue;
  field: string;
}

export interface MetaEntry {
  id: string;
  changes: MetaChange[];
}

export interface MetaWebhookPayload {
  object: string;
  entry: MetaEntry[];
}

/**
 * Runtime guard — payload arrives as `unknown` from Express and must be
 * narrowed before any field access. We only verify the top-level shape;
 * entry/change contents are validated as they are consumed.
 */
export function isMetaWebhookPayload(
  value: unknown,
): value is MetaWebhookPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.object === 'string' && Array.isArray(candidate.entry);
}
