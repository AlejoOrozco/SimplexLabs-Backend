/**
 * Canonical permission keys for `@RequirePermissions(...)`.
 * Seed `role_permissions` / `permissions` to match these strings.
 */
export const PERM = {
  companyAppointmentsView: 'company.appointments.view',
  companyAppointmentsManage: 'company.appointments.manage',
  companyAppointmentsAttendees: 'company.appointments.attendees',
  companyAppointmentsSearch: 'company.appointments.search',
  companyConversationsView: 'company.conversations.view',
  companyConversationsManage: 'company.conversations.manage',
  companyOrdersView: 'company.orders.view',
  companyOrdersManage: 'company.orders.manage',
  companyProductsView: 'company.products.view',
  companyProductsManage: 'company.products.manage',
  companyPlansView: 'company.plans.view',
  companyChannelsView: 'company.channels.view',
  companyChannelsManage: 'company.channels.manage',
  companyPaymentsView: 'company.payments.view',
  companyPaymentsManage: 'company.payments.manage',
  companyNotificationsView: 'company.notifications.view',
  companyNotificationsManage: 'company.notifications.manage',
  companyStaffView: 'company.staff.view',
  companyStaffManage: 'company.staff.manage',
  companySchedulingView: 'company.scheduling.view',
  companySchedulingManage: 'company.scheduling.manage',
  companyWebsitesView: 'company.websites.view',
  companyWebsitesManage: 'company.websites.manage',
  companyClientContactsView: 'company.client_contacts.view',
  companyClientContactsManage: 'company.client_contacts.manage',
  companyUsersView: 'company.users.view',
  companyUsersManage: 'company.users.manage',
  companyCompaniesView: 'company.companies.view',
  companyCompaniesManage: 'company.companies.manage',
  companySubscriptionsView: 'company.subscriptions.view',
  companySubscriptionsManage: 'company.subscriptions.manage',
  /** Billing / subscription read surface (seed `permissions` + `role_permissions`). */
  companyBillingView: 'company.billing.view',
  companyCalendarView: 'company.calendar.view',
  companyCalendarManage: 'company.calendar.manage',
  companyUsersPermissions: 'company.users.permissions',
  companyDashboardView: 'company.dashboard.view',
  platformPlansManage: 'platform.plans.manage',
  platformAgentsView: 'platform.agents.view',
  platformAgentsManage: 'platform.agents.manage',
  platformAdminAccess: 'platform.admin.access',
} as const;

export type PermissionKey = (typeof PERM)[keyof typeof PERM];

const COMPANY_ADMIN_ROLE = 'COMPANY_ADMIN';

/** All tenant-scoped permission keys (excludes `platform.*`). */
export function allCompanyPermissionKeys(): PermissionKey[] {
  return Object.values(PERM).filter((key) => key.startsWith('company.'));
}

export function isCompanyPermissionKey(key: string): boolean {
  return key.startsWith('company.');
}

export { COMPANY_ADMIN_ROLE };
