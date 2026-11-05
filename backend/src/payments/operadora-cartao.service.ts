import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import crypto from "node:crypto";

/**
 * Ator 4 (Sistema Externo): Operadora de Cartão
 * Responsável por processar a cobrança financeira em tempo real (RF003).
 * Permite validar tanto o fluxo básico quanto o fluxo alternativo 5.1.5.2 (Pagamento recusado).
 */
@Injectable()
export class OperadoraCartaoService {
  processarPagamento(
    cartaoNumero: unknown,
    simularRecusa = false
  ): { status: string; card_masked: string; transacao_id: string } {
    const numLimpo = String(cartaoNumero ?? "").replace(/\s+/g, "");
    if (!cartaoNumero || numLimpo.length < 13) {
      throw new BadRequestException("Dados do cartao de credito invalidos.");
    }

    // Simula recusa se solicitado explicitamente ou se terminar em '0000'
    if (simularRecusa || numLimpo.endsWith("0000")) {
      throw new HttpException(
        "Transacao recusada pela operadora de cartao. Por favor, utilize outra forma de pagamento.",
        HttpStatus.PAYMENT_REQUIRED
      );
    }

    // Mascara o cartão para segurança (RNF002: Criptografia e dados sensíveis)
    const mascarado = `•••• •••• •••• ${numLimpo.slice(-4)}`;
    return {
      status: "aprovado",
      card_masked: mascarado,
      transacao_id: `TX-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    };
  }
}
