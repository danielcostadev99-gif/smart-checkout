import type { GetServerSideProps, NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import type { ParsedUrlQuery } from 'node:querystring';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ShieldCheck,
  Lock,
  BadgeCheck,
  CreditCard,
  Smartphone,
  Loader2,
  ChevronRight,
} from 'lucide-react';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import type {
  Offer,
  OfferMetadata,
  ProcessCheckoutRequest,
  ProcessCheckoutResponse,
  TrackingParams,
} from '@/src/types';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

// ============================================================
// Helpers de máscara de input
// ============================================================

function maskCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length === 0 ? '' : `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCardNumber(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 16);
  return (d.match(/.{1,4}/g) ?? []).join(' ');
}

function maskCardExpiry(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

// ============================================================
// Tipos da página
// ============================================================

interface PageProps {
  offer: Offer;
  metadata: OfferMetadata;
  initialTracking: TrackingParams;
}

type Step = 1 | 2;

function getSingleQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return getSingleQueryValue(value[0]);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractTrackingParams(query: ParsedUrlQuery): TrackingParams {
  return {
    utm_source: getSingleQueryValue(query.utm_source),
    utm_campaign: getSingleQueryValue(query.utm_campaign),
    utm_medium: getSingleQueryValue(query.utm_medium),
    utm_content: getSingleQueryValue(query.utm_content),
    utm_term: getSingleQueryValue(query.utm_term),
    fbclid: getSingleQueryValue(query.fbclid),
    fbp: getSingleQueryValue(query.fbp),
    fbc: getSingleQueryValue(query.fbc),
  };
}

// ============================================================
// Componente reutilizável de input
// ============================================================

interface InputFieldProps {
  label: string;
  id: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  value: string;
  placeholder: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function InputField({
  label,
  id,
  type = 'text',
  required = false,
  autoComplete,
  inputMode,
  value,
  placeholder,
  onChange,
}: InputFieldProps): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className="w-full h-12 px-4 rounded-xl border border-gray-300 text-gray-900
                   placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500
                   focus:border-transparent transition text-base"
      />
    </div>
  );
}

// ============================================================
// Página principal de Checkout
// ============================================================

const CheckoutPage: NextPage<PageProps> = ({ offer, metadata, initialTracking }) => {
  const router = useRouter();
  const initiateCheckoutTrackedRef = useRef(false);

  const [step, setStep]           = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [trackingParams, setTrackingParams] = useState<TrackingParams>(initialTracking);
  const [orderId, setOrderId] = useState<string | null>(null);

  // — Dados pessoais
  const [customerName,  setCustomerName]  = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCpf,   setCustomerCpf]   = useState('');

  // — Pagamento
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credit_card'>('pix');
  const [cardNumber,    setCardNumber]    = useState('');
  const [cardName,      setCardName]      = useState('');
  const [cardExpiry,    setCardExpiry]    = useState('');
  const [cardCvv,       setCardCvv]       = useState('');
  const [installments,  setInstallments]  = useState(1);

  const { price } = metadata;

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    setTrackingParams(prev => ({
      ...prev,
      ...extractTrackingParams(router.query as ParsedUrlQuery),
    }));
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (initiateCheckoutTrackedRef.current || !metadata.meta_pixel_id || typeof window === 'undefined') {
      return;
    }

    if (typeof window.fbq !== 'function') {
      return;
    }

    window.fbq('track', 'InitiateCheckout', {
      content_name: metadata.productName,
      currency: 'BRL',
      value: price,
    });
    initiateCheckoutTrackedRef.current = true;
  }, [metadata.meta_pixel_id, metadata.productName, price]);

  const installmentOptions = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    return {
      value: n,
      label: `${n}x de ${formatCurrency(price / n)} sem juros`,
    };
  });

  async function handleNextStep(e: FormEvent): Promise<void> {
    e.preventDefault();

    // Call server to create/update order and fire InitiateCheckout server-side
    try {
      setIsLoading(true);
      setError(null);

      const payload = {
        offerId: offer.id,
        customerName,
        customerEmail,
        customerPhone,
        customerCpf,
        ...trackingParams,
      } as const;

      const resp = await fetch('/api/checkout/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!data || !data.success) {
        setError(data?.error ?? 'Erro ao iniciar checkout');
        setIsLoading(false);
        return;
      }

      setOrderId(data.orderId ?? null);
      setStep(2);
    } catch (err) {
      setError('Erro ao comunicar com o servidor. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const payload: ProcessCheckoutRequest = {
        offerId:       offer.id,
        orderId:       orderId ?? undefined,
        customerName,
        customerEmail,
        customerPhone,
        customerCpf,
        paymentMethod,
        totalAmount:   price,
        ...trackingParams,
        ...(paymentMethod === 'credit_card' && {
          cardNumber,
          cardName,
          cardExpiry,
          cardCvv,
          installments,
        }),
      };

      const response = await fetch('/api/checkout/process', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const data: ProcessCheckoutResponse = await response.json() as ProcessCheckoutResponse;

      if (!data.success) {
        setError(data.error ?? 'Erro ao processar pagamento. Tente novamente.');
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams({
        status:      paymentMethod === 'pix' ? 'pix_pending' : 'approved',
        orderId:     data.orderId,
        productName: data.productName,
        email:       data.customerEmail,
        ...(data.pixCode      && { pixCode:      data.pixCode }),
        ...(data.pixQrCodeUrl && { pixQrCodeUrl: data.pixQrCodeUrl }),
      });

      void router.push(`/thank-you?${params.toString()}`);
    } catch {
      setError('Erro de conexão. Verifique sua internet e tente novamente.');
      setIsLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Checkout — {metadata.productName}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {metadata.meta_pixel_id && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', ${JSON.stringify(metadata.meta_pixel_id)});fbq('track', 'PageView');`,
            }}
          />
        )}
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* ── Header ── */}
        <header className="bg-white border-b border-gray-200 py-3.5">
          <div className="max-w-lg mx-auto px-4 flex items-center justify-center gap-2">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-semibold text-gray-600">
              Compra 100% Segura e Criptografada
            </span>
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-6 pb-16">

          {/* ── Resumo do Pedido ── */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              Você está comprando
            </p>
            <h1 className="text-lg font-bold text-gray-900 leading-snug">
              {metadata.productName}
            </h1>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-600">
                {formatCurrency(price)}
              </span>
              <span className="text-sm text-gray-400">à vista</span>
            </div>
          </div>

          {/* ── Indicador de Etapas ── */}
          <div className="flex items-center gap-2 mb-5 px-1">
            <StepBadge number={1} label="Seus Dados"  active={step >= 1} />
            <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            <StepBadge number={2} label="Pagamento"   active={step >= 2} />
          </div>

          {/* ══════════════════════════════
              Etapa 1: Dados Pessoais
          ══════════════════════════════ */}
          {step === 1 && (
            <form
              onSubmit={handleNextStep}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4"
            >
              <h2 className="text-base font-semibold text-gray-800">Dados Pessoais</h2>

              <InputField
                id="customerName"
                label="Nome Completo"
                required
                autoComplete="name"
                value={customerName}
                placeholder="Seu nome completo"
                onChange={e => setCustomerName(e.target.value)}
              />

              <InputField
                id="customerEmail"
                label="E-mail"
                type="email"
                required
                autoComplete="email"
                value={customerEmail}
                placeholder="seu@email.com"
                onChange={e => setCustomerEmail(e.target.value)}
              />

              <InputField
                id="customerPhone"
                label="Celular / WhatsApp"
                type="tel"
                required
                autoComplete="tel"
                inputMode="numeric"
                value={customerPhone}
                placeholder="(00) 00000-0000"
                onChange={e => setCustomerPhone(maskPhone(e.target.value))}
              />

              <InputField
                id="customerCpf"
                label="CPF"
                required
                inputMode="numeric"
                value={customerCpf}
                placeholder="000.000.000-00"
                onChange={e => setCustomerCpf(maskCpf(e.target.value))}
              />

              <button
                type="submit"
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                           text-white font-bold text-base rounded-xl transition
                           flex items-center justify-center gap-2 mt-2"
              >
                Continuar para o Pagamento
                <ChevronRight className="w-5 h-5" />
              </button>
            </form>
          )}

          {/* ══════════════════════════════
              Etapa 2: Pagamento
          ══════════════════════════════ */}
          {step === 2 && (
            <form
              onSubmit={e => { void handleSubmit(e); }}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold text-gray-800 mb-4">
                Forma de Pagamento
              </h2>

              {/* — Tabs de método de pagamento */}
              <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-5">
                <PaymentTab
                  icon={<Smartphone className="w-4 h-4" />}
                  label="PIX"
                  active={paymentMethod === 'pix'}
                  onClick={() => setPaymentMethod('pix')}
                  borderRight
                />
                <PaymentTab
                  icon={<CreditCard className="w-4 h-4" />}
                  label="Cartão de Crédito"
                  active={paymentMethod === 'credit_card'}
                  onClick={() => setPaymentMethod('credit_card')}
                />
              </div>

              {/* — Painel PIX */}
              {paymentMethod === 'pix' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center mb-5">
                  <Smartphone className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                  <p className="font-semibold text-emerald-800 text-sm">Pagamento via PIX</p>
                  <p className="text-xs text-emerald-700 mt-1.5 leading-relaxed">
                    Na próxima tela você receberá o código PIX Copia e Cola.
                    O pagamento é compensado em segundos.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Seu acesso será enviado ao e-mail após a confirmação do pagamento.
                  </p>
                </div>
              )}

              {/* — Painel Cartão de Crédito */}
              {paymentMethod === 'credit_card' && (
                <div className="space-y-4 mb-5">
                  <InputField
                    id="cardNumber"
                    label="Número do Cartão"
                    required
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={cardNumber}
                    placeholder="0000 0000 0000 0000"
                    onChange={e => setCardNumber(maskCardNumber(e.target.value))}
                  />

                  <InputField
                    id="cardName"
                    label="Nome Impresso no Cartão"
                    required
                    autoComplete="cc-name"
                    value={cardName}
                    placeholder="NOME COMO NO CARTÃO"
                    onChange={e => setCardName(e.target.value.toUpperCase())}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <InputField
                      id="cardExpiry"
                      label="Validade (MM/AA)"
                      required
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      value={cardExpiry}
                      placeholder="MM/AA"
                      onChange={e => setCardExpiry(maskCardExpiry(e.target.value))}
                    />
                    <InputField
                      id="cardCvv"
                      label="CVV"
                      required
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      value={cardCvv}
                      placeholder="000"
                      onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="installments"
                      className="block text-sm font-medium text-gray-700 mb-1.5"
                    >
                      Parcelas
                    </label>
                    <select
                      id="installments"
                      value={installments}
                      onChange={e => setInstallments(Number(e.target.value))}
                      className="w-full h-12 px-4 rounded-xl border border-gray-300 text-gray-900
                                 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500
                                 focus:border-transparent transition text-base"
                    >
                      {installmentOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* — Erro */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                  <p className="text-sm text-red-700 text-center">{error}</p>
                </div>
              )}

              {/* — CTA Principal */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                           disabled:bg-emerald-400 text-white font-bold text-base rounded-xl
                           transition flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5" />
                    COMPRAR AGORA
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setStep(1); setError(null); }}
                className="mt-3 w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition"
              >
                ← Voltar e editar meus dados
              </button>

              {/* — Selos de segurança */}
              <div className="mt-5 pt-5 border-t border-gray-100 flex flex-wrap items-center justify-center gap-4">
                <SecurityBadge icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />} label="Ambiente Seguro" />
                <SecurityBadge icon={<BadgeCheck  className="w-4 h-4 text-emerald-600" />} label="Garantia de Satisfação" />
                <SecurityBadge icon={<Lock        className="w-4 h-4 text-emerald-600" />} label="Dados Criptografados" />
              </div>
            </form>
          )}
        </main>
        {metadata.meta_pixel_id && (
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              alt=""
              src={`https://www.facebook.com/tr?id=${metadata.meta_pixel_id}&ev=PageView&noscript=1`}
            />
          </noscript>
        )}
      </div>
    </>
  );
};

// ============================================================
// Sub-componentes internos
// ============================================================

function StepBadge({
  number, label, active,
}: { number: number; label: string; active: boolean }): JSX.Element {
  return (
    <div className={`flex items-center gap-2 ${active ? 'text-emerald-600' : 'text-gray-400'}`}>
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition
          ${active
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-gray-300 text-gray-400'
          }`}
      >
        {number}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function PaymentTab({
  icon, label, active, onClick, borderRight = false,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  borderRight?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-semibold transition
        ${borderRight ? 'border-r border-gray-200' : ''}
        ${active
          ? 'bg-emerald-600 text-white'
          : 'bg-white text-gray-600 hover:bg-gray-50'
        }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SecurityBadge({
  icon, label,
}: { icon: React.ReactNode; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-gray-500">
      {icon}
      <span className="text-xs">{label}</span>
    </div>
  );
}

// ============================================================
// getServerSideProps — busca a oferta no Supabase
// ============================================================

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ params, query }) => {
  const offerId = params?.offerId;

  if (typeof offerId !== 'string') {
    return { notFound: true };
  }

  const { data: offer, error } = await getSupabaseAdmin()
    .from('offers')
    .select('id, metadata, created_at')
    .eq('id', offerId)
    .single();

  if (error || !offer) {
    // Debug logs para investigação: mostra offerId, error e dado bruto retornado
    // Estes logs aparecem no terminal onde o Next.js está rodando (dev ou build).
    console.error('[SmartCheckout][DEBUG] Oferta não encontrada durante getServerSideProps', {
      offerId,
      error: error ?? null,
      offerRaw: offer ?? null,
    });

    return { notFound: true };
  }

  // Parse seguro do JSONB metadata
  let metadata: OfferMetadata;
  try {
    const raw: unknown =
      typeof offer.metadata === 'string'
        ? (JSON.parse(offer.metadata) as unknown)
        : offer.metadata;

    if (typeof raw !== 'object' || raw === null || !('productName' in raw) || !('price' in raw)) {
      return { notFound: true };
    }

    const r = raw as Record<string, unknown>;

    // productName must be string
    if (typeof r.productName !== 'string') return { notFound: true };

    // price can be number or numeric string; coerce safely
    let parsedPrice: number;
    if (typeof r.price === 'number') {
      parsedPrice = r.price;
    } else if (typeof r.price === 'string' && r.price.trim() !== '') {
      const n = Number((r.price as string).replace(/[^0-9.,-]/g, '').replace(',', '.'));
      if (Number.isFinite(n)) parsedPrice = n;
      else return { notFound: true };
    } else {
      return { notFound: true };
    }

    metadata = {
      productName: String(r.productName),
      price:       Number(parsedPrice),
      meta_pixel_id: typeof r.meta_pixel_id === 'string' ? r.meta_pixel_id : null,
      meta_access_token: null,
      description: typeof r.description === 'string' ? r.description : null,
      productDownloadUrl: typeof r.productDownloadUrl === 'string' ? r.productDownloadUrl : null,
      imageUrl:    typeof r.imageUrl    === 'string' ? r.imageUrl    : null,
    };
  } catch {
    return { notFound: true };
  }

  return {
    props: {
      offer: {
        id:         offer.id as string,
        metadata,
        created_at: offer.created_at as string,
      },
      metadata,
      initialTracking: extractTrackingParams(query),
    },
  };
};

export default CheckoutPage;
