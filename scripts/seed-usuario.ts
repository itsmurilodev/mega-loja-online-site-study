/**
 * Cria (ou atualiza) um usuário no Supabase Auth com um papel.
 * Serve para criar o operador e a empresa que entram em /operador
 * (o cadastro público da loja só cria contas de cliente).
 *
 * Uso (PowerShell):
 *   $env:SEED_EMAIL="operador@megaloja.com"; $env:SEED_PASSWORD="troque-esta-senha"
 *   $env:SEED_ROLE="operador"; $env:SEED_NAME="Operador Canoas"; npm run seed:usuario
 *
 * Papéis: operador | gerente | empresa | cliente. Precisa de SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY no .env. A senha vem só do ambiente: nada fica no código.
 */
import { createClient } from "@supabase/supabase-js";
import "../backend/src/common/constants"; // carrega o .env

const ROLES = ["operador", "gerente", "empresa", "cliente"];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = (process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "";
  const role = (process.env.SEED_ROLE ?? "operador").trim();
  const name = (process.env.SEED_NAME ?? email.split("@")[0]).trim();

  if (!url || !serviceKey) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
  }
  if (!email || password.length < 6) {
    throw new Error("Informe SEED_EMAIL e SEED_PASSWORD (mínimo 6 caracteres).");
  }
  if (!ROLES.includes(role)) {
    throw new Error(`SEED_ROLE deve ser um destes: ${ROLES.join(", ")}.`);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: { ...existing.user_metadata, name },
      app_metadata: { ...existing.app_metadata, role },
    });
    if (error) throw error;
    console.log(`Usuário ${email} atualizado com o papel '${role}'.`);
    return;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role },
  });
  if (error) throw error;
  console.log(`Usuário ${email} criado com o papel '${role}'.`);
}

main().catch((err) => {
  console.error("Falha:", err.message ?? err);
  process.exit(1);
});
