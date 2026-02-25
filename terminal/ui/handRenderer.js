'use strict';

/**
 * Render the player's hand as lines of text.
 *
 * @param {Player} myPlayer - The local player
 * @param {number|null} selectedHandIndex - Index of the currently selected card
 * @returns {string} Multi-line string representing the hand
 */
function renderHand(myPlayer, selectedHandIndex) {
  if (!myPlayer) return '(no player)';

  let cards = [];
  try {
    cards = myPlayer.getDeck().getCardsInHandExcludingMissing();
  } catch (e) {
    return '(hand unavailable)';
  }

  if (cards.length === 0) return '(empty hand)';

  const remainingMana = safeGet(() => myPlayer.getRemainingMana(), 0);
  const lines = [];

  cards.forEach((card, i) => {
    const isSelected = i === selectedHandIndex;
    const cost = safeGet(() => card.getManaCost(), '?');
    const canPlay = typeof cost === 'number' && remainingMana >= cost;
    const name = safeGet(() => card.getName() || 'Unknown', 'Unknown').slice(0, 18).padEnd(18);

    const costTag = typeof cost === 'number'
      ? `${cost}M`.padStart(3)
      : ' ?M';

    const prefix = isSelected ? '>' : ' ';
    const indicator = canPlay ? '+' : '-';

    lines.push(`${prefix}[${i + 1}] ${name} ${costTag} ${indicator}`);
  });

  return lines.join('\n');
}

function safeGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

module.exports = { renderHand };
