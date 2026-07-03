import { spawn } from 'node:child_process';

export interface NewMessageNotify {
  name: string;
  text: string;
}

const APP_NAME = 'Voip.ms text';
const DESKTOP_ENTRY = 'voipms-sms'; // matches ~/.local/share/applications/voipms-sms.desktop
const ICON = 'voipms-sms'; // matches ~/.local/share/icons/hicolor/scalable/apps/voipms-sms.svg

/**
 * Fire a native GNOME notification. We call notify-send directly so we can set
 * `--app-name` and the `desktop-entry` hint — that's what makes GNOME attribute
 * the banner to "Voip.ms text" with the phone icon instead of "notify-send".
 * Run deploy/install-desktop.sh once to install the desktop entry + icon.
 */
export function notifyNewMessage({ name, text }: NewMessageNotify): void {
  const body = text.length > 200 ? text.slice(0, 200) + '…' : text;
  const args = [
    `--app-name=${APP_NAME}`,
    `--icon=${ICON}`,
    '--urgency=normal',
    `--hint=string:desktop-entry:${DESKTOP_ENTRY}`,
    name,
    body,
  ];
  try {
    const child = spawn('notify-send', args, { stdio: 'ignore' });
    child.on('error', (e) => console.error('[notify] notify-send failed:', e.message));
    child.unref();
  } catch (e) {
    console.error('[notify]', (e as Error).message);
  }
}
