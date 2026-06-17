import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertCanInviteAttendeeUser,
  canSearchAttendeeUser,
} from './attendee-invite.policy';

const APPT_COMPANY = 'company-a';

function user(
  overrides: Partial<AuthenticatedUser> & Pick<AuthenticatedUser, 'id' | 'roleName'>,
): AuthenticatedUser {
  return {
    email: 'u@test.com',
    firstName: 'Test',
    lastName: 'User',
    companyId: 'company-a',
    isPlatformOwnerCompany: false,
    ...overrides,
  };
}

describe('attendee-invite.policy', () => {
  describe('assertCanInviteAttendeeUser', () => {
    it('allows SUPER_ADMIN to invite anyone', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'sa', roleName: 'SUPER_ADMIN', companyId: 'platform', isPlatformOwnerCompany: true }),
          {
            id: 'other-admin',
            roleName: 'COMPANY_ADMIN',
            companyId: 'company-b',
            isPlatformOwnerCompany: false,
          },
          APPT_COMPANY,
        ),
      ).not.toThrow();
    });

    it('allows COMPANY_ADMIN to invite SUPER_ADMIN', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'ca', roleName: 'COMPANY_ADMIN' }),
          {
            id: 'sa',
            roleName: 'SUPER_ADMIN',
            companyId: 'platform',
            isPlatformOwnerCompany: true,
          },
          APPT_COMPANY,
        ),
      ).not.toThrow();
    });

    it('blocks COMPANY_ADMIN from inviting another COMPANY_ADMIN', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'ca', roleName: 'COMPANY_ADMIN' }),
          {
            id: 'ca2',
            roleName: 'COMPANY_ADMIN',
            companyId: 'company-a',
            isPlatformOwnerCompany: false,
          },
          APPT_COMPANY,
        ),
      ).toThrow(ForbiddenException);
    });

    it('allows COMPANY_ADMIN to invite same-company staff', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'ca', roleName: 'COMPANY_ADMIN' }),
          {
            id: 'staff',
            roleName: 'COMPANY_STAFF',
            companyId: 'company-a',
            isPlatformOwnerCompany: false,
          },
          APPT_COMPANY,
        ),
      ).not.toThrow();
    });

    it('allows CLIENT to invite their COMPANY_ADMIN only', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'client', roleName: 'CLIENT' }),
          {
            id: 'admin',
            roleName: 'COMPANY_ADMIN',
            companyId: 'company-a',
            isPlatformOwnerCompany: false,
          },
          APPT_COMPANY,
        ),
      ).not.toThrow();
    });

    it('blocks CLIENT from inviting staff', () => {
      expect(() =>
        assertCanInviteAttendeeUser(
          user({ id: 'client', roleName: 'CLIENT' }),
          {
            id: 'staff',
            roleName: 'COMPANY_STAFF',
            companyId: 'company-a',
            isPlatformOwnerCompany: false,
          },
          APPT_COMPANY,
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('canSearchAttendeeUser', () => {
    it('hides COMPANY_ADMIN targets from COMPANY_ADMIN search', () => {
      expect(
        canSearchAttendeeUser(
          user({ id: 'ca', roleName: 'COMPANY_ADMIN' }),
          {
            roleName: 'COMPANY_ADMIN',
            companyId: 'company-a',
            isPlatformOwnerCompany: false,
          },
        ),
      ).toBe(false);
    });

    it('shows COMPANY_ADMIN targets to CLIENT search', () => {
      expect(
        canSearchAttendeeUser(user({ id: 'client', roleName: 'CLIENT' }), {
          roleName: 'COMPANY_ADMIN',
          companyId: 'company-a',
          isPlatformOwnerCompany: false,
        }),
      ).toBe(true);
    });
  });
});
