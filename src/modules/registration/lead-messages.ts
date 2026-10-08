/** Ready-made follow-up messages. Staff can edit the text before it goes out. */
export interface LeadTemplate { key: string; label: string; subject: string; text: string }

export const DEFAULT_LEAD_TEMPLATES: LeadTemplate[] = [
  { key: 'first_contact', label: 'First reply', subject: 'Your free trial at LaLiga Academy Abu Dhabi',
    text: 'Hello {{parent}}, thank you for your interest in LaLiga Academy Abu Dhabi! We would love to invite {{child}} for a free trial session. Which day suits you best? — {{staff}}, LaLiga Academy Abu Dhabi' },
  { key: 'no_answer', label: 'Tried to call', subject: 'We tried to reach you — LaLiga Academy',
    text: 'Hello {{parent}}, we tried to call you about {{child}}\'s free trial at LaLiga Academy Abu Dhabi. When is a good time to talk? — {{staff}}' },
  { key: 'trial_confirmation', label: 'Trial confirmation', subject: 'Trial confirmed — {{child}}',
    text: 'Hello {{parent}}, {{child}}\'s free trial is booked for {{trialDay}} at {{trialTime}} with our {{team}} group at {{venue}}. Please arrive 10 minutes early with football boots, shin pads and a water bottle. See you there! — LaLiga Academy Abu Dhabi' },
  { key: 'trial_reminder', label: 'Trial reminder', subject: 'See you at the trial — {{child}}',
    text: 'Hello {{parent}}, a quick reminder that {{child}}\'s trial is on {{trialDay}} at {{trialTime}}, {{venue}}. Football boots, shin pads and water, please. — LaLiga Academy Abu Dhabi' },
  { key: 'after_trial', label: 'After the trial', subject: 'How did {{child}} enjoy the trial?',
    text: 'Hello {{parent}}, thank you for bringing {{child}} to the trial. Our coaches would love to have {{child}} in the {{level}} programme. Shall we reserve a place? — {{staff}}, LaLiga Academy Abu Dhabi' },
];

export function fill(text: string, vars: Record<string, string | null | undefined>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

/** wa.me link that opens WhatsApp with the message ready to send. */
export function whatsappLink(mobile: string, text: string) {
  const digits = mobile.replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Where a family stands after the trial — the desk's standard follow-up notes,
 * from the trials sheet the academy used before this screen. Editable in the app.
 */
export const DEFAULT_LEAD_OUTCOMES: string[] = [
  'All details given, interested — invoice issued and sent',
  'All details shared, interested — will confirm',
  'WhatsApp sent with all details',
  'WhatsApp sent with details and placement — waiting for a reply',
  'Follow-up message sent',
  'No answer, WhatsApp sent',
  'No answer, reminder sent',
  'Tried to reach by call and WhatsApp',
  'All details and placement shared, no answer after many attempts',
  'Not reachable anymore',
  'Another trial is needed',
  'Will attend a second trial and decide',
  'Still under assessment with the Advanced team',
  'Advanced invitation sent, pending registration',
  'All details shared — trialling another academy, will confirm',
  'Interested but the timings don\'t suit them',
  'Can\'t attend on weekdays',
  'Can\'t make it — the location is too far',
  'Prices are out of budget',
  'Interested but the fees are out of budget',
  'Not happy with the Development placement',
  'Refused to be placed in a Development team',
  'Refused the second Advanced team',
  'Not joining this term — maybe next term',
  'Won\'t proceed with registration for now',
  'Didn\'t attend the trial — wants another day',
  'Didn\'t attend the trial and not interested anymore',
  'Attended, all details shared — not interested',
  'The child didn\'t enjoy it',
  'Joined another academy',
  'Not interested',
  'Not serious about joining',
];
