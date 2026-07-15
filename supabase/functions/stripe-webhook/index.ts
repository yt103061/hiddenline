import Stripe from 'npm:stripe@17.7.0';
import { admin, handleError, json, preflight, ResponseError } from '../_shared/server.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '');
Deno.serve(async (request) => {
  const early = preflight(request); if (early) return early;
  let eventId = '';
  try {
    const signature = request.headers.get('stripe-signature'); if (!signature) throw new ResponseError(400, '署名がありません。');
    const body = await request.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, Deno.env.get('STRIPE_WEBHOOK_SECRET') || '');
    eventId = event.id;
    const { error: eventError } = await admin.from('webhook_events').insert({ event_id: event.id, event_type: event.type });
    if (eventError?.code === '23505') return json({ received: true, duplicate: true });
    if (eventError) throw eventError;
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session; const userId = session.metadata?.user_id; const tier = session.metadata?.tier;
      const { data: season } = await admin.from('seasons').select('id').eq('active', true).single();
      await admin.from('purchases').update({ status: 'paid', provider_event_id: event.id, provider_payment_intent: session.payment_intent, updated_at: new Date().toISOString(), season_id: season.id }).eq('provider_session_id', session.id);
      await admin.from('battle_pass_progress').update({ tier, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('season_id', season.id);
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const { data: purchase } = await admin.from('purchases').select('user_id,season_id').eq('provider_payment_intent', charge.payment_intent).maybeSingle();
      if (purchase) {
        await admin.from('purchases').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('provider_payment_intent', charge.payment_intent);
        await admin.from('battle_pass_progress').update({ tier: 'free', updated_at: new Date().toISOString() }).eq('user_id', purchase.user_id).eq('season_id', purchase.season_id);
      }
    }
    await admin.from('webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', event.id);
    return json({ received: true });
  } catch (error) {
    if (eventId) await admin.from('webhook_events').delete().eq('event_id', eventId);
    return handleError(error);
  }
});
