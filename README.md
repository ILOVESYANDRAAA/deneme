# sugarCAD

VS Code gibi **hafif, hızlı ve eklentilerle genişletilebilen** bir 3D CAD masaüstü uygulaması.

- **Hafif:** [Tauri](https://tauri.app) ile işletim sisteminin kendi web görünümünü kullanır;
  Electron'daki gibi tarayıcı paketlemez. Arayüz ~600 KB JS, geometri motoru ~540 KB WASM.
- **Hızlı:** Katı geometri [manifold](https://github.com/elalish/manifold) (WASM) ile ayrı bir
  iş parçacığında hesaplanır; arayüz donmaz. Bir parametre değişince sadece etkilenen dallar
  yeniden hesaplanır, 3D görünüm sadece bir şey değiştiğinde çizilir.
- **Eklenti destekli:** Herkes `sugarcad.json` + `index.js` ile kendi komutlarını ve
  parametrik şekillerini yazabilir. Her eklenti kendi iş parçacığında, ihtiyaç anında başlar.

## Özellikler

Modelleme akışı klasik CAD gibidir: **düzlem seç → 2D eskiz çiz → 3D'ye çevir**.

- **Eskiz:** XY (Üst), XZ (Ön) ya da YZ (Sağ) düzlemini 3D görünümde tıklayarak ya da düğmeden seçin
  - Araçlar: **Çizgi** (çoklu çizgi; ilk noktaya tıklayınca kapanır), **Dikdörtgen**, **Daire**
  - Izgaraya ve köşelere yapışma; yakınlaştırmaya göre 1-5-10 mm ızgara
  - Düzlem ofseti; eskiz sonradan düzenlenebilir ve bağlı katı anında güncellenir
- **Ekstrüzyon:** Eskizdeki kapalı şekilleri düzleme dik yönde çeker. İç içe şekiller delik açar; negatif mesafe ters yöne çeker.
- **Döndürme:** Profili eskizin dikey (V) ya da yatay (U) ekseni etrafında, istenen açıyla döndürür.
- **Boolean işlemleri:** Birleşim, Çıkarma, Kesişim (sonuç düzenlenebilir kalır)
- Parametrik özellik ağacı, konum / dönüş düzenleme, geri al / yinele
- Komut paleti (`Ctrl+Shift+P`) ve klavye kısayolları
- `.sugar` dosya biçimi (JSON) ile kaydet / aç, STL dışa aktarma
- Eklentiler kendi parametrik şekillerini ve komutlarını ekleyebilir (örnek: [`examples/plugins/gear`](examples/plugins/gear))

## Kısayollar

| Kısayol | Komut |
| --- | --- |
| `S` | Yeni eskiz (düzlem seç) |
| `L` / `R` / `C` | Eskizde: Çizgi / Dikdörtgen / Daire |
| `Enter` / çift tık | Çizgiyi açık bırakıp bitir |
| `Backspace` | Son noktayı geri al |
| `Esc` | Yarım şekli iptal et → aracı bırak → eskizden çık |
| `Ctrl+Enter` | Eskizi bitir |
| `E` / `Shift+R` | Ekstrüzyon / Döndürme |
| `Ctrl+Shift+P` / `F1` | Komut paleti |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | Yeni / Aç / Kaydet / Farklı kaydet |
| `Ctrl+E` | STL olarak dışa aktar |
| `Ctrl+Z` / `Ctrl+Y` | Geri al / Yinele |
| `Delete` / `Ctrl+D` / `Ctrl+A` | Sil / Çoğalt / Tümünü seç |
| `Ctrl+Shift+U` / `Ctrl+Shift+D` / `Ctrl+Shift+I` | Birleşim / Çıkarma / Kesişim (iki şekil seçiliyken) |
| `F` / çift tık | Görünüme sığdır |
| `0` `7` `1` `3` | İzometrik / Üst / Ön / Sağ görünüm |
| Sol tık sürükle / sağ tık sürükle / tekerlek | Döndür / Kaydır / Yakınlaştır (eskizde sol tık çizer) |
| `Ctrl`+tık | Çoklu seçim |

## Geliştirme

Gereksinimler: [Node.js](https://nodejs.org) 20+ ve masaüstü uygulaması için
[Rust](https://rustup.rs) + [Tauri ön koşulları](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # masaüstü uygulaması (sıcak yeniden yükleme ile)
npm run dev            # sadece tarayıcıda: http://localhost:5173
npm run tauri build    # kurulum dosyası üretir (src-tauri/target/release/bundle)
```

Testler:

```bash
npm test               # birim testleri (Vitest)
npm run test:e2e       # uçtan uca testler (Playwright, tarayıcıda)
npm run typecheck
cd src-tauri && cargo test
```

Her push'ta GitHub Actions testleri çalıştırır ve Windows, macOS ve Linux için kurulum
dosyalarını derleyip **Actions → ilgili çalıştırma → Artifacts** altına koyar.

### Otomatik güncelleme

`main` ve geliştirme dalına her push'ta (ve Actions'tan elle "Run workflow" ile) CI, `0.1.<çalıştırma no>` sürümüyle imzalı paketleri bir
GitHub **Release**'e yükler; üç platform da bitince release yayına alınır. Masaüstü uygulaması
açılışta (ve komut paletindeki **Güncellemeleri Denetle** ile) yeni sürümü görür, onayla indirip
kurar ve yeniden başlar. Bunun için:

- Repo **public** olmalı (uygulama `releases/latest/download/latest.json` adresini okur).
- Repo ayarlarında **TAURI_SIGNING_PRIVATE_KEY** secret'ı tanımlı olmalı (güncellemeleri imzalayan
  anahtar; açık anahtarı `src-tauri/tauri.conf.json` içinde). Secret yoksa CI sadece imzasız
  artifact üretir, release yayınlamaz.

## Proje yapısı

```
src/
  core/        Özellik ağacı, eskiz modeli, komutlar, katı tarifleri (DOM'dan bağımsız)
  geometry/    manifold-3d geometri işçisi, önbellek, STL
  plugins/     Eklenti sunucusu, manifest doğrulama, RPC, eklenti çalışma ortamı
  app/         Uygulama denetleyicisi (her şeyi birleştiren katman)
  ui/          Arayüz: 3D görünüm, eskiz aracı, ağaç, özellikler, komut paleti, eklentiler paneli
  platform/    Tauri ve tarayıcı için dosya/eklenti erişimi
src-tauri/     Rust kabuğu: dosya okuma/yazma, ~/.sugarcad/plugins taraması
plugins/       Uygulamaya gömülen eklentiler (şu an yok)
examples/      Örnek eklentiler (gear: parametrik dişli)
packages/api/  Eklenti yazarları için TypeScript tip tanımları
docs/          Eklenti yazma rehberi
tests/         Birim ve uçtan uca testler
```

## Eklenti yazmak

Bkz. **[docs/eklenti-yazma.md](docs/eklenti-yazma.md)**. Kısaca:

```js
// ~/.sugarcad/plugins/merhaba/index.js
exports.activate = (sugarcad) => {
  sugarcad.commands.register("merhaba.selam", () => sugarcad.ui.showMessage("Selam!"));
};
```

```json
// ~/.sugarcad/plugins/merhaba/sugarcad.json
{
  "name": "merhaba",
  "version": "1.0.0",
  "main": "index.js",
  "contributes": { "commands": [{ "id": "merhaba.selam", "title": "Selam Ver" }] }
}
```

## Yol haritası

- Katı yüzeyine eskiz çizme, eskizde yay ve ölçülendirme / kısıtlar
- Ekstrüzyonla doğrudan kesme (delik) ve "bir sonrakine kadar" seçenekleri
- Eklenti mağazası (indir / güncelle)
- STEP / 3MF içe ve dışa aktarma
