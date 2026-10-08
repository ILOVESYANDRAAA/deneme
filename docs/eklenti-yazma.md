# sugarCAD eklentisi yazma rehberi

sugarCAD eklentileri VS Code eklentilerine benzer: bir **manifest** (`sugarcad.json`) ne
sunduğunuzu bildirir, bir **JavaScript dosyası** (`index.js`) da `activate` fonksiyonunda
bunları hayata geçirir.

- Her eklenti **ayrı bir iş parçacığında (Web Worker)** çalışır. Eklentiniz takılsa ya da
  çökse bile uygulama donmaz; sorunlu eklenti "Hata" durumuna düşer.
- Eklentiler **ihtiyaç anında başlar**: komutunuz çalıştırılınca ya da şekliniz
  eklenince. Başlangıçta çalışması gerekiyorsa `"activationEvents": ["onStartup"]` ekleyin.
- Eklentiler DOM'a ve dosya sistemine erişemez; her şey `sugarcad` API'si üzerinden
  yapılır. Tam tip tanımı: [`packages/api/sugarcad.d.ts`](../packages/api/sugarcad.d.ts).

## 1. Klasör yapısı

```
~/.sugarcad/plugins/
  flans/
    sugarcad.json
    index.js
```

Masaüstü uygulamasında eklenti klasörü **Eklentiler** panelinin altında yazar
(Windows'ta `C:\Users\<siz>\.sugarcad\plugins`). Klasörü ekledikten sonra uygulamayı
yeniden başlatın.

## 2. Manifest: `sugarcad.json`

```json
{
  "name": "flans",
  "displayName": "Flanş Üretici",
  "version": "1.0.0",
  "description": "Delikli boru flanşı ekler.",
  "main": "index.js",
  "contributes": {
    "commands": [
      { "id": "flans.merhaba", "title": "Merhaba De", "keybinding": "Ctrl+Alt+M" }
    ],
    "primitives": [
      {
        "type": "flans.flans",
        "label": "Flanş",
        "params": {
          "cap": { "label": "Dış çap", "default": 80, "min": 10, "step": 5 },
          "kalinlik": { "label": "Kalınlık", "default": 8, "min": 1 },
          "delik": { "label": "Delik sayısı", "default": 4, "min": 0, "max": 24, "integer": true }
        }
      }
    ]
  }
}
```

| Alan | Açıklama |
| --- | --- |
| `name` | Benzersiz kimlik. Küçük harf, rakam ve tire. Komut kimlikleri ve şekil türleri `name.` ile başlamalı. |
| `main` | Eklenti kodunun bulunduğu dosya (eklenti klasörünün içinde olmalı). |
| `contributes.commands` | Komut paletinde (`Ctrl+Shift+P`) ve Eklentiler panelinde görünür. |
| `contributes.primitives` | Araç çubuğunda bir düğme ve özellik panelinde düzenlenebilir parametreler olarak görünür. `min`/`max`/`integer` sınırları uygulama tarafından uygulanır. |
| `activationEvents` | İsteğe bağlı. `"onStartup"` verilirse eklenti açılışta başlar. |

## 3. Kod: `index.js`

```js
exports.activate = function (sugarcad) {
  // Parametrik şekil: parametreler değiştikçe uygulama bu fonksiyonu yeniden çağırır.
  sugarcad.primitives.register("flans.flans", (p) => {
    const s = sugarcad.solids;
    const r = p.cap / 2;
    let govde = s.cylinder(r, p.kalinlik, 96);
    govde = s.subtract(govde, s.cylinder(r * 0.4, p.kalinlik, 64));
    for (let i = 0; i < p.delik; i++) {
      const a = (2 * Math.PI * i) / p.delik;
      const delik = s.translate(s.cylinder(r * 0.08, p.kalinlik, 24), [Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, 0]);
      govde = s.subtract(govde, delik);
    }
    return govde;
  });

  sugarcad.commands.register("flans.merhaba", async () => {
    const sekiller = await sugarcad.document.getFeatures();
    await sugarcad.ui.showMessage(`Çizimde ${sekiller.length} özellik var`);
  });
};
```

### Şekil tarifleri (`Solid`)

Şekil üreticiniz bir **tarif** döndürür; asıl 3D hesabı uygulamanın geometri motoru
(manifold) yapar. `sugarcad.solids` yardımcıları:

| Yardımcı | Sonuç |
| --- | --- |
| `box([x, y, z])` | XY'de ortalı, tabanı Z=0'da kutu |
| `cylinder(r, h, bölüm?)` | Tabanı Z=0'da silindir |
| `sphere(r, bölüm?)` | Merkezi orijinde küre |
| `extrude(çokgenler, h)` | 2D `[x, y]` çokgen(ler)i Z yönünde çeker. Delikler ters yönde (saat yönünde) çizilir. |
| `union(...)`, `subtract(a, ...)`, `intersect(...)` | Boolean işlemleri |
| `translate(s, [x, y, z])`, `rotate(s, [rx, ry, rz])` | Taşıma, derece cinsinden döndürme |

Tarif uygulamaya gönderilmeden önce doğrulanır (pozitif boyutlar, en az 3 noktalı
çokgenler vb.). Hatalı tarifte kullanıcıya açıklayıcı bir mesaj gösterilir.

### Belge ve arayüz

```js
const kutu = await sugarcad.document.addPrimitive("box", { width: 30, depth: 30, height: 10 });
const delik = await sugarcad.document.addPrimitive("cylinder", { radius: 5, height: 10 });
const sonuc = await sugarcad.document.boolean("subtract", kutu.id, delik.id);
await sugarcad.document.updateFeature(sonuc.id, { name: "Delikli plaka", position: [0, 0, 5] });

const girdi = await sugarcad.ui.showInput({
  title: "Plaka",
  fields: [{ name: "en", label: "En", type: "number", value: 30, min: 1 }],
});
if (girdi === null) return; // kullanıcı iptal etti

// Seçim listesi: `options` verilen alan bir liste olur ve seçilenin `value`'sunu (metin) döndürür.
const tur = await sugarcad.ui.showInput({
  title: "Malzeme",
  fields: [{ name: "malzeme", label: "Malzeme", options: [{ value: "celik", label: "Çelik" }, { value: "alu", label: "Alüminyum" }] }],
});
```

Her `document.*` çağrısı tek bir **geri alma** adımıdır; kullanıcı `Ctrl+Z` ile geri alabilir.

## 4. Hata ayıklama

- Eklenti başlatılamazsa ya da çökerse **Eklentiler** panelinde kırmızı "Hata" rozeti ve
  hata mesajı görünür. Komutu tekrar çalıştırmak eklentiyi yeniden başlatır.
- `activate` ve şekil üreticileri **10 saniye** içinde bitmelidir.
- `console.log` çıktıları geliştirici araçlarının konsolunda görünür (`npm run tauri dev`).
- Örnek eklenti: [`examples/plugins/gear`](../examples/plugins/gear) (parametrik involüt dişli). Denemek için klasörü `~/.sugarcad/plugins/` içine kopyalayın.
