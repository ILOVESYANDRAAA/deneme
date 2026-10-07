import type { SugarApp } from "../app/controller";
import type { PluginState } from "../plugins/host";
import { compact, h } from "./dom";

const STATE_LABELS: Record<PluginState, string> = {
  inactive: "Hazır",
  activating: "Başlıyor",
  active: "Çalışıyor",
  failed: "Hata",
  stopped: "Durduruldu",
};

/** Yüklü eklentileri, durumlarını ve katkılarını gösteren panel. */
export class ExtensionsPanel {
  readonly element: HTMLElement;
  private list = h("div");
  private footer = h("div", { class: "form" });

  constructor(private readonly app: SugarApp) {
    this.element = h("div", { class: "extensions" }, this.list, this.footer);
    app.host.onDidChange.on(() => this.render());
    this.render();
    void this.renderFooter();
  }

  private render(): void {
    const plugins = this.app.host.list();
    if (plugins.length === 0) {
      this.list.replaceChildren(h("div", { class: "empty" }, "Yüklü eklenti yok."));
      return;
    }
    this.list.replaceChildren(
      ...plugins.map((p) => {
        const m = p.manifest;
        const commands = m.contributes?.commands ?? [];
        const primitives = m.contributes?.primitives ?? [];
        return h(
          "div",
          { class: "ext", dataset: { plugin: m.name } },
          h(
            "div",
            { class: "ext-head" },
            h("strong", {}, m.displayName ?? m.name),
            h("span", { class: "meta" }, `v${m.version}`),
            h("span", { class: `badge ${p.state}` }, STATE_LABELS[p.state]),
          ),
          m.description ? h("div", { class: "meta" }, m.description) : null,
          h("div", { class: "meta" }, p.location === "builtin" ? "Yerleşik" : `Kullanıcı · ${p.path ?? ""}`),
          p.error ? h("div", { class: "error-box" }, p.error) : null,
          ...commands.map((c) =>
            h("button", { class: "cmd", onclick: () => this.app.commands.run(c.id) }, `▸ ${c.title}`),
          ),
          ...primitives.map((s) =>
            h("button", { class: "cmd", onclick: () => this.app.commands.run(`shape.add.${s.type}`) }, `＋ ${s.label}`),
          ),
          p.state === "active"
            ? h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => this.app.host.stop(m.name) }, "Durdur"))
            : null,
        );
      }),
    );
  }

  private async renderFooter(): Promise<void> {
    const dir = await this.app.platform.userPluginsDir().catch(() => null);
    this.footer.replaceChildren(
      ...compact(
      h("h3", {}, "Kendi eklentinizi ekleyin"),
      dir
        ? h(
            "div",
            { class: "meta" },
            "Eklenti klasörünü (içinde sugarcad.json ve index.js) şuraya koyup uygulamayı yeniden başlatın:",
          )
        : h(
            "div",
            { class: "meta" },
            "Masaüstü uygulamasında kullanıcı eklentileri ~/.sugarcad/plugins klasöründen yüklenir. Rehber: docs/eklenti-yazma.md",
          ),
      dir ? h("div", { class: "path" }, dir) : null,
      ),
    );
  }
}
