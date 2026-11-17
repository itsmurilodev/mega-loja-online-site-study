// Portal do colaborador (operador.html), rota /operador.
// Sessão própria (sessionStorage), separada da loja do cliente.
// Depende de js/common.js.

const CHAVE_SESSAO_OP = 'megaloja_op_sessao';
const CHAVE_FILIAL_OP = 'megaloja_op_filial';
const PAPEIS_PORTAL: Papel[] = ['operador', 'gerente', 'empresa'];
const ROTULOS_PERFIL: Record<Papel, string> = {
    operador: 'Perfil: Operador de balcão',
    gerente: 'Perfil: Gerente da loja',
    empresa: 'Perfil: Empresa (gestão)',
};
// S3-01: cache da fila e fila de baixas feitas sem conexão (localStorage, por navegador).
const CHAVE_CACHE_FILA = 'megaloja_op_cache_fila';
const CHAVE_FILA_OFFLINE = 'megaloja_op_fila_offline';

/** S3-16: só gerente e empresa cancelam pedido ou liberam reservas. */
function podeCancelar(): boolean {
    return ['gerente', 'empresa'].includes(sessaoOp?.user.role);
}

let sessaoOp: Sessao | null = lerStorage<Sessao | null>(sessionStorage, CHAVE_SESSAO_OP, null); // { access_token, user }
let lojas: Loja[] = [];
let filialId: number | null = null;
let pedidos: Pedido[] = [];
let produtos: Produto[] = [];
let abaAtiva: Aba = 'separacao';
let pedidoSeparacao: Pedido | null = null;
let pedidoRetirada: Pedido | null = null;
let produtoEmEdicao: Produto | null = null;
let timerFila: ReturnType<typeof setInterval> | null = null;
let modoOffline = false;
let sincronizando = false;

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
    document.querySelectorAll<HTMLElement>('.aba-btn').forEach((btn) => {
        btn.addEventListener('click', () => mudarAba(btn.dataset.aba as Aba));
    });
    document.getElementById('input-leitor-sku').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') concluirSeparacao();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            fecharFormularioProduto();
            fecharHistorico();
        }
    });

    if (!sessaoOp) {
        mostrarLogin();
        return;
    }
    // Confere o token com o servidor antes de mostrar o painel.
    try {
        const { user } = await apiFetch<{ user: Usuario }>('/api/auth/me');
        if (!PAPEIS_PORTAL.includes(user.role)) throw new Error('Perfil sem acesso ao portal.');
        sessaoOp.user = user;
        await abrirPortal();
    } catch (err) {
        encerrarSessao();
    }
});

function mostrarLogin(mensagem?: string): void {
    clearInterval(timerFila);
    document.getElementById('tela-portal').classList.add('hidden');
    document.getElementById('tela-login').classList.remove('hidden');
    (document.getElementById('op-senha') as HTMLInputElement).value = '';
    const erro = document.getElementById('erro-login');
    if (mensagem) {
        erro.textContent = mensagem;
        erro.classList.remove('hidden');
    } else {
        erro.classList.add('hidden');
    }
    document.getElementById('op-email').focus();
}

async function entrar(event: Event): Promise<void> {
    event.preventDefault();
    const email = (document.getElementById('op-email') as HTMLInputElement).value.trim();
    const senha = (document.getElementById('op-senha') as HTMLInputElement).value;
    const erro = document.getElementById('erro-login');
    const botao = document.getElementById('btn-login') as HTMLButtonElement;

    if (!email || !senha) {
        erro.textContent = 'Informe e-mail e senha.';
        erro.classList.remove('hidden');
        return;
    }

    botao.disabled = true;
    try {
        const payload = await apiFetch<Sessao>('/api/auth/login', {
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

function encerrarSessao(mensagem?: string): void {
    sessaoOp = null;
    gravarStorage(sessionStorage, CHAVE_SESSAO_OP, null);
    pedidos = [];
    produtos = [];
    mostrarLogin(mensagem);
}

function sair(): void {
    encerrarSessao();
    triggerToast('Sessão encerrada', 'Você saiu do portal.', 'warning');
}

async function abrirPortal(): Promise<void> {
    const { user } = sessaoOp;
    document.getElementById('tela-login').classList.add('hidden');
    document.getElementById('tela-portal').classList.remove('hidden');
    document.getElementById('txt-usuario-nome').textContent = user.name;
    document.getElementById('txt-usuario-email').textContent = user.email;
    document.getElementById('txt-perfil').textContent = ROTULOS_PERFIL[user.role] || 'Perfil: Colaborador';
    document.getElementById('aba-btn-produtos').classList.toggle('hidden', user.role !== 'empresa');
    document.getElementById('bloco-expirar').classList.toggle('hidden', !podeCancelar());
    document.getElementById('btn-liberar-reservas').classList.toggle('hidden', !podeCancelar());

    try {
        lojas = (await apiFetch<{ stores: Loja[] }>('/api/stores')).stores;
    } catch (err) {
        triggerToast('Servidor indisponível', err.message, 'warning');
        lojas = [];
    }
    const select = document.getElementById('select-filial') as HTMLSelectElement;
    select.replaceChildren();
    lojas.forEach((l) => {
        const opt = document.createElement('option');
        opt.value = String(l.id);
        opt.textContent = l.name.replace('MegaLoja - ', '');
        opt.className = 'text-slate-900';
        select.appendChild(opt);
    });
    const salva = Number(lerStorage(sessionStorage, CHAVE_FILIAL_OP, 0));
    filialId = lojas.find((l) => l.id === salva)?.id ?? lojas[0]?.id ?? null;
    select.value = String(filialId);

    mudarAba('separacao');
    if (!navigator.onLine) modoOffline = true;
    atualizarFaixaOffline();
    await recarregarPedidos();
    clearInterval(timerFila);
    timerFila = setInterval(async () => {
        await sincronizarFilaOffline(false);
        if (['separacao', 'retirada', 'pedidos'].includes(abaAtiva)) recarregarPedidos(true);
    }, 30000);
}

async function trocarFilial(): Promise<void> {
    filialId = Number((document.getElementById('select-filial') as HTMLSelectElement).value);
    gravarStorage(sessionStorage, CHAVE_FILIAL_OP, filialId);
    pedidoRetirada = null;
    atualizarConferenciaRetirada();
    await recarregarPedidos();
}

function mudarAba(aba: Aba): void {
    if (aba === 'produtos' && sessaoOp?.user.role !== 'empresa') return;
    abaAtiva = aba;
    ['separacao', 'retirada', 'pedidos', 'produtos'].forEach((nome) => {
        document.getElementById(`aba-${nome}`).classList.toggle('hidden', nome !== aba);
    });
    document.querySelectorAll<HTMLElement>('.aba-btn').forEach((btn) => {
        btn.className = `aba-btn px-4 py-2 rounded-lg whitespace-nowrap ${btn.dataset.aba === aba
            ? 'bg-amber-400 text-slate-950'
            : 'text-slate-300 hover:bg-slate-700'} ${btn.id === 'aba-btn-produtos' && sessaoOp?.user.role !== 'empresa' ? 'hidden' : ''}`;
    });
    if (aba === 'produtos') carregarProdutos();
}

// ---------------------------------------------------------------------------
// Pedidos da filial
// ---------------------------------------------------------------------------
async function recarregarPedidos(silencioso = false): Promise<void> {
    if (!filialId) return;
    try {
        const resp = await apiFetch<{ orders?: Pedido[] }>(`/api/orders?store_id=${filialId}`);
        pedidos = resp.orders || [];
        aplicarFilaLocal();
        gravarStorage(localStorage, CHAVE_CACHE_FILA, { filialId, pedidos, em: new Date().toISOString() });
        definirOffline(false);
    } catch (err) {
        // Sem status HTTP = sem conexão com o servidor: usa a fila guardada (S3-01).
        if (err.status === undefined && usarCacheOffline()) {
            // segue para renderizar com o cache
        } else {
            if (!silencioso) triggerToast('Não foi possível carregar os pedidos', err.message, 'warning');
            return;
        }
    }

    const pendentes = pedidos.filter((p) => ['aguardando_separacao', 'aguardando_preparacao'].includes(p.status));
    const prontos = pedidos.filter((p) => p.status === 'pronto_retirada');
    document.getElementById('cnt-separacao').textContent = String(pendentes.length);
    document.getElementById('cnt-retirada').textContent = String(prontos.length);

    // Fila de separação: mais antigos primeiro.
    // S3-22: quem marcou horário de retirada vem primeiro (mais cedo antes); depois os mais antigos.
    const fila = [...pendentes].sort((a, b) => {
        if (a.pickup_slot && b.pickup_slot) return a.pickup_slot.localeCompare(b.pickup_slot) || a.id - b.id;
        if (a.pickup_slot) return -1;
        if (b.pickup_slot) return 1;
        return a.id - b.id;
    });
    const select = document.getElementById('select-pedido-separacao') as HTMLSelectElement;
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
        opt.value = String(p.id);
        opt.textContent = `Pedido #${String(p.id).padStart(4, '0')} • ${p.product_name} (${p.quantity} un.)${p.pickup_slot ? ` • retirada ${formatarSlot(p.pickup_slot)}` : ''}`;
        select.appendChild(opt);
    });
    if (anterior && fila.some((p) => p.id === anterior)) select.value = String(anterior);
    selecionarPedidoParaSeparar();
    renderizarTabelaPedidos();
}

function renderizarTabelaPedidos(): void {
    const filtro = (document.getElementById('filtro-status') as HTMLSelectElement).value;
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
            <td class="px-4 py-3 text-[11px] text-gray-600">${descreverPrazo(p)}</td>
            <td class="px-4 py-3 text-gray-500">${esc(new Date(p.created_at + 'Z').toLocaleString('pt-BR'))}</td>
            <td class="px-4 py-3 text-right"><button type="button" class="text-blue-600 hover:underline font-bold" data-historico>Ver</button></td>`;
        linha.querySelector('[data-historico]').addEventListener('click', () => abrirHistorico(p));
        corpo.appendChild(linha);
    });
}

// ---------------------------------------------------------------------------
// Separação
// ---------------------------------------------------------------------------
function selecionarPedidoParaSeparar(): void {
    const id = Number((document.getElementById('select-pedido-separacao') as HTMLSelectElement).value);
    pedidoSeparacao = pedidos.find((p) => p.id === id) || null;
    const p = pedidoSeparacao;
    document.getElementById('sep-prod-nome').textContent = p ? p.product_name : 'Nenhum pedido selecionado';
    document.getElementById('sep-cliente').textContent = p ? `Cliente: ${p.customer_name}` : '---';
    document.getElementById('sep-prod-qtd').textContent = p ? `${p.quantity} un.` : '-';
    document.getElementById('sep-prod-sku').textContent = p ? (p.product_sku || '---') : '---';
    document.getElementById('sep-prod-barcode').textContent = p ? (p.product_barcode || '---') : '---';
    const extra = document.getElementById('sep-info-extra');
    const partes: string[] = [];
    if (p?.pickup_slot) partes.push(`Retirada marcada para ${formatarSlot(p.pickup_slot)}`);
    if (p?.origin_store_name) partes.push(`Item vem de ${p.origin_store_name} (previsão ${p.transfer_eta_days} dia(s))`);
    if (p?.reserved_until) partes.push(`Separar até ${new Date(p.reserved_until + 'Z').toLocaleString('pt-BR')}`);
    extra.textContent = partes.join(' • ');
    extra.classList.toggle('hidden', partes.length === 0);
}

async function concluirSeparacao(): Promise<void> {
    if (!pedidoSeparacao) {
        triggerToast('Nada para separar', 'Selecione um pedido pendente.', 'warning');
        return;
    }
    const codigo = (document.getElementById('input-leitor-sku') as HTMLInputElement).value.trim();
    if (!codigo) {
        triggerToast('Conferência obrigatória', 'Leia o código de barras ou digite o SKU do item coletado.', 'warning');
        return;
    }
    try {
        await apiFetch(`/api/orders/${pedidoSeparacao.id}/separate`, {
            method: 'POST',
            body: JSON.stringify({ barcode_or_sku: codigo }),
        });
        (document.getElementById('input-leitor-sku') as HTMLInputElement).value = '';
        triggerToast('Separação concluída', 'QR Code liberado para o cliente.', 'success');
        await recarregarPedidos();
    } catch (err) {
        triggerToast(err.status === undefined ? 'Sem conexão' : 'Conferência não confere', mensagemDeErro(err), 'warning');
    }
}

async function registrarFalta(): Promise<void> {
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
        triggerToast('Não foi possível registrar', mensagemDeErro(err), 'warning');
    }
}

// ---------------------------------------------------------------------------
// Retirada
// ---------------------------------------------------------------------------
function localizarPedidoRetirada(modo: string): void {
    let encontrado: Pedido | null = null;
    const prontos = pedidos.filter((p) => p.status === 'pronto_retirada');

    if (modo === 'voucher') {
        const voucher = (document.getElementById('input-busca-voucher') as HTMLInputElement).value.trim().toUpperCase();
        if (!voucher) {
            triggerToast('Campo vazio', 'Informe o código do QR Code.', 'warning');
            return;
        }
        encontrado = prontos.find((p) => (p.pickup_code || '').toUpperCase() === voucher);
    } else {
        const termo = (document.getElementById('input-busca-cpf') as HTMLInputElement).value.trim();
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

function atualizarConferenciaRetirada(): void {
    const p = pedidoRetirada;
    const alerta = document.getElementById('alerta-terceiro-balcao');
    (document.getElementById('chk-doc-conferido') as HTMLInputElement).checked = false;

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

async function darBaixaRetirada(): Promise<void> {
    if (!pedidoRetirada) {
        triggerToast('Nada localizado', 'Localize um pedido pronto antes de dar baixa.', 'warning');
        return;
    }
    if (!(document.getElementById('chk-doc-conferido') as HTMLInputElement).checked) {
        triggerToast('Conferência obrigatória', 'Confira o documento com foto antes de confirmar a entrega.', 'warning');
        return;
    }
    const corpo: CorpoBaixa = {
        order_id: pedidoRetirada.id,
        document_checked: true,
        is_third_party: Boolean(pedidoRetirada.third_party_name),
    };
    // S3-01: sem conexão, a baixa vai para a fila local e segue quando a internet voltar.
    if (modoOffline) {
        enfileirarBaixa(corpo);
        return;
    }
    try {
        await apiFetch('/api/orders/validate-pickup', {
            method: 'POST',
            body: JSON.stringify(corpo),
        });
        triggerToast('Entrega concluída', 'Baixa registrada com sucesso.', 'success');
        pedidoRetirada = null;
        atualizarConferenciaRetirada();
        (document.getElementById('input-busca-voucher') as HTMLInputElement).value = '';
        (document.getElementById('input-busca-cpf') as HTMLInputElement).value = '';
        await recarregarPedidos();
    } catch (err) {
        if (err.status === undefined) {
            definirOffline(true);
            enfileirarBaixa(corpo);
            return;
        }
        triggerToast('Não foi possível dar baixa', err.message, 'warning');
    }
}

async function expirarPedido(): Promise<void> {
    if (!podeCancelar()) {
        triggerToast('Sem permissão', 'Somente gerente ou empresa cancelam pedidos.', 'warning');
        return;
    }
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
        triggerToast('Não foi possível expirar', mensagemDeErro(err), 'warning');
    }
}

// ---------------------------------------------------------------------------
// Produtos e preços (perfil empresa)
// ---------------------------------------------------------------------------
async function carregarProdutos(): Promise<void> {
    try {
        produtos = (await apiFetch<{ products: Produto[] }>('/api/products?include=stock')).products;
    } catch (err) {
        triggerToast('Não foi possível carregar os produtos', err.message, 'warning');
        return;
    }
    renderizarTabelaProdutos();
}

function renderizarTabelaProdutos(): void {
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

function atualizarPreviaImagem(): void {
    const url = (document.getElementById('prod-imagem') as HTMLInputElement).value.trim();
    const img = document.getElementById('prod-imagem-previa') as HTMLImageElement;
    if (/^https?:\/\//i.test(url)) {
        img.src = url;
        img.classList.remove('hidden');
    } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
    }
}

function abrirFormularioProduto(produto?: Produto): void {
    produtoEmEdicao = produto;
    (document.getElementById('form-produto') as HTMLFormElement).reset();
    document.getElementById('erro-produto').classList.add('hidden');
    document.getElementById('titulo-form-produto').textContent = produto ? `Editar produto #${produto.id}` : 'Novo produto';

    const categorias = [...new Set(produtos.map((p) => p.category))];
    const datalist = document.getElementById('lista-categorias');
    datalist.replaceChildren(...categorias.map((c) => Object.assign(document.createElement('option'), { value: c })));

    (document.getElementById('prod-nome') as HTMLInputElement).value = produto?.name ?? '';
    (document.getElementById('prod-categoria') as HTMLInputElement).value = produto?.category ?? '';
    (document.getElementById('prod-preco') as HTMLInputElement).value = produto ? Number(produto.price).toFixed(2).replace('.', ',') : '';
    (document.getElementById('prod-sku') as HTMLInputElement).value = produto?.sku ?? '';
    (document.getElementById('prod-barcode') as HTMLInputElement).value = produto?.barcode ?? '';
    (document.getElementById('prod-imagem') as HTMLInputElement).value = produto?.image_url ?? '';
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
        campo.dataset.loja = String(l.id);
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

function fecharFormularioProduto(): void {
    const modal = document.getElementById('modal-produto');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function salvarProduto(event: Event): Promise<void> {
    event.preventDefault();
    const erro = document.getElementById('erro-produto');
    const botao = document.getElementById('btn-salvar-produto') as HTMLButtonElement;
    erro.classList.add('hidden');

    const stock: Record<string, number> = {};
    document.querySelectorAll<HTMLInputElement>('#prod-estoques input').forEach((campo) => {
        stock[campo.dataset.loja] = campo.value === '' ? 0 : Number(campo.value);
    });

    const corpo = {
        name: (document.getElementById('prod-nome') as HTMLInputElement).value.trim(),
        category: (document.getElementById('prod-categoria') as HTMLInputElement).value.trim(),
        price: (document.getElementById('prod-preco') as HTMLInputElement).value.trim(),
        sku: (document.getElementById('prod-sku') as HTMLInputElement).value.trim(),
        barcode: (document.getElementById('prod-barcode') as HTMLInputElement).value.trim(),
        image_url: (document.getElementById('prod-imagem') as HTMLInputElement).value.trim(),
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

// ---------------------------------------------------------------------------
// Janela de retirada, prazo de reserva e histórico (S3-22, S3-24, S3-17)
// ---------------------------------------------------------------------------
function formatarSlot(slot: string): string {
    // slot = AAAA-MM-DDTHH:00 (horário de Brasília)
    return `${slot.slice(8, 10)}/${slot.slice(5, 7)} ${slot.slice(11, 16)}`;
}

function descreverPrazo(p: Pedido): string {
    const partes: string[] = [];
    if (p.pickup_slot) partes.push(`<span class="font-bold text-blue-700">Retirada ${esc(formatarSlot(p.pickup_slot))}</span>`);
    if (p.reserved_until) {
        const vencida = new Date(p.reserved_until + 'Z').getTime() < Date.now();
        partes.push(`<span class="${vencida ? 'text-red-600 font-bold' : ''}">${vencida ? 'Reserva vencida' : 'Separar até'} ${esc(new Date(p.reserved_until + 'Z').toLocaleString('pt-BR'))}</span>`);
    }
    if (p.origin_store_name) partes.push(`Transferência de ${esc(p.origin_store_name)} (${Number(p.transfer_eta_days)} dia(s))`);
    return partes.length ? partes.join('<br>') : '—';
}

async function liberarReservasVencidas(): Promise<void> {
    if (!podeCancelar()) return;
    if (!confirm('Cancelar os pedidos que a loja não separou no prazo e devolver o estoque?')) return;
    try {
        const resp = await apiFetch<{ expired: unknown[]; hours: number }>('/api/orders/expire-overdue', { method: 'POST' });
        triggerToast(
            resp.expired.length ? 'Reservas liberadas' : 'Nada a liberar',
            resp.expired.length
                ? `${resp.expired.length} pedido(s) vencido(s) cancelado(s); estoque devolvido.`
                : `Nenhum pedido passou do prazo de ${resp.hours}h.`,
            resp.expired.length ? 'warning' : 'success'
        );
        await recarregarPedidos();
    } catch (err) {
        triggerToast('Não foi possível liberar', mensagemDeErro(err), 'warning');
    }
}

async function abrirHistorico(pedido: Pedido): Promise<void> {
    document.getElementById('titulo-historico').textContent = `Histórico do pedido #${String(pedido.id).padStart(4, '0')}`;
    const auditoria = document.getElementById('lista-auditoria');
    const notificacoes = document.getElementById('lista-notificacoes');
    const aviso = (texto: string) => Object.assign(document.createElement('li'), { textContent: texto, className: 'text-gray-400' });
    auditoria.replaceChildren(aviso('Carregando...'));
    notificacoes.replaceChildren(aviso('Carregando...'));
    const modal = document.getElementById('modal-historico');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const [aud, not] = await Promise.allSettled([
        apiFetch<{ audit: Auditoria[] }>(`/api/orders/${pedido.id}/audit`),
        apiFetch<{ notifications: Notificacao[] }>(`/api/orders/${pedido.id}/notifications`),
    ]);

    if (aud.status === 'fulfilled') {
        const linhas = aud.value.audit.slice().reverse().map((a) => {
            const li = document.createElement('li');
            li.className = 'border border-gray-200 rounded-lg px-3 py-2';
            li.innerHTML = `<strong class="text-gray-900">${esc(a.action.replace(/_/g, ' '))}</strong>
                <span class="text-gray-500"> por ${esc(a.user_email || 'sistema')} (${esc(a.user_role || '-')}) em ${esc(new Date(a.created_at + 'Z').toLocaleString('pt-BR'))}</span>
                ${a.detail ? `<span class="block text-gray-600 mt-0.5">${esc(a.detail)}</span>` : ''}`;
            return li;
        });
        auditoria.replaceChildren(...(linhas.length ? linhas : [aviso('Nenhuma ação de colaborador registrada ainda.')]));
    } else {
        auditoria.replaceChildren(aviso(aud.reason?.status === 503
            ? 'A auditoria ainda não está ativa no banco (falta rodar a migração 001).'
            : mensagemDeErro(aud.reason)));
    }

    if (not.status === 'fulfilled') {
        const linhas = not.value.notifications.map((n) => {
            const li = document.createElement('li');
            li.className = 'border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-gray-700';
            li.textContent = `${new Date(n.created_at + 'Z').toLocaleString('pt-BR')} — ${n.message}`;
            return li;
        });
        notificacoes.replaceChildren(...(linhas.length ? linhas : [aviso('Sem notificações.')]));
    } else {
        notificacoes.replaceChildren(aviso(mensagemDeErro(not.reason)));
    }
}

function fecharHistorico(): void {
    const modal = document.getElementById('modal-historico');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function mensagemDeErro(err: ErroApi): string {
    return err.status === undefined
        ? 'Sem conexão com o servidor. Esta ação precisa de internet.'
        : err.message;
}

// ---------------------------------------------------------------------------
// S3-01: modo offline do terminal
// Sem conexão, a fila da filial guardada no último carregamento continua
// valendo e as baixas de retirada ficam numa fila local; ao voltar a internet
// elas são enviadas (o servidor ainda confere e impede baixa em duplicidade).
// ---------------------------------------------------------------------------
function lerFilaOffline(): BaixaOffline[] {
    const fila = lerStorage<BaixaOffline[]>(localStorage, CHAVE_FILA_OFFLINE, []);
    return Array.isArray(fila) ? fila : [];
}

function gravarFilaOffline(fila: BaixaOffline[]): void {
    gravarStorage(localStorage, CHAVE_FILA_OFFLINE, fila.length ? fila : null);
    atualizarFaixaOffline();
}

function aplicarFilaLocal(): void {
    const baixados = new Set(lerFilaOffline().map((b) => b.order_id));
    pedidos.forEach((p) => {
        if (baixados.has(p.id) && p.status === 'pronto_retirada') p.status = 'entregue_cliente';
    });
}

function usarCacheOffline(): boolean {
    const cache = lerStorage<CacheFila | null>(localStorage, CHAVE_CACHE_FILA, null);
    if (!cache || cache.filialId !== filialId || !Array.isArray(cache.pedidos)) return false;
    pedidos = cache.pedidos;
    definirOffline(true);
    return true;
}

function definirOffline(valor: boolean): void {
    const mudou = modoOffline !== valor;
    modoOffline = valor;
    atualizarFaixaOffline();
    if (mudou && !valor) sincronizarFilaOffline(false);
}

function atualizarFaixaOffline(): void {
    const faixa = document.getElementById('faixa-offline');
    if (!faixa) return;
    const fila = lerFilaOffline();
    const cache = lerStorage<CacheFila | null>(localStorage, CHAVE_CACHE_FILA, null);
    const texto = document.getElementById('txt-offline');
    const botao = document.getElementById('btn-sincronizar');

    if (modoOffline) {
        const hora = cache?.em ? new Date(cache.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        texto.textContent = `Sem conexão com o servidor. Mostrando a fila de ${hora} guardada neste aparelho. `
            + `${fila.length} baixa(s) de retirada aguardando envio. Separação, falta e cancelamento precisam de internet.`;
    } else if (fila.length > 0) {
        texto.textContent = `${fila.length} baixa(s) de retirada feitas sem conexão aguardando envio ao servidor.`;
    }
    faixa.classList.toggle('hidden', !modoOffline && fila.length === 0);
    botao.classList.toggle('hidden', fila.length === 0);
}

function enfileirarBaixa(corpo: CorpoBaixa): void {
    const fila = lerFilaOffline();
    if (fila.some((b) => b.order_id === corpo.order_id)) {
        triggerToast('Já registrada', 'Esta baixa já está na fila para envio.', 'warning');
        return;
    }
    fila.push({ ...corpo, queued_at: new Date().toISOString() });
    gravarFilaOffline(fila);
    aplicarFilaLocal();
    renderizarFilaAposBaixa();
    triggerToast('Baixa guardada (offline)', 'Será enviada ao servidor quando a conexão voltar.', 'warning');
}

async function renderizarFilaAposBaixa(): Promise<void> {
    pedidoRetirada = null;
    atualizarConferenciaRetirada();
    (document.getElementById('input-busca-voucher') as HTMLInputElement).value = '';
    (document.getElementById('input-busca-cpf') as HTMLInputElement).value = '';
    const prontos = pedidos.filter((p) => p.status === 'pronto_retirada');
    document.getElementById('cnt-retirada').textContent = String(prontos.length);
    renderizarTabelaPedidos();
}

async function sincronizarFilaOffline(manual: boolean): Promise<void> {
    const fila = lerFilaOffline();
    if (sincronizando || fila.length === 0) {
        if (manual && fila.length === 0) triggerToast('Tudo em dia', 'Não há baixas aguardando envio.', 'success');
        return;
    }
    sincronizando = true;
    let enviadas = 0;
    const restantes: BaixaOffline[] = [];
    let semConexao = false;
    const problemas: string[] = [];

    for (const baixa of fila) {
        if (semConexao) {
            restantes.push(baixa);
            continue;
        }
        try {
            await apiFetch('/api/orders/validate-pickup', {
                method: 'POST',
                body: JSON.stringify({
                    order_id: baixa.order_id,
                    document_checked: true,
                    is_third_party: Boolean(baixa.is_third_party),
                    queued_at: baixa.queued_at,
                }),
            });
            enviadas += 1;
        } catch (err) {
            if (err.status === undefined) {
                semConexao = true;
                restantes.push(baixa);
            } else if (err.status === 409) {
                // Alguém já deu baixa neste pedido: nada a enviar.
                enviadas += 1;
            } else if (err.status === 401 || err.status === 403) {
                restantes.push(baixa);
                semConexao = true; // sessão encerrada: mantém a fila para depois do login
            } else {
                problemas.push(`Pedido #${baixa.order_id}: ${err.message}`);
            }
        }
    }

    gravarFilaOffline(restantes);
    sincronizando = false;
    if (enviadas > 0) triggerToast('Baixas enviadas', `${enviadas} baixa(s) registrada(s) no servidor.`, 'success');
    if (problemas.length > 0) triggerToast('Baixa não aceita', problemas[0], 'warning');
    if (semConexao) {
        if (manual) triggerToast('Ainda sem conexão', 'As baixas continuam guardadas neste aparelho.', 'warning');
        return;
    }
    await recarregarPedidos(true);
}

window.addEventListener('offline', () => {
    if (sessaoOp) definirOffline(true);
});
window.addEventListener('online', () => {
    if (sessaoOp) {
        definirOffline(false);
        recarregarPedidos(true);
    }
});