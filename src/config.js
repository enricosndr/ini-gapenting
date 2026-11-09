import fs from 'node:fs'

// Baca file .env sederhana (tanpa dependensi tambahan)
function muatEnv(path = '.env') {
  if (!fs.existsSync(path)) return
  for (const baris of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || baris.trim().startsWith('#')) continue
    const nilai = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = nilai
  }
}

// Hanya angka; awalan 0 diganti 62 (Indonesia)
export function rapikanNomor(input) {
  let nomor = String(input).replace(/\D/g, '')
  if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1)
  return nomor
}

muatEnv()

export const config = {
  // Owner bot: boleh memakai /out /add /kick /rules.
  // Pesan dari akun bot sendiri (HP yang di-link) juga dianggap owner.
  nomorOwner: (process.env.NOMOR_OWNER || '')
    .split(',')
    .map(rapikanNomor)
    .filter(Boolean),
  // Gambar QRIS untuk command /pay (taruh file-nya di folder media)
  qrisFile: process.env.QRIS_FILE || 'media/qris.jpg',
  payTeks:
    process.env.PAY_TEKS ||
    'QRIS DANA ALLPAYMENT , HABIS TF KIRIM BUKTI TRANSFER SS DETAIL DAN WAJIB KELIATAN JAM NYA',
  // Isi pesan /rules (edit file ini kapan saja, tidak perlu restart bot)
  rulesFile: process.env.RULES_FILE || 'rules.txt',
}
