/**
 * Comprime una imagen en el NAVEGADOR antes de subirla: las fotos de celular
 * pesan 4-8MB y eso era la mitad de los ~10s del flujo Foto IMEI (subida lenta
 * + la IA leyendo una imagen gigante). A 1600px/JPEG 0.85 quedan ~200-400KB y
 * el codigo sigue perfectamente legible.
 *
 * Devuelve el archivo ORIGINAL si no es imagen, es GIF (animacion), ya es
 * liviano, o si algo falla (nunca bloquea la subida).
 */
export async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<File> {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    if (file.size < 400_000) return file; // ya es liviano

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
