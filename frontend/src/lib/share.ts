/**
 * Share a PDF through the phone's share sheet (WhatsApp, Gmail, ...).
 * Where sharing files is not possible (most computers), the PDF is downloaded instead.
 */
export async function sharePdf(
  pdf: Blob,
  filename: string,
  text: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([pdf], filename, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  downloadBlob(pdf, filename)
  return 'downloaded'
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** WhatsApp and email links with a short text; the PDF is attached by hand on a computer. */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function emailLink(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
