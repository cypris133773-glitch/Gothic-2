// Dialogue: a wall with doors in it.
//
// No wheel, no moral meter, no persuasion percentage. A list of things you may
// say, each gated by guild, chapter, what you are carrying and what you have
// already been told (§6.5, pillar P10). NPCs remember what you said, and some
// doors only open once.
//
// The engine is deliberately small. Everything interesting lives in the data,
// and the validator in tools/test.js is what keeps sixty conversations from
// collapsing into flag spaghetti.

/**
 * The conversation state machine. One per world; a conversation is a pointer
 * into an NPC's node list plus the world state the conditions read.
 */
export function createDialogue(world) {
  let active = null;          // { npc, nodes, options, said }

  const ctx = () => ({
    // Everything a `when` clause is allowed to look at. Keeping it explicit is
    // what lets the validator run every condition against a synthetic world.
    flags: world.flags,
    has: (flag) => world.flags.has(flag),
    gold: world.character.gold,
    guild: world.character.guild,
    level: world.character.level,
    lp: world.character.lp,
    chapter: world.chapter,
    skill: (name) => world.character.skills[name] || 0,
    knows: (name) => world.flags.has(`skill:${name}`),
    npc: active ? active.npc : null,
  });

  function visible(nodes) {
    const c = ctx();
    return nodes
      .filter((n) => !n.once || !world.flags.has(`said:${n.id}`))
      .filter((n) => !n.when || n.when(c))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  return {
    get active() { return active; },
    get isOpen() { return active !== null; },

    /** Begin a conversation. Returns the opening options, or null if silent. */
    start(npc, nodes) {
      const options = visible(nodes);
      if (!options.length) return null;
      active = { npc, nodes, options, said: [], reply: null };
      return active;
    },

    /**
     * Say the nth thing on the list. Returns the reply and the new options, so
     * the caller never has to know how a node's effects changed the world.
     */
    say(index) {
      if (!active) return null;
      const node = active.options[index];
      if (!node) return null;

      world.flags.add(`said:${node.id}`);
      active.said.push(node.id);
      active.reply = node.reply;

      for (const effect of node.effects || []) applyEffect(world, effect, active.npc);

      if (node.ends) { const done = active; active = null; return { reply: node.reply, closed: true, node: done }; }
      active.options = visible(active.nodes);
      return { reply: node.reply, options: active.options, closed: false };
    },

    close() { active = null; },
  };
}

/**
 * Effects are data, not functions, so the validator can enumerate them and the
 * save file can record what a conversation did without serialising a closure.
 */
export function applyEffect(world, effect, npc) {
  const c = world.character;
  switch (effect.kind) {
    case 'flag':
      world.flags.add(effect.flag);
      break;
    case 'unflag':
      world.flags.delete(effect.flag);
      break;
    case 'gold':
      c.gold = Math.max(0, c.gold + effect.amount);
      break;
    case 'xp':
      world.awardXp(effect.amount, 'quest');
      break;
    case 'attribute':
      // The *offer* of an attribute lesson, on the same footing as a skill
      // one — buying is still the separate, explicit act in world.train().
      world.openTrainer = { npc: npc && npc.id, ...effect };
      break;
    case 'trainer':
      // The offer, not the training. Buying is a separate, explicit act — see
      // world.train(), which is the only path that can raise a number.
      world.openTrainer = { npc: npc && npc.id, ...effect };
      break;
    case 'trade':
      world.openTrader = effect.trader;
      break;
    case 'give':
      world.give(effect.item, effect.n || 1);
      break;
    case 'take':
      world.take(effect.item, effect.n || 1);
      break;
    case 'quest':
      world.setQuest(effect.quest, effect.stage);
      break;
    case 'guild':
      world.joinGuild(effect.guild);
      break;
    case 'hostile':
      world.makeHostile(npc);
      break;
    default:
      throw new Error(`unknown dialogue effect "${effect.kind}"`);
  }
}

/** Every effect kind the engine knows. The validator asserts data uses only these. */
export const EFFECT_KINDS = ['flag', 'unflag', 'gold', 'xp', 'trainer', 'attribute', 'trade', 'give', 'take', 'quest', 'guild', 'hostile'];
