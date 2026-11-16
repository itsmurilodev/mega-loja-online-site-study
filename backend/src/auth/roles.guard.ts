import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { AuthUser, UserRole } from "./auth.types";

export const ROLES_KEY = "megaloja:roles";

/** Exige login e um dos papéis informados (401 sem token, 403 com papel errado). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException("Faça login para acessar este recurso.");
    }

    const user: AuthUser = await this.authService.verifyToken(token);
    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        "Seu perfil não tem permissão para esta operação."
      );
    }

    request.user = user;
    return true;
  }
}
