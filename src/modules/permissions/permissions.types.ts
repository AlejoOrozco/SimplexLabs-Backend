export interface UserPermissionManagementItem {
  key: string;
  label: string;
  description: string | null;
  isGranted: boolean;
  isOverridden: boolean;
  roleDefault: boolean;
}

export type UserPermissionsManagementResponse = Record<
  string,
  UserPermissionManagementItem[]
>;
