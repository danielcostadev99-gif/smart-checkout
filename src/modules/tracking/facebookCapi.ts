import { createHash } from 'node:crypto';

import type { MetaCapiOrderData } from '@/src/types';

export type MetaEventName = 'InitiateCheckout' | 'Purchase';

type MetaUserData = {
  client_ip_address: string;
  client_user_agent: string;
  fbp: string;
  fbc: string;
  em?: string[];
  ph?: string[];
  external_id?: string[];
  fn?: string[];
  ln?: string[];
};

type MetaCustomData = {
  value?: number;
  currency?: 'BRL';
};

type MetaEventPayload = {
  event_name: MetaEventName;
  event_time: number;
  action_source: 'website';
  event_id: string;
  user_data: MetaUserData;
  custom_data?: MetaCustomData;
};

type MetaApiBody = {
  data: MetaEventPayload[];
};

function normalizeValue(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeDigits(value: string | null | undefined): string {
  return normalizeValue(value).replace(/\D/g, '');
}

function logDev(message: string, payload?: unknown): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  if (payload === undefined) {
    console.info(`[SmartCheckout][MetaCAPI] ${message}`);
    return;
  }

  console.info(`[SmartCheckout][MetaCAPI] ${message}`, payload);
}

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashIfPresent(value: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return [hashSha256(value)];
}

function buildDerivedFbc(orderData: MetaCapiOrderData): string {
  const fbclid = normalizeValue(orderData.fbclid);
  if (!fbclid) {
    return '';
  }

  const createdAt = orderData.created_at ? Date.parse(orderData.created_at) : NaN;
  const timestamp = Number.isFinite(createdAt) ? createdAt : Date.now();
  return `fb.1.${timestamp}.${fbclid}`;
}

function buildUserData(orderData: MetaCapiOrderData): MetaUserData {
  const fullName = normalizeValue(orderData.customer_name).toLowerCase();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const normalizedEmail = normalizeValue(orderData.customer_email).toLowerCase();
  const normalizedPhone = normalizeDigits(orderData.customer_phone);
  const normalizedCpf = normalizeDigits(orderData.customer_cpf);
  const clientIp = normalizeValue(orderData.client_ip);
  const clientUserAgent = normalizeValue(orderData.client_user_agent);
  const fbp = normalizeValue(orderData.fbp);
  const fbc = normalizeValue(orderData.fbc) || buildDerivedFbc(orderData);

  return {
    client_ip_address: clientIp,
    client_user_agent: clientUserAgent,
    fbp,
    fbc,
    em: hashIfPresent(normalizedEmail),
    ph: hashIfPresent(normalizedPhone),
    external_id: hashIfPresent(normalizedCpf),
    fn: hashIfPresent(firstName),
    ln: hashIfPresent(lastName),
  };
}

function buildPayload(eventName: MetaEventName, orderData: MetaCapiOrderData): MetaEventPayload {
  const payload: MetaEventPayload = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_id: `${orderData.id}:${eventName}`,
    user_data: buildUserData(orderData),
  };

  if (eventName === 'Purchase') {
    payload.custom_data = {
      value: Number(orderData.total_amount ?? 0),
      currency: 'BRL',
    };
  }

  return payload;
}

export async function sendMetaCapiEvent(
  eventName: MetaEventName,
  orderData: MetaCapiOrderData,
  pixelId: string,
  accessToken: string,
): Promise<void> {
  const normalizedPixelId = normalizeValue(pixelId);
  const normalizedAccessToken = normalizeValue(accessToken);

  if (!normalizedPixelId || !normalizedAccessToken) {
    logDev('Skipping send because pixel/access token is missing.', {
      eventName,
      orderId: orderData.id,
      hasPixelId: Boolean(normalizedPixelId),
      hasAccessToken: Boolean(normalizedAccessToken),
    });
    return;
  }
  const payload = buildPayload(eventName, orderData);
  const body: MetaApiBody = { data: [payload] };
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(normalizedPixelId)}/events?access_token=${encodeURIComponent(normalizedAccessToken)}`;

  // Capture payload JSON before sending
  const payloadJson = JSON.stringify(body, null, 2);

  try {
    // Perform the POST request and capture response
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payloadJson,
    });

    // Try to parse JSON response, fallback to text
    let responseJson: unknown;
    try {
      responseJson = await response.json();
    } catch (parseErr) {
      const text = await response.text();
      responseJson = { __raw: text };
    }

    // Structured tracking log (always printed for audit)
    console.log('\n[META CAPI TRACKING LOG]');
    console.log('Event:', eventName);
    console.log('Pixel ID:', normalizedPixelId);
    console.log('Payload:', payloadJson);
    console.log('Response:', JSON.stringify(responseJson, null, 2));

    // Detect error object in Meta response
    const asAny = responseJson as any;
    if (asAny && (asAny.error || !response.ok)) {
      console.error('[META CAPI ERROR]', {
        eventName,
        pixelId: normalizedPixelId,
        status: response.status,
        body: asAny,
      });
    }

    // Also log success in development for convenience
    logDev('Meta CAPI request completed', {
      eventName,
      orderId: orderData.id,
      pixelId: normalizedPixelId,
      ok: response.ok,
      status: response.status,
    });
  } catch (err) {
    console.error('[META CAPI CRITICAL FAILURE]', {
      eventName,
      orderId: orderData.id,
      pixelId: normalizedPixelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}