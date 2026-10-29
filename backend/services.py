from datetime import datetime
import hashlib
import hmac
import secrets

try:
    from .config import DELIVERY_METHODS, ORDER_STATUS
    from .database import connect_db, row_to_dict
except ImportError:
    from config import DELIVERY_METHODS, ORDER_STATUS
    from database import connect_db, row_to_dict


# Chave interna para geracao de voucher autenticado (RNF003: Autenticidade do Voucher)
SECRET_TOKEN_KEY = "unilasalle-click-collect-2026-secret"


class ApiError(Exception):
    """Erro de negocio com codigo HTTP semantico."""
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def generate_pickup_code(order_id):
    """
    Gera voucher autenticado com assinatura HMAC resumida para garantir
    unicidade e evitar falsificacoes na baixa presencial (RNF003).
    Formato amigavel: HV-[ID]-XXXX-XXXX
    """
    salt = secrets.token_hex(4).upper()
    signature = hmac.new(
        SECRET_TOKEN_KEY.encode("utf-8"),
        f"{order_id}-{salt}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:4].upper()
    return f"HV-{str(order_id).zfill(4)}-{salt[:4]}-{signature}"


def generate_discount_coupon():
    """Gera cupom promocional de 5% para a loja fisica pos-retirada (UC007 passo 8)."""
    return f"CLICK5-{secrets.token_hex(3).upper()}"


def create_notification(conn, order_id, message):
    conn.execute(
        "INSERT INTO notifications (order_id, message, created_at) VALUES (?, ?, ?)",
        (order_id, message, now_iso()),
    )


def get_order(conn, order_id):
    """Recupera a visao completa do pedido com detalhes do produto e filial."""
    return conn.execute(
        """
        SELECT
            o.id,
            o.customer_name,
            o.customer_cpf,
            o.delivery_method,
            o.quantity,
            o.status,
            o.pickup_code,
            o.card_number_masked,
            o.payment_status,
            o.third_party_name,
            o.third_party_cpf,
            o.discount_coupon,
            o.refund_requested,
            o.cancellation_reason,
            o.created_at,
            o.updated_at,
            p.id AS product_id,
            p.name AS product_name,
            p.category AS product_category,
            p.price AS product_price,
            p.sku AS product_sku,
            p.barcode AS product_barcode,
            s.id AS store_id,
            s.name AS store_name,
            s.address AS store_address,
            s.city AS store_city
        FROM orders o
        JOIN products p ON p.id = o.product_id
        LEFT JOIN stores s ON s.id = o.store_id
        WHERE o.id = ?
        """,
        (order_id,),
    ).fetchone()


# ==============================================================================
# INTEGRACAO COM SISTEMAS EXTERNOS (PADRAO BCE DO DIAGRAMA DE SEQUENCIA DO G2)
# ==============================================================================

class OperadoraCartaoService:
    """
    Ator 4 (Sistema Externo): Operadora de Cartao
    Responsavel por processar a cobranca financeira em tempo real (RF003).
    Permite validar tanto o fluxo basico quanto o fluxo alternativo 5.1.5.2 (Pagamento recusado).
    """
    @staticmethod
    def processar_pagamento(cartao_numero, simular_recusa=False):
        if not cartao_numero or len(str(cartao_numero).replace(" ", "")) < 13:
            raise ApiError(400, "Dados do cartao de credito invalidos.")

        num_limpo = str(cartao_numero).replace(" ", "")
        # Simula recusa se solicitado explicitamente ou se terminar em '0000'
        if simular_recusa or num_limpo.endswith("0000"):
            raise ApiError(
                402,
                "Transacao recusada pela operadora de cartao. Por favor, utilize outra forma de pagamento."
            )

        # Mascara o cartao para seguranca (RNF002: Criptografia e dados sensiveis)
        mascarado = f"•••• •••• •••• {num_limpo[-4:]}"
        return {
            "status": "aprovado",
            "card_masked": mascarado,
            "transacao_id": f"TX-{secrets.token_hex(6).upper()}",
        }


class SistemaEstoqueService:
    """
    Ator 3 (Sistema Externo / Entidade): Sistema de Estoque (S.E.)
    Monitora a disponibilidade por loja fisica em tempo real (UC002) e efetua reserva e baixa.
    """
    @staticmethod
    def consultar_disponibilidade(conn, store_id, product_id, quantity):
        stock = conn.execute(
            "SELECT quantity FROM inventory WHERE store_id = ? AND product_id = ?",
            (store_id, product_id),
        ).fetchone()
        available = stock["quantity"] if stock else 0
        return available >= quantity, available

    @staticmethod
    def reservar_estoque(conn, store_id, product_id, quantity):
        conn.execute(
            """
            UPDATE inventory
            SET quantity = quantity - ?
            WHERE store_id = ? AND product_id = ?
            """,
            (quantity, store_id, product_id),
        )

    @staticmethod
    def devolver_estoque(conn, store_id, product_id, quantity):
        conn.execute(
            """
            UPDATE inventory
            SET quantity = quantity + ?
            WHERE store_id = ? AND product_id = ?
            """,
            (quantity, store_id, product_id),
        )

    @staticmethod
    def registrar_ruptura_fisica(conn, store_id, product_id):
        # Na ruptura (UC008), o produto fisico nao existe na filial. Zera o estoque.
        conn.execute(
            """
            UPDATE inventory
            SET quantity = 0
            WHERE store_id = ? AND product_id = ?
            """,
            (store_id, product_id),
        )


# ==============================================================================
# CONSULTAS DE APOIO (LOJAS E PRODUTOS)
# ==============================================================================

def list_stores(city=None, product_id=None):
    sql = """
        SELECT s.id, s.name, s.city, s.zip_code, s.address, s.capacity, s.active
        FROM stores s
        WHERE s.active = 1
    """
    params = []

    if city:
        sql += " AND lower(s.city) LIKE lower(?)"
        params.append(f"%{city}%")

    if product_id:
        sql = """
            SELECT
                s.id, s.name, s.city, s.zip_code, s.address, s.capacity, s.active,
                COALESCE(i.quantity, 0) AS stock
            FROM stores s
            LEFT JOIN inventory i ON i.store_id = s.id AND i.product_id = ?
            WHERE s.active = 1
        """
        params = [product_id]
        if city:
            sql += " AND lower(s.city) LIKE lower(?)"
            params.append(f"%{city}%")

    with connect_db() as conn:
        rows = conn.execute(sql + " ORDER BY s.city, s.name", params).fetchall()
        return [row_to_dict(row) for row in rows]


def list_products(store_id=None):
    if store_id:
        sql = """
            SELECT p.id, p.name, p.category, p.price, p.sku, p.barcode,
                   COALESCE(i.quantity, 0) AS stock
            FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id AND i.store_id = ?
            ORDER BY p.name
        """
        params = [store_id]
    else:
        sql = "SELECT id, name, category, price, sku, barcode FROM products ORDER BY name"
        params = []

    with connect_db() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [row_to_dict(row) for row in rows]


def list_orders(store_id=None, status=None):
    sql = """
        SELECT o.id, o.customer_name, o.customer_cpf, o.delivery_method, o.store_id,
               o.product_id, o.quantity, o.status, o.pickup_code, o.third_party_name,
               o.third_party_cpf, o.discount_coupon, o.refund_requested, o.cancellation_reason,
               o.created_at, o.updated_at,
               p.name AS product_name, p.sku AS product_sku, p.barcode AS product_barcode,
               s.name AS store_name
        FROM orders o
        JOIN products p ON p.id = o.product_id
        LEFT JOIN stores s ON s.id = o.store_id
        WHERE 1=1
    """
    params = []
    if store_id:
        sql += " AND o.store_id = ?"
        params.append(store_id)
    if status:
        sql += " AND o.status = ?"
        params.append(status)

    sql += " ORDER BY o.id DESC"

    with connect_db() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [row_to_dict(row) for row in rows]


def find_order(order_id):
    with connect_db() as conn:
        order = get_order(conn, order_id)
        if not order:
            raise ApiError(404, "Pedido nao encontrado.")
        return row_to_dict(order)


def list_notifications(order_id):
    with connect_db() as conn:
        order = get_order(conn, order_id)
        if not order:
            raise ApiError(404, "Pedido nao encontrado.")

        rows = conn.execute(
            """
            SELECT id, order_id, message, created_at
            FROM notifications
            WHERE order_id = ?
            ORDER BY id
            """,
            (order_id,),
        ).fetchall()
        return [row_to_dict(row) for row in rows]


# ==============================================================================
# CASOS DE USO PRINCIPAIS DA SPRINT (UC003, UC005, UC007, UC008)
# ==============================================================================

def create_order(payload):
    """
    UC003 - Finalizar Compra (Orquestrado pelo ControladorPedido via padrao BCE):
    1. Valida entrada (titular, terceiro opcional, filial, item).
    2. Invoca obrigatoriamente UC002 - Consultar Disponibilidade junto ao Sistema de Estoque.
    3. Aplica frete gratis (R$ 0,00).
    4. Processa cobranca com a Operadora de Cartao (RF003).
    5. Reserva o item no estoque da filial e gera pedido com status 'aguardando_separacao'.
    6. Dispara UC004 - Notificar Nova Venda.
    """
    customer_name = str(payload.get("customer_name", "Cliente MegaLoja")).strip()
    customer_cpf = str(payload.get("customer_cpf", "000.000.000-00")).strip()
    delivery_method = payload.get("delivery_method", "retirar_na_loja")
    store_id = payload.get("store_id")
    product_id = payload.get("product_id")
    quantity = int(payload.get("quantity", 1))

    card_number = payload.get("card_number", "4111 1111 1111 1234")
    simulate_payment_failure = bool(payload.get("simulate_payment_failure", False))

    third_party_name = payload.get("third_party_name")
    third_party_cpf = payload.get("third_party_cpf")

    if not customer_name:
        raise ApiError(400, "Informe o nome do cliente.")
    if delivery_method not in DELIVERY_METHODS:
        raise ApiError(400, "delivery_method deve ser 'retirar_na_loja' ou 'entrega_padrao'.")
    if not product_id:
        raise ApiError(400, "Informe o product_id.")
    if quantity < 1:
        raise ApiError(400, "A quantidade deve ser maior que zero.")

    if delivery_method == "retirar_na_loja" and not store_id:
        raise ApiError(400, "A selecao de filial fisica e obrigatoria para retirada na loja.")

    with connect_db() as conn:
        product = conn.execute("SELECT id, name, price FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            raise ApiError(404, "Produto nao encontrado no catalogo.")

        store_name = "Envio Domiciliar"
        if delivery_method == "retirar_na_loja":
            store = conn.execute("SELECT id, name FROM stores WHERE id = ? AND active = 1", (store_id,)).fetchone()
            if not store:
                raise ApiError(404, "Filial fisica selecionada nao encontrada ou inativa.")
            store_name = store["name"]

            # UC002 - Consultar Disponibilidade de Estoque em Tempo Real
            disponivel, qtd_atual = SistemaEstoqueService.consultar_disponibilidade(conn, store_id, product_id, quantity)
            if not disponivel:
                # Fluxo Alternativo 5.1.5.1: Item indisponivel na loja selecionada
                raise ApiError(
                    409,
                    f"Item indisponivel na filial '{store_name}'. Estoque atual: {qtd_atual}. "
                    "Por favor, selecione outra filial ou altere para entrega domiciliar."
                )

        # RF003 / Fluxo Basico passo 6: Processamento de pagamento junto a Operadora de Cartao
        pagamento = OperadoraCartaoService.processar_pagamento(card_number, simular_recusa=simulate_payment_failure)

        # Status inicial obrigatorio do G2: 'aguardando_separacao'
        initial_status = "aguardando_separacao"
        timestamp = now_iso()

        cursor = conn.execute(
            """
            INSERT INTO orders (
                customer_name, customer_cpf, delivery_method, store_id, product_id, quantity,
                status, pickup_code, card_number_masked, payment_status,
                third_party_name, third_party_cpf, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
            """,
            (
                customer_name,
                customer_cpf,
                delivery_method,
                store_id,
                product_id,
                quantity,
                initial_status,
                pagamento["card_masked"],
                "aprovado",
                third_party_name.strip() if third_party_name else None,
                third_party_cpf.strip() if third_party_cpf else None,
                timestamp,
                timestamp,
            ),
        )
        order_id = cursor.lastrowid

        # Reserva de estoque na filial
        if delivery_method == "retirar_na_loja":
            SistemaEstoqueService.reservar_estoque(conn, store_id, product_id, quantity)
            # UC004 - Notificar Nova Venda para o operador da filial
            create_notification(
                conn,
                order_id,
                f"Pedido #{order_id} confirmado com frete R$0,00. Aguardando separacao física na filial {store_name}."
            )
        else:
            create_notification(conn, order_id, f"Pedido #{order_id} recebido para entrega domiciliar.")

        return row_to_dict(get_order(conn, order_id))


def separate_order(order_id, payload):
    """
    UC005 - Separar Pedido (Ator: Operador da Loja / Perfil Retaguarda):
    1. Operador coleta o item na prateleira fisica.
    2. Valida codigo de barras ou SKU digitado manualmente (Fluxo 5.2.5.2).
    3. Embala o pacote e atualiza o status para 'pronto_retirada'.
    4. Gera automaticamente o QR Code unico de retirada e envia a notificacao ao cliente (UC006).
    """
    barcode_or_sku = str(payload.get("barcode_or_sku", "")).strip()

    with connect_db() as conn:
        order = get_order(conn, order_id)
        if not order:
            raise ApiError(404, "Pedido nao encontrado.")

        if order["status"] not in ("aguardando_separacao", "aguardando_preparacao"):
            raise ApiError(400, f"O pedido nao esta aguardando separacao (status atual: {order['status']}).")

        # Validacao de leitura de codigo de barras ou SKU (RF005 / Fluxo 5.2.4 passo 4 e Fluxo 5.2.5.2)
        esperado_sku = (order["product_sku"] or "").strip().upper()
        esperado_barcode = (order["product_barcode"] or "").strip()
        informado = barcode_or_sku.upper()

        if informado and (informado not in (esperado_sku, esperado_barcode)):
            raise ApiError(
                400,
                f"Conferencia invalida! O codigo informado '{informado}' nao corresponde ao produto solicitado "
                f"(SKU: {esperado_sku} / Codigo de Barras: {esperado_barcode})."
            )

        # Gera voucher/QR Code unico de retirada autenticado (UC006 / RNF003)
        pickup_code = generate_pickup_code(order_id)
        timestamp = now_iso()

        conn.execute(
            """
            UPDATE orders
            SET status = 'pronto_retirada',
                pickup_code = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (pickup_code, timestamp, order_id),
        )

        create_notification(
            conn,
            order_id,
            f"Separacao fisica concluida! Pedido pronto para retirada na filial {order['store_name']}. "
            f"Voucher digital liberado: {pickup_code}."
        )

        return row_to_dict(get_order(conn, order_id))


def register_ruptura(order_id, payload):
    """
    UC008 - Registrar Ruptura (Falta de Item) (Ponto de Extensao de UC005):
    Disparado quando o operador nao localiza o item fisico na prateleira (Fluxo 5.2.5.1 / RF006).
    - Cancela o pedido com status 'cancelado_ruptura'.
    - Registra solicitacao de estorno financeiro imediato junto a operadora de cartao.
    - Atualiza o estoque da filial para 0 para impedir novas vendas indevidas.
    """
    reason = str(payload.get("reason", "Ruptura de estoque identificada na prateleira fisica.")).strip()

    with connect_db() as conn:
        order = get_order(conn, order_id)
        if not order:
            raise ApiError(404, "Pedido nao encontrado.")

        if order["status"] in ("entregue_cliente", "retirado", "cancelado_ruptura", "cancelado_expirado", "cancelado"):
            raise ApiError(409, f"Pedido ja esta encerrado com status '{order['status']}'.")

        timestamp = now_iso()
        conn.execute(
            """
            UPDATE orders
            SET status = 'cancelado_ruptura',
                refund_requested = 1,
                cancellation_reason = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (reason, timestamp, order_id),
        )

        # Corrige a inconsistencia de estoque fisico na filial
        if order["store_id"] and order["product_id"]:
            SistemaEstoqueService.registrar_ruptura_fisica(conn, order["store_id"], order["product_id"])

        create_notification(
            conn,
            order_id,
            f"UC008: Ruptura de estoque confirmada na filial. Pedido cancelado e estorno financeiro "
            f"de R$ {order['product_price'] * order['quantity']:.2f} solicitado a operadora."
        )

        return row_to_dict(get_order(conn, order_id))


def validate_pickup(payload):
    """
    UC007 - Validar Retirada (Ator: Operador da Loja / Atendente):
    1. Escaneia QR Code ou executa busca manual por CPF e numero do pedido (Fluxo 5.3.5.2).
    2. Confere a documentacao fisica com o titular ou Terceiro Autorizado (Fluxo 5.3.5.1).
    3. Confirma a validacao presencial no sistema e registra baixa com status 'entregue_cliente'.
    4. Envia confirmacao de entrega e disponibiliza cupom de 5% de desconto para compras na loja fisica (Passo 8).
    """
    order_id = payload.get("order_id")
    pickup_code = (payload.get("pickup_code") or "").strip()
    cpf_busca = (payload.get("cpf") or "").strip()
    is_third_party = bool(payload.get("is_third_party", False))
    document_checked = bool(payload.get("document_checked", False))

    with connect_db() as conn:
        order = None

        # 1. Busca por ID do pedido
        if order_id:
            order = get_order(conn, order_id)

        # 2. Busca por Voucher / QR Code unico
        elif pickup_code:
            row = conn.execute("SELECT id FROM orders WHERE pickup_code = ?", (pickup_code,)).fetchone()
            if row:
                order = get_order(conn, row["id"])

        # 3. Busca manual de contingencia por CPF (Fluxo 5.3.5.2)
        elif cpf_busca:
            row = conn.execute(
                """
                SELECT id FROM orders
                WHERE (customer_cpf = ? OR third_party_cpf = ?)
                  AND status = 'pronto_retirada'
                ORDER BY id DESC LIMIT 1
                """,
                (cpf_busca, cpf_busca),
            ).fetchone()
            if row:
                order = get_order(conn, row["id"])

        if not order:
            raise ApiError(404, "Pedido nao localizado para os dados informados.")

        # Valida se o status permite retirada
        if order["status"] != "pronto_retirada":
            if order["status"] in ("entregue_cliente", "retirado"):
                raise ApiError(409, "Este pedido ja foi entregue anteriormente (duplicidade de baixa prevenida).")
            elif order["status"] in ("cancelado_ruptura", "cancelado_expirado", "cancelado"):
                raise ApiError(409, f"Pedido cancelado ({order['cancellation_reason'] or 'Cancelado'}). Retirada nao permitida.")
            else:
                raise ApiError(400, f"O pedido ainda nao esta pronto para retirada (status: {order['status']}).")

        # Conferencia de documento (Fluxo 5.3.4 passo 4 e Fluxo 5.3.5.1)
        if not document_checked:
            raise ApiError(400, "E obrigatorio conferir o documento fisico (CPF e foto) antes de confirmar a entrega.")

        if is_third_party:
            if not order["third_party_name"] or not order["third_party_cpf"]:
                raise ApiError(403, "Nao ha terceiro autorizado cadastrado para este pedido.")

        # Passo 6 & 8: Baixa final da entrega e emissao do cupom de 5% de desconto
        coupon = generate_discount_coupon()
        timestamp = now_iso()

        conn.execute(
            """
            UPDATE orders
            SET status = 'entregue_cliente',
                discount_coupon = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (coupon, timestamp, order["id"]),
        )

        quem_retirou = f"Terceiro autorizado ({order['third_party_name']})" if is_third_party else f"Titular ({order['customer_name']})"
        create_notification(
            conn,
            order["id"],
            f"Entrega presencial confirmada para {quem_retirou}. Cupom de 5% para a loja fisica: {coupon}."
        )

        return row_to_dict(get_order(conn, order["id"]))


def expire_abandoned_order(order_id):
    """
    Regra de Abandono (7 dias): Cancela pedido nao retirado e devolve estoque a filial.
    """
    with connect_db() as conn:
        order = get_order(conn, order_id)
        if not order:
            raise ApiError(404, "Pedido nao encontrado.")

        if order["status"] in ("entregue_cliente", "retirado", "cancelado_ruptura", "cancelado_expirado"):
            raise ApiError(409, "Pedido ja esta encerrado.")

        timestamp = now_iso()
        conn.execute(
            """
            UPDATE orders
            SET status = 'cancelado_expirado',
                cancellation_reason = 'Prazo limite de comparecimento de 7 dias expirado.',
                refund_requested = 1,
                updated_at = ?
            WHERE id = ?
            """,
            (timestamp, order_id),
        )

        if order["store_id"] and order["product_id"]:
            SistemaEstoqueService.devolver_estoque(conn, order["store_id"], order["product_id"], order["quantity"])

        create_notification(
            conn,
            order_id,
            "Pedido expirado por nao-comparecimento (7 dias). Item devolvido a prateleira e estorno acionado."
        )

        return row_to_dict(get_order(conn, order_id))


def update_order_status(order_id, payload):
    """Metodo de transicao generica para manter compatibilidade com versoes anteriores."""
    new_status = payload.get("status")

    status_aliases = {
        "aguardando_preparacao": "aguardando_separacao",
        "retirado": "entregue_cliente",
        "cancelado": "cancelado_expirado",
    }
    normalized_status = status_aliases.get(new_status, new_status)

    if normalized_status == "pronto_retirada":
        return separate_order(order_id, payload)
    elif normalized_status == "cancelado_ruptura":
        return register_ruptura(order_id, payload)
    elif normalized_status == "entregue_cliente":
        return validate_pickup({
            "order_id": order_id,
            "pickup_code": payload.get("pickup_code"),
            "document_checked": True,
            "is_third_party": bool(payload.get("is_third_party", False))
        })
    elif normalized_status == "cancelado_expirado":
        return expire_abandoned_order(order_id)
    else:
        with connect_db() as conn:
            conn.execute(
                "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
                (normalized_status, now_iso(), order_id),
            )
            return row_to_dict(get_order(conn, order_id))
