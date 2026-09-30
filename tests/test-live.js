/**
 * Uji integrasi LIVE: dashboard -> Apps Script API.
 * Membuktikan permintaan selalu GET + query string (tanpa preflight CORS),
 * dan data dari API benar-benar merender ke UI.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const URL_EXEC = 'https://script.google.com/macros/s/AKfycbTEST/exec';

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  →  ' + detail : '')); }
};
const eq = (a, b, label) => ok(a === b, label, 'dapat ' + JSON.stringify(a) + ', harap ' + JSON.stringify(b));

/* ---- muat skrip halaman lalu suntik fetch tiruan sebelum init ---- */
const body = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://example.github.io/keuangan/', virtualConsole: vc
});
const w = dom.window;

const PANGGILAN = [];
const PAYLOAD = {
  ok: true, bulan: '2026-09', namaBulan: 'September 2026',
  pemasukan: 12000000, pengeluaran: 7500000, selisih: 4500000, status: 'surplus',
  rasioTabungan: 0.375,
  perKategori: { Makan: 2500000, Transport: 1200000, Tagihan: 900000, Cicilan: 2900000 },
  anggaran: { Makan: 2000000, Transport: 1000000, Tagihan: 1000000, Cicilan: 3000000 },
  totalHutang: 9000000, jumlahTransaksi: 4,
  tren: [
    { bulan: '2026-07', masuk: 10000000, keluar: 9000000, selisih: 1000000 },
    { bulan: '2026-08', masuk: 11000000, keluar: 8000000, selisih: 3000000 },
    { bulan: '2026-09', masuk: 12000000, keluar: 7500000, selisih: 4500000 }
  ],
  transaksi: [
    { id: 'TX-0004', tanggal: '2026-09-28', tipe: 'masuk', kategori: 'Gaji', jumlah: 12000000, akun: 'BCA', catatan: 'gaji september', sumber: 'telegram' },
    { id: 'TX-0003', tanggal: '2026-09-27', tipe: 'keluar', kategori: 'Makan', jumlah: 2500000, akun: 'Tunai', catatan: 'bulan ini', sumber: 'telegram' },
    { id: 'TX-0002', tanggal: '2026-09-26', tipe: 'keluar', kategori: 'Cicilan', jumlah: 2900000, akun: 'BCA', catatan: 'Bayar hutang Budi (HT-0001)', sumber: 'web' },
    { id: 'TX-0001', tanggal: '2026-09-25', tipe: 'keluar', kategori: 'Tagihan', jumlah: 900000, akun: 'BCA', catatan: 'listrik & internet', sumber: 'telegram' }
  ],
  hutang: [
    { id: 'HT-0001', nama: 'Budi', pokok: 8000000, dibayar: 5000000, sisa: 3000000, cicilan: 1000000, tempo: '2026-12-31' },
    { id: 'HT-0002', nama: 'Kredit Motor', pokok: 24000000, dibayar: 18000000, sisa: 6000000, cicilan: 1000000, tempo: '2027-06-01' }
  ]
};

w.fetch = (url, opts) => {
  PANGGILAN.push({ url: url, opts: opts || {} });
  const u = new URL(url);
  const action = u.searchParams.get('action');
  if (action === 'ping') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, waktu: '2026-09-30T10:00:00Z' }) });
  if (action === 'catat') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { ID: 'TX-0005' } }) });
  if (action === 'batal') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: 'TX-0002' }) });
  if (action === 'bayar') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { id: 'HT-0001', nama: 'Budi', dibayar: 6000000, sisa: 2000000, lunas: false } }) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) });
};
w.localStorage.setItem('uangku.config.v1', JSON.stringify({ url: URL_EXEC, token: 'tok123' }));

// suntik elemen yang dibutuhkan skrip
const root = w.document.querySelector('#root');
root.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script>[\s\S]*?<\/script>/g, '');

try { w.eval(body); } catch (e) { console.log('EVAL ERROR: ' + e.message); process.exit(1); }

const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.trim() : null);

setTimeout(() => {
  try {
    console.log('\n=== A. Bentuk permintaan (bebas preflight CORS) ===');
    ok(PANGGILAN.length >= 1, 'dashboard memanggil API saat boot (' + PANGGILAN.length + ' panggilan)');
    const p0 = PANGGILAN[0];
    eq(p0.opts.method || 'GET', 'GET', 'method GET (bukan POST)');
    ok(!p0.opts.headers, 'tidak ada header Content-Type kustom (tidak memicu preflight)');
    ok(p0.url.indexOf(URL_EXEC + '?') === 0, 'URL memakai query string, bukan body');
    const u0 = new URL(p0.url);
    eq(u0.searchParams.get('action'), 'dashboard', 'action=dashboard');
    eq(u0.searchParams.get('token'), 'tok123', 'token ikut terkirim');
    eq(u0.searchParams.get('bulan'), '2026-09', 'parameter bulan terkirim');
    ok(!p0.opts.body, 'tidak ada request body');

    console.log('\n=== B. Status koneksi ===');
    eq(txt('#statusTxt'), 'terhubung', 'status chip = "terhubung"');
    eq($('#statusDot').className, 'dot on', 'indikator hijau');
    eq($('#banner').textContent.trim(), '', 'banner mode demo hilang');

    console.log('\n=== C. Data asli dari API merender ===');
    eq(txt('#lblBulan'), 'September 2026', 'label bulan dari API');
    eq(txt('#kMasuk'), 'Rp 12.000.000', 'KPI pemasukan dari API');
    eq(txt('#kKeluar'), 'Rp 7.500.000', 'KPI pengeluaran dari API');
    eq(txt('#kSelisih'), '+Rp 4.500.000', 'KPI selisih dari API');
    eq(txt('#kRasio'), '37.5%', 'rasio tabungan dari API');
    eq(txt('#kHutang'), 'Rp 9.000.000', 'total hutang dari API');
    eq(w.document.querySelectorAll('#chartTren .col').length, 3, '3 kolom tren dari API');
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, '4 baris transaksi dari API');
    eq(w.document.querySelectorAll('#listHutang .bar').length, 2, '2 hutang dari API');
    eq(w.document.querySelectorAll('#listKategori .bar').length, 4, '4 kategori dari API');
    ok($('#listTerakhir').textContent.indexOf('gaji september') > -1, 'transaksi terakhir tampil dengan catatan');
    ok($('#planBody').textContent.indexOf('Dana darurat') > -1, 'rencana memakai angka API');
    ok(/Rp 45\.000\.000/.test($('#planBody').textContent), 'dana darurat 6 x 7.500.000 = Rp 45.000.000');
    ok($('#planBody').textContent.indexOf('NaN') === -1, 'tidak ada NaN di rencana');

    console.log('\n=== D. Aksi tulis dari dashboard ===');
    PANGGILAN.length = 0;
    $('#qTipe').value = 'keluar';
    $('#qTipe').dispatchEvent(new w.Event('change'));
    $('#qJumlah').value = '35rb';
    $('#qKategori').value = 'Belanja';
    $('#qCatatan').value = 'uji simpan';
    $('#formQuick').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => {
      const tulis = PANGGILAN.filter(x => x.url.indexOf('action=catat') > -1);
      eq(tulis.length, 1, 'satu permintaan action=catat terkirim');
      const u = new URL(tulis[0].url);
      eq(u.searchParams.get('tipe'), 'keluar', 'tipe terkirim');
      eq(u.searchParams.get('jumlah'), '35000', 'nominal dinormalkan jadi 35000 sebelum dikirim');
      eq(u.searchParams.get('kategori'), 'Belanja', 'kategori terkirim');
      eq(u.searchParams.get('catatan'), 'uji simpan', 'catatan terkirim');
      ok(/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('tanggal')), 'tanggal terisi otomatis: ' + u.searchParams.get('tanggal'));
      eq(tulis[0].opts.method || 'GET', 'GET', 'aksi tulis juga lewat GET (bebas preflight)');
      eq($('#qJumlah').value, '', 'form dibersihkan setelah sukses');
      ok($('#toast').textContent.indexOf('Transaksi tersimpan') > -1, 'toast sukses muncul');

      console.log('\n=== E. Batalkan & bayar hutang ===');
      PANGGILAN.length = 0;
      const tombol = w.document.querySelector('[data-batal="TX-0002"]');
      ok(tombol !== null, 'tombol Batalkan tersedia pada baris transaksi');
      w.confirm = () => true;
      tombol.click();
      setTimeout(() => {
        const batal = PANGGILAN.filter(x => x.url.indexOf('action=batal') > -1);
        eq(batal.length, 1, 'permintaan action=batal terkirim');
        eq(new URL(batal[0].url).searchParams.get('id'), 'TX-0002', 'ID transaksi yang dibatalkan benar');

        PANGGILAN.length = 0;
        $('#bJumlah').value = '1jt';
        $('#formBayar').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
        setTimeout(() => {
          const bayar = PANGGILAN.filter(x => x.url.indexOf('action=bayar') > -1);
          eq(bayar.length, 1, 'permintaan action=bayar terkirim');
          const ub = new URL(bayar[0].url);
          eq(ub.searchParams.get('id'), 'HT-0001', 'ID hutang terkirim');
          eq(ub.searchParams.get('jumlah'), '1000000', 'nominal 1jt jadi 1000000');

          console.log('\n=== F. Ganti bulan & gagal koneksi ===');
          PANGGILAN.length = 0;
          $('#mBulan').value = '2026-07';
          $('#mOk').click();
          setTimeout(() => {
            eq(new URL(PANGGILAN[0].url).searchParams.get('bulan'), '2026-07', 'permintaan ulang memakai bulan terpilih');
            eq($('#modalBulan').classList.contains('on'), false, 'modal bulan tertutup');

            // simulasi server error
            w.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
            $('#btnRefresh').click();
            setTimeout(() => {
              ok($('#statusTxt').textContent.indexOf('gagal') > -1, 'status menandai gagal konek: ' + txt('#statusTxt'));
              ok($('#toast').textContent.indexOf('Gagal memuat data') > -1, 'toast error koneksi muncul');
              ok($('#banner').textContent.indexOf('Mode demo') > -1, 'fallback ke mode demo agar UI tidak blank');
              eq(errors.length, 0, 'tidak ada error JS sepanjang uji live', errors.join(' | '));

              console.log('\n============================================');
              console.log('  HASIL LIVE: ' + pass + ' lulus, ' + fail + ' gagal');
              console.log('============================================\n');
              process.exit(fail ? 1 : 0);
            }, 250);
          }, 250);
        }, 250);
      }, 250);
    }, 250);
  } catch (e) {
    console.log('ERROR UJI: ' + e.stack);
    process.exit(1);
  }
}, 400);
