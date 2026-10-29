/** Phone photos are 3-12 MB; this keeps them around 100-200 KB before they are stored. */
export const PHOTO_MAX_SIDE = 1280
export const THUMB_MAX_SIDE = 240

export interface CompressedPhoto {
  blob: Blob
  thumb: Blob
  width: number
  height: number
}

/** Scale (width, height) down so the longer side is at most maxSide. Never scales up. */
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number) {
  const size = fitWithin(bitmap.width, bitmap.height, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new Error('Foto tidak bisa diproses.')
  return { blob, ...size }
}

/** Turn a camera photo upright, shrink it, and make a small thumbnail for lists. */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const photo = await encode(bitmap, PHOTO_MAX_SIDE, 0.8)
    const thumb = await encode(bitmap, THUMB_MAX_SIDE, 0.7)
    return { blob: photo.blob, thumb: thumb.blob, width: photo.width, height: photo.height }
  } finally {
    bitmap.close()
  }
}
