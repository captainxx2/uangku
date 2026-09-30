/**
 * Uji render dashboard index.html di DOM sungguhan (jsdom):
 * mode demo, KPI, chart, tabel, tab, form, toast, dan util in-page.
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

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
    eq(txt('#kMasuk'), 'Rp 8.000.000', 'KPI pemasukan');
    eq(txt('#kKeluar'), 'Rp 4.950.000', 'KPI pengeluaran (jumlah kategori konsisten)');
    eq(txt('#kSelisih'), '+Rp 3.050.000', 'KPI selisih = masuk - keluar');
    eq(txt('#kSelLbl'), 'Surplus', 'label selisih = Surplus');
    eq(txt('#kRasio'), '38.1%', 'rasio tabungan 38.1%');
    eq($('#kRasio').className, 'val ok', 'rasio >= 20% ditandai hijau');
    eq(txt('#kHutang'), 'Rp 2.250.000', 'KPI total sisa hutang');
    eq(txt('#kHutangSub'), '2 hutang aktif', 'sub-label jumlah hutang aktif');

    console.log('\n=== C. Chart tren ===');
    const cols = w.document.querySelectorAll('#chartTren .col');
    eq(cols.length, 6, 'chart menampilkan 6 bulan');
    eq(w.document.querySelectorAll('#chartTren .bars i.m').length, 6, '6 batang pemasukan');
    eq(w.document.querySelectorAll('#chartTren .bars i.k').length, 6, '6 batang pengeluaran');
    const h1 = cols[0].querySelector('i.m').style.height;
    ok(/%$/.test(h1), 'tinggi batang memakai persentase: ' + h1);
    ok(cols[5].querySelector('.cap').textContent.trim().length > 0, 'label bulan terisi');

    console.log('\n=== D. Kategori & anggaran ===');
    eq(w.document.querySelectorAll('#listKategori .bar').length, 7, '7 baris kategori');
    eq(w.document.querySelectorAll('#listAnggaran .bar').length, 10, '10 baris anggaran');
    const katTxt = $('#listKategori').textContent;
    ok(katTxt.indexOf('Makan') > -1 && katTxt.indexOf('Rp 1.850.000') > -1, 'kategori terbesar (Makan) tampil dengan nominal');
    ok(katTxt.indexOf('123%') > -1 || katTxt.indexOf('% dari anggaran') > -1, 'persentase terhadap anggaran tampil');
    ok($('#listAnggaran').textContent.indexOf('TOTAL') > -1, 'baris TOTAL anggaran ada');
    ok($('#listAnggaran').textContent.indexOf('⛔ Lebih') > -1, 'kategori melebihi anggaran ditandai ⛔');

    console.log('\n=== E. Tabel transaksi ===');
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 6, '6 baris transaksi');
    ok($('#tblTx tbody').textContent.indexOf('TX-0009') > -1, 'ID transaksi tampil');
    ok(w.document.querySelectorAll('#tblTx tbody .tag.masuk').length === 2, '2 baris ditandai MASUK');
    ok(w.document.querySelectorAll('#tblTx tbody .tag.keluar').length === 4, '4 baris ditandai KELUAR');

    // filter tipe
    $('#filterTipe').value = 'masuk';
    $('#filterTipe').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 2, 'filter "masuk" menyisakan 2 baris');
    $('#filterTipe').value = 'keluar';
    $('#filterTipe').dispatchEvent(new w.Event('change'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 4, 'filter "keluar" menyisakan 4 baris');
    $('#filterTipe').value = '';
    $('#filterTipe').dispatchEvent(new w.Event('change'));

    // pencarian
    $('#cari').value = 'listrik';
    $('#cari').dispatchEvent(new w.Event('input'));
    eq(w.document.querySelectorAll('#tblTx tbody tr').length, 1, 'pencarian "listrik" menyisakan 1 baris');
    $('#cari').value = 'zzz-tidak-ada';
    $('#cari').dispatchEvent(new w.Event('input'));
    ok($('#tblTx tbody').textContent.indexOf('Tidak ada transaksi cocok') > -1, 'pencarian kosong menampilkan pesan kosong');
    $('#cari').value = '';
    $('#cari').dispatchEvent(new w.Event('input'));

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
    ok(/Rp 29\.700\.000/.test(plan), 'target dana darurat 6x pengeluaran = Rp 29.700.000');
    ok(plan.indexOf('NaN') === -1 && plan.indexOf('undefined') === -1, 'tidak ada NaN/undefined di halaman rencana');

    console.log('\n=== H. Navigasi tab ===');
    const navBtns = w.document.querySelectorAll('nav button');
    eq(navBtns.length, 5, '5 tab navigasi');
    navBtns[2].click();
    ok(!$('#tab-debt').classList.contains('hide'), 'tab Hutang terbuka');
    ok($('#tab-dash').classList.contains('hide'), 'tab Dashboard tertutup');
    ok(navBtns[2].classList.contains('active'), 'tab aktif ditandai');
    navBtns[4].click();
    ok(!$('#tab-plan').classList.contains('hide') && $('#tab-debt').classList.contains('hide'), 'tab Rencana menggantikan tab Hutang');
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

    console.log('\n=== J. Form & keamanan mode demo ===');
    $('#qJumlah').value = '25rb';
    $('#qTipe').value = 'keluar';
    $('#qTipe').dispatchEvent(new w.Event('change'));
    ok($('#qKategori').options.length === 10, 'kategori pengeluaran terisi 10 opsi');
    $('#qTipe').value = 'masuk';
    $('#qTipe').dispatchEvent(new w.Event('change'));
    eq($('#qKategori').options.length, 6, 'kategori pemasukan terisi 6 opsi');
    $('#formQuick').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => {
      eq($('#toast').style.display, 'block', 'toast muncul saat simpan di mode demo');
      ok($('#toast').textContent.indexOf('Mode demo') > -1, 'toast menjelaskan data tidak tersimpan di mode demo');
      ok($('#toast').className.indexOf('err') > -1, 'toast bergaya peringatan');
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
