/**
 * Uji integrasi LIVE: dashboard -> Apps Script API.
 * Membuktikan permintaan selalu GET + query string (tanpa preflight CORS),
 * dan data dari API benar-benar merender ke UI.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('D:/My Project/01 Aplikasi Keuangan Online/index.html', 'utf8');
const URL_EXEC = 'https://script.google.com/macros/s/AKfycbTEST/exec';

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  →  ' + detail : '')); }
};
const eq = (a, b, label) => ok(a === b, label, 'dapat ' + JSON.stringify(a) + ', harap ' + JSON.stringify(b));
const tunggu = (ms) => new Promise(r => setTimeout(r, ms || 80));

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
  pendapatanTetap: 12000000, pendapatanTotal: 13500000, dasarAnggaran: 12000000,
  cicilanHutang: 2900000,
  sumber: [
    { id: 'SD-0001', nama: 'Gaji', jenis: 'tetap', jumlah: 12000000, frekuensi: 'bulanan', mulai: '2026-01-01', status: 'aktif' },
    { id: 'SD-0002', nama: 'Usaha', jenis: 'tidak tetap', jumlah: 1500000, frekuensi: 'bulanan', mulai: '2026-02-01', status: 'aktif' }
  ],
  rincianSumber: [
    { ID: 'SD-0001', Nama: 'Gaji', Jenis: 'tetap', Frekuensi: 'bulanan', Jumlah: 12000000, perBulan: 12000000 },
    { ID: 'SD-0002', Nama: 'Usaha', Jenis: 'tidak tetap', Frekuensi: 'bulanan', Jumlah: 1500000, perBulan: 1500000 }
  ],
  tren: [
    { bulan: '2026-07', masuk: 10000000, keluar: 9000000, selisih: 1000000 },
    { bulan: '2026-08', masuk: 11000000, keluar: 8000000, selisih: 3000000 },
    { bulan: '2026-09', masuk: 12000000, keluar: 7500000, selisih: 4500000 }
  ],
  transaksi: [
    { id: 'TX-0005', tanggal: '2026-09-28', tipe: 'masuk', kategori: 'Gaji', jumlah: 12000000, akun: 'BCA', catatan: 'gaji september', sumber: 'telegram', status: 'aktif' },
    { id: 'TX-0004', tanggal: '2026-09-27', tipe: 'keluar', kategori: 'Makan', jumlah: 2500000, akun: 'Tunai', catatan: 'bulan ini', sumber: 'telegram', status: 'aktif' },
    { id: 'TX-0003', tanggal: '2026-09-26', tipe: 'keluar', kategori: 'Cicilan', jumlah: 2900000, akun: 'BCA', catatan: 'Bayar hutang Budi (HT-0001)', sumber: 'web', status: 'aktif' },
    { id: 'TX-0002', tanggal: '2026-09-25', tipe: 'keluar', kategori: 'Tagihan', jumlah: 900000, akun: 'BCA', catatan: 'listrik & internet', sumber: 'telegram', status: 'aktif' },
    { id: 'TX-0001', tanggal: '2026-09-20', tipe: 'keluar', kategori: 'Belanja', jumlah: 150000, akun: 'Tunai', catatan: 'salah catat', sumber: 'web', status: 'batal' }
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
  // api() membaca balasan lewat .text() lalu JSON.parse, jadi mock harus menyediakan keduanya.
  const balas = isi => {
    const teks = JSON.stringify(isi);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(teks),
      json: () => Promise.resolve(isi) });
  };
  if (action === 'ping') return balas({ ok: true, waktu: '2026-09-30T10:00:00Z' });
  if (action === 'catat') return balas({ ok: true, data: { ID: 'TX-0005' } });
  if (action === 'ubah') return balas({ ok: true, data: { ID: 'TX-0003' } });
  if (action === 'batal') return balas({ ok: true, data: 'TX-0002' });
  if (action === 'aktifkan') return balas({ ok: true, data: 'TX-0001' });
  if (action === 'bayar') return balas({ ok: true, data: { id: 'HT-0001', nama: 'Budi', dibayar: 6000000, sisa: 2000000, lunas: false } });
  if (action === 'tambahsumber') return balas({ ok: true, data: { ID: 'SD-0003' } });
  if (action === 'ubahsumber') return balas({ ok: true, data: { ID: 'SD-0001' } });
  if (action === 'hapussumber') return balas({ ok: true, data: 'SD-0001' });
  if (action === 'plotanggaran') return balas({ ok: true, data: { dasar: 12000000, baris: [] } });
  return balas(PAYLOAD);
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
    const b0 = u0.searchParams.get('bulan') || '';
    ok(b0.length === 7 && b0.charAt(4) === '-', 'parameter bulan terkirim: ' + b0);
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
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, '4 baris transaksi aktif dari API');
    eq(w.document.querySelectorAll('#listHutang .bar').length, 2, '2 hutang dari API');
    eq(w.document.querySelectorAll('#listKategori .donutlegend .it').length, 4, '4 kategori di donut dari API');
  eq(w.document.querySelectorAll('#listKategori svg circle').length, 5, 'donut SVG dari API: 1 cincin + 4 irisan');
    ok($('#listTerakhir').textContent.indexOf('gaji september') > -1, 'transaksi terakhir tampil dengan catatan');
    ok($('#planBody').textContent.indexOf('Dana darurat') > -1, 'rencana memakai angka API');
    ok(/Rp 45\.000\.000/.test($('#planBody').textContent), 'dana darurat 6 x 7.500.000 = Rp 45.000.000');
    ok($('#planBody').textContent.indexOf('NaN') === -1, 'tidak ada NaN di rencana');
    eq($('#filterAkun').options.length, 3, 'daftar akun dibangun dari data: Semua + BCA + Tunai');
    eq(w.document.querySelectorAll('#listSumber .bar').length, 2, '2 sumber dana dari API');
    eq(txt('#sTetap'), 'Rp 12.000.000', 'pendapatan tetap dari API');
    eq(txt('#sTotal'), 'Rp 13.500.000', 'total pendapatan dari API (gaji 12jt + usaha 1,5jt)');
    ok($('#plotDasarInfo').textContent.indexOf('1 sumber tetap') > -1, 'hanya 1 sumber tetap yang jadi dasar');
    eq(w.document.querySelectorAll('#listAnggaran .bar').length, 13, 'plot dihitung dari sumber dana API');

    console.log('\n=== D. Aksi tulis dari dashboard ===');
    PANGGILAN.length = 0;
    $('#mTipe').value = 'keluar';
    $('#mTipe').dispatchEvent(new w.Event('change'));
    $('#mJumlah').value = '35rb';
    $('#mJumlah').dispatchEvent(new w.Event('input'));
    $('#mKategori').value = 'Belanja';
    $('#mCatatan').value = 'uji simpan';
    $('#formManual').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
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
      eq($('#mJumlah').value, '', 'form dibersihkan setelah sukses');
      ok($('#toast').textContent.indexOf('Transaksi tersimpan') > -1, 'toast sukses muncul');

      console.log('\n=== E. Lihat / edit / batalkan lewat modal ===');
      const tombolEdit = w.document.querySelector('[data-edit="TX-0003"]');
      ok(tombolEdit !== null, 'tombol Edit tersedia pada baris transaksi');
      tombolEdit.click();
      ok($('#modalTx').classList.contains('on'), 'modal detail terbuka');
      eq($('#eJumlah').value, '2900000', 'form edit terisi nominal saat ini');
      eq($('#eTanggal').value, '2026-09-26', 'form edit terisi tanggal');
      eq($('#eKategori').value, 'Cicilan', 'form edit terisi kategori');
      ok($('#ePreview').textContent.indexOf('Sebelum') > -1, 'pratinjau sebelum/sesudah tampil');
      ok($('#ePreview').textContent.indexOf('Belum ada perubahan') > -1, 'pratinjau menandai belum ada perubahan');

      $('#eJumlah').value = '2,5jt';
      $('#eJumlah').dispatchEvent(new w.Event('input', { bubbles: true }));
      ok($('#ePreview').textContent.indexOf('Rp 2.500.000') > -1, 'pratinjau menampilkan nominal baru');
      ok($('#ePreview').textContent.indexOf('Ada perubahan belum disimpan') > -1, 'pratinjau menandai ada perubahan');

      PANGGILAN.length = 0;
      $('#txSimpan').click();
      setTimeout(() => {
        const ubah = PANGGILAN.filter(x => x.url.indexOf('action=ubah') > -1);
        eq(ubah.length, 1, 'permintaan action=ubah terkirim');
        const uu = new URL(ubah[0].url);
        eq(uu.searchParams.get('id'), 'TX-0003', 'ID yang diedit benar');
        eq(uu.searchParams.get('jumlah'), '2500000', 'nominal "2,5jt" jadi 2500000');
        eq(uu.searchParams.get('kategori'), 'Cicilan', 'kategori ikut terkirim');
        eq(uu.searchParams.get('akun'), 'BCA', 'akun ikut terkirim');
        eq(uu.searchParams.get('tanggal'), '2026-09-26', 'tanggal ikut terkirim');
        eq($('#modalTx').classList.contains('on'), false, 'modal tertutup setelah simpan');

        // batalkan lewat modal (tombol Lihat)
        PANGGILAN.length = 0;
        w.confirm = () => true;
        w.document.querySelector('[data-lihat="TX-0002"]').click();
        ok($('#modalTx').classList.contains('on'), 'modal terbuka lewat tombol Lihat');
        $('#txBatal').click();
        setTimeout(() => {
          const batal = PANGGILAN.filter(x => x.url.indexOf('action=batal') > -1);
          eq(batal.length, 1, 'permintaan action=batal terkirim dari modal');
          eq(new URL(batal[0].url).searchParams.get('id'), 'TX-0002', 'ID yang dibatalkan benar');

          // pulihkan transaksi batal (TX-0001)
          PANGGILAN.length = 0;
          w.document.querySelector('[data-edit="TX-0001"]');
          $('#filterStatus').value = 'batal';
          $('#filterStatus').dispatchEvent(new w.Event('change'));
          const rowBatal = w.document.querySelector('#tblTx tbody tr.batal');
          ok(rowBatal !== null, 'baris transaksi batal terlihat setelah filter status');
          rowBatal.click();
          ok($('#txPulihkan').classList.contains('hide') === false, 'tombol Pulihkan muncul untuk transaksi batal');
          ok($('#txSimpan').classList.contains('hide'), 'tombol Simpan disembunyikan untuk transaksi batal');
          $('#txPulihkan').click();
          setTimeout(() => {
            const pulih = PANGGILAN.filter(x => x.url.indexOf('action=aktifkan') > -1);
            eq(pulih.length, 1, 'permintaan action=aktifkan terkirim');
            eq(new URL(pulih[0].url).searchParams.get('id'), 'TX-0001', 'ID yang dipulihkan benar');
            $('#filterStatus').value = 'aktif';
            $('#filterStatus').dispatchEvent(new w.Event('change'));

          console.log('\n=== F. Form manual + pratinjau ===');
          PANGGILAN.length = 0;
          $('#mTipe').value = 'keluar';
          $('#mTipe').dispatchEvent(new w.Event('change'));
          $('#mJumlah').value = '75rb';
          $('#mJumlah').dispatchEvent(new w.Event('input'));
          $('#mKategori').value = 'Transport';
          $('#mKategori').dispatchEvent(new w.Event('change'));
          $('#mAkun').value = 'GoPay';
          $('#mAkun').dispatchEvent(new w.Event('input'));
          $('#mCatatan').value = 'ojek kantor';
          $('#mCatatan').dispatchEvent(new w.Event('input'));
          const pv = $('#mPreview').textContent;
          ok(pv.indexOf('Rp 75.000') > -1, 'pratinjau menampilkan nominal 75rb');
          ok(pv.indexOf('PENGELUARAN') > -1, 'pratinjau menandai jenis pengeluaran');
          ok(pv.indexOf('Transport') > -1, 'pratinjau menampilkan kategori');
          ok(pv.indexOf('GoPay') > -1, 'pratinjau menampilkan akun');
          ok(pv.indexOf('ojek kantor') > -1, 'pratinjau menampilkan catatan');
          const NAMA_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
          ok(NAMA_BULAN.some(n => pv.indexOf('bulan ' + n) > -1), 'pratinjau menyebut bulan tujuan laporan');

          $('#mJumlah').value = 'abc';
          $('#mJumlah').dispatchEvent(new w.Event('input'));
          ok($('#mPreview').textContent.indexOf('belum dikenali') > -1, 'nominal tak valid ditandai di pratinjau');
          $('#mJumlah').value = '75rb';
          $('#mJumlah').dispatchEvent(new w.Event('input'));

          $('#formManual').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
          setTimeout(() => {
            const manual = PANGGILAN.filter(x => x.url.indexOf('action=catat') > -1);
            eq(manual.length, 1, 'permintaan action=catat dari form manual terkirim');
            const um = new URL(manual[0].url);
            eq(um.searchParams.get('jumlah'), '75000', 'nominal manual 75000');
            eq(um.searchParams.get('akun'), 'GoPay', 'akun manual terkirim');
            eq(um.searchParams.get('catatan'), 'ojek kantor', 'catatan manual terkirim');

            console.log('\n=== G. Filter tabel ===');
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, 'awal: 4 baris');
            $('#filterStatus').value = 'batal';
            $('#filterStatus').dispatchEvent(new w.Event('change'));
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 1, 'filter status batal -> 1 baris');
            $('#filterStatus').value = '';
            $('#filterStatus').dispatchEvent(new w.Event('change'));
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 5, 'semua status -> 5 baris');
            $('#filterStatus').value = 'aktif';
            $('#filterStatus').dispatchEvent(new w.Event('change'));
            $('#filterAkun').value = 'BCA';
            $('#filterAkun').dispatchEvent(new w.Event('change'));
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 3, 'filter akun BCA -> 3 baris');
            $('#filterAkun').value = '';
            $('#filterAkun').dispatchEvent(new w.Event('change'));
            $('#dari').value = '2026-09-27';
            $('#dari').dispatchEvent(new w.Event('change'));
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 2, 'filter tanggal dari 27 Sep -> 2 baris');
            ok($('#infoJumlah').textContent.indexOf('transaksi') > -1, 'ringkasan jumlah tampil: ' + $('#infoJumlah').textContent);
            $('#btnResetFilter').click();
            eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, 'reset filter -> 4 baris');
            eq($('#dari').value, '', 'filter tanggal direset');

      console.log('\n=== H. Sumber dana & plot lewat API ===');
      PANGGILAN.length = 0;
      $('#sdNama').value = 'Freelance';
      $('#sdJumlah').value = '3jt';
      $('#sdJumlah').dispatchEvent(new w.Event('input'));
      $('#sdJenis').value = 'tetap';
      $('#sdFrekuensi').value = 'bulanan';
      $('#formSumber').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      setTimeout(() => {
        const tambah = PANGGILAN.filter(x => x.url.indexOf('action=tambahsumber') > -1);
        eq(tambah.length, 1, 'permintaan action=tambahsumber terkirim');
        const ut = new URL(tambah[0].url);
        eq(ut.searchParams.get('nama'), 'Freelance', 'nama sumber terkirim');
        eq(ut.searchParams.get('jumlah'), '3000000', 'nominal 3jt jadi 3000000');
        eq(ut.searchParams.get('jenis'), 'tetap', 'jenis terkirim');
        eq(ut.searchParams.get('frekuensi'), 'bulanan', 'frekuensi terkirim');
        eq(ut.searchParams.get('id'), null, 'tambah tidak mengirim id');
        eq(tambah[0].opts.method || 'GET', 'GET', 'aksi sumber juga lewat GET');
        eq($('#sdNama').value, '', 'form sumber dibersihkan setelah sukses');

        // susun ulang plot
        PANGGILAN.length = 0;
        $('#plotDasar').value = 'tetap';
        $('#btnPlotSimpan').click();
        setTimeout(() => {
          const plot = PANGGILAN.filter(x => x.url.indexOf('action=plotanggaran') > -1);
          eq(plot.length, 1, 'permintaan action=plotanggaran terkirim');
          const up = new URL(plot[0].url);
          eq(up.searchParams.get('dasar'), 'tetap', 'dasar terkirim');
          eq(up.searchParams.get('simpan'), 'true', 'penanda simpan terkirim');
          ok($('#toast').textContent.indexOf('Plot anggaran disusun') > -1, 'toast sukses plot muncul');

          // nonaktifkan sumber lewat tombol kartu
          PANGGILAN.length = 0;
          const tog = w.document.querySelector('[data-togglesumber]');
          ok(tog !== null, 'tombol Nonaktifkan tersedia di kartu sumber');
          tog.click();
          setTimeout(() => {
            const ubah = PANGGILAN.filter(x => x.url.indexOf('action=ubahsumber') > -1);
            eq(ubah.length, 1, 'permintaan action=ubahsumber terkirim');
            const uu2 = new URL(ubah[0].url);
            eq(uu2.searchParams.get('id'), 'SD-0001', 'ID sumber yang diubah benar');
            eq(uu2.searchParams.get('status'), 'nonaktif', 'status nonaktif terkirim');

            // hapus sumber
            PANGGILAN.length = 0;
            w.confirm = () => true;
            const hap = w.document.querySelector('[data-hapussumber]');
            ok(hap !== null, 'tombol Hapus tersedia di kartu sumber');
            hap.click();
            setTimeout(async () => {
              const del = PANGGILAN.filter(x => x.url.indexOf('action=hapussumber') > -1);
              eq(del.length, 1, 'permintaan action=hapussumber terkirim');
              eq(new URL(del[0].url).searchParams.get('id'), 'SD-0001', 'ID sumber yang dihapus benar');

              console.log('\n=== J. Diagnosa koneksi ===');
  ok(typeof w.diagnosaJaringan === 'function', 'fungsi diagnosaJaringan tersedia');
  const dDev = w.diagnosaJaringan('https://script.google.com/macros/s/AK1/dev', new Error('x'));
  ok(/\/dev/.test(dDev) && /\/exec/.test(dDev), 'URL /dev dideteksi dan disarankan /exec');
  const dSalah = w.diagnosaJaringan('https://example.com/api', new Error('x'));
  ok(/tidak dikenali|tidak berakhiran/.test(dSalah), 'URL bukan Apps Script ditolak: ' + dSalah.slice(0, 50));
  const dHttp = w.diagnosaJaringan('http://script.google.com/macros/s/AK1/exec', new Error('x'));
  ok(/https/.test(dHttp), 'URL non-https ditolak');
  const dJaringan = w.diagnosaJaringan(URL_EXEC, new Error('Failed to fetch'));
  ok(/Anyone/.test(dJaringan), 'kegagalan jaringan menyarankan cek akses Anyone');
  ok(/Failed to fetch/.test(dJaringan), 'pesan asli disertakan agar bisa dicari');
  ok(/login Google/.test(dJaringan), 'menyebut kemungkinan halaman login Google');

  // tombol Diagnosa mengisi panel
  $('#btnSet').click();
  $('#sUrl').value = 'https://script.google.com/macros/s/AK1/dev';
  $('#sToken').value = '';
  $('#sDiagnosaBtn').click();
  await tunggu(150);
  ok(!$('#sDiagnosa').classList.contains('hide'), 'panel diagnosa terbuka');
  const dg = $('#sDiagnosa').textContent;
  ok(dg.indexOf('Hasil diagnosa') > -1, 'panel menampilkan judul');
  ok(dg.indexOf('/dev') > -1, 'panel menandai masalah /dev');
  ok(dg.indexOf('❌') > -1, 'panel memakai penanda gagal');
  ok(dg.indexOf('API Token kosong') > -1, 'panel memeriksa token kosong');

  $('#sUrl').value = URL_EXEC;
  $('#sToken').value = 'tok123';
  $('#sDiagnosaBtn').click();
  await tunggu(200);
  const dg2 = $('#sDiagnosa').textContent;
  ok(dg2.indexOf('Bentuk URL benar') > -1, 'URL benar dikonfirmasi');
  ok(dg2.indexOf('Server terjangkau') > -1, 'jangkauan server dikonfirmasi');
  ok(dg2.indexOf('Balasan JSON valid') > -1, 'balasan JSON valid dikonfirmasi');
  ok(dg2.indexOf('API Token terisi') > -1, 'token terisi dikonfirmasi');
  $('#sClose').click();

  console.log('\n=== K. Ganti bulan & gagal koneksi ===');
              PANGGILAN.length = 0;
              $('#mBulan').value = '2026-07';
              $('#mOk').click();
              setTimeout(() => {
                eq(new URL(PANGGILAN[0].url).searchParams.get('bulan'), '2026-07', 'permintaan ulang memakai bulan terpilih');
                eq($('#modalBulan').classList.contains('on'), false, 'modal bulan tertutup');

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
                }, 300);
              }, 300);
            }, 300);
          }, 300);
        }, 300);
      }, 300);
    }, 300);
    }, 300);
    }, 300);
    }, 300);
    }, 300);
  } catch (e) {
    console.log('ERROR UJI: ' + e.stack);
    process.exit(1);
  }
}, 400);
