import { config } from './config.js';
import { getDIDsInfo } from './voipms/client.js';

console.log('--- env loaded by fixed config ---');
console.log('voipms username set :', Boolean(config.voipms.username));
console.log('default country     :', config.voipms.defaultCountry);
console.log('nextcloud url       :', config.nextcloud.url || '(empty)');
console.log('webhook key set     :', Boolean(config.webhook.key));

(async () => {
  console.log('\n--- getDIDsInfo (fixed filter) ---');
  try {
    const dids = await getDIDsInfo();
    console.log('SMS-capable DIDs:', dids.length);
    for (const d of dids) console.log('  •', d.did, d.description ? `(${d.description})` : '');
  } catch (e) {
    console.error('getDIDsInfo error:', (e as Error).message);
    process.exitCode = 1;
  }
})();

