import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import readline from 'node:readline'
import { tanganiPesan } from './src/perintah.js'

const AUTH_DIR = 'auth_info' // folder penyimpanan sesi login
const logger = pino({ level: 'silent' })

// ---------- Helper input terminal ----------
function tanya(pertanyaan) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    rl.question(pertanyaan, (jawaban) => {
      rl.close()
      resolve(jawaban.trim())
    })
  )
}

// Rapikan nomor: hanya angka, awalan 0 diganti 62 (Indonesia)
function rapikanNomor(input) {
  let nomor = input.replace(/\D/g, '')
  if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1)
  return nomor
}

async function mintaNomor() {
  while (true) {
    const input = await tanya(
      '\nMasukkan nomor WhatsApp yang mau di-link (contoh: 6281234567890): '
    )
    const nomor = rapikanNomor(input)
    if (nomor.length >= 10 && nomor.length <= 15) return nomor
    console.log('Nomor tidak valid. Pakai kode negara, contoh: 6281234567890')
  }
}

// ---------- Bot ----------
let sudahMintaKode = false
let nomorTarget = null // disimpan agar tidak ditanya ulang kalau koneksi putus sebelum pairing selesai

async function mulaiBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  // Kalau belum pernah login, minta nomor dulu sebelum konek
  if (!state.creds.registered && !nomorTarget) {
    nomorTarget = await mintaNomor()
  }

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    // Event "qr" muncul saat server siap menerima proses link device.
    // Di sini kita minta kode pairing sebagai pengganti QR.
    if (qr && nomorTarget && !sudahMintaKode && !state.creds.registered) {
      sudahMintaKode = true
      try {
        const kode = await sock.requestPairingCode(nomorTarget)
        const kodeRapi = kode?.match(/.{1,4}/g)?.join('-') ?? kode
        console.log('\n==============================')
        console.log(`  KODE LINK DEVICE: ${kodeRapi}`)
        console.log('==============================')
        console.log('Di HP: WhatsApp > Pengaturan > Perangkat Tertaut >')
        console.log('Tautkan Perangkat > "Tautkan dengan nomor telepon saja"')
        console.log('lalu masukkan kode di atas.\n')
      } catch (err) {
        console.error('Gagal meminta kode pairing:', err?.message ?? err)
        process.exit(1)
      }
    }

    if (connection === 'open') {
      console.log('✅ Bot terhubung ke WhatsApp!')
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Sesi logout. Hapus folder "auth_info" lalu jalankan ulang npm start.')
        process.exit(0)
      }

      // Setelah pairing berhasil WhatsApp meminta restart (515) — itu normal.
      console.log(`Koneksi terputus (kode: ${statusCode ?? 'unknown'}), menyambung ulang...`)
      sudahMintaKode = false
      mulaiBot()
    }
  })

  // Command: /pay (semua orang); /out /add /kick /rules (owner saja). Lihat src/perintah.js
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      try {
        await tanganiPesan(sock, msg)
      } catch (err) {
        console.error('Gagal memproses pesan:', err?.message ?? err)
      }
    }
  })
}

mulaiBot().catch((err) => {
  console.error('Terjadi error:', err)
  process.exit(1)
})
