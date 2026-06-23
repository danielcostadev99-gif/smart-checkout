import type { NextApiRequest, NextApiResponse } from 'next';

import { getSupabaseAdmin } from '@/src/modules/database/supabaseAdmin';

type ServiceState = 'up' | 'degraded' | 'down';

interface ServiceReport {
  state: ServiceState;
  details: string;
  latencyMs?: number;
}

interface IntegrationsHealthResponse {
  ok: boolean;
  timestamp: string;
  environment: string;
  provider: string;
  checks: {
    supabase: ServiceReport;
    paymentProvider: ServiceReport;
    resend: ServiceReport;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedMs(start: number): number {
  return Date.now() - start;
}

function getPaymentProvider(): string {
  return (process.env.PAYMENT_PROVIDER ?? 'asaas').trim().toLowerCase();
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function checkSupabase(): Promise<ServiceReport> {
  const startedAt = Date.now();

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('offers')
      .select('id')
      .limit(1);

    if (error) {
      return {
        state: 'down',
        details: `Erro no Supabase: ${error.message}`,
        latencyMs: elapsedMs(startedAt),
      };
    }

    return {
      state: 'up',
      details: 'Conexao com Supabase operacional.',
      latencyMs: elapsedMs(startedAt),
    };
  } catch (error) {
    return {
      state: 'down',
      details: error instanceof Error ? error.message : 'Falha inesperada no Supabase.',
      latencyMs: elapsedMs(startedAt),
    };
  }
}

async function checkGateway(provider: string): Promise<ServiceReport> {
  const startedAt = Date.now();

  if (parseBooleanFlag(process.env.PAYMENT_SIMULATION_ENABLED)) {
    return {
      state: 'up',
      details: 'Modo de simulacao de pagamento ativo (PAYMENT_SIMULATION_ENABLED).',
      latencyMs: elapsedMs(startedAt),
    };
  }

  const apiKey = process.env.GATEWAY_API_KEY?.trim();
  const healthPath = process.env.PAYMENT_PROVIDER_HEALTH_PATH?.trim();

  if (!apiKey) {
    return {
      state: 'down',
      details: 'GATEWAY_API_KEY ausente.',
      latencyMs: elapsedMs(startedAt),
    };
  }

  if (!healthPath) {
    return {
      state: 'degraded',
      details: `Provider ${provider} configurado, sem PAYMENT_PROVIDER_HEALTH_PATH para ping HTTP.`,
      latencyMs: elapsedMs(startedAt),
    };
  }

  try {
    const timeoutMs = Number(process.env.GATEWAY_TIMEOUT_MS ?? '8000');

    const isAbsolute = healthPath.startsWith('http://') || healthPath.startsWith('https://');
    const asaasBase = (process.env.ASAAS_BASE_URL?.trim() || 'https://api.asaas.com').replace(/\/+$/, '');
    const appmaxBase = (process.env.APPMAX_BASE_URL?.trim() || 'https://api.appmax.com.br').replace(/\/+$/, '');
    const base = provider === 'appmax' ? `${appmaxBase}/v3` : `${asaasBase}/v3`;
    const normalizedHealthPath = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
    const url = isAbsolute ? healthPath : `${base}${normalizedHealthPath}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        access_token: apiKey,
        'x-api-key': apiKey,
      },
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 8000),
    });

    if (!response.ok) {
      return {
        state: 'degraded',
        details: `Gateway respondeu HTTP ${response.status} no health ping (${url}).`,
        latencyMs: elapsedMs(startedAt),
      };
    }

    return {
      state: 'up',
      details: `Gateway ${provider} acessivel em ${url}.`,
      latencyMs: elapsedMs(startedAt),
    };
  } catch (error) {
    return {
      state: 'degraded',
      details: error instanceof Error
        ? `Gateway sem resposta no ping: ${error.message}`
        : 'Gateway sem resposta no ping.',
      latencyMs: elapsedMs(startedAt),
    };
  }
}

async function checkResend(): Promise<ServiceReport> {
  const startedAt = Date.now();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();

  if (!resendApiKey) {
    return {
      state: 'down',
      details: 'RESEND_API_KEY ausente.',
      latencyMs: elapsedMs(startedAt),
    };
  }

  const fromName = process.env.RESEND_FROM_NAME?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();

  if (!fromName || !fromEmail) {
    return {
      state: 'degraded',
      details: 'RESEND_FROM_NAME ou RESEND_FROM_EMAIL nao configurados.',
      latencyMs: elapsedMs(startedAt),
    };
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        state: 'degraded',
        details: `Resend respondeu HTTP ${response.status} no check de dominio.`,
        latencyMs: elapsedMs(startedAt),
      };
    }

    return {
      state: 'up',
      details: 'Credenciais do Resend validadas.',
      latencyMs: elapsedMs(startedAt),
    };
  } catch (error) {
    return {
      state: 'degraded',
      details: error instanceof Error
        ? `Falha no check do Resend: ${error.message}`
        : 'Falha no check do Resend.',
      latencyMs: elapsedMs(startedAt),
    };
  }
}

function composeOverallOk(reports: ServiceReport[]): boolean {
  return reports.every((report) => report.state === 'up');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<IntegrationsHealthResponse>,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({
      ok: false,
      timestamp: nowIso(),
      environment: process.env.NODE_ENV ?? 'development',
      provider: getPaymentProvider(),
      checks: {
        supabase: { state: 'down', details: 'Method Not Allowed' },
        paymentProvider: { state: 'down', details: 'Method Not Allowed' },
        resend: { state: 'down', details: 'Method Not Allowed' },
      },
    });
    return;
  }

  const provider = getPaymentProvider();

  const [supabaseReport, paymentProviderReport, resendReport] = await Promise.all([
    checkSupabase(),
    checkGateway(provider),
    checkResend(),
  ]);

  const responseBody: IntegrationsHealthResponse = {
    ok: composeOverallOk([supabaseReport, paymentProviderReport, resendReport]),
    timestamp: nowIso(),
    environment: process.env.NODE_ENV ?? 'development',
    provider,
    checks: {
      supabase: supabaseReport,
      paymentProvider: paymentProviderReport,
      resend: resendReport,
    },
  };

  res.status(responseBody.ok ? 200 : 503).json(responseBody);
}
