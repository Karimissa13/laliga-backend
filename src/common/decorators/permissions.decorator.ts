import { SetMetadata } from '@nestjs/common';
export const PERMISSIONS_KEY = 'permissions';
/** Require one or more `module.action` permissions to access a route. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
