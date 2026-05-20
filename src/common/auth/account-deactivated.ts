/**
 * Payload for inactive-user 401s. HTTP responses use code `account_deactivated`
 * (see global exception filter).
 */
export const ACCOUNT_DEACTIVATED = {
  code: 'ACCOUNT_DEACTIVATED',
  message:
    'Your account has been deactivated. Please contact SimplexLabs for assistance.',
  contact: 'support@simplexlabs.co',
} as const;
