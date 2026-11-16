import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "../common/constants";
import {
  AuthUser,
  LoginDto,
  RegisterDto,
  SessionPayload,
  STAFF_ROLES,
  USER_ROLES,
  UserRole,
} from "./auth.types";

/**
 * S3-07 / S3-14: autenticação feita pelo Supabase Auth.
 * Nenhuma senha é guardada no nosso banco: o login confere e-mail e senha no
 * Supabase e o papel (cliente, operador, gerente ou empresa) vem de `app_metadata.role`,
 * que só pode ser alterado com a service role key (nunca pelo próprio usuário).
 */
@Injectable()
export class AuthService {
  private authClient: SupabaseClient | null = null;
  private adminClient: SupabaseClient | null = null;

  private createStateless(key: string): SupabaseClient {
    if (!SUPABASE_URL || !key) {
      throw new InternalServerErrorException(
        "Credenciais do Supabase ausentes. Configure SUPABASE_URL e SUPABASE_ANON_KEY no .env."
      );
    }
    return createClient(SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Cliente com a chave anon: usado só para conferir e-mail e senha. */
  private get anon(): SupabaseClient {
    this.authClient ??= this.createStateless(SUPABASE_ANON_KEY);
    return this.authClient;
  }

  /** Cliente com a service role: valida tokens e cria contas de cliente. */
  private get admin(): SupabaseClient {
    this.adminClient ??= this.createStateless(
      SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    );
    return this.adminClient;
  }

  private toAuthUser(user: User): AuthUser {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const rawRole = (user.app_metadata as Record<string, unknown> | undefined)
      ?.role;
    const role: UserRole = USER_ROLES.includes(rawRole as UserRole)
      ? (rawRole as UserRole)
      : "cliente";

    return {
      id: user.id,
      email: user.email ?? "",
      name:
        typeof meta.name === "string" && meta.name
          ? meta.name
          : (user.email ?? "").split("@")[0],
      role,
      cpf: typeof meta.cpf === "string" ? meta.cpf : null,
      phone: typeof meta.phone === "string" ? meta.phone : null,
    };
  }

  async login(payload: LoginDto): Promise<SessionPayload> {
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    if (!email || !password) {
      throw new BadRequestException("Informe e-mail e senha.");
    }

    const { data, error } = await this.anon.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session || !data.user) {
      throw new UnauthorizedException("E-mail ou senha inválidos.");
    }

    const user = this.toAuthUser(data.user);
    if (payload.portal === "operador" && !STAFF_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        "Esta conta não tem acesso ao portal do operador."
      );
    }

    return {
      access_token: data.session.access_token,
      expires_at: data.session.expires_at ?? null,
      user,
    };
  }

  /** Cadastro público: sempre cria conta com papel "cliente". */
  async register(payload: RegisterDto): Promise<SessionPayload> {
    const name = String(payload.name ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const cpf = String(payload.cpf ?? "").trim();
    const phone = String(payload.phone ?? "").trim();

    if (!name || !email || !password || !cpf) {
      throw new BadRequestException(
        "Preencha nome, e-mail, CPF e senha para criar a conta."
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException("E-mail inválido.");
    }
    if (password.length < 6) {
      throw new BadRequestException("A senha deve ter no mínimo 6 caracteres.");
    }

    const { error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, cpf, phone },
      app_metadata: { role: "cliente" },
    });

    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        throw new ConflictException("Já existe uma conta com este e-mail.");
      }
      throw new InternalServerErrorException(
        `Falha ao criar a conta: ${error.message}`
      );
    }

    return this.login({ email, password, portal: "cliente" });
  }

  /** Confere o token enviado no cabeçalho Authorization e devolve o usuário. */
  async verifyToken(token: string): Promise<AuthUser> {
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Sessão inválida ou expirada.");
    }
    return this.toAuthUser(data.user);
  }
}
