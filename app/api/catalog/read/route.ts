import { NextResponse } from 'next/server';
import { LOCAL_OPERATOR_ID } from '../../../../lib/pos/localShop';
import { catalogPrompt, parseCatalogReading, readJsonObject, type CatalogMode } from '../../../../lib/catalog/reading';

export const runtime = 'nodejs';

const MAX_IMAGE_CHARS = 1_200_000;

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

const readWithGemini = async (apiKey: string, model: string, prompt: string, mimeType: string, image: string) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: image } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(providerError(await response.text()) || 'The photo could not be read.');
  return geminiText(await response.json());
};

const readWithOpenAI = async (apiKey: string, model: string, prompt: string, mimeType: string, image: string) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(providerError(await response.text()) || 'The photo could not be read.');
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  return payload.choices?.[0]?.message?.content || '';
};

export async function POST(request: Request) {
  let body: { mode?: unknown; mimeType?: unknown; image?: unknown; productNames?: unknown; idToken?: unknown; shopOwnerUid?: unknown; localCounter?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'That photo could not be read.' }, { status: 400 });
  }

  const mode: CatalogMode | null = body.mode === 'create' || body.mode === 'prices' ? body.mode : null;
  const mimeType = body.mimeType === 'image/jpeg' || body.mimeType === 'image/png' || body.mimeType === 'image/webp' ? body.mimeType : '';
  const image = typeof body.image === 'string' ? body.image : '';
  if (!mode || !mimeType || image.length < 32 || image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ ok: false, error: 'Choose a photo of a product list or a purchase receipt.' }, { status: 400 });
  }

  if (body.localCounter === true) {
    if (process.env.CATALOG_ASSISTANT_ALLOW_LOCAL === 'false' || body.shopOwnerUid !== LOCAL_OPERATOR_ID) {
      return NextResponse.json({ ok: false, error: 'Sign in as the shop owner to use the assistant.' }, { status: 401 });
    }
  } else {
    const uid = await callerUid(typeof body.idToken === 'string' ? body.idToken : '');
    if (!uid || uid !== body.shopOwnerUid) {
      return NextResponse.json({ ok: false, error: 'Only the shop owner can use the product assistant.' }, { status: 401 });
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || '';
  const requested = process.env.CATALOG_ASSISTANT_PROVIDER?.trim().toLowerCase();
  const useOpenAI = requested === 'openai' || (!requested && !geminiKey && Boolean(openaiKey));
  const apiKey = useOpenAI ? openaiKey : geminiKey;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'The product assistant is not switched on yet. Add a Gemini or OpenAI key on the server.' }, { status: 503 });
  }

  const productNames = Array.isArray(body.productNames)
    ? body.productNames.flatMap((name) => (typeof name === 'string' && name.trim() ? [name.trim().slice(0, 80)] : [])).slice(0, 200)
    : [];
  const model = process.env.CATALOG_ASSISTANT_MODEL?.trim() || (useOpenAI ? 'gpt-4o-mini' : 'gemini-2.5-flash');

  try {
    const raw = useOpenAI
      ? await readWithOpenAI(apiKey, model, catalogPrompt(mode, productNames), mimeType, image)
      : await readWithGemini(apiKey, model, catalogPrompt(mode, productNames), mimeType, image);
    const reading = parseCatalogReading(readJsonObject(raw));
    return NextResponse.json({ ok: true, ...reading });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'The photo could not be read.';
    return NextResponse.json({ ok: false, error: message.slice(0, 180) }, { status: 502 });
  }
}
