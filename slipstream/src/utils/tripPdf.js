import { dayLabel, dateTimeLabel } from './format'

/**
 * A hand-rolled, dependency-free PDF writer for one purpose: laying out
 * plain text and rules on an A4 page. jsPDF was tried first, but its
 * transitive optional dependencies (html2canvas, canvg, dompurify — all for
 * an .html() rendering mode this feature never calls) added ~750KB to the
 * export chunk for what only needed doc.text()/doc.line(). The PDF format
 * itself is simple enough for this scope that writing it directly is the
 * lighter — and simpler — choice.
 *
 * Only the 14 standard PDF fonts (Helvetica/Helvetica-Bold here) are used,
 * so nothing needs to be embedded. Those fonts are WinAnsi (Latin-1-ish);
 * pdfSafe() strips anything outside that range — emoji and the → arrow —
 * so weather/notes text from the app never produces garbled glyphs.
 */
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48

function pdfSafe(str) {
  return String(str ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/️/gu, '')
    .replace(/[→➜➔]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[''‘’]/g, "'")
    .replace(/[""“”]/g, '"')
    .replace(/[^\x00-\xFF]/g, '')
    .trim()
}

function escapeLiteral(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

// No font metrics table — this only needs to be close enough to wrap text
// and right-align a short line without overflowing the page.
const AVG_CHAR_WIDTH = { regular: 0.5, bold: 0.56 }
const textWidth = (str, size, bold) => str.length * size * AVG_CHAR_WIDTH[bold ? 'bold' : 'regular']

function wrapText(str, maxWidth, size, bold) {
  const words = str.split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word
    if (line && textWidth(attempt, size, bold) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = attempt
    }
  }
  if (line) lines.push(line)
  return lines
}

class TripPdfBuilder {
  constructor() {
    this.pages = []
    this.startPage()
  }

  startPage() {
    this.ops = []
    this.pages.push(this.ops)
    this.y = PAGE_H - MARGIN
  }

  ensure(space) {
    if (this.y - space < MARGIN) this.startPage()
  }

  moveDown(pts) { this.y -= pts }

  text(str, { size = 11, bold = false, gray = 0, align = 'left' } = {}) {
    const safe = pdfSafe(str)
    if (!safe) return
    const x = align === 'right' ? PAGE_W - MARGIN - textWidth(safe, size, bold) : MARGIN
    this.ops.push(`${gray} g`)
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${this.y.toFixed(2)} Td (${escapeLiteral(safe)}) Tj ET`)
  }

  paragraph(str, { size = 10, bold = false, gray = 0.15, lineGap = 13 } = {}) {
    const safe = pdfSafe(str)
    if (!safe) return
    for (const line of wrapText(safe, PAGE_W - MARGIN * 2, size, bold)) {
      this.ensure(lineGap)
      this.text(line, { size, bold, gray })
      this.y -= lineGap
    }
  }

  hr() {
    this.ops.push(`0.85 G ${MARGIN.toFixed(2)} ${this.y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${this.y.toFixed(2)} l S`)
  }

  build() {
    const numPages = this.pages.length
    const pageObjNums = Array.from({ length: numPages }, (_, i) => 5 + i)
    const contentObjNums = Array.from({ length: numPages }, (_, i) => 5 + numPages + i)
    const objs = []

    objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    objs.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${numPages} >>\nendobj\n`)
    objs.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n')
    objs.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n')
    for (let i = 0; i < numPages; i++) {
      objs.push(
        `${pageObjNums[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>\nendobj\n`,
      )
    }
    for (let i = 0; i < numPages; i++) {
      const stream = this.pages[i].join('\n')
      objs.push(`${contentObjNums[i]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`)
    }

    let out = '%PDF-1.4\n'
    const offsets = [0]
    for (const obj of objs) {
      offsets.push(out.length)
      out += obj
    }
    const xrefStart = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
    return out
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Ride header, then one block per planned day with its place, notes and weather. */
export function downloadTripPdf(ride) {
  const doc = new TripPdfBuilder()

  doc.text(ride.name, { size: 20, bold: true })
  doc.moveDown(26)

  const routeLine = [ride.origin, ride.destination].filter(Boolean).join(' to ')
  if (routeLine) { doc.text(routeLine, { size: 11, gray: 0.35 }); doc.moveDown(16) }
  doc.text(`Starts ${dateTimeLabel(ride.startsAt)}`, { size: 11, gray: 0.35 }); doc.moveDown(16)
  if (ride.tripEndsAt) { doc.text(`Ends ${dayLabel(ride.tripEndsAt)}`, { size: 11, gray: 0.35 }); doc.moveDown(16) }
  if (ride.distanceKm) { doc.text(`${Math.round(ride.distanceKm)} km`, { size: 11, gray: 0.35 }); doc.moveDown(16) }
  doc.moveDown(8)
  doc.hr()
  doc.moveDown(24)

  const days = ride.days ?? []
  if (!days.length) {
    doc.text('No day-by-day plan was set for this ride.', { size: 12 })
  }

  for (const d of days) {
    doc.ensure(70)
    doc.text(`Day ${d.index} - ${dayLabel(d.date)}`, { size: 13, bold: true })
    if (d.weather) {
      const summary = [d.weather.condition, `${d.weather.tempMinC}-${d.weather.tempMaxC} C`, !d.weather.isForecast && '(typical)']
        .filter(Boolean).join(' ')
      doc.text(summary, { size: 10, gray: 0.4, align: 'right' })
    }
    doc.moveDown(18)
    if (d.place) { doc.text(d.place, { size: 11, bold: true }); doc.moveDown(16) }
    if (d.notes) doc.paragraph(d.notes)
    doc.moveDown(14)
  }

  const bytes = doc.build()
  const blob = new Blob([Uint8Array.from(bytes, (c) => c.charCodeAt(0))], { type: 'application/pdf' })
  const filename = `${ride.name.replace(/[^\w\- ]/g, '').trim() || 'trip'}-summary.pdf`
  triggerDownload(blob, filename)
}
