import { randomInt } from 'node:crypto'

export const UKURAN_SLOT = [4, 8, 16, 32]

// Acak (Fisher-Yates) tanpa mengubah array asli. randInt(n) mengembalikan 0..n-1
export function acak(daftar, randInt = (n) => randomInt(n)) {
  const a = [...daftar]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Slot yang masuk akal untuk N pemain: tidak boleh ada pot yang semuanya BYE (butuh N > slot/2)
export function slotYangBisa(jumlahPemain) {
  return UKURAN_SLOT.filter((s) => jumlahPemain > s / 2)
}

export function namaBabak(jumlahPot) {
  const nama = { 1: 'FINAL', 2: 'SEMIFINAL', 4: 'PEREMPAT FINAL', 8: '16 BESAR', 16: '32 BESAR' }
  return nama[jumlahPot] ?? `BABAK ${jumlahPot * 2} BESAR`
}

// pemain: array apa saja (id/jid). Mengembalikan:
//  babak1   : [{ no, a, b }]  (b = null artinya BYE, a lolos otomatis)
//  lanjutan : [{ nama, pot: [{ no, a: 'WIN POT x', b: 'WIN POT y' }] }]
//  cadangan : pemain yang tidak kebagian slot (kalau yang di-tag lebih banyak dari slot)
export function buatBracket(pemain, slot, randInt) {
  const jumlahPot = slot / 2
  const diacak = acak(pemain, randInt)
  const peserta = diacak.slice(0, slot)
  const cadangan = diacak.slice(slot)

  const bye = slot - peserta.length
  if (!UKURAN_SLOT.includes(slot) || bye >= jumlahPot) {
    throw new Error(`slot ${slot} tidak cocok untuk ${peserta.length} pemain`)
  }

  // Pot yang dapat BYE dipilih acak, supaya tidak selalu di urutan terakhir
  const potBye = new Set(acak([...Array(jumlahPot).keys()], randInt).slice(0, bye))
  const babak1 = []
  let k = 0
  for (let i = 0; i < jumlahPot; i++) {
    if (potBye.has(i)) {
      babak1.push({ no: i + 1, a: peserta[k++], b: null })
    } else {
      babak1.push({ no: i + 1, a: peserta[k++], b: peserta[k++] })
    }
  }

  const lanjutan = []
  let sebelumnya = babak1.map((p) => p.no)
  let noBerikut = jumlahPot + 1
  while (sebelumnya.length > 1) {
    const urutan = acak(sebelumnya, randInt) // pasangan antar pot diacak
    const pot = []
    for (let i = 0; i < urutan.length; i += 2) {
      pot.push({ no: noBerikut++, a: `WIN POT ${urutan[i]}`, b: `WIN POT ${urutan[i + 1]}` })
    }
    lanjutan.push({ nama: namaBabak(pot.length), pot })
    sebelumnya = pot.map((p) => p.no)
  }

  return { slot, namaBabak1: namaBabak(jumlahPot), babak1, lanjutan, cadangan, jumlahBye: bye }
}
