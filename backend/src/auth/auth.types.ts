export type UserRole = "cliente" | "operador" | "gerente" | "empresa";

export const USER_ROLES: readonly UserRole[] = ["cliente", "operador", "gerente", "empresa"];

/** Papéis que podem entrar no portal do operador (/operador). S3-16: gerente autoriza cancelamentos. */
export const STAFF_ROLES: readonly UserRole[] = [
  "operador",
  "gerente",
  "empresa",
];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  cpf: string | null;
  phone: string | null;
}

export interface LoginDto {
  email?: string;
  password?: string;
  /** "operador" exige papel operador/empresa; "cliente" aceita qualquer conta. */
  portal?: "cliente" | "operador";
}

export interface RegisterDto {
  name?: string;
  email?: string;
  password?: string;
  cpf?: string;
  phone?: string;
}

export interface SessionPayload {
  access_token: string;
  expires_at: number | null;
  user: AuthUser;
}
