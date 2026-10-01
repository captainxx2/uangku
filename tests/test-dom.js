/**
 * Uji render dashboard index.html di DOM sungguhan (jsdom):
 * mode demo, KPI, chart, tabel, tab, form, toast, dan util in-page.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('D:/My Project/01 Aplikasi Keuangan Online/index.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  →  ' + detail : '')); }
};
const eq = (a, b, label) => ok(a === b, label, 'dapat ' + JSON.stringify(a) + ', harap ' + JSON.stringify(b));

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.github.io/keuangan/',
  virtualConsole: vc
});
const w = dom.window;
const $ = s => w.document.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.trim() : null);

setTimeout(() => {
  try {
    console.log('\n=== A. Boot & mode demo ===');
    eq(errors.length, 0, 'tidak ada error JS saat boot', errors.join(' | '));
    eq(txt('#statusTxt'), 'mode demo', 'status chip = "mode demo"');
    eq($('#statusDot').className, 'dot demo', 'indikator status berkelas demo');
    ok($('#banner').textContent.indexOf('Mode demo') > -1, 'banner peringatan mode demo tampil');

    console.log('\n=== B. Kartu KPI ===');
    eq(txt('#kMasuk'), 'Rp 9.250.000', 'KPI pemasukan (gaji 8,5jt + usaha 750rb)');
    eq(txt('#kKeluar'), 'Rp 4.856.540', 'KPI pengeluaran (realisasi demo terhadap plot)');
    eq(txt('#kSelisih'), '+Rp 4.393.460', 'KPI selisih = masuk - keluar');
    eq(txt('#kSelLbl'), 'Surplus', 'label selisih = Surplus');
    eq(txt('#kRasio'), '47.5%', 'rasio tabungan 47.5%');
    eq($('#kRasio').className, 'val ok', 'rasio >= 20% ditandai hijau');
    eq(txt('#kHutang'), 'Rp 2.250.000', 'KPI total sisa hutang');
    ok(txt('#kHutangSub').indexOf('2 hutang aktif') > -1, 'sub-label jumlah hutang aktif');
    ok(txt('#kHutangSub').indexOf('cicilan') > -1, 'sub-label menyertakan cicilan per bulan');

    console.log('\n=== C. Chart tren ===');
    const cols = w.document.querySelectorAll('#chartTren .col');
    eq(cols.length, 6, 'chart menampilkan 6 bulan');
    eq(w.document.querySelectorAll('#chartTren .bars i.m').length, 6, '6 batang pemasukan');
    eq(w.document.querySelectorAll('#chartTren .bars i.k').length, 6, '6 batang pengeluaran');
    const h1 = cols[0].querySelector('i.m').style.height;
    ok(/%$/.test(h1), 'tinggi batang memakai persentase: ' + h1);

    console.log('\n=== C2. Sparkline di kartu KPI ===');
    ['#sparkMasuk','#sparkKeluar','#sparkSelisih'].forEach(s => {
      ok($(s) !== null, 'wadah sparkline ada: ' + s);
      ok($(s).querySelector('path.ln') !== null, 'garis sparkline tergambar: ' + s);
      ok($(s).querySelector('path.ar') !== null, 'area bergradien tergambar: ' + s);
      ok($(s).querySelector('circle') !== null, 'titik akhir tergambar: ' + s);
    });
    const dMasuk = $('#sparkMasuk').querySelector('path.ln').getAttribute('d');
    ok(/^M[\d.]+ [\d.]+ L/.test(dMasuk), 'path sparkline berformat benar: ' + dMasuk.slice(0, 34));
    ok(dMasuk.indexOf('NaN') === -1, 'path sparkline bebas NaN');
    const semuaHtml = $('#sparkMasuk').innerHTML + $('#sparkKeluar').innerHTML + $('#sparkSelisih').innerHTML;
    ok(['sm','sk','ss'].every(id => semuaHtml.indexOf('id="' + id + '"') > -1),
      'setiap sparkline punya id gradien unik (tidak bentrok)');
    ok(w.document.querySelectorAll('.reveal').length >= 6,
      'grid utama memakai reveal berjenjang: ' + w.document.querySelectorAll('.reveal').length + ' blok');
    ok(cols[5].querySelector('.cap').textContent.trim().length > 0, 'label bulan terisi');

    console.log('\n=== D. Kategori & plot anggaran ===');
    eq(w.document.querySelectorAll('#listKategori .donutlegend .it').length, 9, '9 kategori di legend donut');
    eq(w.document.querySelectorAll('#listKategori svg circle').length, 10, 'donut SVG: 1 cincin latar + 9 irisan');
    eq(w.document.querySelectorAll('#listAnggaran .bar').length, 13, '13 pos plot anggaran');
    const katTxt = $('#listKategori').textContent;
    ok(katTxt.indexOf('Makan') > -1, 'kategori Makan tampil di legend');
    ok(katTxt.indexOf('%') > -1, 'persentase kategori tampil');
    ok(katTxt.indexOf('Total') > -1, 'total ditampilkan di tengah donut');
    ok($('#listAnggaran').textContent.indexOf('TOTAL') > -1, 'baris TOTAL anggaran ada');
    ok($('#listAnggaran').textContent.indexOf('KEBUTUHAN') > -1, 'kelompok KEBUTUHAN tampil');
    ok($('#listAnggaran').textContent.indexOf('TABUNGAN') > -1, 'kelompok TABUNGAN tampil');
    ok($('#listAnggaran').textContent.indexOf('⛔ Lebih') > -1, 'pos melebihi anggaran ditandai ⛔');

    console.log('\n=== D2. Sumber dana (langkah 1) ===');
    eq(txt('#sTetap'), 'Rp 8.500.000', 'KPI pendapatan tetap hanya menghitung sumber tetap');
    eq(txt('#sTotal'), 'Rp 10.250.000', 'KPI total pendapatan mencakup tidak tetap');
    eq(txt('#sJumlah'), '3 dari 3', 'KPI jumlah sumber aktif');
    eq(txt('#sRealisasi'), 'Rp 9.250.000', 'KPI realisasi = pemasukan bulan berjalan');
    eq(w.document.querySelectorAll('#listSumber .bar').length, 3, '3 kartu sumber dana');
    const sumTxt = $('#listSumber').textContent;
    ok(sumTxt.indexOf('Gaji') > -1 && sumTxt.indexOf('SD-0001') > -1, 'sumber utama (Gaji) tampil dengan ID');
    ok(/tetap · Rp 8\.500\.000\/bulanan/.test(sumTxt.replace(/\s+/g,' ')), 'rincian jenis/nominal/frekuensi tampil');
    ok(sumTxt.indexOf('THR') > -1 && sumTxt.indexOf('/bulan') > -1, 'sumber tahunan ditampilkan per bulan');
    ok($('#sumberNext').textContent.indexOf('siap dijadikan dasar plot') > -1, 'panduan langkah berikutnya muncul');
    eq($('#btnKePlot').disabled, false, 'tombol ke plot aktif karena sudah ada sumber');

    // pratinjau sumber dana
    $('#sdNama').value = 'Freelance';
    $('#sdJumlah').value = '2jt';
    $('#sdJumlah').dispatchEvent(new w.Event('input'));
    ok($('#sdPreview').textContent.indexOf('Rp 2.000.000') > -1, 'pratinjau sumber menampilkan nominal per bulan');
    ok($('#sdPreview').textContent.indexOf('SUMBER TETAP') > -1, 'pratinjau menandai jenis sumber');
    $('#sdFrekuensi').value = 'tahunan';
    $('#sdFrekuensi').dispatchEvent(new w.Event('change'));
    ok($('#sdPreview').textContent.indexOf('Rp 166.667') > -1, 'pratinjau mengonversi tahunan ke bulanan: ' + $('#sdPreview').textContent.slice(0,80));
    $('#sdJumlah').value = 'abc';
    $('#sdJumlah').dispatchEvent(new w.Event('input'));
    ok($('#sdPreview').textContent.indexOf('belum dikenali') > -1, 'jumlah tak valid ditandai di pratinjau');
    $('#sdNama').value = ''; $('#sdJumlah').value = ''; $('#sdFrekuensi').value = 'bulanan';
    $('#sdFrekuensi').dispatchEvent(new w.Event('change'));

    console.log('\n=== D3. Plot anggaran (langkah 2) ===');
    eq($('#plotKosong').classList.contains('hide'), true, 'panel "belum ada sumber" tersembunyi');
    eq($('#plotIsi').classList.contains('hide'), false, 'panel plot tampil');
    eq(w.document.querySelectorAll('#plotRingkas .card').length, 5, '5 kartu ringkas plot (3 kelompok + total + sisa)');
    ok($('#plotRingkas').textContent.indexOf('Kebutuhan (50%)') > -1, 'kartu kelompok menyebut porsi 50%');
    ok($('#plotRingkas').textContent.indexOf('Rp 4.250.000') > -1, 'Kebutuhan = 50% x 8,5jt = Rp 4.250.000');
    ok($('#plotRingkas').textContent.indexOf('Rp 2.550.000') > -1, 'Keinginan = 30% x 8,5jt = Rp 2.550.000');
    ok($('#plotRingkas').textContent.indexOf('Rp 1.700.000') > -1, 'Tabungan = 20% x 8,5jt = Rp 1.700.000');
    ok($('#plotDasarInfo').textContent.indexOf('Rp 8.500.000') > -1, 'dasar terhitung = pendapatan tetap');
    ok($('#plotDasarInfo').textContent.indexOf('1 sumber tetap') > -1, 'dasar dihitung dari 1 sumber tetap saja');
    eq(w.document.querySelectorAll('#plotRincian .row').length, 3, 'rincian dasar menampilkan 3 sumber');
    ok($('#plotRincian').textContent.indexOf('tidak ikut dasar') > -1, 'sumber tidak tetap ditandai tidak ikut dasar');
    ok($('#plotRincian').textContent.indexOf('DASAR PLOT') > -1, 'baris DASAR PLOT ada');

    // ganti dasar ke semua -> angka berubah
    const totSebelum = $('#plotRingkas').textContent;
    $('#plotDasar').value = 'semua';
    $('#plotDasar').dispatchEvent(new w.Event('change'));
    ok($('#plotRingkas').textContent !== totSebelum, 'mengganti dasar menghitung ulang plot');
    ok($('#plotDasarInfo').textContent.indexOf('Rp 10.250.000') > -1, 'dasar "semua" = total pendapatan');
    ok($('#plotDasarInfo').textContent.indexOf('3 sumber aktif') > -1, 'dasar "semua" memakai 3 sumber');
    $('#plotDasar').value = 'tetap';
    $('#plotDasar').dispatchEvent(new w.Event('change'));

    console.log('\n=== E. Tabel transaksi ===');
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 6, '6 baris transaksi aktif (1 dibatalkan disembunyikan)');
    ok($('#tblTx tbody').textContent.indexOf('TX-0009') > -1, 'ID transaksi tampil');
    ok(w.document.querySelectorAll('#tblTx tbody .tag.masuk').length === 2, '2 baris ditandai MASUK');
    ok(w.document.querySelectorAll('#tblTx tbody .tag.keluar').length === 4, '4 baris ditandai KELUAR');
    ok($('#infoJumlah').textContent.indexOf('6 transaksi') > -1, 'ringkasan jumlah: ' + $('#infoJumlah').textContent);

    // filter tipe
    $('#filterTipe').value = 'masuk';
    $('#filterTipe').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 2, 'filter "masuk" menyisakan 2 baris');
    $('#filterTipe').value = 'keluar';
    $('#filterTipe').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, 'filter "keluar" menyisakan 4 baris');
    $('#filterTipe').value = '';
    $('#filterTipe').dispatchEvent(new w.Event('change'));

    // filter status -> transaksi batal muncul
    $('#filterStatus').value = 'batal';
    $('#filterStatus').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 1, 'filter "batal" menyisakan 1 baris');
    eq(w.document.querySelectorAll('#tblTx tbody .tag.batal').length, 1, 'baris batal ditandai BATAL');
    ok($('#tblTx tbody tr').className.indexOf('batal') > -1, 'baris batal diberi gaya coret');
    $('#filterStatus').value = '';
    $('#filterStatus').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 7, 'semua status -> 7 baris');
    $('#filterStatus').value = 'aktif';
    $('#filterStatus').dispatchEvent(new w.Event('change'));

    // filter akun
    eq($('#filterAkun').options.length, 3, 'filter akun berisi Semua + Tunai + BCA');
    $('#filterAkun').value = 'BCA';
    $('#filterAkun').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, 'filter akun BCA menyisakan 4 baris');
    $('#filterAkun').value = '';
    $('#filterAkun').dispatchEvent(new w.Event('change'));

    // pencarian
    $('#cari').value = 'listrik';
    $('#cari').dispatchEvent(new w.Event('input'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 1, 'pencarian "listrik" menyisakan 1 baris');
    $('#cari').value = 'zzz-tidak-ada';
    $('#cari').dispatchEvent(new w.Event('input'));
    ok($('#tblTx tbody').textContent.indexOf('Tidak ada transaksi cocok') > -1, 'pencarian kosong menampilkan pesan kosong');
    $('#cari').value = '';
    $('#cari').dispatchEvent(new w.Event('input'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 6, 'pencarian dibersihkan -> 6 baris');

    console.log('\n=== F. Hutang ===');
    eq(w.document.querySelectorAll('#listHutang .bar').length, 2, '2 kartu hutang');
    const hTxt = $('#listHutang').textContent;
    ok(hTxt.indexOf('Budi') > -1 && hTxt.indexOf('Rp 1.500.000') > -1, 'hutang Budi dengan sisa tampil');
    ok(/% lunas/.test(hTxt), 'persentase pelunasan tampil');
    ok(/bulan lagi/.test(hTxt), 'estimasi sisa bulan cicilan tampil');
    ok($('#bId').options.length === 2, 'dropdown pembayaran berisi 2 hutang');
    ok($('#bId').textContent.indexOf('sisa Rp') > -1, 'opsi dropdown menyertakan sisa hutang');

    console.log('\n=== G. Rencana keuangan ===');
    const plan = $('#planBody').textContent;
    ok(w.document.querySelectorAll('#planBody .card').length >= 3, 'kartu rencana terbentuk');
    ok(plan.indexOf('50 / 30 / 20') > -1, 'blok alokasi 50/30/20 ada');
    ok(plan.indexOf('Dana darurat') > -1, 'saran dana darurat ada');
    ok(plan.indexOf('Langkah Berikutnya') > -1, 'daftar langkah berikutnya ada');
    ok(plan.indexOf('Keuangan sehat') > -1, 'status sehat terdeteksi (surplus 38%)');
    ok(plan.indexOf('debt snowball') > -1 || plan.indexOf('avalanche') > -1, 'strategi pelunasan hutang disarankan');
    ok(/Rp 29\.139\.240/.test(plan), 'target dana darurat 6x pengeluaran = Rp 29.139.240');
    ok(plan.indexOf('NaN') === -1 && plan.indexOf('undefined') === -1, 'tidak ada NaN/undefined di halaman rencana');

    console.log('\n=== H. Navigasi tab ===');
    const navBtns = w.document.querySelectorAll('nav button');
    eq(navBtns.length, 6, '6 tab navigasi (Dashboard, Sumber Dana, Plot, Transaksi, Hutang, Rencana)');
    navBtns[4].click();
    ok(!$('#tab-debt').classList.contains('hide'), 'tab Hutang terbuka');
    ok($('#tab-dash').classList.contains('hide'), 'tab Dashboard tertutup');
    ok(navBtns[4].classList.contains('active'), 'tab aktif ditandai');
    navBtns[5].click();
    ok(!$('#tab-plan').classList.contains('hide') && $('#tab-debt').classList.contains('hide'), 'tab Rencana menggantikan tab Hutang');
    navBtns[1].click();
    ok(!$('#tab-sumber').classList.contains('hide') && $('#tab-plan').classList.contains('hide'), 'tab Sumber Dana bisa dibuka');
    navBtns[2].click();
    ok(!$('#tab-budget').classList.contains('hide'), 'tab Plot Anggaran bisa dibuka');
    navBtns[0].click();
    ok(!$('#tab-dash').classList.contains('hide'), 'kembali ke Dashboard');

    console.log('\n=== I. Util in-page ===');
    eq(w.parseNominal('25rb'), 25000, 'parseNominal("25rb")');
    eq(w.parseNominal('1,5jt'), 1500000, 'parseNominal("1,5jt")');
    eq(w.parseNominal('1.500.000'), 1500000, 'parseNominal("1.500.000")');
    eq(w.rp(1500), 'Rp 1.500', 'rp() format Indonesia');
    eq(w.namaBulan('2026-03'), 'Maret 2026', 'namaBulan()');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(w.tglHariIni()), 'tglHariIni() format YYYY-MM-DD');
    eq(w.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;', 'esc() melindungi HTML');

    console.log('\n=== J. Form manual, pratinjau & keamanan mode demo ===');
    $('#mJumlah').value = '25rb';
    $('#mJumlah').dispatchEvent(new w.Event('input'));
    $('#mTipe').value = 'keluar';
    $('#mTipe').dispatchEvent(new w.Event('change'));
    eq($('#mKategori').options.length, 13, 'kategori pengeluaran terisi 13 opsi (termasuk Tabungan/Investasi/Dana Darurat)');
    ok($('#mPreview').textContent.indexOf('Rp 25.000') > -1, 'pratinjau manual menampilkan Rp 25.000');
    $('#mTipe').value = 'masuk';
    $('#mTipe').dispatchEvent(new w.Event('change'));
    eq($('#mKategori').options.length, 6, 'kategori pemasukan terisi 6 opsi');
    $('#mTipe').value = 'keluar';
    $('#mTipe').dispatchEvent(new w.Event('change'));
    $('#formManual').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => {
      eq($('#toast').style.display, 'block', 'toast muncul saat simpan di mode demo');
      ok($('#toast').textContent.indexOf('Mode demo') > -1, 'toast menjelaskan data tidak tersimpan di mode demo');
      ok($('#toast').className.indexOf('err') > -1, 'toast bergaya peringatan');

      console.log('\n=== K. Modal lihat/edit transaksi (mode demo) ===');
      const tEdit = w.document.querySelector('[data-edit]');
      ok(tEdit !== null, 'tombol Edit ada di tabel');
      tEdit.click();
      ok($('#modalTx').classList.contains('on'), 'modal detail terbuka di mode demo');
      ok($('#txIsi').querySelector('#eJumlah') !== null, 'form edit terisi dari data demo');
      ok($('#ePreview').textContent.indexOf('Sebelum') > -1, 'pratinjau sebelum/sesudah tampil');
      $('#txTutup').click();
      eq($('#modalTx').classList.contains('on'), false, 'modal tertutup lewat tombol Tutup');

      eq(errors.length, 0, 'tidak ada error JS sepanjang interaksi', errors.join(' | '));

      console.log('\n============================================');
      console.log('  HASIL DOM: ' + pass + ' lulus, ' + fail + ' gagal');
      console.log('============================================\n');
      process.exit(fail ? 1 : 0);
    }, 120);
  } catch (e) {
    console.log('ERROR UJI: ' + e.stack);
    process.exit(1);
  }
}, 300);
