// S3-02: leitura real do QR Code do voucher pela câmera (portal /operador, aba Retirada).
// Usa BarcodeDetector quando o navegador tem; senão, jsQR (carregado no operador.html).
// Ao ler um voucher válido, preenche #input-busca-voucher e reaproveita a busca existente
// (localizarPedidoRetirada), então a validação continua toda no fluxo atual.
// Depende de js/common.js (triggerToast) e js/operador.js (localizarPedidoRetirada).

const FORMATO_VOUCHER = /^HV-\d{4,}-[0-9A-F]{4}-[0-9A-F]{4}$/i;

let leitorQr = { stream: null, ativo: false, detector: null, ultimoAviso: 0 };

async function abrirLeitorQr() {
    if (!navigator.mediaDevices?.getUserMedia) {
        triggerToast('Câmera indisponível', 'Este navegador não permite o uso da câmera (precisa de HTTPS). Digite o código.', 'warning');
        return;
    }
    const usaDetector = 'BarcodeDetector' in window;
    if (!usaDetector && typeof jsQR === 'undefined') {
        triggerToast('Leitor indisponível', 'Não foi possível carregar o leitor de QR Code. Digite o código.', 'warning');
        return;
    }
    try {
        leitorQr.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        });
    } catch (err) {
        const negou = err && err.name === 'NotAllowedError';
        triggerToast(
            negou ? 'Permissão negada' : 'Câmera indisponível',
            negou ? 'Libere o acesso à câmera no navegador ou digite o código.' : 'Não foi possível abrir a câmera. Digite o código.',
            'warning',
        );
        return;
    }
    leitorQr.detector = usaDetector ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

    const video = document.getElementById('video-leitor-qr');
    video.srcObject = leitorQr.stream;
    await video.play();
    document.getElementById('modal-leitor-qr').classList.remove('hidden');
    leitorQr.ativo = true;
    requestAnimationFrame(lerQuadroQr);
}

function fecharLeitorQr() {
    leitorQr.ativo = false;
    leitorQr.stream?.getTracks().forEach((t) => t.stop());
    leitorQr.stream = null;
    const video = document.getElementById('video-leitor-qr');
    video.srcObject = null;
    document.getElementById('modal-leitor-qr').classList.add('hidden');
}

async function lerQuadroQr() {
    if (!leitorQr.ativo) return;
    const video = document.getElementById('video-leitor-qr');
    let texto = null;

    if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
            if (leitorQr.detector) {
                const codigos = await leitorQr.detector.detect(video);
                texto = codigos[0]?.rawValue ?? null;
            } else {
                const canvas = document.getElementById('canvas-leitor-qr');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                texto = jsQR(img.data, img.width, img.height)?.data ?? null;
            }
        } catch (_) {
            // quadro ruim: ignora e tenta o próximo
        }
    }

    if (texto) {
        const codigo = texto.trim();
        if (FORMATO_VOUCHER.test(codigo)) {
            fecharLeitorQr();
            document.getElementById('input-busca-voucher').value = codigo.toUpperCase();
            localizarPedidoRetirada('voucher');
            return;
        }
        // QR de outra coisa (ex.: Pix): avisa no máximo a cada 3 s e segue lendo.
        if (Date.now() - leitorQr.ultimoAviso > 3000) {
            leitorQr.ultimoAviso = Date.now();
            triggerToast('QR inválido', 'Esse QR Code não é um voucher de retirada.', 'warning');
        }
    }
    setTimeout(() => requestAnimationFrame(lerQuadroQr), 150);
}