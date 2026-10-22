import { readFileSync } from 'node:fs';
const key = process.env.BRIDGE_API_KEY || readFileSync('.bridge-key', 'utf8').trim();
const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8000}/v1/chat/completions`, {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-subscription', messages: [{ role: 'user', content: 'Reply with exactly: bridge works' }], stream: process.argv.includes('--stream') }),
});
console.log('HTTP', response.status);
for await (const chunk of response.body) process.stdout.write(Buffer.from(chunk));
console.log();
if (!response.ok) process.exitCode = 1;
