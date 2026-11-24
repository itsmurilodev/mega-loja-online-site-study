/**
 * S2-07 - Testes de contrato da API Click & Collect.
 *
 * Falam com a API somente por HTTP, entao rodam contra qualquer implementacao
 * (local, Preview ou producao). Variaveis:
 *
 *   API_URL                endereco da API (padrao http://127.0.0.1:5000)
 *   API_TOKEN              token de login de um OPERADOR (S3-14 / S3-16).
 *                          Sem ele, os testes que usam endpoints do operador sao
 *                          pulados e so a protecao (401) e conferida.
 *   API_TOKEN_GERENTE      token de um GERENTE ou da empresa: cancelar pedidos e
 *                          liberar reservas vencidas (S3-16 / S3-24).
 *   API_TOKEN_EMPRESA      token da empresa (opcional; consulta do log geral).
 *   CONTRACT_WRITE=1       libera os fluxos que criam pedidos no banco (exige API_TOKEN
 *                          e API_TOKEN_GERENTE)
 *
 * Recursos que dependem da migracao SQL 001 (janela de retirada, entrega, Pix,
 * transferencia, auditoria) sao pulados enquanto GET /api/health informar
 * migracao_001 = false.
 *   CONTRACT_DESTRUCTIVE=1 libera o teste de ruptura, que ZERA o estoque do
 *                          produto na filial usada (so em banco descartavel)
 */
import { beforeAll, describe, expect, it } from "vitest";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
const API_TOKEN = process.env.API_TOKEN ?? "";
const temToken = API_TOKEN.length > 0;
const API_TOKEN_GERENTE = process.env.API_TOKEN_GERENTE ?? "";
const temGerente = API_TOKEN_GERENTE.length > 0;
const API_TOKEN_EMPRESA = process.env.API_TOKEN_EMPRESA ?? "";
const temEmpresa = API_TOKEN_EMPRESA.length > 0;
const podeEscrever = process.env.CONTRACT_WRITE === "1" && temToken && temGerente;
const podeDestruir = process.env.CONTRACT_DESTRUCTIVE === "1";

const ID_INEXISTENTE = 99999999;
const CPF_TITULAR = "111.222.333-44";
const FORMATO_VOUCHER = /^HV-\d{4,}-[0-9A-F]{4}-[0-9A-F]{4}$/;
const ESTOQUE_MINIMO_PARA_ESCRITA = 2;

interface Resposta {
  status: number;
  body: any;
}

async function chamar(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  token: string | null = API_TOKEN || null,
  extraHeaders: Record<string, string> = {}
): Promise<Resposta> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  try {
    return { status: resposta.status, body: JSON.parse(texto) };
  } catch {
    throw new Error(
      `${metodo} ${caminho} respondeu ${resposta.status} sem JSON: ${texto.slice(0, 120)}`
    );
  }
}

const get = (caminho: string) => chamar("GET", caminho);
const comoGerente = (metodo: string, caminho: string, corpo?: unknown) =>
  chamar(metodo, caminho, corpo, API_TOKEN_GERENTE);

/** Migracao SQL 001 aplicada? (definido no beforeAll) */
// Lido na coleta (antes dos testes) para o skipIf enxergar o valor.
let migrado = { orders_extra: false, audit_log: false };
try {
  const saude = await (await fetch(`${API_URL}/api/health`)).json();
  migrado = saude.migracao_001 ?? migrado;
} catch {
  // API fora do ar: os testes que dependem dela falham por conta propria.
}
const temExtras = () => migrado.orders_extra;
const temAuditoria = () => migrado.audit_log;

/** S3-18: pede o codigo de confirmacao do terceiro (envio simulado). */
async function codigoDoTerceiro(cpfTitular: string, cpfTerceiro: string): Promise<string> {
  const { status, body } = await chamar(
    "POST",
    "/api/orders/third-party-code",
    { customer_cpf: cpfTitular, third_party_cpf: cpfTerceiro, email: "titular@megaloja.invalid" },
    null
  );
  expect(status).toBe(201);
  expect(body.confirmation.code, "CODIGO_TERCEIRO_EM_RESPOSTA=false: o teste precisa do codigo").toMatch(/^\d{6}$/);
  return body.confirmation.code;
}
const post = (caminho: string, corpo: unknown = {}) => chamar("POST", caminho, corpo);

function esperarErro(resposta: Resposta, statusEsperado: number): void {
  expect(resposta.status).toBe(statusEsperado);
  expect(typeof resposta.body.error).toBe("string");
  expect(resposta.body.error.length).toBeGreaterThan(0);
}

async function consultarEstoque(lojaId: number, produtoId: number): Promise<number> {
  const { body } = await get(`/api/stores?product_id=${produtoId}`);
  return body.stores.find((loja: any) => loja.id === lojaId).stock;
}

/** Produto e filial com mais estoque, para os testes nao esbarrarem em falta de item. */
async function escolherProdutoComEstoque() {
  const { body } = await get("/api/products");
  let melhor = { produto: body.products[0], lojaId: 0, estoque: -1 };
  for (const produto of body.products) {
    const lojas = (await get(`/api/stores?product_id=${produto.id}`)).body.stores;
    for (const loja of lojas) {
      if (loja.stock > melhor.estoque) {
        melhor = { produto, lojaId: loja.id, estoque: loja.stock };
      }
    }
  }
  return melhor;
}

let alvo: Awaited<ReturnType<typeof escolherProdutoComEstoque>>;

beforeAll(async () => {
  alvo = await escolherProdutoComEstoque();
});

function pedidoValido(extra: Record<string, unknown> = {}) {
  return {
    customer_name: "Teste de Contrato S2-07",
    customer_cpf: CPF_TITULAR,
    delivery_method: "retirar_na_loja",
    store_id: alvo.lojaId,
    product_id: alvo.produto.id,
    quantity: 1,
    card_number: "4111 1111 1111 1234",
    ...extra,
  };
}

describe("Consultas (somente leitura)", () => {
  it("GET /api/health informa que a API esta online", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.status).toBe("online");
  });

  it("GET /api lista os casos de uso", async () => {
    const { status, body } = await get("/api");
    expect(status).toBe(200);
    expect(body.casos_de_uso.UC003_finalizar_compra).toBe("POST /api/orders");
  });

  it("GET /api/products devolve o catalogo com os campos usados pelo front", async () => {
    const { status, body } = await get("/api/products");
    expect(status).toBe(200);
    expect(body.products.length).toBeGreaterThan(0);
    for (const produto of body.products) {
      expect(produto).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        category: expect.any(String),
        price: expect.any(Number),
        sku: expect.any(String),
        barcode: expect.any(String),
      });
    }
  });

  it("GET /api/stores devolve as filiais ativas", async () => {
    const { status, body } = await get("/api/stores");
    expect(status).toBe(200);
    expect(body.stores.length).toBeGreaterThan(0);
    for (const loja of body.stores) {
      expect(loja).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        city: expect.any(String),
        active: 1,
      });
    }
  });

  it("GET /api/stores?product_id inclui o estoque por filial (UC002)", async () => {
    const { status, body } = await get(`/api/stores?product_id=${alvo.produto.id}`);
    expect(status).toBe(200);
    for (const loja of body.stores) {
      expect(loja.stock).toEqual(expect.any(Number));
      expect(loja.stock).toBeGreaterThanOrEqual(0);
    }
  });

  it.skipIf(!temToken)("GET /api/orders lista os pedidos de uma filial (fila do balcao)", async () => {
    const { status, body } = await get(`/api/orders?store_id=${alvo.lojaId}`);
    expect(status).toBe(200);
    expect(Array.isArray(body.orders)).toBe(true);
    for (const pedido of body.orders) {
      expect(pedido.store_id).toBe(alvo.lojaId);
    }
  });

  it("GET /api/orders/{id} inexistente responde 404", async () => {
    esperarErro(await get(`/api/orders/${ID_INEXISTENTE}`), 404);
  });

  it("GET /api/orders/{id} com id nao numerico responde 400", async () => {
    esperarErro(await get("/api/orders/abc"), 400);
  });

  it("GET /api/orders/{id}/notifications de pedido inexistente responde 404", async () => {
    esperarErro(await get(`/api/orders/${ID_INEXISTENTE}/notifications`), 404);
  });

  it("rota desconhecida responde 404 com { error }", async () => {
    esperarErro(await get("/api/rota-que-nao-existe"), 404);
  });
});

describe("UC003 Finalizar Compra: recusas (nao gravam pedido)", () => {
  it("sem product_id responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ product_id: undefined })), 400);
  });

  it("delivery_method invalido responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ delivery_method: "drone" })), 400);
  });

  it("retirada na loja sem filial responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ store_id: undefined })), 400);
  });

  it("quantidade zero responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ quantity: 0 })), 400);
  });

  it("produto inexistente responde 404", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ product_id: ID_INEXISTENTE })), 404);
  });

  it("filial inexistente responde 404", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ store_id: ID_INEXISTENTE })), 404);
  });

  it("estoque insuficiente responde 409", async () => {
    const acimaDoEstoque = alvo.estoque + 1000;
    esperarErro(await post("/api/orders", pedidoValido({ quantity: acimaDoEstoque })), 409);
  });

  it("pagamento recusado pela operadora responde 402 (fluxo 5.1.5.2)", async () => {
    const estoqueAntes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(
      await post("/api/orders", pedidoValido({ simulate_payment_failure: true })),
      402
    );
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueAntes);
  });

  it("cartao invalido responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ card_number: "123" })), 400);
  });
});

// S3-15: carrinho com varios itens. Todas as recusas acontecem antes de gravar qualquer pedido.
describe("Carrinho: POST /api/orders/checkout, recusas (nao gravam pedido)", () => {
  const carrinhoValido = (extra: Record<string, unknown> = {}) => ({
    customer_name: "Cliente Teste de Contrato",
    customer_cpf: CPF_TITULAR,
    delivery_method: "retirar_na_loja",
    store_id: alvo.lojaId,
    items: [{ product_id: alvo.produto.id, quantity: 1 }],
    card_number: "4111 1111 1111 1234",
    ...extra,
  });

  it("carrinho vazio responde 400", async () => {
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ items: [] })), 400);
  });

  it("item com quantidade zero responde 400", async () => {
    esperarErro(
      await post("/api/orders/checkout", carrinhoValido({ items: [{ product_id: alvo.produto.id, quantity: 0 }] })),
      400
    );
  });

  it("retirada na loja sem filial responde 400", async () => {
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ store_id: undefined })), 400);
  });

  it("produto inexistente responde 404", async () => {
    esperarErro(
      await post("/api/orders/checkout", carrinhoValido({ items: [{ product_id: ID_INEXISTENTE, quantity: 1 }] })),
      404
    );
  });

  it("um item sem estoque barra o carrinho inteiro (409) e a mensagem cita o produto", async () => {
    const resposta = await post(
      "/api/orders/checkout",
      carrinhoValido({
        items: [
          { product_id: alvo.produto.id, quantity: 1 },
          { product_id: alvo.produto.id, quantity: alvo.estoque + 1000 },
        ],
      })
    );
    esperarErro(resposta, 409);
    expect(resposta.body.error).toContain(alvo.produto.name);
  });

  it("pagamento recusado responde 402 sem reservar estoque", async () => {
    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(await post("/api/orders/checkout", carrinhoValido({ simulate_payment_failure: true })), 402);
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes);
  });
});

// S3-14: o servidor, e nao o front, decide quem pode operar a loja.
describe("Protecao dos endpoints do operador e da empresa (S3-14)", () => {
  const SEM_TOKEN = null;
  const TOKEN_INVALIDO = "token.invalido.de-teste";

  const protegidos: [string, string, unknown][] = [
    ["GET", "/api/orders", undefined],
    ["GET", "/api/orders/mine", undefined],
    // Privacidade: nome, CPF, voucher e notificacoes nao saem sem login nem chave do pedido.
    ["GET", "/api/orders/1", undefined],
    ["GET", "/api/orders/1/notifications", undefined],
    ["POST", "/api/orders/1/separate", { barcode_or_sku: "X" }],
    ["POST", "/api/orders/1/rupture", { reason: "teste" }],
    ["POST", "/api/orders/1/expire", {}],
    ["POST", "/api/orders/validate-pickup", { pickup_code: "HV-0000-ZZZZ-ZZZZ", document_checked: true }],
    ["POST", "/api/orders/pickup", { pickup_code: "HV-0000-ZZZZ-ZZZZ", document_checked: true }],
    ["PATCH", "/api/orders/1/status", { status: "pronto_retirada" }],
    ["POST", "/api/products", { name: "x", category: "x", price: 1, sku: "X-TESTE" }],
    ["PATCH", "/api/products/1", { price: 1 }],
  ];

  for (const [metodo, caminho, corpo] of protegidos) {
    it(`${metodo} ${caminho} sem login responde 401`, async () => {
      esperarErro(await chamar(metodo, caminho, corpo, SEM_TOKEN), 401);
    });

    it(`${metodo} ${caminho} com token invalido responde 401`, async () => {
      esperarErro(await chamar(metodo, caminho, corpo, TOKEN_INVALIDO), 401);
    });
  }

  it("login com senha errada responde 401 e nao entrega token", async () => {
    const { status, body } = await chamar(
      "POST",
      "/api/auth/login",
      { email: "ninguem@megaloja.invalid", password: "senha-errada", portal: "operador" },
      SEM_TOKEN
    );
    expect(status).toBe(401);
    expect(body.access_token).toBeUndefined();
  });

  it("login sem e-mail e senha responde 400", async () => {
    esperarErro(await chamar("POST", "/api/auth/login", {}, SEM_TOKEN), 400);
  });

  it("cadastro com senha curta responde 400", async () => {
    esperarErro(
      await chamar(
        "POST",
        "/api/auth/register",
        { name: "Teste", email: "teste@megaloja.invalid", cpf: "000.000.000-00", password: "123" },
        SEM_TOKEN
      ),
      400
    );
  });

  it("o cliente continua criando pedido sem login de operador", async () => {
    // Recusa de pagamento prova que a rota passou do guard sem gravar nada.
    esperarErro(
      await chamar(
        "POST",
        "/api/orders",
        pedidoValido({ simulate_payment_failure: true }),
        SEM_TOKEN
      ),
      402
    );
  });
});

describe.skipIf(!temToken)("UC007 Validar Retirada: recusas (nao gravam nada)", () => {
  it("voucher desconhecido responde 404", async () => {
    esperarErro(
      await post("/api/orders/validate-pickup", {
        pickup_code: "HV-0000-ZZZZ-ZZZZ",
        document_checked: true,
      }),
      404
    );
  });

  it("sem nenhum dado de busca responde 404", async () => {
    esperarErro(await post("/api/orders/validate-pickup", {}), 404);
  });
});

describe.skipIf(!podeEscrever)("Fluxos que gravam pedidos (CONTRACT_WRITE=1)", () => {
  beforeAll(() => {
    expect(
      alvo.estoque,
      "nenhuma filial tem estoque suficiente para os testes de escrita"
    ).toBeGreaterThanOrEqual(ESTOQUE_MINIMO_PARA_ESCRITA);
  });

  describe("compra, separacao e expiracao (devolve o estoque ao final)", () => {
    let pedidoId: number;
    let estoqueInicial: number;
    let voucher: string;

    it("UC003: cria o pedido com status aguardando_separacao e reserva o estoque", async () => {
      estoqueInicial = await consultarEstoque(alvo.lojaId, alvo.produto.id);
      const { status, body } = await post("/api/orders", pedidoValido());
      expect(status).toBe(201);
      expect(body.order).toMatchObject({
        id: expect.any(Number),
        status: "aguardando_separacao",
        pickup_code: null,
        store_id: alvo.lojaId,
        product_id: alvo.produto.id,
        quantity: 1,
      });
      pedidoId = body.order.id;
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueInicial - 1);
    });

    it("RNF002: a resposta nao expoe o numero completo do cartao", async () => {
      const { body } = await get(`/api/orders/${pedidoId}`);
      expect(JSON.stringify(body)).not.toContain("4111 1111 1111");
      expect(JSON.stringify(body)).not.toContain("4111111111111234");
    });

    it("UC007: retirada antes da separacao responde 400", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { order_id: pedidoId, document_checked: true }),
        400
      );
    });

    it("UC005: SKU errado na conferencia responde 400", async () => {
      esperarErro(
        await post(`/api/orders/${pedidoId}/separate`, { barcode_or_sku: "SKU-ERRADO" }),
        400
      );
    });

    it("UC005: separacao com o SKU certo libera o voucher", async () => {
      const { status, body } = await post(`/api/orders/${pedidoId}/separate`, {
        barcode_or_sku: alvo.produto.sku,
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("pronto_retirada");
      expect(body.order.pickup_code).toMatch(FORMATO_VOUCHER);
      voucher = body.order.pickup_code;
    });

    it("UC005: separar de novo responde 400", async () => {
      esperarErro(
        await post(`/api/orders/${pedidoId}/separate`, { barcode_or_sku: alvo.produto.sku }),
        400
      );
    });

    it("UC006: as notificacoes registram a compra e o voucher", async () => {
      const { status, body } = await get(`/api/orders/${pedidoId}/notifications`);
      expect(status).toBe(200);
      expect(body.notifications.length).toBeGreaterThanOrEqual(2);
      const mensagens = body.notifications.map((n: any) => n.message).join("\n");
      expect(mensagens).toContain(voucher);
    });

    it("UC007: retirada sem conferir o documento responde 400", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: false }),
        400
      );
    });

    it("UC007: retirada por terceiro sem terceiro cadastrado responde 403", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", {
          pickup_code: voucher,
          document_checked: true,
          is_third_party: true,
        }),
        403
      );
    });

    it("abandono: expirar cancela o pedido e devolve o estoque", async () => {
      const { status, body } = await comoGerente("POST", `/api/orders/${pedidoId}/expire`);
      expect(status).toBe(200);
      expect(body.order.status).toBe("cancelado_expirado");
      expect(body.order.refund_requested).toBe(1);
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(estoqueInicial);
    });

    it("pedido expirado nao pode ser retirado (409) nem expirado de novo (409)", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: true }),
        409
      );
      esperarErro(await comoGerente("POST", `/api/orders/${pedidoId}/expire`), 409);
    });
  });

  describe("retirada por terceiro ate a entrega (consome 1 unidade do estoque)", () => {
    let voucher: string;

    it("compra com terceiro autorizado e separa o pedido", async () => {
      const codigo = await codigoDoTerceiro(CPF_TITULAR, "555.666.777-88");
      const compra = await post(
        "/api/orders",
        pedidoValido({
          third_party_name: "Terceiro de Teste",
          third_party_cpf: "555.666.777-88",
          third_party_code: codigo,
        })
      );
      expect(compra.status).toBe(201);
      expect(compra.body.order.third_party_name).toBe("Terceiro de Teste");

      const separacao = await post(`/api/orders/${compra.body.order.id}/separate`, {
        barcode_or_sku: alvo.produto.barcode,
      });
      expect(separacao.status).toBe(200);
      voucher = separacao.body.order.pickup_code;
    });

    it("UC007: terceiro retira com o voucher e o pedido fica entregue_cliente", async () => {
      const { status, body } = await post("/api/orders/validate-pickup", {
        pickup_code: voucher,
        document_checked: true,
        is_third_party: true,
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("entregue_cliente");
    });

    it("UC007: voucher reutilizado responde 409", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { pickup_code: voucher, document_checked: true }),
        409
      );
    });
  });

});

describe.skipIf(!podeEscrever || !podeDestruir)(
  "UC008 Ruptura (CONTRACT_DESTRUCTIVE=1: zera o estoque da filial)",
  () => {
    let pedidoId: number;

    it("ruptura cancela o pedido, pede estorno e zera o estoque da filial", async () => {
      const compra = await post("/api/orders", pedidoValido());
      expect(compra.status).toBe(201);
      pedidoId = compra.body.order.id;

      const { status, body } = await post(`/api/orders/${pedidoId}/rupture`, {
        reason: "Teste de contrato: item nao encontrado na prateleira.",
      });
      expect(status).toBe(200);
      expect(body.order.status).toBe("cancelado_ruptura");
      expect(body.order.refund_requested).toBe(1);
      expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(0);
    });

    it("pedido com ruptura nao pode ser retirado (409) nem cancelado de novo (409)", async () => {
      esperarErro(
        await post("/api/orders/validate-pickup", { order_id: pedidoId, document_checked: true }),
        409
      );
      esperarErro(await post(`/api/orders/${pedidoId}/rupture`), 409);
    });
  }
);

// ---------------------------------------------------------------------------
// Sprint 3: recursos novos
// ---------------------------------------------------------------------------

// S3-16: operador separa e da baixa; cancelar e com gerente/empresa.
describe.skipIf(!podeEscrever)("Perfis operador e gerente (S3-16)", () => {
  let pedidoId: number;

  it("cria um pedido para os testes de perfil", async () => {
    const compra = await post("/api/orders", pedidoValido());
    expect(compra.status).toBe(201);
    pedidoId = compra.body.order.id;
  });

  it("operador NAO cancela: POST /expire responde 403", async () => {
    esperarErro(await post(`/api/orders/${pedidoId}/expire`), 403);
  });

  it("operador NAO cancela: PATCH status cancelado responde 403", async () => {
    esperarErro(await chamar("PATCH", `/api/orders/${pedidoId}/status`, { status: "cancelado" }), 403);
  });

  it("operador NAO libera reservas vencidas (403)", async () => {
    esperarErro(await post("/api/orders/expire-overdue"), 403);
  });

  it("gerente cancela e o estoque volta", async () => {
    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    const { status, body } = await comoGerente("POST", `/api/orders/${pedidoId}/expire`);
    expect(status).toBe(200);
    expect(body.order.status).toBe("cancelado_expirado");
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes + 1);
  });
});

// S3-18: indicar terceiro exige o codigo de confirmacao (simulado por e-mail).
describe("Terceiro com codigo de confirmacao (S3-18)", () => {
  const TERCEIRO_CPF = "555.666.777-88";

  it("pedir o codigo com CPF invalido responde 400", async () => {
    esperarErro(
      await chamar("POST", "/api/orders/third-party-code", { customer_cpf: "1", third_party_cpf: "2" }, null),
      400
    );
  });

  it("o titular nao pode ser o proprio terceiro (400)", async () => {
    esperarErro(
      await chamar(
        "POST",
        "/api/orders/third-party-code",
        { customer_cpf: CPF_TITULAR, third_party_cpf: CPF_TITULAR },
        null
      ),
      400
    );
  });

  it("indicar terceiro sem o codigo e recusado (403) e nao reserva estoque", async () => {
    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(
      await post("/api/orders", pedidoValido({ third_party_name: "Fulano", third_party_cpf: TERCEIRO_CPF })),
      403
    );
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes);
  });

  it("codigo errado e recusado (403)", async () => {
    const certo = await codigoDoTerceiro(CPF_TITULAR, TERCEIRO_CPF);
    const errado = certo === "000000" ? "111111" : "000000";
    esperarErro(
      await post(
        "/api/orders",
        pedidoValido({ third_party_name: "Fulano", third_party_cpf: TERCEIRO_CPF, third_party_code: errado })
      ),
      403
    );
  });

  it("o codigo de outro terceiro nao vale (403)", async () => {
    const codigoOutro = await codigoDoTerceiro(CPF_TITULAR, "999.888.777-66");
    esperarErro(
      await post(
        "/api/orders",
        pedidoValido({ third_party_name: "Fulano", third_party_cpf: TERCEIRO_CPF, third_party_code: codigoOutro })
      ),
      403
    );
  });

  it("terceiro so com nome (sem CPF) responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ third_party_name: "Fulano" })), 400);
  });
});

// S3-23: Pix simulado e pagamento dividido.
describe("Pix e meios combinados (S3-23)", () => {
  it("POST /api/payments/pix gera cobranca com copia e cola e validade", async () => {
    const { status, body } = await chamar("POST", "/api/payments/pix", { amount: 10.5 }, null);
    expect(status).toBe(201);
    expect(body.pix).toMatchObject({
      amount: 10.5,
      simulated: true,
      expires_in_seconds: 300,
      txid: expect.stringMatching(/^PIX[0-9A-F]+$/),
    });
    expect(body.pix.copia_e_cola.length).toBeGreaterThan(20);
    expect(body.pix.token).toContain(".");
  });

  it("Pix com valor invalido responde 400", async () => {
    esperarErro(await chamar("POST", "/api/payments/pix", { amount: 0 }, null), 400);
  });

  it("Pix expirado e recusado (402) e nao reserva estoque", async () => {
    const quote = await chamar(
      "POST",
      "/api/orders/quote",
      {
        customer_name: "Cliente Teste",
        store_id: alvo.lojaId,
        items: [{ product_id: alvo.produto.id, quantity: 1 }],
      },
      null
    );
    expect(quote.status).toBe(200);
    const pix = await chamar("POST", "/api/payments/pix", { amount: quote.body.total, ttl_seconds: 1 }, null);
    await new Promise((resolver) => setTimeout(resolver, 2200));
    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    esperarErro(
      await post("/api/orders", pedidoValido({ payment: { methods: [{ type: "pix", pix_token: pix.body.pix.token }] } })),
      402
    );
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes);
  });

  it("Pix adulterado responde 400", async () => {
    const pix = await chamar("POST", "/api/payments/pix", { amount: 1 }, null);
    const [corpo, assinatura] = pix.body.pix.token.split(".");
    const adulterado = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url").toString()), a: 1 })
    ).toString("base64url");
    esperarErro(
      await post(
        "/api/orders",
        pedidoValido({ payment: { methods: [{ type: "pix", pix_token: `${adulterado}.${assinatura}` }] } })
      ),
      400
    );
  });

  it("a soma dos meios diferente do total responde 400", async () => {
    esperarErro(
      await post(
        "/api/orders",
        pedidoValido({
          payment: {
            methods: [
              { type: "cartao", card_number: "4111 1111 1111 1234", amount: 1 },
              { type: "cartao", card_number: "5500 0000 0000 0004", amount: 1 },
            ],
          },
        })
      ),
      400
    );
  });

  it("mais de dois meios responde 400", async () => {
    const cartao = { type: "cartao", card_number: "4111 1111 1111 1234", amount: 1 };
    esperarErro(await post("/api/orders", pedidoValido({ payment: { methods: [cartao, cartao, cartao] } })), 400);
  });

  describe.skipIf(!podeEscrever)("compra paga (grava pedidos; o Pix exige a migracao 001)", () => {
    it.skipIf(!temExtras())("cartao + Pix: soma o total, aprova e o Pix nao pode ser reutilizado", async () => {
      const quote = await chamar(
        "POST",
        "/api/orders/quote",
        { customer_name: "Cliente Teste", store_id: alvo.lojaId, items: [{ product_id: alvo.produto.id, quantity: 1 }] },
        null
      );
      const total: number = quote.body.total;
      const parteCartao = Math.round((total / 2) * 100) / 100;
      const partePix = Math.round((total - parteCartao) * 100) / 100;
      const pix = await chamar("POST", "/api/payments/pix", { amount: partePix }, null);
      const pagamento = {
        methods: [
          { type: "cartao", card_number: "4111 1111 1111 1234", amount: parteCartao },
          { type: "pix", pix_token: pix.body.pix.token, amount: partePix },
        ],
      };

      const compra = await post("/api/orders", pedidoValido({ payment: pagamento }));
      expect(compra.status).toBe(201);
      expect(compra.body.order.payment_method).toBe("cartao+pix");
      expect(JSON.stringify(compra.body)).not.toContain("4111 1111 1111");

      esperarErro(await post("/api/orders", pedidoValido({ payment: pagamento })), 409);
      await comoGerente("POST", `/api/orders/${compra.body.order.id}/expire`);
    });
  });
});

// S3-24: reserva com prazo; vencida devolve a quantidade.
describe.skipIf(!podeEscrever)("Reserva com prazo (S3-24)", () => {
  it("o pedido novo informa ate quando a reserva vale e a rotina devolve o estoque", async () => {
    const compra = await post("/api/orders", pedidoValido());
    expect(compra.status).toBe(201);
    const limite = new Date(`${compra.body.order.reserved_until}Z`).getTime();
    const esperado = new Date(`${compra.body.order.created_at}Z`).getTime() + 48 * 3600_000;
    expect(Math.abs(limite - esperado)).toBeLessThan(60_000);

    const antes = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    const liberar = await comoGerente("POST", `/api/orders/expire-overdue?order_id=${compra.body.order.id}&hours=0`);
    expect(liberar.status).toBe(200);
    expect(liberar.body.expired.map((o: any) => o.id)).toEqual([compra.body.order.id]);
    expect(liberar.body.expired[0].status).toBe("cancelado_expirado");
    expect(liberar.body.expired[0].cancellation_reason).toContain("Reserva vencida");
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(antes + 1);
  });

  it("rodar de novo nao devolve o estoque duas vezes", async () => {
    const compra = await post("/api/orders", pedidoValido());
    const id = compra.body.order.id;
    await comoGerente("POST", `/api/orders/expire-overdue?order_id=${id}&hours=0`);
    const depoisDe1 = await consultarEstoque(alvo.lojaId, alvo.produto.id);
    const segunda = await comoGerente("POST", `/api/orders/expire-overdue?order_id=${id}&hours=0`);
    expect(segunda.body.expired).toEqual([]);
    expect(await consultarEstoque(alvo.lojaId, alvo.produto.id)).toBe(depoisDe1);
  });

  it("pedido dentro do prazo nao e liberado pela rotina normal", async () => {
    const compra = await post("/api/orders", pedidoValido());
    const id = compra.body.order.id;
    const liberar = await comoGerente("POST", `/api/orders/expire-overdue?order_id=${id}`);
    expect(liberar.status).toBe(200);
    expect(liberar.body.expired).toEqual([]);
    const { body } = await get(`/api/orders/${id}`);
    expect(body.order.status).toBe("aguardando_separacao");
    await comoGerente("POST", `/api/orders/${id}/expire`);
  });

  it("hours sem order_id responde 400", async () => {
    esperarErro(await comoGerente("POST", "/api/orders/expire-overdue?hours=0"), 400);
  });
});

// S3-25: de onde o item pode vir quando a filial nao tem.
describe("Transferencia entre filiais / CD (S3-25)", () => {
  it("GET transfer-options lista origens com estoque e novo prazo", async () => {
    const outraLoja = (await get("/api/stores")).body.stores.find((l: any) => l.id !== alvo.lojaId);
    expect(outraLoja).toBeTruthy();
    const { status, body } = await get(
      `/api/stores/${outraLoja.id}/transfer-options?product_id=${alvo.produto.id}&quantity=1`
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.options)).toBe(true);
    for (const opcao of body.options) {
      expect(opcao).toMatchObject({
        store_id: expect.any(Number),
        name: expect.any(String),
        available: expect.any(Number),
        eta_days: expect.any(Number),
      });
      expect(opcao.store_id).not.toBe(outraLoja.id);
      expect(opcao.available).toBeGreaterThanOrEqual(1);
    }
  });

  it("transfer-options sem product_id responde 400", async () => {
    esperarErro(await get("/api/stores/1/transfer-options"), 400);
  });
});

// ---- Recursos que dependem da migracao SQL 001 -----------------------------

describe.skipIf(!podeEscrever)("Com a migracao 001: janela, entrega, transferencia e auditoria", () => {
  const amanhaBrasilia = () => new Date(Date.now() - 3 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
  const criados: number[] = [];

  async function limpar() {
    for (const id of criados) await comoGerente("POST", `/api/orders/${id}/expire`);
    criados.length = 0;
  }

  // S3-22
  it.skipIf(!temExtras())("S3-22: lista as janelas do dia com capacidade e ocupacao", async () => {
    const { status, body } = await get(`/api/orders/pickup-slots?store_id=${alvo.lojaId}&date=${amanhaBrasilia()}`);
    expect(status).toBe(200);
    expect(body.slots.length).toBe(12);
    expect(body.slots[0]).toMatchObject({ used: expect.any(Number), capacity: body.capacity, past: false });
  });

  it.skipIf(!temExtras())("S3-22: janela salva no pedido, conta na ocupacao e ordena a fila", async () => {
    const dia = amanhaBrasilia();
    const antes = (await get(`/api/orders/pickup-slots?store_id=${alvo.lojaId}&date=${dia}`)).body.slots;
    const tarde = await post("/api/orders", pedidoValido({ pickup_slot: `${dia}T16:00` }));
    const cedo = await post("/api/orders", pedidoValido({ pickup_slot: `${dia}T09:00` }));
    expect(tarde.status).toBe(201);
    expect(cedo.status).toBe(201);
    criados.push(tarde.body.order.id, cedo.body.order.id);
    expect(cedo.body.order.pickup_slot).toBe(`${dia}T09:00`);

    const depois = (await get(`/api/orders/pickup-slots?store_id=${alvo.lojaId}&date=${dia}`)).body.slots;
    const uso = (lista: any[], hora: string) => lista.find((s) => s.slot === `${dia}T${hora}`).used;
    expect(uso(depois, "09:00")).toBe(uso(antes, "09:00") + 1);
    expect(uso(depois, "16:00")).toBe(uso(antes, "16:00") + 1);

    const fila = (await get(`/api/orders?store_id=${alvo.lojaId}&status=aguardando_separacao`)).body.orders;
    const posicao = (id: number) => fila.findIndex((o: any) => o.id === id);
    expect(posicao(cedo.body.order.id)).toBeLessThan(posicao(tarde.body.order.id));
    await limpar();
  });

  it.skipIf(!temExtras())("S3-22: janela no passado ou fora do horario responde 400", async () => {
    esperarErro(await post("/api/orders", pedidoValido({ pickup_slot: "2020-01-01T10:00" })), 400);
    esperarErro(await post("/api/orders", pedidoValido({ pickup_slot: `${amanhaBrasilia()}T23:00` })), 400);
    esperarErro(await post("/api/orders", pedidoValido({ pickup_slot: "amanha de manha" })), 400);
  });

  // S3-20
  it.skipIf(!temExtras())("S3-20: carrinho misto cria os dois tipos e o balcao so ve a retirada", async () => {
    const compra = await post("/api/orders/checkout", {
      customer_name: "Cliente Teste de Contrato",
      customer_cpf: CPF_TITULAR,
      store_id: alvo.lojaId,
      shipping_address: "Rua do Teste, 100 - Canoas/RS",
      items: [
        { product_id: alvo.produto.id, quantity: 1, delivery: "retirar_na_loja" },
        { product_id: alvo.produto.id, quantity: 1, delivery: "entrega_padrao" },
      ],
      card_number: "4111 1111 1111 1234",
    });
    expect(compra.status).toBe(201);
    expect(compra.body.orders).toHaveLength(2);
    const retirada = compra.body.orders.find((o: any) => o.delivery_method === "retirar_na_loja");
    const entrega = compra.body.orders.find((o: any) => o.delivery_method === "entrega_padrao");
    expect(entrega.shipping_address).toBe("Rua do Teste, 100 - Canoas/RS");
    expect(entrega.shipping_cost).toBeGreaterThan(0);
    expect(entrega.store_id).toBeNull();
    criados.push(retirada.id);

    const fila = (await get(`/api/orders?store_id=${alvo.lojaId}`)).body.orders;
    expect(fila.some((o: any) => o.id === retirada.id)).toBe(true);
    expect(fila.some((o: any) => o.id === entrega.id)).toBe(false);
    await comoGerente("POST", `/api/orders/${entrega.id}/expire`);
    await limpar();
  });

  it.skipIf(!temExtras())("S3-20: item com entrega sem endereco responde 400", async () => {
    esperarErro(
      await post("/api/orders/checkout", {
        customer_name: "Cliente Teste",
        store_id: alvo.lojaId,
        items: [{ product_id: alvo.produto.id, quantity: 1, delivery: "entrega_padrao" }],
        card_number: "4111 1111 1111 1234",
      }),
      400
    );
  });

  // S3-25
  it.skipIf(!temExtras())("S3-25: pedido registra a origem e o prazo; o estoque sai da origem", async () => {
    const lojas = (await get("/api/stores")).body.stores as any[];
    const destino = lojas.find((l) => l.id !== alvo.lojaId);
    const origemId = alvo.lojaId;
    const opcoes = (
      await get(`/api/stores/${destino.id}/transfer-options?product_id=${alvo.produto.id}&quantity=1`)
    ).body.options as any[];
    const opcao = opcoes.find((o) => o.store_id === origemId);
    expect(opcao).toBeTruthy();

    const estoqueOrigemAntes = await consultarEstoque(origemId, alvo.produto.id);
    const compra = await post("/api/orders/checkout", {
      customer_name: "Cliente Teste de Contrato",
      customer_cpf: CPF_TITULAR,
      store_id: destino.id,
      items: [{ product_id: alvo.produto.id, quantity: 1, transfer_from: origemId }],
      card_number: "4111 1111 1111 1234",
    });
    expect(compra.status).toBe(201);
    const pedido = compra.body.orders[0];
    expect(pedido.store_id).toBe(destino.id);
    expect(pedido.origin_store_id).toBe(origemId);
    expect(pedido.origin_store_name).toBeTruthy();
    expect(pedido.transfer_eta_days).toBe(opcao.eta_days);
    expect(await consultarEstoque(origemId, alvo.produto.id)).toBe(estoqueOrigemAntes - 1);

    // Cancelar devolve a unidade para a ORIGEM, nao para o destino.
    await comoGerente("POST", `/api/orders/${pedido.id}/expire`);
    expect(await consultarEstoque(origemId, alvo.produto.id)).toBe(estoqueOrigemAntes);
  });

  // S3-17
  it.skipIf(!temAuditoria())("S3-17: separar e dar baixa gravam quem fez o que, por pedido", async () => {
    const compra = await post("/api/orders", pedidoValido());
    const id = compra.body.order.id;
    const separacao = await post(`/api/orders/${id}/separate`, { barcode_or_sku: alvo.produto.sku });
    await post("/api/orders/validate-pickup", {
      pickup_code: separacao.body.order.pickup_code,
      document_checked: true,
    });

    const { status, body } = await get(`/api/orders/${id}/audit`);
    expect(status).toBe(200);
    const acoes = body.audit.map((a: any) => a.action).sort();
    expect(acoes).toEqual(["baixa_retirada", "separar_pedido"]);
    for (const linha of body.audit) {
      expect(linha).toMatchObject({
        order_id: id,
        user_email: expect.stringContaining("@"),
        user_role: "operador",
        created_at: expect.any(String),
      });
    }
  });

  it.skipIf(!temAuditoria())("S3-17: o log geral so abre para gerente/empresa", async () => {
    esperarErro(await get("/api/audit"), 403);
    const geral = await comoGerente("GET", "/api/audit?limit=5");
    expect(geral.status).toBe(200);
    expect(Array.isArray(geral.body.audit)).toBe(true);
  });
});

// Privacidade: o pedido so abre para colaborador, cliente dono ou quem tem a chave devolvida pela compra.
describe("Privacidade dos pedidos abertos", () => {
  it("sem login e sem chave nao vaza nome nem CPF (401, sem dados do cliente)", async () => {
    const resposta = await chamar("GET", "/api/orders/1", undefined, null);
    esperarErro(resposta, 401);
    expect(JSON.stringify(resposta.body)).not.toMatch(/customer_name|customer_cpf|pickup_code/);
  });

  it("chave invalida no cabecalho tambem responde 401", async () => {
    esperarErro(
      await chamar("GET", "/api/orders/1", undefined, null, { "X-Order-Token": "chave-falsa" }),
      401
    );
  });

  it.skipIf(!podeEscrever)("a compra devolve a chave e so ela (ou o colaborador) abre o pedido", async () => {
    const compra = await post("/api/orders", pedidoValido());
    expect(compra.status).toBe(201);
    const { id, access_token: chave } = compra.body.order;
    expect(chave).toEqual(expect.any(String));

    const comChave = await chamar("GET", `/api/orders/${id}`, undefined, null, { "X-Order-Token": chave });
    expect(comChave.status).toBe(200);
    expect(comChave.body.order.customer_cpf).toBe(CPF_TITULAR);
    expect(comChave.body.order.access_token).toBeUndefined();

    const notificacoes = await chamar("GET", `/api/orders/${id}/notifications`, undefined, null, { "X-Order-Token": chave });
    expect(notificacoes.status).toBe(200);

    // A chave de um pedido nao abre outro.
    esperarErro(
      await chamar("GET", `/api/orders/${id + 1}`, undefined, null, { "X-Order-Token": chave }),
      401
    );
    esperarErro(await chamar("GET", `/api/orders/${id}`, undefined, null), 401);

    // Colaborador continua vendo tudo, e a listagem nao devolve a chave.
    const comoOperador = await get(`/api/orders/${id}`);
    expect(comoOperador.status).toBe(200);
    expect(comoOperador.body.order.access_token).toBeUndefined();

    await comoGerente("POST", `/api/orders/${id}/expire`);
  });
});
