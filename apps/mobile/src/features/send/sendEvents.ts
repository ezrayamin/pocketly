/**
 * The Send flow tells the tabs to reload when it ends (FR-TRF-07: balance and history updated).
 * Home and History live inside the Tabs screen, not as navigation screens, so a tiny listener
 * list is simpler than navigation events.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onTransferFinished(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function transferFinished(): void {
  for (const listener of listeners) listener();
}
