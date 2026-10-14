import { SetMetadata } from '@nestjs/common';
import type { Grant } from '../permissions.js';

export const PERMISSION_KEY = 'permission';

/** Required role permission; several grants = any one of them is enough. */
export const Permission = (...grants: Grant[]) => SetMetadata(PERMISSION_KEY, grants);

/** Open to every signed-in staff user (e.g. tax rules and dropdown lists the forms need). */
export const AnyStaff = () => SetMetadata(PERMISSION_KEY, 'any');

/** The handler checks permissions itself (depends on a parameter, e.g. purchases vs sales). */
export const CheckedInHandler = () => SetMetadata(PERMISSION_KEY, 'handler');
