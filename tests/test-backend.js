/**
 * Harness uji backend Code.gs di Node tanpa Google.
 * Menyediakan tiruan (fake) SpreadsheetApp / PropertiesService / Utilities / Session / UrlFetchApp,
 * lalu menjalankan alur nyata: setup -> catat -> anggaran -> hutang -> bayar -> batal -> API dashboard.
 */
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'apps-script', 'Code.gs');
let src = fs.readFileSync(path, 'utf8');

/* ---------------- Fake Sheet / SpreadsheetApp ---------------- */
class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(v) {
    v.forEach((line, r) => line.forEach((val, c) => this.sheet.put(this.row + r, this.col + c, val)));
    return this;
  }
  setValue(v) { this.sheet.put(this.row, this.col, v); return this; }
  clearContent() {
    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) this.sheet.put(this.row + r, this.col + c, '');
    }
    return this;
  }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  cell(r, c) { const row = this.rows[r - 1] || []; const v = row[c - 1]; return v === undefined ? '' : v; }
  put(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() {
    let last = 0;
    this.rows.forEach((row, i) => { if (row.some(x => String(x).trim() !== '')) last = i + 1; });
    return last;
  }
  appendRow(arr) { this.rows.push(arr.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  getRange(a, b, c, d) { return new Range(this, a, b, c || 1, d || 1); }
  setFrozenRows() { return this; }
}
class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets[n] = s; return s; }
}
const FAKE = new Spreadsheet();
const PROPS_STORE = {
  SHEET_ID: 'fake-sheet-id',
  BOT_TOKEN: '111:FAKE-TOKEN',
  API_TOKEN: 'rahasia123',
  WEBHOOK_SECRET: '',
  ALLOWED_CHAT_IDS: ''
};

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => PROPS_STORE[k] || null,
  setProperty: (k, v) => { PROPS_STORE[k] = v; }
}) };
global.SpreadsheetApp = {
  openById: () => FAKE,
  getActive: () => FAKE,
  getActiveSpreadsheet: () => FAKE
};
global.Utilities = { formatDate: (d, tz, fmt) => {
  const p = n => String(n).padStart(2, '0');
  return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()));
} };
global.Session = { getScriptTimeZone: () => 'Asia/Jakarta' };
global.Logger = { log: () => {} };
const SENT = [];
global.UrlFetchApp = { fetch: (url, opts) => {
  if (url.indexOf('sendMessage') > -1 || url.indexOf('setWebhook') > -1 || url.indexOf('deleteWebhook') > -1) {
    SENT.push({ url: url, body: opts && opts.payload });
    return { getContentText: () => JSON.stringify({ ok: true, result: true }) };
  }
  return { getContentText: () => '{}' };
} };
global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent: function () { return this._t; } })
};
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) }), deleteTrigger: () => {} };

/* ---------------- Fake Drive (lampiran) ---------------- */
const DRIVE_FILES = [];
class FakeFile {
  constructor(blob) { this.blob = blob; this.id = 'FILE-' + (DRIVE_FILES.length + 1); }
  getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
  getId() { return this.id; }
  setSharing() { this.dibagikan = true; return this; }
}
class FakeFolder {
  constructor(nama) { this.nama = nama; this.berkas = []; }
  createFile(blob) { const f = new FakeFile(blob); this.berkas.push(f); DRIVE_FILES.push(f); return f; }
}
const FOLDERS = [];
global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW' },
  getFoldersByName: (nama) => {
    const cocok = FOLDERS.filter(f => f.nama === nama);
    return { hasNext: () => cocok.length > 0, next: () => cocok[0] };
  },
  createFolder: (nama) => { const f = new FakeFolder(nama); FOLDERS.push(f); return f; }
};
global.Utilities.base64Encode = (s) => Buffer.from(String(s), 'binary').toString('base64');
global.Utilities.base64Decode = (s) => Buffer.from(String(s), 'base64');
global.Utilities.newBlob = (bytes, mime, nama) => ({ bytes: bytes, mime: mime, nama: nama });

/* ---------------- Jalankan Code.gs ---------------- */
const ctx = {};
const wrapper = new Function('exports', src + `
  exports.setup = setup; exports.catatTransaksi_ = catatTransaksi_; exports.ringkasan_ = ringkasan_;
  exports.bayarHutang_ = bayarHutang_; exports.tambahHutang_ = tambahHutang_; exports.batalkan_ = batalkan_;
  exports.setAnggaran_ = setAnggaran_; exports.parseNominal_ = parseNominal_; exports.normalKategori_ = normalKategori_;
  exports.api_ = api_; exports.doGet = doGet; exports.doPost = doPost; exports.prosesTelegram_ = prosesTelegram_;
  exports.ubahTransaksi_ = ubahTransaksi_; exports.cariTransaksi_ = cariTransaksi_; exports.aktifkan_ = aktifkan_;
  exports.tanggalStr_ = tanggalStr_; exports.bulanDari_ = bulanDari_;
  exports.tambahSumber_ = tambahSumber_; exports.ubahSumber_ = ubahSumber_; exports.hapusSumber_ = hapusSumber_;
  exports.pendapatan_ = pendapatan_; exports.plotAnggaran_ = plotAnggaran_; exports.perBulan_ = perBulan_;
  exports.isTetap_ = isTetap_; exports.petaAnggaran_ = petaAnggaran_; exports.kelompokDari_ = kelompokDari_;
  exports.pesanSumber_ = pesanSumber_; exports.pesanPlot_ = pesanPlot_; exports.bacaSumberDana_ = bacaSumberDana_;
  exports.simpanLampiran_ = simpanLampiran_; exports.bacaLampiran_ = bacaLampiran_; exports.lampiranKeTeks_ = lampiranKeTeks_;
  exports.pesanRingkasan_ = pesanRingkasan_; exports.pesanAnggaran_ = pesanAnggaran_; exports.pesanGrafik_ = pesanGrafik_;
  exports.pesanHutang_ = pesanHutang_; exports.pesanBantuan_ = pesanBantuan_; exports.kirimTelegram_ = kirimTelegram_;
  exports.rupiah_ = rupiah_;
`);
wrapper(ctx);

/* ---------------- Asersi ---------------- */
let pass = 0, fail = 0;
function ok(kondisi, label, detail) {
  if (kondisi) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  →  ' + detail : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'dapat ' + JSON.stringify(a) + ', harap ' + JSON.stringify(b)); }

console.log('\n=== 1. Parser nominal gaya Indonesia ===');
const P = ctx.parseNominal_;
[['25rb', 25000], ['25 rb', 25000], ['50k', 50000], ['1,5jt', 1500000], ['1.5jt', 1500000],
 ['2jt', 2000000], ['1.500.000', 1500000], ['Rp 250.000', 250000], ['150000', 150000],
 ['75000', 75000], ['1juta', 1000000], ['300ribu', 300000], [15000, 15000]]
  .forEach(([inp, exp]) => eq(P(inp), exp, 'parseNominal_(' + JSON.stringify(inp) + ') = ' + exp));
ok(isNaN(P('abc')), 'parseNominal_("abc") => NaN');
ok(isNaN(P('')), 'parseNominal_("") => NaN');
eq(P('0'), 0, 'parseNominal_("0") = 0 (validasi nol di lapisan transaksi)');
let nolDitolak = false;
try { ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '0', kategori: 'makan' }); } catch (e) { nolDitolak = true; }
ok(nolDitolak, 'catatTransaksi_ menolak nominal 0');
let negDitolak = false;
try { ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '-5000', kategori: 'makan' }); } catch (e) { negDitolak = true; }
ok(negDitolak, 'catatTransaksi_ menolak nominal negatif');

console.log('\n=== 2. Normalisasi kategori ===');
eq(ctx.normalKategori_('bensin', 'keluar'), 'Transport', 'alias "bensin" -> Transport');
eq(ctx.normalKategori_('jajan', 'keluar'), 'Makan', 'alias "jajan" -> Makan');
eq(ctx.normalKategori_('listrik', 'keluar'), 'Tagihan', 'alias "listrik" -> Tagihan');
eq(ctx.normalKategori_('makan', 'keluar'), 'Makan', 'exact lowercase -> Makan');
eq(ctx.normalKategori_('Gaji', 'masuk'), 'Gaji', 'exact -> Gaji');
eq(ctx.normalKategori_('ngawur', 'keluar'), 'Lain-lain', 'tak dikenal -> Lain-lain');
eq(ctx.normalKategori_('', 'keluar'), 'Lain-lain', 'kosong -> Lain-lain');

console.log('\n=== 3. setup() membuat sheet & header ===');
const hasil = ctx.setup();
ok(FAKE.getSheetByName('Transaksi') !== null, 'sheet Transaksi dibuat');
ok(FAKE.getSheetByName('Hutang') !== null, 'sheet Hutang dibuat');
ok(FAKE.getSheetByName('Anggaran') !== null, 'sheet Anggaran dibuat');
ok(FAKE.getSheetByName('SumberDana') !== null, 'sheet SumberDana dibuat');
const shTx = FAKE.getSheetByName('Transaksi');
eq(shTx.getLastRow(), 1, 'Transaksi hanya berisi baris header');
eq(String(shTx.cell(1, 1)), 'ID', 'kolom 1 header = ID');
eq(String(shTx.cell(1, 5)), 'Jumlah', 'kolom 5 header = Jumlah');
eq(FAKE.getSheetByName('Anggaran').getLastRow(), 1, 'Anggaran sengaja kosong (plot disusun dari sumber dana)');
eq(FAKE.getSheetByName('SumberDana').getLastRow(), 1, 'SumberDana kosong menunggu diisi');
ok(String(hasil).indexOf('tambahsumber') > -1, 'pesan setup menuntun ke /tambahsumber');
const hdrRow = shTx.getRange(1, 1, 1, 10).getValues()[0];
ok(hdrRow.every(h => String(h).trim() !== ''), '10 kolom header lengkap: ' + hdrRow.join('|'));
const hdrSd = FAKE.getSheetByName('SumberDana').getRange(1, 1, 1, 8).getValues()[0];
eq(hdrSd.join('|'), 'ID|Nama|Jenis|Jumlah|Frekuensi|TanggalMulai|Status|Catatan', 'header SumberDana lengkap');
const hdrAng = FAKE.getSheetByName('Anggaran').getRange(1, 1, 1, 5).getValues()[0];
eq(hdrAng.join('|'), 'Kategori|Limit|Periode|Kelompok|Persen', 'header Anggaran lengkap');

console.log('\n=== 4. catatTransaksi_ : masuk & keluar ===');
const t1 = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '25000', kategori: 'makan', catatan: 'nasi goreng' });
eq(t1.ID, 'TX-0001', 'ID pertama = TX-0001');
eq(t1.Tipe, 'keluar', 'tipe = keluar');
eq(t1.Kategori, 'Makan', 'kategori ternormalisasi = Makan');
eq(t1.Jumlah, 25000, 'jumlah = 25000');
eq(t1.Akun, 'Tunai', 'akun default = Tunai');
eq(t1.Sumber, 'telegram', 'sumber default = telegram');
eq(t1.Status, 'aktif', 'status = aktif');

const t2 = ctx.catatTransaksi_({ tipe: 'masuk', jumlah: '8,5jt', kategori: 'gaji', akun: 'BCA' });
eq(t2.ID, 'TX-0002', 'ID kedua = TX-0002 (auto increment)');
eq(t2.Jumlah, 8500000, 'jumlah 8,5jt = 8500000');
eq(t2.Kategori, 'Gaji', 'kategori Gaji');

const t3 = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '60000', kategori: 'transport', sumber: 'web' });
eq(t3.Kategori, 'Transport', 'kategori Transport');
eq(t3.Sumber, 'web', 'sumber = web (dari dashboard)');

let ditolak = false;
try { ctx.catatTransaksi_({ tipe: 'keluar', jumlah: 'salah', kategori: 'makan' }); } catch (e) { ditolak = true; }
ok(ditolak, 'nominal tidak valid ditolak (throw)');

console.log('\n=== 5. ringkasan_ : agregasi & defisit ===');
const r = ctx.ringkasan_();
eq(r.pemasukan, 8500000, 'pemasukan = 8.500.000');
eq(r.pengeluaran, 85000, 'pengeluaran = 85.000 (25000 + 60000)');
eq(r.selisih, 8415000, 'selisih = 8.415.000');
eq(r.status, 'surplus', 'status = surplus');
eq(r.jumlahTransaksi, 3, 'jumlah transaksi = 3');
eq(r.perKategori['Makan'], 25000, 'agregat kategori Makan = 25.000');
eq(r.perKategori['Transport'], 60000, 'agregat kategori Transport = 60.000');
ok(Math.abs(r.rasioTabungan - 8415000 / 8500000) < 1e-9, 'rasio tabungan tepat (99%)');

// skenario defisit
ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '20jt', kategori: 'rumah', catatan: 'beli perabot' });
const rd = ctx.ringkasan_();
eq(rd.selisih, -11585000, 'defisit = -11.585.000');
eq(rd.status, 'defisit', 'status = defisit');
ok(ctx.pesanRingkasan_(rd).indexOf('Defisit') > -1, 'pesan laporan menandai Defisit');
ok(ctx.pesanRingkasan_(rd).indexOf('⚠️ Defisit') > -1, 'pesan laporan memakai ikon peringatan');
eq(rd.anggaran['Makan'], undefined, 'belum ada anggaran sebelum sumber dana didaftarkan');

// filter bulan lain harus kosong
const rLain = ctx.ringkasan_('2020-01');
eq(rLain.pemasukan, 0, 'bulan tanpa data => pemasukan 0');
eq(rLain.jumlahTransaksi, 0, 'bulan tanpa data => 0 transaksi');

console.log('\n=== 6. Setel satu pos anggaran (setAnggaran_) ===');
const sa = ctx.setAnggaran_('Makan', '2jt');
eq(sa.limit, 2000000, 'setAnggaran_ Makan 2jt -> 2000000');
eq(sa.baru, true, 'kategori Makan belum ada => dibuat baru');
eq(sa.kelompok, 'Kebutuhan', 'kelompok otomatis terisi Kebutuhan');
const sa1b = ctx.setAnggaran_('Makan', '2,5jt');
eq(sa1b.baru, false, 'set ulang Makan => diperbarui, bukan duplikat');
eq(sa1b.limit, 2500000, 'limit Makan diperbarui jadi 2.500.000');
const shAng = FAKE.getSheetByName('Anggaran');
const rows = shAng.getRange(2, 1, shAng.getLastRow() - 1, 5).getValues();
const makanRow = rows.filter(x => String(x[0]) === 'Makan');
eq(makanRow.length, 1, 'tidak ada duplikat baris Makan');
eq(Number(makanRow[0][1]), 2500000, 'nilai limit Makan di sheet = 2.500.000');
eq(String(makanRow[0][3]), 'Kebutuhan', 'kolom Kelompok terisi di sheet');
const sa2 = ctx.setAnggaran_('Olahraga', '300rb');
eq(sa2.baru, true, 'kategori bebas => ditambahkan apa adanya');
eq(sa2.kategori, 'Olahraga', 'nama kategori bebas dipertahankan');
const pesanAngKosong = ctx.pesanAnggaran_(ctx.ringkasan_());
ok(pesanAngKosong.indexOf('Makan') > -1, 'pesan anggaran memuat pos yang sudah disetel');
ok(pesanAngKosong.indexOf('KEBUTUHAN') > -1, 'pesan anggaran mengelompokkan pos');
ctx.setAnggaran_('Makan', '1,2jt');

console.log('\n=== 7. Hutang: tambah, bayar, lunas, validasi ===');
const h1 = ctx.tambahHutang_({ nama: 'Budi', pokok: '5jt', cicilan: '500rb', tempo: '2026-12-31' });
eq(h1.ID, 'HT-0001', 'ID hutang pertama = HT-0001');
eq(h1.Sisa, 5000000, 'sisa awal = pokok = 5.000.000');
eq(h1.Dibayar, 0, 'dibayar awal = 0');
eq(h1.Status, 'aktif', 'status aktif');
eq(h1.Cicilan, 500000, 'cicilan 500rb');
eq(ctx.ringkasan_().totalHutang, 5000000, 'totalHutang di ringkasan = 5.000.000');

const keluarSebelum = ctx.ringkasan_().pengeluaran;
const b1 = ctx.bayarHutang_('HT-0001', '1jt');
eq(b1.dibayar, 1000000, 'dibayar = 1.000.000');
eq(b1.sisa, 4000000, 'sisa = 4.000.000');
eq(b1.lunas, false, 'belum lunas');
const shH = FAKE.getSheetByName('Hutang');
const hRow = shH.getRange(2, 1, 1, 9).getValues()[0];
eq(Number(hRow[3]), 1000000, 'kolom Dibayar di sheet = 1.000.000');
eq(Number(hRow[4]), 4000000, 'kolom Sisa di sheet = 4.000.000');
const rAfter = ctx.ringkasan_();
eq(rAfter.pengeluaran - keluarSebelum, 1000000, 'pembayaran hutang tercatat sebagai pengeluaran 1.000.000');
const txBayar = rAfter.transaksi.filter(x => String(x.Catatan).indexOf('Bayar hutang Budi') > -1);
eq(txBayar.length, 1, 'transaksi pengeluaran kategori Cicilan terbentuk');
eq(txBayar[0].Kategori, 'Cicilan', 'kategori transaksi = Cicilan');

let over = false;
try { ctx.bayarHutang_('HT-0001', '99jt'); } catch (e) { over = /melebihi sisa/.test(e.message); }
ok(over, 'pembayaran melebihi sisa ditolak');

let tidakAda = false;
try { ctx.bayarHutang_('HT-9999', '10rb'); } catch (e) { tidakAda = /tidak ditemukan/.test(e.message); }
ok(tidakAda, 'ID hutang tidak dikenal ditolak');

const b2 = ctx.bayarHutang_('HT-0001', '4jt');
ok(b2.lunas && b2.sisa === 0, 'pelunasan penuh => sisa 0 & lunas');
eq(String(shH.cell(2, 8)), 'lunas', 'status di sheet berubah jadi "lunas"');
eq(ctx.ringkasan_().totalHutang, 0, 'totalHutang = 0 setelah lunas');

console.log('\n=== 8. Batalkan transaksi (soft delete) ===');
const rSebelum = ctx.ringkasan_();
const idBatal = ctx.batalkan_('TX-0001');
eq(idBatal, 'TX-0001', 'ID yang dibatalkan cocok');
const rSesudah = ctx.ringkasan_();
eq(rSesudah.pengeluaran, rSebelum.pengeluaran - 25000, 'transaksi 25.000 keluar dari agregat');
ok(rSesudah.transaksi.every(x => x.ID !== 'TX-0001'), 'transaksi batal tidak muncul di daftar');
const shTx2 = FAKE.getSheetByName('Transaksi');
eq(String(shTx2.cell(2, 9)), 'batal', 'status baris jadi "batal" (riwayat tetap ada)');
eq(shTx2.getLastRow(), rSesudah.jumlahTransaksi + 1 + 1, 'baris tetap tersimpan, bukan dihapus');
let batalGagal = false;
try { ctx.batalkan_('TX-9999'); } catch (e) { batalGagal = /tidak ditemukan/.test(e.message); }
ok(batalGagal, 'batal ID tidak dikenal ditolak');

console.log('\n=== 9. API dashboard (doGet) ===');
const g = ctx.doGet({ parameter: { action: 'ping', token: 'rahasia123' } });
eq(JSON.parse(g.getContent()).ok, true, 'ping ok dengan token benar');
const gBad = JSON.parse(ctx.doGet({ parameter: { action: 'dashboard', token: 'salah' } }).getContent());
eq(gBad.ok, false, 'token salah => ok:false');
eq(gBad.error, 'unauthorized', 'pesan error unauthorized');
const gDash = JSON.parse(ctx.doGet({ parameter: { action: 'dashboard', token: 'rahasia123' } }).getContent());
eq(gDash.ok, true, 'dashboard ok');
ok(Array.isArray(gDash.tren) && gDash.tren.length >= 1, 'tren array terisi (' + gDash.tren.length + ' bulan)');
ok(Array.isArray(gDash.transaksi), 'daftar transaksi ada');
ok(gDash.transaksi.length >= 3, 'transaksi terkirim ke dashboard: ' + gDash.transaksi.length);
ok(typeof gDash.selisih === 'number' && typeof gDash.pemasukan === 'number', 'angka KPI bertipe number');
const urutBenar = gDash.transaksi.every((x, i, a) => i === 0 || a[i - 1].tanggal >= x.tanggal);
ok(urutBenar, 'transaksi terurut terbaru lebih dulu');
ok(gDash.transaksi.every(x => typeof x.jumlah === 'number'), 'setiap transaksi punya jumlah numerik');
const gNoAct = JSON.parse(ctx.doGet({ parameter: { token: 'rahasia123' } }).getContent());
eq(gNoAct.ok, true, 'doGet tanpa action => info service');
eq(gNoAct.service, 'UANGKU API', 'nama service benar');

const gCatat = JSON.parse(ctx.doGet({ parameter: {
  action: 'catat', token: 'rahasia123', tipe: 'keluar', jumlah: '35rb',
  kategori: 'belanja', catatan: 'dari dashboard', tanggal: '' } }).getContent());
eq(gCatat.ok, true, 'aksi tulis "catat" dari dashboard berhasil');
eq(gCatat.data.Sumber, 'web', 'sumber tercatat = web');
eq(gCatat.data.Jumlah, 35000, 'jumlah tersimpan 35.000');

const gHutang = JSON.parse(ctx.doGet({ parameter: {
  action: 'tambahhutang', token: 'rahasia123', nama: 'Kredit Motor', pokok: '12jt', cicilan: '1jt' } }).getContent());
eq(gHutang.ok, true, 'tambah hutang dari dashboard ok');
const gBayar = JSON.parse(ctx.doGet({ parameter: {
  action: 'bayar', token: 'rahasia123', id: gHutang.data.ID, jumlah: '500rb' } }).getContent());
eq(gBayar.ok, true, 'bayar hutang dari dashboard ok');
eq(gBayar.data.sisa, 11500000, 'sisa hutang = 11.500.000');
const gSet = JSON.parse(ctx.doGet({ parameter: {
  action: 'setanggaran', token: 'rahasia123', kategori: 'Transport', jumlah: '750rb' } }).getContent());
eq(gSet.ok, true, 'set anggaran dari dashboard ok');
eq(gSet.data.limit, 750000, 'limit transport = 750.000');
const gUnknown = JSON.parse(ctx.doGet({ parameter: { action: 'ngawur', token: 'rahasia123' } }).getContent());
eq(gUnknown.ok, false, 'action tak dikenal => ok:false');

console.log('\n=== 10. Webhook Telegram (doPost) via router ===');
SENT.length = 0;
ctx.doPost({ postData: { contents: JSON.stringify({
  message: { chat: { id: 111 }, text: '/keluar 45rb makan bakso' } }) }, parameter: {} });
ok(SENT.length === 1, 'bot mengirim tepat 1 balasan');
ok(String(SENT[0].body).indexOf('KELUAR') > -1, 'balasan menyebut KELUAR');
ok(String(SENT[0].body).indexOf('Makan') > -1, 'balasan menyebut kategori Makan');
ok(String(SENT[0].body).indexOf('ID') > -1, 'balasan menyertakan ID transaksi');

SENT.length = 0;
ctx.doPost({ postData: { contents: JSON.stringify({
  message: { chat: { id: 999 }, text: '/lapor' } }) }, parameter: {} });
ok(String(SENT[0].body).indexOf('tidak diizinkan') > -1, 'chat tidak diizinkan ditolak');

// setelah bootstrap, chat 999 tetap ditolak
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 999 }, text: '/lapor' } });
ok(String(SENT[0].body).indexOf('tidak diizinkan') > -1, 'chat lain tetap ditolak setelah bootstrap');
eq(PROPS_STORE.ALLOWED_CHAT_IDS, '111', 'chat pertama otomatis terdaftar di ALLOWED_CHAT_IDS');

SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/lapor' } });
ok(String(SENT[0].body).indexOf('Laporan') > -1, '/lapor mengirim laporan');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/anggaran' } });
ok(String(SENT[0].body).indexOf('Anggaran') > -1, '/anggaran mengirim anggaran');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/grafik' } });
ok(String(SENT[0].body).indexOf('Tren') > -1, '/grafik mengirim tren');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/hutang' } });
ok(String(SENT[0].body).indexOf('Hutang') > -1, '/hutang mengirim daftar');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/start' } });
ok(String(SENT[0].body).indexOf('UANGKU') > -1, '/start mengirim bantuan');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/masuk' } });
ok(String(SENT[0].body).indexOf('Format') > -1, 'argumen kurang => pesan format');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/bayar' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/bayar tanpa argumen => pesan format');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/ngawur' } });
ok(String(SENT[0].body).indexOf('tidak dikenal') > -1, 'perintah tak dikenal ditangani');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/bayar HT-0001 99jt' } });
ok(String(SENT[0].body).indexOf('❌') > -1, 'error bisnis ditangkap dan dikirim ke user');
SENT.length = 0;
ctx.doPost({ postData: { contents: 'bukan json' }, parameter: {} });
ok(SENT.length === 0, 'payload rusak tidak membuat bot crash');

console.log('\n=== 11. Konsistensi angka laporan & API ===');
const rFinal = ctx.ringkasan_();
const apiFinal = JSON.parse(ctx.doGet({ parameter: { action: 'dashboard', token: 'rahasia123' } }).getContent());
eq(apiFinal.pemasukan, rFinal.pemasukan, 'pemasukan API == mesin ringkasan');
eq(apiFinal.pengeluaran, rFinal.pengeluaran, 'pengeluaran API == mesin ringkasan');
eq(apiFinal.selisih, rFinal.pemasukan - rFinal.pengeluaran, 'selisih API = pemasukan - pengeluaran');
eq(apiFinal.jumlahTransaksi, rFinal.jumlahTransaksi, 'jumlah transaksi API konsisten');
const jml = apiFinal.transaksi.reduce((a, x) => a + (x.tipe === 'masuk' ? x.jumlah : -x.jumlah), 0);
eq(jml, apiFinal.selisih, 'jumlah baris transaksi menjumlah tepat ke selisih');
const sumKat = Object.values(apiFinal.perKategori).reduce((a, b) => a + b, 0);
eq(sumKat, apiFinal.pengeluaran, 'total per kategori == total pengeluaran');
ok(apiFinal.rasioTabungan === apiFinal.selisih / apiFinal.pemasukan, 'rasio tabungan konsisten');
ok(ctx.pesanRingkasan_(rFinal).length > 50, 'pesan laporan terbentuk utuh');
ok(ctx.pesanBantuan_().indexOf('/setanggaran') > -1, 'bantuan mendokumentasikan /setanggaran');

console.log('\n=== 12. Edit transaksi (ubahTransaksi_) & pemulihan ===');
const tUbah = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '50rb', kategori: 'makan', catatan: 'awal', akun: 'Tunai' });
eq(tUbah.Kategori, 'Makan', 'transaksi uji dibuat');
const h1u = ctx.ubahTransaksi_(tUbah.ID, { jumlah: '75rb', kategori: 'transport', catatan: 'setelah edit', akun: 'GoPay' });
eq(h1u.ID, tUbah.ID, 'ID tetap sama setelah edit');
eq(h1u.sesudah.Jumlah, 75000, 'jumlah diperbarui jadi 75.000');
eq(h1u.sesudah.Kategori, 'Transport', 'kategori dinormalisasi ulang jadi Transport');
eq(h1u.sesudah.Catatan, 'setelah edit', 'catatan diperbarui');
eq(h1u.sesudah.Akun, 'GoPay', 'akun diperbarui');
eq(h1u.sesudah.Tipe, 'keluar', 'tipe tetap bila tidak dikirim');
eq(h1u.sebelum.Jumlah, 50000, 'nilai sebelum tercatat untuk audit');
const shTxE = FAKE.getSheetByName('Transaksi');
const rowE = ctx.cariTransaksi_(tUbah.ID).row;
eq(Number(rowE[4]), 75000, 'nilai di sheet ikut berubah');
eq(String(rowE[3]), 'Transport', 'kategori di sheet ikut berubah');
eq(String(rowE[5]), 'GoPay', 'akun di sheet ikut berubah');

// ubah sebagian saja (partial patch) tidak merusak kolom lain
const h2u = ctx.ubahTransaksi_(tUbah.ID, { catatan: 'hanya catatan' });
eq(h2u.sesudah.Catatan, 'hanya catatan', 'patch sebagian mengubah catatan');
eq(h2u.sesudah.Jumlah, 75000, 'kolom lain tidak ikut berubah');
eq(h2u.sesudah.Akun, 'GoPay', 'akun tetap dari nilai sebelumnya');

// ubah tipe -> kategori dinormalisasi ke daftar tipe baru
const tMasuk = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '10rb', kategori: 'makan' });
const h3u = ctx.ubahTransaksi_(tMasuk.ID, { tipe: 'masuk' });
eq(h3u.sesudah.Tipe, 'masuk', 'tipe berubah jadi masuk');
eq(h3u.sesudah.Kategori, 'Lain-lain', 'kategori "Makan" tidak valid untuk masuk -> Lain-lain');

// validasi
let ubahGagal = false;
try { ctx.ubahTransaksi_(tUbah.ID, { jumlah: 'ngawur' }); } catch (e) { ubahGagal = /tidak valid/.test(e.message); }
ok(ubahGagal, 'nominal tidak valid ditolak saat edit');
let ubahNol = false;
try { ctx.ubahTransaksi_(tUbah.ID, { jumlah: '0' }); } catch (e) { ubahNol = true; }
ok(ubahNol, 'nominal 0 ditolak saat edit');
let ubahHilang = false;
try { ctx.ubahTransaksi_('TX-9999', { jumlah: '1rb' }); } catch (e) { ubahHilang = /tidak ditemukan/.test(e.message); }
ok(ubahHilang, 'edit ID tidak dikenal ditolak');

// aktifkan kembali
const rBatalSebelum = ctx.ringkasan_();
ctx.batalkan_(tUbah.ID);
eq(ctx.ringkasan_().pengeluaran, rBatalSebelum.pengeluaran - 75000, 'transaksi batal keluar dari agregat');
const idAktif = ctx.aktifkan_(tUbah.ID);
eq(idAktif, tUbah.ID, 'aktifkan_ mengembalikan ID');
eq(ctx.ringkasan_().pengeluaran, rBatalSebelum.pengeluaran, 'agregat kembali setelah dipulihkan');
eq(String(FAKE.getSheetByName('Transaksi').cell(ctx.cariTransaksi_(tUbah.ID).idx + 2, 9)), 'aktif', 'status di sheet kembali "aktif"');

// API endpoint baru
const gUbah = JSON.parse(ctx.doGet({ parameter: { action: 'ubah', token: 'rahasia123', id: tUbah.ID, jumlah: '90rb' } }).getContent());
eq(gUbah.ok, true, 'API action=ubah berhasil');
eq(gUbah.data.sesudah.Jumlah, 90000, 'API ubah menerapkan nominal baru');
const gPulih = JSON.parse(ctx.doGet({ parameter: { action: 'batal', token: 'rahasia123', id: tUbah.ID } }).getContent());
eq(gPulih.ok, true, 'API action=batal berhasil');
const gAktif = JSON.parse(ctx.doGet({ parameter: { action: 'aktifkan', token: 'rahasia123', id: tUbah.ID } }).getContent());
eq(gAktif.ok, true, 'API action=aktifkan berhasil');
const gAktifBad = JSON.parse(ctx.doGet({ parameter: { action: 'aktifkan', token: 'rahasia123', id: 'TX-9999' } }).getContent());
eq(gAktifBad.ok, false, 'API aktifkan ID salah -> ok:false');

// router Telegram: /edit, /aktifkan
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/edit ' + tUbah.ID + ' jumlah 120rb' } });
ok(String(SENT[0].body).indexOf('diperbarui') > -1, '/edit mengonfirmasi perubahan');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/edit ' + tUbah.ID + ' jumlah' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/edit tanpa nilai -> pesan format');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/batal ' + tUbah.ID } });
ok(String(SENT[0].body).indexOf('dibatalkan') > -1, '/batal mengonfirmasi pembatalan');
ok(String(SENT[0].body).indexOf('/aktifkan') > -1, '/batal menyarankan cara memulihkan');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/aktifkan ' + tUbah.ID } });
ok(String(SENT[0].body).indexOf('diaktifkan kembali') > -1, '/aktifkan memulihkan transaksi');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/aktifkan' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/aktifkan tanpa ID -> pesan format');

// data transaksi yang dikirim ke dashboard menyertakan status
const dashFinal = JSON.parse(ctx.doGet({ parameter: { action: 'dashboard', token: 'rahasia123' } }).getContent());
ok(dashFinal.transaksi.every(x => x.status === 'aktif' || x.status === 'batal'), 'setiap transaksi punya status valid');
ok(dashFinal.transaksi.every(x => typeof x.akun === 'string' && x.akun.length > 0), 'setiap transaksi punya akun');
ok(dashFinal.transaksi.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.tanggal)), 'tanggal diformat YYYY-MM-DD');
ok(dashFinal.hutang.every(h => h.tempo === '' || /^\d{4}-\d{2}-\d{2}$/.test(h.tempo)), 'tempo hutang diformat YYYY-MM-DD (kosong bila belum diisi)');

console.log('\n=== 13. Sumber dana (gaji sebagai sumber utama) ===');
eq(ctx.isTetap_('tetap'), true, 'isTetap_("tetap") = true');
eq(ctx.isTetap_('tidak tetap'), false, 'isTetap_("tidak tetap") = false (bug pencocokan longgar)');
eq(ctx.isTetap_('TIDAK TETAP'), false, 'isTetap_("TIDAK TETAP") = false');
eq(ctx.isTetap_(''), false, 'isTetap_("") = false');

eq(ctx.bacaSumberDana_().length, 0, 'belum ada sumber dana setelah setup');
const p0 = ctx.pendapatan_({});
eq(p0.total, 0, 'pendapatan kosong = 0');
eq(p0.rincian.length, 0, 'rincian kosong');
ok(ctx.pesanSumber_().indexOf('Belum ada sumber dana') > -1, 'pesan sumber memandu saat kosong');

const sd1 = ctx.tambahSumber_({ nama: 'Gaji', jumlah: '8jt', jenis: 'tetap', frekuensi: 'bulanan' });
eq(sd1.ID, 'SD-0001', 'ID sumber pertama = SD-0001');
eq(sd1.Nama, 'Gaji', 'nama tersimpan');
eq(sd1.Jenis, 'tetap', 'jenis tetap');
eq(sd1.Jumlah, 8000000, 'jumlah 8jt = 8.000.000');
eq(sd1.Frekuensi, 'bulanan', 'frekuensi bulanan');
eq(sd1.Status, 'aktif', 'status aktif');

const sd2 = ctx.tambahSumber_({ nama: 'Usaha', jumlah: '500rb', jenis: 'tidak tetap', frekuensi: 'bulanan' });
eq(sd2.Jenis, 'tidak tetap', 'jenis tidak tetap tersimpan benar');
eq(sd2.ID, 'SD-0002', 'ID kedua = SD-0002');
const sd3 = ctx.tambahSumber_({ nama: 'Proyek', jumlah: '1jt', jenis: 'tidak tetap', frekuensi: 'tahunan' });
eq(sd3.ID, 'SD-0003', 'ID ketiga = SD-0003');

let sdGagal = false;
try { ctx.tambahSumber_({ nama: 'X', jumlah: 'ngawur' }); } catch (e) { sdGagal = /tidak valid/.test(e.message); }
ok(sdGagal, 'jumlah sumber tidak valid ditolak');

console.log('\n=== 14. Konversi frekuensi ke bulanan ===');
eq(ctx.perBulan_(1000000, 'bulanan'), 1000000, 'bulanan tetap');
eq(ctx.perBulan_(100000, 'harian'), 3000000, 'harian x30');
eq(Math.round(ctx.perBulan_(1000000, 'mingguan')), Math.round(1000000 * 52 / 12), 'mingguan x52/12');
eq(ctx.perBulan_(12000000, 'tahunan'), 1000000, 'tahunan /12');
eq(ctx.perBulan_(500000, 'ngawur'), 500000, 'frekuensi tak dikenal = bulanan');

const pt = ctx.pendapatan_({ tetap: true });
eq(pt.total, 8000000, 'pendapatan tetap = 8.000.000 (hanya Gaji)');
eq(pt.rincian.length, 1, 'rincian tetap hanya 1 sumber');
const ps = ctx.pendapatan_({});
eq(ps.total, 8000000 + 500000 + Math.round(1000000 / 12), 'pendapatan total mencakup tidak tetap');
eq(ps.rincian.length, 3, 'rincian total 3 sumber');

console.log('\n=== 15. Plot anggaran dari sumber dana ===');
let plotGagal = false;
try { ctx.plotAnggaran_({ dasar: 'tetap' }); } catch (e) { plotGagal = false; }
ok(!plotGagal, 'plot berhasil saat sumber tetap ada');

const plot = ctx.plotAnggaran_({ dasar: 'tetap', tulis: true });
eq(plot.dasar, 8000000, 'dasar plot = pendapatan tetap 8.000.000');
eq(plot.dasarTetap, true, 'penanda dasar tetap');
eq(plot.baris.length, 13, '13 pos anggaran terbentuk');
eq(plot.total, 8000000, 'total plot sama dengan dasar (pembulatan tidak bocor)');

// porsi 50/30/20
const sumG = g => plot.baris.filter(b => b[3] === g).reduce((a, b) => a + b[1], 0);
eq(sumG('Kebutuhan'), 4000000, 'kelompok Kebutuhan = 50% x 8jt = 4.000.000');
eq(sumG('Keinginan'), 2400000, 'kelompok Keinginan = 30% x 8jt = 2.400.000');
eq(sumG('Tabungan'), 1600000, 'kelompok Tabungan = 20% x 8jt = 1.600.000');
eq(sumG('Kebutuhan') + sumG('Keinginan') + sumG('Tabungan'), 8000000, 'jumlah tiga kelompok = dasar');

// Makan = 30/100 dari Kebutuhan
const bMakan = plot.baris.find(b => b[0] === 'Makan');
eq(bMakan[1], 1200000, 'Makan = 30% x 4jt = 1.200.000');
eq(bMakan[3], 'Kebutuhan', 'Makan masuk kelompok Kebutuhan');
eq(plot.baris.find(b => b[0] === 'Tabungan')[1], 800000, 'Tabungan = 50% x 1,6jt = 800.000');
eq(plot.baris.find(b => b[0] === 'Dana Darurat')[1], 320000, 'Dana Darurat = 20% x 1,6jt = 320.000');
eq(plot.baris.find(b => b[0] === 'Belanja')[1], 840000, 'Belanja = 35% x 2,4jt = 840.000');
eq(plot.baris.find(b => b[0] === 'Cicilan')[1], 400000, 'Cicilan = 10% x 4jt = 400.000');

// hasil tertulis ke sheet
const shAng2 = FAKE.getSheetByName('Anggaran');
eq(shAng2.getLastRow() - 1, 13, '13 baris anggaran tertulis di sheet');
const angRows = shAng2.getRange(2, 1, 13, 5).getValues();
ok(angRows.every(r => String(r[3]).length > 0), 'setiap baris punya kolom Kelompok');
ok(angRows.every(r => Number(r[4]) > 0), 'setiap baris punya kolom Persen');
eq(Number(angRows.reduce((a, r) => a + Number(r[1]), 0)), 8000000, 'jumlah limit di sheet = 8.000.000');

// dasar 'semua' memakai seluruh pendapatan
const plotSemua = ctx.plotAnggaran_({ dasar: 'semua' });
eq(plotSemua.dasar, ps.total, 'dasar "semua" = pendapatan total');
ok(plotSemua.dasar > plot.dasar, 'dasar semua lebih besar dari dasar tetap');

// plot ikut berubah saat gaji naik
ctx.ubahSumber_('SD-0001', { jumlah: '10jt' });
const plot2 = ctx.plotAnggaran_({ dasar: 'tetap' });
eq(plot2.dasar, 10000000, 'gaji naik -> dasar plot ikut naik');
eq(plot2.baris.find(b => b[0] === 'Makan')[1], 1500000, 'Makan menyesuaikan jadi 1.500.000');
ctx.ubahSumber_('SD-0001', { jumlah: '8jt' });

// nonaktif -> keluar dari dasar
ctx.ubahSumber_('SD-0002', { status: 'nonaktif' });
eq(ctx.pendapatan_({}).total, 8000000 + Math.round(1000000 / 12), 'sumber nonaktif keluar dari total');
eq(ctx.pendapatan_({ tetap: true }).total, 8000000, 'sumber nonaktif tidak memengaruhi dasar tetap');
ctx.ubahSumber_('SD-0002', { status: 'aktif' });

// tanpa sumber tetap -> error yang menjelaskan
ctx.ubahSumber_('SD-0001', { jenis: 'tidak tetap' });
let errPlot = '';
try { ctx.plotAnggaran_({ dasar: 'tetap' }); } catch (e) { errPlot = e.message; }
ok(/Belum ada sumber dana tetap/.test(errPlot), 'error jelas saat tidak ada sumber tetap: ' + errPlot.slice(0, 60));
ctx.ubahSumber_('SD-0001', { jenis: 'tetap' });

console.log('\n=== 16. Ringkasan membawa data sumber & plot ===');
const rSrc = ctx.ringkasan_();
eq(rSrc.pendapatanTetap, 8000000, 'ringkasan membawa pendapatanTetap');
eq(rSrc.pendapatanTotal, ps.total, 'ringkasan membawa pendapatanTotal');
eq(rSrc.dasarAnggaran, 8000000, 'dasarAnggaran = pendapatan tetap');
eq(rSrc.rincianSumber.length, 3, 'rincianSumber terisi');
ok(rSrc.petaAnggaran['Makan'] !== undefined, 'petaAnggaran memuat Makan');
eq(rSrc.petaAnggaran['Makan'].kelompok, 'Kebutuhan', 'petaAnggaran memuat kelompok');
eq(rSrc.petaAnggaran['Makan'].limit, 1200000, 'petaAnggaran memuat limit');
eq(rSrc.anggaran['Makan'], 1200000, 'peta anggaran lama tetap kompatibel');
ok(ctx.pesanAnggaran_(rSrc).indexOf('KEBUTUHAN') > -1, 'pesan anggaran menampilkan kelompok');
ok(ctx.pesanAnggaran_(rSrc).indexOf('Plot Anggaran') > -1, 'pesan anggaran berjudul Plot Anggaran');
ok(ctx.pesanSumber_().indexOf('Pendapatan tetap') > -1, 'pesan sumber menampilkan total pendapatan tetap');
ok(ctx.pesanPlot_(plot).indexOf('50%') > -1, 'pesan plot menampilkan porsi 50%');

console.log('\n=== 17. API & Telegram untuk sumber dana ===');
const gSumber = JSON.parse(ctx.doGet({ parameter: { action: 'sumber', token: 'rahasia123' } }).getContent());
eq(gSumber.ok, true, 'API action=sumber berhasil');
eq(gSumber.data.length, 3, 'API mengembalikan 3 sumber');
eq(gSumber.pendapatanTetap, 8000000, 'API mengembalikan pendapatan tetap');
const gTambah = JSON.parse(ctx.doGet({ parameter: { action: 'tambahsumber', token: 'rahasia123',
  nama: 'Freelance', jumlah: '2jt', jenis: 'tidak tetap', frekuensi: 'bulanan' } }).getContent());
eq(gTambah.ok, true, 'API tambah sumber berhasil');
eq(gTambah.data.ID, 'SD-0004', 'ID sumber baru = SD-0004');
const gUbahSd = JSON.parse(ctx.doGet({ parameter: { action: 'ubahsumber', token: 'rahasia123',
  id: 'SD-0004', jumlah: '3jt' } }).getContent());
eq(gUbahSd.ok, true, 'API ubah sumber berhasil');
eq(gUbahSd.data.Jumlah, 3000000, 'jumlah sumber diperbarui');
const gPlot = JSON.parse(ctx.doGet({ parameter: { action: 'plotanggaran', token: 'rahasia123',
  dasar: 'tetap', simpan: 'true' } }).getContent());
eq(gPlot.ok, true, 'API plotanggaran berhasil');
eq(gPlot.data.dasar, 8000000, 'API plot memakai dasar tetap');
eq(gPlot.data.baris.length, 13, 'API mengembalikan 13 baris plot');
const gHapusSd = JSON.parse(ctx.doGet({ parameter: { action: 'hapussumber', token: 'rahasia123', id: 'SD-0004' } }).getContent());
eq(gHapusSd.ok, true, 'API hapus sumber berhasil');
eq(ctx.bacaSumberDana_().length, 3, 'sumber kembali jadi 3 setelah dihapus');

SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/sumber' } });
ok(String(SENT[0].body).indexOf('Sumber Dana') > -1, '/sumber mengirim daftar');
ok(String(SENT[0].body).indexOf('SD-0001') > -1, '/sumber menampilkan ID');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/tambahsumber Gaji 8jt tetap bulanan' } });
ok(String(SENT[0].body).indexOf('ditambahkan') > -1, '/tambahsumber mengonfirmasi');
ok(String(SENT[0].body).indexOf('/plotanggaran') > -1, '/tambahsumber menyarankan langkah berikutnya');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/tambahsumber Gaji' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/tambahsumber tanpa jumlah -> pesan format');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/plotanggaran' } });
ok(String(SENT[0].body).indexOf('Plot Anggaran Tersusun') > -1, '/plotanggaran mengirim hasil');
ok(String(SENT[0].body).indexOf('Kebutuhan') > -1, '/plotanggaran menampilkan kelompok');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/ubahsumber SD-0001 jumlah 9jt' } });
ok(String(SENT[0].body).indexOf('diperbarui') > -1, '/ubahsumber mengonfirmasi');
ctx.ubahSumber_('SD-0001', { jumlah: '8jt' });
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/ubahsumber SD-0001' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/ubahsumber tanpa nilai -> pesan format');
SENT.length = 0;
ctx.prosesTelegram_({ message: { chat: { id: 111 }, text: '/hapussumber' } });
ok(String(SENT[0].body).indexOf('Format') > -1, '/hapussumber tanpa ID -> pesan format');

// konsistensi plot dengan ringkasan setelah semua perubahan
const rFinal2 = ctx.ringkasan_();
const sumKatPlot = Object.keys(rFinal2.anggaran).reduce((a, k) => a + rFinal2.anggaran[k], 0);
eq(sumKatPlot, rFinal2.pendapatanTetap, 'total anggaran == pendapatan tetap (dasar plot)');

console.log('\n=== 18. Lampiran transaksi (Google Drive) ===');
const PNG_KECIL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

eq(FOLDERS.length, 0, 'folder Drive belum dibuat sebelum ada lampiran');
const meta1 = ctx.simpanLampiran_(PNG_KECIL, 'struk makan.png', '');
ok(meta1 !== null, 'simpanLampiran_ mengembalikan metadata');
eq(meta1.nama, 'struk makan.png', 'nama berkas dipertahankan');
eq(meta1.mime, 'image/png', 'mime terbaca dari data URL');
ok(/^https:\/\/drive\.google\.com\/file\/d\/FILE-\d+\/view$/.test(meta1.url), 'URL Drive terbentuk: ' + meta1.url);
eq(meta1.id, 'FILE-1', 'ID berkas berurutan');
ok(meta1.ukuran > 0, 'ukuran berkas dihitung: ' + meta1.ukuran + ' bita');
eq(FOLDERS.length, 1, 'folder "UANGKU Lampiran" dibuat sekali');
eq(FOLDERS[0].nama, 'UANGKU Lampiran', 'nama folder benar');
eq(DRIVE_FILES.length, 1, 'satu berkas tersimpan di Drive');
eq(DRIVE_FILES[0].dibagikan, true, 'berkas dibagikan lewat tautan (bisa dibuka)');
eq(DRIVE_FILES[0].blob.mime, 'image/png', 'blob memakai mime yang benar');

// folder dipakai ulang, tidak dibuat lagi
const meta2 = ctx.simpanLampiran_(PNG_KECIL, 'nota listrik.pdf', '');
eq(FOLDERS.length, 1, 'folder tidak diduplikasi untuk lampiran kedua');
eq(DRIVE_FILES.length, 2, 'berkas kedua tersimpan');

// nama berbahaya dibersihkan
const meta3 = ctx.simpanLampiran_(PNG_KECIL, 'a/b\\c:d*e?f"g<h>i|j.png', '');
ok(meta3.nama.indexOf('/') === -1 && meta3.nama.indexOf('\\') === -1
   && meta3.nama.indexOf(':') === -1 && meta3.nama.indexOf('*') === -1,
   'karakter terlarang di nama berkas dibersihkan: ' + meta3.nama);

// validasi
let lampGagal = false;
try { ctx.simpanLampiran_('bukan-data-url', 'x.png', ''); } catch (e) { lampGagal = /tidak dikenali/.test(e.message); }
ok(lampGagal, 'data URL tidak valid ditolak');
eq(ctx.simpanLampiran_('', 'x.png', ''), null, 'data kosong -> null, bukan error');
const besar = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
let lampBesar = false;
try { ctx.simpanLampiran_(besar, 'besar.png', ''); } catch (e) { lampBesar = /terlalu besar/.test(e.message); }
ok(lampBesar, 'berkas melebihi 5 MB ditolak dengan pesan jelas');

// baca/tulis JSON kolom Lampiran
const teksLamp = ctx.lampiranKeTeks_(meta1);
ok(typeof teksLamp === 'string' && teksLamp.indexOf('FILE-1') > -1, 'lampiran disimpan sebagai JSON');
eq(ctx.bacaLampiran_(teksLamp).nama, 'struk makan.png', 'JSON dibaca kembali dengan benar');
eq(ctx.bacaLampiran_(''), null, 'kolom kosong -> null');
eq(ctx.bacaLampiran_('{rusak'), null, 'JSON rusak -> null (tidak melempar)');
eq(ctx.bacaLampiran_(meta1).id, 'FILE-1', 'objek langsung juga diterima');

// transaksi membawa lampiran
const tLamp = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '30rb', kategori: 'makan',
  catatan: 'dengan struk', lampiran: meta1 });
ok(String(tLamp.Lampiran).indexOf('FILE-1') > -1, 'kolom Lampiran terisi saat mencatat');
const barisLamp = ctx.cariTransaksi_(tLamp.ID).row;
ok(String(barisLamp[10]).indexOf('FILE-1') > -1, 'kolom ke-11 (Lampiran) ada di sheet');
const dashLamp = JSON.parse(ctx.doGet({ parameter: { action: 'dashboard', token: 'rahasia123' } }).getContent());
const txLamp = dashLamp.transaksi.find(x => x.id === tLamp.ID);
ok(txLamp.lampiran !== null && txLamp.lampiran !== undefined, 'API mengirim objek lampiran');
eq(txLamp.lampiran.url, meta1.url, 'URL lampiran ikut ke dashboard');
const txTanpa = dashLamp.transaksi.find(x => x.id !== tLamp.ID && x.lampiran === null);
ok(txTanpa !== undefined, 'transaksi tanpa lampiran -> null (bukan undefined)');

// hapus lampiran lewat edit
ctx.ubahTransaksi_(tLamp.ID, { lampiran: '' });
const barisKosong = ctx.cariTransaksi_(tLamp.ID).row;
eq(String(barisKosong[10]), '', 'lampiran bisa dikosongkan lewat edit');
// edit lain tidak menyentuh lampiran
ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '10rb', kategori: 'makan', lampiran: meta2 });
const tJaga = ctx.catatTransaksi_({ tipe: 'keluar', jumlah: '11rb', kategori: 'makan', lampiran: meta2 });
ctx.ubahTransaksi_(tJaga.ID, { catatan: 'ubah catatan saja' });
ok(String(ctx.cariTransaksi_(tJaga.ID).row[10]).indexOf('FILE-2') > -1,
  'edit tanpa field lampiran tidak menghapus lampiran');

// endpoint POST lampiran
const postLamp = JSON.parse(ctx.doPost({
  postData: { contents: JSON.stringify({ token: 'rahasia123', lampiran: PNG_KECIL, nama: 'dari-post.png', id: '' }) },
  parameter: {}
}).getContent());
eq(postLamp.ok, true, 'POST /lampiran berhasil');
eq(postLamp.data.nama, 'dari-post.png', 'nama berkas dari POST benar');
const postLampBad = JSON.parse(ctx.doPost({
  postData: { contents: JSON.stringify({ token: 'salah', lampiran: PNG_KECIL, nama: 'x.png' }) },
  parameter: {}
}).getContent());
eq(postLampBad.ok, false, 'POST lampiran dengan token salah ditolak');
eq(postLampBad.error, 'unauthorized', 'pesan unauthorized jelas');

console.log('\n============================================');
console.log('  HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
console.log('============================================\n');
process.exit(fail ? 1 : 0);
