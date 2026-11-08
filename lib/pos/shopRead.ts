import { shopCatalog } from './shopMath';

export const SHOP_CONNECTION_MESSAGE = 'Could not load the products because the connection dropped. Reload this page.';

export class ShopReadError extends Error {
  readonly denied: boolean;

  constructor(message: string, denied = false) {
    super(message);
    this.denied = denied;
  }
}

export const withTimeout = <T,>(work: Promise<T>, ms: number, message: string): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new ShopReadError(message)), ms);
  work.then((value) => {
    clearTimeout(timer);
    resolve(value);
  }, (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

/** Firestore's REST reply uses typed values. The register needs the plain shop fields. */
export const decodeFirestoreValue = (value: unknown): unknown => {
  const record = asRecord(value);
  if (!record) return undefined;
  if ('stringValue' in record) return record.stringValue;
  if ('integerValue' in record) return Number(record.integerValue);
  if ('doubleValue' in record) return Number(record.doubleValue);
  if ('booleanValue' in record) return record.booleanValue;
  if ('nullValue' in record) return null;
  if ('timestampValue' in record) return record.timestampValue;
  if ('mapValue' in record) {
    const fields = asRecord(asRecord(record.mapValue)?.fields) ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, decodeFirestoreValue(entry)]));
  }
  if ('arrayValue' in record) {
    const values = asRecord(record.arrayValue)?.values;
    return Array.isArray(values) ? values.map((entry) => decodeFirestoreValue(entry)) : [];
  }
  return undefined;
};

export const decodeFirestoreDocument = (body: unknown): Record<string, unknown> | null => {
  const fields = asRecord(asRecord(body)?.fields);
  if (!fields) return null;
  const decoded = decodeFirestoreValue({ mapValue: { fields } });
  return asRecord(decoded);
};

export const firestoreDocumentUrl = (projectId: string, documentPath: string) => (
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${documentPath}`
);

export const shopDocumentPath = (ownerUid: string) => ['users', ownerUid, 'pos', 'data'].map((part) => encodeURIComponent(part)).join('/');

export const membershipQueryUrl = (projectId: string) => (
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`
);

const tryTwice = async <T,>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ShopReadError && error.denied) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return work();
  }
};

const readRestBody = async (response: Response) => {
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new ShopReadError('Missing permission to open this shop.', true);
  }
  if (!response.ok) throw new ShopReadError(SHOP_CONNECTION_MESSAGE);
  return response.json();
};

export const fetchFirestoreDocument = async (
  projectId: string,
  documentPath: string,
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> => tryTwice(async () => {
  const response = await fetchImpl(firestoreDocumentUrl(projectId, documentPath), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const body = await readRestBody(response);
  if (!body) return null;
  return decodeFirestoreDocument(body) ?? {};
});

export const fetchMembershipsByEmail = async (
  projectId: string,
  email: string,
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> => tryTwice(async () => {
  const response = await fetchImpl(membershipQueryUrl(projectId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'shopMemberships' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'email' },
            op: 'EQUAL',
            value: { stringValue: email },
          },
        },
      },
    }),
  });
  const body = await readRestBody(response);
  if (!Array.isArray(body)) return [];
  return body.flatMap((row) => {
    const document = decodeFirestoreDocument(asRecord(row)?.document);
    return document ? [document] : [];
  });
});

/**
 * Open the shop from the signed-in SDK read.
 * The backup stays idle unless that read drops, so a working register does not send a second document request.
 */
export const preferShopRead = async (
  primary: Promise<Record<string, unknown> | null>,
  backup: () => Promise<Record<string, unknown> | null>,
  denied: (error: unknown) => boolean,
): Promise<Record<string, unknown> | null> => {
  try {
    return await primary;
  } catch (error) {
    if (denied(error)) throw error;
    return backup();
  }
};

/** Use the first reply that actually has the shelf. A dropped listen channel must not hide it. */
export const firstShopRecord = (reads: Promise<Record<string, unknown> | null>[]): Promise<Record<string, unknown> | null> => new Promise((resolve, reject) => {
  let open = reads.length;
  let finished = false;
  let sawMissing = false;
  let plain: Record<string, unknown> | null = null;
  let failure: unknown;
  const finish = (value: Record<string, unknown> | null) => {
    if (finished) return;
    finished = true;
    resolve(value);
  };
  const fail = (error: unknown) => {
    if (finished) return;
    finished = true;
    reject(error);
  };
  if (open === 0) {
    finish(null);
    return;
  }
  reads.forEach((read) => {
    read.then((value) => {
      if (finished) return;
      if (value && shopCatalog(value).products.length > 0) {
        finish(value);
        return;
      }
      if (value) plain = value;
      if (value === null) sawMissing = true;
      open -= 1;
      if (open === 0) finish(plain);
    }, (error) => {
      if (finished) return;
      failure = error instanceof ShopReadError && error.denied ? error : (failure ?? error);
      open -= 1;
      if (open === 0) {
        if (plain) finish(plain);
        else if (sawMissing && !(failure instanceof ShopReadError && failure.denied)) finish(null);
        else fail(failure);
      }
    });
  });
});
