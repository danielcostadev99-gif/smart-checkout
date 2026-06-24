import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Clock,
  Mail,
  ShieldCheck,
  Smartphone,
  Loader2,
} from 'lucide-react';

// ============================================================
// Helpers
// ============================================================

/** Valida que a URL é de um domínio seguro e esperado. */
function validateQrCodeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && url.hostname === 'api.qrserver.com') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// Página de Obrigado
// ============================================================

const ThankYouPage: NextPage = () => {
  const router = useRouter();
  const [copied, setCopied]           = useState(false);
  const [isReady, setIsReady]         = useState(false);
  const [pixConfirmed, setPixConfirmed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  // Leitura segura dos query params (sempre strings ou undefined)
  const rawStatus      = router.query.status;
  const rawOrderId     = router.query.orderId;
  const rawProductName = router.query.productName;
  const rawEmail       = router.query.email;
  const rawPixCode     = router.query.pixCode;
  const rawPixQrUrl    = router.query.pixQrCodeUrl;

  const initialStatus = typeof rawStatus      === 'string' ? rawStatus      : '';
  const orderId       = typeof rawOrderId     === 'string' ? rawOrderId     : '';
  const productName   = typeof rawProductName === 'string' ? rawProductName : '';
  const email         = typeof rawEmail       === 'string' ? rawEmail       : '';
  const pixCode       = typeof rawPixCode     === 'string' ? rawPixCode     : '';
  const pixQrCodeUrl  = typeof rawPixQrUrl    === 'string'
    ? validateQrCodeUrl(rawPixQrUrl)
    : null;

  const isApproved   = initialStatus === 'approved' || pixConfirmed;
  const isPixPending = initialStatus === 'pix_pending' && !pixConfirmed;

  // Polling: verifica status do pedido a cada 4 s enquanto aguarda PIX
  useEffect(() => {
    if (!isReady || initialStatus !== 'pix_pending' || !orderId || pixConfirmed) return;

    const POLL_INTERVAL_MS = 4000;
    const MAX_POLLS = 75; // ~5 minutos
    let polls = 0;

    async function checkStatus(): Promise<void> {
      polls += 1;
      try {
        const res = await fetch(`/api/checkout/status?orderId=${encodeURIComponent(orderId)}`);
        if (!res.ok) return;
        const data = await res.json() as { status?: string; accessDelivered?: boolean };
        if (data.status === 'paid') {
          setPixConfirmed(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignora erros de rede; continua tentando
      }
      if (polls >= MAX_POLLS && pollRef.current) {
        clearInterval(pollRef.current);
      }
    }

    pollRef.current = setInterval(() => { void checkStatus(); }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isReady, initialStatus, orderId, pixConfirmed]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!pixCode) return;
    try {
      await navigator.clipboard.writeText(pixCode);
    } catch {
      // Fallback para navegadores sem suporte ao Clipboard API
      const el = document.createElement('textarea');
      el.value = pixCode;
      el.style.position = 'fixed';
      el.style.opacity  = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3500);
  }, [pixCode]);

  // ── Loading enquanto o router hidrata ─────────────────────
  if (!isReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {isApproved ? 'Compra Aprovada! ✅' : isPixPending ? 'Pague com PIX' : 'Pedido Recebido'}
        </title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start py-10 px-4 pb-16">
        <div className="w-full max-w-md">

          {/* ══════════════════════════════════════════════════
              CARTÃO APROVADO
          ══════════════════════════════════════════════════ */}
          {isApproved && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

              {/* Header verde */}
              <div className="bg-emerald-600 px-6 py-10 text-center">
                <CheckCircle2
                  className="w-20 h-20 text-white mx-auto mb-4"
                  strokeWidth={1.5}
                />
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  Compra Aprovada!
                </h1>
                <p className="text-emerald-100 mt-2 text-sm">
                  Parabéns! Seu pagamento foi processado com sucesso.
                </p>
              </div>

              {/* Corpo */}
              <div className="p-6 space-y-4">

                {/* Produto */}
                {productName && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">
                      Produto adquirido
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {productName}
                    </p>
                  </div>
                )}

                {/* Confirmação de entrega */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
                  <Mail className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">
                      Link de acesso enviado!
                    </p>
                    <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                      Sua compra foi aprovada e o link com o acesso ao seu produto já foi
                      enviado para o e-mail{' '}
                      {email && (
                        <strong className="font-semibold">{email}</strong>
                      )}.{' '}
                      Verifique também a caixa de spam.
                    </p>
                  </div>
                </div>

                {/* Selo de segurança */}
                <div className="flex items-center justify-center gap-2 pt-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs text-gray-500">Compra realizada com segurança</span>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              PIX PENDENTE
          ══════════════════════════════════════════════════ */}
          {isPixPending && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

              {/* Header gradiente */}
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 px-6 py-8 text-center">
                <Smartphone
                  className="w-14 h-14 text-white mx-auto mb-3"
                  strokeWidth={1.5}
                />
                <h1 className="text-xl font-extrabold text-white">
                  Pague com PIX
                </h1>
                <p className="text-emerald-100 mt-1.5 text-sm">
                  Escaneie o QR Code ou copie o código abaixo
                </p>
              </div>

              {/* Corpo */}
              <div className="p-6 space-y-5">

                {/* QR Code */}
                {pixQrCodeUrl && (
                  <div className="flex justify-center">
                    <div className="p-3 border-2 border-gray-200 rounded-2xl bg-white inline-block shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pixQrCodeUrl}
                        alt="QR Code PIX para pagamento"
                        width={210}
                        height={210}
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                )}

                {/* PIX Copia e Cola */}
                {pixCode && (
                  <div>
                    <p className="text-xs text-gray-400 text-center uppercase tracking-wider mb-2">
                      Código PIX Copia e Cola
                    </p>

                    {/* Caixa do código */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-3">
                      <p className="text-xs text-gray-700 break-all font-mono leading-relaxed select-all">
                        {pixCode}
                      </p>
                    </div>

                    {/* Botão Copiar */}
                    <button
                      type="button"
                      onClick={() => { void handleCopy(); }}
                      className={`w-full h-12 rounded-xl font-semibold text-sm flex items-center
                                  justify-center gap-2 transition-all duration-200
                        ${copied
                          ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                          : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white'
                        }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Código Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copiar Código PIX
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Aviso de aguardo com status de polling */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-800">
                      Aguardando Confirmação
                    </p>
                    <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                      Seu link de acesso será enviado automaticamente para{' '}
                      {email
                        ? <strong className="font-semibold">{email}</strong>
                        : 'o seu e-mail'
                      }{' '}
                      assim que o PIX for compensado. Isso geralmente ocorre em segundos.
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Loader2 className="w-3 h-3 text-amber-600 animate-spin" />
                      <span className="text-xs text-amber-600">Verificando pagamento...</span>
                    </div>
                  </div>
                </div>

                {/* Produto */}
                {productName && (
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-400">Produto:</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{productName}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              FALLBACK (status desconhecido)
          ══════════════════════════════════════════════════ */}
          {!isApproved && !isPixPending && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" strokeWidth={1.5} />
              <h1 className="text-xl font-bold text-gray-900">Pedido Recebido!</h1>
              <p className="text-gray-500 mt-2 text-sm">
                Seu pedido foi registrado com sucesso. Em breve você receberá mais informações.
              </p>
            </div>
          )}

        </div>
      </div>
    </>
  );
};

export default ThankYouPage;
