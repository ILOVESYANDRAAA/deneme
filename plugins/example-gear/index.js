// sugarCAD örnek eklentisi: parametrik düz dişli.
// Eklentiler kendi iş parçacığında çalışır; DOM'a erişemez, sadece `sugarcad` API'sini kullanır.

const PRESSURE_ANGLE = (20 * Math.PI) / 180;

/** İnvolüt fonksiyonu: inv(a) = tan(a) - a */
function involute(a) {
  return Math.tan(a) - a;
}

/** Bir dişlinin dış hattını saat yönünün tersine [x, y] noktaları olarak üretir. */
function gearOutline(teeth, module) {
  const pitchR = (module * teeth) / 2;
  const baseR = pitchR * Math.cos(PRESSURE_ANGLE);
  const tipR = pitchR + module;
  const rootR = Math.max(pitchR - 1.25 * module, module * 0.5);
  // Taban dairesinde dişin yarı açısı.
  const halfTooth = Math.PI / (2 * teeth) + involute(PRESSURE_ANGLE);
  const steps = 8;

  const flank = [];
  const startR = Math.max(baseR, rootR);
  for (let i = 0; i <= steps; i++) {
    const r = startR + ((tipR - startR) * i) / steps;
    const theta = involute(Math.acos(Math.min(1, baseR / r)));
    flank.push({ r, offset: halfTooth - theta });
  }

  const points = [];
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  for (let t = 0; t < teeth; t++) {
    const center = (2 * Math.PI * t) / teeth;
    // Kök dairesinden dişin sol yanına
    points.push(polar(rootR, center - flank[0].offset));
    for (const p of flank) points.push(polar(p.r, center - p.offset));
    for (let i = flank.length - 1; i >= 0; i--) points.push(polar(flank[i].r, center + flank[i].offset));
    points.push(polar(rootR, center + flank[0].offset));
  }
  return points;
}

function circle(r, segments) {
  const pts = [];
  // Delik için saat yönünde (ters sarım) çiziyoruz.
  for (let i = segments - 1; i >= 0; i--) {
    const a = (2 * Math.PI * i) / segments;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

exports.activate = function (sugarcad) {
  sugarcad.primitives.register("gear.spur", (p) => {
    const outline = gearOutline(p.teeth, p.module);
    const rootR = (p.module * p.teeth) / 2 - 1.25 * p.module;
    const polygons = [outline];
    if (p.bore > 0 && p.bore / 2 < rootR * 0.9) polygons.push(circle(p.bore / 2, 48));
    return sugarcad.solids.extrude(polygons, p.thickness);
  });

  sugarcad.commands.register("gear.create", async () => {
    const values = await sugarcad.ui.showInput({
      title: "Dişli Oluştur",
      fields: [
        { name: "teeth", label: "Diş sayısı", type: "number", value: 20, min: 6, max: 200, step: 1 },
        { name: "module", label: "Modül", type: "number", value: 2, min: 0.1, step: 0.5 },
        { name: "thickness", label: "Kalınlık", type: "number", value: 8, min: 0.1, step: 1 },
        { name: "bore", label: "Mil delik çapı", type: "number", value: 8, min: 0, step: 1 },
      ],
    });
    if (!values) return;
    const feature = await sugarcad.document.addPrimitive("gear.spur", values);
    const pitch = values.module * values.teeth;
    await sugarcad.ui.showMessage(`${feature.name} eklendi (bölüm dairesi çapı ${pitch.toFixed(1)} mm)`);
  });
};
