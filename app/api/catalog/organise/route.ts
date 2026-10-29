import { NextResponse } from 'next/server';
import { LOCAL_OPERATOR_ID } from '../../../../lib/pos/localShop';
import { organisePrompt, readOrganiseModel, readOrganiseRequest } from '../../../../lib/catalog/organise';

export const runtime = 'nodejs';

const callerUid = async (idToken: string) => {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey || !idToken) return '';
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return '';
  const payload = await response.json() as { users?: { localId?: string }[] };
  return payload.users?.[0]?.localId || '';
};

const providerError = (detail: string) => detail.replace(/AIza[\w-]+/g, '').replace(/sk-[\w-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);

const geminiText = (payload: unknown) => {
  const candidates = (payload as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
};

const askGemini = async (apiKey: string, model: string, prompt: string) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(providerError(await response.text()) || 'Categories could not be suggested.');
  return geminiText(await response.json());
};

const askOpenAI = async (apiKey: string, model: string, prompt: string) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(providerError(await response.text()) || 'Categories could not be suggested.');
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  return payload.choices?.[0]?.message?.content || '';
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Those products could not be organised.' }, { status: 400 });
  }

  const record = body && typeof body === 'object' ? body as { idToken?: unknown; shopOwnerUid?: unknown; localCounter?: unknown; geminiKey?: unknown } : {};
  if (record.localCounter === true) {
    if (process.env.CATALOG_ASSISTANT_ALLOW_LOCAL === 'false' || record.shopOwnerUid !== LOCAL_OPERATOR_ID) {
      return NextResponse.json({ ok: false, error: 'Sign in as the shop owner to use the assistant.' }, { status: 401 });
    }
  } else {
    const uid = await callerUid(typeof record.idToken === 'string' ? record.idToken : '');
    if (!uid || uid !== record.shopOwnerUid) {
      return NextResponse.json({ ok: false, error: 'Only the shop owner can use the product assistant.' }, { status: 401 });
    }
  }

  const shelf = readOrganiseRequest(body);
  if ('error' in shelf) return NextResponse.json({ ok: false, error: shelf.error }, { status: 400 });

  const pasted = typeof record.geminiKey === 'string' ? record.geminiKey.trim() : '';
  const ownerKey = pasted.length >= 20 && pasted.length <= 200 && !/\s/.test(pasted) ? pasted : '';
  const geminiKey = ownerKey || process.env.GEMINI_API_KEY?.trim() || '';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';
  const requested = process.env.CATALOG_ASSISTANT_PROVIDER?.trim().toLowerCase();
  const useOpenAI = !ownerKey && (requested === 'openai' || (!requested && !geminiKey && Boolean(openaiKey)));
  const apiKey = useOpenAI ? openaiKey : geminiKey;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Paste a Gemini API key in Settings, under Assistant.' }, { status: 503 });
  }

  const configuredModel = (process.env.CATALOG_ASSISTANT_MODEL?.trim() || '').replace(/^models\//, '');
  const model = !configuredModel || configuredModel === 'gemini-2.5-flash'
    ? (useOpenAI ? 'gpt-4o-mini' : 'gemini-3.8-flash')
    : configuredModel;
  const ids = shelf.products.map((product) => product.id);

  try {
    const raw = useOpenAI
      ? await askOpenAI(apiKey, model, organisePrompt(shelf.products, shelf.categories))
      : await askGemini(apiKey, model, organisePrompt(shelf.products, shelf.categories));
    const assignments = readOrganiseModel(raw, ids, shelf.categories);
    return NextResponse.json({ ok: true, assignments });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Categories could not be suggested.';
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502 });
  }
}
