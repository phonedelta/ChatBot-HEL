/**
 * Minimal PDF generator (text lines, Helvetica) — no external deps.
 */

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
}

/**
 * @param {string} title
 * @param {string[]} lines
 * @returns {Buffer}
 */
function buildSimplePdf(title, lines) {
  const contentLines = [
    'BT',
    '/F1 14 Tf',
    '50 800 Td',
    `(${escapePdfText(title)}) Tj`,
    '/F1 9 Tf',
    '0 -24 Td',
  ]

  for (const raw of lines.slice(0, 120)) {
    const line = escapePdfText(raw).slice(0, 110)
    contentLines.push(`(${line}) Tj`)
    contentLines.push('0 -12 Td')
  }
  contentLines.push('ET')

  const stream = `${contentLines.join('\n')}\n`
  const streamLen = Buffer.byteLength(stream, 'utf8')

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += obj
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefStart}\n%%EOF\n`

  return Buffer.from(pdf, 'utf8')
}

module.exports = {
  buildSimplePdf,
}
