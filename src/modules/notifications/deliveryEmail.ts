import nodemailer from 'nodemailer';

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

function buildDeliveryEmailHtml(
  customerName: string,
  productName: string,
  productDownloadUrl: string,
  orderId: string,
): string {
  const safeName = escapeHtml(customerName);
  const safeProduct = escapeHtml(productName);
  const safeOrderId = escapeHtml(orderId);
  const safeProductDownloadUrl = escapeHtml(productDownloadUrl);

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
                    <a href="${safeProductDownloadUrl}" style="display:inline-block;padding:18px 44px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      ACESSAR MEU PRODUTO AGORA
                    </a>
                  </td>
                </tr>
              </table>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">Ou copie o link diretamente:</p>
                <a href="${safeProductDownloadUrl}" style="color:#059669;font-size:13px;word-break:break-all;font-family:monospace;">${safeProductDownloadUrl}</a>
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
  productDownloadUrl: string;
}

export interface DeliveryEmailResult {
  sent: boolean;
  recipientUsed: string;
  messageId?: string;
  error?: unknown;
}

export async function sendDeliveryEmail(input: DeliveryEmailInput): Promise<DeliveryEmailResult> {
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_APP_PASSWORD?.trim();

  if (!smtpUser || !smtpPass) {
    console.error('[SmartCheckout] SMTP_USER ou SMTP_APP_PASSWORD nao configurados.');
    return {
      sent: false,
      recipientUsed: input.customerEmail.toLowerCase().trim(),
      error: new Error('SMTP_USER ou SMTP_APP_PASSWORD nao configurados.'),
    };
  }

  const senderName = process.env.SMTP_FROM_NAME?.trim() || 'SmartCheckout';
  const fromAddress = `${senderName} <${smtpUser}>`;
  const intendedRecipient = input.customerEmail.toLowerCase().trim();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: intendedRecipient,
      subject: `Seu acesso a "${input.productName}" esta liberado!`,
      html: buildDeliveryEmailHtml(
        input.customerName,
        input.productName,
        input.productDownloadUrl,
        input.orderId,
      ),
    });

    console.info(`[SmartCheckout] E-mail enviado via Gmail SMTP para ${intendedRecipient} (messageId: ${info.messageId ?? 'n/a'}).`);

    return {
      sent: true,
      recipientUsed: intendedRecipient,
      messageId: info.messageId,
    };
  } catch (err) {
    console.error('[SmartCheckout] Erro ao enviar e-mail via Gmail SMTP:', err);
    return {
      sent: false,
      recipientUsed: intendedRecipient,
      error: err,
    };
  }
}
