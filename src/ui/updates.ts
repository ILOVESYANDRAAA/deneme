import { errorText, type SugarApp } from "../app/controller";
import type { AvailableUpdate } from "../platform/adapter";
import type { WorkbenchUi } from "./workbench";

/** Masaüstünde yeni sürümü denetler, kullanıcı onaylarsa indirip kurar ve yeniden başlatır. */
export class UpdateChecker {
  private busy = false;

  constructor(
    private readonly app: SugarApp,
    private readonly ui: WorkbenchUi,
  ) {}

  /** `manual`: kullanıcı komutla istediyse "güncelsiniz" ve hata mesajları da gösterilir. */
  async check(manual: boolean): Promise<void> {
    if (this.busy) return;
    let update: AvailableUpdate | null;
    try {
      update = await this.app.platform.checkForUpdate();
    } catch (e) {
      if (manual) this.ui.showMessage(`Güncelleme denetlenemedi: ${errorText(e)}`, "error");
      return;
    }
    if (!update) {
      if (manual) this.ui.showMessage(`sugarCAD güncel (v${await this.app.platform.appVersion()})`, "info");
      return;
    }
    const found = update;
    this.ui.notify(`Yeni sürüm hazır: v${found.version}`, "info", [
      { label: "Güncelle", run: () => void this.install(found) },
      { label: "Sonra", run: () => {} },
    ]);
  }

  private async install(update: AvailableUpdate): Promise<void> {
    if (this.app.document.dirty) {
      const ok = await this.ui.showInput({
        title: "Kaydedilmemiş değişiklikler kaybolacak. Güncelleyip yeniden başlatılsın mı?",
        fields: [],
      });
      if (!ok) return;
    }
    this.busy = true;
    const status = this.ui.notify(`v${update.version} indiriliyor…`, "info", [{ label: "Gizle", run: () => {} }]);
    try {
      await update.install((f) => {
        status.textContent = f === null ? `v${update.version} indiriliyor…` : `v${update.version} indiriliyor… %${Math.round(f * 100)}`;
      });
    } catch (e) {
      this.ui.showMessage(`Güncelleme kurulamadı: ${errorText(e)}`, "error");
    } finally {
      this.busy = false;
    }
  }
}
