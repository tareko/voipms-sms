import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import notifier from 'node-notifier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconPath = resolve(__dirname, '..', '..', 'assets', 'icon.png');

export interface NewMessageNotify {
  name: string;
  text: string;
}

/**
 * Fire a native GNOME notification (notify-send on Linux). Informative, auto-dismiss.
 * Options cast because @types/node-notifier (v8) doesn't cover v10's `appID`.
 */
export function notifyNewMessage({ name, text }: NewMessageNotify): void {
  try {
    const options = {
      title: name,
      message: text.length > 200 ? text.slice(0, 200) + '…' : text,
      appID: 'voipms-sms',
      icon: iconPath,
      timeout: 8000,
    };
    notifier.notify(options as never, (err: Error | null | undefined) => {
      if (err) console.error('[notify]', err.message);
    });
  } catch (err) {
    console.error('[notify]', (err as Error).message);
  }
}
