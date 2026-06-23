import { Resend } from 'resend';

type ResendErrorLike = {
  name?: string;
  message?: string;
  statusCode?: number;
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>\"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '\"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

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

function buildDeliveryEmailHtml(
  customerName: string,
  productName: string,
  accessLink: string,
  orderId: string,
): string {
  const safeName = escapeHtml(customerName);
  const safeProduct = escapeHtml(productName);
  const safeOrderId = escapeHtml(orderId);
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
          <tr>
            <td style="background:#059669;padding:36px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">✅</div>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Compra Aprovada!</h1>
              <p style="margin:10px 0 0;color:#d1fae5;font-size:14px;">Seu pagamento foi confirmado com sucesso</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:17px;color:#111827;font-weight:600;">Ola, ${safeName}! 🎉</p>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.7;">
                Seu pagamento referente ao produto <strong style="color:#111827;">${safeProduct}</strong>
                foi confirmado. Clique no botao abaixo para acessar agora mesmo:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#059669;border-radius:12px;">
                    <a href="${safeAccessLink}" style="display:inline-block;padding:18px 44px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      ACESSAR MEU PRODUTO AGORA
                    </a>
                  </td>
                </tr>
              </table>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">Ou copie o link diretamente:</p>
                <a href="${safeAccessLink}" style="color:#059669;font-size:13px;word-break:break-all;font-family:monospace;">${safeAccessLink}</a>
              </div>
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px;margin-bottom:28px;">
                <p style="margin:0;font-size:13px;color:#065f46;line-height:1.7;">Numero do pedido: <strong>${safeOrderId}</strong></p>
              </div>
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

export interface DeliveryEmailInput {
  orderId: string;
  customerName: string;
  customerEmail: string;
  productName: string;
  accessLink: string;
}

export interface DeliveryEmailResult {
  sent: boolean;
  recipientUsed: string;
  messageId?: string;
  error?: unknown;
}

export async function sendDeliveryEmail(input: DeliveryEmailInput): Promise<DeliveryEmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.error('[SmartCheckout] RESEND_API_KEY nao configurada.');
    return {
      sent: false,
      recipientUsed: input.customerEmail.toLowerCase().trim(),
      error: new Error('RESEND_API_KEY nao configurada.'),
    };
  }

  const resend = new Resend(resendApiKey);
  const senderName = process.env.RESEND_FROM_NAME?.trim() || 'SmartCheckout';
  const intendedRecipient = input.customerEmail.toLowerCase().trim();
  const preferredFromEmail = process.env.RESEND_FROM_EMAIL?.trim()
    || (process.env.NODE_ENV === 'production' ? 'noreply@smartcheckout.app' : 'onboarding@resend.dev');
  const fallbackFromEmail = process.env.RESEND_FALLBACK_FROM_EMAIL?.trim() || 'onboarding@resend.dev';
  const envTestRecipient = process.env.RESEND_TEST_RECIPIENT_EMAIL?.trim().toLowerCase() ?? '';

  const buildFromAddress = (email: string): string => `${senderName} <${email}>`;

  const sendEmail = async (fromEmail: string, toEmail: string) => resend.emails.send({
    from: buildFromAddress(fromEmail),
    to: [toEmail],
    subject: `Seu acesso a \"${input.productName}\" esta liberado!`,
    html: buildDeliveryEmailHtml(
      input.customerName,
      input.productName,
      input.accessLink,
      input.orderId,
    ),
  });

  let usedFromEmail = preferredFromEmail;
  let usedRecipient = intendedRecipient;

  if (process.env.NODE_ENV !== 'production' && envTestRecipient && envTestRecipient !== intendedRecipient) {
    console.warn(
      `[SmartCheckout] Ambiente de teste ativo: enviando e-mail para ${envTestRecipient} `
      + `(destino original: ${intendedRecipient}).`,
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
      `[SmartCheckout] Dominio do remetente (${preferredFromEmail}) nao verificado no Resend. `
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
        `[SmartCheckout] Resend em modo de teste permite envio para ${testingRecipient}. `
        + `Reenviando (destino original: ${usedRecipient}).`,
      );

      usedRecipient = testingRecipient;
      ({ data: emailData, error: emailError } = await sendEmail(usedFromEmail, usedRecipient));
    }
  }

  if (emailError) {
    console.error('[SmartCheckout] Resend retornou erro:', emailError);
    return {
      sent: false,
      recipientUsed: usedRecipient,
      error: emailError,
    };
  }

  console.info(`[SmartCheckout] E-mail enviado via Resend para ${usedRecipient} (messageId: ${emailData?.id ?? 'n/a'}).`);

  return {
    sent: true,
    recipientUsed: usedRecipient,
    messageId: emailData?.id,
  };
}
