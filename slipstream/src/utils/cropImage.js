/**
 * Center-crops whatever photo a rider picks down to a square and re-encodes
 * it at a fixed size, so every profile picture is well-framed and small
 * regardless of the source image's aspect ratio or resolution — no manual
 * crop UI to build or use.
 */
export function cropToSquare(file, size = 480) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2

      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))),
        'image/jpeg',
        0.88,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}
