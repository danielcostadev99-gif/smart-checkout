import type { NextPage } from 'next';
import Head from 'next/head';
import { ShieldCheck, Zap, Mail } from 'lucide-react';

const HomePage: NextPage = () => {
  return (
    <>
      <Head>
        <title>SmartCheckout Engine</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <ShieldCheck className="w-10 h-10 text-emerald-500" />
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              SmartCheckout Engine
            </h1>
          </div>

          <p className="text-gray-400 text-sm mb-8 leading-relaxed">
            Motor de checkout de alta conversão para Direct Response.
            Os links de checkout são gerados dinamicamente por oferta.
          </p>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-left space-y-4">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
              Como acessar um checkout:
            </p>
            <code className="block bg-gray-800 text-emerald-400 text-sm rounded-xl px-4 py-3 font-mono">
              /pay/<span className="text-gray-400">&#123;offerId&#125;</span>
            </code>

            <div className="flex items-start gap-3 text-sm text-gray-400 pt-2">
              <Zap className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <span>Substitua <code className="text-emerald-400">offerId</code> pelo UUID da oferta cadastrada no Supabase.</span>
            </div>
            <div className="flex items-start gap-3 text-sm text-gray-400">
              <Mail className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <span>Após a aprovação, o link de acesso é entregue automaticamente por e-mail via Resend.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HomePage;
