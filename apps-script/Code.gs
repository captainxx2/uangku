/**
 * ============================================================
 *  UANGKU — Backend Keuangan via Google Apps Script
 *  Telegram Bot  <->  Apps Script  <->  Google Sheets  <->  Dashboard
 * ============================================================
 *
 *  SETUP (sekali saja):
 *  1. Buat Google Sheet baru, copy ID dari URL-nya.
 *  2. Buka script.google.com > New project > paste file ini ke Code.gs.
 *  3. Project Settings > Script Properties, isi:
 *        SHEET_ID         = <id spreadsheet>
 *        BOT_TOKEN        = <token dari @BotFather>
 *        API_TOKEN        = <string acak, untuk dashboard> (opsional)
 *        WEBHOOK_SECRET   = <string acak>                  (opsional)
 *        ALLOWED_CHAT_IDS = 12345678,87654321              (opsional, kosong = hanya chat pertama yg didaftarkan)
 *  4. Jalankan fungsi  setup()  sekali (untuk membuat sheet + header).
 *  5. Deploy > New deployment > Web app
 *        Execute as : Me
 *        Who has access : Anyone
 *     Copy URL yang berakhiran /exec.
 *  6. Isi WEBAPP_URL di Script Properties dengan URL itu, lalu jalankan
 *     fungsi  setWebhook()  sekali.
 *  7. Buka Telegram, kirim /start ke bot Anda.
 * ============================================================
 */

/* ----------------------------- KONFIG ----------------------------- */

const PROPS = PropertiesService.getScriptProperties();

function cfg_(key) { return (PROPS.getProperty(key) || '').trim(); }

const SHEET_ID   = cfg_('SHEET_ID');
const BOT_TOKEN  = cfg_('BOT_TOKEN');
const API_TOKEN  = cfg_('API_TOKEN');
const WEBHOOK_SECRET = cfg_('WEBHOOK_SECRET');
const WEBAPP_URL = cfg_('WEBAPP_URL');

const SH = { SUMBER: 'SumberDana', TX: 'Transaksi', DEBT: 'Hutang',
             BUDGET: 'Anggaran', SET: 'Pengaturan' };

const HEADERS = {
  SumberDana: ['ID', 'Nama', 'Jenis', 'Jumlah', 'Frekuensi', 'TanggalMulai', 'Status', 'Catatan'],
  Transaksi:  ['ID', 'Tanggal', 'Tipe', 'Kategori', 'Jumlah', 'Akun', 'Catatan', 'Sumber', 'Status', 'Dibuat', 'Lampiran'],
  Hutang:     ['ID', 'Nama', 'Pokok', 'Dibayar', 'Sisa', 'Cicilan', 'JatuhTempo', 'Status', 'Catatan'],
  Anggaran:   ['Kategori', 'Limit', 'Periode', 'Kelompok', 'Persen'],
  Pengaturan: ['Key', 'Value']
};

const KATEGORI_KELUAR = ['Makan', 'Transport', 'Belanja', 'Tagihan', 'Kesehatan',
                         'Pendidikan', 'Hiburan', 'Rumah', 'Cicilan',
                         'Tabungan', 'Investasi', 'Dana Darurat', 'Lain-lain'];
const KATEGORI_MASUK  = ['Gaji', 'Bonus', 'Usaha', 'Investasi', 'Hadiah', 'Lain-lain'];

/* Plot anggaran dikelompokkan agar mudah dibaca: kebutuhan / keinginan / tabungan. */
const KELOMPOK = {
  Kebutuhan: ['Makan', 'Transport', 'Tagihan', 'Kesehatan', 'Pendidikan', 'Rumah', 'Cicilan'],
  Keinginan: ['Belanja', 'Hiburan', 'Lain-lain'],
  Tabungan:  ['Tabungan', 'Investasi', 'Dana Darurat']
};

/* Porsi tiap kelompok dari total pendapatan tetap (aturan 50/30/20). */
const PORSI = { Kebutuhan: 0.5, Keinginan: 0.3, Tabungan: 0.2 };

/* Bobot antar kategori di dalam satu kelompok (jumlah 100). */
const BOBOT = {
  Kebutuhan: { Makan: 30, Transport: 15, Tagihan: 12, Kesehatan: 8, Pendidikan: 8, Rumah: 17, Cicilan: 10 },
  Keinginan: { Belanja: 35, Hiburan: 40, 'Lain-lain': 25 },
  Tabungan:  { Tabungan: 50, Investasi: 30, 'Dana Darurat': 20 }
};

/* ----------------------------- UTIL ----------------------------- */

function rupiah_(n) {
  return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function tanggalHariIni_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function tanggalStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).slice(0, 10);
}

function bulanDari_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(v || '').slice(0, 7);
}

function bulanIni_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function namaBulan_(ym) {
  const nama = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const p = String(ym).split('-');
  return (nama[Number(p[1]) - 1] || '?') + ' ' + p[0];
}

/**
 * Parse nominal gaya Indonesia: 50000, 50rb, 50.000, 1,5jt, Rp 1.500.000
 */
function parseNominal_(v) {
  if (typeof v === 'number') return Math.round(v);
  let s = String(v == null ? '' : v).toLowerCase().replace(/rp\.?/g, '').replace(/[\s_]/g, '');
  if (!s) return NaN;
  let mult = 1;
  const m = s.match(/^(.*?)(jt|juta|jtan|rb|ribu|k|mio|m)$/);
  if (m) {
    s = m[1];
    mult = /^(jt|juta|jtan|mio|m)$/.test(m[2]) ? 1e6 : 1e3;
  }
  if (/^\d+[.,]\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/[.,]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : Math.round(n * mult);
}

function normalKategori_(kategori, tipe) {
  const daftar = tipe === 'masuk' ? KATEGORI_MASUK : KATEGORI_KELUAR;
  if (!kategori) return 'Lain-lain';
  const k = String(kategori).trim().toLowerCase();
  for (let i = 0; i < daftar.length; i++) {
    if (daftar[i].toLowerCase() === k) return daftar[i];
  }
  // alias populer
  const alias = {
    makan: ['food', 'kuliner', 'jajan', 'warung', 'resto', 'kopi', 'nasi'],
    transport: ['bensin', 'ojek', 'gojek', 'grab', 'parkir', 'tol', 'bus', 'kereta'],
    belanja: ['shopping', 'belanja', 'baju', 'skincare', 'market'],
    tagihan: ['listrik', 'air', 'internet', 'wifi', 'pulsa', 'kuota', 'bpjs', 'pajak'],
    kesehatan: ['obat', 'dokter', 'rumah sakit', 'vitamin'],
    pendidikan: ['kursus', 'buku', 'sekolah', 'kuliah'],
    hiburan: ['nonton', 'game', 'langganan', 'netflix', 'spotify'],
    rumah: ['sewa', 'kontrakan', 'perbaikan', 'perabot'],
    cicilan: ['cicilan', 'kredit', 'angsuran', 'hutang', 'utang'],
    gaji: ['gajian', 'salary', 'upah', 'honor'],
    usaha: ['jualan', 'bisnis', 'omzet', 'dagang']
  };
  for (const kanon in alias) {
    if (daftar.map(function (d) { return d.toLowerCase(); }).indexOf(kanon) === -1) continue;
    if (alias[kanon].indexOf(k) > -1) {
      for (let i = 0; i < daftar.length; i++) {
        if (daftar[i].toLowerCase() === kanon) return daftar[i];
      }
    }
  }
  return 'Lain-lain';
}

/* ----------------------------- SHEET ----------------------------- */

function ss_() {
  if (!SHEET_ID) throw new Error('SHEET_ID belum diisi di Script Properties.');
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(nama) {
  const ss = ss_();
  let sh = ss.getSheetByName(nama);
  if (!sh) {
    sh = ss.insertSheet(nama);
    sh.appendRow(HEADERS[nama]);
    sh.getRange(1, 1, 1, HEADERS[nama].length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function baca_(nama) {
  const sh = sheet_(nama);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = HEADERS[nama].length;
  const values = sh.getRange(2, 1, last - 1, width).getValues();
  return values.filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    const o = {};
    HEADERS[nama].forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function tulis_(nama, objek) {
  const sh = sheet_(nama);
  sh.appendRow(HEADERS[nama].map(function (h) { return objek[h] === undefined ? '' : objek[h]; }));
}

/* ----------------------------- SETUP ----------------------------- */

function setup() {
  Object.keys(SH).forEach(function (k) { sheet_(SH[k]); });

  // Anggaran TIDAK diisi default: plot disusun dari sumber dana (plotAnggaran_)
  // supaya angka anggaran selalu punya dasar pendapatan nyata.

  const shSet = sheet_(SH.SET);
  if (shSet.getLastRow() < 2) {
    shSet.getRange(2, 1, 2, 2).setValues([['dibuat', new Date().toISOString()], ['versi', '2.0']]);
  }

  SpreadsheetApp.getActive(); // no-op agar izin Sheets ter-trigger
  return 'Setup selesai. Sheet: ' + Object.keys(SH).join(', ') +
    '\nLangkah berikutnya: tambah sumber dana lewat /tambahsumber, lalu susun plot dengan /plotanggaran.';
}

/* ----------------------------- TELEGRAM ----------------------------- */

function kirimTelegram_(chatId, teks, keyboard) {
  if (!BOT_TOKEN) return;
  const payload = {
    chat_id: chatId,
    text: teks,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (keyboard) payload.reply_markup = JSON.stringify(keyboard);
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function setWebhook() {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN belum diisi.');
  if (!WEBAPP_URL) throw new Error('WEBAPP_URL belum diisi (harus URL /exec hasil deploy).');
  let url = WEBAPP_URL;
  if (WEBHOOK_SECRET) url += '?k=' + encodeURIComponent(WEBHOOK_SECRET);
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      url: url,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true
    }),
    muteHttpExceptions: true
  });
  return res.getContentText();
}

function hapusWebhook() {
  return UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook',
    { muteHttpExceptions: true }).getContentText();
}

function infoWebhook() {
  return UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo',
    { muteHttpExceptions: true }).getContentText();
}

/** Daftar chat yang boleh memakai bot. */
function chatDiizinkan_(chatId) {
  const id = String(chatId);
  const list = cfg_('ALLOWED_CHAT_IDS').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (list.length === 0) {
    // mode bootstrap: chat pertama otomatis didaftarkan
    PROPS.setProperty('ALLOWED_CHAT_IDS', id);
    return true;
  }
  return list.indexOf(id) > -1;
}

/* ----------------------------- OPERASI KEUANGAN ----------------------------- */

function idBaru_(prefix, daftar) {
  let max = 0;
  daftar.forEach(function (r) {
    const n = parseInt(String(r.ID).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

function catatTransaksi_(opts) {
  const tipe = opts.tipe === 'masuk' ? 'masuk' : 'keluar';
  const jumlah = parseNominal_(opts.jumlah);
  if (!jumlah || isNaN(jumlah) || jumlah <= 0) throw new Error('Nominal tidak valid: ' + opts.jumlah);
  const kategori = normalKategori_(opts.kategori, tipe);
  const daftar = baca_(SH.TX);
  const id = idBaru_('TX', daftar);
  const row = {
    ID: id,
    Tanggal: opts.tanggal || tanggalHariIni_(),
    Tipe: tipe,
    Kategori: kategori,
    Jumlah: jumlah,
    Akun: opts.akun || 'Tunai',
    Catatan: opts.catatan || '',
    Sumber: opts.sumber || 'telegram',
    Status: 'aktif',
    Dibuat: new Date().toISOString(),
    Lampiran: opts.lampiran ? lampiranKeTeks_(opts.lampiran) : ''
  };
  tulis_(SH.TX, row);
  return row;
}

function ringkasan_(bulan) {
  const b = bulan || bulanIni_();
  const tx = baca_(SH.TX).filter(function (r) {
    return String(r.Status) === 'aktif' && bulanDari_(r.Tanggal) === b;
  });
  let masuk = 0, keluar = 0;
  const perKategori = {};
  tx.forEach(function (r) {
    const j = Number(r.Jumlah) || 0;
    if (r.Tipe === 'masuk') masuk += j;
    else {
      keluar += j;
      const k = r.Kategori || 'Lain-lain';
      perKategori[k] = (perKategori[k] || 0) + j;
    }
  });
  const petaAng = petaAnggaran_();
  const anggaran = {};
  Object.keys(petaAng).forEach(function (k) { anggaran[k] = petaAng[k].limit; });

  const pTetap = pendapatan_({ tetap: true });
  const pSemua = pendapatan_({});
  const hutang = baca_(SH.DEBT).filter(function (r) { return String(r.Status) === 'aktif'; });
  const totalHutang = hutang.reduce(function (a, r) { return a + (Number(r.Sisa) || 0); }, 0);
  const cicilanHutang = hutang.reduce(function (a, r) { return a + (Number(r.Cicilan) || 0); }, 0);

  const sisa = masuk - keluar;
  const rasioTabungan = masuk > 0 ? sisa / masuk : 0;
  const dasar = pTetap.total || pSemua.total || masuk;

  return {
    bulan: b,
    namaBulan: namaBulan_(b),
    pemasukan: masuk,
    pengeluaran: keluar,
    selisih: sisa,
    status: sisa > 0 ? 'surplus' : (sisa < 0 ? 'defisit' : 'seimbang'),
    rasioTabungan: rasioTabungan,
    perKategori: perKategori,
    anggaran: anggaran,
    petaAnggaran: petaAng,
    pendapatanTetap: pTetap.total,
    pendapatanTotal: pSemua.total,
    rincianSumber: pSemua.rincian,
    dasarAnggaran: dasar,
    totalHutang: totalHutang,
    cicilanHutang: cicilanHutang,
    jumlahTransaksi: tx.length,
    transaksi: tx
  };
}

function daftarHutang_() {
  return baca_(SH.DEBT);
}

function tambahHutang_(opts) {
  const pokok = parseNominal_(opts.pokok);
  if (!pokok || isNaN(pokok)) throw new Error('Pokok hutang tidak valid.');
  const daftar = baca_(SH.DEBT);
  const id = idBaru_('HT', daftar);
  const row = {
    ID: id,
    Nama: opts.nama || 'Tanpa nama',
    Pokok: pokok,
    Dibayar: 0,
    Sisa: pokok,
    Cicilan: parseNominal_(opts.cicilan) || 0,
    JatuhTempo: opts.tempo || '',
    Status: 'aktif',
    Catatan: opts.catatan || ''
  };
  tulis_(SH.DEBT, row);
  return row;
}

function bayarHutang_(id, jumlah) {
  const j = parseNominal_(jumlah);
  if (!j || isNaN(j) || j <= 0) throw new Error('Jumlah bayar tidak valid.');
  const sh = sheet_(SH.DEBT);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada hutang.');
  const values = sh.getRange(2, 1, last - 1, HEADERS.Hutang.length).getValues();
  const idx = values.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Hutang ' + id + ' tidak ditemukan.');

  const row = values[idx];
  const sisa = Number(row[4]) || 0;
  if (j > sisa) throw new Error('Bayar ' + rupiah_(j) + ' melebihi sisa ' + rupiah_(sisa) + '.');
  const baruDibayar = (Number(row[3]) || 0) + j;
  const baruSisa = sisa - j;

  sh.getRange(idx + 2, 4, 1, 2).setValues([[baruDibayar, baruSisa]]);
  if (baruSisa <= 0) sh.getRange(idx + 2, 8).setValue('lunas');

  catatTransaksi_({
    tipe: 'keluar', jumlah: j, kategori: 'Cicilan',
    catatan: 'Bayar hutang ' + row[1] + ' (' + row[0] + ')', sumber: 'telegram'
  });

  return { id: row[0], nama: row[1], dibayar: baruDibayar, sisa: baruSisa, lunas: baruSisa <= 0 };
}

function batalkan_(id, status) {
  const target = String(status || 'batal').toLowerCase() === 'aktif' ? 'aktif' : 'batal';
  const sh = sheet_(SH.TX);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada transaksi.');
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const idx = ids.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Transaksi ' + id + ' tidak ditemukan.');
  sh.getRange(idx + 2, 9).setValue(target);
  return String(ids[idx][0]);
}

/** Aktifkan kembali transaksi yang sebelumnya dibatalkan. */
function aktifkan_(id) {
  return batalkan_(id, 'aktif');
}

/** Cari baris transaksi -> { idx (0-based), row }. */
function cariTransaksi_(id) {
  const sh = sheet_(SH.TX);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada transaksi.');
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const idx = ids.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Transaksi ' + id + ' tidak ditemukan.');
  const row = sh.getRange(idx + 2, 1, 1, HEADERS.Transaksi.length).getValues()[0];
  return { sh: sh, idx: idx, row: row, id: String(ids[idx][0]) };
}

/** Ubah transaksi yang sudah ada. Hanya kolom yang dikirim yang ditimpa. */
function ubahTransaksi_(id, patch) {
  const t = cariTransaksi_(id);
  const lama = {
    Tanggal: tanggalStr_(t.row[1]),
    Tipe: String(t.row[2]).toLowerCase() === 'masuk' ? 'masuk' : 'keluar',
    Kategori: String(t.row[3]),
    Jumlah: Number(t.row[4]) || 0,
    Akun: String(t.row[5]) || 'Tunai',
    Catatan: String(t.row[6] || '')
  };
  const ada = function (k) { return patch && patch[k] !== undefined && patch[k] !== null && String(patch[k]) !== ''; };

  const tipe = ada('tipe')
    ? (String(patch.tipe).toLowerCase() === 'masuk' ? 'masuk' : 'keluar')
    : lama.Tipe;

  let jumlah = lama.Jumlah;
  if (ada('jumlah')) {
    jumlah = parseNominal_(patch.jumlah);
    if (!jumlah || isNaN(jumlah) || jumlah <= 0) throw new Error('Nominal tidak valid: ' + patch.jumlah);
  }

  // Kategori: bila tipe berubah dan kategori tidak dikirim, paksa normalisasi ulang.
  const kategori = normalKategori_(
    ada('kategori') ? patch.kategori : lama.Kategori, tipe);

  const baru = {
    Tanggal: ada('tanggal') ? String(patch.tanggal).slice(0, 10) : lama.Tanggal,
    Tipe: tipe,
    Kategori: kategori,
    Jumlah: jumlah,
    Akun: ada('akun') ? String(patch.akun) : lama.Akun,
    Catatan: ada('catatan') ? String(patch.catatan) : lama.Catatan
  };

  const lebar = HEADERS.Transaksi.length;
  const rowBaru = t.row.slice();
  rowBaru[1] = baru.Tanggal;
  rowBaru[2] = baru.Tipe;
  rowBaru[3] = baru.Kategori;
  rowBaru[4] = baru.Jumlah;
  rowBaru[5] = baru.Akun;
  rowBaru[6] = baru.Catatan;
  if (patch && patch.lampiran !== undefined) {
    rowBaru[10] = patch.lampiran ? lampiranKeTeks_(patch.lampiran) : '';
  }
  t.sh.getRange(t.idx + 2, 1, 1, lebar).setValues([rowBaru]);

  return { ID: t.id, sebelum: lama, sesudah: baru };
}

/* ----------------------------- LAMPIRAN ----------------------------- */

/**
 * Simpan berkas lampiran ke Google Drive (folder "UANGKU Lampiran").
 * dataUrl: "data:image/png;base64,AAAA..." dari pembaca berkas di browser.
 * Mengembalikan { nama, mime, url, id, ukuran }.
 */
function simpanLampiran_(dataUrl, namaAsli, idTransaksi) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!m) throw new Error('Format lampiran tidak dikenali.');
  const mime = m[1] || 'application/octet-stream';
  const base64 = m[2] ? m[3] : Utilities.base64Encode(decodeURIComponent(m[3]));

  const batasBita = 5 * 1024 * 1024; // batas aman Apps Script
  const ukuran = Math.round(base64.length * 3 / 4);
  if (ukuran > batasBita) {
    throw new Error('Berkas terlalu besar (' + Math.round(ukuran / 1024 / 1024 * 10) / 10 +
      ' MB). Batas ' + (batasBita / 1024 / 1024) + ' MB.');
  }

  const nama = String(namaAsli || ('lampiran-' + (idTransaksi || Date.now()))).trim();
  const aman = nama.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

  let folder;
  const namaFolder = 'UANGKU Lampiran';
  const it = DriveApp.getFoldersByName(namaFolder);
  folder = it.hasNext() ? it.next() : DriveApp.createFolder(namaFolder);

  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, aman);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    nama: aman,
    mime: mime,
    url: file.getUrl(),
    id: file.getId(),
    ukuran: ukuran
  };
}

/** Lampiran disimpan di kolom sebagai JSON; baca dengan aman. */
function bacaLampiran_(nilai) {
  if (!nilai) return null;
  if (typeof nilai === 'object') return nilai; // Sheets sudah mengembalikan objek
  try { return JSON.parse(String(nilai)); } catch (e) { return null; }
}

function lampiranKeTeks_(obj) {
  if (!obj) return '';
  try { return JSON.stringify(obj); } catch (e) { return ''; }
}

/* ----------------------------- SUMBER DANA ----------------------------- */

function bacaSumberDana_() {
  return baca_(SH.SUMBER);
}

/** Normalisasi nominal sumber ke satuan BULAN. */
/** 'tidak tetap' juga mengandung kata 'tetap' — pencocokan harus eksplisit. */
function isTetap_(nilai) {
  const j = String(nilai == null ? '' : nilai).toLowerCase().trim();
  return j === 'tetap' || j === 'fixed' || j === 'rutin';
}

function perBulan_(jumlah, frekuensi) {
  const j = Number(jumlah) || 0;
  switch (String(frekuensi || 'bulanan').toLowerCase()) {
    case 'harian':   return j * 30;
    case 'mingguan': return j * 52 / 12;
    case 'tahunan':  return j / 12;
    default:         return j; // bulanan
  }
}

function tambahSumber_(opts) {
  const jumlah = parseNominal_(opts.jumlah);
  if (jumlah == null || isNaN(jumlah) || jumlah <= 0) throw new Error('Jumlah sumber dana tidak valid.');
  const daftar = bacaSumberDana_();
  const id = idBaru_('SD', daftar);
  const row = {
    ID: id,
    Nama: String(opts.nama || '').trim() || 'Tanpa nama',
    Jenis: isTetap_(opts.jenis) ? 'tetap' : 'tidak tetap',
    Jumlah: jumlah,
    Frekuensi: String(opts.frekuensi || 'bulanan').toLowerCase(),
    TanggalMulai: String(opts.mulai || tanggalHariIni_()).slice(0, 10),
    Status: 'aktif',
    Catatan: String(opts.catatan || '')
  };
  tulis_(SH.SUMBER, row);
  return row;
}

function ubahSumber_(id, patch) {
  const sh = sheet_(SH.SUMBER);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada sumber dana.');
  const vals = sh.getRange(2, 1, last - 1, HEADERS.SumberDana.length).getValues();
  const idx = vals.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Sumber dana ' + id + ' tidak ditemukan.');
  const row = vals[idx].slice();
  const ada = function (k) { return patch && patch[k] !== undefined && patch[k] !== null && String(patch[k]) !== ''; };
  if (ada('nama')) row[1] = String(patch.nama).trim();
  if (ada('jenis')) row[2] = isTetap_(patch.jenis) ? 'tetap' : 'tidak tetap';
  if (ada('jumlah')) {
    const j = parseNominal_(patch.jumlah);
    if (j == null || isNaN(j) || j <= 0) throw new Error('Jumlah sumber dana tidak valid.');
    row[3] = j;
  }
  if (ada('frekuensi')) row[4] = String(patch.frekuensi).toLowerCase();
  if (ada('mulai')) row[5] = String(patch.mulai).slice(0, 10);
  if (ada('status')) row[6] = String(patch.status).toLowerCase() === 'nonaktif' ? 'nonaktif' : 'aktif';
  if (ada('catatan')) row[7] = String(patch.catatan);
  sh.getRange(idx + 2, 1, 1, HEADERS.SumberDana.length).setValues([row]);
  return { ID: String(row[0]), Nama: String(row[1]), Jumlah: Number(row[3]), Frekuensi: String(row[4]), Status: String(row[6]) };
}

function hapusSumber_(id) {
  const sh = sheet_(SH.SUMBER);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada sumber dana.');
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  const idx = vals.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Sumber dana ' + id + ' tidak ditemukan.');
  sh.deleteRow(idx + 2);
  return String(vals[idx][0]);
}

/**
 * Total pendapatan bulanan dari sumber dana berstatus aktif.
 * opts: { tetap: true } -> hanya jenis 'tetap'
 */
function pendapatan_(opts) {
  const tetapSaja = opts && opts.tetap === true;
  let total = 0;
  const rincian = [];
  bacaSumberDana_().forEach(function (s) {
    if (String(s.Status).toLowerCase() === 'nonaktif') return;
    const jenis = isTetap_(s.Jenis) ? 'tetap' : 'tidak tetap';
    if (tetapSaja && jenis !== 'tetap') return;
    const perBulan = perBulan_(s.Jumlah, s.Frekuensi);
    total += perBulan;
    rincian.push({ ID: s.ID, Nama: s.Nama, Jenis: jenis, Frekuensi: s.Frekuensi, Jumlah: Number(s.Jumlah) || 0, perBulan: Math.round(perBulan) });
  });
  return { total: Math.round(total), rincian: rincian };
}

/* ----------------------------- PLOT ANGGARAN ----------------------------- */

/** Baca anggaran sebagai peta kategori -> {limit, kelompok, persen}. */
function petaAnggaran_() {
  const peta = {};
  baca_(SH.BUDGET).forEach(function (r) {
    const k = String(r.Kategori || '').trim();
    if (!k) return;
    peta[k] = {
      limit: Number(r.Limit) || 0,
      kelompok: String(r.Kelompok || kelompokDari_(k)),
      persen: Number(r.Persen) || 0
    };
  });
  return peta;
}

function kelompokDari_(kategori) {
  for (const g in KELOMPOK) {
    if (KELOMPOK[g].indexOf(kategori) > -1) return g;
  }
  return 'Lainnya';
}

/**
 * Susun plot anggaran otomatis dari sumber dana.
 * Dasar perhitungan: pendapatan TETAP bulanan (opsi tetapSaja), atau seluruh pendapatan.
 * Aturan 50/30/20 -> dipecah ke kategori sesuai BOBOT.
 *
 * opts: { dasar: 'tetap'|'semua', tulis: true|false }
 */
function plotAnggaran_(opts) {
  opts = opts || {};
  const dasarTetap = String(opts.dasar || 'tetap').toLowerCase() !== 'semua';
  const p = pendapatan_({ tetap: dasarTetap });
  if (!p.total) {
    throw new Error('Belum ada sumber dana ' + (dasarTetap ? 'tetap ' : '') +
      'yang aktif. Tambah dulu dengan /tambahsumber Gaji 8jt tetap bulanan');
  }
  const dasar = p.total;

  const hasil = {};
  const baris = [];
  Object.keys(KELOMPOK).forEach(function (g) {
    const alokasi = Math.round(dasar * PORSI[g]);
    const daftar = KELOMPOK[g];
    const bobotTotal = daftar.reduce(function (a, k) { return a + (BOBOT[g][k] || 0); }, 0) || 1;
    let terpakai = 0;
    daftar.forEach(function (k, i) {
      const w = BOBOT[g][k] || 0;
      let nominal = Math.round(alokasi * w / bobotTotal / 1000) * 1000; // bulatkan ke ribuan
      if (i === daftar.length - 1) nominal = alokasi - terpakai; // sisa pembulatan ke pos terakhir
      terpakai += nominal;
      const persen = Math.round(nominal / dasar * 1000) / 10;
      hasil[k] = { limit: nominal, kelompok: g, persen: persen };
      baris.push([k, nominal, 'bulanan', g, persen]);
    });
  });

  if (opts.tulis === true) {
    const sh = sheet_(SH.BUDGET);
    const last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, HEADERS.Anggaran.length).clearContent();
    sh.getRange(2, 1, baris.length, HEADERS.Anggaran.length).setValues(baris);
  }

  return {
    dasar: dasar,
    dasarTetap: dasarTetap,
    pemasukan: p,
    peta: hasil,
    baris: baris,
    total: baris.reduce(function (a, r) { return a + r[1]; }, 0)
  };
}

/* ----------------------------- ANGGARAN ----------------------------- */

function setAnggaran_(kategori, jumlah) {
  const j = parseNominal_(jumlah);
  if (j == null || isNaN(j) || j < 0) throw new Error('Limit tidak valid.');
  const sh = sheet_(SH.BUDGET);
  const last = sh.getLastRow();
  const mentah = String(kategori || '').trim();
  const kanonik = normalKategori_(mentah, 'keluar');
  // Kategori dikenal -> pakai nama kanonik. Kategori bebas -> simpan apa adanya
  // supaya tidak semua kategori baru menumpuk di "Lain-lain".
  const nama = (kanonik !== 'Lain-lain' || /^lain/i.test(mentah)) ? kanonik : (mentah || 'Lain-lain');
  const dasar = pendapatan_({ tetap: true }).total || pendapatan_({}).total || 0;
  const persen = dasar ? Math.round(j / dasar * 1000) / 10 : 0;
  const kelompok = kelompokDari_(nama);

  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    const idx = vals.findIndex(function (r) {
      return String(r[0]).trim().toLowerCase() === nama.toLowerCase();
    });
    if (idx > -1) {
      sh.getRange(idx + 2, 2, 1, 4).setValues([[j, 'bulanan', kelompok, persen]]);
      return { kategori: String(vals[idx][0]).trim(), limit: j, kelompok: kelompok, persen: persen, baru: false };
    }
  }
  sh.appendRow([nama, j, 'bulanan', kelompok, persen]);
  return { kategori: nama, limit: j, kelompok: kelompok, persen: persen, baru: true };
}

/* ----------------------------- FORMAT PESAN ----------------------------- */

function pesanBantuan_() {
  return [
    '<b>💰 UANGKU — Bot Pencatat Keuangan</b>',
    '',
    '<b>Catat transaksi</b>',
    '<code>/keluar 25rb makan nasi goreng</code>',
    '<code>/masuk 5jt gaji bulan ini</code>',
    '<code>/catat keluar 120000 transport bensin</code>',
    '',
    '<b>Langkah 1 — sumber dana</b>',
    '<code>/sumber</code> — daftar sumber dana &amp; total pendapatan',
    '<code>/tambahsumber Gaji 8jt tetap bulanan</code>',
    '<code>/tambahsumber Usaha 500rb harian</code>',
    '<code>/ubahsumber SD-0001 jumlah 9jt</code>',
    '<code>/hapussumber SD-0002</code>',
    '',
    '<b>Langkah 2 — plot anggaran</b>',
    '<code>/plotanggaran</code> — susun otomatis dari pendapatan tetap (50/30/20)',
    '<code>/plotanggaran semua</code> — pakai seluruh pendapatan',
    '<code>/anggaran</code> — realisasi vs plot',
    '<code>/setanggaran Makan 2jt</code> — ubah satu pos',
    '',
    '<b>Laporan</b>',
    '<code>/lapor</code> — ringkasan bulan ini',
    '<code>/lapor 2026-08</code> — bulan tertentu',
    '<code>/saldo</code> — pemasukan - pengeluaran',
    '<code>/grafik</code> — tren 6 bulan',
    '',
    '<b>Hutang</b>',
    '<code>/hutang</code> — daftar hutang',
    '<code>/tambahhutang Budi 2jt 500rb 2026-12-31</code>',
    '<code>/bayar HT-0001 500rb</code>',
    '',
    '<b>Kelola transaksi</b>',
    '<code>/edit TX-0007 jumlah 30rb</code> — ubah nominal',
    '<code>/edit TX-0007 kategori Transport</code>',
    '<code>/batal TX-0007</code> — batalkan (riwayat tetap ada)',
    '<code>/aktifkan TX-0007</code> — pulihkan transaksi batal',
    '',
    'Nominal bebas: <code>25rb</code>, <code>1,5jt</code>, <code>1.500.000</code>, <code>50k</code>'
  ].join('\n');
}

function pesanRingkasan_(r) {
  const lines = [
    '<b>📊 Laporan ' + r.namaBulan + '</b>',
    '',
    '⬆️ Pemasukan   : <b>' + rupiah_(r.pemasukan) + '</b>',
    '⬇️ Pengeluaran : <b>' + rupiah_(r.pengeluaran) + '</b>',
    (r.selisih >= 0 ? '✅ Surplus    : <b>' : '⚠️ Defisit    : <b>') + rupiah_(Math.abs(r.selisih)) + '</b>',
    '💾 Rasio tabungan: <b>' + (r.rasioTabungan * 100).toFixed(1) + '%</b>',
    ''
  ];

  const kat = Object.keys(r.perKategori).sort(function (a, b) { return r.perKategori[b] - r.perKategori[a]; });
  if (kat.length) {
    lines.push('<b>Pengeluaran per kategori</b>');
    kat.slice(0, 8).forEach(function (k) {
      const v = r.perKategori[k];
      const lim = r.anggaran[k] || 0;
      const pct = lim > 0 ? Math.round(v / lim * 100) : null;
      const bar = lim > 0 ? ' (' + pct + '%' + (pct > 100 ? ' ⛔' : pct > 80 ? ' ⚠️' : '') + ')' : '';
      lines.push('• ' + k + ': ' + rupiah_(v) + bar);
    });
    lines.push('');
  }

  lines.push('🧾 ' + r.jumlahTransaksi + ' transaksi');
  if (r.totalHutang > 0) lines.push('🏦 Total sisa hutang: <b>' + rupiah_(r.totalHutang) + '</b>');
  return lines.join('\n');
}

function pesanAnggaran_(r) {
  const peta = r.petaAnggaran || {};
  const pk = r.perKategori || {};
  const kat = Object.keys(peta).filter(function (k) { return peta[k].limit > 0; });
  if (!kat.length) {
    return '🎯 Belum ada plot anggaran.\n\nLangkah 1 — daftarkan sumber dana:\n<code>/tambahsumber Gaji 8jt tetap bulanan</code>\nLangkah 2 — susun plot otomatis:\n<code>/plotanggaran</code>';
  }

  const pendapatanTetap = r.pendapatanTetap || 0;
  const lines = ['<b>🎯 Plot Anggaran ' + r.namaBulan + '</b>'];
  if (pendapatanTetap > 0) lines.push('<i>Dasar: pendapatan tetap ' + rupiah_(pendapatanTetap) + '/bulan</i>');
  lines.push('');

  const urutan = ['Kebutuhan', 'Keinginan', 'Tabungan', 'Lainnya'];
  let totLim = 0, totPak = 0;
  urutan.forEach(function (g) {
    const isi = kat.filter(function (k) { return peta[k].kelompok === g; });
    if (!isi.length) return;
    const limG = isi.reduce(function (a, k) { return a + peta[k].limit; }, 0);
    const pakG = isi.reduce(function (a, k) { return a + (pk[k] || 0); }, 0);
    totLim += limG; totPak += pakG;
    const pctG = limG ? Math.round(pakG / limG * 100) : 0;
    lines.push('<b>' + g.toUpperCase() + '</b> — ' + rupiah_(limG) +
      ' (' + (pendapatanTetap ? Math.round(limG / pendapatanTetap * 100) : 0) + '% pendapatan) · terpakai ' + pctG + '%');
    isi.sort(function (a, b) { return peta[b].limit - peta[a].limit; }).forEach(function (k) {
      const lim = peta[k].limit;
      const pak = pk[k] || 0;
      const pct = lim ? Math.round(pak / lim * 100) : 0;
      const penuh = Math.max(0, Math.min(10, Math.round(pct / 10)));
      const bar = '█'.repeat(penuh) + '░'.repeat(10 - penuh);
      lines.push('  ' + k + ' <code>' + bar + '</code> ' + pct + '%');
      lines.push('     ' + rupiah_(pak) + ' / ' + rupiah_(lim) +
        (pak > lim ? ' ⛔ lebih ' + rupiah_(pak - lim) : ' sisa ' + rupiah_(lim - pak)));
    });
    lines.push('');
  });

  lines.push('<b>TOTAL anggaran:</b> ' + rupiah_(totLim) + ' · terpakai ' + rupiah_(totPak) +
    ' (' + (totLim ? Math.round(totPak / totLim * 100) : 0) + '%)');
  if (pendapatanTetap > 0) {
    const sisa = pendapatanTetap - totPak;
    lines.push('Pendapatan tetap: ' + rupiah_(pendapatanTetap) + ' → ' +
      (sisa >= 0 ? 'sisa ' + rupiah_(sisa) : '⛔ lewat ' + rupiah_(-sisa)));
  }
  return lines.join('\n');
}

/** Pesan hasil penyusunan plot anggaran. */
function pesanPlot_(plot) {
  const lines = [
    '<b>📐 Plot Anggaran Tersusun</b>',
    '',
    'Dasar: pendapatan <b>' + (plot.dasarTetap ? 'tetap' : 'seluruh') + '</b> bulanan = <b>' + rupiah_(plot.dasar) + '</b>',
    ''
  ];
  plot.pemasukan.rincian.forEach(function (s) {
    lines.push('• ' + s.Nama + ' (' + s.Jenis + ', ' + s.Frekuensi + ') = ' + rupiah_(s.perBulan) + '/bln');
  });
  lines.push('');
  Object.keys(KELOMPOK).forEach(function (g) {
    const isi = plot.baris.filter(function (b) { return b[3] === g; });
    const total = isi.reduce(function (a, b) { return a + b[1]; }, 0);
    lines.push('<b>' + g + '</b> — ' + rupiah_(total) + ' (' + Math.round(PORSI[g] * 100) + '%)');
    isi.forEach(function (b) { lines.push('   ' + b[0] + ': ' + rupiah_(b[1]) + ' (' + b[4] + '%)'); });
    lines.push('');
  });
  lines.push('<b>Total:</b> ' + rupiah_(plot.total) + '/bulan');
  lines.push('<i>Ubah satu pos: /setanggaran Makan 2jt</i>');
  return lines.join('\n');
}

function pesanSumber_() {
  const daftar = bacaSumberDana_();
  if (!daftar.length) {
    return ['<b>💰 Sumber Dana</b>', '',
      'Belum ada sumber dana. Tambahkan dulu:',
      '<code>/tambahsumber Gaji 8jt tetap bulanan</code>',
      '<code>/tambahsumber Usaha 500rb harian</code>',
      '',
      'Frekuensi: <code>bulanan</code>, <code>mingguan</code>, <code>harian</code>, <code>tahunan</code>',
      'Jenis: <code>tetap</code> atau <code>tidak tetap</code>'
    ].join('\n');
  }
  const p = pendapatan_({});
  const pTetap = pendapatan_({ tetap: true });
  const lines = ['<b>💰 Sumber Dana</b>', ''];
  daftar.forEach(function (s) {
    const nonaktif = String(s.Status).toLowerCase() === 'nonaktif';
    lines.push((nonaktif ? '⏸️ ' : '✅ ') + '<b>' + s.ID + '</b> — ' + s.Nama +
      (nonaktif ? ' <i>(nonaktif)</i>' : ''));
    lines.push('   ' + s.Jenis + ' · ' + rupiah_(Number(s.Jumlah) || 0) + '/' + s.Frekuensi +
      ' → <b>' + rupiah_(perBulan_(s.Jumlah, s.Frekuensi)) + '/bulan</b>');
    if (s.TanggalMulai) lines.push('   mulai ' + tanggalStr_(s.TanggalMulai));
  });
  lines.push('');
  lines.push('Pendapatan tetap  : <b>' + rupiah_(pTetap.total) + '/bulan</b>');
  lines.push('Total pendapatan  : <b>' + rupiah_(p.total) + '/bulan</b>');
  lines.push('');
  lines.push('Susun plot anggaran: <code>/plotanggaran</code>');
  return lines.join('\n');
}

function pesanGrafik_() {
  const semua = baca_(SH.TX).filter(function (r) { return String(r.Status) === 'aktif'; });
  const perBulan = {};
  semua.forEach(function (r) {
    const b = bulanDari_(r.Tanggal);
    if (!b) return;
    perBulan[b] = perBulan[b] || { masuk: 0, keluar: 0 };
    if (r.Tipe === 'masuk') perBulan[b].masuk += Number(r.Jumlah) || 0;
    else perBulan[b].keluar += Number(r.Jumlah) || 0;
  });
  const bulan = Object.keys(perBulan).sort().slice(-6);
  if (!bulan.length) return 'Belum ada data.';
  const max = Math.max.apply(null, bulan.map(function (b) {
    return Math.max(perBulan[b].masuk, perBulan[b].keluar);
  }));
  const lines = ['<b>📈 Tren 6 Bulan</b>', ''];
  bulan.forEach(function (b) {
    const d = perBulan[b];
    const wm = Math.max(1, Math.round(d.masuk / max * 12));
    const wk = Math.max(1, Math.round(d.keluar / max * 12));
    lines.push(b);
    lines.push('  ⬆️ <code>' + '█'.repeat(wm) + '</code> ' + rupiah_(d.masuk));
    lines.push('  ⬇️ <code>' + '█'.repeat(wk) + '</code> ' + rupiah_(d.keluar));
    lines.push('  ' + (d.masuk - d.keluar >= 0 ? '✅ ' : '⚠️ ') + rupiah_(d.masuk - d.keluar));
  });
  return lines.join('\n');
}

function pesanHutang_() {
  const daftar = daftarHutang_().filter(function (r) { return String(r.Status) === 'aktif'; });
  if (!daftar.length) return '🎉 Tidak ada hutang aktif.';
  const lines = ['<b>🏦 Hutang Aktif</b>', ''];
  let total = 0;
  daftar.forEach(function (r) {
    const sisa = Number(r.Sisa) || 0;
    total += sisa;
    const pokok = Number(r.Pokok) || 0;
    const pct = pokok > 0 ? Math.round((1 - sisa / pokok) * 100) : 0;
    lines.push('<b>' + r.ID + '</b> — ' + r.Nama);
    lines.push('   Sisa <b>' + rupiah_(sisa) + '</b> dari ' + rupiah_(pokok) + ' (' + pct + '% lunas)');
    if (Number(r.Cicilan) > 0) lines.push('   Cicilan ' + rupiah_(r.Cicilan) + '/bulan');
    if (r.JatuhTempo) lines.push('   Tempo: ' + tanggalStr_(r.JatuhTempo));
  });
  lines.push('');
  lines.push('<b>Total sisa:</b> ' + rupiah_(total));
  lines.push('Bayar: <code>/bayar ' + daftar[0].ID + ' 500rb</code>');
  return lines.join('\n');
}

/* ----------------------------- ROUTER TELEGRAM ----------------------------- */

function prosesTelegram_(update) {
  const msg = update.message || (update.callback_query && update.callback_query.message);
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  if (!chatDiizinkan_(chatId)) {
    kirimTelegram_(chatId, '⛔ Chat ini tidak diizinkan. Chat ID: <code>' + chatId + '</code>');
    return;
  }

  const teks = String(msg.text).trim();
  const parts = teks.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
  const args = parts.slice(1);

  try {
    switch (cmd) {
      case 'start':
      case 'help':
      case 'bantuan':
        kirimTelegram_(chatId, pesanBantuan_());
        return;

      case 'masuk':
      case 'keluar':
        if (args.length < 2) throw new Error('Format: /' + cmd + ' <jumlah> <kategori> [catatan]');
        kirimTelegram_(chatId, aksiCatat_(chatId, cmd, args));
        return;

      case 'catat': {
        if (args.length < 3) throw new Error('Format: /catat <masuk|keluar> <jumlah> <kategori> [catatan]');
        const tipe = args[0].toLowerCase() === 'masuk' ? 'masuk' : 'keluar';
        kirimTelegram_(chatId, aksiCatat_(chatId, tipe, args.slice(1)));
        return;
      }

      case 'lapor':
      case 'laporan':
        kirimTelegram_(chatId, pesanRingkasan_(ringkasan_(args[0])));
        return;

      case 'sumber':
      case 'sumberdana':
        kirimTelegram_(chatId, pesanSumber_());
        return;

      case 'tambahsumber':
      case 'addsumber': {
        if (args.length < 2) throw new Error(
          'Format: /tambahsumber <nama> <jumlah> [tetap|tidak tetap] [frekuensi]\n' +
          'Contoh: /tambahsumber Gaji 8jt tetap bulanan');
        const s = tambahSumber_({
          nama: args[0], jumlah: args[1],
          jenis: args[2] || 'tetap',
          frekuensi: args[3] || 'bulanan'
        });
        const p = pendapatan_({ tetap: true });
        kirimTelegram_(chatId, [
          '✅ Sumber dana <b>' + s.ID + '</b> ditambahkan',
          '<b>' + s.Nama + '</b> — ' + s.Jenis + ' · ' + rupiah_(s.Jumlah) + '/' + s.Frekuensi +
            ' = <b>' + rupiah_(perBulan_(s.Jumlah, s.Frekuensi)) + '/bulan</b>',
          '',
          'Pendapatan tetap bulanan: <b>' + rupiah_(p.total) + '</b>',
          'Lanjut susun plot: <code>/plotanggaran</code>'
        ].join('\n'));
        return;
      }

      case 'ubahsumber': {
        if (args.length < 3) throw new Error('Format: /ubahsumber <ID> <field> <nilai>\nfield: nama, jumlah, jenis, frekuensi, status, catatan');
        const patch = {};
        patch[args[1].toLowerCase()] = args.slice(2).join(' ');
        const s = ubahSumber_(args[0], patch);
        kirimTelegram_(chatId, '✏️ Sumber <b>' + s.ID + '</b> diperbarui: ' + s.Nama +
          ' · ' + rupiah_(s.Jumlah) + '/' + s.Frekuensi + ' (' + s.Status + ')');
        return;
      }

      case 'hapussumber':
      case 'hapusumber': {
        if (!args[0]) throw new Error('Format: /hapussumber <ID>');
        const id = hapusSumber_(args[0]);
        kirimTelegram_(chatId, '🗑️ Sumber dana <b>' + id + '</b> dihapus.');
        return;
      }

      case 'plotanggaran':
      case 'plot': {
        const dasar = (args[0] || '').toLowerCase() === 'semua' ? 'semua' : 'tetap';
        const plot = plotAnggaran_({ dasar: dasar, tulis: true });
        kirimTelegram_(chatId, pesanPlot_(plot));
        return;
      }

      case 'anggaran':
      case 'budget':
        kirimTelegram_(chatId, pesanAnggaran_(ringkasan_(args[0])));
        return;

      case 'setanggaran':
        if (args.length < 2) throw new Error('Format: /setanggaran <kategori> <jumlah>');
        var sa = setAnggaran_(args[0], args[1]);
        kirimTelegram_(chatId, '✅ Anggaran <b>' + sa.kategori + '</b> ' +
          (sa.baru ? 'dibuat' : 'diperbarui') + ': <b>' + rupiah_(sa.limit) + '</b>/bulan');
        return;

      case 'saldo': {
        const r = ringkasan_(args[0]);
        kirimTelegram_(chatId, [
          '<b>💼 Saldo ' + r.namaBulan + '</b>', '',
          'Masuk   : ' + rupiah_(r.pemasukan),
          'Keluar  : ' + rupiah_(r.pengeluaran),
          '<b>Selisih: ' + rupiah_(r.selisih) + '</b>',
          r.totalHutang > 0 ? 'Hutang  : ' + rupiah_(r.totalHutang) : ''
        ].filter(Boolean).join('\n'));
        return;
      }

      case 'grafik':
      case 'tren':
        kirimTelegram_(chatId, pesanGrafik_());
        return;

      case 'hutang':
      case 'utang':
        kirimTelegram_(chatId, pesanHutang_());
        return;

      case 'tambahhutang':
      case 'addhutang': {
        if (args.length < 2) throw new Error('Format: /tambahhutang <nama> <pokok> [cicilan] [tempo YYYY-MM-DD]');
        const h = tambahHutang_({
          nama: args[0], pokok: args[1], cicilan: args[2] || 0, tempo: args[3] || ''
        });
        kirimTelegram_(chatId, '✅ Hutang <b>' + h.ID + '</b> untuk <b>' + h.Nama + '</b> sebesar ' +
          rupiah_(h.Pokok) + ' dicatat.');
        return;
      }

      case 'bayar': {
        if (args.length < 2) throw new Error('Format: /bayar <ID> <jumlah>');
        const b = bayarHutang_(args[0], args[1]);
        kirimTelegram_(chatId, '💸 Pembayaran ' + rupiah_(Number(b.dibayar)) + ' tercatat untuk <b>' +
          b.nama + '</b>.\nSisa: <b>' + rupiah_(b.sisa) + '</b>' + (b.lunas ? '\n🎉 LUNAS!' : ''));
        return;
      }

      case 'batal':
      case 'hapus': {
        if (!args[0]) throw new Error('Format: /batal <ID transaksi>');
        const id = batalkan_(args[0]);
        kirimTelegram_(chatId, '🗑️ Transaksi <b>' + id + '</b> dibatalkan.\nPulihkan dengan <code>/aktifkan ' + id + '</code>');
        return;
      }

      case 'aktifkan':
      case 'pulihkan': {
        if (!args[0]) throw new Error('Format: /aktifkan <ID transaksi>');
        const id = aktifkan_(args[0]);
        kirimTelegram_(chatId, '♻️ Transaksi <b>' + id + '</b> diaktifkan kembali.');
        return;
      }

      case 'edit':
      case 'ubah': {
        if (args.length < 3) {
          throw new Error('Format: /edit <ID> <field> <nilai>\nfield: jumlah, kategori, catatan, tanggal, tipe, akun');
        }
        const field = args[1].toLowerCase();
        const nilai = args.slice(2).join(' ');
        const patch = {};
        patch[field] = nilai;
        const h = ubahTransaksi_(args[0], patch);
        const s = h.sesudah;
        kirimTelegram_(chatId, [
          '✏️ <b>' + h.ID + '</b> diperbarui',
          'Tipe: <b>' + s.Tipe + '</b>',
          'Kategori: <b>' + s.Kategori + '</b>',
          'Jumlah: <b>' + rupiah_(s.Jumlah) + '</b>',
          s.Catatan ? 'Catatan: ' + s.Catatan : '',
          'Tanggal: ' + s.Tanggal
        ].filter(Boolean).join('\n'));
        return;
      }

      case 'id':
        kirimTelegram_(chatId, 'Chat ID Anda: <code>' + chatId + '</code>');
        return;

      default:
        kirimTelegram_(chatId, '❓ Perintah <code>/' + cmd + '</code> tidak dikenal.\n\n' + pesanBantuan_());
    }
  } catch (err) {
    kirimTelegram_(chatId, '❌ ' + err.message);
  }
}

function aksiCatat_(chatId, tipe, args) {
  const jumlah = args[0];
  const kategori = args[1];
  const catatan = args.slice(2).join(' ');
  const row = catatTransaksi_({ tipe: tipe, jumlah: jumlah, kategori: kategori, catatan: catatan });
  const r = ringkasan_();
  const ikon = row.Tipe === 'masuk' ? '⬆️' : '⬇️';
  return [
    ikon + ' <b>' + row.Tipe.toUpperCase() + '</b> ' + rupiah_(row.Jumlah),
    'Kategori: <b>' + row.Kategori + '</b>',
    catatan ? 'Catatan: ' + catatan : '',
    row.Tanggal,
    '<i>ID: ' + row.ID + '</i>',
    '',
    'Saldo bulan ini: <b>' + rupiah_(r.selisih) + '</b>'
  ].filter(Boolean).join('\n');
}

/* ----------------------------- WEB ENTRY POINTS ----------------------------- */

function doPost(e) {
  try {
    // Telegram webhook: body = update JSON, tidak punya field "action"
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (ignore) { body = {}; }
    }

    if (body && body.message) {
      // verifikasi secret (jika diset) lewat query string
      if (WEBHOOK_SECRET && (!e.parameter || e.parameter.k !== WEBHOOK_SECRET)) {
        return json_({ ok: false, error: 'secret tidak cocok' });
      }
      // balas cepat lalu proses (Apps Script tidak punya async; proses sinkron)
      prosesTelegram_(body);
      return json_({ ok: true });
    }

    if (body && body.action) {
      return json_(api_(body, e.parameter || {}));
    }

    // Unggah lampiran lewat POST agar berkas besar tidak melewati batas panjang URL.
    if (body && body.lampiran) {
      if (API_TOKEN && body.token !== API_TOKEN) return json_({ ok: false, error: 'unauthorized' });
      const meta = simpanLampiran_(body.lampiran, body.nama, body.id);
      return json_({ ok: true, data: meta });
    }

    return json_({ ok: false, error: 'Payload tidak dikenali' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action) return json_(api_(p, p));
    return json_({
      ok: true,
      service: 'UANGKU API',
      versi: '1.0',
      waktu: new Date().toISOString(),
      endpoint: ['dashboard', 'transaksi', 'hutang', 'anggaran', 'ping']
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** API untuk dashboard. Semua request lewat doGet (query string) => tanpa preflight CORS. */
function api_(req, params) {
  if (API_TOKEN && params.token !== API_TOKEN) {
    return { ok: false, error: 'unauthorized' };
  }
  const action = String(params.action || '').toLowerCase();

  switch (action) {
    case 'ping':
      return { ok: true, waktu: new Date().toISOString(), bulan: bulanIni_() };

    case 'dashboard': {
      const bulan = params.bulan || bulanIni_();
      const r = ringkasan_(bulan);
      const semua = baca_(SH.TX).filter(function (x) { return String(x.Status) === 'aktif'; });
      const perBulan = {};
      semua.forEach(function (x) {
        const b = bulanDari_(x.Tanggal);
        if (!b) return;
        perBulan[b] = perBulan[b] || { bulan: b, masuk: 0, keluar: 0 };
        if (x.Tipe === 'masuk') perBulan[b].masuk += Number(x.Jumlah) || 0;
        else perBulan[b].keluar += Number(x.Jumlah) || 0;
      });
      const tren = Object.keys(perBulan).sort().slice(-12).map(function (b) {
        perBulan[b].selisih = perBulan[b].masuk - perBulan[b].keluar;
        return perBulan[b];
      });
      return {
        ok: true,
        bulan: r.bulan,
        namaBulan: r.namaBulan,
        pemasukan: r.pemasukan,
        pengeluaran: r.pengeluaran,
        selisih: r.selisih,
        status: r.status,
        rasioTabungan: r.rasioTabungan,
        perKategori: r.perKategori,
        anggaran: r.anggaran,
        totalHutang: r.totalHutang,
        jumlahTransaksi: r.jumlahTransaksi,
        pendapatanTetap: r.pendapatanTetap,
        pendapatanTotal: r.pendapatanTotal,
        dasarAnggaran: r.dasarAnggaran,
        cicilanHutang: r.cicilanHutang,
        rincianSumber: r.rincianSumber,
        petaAnggaran: r.petaAnggaran,
        tren: tren,
        transaksi: r.transaksi.map(function (x) {
          return {
            id: x.ID,
            tanggal: tanggalStr_(x.Tanggal),
            tipe: x.Tipe,
            kategori: x.Kategori,
            jumlah: Number(x.Jumlah) || 0,
            akun: x.Akun || 'Tunai',
            catatan: x.Catatan || '',
            sumber: x.Sumber || '',
            status: String(x.Status) === 'batal' ? 'batal' : 'aktif',
            lampiran: bacaLampiran_(x.Lampiran)
          };
        }).sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; }),
        hutang: daftarHutang_().filter(function (x) { return String(x.Status) === 'aktif'; })
          .map(function (x) {
            return {
              id: x.ID, nama: x.Nama, pokok: Number(x.Pokok) || 0,
              dibayar: Number(x.Dibayar) || 0, sisa: Number(x.Sisa) || 0,
              cicilan: Number(x.Cicilan) || 0, tempo: tanggalStr_(x.JatuhTempo),
              catatan: x.Catatan || ''
            };
          })
      };
    }

    /* ---- sumber dana ---- */

    case 'sumber':
    case 'sumberdana':
      return { ok: true, data: bacaSumberDana_(), pendapatan: pendapatan_({}), pendapatanTetap: pendapatan_({ tetap: true }).total };

    case 'tambahsumber':
      return {
        ok: true,
        data: tambahSumber_({
          nama: params.nama, jumlah: params.jumlah,
          jenis: params.jenis || 'tetap', frekuensi: params.frekuensi || 'bulanan',
          mulai: params.mulai || '', catatan: params.catatan || ''
        })
      };

    case 'ubahsumber':
      return { ok: true, data: ubahSumber_(params.id, params) };

    case 'hapussumber':
      return { ok: true, data: hapusSumber_(params.id) };

    /* ---- plot anggaran ---- */

    case 'plotanggaran': {
      const p = plotAnggaran_({
        dasar: params.dasar || 'tetap',
        tulis: String(params.simpan) === 'true' || String(params.simpan) === '1'
      });
      return { ok: true, data: { dasar: p.dasar, dasarTetap: p.dasarTetap, baris: p.baris, total: p.total } };
    }

    case 'transaksi':
      return { ok: true, data: baca_(SH.TX) };

    /* ---- aksi tulis dari dashboard ---- */

    case 'catat': {
      let lampiran = null;
      if (params.lampiran) {
        lampiran = simpanLampiran_(params.lampiran, params.lampiranNama, '');
      }
      const row = catatTransaksi_({
        tipe: params.tipe,
        jumlah: params.jumlah,
        kategori: params.kategori,
        catatan: params.catatan || '',
        akun: params.akun || 'Tunai',
        tanggal: params.tanggal || '',
        sumber: params.sumber || 'web',
        lampiran: lampiran
      });
      return { ok: true, data: row, lampiran: lampiran };
    }

    case 'lampiran':
      return { ok: true, data: simpanLampiran_(params.data, params.nama, params.id) };

    case 'bayar':
      return { ok: true, data: bayarHutang_(params.id, params.jumlah) };

    case 'tambahhutang':
      return {
        ok: true,
        data: tambahHutang_({
          nama: params.nama, pokok: params.pokok,
          cicilan: params.cicilan || 0, tempo: params.tempo || '',
          catatan: params.catatan || ''
        })
      };

    case 'ubah':
    case 'edit':
      return { ok: true, data: ubahTransaksi_(params.id, params) };

    case 'aktifkan':
    case 'restore':
      return { ok: true, data: aktifkan_(params.id) };

    case 'batal':
    case 'hapus':
      return { ok: true, data: batalkan_(params.id, params.status) };

    case 'setanggaran':
      return { ok: true, data: setAnggaran_(params.kategori, params.jumlah) };

    case 'hutang':
      return { ok: true, data: daftarHutang_() };

    case 'anggaran':
      return { ok: true, data: baca_(SH.BUDGET) };

    default:
      return { ok: false, error: 'action tidak dikenal: ' + action };
  }
}

/* ----------------------------- TRIGGER HARIAN (opsional) ----------------------------- */

/** Jalankan sekali untuk memasang pengingat harian jam 20:00. */
function pasangPengingatHarian() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pengingatHarian') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pengingatHarian').timeBased().atHour(20).everyDays(1).create();
  return 'Pengingat harian dipasang.';
}

function pengingatHarian() {
  const list = cfg_('ALLOWED_CHAT_IDS').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!list.length) return;
  const r = ringkasan_();
  const pesan = '🔔 <b>Reminder ' + r.namaBulan + '</b>\n\n' +
    'Masuk  : ' + rupiah_(r.pemasukan) + '\n' +
    'Keluar : ' + rupiah_(r.pengeluaran) + '\n' +
    'Selisih: <b>' + rupiah_(r.selisih) + '</b>\n\n' +
    'Sudah catat hari ini? <code>/keluar 25rb makan</code>';
  list.forEach(function (id) { kirimTelegram_(id, pesan); });
}
