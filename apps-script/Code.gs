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

const SH = { TX: 'Transaksi', DEBT: 'Hutang', BUDGET: 'Anggaran', SET: 'Pengaturan' };

const HEADERS = {
  Transaksi:  ['ID', 'Tanggal', 'Tipe', 'Kategori', 'Jumlah', 'Akun', 'Catatan', 'Sumber', 'Status', 'Dibuat'],
  Hutang:     ['ID', 'Nama', 'Pokok', 'Dibayar', 'Sisa', 'Cicilan', 'JatuhTempo', 'Status', 'Catatan'],
  Anggaran:   ['Kategori', 'Limit', 'Periode'],
  Pengaturan: ['Key', 'Value']
};

const KATEGORI_KELUAR = ['Makan', 'Transport', 'Belanja', 'Tagihan', 'Kesehatan',
                         'Pendidikan', 'Hiburan', 'Rumah', 'Cicilan', 'Lain-lain'];
const KATEGORI_MASUK  = ['Gaji', 'Bonus', 'Usaha', 'Investasi', 'Hadiah', 'Lain-lain'];

const ANGGARAN_DEFAULT = {
  Makan: 1500000, Transport: 600000, Belanja: 500000, Tagihan: 500000,
  Kesehatan: 300000, Pendidikan: 300000, Hiburan: 200000, Rumah: 800000,
  Cicilan: 1000000, 'Lain-lain': 200000
};

/* ----------------------------- UTIL ----------------------------- */

function rupiah_(n) {
  return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function tanggalHariIni_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function bulanDari_(ymd) { return String(ymd || '').slice(0, 7); }

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

  // Anggaran default (hanya jika masih kosong)
  const shAng = sheet_(SH.BUDGET);
  if (shAng.getLastRow() < 2) {
    const rows = Object.keys(ANGGARAN_DEFAULT).map(function (k) {
      return [k, ANGGARAN_DEFAULT[k], 'bulanan'];
    });
    shAng.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  const shSet = sheet_(SH.SET);
  if (shSet.getLastRow() < 2) {
    shSet.getRange(2, 1, 2, 2).setValues([['dibuat', new Date().toISOString()], ['versi', '1.0']]);
  }

  SpreadsheetApp.getActive(); // no-op agar izin Sheets ter-trigger
  return 'Setup selesai. Sheet: ' + Object.keys(SH).join(', ');
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
    Dibuat: new Date().toISOString()
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
  const anggaran = {};
  baca_(SH.BUDGET).forEach(function (r) { anggaran[r.Kategori] = Number(r.Limit) || 0; });

  const hutang = baca_(SH.DEBT).filter(function (r) { return String(r.Status) === 'aktif'; });
  const totalHutang = hutang.reduce(function (a, r) { return a + (Number(r.Sisa) || 0); }, 0);

  const sisa = masuk - keluar;
  const rasioTabungan = masuk > 0 ? sisa / masuk : 0;

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
    totalHutang: totalHutang,
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

function batalkan_(id) {
  const sh = sheet_(SH.TX);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Belum ada transaksi.');
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const idx = ids.findIndex(function (r) { return String(r[0]).toLowerCase() === String(id).toLowerCase(); });
  if (idx === -1) throw new Error('Transaksi ' + id + ' tidak ditemukan.');
  sh.getRange(idx + 2, 9).setValue('batal');
  return String(ids[idx][0]);
}

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
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    const idx = vals.findIndex(function (r) {
      return String(r[0]).trim().toLowerCase() === nama.toLowerCase();
    });
    if (idx > -1) {
      sh.getRange(idx + 2, 2).setValue(j);
      return { kategori: String(vals[idx][0]).trim(), limit: j, baru: false };
    }
  }
  sh.appendRow([nama, j, 'bulanan']);
  return { kategori: nama, limit: j, baru: true };
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
    '<b>Laporan</b>',
    '<code>/lapor</code> — ringkasan bulan ini',
    '<code>/lapor 2026-08</code> — bulan tertentu',
    '<code>/anggaran</code> — realisasi vs anggaran',
    '<code>/saldo</code> — pemasukan - pengeluaran',
    '<code>/grafik</code> — tren 6 bulan',
    '',
    '<b>Hutang</b>',
    '<code>/hutang</code> — daftar hutang',
    '<code>/tambahhutang Budi 2jt 500rb 2026-12-31</code>',
    '<code>/bayar HT-0001 500rb</code>',
    '',
    '<b>Lain-lain</b>',
    '<code>/batal TX-0007</code> — batalkan transaksi',
    '<code>/setanggaran Makan 1.5jt</code>',
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
  const kat = Object.keys(r.anggaran).filter(function (k) { return r.anggaran[k] > 0; });
  if (!kat.length) return 'Belum ada anggaran. Set dengan /setanggaran Makan 1.5jt';
  const lines = ['<b>🎯 Anggaran ' + r.namaBulan + '</b>', ''];
  let totalLimit = 0, totalPakai = 0;
  kat.sort(function (a, b) {
    const pa = (r.perKategori[a] || 0) / r.anggaran[a];
    const pb = (r.perKategori[b] || 0) / r.anggaran[b];
    return pb - pa;
  }).forEach(function (k) {
    const lim = r.anggaran[k];
    const pakai = r.perKategori[k] || 0;
    totalLimit += lim; totalPakai += pakai;
    const pct = Math.round(pakai / lim * 100);
    const penuh = Math.max(0, Math.min(10, Math.round(pct / 10)));
    const bar = '█'.repeat(penuh) + '░'.repeat(10 - penuh);
    lines.push(k + ' <code>' + bar + '</code> ' + pct + '%');
    lines.push('   ' + rupiah_(pakai) + ' / ' + rupiah_(lim) +
      (pakai > lim ? ' ⛔ lebih ' + rupiah_(pakai - lim) : ' sisa ' + rupiah_(lim - pakai)));
  });
  lines.push('');
  lines.push('<b>Total:</b> ' + rupiah_(totalPakai) + ' / ' + rupiah_(totalLimit) +
    ' (' + Math.round(totalPakai / totalLimit * 100) + '%)');
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
    if (r.JatuhTempo) lines.push('   Tempo: ' + String(r.JatuhTempo).slice(0, 10));
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
        kirimTelegram_(chatId, '🗑️ Transaksi <b>' + id + '</b> dibatalkan.');
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
        tren: tren,
        transaksi: r.transaksi.map(function (x) {
          return {
            id: x.ID,
            tanggal: String(x.Tanggal).slice(0, 10),
            tipe: x.Tipe,
            kategori: x.Kategori,
            jumlah: Number(x.Jumlah) || 0,
            akun: x.Akun,
            catatan: x.Catatan,
            sumber: x.Sumber
          };
        }).sort(function (a, b) { return a.tanggal < b.tanggal ? 1 : -1; }),
        hutang: daftarHutang_().filter(function (x) { return String(x.Status) === 'aktif'; })
          .map(function (x) {
            return {
              id: x.ID, nama: x.Nama, pokok: Number(x.Pokok) || 0,
              dibayar: Number(x.Dibayar) || 0, sisa: Number(x.Sisa) || 0,
              cicilan: Number(x.Cicilan) || 0, tempo: String(x.JatuhTempo || '').slice(0, 10)
            };
          })
      };
    }

    case 'transaksi':
      return { ok: true, data: baca_(SH.TX) };

    /* ---- aksi tulis dari dashboard ---- */

    case 'catat': {
      const row = catatTransaksi_({
        tipe: params.tipe,
        jumlah: params.jumlah,
        kategori: params.kategori,
        catatan: params.catatan || '',
        akun: params.akun || 'Tunai',
        tanggal: params.tanggal || '',
        sumber: 'web'
      });
      return { ok: true, data: row };
    }

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

    case 'batal':
    case 'hapus':
      return { ok: true, data: batalkan_(params.id) };

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
