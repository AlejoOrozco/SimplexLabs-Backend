/**
 * Payload for inactive-company 401s. HTTP responses use code `company_deactivated`
 * (see global exception filter).
 */
export const COMPANY_DEACTIVATED = {
  code: 'COMPANY_DEACTIVATED',
  message:
    'Your company account has been deactivated. Please contact SimplexLabs for assistance.',
  contact: 'support@simplexlabs.co',
} as const;
