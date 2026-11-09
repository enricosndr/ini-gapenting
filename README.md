# Bot WhatsApp (Pairing Code)

## Cara pakai
1. Pastikan Node.js 20+ sudah terpasang (`node -v`).
2. `npm install` (sekali saja).
3. Salin `.env.example` menjadi `.env`, lalu isi `NOMOR_OWNER`.
4. `npm start`, masukkan nomor WhatsApp yang mau di-link, lalu masukkan kode yang muncul di
   **WhatsApp > Perangkat Tertaut > Tautkan Perangkat > Tautkan dengan nomor telepon saja**.

Sesi tersimpan di `auth_info/`. Mau login ulang / ganti nomor: hapus folder itu lalu `npm start`.

## Command
| Command | Siapa | Fungsi |
|---|---|---|
| `/pay` | Semua orang | Kirim gambar `media/qris.jpg` dengan teks "QRIS DANA ALLPAYMENT , HABIS TF KIRIM BUKTI TRANSFER SS DETAIL DAN WAJIB KELIATAN JAM NYA" |
| `/rules` | Owner | Kirim teks rules ML Brawl (isi dari `rules.txt`) |
| `/add 6281234567890` | Owner | Tambah anggota ke grup. Bisa beberapa nomor (pisahkan spasi) atau reply pesan orangnya |
| `/kick 6281234567890` | Owner | Keluarkan anggota. Bisa lewat nomor, tag (`/kick @nama`), atau reply pesan orangnya |
| `/out` | Owner | Nomor bot keluar dari grup tempat command dipakai |
| `/pot @pemain1 @pemain2 ...` | Owner | Buat bracket turnamen acak (lihat di bawah) |

Semua command owner only, kecuali `/pay` yang bisa dipakai siapa saja.

## Cara pakai /pot
1. Ketik `/pot` lalu tag semua pemain (atau `/pot semua` untuk memakai seluruh anggota grup).
2. Bot menanyakan slot. Balas angkanya saja: **4**, **8**, **16**, atau **32**.
   Boleh langsung: `/pot 8 @pemain1 @pemain2 ...`
3. Bot mengirim dua pesan: pasangan POT babak pertama (acak, dengan tag), lalu teks lanjutan yang juga diacak,
   misalnya `POT 5 : WIN POT 1 VS WIN POT 3`, sampai FINAL.
4. `/pot ulang` mengacak ulang bracket yang sama (berlaku 1 jam), tanpa tag ulang.

Aturan:
- Pemain yang di-tag **lebih banyak** dari slot: bot memilih sebanyak slot secara acak, sisanya ditulis "Tidak kebagian slot".
- Pemain **lebih sedikit** dari slot: sisa slot jadi BYE (lawan kosong, langsung lolos). Slot yang terlalu besar
  (lebih dari separuhnya kosong) ditolak dan bot menyarankan slot yang cocok.
- Minimal 3 pemain. Nomor bot sendiri otomatis tidak ikut.
- Pilihan slot menunggu maksimal 10 menit, dan hanya balasan dari owner yang dihitung.

Catatan:
- `/add`, `/kick`, `/out`, dan `/pot` hanya jalan di dalam grup. Untuk `/add` dan `/kick`, **bot harus jadi admin grup**.
- `/kick` tidak akan mengeluarkan owner atau nomor bot sendiri. Maksimal 10 orang sekali perintah.
- Kalau `/add` menunjukkan "tidak bisa ditambahkan langsung", akun itu membatasi siapa yang boleh memasukkannya
  ke grup. Kirim link undangan grup secara manual.
- Edit `rules.txt` kapan saja untuk mengubah isi `/rules`, tidak perlu restart bot.
- Owner = nomor di `NOMOR_OWNER` (`.env`), ditambah pesan dari akun bot sendiri (HP yang di-link).
- Kalau owner mengetik command tapi ditolak, lihat terminal: ada baris `ditolak, bukan owner ... ID pengirim: ...`.
  Salin ID itu ke `NOMOR_OWNER` lalu restart bot.
- Pesan lebih dari 60 detik dan command yang sama dengan jeda singkat diabaikan, supaya tidak terproses ulang
  saat bot menyambung kembali. `/pay` punya jeda 5 detik per orang per chat.
- Gambar QRIS bisa diganti lewat `QRIS_FILE`, teks `/pay` lewat `PAY_TEKS` di `.env`.
