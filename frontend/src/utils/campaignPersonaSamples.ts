/**
 * Sample speech lines for persona preview (UI only).
 */

import type { CampaignPersona } from './campaignPersona'

export function personaSpeechSamples(p: CampaignPersona, language = 'en'): string[] {
  const vi = language === 'vi' || language === 'bilingual'
  const role = (p.role || 'member').toLowerCase()
  const assets = p.favoriteAssets?.length ? p.favoriteAssets : ['BTC']

  if (vi) {
    if (role === 'lead') {
      return [
        `${assets[0]} vẫn giữ vùng này.`,
        'Mình chờ confirm thêm.',
        'Không cần đuổi theo con pump này.',
      ]
    }
    if (role === 'reactor' || role === 'degen') {
      return [
        `${assets[0]?.toLowerCase?.() || 'sol'} yếu thật tho`,
        'không đụng con pump đó lol',
        'btc chán quá hôm nay',
      ]
    }
    if (role === 'echo' || role === 'lurker') {
      return ['đúng vậy', 'lol', 'cũng được 😂']
    }
    return [
      `${assets[0]} mọi người nghĩ sao?`,
      'mình chưa rõ lắm, giải thích với',
      'vào bây giờ có ổn không?',
    ]
  }

  if (role === 'lead') {
    return [
      `${assets[0]} is still holding.`,
      "I'd wait for confirmation.",
      'No need to chase this.',
    ]
  }
  if (role === 'reactor' || role === 'degen') {
    return [
      `${(assets[0] || 'sol').toLowerCase()} looks weak tho`,
      'not touching that pump lol',
      'btc is boring today',
    ]
  }
  if (role === 'echo' || role === 'lurker') {
    return ['yeah', 'lol same', 'true 😂']
  }
  // member / newbie
  return [
    `what do you guys think about ${assets[0]}?`,
    'not sure I get this move',
    'should I wait?',
  ]
}
