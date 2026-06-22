import type { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';
import type {
  ProcessCheckoutRequest,
  ProcessCheckoutResponse,
  PaymentMethod,
} from '@/src/types';

// ============================================================
// Constantes e helpers de validação
// ============================================================

const VALID_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set(['pix', 'credit_card']);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidCpf(cpf: string): boolean {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Escapa caracteres especiais HTML para uso seguro em atributos e texto. */
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

/**
 * Valida que a string é uma URL http/https segura.
 * Rejeita javascript:, data:, e outros protocolos não seguros.
 */
function sanitizeUrl(raw: string, fallback: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

type ResendErrorLike = {
  name?: string;
  message?: string;
  statusCode?: number;
};

function isResendDomainNotVerifiedError(error: unknown): error is ResendErrorLike {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const resendError = error as ResendErrorLike;
  const message = resendError.message?.toLowerCase() ?? '';

  return resendError.statusCode === 403
    && (resendError.name === 'validation_error' || message.includes('domain is not verified'));
}

function isResendTestingRecipientRestrictionError(error: unknown): error is ResendErrorLike {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const resendError = error as ResendErrorLike;
  const message = resendError.message?.toLowerCase() ?? '';

  return resendError.statusCode === 403
    && resendError.name === 'validation_error'
    && message.includes('you can only send testing emails to your own email address');
}

function extractTestingAllowedRecipient(message: string | undefined): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(/\(([^\s@()]+@[^\s@()]+\.[^\s@()]+)\)/i);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

// ============================================================
// Gerador de código PIX mockado (formato EMV simplificado)
// ============================================================

function generatePixCode(orderId: string, amount: number): string {
  const amountStr = amount.toFixed(2).replace('.', '');
  const txId      = `SCO${orderId.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  // Formato Pix EMV mock — suficiente para gerar QR Code de teste
  return [
    '000201',
    '010212',
    `2658001462BR.GOV.BCB.PIX01${String(orderId.slice(0, 36).length).padStart(2, '0')}${orderId.slice(0, 36)}`,
    '52040000',
    '5303986',
    `54${String(amountStr.length).padStart(2, '0')}${amountStr}`,
    '5802BR',
    '5924SMARTCHECKOUT ENGINE',
    '6009SAO PAULO',
    `6229${String(txId.length + 4).padStart(2, '0')}0525${txId}`,
    '6304',
  ].join('');
}

// ============================================================
// Template HTML do e-mail de entrega
// ============================================================

function buildDeliveryEmailHtml(
  customerName: string,
  productName:  string,
  accessLink:   string,
  orderId:      string,
): string {
  const safeName       = escapeHtml(customerName);
  const safeProduct    = escapeHtml(productName);
  const safeOrderId    = escapeHtml(orderId);
  const safeAccessLink = escapeHtml(accessLink);

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seu acesso ao ${safeProduct}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#059669;padding:36px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">✅</div>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">
                Compra Aprovada!
              </h1>
              <p style="margin:10px 0 0;color:#d1fae5;font-size:14px;">
                Seu pagamento foi confirmado com sucesso
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:17px;color:#111827;font-weight:600;">
                Olá, ${safeName}! 🎉
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.7;">
                Seu pagamento referente ao produto
                <strong style="color:#111827;">${safeProduct}</strong>
                foi confirmado. Clique no botão abaixo para acessar agora mesmo:
              </p>

              <!-- Botão CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#059669;border-radius:12px;">
                    <a href="${safeAccessLink}"
                      style="display:inline-block;padding:18px 44px;color:#ffffff;font-size:16px;
                             font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      🔓 ACESSAR MEU PRODUTO AGORA
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Link textual de backup -->
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">
                  Ou copie o link diretamente:
                </p>
                <a href="${safeAccessLink}"
                  style="color:#059669;font-size:13px;word-break:break-all;font-family:monospace;">
                  ${safeAccessLink}
                </a>
              </div>

              <!-- Informações do pedido -->
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px;margin-bottom:28px;">
                <p style="margin:0;font-size:13px;color:#065f46;line-height:1.7;">
                  🧾 <strong>Número do pedido:</strong> ${safeOrderId}<br />
                  Guarde este e-mail. Você precisará dele para suporte ou recuperação de acesso.
                </p>
              </div>

              <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
                Em caso de dúvidas, responda este e-mail.<br />
                Obrigado pela sua confiança! 💚
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                SmartCheckout Engine · Compra realizada com segurança e criptografia SSL
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

// ============================================================
// Resposta de erro padronizada
// ============================================================

function errorResponse(
  res:           NextApiResponse<ProcessCheckoutResponse>,
  statusCode:    number,
  message:       string,
  paymentMethod: PaymentMethod = 'pix',
): void {
  res.status(statusCode).json({
    success:       false,
    orderId:       '',
    paymentMethod,
    productName:   '',
    customerEmail: '',
    error:         message,
  });
}

// ============================================================
// Handler principal da API Route
// ============================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessCheckoutResponse>,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    errorResponse(res, 405, 'Method Not Allowed');
    return;
  }

  // ── Validação de entrada (boundary de segurança) ──────────

  const body = req.body as Partial<ProcessCheckoutRequest>;

  const {
    offerId,
    customerName,
    customerEmail,
    customerPhone,
    customerCpf,
    paymentMethod,
    totalAmount,
  } = body;

  if (typeof offerId !== 'string' || !isValidUuid(offerId)) {
    errorResponse(res, 400, 'ID da oferta inválido.');
    return;
  }

  if (typeof customerName !== 'string' || customerName.trim().length < 3) {
    errorResponse(res, 400, 'Nome inválido. Informe o nome completo.');
    return;
  }

  if (typeof customerEmail !== 'string' || !isValidEmail(customerEmail)) {
    errorResponse(res, 400, 'E-mail inválido.');
    return;
  }

  if (typeof customerPhone !== 'string' || customerPhone.replace(/\D/g, '').length < 10) {
    errorResponse(res, 400, 'Telefone inválido.');
    return;
  }

  if (typeof customerCpf !== 'string' || !isValidCpf(customerCpf)) {
    errorResponse(res, 400, 'CPF inválido. Use o formato 000.000.000-00.');
    return;
  }

  if (!paymentMethod || !VALID_PAYMENT_METHODS.has(paymentMethod)) {
    errorResponse(res, 400, 'Método de pagamento inválido.');
    return;
  }

  if (typeof totalAmount !== 'number' || totalAmount <= 0 || !Number.isFinite(totalAmount)) {
    errorResponse(res, 400, 'Valor do pedido inválido.');
    return;
  }

  if (paymentMethod === 'credit_card') {
    const { cardNumber, cardName, cardExpiry, cardCvv } = body;
    if (
      typeof cardNumber !== 'string' || cardNumber.replace(/\s/g, '').length < 13 ||
      typeof cardName   !== 'string' || cardName.trim().length < 3 ||
      typeof cardExpiry !== 'string' || !/^\d{2}\/\d{2}$/.test(cardExpiry) ||
      typeof cardCvv    !== 'string' || cardCvv.length < 3
    ) {
      errorResponse(res, 400, 'Dados do cartão incompletos ou inválidos.', 'credit_card');
      return;
    }
  }

  // ── Inicializa cliente admin ──────────────────────────────

  const supabaseAdmin = getSupabaseAdmin();

  // ── Busca a oferta para validar e extrair metadata ────────

  const { data: offer, error: offerError } = await supabaseAdmin
    .from('offers')
    .select('id, metadata')
    .eq('id', offerId)
    .single();

  if (offerError ?? !offer) {
    errorResponse(res, 404, 'Oferta não encontrada.', paymentMethod);
    return;
  }

  const rawMeta = (
    typeof offer.metadata === 'string'
      ? (JSON.parse(offer.metadata) as Record<string, unknown>)
      : (offer.metadata as Record<string, unknown>)
  );

  const productName = typeof rawMeta.productName === 'string'
    ? rawMeta.productName
    : 'Produto';

  const fallbackLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://example.com'}/acesso`;
  const accessLink   = sanitizeUrl(
    typeof rawMeta.accessLink === 'string' ? rawMeta.accessLink : '',
    fallbackLink,
  );

  // ── Cria o pedido com status 'pending' ────────────────────

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .insert({
      offer_id:        offerId,
      customer_name:   customerName.trim(),
      customer_email:  customerEmail.toLowerCase().trim(),
      customer_cpf:    customerCpf,
      customer_phone:  customerPhone,
      payment_method:  paymentMethod,
      status:          'pending',
      total_amount:    totalAmount,
      access_delivered: false,
    })
    .select('id')
    .single();

  if (orderError ?? !order) {
    console.error('[SmartCheckout] Erro ao criar pedido:', orderError);
    errorResponse(res, 500, 'Erro interno ao registrar pedido.', paymentMethod);
    return;
  }

  const orderId: string = order.id as string;

  // ══════════════════════════════════════════════════════════
  // FLUXO PIX — retorna código e QR Code mockados
  // ══════════════════════════════════════════════════════════

  if (paymentMethod === 'pix') {
    const pixCode      = generatePixCode(orderId, totalAmount);
    const pixQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&ecc=M&data=${encodeURIComponent(pixCode)}`;

    res.status(200).json({
      success:       true,
      orderId,
      paymentMethod: 'pix',
      productName,
      customerEmail: customerEmail.toLowerCase().trim(),
      pixCode,
      pixQrCodeUrl,
    });
    return;
  }

  // ══════════════════════════════════════════════════════════
  // FLUXO CARTÃO — simula aprovação imediata
  // ══════════════════════════════════════════════════════════

  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', orderId);

  if (updateError) {
    console.error('[SmartCheckout] Erro ao atualizar status:', updateError);
    errorResponse(res, 500, 'Erro ao aprovar pagamento.', 'credit_card');
    return;
  }

  // ── Entrega automática por e-mail ─────────────────────────

  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.error('[SmartCheckout] RESEND_API_KEY não configurada. E-mail de entrega não enviado.');
  } else {
    try {
      const resend = new Resend(resendApiKey);
      const senderName = process.env.RESEND_FROM_NAME?.trim() || 'SmartCheckout';
      const intendedRecipient = customerEmail.toLowerCase().trim();

      // Em dev/local, evita falha por domínio não verificado no Resend.
      const preferredFromEmail = process.env.RESEND_FROM_EMAIL?.trim()
        || (process.env.NODE_ENV === 'production'
          ? 'noreply@smartcheckout.app'
          : 'onboarding@resend.dev');

      const fallbackFromEmail = process.env.RESEND_FALLBACK_FROM_EMAIL?.trim()
        || 'onboarding@resend.dev';
      const envTestRecipient = process.env.RESEND_TEST_RECIPIENT_EMAIL?.trim().toLowerCase() ?? '';

      const buildFromAddress = (email: string): string => `${senderName} <${email}>`;

      const sendEmail = async (fromEmail: string, toEmail: string) => resend.emails.send({
        from: buildFromAddress(fromEmail),
        to: [toEmail],
        subject: `✅ Seu acesso a "${productName}" está liberado!`,
        html: buildDeliveryEmailHtml(
          customerName.trim(),
          productName,
          accessLink,
          orderId,
        ),
      });

      let usedFromEmail = preferredFromEmail;
      let usedRecipient = intendedRecipient;

      if (process.env.NODE_ENV !== 'production' && envTestRecipient && envTestRecipient !== intendedRecipient) {
        console.warn(
          `[SmartCheckout] Ambiente de teste ativo: enviando e-mail para ${envTestRecipient} `
          + `(destino original do checkout: ${intendedRecipient}).`,
        );
        usedRecipient = envTestRecipient;
      }

      let { data: emailData, error: emailError } = await sendEmail(usedFromEmail, usedRecipient);

      if (
        emailError
        && isResendDomainNotVerifiedError(emailError)
        && preferredFromEmail.toLowerCase() !== fallbackFromEmail.toLowerCase()
      ) {
        console.warn(
          `[SmartCheckout] Domínio do remetente (${preferredFromEmail}) não verificado no Resend. `
          + `Tentando fallback com ${fallbackFromEmail}.`,
        );

        usedFromEmail = fallbackFromEmail;
        ({ data: emailData, error: emailError } = await sendEmail(usedFromEmail, usedRecipient));
      }

      if (emailError && isResendTestingRecipientRestrictionError(emailError) && process.env.NODE_ENV !== 'production') {
        const parsedTestRecipient = extractTestingAllowedRecipient(emailError.message);
        const testingRecipient = parsedTestRecipient || envTestRecipient;

        if (testingRecipient && testingRecipient !== usedRecipient) {
          console.warn(
            `[SmartCheckout] Resend em modo de teste permite apenas envio para ${testingRecipient}. `
            + `Reenviando e-mail de simulação (destino original: ${usedRecipient}).`,
          );

          usedRecipient = testingRecipient;
          ({ data: emailData, error: emailError } = await sendEmail(usedFromEmail, usedRecipient));
        }
      }

      if (emailError) {
        console.error('[SmartCheckout] Resend retornou erro:', emailError);
      } else {
        console.info(
          `[SmartCheckout] E-mail enviado via Resend para ${usedRecipient} `
          + `(messageId: ${emailData?.id ?? 'n/a'}).`,
        );

        // Marca entrega como realizada
        const { error: deliveredError } = await supabaseAdmin
          .from('orders')
          .update({ access_delivered: true })
          .eq('id', orderId);

        if (deliveredError) {
          console.error('[SmartCheckout] Erro ao marcar access_delivered:', deliveredError);
        }
      }
    } catch (emailException) {
      console.error('[SmartCheckout] Exceção no envio do e-mail:', emailException);
    }
  }

  res.status(200).json({
    success:       true,
    orderId,
    paymentMethod: 'credit_card',
    productName,
    customerEmail: customerEmail.toLowerCase().trim(),
  });
}
