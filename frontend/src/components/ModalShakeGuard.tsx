import { useEffect } from 'react';

/**
 * ModalShakeGuard
 * ─────────────────────────────────────────────────────────────────
 * Global behaviour for every Ant Design `Modal` in the app:
 *
 *   • Clicking on the dimmed area outside the modal does NOT close it.
 *   • Instead, the modal plays a small "head-shake" animation,
 *     letting the user know they must press Escape or hit the
 *     close (×) button to dismiss it.
 *
 * Modals that opt-out of this behaviour (i.e. should still close on
 * mask click) must include one of the class names listed in
 * `ALLOW_MASK_CLOSE` in their `className` prop. Today this is used
 * by `NewSaleModal` and `NewPurchaseModal` (both share
 * `new-sale-modal`).
 *
 * Implementation notes:
 *   - We attach a single `click` listener on the document in the
 *     CAPTURE phase. Ant Design's mask-close handler runs in the
 *     bubbling phase, so calling `stopPropagation()` here is enough
 *     to suppress it without monkey-patching antd internals.
 *   - This works regardless of the modal's own `maskClosable` prop,
 *     so we don't have to touch every existing component.
 *   - Escape key handling is left untouched (antd's default).
 */

const SHAKE_CLASS = 'rg-modal-shake';
const SHAKE_DURATION_MS = 520;

/** Modals that keep the original mask-close behaviour. */
const ALLOW_MASK_CLOSE = ['new-sale-modal'];

export function ModalShakeGuard() {
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Only react to clicks on the modal "wrap" itself (the dim area).
      // Clicks on inner content land on a descendant element.
      if (!target.classList.contains('ant-modal-wrap')) return;

      const dialog = target.querySelector<HTMLElement>('.ant-modal');
      if (!dialog) return;

      // Opt-out: let Ant Design close the modal as usual.
      if (ALLOW_MASK_CLOSE.some((cls) => dialog.classList.contains(cls))) {
        return;
      }

      // Suppress antd's own mask-close handler (registered in bubbling phase).
      e.stopPropagation();

      // Restart the shake animation cleanly even on rapid repeated clicks.
      dialog.classList.remove(SHAKE_CLASS);
      // Force reflow so the animation can replay.
      void dialog.offsetWidth;
      dialog.classList.add(SHAKE_CLASS);

      window.setTimeout(() => {
        dialog.classList.remove(SHAKE_CLASS);
      }, SHAKE_DURATION_MS);
    };

    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return null;
}
