# UANGKU — Aplikasi Keuangan Online

Pencatatan keuangan otomatis lewat **Telegram**, disimpan di **Google Sheets** melalui
**Google Apps Script**, dan ditampilkan pada **dashboard web** yang bisa dipublikasikan gratis
di **GitHub Pages**.

```
Telegram  ──webhook──▶  Apps Script (Code.gs)  ──▶  Google Sheets
                              │                         │
                              └──── JSON API ───────────┘
                                       ▲
                                       │ GET + query string (tanpa preflight CORS)
                                       │
                            Dashboard (index.html / GitHub Pages)
```

## Yang sudah tersedia

| Goal | Status | Di mana |
|---|---|---|
| 1. Otomatisasi pencatatan via Telegram | ✅ | `/masuk`, `/keluar`, `/catat` di `apps-script/Code.gs` |
| 2. Report pengeluaran dari sumber | ✅ | `/lapor`, `/grafik`, tab Dashboard & Transaksi |
| 3. Keuangan masuk & keluar | ✅ | Tabel `Transaksi` (kolom `Tipe`) |
| 4. Report rancangan keuangan | ✅ | Tab **Rencana Keuangan** (50/30/20, dana darurat, langkah berikutnya) |
| 5. Defisit/surplus pendapatan vs pengeluaran | ✅ | KPI selisih, `/saldo`, `/lapor` |
| 6. Hutang | ✅ | Sheet `Hutang`, `/hutang`, `/tambahhutang`, `/bayar`, tab Hutang |

## Struktur berkas

```
index.html               Dashboard (1 berkas, tanpa build, siap GitHub Pages)
apps-script/Code.gs      Backend: bot Telegram + API + logika keuangan
apps-script/appsscript.json  Manifest (timezone Asia/Jakarta, akses web app)
tests/                   Uji otomatis (backend, DOM, integrasi live)
```

---

## Langkah 1 — Siapkan Google Sheet

1. Buat spreadsheet baru di <https://sheets.new>.
2. Salin **ID** dari URL: `docs.google.com/spreadsheets/d/`**`<ID>`**`/edit`.
3. Biarkan kosong — sheet dan header dibuat otomatis oleh `setup()`.

## Langkah 2 — Pasang Apps Script

1. Buka <https://script.google.com> → **New project**, beri nama `UANGKU`.
2. Hapus isi `Code.gs` default, tempel seluruh isi `apps-script/Code.gs`.
3. Buka **Project Settings** → centang **Show "appsscript.json"**, lalu samakan isinya
   dengan `apps-script/appsscript.json`.
4. Buka **Project Settings → Script Properties**, tambahkan:

   | Property | Nilai | Wajib |
   |---|---|---|
   | `SHEET_ID` | ID spreadsheet dari Langkah 1 | ya |
   | `BOT_TOKEN` | token dari [@BotFather](https://t.me/BotFather) | ya |
   | `API_TOKEN` | string acak (kunci dashboard) | disarankan |
   | `WEBHOOK_SECRET` | string acak (kunci webhook) | disarankan |
   | `ALLOWED_CHAT_IDS` | biarkan kosong; chat pertama otomatis terdaftar | tidak |

5. Pilih fungsi **`setup`** di dropdown, klik **Run**, setujui izin yang diminta.
   Sheet `Transaksi`, `Hutang`, `Anggaran`, `Pengaturan` akan terbentuk beserta 10 anggaran awal.

## Langkah 3 — Deploy Web App

1. **Deploy → New deployment → Web app**.
2. **Execute as: Me** · **Who has access: Anyone**.
3. Klik **Deploy**, lalu salin URL yang berakhiran **`/exec`**.

> Setiap kali `Code.gs` diubah, buat **New deployment** (atau *Manage deployments → Edit → Version: New version*).
> URL `/exec` lama tetap berfungsi setelah versi baru dipublikasikan.

## Langkah 4 — Hubungkan webhook Telegram

1. Di **Script Properties**, tambahkan `WEBAPP_URL` = URL `/exec` dari Langkah 3.
2. Jalankan fungsi **`setWebhook`** sekali. Hasilnya akan menampilkan `{"ok":true,...}`.
3. Kirim `/start` ke bot Anda di Telegram.

Verifikasi kapan saja dengan fungsi **`infoWebhook`**.

## Langkah 5 — Pasang dashboard

**Opsi A — GitHub Pages (online, gratis)**

```bash
cd "01 Aplikasi Keuangan Online"
git init && git add -A && git commit -m "UANGKU: dashboard keuangan"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

Lalu **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
Dashboard tersedia di `https://<username>.github.io/<repo>/`.

**Opsi B — lokal**: `npm run serve` lalu buka <http://localhost:8080>.

Buka dashboard → **⚙️ Sumber Data** → tempel URL `/exec` + `API_TOKEN` → **Simpan & Uji Koneksi**.
Konfigurasi disimpan di `localStorage` browser, jadi token tidak ikut ter-commit ke repo.

---

## Perintah bot Telegram

```
/keluar 25rb makan nasi goreng      catat pengeluaran (nominal bebas: 25rb, 1,5jt, 1.500.000)
/masuk 5jt gaji bulan ini           catat pemasukan
/catat masuk 2jt bonus              bentuk panjang

/lapor                              ringkasan bulan ini
/lapor 2026-08                      ringkasan bulan tertentu
/anggaran                           realisasi vs anggaran (dengan progress bar)
/saldo                              pemasukan - pengeluaran
/grafik                             tren 6 bulan
/hutang                             daftar hutang aktif
/tambahhutang Budi 2jt 500rb 2026-12-31
/bayar HT-0001 500rb                otomatis tercatat sebagai pengeluaran "Cicilan"
/batal TX-0007                      soft delete (riwayat tetap tersimpan)
/setanggaran Makan 1.5jt
/id                                 menampilkan chat ID Anda
```

Pengingat harian jam 20:00 (opsional): jalankan fungsi **`pasangPengingatHarian`** sekali.

## Aksi yang tersedia di dashboard

Catat transaksi · batalkan transaksi · tambah hutang · bayar cicilan · ubah anggaran ·
pindah bulan · cari/filter transaksi · export CSV. Tanpa URL `/exec`, dashboard berjalan
dalam **mode demo** dengan data contoh supaya tata letak tetap bisa diperiksa.

## Model data (Google Sheets)

| Sheet | Kolom |
|---|---|
| `Transaksi` | ID · Tanggal · Tipe · Kategori · Jumlah · Akun · Catatan · Sumber · Status · Dibuat |
| `Hutang` | ID · Nama · Pokok · Dibayar · Sisa · Cicilan · JatuhTempo · Status · Catatan |
| `Anggaran` | Kategori · Limit · Periode |
| `Pengaturan` | Key · Value |

`Status` pada `Transaksi` bernilai `aktif` atau `batal` — data tidak pernah dihapus permanen,
sehingga laporan lama tetap dapat direkonsiliasi.

## Uji otomatis

```bash
npm install     # sekali saja (jsdom untuk uji DOM)
npm test
```

| Berkas | Cakupan |
|---|---|
| `tests/test-backend.js` | 139 asersi: parser nominal, kategori, setup sheet, transaksi, agregasi surplus/defisit, anggaran, hutang & pelunasan, soft delete, API `doGet`, router Telegram `doPost` |
| `tests/test-dom.js` | 64 asersi: render KPI, chart, tabel, filter, pencarian, navigasi tab, form, toast |
| `tests/test-live.js` | 46 asersi: bentuk permintaan bebas preflight CORS, render data API, aksi tulis, penanganan gagal koneksi |

## Catatan teknis

- **CORS**: Apps Script tidak menangani preflight `OPTIONS`. Semua panggilan dashboard memakai
  **GET + query string** tanpa header kustom → tergolong *simple request*, jadi tidak ada preflight.
  (Alternatif untuk POST: set `Content-Type: text/plain;charset=utf-8`.)
- **Keamanan**: `API_TOKEN` melindungi API dashboard; `WEBHOOK_SECRET` melindungi webhook
  (URL rahasia berisi `?k=...`); `ALLOWED_CHAT_IDS` membatasi siapa yang boleh memakai bot.
- **Zona waktu**: `appsscript.json` memakai `Asia/Jakarta`, sehingga tanggal & bulan mengikuti WIB.
- **Kuota**: batas gratis Apps Script (≈20.000 UrlFetch/hari) jauh di atas kebutuhan pencatatan pribadi.
