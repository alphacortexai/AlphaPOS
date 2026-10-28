const LOCAL_PRODUCT_IMAGES_KEY = 'alphapos.local.images.v1';
const MAX_IMAGE_CHARS = 24_000;

export const PRODUCT_IMAGE_DOC_MAX_CHARS = 720_000;

export const isProductImage = (value: unknown): value is string => (
  typeof value === 'string'
  && value.startsWith('data:image/jpeg;base64,')
  && value.length > 30
  && value.length <= MAX_IMAGE_CHARS
);

export const normalizeImageMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const images: Record<string, string> = {};
  for (const [id, image] of Object.entries(value)) {
    if (id && isProductImage(image)) images[id] = image;
  }
  return images;
};

export const imageMapChars = (images: Record<string, string>) => (
  Object.values(images).reduce((sum, image) => sum + image.length, 0)
);

export const splitProductImages = <T extends { id: string; image?: string }>(products: T[]) => {
  const images: Record<string, string> = {};
  const slim = products.map((product) => {
    if (isProductImage(product.image)) images[product.id] = product.image;
    if (!('image' in product)) return product;
    const rest = { ...product };
    delete rest.image;
    return rest;
  });
  return { products: slim, images };
};

export const attachProductImages = <T extends { id: string; image?: string }>(products: T[], stored: unknown): T[] => {
  const images = normalizeImageMap(stored);
  return products.map((product) => {
    const image = images[product.id] || (isProductImage(product.image) ? product.image : undefined);
    if (!image) {
      if (!product.image) return product;
      const rest = { ...product };
      delete rest.image;
      return rest;
    }
    return { ...product, image };
  });
};

export const readLocalProductImages = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_PRODUCT_IMAGES_KEY);
    return normalizeImageMap(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
};

export const writeLocalProductImages = (images: Record<string, string>) => {
  window.localStorage.setItem(LOCAL_PRODUCT_IMAGES_KEY, JSON.stringify(normalizeImageMap(images)));
};

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') resolve(reader.result);
    else reject(new Error('Could not read that photo.'));
  };
  reader.onerror = () => reject(new Error('Could not read that photo.'));
  reader.readAsDataURL(file);
});

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not read that photo.'));
  image.src = src;
});

const paintPhoto = (image: HTMLImageElement, edge: number, quality: number) => {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare that photo.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
};

export const compressProductPhoto = async (file: File) => {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photo smaller than 12 MB.');
  const image = await loadImage(await readFile(file));
  let edge = 320;
  let quality = 0.72;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const url = paintPhoto(image, edge, quality);
    if (isProductImage(url)) return url;
    edge = Math.round(edge * 0.72);
    quality = Math.max(0.42, quality - 0.08);
  }
  throw new Error('That photo is too detailed to keep. Try another picture.');
};
