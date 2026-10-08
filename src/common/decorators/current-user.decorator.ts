import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
}
/** Injects the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | any => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
