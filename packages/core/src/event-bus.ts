import type { AppEvent, AppEventOf, AppEventType } from '@amctk/shared'

type Handler<T extends AppEventType> = (event: AppEventOf<T>) => void
type AnyHandler = (event: AppEvent) => void

/**
 * プロセス内の型付きEvent Bus。
 * ハンドラの例外は他のハンドラに波及させない（Failure Isolation）。
 */
export class EventBus {
  private handlers = new Map<AppEventType, Set<Handler<AppEventType>>>()
  private anyHandlers = new Set<AnyHandler>()

  constructor(private onHandlerError?: (err: unknown, event: AppEvent) => void) {}

  on<T extends AppEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as unknown as Handler<AppEventType>)
    return () => set!.delete(handler as unknown as Handler<AppEventType>)
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  emit(event: AppEvent): void {
    const set = this.handlers.get(event.type)
    if (set) {
      for (const h of set) this.safe(() => h(event as AppEventOf<AppEventType>), event)
    }
    for (const h of this.anyHandlers) this.safe(() => h(event), event)
  }

  private safe(fn: () => void, event: AppEvent) {
    try {
      fn()
    } catch (err) {
      this.onHandlerError?.(err, event)
    }
  }
}
