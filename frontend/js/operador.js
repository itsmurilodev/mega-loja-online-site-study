// Portal do colaborador (operador.html), rota /operador.
// Sessão própria (sessionStorage), separada da loja do cliente.
// Depende de js/common.js.

const CHAVE_SESSAO_OP = 'megaloja_op_sessao';
const CHAVE_FILIAL_OP = 'megaloja_op_filial';
const PAPEIS_PORTAL = ['operador', 'empresa'];

let sessaoOp = lerStorage(sessionStorage, CHAVE_SESSAO_OP, null); // { access_token, user }
let lojas = [];
let filialId = null;
let pedidos = [];
let produtos = [];
let abaAtiva = 'separacao';
let pedidoSeparacao = null;
let pedidoRetirada = null;
let produtoEmEdicao = null;
let timerFila = null;

const apiFetch = criarApiFetch({
    getToken: () => (sessaoOp ? sessaoOp.access_token : null),
    aoNaoAutorizado: (status, mensagem) => {
        encerrarSessao(status === 401
            ? 'Sua sessão expirou. Entre novamente.'
            : (mensagem || 'Seu perfil não tem permissão para esta operação.'));
    },
});

// ---------------------------------------------------------------------------
// Entrada: login x portal
// ---------------------------------------------------------------------------
window.addEventListener('load', async () => {
    document.getElementById('form-login').addEventListener('submit', entrar);
    document.getElementById('form-produto').addEventListener('submit', salvarProduto);
    document.querySelectorAll('.aba-btn').forEach((btn) => {
        btn.addEventListener('click', () => mudarAba(btn.dataset.aba));
    });
    document.getElementById('input-leitor-sku').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') concluirSeparacao();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') fecharFormularioProduto();
    });

    if (!sessaoOp) {
        mostrarLogin();
        return;
    }
    // Confere o token com o servidor antes de mostrar o painel.
    try {
        const { user } = await apiFetch('/api/auth/me');
        if (!PAPEIS_PORTAL.includes(user.role)) throw new Error('Perfil sem acesso ao portal.');
        sessaoOp.user = user;
        await abrirPortal();
    } catch (err) {
        encerrarSessao();
    }
});

function mostrarLogin(mensagem) {
    clearInterval(timerFila);
    document.getElementById('tela-portal').classList.add('hidden');
    document.getElementById('tela-login').classList.remove('hidden');
    document.getElementById('op-senha').value = '';
    const erro = document.getElementById('erro-login');
    if (mensagem) {
        erro.textContent = mensagem;
        erro.classList.remove('hidden');
    } else {
        erro.classList.add('hidden');
    }
    document.getElementById('op-email').focus();
}

async function entrar(event) {
    event.preventDefault();
    const email = document.getElementById('op-email').value.trim();
    const senha = document.getElementById('op-senha').value;
    const erro = document.getElementById('erro-login');
    const botao = document.getElementById('btn-login');

    if (!email || !senha) {
        erro.textContent = 'Informe e-mail e senha.';
        erro.classList.remove('hidden');
        return;
    }

    botao.disabled = true;
    try {
        const payload = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password: senha, portal: 'operador' }),
        });
        if (!PAPEIS_PORTAL.includes(payload.user.role)) {
            throw new Error('Esta conta não tem acesso ao portal do colaborador.');
        }
        sessaoOp = { access_token: payload.access_token, user: payload.user };
        gravarStorage(sessionStorage, CHAVE_SESSAO_OP, sessaoOp);
        erro.classList.add('hidden');
        await abrirPortal();
    } catch (err) {
        erro.textContent = err.message;
        erro.classList.remove('hidden');
    } finally {
        botao.disabled = false;
    }
}

function encerrarSessao(mensagem) {
    sessaoOp = null;
    gravarStorage(sessionStorage, CHAVE_SESSAO_OP, null);
    pedidos = [];
    produtos = [];
    mostrarLogin(mensagem);
}

function sair() {
    encerrarSessao();
    triggerToast('Sessão encerrada', 'Você saiu do portal.', 'warning');
}

async function abrirPortal() {
    const { user } = sessaoOp;
    document.getElementById('tela-login').classList.add('hidden');
    document.getElementById('tela-portal').classList.remove('hidden');
    document.getElementById('txt-usuario-nome').textContent = user.name;
    document.getElementById('txt-usuario-email').textContent = user.email;
    document.getElementById('txt-perfil').textContent =
        user.role === 'empresa' ? 'Perfil: Empresa (gestão)' : 'Perfil: Operador de balcão';
    document.getElementById('aba-btn-produtos').classList.toggle('hidden', user.role !== 'empresa');

    try {
        lojas = (await apiFetch('/api/stores')).stores;
    } catch (err) {
        triggerToast('Servidor indisponível', err.message, 'warning');
        lojas = [];
    }
    const select = document.getElementById('select-filial');
    select.replaceChildren();
    lojas.forEach((l) => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name.replace('MegaLoja - ', '');
        opt.className = 'text-slate-900';
        select.appendChild(opt);
    });
    const salva = Number(lerStorage(sessionStorage, CHAVE_FILIAL_OP, 0));
    filialId = lojas.find((l) => l.id === salva)?.id ?? lojas[0]?.id ?? null;
    select.value = filialId;

    mudarAba('separacao');
    await recarregarPedidos();
    clearInterval(timerFila);
    timerFila = setInterval(() => {
        if (['separacao', 'retirada', 'pedidos'].includes(abaAtiva)) recarregarPedidos(true);
    }, 30000);
}

async function trocarFilial() {
    filialId = Number(document.getElementById('select-filial').value);
    gravarStorage(sessionStorage, CHAVE_FILIAL_OP, filialId);
    pedidoRetirada = null;
    atualizarConferenciaRetirada();
    await recarregarPedidos();
}

function mudarAba(aba) {
    if (aba === 'produtos' && sessaoOp?.user.role !== 'empresa') return;
    abaAtiva = aba;
    ['separacao', 'retirada', 'pedidos', 'produtos'].forEach((nome) => {
        document.getElementById(`aba-${nome}`).classList.toggle('hidden', nome !== aba);
    });
    document.querySelectorAll('.aba-btn').forEach((btn) => {
        btn.className = `aba-btn px-4 py-2 rounded-lg whitespace-nowrap ${btn.dataset.aba === aba
            ? 'bg-amber-400 text-slate-950'
            : 'text-slate-300 hover:bg-slate-700'} ${btn.id === 'aba-btn-produtos' && sessaoOp?.user.role !== 'empresa' ? 'hidden' : ''}`;
    });
    if (aba === 'produtos') carregarProdutos();
}

// ---------------------------------------------------------------------------
// Pedidos da filial
// ---------------------------------------------------------------------------
async function recarregarPedidos(silencioso = false) {
    if (!filialId) return;
    try {
        const resp = await apiFetch(`/api/orders?store_id=${filialId}`);
        pedidos = resp.orders || [];
    } catch (err) {
        if (!silencioso) triggerToast('Não foi possível carregar os pedidos', err.message, 'warning');
        return;
    }

    const pendentes = pedidos.filter((p) => ['aguardando_separacao', 'aguardando_preparacao'].includes(p.status));
    const prontos = pedidos.filter((p) => p.status === 'pronto_retirada');
    document.getElementById('cnt-separacao').textContent = pendentes.length;
    document.getElementById('cnt-retirada').textContent = prontos.length;

    // Fila de separação: mais antigos primeiro.
    const fila = [...pendentes].sort((a, b) => a.id - b.id);
    const select = document.getElementById('select-pedido-separacao');
    const anterior = pedidoSeparacao?.id;
    select.replaceChildren();
    if (fila.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Nenhum pedido aguardando separação nesta filial';
        select.appendChild(opt);
    }
    fila.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `Pedido #${String(p.id).padStart(4, '0')} • ${p.product_name} (${p.quantity} un.)`;
        select.appendChild(opt);
    });
    if (anterior && fila.some((p) => p.id === anterior)) select.value = anterior;
    selecionarPedidoParaSeparar();
    renderizarTabelaPedidos();
}

function renderizarTabelaPedidos() {
    const filtro = document.getElementById('filtro-status').value;
    const lista = pedidos.filter((p) => !filtro || p.status === filtro);
    const corpo = document.getElementById('tabela-pedidos');
    corpo.replaceChildren();
    document.getElementById('pedidos-vazio').classList.toggle('hidden', lista.length > 0);

    lista.forEach((p) => {
        const st = infoStatus(p.status);
        const linha = document.createElement('tr');
        linha.innerHTML = `
            <td class="px-4 py-3 font-mono font-bold">#${String(p.id).padStart(4, '0')}</td>
            <td class="px-4 py-3">${esc(p.customer_name)}<span class="block text-[10px] text-gray-400 font-mono">${esc(p.customer_cpf || '')}</span></td>
            <td class="px-4 py-3">${p.quantity}x ${esc(p.product_name)}</td>
            <td class="px-4 py-3"><span class="text-[10px] font-bold px-2 py-1 rounded-full border ${st.classe}">${esc(st.rotulo)}</span></td>
            <td class="px-4 py-3 text-gray-500">${esc(new Date(p.created_at + 'Z').toLocaleString('pt-BR'))}</td>`;
        corpo.appendChild(linha);
    });
}

// ---------------------------------------------------------------------------
// Separação
// ---------------------------------------------------------------------------
function selecionarPedidoParaSeparar() {
    const id = Number(document.getElementById('select-pedido-separacao').value);
    pedidoSeparacao = pedidos.find((p) => p.id === id) || null;
    const p = pedidoSeparacao;
    document.getElementById('sep-prod-nome').textContent = p ? p.product_name : 'Nenhum pedido selecionado';
    document.getElementById('sep-cliente').textContent = p ? `Cliente: ${p.customer_name}` : '---';
    document.getElementById('sep-prod-qtd').textContent = p ? `${p.quantity} un.` : '-';
    document.getElementById('sep-prod-sku').textContent = p ? (p.product_sku || '---') : '---';
    document.getElementById('sep-prod-barcode').textContent = p ? (p.product_barcode || '---') : '---';
}

async function concluirSeparacao() {
    if (!pedidoSeparacao) {
        triggerToast('Nada para separar', 'Selecione um pedido pendente.', 'warning');
        return;
    }
    const codigo = document.getElementById('input-leitor-sku').value.trim();
    if (!codigo) {
        triggerToast('Conferência obrigatória', 'Leia o código de barras ou digite o SKU do item coletado.', 'warning');
        return;
    }
    try {
        await apiFetch(`/api/orders/${pedidoSeparacao.id}/separate`, {
            method: 'POST',
            body: JSON.stringify({ barcode_or_sku: codigo }),
        });
        document.getElementById('input-leitor-sku').value = '';
        triggerToast('Separação concluída', 'QR Code liberado para o cliente.', 'success');
        await recarregarPedidos();
    } catch (err) {
        triggerToast('Conferência não confere', err.message, 'warning');
    }
}

async function registrarFalta() {
    if (!pedidoSeparacao) {
        triggerToast('Nada selecionado', 'Selecione o pedido com item em falta.', 'warning');
        return;
    }
    const motivo = prompt('Descreva a falta do item na prateleira:', 'Item não encontrado na prateleira');
    if (!motivo) return;
    if (!confirm(`Cancelar o pedido #${pedidoSeparacao.id}, zerar o estoque de "${pedidoSeparacao.product_name}" nesta filial e solicitar o estorno?`)) return;
    try {
        await apiFetch(`/api/orders/${pedidoSeparacao.id}/rupture`, {
            method: 'POST',
            body: JSON.stringify({ reason: motivo }),
        });
        triggerToast('Falta registrada', 'Pedido cancelado e estorno solicitado ao cartão.', 'warning');
        await recarregarPedidos();
    } catch (err) {
        triggerToast('Não foi possível registrar', err.message, 'warning');
    }
}

// ---------------------------------------------------------------------------
// Retirada
// ---------------------------------------------------------------------------
function localizarPedidoRetirada(modo) {
    let encontrado = null;
    const prontos = pedidos.filter((p) => p.status === 'pronto_retirada');

    if (modo === 'voucher') {
        const voucher = document.getElementById('input-busca-voucher').value.trim().toUpperCase();
        if (!voucher) {
            triggerToast('Campo vazio', 'Informe o código do QR Code.', 'warning');
            return;
        }
        encontrado = prontos.find((p) => (p.pickup_code || '').toUpperCase() === voucher);
    } else {
        const termo = document.getElementById('input-busca-cpf').value.trim();
        if (!termo) {
            triggerToast('Campo vazio', 'Informe o CPF ou o número do pedido.', 'warning');
            return;
        }
        const digitos = termo.replace(/\D/g, '');
        const numero = /^#?\d{1,6}$/.test(termo) ? Number(termo.replace('#', '')) : null;
        encontrado = prontos.find((p) =>
            (numero !== null && p.id === numero)
            || (digitos.length >= 11 && ((p.customer_cpf || '').replace(/\D/g, '') === digitos
                || (p.third_party_cpf || '').replace(/\D/g, '') === digitos)));
    }

    pedidoRetirada = encontrado || null;
    atualizarConferenciaRetirada();
    if (encontrado) {
        triggerToast('Pedido localizado', `Pedido #${encontrado.id} pronto. Confira o documento.`, 'success');
    } else {
        triggerToast('Não localizado', 'Nenhum pedido pronto para retirada nesta filial com esses dados.', 'warning');
    }
}

function atualizarConferenciaRetirada() {
    const p = pedidoRetirada;
    const alerta = document.getElementById('alerta-terceiro-balcao');
    document.getElementById('chk-doc-conferido').checked = false;

    if (!p) {
        document.getElementById('ret-pedido-id').textContent = 'Nenhum pedido localizado';
        document.getElementById('ret-titular-dados').textContent = 'Titular: ---';
        alerta.classList.add('hidden');
        return;
    }
    document.getElementById('ret-pedido-id').textContent = `Pedido #${String(p.id).padStart(4, '0')} • ${p.quantity}x ${p.product_name}`;
    document.getElementById('ret-titular-dados').textContent = `Titular: ${p.customer_name} (CPF: ${p.customer_cpf || '---'})`;
    if (p.third_party_name) {
        alerta.classList.remove('hidden');
        document.getElementById('ret-terceiro-dados').textContent = `${p.third_party_name} — CPF: ${p.third_party_cpf}`;
    } else {
        alerta.classList.add('hidden');
    }
}

async function darBaixaRetirada() {
    if (!pedidoRetirada) {
        triggerToast('Nada localizado', 'Localize um pedido pronto antes de dar baixa.', 'warning');
        return;
    }
    if (!document.getElementById('chk-doc-conferido').checked) {
        triggerToast('Conferência obrigatória', 'Confira o documento com foto antes de confirmar a entrega.', 'warning');
        return;
    }
    try {
        await apiFetch('/api/orders/validate-pickup', {
            method: 'POST',
            body: JSON.stringify({
                order_id: pedidoRetirada.id,
                document_checked: true,
                is_third_party: Boolean(pedidoRetirada.third_party_name),
            }),
        });
        triggerToast('Entrega concluída', 'Baixa registrada com sucesso.', 'success');
        pedidoRetirada = null;
        atualizarConferenciaRetirada();
        document.getElementById('input-busca-voucher').value = '';
        document.getElementById('input-busca-cpf').value = '';
        await recarregarPedidos();
    } catch (err) {
        triggerToast('Não foi possível dar baixa', err.message, 'warning');
    }
}

async function expirarPedido() {
    if (!pedidoRetirada) {
        triggerToast('Nada localizado', 'Localize o pedido que expirou.', 'warning');
        return;
    }
    if (!confirm(`Expirar o pedido #${pedidoRetirada.id}? O item volta ao estoque e o estorno é solicitado.`)) return;
    try {
        await apiFetch(`/api/orders/${pedidoRetirada.id}/expire`, { method: 'POST' });
        triggerToast('Pedido expirado', 'Item devolvido ao estoque e estorno solicitado.', 'warning');
        pedidoRetirada = null;
        atualizarConferenciaRetirada();
        await recarregarPedidos();
    } catch (err) {
        triggerToast('Não foi possível expirar', err.message, 'warning');
    }
}

// ---------------------------------------------------------------------------
// Produtos e preços (perfil empresa)
// ---------------------------------------------------------------------------
async function carregarProdutos() {
    try {
        produtos = (await apiFetch('/api/products?include=stock')).products;
    } catch (err) {
        triggerToast('Não foi possível carregar os produtos', err.message, 'warning');
        return;
    }
    renderizarTabelaProdutos();
}

function renderizarTabelaProdutos() {
    const corpo = document.getElementById('tabela-produtos');
    corpo.replaceChildren();
    produtos.forEach((p) => {
        const estoques = lojas.map((l) =>
            `<span class="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1 mb-1 text-[10px]" title="${esc(l.name)}">${esc(l.name.replace('MegaLoja - Filial ', ''))}: <strong>${Number(p.stocks?.[l.id] ?? 0)}</strong></span>`
        ).join('');
        const linha = document.createElement('tr');
        linha.innerHTML = `
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"><img src="${esc(p.image_url || '')}" alt="" class="max-h-full max-w-full object-contain"></div>
                    <span class="font-bold text-gray-900">${esc(p.name)}</span>
                </div>
            </td>
            <td class="px-4 py-3">${esc(p.category)}</td>
            <td class="px-4 py-3 font-mono text-[11px]">${esc(p.sku || '')}</td>
            <td class="px-4 py-3 text-right font-bold">${formatarMoeda(p.price)}</td>
            <td class="px-4 py-3">${estoques}</td>
            <td class="px-4 py-3 text-right"><button type="button" class="text-blue-600 hover:underline font-bold">Editar</button></td>`;
        linha.querySelector('button').addEventListener('click', () => abrirFormularioProduto(p));
        corpo.appendChild(linha);
    });
}

function atualizarPreviaImagem() {
    const url = document.getElementById('prod-imagem').value.trim();
    const img = document.getElementById('prod-imagem-previa');
    if (/^https?:\/\//i.test(url)) {
        img.src = url;
        img.classList.remove('hidden');
    } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
    }
}

function abrirFormularioProduto(produto) {
    produtoEmEdicao = produto;
    document.getElementById('form-produto').reset();
    document.getElementById('erro-produto').classList.add('hidden');
    document.getElementById('titulo-form-produto').textContent = produto ? `Editar produto #${produto.id}` : 'Novo produto';

    const categorias = [...new Set(produtos.map((p) => p.category))];
    const datalist = document.getElementById('lista-categorias');
    datalist.replaceChildren(...categorias.map((c) => Object.assign(document.createElement('option'), { value: c })));

    document.getElementById('prod-nome').value = produto?.name ?? '';
    document.getElementById('prod-categoria').value = produto?.category ?? '';
    document.getElementById('prod-preco').value = produto ? Number(produto.price).toFixed(2).replace('.', ',') : '';
    document.getElementById('prod-sku').value = produto?.sku ?? '';
    document.getElementById('prod-barcode').value = produto?.barcode ?? '';
    document.getElementById('prod-imagem').value = produto?.image_url ?? '';
    atualizarPreviaImagem();

    const box = document.getElementById('prod-estoques');
    box.replaceChildren();
    lojas.forEach((l) => {
        const rotulo = document.createElement('label');
        rotulo.className = 'flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2';
        const texto = document.createElement('span');
        texto.className = 'text-[11px] text-gray-700 font-semibold';
        texto.textContent = l.name.replace('MegaLoja - ', '');
        const campo = document.createElement('input');
        campo.type = 'number';
        campo.min = '0';
        campo.step = '1';
        campo.dataset.loja = l.id;
        campo.value = produto ? String(produto.stocks?.[l.id] ?? 0) : '0';
        campo.className = 'w-20 px-2 py-1 border border-gray-300 rounded-lg text-right font-mono focus:outline-none focus:border-amber-500';
        campo.setAttribute('aria-label', `Estoque em ${l.name}`);
        rotulo.append(texto, campo);
        box.appendChild(rotulo);
    });

    const modal = document.getElementById('modal-produto');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('prod-nome').focus();
}

function fecharFormularioProduto() {
    const modal = document.getElementById('modal-produto');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function salvarProduto(event) {
    event.preventDefault();
    const erro = document.getElementById('erro-produto');
    const botao = document.getElementById('btn-salvar-produto');
    erro.classList.add('hidden');

    const stock = {};
    document.querySelectorAll('#prod-estoques input').forEach((campo) => {
        stock[campo.dataset.loja] = campo.value === '' ? 0 : Number(campo.value);
    });

    const corpo = {
        name: document.getElementById('prod-nome').value.trim(),
        category: document.getElementById('prod-categoria').value.trim(),
        price: document.getElementById('prod-preco').value.trim(),
        sku: document.getElementById('prod-sku').value.trim(),
        barcode: document.getElementById('prod-barcode').value.trim(),
        image_url: document.getElementById('prod-imagem').value.trim(),
        stock,
    };

    // Validação rápida no navegador (o servidor valida de novo).
    const preco = Number(corpo.price.replace(',', '.'));
    if (!corpo.name || !corpo.category || !corpo.sku) {
        erro.textContent = 'Preencha nome, categoria e SKU.';
        erro.classList.remove('hidden');
        return;
    }
    if (!Number.isFinite(preco) || preco <= 0) {
        erro.textContent = 'O preço deve ser um número maior que zero.';
        erro.classList.remove('hidden');
        return;
    }

    botao.disabled = true;
    try {
        await apiFetch(produtoEmEdicao ? `/api/products/${produtoEmEdicao.id}` : '/api/products', {
            method: produtoEmEdicao ? 'PATCH' : 'POST',
            body: JSON.stringify(corpo),
        });
        fecharFormularioProduto();
        triggerToast('Produto salvo', produtoEmEdicao ? 'Alterações aplicadas na vitrine.' : 'O produto já aparece na vitrine.', 'success');
        await carregarProdutos();
    } catch (err) {
        erro.textContent = err.message;
        erro.classList.remove('hidden');
    } finally {
        botao.disabled = false;
    }
}
