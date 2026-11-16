import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthUser, LoginDto, RegisterDto, SessionPayload } from "./auth.types";
import { extractBearerToken } from "./roles.guard";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() payload: LoginDto): Promise<SessionPayload> {
    return this.authService.login(payload ?? {});
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  register(@Body() payload: RegisterDto): Promise<SessionPayload> {
    return this.authService.register(payload ?? {});
  }

  @Get("me")
  async me(@Req() request: any): Promise<{ user: AuthUser }> {
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException("Faça login para continuar.");
    }
    return { user: await this.authService.verifyToken(token) };
  }
}
