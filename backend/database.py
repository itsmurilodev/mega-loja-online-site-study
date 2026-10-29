import sqlite3

try:
    from .config import DB_PATH
except ImportError:
    from config import DB_PATH


def connect_db():
    conn = sqlite3.connect(DB_PATH)
    # row_factory permite acessar colunas pelo nome, por exemplo row["name"].
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def ensure_columns(conn):
    """
    Garante que colunas introduzidas para atender os casos de uso detalhados
    do Trabalho G2 (UC003, UC005, UC007, UC008) existam em bancos SQLite pre-existentes.
    """
    # 1. Colunas em products (sku e codigo de barras para UC005)
    existing_product_cols = {
        row["name"] for row in conn.execute("PRAGMA table_info(products)").fetchall()
    }
    if "sku" not in existing_product_cols:
        conn.execute("ALTER TABLE products ADD COLUMN sku TEXT")
    if "barcode" not in existing_product_cols:
        conn.execute("ALTER TABLE products ADD COLUMN barcode TEXT")

    # 2. Colunas em orders (pagamento, terceiro autorizado, estorno)
    existing_order_cols = {
        row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()
    }
    cols_to_add = [
        ("customer_cpf", "TEXT"),
        ("card_number_masked", "TEXT"),
        ("payment_status", "TEXT DEFAULT 'aprovado'"),
        ("third_party_name", "TEXT"),
        ("third_party_cpf", "TEXT"),
        ("discount_coupon", "TEXT"),
        ("refund_requested", "INTEGER DEFAULT 0"),
        ("cancellation_reason", "TEXT"),
    ]
    for col_name, col_type in cols_to_add:
        if col_name not in existing_order_cols:
            conn.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_type}")


def init_db():
    with connect_db() as conn:
        # Schema completo modelando os requisitos funcionais RF001 a RF007:
        # Lojas, Produtos (com SKU e Codigo de Barras), Estoque por filial,
        # Pedidos (com dados de pagamento, terceiro autorizado e estorno) e Notificacoes.
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                city TEXT NOT NULL,
                zip_code TEXT NOT NULL,
                address TEXT NOT NULL,
                capacity INTEGER NOT NULL DEFAULT 20,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                sku TEXT,
                barcode TEXT
            );

            CREATE TABLE IF NOT EXISTS inventory (
                store_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (store_id, product_id),
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                customer_cpf TEXT,
                delivery_method TEXT NOT NULL,
                store_id INTEGER,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL,
                pickup_code TEXT,
                card_number_masked TEXT,
                payment_status TEXT DEFAULT 'aprovado',
                third_party_name TEXT,
                third_party_cpf TEXT,
                discount_coupon TEXT,
                refund_requested INTEGER DEFAULT 0,
                cancellation_reason TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (store_id) REFERENCES stores(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id)
            );
            """
        )
        ensure_columns(conn)
        seed_stores(conn)
        seed_products(conn)
        seed_inventory(conn)


def seed_stores(conn):
    # Atualiza nomes legados caso o banco ja tenha sido criado anteriormente
    conn.execute(
        "UPDATE stores SET name = REPLACE(name, 'Havan ', 'MegaLoja - Filial ') WHERE name LIKE 'Havan %'"
    )

    store_count = conn.execute("SELECT COUNT(*) AS total FROM stores").fetchone()["total"]
    if store_count > 0:
        return

    # Dados iniciais para demonstrar a escolha de loja fisica (RF001).
    conn.executemany(
        """
        INSERT INTO stores (id, name, city, zip_code, address, capacity)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (1, "MegaLoja - Filial Canoas Centro", "Canoas", "92010-000", "Av. Guilherme Schell, 5000", 35),
            (2, "MegaLoja - Filial Canoas Shopping", "Canoas", "92020-000", "Av. dos Estados, 450", 25),
            (3, "MegaLoja - Filial Sao Leopoldo Bourbon", "Sao Leopoldo", "93010-000", "Av. Primeiro de Marco, 900", 20),
        ],
    )


def seed_products(conn):
    product_count = conn.execute("SELECT COUNT(*) AS total FROM products").fetchone()["total"]
    if product_count > 0:
        # Se os produtos ja existem mas sem SKU/barcode, atualiza
        conn.executemany(
            "UPDATE products SET sku = ?, barcode = ? WHERE id = ?",
            [
                ("SKU-TV-55", "789100020101", 201),
                ("SKU-SMART-5G", "789100020202", 202),
                ("SKU-FURAD-12", "789100020303", 203),
                ("SKU-MALETA-142", "789100020404", 204),
                ("SKU-GELAD-410", "789100020505", 205),
                ("SKU-SOFA-SUEDE", "789100020606", 206),
            ],
        )
        return

    # Catalogo minimo utilizado pelo prototipo com SKUs e Codigos de Barras para leitura no balcao (UC005).
    conn.executemany(
        "INSERT INTO products (id, name, category, price, sku, barcode) VALUES (?, ?, ?, ?, ?, ?)",
        [
            (201, 'Smart TV 4K Crystal UHD 55" Wi-Fi Bluetooth HDR', "eletronicos", 2549.00, "SKU-TV-55", "789100020101"),
            (202, "Smartphone Android 5G Pro 256GB Camera Tripla", "eletronicos", 1799.00, "SKU-SMART-5G", "789100020202"),
            (203, "Furadeira de Impacto Profissional Mandril 1/2 Reversivel", "casa", 389.90, "SKU-FURAD-12", "789100020303"),
            (204, "Maleta de Ferramentas Completa Aco Cromo 142 Pecas", "casa", 249.00, "SKU-MALETA-142", "789100020404"),
            (205, "Geladeira Frost Free Duplex 410L Inox Digital", "eletrodomesticos", 3899.00, "SKU-GELAD-410", "789100020505"),
            (206, "Sofa Retratil Tecido Suede", "casa", 1450.00, "SKU-SOFA-SUEDE", "789100020606"),
        ],
    )


def seed_inventory(conn):
    inventory_count = conn.execute("SELECT COUNT(*) AS total FROM inventory").fetchone()["total"]
    if inventory_count > 0:
        return

    # Cada tupla liga loja, produto e quantidade disponivel naquela unidade (UC002 - Consultar Disponibilidade).
    inventory = [
        (1, 201, 5), (2, 201, 0), (3, 201, 4),
        (1, 202, 12), (2, 202, 8), (3, 202, 0),
        (1, 203, 25), (2, 203, 14), (3, 203, 35),
        (1, 204, 0), (2, 204, 6), (3, 204, 15),
        (1, 205, 3), (2, 205, 0), (3, 205, 2),
        (1, 206, 4), (2, 206, 3), (3, 206, 0),
    ]
    conn.executemany(
        "INSERT INTO inventory (store_id, product_id, quantity) VALUES (?, ?, ?)",
        inventory,
    )
