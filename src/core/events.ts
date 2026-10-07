export type Listener<T> = (value: T) => void;

export interface Disposable {
  dispose(): void;
}

/** Küçük, tipli olay yayıcı. */
export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  fire(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }
}
