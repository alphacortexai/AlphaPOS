const MAX_FILE_BYTES = 12_000_000;
const MAX_CHARS = 900_000;

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

const jpeg = (image: HTMLImageElement, edge: number, quality: number) => {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not read that photo.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
};

export const prepareCatalogPhoto = async (file: File) => {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo of the list or receipt.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too large. Use one under 12 MB.');
  const image = await loadImage(await readFile(file));
  let edge = 1800;
  let quality = 0.82;
  let dataUrl = jpeg(image, edge, quality);
  for (let attempt = 0; dataUrl.length > MAX_CHARS && attempt < 5; attempt += 1) {
    edge = Math.round(edge * 0.75);
    quality = Math.max(0.5, quality - 0.08);
    dataUrl = jpeg(image, edge, quality);
  }
  if (dataUrl.length > MAX_CHARS) throw new Error('That photo is still too large to read. Move closer and try again.');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { mimeType: 'image/jpeg' as const, base64 };
};
