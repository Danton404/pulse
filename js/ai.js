// Claude, called straight from the browser with the user's own key (stored only in this browser).
import { settings } from './store.js';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (balanced)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (smartest, higher cost)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest, cheapest)' },
];

export const SYSTEM = `You are Pulse, a personal fitness and recovery coach. The user wears a Fitbit Air.
You get their profile, recent workouts (from live Bluetooth heart rate) and daily health data (resting HR, HRV, sleep, SpO2, respiratory rate, steps) as JSON.
Be specific and quantitative: cite their numbers, compare to their own baseline, and give one or two concrete actions.
Keep answers short (under 200 words unless asked for more). Use plain sentences and short bullet lists.
You are not a doctor: if something looks medically concerning (e.g. very low SpO2, unusual resting HR jumps), say so plainly and suggest seeing one.`;

export async function askClaude(messages, context) {
  const { key, model } = settings.claude;
  if (!key) throw new Error('Add your Claude API key in Settings.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: `${SYSTEM}\n\nToday is ${new Date().toDateString()}.\n\nUser data:\n${JSON.stringify(context)}`,
      messages,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Claude error ${r.status}`);
  return j.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
