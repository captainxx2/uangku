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

/* ---------------- Jalankan Code.gs ---------------- */
const ctx = {};
const wrapper = new Function('exports', src + `
  exports.setup = setup; exports.catatTransaksi_ = catatTransaksi_; exports.ringkasan_ = ringkasan_;
  exports.bayarHutang_ = bayarHutang_; exports.tambahHutang_ = tambahHutang_; exports.batalkan_ = batalkan_;
  exports.setAnggaran_ = setAnggaran_; exports.parseNominal_ = parseNominal_; exports.normalKategori_ = normalKategori_;
  exports.api_ = api_; exports.doGet = doGet; exports.doPost = doPost; exports.prosesTelegram_ = prosesTelegram_;
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
const shTx = FAKE.getSheetByName('Transaksi');
eq(shTx.getLastRow(), 1, 'Transaksi hanya berisi baris header');
eq(String(shTx.cell(1, 1)), 'ID', 'kolom 1 header = ID');
eq(String(shTx.cell(1, 5)), 'Jumlah', 'kolom 5 header = Jumlah');
ok(FAKE.getSheetByName('Anggaran').getLastRow() >= 11, '10 anggaran default terisi');
const hdrRow = shTx.getRange(1, 1, 1, 10).getValues()[0];
ok(hdrRow.every(h => String(h).trim() !== ''), '10 kolom header lengkap: ' + hdrRow.join('|'));

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
eq(rd.anggaran['Makan'], 1500000, 'anggaran default Makan = 1.500.000 tersambung');

// filter bulan lain harus kosong
const rLain = ctx.ringkasan_('2020-01');
eq(rLain.pemasukan, 0, 'bulan tanpa data => pemasukan 0');
eq(rLain.jumlahTransaksi, 0, 'bulan tanpa data => 0 transaksi');

console.log('\n=== 6. Anggaran vs realisasi ===');
const sa = ctx.setAnggaran_('Makan', '2jt');
eq(sa.limit, 2000000, 'setAnggaran_ Makan 2jt -> 2000000');
eq(sa.baru, false, 'kategori sudah ada => diperbarui, bukan baru');
const shAng = FAKE.getSheetByName('Anggaran');
const rows = shAng.getRange(2, 1, shAng.getLastRow() - 1, 2).getValues();
const makanRow = rows.filter(x => String(x[0]) === 'Makan');
eq(makanRow.length, 1, 'tidak ada duplikat baris Makan');
eq(Number(makanRow[0][1]), 2000000, 'nilai limit Makan di sheet = 2.000.000');
const sa2 = ctx.setAnggaran_('Olahraga', '300rb');
eq(sa2.baru, true, 'kategori baru => ditambahkan');
ok(ctx.pesanAnggaran_(ctx.ringkasan_()).indexOf('█') > -1, 'pesan anggaran menampilkan progress bar');

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

console.log('\n============================================');
console.log('  HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
console.log('============================================\n');
process.exit(fail ? 1 : 0);
