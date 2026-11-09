import fs from 'node:fs/promises'
import { config, rapikanNomor } from './config.js'
import { buatBracket, slotYangBisa, UKURAN_SLOT } from './bracket.js'

const UMUR_MAKS_DETIK = 60 // pesan lebih lama dari ini diabaikan (cegah command lama terproses ulang saat reconnect)
const COOLDOWN_MS = 5000 // jeda /pay per orang per chat, supaya tidak bisa di-spam
const MAKS_TARGET = 10 // batas orang per sekali /add atau /kick

const SESI_MENUNGGU_MS = 10 * 60 * 1000 // /pot menunggu pilihan slot selama 10 menit
const SESI_ULANG_MS = 60 * 60 * 1000 // /pot ulang bisa dipakai sampai 1 jam setelah bracket jadi

// Semua command owner only, kecuali /pay
const OWNER_SAJA = new Set(['/out', '/add', '/kick', '/rules', '/pot'])
const SEMUA_PERINTAH = new Set(['/pay', ...OWNER_SAJA])

const sudahDiproses = new Set() // id pesan yang sudah ditangani
const terakhirPay = new Map()
const sesiPot = new Map() // chat -> { pemain: [{ jid, digits }], slot: null | 4 | 8 | 16 | 32, dibuat }

// Dipakai kalau file rules.txt tidak ditemukan
const RULES_BAWAAN = `- RULES ML BRAWL -

~ NO SMURF ( AKUN ML KALIAN WAJIB MEMILIKI HERO DI ATAS 50 )

~ BOLEH DADU/BOLEH ROLL HERO ( ICON DADU DI BAWAH HERO PAS MAIN BRAWL )

~ NO REMATCH ( SAAT ROOM SUDAH DI GAS GAK BOLEH RM )

~ BOLEH PUSH ( KARENA HARUS PUSH TURET DAN END BARU BISA WIN )`

const digits = (jid) => String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')

// ---------- Membaca pesan ----------

// Buka pembungkus pesan (mode pesan sementara / sekali lihat)
function isiPesan(message) {
  let m = message
  for (let i = 0; i < 4 && m; i++) {
    const dalam =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message
    if (!dalam) break
    m = dalam
  }
  return m
}

function ambilTeks(message) {
  const m = isiPesan(message)
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    ''
  )
}

// Berisi daftar orang yang di-tag (mentionedJid) dan pengirim pesan yang di-reply (participant)
function ambilContext(message) {
  const m = isiPesan(message)
  return (
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    m?.videoMessage?.contextInfo ??
    {}
  )
}

function umurDetik(msg) {
  const t = msg.messageTimestamp
  const detik = typeof t === 'object' && t !== null ? (t.toNumber?.() ?? Number(t)) : Number(t)
  if (!Number.isFinite(detik) || detik <= 0) return Infinity
  return Date.now() / 1000 - detik
}

// ID pengirim yang mungkin: nomor biasa atau ID "lid" milik WhatsApp
function kandidatPengirim(msg, diGrup) {
  const k = msg.key
  const daftar = [k.participant, k.participantAlt]
  if (!diGrup) daftar.push(k.remoteJid, k.remoteJidAlt)
  return daftar.map(digits).filter(Boolean)
}

function adalahOwner(msg, kandidat) {
  if (msg.key.fromMe) return true
  return kandidat.some((id) => config.nomorOwner.includes(id))
}

// ---------- Mencari target /add dan /kick ----------
// Sumber: orang yang di-tag, pengirim pesan yang di-reply, atau nomor yang diketik.
function cariTarget(msg, argsTeks) {
  const peta = new Map() // digits -> { jid, digits, dariTag }
  const tambah = (jid, dariTag) => {
    const d = digits(jid)
    if (!d || peta.has(d)) return
    peta.set(d, { jid, digits: d, dariTag })
  }

  const ctx = ambilContext(msg.message)
  const tag = ctx.mentionedJid ?? []
  for (const jid of tag) tambah(jid, true)
  if (!tag.length && ctx.participant) tambah(ctx.participant, true)

  for (const token of argsTeks.split(/[\s,;]+/)) {
    const bersih = token.replace(/^[@+]/, '').replace(/[-().]/g, '')
    if (!/^\d{9,16}$/.test(bersih)) continue
    const nomor = rapikanNomor(bersih)
    if (nomor.length >= 10 && nomor.length <= 15) tambah(`${nomor}@s.whatsapp.net`, false)
  }
  return [...peta.values()]
}

const label = (t) => (t.dariTag ? `@${t.digits}` : `+${t.digits}`)

function artiStatus(aksi, status) {
  const kode = String(status)
  const tabel = {
    add: {
      200: '✅ berhasil ditambahkan',
      409: 'sudah ada di grup',
      408: 'baru keluar dari grup, belum bisa ditambahkan lagi',
      403: 'tidak bisa ditambahkan langsung (pengaturan privasi akun), kirim link undangan manual',
    },
    remove: {
      200: '✅ dikeluarkan',
      404: 'bukan anggota grup',
      403: 'tidak bisa dikeluarkan (mungkin admin grup)',
    },
  }
  return tabel[aksi][kode] ?? `gagal (kode ${kode})`
}

function pesanError(err) {
  const teks = String(err?.message ?? err)
  if (/not-authorized|forbidden|403/i.test(teks) || err?.output?.statusCode === 403) {
    return 'Gagal: bot harus jadi *admin* grup dulu.'
  }
  return `Gagal: ${teks}`
}

// ---------- Command ----------
async function perintahPay(sock, msg, chat) {
  let gambar
  try {
    gambar = await fs.readFile(config.qrisFile)
  } catch {
    console.error(`❌ /pay: file QRIS tidak ditemukan di "${config.qrisFile}". Taruh qris.jpg di folder media.`)
    return
  }
  await sock.sendMessage(chat, { image: gambar, caption: config.payTeks }, { quoted: msg })
}

async function perintahOut(sock, chat, diGrup) {
  if (!diGrup) {
    await sock.sendMessage(chat, { text: '/out hanya bisa dipakai di dalam grup.' })
    return
  }
  console.log(`👋 Keluar dari grup ${chat} (diminta owner)`)
  await sock.groupLeave(chat)
}

async function perintahRules(sock, chat) {
  let teks
  try {
    teks = (await fs.readFile(config.rulesFile, 'utf8')).trim()
  } catch {
    teks = RULES_BAWAAN
  }
  await sock.sendMessage(chat, { text: teks || RULES_BAWAAN })
}

// aksi: 'add' atau 'remove'
async function ubahAnggota(sock, msg, chat, diGrup, args, aksi) {
  const nama = aksi === 'add' ? '/add' : '/kick'
  const balas = (text, mentions) =>
    sock.sendMessage(chat, mentions?.length ? { text, mentions } : { text }, { quoted: msg })

  if (!diGrup) return balas(`${nama} hanya bisa dipakai di dalam grup.`)

  let targets = cariTarget(msg, args)

  // Tag/reply bentuk "lid" tidak bisa dipakai untuk menambah anggota baru
  const catatan = []
  if (aksi === 'add') {
    const lid = targets.filter((t) => t.jid.endsWith('@lid'))
    if (lid.length) {
      catatan.push('Tag/reply tidak bisa dipakai untuk /add pada orang ini, tulis nomornya langsung.')
      targets = targets.filter((t) => !t.jid.endsWith('@lid'))
    }
  }

  if (!targets.length) {
    const contoh =
      aksi === 'add'
        ? 'Format: /add 6281234567890\nBoleh beberapa nomor (pisahkan spasi), atau reply pesan orangnya.'
        : 'Format: /kick 6281234567890\nAtau tag orangnya: /kick @nama\nAtau reply pesan orangnya lalu ketik /kick.'
    return balas([...catatan, contoh].join('\n'))
  }

  if (targets.length > MAKS_TARGET) {
    catatan.push(`Maksimal ${MAKS_TARGET} orang sekali perintah, sisanya diabaikan.`)
    targets = targets.slice(0, MAKS_TARGET)
  }

  if (aksi === 'remove') {
    const botDigits = [digits(sock.user?.id), digits(sock.user?.lid)].filter(Boolean)
    const dilewati = []
    targets = targets.filter((t) => {
      if (botDigits.includes(t.digits)) {
        dilewati.push(`${label(t)}: dilewati (nomor bot sendiri, pakai /out untuk keluar)`)
        return false
      }
      if (config.nomorOwner.includes(t.digits)) {
        dilewati.push(`${label(t)}: dilewati (owner)`)
        return false
      }
      return true
    })
    catatan.push(...dilewati)
    if (!targets.length) return balas(catatan.join('\n'), [])
  }

  let hasil
  try {
    hasil = await sock.groupParticipantsUpdate(chat, targets.map((t) => t.jid), aksi)
  } catch (err) {
    console.error(`❌ ${nama} gagal:`, err?.message ?? err)
    return balas(pesanError(err))
  }

  const baris = (hasil ?? []).map((r, i) => {
    const t = targets.find((x) => x.digits === digits(r.jid)) ?? targets[i]
    return `${t ? label(t) : '+' + digits(r.jid)}: ${artiStatus(aksi, r.status)}`
  })
  if (!baris.length) baris.push('WhatsApp tidak mengembalikan hasil, cek di grup apakah berhasil.')

  const mentions = targets.filter((t) => t.dariTag).map((t) => t.jid)
  await balas([...baris, ...catatan].join('\n'), mentions)
}

// ---------- /pot: bracket turnamen acak ----------
function ambilSesi(chat) {
  const s = sesiPot.get(chat)
  if (!s) return null
  if (Date.now() - s.dibuat > (s.slot ? SESI_ULANG_MS : SESI_MENUNGGU_MS)) {
    sesiPot.delete(chat)
    return null
  }
  return s
}

const menungguSlot = (chat) => {
  const s = ambilSesi(chat)
  return !!s && !s.slot
}

function ambilTag(msg) {
  const peta = new Map()
  for (const jid of ambilContext(msg.message).mentionedJid ?? []) {
    const d = digits(jid)
    if (d && !peta.has(d)) peta.set(d, { jid, digits: d })
  }
  return [...peta.values()]
}

function tanpaBot(sock, pemain) {
  const bot = [digits(sock.user?.id), digits(sock.user?.lid)].filter(Boolean)
  return pemain.filter((p) => !bot.includes(p.digits))
}

function pesanPilihSlot(n) {
  const opsi = slotYangBisa(n)
  if (!opsi.length) return 'Pemain terlalu sedikit. Tag minimal 3 orang.'
  const baris = opsi.map((s) => {
    const ket = n > s ? `diambil ${s} acak dari ${n}` : n === s ? 'pas' : `${s - n} slot BYE`
    return `• *${s}* (${ket})`
  })
  return `🎯 Terkumpul *${n} pemain*.\nPilih slot, balas angkanya saja:\n${baris.join('\n')}`
}

const sebut = (p) => `@${p.digits}`

function susunBracket(h) {
  const awal = [`🏆 *BRACKET ${h.slot} SLOT*`, '🎲 Diacak otomatis', '', `*${h.namaBabak1}*`]
  for (const p of h.babak1) {
    awal.push(`POT ${p.no} : ${sebut(p.a)} vs ${p.b ? sebut(p.b) : 'BYE (lolos otomatis)'}`)
  }
  if (h.cadangan.length) awal.push('', `Tidak kebagian slot: ${h.cadangan.map(sebut).join(' ')}`)

  const lanjut = ['➡️ *LANJUTAN (ACAK)*']
  for (const babak of h.lanjutan) {
    lanjut.push('', `*${babak.nama}*`)
    for (const p of babak.pot) lanjut.push(`POT ${p.no} : ${p.a} VS ${p.b}`)
  }

  const semua = [...h.babak1.flatMap((p) => [p.a, p.b]).filter(Boolean), ...h.cadangan]
  return { teks1: awal.join('\n'), teks2: lanjut.join('\n'), mentions: semua.map((p) => p.jid) }
}

async function kirimBracket(sock, chat, sesi, slot) {
  const hasil = buatBracket(sesi.pemain, slot)
  sesi.slot = slot
  sesi.dibuat = Date.now()
  const { teks1, teks2, mentions } = susunBracket(hasil)
  await sock.sendMessage(chat, { text: teks1, mentions })
  await sock.sendMessage(chat, { text: teks2 })
}

async function pilihSlot(sock, msg, chat, sesi, slot) {
  const n = sesi.pemain.length
  if (n <= slot / 2) {
    return sock.sendMessage(chat, { text: `Slot ${slot} terlalu besar untuk ${n} pemain.\n${pesanPilihSlot(n)}` }, { quoted: msg })
  }
  return kirimBracket(sock, chat, sesi, slot)
}

async function perintahPot(sock, msg, chat, diGrup, args) {
  const balas = (text) => sock.sendMessage(chat, { text }, { quoted: msg })
  if (!diGrup) return balas('/pot hanya bisa dipakai di dalam grup.')

  const token = args.toLowerCase().split(/\s+/).filter(Boolean)
  const slot = Number(token.find((t) => /^\d+$/.test(t) && UKURAN_SLOT.includes(Number(t)))) || null
  const mauUlang = token.some((t) => t === 'ulang' || t === 'acak')
  const mauSemua = token.some((t) => t === 'semua' || t === 'all')

  if (mauUlang) {
    const s = ambilSesi(chat)
    if (!s?.slot) return balas('Belum ada bracket yang bisa diacak ulang. Mulai dengan /pot lalu tag pemainnya.')
    return kirimBracket(sock, chat, s, s.slot)
  }

  let pemain = ambilTag(msg)
  if (mauSemua) {
    let meta
    try {
      meta = await sock.groupMetadata(chat)
    } catch (err) {
      console.error('❌ /pot semua gagal mengambil anggota grup:', err?.message ?? err)
      return balas('Gagal mengambil daftar anggota grup.')
    }
    const peta = new Map(pemain.map((p) => [p.digits, p]))
    for (const x of meta?.participants ?? []) {
      const d = digits(x.id)
      if (d && !peta.has(d)) peta.set(d, { jid: x.id, digits: d })
    }
    pemain = [...peta.values()]
  }
  pemain = tanpaBot(sock, pemain)

  if (!pemain.length) {
    // Tanpa tag: mungkin memilih slot untuk daftar pemain yang sudah ditag sebelumnya
    const s = ambilSesi(chat)
    if (s && !s.slot) return slot ? pilihSlot(sock, msg, chat, s, slot) : balas(pesanPilihSlot(s.pemain.length))
    return balas(
      'Format: /pot @pemain1 @pemain2 ... (tag semua pemain)\n' +
        'Atau /pot semua untuk memakai seluruh anggota grup.\n' +
        'Boleh langsung pilih slot: /pot 8 @pemain1 @pemain2 ...\n' +
        'Setelah bracket jadi, /pot ulang untuk mengacak ulang.'
    )
  }

  if (pemain.length < 3) return balas('Tag minimal 3 pemain.')

  const sesi = { pemain, slot: null, dibuat: Date.now() }
  sesiPot.set(chat, sesi)
  if (slot) return pilihSlot(sock, msg, chat, sesi, slot)
  return balas(pesanPilihSlot(pemain.length))
}

// ---------- Pintu masuk ----------
// Dipanggil untuk setiap pesan masuk
export async function tanganiPesan(sock, msg) {
  if (!msg?.message || !msg.key?.remoteJid) return
  if (msg.key.remoteJid === 'status@broadcast') return

  const teks = ambilTeks(msg.message).trim()
  const chat = msg.key.remoteJid

  // Selain command, hanya angka 4/8/16/32 yang diproses, itupun cuma saat /pot menunggu pilihan slot
  const jawabanSlot = !teks.startsWith('/') && /^(4|8|16|32)$/.test(teks) && menungguSlot(chat)
  if (!teks.startsWith('/') && !jawabanSlot) return

  const id = msg.key.id
  if (id) {
    if (sudahDiproses.has(id)) return
    sudahDiproses.add(id)
    if (sudahDiproses.size > 500) sudahDiproses.delete(sudahDiproses.values().next().value)
  }

  if (umurDetik(msg) > UMUR_MAKS_DETIK) return

  const diGrup = chat.endsWith('@g.us')
  const kandidat = kandidatPengirim(msg, diGrup)
  const owner = adalahOwner(msg, kandidat)

  if (jawabanSlot) {
    if (!owner) return
    return pilihSlot(sock, msg, chat, ambilSesi(chat), Number(teks))
  }

  const kata = teks.split(/\s+/)[0]
  const perintah = kata.toLowerCase()
  if (!SEMUA_PERINTAH.has(perintah)) return
  const args = teks.slice(kata.length).trim()

  if (OWNER_SAJA.has(perintah) && !owner) {
    // Diam saja ke pengirim, tapi catat di terminal supaya owner bisa cek ID-nya
    console.log(`⛔ ${perintah} ditolak, bukan owner. ID pengirim: ${kandidat.join(' / ') || '(tidak diketahui)'}`)
    return
  }

  switch (perintah) {
    case '/out':
      return perintahOut(sock, chat, diGrup)
    case '/rules':
      return perintahRules(sock, chat)
    case '/add':
      return ubahAnggota(sock, msg, chat, diGrup, args, 'add')
    case '/kick':
      return ubahAnggota(sock, msg, chat, diGrup, args, 'remove')
    case '/pot':
      return perintahPot(sock, msg, chat, diGrup, args)
    case '/pay': {
      // Boleh siapa saja, dengan jeda singkat per orang per chat
      if (!owner) {
        const kunci = `${chat}|${kandidat[0] ?? ''}`
        const sekarang = Date.now()
        if (sekarang - (terakhirPay.get(kunci) ?? 0) < COOLDOWN_MS) return
        terakhirPay.set(kunci, sekarang)
        if (terakhirPay.size > 500) terakhirPay.delete(terakhirPay.keys().next().value)
      }
      return perintahPay(sock, msg, chat)
    }
  }
}
