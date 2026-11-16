import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import crypto from "node:crypto";
import { SECRET_TOKEN_KEY } from "../common/constants";

/** Cada código vale por esta janela (e pela anterior, para não falhar na virada). */
export const CODIGO_TERCEIRO_JANELA_S = 600; // 10 minutos

export interface ThirdPartyCodeResult {
  sent_to: string;
  channel: "email_simulado";
  expires_in_seconds: number;
  /** Só vem na resposta enquanto não houver serviço de e-mail/SMS (modo simulado). */
  code?: string;
  simulated: true;
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * S3-18 - Confirmação extra ao indicar terceiro.
 * O sistema NÃO tem serviço de e-mail/SMS: o envio é simulado e o código é
 * devolvido na resposta enquanto CODIGO_TERCEIRO_EM_RESPOSTA não for "false".
 * O código é um HMAC de 6 dígitos (titular + terceiro + janela de 10 min), então
 * não precisa de tabela e só vale para aquela dupla de CPFs.
 */
@Injectable()
export class ThirdPartyCodeService {
  private readonly logger = new Logger(ThirdPartyCodeService.name);

  private codeFor(
    customerCpf: string,
    thirdPartyCpf: string,
    window: number
  ): string {
    if (!SECRET_TOKEN_KEY) {
      throw new InternalServerErrorException(
        "SECRET_TOKEN_KEY ausente nas variáveis de ambiente (RNF002/RNF003: segredos fora do código)."
      );
    }
    const hex = crypto
      .createHmac("sha256", Buffer.from(SECRET_TOKEN_KEY, "utf-8"))
      .update(`3p|${digits(customerCpf)}|${digits(thirdPartyCpf)}|${window}`)
      .digest("hex");
    return String(parseInt(hex.slice(0, 8), 16) % 1_000_000).padStart(6, "0");
  }

  private currentWindow(): number {
    return Math.floor(Date.now() / 1000 / CODIGO_TERCEIRO_JANELA_S);
  }

  /** Gera e "envia" o código para o e-mail do titular. */
  issue(payload: {
    customer_cpf?: string;
    third_party_cpf?: string;
    email?: string;
  }): ThirdPartyCodeResult {
    const customerCpf = digits(payload?.customer_cpf);
    const thirdPartyCpf = digits(payload?.third_party_cpf);
    if (customerCpf.length !== 11 || thirdPartyCpf.length !== 11) {
      throw new BadRequestException(
        "Informe o CPF do titular e o CPF do terceiro (11 dígitos cada)."
      );
    }
    if (customerCpf === thirdPartyCpf) {
      throw new BadRequestException(
        "O terceiro precisa ser uma pessoa diferente do titular."
      );
    }

    const code = this.codeFor(customerCpf, thirdPartyCpf, this.currentWindow());
    const email = String(payload?.email ?? "").trim();
    const masked = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? email.replace(/^(.).*(@.*)$/, "$1***$2")
      : "e-mail do titular";

    this.logger.log(
      `[SIMULADO] Código de confirmação do terceiro enviado para ${masked}.`
    );

    return {
      sent_to: masked,
      channel: "email_simulado",
      expires_in_seconds: CODIGO_TERCEIRO_JANELA_S,
      ...(process.env.CODIGO_TERCEIRO_EM_RESPOSTA === "false" ? {} : { code }),
      simulated: true,
    };
  }

  /** Recusa (403) a indicação do terceiro se o código não confere. */
  assertValid(
    customerCpf: string,
    thirdPartyCpf: string,
    code: unknown
  ): void {
    const informado = String(code ?? "").trim();
    if (!/^\d{6}$/.test(informado)) {
      throw new ForbiddenException(
        "Confirme o terceiro com o código de 6 dígitos enviado ao e-mail do titular."
      );
    }
    const atual = this.currentWindow();
    const valido = [atual, atual - 1].some((window) => {
      const esperado = this.codeFor(customerCpf, thirdPartyCpf, window);
      return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(informado));
    });
    if (!valido) {
      throw new ForbiddenException(
        "Código de confirmação do terceiro inválido ou expirado."
      );
    }
  }
}
