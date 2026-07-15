import Stripe from 'npm:stripe@17.7.0';
import { admin, handleError, json, preflight, requireUser, ResponseError } from '../_shared/server.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '');
const products: Record<string, { amount: number; name: string }> = {
  basic: { amount: 600, name: 'Hidden Line Basic Pass' },
  premium: { amount: 1200, name: 'Hidden Line Premium Pass' },
};

Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  try {
    const user = await requireUser(request); const { tier } = await request.json(); const product = products[tier];
    if (!product) throw new ResponseError(400, '商品が正しくありません。');
    const origin = Deno.env.get('APP_ORIGIN') || 'https://hiddenline.vercel.app';
    const session = await stripe.checkout.sessions.create({ mode: 'payment', customer_email: user.email,
      line_items: [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: product.amount, product_data: { name: product.name } } }],
      metadata: { user_id: user.id, tier }, success_url: `${origin}/?purchase=success`, cancel_url: `${origin}/?purchase=cancelled` });
    await admin.from('purchases').insert({ user_id: user.id, product_key: tier, amount_jpy: product.amount, status: 'pending', provider_session_id: session.id });
    return json({ url: session.url });
  } catch (error) { return handleError(error); }
});
